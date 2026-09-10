import type Database from 'better-sqlite3';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const GRANT_SLOT_LEDGER_MIGRATION_VERSION = 18;
export const GRANT_SLOT_LEDGER_MIGRATION_NAME = 'grant-slot-ledger-v18';
export const GRANT_SLOT_LEDGER_MIGRATION_CHECKSUM = 'grant-slot-ledger-v18-20260908-01';
const schema = {
  mission_grant_events: `CREATE TABLE mission_grant_events (
    id TEXT PRIMARY KEY, store_id TEXT NOT NULL, grant_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('issued','reserved','spent','invalidated','revoked','consumed','expired')),
    actor_id TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL,
    job_id TEXT, submit_intent_id TEXT, impact_cents INTEGER,
    CHECK ((event_type IN ('reserved','spent') AND job_id IS NOT NULL AND submit_intent_id IS NOT NULL AND impact_cents IS NOT NULL AND impact_cents > 0)
      OR (event_type NOT IN ('reserved','spent') AND job_id IS NULL AND submit_intent_id IS NULL AND impact_cents IS NULL)),
    UNIQUE(store_id,id), UNIQUE(store_id,grant_id,event_type,job_id),
    FOREIGN KEY(store_id,grant_id) REFERENCES mission_grants(store_id,id) ON DELETE RESTRICT,
    FOREIGN KEY(store_id,job_id) REFERENCES ad_execution_jobs(store_id,id) ON DELETE RESTRICT,
    FOREIGN KEY(store_id,submit_intent_id) REFERENCES ad_execution_jobs(store_id,submit_intent_id) ON DELETE RESTRICT
  )`,
  trg_mission_grant_events_append_only_update: `CREATE TRIGGER trg_mission_grant_events_append_only_update BEFORE UPDATE ON mission_grant_events
    BEGIN SELECT RAISE(ABORT, 'mission_grant_events is append-only'); END`,
  trg_mission_grant_events_append_only_delete: `CREATE TRIGGER trg_mission_grant_events_append_only_delete BEFORE DELETE ON mission_grant_events
    BEGIN SELECT RAISE(ABORT, 'mission_grant_events is append-only'); END`,
  trg_grant_slot_intent: `CREATE TRIGGER trg_grant_slot_intent BEFORE INSERT ON mission_grant_events
    WHEN NEW.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_execution_jobs job
      WHERE job.store_id=NEW.store_id AND job.id=NEW.job_id AND job.grant_id=NEW.grant_id
        AND job.submit_intent_id=NEW.submit_intent_id AND NEW.impact_cents=job.expected_bid_cents-job.target_bid_cents)
    BEGIN SELECT RAISE(ABORT, 'Grant slot must match its durable submit intent'); END`,
};

export function verifyGrantSlotLedgerSchema(database: Database.Database): void {
  const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  for (const [name, expected] of Object.entries(schema)) {
    const row = database.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(name) as { sql: string } | undefined;
    if (!row || normalized(row.sql) !== normalized(expected)) throw new Error(`Grant slot schema mismatch: ${name}`);
  }
  if ((database.pragma('foreign_key_check(mission_grant_events)') as unknown[]).length) throw new Error('Grant slot foreign-key verification failed.');
}

export function runGrantSlotLedgerMigration(database: Database.Database, preparedBackup?: UpgradeBackupManifest): void {
  const version = GRANT_SLOT_LEDGER_MIGRATION_VERSION;
  const existing = database.prepare('SELECT status,checksum FROM schema_migrations WHERE version=?').get(version) as { status: string; checksum: string } | undefined;
  if (existing && existing.checksum !== GRANT_SLOT_LEDGER_MIGRATION_CHECKSUM) throw new Error('Migration 18 checksum mismatch.');
  if (existing?.status === 'applied') { verifyGrantSlotLedgerSchema(database); return; }
  const prerequisite = database.prepare('SELECT status FROM schema_migrations WHERE version=17').get() as { status: string } | undefined;
  if (prerequisite?.status !== 'applied') throw new Error('Migration 17 must be applied before migration 18.');
  const upgradeBackup = preparedBackup ?? prepareUpgradeBackup(database, {
    targetVersion: version, targetName: GRANT_SLOT_LEDGER_MIGRATION_NAME, targetChecksum: GRANT_SLOT_LEDGER_MIGRATION_CHECKSUM,
  });
  database.prepare(`INSERT INTO schema_migrations(version,name,checksum,status,started_at,manifest_json) VALUES(?,?,?,'started',?,?)
    ON CONFLICT(version) DO UPDATE SET status='started',started_at=excluded.started_at,manifest_json=excluded.manifest_json,error_message=NULL`)
    .run(version, GRANT_SLOT_LEDGER_MIGRATION_NAME, GRANT_SLOT_LEDGER_MIGRATION_CHECKSUM, new Date().toISOString(), JSON.stringify({ version, upgradeBackup }));
  try {
    database.transaction(() => {
      database.exec('CREATE TEMP TABLE saved_grant_events AS SELECT id,store_id,grant_id,event_type,actor_id,reason,created_at FROM mission_grant_events; DROP TABLE mission_grant_events');
      database.exec(schema.mission_grant_events);
      database.exec('INSERT INTO mission_grant_events(id,store_id,grant_id,event_type,actor_id,reason,created_at) SELECT * FROM saved_grant_events; DROP TABLE saved_grant_events');
      for (const [name, sql] of Object.entries(schema)) if (name !== 'mission_grant_events') database.exec(sql);
      verifyGrantSlotLedgerSchema(database);
      database.prepare(`UPDATE schema_migrations SET status='applied',applied_at=?,result_json=? WHERE version=?`)
        .run(new Date().toISOString(), JSON.stringify({ version, status: 'applied' }), version);
    }).immediate();
  } catch (error) {
    database.prepare(`UPDATE schema_migrations SET status='failed',error_message=? WHERE version=?`).run(error instanceof Error ? error.message : String(error), version);
    throw error;
  }
}
