import type Database from 'better-sqlite3';
import type { LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import { stableJson } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-values';
import { normalizeCollectionJobSnapshot } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-validation';

export function withCollectionImportStateCas<T>(database: Database.Database,
  heldExpected: LingxingCollectionJobSnapshot, next: LingxingCollectionJobSnapshot, write: () => T): T {
  if (!heldExpected || next.jobId !== heldExpected.jobId
    || next.request.storeContext.storeId !== heldExpected.request.storeContext.storeId) throw new Error('COLLECTION_IMPORT_STATE_CAS_REQUIRED');
  const expected = normalizeCollectionJobSnapshot(structuredClone(heldExpected));
  // 状态结算和持有版本复核共用同连接事务，不追认等待期间的新任务状态。
  return database.transaction(() => {
    const row = database.prepare('SELECT snapshot_json AS snapshot FROM lingxing_collection_jobs WHERE store_id = ? AND job_id = ?')
      .get(expected.request.storeContext.storeId, expected.jobId) as { snapshot: string } | undefined;
    if (!row || stableJson(JSON.parse(row.snapshot)) !== stableJson(expected)) throw new Error('COLLECTION_IMPORT_STATE_CAS_CONFLICT');
    return write();
  }).immediate();
}
