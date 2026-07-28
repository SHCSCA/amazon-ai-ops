const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const {
  defaultDbCandidates,
  resolveAdReadbackAuthorityDbPath,
} = require('./ad-readback-authority-db');

const ROOT = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(path.join(ROOT, 'packages', 'local-db', 'package.json'));
const AUTHORITY_SNAPSHOT_KIND = 'mission-control-authority-database-snapshot';
const AUTHORITY_SNAPSHOT_SCHEMA_VERSION = 'mission-control-authority-database-snapshot/v2';
const BACKUP_METHOD = 'sqlite-online-backup';
const SNAPSHOT_DATABASE_NAME = 'authority-snapshot.db';
const SNAPSHOT_MANIFEST_NAME = 'snapshot-manifest.json';

function defaultExportContext() {
  const releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release');
  return {
    Database: requireFromLocalDb('better-sqlite3'),
    appContentPath: path.join(releaseRoot, 'win-unpacked', 'resources', 'app'),
    authoritySnapshotRoot: path.join(ROOT, 'output', 'codex-evidence', 'authority-snapshots'),
    env: process.env,
    executablePath: path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe'),
    mainBundlePath: path.join(releaseRoot, 'win-unpacked', 'resources', 'app', 'dist', 'main', 'index.js'),
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
    releaseRoot,
  };
}

function normalizedPath(filePath) {
  return path.resolve(filePath).replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function isPathContained(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function fileArtifact(filePath) {
  const stat = fs.statSync(filePath);
  return {
    sha256: sha256File(filePath),
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function assertExistingDirectPath(candidatePath, label, expectedKind) {
  const resolved = path.resolve(candidatePath);
  const lstat = fs.lstatSync(resolved);
  if (lstat.isSymbolicLink()) {
    throw new Error(`${label} may not be a symbolic link or junction: ${resolved}`);
  }
  const realPath = fs.realpathSync.native(resolved);
  if (!samePath(resolved, realPath)) {
    throw new Error(`${label} may not traverse a symlink, junction, or reparse point: ${resolved} -> ${realPath}`);
  }
  const stat = fs.statSync(realPath);
  if (expectedKind === 'file' && (!stat.isFile() || stat.nlink !== 1)) {
    throw new Error(`${label} must be a unique regular file with exactly one hard link: ${realPath}`);
  }
  if (expectedKind === 'directory' && !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${realPath}`);
  }
  return realPath;
}

function assertSafeExistingAncestor(candidatePath, label) {
  let cursor = path.resolve(candidatePath);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`${label} has no existing filesystem ancestor: ${candidatePath}`);
    cursor = parent;
  }
  assertExistingDirectPath(cursor, `${label} ancestor`, 'directory');
}

function resolveCanonicalAuthorityDb(explicitDbPath, env) {
  if (!explicitDbPath) {
    throw new Error('A canonical live authority database must be selected with --db <amazon-ai-ops.db>.');
  }
  if (typeof explicitDbPath !== 'string'
    || explicitDbPath !== explicitDbPath.trim()
    || explicitDbPath.includes('\0')
    || !path.isAbsolute(explicitDbPath)) {
    throw new Error('--db must be a clean absolute path.');
  }
  assertExistingDirectPath(explicitDbPath, 'Authority database', 'file');
  const resolved = resolveAdReadbackAuthorityDbPath(explicitDbPath, {});
  const candidates = defaultDbCandidates(env || process.env);
  if (!candidates.some((candidate) => samePath(candidate, explicitDbPath))) {
    throw new Error(
      `Authority database is not a canonical AppData authority candidate: ${path.resolve(explicitDbPath)}`,
    );
  }
  if (!samePath(resolved, explicitDbPath)) {
    throw new Error(`Authority database did not resolve uniquely to the requested canonical path: ${explicitDbPath}`);
  }
  return assertExistingDirectPath(resolved, 'Canonical authority database', 'file');
}

function computeCanonicalPackageIdentity(context) {
  const releaseRoot = assertExistingDirectPath(context.releaseRoot, 'Canonical release root', 'directory');
  for (const [label, candidate] of [
    ['Canonical win-unpacked executable', context.executablePath],
    ['Canonical app content', context.appContentPath],
    ['Canonical main bundle', context.mainBundlePath],
  ]) {
    if (!isPathContained(releaseRoot, candidate)) {
      throw new Error(`${label} escapes the canonical release root: ${candidate}`);
    }
  }
  const executablePath = assertExistingDirectPath(
    context.executablePath,
    'Canonical win-unpacked executable',
    'file',
  );
  const appContentPath = assertExistingDirectPath(
    context.appContentPath,
    'Canonical app content',
    'directory',
  );
  const mainBundlePath = assertExistingDirectPath(
    context.mainBundlePath,
    'Canonical main bundle',
    'file',
  );
  const executableBefore = sha256File(executablePath);
  const mainBundleBefore = sha256File(mainBundlePath);
  const { buildAppContentManifest } = require('./package-ui-evidence');
  const appContent = buildAppContentManifest(appContentPath);
  const executableAfter = sha256File(executablePath);
  const mainBundleAfter = sha256File(mainBundlePath);
  if (executableBefore !== executableAfter || mainBundleBefore !== mainBundleAfter) {
    throw new Error('Canonical package changed while its release identity was being recomputed.');
  }
  return {
    executableSha256: executableAfter,
    appContentSha256: String(appContent.sha256).toUpperCase(),
    mainBundleSha256: mainBundleAfter,
  };
}

function sqliteChecks(database, label) {
  database.pragma('query_only = ON');
  const queryOnly = Number(database.pragma('query_only', { simple: true })) === 1;
  if (!queryOnly) throw new Error(`${label} did not enter SQLite query_only mode.`);
  const integrityCheck = database.pragma('integrity_check')
    .map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
  if (integrityCheck.length !== 1 || integrityCheck[0] !== 'ok') {
    throw new Error(`${label} integrity_check did not return exactly ok: ${integrityCheck.join('; ')}`);
  }
  const foreignKeyCheck = database.pragma('foreign_key_check');
  if (!Array.isArray(foreignKeyCheck) || foreignKeyCheck.length !== 0) {
    throw new Error(`${label} foreign_key_check found ${foreignKeyCheck?.length ?? 'unknown'} violation(s).`);
  }
  return { foreignKeyCheck, integrityCheck, queryOnly };
}

function prepareOutputPaths(requestedOutputDirectory, context) {
  const rootPath = path.resolve(context.authoritySnapshotRoot);
  assertSafeExistingAncestor(rootPath, 'Authority snapshot root');
  fs.mkdirSync(rootPath, { recursive: true });
  const rootRealPath = assertExistingDirectPath(rootPath, 'Authority snapshot root', 'directory');
  const defaultName = `${context.now().toISOString().replace(/[:.]/g, '-')}-${context.randomUUID()}`;
  const outputDirectory = path.resolve(requestedOutputDirectory || path.join(rootRealPath, defaultName));
  if (path.dirname(outputDirectory) !== rootRealPath || !isPathContained(rootRealPath, outputDirectory)) {
    throw new Error(`Authority snapshot output must be one new direct child of ${rootRealPath}.`);
  }
  if (fs.existsSync(outputDirectory)) {
    throw new Error(`Authority snapshot output already exists and will not be overwritten: ${outputDirectory}`);
  }
  const basename = path.basename(outputDirectory);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(basename)) {
    throw new Error('Authority snapshot output directory name is invalid.');
  }
  const tempDirectory = path.join(rootRealPath, `.tmp-${basename}-${context.randomUUID()}`);
  if (fs.existsSync(tempDirectory)) {
    throw new Error(`Authority snapshot temporary output unexpectedly exists: ${tempDirectory}`);
  }
  return { outputDirectory, rootRealPath, tempDirectory };
}

function cleanupOwnedTempDirectory(rootPath, tempDirectory) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTemp = path.resolve(tempDirectory);
  if (path.dirname(resolvedTemp) !== resolvedRoot || !path.basename(resolvedTemp).startsWith('.tmp-')) {
    throw new Error(`Refusing to clean an unowned authority snapshot path: ${resolvedTemp}`);
  }
  if (fs.existsSync(resolvedTemp)) fs.rmSync(resolvedTemp, { recursive: true, force: false });
}

async function exportAuthoritySnapshot(options = {}, injectedContext = {}) {
  const context = { ...defaultExportContext(), ...injectedContext };
  const authorityDbPath = resolveCanonicalAuthorityDb(options.dbPath, context.env);
  const paths = prepareOutputPaths(options.outputDirectory, context);
  const snapshotPath = path.join(paths.outputDirectory, SNAPSHOT_DATABASE_NAME);
  const manifestPath = path.join(paths.outputDirectory, SNAPSHOT_MANIFEST_NAME);
  const tempSnapshotPath = path.join(paths.tempDirectory, SNAPSHOT_DATABASE_NAME);
  const tempManifestPath = path.join(paths.tempDirectory, SNAPSHOT_MANIFEST_NAME);
  let source;
  try {
    fs.mkdirSync(paths.tempDirectory, { recursive: false });
    assertExistingDirectPath(paths.tempDirectory, 'Authority snapshot temporary directory', 'directory');
    const packageIdentityBefore = computeCanonicalPackageIdentity(context);
    const sourceArtifactBefore = fileArtifact(authorityDbPath);
    source = new context.Database(authorityDbPath, { readonly: true, fileMustExist: true });
    const sourceChecks = sqliteChecks(source, 'Source authority database');
    const backupStartedAt = context.now().toISOString();
    const backupResult = await source.backup(tempSnapshotPath);
    const backupCompletedAt = context.now().toISOString();
    if (!backupResult
      || !Number.isInteger(backupResult.totalPages)
      || backupResult.totalPages <= 0
      || backupResult.remainingPages !== 0) {
      throw new Error('SQLite online backup did not report complete page transfer.');
    }
    source.close();
    source = null;

    const sourceArtifactAfter = fileArtifact(authorityDbPath);
    const snapshotRealPathInTemp = assertExistingDirectPath(
      tempSnapshotPath,
      'Authority snapshot database',
      'file',
    );
    let snapshot;
    let snapshotChecks;
    try {
      snapshot = new context.Database(snapshotRealPathInTemp, { readonly: true, fileMustExist: true });
      snapshotChecks = sqliteChecks(snapshot, 'Authority snapshot database');
    } finally {
      if (snapshot) snapshot.close();
    }
    const snapshotArtifact = fileArtifact(snapshotRealPathInTemp);
    const packageIdentityAfter = computeCanonicalPackageIdentity(context);
    if (JSON.stringify(packageIdentityBefore) !== JSON.stringify(packageIdentityAfter)) {
      throw new Error('Canonical package identity changed during authority snapshot export.');
    }

    const manifest = {
      kind: AUTHORITY_SNAPSHOT_KIND,
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      exportedAt: backupCompletedAt,
      backup: {
        method: BACKUP_METHOD,
        startedAt: backupStartedAt,
        completedAt: backupCompletedAt,
        completed: true,
        totalPages: backupResult.totalPages,
        remainingPages: backupResult.remainingPages,
      },
      source: {
        absolutePath: authorityDbPath,
        realPath: authorityDbPath,
        openedReadOnly: true,
        queryOnly: sourceChecks.queryOnly,
        integrityCheck: sourceChecks.integrityCheck,
        foreignKeyCheck: sourceChecks.foreignKeyCheck,
        artifactBefore: sourceArtifactBefore,
        artifactAfter: sourceArtifactAfter,
      },
      snapshot: {
        absolutePath: snapshotPath,
        realPath: snapshotPath,
        openedReadOnly: true,
        queryOnly: snapshotChecks.queryOnly,
        integrityCheck: snapshotChecks.integrityCheck,
        foreignKeyCheck: snapshotChecks.foreignKeyCheck,
        sha256: snapshotArtifact.sha256,
        sizeBytes: snapshotArtifact.sizeBytes,
      },
      packageIdentity: packageIdentityAfter,
    };
    fs.writeFileSync(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    assertExistingDirectPath(tempManifestPath, 'Authority snapshot manifest', 'file');
    fs.renameSync(paths.tempDirectory, paths.outputDirectory);
    return {
      manifest,
      manifestPath,
      outputDirectory: paths.outputDirectory,
      snapshotPath,
    };
  } catch (error) {
    if (source) source.close();
    cleanupOwnedTempDirectory(paths.rootRealPath, paths.tempDirectory);
    throw error;
  }
}

function parseArgs(argv) {
  const values = {};
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') {
      help = true;
      continue;
    }
    if (token !== '--db' && token !== '--out') throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    if (Object.prototype.hasOwnProperty.call(values, token.slice(2))) {
      throw new Error(`Duplicate argument: ${token}`);
    }
    values[token.slice(2)] = value;
    index += 1;
  }
  return { help, values };
}

function usage() {
  return [
    'Usage: node scripts/export-mission-control-authority-snapshot.js',
    '  --db <canonical AppData amazon-ai-ops.db>',
    '  [--out <new direct child of output/codex-evidence/authority-snapshots>]',
  ].join('\n');
}

async function run(argv = process.argv.slice(2), injectedContext = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return { exitCode: 0, result: null };
  }
  const result = await exportAuthoritySnapshot({
    dbPath: parsed.values.db,
    outputDirectory: parsed.values.out,
  }, injectedContext);
  process.stdout.write(`Authority snapshot: ${result.snapshotPath}\n`);
  process.stdout.write(`Manifest: ${result.manifestPath}\n`);
  return { exitCode: 0, result };
}

if (require.main === module) {
  run()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  AUTHORITY_SNAPSHOT_KIND,
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  BACKUP_METHOD,
  SNAPSHOT_DATABASE_NAME,
  SNAPSHOT_MANIFEST_NAME,
  computeCanonicalPackageIdentity,
  exportAuthoritySnapshot,
  parseArgs,
  run,
};
