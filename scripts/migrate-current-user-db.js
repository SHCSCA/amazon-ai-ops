const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_VERSION = 9;
const SCRIPT_SCHEMA_VERSION = 1;
const INSPECTION_TEMP_PREFIX = `amazon-ai-ops-s7-inspection-${process.pid}-`;
let loadedLocalDbRuntime;

function parseOfflineMigrationArgs(argv) {
  const args = {
    db: '',
    expectedSha256: '',
    workDir: '',
    out: '',
    execute: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--db') args.db = argv[++index] || '';
    else if (token === '--expected-sha256') args.expectedSha256 = argv[++index] || '';
    else if (token === '--work-dir') args.workDir = argv[++index] || '';
    else if (token === '--out') args.out = argv[++index] || '';
    else if (token === '--execute') args.execute = true;
    else throw new Error(`Unexpected argument: ${token}`);
  }
  if (!args.db) throw new Error('--db is required; automatic AppData discovery is disabled.');
  if (!path.isAbsolute(args.db)) throw new Error('--db must be an absolute path.');
  if (!args.workDir) throw new Error('--work-dir is required.');
  if (!path.isAbsolute(args.workDir)) throw new Error('--work-dir must be an absolute path.');
  args.expectedSha256 = normalizeSha256(args.expectedSha256, '--expected-sha256');
  if (args.out && !path.isAbsolute(args.out)) throw new Error('--out must be an absolute path.');
  if (args.out && !isSameOrContainedPath(args.workDir, args.out)) {
    throw new Error('--out must stay inside --work-dir.');
  }
  return args;
}

function inspectOfflineMigration(args) {
  if (!path.isAbsolute(args.db || '')) throw new Error('source database path must be absolute.');
  if (!path.isAbsolute(args.workDir || '')) throw new Error('work directory path must be absolute.');
  const sourcePath = path.resolve(args.db);
  const workDir = path.resolve(args.workDir);
  const expectedSha256 = normalizeSha256(args.expectedSha256, 'expected source SHA-256');
  if (args.out && (!path.isAbsolute(args.out) || !isSameOrContainedPath(workDir, args.out))) {
    throw new Error('output manifest must be an absolute path inside the work directory.');
  }
  assertRegularFile(sourcePath, 'source database');
  assertOfflineSource(sourcePath);
  const sourceDirectoryEntries = readDirectoryEntries(path.dirname(sourcePath));
  const actualSha256 = sha256File(sourcePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Source database SHA-256 mismatch: expected=${expectedSha256}, actual=${actualSha256}`);
  }
  assertOfflineSource(sourcePath);
  const sourceSizeBytes = fs.statSync(sourcePath).size;
  if (isSameOrContainedPath(path.dirname(sourcePath), workDir)) {
    throw new Error('--work-dir must be outside the source database directory.');
  }
  if (fs.existsSync(workDir)) {
    const workDirStat = fs.lstatSync(workDir);
    if (workDirStat.isSymbolicLink() || !workDirStat.isDirectory()) {
      throw new Error('--work-dir must be a regular non-link directory.');
    }
  }

  const inspectionDirectory = createControlledInspectionDirectory(path.dirname(sourcePath));
  const inspectionDatabasePath = path.join(inspectionDirectory.path, 'source-inspection-copy.db');
  let inspected;
  let inspectionResult;
  let inspectionError;
  let closeError;
  let cleanupError;
  try {
    fs.copyFileSync(sourcePath, inspectionDatabasePath, fs.constants.COPYFILE_EXCL);
    const inspectionCopySha256 = sha256File(inspectionDatabasePath);
    if (inspectionCopySha256 !== actualSha256) {
      throw new Error('Inspection database copy SHA-256 does not match the explicitly bound source.');
    }
    const Database = requireSqlite();
    inspected = new Database(inspectionDatabasePath, { readonly: true, fileMustExist: true });
    const integrityCheck = inspected.pragma('integrity_check', { simple: true });
    if (integrityCheck !== 'ok') throw new Error(`Source database integrity_check returned: ${integrityCheck}`);
    const sourceVersion = readAppliedVersion(inspected);
    if (sourceVersion >= TARGET_VERSION) {
      throw new Error(`Source database is already at migration ${sourceVersion}; no offline upgrade is pending.`);
    }
    const sourceTableRowCounts = collectRowCounts(inspected);
    const listingMergeBaseline = collectListingMergeBaseline(inspected);
    const workingDatabasePath = path.join(
      workDir,
      `${path.basename(sourcePath, path.extname(sourcePath))}.upgrade-to-v${TARGET_VERSION}.db`,
    );
    const restoreDatabasePath = path.join(
      workDir,
      `${path.basename(sourcePath, path.extname(sourcePath))}.restored-pre-v${TARGET_VERSION}.db`,
    );
    const manifestPath = args.out
      ? path.resolve(args.out)
      : path.join(workDir, `s7-offline-upgrade-v${sourceVersion}-to-v${TARGET_VERSION}.json`);
    for (const [label, candidate] of [
      ['working database', workingDatabasePath],
      ['restore database', restoreDatabasePath],
      ['output manifest', manifestPath],
    ]) {
      if (fs.existsSync(candidate)) throw new Error(`${label} already exists: ${candidate}`);
      if (samePath(candidate, sourcePath)) throw new Error(`${label} must not overwrite the source database.`);
    }
    inspectionResult = {
      kind: 's7-offline-db-upgrade-plan',
      schemaVersion: SCRIPT_SCHEMA_VERSION,
      mode: args.execute ? 'execute' : 'dry-run',
      source: {
        path: sourcePath,
        sha256: actualSha256,
        sizeBytes: sourceSizeBytes,
        integrityCheck,
        version: sourceVersion,
        tableRowCounts: sourceTableRowCounts,
        listingMergeBaseline,
      },
      targetVersion: TARGET_VERSION,
      workDir,
      workingDatabasePath,
      restoreDatabasePath,
      manifestPath,
    };
  } catch (error) {
    inspectionError = error;
  } finally {
    if (inspected) {
      try {
        inspected.close();
      } catch (error) {
        closeError = error;
      }
    }
    try {
      removeControlledInspectionDirectory(inspectionDirectory);
    } catch (error) {
      cleanupError = error;
    }
  }

  let sourceSafetyError;
  try {
    assertRegularFile(sourcePath, 'source database');
    assertOfflineSource(sourcePath);
    const finalSourceSha256 = sha256File(sourcePath);
    if (finalSourceSha256 !== actualSha256) {
      throw new Error(`Source database changed during read-only inspection: ${finalSourceSha256}`);
    }
    const finalSourceDirectoryEntries = readDirectoryEntries(path.dirname(sourcePath));
    if (JSON.stringify(finalSourceDirectoryEntries) !== JSON.stringify(sourceDirectoryEntries)) {
      throw new Error(
        `Source database directory changed during read-only inspection: before=${JSON.stringify(sourceDirectoryEntries)}, `
        + `after=${JSON.stringify(finalSourceDirectoryEntries)}`,
      );
    }
  } catch (error) {
    sourceSafetyError = error;
  }

  const failures = [inspectionError, closeError, cleanupError, sourceSafetyError].filter(Boolean);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, `Offline source inspection failed: ${failures.map((error) => error.message).join(' | ')}`);
  }
  return inspectionResult;
}

function executeOfflineMigration(args) {
  const plan = inspectOfflineMigration({ ...args, execute: true });
  fs.mkdirSync(plan.workDir, { recursive: true });
  fs.copyFileSync(plan.source.path, plan.workingDatabasePath, fs.constants.COPYFILE_EXCL);
  const copiedSha256 = sha256File(plan.workingDatabasePath);
  if (copiedSha256 !== plan.source.sha256) {
    throw new Error('Working database copy SHA-256 does not match the explicitly bound source.');
  }

  const runtime = loadLocalDbRuntime();
  const upgraded = runtime.initSqlite(plan.workingDatabasePath);
  let evidence;
  try {
    const integrityCheck = upgraded.pragma('integrity_check', { simple: true });
    const foreignKeyViolations = upgraded.pragma('foreign_key_check');
    const migrations = upgraded.prepare(`
      SELECT version, name, checksum, status, applied_at AS appliedAt
      FROM schema_migrations ORDER BY version
    `).all();
    const expectedVersions = Array.from({ length: TARGET_VERSION }, (_, index) => index + 1);
    const appliedVersions = migrations
      .filter((migration) => migration.status === 'applied')
      .map((migration) => Number(migration.version));
    if (JSON.stringify(appliedVersions) !== JSON.stringify(expectedVersions)) {
      throw new Error(`Upgrade did not apply migrations 1..${TARGET_VERSION}.`);
    }
    if (integrityCheck !== 'ok' || foreignKeyViolations.length > 0) {
      throw new Error(`Upgraded database verification failed (integrity=${integrityCheck}, fk=${foreignKeyViolations.length}).`);
    }

    const upgradedRowCounts = collectRowCounts(upgraded);
    const businessRowPreservation = evaluateBusinessRowPreservation(
      upgraded,
      plan.source.tableRowCounts,
      upgradedRowCounts,
      plan.source.listingMergeBaseline,
    );
    const preservationFailures = businessRowPreservation.failures;
    if (preservationFailures.length > 0) {
      throw new Error(`Business row preservation failed: ${JSON.stringify(preservationFailures)}`);
    }

    const targetMigration = upgraded.prepare(`
      SELECT manifest_json AS manifestJson FROM schema_migrations WHERE version = ?
    `).get(TARGET_VERSION);
    const targetMigrationManifest = JSON.parse(targetMigration.manifestJson);
    const storeRepository = new runtime.StoreRepository(upgraded);
    const recoveryPreflight = storeRepository.getMigrationRecoveryPreflight(TARGET_VERSION);
    if (!recoveryPreflight.canRestore) {
      throw new Error(`Upgrade recovery preflight failed: ${recoveryPreflight.blockers.join(' ')}`);
    }
    const restore = storeRepository.restoreMigrationBackupTo(plan.restoreDatabasePath, TARGET_VERSION);
    const restored = new (requireSqlite())(plan.restoreDatabasePath, { readonly: true, fileMustExist: true });
    let restoredVersion;
    let restoredIntegrityCheck;
    let restoredRowCounts;
    try {
      restoredVersion = readAppliedVersion(restored);
      restoredIntegrityCheck = restored.pragma('integrity_check', { simple: true });
      restoredRowCounts = collectRowCounts(restored);
    } finally {
      restored.close();
    }
    if (restoredVersion !== plan.source.version
      || restoredIntegrityCheck !== 'ok'
      || JSON.stringify(restoredRowCounts) !== JSON.stringify(plan.source.tableRowCounts)) {
      throw new Error('Restored pre-upgrade database does not match the bound source snapshot.');
    }

    evidence = {
      kind: 's7-offline-db-upgrade',
      schemaVersion: SCRIPT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      passed: true,
      source: plan.source,
      targetVersion: TARGET_VERSION,
      workingDatabase: {
        path: plan.workingDatabasePath,
        sourceCopySha256: copiedSha256,
        // Filled only after closing SQLite so the final WAL checkpoint is part
        // of the bound database file hash.
        upgradedSha256: '',
        integrityCheck,
        foreignKeyViolationCount: foreignKeyViolations.length,
        tableRowCounts: upgradedRowCounts,
      },
      migrations,
      targetMigrationManifest,
      recoveryPreflight,
      restore: {
        ...restore,
        version: restoredVersion,
        integrityCheck: restoredIntegrityCheck,
        tableRowCounts: restoredRowCounts,
      },
      businessRowPreservation,
      preservationFailures,
    };
  } finally {
    upgraded.close();
  }
  const finalSourceSha256 = sha256File(plan.source.path);
  if (finalSourceSha256 !== plan.source.sha256) {
    throw new Error(`Source database changed during offline migration: ${finalSourceSha256}`);
  }
  evidence.workingDatabase.upgradedSha256 = sha256File(plan.workingDatabasePath);
  writeJsonExclusive(plan.manifestPath, evidence);
  return { ...evidence, manifestPath: plan.manifestPath };
}

function loadLocalDbRuntime() {
  if (loadedLocalDbRuntime) return loadedLocalDbRuntime;
  const esbuild = requireEsbuild();
  const cacheDir = path.join(ROOT, 'packages', 'local-db', 'node_modules', '.cache', 'amazon-ai-ops-s7');
  fs.mkdirSync(cacheDir, { recursive: true });
  const bundlePath = path.join(cacheDir, `local-db-runtime-${process.pid}.cjs`);
  esbuild.buildSync({
    stdin: {
      contents: [
        "export { initSqlite } from './packages/local-db/src/sqlite/db';",
        "export { StoreRepository } from './packages/local-db/src/sqlite/repositories/store-repo';",
      ].join('\n'),
      resolveDir: ROOT,
      sourcefile: 's7-local-db-runtime.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile: bundlePath,
    external: ['better-sqlite3'],
    logLevel: 'silent',
  });
  loadedLocalDbRuntime = require(bundlePath);
  return loadedLocalDbRuntime;
}

function requireEsbuild() {
  const candidates = [
    'esbuild',
    path.join(ROOT, 'apps', 'desktop', 'node_modules', 'esbuild'),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next workspace-local dependency.
    }
  }
  throw new Error('Missing workspace dependency esbuild; run pnpm install before offline migration.');
}

function requireSqlite() {
  const candidates = [
    'better-sqlite3',
    path.join(ROOT, 'apps', 'desktop', 'node_modules', 'better-sqlite3'),
    path.join(ROOT, 'packages', 'local-db', 'node_modules', 'better-sqlite3'),
  ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`Missing dependency better-sqlite3. Tried ${errors.join(' | ')}`);
}

function assertOfflineSource(sourcePath) {
  const walPath = `${sourcePath}-wal`;
  const shmPath = `${sourcePath}-shm`;
  const journalPath = `${sourcePath}-journal`;
  const liveArtifacts = [walPath, shmPath, journalPath].filter((candidate) => fs.existsSync(candidate));
  if (liveArtifacts.length > 0) {
    throw new Error(`Source database is not offline; close the app and remove no files manually: ${liveArtifacts.join(', ')}`);
  }
}

function createControlledInspectionDirectory(sourceDirectoryPath) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const sourceDirectory = fs.realpathSync(sourceDirectoryPath);
  if (isSameOrContainedPath(sourceDirectory, tempRoot)) {
    throw new Error(`System temporary directory must be outside the source database directory: ${tempRoot}`);
  }
  const createdPath = fs.mkdtempSync(path.join(tempRoot, INSPECTION_TEMP_PREFIX));
  const resolvedPath = path.resolve(createdPath);
  const stat = fs.lstatSync(resolvedPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Controlled inspection path is not a regular directory: ${resolvedPath}`);
  }
  const realPath = fs.realpathSync(resolvedPath);
  if (!samePath(realPath, resolvedPath)
    || samePath(tempRoot, resolvedPath)
    || !isSameOrContainedPath(tempRoot, resolvedPath)
    || !path.basename(resolvedPath).startsWith(INSPECTION_TEMP_PREFIX)) {
    throw new Error(`Controlled inspection path failed mkdtemp containment validation: ${resolvedPath}`);
  }
  return Object.freeze({
    path: resolvedPath,
    realPath,
    tempRoot,
    device: stat.dev,
    inode: stat.ino,
    birthtimeMs: stat.birthtimeMs,
  });
}

function removeControlledInspectionDirectory(inspectionDirectory) {
  if (!inspectionDirectory || typeof inspectionDirectory !== 'object') {
    throw new Error('Controlled inspection cleanup requires the exact mkdtemp identity.');
  }
  const targetPath = path.resolve(String(inspectionDirectory.path || ''));
  const tempRoot = fs.realpathSync(os.tmpdir());
  if (!samePath(tempRoot, inspectionDirectory.tempRoot)
    || samePath(tempRoot, targetPath)
    || !isSameOrContainedPath(tempRoot, targetPath)
    || !path.basename(targetPath).startsWith(INSPECTION_TEMP_PREFIX)
    || !samePath(targetPath, inspectionDirectory.realPath)) {
    throw new Error(`Refusing recursive cleanup outside the controlled mkdtemp identity: ${targetPath}`);
  }
  const stat = fs.lstatSync(targetPath);
  const realPath = fs.realpathSync(targetPath);
  if (stat.isSymbolicLink()
    || !stat.isDirectory()
    || !samePath(realPath, inspectionDirectory.realPath)
    || stat.dev !== inspectionDirectory.device
    || stat.ino !== inspectionDirectory.inode
    || stat.birthtimeMs !== inspectionDirectory.birthtimeMs) {
    throw new Error(`Refusing recursive cleanup of a replaced inspection directory: ${targetPath}`);
  }
  fs.rmSync(targetPath, { recursive: true, force: false });
  if (fs.existsSync(targetPath)) {
    throw new Error(`Controlled inspection directory cleanup did not complete: ${targetPath}`);
  }
}

function readDirectoryEntries(directoryPath) {
  return fs.readdirSync(directoryPath).sort();
}

function readAppliedVersion(database) {
  const exists = database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'
  `).get();
  if (!exists) return 0;
  const row = database.prepare(`
    SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations WHERE status = 'applied'
  `).get();
  return Number(row.version) || 0;
}

function collectRowCounts(database) {
  const tables = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
  return Object.fromEntries(tables.map((table) => [
    table,
    Number(database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count),
  ]));
}

function evaluateBusinessRowPreservation(
  database,
  sourceRowCounts,
  upgradedRowCounts,
  sourceListingMergeBaseline = { migration4MergedDuplicateRows: 0, resolvedMergeRecords: 0 },
) {
  const listingCurrentToHistoryTransfer = evaluateListingCurrentToHistoryTransfer(
    database,
    sourceRowCounts,
    upgradedRowCounts,
    sourceListingMergeBaseline,
  );
  const provenTableReductions = new Set();
  if (listingCurrentToHistoryTransfer.applied && listingCurrentToHistoryTransfer.passed) {
    provenTableReductions.add('listing_content');
  }
  const failures = Object.entries(sourceRowCounts)
    .filter(([table]) => table !== 'schema_migrations')
    .filter(([table, count]) => {
      if (provenTableReductions.has(table)) return false;
      return !(table in upgradedRowCounts) || upgradedRowCounts[table] < count;
    })
    .map(([table, count]) => ({ table, before: count, after: upgradedRowCounts[table] ?? null }));
  return {
    passed: failures.length === 0,
    failures,
    listingCurrentToHistoryTransfer,
  };
}

function evaluateListingCurrentToHistoryTransfer(
  database,
  sourceRowCounts,
  upgradedRowCounts,
  sourceListingMergeBaseline,
) {
  const sourceCurrentRows = numericRowCount(sourceRowCounts, 'listing_content');
  const upgradedCurrentRows = numericRowCount(upgradedRowCounts, 'listing_content');
  const sourceHistoryRows = numericRowCount(sourceRowCounts, 'listing_content_versions') ?? 0;
  const upgradedHistoryRows = numericRowCount(upgradedRowCounts, 'listing_content_versions');
  const applied = sourceCurrentRows !== null
    && upgradedCurrentRows !== null
    && upgradedCurrentRows < sourceCurrentRows;
  const currentRowsMoved = applied ? sourceCurrentRows - upgradedCurrentRows : 0;
  const historyRowsAdded = upgradedHistoryRows === null
    ? null
    : upgradedHistoryRows - sourceHistoryRows;

  const sourceMigration4MergedDuplicateRows = numericBaselineCount(
    sourceListingMergeBaseline,
    'migration4MergedDuplicateRows',
  );
  const sourceResolvedMergeRecords = numericBaselineCount(
    sourceListingMergeBaseline,
    'resolvedMergeRecords',
  );
  let upgradedMigration4MergedDuplicateRows = null;
  let upgradedResolvedMergeRecords = null;
  if (applied) {
    const upgradedBaseline = collectListingMergeBaseline(database);
    upgradedMigration4MergedDuplicateRows = upgradedBaseline.migration4MergedDuplicateRows;
    upgradedResolvedMergeRecords = upgradedBaseline.resolvedMergeRecords;
  }
  const migration4MergedDuplicateRowsAdded = upgradedMigration4MergedDuplicateRows === null
    || sourceMigration4MergedDuplicateRows === null
    ? null
    : upgradedMigration4MergedDuplicateRows - sourceMigration4MergedDuplicateRows;
  const resolvedMergeRecordsAdded = upgradedResolvedMergeRecords === null
    || sourceResolvedMergeRecords === null
    ? null
    : upgradedResolvedMergeRecords - sourceResolvedMergeRecords;

  const passed = !applied || (
    currentRowsMoved > 0
    && historyRowsAdded === currentRowsMoved
    && migration4MergedDuplicateRowsAdded === currentRowsMoved
    && resolvedMergeRecordsAdded === currentRowsMoved
  );
  return {
    applied,
    passed,
    sourceCurrentRows,
    upgradedCurrentRows,
    currentRowsMoved,
    sourceHistoryRows,
    upgradedHistoryRows,
    historyRowsAdded,
    sourceMigration4MergedDuplicateRows,
    upgradedMigration4MergedDuplicateRows,
    migration4MergedDuplicateRowsAdded,
    sourceResolvedMergeRecords,
    upgradedResolvedMergeRecords,
    resolvedMergeRecordsAdded,
  };
}

function collectListingMergeBaseline(database) {
  let migration4MergedDuplicateRows = 0;
  const migrationTableExists = database.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `).get();
  if (migrationTableExists) {
    const migration = database.prepare(`
      SELECT result_json AS resultJson
      FROM schema_migrations
      WHERE version = 4 AND status = 'applied'
    `).get();
    if (migration) {
      let parsed;
      try {
        parsed = JSON.parse(migration.resultJson);
      } catch {
        throw new Error('Applied migration 4 contains malformed result_json.');
      }
      migration4MergedDuplicateRows = numericBaselineCount(parsed, 'mergedDuplicateRows');
      if (migration4MergedDuplicateRows === null) {
        throw new Error('Applied migration 4 contains an invalid mergedDuplicateRows count.');
      }
    }
  }

  let resolvedMergeRecords = 0;
  const quarantineTableExists = database.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'store_migration_quarantine'
  `).get();
  if (quarantineTableExists) {
    resolvedMergeRecords = Number(database.prepare(`
      SELECT COUNT(*) AS count
      FROM store_migration_quarantine
      WHERE migration_version = 4
        AND source_table = 'listing_content'
        AND reason = 'duplicate_normalized_asin_merged'
        AND status = 'resolved'
    `).get().count);
  }
  return { migration4MergedDuplicateRows, resolvedMergeRecords };
}

function numericRowCount(rowCounts, table) {
  if (!rowCounts || typeof rowCounts !== 'object' || !(table in rowCounts)) return null;
  const value = Number(rowCounts[table]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function numericBaselineCount(value, key) {
  if (!value || typeof value !== 'object' || !(key in value)) return null;
  const count = Number(value[key]);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function normalizeSha256(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a 64-character SHA-256.`);
  return normalized;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function assertRegularFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} does not exist: ${filePath}`);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-link file.`);
}

function writeJsonExclusive(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = fs.openSync(filePath, 'wx');
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function samePath(left, right) {
  const normalize = (value) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function isSameOrContainedPath(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function main() {
  try {
    const args = parseOfflineMigrationArgs(process.argv);
    const result = args.execute ? executeOfflineMigration(args) : inspectOfflineMigration(args);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[S7 OFFLINE MIGRATION BLOCKED] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  TARGET_VERSION,
  collectRowCounts,
  evaluateBusinessRowPreservation,
  executeOfflineMigration,
  inspectOfflineMigration,
  loadLocalDbRuntime,
  normalizeSha256,
  parseOfflineMigrationArgs,
  readAppliedVersion,
  requireSqlite,
  sha256File,
};

if (require.main === module) main();
