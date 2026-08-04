const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  TARGET_VERSION,
  collectRowCounts,
  evaluateBusinessRowPreservation,
  loadLocalDbRuntime,
  readAppliedVersion,
  requireSqlite,
} = require('./migrate-current-user-db.js');
const {
  REQUIRED_TABLES,
  inspectStoreProviderIdentityV11Schema,
  legacyV1Checksum,
  migrationContract,
  migrationRowsMatchProductionContract,
  migrationV1ChecksumWhitelist,
} = require('./verify-production-authority-selection.js');
const {
  CURRENTNESS_METHOD,
  SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
  runReadonlySqliteOnlineBackupSync,
} = require('./sqlite-authority-currentness.js');

const KIND = 's7-live-migration-acceptance';
const SCHEMA_VERSION = 's7-live-migration-acceptance/v1';
const AUTHORITY_SELECTION_KIND = 'production-authority-selection-preflight';
const AUTHORITY_SELECTION_SCHEMA_VERSION = 'production-authority-selection-preflight/v1';
const OFFLINE_MIGRATION_KIND = 's7-offline-db-upgrade';
const OFFLINE_MIGRATION_SCHEMA_VERSION = 1;
const MIGRATION_VERIFICATION_KIND = 's7-migration-backup-restore-verification';
const MIGRATION_VERIFICATION_SCHEMA_VERSION = 1;
const OFFLINE_SIDECAR_SUFFIXES = Object.freeze(['-wal', '-shm', '-journal']);
// V9-named check-code identifiers are retained as the schema-v1 evidence ABI;
// every corresponding check is bound to TARGET_VERSION, currently v11.
const REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES = Object.freeze([
  'MANIFEST_SCHEMA_VALID',
  'SOURCE_AND_OUTPUT_PATHS_DISTINCT',
  'SOURCE_HASH_MATCH',
  'UPGRADED_COPY_HASH_MATCH',
  'RESTORED_COPY_HASH_MATCH',
  'UPGRADED_INTEGRITY_OK',
  'UPGRADED_FOREIGN_KEYS_OK',
  'MIGRATIONS_1_TO_9_APPLIED',
  'V9_BACKUP_PREFLIGHT_OK',
  'V9_BACKUP_SOURCE_VERSION_BOUND',
  'V9_BACKUP_SCHEMA_BOUND',
  'V9_BACKUP_ROWS_BOUND',
  'BUSINESS_ROW_PRESERVATION_RECOMPUTED',
  'BUSINESS_ROW_TRANSFER_PROOF_BOUND',
  'RESTORED_INTEGRITY_OK',
  'RESTORED_SOURCE_VERSION_MATCH',
  'RESTORED_ROW_COUNTS_MATCH',
  'EVIDENCE_MIGRATION_RECORDS_BOUND',
  'BUSINESS_ROWS_PRESERVED',
]);
const REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES = Object.freeze([
  'OFFLINE_MIGRATION_SCHEMA_PASSED',
  'OFFLINE_MIGRATION_SOURCE_PATH_BOUND',
  'OFFLINE_MIGRATION_TARGET_V9',
  'OFFLINE_MIGRATION_SOURCE_BASELINE_VALID',
  'OFFLINE_MIGRATION_LEASE_BOUND',
  'OFFLINE_MIGRATION_ARTIFACT_HASHES_BOUND',
  'OFFLINE_MIGRATION_RECORDS_PRESERVATION_PASSED',
  'AUTHORITY_SELECTION_SCHEMA_BOUND',
  'AUTHORITY_SELECTION_PATH_BOUND',
  'AUTHORITY_SELECTION_PRE_MIGRATION_STATE',
  'AUTHORITY_SELECTION_READONLY_SAFETY',
  'PRE_MIGRATION_MAIN_SHA_BOUND',
  'MIGRATION_VERIFICATION_SCHEMA_PASSED',
  'MIGRATION_VERIFICATION_MANIFEST_BOUND',
  'MIGRATION_VERIFICATION_INPUT_HASHED',
  'OFFLINE_ARTIFACT_PATHS_DISTINCT',
  'OFFLINE_WORKING_ARTIFACT_IDENTITY_BOUND',
  'OFFLINE_RESTORE_ARTIFACT_IDENTITY_BOUND',
  'OFFLINE_WORKING_ARTIFACT_HASH_BOUND',
  'OFFLINE_RESTORE_ARTIFACT_HASH_BOUND',
  'OFFLINE_WORKING_OPEN_IDENTITY_BOUND',
  'OFFLINE_WORKING_QUERY_ONLY_INTEGRITY',
  'OFFLINE_WORKING_MIGRATIONS_CURRENT',
  'OFFLINE_WORKING_ROW_PRESERVATION_BOUND',
  'OFFLINE_WORKING_V9_RECOVERY_PREFLIGHT',
  'OFFLINE_WORKING_ARTIFACT_STABLE_AFTER_READ',
  'OFFLINE_RESTORE_OPEN_IDENTITY_BOUND',
  'OFFLINE_RESTORE_QUERY_ONLY_INTEGRITY',
  'OFFLINE_RESTORE_SOURCE_BASELINE_BOUND',
  'OFFLINE_RESTORE_ARTIFACT_STABLE_AFTER_READ',
  'LIVE_WAL_AWARE_READONLY_BACKUP',
  'LIVE_LOGICAL_SNAPSHOT_HASH_BOUND',
  'LIVE_LOGICAL_SNAPSHOT_QUERY_ONLY',
  'LIVE_LOGICAL_SNAPSHOT_INTEGRITY',
  'LIVE_REQUIRED_TABLES_PRESENT',
  'LIVE_MIGRATIONS_1_TO_9_CURRENT',
  'LIVE_V11_STORE_PROVIDER_IDENTITY_SCHEMA_CURRENT',
  'LIVE_BUSINESS_ROWS_PRESERVED',
  'LIVE_V9_UPGRADE_BACKUP_EMBEDDED',
  'LIVE_V9_UPGRADE_BACKUP_PATHS_BOUND',
  'LIVE_V9_UPGRADE_BACKUP_SOURCE_BOUND',
  'LIVE_V9_UPGRADE_BACKUP_MANIFEST_MATCH',
  'LIVE_V9_RECOVERY_PREFLIGHT_CAN_RESTORE',
  'LIVE_V9_RECOVERY_BACKUP_SHA_INTEGRITY',
  'LIVE_V9_RECOVERY_SCHEMA_ROWS',
  'LIVE_FINAL_WAL_AWARE_READONLY_BACKUP',
  'LIVE_LOGICAL_SNAPSHOT_STABLE',
  'LIVE_MAIN_FILE_UNCHANGED',
]);
const CAPTURE_FILE_NAMES = Object.freeze([
  'live-authority-logical-snapshot.db',
  'live-authority-logical-snapshot.db-wal',
  'live-authority-logical-snapshot.db-shm',
  'live-authority-logical-snapshot.db-journal',
  'live-authority-logical-snapshot-final.db',
  'live-authority-logical-snapshot-final.db-wal',
  'live-authority-logical-snapshot-final.db-shm',
  'live-authority-logical-snapshot-final.db-journal',
]);
const SINGLE_VALUE_OPTIONS = new Set([
  'db',
  'authority-selection',
  'migration-manifest',
  'migration-verification',
  'out',
]);
const REQUIRED_OPTIONS = Object.freeze([...SINGLE_VALUE_OPTIONS]);

const LIVE_MIGRATION_ACCEPTANCE_USAGE = [
  'Usage: node scripts/verify-s7-live-migration-acceptance.js',
  '  --db <absolute live amazon-ai-ops.db>',
  '  --authority-selection <absolute production authority selection JSON>',
  '  --migration-manifest <absolute S7 offline migration manifest JSON>',
  '  --migration-verification <absolute S7 migration verification JSON>',
  '  --out <absolute new acceptance receipt JSON>',
  '',
  'This command is a fail-closed, read-only post-migration acceptance check.',
  'It reads the live authority only through a WAL-aware read-only online backup.',
  'The final receipt is created once with exclusive atomic publication.',
  'Run only after the user has approved the live migration procedure.',
].join('\n');

function fail(message) {
  throw new Error(message);
}

function normalizedPath(filePath) {
  const resolved = path.resolve(filePath).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(left, right) {
  return typeof left === 'string'
    && typeof right === 'string'
    && normalizedPath(left) === normalizedPath(right);
}

function assertCleanAbsolutePath(candidatePath, label) {
  if (
    typeof candidatePath !== 'string'
    || candidatePath !== candidatePath.trim()
    || candidatePath.length === 0
    || candidatePath.includes('\0')
    || !path.isAbsolute(candidatePath)
  ) {
    fail(`${label} must be a clean absolute path.`);
  }
  return path.resolve(candidatePath);
}

function entryExists(candidatePath) {
  try {
    fs.lstatSync(candidatePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function assertDirectExistingPath(candidatePath, label, expectedKind) {
  const resolved = assertCleanAbsolutePath(candidatePath, label);
  let lstat;
  try {
    lstat = fs.lstatSync(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`${label} does not exist: ${resolved}`);
    throw error;
  }
  if (lstat.isSymbolicLink()) {
    fail(`${label} may not be a symbolic link, junction, or reparse point: ${resolved}`);
  }
  const realPath = fs.realpathSync.native(resolved);
  if (!samePath(resolved, realPath)) {
    fail(`${label} may not traverse a symbolic link, junction, or reparse point: ${resolved}`);
  }
  const stat = fs.statSync(realPath);
  if (expectedKind === 'file' && !stat.isFile()) fail(`${label} must be a regular file.`);
  if (expectedKind === 'directory' && !stat.isDirectory()) fail(`${label} must be a real directory.`);
  return { realPath, stat };
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex').toUpperCase();
}

function normalizeSha256(value, label) {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    fail(`${label} must be exactly 64 hexadecimal characters.`);
  }
  return normalized;
}

function fileArtifact(filePath, label) {
  const resolved = assertCleanAbsolutePath(filePath, label);
  const directBefore = assertDirectExistingPath(resolved, label, 'file');
  if (directBefore.stat.nlink !== 1) {
    fail(`${label} must have exactly one hard link.`);
  }
  const handle = fs.openSync(directBefore.realPath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytesReadTotal = 0;
  let handleBefore;
  let handleAfter;
  let directAfter;
  try {
    handleBefore = fs.fstatSync(handle);
    if (!sameStableFileStat(directBefore.stat, handleBefore)) {
      fail(`${label} changed identity before hashing began.`);
    }
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
        bytesReadTotal += bytesRead;
      }
    } while (bytesRead > 0);
    handleAfter = fs.fstatSync(handle);
    if (!sameStableFileStat(handleBefore, handleAfter)
      || bytesReadTotal !== handleBefore.size) {
      fail(`${label} changed while it was being hashed.`);
    }
    directAfter = assertDirectExistingPath(resolved, label, 'file');
    if (!sameStableFileStat(handleAfter, directAfter.stat)
      || !samePath(directAfter.realPath, directBefore.realPath)) {
      fail(`${label} path was replaced while it was being hashed.`);
    }
  } finally {
    fs.closeSync(handle);
  }
  return Object.freeze({
    path: resolved,
    realPath: directAfter.realPath,
    identity: statIdentity(handleAfter, directAfter.realPath),
    sha256: hash.digest('hex').toUpperCase(),
    sizeBytes: bytesReadTotal,
    mtimeMs: handleAfter.mtimeMs,
  });
}

function statIdentity(stat, realPath) {
  return Object.freeze({
    realPath,
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    birthtimeMs: stat.birthtimeMs,
    nlink: Number(stat.nlink),
  });
}

function sameCreatedIdentity(left, right) {
  return samePath(left.realPath, right.realPath)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeMs === right.birthtimeMs
    && left.nlink === right.nlink;
}

function sameStableFileStat(left, right) {
  return Number(left.dev) === Number(right.dev)
    && Number(left.ino) === Number(right.ino)
    && Number(left.nlink) === Number(right.nlink)
    && left.birthtimeMs === right.birthtimeMs
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function sameMainArtifact(left, right) {
  return left.realPath === right.realPath
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.mtimeMs === right.mtimeMs;
}

function sameFileArtifact(left, right) {
  return sameCreatedIdentity(left.identity, right.identity)
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.mtimeMs === right.mtimeMs;
}

function assertOfflineSidecarsAbsent(databasePath, label) {
  const present = OFFLINE_SIDECAR_SUFFIXES
    .map((suffix) => `${databasePath}${suffix}`)
    .filter(entryExists);
  if (present.length > 0) {
    fail(`${label} has pre-existing or persistent SQLite sidecar files: ${
      present.map((candidate) => path.basename(candidate)).join(', ')
    }`);
  }
}

function readJsonArtifact(filePath, label, injectedHooks = {}) {
  const resolved = assertCleanAbsolutePath(filePath, label);
  const directBefore = assertDirectExistingPath(resolved, label, 'file');
  if (directBefore.stat.nlink !== 1) {
    fail(`${label} must have exactly one hard link.`);
  }
  const handle = fs.openSync(directBefore.realPath, 'r');
  let bytes;
  let handleBefore;
  let handleAfter;
  let directAfter;
  try {
    handleBefore = fs.fstatSync(handle);
    if (!sameStableFileStat(directBefore.stat, handleBefore)) {
      fail(`${label} changed identity before its stable read began.`);
    }
    bytes = fs.readFileSync(handle);
    if (typeof injectedHooks.afterRead === 'function') {
      injectedHooks.afterRead({
        bytes,
        filePath: resolved,
        realPath: directBefore.realPath,
      });
    }
    handleAfter = fs.fstatSync(handle);
    if (!sameStableFileStat(handleBefore, handleAfter) || bytes.length !== handleBefore.size) {
      fail(`${label} changed while its bytes were being read.`);
    }
    directAfter = assertDirectExistingPath(resolved, label, 'file');
    if (!sameStableFileStat(handleAfter, directAfter.stat)
      || !samePath(directAfter.realPath, directBefore.realPath)) {
      fail(`${label} path was replaced while its bytes were being read.`);
    }
  } finally {
    fs.closeSync(handle);
  }
  const artifact = Object.freeze({
    path: resolved,
    realPath: directAfter.realPath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    sizeBytes: bytes.length,
    mtimeMs: handleAfter.mtimeMs,
  });
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must contain one JSON object.`);
  }
  return { artifact, value };
}

function parseLiveMigrationAcceptanceArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true, values: {} };
  }
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`Unexpected positional argument: ${token}`);
    const name = token.slice(2);
    if (!SINGLE_VALUE_OPTIONS.has(name)) fail(`Unknown argument: --${name}.`);
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      fail(`Duplicate argument: --${name}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`--${name} requires a value.`);
    }
    values[name] = value;
    index += 1;
  }
  for (const required of REQUIRED_OPTIONS) {
    if (!values[required]) fail(`--${required} is required.`);
  }
  for (const required of REQUIRED_OPTIONS) {
    values[required] = assertCleanAbsolutePath(values[required], `--${required}`);
  }
  return { help: false, values };
}

function assertOutputAvailable(outputPath) {
  const resolved = assertCleanAbsolutePath(outputPath, '--out');
  if (path.extname(resolved).toLowerCase() !== '.json') {
    fail('--out must name a .json file.');
  }
  assertDirectExistingPath(path.dirname(resolved), 'Acceptance output parent', 'directory');
  if (entryExists(resolved)) {
    fail(`Acceptance output already exists and will not be overwritten: ${resolved}`);
  }
  return resolved;
}

function addRequiredCheck(checks, code, condition, detail) {
  const passed = condition === true;
  checks.push({ code, passed, detail });
  if (!passed) fail(`${code}: ${detail}`);
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function requireExactKeys(value, expectedKeys, label) {
  if (!hasExactKeys(value, expectedKeys)) {
    fail(`${label} has extra or missing fields.`);
  }
  return value;
}

function requireAcceptanceArtifact(value, label) {
  requireExactKeys(value, ['path', 'realPath', 'sha256', 'sizeBytes'], label);
  if (
    !isCleanAbsolutePath(value.path)
    || !isCleanAbsolutePath(value.realPath)
    || !isSha256(value.sha256)
    || !Number.isSafeInteger(value.sizeBytes)
    || value.sizeBytes < 1
  ) {
    fail(`${label} proof is invalid.`);
  }
}

function requireAcceptanceOfflineArtifact(value, label, expectedKind) {
  const sharedKeys = [
    'path',
    'identity',
    'sha256',
    'sizeBytes',
    'openedReadOnly',
    'queryOnly',
    'integrityCheck',
  ];
  const expectedKeys = expectedKind === 'working'
    ? [
        ...sharedKeys,
        'foreignKeyViolationCount',
        'migrationCount',
        'businessRowPreservationPassed',
        'recoveryCanRestore',
        'mtimeMs',
        'sidecarsAbsentBeforeAndAfter',
      ]
    : [
        ...sharedKeys,
        'version',
        'sourceBaselineRowsMatch',
        'mtimeMs',
        'sidecarsAbsentBeforeAndAfter',
      ];
  requireExactKeys(value, expectedKeys, label);
  requireExactKeys(
    value.identity,
    ['realPath', 'dev', 'ino', 'birthtimeMs', 'nlink'],
    `${label} identity`,
  );
  if (
    !isCleanAbsolutePath(value.path)
    || !isSha256(value.sha256)
    || !Number.isSafeInteger(value.sizeBytes)
    || value.sizeBytes < 1
    || !Number.isFinite(value.mtimeMs)
    || !samePath(value.path, value.identity.realPath)
    || Number(value.identity.nlink) !== 1
    || value.openedReadOnly !== true
    || value.queryOnly !== true
    || value.integrityCheck !== 'ok'
    || value.sidecarsAbsentBeforeAndAfter !== true
  ) {
    fail(`${label} read-only artifact proof is invalid.`);
  }
  if (
    expectedKind === 'working'
    && (
      value.foreignKeyViolationCount !== 0
      || value.migrationCount !== TARGET_VERSION
      || value.businessRowPreservationPassed !== true
      || value.recoveryCanRestore !== true
    )
  ) {
    fail(`${label} migration/preservation proof is invalid.`);
  }
  if (
    expectedKind === 'restore'
    && (
      !Number.isInteger(value.version)
      || value.version < 0
      || value.version >= TARGET_VERSION
      || value.sourceBaselineRowsMatch !== true
    )
  ) {
    fail(`${label} source-baseline proof is invalid.`);
  }
}

function validateS7LiveMigrationAcceptanceReceipt(receipt) {
  requireExactKeys(receipt, [
    'kind',
    'schemaVersion',
    'generatedAt',
    'status',
    'passed',
    'formalEvidence',
    'authorityDatabaseMutated',
    'adsExecutionInvoked',
    'inputs',
    'checks',
    'summary',
    'safety',
  ], 'Live migration acceptance receipt');
  const generatedAt = new Date(receipt.generatedAt);
  if (
    receipt.kind !== KIND
    || receipt.schemaVersion !== SCHEMA_VERSION
    || receipt.status !== 'PASSED'
    || receipt.passed !== true
    || receipt.formalEvidence !== true
    || receipt.authorityDatabaseMutated !== false
    || receipt.adsExecutionInvoked !== false
    || !Number.isFinite(generatedAt.valueOf())
    || generatedAt.toISOString() !== receipt.generatedAt
  ) {
    fail('Live migration acceptance receipt top-level contract is invalid.');
  }

  requireExactKeys(
    receipt.inputs,
    ['database', 'authoritySelection', 'migrationManifest', 'migrationVerification'],
    'Live migration acceptance inputs',
  );
  requireExactKeys(receipt.inputs.database, [
    'path',
    'realPath',
    'sha256',
    'sizeBytes',
    'logicalSnapshotSha256',
    'logicalSnapshotSizeBytes',
  ], 'Live migration acceptance database');
  if (
    !isCleanAbsolutePath(receipt.inputs.database.path)
    || !isCleanAbsolutePath(receipt.inputs.database.realPath)
    || !isSha256(receipt.inputs.database.sha256)
    || !Number.isSafeInteger(receipt.inputs.database.sizeBytes)
    || receipt.inputs.database.sizeBytes < 1
    || !isSha256(receipt.inputs.database.logicalSnapshotSha256)
    || !Number.isSafeInteger(receipt.inputs.database.logicalSnapshotSizeBytes)
    || receipt.inputs.database.logicalSnapshotSizeBytes < 1
  ) {
    fail('Live migration acceptance database proof is invalid.');
  }
  requireAcceptanceArtifact(
    receipt.inputs.authoritySelection,
    'Live migration acceptance authority selection',
  );
  requireAcceptanceArtifact(
    receipt.inputs.migrationManifest,
    'Live migration acceptance migration manifest',
  );
  requireAcceptanceArtifact(
    receipt.inputs.migrationVerification,
    'Live migration acceptance migration verification',
  );

  const checks = Array.isArray(receipt.checks) ? receipt.checks : [];
  const checkCodes = checks.map((check) => check?.code);
  const uniqueCodes = new Set(checkCodes);
  if (
    checks.length !== REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES.length
    || uniqueCodes.size !== checks.length
    || stableJson(checkCodes) !== stableJson(REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES)
    || checks.some(
      (check) => !hasExactKeys(check, ['code', 'passed', 'detail'])
        || check.passed !== true
        || typeof check.detail !== 'string'
        || check.detail.length === 0,
    )
  ) {
    fail('Live migration acceptance must contain the exact complete, unique, all-passed check set.');
  }

  const summary = receipt.summary;
  requireExactKeys(summary, [
    'total',
    'passed',
    'failed',
    'integrityCheck',
    'foreignKeyViolationCount',
    'migrationCount',
    'requiredTableCount',
    'offlineArtifacts',
    'businessRowPreservation',
    'recovery',
  ], 'Live migration acceptance summary');
  if (
    summary.total !== checks.length
    || summary.passed !== checks.length
    || summary.failed !== 0
    || summary.integrityCheck !== 'ok'
    || summary.foreignKeyViolationCount !== 0
    || summary.migrationCount !== TARGET_VERSION
    || summary.requiredTableCount !== REQUIRED_TABLES.length
  ) {
    fail('Live migration acceptance summary does not match the complete passed proof.');
  }

  requireExactKeys(
    summary.offlineArtifacts,
    ['pathsDistinct', 'working', 'restore'],
    'Live migration acceptance offline artifacts',
  );
  if (summary.offlineArtifacts.pathsDistinct !== true) {
    fail('Live migration acceptance offline artifact paths are not distinct.');
  }
  requireAcceptanceOfflineArtifact(
    summary.offlineArtifacts.working,
    'Live migration acceptance offline working artifact',
    'working',
  );
  requireAcceptanceOfflineArtifact(
    summary.offlineArtifacts.restore,
    'Live migration acceptance offline restore artifact',
    'restore',
  );

  requireExactKeys(summary.businessRowPreservation, [
    'passed',
    'failureCount',
    'listingCurrentToHistoryTransferApplied',
    'listingCurrentToHistoryTransferPassed',
  ], 'Live migration acceptance business-row preservation');
  if (
    summary.businessRowPreservation.passed !== true
    || summary.businessRowPreservation.failureCount !== 0
    || typeof summary.businessRowPreservation.listingCurrentToHistoryTransferApplied !== 'boolean'
    || summary.businessRowPreservation.listingCurrentToHistoryTransferPassed !== true
  ) {
    fail('Live migration acceptance business-row preservation proof is invalid.');
  }

  requireExactKeys(summary.recovery, [
    'sourceVersion',
    'targetVersion',
    'backupPath',
    'backupSha256',
    'backupSizeBytes',
    'manifestPath',
    'manifestSha256',
    'backupIntegrityCheck',
    'schemaFingerprintMatches',
    'tableRowCountsMatch',
    'embeddedManifestMatchesAdjacentFile',
    'canRestore',
    'blockerCount',
  ], 'Live migration acceptance recovery');
  if (
    !Number.isInteger(summary.recovery.sourceVersion)
    || summary.recovery.sourceVersion < 0
    || summary.recovery.sourceVersion >= TARGET_VERSION
    || summary.recovery.targetVersion !== TARGET_VERSION
    || !isCleanAbsolutePath(summary.recovery.backupPath)
    || !isSha256(summary.recovery.backupSha256)
    || !Number.isSafeInteger(summary.recovery.backupSizeBytes)
    || summary.recovery.backupSizeBytes < 1
    || !isCleanAbsolutePath(summary.recovery.manifestPath)
    || !isSha256(summary.recovery.manifestSha256)
    || summary.recovery.backupIntegrityCheck !== 'ok'
    || summary.recovery.schemaFingerprintMatches !== true
    || summary.recovery.tableRowCountsMatch !== true
    || summary.recovery.embeddedManifestMatchesAdjacentFile !== true
    || summary.recovery.canRestore !== true
    || summary.recovery.blockerCount !== 0
  ) {
    fail('Live migration acceptance recovery proof is invalid.');
  }

  requireExactKeys(receipt.safety, [
    'liveDatabaseAccess',
    'liveDatabaseOpenedReadOnly',
    'liveDatabaseQueryOnly',
    'logicalSnapshotInspectedReadOnly',
    'walAwareSnapshotProofCount',
    'authorityDatabaseMutated',
    'adsExecutionInvoked',
    'businessRowContentIncluded',
    'rawSecretsIncluded',
  ], 'Live migration acceptance safety');
  if (
    receipt.safety.liveDatabaseAccess !== CURRENTNESS_METHOD
    || receipt.safety.liveDatabaseOpenedReadOnly !== true
    || receipt.safety.liveDatabaseQueryOnly !== true
    || receipt.safety.logicalSnapshotInspectedReadOnly !== true
    || receipt.safety.walAwareSnapshotProofCount !== 2
    || receipt.safety.authorityDatabaseMutated !== false
    || receipt.safety.adsExecutionInvoked !== false
    || receipt.safety.businessRowContentIncluded !== false
    || receipt.safety.rawSecretsIncluded !== false
  ) {
    fail('Live migration acceptance safety proof is invalid.');
  }
  return receipt;
}

function validateAuthoritySelection(selection, databaseArtifact, migrationManifest, checks) {
  addRequiredCheck(
    checks,
    'AUTHORITY_SELECTION_SCHEMA_BOUND',
    selection.kind === AUTHORITY_SELECTION_KIND
      && selection.schemaVersion === AUTHORITY_SELECTION_SCHEMA_VERSION,
    'authority selection must use production-authority-selection-preflight/v1',
  );
  const selected = selection.selection?.selected;
  addRequiredCheck(
    checks,
    'AUTHORITY_SELECTION_PATH_BOUND',
    samePath(selection.selection?.expectedDatabasePath, databaseArtifact.realPath)
      && samePath(selected?.absolutePath, databaseArtifact.realPath)
      && samePath(selected?.realPath, databaseArtifact.realPath),
    'expected, selected, and real authority paths must equal the canonical --db path',
  );
  addRequiredCheck(
    checks,
    'AUTHORITY_SELECTION_PRE_MIGRATION_STATE',
    selection.status === 'SELECTED_MIGRATION_REQUIRED'
      && selection.formalEvidence === false
      && selected?.role === 'selected'
      && selected?.offlineMigrationEligible === true
      && selected?.sqlite?.state === 'MIGRATION_REQUIRED'
      && selected?.sqlite?.migration?.targetReady === false,
    'selection must be the offline-eligible pre-migration authority preflight',
  );
  addRequiredCheck(
    checks,
    'AUTHORITY_SELECTION_READONLY_SAFETY',
    selection.authorityDatabaseMutated === false
      && selection.adsExecutionInvoked === false
      && selected?.sqlite?.openedReadOnly === true
      && selected?.sqlite?.queryOnly === true
      && selected?.logicalCapture?.method === CURRENTNESS_METHOD
      && selected?.logicalCapture?.source?.openedReadOnly === true
      && selected?.logicalCapture?.source?.queryOnly === true
      && selected?.sidecarObservation?.walAndJournalUnchanged === true,
    'preflight must attest read-only SQLite inspection, no authority mutation, and no Ads execution',
  );
  const sourceSha256 = normalizeSha256(
    migrationManifest.source?.sha256,
    'Offline migration source SHA-256',
  );
  addRequiredCheck(
    checks,
    'PRE_MIGRATION_MAIN_SHA_BOUND',
    normalizeSha256(
      selection.selection?.expectedMainSha256,
      'Authority selection expected main SHA-256',
    ) === sourceSha256
      && normalizeSha256(
        selected?.mainFileSha256,
        'Authority selection selected main SHA-256',
      ) === sourceSha256,
    'authority selection pre-main SHA-256 must equal the offline migration source SHA-256',
  );
}

function validateOfflineMigrationManifest(manifest, databaseArtifact, checks) {
  addRequiredCheck(
    checks,
    'OFFLINE_MIGRATION_SCHEMA_PASSED',
    manifest.kind === OFFLINE_MIGRATION_KIND
      && manifest.schemaVersion === OFFLINE_MIGRATION_SCHEMA_VERSION
      && manifest.passed === true,
    'offline migration manifest must be s7-offline-db-upgrade schema v1 and passed',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_MIGRATION_SOURCE_PATH_BOUND',
    samePath(manifest.source?.path, databaseArtifact.realPath),
    'offline migration source.path must equal the canonical live --db path',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_MIGRATION_TARGET_V9',
    manifest.targetVersion === TARGET_VERSION,
    `offline migration targetVersion must be ${TARGET_VERSION}`,
  );
  addRequiredCheck(
    checks,
    'OFFLINE_MIGRATION_SOURCE_BASELINE_VALID',
    Number.isInteger(manifest.source?.version)
      && manifest.source.version >= 0
      && manifest.source.version < TARGET_VERSION
      && isNumericRowCountRecord(manifest.source?.tableRowCounts)
      && isListingMergeBaseline(manifest.source?.listingMergeBaseline),
    'offline source version, tableRowCounts, and listingMergeBaseline must be valid',
  );
  const sourceSha256 = normalizeSha256(
    manifest.source?.sha256,
    'Offline migration source SHA-256',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_MIGRATION_LEASE_BOUND',
    manifest.offlineLease?.method === 'windows-file-share-none'
      && manifest.offlineLease?.lockHeldThroughFinalPublish === true
      && isSha256(manifest.offlineLease?.sourceSha256)
      && normalizeSha256(
        manifest.offlineLease.sourceSha256,
        'Offline lease source SHA-256',
      ) === sourceSha256
      && isSha256(manifest.offlineLease?.workingCopySha256)
      && normalizeSha256(
        manifest.offlineLease.workingCopySha256,
        'Offline lease working-copy SHA-256',
      ) === sourceSha256,
    'offline migration must be bound to the Windows FileShare.None lease through final publication',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_MIGRATION_ARTIFACT_HASHES_BOUND',
    isCleanAbsolutePath(manifest.workingDatabase?.path)
      && isSha256(manifest.workingDatabase?.sourceCopySha256)
      && normalizeSha256(
        manifest.workingDatabase.sourceCopySha256,
        'Working source-copy SHA-256',
      ) === sourceSha256
      && isSha256(manifest.workingDatabase?.upgradedSha256)
      && manifest.workingDatabase?.integrityCheck === 'ok'
      && manifest.workingDatabase?.foreignKeyViolationCount === 0
      && isCleanAbsolutePath(manifest.restore?.destinationPath)
      && isSha256(manifest.restore?.sha256)
      && manifest.restore?.version === manifest.source.version
      && manifest.restore?.integrityCheck === 'ok',
    'working and restored artifacts must expose bound absolute paths, hashes, and integrity results',
  );
  const migrationRows = Array.isArray(manifest.migrations) ? manifest.migrations : [];
  addRequiredCheck(
    checks,
    'OFFLINE_MIGRATION_RECORDS_PRESERVATION_PASSED',
    migrationRows.length === TARGET_VERSION
      && migrationRows.every(
        (row, index) => Number(row?.version) === index + 1 && row?.status === 'applied',
      )
      && manifest.businessRowPreservation?.passed === true
      && Array.isArray(manifest.businessRowPreservation?.failures)
      && manifest.businessRowPreservation.failures.length === 0
      && Array.isArray(manifest.preservationFailures)
      && manifest.preservationFailures.length === 0,
    `offline manifest must bind ${TARGET_VERSION} applied migrations and a passed business-row preservation proof`,
  );
}

function validateMigrationVerification(
  verification,
  verificationArtifact,
  migrationManifestArtifact,
  checks,
) {
  const verificationChecks = Array.isArray(verification.checks)
    ? verification.checks
    : [];
  const verificationCodes = verificationChecks.map((check) => check?.code);
  const requiredCodes = new Set(REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES);
  const uniqueCodes = new Set(verificationCodes);
  addRequiredCheck(
    checks,
    'MIGRATION_VERIFICATION_SCHEMA_PASSED',
    verification.kind === MIGRATION_VERIFICATION_KIND
      && verification.schemaVersion === MIGRATION_VERIFICATION_SCHEMA_VERSION
      && verification.passed === true
      && verificationChecks.length === REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES.length
      && uniqueCodes.size === verificationChecks.length
      && verificationChecks.every(
        (check) => check?.passed === true && requiredCodes.has(check?.code),
      )
      && REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES.every(
        (code) => uniqueCodes.has(code),
      )
      && verification.summary?.total === verificationChecks.length
      && verification.summary?.passed === verificationChecks.length
      && verification.summary?.failed === 0,
    'migration verification must contain the exact complete, unique, all-passed verifier check set and matching summary',
  );
  addRequiredCheck(
    checks,
    'MIGRATION_VERIFICATION_MANIFEST_BOUND',
    samePath(verification.sourceManifestPath, migrationManifestArtifact.realPath)
      && normalizeSha256(
        verification.sourceManifestSha256,
        'Migration verification source manifest SHA-256',
      ) === migrationManifestArtifact.sha256,
    'migration verification sourceManifestPath/SHA-256 must bind the supplied offline manifest',
  );
  addRequiredCheck(
    checks,
    'MIGRATION_VERIFICATION_INPUT_HASHED',
    /^[A-F0-9]{64}$/.test(verificationArtifact.sha256),
    'migration verification input must have a valid SHA-256',
  );
}

function verifyOfflineMigrationArtifacts(manifest, context, checks) {
  const sourcePath = assertCleanAbsolutePath(
    manifest.source?.path,
    'Offline source database path',
  );
  const workingPath = assertCleanAbsolutePath(
    manifest.workingDatabase?.path,
    'Offline working database path',
  );
  const restorePath = assertCleanAbsolutePath(
    manifest.restore?.destinationPath,
    'Offline restored database path',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_ARTIFACT_PATHS_DISTINCT',
    !samePath(sourcePath, workingPath)
      && !samePath(sourcePath, restorePath)
      && !samePath(workingPath, restorePath),
    'offline source, working, and restored database paths must be distinct',
  );

  assertOfflineSidecarsAbsent(workingPath, 'Offline working database');
  assertOfflineSidecarsAbsent(restorePath, 'Offline restored database');
  const workingArtifact = fileArtifact(
    workingPath,
    'Offline working database',
  );
  const restoreArtifact = fileArtifact(
    restorePath,
    'Offline restored database',
  );
  if (typeof context.afterOfflineWorkingArtifactHash === 'function') {
    context.afterOfflineWorkingArtifactHash({
      artifact: workingArtifact,
      path: workingPath,
    });
  }
  if (typeof context.afterOfflineRestoreArtifactHash === 'function') {
    context.afterOfflineRestoreArtifactHash({
      artifact: restoreArtifact,
      path: restorePath,
    });
  }
  assertOfflineSidecarsAbsent(workingPath, 'Offline working database');
  assertOfflineSidecarsAbsent(restorePath, 'Offline restored database');
  const workingArtifactForOpen = fileArtifact(
    workingPath,
    'Offline working database before read-only open',
  );
  const restoreArtifactForOpen = fileArtifact(
    restorePath,
    'Offline restored database before read-only open',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_WORKING_ARTIFACT_IDENTITY_BOUND',
    sameFileArtifact(workingArtifact, workingArtifactForOpen),
    'working database identity, SHA-256, size, and mtime must remain stable before SQLite open',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_RESTORE_ARTIFACT_IDENTITY_BOUND',
    sameFileArtifact(restoreArtifact, restoreArtifactForOpen),
    'restored database identity, SHA-256, size, and mtime must remain stable before SQLite open',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_WORKING_ARTIFACT_HASH_BOUND',
    workingArtifact.sha256 === normalizeSha256(
      manifest.workingDatabase?.upgradedSha256,
      'Offline working upgraded SHA-256',
    ),
    'current working database SHA-256 must match the offline manifest',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_RESTORE_ARTIFACT_HASH_BOUND',
    restoreArtifact.sha256 === normalizeSha256(
      manifest.restore?.sha256,
      'Offline restored SHA-256',
    ),
    'current restored database SHA-256 must match the offline manifest',
  );

  const working = new context.Database(
    workingArtifactForOpen.realPath,
    { readonly: true, fileMustExist: true },
  );
  let workingSummary;
  try {
    const workingArtifactAfterOpen = fileArtifact(
      workingPath,
      'Offline working database after read-only open',
    );
    addRequiredCheck(
      checks,
      'OFFLINE_WORKING_OPEN_IDENTITY_BOUND',
      sameFileArtifact(workingArtifactForOpen, workingArtifactAfterOpen),
      'working database path identity and main-file hash must match the file opened read-only',
    );
    working.pragma('query_only = ON');
    const queryOnly = Number(working.pragma('query_only', { simple: true })) === 1;
    const integrityCheck = working.pragma('integrity_check', { simple: true });
    const foreignKeyViolationCount = working.pragma('foreign_key_check').length;
    addRequiredCheck(
      checks,
      'OFFLINE_WORKING_QUERY_ONLY_INTEGRITY',
      queryOnly && integrityCheck === 'ok' && foreignKeyViolationCount === 0,
      `queryOnly=${queryOnly}; integrity=${integrityCheck}; foreignKeyViolationCount=${foreignKeyViolationCount}`,
    );

    const rawMigrationRows = working.prepare(`
      SELECT version, name, checksum, status
      FROM schema_migrations
      ORDER BY version
    `).all();
    const actualMigrations = normalizeMigrationRows(rawMigrationRows);
    const manifestMigrations = normalizeMigrationRows(
      Array.isArray(manifest.migrations) ? manifest.migrations : [],
    );
    addRequiredCheck(
      checks,
      'OFFLINE_WORKING_MIGRATIONS_CURRENT',
      migrationRowsMatchProductionContract(
        actualMigrations,
        context.migrationContract,
        context.allowedV1Checksums,
      )
        && stableJson(actualMigrations) === stableJson(manifestMigrations),
      `migrationRecordCount=${actualMigrations.length}`,
    );

    const workingRowCounts = collectRowCounts(working);
    const preservation = evaluateBusinessRowPreservation(
      working,
      manifest.source.tableRowCounts,
      workingRowCounts,
      manifest.source.listingMergeBaseline,
    );
    addRequiredCheck(
      checks,
      'OFFLINE_WORKING_ROW_PRESERVATION_BOUND',
      sameNumericRecord(
        workingRowCounts,
        manifest.workingDatabase?.tableRowCounts,
      )
        && preservation.passed === true
        && preservation.failures.length === 0
        && stableJson(preservation) === stableJson(manifest.businessRowPreservation),
      `preservationFailureCount=${preservation.failures.length}`,
    );

    const recovery = new context.runtime.StoreRepository(working)
      .getMigrationRecoveryPreflight(TARGET_VERSION);
    addRequiredCheck(
      checks,
      'OFFLINE_WORKING_V9_RECOVERY_PREFLIGHT',
      recovery.canRestore === true
        && recovery.sourceVersion === manifest.source.version
        && recovery.targetVersion === TARGET_VERSION
        && recovery.backupIntegrityCheck === 'ok'
        && recovery.schemaFingerprintMatches === true
        && recovery.tableRowCountsMatch === true
        && Array.isArray(recovery.blockers)
        && recovery.blockers.length === 0,
      `canRestore=${recovery.canRestore}; blockerCount=${recovery.blockers?.length ?? -1}`,
    );
    workingSummary = {
      path: workingArtifact.realPath,
      sha256: workingArtifact.sha256,
      sizeBytes: workingArtifact.sizeBytes,
      openedReadOnly: true,
      queryOnly,
      integrityCheck,
      foreignKeyViolationCount,
      migrationCount: actualMigrations.length,
      businessRowPreservationPassed: preservation.passed === true,
      recoveryCanRestore: recovery.canRestore === true,
    };
  } finally {
    working.close();
  }
  assertOfflineSidecarsAbsent(workingPath, 'Offline working database');
  const workingArtifactAfter = fileArtifact(
    workingPath,
    'Offline working database after read-only verification',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_WORKING_ARTIFACT_STABLE_AFTER_READ',
    sameFileArtifact(workingArtifact, workingArtifactAfter),
    'working database identity, SHA-256, size, and mtime must remain unchanged after read-only verification',
  );
  workingSummary = {
    ...workingSummary,
    path: workingArtifactAfter.realPath,
    identity: workingArtifactAfter.identity,
    sha256: workingArtifactAfter.sha256,
    sizeBytes: workingArtifactAfter.sizeBytes,
    mtimeMs: workingArtifactAfter.mtimeMs,
    sidecarsAbsentBeforeAndAfter: true,
  };

  const restored = new context.Database(
    restoreArtifactForOpen.realPath,
    { readonly: true, fileMustExist: true },
  );
  let restoreSummary;
  try {
    const restoreArtifactAfterOpen = fileArtifact(
      restorePath,
      'Offline restored database after read-only open',
    );
    addRequiredCheck(
      checks,
      'OFFLINE_RESTORE_OPEN_IDENTITY_BOUND',
      sameFileArtifact(restoreArtifactForOpen, restoreArtifactAfterOpen),
      'restored database path identity and main-file hash must match the file opened read-only',
    );
    restored.pragma('query_only = ON');
    const queryOnly = Number(restored.pragma('query_only', { simple: true })) === 1;
    const integrityCheck = restored.pragma('integrity_check', { simple: true });
    addRequiredCheck(
      checks,
      'OFFLINE_RESTORE_QUERY_ONLY_INTEGRITY',
      queryOnly && integrityCheck === 'ok',
      `queryOnly=${queryOnly}; integrity=${integrityCheck}`,
    );
    const restoredVersion = readAppliedVersion(restored);
    const restoredRowCounts = collectRowCounts(restored);
    addRequiredCheck(
      checks,
      'OFFLINE_RESTORE_SOURCE_BASELINE_BOUND',
      restoredVersion === manifest.source.version
        && sameNumericRecord(
          restoredRowCounts,
          manifest.source.tableRowCounts,
        )
        && sameNumericRecord(
          restoredRowCounts,
          manifest.restore?.tableRowCounts,
        ),
      `sourceVersion=${manifest.source.version}; restoredVersion=${restoredVersion}`,
    );
    restoreSummary = {
      path: restoreArtifact.realPath,
      sha256: restoreArtifact.sha256,
      sizeBytes: restoreArtifact.sizeBytes,
      openedReadOnly: true,
      queryOnly,
      integrityCheck,
      version: restoredVersion,
      sourceBaselineRowsMatch: true,
    };
  } finally {
    restored.close();
  }
  assertOfflineSidecarsAbsent(restorePath, 'Offline restored database');
  const restoreArtifactAfter = fileArtifact(
    restorePath,
    'Offline restored database after read-only verification',
  );
  addRequiredCheck(
    checks,
    'OFFLINE_RESTORE_ARTIFACT_STABLE_AFTER_READ',
    sameFileArtifact(restoreArtifact, restoreArtifactAfter),
    'restored database identity, SHA-256, size, and mtime must remain unchanged after read-only verification',
  );
  restoreSummary = {
    ...restoreSummary,
    path: restoreArtifactAfter.realPath,
    identity: restoreArtifactAfter.identity,
    sha256: restoreArtifactAfter.sha256,
    sizeBytes: restoreArtifactAfter.sizeBytes,
    mtimeMs: restoreArtifactAfter.mtimeMs,
    sidecarsAbsentBeforeAndAfter: true,
  };

  return {
    pathsDistinct: true,
    working: workingSummary,
    restore: restoreSummary,
  };
}

function sameNumericRecord(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key, index) => key === rightKeys[index]
        && Number(left[key]) === Number(right[key]),
    );
}

function isNumericRowCountRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length > 0
    && Object.values(value).every(
      (count) => Number.isSafeInteger(Number(count)) && Number(count) >= 0,
    );
}

function isSha256(value) {
  return typeof value === 'string' && /^[A-F0-9]{64}$/i.test(value.trim());
}

function isCleanAbsolutePath(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && !value.includes('\0')
    && path.isAbsolute(value);
}

function isListingMergeBaseline(value) {
  return Boolean(value)
    && typeof value === 'object'
    && Number.isSafeInteger(Number(value.migration4MergedDuplicateRows))
    && Number(value.migration4MergedDuplicateRows) >= 0
    && Number.isSafeInteger(Number(value.resolvedMergeRecords))
    && Number(value.resolvedMergeRecords) >= 0;
}

function createCaptureRoot(context) {
  const parentPath = path.resolve(context.tempRoot ?? os.tmpdir());
  const parent = assertDirectExistingPath(
    parentPath,
    'S7 live acceptance temporary parent',
    'directory',
  );
  const captureRoot = fs.mkdtempSync(path.join(parent.realPath, 'amazon-ai-ops-s7-live-acceptance-'));
  const direct = assertDirectExistingPath(
    captureRoot,
    'S7 live acceptance capture root',
    'directory',
  );
  if (!samePath(path.dirname(direct.realPath), parent.realPath)) {
    fail('S7 live acceptance capture root escaped its controlled temporary parent.');
  }
  return {
    captureRoot: direct.realPath,
    parentPath: parent.realPath,
    rootIdentity: statIdentity(direct.stat, direct.realPath),
    artifactIdentities: new Map(),
  };
}

function recordCaptureArtifact(captureState, artifactPath) {
  if (!entryExists(artifactPath)) return;
  if (!samePath(path.dirname(path.resolve(artifactPath)), captureState.captureRoot)
    || !CAPTURE_FILE_NAMES.includes(path.basename(artifactPath))) {
    fail(`Refusing to record an unowned live acceptance artifact: ${artifactPath}`);
  }
  const direct = assertDirectExistingPath(
    artifactPath,
    'Live acceptance capture artifact',
    'file',
  );
  if (direct.stat.nlink !== 1) {
    fail('Live acceptance capture artifacts must have exactly one hard link.');
  }
  const identity = statIdentity(direct.stat, direct.realPath);
  const existing = captureState.artifactIdentities.get(path.basename(artifactPath));
  if (existing && !sameCreatedIdentity(existing, identity)) {
    fail(`Live acceptance capture artifact identity changed: ${artifactPath}`);
  }
  captureState.artifactIdentities.set(path.basename(artifactPath), identity);
}

function recordExistingCaptureArtifacts(captureState) {
  const entries = fs.readdirSync(captureState.captureRoot);
  for (const entry of entries) {
    if (!CAPTURE_FILE_NAMES.includes(entry)) {
      fail(`Unexpected live acceptance capture artifact: ${entry}`);
    }
    recordCaptureArtifact(captureState, path.join(captureState.captureRoot, entry));
  }
}

function removeCaptureRoot(captureState) {
  const { captureRoot, parentPath, rootIdentity, artifactIdentities } = captureState;
  if (!entryExists(captureRoot)) {
    fail('S7 live acceptance capture root disappeared before controlled cleanup.');
  }
  const direct = assertDirectExistingPath(
    captureRoot,
    'S7 live acceptance capture root',
    'directory',
  );
  if (!samePath(path.dirname(direct.realPath), parentPath)) {
    fail('Refusing to clean a live acceptance capture root outside its controlled parent.');
  }
  if (!sameCreatedIdentity(rootIdentity, statIdentity(direct.stat, direct.realPath))) {
    fail('S7 live acceptance capture root identity changed before cleanup.');
  }
  const entries = fs.readdirSync(direct.realPath);
  for (const entry of entries) {
    if (!CAPTURE_FILE_NAMES.includes(entry)) {
      fail(`Unexpected live acceptance capture artifact: ${entry}`);
    }
    const candidate = path.join(direct.realPath, entry);
    const artifact = assertDirectExistingPath(candidate, 'Live acceptance capture artifact', 'file');
    const recordedIdentity = artifactIdentities.get(entry);
    if (!recordedIdentity
      || !sameCreatedIdentity(
        recordedIdentity,
        statIdentity(artifact.stat, artifact.realPath),
      )) {
      fail(`Live acceptance capture artifact identity changed before cleanup: ${entry}`);
    }
    fs.unlinkSync(artifact.realPath);
  }
  const finalRoot = assertDirectExistingPath(
    captureRoot,
    'S7 live acceptance capture root',
    'directory',
  );
  if (!sameCreatedIdentity(rootIdentity, statIdentity(finalRoot.stat, finalRoot.realPath))) {
    fail('S7 live acceptance capture root identity changed during cleanup.');
  }
  fs.rmdirSync(direct.realPath);
}

function tableNames(database) {
  return new Set(database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all().map((row) => String(row.name)));
}

function normalizeMigrationRows(rows) {
  return rows.map((row) => ({
    version: Number(row.version),
    name: String(row.name ?? ''),
    checksum: String(row.checksum ?? ''),
    status: String(row.status ?? '').toLowerCase(),
  }));
}

function validateUpgradeBackup(
  database,
  databaseArtifact,
  offlineManifest,
  targetMigrationRow,
  context,
  checks,
) {
  let migrationManifest;
  try {
    migrationManifest = JSON.parse(String(targetMigrationRow.manifestJson ?? ''));
  } catch {
    fail(`LIVE_V9_UPGRADE_BACKUP_EMBEDDED: migration ${TARGET_VERSION} manifest_json is malformed.`);
  }
  const upgradeBackup = migrationManifest?.upgradeBackup;
  const targetContract = context.migrationContract.find(
    (migration) => migration.version === TARGET_VERSION,
  );
  const fixedBackupPath = `${databaseArtifact.realPath}.pre-upgrade-to-v${TARGET_VERSION}.bak`;
  const fixedManifestPath =
    `${databaseArtifact.realPath}.pre-upgrade-to-v${TARGET_VERSION}.manifest.json`;
  addRequiredCheck(
    checks,
    'LIVE_V9_UPGRADE_BACKUP_EMBEDDED',
    upgradeBackup?.kind === 'schema-upgrade-backup'
      && upgradeBackup?.schemaVersion === 1
      && ['created', 'reused'].includes(upgradeBackup?.status)
      && upgradeBackup?.targetVersion === TARGET_VERSION
      && upgradeBackup?.targetName === targetContract?.name
      && upgradeBackup?.targetChecksum === targetContract?.checksum,
    `migration ${TARGET_VERSION} must embed the current recoverable schema-upgrade-backup contract`,
  );
  addRequiredCheck(
    checks,
    'LIVE_V9_UPGRADE_BACKUP_PATHS_BOUND',
    samePath(upgradeBackup.databasePath, databaseArtifact.realPath)
      && samePath(upgradeBackup.backupPath, fixedBackupPath)
      && samePath(upgradeBackup.manifestPath, fixedManifestPath),
    'upgrade database, backup, and manifest paths must be canonical fixed adjacent live-db paths',
  );
  addRequiredCheck(
    checks,
    'LIVE_V9_UPGRADE_BACKUP_SOURCE_BOUND',
    upgradeBackup.sourceVersion === offlineManifest.source.version,
    'upgrade backup sourceVersion must equal the offline source version',
  );
  const backupArtifact = fileArtifact(
    fixedBackupPath,
    `Migration ${TARGET_VERSION} upgrade backup`,
  );
  const sidecarManifest = readJsonArtifact(
    fixedManifestPath,
    `Migration ${TARGET_VERSION} upgrade backup manifest`,
  );
  addRequiredCheck(
    checks,
    'LIVE_V9_UPGRADE_BACKUP_MANIFEST_MATCH',
    sameUpgradeBackupContract(upgradeBackup, sidecarManifest.value),
    `embedded migration ${TARGET_VERSION} upgradeBackup must match its adjacent manifest contract`,
  );

  const repository = new context.runtime.StoreRepository(database);
  const preflight = repository.getMigrationRecoveryPreflight(TARGET_VERSION);
  const expectedBackupSha256 = normalizeSha256(
    upgradeBackup.sha256,
    'Embedded upgrade backup SHA-256',
  );
  addRequiredCheck(
    checks,
    'LIVE_V9_RECOVERY_PREFLIGHT_CAN_RESTORE',
    preflight.canRestore === true
      && Array.isArray(preflight.blockers)
      && preflight.blockers.length === 0
      && preflight.version === TARGET_VERSION
      && preflight.targetVersion === TARGET_VERSION
      && preflight.sourceVersion === offlineManifest.source.version,
    `StoreRepository recovery preflight must allow restore for the bound v${TARGET_VERSION} backup`,
  );
  addRequiredCheck(
    checks,
    'LIVE_V9_RECOVERY_BACKUP_SHA_INTEGRITY',
    preflight.backupIntegrityCheck === 'ok'
      && normalizeSha256(
        preflight.backupSha256,
        'Recovery preflight backup SHA-256',
      ) === expectedBackupSha256
      && backupArtifact.sha256 === expectedBackupSha256
      && Number(upgradeBackup.sizeBytes) === backupArtifact.sizeBytes,
    'backup SHA-256, size, and integrity must match the embedded manifest',
  );
  addRequiredCheck(
    checks,
    'LIVE_V9_RECOVERY_SCHEMA_ROWS',
    preflight.schemaFingerprintMatches === true
      && preflight.tableRowCountsMatch === true,
    'backup schema fingerprint and table row counts must match the embedded manifest',
  );

  return {
    sourceVersion: preflight.sourceVersion,
    targetVersion: preflight.targetVersion,
    backupPath: backupArtifact.realPath,
    backupSha256: backupArtifact.sha256,
    backupSizeBytes: backupArtifact.sizeBytes,
    manifestPath: sidecarManifest.artifact.realPath,
    manifestSha256: sidecarManifest.artifact.sha256,
    backupIntegrityCheck: preflight.backupIntegrityCheck,
    schemaFingerprintMatches: preflight.schemaFingerprintMatches === true,
    tableRowCountsMatch: preflight.tableRowCountsMatch === true,
    embeddedManifestMatchesAdjacentFile: true,
    canRestore: preflight.canRestore === true,
    blockerCount: preflight.blockers.length,
  };
}

function sameUpgradeBackupContract(embedded, adjacent) {
  if (!embedded || !adjacent || typeof embedded !== 'object' || typeof adjacent !== 'object') {
    return false;
  }
  if (!['created', 'reused'].includes(embedded.status)
    || adjacent.status !== 'created') {
    return false;
  }
  const normalize = (value) => {
    const copy = { ...value };
    delete copy.status;
    return stableJson(copy);
  };
  return normalize(embedded) === normalize(adjacent);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function inspectLogicalSnapshot(
  snapshotPath,
  databaseArtifact,
  offlineManifest,
  context,
  checks,
) {
  const Database = context.Database;
  const database = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only = ON');
    addRequiredCheck(
      checks,
      'LIVE_LOGICAL_SNAPSHOT_QUERY_ONLY',
      Number(database.pragma('query_only', { simple: true })) === 1,
      'logical snapshot must be opened readonly with PRAGMA query_only=ON',
    );
    const integrityCheck = database.pragma('integrity_check', { simple: true });
    const foreignKeyViolationCount = database.pragma('foreign_key_check').length;
    addRequiredCheck(
      checks,
      'LIVE_LOGICAL_SNAPSHOT_INTEGRITY',
      integrityCheck === 'ok' && foreignKeyViolationCount === 0,
      `integrity=${integrityCheck}; foreignKeyViolationCount=${foreignKeyViolationCount}`,
    );

    const tables = tableNames(database);
    const missingTables = context.requiredTables.filter((table) => !tables.has(table));
    addRequiredCheck(
      checks,
      'LIVE_REQUIRED_TABLES_PRESENT',
      missingTables.length === 0,
      `missingTableCount=${missingTables.length}`,
    );

    const rawMigrationRows = database.prepare(`
      SELECT version, name, checksum, status, manifest_json AS manifestJson
      FROM schema_migrations
      ORDER BY version
    `).all();
    const normalizedRows = normalizeMigrationRows(rawMigrationRows);
    addRequiredCheck(
      checks,
      'LIVE_MIGRATIONS_1_TO_9_CURRENT',
      migrationRowsMatchProductionContract(
        normalizedRows,
        context.migrationContract,
        context.allowedV1Checksums,
      ),
      `migrationRecordCount=${normalizedRows.length}`,
    );
    const v11Schema = inspectStoreProviderIdentityV11Schema(database);
    addRequiredCheck(
      checks,
      'LIVE_V11_STORE_PROVIDER_IDENTITY_SCHEMA_CURRENT',
      v11Schema.passed === true,
      v11Schema.passed
        ? '3 columns, one unique partial index, and all 6 authority triggers match v11'
        : v11Schema.violations.join('; '),
    );

    const liveRowCounts = collectRowCounts(database);
    const preservation = evaluateBusinessRowPreservation(
      database,
      offlineManifest.source.tableRowCounts,
      liveRowCounts,
      offlineManifest.source.listingMergeBaseline,
    );
    addRequiredCheck(
      checks,
      'LIVE_BUSINESS_ROWS_PRESERVED',
      preservation.passed === true && preservation.failures.length === 0,
      `failureCount=${preservation.failures.length}`,
    );

    const targetMigrationRow = rawMigrationRows.find(
      (row) => Number(row.version) === TARGET_VERSION,
    );
    const recovery = validateUpgradeBackup(
      database,
      databaseArtifact,
      offlineManifest,
      targetMigrationRow,
      context,
      checks,
    );
    return {
      integrityCheck,
      foreignKeyViolationCount,
      migrationCount: normalizedRows.length,
      requiredTableCount: context.requiredTables.length,
      businessRowPreservation: {
        passed: preservation.passed === true,
        failureCount: preservation.failures.length,
        listingCurrentToHistoryTransferApplied:
          preservation.listingCurrentToHistoryTransfer.applied === true,
        listingCurrentToHistoryTransferPassed:
          preservation.listingCurrentToHistoryTransfer.passed === true,
      },
      recovery,
    };
  } finally {
    database.close();
  }
}

function defaultContext(injectedContext = {}) {
  const currentMigrationContract = migrationContract();
  return {
    allowedV1Checksums: migrationV1ChecksumWhitelist(currentMigrationContract),
    cleanupCaptureRoot: removeCaptureRoot,
    Database: requireSqlite(),
    migrationContract: currentMigrationContract,
    now: () => new Date(),
    requiredTables: REQUIRED_TABLES,
    runReadonlyBackup: runReadonlySqliteOnlineBackupSync,
    runtime: loadLocalDbRuntime(),
    tempRoot: undefined,
    writeStdout: process.stdout.write.bind(process.stdout),
    ...injectedContext,
  };
}

function validateContext(context) {
  for (const [label, value] of [
    ['Database', context.Database],
    ['cleanupCaptureRoot', context.cleanupCaptureRoot],
    ['now', context.now],
    ['runReadonlyBackup', context.runReadonlyBackup],
    ['writeStdout', context.writeStdout],
  ]) {
    if (typeof value !== 'function') fail(`Acceptance ${label} dependency is invalid.`);
  }
  if (!Array.isArray(context.migrationContract)
    || context.migrationContract.length !== TARGET_VERSION) {
    fail('Acceptance migrationContract dependency is invalid.');
  }
  if (!(context.allowedV1Checksums instanceof Set)
    || context.allowedV1Checksums.size !== 2
    || !context.allowedV1Checksums.has(context.migrationContract[0].checksum)) {
    fail('Acceptance legacy/current v1 checksum dependency is invalid.');
  }
  if (!Array.isArray(context.requiredTables) || context.requiredTables.length === 0) {
    fail('Acceptance requiredTables dependency is invalid.');
  }
  if (typeof context.runtime?.StoreRepository !== 'function') {
    fail('Acceptance StoreRepository runtime dependency is invalid.');
  }
  for (const hookName of [
    'afterOfflineWorkingArtifactHash',
    'afterOfflineRestoreArtifactHash',
  ]) {
    if (context[hookName] !== undefined && typeof context[hookName] !== 'function') {
      fail(`Acceptance ${hookName} dependency is invalid.`);
    }
  }
}

function verifyS7LiveMigrationAcceptance(options, injectedContext = {}) {
  const context = defaultContext(injectedContext);
  validateContext(context);
  const outputPath = assertOutputAvailable(options.out);
  const databaseArtifactBefore = fileArtifact(options.db, 'Live authority database');
  const authoritySelection = readJsonArtifact(
    options.authoritySelection,
    'Authority selection evidence',
  );
  const migrationManifest = readJsonArtifact(
    options.migrationManifest,
    'Offline migration manifest',
  );
  const migrationVerification = readJsonArtifact(
    options.migrationVerification,
    'Migration verification evidence',
  );
  const checks = [];

  validateOfflineMigrationManifest(
    migrationManifest.value,
    databaseArtifactBefore,
    checks,
  );
  validateAuthoritySelection(
    authoritySelection.value,
    databaseArtifactBefore,
    migrationManifest.value,
    checks,
  );
  validateMigrationVerification(
    migrationVerification.value,
    migrationVerification.artifact,
    migrationManifest.artifact,
    checks,
  );
  const offlineArtifactInspection = verifyOfflineMigrationArtifacts(
    migrationManifest.value,
    context,
    checks,
  );

  const captureState = createCaptureRoot(context);
  const snapshotPath = path.join(captureState.captureRoot, CAPTURE_FILE_NAMES[0]);
  const finalSnapshotPath = path.join(
    captureState.captureRoot,
    'live-authority-logical-snapshot-final.db',
  );
  let backupProof;
  let inspection;
  let logicalSnapshotArtifact;
  let receipt;
  let operationError;
  try {
    backupProof = context.runReadonlyBackup({
      sourceDatabasePath: databaseArtifactBefore.realPath,
      destinationPath: snapshotPath,
      ownedTempRoot: captureState.captureRoot,
    });
    recordCaptureArtifact(captureState, snapshotPath);
    addRequiredCheck(
      checks,
      'LIVE_WAL_AWARE_READONLY_BACKUP',
      backupProof?.schemaVersion === SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
        && backupProof?.method === CURRENTNESS_METHOD
        && backupProof?.source?.openedReadOnly === true
        && backupProof?.source?.queryOnly === true
        && backupProof?.observedBackup?.remainingPages === 0
        && Number.isInteger(backupProof?.observedBackup?.totalPages)
        && backupProof.observedBackup.totalPages > 0,
      'live authority must be captured by completed WAL-aware readonly online backup',
    );
    logicalSnapshotArtifact = fileArtifact(
      snapshotPath,
      'Live authority logical snapshot',
    );
    addRequiredCheck(
      checks,
      'LIVE_LOGICAL_SNAPSHOT_HASH_BOUND',
      logicalSnapshotArtifact.sha256
        === normalizeSha256(
          backupProof.observedBackup.sha256,
          'WAL-aware backup SHA-256',
        )
        && logicalSnapshotArtifact.sizeBytes === backupProof.observedBackup.sizeBytes,
      'logical snapshot SHA-256 and size must match the online-backup proof',
    );
    inspection = inspectLogicalSnapshot(
      logicalSnapshotArtifact.realPath,
      databaseArtifactBefore,
      migrationManifest.value,
      context,
      checks,
    );
    recordExistingCaptureArtifacts(captureState);

    const finalBackupProof = context.runReadonlyBackup({
      sourceDatabasePath: databaseArtifactBefore.realPath,
      destinationPath: finalSnapshotPath,
      ownedTempRoot: captureState.captureRoot,
    });
    recordCaptureArtifact(captureState, finalSnapshotPath);
    addRequiredCheck(
      checks,
      'LIVE_FINAL_WAL_AWARE_READONLY_BACKUP',
      finalBackupProof?.schemaVersion === SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
        && finalBackupProof?.method === CURRENTNESS_METHOD
        && finalBackupProof?.source?.openedReadOnly === true
        && finalBackupProof?.source?.queryOnly === true
        && finalBackupProof?.observedBackup?.remainingPages === 0
        && Number.isInteger(finalBackupProof?.observedBackup?.totalPages)
        && finalBackupProof.observedBackup.totalPages > 0,
      'final live authority capture must be a completed WAL-aware readonly online backup',
    );
    const finalLogicalSnapshotArtifact = fileArtifact(
      finalSnapshotPath,
      'Final live authority logical snapshot',
    );
    addRequiredCheck(
      checks,
      'LIVE_LOGICAL_SNAPSHOT_STABLE',
      finalLogicalSnapshotArtifact.sha256 === logicalSnapshotArtifact.sha256
        && finalLogicalSnapshotArtifact.sizeBytes === logicalSnapshotArtifact.sizeBytes
        && finalLogicalSnapshotArtifact.sha256 === normalizeSha256(
          finalBackupProof.observedBackup.sha256,
          'Final WAL-aware backup SHA-256',
        )
        && finalLogicalSnapshotArtifact.sizeBytes
          === finalBackupProof.observedBackup.sizeBytes,
      'initial and final WAL-aware logical snapshots must have identical SHA-256 and size',
    );
    recordExistingCaptureArtifacts(captureState);

    const databaseArtifactAfter = fileArtifact(options.db, 'Live authority database');
    addRequiredCheck(
      checks,
      'LIVE_MAIN_FILE_UNCHANGED',
      sameMainArtifact(databaseArtifactBefore, databaseArtifactAfter),
      'live authority main file SHA-256, size, and mtime must remain unchanged',
    );
    const generatedAt = context.now();
    if (!(generatedAt instanceof Date) || !Number.isFinite(generatedAt.valueOf())) {
      fail('Acceptance clock returned an invalid date.');
    }
    const passedCount = checks.filter((check) => check.passed).length;
    receipt = {
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: generatedAt.toISOString(),
      status: 'PASSED',
      passed: passedCount === checks.length,
      formalEvidence: true,
      authorityDatabaseMutated: false,
      adsExecutionInvoked: false,
      inputs: {
        database: {
          path: databaseArtifactBefore.path,
          realPath: databaseArtifactBefore.realPath,
          sha256: databaseArtifactBefore.sha256,
          sizeBytes: databaseArtifactBefore.sizeBytes,
          logicalSnapshotSha256: logicalSnapshotArtifact.sha256,
          logicalSnapshotSizeBytes: logicalSnapshotArtifact.sizeBytes,
        },
        authoritySelection: publicInputArtifact(authoritySelection.artifact),
        migrationManifest: publicInputArtifact(migrationManifest.artifact),
        migrationVerification: publicInputArtifact(migrationVerification.artifact),
      },
      checks,
      summary: {
        total: checks.length,
        passed: passedCount,
        failed: checks.length - passedCount,
        integrityCheck: inspection.integrityCheck,
        foreignKeyViolationCount: inspection.foreignKeyViolationCount,
        migrationCount: inspection.migrationCount,
        requiredTableCount: inspection.requiredTableCount,
        offlineArtifacts: offlineArtifactInspection,
        businessRowPreservation: inspection.businessRowPreservation,
        recovery: inspection.recovery,
      },
      safety: {
        liveDatabaseAccess: CURRENTNESS_METHOD,
        liveDatabaseOpenedReadOnly: true,
        liveDatabaseQueryOnly: true,
        logicalSnapshotInspectedReadOnly: true,
        walAwareSnapshotProofCount: 2,
        authorityDatabaseMutated: false,
        adsExecutionInvoked: false,
        businessRowContentIncluded: false,
        rawSecretsIncluded: false,
      },
    };
    if (!receipt.passed) fail('Acceptance receipt cannot be published with failed checks.');
    validateS7LiveMigrationAcceptanceReceipt(receipt);
  } catch (error) {
    operationError = error;
  }
  let cleanupError;
  try {
    recordExistingCaptureArtifacts(captureState);
    context.cleanupCaptureRoot(captureState);
  } catch (error) {
    cleanupError = error;
  }
  if (cleanupError) {
    if (operationError && cleanupError instanceof Error) cleanupError.cause = operationError;
    throw cleanupError;
  }
  if (operationError) throw operationError;
  writeJsonAtomicExclusive(outputPath, receipt);
  return { receipt, outputPath };
}

function publicInputArtifact(artifact) {
  return {
    path: artifact.path,
    realPath: artifact.realPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
  };
}

function writeJsonAtomicExclusive(outputPath, value) {
  assertOutputAvailable(outputPath);
  const parent = path.dirname(outputPath);
  const temporaryPath = path.join(
    parent,
    `.tmp-${path.basename(outputPath)}-${crypto.randomUUID()}`,
  );
  let handle = null;
  let published = false;
  let publicationError;
  try {
    handle = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.linkSync(temporaryPath, outputPath);
    published = true;
  } catch (error) {
    publicationError = error;
  } finally {
    if (handle !== null) fs.closeSync(handle);
    if (entryExists(temporaryPath)) {
      const temporary = assertDirectExistingPath(
        temporaryPath,
        'Acceptance temporary output',
        'file',
      );
      try {
        fs.unlinkSync(temporary.realPath);
      } catch (error) {
        if (!published && !publicationError) publicationError = error;
      }
    }
  }
  if (published) return outputPath;
  if (entryExists(outputPath)) {
    fail(`Acceptance output collision prevented publication: ${outputPath}`);
  }
  throw publicationError;
}

async function run(argv = process.argv.slice(2), injectedContext = {}) {
  const parsed = parseLiveMigrationAcceptanceArgs(argv);
  const writeStdout = injectedContext.writeStdout ?? process.stdout.write.bind(process.stdout);
  if (typeof writeStdout !== 'function') fail('Acceptance writeStdout dependency is invalid.');
  if (parsed.help) {
    writeStdout(`${LIVE_MIGRATION_ACCEPTANCE_USAGE}\n`);
    return { exitCode: 0, receipt: null, outputPath: null };
  }
  const result = verifyS7LiveMigrationAcceptance({
    db: parsed.values.db,
    authoritySelection: parsed.values['authority-selection'],
    migrationManifest: parsed.values['migration-manifest'],
    migrationVerification: parsed.values['migration-verification'],
    out: parsed.values.out,
  }, {
    ...injectedContext,
    writeStdout,
  });
  writeStdout(`${JSON.stringify(result.receipt, null, 2)}\n`);
  return { exitCode: 0, receipt: result.receipt, outputPath: result.outputPath };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      process.stderr.write(`[S7 LIVE MIGRATION ACCEPTANCE BLOCKED] ${
        error instanceof Error ? error.message : String(error)
      }\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  KIND,
  LIVE_MIGRATION_ACCEPTANCE_USAGE,
  REQUIRED_LIVE_MIGRATION_ACCEPTANCE_CHECK_CODES,
  REQUIRED_MIGRATION_VERIFICATION_CHECK_CODES,
  SCHEMA_VERSION,
  legacyV1Checksum,
  parseLiveMigrationAcceptanceArgs,
  readJsonArtifact,
  removeCaptureRoot,
  run,
  validateS7LiveMigrationAcceptanceReceipt,
  verifyS7LiveMigrationAcceptance,
  writeJsonAtomicExclusive,
};
