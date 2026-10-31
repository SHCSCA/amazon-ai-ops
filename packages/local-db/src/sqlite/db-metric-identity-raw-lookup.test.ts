import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { initSqlite, SQLITE_MIGRATION_CONTRACT, SQLITE_SCHEMA_VERSION } from './db';
import { installStoreScopedMetricIdentitySafeguards } from './db-metric-identity';
import { collectionSnapshot, createHarness, importInput, metric } from './repositories/lingxing-import-test-fixture';
import { databases } from './repositories/lingxing-import-test-environment';
import { metricParams } from './repositories/lingxing-import-metrics';

const RAW = 'idx_ad_metrics_store_daily_report_raw_identity_lookup';
const EXPRESSIONS = 'idx_ad_metrics_store_daily_report_identity_lookup';
const UNIQUE = 'idx_ad_metrics_unique_store_daily_report_identity';
const COLUMNS = ['store_id', 'batch_id', 'report_type', 'date', 'asin', 'msku', 'campaign_name',
  'ad_group_name', 'targeting', 'search_term', 'match_type', 'source_file', 'source_row'];

function indexSql(database: Database.Database, name: string): string {
  return (database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?")
    .get(name) as { sql: string } | undefined)?.sql ?? '';
}

function assertRawIndex(database: Database.Database): void {
  const indexes = database.pragma('index_list(ad_daily_metrics)') as Array<{ name: string; unique: number; partial: number }>;
  expect(indexes.find(index => index.name === RAW)).toMatchObject({ name: RAW, unique: 0, partial: 0 });
  expect(indexes.find(index => index.name === EXPRESSIONS)).toMatchObject({ unique: 0, partial: 0 });
  expect(indexes.find(index => index.name === UNIQUE)).toMatchObject({ unique: 1, partial: 1 });
  const columns = database.pragma(`index_xinfo(${RAW})`) as Array<{ key: number; cid: number; name: string; coll: string }>;
  expect(columns.filter(column => column.key === 1).map(column => column.name)).toEqual(COLUMNS);
  expect(columns.filter(column => column.key === 1).every(column => column.cid >= 0 && column.coll === 'BINARY')).toBe(true);
  expect(indexSql(database, RAW)).not.toMatch(/\bUNIQUE\b|\bWHERE\b|COALESCE|NOCASE/i);
}

function harness() {
  const input = createHarness();
  const { database, repository, storeA, storeB } = input;
  database.prepare('UPDATE stores SET display_name=?').run('Shared Store');
  repository.saveCollectionSnapshotForStore(storeA, collectionSnapshot(storeA, 'Shared Store', 'batch-a'));
  repository.saveCollectionSnapshotForStore(storeB, collectionSnapshot(storeB, 'Shared Store', 'batch-b'));
  const prepare = vi.spyOn(database, 'prepare');
  let calls: string[] = [];
  try {
    repository.commitImportForStore(storeA, importInput('Shared Store', 'batch-a'));
    calls = prepare.mock.calls.map(([sql]) => sql);
  } finally { prepare.mockRestore(); }
  repository.commitImportForStore(storeB, importInput('Shared Store', 'batch-b'));
  const deletes = calls.filter(sql => /^\s*DELETE FROM ad_daily_metrics\s+WHERE store_id = @storeId/i.test(sql));
  expect(deletes).toHaveLength(1);
  const source = database.prepare('SELECT * FROM ad_daily_metrics WHERE store_id=?').get(storeA) as Record<string, unknown>;
  return { ...input, source, deleteSql: deletes[0], params: metricParams(storeA, metric('Shared Store', 'batch-a')) };
}

function clone(database: Database.Database, source: Record<string, unknown>, patch: Record<string, unknown> = {}): number {
  const columns = Object.keys(source).filter(column => column !== 'id');
  const result = database.prepare(`INSERT INTO ad_daily_metrics(${columns.join(',')})
    VALUES(${columns.map(column => '@' + column).join(',')})`).run({ ...source, ...patch });
  return Number(result.lastInsertRowid);
}

function quarantine(database: Database.Database, id: number, reason = 'identity_content_conflict', status = 'pending'): void {
  database.prepare(`INSERT INTO store_migration_quarantine(migration_version,source_table,source_row_id,
    reason,candidate_store_ids_json,source_identity_json,status,created_at,updated_at)
    VALUES(99,'ad_daily_metrics',@id,@reason,'[]','{}',@status,'2026-07-22T00:00:00.000Z','2026-07-22T00:00:00.000Z')`)
    .run({ id: String(id), reason, status });
}

function stableSnapshot(database: Database.Database) {
  return {
    metrics: database.prepare('SELECT * FROM ad_daily_metrics ORDER BY id').all(),
    quarantine: database.prepare('SELECT * FROM store_migration_quarantine ORDER BY id').all(),
    runs: database.prepare('SELECT * FROM report_import_runs ORDER BY store_id,run_id').all(),
    files: database.prepare('SELECT * FROM report_import_file_snapshots ORDER BY store_id,snapshot_id').all(),
    evidence: database.prepare('SELECT * FROM report_import_metric_evidence ORDER BY store_id,run_id').all(),
    reconciliations: database.prepare('SELECT * FROM report_import_reconciliations ORDER BY store_id,reconciliation_id').all(),
    migrations: database.prepare('SELECT * FROM schema_migrations ORDER BY version').all(),
    stores: database.prepare('SELECT * FROM stores ORDER BY store_id').all(),
    oldIndexes: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name<>? ORDER BY name").all(RAW),
    triggers: database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all(),
    userVersion: database.pragma('user_version', { simple: true }),
    integrity: database.pragma('integrity_check'), foreignKeys: database.pragma('foreign_key_check'),
  };
}

function conflictSelect(database: Database.Database): string {
  const sql = (database.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_ad_metrics_block_pending_identity_conflict_insert'")
    .get() as { sql: string }).sql;
  const section = sql.slice(0, sql.indexOf('BEGIN'));
  const match = section.match(/AND EXISTS \(\s*([\s\S]*)\)\s*$/);
  expect(match).not.toBeNull();
  // 参数替换只供独立 SELECT 的计划核验，不声称取得 INSERT 触发器 VM。
  return match![1].trim().replace(/NEW\.([a-z_]+)/g, '@new_$1');
}

function explain(database: Database.Database, sql: string, parameters: Record<string, unknown>): string {
  return (database.prepare('EXPLAIN QUERY PLAN ' + sql).all(parameters) as Array<{ detail: string }>).map(row => row.detail).join('\n');
}

describe('ad metric raw identity lookup index', () => {
  it('installs thirteen raw columns as a full non-unique index while preserving existing identity indexes', () => {
    const { database } = harness();
    // 记录驱动实际版本，避免把 Node 内置 SQLite 当作本库版本。
    const driver = database.prepare('SELECT sqlite_version() AS version').get() as { version: string };
    expect(driver.version).toMatch(/^\d+\.\d+\.\d+$/);
    console.info(JSON.stringify({ event: 'metric.raw_identity_driver_version', sqliteVersion: driver.version }));
    const before = stableSnapshot(database);
    expect(before.migrations).toEqual(SQLITE_MIGRATION_CONTRACT.map(migration =>
      expect.objectContaining({ ...migration, status: 'applied' })));
    expect((before.migrations.at(-1) as { version: number }).version).toBe(SQLITE_SCHEMA_VERSION);
    // 索引维护不能推进迁移或重写已应用账本。
    installStoreScopedMetricIdentitySafeguards(database);
    assertRawIndex(database);
    expect(stableSnapshot(database)).toEqual(before);
  });

  it('makes the unchanged trigger SELECT use all raw identity keys without changing the production DELETE plan', () => {
    const { database, source, deleteSql, params } = harness();
    const select = conflictSelect(database);
    const rawParams = Object.fromEntries(COLUMNS.map(column => ['new_' + column, source[column]]));
    database.exec(`DROP INDEX IF EXISTS ${RAW}`);
    const original = stableSnapshot(database);
    const before = explain(database, select, rawParams);
    const beforeDelete = explain(database, deleteSql, params);
    expect(before).toContain('USING INDEX idx_ad_daily_metrics_store_id (store_id=?)');
    installStoreScopedMetricIdentitySafeguards(database);
    const after = explain(database, select, rawParams);
    expect(after).toContain(`USING COVERING INDEX ${RAW}`);
    for (const column of COLUMNS) expect(after).toContain(`${column}=?`);
    expect(explain(database, deleteSql, params)).toBe(beforeDelete);
    expect(beforeDelete.match(/<expr>=\?/g)).toHaveLength(12);
    expect(stableSnapshot(database)).toEqual(original);
  });

  it.each(['missing', 'wrong-partial', 'wrong-unique'] as const)(
    'repairs %s definitions on the current schema and keeps full data evidence and triggers stable across two reopens', condition => {
      const { database, databasePath, source } = harness();
      const id = clone(database, source, { store_authority_quarantined: 1 });
      quarantine(database, id, 'ambiguous_store_identity');
      database.exec(`DROP INDEX IF EXISTS ${RAW}`);
      if (condition === 'wrong-partial') database.exec(`CREATE INDEX ${RAW} ON ad_daily_metrics(store_id) WHERE store_authority_quarantined=0`);
      if (condition === 'wrong-unique') database.exec(`CREATE UNIQUE INDEX ${RAW} ON ad_daily_metrics(id)`);
      const before = stableSnapshot(database);
      expect((before.migrations.at(-1) as { version: number }).version).toBe(SQLITE_SCHEMA_VERSION);
      database.close();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const reopened = initSqlite(databasePath);
        databases.push(reopened);
        try { assertRawIndex(reopened); expect(stableSnapshot(reopened)).toEqual(before); }
        finally { reopened.close(); }
      }
    },
  );

  it('allows duplicate quarantined rows and remains idempotent without removing or rewriting their evidence', () => {
    const { database, source } = harness();
    for (let index = 0; index < 2; index += 1) {
      const id = clone(database, source, { store_authority_quarantined: 1 });
      quarantine(database, id, 'ambiguous_store_identity');
    }
    const before = stableSnapshot(database);
    for (let index = 0; index < 2; index += 1) {
      installStoreScopedMetricIdentitySafeguards(database);
      assertRawIndex(database);
      expect(stableSnapshot(database)).toEqual(before);
    }
  });

  it.each([
    { name: 'raw NULL and NULL match', source: { campaign_name: null }, target: { campaign_name: null }, rejected: true },
    { name: 'raw NULL and empty string differ', source: { campaign_name: null }, target: { campaign_name: '' }, rejected: false },
    { name: 'raw source-row NULL and NULL match', source: { source_row: null }, target: { source_row: null }, rejected: true },
    { name: 'raw source-row NULL and minus one differ', source: { source_row: null }, target: { source_row: -1 }, rejected: false },
  ])('preserves direct INSERT trigger semantics when $name', input => {
    const outcomes: unknown[] = [];
    for (const indexed of [false, true]) {
      const { database, source } = harness();
      if (!indexed) database.exec(`DROP INDEX IF EXISTS ${RAW}`);
      const identity = { batch_id: null, source_file: 'raw-null-boundary.csv', ...input.source };
      const id = clone(database, source, { ...identity, store_authority_quarantined: 1 });
      quarantine(database, id);
      const attempt = () => clone(database, source, { ...identity, ...input.target });
      const before = stableSnapshot(database);
      if (input.rejected) { expect(attempt).toThrow(/pending ad metric identity conflict/); expect(stableSnapshot(database)).toEqual(before); }
      else expect(attempt()).toBeGreaterThan(0);
      outcomes.push({
        rows: database.prepare(`SELECT id,store_id,batch_id,source_file,campaign_name,source_row,
          store_authority_quarantined,cost FROM ad_daily_metrics ORDER BY id`).all(),
        quarantine: database.prepare('SELECT source_row_id,reason,status FROM store_migration_quarantine ORDER BY id').all(),
      });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  it('rejects direct pending INSERTs even when non-identity content differs and leaves all records intact', () => {
    const { database, source } = harness();
    const identity = { batch_id: null, source_file: 'raw-pending-conflict.csv' };
    const id = clone(database, source, { ...identity, store_authority_quarantined: 1 });
    quarantine(database, id);
    const before = stableSnapshot(database);
    expect(() => clone(database, source, { ...identity, cost: 99 })).toThrow(/pending ad metric identity conflict/);
    expect(stableSnapshot(database)).toEqual(before);
  });

  it('keeps resolved evidence under the existing unique constraint instead of mislabelling it as pending', () => {
    const { database, source } = harness();
    const identity = { batch_id: null, source_file: 'raw-resolved-conflict.csv' };
    const id = clone(database, source, identity);
    quarantine(database, id, 'identity_content_conflict', 'resolved');
    const before = stableSnapshot(database);
    expect(() => clone(database, source, identity)).toThrow(/UNIQUE constraint failed/);
    expect(stableSnapshot(database)).toEqual(before);
    installStoreScopedMetricIdentitySafeguards(database);
    expect(stableSnapshot(database)).toEqual(before);
  });

  it('preserves cross-store isolation and allows non-conflict pending reasons without changing quarantine records', () => {
    const { database, source, storeB } = harness();
    const identity = { batch_id: null, source_file: 'raw-other-store.csv' };
    const id = clone(database, source, { ...identity, store_authority_quarantined: 1 });
    quarantine(database, id);
    const quarantines = database.prepare('SELECT * FROM store_migration_quarantine ORDER BY id').all();
    expect(clone(database, source, { ...identity, store_id: storeB })).toBeGreaterThan(0);
    const otherIdentity = { batch_id: null, source_file: 'raw-other-reason.csv' };
    const other = clone(database, source, { ...otherIdentity, store_authority_quarantined: 1 });
    quarantine(database, other, 'ambiguous_store_identity');
    expect(clone(database, source, otherIdentity)).toBeGreaterThan(0);
    expect(database.prepare('SELECT * FROM store_migration_quarantine ORDER BY id').all()).toEqual([...quarantines,
      expect.objectContaining({ source_row_id: String(other), reason: 'ambiguous_store_identity', status: 'pending' })]);
    expect(database.pragma('foreign_key_check')).toEqual([]);
  });

  it('retains UPDATE conflict rejection and excludes the updated row itself without persisting an inconsistent marker', () => {
    const { database, source } = harness();
    const identity = { batch_id: null, source_file: 'raw-update-conflict.csv' };
    const id = clone(database, source, { ...identity, store_authority_quarantined: 1 });
    quarantine(database, id);
    const other = clone(database, source, { ...identity, campaign_name: 'another identity' });
    const before = stableSnapshot(database);
    expect(() => database.prepare('UPDATE ad_daily_metrics SET campaign_name=@campaign WHERE id=@id')
      .run({ campaign: source.campaign_name, id: other })).toThrow(/pending ad metric identity conflict/);
    expect(stableSnapshot(database)).toEqual(before);
    // 自排除只在本次事务中观察，随后恢复标记，不能冒充重开后的稳定状态。
    database.transaction(() => {
      expect(database.prepare('UPDATE ad_daily_metrics SET store_authority_quarantined=0 WHERE id=?').run(id).changes).toBe(1);
      database.prepare('UPDATE ad_daily_metrics SET store_authority_quarantined=1 WHERE id=?').run(id);
    }).immediate();
    expect(stableSnapshot(database)).toEqual(before);
  });
});
