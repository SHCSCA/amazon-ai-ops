import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import { context, jobRequest } from './collection-coordinator.test-fixtures';
import { runtimeLogger } from './runtime-logger';
import { StoreCoordinatorError } from './store-coordinator';

const testState = vi.hoisted(() => ({ current: {} as Record<string, unknown>, proof: vi.fn() }));
vi.mock('./main-runtime-access', () => ({ getMainRuntimeContext: () => testState.current }));
vi.mock('./main-artifacts-runtime', () => ({ rendererPayload: (value: unknown) => value }));
vi.mock('./main-local-report-import-runtime', () => ({ importStoreScopedLingxingDownloadedReportMetrics: vi.fn() }));
vi.mock('./lingxing-report-import', () => ({ invalidLingxingImportReconciliationEvidence: (value: string) => new Error(value) }));
vi.mock('./store-collection-orchestrator-scheduler-adapter', () => ({
  assertStoreCollectionCommittedImportProofForRecovery: testState.proof,
}));

import { persistLingxingCollectionImportState, recoverCompletedLingxingCollectionImport } from './main-collection-import-recovery-runtime';

function job(): LingxingCollectionJobSnapshot {
  const now = '2026-07-22T08:00:00.000Z';
  return { jobId: 'batch-1', request: jobRequest(), state: 'completed', importState: 'pending',
    importAttemptedAt: now, createdAt: now, completedAt: now, updatedAt: now,
    reports: jobRequest().reportTypes.map(reportType => ({ reportType, state: 'downloaded',
      attemptIndex: 0, autoRetryCount: 0, updatedAt: now })),
  };
}
function harness() {
  const source = job(); const succeeded = { ...source, importState: 'succeeded' };
  const sendError = new Error('WebContents was destroyed');
  const send = vi.fn(() => { throw sendError; });
  const assertCurrent = vi.fn(() => context());
  const run = { runId: 'import_batch-1', createdAt: source.updatedAt, metricRowCount: 8, sourceFileCount: 8 };
  const repository = {
    upsertCollectionProgressForStore: vi.fn((_storeId, event) => event.job),
    getCollectionSnapshotForStore: vi.fn(() => ({ job: source })),
    getImportRunForStore: vi.fn(() => run),
    readUniqueCollectionAuthorityProofForStoreByRequestId: vi.fn(() => ({ durable: true })),
    completeRecoveredCollectionImportForStore: vi.fn(() => succeeded),
  };
  testState.proof.mockReturnValue({ run, casToken: { proof: 'current-cas' }, runCompletedAt: source.updatedAt });
  testState.current = { state: { lingxingImportRepo: repository, storeCoordinator: { assertActiveStoreContext: assertCurrent } },
    mainWindow: { webContents: { send } } };
  return { source, succeeded, sendError, send, assertCurrent, repository };
}
beforeEach(() => { testState.proof.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('collection import recovery publication logging', () => {
  it('retains the persisted recovery state and logs the actual valid-context window error', () => {
    const test = harness(); const log = vi.spyOn(runtimeLogger, 'warn').mockImplementation(() => {});
    const persisted = persistLingxingCollectionImportState(test.source, 'failed', { error: 'original import failure' });
    expect(persisted.importState).toBe('failed'); expect(persisted.importError).toBe('original import failure');
    expect(test.repository.upsertCollectionProgressForStore).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('collection.progress_publication_failed',
      expect.objectContaining({ phase: 'import_recovery', error: test.sendError }));
  });

  it('keeps expected stale-context publication suppression quiet after a durable recovery write', () => {
    const test = harness(); const log = vi.spyOn(runtimeLogger, 'warn').mockImplementation(() => {});
    test.assertCurrent.mockImplementation(() => { throw new StoreCoordinatorError('STALE_STORE_CONTEXT', 'generation changed'); });
    expect(persistLingxingCollectionImportState(test.source, 'failed').importState).toBe('failed');
    expect(test.send).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled();
  });

  it('does not replace a recovery persistence error with a publication error', () => {
    const test = harness(); const original = new Error('SQLITE_FULL');
    test.repository.upsertCollectionProgressForStore.mockImplementation(() => { throw original; });
    expect(() => persistLingxingCollectionImportState(test.source, 'failed')).toThrow(original);
    expect(test.send).not.toHaveBeenCalled();
  });

  it('preserves committed CAS recovery success while logging its window publication failure', () => {
    const test = harness(); const log = vi.spyOn(runtimeLogger, 'warn').mockImplementation(() => {});
    const result = recoverCompletedLingxingCollectionImport(test.source, context());
    expect(testState.proof).toHaveBeenCalledTimes(1);
    expect(test.repository.completeRecoveredCollectionImportForStore).toHaveBeenCalledTimes(1);
    expect(result.job).toBe(test.succeeded); expect(result.importRecovered).toBe(true);
    expect(log).toHaveBeenCalledWith('collection.progress_publication_failed',
      expect.objectContaining({ phase: 'import_recovered', error: test.sendError }));
  });

  it('does not mask a rejected CAS completion or publish after its failure', () => {
    const test = harness(); const original = new Error('CAS_STALE');
    test.repository.completeRecoveredCollectionImportForStore.mockImplementation(() => { throw original; });
    expect(() => recoverCompletedLingxingCollectionImport(test.source, context())).toThrow(original);
    expect(test.send).not.toHaveBeenCalled();
  });
});
