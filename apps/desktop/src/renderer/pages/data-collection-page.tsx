import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  missionControlContextKey,
  type LingxingCollectionJobSnapshot,
  type LingxingCollectionProgressEvent,
  type LingxingCollectionReportCheckpoint,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { DEFAULT_BUSINESS_REPORT_OPTIONS, useBusinessDataPipeline } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { KpiCard, MicroStepper, PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { buildDataReadinessLedger, type DataReadinessLedger } from '../data-readiness-ledger';
import {
  buildProductionCollectionLineageReadiness,
  type ProductionCollectionReportBinding,
} from '../lingxing-collection-lineage';
import { useMissionControlStoreContext } from '../mission-control/store-context';
import type { AppRoute, BusinessReportFile } from '../types';
import { toUserFacingError } from '../user-facing-error';

type CollectionActionMode = 'download-existing' | 'recreate-selected' | 'recreate-full' | 'import';
type DownloadCollectionActionMode = Exclude<CollectionActionMode, 'import'>;
type RunningCollectionActionMode = CollectionActionMode | 'verify-page';
type CollectionFeedbackActionGroup = 'repair' | 'refresh-ready';

const SAFE_COLLECTION_REQUEST_PART = /[^A-Za-z0-9._:-]+/g;
const COLLECTION_REPORT_LABELS: Record<string, string> = {
  campaign: '广告活动报告',
  ad_group: '广告组报告',
  placement: '广告位报告',
  advertised_product: '广告商品报告',
  auto_targeting: '自动投放报告',
  keyword: '关键词报告',
  product_targeting: '商品投放报告',
  user_search_term: '用户搜索词报告',
};

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

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
    fileExtension: string;
    artifactId: string;
    fileSizeBytes: number;
  }>;
  failedCount: number;
  parsedFiles: number;
  insertedRows: number;
  currentImportedRows: number;
  productionReady?: boolean;
  downloadArtifactId?: string;
  manifestArtifactId?: string;
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

export interface CollectionProgressPresentation {
  tone: 'pending' | 'ready' | 'blocked';
  statusLabel: string;
  title: string;
  detail: string;
  completedCount: number;
  totalCount: number;
  manualReconciliation: boolean;
}

export type CollectionJobWorkspaceAction = 'cancel' | 'resume' | 'supplement-import' | 'manual-reconciliation' | 'none';

export interface CollectionImportPresentation {
  state: NonNullable<LingxingCollectionJobSnapshot['importState']> | 'legacy';
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
  productionComplete: boolean;
  canSupplement: boolean;
}

export interface CollectionJobWorkspaceRow {
  job: LingxingCollectionJobSnapshot;
  canary: boolean;
  action: CollectionJobWorkspaceAction;
  statusLabel: string;
  statusTone: 'ready' | 'pending' | 'blocked' | 'warning';
  progressLabel: string;
  progressDetail: string;
  blockerText: string;
  manualReconciliation: boolean;
  import: CollectionImportPresentation;
}

export interface CollectionJobLineagePresentation {
  label: string;
  detail: string;
  tone: 'ready' | 'warning' | 'blocked';
}

export function buildCollectionJobLineagePresentation(
  job: LingxingCollectionJobSnapshot,
): CollectionJobLineagePresentation {
  if (job.request.requestId.startsWith('canary:') || job.importState === 'not_applicable') {
    return {
      label: 'Canary 诊断链',
      detail: '不进入生产八报表 lineage',
      tone: 'warning',
    };
  }
  if (job.lineage) {
    const purposeLabel = job.lineage.purpose === 'production_full'
      ? '生产 root'
      : job.lineage.purpose === 'resume' ? '授权续跑' : '授权重试';
    return {
      label: purposeLabel,
      detail: `root ${job.lineage.rootJobId}${job.lineage.parentJobId ? ` · parent ${job.lineage.parentJobId}` : ''}`,
      tone: job.lineage.purpose === 'production_full' ? 'ready' : 'warning',
    };
  }
  const requested = new Set(job.request.reportTypes);
  const selfContainedFull = requested.size === 8;
  return selfContainedFull
    ? {
        label: '单次完整八报表',
        detail: `root ${job.jobId}`,
        tone: 'ready',
      }
    : {
        label: '独立部分任务',
        detail: '未绑定生产 root，不与其他批次拼接',
        tone: 'blocked',
      };
}

export function buildCollectionImportPresentation(
  job: LingxingCollectionJobSnapshot,
): CollectionImportPresentation {
  const canary = job.request.requestId.startsWith('canary:') || job.importState === 'not_applicable';
  if (canary) {
    return {
      state: 'not_applicable',
      label: 'Canary 不写生产指标',
      detail: '只验证采集链路，不计入生产 8/8，也不进入生产广告指标。',
      tone: 'warning',
      productionComplete: false,
      canSupplement: false,
    };
  }
  if (job.importState === 'pending') {
    return {
      state: 'pending',
      label: '等待 / 正在导入',
      detail: '报表下载已完成，生产指标仍在导入；此时不能视为业务完成。',
      tone: 'pending',
      productionComplete: false,
      canSupplement: false,
    };
  }
  if (job.importState === 'failed') {
    return {
      state: 'failed',
      label: '导入失败',
      detail: job.importError || '真实报表没有完成生产指标入库，可使用“补导数据”重试。',
      tone: 'blocked',
      productionComplete: false,
      canSupplement: true,
    };
  }
  if (job.importState === 'succeeded') {
    return {
      state: 'succeeded',
      label: '生产指标已入库',
      detail: '真实报表采集与店铺级生产指标入库均已持久化。',
      tone: 'ready',
      productionComplete: true,
      canSupplement: false,
    };
  }
  return {
    state: 'legacy',
    label: '旧任务 · 入库待核对',
    detail: '旧任务没有持久化入库状态，不能宣称生产入库成功；请核对或使用“补导数据”。',
    tone: 'warning',
    productionComplete: false,
    canSupplement: job.state === 'completed',
  };
}

export function collectionJobBelongsToAuthority(
  job: LingxingCollectionJobSnapshot | null | undefined,
  currentContext: StoreContextEnvelope | null | undefined,
): boolean {
  if (!job?.request?.storeContext || !currentContext) return false;
  try {
    return missionControlContextKey(job.request.storeContext) === missionControlContextKey(currentContext);
  } catch {
    return false;
  }
}

export function collectionJobBelongsToStore(
  job: LingxingCollectionJobSnapshot | null | undefined,
  currentContext: StoreContextEnvelope | null | undefined,
): boolean {
  const stored = job?.request?.storeContext;
  if (!stored || !currentContext) return false;
  return stored.storeId === currentContext.storeId
    && stored.browserProfileId === currentContext.browserProfileId
    && stored.marketplace === currentContext.marketplace
    && stored.currency === currentContext.currency;
}

export function upsertCollectionJobSnapshot(
  jobs: readonly LingxingCollectionJobSnapshot[],
  next: LingxingCollectionJobSnapshot,
): LingxingCollectionJobSnapshot[] {
  const existing = jobs.find((job) => job.jobId === next.jobId);
  const winner = existing && existing.updatedAt > next.updatedAt ? existing : next;
  return [winner, ...jobs.filter((job) => job.jobId !== next.jobId)]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function buildCollectionJobWorkspaceRow(
  job: LingxingCollectionJobSnapshot,
  currentContext?: StoreContextEnvelope | null,
): CollectionJobWorkspaceRow {
  const reports = Array.isArray(job.reports) ? job.reports : [];
  const canary = job.request.requestId.startsWith('canary:') || job.importState === 'not_applicable';
  const importPresentation = buildCollectionImportPresentation(job);
  const requestedCount = Math.max(1, job.request.reportTypes.length);
  const downloadedCount = reports.filter((report) => report.state === 'downloaded').length;
  const manualReports = reports.filter((report) => (
    report.state === 'create_unknown' || report.state === 'creating'
  ));
  const failedReports = reports.filter((report) => (
    report.state === 'failed' || report.state === 'stale_authority' || report.state === 'cancelled'
  ));
  const manualReconciliation = manualReports.length > 0;
  const statusByState: Record<LingxingCollectionJobSnapshot['state'], {
    label: string;
    tone: CollectionJobWorkspaceRow['statusTone'];
  }> = {
    queued: { label: '等待执行', tone: 'pending' },
    running: { label: '采集中', tone: 'pending' },
    completed: { label: '已完成', tone: 'ready' },
    completed_with_errors: { label: '部分失败', tone: 'warning' },
    failed: { label: '失败', tone: 'blocked' },
    cancelled: { label: '已取消', tone: 'warning' },
    stale_authority: { label: '店铺授权已变化', tone: 'blocked' },
  };
  const status = statusByState[job.state];
  const authorityChanged = Boolean(
    currentContext
    && collectionJobBelongsToStore(job, currentContext)
    && !collectionJobBelongsToAuthority(job, currentContext),
  );
  const activeAuthorityChanged = authorityChanged && (job.state === 'queued' || job.state === 'running');
  const canCancel = !manualReconciliation && !activeAuthorityChanged && (job.state === 'queued' || job.state === 'running');
  const canResume = !manualReconciliation && (
    [
      'completed_with_errors',
      'failed',
      'cancelled',
      'stale_authority',
    ].includes(job.state)
    || activeAuthorityChanged
  );
  const action: CollectionJobWorkspaceAction = manualReconciliation
    ? 'manual-reconciliation'
    : importPresentation.canSupplement
      ? 'supplement-import'
      : canCancel
        ? 'cancel'
        : canResume
          ? 'resume'
          : 'none';
  const manualNames = manualReports.map(reportDisplayName).join('、');
  const failedNames = failedReports.map(reportDisplayName).join('、');
  const blockerText = manualReconciliation
    ? `${manualNames || '报表'}创建结果未确认；需在领星下载中心人工核对，禁止恢复或重复创建。`
    : importPresentation.state === 'failed'
      ? importPresentation.detail
      : importPresentation.state === 'legacy' && job.state === 'completed'
        ? importPresentation.detail
        : activeAuthorityChanged
          ? '任务来自当前店铺的先前授权会话；只能用新的 StoreContext 明确继续，不能按旧会话取消。'
          : job.blockerCode || job.detail
            ? [job.blockerCode, job.detail].filter(Boolean).join(' · ')
            : failedNames
              ? `${failedNames}未完成`
              : '-';
  let resolvedStatusLabel = status.label;
  let resolvedStatusTone = status.tone;
  if (manualReconciliation) {
    resolvedStatusLabel = '需人工核对';
    resolvedStatusTone = 'blocked';
  } else if (activeAuthorityChanged) {
    resolvedStatusLabel = '可恢复';
    resolvedStatusTone = 'warning';
  } else if (
    (job.state === 'completed' || job.state === 'completed_with_errors')
    && importPresentation.state === 'failed'
  ) {
    resolvedStatusLabel = '导入失败';
    resolvedStatusTone = 'blocked';
  } else if (job.state === 'completed') {
    resolvedStatusTone = importPresentation.tone;
    if (importPresentation.state === 'pending') resolvedStatusLabel = '下载完成，正在导入';
    else if (importPresentation.state === 'succeeded') resolvedStatusLabel = '采集与入库完成';
    else if (importPresentation.state === 'not_applicable') resolvedStatusLabel = 'Canary 完成（不入生产）';
    else if (importPresentation.state === 'legacy') resolvedStatusLabel = '下载完成，入库待核对';
  }
  return {
    job,
    canary,
    action,
    statusLabel: resolvedStatusLabel,
    statusTone: resolvedStatusTone,
    progressLabel: canary
      ? `${downloadedCount}/${requestedCount} 类（Canary）`
      : requestedCount === 8
        ? `${downloadedCount}/8 类`
        : `${downloadedCount}/${requestedCount} 类（本任务）`,
    progressDetail: canary
      ? '仅诊断验证，不计入生产 8/8，也不导入生产指标'
      : requestedCount === 8 ? '完整 8 类报表任务' : `本任务覆盖 ${requestedCount}/8 类报表`,
    blockerText,
    manualReconciliation,
    import: importPresentation,
  };
}

export function createLingxingCollectionRequestId(
  action: string,
  now = Date.now(),
  randomToken: string = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2),
): string {
  const safeAction = action.trim().replace(SAFE_COLLECTION_REQUEST_PART, '-').replace(/^-+|-+$/g, '') || 'action';
  const safeRandom = randomToken.replace(SAFE_COLLECTION_REQUEST_PART, '').slice(0, 32) || 'local';
  return `lx:${safeAction}:${Math.max(0, Math.trunc(now)).toString(36)}:${safeRandom}`.slice(0, 128);
}

export function buildAuthoritativeCollectionDateRange(input: {
  action: string;
  dateStart: string;
  dateEnd: string;
  storeContext: StoreContextEnvelope | null;
  storeName?: string;
  requestId?: string;
}): AuthoritativeCollectionDateRange {
  if (!input.storeContext) throw new Error('当前没有可用的店铺授权上下文，请重新选择美国站店铺。');
  if (input.storeContext.marketplace !== 'US' || input.storeContext.currency !== 'USD') {
    throw new Error('第一版仅支持美国站（US）和美元（USD）店铺。');
  }
  return {
    start: input.dateStart,
    end: input.dateEnd,
    requestId: input.requestId || createLingxingCollectionRequestId(input.action),
    storeContext: { ...input.storeContext },
    storeName: input.storeName,
    marketplaceCode: 'US',
  };
}

export function collectionProgressBelongsToAuthority(
  event: LingxingCollectionProgressEvent | null | undefined,
  currentContext: StoreContextEnvelope | null | undefined,
  currentRequestId?: string | null,
): boolean {
  if (!event?.job?.request?.storeContext || !currentContext) return false;
  try {
    if (missionControlContextKey(event.job.request.storeContext) !== missionControlContextKey(currentContext)) return false;
    return !currentRequestId || event.job.request.requestId === currentRequestId;
  } catch {
    return false;
  }
}

function reportProgressLabel(report: LingxingCollectionReportCheckpoint): string {
  const labels: Record<LingxingCollectionReportCheckpoint['state'], string> = {
    queued: '排队中',
    navigating: '正在打开下载中心',
    creating: '正在创建',
    created: '创建已确认',
    waiting_ready: '等待生成',
    ready: '可下载',
    downloading: '下载中',
    verifying: '正在校验',
    downloaded: '已下载',
    failed: '失败',
    create_unknown: '创建结果未知',
    cancelled: '已取消',
    stale_authority: '店铺授权已过期',
  };
  return labels[report.state] || report.state;
}

function reportDisplayName(report: LingxingCollectionReportCheckpoint): string {
  return COLLECTION_REPORT_LABELS[report.reportType] || report.reportType;
}

export function buildCollectionProgressPresentation(
  event: LingxingCollectionProgressEvent | null | undefined,
): CollectionProgressPresentation | null {
  if (!event?.job) return null;
  const reports = Array.isArray(event.job.reports) ? event.job.reports : [];
  const unknown = reports.find((report) => report.state === 'create_unknown');
  const changed = reports.find((report) => report.reportType === event.changedReportType)
    || [...reports].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const completedCount = reports.filter((report) => report.state === 'downloaded').length;
  const totalCount = Math.max(event.job.request.reportTypes.length, reports.length);
  const importPresentation = buildCollectionImportPresentation(event.job);

  if (unknown) {
    return {
      tone: 'blocked',
      statusLabel: '需人工核对',
      title: `${reportDisplayName(unknown)}创建结果未知`,
      detail: '系统已停止本批次和自动重试。请在领星下载中心按店铺、日期和报表类型核对是否已生成；确认后再下载已创建报表或人工处理。',
      completedCount,
      totalCount,
      manualReconciliation: true,
    };
  }

  if (
    importPresentation.state === 'failed'
    && (event.job.state === 'completed' || event.job.state === 'completed_with_errors')
  ) {
    return {
      tone: 'blocked',
      statusLabel: '导入失败',
      title: '真实报表下载已结束，但生产指标导入失败',
      detail: importPresentation.detail,
      completedCount,
      totalCount,
      manualReconciliation: false,
    };
  }

  if (event.job.state === 'completed') {
    if (importPresentation.state === 'pending') {
      return {
        tone: 'pending',
        statusLabel: '等待入库',
        title: '报表下载完成，等待 / 正在导入',
        detail: importPresentation.detail,
        completedCount,
        totalCount,
        manualReconciliation: false,
      };
    }
    if (importPresentation.state === 'not_applicable') {
      return {
        tone: 'pending',
        statusLabel: 'Canary 不入生产',
        title: 'Canary 采集完成（不写生产指标）',
        detail: importPresentation.detail,
        completedCount,
        totalCount,
        manualReconciliation: false,
      };
    }
    if (importPresentation.state === 'legacy') {
      return {
        tone: 'pending',
        statusLabel: '入库待核对',
        title: '报表下载完成，旧任务入库状态待核对',
        detail: importPresentation.detail,
        completedCount,
        totalCount,
        manualReconciliation: false,
      };
    }
    return {
      tone: 'ready',
      statusLabel: '采集与入库完成',
      title: `领星采集与生产入库已完成 · ${completedCount}/${totalCount} 类`,
      detail: importPresentation.detail,
      completedCount,
      totalCount,
      manualReconciliation: false,
    };
  }

  if (['failed', 'completed_with_errors', 'cancelled', 'stale_authority'].includes(event.job.state)) {
    const stateLabel = event.job.state === 'cancelled'
      ? '任务已取消'
      : event.job.state === 'stale_authority'
        ? '店铺授权已变化'
        : '采集任务未完成';
    return {
      tone: 'blocked',
      statusLabel: stateLabel,
      title: changed ? `${reportDisplayName(changed)} · ${reportProgressLabel(changed)}` : stateLabel,
      detail: changed?.detail || event.job.detail || '请核对当前店铺、浏览器会话和领星下载中心状态后再处理。',
      completedCount,
      totalCount,
      manualReconciliation: false,
    };
  }

  return {
    tone: 'pending',
    statusLabel: '实时执行中',
    title: changed ? `${reportDisplayName(changed)} · ${reportProgressLabel(changed)}` : '正在准备领星采集任务',
    detail: changed?.detail || `当前已下载 ${completedCount}/${totalCount} 类报表。`,
    completedCount,
    totalCount,
    manualReconciliation: false,
  };
}

function getFileExtension(fileName: string, explicitExtension?: string): string {
  if (explicitExtension) return explicitExtension.toLowerCase();
  const target = fileName;
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

export function productionReportFileHasImportReceipt(
  file: Pick<BusinessReportFile, 'batchId' | 'importedRows' | 'status'>,
  binding?: Pick<ProductionCollectionReportBinding, 'expectedBatchId' | 'fileBatchId' | 'state'>,
): boolean {
  if (binding) {
    return binding.state === 'imported'
      && Boolean(binding.expectedBatchId)
      && binding.fileBatchId === binding.expectedBatchId
      && file.batchId === binding.expectedBatchId;
  }
  return Number(file.importedRows || 0) > 0
    || /imported|completed|complete|succeeded/i.test(String(file.status || ''));
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
      previewDetail: input.lastDiagnostic?.screenshotArtifactId || input.lastDiagnostic?.domArtifactId
        ? '诊断证据已登记，可通过当前店铺的受控操作打开。'
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
      previewDetail: input.lastDiagnostic?.screenshotArtifactId || input.lastDiagnostic?.domArtifactId
        ? '诊断证据已登记，可通过当前店铺的受控操作打开。'
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
  realFiles: Array<{ folderArtifactId?: string }>;
  evidenceFolderArtifactId?: string;
  auditDownloadArtifactId?: string;
}): string | undefined {
  if ((Number(input.realReportCount) || 0) <= 0) return undefined;
  return input.realFiles.find((file) => Boolean(file.folderArtifactId))?.folderArtifactId;
}

export function collectionActionButtonLabel(mode: CollectionActionMode): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': '下载已创建报表',
    'recreate-selected': '重新获取已选报表',
    'recreate-full': '重新获取完整 8 类报表',
    import: '导入本地报表',
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

export function collectionActionButtonBusyDetail(mode: CollectionActionMode): string {
  const labels: Record<CollectionActionMode, string> = {
    'download-existing': '正在下载并导入已创建报表',
    'recreate-selected': '正在重新创建、下载并导入已选报表',
    'recreate-full': '正在重新创建、下载并导入全部 8 类',
    import: '正在导入本地/已下载报表',
  };
  return labels[mode];
}

export function collectionActionButtonView({
  mode,
  runningAction,
  selectedCount,
}: {
  mode: CollectionActionMode;
  runningAction: RunningCollectionActionMode | null;
  selectedCount: number;
}): {
  label: string;
  detail: string;
  disabled: boolean;
  ariaBusy: boolean;
  className: string;
} {
  const isPrimary = mode === 'recreate-full';
  const isCurrentAction = runningAction === mode;
  const needsSelection = mode === 'download-existing' || mode === 'recreate-selected';
  const disabled = Boolean(runningAction) || (needsSelection && selectedCount === 0);
  return {
    label: isCurrentAction ? '处理中...' : collectionActionButtonLabel(mode),
    detail: isCurrentAction ? collectionActionButtonBusyDetail(mode) : collectionActionButtonDetail(mode),
    disabled,
    ariaBusy: isCurrentAction,
    className: [
      'collection-action-button',
      isPrimary ? 'primary-action' : 'secondary-action',
      isCurrentAction ? 'button-loading collection-action-button-running' : '',
    ].filter(Boolean).join(' '),
  };
}

export function collectionFeedbackActionButtonView({
  idleLabel,
  runningAction,
  targetAction,
  variant,
}: {
  idleLabel: string;
  runningAction: RunningCollectionActionMode | null;
  targetAction: RunningCollectionActionMode;
  variant: 'primary' | 'secondary';
}): {
  label: string;
  disabled: boolean;
  ariaBusy: boolean;
  showSpinner: boolean;
  className: string;
} {
  const isCurrentAction = runningAction === targetAction;
  const baseClassName = variant === 'primary' ? 'primary-button' : 'secondary-button';
  return {
    label: isCurrentAction ? '处理中...' : idleLabel,
    disabled: Boolean(runningAction),
    ariaBusy: isCurrentAction,
    showSpinner: isCurrentAction,
    className: [
      baseClassName,
      isCurrentAction ? 'button-loading' : '',
    ].filter(Boolean).join(' '),
  };
}

export function collectionArtifactActionKey(label: string, artifactId: string): string {
  return `${label}:${String(artifactId || 'missing')}`;
}

export function collectionOpenArtifactButtonView(input: {
  activeArtifactKey: string | null;
  baseClassName?: string;
  disabled?: boolean;
  idleLabel: string;
  artifactKey: string;
}): {
  label: string;
  disabled: boolean;
  ariaBusy?: true;
  className: string;
  showSpinner: boolean;
} {
  const isActive = input.activeArtifactKey === input.artifactKey;
  return {
    label: isActive ? '打开中...' : input.idleLabel,
    disabled: Boolean(input.disabled || input.activeArtifactKey),
    ariaBusy: isActive ? true : undefined,
    className: [input.baseClassName || 'secondary-button', isActive ? 'button-loading' : ''].filter(Boolean).join(' '),
    showSpinner: isActive,
  };
}

export function collectionReportSelectionState(input: {
  selectedCount: number;
  totalCount: number;
  missingCount: number;
  unimportedCount: number;
  loading?: boolean;
}): {
  ariaStatus: string;
  countClassName: string;
  countLabel: string;
  progressPercent: number;
  progressStyle: React.CSSProperties;
} {
  const totalCount = Math.max(0, Number(input.totalCount || 0));
  const selectedCount = Math.min(totalCount, Math.max(0, Number(input.selectedCount || 0)));
  const missingCount = Math.max(0, Number(input.missingCount || 0));
  const unimportedCount = Math.max(0, Number(input.unimportedCount || 0));
  const progressPercent = totalCount > 0 ? Math.round((selectedCount / totalCount) * 100) : 0;
  if (input.loading) {
    return {
      ariaStatus: '正在读取当前范围的 8 类报表状态，返回后会显示真实文件和入库情况。',
      countClassName: 'collection-selection-count',
      countLabel: `读取中 / ${totalCount || 8} 类`,
      progressPercent: 0,
      progressStyle: { '--collection-selection-progress': '0%' } as React.CSSProperties,
    };
  }
  return {
    ariaStatus: selectedCount > 0
      ? `已选择 ${selectedCount} 类报表，下载和重建只会作用于这些勾选项。`
      : `当前未选择报表；可一键选择 ${missingCount} 个缺失报表或 ${unimportedCount} 个待入库报表。`,
    countClassName: selectedCount > 0
      ? 'collection-selection-count collection-selection-count-active'
      : 'collection-selection-count',
    countLabel: `已选 ${selectedCount}/${totalCount} 类`,
    progressPercent,
    progressStyle: { '--collection-selection-progress': `${progressPercent}%` } as React.CSSProperties,
  };
}

export function buildDataCollectionTaskState({
  realReportCount,
  importedRowCount,
  primaryReportFolderArtifactId,
  runningAction,
  readiness,
}: {
  realReportCount: number;
  importedRowCount: number;
  primaryReportFolderArtifactId?: string;
  runningAction: RunningCollectionActionMode | null;
  readiness: Pick<DataReadinessLedger, 'status' | 'canEnterDiagnosis' | 'nextStep'>;
}): DataCollectionTaskState {
  const reportCount = Math.max(0, Math.min(8, Number(realReportCount) || 0));
  const rowCount = Math.max(0, Number(importedRowCount) || 0);
  const isComplete = readiness.canEnterDiagnosis;
  return {
    title: `真实报表 ${reportCount}/8，已导入 ${rowCount} 行`,
    detail: isComplete
      ? '真实报表和日级指标已闭合，可以查看广告表现。'
      : readiness.nextStep === 'import'
        ? '真实报表仍有类型未形成日级指标；逐类入库完成前不能进入正式诊断。'
      : reportCount > 0
        ? '先补齐完整 8 类报表；已有本地表格时可从目录确认或导入。'
        : '当前范围缺少真实报表，先获取完整 8 类或导入本地表格。',
    primaryActionLabel: isComplete
      ? '查看广告表现'
      : readiness.nextStep === 'import'
        ? runningAction === 'import' ? '正在导入已下载表格...' : '导入已下载表格'
      : runningAction === 'verify-page'
        ? '正在验证下载中心页面...'
      : runningAction === 'recreate-full'
        ? '正在重新获取完整 8 类报表...'
        : '重新获取完整 8 类报表',
    secondaryActionLabel: primaryReportFolderArtifactId ? '打开报表目录' : '导入本地报表',
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
      { label: '3. 写入数据库', description: '形成每日广告事实，后续广告表现和 AI 只从数据库读取。', status: completed ? (blocked ? 'blocked' : 'ready') : 'pending' },
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

export function CollectionMonitorDrawer({
  state,
  steps,
  evidenceAvailable,
  onClose,
}: {
  state: CollectionMonitorState;
  steps: ActionProgressStep[];
  evidenceAvailable?: boolean;
  onClose: () => void;
}) {
  const monitorDrawerFocus = useOverlayFocusScope<HTMLElement, HTMLElement>({
    dismissDisabled: !state.canClose,
    modal: false,
    onDismiss: onClose,
    open: true,
  });

  return (
    <aside
      aria-label="自动数据采集监控"
      aria-live="polite"
      className={`collection-monitor-drawer collection-monitor-${state.tone}`}
      ref={monitorDrawerFocus.surfaceRef}
    >
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
          <div
            aria-label="采集流程状态与最近证据"
            className="collection-monitor-preview-canvas"
            role="status"
          />
          <div className="collection-monitor-preview-overlay">
            <span className="collection-monitor-scanline" />
            <strong>{state.previewTitle}</strong>
            <small>{state.previewDetail}</small>
          </div>
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
      {evidenceAvailable && (
        <div className="collection-monitor-evidence">
          <span>受控证据</span>
          <strong>已登记到当前店铺，可按工件打开</strong>
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
  requestId?: string;
  storeContext?: StoreContextEnvelope;
  storeName?: string;
  marketplaceCode?: string;
};

type AuthoritativeCollectionDateRange = CollectionDateRange & {
  requestId: string;
  storeContext: StoreContextEnvelope;
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

export function collectionActionNextStep(input: {
  canEnterDiagnosis: boolean;
  failedWithoutFiles: boolean;
  hasImportedReceipt?: boolean;
  importedRows: number;
  realFileCount: number;
}): string {
  if (input.failedWithoutFiles) {
    return '下一步：查看失败原因和本次采集清单，确认领星 ready 行、页面模型、日期/店铺/站点后再重试。';
  }
  if (input.canEnterDiagnosis) {
    return '下一步：查看广告表现，复核 ACOS、花费和订单口径。';
  }
  if (input.importedRows > 0 || input.hasImportedReceipt) {
    return '下一步：刷新当前范围数据账本；只有完整 8 类逐类入库后才会放行正式诊断。';
  }
  if (input.realFileCount > 0) {
    return '下一步：点击“导入已下载表格”，把本地表格写入广告指标。';
  }
  return '下一步：检查下载中心页面、报表 ready 状态或失败报表后重试。';
}

function buildPipelineReadiness(
  pipeline: any,
  fallbackReportOptions: typeof DEFAULT_BUSINESS_REPORT_OPTIONS,
  realFileCount: number,
  importedRows: number,
): DataReadinessLedger {
  const collection = pipeline?.collection;
  const pipelineReportOptions = Array.isArray(collection?.reportOptions) && collection.reportOptions.length > 0
    ? collection.reportOptions
    : fallbackReportOptions;
  return buildDataReadinessLedger({
    requiredReportCount: 8,
    reportOptions: pipelineReportOptions,
    realReportFileCount: realFileCount,
    importedRowCount: importedRows,
    rejectedEvidenceFileCount: Number(collection?.fileAudit?.rejectedEvidenceFileCount || 0),
  });
}

function buildLastActionResult(
  mode: CollectionActionMode,
  results: any[],
  realFileCount: number,
  importedRows: number,
  fallbackArtifacts?: { downloadArtifactId?: string; manifestArtifactId?: string },
  canEnterDiagnosis = false,
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
    .filter((file) => file?.status === 'downloaded' && file?.artifactId)
    .filter((file) => ['.xlsx', '.xls', '.csv'].includes(getFileExtension(String(file?.fileName || ''), String(file?.fileExtension || ''))))
    .map((file) => ({
      label: String(file?.displayName || file?.reportType || '未知报表'),
      fileName: String(file?.fileName || file?.artifactDisplayName || file?.displayName || ''),
      fileExtension: getFileExtension(String(file?.fileName || ''), String(file?.fileExtension || '')),
      artifactId: String(file?.artifactId || ''),
      fileSizeBytes: Number(file?.fileSizeBytes || 0),
    }));
  const metricsImports = results.map((result) => result?.metricsImport).filter(Boolean);
  const insertedRows = metricsImports.reduce((sum, item) => sum + Number(item?.inserted || 0), 0);
  const parsedFiles = metricsImports.reduce((sum, item) => sum + Number(item?.parsedFiles || 0), 0);
  const downloadedCount = realFileCount;
  const actionRealDownloadCount = actionDownloadedFiles.length;
  const failedCount = failedFiles.length;
  const firstBatch = results.find((result) => result?.batch)?.batch;
  const nextStep = collectionActionNextStep({
    canEnterDiagnosis,
    failedWithoutFiles: failedFiles.length > 0 && actionDownloadedFiles.length === 0,
    hasImportedReceipt: parsedFiles > 0,
    importedRows,
    realFileCount,
  });
  const tone: LastActionResult['tone'] = failedCount > 0
    ? 'blocked'
    : mode === 'import'
      ? parsedFiles > 0 ? 'success' : 'blocked'
      : actionRealDownloadCount > 0
        ? importedRows > 0 || insertedRows > 0 || parsedFiles > 0 ? 'success' : 'warning'
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
    productionReady: canEnterDiagnosis,
    downloadArtifactId: firstBatch?.downloadArtifactId || fallbackArtifacts?.downloadArtifactId,
    manifestArtifactId: firstBatch?.manifestArtifactId || fallbackArtifacts?.manifestArtifactId,
    nextStep,
    failedFiles,
  };
}

export function collectionCompletionNotice(result: LastActionResult): string {
  if (result.mode === 'import') {
    if (result.currentImportedRows > 0 || result.insertedRows > 0) {
      return `导入完成：解析 ${result.parsedFiles} 个真实报表，写入 ${result.insertedRows} 行广告指标，当前范围共有 ${result.currentImportedRows} 行指标。`;
    }
    if (result.parsedFiles > 0 && result.failedCount === 0) {
      return result.productionReady
        ? `导入回执已完成：解析 ${result.parsedFiles} 个有效空表，写入 0 行广告指标；完整 8 类文件哈希和零行回执已闭合，可进入广告表现查看零数据状态。`
        : `导入回执已完成：解析 ${result.parsedFiles} 个有效空表，写入 0 行广告指标；文件哈希和零行回执已登记，系统将继续按完整 8 类任务血缘核对。`;
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
  return `采集动作返回，但当前范围仍未满足量化门槛：真实报表覆盖 ${result.downloadedCount}/8 类，导入指标 ${result.currentImportedRows} 行。没有 xlsx/xls/csv 或解析入库失败时不能进行广告表现。`;
}

export function CollectionJobWorkspace({
  jobs,
  currentContext,
  loading,
  error,
  previewOnly = false,
  actionBusyKey,
  onRefresh,
  onResume,
  onCancel,
}: {
  jobs: readonly LingxingCollectionJobSnapshot[];
  currentContext?: StoreContextEnvelope | null;
  loading: boolean;
  error: string | null;
  previewOnly?: boolean;
  actionBusyKey: string | null;
  onRefresh: () => void;
  onResume: (job: LingxingCollectionJobSnapshot) => void;
  onCancel: (job: LingxingCollectionJobSnapshot) => void;
}) {
  const visibleJobs = jobs.slice(0, 12);
  const rows = visibleJobs.map((job) => buildCollectionJobWorkspaceRow(job, currentContext));
  return (
    <Panel
      title="当前店铺采集任务历史"
      titleAccessory={<StatusPill tone={error ? 'blocked' : loading ? 'pending' : previewOnly ? 'warning' : 'ready'}>{loading ? '读取中' : previewOnly ? 'DEV 空任务预览' : `${jobs.length} 个任务`}</StatusPill>}
      tone={error ? 'blocked' : rows.some((row) => row.manualReconciliation || row.import.state === 'failed') ? 'blocked' : undefined}
    >
      <div className="business-split">
        <div>
          <div className="business-scope-line">仅显示当前美国站店铺最近任务</div>
          <p className="muted-line">新建、读取、恢复和取消都绑定当前 StoreContext；终态历史作为审计记录保留，不提供物理删除。切店后重新读取，不复用旧店响应。</p>
        </div>
        <button
          aria-busy={loading}
          className={loading ? 'secondary-button compact-button button-loading' : 'secondary-button compact-button'}
          disabled={loading || Boolean(actionBusyKey)}
          onClick={onRefresh}
          type="button"
        >
          {loading && <span aria-hidden="true" className="button-spinner" />}
          <span>{loading ? '读取中...' : '刷新任务'}</span>
        </button>
      </div>
      {previewOnly && (
        <p className="warning-line" role="status">开发预览不会注入伪造采集任务或生产成功；Windows 桌面端会从当前店铺数据库读取真实任务。</p>
      )}
      {error && <p className="blocked-line" role="alert">任务读取失败：{error}</p>}
      <div className="table-wrap">
        <table className="business-table data-table--compact data-table--striped" aria-label="当前店铺领星采集任务">
          <thead>
            <tr>
              <th>日期</th>
              <th>8 类报表进度</th>
              <th>任务血缘</th>
              <th>状态</th>
              <th>生产入库</th>
              <th>阻断 / UNKNOWN</th>
              <th>最近更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lineage = buildCollectionJobLineagePresentation(row.job);
              const resumeKey = `resume:${row.job.jobId}`;
              const cancelKey = `cancel:${row.job.jobId}`;
              const resumeBusy = actionBusyKey === resumeKey;
              const cancelBusy = actionBusyKey === cancelKey;
              return (
                <tr key={row.job.jobId}>
                  <td>
                    <strong>{row.job.request.dateStart} → {row.job.request.dateEnd}</strong>
                    <div className="table-subtext">任务 {row.job.jobId}</div>
                    {row.canary && <StatusPill tone="warning">Canary（不入生产）</StatusPill>}
                  </td>
                  <td>
                    <strong>{row.progressLabel}</strong>
                    <div className="table-subtext">{row.progressDetail}</div>
                  </td>
                  <td>
                    <StatusPill tone={lineage.tone}>{lineage.label}</StatusPill>
                    <div className="table-subtext">{lineage.detail}</div>
                  </td>
                  <td><StatusPill tone={row.statusTone}>{row.statusLabel}</StatusPill></td>
                  <td>
                    <StatusPill tone={row.import.tone}>{row.import.label}</StatusPill>
                    <div className="table-subtext">{row.import.detail}</div>
                  </td>
                  <td>
                    <span className={row.manualReconciliation ? 'blocked-line' : undefined}>{row.blockerText}</span>
                  </td>
                  <td>{formatUpdatedAt(row.job.updatedAt)}</td>
                  <td>
                    <div className="table-action-row">
                      {row.action === 'cancel' && (
                        <button
                          aria-busy={cancelBusy}
                          className={cancelBusy ? 'secondary-button compact-button button-loading' : 'secondary-button compact-button'}
                          disabled={Boolean(actionBusyKey)}
                          onClick={() => onCancel(row.job)}
                          type="button"
                        >
                          {cancelBusy && <span aria-hidden="true" className="button-spinner" />}
                          <span>{cancelBusy ? '提交取消...' : '取消任务'}</span>
                        </button>
                      )}
                      {row.action === 'resume' && (
                        <button
                          aria-busy={resumeBusy}
                          className={resumeBusy ? 'primary-button compact-button button-loading' : 'primary-button compact-button'}
                          disabled={Boolean(actionBusyKey)}
                          onClick={() => onResume(row.job)}
                          type="button"
                        >
                          {resumeBusy && <span aria-hidden="true" className="button-spinner" />}
                          <span>{resumeBusy ? '恢复中...' : '继续采集'}</span>
                        </button>
                      )}
                      {row.action === 'supplement-import' && (
                        <button
                          aria-busy={resumeBusy}
                          className={resumeBusy ? 'primary-button compact-button button-loading' : 'primary-button compact-button'}
                          disabled={Boolean(actionBusyKey)}
                          onClick={() => onResume(row.job)}
                          type="button"
                        >
                          {resumeBusy && <span aria-hidden="true" className="button-spinner" />}
                          <span>{resumeBusy ? '补导中...' : '补导数据'}</span>
                        </button>
                      )}
                      {row.action === 'manual-reconciliation' && (
                        <button
                          aria-label={`任务 ${row.job.jobId} 需人工核对，禁止继续采集`}
                          className="secondary-button compact-button"
                          disabled
                          type="button"
                        >
                          人工核对（禁止恢复）
                        </button>
                      )}
                      {row.action === 'none' && <span className="table-subtext">无需操作</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8}>{loading ? '正在读取当前店铺最近任务...' : error ? '读取失败，请点击“刷新任务”重试。' : previewOnly ? '开发预览任务列表为空；未伪造真实采集、入库或生产成功记录。' : '当前店铺还没有采集任务。完成首次真实采集后会在这里保留进度与恢复入口。'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {jobs.length > visibleJobs.length && (
        <p className="muted-line">当前先显示最近 {visibleJobs.length} 个任务；其余 {jobs.length - visibleJobs.length} 个历史任务已读取并用于生产 lineage 核对。</p>
      )}
    </Panel>
  );
}

export function DataCollectionPage() {
  const { data, error, loading, scope } = useBusinessDataPipeline();
  const storeAuthority = useMissionControlStoreContext();
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runningAction, setRunningAction] = useState<RunningCollectionActionMode | null>(null);
  const [feedbackActionGroup, setFeedbackActionGroup] = useState<CollectionFeedbackActionGroup | null>(null);
  const [openingArtifactKey, setOpeningArtifactKey] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<LastActionResult | null>(null);
  const [lastDiagnostic, setLastDiagnostic] = useState<any | null>(null);
  const [collectionMonitorOpen, setCollectionMonitorOpen] = useState(false);
  const [liveCollectionProgress, setLiveCollectionProgress] = useState<LingxingCollectionProgressEvent | null>(null);
  const [collectionJobs, setCollectionJobs] = useState<LingxingCollectionJobSnapshot[]>([]);
  const [collectionJobsLoading, setCollectionJobsLoading] = useState(false);
  const [collectionJobsError, setCollectionJobsError] = useState<string | null>(null);
  const [collectionJobsPreviewOnly, setCollectionJobsPreviewOnly] = useState(false);
  const [collectionJobActionBusyKey, setCollectionJobActionBusyKey] = useState<string | null>(null);
  const [reportSelectorOpen, setReportSelectorOpen] = useState(false);
  const [selectedReportFile, setSelectedReportFile] = useState<BusinessReportFile | null>(null);
  const authorityKeyRef = useRef(storeAuthority.authorityKey);
  const collectionRequestIdRef = useRef<string | null>(null);
  const manualReconciliationRequestIdRef = useRef<string | null>(null);
  const collectionJobsLoadSequenceRef = useRef(0);
  const collectionJobActionTokenRef = useRef<string | null>(null);
  authorityKeyRef.current = storeAuthority.authorityKey;
  const reportSelectorDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    onDismiss: () => setReportSelectorOpen(false),
    open: reportSelectorOpen,
  });
  const reportFileDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    onDismiss: () => setSelectedReportFile(null),
    open: Boolean(selectedReportFile),
  });
  const collection = data?.collection;
  const reportStatusLoading = loading && !collection;
  const reportOptions = collection?.reportOptions?.length ? collection.reportOptions : DEFAULT_BUSINESS_REPORT_OPTIONS;
  const realFiles = collection?.realReportFiles || [];
  const fileAudit = collection?.fileAudit;
  const selectedCount = selectedTypes.length;
  const aggregateRealReportCount = fileAudit?.realReportFileCount ?? realFiles.length;
  const aggregateImportedRowCount = fileAudit?.importedRowCount ?? reportOptions.reduce((sum, item) => sum + item.importedRows, 0);
  const productionLineageReadiness = useMemo(() => buildProductionCollectionLineageReadiness({
    currentContext: storeAuthority.authoritativeContext,
    dateStart: scope.dateFrom,
    dateEnd: scope.dateTo,
    jobs: collectionJobs,
    files: realFiles,
  }), [collectionJobs, realFiles, scope.dateFrom, scope.dateTo, storeAuthority.authoritativeContext]);
  const productionBindingByType = useMemo(() => new Map(
    productionLineageReadiness.reportBindings.map((binding) => [binding.reportType, binding]),
  ), [productionLineageReadiness.reportBindings]);
  const productionReportOptions = useMemo(() => reportOptions.map((option) => {
    const binding = productionBindingByType.get(option.type as ProductionCollectionReportBinding['reportType']);
    return {
      ...option,
      realFileAvailable: Boolean(binding?.fileBatchId && binding.fileBatchId === binding.expectedBatchId),
      importedRows: binding?.state === 'imported' ? binding.importedRows : 0,
      status: binding?.state || 'missing',
    };
  }), [productionBindingByType, reportOptions]);
  const productionRealFiles = useMemo(() => realFiles.filter((file) => {
    const binding = productionBindingByType.get(file.reportType as ProductionCollectionReportBinding['reportType']);
    return Boolean(binding?.expectedBatchId && file.batchId === binding.expectedBatchId);
  }), [productionBindingByType, realFiles]);
  const realReportCount = productionLineageReadiness.sourceMatchedReportCount;
  const importedReportCount = productionLineageReadiness.importedReportCount;
  const importedRowCount = productionLineageReadiness.importedRows;
  const rejectedEvidenceCount = fileAudit?.rejectedEvidenceFileCount ?? 0;
  const manualReconciliationRequired = Boolean(
    liveCollectionProgress?.job.reports.some((report) => report.state === 'create_unknown' || report.state === 'creating')
    || collectionJobs
      .filter((job) => job.request.dateStart === scope.dateFrom && job.request.dateEnd === scope.dateTo)
      .some((job) => buildCollectionJobWorkspaceRow(job, storeAuthority.authoritativeContext).manualReconciliation),
  );
  const hasOnlyDiagnosticFiles = realReportCount === 0 && rejectedEvidenceCount > 0;
  const latestBatchStatus = collection?.latestBatch?.status || 'missing';
  const availableBatchCount = collection?.availableBatches?.length || collection?.sourceBatchIds?.length || 0;
  const auditEvidenceArtifacts = (collection?.evidenceArtifacts || []).filter((item) => item.kind === 'audit');
  const folderEvidenceArtifacts = (collection?.evidenceArtifacts || []).filter((item) => item.kind === 'folder');
  const primaryReportFolderArtifactId = dataCollectionFirstViewportReportFolder({
    realReportCount,
    realFiles: productionRealFiles,
    evidenceFolderArtifactId: folderEvidenceArtifacts[0]?.artifactId,
    auditDownloadArtifactId: fileAudit?.downloadArtifactId,
  });
  const primaryAuditArtifactId = auditEvidenceArtifacts[0]?.artifactId;
  const visibleRealFiles = productionRealFiles.slice(0, 8);
  const hiddenRealFileCount = Math.max(0, productionRealFiles.length - visibleRealFiles.length);
  const reportSelectionKey = useMemo(() => reportOptions.map((item) => item.type).join('|'), [reportOptions]);
  const missingReportTypes = useMemo(
    () => productionReportOptions.filter((item) => !item.realFileAvailable).map((item) => item.type),
    [productionReportOptions],
  );
  const unimportedReportTypes = useMemo(
    () => productionReportOptions.filter((item) => item.realFileAvailable && item.status !== 'imported').map((item) => item.type),
    [productionReportOptions],
  );
  const selectedReportFileBinding = selectedReportFile
    ? productionBindingByType.get(selectedReportFile.reportType as ProductionCollectionReportBinding['reportType'])
    : undefined;
  const selectedReportFileImported = selectedReportFile
    ? productionReportFileHasImportReceipt(selectedReportFile, selectedReportFileBinding)
    : false;
  const actionProgressSteps = useMemo(
    () => buildActionProgressSteps(runningAction === 'verify-page' ? null : runningAction, lastActionResult),
    [lastActionResult, runningAction],
  );
  const shouldShowVerifyAction = shouldOfferDownloadCenterVerification(actionError);
  const lastActionSummary = useMemo(() => lastActionResult ? {
    tone: lastActionResult.tone === 'success' ? 'ready' as const : lastActionResult.tone === 'blocked' ? 'blocked' as const : 'warning' as const,
    statusLabel: lastActionResult.tone === 'success' ? '已完成' : lastActionResult.tone === 'blocked' ? '未完成' : '待补导',
    headline: collectionCompletionNotice(lastActionResult),
    facts: [
      `真实报表 ${lastActionResult.downloadedCount}/8`,
      `本次文件 ${lastActionResult.actionDownloadedFiles.length}`,
      `解析 ${lastActionResult.parsedFiles} 个`,
      `写入 ${lastActionResult.insertedRows} 行`,
    ],
    blockers: lastActionResult.failedFiles.map((item) => `${item.label}：${item.reason}`),
    nextAction: lastActionResult.nextStep,
    primaryArtifactId: lastActionResult.manifestArtifactId || lastActionResult.downloadArtifactId,
    primaryArtifactLabel: lastActionResult.manifestArtifactId ? '本次采集清单' : '本次文件目录',
  } : null, [lastActionResult]);
  const downloadExistingButton = collectionActionButtonView({ mode: 'download-existing', runningAction, selectedCount });
  const recreateSelectedButton = collectionActionButtonView({ mode: 'recreate-selected', runningAction, selectedCount });
  const recreateFullButton = collectionActionButtonView({ mode: 'recreate-full', runningAction, selectedCount });
  const importButton = collectionActionButtonView({ mode: 'import', runningAction, selectedCount });
  const verifyFeedbackButton = collectionFeedbackActionButtonView({
    idleLabel: '验证页面',
    runningAction,
    targetAction: 'verify-page',
    variant: 'primary',
  });
  const retryFullFeedbackButton = collectionFeedbackActionButtonView({
    idleLabel: '重试获取 8 类',
    runningAction,
    targetAction: 'recreate-full',
    variant: 'secondary',
  });
  const refreshFullFeedbackButton = collectionFeedbackActionButtonView({
    idleLabel: '重新获取完整 8 类报表',
    runningAction,
    targetAction: 'recreate-full',
    variant: 'primary',
  });
  const reportSelectionState = collectionReportSelectionState({
    selectedCount,
    totalCount: reportOptions.length,
    missingCount: missingReportTypes.length,
    unimportedCount: unimportedReportTypes.length,
    loading: reportStatusLoading,
  });
  const dataLedger = useMemo(
    () => buildDataReadinessLedger({
      requiredReportCount: 8,
      reportOptions: productionReportOptions,
      realReportFileCount: realReportCount,
      importedRowCount,
      rejectedEvidenceFileCount: rejectedEvidenceCount,
    }),
    [importedRowCount, productionReportOptions, realReportCount, rejectedEvidenceCount],
  );
  const productionDataReady = dataLedger.canEnterDiagnosis && productionLineageReadiness.canEnterDiagnosis;
  const taskState = buildDataCollectionTaskState({
    realReportCount,
    importedRowCount,
    primaryReportFolderArtifactId,
    runningAction,
    readiness: { ...dataLedger, canEnterDiagnosis: productionDataReady },
  });
  const primaryTaskBusy = taskState.isComplete
    ? false
    : dataLedger.nextStep === 'import'
      ? runningAction === 'import'
      : runningAction === 'recreate-full';
  const importedReadinessStage = dataLedger.stages.find((stage) => stage.key === 'imported');
  const liveProgressPresentation = useMemo(
    () => buildCollectionProgressPresentation(liveCollectionProgress),
    [liveCollectionProgress],
  );
  const collectionMonitorState = buildCollectionMonitorState({
    runningAction,
    actionNotice,
    actionError,
    lastActionResult,
    lastDiagnostic,
    realReportCount,
    importedRowCount,
  });
  const collectionMonitorEvidenceAvailable = Boolean(
    lastActionSummary?.primaryArtifactId
    || lastDiagnostic?.screenshotArtifactId
    || lastDiagnostic?.domArtifactId,
  );

  useEffect(() => {
    ++collectionJobsLoadSequenceRef.current;
    collectionJobActionTokenRef.current = null;
    collectionRequestIdRef.current = null;
    manualReconciliationRequestIdRef.current = null;
    setActionNotice(null);
    setActionError(null);
    setRunningAction(null);
    setFeedbackActionGroup(null);
    setOpeningArtifactKey(null);
    setLastActionResult(null);
    setLastDiagnostic(null);
    setLiveCollectionProgress(null);
    setCollectionJobs([]);
    setCollectionJobsLoading(false);
    setCollectionJobsError(null);
    setCollectionJobsPreviewOnly(false);
    setCollectionJobActionBusyKey(null);
    setCollectionMonitorOpen(false);
    setReportSelectorOpen(false);
    setSelectedReportFile(null);
  }, [storeAuthority.authorityKey]);

  useEffect(() => {
    const context = storeAuthority.authoritativeContext;
    const authorityKey = storeAuthority.authorityKey;
    if (!context || !authorityKey) return;
    void loadRecentCollectionJobs(context, authorityKey);
  }, [storeAuthority.authoritativeContext, storeAuthority.authorityKey]);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onLingxingCollectionProgress || !storeAuthority.authoritativeContext) return undefined;
    const unsubscribe = api.onLingxingCollectionProgress((event: LingxingCollectionProgressEvent) => {
      if (!collectionJobBelongsToAuthority(event?.job, storeAuthority.authoritativeContext)) return;
      setCollectionJobs((current) => upsertCollectionJobSnapshot(current, event.job).slice(0, 100));
      if (!collectionProgressBelongsToAuthority(event, storeAuthority.authoritativeContext, collectionRequestIdRef.current)) return;
      const presentation = buildCollectionProgressPresentation(event);
      if (!presentation) return;
      setLiveCollectionProgress(event);
      setCollectionMonitorOpen(true);

      if (presentation.manualReconciliation) {
        manualReconciliationRequestIdRef.current = event.job.request.requestId;
        setRunningAction(null);
        setActionNotice('领星报表创建结果未知，本批次已停止。');
        setActionError(presentation.detail);
        return;
      }

      if (event.job.state === 'queued' || event.job.state === 'running') {
        const nextAction: DownloadCollectionActionMode = event.job.request.mode === 'download-existing'
          ? 'download-existing'
          : event.job.request.reportTypes.length >= 8
            ? 'recreate-full'
            : 'recreate-selected';
        setRunningAction(nextAction);
        setActionError(null);
        setActionNotice(`${presentation.title}。${presentation.detail}`);
        return;
      }

      setRunningAction(null);
      if (presentation.tone === 'blocked') {
        setActionNotice(presentation.statusLabel);
        setActionError(presentation.detail);
      } else {
        setActionError(null);
        setActionNotice(presentation.title);
      }
      if (presentation.tone === 'ready') {
        window.dispatchEvent(new Event('business-ui:data-updated'));
      }
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [storeAuthority.authoritativeContext, storeAuthority.authorityKey]);

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

  async function loadRecentCollectionJobs(
    capturedContext = storeAuthority.authoritativeContext,
    capturedAuthorityKey = storeAuthority.authorityKey,
  ): Promise<void> {
    const api = (window as any).electronAPI;
    if (!capturedContext || !capturedAuthorityKey) {
      setCollectionJobs([]);
      setCollectionJobsLoading(false);
      setCollectionJobsError('当前没有可用的店铺授权上下文。');
      return;
    }
    if (capturedContext.marketplace !== 'US' || capturedContext.currency !== 'USD') {
      setCollectionJobs([]);
      setCollectionJobsLoading(false);
      setCollectionJobsError('第一版仅支持美国站（US）和美元（USD）店铺。');
      return;
    }
    const sequence = ++collectionJobsLoadSequenceRef.current;
    setCollectionJobsLoading(true);
    setCollectionJobsError(null);
    setCollectionJobsPreviewOnly(api?.lingxingCollectionJobsPreviewOnly === true);
    try {
      if (!api?.listLingxingCollectionJobs) {
        throw new Error('最近采集任务接口未暴露，请检查 preload IPC。');
      }
      const jobs = await api.listLingxingCollectionJobs({
        storeContext: { ...capturedContext },
        limit: 100,
      });
      if (sequence !== collectionJobsLoadSequenceRef.current || authorityKeyRef.current !== capturedAuthorityKey) return;
      const safeJobs = (Array.isArray(jobs) ? jobs : [])
        .filter((job): job is LingxingCollectionJobSnapshot => collectionJobBelongsToStore(job, capturedContext))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      setCollectionJobs((current) => safeJobs.reduce(
        (merged, job) => upsertCollectionJobSnapshot(merged, job),
        current.filter((job) => collectionJobBelongsToStore(job, capturedContext)),
      ).slice(0, 100));
    } catch (caught) {
      if (sequence !== collectionJobsLoadSequenceRef.current || authorityKeyRef.current !== capturedAuthorityKey) return;
      setCollectionJobsError(toUserFacingError(caught, '最近采集任务读取失败。'));
    } finally {
      if (sequence === collectionJobsLoadSequenceRef.current && authorityKeyRef.current === capturedAuthorityKey) {
        setCollectionJobsLoading(false);
      }
    }
  }

  function captureCurrentStoreAuthority(): {
    authorityKey: string;
    storeContext: StoreContextEnvelope;
  } {
    const current = storeAuthority.authoritativeContext;
    if (!current) throw new Error('当前没有可用的店铺授权上下文，请重新选择美国站店铺。');
    if (current.marketplace !== 'US' || current.currency !== 'USD') {
      throw new Error('第一版仅支持美国站（US）和美元（USD）店铺。');
    }
    return {
      authorityKey: missionControlContextKey(current),
      storeContext: { ...current },
    };
  }

  function captureBusinessImportScope(): {
    authorityKey: string;
    input: typeof scope & { storeContext: StoreContextEnvelope };
  } {
    const captured = captureCurrentStoreAuthority();
    return {
      authorityKey: captured.authorityKey,
      input: {
        ...scope,
        storeName: storeAuthority.activeStore?.displayName || scope.storeName,
        marketplaceCode: 'US',
        storeContext: captured.storeContext,
      },
    };
  }

  function captureCollectionRange(action: string): {
    authorityKey: string;
    dateRange: AuthoritativeCollectionDateRange;
  } {
    const dateRange = buildAuthoritativeCollectionDateRange({
      action,
      dateStart: scope.dateFrom,
      dateEnd: scope.dateTo,
      storeContext: storeAuthority.authoritativeContext,
      storeName: storeAuthority.activeStore?.displayName || scope.storeName,
    });
    const authorityKey = missionControlContextKey(dateRange.storeContext);
    collectionRequestIdRef.current = dateRange.requestId;
    if (action !== 'diagnose') {
      manualReconciliationRequestIdRef.current = null;
      setLiveCollectionProgress(null);
    }
    return { authorityKey, dateRange };
  }

  function isCapturedAuthorityCurrent(authorityKey: string): boolean {
    return authorityKeyRef.current === authorityKey;
  }

  async function resumeCollectionJob(job: LingxingCollectionJobSnapshot): Promise<void> {
    const api = (window as any).electronAPI;
    const view = buildCollectionJobWorkspaceRow(job, storeAuthority.authoritativeContext);
    if (view.action === 'manual-reconciliation') {
      setActionNotice('该任务没有自动恢复。');
      setActionError(view.blockerText);
      return;
    }
    if (view.action !== 'resume' && view.action !== 'supplement-import') {
      setActionNotice('该任务当前不需要继续采集。');
      return;
    }

    let captured: ReturnType<typeof captureCurrentStoreAuthority>;
    try {
      captured = captureCurrentStoreAuthority();
      if (!collectionJobBelongsToStore(job, captured.storeContext)) {
        throw new Error('任务不属于当前店铺或浏览器会话，拒绝继续采集。');
      }
    } catch (caught) {
      setActionNotice('继续采集未开始。');
      setActionError(toUserFacingError(caught, '当前店铺授权不可用。'));
      return;
    }

    const requestSeed = createLingxingCollectionRequestId(`resume-${job.jobId}`);
    const requestId = view.canary
      ? `canary:${requestSeed}`.slice(0, 128)
      : requestSeed;
    const actionToken = `${captured.authorityKey}|resume|${job.jobId}|${requestId}`;
    collectionJobActionTokenRef.current = actionToken;
    collectionRequestIdRef.current = requestId;
    manualReconciliationRequestIdRef.current = null;
    setCollectionJobActionBusyKey(`resume:${job.jobId}`);
    setLiveCollectionProgress(null);
    setLastActionResult(null);
    setLastDiagnostic(null);
    setActionError(null);
    setActionNotice(view.action === 'supplement-import'
      ? `正在补导任务 ${job.jobId} 的真实报表；系统会复用已验证文件，不会重新创建领星报表。`
      : view.canary
      ? `正在从 Canary 任务 ${job.jobId} 的已确认检查点继续；结果只用于诊断，不会导入生产指标。`
      : `正在从任务 ${job.jobId} 的已确认检查点继续采集；已下载文件会先重新校验，不会盲目重复下载。`);
    setRunningAction(view.action === 'supplement-import'
      ? 'import'
      : job.request.mode === 'download-existing'
        ? 'download-existing'
        : job.request.reportTypes.length >= 8 ? 'recreate-full' : 'recreate-selected');
    setCollectionMonitorOpen(true);
    try {
      if (!api?.resumeLingxingCollection) {
        throw new Error('继续采集接口未暴露，请检查 preload IPC。');
      }
      const result = await api.resumeLingxingCollection({
        jobId: job.jobId,
        requestId,
        storeContext: captured.storeContext,
      });
      if (collectionJobActionTokenRef.current !== actionToken || !isCapturedAuthorityCurrent(captured.authorityKey)) return;
      if (result?.job && !collectionJobBelongsToStore(result.job, captured.storeContext)) return;
      if (manualReconciliationRequestIdRef.current === requestId) return;
      setActionError(null);
      const returnedImportState = result?.job?.importState || result?.importState;
      setActionNotice(view.action === 'supplement-import'
        ? returnedImportState === 'succeeded' || result?.importRecovered === true
          ? '补导已完成并持久化为生产指标已入库，正在刷新当前店铺任务与数据账本。'
          : '补导请求已返回，正在重新读取持久化入库状态。'
        : result?.alreadyComplete
          ? '已下载文件重新校验通过，该任务没有剩余报表需要继续采集。'
          : '继续采集已返回，正在刷新当前店铺任务与数据账本。');
      window.dispatchEvent(new Event('business-ui:data-updated'));
      await loadRecentCollectionJobs(captured.storeContext, captured.authorityKey);
    } catch (caught) {
      if (collectionJobActionTokenRef.current !== actionToken || !isCapturedAuthorityCurrent(captured.authorityKey)) return;
      if (manualReconciliationRequestIdRef.current === requestId) return;
      setActionNotice('继续采集未完成。');
      setActionError(toUserFacingError(caught, '继续采集未完成。'));
      await loadRecentCollectionJobs(captured.storeContext, captured.authorityKey);
    } finally {
      if (collectionJobActionTokenRef.current === actionToken && isCapturedAuthorityCurrent(captured.authorityKey)) {
        collectionJobActionTokenRef.current = null;
        setCollectionJobActionBusyKey(null);
        setRunningAction(null);
      }
    }
  }

  async function cancelCollectionJob(job: LingxingCollectionJobSnapshot): Promise<void> {
    const api = (window as any).electronAPI;
    const view = buildCollectionJobWorkspaceRow(job, storeAuthority.authoritativeContext);
    if (view.action === 'manual-reconciliation') {
      setActionNotice('该任务没有自动取消或恢复。');
      setActionError(view.blockerText);
      return;
    }
    if (view.action !== 'cancel') return;

    let captured: ReturnType<typeof captureCurrentStoreAuthority>;
    try {
      captured = captureCurrentStoreAuthority();
      if (!collectionJobBelongsToStore(job, captured.storeContext)) {
        throw new Error('任务不属于当前店铺或浏览器会话，拒绝取消。');
      }
    } catch (caught) {
      setActionNotice('取消请求未提交。');
      setActionError(toUserFacingError(caught, '当前店铺授权不可用。'));
      return;
    }

    const actionToken = `${captured.authorityKey}|cancel|${job.jobId}|${job.request.requestId}`;
    collectionJobActionTokenRef.current = actionToken;
    setCollectionJobActionBusyKey(`cancel:${job.jobId}`);
    setActionError(null);
    setActionNotice(`正在提交任务 ${job.jobId} 的取消请求...`);
    try {
      if (!api?.cancelLingxingCollection) {
        throw new Error('取消采集接口未暴露，请检查 preload IPC。');
      }
      await api.cancelLingxingCollection({
        jobId: job.jobId,
        requestId: job.request.requestId,
        storeContext: captured.storeContext,
      });
      if (collectionJobActionTokenRef.current !== actionToken || !isCapturedAuthorityCurrent(captured.authorityKey)) return;
      setActionNotice('取消请求已提交；系统会在当前外部步骤安全停止后更新任务状态。');
      await loadRecentCollectionJobs(captured.storeContext, captured.authorityKey);
    } catch (caught) {
      if (collectionJobActionTokenRef.current !== actionToken || !isCapturedAuthorityCurrent(captured.authorityKey)) return;
      setActionNotice('取消请求未提交。');
      setActionError(toUserFacingError(caught, '取消采集任务失败。'));
    } finally {
      if (collectionJobActionTokenRef.current === actionToken && isCapturedAuthorityCurrent(captured.authorityKey)) {
        collectionJobActionTokenRef.current = null;
        setCollectionJobActionBusyKey(null);
      }
    }
  }

  async function openArtifact(artifactId: string, label = '打开工件') {
    if (openingArtifactKey) return;
    if (!artifactId) {
      setActionError('打开操作不可用：当前没有已登记的文件或目录。');
      setActionNotice('打开操作不可用。');
      return;
    }
    const artifactKey = collectionArtifactActionKey(label, artifactId);
    setOpeningArtifactKey(artifactKey);
    try {
      setActionError(null);
      setActionNotice(`${label}打开中...`);
      const storeContext = storeAuthority.authoritativeContext;
      if (!storeContext) throw new Error('当前店铺权威不可用。');
      await (window as any).electronAPI?.openReportArtifact?.(artifactId, { ...storeContext });
      setActionError(null);
      setActionNotice(`${label}已请求打开。`);
    } catch (caught) {
      setActionError(toUserFacingError(caught, '打开工件失败。'));
      setActionNotice('打开工件失败。');
    } finally {
      setOpeningArtifactKey(null);
    }
  }

  async function runVerifyDownloadCenter() {
    const api = (window as any).electronAPI;
    let captured: ReturnType<typeof captureCollectionRange>;
    try {
      captured = captureCollectionRange('diagnose');
    } catch (caught) {
      setActionError(toUserFacingError(caught, '当前店铺授权不可用。'));
      setActionNotice('验证页面未开始。');
      return;
    }
    const { authorityKey, dateRange } = captured;
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
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      setLastDiagnostic(diagnostic);
      const evidenceAvailable = diagnostic?.screenshotArtifactId || diagnostic?.domArtifactId;
      const evidenceText = evidenceAvailable ? ' 诊断证据已登记。' : '';
      if (diagnostic?.ready) {
        setActionNotice(manualReconciliationRequired
          ? `页面验证通过，但创建结果仍需人工核对；确认领星已有任务后请使用“下载并导入已创建报表”。${evidenceText}`
          : `页面验证通过：当前范围、页面和关键控件已刷新，可以重新获取完整 8 类报表。${evidenceText}`);
        return;
      }
      const reason = diagnostic?.errorMessage
        || (Array.isArray(diagnostic?.missingRequiredSelectors) && diagnostic.missingRequiredSelectors.length
          ? `缺少关键控件：${diagnostic.missingRequiredSelectors.join('、')}`
          : '页面模型还未匹配当前下载中心');
      setActionNotice('页面验证已返回，但当前页面仍不能安全创建报表。');
      setActionError(`页面验证未通过：${reason}。请确认已从 ERP 广告入口进入下载中心，并且日期、店铺、站点与当前范围一致。${evidenceText}`);
    } catch (caught) {
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      setLastDiagnostic(null);
      setActionError(toUserFacingError(caught, '验证页面未完成。'));
      setActionNotice('验证页面未完成。');
    } finally {
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      setRunningAction(null);
      setFeedbackActionGroup(null);
    }
  }

  async function runDownloadAction(mode: 'download-existing' | 'recreate-selected' | 'recreate-full') {
    const api = (window as any).electronAPI;
    if (manualReconciliationRequired && mode !== 'download-existing') {
      setActionNotice('本批次仍需人工核对，未重新创建报表。');
      setActionError('请先在领星下载中心按店铺、日期和报表类型核对创建结果；确认已有任务后使用“下载并导入已创建报表”。');
      setCollectionMonitorOpen(true);
      return;
    }
    const targetTypes = mode === 'recreate-full' ? reportOptions.map((item) => item.type) : selectedTypes;
    const selectedLabels = reportOptions
      .filter((item) => targetTypes.includes(item.type))
      .map((item) => item.label);
    let captured: ReturnType<typeof captureCollectionRange>;
    try {
      captured = captureCollectionRange(mode);
    } catch (caught) {
      setActionError(toUserFacingError(caught, '当前店铺授权不可用。'));
      setActionNotice('采集动作未开始。');
      return;
    }
    const { authorityKey, dateRange } = captured;
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
          if (!isCapturedAuthorityCurrent(authorityKey)) return;
          setRunningAction('verify-page');
          setActionNotice('当前范围缺少下载中心验证证据，正在自动验证页面，验证通过后会继续创建并下载报表。');
        },
        onDiagnostic: (diagnostic) => {
          if (!isCapturedAuthorityCurrent(authorityKey)) return;
          setLastDiagnostic(diagnostic);
        },
        onAutoVerifyReady: () => {
          if (!isCapturedAuthorityCurrent(authorityKey)) return;
          setRunningAction(mode);
          setActionNotice(mode === 'download-existing'
            ? `页面验证通过，继续下载并自动导入已创建报表：${selectedLabels.join('、')}`
            : `${mode === 'recreate-full' ? '页面验证通过，继续重新创建全部 8 类报表、下载并自动导入' : '页面验证通过，继续重新创建已选报表、下载并自动导入'}：${selectedLabels.join('、')}`);
        },
      });
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      if (manualReconciliationRequestIdRef.current === dateRange.requestId) return;
      const refreshed = await api.getBusinessUiDataPipeline?.(scope);
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      window.dispatchEvent(new Event('business-ui:data-updated'));
      const realFileCount = refreshed?.collection?.realReportFiles?.length ?? 0;
      const importedRows = refreshed?.collection?.fileAudit?.importedRowCount ?? refreshed?.quant?.importedRows ?? 0;
      const refreshedReadiness = buildPipelineReadiness(refreshed, reportOptions, realFileCount, importedRows);
      const actionResult = buildLastActionResult(mode, actionResults, realFileCount, importedRows, {
        downloadArtifactId: refreshed?.collection?.fileAudit?.downloadArtifactId,
        manifestArtifactId: refreshed?.collection?.fileAudit?.manifestArtifactId,
      }, refreshedReadiness.canEnterDiagnosis);
      setLastActionResult(actionResult);
      setActionNotice(collectionCompletionNotice(actionResult));
    } catch (caught) {
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      if (manualReconciliationRequestIdRef.current === dateRange.requestId) return;
      const message = collectionActionError(mode, caught);
      setActionError(message);
      setActionNotice(mode === 'download-existing'
        ? '下载并导入已创建报表未完成。请先确认领星下载中心已有当前范围的已创建/可下载报表。'
        : '创建并下载未完成。请根据错误处理登录、页面模型或报表范围后重试。');
    } finally {
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      setRunningAction(null);
      setFeedbackActionGroup(null);
    }
  }

  async function importCurrentReports() {
    const api = (window as any).electronAPI;
    let captured: ReturnType<typeof captureBusinessImportScope>;
    try {
      captured = captureBusinessImportScope();
    } catch (caught) {
      setActionNotice('真实报表导入未开始。');
      setActionError(toUserFacingError(caught, '当前店铺授权不可用。'));
      return;
    }
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
      const result = await api.importCurrentBusinessReports(captured.input);
      if (!isCapturedAuthorityCurrent(captured.authorityKey)) return;
      window.dispatchEvent(new Event('business-ui:data-updated'));
      const inserted = result?.metricsImport?.inserted ?? 0;
      const parsedFiles = result?.metricsImport?.parsedFiles ?? 0;
      const errors = result?.metricsImport?.errors?.length ?? 0;
      const realFileCount = result?.pipeline?.collection?.fileAudit?.realReportFileCount ?? result?.pipeline?.collection?.realReportFiles?.length ?? realReportCount;
      const importedRows = result?.pipeline?.collection?.fileAudit?.importedRowCount ?? result?.pipeline?.quant?.importedRows ?? inserted;
      const refreshedReadiness = buildPipelineReadiness(result?.pipeline, reportOptions, realFileCount, importedRows);
      setLastActionResult(buildLastActionResult('import', [result], realFileCount, importedRows, {
        downloadArtifactId: result?.pipeline?.collection?.fileAudit?.downloadArtifactId,
        manifestArtifactId: result?.pipeline?.collection?.fileAudit?.manifestArtifactId,
      }, refreshedReadiness.canEnterDiagnosis));
      if (parsedFiles <= 0 || errors > 0) {
        const reason = errors > 0
          ? `有 ${errors} 个报表解析失败`
          : '没有形成有效导入回执';
        setActionError(`真实报表导入未形成可量化广告数据：${reason}。请检查表头、日期、广告活动/广告组/关键词/投放对象和花费/订单/销售列。`);
        setActionNotice(`导入未完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标，错误 ${errors} 个。`);
        return;
      }
      setActionNotice(inserted > 0
        ? `导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标，错误 ${errors} 个。`
        : `导入回执完成：解析 ${parsedFiles} 个有效空表，写入 0 行；哈希与零行回执已登记，系统将按完整 8 类任务血缘重新核对。`);
    } catch (caught) {
      if (!isCapturedAuthorityCurrent(captured.authorityKey)) return;
      const message = toUserFacingError(caught, '真实报表导入未完成。');
      setActionError(message);
      setActionNotice('真实报表导入未完成。');
    } finally {
      if (isCapturedAuthorityCurrent(captured.authorityKey)) {
        setRunningAction(null);
        setFeedbackActionGroup(null);
      }
    }
  }

  async function importLocalReports() {
    const api = (window as any).electronAPI;
    let captured: ReturnType<typeof captureBusinessImportScope>;
    try {
      captured = captureBusinessImportScope();
    } catch (caught) {
      setActionNotice('本地真实报表导入未开始。');
      setActionError(toUserFacingError(caught, '当前店铺授权不可用。'));
      return;
    }
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
      const result = await api.importLocalBusinessReportFiles(captured.input);
      if (!isCapturedAuthorityCurrent(captured.authorityKey)) return;
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
      const refreshedReadiness = buildPipelineReadiness(result?.pipeline, reportOptions, realFileCount, importedRows);
      setLastActionResult(buildLastActionResult('import', [result], realFileCount, importedRows, {
        downloadArtifactId: result?.pipeline?.collection?.fileAudit?.downloadArtifactId || result?.batch?.downloadArtifactId,
        manifestArtifactId: result?.pipeline?.collection?.fileAudit?.manifestArtifactId || result?.batch?.manifestArtifactId,
      }, refreshedReadiness.canEnterDiagnosis));
      if (parsedFiles <= 0 || errors > 0) {
        const reason = errors > 0
          ? `有 ${errors} 个本地报表解析失败`
          : '没有形成有效导入回执';
        setActionError(`本地真实报表导入未形成可量化广告数据：${reason}。请检查文件名是否能识别报表类型、表头和日期范围。`);
        setActionNotice(`本地导入未完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标，错误 ${errors} 个。`);
        return;
      }
      setActionNotice(inserted > 0
        ? `本地导入完成：解析 ${parsedFiles} 个真实报表，写入 ${inserted} 行广告指标，错误 ${errors} 个。`
        : `本地导入回执完成：解析 ${parsedFiles} 个有效空表，写入 0 行；哈希与零行回执已登记，系统将按完整 8 类任务血缘重新核对。`);
    } catch (caught) {
      if (!isCapturedAuthorityCurrent(captured.authorityKey)) return;
      const message = toUserFacingError(caught, '本地真实报表导入未完成。');
      setActionError(message);
      setActionNotice('本地真实报表导入未完成。');
    } finally {
      if (isCapturedAuthorityCurrent(captured.authorityKey)) {
        setRunningAction(null);
      }
    }
  }

  function renderOpenArtifactButton(input: {
    className?: string;
    disabled?: boolean;
    idleLabel: string;
    messageLabel?: string;
    artifactId: string;
  }) {
    const messageLabel = input.messageLabel || input.idleLabel;
    const view = collectionOpenArtifactButtonView({
      activeArtifactKey: openingArtifactKey,
      baseClassName: input.className,
      disabled: input.disabled,
      idleLabel: input.idleLabel,
      artifactKey: collectionArtifactActionKey(messageLabel, input.artifactId),
    });
    return (
      <button
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        onClick={() => openArtifact(input.artifactId, messageLabel)}
        type="button"
      >
        {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
        <span>{view.label}</span>
      </button>
    );
  }

  function renderOpenArtifactChip(file: {
    displayName: string;
    fileName: string;
    fileExtension?: string;
    artifactId: string;
    id?: string;
    importedRows?: number;
    smallText?: string;
  }) {
    const view = collectionOpenArtifactButtonView({
      activeArtifactKey: openingArtifactKey,
      baseClassName: 'real-file-chip',
      idleLabel: file.displayName,
      artifactKey: collectionArtifactActionKey(file.displayName, file.artifactId),
    });
    return (
      <button
        aria-busy={view.ariaBusy}
        className={view.className}
        disabled={view.disabled}
        key={file.id || file.artifactId}
        onClick={() => openArtifact(file.artifactId, file.displayName)}
        type="button"
      >
        <span>{file.displayName}</span>
        <strong>{file.fileName}</strong>
        <small>
          {view.showSpinner && <span aria-hidden="true" className="button-spinner" />}
          {view.showSpinner ? view.label : file.smallText || `${getFileExtension(file.fileName, file.fileExtension)} / ${file.importedRows || 0} 行`}
        </small>
      </button>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.dataCollection}
        description="直接选择 8 类真实广告报表并执行下载、重建或本地导入；流程账本和技术细节放在下方辅助区。"
      />

      <TaskBanner
        description={taskState.detail}
        meta={`生产血缘 ${realReportCount}/8 类 · ${selectedCount}/${reportOptions.length} 类已选 · ${importedRowCount} 行已入库`}
        primaryAction={{
          label: taskState.primaryActionLabel,
          busy: primaryTaskBusy || collectionJobsLoading,
          busyLabel: collectionJobsLoading ? '核对任务中...' : taskState.primaryActionLabel,
          disabled: Boolean(collectionJobsLoading || runningAction || (manualReconciliationRequired && dataLedger.nextStep !== 'import' && !taskState.isComplete)),
          onClick: taskState.isComplete
            ? () => navigate('ad-quant')
            : dataLedger.nextStep === 'import'
              ? () => { void importCurrentReports(); }
              : () => { void runDownloadAction('recreate-full'); },
        }}
        secondaryActions={[
          {
            label: taskState.secondaryActionLabel,
            disabled: Boolean(runningAction || openingArtifactKey),
            onClick: primaryReportFolderArtifactId
              ? () => { void openArtifact(primaryReportFolderArtifactId, '打开报表目录'); }
              : () => { void importLocalReports(); },
          },
          { label: '调整报表范围', onClick: () => setReportSelectorOpen(true), disabled: Boolean(runningAction) },
        ]}
        status={collectionJobsLoading ? '核对任务中' : productionDataReady ? '生产数据已闭合' : productionLineageReadiness.latestJobId ? '生产血缘未闭合' : '缺生产任务'}
        title={taskState.title}
        tone={productionDataReady ? 'confirmed' : productionLineageReadiness.state === 'partial' ? 'attention' : 'blocked'}
      />

      <div className="business-stack">
        {collectionMonitorOpen && collectionMonitorState && (
          <CollectionMonitorDrawer
            evidenceAvailable={collectionMonitorEvidenceAvailable}
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
            </div>
          </div>
        )}

        <Panel
          className="data-collection-primary-panel"
          title="生产 8 类报表工作台"
          titleAccessory={
            reportStatusLoading
              ? <StatusPill tone="pending">读取中</StatusPill>
              : <StatusPill tone={realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked'}>{realReportCount}/8 类</StatusPill>
          }
          tone={reportStatusLoading ? undefined : realReportCount >= 8 ? 'success' : realReportCount > 0 ? 'warning' : 'blocked'}
        >
          <div className="data-collection-summary-strip" aria-label="当前报表采集摘要">
            <div>
              <span>报表结构</span>
              <strong>8 类</strong>
              <small>活动、广告组、广告位、商品、关键词和搜索词</small>
            </div>
            <div>
              <span>真实报表</span>
              <strong>{reportStatusLoading ? '读取中' : `${realReportCount}/8`}</strong>
              <small>{reportStatusLoading ? '正在读取当前范围目录' : realReportCount >= 8 ? '当前范围已覆盖完整报表' : '缺失项在选择弹窗内处理'}</small>
            </div>
            <div>
              <span>入库指标</span>
              <strong>{reportStatusLoading ? '读取中' : `${importedRowCount} 行`}</strong>
              <small>广告量化只读取真实表格入库数据</small>
            </div>
            <div className="data-collection-summary-action data-collection-summary-selection">
              <div>
                <span>下载范围</span>
                <strong>{reportStatusLoading ? '读取中' : `${selectedCount}/${reportOptions.length}`}</strong>
                <small>本次下载/重建范围</small>
              </div>
              <button className="secondary-button compact-button" onClick={() => setReportSelectorOpen(true)} type="button">
                调整
              </button>
            </div>
          </div>
          <p className="collection-selection-live" aria-live="polite">{reportSelectionState.ariaStatus}</p>
          <details className="data-collection-secondary-actions">
            <summary>
              <span>更多报表操作</span>
              <StatusPill tone="pending">{selectedCount}/{reportOptions.length} 已选</StatusPill>
            </summary>
            <div className="data-collection-secondary-action-row">
              <button
                aria-busy={downloadExistingButton.ariaBusy}
                className={downloadExistingButton.className}
                disabled={downloadExistingButton.disabled}
                onClick={() => runDownloadAction('download-existing')}
                type="button"
              >
                <span className={downloadExistingButton.ariaBusy ? 'button-content' : undefined}>
                  {downloadExistingButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {downloadExistingButton.label}
                </span>
              </button>
              <button
                aria-busy={recreateSelectedButton.ariaBusy}
                className={recreateSelectedButton.className}
                disabled={recreateSelectedButton.disabled || manualReconciliationRequired}
                onClick={() => runDownloadAction('recreate-selected')}
                type="button"
              >
                <span className={recreateSelectedButton.ariaBusy ? 'button-content' : undefined}>
                  {recreateSelectedButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {recreateSelectedButton.label}
                </span>
              </button>
              <button
                aria-busy={importButton.ariaBusy}
                className={importButton.className}
                disabled={importButton.disabled}
                onClick={importLocalReports}
                type="button"
              >
                <span className={importButton.ariaBusy ? 'button-content' : undefined}>
                  {importButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {importButton.label}
                </span>
              </button>
            </div>
          </details>
          {primaryReportFolderArtifactId && (
            <div className="data-collection-folder-line">
              <span>当前范围原始报表目录</span>
              <strong>已创建，可打开</strong>
              {renderOpenArtifactButton({ className: 'secondary-button compact-button', idleLabel: '打开目录', artifactId: primaryReportFolderArtifactId })}
            </div>
          )}
          {(aggregateRealReportCount !== realReportCount || aggregateImportedRowCount !== importedRowCount) && (
            <p className="warning-line">
              当前日期窗聚合检测到 {aggregateRealReportCount}/8 类文件、{aggregateImportedRowCount} 行指标；其中只有 {realReportCount}/8 类、{importedRowCount} 行绑定最新生产授权链，其余批次不参与放行。
            </p>
          )}
        </Panel>

        <Panel
          title="当前日期窗生产血缘"
          titleAccessory={(
            <StatusPill tone={collectionJobsLoading ? 'pending' : productionDataReady ? 'ready' : productionLineageReadiness.state === 'partial' ? 'warning' : 'blocked'}>
              {collectionJobsLoading ? '核对中' : productionDataReady ? '已闭合' : productionLineageReadiness.state === 'missing' ? '缺任务' : '未闭合'}
            </StatusPill>
          )}
          tone={productionDataReady ? 'success' : productionLineageReadiness.state === 'partial' ? 'warning' : 'blocked'}
        >
          <div className="context-summary-grid">
            <div>
              <span>生产 root</span>
              <strong>{productionLineageReadiness.rootJobId || '未建立'}</strong>
              <p>{productionLineageReadiness.lineageId ? `lineage ${productionLineageReadiness.lineageId}` : '独立部分任务不能拼接成生产 8/8。'}</p>
            </div>
            <div>
              <span>授权链任务</span>
              <strong>{productionLineageReadiness.lineageJobIds.length} 个</strong>
              <p>{productionLineageReadiness.latestJobId ? `最近任务 ${productionLineageReadiness.latestJobId}` : `${scope.dateFrom} 至 ${scope.dateTo}`}</p>
            </div>
            <div>
              <span>文件批次匹配</span>
              <strong>{productionLineageReadiness.sourceMatchedReportCount}/8 类</strong>
              <p>只计入与最终 downloaded 检查点同 batchId 的真实表格。</p>
            </div>
            <div>
              <span>生产入库</span>
              <strong>{productionLineageReadiness.importedReportCount}/8 类 · {productionLineageReadiness.importedRows} 行</strong>
              <p>每类任务都必须持久化 importState=succeeded。</p>
            </div>
          </div>
          {collectionJobsPreviewOnly && (
            <p className="warning-line" role="status">DEV 预览不会注入伪造任务、lineage、下载或入库成功，不提供生产就绪证明。</p>
          )}
          {collectionJobsError && <p className="blocked-line" role="alert">生产任务读取失败：{collectionJobsError}</p>}
          {!collectionJobsLoading && !collectionJobsError && !productionDataReady && (
            <p className="warning-line">{productionLineageReadiness.detail}</p>
          )}
        </Panel>

        <CollectionJobWorkspace
          actionBusyKey={collectionJobActionBusyKey}
          currentContext={storeAuthority.authoritativeContext}
          error={collectionJobsError}
          jobs={collectionJobs}
          loading={collectionJobsLoading}
          previewOnly={collectionJobsPreviewOnly}
          onCancel={(job) => { void cancelCollectionJob(job); }}
          onRefresh={() => {
            const context = storeAuthority.authoritativeContext;
            const authorityKey = storeAuthority.authorityKey;
            if (context && authorityKey) void loadRecentCollectionJobs(context, authorityKey);
          }}
          onResume={(job) => { void resumeCollectionJob(job); }}
        />

        {reportSelectorOpen && (
          <div
            className="collection-selector-modal-backdrop"
            ref={reportSelectorDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="collection-selector-title"
              aria-modal="true"
              className="collection-selector-modal"
              ref={reportSelectorDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <header className="collection-selector-modal-header">
                <div>
                  <span>报表选择</span>
                  <h2 id="collection-selector-title">调整本次下载/重建的报表</h2>
                </div>
                <button className="secondary-button compact-button" onClick={() => setReportSelectorOpen(false)} type="button">
                  关闭
                </button>
              </header>
              <div className="collection-selector-modal-body">
                <div className="data-collection-workbench-toolbar collection-selector-toolbar">
                  <div>
                    <span>当前选择</span>
                    <strong key={reportSelectionState.countLabel} className={reportSelectionState.countClassName}>
                      {reportSelectionState.countLabel}
                    </strong>
                    <p className="collection-selection-live" aria-live="polite">{reportSelectionState.ariaStatus}</p>
                  </div>
                  <div className="table-action-row">
                    <button className="secondary-button compact-button" onClick={() => setSelectedTypes(reportOptions.map((item) => item.type))} type="button">
                      全选 8 类
                    </button>
                    <button className="secondary-button compact-button" disabled={reportStatusLoading || missingReportTypes.length === 0} onClick={() => setSelectedTypes(missingReportTypes)} type="button">
                      只选缺失
                    </button>
                    <button className="secondary-button compact-button" disabled={reportStatusLoading || unimportedReportTypes.length === 0} onClick={() => setSelectedTypes(unimportedReportTypes)} type="button">
                      只选未入库
                    </button>
                    <button className="secondary-button compact-button" disabled={selectedCount === 0} onClick={() => setSelectedTypes([])} type="button">
                      清空
                    </button>
                  </div>
                </div>
                <div className="report-option-grid data-collection-report-grid collection-selector-grid">
                  {productionReportOptions.map((item) => (
                    <label
                      className={[
                        'report-option',
                        item.realFileAvailable ? 'report-option-ready' : '',
                        selectedTypes.includes(item.type) ? 'report-option-selected' : '',
                      ].filter(Boolean).join(' ')}
                      key={item.type}
                    >
                      <input
                        checked={selectedTypes.includes(item.type)}
                        onChange={() => toggleReport(item.type)}
                        type="checkbox"
                      />
                      <span>{item.label}</span>
                      <strong>{reportStatusLoading ? '状态读取中' : item.realFileAvailable ? '有真实文件' : '缺真实文件'}</strong>
                      <small>{reportStatusLoading ? '等待当前范围数据返回' : `${item.importedRows} 行导入 / ${reportStatusLabel(item.status)}`}</small>
                    </label>
                  ))}
                </div>
              </div>
              <footer className="collection-selector-modal-footer">
                <button className="primary-button" onClick={() => setReportSelectorOpen(false)} type="button">
                  确认选择
                </button>
                <button className="secondary-button" onClick={() => setReportSelectorOpen(false)} type="button">
                  关闭
                </button>
              </footer>
            </section>
          </div>
        )}

        {selectedReportFile && (
          <div
            className="collection-selector-modal-backdrop"
            ref={reportFileDialogFocus.overlayRootRef}
            role="presentation"
          >
            <section
              aria-labelledby="collection-file-detail-title"
              aria-modal="true"
              className="collection-selector-modal collection-file-modal"
              ref={reportFileDialogFocus.surfaceRef}
              role="dialog"
              tabIndex={-1}
            >
              <header className="collection-selector-modal-header">
                <div>
                  <span>真实报表文件</span>
                  <h2 id="collection-file-detail-title">{selectedReportFile.displayName}</h2>
                </div>
                <button className="secondary-button compact-button" onClick={() => setSelectedReportFile(null)} type="button">
                  关闭
                </button>
              </header>
              <div className="collection-selector-modal-body collection-file-modal-body">
                <div className="collection-file-status-strip">
                  <div>
                    <span>入库状态</span>
                    <strong>{selectedReportFileImported ? '已入库' : selectedReportFile.importError ? '导入失败' : '未入库'}</strong>
                  </div>
                  <div>
                    <span>DB 指标行数</span>
                    <strong>{selectedReportFile.importedRows}</strong>
                  </div>
                  <div>
                    <span>文件状态</span>
                    <strong>{reportStatusLabel(selectedReportFileBinding?.state || selectedReportFile.status)}</strong>
                  </div>
                </div>
                {selectedReportFile.importError && (
                  <p className="blocked-line collection-file-error">{selectedReportFile.importError}</p>
                )}
                <div className="collection-file-detail-grid">
                  <div>
                    <span>文件名</span>
                    <strong>{selectedReportFile.fileName || '-'}</strong>
                  </div>
                  <div>
                    <span>扩展名</span>
                    <strong>{getFileExtension(selectedReportFile.fileName, selectedReportFile.fileExtension)}</strong>
                  </div>
                  <div>
                    <span>文件大小</span>
                    <strong>{formatFileSize(selectedReportFile.fileSizeBytes)}</strong>
                  </div>
                  <div>
                    <span>最近入库</span>
                    <strong>{formatUpdatedAt(selectedReportFile.lastImportedAt || selectedReportFile.updatedAt)}</strong>
                  </div>
                  <div>
                    <span>文件指纹</span>
                    <strong>{shortHash(selectedReportFile.fileHash)}</strong>
                  </div>
                  <div>
                    <span>受控目录</span>
                    <strong>{selectedReportFile.folderArtifactId ? selectedReportFile.folderDisplayName || '已登记' : '-'}</strong>
                  </div>
                </div>
                <div className="collection-file-path-block">
                  <span>本地文件访问</span>
                  <strong>{selectedReportFile.artifactId ? '已绑定当前店铺的受控工件' : '未登记可打开工件'}</strong>
                </div>
              </div>
              <footer className="collection-selector-modal-footer collection-file-modal-footer">
                {renderOpenArtifactButton({
                  className: 'secondary-button',
                  disabled: !selectedReportFile.artifactId,
                  idleLabel: '打开文件',
                  messageLabel: `打开${selectedReportFile.displayName}`,
                  artifactId: selectedReportFile.artifactId || '',
                })}
                {renderOpenArtifactButton({
                  className: 'secondary-button',
                  disabled: !selectedReportFile.folderArtifactId,
                  idleLabel: '打开文件夹',
                  messageLabel: `打开${selectedReportFile.displayName}文件夹`,
                  artifactId: selectedReportFile.folderArtifactId || '',
                })}
                <button className="primary-button" onClick={() => setSelectedReportFile(null)} type="button">
                  知道了
                </button>
              </footer>
            </section>
          </div>
        )}

        <div className="kpi-row data-collection-prototype-status-grid" aria-label="数据采集状态">
          <KpiCard
            label="浏览器状态"
            value={lastDiagnostic?.ready ? '就绪' : '待验证'}
            detail={lastDiagnostic?.ready ? 'Lingxing 会话有效' : '需要验证下载中心页面'}
            tone={lastDiagnostic?.ready ? 'ready' : 'warning'}
          />
          <KpiCard
            label="下载中心"
            value={realReportCount >= 8 ? '已完成' : realReportCount > 0 ? '部分完成' : '待采集'}
            detail={`${realReportCount}/8 类真实报表`}
            tone={realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked'}
          />
          <KpiCard
            label="报表目录"
            value={primaryReportFolderArtifactId ? '可打开' : '待创建'}
            detail={primaryReportFolderArtifactId ? '当前范围原始报表目录已创建' : '等待首次真实报表落盘'}
            tone={primaryReportFolderArtifactId ? 'ready' : 'pending'}
          />
          <KpiCard
            label="入库指标"
            value={`${importedRowCount} 行`}
            detail={importedReadinessStage?.status === 'complete' ? '8 类已逐类写入本地 DB' : importedReportCount > 0 ? `${importedReportCount}/8 类已有入库回执` : '等待导入'}
            tone={importedReadinessStage?.status === 'complete' ? 'ready' : importedReportCount > 0 ? 'warning' : 'blocked'}
          />
        </div>

        <Panel title="采集进度" tone={realReportCount >= 8 ? 'success' : realReportCount > 0 ? 'warning' : 'blocked'}>
          {liveProgressPresentation && (
            <div
              aria-atomic="true"
              aria-live="polite"
              className={`collection-action-feedback ${liveProgressPresentation.tone === 'blocked' ? 'collection-action-feedback-blocked' : liveProgressPresentation.tone === 'ready' ? 'collection-action-feedback-ready' : 'collection-action-feedback-running'}`}
              role="status"
            >
              <div>
                <span>领星实时任务</span>
                <strong>{liveProgressPresentation.title}</strong>
                <p>{liveProgressPresentation.detail}</p>
              </div>
              <div className="collection-action-feedback-side">
                <StatusPill tone={liveProgressPresentation.tone}>{liveProgressPresentation.statusLabel}</StatusPill>
                <small>{liveProgressPresentation.completedCount}/{liveProgressPresentation.totalCount} 类已下载</small>
              </div>
            </div>
          )}
          <MicroStepper
            items={[
              {
                label: '下载',
                meta: liveProgressPresentation
                  ? `${liveProgressPresentation.completedCount}/${liveProgressPresentation.totalCount}`
                  : `${realReportCount}/8`,
                detail: liveProgressPresentation?.detail
                  || (realReportCount >= 8 ? '8 类真实报表已留存。' : '等待领星下载中心生成并下载。'),
                tone: liveProgressPresentation?.tone
                  || (realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked'),
              },
              {
                label: '校验',
                meta: fileAudit?.missingReportLabels?.length ? `${fileAudit.missingReportLabels.length} 类缺失` : '待执行',
                detail: '只接受 xlsx/xls/csv 原始广告报表。',
                tone: realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'pending',
              },
              {
                label: '排除证据文件',
                meta: rejectedEvidenceCount ? `${rejectedEvidenceCount} 个证据文件` : '无阻断',
                detail: '截图、DOM、审计包只做证据，不参与广告表现计算。',
                tone: hasOnlyDiagnosticFiles ? 'blocked' : 'ready',
              },
              {
                label: '入库',
                meta: `${importedRowCount} 行`,
                detail: importedReadinessStage?.status === 'complete' ? '8 类指标已逐类写入本地数据库。' : importedReportCount > 0 ? `${importedReportCount}/8 类已有入库回执，仍需补齐。` : '下载完成后进入导入校验。',
                tone: importedReadinessStage?.status === 'complete' ? 'ready' : 'pending',
              },
            ]}
          />
          <div className="action-row">
            <button
              aria-busy={recreateFullButton.ariaBusy}
              className={recreateFullButton.className}
              disabled={recreateFullButton.disabled || manualReconciliationRequired}
              onClick={() => runDownloadAction('recreate-full')}
              type="button"
            >
              <span className={recreateFullButton.ariaBusy ? 'button-content' : undefined}>
                {recreateFullButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                {recreateFullButton.label}
              </span>
            </button>
            <button
              className="secondary-button"
              disabled={Boolean(runningAction || openingArtifactKey)}
              onClick={primaryReportFolderArtifactId ? () => openArtifact(primaryReportFolderArtifactId, '打开报表目录') : importLocalReports}
              type="button"
            >
              {primaryReportFolderArtifactId ? '打开报表目录' : '导入本地报表'}
            </button>
          </div>
          {loading && <p className="muted-line">正在读取采集状态...</p>}
          {error && <p className="blocked-line">读取接口异常：{error}</p>}
        </Panel>

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
              {((!runningAction && shouldShowVerifyAction) || feedbackActionGroup === 'repair') && (
                <div className="collection-action-feedback-actions">
                  <button
                    aria-busy={verifyFeedbackButton.ariaBusy}
                    className={verifyFeedbackButton.className}
                    disabled={verifyFeedbackButton.disabled}
                    onClick={() => {
                      setFeedbackActionGroup('repair');
                      void runVerifyDownloadCenter();
                    }}
                    type="button"
                  >
                    {verifyFeedbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{verifyFeedbackButton.label}</span>
                  </button>
                  <button
                    aria-busy={retryFullFeedbackButton.ariaBusy}
                    className={retryFullFeedbackButton.className}
                    disabled={retryFullFeedbackButton.disabled || manualReconciliationRequired}
                    onClick={() => {
                      setFeedbackActionGroup('repair');
                      void runDownloadAction('recreate-full');
                    }}
                    type="button"
                  >
                    {retryFullFeedbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{retryFullFeedbackButton.label}</span>
                  </button>
                </div>
              )}
              {((!runningAction && !actionError && lastDiagnostic?.ready) || feedbackActionGroup === 'refresh-ready') && (
                <div className="collection-action-feedback-actions">
                  <button
                    aria-busy={refreshFullFeedbackButton.ariaBusy}
                    className={refreshFullFeedbackButton.className}
                    disabled={refreshFullFeedbackButton.disabled || manualReconciliationRequired}
                    onClick={() => {
                      setFeedbackActionGroup('refresh-ready');
                      void runDownloadAction('recreate-full');
                    }}
                    type="button"
                  >
                    {refreshFullFeedbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{refreshFullFeedbackButton.label}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {primaryReportFolderArtifactId && (
          <Panel title="真实报表目录" tone="success">
            <div className="business-split">
              <div>
                <div className="business-scope-line">当前范围原始报表目录已创建，可直接打开</div>
                <p className="muted-line">这里只放当前范围可用于后续广告表现的 Lingxing xlsx/xls/csv 原始报表。</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={productionDataReady ? 'ready' : 'warning'}>{productionDataReady ? '生产血缘已闭合' : '生产血缘待闭合'}</StatusPill>
                {renderOpenArtifactButton({ idleLabel: '打开报表目录', artifactId: primaryReportFolderArtifactId })}
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
                <div className="business-scope-line">系统只在四段都闭合后放行广告表现、AI 证据包和优化建议。</div>
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
              <p className="blocked-line">当前文件夹只有诊断/审计文件，没有真实广告报表。系统不能用于广告表现计算。</p>
            )}
            <p className="warning-line">审计文件、截图、DOM/HTML 和采集清单只用于证明流程，不是广告数据，不能参与广告表现计算。</p>
            {(fileAudit?.missingReportLabels?.length || 0) > 0 && (
              <p className="muted-line">
                缺少真实报表：{fileAudit?.missingReportLabels.slice(0, 8).join('、')}
              </p>
            )}
            <div className="action-row">
              {fileAudit?.downloadArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开真实报表目录', artifactId: fileAudit.downloadArtifactId })
              )}
              {fileAudit?.manifestArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开采集清单', artifactId: fileAudit.manifestArtifactId })
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
                <strong>{primaryReportFolderArtifactId ? '已登记当前店铺报表目录' : '暂无目录'}</strong>
                <p>这里应能看到 Lingxing 下载的 xlsx/xls/csv，后续广告表现只读取这些文件。</p>
              </div>
              <div>
                <span>采集清单</span>
                <strong>{fileAudit?.manifestArtifactId ? fileAudit.manifestDisplayName || '采集清单已登记' : '暂无采集清单'}</strong>
                <p>记录批次、文件名、状态和下载结果，用来追溯，不是广告数据表。</p>
              </div>
              <div>
                <span>验收/诊断证据</span>
                <strong>{primaryAuditArtifactId ? '审计证据已登记' : `${rejectedEvidenceCount} 个证据文件`}</strong>
                <p>这里只放审计文件、截图、HTML 等证据；找广告数据请打开“真实广告表格”目录。</p>
              </div>
              <div>
                <span>广告表现入口</span>
                <strong>{productionDataReady ? `${importedRowCount} 行 · 8/8 类已入库` : importedReportCount > 0 ? `${importedReportCount}/8 类已有入库回执` : '未导入'}</strong>
                <p>{productionDataReady ? '完整生产血缘已闭合；0 行时会展示真实零数据状态。' : realReportCount > 0 ? '先确认表格存在；若缺少入库回执，再点击“导入已下载表格”。' : '先下载并导入已创建报表、重新创建下载并导入，或导入本地报表。'}</p>
              </div>
            </div>
            <div className="action-row">
              {primaryReportFolderArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开真实报表目录', artifactId: primaryReportFolderArtifactId })
              )}
              {fileAudit?.manifestArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开采集清单', artifactId: fileAudit.manifestArtifactId })
              )}
              {primaryAuditArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开审计证据', artifactId: primaryAuditArtifactId })
              )}
            </div>
            <div className="real-file-summary">
              <div className="real-file-summary-header">
                <strong>当前真实报表清单</strong>
                <span>{realFiles.length ? `${realReportCount}/8 类，${importedRowCount} 行已导入` : '暂无 xlsx/xls/csv 文件'}</span>
              </div>
              {realFiles.length ? (
                <div className="real-file-chip-grid">
                  {visibleRealFiles.filter((file) => Boolean(file.artifactId)).map((file) => renderOpenArtifactChip({
                    ...file,
                    artifactId: file.artifactId || '',
                  }))}
                  {hiddenRealFileCount > 0 && (
                    <div className="real-file-chip real-file-chip-muted">
                      <span>更多文件</span>
                      <strong>+{hiddenRealFileCount}</strong>
                      <small>底部完整表格可查看全部文件元数据</small>
                    </div>
                  )}
                </div>
              ) : (
                <p className="blocked-line">当前没有真实广告报表。请先下载并导入已创建报表，或重新创建、下载并导入 8 类报表；只有审计包时系统不能量化广告。</p>
              )}
            </div>
          </Panel>
        </ProgressiveDetails>

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
                    <p>{lastActionSummary.blockers.length ? lastActionSummary.blockers.join('；') : '动作已返回；以当前范围数据账本的逐类入库状态作为最终放行依据。'}</p>
                  </div>
                  <div>
                    <span>导入状态</span>
                    <strong>{lastActionSummary.facts.slice(2).join(' / ')}</strong>
                    <p>{lastActionSummary.nextAction}</p>
                  </div>
                  <div>
                    <span>受控证据</span>
                    <strong>{lastActionSummary.primaryArtifactLabel}</strong>
                    <p>{lastActionSummary.primaryArtifactId ? '已绑定当前店铺工件，可受控打开。' : '暂无可打开工件，请查看失败原因。'}</p>
                  </div>
                </div>
                {lastActionSummary.primaryArtifactId && (
                  <div className="action-row">
                    {renderOpenArtifactButton({ idleLabel: '打开动作证据', artifactId: lastActionSummary.primaryArtifactId })}
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
            {(lastActionResult.downloadArtifactId || lastActionResult.manifestArtifactId || primaryReportFolderArtifactId) && (
              <div className="action-row">
                {lastActionResult.downloadArtifactId && (
                  renderOpenArtifactButton({
                    idleLabel: lastActionResult.mode === 'import' ? '打开本次导入目录' : '打开本次下载目录',
                    artifactId: lastActionResult.downloadArtifactId,
                  })
                )}
                {lastActionResult.manifestArtifactId && (
                  renderOpenArtifactButton({ idleLabel: '打开本次采集清单', artifactId: lastActionResult.manifestArtifactId })
                )}
                {primaryReportFolderArtifactId && (
                  renderOpenArtifactButton({ idleLabel: '打开当前真实报表目录', artifactId: primaryReportFolderArtifactId })
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
                    renderOpenArtifactChip({
                      displayName: file.label,
                      fileName: file.fileName,
                      fileExtension: file.fileExtension,
                      artifactId: file.artifactId,
                      smallText: `${formatFileSize(file.fileSizeBytes)} / 点击打开表格`,
                    })
                  ))}
                </div>
              </div>
            )}
            {lastActionResult.actionDownloadedFiles.length === 0 && lastActionResult.failedFiles.length === 0 && (
              <p className={lastActionResult.downloadedCount > 0 ? 'warning-line' : 'blocked-line'}>
                {lastActionResult.downloadedCount > 0
                  ? '当前范围已有真实报表，但本次动作没有新增真实下载文件。请点击“打开当前真实报表目录”确认文件，或直接导入已下载报表。'
                  : lastActionResult.mode === 'import'
                    ? '本次导入没有返回已登记的真实报表工件。请重新选择领星 xlsx/xls/csv 原始报表，不要选择审计包。'
                    : '本次动作没有返回已登记的真实报表工件。请打开本次采集清单核对文件，只有 xlsx/xls/csv 才能进入量化。'}
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
                    <th>文件</th>
                    <th>文件大小</th>
                    <th>入库状态</th>
                    <th>DB 指标行数</th>
                    <th>最近入库</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {realFiles.map((file) => {
                    const binding = productionBindingByType.get(file.reportType as ProductionCollectionReportBinding['reportType']);
                    const hasImportReceipt = productionReportFileHasImportReceipt(file, binding);
                    return (
                    <tr key={file.id}>
                      <td>{file.displayName}</td>
                      <td>
                        <strong>{file.fileName || file.artifactDisplayName || '已登记报表'}</strong>
                        <div className="table-subtext">{getFileExtension(file.fileName, file.fileExtension)}</div>
                      </td>
                      <td>{formatFileSize(file.fileSizeBytes)}</td>
                      <td>
                        <span>{hasImportReceipt ? '已入库' : file.importError ? '导入失败' : '未入库'}</span>
                        {file.importError && <div className="blocked-line table-subtext">{file.importError}</div>}
                      </td>
                      <td>{file.importedRows}</td>
                      <td>{formatUpdatedAt(file.lastImportedAt || file.updatedAt)}</td>
                      <td>{reportStatusLabel(binding?.state || file.status)}</td>
                      <td>
                        <div className="table-action-row">
                          <button
                            aria-label={`查看${file.displayName}文件详情`}
                            className="secondary-button compact-button"
                            onClick={() => setSelectedReportFile(file)}
                            type="button"
                          >
                            查看
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {!realFiles.length && (
                    <tr>
                      <td colSpan={8}>{hasOnlyDiagnosticFiles ? '当前文件夹只有诊断/审计文件，没有真实广告报表。系统不能用于广告表现计算。' : '当前范围还没有可量化的真实广告数据'}</td>
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
