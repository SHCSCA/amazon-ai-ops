import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  LIVE_MIGRATION_ACCEPTANCE_USAGE,
  REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES,
  legacyV1Checksum,
  parseLiveMigrationAcceptanceArgs,
  readJsonArtifact,
  removeCaptureRoot,
  run,
} = require('./verify-s7-live-migration-acceptance.js');
const {
  collectRowCounts,
  evaluateBusinessRowPreservation,
  loadLocalDbRuntime,
  requireSqlite,
  sha256File,
} = require('./migrate-current-user-db.js');
const {
  runReadonlySqliteOnlineBackupSync,
} = require('./sqlite-authority-currentness.js');
const {
  verifyS7MigrationBackupRestore,
} = require('./verify-s7-migration-backup-restore.js');

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('S7 live migration acceptance receipt CLI', () => {
  it('prints help without validating paths or creating files', async () => {
    const root = tempDirectory();
    const outputPath = path.join(root, 'must-not-exist.json');
    const stdout = [];
    const result = await run([
      '--db', 'relative.db',
      '--authority-selection', 'relative-selection.json',
      '--migration-manifest', 'relative-manifest.json',
      '--migration-verification', 'relative-verification.json',
      '--out', outputPath,
      '--help',
    ], {
      writeStdout: (value) => stdout.push(value),
    });

    expect(result).toEqual({ exitCode: 0, receipt: null, outputPath: null });
    expect(stdout).toEqual([`${LIVE_MIGRATION_ACCEPTANCE_USAGE}\n`]);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it('requires every formal input as an absolute path', () => {
    expect(() => parseLiveMigrationAcceptanceArgs([])).toThrow(/--db is required/i);
    expect(() => parseLiveMigrationAcceptanceArgs([
      '--db', 'relative.db',
      '--authority-selection', 'selection.json',
      '--migration-manifest', 'manifest.json',
      '--migration-verification', 'verification.json',
      '--out', 'receipt.json',
    ])).toThrow(/--db must be a clean absolute path/i);
  });

  it('publishes a bound read-only acceptance receipt for a migrated live fixture', async () => {
    const value = acceptanceFixture();
    const stdout = [];
    const result = await run(cliArgs(value), {
      tempRoot: value.captureParent,
      writeStdout: (text) => stdout.push(text),
    });

    expect(result.exitCode).toBe(0);
    expect(result.outputPath).toBe(value.outPath);
    expect(result.receipt).toMatchObject({
      kind: 's7-live-migration-acceptance',
      schemaVersion: 's7-live-migration-acceptance/v1',
      status: 'PASSED',
      passed: true,
      authorityDatabaseMutated: false,
      adsExecutionInvoked: false,
      inputs: {
        database: {
          path: value.dbPath,
          realPath: value.dbPath,
        },
      },
      summary: {
        failed: 0,
        integrityCheck: 'ok',
        foreignKeyViolationCount: 0,
        migrationCount: 9,
        businessRowPreservation: {
          passed: true,
          failureCount: 0,
        },
        recovery: {
          sourceVersion: 7,
          targetVersion: 9,
          backupIntegrityCheck: 'ok',
          schemaFingerprintMatches: true,
          tableRowCountsMatch: true,
          embeddedManifestMatchesAdjacentFile: true,
          canRestore: true,
          blockerCount: 0,
        },
      },
      safety: {
        liveDatabaseAccess: 'readonly-sqlite-online-backup',
        liveDatabaseOpenedReadOnly: true,
        liveDatabaseQueryOnly: true,
        authorityDatabaseMutated: false,
        adsExecutionInvoked: false,
        businessRowContentIncluded: false,
        rawSecretsIncluded: false,
      },
    });
    expect(result.receipt.inputs.database.logicalSnapshotSha256)
      .toMatch(/^[A-F0-9]{64}$/);
    expect(result.receipt.checks.length).toBeGreaterThanOrEqual(20);
    expect(result.receipt.checks.every((check) => check.passed)).toBe(true);
    expect(JSON.parse(fs.readFileSync(value.outPath, 'utf8'))).toEqual(result.receipt);
    expect(stdout).toHaveLength(1);
    expect(captureDirectories(value.captureParent)).toEqual([]);
  }, 30_000);

  it.each([
    ['selected path', (value, selection) => {
      selection.selection.selected.realPath = path.join(value.root, 'other-authority.db');
    }, /AUTHORITY_SELECTION_PATH_BOUND/],
    ['selection status', (_value, selection) => {
      selection.status = 'SELECTED_SCHEMA_READY';
    }, /AUTHORITY_SELECTION_PRE_MIGRATION_STATE/],
    ['pre-migration SHA', (_value, selection) => {
      selection.selection.selected.mainFileSha256 = '0'.repeat(64);
    }, /PRE_MIGRATION_MAIN_SHA_BOUND/],
  ])('fails closed when the %s is not bound', async (_label, mutate, message) => {
    const value = acceptanceFixture();
    const selection = readJson(value.authoritySelectionPath);
    mutate(value, selection);
    writeJson(value.authoritySelectionPath, selection);

    await expect(run(cliArgs(value), quietContext(value))).rejects.toThrow(message);
    expect(fs.existsSync(value.outPath)).toBe(false);
    expect(captureDirectories(value.captureParent)).toEqual([]);
  }, 30_000);

  it('rejects an offline source path that is not the canonical live database', async () => {
    const value = acceptanceFixture();
    const manifest = readJson(value.migrationManifestPath);
    manifest.source.path = path.join(value.root, 'other-authority.db');
    writeJson(value.migrationManifestPath, manifest);
    refreshMigrationVerification(value);

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/OFFLINE_MIGRATION_SOURCE_PATH_BOUND/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it('rejects migration verification whose source manifest hash is not exact', async () => {
    const value = acceptanceFixture();
    const verification = readJson(value.migrationVerificationPath);
    verification.sourceManifestSha256 = 'F'.repeat(64);
    writeJson(value.migrationVerificationPath, verification);

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/MIGRATION_VERIFICATION_MANIFEST_BOUND/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it.each([
    ['missing migration 9', (database) => {
      database.prepare('DELETE FROM schema_migrations WHERE version = 9').run();
    }],
    ['old migration 9 checksum', (database) => {
      database.prepare(`
        UPDATE schema_migrations
        SET checksum = 'store-authority-quarantine-repair-v9-old'
        WHERE version = 9
      `).run();
    }],
  ])('rejects a live database with %s', async (_label, mutate) => {
    const value = acceptanceFixture();
    mutateLiveDatabase(value.dbPath, mutate);

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/LIVE_MIGRATIONS_1_TO_9_CURRENT/);
    expect(fs.existsSync(value.outPath)).toBe(false);
    expect(captureDirectories(value.captureParent)).toEqual([]);
  }, 30_000);

  it('rejects a migrated live database that lost a pre-migration business row', async () => {
    const value = acceptanceFixture();
    mutateLiveDatabase(value.dbPath, (database) => {
      database.prepare(`
        DELETE FROM app_settings
        WHERE key = 's7-live-acceptance-sentinel'
      `).run();
    });

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/LIVE_BUSINESS_ROWS_PRESERVED/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it('rejects a migration 9 backup path that is not the fixed adjacent live path', async () => {
    const value = acceptanceFixture();
    mutateMigration9Manifest(value.dbPath, (upgradeBackup) => {
      upgradeBackup.backupPath = path.join(value.root, 'detached-backup.bak');
    });

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/LIVE_V9_UPGRADE_BACKUP_PATHS_BOUND/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it('rejects a migration 9 backup whose file hash was tampered', async () => {
    const value = acceptanceFixture();
    const backupPath = `${value.dbPath}.pre-upgrade-to-v9.bak`;
    fs.appendFileSync(backupPath, Buffer.from('tampered-backup'));

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/LIVE_V9_RECOVERY_PREFLIGHT_CAN_RESTORE/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it('captures uncheckpointed WAL state read-only while leaving the live main file unchanged', async () => {
    const value = acceptanceFixture();
    const Database = requireSqlite();
    const writer = new Database(value.dbPath);
    try {
      writer.pragma('journal_mode = WAL');
      writer.pragma('wal_autocheckpoint = 0');
      const mainShaBeforeWalWrite = sha256File(value.dbPath);
      writer.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('wal-only-live-row', 'visible-through-online-backup', ?)
      `).run('2026-07-29T02:00:00.000Z');
      expect(sha256File(value.dbPath)).toBe(mainShaBeforeWalWrite);

      const result = await run(cliArgs(value), quietContext(value));

      expect(result.receipt.passed).toBe(true);
      expect(result.receipt.inputs.database.sha256.toLowerCase()).toBe(mainShaBeforeWalWrite);
      expect(result.receipt.inputs.database.logicalSnapshotSha256.toLowerCase())
        .not.toBe(mainShaBeforeWalWrite);
      expect(sha256File(value.dbPath)).toBe(mainShaBeforeWalWrite);
      expect(result.receipt.checks).toContainEqual(expect.objectContaining({
        code: 'LIVE_WAL_AWARE_READONLY_BACKUP',
        passed: true,
      }));
    } finally {
      writer.close();
    }
  }, 30_000);

  it('never overwrites a pre-existing output or starts a live capture', async () => {
    const value = acceptanceFixture();
    fs.writeFileSync(value.outPath, 'pre-existing receipt', 'utf8');

    await expect(run(cliArgs(value), quietContext(value))).rejects.toThrow(/already exists/i);
    expect(fs.readFileSync(value.outPath, 'utf8')).toBe('pre-existing receipt');
    expect(captureDirectories(value.captureParent)).toEqual([]);
  }, 30_000);

  it('hashes and parses the same stable JSON bytes and rejects a replaced path', () => {
    const root = tempDirectory();
    const inputPath = path.join(root, 'input.json');
    const movedPath = path.join(root, 'moved.json');
    writeJson(inputPath, { identity: 'original' });

    expect(() => readJsonArtifact(inputPath, 'TOCTOU fixture', {
      afterRead() {
        fs.renameSync(inputPath, movedPath);
        writeJson(inputPath, { identity: 'replacement' });
      },
    })).toThrow(/changed while its bytes were being read|path was replaced/i);
  });

  it.each([
    ['missing required check', (verification) => {
      verification.checks.pop();
      verification.summary.total -= 1;
      verification.summary.passed -= 1;
    }],
    ['duplicate check code', (verification) => {
      verification.checks.at(-1).code = verification.checks[0].code;
    }],
    ['fixture-only forged success', (verification) => {
      verification.checks = [{ code: 'FIXTURE_OFFLINE_MIGRATION_VERIFIED', passed: true }];
      verification.summary = { total: 1, passed: 1, failed: 0 };
    }],
  ])('rejects migration verification with %s', async (_label, mutate) => {
    const value = acceptanceFixture();
    const verification = readJson(value.migrationVerificationPath);
    mutate(verification);
    writeJson(value.migrationVerificationPath, verification);

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/MIGRATION_VERIFICATION_SCHEMA_PASSED/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it('rejects an offline manifest without the durable Windows lease contract', async () => {
    const value = acceptanceFixture();
    const manifest = readJson(value.migrationManifestPath);
    manifest.offlineLease.lockHeldThroughFinalPublish = false;
    writeJson(value.migrationManifestPath, manifest);
    refreshMigrationVerification(value);

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/OFFLINE_MIGRATION_LEASE_BOUND/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it.each([
    ['missing working database', (value) => fs.unlinkSync(value.workingDatabasePath)],
    ['missing restored database', (value) => fs.unlinkSync(value.restoreDatabasePath)],
    ['tampered working database hash', (value) => {
      fs.appendFileSync(value.workingDatabasePath, Buffer.from('tampered-working'));
    }],
    ['tampered restored database hash', (value) => {
      fs.appendFileSync(value.restoreDatabasePath, Buffer.from('tampered-restore'));
    }],
  ])('independently rejects a %s', async (_label, mutate) => {
    const value = acceptanceFixture();
    mutate(value);

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/offline|working|restore|hash/i);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it('rejects an adjacent final upgrade manifest marked reused', async () => {
    const value = acceptanceFixture();
    const adjacentManifestPath =
      `${value.dbPath}.pre-upgrade-to-v9.manifest.json`;
    const adjacent = readJson(adjacentManifestPath);
    adjacent.status = 'reused';
    writeJson(adjacentManifestPath, adjacent);

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/LIVE_V9_UPGRADE_BACKUP_MANIFEST_MATCH/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it('accepts reused embedded upgrade metadata when the adjacent final manifest is created', async () => {
    const value = acceptanceFixture();
    mutateMigration9Manifest(value.dbPath, (upgradeBackup) => {
      upgradeBackup.status = 'reused';
    });

    const result = await run(cliArgs(value), quietContext(value));
    expect(result.receipt.passed).toBe(true);
  }, 30_000);

  it('rejects a working database path replaced after its initial hash', async () => {
    const value = acceptanceFixture();
    const movedPath = `${value.workingDatabasePath}.moved`;
    let hookCalled = false;

    await expect(run(cliArgs(value), {
      ...quietContext(value),
      afterOfflineWorkingArtifactHash() {
        hookCalled = true;
        fs.renameSync(value.workingDatabasePath, movedPath);
        fs.copyFileSync(movedPath, value.workingDatabasePath, fs.constants.COPYFILE_EXCL);
      },
    })).rejects.toThrow(/identity|replaced|changed|sidecar/i);
    expect(hookCalled).toBe(true);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it.each([
    ['working', (value) => value.workingDatabasePath],
    ['restore', (value) => value.restoreDatabasePath],
  ])('rejects a pre-existing WAL-only %s evidence state', async (_label, selectPath) => {
    const value = acceptanceFixture();
    const Database = requireSqlite();
    const artifactPath = selectPath(value);
    const writer = new Database(artifactPath);
    try {
      writer.pragma('journal_mode = WAL');
      writer.pragma('wal_autocheckpoint = 0');
      writer.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, 'must-block-offline-evidence', ?)
      `).run(
        `offline-${_label}-wal-only`,
        '2026-07-29T04:00:00.000Z',
      );
      expect(fs.existsSync(`${artifactPath}-wal`)).toBe(true);

      await expect(run(cliArgs(value), quietContext(value)))
        .rejects.toThrow(/sidecar/i);
      expect(fs.existsSync(value.outPath)).toBe(false);
    } finally {
      writer.close();
    }
  }, 30_000);

  it('rejects a WAL-only write that lands between the two logical snapshots', async () => {
    const value = acceptanceFixture();
    const Database = requireSqlite();
    let writer;
    let backupCount = 0;
    try {
      await expect(run(cliArgs(value), {
        ...quietContext(value),
        runReadonlyBackup(options) {
          const proof = runReadonlySqliteOnlineBackupSync(options);
          backupCount += 1;
          if (backupCount === 1) {
            writer = new Database(value.dbPath);
            writer.pragma('journal_mode = WAL');
            writer.pragma('wal_autocheckpoint = 0');
            writer.prepare(`
              INSERT INTO app_settings (key, value, updated_at)
              VALUES ('between-snapshot-write', 'must-block-publication', ?)
            `).run('2026-07-29T03:00:00.000Z');
          }
          return proof;
        },
      })).rejects.toThrow(/LIVE_LOGICAL_SNAPSHOT_STABLE/);
    } finally {
      writer?.close();
    }
    expect(backupCount).toBe(2);
    expect(fs.existsSync(value.outPath)).toBe(false);
    expect(captureDirectories(value.captureParent)).toEqual([]);
  }, 30_000);

  it('accepts the explicit already-applied legacy v1 checksum', async () => {
    const value = acceptanceFixture();
    mutateLiveDatabase(value.dbPath, (database) => {
      database.prepare(`
        UPDATE schema_migrations SET checksum = ? WHERE version = 1
      `).run(legacyV1Checksum());
    });

    const result = await run(cliArgs(value), quietContext(value));
    expect(result.receipt.passed).toBe(true);
  }, 30_000);

  it('rejects an unknown v1 checksum', async () => {
    const value = acceptanceFixture();
    mutateLiveDatabase(value.dbPath, (database) => {
      database.prepare(`
        UPDATE schema_migrations SET checksum = 'store-authority-v1-unknown'
        WHERE version = 1
      `).run();
    });

    await expect(run(cliArgs(value), quietContext(value)))
      .rejects.toThrow(/LIVE_MIGRATIONS_1_TO_9_CURRENT/);
    expect(fs.existsSync(value.outPath)).toBe(false);
  }, 30_000);

  it('publishes no receipt when controlled capture cleanup reports failure', async () => {
    const value = acceptanceFixture();

    await expect(run(cliArgs(value), {
      ...quietContext(value),
      cleanupCaptureRoot(captureState) {
        removeCaptureRoot(captureState);
        throw new Error('injected cleanup failure');
      },
    })).rejects.toThrow(/injected cleanup failure/);
    expect(fs.existsSync(value.outPath)).toBe(false);
    expect(captureDirectories(value.captureParent)).toEqual([]);
  }, 30_000);
});

function tempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-s7-live-acceptance-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function cliArgs(value) {
  return [
    '--db', value.dbPath,
    '--authority-selection', value.authoritySelectionPath,
    '--migration-manifest', value.migrationManifestPath,
    '--migration-verification', value.migrationVerificationPath,
    '--out', value.outPath,
  ];
}

function acceptanceFixture() {
  const root = tempDirectory();
  const liveRoot = path.join(root, 'live');
  const evidenceRoot = path.join(root, 'evidence');
  const offlineWorkRoot = path.join(root, 'offline-work');
  const outputRoot = path.join(root, 'output');
  const captureParent = path.join(root, 'capture');
  for (const directory of [
    liveRoot,
    evidenceRoot,
    offlineWorkRoot,
    outputRoot,
    captureParent,
  ]) {
    fs.mkdirSync(directory);
  }
  const dbPath = path.join(liveRoot, 'amazon-ai-ops.db');
  createV7Source(dbPath);
  const Database = requireSqlite();
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  let sourceRowCounts;
  let sourceVersion;
  let listingMergeBaseline;
  try {
    source.pragma('query_only = ON');
    sourceRowCounts = collectRowCounts(source);
    sourceVersion = Number(source.prepare(`
      SELECT MAX(version) AS version
      FROM schema_migrations
      WHERE status = 'applied'
    `).get().version);
    listingMergeBaseline = {
      migration4MergedDuplicateRows: Number(source.prepare(`
        SELECT result_json AS resultJson
        FROM schema_migrations
        WHERE version = 4 AND status = 'applied'
      `).get() ? JSON.parse(source.prepare(`
        SELECT result_json AS resultJson
        FROM schema_migrations
        WHERE version = 4 AND status = 'applied'
      `).get().resultJson).mergedDuplicateRows : 0),
      resolvedMergeRecords: Number(source.prepare(`
        SELECT COUNT(*) AS count
        FROM store_migration_quarantine
        WHERE migration_version = 4
          AND source_table = 'listing_content'
          AND reason = 'duplicate_normalized_asin_merged'
          AND status = 'resolved'
      `).get().count),
    };
  } finally {
    source.close();
  }
  expect(sourceVersion).toBe(7);
  const sourceSha256 = sha256File(dbPath);
  const authoritySelectionPath = path.join(evidenceRoot, 'authority-selection.json');
  writeJson(authoritySelectionPath, {
    kind: 'production-authority-selection-preflight',
    schemaVersion: 'production-authority-selection-preflight/v1',
    generatedAt: '2026-07-29T01:00:00.000Z',
    status: 'SELECTED_MIGRATION_REQUIRED',
    formalEvidence: false,
    authorityDatabaseMutated: false,
    adsExecutionInvoked: false,
    selection: {
      expectedDatabasePath: dbPath,
      expectedMainSha256: sourceSha256,
      selected: {
        role: 'selected',
        absolutePath: dbPath,
        realPath: dbPath,
        mainFileSha256: sourceSha256,
        offlineMigrationEligible: true,
        sidecarObservation: {
          walAndJournalUnchanged: true,
        },
        sqlite: {
          openedReadOnly: true,
          queryOnly: true,
          integrity: 'ok',
          foreignKeyViolationCount: 0,
          state: 'MIGRATION_REQUIRED',
          migration: {
            highestAppliedVersion: 7,
            targetReady: false,
          },
        },
        logicalCapture: {
          method: 'readonly-sqlite-online-backup',
          source: {
            openedReadOnly: true,
            queryOnly: true,
          },
        },
      },
    },
  });

  const runtime = loadLocalDbRuntime();
  const workingDatabasePath = path.join(offlineWorkRoot, 'working-upgraded.db');
  const restoreDatabasePath = path.join(offlineWorkRoot, 'restored-pre-v9.db');
  fs.copyFileSync(dbPath, workingDatabasePath, fs.constants.COPYFILE_EXCL);
  const migrated = runtime.initSqlite(workingDatabasePath);
  let migrations;
  let upgradedRowCounts;
  let targetMigrationManifest;
  let recoveryPreflight;
  let restore;
  let restoredRowCounts;
  let restoredVersion;
  let businessRowPreservation;
  try {
    migrations = migrated.prepare(`
      SELECT version, name, checksum, status, applied_at AS appliedAt
      FROM schema_migrations
      ORDER BY version
    `).all();
    upgradedRowCounts = collectRowCounts(migrated);
    targetMigrationManifest = JSON.parse(migrated.prepare(`
      SELECT manifest_json AS manifestJson
      FROM schema_migrations
      WHERE version = 9
    `).get().manifestJson);
    recoveryPreflight = new runtime.StoreRepository(migrated)
      .getMigrationRecoveryPreflight(9);
    restore = new runtime.StoreRepository(migrated)
      .restoreMigrationBackupTo(restoreDatabasePath, 9);
    businessRowPreservation = evaluateBusinessRowPreservation(
      migrated,
      sourceRowCounts,
      upgradedRowCounts,
      listingMergeBaseline,
    );
  } finally {
    migrated.close();
  }
  const restored = new Database(
    restoreDatabasePath,
    { readonly: true, fileMustExist: true },
  );
  try {
    restored.pragma('query_only = ON');
    restoredRowCounts = collectRowCounts(restored);
    restoredVersion = Number(restored.prepare(`
      SELECT MAX(version) AS version
      FROM schema_migrations
      WHERE status = 'applied'
    `).get().version);
  } finally {
    restored.close();
  }
  sealOfflineDatabaseArtifact(workingDatabasePath);
  sealOfflineDatabaseArtifact(restoreDatabasePath);
  restore.sha256 = sha256File(restoreDatabasePath);

  const migrationManifestPath = path.join(evidenceRoot, 'offline-migration.json');
  writeJson(migrationManifestPath, {
    kind: 's7-offline-db-upgrade',
    schemaVersion: 1,
    generatedAt: '2026-07-29T01:10:00.000Z',
    passed: true,
    source: {
      path: dbPath,
      sha256: sourceSha256,
      version: sourceVersion,
      tableRowCounts: sourceRowCounts,
      listingMergeBaseline,
    },
    offlineLease: {
      method: 'windows-file-share-none',
      sourceSha256,
      workingCopySha256: sourceSha256,
      lockHeldThroughFinalPublish: true,
    },
    targetVersion: 9,
    workingDatabase: {
      path: workingDatabasePath,
      sourceCopySha256: sourceSha256,
      upgradedSha256: sha256File(workingDatabasePath),
      integrityCheck: 'ok',
      foreignKeyViolationCount: 0,
      tableRowCounts: upgradedRowCounts,
    },
    migrations,
    targetMigrationManifest,
    recoveryPreflight,
    restore: {
      ...restore,
      version: restoredVersion,
      tableRowCounts: restoredRowCounts,
    },
    businessRowPreservation,
    preservationFailures: businessRowPreservation.failures,
  });
  const migrationVerificationPath = path.join(evidenceRoot, 'migration-verification.json');
  const realMigrationVerification = verifyS7MigrationBackupRestore(
    migrationManifestPath,
  );
  expect(realMigrationVerification.passed).toBe(true);
  expect(realMigrationVerification.checks.map((check) => check.code).sort())
    .toEqual([...REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES].sort());
  writeJson(migrationVerificationPath, realMigrationVerification);

  const liveMigrated = runtime.initSqlite(dbPath);
  liveMigrated.close();
  return {
    root,
    captureParent,
    dbPath,
    authoritySelectionPath,
    migrationManifestPath,
    migrationVerificationPath,
    restoreDatabasePath,
    workingDatabasePath,
    outPath: path.join(outputRoot, 'live-migration-acceptance.json'),
  };
}

function createV7Source(databasePath) {
  const runtime = loadLocalDbRuntime();
  const database = runtime.initSqlite(databasePath);
  try {
    database.pragma('foreign_keys = OFF');
    for (const table of [
      'ad_execution_domain_reconciliations',
      'ad_execution_evidence',
      'ad_execution_events',
      'ad_execution_jobs',
      'ad_execution_batches',
      'ad_keyword_alias_resolutions',
      'ad_keyword_identity_versions',
    ]) {
      database.exec(`DROP TABLE IF EXISTS "${table}"`);
    }
    database.prepare('DELETE FROM schema_migrations WHERE version IN (8, 9)').run();
    database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES ('s7-live-acceptance-sentinel', 'preserve-me', '2026-07-29T00:00:00.000Z')
    `).run();
    database.pragma('foreign_keys = ON');
  } finally {
    database.close();
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function captureDirectories(captureParent) {
  return fs.readdirSync(captureParent)
    .filter((entry) => entry.startsWith('amazon-ai-ops-s7-live-acceptance-'));
}

function quietContext(value) {
  return {
    tempRoot: value.captureParent,
    writeStdout() {},
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function refreshMigrationVerification(value) {
  const verification = readJson(value.migrationVerificationPath);
  verification.sourceManifestSha256 = sha256File(value.migrationManifestPath);
  writeJson(value.migrationVerificationPath, verification);
}

function sealOfflineDatabaseArtifact(databasePath) {
  const Database = requireSqlite();
  const database = new Database(databasePath);
  try {
    database.pragma('wal_checkpoint(TRUNCATE)');
    database.pragma('journal_mode = DELETE');
  } finally {
    database.close();
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    expect(fs.existsSync(`${databasePath}${suffix}`)).toBe(false);
  }
}

function mutateLiveDatabase(databasePath, mutate) {
  const Database = requireSqlite();
  const database = new Database(databasePath);
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

function mutateMigration9Manifest(databasePath, mutate) {
  mutateLiveDatabase(databasePath, (database) => {
    const row = database.prepare(`
      SELECT manifest_json AS manifestJson
      FROM schema_migrations
      WHERE version = 9
    `).get();
    const manifest = JSON.parse(row.manifestJson);
    mutate(manifest.upgradeBackup);
    database.prepare(`
      UPDATE schema_migrations
      SET manifest_json = ?
      WHERE version = 9
    `).run(JSON.stringify(manifest));
  });
}
