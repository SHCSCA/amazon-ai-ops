const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(
  path.join(ROOT, 'packages', 'local-db', 'package.json'),
);
const SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION =
  'sqlite-authority-currentness-proof/v1';
const CURRENTNESS_METHOD = 'readonly-sqlite-online-backup';
const CHILD_MODE = '--readonly-online-backup-child';
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CHILD_OUTPUT_BYTES = 1024 * 1024;

function fail(message) {
  throw new Error(message);
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
    || (!relative.startsWith(`..${path.sep}`)
      && relative !== '..'
      && !path.isAbsolute(relative));
}

function assertCleanAbsolutePath(candidatePath, label) {
  if (
    typeof candidatePath !== 'string'
    || candidatePath !== candidatePath.trim()
    || candidatePath.includes('\0')
    || !path.isAbsolute(candidatePath)
  ) {
    fail(`${label} must be a clean absolute path.`);
  }
  return path.resolve(candidatePath);
}

function assertExistingDirectPath(candidatePath, label, expectedKind) {
  const resolved = assertCleanAbsolutePath(candidatePath, label);
  const lstat = fs.lstatSync(resolved);
  if (lstat.isSymbolicLink()) {
    fail(`${label} may not be a symbolic link or junction: ${resolved}`);
  }
  const realPath = fs.realpathSync.native(resolved);
  if (!samePath(resolved, realPath)) {
    fail(`${label} may not traverse a symlink, junction, or reparse point: ${resolved}`);
  }
  const stat = fs.statSync(realPath);
  if (expectedKind === 'file' && (!stat.isFile() || stat.nlink !== 1)) {
    fail(`${label} must be a unique regular file with exactly one hard link: ${realPath}`);
  }
  if (expectedKind === 'directory' && !stat.isDirectory()) {
    fail(`${label} must be a real directory: ${realPath}`);
  }
  return { path: realPath, stat };
}

function assertSafeExistingAncestor(candidatePath, label) {
  let cursor = path.resolve(candidatePath);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      fail(`${label} has no existing filesystem ancestor: ${candidatePath}`);
    }
    cursor = parent;
  }
  return assertExistingDirectPath(cursor, `${label} ancestor`, 'directory');
}

function assertDirectChild(rootPath, candidatePath, label) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (
    !isPathContained(root, candidate)
    || samePath(root, candidate)
    || !samePath(path.dirname(candidate), root)
  ) {
    fail(`${label} must be a direct child of its owned temporary root.`);
  }
  return candidate;
}

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .toUpperCase();
}

function fileArtifact(filePath) {
  const { path: realPath, stat } = assertExistingDirectPath(
    filePath,
    'SQLite online-backup artifact',
    'file',
  );
  return Object.freeze({
    sha256: sha256File(realPath),
    sizeBytes: stat.size,
  });
}

function normalizeArtifact(artifact, label) {
  const sha256 = typeof artifact?.sha256 === 'string'
    ? artifact.sha256.toUpperCase()
    : '';
  if (!/^[A-F0-9]{64}$/.test(sha256)) {
    fail(`${label} must include a valid SHA-256 digest.`);
  }
  if (!Number.isInteger(artifact?.sizeBytes) || artifact.sizeBytes <= 0) {
    fail(`${label} must include a positive integer sizeBytes.`);
  }
  return Object.freeze({ sha256, sizeBytes: artifact.sizeBytes });
}

function sameArtifact(left, right) {
  return left.sha256 === right.sha256 && left.sizeBytes === right.sizeBytes;
}

function safeRemoveOwnedDestination(destinationPath, ownedTempRoot) {
  const destination = assertDirectChild(
    ownedTempRoot,
    destinationPath,
    'SQLite online-backup destination',
  );
  if (!fs.existsSync(destination)) return;
  const lstat = fs.lstatSync(destination);
  const realPath = fs.realpathSync.native(destination);
  if (
    lstat.isSymbolicLink()
    || !samePath(destination, realPath)
    || !lstat.isFile()
    || lstat.nlink !== 1
  ) {
    fail(`Refusing to remove an unsafe SQLite online-backup destination: ${destination}`);
  }
  fs.unlinkSync(destination);
}

function normalizeTimeoutMs(timeoutMs) {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    fail('SQLite online-backup timeoutMs must be an integer between 1000 and 300000.');
  }
  return timeoutMs;
}

function parseChildResult(stdout) {
  const text = String(stdout || '').trim();
  if (!text) fail('SQLite online-backup child returned no result.');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('SQLite online-backup child returned malformed JSON.');
  }
  if (
    parsed?.method !== CURRENTNESS_METHOD
    || parsed?.openedReadOnly !== true
    || parsed?.queryOnly !== true
    || !Number.isInteger(parsed?.totalPages)
    || parsed.totalPages <= 0
    || parsed?.remainingPages !== 0
  ) {
    fail('SQLite online-backup child returned an invalid proof contract.');
  }
  return parsed;
}

function runReadonlySqliteOnlineBackupSync(
  {
    sourceDatabasePath,
    destinationPath,
    ownedTempRoot,
    timeoutMs,
  },
  injectedContext = {},
) {
  const source = assertExistingDirectPath(
    sourceDatabasePath,
    'Live authority database',
    'file',
  );
  const root = assertExistingDirectPath(
    ownedTempRoot,
    'Owned SQLite online-backup root',
    'directory',
  );
  const destination = assertDirectChild(
    root.path,
    assertCleanAbsolutePath(destinationPath, 'SQLite online-backup destination'),
    'SQLite online-backup destination',
  );
  if (fs.existsSync(destination)) {
    fail(`SQLite online-backup destination already exists: ${destination}`);
  }
  const spawn = injectedContext.spawnSync ?? spawnSync;
  if (typeof spawn !== 'function') fail('SQLite online-backup spawn implementation is invalid.');

  let childResult;
  try {
    childResult = spawn(
      process.execPath,
      [__filename, CHILD_MODE, source.path, destination, root.path],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: MAX_CHILD_OUTPUT_BYTES,
        shell: false,
        timeout: normalizeTimeoutMs(timeoutMs),
        windowsHide: true,
      },
    );
    if (childResult?.error) {
      fail(`SQLite online-backup child failed: ${childResult.error.message}`);
    }
    if (childResult?.status !== 0 || childResult?.signal) {
      const stderr = String(childResult?.stderr || '').trim();
      fail(
        `SQLite online-backup child exited unsuccessfully`
        + `${childResult?.signal ? ` (${childResult.signal})` : ` (${childResult?.status})`}`
        + `${stderr ? `: ${stderr}` : '.'}`,
      );
    }
    const childProof = parseChildResult(childResult.stdout);
    const observedBackup = fileArtifact(destination);
    return Object.freeze({
      schemaVersion: SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
      method: CURRENTNESS_METHOD,
      source: Object.freeze({
        absolutePath: source.path,
        openedReadOnly: true,
        queryOnly: true,
      }),
      observedBackup: Object.freeze({
        ...observedBackup,
        totalPages: childProof.totalPages,
        remainingPages: childProof.remainingPages,
      }),
    });
  } catch (error) {
    if (fs.existsSync(destination)) {
      safeRemoveOwnedDestination(destination, root.path);
    }
    throw error;
  }
}

function createOwnedCaptureRoot(injectedContext) {
  const baseRoot = path.resolve(
    injectedContext.tempRoot
      ?? path.join(os.tmpdir(), 'amazon-ai-ops-authority-currentness'),
  );
  assertSafeExistingAncestor(baseRoot, 'Authority currentness temporary root');
  if (!fs.existsSync(baseRoot)) fs.mkdirSync(baseRoot);
  const base = assertExistingDirectPath(
    baseRoot,
    'Authority currentness temporary root',
    'directory',
  );
  const randomUUID = injectedContext.randomUUID ?? (() => crypto.randomUUID());
  if (typeof randomUUID !== 'function') {
    fail('Authority currentness randomUUID implementation is invalid.');
  }
  const nonce = String(randomUUID()).replace(/[^a-zA-Z0-9-]/g, '');
  if (!nonce) fail('Authority currentness randomUUID returned an invalid value.');
  const captureRoot = path.join(base.path, `capture-${nonce}`);
  fs.mkdirSync(captureRoot, { recursive: false });
  const captured = assertExistingDirectPath(
    captureRoot,
    'Authority currentness capture root',
    'directory',
  );
  if (!samePath(path.dirname(captured.path), base.path)) {
    fail('Authority currentness capture root escaped its owned temporary root.');
  }
  return { baseRoot: base.path, captureRoot: captured.path };
}

function cleanupOwnedCaptureRoot(captureRoot, baseRoot) {
  const capture = assertExistingDirectPath(
    captureRoot,
    'Authority currentness capture root',
    'directory',
  );
  if (!samePath(path.dirname(capture.path), baseRoot)) {
    fail('Refusing to clean an authority currentness root outside its owned parent.');
  }
  const entries = fs.readdirSync(capture.path);
  if (entries.length > 0) {
    fail(`Authority currentness capture root was not empty after cleanup: ${capture.path}`);
  }
  fs.rmdirSync(capture.path);
}

function captureAuthoritySnapshotCurrentness(
  {
    sourceDatabasePath,
    expectedSnapshotArtifact,
    captureLabel = 'authority-currentness',
  },
  injectedContext = {},
) {
  if (
    typeof captureLabel !== 'string'
    || captureLabel !== captureLabel.trim()
    || captureLabel.length === 0
    || captureLabel.includes('\0')
  ) {
    fail('Authority currentness captureLabel must be a clean non-empty string.');
  }
  const expectedSnapshot = normalizeArtifact(
    expectedSnapshotArtifact,
    'Expected authority snapshot artifact',
  );
  const { baseRoot, captureRoot } = createOwnedCaptureRoot(injectedContext);
  const destinationPath = path.join(captureRoot, 'authority-currentness-backup.db');
  let proof;
  try {
    const backup = runReadonlySqliteOnlineBackupSync(
      {
        sourceDatabasePath,
        destinationPath,
        ownedTempRoot: captureRoot,
        timeoutMs: injectedContext.timeoutMs,
      },
      injectedContext,
    );
    const observedBackup = normalizeArtifact(
      backup.observedBackup,
      'Observed authority online-backup artifact',
    );
    if (!sameArtifact(observedBackup, expectedSnapshot)) {
      fail(
        'Live authority SQLite online backup does not match the selected authority snapshot '
        + `(expected ${expectedSnapshot.sha256}/${expectedSnapshot.sizeBytes}, `
        + `observed ${observedBackup.sha256}/${observedBackup.sizeBytes}).`,
      );
    }
    const now = injectedContext.now ?? (() => new Date());
    if (typeof now !== 'function') fail('Authority currentness clock implementation is invalid.');
    const capturedAtDate = now();
    if (!(capturedAtDate instanceof Date) || !Number.isFinite(capturedAtDate.valueOf())) {
      fail('Authority currentness clock returned an invalid date.');
    }
    proof = Object.freeze({
      schemaVersion: SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
      method: CURRENTNESS_METHOD,
      captureLabel,
      capturedAt: capturedAtDate.toISOString(),
      source: Object.freeze({
        openedReadOnly: backup.source.openedReadOnly === true,
        queryOnly: backup.source.queryOnly === true,
      }),
      expectedSnapshot,
      observedBackup: Object.freeze({
        ...observedBackup,
        totalPages: backup.observedBackup.totalPages,
        remainingPages: backup.observedBackup.remainingPages,
      }),
      matchesSelectedSnapshot: true,
    });
  } finally {
    if (fs.existsSync(destinationPath)) {
      safeRemoveOwnedDestination(destinationPath, captureRoot);
    }
    if (fs.existsSync(captureRoot)) {
      cleanupOwnedCaptureRoot(captureRoot, baseRoot);
    }
  }
  return proof;
}

function assertMatchingAuthorityCurrentnessProofs(
  proofs,
  expectedSnapshotArtifact,
  label = 'Authority currentness',
) {
  const expectedSnapshot = normalizeArtifact(
    expectedSnapshotArtifact,
    `${label} expected snapshot artifact`,
  );
  if (!Array.isArray(proofs) || proofs.length === 0) {
    fail(`${label} requires at least one WAL-aware currentness proof.`);
  }
  const labels = new Set();
  let previousCapturedAt = -Infinity;
  for (const proof of proofs) {
    if (
      proof?.schemaVersion !== SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
      || proof?.method !== CURRENTNESS_METHOD
      || proof?.source?.openedReadOnly !== true
      || proof?.source?.queryOnly !== true
      || proof?.matchesSelectedSnapshot !== true
    ) {
      fail(`${label} contains an invalid WAL-aware online-backup proof.`);
    }
    const observed = normalizeArtifact(
      proof.observedBackup,
      `${label} observed backup`,
    );
    const declaredExpected = normalizeArtifact(
      proof.expectedSnapshot,
      `${label} declared expected snapshot`,
    );
    if (
      !sameArtifact(observed, expectedSnapshot)
      || !sameArtifact(declaredExpected, expectedSnapshot)
    ) {
      fail(`${label} proof does not match the selected authority snapshot.`);
    }
    if (
      typeof proof.captureLabel !== 'string'
      || proof.captureLabel.length === 0
      || labels.has(proof.captureLabel)
    ) {
      fail(`${label} capture labels must be non-empty and unique.`);
    }
    labels.add(proof.captureLabel);
    const capturedAt = Date.parse(proof.capturedAt);
    if (!Number.isFinite(capturedAt) || capturedAt < previousCapturedAt) {
      fail(`${label} capture timestamps are invalid or out of order.`);
    }
    previousCapturedAt = capturedAt;
  }
  return Object.freeze({
    method: CURRENTNESS_METHOD,
    expectedSnapshot,
    proofCount: proofs.length,
  });
}

async function runChild(argv) {
  const [, sourceDatabasePath, destinationPath, ownedTempRoot] = argv;
  const source = assertExistingDirectPath(
    sourceDatabasePath,
    'Live authority database',
    'file',
  );
  const root = assertExistingDirectPath(
    ownedTempRoot,
    'Owned SQLite online-backup root',
    'directory',
  );
  const destination = assertDirectChild(
    root.path,
    assertCleanAbsolutePath(destinationPath, 'SQLite online-backup destination'),
    'SQLite online-backup destination',
  );
  if (fs.existsSync(destination)) {
    fail(`SQLite online-backup destination already exists: ${destination}`);
  }
  const Database = requireFromLocalDb('better-sqlite3');
  const database = new Database(source.path, { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only = ON');
    if (Number(database.pragma('query_only', { simple: true })) !== 1) {
      fail('Live authority database did not enter SQLite query_only mode.');
    }
    const backupResult = await database.backup(destination);
    process.stdout.write(JSON.stringify({
      method: CURRENTNESS_METHOD,
      openedReadOnly: true,
      queryOnly: true,
      totalPages: backupResult.totalPages,
      remainingPages: backupResult.remainingPages,
    }));
  } finally {
    database.close();
  }
}

if (require.main === module) {
  if (process.argv[2] !== CHILD_MODE) {
    process.stderr.write('This helper only supports its bounded internal online-backup child mode.\n');
    process.exitCode = 1;
  } else {
    runChild(process.argv.slice(2)).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  CURRENTNESS_METHOD,
  SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
  assertMatchingAuthorityCurrentnessProofs,
  captureAuthoritySnapshotCurrentness,
  runReadonlySqliteOnlineBackupSync,
};
