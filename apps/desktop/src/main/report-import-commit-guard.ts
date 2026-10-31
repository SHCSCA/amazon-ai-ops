import type Database from 'better-sqlite3';
import { types as nativeTypes } from 'node:util';
import type { LingxingCollectionJobSnapshot, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { CollectionResumeClaim } from '@amazon-ai-ops/local-db';
import { stableJson, hashOpaqueClaimToken } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-values';
import { normalizeCollectionJobSnapshot } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-validation';

export type SynchronousImportCheck = () => void | boolean | StoreContextEnvelope;
const SYNCHRONOUS_FUNCTION_PROTOTYPE = Object.getPrototypeOf(function () {});
function assertNotAsync(operation: Function): void {
  // 仅接受本 Main realm 的普通同步端口；标签不提供信用，绑定异步与代理也不能绕过。
  if (typeof operation !== 'function' || nativeTypes.isAsyncFunction(operation) || nativeTypes.isProxy(operation)
    || Object.getPrototypeOf(operation) !== SYNCHRONOUS_FUNCTION_PROTOTYPE) throw new Error('REPORT_IMPORT_ASYNC_PORT_FORBIDDEN');
}

export function captureReportImportCommitGuard(input: {
  database: Database.Database; storeId: string; batchId: string; jobId?: string;
  assertAuthority: SynchronousImportCheck; assertConnection: SynchronousImportCheck; readSessionGeneration: () => string | null;
  expectedJob?: LingxingCollectionJobSnapshot; expectedClaim?: CollectionResumeClaim; readClaimProof?: () => string;
}) {
  const { database, storeId, batchId } = input;
  const jobId = input.jobId ?? batchId;
  const assertSync = (operation: () => unknown) => {
    assertNotAsync(operation);
    const value = operation();
    if (value === false) throw new Error('REPORT_IMPORT_AUTHORITY_REJECTED');
    if (value && typeof (value as PromiseLike<unknown>).then === 'function') throw new Error('REPORT_IMPORT_ASYNC_COMMIT_GUARD_FORBIDDEN');
  };
  // 只规范化调用者已持有的合同；数据库当前值仍逐字段比较，不追认新版本。
  const expectedJob = input.expectedJob && normalizeCollectionJobSnapshot(structuredClone(input.expectedJob));
  const expectedClaim = input.expectedClaim && structuredClone(input.expectedClaim);
  const assertExpected = () => {
    if (expectedJob) {
      const row = database.prepare('SELECT snapshot_json AS snapshot FROM lingxing_collection_jobs WHERE store_id = ? AND job_id = ?')
        .get(storeId, expectedJob.jobId) as { snapshot: string } | undefined;
      if (!row || stableJson(JSON.parse(row.snapshot)) !== stableJson(expectedJob)) throw new Error('REPORT_IMPORT_EXPECTED_JOB_CHANGED');
    }
    const claims = database.prepare('SELECT * FROM lingxing_collection_resume_active_claims WHERE store_id = ? AND job_id = ?').all(storeId, jobId) as Record<string, unknown>[];
    if (!expectedClaim) {
      if (claims.length) throw new Error('REPORT_IMPORT_RESUME_CLAIM_REQUIRED');
      return;
    }
    const row = claims[0];
    if (claims.length !== 1 || !row || expectedClaim.storeId !== storeId || expectedClaim.jobId !== jobId
      || row.attempt_id !== expectedClaim.attemptId || row.request_id !== expectedClaim.requestId
      || row.version !== expectedClaim.version || row.expected_job_updated_at !== expectedClaim.expectedJobUpdatedAt
      || row.expected_authority_proof_sha256 !== expectedClaim.expectedAuthorityProofSha256
      || row.claimed_at !== expectedClaim.claimedAt || row.claim_token_sha256 !== hashOpaqueClaimToken(expectedClaim.claimToken)
      || input.readClaimProof?.() !== expectedClaim.expectedAuthorityProofSha256) throw new Error('REPORT_IMPORT_EXPECTED_CLAIM_CHANGED');
  };
  const proof = () => JSON.stringify({
    store: database.prepare('SELECT * FROM stores WHERE store_id = ?').get(storeId),
    connections: database.prepare(`SELECT id, store_id, provider, account_label, external_account_id,
      normalized_external_account_id, collection_store_name, normalized_collection_store_name, created_at
      FROM store_connections WHERE store_id = ? ORDER BY provider, id`).all(storeId),
    batch: database.prepare('SELECT * FROM lingxing_report_batches WHERE store_id = ? AND id = ?').get(storeId, batchId),
    files: database.prepare('SELECT * FROM lingxing_report_files WHERE store_id = ? AND batch_id = ? ORDER BY id').all(storeId, batchId),
    jobs: database.prepare('SELECT * FROM lingxing_collection_jobs WHERE store_id = ? AND job_id = ?').all(storeId, jobId),
    claims: database.prepare(`SELECT claims.*, attempts.base_job_updated_at, attempts.base_authority_proof_sha256,
      attempts.durable_session_generation, attempts.execution_session_generation, attempts.execution_context_sha256
      FROM lingxing_collection_resume_active_claims AS claims
      JOIN lingxing_collection_resume_attempts AS attempts ON attempts.store_id = claims.store_id AND attempts.attempt_id = claims.attempt_id
      WHERE claims.store_id = ? AND claims.job_id = ? ORDER BY claims.attempt_id`).all(storeId, jobId),
    sessionGeneration: input.readSessionGeneration(),
  });
  assertSync(input.assertConnection); assertSync(input.assertAuthority); assertExpected();
  const expected = proof();
  function assertCurrent(): void {
    assertSync(input.assertConnection); assertSync(input.assertAuthority); assertExpected();
    if (proof() !== expected) throw new Error('REPORT_IMPORT_AUTHORITY_CHANGED');
  }
  function commit<T>(work: () => T & (T extends PromiseLike<unknown> ? never : unknown)): T {
    assertNotAsync(work);
    // 同一连接的外层 immediate 包含核验和原提交；原内部事务仅形成 savepoint。
    return database.transaction(() => {
      assertCurrent();
      const result = work();
      if (result && typeof (result as unknown as PromiseLike<unknown>).then === 'function') throw new Error('REPORT_IMPORT_ASYNC_TRANSACTION_FORBIDDEN');
      return result;
    }).immediate();
  }
  return { assertCurrent, commit };
}
