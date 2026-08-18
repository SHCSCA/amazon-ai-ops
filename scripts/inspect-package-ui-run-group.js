#!/usr/bin/env node
/*
 * Secret-blind, source-read-only preflight for a paused Package UI evidence v8
 * run group. The inspector never launches Electron or a browser. SQLite source
 * files are opened only by the project's query-only online-backup helper; all
 * temporary backup files are created below the OS temp directory and removed
 * before returning.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  CURRENTNESS_METHOD,
  SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
  runReadonlySqliteOnlineBackupSync,
} = require('./sqlite-authority-currentness');
const {
  cleanupOwnedSqliteTempRoot,
  restrictWindowsTempAcl,
} = require('./protected-sqlite-temp');
const { validateEvidenceUserDataPath } = require('./evidence-user-data');

const ROOT = path.resolve(__dirname, '..');
const RUN_GROUP_SCHEMA = 'package-ui-run-group/v2';
const CHECKPOINT_SCHEMA = 'package-ui-profile-checkpoint/v2';
const ATTEMPT_SCHEMA = 'package-ui-profile-attempt/v3';
const ATTEMPT_INVOCATION_SCHEMA = 'package-ui-attempt-invocation/v1';
const INVOCATION_RECEIPT_SCHEMA = 'package-ui-invocation-receipt/v1';
const RESUME_INSPECTION_SCHEMA = 'package-ui-resume-inspection/v1';
const PROFILE_SEQUENCE = Object.freeze(['100-compact', '125-compact', 'wide-1400x900-100']);
const EXPECTED_OVERLAY_IDS = Object.freeze([
  'report-selector-dialog',
  'decisions-controlled-review-inspector',
  'readback-technical-drawer',
]);
const BUNDLED_CHROMIUM_RELATIVE_PATH = 'playwright-browsers/chrome-win64/chrome.exe';
const DEFAULT_EXE = path.join(ROOT, 'apps', 'desktop', 'release', 'win-unpacked', 'AmazonAIOpsAgent.exe');
const DEFAULT_APP_CONTENT = path.join(ROOT, 'apps', 'desktop', 'release', 'win-unpacked', 'resources', 'app');
const PACKAGED_APP_NAME = '@amazon-ai-ops/desktop';
const TEMP_ROOT_PREFIX = 'amazon-ai-ops-package-ui-inspector-';
let cachedDefaultProtectedDatabasePath = null;
const DIAGNOSTIC_MESSAGE_LIMIT = 2_000;
const DIAGNOSTIC_STACK_LIMIT = 4_000;
const DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT = 100;
const PROFILE_LOCK_MAX_ENTRIES = 20_000;
const PROFILE_LOCK_MAX_PATH_CHARACTERS = 2_000_000;
const PROFILE_LOCK_MAX_CRITICAL_ENTRIES = 1_024;
const SENSITIVE_DIAGNOSTIC_KEY = /^(?:account|api[_-]?key|access[_-]?token|authorization|commandline|cookie|password|passwd|proxy-authorization|pwd|secret|session(?:[_-]?(?:id|key|token))?|set-cookie|token|username|user[_-]?name)$/i;
const ALLOWED_RUN_GROUP_ENTRIES = Object.freeze([
  'attempts',
  'checkpoints',
  'invocation-receipts',
  'invocations',
  'manifests',
  'profile-attempt-artifacts',
  'run-group.json',
]);

const USAGE = [
  'Usage: node scripts/inspect-package-ui-run-group.js',
  '  --output <evidence-root> --resume-run-group <run-group-id>',
  '  --expected-exe-sha256 <SHA256> --expected-app-content-sha256 <SHA256>',
  '  --user-data-dir <isolated-profile> --protected-db <authority-db>',
  '  --authority-selection <current-production-authority-selection.json>',
  '',
  'The production EXE and resources/app paths are fixed and cannot be overridden.',
  'Exit 0 only for RESUME_SAFE. The JSON output includes exact one-time resume argv.',
  'This command never launches Electron, Playwright, Chromium, or an evidence run.',
].join('\n');

class InspectionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new InspectionError(code, message);
}

function resolveWindowsKnownFolder(specialFolder, label, run = spawnSync) {
  if (process.platform !== 'win32') {
    throw new Error('Production authority resolution is supported only on Windows.');
  }
  const allowed = new Set(['ApplicationData', 'UserProfile']);
  if (!allowed.has(specialFolder)) {
    throw new Error('Unsupported Windows Known Folder request.');
  }
  const result = run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `[Environment]::GetFolderPath([Environment+SpecialFolder]::${specialFolder})`,
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 20_000,
    windowsHide: true,
  });
  const value = String(result?.stdout || '').trim();
  if (result?.error || result?.status !== 0 || result?.signal || !path.isAbsolute(value)) {
    throw new Error(`Windows Known Folder lookup for ${label} failed.`);
  }
  return path.resolve(value);
}

function canonicalAuthorityPaths(injected = {}) {
  const resolveKnownFolder = injected.resolveWindowsKnownFolder || resolveWindowsKnownFolder;
  const roamingAppData = resolveKnownFolder('ApplicationData', 'Roaming AppData');
  const userProfile = resolveKnownFolder('UserProfile', 'User Profile');
  const userDataDir = path.join(roamingAppData, ...PACKAGED_APP_NAME.split('/'));
  return {
    databasePath: path.join(userDataDir, 'amazon-ai-ops.db'),
    roamingAppData,
    userDataDir,
    userProfile,
  };
}

function defaultProtectedDatabasePath() {
  if (process.platform !== 'win32') return '';
  cachedDefaultProtectedDatabasePath ||= canonicalAuthorityPaths().databasePath;
  return cachedDefaultProtectedDatabasePath;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function normalizedPath(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function lexicalWindowsPath(value) {
  return path.win32.normalize(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function samePath(left, right) {
  return normalizedPath(left) === normalizedPath(right);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function hasOnlyKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIsoDate(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function statIdentityMatches(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function stableFileRead(filePath, label, code = 'RECORD_ROOT_INVALID') {
  const requested = path.resolve(filePath);
  let beforePath;
  let realBefore;
  let descriptor;
  try {
    beforePath = fs.lstatSync(requested);
    if (beforePath.isSymbolicLink() || !beforePath.isFile() || beforePath.nlink !== 1) {
      fail(code, `${label} must be a unique, direct regular file.`);
    }
    realBefore = fs.realpathSync.native(requested);
    if (!samePath(realBefore, requested)) fail(code, `${label} may not traverse a link.`);
    descriptor = fs.openSync(realBefore, 'r');
    const beforeHandle = fs.fstatSync(descriptor);
    if (!statIdentityMatches(beforePath, beforeHandle)) fail(code, `${label} identity changed before reading.`);
    const buffer = fs.readFileSync(descriptor);
    const afterHandle = fs.fstatSync(descriptor);
    const afterPath = fs.lstatSync(requested);
    const realAfter = fs.realpathSync.native(requested);
    if (
      afterPath.isSymbolicLink()
      || !afterPath.isFile()
      || afterPath.nlink !== 1
      || !samePath(realBefore, realAfter)
      || !statIdentityMatches(beforeHandle, afterHandle)
      || !statIdentityMatches(afterHandle, afterPath)
      || buffer.length !== afterHandle.size
    ) {
      fail(code, `${label} changed while being read.`);
    }
    return {
      buffer,
      file: {
        mtime: afterPath.mtime.toISOString(),
        mtimeMs: afterPath.mtimeMs,
        path: realAfter,
        sha256: sha256Buffer(buffer),
        sizeBytes: buffer.length,
      },
      stat: afterPath,
    };
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    fail(code, `${label} is missing, unreadable, or unstable.`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function safeFileArtifact(filePath, label, code) {
  const { file } = stableFileRead(filePath, label, code);
  return file;
}

function safeDirectory(directoryPath, label, code = 'RECORD_ROOT_INVALID') {
  const requested = path.resolve(directoryPath);
  try {
    const stat = fs.lstatSync(requested);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(code, `${label} must be a direct directory.`);
    const real = fs.realpathSync.native(requested);
    if (!samePath(real, requested)) fail(code, `${label} may not traverse a link.`);
    return real;
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    fail(code, `${label} is missing, unreadable, or unstable.`);
  }
}

function directoryTreeManifest(directoryPath, label, code = 'RECORD_ROOT_INVALID') {
  const root = safeDirectory(directoryPath, label, code);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const candidate = path.join(directory, entry.name);
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) fail(code, `${label} contains a symbolic link or junction.`);
      const real = fs.realpathSync.native(candidate);
      if (!isWithin(root, real)) fail(code, `${label} escaped its root.`);
      if (stat.isDirectory()) visit(real);
      else if (stat.isFile() && stat.nlink === 1) {
        const artifact = safeFileArtifact(candidate, `${label} file`, code);
        files.push({
          path: path.relative(root, real).split(path.sep).join('/'),
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
        });
      } else fail(code, `${label} contains an unsupported or hard-linked entry.`);
    }
  };
  visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {
    fileCount: files.length,
    files,
    sha256: sha256Buffer(Buffer.from(canonicalJson({ files, schemaVersion: 1 }), 'utf8')),
    sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
}

function appContentManifest(appContentPath) {
  const root = safeDirectory(appContentPath, 'App content', 'PACKAGE_APP_CONTENT_INVALID');
  const manifest = directoryTreeManifest(root, 'App content', 'PACKAGE_APP_CONTENT_INVALID');
  return {
    root,
    sha256: sha256Buffer(Buffer.from(JSON.stringify({
      schemaVersion: 1,
      files: manifest.files,
    }), 'utf8')),
    files: manifest.files,
  };
}

function profileManifest(profilePath) {
  const manifest = directoryTreeManifest(profilePath, 'Isolated profile', 'PROFILE_CONTENT_INVALID');
  return {
    fileCount: manifest.fileCount,
    sha256: (() => {
      const digest = crypto.createHash('sha256');
      for (const record of manifest.files) {
        digest.update(record.path, 'utf8');
        digest.update('\0');
        digest.update(record.sha256, 'ascii');
        digest.update('\0');
        digest.update(String(record.sizeBytes), 'ascii');
        digest.update('\n');
      }
      return digest.digest('hex').toUpperCase();
    })(),
    sizeBytes: manifest.sizeBytes,
  };
}

function sqliteSourceBundle(databasePath) {
  const database = stableFileRead(databasePath, 'SQLite source database', 'PROTECTED_DB_CAPTURE_INVALID');
  const entries = [{ buffer: database.buffer, suffix: '' }];
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const candidate = `${database.file.path}${suffix}`;
    if (!fs.existsSync(candidate)) continue;
    const sidecar = stableFileRead(candidate, 'SQLite source sidecar', 'PROTECTED_DB_CAPTURE_INVALID');
    entries.push({ buffer: sidecar.buffer, suffix });
  }
  return {
    entries,
    signature: entries.map((entry) => ({
      sha256: sha256Buffer(entry.buffer),
      sizeBytes: entry.buffer.length,
      suffix: entry.suffix,
    })),
  };
}

function sqliteLogicalArtifact(databasePath, label = 'package-ui-inspector', injected = {}) {
  const tempParent = safeDirectory(
    injected.tempParent || os.tmpdir(),
    'OS temporary directory',
    'PROTECTED_DB_CAPTURE_INVALID',
  );
  const tempRoot = fs.mkdtempSync(path.join(tempParent, TEMP_ROOT_PREFIX), { encoding: 'utf8' });
  const directRoot = safeDirectory(tempRoot, 'SQLite temporary root', 'PROTECTED_DB_CAPTURE_INVALID');
  if (!samePath(path.dirname(directRoot), tempParent) || !path.basename(directRoot).startsWith(TEMP_ROOT_PREFIX)) {
    fail('PROTECTED_DB_CAPTURE_INVALID', 'SQLite temporary root escaped the validated OS temp parent.');
  }
  const sourceCopyPath = path.join(tempRoot, 'source.db');
  const destinationPath = path.join(tempRoot, 'logical-online-backup.db');
  try {
    restrictWindowsTempAcl(directRoot, {
      spawnSync: injected.spawnSync || spawnSync,
    });
    const sourceBefore = sqliteSourceBundle(databasePath);
    for (const entry of sourceBefore.entries) {
      fs.writeFileSync(`${sourceCopyPath}${entry.suffix}`, entry.buffer, { flag: 'wx', mode: 0o600 });
    }
    const sourceAfterCopy = sqliteSourceBundle(databasePath);
    if (canonicalJson(sourceBefore.signature) !== canonicalJson(sourceAfterCopy.signature)) {
      fail('PROTECTED_DB_CAPTURE_INVALID', 'SQLite source database changed while its read-only snapshot was copied.');
    }
    const backupRunner = injected.runReadonlySqliteOnlineBackupSync || runReadonlySqliteOnlineBackupSync;
    const proof = backupRunner({
      destinationPath,
      ownedTempRoot: directRoot,
      sourceDatabasePath: sourceCopyPath,
    });
    const backup = safeFileArtifact(destinationPath, 'SQLite online-backup result', 'PROTECTED_DB_CAPTURE_INVALID');
    if (
      backup.sha256 !== proof.observedBackup.sha256
      || backup.sizeBytes !== proof.observedBackup.sizeBytes
    ) {
      fail('PROTECTED_DB_CAPTURE_INVALID', 'SQLite online-backup result changed before inspection.');
    }
    return {
      method: proof.method,
      remainingPages: proof.observedBackup.remainingPages,
      schemaVersion: proof.schemaVersion,
      sha256: proof.observedBackup.sha256,
      sizeBytes: proof.observedBackup.sizeBytes,
      totalPages: proof.observedBackup.totalPages,
    };
  } finally {
    cleanupOwnedSqliteTempRoot(
      tempParent,
      directRoot,
      TEMP_ROOT_PREFIX,
      injected,
    );
  }
}

function validLogicalArtifact(value) {
  return hasOnlyKeys(value, ['method', 'remainingPages', 'schemaVersion', 'sha256', 'sizeBytes', 'totalPages'])
    && value.schemaVersion === SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION
    && value.method === CURRENTNESS_METHOD
    && value.remainingPages === 0
    && Number.isInteger(value.totalPages)
    && value.totalPages > 0
    && /^[A-F0-9]{64}$/.test(String(value.sha256 || ''))
    && Number.isInteger(value.sizeBytes)
    && value.sizeBytes > 0;
}

function validAuthorityBinding(value) {
  return hasOnlyKeys(value, [
    'authoritySelectionReceiptSha256',
    'canonicalDatabasePathSha256',
    'databaseFileIdentity',
  ])
    && /^[A-F0-9]{64}$/.test(String(value.authoritySelectionReceiptSha256 || ''))
    && /^[A-F0-9]{64}$/.test(String(value.canonicalDatabasePathSha256 || ''))
    && hasOnlyKeys(value.databaseFileIdentity, [
      'deviceId',
      'fileId',
      'hardLinkCount',
      'stabilityTokenSha256',
    ])
    && typeof value.databaseFileIdentity.deviceId === 'string'
    && value.databaseFileIdentity.deviceId.length > 0
    && typeof value.databaseFileIdentity.fileId === 'string'
    && value.databaseFileIdentity.fileId.length > 0
    && value.databaseFileIdentity.hardLinkCount === 1
    && /^[A-F0-9]{64}$/.test(
      String(value.databaseFileIdentity.stabilityTokenSha256 || ''),
    );
}

function currentAuthorityBinding(databasePath, receiptSha256, canonicalDatabasePath) {
  const resolved = path.resolve(databasePath);
  const stat = fs.statSync(resolved, { bigint: true });
  const stabilityToken = [
    stat.dev,
    stat.ino,
    stat.nlink,
    stat.size,
    stat.ctimeNs,
    stat.mtimeNs,
  ].join(':');
  return {
    authoritySelectionReceiptSha256: receiptSha256,
    canonicalDatabasePathSha256: sha256Buffer(Buffer.from(
      lexicalWindowsPath(canonicalDatabasePath),
      'utf8',
    )),
    databaseFileIdentity: {
      deviceId: stat.dev.toString(),
      fileId: stat.ino.toString(),
      hardLinkCount: Number(stat.nlink),
      stabilityTokenSha256: sha256Buffer(Buffer.from(stabilityToken, 'utf8')),
    },
  };
}

function validProfileState(value) {
  return hasOnlyKeys(value, ['capturedAt', 'logicalDatabase', 'profileContent'])
    && validIsoDate(value.capturedAt)
    && validLogicalArtifact(value.logicalDatabase)
    && hasOnlyKeys(value.profileContent, ['fileCount', 'sha256', 'sizeBytes'])
    && Number.isInteger(value.profileContent.fileCount)
    && value.profileContent.fileCount > 0
    && /^[A-F0-9]{64}$/.test(String(value.profileContent.sha256 || ''))
    && Number.isInteger(value.profileContent.sizeBytes)
    && value.profileContent.sizeBytes > 0;
}

function stateMatches(left, right) {
  return validProfileState(left)
    && validProfileState(right)
    && logicalMatches(left.logicalDatabase, right.logicalDatabase)
    && left.profileContent.sha256 === right.profileContent.sha256
    && left.profileContent.fileCount === right.profileContent.fileCount
    && left.profileContent.sizeBytes === right.profileContent.sizeBytes;
}

function logicalMatches(left, right) {
  return validLogicalArtifact(left)
    && validLogicalArtifact(right)
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.totalPages === right.totalPages
    && left.remainingPages === right.remainingPages;
}

function attemptArtifactManifest(rootPath) {
  const root = safeDirectory(rootPath, 'Attempt artifact root', 'ATTEMPT_ARTIFACT_INVALID');
  const tree = directoryTreeManifest(root, 'Attempt artifact root', 'ATTEMPT_ARTIFACT_INVALID');
  const content = { files: tree.files, schemaVersion: 1 };
  return {
    fileCount: tree.fileCount,
    files: tree.files,
    kind: 'package-ui-attempt-artifact-manifest',
    rootPath: root,
    schemaVersion: 1,
    sha256: sha256Buffer(Buffer.from(canonicalJson(content), 'utf8')),
    sizeBytes: tree.sizeBytes,
  };
}

function attemptArtifactMembershipMatches(
  attemptArtifacts,
  artifactReferences,
  expectedBinding = null,
  expectedPassed = null,
) {
  try {
    if (!Array.isArray(artifactReferences)) return false;
    const root = safeDirectory(
      attemptArtifacts.rootPath,
      'Attempt artifact root',
      'ATTEMPT_ARTIFACT_INVALID',
    );
    const manifestByPath = new Map(
      attemptArtifacts.files.map((file) => [file.path, file]),
    );
    const observed = new Map();
    const semanticKeys = new Set();
    const pathIdentities = new Set();
    for (const reference of artifactReferences) {
      if (
        !hasOnlyKeys(reference, [
          'binding',
          'path',
          'role',
          'semanticKey',
          'sha256',
          'sizeBytes',
          'slot',
        ])
        || !hasOnlyKeys(reference.binding, [
          'attemptId',
          'invocationId',
          'profileId',
          'runGroupId',
          'runnerContractSha256',
          'scalePercent',
        ])
        || !hasOnlyKeys(reference.slot, [
          'kind',
          'overlayId',
          'pathSha256',
          'subview',
          'workspace',
        ])
        || !path.isAbsolute(String(reference.path || ''))
        || String(reference.path) !== path.resolve(String(reference.path))
        || !/^[A-F0-9]{64}$/.test(String(reference.sha256 || ''))
        || !/^[A-F0-9]{64}$/.test(String(reference.semanticKey || ''))
        || !Number.isInteger(reference.sizeBytes)
        || reference.sizeBytes < 0
        || !PROFILE_SEQUENCE.includes(reference.binding.profileId)
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,220}$/.test(String(
          reference.binding.attemptId || '',
        ))
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(
          reference.binding.invocationId || '',
        ))
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(
          reference.binding.runGroupId || '',
        ))
        || !/^[A-F0-9]{64}$/.test(String(
          reference.binding.runnerContractSha256 || '',
        ))
        || reference.binding.scalePercent
          !== (reference.binding.profileId === 'wide-1400x900-100'
            ? 100
            : Number.parseInt(reference.binding.profileId.split('-')[0], 10))
        || (
          expectedBinding
          && canonicalJson(reference.binding)
            !== canonicalJson(expectedBinding)
        )
      ) return false;
      const roleBySlot = {
        'failed-capture': 'failed-capture-artifact',
        inspector: 'inspector-screenshot',
        'main-runtime': 'main-runtime-artifact',
        overlay: 'overlay-screenshot',
        subview: 'subview-screenshot',
        workspace: 'workspace-screenshot',
      };
      if (
        roleBySlot[reference.slot.kind] !== reference.role
        || (
          ['workspace', 'subview', 'inspector'].includes(reference.slot.kind)
          && (
            typeof reference.slot.workspace !== 'string'
            || reference.slot.workspace.length < 1
            || typeof reference.slot.subview !== 'string'
            || reference.slot.subview.length < 1
            || reference.slot.overlayId !== null
            || reference.slot.pathSha256 !== null
          )
        )
        || (
          reference.slot.kind === 'overlay'
          && (
            !EXPECTED_OVERLAY_IDS.includes(reference.slot.overlayId)
            || reference.slot.workspace !== null
            || reference.slot.subview !== null
            || reference.slot.pathSha256 !== null
          )
        )
        || (
          reference.slot.kind === 'failed-capture'
          && (
            reference.slot.overlayId !== null
            || reference.slot.workspace !== null
            || reference.slot.subview !== null
            || !/^[A-F0-9]{64}$/.test(String(
              reference.slot.pathSha256 || '',
            ))
          )
        )
        || (
          reference.slot.kind === 'main-runtime'
          && (
            reference.slot.overlayId !== null
            || reference.slot.workspace !== null
            || reference.slot.subview !== null
            || reference.slot.pathSha256 !== null
          )
        )
        || reference.semanticKey !== sha256Buffer(Buffer.from(canonicalJson({
          binding: reference.binding,
          role: reference.role,
          slot: reference.slot,
        }), 'utf8'))
        || semanticKeys.has(reference.semanticKey)
      ) return false;
      semanticKeys.add(reference.semanticKey);
      const stable = stableFileRead(
        reference.path,
        'Attempt artifact reference',
        'ATTEMPT_ARTIFACT_INVALID',
      );
      if (
        stable.file.path.replace(/\\/g, '/')
          !== path.resolve(reference.path).replace(/\\/g, '/')
      ) return false;
      if (!isWithin(root, stable.file.path)) return false;
      const pathIdentity = normalizedPath(stable.file.path);
      if (pathIdentities.has(pathIdentity)) return false;
      pathIdentities.add(pathIdentity);
      const relative = path.relative(root, stable.file.path).split(path.sep).join('/');
      const expected = manifestByPath.get(relative);
      if (
        !expected
        || expected.sha256 !== reference.sha256
        || expected.sizeBytes !== reference.sizeBytes
        || stable.file.sha256 !== reference.sha256
        || stable.file.sizeBytes !== reference.sizeBytes
      ) return false;
      if (observed.has(relative)) return false;
      observed.set(relative, reference);
    }
    if (
      expectedPassed === true
      && artifactReferences.some(
        (reference) => reference?.role === 'failed-capture-artifact',
      )
    ) return false;
    return observed.size === manifestByPath.size
      && [...manifestByPath.keys()].every((relative) => observed.has(relative));
  } catch {
    return false;
  }
}

function redactDiagnosticSecrets(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_ACCOUNT]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|authorization|cookie|password|pwd|secret|session(?:[_-]?(?:id|key|token))?|token|username|user[_-]?name|account)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/(--(?:api[-_]?key|access[-_]?token|authorization|cookie|password|passwd|pwd|secret|session(?:[-_]?(?:id|key|token))?|token|username|user[-_]?name|account))(\s*=\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '$1$2[REDACTED]')
    .replace(/(\b(?:authorization|proxy-authorization)\s*[:=])[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/(\b(?:cookie|set-cookie)\s*:)[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/(\bbearer\s+)[A-Za-z0-9._~+/-]{6,}/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization|cookie|password|passwd|pwd|secret|session(?:[_ -]?(?:id|key|token))?|token|username|user_name|account)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,]+)/gi, '$1[REDACTED]');
}

function sanitizeDiagnosticText(value, maximumLength = DIAGNOSTIC_MESSAGE_LIMIT) {
  return redactDiagnosticSecrets(value).slice(0, maximumLength);
}

function cloneSecretBlindDiagnosticRecord(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeDiagnosticText(value, DIAGNOSTIC_STACK_LIMIT);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || depth >= 12) return sanitizeDiagnosticText(String(value));
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, 200).map((entry) => cloneSecretBlindDiagnosticRecord(entry, depth + 1, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [rawKey, entry] of Object.entries(value).slice(0, 200)) {
    const key = sanitizeDiagnosticText(rawKey, 160);
    result[key] = SENSITIVE_DIAGNOSTIC_KEY.test(key)
      ? '[REDACTED]'
      : cloneSecretBlindDiagnosticRecord(entry, depth + 1, seen);
  }
  seen.delete(value);
  return result;
}

function diagnosticsMatch(diagnostics, expectedProfileId) {
  const lifecycle = diagnostics?.lifecycle;
  return diagnostics?.schemaVersion === 'package-ui-run-diagnostics/v2'
    && diagnostics?.profileId === expectedProfileId
    && validIsoDate(diagnostics?.startedAt)
    && validIsoDate(diagnostics?.completedAt)
    && Date.parse(diagnostics.completedAt) >= Date.parse(diagnostics.startedAt)
    && lifecycle?.limit === DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
    && Number.isInteger(lifecycle?.droppedCount)
    && lifecycle.droppedCount >= 0
    && Array.isArray(lifecycle?.events)
    && lifecycle.events.length <= DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT
    && typeof lifecycle?.unexpectedCloseObserved === 'boolean'
    && (lifecycle.runnerCloseRequestedAt === null || validIsoDate(lifecycle.runnerCloseRequestedAt))
    && (
      lifecycle.processExit === null
      || (
        validIsoDate(lifecycle.processExit?.at)
        && (Number.isInteger(lifecycle.processExit?.code) || lifecycle.processExit?.code === null)
        && typeof lifecycle.processExit?.runnerCloseRequested === 'boolean'
        && (lifecycle.processExit?.signal === null || typeof lifecycle.processExit?.signal === 'string')
      )
    )
    && canonicalJson(diagnostics) === canonicalJson(cloneSecretBlindDiagnosticRecord(diagnostics));
}

function validStructuredFailure(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && validIsoDate(value.at)
    && typeof value.message === 'string'
    && typeof value.name === 'string'
    && typeof value.phase === 'string'
    && typeof value.stack === 'string'
    && canonicalJson(value) === canonicalJson(cloneSecretBlindDiagnosticRecord(value));
}

function attemptOutcomeMatches(receipt) {
  const diagnosticsFailure = receipt?.diagnostics?.failure ?? null;
  if (receipt?.passed === true) {
    return receipt.failure === null
      && diagnosticsFailure === null
      && receipt.diagnostics?.phase === 'completed';
  }
  return receipt?.passed === false
    && receipt.diagnostics?.phase === 'failed'
    && validStructuredFailure(receipt.failure)
    && canonicalJson(receipt.failure) === canonicalJson(diagnosticsFailure);
}

function processSnapshotEvidencePassed(snapshot) {
  return snapshot?.passed === true
    && snapshot.error === null
    && Number.isInteger(snapshot.observedCount)
    && snapshot.observedCount >= 0
    && Array.isArray(snapshot.matching)
    && Number.isInteger(snapshot.matchingCount)
    && snapshot.matchingCount === snapshot.matching.length
    && Array.isArray(snapshot.unresolved)
    && Number.isInteger(snapshot.unresolvedCount)
    && snapshot.unresolvedCount === snapshot.unresolved.length
    && (!Array.isArray(snapshot.mismatched)
      || (
        Number.isInteger(snapshot.mismatchedCount)
        && snapshot.mismatchedCount === snapshot.mismatched.length
        && snapshot.mismatchedCount === 0
      ))
    && (
      snapshot.ignoredUnresolvedCount === undefined
      || snapshot.ignoredUnresolvedCount === 0
    )
    && snapshot.observedCount >= snapshot.matchingCount + snapshot.unresolvedCount;
}

function processIsolationEvidencePassed(evidence) {
  return evidence?.passed === true
    && processSnapshotEvidencePassed(evidence.before)
    && evidence.before.matchingCount === 0
    && evidence.before.unresolvedCount === 0
    && processSnapshotEvidencePassed(evidence.after)
    && evidence.after.matchingCount === 0
    && evidence.after.unresolvedCount === 0;
}

function profileLockSnapshotPassed(snapshot, expectedBinding = null) {
  if (
    !hasOnlyKeys(snapshot, [
      'binding',
      'claim',
      'exclusiveOpen',
      'exclusiveProbe',
      'kind',
      'observedAt',
      'passed',
      'rootIdentityStable',
      'schemaVersion',
      'tree',
      'unresolved',
      'unresolvedCount',
    ])
    || !hasOnlyKeys(snapshot?.binding, [
      'invocationIdSha256',
      'profileId',
      'rootPathSha256',
    ])
    || !hasOnlyKeys(snapshot?.exclusiveOpen, [
      'allEntriesHeld',
      'closeFailureCount',
      'closeFailures',
      'directoryCount',
      'entryCount',
      'fileCount',
      'heldHandleCount',
      'method',
    ])
    || !hasOnlyKeys(snapshot?.exclusiveProbe, ['created', 'removed'])
    || !hasOnlyKeys(snapshot?.tree, [
      'attestationSha256',
      'criticalEntries',
      'criticalEntryCount',
      'identitySetSha256',
      'limits',
      'pathSetSha256',
      'secondSnapshotEntryCount',
      'totalPathCharacters',
      'treeStable',
    ])
    || !hasOnlyKeys(snapshot?.tree?.limits, [
      'maxCriticalEntries',
      'maxEntries',
      'maxPathCharacters',
    ])
    || snapshot.kind !== 'package-ui-profile-lock-snapshot'
    || snapshot.schemaVersion !== 'package-ui-profile-lock-snapshot/v2'
    || snapshot.claim !== 'bounded-quiescent-exclusive-open-attestation'
    || snapshot.passed !== true
    || !validIsoDate(snapshot.observedAt)
    || snapshot.rootIdentityStable !== true
    || snapshot.exclusiveProbe?.created !== true
    || snapshot.exclusiveProbe?.removed !== true
    || snapshot.unresolvedCount !== 0
    || !Array.isArray(snapshot.unresolved)
    || snapshot.unresolved.length !== 0
    || typeof snapshot.binding?.profileId !== 'string'
    || snapshot.binding.profileId.length < 1
    || !/^[A-F0-9]{64}$/.test(String(snapshot.binding?.invocationIdSha256 || ''))
    || !/^[A-F0-9]{64}$/.test(String(snapshot.binding?.rootPathSha256 || ''))
    || snapshot.exclusiveOpen?.method
      !== 'win32-createfile-share-none-stable-tree/v1'
    || snapshot.exclusiveOpen.allEntriesHeld !== true
    || !Number.isInteger(snapshot.exclusiveOpen.entryCount)
    || snapshot.exclusiveOpen.entryCount < 2
    || snapshot.exclusiveOpen.entryCount > PROFILE_LOCK_MAX_ENTRIES
    || !Number.isInteger(snapshot.exclusiveOpen.fileCount)
    || snapshot.exclusiveOpen.fileCount < 1
    || !Number.isInteger(snapshot.exclusiveOpen.directoryCount)
    || snapshot.exclusiveOpen.directoryCount < 1
    || snapshot.exclusiveOpen.fileCount + snapshot.exclusiveOpen.directoryCount
      !== snapshot.exclusiveOpen.entryCount
    || snapshot.exclusiveOpen.heldHandleCount
      !== snapshot.exclusiveOpen.entryCount
    || snapshot.exclusiveOpen.closeFailureCount !== 0
    || !Array.isArray(snapshot.exclusiveOpen.closeFailures)
    || snapshot.exclusiveOpen.closeFailures.length !== 0
    || snapshot.tree?.treeStable !== true
    || snapshot.tree.secondSnapshotEntryCount
      !== snapshot.exclusiveOpen.entryCount
    || !/^[A-F0-9]{64}$/.test(String(snapshot.tree.pathSetSha256 || ''))
    || !/^[A-F0-9]{64}$/.test(String(snapshot.tree.identitySetSha256 || ''))
    || snapshot.tree.attestationSha256 !== sha256Buffer(Buffer.from(
      canonicalJson({
        binding: snapshot.binding,
        criticalEntries: snapshot.tree.criticalEntries,
        criticalEntryCount: snapshot.tree.criticalEntryCount,
        directoryCount: snapshot.exclusiveOpen.directoryCount,
        entryCount: snapshot.exclusiveOpen.entryCount,
        fileCount: snapshot.exclusiveOpen.fileCount,
        identitySetSha256: snapshot.tree.identitySetSha256,
        pathSetSha256: snapshot.tree.pathSetSha256,
        secondSnapshotEntryCount: snapshot.tree.secondSnapshotEntryCount,
        totalPathCharacters: snapshot.tree.totalPathCharacters,
      }),
      'utf8',
    ))
    || snapshot.tree.limits?.maxEntries !== PROFILE_LOCK_MAX_ENTRIES
    || snapshot.tree.limits?.maxPathCharacters
      !== PROFILE_LOCK_MAX_PATH_CHARACTERS
    || snapshot.tree.limits?.maxCriticalEntries
      !== PROFILE_LOCK_MAX_CRITICAL_ENTRIES
    || !Number.isInteger(snapshot.tree.totalPathCharacters)
    || snapshot.tree.totalPathCharacters < 1
    || snapshot.tree.totalPathCharacters > PROFILE_LOCK_MAX_PATH_CHARACTERS
    || !Number.isInteger(snapshot.tree.criticalEntryCount)
    || snapshot.tree.criticalEntryCount < 0
    || snapshot.tree.criticalEntryCount > PROFILE_LOCK_MAX_CRITICAL_ENTRIES
    || !Array.isArray(snapshot.tree.criticalEntries)
    || snapshot.tree.criticalEntries.length !== snapshot.tree.criticalEntryCount
    || snapshot.tree.criticalEntries.some((entry) => (
      !hasOnlyKeys(entry, [
        'identitySha256',
        'kind',
        'linkCount',
        'pathSha256',
        'sizeBytes',
      ])
      || !['directory', 'file'].includes(entry.kind)
      || !/^[A-F0-9]{64}$/.test(String(entry.identitySha256 || ''))
      || !/^[A-F0-9]{64}$/.test(String(entry.pathSha256 || ''))
      || !Number.isInteger(entry.linkCount)
      || entry.linkCount < 1
      || (entry.kind === 'file' && entry.linkCount !== 1)
      || !Number.isInteger(entry.sizeBytes)
      || entry.sizeBytes < 0
    ))
  ) return false;
  return !expectedBinding
    || canonicalJson(snapshot.binding) === canonicalJson(expectedBinding);
}

function profileLockIsolationPassed(evidence, expectedBinding = null) {
  return evidence?.passed === true
    && profileLockSnapshotPassed(evidence.before, expectedBinding)
    && profileLockSnapshotPassed(evidence.after, expectedBinding)
    && canonicalJson(evidence.before.binding)
      === canonicalJson(evidence.after.binding);
}

function cleanupProven(runEvidence) {
  if (
    !processIsolationEvidencePassed(runEvidence?.packageProcessIsolation)
    || !processIsolationEvidencePassed(runEvidence?.profileProcessIsolation)
    || runEvidence?.packageProcessIsolation?.before?.observedCount !== 0
    || runEvidence?.packageProcessIsolation?.after?.observedCount !== 0
    || !profileLockIsolationPassed(
      runEvidence?.profileLockIsolation,
      runEvidence?.evidenceBinding?.profileLockBinding || null,
    )
  ) return false;
  if (runEvidence?.chromiumProcessLineage == null) return true;
  return processSnapshotEvidencePassed(runEvidence.chromiumProcessLineage.cleanup)
    && runEvidence.chromiumProcessLineage.cleanup.matchingCount === 0
    && runEvidence.chromiumProcessLineage.cleanup.unresolvedCount === 0;
}

function readEnvelope(filePath, kind, schema, root) {
  const realRoot = safeDirectory(root, 'Run-group root');
  const resolved = path.resolve(filePath);
  if (!isWithin(realRoot, resolved)) fail('RECORD_ROOT_INVALID', 'Immutable record escaped the run-group root.');
  const stable = stableFileRead(resolved, 'Immutable record', 'RECORD_ROOT_INVALID');
  let envelope;
  try {
    envelope = JSON.parse(stable.buffer.toString('utf8'));
  } catch {
    fail('RECORD_ROOT_INVALID', 'Immutable record is not valid JSON.');
  }
  if (
    !hasOnlyKeys(envelope, ['payload', 'payloadSha256'])
    || !envelope.payload
    || typeof envelope.payload !== 'object'
    || envelope.payloadSha256 !== sha256Buffer(Buffer.from(canonicalJson(envelope.payload), 'utf8'))
    || envelope.payload.kind !== kind
    || envelope.payload.schemaVersion !== schema
  ) fail('RECORD_ROOT_INVALID', 'Immutable envelope is malformed or changed.');
  return { file: stable.file, payload: envelope.payload, payloadSha256: envelope.payloadSha256 };
}

function invokePureRunnerChild(operation, input) {
  const childSource = [
    "const Module=require('node:module');",
    'const original=Module._load;',
    "Module._load=function(request,parent,isMain){if(request==='./playwright-loader'&&/package-ui-evidence\\.js$/i.test(String(parent?.filename||'')))return {_electron:null};return original.apply(this,arguments);};",
    "const fs=require('node:fs');",
    "const input=JSON.parse(fs.readFileSync(0,'utf8')||'{}');",
    'const runner=require(input.runnerPath);',
    'let result;',
    "if(input.operation==='facts'){",
    'const runnerContract=runner.buildPackageUiRunnerContract();',
    'result={',
    'runnerContract,',
    'packageProcess:runner.collectMatchingPackageProcesses(input.executablePath),',
    'profileProcess:runner.collectMatchingProfileBrowserProcesses(input.profileBrowserPath,{expectedExecutablePath:input.chromiumPath}),',
    'runnerLease:runner.inspectPackageUiRunGroupLease({outputDir:input.outputDir,runGroupId:input.runGroupId,runnerContractSha256:runnerContract.sha256})',
    '};',
    "}else if(input.operation==='profile-evidence'){",
    'result=runner.evaluatePackageUiProfileEvidence(input.profileId,input.runEvidence);',
    "}else if(input.operation==='manifest-evidence'){",
    'result=runner.evaluatePackageUiEvidenceCompleteness(input.manifest);',
    "}else if(input.operation==='provenance'){",
    'result={',
    'fileIsolation:runner.evaluateProfileDatabaseFileIsolation({profileDatabasePath:input.profileDatabasePath,protectedDatabasePath:input.protectedDatabasePath}),',
    'provenance:runner.evaluateProfileDatabaseProvenance({profileDatabase:input.profileDatabase,protectedDatabase:input.protectedDatabase})',
    '};',
    "}else{throw new Error('Unknown pure-runner operation');}",
    'process.stdout.write(JSON.stringify(result));',
  ].join('');
  const result = spawnSync(process.execPath, ['-e', childSource], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify({ ...input, operation }),
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.signal) {
    fail('RUNNER_PREFLIGHT_INVALID', 'The pure runner validation child could not be completed.');
  }
  try {
    return JSON.parse(String(result.stdout || ''));
  } catch {
    fail('RUNNER_PREFLIGHT_INVALID', 'The pure runner validation child returned malformed JSON.');
  }
}

function runnerFactsFromPureChild(input) {
  return invokePureRunnerChild('facts', input);
}

function validateProfileEvidenceFromPureChild({ profileId, runEvidence, runnerPath }) {
  return invokePureRunnerChild('profile-evidence', {
    profileId,
    runEvidence,
    runnerPath,
  });
}

function validateManifestEvidenceFromPureChild({ manifest, runnerPath }) {
  return invokePureRunnerChild('manifest-evidence', {
    manifest,
    runnerPath,
  });
}

function validateProfileDatabaseProvenanceFromPureChild(input) {
  return invokePureRunnerChild('provenance', input);
}

function validateAuthoritySelectionFromPureChild({
  canonicalPaths,
  protectedDatabasePath,
  receiptPath,
}) {
  const childSource = [
    "const crypto=require('node:crypto');",
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    "const input=JSON.parse(fs.readFileSync(0,'utf8')||'{}');",
    "const verifier=require(input.verifierPath);",
    'const stable=(value)=>Array.isArray(value)?`[${value.map(stable).join(",")}]`:value&&typeof value==="object"?`{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`:JSON.stringify(value);',
    'const comparable=(selection)=>{const copy=JSON.parse(JSON.stringify(selection));const selected=copy?.selected;if(selected?.sidecarObservation?.shmMayChangeForReadonlyWalLocking===true&&selected?.sidecars?.shm?.exists===true&&selected?.sidecarsBefore?.shm?.exists===true){delete selected.sidecars.shm.mtimeMs;delete selected.sidecarsBefore.shm.mtimeMs;}return copy;};',
    'const samePath=(left,right)=>path.resolve(left).replace(/[\\\\/]+$/,"").toLowerCase()===path.resolve(right).replace(/[\\\\/]+$/,"").toLowerCase();',
    'const bytes=fs.readFileSync(input.receiptPath);',
    'const receipt=JSON.parse(bytes.toString("utf8"));',
    'const mainSha=String(receipt?.selection?.selected?.mainFileSha256||"").toUpperCase();',
    'const current=verifier.inspectProductionAuthoritySelection({dbPath:input.protectedDatabasePath,expectedUserDataDir:input.canonicalPaths.userDataDir,expectedMainSha256:mainSha},{env:{APPDATA:input.canonicalPaths.roamingAppData,USERPROFILE:input.canonicalPaths.userProfile},writeStdout:()=>{}});',
    'const logical=current?.selection?.selected?.logicalCapture;',
    'const passed=receipt?.kind===verifier.KIND&&receipt?.schemaVersion===verifier.SCHEMA_VERSION&&["SELECTED_SCHEMA_READY","SELECTED_MIGRATION_REQUIRED"].includes(receipt?.status)&&receipt.status===current.status&&receipt.formalEvidence===false&&receipt.authorityDatabaseMutated===false&&receipt.adsExecutionInvoked===false&&new Date(Date.parse(receipt.generatedAt)).toISOString()===receipt.generatedAt&&stable(comparable(receipt.selection))===stable(comparable(current.selection))&&samePath(current.selection?.expectedUserDataDir,input.canonicalPaths.userDataDir)&&samePath(current.selection?.expectedDatabasePath,input.protectedDatabasePath)&&samePath(current.selection?.selected?.absolutePath,input.protectedDatabasePath)&&samePath(current.selection?.selected?.realPath,input.protectedDatabasePath);',
    'process.stdout.write(JSON.stringify({logicalArtifact:logical?{method:logical.method,remainingPages:logical.remainingPages,schemaVersion:logical.schemaVersion,sha256:logical.logicalBackupSha256,sizeBytes:logical.logicalBackupSizeBytes,totalPages:logical.totalPages}:null,passed,receiptSha256:crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase(),status:current?.status||null}));',
  ].join('');
  const result = spawnSync(process.execPath, ['-e', childSource], {
    cwd: ROOT,
    encoding: 'utf8',
    input: JSON.stringify({
      canonicalPaths,
      protectedDatabasePath,
      receiptPath,
      verifierPath: path.join(__dirname, 'verify-production-authority-selection.js'),
    }),
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.signal) {
    fail('AUTHORITY_SELECTION_INVALID', 'The current production authority-selection receipt could not be revalidated.');
  }
  try {
    return JSON.parse(String(result.stdout || ''));
  } catch {
    fail('AUTHORITY_SELECTION_INVALID', 'Authority-selection validation returned malformed JSON.');
  }
}

function validateRootStructure(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    if (!ALLOWED_RUN_GROUP_ENTRIES.includes(entry.name)) {
      fail('RECORD_ROOT_EXTRA_ENTRY', 'Run group contains an unrecognized entry.');
    }
    if (entry.name === 'run-group.json') {
      if (!entry.isFile()) fail('RECORD_ROOT_INVALID', 'run-group.json must be a direct regular file.');
    } else if (!entry.isDirectory()) fail('RECORD_ROOT_INVALID', 'Run-group collection entries must be direct directories.');
  }
  if (!entries.some((entry) => entry.name === 'run-group.json')) {
    fail('RECORD_ROOT_INVALID', 'Run group is missing run-group.json.');
  }
  for (const collection of ['attempts', 'profile-attempt-artifacts']) {
    const collectionPath = path.join(root, collection);
    if (!fs.existsSync(collectionPath)) continue;
    const collectionRoot = safeDirectory(collectionPath, `${collection} directory`);
    for (const entry of fs.readdirSync(collectionRoot, { withFileTypes: true })) {
      if (!PROFILE_SEQUENCE.includes(entry.name) || !entry.isDirectory()) {
        fail('RECORD_ROOT_INVALID', `${collection} contains an unknown profile or non-directory entry.`);
      }
      safeDirectory(path.join(collectionRoot, entry.name), `${collection} profile directory`);
    }
  }
  const checkpoints = path.join(root, 'checkpoints');
  if (fs.existsSync(checkpoints)) {
    const checkpointRoot = safeDirectory(checkpoints, 'Checkpoint directory');
    for (const entry of fs.readdirSync(checkpointRoot, { withFileTypes: true })) {
      if (!entry.isFile() || !PROFILE_SEQUENCE.some((profile) => entry.name === `${profile}.json`)) {
        fail('RECORD_ROOT_INVALID', 'Checkpoint directory contains an unexpected entry.');
      }
    }
  }
}

function fileRecordMatches(left, right) {
  return hasOnlyKeys(left, ['path', 'sha256', 'sizeBytes', 'mtime', 'mtimeMs'])
    && samePath(String(left.path || ''), right.path)
    && left.sha256 === right.sha256
    && left.sizeBytes === right.sizeBytes
    && left.mtime === right.mtime
    && left.mtimeMs === right.mtimeMs;
}

function validateManifests(
  root,
  metadataRecord,
  options,
  validateManifestEvidence = validateManifestEvidenceFromPureChild,
) {
  const metadata = metadataRecord.payload;
  const manifestsPath = path.join(root, 'manifests');
  const receiptsPath = path.join(root, 'invocation-receipts');
  if (!fs.existsSync(manifestsPath) || !fs.existsSync(receiptsPath)) {
    fail('MANIFEST_RECORD_INVALID', 'Current run group requires manifest and invocation-receipt directories.');
  }
  const directory = safeDirectory(manifestsPath, 'Run manifest directory');
  const receiptDirectory = safeDirectory(receiptsPath, 'Invocation receipt directory');
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (entries.length < 1) {
    fail('MANIFEST_RECORD_INVALID', 'Current run group requires at least one immutable invocation manifest.');
  }
  const manifests = [];
  const observedReceiptNames = new Set();
  for (const entry of entries) {
    if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,240}\.json$/.test(entry.name)) {
      fail('MANIFEST_RECORD_INVALID', 'Run manifest directory contains an unexpected entry.');
    }
    const stable = stableFileRead(path.join(directory, entry.name), 'Package UI run manifest', 'MANIFEST_RECORD_INVALID');
    let manifest;
    try { manifest = JSON.parse(stable.buffer.toString('utf8')); } catch {
      fail('MANIFEST_RECORD_INVALID', 'Package UI run manifest is not valid JSON.');
    }
    const stem = entry.name.slice(0, -5);
    const requestedRunIds = [manifest?.requested?.runGroupId, manifest?.requested?.resumeRunGroupId].filter(Boolean);
    const invocationId = manifest?.invocation?.invocationId;
    const invocationReceiptPath = path.join(receiptDirectory, `${invocationId}.json`);
    if (
      manifest?.kind !== 'package-ui-evidence'
      || manifest?.schemaVersion !== 8
      || manifest?.runGroup?.attemptId !== stem
      || manifest?.runGroup?.runGroupId !== metadata.runGroupId
      || manifest?.runGroup?.invocationId !== invocationId
      || !requestedRunIds.includes(metadata.runGroupId)
      || manifest?.requested?.expectedExeSha256 !== options['expected-exe-sha256']
      || manifest?.requested?.expectedAppContentSha256 !== options['expected-app-content-sha256']
      || manifest?.requested?.allowInteractiveLogin !== true
      || manifest?.requested?.allowSavedLogin !== false
      || manifest?.requested?.loginMode !== 'interactive-operator-each-run'
      || !samePath(String(manifest?.requested?.userDataDir || ''), options['user-data-dir'])
      || !samePath(String(manifest?.requested?.profileBrowserUserDataDir || ''), path.join(options['user-data-dir'], 'stores'))
      || !samePath(String(manifest?.requested?.protectedDatabasePath || ''), options['protected-db'])
      || !samePath(String(manifest?.requested?.authoritySelectionPath || ''), options['authority-selection'])
      || !samePath(String(manifest?.requested?.executablePath || ''), options.executable)
      || !samePath(String(manifest?.requested?.appContentPath || ''), options.appContent)
      || manifest?.runGroup?.runnerContractSha256 !== metadata.runnerContractSha256
      || canonicalJson(manifest?.runGroup?.profileSequence) !== canonicalJson(PROFILE_SEQUENCE)
      || (
        manifest?.runGroup?.metadata != null
        && !fileRecordMatches(manifest.runGroup.metadata, metadataRecord.file)
      )
      || (
        manifest?.passed === true
        && !fileRecordMatches(manifest?.runGroup?.metadata, metadataRecord.file)
      )
      || !validIsoDate(manifest.generatedAt)
      || !validIsoDate(manifest.completedAt)
      || Date.parse(manifest.completedAt) < Date.parse(manifest.generatedAt)
      || typeof manifest.passed !== 'boolean'
      || (
        manifest.passed === true
          ? manifest.failure !== null
          : !validStructuredFailure(manifest.failure)
      )
      || canonicalJson(manifest.failure) !== canonicalJson(cloneSecretBlindDiagnosticRecord(manifest.failure))
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(invocationId || ''))
      || !Array.isArray(manifest?.invocation?.attemptReceipts)
      || manifest.invocation.attemptReceipts.some(
        (record) => record?.invocationId !== invocationId,
      )
      || manifest?.invocation?.collection?.attemptCount
        !== manifest.invocation.attemptReceipts.length
      || manifest?.invocation?.collection?.attemptInvocationManifestCount
        !== manifest.invocation.attemptReceipts.length
      || manifest?.invocation?.collection?.passed !== true
      || manifest?.invocation?.leaseHeldThroughPersistence !== true
      || !samePath(String(manifest?.invocation?.receiptPath || ''), invocationReceiptPath)
    ) fail('MANIFEST_RECORD_INVALID', 'Package UI run manifest is detached from the run-group contract.');
    if (
      manifest.passed === true
      && (
        canonicalJson(manifest?.authority?.binding)
          !== canonicalJson(metadata.authorityBinding)
        || validateManifestEvidence({
          manifest,
          runnerPath: path.join(__dirname, 'package-ui-evidence.js'),
        })?.passed !== true
      )
    ) {
      fail('MANIFEST_RECORD_INVALID', 'Successful Package UI manifest fails the complete current v8 evaluator.');
    }
    const invocationReceipt = readEnvelope(
      invocationReceiptPath,
      'package-ui-invocation-receipt',
      INVOCATION_RECEIPT_SCHEMA,
      root,
    );
    const receipt = invocationReceipt.payload;
    const summary = safeFileArtifact(
      receipt?.summary?.path,
      'Invocation summary',
      'MANIFEST_RECORD_INVALID',
    );
    if (
      !hasOnlyKeys(receipt, ['attemptReceipts', 'authorityBinding', 'completedAt', 'failure', 'invocationId', 'kind', 'lease', 'manifest', 'passed', 'resumeInspectionReceipt', 'runGroupId', 'runnerContractSha256', 'schemaVersion', 'summary'])
      || receipt.invocationId !== invocationId
      || receipt.runGroupId !== metadata.runGroupId
      || receipt.runnerContractSha256 !== metadata.runnerContractSha256
      || receipt.passed !== manifest.passed
      || canonicalJson(receipt.failure) !== canonicalJson(manifest.failure)
      || canonicalJson(receipt.attemptReceipts)
        !== canonicalJson(manifest.invocation.attemptReceipts)
      || canonicalJson(receipt.lease) !== canonicalJson(manifest.invocation.lease)
      || (manifest.passed === true
        && canonicalJson(receipt.authorityBinding)
          !== canonicalJson(metadata.authorityBinding))
      || !fileRecordMatches(receipt.manifest, stable.file)
      || !fileRecordMatches(receipt.summary, summary)
      || !validIsoDate(receipt.completedAt)
    ) fail('MANIFEST_RECORD_INVALID', 'Invocation receipt is detached from its manifest, lease, attempts, or summary.');
    if (manifest.requested.resumeRunGroupId) {
      if (
        typeof manifest.requested.resumeInspectionReceiptPath !== 'string'
        || !path.isAbsolute(manifest.requested.resumeInspectionReceiptPath)
      ) {
        fail('MANIFEST_RECORD_INVALID', 'Resume invocation has no exact inspection receipt path.');
      }
      const originalReceiptPath = path.resolve(
        manifest.requested.resumeInspectionReceiptPath,
      );
      const consumedPath = path.join(
        path.dirname(originalReceiptPath),
        'consumed',
        `${path.basename(originalReceiptPath, '.json')}-${invocationId}.json`,
      );
      if (
        fs.existsSync(originalReceiptPath)
        || manifest.invocation.resumeInspectionReceipt == null
        || receipt.resumeInspectionReceipt == null
      ) {
        fail('MANIFEST_RECORD_INVALID', 'Resume inspection receipt was not consumed exactly once.');
      }
      const consumed = stableFileRead(
        consumedPath,
        'Consumed resume inspection receipt',
        'MANIFEST_RECORD_INVALID',
      );
      let consumedEnvelope;
      try {
        consumedEnvelope = JSON.parse(consumed.buffer.toString('utf8'));
      } catch {
        fail('MANIFEST_RECORD_INVALID', 'Consumed resume inspection receipt is not valid JSON.');
      }
      const consumedPayload = consumedEnvelope?.payload;
      const expectedResumeArgv = [
        'scripts/run-package-ui-evidence.js',
        '--output', path.resolve(options.output),
        '--resume-run-group', metadata.runGroupId,
        '--expected-exe-sha256', options['expected-exe-sha256'],
        '--expected-app-content-sha256', options['expected-app-content-sha256'],
        '--user-data-dir', path.resolve(options['user-data-dir']),
        '--protected-db', path.resolve(options['protected-db']),
        '--authority-selection', path.resolve(options['authority-selection']),
        '--resume-inspection-receipt', originalReceiptPath,
        '--allow-interactive-login',
      ];
      if (
        consumedPayload?.kind !== 'package-ui-resume-inspection'
        || consumedPayload?.schemaVersion !== RESUME_INSPECTION_SCHEMA
        || consumedPayload?.invocationId !== invocationId
        || consumedPayload?.runGroupId !== metadata.runGroupId
        || consumedPayload?.runnerContractSha256 !== metadata.runnerContractSha256
        || consumedEnvelope.payloadSha256
          !== sha256Buffer(Buffer.from(canonicalJson(consumedPayload), 'utf8'))
        || consumedPayload.intentBindingSha256
          !== sha256Buffer(Buffer.from(
            canonicalJson(resumeInspectionCore(consumedPayload)),
            'utf8',
          ))
        || path.basename(originalReceiptPath)
          !== `${consumedPayload.intentBindingSha256}.json`
        || canonicalJson(consumedPayload.argv) !== canonicalJson(expectedResumeArgv)
        || consumed.file.sha256 !== manifest.invocation.resumeInspectionReceipt.sha256
        || consumedEnvelope.payloadSha256
          !== manifest.invocation.resumeInspectionReceipt.payloadSha256
        || canonicalJson(receipt.resumeInspectionReceipt)
          !== canonicalJson({
            payloadSha256: consumedEnvelope.payloadSha256,
            sha256: consumed.file.sha256,
          })
      ) {
        fail('MANIFEST_RECORD_INVALID', 'Consumed resume inspection receipt is stale or cross-bound.');
      }
    } else if (
      manifest.invocation.resumeInspectionReceipt !== null
      || receipt.resumeInspectionReceipt !== null
    ) {
      fail('MANIFEST_RECORD_INVALID', 'Fresh invocation may not claim a resume inspection receipt.');
    }
    observedReceiptNames.add(`${invocationId}.json`);
    manifests.push({
      file: stable.file,
      invocationReceipt,
      manifest,
    });
  }
  const actualReceiptNames = fs.readdirSync(receiptDirectory)
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (
    canonicalJson(actualReceiptNames)
    !== canonicalJson([...observedReceiptNames].sort((a, b) => a.localeCompare(b, 'en')))
  ) {
    fail('MANIFEST_RECORD_INVALID', 'Invocation receipts do not exactly match invocation manifests.');
  }
  return manifests;
}

function validateInvocationCollections(root, manifests, attemptRecords) {
  const manifestsByInvocation = new Map();
  for (const entry of manifests) {
    const invocationId = entry.manifest.invocation.invocationId;
    if (manifestsByInvocation.has(invocationId)) {
      fail('MANIFEST_RECORD_INVALID', 'Invocation id appears in more than one immutable manifest.');
    }
    manifestsByInvocation.set(invocationId, entry);
  }
  const expectedInvocationPaths = [];
  for (const [invocationId, entry] of manifestsByInvocation) {
    const matching = attemptRecords
      .filter((record) => record.payload.invocationId === invocationId)
      .map((record) => ({
        attemptId: record.payload.attemptId,
        file: record.file,
        invocationId,
        invocationManifest: record.payload.attemptInvocationManifest,
        ordinal: record.payload.ordinal,
        payloadSha256: record.payloadSha256,
        profileId: record.payload.profileId,
      }))
      .sort((left, right) => (
        PROFILE_SEQUENCE.indexOf(left.profileId)
          - PROFILE_SEQUENCE.indexOf(right.profileId)
        || left.ordinal - right.ordinal
      ));
    const declared = [...entry.manifest.invocation.attemptReceipts]
      .sort((left, right) => (
        PROFILE_SEQUENCE.indexOf(left.profileId)
          - PROFILE_SEQUENCE.indexOf(right.profileId)
        || left.ordinal - right.ordinal
      ));
    if (canonicalJson(matching) !== canonicalJson(declared)) {
      fail('MANIFEST_RECORD_INVALID', 'Invocation manifest attempt collection is incomplete or cross-bound.');
    }
    for (const record of matching) {
      if (!record.invocationManifest) {
        fail('ATTEMPT_RECORD_INVALID', 'Attempt invocation manifest binding is incomplete.');
      }
      const attempt = attemptRecords.find(
        (candidate) => candidate.file.sha256 === record.file.sha256,
      );
      if (
        attempt.payload.lease.generation
          !== entry.manifest.invocation.lease.generation
        || attempt.payload.lease.payloadSha256
          !== entry.manifest.invocation.lease.payloadSha256
      ) {
        fail('ATTEMPT_RECORD_INVALID', 'Attempt lease generation is detached from its exact invocation manifest.');
      }
      expectedInvocationPaths.push(
        normalizedPath(attempt.payload.attemptInvocationManifest.path),
      );
    }
  }
  if (attemptRecords.some(
    (record) => !manifestsByInvocation.has(record.payload.invocationId),
  )) {
    fail('MANIFEST_RECORD_INVALID', 'An immutable attempt has no exact invocation manifest/receipt.');
  }
  const invocationsRoot = path.join(root, 'invocations');
  const actualInvocationPaths = [];
  if (fs.existsSync(invocationsRoot)) {
    const directRoot = safeDirectory(invocationsRoot, 'Attempt invocation directory');
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          safeDirectory(target, 'Attempt invocation child directory');
          visit(target);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          actualInvocationPaths.push(normalizedPath(
            stableFileRead(target, 'Attempt invocation manifest').file.path,
          ));
        } else {
          fail('RECORD_ROOT_INVALID', 'Attempt invocation directory contains an unexpected entry.');
        }
      }
    };
    visit(directRoot);
  }
  expectedInvocationPaths.sort((a, b) => a.localeCompare(b, 'en'));
  actualInvocationPaths.sort((a, b) => a.localeCompare(b, 'en'));
  if (canonicalJson(actualInvocationPaths) !== canonicalJson(expectedInvocationPaths)) {
    fail('ATTEMPT_RECORD_INVALID', 'Attempt invocation manifests do not exactly match immutable attempts.');
  }
}

function loadAttemptRecords({ metadata, profileId, root, startCursor }) {
  const directory = path.join(root, 'attempts', profileId);
  const artifactProfileRoot = path.join(root, 'profile-attempt-artifacts', profileId);
  if (!fs.existsSync(directory)) {
    if (fs.existsSync(artifactProfileRoot)) {
      fail('ATTEMPT_ARTIFACT_INVALID', 'Attempt artifacts exist without immutable attempt receipts.');
    }
    return { cleanupBindingProven: true, cursor: startCursor, records: [] };
  }
  const attemptRoot = safeDirectory(directory, 'Attempt receipt directory');
  const names = fs.readdirSync(attemptRoot).sort((a, b) => a.localeCompare(b, 'en'));
  const records = [];
  let cursor = startCursor;
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    if (!name.endsWith('.json')) fail('ATTEMPT_RECORD_INVALID', 'Attempt directory contains a non-JSON entry.');
    const record = readEnvelope(path.join(attemptRoot, name), 'package-ui-profile-attempt', ATTEMPT_SCHEMA, root);
    const receipt = record.payload;
    const ordinal = index + 1;
    const expectedArtifactRoot = path.join(
      root,
      'profile-attempt-artifacts',
      profileId,
      `${String(ordinal).padStart(4, '0')}-${receipt.attemptId}`,
    );
    const expectedInvocationManifest = path.join(
      root,
      'invocations',
      String(receipt.invocationId || ''),
      `${profileId}-${String(ordinal).padStart(4, '0')}-${receipt.attemptId}.json`,
    );
    if (
      !hasOnlyKeys(receipt, ['attemptArtifacts', 'attemptInvocationManifest', 'attemptId', 'artifactReferences', 'authorityBinding', 'cleanupEvidence', 'completedAt', 'diagnostics', 'failure', 'invocationId', 'kind', 'lease', 'manifestSha256', 'packageLineage', 'ordinal', 'passed', 'profileId', 'profileState', 'resumable', 'runGroupId', 'runnerContractSha256', 'schemaVersion'])
      || receipt.ordinal !== ordinal
      || name !== `${String(ordinal).padStart(4, '0')}-${receipt.attemptId}.json`
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(receipt.attemptId || ''))
      || !validIsoDate(receipt.completedAt)
      || receipt.profileId !== profileId
      || receipt.runGroupId !== metadata.runGroupId
      || receipt.runnerContractSha256 !== metadata.runnerContractSha256
      || canonicalJson(receipt.packageLineage) !== canonicalJson(metadata.packageLineage)
      || canonicalJson(receipt.authorityBinding) !== canonicalJson(metadata.authorityBinding)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(receipt.invocationId || ''))
      || !hasOnlyKeys(receipt.lease, ['generation', 'payloadSha256'])
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{5,180}$/.test(String(receipt.lease.generation || ''))
      || !/^[A-F0-9]{64}$/.test(String(receipt.lease.payloadSha256 || ''))
      || !diagnosticsMatch(receipt.diagnostics, profileId)
      || !validProfileState(receipt.profileState?.before)
      || !stateMatches(cursor, receipt.profileState.before)
      || (receipt.resumable === true ? !validProfileState(receipt.profileState?.after) : receipt.profileState?.after !== null)
      || typeof receipt.passed !== 'boolean'
      || typeof receipt.resumable !== 'boolean'
      || !attemptOutcomeMatches(receipt)
      || (receipt.passed === true && receipt.resumable !== true)
      || !receipt.attemptArtifacts
      || !samePath(String(receipt.attemptArtifacts.rootPath || ''), expectedArtifactRoot)
      || canonicalJson(attemptArtifactManifest(expectedArtifactRoot)) !== canonicalJson(receipt.attemptArtifacts)
      || !attemptArtifactMembershipMatches(
        receipt.attemptArtifacts,
        receipt.artifactReferences,
        {
          attemptId: receipt.attemptId,
          invocationId: receipt.invocationId,
          profileId: receipt.profileId,
          runGroupId: receipt.runGroupId,
          runnerContractSha256: receipt.runnerContractSha256,
          scalePercent: receipt.profileId === 'wide-1400x900-100'
            ? 100
            : Number.parseInt(receipt.profileId.split('-')[0], 10),
        },
        receipt.passed,
      )
      || !fileRecordMatches(
        receipt.attemptInvocationManifest,
        safeFileArtifact(
          expectedInvocationManifest,
          'Attempt invocation manifest',
          'ATTEMPT_RECORD_INVALID',
        ),
      )
      || receipt.manifestSha256 !== receipt.attemptInvocationManifest.sha256
    ) fail('ATTEMPT_RECORD_INVALID', 'Attempt receipt is malformed, detached, secret-bearing, or cursor-inconsistent.');
    const invocationManifest = readEnvelope(
      expectedInvocationManifest,
      'package-ui-attempt-invocation',
      ATTEMPT_INVOCATION_SCHEMA,
      root,
    );
    if (
      invocationManifest.file.sha256 !== receipt.manifestSha256
      || invocationManifest.payload.attemptId !== receipt.attemptId
      || invocationManifest.payload.invocationId !== receipt.invocationId
      || invocationManifest.payload.ordinal !== receipt.ordinal
      || invocationManifest.payload.profileId !== receipt.profileId
      || canonicalJson(invocationManifest.payload.attemptArtifacts)
        !== canonicalJson(receipt.attemptArtifacts)
      || canonicalJson(invocationManifest.payload.artifactReferences)
        !== canonicalJson(receipt.artifactReferences)
      || canonicalJson(invocationManifest.payload.cleanupEvidence)
        !== canonicalJson(receipt.cleanupEvidence)
      || canonicalJson(invocationManifest.payload.profileState)
        !== canonicalJson(receipt.profileState)
      || canonicalJson(invocationManifest.payload.lease)
        !== canonicalJson(receipt.lease)
      || invocationManifest.payload.resumable !== receipt.resumable
      || invocationManifest.payload.passed !== receipt.passed
    ) fail('ATTEMPT_RECORD_INVALID', 'Attempt receipt is detached from its invocation manifest.');
    const cleanupPassed = cleanupProven(receipt.cleanupEvidence);
    if (
      (receipt.resumable === true && !cleanupPassed)
      || (receipt.resumable !== true && cleanupPassed)
    ) fail('CLEANUP_UNPROVEN', 'Attempt resumability disagrees with full process/profile cleanup evidence.');
    if (receipt.resumable !== true) fail('CLEANUP_UNPROVEN', 'Attempt receipt records non-resumable target cleanup.');
    cursor = receipt.profileState.after;
    records.push(record);
  }
  const expectedArtifactDirectories = records.map((record) =>
    `${String(record.payload.ordinal).padStart(4, '0')}-${record.payload.attemptId}`);
  const actualArtifactDirectories = fs.existsSync(artifactProfileRoot)
    ? fs.readdirSync(safeDirectory(artifactProfileRoot, 'Attempt artifact profile directory')).sort((a, b) =>
      a.localeCompare(b, 'en'))
    : [];
  if (canonicalJson(actualArtifactDirectories) !== canonicalJson(expectedArtifactDirectories)) {
    fail('ATTEMPT_ARTIFACT_INVALID', 'Attempt artifact directories do not exactly match immutable attempt receipts.');
  }
  return {
    cleanupBindingProven: true,
    cursor,
    records,
  };
}

function expectedCheckpointEvidenceBinding(attemptPayload) {
  const profileId = attemptPayload?.profileId;
  return {
    attemptId: attemptPayload?.attemptId,
    invocationId: attemptPayload?.invocationId,
    profileId,
    profileLockBinding:
      attemptPayload?.cleanupEvidence?.profileLockIsolation?.before?.binding,
    runGroupId: attemptPayload?.runGroupId,
    runnerContractSha256: attemptPayload?.runnerContractSha256,
    scalePercent: profileId === 'wide-1400x900-100'
      ? 100
      : Number.parseInt(String(profileId || '').split('-')[0], 10),
  };
}

function checkpointRunEvidenceMatchesTerminalAttempt(
  runEvidence,
  attemptPayload,
) {
  const expectedBinding = expectedCheckpointEvidenceBinding(attemptPayload);
  const cleanupEvidence = {
    chromiumProcessLineage: runEvidence?.chromiumProcessLineage ?? null,
    packageProcessIsolation: runEvidence?.packageProcessIsolation ?? null,
    profileLockIsolation: runEvidence?.profileLockIsolation ?? null,
    profileProcessIsolation: runEvidence?.profileProcessIsolation ?? null,
  };
  return attemptPayload?.passed === true
    && attemptPayload?.resumable === true
    && runEvidence?.passed === attemptPayload.passed
    && runEvidence?.profileId === attemptPayload.profileId
    && canonicalJson(runEvidence?.evidenceBinding)
      === canonicalJson(expectedBinding)
    && canonicalJson(runEvidence?.attemptArtifacts)
      === canonicalJson(attemptPayload.attemptArtifacts)
    && canonicalJson(runEvidence?.artifactReferences)
      === canonicalJson(attemptPayload.artifactReferences)
    && canonicalJson(cleanupEvidence)
      === canonicalJson(attemptPayload.cleanupEvidence)
    && canonicalJson(runEvidence?.diagnostics)
      === canonicalJson(attemptPayload.diagnostics)
    && canonicalJson(runEvidence?.failure)
      === canonicalJson(attemptPayload.failure)
    && attemptOutcomeMatches(attemptPayload);
}

function checkpointMatches({
  checkpoint,
  lineageStart,
  metadata,
  profileId,
  records,
  root,
  runnerPath,
  sequence,
  validateProfileEvidence,
}) {
  const payload = checkpoint.payload;
  const terminal = records[records.length - 1];
  if (
    !terminal
    || terminal.payload.passed !== true
    || !hasOnlyKeys(payload, ['attemptReceipt', 'attemptReceipts', 'completedAt', 'kind', 'lineageStart', 'packageLineage', 'profileId', 'profileState', 'runEvidence', 'runGroupId', 'runnerContractSha256', 'schemaVersion', 'sequence'])
    || payload.profileId !== profileId
    || payload.runGroupId !== metadata.runGroupId
    || payload.sequence !== sequence
    || !validIsoDate(payload.completedAt)
    || Date.parse(payload.completedAt) < Date.parse(terminal?.payload?.completedAt || '')
    || payload.runnerContractSha256 !== metadata.runnerContractSha256
    || canonicalJson(payload.packageLineage) !== canonicalJson(metadata.packageLineage)
    || !stateMatches(lineageStart, payload.lineageStart)
    || canonicalJson(payload.profileState) !== canonicalJson(terminal.payload.profileState)
    || !stateMatches(payload.profileState.after, terminal.payload.profileState.after)
    || payload.runEvidence?.passed !== true
    || !cleanupProven(payload.runEvidence)
    || !checkpointRunEvidenceMatchesTerminalAttempt(
      payload.runEvidence,
      terminal.payload,
    )
    || !fileRecordMatches(payload.attemptReceipt, terminal.file)
    || canonicalJson(payload.attemptReceipts)
      !== canonicalJson(records.map((record) => ({
        attemptId: record.payload.attemptId,
        file: record.file,
        invocationId: record.payload.invocationId,
        ordinal: record.payload.ordinal,
        payloadSha256: record.payloadSha256,
      })))
  ) fail('CHECKPOINT_CURSOR_MISMATCH', 'Checkpoint is not bound to its complete terminal successful attempt chain.');
  const expectedCheckpoint = path.join(root, 'checkpoints', `${profileId}.json`);
  if (!samePath(checkpoint.file.path, expectedCheckpoint)) {
    fail('CHECKPOINT_CURSOR_MISMATCH', 'Checkpoint path is detached from its profile.');
  }
  const fullValidation = validateProfileEvidence({
    profileId,
    runEvidence: payload.runEvidence,
    runnerPath,
  });
  if (
    fullValidation?.passed !== true
    || fullValidation?.cleanupPassed !== true
    || fullValidation?.diagnosticsPassed !== true
    || fullValidation?.shapePassed !== true
  ) {
    fail(
      'CHECKPOINT_EVIDENCE_INCOMPLETE',
      'Checkpoint runEvidence does not satisfy the current profile-specific schema-v8 validator.',
    );
  }
}

function ensureNoFutureRecords(root, startIndex) {
  for (const profileId of PROFILE_SEQUENCE.slice(startIndex + 1)) {
    for (const candidate of [
      path.join(root, 'attempts', profileId),
      path.join(root, 'checkpoints', `${profileId}.json`),
      path.join(root, 'profile-attempt-artifacts', profileId),
    ]) {
      if (fs.existsSync(candidate)) fail('CHECKPOINT_CURSOR_MISMATCH', 'Run group contains out-of-order future profile records.');
    }
  }
}

function parseArgs(argv) {
  const values = {};
  const names = new Set([
    'authority-selection',
    'output',
    'resume-run-group',
    'expected-exe-sha256',
    'expected-app-content-sha256',
    'user-data-dir',
    'protected-db',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      if (argv.length !== 1) throw new Error('--help cannot be combined with inspection arguments.');
      return { help: true };
    }
    if (!token.startsWith('--') || !names.has(token.slice(2))) throw new Error(`Unknown argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--') || Object.hasOwn(values, key)) throw new Error(`${token} requires exactly one value`);
    values[key] = value;
    index += 1;
  }
  for (const key of names) if (!values[key]) throw new Error(`--${key} is required`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,80}$/.test(values['resume-run-group'])) throw new Error('--resume-run-group is not path-safe');
  for (const key of ['expected-exe-sha256', 'expected-app-content-sha256']) {
    values[key] = String(values[key]).toUpperCase();
    if (!/^[A-F0-9]{64}$/.test(values[key])) throw new Error(`--${key} must be SHA-256`);
  }
  values.output = path.resolve(values.output);
  values['user-data-dir'] = validateEvidenceUserDataPath(values['user-data-dir'], { requireExisting: false });
  values['protected-db'] = path.resolve(values['protected-db']);
  values['authority-selection'] = path.resolve(values['authority-selection']);
  const canonical = canonicalAuthorityPaths();
  if (!samePath(values['protected-db'], canonical.databasePath)) {
    throw new Error('--protected-db must be the canonical Amazon AI Ops authority database.');
  }
  values.executable = DEFAULT_EXE;
  values.appContent = DEFAULT_APP_CONTENT;
  return values;
}

function violation(code, message) {
  return { code, message };
}

function classify(violations) {
  if (violations.length === 0) return 'RESUME_SAFE';
  if (violations.some((item) => item.code === 'RUNNER_LEASE_UNSUPPORTED')) return 'RUNNER_REPAIR_REQUIRED';
  if (violations.some((item) => (
    item.code.startsWith('PROFILE_')
    || item.code.startsWith('ATTEMPT_')
    || item.code.startsWith('CHECKPOINT_')
    || item.code === 'CLEANUP_UNPROVEN'
    || item.code === 'CLEANUP_BINDING_UNPROVEN'
  ))) return 'FRESH_PROFILE_REQUIRED';
  if (violations.some((item) => (
    item.code.startsWith('AUTHORITY_')
    || item.code.startsWith('PACKAGE_')
    || item.code.startsWith('RUNNER_')
    || item.code.startsWith('CHROMIUM_')
    || item.code.startsWith('PROTECTED_DB_')
  ))) return 'LINEAGE_CHANGED';
  if (violations.some((item) => item.code.startsWith('PROCESS_'))) return 'PROCESS_STOP_REQUIRED';
  if (violations.every((item) => item.code === 'RUN_GROUP_COMPLETE')) return 'RUN_GROUP_COMPLETE';
  return 'RECORD_ROOT_REQUIRED';
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function profileCursorBinding(state) {
  return {
    logicalDatabaseSha256: state?.logicalDatabase?.sha256 || null,
    logicalDatabaseSizeBytes: state?.logicalDatabase?.sizeBytes ?? null,
    logicalDatabaseTotalPages: state?.logicalDatabase?.totalPages ?? null,
    profileContentFileCount: state?.profileContent?.fileCount ?? null,
    profileContentSha256: state?.profileContent?.sha256 || null,
    profileContentSizeBytes: state?.profileContent?.sizeBytes ?? null,
  };
}

function resumeInspectionCore(payload) {
  return {
    authorityBinding: payload?.authorityBinding,
    createdAt: payload?.createdAt,
    cursor: payload?.cursor,
    expiresAt: payload?.expiresAt,
    invocationId: payload?.invocationId,
    kind: payload?.kind,
    nextProfileId: payload?.nextProfileId,
    runGroupId: payload?.runGroupId,
    runnerContractSha256: payload?.runnerContractSha256,
    schemaVersion: payload?.schemaVersion,
  };
}

function writeResumeInspectionIntent(options, {
  authorityBinding,
  cursor,
  nextProfileId,
  runGroupId,
  runnerContractSha256,
}) {
  const createdAt = new Date();
  const invocationId = `${createdAt.toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}`;
  const core = {
    authorityBinding,
    createdAt: createdAt.toISOString(),
    cursor: cursor?.logicalDatabaseSha256
      ? cursor
      : profileCursorBinding(cursor),
    expiresAt: new Date(createdAt.valueOf() + 60 * 60 * 1000).toISOString(),
    invocationId,
    kind: 'package-ui-resume-inspection',
    nextProfileId,
    runGroupId,
    runnerContractSha256,
    schemaVersion: RESUME_INSPECTION_SCHEMA,
  };
  const intentBindingSha256 = sha256Buffer(Buffer.from(canonicalJson(core), 'utf8'));
  const intentRoot = path.join(
    path.resolve(options.output),
    'resume-intents',
    runGroupId,
  );
  fs.mkdirSync(intentRoot, { recursive: true });
  safeDirectory(intentRoot, 'Resume inspection intent directory', 'RECORD_ROOT_INVALID');
  const receiptPath = path.join(intentRoot, `${intentBindingSha256}.json`);
  const argv = [
    'scripts/run-package-ui-evidence.js',
    '--output', path.resolve(options.output),
    '--resume-run-group', runGroupId,
    '--expected-exe-sha256', options['expected-exe-sha256'],
    '--expected-app-content-sha256', options['expected-app-content-sha256'],
    '--user-data-dir', path.resolve(options['user-data-dir']),
    '--protected-db', path.resolve(options['protected-db']),
    '--authority-selection', path.resolve(options['authority-selection']),
    '--resume-inspection-receipt', receiptPath,
    '--allow-interactive-login',
  ];
  const payload = {
    ...core,
    argv,
    intentBindingSha256,
  };
  const envelope = {
    payload,
    payloadSha256: sha256Buffer(Buffer.from(canonicalJson(payload), 'utf8')),
  };
  const temporaryPath = `${receiptPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryPath, receiptPath);
    fs.unlinkSync(temporaryPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  const receipt = safeFileArtifact(
    receiptPath,
    'Resume inspection intent',
    'RECORD_ROOT_INVALID',
  );
  return {
    argv,
    command: 'node',
    inspectionReceipt: receipt,
    invocationId,
    pathInputsRequired: [],
    powershellDisplay: ['node', ...argv].map(powershellQuote).join(' '),
  };
}

function packageProcessAbsenceProven(snapshot) {
  return processSnapshotEvidencePassed(snapshot)
    && snapshot.observedCount === 0
    && snapshot.matchingCount === 0
    && snapshot.unresolvedCount === 0;
}

function profileProcessAbsenceProven(snapshot) {
  return processSnapshotEvidencePassed(snapshot)
    && snapshot.matchingCount === 0
    && snapshot.unresolvedCount === 0
    && (snapshot.ignoredUnresolvedCount === undefined
      || snapshot.ignoredUnresolvedCount === 0);
}

function runnerLeaseAbsenceProven(lease, runGroupId, runnerContractSha256) {
  return lease?.supported === true
    && lease?.passed === true
    && lease?.activeRunnerCount === 0
    && lease?.runGroupId === runGroupId
    && lease?.runnerContractSha256 === runnerContractSha256;
}

function appendProcessViolations(violations, facts, runGroupId, runnerContractSha256) {
  if (!packageProcessAbsenceProven(facts?.packageProcess)) {
    violations.push(violation(
      'PROCESS_PACKAGE_ACTIVE',
      'Every AmazonAIOpsAgent.exe process must be absent, including installed, portable, unresolved, and non-canonical copies.',
    ));
  }
  if (!profileProcessAbsenceProven(facts?.profileProcess)) {
    violations.push(violation(
      'PROCESS_PROFILE_ACTIVE',
      'A bundled Chromium process still owns the isolated profile or could not be resolved.',
    ));
  }
  if (facts?.runnerLease?.supported !== true) {
    violations.push(violation(
      'RUNNER_LEASE_UNSUPPORTED',
      'The current Package UI runner does not publish an immutable run-group lease, so an active runner Node process cannot be excluded without command-line guessing.',
    ));
  } else if (!runnerLeaseAbsenceProven(facts.runnerLease, runGroupId, runnerContractSha256)) {
    violations.push(violation(
      'PROCESS_RUNNER_ACTIVE',
      'The exact run-group lease is active, unresolved, or detached from the current runner contract.',
    ));
  }
}

function dedupeViolations(violations) {
  const seen = new Set();
  for (let index = violations.length - 1; index >= 0; index -= 1) {
    const key = canonicalJson(violations[index]);
    if (seen.has(key)) violations.splice(index, 1);
    else seen.add(key);
  }
}

function inspect(options, injected = {}) {
  const violations = [];
  let resumeContext = null;
  const runGroupId = options['resume-run-group'];
  const output = path.resolve(options.output);
  const runGroupPath = path.join(output, 'run-groups', runGroupId);
  const result = {
    bindings: {
      outputPathSha256: sha256Buffer(Buffer.from(normalizedPath(output), 'utf8')),
      protectedDatabasePathSha256: sha256Buffer(Buffer.from(normalizedPath(options['protected-db']), 'utf8')),
      userDataPathSha256: sha256Buffer(Buffer.from(normalizedPath(options['user-data-dir']), 'utf8')),
    },
    runGroupId,
    runnerLimitations: [],
    schemaVersion: 'package-ui-run-group-inspection/v1',
    violations,
  };
  const captureLogical = injected.captureSqliteLogicalArtifact || sqliteLogicalArtifact;
  const getRunnerFacts = injected.getRunnerFacts || runnerFactsFromPureChild;
  const validateProfileEvidence = injected.validateProfileEvidence || validateProfileEvidenceFromPureChild;
  const validateProfileProvenance = injected.validateProfileProvenance
    || validateProfileDatabaseProvenanceFromPureChild;
  const validateAuthoritySelection = injected.validateAuthoritySelection
    || validateAuthoritySelectionFromPureChild;
  try {
    if (
      injected.allowNonCanonicalPackagePaths !== true
      && (!samePath(options.executable, DEFAULT_EXE) || !samePath(options.appContent, DEFAULT_APP_CONTENT))
    ) fail('PACKAGE_PATH_OVERRIDE_FORBIDDEN', 'Production inspection must use the fixed canonical package paths.');
    const authorityPaths = injected.canonicalAuthorityPaths
      || (
        injected.allowNonCanonicalAuthorityPath === true
          ? {
            databasePath: path.resolve(options['protected-db']),
            roamingAppData: path.dirname(path.dirname(path.dirname(options['protected-db']))),
            userDataDir: path.dirname(options['protected-db']),
            userProfile: path.parse(options['protected-db']).root,
          }
          : canonicalAuthorityPaths(injected)
      );
    if (
      injected.allowNonCanonicalAuthorityPath !== true
      && !samePath(options['protected-db'], authorityPaths.databasePath)
    ) fail('PROTECTED_DB_PATH_INVALID', 'Production inspection must use the Windows Known Folder canonical authority database path.');
    if (!fs.existsSync(output) || !fs.existsSync(runGroupPath)) {
      fail('RECORD_ROOT_MISSING', 'The requested evidence root or run group does not exist.');
    }
    const root = safeDirectory(runGroupPath, 'Run-group root');
    const rootBefore = directoryTreeManifest(root, 'Run-group root');
    validateRootStructure(root);
    const rawMetadata = JSON.parse(
      stableFileRead(
        path.join(root, 'run-group.json'),
        'Run-group metadata',
        'RECORD_ROOT_INVALID',
      ).buffer.toString('utf8'),
    );
    if (
      rawMetadata?.payload?.kind === 'package-ui-run-group'
      && rawMetadata.payload.schemaVersion !== RUN_GROUP_SCHEMA
    ) {
      fail(
        'CHECKPOINT_SCHEMA_OBSOLETE',
        'Historical Package UI run groups are audit-only and require a fresh profile/run group.',
      );
    }
    const metadataRecord = readEnvelope(
      path.join(root, 'run-group.json'),
      'package-ui-run-group',
      RUN_GROUP_SCHEMA,
      root,
    );
    const metadata = metadataRecord.payload;
    if (
      !hasOnlyKeys(metadata, ['authorityBinding', 'createdAt', 'genesisProfileState', 'kind', 'packageLineage', 'profileSequence', 'protectedDatabaseLogical', 'runGroupId', 'runnerContract', 'runnerContractSha256', 'schemaVersion'])
      || metadata.runGroupId !== runGroupId
      || !validIsoDate(metadata.createdAt)
      || canonicalJson(metadata.profileSequence) !== canonicalJson(PROFILE_SEQUENCE)
      || !validProfileState(metadata.genesisProfileState)
      || !validAuthorityBinding(metadata.authorityBinding)
      || !validLogicalArtifact(metadata.protectedDatabaseLogical)
      || !hasOnlyKeys(metadata.packageLineage, ['appContentSha256', 'chromium', 'executableSha256', 'profileBindingSha256', 'profileBrowserBindingSha256'])
      || !hasOnlyKeys(metadata.packageLineage.chromium, ['relativePath', 'sha256', 'sizeBytes'])
      || !hasOnlyKeys(metadata.runnerContract, ['evidenceScript', 'protectedSqliteTempScript', 'semanticContractSha256', 'sha256'])
      || !hasOnlyKeys(metadata.runnerContract.evidenceScript, ['sha256', 'sizeBytes'])
      || !hasOnlyKeys(metadata.runnerContract.protectedSqliteTempScript, ['sha256', 'sizeBytes'])
    ) fail('RECORD_ROOT_INVALID', 'Run-group metadata has an invalid current-schema shape.');

    const exeBefore = safeFileArtifact(options.executable, 'Packaged EXE', 'PACKAGE_EXE_INVALID');
    const appBefore = appContentManifest(options.appContent);
    const chromiumPath = path.join(appBefore.root, ...BUNDLED_CHROMIUM_RELATIVE_PATH.split('/'));
    const chromiumBefore = safeFileArtifact(chromiumPath, 'Bundled Chromium', 'CHROMIUM_LINEAGE_INVALID');
    const runnerPath = path.join(__dirname, 'package-ui-evidence.js');
    const runnerBefore = safeFileArtifact(runnerPath, 'Package UI runner', 'RUNNER_LINEAGE_INVALID');
    const protectedSqliteTempBefore = safeFileArtifact(
      path.join(__dirname, 'protected-sqlite-temp.js'),
      'Protected SQLite temp helper',
      'RUNNER_LINEAGE_INVALID',
    );
    const facts = getRunnerFacts({
      chromiumPath,
      executablePath: options.executable,
      outputDir: output,
      profileBrowserPath: path.join(options['user-data-dir'], 'stores'),
      runGroupId,
      runnerPath,
    });
    if (
      canonicalJson(facts?.runnerContract) !== canonicalJson(metadata.runnerContract)
      || metadata.runnerContractSha256 !== metadata.runnerContract.sha256
      || runnerBefore.sha256 !== metadata.runnerContract.evidenceScript.sha256
      || runnerBefore.sizeBytes !== metadata.runnerContract.evidenceScript.sizeBytes
      || protectedSqliteTempBefore.sha256
        !== metadata.runnerContract.protectedSqliteTempScript.sha256
      || protectedSqliteTempBefore.sizeBytes
        !== metadata.runnerContract.protectedSqliteTempScript.sizeBytes
    ) violations.push(violation('RUNNER_LINEAGE_DRIFT', 'Current runner code or semantic contract differs from the immutable run group.'));
    if (exeBefore.sha256 !== options['expected-exe-sha256'] || exeBefore.sha256 !== metadata.packageLineage.executableSha256) {
      violations.push(violation('PACKAGE_EXE_DRIFT', 'Packaged EXE differs from the approved run-group lineage.'));
    }
    if (appBefore.sha256 !== options['expected-app-content-sha256'] || appBefore.sha256 !== metadata.packageLineage.appContentSha256) {
      violations.push(violation('PACKAGE_APP_CONTENT_DRIFT', 'Packaged app content differs from the approved run-group lineage.'));
    }
    if (
      chromiumBefore.sha256 !== metadata.packageLineage.chromium.sha256
      || chromiumBefore.sizeBytes !== metadata.packageLineage.chromium.sizeBytes
      || metadata.packageLineage.chromium.relativePath !== BUNDLED_CHROMIUM_RELATIVE_PATH
    ) violations.push(violation('CHROMIUM_LINEAGE_DRIFT', 'Bundled Chromium differs from the immutable run-group lineage.'));
    if (
      metadata.runnerContractSha256 !== metadata.runnerContract.sha256
      || facts?.runnerContract?.sha256 !== metadata.runnerContractSha256
    ) violations.push(violation('RUNNER_LINEAGE_DRIFT', 'Run-group runner contract binding is internally inconsistent.'));
    appendProcessViolations(
      violations,
      facts,
      runGroupId,
      metadata.runnerContractSha256,
    );
    if (violations.length > 0) {
      const finalFacts = getRunnerFacts({
        chromiumPath,
        executablePath: options.executable,
        outputDir: output,
        profileBrowserPath: path.join(options['user-data-dir'], 'stores'),
        runGroupId,
        runnerPath,
      });
      appendProcessViolations(
        violations,
        finalFacts,
        runGroupId,
        metadata.runnerContractSha256,
      );
      result.processAttestation = {
        finalPackageObservedCount: finalFacts?.packageProcess?.observedCount ?? null,
        finalProfileMatchingCount: finalFacts?.profileProcess?.matchingCount ?? null,
        runnerLeaseSupported: finalFacts?.runnerLease?.supported === true,
      };
      dedupeViolations(violations);
      result.status = classify(violations);
      return result;
    }

    const profileRoot = safeDirectory(options['user-data-dir'], 'Isolated profile', 'PROFILE_CONTENT_INVALID');
    const profileDatabasePath = path.join(profileRoot, 'amazon-ai-ops.db');
    const protectedIdentity = stableFileRead(options['protected-db'], 'Protected database', 'PROTECTED_DB_INVALID');
    const profileIdentity = stableFileRead(profileDatabasePath, 'Isolated profile database', 'PROFILE_DATABASE_INVALID');
    if (
      samePath(protectedIdentity.file.path, profileIdentity.file.path)
      || (
        protectedIdentity.stat.dev === profileIdentity.stat.dev
        && protectedIdentity.stat.ino === profileIdentity.stat.ino
      )
    ) fail('PROFILE_DATABASE_NOT_ISOLATED', 'Isolated profile database is the protected authority database.');
    if (!logicalMatches(
      metadata.genesisProfileState.logicalDatabase,
      metadata.protectedDatabaseLogical,
    )) {
      fail(
        'PROFILE_GENESIS_PROVENANCE_INVALID',
        'The genesis profile logical DB is not an exact hash/size/page copy of the protected logical authority DB.',
      );
    }
    const provenanceValidation = validateProfileProvenance({
      profileDatabase: {
        path: profileDatabasePath,
        sha256: metadata.genesisProfileState.logicalDatabase.sha256,
        sizeBytes: metadata.genesisProfileState.logicalDatabase.sizeBytes,
      },
      profileDatabasePath,
      protectedDatabase: {
        path: options['protected-db'],
        sha256: metadata.protectedDatabaseLogical.sha256,
        sizeBytes: metadata.protectedDatabaseLogical.sizeBytes,
      },
      protectedDatabasePath: options['protected-db'],
      runnerPath,
    });
    if (
      provenanceValidation?.provenance?.passed !== true
      || provenanceValidation?.fileIsolation?.passed !== true
      || provenanceValidation.fileIsolation.sameFileIdentity !== false
      || provenanceValidation.fileIsolation.sharedHardLinkCount !== 0
    ) {
      fail(
        'PROFILE_DATABASE_FILE_ISOLATION_UNPROVEN',
        'Runner-grade Windows file-ID and two-way hardlink enumeration did not prove DB isolation.',
      );
    }

    const protectedBefore = captureLogical(options['protected-db'], 'protected-before');
    if (!logicalMatches(metadata.protectedDatabaseLogical, protectedBefore)) {
      violations.push(violation('PROTECTED_DB_DRIFT', 'Protected authority database differs from the immutable run group.'));
    }
    const authorityReceiptBefore = stableFileRead(
      options['authority-selection'],
      'Production authority-selection receipt',
      'AUTHORITY_SELECTION_INVALID',
    );
    const authorityValidation = validateAuthoritySelection({
      canonicalPaths: authorityPaths,
      protectedDatabasePath: options['protected-db'],
      receiptPath: authorityReceiptBefore.file.path,
    });
    if (
      authorityValidation?.passed !== true
      || authorityValidation.receiptSha256 !== authorityReceiptBefore.file.sha256
      || !logicalMatches(authorityValidation.logicalArtifact, metadata.protectedDatabaseLogical)
    ) {
      violations.push(violation(
        'AUTHORITY_SELECTION_INVALID',
        'The supplied authority-selection receipt is not current or is detached from the Known Folder authority DB and run-group logical hash.',
      ));
    }
    const authorityBindingBefore = currentAuthorityBinding(
      options['protected-db'],
      authorityReceiptBefore.file.sha256,
      authorityPaths.databasePath,
    );
    if (
      canonicalJson(authorityBindingBefore)
      !== canonicalJson(metadata.authorityBinding)
    ) {
      violations.push(violation(
        'AUTHORITY_BINDING_CHANGED',
        'Canonical DB path identity or authority-selection receipt hash differs from the immutable run group.',
      ));
    }
    const expectedProfileBinding = sha256Buffer(Buffer.from(normalizedPath(profileRoot), 'utf8'));
    const expectedBrowserBinding = sha256Buffer(Buffer.from(normalizedPath(path.join(profileRoot, 'stores')), 'utf8'));
    if (
      metadata.packageLineage.profileBindingSha256 !== expectedProfileBinding
      || metadata.packageLineage.profileBrowserBindingSha256 !== expectedBrowserBinding
    ) violations.push(violation('PROFILE_BINDING_DRIFT', 'Requested profile path differs from the immutable run-group binding.'));
    const manifestRecords = validateManifests(
      root,
      metadataRecord,
      options,
      injected.validateManifestEvidence || validateManifestEvidenceFromPureChild,
    );
    const profileLogicalBefore = captureLogical(profileDatabasePath, 'profile-before');
    const profileContentBefore = profileManifest(profileRoot);

    let cursor = metadata.genesisProfileState;
    let nextProfile = null;
    const allAttemptRecords = [];
    for (let index = 0; index < PROFILE_SEQUENCE.length; index += 1) {
      const profileId = PROFILE_SEQUENCE[index];
      const lineageStart = cursor;
      const attempts = loadAttemptRecords({
        metadata,
        profileId,
        root,
        startCursor: cursor,
      });
      allAttemptRecords.push(...attempts.records);
      cursor = attempts.cursor;
      const checkpointPath = path.join(root, 'checkpoints', `${profileId}.json`);
      if (fs.existsSync(checkpointPath)) {
        const checkpoint = readEnvelope(checkpointPath, 'package-ui-profile-checkpoint', CHECKPOINT_SCHEMA, root);
        checkpointMatches({
          checkpoint,
          lineageStart,
          metadata,
          profileId,
          records: attempts.records,
          root,
          runnerPath,
          sequence: index + 1,
          validateProfileEvidence,
        });
        cursor = checkpoint.payload.profileState.after;
        continue;
      }
      if (attempts.cleanupBindingProven !== true) {
        fail(
          'CLEANUP_BINDING_UNPROVEN',
          'A non-checkpointed attempt is not bound to complete cleanup-safe invocation evidence.',
        );
      }
      nextProfile = profileId;
      ensureNoFutureRecords(root, index);
      break;
    }
    validateInvocationCollections(root, manifestRecords, allAttemptRecords);
    if (nextProfile === null) violations.push(violation('RUN_GROUP_COMPLETE', 'Run group already has all immutable profile checkpoints.'));

    const profileContentAfter = profileManifest(profileRoot);
    const profileLogicalAfter = captureLogical(profileDatabasePath, 'profile-after');
    const currentProfileState = {
      capturedAt: new Date().toISOString(),
      logicalDatabase: profileLogicalAfter,
      profileContent: profileContentAfter,
    };
    if (
      !logicalMatches(profileLogicalBefore, profileLogicalAfter)
      || canonicalJson(profileContentBefore) !== canonicalJson(profileContentAfter)
      || !stateMatches(cursor, currentProfileState)
    ) violations.push(violation('PROFILE_CONTENT_DRIFT', 'Isolated profile changed or differs from its immutable continuation cursor.'));
    const protectedAfter = captureLogical(options['protected-db'], 'protected-after');
    if (!logicalMatches(protectedBefore, protectedAfter)) {
      violations.push(violation('PROTECTED_DB_DRIFT', 'Protected authority database changed during read-only inspection.'));
    }
    const authorityReceiptAfter = stableFileRead(
      options['authority-selection'],
      'Production authority-selection receipt',
      'AUTHORITY_SELECTION_INVALID',
    );
    if (
      authorityReceiptBefore.file.sha256 !== authorityReceiptAfter.file.sha256
      || authorityReceiptBefore.file.sizeBytes !== authorityReceiptAfter.file.sizeBytes
      || authorityReceiptBefore.file.mtimeMs !== authorityReceiptAfter.file.mtimeMs
    ) {
      violations.push(violation(
        'AUTHORITY_SELECTION_TOCTOU',
        'The production authority-selection receipt changed during inspection.',
      ));
    }
    const authorityBindingAfter = currentAuthorityBinding(
      options['protected-db'],
      authorityReceiptAfter.file.sha256,
      authorityPaths.databasePath,
    );
    if (canonicalJson(authorityBindingBefore) !== canonicalJson(authorityBindingAfter)) {
      violations.push(violation(
        'AUTHORITY_BINDING_TOCTOU',
        'Canonical authority DB file identity changed during inspection.',
      ));
    }
    const exeAfter = safeFileArtifact(options.executable, 'Packaged EXE', 'PACKAGE_EXE_INVALID');
    const appAfter = appContentManifest(options.appContent);
    const chromiumAfter = safeFileArtifact(chromiumPath, 'Bundled Chromium', 'CHROMIUM_LINEAGE_INVALID');
    const runnerAfter = safeFileArtifact(runnerPath, 'Package UI runner', 'RUNNER_LINEAGE_INVALID');
    if (
      exeBefore.sha256 !== exeAfter.sha256
      || appBefore.sha256 !== appAfter.sha256
      || chromiumBefore.sha256 !== chromiumAfter.sha256
      || runnerBefore.sha256 !== runnerAfter.sha256
    ) violations.push(violation('PACKAGE_TOCTOU_DRIFT', 'Package or runner lineage changed during inspection.'));
    const rootAfter = directoryTreeManifest(root, 'Run-group root');
    if (canonicalJson(rootBefore) !== canonicalJson(rootAfter)) {
      violations.push(violation('RECORD_ROOT_TOCTOU', 'Run-group records changed during inspection.'));
    }
    result.nextProfileId = nextProfile;
    result.cursor = profileCursorBinding(cursor);
    result.authoritySelection = {
      receiptSha256: authorityReceiptAfter.file.sha256,
      status: authorityValidation?.status || null,
    };
    const finalFacts = getRunnerFacts({
      chromiumPath,
      executablePath: options.executable,
      outputDir: output,
      profileBrowserPath: path.join(options['user-data-dir'], 'stores'),
      runGroupId,
      runnerPath,
    });
    if (
      canonicalJson(finalFacts?.runnerContract) !== canonicalJson(metadata.runnerContract)
      || finalFacts?.runnerContract?.sha256 !== metadata.runnerContractSha256
    ) {
      violations.push(violation(
        'RUNNER_LINEAGE_DRIFT',
        'Runner code or semantic contract changed before the final process attestation.',
      ));
    }
    appendProcessViolations(
      violations,
      finalFacts,
      runGroupId,
      metadata.runnerContractSha256,
    );
    result.processAttestation = {
      finalPackageObservedCount: finalFacts?.packageProcess?.observedCount ?? null,
      finalProfileMatchingCount: finalFacts?.profileProcess?.matchingCount ?? null,
      runnerLeaseSupported: finalFacts?.runnerLease?.supported === true,
    };
    resumeContext = {
      authorityBinding: metadata.authorityBinding,
      cursor: result.cursor,
      nextProfileId: nextProfile,
      runGroupId,
      runnerContractSha256: metadata.runnerContractSha256,
    };
  } catch (error) {
    violations.push(violation(
      error instanceof InspectionError ? error.code : 'RECORD_ROOT_INVALID',
      error instanceof InspectionError
        ? error.message
        : 'Inspection failed on a missing, malformed, linked, or unstable artifact.',
    ));
  }
  dedupeViolations(violations);
  result.status = classify(violations);
  if (result.status === 'RESUME_SAFE') {
    result.resume = (injected.writeResumeInspectionIntent
      || writeResumeInspectionIntent)(options, resumeContext);
  }
  return result;
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const result = inspect(parsed);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === 'RESUME_SAFE' ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'package-ui-run-group-inspection/v1',
      status: 'ARGUMENT_ERROR',
      violations: [violation('ARGUMENT_ERROR', 'Invalid inspection arguments; use --help for the fixed production contract.')],
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ATTEMPT_SCHEMA,
  BUNDLED_CHROMIUM_RELATIVE_PATH,
  CHECKPOINT_SCHEMA,
  DEFAULT_APP_CONTENT,
  DEFAULT_EXE,
  PROFILE_SEQUENCE,
  RUN_GROUP_SCHEMA,
  USAGE,
  appContentManifest,
  attemptArtifactManifest,
  attemptArtifactMembershipMatches,
  canonicalJson,
  canonicalAuthorityPaths,
  cleanupProven,
  cloneSecretBlindDiagnosticRecord,
  diagnosticsMatch,
  inspect,
  main,
  parseArgs,
  processSnapshotEvidencePassed,
  profileManifest,
  resolveWindowsKnownFolder,
  runnerFactsFromPureChild,
  sha256Buffer,
  sqliteLogicalArtifact,
  validateInvocationCollections,
  validateAuthoritySelectionFromPureChild,
  validateProfileDatabaseProvenanceFromPureChild,
  validateProfileEvidenceFromPureChild,
  validateManifestEvidenceFromPureChild,
  writeResumeInspectionIntent,
};

Object.defineProperty(module.exports, 'DEFAULT_PROTECTED_DB', {
  enumerable: true,
  get: defaultProtectedDatabasePath,
});
