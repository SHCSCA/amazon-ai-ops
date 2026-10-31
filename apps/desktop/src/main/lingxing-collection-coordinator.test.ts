import * as fs from 'fs';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import type {
  RunBatchOptions,
  RunBatchResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import {
  LingxingCollectionCoordinator,
  normalizeCollectionRequest,
} from './lingxing-collection-coordinator';
import {
  context,
  request,
  capsuleFor,
  jobRequest,
  fullEightResumeState,
  resultFor,
  progressFor,
  harness,
} from "./collection-coordinator.test-fixtures";

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
    expect(test.persistedImportStates[0].updatedAt)
      .toBe(test.persistedImportStates[0].importAttemptedAt);
    expect(test.persistedImportStates[1].updatedAt)
      .toBe(test.persistedImportStates[1].importCompletedAt);
    expect(test.importResult).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ importState: 'pending' }),
      }),
      {
        startedAt: test.persistedImportStates[0].importAttemptedAt,
        assertBeforeCommit: expect.any(Function),
      },
    );
    expect(output.result.job.importState).toBe('succeeded');
    expect(output.importSummary).toEqual({ inserted: 12 });
  });

it('rechecks the held authority at the import commit port after an asynchronous parse window', async () => {
    const test = harness();
    test.importResult.mockImplementationOnce(async (_result, options) => {
      expect(typeof options.assertBeforeCommit).toBe('function');
      options.assertBeforeCommit!();
      await Promise.resolve();
      test.active = context('store-one', 5);
      options.assertBeforeCommit!();
      return { inserted: 12 };
    });
    await expect(test.coordinator.start(request())).rejects.toThrow('stale authority');
    expect(test.persistedImportStates.map(job => job.importState)).toEqual(['pending', 'failed']);
    expect(test.importResult).toHaveBeenCalledTimes(1);
  });

it('keeps a standalone selected-report download out of the production exact-eight import chain', async () => {
    const test = harness({ productionImport: true });

    const output = await test.coordinator.start(request());

    expect(output.result.job).toEqual(expect.objectContaining({
      state: 'completed',
      importState: 'not_applicable',
    }));
    expect(output.result.job).not.toHaveProperty('lineage');
    expect(output.importSummary).toBeUndefined();
    expect(test.persistedResults).toHaveLength(1);
    expect(test.persistedResults[0].job.importState).toBe('not_applicable');
    expect(test.persistedImportStates).toHaveLength(0);
    expect(test.importResult).not.toHaveBeenCalled();
  });

it('rejects the legacy import port when no injected collector runner isolates it from production', () => {
    expect(() => harness({ omitInjectedRunner: true }))
      .toThrow('LINGXING_COLLECTION_LEGACY_IMPORT_PORT_FORBIDDEN');
  });

it('does not production-import an eight-report result with a failed report checkpoint', async () => {
    const test = harness({ productionImport: true });
    test.runCreateBatch.mockImplementationOnce(async (options) => {
      const result = resultFor(options);
      return { ...result, job: { ...result.job, state: 'completed_with_errors', reports: [
        { ...result.job.reports[0]!, state: 'failed', errorCode: 'LINGXING_COLLECTION_STEP_FAILED', detail: 'campaign report failed' },
        ...result.job.reports.slice(1),
      ] } };
    });

    const output = await test.coordinator.start({
      ...request(),
      reportTypes: undefined,
    });

    expect(output.result.job.importState).toBe('not_applicable');
    expect(output.importSummary).toBeUndefined();
    expect(test.importResult).not.toHaveBeenCalled();
  });

it('production-imports one exact eight-report root job with its Main-issued lineage', async () => {
    const test = harness({ productionImport: true });

    const output = await test.coordinator.start({
      ...request(),
      reportTypes: undefined,
    });

    expect(output.result.job).toEqual(expect.objectContaining({
      state: 'completed',
      importState: 'succeeded',
      lineage: {
        lineageId: 'batch-1',
        rootJobId: 'batch-1',
        expectedReportTypes: expect.arrayContaining([
          'campaign',
          'ad_group',
          'placement',
          'advertised_product',
          'auto_targeting',
          'keyword',
          'product_targeting',
          'user_search_term',
        ]),
        purpose: 'production_full',
      },
    }));
    expect(output.result.job.lineage?.expectedReportTypes).toHaveLength(8);
    expect(test.importResult).toHaveBeenCalledOnce();
    expect(test.importResult).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({
          state: 'completed',
          importState: 'pending',
          lineage: expect.objectContaining({
            lineageId: 'batch-1',
            rootJobId: 'batch-1',
            purpose: 'production_full',
          }),
        }),
      }),
      expect.objectContaining({ startedAt: expect.any(String) }),
    );
    expect(output.importSummary).toEqual({ inserted: 12 });
  });

it('strips a runner-forged lineage from a standalone partial production result', async () => {
    const test = harness({ productionImport: true });
    const expectedReportTypes = normalizeCollectionRequest({
      ...request(),
      reportTypes: undefined,
    }).reportTypes;
    test.runCreateBatch.mockImplementationOnce(async (options) => {
      const result = resultFor(options);
      result.job.lineage = {
        lineageId: 'forged-root-eight',
        rootJobId: 'forged-root-eight',
        parentJobId: 'forged-parent',
        expectedReportTypes,
        purpose: 'resume',
      };
      return result;
    });

    const output = await test.coordinator.start(request());

    expect(output.result.job.importState).toBe('not_applicable');
    expect(output.result.job).not.toHaveProperty('lineage');
    expect(test.importResult).not.toHaveBeenCalled();
  });

it('resumes the original full-eight job under the current execution generation and finalizes after import', async () => {
    const test = harness();
    const resumeFrom = fullEightResumeState();

    const output = await test.coordinator.resumeInPlace({
      currentStoreContext: context(),
      resumeFrom,
    });

    expect(test.runCreateBatch).toHaveBeenCalledWith(expect.objectContaining({
      requestId: resumeFrom.request.requestId,
      storeContext: resumeFrom.request.storeContext,
      executionStoreContext: context(),
      progressEventNamespace: 'attempt-coordinator-resume',
      rootDownloadDir: capsuleFor().downloadsDir,
      reportTypes: resumeFrom.request.reportTypes,
      resumeFrom,
    }));
    expect(output.result.job).toEqual(expect.objectContaining({
      jobId: resumeFrom.jobId,
      importState: 'succeeded',
    }));
    expect(output.result.batch.id).toBe(resumeFrom.batch.id);
    expect(output.importSummary).toEqual({ inserted: 12 });
    expect(test.resumeProgress.map((event) => event.job.importState ?? 'runner'))
      .toEqual(['runner', 'pending', 'succeeded']);
    expect(test.resumeFinalized).toEqual([
      expect.objectContaining({ outcome: 'succeeded' }),
    ]);
  });

it('resumes and production-imports the original exact-eight durable job through the strict port', async () => {
    const test = harness({ productionImport: true });
    const resumeFrom = fullEightResumeState();

    const output = await test.coordinator.resumeInPlace({
      currentStoreContext: context(),
      resumeFrom,
    });

    expect(output.result.job).toEqual(expect.objectContaining({
      jobId: resumeFrom.jobId,
      importState: 'succeeded',
    }));
    expect(output.result.job.request.reportTypes).toHaveLength(8);
    expect(test.importResult).toHaveBeenCalledOnce();
    expect(test.resumeFinalized).toEqual([
      expect.objectContaining({ outcome: 'succeeded' }),
    ]);
  });

it('identifies a pre-claim preflight rejection without acquiring a durable resume claim', async () => {
    const test = harness({
      preflight: async () => {
        throw new Error('download center diagnostic not ready');
      },
    });

    await expect(test.coordinator.resumeInPlace({
      currentStoreContext: context(),
      resumeFrom: fullEightResumeState(),
    })).rejects.toThrow(
      'LINGXING_COLLECTION_RESUME_PREFLIGHT_FAILED: '
      + '继续采集在下载中心安全预检阶段停止：download center diagnostic not ready',
    );
    expect(test.acquireCollectionResumeClaimForStore).not.toHaveBeenCalled();
  });

it('resolves a durably finalized import failure as a failed terminal result', async () => {
    const test = harness();
    test.importResult.mockRejectedValueOnce(new Error('resume parser rejected report'));

    const output = await test.coordinator.resumeInPlace({
      currentStoreContext: context(),
      resumeFrom: fullEightResumeState(),
    });

    expect(output.result.job).toEqual(expect.objectContaining({
      state: 'completed',
      importState: 'failed',
      importError: 'resume parser rejected report',
    }));
    expect(test.resumeFinalized).toEqual([
      expect.objectContaining({ outcome: 'failed' }),
    ]);
    expect(test.resumeInterrupt).not.toHaveBeenCalled();
  });

it('reconciles a finalize error against the already durable succeeded proof', async () => {
    const test = harness();
    test.resumeFinalize.mockRejectedValueOnce(new Error('simulated post-success finalize failure'));
    test.resumeInterrupt.mockImplementationOnce((_storeId, input) => (
      test.receiptFor(input.claim, 'succeeded')
    ));

    const output = await test.coordinator.resumeInPlace({
      currentStoreContext: context(),
      resumeFrom: fullEightResumeState(),
    });

    expect(output.result.job.importState).toBe('succeeded');
    expect(test.resumeFinalize).toHaveBeenCalledOnce();
    expect(test.resumeInterrupt).toHaveBeenCalledOnce();
    expect(test.resumeInterrupt.mock.results[0].value).toEqual(
      expect.objectContaining({ outcome: 'succeeded' }),
    );
  });

it('clears a volatile cancellation only after the cancelled terminal receipt is durable', async () => {
    const test = harness();
    test.cancelled = true;

    const output = await test.coordinator.resumeInPlace({
      currentStoreContext: context(),
      resumeFrom: fullEightResumeState(),
    });

    expect(output.result.job).toEqual(expect.objectContaining({
      state: 'cancelled',
      importState: 'not_applicable',
    }));
    expect(test.resumeFinalized).toEqual([
      expect.objectContaining({ outcome: 'failed' }),
    ]);
    expect(test.clearCancellation).toHaveBeenCalledWith({
      storeId: context().storeId,
      requestId: 'collect-resume-001',
      jobId: 'batch-1',
    });
    expect(test.importResult).not.toHaveBeenCalled();
  });

it('retains a volatile cancellation when the cancelled receipt is not durable', async () => {
    const test = harness();
    test.cancelled = true;
    test.resumeFinalize.mockRejectedValueOnce(new Error('cancel receipt unavailable'));

    await expect(test.coordinator.resumeInPlace({
      currentStoreContext: context(),
      resumeFrom: fullEightResumeState(),
    })).rejects.toThrow('cancel receipt unavailable');

    expect(test.clearCancellation).not.toHaveBeenCalled();
    expect(test.resumeInterrupt).toHaveBeenCalledOnce();
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
    expect(test.persistedImportStates.at(-1)?.importAttemptedAt)
      .toBe(test.persistedImportStates[0].importAttemptedAt);
    expect(test.persistedImportStates.at(-1)?.updatedAt)
      .toBe(test.persistedImportStates.at(-1)?.importCompletedAt);
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
