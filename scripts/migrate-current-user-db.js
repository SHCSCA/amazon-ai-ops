const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_VERSION = 9;
const SCRIPT_SCHEMA_VERSION = 1;
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
  const actualSha256 = sha256File(sourcePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Source database SHA-256 mismatch: expected=${expectedSha256}, actual=${actualSha256}`);
  }
  if (isSameOrContainedPath(path.dirname(sourcePath), workDir)) {
    throw new Error('--work-dir must be outside the source database directory.');
  }
  if (fs.existsSync(workDir)) {
    const workDirStat = fs.lstatSync(workDir);
    if (workDirStat.isSymbolicLink() || !workDirStat.isDirectory()) {
      throw new Error('--work-dir must be a regular non-link directory.');
    }
  }
  const Database = requireSqlite();
  const inspected = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    const integrityCheck = inspected.pragma('integrity_check', { simple: true });
    if (integrityCheck !== 'ok') throw new Error(`Source database integrity_check returned: ${integrityCheck}`);
    const sourceVersion = readAppliedVersion(inspected);
    if (sourceVersion >= TARGET_VERSION) {
      throw new Error(`Source database is already at migration ${sourceVersion}; no offline upgrade is pending.`);
    }
    const sourceTableRowCounts = collectRowCounts(inspected);
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
    return {
      kind: 's7-offline-db-upgrade-plan',
      schemaVersion: SCRIPT_SCHEMA_VERSION,
      mode: args.execute ? 'execute' : 'dry-run',
      source: {
        path: sourcePath,
        sha256: actualSha256,
        sizeBytes: fs.statSync(sourcePath).size,
        integrityCheck,
        version: sourceVersion,
        tableRowCounts: sourceTableRowCounts,
      },
      targetVersion: TARGET_VERSION,
      workDir,
      workingDatabasePath,
      restoreDatabasePath,
      manifestPath,
    };
  } finally {
    inspected.close();
  }
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
    const preservationFailures = Object.entries(plan.source.tableRowCounts)
      .filter(([table]) => table !== 'schema_migrations')
      .filter(([table, count]) => !(table in upgradedRowCounts) || upgradedRowCounts[table] < count)
      .map(([table, count]) => ({ table, before: count, after: upgradedRowCounts[table] ?? null }));
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
