const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');
const { validatePackageLaunchSmokeEvidence } = require('./smoke-package-launch');
const {
  SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
  assertMatchingAuthorityCurrentnessProofs,
  captureAuthoritySnapshotCurrentness,
} = require('./sqlite-authority-currentness');
const {
  inspectPngEvidenceFile,
} = require('./canary-png-evidence');

const ROOT = path.resolve(__dirname, '..');
const requireFromLocalDb = createRequire(path.join(ROOT, 'packages', 'local-db', 'package.json'));
const OUTPUT_KIND = 'mission-control-production-readiness';
const OUTPUT_SCHEMA_VERSION = 'mission-control-production-readiness/v1';
const EXECUTION_CANARY_KIND = 'mission-control-execution-canary-evidence';
const EXECUTION_CANARY_SCHEMA_VERSION = 'mission-control-execution-canary-evidence/v1';
const EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT = 'mission-control-execution-canary-authority/v1';
const S7_CONTINUOUS_OPERATION_KIND = 's7-continuous-operation-evidence';
const S7_CONTINUOUS_OPERATION_SCHEMA_VERSION = 's7-continuous-operation-evidence/v1';
const V15_GATE_IDS = Object.freeze([
  'report-collection-delivery',
  'lingxing-listing-full-read',
  'ai-live-provider',
  'ad-recommendation-ai-explanation',
  'listing-ai-draft',
  'real-ad-execution-readback',
  'release-package-hash',
  'package-launch-smoke',
]);
const PACKAGE_IDENTITY_FIELDS = Object.freeze([
  'executableSha256',
  'appContentSha256',
  'mainBundleSha256',
]);
const V15_SUPERSEDED_GATE_ID = 'real-ad-execution-readback';
const V15_SUPERSEDING_GATE_IDS = Object.freeze(['manual-canary', 'policy-auto-canary']);
const AUTHORITY_SNAPSHOT_KIND = 'mission-control-authority-database-snapshot';
const AUTHORITY_SNAPSHOT_SCHEMA_VERSION = 'mission-control-authority-database-snapshot/v2';
const AUTHORITY_SNAPSHOT_BACKUP_METHOD = 'sqlite-online-backup';
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_PACKAGE_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CONTINUOUS_EVIDENCE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CANARY_EVIDENCE_AGE_MS = 72 * 60 * 60 * 1000;
const AUTHORITY_SNAPSHOT_DEPENDENT_GATE_IDS = Object.freeze([
  's7-continuous-operation',
  'manual-canary',
  'policy-auto-canary',
]);

const GATE_SPECS = Object.freeze([
  Object.freeze({
    id: 'v15-final-readiness',
    name: 'Current v1.5 legacy readiness baseline',
    option: 'v15-final-readiness',
  }),
  Object.freeze({ id: 'package-launch', name: 'Current package launch', option: 'package-launch-smoke' }),
  Object.freeze({ id: 'package-ui', name: 'Package UI ten-workspace 100%/125%', option: 'package-ui-manifest' }),
  Object.freeze({ id: 'package-security', name: 'Package security boundaries', option: 'package-security-evidence' }),
  Object.freeze({ id: 'package-adversarial-node-env', name: 'Adversarial NODE_ENV package smoke', option: 'package-adversarial-node-env-evidence' }),
  Object.freeze({ id: 's7-continuous-operation', name: 'Stage 7 two-store seven-US-business-day operation', option: 's7-continuous-operation-evidence' }),
  Object.freeze({ id: 'manual-canary', name: 'Real manual-approval canary', option: 'manual-canary-evidence' }),
  Object.freeze({ id: 'policy-auto-canary', name: 'Real policy-auto canary', option: 'policy-auto-canary-evidence' }),
]);
const OPTION_ALIASES = Object.freeze({
  'final-readiness': 'v15-final-readiness',
  'continuous-operation-evidence': 's7-continuous-operation-evidence',
  'manual-canary': 'manual-canary-evidence',
  'policy-canary-evidence': 'policy-auto-canary-evidence',
  'policy-canary': 'policy-auto-canary-evidence',
  output: 'out',
});
const ALLOWED_OPTIONS = new Set([
  ...GATE_SPECS.map((spec) => spec.option),
  'authority-db',
  'authority-snapshot-manifest',
  'out',
]);

function defaultProductionContext(explicitAuthorityDbPath = null) {
  const releaseRoot = path.join(ROOT, 'apps', 'desktop', 'release');
  let authorityDbPath = null;
  let authorityDbError = null;
  try {
    const { resolveAdReadbackAuthorityDbPath } = require('./ad-readback-authority-db');
    authorityDbPath = resolveAdReadbackAuthorityDbPath(explicitAuthorityDbPath || undefined);
    if (explicitAuthorityDbPath) {
      const selectedPath = path.resolve(explicitAuthorityDbPath);
      const selectedStat = fs.statSync(selectedPath);
      if (!path.isAbsolute(explicitAuthorityDbPath)
        || !requestedPathEqualsRealpath(selectedPath)
        || !samePath(selectedPath, authorityDbPath)
        || fs.lstatSync(selectedPath).isSymbolicLink()
        || !selectedStat.isFile()
        || selectedStat.nlink !== 1) {
        throw new Error('--authority-db must resolve directly to one unique regular live database file.');
      }
    }
  } catch (error) {
    authorityDbError = error instanceof Error ? error.message : String(error);
  }
  return {
    nowMs: Date.now(),
    releaseRoot,
    executablePath: path.join(releaseRoot, 'win-unpacked', 'AmazonAIOpsAgent.exe'),
    appContentPath: path.join(releaseRoot, 'win-unpacked', 'resources', 'app'),
    mainBundlePath: path.join(releaseRoot, 'win-unpacked', 'resources', 'app', 'dist', 'main', 'index.js'),
    authorityDbPath,
    authorityDbError,
    authoritySnapshotRoot: path.join(ROOT, 'output', 'codex-evidence', 'authority-snapshots'),
  };
}

function defaultOutputPath() {
  return path.join(ROOT, 'output', 'codex-evidence', `mission-control-production-readiness-${Date.now()}.json`);
}

function parseArgs(argv) {
  const values = {};
  const errors = [];
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help') {
      help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      errors.push(`Unexpected argument: ${token}`);
      continue;
    }
    const requestedKey = token.slice(2);
    const key = OPTION_ALIASES[requestedKey] || requestedKey;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      errors.push(`Missing value for --${requestedKey}`);
      continue;
    }
    index += 1;
    if (!ALLOWED_OPTIONS.has(key)) {
      errors.push(`Unexpected argument: --${requestedKey}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      errors.push(`Duplicate argument: --${requestedKey}`);
      continue;
    }
    values[key] = value;
  }
  if (!help && !Object.prototype.hasOwnProperty.call(values, 'authority-db')) {
    errors.push('Missing required argument: --authority-db');
  }
  return { errors, help, values };
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value) {
  return /^[A-F0-9]{64}$/.test(String(value || '').toUpperCase());
}

function normalizeSha256(value) {
  return isSha256(value) ? String(value).toUpperCase() : null;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validTimestamp(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stableEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function normalizeLogicalId(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(normalized) ? normalized : null;
}

function isPathContained(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sqliteIntegrityCheck(database) {
  return database.pragma('integrity_check').map((row) => String(row.integrity_check ?? row[Object.keys(row)[0]]));
}

function withVerifiedReadOnlyDatabase(databaseEvidence, label, reasons, reader, context = {}) {
  pushReason(reasons, databaseEvidence?.openedReadOnly === true, `${label} database was not declared read-only`);
  pushReason(
    reasons,
    nonEmpty(context.authoritySnapshotPath) && realpathEquals(databaseEvidence?.absolutePath, context.authoritySnapshotPath),
    `${label} database is not the explicitly selected canonical authority snapshot`,
  );
  pushReason(
    reasons,
    normalizeSha256(databaseEvidence?.snapshotManifestSha256) === normalizeSha256(context.authoritySnapshotManifestSha256),
    `${label} database is not bound to the explicit authority snapshot manifest`,
  );
  pushReason(
    reasons,
    stableEqual(databaseEvidence?.packageIdentity, context.packageIdentity),
    `${label} database proof is not bound to the current package identity`,
  );
  const databaseCurrent = nonEmpty(databaseEvidence?.absolutePath)
    && path.isAbsolute(databaseEvidence.absolutePath)
    && currentFileMatches({
      path: databaseEvidence.absolutePath,
      sizeBytes: databaseEvidence.sizeBytes,
      sha256: databaseEvidence.sha256,
    });
  pushReason(reasons, databaseCurrent, `${label} database snapshot is missing or its hash is stale`);
  if (!databaseCurrent) return null;

  let database;
  try {
    // Loaded lazily so malformed/missing evidence still produces an APP_NEEDS_WORK report.
    const Database = requireFromLocalDb('better-sqlite3');
    database = new Database(databaseEvidence.absolutePath, { readonly: true, fileMustExist: true });
    database.pragma('query_only = ON');
    const queryOnly = Number(database.pragma('query_only', { simple: true })) === 1;
    const integrityCheck = sqliteIntegrityCheck(database);
    const foreignKeyViolations = database.pragma('foreign_key_check');
    pushReason(reasons, queryOnly, `${label} authority database did not enter SQLite query_only mode`);
    pushReason(
      reasons,
      integrityCheck.length === 1 && integrityCheck[0] === 'ok',
      `${label} authority database integrity_check did not return ok`,
    );
    pushReason(
      reasons,
      stableEqual(databaseEvidence.integrityCheck, integrityCheck),
      `${label} claimed database integrity result does not match the read-only query`,
    );
    pushReason(
      reasons,
      Array.isArray(foreignKeyViolations) && foreignKeyViolations.length === 0,
      `${label} authority database foreign_key_check found violations`,
    );
    return reader(database, integrityCheck);
  } catch (error) {
    reasons.push(`${label} authority database could not be queried read-only: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    if (database) database.close();
    pushReason(
      reasons,
      currentFileMatches({
        path: databaseEvidence.absolutePath,
        sizeBytes: databaseEvidence.sizeBytes,
        sha256: databaseEvidence.sha256,
      }),
      `${label} database snapshot changed while it was being verified`,
    );
  }
}

function samePath(left, right) {
  if (!nonEmpty(left) || !nonEmpty(right)) return false;
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function uniqueExactStrings(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return new Set(actual).size === actual.length
    && expected.every((value) => actual.includes(value));
}

function currentFileMatches(record, pathField = 'path') {
  const filePath = record?.[pathField];
  if (!nonEmpty(filePath) || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) return false;
  if (fs.lstatSync(filePath).isSymbolicLink()
    || hasUnsafeFilesystemLink(path.parse(path.resolve(filePath)).root, filePath)) return false;
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.nlink !== 1 || !isSha256(record.sha256) || Number(record.sizeBytes) !== stat.size) return false;
  return sha256File(filePath) === String(record.sha256).toUpperCase();
}

function realpathEquals(left, right) {
  try {
    return fs.realpathSync.native(path.resolve(left)).toLowerCase()
      === fs.realpathSync.native(path.resolve(right)).toLowerCase();
  } catch {
    return false;
  }
}

function requestedPathEqualsRealpath(candidate) {
  try {
    return path.resolve(candidate).toLowerCase() === fs.realpathSync.native(candidate).toLowerCase();
  } catch {
    return false;
  }
}

function realpathIsContained(rootPath, candidatePath) {
  try {
    return isPathContained(fs.realpathSync.native(rootPath), fs.realpathSync.native(candidatePath));
  } catch {
    return false;
  }
}

function latestTreeMtimeMs(rootPath) {
  let latest = fs.statSync(rootPath).mtimeMs;
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    const target = path.join(rootPath, entry.name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error(`canonical package contains a filesystem link: ${target}`);
    latest = Math.max(latest, stat.mtimeMs, entry.isDirectory() ? latestTreeMtimeMs(target) : 0);
  }
  return latest;
}

function inspectCanonicalPackage(context) {
  const reasons = [];
  const expectedRelease = path.resolve(context.releaseRoot);
  pushReason(reasons, fs.existsSync(expectedRelease), 'canonical repository release root is missing');
  if (!fs.existsSync(expectedRelease)) return validationResult(reasons, { packageIdentity: null, builtAtMs: null });
  pushReason(reasons, realpathEquals(expectedRelease, context.releaseRoot), 'canonical repository release root did not pass realpath validation');
  for (const [label, candidate] of [
    ['win-unpacked executable', context.executablePath],
    ['resources/app', context.appContentPath],
    ['main bundle', context.mainBundlePath],
  ]) {
    pushReason(reasons, isPathContained(expectedRelease, candidate), `canonical ${label} escapes the repository release root`);
    pushReason(reasons, fs.existsSync(candidate), `canonical ${label} is missing`);
  }
  if (reasons.length > 0) return validationResult(reasons, { packageIdentity: null, builtAtMs: null });
  try {
    const exeStat = fs.statSync(context.executablePath);
    const mainStat = fs.statSync(context.mainBundlePath);
    pushReason(reasons, requestedPathEqualsRealpath(context.executablePath) && exeStat.isFile() && exeStat.nlink === 1, 'canonical win-unpacked executable is not a unique regular file or traverses a reparse point');
    pushReason(reasons, requestedPathEqualsRealpath(context.mainBundlePath) && mainStat.isFile() && mainStat.nlink === 1, 'canonical main bundle is not a unique regular file or traverses a reparse point');
    const { buildAppContentManifest } = require('./package-ui-evidence');
    const beforeExe = sha256File(context.executablePath);
    const beforeMain = sha256File(context.mainBundlePath);
    const appContent = buildAppContentManifest(context.appContentPath);
    const afterExe = sha256File(context.executablePath);
    const afterMain = sha256File(context.mainBundlePath);
    pushReason(reasons, beforeExe === afterExe && beforeMain === afterMain, 'canonical package changed while hashes were recomputed');
    return validationResult(reasons, {
      packageIdentity: {
        executableSha256: afterExe,
        appContentSha256: normalizeSha256(appContent.sha256),
        mainBundleSha256: afterMain,
      },
      builtAtMs: Math.max(exeStat.mtimeMs, mainStat.mtimeMs, latestTreeMtimeMs(context.appContentPath)),
    });
  } catch (error) {
    reasons.push(`canonical package could not be recomputed: ${error instanceof Error ? error.message : String(error)}`);
    return validationResult(reasons, { packageIdentity: null, builtAtMs: null });
  }
}

function validateAuthoritySnapshotManifest(selection, context, canonicalPackage) {
  const reasons = [];
  const manifest = selection?.evidence;
  pushReason(reasons, isRecord(manifest), 'authority snapshot manifest is missing or invalid');
  if (!isRecord(manifest)) return validationResult(reasons);
  pushReason(reasons, manifest.kind === AUTHORITY_SNAPSHOT_KIND, 'authority snapshot manifest kind is invalid');
  pushReason(
    reasons,
    manifest.schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    `authority snapshot manifest must use ${AUTHORITY_SNAPSHOT_SCHEMA_VERSION}; v1 is rejected fail-closed`,
  );
  pushReason(reasons, validTimestamp(manifest.exportedAt), 'authority snapshot exportedAt is invalid');
  pushReason(reasons, manifest.backup?.method === AUTHORITY_SNAPSHOT_BACKUP_METHOD, 'authority snapshot backup method is not SQLite online backup');
  pushReason(reasons, validTimestamp(manifest.backup?.startedAt), 'authority snapshot backup startedAt is invalid');
  pushReason(reasons, validTimestamp(manifest.backup?.completedAt), 'authority snapshot backup completedAt is invalid');
  pushReason(
    reasons,
    validTimestamp(manifest.backup?.startedAt)
      && validTimestamp(manifest.backup?.completedAt)
      && Date.parse(manifest.backup.startedAt) <= Date.parse(manifest.backup.completedAt),
    'authority snapshot backup timestamps are out of order',
  );
  pushReason(reasons, manifest.exportedAt === manifest.backup?.completedAt, 'authority snapshot exportedAt is not bound to backup completion');
  pushReason(reasons, manifest.backup?.completed === true, 'authority snapshot online backup did not declare completion');
  pushReason(reasons, isPositiveInteger(manifest.backup?.totalPages), 'authority snapshot online backup totalPages is invalid');
  pushReason(reasons, manifest.backup?.remainingPages === 0, 'authority snapshot online backup has remaining pages');
  pushReason(reasons, nonEmpty(context.authorityDbPath), `canonical authority database is unavailable: ${context.authorityDbError || 'not selected'}`);
  pushReason(
    reasons,
    nonEmpty(manifest.source?.absolutePath)
      && path.basename(manifest.source.absolutePath).toLowerCase() === 'amazon-ai-ops.db',
    'authority snapshot source must be the canonical USER_DATA_DIR/amazon-ai-ops.db filename',
  );
  pushReason(reasons, realpathEquals(manifest.source?.absolutePath, context.authorityDbPath), 'authority snapshot source is not the canonical live AppData database');
  pushReason(reasons, realpathEquals(manifest.source?.realPath, context.authorityDbPath), 'authority snapshot source realpath is not canonical');
  pushReason(reasons, manifest.source?.openedReadOnly === true, 'authority snapshot source was not opened read-only');
  pushReason(reasons, manifest.source?.queryOnly === true, 'authority snapshot source did not prove SQLite query_only mode');
  pushReason(reasons, stableEqual(manifest.source?.integrityCheck, ['ok']), 'authority snapshot source integrity_check proof is invalid');
  pushReason(reasons, stableEqual(manifest.source?.foreignKeyCheck, []), 'authority snapshot source foreign_key_check proof is invalid');
  for (const [label, record] of [
    ['before', manifest.source?.artifactBefore],
    ['after', manifest.source?.artifactAfter],
  ]) {
    pushReason(
      reasons,
      isRecord(record)
        && isSha256(record.sha256)
        && Number.isInteger(record.sizeBytes)
        && record.sizeBytes > 0
        && Number.isFinite(record.mtimeMs),
      `authority snapshot source ${label} artifact proof is invalid`,
    );
  }
  pushReason(
    reasons,
    stableEqual(manifest.source?.artifactBefore, manifest.source?.artifactAfter),
    'authority snapshot source artifactBefore and artifactAfter do not prove one unchanged live database',
  );
  try {
    const sourcePath = path.resolve(manifest.source?.absolutePath);
    const sourceStatBefore = fs.statSync(sourcePath);
    pushReason(
      reasons,
      requestedPathEqualsRealpath(sourcePath)
        && !fs.lstatSync(sourcePath).isSymbolicLink()
        && sourceStatBefore.isFile()
        && sourceStatBefore.nlink === 1,
      'authority snapshot source is linked, reparsed, or not a unique regular file',
    );
    const sourceSha256Before = sha256File(sourcePath);
    const sourceStatDuring = fs.statSync(sourcePath);
    const sourceSha256After = sha256File(sourcePath);
    const sourceStatAfter = fs.statSync(sourcePath);
    pushReason(
      reasons,
      sourceSha256Before === sourceSha256After
        && sourceStatBefore.size === sourceStatDuring.size
        && sourceStatBefore.size === sourceStatAfter.size
        && sourceStatBefore.mtimeMs === sourceStatDuring.mtimeMs
        && sourceStatBefore.mtimeMs === sourceStatAfter.mtimeMs,
      'authority snapshot live source changed while formal bytes/size/mtime were recomputed',
    );
    pushReason(
      reasons,
      normalizeSha256(manifest.source?.artifactAfter?.sha256) === sourceSha256After
        && Number(manifest.source?.artifactAfter?.sizeBytes) === sourceStatAfter.size
        && Number(manifest.source?.artifactAfter?.mtimeMs) === sourceStatAfter.mtimeMs,
      'authority snapshot live source bytes/size/mtime drifted after snapshot export',
    );
  } catch {
    reasons.push('authority snapshot source cannot be resolved as the selected unique live database');
  }
  const snapshotPath = manifest.snapshot?.absolutePath;
  let snapshotRootReal = null;
  let snapshotReal = null;
  try {
    snapshotRootReal = fs.realpathSync.native(context.authoritySnapshotRoot);
    snapshotReal = fs.realpathSync.native(snapshotPath);
  } catch {
    // Reported by the explicit checks below.
  }
  pushReason(reasons, requestedPathEqualsRealpath(context.authoritySnapshotRoot), 'canonical authority snapshot root traverses a reparse point');
  pushReason(reasons, isPathContained(context.authoritySnapshotRoot, selection.evidencePath) && realpathIsContained(context.authoritySnapshotRoot, selection.evidencePath), 'authority snapshot manifest is outside the canonical snapshot root');
  pushReason(reasons, nonEmpty(snapshotPath) && path.isAbsolute(snapshotPath), 'authority snapshot path is missing');
  pushReason(reasons, nonEmpty(snapshotPath) && isPathContained(context.authoritySnapshotRoot, snapshotPath), 'authority snapshot is outside the canonical snapshot root');
  pushReason(reasons, snapshotRootReal && snapshotReal && isPathContained(snapshotRootReal, snapshotReal), 'authority snapshot realpath escapes the canonical snapshot root');
  pushReason(reasons, realpathEquals(snapshotPath, manifest.snapshot?.realPath), 'authority snapshot realpath binding is invalid');
  pushReason(reasons, !realpathEquals(snapshotPath, context.authorityDbPath), 'authority snapshot must be an independent database file');
  pushReason(reasons, manifest.snapshot?.openedReadOnly === true, 'authority snapshot validation was not opened read-only');
  pushReason(reasons, manifest.snapshot?.queryOnly === true, 'authority snapshot validation did not prove SQLite query_only mode');
  pushReason(reasons, stableEqual(manifest.snapshot?.integrityCheck, ['ok']), 'authority snapshot claimed integrity_check proof is invalid');
  pushReason(reasons, stableEqual(manifest.snapshot?.foreignKeyCheck, []), 'authority snapshot claimed foreign_key_check proof is invalid');
  pushReason(reasons, currentFileMatches(manifest.snapshot, 'absolutePath'), 'authority snapshot bytes are missing, linked, or stale');
  pushReason(reasons, stableEqual(manifest.packageIdentity, canonicalPackage.packageIdentity), 'authority snapshot is not bound to the current canonical package identity');
  let snapshotDatabase;
  try {
    const Database = requireFromLocalDb('better-sqlite3');
    snapshotDatabase = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    snapshotDatabase.pragma('query_only = ON');
    const queryOnly = Number(snapshotDatabase.pragma('query_only', { simple: true })) === 1;
    const integrityCheck = sqliteIntegrityCheck(snapshotDatabase);
    const foreignKeyCheck = snapshotDatabase.pragma('foreign_key_check');
    pushReason(reasons, queryOnly, 'authority snapshot did not enter SQLite query_only mode during formal verification');
    pushReason(
      reasons,
      stableEqual(integrityCheck, ['ok']) && stableEqual(integrityCheck, manifest.snapshot?.integrityCheck),
      'authority snapshot formal integrity_check did not match the v2 manifest',
    );
    pushReason(
      reasons,
      stableEqual(foreignKeyCheck, []) && stableEqual(foreignKeyCheck, manifest.snapshot?.foreignKeyCheck),
      'authority snapshot formal foreign_key_check did not match the v2 manifest',
    );
  } catch (error) {
    reasons.push(`authority snapshot could not be reopened read-only: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (snapshotDatabase) snapshotDatabase.close();
  }
  pushReason(
    reasons,
    currentFileMatches(manifest.snapshot, 'absolutePath'),
    'authority snapshot bytes changed during formal verification',
  );
  return validationResult(reasons, { manifest, snapshotPath: nonEmpty(snapshotPath) ? path.resolve(snapshotPath) : null });
}

function validationResult(reasons, extras = {}) {
  return {
    ok: reasons.length === 0,
    reason: reasons.length === 0 ? 'Evidence passed its production contract.' : reasons.join('; '),
    ...extras,
  };
}

function pushReason(reasons, condition, message) {
  if (!condition) reasons.push(message);
}

function expectedAuthoritySnapshotArtifact(snapshotSelection) {
  const snapshot = snapshotSelection?.evidence?.snapshot;
  if (
    !isRecord(snapshot)
    || !isSha256(snapshot.sha256)
    || !Number.isInteger(snapshot.sizeBytes)
    || snapshot.sizeBytes <= 0
  ) {
    return null;
  }
  return Object.freeze({
    sha256: normalizeSha256(snapshot.sha256),
    sizeBytes: snapshot.sizeBytes,
  });
}

function captureAuthorityCurrentness(
  sourceDatabasePath,
  expectedSnapshotArtifact,
  captureLabel,
  injectedContext = null,
) {
  if (!nonEmpty(sourceDatabasePath)) {
    return {
      ok: false,
      proof: null,
      reason: `WAL-aware authority currentness ${captureLabel} cannot run without the selected live authority database.`,
    };
  }
  if (!expectedSnapshotArtifact) {
    return {
      ok: false,
      proof: null,
      reason: `WAL-aware authority currentness ${captureLabel} cannot run without a valid selected snapshot SHA-256 and size.`,
    };
  }
  try {
    const helperContext = isRecord(injectedContext?.authorityCurrentnessHelperContext)
      ? injectedContext.authorityCurrentnessHelperContext
      : undefined;
    const proof = captureAuthoritySnapshotCurrentness({
      sourceDatabasePath,
      expectedSnapshotArtifact,
      captureLabel,
    }, helperContext);
    return {
      ok: true,
      proof,
      reason: 'WAL-aware read-only SQLite online backup matches the selected authority snapshot.',
    };
  } catch (error) {
    return {
      ok: false,
      proof: null,
      reason: `WAL-aware authority currentness ${captureLabel} failed closed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function publicAuthorityCurrentnessProof(proof) {
  if (!isRecord(proof)) return null;
  return {
    captureLabel: proof.captureLabel ?? null,
    capturedAt: proof.capturedAt ?? null,
    method: proof.method ?? null,
    sourceReadOnly: proof.source?.openedReadOnly === true && proof.source?.queryOnly === true,
    observedSnapshot: {
      sha256: normalizeSha256(proof.observedBackup?.sha256) || null,
      sizeBytes: Number.isInteger(proof.observedBackup?.sizeBytes)
        ? proof.observedBackup.sizeBytes
        : null,
    },
    matchesSelectedSnapshot: proof.matchesSelectedSnapshot === true,
  };
}

function publicAuthorityCurrentnessSummary(state) {
  const proofs = Array.isArray(state?.proofs) ? state.proofs : [];
  const failures = Array.isArray(state?.failures) ? state.failures : [];
  const captureSummaries = proofs.map(publicAuthorityCurrentnessProof).filter(Boolean);
  const byLabel = new Map(captureSummaries.map((proof) => [proof.captureLabel, proof]));
  return {
    schemaVersion: SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
    method: 'readonly-sqlite-online-backup',
    passed: failures.length === 0 && proofs.length > 0,
    expectedSnapshot: state?.expectedSnapshotArtifact
      ? {
        sha256: state.expectedSnapshotArtifact.sha256,
        sizeBytes: state.expectedSnapshotArtifact.sizeBytes,
      }
      : null,
    captures: captureSummaries,
    beforeFinalWriteCapturedAt: byLabel.get('before-final-report-write')?.capturedAt ?? null,
    afterFinalWriteCapturedAt: byLabel.get('after-final-report-write')?.capturedAt ?? null,
    failures: [...failures],
  };
}

function mergeSnapshotCurrentnessValidation(snapshotValidation, captureResult) {
  if (captureResult.ok) {
    return {
      ...snapshotValidation,
      initialCurrentnessProof: captureResult.proof,
    };
  }
  return {
    ...snapshotValidation,
    ok: false,
    reason: snapshotValidation.reason === 'Evidence passed its production contract.'
      ? captureResult.reason
      : `${snapshotValidation.reason}; ${captureResult.reason}`,
    initialCurrentnessProof: null,
  };
}

function validateV15FinalReadiness(evidence, context) {
  const reasons = [];
  pushReason(reasons, isRecord(evidence), 'v1.5 final-readiness evidence must be an object');
  if (!isRecord(evidence)) return validationResult(reasons);
  pushReason(reasons, validTimestamp(evidence.generatedAt), 'v1.5 final-readiness generatedAt is invalid');
  pushReason(reasons, evidence.manifestDriven === true, 'v1.5 final-readiness is not manifest driven');
  pushReason(reasons, evidence.evidenceSelection?.mode === 'manifest', 'v1.5 final-readiness did not use an explicit evidence manifest');
  const manifestPath = evidence.evidenceSelection?.manifestPath;
  pushReason(
    reasons,
    nonEmpty(manifestPath) && path.isAbsolute(manifestPath) && fs.existsSync(manifestPath) && fs.statSync(manifestPath).isFile(),
    'v1.5 evidence manifest path is missing or no longer exists',
  );
  const gates = Array.isArray(evidence.gates) ? evidence.gates : [];
  pushReason(reasons, uniqueExactStrings(gates.map((gate) => gate?.id), V15_GATE_IDS), 'v1.5 final-readiness must retain exactly its eight formal gates');
  const supersededGate = gates.find((gate) => gate?.id === V15_SUPERSEDED_GATE_ID);
  const otherGates = gates.filter((gate) => gate?.id !== V15_SUPERSEDED_GATE_ID);
  const failures = Array.isArray(evidence.failures) ? evidence.failures : [];
  const readyState = evidence.status === 'APP_READY'
    && evidence.appReady === true
    && evidence.allGatesPass === true
    && evidence.formalAllGatesPass === true
    && gates.length === 8
    && gates.every((gate) => gate?.ok === true && gate?.status === 'passed')
    && Array.isArray(evidence.failures)
    && failures.length === 0
    && Array.isArray(evidence.missing)
    && evidence.missing.length === 0;
  const supersededState = evidence.status === 'APP_NEEDS_WORK'
    && evidence.appReady === false
    && evidence.allGatesPass === false
    && evidence.formalAllGatesPass === false
    && gates.length === 8
    && otherGates.length === 7
    && otherGates.every((gate) => gate?.ok === true && gate?.status === 'passed')
    && supersededGate?.ok === false
    && supersededGate?.status === 'needs_work'
    && failures.length === 1
    && failures[0]?.gateId === V15_SUPERSEDED_GATE_ID
    && failures[0]?.code === 'GATE_FAILED'
    && samePath(failures[0]?.evidencePath, supersededGate?.evidencePath)
    && nonEmpty(failures[0]?.message)
    && Array.isArray(evidence.missing)
    && evidence.missing.length === 1
    && evidence.missing[0] === failures[0]?.message;
  pushReason(
    reasons,
    readyState || supersededState,
    'v1.5 legacy baseline must be either genuine APP_READY 8/8 or APP_NEEDS_WORK 7/8 with only real-ad-execution-readback superseded',
  );

  const packageIndex = evidence.packageIndex;
  const packages = Array.isArray(packageIndex?.packages) ? packageIndex.packages : [];
  const packageKinds = packages.map((item) => item?.kind);
  pushReason(
    reasons,
    packageIndex?.present === true
      && packageIndex?.error === null
      && packageIndex?.count === 2
      && packageIndex?.existingCount === 2
      && packageIndex?.missingCount === 0
      && uniqueExactStrings(packageKinds, ['installer', 'portable']),
    'v1.5 package index is incomplete',
  );
  pushReason(reasons, packages.length === 2 && packages.every((item) => item?.exists === true && currentFileMatches(item, 'sourcePath')), 'v1.5 release package hashes are stale');
  pushReason(reasons, realpathEquals(packageIndex?.releaseDir, context.canonicalReleaseRoot), 'v1.5 package index is not anchored to the canonical repository release root');
  pushReason(reasons, packages.every((item) => isPathContained(context.canonicalReleaseRoot, item?.sourcePath) && realpathIsContained(context.canonicalReleaseRoot, item?.sourcePath)), 'v1.5 package index contains an artifact outside the canonical release root');
  const portable = packages.find((item) => item?.kind === 'portable');
  pushReason(
    reasons,
    portable
      && samePath(portable.sourcePath, evidence.currentPortablePackage?.sourcePath)
      && portable.sha256 === evidence.currentPortablePackage?.sha256,
    'v1.5 current portable package does not match its package index',
  );

  const selectedLaunch = evidence.packageLaunchSmoke;
  pushReason(reasons, selectedLaunch?.present === true && selectedLaunch?.passed === true, 'v1.5 package launch selection did not pass');
  pushReason(reasons, selectedLaunch?.selectedBy === 'explicit-arg', 'v1.5 package launch was not explicitly selected');
  pushReason(reasons, samePath(selectedLaunch?.evidencePath, context.packageLaunchPath), 'v1.5 package launch selection does not match the explicit Stage 7 input');
  const selectedAdversarial = evidence.packageAdversarialNodeEnv;
  pushReason(reasons, selectedAdversarial?.present === true && selectedAdversarial?.passed === true, 'v1.5 adversarial NODE_ENV selection did not pass');
  pushReason(
    reasons,
    selectedAdversarial?.selectedBy === 'explicit-arg' || selectedAdversarial?.selectedBy === 'evidence-manifest',
    'v1.5 adversarial NODE_ENV evidence used an implicit latest fallback',
  );
  pushReason(reasons, samePath(selectedAdversarial?.evidencePath, context.packageAdversarialPath), 'v1.5 adversarial NODE_ENV selection does not match the explicit Stage 7 input');
  if (nonEmpty(context.packageAdversarialPath) && fs.existsSync(context.packageAdversarialPath)) {
    pushReason(
      reasons,
      normalizeSha256(selectedAdversarial?.evidenceSha256) === sha256File(context.packageAdversarialPath),
      'v1.5 adversarial NODE_ENV evidence SHA-256 is stale',
    );
  }
  const packageIdentity = {
    executableSha256: normalizeSha256(selectedAdversarial?.package?.executableSha256),
    appContentSha256: normalizeSha256(selectedAdversarial?.package?.appContentSha256),
    mainBundleSha256: normalizeSha256(selectedAdversarial?.package?.mainBundleSha256),
  };
  pushReason(reasons, PACKAGE_IDENTITY_FIELDS.every((field) => packageIdentity[field]), 'v1.5 final-readiness package identity is incomplete');
  return validationResult(reasons, {
    packageIdentity,
    ...(supersededState ? { supersededBy: V15_SUPERSEDING_GATE_IDS } : {}),
    ...(reasons.length === 0 ? {
      reason: supersededState
        ? 'Legacy v1.5 baseline passed at 7/8; real-ad-execution-readback is superseded by the two DB-backed Stage 7 canaries.'
        : 'Legacy v1.5 APP_READY baseline passed all eight formal gates.',
    } : {}),
  });
}

function validatePackageLaunch(evidence, context = {}) {
  const reasons = [];
  pushReason(reasons, isRecord(evidence), 'package launch evidence must be an object');
  if (!isRecord(evidence)) return validationResult(reasons);
  const strictValidation = validatePackageLaunchSmokeEvidence(evidence);
  pushReason(
    reasons,
    strictValidation.passed === true,
    `package launch strict contract failed: ${(strictValidation.violations || [])
      .map((violation) => `${violation.code}@${violation.path}`)
      .join(', ')}`,
  );
  pushReason(reasons, evidence.kind === 'package-launch-smoke', 'unexpected package launch evidence kind');
  pushReason(reasons, validTimestamp(evidence.generatedAt), 'package launch generatedAt is invalid');
  pushReason(reasons, evidence.evidenceMode === 'package-launch-smoke', 'package launch evidence mode is invalid');
  pushReason(reasons, evidence.passed === true, 'package launch evidence did not pass');
  pushReason(reasons, evidence.userDataOverrideBundleContract?.passed === true, 'packaged userData override contract did not pass');
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  pushReason(reasons, uniqueExactStrings(checks.map((check) => check?.kind), ['win-unpacked', 'portable']), 'package launch must contain exactly unpacked and portable checks');
  pushReason(reasons, checks.every((check) => check?.ok === true && check?.userDataEvidence?.passed === true), 'package launch or isolated userData check failed');
  const unpacked = evidence.artifacts?.unpacked;
  const portable = evidence.artifacts?.portable;
  pushReason(reasons, currentFileMatches(unpacked), 'win-unpacked package launch artifact is missing or stale');
  pushReason(reasons, realpathEquals(unpacked?.path, context.canonicalExecutablePath), 'package launch did not execute the canonical win-unpacked EXE');
  pushReason(reasons, isPathContained(context.canonicalReleaseRoot, portable?.path) && realpathIsContained(context.canonicalReleaseRoot, portable?.path), 'package launch portable artifact is outside the canonical release root');
  pushReason(reasons, currentFileMatches(portable), 'portable package launch artifact is missing or stale');
  const packageIdentity = {
    executableSha256: normalizeSha256(unpacked?.sha256),
    portableSha256: normalizeSha256(portable?.sha256),
  };
  return validationResult(reasons, { packageIdentity });
}

function validatePackageUi(evidence) {
  const reasons = [];
  pushReason(reasons, isRecord(evidence), 'package UI evidence must be an object');
  if (!isRecord(evidence)) return validationResult(reasons);
  pushReason(reasons, evidence.kind === 'package-ui-evidence', 'unexpected package UI evidence kind');
  pushReason(
    reasons,
    evidence.schemaVersion === 8,
    'package UI evidence must use current production two-phase interactive-login schema v8; schemas v5/v6/v7 are historical only',
  );
  pushReason(reasons, validTimestamp(evidence.generatedAt), 'package UI generatedAt is invalid');
  pushReason(reasons, evidence.passed === true, 'package UI evidence did not pass');
  let completeness;
  try {
    const { evaluatePackageUiEvidenceCompleteness } = require('./package-ui-evidence');
    completeness = evaluatePackageUiEvidenceCompleteness(evidence);
  } catch (error) {
    reasons.push(`package UI contract could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (completeness) {
    pushReason(
      reasons,
      completeness.passed === true,
      `package UI completeness failed: ${completeness.violations.map((item) => item.code || item.message).join(', ')}`,
    );
  }
  const runs = Array.isArray(evidence.runs) ? evidence.runs : [];
  pushReason(reasons, uniqueExactStrings(runs.map((run) => run?.scalePercent), [100, 125]), 'package UI must contain exactly one 100% and one 125% run');
  let expectedWorkspaces = [];
  let expectedSubviews = [];
  let expectedOverlays = [];
  let packageUiContract = null;
  try {
    packageUiContract = require('./package-ui-evidence');
    expectedWorkspaces = packageUiContract.EXPECTED_PACKAGE_UI_WORKSPACES.map((item) => item.workspace);
    expectedSubviews = packageUiContract.EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS.map(
      (item) => `${item.workspace}/${item.subview}`,
    );
    expectedOverlays = [...packageUiContract.EXPECTED_OVERLAY_CHECK_IDS];
  } catch (error) {
    reasons.push(`package UI workspace contract could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
  pushReason(reasons, expectedWorkspaces.length === 10, 'repository package UI contract is not the ten-workspace Stage 7 matrix');
  pushReason(reasons, stableEqual(expectedSubviews, ['settings/scheduler']), 'repository package UI scheduler subview contract is invalid');
  for (const run of runs) {
    pushReason(reasons, run?.passed === true, `${run?.scalePercent || 'unknown'}% package UI run did not pass`);
    pushReason(
      reasons,
      uniqueExactStrings((run?.workspaceChecks || []).map((item) => item?.workspace), expectedWorkspaces),
      `${run?.scalePercent || 'unknown'}% package UI workspace checks are not the exact ten-workspace matrix`,
    );
    pushReason(
      reasons,
      uniqueExactStrings((run?.screenshots || []).map((item) => item?.workspace), expectedWorkspaces),
      `${run?.scalePercent || 'unknown'}% package UI screenshots are not the exact ten-workspace matrix`,
    );
    pushReason(
      reasons,
      uniqueExactStrings((run?.overlayChecks || []).map((item) => item?.id), expectedOverlays),
      `${run?.scalePercent || 'unknown'}% package UI overlay evidence is incomplete`,
    );
    pushReason(
      reasons,
      (run?.screenshots || []).every((item) => currentFileMatches(item)),
      `${run?.scalePercent || 'unknown'}% package UI workspace screenshot files are missing or stale`,
    );
    pushReason(
      reasons,
      (run?.overlayChecks || []).every((item) => currentFileMatches(item?.screenshot)),
      `${run?.scalePercent || 'unknown'}% package UI overlay screenshot files are missing or stale`,
    );
    pushReason(
      reasons,
      uniqueExactStrings(
        (run?.subviewChecks || []).map((item) => `${item?.workspace}/${item?.subview}`),
        expectedSubviews,
      ),
      `${run?.scalePercent || 'unknown'}% package UI read-only subview checks are incomplete`,
    );
    pushReason(
      reasons,
      (run?.subviewChecks || []).every((item) => (
        item?.passed === true
        && packageUiContract?.validateSchedulerSubviewEvidence(
          item?.identityCapabilityEvidence,
          packageUiContract.EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS.find((expected) => (
            expected.workspace === item?.workspace && expected.subview === item?.subview
          )),
        ).passed === true
        && currentFileMatches(item?.screenshot)
      )),
      `${run?.scalePercent || 'unknown'}% package UI read-only subview screenshot files are missing or stale`,
    );
    pushReason(
      reasons,
      packageUiContract?.validatePackageUiReadOnlyRuntimeEvidence(
        run?.schedulerReadOnlyRuntime,
        { requireSchedulerReads: true },
      ).passed === true
        && currentFileMatches(run?.schedulerReadOnlyRuntime?.artifact),
      `${run?.scalePercent || 'unknown'}% package UI Main scheduler read-only runtime evidence is missing or stale`,
    );
  }
  pushReason(
    reasons,
    (evidence.wideProfile?.screenshots || []).every((item) => currentFileMatches(item))
      && (evidence.wideProfile?.workspaceChecks || []).every((item) => (
        !item?.inspectorEvidence?.screenshot || currentFileMatches(item.inspectorEvidence.screenshot)
      )),
    'package UI wide-profile screenshot files are missing or stale',
  );
  pushReason(
    reasons,
    packageUiContract?.validatePackageUiReadOnlyRuntimeEvidence(
      evidence.wideProfile?.schedulerReadOnlyRuntime,
      { requireSchedulerReads: false },
    ).passed === true
      && currentFileMatches(evidence.wideProfile?.schedulerReadOnlyRuntime?.artifact),
    'package UI wide-profile Main scheduler read-only runtime evidence is missing or stale',
  );
  const before = evidence.artifactsBefore;
  const after = evidence.artifactsAfter;
  const packageIdentity = {
    executableSha256: normalizeSha256(before?.exe?.sha256),
    appContentSha256: normalizeSha256(before?.appContent?.sha256),
  };
  pushReason(reasons, packageIdentity.executableSha256 && packageIdentity.appContentSha256, 'package UI package identity is incomplete');
  pushReason(
    reasons,
    packageIdentity.executableSha256 === normalizeSha256(after?.exe?.sha256)
      && packageIdentity.appContentSha256 === normalizeSha256(after?.appContent?.sha256),
    'package UI package identity changed during capture',
  );
  pushReason(
    reasons,
    packageIdentity.executableSha256 === normalizeSha256(evidence.requested?.expectedExeSha256)
      && packageIdentity.appContentSha256 === normalizeSha256(evidence.requested?.expectedAppContentSha256),
    'package UI package identity does not match its explicit expected hashes',
  );
  return validationResult(reasons, { packageIdentity });
}

function validatePackageSecurity(evidence) {
  const reasons = [];
  let validation;
  try {
    const { validatePackageSecurityEvidence } = require('./smoke-package-security-boundaries');
    validation = validatePackageSecurityEvidence(evidence);
  } catch (error) {
    reasons.push(`package security contract could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (validation && !validation.passed) reasons.push(...validation.violations);
  const packageIdentity = {
    executableSha256: normalizeSha256(evidence?.package?.executableSha256),
    appContentSha256: normalizeSha256(evidence?.package?.appContentSha256),
    mainBundleSha256: normalizeSha256(evidence?.package?.mainBundleSha256),
  };
  return validationResult(reasons, { packageIdentity });
}

function validatePackageAdversarialNodeEnv(evidence) {
  const reasons = [];
  let validation;
  try {
    const { validateAdversarialNodeEnvEvidence } = require('./smoke-package-adversarial-node-env');
    validation = validateAdversarialNodeEnvEvidence(evidence);
  } catch (error) {
    reasons.push(`adversarial NODE_ENV contract could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (validation && !validation.passed) reasons.push(...validation.violations);
  const packageIdentity = {
    executableSha256: normalizeSha256(evidence?.package?.executableSha256),
    appContentSha256: normalizeSha256(evidence?.package?.appContentSha256),
    mainBundleSha256: normalizeSha256(evidence?.package?.mainBundleSha256),
  };
  return validationResult(reasons, { packageIdentity });
}

function isUsBusinessDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return false;
  return date.getUTCDay() >= 1 && date.getUTCDay() <= 5;
}

function continuousDayProjection(day) {
  const projected = {
    businessDate: day?.businessDate,
    outcome: day?.outcome,
    accepted: day?.accepted,
    jobId: day?.jobId ?? null,
    reportCount: day?.reportCount,
    importRunId: day?.importRunId ?? null,
  };
  if (day?.blockerCode !== undefined) projected.blockerCode = day.blockerCode;
  if (day?.blockerDetail !== undefined) projected.blockerDetail = day.blockerDetail;
  return projected;
}

function continuousStoresProjection(stores) {
  return (Array.isArray(stores) ? stores : [])
    .map((store) => ({
      storeId: store?.storeId,
      marketplace: store?.marketplace,
      currency: store?.currency,
      businessTimezone: store?.businessTimezone,
      acceptedDayCount: store?.acceptedDayCount,
      days: (Array.isArray(store?.days) ? store.days : [])
        .map(continuousDayProjection)
        .sort((left, right) => String(left.businessDate).localeCompare(String(right.businessDate))),
    }))
    .sort((left, right) => String(left.storeId).localeCompare(String(right.storeId)));
}

function validateContinuousOperation(evidence, context = {}) {
  const reasons = [];
  let verifiedFileArtifacts = Object.freeze([]);
  pushReason(reasons, isRecord(evidence), 'continuous-operation evidence must be an object');
  if (!isRecord(evidence)) return validationResult(reasons);
  pushReason(reasons, evidence.kind === S7_CONTINUOUS_OPERATION_KIND, 'unexpected continuous-operation evidence kind');
  pushReason(reasons, evidence.schemaVersion === S7_CONTINUOUS_OPERATION_SCHEMA_VERSION, 'unexpected continuous-operation schema version');
  pushReason(reasons, validTimestamp(evidence.generatedAt), 'continuous-operation generatedAt is invalid');
  pushReason(reasons, evidence.passed === true && evidence.status === 'PASSED', 'continuous-operation evidence did not pass');
  pushReason(reasons, evidence.readinessImpact === 'CONTINUOUS_OPERATION_GATE_ONLY', 'continuous-operation readiness scope is invalid');
  pushReason(reasons, evidence.finalReadinessCredit === false, 'continuous-operation evidence must not rewrite the legacy v1.5 readiness contract');
  pushReason(
    reasons,
    evidence.publication?.state === 'atomic-published'
      && evidence.publication?.stagedVerificationCaptureLabel === 'continuous-after-staging-output'
      && nonEmpty(evidence.publication?.outputPath)
      && nonEmpty(context.evidencePath)
      && samePath(evidence.publication?.outputPath, context.evidencePath),
    'continuous-operation evidence is not bound to its atomically published final path',
  );
  const currentnessCaptures = Array.isArray(evidence.authorityCurrentness?.captures)
    ? evidence.authorityCurrentness.captures
    : [];
  const requiredCurrentnessLabels = [
    'continuous-before-work',
    'continuous-before-final-output',
    'continuous-after-staging-output',
  ];
  pushReason(
    reasons,
    evidence.authorityCurrentness?.passed === true
      && evidence.authorityCurrentness?.method === 'readonly-sqlite-online-backup'
      && stableEqual(
        currentnessCaptures.map((capture) => capture?.captureLabel),
        requiredCurrentnessLabels,
      ),
    'continuous-operation authority currentness must persist all three ordered staging-safe captures',
  );
  const continuousSnapshotArtifact = {
    sha256: normalizeSha256(evidence.database?.sha256),
    sizeBytes: evidence.database?.sizeBytes,
  };
  try {
    const currentnessValidation = assertMatchingAuthorityCurrentnessProofs(
      currentnessCaptures,
      continuousSnapshotArtifact,
      'Continuous-operation published authority currentness',
    );
    pushReason(
      reasons,
      stableEqual(
        evidence.authorityCurrentness?.expectedSnapshot,
        currentnessValidation.expectedSnapshot,
      ),
      'continuous-operation authority currentness expected snapshot does not match its database artifact',
    );
  } catch (error) {
    reasons.push(
      `continuous-operation authority currentness proof is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const dates = Array.isArray(evidence.window?.businessDates) ? evidence.window.businessDates : [];
  pushReason(reasons, dates.length === 7 && new Set(dates).size === 7, 'continuous-operation window must contain exactly seven distinct US business dates');
  pushReason(reasons, dates.every(isUsBusinessDate), 'continuous-operation window contains a weekend or invalid US business date');
  pushReason(reasons, dates.every((date, index) => index === 0 || dates[index - 1] < date), 'continuous-operation business dates must be strictly increasing');
  pushReason(reasons, evidence.window?.dateFrom === dates[0] && evidence.window?.dateTo === dates.at(-1), 'continuous-operation window bounds do not match its business dates');
  try {
    const {
      ACCEPTANCE_CONTRACT_VERSION,
      US_BUSINESS_CALENDAR_VERSION,
      usFederalBusinessDates,
    } = require('./verify-s7-continuous-operation');
    pushReason(reasons, evidence.acceptanceContractVersion === ACCEPTANCE_CONTRACT_VERSION, 'continuous-operation acceptance contract version is stale');
    pushReason(reasons, evidence.businessCalendarVersion === US_BUSINESS_CALENDAR_VERSION, 'continuous-operation business calendar version is stale');
    pushReason(reasons, evidence.window?.businessCalendarVersion === US_BUSINESS_CALENDAR_VERSION, 'continuous-operation window calendar version is stale');
    const canonicalDates = usFederalBusinessDates(evidence.window?.dateFrom, evidence.window?.dateTo);
    pushReason(
      reasons,
      uniqueExactStrings(dates, canonicalDates) && stableEqual(dates, canonicalDates),
      'continuous-operation window is not the canonical seven consecutive Monday-Friday US business dates',
    );
  } catch (error) {
    reasons.push(`continuous-operation weekday contract could not be evaluated: ${error instanceof Error ? error.message : String(error)}`);
  }
  pushReason(
    reasons,
    evidence.expectedStoreCount === 2
      && evidence.expectedDayCountPerStore === 7
      && evidence.expectedReportCountPerSuccessfulDay === 8,
    'continuous-operation expected counts are not 2 stores x 7 days x 8 reports',
  );
  const stores = Array.isArray(evidence.stores) ? evidence.stores : [];
  pushReason(reasons, stores.length === 2 && new Set(stores.map((store) => store?.storeId)).size === 2, 'continuous-operation evidence must contain exactly two distinct stores');
  for (const store of stores) {
    pushReason(reasons, nonEmpty(store?.storeId), 'continuous-operation storeId is missing');
    pushReason(reasons, store?.marketplace === 'US' && store?.currency === 'USD', `continuous-operation store ${store?.storeId || 'unknown'} is not US/USD`);
    pushReason(reasons, nonEmpty(store?.businessTimezone), `continuous-operation store ${store?.storeId || 'unknown'} has no business timezone`);
    const days = Array.isArray(store?.days) ? store.days : [];
    pushReason(reasons, uniqueExactStrings(days.map((day) => day?.businessDate), dates), `continuous-operation store ${store?.storeId || 'unknown'} does not cover the exact seven-day window`);
    pushReason(reasons, store?.acceptedDayCount === 7, `continuous-operation store ${store?.storeId || 'unknown'} did not accept all seven days`);
    for (const day of days) {
      const success = day?.accepted === true
        && day?.outcome === 'SUCCESS_8_OF_8'
        && day?.reportCount === 8
        && nonEmpty(day?.jobId)
        && nonEmpty(day?.importRunId);
      pushReason(reasons, success, `continuous-operation ${store?.storeId || 'unknown'} ${day?.businessDate || 'unknown'} is not a verified SUCCESS_8_OF_8`);
    }
  }
  pushReason(reasons, Array.isArray(evidence.violations) && evidence.violations.length === 0, 'continuous-operation evidence contains violations');

  const inputStores = stores.map((store) => normalizeLogicalId(store?.storeId));
  const storesAreNormalized = inputStores.every(Boolean)
    && stores.every((store, index) => store?.storeId === inputStores[index]);
  pushReason(reasons, storesAreNormalized, 'continuous-operation store ids are not normalized logical ids');
  pushReason(
    reasons,
    nonEmpty(evidence.storesRoot)
      && path.isAbsolute(evidence.storesRoot)
      && samePath(evidence.storesRoot, context.canonicalStoresRoot)
      && realpathEquals(evidence.storesRoot, context.canonicalStoresRoot),
    'continuous-operation storesRoot is not the canonical snapshot-source USER_DATA_DIR/stores directory',
  );
  const expectedVerifiedFileCount = 2 * 7 * 8;
  pushReason(
    reasons,
    samePath(evidence.storeCapsule?.storesRoot, evidence.storesRoot)
      && evidence.storeCapsule?.verifiedFileCount === expectedVerifiedFileCount,
    'continuous-operation Store Capsule proof must bind the canonical storesRoot and exactly 112 verified report files',
  );
  if (storesAreNormalized && dates.length === 7 && dates.every(isUsBusinessDate)) {
    const input = {
      stores: inputStores,
      dates,
      dateFrom: dates[0],
      dateTo: dates.at(-1),
      generatedAt: evidence.generatedAt,
      storesRoot: evidence.storesRoot,
    };
    const recomputed = withVerifiedReadOnlyDatabase(
      evidence.database,
      'continuous-operation',
      reasons,
      (database) => {
        const {
          evaluateContinuousOperationSnapshot,
          readContinuousOperationSnapshot,
        } = require('./verify-s7-continuous-operation');
        const snapshot = readContinuousOperationSnapshot(database, input);
        return evaluateContinuousOperationSnapshot(snapshot, input);
      },
      context,
    );
    if (recomputed) {
      const recomputedArtifacts = Array.isArray(recomputed._verifiedFileArtifacts)
        ? recomputed._verifiedFileArtifacts
        : [];
      verifiedFileArtifacts = Object.freeze(recomputedArtifacts.map((artifact) => Object.freeze({
        filePath: artifact.filePath,
        runKey: artifact.runKey,
        sha256: artifact.sha256,
        sizeBytes: artifact.sizeBytes,
      })));
      pushReason(reasons, recomputed.passed === true, 'continuous-operation read-only database recomputation did not pass');
      pushReason(
        reasons,
        verifiedFileArtifacts.length === expectedVerifiedFileCount
          && verifiedFileArtifacts.length === evidence.storeCapsule?.verifiedFileCount,
        'continuous-operation recomputation did not retain exactly the 112 verified Store Capsule file artifacts',
      );
      pushReason(
        reasons,
        recomputed.expectedStoreCount === evidence.expectedStoreCount
          && recomputed.expectedDayCountPerStore === evidence.expectedDayCountPerStore
          && recomputed.expectedReportCountPerSuccessfulDay === evidence.expectedReportCountPerSuccessfulDay,
        'continuous-operation expected counts do not match the read-only database recomputation',
      );
      pushReason(
        reasons,
        stableEqual(continuousStoresProjection(evidence.stores), continuousStoresProjection(recomputed.stores)),
        'continuous-operation canonical stores/dates/outcomes do not match the read-only database recomputation',
      );
      pushReason(
        reasons,
        stableEqual(evidence.violations, recomputed.violations),
        'continuous-operation violations do not match the read-only database recomputation',
      );
    }
  } else {
    // Even an invalid manifest must still validate its database identity rather than trust the JSON claim.
    withVerifiedReadOnlyDatabase(evidence.database, 'continuous-operation', reasons, () => null, context);
  }
  return validationResult(reasons, {
    packageIdentity: evidence.packageIdentity,
    verifiedFileArtifacts,
  });
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseStopConditionCodes(value) {
  const parsed = parseJsonArray(value);
  if (!parsed || parsed.length === 0) return null;
  const codes = parsed.map((item) => {
    if (nonEmpty(item)) return item;
    if (isRecord(item) && nonEmpty(item.code)) return item.code;
    return null;
  });
  return codes.every(nonEmpty) && new Set(codes).size === codes.length ? codes : null;
}

function exactDatabaseRow(database, sql, parameters, label, reasons) {
  const rows = database.prepare(sql).all(...parameters);
  pushReason(reasons, rows.length === 1, `${label} must resolve to exactly one authority DB row`);
  return rows.length === 1 ? rows[0] : null;
}

function validatePngArtifact(filePath, label, reasons) {
  try {
    return inspectPngEvidenceFile(filePath);
  } catch (error) {
    reasons.push(
      `${label} is not complete, decodable production PNG evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

function deterministicExecutionArtifactRef(storeId, batchId, jobId, slot) {
  const payload = JSON.stringify(Object.fromEntries(Object.entries({
    storeId,
    batchId,
    jobId,
    slot,
  }).sort(([left], [right]) => left.localeCompare(right))));
  return `artifact:execution:v1:${sha256Text(payload)}`;
}

function deterministicExecutionArtifactPath(storesRoot, storeId, batchId, jobId, slot) {
  return path.resolve(
    storesRoot,
    storeId,
    'evidence',
    'ad-execution',
    `batch-${sha256Text(batchId).slice(0, 24)}`,
    `job-${sha256Text(jobId).slice(0, 24)}`,
    `${slot}.png`,
  );
}

function hasUnsafeFilesystemLink(rootPath, filePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return true;
  let cursor = path.resolve(rootPath);
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

function validateExecutionArtifact(record, databaseRecord, artifactContext, label, slot, reasons) {
  const expectedPath = deterministicExecutionArtifactPath(
    artifactContext.storesRoot,
    artifactContext.storeId,
    artifactContext.batchId,
    artifactContext.jobId,
    slot,
  );
  pushReason(
    reasons,
    nonEmpty(record?.artifactPath) && path.isAbsolute(record.artifactPath) && samePath(record.artifactPath, expectedPath),
    `${label} ${slot} artifact path is not the deterministic Store Capsule path`,
  );
  pushReason(
    reasons,
    record?.artifactRef === deterministicExecutionArtifactRef(
      artifactContext.storeId,
      artifactContext.batchId,
      artifactContext.jobId,
      slot,
    ),
    `${label} ${slot} artifact reference is not the deterministic opaque reference`,
  );

  let currentInspection = null;
  try {
    const root = path.resolve(artifactContext.storesRoot);
    const storeRoot = path.resolve(root, artifactContext.storeId);
    const rootReal = fs.realpathSync(root);
    const storeReal = fs.realpathSync(storeRoot);
    const artifactReal = fs.realpathSync(expectedPath);
    const physicallyContained = samePath(root, rootReal)
      && isPathContained(rootReal, storeReal)
      && isPathContained(storeReal, artifactReal)
      && !hasUnsafeFilesystemLink(root, expectedPath);
    pushReason(reasons, physicallyContained, `${label} ${slot} artifact escapes or links through the Store Capsule boundary`);
    currentInspection = validatePngArtifact(
      expectedPath,
      `${label} ${slot} Store Capsule artifact`,
      reasons,
    );
  } catch (error) {
    reasons.push(`${label} ${slot} Store Capsule artifact cannot be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  pushReason(
    reasons,
    currentInspection !== null
      && currentInspection.sha256 === normalizeSha256(record?.contentSha256)
      && currentInspection.sha256 === normalizeSha256(databaseRecord?.contentSha256),
    `${label} ${slot} current artifact SHA-256 does not match both JSON and authority DB`,
  );
  pushReason(
    reasons,
    Number.isSafeInteger(record?.sizeBytes)
      && record.sizeBytes > 0
      && record.sizeBytes === currentInspection?.sizeBytes,
    `${label} ${slot} current artifact size does not match the JSON evidence`,
  );
  if (!currentInspection) return null;
  return Object.freeze({
    slot,
    filePath: expectedPath,
    sha256: currentInspection.sha256,
    sizeBytes: currentInspection.sizeBytes,
    width: currentInspection.width,
    height: currentInspection.height,
    bitDepth: currentInspection.bitDepth,
    colorType: currentInspection.colorType,
    idatChunks: currentInspection.idatChunks,
    fileIdentity: Object.freeze({ ...currentInspection.fileIdentity }),
    mtimeNs: currentInspection.mtimeNs,
    ctimeNs: currentInspection.ctimeNs,
  });
}

function validateCanaryAuthorityDatabase(database, evidence, expectedMode, label, reasons, context = {}) {
  const scope = evidence.scope;
  const authority = evidence.authority;
  const object = evidence.object;
  const records = Array.isArray(evidence.execution?.evidence) ? evidence.execution.evidence : [];
  const bySlot = new Map(records.map((item) => [item?.slot, item]));
  const proof = evidence.database?.authorityProof;
  const recordIdentity = proof?.recordIdentity;
  const expectedIssuer = expectedMode === 'manual_approval' ? 'human' : 'policy';
  const verifiedPngArtifacts = [];

  const store = exactDatabaseRow(database, `
    SELECT store_id AS storeId, browser_profile_id AS browserProfileId,
           marketplace, currency, status
    FROM stores WHERE store_id = ? OR browser_profile_id = ?
  `, [scope?.storeId, scope?.browserProfileId], `${label} store/Profile`, reasons);
  pushReason(
    reasons,
    store?.storeId === scope?.storeId
      && store?.browserProfileId === scope?.browserProfileId
      && store?.marketplace === 'US'
      && store?.currency === 'USD'
      && store?.status === 'active',
    `${label} store/Profile is not active US/USD authority in the database`,
  );

  const sourceAuthority = exactDatabaseRow(database, `
    SELECT authority_id AS authorityId, store_id AS storeId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           entity_type AS entityType, proof_sha256 AS proofSha256
    FROM verified_ad_entity_authority
    WHERE store_id = ? AND authority_id = ?
  `, [scope?.storeId, authority?.authorityId], `${label} verified ad-entity authority`, reasons);
  pushReason(
    reasons,
    sourceAuthority?.authorityId === authority?.authorityId
      && sourceAuthority?.storeId === scope?.storeId
      && sourceAuthority?.adEntityId === object?.adEntityId
      && sourceAuthority?.entityRevision === object?.entityRevision
      && sourceAuthority?.entityType === 'keyword'
      && normalizeSha256(sourceAuthority?.proofSha256) === normalizeSha256(object?.sourceAuthorityProofSha256),
    `${label} verified ad-entity authority row does not match the canary object`,
  );

  const identity = exactDatabaseRow(database, `
    SELECT identity_version_id AS identityVersionId, store_id AS storeId,
           marketplace, currency, canonical_keyword_id AS canonicalKeywordId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           ads_account_id AS adsAccountId, campaign_id AS campaignId,
           ad_group_id AS adGroupId, keyword_id AS keywordId,
           object_revision AS objectRevision, observed_bid_cents AS observedBidCents,
           page_identity_hash AS pageIdentityHash,
           source_authority_id AS sourceAuthorityId,
           source_authority_proof_sha256 AS sourceAuthorityProofSha256,
           resolved_session_generation AS resolvedSessionGeneration,
           resolved_at AS resolvedAt, created_at AS createdAt
    FROM ad_keyword_identity_versions
    WHERE store_id = ? AND canonical_keyword_id = ? AND object_revision = ?
  `, [
    scope?.storeId,
    object?.canonicalKeywordId,
    object?.objectRevision,
  ], `${label} canonical keyword identity`, reasons);
  pushReason(
    reasons,
    identity?.identityVersionId === object?.identityVersionId
      && identity?.storeId === scope?.storeId
      && identity?.marketplace === 'US'
      && identity?.currency === 'USD'
      && identity?.canonicalKeywordId === object?.canonicalKeywordId
      && identity?.adEntityId === object?.adEntityId
      && identity?.entityRevision === object?.entityRevision
      && identity?.adsAccountId === object?.adsAccountId
      && identity?.campaignId === object?.campaignId
      && identity?.adGroupId === object?.adGroupId
      && identity?.keywordId === object?.keywordId
      && identity?.objectRevision === object?.objectRevision
      && identity?.observedBidCents === object?.expectedBidCents
      && normalizeSha256(identity?.pageIdentityHash) === normalizeSha256(object?.pageIdentityHash)
      && identity?.sourceAuthorityId === authority?.authorityId
      && normalizeSha256(identity?.sourceAuthorityProofSha256) === normalizeSha256(object?.sourceAuthorityProofSha256),
    `${label} canonical keyword identity row does not match the canary object/authority`,
  );

  const grant = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           mission_id AS missionId, mission_revision AS missionRevision,
           decision_ids_json AS decisionIdsJson,
           action_revision AS actionRevision,
           allowed_action_types_json AS allowedActionTypesJson,
           allowed_ad_entity_ids_json AS allowedAdEntityIdsJson,
           max_change_pct AS maxChangePct, total_impact_budget AS totalImpactBudget,
           expires_at AS expiresAt,
           policy_version_id AS policyVersionId, policy_revision AS policyRevision,
           required_evidence_json AS requiredEvidenceJson,
           stop_conditions_json AS stopConditionsJson,
           issuer_type AS issuerType, issued_at AS issuedAt,
           created_session_generation AS createdSessionGeneration
    FROM mission_grants WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.missionGrantId], `${label} MissionGrant`, reasons);
  const decisionIds = parseJsonArray(grant?.decisionIdsJson);
  const allowedActions = parseJsonArray(grant?.allowedActionTypesJson);
  const allowedEntities = parseJsonArray(grant?.allowedAdEntityIdsJson);
  const requiredEvidence = parseJsonArray(grant?.requiredEvidenceJson);
  const stopConditions = parseStopConditionCodes(grant?.stopConditionsJson);
  const reloadRecord = bySlot.get('reload');
  const changePct = Number.isInteger(object?.expectedBidCents) && object.expectedBidCents > 0
    ? ((object.expectedBidCents - object.targetBidCents) / object.expectedBidCents) * 100
    : Number.POSITIVE_INFINITY;
  pushReason(
    reasons,
    grant?.id === authority?.missionGrantId
      && grant?.storeId === scope?.storeId
      && grant?.marketplace === 'US'
      && grant?.currency === 'USD'
      && grant?.missionId === authority?.missionId
      && grant?.missionRevision === authority?.missionRevision
      && grant?.actionRevision === authority?.actionRevision
      && grant?.policyVersionId === authority?.policyVersionId
      && grant?.policyRevision === authority?.policyRevision
      && grant?.issuerType === expectedIssuer
      && stableEqual(decisionIds, [authority?.decisionId])
      && stableEqual(allowedActions, ['set_keyword_bid'])
      && stableEqual(allowedEntities, [object?.adEntityId])
      && Number(grant?.maxChangePct) >= changePct
      && Number(grant?.totalImpactBudget) >= Math.abs(object?.expectedBidCents - object?.targetBidCents) / 100
      && ['before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value']
        .every((item) => requiredEvidence?.includes(item))
      && ['identity_drift', 'expected_before_mismatch', 'unknown_result', 'data_stale', 'impact_budget_exhausted', 'kill_switch']
        .every((item) => stopConditions?.includes(item))
      && validTimestamp(grant?.issuedAt)
      && validTimestamp(grant?.expiresAt)
      && validTimestamp(reloadRecord?.capturedAt)
      && Date.parse(reloadRecord.capturedAt) <= Date.parse(grant.expiresAt),
    `${label} MissionGrant issuer/policy/scope does not authorize this exact execution`,
  );
  const grantEvents = database.prepare(`
    SELECT event_type AS eventType, created_at AS createdAt FROM mission_grant_events
    WHERE store_id = ? AND grant_id = ? ORDER BY created_at, id
  `).all(scope?.storeId, authority?.missionGrantId);
  const issuedEvents = grantEvents.filter((event) => event.eventType === 'issued');
  const consumedEvents = grantEvents.filter((event) => event.eventType === 'consumed');
  pushReason(
    reasons,
    issuedEvents.length === 1
      && consumedEvents.length === 1
      && issuedEvents[0].createdAt === grant?.issuedAt
      && validTimestamp(issuedEvents[0].createdAt)
      && validTimestamp(consumedEvents[0].createdAt)
      && Date.parse(issuedEvents[0].createdAt) < Date.parse(consumedEvents[0].createdAt)
      && !grantEvents.some((event) => event.eventType === 'revoked' || event.eventType === 'expired'),
    `${label} MissionGrant is not one exact issued then consumed terminal authority`,
  );

  const batch = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           mission_id AS missionId, mission_revision AS missionRevision,
           grant_id AS grantId, action_revision AS actionRevision,
           status, created_session_generation AS createdSessionGeneration,
           created_at AS createdAt, updated_at AS updatedAt,
           terminal_at AS terminalAt
    FROM ad_execution_batches WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.batchId], `${label} execution batch`, reasons);
  pushReason(
    reasons,
    batch?.id === authority?.batchId
      && batch?.storeId === scope?.storeId
      && batch?.marketplace === 'US'
      && batch?.currency === 'USD'
      && batch?.missionId === authority?.missionId
      && batch?.missionRevision === authority?.missionRevision
      && batch?.grantId === authority?.missionGrantId
      && batch?.actionRevision === authority?.actionRevision
      && batch?.status === 'succeeded'
      && validTimestamp(batch?.terminalAt),
    `${label} authority DB batch is not this terminal succeeded execution`,
  );

  const job = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, batch_id AS batchId,
           mission_id AS missionId, grant_id AS grantId,
           proposal_id AS proposalId, decision_id AS decisionId,
           decision_revision AS decisionRevision,
           action_revision AS actionRevision, action_type AS actionType,
           canonical_keyword_id AS canonicalKeywordId,
           ad_entity_id AS adEntityId, entity_revision AS entityRevision,
           ads_account_id AS adsAccountId, campaign_id AS campaignId,
           ad_group_id AS adGroupId, keyword_id AS keywordId,
           object_revision AS objectRevision, page_identity_hash AS pageIdentityHash,
           expected_bid_cents AS expectedBidCents,
           target_bid_cents AS targetBidCents, change_pct AS changePct,
           status, created_session_generation AS createdSessionGeneration,
           created_at AS createdAt, updated_at AS updatedAt,
           submitted_at AS submittedAt, terminal_at AS terminalAt
    FROM ad_execution_jobs WHERE store_id = ? AND batch_id = ?
  `, [scope?.storeId, authority?.batchId], `${label} single execution job`, reasons);
  const expectedSignedChangePct = Number.isFinite(changePct) ? -changePct : Number.NaN;
  pushReason(
    reasons,
    job?.id === authority?.jobId
      && job?.storeId === scope?.storeId
      && job?.batchId === authority?.batchId
      && job?.missionId === authority?.missionId
      && job?.grantId === authority?.missionGrantId
      && job?.proposalId === authority?.proposalId
      && job?.decisionId === authority?.decisionId
      && job?.decisionRevision === authority?.decisionRevision
      && job?.actionRevision === authority?.actionRevision
      && job?.actionType === 'set_keyword_bid'
      && job?.canonicalKeywordId === object?.canonicalKeywordId
      && job?.adEntityId === object?.adEntityId
      && job?.entityRevision === object?.entityRevision
      && job?.adsAccountId === object?.adsAccountId
      && job?.campaignId === object?.campaignId
      && job?.adGroupId === object?.adGroupId
      && job?.keywordId === object?.keywordId
      && job?.objectRevision === object?.objectRevision
      && normalizeSha256(job?.pageIdentityHash) === normalizeSha256(object?.pageIdentityHash)
      && job?.expectedBidCents === object?.expectedBidCents
      && job?.targetBidCents === object?.targetBidCents
      && Number.isFinite(Number(job?.changePct))
      && Math.abs(Number(job.changePct) - expectedSignedChangePct) < 0.000001
      && job?.status === 'succeeded'
      && validTimestamp(job?.terminalAt),
    `${label} authority DB job/object is not this terminal succeeded execution`,
  );

  const mission = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, marketplace, currency,
           policy_version_id AS policyVersionId, status, revision
    FROM missions WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.missionId], `${label} Mission`, reasons);
  pushReason(
    reasons,
    mission?.id === authority?.missionId
      && mission?.storeId === scope?.storeId
      && mission?.marketplace === 'US'
      && mission?.currency === 'USD'
      && mission?.policyVersionId === authority?.policyVersionId
      && mission?.revision === authority?.missionRevision
      && ['active', 'completed'].includes(mission?.status),
    `${label} Mission revision/policy binding does not match the execution`,
  );

  const policy = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, status, rules_json AS rulesJson, revision
    FROM policy_versions WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.policyVersionId], `${label} immutable policy version`, reasons);
  const policyRules = parseJsonObject(policy?.rulesJson);
  pushReason(
    reasons,
    policy?.id === authority?.policyVersionId
      && policy?.storeId === scope?.storeId
      && policy?.status === 'enabled'
      && policy?.revision === authority?.policyRevision
      && policyRules?.killSwitch !== true,
    `${label} enabled policy version is not the immutable MissionGrant policy`,
  );

  const runtime = exactDatabaseRow(database, `
    SELECT store_id AS storeId, autonomy_mode AS autonomyMode,
           kill_switch AS killSwitch, circuit_breaker_state AS circuitBreakerState,
           active_policy_version_id AS activePolicyVersionId
    FROM policy_runtime WHERE store_id = ?
  `, [scope?.storeId], `${label} policy runtime`, reasons);
  pushReason(
    reasons,
    runtime?.storeId === scope?.storeId
      && ['manual_approval', 'policy_auto'].includes(runtime?.autonomyMode)
      && runtime?.killSwitch === 0
      && runtime?.circuitBreakerState === 'closed'
      && runtime?.activePolicyVersionId === authority?.policyVersionId
      && (expectedIssuer !== 'policy' || runtime?.autonomyMode === 'policy_auto'),
    `${label} policy runtime is not enabled, safe, and exact for the issuer`,
  );

  const decision = exactDatabaseRow(database, `
    SELECT id, store_id AS storeId, mission_id AS missionId,
           policy_version_id AS policyVersionId, policy_revision AS policyRevision,
           action_revision AS actionRevision, action_type AS actionType,
           ad_entity_id AS adEntityId, status, revision, valid_until AS validUntil,
           created_at AS createdAt, updated_at AS updatedAt
    FROM decisions WHERE store_id = ? AND id = ?
  `, [scope?.storeId, authority?.decisionId], `${label} decision`, reasons);
  pushReason(
    reasons,
    decision?.id === authority?.decisionId
      && decision?.storeId === scope?.storeId
      && decision?.missionId === authority?.missionId
      && decision?.policyVersionId === authority?.policyVersionId
      && decision?.policyRevision === authority?.policyRevision
      && decision?.actionRevision === authority?.actionRevision
      && decision?.actionType === 'set_keyword_bid'
      && decision?.adEntityId === object?.adEntityId
      && decision?.revision === authority?.decisionRevision
      && ['approved', 'executed', 'verified'].includes(decision?.status),
    `${label} decision revision/action/entity/policy binding is not exact`,
  );
  const decisionApproval = exactDatabaseRow(database, `
    SELECT decision_id AS decisionId, decision_revision AS decisionRevision,
           event_type AS eventType, created_at AS createdAt
    FROM decision_history
    WHERE store_id = ? AND decision_id = ?
      AND decision_revision = ? AND event_type = 'approved'
  `, [
    scope?.storeId,
    authority?.decisionId,
    authority?.decisionRevision,
  ], `${label} decision approval history`, reasons);
  pushReason(
    reasons,
    decisionApproval?.decisionId === authority?.decisionId
      && decisionApproval?.decisionRevision === authority?.decisionRevision
      && decisionApproval?.eventType === 'approved'
      && validTimestamp(decisionApproval?.createdAt),
    `${label} decision approval history is missing, duplicated, or not exact`,
  );

  const proposal = exactDatabaseRow(database, `
    SELECT proposal.id, proposal.store_id AS storeId,
           proposal.marketplace, proposal.currency,
           proposal.mission_id AS missionId, proposal.mission_revision AS missionRevision,
           proposal.policy_version_id AS policyVersionId,
           proposal.policy_revision AS policyRevision,
           proposal.action_revision AS actionRevision,
           proposal.action_type AS actionType, proposal.entity_type AS entityType,
           proposal.ad_entity_authority_id AS adEntityAuthorityId,
           proposal.ad_entity_id AS adEntityId,
           proposal.ad_entity_revision AS adEntityRevision,
           proposal.current_bid_cents AS currentBidCents,
           proposal.proposed_bid_cents AS proposedBidCents,
           proposal.change_pct AS changePct,
           proposal.authorization_json AS authorizationJson,
           proposal.valid_until AS validUntil,
           proposal.created_session_generation AS createdSessionGeneration,
           proposal.created_at AS createdAt,
           link.decision_id AS linkedDecisionId
    FROM analysis_proposal_decision_links link
    JOIN analysis_proposal_snapshots proposal
      ON proposal.store_id = link.store_id AND proposal.id = link.proposal_id
    WHERE link.store_id = ? AND link.proposal_id = ? AND link.decision_id = ?
  `, [
    scope?.storeId,
    authority?.proposalId,
    authority?.decisionId,
  ], `${label} proposal/decision link`, reasons);
  const proposalAuthorization = parseJsonObject(proposal?.authorizationJson);
  const authorizationLane = proposalAuthorization?.[expectedIssuer];
  pushReason(
    reasons,
    proposal?.id === authority?.proposalId
      && proposal?.linkedDecisionId === authority?.decisionId
      && proposal?.storeId === scope?.storeId
      && proposal?.marketplace === 'US'
      && proposal?.currency === 'USD'
      && proposal?.missionId === authority?.missionId
      && proposal?.missionRevision === authority?.missionRevision
      && proposal?.policyVersionId === authority?.policyVersionId
      && proposal?.policyRevision === authority?.policyRevision
      && proposal?.actionRevision === authority?.actionRevision
      && proposal?.actionType === 'set_keyword_bid'
      && proposal?.entityType === 'keyword'
      && proposal?.adEntityAuthorityId === authority?.authorityId
      && proposal?.adEntityId === object?.adEntityId
      && proposal?.adEntityRevision === object?.entityRevision
      && proposal?.currentBidCents === object?.expectedBidCents
      && proposal?.proposedBidCents === object?.targetBidCents
      && Math.abs(Number(proposal?.changePct) - expectedSignedChangePct) < 0.000001
      && authorizationLane?.eligible === true
      && Array.isArray(authorizationLane?.blockers)
      && authorizationLane.blockers.length === 0,
    `${label} immutable proposal/action/decision/policy authorization binding is not exact`,
  );

  const capturedSessionGenerations = new Set(records.map((record) => record?.capturedSessionGeneration));
  const capturedSessionGeneration = capturedSessionGenerations.size === 1
    ? [...capturedSessionGenerations][0]
    : null;
  pushReason(
    reasons,
    isPositiveInteger(capturedSessionGeneration)
      && identity?.resolvedSessionGeneration === capturedSessionGeneration
      && grant?.createdSessionGeneration === capturedSessionGeneration
      && batch?.createdSessionGeneration === capturedSessionGeneration
      && job?.createdSessionGeneration === capturedSessionGeneration
      && proposal?.createdSessionGeneration === capturedSessionGeneration,
    `${label} job/grant/batch/proposal/identity session generation is not bound to capturedSessionGeneration`,
  );

  const snapshotExportedAtMs = Date.parse(context.authoritySnapshotExportedAt);
  const queryExecutedAtMs = Date.parse(evidence.database?.authorityProof?.queryExecutedAt);
  const generatedAtMs = Date.parse(evidence.generatedAt);
  const nowMs = Number(context.nowMs);
  const identityResolvedAtMs = Date.parse(identity?.resolvedAt);
  const identityCreatedAtMs = Date.parse(identity?.createdAt);
  const proposalCreatedAtMs = Date.parse(proposal?.createdAt);
  const decisionCreatedAtMs = Date.parse(decision?.createdAt);
  const decisionApprovedAtMs = Date.parse(decisionApproval?.createdAt);
  const decisionUpdatedAtMs = Date.parse(decision?.updatedAt);
  const issuedAtMs = Date.parse(grant?.issuedAt);
  const issuedEventAtMs = Date.parse(issuedEvents[0]?.createdAt);
  const consumedAtMs = Date.parse(consumedEvents[0]?.createdAt);
  const batchCreatedAtMs = Date.parse(batch?.createdAt);
  const batchUpdatedAtMs = Date.parse(batch?.updatedAt);
  const jobCreatedAtMs = Date.parse(job?.createdAt);
  const jobSubmittedAtMs = Date.parse(job?.submittedAt);
  const jobUpdatedAtMs = Date.parse(job?.updatedAt);
  const recordTimes = records.flatMap((record) => [Date.parse(record?.capturedAt), Date.parse(record?.createdAt)]);
  const beforeCapturedAtMs = Date.parse(bySlot.get('before')?.capturedAt);
  const beforeCreatedAtMs = Date.parse(bySlot.get('before')?.createdAt);
  const afterCapturedAtMs = Date.parse(bySlot.get('after')?.capturedAt);
  const afterCreatedAtMs = Date.parse(bySlot.get('after')?.createdAt);
  const reloadCapturedAtMs = Date.parse(bySlot.get('reload')?.capturedAt);
  const latestRecordAtMs = Math.max(...recordTimes);
  const batchTerminalAtMs = Date.parse(batch?.terminalAt);
  const jobTerminalAtMs = Date.parse(job?.terminalAt);
  const terminalTimes = [batchTerminalAtMs, jobTerminalAtMs];
  const terminalAtMs = Math.max(...terminalTimes);
  const executionFreshnessFloorMs = nowMs - MAX_CANARY_EVIDENCE_AGE_MS;
  const executionTimes = [
    identityResolvedAtMs,
    identityCreatedAtMs,
    proposalCreatedAtMs,
    decisionCreatedAtMs,
    decisionApprovedAtMs,
    decisionUpdatedAtMs,
    issuedAtMs,
    issuedEventAtMs,
    batchCreatedAtMs,
    batchUpdatedAtMs,
    jobCreatedAtMs,
    jobSubmittedAtMs,
    jobUpdatedAtMs,
    ...recordTimes,
    ...terminalTimes,
    consumedAtMs,
  ];
  const publicationTimes = [snapshotExportedAtMs, queryExecutedAtMs, generatedAtMs];
  pushReason(
    reasons,
    executionTimes.every((value) => Number.isFinite(value)
      && value >= context.packageBuiltAtMs
      && value >= executionFreshnessFloorMs
      && value <= nowMs + MAX_FUTURE_SKEW_MS)
      && publicationTimes.every((value) => Number.isFinite(value)
        && value <= nowMs + MAX_FUTURE_SKEW_MS)
      && records.every((record) => Date.parse(record?.createdAt) >= Date.parse(record?.capturedAt))
      && identityResolvedAtMs <= identityCreatedAtMs
      && identityCreatedAtMs <= jobCreatedAtMs
      && proposalCreatedAtMs <= decisionCreatedAtMs
      && decisionCreatedAtMs <= decisionApprovedAtMs
      && decisionApprovedAtMs <= decisionUpdatedAtMs
      && decisionApprovedAtMs <= issuedAtMs
      && issuedAtMs === issuedEventAtMs
      && Math.max(issuedAtMs, identityResolvedAtMs) <= jobCreatedAtMs
      && batchCreatedAtMs <= jobCreatedAtMs
      && jobCreatedAtMs <= beforeCapturedAtMs
      && beforeCreatedAtMs <= jobSubmittedAtMs
      && jobSubmittedAtMs < afterCapturedAtMs
      && afterCreatedAtMs <= reloadCapturedAtMs
      && latestRecordAtMs <= jobTerminalAtMs
      && jobTerminalAtMs <= jobUpdatedAtMs
      && jobTerminalAtMs <= batchTerminalAtMs
      && batchTerminalAtMs <= batchUpdatedAtMs
      && Math.max(jobUpdatedAtMs, batchUpdatedAtMs) <= consumedAtMs
      && snapshotExportedAtMs >= consumedAtMs
      && decisionUpdatedAtMs <= snapshotExportedAtMs
      && queryExecutedAtMs >= snapshotExportedAtMs
      && queryExecutedAtMs >= terminalAtMs
      && generatedAtMs >= queryExecutedAtMs
      && Date.parse(grant?.expiresAt) >= Date.parse(reloadRecord?.capturedAt)
      && (!decision?.validUntil || Date.parse(decision.validUntil) >= Date.parse(reloadRecord?.capturedAt))
      && Date.parse(proposal?.validUntil) >= Date.parse(reloadRecord?.capturedAt),
    `${label} authorization/captured/terminal/snapshot/query/generated timestamps are stale, replayed, or out of order`,
  );

  const databaseEvidence = database.prepare(`
    SELECT id, store_id AS storeId, batch_id AS batchId, job_id AS jobId,
           slot, artifact_ref AS artifactRef, content_sha256 AS contentSha256,
           page_identity_hash AS pageIdentityHash,
           canonical_keyword_id AS canonicalKeywordId,
           object_revision AS objectRevision,
           observed_bid_cents AS observedBidCents,
           captured_session_generation AS capturedSessionGeneration,
           captured_at AS capturedAt, created_at AS createdAt
    FROM ad_execution_evidence WHERE store_id = ? AND job_id = ?
    ORDER BY CASE slot WHEN 'before' THEN 1 WHEN 'after' THEN 2 ELSE 3 END
  `).all(scope?.storeId, authority?.jobId);
  pushReason(
    reasons,
    uniqueExactStrings(databaseEvidence.map((item) => item.slot), ['before', 'after', 'reload']),
    `${label} authority DB does not contain exactly before/after/reload records`,
  );
  const databaseBySlot = new Map(databaseEvidence.map((item) => [item.slot, item]));
  for (const slot of ['before', 'after', 'reload']) {
    const record = bySlot.get(slot);
    const databaseRecord = databaseBySlot.get(slot);
    pushReason(
      reasons,
      databaseRecord?.id === record?.id
        && databaseRecord?.storeId === record?.storeId
        && databaseRecord?.batchId === record?.batchId
        && databaseRecord?.jobId === record?.jobId
        && databaseRecord?.slot === record?.slot
        && databaseRecord?.artifactRef === record?.artifactRef
        && normalizeSha256(databaseRecord?.contentSha256) === normalizeSha256(record?.contentSha256)
        && normalizeSha256(databaseRecord?.pageIdentityHash) === normalizeSha256(record?.pageIdentityHash)
        && databaseRecord?.canonicalKeywordId === record?.canonicalKeywordId
        && databaseRecord?.objectRevision === record?.objectRevision
        && databaseRecord?.observedBidCents === record?.observedBidCents
        && databaseRecord?.capturedSessionGeneration === record?.capturedSessionGeneration
        && databaseRecord?.capturedAt === record?.capturedAt
        && databaseRecord?.createdAt === record?.createdAt,
      `${label} ${slot} JSON evidence does not match the authority DB record`,
    );
    const verifiedPngArtifact = validateExecutionArtifact(record, databaseRecord, {
      storesRoot: context.canonicalStoresRoot,
      storeId: store?.storeId,
      batchId: batch?.id,
      jobId: job?.id,
    }, label, slot, reasons);
    if (verifiedPngArtifact) verifiedPngArtifacts.push(verifiedPngArtifact);
  }

  pushReason(
    reasons,
    recordIdentity?.storeId === store?.storeId
      && recordIdentity?.browserProfileId === store?.browserProfileId
      && recordIdentity?.authorityId === sourceAuthority?.authorityId
      && recordIdentity?.identityVersionId === identity?.identityVersionId
      && recordIdentity?.missionGrantId === grant?.id
      && recordIdentity?.batchId === batch?.id
      && recordIdentity?.jobId === job?.id
      && recordIdentity?.canonicalKeywordId === identity?.canonicalKeywordId
      && recordIdentity?.objectRevision === identity?.objectRevision
      && uniqueExactStrings(recordIdentity?.evidenceIds, databaseEvidence.map((item) => item.id)),
    `${label} authorityProof recordIdentity does not match the queried DB record set`,
  );
  return Object.freeze(verifiedPngArtifacts);
}

function validateExecutionCanary(evidence, expectedMode, context = {}) {
  const reasons = [];
  const label = expectedMode === 'manual_approval' ? 'manual canary' : 'policy-auto canary';
  pushReason(reasons, isRecord(evidence), `${label} evidence must be an object`);
  if (!isRecord(evidence)) return validationResult(reasons);
  pushReason(reasons, evidence.kind === EXECUTION_CANARY_KIND, `${label} kind is invalid`);
  pushReason(reasons, evidence.schemaVersion === EXECUTION_CANARY_SCHEMA_VERSION, `${label} schema version is invalid`);
  pushReason(reasons, validTimestamp(evidence.generatedAt), `${label} generatedAt is invalid`);
  pushReason(reasons, evidence.passed === true && evidence.status === 'PASSED', `${label} did not pass`);
  pushReason(reasons, evidence.mode === expectedMode, `${label} mode must be ${expectedMode}`);
  const scope = evidence.scope;
  pushReason(reasons, nonEmpty(scope?.storeId) && nonEmpty(scope?.browserProfileId), `${label} store/Profile scope binding is incomplete`);
  pushReason(reasons, scope?.marketplace === 'US' && scope?.currency === 'USD', `${label} must be US/USD`);

  const authority = evidence.authority;
  const expectedIssuer = expectedMode === 'manual_approval' ? 'human' : 'policy';
  pushReason(reasons, authority?.storeId === scope?.storeId && authority?.browserProfileId === scope?.browserProfileId, `${label} authority is not bound to the same store/Profile`);
  pushReason(reasons, authority?.issuerType === expectedIssuer, `${label} authority issuer must be ${expectedIssuer}`);
  for (const field of ['authorityId', 'missionId', 'missionGrantId', 'batchId', 'jobId', 'proposalId', 'decisionId']) {
    pushReason(reasons, nonEmpty(authority?.[field]), `${label} authority.${field} is missing`);
  }
  pushReason(reasons, isPositiveInteger(authority?.actionRevision), `${label} authority actionRevision is invalid`);
  pushReason(reasons, isPositiveInteger(authority?.missionRevision), `${label} authority missionRevision is invalid`);
  pushReason(reasons, isPositiveInteger(authority?.decisionRevision), `${label} authority decisionRevision is invalid`);
  pushReason(reasons, nonEmpty(authority?.policyVersionId), `${label} immutable policyVersionId binding is missing`);
  pushReason(reasons, isPositiveInteger(authority?.policyRevision), `${label} immutable policyRevision binding is missing`);

  const object = evidence.object;
  pushReason(reasons, object?.storeId === scope?.storeId, `${label} object is bound to another store`);
  pushReason(reasons, object?.actionType === 'set_keyword_bid', `${label} actionType is not the Stage 6 keyword-bid action`);
  for (const field of ['identityVersionId', 'canonicalKeywordId', 'adEntityId', 'adsAccountId', 'campaignId', 'adGroupId', 'keywordId']) {
    pushReason(reasons, nonEmpty(object?.[field]), `${label} object.${field} is missing`);
  }
  pushReason(reasons, isPositiveInteger(object?.entityRevision), `${label} entityRevision is invalid`);
  pushReason(reasons, isPositiveInteger(object?.objectRevision), `${label} objectRevision is invalid`);
  pushReason(reasons, isSha256(object?.pageIdentityHash), `${label} page identity hash is invalid`);
  pushReason(reasons, isSha256(object?.sourceAuthorityProofSha256), `${label} source authority proof hash is invalid`);
  const beforeBid = object?.expectedBidCents;
  const targetBid = object?.targetBidCents;
  const changePct = Number.isInteger(beforeBid) && beforeBid > 0 && Number.isInteger(targetBid)
    ? ((beforeBid - targetBid) / beforeBid) * 100
    : Number.POSITIVE_INFINITY;
  pushReason(reasons, Number.isInteger(beforeBid) && Number.isInteger(targetBid) && targetBid > 0 && targetBid < beforeBid && changePct <= 10, `${label} bid change is not a positive decrease within 10%`);

  pushReason(reasons, evidence.execution?.status === 'succeeded', `${label} execution is not succeeded`);
  const records = Array.isArray(evidence.execution?.evidence) ? evidence.execution.evidence : [];
  pushReason(reasons, uniqueExactStrings(records.map((item) => item?.slot), ['before', 'after', 'reload']), `${label} must contain exactly before/after/reload evidence`);
  const bySlot = new Map(records.map((item) => [item?.slot, item]));
  const sessionGenerations = new Set();
  const artifactRefs = new Set();
  const contentHashes = new Set();
  for (const slot of ['before', 'after', 'reload']) {
    const record = bySlot.get(slot);
    pushReason(
      reasons,
      record?.storeId === scope?.storeId
        && record?.batchId === authority?.batchId
        && record?.jobId === authority?.jobId
        && record?.canonicalKeywordId === object?.canonicalKeywordId
        && record?.objectRevision === object?.objectRevision
        && normalizeSha256(record?.pageIdentityHash) === normalizeSha256(object?.pageIdentityHash),
      `${label} ${slot} evidence is not bound to the same store/object/authority`,
    );
    pushReason(
      reasons,
      nonEmpty(record?.artifactRef)
        && nonEmpty(record?.artifactPath)
        && path.isAbsolute(record.artifactPath)
        && isSha256(record?.contentSha256),
      `${label} ${slot} artifact reference/path/hash is invalid`,
    );
    pushReason(reasons, isPositiveInteger(record?.capturedSessionGeneration), `${label} ${slot} session generation is invalid`);
    pushReason(reasons, validTimestamp(record?.capturedAt), `${label} ${slot} capturedAt is invalid`);
    pushReason(reasons, validTimestamp(record?.createdAt), `${label} ${slot} createdAt is invalid`);
    if (record) {
      sessionGenerations.add(record.capturedSessionGeneration);
      artifactRefs.add(record.artifactRef);
      contentHashes.add(normalizeSha256(record.contentSha256));
    }
  }
  pushReason(reasons, records.length === 3 && artifactRefs.size === 3 && contentHashes.size === 3, `${label} before/after/reload artifacts must be distinct`);
  pushReason(reasons, records.length === 3 && sessionGenerations.size === 1, `${label} before/after/reload are not from one session generation`);
  const before = bySlot.get('before');
  const after = bySlot.get('after');
  const reload = bySlot.get('reload');
  pushReason(
    reasons,
    before?.observedBidCents === beforeBid
      && after?.observedBidCents === targetBid
      && reload?.observedBidCents === targetBid,
    `${label} before/after/reload values are inconsistent`,
  );
  pushReason(
    reasons,
    validTimestamp(before?.capturedAt)
      && validTimestamp(after?.capturedAt)
      && validTimestamp(reload?.capturedAt)
      && Date.parse(before.capturedAt) < Date.parse(after.capturedAt)
      && Date.parse(after.capturedAt) < Date.parse(reload.capturedAt),
    `${label} before/after/reload timestamps are not strictly ordered`,
  );

  const storesRoot = evidence.storesRoot;
  const canonicalStoresRoot = context.canonicalStoresRoot;
  const normalizedStoreId = normalizeLogicalId(scope?.storeId);
  const normalizedProfileId = normalizeLogicalId(scope?.browserProfileId);
  pushReason(
    reasons,
    nonEmpty(storesRoot)
      && path.isAbsolute(storesRoot)
      && nonEmpty(canonicalStoresRoot)
      && samePath(storesRoot, canonicalStoresRoot)
      && realpathEquals(storesRoot, canonicalStoresRoot)
      && requestedPathEqualsRealpath(canonicalStoresRoot)
      && fs.existsSync(canonicalStoresRoot)
      && fs.statSync(canonicalStoresRoot).isDirectory(),
    `${label} storesRoot is not the canonical USER_DATA_DIR/stores directory derived from the snapshot source`,
  );
  pushReason(
    reasons,
    normalizedStoreId === scope?.storeId && normalizedProfileId === scope?.browserProfileId,
    `${label} store/Profile ids are not normalized logical ids`,
  );
  const authorityProof = evidence.database?.authorityProof;
  pushReason(
    reasons,
    authorityProof?.queryContract === EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT,
    `${label} authority query contract is missing or invalid`,
  );
  pushReason(reasons, authorityProof?.passed === true, `${label} authority query did not pass`);
  pushReason(reasons, validTimestamp(authorityProof?.queryExecutedAt), `${label} authority query timestamp is invalid`);
  pushReason(
    reasons,
    normalizeSha256(authorityProof?.databaseSha256) === normalizeSha256(evidence.database?.sha256),
    `${label} authority query is not bound to the selected database SHA-256`,
  );
  pushReason(
    reasons,
    validTimestamp(authorityProof?.queryExecutedAt)
      && validTimestamp(evidence.generatedAt)
      && Date.parse(authorityProof.queryExecutedAt) <= Date.parse(evidence.generatedAt),
    `${label} authority query timestamp is later than the canary manifest`,
  );
  const verifiedPngArtifacts = withVerifiedReadOnlyDatabase(
    evidence.database,
    label,
    reasons,
    (database) => validateCanaryAuthorityDatabase(
      database,
      evidence,
      expectedMode,
      label,
      reasons,
      context,
    ),
    context,
  );
  pushReason(
    reasons,
    Array.isArray(verifiedPngArtifacts)
      && verifiedPngArtifacts.length === 3
      && uniqueExactStrings(
        verifiedPngArtifacts.map((artifact) => artifact.slot),
        ['before', 'after', 'reload'],
      ),
    `${label} did not retain exactly three immutable PNG artifact proofs`,
  );
  return validationResult(reasons, {
    packageIdentity: evidence.packageIdentity,
    canaryBinding: {
      authorityId: authority?.authorityId || null,
      batchId: authority?.batchId || null,
      jobId: authority?.jobId || null,
      missionGrantId: authority?.missionGrantId || null,
    },
    verifiedPngArtifacts: Object.freeze(
      Array.isArray(verifiedPngArtifacts)
        ? verifiedPngArtifacts
        : [],
    ),
  });
}

function missingGate(spec, evidencePath) {
  return {
    id: spec.id,
    name: spec.name,
    status: 'missing',
    ok: false,
    evidencePath: evidencePath || null,
    reason: evidencePath
      ? `The explicitly selected evidence path does not exist: ${evidencePath}`
      : `Missing explicit --${spec.option} evidence path.`,
  };
}

function readEvidenceSelection(spec, rawPath) {
  const evidencePath = rawPath ? path.resolve(rawPath) : null;
  if (!evidencePath || !fs.existsSync(evidencePath)) {
    return { evidence: null, evidencePath, gate: missingGate(spec, evidencePath) };
  }
  try {
    if (fs.lstatSync(evidencePath).isSymbolicLink()
      || hasUnsafeFilesystemLink(path.parse(evidencePath).root, evidencePath)) {
      throw new Error('selected evidence file may not be a symbolic link or traverse a reparse point');
    }
    const stat = fs.statSync(evidencePath);
    if (!stat.isFile()) throw new Error('selected path is not a file');
    if (stat.nlink !== 1) throw new Error('selected evidence file must have exactly one filesystem link');
    return {
      evidence: JSON.parse(fs.readFileSync(evidencePath, 'utf8')),
      evidencePath,
      gate: null,
    };
  } catch (error) {
    return {
      evidence: null,
      evidencePath,
      gate: {
        id: spec.id,
        name: spec.name,
        status: 'needs_work',
        ok: false,
        evidencePath,
        reason: `The explicitly selected evidence could not be read: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

function validateSelection(spec, selection, context) {
  if (selection.gate) {
    return {
      ...selection.gate,
      ...(spec.supersededBy ? { supersededBy: [...spec.supersededBy] } : {}),
      _validation: null,
    };
  }
  let validation;
  try {
    switch (spec.id) {
      case 'v15-final-readiness':
        validation = validateV15FinalReadiness(selection.evidence, context);
        break;
      case 'package-launch':
        validation = validatePackageLaunch(selection.evidence, context);
        break;
      case 'package-ui':
        validation = validatePackageUi(selection.evidence);
        break;
      case 'package-security':
        validation = validatePackageSecurity(selection.evidence);
        break;
      case 'package-adversarial-node-env':
        validation = validatePackageAdversarialNodeEnv(selection.evidence);
        break;
      case 's7-continuous-operation':
        validation = validateContinuousOperation(selection.evidence, {
          ...context,
          evidencePath: selection.evidencePath,
        });
        break;
      case 'manual-canary':
        validation = validateExecutionCanary(selection.evidence, 'manual_approval', context);
        break;
      case 'policy-auto-canary':
        validation = validateExecutionCanary(selection.evidence, 'policy_auto', context);
        break;
      default:
        validation = validationResult([`No validator is registered for ${spec.id}`]);
    }
  } catch (error) {
    validation = validationResult([`Evidence validation failed closed: ${error instanceof Error ? error.message : String(error)}`]);
  }
  return {
    id: spec.id,
    name: spec.name,
    status: validation.ok ? 'passed' : 'needs_work',
    ok: validation.ok,
    evidencePath: selection.evidencePath,
    reason: validation.reason,
    ...(validation.supersededBy ? { supersededBy: [...validation.supersededBy] } : {}),
    _validation: validation,
  };
}

function appendGateFailure(gate, reason) {
  gate.ok = false;
  if (gate.status !== 'missing') gate.status = 'needs_work';
  gate.reason = gate.reason === 'Evidence passed its production contract.'
    ? reason
    : `${gate.reason}; ${reason}`;
}

function verifyFileArtifactsUnchanged(verifiedFileArtifacts) {
  const reasons = [];
  if (!Array.isArray(verifiedFileArtifacts) || verifiedFileArtifacts.length !== 2 * 7 * 8) {
    return validationResult(['Final Store Capsule verification did not retain exactly 112 file artifacts.']);
  }
  const seenPaths = new Set();
  for (const artifact of verifiedFileArtifacts) {
    const filePath = artifact?.filePath;
    if (
      !nonEmpty(filePath)
      || !path.isAbsolute(filePath)
      || filePath.includes('\0')
      || !isSha256(artifact?.sha256)
      || !Number.isInteger(artifact?.sizeBytes)
      || artifact.sizeBytes <= 0
    ) {
      reasons.push('Final Store Capsule verification retained an invalid file artifact proof.');
      break;
    }
    const resolved = path.resolve(filePath);
    const normalizedPath = resolved.toLowerCase();
    if (!samePath(filePath, resolved) || seenPaths.has(normalizedPath)) {
      reasons.push(`Final Store Capsule verification retained a duplicate or non-canonical file path: ${filePath}`);
      break;
    }
    seenPaths.add(normalizedPath);
    const expected = {
      path: resolved,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    };
    try {
      if (!currentFileMatches(expected) || !currentFileMatches(expected)) {
        reasons.push(`Verified Store Capsule report file changed after continuous-operation verification: ${resolved}`);
        break;
      }
    } catch (error) {
      reasons.push(
        `Verified Store Capsule report file could not be rechecked after continuous-operation verification: ${resolved} (${error instanceof Error ? error.message : String(error)})`,
      );
      break;
    }
  }
  return validationResult(reasons);
}

function verifyCanaryPngArtifactsUnchanged(verifiedPngArtifacts) {
  const reasons = [];
  if (!Array.isArray(verifiedPngArtifacts) || verifiedPngArtifacts.length !== 3) {
    return validationResult([
      'Final canary PNG verification did not retain exactly three immutable artifact proofs.',
    ]);
  }
  const expectedSlots = ['before', 'after', 'reload'];
  const seenPaths = new Set();
  const slots = verifiedPngArtifacts.map((artifact) => artifact?.slot);
  pushReason(
    reasons,
    uniqueExactStrings(slots, expectedSlots),
    'Final canary PNG verification did not retain exact before/after/reload slots',
  );
  for (const artifact of verifiedPngArtifacts) {
    const filePath = artifact?.filePath;
    if (!nonEmpty(filePath)
      || !path.isAbsolute(filePath)
      || filePath.includes('\0')
      || !samePath(filePath, path.resolve(filePath))
      || !isSha256(artifact?.sha256)
      || !Number.isSafeInteger(artifact?.sizeBytes)
      || artifact.sizeBytes <= 0
      || !Number.isSafeInteger(artifact?.width)
      || !Number.isSafeInteger(artifact?.height)
      || !Number.isSafeInteger(artifact?.bitDepth)
      || !Number.isSafeInteger(artifact?.colorType)
      || !Number.isSafeInteger(artifact?.idatChunks)
      || !isRecord(artifact?.fileIdentity)
      || !nonEmpty(artifact.fileIdentity.dev)
      || !nonEmpty(artifact.fileIdentity.ino)
      || !nonEmpty(artifact?.mtimeNs)
      || !nonEmpty(artifact?.ctimeNs)) {
      reasons.push('Final canary PNG verification retained an invalid immutable artifact proof.');
      break;
    }
    const resolved = path.resolve(filePath);
    const normalizedPath = resolved.toLowerCase();
    if (seenPaths.has(normalizedPath)) {
      reasons.push(`Final canary PNG verification retained a duplicate path: ${resolved}`);
      break;
    }
    seenPaths.add(normalizedPath);
    try {
      const realPath = fs.realpathSync.native(resolved);
      if (!samePath(realPath, resolved) || fs.lstatSync(resolved).isSymbolicLink()) {
        reasons.push(`Final canary PNG path changed into a filesystem link: ${resolved}`);
        break;
      }
      const current = inspectPngEvidenceFile(resolved);
      const unchanged = current.sha256 === artifact.sha256
        && current.sizeBytes === artifact.sizeBytes
        && current.width === artifact.width
        && current.height === artifact.height
        && current.bitDepth === artifact.bitDepth
        && current.colorType === artifact.colorType
        && current.idatChunks === artifact.idatChunks
        && current.fileIdentity.dev === artifact.fileIdentity.dev
        && current.fileIdentity.ino === artifact.fileIdentity.ino
        && current.mtimeNs === artifact.mtimeNs
        && current.ctimeNs === artifact.ctimeNs;
      if (!unchanged) {
        reasons.push(
          `Verified canary PNG changed in path identity, size, hash, dimensions, `
          + `or strict decoding after initial verification: ${resolved}`,
        );
        break;
      }
    } catch (error) {
      reasons.push(
        `Verified canary PNG could not be strictly rechecked: ${resolved} `
        + `(${error instanceof Error ? error.message : String(error)})`,
      );
      break;
    }
  }
  return validationResult(reasons);
}

function refreshReportState(report) {
  const passed = report.gates.filter((gate) => gate.ok).length;
  const allGatesPass = report.inputContractPassed && passed === report.gates.length;
  report.summary = {
    total: report.gates.length,
    passed,
    failed: report.gates.length - passed,
  };
  report.allGatesPass = allGatesPass;
  report.appReady = allGatesPass;
  report.status = allGatesPass ? 'APP_READY' : 'APP_NEEDS_WORK';
  report.failures = [
    ...report.gates.filter((gate) => !gate.ok).map((gate) => ({
      gateId: gate.id,
      evidencePath: gate.evidencePath,
      reason: gate.reason,
    })),
    ...report.inputErrors.map((reason) => ({
      gateId: 'explicit-input-contract',
      evidencePath: null,
      reason,
    })),
  ];
}

function appendFinalStoreCapsuleFailure(report, reason) {
  const gate = report.gates.find((candidate) => candidate.id === 's7-continuous-operation');
  if (!gate) return;
  appendGateFailure(gate, reason);
  refreshReportState(report);
}

function verifyFinalStoreCapsuleEvidence(report) {
  const gate = report.gates.find((candidate) => candidate.id === 's7-continuous-operation');
  if (!gate?.ok) return true;
  const validation = verifyFileArtifactsUnchanged(report._verifiedFileArtifacts);
  if (validation.ok) return true;
  appendFinalStoreCapsuleFailure(
    report,
    `Final Store Capsule TOCTOU verification failed: ${validation.reason}`,
  );
  return false;
}

function verifyFinalCanaryPngEvidence(report) {
  let allValid = true;
  for (const gateId of ['manual-canary', 'policy-auto-canary']) {
    const gate = report.gates.find((candidate) => candidate.id === gateId);
    if (!gate?.ok) continue;
    const proofs = report._verifiedCanaryPngArtifacts?.[gateId];
    const validation = verifyCanaryPngArtifactsUnchanged(proofs);
    if (validation.ok) continue;
    appendGateFailure(
      gate,
      `Final canary PNG TOCTOU verification failed: ${validation.reason}`,
    );
    allValid = false;
  }
  if (!allValid) refreshReportState(report);
  return allValid;
}

function appendFinalAuthorityCurrentnessFailure(report, reason) {
  const state = report._authorityCurrentnessState;
  if (state && !state.failures.includes(reason)) state.failures.push(reason);
  report.authoritySnapshot.ok = false;
  report.authoritySnapshot.reason = report.authoritySnapshot.reason === 'Evidence passed its production contract.'
    ? reason
    : `${report.authoritySnapshot.reason}; ${reason}`;
  for (const gate of report.gates.filter((candidate) => (
    AUTHORITY_SNAPSHOT_DEPENDENT_GATE_IDS.includes(candidate.id)
  ))) {
    appendGateFailure(gate, reason);
  }
  report.authoritySnapshot.currentness = publicAuthorityCurrentnessSummary(state);
  refreshReportState(report);
}

function captureAndVerifyFinalAuthorityCurrentness(report, captureLabel) {
  const state = report._authorityCurrentnessState;
  if (!state) {
    appendFinalAuthorityCurrentnessFailure(
      report,
      `WAL-aware authority currentness ${captureLabel} state is unavailable.`,
    );
    return false;
  }
  const capture = captureAuthorityCurrentness(
    state.sourceDatabasePath,
    state.expectedSnapshotArtifact,
    captureLabel,
    state.injectedContext,
  );
  if (!capture.ok) {
    appendFinalAuthorityCurrentnessFailure(report, capture.reason);
    return false;
  }
  state.proofs.push(capture.proof);
  try {
    assertMatchingAuthorityCurrentnessProofs(
      state.proofs,
      state.expectedSnapshotArtifact,
      `Formal readiness ${captureLabel}`,
    );
  } catch (error) {
    appendFinalAuthorityCurrentnessFailure(
      report,
      `WAL-aware authority currentness ${captureLabel} proof reconciliation failed closed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
  report.authoritySnapshot.currentness = publicAuthorityCurrentnessSummary(state);
  return true;
}

function reconcilePackageIdentity(gates) {
  const packageGateIds = new Set([
    'v15-final-readiness',
    'package-launch',
    'package-ui',
    'package-security',
    'package-adversarial-node-env',
    's7-continuous-operation',
    'manual-canary',
    'policy-auto-canary',
  ]);
  const providers = gates.filter((gate) => packageGateIds.has(gate.id) && gate._validation?.packageIdentity);
  const packageIdentity = {};
  for (const field of PACKAGE_IDENTITY_FIELDS) {
    const values = providers
      .map((gate) => gate._validation.packageIdentity[field])
      .filter(Boolean)
      .map((value) => String(value).toUpperCase());
    const unique = new Set(values);
    packageIdentity[field] = unique.size === 1 ? values[0] : null;
    if (unique.size > 1) {
      for (const gate of providers.filter((candidate) => candidate._validation.packageIdentity[field])) {
        appendGateFailure(gate, `Package ${field} does not match the other explicitly selected evidence.`);
      }
    }
  }
  return packageIdentity;
}

function reconcileCanonicalProvenance(gates, selections, context, canonicalPackage, snapshotValidation) {
  const packageBoundGateIds = new Set([
    'v15-final-readiness', 'package-launch', 'package-ui', 'package-security',
    'package-adversarial-node-env', 's7-continuous-operation', 'manual-canary', 'policy-auto-canary',
  ]);
  const operationalIds = ['s7-continuous-operation', 'manual-canary', 'policy-auto-canary'];
  if (!canonicalPackage.ok || !canonicalPackage.packageIdentity) {
    for (const gate of gates.filter((item) => packageBoundGateIds.has(item.id))) {
      appendGateFailure(gate, `Canonical repository package verification failed: ${canonicalPackage.reason}`);
    }
    return;
  }
  for (const gate of gates.filter((item) => packageBoundGateIds.has(item.id))) {
    const identity = gate._validation?.packageIdentity;
    if (operationalIds.includes(gate.id) && !stableEqual(identity, canonicalPackage.packageIdentity)) {
      appendGateFailure(gate, 'Operational evidence packageIdentity does not match the current canonical package.');
      continue;
    }
    for (const field of PACKAGE_IDENTITY_FIELDS) {
      if (identity?.[field] && normalizeSha256(identity[field]) !== canonicalPackage.packageIdentity[field]) {
        appendGateFailure(gate, `Package ${field} does not match the hash recomputed from the canonical repository release.`);
      }
    }
  }
  if (!snapshotValidation.ok) {
    for (const id of operationalIds) {
      appendGateFailure(gates.find((gate) => gate.id === id), `Authority snapshot provenance failed: ${snapshotValidation.reason}`);
    }
    return;
  }

  const nowMs = Number(context.nowMs);
  const builtAtMs = canonicalPackage.builtAtMs;
  const exportedAtMs = Date.parse(snapshotValidation.manifest.exportedAt);
  const operationalTimes = new Map();
  for (const id of operationalIds) {
    const gate = gates.find((item) => item.id === id);
    const generatedAtMs = Date.parse(selections.get(id)?.evidence?.generatedAt);
    operationalTimes.set(id, generatedAtMs);
    const maxAgeMs = id === 's7-continuous-operation' ? MAX_CONTINUOUS_EVIDENCE_AGE_MS : MAX_CANARY_EVIDENCE_AGE_MS;
    if (!Number.isFinite(generatedAtMs)
      || generatedAtMs < builtAtMs
      || generatedAtMs < exportedAtMs
      || generatedAtMs > nowMs + MAX_FUTURE_SKEW_MS
      || nowMs - generatedAtMs > maxAgeMs) {
      appendGateFailure(gate, 'Operational evidence is future-dated, stale, predates the package/snapshot, or has invalid ordering.');
    }
  }
  const continuousWindowEndMs = Date.parse(`${selections.get('s7-continuous-operation')?.evidence?.window?.dateTo}T23:59:59.999Z`);
  const continuousWindowStart = selections.get('s7-continuous-operation')?.evidence?.window?.dateFrom;
  const packageBuildDate = new Date(builtAtMs).toISOString().slice(0, 10);
  if (!Number.isFinite(continuousWindowEndMs)
    || typeof continuousWindowStart !== 'string'
    || continuousWindowStart < packageBuildDate
    || continuousWindowEndMs < builtAtMs
    || continuousWindowEndMs > operationalTimes.get('s7-continuous-operation')) {
    appendGateFailure(
      gates.find((gate) => gate.id === 's7-continuous-operation'),
      'Continuous-operation business window predates the current package build or ends after evidence generation.',
    );
  }
  if (!Number.isFinite(exportedAtMs)
    || exportedAtMs < builtAtMs
    || exportedAtMs > nowMs + MAX_FUTURE_SKEW_MS
    || nowMs - exportedAtMs > MAX_CANARY_EVIDENCE_AGE_MS) {
    for (const id of operationalIds) {
      appendGateFailure(gates.find((gate) => gate.id === id), 'Authority snapshot exportedAt is future-dated, stale, or predates the current package build.');
    }
  }
  const continuousAt = operationalTimes.get('s7-continuous-operation');
  for (const id of ['manual-canary', 'policy-auto-canary']) {
    if (Number.isFinite(continuousAt) && Number.isFinite(operationalTimes.get(id)) && continuousAt > operationalTimes.get(id)) {
      appendGateFailure(gates.find((gate) => gate.id === id), 'Canary evidence predates the continuous-operation evidence and is replayed out of order.');
    }
  }
  for (const id of ['v15-final-readiness', 'package-launch', 'package-ui', 'package-security', 'package-adversarial-node-env']) {
    const gate = gates.find((item) => item.id === id);
    const generatedAtMs = Date.parse(selections.get(id)?.evidence?.generatedAt);
    if (!Number.isFinite(generatedAtMs)
      || generatedAtMs < builtAtMs
      || generatedAtMs > nowMs + MAX_FUTURE_SKEW_MS
      || nowMs - generatedAtMs > MAX_PACKAGE_EVIDENCE_AGE_MS) {
      appendGateFailure(gate, 'Package evidence is future-dated, stale, or predates the current package build.');
    }
  }
}

function reconcileCanaryIdentity(gates, selections) {
  const manual = gates.find((gate) => gate.id === 'manual-canary');
  const policy = gates.find((gate) => gate.id === 'policy-auto-canary');
  if (!manual?._validation?.canaryBinding || !policy?._validation?.canaryBinding) return;
  const sameEvidencePath = samePath(
    selections.get('manual-canary')?.evidencePath,
    selections.get('policy-auto-canary')?.evidencePath,
  );
  const distinctAuthority = ['authorityId', 'batchId', 'jobId', 'missionGrantId']
    .every((field) => manual._validation.canaryBinding[field] !== policy._validation.canaryBinding[field]);
  if (sameEvidencePath || !distinctAuthority) {
    const reason = 'Manual and policy-auto canaries must be distinct real executions with distinct authority bindings.';
    appendGateFailure(manual, reason);
    appendGateFailure(policy, reason);
  }
}

function publicGate(gate) {
  return {
    id: gate.id,
    name: gate.name,
    status: gate.status,
    ok: gate.ok,
    evidencePath: gate.evidencePath,
    reason: gate.reason,
    ...(gate.supersededBy ? { supersededBy: [...gate.supersededBy] } : {}),
  };
}

function buildReport(parsed, injectedContext = null) {
  const productionContext = defaultProductionContext(parsed.values['authority-db']);
  const context = {
    ...productionContext,
    ...(injectedContext || {}),
    authorityDbPath: productionContext.authorityDbPath,
    authorityDbError: productionContext.authorityDbError,
  };
  const selections = new Map();
  const selectedPaths = {};
  for (const spec of GATE_SPECS) {
    const selection = readEvidenceSelection(spec, parsed.values[spec.option]);
    selections.set(spec.id, selection);
    selectedPaths[spec.id] = selection.evidencePath;
  }
  const canonicalPackage = inspectCanonicalPackage(context);
  const snapshotSpec = { id: 'authority-snapshot', name: 'Canonical authority database snapshot', option: 'authority-snapshot-manifest' };
  const snapshotSelection = readEvidenceSelection(snapshotSpec, parsed.values['authority-snapshot-manifest']);
  const snapshotContractValidation = snapshotSelection.gate
    ? validationResult([snapshotSelection.gate.reason])
    : validateAuthoritySnapshotManifest(snapshotSelection, context, canonicalPackage);
  const expectedSnapshotArtifact = expectedAuthoritySnapshotArtifact(snapshotSelection);
  const initialCurrentnessCapture = snapshotContractValidation.ok
    ? captureAuthorityCurrentness(
      context.authorityDbPath,
      expectedSnapshotArtifact,
      'after-snapshot-selection',
      injectedContext,
    )
    : {
      ok: false,
      proof: null,
      reason: 'WAL-aware authority currentness was not credited because the authority snapshot contract did not pass.',
    };
  const snapshotValidation = snapshotContractValidation.ok
    ? mergeSnapshotCurrentnessValidation(
      snapshotContractValidation,
      initialCurrentnessCapture,
    )
    : {
      ...snapshotContractValidation,
      initialCurrentnessProof: null,
    };
  const authoritySnapshotSourcePath = snapshotValidation.manifest?.source?.absolutePath;
  const validationContext = {
    packageLaunchPath: selections.get('package-launch').evidencePath,
    packageAdversarialPath: selections.get('package-adversarial-node-env').evidencePath,
    canonicalReleaseRoot: context.releaseRoot,
    canonicalExecutablePath: context.executablePath,
    authoritySnapshotPath: snapshotValidation.snapshotPath,
    authoritySnapshotManifestSha256: snapshotSelection.evidencePath && fs.existsSync(snapshotSelection.evidencePath)
      ? sha256File(snapshotSelection.evidencePath)
      : null,
    authoritySnapshotExportedAt: snapshotValidation.manifest?.exportedAt,
    authoritySnapshotSourcePath,
    canonicalStoresRoot: nonEmpty(authoritySnapshotSourcePath)
      ? path.resolve(path.dirname(authoritySnapshotSourcePath), 'stores')
      : null,
    nowMs: context.nowMs,
    packageBuiltAtMs: canonicalPackage.builtAtMs,
    packageIdentity: canonicalPackage.packageIdentity,
  };
  const internalGates = GATE_SPECS.map((spec) => validateSelection(spec, selections.get(spec.id), validationContext));
  reconcilePackageIdentity(internalGates);
  reconcileCanonicalProvenance(internalGates, selections, context, canonicalPackage, snapshotValidation);
  const packageIdentity = canonicalPackage.packageIdentity || {
    executableSha256: null,
    appContentSha256: null,
    mainBundleSha256: null,
  };
  reconcileCanaryIdentity(internalGates, selections);
  const gates = internalGates.map(publicGate);
  const inputContractPassed = parsed.errors.length === 0;
  const passed = gates.filter((gate) => gate.ok).length;
  const allGatesPass = inputContractPassed && passed === gates.length;
  const report = {
    kind: OUTPUT_KIND,
    schemaVersion: OUTPUT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: allGatesPass ? 'APP_READY' : 'APP_NEEDS_WORK',
    appReady: allGatesPass,
    allGatesPass,
    inputContractPassed,
    evidenceSelection: {
      explicitOnly: true,
      latestFallbackUsed: false,
      selectedPaths,
      authorityDb: context.authorityDbPath,
      authoritySnapshotManifest: snapshotSelection.evidencePath,
    },
    authoritySnapshot: {
      ok: snapshotValidation.ok,
      evidencePath: snapshotSelection.evidencePath,
      reason: snapshotValidation.reason,
    },
    packageIdentity,
    inputErrors: parsed.errors,
    summary: { total: gates.length, passed, failed: gates.length - passed },
    gates,
  };
  report.failures = [
    ...gates.filter((gate) => !gate.ok).map((gate) => ({
      gateId: gate.id,
      evidencePath: gate.evidencePath,
      reason: gate.reason,
    })),
    ...parsed.errors.map((reason) => ({ gateId: 'explicit-input-contract', evidencePath: null, reason })),
  ];
  const continuousValidation = internalGates.find(
    (gate) => gate.id === 's7-continuous-operation',
  )?._validation;
  Object.defineProperty(report, '_verifiedFileArtifacts', {
    configurable: false,
    enumerable: false,
    value: continuousValidation?.verifiedFileArtifacts ?? Object.freeze([]),
    writable: false,
  });
  const verifiedCanaryPngArtifacts = Object.freeze(Object.fromEntries(
    ['manual-canary', 'policy-auto-canary'].map((gateId) => {
      const validation = internalGates.find((gate) => gate.id === gateId)?._validation;
      const proofs = Array.isArray(validation?.verifiedPngArtifacts)
        ? validation.verifiedPngArtifacts.map((artifact) => Object.freeze({
          ...artifact,
          fileIdentity: Object.freeze({ ...artifact.fileIdentity }),
        }))
        : [];
      return [gateId, Object.freeze(proofs)];
    }),
  ));
  Object.defineProperty(report, '_verifiedCanaryPngArtifacts', {
    configurable: false,
    enumerable: false,
    value: verifiedCanaryPngArtifacts,
    writable: false,
  });
  const authorityCurrentnessState = {
    expectedSnapshotArtifact,
    failures: initialCurrentnessCapture.ok
      ? []
      : [initialCurrentnessCapture.reason],
    injectedContext,
    proofs: initialCurrentnessCapture.ok
      ? [initialCurrentnessCapture.proof]
      : [],
    sourceDatabasePath: context.authorityDbPath,
  };
  Object.defineProperty(report, '_authorityCurrentnessState', {
    configurable: false,
    enumerable: false,
    value: authorityCurrentnessState,
    writable: false,
  });
  report.authoritySnapshot.currentness =
    publicAuthorityCurrentnessSummary(authorityCurrentnessState);
  return report;
}

function writeReport(outputPath, report) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    const handle = fs.openSync(tempPath, 'r+');
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(tempPath, outputPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function buildPendingPublicationReport(report, outputPath) {
  const pendingReport = JSON.parse(JSON.stringify(report));
  const gates = Array.isArray(pendingReport.gates) ? pendingReport.gates : [];
  gates.push({
    id: 'final-publication-recheck',
    ok: false,
    status: 'needs_work',
    evidencePath: outputPath,
    reason:
      'Final post-write Store Capsule, canary PNG, and authority currentness rechecks have not completed.',
  });
  pendingReport.gates = gates;
  pendingReport.appReady = false;
  pendingReport.allGatesPass = false;
  pendingReport.status = 'APP_NEEDS_WORK';
  pendingReport.summary = {
    total: gates.length,
    passed: gates.filter((gate) => gate?.ok === true).length,
    failed: gates.filter((gate) => gate?.ok !== true).length,
  };
  pendingReport.publication = {
    state: 'pending-post-write-recheck',
    finalReaderFacing: false,
    readyPublicationAllowed: false,
  };
  return pendingReport;
}

function usage() {
  return [
    'Usage: node scripts/verify-mission-control-production-readiness.js',
    ...GATE_SPECS.map((spec) => `  --${spec.option} <evidence.json>`),
    '  --authority-db <absolute live authority database>',
    '  --authority-snapshot-manifest <snapshot-provenance.json>',
    '  --out <readiness.json>',
  ].join('\n');
}

function run(argv = process.argv.slice(2), injectedContext = null) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(`${usage()}\n`);
    return { exitCode: 0, report: null, outputPath: null };
  }
  const outputPath = path.resolve(parsed.values.out || defaultOutputPath());
  const report = buildReport(parsed, injectedContext);
  if (
    injectedContext
    && Object.prototype.hasOwnProperty.call(injectedContext, 'beforeFinalEvidenceRecheck')
  ) {
    if (typeof injectedContext.beforeFinalEvidenceRecheck !== 'function') {
      appendFinalStoreCapsuleFailure(
        report,
        'Injected beforeFinalEvidenceRecheck test hook must be a function.',
      );
    } else {
      try {
        injectedContext.beforeFinalEvidenceRecheck({ outputPath });
      } catch (error) {
        appendFinalStoreCapsuleFailure(
          report,
          `Injected beforeFinalEvidenceRecheck test hook failed closed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  captureAndVerifyFinalAuthorityCurrentness(report, 'before-final-report-write');
  verifyFinalStoreCapsuleEvidence(report);
  verifyFinalCanaryPngEvidence(report);
  // Replace any stale reader-facing READY file with an explicit fail-closed
  // publication before the write-side rechecks begin. If the process exits or
  // crashes during those rechecks, the durable path cannot retain APP_READY.
  writeReport(outputPath, buildPendingPublicationReport(report, outputPath));
  if (typeof injectedContext?.afterFailClosedReportWrite === 'function') {
    injectedContext.afterFailClosedReportWrite({ outputPath });
  }
  const storeCapsuleStillValid = verifyFinalStoreCapsuleEvidence(report);
  const canaryPngsStillValid = verifyFinalCanaryPngEvidence(report);
  const authorityStillCurrent = captureAndVerifyFinalAuthorityCurrentness(
    report,
    'after-final-report-write',
  );
  if (!storeCapsuleStillValid || !canaryPngsStillValid || !authorityStillCurrent) {
    refreshReportState(report);
  }
  // Only this atomic replace may publish APP_READY. No protected authority or
  // Store Capsule input is touched by writing it.
  writeReport(outputPath, report);
  process.stdout.write(`${report.status}: ${report.summary.passed}/${report.summary.total} production gates passed.\n`);
  process.stdout.write(`Evidence: ${outputPath}\n`);
  return { exitCode: report.appReady ? 0 : 1, report, outputPath };
}

if (require.main === module) {
  try {
    const result = run();
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  EXECUTION_CANARY_AUTHORITY_QUERY_CONTRACT,
  AUTHORITY_SNAPSHOT_BACKUP_METHOD,
  AUTHORITY_SNAPSHOT_KIND,
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  EXECUTION_CANARY_KIND,
  EXECUTION_CANARY_SCHEMA_VERSION,
  GATE_SPECS,
  OUTPUT_KIND,
  OUTPUT_SCHEMA_VERSION,
  S7_CONTINUOUS_OPERATION_KIND,
  S7_CONTINUOUS_OPERATION_SCHEMA_VERSION,
  V15_GATE_IDS,
  V15_SUPERSEDED_GATE_ID,
  V15_SUPERSEDING_GATE_IDS,
  buildReport,
  deterministicExecutionArtifactPath,
  deterministicExecutionArtifactRef,
  isUsBusinessDate,
  parseArgs,
  run,
  validateContinuousOperation,
  validateAuthoritySnapshotManifest,
  validateExecutionCanary,
  validatePackageAdversarialNodeEnv,
  validatePackageLaunch,
  validatePackageSecurity,
  validatePackageUi,
  validateV15FinalReadiness,
};
