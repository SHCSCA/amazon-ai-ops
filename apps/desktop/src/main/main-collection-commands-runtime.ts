import { validateDateRange, validateLingxingReportType } from './main-input-contract';
import { dialog } from 'electron';
import * as path from 'path';
import { fingerprintLingxingCollectionAuthorityProof } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-repo';
import { assertDownloadCenterCollectionPreflightReady, buildDownloadCenterCollectionPreflight } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingReportBatch, LingxingReportFile, LingxingReportType } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope, LingxingCollectionJobSnapshot, LingxingCollectionResumeState } from '@amazon-ai-ops/shared-types';
import { safeFileSegment } from './acceptance-audit-export';
import { isExactLingxingFull8ReportSet } from './lingxing-full8-remediation-policy';
import { writeLingxingCollectionPreflightEvidenceBundle } from './collection-preflight-export';
import { bindLingxingCollectionCancellation } from './lingxing-collection-control';
import { type StartLingxingCollectionInput } from './lingxing-collection-coordinator';
import { getDownloadCenterDiagnosticEvidenceReadiness, normalizeLingxingCollectionRequest, optionalTrimmedString } from './main-download-automation-runtime';
import { sameExactStoreContext } from './main-browser-session-runtime';
import { isExistingRawReportFile, loadLatestBusinessBatch, normalizeBusinessMutationScope } from './main-business-scope-runtime';
import { loadLatestPersistedDownloadCenterDiagnosticForModel, loadPersistedDownloadCenterDiagnostic, loadPersistedLingxingBatch } from './main-report-diagnostic-read-model-runtime';
import { buildLocalBusinessReportBatch, importStoreScopedLingxingDownloadedReportMetrics } from './main-local-report-import-runtime';
import { assertBatchContainsRealReportFiles, authorizedLingxingCollectionTarget, handleGetBusinessUiDataPipeline, lingxingCollectionCancellationKey } from './main-business-pipeline-runtime';
import { storeCapsuleFor } from './main-store-access-runtime';
import { readDownloadCenterPageModel } from './main-download-page-model-runtime';
import { assertVisibleLingxingCollectionSession } from './main-mission-today-runtime';
import type { LingxingCollectionTarget } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export async function runAuthorizedLingxingCollection(
  input: unknown,
  options: {
    mode: 'create-and-download' | 'download-existing';
    reportTypes?: readonly LingxingReportType[];
    maxRetries?: number;
    canary?: boolean;
    resumeFrom?: LingxingCollectionResumeState;
    lineage?: StartLingxingCollectionInput['lineage'];
  },
) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.packageUiReadOnlyRuntime) {
    mainRuntimeContext.packageUiSchedulerAudit.recordSuppressed('automaticReconcile');
    throw new Error(
      'PACKAGE_UI_EVIDENCE_READ_ONLY: package UI evidence cannot start or resume collection.',
    );
  }
  if (!mainRuntimeContext.state.lingxingCollectionCoordinator) {
    throw new Error('店铺级领星采集协调器尚未就绪。');
  }
  if (!mainRuntimeContext.state.executionAuthorityService) {
    throw new Error('浏览器任务准入屏障尚未就绪。');
  }
  const request = normalizeLingxingCollectionRequest(input);
  if (!request.requestId || !request.storeContext) {
    throw new Error('领星采集请求缺少 Main 可复核的 requestId 或 StoreContext。请刷新当前店铺后重试。');
  }
  if (!options.canary && request.requestId.startsWith('canary:')) {
    throw new Error('普通领星采集不得使用系统保留的 canary: requestId 前缀。');
  }
  if (options.canary && !request.requestId.startsWith('canary:')) {
    throw new Error('Canary 采集必须使用 Main 生成的 canary: requestId。');
  }
  const startInput: StartLingxingCollectionInput = {
    requestId: request.requestId,
    storeContext: request.storeContext,
    dateStart: request.start,
    dateEnd: request.end,
    mode: options.mode,
    ...(options.reportTypes ? { reportTypes: options.reportTypes } : {}),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.canary ? { canary: true } : {}),
    ...(options.resumeFrom ? { resumeFrom: options.resumeFrom } : {}),
    ...(options.lineage ? { lineage: options.lineage } : {}),
    appVersion: mainRuntimeContext.APP_VERSION,
  };
  return mainRuntimeContext.state.executionAuthorityService.withAdmittedBrowserOperation(
    'legacy:lingxing-collection',
    () => mainRuntimeContext.state.lingxingCollectionCoordinator!.start(startInput),
  );
}

export async function handleCollectLingxingReports(input: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.packageUiReadOnlyRuntime) {
    mainRuntimeContext.packageUiSchedulerAudit.recordSuppressed('automaticReconcile');
    throw new Error(
      'PACKAGE_UI_EVIDENCE_READ_ONLY: package UI evidence cannot start or resume collection.',
    );
  }
  if (!mainRuntimeContext.state.storeCoordinator
    || !mainRuntimeContext.state.storeCollectionSchedulerReadModel
    || !mainRuntimeContext.state.lingxingImportRepo) {
    throw new Error('店铺级采集 MainRuntime 或权威回读尚未就绪。');
  }
  const request = normalizeLingxingCollectionRequest(input);
  if (!request.requestId || !request.storeContext) {
    throw new Error('领星采集请求缺少 Main 可复核的 requestId 或 StoreContext。请刷新当前店铺后重试。');
  }
  if (request.requestId.startsWith('canary:')) {
    throw new Error('普通领星采集不得使用系统保留的 canary: requestId 前缀。');
  }
  validateDateRange({ start: request.start, end: request.end });
  const context = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(request.storeContext);
  const before = mainRuntimeContext.state.storeCollectionSchedulerReadModel.get(context);
  if (!before.dateStart
    || !before.dateEnd
    || before.dateStart !== request.start
    || before.dateEnd !== request.end) {
    throw new Error(
      '领星完整采集范围与当前店铺配置推导的唯一业务窗口不一致，请刷新页面后重试。',
    );
  }

  
  
  
  
  
  const currentRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const expectedClosedRuntimeId = currentRuntime
    && currentRuntime.purpose === 'operator_full'
    && sameExactStoreContext(currentRuntime.context, context)
      ? currentRuntime.runtimeId
      : undefined;
  if (expectedClosedRuntimeId) {
    mainRuntimeContext.expectedVisibleRuntimeCloseIds.add(expectedClosedRuntimeId);
  }
  let schedule: Awaited<ReturnType<
    NonNullable<typeof mainRuntimeContext.state.storeCollectionSchedulerReadModel>['runNow']
  >>;
  try {
    schedule = await mainRuntimeContext.state.storeCollectionSchedulerReadModel.runNow(context);
  } finally {
    if (expectedClosedRuntimeId) {
      mainRuntimeContext.expectedVisibleRuntimeCloseIds.delete(expectedClosedRuntimeId);
    }
  }
  if (!schedule.job) {
    throw new Error(
      `领星完整采集未形成可回读的 durable 任务：${schedule.projection.detail}`,
    );
  }
  const proof = mainRuntimeContext.state.lingxingImportRepo
    .readUniqueCollectionAuthorityProofForStoreByRequestId(
      context.storeId,
      schedule.job.request.requestId,
    );
  if (!proof
    || proof.job.jobId !== schedule.job.jobId
    || proof.job.request.storeContext.storeId !== context.storeId
    || !proof.batch
    || proof.batch.id !== proof.job.jobId
    || proof.lingxingFileCount !== proof.lingxingFiles.length) {
    throw new Error('领星完整采集的 MainRuntime 结果缺少唯一且完整的 durable Store 回读。');
  }
  const importRun = proof.importRunCount === 1 ? proof.importRuns[0] : undefined;
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return {
    batch: proof.batch,
    files: proof.lingxingFiles,
    job: proof.job,
    schedule,
    metricsImport: importRun
      ? {
          inserted: importRun.metricRowCount,
          parsedFiles: importRun.sourceFileCount,
          skippedFiles: 0,
          deletedExisting: 0,
          deduplicated: schedule.duplicate,
          importRunId: importRun.runId,
          errors: [],
        }
      : undefined,
  };
}

export async function handleImportCurrentBusinessReports(input: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  const scope = normalizeBusinessMutationScope(input);
  const batchResult = loadLatestBusinessBatch(scope);
  if (!batchResult) {
    throw new Error('导入被阻断：当前范围没有 completed 数据批次。');
  }
  if (batchResult.scopeMismatch?.length) {
    throw new Error(`导入被阻断：${batchResult.scopeMismatch.join('；')}`);
  }
  const fileBatchForPath = (file: LingxingReportFile): LingxingReportBatch => {
    const downloadDir = batchResult.fileDownloadDirs?.[file.id] || batchResult.batch.downloadDir;
    return { ...batchResult.batch, downloadDir };
  };
  const realReportFiles = batchResult.files.filter((file) => isExistingRawReportFile(file, fileBatchForPath(file)));
  if (realReportFiles.length === 0) {
    throw new Error('导入被阻断：当前范围没有真实 .xlsx/.xls/.csv 原始报表文件。');
  }
  const sourceBatchIds = Array.from(new Set(
    realReportFiles.map((file) => file.batchId || batchResult.batch.id),
  ));
  const importSummaries = [];
  for (const batchId of sourceBatchIds) {
    mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(scope.storeContext);
    const sourceBatch = loadPersistedLingxingBatch(batchId);
    const sourceFiles = sourceBatch.files.filter((file) => isExistingRawReportFile(file, sourceBatch.batch));
    if (sourceFiles.length === 0) {
      throw new Error(`导入被阻断：来源批次 ${batchId} 没有可验证的真实报表文件。`);
    }
    importSummaries.push(await importStoreScopedLingxingDownloadedReportMetrics({
      batch: sourceBatch.batch,
      files: sourceFiles,
    }, { assertCurrent: () => mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(scope.storeContext) }));
  }
  const metricsImport = {
    inserted: importSummaries.reduce((sum, item) => sum + item.inserted, 0),
    parsedFiles: importSummaries.reduce((sum, item) => sum + item.parsedFiles, 0),
    skippedFiles: importSummaries.reduce((sum, item) => sum + item.skippedFiles, 0),
    deletedExisting: 0,
    deduplicated: importSummaries.length > 0 && importSummaries.every((item) => item.deduplicated),
    importRunIds: importSummaries
      .map((item) => item.importRunId)
      .filter((value): value is string => Boolean(value)),
    errors: importSummaries.flatMap((item) => item.errors),
  };
  return {
    batch: batchResult.batch,
    files: realReportFiles,
    metricsImport,
    pipeline: handleGetBusinessUiDataPipeline({ ...scope, batchId: batchResult.batch.id }),
  };
}

export async function handleImportLocalBusinessReportFiles(input: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  const scope = normalizeBusinessMutationScope(input);
  if (!mainRuntimeContext.mainWindow) {
    throw new Error('本地导入被阻断：主窗口未就绪。');
  }
  const selected = await dialog.showOpenDialog(mainRuntimeContext.mainWindow, {
    title: '选择领星原始广告报表',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Lingxing ad report files', extensions: ['xlsx', 'xls', 'csv'] },
    ],
  });
  if (selected.canceled || selected.filePaths.length === 0) {
    return {
      cancelled: true,
      metricsImport: { inserted: 0, parsedFiles: 0, skippedFiles: 0, deletedExisting: 0, errors: [] },
      pipeline: handleGetBusinessUiDataPipeline(scope),
    };
  }
  const context = mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(scope.storeContext);
  const store = mainRuntimeContext.state.storeRepo?.getStore(context.storeId);
  if (!store || store.status !== 'active') {
    throw new Error('本地导入被阻断：当前店铺不存在或已停用。');
  }
  const result = await buildLocalBusinessReportBatch(
    scope,
    selected.filePaths,
    storeCapsuleFor(store),
  );
  mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context);
  mainRuntimeContext.state.lingxingImportRepo!.saveCollectionSnapshotForStore(context.storeId, result);
  const metricsImport = await importStoreScopedLingxingDownloadedReportMetrics(result, {
    assertCurrent: () => mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context),
  });
  mainRuntimeContext.mainWindow.webContents.send('business-ui:data-updated');
  return {
    cancelled: false,
    ...result,
    metricsImport,
    pipeline: handleGetBusinessUiDataPipeline({ ...scope, batchId: result.batch.id }),
  };
}

export function handlePreflightLingxingCollection(input: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  validateDateRange(dateRange);
  const submittedContext = request.storeContext ?? mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!submittedContext) throw new Error('请先选择店铺，再检查领星采集条件。');
  const authorized = authorizedLingxingCollectionTarget(submittedContext);
  const model = readDownloadCenterPageModel();
  const diagnosticEvidenceReadiness = getDownloadCenterDiagnosticEvidenceReadiness(
    model,
    dateRange,
    authorized.target,
  );
  const browserSessionReady = (() => {
    try {
      assertVisibleLingxingCollectionSession(authorized.context);
      return true;
    } catch {
      return false;
    }
  })();
  return buildDownloadCenterCollectionPreflight(model, dateRange, undefined, {
    target: authorized.target,
    diagnosticEvidenceReadiness,
    browserSessionReady,
    browserSessionReason: browserSessionReady ? undefined : '请先启动并登录领星 ERP 浏览器',
  });
}

export function assertLingxingCollectionPreflightReady(dateRange: { start: string; end: string }, target: LingxingCollectionTarget = {}): void {
  const preflight = handlePreflightLingxingCollection({ ...dateRange, ...target });
  assertDownloadCenterCollectionPreflightReady(preflight);
}

export function assertLingxingResumePreflightBeforeMainRuntime(
  job: LingxingCollectionJobSnapshot,
  context: StoreContextEnvelope,
): void {
  const preflight = handlePreflightLingxingCollection({
    start: job.request.dateStart,
    end: job.request.dateEnd,
    requestId: job.request.requestId,
    storeContext: context,
  });
  try {
    assertDownloadCenterCollectionPreflightReady(preflight);
  } catch {
    throw new Error(
      '继续采集前检查未通过：下载中心诊断证据已过期或当前可见会话未就绪。请先重新连接当前店铺并刷新下载中心诊断，再重试；本次未启动采集。',
    );
  }
}

export function handleExportLingxingCollectionPreflight(input: unknown): string {
  const mainRuntimeContext = getMainRuntimeContext();
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const submittedContext = request.storeContext ?? mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!submittedContext) throw new Error('请先选择店铺，再导出领星采集检查。');
  const authorized = authorizedLingxingCollectionTarget(submittedContext);
  const capsule = storeCapsuleFor(authorized.store);
  const preflight = handlePreflightLingxingCollection(request);
  const model = readDownloadCenterPageModel();
  const diagnostic = preflight.diagnosticEvidenceReadiness.diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(preflight.diagnosticEvidenceReadiness.diagnosticId, dateRange.start, dateRange.end)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(
        model,
        dateRange.start,
        dateRange.end,
        authorized.target,
      );
  const exportDir = path.join(
    capsule.evidenceDir,
    `lingxing_collection_preflight_${safeFileSegment(dateRange.start)}_${safeFileSegment(dateRange.end)}_${Date.now()}`,
  );
  writeLingxingCollectionPreflightEvidenceBundle({
    exportDir,
    preflight,
    model,
    diagnostic,
    directories: {
      screenshotsDir: capsule.screenshotsDir,
      domSnapshotsDir: capsule.evidenceDir,
    },
  });
  return exportDir;
}

export async function handleRetryLingxingReport(input: unknown, reportType: LingxingReportType) {
  const mainRuntimeContext = getMainRuntimeContext();
  validateLingxingReportType(reportType);
  const output = await runAuthorizedLingxingCollection(input, {
    mode: 'create-and-download',
    reportTypes: [reportType],
  });
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return { ...output.result, metricsImport: output.importSummary };
}

export async function handleDownloadExistingLingxingReports(input: unknown, reportTypes: LingxingReportType[]) {
  const mainRuntimeContext = getMainRuntimeContext();
  const selectedReportTypes = Array.from(new Set(reportTypes));
  if (selectedReportTypes.length === 0) {
    throw new Error('请至少选择 1 类已创建报表。');
  }
  selectedReportTypes.forEach(validateLingxingReportType);
  if (isExactLingxingFull8ReportSet(selectedReportTypes)) {
    throw new Error(
      'FULL8_REMEDIATION_MAIN_RUNTIME_REQUIRED: 完整八报表只能由 MainRuntime 的唯一语义任务执行；旧下载补救入口不得创建第二个 full8 job。',
    );
  }
  const output = await runAuthorizedLingxingCollection(input, {
    mode: 'download-existing',
    reportTypes: selectedReportTypes,
    maxRetries: 0,
  });
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return { ...output.result, metricsImport: output.importSummary };
}

export async function handleRunLingxingCanaryReport(input: unknown, reportType: LingxingReportType) {
  const mainRuntimeContext = getMainRuntimeContext();
  validateLingxingReportType(reportType);
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const originalRequestId = optionalTrimmedString(value.requestId);
  if (!originalRequestId) throw new Error('单报表 canary 缺少有效 requestId。');
  const canaryRequestId = asLingxingCanaryRequestId(originalRequestId);
  const output = await runAuthorizedLingxingCollection({
    ...value,
    requestId: canaryRequestId,
  }, {
    canary: true,
    mode: 'create-and-download',
    reportTypes: [reportType],
    maxRetries: 0,
  });
  assertBatchContainsRealReportFiles(output.result, '单报表 canary');
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return output.result;
}

export function asLingxingCanaryRequestId(requestId: string): string {
  return requestId.startsWith('canary:')
    ? requestId.slice(0, 128)
    : `canary:${requestId.slice(0, 120)}`;
}

export function requireCurrentCollectionStoreContext(value: unknown): StoreContextEnvelope {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator) throw new Error('店铺会话协调器尚未就绪。');
  if (!value || typeof value !== 'object') {
    throw new Error('领星采集操作缺少 StoreContext。');
  }
  return mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(value);
}

export function handleListLingxingCollectionJobs(input: unknown): LingxingCollectionJobSnapshot[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const context = requireCurrentCollectionStoreContext(value.storeContext);
  const requestedLimit = typeof value.limit === 'number' ? value.limit : 30;
  const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)));
  return mainRuntimeContext.state.lingxingImportRepo.listCollectionJobsForStore(context.storeId, limit);
}

export async function handleCancelLingxingCollection(
  input: unknown,
): Promise<{ cancelled: true; requestId: string; jobId: string }> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.packageUiReadOnlyRuntime) {
    mainRuntimeContext.packageUiSchedulerAudit.recordSuppressed('automaticReconcile');
    throw new Error(
      'PACKAGE_UI_EVIDENCE_READ_ONLY: package UI evidence cannot cancel collection.',
    );
  }
  if (!mainRuntimeContext.state.lingxingImportRepo || !mainRuntimeContext.state.storeCollectionMainRuntime) {
    throw new Error('店铺级领星采集运行时尚未就绪。');
  }
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const context = requireCurrentCollectionStoreContext(value.storeContext);
  const { requestId, jobId } = bindLingxingCollectionCancellation(
    mainRuntimeContext.state.lingxingImportRepo,
    context.storeId,
    { requestId: value.requestId, jobId: value.jobId },
  );
  const repository = mainRuntimeContext.state.lingxingImportRepo;
  const cancellationKeys = lingxingCollectionCancellationKey({
    storeId: context.storeId,
    requestId,
    jobId,
  });
  const previousResumeReceipt = repository.readLatestCollectionResumeAttemptReceiptForStore(
    context.storeId,
    jobId,
    requestId,
  );
  const signalCancellation = () => {
    for (const key of cancellationKeys) mainRuntimeContext.cancelledLingxingCollectionRequests.add(key);
  };
  const clearCancellation = () => {
    for (const key of cancellationKeys) mainRuntimeContext.cancelledLingxingCollectionRequests.delete(key);
  };

  await mainRuntimeContext.state.storeCollectionMainRuntime.cancelCollection({
    context,
    jobId,
    requestId,
    signalActiveCancellation: () => {
      
      
      
      signalCancellation();
    },
    clearCancellationSignal: clearCancellation,
    cancelIdle: () => {
      signalCancellation();
      const current = repository.getCollectionJobForStore(context.storeId, jobId);
      if (!current
        || current.request.requestId !== requestId
        || (current.state !== 'queued' && current.state !== 'running')) {
        
        
        
        clearCancellation();
        return;
      }
      repository.cancelCollectionJobForStore(context.storeId, jobId, {
        requestId,
        completedAt: new Date().toISOString(),
      });
      clearCancellation();
    },
    readDurableSettlement: ({ requireNewResumeReceipt }) => {
      const cancelledJob = repository.getCollectionJobForStore(context.storeId, jobId);
      if (!cancelledJob
        || cancelledJob.request.requestId !== requestId
        || cancelledJob.state !== 'cancelled'
        || cancelledJob.importState !== 'not_applicable'
        || !cancelledJob.completedAt) {
        return { durableCancelled: false } as const;
      }
      const proof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
        context.storeId,
        requestId,
      );
      if (!proof
        || proof.job.jobId !== jobId
        || proof.job.updatedAt !== cancelledJob.updatedAt
        || fingerprintLingxingCollectionAuthorityProof(proof)
          !== fingerprintLingxingCollectionAuthorityProof({
            ...proof,
            job: cancelledJob,
          })) {
        return { durableCancelled: false } as const;
      }
      const latestResumeReceipt = requireNewResumeReceipt
        ? repository.readLatestCollectionResumeAttemptReceiptForStore(
            context.storeId,
            jobId,
            requestId,
          )
        : undefined;
      const receiptIsNew = Boolean(latestResumeReceipt
        && latestResumeReceipt.outcome === 'failed'
        && latestResumeReceipt.jobId === jobId
        && latestResumeReceipt.requestId === requestId
        && latestResumeReceipt.finalJobUpdatedAt === cancelledJob.updatedAt
        && latestResumeReceipt.finalAuthorityProofSha256
          === fingerprintLingxingCollectionAuthorityProof(proof)
        && (!previousResumeReceipt
          || latestResumeReceipt.attemptId !== previousResumeReceipt.attemptId
          || latestResumeReceipt.completedAt !== previousResumeReceipt.completedAt
          || latestResumeReceipt.finalAuthorityProofSha256
            !== previousResumeReceipt.finalAuthorityProofSha256));
      if (requireNewResumeReceipt && !receiptIsNew) {
        return { durableCancelled: false } as const;
      }
      return {
        durableCancelled: true,
        storeId: context.storeId,
        jobId,
        requestId,
        newResumeReceipt: requireNewResumeReceipt ? receiptIsNew : false,
      } as const;
    },
  });
  return { cancelled: true, requestId, jobId };
}
