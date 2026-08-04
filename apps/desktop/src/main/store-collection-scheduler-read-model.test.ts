import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  type LingxingCollectionImportState,
  type LingxingCollectionJobState,
  type StoreCollectionScheduleProjection,
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
import { describe, expect, it, vi } from 'vitest';
import type {
  StoreCollectionProtectedSemanticAttemptReadback,
} from './store-collection-orchestrator';
import { StoreCollectionSchedulerReadModel } from './store-collection-scheduler-read-model';

const CONTEXT: StoreContextEnvelope = {
  storeId: 'store-one' as StoreContextEnvelope['storeId'],
  browserProfileId: 'profile-one' as StoreContextEnvelope['browserProfileId'],
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22' as StoreContextEnvelope['businessDate'],
  sessionGeneration: 4,
};

function config(
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

function expectedFingerprint(
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

function durableProof(input: {
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

function protectedAttempt(input: {
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

function inPlaceResumeState(
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

function resumeReceipt(input: {
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

interface HarnessOptions {
  currentConfig?: StoreRuntimeConfigRecord | null;
  now?: string;
}

function harness(options: HarnessOptions = {}) {
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
  const model = new StoreCollectionSchedulerReadModel({
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
    authority,
    runtimeConfig,
    importRepository,
    orchestrator,
    manualRun,
    resumeExisting,
    model,
  };
}

describe('StoreCollectionSchedulerReadModel', () => {
  it('routes an exact durable failed full8 job through same-job resume instead of manual duplicate', async () => {
    const test = harness({ currentConfig: config() });
    const before = durableProof({ state: 'failed', importState: 'not_applicable' });
    const after = durableProof({ state: 'failed', importState: 'not_applicable' });
    after.job.updatedAt = '2026-07-22T15:06:00.000Z';
    after.jobRow.updatedAt = after.job.updatedAt;
    test.importRepository.inspectUniqueCollectionJobForSemanticScope
      .mockReturnValue(before);
    test.importRepository.getCollectionJobForStore.mockReturnValue(before.job);
    test.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId
      .mockReturnValueOnce(before)
      .mockReturnValue(after);
    const safeResumePacket = inPlaceResumeState(before);
    safeResumePacket.reports = safeResumePacket.reports.map((checkpoint, index) => (
      index === 0
        ? { ...checkpoint, state: 'queued' as const, errorCode: undefined, detail: undefined }
        : checkpoint
    ));
    test.importRepository.getCollectionInPlaceResumeStateForStore.mockReturnValue(safeResumePacket);
    test.importRepository.readLatestCollectionResumeAttemptReceiptForStore
      .mockReturnValueOnce(undefined)
      .mockReturnValue(resumeReceipt({ before, after, outcome: 'failed' }));
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'failed' }),
    );

    await expect(test.model.runNow(CONTEXT)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      projection: { state: 'failed' },
      job: { jobId: 'job-one', state: 'failed' },
    });

    expect(test.resumeExisting).toHaveBeenCalledWith({
      context: CONTEXT,
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      dateStart: '2026-07-15',
      dateEnd: '2026-07-21',
      expectedJobUpdatedAt: before.job.updatedAt,
      expectedAuthorityProofSha256: fingerprintLingxingCollectionAuthorityProof(before),
    });
    expect(test.manualRun).not.toHaveBeenCalled();
  });

  it('locks a selected failed job before mutation even when current lookback now targets another window', async () => {
    const changedConfig = config({
      values: {
        ...config().values,
        collectionLookbackDays: 14,
      },
      revision: 4,
      updatedAt: '2026-07-22T15:05:30.000Z',
    });
    const test = harness({ currentConfig: changedConfig });
    const before = durableProof({ state: 'failed', importState: 'not_applicable' });
    const after = durableProof({ state: 'failed', importState: 'not_applicable' });
    after.job.updatedAt = '2026-07-22T15:06:00.000Z';
    after.jobRow.updatedAt = after.job.updatedAt;
    test.importRepository.getCollectionInPlaceResumeStateForStore.mockReturnValue(
      inPlaceResumeState(before),
    );
    test.importRepository.getCollectionJobForStore.mockReturnValue(before.job);
    test.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId
      .mockReturnValueOnce(before)
      .mockReturnValue(after);
    test.importRepository.readLatestCollectionResumeAttemptReceiptForStore
      .mockReturnValueOnce(undefined)
      .mockReturnValue(resumeReceipt({ before, after, outcome: 'failed' }));
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'failed' }),
    );

    await expect(test.model.resumeJob(CONTEXT, 'job-one')).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      projection: {
        state: 'failed',
        dateStart: '2026-07-15',
        dateEnd: '2026-07-21',
      },
      job: { jobId: 'job-one' },
    });

    expect(test.importRepository.inspectUniqueCollectionJobForSemanticScope).not.toHaveBeenCalled();
    expect(test.resumeExisting).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-one',
      dateStart: '2026-07-15',
      dateEnd: '2026-07-21',
    }));
  });

  it('rejects replay of a stale terminal receipt when the resume callback performs no new attempt', async () => {
    const test = harness({ currentConfig: config() });
    const before = durableProof({ state: 'failed', importState: 'not_applicable' });
    const staleReceipt = {
      ...resumeReceipt({ before, after: before, outcome: 'failed' }),
      claimedAt: before.job.updatedAt,
    };
    test.importRepository.getCollectionJobForStore.mockReturnValue(before.job);
    test.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId
      .mockReturnValue(before);
    test.importRepository.getCollectionInPlaceResumeStateForStore.mockReturnValue(
      inPlaceResumeState(before),
    );
    test.importRepository.readLatestCollectionResumeAttemptReceiptForStore
      .mockReturnValue(staleReceipt);
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'failed' }),
    );

    await expect(test.model.resumeJob(CONTEXT, 'job-one')).rejects.toThrow(/new.*receipt/i);
    expect(test.resumeExisting).toHaveBeenCalledOnce();
  });

  it('authorizes the exact active context and projects missing config without consulting execution history', () => {
    const test = harness();

    expect(test.model.get(CONTEXT)).toEqual({
      storeId: CONTEXT.storeId,
      businessDate: CONTEXT.businessDate,
      enabled: false,
      state: 'not_configured',
      detail: '当前店铺尚未配置采集计划。',
    });
    expect(test.authority.assertActiveStoreContext).toHaveBeenCalledWith(CONTEXT);
    expect(test.runtimeConfig.get).toHaveBeenCalledWith(CONTEXT);
    expect(test.importRepository.inspectUniqueCollectionJobForSemanticScope).not.toHaveBeenCalled();
    expect(test.orchestrator.readProtectedSemanticAttempt).not.toHaveBeenCalled();
    expect(test.manualRun).not.toHaveBeenCalled();
  });

  it('projects an archived config without reading durable or protected attempts', () => {
    const test = harness({ currentConfig: config({ status: 'archived' }) });

    expect(test.model.get(CONTEXT)).toEqual({
      storeId: CONTEXT.storeId,
      businessDate: CONTEXT.businessDate,
      enabled: false,
      state: 'archived',
      detail: '当前店铺采集配置已归档。',
    });
    expect(test.importRepository.inspectUniqueCollectionJobForSemanticScope).not.toHaveBeenCalled();
    expect(test.orchestrator.readProtectedSemanticAttempt).not.toHaveBeenCalled();
  });

  it('derives the exact full8 semantic scope and waits before the Los Angeles schedule time', () => {
    const test = harness({
      currentConfig: config(),
      now: '2026-07-22T14:29:00.000Z',
    });
    const fingerprint = expectedFingerprint();

    expect(test.model.get(CONTEXT)).toEqual<StoreCollectionScheduleProjection>({
      storeId: CONTEXT.storeId,
      businessDate: CONTEXT.businessDate,
      enabled: true,
      state: 'waiting',
      detail: '等待当前店铺配置的采集时间。',
      scheduleLocalTime: '07:30',
      configRevision: 3,
      dateStart: '2026-07-15',
      dateEnd: '2026-07-21',
      fingerprint,
    });
    expect(test.importRepository.inspectUniqueCollectionJobForSemanticScope).toHaveBeenCalledWith({
      storeId: CONTEXT.storeId,
      browserProfileId: CONTEXT.browserProfileId,
      businessDate: CONTEXT.businessDate,
      dateStart: '2026-07-15',
      dateEnd: '2026-07-21',
      mode: 'create-and-download',
      reportTypes: ANALYSIS_REQUIRED_REPORT_TYPES,
    });
    expect(test.orchestrator.readProtectedSemanticAttempt).toHaveBeenCalledWith({
      storeId: CONTEXT.storeId,
      browserProfileId: CONTEXT.browserProfileId,
      expectedFingerprint: fingerprint,
    });
  });

  it.each([
    ['queued', undefined, 'claimed'],
    ['running', undefined, 'claimed'],
    ['completed', 'pending', 'claimed'],
    ['completed', 'succeeded', 'succeeded'],
    ['completed', 'failed', 'failed'],
    ['completed_with_errors', 'not_applicable', 'failed'],
    ['failed', 'not_applicable', 'failed'],
    ['cancelled', 'not_applicable', 'failed'],
    ['stale_authority', 'not_applicable', 'failed'],
  ] as const)(
    'projects durable %s/%s as %s without legacy settings history',
    (jobState, importState, expectedState) => {
      const test = harness({ currentConfig: config() });
      test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(
        durableProof({ state: jobState, importState }),
      );

      expect(test.model.get(CONTEXT)).toMatchObject({
        storeId: CONTEXT.storeId,
        businessDate: CONTEXT.businessDate,
        enabled: true,
        state: expectedState,
        fingerprint: expectedFingerprint(),
      });
    },
  );

  it.each([
    ['completed without import lifecycle', 'completed', undefined],
    ['completed/not_applicable', 'completed', 'not_applicable'],
    ['completed_with_errors/failed', 'completed_with_errors', 'failed'],
    ['failed/failed', 'failed', 'failed'],
    ['cancelled/failed', 'cancelled', 'failed'],
    ['stale_authority/failed', 'stale_authority', 'failed'],
  ] as const)('fails closed on contradictory durable lifecycle: %s', (_label, state, importState) => {
    const test = harness({ currentConfig: config() });
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(
      durableProof({ state, importState }),
    );

    expect(() => test.model.get(CONTEXT)).toThrow(/collection proof UNKNOWN/i);
  });

  it('fails closed when completed/succeeded markers lack complete 8/8 authority proof', () => {
    const test = harness({ currentConfig: config() });
    const incomplete = durableProof({ state: 'completed', importState: 'succeeded' });
    incomplete.importRunCount = 0;
    incomplete.importRuns = [];
    incomplete.importFileSnapshotCount = 0;
    incomplete.importFileSnapshots = [];
    incomplete.importedReportFileCount = 0;
    incomplete.importedReportFiles = [];
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(incomplete);

    expect(() => test.model.get(CONTEXT)).toThrow(/collection proof UNKNOWN/i);
  });

  it.each([
    [null, 'claimed'],
    ['failed', 'failed'],
    ['blocked', 'failed'],
  ] as const)(
    'projects a protected-only semantic attempt with terminal %s as %s',
    (terminalState, expectedState) => {
      const test = harness({ currentConfig: config() });
      test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
        protectedAttempt({ terminalState }),
      );

      expect(test.model.get(CONTEXT)).toMatchObject({
        state: expectedState,
        fingerprint: expectedFingerprint(),
      });
    },
  );

  it('fails closed when protected success has no exact authority DB job', () => {
    const test = harness({ currentConfig: config() });
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'succeeded' }),
    );

    expect(() => test.model.get(CONTEXT)).toThrow(/protected success.*authority DB/i);
  });

  it.each([
    ['requestId', protectedAttempt({ requestId: 'another-request' })],
    ['storeId', protectedAttempt({ context: { ...CONTEXT, storeId: 'other-store' as typeof CONTEXT.storeId } })],
    ['profileId', protectedAttempt({ context: { ...CONTEXT, browserProfileId: 'other-profile' as typeof CONTEXT.browserProfileId } })],
    ['businessDate', protectedAttempt({ context: { ...CONTEXT, businessDate: '2026-07-21' as typeof CONTEXT.businessDate } })],
    ['fingerprint', protectedAttempt({ fingerprint: 'f'.repeat(64) })],
  ])('fails closed on DB/protected %s identity mismatch', (_axis, protectedReadback) => {
    const test = harness({ currentConfig: config() });
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(
      durableProof({ state: 'completed', importState: 'succeeded' }),
    );
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(protectedReadback);

    expect(() => test.model.get(CONTEXT)).toThrow(/identity mismatch/i);
  });

  it('combines only matching durable and protected identities', () => {
    const test = harness({ currentConfig: config() });
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(
      durableProof({ state: 'completed', importState: 'succeeded' }),
    );
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'succeeded' }),
    );

    expect(test.model.get(CONTEXT)).toMatchObject({ state: 'succeeded' });
  });

  it('combines matching failed import and protected failure terminals', () => {
    const test = harness({ currentConfig: config() });
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(
      durableProof({ state: 'completed', importState: 'failed' }),
    );
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'failed' }),
    );

    expect(test.model.get(CONTEXT)).toMatchObject({ state: 'failed' });
  });

  it('accepts protected original failure beside durable resumed success only with its exact receipt', () => {
    const test = harness({ currentConfig: config() });
    const before = durableProof({ state: 'failed', importState: 'not_applicable' });
    const after = durableProof({ state: 'completed', importState: 'succeeded' });
    after.job.updatedAt = '2026-07-22T15:06:00.000Z';
    after.jobRow.updatedAt = after.job.updatedAt;
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(after);
    test.importRepository.readUniqueSucceededCollectionResumeReceiptForStore.mockReturnValue(
      resumeReceipt({ before, after, outcome: 'succeeded' }),
    );
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'failed' }),
    );

    expect(test.model.get(CONTEXT)).toMatchObject({ state: 'succeeded' });
    expect(test.importRepository.readUniqueSucceededCollectionResumeReceiptForStore)
      .toHaveBeenCalledWith(CONTEXT.storeId, 'job-one', 'scheduler-request-one');
  });

  it('accepts the append-only recovered-succeeded bridge after an orphan resume was interrupted', () => {
    const test = harness({ currentConfig: config() });
    const base = durableProof({ state: 'failed', importState: 'not_applicable' });
    const recovered = durableProof({ state: 'completed', importState: 'succeeded' });
    recovered.job.updatedAt = '2026-07-22T15:06:00.000Z';
    recovered.jobRow.updatedAt = recovered.job.updatedAt;
    const bridge = {
      ...resumeReceipt({ before: base, after: recovered, outcome: 'succeeded' }),
    };
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(recovered);
    test.importRepository.readLatestCollectionResumeAttemptReceiptForStore.mockReturnValue({
      ...bridge,
      attemptId: 'resume-attempt-one',
      outcome: 'interrupted',
    });
    test.importRepository.readUniqueSucceededCollectionResumeReceiptForStore.mockReturnValue(bridge);
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'failed' }),
    );

    expect(test.model.get(CONTEXT)).toMatchObject({ state: 'succeeded' });
    expect(test.importRepository.readUniqueSucceededCollectionResumeReceiptForStore)
      .toHaveBeenCalledWith(CONTEXT.storeId, 'job-one', 'scheduler-request-one');
  });

  it('returns duplicate on a successful resumed-job repeat without resuming it again', async () => {
    const test = harness({ currentConfig: config() });
    const before = durableProof({ state: 'failed', importState: 'not_applicable' });
    const after = durableProof({ state: 'completed', importState: 'succeeded' });
    after.job.updatedAt = '2026-07-22T15:06:00.000Z';
    after.jobRow.updatedAt = after.job.updatedAt;
    test.importRepository.getCollectionJobForStore.mockReturnValue(after.job);
    test.importRepository.readUniqueCollectionAuthorityProofForStoreByRequestId
      .mockReturnValue(after);
    test.importRepository.readUniqueSucceededCollectionResumeReceiptForStore.mockReturnValue(
      resumeReceipt({ before, after, outcome: 'succeeded' }),
    );
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'failed' }),
    );
    await expect(test.model.resumeJob(CONTEXT, 'job-one')).resolves.toMatchObject({
      accepted: false,
      duplicate: true,
      projection: { state: 'succeeded' },
      job: { jobId: 'job-one', state: 'completed', importState: 'succeeded' },
    });
    expect(test.resumeExisting).not.toHaveBeenCalled();
    expect(test.manualRun).not.toHaveBeenCalled();
    expect(test.importRepository.getCollectionInPlaceResumeStateForStore).not.toHaveBeenCalled();
  });

  it.each([
    [
      'protected failure versus DB success',
      durableProof({ state: 'completed', importState: 'succeeded' }),
      protectedAttempt({ terminalState: 'failed' }),
    ],
    [
      'protected success versus DB failure',
      durableProof({ state: 'failed', importState: 'not_applicable' }),
      protectedAttempt({ terminalState: 'succeeded' }),
    ],
    [
      'protected success versus DB still running',
      durableProof({ state: 'running' }),
      protectedAttempt({ terminalState: 'succeeded' }),
    ],
    [
      'protected missing terminal versus DB terminal',
      durableProof({ state: 'completed', importState: 'succeeded' }),
      protectedAttempt({ terminalState: null }),
    ],
  ])('fails closed on %s terminal mismatch', (_label, durable, protectedReadback) => {
    const test = harness({ currentConfig: config() });
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(durable);
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(protectedReadback);

    expect(() => test.model.get(CONTEXT)).toThrow(/identity mismatch/i);
  });

  it('propagates duplicate or corrupt authority readers instead of falling back to due', () => {
    const dbFailure = harness({ currentConfig: config() });
    dbFailure.importRepository.inspectUniqueCollectionJobForSemanticScope.mockImplementation(() => {
      throw new Error('duplicate durable semantic scope');
    });
    expect(() => dbFailure.model.get(CONTEXT)).toThrow('duplicate durable semantic scope');
    expect(dbFailure.orchestrator.readProtectedSemanticAttempt).not.toHaveBeenCalled();

    const protectedFailure = harness({ currentConfig: config() });
    protectedFailure.orchestrator.readProtectedSemanticAttempt.mockImplementation(() => {
      throw new Error('corrupt protected history');
    });
    expect(() => protectedFailure.model.get(CONTEXT)).toThrow('corrupt protected history');
  });

  it.each([
    ['wrong store', { ...CONTEXT, storeId: 'other-store' as typeof CONTEXT.storeId }],
    ['stale generation', { ...CONTEXT, sessionGeneration: CONTEXT.sessionGeneration - 1 }],
  ])('rejects %s before reading config, DB, or protected history', async (_label, stale) => {
    const test = harness({ currentConfig: config() });

    expect(() => test.model.get(stale)).toThrow('stale or wrong active context');
    await expect(test.model.runNow(stale)).rejects.toThrow('stale or wrong active context');
    expect(test.runtimeConfig.get).not.toHaveBeenCalled();
    expect(test.importRepository.inspectUniqueCollectionJobForSemanticScope).not.toHaveBeenCalled();
    expect(test.orchestrator.readProtectedSemanticAttempt).not.toHaveBeenCalled();
    expect(test.manualRun).not.toHaveBeenCalled();
  });

  it('projects due at or after the configured Los Angeles schedule time', () => {
    const test = harness({
      currentConfig: config(),
      now: '2026-07-22T14:30:00.000Z',
    });

    expect(test.model.get(CONTEXT)).toMatchObject({
      state: 'due',
      scheduleLocalTime: '07:30',
    });
  });

  it("propagates the caller's Package UI read-only rejection before post-run readback", async () => {
    const test = harness({ currentConfig: config() });
    const packageUiRejection = Object.assign(new Error('PACKAGE_UI_READ_ONLY'), {
      code: 'PACKAGE_UI_READ_ONLY',
    });
    test.manualRun.mockRejectedValue(packageUiRejection);

    await expect(test.model.runNow(CONTEXT)).rejects.toBe(packageUiRejection);

    expect(test.manualRun).toHaveBeenCalledOnce();
    expect(test.manualRun).toHaveBeenCalledWith(CONTEXT);
    expect(test.authority.getActiveStoreContext).not.toHaveBeenCalled();
    expect(test.runtimeConfig.get).toHaveBeenCalledOnce();
  });

  it('returns duplicate for an exact skipped target and attaches only a sanitized durable job', async () => {
    const test = harness({ currentConfig: config() });
    const proof = durableProof({ state: 'running' });
    (proof.job as typeof proof.job & { downloadDir: string }).downloadDir = 'C:\\authority\\secret';
    proof.job.detail = 'local C:\\authority\\secret';
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(proof);
    test.manualRun.mockResolvedValue({
      cycleId: 'cycle-duplicate',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: [CONTEXT.storeId],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    const result = await test.model.runNow(CONTEXT);

    expect(result).toMatchObject({
      accepted: false,
      duplicate: true,
      projection: { state: 'claimed' },
      job: { jobId: 'job-one', state: 'running' },
    });
    expect(JSON.stringify(result)).not.toContain('C:\\\\authority');
    expect(result.job).not.toHaveProperty('downloadDir');
    expect(result.job).not.toHaveProperty('detail');
    expect(test.manualRun).toHaveBeenCalledOnce();
    expect(test.manualRun).toHaveBeenCalledWith(CONTEXT);
  });

  it('allowlists nested created report identity fields in the Renderer duplicate DTO', async () => {
    const test = harness({ currentConfig: config() });
    const proof = durableProof({ state: 'completed', importState: 'pending' });
    const createdReportIdentity = proof.job.reports[0]!.createdReportIdentity!;
    (createdReportIdentity as typeof createdReportIdentity & { localPath: string }).localPath =
      'C:\\authority-secret\\created-report.xlsx';
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(proof);
    test.manualRun.mockResolvedValue({
      cycleId: 'cycle-duplicate-created-report',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: [CONTEXT.storeId],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    const result = await test.model.runNow(CONTEXT);

    expect(result.job?.reports[0]?.createdReportIdentity).toEqual({
      provider: 'lingxing',
      reportType: ANALYSIS_REQUIRED_REPORT_TYPES[0],
      externalReportName: `report-${ANALYSIS_REQUIRED_REPORT_TYPES[0]}`,
      dateStart: '2026-07-15',
      dateEnd: '2026-07-21',
      createdAt: '2026-07-22T15:00:30.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('authority-secret');
  });

  it('fails closed when the exact config revision drifts during a skipped manual run', async () => {
    const initial = config();
    const test = harness({ currentConfig: initial });
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(
      durableProof({ state: 'running' }),
    );
    test.manualRun.mockImplementation(async () => {
      test.runtimeConfigState.current = {
        ...initial,
        revision: initial.revision + 1,
        updatedAt: '2026-07-22T15:06:00.000Z',
      };
      return {
        cycleId: 'cycle-stale-skip',
        state: 'completed',
        outcomes: [],
        skippedStoreIds: [CONTEXT.storeId],
        plannedDueStoreIds: [],
        attemptedStoreIds: [],
      };
    });

    await expect(test.model.runNow(CONTEXT)).rejects.toThrow(/manual run scope changed/i);
  });

  it('fails closed when the exact fingerprint drifts during a skipped manual run', async () => {
    const initial = config();
    const test = harness({ currentConfig: initial });
    const firstProof = durableProof({ state: 'running' });
    const driftedProof = durableProof({
      state: 'running',
      requestId: 'scheduler-request-drifted',
      dateStart: '2026-07-08',
    });
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockImplementation((raw) => {
      const scope = raw as { dateStart?: string };
      return scope.dateStart === '2026-07-08' ? driftedProof : firstProof;
    });
    test.manualRun.mockImplementation(async () => {
      test.runtimeConfigState.current = {
        ...initial,
        values: {
          ...initial.values,
          collectionLookbackDays: 14,
        },
        updatedAt: '2026-07-22T15:06:00.000Z',
      };
      return {
        cycleId: 'cycle-stale-fingerprint-skip',
        state: 'completed',
        outcomes: [],
        skippedStoreIds: [CONTEXT.storeId],
        plannedDueStoreIds: [],
        attemptedStoreIds: [],
      };
    });

    await expect(test.model.runNow(CONTEXT)).rejects.toThrow(/manual run scope changed/i);
  });

  it('accepts an exact attempted target after Main advances only the session generation', async () => {
    const test = harness({ currentConfig: config() });
    const refreshed = { ...CONTEXT, sessionGeneration: CONTEXT.sessionGeneration + 1 };
    test.importRepository.inspectUniqueCollectionJobForSemanticScope.mockReturnValue(
      durableProof({ state: 'completed', importState: 'succeeded' }),
    );
    test.orchestrator.readProtectedSemanticAttempt.mockReturnValue(
      protectedAttempt({ terminalState: 'succeeded' }),
    );
    test.manualRun.mockImplementation(async () => {
      test.active.current = refreshed;
      return {
        cycleId: 'cycle-attempted',
        state: 'completed',
        outcomes: [{
          storeId: CONTEXT.storeId,
          browserProfileId: CONTEXT.browserProfileId,
          businessDate: CONTEXT.businessDate,
          fingerprint: expectedFingerprint(),
          requestId: 'scheduler-request-one',
          state: 'succeeded',
        }],
        skippedStoreIds: [],
        plannedDueStoreIds: [CONTEXT.storeId],
        attemptedStoreIds: [CONTEXT.storeId],
      };
    });

    await expect(test.model.runNow(CONTEXT)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
      projection: {
        storeId: CONTEXT.storeId,
        businessDate: CONTEXT.businessDate,
        state: 'succeeded',
      },
      job: { jobId: 'job-one', state: 'completed', importState: 'succeeded' },
    });
    expect(test.authority.getActiveStoreContext).toHaveBeenCalledOnce();
    expect(test.authority.assertActiveStoreContext).toHaveBeenLastCalledWith(refreshed);
  });

  it.each([
    ['store', { ...CONTEXT, storeId: 'other-store' as typeof CONTEXT.storeId, sessionGeneration: 5 }],
    ['profile', { ...CONTEXT, browserProfileId: 'other-profile' as typeof CONTEXT.browserProfileId, sessionGeneration: 5 }],
    ['business date', { ...CONTEXT, businessDate: '2026-07-23' as typeof CONTEXT.businessDate, sessionGeneration: 5 }],
    ['marketplace', { ...CONTEXT, marketplace: 'CA' as 'US', sessionGeneration: 5 }],
    ['currency', { ...CONTEXT, currency: 'CAD' as 'USD', sessionGeneration: 5 }],
    ['timezone', { ...CONTEXT, businessTimezone: 'UTC', sessionGeneration: 5 }],
    ['generation rollback', { ...CONTEXT, sessionGeneration: 3 }],
  ])('fails closed when Main active authority changes %s during manual run', async (_axis, refreshed) => {
    const test = harness({ currentConfig: config() });
    test.manualRun.mockImplementation(async () => {
      test.active.current = refreshed;
      return {
        cycleId: 'cycle-drifted',
        state: 'completed',
        outcomes: [{
          storeId: CONTEXT.storeId,
          browserProfileId: CONTEXT.browserProfileId,
          businessDate: CONTEXT.businessDate,
          fingerprint: expectedFingerprint(),
          state: 'succeeded',
        }],
        skippedStoreIds: [],
        plannedDueStoreIds: [CONTEXT.storeId],
        attemptedStoreIds: [CONTEXT.storeId],
      };
    });

    await expect(test.model.runNow(CONTEXT)).rejects.toThrow(/active authority changed/i);
    expect(test.runtimeConfig.get).toHaveBeenCalledOnce();
    expect(test.runtimeConfig.get).toHaveBeenCalledWith(CONTEXT);
  });

  it('keeps accepted true and the due projection for a pre-scheduler identity block with no records', async () => {
    const test = harness({ currentConfig: config() });
    test.manualRun.mockResolvedValue({
      cycleId: 'cycle-login-blocked',
      state: 'completed',
      outcomes: [{
        storeId: CONTEXT.storeId,
        browserProfileId: CONTEXT.browserProfileId,
        businessDate: CONTEXT.businessDate,
        fingerprint: expectedFingerprint(),
        schedulerSucceeded: false,
        state: 'blocked',
        failureCode: 'IDENTITY_UNVERIFIED',
      }],
      skippedStoreIds: [],
      plannedDueStoreIds: [CONTEXT.storeId],
      attemptedStoreIds: [CONTEXT.storeId],
    });

    await expect(test.model.runNow(CONTEXT)).resolves.toEqual({
      accepted: true,
      duplicate: false,
      projection: expect.objectContaining({
        state: 'due',
        fingerprint: expectedFingerprint(),
      }),
    });
  });

  it.each([
    ['unrelated target', {
      outcomes: [], skippedStoreIds: [], plannedDueStoreIds: [], attemptedStoreIds: [],
    }],
    ['both skipped and attempted', {
      outcomes: [], skippedStoreIds: [CONTEXT.storeId], plannedDueStoreIds: [CONTEXT.storeId], attemptedStoreIds: [CONTEXT.storeId],
    }],
    ['another store included', {
      outcomes: [], skippedStoreIds: [], plannedDueStoreIds: [CONTEXT.storeId], attemptedStoreIds: [CONTEXT.storeId, 'other-store'],
    }],
    ['missing outcome for attempt', {
      outcomes: [], skippedStoreIds: [], plannedDueStoreIds: [CONTEXT.storeId], attemptedStoreIds: [CONTEXT.storeId],
    }],
  ])('fails closed on an ambiguous manual cycle: %s', async (_label, cycle) => {
    const test = harness({ currentConfig: config() });
    test.manualRun.mockResolvedValue({ cycleId: 'cycle-ambiguous', state: 'completed', ...cycle });

    await expect(test.model.runNow(CONTEXT)).rejects.toThrow(/manual cycle.*ambiguous/i);
  });

  it('rejects a skipped cycle without durable or protected duplicate proof', async () => {
    const test = harness({ currentConfig: config() });
    test.manualRun.mockResolvedValue({
      cycleId: 'cycle-unproved-duplicate',
      state: 'completed',
      outcomes: [],
      skippedStoreIds: [CONTEXT.storeId],
      plannedDueStoreIds: [],
      attemptedStoreIds: [],
    });

    await expect(test.model.runNow(CONTEXT)).rejects.toThrow(/duplicate.*proof/i);
  });

  it('rejects a record-free attempted failure unless it is an identity/login block', async () => {
    const test = harness({ currentConfig: config() });
    test.manualRun.mockResolvedValue({
      cycleId: 'cycle-runtime-failed',
      state: 'completed',
      outcomes: [{
        storeId: CONTEXT.storeId,
        browserProfileId: CONTEXT.browserProfileId,
        businessDate: CONTEXT.businessDate,
        fingerprint: expectedFingerprint(),
        state: 'failed',
        failureCode: 'RUNTIME_START_FAILED',
      }],
      skippedStoreIds: [],
      plannedDueStoreIds: [CONTEXT.storeId],
      attemptedStoreIds: [CONTEXT.storeId],
    });

    await expect(test.model.runNow(CONTEXT)).rejects.toThrow(/identity block proof/i);
  });

  it('does not import or invoke the legacy StoreCollectionScheduler execution surface', () => {
    const source = readFileSync(
      new URL('./store-collection-scheduler-read-model.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/from ['"]\.\/store-collection-scheduler['"]/);
    expect(source).not.toContain('.reconcile(');
    expect(source).not.toContain('.start()');
  });
});
