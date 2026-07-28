import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSqlite } from '../db';
import {
  LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
  STORE_AUTHORITY_MIGRATION_CHECKSUM,
  STORE_AUTHORITY_MIGRATION_NAME,
  STORE_AUTHORITY_MIGRATION_VERSION,
  STORE_SCOPED_LEGACY_TABLES,
  ensureSchemaMigrationsTable,
  getStoreMigrationRecoveryPreflight,
  prepareStoreAuthorityMigrationBackup,
  restoreStoreMigrationBackupTo,
  runStoreAuthorityMigrations,
} from '.';
import type { StoreMigrationManifest, StoreMigrationResult } from './types';

const fsCopyControl = vi.hoisted(() => ({
  mode: 'normal' as 'normal' | 'corrupt' | 'partial-throw' | 'race-eexist',
  raceSentinel: 'actor-owned destination',
}));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    copyFileSync: (
      source: Parameters<typeof actual.copyFileSync>[0],
      destination: Parameters<typeof actual.copyFileSync>[1],
      mode?: Parameters<typeof actual.copyFileSync>[2],
    ) => {
      if (fsCopyControl.mode === 'race-eexist' && !String(destination).includes('.restore-')) {
        actual.writeFileSync(destination, fsCopyControl.raceSentinel);
        throw Object.assign(new Error('actor won destination race'), { code: 'EEXIST' });
      }
      if (fsCopyControl.mode === 'partial-throw') {
        if (actual.existsSync(destination)) {
          throw Object.assign(new Error('destination already exists'), { code: 'EEXIST' });
        }
        actual.writeFileSync(destination, 'partial copy output');
        throw new Error('simulated partial copy failure');
      }
      actual.copyFileSync(source, destination, mode);
      if (fsCopyControl.mode === 'corrupt') {
        actual.appendFileSync(destination, 'corrupt trailing bytes');
      }
    },
    linkSync: (
      existingPath: Parameters<typeof actual.linkSync>[0],
      newPath: Parameters<typeof actual.linkSync>[1],
    ) => {
      if (fsCopyControl.mode === 'race-eexist') {
        actual.writeFileSync(newPath, fsCopyControl.raceSentinel);
        throw Object.assign(new Error('actor won destination race'), { code: 'EEXIST' });
      }
      actual.linkSync(existingPath, newPath);
    },
  };
});

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-store-migration-'));
  tempDirs.push(dir);
  return path.join(dir, 'app.db');
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('store authority migration v1', () => {
  it('captures legacy rows before startup deduplication mutates the first-upgrade database', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          parent_asin TEXT,
          msku TEXT,
          sku TEXT,
          title TEXT,
          product_stage TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT,
          updated_at TEXT
        );
        INSERT INTO products (id, marketplace_code, store_name, asin, title)
        VALUES
          (1, 'US', 'Backup Shop', 'B-BACKUP', 'older duplicate'),
          (2, 'US', 'Backup Shop', 'B-BACKUP', 'newer duplicate');
      `);
    } finally {
      legacy.close();
    }

    const database = initSqlite(dbPath);
    let manifest: StoreMigrationManifest;
    try {
      manifest = JSON.parse((database.prepare(`
        SELECT manifest_json FROM schema_migrations WHERE version = 1
      `).get() as { manifest_json: string }).manifest_json) as StoreMigrationManifest;
      expect(database.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }

    const backup = new Database(manifest.backup.backupPath!, { readonly: true, fileMustExist: true });
    try {
      expect(backup.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual({ count: 2 });
    } finally {
      backup.close();
    }
  });

  it('creates versioned authority tables and nullable indexed store_id columns idempotently', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    try {
      const migration = database.prepare(`
        SELECT version, status, manifest_json, result_json
        FROM schema_migrations
        WHERE version = ?
      `).get(STORE_AUTHORITY_MIGRATION_VERSION) as {
        version: number;
        status: string;
        manifest_json: string;
        result_json: string;
      };
      const manifest = JSON.parse(migration.manifest_json) as StoreMigrationManifest;
      const result = JSON.parse(migration.result_json) as StoreMigrationResult;

      expect(migration).toMatchObject({ version: 1, status: 'applied' });
      expect(manifest.integrityCheck).toBe('ok');
      expect(manifest.schemaFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.backup).toMatchObject({ status: 'created', integrityCheck: 'ok' });
      expect(manifest.backup.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(fs.existsSync(manifest.backup.backupPath!)).toBe(true);
      expect(result.status).toBe('applied');

      for (const table of [
        'stores',
        'store_connections',
        'store_session_metadata',
        'store_migration_quarantine',
      ]) {
        expect(database.prepare(`
          SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?
        `).get(table)).toEqual({ present: 1 });
      }
      for (const table of STORE_SCOPED_LEGACY_TABLES) {
        const storeIdColumn = (database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
          name: string;
          notnull: number;
        }>).find((column) => column.name === 'store_id');
        const index = database.prepare(`
          SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?
        `).get(`idx_${table}_store_id`);
        expect(storeIdColumn).toMatchObject({ name: 'store_id', notnull: 0 });
        expect(index).toEqual({ name: `idx_${table}_store_id` });
      }
    } finally {
      database.close();
    }

    const reopened = initSqlite(dbPath);
    try {
      expect(reopened.prepare(`
        SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 1
      `).get()).toEqual({ count: 1 });
    } finally {
      reopened.close();
    }
  });

  it('adds every legacy store_id column before resolving cross-table ASIN ownership', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          parent_asin TEXT,
          msku TEXT,
          sku TEXT,
          title TEXT,
          product_stage TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE listing_content (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asin TEXT NOT NULL,
          store_name TEXT,
          marketplace_code TEXT,
          title TEXT DEFAULT '',
          bullets_json TEXT DEFAULT '[]',
          description TEXT,
          source TEXT DEFAULT 'manual',
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE listing_drafts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asin TEXT NOT NULL,
          store_name TEXT,
          marketplace_code TEXT,
          section TEXT NOT NULL,
          current_text TEXT,
          drafted_text TEXT NOT NULL,
          keywords_json TEXT DEFAULT '[]',
          source TEXT DEFAULT 'rule',
          status TEXT DEFAULT 'pending',
          created_at TEXT,
          updated_at TEXT
        );
        INSERT INTO products (id, marketplace_code, store_name, asin, title)
        VALUES (1, 'US', 'Historical Shop', 'B-HISTORICAL', 'Owned product');
        INSERT INTO listing_content (id, asin, title)
        VALUES
          (1, 'B-HISTORICAL', 'Legacy content without direct store identity'),
          (2, 'B-REVERSE', 'Ownership appears only in a later table');
        INSERT INTO listing_drafts (
          id, asin, store_name, marketplace_code, section, current_text, drafted_text
        ) VALUES
          (1, 'B-HISTORICAL', NULL, NULL, 'title', 'Old title', 'New title'),
          (2, 'B-REVERSE', 'Historical Shop', 'US', 'title', 'Old reverse', 'New reverse');
      `);
    } finally {
      legacy.close();
    }

    const database = initSqlite(dbPath);
    try {
      const product = database.prepare('SELECT store_id FROM products WHERE id = 1').get() as {
        store_id: string;
      };
      expect(product.store_id).toBeTruthy();
      expect(database.prepare('SELECT store_id FROM listing_content WHERE id = 1').get()).toEqual({
        store_id: product.store_id,
      });
      expect(database.prepare('SELECT store_id FROM listing_drafts WHERE id = 1').get()).toEqual({
        store_id: product.store_id,
      });
      expect(database.prepare('SELECT store_id FROM listing_content WHERE id = 2').get()).toEqual({
        store_id: product.store_id,
      });
      expect(database.prepare('SELECT store_id FROM listing_drafts WHERE id = 2').get()).toEqual({
        store_id: product.store_id,
      });
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM store_migration_quarantine
        WHERE source_table IN ('listing_content', 'listing_drafts')
      `).get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it('promotes a failed legacy v1 checksum only while reusing its bound backup', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    let failedManifest: StoreMigrationManifest;
    try {
      legacy.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE listing_content (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asin TEXT NOT NULL,
          store_name TEXT,
          marketplace_code TEXT,
          title TEXT DEFAULT '',
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE listing_drafts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asin TEXT NOT NULL,
          store_name TEXT,
          marketplace_code TEXT,
          section TEXT NOT NULL,
          drafted_text TEXT NOT NULL,
          created_at TEXT,
          updated_at TEXT
        );
        INSERT INTO listing_content (id, asin, title)
        VALUES (1, 'B-RETRY', 'Content awaiting later ownership');
        INSERT INTO listing_drafts (
          id, asin, store_name, marketplace_code, section, drafted_text
        ) VALUES (
          1, 'B-RETRY', 'Retry Shop', 'US', 'title', 'Retry title'
        );
      `);
      prepareStoreAuthorityMigrationBackup(legacy);
      const preparedManifest = JSON.parse((legacy.prepare(`
        SELECT manifest_json FROM schema_migrations WHERE version = 1
      `).get() as { manifest_json: string }).manifest_json) as StoreMigrationManifest;
      failedManifest = {
        ...preparedManifest,
        checksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
      };
      legacy.prepare(`
        UPDATE schema_migrations
        SET checksum = @legacyChecksum,
            status = 'failed',
            error_message = 'simulated pre-fix failure',
            manifest_json = @manifestJson
        WHERE version = 1
      `).run({
        legacyChecksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
        manifestJson: JSON.stringify(failedManifest),
      });
    } finally {
      legacy.close();
    }

    const database = initSqlite(dbPath);
    try {
      const migration = database.prepare(`
        SELECT checksum, status, error_message, manifest_json
        FROM schema_migrations
        WHERE version = 1
      `).get() as {
        checksum: string;
        status: string;
        error_message: string | null;
        manifest_json: string;
      };
      const retriedManifest = JSON.parse(migration.manifest_json) as StoreMigrationManifest & {
        legacyChecksumProvenance: {
          legacyChecksum: string;
          promotedToChecksum: string;
          previousStatus: string;
          previousStartedAt: string;
          promotedAt: string;
        };
      };
      expect(migration).toMatchObject({
        checksum: STORE_AUTHORITY_MIGRATION_CHECKSUM,
        status: 'applied',
        error_message: null,
      });
      expect(retriedManifest.backup).toMatchObject({
        backupPath: failedManifest.backup.backupPath,
        sha256: failedManifest.backup.sha256,
        integrityCheck: 'ok',
      });
      expect(retriedManifest.legacyChecksumProvenance).toMatchObject({
        legacyChecksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
        promotedToChecksum: STORE_AUTHORITY_MIGRATION_CHECKSUM,
        previousStatus: 'failed',
        previousStartedAt: failedManifest.startedAt,
        promotedAt: expect.any(String),
      });
      const content = database.prepare(`
        SELECT store_id FROM listing_content WHERE id = 1
      `).get() as { store_id: string | null };
      const draft = database.prepare(`
        SELECT store_id FROM listing_drafts WHERE id = 1
      `).get() as { store_id: string | null };
      expect(content.store_id).toBeTruthy();
      expect(content.store_id).toBe(draft.store_id);
    } finally {
      database.close();
    }
  });

  it('accepts an already-applied legacy v1 checksum without rewriting or rerunning it', () => {
    const database = initSqlite(':memory:');
    try {
      const applied = database.prepare(`
        SELECT manifest_json, result_json
        FROM schema_migrations
        WHERE version = 1
      `).get() as { manifest_json: string; result_json: string };
      const legacyManifest = {
        ...(JSON.parse(applied.manifest_json) as StoreMigrationManifest),
        checksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
      };
      const legacyManifestJson = JSON.stringify(legacyManifest);
      database.prepare(`
        UPDATE schema_migrations
        SET checksum = ?, manifest_json = ?
        WHERE version = 1 AND status = 'applied'
      `).run(LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM, legacyManifestJson);

      const result = runStoreAuthorityMigrations(database)[0];

      expect(result.status).toBe('applied');
      expect(database.prepare(`
        SELECT checksum, status, manifest_json, result_json
        FROM schema_migrations
        WHERE version = 1
      `).get()).toEqual({
        checksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
        status: 'applied',
        manifest_json: legacyManifestJson,
        result_json: applied.result_json,
      });
    } finally {
      database.close();
    }
  });

  it('refuses to promote an unfinished legacy v1 checksum without its original bound backup', () => {
    const database = new Database(tempDbPath());
    try {
      ensureSchemaMigrationsTable(database);
      const legacyManifest: StoreMigrationManifest = {
        version: 1,
        name: STORE_AUTHORITY_MIGRATION_NAME,
        checksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
        startedAt: '2026-07-22T00:00:00.000Z',
        schemaFingerprint: 'legacy-fingerprint',
        integrityCheck: 'ok',
        tableRowCounts: {},
        targetTables: [...STORE_SCOPED_LEGACY_TABLES],
        backup: {
          status: 'not_applicable',
          integrityCheck: 'ok',
        },
      };
      database.prepare(`
        INSERT INTO schema_migrations (
          version, name, checksum, status, started_at,
          error_message, manifest_json, result_json
        ) VALUES (
          1, ?, ?, 'failed', ?, 'simulated legacy failure', ?, NULL
        )
      `).run(
        STORE_AUTHORITY_MIGRATION_NAME,
        LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
        legacyManifest.startedAt,
        JSON.stringify(legacyManifest),
      );

      expect(() => prepareStoreAuthorityMigrationBackup(database)).toThrow(/original bound backup/i);
      expect(database.prepare(`
        SELECT checksum, status
        FROM schema_migrations
        WHERE version = 1
      `).get()).toEqual({
        checksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
        status: 'failed',
      });
    } finally {
      database.close();
    }
  });

  it('rolls back column and ownership writes before retrying an interrupted migration transaction', () => {
    const dbPath = tempDbPath();
    const database = new Database(dbPath);
    try {
      database.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT
        );
        CREATE TABLE listing_content (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asin TEXT NOT NULL,
          store_name TEXT,
          marketplace_code TEXT
        );
        CREATE TABLE listing_drafts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asin TEXT NOT NULL,
          store_name TEXT,
          marketplace_code TEXT,
          section TEXT NOT NULL,
          drafted_text TEXT NOT NULL
        );
        INSERT INTO listing_content (id, asin)
        VALUES (1, 'B-ROLLBACK');
        INSERT INTO listing_drafts (
          id, asin, store_name, marketplace_code, section, drafted_text
        ) VALUES (
          1, 'B-ROLLBACK', 'Rollback Shop', 'US', 'title', 'Recovered title'
        );
        CREATE TRIGGER force_store_migration_failure
        BEFORE UPDATE ON listing_drafts
        BEGIN
          SELECT RAISE(ABORT, 'simulated ownership write failure');
        END;
      `);
      prepareStoreAuthorityMigrationBackup(database);

      expect(() => runStoreAuthorityMigrations(database)).toThrow(/simulated ownership write failure/i);
      expect(database.prepare(`
        SELECT status FROM schema_migrations WHERE version = 1
      `).get()).toEqual({ status: 'failed' });
      expect(database.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name = 'stores'
      `).get()).toEqual({ count: 0 });
      for (const table of ['products', 'listing_content', 'listing_drafts']) {
        const columns = database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
        expect(columns.some((column) => column.name === 'store_id')).toBe(false);
      }

      database.exec('DROP TRIGGER force_store_migration_failure');
      expect(runStoreAuthorityMigrations(database)[0]).toMatchObject({ status: 'applied' });
      const content = database.prepare(`
        SELECT store_id FROM listing_content WHERE id = 1
      `).get() as { store_id: string | null };
      const draft = database.prepare(`
        SELECT store_id FROM listing_drafts WHERE id = 1
      `).get() as { store_id: string | null };
      expect(content.store_id).toBeTruthy();
      expect(content.store_id).toBe(draft.store_id);
    } finally {
      database.close();
    }
  });

  it('replaces only a recorded pending backup after an interrupted preparation attempt', () => {
    const dbPath = tempDbPath();
    const backupPath = `${path.resolve(dbPath)}.pre-store-authority-v1.bak`;
    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    try {
      database.exec(`CREATE TABLE legacy_payload (id INTEGER PRIMARY KEY, value TEXT)`);
      database.prepare(`INSERT INTO legacy_payload (id, value) VALUES (1, 'preserve me')`).run();
      ensureSchemaMigrationsTable(database);
      const manifest: StoreMigrationManifest = {
        version: STORE_AUTHORITY_MIGRATION_VERSION,
        name: STORE_AUTHORITY_MIGRATION_NAME,
        checksum: STORE_AUTHORITY_MIGRATION_CHECKSUM,
        startedAt: '2026-07-22T00:00:00.000Z',
        schemaFingerprint: '0'.repeat(64),
        integrityCheck: 'ok',
        tableRowCounts: {},
        targetTables: [...STORE_SCOPED_LEGACY_TABLES],
        backup: {
          status: 'pending',
          databasePath: path.resolve(dbPath),
          backupPath,
          integrityCheck: 'ok',
        },
      };
      database.prepare(`
        INSERT INTO schema_migrations (
          version, name, checksum, status, started_at, manifest_json
        ) VALUES (?, ?, ?, 'failed', ?, ?)
      `).run(
        STORE_AUTHORITY_MIGRATION_VERSION,
        STORE_AUTHORITY_MIGRATION_NAME,
        STORE_AUTHORITY_MIGRATION_CHECKSUM,
        manifest.startedAt,
        JSON.stringify(manifest),
      );
      fs.writeFileSync(backupPath, 'interrupted VACUUM output');

      prepareStoreAuthorityMigrationBackup(database);

      const rebound = JSON.parse((database.prepare(`
        SELECT manifest_json FROM schema_migrations WHERE version = 1
      `).get() as { manifest_json: string }).manifest_json) as StoreMigrationManifest;
      expect(rebound.backup).toMatchObject({ status: 'created', integrityCheck: 'ok' });
      expect(getStoreMigrationRecoveryPreflight(rebound)).toMatchObject({ canRestore: true });
      const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
      try {
        expect(backup.prepare('SELECT value FROM legacy_payload WHERE id = 1').get()).toEqual({
          value: 'preserve me',
        });
      } finally {
        backup.close();
      }
    } finally {
      database.close();
    }
  });

  it('never claims or deletes an expected backup file that predates the first manifest', () => {
    const dbPath = tempDbPath();
    const backupPath = `${path.resolve(dbPath)}.pre-store-authority-v1.bak`;
    const database = new Database(dbPath);
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
    try {
      database.exec(`CREATE TABLE legacy_payload (id INTEGER PRIMARY KEY, value TEXT)`);
      database.prepare(`INSERT INTO legacy_payload (id, value) VALUES (1, 'untouched')`).run();
      const foreignBytes = Buffer.from('backup created outside this migration');
      fs.writeFileSync(backupPath, foreignBytes);

      expect(() => prepareStoreAuthorityMigrationBackup(database)).toThrow(/unbound/i);
      expect(fs.readFileSync(backupPath)).toEqual(foreignBytes);
      expect(database.prepare(`SELECT COUNT(*) AS count FROM schema_migrations`).get()).toEqual({ count: 0 });

      expect(() => prepareStoreAuthorityMigrationBackup(database)).toThrow(/unbound/i);
      expect(fs.readFileSync(backupPath)).toEqual(foreignBytes);
    } finally {
      database.close();
    }
  });

  it('maps only proven direct and parent ownership while quarantining ambiguous ASIN ownership', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          parent_asin TEXT,
          msku TEXT,
          sku TEXT,
          title TEXT,
          product_stage TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE product_costs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER,
          purchase_cost REAL DEFAULT 0
        );
        CREATE TABLE keyword_metrics (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          normalized_keyword TEXT NOT NULL,
          raw_keyword TEXT NOT NULL,
          source TEXT NOT NULL,
          asin TEXT,
          source_file TEXT,
          source_row INTEGER
        );
        INSERT INTO products (id, marketplace_code, store_name, asin, title)
        VALUES
          (1, ' us ', ' Shop Alpha ', 'B-SHARED', 'Alpha product'),
          (2, 'US', 'Shop Beta', 'B-SHARED', 'Beta product');
        INSERT INTO product_costs (id, product_id, purchase_cost) VALUES (1, 1, 12.5);
        INSERT INTO keyword_metrics (
          id, normalized_keyword, raw_keyword, source, asin, source_row
        ) VALUES (1, 'shared keyword', 'Shared Keyword', 'manual', 'B-SHARED', 1);
      `);
    } finally {
      legacy.close();
    }

    const database = initSqlite(dbPath);
    try {
      const products = database.prepare(`
        SELECT id, store_id FROM products ORDER BY id
      `).all() as Array<{ id: number; store_id: string | null }>;
      const cost = database.prepare(`
        SELECT store_id FROM product_costs WHERE id = 1
      `).get() as { store_id: string | null };
      const keyword = database.prepare(`
        SELECT store_id FROM keyword_metrics WHERE id = 1
      `).get() as { store_id: string | null };
      const quarantine = database.prepare(`
        SELECT reason, candidate_store_ids_json
        FROM store_migration_quarantine
        WHERE source_table = 'keyword_metrics' AND source_row_id = '1'
      `).get() as { reason: string; candidate_store_ids_json: string };

      expect(products[0].store_id).toBeTruthy();
      expect(products[1].store_id).toBeTruthy();
      expect(products[0].store_id).not.toBe(products[1].store_id);
      expect(cost.store_id).toBe(products[0].store_id);
      expect(keyword.store_id).toBeNull();
      expect(quarantine.reason).toBe('ambiguous_parent_store');
      expect(JSON.parse(quarantine.candidate_store_ids_json)).toHaveLength(2);
      expect(database.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual({ count: 2 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM product_costs').get()).toEqual({ count: 1 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM keyword_metrics').get()).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it('quarantines an AI diagnosis scope that contains more than one store identity', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          parent_asin TEXT,
          msku TEXT,
          sku TEXT,
          title TEXT,
          product_stage TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT,
          updated_at TEXT
        );
        CREATE TABLE ai_diagnosis_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          prompt_key TEXT,
          prompt_version TEXT,
          model TEXT,
          scope_json TEXT,
          evidence_pack_summary_json TEXT,
          evidence_pack_preview_json TEXT,
          diagnosis_json TEXT,
          insights_json TEXT,
          formal_recommendation_count INTEGER DEFAULT 0,
          success INTEGER DEFAULT 1,
          error_message TEXT,
          created_at TEXT
        );
        INSERT INTO products (id, marketplace_code, store_name, asin, title)
        VALUES
          (1, 'US', 'Scope Alpha', 'B-SCOPE-A', 'Alpha'),
          (2, 'US', 'Scope Beta', 'B-SCOPE-B', 'Beta');
      `);
      legacy.prepare(`
        INSERT INTO ai_diagnosis_runs (id, scope_json)
        VALUES (1, ?)
      `).run(JSON.stringify({
        primary: { storeName: 'Scope Alpha', marketplaceCode: 'US' },
        comparison: { storeName: 'Scope Beta', marketplaceCode: 'US' },
      }));
    } finally {
      legacy.close();
    }

    const database = initSqlite(dbPath);
    try {
      expect(database.prepare('SELECT store_id FROM ai_diagnosis_runs WHERE id = 1').get()).toEqual({
        store_id: null,
      });
      const quarantine = database.prepare(`
        SELECT reason, candidate_store_ids_json
        FROM store_migration_quarantine
        WHERE source_table = 'ai_diagnosis_runs' AND source_row_id = '1'
      `).get() as { reason: string; candidate_store_ids_json: string };
      expect(quarantine.reason).toBe('ambiguous_store_identity');
      expect(JSON.parse(quarantine.candidate_store_ids_json)).toHaveLength(2);
    } finally {
      database.close();
    }
  });

  it('preserves a conflicting existing store_id, quarantines it, and accounts for the row exactly once', () => {
    const dbPath = tempDbPath();
    const legacy = new Database(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE stores (
          store_id TEXT PRIMARY KEY NOT NULL,
          browser_profile_id TEXT NOT NULL,
          marketplace TEXT NOT NULL,
          currency TEXT NOT NULL,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL,
          business_timezone TEXT NOT NULL,
          legacy_store_name_normalized TEXT,
          legacy_marketplace_code_normalized TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        );
        INSERT INTO stores VALUES
          ('store-a', 'profile-a', 'US', 'USD', 'Shop Alpha', 'active', 'America/Los_Angeles', 'shop alpha', 'US', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', NULL),
          ('store-b', 'profile-b', 'US', 'USD', 'Shop Beta', 'active', 'America/Los_Angeles', 'shop beta', 'US', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', NULL);
        CREATE TABLE products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          marketplace_code TEXT,
          store_name TEXT,
          asin TEXT,
          parent_asin TEXT,
          msku TEXT,
          sku TEXT,
          title TEXT,
          product_stage TEXT,
          status TEXT DEFAULT 'active',
          created_at TEXT,
          updated_at TEXT,
          store_id TEXT
        );
        INSERT INTO products (id, marketplace_code, store_name, asin, title, store_id)
        VALUES (1, 'US', 'Shop Alpha', 'B-CONFLICT', 'Conflict product', 'store-b');
      `);
    } finally {
      legacy.close();
    }

    const database = initSqlite(dbPath);
    try {
      expect(database.prepare(`SELECT store_id FROM products WHERE id = 1`).get()).toEqual({
        store_id: 'store-b',
      });
      expect(database.prepare(`
        SELECT reason, candidate_store_ids_json
        FROM store_migration_quarantine
        WHERE source_table = 'products' AND source_row_id = '1'
      `).get()).toEqual({
        reason: 'cross_store_conflict',
        candidate_store_ids_json: JSON.stringify(['store-a', 'store-b']),
      });
      const result = JSON.parse((database.prepare(`
        SELECT result_json FROM schema_migrations WHERE version = 1
      `).get() as { result_json: string }).result_json) as StoreMigrationResult;
      expect(result.tableResults.find((entry) => entry.table === 'products')).toMatchObject({
        totalRows: 1,
        mappedRows: 0,
        quarantinedRows: 1,
      });
    } finally {
      database.close();
    }
  });

  it('restores the bound backup only to a new verified file and never overwrites', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    let manifest: StoreMigrationManifest;
    try {
      manifest = JSON.parse((database.prepare(`
        SELECT manifest_json FROM schema_migrations WHERE version = 1
      `).get() as { manifest_json: string }).manifest_json) as StoreMigrationManifest;
    } finally {
      database.close();
    }

    const preflight = getStoreMigrationRecoveryPreflight(manifest);
    expect(preflight).toMatchObject({ canRestore: true, backupIntegrityCheck: 'ok' });
    expect(preflight.backupSha256).toBe(manifest.backup.sha256);

    const destinationPath = path.join(path.dirname(dbPath), 'restored-copy.db');
    const restored = restoreStoreMigrationBackupTo(manifest, destinationPath);
    expect(restored).toMatchObject({
      destinationPath: path.resolve(destinationPath),
      integrityCheck: 'ok',
      sha256: manifest.backup.sha256,
    });
    expect(fs.existsSync(destinationPath)).toBe(true);
    expect(() => restoreStoreMigrationBackupTo(manifest, destinationPath)).toThrow(/exist|EEXIST/i);
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('removes a newly created restore destination when copy verification fails', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    let manifest: StoreMigrationManifest;
    try {
      manifest = JSON.parse((database.prepare(`
        SELECT manifest_json FROM schema_migrations WHERE version = 1
      `).get() as { manifest_json: string }).manifest_json) as StoreMigrationManifest;
    } finally {
      database.close();
    }

    const destinationPath = path.join(path.dirname(dbPath), 'corrupt-restored-copy.db');
    fsCopyControl.mode = 'corrupt';
    try {
      expect(() => restoreStoreMigrationBackupTo(manifest, destinationPath)).toThrow(/verification failed/i);
      expect(fs.existsSync(destinationPath)).toBe(false);
    } finally {
      fsCopyControl.mode = 'normal';
    }
  });

  it('cleans partial copy output after copy throws without deleting a pre-existing destination', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    let manifest: StoreMigrationManifest;
    try {
      manifest = JSON.parse((database.prepare(`
        SELECT manifest_json FROM schema_migrations WHERE version = 1
      `).get() as { manifest_json: string }).manifest_json) as StoreMigrationManifest;
    } finally {
      database.close();
    }

    const partialDestination = path.join(path.dirname(dbPath), 'partial-restored-copy.db');
    const existingDestination = path.join(path.dirname(dbPath), 'existing-restored-copy.db');
    const sentinel = Buffer.from('pre-existing operator file');
    fs.writeFileSync(existingDestination, sentinel);
    fsCopyControl.mode = 'partial-throw';
    try {
      expect(() => restoreStoreMigrationBackupTo(manifest, partialDestination)).toThrow(/partial copy failure/i);
      expect(fs.existsSync(partialDestination)).toBe(false);

      expect(() => restoreStoreMigrationBackupTo(manifest, existingDestination)).toThrow(/already exists/i);
      expect(fs.readFileSync(existingDestination)).toEqual(sentinel);
    } finally {
      fsCopyControl.mode = 'normal';
    }
  });

  it('never deletes a destination created by another actor after the existence check', () => {
    const dbPath = tempDbPath();
    const database = initSqlite(dbPath);
    let manifest: StoreMigrationManifest;
    try {
      manifest = JSON.parse((database.prepare(`
        SELECT manifest_json FROM schema_migrations WHERE version = 1
      `).get() as { manifest_json: string }).manifest_json) as StoreMigrationManifest;
    } finally {
      database.close();
    }

    const destinationPath = path.join(path.dirname(dbPath), 'actor-race-restored-copy.db');
    fsCopyControl.mode = 'race-eexist';
    try {
      expect(() => restoreStoreMigrationBackupTo(manifest, destinationPath)).toThrow(/actor won destination race/i);
      expect(fs.readFileSync(destinationPath, 'utf8')).toBe(fsCopyControl.raceSentinel);
    } finally {
      fsCopyControl.mode = 'normal';
    }
  });
});
