import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  OFFLINE_MIGRATION_USAGE,
  TARGET_VERSION,
  evaluateBusinessRowPreservation,
  executeOfflineMigration,
  executeLockedWorkingCopy,
  inspectOfflineMigration,
  loadLocalDbRuntime,
  main: migrationMain,
  parseOfflineMigrationArgs,
  requireSqlite,
  sha256File,
} = require('./migrate-current-user-db.js');
const {
  parseS7VerifierArgs,
  verifyS7MigrationBackupRestore,
} = require('./verify-s7-migration-backup-restore.js');
const { legacyV1Checksum } = require('./verify-production-authority-selection.js');

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('S7 offline migration and recovery verifier', () => {
  it('prints help successfully without validating paths or invoking migration operations', () => {
    const root = tempDirectory();
    const untouchedWorkDir = path.join(root, 'must-not-be-created');
    const parsed = parseOfflineMigrationArgs([
      'node',
      'script',
      '--db',
      path.join(root, 'missing.db'),
      '--expected-sha256',
      'not-a-hash',
      '--work-dir',
      untouchedWorkDir,
      '--execute',
      '--help',
    ]);
    expect(parsed).toEqual({
      db: '',
      expectedSha256: '',
      workDir: '',
      out: '',
      execute: false,
      help: true,
    });

    const output = [];
    const errors = [];
    const exitCode = migrationMain(
      [
        'node',
        'script',
        '--db',
        path.join(root, 'missing.db'),
        '--work-dir',
        untouchedWorkDir,
        '--execute',
        '--help',
      ],
      {
        log: (message) => output.push(message),
        error: (message) => errors.push(message),
      },
      {
        inspectOfflineMigration: () => {
          throw new Error('inspection must not run for --help');
        },
        executeOfflineMigration: () => {
          throw new Error('migration must not run for --help');
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output).toEqual([OFFLINE_MIGRATION_USAGE]);
    expect(errors).toEqual([]);
    expect(OFFLINE_MIGRATION_USAGE).toContain('--expected-sha256 <hash>');
    expect(OFFLINE_MIGRATION_USAGE).toContain('never overwrite the source');
    expect(fs.existsSync(untouchedWorkDir)).toBe(false);
  });

  it('keeps missing required arguments fail-closed through the main entry contract', () => {
    const output = [];
    const errors = [];
    const exitCode = migrationMain(
      ['node', 'script'],
      {
        log: (message) => output.push(message),
        error: (message) => errors.push(message),
      },
    );

    expect(exitCode).toBe(1);
    expect(output).toEqual([]);
    expect(errors).toEqual([
      '[S7 OFFLINE MIGRATION BLOCKED] --db is required; automatic AppData discovery is disabled.',
    ]);
  });

  it('requires explicit absolute source, SHA, and isolated work directory', () => {
    expect(() => parseOfflineMigrationArgs(['node', 'script'])).toThrow(/--db is required/i);
    expect(() => parseOfflineMigrationArgs([
      'node', 'script', '--db', 'relative.db', '--expected-sha256', 'a'.repeat(64),
      '--work-dir', 'relative-work',
    ])).toThrow(/absolute path/i);
    expect(() => parseS7VerifierArgs(['node', 'script', '--manifest', 'relative.json']))
      .toThrow(/absolute path/i);
  });

  it('fails closed before copying when a WAL appears after inspection returns', () => {
    const root = tempDirectory();
    const sourceDirectory = path.join(root, 'source');
    const workDir = path.join(root, 'work');
    fs.mkdirSync(sourceDirectory);
    const sourcePath = path.join(sourceDirectory, 'amazon-ai-ops.db');
    createV7Source(sourcePath);
    const sourceSha256 = sha256File(sourcePath);
    const manifestPath = path.join(workDir, 'offline-upgrade-evidence.json');

    expect(() => executeOfflineMigration(
      {
        db: sourcePath,
        expectedSha256: sourceSha256,
        workDir,
        out: manifestPath,
        execute: true,
      },
      {
        afterInspection() {
          fs.writeFileSync(`${sourcePath}-wal`, 'application restarted');
        },
      },
    )).toThrow(/not offline/i);

    expect(sha256File(sourcePath)).toBe(sourceSha256);
    expect(fs.existsSync(workDir)).toBe(false);
    expect(fs.existsSync(manifestPath)).toBe(false);
  }, 30_000);

  it('rejects a mutated Node migration plan targetVersion before creating any work artifact', () => {
    const value = offlineMigrationFixture();

    expect(() => executeOfflineMigration(value.args, {
      afterInspection(plan) {
        plan.targetVersion = TARGET_VERSION - 1;
      },
    })).toThrow(new RegExp(`targetVersion must be exactly ${TARGET_VERSION}`));

    expect(sha256File(value.sourcePath)).toBe(value.sourceSha256);
    expect(fs.existsSync(value.workDir)).toBe(false);
    expect(fs.existsSync(value.manifestPath)).toBe(false);
  }, 30_000);

  it('rejects a wrong locked-worker targetVersion before touching any supplied path', () => {
    const root = tempDirectory();
    expect(() => executeLockedWorkingCopy(
      {
        targetVersion: TARGET_VERSION - 1,
        workingDatabasePath: path.join(root, 'missing-working.db'),
        restoreDatabasePath: path.join(root, 'must-not-exist-restore.db'),
      },
      path.join(root, 'must-not-exist-manifest.tmp'),
      path.join(root, 'missing-lease.json'),
    )).toThrow(new RegExp(`targetVersion must be exactly ${TARGET_VERSION}`));
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it.each([10, 10.9, 11.1])(
    'rejects PowerShell lease targetVersion %s with zero helper residue',
    (targetVersion) => {
    if (process.platform !== 'win32') return;
    const root = tempDirectory();
    const requestPath = path.join(root, 'wrong-target-request.json');
    fs.writeFileSync(requestPath, JSON.stringify({
      kind: 's7-offline-migration-lease-request',
      schemaVersion: 1,
      plan: { targetVersion },
    }));
    const helper = path.resolve('scripts/run-s7-offline-migration-lease.ps1');
    const powershell = process.env.SystemRoot
      ? path.join(
        process.env.SystemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
      : 'powershell.exe';

    const result = spawnSync(powershell, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helper,
      '-RequestPath',
      requestPath,
    ], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`)
      .toMatch(new RegExp(`targetVersion must be exactly ${TARGET_VERSION}`));
    expect(fs.readdirSync(root)).toEqual(['wrong-target-request.json']);
    },
    30_000,
  );

  it('fails closed when another database handle prevents the Windows offline lease', () => {
    const value = offlineMigrationFixture();
    const blocker = fs.openSync(value.sourcePath, 'r');
    try {
      expect(() => executeOfflineMigration(value.args))
        .toThrow(/Windows offline lease blocked/i);
    } finally {
      fs.closeSync(blocker);
    }

    expect(sha256File(value.sourcePath)).toBe(value.sourceSha256);
    expect(fs.existsSync(value.manifestPath)).toBe(false);
    expect(fs.existsSync(value.workDir)).toBe(true);
    expect(fs.readdirSync(value.workDir)).toEqual([]);
  }, 30_000);

  it.each([
    ['after-working-copy-wal', /not offline/i],
    ['before-publish-wal', /not offline/i],
    ['before-publish-failure', /injected failure/i],
  ])('keeps final evidence absent for the %s lease fault', (faultMode, message) => {
    const value = offlineMigrationFixture();

    expect(() => executeOfflineMigration(value.args, { faultMode })).toThrow(message);

    expect(sha256File(value.sourcePath)).toBe(value.sourceSha256);
    expect(fs.readdirSync(value.sourceDirectory).sort()).toEqual(value.sourceDirectoryEntries);
    expect(fs.existsSync(value.manifestPath)).toBe(false);
    expect(fs.existsSync(value.workDir)).toBe(true);
    expect(fs.readdirSync(value.workDir)).toEqual([]);
  }, 30_000);

  it('preserves a final-path collision and never replaces it with success evidence', () => {
    const value = offlineMigrationFixture();

    expect(() => executeOfflineMigration(value.args, { faultMode: 'publish-conflict' }))
      .toThrow(/already exists/i);

    expect(sha256File(value.sourcePath)).toBe(value.sourceSha256);
    expect(fs.readFileSync(value.manifestPath, 'utf8')).toBe('preexisting evidence');
    expect(fs.readdirSync(value.workDir)).toEqual(['offline-upgrade-evidence.json']);
  }, 30_000);

  it('upgrades only a bound v7 copy and independently verifies its pre-v11 restore', () => {
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
      targetVersion: TARGET_VERSION,
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
      targetVersion: TARGET_VERSION,
      preservationFailures: [],
      recoveryPreflight: { canRestore: true, sourceVersion: 7, targetVersion: TARGET_VERSION },
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

    const pristineWorkingDatabase = fs.readFileSync(evidence.workingDatabase.path);
    const pristineManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const resetArtifacts = () => {
      fs.writeFileSync(evidence.workingDatabase.path, pristineWorkingDatabase);
      fs.writeFileSync(manifestPath, `${JSON.stringify(pristineManifest, null, 2)}\n`);
    };
    const rewriteManifestForCurrentWorkingCopy = (mutate) => {
      const manifest = structuredClone(pristineManifest);
      mutate?.(manifest);
      manifest.workingDatabase.upgradedSha256 = sha256File(evidence.workingDatabase.path);
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    };

    const tamperedLedger = new (requireSqlite())(evidence.workingDatabase.path);
    try {
      tamperedLedger.prepare(`
        UPDATE schema_migrations SET checksum = 'tampered-v11-checksum' WHERE version = ?
      `).run(TARGET_VERSION);
    } finally {
      tamperedLedger.close();
    }
    rewriteManifestForCurrentWorkingCopy();
    expect(verifyS7MigrationBackupRestore(manifestPath).checks).toContainEqual(
      expect.objectContaining({ code: 'MIGRATIONS_1_TO_9_APPLIED', passed: false }),
    );

    resetArtifacts();
    const extraLedger = new (requireSqlite())(evidence.workingDatabase.path);
    try {
      extraLedger.exec(`
        INSERT INTO schema_migrations (
          version, name, checksum, status, started_at, applied_at,
          error_message, manifest_json, result_json
        )
        SELECT 12, 'unexpected-v12', 'unexpected-v12', 'applied', started_at, applied_at,
          NULL, '{}', '{}'
        FROM schema_migrations WHERE version = 11
      `);
    } finally {
      extraLedger.close();
    }
    rewriteManifestForCurrentWorkingCopy();
    expect(verifyS7MigrationBackupRestore(manifestPath).checks).toContainEqual(
      expect.objectContaining({ code: 'MIGRATIONS_1_TO_9_APPLIED', passed: false }),
    );

    resetArtifacts();
    const missingV11Trigger = new (requireSqlite())(evidence.workingDatabase.path);
    try {
      missingV11Trigger.exec(
        'DROP TRIGGER trg_store_connections_external_identity_insert',
      );
    } finally {
      missingV11Trigger.close();
    }
    rewriteManifestForCurrentWorkingCopy();
    expect(verifyS7MigrationBackupRestore(manifestPath).checks).toContainEqual(
      expect.objectContaining({ code: 'MIGRATIONS_1_TO_9_APPLIED', passed: false }),
    );

    resetArtifacts();
    const legacyV1Database = new (requireSqlite())(evidence.workingDatabase.path);
    try {
      legacyV1Database.prepare(`
        UPDATE schema_migrations SET checksum = ? WHERE version = 1
      `).run(legacyV1Checksum());
    } finally {
      legacyV1Database.close();
    }
    rewriteManifestForCurrentWorkingCopy((manifest) => {
      manifest.migrations[0].checksum = legacyV1Checksum();
    });
    expect(verifyS7MigrationBackupRestore(manifestPath).passed).toBe(true);

    resetArtifacts();
    const mismatchedLegacyV1Database = new (requireSqlite())(evidence.workingDatabase.path);
    try {
      mismatchedLegacyV1Database.prepare(`
        UPDATE schema_migrations SET checksum = ? WHERE version = 1
      `).run(legacyV1Checksum());
    } finally {
      mismatchedLegacyV1Database.close();
    }
    rewriteManifestForCurrentWorkingCopy();
    expect(verifyS7MigrationBackupRestore(manifestPath).checks).toContainEqual(
      expect.objectContaining({ code: 'EVIDENCE_MIGRATION_RECORDS_BOUND', passed: false }),
    );

    resetArtifacts();
    rewriteManifestForCurrentWorkingCopy((manifest) => {
      manifest.migrations[TARGET_VERSION - 1].name = 'tampered-v11-name';
    });
    expect(verifyS7MigrationBackupRestore(manifestPath).checks).toContainEqual(
      expect.objectContaining({ code: 'EVIDENCE_MIGRATION_RECORDS_BOUND', passed: false }),
    );

    resetArtifacts();
    rewriteManifestForCurrentWorkingCopy((manifest) => {
      manifest.migrations.push({
        version: 12,
        name: 'unexpected-v12',
        checksum: 'unexpected-v12',
        status: 'applied',
      });
    });
    expect(verifyS7MigrationBackupRestore(manifestPath).checks).toContainEqual(
      expect.objectContaining({ code: 'EVIDENCE_MIGRATION_RECORDS_BOUND', passed: false }),
    );

    resetArtifacts();

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
    const postV7Tables = [
      'lingxing_collection_resume_events',
      'lingxing_collection_resume_active_claims',
      'lingxing_collection_resume_attempts',
      'report_import_metric_evidence',
      'ad_execution_domain_reconciliations',
      'ad_execution_evidence',
      'ad_execution_events',
      'ad_execution_jobs',
      'ad_execution_batches',
      'ad_keyword_alias_resolutions',
      'ad_keyword_identity_versions',
    ];
    for (const trigger of [
      'trg_stores_v1_authority_insert',
      'trg_stores_v1_authority_update',
      'trg_store_connections_external_identity_insert',
      'trg_store_connections_external_identity_update',
      'trg_store_connections_collection_store_name_insert',
      'trg_store_connections_collection_store_name_update',
    ]) {
      database.exec(`DROP TRIGGER IF EXISTS "${trigger}"`);
    }
    database.exec('DROP INDEX IF EXISTS idx_store_connections_provider_external_identity_unique');
    database.prepare(`
      UPDATE store_connections
      SET external_account_id = collection_store_name
      WHERE provider = 'lingxing' AND collection_store_name IS NOT NULL
    `).run();
    for (const column of [
      'normalized_collection_store_name',
      'collection_store_name',
      'normalized_external_account_id',
    ]) {
      database.exec(`ALTER TABLE store_connections DROP COLUMN "${column}"`);
    }
    for (const table of postV7Tables) database.exec(`DROP TABLE IF EXISTS "${table}"`);
    database.prepare('DELETE FROM schema_migrations WHERE version >= 8').run();
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('s7-script-sentinel', 'preserve-me', '2026-07-23T00:00:00.000Z')
    `).run();
    database.pragma('foreign_keys = ON');
  } finally {
    database.close();
  }
  for (const suffix of [
    `.pre-upgrade-to-v${TARGET_VERSION}.bak`,
    `.pre-upgrade-to-v${TARGET_VERSION}.manifest.json`,
  ]) {
    fs.rmSync(`${databasePath}${suffix}`, { force: true });
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

function offlineMigrationFixture() {
  const root = tempDirectory();
  const sourceDirectory = path.join(root, 'source');
  const workDir = path.join(root, 'work');
  fs.mkdirSync(sourceDirectory);
  const sourcePath = path.join(sourceDirectory, 'amazon-ai-ops.db');
  createV7Source(sourcePath);
  const sourceSha256 = sha256File(sourcePath);
  const manifestPath = path.join(workDir, 'offline-upgrade-evidence.json');
  return {
    args: {
      db: sourcePath,
      expectedSha256: sourceSha256,
      workDir,
      out: manifestPath,
      execute: true,
    },
    manifestPath,
    sourceDirectory,
    sourceDirectoryEntries: fs.readdirSync(sourceDirectory).sort(),
    sourcePath,
    sourceSha256,
    workDir,
  };
}

function listInspectionDirectories() {
  const prefix = `amazon-ai-ops-s7-inspection-${process.pid}-`;
  return fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith(prefix)).sort();
}
