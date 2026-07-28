import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { initSqlite } from './db';
import {
  EXECUTION_AUTHORITY_TABLES,
  prepareUpgradeBackup,
  STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
  STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
  STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
  type UpgradeBackupManifest,
} from './migrations';
import { StoreRepository } from './repositories/store-repo';

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('representative legacy database upgrade to migration 9', () => {
  it('preserves v7 business rows and binds one restorable pre-v9 snapshot for migrations 8 and 9', () => {
    const databasePath = createRepresentativeV7Fixture();

    const upgraded = initSqlite(databasePath);
    let upgradeBackup: UpgradeBackupManifest;
    try {
      expect(upgraded.prepare(`
        SELECT version, status FROM schema_migrations ORDER BY version
      `).all()).toEqual(Array.from({ length: 9 }, (_, index) => ({
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
        FROM schema_migrations WHERE version = 9
      `).get() as { manifestJson: string };
      upgradeBackup = (JSON.parse(migration.manifestJson) as { upgradeBackup: UpgradeBackupManifest }).upgradeBackup;
      expect(upgradeBackup).toMatchObject({
        status: 'created',
        sourceVersion: 7,
        targetVersion: 9,
        integrityCheck: 'ok',
        backupIntegrityCheck: 'ok',
      });
      expect(upgradeBackup.tableRowCounts.app_settings).toBeGreaterThanOrEqual(1);
      expect(upgradeBackup.tableRowCounts.products).toBeGreaterThanOrEqual(1);

      const repository = new StoreRepository(upgraded);
      expect(repository.getMigrationRecoveryPreflight(9)).toMatchObject({
        canRestore: true,
        sourceVersion: 7,
        targetVersion: 9,
        schemaFingerprintMatches: true,
        tableRowCountsMatch: true,
      });
      const restoredPath = path.join(path.dirname(databasePath), 'restored-pre-v9.db');
      expect(repository.restoreMigrationBackupTo(restoredPath, 9)).toMatchObject({
        version: 9,
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

  it('reuses the same bound snapshot after a recorded interrupted v9 attempt', () => {
    const databasePath = createRepresentativeV7Fixture();
    const interrupted = new Database(databasePath);
    interrupted.pragma('journal_mode = WAL');
    interrupted.pragma('foreign_keys = ON');
    try {
      const backup = prepareUpgradeBackup(interrupted, {
        targetVersion: STORE_AUTHORITY_REPAIR_MIGRATION_VERSION,
        targetName: STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
        targetChecksum: STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
      });
      interrupted.prepare(`
        INSERT INTO schema_migrations (
          version, name, checksum, status, started_at, applied_at,
          error_message, manifest_json, result_json
        ) VALUES (9, ?, ?, 'failed', ?, NULL, 'simulated process interruption', ?, '{}')
      `).run(
        STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
        STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
        '2026-07-27T00:00:00.000Z',
        JSON.stringify({
          version: 9,
          name: STORE_AUTHORITY_REPAIR_MIGRATION_NAME,
          checksum: STORE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM,
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
        SELECT status, manifest_json AS manifestJson FROM schema_migrations WHERE version = 9
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
    for (const table of [...EXECUTION_AUTHORITY_TABLES].reverse()) {
      current.exec(`DROP TABLE IF EXISTS "${table}"`);
    }
    current.prepare(`DELETE FROM schema_migrations WHERE version IN (8, 9)`).run();
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
