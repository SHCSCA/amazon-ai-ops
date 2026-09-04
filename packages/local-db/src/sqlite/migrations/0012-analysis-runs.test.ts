import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runStoreAuthorityMigrations } from './0001-store-authority';
import { runMissionDomainMigration } from './0006-mission-domain';
import {
  runAnalysisRunsMigration,
  verifyAnalysisRunsSchema,
  AnalysisRunsMigrationError,
  ANALYSIS_RUNS_MIGRATION_VERSION,
} from './0012-analysis-runs';

describe('0012-analysis-runs migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('should fail without prerequisite migration 11', () => {
    runStoreAuthorityMigrations(db);
    expect(() => runAnalysisRunsMigration(db)).toThrow(AnalysisRunsMigrationError);
    expect(() => runAnalysisRunsMigration(db)).toThrow(/Migration 11 must be applied/);
  });

  it('should apply migration 12 successfully after prerequisites', () => {
    // Apply prerequisites: migrations 1, 6, 11
    runStoreAuthorityMigrations(db);
    
    // Skip migrations 2-5 for test speed, go straight to 6
    const lingxingBatchTable = `
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `;
    db.exec(lingxingBatchTable);
    
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

    const result = runAnalysisRunsMigration(db);

    expect(result.version).toBe(ANALYSIS_RUNS_MIGRATION_VERSION);
    expect(result.status).toBe('applied');
    expect(result.createdTables).toBe(1);
    expect(result.errorMessage).toBeUndefined();

    // Verify table exists
    const tableExists = db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'analysis_runs'
    `).get();
    expect(tableExists).toBeTruthy();
  });

  it('should be idempotent - second run returns existing result', () => {
    runStoreAuthorityMigrations(db);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `);
    
    for (let v = 2; v <= 5; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }
    
    runMissionDomainMigration(db);
    
    for (let v = 7; v <= 11; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    const result1 = runAnalysisRunsMigration(db);
    expect(result1.status).toBe('applied');

    const result2 = runAnalysisRunsMigration(db);
    expect(result2.status).toBe('applied');
    expect(result2.version).toBe(result1.version);
  });

  it('should verify schema correctly', () => {
    runStoreAuthorityMigrations(db);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `);
    
    for (let v = 2; v <= 5; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }
    
    runMissionDomainMigration(db);
    
    for (let v = 7; v <= 11; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    runAnalysisRunsMigration(db);

    expect(() => verifyAnalysisRunsSchema(db)).not.toThrow();
  });

  it('should create analysis_runs table with correct columns', () => {
    runStoreAuthorityMigrations(db);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `);
    
    for (let v = 2; v <= 5; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }
    
    runMissionDomainMigration(db);
    
    for (let v = 7; v <= 11; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    runAnalysisRunsMigration(db);

    const columns = db.prepare('PRAGMA table_info(analysis_runs)').all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;

    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('run_id');
    expect(columnNames).toContain('store_id');
    expect(columnNames).toContain('mission_id');
    expect(columnNames).toContain('report_snapshot_id');
    expect(columnNames).toContain('status');
    expect(columnNames).toContain('recommendations_count');
    expect(columnNames).toContain('blocked_reason');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');
    expect(columnNames).toContain('started_at');
    expect(columnNames).toContain('completed_at');
    expect(columnNames).toContain('metadata');
  });

  it('should enforce foreign key constraint to stores', () => {
    runStoreAuthorityMigrations(db);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `);
    
    for (let v = 2; v <= 5; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }
    
    runMissionDomainMigration(db);
    
    for (let v = 7; v <= 11; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    runAnalysisRunsMigration(db);

    // Try to insert with non-existent store_id
    expect(() => {
      db.prepare(`
        INSERT INTO analysis_runs (run_id, store_id, report_snapshot_id, status, recommendations_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('run1', 'nonexistent', 'snapshot1', 'pending', 0, '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');
    }).toThrow();
  });

  it('should allow inserting valid analysis_runs', () => {
    runStoreAuthorityMigrations(db);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `);
    
    for (let v = 2; v <= 5; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }
    
    runMissionDomainMigration(db);
    
    for (let v = 7; v <= 11; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    runAnalysisRunsMigration(db);

    // Create a store first
    db.prepare(`
      INSERT INTO stores (store_id, browser_profile_id, display_name, marketplace, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('store1', 'profile1', 'Test Store', 'US', '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');

    // Insert analysis run
    db.prepare(`
      INSERT INTO analysis_runs (
        run_id, store_id, report_snapshot_id, status, recommendations_count, 
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('run1', 'store1', 'snapshot1', 'pending', 0, '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');

    const run = db.prepare('SELECT * FROM analysis_runs WHERE run_id = ?').get('run1') as any;
    expect(run).toBeTruthy();
    expect(run.store_id).toBe('store1');
    expect(run.status).toBe('pending');
    expect(run.recommendations_count).toBe(0);
  });

  it('should enforce status CHECK constraint', () => {
    runStoreAuthorityMigrations(db);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `);
    
    for (let v = 2; v <= 5; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }
    
    runMissionDomainMigration(db);
    
    for (let v = 7; v <= 11; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    runAnalysisRunsMigration(db);

    db.prepare(`
      INSERT INTO stores (store_id, browser_profile_id, display_name, marketplace, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('store1', 'profile1', 'Test Store', 'US', '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');

    // Try invalid status
    expect(() => {
      db.prepare(`
        INSERT INTO analysis_runs (
          run_id, store_id, report_snapshot_id, status, recommendations_count,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('run1', 'store1', 'snapshot1', 'invalid_status', 0, '2026-09-03T00:00:00Z', '2026-09-03T00:00:00Z');
    }).toThrow();
  });

  it('should create indexes for efficient queries', () => {
    runStoreAuthorityMigrations(db);
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS lingxing_report_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(store_id)
      );
    `);
    
    for (let v = 2; v <= 5; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }
    
    runMissionDomainMigration(db);
    
    for (let v = 7; v <= 11; v++) {
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, status, started_at, applied_at, manifest_json, result_json)
        VALUES (?, ?, ?, 'applied', datetime('now'), datetime('now'), '{}', '{}')
      `).run(v, `migration-${v}`, `checksum-${v}`);
    }

    runAnalysisRunsMigration(db);

    const indexes = db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'analysis_runs'
    `).all() as Array<{ name: string }>;

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_analysis_runs_store_status');
    expect(indexNames).toContain('idx_analysis_runs_mission');
  });
});
