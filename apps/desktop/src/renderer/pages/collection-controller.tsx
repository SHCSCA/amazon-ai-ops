import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type LingxingCollectionJobSnapshot, type LingxingCollectionProgressEvent, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { DEFAULT_BUSINESS_REPORT_OPTIONS, useBusinessDataPipeline } from '../components/business-data';

import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';

import { buildDataReadinessLedger } from '../data-readiness-ledger';
import { buildProductionCollectionLineageReadiness, type ProductionCollectionReportBinding } from '../lingxing-collection-lineage';
import { useMissionControlStoreContext } from '../mission-control/store-context';
import { useScopeStore } from '../scope-store';
import type { BusinessReportFile } from '../types';
import { toUserFacingError } from '../user-facing-error';
import { type RunningCollectionActionMode, type CollectionFeedbackActionGroup, type LastActionResult, type DownloadCollectionActionMode } from './collection-contracts';
import { buildCollectionJobWorkspaceRow, collectionActionFeedbackBelongsToAuthority, retainCollectionActionFeedback, collectionJobBelongsToAuthority, upsertCollectionJobSnapshot, collectionJobBelongsToStore } from './collection-jobs';
import { dataCollectionFirstViewportReportFolder, productionReportFileHasImportReceipt, collectionActionButtonView, collectionFeedbackActionButtonView, collectionReportSelectionState, buildDataCollectionTaskState, collectionArtifactActionKey } from './collection-presentation';
import { buildActionProgressSteps, buildCollectionProgressPresentation, buildCollectionMonitorState, collectionProgressBelongsToAuthority } from './collection-progress';
import { shouldOfferDownloadCenterVerification, runCollectionDownloadAction, collectionActionError } from './collection-download';
import { collectionActionResultStatusLabel, collectionCompletionNotice, buildPipelineReadiness, buildLastActionResult } from './collection-results';
import { createLingxingCollectionRequestId } from './collection-capture';

import { createCollectionAuthorityCapture } from './collection-authority-capture';
import { createCollectionArtifactControls } from './collection-artifact-controls';
import { useCollectionOperation, collectionResumeMode } from './collection-operation';
import { rendererRuntimeLog } from '../runtime-log';
import { refreshCollectionForwardResponse } from './collection-response-feedback';

export function useDataCollectionPage() {

  const { data, error, loading, scope, configurationRequired } = useBusinessDataPipeline();
  const setScope = useScopeStore((state) => state.setScope);
  const storeAuthority = useMissionControlStoreContext();
  const operation = useCollectionOperation(storeAuthority.authoritativeContext);
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
  const authorityContextRef = useRef(storeAuthority.authoritativeContext);
  const collectionFeedbackAuthorityContextRef = useRef<StoreContextEnvelope | null>(
    storeAuthority.authoritativeContext ? { ...storeAuthority.authoritativeContext } : null,
  );
  const collectionRequestIdRef = useRef<string | null>(null);
  const manualReconciliationRequestIdRef = useRef<string | null>(null);
  const collectionJobsLoadSequenceRef = useRef(0);
  const collectionJobActionTokenRef = useRef<string | null>(null);
  authorityKeyRef.current = storeAuthority.authorityKey;
  authorityContextRef.current = storeAuthority.authoritativeContext;
  const reportSelectorDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    onDismiss: () => setReportSelectorOpen(false),
    open: reportSelectorOpen,
  });
  const reportFileDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    onDismiss: () => setSelectedReportFile(null),
    open: Boolean(selectedReportFile),
  });

  const { captureCurrentStoreAuthority, captureBusinessImportScope, captureCollectionRange, isCapturedAuthorityCurrent } = createCollectionAuthorityCapture({ storeAuthority, scope, setScope, authorityKeyRef, collectionRequestIdRef, manualReconciliationRequestIdRef, setLiveCollectionProgress, getApi: () => (window as any).electronAPI, isCurrentEpoch: operation.isCurrentEpoch });
  const { renderOpenArtifactButton, renderOpenArtifactChip } = createCollectionArtifactControls({ openingArtifactKey, operationPending: operation.pending, openArtifact: (id, label) => operation.run('open-artifact', () => openArtifact(id, label)) });

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
    statusLabel: collectionActionResultStatusLabel(lastActionResult),
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
    const previousFeedbackContext = collectionFeedbackAuthorityContextRef.current;
    const nextFeedbackContext = storeAuthority.authoritativeContext
      ? { ...storeAuthority.authoritativeContext }
      : null;
    collectionFeedbackAuthorityContextRef.current = nextFeedbackContext;
    if (collectionActionFeedbackBelongsToAuthority(previousFeedbackContext, nextFeedbackContext)) {
      // 同店采集可推进会话世代；保留其回执，其他授权边界变化仍走重置。
      return;
    }
    ++collectionJobsLoadSequenceRef.current;
    collectionJobActionTokenRef.current = null;
    collectionRequestIdRef.current = null;
    manualReconciliationRequestIdRef.current = null;
    setActionNotice((currentNotice) => (
      retainCollectionActionFeedback(previousFeedbackContext, nextFeedbackContext, currentNotice)
    ));
    setActionError((currentError) => (
      retainCollectionActionFeedback(previousFeedbackContext, nextFeedbackContext, currentError)
    ));
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
      if (!operation.isCurrentEpoch()) return;
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
      if (!operation.isCurrentEpoch() || sequence !== collectionJobsLoadSequenceRef.current || authorityKeyRef.current !== capturedAuthorityKey) return;
      const safeJobs = (Array.isArray(jobs) ? jobs : [])
        .filter((job): job is LingxingCollectionJobSnapshot => collectionJobBelongsToStore(job, capturedContext))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      setCollectionJobs((current) => safeJobs.reduce(
        (merged, job) => upsertCollectionJobSnapshot(merged, job),
        current.filter((job) => collectionJobBelongsToStore(job, capturedContext)),
      ).slice(0, 100));
    } catch (caught) {
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
      if (!operation.isCurrentEpoch() || sequence !== collectionJobsLoadSequenceRef.current || authorityKeyRef.current !== capturedAuthorityKey) return;
      setCollectionJobsError(toUserFacingError(caught, '最近采集任务读取失败。'));
    } finally {
      if (operation.isCurrentEpoch() && sequence === collectionJobsLoadSequenceRef.current && authorityKeyRef.current === capturedAuthorityKey) {
        setCollectionJobsLoading(false);
      }
    }
  }

  function isCapturedFeedbackAuthorityCurrent(capturedContext: StoreContextEnvelope): boolean {
    return operation.isCurrentEpoch() && collectionActionFeedbackBelongsToAuthority(capturedContext, authorityContextRef.current);
  }

  async function resumeCollectionJob(
    job: LingxingCollectionJobSnapshot,
    options: {
      reconcileCreateUnknown?: boolean;
      deferReconciledCreateFailures?: boolean;
    } = {},
  ): Promise<void> {
    const api = (window as any).electronAPI;
    const view = buildCollectionJobWorkspaceRow(job, storeAuthority.authoritativeContext);
    if (view.action === 'manual-reconciliation' && !options.reconcileCreateUnknown) {
      setActionNotice('该任务没有自动恢复。');
      setActionError(view.blockerText);
      return;
    }
    if (view.action !== 'resume'
      && view.action !== 'supplement-import'
      && !(view.action === 'manual-reconciliation' && options.reconcileCreateUnknown)) {
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
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
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
    setActionNotice(options.reconcileCreateUnknown
      ? '正在当前店铺下载中心精确核对原创建记录；本次只核对，不会创建报表或继续采集。'
      : options.deferReconciledCreateFailures
      ? '正在完成其余排队报表；已核对失败的缺失报表保持阻断，本次不会重新创建。'
      : view.action === 'supplement-import'
      ? '正在补导当前采集任务的真实报表；系统会复用已验证文件，不会重新创建领星报表。'
      : view.canary
      ? '正在从当前诊断任务的已确认检查点继续；结果只用于诊断，不会导入生产指标。'
      : '正在从当前采集任务的已确认检查点继续；已下载文件会先重新校验，不会盲目重复下载。');
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
        ...(options.reconcileCreateUnknown ? { reconcileCreateUnknown: true, reconcileOnly: true } : {}),
        ...(options.deferReconciledCreateFailures ? { deferReconciledCreateFailures: true } : {}),
      });
      if (await refreshForwardResponse(captured.storeContext)) return;
      if (collectionJobActionTokenRef.current !== actionToken || !isCapturedAuthorityCurrent(captured.authorityKey)) return;
      if (result?.job && !collectionJobBelongsToStore(result.job, captured.storeContext)) return;
      if (manualReconciliationRequestIdRef.current === requestId) return;
      setActionError(null);
      const returnedImportState = result?.job?.importState || result?.importState;
      setActionNotice(options.reconcileCreateUnknown
        ? '创建结果核对已完成；请根据核对结果单独点击“继续采集”。'
        : options.deferReconciledCreateFailures
        ? '其余排队报表处理已返回；缺失报表仍保持阻断，正在刷新当前店铺任务。'
        : view.action === 'supplement-import'
        ? returnedImportState === 'succeeded' || result?.importRecovered === true
          ? '补导已完成并持久化为生产指标已入库，正在刷新当前店铺任务与数据账本。'
          : '补导请求已返回，正在重新读取持久化入库状态。'
        : result?.alreadyComplete
          ? '已下载文件重新校验通过，该任务没有剩余报表需要继续采集。'
          : '继续采集已返回，正在刷新当前店铺任务与数据账本。');
      window.dispatchEvent(new Event('business-ui:data-updated'));
      await loadRecentCollectionJobs(captured.storeContext, captured.authorityKey);
    } catch (caught) {
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
      if (collectionJobActionTokenRef.current !== actionToken
        || !isCapturedFeedbackAuthorityCurrent(captured.storeContext)) return;
      if (manualReconciliationRequestIdRef.current === requestId) return;
      setActionNotice('继续采集未完成。');
      setActionError(toUserFacingError(caught, '继续采集未完成。'));
      await loadRecentCollectionJobs(captured.storeContext, captured.authorityKey);
    } finally {
      if (collectionJobActionTokenRef.current === actionToken
        && isCapturedFeedbackAuthorityCurrent(captured.storeContext)) {
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
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
      setActionNotice('取消请求未提交。');
      setActionError(toUserFacingError(caught, '当前店铺授权不可用。'));
      return;
    }

    const actionToken = `${captured.authorityKey}|cancel|${job.jobId}|${job.request.requestId}`;
    collectionJobActionTokenRef.current = actionToken;
    setCollectionJobActionBusyKey(`cancel:${job.jobId}`);
    setActionError(null);
    setActionNotice('正在提交当前采集任务的取消请求...');
    try {
      if (!api?.cancelLingxingCollection) {
        throw new Error('取消采集接口未暴露，请检查 preload IPC。');
      }
      await api.cancelLingxingCollection({
        jobId: job.jobId,
        requestId: job.request.requestId,
        storeContext: captured.storeContext,
      });
      if (await refreshForwardResponse(captured.storeContext)) return;
      if (collectionJobActionTokenRef.current !== actionToken || !isCapturedAuthorityCurrent(captured.authorityKey)) return;
      setActionNotice('取消请求已提交；系统会在当前外部步骤安全停止后更新任务状态。');
      await loadRecentCollectionJobs(captured.storeContext, captured.authorityKey);
    } catch (caught) {
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
      if (collectionJobActionTokenRef.current !== actionToken || !isCapturedAuthorityCurrent(captured.authorityKey)) return;
      setActionNotice('取消请求未提交。');
      setActionError(toUserFacingError(caught, '取消采集任务失败。'));
    } finally {
      if (collectionJobActionTokenRef.current === actionToken && isCapturedFeedbackAuthorityCurrent(captured.storeContext)) {
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
      const api = (window as any).electronAPI;
      if (typeof api?.openReportArtifact !== 'function') throw new Error('当前应用无法打开报表文件，请重启应用后重试。');
      await api.openReportArtifact(artifactId, { ...storeContext });
      if (!operation.isCurrentEpoch() || !isCapturedFeedbackAuthorityCurrent(storeContext)) return;
      setActionError(null);
      setActionNotice(`${label}已请求打开。`);
    } catch (caught) {
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
      if (!operation.isCurrentEpoch()) return;
      setActionError(toUserFacingError(caught, '打开工件失败。'));
      setActionNotice('打开工件失败。');
    } finally {
      if (operation.isCurrentEpoch()) setOpeningArtifactKey(null);
    }
  }

  async function runVerifyDownloadCenter() {
    const api = (window as any).electronAPI;
    let captured: Awaited<ReturnType<typeof captureCollectionRange>>;
    try {
      captured = await captureCollectionRange('diagnose');
    } catch (caught) {
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
      if (!operation.isCurrentEpoch()) return;
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
      if (await refreshForwardResponse(dateRange.storeContext)) return;
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      setLastDiagnostic(diagnostic);
      const evidenceAvailable = diagnostic?.screenshotArtifactId || diagnostic?.domArtifactId;
      const evidenceText = evidenceAvailable ? ' 诊断证据已登记。' : '';
      if (diagnostic?.ready) {
        setActionNotice(manualReconciliationRequired
          ? `页面验证通过，但创建结果仍需人工核对；确认领星已有任务后请使用“下载已创建报表”。${evidenceText}`
          : `页面验证通过：当前范围、页面和关键控件已刷新，可以重新获取完整 8 类报表。${evidenceText}`);
        return;
      }
      setActionNotice('页面验证已返回，但当前页面仍不能安全创建报表。');
      setActionError(`页面验证未通过：请从 ERP 广告入口重新进入下载中心，核对日期、店铺与站点后重试；具体原因见下方诊断详情。${evidenceText}`);
    } catch (caught) {
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
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
      setActionError('请先在领星下载中心按店铺、日期和报表类型核对创建结果；确认已有任务后使用“下载已创建报表”。');
      setCollectionMonitorOpen(true);
      return;
    }
    const targetTypes = mode === 'recreate-full' ? reportOptions.map((item) => item.type) : selectedTypes;
    const selectedLabels = reportOptions
      .filter((item) => targetTypes.includes(item.type))
      .map((item) => item.label);
    let captured: Awaited<ReturnType<typeof captureCollectionRange>>;
    try {
      captured = await captureCollectionRange(mode);
    } catch (caught) {
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
      if (!operation.isCurrentEpoch()) return;
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
      setActionNotice(targetTypes.length === 8
        ? `正在下载领星已创建完成的完整 8 类报表；同一任务全部下载并校验后才会尝试生产入库，不会创建新任务：${selectedLabels.join('、')}`
        : `正在下载领星已创建完成的已选部分报表；本次只保留真实文件，不写生产指标，不会创建新任务：${selectedLabels.join('、')}`);
    } else {
      setActionNotice(`${mode === 'recreate-full'
        ? '正在重新创建全部 8 类报表、下载并自动导入'
        : '正在重新创建并下载已选部分报表；本次不写生产指标，不会跨批次拼接'}：${selectedLabels.join('、')}`);
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
            ? targetTypes.length === 8
              ? `页面验证通过，继续下载完整 8 类已创建报表并等待生产入库：${selectedLabels.join('、')}`
              : `页面验证通过，继续下载已选部分报表；本次不写生产指标：${selectedLabels.join('、')}`
            : `${mode === 'recreate-full'
              ? '页面验证通过，继续重新创建全部 8 类报表、下载并自动导入'
              : '页面验证通过，继续重新创建并下载已选部分报表；本次不写生产指标'}：${selectedLabels.join('、')}`);
        },
      });
      if (await refreshForwardResponse(dateRange.storeContext)) return;
      if (!isCapturedAuthorityCurrent(authorityKey)) return;
      if (manualReconciliationRequestIdRef.current === dateRange.requestId) return;
      // 始终刷新本次捕获的范围，避免读取后续界面范围。
      const refreshed = await api.getBusinessUiDataPipeline?.(captured.refreshScope);
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
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
      if (!isCapturedAuthorityCurrent(authorityKey)
        && !isCapturedFeedbackAuthorityCurrent(dateRange.storeContext)) return;
      if (manualReconciliationRequestIdRef.current === dateRange.requestId) return;
      const message = collectionActionError(mode, caught);
      setActionError(message);
      setActionNotice(mode === 'download-existing'
        ? '下载已创建报表未完成。请先确认领星下载中心已有当前范围的已创建/可下载报表。'
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
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
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
      if (await refreshForwardResponse(captured.input.storeContext)) return;
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
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
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
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
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
      if (await refreshForwardResponse(captured.input.storeContext)) return;
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
      rendererRuntimeLog.error('collection.collection_controller_failed', { error: caught });
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

  function runCollectionOperation(mode: RunningCollectionActionMode, task: () => Promise<void>) {
    return operation.run(mode, task, () => {
      setRunningAction(mode);
      setActionError(null);
      setActionNotice('正在核对当前店铺与采集范围…');
      setCollectionMonitorOpen(true);
    }, () => {
      setRunningAction(null);
      setFeedbackActionGroup(null);
    });
  }

  function refreshForwardResponse(captured: StoreContextEnvelope) {
    return refreshCollectionForwardResponse({ captured, current: authorityContextRef.current,
      isCurrent: operation.isCurrentEpoch, setNotice: setActionNotice,
      refresh: (context) => loadRecentCollectionJobs(context, authorityKeyRef.current),
      notifyDataUpdated: () => window.dispatchEvent(new Event('business-ui:data-updated')) });
  }

  return {
    actionPending: operation.pending,
    configurationRequired,
    taskState,
    realReportCount,
    selectedCount,
    reportOptions,
    importedRowCount,
    primaryTaskBusy,
    collectionJobsLoading,
    runningAction,
    manualReconciliationRequired,
    dataLedger,
    importCurrentReports: () => runCollectionOperation('import', importCurrentReports),
    runDownloadAction: (mode: DownloadCollectionActionMode) => runCollectionOperation(mode, () => runDownloadAction(mode)),
    openingArtifactKey,
    primaryReportFolderArtifactId,
    openArtifact: (id: string, label?: string) => operation.run('open-artifact', () => openArtifact(id, label)),
    importLocalReports: () => runCollectionOperation('import', importLocalReports),
    setReportSelectorOpen,
    productionDataReady,
    productionLineageReadiness,
    collectionMonitorOpen,
    collectionMonitorState,
    collectionMonitorEvidenceAvailable,
    setCollectionMonitorOpen,
    actionProgressSteps,
    actionNotice,
    actionError,
    reportStatusLoading,
    reportSelectionState,
    downloadExistingButton,
    recreateSelectedButton,
    importButton,
    renderOpenArtifactButton,
    aggregateRealReportCount,
    aggregateImportedRowCount,
    scope,
    collectionJobsPreviewOnly,
    collectionJobsError,
    collectionJobActionBusyKey: collectionJobActionBusyKey || (operation.pending ? 'collection:in-flight' : null),
    storeAuthority,
    collectionJobs,
    cancelCollectionJob: (job: LingxingCollectionJobSnapshot) => operation.run('cancel-job', () => cancelCollectionJob(job)),
    loadRecentCollectionJobs: (...args: Parameters<typeof loadRecentCollectionJobs>) => operation.run('refresh-jobs', () => loadRecentCollectionJobs(...args)),
    resumeCollectionJob: (job: LingxingCollectionJobSnapshot, options?: Parameters<typeof resumeCollectionJob>[1]) => runCollectionOperation(collectionResumeMode(job), () => resumeCollectionJob(job, options)),
    reportSelectorOpen,
    reportSelectorDialogFocus,
    setSelectedTypes,
    missingReportTypes,
    unimportedReportTypes,
    productionReportOptions,
    selectedTypes,
    toggleReport,
    selectedReportFile,
    reportFileDialogFocus,
    setSelectedReportFile,
    selectedReportFileImported,
    selectedReportFileBinding,
    lastDiagnostic,
    importedReadinessStage,
    importedReportCount,
    liveProgressPresentation,
    fileAudit,
    rejectedEvidenceCount,
    hasOnlyDiagnosticFiles,
    recreateFullButton,
    loading,
    error,
    shouldShowVerifyAction,
    feedbackActionGroup,
    verifyFeedbackButton,
    setFeedbackActionGroup,
    runVerifyDownloadCenter: () => runCollectionOperation('verify-page', runVerifyDownloadCenter),
    retryFullFeedbackButton,
    refreshFullFeedbackButton,
    availableBatchCount,
    collection,
    latestBatchStatus,
    primaryAuditArtifactId,
    realFiles,
    visibleRealFiles,
    renderOpenArtifactChip,
    hiddenRealFileCount,
    lastActionResult,
    lastActionSummary,
    productionBindingByType,
  };
}
