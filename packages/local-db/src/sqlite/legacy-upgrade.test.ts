import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSqlite } from './db';
import {
  ANALYSIS_RUNS_TABLES, V16_DOMAIN_TABLES, POLICY_AUTHORITY_TABLES,
  EXECUTION_AUTHORITY_TABLES,
  COLLECTION_RESUME_AUTHORITY_TABLES,
  prepareUpgradeBackup,
  AI_SPEND_MIGRATION_CHECKSUM, AI_SPEND_MIGRATION_NAME, AI_SPEND_MIGRATION_VERSION,
  runLegacyCompatibilityMigration,
  LEGACY_COMPATIBILITY_MIGRATION_CHECKSUM,
  LEGACY_COMPATIBILITY_MIGRATION_NAME,
  LEGACY_COMPATIBILITY_MIGRATION_VERSION,
  STORE_PROVIDER_IDENTITY_UNIQUE_INDEX,
  type UpgradeBackupManifest,
} from './migrations';
import { StoreRepository } from './repositories/store-repo';

const tempDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('representative legacy database upgrade to migration 20', () => {
  it('classifies every source record once without adding current authority or copying private settings', () => {
    const filename = createRepresentativeV7Fixture();
    const source = new Database(filename);
    source.exec(`CREATE TABLE legacy_business_audit(id TEXT PRIMARY KEY,store_id TEXT,metadata_json TEXT);
      INSERT INTO legacy_business_audit VALUES('kept','legacy-v7-store','{"fact":"original"}');
      INSERT INTO legacy_business_audit VALUES('bad','missing-store','{"fact":"unbound"}');`);
    source.close();
    const upgraded = initSqlite(filename);
    try {
      const rows = upgraded.prepare('SELECT * FROM legacy_record_classifications').all() as Array<Record<string, unknown>>;
      expect(new Set(rows.map(row => row.classification))).toEqual(new Set(['validated-compatible','historical-read-only','re-derivation-required','quarantined']));
      expect(rows.every(row => row.source_schema === 7 && row.classifier_revision === 'legacy-compatibility/1' && String(row.reason).length > 0 && /^[a-f0-9]{64}$/.test(String(row.source_sha256)))).toBe(true);
      expect(rows.filter(row => row.source_table === 'legacy_business_audit').map(row => [row.record_id,row.classification]).sort())
        .toEqual([['bad','quarantined'],['kept','historical-read-only']]);
      expect(rows.some(row => row.source_table === 'app_settings')).toBe(false);
      const before = JSON.stringify(rows);
      runLegacyCompatibilityMigration(upgraded);
      expect(JSON.stringify(upgraded.prepare('SELECT * FROM legacy_record_classifications').all())).toBe(before);
      expect(upgraded.prepare("SELECT metadata_json FROM legacy_business_audit WHERE id='kept'").get()).toEqual({ metadata_json: '{"fact":"original"}' });
      expect(() => upgraded.prepare("UPDATE legacy_record_classifications SET classification='validated-compatible'").run()).toThrow(/immutable/);
    } finally { upgraded.close(); }
  });

  it('rolls back interrupted classification DDL and retries from the same snapshot', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-classification-interrupt-')); tempDirectories.push(directory);
    const filename = path.join(directory, 'app.db');
    const database = initSqlite(filename);
    try {
      database.exec('DROP TABLE ai_cost_records; DROP TABLE ai_spend_policies; DROP TABLE legacy_record_classifications; DELETE FROM schema_migrations WHERE version>=19;');
      const execute = database.exec.bind(database);
      const failure = vi.spyOn(database, 'exec').mockImplementation(sql => {
        if (sql.startsWith('CREATE INDEX idx_legacy_record_classifications_store')) throw new Error('injected mid-transaction interruption');
        return execute(sql);
      });
      expect(() => runLegacyCompatibilityMigration(database)).toThrow(/injected/);
      failure.mockRestore();
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name='legacy_record_classifications'").get()).toBeUndefined();
      expect(database.prepare('SELECT status FROM schema_migrations WHERE version=19').get()).toEqual({ status: 'failed' });
      const failed = database.prepare('SELECT manifest_json FROM schema_migrations WHERE version=19').get() as { manifest_json: string };
      const originalBackup = JSON.parse(failed.manifest_json).upgradeBackup;
      runLegacyCompatibilityMigration(database);
      const applied = database.prepare('SELECT manifest_json FROM schema_migrations WHERE version=19').get() as { manifest_json: string };
      expect(JSON.parse(applied.manifest_json).upgradeBackup).toMatchObject({ backupPath: originalBackup.backupPath, sha256: originalBackup.sha256, status: 'reused' });
      database.exec('DROP TRIGGER trg_legacy_record_classifications_delete');
      expect(() => runLegacyCompatibilityMigration(database)).toThrow(/schema mismatch/);
    } finally { database.close(); }
  });
  it('preserves v7 business rows and binds one restorable pre-v20 snapshot for migrations 8 through 20', () => {
    const databasePath = createRepresentativeV7Fixture();

    const upgraded = initSqlite(databasePath);
    let upgradeBackup: UpgradeBackupManifest;
    try {
      expect(upgraded.prepare(`
        SELECT version, status FROM schema_migrations ORDER BY version
      `).all()).toEqual(Array.from({ length: 20 }, (_, index) => ({
        version: index + 1,
        status: 'applied',
      })));
      expect(upgraded.prepare(`SELECT value FROM app_settings WHERE key = 'legacy-business-sentinel'`).get())
        .toEqual({ value: 'preserve-after-v8' });
      expect(upgraded.prepare(`SELECT asin, title FROM products WHERE asin = 'B0S7LEGACY'`).get())
        .toEqual({ asin: 'B0S7LEGACY', title: 'Legacy V7 Product' });
      expect(upgraded.pragma('foreign_key_check')).toEqual([]);

      const migration = upgraded.prepare(`
        SELECT manifest_json AS manifestJson
        FROM schema_migrations WHERE version = 20
      `).get() as { manifestJson: string };
      upgradeBackup = (JSON.parse(migration.manifestJson) as { upgradeBackup: UpgradeBackupManifest }).upgradeBackup;
      expect(upgradeBackup).toMatchObject({
        status: 'created',
        sourceVersion: 7,
        targetVersion: 20,
        integrityCheck: 'ok',
        backupIntegrityCheck: 'ok',
      });
      expect(upgradeBackup.tableRowCounts.app_settings).toBeGreaterThanOrEqual(1);
      expect(upgradeBackup.tableRowCounts.products).toBeGreaterThanOrEqual(1);

      const repository = new StoreRepository(upgraded);
      expect(repository.getMigrationRecoveryPreflight(20)).toMatchObject({
        canRestore: true,
        sourceVersion: 7,
        targetVersion: 20,
        schemaFingerprintMatches: true,
        tableRowCountsMatch: true,
      });
      const restoredPath = path.join(path.dirname(databasePath), 'restored-pre-v20.db');
      expect(repository.restoreMigrationBackupTo(restoredPath, 20)).toMatchObject({
        version: 20,
        destinationPath: path.resolve(restoredPath),
        integrityCheck: 'ok',
      });

      const restored = new Database(restoredPath, { readonly: true, fileMustExist: true });
      try {
        expect(restored.prepare(`SELECT MAX(version) AS version FROM schema_migrations WHERE status = 'applied'`).get())
          .toEqual({ version: 7 });
        expect(restored.prepare(`SELECT value FROM app_settings WHERE key = 'legacy-business-sentinel'`).get())
          .toEqual({ value: 'preserve-after-v8' });
        expect(restored.prepare(`SELECT asin, title FROM products WHERE asin = 'B0S7LEGACY'`).get())
          .toEqual({ asin: 'B0S7LEGACY', title: 'Legacy V7 Product' });
        expect(restored.prepare(`
          SELECT COUNT(*) AS count FROM sqlite_master
          WHERE type = 'table' AND name = 'ad_execution_batches'
        `).get()).toEqual({ count: 0 });
      } finally {
        restored.close();
      }
    } finally {
      upgraded.close();
    }

    expect(fs.existsSync(upgradeBackup!.backupPath!)).toBe(true);
    expect(fs.existsSync(upgradeBackup!.manifestPath!)).toBe(true);
  });

  it('reuses the same bound snapshot after a recorded interrupted v20 attempt', () => {
    const databasePath = createRepresentativeV7Fixture();
    const interrupted = new Database(databasePath);
    interrupted.pragma('journal_mode = WAL');
    interrupted.pragma('foreign_keys = ON');
    try {
      const backup = prepareUpgradeBackup(interrupted, {
        targetVersion: AI_SPEND_MIGRATION_VERSION,
        targetName: AI_SPEND_MIGRATION_NAME,
        targetChecksum: AI_SPEND_MIGRATION_CHECKSUM,
      });
      interrupted.prepare(`
        INSERT INTO schema_migrations (
          version, name, checksum, status, started_at, applied_at,
          error_message, manifest_json, result_json
        ) VALUES (20, ?, ?, 'failed', ?, NULL, 'simulated process interruption', ?, '{}')
      `).run(
        AI_SPEND_MIGRATION_NAME,
        AI_SPEND_MIGRATION_CHECKSUM,
        '2026-07-27T00:00:00.000Z',
        JSON.stringify({
          version: 20,
          name: AI_SPEND_MIGRATION_NAME,
          checksum: AI_SPEND_MIGRATION_CHECKSUM,
          startedAt: '2026-07-27T00:00:00.000Z',
          upgradeBackup: backup,
        }),
      );
    } finally {
      interrupted.close();
    }

    const recovered = initSqlite(databasePath);
    try {
      const row = recovered.prepare(`
        SELECT status, manifest_json AS manifestJson FROM schema_migrations WHERE version = 20
      `).get() as { status: string; manifestJson: string };
      const manifest = JSON.parse(row.manifestJson) as { upgradeBackup: UpgradeBackupManifest };
      expect(row.status).toBe('applied');
      expect(manifest.upgradeBackup.status).toBe('reused');
      expect(manifest.upgradeBackup.sourceVersion).toBe(7);
      expect(recovered.prepare(`SELECT value FROM app_settings WHERE key = 'legacy-business-sentinel'`).get())
        .toEqual({ value: 'preserve-after-v8' });
    } finally {
      recovered.close();
    }
  });
});

function createRepresentativeV7Fixture(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-legacy-v7-'));
  tempDirectories.push(directory);
  const databasePath = path.join(directory, 'amazon-ai-ops.db');
  const current = initSqlite(databasePath);
  try {
    current.pragma('foreign_keys = OFF');
    current.exec('DROP TABLE ai_cost_records; DROP TABLE ai_spend_policies; DROP TABLE legacy_record_classifications');
    current.exec(`
      DROP TRIGGER trg_grant_slot_intent;
      DROP TRIGGER IF EXISTS trg_stores_v1_authority_insert;
      DROP TRIGGER IF EXISTS trg_stores_v1_authority_update;
      DROP TRIGGER IF EXISTS trg_store_connections_external_identity_insert;
      DROP TRIGGER IF EXISTS trg_store_connections_external_identity_update;
      DROP TRIGGER IF EXISTS trg_store_connections_collection_store_name_insert;
      DROP TRIGGER IF EXISTS trg_store_connections_collection_store_name_update;
      DROP INDEX IF EXISTS ${STORE_PROVIDER_IDENTITY_UNIQUE_INDEX};
    `);
    current.exec(`DROP TRIGGER trg_decision_write_authority_immutable;
      ALTER TABLE decisions DROP COLUMN authority_json;
      ALTER TABLE mission_grants DROP COLUMN authority_json;
      ALTER TABLE analysis_action_batches DROP COLUMN authority_json;
      DROP TABLE ad_execution_reconciliation_cases;`);
    for (const table of [...POLICY_AUTHORITY_TABLES, ...V16_DOMAIN_TABLES, ...ANALYSIS_RUNS_TABLES].reverse()) {
      current.exec('DROP TABLE IF EXISTS "' + table + '"');
    }
    for (const table of [...COLLECTION_RESUME_AUTHORITY_TABLES].reverse()) {
      current.exec(`DROP TABLE IF EXISTS "${table}"`);
    }
    for (const table of [...EXECUTION_AUTHORITY_TABLES].reverse()) {
      current.exec(`DROP TABLE IF EXISTS "${table}"`);
    }
    current.exec(`
      ALTER TABLE store_connections DROP COLUMN normalized_collection_store_name;
      ALTER TABLE store_connections DROP COLUMN collection_store_name;
      ALTER TABLE store_connections DROP COLUMN normalized_external_account_id;
    `);
    current.prepare(`DELETE FROM schema_migrations WHERE version >= 8`).run();
    current.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('legacy-business-sentinel', 'preserve-after-v8', '2026-07-22T00:00:00.000Z')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run();
    current.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name,
        status, business_timezone, created_at, updated_at
      ) VALUES (
        'legacy-v7-store', 'legacy-v7-profile', 'US', 'USD', 'Legacy US Store',
        'active', 'America/Los_Angeles', ?, ?
      )
    `).run('2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z');
    current.prepare(`
      INSERT INTO products (
        store_id, marketplace_code, store_name, asin, title, status, created_at, updated_at
      ) VALUES (
        'legacy-v7-store', 'US', 'Legacy US Store', 'B0S7LEGACY',
        'Legacy V7 Product', 'active', ?, ?
      )
    `).run('2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z');
    current.pragma('foreign_keys = ON');
    expect(current.prepare(`SELECT MAX(version) AS version FROM schema_migrations WHERE status = 'applied'`).get())
      .toEqual({ version: 7 });
  } finally {
    current.close();
  }
  return databasePath;
}
