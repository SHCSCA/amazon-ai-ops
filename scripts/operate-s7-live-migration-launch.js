#!/usr/bin/env node

/*
 * Gates one explicitly approved launch of the already-frozen Windows package.
 * This operator performs read-only preflight checks but never edits, copies,
 * replaces, or rolls back the live authority DB, and it never substitutes for
 * post-migration acceptance.  Its pre-spawn launch intent prevents reuse while
 * the complete intent remains present. Deleting or rolling that evidence back
 * is an integrity failure that requires HOLD plus a newly approved packet; a
 * local file cannot provide absolute replay prevention against an administrator.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');
const {
  collectFixedPackageHashes,
  evaluatePackageUiEvidenceCompleteness,
} = require('./package-ui-evidence');
const {
  PACKAGED_APP_NAME,
  REQUIRED_TABLES,
  assertStoreProviderIdentityV11Schema,
  inspectProductionAuthoritySelection,
  migrationContract,
  migrationRowsMatchProductionContract,
  migrationV1ChecksumWhitelist,
  storeProviderIdentityV11SchemaContract,
} = require('./verify-production-authority-selection');
const {
  readJsonArtifact,
  validateS7LiveMigrationAcceptanceReceipt,
} = require('./verify-s7-live-migration-acceptance');
const {
  verifyS7MigrationBackupRestore,
} = require('./verify-s7-migration-backup-restore');
const {
  TARGET_VERSION,
  requireSqlite,
  readAppliedVersion,
} = require('./migrate-current-user-db');

const ROOT = path.resolve(__dirname, '..');
const CANONICAL_EXE = path.join(
  ROOT,
  'apps',
  'desktop',
  'release',
  'win-unpacked',
  'AmazonAIOpsAgent.exe',
);
const CANONICAL_APP = path.join(
  ROOT,
  'apps',
  'desktop',
  'release',
  'win-unpacked',
  'resources',
  'app',
);
const CANONICAL_MAIN = path.join(CANONICAL_APP, 'dist', 'main', 'index.js');
const KIND = 's7-live-migration-launch-operator';
const SCHEMA_VERSION = 's7-live-migration-launch-operator/v2';
const PACKET_KIND = 's7-live-migration-approval-packet';
const PACKET_SCHEMA_VERSION = 's7-live-migration-approval-packet/v2';
const REQUIRED_SOURCE_VERSION = 0;
const SIDECARS = Object.freeze(['-wal', '-shm', '-journal']);
const MAX_PACKAGE_UI_AGE_MS = 48 * 60 * 60 * 1000;
const DEFAULT_SPAWN_TIMEOUT_MS = 15_000;
const DEFAULT_EXIT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_EXCLUSIVE_WINDOW_READY_TIMEOUT_MS = 20_000;
const DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS = 60_000;
const MAX_PROTOCOL_CLOCK_SKEW_MS = 60_000;
const INTENT_DIRECTORY_NAME = '.s7-live-migration-launch-intents';
const STARTUP_GATE_DIRECTORY_NAME = '.s7-main-startup-gate';
const STARTUP_GATE_ACTIVE_FILE = 'ACTIVE.json';
const STARTUP_GATE_BOUND_FILE = 'BOUND.json';
const STARTUP_GATE_HANDOFF_READY_FILE = 'HANDOFF_READY.json';
const STARTUP_GATE_HANDOFF_RELEASED_FILE = 'HANDOFF_RELEASED.json';
const STARTUP_GATE_ADMISSION_FILE = 'ADMISSION.json';
const STARTUP_GATE_CLOSED_FILE = 'CLOSED.json';
const STARTUP_GATE_FINALIZED_FILE = 'FINALIZED.json';
const STARTUP_GATE_ACTIVE_KIND = 's7-main-startup-gate-active';
const STARTUP_GATE_ACTIVE_SCHEMA = 's7-main-startup-gate-active/v2';
const STARTUP_GATE_BOUND_KIND = 's7-main-startup-gate-bound';
const STARTUP_GATE_BOUND_SCHEMA = 's7-main-startup-gate-bound/v2';
const STARTUP_GATE_HANDOFF_READY_KIND = 's7-main-startup-handoff-ready';
const STARTUP_GATE_HANDOFF_READY_SCHEMA = 's7-main-startup-handoff-ready/v1';
const STARTUP_GATE_HANDOFF_RELEASED_KIND = 's7-main-startup-handoff-released';
const STARTUP_GATE_HANDOFF_RELEASED_SCHEMA = 's7-main-startup-handoff-released/v1';
const STARTUP_GATE_ADMISSION_KIND = 's7-main-startup-admission';
const STARTUP_GATE_ADMISSION_SCHEMA = 's7-main-startup-admission/v2';
const STARTUP_GATE_CLOSED_KIND = 's7-main-startup-gate-closed';
const STARTUP_GATE_CLOSED_SCHEMA = 's7-main-startup-gate-closed/v2';
const STARTUP_GATE_FINALIZED_KIND = 's7-main-startup-gate-finalized';
const STARTUP_GATE_FINALIZED_SCHEMA = 's7-main-startup-gate-finalized/v1';
const STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE = 'POST_MIGRATION_ADMITTED.json';
const FINALIZATION_PACKET_KIND = 's7-live-migration-finalization-packet';
const FINALIZATION_PACKET_SCHEMA = 's7-live-migration-finalization-packet/v1';
const EXCLUSIVE_WINDOW_PROTOCOL = 's7-live-migration-exclusive-window/v1';
const EXCLUSIVE_WINDOW_CREATE_COMMAND = 'S7_CREATE_SUSPENDED';
const EXCLUSIVE_WINDOW_RELEASE_COMMAND = 'S7_RELEASE_AND_RESUME';
const PACKAGE_LAUNCH_STATES = Object.freeze([
  'NOT_LAUNCHED',
  'CONFIRMED_LAUNCHED',
  'UNKNOWN_AFTER_HANDOFF',
]);
const REQUIRED_MIGRATION_VERIFICATION_CODES = Object.freeze([
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
const CHILD_ENVIRONMENT_ALLOWLIST = Object.freeze([
  'COMSPEC',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'WINDIR',
]);
const TRUSTED_INSTALLER_SID =
  'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const TRUSTED_POWERSHELL_MAX_HARDLINKS = 8;
const TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS = 8_192;
const TRUSTED_POWERSHELL_SIGNATURE_SUBJECT =
  /(?:^|,\s*)O=Microsoft Corporation(?:,|$)/i;
const WINDOWS_WRITE_RIGHTS_MASK =
  2n | 4n | 16n | 64n | 256n | 65_536n | 262_144n | 524_288n;
const USAGE = [
  'Usage:',
  '  pnpm run operate:s7-live-migration -- --prepare --db <absolute canonical live v0 db> --authority-selection <absolute json> --migration-manifest <absolute json> --migration-verification <absolute json> --package-ui-manifest <absolute passed v8 json> --recovery-root <absolute isolated existing directory> --out <absolute new approval packet json under recovery root>',
  '  pnpm run operate:s7-live-migration -- --execute-approved --approval-packet <absolute approval packet json> --confirm-live-migration <exact packet confirmation token> --recovery-root <absolute isolated existing directory> --out <absolute new launch receipt json under recovery root>',
  '  pnpm run operate:s7-live-migration -- --prepare-finalization --approval-packet <absolute approval packet json> --launch-receipt <absolute successful launch receipt json> --acceptance-receipt <absolute passed readonly acceptance json> --recovery-root <absolute isolated existing directory> --out <absolute new finalization packet json under recovery root>',
  '  pnpm run operate:s7-live-migration -- --finalize-approved --finalization-packet <absolute finalization packet json> --confirm-finalization <exact finalization token>',
  '',
  'Windows only. No mode and --help are side-effect free.',
  '--prepare is read-only apart from its exclusive approval packet output.',
  '--execute-approved writes a complete launch intent before one controlled launch attempt.',
  '--prepare-finalization is read-only apart from one protected finalization packet.',
  '--finalize-approved revalidates the complete chain and atomically publishes protected FINALIZED.json; it does not declare APP_READY or authorize Ads execution.',
  '--recovery-root must be current-user-owned, inheritance-protected, and writable only by the current user, SYSTEM, and Administrators.',
  'While that complete intent exists the packet cannot be reused. Deleting or rolling it back is evidence destruction, forces HOLD, and requires a new packet and approval; this local operator cannot absolutely detect administrator deletion.',
  'The normal package opens its window; this is not a migration-only command. The user must be present.',
].join('\n');

function fail(message) {
  throw new Error(message);
}

function nowIso(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    fail('Clock returned an invalid date.');
  }
  return value.toISOString();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function normalizeSha(value, label) {
  const result = String(value || '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(result)) fail(`${label} must be a SHA-256 value.`);
  return result;
}

function normalizedPath(value) {
  return path.resolve(String(value)).replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(left, right) {
  return typeof left === 'string'
    && typeof right === 'string'
    && normalizedPath(left) === normalizedPath(right);
}

function cleanAbsolute(value, label) {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || !value
    || value.includes('\0')
    || !path.isAbsolute(value)
  ) {
    fail(`${label} must be a clean absolute path.`);
  }
  const resolved = path.resolve(value);
  if (resolved.slice(path.parse(resolved).root.length).includes(':')) {
    fail(`${label} may not contain an alternate data stream.`);
  }
  return resolved;
}

function exists(value) {
  try {
    fs.lstatSync(value);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function directPath(value, label, type) {
  const resolved = cleanAbsolute(value, label);
  let lstat;
  try {
    lstat = fs.lstatSync(resolved);
  } catch (error) {
    if (error && error.code === 'ENOENT') fail(`${label} does not exist: ${resolved}`);
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
  if (type === 'file' && !stat.isFile()) fail(`${label} must be a regular file.`);
  if (type === 'directory' && !stat.isDirectory()) fail(`${label} must be a directory.`);
  return { resolved, realPath, stat };
}

function sameStat(left, right) {
  return Number(left.dev) === Number(right.dev)
    && Number(left.ino) === Number(right.ino)
    && Number(left.nlink) === Number(right.nlink)
    && left.birthtimeMs === right.birthtimeMs
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function identity(stat, realPath) {
  return {
    realPath,
    dev: Number(stat.dev),
    ino: Number(stat.ino),
    birthtimeMs: stat.birthtimeMs,
    nlink: Number(stat.nlink),
  };
}

function fileArtifact(value, label) {
  const before = directPath(value, label, 'file');
  if (before.stat.nlink !== 1) fail(`${label} must have exactly one hard link.`);
  const handle = fs.openSync(before.realPath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let total = 0;
  let start;
  let end;
  let after;
  try {
    start = fs.fstatSync(handle);
    if (!sameStat(before.stat, start)) {
      fail(`${label} changed identity before its stable read began.`);
    }
    let bytes;
    do {
      bytes = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytes > 0) {
        hash.update(buffer.subarray(0, bytes));
        total += bytes;
      }
    } while (bytes > 0);
    end = fs.fstatSync(handle);
    if (!sameStat(start, end) || total !== start.size) {
      fail(`${label} changed while it was being read.`);
    }
    after = directPath(value, label, 'file');
    if (!sameStat(end, after.stat) || !samePath(before.realPath, after.realPath)) {
      fail(`${label} path was replaced while it was being read.`);
    }
  } finally {
    fs.closeSync(handle);
  }
  return Object.freeze({
    path: before.resolved,
    realPath: after.realPath,
    identity: identity(end, after.realPath),
    sha256: hash.digest('hex').toUpperCase(),
    sizeBytes: total,
    mtimeMs: end.mtimeMs,
  });
}

function startupGateFileArtifact(value, label) {
  const resolved = cleanAbsolute(value, label);
  const pathBefore = fs.lstatSync(resolved, { bigint: true });
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1n) {
    fail(`${label} must be one direct, single-link file.`);
  }
  const realPath = fs.realpathSync.native(resolved);
  if (!samePath(resolved, realPath)) {
    fail(`${label} may not traverse a symbolic link, junction, or reparse point.`);
  }
  const handle = fs.openSync(resolved, 'r');
  let contents;
  let handleBefore;
  let handleAfter;
  try {
    handleBefore = fs.fstatSync(handle, { bigint: true });
    if (
      handleBefore.dev !== pathBefore.dev
      || handleBefore.ino !== pathBefore.ino
      || handleBefore.nlink !== 1n
    ) {
      fail(`${label} changed before its stable read.`);
    }
    contents = fs.readFileSync(handle);
    handleAfter = fs.fstatSync(handle, { bigint: true });
  } finally {
    fs.closeSync(handle);
  }
  const pathAfter = fs.lstatSync(resolved, { bigint: true });
  if (
    handleBefore.dev !== handleAfter.dev
    || handleBefore.ino !== handleAfter.ino
    || handleBefore.nlink !== handleAfter.nlink
    || handleBefore.size !== handleAfter.size
    || handleBefore.mtimeMs !== handleAfter.mtimeMs
    || handleAfter.dev !== pathAfter.dev
    || handleAfter.ino !== pathAfter.ino
    || handleAfter.nlink !== 1n
    || !samePath(fs.realpathSync.native(resolved), realPath)
  ) {
    fail(`${label} changed during its stable read.`);
  }
  return {
    path: resolved,
    realPath,
    sha256: crypto.createHash('sha256').update(contents).digest('hex').toUpperCase(),
    sizeBytes: Number(handleAfter.size),
    mtimeMs: Number(handleAfter.mtimeMs),
    identity: {
      deviceId: handleAfter.dev.toString(),
      fileId: handleAfter.ino.toString(),
      hardLinkCount: Number(handleAfter.nlink),
    },
  };
}

function sameArtifact(left, right) {
  return Boolean(
    left
    && right
    && samePath(left.realPath, right.realPath)
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.mtimeMs === right.mtimeMs
    && stableJson(left.identity) === stableJson(right.identity),
  );
}

function publicArtifact(artifact) {
  return {
    path: artifact.path,
    realPath: artifact.realPath,
    sha256: artifact.sha256,
    sizeBytes: artifact.sizeBytes,
    mtimeMs: artifact.mtimeMs,
    identity: artifact.identity,
  };
}

function noSidecars(db, label) {
  const found = SIDECARS.filter((suffix) => exists(`${db}${suffix}`));
  if (found.length) {
    fail(`${label} has SQLite sidecars: ${found.map((item) => path.basename(item)).join(', ')}.`);
  }
}

function safeOutput(value, label = '--out') {
  const resolved = cleanAbsolute(value, label);
  if (path.extname(resolved).toLowerCase() !== '.json') {
    fail(`${label} must name a .json file.`);
  }
  directPath(path.dirname(resolved), `${label} parent`, 'directory');
  if (exists(resolved)) fail(`${label} already exists and will not be overwritten: ${resolved}`);
  return resolved;
}

function minimalWindowsRuntimeEnvironment(env) {
  const result = {};
  const allowed = new Set(CHILD_ENVIRONMENT_ALLOWLIST);
  for (const [key, value] of Object.entries(env || {})) {
    const normalizedKey = key.toUpperCase();
    if (
      allowed.has(normalizedKey)
      && typeof value === 'string'
      && !normalizedKey.includes('\0')
      && !value.includes('\0')
    ) {
      result[normalizedKey] = value;
    }
  }
  const windowsRootValue = String(
    result.SYSTEMROOT || result.WINDIR || env?.SystemRoot || env?.windir || '',
  );
  if (
    !windowsRootValue
    || windowsRootValue.includes('\0')
    || !path.win32.isAbsolute(windowsRootValue)
    || windowsRootValue.startsWith('\\\\')
  ) {
    fail('Trusted Windows runtime requires one absolute local SystemRoot.');
  }
  const windowsRoot = path.win32.normalize(windowsRootValue);
  const system32 = path.win32.join(windowsRoot, 'System32');
  result.SYSTEMROOT = windowsRoot;
  result.WINDIR = windowsRoot;
  result.SYSTEMDRIVE = path.win32.parse(windowsRoot).root.replace(/[\\/]$/, '');
  result.COMSPEC = path.win32.join(system32, 'cmd.exe');
  result.PATH = [
    system32,
    path.win32.join(system32, 'Wbem'),
    path.win32.join(system32, 'WindowsPowerShell', 'v1.0'),
  ].join(';');
  return result;
}

function assertDirectWindowsAncestors(filePath, windowsRoot, label) {
  const root = path.resolve(windowsRoot);
  let current = path.resolve(filePath);
  for (;;) {
    const leaf = fs.lstatSync(current);
    if (leaf.isSymbolicLink()) {
      fail(`${label} traverses a reparse point: ${current}`);
    }
    if (!samePath(fs.realpathSync.native(current), current)) {
      fail(`${label} resolves through an indirect path: ${current}`);
    }
    if (samePath(current, root)) break;
    const parent = path.dirname(current);
    if (samePath(parent, current) || !sameOrInside(current, root)) {
      fail(`${label} escaped the trusted Windows root.`);
    }
    current = parent;
  }
}

function stableServicingFileArtifact(filePath, label) {
  const before = directPath(filePath, label, 'file');
  if (
    !Number.isInteger(before.stat.nlink)
    || before.stat.nlink < 1
    || before.stat.nlink > TRUSTED_POWERSHELL_MAX_HARDLINKS
  ) {
    fail(`${label} servicing hard-link count is outside the bounded contract.`);
  }
  const handle = fs.openSync(before.realPath, 'r');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let total = 0;
  let start;
  let end;
  try {
    start = fs.fstatSync(handle);
    if (!sameStat(before.stat, start)) fail(`${label} changed before hashing.`);
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
        total += bytesRead;
      }
    } while (bytesRead > 0);
    end = fs.fstatSync(handle);
    if (!sameStat(start, end) || total !== end.size) {
      fail(`${label} changed during hashing.`);
    }
  } finally {
    fs.closeSync(handle);
  }
  const after = directPath(filePath, label, 'file');
  if (!sameStat(end, after.stat) || !samePath(before.realPath, after.realPath)) {
    fail(`${label} path changed during hashing.`);
  }
  return {
    path: before.resolved,
    realPath: after.realPath,
    sha256: hash.digest('hex').toUpperCase(),
    sizeBytes: total,
    mtimeMs: end.mtimeMs,
    identity: {
      deviceId: String(end.dev),
      fileId: String(end.ino),
      hardLinkCount: Number(end.nlink),
    },
  };
}

let trustedPowerShellCache = null;

function resolveTrustedWindowsPowerShell(
  env = process.env,
  dependencies = {},
) {
  const runtimeEnv = minimalWindowsRuntimeEnvironment(env);
  const windowsRoot = path.resolve(runtimeEnv.SYSTEMROOT);
  const executablePath = path.resolve(
    windowsRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  if (
    trustedPowerShellCache
    && samePath(trustedPowerShellCache.realPath, executablePath)
  ) {
    const stat = fs.statSync(executablePath);
    if (
      String(stat.dev) === trustedPowerShellCache.identity.deviceId
      && String(stat.ino) === trustedPowerShellCache.identity.fileId
      && Number(stat.nlink) === trustedPowerShellCache.identity.hardLinkCount
      && stat.size === trustedPowerShellCache.sizeBytes
      && stat.mtimeMs === trustedPowerShellCache.mtimeMs
    ) {
      return trustedPowerShellCache;
    }
    fail('Trusted Windows PowerShell identity drifted after validation.');
  }

  assertDirectWindowsAncestors(
    executablePath,
    windowsRoot,
    'Trusted Windows PowerShell',
  );
  const artifact = stableServicingFileArtifact(
    executablePath,
    'Trusted Windows PowerShell',
  );
  const fsutilPath = path.resolve(windowsRoot, 'System32', 'fsutil.exe');
  assertDirectWindowsAncestors(fsutilPath, windowsRoot, 'Trusted fsutil');
  const run = dependencies.spawnSync || spawnSync;
  const hardlinkResult = run(
    fsutilPath,
    ['hardlink', 'list', executablePath],
    {
      encoding: 'utf8',
      env: runtimeEnv,
      shell: false,
      timeout: 20_000,
      windowsHide: true,
    },
  );
  if (hardlinkResult.error || hardlinkResult.status !== 0) {
    fail('Trusted Windows PowerShell hard-link enumeration failed.');
  }
  const driveRoot = path.parse(executablePath).root;
  const hardlinkPaths = String(hardlinkResult.stdout || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (
      /^[\\/]/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)
        ? path.resolve(driveRoot, value.replace(/^[\\/]+/, ''))
        : path.isAbsolute(value)
        ? path.resolve(value)
        : path.resolve(driveRoot, value)
    ))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const hardlinkPathCharacters = hardlinkPaths.reduce(
    (total, value) => total + value.length,
    0,
  );
  if (
    hardlinkPaths.length !== artifact.identity.hardLinkCount
    || hardlinkPaths.length < 1
    || hardlinkPaths.length > TRUSTED_POWERSHELL_MAX_HARDLINKS
    || hardlinkPathCharacters > TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS
    || !hardlinkPaths.some((candidate) => samePath(candidate, executablePath))
  ) {
    fail('Trusted Windows PowerShell hard-link set is incomplete or unbounded.');
  }
  const normalizedSystemPath = normalizedPath(executablePath);
  const normalizedServicingRoot = normalizedPath(
    path.resolve(windowsRoot, 'WinSxS'),
  );
  for (const candidate of hardlinkPaths) {
    const normalized = normalizedPath(candidate);
    if (
      normalized !== normalizedSystemPath
      && !sameOrInside(normalized, normalizedServicingRoot)
    ) {
      fail('Trusted Windows PowerShell has an unapproved hard-link path.');
    }
    assertDirectWindowsAncestors(
      candidate,
      windowsRoot,
      'Trusted Windows PowerShell hard link',
    );
    const stat = fs.statSync(candidate);
    if (
      String(stat.dev) !== artifact.identity.deviceId
      || String(stat.ino) !== artifact.identity.fileId
    ) {
      fail('Trusted Windows PowerShell hard-link identity differs.');
    }
  }

  const identityCommand = [
    "$ErrorActionPreference='Stop'",
    "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_TRUSTED_SHELL_B64))",
    '$acl=[IO.File]::GetAccessControl($p)',
    '$sidType=[Security.Principal.SecurityIdentifier]',
    '$rules=@($acl.GetAccessRules($true,$true,$sidType) | ForEach-Object { [ordered]@{ sid=$_.IdentityReference.Value; type=$_.AccessControlType.ToString(); rights=([int64]$_.FileSystemRights).ToString(); inherited=[bool]$_.IsInherited } })',
    '$signature=Get-AuthenticodeSignature -LiteralPath $p',
    '$version=[Diagnostics.FileVersionInfo]::GetVersionInfo($p)',
    '[ordered]@{ ownerSid=$acl.GetOwner($sidType).Value; inheritanceProtected=[bool]$acl.AreAccessRulesProtected; rules=$rules; signatureStatus=$signature.Status.ToString(); signatureSubject=$signature.SignerCertificate.Subject; signatureThumbprint=$signature.SignerCertificate.Thumbprint; companyName=$version.CompanyName; fileVersion=$version.FileVersion; productName=$version.ProductName; originalFilename=$version.OriginalFilename } | ConvertTo-Json -Compress -Depth 6',
  ].join('\n');
  const identityResult = run(
    executablePath,
    ['-NoProfile', '-NonInteractive', '-Command', identityCommand],
    {
      encoding: 'utf8',
      env: {
        ...runtimeEnv,
        AAO_S7_TRUSTED_SHELL_B64: Buffer.from(
          executablePath,
          'utf8',
        ).toString('base64'),
      },
      shell: false,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (identityResult.error || identityResult.status !== 0) {
    fail('Trusted Windows PowerShell signature/ACL inspection failed.');
  }
  let proof;
  try {
    proof = JSON.parse(String(identityResult.stdout || '').trim());
  } catch {
    fail('Trusted Windows PowerShell signature/ACL proof was invalid.');
  }
  const rules = Array.isArray(proof?.rules)
    ? proof.rules
    : proof?.rules
      ? [proof.rules]
      : [];
  const unsafeWritable = rules.filter((rule) => {
    let rights;
    try {
      rights = BigInt(rule?.rights);
    } catch {
      return true;
    }
    return String(rule?.type) !== 'Allow'
      || rule?.inherited === true
      || (
        (rights & WINDOWS_WRITE_RIGHTS_MASK) !== 0n
        && ![TRUSTED_INSTALLER_SID, 'S-1-5-18', 'S-1-5-32-544'].includes(
          String(rule?.sid || ''),
        )
      );
  });
  if (
    ![TRUSTED_INSTALLER_SID, 'S-1-5-18'].includes(String(proof?.ownerSid || ''))
    || proof?.inheritanceProtected !== true
    || unsafeWritable.length !== 0
    || proof?.signatureStatus !== 'Valid'
    || !TRUSTED_POWERSHELL_SIGNATURE_SUBJECT.test(
      String(proof?.signatureSubject || ''),
    )
    || !/^Microsoft/i.test(String(proof?.companyName || ''))
    || !String(proof?.fileVersion || '')
    || !String(proof?.originalFilename || '').toLowerCase().includes('powershell')
  ) {
    fail('Trusted Windows PowerShell signature, owner, or ACL contract failed.');
  }
  trustedPowerShellCache = Object.freeze({
    ...artifact,
    hardlinkPaths: Object.freeze([...hardlinkPaths]),
    hardlinkPathCharacters,
    signature: Object.freeze({
      status: proof.signatureStatus,
      subject: proof.signatureSubject,
      thumbprint: String(proof.signatureThumbprint || '').toUpperCase(),
    }),
    version: Object.freeze({
      companyName: proof.companyName,
      fileVersion: proof.fileVersion,
      originalFilename: proof.originalFilename,
      productName: proof.productName,
    }),
  });
  return trustedPowerShellCache;
}

function spawnTrustedWindowsPowerShell(
  args,
  options = {},
  env = process.env,
) {
  const shellIdentity = resolveTrustedWindowsPowerShell(env);
  return spawnSync(shellIdentity.realPath, args, {
    ...options,
    env: options.env || minimalWindowsRuntimeEnvironment(env),
    shell: false,
  });
}

function defaultInspectWindowsPathSecurity(value, options = {}) {
  const target = directPath(
    value,
    options.label || 'Windows protected path',
    options.type || 'directory',
  );
  const result = spawnTrustedWindowsPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_ACL_PATH_B64))",
        '$acl=if([System.IO.Directory]::Exists($p)){',
        '  [System.IO.Directory]::GetAccessControl($p)',
        '} else {',
        '  [System.IO.File]::GetAccessControl($p)',
        '}',
        '$sidType=[System.Security.Principal.SecurityIdentifier]',
        '$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
        '$owner=$acl.GetOwner($sidType).Value',
        '$rules=@($acl.GetAccessRules($true,$true,$sidType) | ForEach-Object {',
        '  [ordered]@{',
        '    sid=$_.IdentityReference.Value',
        '    type=$_.AccessControlType.ToString()',
        '    rights=([int64]$_.FileSystemRights).ToString()',
        '    inherited=[bool]$_.IsInherited',
        '  }',
        '})',
        '[ordered]@{',
        '  ownerSid=$owner',
        '  currentUserSid=$current',
        '  inheritanceProtected=[bool]$acl.AreAccessRulesProtected',
        '  rules=$rules',
        '} | ConvertTo-Json -Compress -Depth 5',
      ].join('\n'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...minimalWindowsRuntimeEnvironment(process.env),
        AAO_S7_ACL_PATH_B64: Buffer.from(target.realPath, 'utf8').toString('base64'),
      },
      windowsHide: true,
      timeout: 20_000,
    },
  );
  if (result.error || result.status !== 0) {
    fail(`${options.label || 'Windows protected path'} ACL inspection failed.`);
  }
  let proof;
  try {
    proof = JSON.parse(String(result.stdout || '').trim());
  } catch {
    fail(`${options.label || 'Windows protected path'} ACL proof was invalid.`);
  }
  const currentSid = String(proof?.currentUserSid || '');
  const ownerSid = String(proof?.ownerSid || '');
  const rules = Array.isArray(proof?.rules)
    ? proof.rules
    : proof?.rules
      ? [proof.rules]
      : [];
  const safeWritePrincipals = new Set([
    currentSid,
    'S-1-5-18',
    'S-1-5-32-544',
  ]);
  const highRiskPrincipals = new Set([
    'S-1-1-0',
    'S-1-5-7',
    'S-1-5-11',
    'S-1-5-32-545',
    'S-1-5-32-546',
  ]);
  const writeBits = [
    2n,
    4n,
    16n,
    64n,
    256n,
    65_536n,
    262_144n,
    524_288n,
  ];
  let currentUserWriteAllowed = false;
  const normalizedRules = rules.map((rule) => {
    const sid = String(rule?.sid || '');
    const type = String(rule?.type || '');
    let rights;
    try {
      rights = BigInt(rule?.rights);
    } catch {
      fail(`${options.label || 'Windows protected path'} ACL rights were invalid.`);
    }
    const writable = writeBits.some((bit) => (rights & bit) !== 0n);
    if (type === 'Allow' && highRiskPrincipals.has(sid)) {
      fail(`${options.label || 'Windows protected path'} ACL grants a high-risk principal.`);
    }
    if (type === 'Allow' && writable && !safeWritePrincipals.has(sid)) {
      fail(`${options.label || 'Windows protected path'} ACL grants write access to an unapproved principal.`);
    }
    if (type === 'Allow' && writable && sid === currentSid) currentUserWriteAllowed = true;
    return {
      sid,
      type,
      rights: rights.toString(),
      inherited: rule?.inherited === true,
    };
  });
  if (
    !currentSid
    || ownerSid !== currentSid
    || !currentUserWriteAllowed
    || (options.requireProtected === true && proof?.inheritanceProtected !== true)
  ) {
    fail(`${options.label || 'Windows protected path'} owner or inheritance contract failed.`);
  }
  return {
    passed: true,
    path: target.realPath,
    ownerSid,
    currentUserSid: currentSid,
    inheritanceProtected: proof.inheritanceProtected === true,
    protectedInheritanceRequired: options.requireProtected === true,
    highRiskWritePrincipalCount: 0,
    rules: normalizedRules,
  };
}

function defaultProtectWindowsDirectory(value) {
  const target = directPath(value, 'Windows directory to protect', 'directory');
  const result = spawnTrustedWindowsPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_ACL_PATH_B64))",
        '$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
        '$system=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")',
        '$admins=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")',
        '$acl=New-Object System.Security.AccessControl.DirectorySecurity',
        '$acl.SetOwner($current)',
        '$acl.SetAccessRuleProtection($true,$false)',
        'foreach($sid in @($current,$system,$admins)){',
        '  $rule=[System.Security.AccessControl.FileSystemAccessRule]::new(',
        '    $sid,',
        '    [System.Security.AccessControl.FileSystemRights]::FullControl,',
        '    ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),',
        '    [System.Security.AccessControl.PropagationFlags]::None,',
        '    [System.Security.AccessControl.AccessControlType]::Allow',
        '  )',
        '  [void]$acl.AddAccessRule($rule)',
        '}',
        '[System.IO.Directory]::SetAccessControl($p,$acl)',
      ].join('\n'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...minimalWindowsRuntimeEnvironment(process.env),
        AAO_S7_ACL_PATH_B64: Buffer.from(target.realPath, 'utf8').toString('base64'),
      },
      windowsHide: true,
      timeout: 20_000,
    },
  );
  if (result.error || result.status !== 0) {
    const detail = String(
      result.error?.message || result.stderr || 'unknown PowerShell ACL failure',
    ).trim().slice(0, 500);
    fail(`Could not establish a protected Windows ACL for ${target.realPath}: ${detail}`);
  }
  return target.realPath;
}

function defaultProtectWindowsFile(value) {
  const target = directPath(value, 'Windows file to protect', 'file');
  const result = spawnTrustedWindowsPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        "$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:AAO_S7_ACL_PATH_B64))",
        '$current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User',
        '$system=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")',
        '$admins=[System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")',
        '$acl=New-Object System.Security.AccessControl.FileSecurity',
        '$acl.SetOwner($current)',
        '$acl.SetAccessRuleProtection($true,$false)',
        'foreach($sid in @($current,$system,$admins)){',
        '  $rule=[System.Security.AccessControl.FileSystemAccessRule]::new(',
        '    $sid,',
        '    [System.Security.AccessControl.FileSystemRights]::FullControl,',
        '    [System.Security.AccessControl.InheritanceFlags]::None,',
        '    [System.Security.AccessControl.PropagationFlags]::None,',
        '    [System.Security.AccessControl.AccessControlType]::Allow',
        '  )',
        '  [void]$acl.AddAccessRule($rule)',
        '}',
        '[System.IO.File]::SetAccessControl($p,$acl)',
      ].join('\n'),
    ],
    {
      encoding: 'utf8',
      env: {
        ...minimalWindowsRuntimeEnvironment(process.env),
        AAO_S7_ACL_PATH_B64: Buffer.from(target.realPath, 'utf8').toString('base64'),
      },
      windowsHide: true,
      timeout: 20_000,
    },
  );
  if (result.error || result.status !== 0) {
    const detail = String(
      result.error?.message || result.stderr || 'unknown PowerShell ACL failure',
    ).trim().slice(0, 500);
    fail(`Could not establish a protected Windows ACL for ${target.realPath}: ${detail}`);
  }
  return target.realPath;
}

function sameOrInside(candidate, root) {
  const relative = path.relative(normalizedPath(root), normalizedPath(candidate));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathsOverlap(left, right) {
  return sameOrInside(left, right) || sameOrInside(right, left);
}

function isolatedRecoveryOutput(
  outputValue,
  recoveryRootValue,
  canonical,
  packageIdentity,
  inputArtifactPaths,
  inspectWindowsPathSecurity,
) {
  const recoveryRoot = directPath(
    recoveryRootValue,
    '--recovery-root',
    'directory',
  ).realPath;
  const output = safeOutput(outputValue);
  if (!sameOrInside(output, recoveryRoot)) {
    fail('--out must be contained by --recovery-root.');
  }
  if (!samePath(path.dirname(output), recoveryRoot)) {
    fail('--out must be a direct child of --recovery-root.');
  }

  const packageRoot = path.dirname(cleanAbsolute(
    packageIdentity?.exe?.realPath,
    'Current package EXE identity',
  ));
  const appContentRoot = cleanAbsolute(
    packageIdentity?.appContent?.realPath,
    'Current package app-content identity',
  );
  const forbidden = [
    { label: 'package root', value: packageRoot },
    { label: 'package app-content', value: appContentRoot },
    {
      label: 'canonical packaged userData, database, sidecars, and profiles',
      value: cleanAbsolute(canonical?.userDataDir, 'Canonical packaged userData'),
    },
  ];
  for (const [index, inputPath] of inputArtifactPaths.entries()) {
    const artifact = directPath(
      inputPath,
      `Input artifact ${index + 1}`,
      'file',
    );
    forbidden.push({
      label: `input artifact tree ${index + 1}`,
      value: path.dirname(artifact.realPath),
    });
  }
  for (const item of forbidden) {
    if (pathsOverlap(recoveryRoot, item.value) || pathsOverlap(output, item.value)) {
      fail(`--recovery-root and --out must be isolated from ${item.label}.`);
    }
  }
  const windowsSecurity = inspectWindowsPathSecurity(recoveryRoot, {
    label: '--recovery-root',
    type: 'directory',
    requireProtected: true,
  });
  if (windowsSecurity?.passed !== true) {
    fail('--recovery-root Windows ACL proof failed.');
  }
  return { output, recoveryRoot, windowsSecurity };
}

function writeExclusive(output, value) {
  const finalPath = safeOutput(output);
  const temporary = path.join(
    path.dirname(finalPath),
    `.tmp-${path.basename(finalPath)}-${crypto.randomUUID()}`,
  );
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.linkSync(temporary, finalPath);
    fs.unlinkSync(temporary);
    return finalPath;
  } catch (error) {
    if (handle !== undefined && handle !== null) fs.closeSync(handle);
    if (exists(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

function writeDurableBlockingIntent(output, value) {
  const finalPath = safeOutput(output, 'Live migration launch intent');
  let handle;
  try {
    handle = fs.openSync(finalPath, 'wx', 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    return finalPath;
  } catch (error) {
    if (handle !== undefined && handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Preserve the final-path intent, even if incomplete, as blocking recovery evidence.
      }
    }
    // Never unlink a zero-length, partial, or complete final-path intent after handoff began.
    throw error;
  }
}
function readJsonStable(value, label) {
  const result = readJsonArtifact(value, label);
  const artifact = fileArtifact(result.artifact.path, label);
  if (
    artifact.sha256 !== result.artifact.sha256
    || artifact.sizeBytes !== result.artifact.sizeBytes
    || !samePath(artifact.realPath, result.artifact.realPath)
  ) {
    fail(`${label} changed between JSON parsing and stable identity verification.`);
  }
  return { artifact, value: result.value };
}

function assertTreeSingleLinked(rootPath) {
  const root = directPath(rootPath, 'Canonical package app-content', 'directory');
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const target = path.join(directory, name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        fail(`Canonical package app-content contains a link or reparse point: ${target}`);
      }
      const real = fs.realpathSync.native(target);
      const relative = path.relative(root.realPath, real);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        fail(`Canonical package app-content escapes its fixed root: ${target}`);
      }
      if (stat.isDirectory()) visit(real);
      else if (!stat.isFile() || stat.nlink !== 1) {
        fail(`Canonical package app-content leaf must be a single-linked regular file: ${target}`);
      }
    }
  };
  visit(root.realPath);
  return root;
}

function defaultPackageIdentity() {
  const hashes = collectFixedPackageHashes();
  const app = assertTreeSingleLinked(CANONICAL_APP);
  const exe = fileArtifact(CANONICAL_EXE, 'Canonical package EXE');
  const main = fileArtifact(CANONICAL_MAIN, 'Canonical package Main bundle');
  if (
    !samePath(hashes.executablePath, CANONICAL_EXE)
    || !samePath(hashes.appContentPath, CANONICAL_APP)
    || exe.sha256 !== normalizeSha(hashes.exeSha256, 'Package EXE hash')
  ) {
    fail('Fixed package hash helper did not return the canonical package identity.');
  }
  return {
    exe: publicArtifact(exe),
    appContent: {
      path: CANONICAL_APP,
      realPath: app.realPath,
      sha256: normalizeSha(hashes.appContentSha256, 'Package app-content hash'),
      fileCount: hashes.appContentFileCount,
      sizeBytes: hashes.appContentSizeBytes,
    },
    main: publicArtifact(main),
  };
}

function samePackageIdentity(left, right) {
  return stableJson(left) === stableJson(right);
}

function assertPacketPackageIdentity(packet, current) {
  const expected = packet?.bindings?.package;
  if (!expected || !samePackageIdentity(expected, current)) {
    fail('Canonical package identity drifted since approval packet creation.');
  }
}

function writeProtectedRecoveryOutput(output, value, context, label) {
  const written = writeExclusive(output, value);
  const security = context.inspectWindowsPathSecurity(written, {
    label,
    type: 'file',
    requireProtected: false,
  });
  if (security?.passed !== true) fail(`${label} Windows ACL proof failed.`);
  return written;
}

function flushDirectoryWhereSupported(directoryPath) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(
      String(error?.code),
    )) {
      throw error;
    }
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function writeProtectedAtomicJson(output, value, context, label) {
  const finalPath = safeOutput(output, label);
  const parent = path.dirname(finalPath);
  const temporary = path.join(
    parent,
    `.tmp-${path.basename(finalPath)}-${crypto.randomUUID()}`,
  );
  let handle = null;
  let published = false;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    context.protectWindowsFile(temporary);
    const stagedSecurity = context.inspectWindowsPathSecurity(temporary, {
      label: `${label} staging file`,
      type: 'file',
      requireProtected: true,
    });
    if (stagedSecurity?.passed !== true) {
      fail(`${label} staging ACL proof failed.`);
    }
    fs.linkSync(temporary, finalPath);
    published = true;
    fs.unlinkSync(temporary);
    flushDirectoryWhereSupported(parent);
    const finalArtifact = fileArtifact(finalPath, label);
    const finalSecurity = context.inspectWindowsPathSecurity(finalPath, {
      label,
      type: 'file',
      requireProtected: true,
    });
    if (finalSecurity?.passed !== true) fail(`${label} final ACL proof failed.`);
    return { path: finalPath, artifact: finalArtifact, windowsSecurity: finalSecurity };
  } catch (error) {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Preserve the original publication error.
      }
    }
    if (!published && exists(temporary)) {
      try {
        fs.unlinkSync(temporary);
      } catch {
        // A leftover staging file is fail-closed recovery evidence.
      }
    }
    throw error;
  }
}

function defaultReadSchema(dbPath) {
  const Database = requireSqlite();
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    return Number(readAppliedVersion(db));
  } finally {
    db.close();
  }
}

function postMigrationAuthorityContract(actualRows) {
  const productionContract = migrationContract();
  const rows = (actualRows ?? productionContract).map((row) => ({
    version: Number(row.version),
    name: String(row.name),
    checksum: String(row.checksum),
    status: String(row.status ?? 'applied').toLowerCase(),
  }));
  if (!migrationRowsMatchProductionContract(
    rows,
    productionContract,
    migrationV1ChecksumWhitelist(productionContract),
  )) {
    fail(`Post-migration authority ledger is not the exact allowed v1..v${TARGET_VERSION} contract.`);
  }
  const storeProviderIdentityV11 = storeProviderIdentityV11SchemaContract();
  return {
    targetVersion: TARGET_VERSION,
    integrityCheck: 'ok',
    foreignKeyViolationCount: 0,
    migrationRows: rows,
    requiredTables: [...REQUIRED_TABLES],
    storeProviderIdentityV11,
    contractSha256: sha256(stableJson({
      targetVersion: TARGET_VERSION,
      migrationRows: rows,
      requiredTables: REQUIRED_TABLES,
      storeProviderIdentityV11,
    })),
  };
}

function defaultInspectPostMigrationAuthority(dbPath) {
  const Database = requireSqlite();
  const database = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    database.pragma('query_only = ON');
    const integrityRows = database.pragma('integrity_check');
    const integrityCheck = String(
      Object.values(integrityRows?.[0] || {})[0] || '',
    ).toLowerCase();
    const foreignKeyViolations = database.pragma('foreign_key_check');
    const tableNames = new Set(database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `).all().map((row) => String(row.name)));
    const migrationRows = database.prepare(`
      SELECT version, name, checksum, status
      FROM schema_migrations
      ORDER BY version
    `).all().map((row) => ({
      version: Number(row.version),
      name: String(row.name),
      checksum: String(row.checksum),
      status: String(row.status),
    }));
    assertStoreProviderIdentityV11Schema(
      database,
      'Post-migration authority v11 store provider identity schema',
    );
    const expected = postMigrationAuthorityContract(migrationRows);
    if (
      integrityRows.length !== 1
      || integrityCheck !== 'ok'
      || foreignKeyViolations.length !== 0
      || REQUIRED_TABLES.some((name) => !tableNames.has(name))
    ) {
      fail('Post-migration authority schema/ledger/checksum/invariants are not current.');
    }
    return expected;
  } finally {
    database.close();
  }
}

function parsePowerShellJson(result, label) {
  if (result.error || result.status !== 0) {
    return { passed: false, rows: [], unresolved: [`${label}-query-failed`] };
  }
  try {
    const text = String(result.stdout || '').trim();
    const parsed = text ? JSON.parse(text) : [];
    return {
      passed: true,
      rows: parsed == null ? [] : Array.isArray(parsed) ? parsed : [parsed],
      unresolved: [],
    };
  } catch {
    return { passed: false, rows: [], unresolved: [`${label}-query-invalid`] };
  }
}

function defaultListProcesses() {
  const result = spawnTrustedWindowsPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `@(Get-CimInstance Win32_Process -Filter "Name='AmazonAIOpsAgent.exe'" | Select-Object ProcessId,ParentProcessId,ExecutablePath) | ConvertTo-Json -Compress`,
    ],
    {
      encoding: 'utf8',
      env: minimalWindowsRuntimeEnvironment(process.env),
      windowsHide: true,
      timeout: 20_000,
    },
  );
  const parsed = parsePowerShellJson(result, 'process');
  const unresolved = [...parsed.unresolved];
  const matching = [];
  for (const row of parsed.rows) {
    if (!Number.isInteger(Number(row?.ProcessId)) || !String(row?.ExecutablePath || '').trim()) {
      unresolved.push('process-identity-unresolved');
    } else {
      matching.push({
        pid: Number(row.ProcessId),
        parentPid: Number.isInteger(Number(row.ParentProcessId))
          ? Number(row.ParentProcessId)
          : null,
        executablePath: String(row.ExecutablePath),
      });
    }
  }
  return { passed: parsed.passed, matching, unresolved };
}

function defaultListSuspendedSameNameProcesses() {
  const result = spawnTrustedWindowsPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `@(Get-CimInstance Win32_Process -Filter "Name='AmazonAIOpsAgent.exe'" | Select-Object ProcessId,ParentProcessId) | ConvertTo-Json -Compress`,
    ],
    {
      encoding: 'utf8',
      env: minimalWindowsRuntimeEnvironment(process.env),
      windowsHide: true,
      timeout: 20_000,
    },
  );
  const parsed = parsePowerShellJson(result, 'suspended-process');
  const unresolved = [...parsed.unresolved];
  const matching = [];
  for (const row of parsed.rows) {
    if (!Number.isInteger(Number(row?.ProcessId)) || Number(row.ProcessId) < 1) {
      unresolved.push('suspended-process-id-unresolved');
    } else {
      matching.push({
        pid: Number(row.ProcessId),
        parentPid: Number.isInteger(Number(row.ParentProcessId))
          ? Number(row.ParentProcessId)
          : null,
        executablePath: null,
      });
    }
  }
  return { passed: parsed.passed, matching, unresolved };
}

function validateProcessState(state, label) {
  if (
    !state
    || state.passed !== true
    || !Array.isArray(state.matching)
    || !Array.isArray(state.unresolved)
    || state.matching.length !== 0
    || state.unresolved.length !== 0
  ) {
    fail(`${label} has an existing or unresolved AmazonAIOpsAgent process.`);
  }
}

function validateSpawnProcessState(state, rootPid) {
  if (
    !state
    || state.passed !== true
    || !Array.isArray(state.matching)
    || !Array.isArray(state.unresolved)
    || state.unresolved.length !== 0
  ) {
    fail('Spawn-window AmazonAIOpsAgent process inventory was unresolved.');
  }
  const byPid = new Map();
  for (const item of state.matching) {
    const pid = Number(item?.pid);
    if (
      !Number.isInteger(pid)
      || pid < 1
      || byPid.has(pid)
    ) {
      fail('Spawn-window process inventory contained an invalid same-name process ID.');
    }
    byPid.set(pid, item);
  }
  if (!byPid.has(rootPid)) {
    fail('Spawn-window process inventory did not contain the confirmed root PID.');
  }
  const allowed = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of byPid.values()) {
      if (!allowed.has(item.pid) && allowed.has(Number(item.parentPid))) {
        allowed.add(item.pid);
        changed = true;
      }
    }
  }
  if (allowed.size !== byPid.size) {
    fail('Spawn-window process inventory contained an unrelated same-name process.');
  }
  return receiptProcessState(state);
}

function defaultResolveKnownFolder(specialFolder, label) {
  const result = spawnTrustedWindowsPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Environment]::GetFolderPath([Environment+SpecialFolder]::${specialFolder})`,
    ],
    {
      encoding: 'utf8',
      env: minimalWindowsRuntimeEnvironment(process.env),
      windowsHide: true,
      timeout: 20_000,
    },
  );
  const value = String(result.stdout || '').trim();
  if (result.error || result.status !== 0 || !value) {
    fail(`Windows Known Folder lookup for ${label} failed.`);
  }
  return value;
}

function defaultResolveRoamingAppData() {
  return defaultResolveKnownFolder('ApplicationData', 'Roaming AppData');
}

function defaultResolveUserProfile() {
  return defaultResolveKnownFolder('UserProfile', 'User Profile');
}

function resolveCanonicalPaths(context) {
  const roaming = directPath(
    context.resolveRoamingAppData(),
    'Windows Roaming AppData Known Folder',
    'directory',
  );
  const userProfile = directPath(
    context.resolveUserProfile(),
    'Windows User Profile Known Folder',
    'directory',
  );
  const userDataPath = path.join(roaming.realPath, ...PACKAGED_APP_NAME.split('/'));
  const userData = directPath(userDataPath, 'Canonical packaged userData', 'directory');
  const databasePath = path.join(userData.realPath, 'amazon-ai-ops.db');
  return {
    roamingAppData: roaming.realPath,
    userProfile: userProfile.realPath,
    userDataDir: userData.realPath,
    databasePath,
  };
}

function defaultInspectAuthority({
  dbPath,
  userDataDir,
  sha256: expectedSha256,
  roamingAppData,
  userProfile,
}) {
  return inspectProductionAuthoritySelection(
    {
      dbPath,
      expectedUserDataDir: userDataDir,
      expectedMainSha256: expectedSha256,
    },
    {
      env: { APPDATA: roamingAppData, USERPROFILE: userProfile },
      writeStdout: () => {},
    },
  );
}

function validateAuthoritySelection(receipt, current, db, canonical, now) {
  const generatedAt = Date.parse(receipt?.generatedAt || '');
  if (
    receipt?.kind !== 'production-authority-selection-preflight'
    || receipt?.schemaVersion !== 'production-authority-selection-preflight/v1'
    || receipt?.status !== 'SELECTED_MIGRATION_REQUIRED'
    || receipt?.formalEvidence !== false
    || receipt?.authorityDatabaseMutated !== false
    || receipt?.adsExecutionInvoked !== false
    || !Number.isFinite(generatedAt)
    || generatedAt > now().valueOf() + 60_000
    || current?.kind !== receipt.kind
    || current?.schemaVersion !== receipt.schemaVersion
    || current?.status !== receipt.status
    || current?.formalEvidence !== false
    || current?.authorityDatabaseMutated !== false
    || current?.adsExecutionInvoked !== false
    || stableJson(current.selection) !== stableJson(receipt.selection)
    || !samePath(current.selection?.expectedUserDataDir, canonical.userDataDir)
    || !samePath(current.selection?.expectedDatabasePath, canonical.databasePath)
    || !samePath(current.selection?.selected?.absolutePath, db.realPath)
    || !samePath(current.selection?.selected?.realPath, db.realPath)
    || current.selection?.selected?.offlineMigrationEligible !== true
    || normalizeSha(current.selection?.selected?.mainFileSha256, 'Authority selection SHA')
      !== db.sha256
  ) {
    fail('Authority selection is not the current strict canonical AppData authority preflight.');
  }
}

function exactPassingChecks(receipt, label) {
  const codes = Array.isArray(receipt?.checks)
    ? receipt.checks.map((check) => check?.code)
    : [];
  if (
    receipt?.kind !== 's7-migration-backup-restore-verification'
    || Number(receipt?.schemaVersion) !== 1
    || receipt?.passed !== true
    || stableJson(codes) !== stableJson(REQUIRED_MIGRATION_VERIFICATION_CODES)
    || receipt.checks.some((check) => check?.passed !== true)
    || receipt?.summary?.total !== REQUIRED_MIGRATION_VERIFICATION_CODES.length
    || receipt?.summary?.passed !== REQUIRED_MIGRATION_VERIFICATION_CODES.length
    || receipt?.summary?.failed !== 0
  ) {
    fail(`${label} does not contain the exact 19 passing migration verification checks.`);
  }
}

function validateMigrationInputs(migration, verification, db, context) {
  const manifest = migration.value;
  if (
    manifest?.kind !== 's7-offline-db-upgrade'
    || Number(manifest?.schemaVersion) !== 1
    || manifest?.passed !== true
    || Number(manifest?.targetVersion) !== TARGET_VERSION
    || !samePath(manifest?.source?.path, db.realPath)
    || normalizeSha(manifest?.source?.sha256, 'Offline migration source SHA') !== db.sha256
    || manifest?.source?.version !== REQUIRED_SOURCE_VERSION
  ) {
    fail(`Offline migration manifest is not a passing exact v0-to-v${TARGET_VERSION} rehearsal for this DB.`);
  }
  exactPassingChecks(verification.value, 'Supplied migration verification receipt');
  if (
    !samePath(verification.value.sourceManifestPath, migration.artifact.realPath)
    || normalizeSha(
      verification.value.sourceManifestSha256,
      'Migration verification source manifest SHA',
    ) !== migration.artifact.sha256
  ) {
    fail('Migration verification receipt is not bound to the supplied manifest.');
  }
  const recomputed = context.verifyMigration(migration.artifact.realPath);
  exactPassingChecks(recomputed, 'Independently recomputed migration verification');
  if (
    !samePath(recomputed.sourceManifestPath, migration.artifact.realPath)
    || normalizeSha(
      recomputed.sourceManifestSha256,
      'Recomputed migration verification source manifest SHA',
    ) !== migration.artifact.sha256
  ) {
    fail('Independent migration verification did not bind the supplied manifest.');
  }
  return {
    verifier: 'verifyS7MigrationBackupRestore',
    sourceManifestPath: recomputed.sourceManifestPath,
    sourceManifestSha256: recomputed.sourceManifestSha256,
    passed: true,
    checkCodes: [...REQUIRED_MIGRATION_VERIFICATION_CODES],
    summary: {
      total: REQUIRED_MIGRATION_VERIFICATION_CODES.length,
      passed: REQUIRED_MIGRATION_VERIFICATION_CODES.length,
      failed: 0,
    },
  };
}

function packageUiFileMatchesDb(record, db) {
  return samePath(record?.path, db.realPath)
    && normalizeSha(record?.sha256, 'Package UI protected DB SHA') === db.sha256
    && Number(record?.sizeBytes) === db.sizeBytes
    && Number(record?.mtimeMs) === db.mtimeMs;
}

function validatePackageUi(manifest, artifact, currentPackage, db, context) {
  const generatedAt = Date.parse(manifest?.generatedAt || '');
  const currentTime = context.now();
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.valueOf())) {
    fail('Package UI validation clock returned an invalid date.');
  }
  if (
    manifest?.kind !== 'package-ui-evidence'
    || Number(manifest?.schemaVersion) !== 8
    || manifest?.passed !== true
    || !Number.isFinite(generatedAt)
    || generatedAt > currentTime.valueOf() + 60_000
    || currentTime.valueOf() - generatedAt > MAX_PACKAGE_UI_AGE_MS
  ) {
    fail('Package UI manifest is invalid, failed, future-dated, or stale.');
  }
  const formal = context.evaluatePackageUiEvidence(manifest);
  if (
    formal?.passed !== true
    || !Array.isArray(formal?.violations)
    || formal.violations.length !== 0
  ) {
    fail('Formal Package UI v8 completeness evaluation failed.');
  }
  const requested = manifest.requested || {};
  const before = manifest.artifactsBefore || {};
  const after = manifest.artifactsAfter || {};
  if (
    manifest.artifactHashesStable !== true
    || !samePath(requested.executablePath, currentPackage.exe.realPath)
    || normalizeSha(requested.expectedExeSha256, 'Package UI expected EXE hash')
      !== currentPackage.exe.sha256
    || !samePath(requested.appContentPath, currentPackage.appContent.realPath)
    || normalizeSha(
      requested.expectedAppContentSha256,
      'Package UI expected app-content hash',
    ) !== currentPackage.appContent.sha256
    || normalizeSha(before.exe?.sha256, 'Package UI before EXE hash')
      !== currentPackage.exe.sha256
    || normalizeSha(before.appContent?.sha256, 'Package UI before app-content hash')
      !== currentPackage.appContent.sha256
    || normalizeSha(after.exe?.sha256, 'Package UI after EXE hash')
      !== currentPackage.exe.sha256
    || normalizeSha(after.appContent?.sha256, 'Package UI after app-content hash')
      !== currentPackage.appContent.sha256
    || manifest.protectedDatabase?.passed !== true
    || manifest.protectedDatabase?.unchanged !== true
    || !packageUiFileMatchesDb(manifest.protectedDatabase?.before, db)
    || !packageUiFileMatchesDb(manifest.protectedDatabase?.after, db)
  ) {
    fail('Passed Package UI manifest does not bind the current package and live authority DB.');
  }
  return {
    artifact: publicArtifact(artifact),
    generatedAt: new Date(generatedAt).toISOString(),
    schemaVersion: 8,
    passed: true,
    runGroupId: manifest.runGroup?.runGroupId ?? null,
    formalEvaluation: {
      evaluator: 'evaluatePackageUiEvidenceCompleteness',
      passed: true,
      violationCount: 0,
    },
    protectedDatabaseBinding: {
      path: db.realPath,
      sha256: db.sha256,
      sizeBytes: db.sizeBytes,
      mtimeMs: db.mtimeMs,
      beforeMatches: true,
      afterMatches: true,
    },
  };
}

function defaultExclusiveDbPreflight(dbPath) {
  const escaped = String(dbPath).replace(/'/g, "''");
  const command = [
    `$p='${escaped}'`,
    '$s=$null',
    'try {',
    '  $s=[System.IO.File]::Open($p,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None)',
    "  [Console]::Out.Write('OK')",
    '} finally { if ($null -ne $s) { $s.Dispose() } }',
  ].join('\n');
  const result = spawnTrustedWindowsPowerShell(
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      encoding: 'utf8',
      env: minimalWindowsRuntimeEnvironment(process.env),
      windowsHide: true,
      timeout: 20_000,
    },
  );
  return {
    method: 'windows-fileshare-none',
    passed: !result.error && result.status === 0 && String(result.stdout || '').trim() === 'OK',
  };
}

function validateExclusiveDbPreflight(result, label) {
  if (result?.passed !== true || result?.method !== 'windows-fileshare-none') {
    fail(`${label} could not obtain the Windows FileShare.None offline proof.`);
  }
  return { method: result.method, passed: true };
}

function validateAuthorityDatabaseSecurity(context, databasePath, label) {
  const security = context.inspectWindowsPathSecurity(databasePath, {
    label,
    type: 'file',
    requireProtected: true,
  });
  if (
    security?.passed !== true
    || security?.ownerSid !== security?.currentUserSid
    || security?.inheritanceProtected !== true
    || Number(security?.highRiskWritePrincipalCount || 0) !== 0
  ) {
    fail(`${label} Windows ACL/owner proof failed.`);
  }
  return security;
}

const EXCLUSIVE_WINDOW_HELPER_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class S7NativeLaunch {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public UInt32 cb;
    public string lpReserved;
    public string lpDesktop;
    public string lpTitle;
    public UInt32 dwX;
    public UInt32 dwY;
    public UInt32 dwXSize;
    public UInt32 dwYSize;
    public UInt32 dwXCountChars;
    public UInt32 dwYCountChars;
    public UInt32 dwFillAttribute;
    public UInt32 dwFlags;
    public UInt16 wShowWindow;
    public UInt16 cbReserved2;
    public IntPtr lpReserved2;
    public IntPtr hStdInput;
    public IntPtr hStdOutput;
    public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION {
    public IntPtr hProcess;
    public IntPtr hThread;
    public UInt32 dwProcessId;
    public UInt32 dwThreadId;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct FILETIME {
    public UInt32 Low;
    public UInt32 High;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct BY_HANDLE_FILE_INFORMATION {
    public UInt32 FileAttributes;
    public FILETIME CreationTime;
    public FILETIME LastAccessTime;
    public FILETIME LastWriteTime;
    public UInt32 VolumeSerialNumber;
    public UInt32 FileSizeHigh;
    public UInt32 FileSizeLow;
    public UInt32 NumberOfLinks;
    public UInt32 FileIndexHigh;
    public UInt32 FileIndexLow;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CreateProcessW(
    string applicationName,
    StringBuilder commandLine,
    IntPtr processAttributes,
    IntPtr threadAttributes,
    bool inheritHandles,
    UInt32 creationFlags,
    IntPtr environment,
    string currentDirectory,
    ref STARTUPINFO startupInfo,
    out PROCESS_INFORMATION processInformation
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern UInt32 ResumeThread(IntPtr threadHandle);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool QueryFullProcessImageNameW(
    IntPtr processHandle,
    UInt32 flags,
    StringBuilder executablePath,
    ref UInt32 size
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern UInt32 WaitForSingleObject(IntPtr handle, UInt32 milliseconds);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetExitCodeProcess(IntPtr processHandle, out UInt32 exitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetFileInformationByHandle(
    SafeFileHandle fileHandle,
    out BY_HANDLE_FILE_INFORMATION information
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool CloseHandle(IntPtr handle);
}
'@

function Write-S7Proof([System.Collections.IDictionary]$proof) {
  [Console]::Out.WriteLine(($proof | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Decode-S7Value([string]$name) {
  $encoded=[Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($encoded)) { throw "missing-$name" }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
}

function Get-S7ProcessImagePath([IntPtr]$processHandle) {
  $capacity=[uint32]32768
  $buffer=New-Object System.Text.StringBuilder ([int]$capacity)
  $size=$capacity
  if (![S7NativeLaunch]::QueryFullProcessImageNameW(
    $processHandle,
    [uint32]0,
    $buffer,
    [ref]$size
  )) {
    throw ('QueryFullProcessImageNameW-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  return $buffer.ToString()
}

function Get-S7FileIdentity([System.IO.FileStream]$stream) {
  $information=New-Object S7NativeLaunch+BY_HANDLE_FILE_INFORMATION
  if (![S7NativeLaunch]::GetFileInformationByHandle(
    $stream.SafeFileHandle,
    [ref]$information
  )) {
    throw ('GetFileInformationByHandle-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $fileId=([uint64]$information.FileIndexHigh -shl 32) -bor [uint64]$information.FileIndexLow
  return [ordered]@{
    deviceId=[string][uint64]$information.VolumeSerialNumber
    fileId=[string]$fileId
    hardLinkCount=[int]$information.NumberOfLinks
  }
}

function Get-S7StreamArtifact(
  [System.IO.FileStream]$fileStream,
  [string]$filePath,
  [string]$knownSha256=$null,
  [bool]$allowServicingLinks=$false
) {
  $identity=Get-S7FileIdentity $fileStream
  if (
    (!$allowServicingLinks -and [int]$identity.hardLinkCount -ne 1) -or
    ($allowServicingLinks -and (
      [int]$identity.hardLinkCount -lt 1 -or
      [int]$identity.hardLinkCount -gt ${TRUSTED_POWERSHELL_MAX_HARDLINKS}
    ))
  ) { throw 'gate-artifact-hard-link-count-invalid' }
  $hash=$knownSha256
  if ([string]::IsNullOrWhiteSpace($hash)) {
    $position=$fileStream.Position
    $fileStream.Position=0
    $sha=[System.Security.Cryptography.SHA256]::Create()
    try {
      $hash=([BitConverter]::ToString($sha.ComputeHash($fileStream))).Replace('-','')
    } finally {
      $sha.Dispose()
      $fileStream.Position=$position
    }
  }
  return [ordered]@{
    realPath=[System.IO.Path]::GetFullPath($filePath)
    sha256=$hash
    sizeBytes=[int64]$fileStream.Length
    identity=$identity
  }
}

function Get-S7TrustedShellArtifact([string]$filePath) {
  $fullPath=[System.IO.Path]::GetFullPath($filePath)
  $fileInfo=[System.IO.FileInfo]::new($fullPath)
  if (
    !$fileInfo.Exists -or
    ($fileInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0
  ) { throw 'trusted-shell-file-invalid' }
  $fileStream=[System.IO.File]::Open(
    $fullPath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    ([System.IO.FileShare]::Read -bor [System.IO.FileShare]::Delete)
  )
  try {
    return Get-S7StreamArtifact $fileStream $fullPath $null $true
  } finally {
    $fileStream.Dispose()
  }
}

function Get-S7FileArtifact([string]$filePath) {
  $fullPath=[System.IO.Path]::GetFullPath($filePath)
  $fileInfo=[System.IO.FileInfo]::new($fullPath)
  if (!$fileInfo.Exists) { throw 'gate-artifact-missing' }
  if (($fileInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'gate-artifact-reparse-point'
  }
  $fileStream=[System.IO.File]::Open(
    $fullPath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    ([System.IO.FileShare]::Read -bor [System.IO.FileShare]::Delete)
  )
  try {
    return Get-S7StreamArtifact $fileStream $fullPath
  } finally {
    $fileStream.Dispose()
  }
}

function Protect-S7Path([string]$targetPath,[bool]$directory) {
  $current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $system=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $admins=[System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  if ($directory) {
    $acl=New-Object System.Security.AccessControl.DirectorySecurity
    $inherit=(
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    )
  } else {
    $acl=New-Object System.Security.AccessControl.FileSecurity
    $inherit=[System.Security.AccessControl.InheritanceFlags]::None
  }
  $acl.SetOwner($current)
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($sid in @($current,$system,$admins)) {
    $rule=[System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inherit,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  if ($directory) {
    [System.IO.Directory]::SetAccessControl($targetPath,$acl)
  } else {
    [System.IO.File]::SetAccessControl($targetPath,$acl)
  }
}

function Assert-S7PathSecurity([string]$targetPath,[bool]$directory) {
  $current=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if ($directory) {
    $info=[System.IO.DirectoryInfo]::new($targetPath)
    if (!$info.Exists) { throw 'gate-directory-missing' }
    if (($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'gate-directory-reparse-point'
    }
    $acl=[System.IO.Directory]::GetAccessControl($targetPath)
  } else {
    $info=[System.IO.FileInfo]::new($targetPath)
    if (!$info.Exists) { throw 'gate-file-missing' }
    if (($info.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'gate-file-reparse-point'
    }
    $acl=[System.IO.File]::GetAccessControl($targetPath)
  }
  if (
    $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $current -or
    !$acl.AreAccessRulesProtected
  ) {
    throw 'gate-path-owner-or-inheritance-invalid'
  }
  $rules=@($acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  ))
  $required=@($current,'S-1-5-18','S-1-5-32-544') | Sort-Object -Unique
  $seen=@()
  foreach ($rule in $rules) {
    $sid=$rule.IdentityReference.Value
    $seen += $sid
    if (
      $rule.IsInherited -or
      $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
      $required -notcontains $sid -or
      (([int64]$rule.FileSystemRights -band 2032127) -ne 2032127)
    ) {
      throw 'gate-path-acl-rule-invalid'
    }
  }
  $seen=@($seen | Sort-Object -Unique)
  if ($seen.Count -ne $required.Count) { throw 'gate-path-principal-set-invalid' }
  for ($index=0; $index -lt $required.Count; $index++) {
    if ($seen[$index] -ne $required[$index]) { throw 'gate-path-principal-set-invalid' }
  }
}

function Write-S7ExclusiveJson([string]$targetPath,[object]$value) {
  $json=$value | ConvertTo-Json -Compress -Depth 20
  $bytes=(New-Object System.Text.UTF8Encoding($false)).GetBytes($json + [Environment]::NewLine)
  $fileStream=[System.IO.File]::Open(
    $targetPath,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  try {
    $fileStream.Write($bytes,0,$bytes.Length)
    $fileStream.Flush($true)
  } finally {
    $fileStream.Dispose()
  }
  Protect-S7Path $targetPath $false
  Assert-S7PathSecurity $targetPath $false
  return Get-S7FileArtifact $targetPath
}

function Assert-S7ArtifactBinding([object]$actual,[object]$expected,[string]$label) {
  if (
    $null -eq $expected -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$actual.realPath),
      [System.IO.Path]::GetFullPath([string]$expected.realPath)
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [string]$actual.sha256,
      [string]$expected.sha256
    ) -or
    [int64]$actual.sizeBytes -ne [int64]$expected.sizeBytes -or
    [string]$actual.identity.deviceId -ne [string]$expected.identity.deviceId -or
    [string]$actual.identity.fileId -ne [string]$expected.identity.fileId -or
    [int]$actual.identity.hardLinkCount -ne 1 -or
    [int]$expected.identity.hardLinkCount -ne 1
  ) {
    throw ($label + '-binding-mismatch')
  }
}

function Assert-S7TrustedShellBinding([object]$expected) {
  $trustedShellPath=[System.IO.Path]::GetFullPath(
    (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
  )
  $actual=Get-S7TrustedShellArtifact $trustedShellPath
  if (
    $null -eq $expected -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [string]$actual.realPath,
      [System.IO.Path]::GetFullPath([string]$expected.realPath)
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [string]$actual.sha256,
      [string]$expected.sha256
    ) -or
    [int64]$actual.sizeBytes -ne [int64]$expected.sizeBytes -or
    [string]$actual.identity.deviceId -ne [string]$expected.identity.deviceId -or
    [string]$actual.identity.fileId -ne [string]$expected.identity.fileId -or
    [int]$actual.identity.hardLinkCount -ne [int]$expected.identity.hardLinkCount
  ) { throw 'trusted-shell-artifact-binding-mismatch' }
  $signature=Get-AuthenticodeSignature -LiteralPath $trustedShellPath
  $version=[Diagnostics.FileVersionInfo]::GetVersionInfo($trustedShellPath)
  if (
    $signature.Status.ToString() -ne 'Valid' -or
    [string]$signature.SignerCertificate.Subject -ne [string]$expected.signature.subject -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [string]$signature.SignerCertificate.Thumbprint,
      [string]$expected.signature.thumbprint
    ) -or
    [string]$version.CompanyName -ne [string]$expected.version.companyName -or
    [string]$version.FileVersion -ne [string]$expected.version.fileVersion -or
    [string]$version.OriginalFilename -ne [string]$expected.version.originalFilename
  ) { throw 'trusted-shell-signature-version-binding-mismatch' }
  $acl=[System.IO.File]::GetAccessControl($trustedShellPath)
  $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if (
    @(
      '${TRUSTED_INSTALLER_SID}',
      'S-1-5-18'
    ) -notcontains $owner -or
    !$acl.AreAccessRulesProtected
  ) { throw 'trusted-shell-owner-acl-invalid' }
  return $actual
}

$phase='decode-input'
$databasePath=Decode-S7Value 'AAO_S7_EXCLUSIVE_DB_B64'
$executablePath=Decode-S7Value 'AAO_S7_EXECUTABLE_B64'
$workingDirectory=Decode-S7Value 'AAO_S7_WORKING_DIRECTORY_B64'
[Environment]::SetEnvironmentVariable('AAO_S7_EXCLUSIVE_DB_B64',$null)
[Environment]::SetEnvironmentVariable('AAO_S7_EXECUTABLE_B64',$null)
[Environment]::SetEnvironmentVariable('AAO_S7_WORKING_DIRECTORY_B64',$null)

$stream=$null
$databaseHandleAcquired=$false
$databaseHandleReleased=$false
$processInformation=New-Object S7NativeLaunch+PROCESS_INFORMATION
$processCreated=$false
$processResumed=$false
try {
  $phase='open-exclusive-database'
  $stream=[System.IO.File]::Open(
    $databasePath,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::None
  )
  $databaseHandleAcquired=$true
  $sha=[System.Security.Cryptography.SHA256]::Create()
  try {
    $hash=([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')
  } finally {
    $sha.Dispose()
  }
  $databaseArtifact=Get-S7StreamArtifact $stream $stream.Name $hash
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='READY'
    helperPid=[int]$PID
    path=$stream.Name
    sha256=$hash
    sizeBytes=[int64]$stream.Length
    openedAt=(Get-Date).ToUniversalTime().ToString('o')
    databaseHandleExclusive=$true
  })

  $phase='await-create-command'
  $request=[Console]::In.ReadLine()
  $createPrefix='${EXCLUSIVE_WINDOW_CREATE_COMMAND} '
  if (
    [string]::IsNullOrWhiteSpace($request) -or
    !$request.StartsWith($createPrefix,[StringComparison]::Ordinal)
  ) {
    throw 'exclusive-window-create-command-not-confirmed'
  }

  $phase='validate-startup-gate-plan'
  $encodedPlan=$request.Substring($createPrefix.Length)
  try {
    $planJson=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedPlan))
    $gatePlan=$planJson | ConvertFrom-Json
  } catch {
    throw 'startup-gate-plan-invalid'
  }
  $activeDocument=$gatePlan.activeDocument
  $gateDirectory=[System.IO.Path]::GetFullPath([string]$gatePlan.gateDirectory)
  $activePath=[System.IO.Path]::GetFullPath([string]$gatePlan.activePath)
  $boundPath=[System.IO.Path]::GetFullPath([string]$gatePlan.boundPath)
  $handoffReadyPath=[System.IO.Path]::GetFullPath([string]$gatePlan.handoffReadyPath)
  $handoffReleasedPath=[System.IO.Path]::GetFullPath([string]$gatePlan.handoffReleasedPath)
  $admissionPath=[System.IO.Path]::GetFullPath([string]$gatePlan.admissionPath)
  $closedPath=[System.IO.Path]::GetFullPath([string]$gatePlan.closedPath)
  $finalizedPath=[System.IO.Path]::GetFullPath([string]$gatePlan.finalizedPath)
  if (
    $null -eq $activeDocument -or
    $activeDocument.kind -ne '${STARTUP_GATE_ACTIVE_KIND}' -or
    $activeDocument.schemaVersion -ne '${STARTUP_GATE_ACTIVE_SCHEMA}' -or
    $activeDocument.status -ne 'ACTIVE_AWAITING_BOUND_CHILD' -or
    [string]$activeDocument.gateId -ne [string]$gatePlan.gateId -or
    [string]$activeDocument.invocationId -ne [string]$gatePlan.invocationId -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.active),
      $activePath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.bound),
      $boundPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.handoffReady),
      $handoffReadyPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.handoffReleased),
      $handoffReleasedPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.admission),
      $admissionPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.closed),
      $closedPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFullPath([string]$activeDocument.paths.finalized),
      $finalizedPath
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetDirectoryName($activePath),
      $gateDirectory
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($activePath),
      '${STARTUP_GATE_ACTIVE_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($boundPath),
      '${STARTUP_GATE_BOUND_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($handoffReadyPath),
      '${STARTUP_GATE_HANDOFF_READY_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($handoffReleasedPath),
      '${STARTUP_GATE_HANDOFF_RELEASED_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($admissionPath),
      '${STARTUP_GATE_ADMISSION_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($closedPath),
      '${STARTUP_GATE_CLOSED_FILE}'
    ) -or
    ![StringComparer]::OrdinalIgnoreCase.Equals(
      [System.IO.Path]::GetFileName($finalizedPath),
      '${STARTUP_GATE_FINALIZED_FILE}'
    ) -or
    [System.IO.File]::Exists($activePath) -or
    [System.IO.File]::Exists($boundPath) -or
    [System.IO.File]::Exists($handoffReadyPath) -or
    [System.IO.File]::Exists($handoffReleasedPath) -or
    [System.IO.File]::Exists($admissionPath) -or
    [System.IO.File]::Exists($closedPath) -or
    [System.IO.File]::Exists($finalizedPath)
  ) {
    throw 'startup-gate-plan-binding-invalid'
  }
  Assert-S7PathSecurity $gateDirectory $true
  $executableArtifact=Get-S7FileArtifact $executablePath
  $mainArtifact=Get-S7FileArtifact ([string]$activeDocument.bindings.package.main.realPath)
  $intentArtifact=Get-S7FileArtifact ([string]$activeDocument.bindings.intent.realPath)
  Assert-S7ArtifactBinding $executableArtifact $activeDocument.bindings.executable 'executable'
  Assert-S7ArtifactBinding $executableArtifact $activeDocument.bindings.package.exe 'package-executable'
  Assert-S7ArtifactBinding $mainArtifact $activeDocument.bindings.package.main 'package-main'
  Assert-S7ArtifactBinding $databaseArtifact $activeDocument.bindings.database 'database'
  Assert-S7ArtifactBinding $intentArtifact $activeDocument.bindings.intent 'intent'
  $trustedShellArtifact=Assert-S7TrustedShellBinding $activeDocument.bindings.shell

  $phase='create-active-startup-gate'
  $activeArtifact=Write-S7ExclusiveJson $activePath $activeDocument
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64',
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($activePath))
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ACTIVE_SHA256',
    [string]$activeArtifact.sha256
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ACTIVE_DEVICE_ID',
    [string]$activeArtifact.identity.deviceId
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ACTIVE_FILE_ID',
    [string]$activeArtifact.identity.fileId
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_GATE_ID',
    [string]$activeDocument.gateId
  )
  [Environment]::SetEnvironmentVariable(
    'AAO_S7_STARTUP_INVOCATION_ID',
    [string]$activeDocument.invocationId
  )

  $phase='create-suspended-process'
  $startupInfo=New-Object S7NativeLaunch+STARTUPINFO
  $startupInfo.cb=[uint32][Runtime.InteropServices.Marshal]::SizeOf(
    [type][S7NativeLaunch+STARTUPINFO]
  )
  $commandLine=New-Object System.Text.StringBuilder ('"' + $executablePath + '"')
  $created=[S7NativeLaunch]::CreateProcessW(
    $executablePath,
    $commandLine,
    [IntPtr]::Zero,
    [IntPtr]::Zero,
    $false,
    [uint32]0x00000004,
    [IntPtr]::Zero,
    $workingDirectory,
    [ref]$startupInfo,
    [ref]$processInformation
  )
  if (!$created) {
    throw ('CreateProcessW-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $processCreated=$true
  foreach ($name in @(
    'AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64',
    'AAO_S7_STARTUP_GATE_ACTIVE_SHA256',
    'AAO_S7_STARTUP_GATE_ACTIVE_DEVICE_ID',
    'AAO_S7_STARTUP_GATE_ACTIVE_FILE_ID',
    'AAO_S7_STARTUP_GATE_ID',
    'AAO_S7_STARTUP_INVOCATION_ID'
  )) {
    [Environment]::SetEnvironmentVariable($name,$null)
  }
  $queriedExecutablePath=Get-S7ProcessImagePath $processInformation.hProcess
  if (![StringComparer]::OrdinalIgnoreCase.Equals(
    [System.IO.Path]::GetFullPath($queriedExecutablePath),
    [System.IO.Path]::GetFullPath($executablePath)
  )) {
    throw 'created-process-image-mismatch'
  }
  $phase='bind-suspended-child-startup-gate'
  $boundAt=(Get-Date).ToUniversalTime().ToString('o')
  $boundDocument=[ordered]@{
    kind='${STARTUP_GATE_BOUND_KIND}'
    schemaVersion='${STARTUP_GATE_BOUND_SCHEMA}'
    status='BOUND_SUSPENDED'
    gateId=[string]$activeDocument.gateId
    invocationId=[string]$activeDocument.invocationId
    boundAt=$boundAt
    pid=[int]$processInformation.dwProcessId
    threadId=[int]$processInformation.dwThreadId
    activeGate=$activeArtifact
    bindings=$activeDocument.bindings
  }
  $boundArtifact=Write-S7ExclusiveJson $boundPath $boundDocument
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='SPAWNED'
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    threadId=[int]$processInformation.dwThreadId
    executablePath=$executablePath
    queriedExecutablePath=$queriedExecutablePath
    processImageQueryPassed=$true
    createdSuspended=$true
    databaseHandleExclusive=$true
    createdAt=(Get-Date).ToUniversalTime().ToString('o')
    startupGateId=[string]$activeDocument.gateId
    startupGateInvocationId=[string]$activeDocument.invocationId
    startupGateActivePath=$activeArtifact.realPath
    startupGateActiveSha256=$activeArtifact.sha256
    startupGateActiveDeviceId=$activeArtifact.identity.deviceId
    startupGateActiveFileId=$activeArtifact.identity.fileId
    startupGateBoundPath=$boundArtifact.realPath
    startupGateBoundSha256=$boundArtifact.sha256
    startupGateBoundDeviceId=$boundArtifact.identity.deviceId
    startupGateBoundFileId=$boundArtifact.identity.fileId
    startupGateHandoffReadyPath=$handoffReadyPath
    startupGateHandoffReleasedPath=$handoffReleasedPath
    startupGateAdmissionPath=$admissionPath
    startupGateClosedPath=$closedPath
    startupGateFinalizedPath=$finalizedPath
    trustedShellPath=$trustedShellArtifact.realPath
    trustedShellSha256=$trustedShellArtifact.sha256
    trustedShellDeviceId=$trustedShellArtifact.identity.deviceId
    trustedShellFileId=$trustedShellArtifact.identity.fileId
    trustedShellHardLinkCount=$trustedShellArtifact.identity.hardLinkCount
    startupGateWindowsSecurityPassed=$true
  })

  $phase='await-release-command'
  $request=[Console]::In.ReadLine()
  if ($request -ne '${EXCLUSIVE_WINDOW_RELEASE_COMMAND}') {
    throw 'exclusive-window-release-command-not-confirmed'
  }

  $phase='final-same-name-process-inventory'
  $expectedName=[System.IO.Path]::GetFileName($executablePath)
  $escapedName=$expectedName.Replace("'","''")
  $matching=@(
    Get-CimInstance Win32_Process -Filter ("Name='" + $escapedName + "'") |
      Select-Object ProcessId
  )
  if ($matching.Count -ne 1) {
    throw ('final-same-name-process-count-' + $matching.Count)
  }
  $candidate=$matching[0]
  if (
    [int]$candidate.ProcessId -ne [int]$processInformation.dwProcessId
  ) {
    throw 'final-same-name-process-identity-mismatch'
  }
  $finalQueriedExecutablePath=Get-S7ProcessImagePath $processInformation.hProcess
  if (![StringComparer]::OrdinalIgnoreCase.Equals(
    [System.IO.Path]::GetFullPath($finalQueriedExecutablePath),
    [System.IO.Path]::GetFullPath($executablePath)
  )) {
    throw 'final-process-image-mismatch'
  }
  $finalInventoryAt=(Get-Date).ToUniversalTime().ToString('o')

  $phase='resume-child-await-main-handoff'
  $resumeResult=[S7NativeLaunch]::ResumeThread($processInformation.hThread)
  if ($resumeResult -eq [uint32]::MaxValue) {
    throw ('ResumeThread-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  $processResumed=$true
  $actualResumedAt=(Get-Date).ToUniversalTime().ToString('o')
  $handoffTimer=[Diagnostics.Stopwatch]::StartNew()
  $handoffReadyArtifact=$null
  while (
    $null -eq $handoffReadyArtifact -and
    $handoffTimer.ElapsedMilliseconds -lt 45000
  ) {
    if ([System.IO.File]::Exists($handoffReadyPath)) {
      try {
        Assert-S7PathSecurity $handoffReadyPath $false
        $handoffReadyArtifact=Get-S7FileArtifact $handoffReadyPath
      } catch {
        $handoffReadyArtifact=$null
      }
    }
    if ($null -eq $handoffReadyArtifact) {
      Start-Sleep -Milliseconds 25
    }
  }
  $handoffTimer.Stop()
  if ($null -eq $handoffReadyArtifact) {
    throw 'main-handoff-ready-not-secure-before-timeout'
  }
  $phase='validate-main-handoff-ready'
  try {
    $handoffReady=[System.IO.File]::ReadAllText(
      $handoffReadyPath,
      (New-Object System.Text.UTF8Encoding($false))
    ) | ConvertFrom-Json
  } catch {
    throw 'main-handoff-ready-invalid-json'
  }
  if (
    $handoffReady.kind -ne '${STARTUP_GATE_HANDOFF_READY_KIND}' -or
    $handoffReady.schemaVersion -ne '${STARTUP_GATE_HANDOFF_READY_SCHEMA}' -or
    $handoffReady.status -ne 'READY_FOR_DB_HANDOFF' -or
    [int]$handoffReady.pid -ne [int]$processInformation.dwProcessId -or
    [string]$handoffReady.gateId -ne [string]$activeDocument.gateId -or
    [string]$handoffReady.invocationId -ne [string]$activeDocument.invocationId -or
    $handoffReady.singleInstanceLockAcquired -ne $true
  ) {
    throw 'main-handoff-ready-binding-invalid'
  }
  Assert-S7ArtifactBinding $activeArtifact $handoffReady.activeGate 'handoff-ready-active'
  Assert-S7ArtifactBinding $boundArtifact $handoffReady.boundGate 'handoff-ready-bound'
  Assert-S7ArtifactBinding $executableArtifact $handoffReady.executable 'handoff-ready-executable'
  Assert-S7ArtifactBinding $mainArtifact $handoffReady.main 'handoff-ready-main'
  Assert-S7ArtifactBinding $intentArtifact $handoffReady.intent 'handoff-ready-intent'
  [void](Assert-S7TrustedShellBinding $handoffReady.shell)
  if (
    [string]$handoffReady.package.appContent.sha256 -ne
      [string]$activeDocument.bindings.package.appContent.sha256 -or
    [int]$handoffReady.package.appContent.fileCount -ne
      [int]$activeDocument.bindings.package.appContent.fileCount -or
    [int64]$handoffReady.package.appContent.sizeBytes -ne
      [int64]$activeDocument.bindings.package.appContent.sizeBytes
  ) {
    throw 'main-handoff-ready-package-binding-invalid'
  }

  $phase='release-database-handoff'
  $stream.Dispose()
  $stream=$null
  $databaseHandleReleased=$true
  $releasedAt=(Get-Date).ToUniversalTime().ToString('o')
  $handoffReleasedDocument=[ordered]@{
    kind='${STARTUP_GATE_HANDOFF_RELEASED_KIND}'
    schemaVersion='${STARTUP_GATE_HANDOFF_RELEASED_SCHEMA}'
    status='DB_HANDLE_RELEASED'
    releasedAt=$releasedAt
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    gateId=[string]$activeDocument.gateId
    invocationId=[string]$activeDocument.invocationId
    activeGate=$activeArtifact
    boundGate=$boundArtifact
    handoffReady=$handoffReadyArtifact
    database=$databaseArtifact
    shell=$activeDocument.bindings.shell
  }
  $handoffReleasedArtifact=Write-S7ExclusiveJson $handoffReleasedPath $handoffReleasedDocument
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='RESUMED'
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    releasedAt=$releasedAt
    resumedAt=$actualResumedAt
    databaseHandleExclusive=$false
    resumeResult=[uint32]$resumeResult
    finalSameNameInventoryPassed=$true
    finalSameNameProcessCount=[int]$matching.Count
    finalSameNameInventoryAt=$finalInventoryAt
    finalQueriedExecutablePath=$finalQueriedExecutablePath
    finalProcessImageQueryPassed=$true
    startupGateId=[string]$activeDocument.gateId
    startupGateInvocationId=[string]$activeDocument.invocationId
    startupGateActiveSha256=$activeArtifact.sha256
    startupGateBoundSha256=$boundArtifact.sha256
    startupGateHandoffReadyPath=$handoffReadyArtifact.realPath
    startupGateHandoffReadySha256=$handoffReadyArtifact.sha256
    startupGateHandoffReadyDeviceId=$handoffReadyArtifact.identity.deviceId
    startupGateHandoffReadyFileId=$handoffReadyArtifact.identity.fileId
    startupGateHandoffReleasedPath=$handoffReleasedArtifact.realPath
    startupGateHandoffReleasedSha256=$handoffReleasedArtifact.sha256
    startupGateHandoffReleasedDeviceId=$handoffReleasedArtifact.identity.deviceId
    startupGateHandoffReleasedFileId=$handoffReleasedArtifact.identity.fileId
    trustedShellSha256=$trustedShellArtifact.sha256
  })

  $phase='wait-for-process-close'
  $waitResult=[S7NativeLaunch]::WaitForSingleObject(
    $processInformation.hProcess,
    [uint32]::MaxValue
  )
  if ($waitResult -ne 0) {
    throw ('WaitForSingleObject-failed-' + $waitResult)
  }
  $exitCode=[uint32]0
  if (![S7NativeLaunch]::GetExitCodeProcess($processInformation.hProcess,[ref]$exitCode)) {
    throw ('GetExitCodeProcess-failed-' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  if ($exitCode -ne 0) {
    $phase='child-exit-failed-before-closed-receipt'
    throw ('approved-child-exit-code-' + $exitCode)
  }

  $phase='validate-main-admission-receipt'
  Assert-S7PathSecurity $admissionPath $false
  $admissionArtifact=Get-S7FileArtifact $admissionPath
  try {
    $admission=[System.IO.File]::ReadAllText(
      $admissionPath,
      (New-Object System.Text.UTF8Encoding($false))
    ) | ConvertFrom-Json
  } catch {
    throw 'main-admission-receipt-invalid-json'
  }
  if (
    $admission.kind -ne '${STARTUP_GATE_ADMISSION_KIND}' -or
    $admission.schemaVersion -ne '${STARTUP_GATE_ADMISSION_SCHEMA}' -or
    $admission.status -ne 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK' -or
    [int]$admission.pid -ne [int]$processInformation.dwProcessId -or
    [string]$admission.gateId -ne [string]$activeDocument.gateId -or
    [string]$admission.invocationId -ne [string]$activeDocument.invocationId -or
    $admission.singleInstanceLockAcquired -ne $true
  ) {
    throw 'main-admission-receipt-binding-invalid'
  }
  Assert-S7ArtifactBinding $activeArtifact $admission.activeGate 'admission-active-gate'
  Assert-S7ArtifactBinding $boundArtifact $admission.boundGate 'admission-bound-gate'
  Assert-S7ArtifactBinding $handoffReadyArtifact $admission.handoffReady 'admission-ready'
  Assert-S7ArtifactBinding $handoffReleasedArtifact $admission.handoffReleased 'admission-released'
  Assert-S7ArtifactBinding $executableArtifact $admission.executable 'admission-executable'
  Assert-S7ArtifactBinding $mainArtifact $admission.main 'admission-main'
  Assert-S7ArtifactBinding $databaseArtifact $admission.database 'admission-database'
  Assert-S7ArtifactBinding $intentArtifact $admission.intent 'admission-intent'
  [void](Assert-S7TrustedShellBinding $admission.shell)
  if (
    $admission.sqliteTakeover.fileMustExist -ne $true -or
    [string]$admission.sqliteTakeover.lockingMode -ne 'exclusive' -or
    [string]$admission.sqliteTakeover.beginMode -ne 'exclusive' -or
    $admission.sqliteTakeover.transactionActive -ne $true -or
    $admission.sqliteTakeover.sameConnectionRequiredForMigration -ne $true -or
    [int]$admission.sqliteTakeover.schemaVersionBefore -ne 0
  ) {
    throw 'main-admission-sqlite-takeover-invalid'
  }
  Assert-S7PathSecurity $databasePath $false
  $databaseAfterClose=Get-S7FileArtifact $databasePath

  $phase='write-closed-receipt'
  $closedAt=(Get-Date).ToUniversalTime().ToString('o')
  $closedDocument=[ordered]@{
    kind='${STARTUP_GATE_CLOSED_KIND}'
    schemaVersion='${STARTUP_GATE_CLOSED_SCHEMA}'
    status='CLOSED_AFTER_GUARDED_MIGRATION'
    closedAt=$closedAt
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    exitCode=[uint32]$exitCode
    gateId=[string]$activeDocument.gateId
    invocationId=[string]$activeDocument.invocationId
    activeGate=$activeArtifact
    boundGate=$boundArtifact
    handoffReady=$handoffReadyArtifact
    handoffReleased=$handoffReleasedArtifact
    admission=$admissionArtifact
    databaseAfterClose=$databaseAfterClose
    shell=$activeDocument.bindings.shell
  }
  $closedArtifact=Write-S7ExclusiveJson $closedPath $closedDocument
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='CLOSED'
    helperPid=[int]$PID
    pid=[int]$processInformation.dwProcessId
    exitCode=[uint32]$exitCode
    signal=$null
    closedAt=$closedAt
    databaseHandleExclusive=$false
    startupGateId=[string]$activeDocument.gateId
    startupGateInvocationId=[string]$activeDocument.invocationId
    startupGateActivePath=$activeArtifact.realPath
    startupGateActiveSha256=$activeArtifact.sha256
    startupGateActiveDeviceId=$activeArtifact.identity.deviceId
    startupGateActiveFileId=$activeArtifact.identity.fileId
    startupGateBoundPath=$boundArtifact.realPath
    startupGateBoundSha256=$boundArtifact.sha256
    startupGateBoundDeviceId=$boundArtifact.identity.deviceId
    startupGateBoundFileId=$boundArtifact.identity.fileId
    startupGateHandoffReadyPath=$handoffReadyArtifact.realPath
    startupGateHandoffReadySha256=$handoffReadyArtifact.sha256
    startupGateHandoffReadyDeviceId=$handoffReadyArtifact.identity.deviceId
    startupGateHandoffReadyFileId=$handoffReadyArtifact.identity.fileId
    startupGateHandoffReleasedPath=$handoffReleasedArtifact.realPath
    startupGateHandoffReleasedSha256=$handoffReleasedArtifact.sha256
    startupGateHandoffReleasedDeviceId=$handoffReleasedArtifact.identity.deviceId
    startupGateHandoffReleasedFileId=$handoffReleasedArtifact.identity.fileId
    startupGateAdmissionPath=$admissionArtifact.realPath
    startupGateAdmissionSha256=$admissionArtifact.sha256
    startupGateAdmissionDeviceId=$admissionArtifact.identity.deviceId
    startupGateAdmissionFileId=$admissionArtifact.identity.fileId
    startupGateClosedPath=$closedArtifact.realPath
    startupGateClosedSha256=$closedArtifact.sha256
    startupGateClosedDeviceId=$closedArtifact.identity.deviceId
    startupGateClosedFileId=$closedArtifact.identity.fileId
    startupGateAdmissionVerified=$true
    databaseAfterCloseSha256=$databaseAfterClose.sha256
    trustedShellSha256=$trustedShellArtifact.sha256
    startupGateWindowsSecurityPassed=$true
  })
} catch {
  $errorPid=$null
  if ($processCreated) { $errorPid=[int]$processInformation.dwProcessId }
  $releaseState='NOT_RELEASED'
  if ($databaseHandleReleased) { $releaseState='RELEASED' }
  Write-S7Proof ([ordered]@{
    protocol='${EXCLUSIVE_WINDOW_PROTOCOL}'
    status='ERROR'
    helperPid=[int]$PID
    pid=$errorPid
    phase=$phase
    processCreated=$processCreated
    processResumed=$processResumed
    databaseHandleExclusive=($null -ne $stream)
    databaseHandleAcquired=$databaseHandleAcquired
    databaseHandleReleased=$databaseHandleReleased
    releaseState=$releaseState
    errorType=$_.Exception.GetType().Name
    observedAt=(Get-Date).ToUniversalTime().ToString('o')
  })
  exit 1
} finally {
  foreach ($name in @(
    'AAO_S7_STARTUP_GATE_ACTIVE_PATH_B64',
    'AAO_S7_STARTUP_GATE_ACTIVE_SHA256',
    'AAO_S7_STARTUP_GATE_ACTIVE_DEVICE_ID',
    'AAO_S7_STARTUP_GATE_ACTIVE_FILE_ID',
    'AAO_S7_STARTUP_GATE_ID',
    'AAO_S7_STARTUP_INVOCATION_ID'
  )) {
    [Environment]::SetEnvironmentVariable($name,$null)
  }
  if ($null -ne $stream) { $stream.Dispose() }
  if ($processCreated) {
    if ($processInformation.hThread -ne [IntPtr]::Zero) {
      [void][S7NativeLaunch]::CloseHandle($processInformation.hThread)
    }
    if ($processInformation.hProcess -ne [IntPtr]::Zero) {
      [void][S7NativeLaunch]::CloseHandle($processInformation.hProcess)
    }
  }
}
`;

const EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP = (() => {
  const compressed = zlib.gzipSync(
    Buffer.from(EXCLUSIVE_WINDOW_HELPER_SCRIPT, 'utf8'),
    { level: 9 },
  ).toString('base64');
  return [
    "$ErrorActionPreference='Stop'",
    `$b=[Convert]::FromBase64String('${compressed}')`,
    '$m=[IO.MemoryStream]::new($b)',
    '$g=[IO.Compression.GZipStream]::new($m,[IO.Compression.CompressionMode]::Decompress)',
    '$r=[IO.StreamReader]::new($g,[Text.Encoding]::UTF8,$true)',
    'try{$s=$r.ReadToEnd()}finally{$r.Dispose();$g.Dispose();$m.Dispose()}',
    '& ([ScriptBlock]::Create($s))',
  ].join(';');
})();

function exclusiveHelperEnvironment(env, databasePath, executablePath, workingDirectory) {
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && !key.includes('\0') && !value.includes('\0')) {
      result[key] = value;
    }
  }
  result.AAO_S7_EXCLUSIVE_DB_B64 = Buffer.from(databasePath, 'utf8').toString('base64');
  result.AAO_S7_EXECUTABLE_B64 = Buffer.from(executablePath, 'utf8').toString('base64');
  result.AAO_S7_WORKING_DIRECTORY_B64 = Buffer.from(workingDirectory, 'utf8').toString('base64');
  return result;
}

function protocolError(message, code, proof = null) {
  const error = new Error(message);
  error.code = code;
  error.proof = proof;
  return error;
}

function createExclusiveProtocolChannel(child) {
  if (
    !child?.stdin
    || !child?.stdout
    || typeof child.stdin.write !== 'function'
    || typeof child.stdout.on !== 'function'
  ) {
    fail('Exclusive-window helper stdio is unavailable.');
  }
  child.stdout.setEncoding?.('utf8');
  let buffer = '';
  let terminal = null;
  const queued = [];
  const waiters = [];
  let closeOutcome = null;
  let resolveClose;
  const closePromise = new Promise((resolve) => {
    resolveClose = resolve;
  });

  const rejectAll = (error) => {
    while (waiters.length) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };
  const deliver = () => {
    while (queued.length && waiters.length) {
      const proof = queued.shift();
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      if (
        proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
        || proof?.status !== waiter.expectedStatus
      ) {
        const message = proof?.status === 'ERROR'
          ? `Exclusive-window helper failed during ${proof?.phase || 'unknown phase'}.`
          : `Exclusive-window helper emitted ${proof?.status || 'invalid proof'} while ${waiter.expectedStatus} was required.`;
        waiter.reject(protocolError(message, 'PROTOCOL_SEQUENCE_MISMATCH', proof));
      } else {
        waiter.resolve(proof);
      }
    }
  };
  const onData = (chunk) => {
    if (terminal) return;
    buffer += String(chunk);
    if (buffer.length > 65_536) {
      terminal = protocolError(
        'Exclusive-window helper proof stream exceeded its bounded payload.',
        'PROTOCOL_PAYLOAD_EXCEEDED',
      );
      rejectAll(terminal);
      return;
    }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const proof = JSON.parse(line);
        if (proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL || typeof proof?.status !== 'string') {
          throw new Error('invalid protocol proof');
        }
        queued.push(proof);
        deliver();
      } catch {
        terminal = protocolError(
          'Exclusive-window helper emitted invalid JSON proof.',
          'PROTOCOL_INVALID_JSON',
        );
        rejectAll(terminal);
        return;
      }
    }
  };
  const finish = (outcome) => {
    if (closeOutcome) return;
    closeOutcome = outcome;
    resolveClose(outcome);
    if (!terminal && outcome.outcome !== 'close') {
      terminal = protocolError(
        'Exclusive-window helper process failed.',
        'PROTOCOL_PROCESS_ERROR',
      );
    } else if (!terminal && waiters.length) {
      terminal = protocolError(
        'Exclusive-window helper closed before the required proof.',
        'PROTOCOL_CLOSED_EARLY',
      );
    }
    if (terminal) rejectAll(terminal);
  };
  child.stdout.on('data', onData);
  child.once('error', () => finish({ outcome: 'process-error' }));
  child.once('close', (code, signal) => finish({ outcome: 'close', code, signal }));

  return {
    wait(expectedStatus, timeoutMs) {
      if (terminal) return Promise.reject(terminal);
      if (closeOutcome && queued.length === 0) {
        return Promise.reject(protocolError(
          `Exclusive-window helper already closed before ${expectedStatus}.`,
          'PROTOCOL_CLOSED_EARLY',
        ));
      }
      return new Promise((resolve, reject) => {
        const waiter = {
          expectedStatus,
          resolve,
          reject,
          timer: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            reject(protocolError(
              `Exclusive-window helper ${expectedStatus} proof timed out.`,
              'PROTOCOL_TIMEOUT',
            ));
          }, timeoutMs),
        };
        waiters.push(waiter);
        deliver();
      });
    },
    send(command) {
      if (terminal || closeOutcome || child.stdin.destroyed) {
        fail('Exclusive-window helper is unavailable for a protocol command.');
      }
      child.stdin.write(`${command}\n`);
    },
    closePromise,
    snapshot() {
      return {
        queuedProofs: queued.slice(-4).map((proof) => ({
          protocol: typeof proof?.protocol === 'string' ? proof.protocol : null,
          status: typeof proof?.status === 'string' ? proof.status : null,
          helperPid: Number.isInteger(Number(proof?.helperPid))
            ? Number(proof.helperPid)
            : null,
          pid: Number.isInteger(Number(proof?.pid)) ? Number(proof.pid) : null,
          phase: typeof proof?.phase === 'string' ? proof.phase.slice(0, 120) : null,
        })),
        partialText: buffer.slice(-1024),
        partialBytes: Buffer.byteLength(buffer, 'utf8'),
        terminalCode: terminal?.code || null,
        closeOutcome,
      };
    },
  };
}

function closeExclusiveHelperInput(child) {
  let helperInputState = 'UNKNOWN';
  let helperInputCloseError = null;
  try {
    if (!child?.stdin) {
      helperInputState = 'UNKNOWN';
    } else if (child.stdin.destroyed || child.stdin.writableEnded) {
      helperInputState = 'ALREADY_CLOSED';
    } else {
      child.stdin.end();
      helperInputState = 'CLOSE_REQUESTED';
    }
  } catch (error) {
    helperInputState = 'CLOSE_FAILED';
    helperInputCloseError = boundedError(error);
  }
  child?.unref?.();
  child?.stdin?.unref?.();
  child?.stdout?.unref?.();
  return {
    helperInputState,
    helperInputCloseError,
    helperProcessUnrefRequested: Boolean(child?.unref),
    helperStdinUnrefRequested: Boolean(child?.stdin?.unref),
    helperStdoutUnrefRequested: Boolean(child?.stdout?.unref),
  };
}

async function defaultAcquireLaunchExclusiveWindow(
  databasePath,
  executablePath,
  targetEnvironment,
  timeoutMs,
) {
  const resolvedDatabase = cleanAbsolute(databasePath, 'Launch-exclusive database');
  const resolvedExecutable = cleanAbsolute(executablePath, 'Launch executable');
  const workingDirectory = path.dirname(resolvedExecutable);
  const trustedPowerShell = resolveTrustedWindowsPowerShell(process.env);
  const child = spawn(
    trustedPowerShell.realPath,
    ['-NoProfile', '-NonInteractive', '-Command', EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP],
    {
      detached: false,
      env: exclusiveHelperEnvironment(
        targetEnvironment,
        resolvedDatabase,
        resolvedExecutable,
        workingDirectory,
      ),
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    },
  );
  const channel = createExclusiveProtocolChannel(child);
  try {
    const proof = await channel.wait('READY', timeoutMs);
    return { child, helperPid: child.pid, proof, channel };
  } catch (error) {
    const cleanup = closeExclusiveHelperInput(child);
    await Promise.race([
      channel.closePromise,
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ outcome: 'timeout' }), 20_000);
        timer.unref?.();
      }),
    ]);
    const originalProof = error?.proof && typeof error.proof === 'object'
      ? error.proof
      : {};
    if (error instanceof Error) {
      error.proof = {
        ...originalProof,
        protocol: originalProof.protocol || EXCLUSIVE_WINDOW_PROTOCOL,
        status: 'ACQUISITION_UNTRUSTED',
        observedProofStatus: typeof originalProof.status === 'string'
          ? originalProof.status.slice(0, 80)
          : null,
        helperPid: Number.isInteger(Number(originalProof.helperPid))
          ? Number(originalProof.helperPid)
          : Number.isInteger(child.pid)
            ? child.pid
            : null,
        phase: originalProof.phase || 'await-ready',
        scriptSha256: sha256(EXCLUSIVE_WINDOW_HELPER_SCRIPT),
        lateProofBuffer: channel.snapshot(),
        helperInputState: cleanup.helperInputState,
        helperInputCloseError: cleanup.helperInputCloseError,
        helperProcessUnrefRequested: cleanup.helperProcessUnrefRequested,
        helperStdinUnrefRequested: cleanup.helperStdinUnrefRequested,
        helperStdoutUnrefRequested: cleanup.helperStdoutUnrefRequested,
      };
    }
    throw error;
  }
}

async function defaultCreateSuspendedPackage(windowHandle, timeoutMs, startupGatePlan) {
  if (!startupGatePlan || typeof startupGatePlan !== 'object') {
    fail('S7 startup gate plan is required before CREATE_SUSPENDED.');
  }
  const encodedPlan = Buffer.from(
    JSON.stringify(startupGatePlan),
    'utf8',
  ).toString('base64');
  const proofPromise = windowHandle.channel.wait('SPAWNED', timeoutMs);
  windowHandle.channel.send(`${EXCLUSIVE_WINDOW_CREATE_COMMAND} ${encodedPlan}`);
  return proofPromise;
}

async function defaultReleaseAndResumePackage(windowHandle, timeoutMs) {
  const proofPromise = windowHandle.channel.wait('RESUMED', timeoutMs);
  windowHandle.channel.send(EXCLUSIVE_WINDOW_RELEASE_COMMAND);
  return proofPromise;
}

async function defaultWaitForManagedPackageClose(windowHandle, timeoutMs) {
  try {
    const proof = await windowHandle.channel.wait('CLOSED', timeoutMs);
    const helperClose = await Promise.race([
      windowHandle.channel.closePromise,
      new Promise((resolve) => {
        const timer = setTimeout(
          () => resolve({ outcome: 'timeout' }),
          DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
    return {
      outcome: 'close',
      code: Number(proof.exitCode),
      signal: proof.signal ?? null,
      closedAt: proof.closedAt,
      proof,
      helperClose,
    };
  } catch (error) {
    if (error?.code === 'PROTOCOL_TIMEOUT') return { outcome: 'timeout' };
    return {
      outcome: 'process-monitor-error',
      errorCode: error?.code || 'PROTOCOL_ERROR',
      errorProof: error?.proof || null,
    };
  }
}

function defaultDetachManagedLaunch(windowHandle) {
  const child = windowHandle?.child;
  const cleanup = closeExclusiveHelperInput(child);
  return {
    detachedFromOperator: true,
    ...cleanup,
    processKillInvoked: false,
    helperPid: Number.isInteger(child?.pid) ? child.pid : null,
  };
}

function defaultAbortUnlaunchedExclusiveWindow(windowHandle) {
  const cleanup = closeExclusiveHelperInput(windowHandle?.child);
  return {
    ...cleanup,
    processKillInvoked: false,
    packageProcessCreated: false,
  };
}

function validateProtocolTimestamp(value, label, context, minimumMs = null) {
  const parsed = Date.parse(value || '');
  const current = context.now();
  if (!(current instanceof Date) || !Number.isFinite(current.valueOf())) {
    fail('Clock returned an invalid date.');
  }
  if (
    !Number.isFinite(parsed)
    || parsed > current.valueOf() + MAX_PROTOCOL_CLOCK_SKEW_MS
    || (Number.isFinite(minimumMs) && parsed < minimumMs)
  ) {
    fail(`${label} is invalid, out of order, or future-dated.`);
  }
  return {
    milliseconds: parsed,
    iso: new Date(parsed).toISOString(),
  };
}

function validateLaunchExclusiveReady(windowHandle, db, context) {
  const proof = windowHandle?.proof;
  const helperPid = Number(windowHandle?.helperPid);
  const openedAt = validateProtocolTimestamp(
    proof?.openedAt,
    'Exclusive-window READY timestamp',
    context,
  );
  if (
    proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
    || proof?.status !== 'READY'
    || !Number.isInteger(helperPid)
    || helperPid < 1
    || Number(proof?.helperPid) !== helperPid
    || !samePath(proof?.path, db.realPath)
    || normalizeSha(proof?.sha256, 'Exclusive-window database SHA') !== db.sha256
    || Number(proof?.sizeBytes) !== db.sizeBytes
    || proof?.databaseHandleExclusive !== true
  ) {
    fail('Launch-exclusive FileShare.None helper did not bind the approved live DB.');
  }
  return {
    protocol: EXCLUSIVE_WINDOW_PROTOCOL,
    status: 'READY',
    helperPid,
    path: db.realPath,
    sha256: db.sha256,
    sizeBytes: db.sizeBytes,
    databaseHandleExclusive: true,
    openedAt: openedAt.iso,
  };
}

function validateStartupGateProtocolArtifact(
  proof,
  prefix,
  expectedPath,
  label,
  context,
) {
  const artifact = startupGateFileArtifact(expectedPath, label);
  const security = context.inspectWindowsPathSecurity(artifact.realPath, {
    label,
    type: 'file',
    requireProtected: true,
  });
  if (
    security?.passed !== true
    || !samePath(proof?.[`${prefix}Path`], artifact.realPath)
    || normalizeSha(proof?.[`${prefix}Sha256`], `${label} proof SHA-256`) !== artifact.sha256
    || String(proof?.[`${prefix}DeviceId`] || '') !== artifact.identity.deviceId
    || String(proof?.[`${prefix}FileId`] || '') !== artifact.identity.fileId
  ) {
    fail(`${label} helper proof does not match the strict file identity.`);
  }
  return { ...artifact, windowsSecurity: security };
}

function validateSuspendedPackageProof(
  proof,
  ready,
  executablePath,
  startupGatePlan,
  context,
) {
  const createdAt = validateProtocolTimestamp(
    proof?.createdAt,
    'Exclusive-window SPAWNED timestamp',
    context,
    Date.parse(ready.openedAt),
  );
  if (
    proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
    || proof?.status !== 'SPAWNED'
    || Number(proof?.helperPid) !== ready.helperPid
    || !Number.isInteger(Number(proof?.pid))
    || Number(proof.pid) < 1
    || !Number.isInteger(Number(proof?.threadId))
    || Number(proof.threadId) < 1
    || !samePath(proof?.executablePath, executablePath)
    || !samePath(proof?.queriedExecutablePath, executablePath)
    || proof?.processImageQueryPassed !== true
    || proof?.createdSuspended !== true
    || proof?.databaseHandleExclusive !== true
    || proof?.startupGateWindowsSecurityPassed !== true
    || proof?.startupGateId !== startupGatePlan?.gateId
    || proof?.startupGateInvocationId !== startupGatePlan?.invocationId
    || !samePath(proof?.startupGateHandoffReadyPath, startupGatePlan?.handoffReadyPath)
    || !samePath(proof?.startupGateHandoffReleasedPath, startupGatePlan?.handoffReleasedPath)
    || !samePath(proof?.startupGateAdmissionPath, startupGatePlan?.admissionPath)
    || !samePath(proof?.startupGateClosedPath, startupGatePlan?.closedPath)
    || !samePath(proof?.startupGateFinalizedPath, startupGatePlan?.finalizedPath)
    || !samePath(
      proof?.trustedShellPath,
      startupGatePlan?.activeDocument?.bindings?.shell?.realPath,
    )
    || normalizeSha(proof?.trustedShellSha256, 'SPAWNED trusted shell SHA-256')
      !== startupGatePlan?.activeDocument?.bindings?.shell?.sha256
    || String(proof?.trustedShellDeviceId || '')
      !== startupGatePlan?.activeDocument?.bindings?.shell?.identity?.deviceId
    || String(proof?.trustedShellFileId || '')
      !== startupGatePlan?.activeDocument?.bindings?.shell?.identity?.fileId
    || Number(proof?.trustedShellHardLinkCount)
      !== startupGatePlan?.activeDocument?.bindings?.shell?.identity?.hardLinkCount
  ) {
    fail('Exclusive-window helper did not create the approved package suspended under the DB lock.');
  }
  const activeGate = validateStartupGateProtocolArtifact(
    proof,
    'startupGateActive',
    startupGatePlan.activePath,
    'S7 ACTIVE startup gate',
    context,
  );
  const boundGate = validateStartupGateProtocolArtifact(
    proof,
    'startupGateBound',
    startupGatePlan.boundPath,
    'S7 BOUND startup gate',
    context,
  );
  let activeDocument;
  let boundDocument;
  try {
    activeDocument = JSON.parse(fs.readFileSync(activeGate.realPath, 'utf8'));
    boundDocument = JSON.parse(fs.readFileSync(boundGate.realPath, 'utf8'));
  } catch {
    fail('S7 startup gate documents were not valid JSON after suspended binding.');
  }
  if (
    stableJson(activeDocument) !== stableJson(startupGatePlan.activeDocument)
    || boundDocument?.kind !== STARTUP_GATE_BOUND_KIND
    || boundDocument?.schemaVersion !== STARTUP_GATE_BOUND_SCHEMA
    || boundDocument?.status !== 'BOUND_SUSPENDED'
    || boundDocument?.gateId !== startupGatePlan.gateId
    || boundDocument?.invocationId !== startupGatePlan.invocationId
    || Number(boundDocument?.pid) !== Number(proof.pid)
    || Number(boundDocument?.threadId) !== Number(proof.threadId)
    || stableJson(boundDocument?.activeGate) !== stableJson(
      startupGateArtifactBinding(activeGate, 'S7 ACTIVE startup gate'),
    )
    || stableJson(boundDocument?.bindings) !== stableJson(startupGatePlan.activeDocument.bindings)
  ) {
    fail('S7 startup gate ACTIVE/BOUND documents do not bind the suspended child.');
  }
  return {
    protocol: EXCLUSIVE_WINDOW_PROTOCOL,
    status: 'SPAWNED',
    helperPid: ready.helperPid,
    pid: Number(proof.pid),
    threadId: Number(proof.threadId),
    executablePath,
    queriedExecutablePath: executablePath,
    processImageQueryPassed: true,
    createdSuspended: true,
    databaseHandleExclusive: true,
    createdAt: createdAt.iso,
    startupGate: {
      gateId: startupGatePlan.gateId,
      invocationId: startupGatePlan.invocationId,
      active: activeGate,
      bound: boundGate,
      handoffReadyPath: startupGatePlan.handoffReadyPath,
      handoffReleasedPath: startupGatePlan.handoffReleasedPath,
      admissionPath: startupGatePlan.admissionPath,
      closedPath: startupGatePlan.closedPath,
      finalizedPath: startupGatePlan.finalizedPath,
      shell: startupGatePlan.activeDocument.bindings.shell,
      windowsSecurityPassed: true,
    },
  };
}

function validateLaunchExclusiveReleased(proof, ready, suspended, context) {
  const finalInventoryAt = validateProtocolTimestamp(
    proof?.finalSameNameInventoryAt,
    'Exclusive-window final same-name inventory timestamp',
    context,
    Date.parse(suspended.createdAt),
  );
  const resumedAt = validateProtocolTimestamp(
    proof?.resumedAt,
    'Exclusive-window RESUMED timestamp',
    context,
    finalInventoryAt.milliseconds,
  );
  const releasedAt = validateProtocolTimestamp(
    proof?.releasedAt,
    'Exclusive-window DB release timestamp',
    context,
    resumedAt.milliseconds,
  );
  if (
    proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
    || proof?.status !== 'RESUMED'
    || Number(proof?.helperPid) !== ready.helperPid
    || Number(proof?.pid) !== suspended.pid
    || proof?.databaseHandleExclusive !== false
    || proof?.finalSameNameInventoryPassed !== true
    || Number(proof?.finalSameNameProcessCount) !== 1
    || proof?.finalProcessImageQueryPassed !== true
    || !samePath(proof?.finalQueriedExecutablePath, suspended.executablePath)
    || !Number.isInteger(Number(proof?.resumeResult))
    || Number(proof.resumeResult) !== 1
    || proof?.startupGateId !== suspended.startupGate.gateId
    || proof?.startupGateInvocationId !== suspended.startupGate.invocationId
    || normalizeSha(
      proof?.startupGateActiveSha256,
      'RESUMED ACTIVE gate SHA-256',
    ) !== suspended.startupGate.active.sha256
    || normalizeSha(
      proof?.startupGateBoundSha256,
      'RESUMED BOUND gate SHA-256',
    ) !== suspended.startupGate.bound.sha256
    || normalizeSha(proof?.trustedShellSha256, 'RESUMED trusted shell SHA-256')
      !== suspended.startupGate.shell.sha256
  ) {
    fail('Launch-exclusive helper did not prove resume-under-lock followed by DB handoff.');
  }
  const handoffReady = validateStartupGateProtocolArtifact(
    proof,
    'startupGateHandoffReady',
    suspended.startupGate.handoffReadyPath,
    'S7 HANDOFF_READY receipt',
    context,
  );
  const handoffReleased = validateStartupGateProtocolArtifact(
    proof,
    'startupGateHandoffReleased',
    suspended.startupGate.handoffReleasedPath,
    'S7 HANDOFF_RELEASED receipt',
    context,
  );
  return {
    protocol: EXCLUSIVE_WINDOW_PROTOCOL,
    status: 'RESUMED',
    helperPid: ready.helperPid,
    pid: suspended.pid,
    finalSameNameInventoryPassed: true,
    finalSameNameProcessCount: 1,
    finalSameNameInventoryAt: finalInventoryAt.iso,
    finalQueriedExecutablePath: suspended.executablePath,
    finalProcessImageQueryPassed: true,
    releasedAt: releasedAt.iso,
    resumedAt: resumedAt.iso,
    databaseHandleExclusive: false,
    resumeResult: Number(proof.resumeResult),
    startupGate: {
      ...suspended.startupGate,
      handoffReady,
      handoffReleased,
    },
  };
}

function validateControlledCloseProof(result, ready, suspended, resumed, context) {
  const closedAt = validateProtocolTimestamp(
    result?.proof?.closedAt,
    'Exclusive-window CLOSED timestamp',
    context,
    Date.parse(resumed.resumedAt),
  );
  if (
    result?.proof?.protocol !== EXCLUSIVE_WINDOW_PROTOCOL
    || result?.proof?.status !== 'CLOSED'
    || Number(result?.proof?.helperPid) !== ready.helperPid
    || Number(result?.proof?.pid) !== suspended.pid
    || result?.proof?.databaseHandleExclusive !== false
    || result?.proof?.startupGateAdmissionVerified !== true
    || result?.proof?.startupGateWindowsSecurityPassed !== true
    || result?.proof?.startupGateId !== suspended.startupGate.gateId
    || result?.proof?.startupGateInvocationId !== suspended.startupGate.invocationId
  ) {
    fail('Controlled launch close proof was invalid after evidence collection.');
  }
  const activeGate = validateStartupGateProtocolArtifact(
    result.proof,
    'startupGateActive',
    suspended.startupGate.active.realPath,
    'CLOSED S7 ACTIVE startup gate',
    context,
  );
  const boundGate = validateStartupGateProtocolArtifact(
    result.proof,
    'startupGateBound',
    suspended.startupGate.bound.realPath,
    'CLOSED S7 BOUND startup gate',
    context,
  );
  const handoffReady = validateStartupGateProtocolArtifact(
    result.proof,
    'startupGateHandoffReady',
    suspended.startupGate.handoffReadyPath,
    'CLOSED S7 HANDOFF_READY receipt',
    context,
  );
  const handoffReleased = validateStartupGateProtocolArtifact(
    result.proof,
    'startupGateHandoffReleased',
    suspended.startupGate.handoffReleasedPath,
    'CLOSED S7 HANDOFF_RELEASED receipt',
    context,
  );
  const admission = validateStartupGateProtocolArtifact(
    result.proof,
    'startupGateAdmission',
    suspended.startupGate.admissionPath,
    'S7 Main admission receipt',
    context,
  );
  const closed = validateStartupGateProtocolArtifact(
    result.proof,
    'startupGateClosed',
    suspended.startupGate.closedPath,
    'S7 helper CLOSED receipt',
    context,
  );
  if (
    !sameArtifact(activeGate, suspended.startupGate.active)
    || !sameArtifact(boundGate, suspended.startupGate.bound)
  ) {
    fail('S7 ACTIVE/BOUND startup gate drifted before CLOSED proof.');
  }
  let admissionDocument;
  let closedDocument;
  try {
    admissionDocument = JSON.parse(fs.readFileSync(admission.realPath, 'utf8'));
    closedDocument = JSON.parse(fs.readFileSync(closed.realPath, 'utf8'));
  } catch {
    fail('S7 admission/CLOSED receipt was not valid JSON.');
  }
  const expectedActiveBinding = startupGateArtifactBinding(activeGate, 'CLOSED ACTIVE gate');
  const expectedBoundBinding = startupGateArtifactBinding(boundGate, 'CLOSED BOUND gate');
  const expectedReadyBinding = startupGateArtifactBinding(
    handoffReady,
    'CLOSED HANDOFF_READY',
  );
  const expectedReleasedBinding = startupGateArtifactBinding(
    handoffReleased,
    'CLOSED HANDOFF_RELEASED',
  );
  const expectedAdmissionBinding = startupGateArtifactBinding(admission, 'CLOSED admission');
  const expectedDatabaseAfterClose = startupGateArtifactBinding(
    closedDocument?.databaseAfterClose,
    'CLOSED database-after-close',
  );
  const databaseAfterClose = startupGateFileArtifact(
    expectedDatabaseAfterClose.realPath,
    'CLOSED database-after-close',
  );
  const databaseAfterCloseSecurity = context.inspectWindowsPathSecurity(
    databaseAfterClose.realPath,
    {
      label: 'CLOSED database-after-close',
      type: 'file',
      requireProtected: true,
    },
  );
  for (const [label, actual, expected] of [
    ['admission-active', admissionDocument?.activeGate, expectedActiveBinding],
    ['admission-bound', admissionDocument?.boundGate, expectedBoundBinding],
    ['admission-ready', admissionDocument?.handoffReady, expectedReadyBinding],
    ['admission-released', admissionDocument?.handoffReleased, expectedReleasedBinding],
    ['closed-active', closedDocument?.activeGate, expectedActiveBinding],
    ['closed-bound', closedDocument?.boundGate, expectedBoundBinding],
    ['closed-ready', closedDocument?.handoffReady, expectedReadyBinding],
    ['closed-released', closedDocument?.handoffReleased, expectedReleasedBinding],
    ['closed-admission', closedDocument?.admission, expectedAdmissionBinding],
  ]) {
    if (stableJson(actual) !== stableJson(expected)) {
      fail(`S7 CLOSED chain ${label} binding differs.`);
    }
  }
  if (
    admissionDocument?.kind !== STARTUP_GATE_ADMISSION_KIND
    || admissionDocument?.schemaVersion !== STARTUP_GATE_ADMISSION_SCHEMA
    || admissionDocument?.status !== 'ADMITTED_UNDER_EXCLUSIVE_SQLITE_LOCK'
    || Number(admissionDocument?.pid) !== suspended.pid
    || admissionDocument?.gateId !== suspended.startupGate.gateId
    || admissionDocument?.invocationId !== suspended.startupGate.invocationId
    || admissionDocument?.singleInstanceLockAcquired !== true
    || admissionDocument?.sqliteTakeover?.fileMustExist !== true
    || admissionDocument?.sqliteTakeover?.lockingMode !== 'exclusive'
    || admissionDocument?.sqliteTakeover?.beginMode !== 'exclusive'
    || admissionDocument?.sqliteTakeover?.transactionActive !== true
    || admissionDocument?.sqliteTakeover?.sameConnectionRequiredForMigration !== true
    || Number(admissionDocument?.sqliteTakeover?.schemaVersionBefore) !== 0
    || closedDocument?.kind !== STARTUP_GATE_CLOSED_KIND
    || closedDocument?.schemaVersion !== STARTUP_GATE_CLOSED_SCHEMA
    || closedDocument?.status !== 'CLOSED_AFTER_GUARDED_MIGRATION'
    || closedDocument?.gateId !== suspended.startupGate.gateId
    || closedDocument?.invocationId !== suspended.startupGate.invocationId
    || Number(closedDocument?.helperPid) !== ready.helperPid
    || Number(closedDocument?.pid) !== suspended.pid
    || Number(closedDocument?.exitCode) !== 0
    || stableJson(startupGateArtifactBinding(
      databaseAfterClose,
      'Measured CLOSED database-after-close',
    )) !== stableJson(expectedDatabaseAfterClose)
    || databaseAfterCloseSecurity?.passed !== true
    || normalizeSha(
      result?.proof?.databaseAfterCloseSha256,
      'CLOSED database-after-close proof',
    ) !== databaseAfterClose.sha256
    || normalizeSha(result?.proof?.trustedShellSha256, 'CLOSED trusted shell proof')
      !== suspended.startupGate.shell.sha256
  ) {
    fail('S7 helper CLOSED receipt did not bind exact ACTIVE/BOUND/ADMISSION identities.');
  }
  return {
    closedAt: closedAt.iso,
    startupGate: {
      ...suspended.startupGate,
      active: activeGate,
      bound: boundGate,
      handoffReady,
      handoffReleased,
      admission,
      closed,
      databaseAfterClose: {
        ...databaseAfterClose,
        windowsSecurity: databaseAfterCloseSecurity,
      },
      admissionVerified: true,
      windowsSecurityPassed: true,
    },
  };
}

function defaultEnsureIntentDirectory(
  userDataDir,
  inspectWindowsPathSecurity = defaultInspectWindowsPathSecurity,
  protectWindowsDirectory = defaultProtectWindowsDirectory,
) {
  const root = directPath(userDataDir, 'Canonical packaged userData', 'directory');
  const intentDir = path.join(root.realPath, INTENT_DIRECTORY_NAME);
  if (!exists(intentDir)) {
    fs.mkdirSync(intentDir, { recursive: false });
    protectWindowsDirectory(intentDir);
  }
  const resolved = directPath(
    intentDir,
    'Live migration launch-intent directory',
    'directory',
  ).realPath;
  const security = inspectWindowsPathSecurity(resolved, {
    label: 'Live migration launch-intent directory',
    type: 'directory',
    requireProtected: true,
  });
  if (security?.passed !== true) {
    fail('Live migration launch-intent directory Windows ACL proof failed.');
  }
  return resolved;
}

function defaultEnsureStartupGateDirectory(
  userDataDir,
  inspectWindowsPathSecurity = defaultInspectWindowsPathSecurity,
  protectWindowsDirectory = defaultProtectWindowsDirectory,
) {
  const root = directPath(userDataDir, 'Canonical packaged userData', 'directory');
  const gateDirectory = path.join(root.realPath, STARTUP_GATE_DIRECTORY_NAME);
  if (!exists(gateDirectory)) {
    fs.mkdirSync(gateDirectory, { recursive: false });
    protectWindowsDirectory(gateDirectory);
  }
  const resolved = directPath(
    gateDirectory,
    'S7 packaged Main startup gate directory',
    'directory',
  ).realPath;
  const security = inspectWindowsPathSecurity(resolved, {
    label: 'S7 packaged Main startup gate directory',
    type: 'directory',
    requireProtected: true,
  });
  if (security?.passed !== true) {
    fail('S7 packaged Main startup gate directory Windows ACL proof failed.');
  }
  for (const name of [
    STARTUP_GATE_ACTIVE_FILE,
    STARTUP_GATE_BOUND_FILE,
    STARTUP_GATE_HANDOFF_READY_FILE,
    STARTUP_GATE_HANDOFF_RELEASED_FILE,
    STARTUP_GATE_ADMISSION_FILE,
    STARTUP_GATE_CLOSED_FILE,
    STARTUP_GATE_FINALIZED_FILE,
    STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE,
  ]) {
    if (exists(path.join(resolved, name))) {
      fail(
        `S7 packaged Main startup gate already contains ${name}; preserve ACTIVE/HOLD and do not retry.`,
      );
    }
  }
  return resolved;
}

function childEnvironment(env, canonical) {
  const result = minimalWindowsRuntimeEnvironment(env);
  result.APPDATA = canonical.roamingAppData;
  result.USERPROFILE = canonical.userProfile;
  return result;
}

function defaultContext(injected = {}) {
  return {
    env: process.env,
    platform: process.platform,
    now: () => new Date(),
    packageIdentity: defaultPackageIdentity,
    trustedPowerShellIdentity: () => resolveTrustedWindowsPowerShell(process.env),
    listProcesses: defaultListProcesses,
    listSuspendedProcesses: defaultListSuspendedSameNameProcesses,
    readSchemaVersion: defaultReadSchema,
    inspectPostMigrationAuthority: defaultInspectPostMigrationAuthority,
    resolveRoamingAppData: defaultResolveRoamingAppData,
    resolveUserProfile: defaultResolveUserProfile,
    inspectAuthority: defaultInspectAuthority,
    verifyMigration: verifyS7MigrationBackupRestore,
    evaluatePackageUiEvidence: evaluatePackageUiEvidenceCompleteness,
    exclusiveDbPreflight: defaultExclusiveDbPreflight,
    acquireLaunchExclusiveWindow: defaultAcquireLaunchExclusiveWindow,
    createSuspendedPackage: defaultCreateSuspendedPackage,
    releaseAndResumePackage: defaultReleaseAndResumePackage,
    waitForManagedPackageClose: defaultWaitForManagedPackageClose,
    detachManagedLaunch: defaultDetachManagedLaunch,
    abortUnlaunchedExclusiveWindow: defaultAbortUnlaunchedExclusiveWindow,
    ensureIntentDirectory: defaultEnsureIntentDirectory,
    ensureStartupGateDirectory: defaultEnsureStartupGateDirectory,
    inspectWindowsPathSecurity: defaultInspectWindowsPathSecurity,
    protectWindowsDirectory: defaultProtectWindowsDirectory,
    protectWindowsFile: defaultProtectWindowsFile,
    writeStdout: process.stdout.write.bind(process.stdout),
    ...injected,
  };
}

function validateContext(context) {
  for (const key of [
    'now',
    'packageIdentity',
    'trustedPowerShellIdentity',
    'listProcesses',
    'listSuspendedProcesses',
    'readSchemaVersion',
    'inspectPostMigrationAuthority',
    'resolveRoamingAppData',
    'resolveUserProfile',
    'inspectAuthority',
    'verifyMigration',
    'evaluatePackageUiEvidence',
    'exclusiveDbPreflight',
    'acquireLaunchExclusiveWindow',
    'createSuspendedPackage',
    'releaseAndResumePackage',
    'waitForManagedPackageClose',
    'detachManagedLaunch',
    'abortUnlaunchedExclusiveWindow',
    'ensureIntentDirectory',
    'ensureStartupGateDirectory',
    'inspectWindowsPathSecurity',
    'protectWindowsDirectory',
    'protectWindowsFile',
    'writeStdout',
  ]) {
    if (typeof context[key] !== 'function') fail(`Launch operator ${key} dependency is invalid.`);
  }
  if (!context.env || typeof context.env !== 'object') {
    fail('Launch operator env dependency is invalid.');
  }
}

function assertWindows(context) {
  if (context.platform !== 'win32') {
    fail('Live authority migration launch is supported only on Windows.');
  }
}

function validateStage2Inputs(input, context) {
  const canonical = resolveCanonicalPaths(context);
  const requestedDb = cleanAbsolute(input.db, '--db');
  if (!samePath(requestedDb, canonical.databasePath)) {
    fail(`--db must be the canonical packaged AppData authority DB: ${canonical.databasePath}`);
  }
  const db = fileArtifact(requestedDb, 'Live authority database');
  const databaseWindowsSecurity = validateAuthorityDatabaseSecurity(
    context,
    db.realPath,
    'Live authority database',
  );
  noSidecars(db.realPath, 'Live authority database');
  const version = context.readSchemaVersion(db.realPath);
  if (version !== REQUIRED_SOURCE_VERSION) {
    fail(`Live authority schema must be exactly v${REQUIRED_SOURCE_VERSION}; v1-v8 require recovery.`);
  }

  const selection = readJsonStable(input.authoritySelection, 'Authority selection receipt');
  const currentSelection = context.inspectAuthority({
    dbPath: db.realPath,
    userDataDir: canonical.userDataDir,
    sha256: db.sha256,
    roamingAppData: canonical.roamingAppData,
    userProfile: canonical.userProfile,
  });
  validateAuthoritySelection(selection.value, currentSelection, db, canonical, context.now);

  const migration = readJsonStable(input.migrationManifest, 'Offline migration manifest');
  const verification = readJsonStable(
    input.migrationVerification,
    'Migration verification receipt',
  );
  const migrationVerificationRerun = validateMigrationInputs(
    migration,
    verification,
    db,
    context,
  );

  const packageUiRead = readJsonStable(input.packageUiManifest, 'Package UI manifest');
  const packageIdentity = context.packageIdentity();
  const packageUi = validatePackageUi(
    packageUiRead.value,
    packageUiRead.artifact,
    packageIdentity,
    db,
    context,
  );

  const processState = context.listProcesses();
  validateProcessState(processState, 'AmazonAIOpsAgent process preflight');
  const exclusive = validateExclusiveDbPreflight(
    context.exclusiveDbPreflight(db.realPath),
    'Live authority DB preflight',
  );
  const dbAfter = fileArtifact(db.realPath, 'Live authority database');
  if (!sameArtifact(db, dbAfter)) {
    fail('Live authority database drifted during Stage 2 preflight.');
  }
  noSidecars(dbAfter.realPath, 'Live authority database');
  return {
    canonical,
    db: publicArtifact(db),
    databaseWindowsSecurity,
    schemaVersion: version,
    authoritySelection: publicArtifact(selection.artifact),
    migrationManifest: publicArtifact(migration.artifact),
    migrationVerification: publicArtifact(verification.artifact),
    migrationVerificationRerun,
    package: packageIdentity,
    packageUi,
    processPreflight: {
      query: 'all-AmazonAIOpsAgent.exe-processes',
      passed: true,
      matchingCount: 0,
      unresolvedCount: 0,
    },
    offlineProof: exclusive,
  };
}

function packetSafety() {
  return {
    authorityDatabaseMutated: false,
    packageLaunched: 'NOT_LAUNCHED',
    operatorDirectAdsExecutionInvoked: false,
    packageAdsExecutionState: 'NOT_LAUNCHED',
    requiresExplicitUserApproval: true,
    migrationOnly: false,
    secretsIncluded: false,
    replayGuard: 'COMPLETE_INTENT_FILE_PRESENT',
    absoluteAdministratorReplayPrevention: false,
    intentLossRequiresHoldAndNewApproval: true,
  };
}

function packetInstructions() {
  return {
    userMustBePresent: true,
    noProductionStoreOrSession: true,
    consumedBeforeSpawn: true,
    suspendedLaunchHandoffRequired: true,
    administratorIntentDeletionDetectable: false,
    requiredNextStepAfterExit:
      'pnpm run verify:s7-live-migration-acceptance -- --db <live-db> --authority-selection <authority-selection> --migration-manifest <offline-manifest> --migration-verification <migration-verification> --out <new-acceptance-receipt.json>',
  };
}

function approvalPayload(bindings, generatedAt) {
  return {
    kind: PACKET_KIND,
    schemaVersion: PACKET_SCHEMA_VERSION,
    generatedAt,
    bindings,
    safety: packetSafety(),
    instructions: packetInstructions(),
  };
}

function createPacket(input, context) {
  const bindings = validateStage2Inputs(input, context);
  const payload = approvalPayload(bindings, nowIso(context.now));
  const approvalPayloadSha256 = sha256(stableJson(payload));
  return {
    ...payload,
    confirmation: {
      approvalPayloadSha256,
      token: `LIVE-MIGRATION-${approvalPayloadSha256}`,
      exactMatchRequired: true,
    },
  };
}

function exactKeys(value, keys) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && stableJson(Object.keys(value).sort()) === stableJson([...keys].sort()),
  );
}

function validatePacket(packet, artifact, context, confirmation) {
  if (
    !exactKeys(packet, [
      'kind',
      'schemaVersion',
      'generatedAt',
      'bindings',
      'safety',
      'instructions',
      'confirmation',
    ])
    || packet.kind !== PACKET_KIND
    || packet.schemaVersion !== PACKET_SCHEMA_VERSION
    || !exactKeys(packet?.confirmation, [
      'approvalPayloadSha256',
      'token',
      'exactMatchRequired',
    ])
    || stableJson(packet.safety) !== stableJson(packetSafety())
    || stableJson(packet.instructions) !== stableJson(packetInstructions())
    || packet.confirmation.exactMatchRequired !== true
  ) {
    fail('Approval packet schema or immutable approval boundary is invalid.');
  }
  const payload = {
    kind: packet.kind,
    schemaVersion: packet.schemaVersion,
    generatedAt: packet.generatedAt,
    bindings: packet.bindings,
    safety: packet.safety,
    instructions: packet.instructions,
  };
  const hash = sha256(stableJson(payload));
  if (
    packet.confirmation.approvalPayloadSha256 !== hash
    || packet.confirmation.token !== `LIVE-MIGRATION-${hash}`
    || confirmation !== packet.confirmation.token
  ) {
    fail('Live migration confirmation token does not exactly match the full approval payload.');
  }
  const generatedAt = Date.parse(packet.generatedAt || '');
  if (!Number.isFinite(generatedAt) || generatedAt > context.now().valueOf() + 60_000) {
    fail('Approval packet timestamp is invalid or future-dated.');
  }
  return { payload, hash, artifact };
}

function finalizationSafety() {
  return {
    authorityDatabaseMutated: false,
    packageLaunched: false,
    adsExecutionInvoked: false,
    formalAppReadiness: false,
    explicitConfirmationRequired: true,
    finalizedReceiptCreatesStartupEligibilityOnly: true,
  };
}

function validateBoundGateArtifact(value, expectedPath, label, context) {
  const expected = startupGateArtifactBinding(value, `${label} receipt binding`);
  const actual = startupGateFileArtifact(expectedPath, label);
  const security = context.inspectWindowsPathSecurity(actual.realPath, {
    label,
    type: 'file',
    requireProtected: true,
  });
  if (
    security?.passed !== true
    || stableJson(startupGateArtifactBinding(actual, label)) !== stableJson(expected)
  ) {
    fail(`${label} drifted or lost its protected Windows boundary.`);
  }
  return { artifact: actual, binding: expected };
}

function readGateJson(artifact, label) {
  try {
    return JSON.parse(fs.readFileSync(artifact.realPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function collectFinalizationEvidence(input, context) {
  const approvalRead = readJsonStable(input.approvalPacket, 'Finalization approval packet');
  const packetIdentity = validatePacket(
    approvalRead.value,
    approvalRead.artifact,
    context,
    approvalRead.value?.confirmation?.token,
  );
  const bindings = packetIdentity.payload.bindings;
  const canonical = resolveCanonicalPaths(context);
  if (
    !samePath(bindings?.canonical?.userDataDir, canonical.userDataDir)
    || !samePath(bindings?.db?.realPath, canonical.databasePath)
  ) {
    fail('Finalization approval packet is not bound to the current canonical authority.');
  }
  const launchRead = readJsonStable(input.launchReceipt, 'Finalization launch receipt');
  const acceptanceRead = readJsonStable(
    input.acceptanceReceipt,
    'Finalization readonly acceptance receipt',
  );
  const launch = launchRead.value;
  const acceptance = validateS7LiveMigrationAcceptanceReceipt(acceptanceRead.value);
  if (
    launch?.kind !== KIND
    || launch?.schemaVersion !== SCHEMA_VERSION
    || launch?.status !== 'LAUNCHED_AWAITING_READONLY_ACCEPTANCE'
    || launch?.passed !== false
    || launch?.formalAcceptance !== false
    || launch?.authorityDatabaseMutated !== true
    || launch?.packageLaunched !== 'CONFIRMED_LAUNCHED'
    || launch?.operatorDirectAdsExecutionInvoked !== false
    || launch?.approvalPayloadSha256 !== packetIdentity.hash
    || stableJson(startupGateArtifactBinding(
      launch?.approvalPacket,
      'Launch receipt approval packet',
    )) !== stableJson(startupGateArtifactBinding(
      approvalRead.artifact,
      'Current approval packet',
    ))
    || launch?.startupGate?.admissionVerified !== true
    || launch?.startupGate?.windowsSecurityPassed !== true
    || Number(launch?.postLaunch?.schemaVersion) !== TARGET_VERSION
    || launch?.postCloseEvidence?.package?.passed !== true
    || launch?.postCloseEvidence?.processes?.passed !== true
    || launch?.postCloseEvidence?.database?.passed !== true
    || launch?.remainingAcceptanceDependencies?.separateReadonlyAcceptanceRequired !== true
  ) {
    fail('Launch receipt is not the exact successful migration handoff awaiting acceptance.');
  }
  const currentPackage = context.packageIdentity();
  assertPacketPackageIdentity(approvalRead.value, currentPackage);
  const packageAtMigration = startupGatePackageBinding(currentPackage);
  const shellAtMigration = startupGateTrustedShellBinding(
    context.trustedPowerShellIdentity(),
  );
  // The Windows file index can exceed Number.MAX_SAFE_INTEGER. Reuse the
  // startup-gate reader here so device/file IDs stay lossless decimal strings
  // and compare exactly with CLOSED/Main receipts.
  const database = startupGateFileArtifact(
    canonical.databasePath,
    'Finalization authority database',
  );
  noSidecars(database.realPath, 'Finalization authority database');
  const databaseSecurity = validateAuthorityDatabaseSecurity(
    context,
    database.realPath,
    'Finalization authority database',
  );
  if (
    Number(context.readSchemaVersion(database.realPath)) !== TARGET_VERSION
    || !samePath(acceptance?.inputs?.database?.realPath, database.realPath)
    || normalizeSha(
      acceptance?.inputs?.database?.sha256,
      'Acceptance live database',
    ) !== database.sha256
    || Number(acceptance?.inputs?.database?.sizeBytes) !== database.sizeBytes
  ) {
    fail(`Readonly acceptance does not bind the current v${TARGET_VERSION} authority database.`);
  }
  for (const [label, acceptanceArtifact, approvedArtifact] of [
    [
      'authority selection',
      acceptance?.inputs?.authoritySelection,
      bindings.authoritySelection,
    ],
    [
      'migration manifest',
      acceptance?.inputs?.migrationManifest,
      bindings.migrationManifest,
    ],
    [
      'migration verification',
      acceptance?.inputs?.migrationVerification,
      bindings.migrationVerification,
    ],
  ]) {
    if (
      !samePath(acceptanceArtifact?.realPath, approvedArtifact?.realPath)
      || normalizeSha(acceptanceArtifact?.sha256, `Acceptance ${label}`)
        !== normalizeSha(approvedArtifact?.sha256, `Approved ${label}`)
      || Number(acceptanceArtifact?.sizeBytes) !== Number(approvedArtifact?.sizeBytes)
    ) {
      fail(`Readonly acceptance ${label} binding differs from approval.`);
    }
  }
  const processState = context.listProcesses();
  validateProcessState(processState, 'Finalization AmazonAIOpsAgent process preflight');
  const authority = context.inspectPostMigrationAuthority(database.realPath);
  if (
    authority?.targetVersion !== TARGET_VERSION
    || authority?.integrityCheck !== 'ok'
    || Number(authority?.foreignKeyViolationCount) !== 0
    || !Array.isArray(authority?.migrationRows)
    || authority.migrationRows.length !== TARGET_VERSION
    || !Array.isArray(authority?.requiredTables)
    || stableJson(authority)
      !== stableJson(postMigrationAuthorityContract(authority.migrationRows))
  ) {
    fail(`Finalization authority contract is not the exact production v${TARGET_VERSION} contract.`);
  }

  const startupGate = launch.startupGate;
  const gateDirectory = path.join(canonical.userDataDir, STARTUP_GATE_DIRECTORY_NAME);
  const expectedPaths = {
    active: path.join(gateDirectory, STARTUP_GATE_ACTIVE_FILE),
    bound: path.join(gateDirectory, STARTUP_GATE_BOUND_FILE),
    handoffReady: path.join(gateDirectory, STARTUP_GATE_HANDOFF_READY_FILE),
    handoffReleased: path.join(gateDirectory, STARTUP_GATE_HANDOFF_RELEASED_FILE),
    admission: path.join(gateDirectory, STARTUP_GATE_ADMISSION_FILE),
    closed: path.join(gateDirectory, STARTUP_GATE_CLOSED_FILE),
    finalized: path.join(gateDirectory, STARTUP_GATE_FINALIZED_FILE),
    completion: path.join(gateDirectory, STARTUP_GATE_POST_MIGRATION_ADMITTED_FILE),
  };
  const gateDirectoryState = directPath(
    gateDirectory,
    'Finalization startup gate directory',
    'directory',
  );
  const gateDirectorySecurity = context.inspectWindowsPathSecurity(
    gateDirectoryState.realPath,
    {
      label: 'Finalization startup gate directory',
      type: 'directory',
      requireProtected: true,
    },
  );
  if (gateDirectorySecurity?.passed !== true) {
    fail('Finalization startup gate directory ACL proof failed.');
  }
  if (exists(expectedPaths.finalized) || exists(expectedPaths.completion)) {
    fail('FINALIZED or POST_MIGRATION_ADMITTED already exists; finalization is one-time.');
  }
  const chain = {};
  for (const [name, expectedPath] of Object.entries(expectedPaths)) {
    if (name === 'finalized' || name === 'completion') continue;
    chain[name] = validateBoundGateArtifact(
      startupGate?.[name],
      expectedPath,
      `Finalization ${name}`,
      context,
    );
  }
  const activeDocument = readGateJson(chain.active.artifact, 'Finalization ACTIVE');
  const closedDocument = readGateJson(chain.closed.artifact, 'Finalization CLOSED');
  if (
    activeDocument?.kind !== STARTUP_GATE_ACTIVE_KIND
    || activeDocument?.schemaVersion !== STARTUP_GATE_ACTIVE_SCHEMA
    || activeDocument?.status !== 'ACTIVE_AWAITING_BOUND_CHILD'
    || !samePath(activeDocument?.canonicalUserDataDir, canonical.userDataDir)
    || !samePath(activeDocument?.paths?.active, expectedPaths.active)
    || !samePath(activeDocument?.paths?.bound, expectedPaths.bound)
    || !samePath(activeDocument?.paths?.handoffReady, expectedPaths.handoffReady)
    || !samePath(activeDocument?.paths?.handoffReleased, expectedPaths.handoffReleased)
    || !samePath(activeDocument?.paths?.admission, expectedPaths.admission)
    || !samePath(activeDocument?.paths?.closed, expectedPaths.closed)
    || !samePath(activeDocument?.paths?.finalized, expectedPaths.finalized)
    || stableJson(startupGatePackageBinding(activeDocument?.bindings?.package))
      !== stableJson(packageAtMigration)
    || stableJson(startupGateTrustedShellBinding(activeDocument?.bindings?.shell))
      !== stableJson(shellAtMigration)
    || closedDocument?.kind !== STARTUP_GATE_CLOSED_KIND
    || closedDocument?.schemaVersion !== STARTUP_GATE_CLOSED_SCHEMA
    || closedDocument?.status !== 'CLOSED_AFTER_GUARDED_MIGRATION'
    || closedDocument?.gateId !== activeDocument?.gateId
    || closedDocument?.invocationId !== activeDocument?.invocationId
    || Number(closedDocument?.exitCode) !== 0
  ) {
    fail('Finalization ACTIVE/CLOSED chain is invalid.');
  }
  const closedDatabase = startupGateArtifactBinding(
    closedDocument.databaseAfterClose,
    'CLOSED database after migration',
  );
  const currentDatabaseBinding = startupGateArtifactBinding(
    database,
    'Current database after migration',
  );
  if (
    stableJson(closedDatabase) !== stableJson(currentDatabaseBinding)
    || stableJson(startupGateArtifactBinding(
      startupGate.databaseAfterClose,
      'Launch receipt database after close',
    )) !== stableJson(currentDatabaseBinding)
  ) {
    fail('Finalization database differs from CLOSED and launch receipt bindings.');
  }
  for (const [label, actual, expected] of [
    ['ACTIVE', closedDocument.activeGate, chain.active.binding],
    ['BOUND', closedDocument.boundGate, chain.bound.binding],
    ['HANDOFF_READY', closedDocument.handoffReady, chain.handoffReady.binding],
    ['HANDOFF_RELEASED', closedDocument.handoffReleased, chain.handoffReleased.binding],
    ['ADMISSION', closedDocument.admission, chain.admission.binding],
  ]) {
    if (
      stableJson(startupGateArtifactBinding(actual, `CLOSED ${label}`))
        !== stableJson(expected)
    ) {
      fail(`Finalization CLOSED ${label} chain binding drifted.`);
    }
  }
  const computerName = String(context.env.COMPUTERNAME || '').trim();
  if (!computerName || computerName.includes('\0')) {
    fail('Finalization Windows machine name is unavailable.');
  }
  return {
    canonical: {
      userDataDir: canonical.userDataDir,
      databasePath: canonical.databasePath,
      gateDirectory: gateDirectoryState.realPath,
      finalizedPath: expectedPaths.finalized,
      completionPath: expectedPaths.completion,
    },
    gate: {
      gateId: String(activeDocument.gateId),
      invocationId: String(activeDocument.invocationId),
      active: chain.active.binding,
      bound: chain.bound.binding,
      handoffReady: chain.handoffReady.binding,
      handoffReleased: chain.handoffReleased.binding,
      admission: chain.admission.binding,
      closed: chain.closed.binding,
    },
    approvalPayloadSha256: packetIdentity.hash,
    approvalPacket: startupGateArtifactBinding(
      approvalRead.artifact,
      'Finalization approval packet',
    ),
    launchReceipt: startupGateArtifactBinding(
      launchRead.artifact,
      'Finalization launch receipt',
    ),
    acceptanceReceipt: startupGateArtifactBinding(
      acceptanceRead.artifact,
      'Finalization acceptance receipt',
    ),
    databaseAfterMigration: currentDatabaseBinding,
    packageAtMigration,
    shellAtMigration,
    machine: {
      computerName,
      currentUserSid: String(databaseSecurity.currentUserSid),
      databaseDeviceId: currentDatabaseBinding.identity.deviceId,
      databaseFileId: currentDatabaseBinding.identity.fileId,
    },
    authority,
  };
}

function finalizationPayload(bindings, generatedAt) {
  return {
    kind: FINALIZATION_PACKET_KIND,
    schemaVersion: FINALIZATION_PACKET_SCHEMA,
    status: 'AWAITING_EXPLICIT_FINALIZATION_CONFIRMATION',
    generatedAt,
    bindings,
    safety: finalizationSafety(),
  };
}

function createFinalizationPacket(input, context) {
  const bindings = collectFinalizationEvidence(input, context);
  const payload = finalizationPayload(bindings, nowIso(context.now));
  const finalizationPayloadSha256 = sha256(stableJson(payload));
  return {
    ...payload,
    confirmation: {
      finalizationPayloadSha256,
      token: `FINALIZE-S7-${finalizationPayloadSha256}`,
      exactMatchRequired: true,
    },
  };
}

function validateFinalizationPacket(packet, confirmation) {
  if (
    !exactKeys(packet, [
      'kind',
      'schemaVersion',
      'status',
      'generatedAt',
      'bindings',
      'safety',
      'confirmation',
    ])
    || packet?.kind !== FINALIZATION_PACKET_KIND
    || packet?.schemaVersion !== FINALIZATION_PACKET_SCHEMA
    || packet?.status !== 'AWAITING_EXPLICIT_FINALIZATION_CONFIRMATION'
    || stableJson(packet?.safety) !== stableJson(finalizationSafety())
    || !exactKeys(packet?.confirmation, [
      'finalizationPayloadSha256',
      'token',
      'exactMatchRequired',
    ])
    || packet?.confirmation?.exactMatchRequired !== true
  ) {
    fail('Finalization packet schema or immutable safety boundary is invalid.');
  }
  const payload = finalizationPayload(packet.bindings, packet.generatedAt);
  const hash = sha256(stableJson(payload));
  if (
    packet.confirmation.finalizationPayloadSha256 !== hash
    || packet.confirmation.token !== `FINALIZE-S7-${hash}`
    || confirmation !== packet.confirmation.token
  ) {
    fail('Finalization confirmation token does not exactly match the full payload.');
  }
  return { payload, hash };
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    if (argv.length > 1 && (argv.includes('--help') || argv.includes('-h'))) {
      fail('--help cannot be combined with other arguments.');
    }
    return { mode: 'help' };
  }
  const values = {};
  let mode = null;
  const allowed = new Set([
    'db',
    'authority-selection',
    'migration-manifest',
    'migration-verification',
    'package-ui-manifest',
    'approval-packet',
    'confirm-live-migration',
    'launch-receipt',
    'acceptance-receipt',
    'finalization-packet',
    'confirm-finalization',
    'recovery-root',
    'out',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if ([
      '--prepare',
      '--execute-approved',
      '--prepare-finalization',
      '--finalize-approved',
    ].includes(token)) {
      if (mode) fail('Exactly one mode is required.');
      mode = token.slice(2);
      continue;
    }
    if (!token.startsWith('--')) fail(`Unexpected positional argument: ${token}`);
    const name = token.slice(2);
    if (!allowed.has(name)) fail(`Unknown argument: --${name}.`);
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      fail(`Duplicate argument: --${name}.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`--${name} requires a value.`);
    values[name] = value;
    index += 1;
  }
  if (!mode) fail('Exactly one mode is required.');
  const permittedByMode = {
    prepare: [
      'db',
      'authority-selection',
      'migration-manifest',
      'migration-verification',
      'package-ui-manifest',
      'recovery-root',
      'out',
    ],
    'execute-approved': [
      'approval-packet',
      'confirm-live-migration',
      'recovery-root',
      'out',
    ],
    'prepare-finalization': [
      'approval-packet',
      'launch-receipt',
      'acceptance-receipt',
      'recovery-root',
      'out',
    ],
    'finalize-approved': [
      'finalization-packet',
      'confirm-finalization',
    ],
  };
  const required = permittedByMode[mode];
  if (!required) fail(`Unsupported mode: --${mode}.`);
  for (const key of required) if (!values[key]) fail(`--${key} is required for --${mode}.`);
  for (const key of Object.keys(values)) {
    if (!required.includes(key)) fail(`--${key} is not permitted for --${mode}.`);
  }
  return { mode, values };
}

function createLaunchIntent(packetRead, packetIdentity, bindings, output, context) {
  const intentDirectory = context.ensureIntentDirectory(
    bindings.canonical.userDataDir,
    context.inspectWindowsPathSecurity,
    context.protectWindowsDirectory,
  );
  const intentPath = path.join(intentDirectory, `${packetIdentity.hash}.intent.json`);
  writeDurableBlockingIntent(intentPath, {
    kind: 's7-live-migration-launch-intent',
    schemaVersion: 's7-live-migration-launch-intent/v1',
    generatedAt: nowIso(context.now),
    status: 'CONSUMED_BEFORE_SPAWN',
    packet: publicArtifact(packetRead.artifact),
    approvalPayloadSha256: packetIdentity.hash,
    database: bindings.db,
    package: bindings.package,
    requestedReceiptPath: output,
    processKillInvoked: false,
    automaticRetryInvoked: false,
    rollbackInvoked: false,
  });
  context.protectWindowsFile(intentPath);
  const artifact = publicArtifact(fileArtifact(intentPath, 'Live migration launch intent'));
  const windowsSecurity = context.inspectWindowsPathSecurity(intentPath, {
    label: 'Live migration launch intent',
    type: 'file',
    requireProtected: true,
  });
  if (windowsSecurity?.passed !== true) {
    fail('Live migration launch intent Windows ACL proof failed.');
  }
  return { ...artifact, windowsSecurity };
}

function startupGateArtifactBinding(value, label) {
  const identityValue = value?.identity;
  const deviceId = identityValue?.deviceId ?? identityValue?.dev;
  const fileId = identityValue?.fileId ?? identityValue?.ino;
  const hardLinkCount = identityValue?.hardLinkCount ?? identityValue?.nlink;
  const binding = {
    realPath: cleanAbsolute(value?.realPath, `${label} real path`),
    sha256: normalizeSha(value?.sha256, `${label} SHA-256`),
    sizeBytes: Number(value?.sizeBytes),
    identity: {
      deviceId: String(deviceId ?? ''),
      fileId: String(fileId ?? ''),
      hardLinkCount: Number(hardLinkCount),
    },
  };
  if (
    !Number.isInteger(binding.sizeBytes)
    || binding.sizeBytes < 1
    || !binding.identity.deviceId
    || !binding.identity.fileId
    || binding.identity.hardLinkCount !== 1
  ) {
    fail(`${label} does not have a strict single-file startup-gate identity.`);
  }
  return binding;
}

function startupGatePackageBinding(value) {
  const appContent = value?.appContent;
  if (
    !appContent
    || !Number.isInteger(Number(appContent.fileCount))
    || Number(appContent.fileCount) < 1
    || !Number.isInteger(Number(appContent.sizeBytes))
    || Number(appContent.sizeBytes) < 1
  ) {
    fail('Approved package app-content identity is invalid for the startup gate.');
  }
  return {
    exe: startupGateArtifactBinding(value.exe, 'Approved package executable'),
    appContent: {
      realPath: cleanAbsolute(appContent.realPath, 'Approved package app-content path'),
      sha256: normalizeSha(appContent.sha256, 'Approved package app-content SHA-256'),
      fileCount: Number(appContent.fileCount),
      sizeBytes: Number(appContent.sizeBytes),
    },
    main: startupGateArtifactBinding(value.main, 'Approved package Main'),
  };
}

function startupGateTrustedShellBinding(value) {
  const binding = {
    realPath: cleanAbsolute(value?.realPath, 'Trusted PowerShell real path'),
    sha256: normalizeSha(value?.sha256, 'Trusted PowerShell SHA-256'),
    sizeBytes: Number(value?.sizeBytes),
    identity: {
      deviceId: String(value?.identity?.deviceId ?? value?.identity?.dev ?? ''),
      fileId: String(value?.identity?.fileId ?? value?.identity?.ino ?? ''),
      hardLinkCount: Number(
        value?.identity?.hardLinkCount ?? value?.identity?.nlink,
      ),
    },
    hardlinkPaths: Array.isArray(value?.hardlinkPaths)
      ? value.hardlinkPaths.map((item) => cleanAbsolute(item, 'Trusted PowerShell hard link'))
      : [],
    signature: {
      status: String(value?.signature?.status || ''),
      subject: String(value?.signature?.subject || ''),
      thumbprint: String(value?.signature?.thumbprint || '').toUpperCase(),
    },
    version: {
      companyName: String(value?.version?.companyName || ''),
      fileVersion: String(value?.version?.fileVersion || ''),
      originalFilename: String(value?.version?.originalFilename || ''),
      productName: String(value?.version?.productName || ''),
    },
  };
  if (
    !Number.isInteger(binding.sizeBytes)
    || binding.sizeBytes < 1
    || !binding.identity.deviceId
    || !binding.identity.fileId
    || !Number.isInteger(binding.identity.hardLinkCount)
    || binding.identity.hardLinkCount < 1
    || binding.identity.hardLinkCount > TRUSTED_POWERSHELL_MAX_HARDLINKS
    || binding.hardlinkPaths.length !== binding.identity.hardLinkCount
    || binding.hardlinkPaths.reduce((total, item) => total + item.length, 0)
      > TRUSTED_POWERSHELL_MAX_HARDLINK_PATH_CHARACTERS
    || binding.signature.status !== 'Valid'
    || !TRUSTED_POWERSHELL_SIGNATURE_SUBJECT.test(binding.signature.subject)
    || !binding.signature.thumbprint
    || !/^Microsoft/i.test(binding.version.companyName)
    || !binding.version.fileVersion
    || !binding.version.originalFilename.toLowerCase().includes('powershell')
  ) {
    fail('Trusted PowerShell identity is invalid for the startup gate.');
  }
  return binding;
}

function createStartupGatePlan(bindings, launchIntent, context) {
  const gateDirectory = context.ensureStartupGateDirectory(
    bindings.canonical.userDataDir,
    context.inspectWindowsPathSecurity,
    context.protectWindowsDirectory,
  );
  const activePath = path.join(gateDirectory, STARTUP_GATE_ACTIVE_FILE);
  const boundPath = path.join(gateDirectory, STARTUP_GATE_BOUND_FILE);
  const handoffReadyPath = path.join(gateDirectory, STARTUP_GATE_HANDOFF_READY_FILE);
  const handoffReleasedPath = path.join(
    gateDirectory,
    STARTUP_GATE_HANDOFF_RELEASED_FILE,
  );
  const admissionPath = path.join(gateDirectory, STARTUP_GATE_ADMISSION_FILE);
  const closedPath = path.join(gateDirectory, STARTUP_GATE_CLOSED_FILE);
  const finalizedPath = path.join(gateDirectory, STARTUP_GATE_FINALIZED_FILE);
  const gateId = `gate-${crypto.randomUUID()}`;
  const invocationId = `invocation-${crypto.randomUUID()}`;
  const packageBinding = startupGatePackageBinding(bindings.package);
  const executableBinding = startupGateArtifactBinding(
    bindings.package.exe,
    'Approved executable',
  );
  const shellBinding = startupGateTrustedShellBinding(
    context.trustedPowerShellIdentity(),
  );
  const activeDocument = {
    kind: STARTUP_GATE_ACTIVE_KIND,
    schemaVersion: STARTUP_GATE_ACTIVE_SCHEMA,
    status: 'ACTIVE_AWAITING_BOUND_CHILD',
    gateId,
    invocationId,
    createdAt: nowIso(context.now),
    canonicalUserDataDir: bindings.canonical.userDataDir,
    paths: {
      active: activePath,
      bound: boundPath,
      handoffReady: handoffReadyPath,
      handoffReleased: handoffReleasedPath,
      admission: admissionPath,
      closed: closedPath,
      finalized: finalizedPath,
    },
    bindings: {
      executable: executableBinding,
      package: packageBinding,
      database: startupGateArtifactBinding(bindings.db, 'Authority database'),
      intent: startupGateArtifactBinding(launchIntent, 'Launch intent'),
      shell: shellBinding,
    },
  };
  return {
    gateDirectory,
    activePath,
    boundPath,
    handoffReadyPath,
    handoffReleasedPath,
    admissionPath,
    closedPath,
    finalizedPath,
    gateId,
    invocationId,
    activeDocument,
  };
}

function receiptPackageIdentity(value) {
  return {
    exe: {
      ...value.exe,
      identity: value.exe.identity ? { ...value.exe.identity } : null,
    },
    appContent: { ...value.appContent },
    main: {
      ...value.main,
      identity: value.main.identity ? { ...value.main.identity } : null,
    },
  };
}

function receiptProcessState(value) {
  return {
    passed: value?.passed === true,
    matching: Array.isArray(value?.matching)
      ? value.matching.map((item) => ({
          pid: Number.isInteger(Number(item?.pid)) ? Number(item.pid) : null,
          parentPid: Number.isInteger(Number(item?.parentPid))
            ? Number(item.parentPid)
            : null,
          executablePath: typeof item?.executablePath === 'string'
            ? item.executablePath
            : null,
        }))
      : [],
    unresolved: Array.isArray(value?.unresolved)
      ? value.unresolved.map((item) => String(item).slice(0, 120))
      : ['process-state-shape-invalid'],
  };
}

function boundedError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
  };
}

function normalizePackageLaunchState(value, attempted) {
  if (PACKAGE_LAUNCH_STATES.includes(value)) return value;
  return attempted ? 'UNKNOWN_AFTER_HANDOFF' : 'NOT_LAUNCHED';
}

function helperConfirmedClosed(result) {
  return Boolean(
    result?.outcome === 'close'
    && result?.helperClose?.outcome === 'close'
    && Number(result.helperClose.code) === 0
    && !result.helperClose.signal,
  );
}

function boundedUntrustedCandidate(error, exclusiveWindow, launch) {
  const errorProof = error?.proof && typeof error.proof === 'object'
    ? error.proof
    : launch?.result?.errorProof && typeof launch.result.errorProof === 'object'
      ? launch.result.errorProof
      : null;
  const numberOrNull = (value) => (
    Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
  );
  const booleanOrNull = (value) => (typeof value === 'boolean' ? value : null);
  const textOrNull = (value, limit = 120) => (
    typeof value === 'string' && value.trim() ? value.slice(0, limit) : null
  );
  const localPid = numberOrNull(launch?.pid);
  const proofPid = numberOrNull(errorProof?.pid);
  const helperPid = numberOrNull(errorProof?.helperPid)
    ?? numberOrNull(exclusiveWindow?.helperPid);
  if (!errorProof && !localPid && !helperPid) return null;
  return {
    trust: 'UNTRUSTED_CANDIDATE_ONLY',
    trustedForDecision: false,
    source: errorProof ? 'HELPER_ERROR_PROOF' : 'LOCAL_HANDOFF_STATE',
    protocol: textOrNull(errorProof?.protocol),
    status: textOrNull(errorProof?.status),
    candidatePid: proofPid ?? localPid,
    helperPid,
    phase: textOrNull(errorProof?.phase),
    processCreated: booleanOrNull(errorProof?.processCreated)
      ?? (['SPAWNED', 'RESUMED', 'CLOSED'].includes(errorProof?.status)
        ? true
        : launch?.createdSuspended === true
          ? true
          : null),
    processResumed: booleanOrNull(errorProof?.processResumed)
      ?? (['RESUMED', 'CLOSED'].includes(errorProof?.status)
        ? true
        : launch?.resumed === true
          ? true
          : null),
    databaseHandleExclusive: booleanOrNull(errorProof?.databaseHandleExclusive),
    databaseHandleAcquired: booleanOrNull(errorProof?.databaseHandleAcquired),
    databaseHandleReleased: booleanOrNull(errorProof?.databaseHandleReleased),
    releaseState: textOrNull(errorProof?.releaseState, 40),
    errorType: textOrNull(errorProof?.errorType),
    observedAt: textOrNull(errorProof?.observedAt, 40),
    scriptSha256: /^[A-F0-9]{64}$/.test(String(errorProof?.scriptSha256 || ''))
      ? String(errorProof.scriptSha256)
      : null,
    lateProofBuffer: errorProof?.lateProofBuffer
      && typeof errorProof.lateProofBuffer === 'object'
      ? {
          queuedProofs: Array.isArray(errorProof.lateProofBuffer.queuedProofs)
            ? errorProof.lateProofBuffer.queuedProofs.slice(-4).map((proof) => ({
                protocol: textOrNull(proof?.protocol),
                status: textOrNull(proof?.status),
                helperPid: numberOrNull(proof?.helperPid),
                candidatePid: numberOrNull(proof?.pid),
                phase: textOrNull(proof?.phase),
              }))
            : [],
          partialText: textOrNull(errorProof.lateProofBuffer.partialText, 1024),
          partialBytes: Number.isInteger(Number(errorProof.lateProofBuffer.partialBytes))
            ? Math.max(0, Number(errorProof.lateProofBuffer.partialBytes))
            : null,
          terminalCode: textOrNull(errorProof.lateProofBuffer.terminalCode, 80),
          closeOutcome: errorProof.lateProofBuffer.closeOutcome
            && typeof errorProof.lateProofBuffer.closeOutcome === 'object'
            ? {
                outcome: textOrNull(errorProof.lateProofBuffer.closeOutcome.outcome, 40),
                code: Number.isInteger(Number(errorProof.lateProofBuffer.closeOutcome.code))
                  ? Number(errorProof.lateProofBuffer.closeOutcome.code)
                  : null,
                signal: textOrNull(errorProof.lateProofBuffer.closeOutcome.signal, 40),
              }
            : null,
        }
      : null,
    helperInputState: textOrNull(errorProof?.helperInputState, 40),
    helperInputCloseError: errorProof?.helperInputCloseError
      && typeof errorProof.helperInputCloseError === 'object'
      ? {
          name: textOrNull(errorProof.helperInputCloseError.name, 80),
          message: textOrNull(errorProof.helperInputCloseError.message, 300),
        }
      : null,
    helperProcessUnrefRequested: booleanOrNull(errorProof?.helperProcessUnrefRequested),
    helperStdinUnrefRequested: booleanOrNull(errorProof?.helperStdinUnrefRequested),
    helperStdoutUnrefRequested: booleanOrNull(errorProof?.helperStdoutUnrefRequested),
    knownErrorProofFieldsPreserved: Boolean(errorProof),
  };
}

function collectSidecarState(dbPath) {
  const records = SIDECARS.map((suffix) => ({
    suffix,
    path: `${dbPath}${suffix}`,
    exists: exists(`${dbPath}${suffix}`),
  }));
  return {
    passed: records.every((record) => record.exists === false),
    records,
  };
}

function collectStablePostExitDatabase(context, databasePath) {
  const result = {
    passed: false,
    method: 'bracketed-stable-main-file-and-readonly-schema',
    before: null,
    after: null,
    sidecarsBefore: null,
    sidecarsAfter: null,
    schemaVersion: null,
    snapshot: null,
    error: null,
  };
  try {
    result.sidecarsBefore = collectSidecarState(databasePath);
    if (!result.sidecarsBefore.passed) {
      fail('Post-close authority database has SQLite sidecars before snapshot.');
    }
    const before = fileArtifact(databasePath, 'Post-close live authority database');
    result.before = publicArtifact(before);
    const schemaVersion = context.readSchemaVersion(before.realPath);
    const after = fileArtifact(databasePath, 'Post-close live authority database');
    result.after = publicArtifact(after);
    result.sidecarsAfter = collectSidecarState(databasePath);
    if (!sameArtifact(before, after) || !result.sidecarsAfter.passed) {
      fail('Post-close authority database was not stable across schema inspection.');
    }
    result.schemaVersion = schemaVersion;
    result.snapshot = {
      database: publicArtifact(after),
      schemaVersion,
    };
    result.passed = true;
  } catch (error) {
    result.error = boundedError(error);
    result.snapshot = null;
    result.schemaVersion = null;
  }
  return result;
}

function collectPostCloseEvidence(context, preSpawnPackage, databasePath) {
  let postExitPackage = null;
  let packageError = null;
  let processState = null;
  let processError = null;
  try {
    postExitPackage = context.packageIdentity();
  } catch (error) {
    packageError = boundedError(error);
  }
  try {
    processState = context.listProcesses();
    validateProcessState(processState, 'AmazonAIOpsAgent post-exit process check');
  } catch (error) {
    processError = boundedError(error);
  }
  const database = collectStablePostExitDatabase(context, databasePath);
  const packageMatches = postExitPackage
    ? samePackageIdentity(preSpawnPackage, postExitPackage)
    : false;
  return {
    receipt: {
      status: 'COLLECTED_AFTER_OBSERVED_CLOSE',
      collectedAt: nowIso(context.now),
      package: {
        passed: Boolean(postExitPackage && packageMatches && !packageError),
        identity: postExitPackage ? receiptPackageIdentity(postExitPackage) : null,
        matchesPreSpawn: packageMatches,
        error: packageError,
      },
      processes: {
        passed: Boolean(processState && !processError),
        state: processState ? receiptProcessState(processState) : null,
        error: processError,
      },
      database,
    },
    packageIdentity: postExitPackage,
    processState,
    databaseSnapshot: database.snapshot,
  };
}

function holdReceipt(packetArtifact, packetHash, reason, fields, context) {
  const attempted = fields.packageLaunchAttempted === true;
  const packageLaunchState = normalizePackageLaunchState(fields.packageLaunched, attempted);
  return {
    kind: KIND,
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso(context.now),
    status: 'HOLD',
    passed: false,
    formalAcceptance: false,
    authorityDatabaseMutated: attempted ? null : false,
    authorityDatabaseMutationState: attempted
      ? 'UNKNOWN_AFTER_CONSUMED_LAUNCH_ATTEMPT'
      : 'NOT_LAUNCHED',
    packageLaunchAttempted: attempted,
    packageLaunched: packageLaunchState,
    operatorDirectAdsExecutionInvoked: false,
    adsExecutionInvoked: attempted ? null : false,
    packageAdsExecutionState: attempted ? 'UNKNOWN' : 'NOT_LAUNCHED',
    approvalPacket: publicArtifact(packetArtifact),
    approvalPayloadSha256: packetHash,
    launchIntent: fields.launchIntent || null,
    startupGate: fields.startupGate || null,
    recoveryOutputSecurity: fields.recoveryOutputSecurity || null,
    launchExclusiveWindow: fields.launchExclusiveWindow || null,
    launch: fields.launch || null,
    untrustedCandidate: fields.untrustedCandidate || null,
    postCloseEvidence: fields.postCloseEvidence || null,
    reason: String(reason).slice(0, 500),
    requiredNextStep:
      'If a complete launch intent exists, do not reuse this packet. Preserve DB, sidecars, package diagnostics, intent, exclusive-window proof, and this HOLD receipt. Deleting or rolling back intent evidence is an integrity failure and requires HOLD plus a new packet and approval; local administrator deletion cannot be detected absolutely.',
  };
}

function prepareFinalization(values, context) {
  const canonical = resolveCanonicalPaths(context);
  const packageIdentity = context.packageIdentity();
  const boundary = isolatedRecoveryOutput(
    values.out,
    values['recovery-root'],
    canonical,
    packageIdentity,
    [
      values['approval-packet'],
      values['launch-receipt'],
      values['acceptance-receipt'],
    ],
    context.inspectWindowsPathSecurity,
  );
  const packet = createFinalizationPacket(
    {
      approvalPacket: values['approval-packet'],
      launchReceipt: values['launch-receipt'],
      acceptanceReceipt: values['acceptance-receipt'],
    },
    context,
  );
  const written = writeProtectedAtomicJson(
    boundary.output,
    packet,
    context,
    'S7 finalization packet',
  );
  return {
    exitCode: 0,
    outputPath: written.path,
    receipt: packet,
  };
}

function finalizeApproved(values, context) {
  const packetRead = readJsonStable(
    values['finalization-packet'],
    'S7 finalization packet',
  );
  const packetSecurity = context.inspectWindowsPathSecurity(
    packetRead.artifact.realPath,
    {
      label: 'S7 finalization packet',
      type: 'file',
      requireProtected: true,
    },
  );
  if (packetSecurity?.passed !== true) {
    fail('S7 finalization packet protected Windows ACL proof failed.');
  }
  validateFinalizationPacket(
    packetRead.value,
    values['confirm-finalization'],
  );
  const generatedAt = Date.parse(packetRead.value.generatedAt || '');
  if (!Number.isFinite(generatedAt) || generatedAt > context.now().valueOf() + 60_000) {
    fail('S7 finalization packet timestamp is invalid or future-dated.');
  }
  const saved = packetRead.value.bindings;
  const current = collectFinalizationEvidence(
    {
      approvalPacket: saved?.approvalPacket?.realPath,
      launchReceipt: saved?.launchReceipt?.realPath,
      acceptanceReceipt: saved?.acceptanceReceipt?.realPath,
    },
    context,
  );
  if (stableJson(current) !== stableJson(saved)) {
    fail('S7 finalization bindings drifted after explicit packet creation.');
  }
  const finalizationPacket = startupGateArtifactBinding(
    packetRead.artifact,
    'S7 finalization packet',
  );
  const finalizedBase = {
    kind: STARTUP_GATE_FINALIZED_KIND,
    schemaVersion: STARTUP_GATE_FINALIZED_SCHEMA,
    status: 'FINALIZED_FOR_POST_MIGRATION_STARTUP',
    finalizedAt: nowIso(context.now),
    gateId: current.gate.gateId,
    invocationId: current.gate.invocationId,
    canonicalUserDataDir: current.canonical.userDataDir,
    approvalPayloadSha256: current.approvalPayloadSha256,
    approvalPacket: current.approvalPacket,
    launchReceipt: current.launchReceipt,
    acceptanceReceipt: current.acceptanceReceipt,
    finalizationPacket,
    activeGate: current.gate.active,
    boundGate: current.gate.bound,
    handoffReady: current.gate.handoffReady,
    handoffReleased: current.gate.handoffReleased,
    admission: current.gate.admission,
    closed: current.gate.closed,
    databaseAfterMigration: current.databaseAfterMigration,
    packageAtMigration: current.packageAtMigration,
    shellAtMigration: current.shellAtMigration,
    machine: current.machine,
    authority: current.authority,
    formalAppReadiness: false,
    adsExecutionAuthorized: false,
  };
  const finalized = {
    ...finalizedBase,
    finalizationPayloadSha256: sha256(stableJson(finalizedBase)),
  };
  if (
    exists(current.canonical.finalizedPath)
    || exists(current.canonical.completionPath)
  ) {
    fail('FINALIZED or POST_MIGRATION_ADMITTED already exists; replay is blocked.');
  }
  const written = writeProtectedAtomicJson(
    current.canonical.finalizedPath,
    finalized,
    context,
    'S7 FINALIZED receipt',
  );
  const persisted = readJsonStable(written.path, 'Persisted S7 FINALIZED receipt');
  if (
    stableJson(persisted.value) !== stableJson(finalized)
    || !sameArtifact(persisted.artifact, written.artifact)
  ) {
    fail('Persisted S7 FINALIZED receipt differs after atomic publication.');
  }
  return {
    exitCode: 0,
    outputPath: written.path,
    receipt: finalized,
  };
}

async function executeApproved(values, context) {
  const outputCanonical = resolveCanonicalPaths(context);
  const outputPackageIdentity = context.packageIdentity();
  const preliminaryOutput = isolatedRecoveryOutput(
    values.out,
    values['recovery-root'],
    outputCanonical,
    outputPackageIdentity,
    [values['approval-packet']],
    context.inspectWindowsPathSecurity,
  );
  const packetRead = readJsonStable(values['approval-packet'], 'Approval packet');
  const savedArtifactPaths = [
    packetRead.value?.bindings?.authoritySelection?.realPath,
    packetRead.value?.bindings?.migrationManifest?.realPath,
    packetRead.value?.bindings?.migrationVerification?.realPath,
    packetRead.value?.bindings?.packageUi?.artifact?.realPath,
  ].filter((value) => typeof value === 'string');
  const isolatedOutput = isolatedRecoveryOutput(
    preliminaryOutput.output,
    preliminaryOutput.recoveryRoot,
    outputCanonical,
    outputPackageIdentity,
    [packetRead.artifact.realPath, ...savedArtifactPaths],
    context.inspectWindowsPathSecurity,
  );
  const output = isolatedOutput.output;
  const recoveryOutputSecurity = isolatedOutput.windowsSecurity;
  let packetIdentity;
  let launchIntent = null;
  let startupGatePlan = null;
  let packageLaunchAttempted = false;
  let packageLaunched = 'NOT_LAUNCHED';
  let current = null;
  let finalDb = null;
  let preSpawnPackage = null;
  let exclusiveWindow = null;
  let launchExclusiveWindow = null;
  let launch = null;
  let postCloseEvidence = null;
  try {
    packetIdentity = validatePacket(
      packetRead.value,
      packetRead.artifact,
      context,
      values['confirm-live-migration'],
    );
    const saved = packetRead.value.bindings;
    current = validateStage2Inputs(
      {
        db: saved?.db?.realPath,
        authoritySelection: saved?.authoritySelection?.realPath,
        migrationManifest: saved?.migrationManifest?.realPath,
        migrationVerification: saved?.migrationVerification?.realPath,
        packageUiManifest: saved?.packageUi?.artifact?.realPath,
      },
      context,
    );
    if (stableJson(saved) !== stableJson(current)) {
      fail('Approval bindings drifted since packet creation.');
    }

    finalDb = fileArtifact(current.db.realPath, 'Live authority database');
    if (!sameArtifact(current.db, finalDb)) {
      fail('Live authority DB drifted immediately before package launch.');
    }
    noSidecars(finalDb.realPath, 'Live authority database');
    validateAuthorityDatabaseSecurity(
      context,
      finalDb.realPath,
      'Live authority database final pre-spawn check',
    );
    validateProcessState(
      context.listProcesses(),
      'AmazonAIOpsAgent process final pre-spawn recheck',
    );
    validateExclusiveDbPreflight(
      context.exclusiveDbPreflight(finalDb.realPath),
      'Live authority DB final pre-spawn check',
    );
    preSpawnPackage = context.packageIdentity();
    assertPacketPackageIdentity(packetRead.value, preSpawnPackage);
    const launchAdjacentDb = fileArtifact(finalDb.realPath, 'Live authority database');
    if (!sameArtifact(finalDb, launchAdjacentDb)) {
      fail('Live authority DB drifted during the final package identity check.');
    }
    noSidecars(launchAdjacentDb.realPath, 'Live authority database');
    validateExclusiveDbPreflight(
      context.exclusiveDbPreflight(launchAdjacentDb.realPath),
      'Live authority DB launch-adjacent check',
    );

    const targetEnvironment = childEnvironment(context.env, current.canonical);
    exclusiveWindow = await context.acquireLaunchExclusiveWindow(
      launchAdjacentDb.realPath,
      preSpawnPackage.exe.realPath,
      targetEnvironment,
      DEFAULT_EXCLUSIVE_WINDOW_READY_TIMEOUT_MS,
    );
    let ready;
    try {
      ready = validateLaunchExclusiveReady(
        exclusiveWindow,
        launchAdjacentDb,
        context,
      );
    } catch (error) {
      if (error instanceof Error && !error.proof) {
        error.proof = exclusiveWindow?.proof || null;
      }
      throw error;
    }
    launchExclusiveWindow = {
      protocol: EXCLUSIVE_WINDOW_PROTOCOL,
      state: 'EXCLUSIVE_READY',
      ready,
      suspended: null,
      resumed: null,
      closed: null,
      sequence: [{ step: 'READY', at: ready.openedAt }],
      manualRecovery: null,
      processKillInvoked: false,
      automaticRetryInvoked: false,
      rollbackInvoked: false,
    };

    validateProcessState(
      context.listProcesses(),
      'AmazonAIOpsAgent process check under launch-exclusive DB lock',
    );
    noSidecars(launchAdjacentDb.realPath, 'Live authority database');
    const lockedPackage = context.packageIdentity();
    if (!samePackageIdentity(preSpawnPackage, lockedPackage)) {
      fail('Canonical package identity drifted while the live DB lock was held.');
    }
    preSpawnPackage = lockedPackage;

    launchIntent = createLaunchIntent(packetRead, packetIdentity, current, output, context);
    launchExclusiveWindow.sequence.push({
      step: 'INTENT_PERSISTED',
      at: nowIso(context.now),
      intentSha256: launchIntent.sha256,
    });
    startupGatePlan = createStartupGatePlan(current, launchIntent, context);
    const spawnRequestedAt = nowIso(context.now);
    packageLaunchAttempted = true;
    packageLaunched = 'UNKNOWN_AFTER_HANDOFF';
    launch = {
      pid: null,
      executablePath: null,
      approvedExecutablePath: preSpawnPackage.exe.realPath,
      requestedAt: spawnRequestedAt,
      startedAt: null,
      state: 'CREATE_SUSPENDED_REQUESTED',
      createdSuspended: false,
      resumed: false,
      packageIdentities: {
        preSpawn: receiptPackageIdentity(preSpawnPackage),
        suspended: null,
        postSpawn: null,
        postExit: null,
      },
      result: null,
      stdout: { captured: false, persisted: false },
      stderr: { captured: false, persisted: false },
      processKillInvoked: false,
      automaticRetryInvoked: false,
      rollbackInvoked: false,
    };
    const suspendedProof = await context.createSuspendedPackage(
      exclusiveWindow,
      DEFAULT_SPAWN_TIMEOUT_MS,
      startupGatePlan,
    );
    let suspended;
    try {
      suspended = validateSuspendedPackageProof(
        suspendedProof,
        ready,
        preSpawnPackage.exe.realPath,
        startupGatePlan,
        context,
      );
    } catch (error) {
      if (error instanceof Error && !error.proof) error.proof = suspendedProof;
      throw error;
    }
    launchExclusiveWindow.suspended = suspended;
    launchExclusiveWindow.state = 'SUSPENDED_AWAITING_VALIDATION';
    launchExclusiveWindow.sequence.push({ step: 'SPAWNED_SUSPENDED', at: suspended.createdAt });
    launchExclusiveWindow.sequence.push({
      step: 'STARTUP_GATE_ACTIVE_AND_BOUND',
      at: suspended.createdAt,
      gateId: suspended.startupGate.gateId,
      invocationId: suspended.startupGate.invocationId,
      activeSha256: suspended.startupGate.active.sha256,
      boundSha256: suspended.startupGate.bound.sha256,
    });
    launch.pid = suspended.pid;
    launch.createdSuspended = true;
    launch.state = 'SUSPENDED_AWAITING_VALIDATION';

    launch.executablePath = suspended.queriedExecutablePath;
    launchExclusiveWindow.sequence.push({
      step: 'PID_IMAGE_VERIFIED',
      at: nowIso(context.now),
      pid: suspended.pid,
    });
    const suspendedPackage = context.packageIdentity();
    if (!samePackageIdentity(preSpawnPackage, suspendedPackage)) {
      fail('Canonical package identity drifted while its approved process was suspended.');
    }
    launch.packageIdentities.suspended = receiptPackageIdentity(suspendedPackage);

    const suspendedProcessState = validateSpawnProcessState(
      context.listSuspendedProcesses(),
      suspended.pid,
    );
    if (suspendedProcessState.matching.length !== 1) {
      fail('Suspended launch window contained more than the one approved package PID.');
    }
    const finalNodeInventoryAt = nowIso(context.now);
    const resumedProof = await context.releaseAndResumePackage(
      exclusiveWindow,
      DEFAULT_EXCLUSIVE_WINDOW_COMMAND_TIMEOUT_MS,
    );
    let resumed;
    try {
      resumed = validateLaunchExclusiveReleased(
        resumedProof,
        ready,
        suspended,
        context,
      );
    } catch (error) {
      if (error instanceof Error && !error.proof) error.proof = resumedProof;
      throw error;
    }
    launch.suspendedProcessState = suspendedProcessState;
    launchExclusiveWindow.sequence.push({
      step: 'SAME_NAME_PROCESS_SET_VERIFIED',
      at: finalNodeInventoryAt,
      pid: suspended.pid,
      matchingCount: suspendedProcessState.matching.length,
    });
    launchExclusiveWindow.resumed = resumed;
    launchExclusiveWindow.sameNameRaceBoundary = {
      operatorAdjacentInventory: true,
      helperAdjacentInventory: resumed.finalSameNameInventoryPassed === true,
      helperMatchingCount: resumed.finalSameNameProcessCount,
      absoluteStartPrevention: false,
      packagedMainStartupGateRequiredForFormalAcceptance: true,
    };
    launchExclusiveWindow.state = 'RESUMED_AND_RUNNING';
    launchExclusiveWindow.sequence.push({
      step: 'DB_RELEASED_AND_PROCESS_RESUMED',
      at: resumed.resumedAt,
      releasedAt: resumed.releasedAt,
      pid: resumed.pid,
    });
    launch.resumed = true;
    launch.startedAt = resumed.resumedAt;
    launch.state = 'RUNNING';
    packageLaunched = 'CONFIRMED_LAUNCHED';

    let postSpawnIssue = null;
    try {
      const postSpawnPackage = context.packageIdentity();
      if (!samePackageIdentity(preSpawnPackage, postSpawnPackage)) {
        fail('Canonical package identity drifted across controlled resume.');
      }
      launch.packageIdentities.postSpawn = receiptPackageIdentity(postSpawnPackage);
    } catch (error) {
      postSpawnIssue = boundedError(error);
      launch.postSpawnIdentityError = postSpawnIssue;
    }

    const result = await context.waitForManagedPackageClose(
      exclusiveWindow,
      DEFAULT_EXIT_TIMEOUT_MS,
    );
    launch.result = result;
    launchExclusiveWindow.helperLifecycle = {
      packageCloseObserved: result?.outcome === 'close',
      helperClose: result?.helperClose ?? null,
      helperConfirmedClosed: helperConfirmedClosed(result),
      cleanup: null,
    };
    if (result?.outcome === 'timeout') {
      launch.state = 'RUNNING_UNRESOLVED';
      launch.detach = context.detachManagedLaunch(exclusiveWindow);
      launchExclusiveWindow.helperLifecycle.cleanup = launch.detach;
      launchExclusiveWindow.state = 'RUNNING_UNRESOLVED';
      fail('Canonical package launch timed out and remains an unresolved external process.');
    }
    if (result?.outcome !== 'close') {
      launch.state = 'PROCESS_STATE_UNRESOLVED';
      launch.detach = context.detachManagedLaunch(exclusiveWindow);
      launchExclusiveWindow.helperLifecycle.cleanup = launch.detach;
      launchExclusiveWindow.state = 'PROCESS_STATE_UNRESOLVED';
      fail(`Canonical package close could not be observed: ${result?.outcome || 'unknown'}.`);
    }

    launch.state = 'CLOSED_AWAITING_EVIDENCE_CLASSIFICATION';
    launchExclusiveWindow.closed = {
      protocol: result.proof?.protocol ?? EXCLUSIVE_WINDOW_PROTOCOL,
      status: result.proof?.status ?? 'CLOSED',
      helperPid: Number(result.proof?.helperPid ?? ready.helperPid),
      pid: Number(result.proof?.pid ?? suspended.pid),
      exitCode: Number(result.code),
      signal: result.signal ?? null,
      closedAt: result.closedAt ?? result.proof?.closedAt ?? null,
      helperClose: result.helperClose ?? null,
    };
    launchExclusiveWindow.state = 'CLOSED_AWAITING_EVIDENCE_CLASSIFICATION';
    launchExclusiveWindow.sequence.push({
      step: 'CLOSE_OBSERVED',
      at: launchExclusiveWindow.closed.closedAt || nowIso(context.now),
      pid: launchExclusiveWindow.closed.pid,
      exitCode: launchExclusiveWindow.closed.exitCode,
    });
    postCloseEvidence = collectPostCloseEvidence(
      context,
      preSpawnPackage,
      finalDb.realPath,
    );
    launch.postCloseEvidence = postCloseEvidence.receipt;
    launchExclusiveWindow.sequence.push({
      step: 'POST_CLOSE_EVIDENCE_COLLECTED',
      at: postCloseEvidence.receipt.collectedAt,
    });
    if (postCloseEvidence.packageIdentity) {
      launch.packageIdentities.postExit = receiptPackageIdentity(
        postCloseEvidence.packageIdentity,
      );
    }

    let validatedClose;
    try {
      validatedClose = validateControlledCloseProof(
        result,
        ready,
        suspended,
        resumed,
        context,
      );
    } catch (error) {
      if (error instanceof Error && !error.proof) error.proof = result?.proof || null;
      throw error;
    }
    launchExclusiveWindow.closed.closedAt = validatedClose.closedAt;
    launchExclusiveWindow.closed.startupGate = validatedClose.startupGate;
    launchExclusiveWindow.sameNameRaceBoundary.absoluteStartPrevention = true;
    launchExclusiveWindow.sameNameRaceBoundary.packagedMainStartupGateRequiredForFormalAcceptance = false;
    launchExclusiveWindow.sameNameRaceBoundary.packagedMainStartupGate = 'INTEGRATED_AND_PROVEN';
    launchExclusiveWindow.sequence.push({
      step: 'MAIN_ADMISSION_AND_HELPER_CLOSED_BOUND',
      at: validatedClose.closedAt,
      admissionSha256: validatedClose.startupGate.admission.sha256,
      closedSha256: validatedClose.startupGate.closed.sha256,
    });
    if (result.code !== 0 || result.signal) {
      fail(
        `Canonical package launch closed abnormally after evidence collection: `
          + `code=${String(result.code)}, signal=${String(result.signal)}.`,
      );
    }
    if (
      result.helperClose?.outcome !== 'close'
      || result.helperClose.code !== 0
      || result.helperClose.signal
    ) {
      fail('Controlled launch helper did not close normally after package close.');
    }
    if (postSpawnIssue) {
      fail(`Post-resume package identity was not trustworthy: ${postSpawnIssue.message}`);
    }
    if (postCloseEvidence.receipt.package.passed !== true) {
      fail('Post-close package identity evidence failed.');
    }
    if (postCloseEvidence.receipt.processes.passed !== true) {
      fail('Post-close same-name process evidence failed.');
    }
    if (
      postCloseEvidence.receipt.database.passed !== true
      || !postCloseEvidence.databaseSnapshot
    ) {
      fail('Post-close authority DB could not be bound to one stable snapshot.');
    }
    const postVersion = postCloseEvidence.databaseSnapshot.schemaVersion;
    if (postVersion !== TARGET_VERSION) {
      fail(`Canonical package exited but live schema is not v${TARGET_VERSION}.`);
    }
    launch.state = 'CLOSED_EVIDENCE_COLLECTED';
    launchExclusiveWindow.state = 'CLOSED_EVIDENCE_COLLECTED';

    const receipt = {
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: nowIso(context.now),
      status: 'LAUNCHED_AWAITING_READONLY_ACCEPTANCE',
      passed: false,
      formalAcceptance: false,
      authorityDatabaseMutated: true,
      packageLaunchAttempted: true,
      packageLaunched: 'CONFIRMED_LAUNCHED',
      operatorDirectAdsExecutionInvoked: false,
      adsExecutionInvoked: null,
      packageAdsExecutionState: 'UNKNOWN',
      approvalPacket: publicArtifact(packetRead.artifact),
      approvalPayloadSha256: packetIdentity.hash,
      launchIntent,
      startupGate: validatedClose.startupGate,
      recoveryOutputSecurity,
      launchExclusiveWindow,
      launch,
      postCloseEvidence: postCloseEvidence.receipt,
      postLaunch: postCloseEvidence.databaseSnapshot,
      remainingAcceptanceDependencies: {
        packagedMainStartupSameNameGate: 'INTEGRATED_AND_PROVEN',
        formalAcceptanceBlocked: true,
        separateReadonlyAcceptanceRequired: true,
      },
      requiredNextStep:
        'Run verify:s7-live-migration-acceptance separately before store configuration, scheduler recovery, collection, or Ads execution.',
    };
    writeProtectedRecoveryOutput(output, receipt, context, 'Launch receipt');
    return { exitCode: 0, receipt, outputPath: output };
  } catch (error) {
    if (exclusiveWindow) {
      try {
        if (!packageLaunchAttempted) {
          const abort = context.abortUnlaunchedExclusiveWindow(exclusiveWindow);
          if (launchExclusiveWindow) launchExclusiveWindow.abort = abort;
        } else if (!helperConfirmedClosed(launch?.result) && !launch?.detach) {
          const detach = context.detachManagedLaunch(exclusiveWindow);
          if (launch) launch.detach = detach;
          if (launchExclusiveWindow) {
            launchExclusiveWindow.helperLifecycle = {
              packageCloseObserved: launch?.result?.outcome === 'close',
              helperClose: launch?.result?.helperClose ?? null,
              helperConfirmedClosed: false,
              cleanup: detach,
            };
            launchExclusiveWindow.manualRecovery = {
              required: true,
              reason: (
                launch?.createdSuspended === true
                || error?.proof?.status === 'SPAWNED'
                || error?.proof?.processCreated === true
              ) && launch?.resumed !== true
                ? 'SUSPENDED_PROCESS_NOT_CONFIRMED_RESUMED'
                : 'CONTROLLED_LAUNCH_STATE_UNRESOLVED',
              automaticResumeInvoked: false,
              processKillInvoked: false,
              requiredAction:
                'Preserve the helper PID, suspended/running package PID, DB, sidecars, intent, and HOLD receipt. Do not retry; perform manual recovery and obtain a new packet and approval.',
            };
          }
        }
      } catch {
        // A detach failure never authorizes a retry or changes HOLD.
      }
    }
    const untrustedCandidate = boundedUntrustedCandidate(error, exclusiveWindow, launch);
    const packetArtifact = packetRead?.artifact || {
      path: typeof values['approval-packet'] === 'string' ? values['approval-packet'] : null,
      realPath: null,
      sha256: null,
      sizeBytes: null,
      mtimeMs: null,
      identity: null,
    };
    const receipt = holdReceipt(
      packetArtifact,
      packetIdentity?.hash || null,
      error instanceof Error ? error.message : String(error),
      {
        packageLaunchAttempted,
        packageLaunched,
        launchIntent,
        startupGate: startupGatePlan,
        recoveryOutputSecurity,
        launchExclusiveWindow,
        launch,
        untrustedCandidate,
        postCloseEvidence: postCloseEvidence?.receipt || null,
      },
      context,
    );
    writeProtectedRecoveryOutput(output, receipt, context, 'Launch HOLD receipt');
    return { exitCode: 1, receipt, outputPath: output };
  }
}

async function run(argv = process.argv.slice(2), injected = {}) {
  const parsed = parseArgs(argv);
  const context = defaultContext(injected);
  validateContext(context);
  if (parsed.mode === 'help') {
    context.writeStdout(`${USAGE}\n`);
    return { exitCode: 0, outputPath: null, receipt: null };
  }
  assertWindows(context);
  if (parsed.mode === 'prepare') {
    const packet = createPacket(
      {
        db: parsed.values.db,
        authoritySelection: parsed.values['authority-selection'],
        migrationManifest: parsed.values['migration-manifest'],
        migrationVerification: parsed.values['migration-verification'],
        packageUiManifest: parsed.values['package-ui-manifest'],
      },
      context,
    );
    const isolatedOutput = isolatedRecoveryOutput(
      parsed.values.out,
      parsed.values['recovery-root'],
      packet.bindings.canonical,
      packet.bindings.package,
      [
        parsed.values['authority-selection'],
        parsed.values['migration-manifest'],
        parsed.values['migration-verification'],
        parsed.values['package-ui-manifest'],
      ],
      context.inspectWindowsPathSecurity,
    );
    const outputPath = writeProtectedRecoveryOutput(
      isolatedOutput.output,
      packet,
      context,
      'Approval packet',
    );
    context.writeStdout(`${JSON.stringify(packet, null, 2)}\n`);
    return { exitCode: 0, packet, outputPath };
  }
  if (parsed.mode === 'prepare-finalization') {
    const result = prepareFinalization(parsed.values, context);
    context.writeStdout(`${JSON.stringify(result.receipt, null, 2)}\n`);
    return result;
  }
  if (parsed.mode === 'finalize-approved') {
    const result = finalizeApproved(parsed.values, context);
    context.writeStdout(`${JSON.stringify(result.receipt, null, 2)}\n`);
    return result;
  }
  const result = await executeApproved(parsed.values, context);
  context.writeStdout(`${JSON.stringify(result.receipt, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  run()
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      process.stderr.write(
        `[S7 LIVE MIGRATION LAUNCH BLOCKED] ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  CANONICAL_APP,
  CANONICAL_EXE,
  CANONICAL_MAIN,
  EXCLUSIVE_WINDOW_HELPER_BOOTSTRAP,
  EXCLUSIVE_WINDOW_HELPER_SCRIPT,
  KIND,
  PACKET_KIND,
  PACKET_SCHEMA_VERSION,
  FINALIZATION_PACKET_KIND,
  FINALIZATION_PACKET_SCHEMA,
  REQUIRED_MIGRATION_VERIFICATION_CODES,
  SCHEMA_VERSION,
  USAGE,
  createPacket,
  createFinalizationPacket,
  defaultAcquireLaunchExclusiveWindow,
  defaultInspectWindowsPathSecurity,
  defaultPackageIdentity,
  defaultProtectWindowsDirectory,
  defaultProtectWindowsFile,
  executeApproved,
  finalizeApproved,
  fileArtifact,
  parseArgs,
  postMigrationAuthorityContract,
  prepareFinalization,
  resolveTrustedWindowsPowerShell,
  run,
  stableJson,
  validatePackageUi,
};
