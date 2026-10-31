import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { initSqlite, type CollectionResumeClaim } from '@amazon-ai-ops/local-db';
import { normalizeStoreContextEnvelope, type LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import { hashOpaqueClaimToken } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-values';
import { captureReportImportCommitGuard } from './report-import-commit-guard';

const databases: Database.Database[] = [];
const NOW = '2026-01-02T12:00:00.000Z';
afterEach(() => { for (const database of databases.splice(0)) if (database.open) database.close(); });

function synchronousTypeContract(guard: ReturnType<typeof captureReportImportCommitGuard>) {
  // @ts-expect-error 生产提交端口不能接受异步结果。
  guard.commit(async () => 1);
  // @ts-expect-error 授权断言不能使用允许异步返回的 void 回调特例。
  const authority: Parameters<typeof captureReportImportCommitGuard>[0]['assertAuthority'] = async () => {};
  void authority;
}
void synchronousTypeContract;

function fixture() {
  // 使用实际迁移初始化内存数据库，不打开正式数据或构造简化业务表。
  const database = initSqlite(':memory:');
  databases.push(database);
  const context = normalizeStoreContextEnvelope({ storeId: 'guard-store', browserProfileId: 'guard-profile',
    marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-01-02', sessionGeneration: 4 });
  database.prepare(`INSERT INTO stores (store_id, browser_profile_id, marketplace, currency, display_name,
    status, business_timezone, created_at, updated_at)
    VALUES (?, ?, 'US', 'USD', 'Synthetic store', 'active', 'America/Los_Angeles', ?, ?)`).run(context.storeId, context.browserProfileId, NOW, NOW);
  database.prepare(`INSERT INTO store_connections (id, store_id, provider, status, external_account_id,
    normalized_external_account_id, created_at, updated_at)
    VALUES ('guard-connection', ?, 'amazon_ads', 'ready', 'guard-account', 'guard-account', ?, ?)`).run(context.storeId, NOW, NOW);
  database.prepare(`INSERT INTO lingxing_report_batches (id, date_start, date_end, store_name, marketplace_code,
    status, download_dir, created_at, completed_at, store_id, request_id, browser_profile_id, business_date, session_generation)
    VALUES ('guard-batch', '2026-01-02', '2026-01-02', 'Synthetic store', 'US', 'completed',
    'isolated-download', ?, ?, ?, 'guard-request', ?, '2026-01-02', 4)`).run(NOW, NOW, context.storeId, context.browserProfileId);
  database.prepare(`INSERT INTO lingxing_report_files (id, batch_id, report_type, display_name, status,
    file_path, file_size_bytes, created_at, updated_at, store_id)
    VALUES ('guard-file', 'guard-batch', 'campaign', 'Synthetic report', 'downloaded',
    'isolated-file.csv', 100, ?, ?, ?)`).run(NOW, NOW, context.storeId);
  const job: LingxingCollectionJobSnapshot = { jobId: 'guard-job', request: { requestId: 'guard-request', storeContext: context,
    dateStart: '2026-01-02', dateEnd: '2026-01-02', mode: 'download-existing', reportTypes: ['campaign'] },
    state: 'completed', reports: [], createdAt: NOW, updatedAt: NOW, importState: 'pending', importAttemptedAt: NOW };
  database.prepare(`INSERT INTO lingxing_collection_jobs (store_id, job_id, request_id, browser_profile_id,
    marketplace, currency, business_timezone, business_date, session_generation, date_start, date_end, mode,
    report_types_json, state, snapshot_json, created_at, updated_at)
    VALUES (?, 'guard-job', 'guard-request', ?, 'US', 'USD', 'America/Los_Angeles', '2026-01-02', 4,
    '2026-01-02', '2026-01-02', 'download-existing', '["campaign"]', 'completed', ?, ?, ?)`).run(
      context.storeId, context.browserProfileId, JSON.stringify(job), NOW, NOW);
  database.exec('CREATE TABLE isolated_guard_writes (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
  let generation = '4', authorized = true, connected = true, proof = 'a'.repeat(64);
  const checks: boolean[] = [];
  const input = { database, storeId: context.storeId, batchId: 'guard-batch', jobId: job.jobId, expectedJob: job,
    readSessionGeneration: () => generation,
    assertAuthority: () => { checks.push(database.inTransaction); if (!authorized) throw new Error('AUTHORITY_REVOKED'); },
    assertConnection: () => { if (!connected) throw new Error('CONNECTION_REPLACED'); } };
  const write = () => database.prepare("INSERT INTO isolated_guard_writes VALUES ('result', 'committed')").run().changes;
  const count = () => (database.prepare('SELECT COUNT(*) AS total FROM isolated_guard_writes').get() as { total: number }).total;
  function claim(): CollectionResumeClaim {
    const held: CollectionResumeClaim = { storeId: context.storeId, jobId: job.jobId, requestId: job.request.requestId,
      attemptId: 'guard-attempt', claimToken: 'isolated-claim-token', expectedJobUpdatedAt: NOW,
      expectedAuthorityProofSha256: proof, version: 1, claimedAt: NOW };
    database.prepare(`INSERT INTO lingxing_collection_resume_attempts (store_id, attempt_id, job_id, request_id,
      base_job_updated_at, base_authority_proof_sha256, durable_session_generation, execution_session_generation,
      execution_context_sha256, claimed_at) VALUES (?, ?, ?, ?, ?, ?, 4, 4, ?, ?)`).run(
        held.storeId, held.attemptId, held.jobId, held.requestId, NOW, proof, 'b'.repeat(64), NOW);
    database.prepare(`INSERT INTO lingxing_collection_resume_active_claims (store_id, job_id, request_id, attempt_id,
      claim_token_sha256, expected_job_updated_at, expected_authority_proof_sha256, version, claimed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(held.storeId, held.jobId, held.requestId, held.attemptId,
        hashOpaqueClaimToken(held.claimToken), NOW, proof, NOW, NOW);
    return held;
  }
  return { database, input, checks, job, write, count, claim, readClaimProof: () => proof,
    revoke: () => { authorized = false; }, replace: () => { connected = false; },
    advance: () => { generation = '6'; }, changeProof: () => { proof = 'c'.repeat(64); } };
}

describe('报表提交的真实 SQLite 同事务复核', () => {
  it('在同连接 immediate 事务内复核后执行原 savepoint 提交', () => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input);
    expect(f.checks).toEqual([false]);
    const result = guard.commit(() => f.database.transaction(() => {
      expect(f.database.inTransaction).toBe(true);
      expect(f.checks).toEqual([false, true]);
      return f.write();
    }).immediate());
    expect(result).toBe(1);
    expect(f.count()).toBe(1);
    expect(f.database.inTransaction).toBe(false);
  });

  it.each(['authority', 'connection', 'session', 'store', 'provider', 'batch', 'file', 'job'] as const)(
    '等待解析期间 %s 变化会在首写前拒绝', async change => {
      const f = fixture(), guard = captureReportImportCommitGuard(f.input), write = vi.fn(f.write);
      await Promise.resolve();
      if (change === 'authority') f.revoke();
      if (change === 'connection') f.replace();
      if (change === 'session') f.advance();
      if (change === 'store') f.database.prepare("UPDATE stores SET status = 'inactive'").run();
      if (change === 'provider') f.database.prepare("UPDATE store_connections SET account_label = 'changed'").run();
      if (change === 'batch') f.database.prepare("UPDATE lingxing_report_batches SET status = 'completed_with_errors'").run();
      if (change === 'file') f.database.prepare('UPDATE lingxing_report_files SET file_size_bytes = 101').run();
      if (change === 'job') f.database.prepare("UPDATE lingxing_collection_jobs SET snapshot_json = '{}'").run();
      expect(() => guard.commit(write)).toThrow();
      expect(write).not.toHaveBeenCalled();
      expect(f.count()).toBe(0);
      expect(f.database.inTransaction).toBe(false);
    });

  it('去重提前返回之前同样必须重新验证会话', () => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input), deduplicate = vi.fn(() => ({ deduplicated: true }));
    f.advance();
    expect(() => guard.commit(deduplicate)).toThrow();
    expect(deduplicate).not.toHaveBeenCalled();
  });

  it('原嵌套事务写入后抛错仍由外层回滚全部写入', () => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input), first = new Error('isolated commit failed');
    expect(() => guard.commit(() => {
      f.database.transaction(f.write).immediate();
      throw first;
    })).toThrow(first);
    expect(f.count()).toBe(0);
    expect(f.database.inTransaction).toBe(false);
  });

  it('禁止在事务内返回 Promise，已经执行的同步写入也回滚', () => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input);
    const unsafe = () => { f.write(); return Promise.resolve('untrusted async work'); };
    expect(() => guard.commit(unsafe as unknown as () => never))
      .toThrow('REPORT_IMPORT_ASYNC_TRANSACTION_FORBIDDEN');
    expect(f.count()).toBe(0);
    expect(f.database.inTransaction).toBe(false);
  });

  it('调用之前拒绝 async work，避免回滚后微任务继续写入', async () => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input);
    let invoked = false;
    const work = async () => { invoked = true; await Promise.resolve(); f.write(); };
    expect(() => guard.commit(work as unknown as () => never)).toThrow('REPORT_IMPORT_ASYNC_PORT_FORBIDDEN');
    await Promise.resolve();
    expect(invoked).toBe(false);
    expect(f.count()).toBe(0);
  });

  it.each([
    ['async', false], ['async', true], ['async-generator', false], ['async-generator', true],
  ] as const)('%s bound=%s 伪装普通函数标签也不能进入提交', async (kind, bound) => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input);
    let invoked = false;
    const target: () => unknown = kind === 'async'
      ? async () => { invoked = true; await Promise.resolve(); f.write(); }
      : async function* () { invoked = true; f.write(); yield 1; };
    const work = bound ? target.bind(undefined) : target;
    Object.defineProperty(work, Symbol.toStringTag, { value: 'Function' });
    expect(() => guard.commit(work as unknown as () => never)).toThrow('REPORT_IMPORT_ASYNC_PORT_FORBIDDEN');
    await Promise.resolve();
    expect(invoked).toBe(false);
    expect(f.count()).toBe(0);
  });

  it('普通同步 bound 函数不因可伪装标签而误拒', () => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input);
    const work = (() => f.write()).bind(undefined);
    Object.defineProperty(work, Symbol.toStringTag, { value: 'AsyncFunction' });
    expect(guard.commit(work)).toBe(1);
    expect(f.count()).toBe(1);
  });

  it('不接受无法审计的 Proxy 提交端口', () => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input);
    let invoked = false;
    const work = new Proxy(() => { invoked = true; return f.write(); }, {});
    expect(() => guard.commit(work)).toThrow('REPORT_IMPORT_ASYNC_PORT_FORBIDDEN');
    expect(invoked).toBe(false);
    expect(f.count()).toBe(0);
  });

  it.each(['generator', 'exotic-prototype'] as const)('不接收 %s 提交端口', kind => {
    const f = fixture(), guard = captureReportImportCommitGuard(f.input);
    const work: () => unknown = kind === 'generator'
      ? function* () { f.write(); yield 1; }
      : Object.setPrototypeOf(() => f.write(), null);
    expect(() => guard.commit(work as unknown as () => never)).toThrow('REPORT_IMPORT_ASYNC_PORT_FORBIDDEN');
    expect(f.count()).toBe(0);
  });

  it.each(['assertAuthority', 'assertConnection'] as const)('捕获时拒绝异步 %s 端口', key => {
    const f = fixture();
    expect(() => captureReportImportCommitGuard({ ...f.input, [key]: () => Promise.resolve() }))
      .toThrow('REPORT_IMPORT_ASYNC_COMMIT_GUARD_FORBIDDEN');
    expect(f.count()).toBe(0);
  });

  it.each(['assertAuthority', 'assertConnection'] as const)('捕获时 %s 返回 false 不能视为准入', key => {
    const f = fixture();
    expect(() => captureReportImportCommitGuard({ ...f.input, [key]: () => false })).toThrow();
    expect(f.count()).toBe(0);
  });

  it('等待期间布尔授权端口撤销时不调用提交', async () => {
    const f = fixture();
    let allowed = true;
    const guard = captureReportImportCommitGuard({ ...f.input, assertAuthority: () => allowed });
    await Promise.resolve(); allowed = false;
    const write = vi.fn(f.write);
    expect(() => guard.commit(write)).toThrow();
    expect(write).not.toHaveBeenCalled();
    expect(f.count()).toBe(0);
  });

  it('不允许把捕获之前已变化的任务当作新基线', () => {
    const f = fixture();
    f.database.prepare("UPDATE lingxing_collection_jobs SET snapshot_json = '{}'").run();
    expect(() => captureReportImportCommitGuard(f.input)).toThrow('REPORT_IMPORT_EXPECTED_JOB_CHANGED');
    expect(f.count()).toBe(0);
  });

  it('未持有令牌的导入不能借用已有恢复 claim', () => {
    const f = fixture(); f.claim();
    expect(() => captureReportImportCommitGuard(f.input)).toThrow('REPORT_IMPORT_RESUME_CLAIM_REQUIRED');
    expect(f.count()).toBe(0);
  });

  it('同一精确 claim 和 proof 可以提交，调用方令牌不被变更', () => {
    const f = fixture(), held = f.claim(), before = structuredClone(held);
    const guard = captureReportImportCommitGuard({ ...f.input, expectedClaim: held, readClaimProof: f.readClaimProof });
    expect(guard.commit(f.write)).toBe(1);
    expect(held).toEqual(before);
    expect(f.count()).toBe(1);
  });

  it.each(['version', 'token', 'proof', 'removed'] as const)('解析期间恢复 claim %s 变化不会写入', async change => {
    const f = fixture(), held = f.claim();
    const guard = captureReportImportCommitGuard({ ...f.input, expectedClaim: held, readClaimProof: f.readClaimProof });
    await Promise.resolve();
    if (change === 'version') f.database.prepare('UPDATE lingxing_collection_resume_active_claims SET version = 2').run();
    if (change === 'token') f.database.prepare('UPDATE lingxing_collection_resume_active_claims SET claim_token_sha256 = ?').run('d'.repeat(64));
    if (change === 'proof') f.changeProof();
    if (change === 'removed') f.database.prepare('DELETE FROM lingxing_collection_resume_active_claims').run();
    const write = vi.fn(f.write);
    expect(() => guard.commit(write)).toThrow('REPORT_IMPORT_EXPECTED_CLAIM_CHANGED');
    expect(write).not.toHaveBeenCalled();
    expect(f.count()).toBe(0);
  });

  it('不能通过同步篡改传入快照来追认等待期间的新任务与新 claim', () => {
    const f = fixture(), held = f.claim();
    const guard = captureReportImportCommitGuard({ ...f.input, expectedClaim: held, readClaimProof: f.readClaimProof });
    held.version = 2;
    f.job.detail = 'changed caller object';
    f.database.prepare('UPDATE lingxing_collection_resume_active_claims SET version = 2').run();
    f.database.prepare('UPDATE lingxing_collection_jobs SET snapshot_json = ?').run(JSON.stringify(f.job));
    expect(() => guard.commit(f.write)).toThrow();
    expect(f.count()).toBe(0);
  });
});
