const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_VERSION = 11;
const SCRIPT_SCHEMA_VERSION = 1;
const INSPECTION_TEMP_PREFIX = `amazon-ai-ops-s7-inspection-${process.pid}-`;
const OFFLINE_MIGRATION_USAGE = `Usage:
  node scripts/migrate-current-user-db.js --db <absolute-db-path> --expected-sha256 <64-hex-sha256> --work-dir <absolute-work-dir> [--out <absolute-manifest-path>] [--execute]
  node scripts/migrate-current-user-db.js --help

Safely inspect or migrate an explicitly bound offline Amazon AI Ops database copy.

Options:
  --db <path>                Absolute path to the offline source database.
  --expected-sha256 <hash>   Expected 64-character SHA-256 of the source database.
  --work-dir <path>          Absolute isolated directory for working copies and evidence.
  --out <path>               Optional absolute manifest path inside --work-dir.
  --execute                  Upgrade a working copy to v${TARGET_VERSION}; never overwrite the source.
  --help                     Show this help and exit without reading files or loading SQLite.

Without --execute, the command performs a read-only inspection and prints the migration plan.
The source must be offline with no WAL, SHM, or journal sidecars.
Execute mode holds a Windows FileShare.None source handle through exclusive manifest publication.`;
let loadedLocalDbRuntime;

function parseOfflineMigrationArgs(argv) {
  const args = {
    db: '',
    expectedSha256: '',
    workDir: '',
    out: '',
    execute: false,
    help: false,
  };
  if (argv.slice(2).includes('--help')) {
    args.help = true;
    return args;
  }
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
  const sourceIdentity = captureOfflineSourceIdentity(sourcePath);
  const actualSha256 = sourceIdentity.sha256;
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Source database SHA-256 mismatch: expected=${expectedSha256}, actual=${actualSha256}`);
  }
  const sourceSizeBytes = sourceIdentity.sizeBytes;
  if (isSameOrContainedPath(path.dirname(sourcePath), workDir)) {
    throw new Error('--work-dir must be outside the source database directory.');
  }
  if (fs.existsSync(workDir)) {
    const workDirStat = fs.lstatSync(workDir);
    if (workDirStat.isSymbolicLink() || !workDirStat.isDirectory()) {
      throw new Error('--work-dir must be a regular non-link directory.');
    }
    if (!samePath(fs.realpathSync(workDir), workDir)) {
      throw new Error('--work-dir may not resolve through a junction, symlink, or reparse point.');
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
    if (!samePath(path.dirname(manifestPath), workDir)) {
      throw new Error('output manifest must be a direct child of the isolated work directory.');
    }
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
        offlineIdentity: sourceIdentity,
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
    assertOfflineSourceIdentity(sourcePath, sourceIdentity, 'read-only inspection');
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

function executeOfflineMigration(args, hooks = {}) {
  const plan = inspectOfflineMigration({ ...args, execute: true });
  invokeOfflineMigrationHook(hooks, 'afterInspection', plan);
  assertTargetVersion(plan, 'Offline migration plan');
  assertOfflineSourceIdentity(
    plan.source.path,
    plan.source.offlineIdentity,
    'the checkpoint immediately before acquiring the Windows offline lease',
  );
  if (process.platform !== 'win32') {
    throw new Error('S7 offline execution requires Windows FileShare.None lease support.');
  }
  fs.mkdirSync(plan.workDir, { recursive: true });
  assertRegularDirectDirectory(plan.workDir, 'work directory');
  const manifestParent = path.dirname(plan.manifestPath);
  assertRegularDirectDirectory(manifestParent, 'manifest parent');
  const nonce = crypto.randomUUID().replace(/[^A-Za-z0-9-]/g, '');
  if (!nonce) throw new Error('Could not create a safe offline lease nonce.');
  const requestPath = path.join(plan.workDir, `.s7-offline-request-${nonce}.json`);
  const leaseProofPath = path.join(plan.workDir, `.s7-offline-lease-${nonce}.json`);
  const temporaryManifestPath = path.join(
    manifestParent,
    `.s7-offline-manifest-${nonce}.tmp`,
  );
  const allowedFaultModes = new Set([
    '',
    'after-working-copy-wal',
    'before-publish-wal',
    'before-publish-failure',
    'publish-conflict',
  ]);
  const faultMode = String(hooks.faultMode || '');
  if (!allowedFaultModes.has(faultMode)) {
    throw new Error(`Unsupported offline migration fault mode: ${faultMode}`);
  }

  const request = {
    kind: 's7-offline-migration-lease-request',
    schemaVersion: 1,
    nonce,
    plan,
    nodeExecutable: process.execPath,
    migrationScriptPath: __filename,
    temporaryManifestPath,
    leaseProofPath,
    faultMode,
  };
  writeTextExclusive(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  const helperPath = path.join(__dirname, 'run-s7-offline-migration-lease.ps1');
  const windowsPowerShell = process.env.SystemRoot
    ? path.join(
      process.env.SystemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    : 'powershell.exe';
  let leaseResult;
  try {
    leaseResult = spawnSync(windowsPowerShell, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath,
      '-RequestPath',
      requestPath,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  } finally {
    removeOwnedTransientFile(requestPath, plan.workDir, '.s7-offline-request-');
    removeOwnedTransientFile(leaseProofPath, plan.workDir, '.s7-offline-lease-');
    removeOwnedTransientFile(
      temporaryManifestPath,
      manifestParent,
      '.s7-offline-manifest-',
    );
  }
  if (leaseResult.error) {
    throw new Error(`Windows offline lease helper failed to start: ${leaseResult.error.message}`);
  }
  if (leaseResult.signal || leaseResult.status !== 0) {
    const detail = String(leaseResult.stderr || leaseResult.stdout || '').trim();
    throw new Error(
      `Windows offline lease blocked the migration`
      + `${leaseResult.signal ? ` (signal=${leaseResult.signal})` : ''}`
      + `${Number.isInteger(leaseResult.status) ? ` (exit=${leaseResult.status})` : ''}`
      + `${detail ? `: ${detail}` : '.'}`,
    );
  }
  assertRegularFile(plan.manifestPath, 'published migration manifest');
  const evidence = readJsonFile(plan.manifestPath, 'published migration manifest');
  if (
    evidence?.passed !== true
    || evidence?.targetVersion !== TARGET_VERSION
    || normalizeSha256(evidence?.source?.sha256, 'manifest source SHA-256')
      !== plan.source.sha256
    || evidence?.offlineLease?.method !== 'windows-file-share-none'
    || evidence?.offlineLease?.lockHeldThroughFinalPublish !== true
  ) {
    throw new Error('Published migration manifest is not bound to the Windows offline lease.');
  }
  return { ...evidence, manifestPath: plan.manifestPath };
}

function executeLockedWorkingCopy(plan, temporaryManifestPath, leaseProofPath) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Locked migration plan is invalid.');
  }
  assertTargetVersion(plan, 'Locked migration plan');
  if (!path.isAbsolute(plan.workingDatabasePath || '')
    || !path.isAbsolute(plan.restoreDatabasePath || '')
    || !path.isAbsolute(temporaryManifestPath || '')
    || !path.isAbsolute(leaseProofPath || '')) {
    throw new Error('Locked migration artifacts must use absolute paths.');
  }
  assertRegularFile(plan.workingDatabasePath, 'locked working database copy');
  assertRegularFile(leaseProofPath, 'Windows offline lease proof');
  const offlineLease = readJsonFile(leaseProofPath, 'Windows offline lease proof');
  if (
    offlineLease?.method !== 'windows-file-share-none'
    || offlineLease?.lockHeldThroughFinalPublish !== true
  ) {
    throw new Error('Windows offline lease proof contract is invalid.');
  }
  const copiedSha256 = normalizeSha256(
    offlineLease.workingCopySha256,
    'lease working-copy SHA-256',
  );
  if (
    copiedSha256 !== plan.source.sha256
    || sha256File(plan.workingDatabasePath) !== copiedSha256
    || normalizeSha256(offlineLease.sourceSha256, 'lease source SHA-256')
      !== plan.source.sha256
  ) {
    throw new Error('Locked working database copy is not bound to the source snapshot.');
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
      offlineLease,
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
  evidence.workingDatabase.upgradedSha256 = sha256File(plan.workingDatabasePath);
  writeTextExclusive(temporaryManifestPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function assertTargetVersion(plan, label) {
  if (!Number.isInteger(plan?.targetVersion) || plan.targetVersion !== TARGET_VERSION) {
    throw new Error(`${label} targetVersion must be exactly ${TARGET_VERSION}.`);
  }
}

function executeLockedPlanRequest(requestPath) {
  if (!path.isAbsolute(requestPath || '')) {
    throw new Error('Locked migration request path must be absolute.');
  }
  assertRegularFile(requestPath, 'locked migration request');
  const request = readJsonFile(requestPath, 'locked migration request');
  if (
    request?.kind !== 's7-offline-migration-lease-request'
    || request?.schemaVersion !== 1
    || typeof request?.nonce !== 'string'
    || !/^[A-Za-z0-9-]+$/.test(request.nonce)
  ) {
    throw new Error('Locked migration request contract is invalid.');
  }
  return executeLockedWorkingCopy(
    request.plan,
    request.temporaryManifestPath,
    request.leaseProofPath,
  );
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

function captureOfflineSourceIdentity(sourcePath) {
  const resolvedSourcePath = path.resolve(sourcePath);
  assertRegularFile(resolvedSourcePath, 'source database');
  assertOfflineSource(resolvedSourcePath);
  const sourceStat = fs.statSync(resolvedSourcePath);
  const sourceDirectoryPath = path.dirname(resolvedSourcePath);
  const sourceDirectoryStat = fs.statSync(sourceDirectoryPath);
  const sourceRealPath = fs.realpathSync(resolvedSourcePath);
  const sourceDirectoryRealPath = fs.realpathSync(sourceDirectoryPath);
  if (!samePath(sourceRealPath, resolvedSourcePath)
    || !samePath(sourceDirectoryRealPath, sourceDirectoryPath)) {
    throw new Error('Source database may not resolve through a junction, symlink, or reparse point.');
  }
  if (sourceStat.nlink !== 1) {
    throw new Error(`Source database must have exactly one hard link; observed ${sourceStat.nlink}.`);
  }
  const identity = {
    path: resolvedSourcePath,
    realPath: sourceRealPath,
    sha256: sha256File(resolvedSourcePath),
    sizeBytes: sourceStat.size,
    mtimeMs: sourceStat.mtimeMs,
    birthtimeMs: sourceStat.birthtimeMs,
    device: sourceStat.dev,
    inode: sourceStat.ino,
    hardLinkCount: sourceStat.nlink,
    sourceDirectory: {
      path: sourceDirectoryPath,
      realPath: sourceDirectoryRealPath,
      device: sourceDirectoryStat.dev,
      inode: sourceDirectoryStat.ino,
      birthtimeMs: sourceDirectoryStat.birthtimeMs,
      entries: readDirectoryEntries(sourceDirectoryPath),
    },
    sidecarsAbsent: true,
  };
  assertOfflineSource(resolvedSourcePath);
  return identity;
}

function assertOfflineSourceIdentity(sourcePath, expectedIdentity, phase) {
  const actualIdentity = captureOfflineSourceIdentity(sourcePath);
  if (JSON.stringify(actualIdentity) !== JSON.stringify(expectedIdentity)) {
    throw new Error(
      `Source database or directory identity changed during ${phase}: `
      + `expected=${JSON.stringify(expectedIdentity)}, actual=${JSON.stringify(actualIdentity)}`,
    );
  }
  return actualIdentity;
}

function invokeOfflineMigrationHook(hooks, name, plan) {
  const hook = hooks?.[name];
  if (hook === undefined) return;
  if (typeof hook !== 'function') {
    throw new Error(`Offline migration hook ${name} must be a function.`);
  }
  hook(plan);
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

function assertRegularDirectDirectory(directoryPath, label) {
  if (!fs.existsSync(directoryPath)) {
    throw new Error(`${label} does not exist: ${directoryPath}`);
  }
  const stat = fs.lstatSync(directoryPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a regular non-link directory.`);
  }
  if (!samePath(fs.realpathSync(directoryPath), directoryPath)) {
    throw new Error(`${label} may not resolve through a junction, symlink, or reparse point.`);
  }
}

function readJsonFile(filePath, label) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
  return parsed;
}

function removeOwnedTransientFile(filePath, expectedParent, requiredPrefix) {
  if (!fs.existsSync(filePath)) return;
  const resolved = path.resolve(filePath);
  if (
    !samePath(path.dirname(resolved), expectedParent)
    || !path.basename(resolved).startsWith(requiredPrefix)
  ) {
    throw new Error(`Refusing to remove an unowned transient file: ${resolved}`);
  }
  assertRegularFile(resolved, 'owned transient file');
  fs.unlinkSync(resolved);
}

function writeTextExclusive(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const handle = fs.openSync(filePath, 'wx');
  try {
    fs.writeFileSync(handle, value, 'utf8');
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

function main(
  argv = process.argv,
  logger = console,
  operations = { inspectOfflineMigration, executeOfflineMigration },
) {
  try {
    const args = parseOfflineMigrationArgs(argv);
    if (args.help) {
      logger.log(OFFLINE_MIGRATION_USAGE);
      return 0;
    }
    const result = args.execute
      ? operations.executeOfflineMigration(args)
      : operations.inspectOfflineMigration(args);
    logger.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    logger.error(`[S7 OFFLINE MIGRATION BLOCKED] ${error.message}`);
    return 1;
  }
}

function cliMain(argv = process.argv, logger = console) {
  if (argv[2] !== '--execute-locked-plan') {
    return main(argv, logger);
  }
  try {
    if (argv.length !== 4 || !path.isAbsolute(argv[3] || '')) {
      throw new Error('--execute-locked-plan requires exactly one absolute request path.');
    }
    executeLockedPlanRequest(path.resolve(argv[3]));
    return 0;
  } catch (error) {
    logger.error(`[S7 LOCKED WORKING COPY BLOCKED] ${error.message}`);
    return 1;
  }
}

module.exports = {
  OFFLINE_MIGRATION_USAGE,
  TARGET_VERSION,
  cliMain,
  collectRowCounts,
  evaluateBusinessRowPreservation,
  executeOfflineMigration,
  executeLockedPlanRequest,
  executeLockedWorkingCopy,
  inspectOfflineMigration,
  loadLocalDbRuntime,
  main,
  normalizeSha256,
  parseOfflineMigrationArgs,
  readAppliedVersion,
  requireSqlite,
  sha256File,
};

if (require.main === module) process.exitCode = cliMain();
