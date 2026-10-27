import { createHash } from 'node:crypto';
import { readStoreCollectionAutomation } from '@amazon-ai-ops/shared-types';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  type LingxingCollectionImportState,
  type LingxingCollectionJobState,
  type StoreContextEnvelope,
  type StoreRuntimeConfigRecord,
} from '@amazon-ai-ops/shared-types';
import {
  fingerprintCollectionResumeExecutionContext,
  fingerprintLingxingCollectionAuthorityProof,
  type CollectionInPlaceResumeState,
  type CollectionResumeAttemptReceipt,
  type LingxingCollectionAuthorityProof,
} from '@amazon-ai-ops/local-db';
import { vi } from 'vitest';
import type { StoreCollectionProtectedSemanticAttemptReadback } from './store-collection-orchestrator';
import { StoreCollectionSchedulerReadModel } from './store-collection-scheduler-read-model';

export const CONTEXT: StoreContextEnvelope = {
  storeId: 'store-one' as StoreContextEnvelope['storeId'],
  browserProfileId: 'profile-one' as StoreContextEnvelope['browserProfileId'],
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22' as StoreContextEnvelope['businessDate'],
  sessionGeneration: 4,
};

export function config(
  patch: Partial<StoreRuntimeConfigRecord> = {},
): StoreRuntimeConfigRecord {
  return {
    configId: 'config-one',
    storeId: CONTEXT.storeId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    status: 'active',
    revision: 3,
    values: {
      aiRecommendationsEnabled: true,
      collectionScheduleLocalTime: '07:30',
      collectionLookbackDays: 7,
      analysisWindowDays: 30,
      defaultTargetAcosPercent: 28,
      minimumRecommendationConfidencePercent: 80,
      evidenceRetentionDays: 90,
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    ...patch,
  };
}

export function expectedFingerprint(
  context: StoreContextEnvelope = CONTEXT,
): string {
  return createHash('sha256').update(JSON.stringify({
    collectionContractVersion: 'lingxing-us-ads-full8-v1',
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    businessDate: context.businessDate,
    lookbackDays: 7,
    dateStart: '2026-07-15',
    dateEnd: '2026-07-21',
  })).digest('hex');
}

export function durableProof(input: {
  state?: LingxingCollectionJobState;
  importState?: LingxingCollectionImportState;
  requestId?: string;
  context?: StoreContextEnvelope;
  dateStart?: string;
  dateEnd?: string;
} = {}): LingxingCollectionAuthorityProof {
  const context = input.context ?? CONTEXT;
  const state = input.state ?? 'running';
  const requestId = input.requestId ?? 'scheduler-request-one';
  const dateStart = input.dateStart ?? '2026-07-15';
  const dateEnd = input.dateEnd ?? '2026-07-21';
  const terminal = !['queued', 'running'].includes(state);
  const downloadComplete = state === 'completed';
  const completedAt = terminal ? '2026-07-22T15:02:00.000Z' : undefined;
  const updatedAt = terminal
    ? '2026-07-22T15:05:00.000Z'
    : '2026-07-22T15:01:00.000Z';
  const reports: LingxingCollectionAuthorityProof['job']['reports'] = (
    ANALYSIS_REQUIRED_REPORT_TYPES.map((reportType) => ({
      reportType,
      state: downloadComplete ? 'downloaded' as const : state === 'queued' ? 'queued' as const : 'failed' as const,
      attemptIndex: 0,
      autoRetryCount: 0,
      ...(downloadComplete ? {
        createdReportIdentity: {
          provider: 'lingxing' as const,
          reportType,
          externalReportName: `report-${reportType}`,
          dateStart,
          dateEnd,
          createdAt: '2026-07-22T15:00:30.000Z',
        },
        fileSizeBytes: 1024,
      } : {}),
      updatedAt: '2026-07-22T15:01:00.000Z',
    }))
  );
  const importAttemptedAt = state === 'completed'
    && ['pending', 'failed', 'succeeded'].includes(String(input.importState))
    ? '2026-07-22T15:03:00.000Z'
    : undefined;
  const importCompletedAt = state === 'completed'
    && (input.importState === 'failed' || input.importState === 'succeeded')
    ? '2026-07-22T15:04:00.000Z'
    : undefined;
  const job: LingxingCollectionAuthorityProof['job'] = {
    jobId: 'job-one',
    request: {
      requestId,
      storeContext: context,
      dateStart,
      dateEnd,
      mode: 'create-and-download' as const,
      reportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
    },
    lineage: {
      lineageId: 'job-one',
      rootJobId: 'job-one',
      expectedReportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
      purpose: 'production_full',
    },
    state,
    reports,
    createdAt: '2026-07-22T15:00:00.000Z',
    updatedAt,
    ...(completedAt ? { completedAt } : {}),
    ...(input.importState ? { importState: input.importState } : {}),
    ...(importAttemptedAt ? { importAttemptedAt } : {}),
    ...(importCompletedAt ? { importCompletedAt } : {}),
    ...(state === 'completed' && input.importState === 'failed'
      ? { importError: 'IMPORT_FAILED' }
      : {}),
  };
  const batch: LingxingCollectionAuthorityProof['batch'] = terminal ? {
    id: job.jobId,
    requestId,
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    dateStart: job.request.dateStart,
    dateEnd: job.request.dateEnd,
    marketplaceCode: 'US',
    status: state === 'completed'
      ? 'completed'
      : state === 'completed_with_errors'
        ? 'completed_with_errors'
        : 'failed',
    downloadDir: `C:\\reports\\${job.jobId}`,
    createdAt: job.createdAt,
    completedAt: completedAt!,
  } : undefined;
  const lingxingFiles: LingxingCollectionAuthorityProof['lingxingFiles'] = downloadComplete
    ? reports.map((checkpoint) => ({
        storeId: context.storeId,
        id: `lingxing-${checkpoint.reportType}`,
        batchId: job.jobId,
        reportType: checkpoint.reportType,
        displayName: `${checkpoint.reportType}.xlsx`,
        status: 'downloaded',
        filePath: `C:\\reports\\${job.jobId}\\${checkpoint.reportType}.xlsx`,
        fileSizeBytes: checkpoint.fileSizeBytes!,
        createdAt: '2026-07-22T15:00:30.000Z',
        updatedAt: checkpoint.updatedAt,
      }))
    : [];
  const importRun: LingxingCollectionAuthorityProof['importRuns'][number] | undefined = (
    state === 'completed' && input.importState === 'succeeded'
  ) ? {
      storeId: context.storeId,
      runId: 'run-job-one',
      idempotencyKey: 'import-job-one',
      inputFingerprint: 'a'.repeat(64),
      batchId: job.jobId,
      status: 'completed',
      sourceFileCount: ANALYSIS_REQUIRED_REPORT_TYPES.length,
      metricRowCount: 80,
      reconciliationCount: ANALYSIS_REQUIRED_REPORT_TYPES.length,
      startedAt: importAttemptedAt!,
      completedAt: importCompletedAt!,
      createdAt: importCompletedAt!,
    } : undefined;
  const importedReportFiles: LingxingCollectionAuthorityProof['importedReportFiles'] = importRun
    ? lingxingFiles.map((file, index) => ({
        id: index + 1,
        storeId: context.storeId,
        batchId: job.jobId,
        reportType: file.reportType,
        filePath: file.filePath!,
        fileName: file.displayName,
        fileSizeBytes: file.fileSizeBytes!,
        status: 'imported',
        importedRows: 10,
        fileHash: `${(index + 1).toString(16)}`.repeat(64).slice(0, 64),
        lastImportedAt: importCompletedAt!,
      }))
    : [];
  const importFileSnapshots: LingxingCollectionAuthorityProof['importFileSnapshots'] = importRun
    ? lingxingFiles.map((file, index) => ({
        storeId: context.storeId,
        snapshotId: `snapshot-${file.reportType}`,
        runId: importRun.runId,
        batchId: job.jobId,
        lingxingFileId: file.id,
        reportFileId: importedReportFiles[index]!.id,
        reportType: file.reportType,
        filePath: file.filePath!,
        fileName: file.displayName,
        fileSizeBytes: file.fileSizeBytes!,
        fileHash: importedReportFiles[index]!.fileHash!,
        importedRows: importedReportFiles[index]!.importedRows,
        capturedAt: '2026-07-22T15:03:30.000Z',
      }))
    : [];
  const reconciliations: LingxingCollectionAuthorityProof['reconciliations'] = importRun
    ? lingxingFiles.map((file, index) => ({
        storeId: context.storeId,
        reconciliationId: `reconciliation-${file.reportType}`,
        runId: importRun.runId,
        batchId: job.jobId,
        dateStart,
        dateEnd,
        metricDate: dateEnd,
        reportType: file.reportType,
        currency: 'USD',
        expectedRows: 10,
        actualRows: 10,
        expectedCost: index + 1,
        actualCost: index + 1,
        absoluteCostDelta: 0,
        tolerance: 0.01,
        withinTolerance: true,
        status: 'matched',
        reconciledAt: importCompletedAt!,
      }))
    : [];
  const metricEvidence: LingxingCollectionAuthorityProof['metricEvidence'] = importRun
    ? [{
        storeId: context.storeId,
        runId: importRun.runId,
        batchId: job.jobId,
        rowCount: importRun.metricRowCount,
        payloadSha256: 'd'.repeat(64),
        createdAt: importRun.completedAt,
      }]
    : [];
  return {
    job,
    jobRow: {
      storeId: context.storeId,
      jobId: job.jobId,
      requestId,
      browserProfileId: context.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: context.businessDate,
      sessionGeneration: context.sessionGeneration,
      dateStart,
      dateEnd,
      mode: 'create-and-download',
      reportTypesJson: JSON.stringify(ANALYSIS_REQUIRED_REPORT_TYPES),
      state,
      createdAt: job.createdAt,
      updatedAt,
      completedAt: completedAt ?? null,
      blockerCode: null,
      detail: null,
    },
    checkpointCount: reports.length,
    ...(batch ? { batch } : {}),
    lingxingFileCount: lingxingFiles.length,
    lingxingFiles,
    importRunCount: importRun ? 1 : 0,
    importRuns: importRun ? [importRun] : [],
    importFileSnapshotCount: importFileSnapshots.length,
    importFileSnapshots,
    importedReportFileCount: importedReportFiles.length,
    importedReportFiles,
    reconciliationRowCount: reconciliations.length,
    reconciliations,
    metricEvidenceCount: metricEvidence.length,
    metricEvidence,
  };
}

export function protectedAttempt(input: {
  requestId?: string;
  context?: StoreContextEnvelope;
  fingerprint?: string;
  terminalState?: 'succeeded' | 'blocked' | 'failed' | null;
} = {}): StoreCollectionProtectedSemanticAttemptReadback {
  const context = input.context ?? CONTEXT;
  const fingerprint = input.fingerprint ?? expectedFingerprint(context);
  const requestId = input.requestId ?? 'scheduler-request-one';
  const semanticAttempt = {
    semanticAttemptId: 'semantic-attempt-one',
    cycleId: 'cycle-one',
    transitionId: 'transition-one',
    storeId: context.storeId,
    browserProfileId: context.browserProfileId,
    expectedFingerprint: fingerprint,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    schedulerAttemptId: 'scheduler-attempt-one',
    schedulerRequestId: requestId,
    attemptedAt: '2026-07-22T15:00:00.000Z',
    integrityDigest: 'a'.repeat(64),
  };
  const terminalState = input.terminalState === undefined ? null : input.terminalState;
  return {
    semanticAttempt,
    terminalOutcome: terminalState === null
      ? null
      : {
          outcomeId: 'outcome-one',
          cycleId: 'cycle-one',
          transitionId: 'transition-one',
          owner: 'store-collection-orchestrator',
          storeId: context.storeId,
          browserProfileId: context.browserProfileId,
          businessDate: context.businessDate,
          sessionGeneration: context.sessionGeneration,
          fingerprint,
          attemptId: 'scheduler-attempt-one',
          requestId,
          schedulerSucceeded: terminalState === 'succeeded',
          cleanupStatus: 'confirmed',
          state: terminalState,
          startedAt: '2026-07-22T15:00:00.000Z',
          completedAt: '2026-07-22T15:01:00.000Z',
          ...(terminalState === 'succeeded' ? {} : { failureCode: 'IDENTITY_UNVERIFIED' as const }),
          integrityDigest: 'b'.repeat(64),
        },
  };
}

export function inPlaceResumeState(
  proof: LingxingCollectionAuthorityProof,
): CollectionInPlaceResumeState {
  return {
    jobId: proof.job.jobId,
    job: proof.job,
    request: proof.job.request,
    reports: proof.job.reports,
    batch: proof.batch!,
    files: proof.lingxingFiles,
    expectedJobUpdatedAt: proof.job.updatedAt,
    authorityProofSha256: fingerprintLingxingCollectionAuthorityProof(proof),
  };
}

export function resumeReceipt(input: {
  before: LingxingCollectionAuthorityProof;
  after: LingxingCollectionAuthorityProof;
  outcome: 'succeeded' | 'failed' | 'interrupted';
}): CollectionResumeAttemptReceipt {
  return {
    storeId: CONTEXT.storeId,
    attemptId: 'resume-attempt-one',
    jobId: input.before.job.jobId,
    requestId: input.before.job.request.requestId,
    outcome: input.outcome,
    baseJobUpdatedAt: input.before.job.updatedAt,
    finalJobUpdatedAt: input.after.job.updatedAt,
    baseAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(input.before),
    finalAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(input.after),
    durableSessionGeneration: CONTEXT.sessionGeneration,
    executionSessionGeneration: CONTEXT.sessionGeneration,
    executionContextSha256: fingerprintCollectionResumeExecutionContext(CONTEXT),
    claimedAt: '2026-07-22T15:05:30.000Z',
    completedAt: '2026-07-22T15:06:00.000Z',
  };
}

export interface HarnessOptions {
  currentConfig?: StoreRuntimeConfigRecord | null;
  now?: string;
}

export function harness(options: HarnessOptions = {}) {
  const active: { current: StoreContextEnvelope | null } = { current: CONTEXT };
  const runtimeConfigState: { current: StoreRuntimeConfigRecord | null } = {
    current: options.currentConfig ?? null,
  };
  const authority = {
    assertActiveStoreContext: vi.fn((value: unknown) => {
      if (!active.current || value !== active.current) throw new Error('stale or wrong active context');
      return active.current;
    }),
    getActiveStoreContext: vi.fn(() => active.current),
  };
  const runtimeConfig = {
    get: vi.fn((_context: StoreContextEnvelope) => ({
      current: runtimeConfigState.current,
      versions: [],
    })),
  };
  const importRepository = {
    getCollectionJobForStore: vi.fn(
      (_storeId: unknown, _jobId: unknown): LingxingCollectionAuthorityProof['job'] | undefined => (
        undefined
      ),
    ),
    inspectUniqueCollectionJobForSemanticScope: vi.fn(
      (_input: unknown): LingxingCollectionAuthorityProof | undefined => undefined,
    ),
    readUniqueCollectionAuthorityProofForStoreByRequestId: vi.fn(
      (_storeId: unknown, _requestId: unknown): LingxingCollectionAuthorityProof | undefined => (
        undefined
      ),
    ),
    getCollectionInPlaceResumeStateForStore: vi.fn(
      (_storeId: unknown, _jobId: unknown): CollectionInPlaceResumeState | undefined => undefined,
    ),
    readLatestCollectionResumeAttemptReceiptForStore: vi.fn(
      (
        _storeId: unknown,
        _jobId: unknown,
        _requestId: unknown,
      ): CollectionResumeAttemptReceipt | undefined => undefined,
    ),
    readUniqueSucceededCollectionResumeReceiptForStore: vi.fn(
      (
        _storeId: unknown,
        _jobId: unknown,
        _requestId: unknown,
      ): CollectionResumeAttemptReceipt | undefined => undefined,
    ),
  };
  const orchestrator = {
    readProtectedSemanticAttempt: vi.fn(
      (_input: unknown): StoreCollectionProtectedSemanticAttemptReadback | null => null,
    ),
  };
  const manualRun = vi.fn(async (_context: StoreContextEnvelope): Promise<unknown> => ({
      cycleId: 'cycle-one',
      state: 'completed' as const,
      outcomes: [],
      skippedStoreIds: [],
      plannedDueStoreIds: [CONTEXT.storeId],
      attemptedStoreIds: [CONTEXT.storeId],
    }));
  const resumeExisting = vi.fn(async (_input: unknown): Promise<unknown> => ({
    state: 'completed' as const,
  }));
  const automationControl = { get: vi.fn((context: StoreContextEnvelope) => readStoreCollectionAutomation(null, context)) };
  const model = new StoreCollectionSchedulerReadModel({
    automationControl,
    authority,
    runtimeConfig,
    importRepository,
    orchestrator,
    manualRun,
    resumeExisting,
    now: () => new Date(options.now ?? '2026-07-22T15:00:00.000Z'),
  });
  return {
    active,
    runtimeConfigState,
    automationControl,
    authority,
    runtimeConfig,
    importRepository,
    orchestrator,
    manualRun,
    resumeExisting,
    model,
  };
}
