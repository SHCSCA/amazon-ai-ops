import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import { context, jobRequest } from './collection-coordinator.test-fixtures';
import { runtimeLogger } from './runtime-logger';
import { StoreCoordinatorError } from './store-coordinator';
import { initSqlite, LingxingImportRepository } from '@amazon-ai-ops/local-db';
import type Database from 'better-sqlite3';
import { withCollectionImportStateCas } from './collection-import-state-cas';
import { captureReportImportCommitGuard } from './report-import-commit-guard';

const databases: Database.Database[] = [];

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
  const database = initSqlite(':memory:'); databases.push(database);
  const scope = source.request.storeContext, now = source.updatedAt;
  database.prepare(`INSERT INTO stores (store_id, browser_profile_id, marketplace, currency, display_name,
    status, business_timezone, created_at, updated_at) VALUES (?, ?, 'US', 'USD', 'Synthetic CAS store', 'active', ?, ?, ?)`)
    .run(scope.storeId, scope.browserProfileId, scope.businessTimezone, now, now);
  database.prepare(`INSERT INTO lingxing_collection_jobs (store_id, job_id, request_id, browser_profile_id,
    marketplace, currency, business_timezone, business_date, session_generation, date_start, date_end, mode,
    report_types_json, state, snapshot_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(scope.storeId, source.jobId, source.request.requestId, scope.browserProfileId, scope.marketplace, scope.currency,
      scope.businessTimezone, scope.businessDate, scope.sessionGeneration, source.request.dateStart, source.request.dateEnd,
      source.request.mode, JSON.stringify(source.request.reportTypes), source.state, JSON.stringify(source), now, now);
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
  testState.current = { state: { db: database, lingxingImportRepo: repository, storeCoordinator: { assertActiveStoreContext: assertCurrent } },
    mainWindow: { webContents: { send } } };
  return { source, succeeded, sendError, send, assertCurrent, repository, database };
}
beforeEach(() => { testState.proof.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); for (const database of databases.splice(0)) if (database.open) database.close(); });

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

  it('preserves committed CAS recovery success while logging its window publication failure', async () => {
    const test = harness(); const log = vi.spyOn(runtimeLogger, 'warn').mockImplementation(() => {});
    const result = await recoverCompletedLingxingCollectionImport(test.source, context());
    expect(testState.proof).toHaveBeenCalledTimes(1);
    expect(test.repository.completeRecoveredCollectionImportForStore).toHaveBeenCalledTimes(1);
    expect(result.job).toBe(test.succeeded); expect(result.importRecovered).toBe(true);
    expect(log).toHaveBeenCalledWith('collection.progress_publication_failed',
      expect.objectContaining({ phase: 'import_recovered', error: test.sendError }));
  });

  it('does not mask a rejected CAS completion or publish after its failure', async () => {
    const test = harness(); const original = new Error('CAS_STALE');
    test.repository.completeRecoveredCollectionImportForStore.mockImplementation(() => { throw original; });
    await expect(recoverCompletedLingxingCollectionImport(test.source, context())).rejects.toThrow(original);
    expect(test.send).not.toHaveBeenCalled();
  });
});

describe('导入状态结算的真实 SQLite 版本保护', () => {
  function normalizedFixture() {
    const f = harness(), held = { ...f.source, detail: '已下载 G:\\isolated\\campaign.xlsx',
      reports: f.source.reports.map(report => ({ ...report, detail: '来自 G:\\isolated\\campaign.xlsx' })) };
    f.database.prepare('DELETE FROM lingxing_collection_jobs').run();
    const persisted = new LingxingImportRepository(f.database).upsertCollectionJobSnapshotForStore(held.request.storeContext.storeId, held);
    expect(persisted.detail).not.toContain('G:\\isolated');
    expect(persisted).not.toEqual(held);
    const guard = () => captureReportImportCommitGuard({ database: f.database, storeId: held.request.storeContext.storeId,
      batchId: held.jobId, expectedJob: held, assertAuthority: () => {}, assertConnection: () => {}, readSessionGeneration: () => '4' });
    return { ...f, held, persisted, guard };
  }
  it.each(['settlement', 'commit'] as const)('真实仓库脱敏后的正常持有快照仍能通过 %s 精确版本门', port => {
    const f = normalizedFixture(), write = vi.fn(() => f.database.inTransaction);
    const result = port === 'settlement' ? withCollectionImportStateCas(f.database, f.held, f.held, write) : f.guard().commit(write);
    expect(result).toBe(true); expect(write).toHaveBeenCalledTimes(1);
  });
  it.each(['updatedAt', 'session', 'request', 'unexpected-field'] as const)('规范化持有合同仍拒绝数据库的 %s 并发变化，不能追认新 baseline', field => {
    const f = normalizedFixture(), changed: any = structuredClone(f.persisted), write = vi.fn();
    if (field === 'updatedAt') changed.updatedAt = '2026-07-22T08:00:00.001Z';
    if (field === 'session') changed.request.storeContext.sessionGeneration++;
    if (field === 'request') changed.request.requestId += '-rotated';
    if (field === 'unexpected-field') changed.unexpectedAuthority = true;
    f.database.prepare('UPDATE lingxing_collection_jobs SET snapshot_json = ?').run(JSON.stringify(changed));
    expect(() => withCollectionImportStateCas(f.database, f.held, f.held, write)).toThrow('COLLECTION_IMPORT_STATE_CAS_CONFLICT');
    expect(() => f.guard().commit(write)).toThrow('REPORT_IMPORT_EXPECTED_JOB_CHANGED');
    expect(write).not.toHaveBeenCalled();
  });
  it('在同连接 immediate 事务内复核持有版本后写入，回执不引入异步窗口', () => {
    const f = harness(), next = { ...f.source, importState: 'failed' as const };
    const persisted = withCollectionImportStateCas(f.database, f.source, next, () => {
      expect(f.database.inTransaction).toBe(true);
      return f.database.prepare('UPDATE lingxing_collection_jobs SET snapshot_json = ?').run(JSON.stringify(next)).changes;
    });
    expect(persisted).toBe(1);
    expect(f.database.inTransaction).toBe(false);
    expect(JSON.parse((f.database.prepare('SELECT snapshot_json FROM lingxing_collection_jobs').get() as any).snapshot_json)).toEqual(next);
  });
  it('拒绝等待期间已经变化的完整 job 快照，完成与失败结算均不写入', () => {
    const f = harness(), current = { ...f.source, importError: 'newer held owner' };
    f.database.prepare('UPDATE lingxing_collection_jobs SET snapshot_json = ?').run(JSON.stringify(current));
    const write = vi.fn();
    for (const importState of ['succeeded', 'failed'] as const) {
      expect(() => withCollectionImportStateCas(f.database, f.source, { ...f.source, importState }, write)).toThrow('COLLECTION_IMPORT_STATE_CAS_CONFLICT');
    }
    expect(write).not.toHaveBeenCalled();
    expect(JSON.parse((f.database.prepare('SELECT snapshot_json FROM lingxing_collection_jobs').get() as any).snapshot_json)).toEqual(current);
  });
  it('状态写入出错时回滚同一事务里的全部变更并保留真实错误', () => {
    const f = harness(), next = { ...f.source, importState: 'failed' as const }, original = new Error('SYNTHETIC_SETTLEMENT_FAILURE');
    expect(() => withCollectionImportStateCas(f.database, f.source, next, () => {
      f.database.prepare('UPDATE lingxing_collection_jobs SET snapshot_json = ?').run(JSON.stringify(next));
      throw original;
    })).toThrow(original);
    expect(JSON.parse((f.database.prepare('SELECT snapshot_json FROM lingxing_collection_jobs').get() as any).snapshot_json)).toEqual(f.source);
  });
});
