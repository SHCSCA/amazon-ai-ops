import { LINGXING_REPORT_TYPE_SET } from './main-input-contract';
import * as crypto from 'crypto';
import { invalidLingxingImportReconciliationEvidence } from './lingxing-report-import';
import { type ReportImportRunRecord } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-repo';
import { LINGXING_AD_REPORTS, verifyDownloadedFile } from '@amazon-ai-ops/lingxing-report-collector';
import type { LingxingReportType } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope, LingxingCollectionImportState, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { classifyLingxingImportRecoveryFailure, classifyLingxingPartialImportRecoveryFailure, isKnownLingxingImportRecoveryFailure } from './lingxing-import-startup-recovery-gate';
import { assertStoreCollectionCommittedImportProofForRecovery } from './store-collection-orchestrator-scheduler-adapter';
import { type StartLingxingCollectionInput } from './lingxing-collection-coordinator';
import { rendererPayload } from './main-artifacts-runtime';
import { importStoreScopedLingxingDownloadedReportMetrics } from './main-local-report-import-runtime';
import { getMainRuntimeContext } from './main-runtime-access';
import { publishCollectionProgressAfterPersistence } from './collection-progress-publication';

export function validatedDownloadedResumeReportTypes(
  job: LingxingCollectionJobSnapshot,
): LingxingReportType[] {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const snapshot = mainRuntimeContext.state.lingxingImportRepo.getCollectionSnapshotForStore(
    job.request.storeContext.storeId,
    job.jobId,
  );
  const downloaded = job.reports
    .filter((checkpoint) => checkpoint.state === 'downloaded')
    .map((checkpoint) => checkpoint.reportType);
  for (const reportType of downloaded) {
    const file = snapshot?.files.find((candidate) => (
      candidate.reportType === reportType
      && candidate.status === 'downloaded'
      && Boolean(candidate.filePath)
    ));
    const definition = LINGXING_AD_REPORTS.find((candidate) => candidate.type === reportType);
    const verification = file?.filePath && snapshot
      ? verifyDownloadedFile(file.filePath, {
          expectedDateRange: {
            start: job.request.dateStart,
            end: job.request.dateEnd,
          },
          expectedDownloadDir: snapshot.batch.downloadDir,
          expectedFilenameKeyword: definition?.expectedFilenameKeyword,
          expectedReportType: reportType,
        })
      : { valid: false, errorMessage: '缺少已下载文件快照' };
    if (!verification.valid) {
      throw new Error(
        `任务 ${job.jobId} 的已下载报表 ${reportType} 无法重新验证：${verification.errorMessage || '未知原因'}。`
        + ' 请先人工核对本地文件，系统不会自动重复下载。',
      );
    }
  }
  return downloaded;
}

export function rebindLingxingResumeState(
  job: LingxingCollectionJobSnapshot,
  requestId: string,
  context: StoreContextEnvelope,
): {
  resumeFrom?: LingxingCollectionResumeState;
  reportTypes: LingxingReportType[];
  reused: LingxingReportType[];
  lineage?: StartLingxingCollectionInput['lineage'];
} {
  if (
    job.request.storeContext.storeId !== context.storeId
    || job.request.storeContext.browserProfileId !== context.browserProfileId
  ) {
    throw new Error('历史采集任务不属于当前店铺浏览器 Profile，拒绝恢复。');
  }
  const manualReconciliation = job.reports.find((checkpoint) => (
    checkpoint.state === 'creating' || checkpoint.state === 'create_unknown'
  ));
  if (manualReconciliation) {
    throw new Error(
      `${manualReconciliation.reportType} 的创建结果不确定，必须先在领星下载中心人工核对；系统不会自动恢复或重复创建。`,
    );
  }
  const reused = validatedDownloadedResumeReportTypes(job);
  const reportTypes = job.request.reportTypes.filter((reportType) => !reused.includes(reportType));
  if (reportTypes.length === 0) return { reportTypes: [], reused };

  const resumableReports: LingxingCollectionReportCheckpoint[] = [];
  for (const checkpoint of job.reports) {
    if (!reportTypes.includes(checkpoint.reportType) || !checkpoint.createdReportIdentity) continue;
    resumableReports.push({
      ...checkpoint,
      state: ['ready', 'downloading', 'verifying'].includes(checkpoint.state)
        ? 'ready'
        : 'created',
      updatedAt: new Date().toISOString(),
    });
  }
  const reboundRequest = {
    requestId,
    storeContext: context,
    dateStart: job.request.dateStart,
    dateEnd: job.request.dateEnd,
    mode: job.request.mode,
    reportTypes,
  } as const;
  const fullOriginalRequest = job.request.reportTypes.length === LINGXING_REPORT_TYPE_SET.size
    && job.request.reportTypes.every((reportType) => LINGXING_REPORT_TYPE_SET.has(reportType));
  const sourceLineage = job.lineage ?? (fullOriginalRequest ? {
    lineageId: job.jobId,
    rootJobId: job.jobId,
    expectedReportTypes: [...job.request.reportTypes],
    purpose: 'production_full' as const,
  } : undefined);
  return {
    reportTypes,
    reused,
    ...(sourceLineage ? {
      lineage: {
        ...sourceLineage,
        parentJobId: job.jobId,
        expectedReportTypes: [...sourceLineage.expectedReportTypes],
        purpose: 'resume' as const,
      },
    } : {}),
    resumeFrom: {
      jobId: `resume_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      request: reboundRequest,
      reports: resumableReports,
    },
  };
}

export function nextLingxingCollectionSnapshotTimestamp(previous: string): string {
  const previousMs = Date.parse(previous);
  const nextMs = Number.isFinite(previousMs)
    ? Math.max(Date.now(), previousMs + 1)
    : Date.now();
  return new Date(nextMs).toISOString();
}

export function persistLingxingCollectionImportState(
  job: LingxingCollectionJobSnapshot,
  importState: LingxingCollectionImportState,
  options: {
    attemptedAt?: string;
    completedAt?: string;
    error?: string;
  } = {},
): LingxingCollectionJobSnapshot {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const {
    importState: _previousImportState,
    importAttemptedAt: _previousImportAttemptedAt,
    importCompletedAt: _previousImportCompletedAt,
    importError: _previousImportError,
    ...base
  } = job;
  const updatedAt = options.completedAt
    ?? options.attemptedAt
    ?? nextLingxingCollectionSnapshotTimestamp(job.updatedAt);
  const next: LingxingCollectionJobSnapshot = {
    ...base,
    importState,
    updatedAt,
    ...(options.attemptedAt ? { importAttemptedAt: options.attemptedAt } : {}),
    ...(options.completedAt ? { importCompletedAt: options.completedAt } : {}),
    ...(options.error ? { importError: options.error } : {}),
  };
  const persisted = mainRuntimeContext.state.lingxingImportRepo.upsertCollectionProgressForStore(
    next.request.storeContext.storeId,
    {
      eventId: `${next.jobId}:import-recovery:${importState}`,
      emittedAt: updatedAt,
      job: next,
    },
  );
  const event = { eventId: `${persisted.jobId}:import-recovery:${importState}`,
    emittedAt: persisted.updatedAt, job: persisted } satisfies LingxingCollectionProgressEvent;
  publishCollectionProgressAfterPersistence({ phase: 'import_recovery', event,
    assertCurrent: () => mainRuntimeContext.state.storeCoordinator?.assertActiveStoreContext(persisted.request.storeContext),
    publish: () => mainRuntimeContext.mainWindow?.webContents.send('lingxing-collection:progress', rendererPayload(event)),
  });
  return persisted;
}

export function assertPersistedFullLingxingReconciliationProof(
  job: LingxingCollectionJobSnapshot,
  run: ReportImportRunRecord,
): ReturnType<typeof assertStoreCollectionCommittedImportProofForRecovery> {
  const mainRuntimeContext = getMainRuntimeContext();
  const repository = mainRuntimeContext.state.lingxingImportRepo;
  if (!repository) throw invalidLingxingImportReconciliationEvidence('导入仓库尚未就绪。');

  let proof;
  try {
    proof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(
      job.request.storeContext.storeId,
      job.request.requestId,
    );
  } catch (error) {
    throw invalidLingxingImportReconciliationEvidence(
      `无法读取唯一 durable authority proof：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!proof) {
    throw invalidLingxingImportReconciliationEvidence(
      'existing import run 缺少当前 requestId 的唯一 durable authority proof。',
    );
  }

  try {
    return assertStoreCollectionCommittedImportProofForRecovery(proof, {
      context: job.request.storeContext,
      requestId: job.request.requestId,
      dateStart: job.request.dateStart,
      dateEnd: job.request.dateEnd,
      expectedJob: job,
      expectedRun: run,
    });
  } catch (error) {
    throw invalidLingxingImportReconciliationEvidence(
      `committed import recovery verifier 未认可 existing import：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function recoverCompletedLingxingCollectionImport(
  job: LingxingCollectionJobSnapshot,
  context: StoreContextEnvelope,
  options: { requireActiveContext?: boolean } = {},
) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  if (job.state !== 'completed' && job.state !== 'completed_with_errors') {
    throw new Error(`任务 ${job.jobId} 的下载终态为 ${job.state}，不能直接补导。`);
  }
  if (job.reports.some((checkpoint) => checkpoint.state === 'create_unknown')) {
    throw new Error('任务存在 create_unknown，必须先在领星下载中心人工核对，禁止自动补导。');
  }
  const snapshot = mainRuntimeContext.state.lingxingImportRepo.getCollectionSnapshotForStore(context.storeId, job.jobId);
  if (!snapshot) throw new Error(`任务 ${job.jobId} 缺少店铺级下载批次快照，无法补导。`);

  const runId = `import_${job.jobId}`;
  const existing = mainRuntimeContext.state.lingxingImportRepo.getImportRunForStore(context.storeId, runId);
  if (existing) {
    const receipt = assertPersistedFullLingxingReconciliationProof(job, existing);
    const verifiedRun = receipt.run;
    if (job.importState === 'succeeded') {
      return {
        job,
        importRecovered: false,
        metricsImport: {
          inserted: verifiedRun.metricRowCount,
          parsedFiles: verifiedRun.sourceFileCount,
          skippedFiles: 0,
          deletedExisting: 0,
          deduplicated: true,
          importRunId: verifiedRun.runId,
          errors: [],
        },
      };
    }
    if (!receipt.casToken || !job.importAttemptedAt) {
      throw invalidLingxingImportReconciliationEvidence(
        'committed import recovery receipt 缺少 pending/failed CAS token 或 attemptedAt。',
      );
    }
    const completionFloor = [
      job.updatedAt,
      receipt.runCompletedAt,
      verifiedRun.createdAt,
    ].reduce((latest, candidate) => (
      Date.parse(candidate) > Date.parse(latest) ? candidate : latest
    ));
    const completedAt = nextLingxingCollectionSnapshotTimestamp(completionFloor);
    const succeeded = mainRuntimeContext.state.lingxingImportRepo.completeRecoveredCollectionImportForStore(
      receipt.casToken,
      {
        attemptedAt: job.importAttemptedAt,
        completedAt,
      },
    );
    const event = { eventId: `${succeeded.jobId}:import-recovery:succeeded`,
      emittedAt: succeeded.updatedAt, job: succeeded } satisfies LingxingCollectionProgressEvent;
    publishCollectionProgressAfterPersistence({ phase: 'import_recovered', event,
      assertCurrent: () => mainRuntimeContext.state.storeCoordinator?.assertActiveStoreContext(succeeded.request.storeContext),
      publish: () => mainRuntimeContext.mainWindow?.webContents.send('lingxing-collection:progress', rendererPayload(event)),
    });
    return {
      job: succeeded,
      importRecovered: true,
      metricsImport: {
        inserted: verifiedRun.metricRowCount,
        parsedFiles: verifiedRun.sourceFileCount,
        skippedFiles: 0,
        deletedExisting: 0,
        deduplicated: true,
        importRunId: verifiedRun.runId,
        errors: [],
      },
    };
  }

  const knownPartialTerminal = classifyLingxingPartialImportRecoveryFailure({
    state: job.state,
    immutableImportRunPresent: false,
    expectedJobId: job.jobId,
    expectedRequestId: job.request.requestId,
    requestedReportTypes: job.request.reportTypes,
    downloadedCheckpointReportTypes: job.reports
      .filter((checkpoint) => checkpoint.state === 'downloaded')
      .map((checkpoint) => checkpoint.reportType),
    downloadedFileReportTypes: snapshot.files
      .filter((file) => (
        file.status === 'downloaded'
        && Boolean(file.filePath?.trim())
        && (file.fileSizeBytes ?? 0) > 0
      ))
      .map((file) => file.reportType),
    failedSettlement: {
      jobId: job.jobId,
      requestId: job.request.requestId,
      importState: job.importState,
      importCompletedAt: job.importCompletedAt,
      importError: job.importError,
    },
  });
  if (isKnownLingxingImportRecoveryFailure(knownPartialTerminal)) {
    throw knownPartialTerminal;
  }

  if (options.requireActiveContext !== false) {
    mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context);
  }
  const attemptedAt = nextLingxingCollectionSnapshotTimestamp(job.updatedAt);
  let pending = persistLingxingCollectionImportState(job, 'pending', { attemptedAt });
  let metricsImport: ReturnType<typeof importStoreScopedLingxingDownloadedReportMetrics>;
  let committedRun: ReportImportRunRecord | undefined;
  try {
    metricsImport = importStoreScopedLingxingDownloadedReportMetrics(snapshot, { startedAt: attemptedAt });
    if (metricsImport.errors.length > 0 || metricsImport.parsedFiles <= 0 || !metricsImport.importRunId) {
      const detail = metricsImport.errors.map((error) => error.message).join('；')
        || '真实报表未形成可提交的逐文件导入凭证。';
      throw new Error(`LINGXING_COLLECTION_IMPORT_FAILED: ${detail}`);
    }
    committedRun = mainRuntimeContext.state.lingxingImportRepo.getImportRunForStore(
      context.storeId,
      metricsImport.importRunId,
    );
    if (!committedRun) {
      throw invalidLingxingImportReconciliationEvidence(
        '新导入事务返回后无法回读唯一 immutable import run。',
      );
    }
    const receipt = assertPersistedFullLingxingReconciliationProof(pending, committedRun);
    if (!receipt.casToken || !pending.importAttemptedAt) {
      throw invalidLingxingImportReconciliationEvidence(
        '新导入事务缺少 pending CAS token 或 attemptedAt。',
      );
    }
    const completionFloor = [
      pending.updatedAt,
      receipt.runCompletedAt,
      committedRun.createdAt,
    ].reduce((latest, candidate) => (
      Date.parse(candidate) > Date.parse(latest) ? candidate : latest
    ));
    const completedAt = nextLingxingCollectionSnapshotTimestamp(completionFloor);
    pending = mainRuntimeContext.state.lingxingImportRepo.completeRecoveredCollectionImportForStore(
      receipt.casToken,
      {
        attemptedAt: pending.importAttemptedAt,
        completedAt,
      },
    );
  } catch (error) {
    const currentJob = mainRuntimeContext.state.lingxingImportRepo.getCollectionJobForStore(
      context.storeId,
      pending.jobId,
    );
    if (!currentJob
      || currentJob.request.requestId !== pending.request.requestId
      || currentJob.updatedAt !== pending.updatedAt
      || currentJob.importState !== 'pending') {
      throw new Error(
        'COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT: 补导失败后 job 已发生并发变化，拒绝用 stale pending 快照覆盖。',
        { cause: error },
      );
    }
    const failureFloor = committedRun
      ? [pending.updatedAt, committedRun.completedAt, committedRun.createdAt]
          .reduce((latest, candidate) => (
            Date.parse(candidate) > Date.parse(latest) ? candidate : latest
          ))
      : pending.updatedAt;
    const completedAt = nextLingxingCollectionSnapshotTimestamp(failureFloor);
    const failedJob = persistLingxingCollectionImportState(pending, 'failed', {
      attemptedAt,
      completedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    const discoveredRun = committedRun ?? mainRuntimeContext.state.lingxingImportRepo.getImportRunForStore(
      context.storeId,
      runId,
    );
    throw classifyLingxingImportRecoveryFailure({
      error,
      immutableImportRunPresent: Boolean(discoveredRun),
      expectedJobId: pending.jobId,
      expectedRequestId: pending.request.requestId,
      failedSettlement: {
        jobId: failedJob.jobId,
        requestId: failedJob.request.requestId,
        importState: failedJob.importState,
        importCompletedAt: failedJob.importCompletedAt,
      },
    });
  }
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return { job: pending, importRecovered: true, metricsImport };
}

export function recoverPendingLingxingCollectionImportsOnStartup(): {
  inspected: number;
  recovered: number;
  failed: number;
  knownFailed: number;
  authorityFailed: number;
} {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.lingxingImportRepo || !mainRuntimeContext.state.storeRepo) {
    return {
      inspected: 0,
      recovered: 0,
      failed: 0,
      knownFailed: 0,
      authorityFailed: 0,
    };
  }
  let inspected = 0;
  let recovered = 0;
  let failed = 0;
  let knownFailed = 0;
  let authorityFailed = 0;
  const stores = mainRuntimeContext.state.storeRepo.listStores().filter((store) => store.status === 'active');
  for (const store of stores) {
    let cursor: { updatedAt: string; jobId: string } | undefined;
    do {
      const page = mainRuntimeContext.state.lingxingImportRepo.listRecoverableCollectionImportsForStore(
        store.storeId,
        {
          limit: 200,
          cursor,
          importStates: ['pending', 'failed'],
        },
      );
      for (const job of page.jobs) {
        inspected += 1;
        try {
          recoverCompletedLingxingCollectionImport(job, job.request.storeContext, {
            requireActiveContext: false,
          });
          recovered += 1;
        } catch (error) {
          failed += 1;
          if (isKnownLingxingImportRecoveryFailure(error)) {
            knownFailed += 1;
          } else {
            authorityFailed += 1;
          }
          runtimeLog.warn('[Lingxing] pending import recovery failed', JSON.stringify({
            storeId: store.storeId,
            jobId: job.jobId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            blockerCode: isKnownLingxingImportRecoveryFailure(error)
              ? 'LINGXING_COLLECTION_IMPORT_RECOVERY_KNOWN_FAILED'
              : 'LINGXING_COLLECTION_IMPORT_RECOVERY_AUTHORITY_FAILED',
          }));
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  return { inspected, recovered, failed, knownFailed, authorityFailed };
}

export function recoverInterruptedLingxingCollectionJobsOnStartup(): {
  cancelled: number;
  failedStores: number;
} {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.lingxingImportRepo || !mainRuntimeContext.state.storeRepo) {
    return { cancelled: 0, failedStores: 0 };
  }
  let cancelled = 0;
  let failedStores = 0;
  const completedAt = new Date().toISOString();
  for (const store of mainRuntimeContext.state.storeRepo.listStores({ includeArchived: true })) {
    try {
      cancelled += mainRuntimeContext.state.lingxingImportRepo.recoverInterruptedCollectionJobsForStore(
        store.storeId,
        { completedAt },
      ).length;
    } catch (error) {
      failedStores += 1;
      runtimeLog.warn('[Lingxing] interrupted collection recovery failed', JSON.stringify({
        storeId: store.storeId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        blockerCode: 'LINGXING_COLLECTION_RESTART_RECOVERY_FAILED',
      }));
    }
  }
  return { cancelled, failedStores };
}
