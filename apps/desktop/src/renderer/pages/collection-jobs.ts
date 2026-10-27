import { rendererRuntimeLog } from '../runtime-log';
import React from 'react';
import { missionControlContextKey, normalizeStoreContextEnvelope, type LingxingCollectionJobSnapshot, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { type CollectionJobLineagePresentation, type CollectionImportPresentation, type CollectionJobWorkspaceRow, type CollectionJobWorkspaceAction } from './collection-contracts';
import { reportDisplayName } from './collection-progress';

export function buildCollectionJobLineagePresentation(
  job: LingxingCollectionJobSnapshot,
): CollectionJobLineagePresentation {
  if (job.request.requestId.startsWith('canary:')) {
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
  const canary = job.request.requestId.startsWith('canary:');
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
  if (job.importState === 'not_applicable') {
    const requestedCount = new Set(job.request.reportTypes).size;
    const standalonePartial = requestedCount < 8;
    return {
      state: 'not_applicable',
      label: standalonePartial ? '等待完整 8 类后入库' : '完整 8 类尚未入库',
      detail: standalonePartial
        ? '本次部分报表文件已下载，但未写生产指标；请继续原完整 8 类任务或重新获取完整 8 类，系统不会跨独立批次拼接。'
        : '本次完整任务尚未形成 8 类全部成功下载的入库凭证；请继续原任务或重新获取完整 8 类。',
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
  } catch (caught) {
      rendererRuntimeLog.error('collection.collection_jobs_failed', { error: caught });
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

export function collectionActionFeedbackBelongsToAuthority(
  capturedContext: StoreContextEnvelope | null | undefined,
  currentContext: StoreContextEnvelope | null | undefined,
): boolean {
  if (!capturedContext || !currentContext) return false;
  try {
    const captured = normalizeStoreContextEnvelope(capturedContext);
    const current = normalizeStoreContextEnvelope(currentContext);
    return captured.storeId === current.storeId
      && captured.browserProfileId === current.browserProfileId
      && captured.marketplace === current.marketplace
      && captured.currency === current.currency
      && captured.businessTimezone === current.businessTimezone
      && captured.businessDate === current.businessDate
      && current.sessionGeneration >= captured.sessionGeneration;
  } catch (caught) {
      rendererRuntimeLog.error('collection.collection_jobs_failed', { error: caught });
    return false;
  }
}

export function retainCollectionActionFeedback<T>(
  capturedContext: StoreContextEnvelope | null | undefined,
  currentContext: StoreContextEnvelope | null | undefined,
  feedback: T | null,
): T | null {
  return collectionActionFeedbackBelongsToAuthority(capturedContext, currentContext)
    ? feedback
    : null;
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
  const canary = job.request.requestId.startsWith('canary:');
  const importPresentation = buildCollectionImportPresentation(job);
  const requestedCount = Math.max(1, job.request.reportTypes.length);
  const downloadedCount = reports.filter((report) => report.state === 'downloaded').length;
  const manualReports = reports.filter((report) => (
    report.state === 'create_unknown' || report.state === 'creating'
  ));
  const failedReports = reports.filter((report) => (
    report.state === 'failed' || report.state === 'stale_authority' || report.state === 'cancelled'
  ));
  const reconciledCreateFailures = failedReports.filter((report) => (
    report.state === 'failed'
    && (
      report.errorCode === 'LINGXING_CREATE_CONFIRMED_ABSENT'
      || report.errorCode === 'LINGXING_CREATE_CONFIRMED_FAILED'
    )
  ));
  const safeRemainderAvailable = !canary
    && job.request.reportTypes.length === 8
    && reconciledCreateFailures.length > 0
    && reconciledCreateFailures.length === failedReports.length
    && reports.some((report) => report.state === 'queued');
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
    : safeRemainderAvailable
      ? `${reconciledCreateFailures.map(reportDisplayName).join('、')}已确认没有可复用的创建记录；可先完成其余排队报表，重新创建缺失报表需单独确认。`
    : importPresentation.state === 'failed'
      ? importPresentation.detail
      : importPresentation.state === 'not_applicable'
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
    else if (importPresentation.state === 'not_applicable') {
      resolvedStatusLabel = canary
        ? 'Canary 完成（不入生产）'
        : requestedCount < 8
          ? '部分报表已下载，等待完整 8 类'
          : '完整 8 类尚未满足入库条件';
    }
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
    safeRemainderAvailable,
    import: importPresentation,
  };
}
