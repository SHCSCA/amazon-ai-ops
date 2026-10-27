import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  afterAll,
  expect,
  vi,
} from 'vitest';
import type {
  LingxingCollectionJobSnapshot,
  LingxingCollectionProgressEvent,
  LingxingCollectionRequestDto,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type {
  RunBatchOptions,
  RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type {
  CollectionInPlaceResumeState,
  CollectionResumeAttemptReceipt,
  CollectionResumeClaim,
} from '@amazon-ai-ops/local-db';
import { deriveStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import {
  LingxingCollectionCoordinator,
  normalizeCollectionRequest,
} from './lingxing-collection-coordinator';

export const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aao-lingxing-coordinator-'));

afterAll(() => {
  fs.rmSync(TEST_ROOT, { force: true, recursive: true });
});

export function context(storeId = 'store-one', sessionGeneration = 4): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId,
    browserProfileId: `profile-${storeId}`,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-22',
    sessionGeneration,
  });
}

export function request(storeContext = context()) {
  return {
    requestId: 'collect-store-one-001',
    storeContext,
    dateStart: '2026-07-15',
    dateEnd: '2026-07-21',
    mode: 'create-and-download' as const,
    reportTypes: ['campaign', 'keyword'] as const,
  };
}

export function capsuleFor(storeContext = context()) {
  return deriveStoreCapsulePaths(
    TEST_ROOT,
    storeContext.storeId,
    storeContext.browserProfileId,
  );
}

export function jobRequest(storeContext = context()): LingxingCollectionRequestDto {
  return normalizeCollectionRequest(request(storeContext));
}

export function fullEightResumeState(): CollectionInPlaceResumeState {
  const durableContext = context('store-one', 3);
  const durableRequest = normalizeCollectionRequest({
    ...request(durableContext),
    requestId: 'collect-resume-001',
    reportTypes: undefined,
  });
  const updatedAt = '2026-07-22T07:59:00.000Z';
  const reports = durableRequest.reportTypes.map((reportType) => ({
    reportType,
    state: 'queued' as const,
    attemptIndex: 0,
    autoRetryCount: 0,
    updatedAt,
  }));
  return {
    jobId: 'batch-1',
    request: durableRequest,
    reports,
    job: {
      jobId: 'batch-1',
      request: durableRequest,
      state: 'failed',
      reports,
      blockerCode: 'LINGXING_COLLECTION_STEP_FAILED',
      detail: 'safe pre-create failure',
      createdAt: '2026-07-22T07:58:00.000Z',
      completedAt: updatedAt,
      updatedAt,
    },
    batch: {
      id: 'batch-1',
      requestId: durableRequest.requestId,
      storeId: durableContext.storeId,
      browserProfileId: durableContext.browserProfileId,
      businessDate: durableContext.businessDate,
      sessionGeneration: durableContext.sessionGeneration,
      dateStart: durableRequest.dateStart,
      dateEnd: durableRequest.dateEnd,
      storeName: 'SHC001 主店',
      marketplaceCode: 'US',
      status: 'failed',
      downloadDir: path.join(capsuleFor(context()).downloadsDir, 'batch-1'),
      createdAt: '2026-07-22T07:58:00.000Z',
      completedAt: updatedAt,
    },
    files: [],
    expectedJobUpdatedAt: updatedAt,
    authorityProofSha256: 'a'.repeat(64),
  };
}

export function resultFor(options: RunBatchOptions): RunBatchResult {
  const now = '2026-07-22T08:00:00.000Z';
  const requestDto: LingxingCollectionRequestDto = {
    requestId: options.requestId,
    storeContext: options.storeContext,
    dateStart: options.dateStart,
    dateEnd: options.dateEnd,
    mode: 'create-and-download',
    reportTypes: [...(options.reportTypes || [])],
  };
  const reports = requestDto.reportTypes.map((reportType) => ({
    reportType,
    state: 'downloaded' as const,
    attemptIndex: 0,
    autoRetryCount: 0,
    updatedAt: now,
  }));
  const downloadDir = path.join(options.rootDownloadDir, 'batch-1');
  fs.mkdirSync(downloadDir, { recursive: true });
  const files = requestDto.reportTypes.map((reportType) => {
    const filePath = path.join(downloadDir, `${reportType}.csv`);
    fs.writeFileSync(filePath, 'date,cost\n2026-07-21,1.00\n', 'utf8');
    return {
      id: `file-${reportType}`,
      batchId: 'batch-1',
      reportType,
      displayName: reportType,
      status: 'downloaded' as const,
      maxAutoRetries: 2,
      autoRetryCount: 0,
      filePath,
      fileSizeBytes: fs.statSync(filePath).size,
      attemptErrors: [],
      createdAt: now,
      updatedAt: now,
    };
  });
  const manifestPath = path.join(downloadDir, 'manifest.json');
  fs.writeFileSync(manifestPath, '{}\n', 'utf8');
  return {
    batch: {
      id: 'batch-1',
      requestId: options.requestId,
      storeId: options.storeContext.storeId,
      browserProfileId: options.storeContext.browserProfileId,
      businessDate: options.storeContext.businessDate,
      sessionGeneration: options.storeContext.sessionGeneration,
      dateStart: options.dateStart,
      dateEnd: options.dateEnd,
      storeName: options.storeDisplayName,
      marketplaceCode: 'US',
      status: 'completed',
      downloadDir,
      manifestPath,
      createdAt: now,
      completedAt: now,
    },
    files,
    job: {
      jobId: 'batch-1',
      request: requestDto,
      state: 'completed',
      reports,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    },
  };
}

export function progressFor(options: RunBatchOptions): LingxingCollectionProgressEvent {
  const reportTypes = [...(options.reportTypes || [])];
  return {
    eventId: 'batch-1:1',
    emittedAt: '2026-07-22T08:00:00.000Z',
    job: {
      jobId: 'batch-1',
      request: {
        requestId: options.requestId,
        storeContext: options.storeContext,
        dateStart: options.dateStart,
        dateEnd: options.dateEnd,
        mode: 'create-and-download',
        reportTypes,
      },
      state: 'running',
      reports: reportTypes.map((reportType) => ({
        reportType,
        state: 'queued',
        attemptIndex: 0,
        autoRetryCount: 0,
        updatedAt: '2026-07-22T08:00:00.000Z',
      })),
      createdAt: '2026-07-22T08:00:00.000Z',
      updatedAt: '2026-07-22T08:00:00.000Z',
    },
  };
}

export function harness(options: {
  preflight?: () => void | Promise<void>;
  productionImport?: boolean;
  omitInjectedRunner?: boolean;
} = {}) {
  let active = context();
  let cancelled = false;
  const persistedProgress: LingxingCollectionProgressEvent[] = [];
  const published: LingxingCollectionProgressEvent[] = [];
  const persistedResults: RunBatchResult[] = [];
  const persistedImportStates: LingxingCollectionJobSnapshot[] = [];
  const resumeProgress: LingxingCollectionProgressEvent[] = [];
  const resumeFinalized: Array<{ outcome: string; claimVersion: number }> = [];
  let resumeClaimSequence = 0;
  const nextResumeClaim = (claim?: any) => {
    resumeClaimSequence += 1;
    return {
      storeId: context().storeId,
      attemptId: claim?.attemptId ?? 'attempt-coordinator-resume',
      jobId: claim?.jobId ?? 'batch-1',
      requestId: claim?.requestId ?? 'collect-resume-001',
      claimToken: `token-${resumeClaimSequence}`,
      expectedJobUpdatedAt: claim?.expectedJobUpdatedAt ?? '2026-07-22T07:59:00.000Z',
      expectedAuthorityProofSha256: 'a'.repeat(64),
      version: (claim?.version ?? 0) + 1,
      claimedAt: claim?.claimedAt ?? '2026-07-22T07:59:30.000Z',
    };
  };
  const importResult = vi.fn(async () => ({ inserted: 12 }));
  const receiptFor = (
    claim: CollectionResumeClaim,
    outcome: CollectionResumeAttemptReceipt['outcome'],
    completedAt = claim.expectedJobUpdatedAt,
  ): CollectionResumeAttemptReceipt => ({
    storeId: claim.storeId,
    attemptId: claim.attemptId,
    jobId: claim.jobId,
    requestId: claim.requestId,
    outcome,
    baseJobUpdatedAt: '2026-07-22T07:59:00.000Z',
    finalJobUpdatedAt: claim.expectedJobUpdatedAt,
    baseAuthorityProofSha256: 'a'.repeat(64),
    finalAuthorityProofSha256: 'b'.repeat(64),
    durableSessionGeneration: 3,
    executionSessionGeneration: 4,
    executionContextSha256: 'c'.repeat(64),
    claimedAt: claim.claimedAt,
    completedAt,
  });
  const resumeFinalize = vi.fn((_storeId: string, input: any) => {
    resumeFinalized.push({ outcome: input.outcome, claimVersion: input.claim.version });
    return receiptFor(input.claim, input.outcome, input.completedAt);
  });
  const resumeInterrupt = vi.fn((_storeId: string, input: any) => {
    resumeFinalized.push({ outcome: 'interrupted', claimVersion: input.claim.version });
    return receiptFor(input.claim, 'interrupted');
  });
  const clearCancellation = vi.fn();
  const acquireCollectionResumeClaimForStore = vi.fn((_storeId, input) => (
    nextResumeClaim({
      jobId: input.jobId,
      requestId: input.requestId,
      expectedJobUpdatedAt: input.expectedJobUpdatedAt,
      version: 0,
    })
  ));
  const operation = {
    assertStepCurrent: vi.fn(() => {
      if (active.storeId !== 'store-one' || active.sessionGeneration !== 4) {
        throw new Error('stale authority');
      }
      return { purpose: 'collection' };
    }),
    renew: vi.fn(() => {
      if (active.storeId !== 'store-one' || active.sessionGeneration !== 4) {
        throw new Error('stale authority');
      }
      return { purpose: 'collection' };
    }),
  };
  const runCreateBatch = vi.fn(async (options: RunBatchOptions) => {
    await options.progressSink(progressFor(options));
    expect(await options.authorityGuard({
      jobId: 'batch-1',
      requestId: options.requestId,
      storeContext: options.storeContext,
      reportType: 'campaign',
      attemptIndex: 0,
      step: 'navigate',
    })).toEqual({ allowed: true });
    return resultFor(options);
  });
  const coordinator = new LingxingCollectionCoordinator({
    authority: {
      assertActiveStoreContext(value) {
        const submitted = normalizeStoreContextEnvelope(value);
        if (submitted.storeId !== active.storeId
          || submitted.sessionGeneration !== active.sessionGeneration) {
          throw new Error('stale authority');
        }
        return active;
      },
      getActiveStoreContext: () => active,
    },
    operations: {
      run: async (_input, execute) => execute(operation as never),
    },
    resolveRuntime: (_context, { canary }) => ({
      storeId: active.storeId,
      browserProfileId: active.browserProfileId,
      capsule: capsuleFor(active),
      automation: {} as never,
      canary,
      storeDisplayName: 'SHC001 主店',
      target: { marketplaceCode: 'US', storeId: active.storeId, storeName: 'SHC001' },
    }),
    ...(options.preflight ? { preflight: options.preflight } : {}),
    ...(options.productionImport
      ? {
          productionImport: {
            policy: 'exact-eight-lineage-v1' as const,
            run: importResult,
          },
        }
      : { importResult }),
    persistence: {
      persistProgress(event) { persistedProgress.push(event); },
      persistResult(result) { persistedResults.push(result); },
      persistImportState(job) { persistedImportStates.push(job); },
      acquireCollectionResumeClaimForStore,
      commitCollectionResumeProgressForStore(_storeId, input) {
        resumeProgress.push(input.event);
        return nextResumeClaim({
          ...input.claim,
          expectedJobUpdatedAt: input.event.job.updatedAt,
        });
      },
      commitCollectionResumeRunnerResultForStore(_storeId, input) {
        return {
          claim: nextResumeClaim({
            ...input.claim,
            expectedJobUpdatedAt: input.job.updatedAt,
          }),
          result: { job: input.job, batch: input.batch as any, files: input.files as any },
        };
      },
      advanceCollectionResumeClaimAfterImportForStore(_storeId, input) {
        return nextResumeClaim(input.claim);
      },
      finalizeCollectionResumeAttemptForStore: resumeFinalize,
      interruptCollectionResumeClaimForStore: resumeInterrupt,
    },
    isCancelled: () => cancelled,
    clearCancellation,
    publishProgress(event) { published.push(event); },
    ...(options.omitInjectedRunner ? {} : { runCreateBatch }),
  });
  return {
    coordinator,
    get active() { return active; },
    set active(value: StoreContextEnvelope) { active = value; },
    operation,
    persistedProgress,
    persistedResults,
    persistedImportStates,
    importResult,
    published,
    runCreateBatch,
    resumeProgress,
    resumeFinalized,
    resumeFinalize,
    resumeInterrupt,
    acquireCollectionResumeClaimForStore,
    clearCancellation,
    get cancelled() { return cancelled; },
    set cancelled(value: boolean) { cancelled = value; },
    receiptFor,
  };
}
