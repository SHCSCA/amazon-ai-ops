import type Database from 'better-sqlite3';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const EXECUTION_RECONCILIATION_MIGRATION_VERSION = 16;
export const EXECUTION_RECONCILIATION_MIGRATION_NAME = 'execution-reconciliation-v16';
export const EXECUTION_RECONCILIATION_MIGRATION_CHECKSUM = 'execution-reconciliation-v16-20260908-01';

// Two physical slots, one case per original intent. No third observation column or retry row.
const schema = {
  ad_execution_reconciliation_cases: `CREATE TABLE ad_execution_reconciliation_cases (
    case_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    submit_intent_id TEXT NOT NULL,
    context_json TEXT NOT NULL CHECK (json_valid(context_json)),
    started_at TEXT NOT NULL,
    first_json TEXT CHECK (first_json IS NULL OR json_valid(first_json)),
    reload_json TEXT CHECK (reload_json IS NULL OR json_valid(reload_json)),
    outcome TEXT CHECK (outcome IN ('target_stably_observed', 'original_stably_observed', 'other_value_stably_observed', 'inconclusive_permanent')),
    completed_at TEXT,
    CHECK ((outcome IS NULL AND completed_at IS NULL) OR (outcome IS NOT NULL AND completed_at IS NOT NULL)),
    CHECK (reload_json IS NULL OR first_json IS NOT NULL),
    CHECK (outcome IS NULL OR outcome = 'inconclusive_permanent' OR (first_json IS NOT NULL AND reload_json IS NOT NULL)),
    UNIQUE(store_id, submit_intent_id),
    UNIQUE(store_id, job_id),
    FOREIGN KEY(store_id, batch_id) REFERENCES ad_execution_batches(store_id, id),
    FOREIGN KEY(store_id, job_id) REFERENCES ad_execution_jobs(store_id, id),
    FOREIGN KEY(store_id, submit_intent_id) REFERENCES ad_execution_jobs(store_id, submit_intent_id)
  )`,
  trg_execution_reconciliation_insert: `CREATE TRIGGER trg_execution_reconciliation_insert
    BEFORE INSERT ON ad_execution_reconciliation_cases
    WHEN NEW.first_json IS NOT NULL OR NEW.reload_json IS NOT NULL OR NEW.outcome IS NOT NULL
      OR NOT EXISTS (SELECT 1 FROM ad_execution_jobs j JOIN ad_execution_batches b ON b.id = j.batch_id AND b.store_id = j.store_id
        WHERE j.id = NEW.job_id AND j.store_id = NEW.store_id AND j.batch_id = NEW.batch_id
          AND j.submit_intent_id = NEW.submit_intent_id AND j.status = 'unknown' AND b.status = 'unknown')
    BEGIN SELECT RAISE(ABORT, 'reconciliation requires an UNKNOWN intent and two empty slots'); END`,
  trg_execution_reconciliation_update: `CREATE TRIGGER trg_execution_reconciliation_update
    BEFORE UPDATE ON ad_execution_reconciliation_cases
    WHEN OLD.outcome IS NOT NULL
      OR NEW.case_id IS NOT OLD.case_id OR NEW.store_id IS NOT OLD.store_id
      OR NEW.batch_id IS NOT OLD.batch_id OR NEW.job_id IS NOT OLD.job_id
      OR NEW.submit_intent_id IS NOT OLD.submit_intent_id OR NEW.context_json IS NOT OLD.context_json
      OR NEW.started_at IS NOT OLD.started_at
      OR (OLD.first_json IS NOT NULL AND NEW.first_json IS NOT OLD.first_json)
      OR (OLD.reload_json IS NOT NULL AND NEW.reload_json IS NOT OLD.reload_json)
    BEGIN SELECT RAISE(ABORT, 'reconciliation lineage, observations and terminal outcome are immutable'); END`,
  trg_execution_reconciliation_delete: `CREATE TRIGGER trg_execution_reconciliation_delete
    BEFORE DELETE ON ad_execution_reconciliation_cases
    BEGIN SELECT RAISE(ABORT, 'reconciliation history cannot be deleted'); END`,
};

export function verifyExecutionReconciliationSchema(database: Database.Database): void {
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '');
  for (const [name, expected] of Object.entries(schema)) {
    const row = database.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as { sql: string } | undefined;
    if (!row || normalize(row.sql) !== normalize(expected)) throw new Error(`Execution reconciliation schema mismatch: ${name}`);
  }
  if ((database.pragma('foreign_key_check(ad_execution_reconciliation_cases)') as unknown[]).length) {
    throw new Error('Execution reconciliation foreign-key verification failed.');
  }
}

export function runExecutionReconciliationMigration(database: Database.Database, preparedBackup?: UpgradeBackupManifest): void {
  const version = EXECUTION_RECONCILIATION_MIGRATION_VERSION;
  const existing = database.prepare('SELECT status, checksum FROM schema_migrations WHERE version=?').get(version) as { status: string; checksum: string } | undefined;
  if (existing && existing.checksum !== EXECUTION_RECONCILIATION_MIGRATION_CHECKSUM) throw new Error('Migration 16 checksum mismatch.');
  if (existing?.status === 'applied') { verifyExecutionReconciliationSchema(database); return; }
  const prerequisite = database.prepare('SELECT status FROM schema_migrations WHERE version=15').get() as { status: string } | undefined;
  if (prerequisite?.status !== 'applied') throw new Error('Migration 15 must be applied before migration 16.');
  const upgradeBackup = preparedBackup ?? prepareUpgradeBackup(database, {
    targetVersion: version, targetName: EXECUTION_RECONCILIATION_MIGRATION_NAME, targetChecksum: EXECUTION_RECONCILIATION_MIGRATION_CHECKSUM,
  });
  const startedAt = new Date().toISOString();
  database.prepare(`INSERT INTO schema_migrations(version,name,checksum,status,started_at,manifest_json)
    VALUES(?,?,?,'started',?,?) ON CONFLICT(version) DO UPDATE SET status='started',started_at=excluded.started_at,manifest_json=excluded.manifest_json,error_message=NULL`)
    .run(version, EXECUTION_RECONCILIATION_MIGRATION_NAME, EXECUTION_RECONCILIATION_MIGRATION_CHECKSUM, startedAt,
      JSON.stringify({ version, tables: ['ad_execution_reconciliation_cases'], upgradeBackup }));
  try {
    database.transaction(() => {
      for (const sql of Object.values(schema)) database.exec(sql);
      verifyExecutionReconciliationSchema(database);
      database.prepare(`UPDATE schema_migrations SET status='applied',applied_at=?,result_json=? WHERE version=?`)
        .run(new Date().toISOString(), JSON.stringify({ version, status: 'applied', createdTables: 1 }), version);
    }).immediate();
  } catch (error) {
    database.prepare(`UPDATE schema_migrations SET status='failed',error_message=? WHERE version=?`).run(error instanceof Error ? error.message : String(error), version);
    throw error;
  }
}
