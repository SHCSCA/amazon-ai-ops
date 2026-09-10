import type Database from 'better-sqlite3';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const AI_SPEND_MIGRATION_VERSION = 20;
export const AI_SPEND_MIGRATION_NAME = 'ai-spend-governance-v20';
export const AI_SPEND_MIGRATION_CHECKSUM = 'ai-spend-governance-v20-20260908-01';
const schema = {
  ai_spend_policies: `CREATE TABLE ai_spend_policies (
    store_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
    PRIMARY KEY(store_id,revision), FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
  )`,
  ai_cost_records: `CREATE TABLE ai_cost_records (
    id TEXT PRIMARY KEY, store_id TEXT NOT NULL, policy_revision INTEGER, started_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('started','succeeded','failed','interrupted','blocked')),
    record_json TEXT NOT NULL CHECK(json_valid(record_json)),
    CHECK(json_extract(record_json,'$.id') IS id AND json_extract(record_json,'$.storeContext.storeId') IS store_id
      AND json_extract(record_json,'$.policyRevision') IS policy_revision AND json_extract(record_json,'$.status') IS status
      AND json_extract(record_json,'$.startedAt') IS started_at),
    FOREIGN KEY(store_id) REFERENCES stores(store_id) ON DELETE RESTRICT,
    FOREIGN KEY(store_id,policy_revision) REFERENCES ai_spend_policies(store_id,revision) ON DELETE RESTRICT
  )`,
  idx_ai_cost_store_started: 'CREATE INDEX idx_ai_cost_store_started ON ai_cost_records(store_id,started_at)',
  trg_ai_spend_update: `CREATE TRIGGER trg_ai_spend_update BEFORE UPDATE ON ai_spend_policies
    BEGIN SELECT RAISE(ABORT, 'AI spend policies are immutable'); END`,
  trg_ai_spend_delete: `CREATE TRIGGER trg_ai_spend_delete BEFORE DELETE ON ai_spend_policies
    BEGIN SELECT RAISE(ABORT, 'AI spend policies are immutable'); END`,
  trg_ai_cost_delete: `CREATE TRIGGER trg_ai_cost_delete BEFORE DELETE ON ai_cost_records
    BEGIN SELECT RAISE(ABORT, 'AI costs are retained'); END`,
  trg_ai_cost_finish: `CREATE TRIGGER trg_ai_cost_finish BEFORE UPDATE ON ai_cost_records
    WHEN OLD.status <> 'started' OR NEW.status NOT IN ('succeeded','failed','interrupted')
      OR NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id OR NEW.started_at <> OLD.started_at
      OR NEW.policy_revision IS NOT OLD.policy_revision
      OR json_extract(NEW.record_json,'$.storeContext') IS NOT json_extract(OLD.record_json,'$.storeContext')
      OR json_extract(NEW.record_json,'$.purpose') IS NOT json_extract(OLD.record_json,'$.purpose')
      OR json_extract(NEW.record_json,'$.providerBaseUrl') IS NOT json_extract(OLD.record_json,'$.providerBaseUrl')
      OR json_extract(NEW.record_json,'$.model') IS NOT json_extract(OLD.record_json,'$.model')
      OR json_extract(NEW.record_json,'$.automatic') IS NOT json_extract(OLD.record_json,'$.automatic')
      OR json_extract(NEW.record_json,'$.reservedMicrousd') IS NOT json_extract(OLD.record_json,'$.reservedMicrousd')
    BEGIN SELECT RAISE(ABORT, 'AI costs allow one terminal receipt without rebinding'); END`,
};

export function verifyAiSpendSchema(database: Database.Database): void {
  const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  for (const [name, expected] of Object.entries(schema)) {
    const row = database.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name) as { sql: string } | undefined;
    if (!row || normalized(row.sql) !== normalized(expected)) throw new Error(`AI spend schema mismatch: ${name}`);
  }
  for (const table of ['ai_spend_policies', 'ai_cost_records']) {
    if ((database.pragma(`foreign_key_check(${table})`) as unknown[]).length) throw new Error('AI spend foreign-key verification failed.');
  }
}

export function runAiSpendMigration(database: Database.Database, preparedBackup?: UpgradeBackupManifest): void {
  const version = AI_SPEND_MIGRATION_VERSION;
  const existing = database.prepare('SELECT status,checksum FROM schema_migrations WHERE version=?').get(version) as { status: string; checksum: string } | undefined;
  if (existing && existing.checksum !== AI_SPEND_MIGRATION_CHECKSUM) throw new Error('Migration 20 checksum mismatch.');
  if (existing?.status === 'applied') { verifyAiSpendSchema(database); return; }
  if ((database.prepare('SELECT status FROM schema_migrations WHERE version=19').get() as { status?: string })?.status !== 'applied') throw new Error('Migration 19 must precede AI spend governance.');
  const upgradeBackup = preparedBackup ?? prepareUpgradeBackup(database, { targetVersion: version, targetName: AI_SPEND_MIGRATION_NAME, targetChecksum: AI_SPEND_MIGRATION_CHECKSUM });
  database.prepare(`INSERT INTO schema_migrations(version,name,checksum,status,started_at,manifest_json) VALUES(?,?,?,'started',?,?)
    ON CONFLICT(version) DO UPDATE SET status='started',started_at=excluded.started_at,manifest_json=excluded.manifest_json,error_message=NULL`)
    .run(version, AI_SPEND_MIGRATION_NAME, AI_SPEND_MIGRATION_CHECKSUM, new Date().toISOString(), JSON.stringify({ version, upgradeBackup }));
  try {
    database.transaction(() => {
      for (const sql of Object.values(schema)) database.exec(sql);
      verifyAiSpendSchema(database);
      database.prepare(`UPDATE schema_migrations SET status='applied',applied_at=?,result_json=? WHERE version=?`)
        .run(new Date().toISOString(), JSON.stringify({ version, status: 'applied' }), version);
    }).immediate();
  } catch (error) {
    database.prepare(`UPDATE schema_migrations SET status='failed',error_message=? WHERE version=?`).run(error instanceof Error ? error.message : String(error), version);
    throw error;
  }
}
