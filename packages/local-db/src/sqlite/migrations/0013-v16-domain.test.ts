import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runStoreAuthorityMigrations } from './0001-store-authority';
import { runMissionDomainMigration } from './0006-mission-domain';
import { runAnalysisRunsMigration } from './0012-analysis-runs';
import {
  runV16DomainMigration,
  verifyV16DomainSchema,
  V16DomainMigrationError,
  V16_DOMAIN_MIGRATION_VERSION,
  V16_DOMAIN_TABLES,
} from './0013-v16-domain';

describe('0013-v16-domain migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  function setupPrerequisites() {
    runStoreAuthorityMigrations(db);

    // Create lingxing_report_batches table (required by mission-domain migration)
    db.exec(`
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `);

    // Mark migrations 2-5 as applied
    for (let v = 2; v <= 5; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    runMissionDomainMigration(db);

    // Mark migrations 7-11 as applied
    for (let v = 7; v <= 11; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    runAnalysisRunsMigration(db);
  }

  it('should fail without prerequisite migration 12', () => {
    runStoreAuthorityMigrations(db);
    expect(() => runV16DomainMigration(db)).toThrow(V16DomainMigrationError);
    expect(() => runV16DomainMigration(db)).toThrow(/Migration 12 must be applied/);
  });

  it('should apply migration 13 successfully after prerequisites', () => {
    setupPrerequisites();

    const result = runV16DomainMigration(db);

    expect(result.version).toBe(V16_DOMAIN_MIGRATION_VERSION);
    expect(result.status).toBe('applied');
    expect(result.createdTables).toBe(V16_DOMAIN_TABLES.length);
    expect(result.errorMessage).toBeUndefined();
  });

  it('should create all V1.6 domain tables', () => {
    setupPrerequisites();
    runV16DomainMigration(db);

    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map(t => t.name));

    for (const table of V16_DOMAIN_TABLES) {
      expect(tableNames.has(table)).toBe(true);
    }
  });

  it('should be idempotent - second run returns existing result', () => {
    setupPrerequisites();
    const first = runV16DomainMigration(db);
    expect(first.status).toBe('applied');

    const second = runV16DomainMigration(db);
    expect(second.status).toBe('applied');
    expect(second.version).toBe(V16_DOMAIN_MIGRATION_VERSION);
  });

  it('verifyV16DomainSchema should pass after migration', () => {
    setupPrerequisites();
    runV16DomainMigration(db);

    expect(() => verifyV16DomainSchema(db)).not.toThrow();
  });

  it('verifyV16DomainSchema should fail before migration', () => {
    setupPrerequisites();

    expect(() => verifyV16DomainSchema(db)).toThrow(V16DomainMigrationError);
  });
});
