import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type {
  LingxingCollectionJobSnapshot,
  LingxingCollectionProgressEvent,
  LingxingCollectionRequestDto,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { RunBatchOptions, RunBatchResult } from '@amazon-ai-ops/lingxing-report-collector';
import { deriveStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import {
  LingxingCollectionCoordinator,
  normalizeCollectionRequest,
} from './lingxing-collection-coordinator';

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'aao-lingxing-coordinator-'));

afterAll(() => {
  fs.rmSync(TEST_ROOT, { force: true, recursive: true });
});

function context(storeId = 'store-one', sessionGeneration = 4): StoreContextEnvelope {
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

function request(storeContext = context()) {
  return {
    requestId: 'collect-store-one-001',
    storeContext,
    dateStart: '2026-07-15',
    dateEnd: '2026-07-21',
    mode: 'create-and-download' as const,
    reportTypes: ['campaign', 'keyword'] as const,
  };
}

function capsuleFor(storeContext = context()) {
  return deriveStoreCapsulePaths(
    TEST_ROOT,
    storeContext.storeId,
    storeContext.browserProfileId,
  );
}

function jobRequest(storeContext = context()): LingxingCollectionRequestDto {
  return normalizeCollectionRequest(request(storeContext));
}

function resultFor(options: RunBatchOptions): RunBatchResult {
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

function progressFor(options: RunBatchOptions): LingxingCollectionProgressEvent {
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

function harness() {
  let active = context();
  const persistedProgress: LingxingCollectionProgressEvent[] = [];
  const published: LingxingCollectionProgressEvent[] = [];
  const persistedResults: RunBatchResult[] = [];
  const persistedImportStates: LingxingCollectionJobSnapshot[] = [];
  const importResult = vi.fn(async () => ({ inserted: 12 }));
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
    persistence: {
      persistProgress(event) { persistedProgress.push(event); },
      persistResult(result) { persistedResults.push(result); },
      persistImportState(job) { persistedImportStates.push(job); },
    },
    importResult,
    publishProgress(event) { published.push(event); },
    runCreateBatch,
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
  };
}

describe('LingxingCollectionCoordinator', () => {
  it('re-authorizes the captured store, owns the capsule path, persists progress, and imports', async () => {
    const test = harness();
    const output = await test.coordinator.start(request());

    expect(test.runCreateBatch).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'collect-store-one-001',
      storeContext: context(),
      rootDownloadDir: capsuleFor().downloadsDir,
      reportTypes: ['campaign', 'keyword'],
    }));
    expect(test.operation.renew).toHaveBeenCalled();
    expect(test.persistedProgress).toHaveLength(1);
    expect(test.published).toHaveLength(4);
    expect(test.published.at(-1)?.job.state).toBe('completed');
    expect(test.published.at(-1)?.job.importState).toBe('succeeded');
    expect(test.persistedResults).toHaveLength(1);
    expect(test.persistedResults[0].job.importState).toBe('pending');
    expect(test.persistedImportStates.map((job) => job.importState))
      .toEqual(['pending', 'succeeded']);
    expect(output.result.job.importState).toBe('succeeded');
    expect(output.importSummary).toEqual({ inserted: 12 });
  });

  it('does not publish an earlier store progress event after the selected store changes', async () => {
    const test = harness();
    test.runCreateBatch.mockImplementationOnce(async (options) => {
      test.active = context('store-two', 1);
      await options.progressSink(progressFor(options));
      return resultFor(options);
    });

    await expect(test.coordinator.start(request())).rejects.toThrow('stale authority');
    expect(test.persistedProgress).toHaveLength(1);
    expect(test.published).toHaveLength(0);
    expect(test.persistedResults).toHaveLength(0);
  });

  it('rejects an invalid or unsupported request before resolving a runtime', () => {
    expect(() => normalizeCollectionRequest({
      ...request(),
      dateStart: '2026-07-32',
    })).toThrow('dateStart is invalid');
    expect(() => normalizeCollectionRequest({
      ...request(),
      reportTypes: ['campaign', 'campaign'],
    })).toThrow('reportTypes are invalid');
    expect(() => normalizeCollectionRequest({
      ...request(),
      storeContext: { ...context(), currency: 'EUR' } as never,
    })).toThrow('USD');
  });

  it('turns an operator cancellation into a collector guard decision', async () => {
    const test = harness();
    const cancelledRunner = vi.fn(async (options: RunBatchOptions) => {
      const decision = await options.cancellationGuard({
        jobId: 'batch-1',
        requestId: options.requestId,
        storeContext: options.storeContext,
        reportType: 'campaign',
        attemptIndex: 0,
        step: 'navigate',
      });
      expect(decision).toEqual(expect.objectContaining({
        allowed: false,
        blockerCode: 'LINGXING_COLLECTION_CANCELLED',
      }));
      const cancelled = resultFor(options);
      cancelled.job.state = 'cancelled';
      cancelled.batch.status = 'failed';
      return cancelled;
    });
    const coordinator = new LingxingCollectionCoordinator({
      authority: {
        assertActiveStoreContext: () => context(),
        getActiveStoreContext: () => context(),
      },
      operations: { run: async (_input, execute) => execute(test.operation as never) },
      resolveRuntime: () => ({
        storeId: context().storeId,
        browserProfileId: context().browserProfileId,
        capsule: capsuleFor(),
        automation: {} as never,
        canary: false,
        storeDisplayName: 'SHC001 主店',
        target: { marketplaceCode: 'US', storeId: context().storeId, storeName: 'SHC001' },
      }),
      persistence: { persistProgress() {}, persistResult() {}, persistImportState() {} },
      isCancelled: () => true,
      runCreateBatch: cancelledRunner,
    });

    const output = await coordinator.start(request());
    expect(output.result.job.state).toBe('cancelled');
    expect(output.result.job.importState).toBe('not_applicable');
    expect(cancelledRunner).toHaveBeenCalledOnce();
  });

  it('converts a substituted runner success into cancelled and clears only after terminal persistence', async () => {
    const test = harness();
    let cancelled = false;
    const sequence: string[] = [];
    const persistResult = vi.fn((result: RunBatchResult) => {
      sequence.push(`persist:${result.job.state}`);
    });
    const clearCancellation = vi.fn(() => {
      sequence.push('clear');
    });
    const importResult = vi.fn();
    const coordinator = new LingxingCollectionCoordinator({
      authority: {
        assertActiveStoreContext: () => context(),
        getActiveStoreContext: () => context(),
      },
      operations: { run: async (_input, execute) => execute(test.operation as never) },
      resolveRuntime: () => ({
        storeId: context().storeId,
        browserProfileId: context().browserProfileId,
        capsule: capsuleFor(),
        automation: {} as never,
        canary: false,
        storeDisplayName: 'SHC001 主店',
        target: { marketplaceCode: 'US', storeId: context().storeId, storeName: 'SHC001' },
      }),
      persistence: { persistProgress() {}, persistResult, persistImportState() {} },
      isCancelled: () => cancelled,
      clearCancellation,
      importResult,
      runCreateBatch: async (options) => {
        const result = resultFor(options);
        cancelled = true;
        return result;
      },
    });

    const output = await coordinator.start(request());
    expect(output.result).toEqual(expect.objectContaining({
      job: expect.objectContaining({ state: 'cancelled', importState: 'not_applicable' }),
      batch: expect.objectContaining({ status: 'failed' }),
    }));
    expect(persistResult).toHaveBeenCalledOnce();
    expect(sequence).toEqual(['persist:cancelled', 'clear']);
    expect(clearCancellation).toHaveBeenCalledWith({
      storeId: context().storeId,
      requestId: 'collect-store-one-001',
      jobId: 'batch-1',
    });
    expect(importResult).not.toHaveBeenCalled();
  });

  it('retains the cancellation guard when cancelled terminal persistence fails', async () => {
    const test = harness();
    const clearCancellation = vi.fn();
    const coordinator = new LingxingCollectionCoordinator({
      authority: {
        assertActiveStoreContext: () => context(),
        getActiveStoreContext: () => context(),
      },
      operations: { run: async (_input, execute) => execute(test.operation as never) },
      resolveRuntime: () => ({
        storeId: context().storeId,
        browserProfileId: context().browserProfileId,
        capsule: capsuleFor(),
        automation: {} as never,
        canary: false,
        storeDisplayName: 'SHC001 主店',
        target: { marketplaceCode: 'US', storeId: context().storeId, storeName: 'SHC001' },
      }),
      persistence: {
        persistProgress() {},
        persistResult() { throw new Error('durable terminal unavailable'); },
        persistImportState() {},
      },
      isCancelled: () => true,
      clearCancellation,
      runCreateBatch: async (options) => resultFor(options),
    });

    await expect(coordinator.start(request())).rejects.toThrow('durable terminal unavailable');
    expect(clearCancellation).not.toHaveBeenCalled();
  });

  it('rechecks cancellation after terminal persistence and before importing rows', async () => {
    const test = harness();
    let cancelled = false;
    const persistedImportStates: LingxingCollectionJobSnapshot[] = [];
    const importResult = vi.fn();
    const coordinator = new LingxingCollectionCoordinator({
      authority: {
        assertActiveStoreContext: () => context(),
        getActiveStoreContext: () => context(),
      },
      operations: { run: async (_input, execute) => execute(test.operation as never) },
      resolveRuntime: () => ({
        storeId: context().storeId,
        browserProfileId: context().browserProfileId,
        capsule: capsuleFor(),
        automation: {} as never,
        canary: false,
        storeDisplayName: 'SHC001 主店',
        target: { marketplaceCode: 'US', storeId: context().storeId, storeName: 'SHC001' },
      }),
      persistence: {
        persistProgress() {},
        persistResult() { cancelled = true; },
        persistImportState(job) { persistedImportStates.push(job); },
      },
      isCancelled: () => cancelled,
      importResult,
      runCreateBatch: async (options) => resultFor(options),
    });

    await expect(coordinator.start(request())).rejects.toThrow('LINGXING_COLLECTION_CANCELLED');
    expect(persistedImportStates).toHaveLength(0);
    expect(importResult).not.toHaveBeenCalled();
  });

  it('requires the runner result to carry the same store authority', async () => {
    const test = harness();
    test.runCreateBatch.mockImplementationOnce(async (options) => {
      const result = resultFor(options);
      result.batch.storeId = context('store-two', 1).storeId;
      return result;
    });

    await expect(test.coordinator.start(request()))
      .rejects.toThrow('LINGXING_COLLECTION_RESULT_SCOPE_MISMATCH');
    expect(test.persistedResults).toHaveLength(0);
  });

  it('persists a failed terminal snapshot but never imports it', async () => {
    const test = harness();
    test.runCreateBatch.mockImplementationOnce(async (options) => {
      const result = resultFor(options);
      result.job.state = 'failed';
      result.job.blockerCode = 'LINGXING_COLLECTION_MANIFEST_WRITE_FAILED';
      result.batch.status = 'failed';
      if (result.batch.manifestPath) fs.rmSync(result.batch.manifestPath, { force: true });
      result.batch.manifestPath = undefined;
      return result;
    });

    const output = await test.coordinator.start(request());
    expect(test.persistedResults).toHaveLength(1);
    expect(test.importResult).not.toHaveBeenCalled();
    expect(output.importSummary).toBeUndefined();
  });

  it('persists canary evidence but never imports canary rows into production metrics', async () => {
    const test = harness();

    const output = await test.coordinator.start({
      ...request(),
      requestId: 'canary:collect-store-one-001',
      canary: true,
    });

    expect(output.result.job.state).toBe('completed');
    expect(test.persistedResults).toHaveLength(1);
    expect(test.persistedResults[0].job.importState).toBe('not_applicable');
    expect(test.importResult).not.toHaveBeenCalled();
    expect(output.importSummary).toBeUndefined();
  });

  it('does not publish terminal success or import when the atomic terminal commit fails', async () => {
    const test = harness();
    const terminalCommitError = new Error('terminal transaction rolled back');
    const originalProgressCount = test.published.length;
    const coordinator = new LingxingCollectionCoordinator({
      authority: {
        assertActiveStoreContext: () => context(),
        getActiveStoreContext: () => context(),
      },
      operations: { run: async (_input, execute) => execute(test.operation as never) },
      resolveRuntime: () => ({
        storeId: context().storeId,
        browserProfileId: context().browserProfileId,
        capsule: capsuleFor(),
        automation: {} as never,
        canary: false,
        storeDisplayName: 'SHC001 主店',
        target: { marketplaceCode: 'US', storeId: context().storeId, storeName: 'SHC001' },
      }),
      persistence: {
        persistProgress() {},
        persistResult() { throw terminalCommitError; },
        persistImportState() {},
      },
      importResult: test.importResult,
      publishProgress(event) { test.published.push(event); },
      runCreateBatch: async (options) => resultFor(options),
    });

    await expect(coordinator.start(request())).rejects.toThrow(terminalCommitError.message);
    expect(test.published).toHaveLength(originalProgressCount);
    expect(test.importResult).not.toHaveBeenCalled();
  });

  it('rejects an importable completion when the manifest is missing', async () => {
    const test = harness();
    test.runCreateBatch.mockImplementationOnce(async (options) => {
      const result = resultFor(options);
      fs.rmSync(result.batch.manifestPath!, { force: true });
      return result;
    });

    await expect(test.coordinator.start(request()))
      .rejects.toThrow('LINGXING_COLLECTION_RESULT_MANIFEST_MISSING');
    expect(test.persistedResults).toHaveLength(0);
    expect(test.importResult).not.toHaveBeenCalled();
  });

  it('durably marks an import failure so the completed download can be recovered', async () => {
    const test = harness();
    test.importResult.mockRejectedValueOnce(new Error('parser rejected real report'));

    await expect(test.coordinator.start(request())).rejects.toThrow('parser rejected real report');

    expect(test.persistedResults[0].job.importState).toBe('pending');
    expect(test.persistedImportStates.map((job) => job.importState))
      .toEqual(['pending', 'failed']);
    expect(test.persistedImportStates.at(-1)).toEqual(expect.objectContaining({
      importState: 'failed',
      importError: 'parser rejected real report',
    }));
    expect(test.published.at(-1)?.job.importState).toBe('failed');
  });

  it('keeps the canary request namespace Main-owned', async () => {
    const test = harness();

    await expect(test.coordinator.start({
      ...request(),
      requestId: 'canary:spoofed-production-request',
    })).rejects.toThrow('LINGXING_COLLECTION_CANARY_REQUEST_ID_RESERVED');
    await expect(test.coordinator.start({
      ...request(),
      canary: true,
    })).rejects.toThrow('LINGXING_COLLECTION_CANARY_REQUEST_ID_REQUIRED');
    expect(test.runCreateBatch).not.toHaveBeenCalled();
  });

  it('normalizes omitted report types to the exact eight-report contract', () => {
    const normalized = normalizeCollectionRequest({
      ...request(),
      reportTypes: undefined,
    });
    expect(normalized.reportTypes).toHaveLength(8);
    expect(new Set(normalized.reportTypes).size).toBe(8);
    expect(normalized.storeContext).toEqual(context());
    expect(jobRequest()).toEqual(normalizeCollectionRequest(request()));
  });

  it('issues a root lineage only for a full eight-report job and preserves an authorized continuation', async () => {
    const fullHarness = harness();
    const full = await fullHarness.coordinator.start({ ...request(), reportTypes: undefined });
    expect(full.result.job.lineage).toEqual({
      lineageId: 'batch-1',
      rootJobId: 'batch-1',
      expectedReportTypes: normalizeCollectionRequest({ ...request(), reportTypes: undefined }).reportTypes,
      purpose: 'production_full',
    });

    const partialHarness = harness();
    const standalone = await partialHarness.coordinator.start(request());
    expect(standalone.result.job.lineage).toBeUndefined();

    const continuationHarness = harness();
    const continued = await continuationHarness.coordinator.start({
      ...request(),
      lineage: {
        lineageId: 'root-eight',
        rootJobId: 'root-eight',
        parentJobId: 'failed-eight',
        expectedReportTypes: normalizeCollectionRequest({ ...request(), reportTypes: undefined }).reportTypes,
        purpose: 'resume',
      },
    });
    expect(continued.result.job.lineage).toMatchObject({
      lineageId: 'root-eight',
      rootJobId: 'root-eight',
      parentJobId: 'failed-eight',
    });
  });

  it('persists continuation lineage on the first progress event before a runner crash', async () => {
    const test = harness();
    test.runCreateBatch.mockImplementationOnce(async (options) => {
      await options.progressSink(progressFor(options));
      throw new Error('simulated collector crash');
    });
    const lineage = {
      lineageId: 'root-eight',
      rootJobId: 'root-eight',
      parentJobId: 'failed-eight',
      expectedReportTypes: normalizeCollectionRequest({ ...request(), reportTypes: undefined }).reportTypes,
      purpose: 'resume' as const,
    };

    await expect(test.coordinator.start({
      ...request(),
      lineage,
    })).rejects.toThrow('simulated collector crash');

    expect(test.persistedProgress).toHaveLength(1);
    expect(test.persistedProgress[0].job.lineage).toEqual(lineage);
    expect(test.published[0].job.lineage).toEqual(lineage);
  });
});
