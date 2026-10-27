import { rendererRuntimeLog } from '../runtime-log';
import React from 'react';
import { missionControlContextKey, type LingxingCollectionProgressEvent, type LingxingCollectionReportCheckpoint, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { localizeCollectionReportType } from '@amazon-ai-ops/business-presenters';
import { type CollectionProgressPresentation, type RunningCollectionActionMode, type LastActionResult, type CollectionMonitorState, type CollectionActionMode, type ActionProgressStep } from './collection-contracts';
import { buildCollectionImportPresentation } from './collection-jobs';
import { actionModeLabel } from './collection-presentation';

export function collectionProgressBelongsToAuthority(
  event: LingxingCollectionProgressEvent | null | undefined,
  currentContext: StoreContextEnvelope | null | undefined,
  currentRequestId?: string | null,
): boolean {
  if (!event?.job?.request?.storeContext || !currentContext) return false;
  try {
    if (missionControlContextKey(event.job.request.storeContext) !== missionControlContextKey(currentContext)) return false;
    return !currentRequestId || event.job.request.requestId === currentRequestId;
  } catch (caught) {
      rendererRuntimeLog.error('collection.collection_progress_failed', { error: caught });
    return false;
  }
}

export function reportProgressLabel(report: LingxingCollectionReportCheckpoint): string {
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

export function reportDisplayName(report: LingxingCollectionReportCheckpoint): string {
  const label = localizeCollectionReportType(report.reportType);
  return label === '未知报表类型' ? String(report.reportType) : label;
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
      const canary = event.job.request.requestId.startsWith('canary:');
      return {
        tone: 'pending',
        statusLabel: canary ? 'Canary 不入生产' : '等待完整 8 类',
        title: canary
          ? 'Canary 采集完成（不写生产指标）'
          : '部分报表已下载，等待原完整 8 类任务',
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
    const isReady = result.tone === 'success' && result.actionImportState !== 'not_applicable';
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

export function buildActionProgressSteps(mode: CollectionActionMode | null, result: LastActionResult | null): ActionProgressStep[] {
  if (!mode && !result) return [];
  const completed = Boolean(result);
  const blocked = result?.tone === 'blocked';
  const currentMode = mode || result?.mode || (result?.title.includes('下载') && result?.title.includes('已创建') ? 'download-existing'
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
  const waitingForFullEight = result?.actionImportState === 'not_applicable'
    && Number(result.actionReportTypeCount || 0) > 0
    && Number(result.actionReportTypeCount || 0) < 8;
  const checkingFullEightEligibility = !result
    && (currentMode === 'download-existing' || currentMode === 'recreate-selected');
  const currentActionImported = result?.actionImportState === 'succeeded'
    || Number(result?.parsedFiles || 0) > 0
    || Number(result?.insertedRows || 0) > 0;
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
      label: waitingForFullEight
        ? '4. 等待完整 8 类生产任务'
        : checkingFullEightEligibility
          ? '4. 核对完整 8 类入库资格'
          : '4. 自动导入广告指标',
      description: waitingForFullEight
        ? '本次部分报表只保留真实文件；继续原完整 8 类任务或重新获取完整 8 类，不会跨批次拼接。'
        : checkingFullEightEligibility
          ? '只有同一生产任务精确覆盖完整 8 类并全部校验通过才会入库；部分任务只保留真实文件。'
        : '下载完成后会自动解析并写入 SQLite；已有表格未入库时可手动点击“导入已下载表格”。',
      status: completed ? (blocked ? 'blocked' : currentActionImported ? 'ready' : 'pending') : 'pending',
    },
  ];
}
