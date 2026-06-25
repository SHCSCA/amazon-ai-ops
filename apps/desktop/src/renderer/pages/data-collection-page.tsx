import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline } from '../components/business-data';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { ProgressiveDetails } from '../components/progressive-details';
import { MicroStepper, PageHeader, Panel, StatusPill } from '../components/ui';
import { buildCollectionActionSummary } from '../collection-action-summary';
import { buildDataReadinessLedger } from '../data-readiness-ledger';
import { compactPath } from '../formatters';
import { toUserFacingError } from '../user-facing-error';

type CollectionActionMode = 'download-existing' | 'recreate-selected' | 'recreate-full' | 'import';
type DownloadCollectionActionMode = Exclude<CollectionActionMode, 'import'>;
type RunningCollectionActionMode = CollectionActionMode | 'verify-page';

export interface CollectionActionGuide {
  title: string;
  whenToUse: string;
  taskEffect: string;
  result: string;
}

export interface LastActionResult {
  title: string;
  tone: 'default' | 'success' | 'warning' | 'blocked';
  mode: CollectionActionMode;
  batchIds: string[];
  downloadedCount: number;
  actionDownloadedFiles: Array<{
    label: string;
    fileName: string;
    filePath: string;
    fileSizeBytes: number;
  }>;
  failedCount: number;
  parsedFiles: number;
  insertedRows: number;
  currentImportedRows: number;
  downloadDir?: string;
  manifestPath?: string;
  nextStep: string;
  failedFiles: Array<{ label: string; reason: string }>;
}

interface ActionProgressStep {
  label: string;
  description: string;
  status: 'ready' | 'pending' | 'blocked';
}

export interface CollectionMonitorState {
  tone: 'pending' | 'ready' | 'blocked';
  statusLabel: string;
  title: string;
  headline: string;
  detail: string;
  previewTitle: string;
  previewDetail: string;
  canClose: boolean;
}

function getFileExtension(fileName: string, filePath: string): string {
  const target = fileName || filePath;
  const dotIndex = target.lastIndexOf('.');
  return dotIndex >= 0 ? target.slice(dotIndex).toLowerCase() : '-';
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUpdatedAt(updatedAt?: string): string {
  if (!updatedAt) return '-';
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return updatedAt;
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function shortHash(hash?: string): string {
  return hash ? `${hash.slice(0, 12)}...` : '-';
}

function isRealReportPath(filePath: string): boolean {
  const extension = getFileExtension('', filePath);
  if (!['.xlsx', '.xls', '.csv'].includes(extension)) return false;
  return !/(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i.test(filePath);
}

function reportStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    missing: '缺少文件',
    blocked: '阻断',
    partial: '部分完成',
    pending: '待创建',
    creating: '创建中',
    created: '领星任务已创建',
    generating: '生成中',
    ready: '可下载',
    downloading: '下载中',
    downloaded: '已下载待入库',
    imported: '已入库',
    import_failed: '导入失败',
    failed: '失败',
  };
  return labels[status] || status;
}

function reportOptionTone(item: { realFileAvailable?: boolean; importedRows?: number; status?: string }): 'ready' | 'pending' | 'blocked' | 'warning' {
  if ((item.importedRows || 0) > 0) return 'ready';
  if (item.realFileAvailable) return 'warning';
  if (['failed', 'import_failed', 'blocked', 'missing'].includes(item.status || '')) return 'blocked';
  return 'pending';
}

function collectionStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    ready: '真实报表可用',
    partial: '部分报表可用',
    blocked: '缺少真实报表',
  };
  return labels[status || 'blocked'] || '缺少真实报表';
}

function readinessStageClass(status: string): string {
  if (status === 'complete') return 'collection-progress-step collection-progress-ready';
  if (status === 'partial') return 'collection-progress-step collection-progress-pending';
  return 'collection-progress-step collection-progress-blocked';
}

function readinessStageTone(status: string): 'ready' | 'pending' | 'blocked' {
  if (status === 'complete') return 'ready';
  if (status === 'partial') return 'pending';
  return 'blocked';
}

function readinessStageLabel(status: string): string {
  if (status === 'complete') return '完成';
  if (status === 'partial') return '部分完成';
  return '阻断';
}

function actionTitle(mode: CollectionActionMode): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': '下载并导入已创建报表',
    'recreate-selected': '重新创建、下载并导入已选报表',
    'recreate-full': '重新创建、下载并导入全部 8 类报表',
    import: '真实报表导入',
  };
  return labels[mode];
}

function actionResultTitle(mode: CollectionActionMode, tone: LastActionResult['tone']): string {
  const base = actionTitle(mode);
  if (mode === 'import') return tone === 'success' ? `${base}完成` : `${base}未完成`;
  if (tone === 'warning') {
    if (mode === 'download-existing') return '已创建报表下载完成，自动导入未完成';
    if (mode === 'recreate-selected') return '已选报表下载完成，自动导入未完成';
    if (mode === 'recreate-full') return '全部报表下载完成，自动导入未完成';
  }
  return tone === 'success' ? `${base}完成` : `${base}未完成`;
}

function actionModeLabel(mode: RunningCollectionActionMode): string {
  const labels: Record<RunningCollectionActionMode, string> = {
    'download-existing': '下载并导入已创建报表',
    'recreate-selected': '重新创建、下载并导入已选报表',
    'recreate-full': '重新创建、下载并导入全部 8 类',
    import: '导入本地/已下载报表',
    'verify-page': '验证下载中心页面',
  };
  return labels[mode];
}

export function buildCollectionMonitorState(input: {
  runningAction: RunningCollectionActionMode | null;
  actionNotice?: string | null;
  actionError?: string | null;
  lastActionResult?: LastActionResult | null;
  lastDiagnostic?: any | null;
  realReportCount: number;
  importedRowCount: number;
}): CollectionMonitorState | null {
  const realReportCount = Math.max(0, Number(input.realReportCount) || 0);
  const importedRowCount = Math.max(0, Number(input.importedRowCount) || 0);
  if (input.runningAction) {
    const isVerify = input.runningAction === 'verify-page';
    return {
      tone: 'pending',
      statusLabel: '处理中',
      title: isVerify ? '下载中心页面验证' : '自动数据采集监控',
      headline: actionModeLabel(input.runningAction),
      detail: input.actionNotice || '系统已接收动作，正在处理当前范围。完成前不要切换日期、店铺、站点或批次。',
      previewTitle: isVerify ? '正在读取下载中心页面' : '领星下载中心任务执行中',
      previewDetail: isVerify
        ? '主进程正在刷新当前范围的页面截图、DOM 和页面模型证据。'
        : `当前范围已有真实报表 ${realReportCount}/8 类，已导入 ${importedRowCount} 行。`,
      canClose: false,
    };
  }

  if (input.actionError) {
    return {
      tone: 'blocked',
      statusLabel: '需处理',
      title: '采集动作未完成',
      headline: '动作已停止',
      detail: '采集动作被阻断。请查看页面首屏的具体错误，并处理登录、页面模型、报表范围或表头解析问题后重试。',
      previewTitle: input.lastDiagnostic?.ready ? '页面验证通过但动作未闭合' : '当前动作被阻断',
      previewDetail: input.lastDiagnostic?.screenshotPath || input.lastDiagnostic?.domSnapshotPath
        ? `诊断证据：${compactPath(input.lastDiagnostic.screenshotPath || input.lastDiagnostic.domSnapshotPath)}`
        : '请按阻断说明处理登录、页面模型、报表范围或本地文件后重试。',
      canClose: true,
    };
  }

  if (input.lastActionResult) {
    const result = input.lastActionResult;
    const isReady = result.tone === 'success' || result.currentImportedRows > 0;
    return {
      tone: isReady ? 'ready' : 'pending',
      statusLabel: isReady ? '已返回' : '待补齐',
      title: '最近采集动作',
      headline: result.title,
      detail: result.nextStep,
      previewTitle: result.actionDownloadedFiles.length > 0 ? '真实报表已落盘' : '未发现本次新增表格',
      previewDetail: result.actionDownloadedFiles.length > 0
        ? `本次新增 ${result.actionDownloadedFiles.length} 个真实报表，当前范围覆盖 ${result.downloadedCount}/8 类。`
        : result.nextStep,
      canClose: true,
    };
  }

  if (input.actionNotice) {
    return {
      tone: 'ready',
      statusLabel: '已返回',
      title: '最近动作',
      headline: '最近动作已返回',
      detail: `动作已返回。当前范围已有真实报表 ${realReportCount}/8 类，已导入 ${importedRowCount} 行。`,
      previewTitle: input.lastDiagnostic?.ready ? '页面验证通过' : '动作已返回',
      previewDetail: input.lastDiagnostic?.screenshotPath || input.lastDiagnostic?.domSnapshotPath
        ? `诊断证据：${compactPath(input.lastDiagnostic.screenshotPath || input.lastDiagnostic.domSnapshotPath)}`
        : '可继续执行下一步动作。',
      canClose: true,
    };
  }

  return null;
}

export interface DataCollectionTaskState {
  title: string;
  detail: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  isComplete: boolean;
}

export function dataCollectionFirstViewportReportFolder(input: {
  realReportCount: number;
  realFiles: Array<{ folderPath?: string }>;
  evidenceFolder?: string;
  auditDownloadDir?: string;
}): string | undefined {
  if ((Number(input.realReportCount) || 0) <= 0) return undefined;
  return input.realFiles.find((file) => Boolean(file.folderPath))?.folderPath;
}

export function collectionActionButtonLabel(mode: CollectionActionMode): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': '下载已创建',
    'recreate-selected': '重建已选',
    'recreate-full': '重建全部 8 类',
    import: '导入本地',
  };
  return labels[mode];
}

export function collectionActionButtonDetail(mode: CollectionActionMode): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': '只处理已生成的 ready 报表',
    'recreate-selected': '只重建当前勾选报表',
    'recreate-full': '创建、下载并导入完整 8 类',
    import: '选择本地 xlsx/xls/csv',
  };
  return labels[mode];
}

export function buildDataCollectionTaskState({
  realReportCount,
  importedRowCount,
  primaryReportFolder,
  runningAction,
}: {
  realReportCount: number;
  importedRowCount: number;
  primaryReportFolder?: string;
  runningAction: RunningCollectionActionMode | null;
}): DataCollectionTaskState {
  const reportCount = Math.max(0, Math.min(8, Number(realReportCount) || 0));
  const rowCount = Math.max(0, Number(importedRowCount) || 0);
  const isComplete = reportCount >= 8 && rowCount > 0;
  return {
    title: `真实报表 ${reportCount}/8，已导入 ${rowCount} 行`,
    detail: isComplete
      ? '真实报表和日级指标已闭合，可以进入广告量化。'
      : reportCount > 0
        ? '先补齐完整 8 类报表；已有本地表格时可从目录确认或导入。'
        : '当前范围缺少真实报表，先获取完整 8 类或导入本地表格。',
    primaryActionLabel: isComplete
      ? '进入广告量化'
      : runningAction === 'verify-page'
        ? '正在验证下载中心页面...'
      : runningAction === 'recreate-full'
        ? '正在重新获取完整 8 类报表...'
        : '重新获取完整 8 类报表',
    secondaryActionLabel: primaryReportFolder ? '打开报表目录' : '导入本地报表',
    isComplete,
  };
}

export function collectionActionGuide(mode: CollectionActionMode): CollectionActionGuide {
  const guides: Record<CollectionActionMode, CollectionActionGuide> = {
    'download-existing': {
      title: '下载并导入已创建的已选报表',
      whenToUse: '领星已经生成 ready 行时使用',
      taskEffect: '不会创建新任务',
      result: '下载后自动写入 DB；无新增文件时打开当前真实报表目录确认',
    },
    'recreate-selected': {
      title: '重新创建、下载并导入已选报表',
      whenToUse: '只补当前已选报表时使用',
      taskEffect: '会创建当前勾选报表的新任务',
      result: '生成完成后下载真实报表并自动写入 DB',
    },
    'recreate-full': {
      title: '重新创建、下载并导入全部 8 类',
      whenToUse: '缺少完整 8 类或需要刷新当前范围全量数据时使用',
      taskEffect: '会创建完整 8 类报表的新任务',
      result: '下载完整广告报表并自动写入 DB 日级广告指标',
    },
    import: {
      title: '导入本地报表',
      whenToUse: '已经手动拿到领星 xlsx/xls/csv 时使用',
      taskEffect: '不访问领星下载中心',
      result: '复制本地文件并写入 DB 日级广告指标',
    },
  };
  return guides[mode];
}

function buildActionProgressSteps(mode: CollectionActionMode | null, result: LastActionResult | null): ActionProgressStep[] {
  if (!mode && !result) return [];
  const completed = Boolean(result);
  const blocked = result?.tone === 'blocked';
  const currentMode = mode || (result?.title.includes('下载') && result?.title.includes('已创建') ? 'download-existing'
    : result?.title.includes('重新创建') && result?.title.includes('全部') ? 'recreate-full'
      : result?.title.includes('重新创建') && result?.title.includes('已选') ? 'recreate-selected'
        : 'import');
  const baseStatus = completed ? 'ready' : 'pending';
  if (currentMode === 'import') {
    return [
      { label: '1. 确认真实文件', description: '只读取当前范围的 xlsx/xls/csv，不读取审计文件。', status: baseStatus },
      { label: '2. 解析表格', description: '识别报表类型、日期、广告活动/广告组、关键词/投放对象和金额列。', status: completed ? (blocked ? 'blocked' : 'ready') : 'pending' },
      { label: '3. 写入数据库', description: '形成每日广告事实，后续量化和 AI 只从数据库读取。', status: completed ? (blocked ? 'blocked' : 'ready') : 'pending' },
    ];
  }
  return [
    {
      label: '1. 验证当前范围',
      description: '日期、店铺、站点必须和领星下载中心页面一致。',
      status: baseStatus,
    },
    {
      label: currentMode === 'download-existing' ? '2. 查找 ready 行' : '2. 创建领星任务',
      description: currentMode === 'download-existing'
        ? '只下载已经创建完成的报表，不新建任务。'
        : '在领星为当前范围创建新报表任务，并等待生成完成。',
      status: completed ? (blocked ? 'blocked' : 'ready') : 'pending',
    },
    {
      label: '3. 下载并校验表格',
      description: '必须落盘为 xlsx/xls/csv，大小大于 0，并登记采集清单/校验码。',
      status: completed ? (blocked ? 'blocked' : 'ready') : 'pending',
    },
    {
      label: '4. 自动导入广告指标',
      description: '下载完成后会自动解析并写入 SQLite；已有表格未入库时可手动点击“导入已下载表格”。',
      status: completed ? ((result?.currentImportedRows || 0) > 0 ? 'ready' : 'pending') : 'pending',
    },
  ];
}

function CollectionMonitorDrawer({
  state,
  steps,
  evidencePath,
  onClose,
}: {
  state: CollectionMonitorState;
  steps: ActionProgressStep[];
  evidencePath?: string;
  onClose: () => void;
}) {
  return (
    <aside className={`collection-monitor-drawer collection-monitor-${state.tone}`} aria-live="polite" aria-label="自动数据采集监控">
      <div className="collection-monitor-header">
        <div>
          <span>{state.title}</span>
          <strong>{state.headline}</strong>
        </div>
        <div className="collection-monitor-header-actions">
          <StatusPill tone={state.tone}>{state.statusLabel}</StatusPill>
          <button className="secondary-button compact-button" disabled={!state.canClose} onClick={onClose} type="button">
            收起
          </button>
        </div>
      </div>
      <p className="collection-monitor-detail">{state.detail}</p>
      <div className="collection-monitor-preview" aria-label="下载中心监控预览">
        <div className="collection-monitor-preview-screen">
          <span className="collection-monitor-scanline" />
          <strong>{state.previewTitle}</strong>
          <small>{state.previewDetail}</small>
        </div>
      </div>
      {steps.length > 0 && (
        <div className="collection-monitor-steps">
          {steps.map((step) => (
            <div className={`collection-monitor-step collection-monitor-step-${step.status}`} key={step.label}>
              <span />
              <div>
                <strong>{step.label}</strong>
                <p>{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {evidencePath && (
        <div className="collection-monitor-evidence">
          <span>证据位置</span>
          <code>{evidencePath}</code>
        </div>
      )}
    </aside>
  );
}

function rawErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

export function collectionActionError(mode: Exclude<CollectionActionMode, 'import'>, error: unknown): string {
  const raw = rawErrorMessage(error);
  if (!raw) return '采集未完成。';

  if (/browser session is not ready|请先启动并登录领星|not logged in|browser_session_ready/i.test(raw)) {
    return '领星浏览器会话未就绪：请先在本应用完成 ERP 登录，并从 ERP 广告入口进入 Ads 后重试。';
  }

  if (/requires manual verification|page_model_ready/i.test(raw)) {
    return '页面模型仍未放行：请先点击“验证页面”，完成当前日期、店铺、站点下的页面诊断和单报表验证后再采集。';
  }

  if (/diagnostic_evidence_ready|diagnostic evidence|no matching download-center diagnostic/i.test(raw)) {
    return mode === 'download-existing'
      ? '下载并导入已创建报表前，需要先验证当前范围的下载中心页面。请点击“验证页面”，确认日期、店铺、站点和领星页面一致后再下载。'
      : '重新创建报表前，需要先验证当前范围的下载中心页面。请点击“验证页面”，刷新截图、DOM 和页面模型证据后再创建。';
  }

  if (/(missing|not found|缺少|没有|未找到|不存在)/i.test(raw) && /(report|file|path|batch|报表|文件|路径|批次)/i.test(raw)) {
    return mode === 'download-existing'
      ? '当前范围没有可直接下载的已创建报表；本动作不会创建新任务。若你确认领星已经创建完成，请先点击“验证页面”刷新下载中心证据，并确认日期、店铺、站点一致；否则使用“重新创建、下载并导入”。'
      : '重新创建后仍没有拿到可用的真实报表文件。请确认领星 Ads 下载中心可访问、页面模型已验证、日期/店铺/站点正确，再重新创建。';
  }

  if (/timeout|ready|wait/i.test(raw)) {
    return mode === 'download-existing'
      ? '已找到下载流程但没有等到可下载状态。请在领星下载中心确认报表为“已创建/ready/可下载”，再点“下载并导入已创建”。'
      : '报表任务已尝试创建，但没有等到生成完成。请稍后重试，或在领星下载中心确认任务状态。';
  }

  return toUserFacingError(error, '采集未完成。');
}

export function shouldOfferDownloadCenterVerification(message?: string | null): boolean {
  if (!message) return false;
  return /(验证页面|下载中心页面|页面模型|诊断证据|diagnostic evidence|download-center diagnostic|ready 行|报表范围)/i.test(message);
}

function shouldAutoVerifyBeforeCollection(message?: string | null): boolean {
  if (!message) return false;
  return /(需要先验证当前范围的下载中心页面|页面模型仍未放行|诊断证据|diagnostic evidence|download-center diagnostic|no matching download-center diagnostic|下载中心页面模型缺少)/i.test(message);
}

type CollectionDownloadApi = {
  diagnoseLingxingDownloadCenter?: (dateRange: CollectionDateRange) => Promise<any>;
  downloadExistingLingxingReports?: (dateRange: CollectionDateRange, reportTypes: string[]) => Promise<any>;
  collectLingxingReports?: (dateRange: CollectionDateRange) => Promise<any>;
  retryLingxingReport?: (dateRange: CollectionDateRange, reportType: string) => Promise<any>;
};

type CollectionDateRange = {
  start: string;
  end: string;
  storeName?: string;
  marketplaceCode?: string;
};

async function invokeCollectionDownloadAction(input: {
  api: CollectionDownloadApi;
  mode: DownloadCollectionActionMode;
  dateRange: CollectionDateRange;
  targetTypes: string[];
}): Promise<any[]> {
  const { api, mode, dateRange, targetTypes } = input;
  if (mode === 'download-existing') {
    if (!api.downloadExistingLingxingReports) {
      throw new Error('领星已创建报表下载接口未暴露，请检查 preload IPC。');
    }
    return [await api.downloadExistingLingxingReports(dateRange, targetTypes)];
  }
  if (mode === 'recreate-full') {
    if (!api.collectLingxingReports) {
      throw new Error('领星完整报表采集接口未暴露，请检查 preload IPC。');
    }
    return [await api.collectLingxingReports(dateRange)];
  }
  if (!api.retryLingxingReport) {
    throw new Error('领星单报表重建接口未暴露，请检查 preload IPC。');
  }
  const results: any[] = [];
  for (const reportType of targetTypes) {
    results.push(await api.retryLingxingReport(dateRange, reportType));
  }
  return results;
}

export async function runCollectionDownloadAction(input: {
  api: CollectionDownloadApi;
  mode: DownloadCollectionActionMode;
  dateRange: CollectionDateRange;
  targetTypes: string[];
  onAutoVerifyStart?: () => void;
  onDiagnostic?: (diagnostic: any) => void;
  onAutoVerifyReady?: (diagnostic: any) => void;
}): Promise<{ actionResults: any[]; diagnostic?: any; autoVerified: boolean }> {
  try {
    return {
      actionResults: await invokeCollectionDownloadAction(input),
      autoVerified: false,
    };
  } catch (caught) {
    const message = collectionActionError(input.mode, caught);
    if (!shouldAutoVerifyBeforeCollection(message) || !input.api.diagnoseLingxingDownloadCenter) {
      throw caught;
    }

    input.onAutoVerifyStart?.();
    const diagnostic = await input.api.diagnoseLingxingDownloadCenter(input.dateRange);
    input.onDiagnostic?.(diagnostic);
    if (!diagnostic?.ready) {
      const reason = diagnostic?.errorMessage
        || (Array.isArray(diagnostic?.missingRequiredSelectors) && diagnostic.missingRequiredSelectors.length
          ? `缺少关键控件：${diagnostic.missingRequiredSelectors.join('、')}`
          : '页面模型还未匹配当前下载中心');
      throw new Error(`页面验证未通过：${reason}`);
    }

    input.onAutoVerifyReady?.(diagnostic);
    return {
      actionResults: await invokeCollectionDownloadAction(input),
      diagnostic,
      autoVerified: true,
    };
  }
}

function buildLastActionResult(
  mode: CollectionActionMode,
  results: any[],
  realFileCount: number,
  importedRows: number,
  fallbackPaths?: { downloadDir?: string; manifestPath?: string },
): LastActionResult {
  const files = results.flatMap((result) => Array.isArray(result?.files) ? result.files : []);
  const batchIds = Array.from(new Set(results.map((result) => result?.batch?.id).filter(Boolean)));
  const fileFailures = files
    .filter((file) => file?.status === 'failed' || file?.errorMessage)
    .map((file) => ({
      label: String(file?.displayName || file?.reportType || '未知报表'),
      reason: String(file?.errorMessage || '领星未返回可下载文件'),
    }));
  const importFailures = results
    .flatMap((result) => Array.isArray(result?.metricsImport?.errors) ? result.metricsImport.errors : [])
    .map((item) => ({
      label: String(item?.reportType || '导入错误'),
      reason: String(item?.message || item?.error || '真实报表未解析出广告指标行'),
    }));
  const failedFiles = [...fileFailures, ...importFailures];
  const actionDownloadedFiles = files
    .filter((file) => file?.status === 'downloaded' && file?.filePath)
    .filter((file) => isRealReportPath(String(file?.filePath || '')))
    .map((file) => ({
      label: String(file?.displayName || file?.reportType || '未知报表'),
      fileName: String(file?.filePath || '').split(/[\\/]/).filter(Boolean).pop() || String(file?.filePath || ''),
      filePath: String(file?.filePath || ''),
      fileSizeBytes: Number(file?.fileSizeBytes || 0),
    }));
  const metricsImports = results.map((result) => result?.metricsImport).filter(Boolean);
  const insertedRows = metricsImports.reduce((sum, item) => sum + Number(item?.inserted || 0), 0);
  const parsedFiles = metricsImports.reduce((sum, item) => sum + Number(item?.parsedFiles || 0), 0);
  const downloadedCount = realFileCount;
  const actionRealDownloadCount = actionDownloadedFiles.length;
  const failedCount = failedFiles.length;
  const firstBatch = results.find((result) => result?.batch)?.batch;
  const nextStep = failedFiles.length > 0 && actionDownloadedFiles.length === 0
    ? '下一步：查看失败原因和本次采集清单，确认领星 ready 行、页面模型、日期/店铺/站点后再重试。'
    : importedRows > 0
      ? '下一步：进入广告量化，复核 ACOS、花费和订单口径。'
      : realFileCount > 0
        ? '下一步：点击“导入已下载表格”，把本地表格写入广告指标。'
        : '下一步：检查下载中心页面、报表 ready 状态或失败报表后重试。';
  const tone: LastActionResult['tone'] = failedCount > 0
    ? 'blocked'
    : mode === 'import'
      ? importedRows > 0 || insertedRows > 0 ? 'success' : 'blocked'
      : actionRealDownloadCount > 0
        ? importedRows > 0 || insertedRows > 0 ? 'success' : 'warning'
        : 'blocked';

  return {
    title: actionResultTitle(mode, tone),
    tone,
    mode,
    batchIds,
    downloadedCount,
    actionDownloadedFiles,
    failedCount,
    parsedFiles,
    insertedRows,
    currentImportedRows: importedRows,
    downloadDir: firstBatch?.downloadDir || fallbackPaths?.downloadDir,
    manifestPath: firstBatch?.manifestPath || fallbackPaths?.manifestPath,
    nextStep,
    failedFiles,
  };
}

export function collectionCompletionNotice(result: LastActionResult): string {
  if (result.mode === 'import') {
    if (result.currentImportedRows > 0 || result.insertedRows > 0) {
      return `导入完成：解析 ${result.parsedFiles} 个真实报表，写入 ${result.insertedRows} 行广告指标，当前范围共有 ${result.currentImportedRows} 行指标。`;
    }
    return '导入未完成：没有形成可量化的日级广告指标。请检查表头、日期、广告对象和金额/订单列。';
  }

  const actionRealFileCount = result.actionDownloadedFiles.length;
  if (actionRealFileCount > 0 && result.currentImportedRows > 0) {
    return `采集动作已完成：本次新增 ${actionRealFileCount} 个真实原始报表文件，当前范围覆盖 ${result.downloadedCount}/8 类真实报表，已自动导入 ${result.currentImportedRows} 行广告指标。`;
  }
  if (actionRealFileCount > 0) {
    return `真实报表已下载，但自动导入未写入广告指标：本次新增 ${actionRealFileCount} 个真实原始报表文件，当前范围覆盖 ${result.downloadedCount}/8 类真实报表，导入指标 ${result.currentImportedRows} 行。请点击“导入已下载表格”，或检查解析错误。`;
  }
  if (result.downloadedCount > 0 && result.currentImportedRows > 0) {
    return `当前范围已有 ${result.downloadedCount}/8 类真实报表和 ${result.currentImportedRows} 行广告指标，但本次没有新增真实原始报表文件。请打开真实报表目录确认数据来源；不要把本次动作当成新的领星下载。`;
  }
  if (result.downloadedCount > 0) {
    return `当前范围已有 ${result.downloadedCount}/8 类真实报表，但本次没有新增真实原始报表文件，且还没有可量化指标。请点击“导入已下载表格”或重新下载缺失报表。`;
  }
  return `采集动作返回，但当前范围仍未满足量化门槛：真实报表覆盖 ${result.downloadedCount}/8 类，导入指标 ${result.currentImportedRows} 行。没有 xlsx/xls/csv 或解析入库失败时不能进行广告量化。`;
}

export function DataCollectionPage() {
  const { data, error, loading, scope } = useBusinessDataPipeline();
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<RunningCollectionActionMode | null>(null);
  const [lastActionResult, setLastActionResult] = useState<LastActionResult | null>(null);
  const [lastDiagnostic, setLastDiagnostic] = useState<any | null>(null);
  const [collectionMonitorOpen, setCollectionMonitorOpen] = useState(false);
  const collection = data?.collection;
  const reportOptions = collection?.reportOptions || [];
  const realFiles = collection?.realReportFiles || [];
  const fileAudit = collection?.fileAudit;
  const selectedCount = selectedTypes.length;
  const realReportCount = fileAudit?.realReportFileCount ?? realFiles.length;
  const importedRowCount = fileAudit?.importedRowCount ?? reportOptions.reduce((sum, item) => sum + item.importedRows, 0);
  const rejectedEvidenceCount = fileAudit?.rejectedEvidenceFileCount ?? 0;
  const hasOnlyDiagnosticFiles = realReportCount === 0 && rejectedEvidenceCount > 0;
  const latestBatchStatus = collection?.latestBatch?.status || 'missing';
  const availableBatchCount = collection?.availableBatches?.length || collection?.sourceBatchIds?.length || 0;
  const auditEvidencePaths = (collection?.evidencePaths || []).filter((item) => item.kind === 'audit');
  const folderEvidencePaths = (collection?.evidencePaths || []).filter((item) => item.kind === 'folder');
  const primaryReportFolder = dataCollectionFirstViewportReportFolder({
    realReportCount,
    realFiles,
    evidenceFolder: folderEvidencePaths[0]?.path,
    auditDownloadDir: fileAudit?.downloadDir,
  });
  const primaryAuditPath = auditEvidencePaths[0]?.path;
  const visibleRealFiles = realFiles.slice(0, 8);
  const hiddenRealFileCount = Math.max(0, realFiles.length - visibleRealFiles.length);
  const reportSelectionKey = useMemo(() => reportOptions.map((item) => item.type).join('|'), [reportOptions]);
  const missingReportTypes = useMemo(
    () => reportOptions.filter((item) => !item.realFileAvailable).map((item) => item.type),
    [reportOptions],
  );
  const unimportedReportTypes = useMemo(
    () => reportOptions.filter((item) => item.realFileAvailable && item.importedRows === 0).map((item) => item.type),
    [reportOptions],
  );
  const actionProgressSteps = useMemo(
    () => buildActionProgressSteps(runningAction === 'verify-page' ? null : runningAction, lastActionResult),
    [lastActionResult, runningAction],
  );
  const shouldShowVerifyAction = shouldOfferDownloadCenterVerification(actionError);
  const lastActionSummary = useMemo(() => lastActionResult
    ? buildCollectionActionSummary({
      mode: lastActionResult.mode,
      tone: lastActionResult.tone,
      currentRealReportCount: lastActionResult.downloadedCount,
      actionRealFileCount: lastActionResult.actionDownloadedFiles.length,
      parsedFiles: lastActionResult.parsedFiles,
      insertedRows: lastActionResult.insertedRows,
      currentImportedRows: lastActionResult.currentImportedRows,
      failedCount: lastActionResult.failedCount,
      downloadDir: lastActionResult.downloadDir,
      manifestPath: lastActionResult.manifestPath,
    })
    : null, [lastActionResult]);
  const downloadExistingGuide = collectionActionGuide('download-existing');
  const recreateSelectedGuide = collectionActionGuide('recreate-selected');
  const recreateFullGuide = collectionActionGuide('recreate-full');
  const importGuide = collectionActionGuide('import');
  const dataLedger = useMemo(
    () => buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions,
      realReportFileCount: realReportCount,
      importedRowCount,
      rejectedEvidenceFileCount: rejectedEvidenceCount,
    }),
    [importedRowCount, realReportCount, rejectedEvidenceCount, reportOptions],
  );
  const taskState = buildDataCollectionTaskState({
    realReportCount,
    importedRowCount,
    primaryReportFolder,
    runningAction,
  });
  const collectionMonitorState = buildCollectionMonitorState({
    runningAction,
    actionNotice,
    actionError,
    lastActionResult,
    lastDiagnostic,
    realReportCount,
    importedRowCount,
  });
  const collectionMonitorEvidencePath = lastActionSummary?.primaryPath
    || lastActionResult?.manifestPath
    || lastActionResult?.downloadDir
    || lastDiagnostic?.screenshotPath
    || lastDiagnostic?.domSnapshotPath;

  useEffect(() => {
    const validTypes = new Set(reportOptions.map((item) => item.type));
    setSelectedTypes((current) => {
      const validSelection = current.filter((type) => validTypes.has(type));
      if (validSelection.length > 0) return validSelection;
      return reportOptions.map((item) => item.type);
    });
  }, [reportSelectionKey]);

  useEffect(() => {
    if (reportOptions.length === 0) {
      setSelectedTypes([]);
    }
  }, [reportOptions.length]);

  function toggleReport(type: string) {
    setSelectedTypes((current) => (
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type]
    ));
  }

  async function openPath(targetPath: string) {
    try {
      await (window as any).electronAPI?.openReportPath?.(targetPath);
      setActionError(null);
      setActionNotice(`已请求打开：${compactPath(targetPath)}`);
    } catch (caught) {
      setActionError(toUserFacingError(caught, '打开路径失败。'));
      setActionNotice('打开路径失败。');
    }
  }

  function navigateToAdQuant() {
    window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'ad-quant' }));
  }

  async function runVerifyDownloadCenter() {
    const api = (window as any).electronAPI;
    const dateRange = {
      start: scope.dateFrom,
      end: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
    };
    setActionError(null);
    setLastActionResult(null);
    setRunningAction('verify-page');
    setCollectionMonitorOpen(true);
    setActionNotice('正在验证当前范围的领星下载中心页面，系统会刷新截图、DOM 和页面模型证据。');
    try {
      if (!api?.diagnoseLingxingDownloadCenter) {
        throw new Error('领星下载中心验证接口未暴露，请检查 preload IPC。');
      }
      const diagnostic = await api.diagnoseLingxingDownloadCenter(dateRange);
      setLastDiagnostic(diagnostic);
      const evidencePath = diagnostic?.screenshotPath || diagnostic?.domSnapshotPath;
      const evidenceText = evidencePath ? ` 证据：${compactPath(evidencePath)}` : '';
      if (diagnostic?.ready) {
        setActionNotice(`页面验证通过：当前范围、页面和关键控件已刷新，可以重新获取完整 8 类报表。${evidenceText}`);
        return;
      }
      const reason = diagnostic?.errorMessage
        || (Array.isArray(diagnostic?.missingRequiredSelectors) && diagnostic.missingRequiredSelectors.length
          ? `缺少关键控件：${diagnostic.missingRequiredSelectors.join('、')}`
          : '页面模型还未匹配当前下载中心');
      setActionNotice('页面验证已返回，但当前页面仍不能安全创建报表。');
      setActionError(`页面验证未通过：${reason}。请确认已从 ERP 广告入口进入下载中心，并且日期、店铺、站点与当前范围一致。${evidenceText}`);
    } catch (caught) {
      setLastDiagnostic(null);
      setActionError(toUserFacingError(caught, '验证页面未完成。'));
      setActionNotice('验证页面未完成。');
    } finally {
      setRunningAction(null);
    }
  }

  async function runDownloadAction(mode: 'download-existing' | 'recreate-selected' | 'recreate-full') {
    const api = (window as any).electronAPI;
    const targetTypes = mode === 'recreate-full' ? reportOptions.map((item) => item.type) : selectedTypes;
    const selectedLabels = reportOptions
      .filter((item) => targetTypes.includes(item.type))
      .map((item) => item.label);
    const dateRange = {
      start: scope.dateFrom,
      end: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
    };
    setActionError(null);
    setLastActionResult(null);
    setLastDiagnostic(null);
    setRunningAction(mode);
    setCollectionMonitorOpen(true);
    if (mode === 'download-existing') {
      setActionNotice(`正在下载并自动导入领星下载中心已创建完成的已选报表，不会创建新任务：${selectedLabels.join('、')}`);
    } else {
      setActionNotice(`${mode === 'recreate-full' ? '正在重新创建全部 8 类报表、下载并自动导入' : '正在重新创建已选报表、下载并自动导入'}：${selectedLabels.join('、')}`);
    }
    try {
      const { actionResults } = await runCollectionDownloadAction({
        api,
        mode,
        dateRange,
        targetTypes,
        onAutoVerifyStart: () => {
          setRunningAction('verify-page');
          setActionNotice('当前范围缺少下载中心验证证据，正在自动验证页面，验证通过后会继续创建并下载报表。');
        },
        onDiagnostic: (diagnostic) => {
          setLastDiagnostic(diagnostic);
        },
        onAutoVerifyReady: () => {
          setRunningAction(mode);
          setActionNotice(mode === 'download-existing'
            ? `页面验证通过，继续下载并自动导入已创建报表：${selectedLabels.join('、')}`
            : `${mode === 'recreate-full' ? '页面验证通过，继续重新创建全部 8 类报表、下载并自动导入' : '页面验证通过，继续重新创建已选报表、下载并自动导入'}：${selectedLabels.join('、')}`);
        },
      });
      const refreshed = await api.getBusinessUiDataPipeline?.(scope);
      window.dispatchEvent(new Event('business-ui:data-updated'));
      const realFileCount = refreshed?.collection?.realReportFiles?.length ?? 0;
      const importedRows = refreshed?.collection?.fileAudit?.importedRowCount ?? refreshed?.quant?.importedRows ?? 0;
      const actionResult = buildLastActionResult(mode, actionResults, realFileCount, importedRows, {
        downloadDir: refreshed?.collection?.fileAudit?.downloadDir,
        manifestPath: refreshed?.collection?.fileAudit?.manifestPath,
      });
      setLastActionResult(actionResult);
      setActionNotice(collectionCompletionNotice(actionResult));
    } catch (caught) {
      const message = collectionActionError(mode, caught);
      setActionError(message);
      setActionNotice(mode === 'download-existing'
        ? '下载并导入已创建报表未完成。请先确认领星下载中心已有当前范围的已创建/可下载报表。'
        : '创建并下载未完成。请根据错误处理登录、页面模型或报表范围后重试。');
    } finally {
      setRunningAction(null);
    }
  }

  async function importCurrentReports() {
    const api = (window as any).electronAPI;
    setActionError(null);
    setLastActionResult(null);
    setLastDiagnostic(null);
    setRunningAction('import');
    setCollectionMonitorOpen(true);
    setActionNotice('正在导入当前范围已下载的真实原始报表...');
    try {
      if (!api?.importCurrentBusinessReports) {
        throw new Error('真实报表导入接口未暴露，请检查 preload IPC。');
      }
      const result = await api.importCurrentBusinessReports(scope);
      window.dispatchEvent(new Event('business-ui:data-updated'));
      const inserted = result?.metricsImport?.inserted ?? 0;
      const parsedFiles = result?.metricsImport?.parsedFiles ?? 0;
      const errors = result?.metricsImport?.errors?.length ?? 0;
      const realFileCount = result?.pipeline?.collection?.fileAudit?.realReportFileCount ?? result?.pipeline?.collection?.realReportFiles?.length ?? realReportCount;
      const importedRows = result?.pipeline?.collection?.fileAudit?.importedRowCount ?? result?.pipeline?.quant?.importedRows ?? inserted;
      setLastActionResult(buildLastActionResult('import', [result], realFileCount, importedRows, {
        downloadDir: result?.pipeline?.collection?.fileAudit?.downloadDir,
        manifestPath: result?.pipeline?.collection?.fileAudit?.manifestPath,
      }));
      if (importedRows <= 0 || inserted <= 0 || errors > 0) {
        const reason = errors > 0
          ? `有 ${errors} 个报表解析失败`
          : '没有写入任何广告指标行';
        setActionError(`真实报表导入未形成可量化广告数据：${reason}。请检查表头、日期、广告活动/广告组/关键词/投放对象和花费/订单/销售列。`);
        setActionNotice(`导入未完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标，错误 ${errors} 个。`);
        return;
      }
      setActionNotice(`导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标，错误 ${errors} 个。`);
    } catch (caught) {
      const message = toUserFacingError(caught, '真实报表导入未完成。');
      setActionError(message);
      setActionNotice('真实报表导入未完成。');
    } finally {
      setRunningAction(null);
    }
  }

  async function importLocalReports() {
    const api = (window as any).electronAPI;
    setActionError(null);
    setLastActionResult(null);
    setLastDiagnostic(null);
    setRunningAction('import');
    setCollectionMonitorOpen(true);
    setActionNotice('请选择本地已有的领星原始广告表格，系统会复制到当前范围批次目录并导入。');
    try {
      if (!api?.importLocalBusinessReportFiles) {
        throw new Error('本地真实报表导入接口未暴露，请检查 preload IPC。');
      }
      const result = await api.importLocalBusinessReportFiles(scope);
      if (result?.cancelled) {
        setActionNotice('已取消本地报表选择。');
        return;
      }
      window.dispatchEvent(new Event('business-ui:data-updated'));
      const inserted = result?.metricsImport?.inserted ?? 0;
      const parsedFiles = result?.metricsImport?.parsedFiles ?? 0;
      const errors = result?.metricsImport?.errors?.length ?? 0;
      const realFileCount = result?.pipeline?.collection?.realReportFiles?.length ?? result?.files?.length ?? 0;
      const importedRows = result?.pipeline?.collection?.fileAudit?.importedRowCount ?? result?.pipeline?.quant?.importedRows ?? inserted;
      setLastActionResult(buildLastActionResult('import', [result], realFileCount, importedRows, {
        downloadDir: result?.pipeline?.collection?.fileAudit?.downloadDir || result?.batch?.downloadDir,
        manifestPath: result?.pipeline?.collection?.fileAudit?.manifestPath || result?.batch?.manifestPath,
      }));
      if (importedRows <= 0 || inserted <= 0 || errors > 0) {
        const reason = errors > 0
          ? `有 ${errors} 个本地报表解析失败`
          : '没有写入任何广告指标行';
        setActionError(`本地真实报表导入未形成可量化广告数据：${reason}。请检查文件名是否能识别报表类型、表头和日期范围。`);
        setActionNotice(`本地导入未完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标，错误 ${errors} 个。`);
        return;
      }
      setActionNotice(`本地导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标，错误 ${errors} 个。`);
    } catch (caught) {
      const message = toUserFacingError(caught, '本地真实报表导入未完成。');
      setActionError(message);
      setActionNotice('本地真实报表导入未完成。');
    } finally {
      setRunningAction(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title="数据采集"
        description="展示当前采集状态、8 类领星广告报表进度、真实原始文件和导入行数。审计文件、截图和页面存档不计为真实报表文件。"
        primaryTask="拿到真实原始报表"
        nextAction="确认文件存在后再导入量化"
      />

      <div className="business-stack">
        <OperatorTaskPanel
          eyebrow="当前任务"
          title={taskState.title}
          detail={taskState.detail}
          primaryAction={{
            label: taskState.primaryActionLabel,
            disabled: Boolean(runningAction),
            onClick: taskState.isComplete ? navigateToAdQuant : () => runDownloadAction('recreate-full'),
          }}
          secondaryActions={[
            {
              label: taskState.secondaryActionLabel,
              disabled: Boolean(runningAction),
              onClick: primaryReportFolder ? () => openPath(primaryReportFolder) : importLocalReports,
            },
          ]}
        >
          {loading && <p className="muted-line">正在读取采集状态...</p>}
          {error && <p className="blocked-line">读取接口异常：{error}</p>}
        </OperatorTaskPanel>

        {collectionMonitorOpen && collectionMonitorState && (
          <CollectionMonitorDrawer
            evidencePath={collectionMonitorEvidencePath}
            onClose={() => setCollectionMonitorOpen(false)}
            state={collectionMonitorState}
            steps={actionProgressSteps}
          />
        )}

        {(runningAction || actionNotice || actionError) && (
          <div
            className={`collection-action-feedback ${actionError ? 'collection-action-feedback-blocked' : runningAction ? 'collection-action-feedback-running' : 'collection-action-feedback-ready'}`}
            aria-live="polite"
          >
            <div>
              <span>{runningAction ? '动作已触发' : actionError ? '动作未完成' : '最近动作'}</span>
              <strong>{runningAction ? actionModeLabel(runningAction) : actionNotice || '采集动作已返回'}</strong>
              {runningAction && <p>系统正在处理当前范围，请不要切换日期、店铺、站点或批次。</p>}
              {!runningAction && actionError && <p>{actionError}</p>}
            </div>
            <div className="collection-action-feedback-side">
              {runningAction && <StatusPill tone="pending">处理中</StatusPill>}
              {!runningAction && actionError && <StatusPill tone="blocked">需处理</StatusPill>}
              {!runningAction && !actionError && <StatusPill tone="ready">已返回</StatusPill>}
              {!runningAction && shouldShowVerifyAction && (
                <div className="collection-action-feedback-actions">
                  <button className="primary-button" onClick={runVerifyDownloadCenter} type="button">验证页面</button>
                  <button className="secondary-button" onClick={() => runDownloadAction('recreate-full')} type="button">重试获取 8 类</button>
                </div>
              )}
              {!runningAction && !actionError && lastDiagnostic?.ready && (
                <div className="collection-action-feedback-actions">
                  <button className="primary-button" onClick={() => runDownloadAction('recreate-full')} type="button">重新获取完整 8 类报表</button>
                </div>
              )}
            </div>
          </div>
        )}

        {primaryReportFolder && (
          <Panel title="真实报表目录" tone="success">
            <div className="business-split">
              <div>
                <div className="business-scope-line">{compactPath(primaryReportFolder)}</div>
                <p className="muted-line">这里只放当前范围可用于后续量化的 Lingxing xlsx/xls/csv 原始报表。</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone="ready">{collectionStatusLabel(collection?.status)}</StatusPill>
                <button className="secondary-button" onClick={() => openPath(primaryReportFolder)} type="button">打开报表目录</button>
              </div>
            </div>
          </Panel>
        )}

        <ProgressiveDetails title="当前范围数据账本">
          <Panel title="当前范围数据账本" tone={dataLedger.status === 'ready' ? 'success' : dataLedger.status === 'partial' ? 'warning' : 'blocked'}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">{dataLedger.headline}</div>
                <p className="muted-line">{dataLedger.detail}</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={dataLedger.status === 'ready' ? 'ready' : 'blocked'}>{dataLedger.nextAction}</StatusPill>
              </div>
            </div>
            {dataLedger.gaps.length > 0 && (
              <div className="evidence-card-grid">
                {dataLedger.gaps.slice(0, 4).map((gap) => (
                  <div className="evidence-card" key={gap}>
                    <span>待处理缺口</span>
                    <strong>{gap}</strong>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="数据流程四段闭环">
          <Panel title="数据流程四段闭环" tone={dataLedger.status === 'ready' ? 'success' : dataLedger.status === 'partial' ? 'warning' : 'blocked'}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">系统只在四段都闭合后放行广告量化、AI 证据包和优化建议。</div>
                <p className="muted-line">批次号和审计文件只用于追溯；运营判断看这四段是否完成。</p>
              </div>
              <StatusPill tone={dataLedger.status === 'ready' ? 'ready' : dataLedger.status === 'partial' ? 'pending' : 'blocked'}>
                {dataLedger.status === 'ready' ? '可进入建议' : '未放行建议'}
              </StatusPill>
            </div>
            <div className="collection-progress-grid">
              {dataLedger.stages.map((stage, index) => (
                <div className={readinessStageClass(stage.status)} key={stage.key}>
                  <span>第 {index + 1} 步</span>
                  <strong>{stage.title}</strong>
                  <p>{stage.value}</p>
                  <p>{stage.detail}</p>
                  <StatusPill tone={readinessStageTone(stage.status)}>{readinessStageLabel(stage.status)}</StatusPill>
                </div>
              ))}
            </div>
            <p className="warning-line">审计文件、截图、DOM/HTML 和采集清单只证明流程，不是广告数据，不能参与花费、订单或 ACOS 计算。</p>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="真实报表文件检查">
          <Panel title="真实报表文件检查" tone={realReportCount ? 'default' : 'blocked'}>
            <div className="business-grid business-grid-four">
              <div className="metric-tile">
                <span>数据批次</span>
                <strong>{availableBatchCount > 0 ? `${availableBatchCount} 个匹配批次` : collection?.latestBatch ? '已匹配批次' : '未匹配'}</strong>
                <small>{collection?.latestBatch ? reportStatusLabel(latestBatchStatus) : '按当前范围自动匹配'}</small>
              </div>
              <div className="metric-tile">
                <span>本地真实报表已下载</span>
                <strong>{realReportCount}/8</strong>
                <small>仅 .xlsx/.xls/.csv</small>
              </div>
              <div className="metric-tile">
                <span>已导入广告指标</span>
                <strong>{importedRowCount}</strong>
                <small>行</small>
              </div>
              <div className="metric-tile">
                <span>审计/诊断文件</span>
                <strong>{rejectedEvidenceCount}</strong>
                <small>不计入报表</small>
              </div>
            </div>
            {hasOnlyDiagnosticFiles && (
              <p className="blocked-line">当前文件夹只有诊断/审计文件，没有真实广告报表。系统不能进行广告量化。</p>
            )}
            <p className="warning-line">审计文件、截图、DOM/HTML 和采集清单只用于证明流程，不是广告数据，不能进入广告量化。</p>
            {(fileAudit?.missingReportLabels?.length || 0) > 0 && (
              <p className="muted-line">
                缺少真实报表：{fileAudit?.missingReportLabels.slice(0, 8).join('、')}
              </p>
            )}
            <div className="action-row">
              {fileAudit?.downloadDir && (
                <button className="secondary-button" onClick={() => openPath(fileAudit.downloadDir!)} type="button">打开真实报表目录</button>
              )}
              {fileAudit?.manifestPath && (
                <button className="secondary-button" onClick={() => openPath(fileAudit.manifestPath!)} type="button">打开采集清单</button>
              )}
              <button
                className="primary-button"
                disabled={realReportCount === 0 || Boolean(runningAction)}
                onClick={importCurrentReports}
                type="button"
              >
                {runningAction === 'import' ? '正在导入...' : '导入已下载表格'}
              </button>
              <button
                className="secondary-button"
                disabled={Boolean(runningAction)}
                onClick={importLocalReports}
                type="button"
              >
                导入本地报表
              </button>
            </div>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="文件位置与用途">
          <Panel title="文件位置与用途" tone={realReportCount ? 'success' : 'warning'}>
            <div className="context-summary-grid">
              <div>
                <span>真实广告表格</span>
                <strong>{primaryReportFolder || '暂无目录'}</strong>
                <p>这里应能看到 Lingxing 下载的 xlsx/xls/csv，后续广告量化只读取这些文件。</p>
              </div>
              <div>
                <span>采集清单</span>
                <strong>{fileAudit?.manifestPath || '暂无采集清单'}</strong>
                <p>记录批次、文件名、状态和下载结果，用来追溯，不是广告数据表。</p>
              </div>
              <div>
                <span>验收/诊断证据</span>
                <strong>{primaryAuditPath || `${rejectedEvidenceCount} 个证据文件`}</strong>
                <p>这里只放审计文件、截图、HTML 等证据；找广告数据请打开“真实广告表格”目录。</p>
              </div>
              <div>
                <span>量化入口</span>
                <strong>{importedRowCount > 0 ? `${importedRowCount} 行可用` : '未导入'}</strong>
                <p>{realReportCount > 0 ? '先确认表格存在；若没有入库指标，再点击“导入已下载表格”。' : '先下载并导入已创建报表、重新创建下载并导入，或导入本地报表。'}</p>
              </div>
            </div>
            <div className="action-row">
              {primaryReportFolder && (
                <button className="secondary-button" onClick={() => openPath(primaryReportFolder)} type="button">打开真实报表目录</button>
              )}
              {fileAudit?.manifestPath && (
                <button className="secondary-button" onClick={() => openPath(fileAudit.manifestPath!)} type="button">打开采集清单</button>
              )}
              {primaryAuditPath && (
                <button className="secondary-button" onClick={() => openPath(primaryAuditPath)} type="button">打开审计证据</button>
              )}
            </div>
            <div className="real-file-summary">
              <div className="real-file-summary-header">
                <strong>当前真实报表清单</strong>
                <span>{realFiles.length ? `${realReportCount}/8 类，${importedRowCount} 行已导入` : '暂无 xlsx/xls/csv 文件'}</span>
              </div>
              {realFiles.length ? (
                <div className="real-file-chip-grid">
                  {visibleRealFiles.map((file) => (
                    <button className="real-file-chip" key={file.id} onClick={() => openPath(file.filePath)} type="button">
                      <span>{file.displayName}</span>
                      <strong>{file.fileName}</strong>
                      <small>{getFileExtension(file.fileName, file.filePath)} / {file.importedRows} 行</small>
                    </button>
                  ))}
                  {hiddenRealFileCount > 0 && (
                    <div className="real-file-chip real-file-chip-muted">
                      <span>更多文件</span>
                      <strong>+{hiddenRealFileCount}</strong>
                      <small>底部完整表格可查看全部路径</small>
                    </div>
                  )}
                </div>
              ) : (
                <p className="blocked-line">当前没有真实广告报表。请先下载并导入已创建报表，或重新创建、下载并导入 8 类报表；只有审计包时系统不能量化广告。</p>
              )}
            </div>
          </Panel>
        </ProgressiveDetails>

        <Panel title="8 类报表选择与进度">
          <div className="selection-toolbar">
            <div>
              <strong>选择要创建/下载的报表：已选 {selectedCount}/{reportOptions.length}</strong>
              <p>下载和重新创建只作用于当前勾选的报表；清空后不会自动恢复全选。</p>
            </div>
            <div className="table-action-row">
              <button className="secondary-button compact-button" onClick={() => setSelectedTypes(reportOptions.map((item) => item.type))} type="button">
                全选 8 类
              </button>
              <button className="secondary-button compact-button" disabled={missingReportTypes.length === 0} onClick={() => setSelectedTypes(missingReportTypes)} type="button">
                只选缺失报表
              </button>
              <button className="secondary-button compact-button" disabled={unimportedReportTypes.length === 0} onClick={() => setSelectedTypes(unimportedReportTypes)} type="button">
                只选未导入
              </button>
              <button className="secondary-button compact-button" disabled={selectedCount === 0} onClick={() => setSelectedTypes([])} type="button">
                清空
              </button>
            </div>
          </div>
          <MicroStepper
            items={reportOptions.map((item) => ({
              label: item.label,
              meta: item.importedRows > 0 ? `${item.importedRows} 行` : item.realFileAvailable ? '待入库' : reportStatusLabel(item.status),
              detail: item.realFileAvailable
                ? '原始 xlsx/xls/csv 已留存；后续量化只读取这些真实表格。'
                : '等待领星下载中心生成，或通过本地导入补齐。',
              tone: reportOptionTone(item),
            }))}
          />
          <div className="report-option-grid">
            {reportOptions.map((item) => (
              <label className={`report-option ${item.realFileAvailable ? 'report-option-ready' : ''}`} key={item.type}>
                <input
                  checked={selectedTypes.includes(item.type)}
                  onChange={() => toggleReport(item.type)}
                  type="checkbox"
                />
                <span>{item.label}</span>
                <strong>{item.realFileAvailable ? '有真实文件' : '缺真实文件'}</strong>
                <small>{item.importedRows} 行导入 / {item.status}</small>
              </label>
            ))}
          </div>
          <div className="collection-action-grid">
            <button
              className="collection-action-button secondary-action"
              disabled={selectedCount === 0 || Boolean(runningAction)}
              onClick={() => runDownloadAction('download-existing')}
              type="button"
            >
              <span>{runningAction === 'download-existing' ? '正在下载...' : collectionActionButtonLabel('download-existing')}</span>
              <small>{collectionActionButtonDetail('download-existing')}</small>
            </button>
            <button
              className="collection-action-button secondary-action"
              disabled={selectedCount === 0 || Boolean(runningAction)}
              onClick={() => runDownloadAction('recreate-selected')}
              type="button"
            >
              <span>{runningAction === 'recreate-selected' ? '正在重建...' : collectionActionButtonLabel('recreate-selected')}</span>
              <small>{collectionActionButtonDetail('recreate-selected')}</small>
            </button>
            <button
              className="collection-action-button primary-action"
              disabled={Boolean(runningAction)}
              onClick={() => runDownloadAction('recreate-full')}
              type="button"
            >
              <span>{runningAction === 'recreate-full' ? '正在重建全部 8 类...' : collectionActionButtonLabel('recreate-full')}</span>
              <small>{collectionActionButtonDetail('recreate-full')}</small>
            </button>
            <button
              className="collection-action-button secondary-action"
              disabled={Boolean(runningAction)}
              onClick={importLocalReports}
              type="button"
            >
              <span>{runningAction === 'import' ? '正在导入...' : collectionActionButtonLabel('import')}</span>
              <small>{collectionActionButtonDetail('import')}</small>
            </button>
          </div>
          <ProgressiveDetails title="报表动作说明">
            <div className="context-summary-grid">
              {[
                { mode: 'download-existing' as const, guide: downloadExistingGuide },
                { mode: 'recreate-selected' as const, guide: recreateSelectedGuide },
                { mode: 'recreate-full' as const, guide: recreateFullGuide },
                { mode: 'import' as const, guide: importGuide },
              ].map((item) => (
                <div key={item.mode}>
                  <span>{collectionActionButtonLabel(item.mode)}</span>
                  <strong>{item.guide.whenToUse}</strong>
                  <p>{item.guide.taskEffect}；{item.guide.result}</p>
                </div>
              ))}
            </div>
            <p className="muted-line">动作区别：下载已创建只读取 ready 行且不会创建新任务；重建已选只为勾选报表创建任务；重建全部 8 类会刷新完整报表；导入本地不访问领星下载中心。</p>
          </ProgressiveDetails>
          {actionProgressSteps.length > 0 && (
            <div className="collection-progress-panel" aria-label="采集动作进度">
              <div className="collection-progress-header">
                <strong>{runningAction ? `正在执行：${actionModeLabel(runningAction)}` : '最近动作进度'}</strong>
                <span>{lastActionResult ? lastActionResult.nextStep : '请保持领星页面和当前范围一致，动作完成前不要切换日期、店铺或站点。'}</span>
              </div>
              <MicroStepper
                items={actionProgressSteps.map((step) => ({
                  label: step.label,
                  meta: step.status === 'ready' ? '已完成' : step.status === 'blocked' ? '阻断' : '进行中',
                  detail: step.description,
                  tone: step.status,
                }))}
              />
            </div>
          )}
        </Panel>

        {lastActionResult && (
          <Panel title="本次动作结果" tone={lastActionResult.tone}>
            {lastActionSummary && (
              <div className="evidence-check-panel">
                <div className="business-split">
                  <div>
                    <h3>动作结果摘要</h3>
                    <p className={lastActionSummary.tone === 'blocked' ? 'blocked-line' : 'muted-line'}>
                      {lastActionSummary.headline}
                    </p>
                  </div>
                  <StatusPill tone={lastActionSummary.tone}>{lastActionSummary.statusLabel}</StatusPill>
                </div>
                <div className="context-summary-grid">
                  <div>
                    <span>真实数据状态</span>
                    <strong>{lastActionSummary.facts.slice(0, 2).join(' / ')}</strong>
                    <p>{lastActionSummary.blockers.length ? lastActionSummary.blockers.join('；') : '真实报表和 DB 指标已闭合。'}</p>
                  </div>
                  <div>
                    <span>导入状态</span>
                    <strong>{lastActionSummary.facts.slice(2).join(' / ')}</strong>
                    <p>{lastActionSummary.nextAction}</p>
                  </div>
                  <div>
                    <span>证据位置</span>
                    <strong>{lastActionSummary.primaryPathLabel}</strong>
                    <p>{lastActionSummary.primaryPath || '暂无可打开路径，请查看失败原因。'}</p>
                  </div>
                </div>
                {lastActionSummary.primaryPath && (
                  <div className="action-row">
                    <button className="secondary-button" onClick={() => openPath(lastActionSummary.primaryPath!)} type="button">
                      打开动作证据位置
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="business-split">
              <div>
                <div className="business-scope-line">{lastActionResult.title}</div>
                <p className="muted-line">
                  批次：{lastActionResult.batchIds.length ? lastActionResult.batchIds.join('、') : '本地导入'}
                </p>
                <p className={lastActionResult.tone === 'blocked' ? 'blocked-line' : 'muted-line'}>
                  {lastActionResult.nextStep}
                </p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={lastActionResult.downloadedCount > 0 ? 'ready' : 'blocked'}>当前范围覆盖 {lastActionResult.downloadedCount}/8 类</StatusPill>
                <StatusPill tone={lastActionResult.actionDownloadedFiles.length > 0 ? 'ready' : 'pending'}>
                  {lastActionResult.mode === 'import' ? '本次真实导入表格' : '本次新增真实下载'} {lastActionResult.actionDownloadedFiles.length}
                </StatusPill>
                <StatusPill tone={lastActionResult.parsedFiles > 0 ? 'ready' : 'pending'}>本次解析 {lastActionResult.parsedFiles} 表</StatusPill>
                <StatusPill tone={lastActionResult.insertedRows > 0 ? 'ready' : 'pending'}>本次写入 {lastActionResult.insertedRows} 行</StatusPill>
                <StatusPill tone={lastActionResult.failedCount > 0 ? 'blocked' : 'ready'}>失败 {lastActionResult.failedCount}</StatusPill>
                <StatusPill tone={lastActionResult.currentImportedRows > 0 ? 'ready' : 'pending'}>当前指标 {lastActionResult.currentImportedRows} 行</StatusPill>
              </div>
            </div>
            {(lastActionResult.downloadDir || lastActionResult.manifestPath || primaryReportFolder) && (
              <div className="action-row">
                {lastActionResult.downloadDir && (
                  <button className="secondary-button" onClick={() => openPath(lastActionResult.downloadDir!)} type="button">
                    {lastActionResult.mode === 'import' ? '打开本次导入目录' : '打开本次下载目录'}
                  </button>
                )}
                {lastActionResult.manifestPath && (
                  <button className="secondary-button" onClick={() => openPath(lastActionResult.manifestPath!)} type="button">打开本次采集清单</button>
                )}
                {primaryReportFolder && (
                  <button className="secondary-button" onClick={() => openPath(primaryReportFolder)} type="button">打开当前真实报表目录</button>
                )}
              </div>
            )}
            {lastActionResult.actionDownloadedFiles.length > 0 && (
              <div className="result-file-list">
                <div className="real-file-summary-header">
                  <strong>{lastActionResult.mode === 'import' ? '本次真实导入表格' : '本次真实下载表格'}</strong>
                  <span>{lastActionResult.actionDownloadedFiles.length} 个 xlsx/xls/csv</span>
                </div>
                <div className="real-file-chip-grid">
                  {lastActionResult.actionDownloadedFiles.map((file) => (
                    <button className="real-file-chip" key={file.filePath} onClick={() => openPath(file.filePath)} type="button">
                      <span>{file.label}</span>
                      <strong>{file.fileName}</strong>
                      <small>{formatFileSize(file.fileSizeBytes)} / 点击打开表格</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {lastActionResult.actionDownloadedFiles.length === 0 && lastActionResult.failedFiles.length === 0 && (
              <p className={lastActionResult.downloadedCount > 0 ? 'warning-line' : 'blocked-line'}>
                {lastActionResult.downloadedCount > 0
                  ? '当前范围已有真实报表，但本次动作没有新增真实下载文件。请点击“打开当前真实报表目录”确认文件，或直接导入已下载报表。'
                  : lastActionResult.mode === 'import'
                    ? '本次导入没有返回真实报表文件路径。请重新选择领星 xlsx/xls/csv 原始报表，不要选择审计包。'
                    : '本次动作没有返回真实报表文件路径。请打开本次采集清单核对文件路径，只有 xlsx/xls/csv 才能进入量化。'}
              </p>
            )}
            {lastActionResult.failedFiles.length > 0 && (
              <ul className="business-list">
                {lastActionResult.failedFiles.map((file) => (
                  <li key={`${file.label}-${file.reason}`}>{file.label}：{file.reason}</li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <ProgressiveDetails title="真实原始报表文件">
          <Panel title="真实原始报表文件" tone={realFiles.length ? 'default' : 'blocked'}>
            <div className="table-wrap">
              <table className="business-table">
                <thead>
                  <tr>
                    <th>报表类型</th>
                    <th>文件路径</th>
                    <th>扩展名</th>
                    <th>文件大小</th>
                    <th>文件指纹</th>
                    <th>入库状态</th>
                    <th>DB 指标行数</th>
                    <th>最近入库</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {realFiles.map((file) => (
                    <tr key={file.id}>
                      <td>{file.displayName}</td>
                      <td><code>{file.filePath}</code></td>
                      <td><code>{getFileExtension(file.fileName, file.filePath)}</code></td>
                      <td>{formatFileSize(file.fileSizeBytes)}</td>
                      <td><code>{shortHash(file.fileHash)}</code></td>
                      <td>
                        <span>{file.importedRows > 0 ? '已入库' : file.importError ? '导入失败' : '未入库'}</span>
                        {file.importError && <div className="blocked-line table-subtext">{file.importError}</div>}
                      </td>
                      <td>{file.importedRows}</td>
                      <td>{formatUpdatedAt(file.lastImportedAt || file.updatedAt)}</td>
                      <td>{reportStatusLabel(file.status)}</td>
                      <td>
                        <div className="table-action-row">
                          <button className="secondary-button compact-button" onClick={() => openPath(file.filePath)} type="button">打开文件</button>
                          <button className="secondary-button compact-button" onClick={() => openPath(file.folderPath)} type="button">打开文件夹</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!realFiles.length && (
                    <tr>
                      <td colSpan={10}>{hasOnlyDiagnosticFiles ? '当前文件夹只有诊断/审计文件，没有真实广告报表。系统不能进行广告量化。' : '当前范围还没有可量化的真实广告数据'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="验收审计/技术细节">
          <div>
            <p>数据库可读：{collection?.audit.databaseReady ? '是' : '否'}</p>
            <p>计为真实报表：{collection?.audit.acceptedExtensions.join(', ') || '.xlsx, .xls, .csv'}</p>
            <p>不计为真实报表：{collection?.audit.rejectedEvidenceExtensions.join(', ') || '.json, .png, .html'}</p>
            <ul className="business-list">
              {(collection?.audit.notes || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {(collection?.blockers || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </ProgressiveDetails>
      </div>
    </div>
  );
}
