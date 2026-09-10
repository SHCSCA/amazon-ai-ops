import type Database from 'better-sqlite3';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const MISSION_WRITE_AUTHORITY_MIGRATION_VERSION = 17;
export const MISSION_WRITE_AUTHORITY_MIGRATION_NAME = 'mission-write-authority-v17';
export const MISSION_WRITE_AUTHORITY_MIGRATION_CHECKSUM = 'mission-write-authority-v17-20260908-01';
const tables = ['analysis_action_batches', 'decisions', 'mission_grants'] as const;
const trigger = `CREATE TRIGGER trg_decision_write_authority_immutable
  BEFORE UPDATE OF authority_json ON decisions WHEN NEW.authority_json IS NOT OLD.authority_json
  BEGIN SELECT RAISE(ABORT, 'Decision write authority is immutable'); END`;

export function verifyMissionWriteAuthoritySchema(database: Database.Database): void {
  for (const table of tables) {
    const columns = database.pragma(`table_info(${table})`) as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>;
    const column = columns.find(item => item.name === 'authority_json');
    if (!column || column.type !== 'TEXT' || column.notnull !== 0 || column.dflt_value !== null) {
      throw new Error(`Mission write authority schema mismatch: ${table}`);
    }
    const definition = database.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(table) as { sql: string };
    if (!definition.sql.replace(/\s+/g, ' ').includes('authority_json TEXT CHECK (authority_json IS NULL OR json_valid(authority_json))')) {
      throw new Error(`Mission write authority JSON constraint mismatch: ${table}`);
    }
  }
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE name='trg_decision_write_authority_immutable'").get() as { sql: string } | undefined;
  const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  if (!row || normalized(row.sql) !== normalized(trigger)) throw new Error('Decision authority immutability trigger mismatch.');
}

export function runMissionWriteAuthorityMigration(database: Database.Database, preparedBackup?: UpgradeBackupManifest): void {
  const version = MISSION_WRITE_AUTHORITY_MIGRATION_VERSION;
  const existing = database.prepare('SELECT status,checksum FROM schema_migrations WHERE version=?').get(version) as { status: string; checksum: string } | undefined;
  if (existing && existing.checksum !== MISSION_WRITE_AUTHORITY_MIGRATION_CHECKSUM) throw new Error('Migration 17 checksum mismatch.');
  if (existing?.status === 'applied') { verifyMissionWriteAuthoritySchema(database); return; }
  const prerequisite = database.prepare('SELECT status FROM schema_migrations WHERE version=16').get() as { status: string } | undefined;
  if (prerequisite?.status !== 'applied') throw new Error('Migration 16 must be applied before migration 17.');
  const upgradeBackup = preparedBackup ?? prepareUpgradeBackup(database, {
    targetVersion: version, targetName: MISSION_WRITE_AUTHORITY_MIGRATION_NAME, targetChecksum: MISSION_WRITE_AUTHORITY_MIGRATION_CHECKSUM,
  });
  const startedAt = new Date().toISOString();
  database.prepare(`INSERT INTO schema_migrations(version,name,checksum,status,started_at,manifest_json)
    VALUES(?,?,?,'started',?,?) ON CONFLICT(version) DO UPDATE SET status='started',started_at=excluded.started_at,manifest_json=excluded.manifest_json,error_message=NULL`)
    .run(version, MISSION_WRITE_AUTHORITY_MIGRATION_NAME, MISSION_WRITE_AUTHORITY_MIGRATION_CHECKSUM, startedAt, JSON.stringify({ version, tables, upgradeBackup }));
  try {
    database.transaction(() => {
      // No default and no backfill: old approvals cannot acquire current identity or mode.
      for (const table of tables) database.exec(`ALTER TABLE ${table} ADD COLUMN authority_json TEXT CHECK (authority_json IS NULL OR json_valid(authority_json))`);
      database.exec(trigger);
      verifyMissionWriteAuthoritySchema(database);
      database.prepare(`UPDATE schema_migrations SET status='applied',applied_at=?,result_json=? WHERE version=?`)
        .run(new Date().toISOString(), JSON.stringify({ version, status: 'applied', alteredTables: tables }), version);
    }).immediate();
  } catch (error) {
    database.prepare(`UPDATE schema_migrations SET status='failed',error_message=? WHERE version=?`).run(error instanceof Error ? error.message : String(error), version);
    throw error;
  }
}
