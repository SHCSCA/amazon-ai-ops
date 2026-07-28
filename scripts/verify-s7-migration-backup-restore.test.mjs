import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  evaluateBusinessRowPreservation,
  executeOfflineMigration,
  inspectOfflineMigration,
  loadLocalDbRuntime,
  parseOfflineMigrationArgs,
  requireSqlite,
  sha256File,
} = require('./migrate-current-user-db.js');
const {
  parseS7VerifierArgs,
  verifyS7MigrationBackupRestore,
} = require('./verify-s7-migration-backup-restore.js');

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('S7 offline migration and recovery verifier', () => {
  it('requires explicit absolute source, SHA, and isolated work directory', () => {
    expect(() => parseOfflineMigrationArgs(['node', 'script'])).toThrow(/--db is required/i);
    expect(() => parseOfflineMigrationArgs([
      'node', 'script', '--db', 'relative.db', '--expected-sha256', 'a'.repeat(64),
      '--work-dir', 'relative-work',
    ])).toThrow(/absolute path/i);
    expect(() => parseS7VerifierArgs(['node', 'script', '--manifest', 'relative.json']))
      .toThrow(/absolute path/i);
  });

  it('upgrades only a bound v7 copy and independently verifies its pre-v9 restore', () => {
    const root = tempDirectory();
    const sourceDirectory = path.join(root, 'source');
    const workDir = path.join(root, 'work');
    fs.mkdirSync(sourceDirectory);
    const sourcePath = path.join(sourceDirectory, 'amazon-ai-ops.db');
    createV7Source(sourcePath);
    const sourceSha256 = sha256File(sourcePath);
    const sourceDirectoryEntries = fs.readdirSync(sourceDirectory).sort();
    const inspectionDirectories = listInspectionDirectories();
    const manifestPath = path.join(workDir, 'offline-upgrade-evidence.json');

    const plan = inspectOfflineMigration({
      db: sourcePath,
      expectedSha256: sourceSha256,
      workDir,
      out: manifestPath,
      execute: false,
    });
    expect(plan).toMatchObject({
      kind: 's7-offline-db-upgrade-plan',
      mode: 'dry-run',
      source: { version: 7, sha256: sourceSha256 },
      targetVersion: 9,
    });
    expect(sha256File(sourcePath)).toBe(sourceSha256);
    expect(fs.readdirSync(sourceDirectory).sort()).toEqual(sourceDirectoryEntries);
    expect(listInspectionDirectories()).toEqual(inspectionDirectories);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      expect(fs.existsSync(`${sourcePath}${suffix}`)).toBe(false);
    }

    const evidence = executeOfflineMigration({
      db: sourcePath,
      expectedSha256: sourceSha256,
      workDir,
      out: manifestPath,
      execute: true,
    });
    expect(evidence).toMatchObject({
      kind: 's7-offline-db-upgrade',
      passed: true,
      source: { version: 7, sha256: sourceSha256 },
      targetVersion: 9,
      preservationFailures: [],
      recoveryPreflight: { canRestore: true, sourceVersion: 7, targetVersion: 9 },
      restore: { version: 7, integrityCheck: 'ok' },
    });
    expect(sha256File(sourcePath)).toBe(sourceSha256);
    expect(fs.readdirSync(sourceDirectory).sort()).toEqual(sourceDirectoryEntries);
    expect(listInspectionDirectories()).toEqual(inspectionDirectories);
    expect(fs.existsSync(manifestPath)).toBe(true);

    const verification = verifyS7MigrationBackupRestore(manifestPath);
    expect(verification.passed).toBe(true);
    expect(verification.summary.failed).toBe(0);
    expect(verification.checks.map((check) => check.code)).toContain('MIGRATIONS_1_TO_9_APPLIED');

    fs.appendFileSync(evidence.restore.destinationPath, 'tampered');
    const tampered = verifyS7MigrationBackupRestore(manifestPath);
    expect(tampered.passed).toBe(false);
    expect(tampered.checks).toContainEqual(expect.objectContaining({
      code: 'RESTORED_COPY_HASH_MATCH',
      passed: false,
    }));
  }, 30_000);

  it('proves migration 4 duplicate Listing compaction as an exact current-to-history transfer', () => {
    const root = tempDirectory();
    const sourceDirectory = path.join(root, 'source');
    const workDir = path.join(root, 'work');
    fs.mkdirSync(sourceDirectory);
    const sourcePath = path.join(sourceDirectory, 'amazon-ai-ops.db');
    createV3SourceWithDuplicateListings(sourcePath);
    const sourceSha256 = sha256File(sourcePath);
    const manifestPath = path.join(workDir, 'offline-upgrade-evidence.json');

    const evidence = executeOfflineMigration({
      db: sourcePath,
      expectedSha256: sourceSha256,
      workDir,
      out: manifestPath,
      execute: true,
    });

    expect(evidence.preservationFailures).toEqual([]);
    expect(evidence.businessRowPreservation).toMatchObject({
      passed: true,
      listingCurrentToHistoryTransfer: {
        applied: true,
        passed: true,
        sourceCurrentRows: 3,
        upgradedCurrentRows: 1,
        currentRowsMoved: 2,
        sourceHistoryRows: 0,
        upgradedHistoryRows: 2,
        historyRowsAdded: 2,
        sourceMigration4MergedDuplicateRows: 0,
        upgradedMigration4MergedDuplicateRows: 2,
        migration4MergedDuplicateRowsAdded: 2,
        sourceResolvedMergeRecords: 0,
        upgradedResolvedMergeRecords: 2,
        resolvedMergeRecordsAdded: 2,
      },
    });

    const verification = verifyS7MigrationBackupRestore(manifestPath);
    expect(verification.passed).toBe(true);
    expect(verification.checks).toContainEqual(expect.objectContaining({
      code: 'BUSINESS_ROW_TRANSFER_PROOF_BOUND',
      passed: true,
    }));
  }, 30_000);

  it('fails closed when a Listing row reduction has no exact migration transfer proof', () => {
    const Database = requireSqlite();
    const database = new Database(':memory:');
    try {
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          status TEXT NOT NULL,
          result_json TEXT NOT NULL
        );
        CREATE TABLE store_migration_quarantine (
          migration_version INTEGER NOT NULL,
          source_table TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL
        );
        INSERT INTO schema_migrations (version, status, result_json)
        VALUES (4, 'applied', '{"mergedDuplicateRows":0}');
      `);
      const result = evaluateBusinessRowPreservation(
        database,
        { listing_content: 3, listing_content_versions: 0 },
        { listing_content: 2, listing_content_versions: 0 },
        { migration4MergedDuplicateRows: 0, resolvedMergeRecords: 0 },
      );
      expect(result).toMatchObject({
        passed: false,
        failures: [{ table: 'listing_content', before: 3, after: 2 }],
        listingCurrentToHistoryTransfer: {
          applied: true,
          passed: false,
          currentRowsMoved: 1,
          historyRowsAdded: 0,
          migration4MergedDuplicateRowsAdded: 0,
          resolvedMergeRecordsAdded: 0,
        },
      });
    } finally {
      database.close();
    }
  });

  it('compares migration 4 merge evidence against the bound source baseline', () => {
    const Database = requireSqlite();
    const database = new Database(':memory:');
    try {
      database.exec(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          status TEXT NOT NULL,
          result_json TEXT NOT NULL
        );
        CREATE TABLE store_migration_quarantine (
          migration_version INTEGER NOT NULL,
          source_table TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL
        );
        INSERT INTO schema_migrations (version, status, result_json)
        VALUES (4, 'applied', '{"mergedDuplicateRows":6}');
        INSERT INTO store_migration_quarantine
          (migration_version, source_table, reason, status)
        VALUES
          (4, 'listing_content', 'duplicate_normalized_asin_merged', 'resolved'),
          (4, 'listing_content', 'duplicate_normalized_asin_merged', 'resolved'),
          (4, 'listing_content', 'duplicate_normalized_asin_merged', 'resolved'),
          (4, 'listing_content', 'duplicate_normalized_asin_merged', 'resolved'),
          (4, 'listing_content', 'duplicate_normalized_asin_merged', 'resolved'),
          (4, 'listing_content', 'duplicate_normalized_asin_merged', 'resolved');
      `);
      const result = evaluateBusinessRowPreservation(
        database,
        { listing_content: 3, listing_content_versions: 4 },
        { listing_content: 2, listing_content_versions: 5 },
        { migration4MergedDuplicateRows: 5, resolvedMergeRecords: 5 },
      );
      expect(result).toMatchObject({
        passed: true,
        failures: [],
        listingCurrentToHistoryTransfer: {
          applied: true,
          passed: true,
          currentRowsMoved: 1,
          historyRowsAdded: 1,
          migration4MergedDuplicateRowsAdded: 1,
          resolvedMergeRecordsAdded: 1,
        },
      });
    } finally {
      database.close();
    }
  });
});

function createV7Source(databasePath) {
  const runtime = loadLocalDbRuntime();
  const database = runtime.initSqlite(databasePath);
  try {
    database.pragma('foreign_keys = OFF');
    const executionTables = [
      'ad_execution_domain_reconciliations',
      'ad_execution_evidence',
      'ad_execution_events',
      'ad_execution_jobs',
      'ad_execution_batches',
      'ad_keyword_alias_resolutions',
      'ad_keyword_identity_versions',
    ];
    for (const table of executionTables) database.exec(`DROP TABLE IF EXISTS "${table}"`);
    database.prepare('DELETE FROM schema_migrations WHERE version IN (8, 9)').run();
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('s7-script-sentinel', 'preserve-me', '2026-07-23T00:00:00.000Z')
    `).run();
    database.pragma('foreign_keys = ON');
  } finally {
    database.close();
  }
}

function createV3SourceWithDuplicateListings(databasePath) {
  const runtime = loadLocalDbRuntime();
  const database = runtime.initSqlite(databasePath);
  try {
    database.exec(`
      DELETE FROM listing_content_versions;
      DELETE FROM listing_content;
      DELETE FROM store_migration_quarantine;
      DELETE FROM stores;
      DROP INDEX IF EXISTS idx_listing_content_unique_store_asin;
    `);
    database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name,
        status, business_timezone, created_at, updated_at
      ) VALUES (
        'listing-transfer-store', 'listing-transfer-profile', 'US', 'USD',
        'Listing Transfer Store', 'active', 'America/Los_Angeles',
        '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z'
      )
    `).run();
    const insert = database.prepare(`
      INSERT INTO listing_content (
        store_id, asin, store_name, marketplace_code, title, updated_at
      ) VALUES (
        'listing-transfer-store', ?, 'Listing Transfer Store', 'US', ?, ?
      )
    `);
    insert.run(' b0duplicate ', 'oldest', '2026-07-21T00:00:00.000Z');
    insert.run('B0DUPLICATE', 'middle', '2026-07-22T00:00:00.000Z');
    insert.run('B0duplicate', 'keeper', '2026-07-23T00:00:00.000Z');
    database.prepare('DELETE FROM schema_migrations WHERE version >= 4').run();
  } finally {
    database.close();
  }
}

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-s7-script-'));
  tempDirectories.push(directory);
  return directory;
}

function listInspectionDirectories() {
  const prefix = `amazon-ai-ops-s7-inspection-${process.pid}-`;
  return fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(prefix)).sort();
}
