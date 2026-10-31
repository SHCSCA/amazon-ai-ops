import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { initSqlite, SQLITE_MIGRATION_CONTRACT, SQLITE_SCHEMA_VERSION } from './db';
import { installStoreScopedMetricIdentitySafeguards } from './db-metric-identity';
import { hashCanonicalMetrics, readCanonicalMetrics } from './migrations/0010-collection-resume-authority';
import { collectionSnapshot, createHarness, importInput, metric } from './repositories/lingxing-import-test-fixture';
import { databases } from './repositories/lingxing-import-test-environment';
import { metricParams } from './repositories/lingxing-import-metrics';

const LOOKUP_INDEX = 'idx_ad_metrics_store_daily_report_identity_lookup';
const UNIQUE_INDEX = 'idx_ad_metrics_unique_store_daily_report_identity';

function indexSql(database: Database.Database, name: string): string {
  return (database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(name) as { sql: string } | undefined)?.sql ?? '';
}

function identityExpressions(sql: string): string {
  return sql.replace(/\s+/g, '').match(/ONad_daily_metrics\((.*)\)(?:WHERE.*)?$/i)?.[1] ?? '';
}

function expectLookupIndex(database: Database.Database): void {
  const indexes = database.pragma('index_list(ad_daily_metrics)') as Array<{
    name: string; unique: number; partial: number;
  }>;
  expect(indexes.find(index => index.name === LOOKUP_INDEX))
    .toMatchObject({ name: LOOKUP_INDEX, unique: 0, partial: 0 });
  expect(indexes.find(index => index.name === UNIQUE_INDEX))
    .toMatchObject({ name: UNIQUE_INDEX, unique: 1, partial: 1 });
  const expressions = identityExpressions(indexSql(database, LOOKUP_INDEX));
  expect(expressions).not.toBe('');
  expect(expressions).toBe(identityExpressions(indexSql(database, UNIQUE_INDEX)));
  const columns = database.pragma(`index_xinfo(${LOOKUP_INDEX})`) as Array<{ key: number }>;
  expect(columns.filter(column => column.key === 1)).toHaveLength(13);
  expect(indexSql(database, LOOKUP_INDEX)).not.toMatch(/\bWHERE\b|\bUNIQUE\b/i);
}

function importedHarness() {
  const harness = createHarness();
  const { database, repository, storeA, storeB } = harness;
  database.prepare('UPDATE stores SET display_name = ?').run('Shared Store');
  repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shared Store', 'batch-a'));
  repository.saveCollectionSnapshotForStore(storeB, collectionSnapshot(storeB, 'Shared Store', 'batch-b'));
  const source = metric('Shared Store', 'batch-a');
  const prepare = vi.spyOn(database, 'prepare');
  let calls: string[] = [];
  try {
    repository.commitImportForStore(storeA, importInput('Shared Store', 'batch-a'));
    calls = prepare.mock.calls.map(([sql]) => sql);
  } finally {
    prepare.mockRestore();
  }
  const deletes = calls.filter(sql => /^\s*DELETE FROM ad_daily_metrics\s+WHERE store_id = @storeId/i.test(sql));
  expect(deletes).toHaveLength(1);
  const deleteSql = deletes[0];
  expect(deleteSql).not.toMatch(/store_authority_quarantined|INDEXED BY/i);
  repository.commitImportForStore(storeB, importInput('Shared Store', 'batch-b'));
  return { ...harness, source, deleteSql, params: metricParams(storeA, source) };
}

function cloneMetric(database: Database.Database, sourceId: number, overrides: Record<string, unknown>): number {
  const source = database.prepare('SELECT * FROM ad_daily_metrics WHERE id = ?')
    .get(sourceId) as Record<string, unknown>;
  const columns = Object.keys(source).filter(column => column !== 'id');
  const row = { ...source, ...overrides };
  const result = database.prepare(`
    INSERT INTO ad_daily_metrics (${columns.join(', ')})
    VALUES (${columns.map(column => `@${column}`).join(', ')})
  `).run(row);
  return Number(result.lastInsertRowid);
}

function quarantineClone(database: Database.Database, sourceId: number, overrides: Record<string, unknown> = {}): number {
  const id = cloneMetric(database, sourceId, { ...overrides, store_authority_quarantined: 1 });
  database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      candidate_store_ids_json, source_identity_json, status, created_at, updated_at
    ) VALUES (99, 'ad_daily_metrics', ?, 'ambiguous_store_identity', '[]', '{}',
      'pending', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z')
  `).run(String(id));
  return id;
}

function snapshot(database: Database.Database) {
  const scoped = database.prepare(`
    SELECT DISTINCT store_id AS storeId, batch_id AS batchId
    FROM ad_daily_metrics ORDER BY store_id, batch_id
  `).all() as Array<{ storeId: string; batchId: string }>;
  return {
    metrics: database.prepare('SELECT * FROM ad_daily_metrics ORDER BY id').all(),
    canonical: scoped.map(({ storeId, batchId }) => ({
      storeId, batchId,
      rowCount: readCanonicalMetrics(database, storeId, batchId).length,
      sha256: hashCanonicalMetrics(readCanonicalMetrics(database, storeId, batchId)),
    })),
    quarantine: database.prepare('SELECT * FROM store_migration_quarantine ORDER BY id').all(),
    importEvidence: database.prepare('SELECT * FROM report_import_metric_evidence ORDER BY store_id, run_id').all(),
    importRuns: database.prepare('SELECT * FROM report_import_runs ORDER BY store_id, run_id').all(),
    importSnapshots: database.prepare('SELECT * FROM report_import_file_snapshots ORDER BY store_id, snapshot_id').all(),
    ledger: database.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
    storeRows: database.prepare('SELECT * FROM stores ORDER BY store_id').all(),
    triggers: database.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all(),
    userVersion: database.pragma('user_version', { simple: true }),
    foreignKeys: database.pragma('foreign_key_check'),
    integrity: database.pragma('integrity_check'),
  };
}

function explain(database: Database.Database, sql: string, params: Record<string, unknown>): string {
  return (database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params) as Array<{ detail: string }>)
    .map(row => row.detail).join('\n');
}

describe('ad metric full identity lookup index', () => {
  it('installs a non-unique non-partial lookup with the existing thirteen identity expressions', () => {
    const { database } = importedHarness();
    const before = snapshot(database);
    expect(before.ledger).toEqual(SQLITE_MIGRATION_CONTRACT.map(migration =>
      expect.objectContaining({ ...migration, status: 'applied' })));
    expect((before.ledger.at(-1) as { version: number }).version).toBe(SQLITE_SCHEMA_VERSION);
    // 索引维护不能推进迁移或重写已应用账本。
    installStoreScopedMetricIdentitySafeguards(database);
    expectLookupIndex(database);
    expect(snapshot(database)).toEqual(before);
  });

  it('changes the actual production DELETE plan from a store prefix to all thirteen identity fields', () => {
    const { database, deleteSql, params } = importedHarness();
    database.exec(`DROP INDEX IF EXISTS ${LOOKUP_INDEX}`);
    database.exec('DROP INDEX IF EXISTS idx_ad_metrics_store_daily_report_raw_identity_lookup');
    const beforePlan = explain(database, deleteSql, params);
    expect(beforePlan).toContain('USING INDEX idx_ad_daily_metrics_store_id (store_id=?)');
    expect(beforePlan).not.toContain('<expr>=?');
    const before = snapshot(database);
    installStoreScopedMetricIdentitySafeguards(database);
    const afterPlan = explain(database, deleteSql, params);
    expect(afterPlan).toContain(`USING INDEX ${LOOKUP_INDEX} (store_id=?`);
    expect(afterPlan.match(/<expr>=\?/g)).toHaveLength(12);
    expect(snapshot(database)).toEqual(before);
    expectLookupIndex(database);
  });

  it.each(['missing', 'wrong-definition'] as const)(
    'repairs a %s lookup on an existing current-schema database and remains idempotent after repeated reopen',
    condition => {
      const { database, databasePath } = importedHarness();
      const row = database.prepare('SELECT id FROM ad_daily_metrics WHERE store_id = ?')
        .get('store-a') as { id: number };
      quarantineClone(database, row.id);
      database.exec(`DROP INDEX IF EXISTS ${LOOKUP_INDEX}`);
      if (condition === 'wrong-definition') {
        database.exec(`CREATE INDEX ${LOOKUP_INDEX} ON ad_daily_metrics(store_id) WHERE store_authority_quarantined = 0`);
      }
      const before = snapshot(database);
      expect((before.ledger[before.ledger.length - 1] as { version: number }).version).toBe(SQLITE_SCHEMA_VERSION);
      database.close();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reopened = initSqlite(databasePath);
        databases.push(reopened);
        try {
          expectLookupIndex(reopened);
          expect(snapshot(reopened)).toEqual(before);
          expect(reopened.pragma('foreign_key_check')).toEqual([]);
          expect(reopened.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
        } finally {
          reopened.close();
        }
      }
    },
  );

  it('keeps the original DELETE scope across store IDs, match types, source rows and store-bound quarantine', () => {
    const outcomes: unknown[] = [];
    for (const indexed of [false, true]) {
      const { database, storeA, storeB, deleteSql, params } = importedHarness();
      const original = database.prepare('SELECT id FROM ad_daily_metrics WHERE store_id = ?')
        .get(storeA) as { id: number };
      const quarantinedMatch = quarantineClone(database, original.id);
      const crossStore = (database.prepare('SELECT id FROM ad_daily_metrics WHERE store_id = ?')
        .get(storeB) as { id: number }).id;
      const differentMatch = cloneMetric(database, original.id, { match_type: 'phrase' });
      const differentRow = cloneMetric(database, original.id, { source_row: 3 });
      const unrelatedQuarantine = quarantineClone(database, original.id, { search_term: 'unrelated quarantine' });
      const beforeInstall = snapshot(database);
      installStoreScopedMetricIdentitySafeguards(database);
      expect(snapshot(database)).toEqual(beforeInstall);
      if (!indexed) database.exec(`DROP INDEX IF EXISTS ${LOOKUP_INDEX}`);
      const quarantineBefore = database.prepare('SELECT * FROM store_migration_quarantine ORDER BY id').all();
      const result = database.prepare(deleteSql).run(params);
      expect(result.changes).toBe(2);
      const survivors = (database.prepare('SELECT id FROM ad_daily_metrics ORDER BY id').all() as Array<{ id: number }>)
        .map(row => row.id);
      expect(survivors).not.toContain(original.id);
      expect(survivors).not.toContain(quarantinedMatch);
      expect(survivors).toEqual(expect.arrayContaining([crossStore, differentMatch, differentRow, unrelatedQuarantine]));
      expect(database.prepare('SELECT * FROM store_migration_quarantine ORDER BY id').all()).toEqual(quarantineBefore);
      expect(database.pragma('foreign_key_check')).toEqual([]);
      expect(database.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
      const after = snapshot(database);
      outcomes.push({
        canonical: after.canonical,
        identityRows: database.prepare(`
          SELECT id, store_id, batch_id, match_type, source_row, search_term,
                 store_authority_quarantined
          FROM ad_daily_metrics ORDER BY id
        `).all(),
        quarantine: after.quarantine,
        foreignKeys: after.foreignKeys,
        integrity: after.integrity,
      });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
  });
});
