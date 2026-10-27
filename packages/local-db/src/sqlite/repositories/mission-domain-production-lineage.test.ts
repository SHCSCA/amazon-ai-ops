import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MissionDomainRepository } from './mission-domain-repo';
import { NOW, seedExactEightImportedBatch, seedSucceededProductionFullCollectionRoot } from './mission-domain-repo.test-data';
import  {
  databases,
  createHarness,
  seedEnabledPolicy,
  expectRepositoryError,
} from './mission-domain-repo.test-harness';
describe("MissionDomainRepository mission lineage and grants", () => {
it('rejects a completed local exact-eight batch without a durable production collection root', () => {
    const { database, repository, contextOne } = createHarness();
    const batchId = 'batch_local_202608280002';
    const runId = 'local-full8-import-run';
    const reportTypes = [
      'campaign',
      'ad_group',
      'placement',
      'advertised_product',
      'auto_targeting',
      'keyword',
      'product_targeting',
      'user_search_term',
    ] as const;
    database.prepare(`
      INSERT INTO lingxing_report_batches (
        id, date_start, date_end, store_name, marketplace_code, status,
        download_dir, created_at, completed_at, store_id, request_id,
        browser_profile_id, business_date, session_generation
      ) VALUES (?, '2026-07-21', '2026-07-21', 'US Store One', 'US', 'completed',
        'logical-download:local-full8', ?, ?, ?, ?, ?, '2026-07-21', 4)
    `).run(batchId, NOW, NOW, contextOne.storeId, `local-import:${batchId}`, contextOne.browserProfileId);
    database.prepare(`
      INSERT INTO report_import_runs (
        store_id, run_id, idempotency_key, input_fingerprint, batch_id, status,
        source_file_count, metric_row_count, reconciliation_count,
        started_at, completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'completed', 8, 8, 8, ?, ?, ?)
    `).run(
      contextOne.storeId,
      runId,
      `local-full8:${batchId}`,
      'd'.repeat(64),
      batchId,
      NOW,
      NOW,
      NOW,
    );
    for (const [index, reportType] of reportTypes.entries()) {
      const filePath = `C:/reports/local-full8/${reportType}.xlsx`;
      const fileHash = String(index + 1).repeat(64).slice(0, 64);
      const fileId = Number(database.prepare(`
        INSERT INTO report_files (
          store_id, batch_id, report_type, file_path, file_name, file_size,
          status, imported_rows, file_hash, last_imported_at
        ) VALUES (?, ?, ?, ?, ?, 1024, 'imported', 1, ?, ?)
      `).run(
        contextOne.storeId,
        batchId,
        reportType,
        filePath,
        `${reportType}.xlsx`,
        fileHash,
        NOW,
      ).lastInsertRowid);
      database.prepare(`
        INSERT INTO report_import_file_snapshots (
          store_id, snapshot_id, run_id, batch_id, report_file_id, report_type,
          file_path, file_name, file_size_bytes, file_hash, imported_rows, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1024, ?, 1, ?)
      `).run(
        contextOne.storeId,
        `local-full8-snapshot-${reportType}`,
        runId,
        batchId,
        fileId,
        reportType,
        filePath,
        `${reportType}.xlsx`,
        fileHash,
        NOW,
      );
    }
    const { version } = seedEnabledPolicy(repository, contextOne);

    expect(() => repository.createMission(contextOne, {
      id: 'mission-local-full8-without-root',
      dataBatchId: batchId,
      policyVersionId: version.id,
      title: 'Must not trust a local synthetic batch',
      objective: 'Prove formal collection lineage before analysis.',
      priority: 'P1',
      productId: `${contextOne.storeId}-product-1`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Formal collection lineage is present'],
      guardrails: ['Local files never replace production collection'],
      actorId: 'operator',
    })).toThrow(
      '运营任务数据批次缺少已成功入库的 production_full 完整 8 类采集根证据；'
      + '请先启动完整 8 类采集并等待入库成功。',
    );
    expect(repository.listMissions(contextOne)).toEqual([]);
  });

it('accepts an exact-eight batch only after its durable production root import succeeds', () => {
    const { database, repository, contextOne } = createHarness();
    const batchId = 'batch-production-full8-ready';
    const requestId = 'lx:production-full8-ready';
    seedExactEightImportedBatch(database, contextOne, { batchId, requestId });
    seedSucceededProductionFullCollectionRoot(database, contextOne, { batchId, requestId });
    const { version } = seedEnabledPolicy(repository, contextOne);

    const mission = repository.createMission(contextOne, {
      id: 'mission-production-full8-ready',
      dataBatchId: batchId,
      policyVersionId: version.id,
      title: 'Use the durable production collection root',
      objective: 'Analyze only the exact imported production batch.',
      priority: 'P1',
      productId: `${contextOne.storeId}-product-1`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Formal collection lineage remains current'],
      guardrails: ['Reject local or pending substitutes'],
      actorId: 'operator',
    });

    expect(mission).toMatchObject({ dataBatchId: batchId, status: 'draft', phase: 'fact' });
  });

it('revalidates Mission authority after a concurrent policy change before the create commit', () => {
    const { database, databasePath, repository, contextOne } = createHarness();
    const { version } = seedEnabledPolicy(repository, contextOne);
    const competing = new Database(databasePath);
    databases.push(competing);
    let retireBeforeCommit = true;
    const raceRepository = new MissionDomainRepository(database, {
      now: () => {
        if (retireBeforeCommit) {
          retireBeforeCommit = false;
          competing.prepare(`
            UPDATE policy_versions
            SET status = 'retired', updated_at = ?
            WHERE store_id = ? AND id = ?
          `).run('2026-07-22T12:00:00.001Z', contextOne.storeId, version.id);
        }
        return new Date(NOW);
      },
      references: {
        productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
        adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
        adEntitySupportsKeywordBid: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
      },
    });
    const missionId = 'mission-concurrent-policy-retirement';

    expectRepositoryError(() => raceRepository.createMission(contextOne, {
      id: missionId,
      dataBatchId: `batch-${contextOne.storeId}`,
      policyVersionId: version.id,
      title: 'Reject a stale Mission authority snapshot',
      objective: 'Do not bind a Mission to a policy version retired before commit.',
      priority: 'P1',
      productId: `${contextOne.storeId}-product-1`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['No stale Mission is created'],
      guardrails: ['Policy authority remains active'],
      actorId: 'operator',
    }), 'STATE_CONFLICT');

    expect(repository.getMission(contextOne, missionId)).toBeUndefined();
  });
});
