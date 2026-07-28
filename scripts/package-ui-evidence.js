const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { _electron } = require('./playwright-loader');
const { collectWorkspaceDomMetrics } = require('./workspace-ui-evidence');
const {
  EVIDENCE_MODE_ENV,
  EVIDENCE_USER_DATA_DIR_ENV,
  PACKAGE_UI_EVIDENCE_MODE,
  buildEvidenceUserDataEnv,
  inspectPackagedUserDataOverrideContract,
  validateEvidenceUserDataIdentity,
  validateEvidenceUserDataPath,
} = require('./evidence-user-data');

const ROOT = path.resolve(__dirname, '..');
const DESKTOP_PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'package.json'), 'utf8'));
const DEFAULT_EXECUTABLE_PATH = path.join(
  ROOT,
  'apps',
  'desktop',
  'release',
  'win-unpacked',
  'AmazonAIOpsAgent.exe',
);
const DEFAULT_APP_CONTENT_PATH = path.join(
  ROOT,
  'apps',
  'desktop',
  'release',
  'win-unpacked',
  'resources',
  'app',
);
const EXPECTED_RENDERER_ENTRY_PATH = path.join(DEFAULT_APP_CONTENT_PATH, 'dist', 'renderer', 'index.html');
const DEFAULT_OUTPUT_DIR = 'output/codex-evidence/package-ui-evidence';
const PACKAGE_UI_EVIDENCE_SCHEMA_VERSION = 7;
const LEGACY_SCHEDULER_READ_ONLY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION = 6;
const LEGACY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION = 5;
const PACKAGE_UI_SCHEDULER_AUDIT_FILE = 'package-ui-scheduler-audit.json';
const PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME = 'PACKAGE-UI-EVIDENCE-STORE';
const PACKAGE_UI_SCHEDULER_COUNT_KEYS = Object.freeze([
  'workspaceQuery',
  'schedulerGet',
  'retentionPreview',
  'runNow',
  'runNowRejected',
  'localSchedulerStart',
  'storeSchedulerStart',
  'reconcile',
  'execute',
]);
const PACKAGE_PROCESS_NAME = path.basename(DEFAULT_EXECUTABLE_PATH);
const PROFILE_BROWSER_PROCESS_NAMES = Object.freeze(['chrome.exe', 'chromium.exe', 'msedge.exe']);
const WINDOWS_HARDLINK_ENUMERATION_TIMEOUT_MS = 5_000;
const DEFAULT_INTERACTIVE_LOGIN_TIMEOUT_MS = 600_000;
const DIAGNOSTIC_MESSAGE_LIMIT = 2_000;
const DIAGNOSTIC_STACK_LIMIT = 4_000;
const DIAGNOSTIC_RENDERER_ENTRY_LIMIT = 100;
const REQUIRED_APP_CONTENT_ENTRIES = Object.freeze([
  'package.json',
  'dist/main/index.js',
  'dist/preload/index.js',
  'dist/renderer/index.html',
  'playwright-browsers/chrome-win64/chrome.exe',
]);
const PACKAGE_UI_VIEWPORT = Object.freeze({ width: 1200, height: 700 });
const PACKAGE_UI_VIEWPORT_TOLERANCE = Object.freeze({ width: 2, height: 2, deviceScaleFactor: 0.02 });
const EXPECTED_PACKAGE_UI_SCALES = Object.freeze([
  Object.freeze({ scalePercent: 100, deviceScaleFactor: 1 }),
  Object.freeze({ scalePercent: 125, deviceScaleFactor: 1.25 }),
]);
const EXPECTED_PACKAGE_UI_WORKSPACES = Object.freeze([
  Object.freeze({ workspace: 'today', subview: 'overview', label: '今日任务', heading: '今日任务', tabs: Object.freeze(['overview', 'events']) }),
  Object.freeze({ workspace: 'missions', subview: 'overview', label: '任务中心', heading: '任务中心', tabs: Object.freeze(['overview', 'facts']) }),
  Object.freeze({ workspace: 'decisions', subview: 'recommendations', label: '决策与审批', heading: '建议与审批', tabs: Object.freeze(['recommendations', 'approval', 'decided']) }),
  Object.freeze({ workspace: 'experiments', subview: 'ledger', label: '经营实验', heading: '经营实验', tabs: Object.freeze(['ledger']) }),
  Object.freeze({ workspace: 'execution', subview: 'live', label: '实时执行', heading: '实时执行', tabs: Object.freeze(['live', 'evidence']) }),
  Object.freeze({ workspace: 'memory', subview: 'timeline', label: '因果记忆', heading: '因果记忆', tabs: Object.freeze(['timeline']) }),
  Object.freeze({ workspace: 'objects', subview: 'products', label: '店铺与广告对象', heading: '店铺与广告对象', tabs: Object.freeze(['products', 'targets', 'keywords', 'listing']) }),
  Object.freeze({ workspace: 'collection', subview: 'scope', label: '数据采集', heading: '工作范围', tabs: Object.freeze(['scope', 'reports', 'import-check']) }),
  Object.freeze({ workspace: 'policy', subview: 'rules', label: '策略与风控', heading: '策略与风控', tabs: Object.freeze(['rules']) }),
  Object.freeze({ workspace: 'settings', subview: 'ai-and-local', label: '系统设置', heading: '店铺与运行设置', tabs: Object.freeze(['ai-and-local', 'scheduler', 'delivery']) }),
]);
const EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS = Object.freeze([
  Object.freeze({
    workspace: 'settings',
    subview: 'scheduler',
    label: '系统设置',
    heading: '当前店铺自动化',
    tabId: 'settings-workspace-tab-scheduler',
    capabilities: Object.freeze([
      Object.freeze({
        action: 'view',
        capabilityId: 'settings.scheduler.view',
        legacyRoute: 'scheduler',
        state: 'LEGACY_ADAPTER',
      }),
      Object.freeze({
        action: 'start',
        capabilityId: 'settings.scheduler.run-now',
        legacyRoute: null,
        state: 'PRODUCTION_NATIVE',
      }),
      Object.freeze({
        action: 'view',
        capabilityId: 'settings.scheduler.retention-preview',
        legacyRoute: null,
        state: 'PRODUCTION_NATIVE',
      }),
    ]),
  }),
]);
// The retired Product/Diagnosis queue probes remain available as helpers, but
// Stage 7 package truth is the canonical ten-workspace matrix. Large-table
// capacity is proved independently by verify-mission-control-large-table.js.
const PACKAGE_OBJECT_WORKSPACES = Object.freeze([]);
const PACKAGE_OBJECT_EXPERIENCE_CONTRACTS = Object.freeze({
  compact: Object.freeze({
    maxPageOverflowPx: 24,
    maxPageOverflowRatio: 1.05,
    maxPageScrollLeakPx: 1,
    maxRenderedRows: 30,
    maxStickyHeaderOffsetPx: 2,
    maxWorkSurfaceTopPx: 300,
    minAriaRowCount: 100,
    minFullyVisibleRows: 5,
    minQueueViewportHeightPx: 360,
    scrollProbeRatio: 0.5,
  }),
  wide: Object.freeze({
    maxPageOverflowPx: 24,
    maxPageOverflowRatio: 1.05,
    maxPageScrollLeakPx: 1,
    maxRenderedRows: 30,
    maxStickyHeaderOffsetPx: 2,
    maxWorkSurfaceTopPx: 320,
    minAriaRowCount: 100,
    minFullyVisibleRows: 8,
    minQueueViewportHeightPx: 500,
    scrollProbeRatio: 0.5,
  }),
});
const PACKAGE_UI_WIDE_PROFILE = Object.freeze({
  deviceScaleFactor: 1,
  id: 'wide-1400x900-100',
  scalePercent: 100,
  viewport: Object.freeze({ width: 1400, height: 900 }),
  workspaces: PACKAGE_OBJECT_WORKSPACES,
});
const EXPECTED_OVERLAY_CHECK_IDS = Object.freeze([
  'report-selector-dialog',
  'decisions-controlled-review-inspector',
  'readback-technical-drawer',
]);
const READ_ONLY_INTERACTION_PLAN = Object.freeze([
  Object.freeze({
    id: 'workspace-navigation',
    kind: 'navigation',
    targets: EXPECTED_PACKAGE_UI_WORKSPACES.map((item) => item.label),
  }),
  Object.freeze({
    id: 'workspace-tab-keyboard-navigation',
    kind: 'keyboard-navigation',
    targets: EXPECTED_PACKAGE_UI_WORKSPACES.map((item) => `${item.workspace}:${item.tabs.join(',')}`),
  }),
  Object.freeze({
    id: 'report-subview-navigation',
    kind: 'subview',
    target: '采集任务',
  }),
  Object.freeze({
    id: 'scheduler-subview-readonly',
    kind: 'subview',
    target: '系统设置 / 定时任务',
  }),
  Object.freeze({
    id: 'report-selector-dialog',
    kind: 'overlay',
    target: '调整本次下载/重建的报表',
    trigger: '调整',
  }),
  Object.freeze({
    id: 'decisions-controlled-review-inspector',
    kind: 'overlay',
    target: '当前首条需复核建议的受控复核与 Ads 身份核验表单',
    trigger: '首屏唯一主动作',
  }),
  Object.freeze({
    id: 'readback-technical-drawer',
    kind: 'overlay',
    target: '技术与证据详情',
    trigger: '查看技术与证据详情',
  }),
]);
const INTERACTIVE_LOGIN_CONTRACT = Object.freeze({
  attestationFields: Object.freeze([
    'adsSessionReady',
    'credentialPersistence',
    'credentialSource',
    'erpSessionReady',
    'erpSessionReused',
    'ok',
    'sessionIdentityVerified',
  ]),
  boundedTimeout: true,
  credentialStorageOwner: 'electron-main-safe-storage',
  firstRunFreshTypedIdentityProof: true,
  mode: 'visible-operator-each-run',
  runnerClicksLogin: false,
  runnerReadsSecrets: false,
  runnerTypesSecrets: false,
  savedSessionContinuationRequiresFreshProof: true,
});
const ISOLATED_PROFILE_BOOTSTRAP_CONTRACT = Object.freeze({
  businessReadinessCredit: false,
  fixedScope: Object.freeze({ marketplace: 'US', currency: 'USD' }),
  isolatedProfileMutationAllowed: true,
  protectedDatabaseMutationAllowed: false,
  visibleActions: Object.freeze([
    'explicit-store-selection',
    'create-evidence-store-only-when-no-active-store-exists',
    'bind-current-visible-lingxing-account-only-when-connection-is-missing',
    'visible-operator-login-handoff-without-secret-capture',
  ]),
});
const OVERLAY_FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'summary',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function decisionsTabAccessibleNamePattern(label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}（已载入 \\d+）$`);
}

function fail(message, details) {
  const error = new Error(details ? `${message}: ${details}` : message);
  error.evidenceFailure = true;
  throw error;
}

function argumentValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value.`);
  return value;
}

function normalizeSha256(value, name) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    fail(`${name} must be a 64-character SHA-256 value.`);
  }
  return normalized;
}

function parsePositiveInteger(value, name, minimum = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    fail(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

function parsePackageUiEvidenceArgs(argv) {
  const values = {
    allowInteractiveLogin: false,
    allowSavedLogin: false,
    appContentPath: DEFAULT_APP_CONTENT_PATH,
    executablePath: DEFAULT_EXECUTABLE_PATH,
    interactiveLoginTimeoutMs: DEFAULT_INTERACTIVE_LOGIN_TIMEOUT_MS,
    loginTimeoutMs: 120_000,
    outputDir: DEFAULT_OUTPUT_DIR,
    settleMs: 800,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--allow-saved-login') {
      values.allowSavedLogin = true;
      continue;
    }
    if (name === '--allow-interactive-login') {
      values.allowInteractiveLogin = true;
      continue;
    }
    if (!name.startsWith('--')) fail(`Unexpected argument: ${name}`);
    const value = argumentValue(argv, index, name);
    index += 1;
    switch (name) {
      case '--expected-exe-sha256':
        values.expectedExeSha256 = normalizeSha256(value, name);
        break;
      case '--expected-app-content-sha256':
        values.expectedAppContentSha256 = normalizeSha256(value, name);
        break;
      case '--output':
        values.outputDir = value;
        break;
      case '--login-timeout-ms':
        values.loginTimeoutMs = parsePositiveInteger(value, name, 5_000);
        break;
      case '--interactive-login-timeout-ms':
        values.interactiveLoginTimeoutMs = parsePositiveInteger(value, name, 60_000);
        break;
      case '--settle-ms':
        values.settleMs = parsePositiveInteger(value, name, 0);
        break;
      case '--user-data-dir':
        values.userDataDir = validateEvidenceUserDataPath(value, { requireExisting: false });
        break;
      case '--protected-db':
        values.protectedDatabasePath = path.resolve(value);
        break;
      default:
        fail(`Unknown argument: ${name}`);
    }
  }

  if (!values.expectedExeSha256) fail('--expected-exe-sha256 is required.');
  if (!values.expectedAppContentSha256) fail('--expected-app-content-sha256 is required.');
  if (values.interactiveLoginTimeoutMs > 900_000) {
    fail('--interactive-login-timeout-ms must not exceed 900000.');
  }
  if (values.allowSavedLogin && values.allowInteractiveLogin) {
    fail('--allow-saved-login cannot be combined with --allow-interactive-login.');
  }
  if (!values.userDataDir) fail('--user-data-dir is required and must point to an isolated D-drive profile copy.');
  if (!values.protectedDatabasePath) fail('--protected-db is required so the real AppData SQLite file is hashed before and after evidence capture.');
  if (!values.allowInteractiveLogin) {
    fail('Package UI schema v7 requires --allow-interactive-login; saved-login or existing-session-only capture is historical and unsupported.');
  }
  values.executablePath = path.resolve(values.executablePath);
  values.appContentPath = path.resolve(values.appContentPath);
  return values;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function currentFileRecordMatches(record) {
  const filePath = record?.path;
  if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) return false;
  const lstat = fs.lstatSync(filePath);
  if (!lstat.isFile() || lstat.isSymbolicLink()) return false;
  const stat = fs.statSync(filePath);
  return /^[A-F0-9]{64}$/.test(String(record?.sha256 || ''))
    && Number(record?.sizeBytes) === stat.size
    && sha256File(filePath) === String(record.sha256).toUpperCase();
}

function buildProtectedFileEvidence(before, after) {
  const samePath = normalizedWindowsPath(before?.path || '') === normalizedWindowsPath(after?.path || '');
  const unchanged = samePath
    && before?.sha256 === after?.sha256
    && before?.sizeBytes === after?.sizeBytes
    && before?.mtimeMs === after?.mtimeMs;
  return {
    before,
    after,
    passed: unchanged,
    unchanged,
  };
}

function lexicalWindowsPath(filePath) {
  return path.win32.normalize(String(filePath || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function readWindowsFileIdentity(filePath) {
  const resolvedPath = path.resolve(filePath);
  const leaf = fs.lstatSync(resolvedPath, { bigint: true });
  if (leaf.isSymbolicLink() || !leaf.isFile()) {
    throw new Error(`Database identity target must be a real file, not a symbolic link or junction: ${resolvedPath}`);
  }
  const realPath = fs.realpathSync.native(resolvedPath);
  if (lexicalWindowsPath(realPath) !== lexicalWindowsPath(resolvedPath)) {
    throw new Error(`Database identity target may not traverse a symbolic link or junction: ${resolvedPath} -> ${realPath}`);
  }
  const stat = fs.statSync(realPath, { bigint: true });
  if (!stat.isFile()) {
    throw new Error(`Database identity target must remain a real file: ${realPath}`);
  }
  return {
    deviceId: stat.dev.toString(),
    fileId: stat.ino.toString(),
    hardLinkCount: Number(stat.nlink),
    path: realPath,
    stabilityToken: [
      stat.dev,
      stat.ino,
      stat.nlink,
      stat.size,
      stat.ctimeNs,
      stat.mtimeNs,
    ].join(':'),
  };
}

function absoluteHardLinkPath(filePath, outputLine) {
  const value = String(outputLine || '').trim();
  if (!value || /[\r\n\0]/.test(value)) return null;
  if (/^[a-z]:[\\/]/i.test(value)) return path.win32.normalize(value);
  if (/^[\\/]/.test(value)) {
    const drive = path.win32.parse(filePath).root.slice(0, 2);
    return path.win32.normalize(`${drive}${value}`);
  }
  return null;
}

function windowsFsutilPath() {
  const systemRoot = path.win32.normalize(String(process.env.SystemRoot || ''));
  if (!path.win32.isAbsolute(systemRoot) || systemRoot.startsWith('\\\\')) {
    throw new Error('SystemRoot does not identify a local absolute Windows directory.');
  }
  const executablePath = path.win32.join(systemRoot, 'System32', 'fsutil.exe');
  const leaf = fs.lstatSync(executablePath);
  if (leaf.isSymbolicLink() || !leaf.isFile()) {
    throw new Error(`Windows fsutil must be a real System32 executable: ${executablePath}`);
  }
  const realPath = fs.realpathSync.native(executablePath);
  if (lexicalWindowsPath(realPath) !== lexicalWindowsPath(executablePath)) {
    throw new Error(`Windows fsutil may not resolve through a symbolic link or junction: ${executablePath} -> ${realPath}`);
  }
  return realPath;
}

function enumerateWindowsHardLinks(fileIdentity, run = spawnSync) {
  let result;
  try {
    result = run(windowsFsutilPath(), ['hardlink', 'list', fileIdentity.path], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      shell: false,
      timeout: WINDOWS_HARDLINK_ENUMERATION_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`fsutil hardlink enumeration threw: ${sanitizeDiagnosticText(error?.message || error)}`);
  }
  if (
    !result
    || result.error
    || result.status !== 0
    || result.signal
  ) {
    const detail = result?.error?.message
      || result?.stderr
      || `status=${result?.status ?? 'unknown'} signal=${result?.signal ?? 'none'}`;
    throw new Error(`fsutil hardlink enumeration failed or timed out: ${sanitizeDiagnosticText(detail)}`);
  }
  const paths = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => absoluteHardLinkPath(fileIdentity.path, line))
    .filter(Boolean)
    .map(lexicalWindowsPath);
  const distinctPaths = [...new Set(paths)].sort();
  if (
    !distinctPaths.includes(lexicalWindowsPath(fileIdentity.path))
    || distinctPaths.length !== fileIdentity.hardLinkCount
  ) {
    throw new Error(
      `fsutil hardlink enumeration did not bind the queried file identity (reported=${distinctPaths.length}, nlink=${fileIdentity.hardLinkCount}).`,
    );
  }
  return distinctPaths;
}

function evaluateProfileDatabaseFileIsolation({
  profileDatabasePath,
  protectedDatabasePath,
  run = spawnSync,
}) {
  const violations = [];
  if (process.platform !== 'win32') {
    violations.push(violation(
      'PROFILE_DATABASE_FILE_IDENTITY_UNSUPPORTED',
      'Package UI database file-identity isolation is supported only on Windows.',
    ));
    return { passed: false, violations };
  }

  let profileBefore;
  let protectedBefore;
  let profileLinks;
  let protectedLinks;
  try {
    profileBefore = readWindowsFileIdentity(profileDatabasePath);
    protectedBefore = readWindowsFileIdentity(protectedDatabasePath);
    profileLinks = enumerateWindowsHardLinks(profileBefore, run);
    protectedLinks = enumerateWindowsHardLinks(protectedBefore, run);
    const profileAfter = readWindowsFileIdentity(profileDatabasePath);
    const protectedAfter = readWindowsFileIdentity(protectedDatabasePath);
    if (
      profileBefore.stabilityToken !== profileAfter.stabilityToken
      || protectedBefore.stabilityToken !== protectedAfter.stabilityToken
    ) {
      throw new Error('Database file identity changed during hardlink isolation attestation.');
    }
  } catch (error) {
    violations.push(violation(
      'PROFILE_DATABASE_FILE_IDENTITY_UNVERIFIED',
      'The profile and protected database file identities must be verified before packaged Electron starts.',
      sanitizeDiagnosticText(error?.message || error),
    ));
    return {
      passed: false,
      profileDatabase: profileBefore || null,
      protectedDatabase: protectedBefore || null,
      violations,
    };
  }

  const sameFileIdentity = profileBefore.deviceId === protectedBefore.deviceId
    && profileBefore.fileId === protectedBefore.fileId;
  const sharedHardLinkPaths = profileLinks.filter((candidate) => protectedLinks.includes(candidate));
  if (sameFileIdentity || sharedHardLinkPaths.length > 0) {
    violations.push(violation(
      'PROFILE_DATABASE_HARDLINK_ALIAS',
      'The isolated profile database must not be the protected authority database through a hardlink alias.',
      {
        sameFileIdentity,
        sharedHardLinkCount: sharedHardLinkPaths.length,
      },
    ));
  }
  return {
    passed: violations.length === 0,
    profileDatabase: {
      deviceId: profileBefore.deviceId,
      fileId: profileBefore.fileId,
      hardLinkCount: profileBefore.hardLinkCount,
      path: profileBefore.path,
    },
    protectedDatabase: {
      deviceId: protectedBefore.deviceId,
      fileId: protectedBefore.fileId,
      hardLinkCount: protectedBefore.hardLinkCount,
      path: protectedBefore.path,
    },
    sameFileIdentity,
    sharedHardLinkCount: sharedHardLinkPaths.length,
    violations,
  };
}

function evaluateProfileDatabaseProvenance({ profileDatabase, protectedDatabase }) {
  const hashMatches = Boolean(
    profileDatabase?.sha256
    && protectedDatabase?.sha256
    && String(profileDatabase.sha256).toUpperCase() === String(protectedDatabase.sha256).toUpperCase(),
  );
  const sizeMatches = Number.isFinite(Number(profileDatabase?.sizeBytes))
    && Number(profileDatabase.sizeBytes) === Number(protectedDatabase?.sizeBytes);
  const pathsDistinct = Boolean(
    profileDatabase?.path
    && protectedDatabase?.path
    && normalizedWindowsPath(profileDatabase.path) !== normalizedWindowsPath(protectedDatabase.path),
  );
  const violations = [];
  if (!hashMatches) {
    violations.push(violation(
      'PROFILE_DATABASE_HASH_MISMATCH',
      'The isolated profile database must begin with the protected authority database SHA-256.',
      { profile: profileDatabase?.sha256 || null, protected: protectedDatabase?.sha256 || null },
    ));
  }
  if (!sizeMatches) {
    violations.push(violation(
      'PROFILE_DATABASE_SIZE_MISMATCH',
      'The isolated profile database must begin with the protected authority database size.',
      { profile: profileDatabase?.sizeBytes ?? null, protected: protectedDatabase?.sizeBytes ?? null },
    ));
  }
  if (!pathsDistinct) {
    violations.push(violation(
      'PROFILE_DATABASE_NOT_ISOLATED',
      'The package UI profile database must be a distinct copy, never the protected authority file itself.',
      { profile: profileDatabase?.path || null, protected: protectedDatabase?.path || null },
    ));
  }
  return {
    hashMatches,
    passed: violations.length === 0,
    pathsDistinct,
    profileDatabase,
    protectedDatabase,
    sizeMatches,
    violations,
  };
}

function redactDiagnosticSecrets(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/([?&](?:api[_-]?key|access[_-]?token|authorization|cookie|password|pwd|secret|session(?:[_-]?(?:id|key|token))?|token|username|user[_-]?name|account)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/(--(?:api[-_]?key|access[-_]?token|authorization|cookie|password|passwd|pwd|secret|session(?:[-_]?(?:id|key|token))?|token|username|user[-_]?name|account))(\s*=\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s]+)/gi, '$1$2[REDACTED]')
    .replace(/(\b(?:authorization|proxy-authorization)\s*[:=])[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/(\b(?:cookie|set-cookie)\s*:)[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/(\bbearer\s+)[A-Za-z0-9._~+/-]{6,}/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|authorization|cookie|password|passwd|pwd|secret|session(?:[_ -]?(?:id|key|token))?|token|username|user_name|account)\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,]+)/gi, '$1[REDACTED]');
}

function sanitizeDiagnosticText(value, maximumLength = DIAGNOSTIC_MESSAGE_LIMIT) {
  const boundedMaximum = Number.isInteger(maximumLength) && maximumLength > 0
    ? maximumLength
    : DIAGNOSTIC_MESSAGE_LIMIT;
  return redactDiagnosticSecrets(value)
    .slice(0, boundedMaximum);
}

function createStructuredFailure(error, phase = 'unknown') {
  const source = error instanceof Error ? error : new Error(String(error || 'Unknown failure'));
  return {
    at: new Date().toISOString(),
    message: sanitizeDiagnosticText(source.message, DIAGNOSTIC_MESSAGE_LIMIT),
    name: sanitizeDiagnosticText(source.name || 'Error', 120),
    phase: sanitizeDiagnosticText(phase || 'unknown', 160),
    stack: sanitizeDiagnosticText(source.stack || '', DIAGNOSTIC_STACK_LIMIT),
  };
}

function createRunDiagnostics(profileId, startedAt = new Date()) {
  const timestamp = startedAt instanceof Date ? startedAt.toISOString() : new Date(startedAt).toISOString();
  return {
    cleanupErrors: [],
    completedAt: null,
    failure: null,
    login: {
      attempts: [],
      completedAt: null,
      connectionBootstrap: null,
      operatorHandoff: null,
      outcome: 'not-started',
      savedCredentials: null,
      startedAt: null,
    },
    phase: 'created',
    profileId,
    renderer: {
      consoleErrors: [],
      droppedCount: {
        consoleErrors: 0,
        pageErrors: 0,
      },
      limits: {
        consoleErrors: DIAGNOSTIC_RENDERER_ENTRY_LIMIT,
        pageErrors: DIAGNOSTIC_RENDERER_ENTRY_LIMIT,
      },
      pageErrors: [],
    },
    schemaVersion: 'package-ui-run-diagnostics/v1',
    startedAt: timestamp,
    storeGate: {
      completedAt: null,
      createdEvidenceStore: false,
      currency: 'USD',
      marketplace: 'US',
      outcome: 'not-started',
      selectedStore: null,
      startedAt: null,
    },
    timeline: [{ at: timestamp, phase: 'created' }],
  };
}

function appendRendererDiagnostic(diagnostics, kind, record) {
  const renderer = diagnostics?.renderer;
  const entries = renderer?.[kind];
  const limit = renderer?.limits?.[kind];
  if (!Array.isArray(entries)
    || !Number.isInteger(limit)
    || limit < 1
    || !Number.isInteger(renderer?.droppedCount?.[kind])) {
    return false;
  }
  if (entries.length < limit) {
    entries.push(record);
    return true;
  }
  renderer.droppedCount[kind] += 1;
  return false;
}

function setRunDiagnosticPhase(diagnostics, phase) {
  if (!diagnostics) return;
  const safePhase = sanitizeDiagnosticText(phase || 'unknown', 160);
  diagnostics.phase = safePhase;
  diagnostics.timeline.push({ at: new Date().toISOString(), phase: safePhase });
}

function recordRunDiagnosticFailure(diagnostics, error, phase = diagnostics?.phase || 'unknown') {
  const failure = createStructuredFailure(error, phase);
  if (diagnostics && !diagnostics.failure) diagnostics.failure = failure;
  return failure;
}

function diagnosticFailurePhase(diagnostics) {
  const cleanupPhases = new Set(['electron-close', 'process-cleanup-attestation', 'completed', 'failed']);
  if (diagnostics?.phase && !cleanupPhases.has(diagnostics.phase)) return diagnostics.phase;
  const timeline = Array.isArray(diagnostics?.timeline) ? diagnostics.timeline : [];
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const phase = timeline[index]?.phase;
    if (phase && !cleanupPhases.has(phase)) return phase;
  }
  return 'unknown';
}

function completeRunDiagnostics(diagnostics, passed) {
  if (!diagnostics) return;
  diagnostics.phase = passed ? 'completed' : 'failed';
  diagnostics.completedAt = new Date().toISOString();
  diagnostics.timeline.push({ at: diagnostics.completedAt, phase: diagnostics.phase });
}

function validRunDiagnostics(diagnostics, run = {}) {
  const startedAt = Date.parse(diagnostics?.startedAt);
  const completedAt = Date.parse(diagnostics?.completedAt);
  const consoleErrors = diagnostics?.renderer?.consoleErrors;
  const pageErrors = diagnostics?.renderer?.pageErrors;
  const timeline = diagnostics?.timeline;
  const login = diagnostics?.login;
  const loginStartedAt = Date.parse(login?.startedAt);
  const loginCompletedAt = Date.parse(login?.completedAt);
  const renderer = diagnostics?.renderer;
  const session = run?.session;
  const expectedLoginOutcome = {
    'authenticated-during-credential-observation': 'authenticated-during-credential-observation',
    'existing-authenticated-session': 'existing-authenticated-session',
    'interactive-operator-login': 'interactive-operator-login',
    'saved-credentials-login': 'saved-credentials-login',
  }[session?.mode];
  const attempts = Array.isArray(login?.attempts) ? login.attempts : [];
  const loginAttemptsValid = (() => {
    if (session?.mode !== 'saved-credentials-login') return attempts.length === 0;
    if (attempts.length < 1) return false;
    let previousCompletedAt = loginStartedAt;
    return attempts.every((attempt, index) => {
      const attemptStartedAt = Date.parse(attempt?.startedAt);
      const attemptCompletedAt = Date.parse(attempt?.completedAt);
      const isFinal = index === attempts.length - 1;
      const retryableNavigation = attempt?.outcome === 'retryable-navigation';
      const successfulWorkspace = [
        'workspace-reached',
        'workspace-reached-after-navigation',
      ].includes(attempt?.outcome);
      const valid = attempt?.attempt === index + 1
        && Number.isFinite(attemptStartedAt)
        && Number.isFinite(attemptCompletedAt)
        && attemptStartedAt >= loginStartedAt
        && attemptStartedAt >= previousCompletedAt
        && attemptCompletedAt >= attemptStartedAt
        && attemptCompletedAt <= loginCompletedAt
        && (isFinal
          ? successfulWorkspace && attempt?.retryable === false
          : retryableNavigation && attempt?.retryable === true);
      previousCompletedAt = attemptCompletedAt;
      return valid;
    });
  })();
  const operatorHandoff = login?.operatorHandoff;
  const operatorHandoffStartedAt = Date.parse(operatorHandoff?.startedAt);
  const operatorHandoffCompletedAt = Date.parse(operatorHandoff?.completedAt);
  const operatorHandoffValid = session?.mode === 'interactive-operator-login'
    ? (
      operatorHandoff?.kind === 'visible-user-handoff'
      && operatorHandoff?.outcome === 'workspace-reached'
      && operatorHandoff?.automationReadSecrets === false
      && operatorHandoff?.automationTypedSecrets === false
      && Number.isFinite(operatorHandoffStartedAt)
      && Number.isFinite(operatorHandoffCompletedAt)
      && operatorHandoffStartedAt >= loginStartedAt
      && operatorHandoffCompletedAt >= operatorHandoffStartedAt
      && operatorHandoffCompletedAt <= loginCompletedAt
      && canonicalJson(operatorHandoff) === canonicalJson(session?.operatorHandoff)
    )
    : operatorHandoff == null && session?.operatorHandoff == null;
  const storeGate = diagnostics?.storeGate;
  const sessionStoreGate = session?.storeGate;
  const storeGateStartedAt = Date.parse(storeGate?.startedAt);
  const storeGateCompletedAt = Date.parse(storeGate?.completedAt);
  return diagnostics?.schemaVersion === 'package-ui-run-diagnostics/v1'
    && Number.isFinite(startedAt)
    && Number.isFinite(completedAt)
    && completedAt >= startedAt
    && diagnostics.phase === 'completed'
    && diagnostics.failure === null
    && Array.isArray(diagnostics.cleanupErrors)
    && diagnostics.cleanupErrors.length === 0
    && Array.isArray(timeline)
    && timeline.length > 0
    && timeline[timeline.length - 1]?.phase === 'completed'
    && renderer?.limits?.consoleErrors === DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && renderer?.limits?.pageErrors === DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && renderer?.droppedCount?.consoleErrors === 0
    && renderer?.droppedCount?.pageErrors === 0
    && Array.isArray(consoleErrors)
    && consoleErrors.length <= DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && consoleErrors.length === 0
    && Array.isArray(pageErrors)
    && pageErrors.length <= DIAGNOSTIC_RENDERER_ENTRY_LIMIT
    && pageErrors.length === 0
    && Array.isArray(run.consoleErrors)
    && run.consoleErrors.length === 0
    && Array.isArray(run.pageErrors)
    && run.pageErrors.length === 0
    && Array.isArray(login?.attempts)
    && Number.isFinite(loginStartedAt)
    && Number.isFinite(loginCompletedAt)
    && loginStartedAt >= startedAt
    && loginCompletedAt >= loginStartedAt
    && loginCompletedAt <= completedAt
    && typeof expectedLoginOutcome === 'string'
    && login.outcome === expectedLoginOutcome
    && loginAttemptsValid
    && operatorHandoffValid
    && Number.isFinite(storeGateStartedAt)
    && Number.isFinite(storeGateCompletedAt)
    && storeGateStartedAt >= startedAt
    && storeGateCompletedAt >= storeGateStartedAt
    && storeGateCompletedAt <= completedAt
    && ['created-and-selected-isolated-evidence-store', 'selected-existing-store']
      .includes(storeGate?.outcome)
    && storeGate.outcome === sessionStoreGate?.outcome
    && storeGate.createdEvidenceStore === sessionStoreGate?.createdEvidenceStore
    && storeGate.marketplace === 'US'
    && storeGate.currency === 'USD'
    && ['login', 'workspace'].includes(storeGate.resultingSurface)
    && storeGate.selectedStore?.idSha256 === sessionStoreGate?.selectedStore?.idSha256
    && canonicalJson(login.connectionBootstrap) === canonicalJson(session?.connectionBootstrap);
}

function extractProfileUserDataDirectories(commandLine) {
  const source = String(commandLine || '');
  const values = [];
  const patterns = [
    /"--user-data-dir=([^"]+)"/gi,
    /--user-data-dir\s*=\s*"([^"]+)"/gi,
    /--user-data-dir\s*=\s*'([^']+)'/gi,
    /--user-data-dir\s*=\s*([^\s"]+)/gi,
    /"--user-data-dir"\s+"([^"]+)"/gi,
    /--user-data-dir\s+"([^"]+)"/gi,
    /--user-data-dir\s+'([^']+)'/gi,
    /--user-data-dir\s+([^\s"]+)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) values.push(match[1]);
    }
  }
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nullableProcessId(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function parsePowerShellProcessRows(result, label) {
  if (result.status !== 0) {
    return {
      error: sanitizeDiagnosticText(result.stderr || result.error?.message || `PowerShell exited ${result.status}`),
      observed: null,
      passed: false,
    };
  }
  try {
    const parsed = JSON.parse(String(result.stdout || '').trim() || '[]');
    return {
      error: null,
      observed: Array.isArray(parsed) ? parsed : parsed ? [parsed] : [],
      passed: true,
    };
  } catch (error) {
    return {
      error: sanitizeDiagnosticText(`Could not parse ${label} process snapshot: ${error instanceof Error ? error.message : String(error)}`),
      observed: null,
      passed: false,
    };
  }
}

function browserProcessRecord(item, profileMatched) {
  return {
    executablePath: item.ExecutablePath || null,
    name: item.Name || null,
    parentProcessId: nullableProcessId(item.ParentProcessId),
    processId: Number(item.ProcessId),
    profileMatched: Boolean(profileMatched),
  };
}

function collectMatchingProfileBrowserProcesses(profilePath, run = spawnSync) {
  const expectedProfilePath = normalizedWindowsPath(profilePath);
  const expectedProfilePrefix = `${expectedProfilePath.replace(/\/+$/, '')}/`;
  const names = PROFILE_BROWSER_PROCESS_NAMES.map((name) => `'${name.replace(/'/g, "''")}'`).join(',');
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$names = @(${names})`,
    '$items = @(Get-CimInstance Win32_Process | Where-Object { $names -contains $_.Name } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)',
    'ConvertTo-Json -InputObject $items -Compress',
  ].join('; ');
  const result = run('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const primary = parsePowerShellProcessRows(result, 'profile browser');
  let collectionMethod = 'cim';
  let primaryError = null;
  let observed = primary.observed;
  if (!primary.passed) {
    primaryError = primary.error;
    const fallbackCommand = [
      "$ErrorActionPreference = 'Stop'",
      `$names = @(${names})`,
      '$processes = @(Get-Process -ErrorAction Stop | Where-Object { $names -contains "$($_.ProcessName).exe" })',
      '$items = @($processes | ForEach-Object {',
      '  $process = $_',
      '  $cim = $null',
      '  try { $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction Stop } catch { $cim = $null }',
      '  $executablePath = $null',
      '  try { $executablePath = $process.Path } catch { $executablePath = $null }',
      '  [PSCustomObject]@{ ProcessId = $process.Id; ParentProcessId = if ($cim) { $cim.ParentProcessId } else { $null }; Name = "$($process.ProcessName).exe"; ExecutablePath = $executablePath; CommandLine = if ($cim) { $cim.CommandLine } else { $null } }',
      '})',
      'ConvertTo-Json -InputObject $items -Compress',
    ].join('; ');
    const fallbackResult = run('powershell.exe', ['-NoProfile', '-Command', fallbackCommand], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const fallback = parsePowerShellProcessRows(fallbackResult, 'profile browser Get-Process fallback');
    collectionMethod = 'get-process-targeted-cim-fallback';
    if (!fallback.passed) {
      return {
        collectionMethod,
        error: sanitizeDiagnosticText(`${primaryError}; fallback: ${fallback.error}`),
        matching: [],
        matchingCount: null,
        observedCount: null,
        passed: false,
        primaryError,
        profilePath: path.resolve(profilePath),
        unresolved: [],
        unresolvedCount: null,
      };
    }
    observed = fallback.observed;
  }
  if (!Array.isArray(observed)) {
    return {
      collectionMethod,
      error: sanitizeDiagnosticText(primaryError || 'Profile browser process collection returned no rows.'),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      primaryError,
      profilePath: path.resolve(profilePath),
      unresolved: [],
      unresolvedCount: null,
    };
  }
  const unresolvedItems = observed.filter((item) => !item.CommandLine || !item.ExecutablePath);
  const matchingItems = observed.filter((item) => (
    item.CommandLine
    && item.ExecutablePath
    && extractProfileUserDataDirectories(item.CommandLine)
      .some((candidate) => {
        const normalizedCandidate = normalizedWindowsPath(candidate);
        return normalizedCandidate === expectedProfilePath
          || normalizedCandidate.startsWith(expectedProfilePrefix);
      })
  ));
  return {
    collectionMethod,
    error: null,
    matching: matchingItems.map((item) => browserProcessRecord(item, true)),
    matchingCount: matchingItems.length,
    observedCount: observed.length,
    passed: unresolvedItems.length === 0,
    primaryError,
    profilePath: path.resolve(profilePath),
    unresolved: unresolvedItems.map((item) => browserProcessRecord(item, false)),
    unresolvedCount: unresolvedItems.length,
  };
}

async function waitForProfileBrowserProcessCleanup(profilePath, options = {}) {
  const collect = options.collect || collectMatchingProfileBrowserProcesses;
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 20;
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : 250;
  let snapshot = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    snapshot = collect(profilePath);
    if (snapshot.passed === true && snapshot.matchingCount === 0) {
      return { ...snapshot, attempts: attempt, passed: true };
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { ...snapshot, attempts, passed: false };
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
    && snapshot.observedCount >= snapshot.matchingCount + snapshot.unresolvedCount;
}

function buildProcessIsolationEvidence(before, after) {
  return {
    after,
    before,
    passed: processSnapshotEvidencePassed(before)
      && before?.matchingCount === 0
      && before?.unresolvedCount === 0
      && processSnapshotEvidencePassed(after)
      && after?.matchingCount === 0
      && after?.unresolvedCount === 0,
  };
}

function processIsolationEvidencePassed(evidence) {
  return evidence?.passed === true
    && processSnapshotEvidencePassed(evidence.before)
    && evidence.before?.matchingCount === 0
    && evidence.before?.unresolvedCount === 0
    && processSnapshotEvidencePassed(evidence.after)
    && evidence.after?.matchingCount === 0
    && evidence.after?.unresolvedCount === 0;
}

function collectMatchingPackageProcesses(executablePath, run = spawnSync) {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$items = @(Get-CimInstance Win32_Process -Filter "Name='${PACKAGE_PROCESS_NAME.replace(/'/g, "''")}'" | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath)`,
    'ConvertTo-Json -InputObject $items -Compress',
  ].join('; ');
  const result = run('powershell.exe', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const primary = parsePowerShellProcessRows(result, 'package');
  let collectionMethod = 'cim';
  let primaryError = null;
  let observed = primary.observed;
  if (!primary.passed) {
    primaryError = primary.error;
    const expectedName = PACKAGE_PROCESS_NAME.replace(/'/g, "''");
    const fallbackCommand = [
      "$ErrorActionPreference = 'Stop'",
      `$expectedName = '${expectedName}'`,
      '$items = @(Get-Process -ErrorAction Stop | Where-Object { "$($_.ProcessName).exe" -ieq $expectedName } | ForEach-Object {',
      '  $executablePath = $null',
      '  try { $executablePath = $_.Path } catch { $executablePath = $null }',
      '  [PSCustomObject]@{ ProcessId = $_.Id; ParentProcessId = $null; Name = "$($_.ProcessName).exe"; ExecutablePath = $executablePath }',
      '})',
      'ConvertTo-Json -InputObject $items -Compress',
    ].join('; ');
    const fallbackResult = run('powershell.exe', ['-NoProfile', '-Command', fallbackCommand], {
      encoding: 'utf8',
      windowsHide: true,
    });
    const fallback = parsePowerShellProcessRows(fallbackResult, 'package Get-Process fallback');
    collectionMethod = 'get-process-fallback';
    if (!fallback.passed) {
      return {
        collectionMethod,
        error: sanitizeDiagnosticText(`${primaryError}; fallback: ${fallback.error}`),
        matching: [],
        matchingCount: null,
        observedCount: null,
        passed: false,
        primaryError,
        unresolved: [],
        unresolvedCount: null,
      };
    }
    observed = fallback.observed;
  }
  if (!Array.isArray(observed)) {
    return {
      collectionMethod,
      error: sanitizeDiagnosticText(primaryError || 'Package process collection returned no rows.'),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      primaryError,
      unresolved: [],
      unresolvedCount: null,
    };
  }
  const expectedPath = normalizedWindowsPath(executablePath);
  const unresolved = observed.filter((item) => !item.ExecutablePath);
  const matching = observed
    .filter((item) => item.ExecutablePath && normalizedWindowsPath(item.ExecutablePath) === expectedPath)
    .map((item) => ({
      executablePath: item.ExecutablePath,
      name: item.Name,
      parentProcessId: nullableProcessId(item.ParentProcessId),
      processId: Number(item.ProcessId),
    }));
  return {
    collectionMethod,
    error: null,
    matching,
    matchingCount: matching.length,
    observedCount: observed.length,
    passed: unresolved.length === 0,
    primaryError,
    unresolved: unresolved.map((item) => ({
      executablePath: null,
      name: item.Name || null,
      parentProcessId: nullableProcessId(item.ParentProcessId),
      processId: Number(item.ProcessId),
    })),
    unresolvedCount: unresolved.length,
  };
}

async function waitForPackageProcessCleanup(executablePath, options = {}) {
  const collect = options.collect || collectMatchingPackageProcesses;
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 20;
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : 250;
  let snapshot = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    snapshot = collect(executablePath);
    if (snapshot.passed === true && snapshot.matchingCount === 0) {
      return { ...snapshot, attempts: attempt, passed: true };
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return { ...snapshot, attempts, passed: false };
}

function safeRealPath(filePath) {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function normalizedWindowsPath(filePath) {
  return safeRealPath(filePath).replace(/\\/g, '/').toLowerCase();
}

function violation(code, message, details) {
  return { code, message, ...(details === undefined ? {} : { details }) };
}

function validatePackageIdentity(input) {
  const violations = [];
  if (normalizeSha256(input.actualExeSha256, 'actualExeSha256') !== normalizeSha256(input.expectedExeSha256, 'expectedExeSha256')) {
    violations.push(violation('EXE_HASH_MISMATCH', 'The launched EXE hash does not match the explicitly approved hash.'));
  }
  if (normalizeSha256(input.actualAppContentSha256, 'actualAppContentSha256') !== normalizeSha256(input.expectedAppContentSha256, 'expectedAppContentSha256')) {
    violations.push(violation('APP_CONTENT_HASH_MISMATCH', 'The launched unpacked app-content manifest hash does not match the explicitly approved hash.'));
  }
  if (normalizedWindowsPath(input.actualExecutablePath) !== normalizedWindowsPath(input.expectedExecutablePath)) {
    violations.push(violation('EXECUTABLE_PATH_MISMATCH', 'Playwright attached to a different executable.', {
      actual: input.actualExecutablePath,
      expected: input.expectedExecutablePath,
    }));
  }
  if (normalizedWindowsPath(input.appPath) !== normalizedWindowsPath(DEFAULT_APP_CONTENT_PATH)) {
    violations.push(violation('APP_CONTENT_PATH_MISMATCH', 'Electron app.getAppPath() is not the fixed win-unpacked resources/app directory.', {
      actual: input.appPath,
      expected: DEFAULT_APP_CONTENT_PATH,
    }));
  }
  if (input.isPackaged !== true) {
    violations.push(violation('RUNTIME_NOT_PACKAGED', 'Electron runtime does not report app.isPackaged=true.'));
  }
  if (String(input.appVersion || '') !== String(input.expectedVersion || '')) {
    violations.push(violation('APP_VERSION_MISMATCH', 'Electron runtime version does not match the desktop package.', {
      actual: input.appVersion,
      expected: input.expectedVersion,
    }));
  }
  const userDataIdentity = validateEvidenceUserDataIdentity({
    actualUserDataDir: input.actualUserDataDir,
    evidenceMode: input.evidenceMode,
    expectedMode: input.expectedEvidenceMode,
    expectedUserDataDir: input.expectedUserDataDir,
  });
  violations.push(...userDataIdentity.violations.map((item) => violation(item.code, item.message, {
    actual: item.actual,
    expected: item.expected,
  })));
  let rendererUrl;
  try {
    rendererUrl = new URL(input.rendererUrl);
  } catch {
    rendererUrl = null;
  }
  if (!rendererUrl || rendererUrl.protocol !== 'file:') {
    violations.push(violation('RENDERER_NOT_FILE_URL', 'Packaged evidence must render from a file URL inside the unpacked resources/app directory.', {
      actual: input.rendererUrl,
    }));
  }
  if (rendererUrl?.protocol === 'file:') {
    let rendererPath;
    try {
      rendererPath = normalizedWindowsPath(fileURLToPath(rendererUrl));
    } catch {
      rendererPath = null;
    }
    const appContentPath = normalizedWindowsPath(DEFAULT_APP_CONTENT_PATH);
    const rendererInsideAppContent = Boolean(
      rendererPath
      && (rendererPath === appContentPath || rendererPath.startsWith(`${appContentPath}/`)),
    );
    if (!rendererInsideAppContent) {
      violations.push(violation('RENDERER_OUTSIDE_APP_CONTENT', 'Packaged file renderer must resolve inside the fixed resources/app directory.', {
        actual: input.rendererUrl,
        expectedRoot: DEFAULT_APP_CONTENT_PATH,
      }));
    } else if (rendererPath !== normalizedWindowsPath(EXPECTED_RENDERER_ENTRY_PATH)) {
      violations.push(violation('RENDERER_ENTRY_MISMATCH', 'Packaged evidence must render the fixed dist/renderer/index.html entry.', {
        actual: input.rendererUrl,
        expected: EXPECTED_RENDERER_ENTRY_PATH,
      }));
    }
  }
  if (rendererUrl && (
    rendererUrl.searchParams.get('preview') === '1'
    || rendererUrl.searchParams.has('scenario')
    || /(?:localhost|127\.0\.0\.1)/i.test(rendererUrl.hostname)
  )) {
    violations.push(violation('PREVIEW_RENDERER_FORBIDDEN', 'Preview or localhost renderer identity is forbidden for packaged evidence.', {
      actual: input.rendererUrl,
    }));
  }
  return { passed: violations.length === 0, violations };
}

function evaluatePackageViewportContract({
  actual,
  actualDeviceScaleFactor,
  expectedDeviceScaleFactor,
  requested = PACKAGE_UI_VIEWPORT,
}) {
  const finiteNumberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const normalizedActual = {
    width: finiteNumberOrNull(actual?.width),
    height: finiteNumberOrNull(actual?.height),
    deviceScaleFactor: finiteNumberOrNull(actualDeviceScaleFactor),
  };
  const normalizedRequested = {
    width: finiteNumberOrNull(requested?.width),
    height: finiteNumberOrNull(requested?.height),
    deviceScaleFactor: finiteNumberOrNull(expectedDeviceScaleFactor),
  };
  const delta = {
    width: Number.isFinite(normalizedActual.width) && Number.isFinite(normalizedRequested.width)
      ? normalizedActual.width - normalizedRequested.width
      : null,
    height: Number.isFinite(normalizedActual.height) && Number.isFinite(normalizedRequested.height)
      ? normalizedActual.height - normalizedRequested.height
      : null,
    deviceScaleFactor: Number.isFinite(normalizedActual.deviceScaleFactor) && Number.isFinite(normalizedRequested.deviceScaleFactor)
      ? normalizedActual.deviceScaleFactor - normalizedRequested.deviceScaleFactor
      : null,
  };
  const violations = [];
  if (
    !Number.isFinite(delta.width)
    || !Number.isFinite(delta.height)
    || Math.abs(delta.width) > PACKAGE_UI_VIEWPORT_TOLERANCE.width
    || Math.abs(delta.height) > PACKAGE_UI_VIEWPORT_TOLERANCE.height
  ) {
    violations.push(violation('VIEWPORT_DIMENSION_DELTA', 'Actual CSS viewport exceeds the strict Windows DPI rounding tolerance.', {
      actual: normalizedActual,
      delta,
      requested: normalizedRequested,
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    }));
  }
  if (
    !Number.isFinite(delta.deviceScaleFactor)
    || Math.abs(delta.deviceScaleFactor) > PACKAGE_UI_VIEWPORT_TOLERANCE.deviceScaleFactor
  ) {
    violations.push(violation('DEVICE_SCALE_FACTOR_DELTA', 'Actual device scale factor exceeds the strict tolerance.', {
      actual: normalizedActual,
      delta,
      requested: normalizedRequested,
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    }));
  }
  return {
    actual: normalizedActual,
    delta,
    passed: violations.length === 0,
    requested: normalizedRequested,
    tolerance: { ...PACKAGE_UI_VIEWPORT_TOLERANCE },
    violations,
  };
}

function validateWorkspaceRuntimeMetrics(metrics, expected, requestedViewport = PACKAGE_UI_VIEWPORT) {
  const violations = [];
  if (
    metrics.root?.count !== 1
    || metrics.root?.workspace !== expected.workspace
    || metrics.root?.subview !== expected.subview
  ) {
    violations.push(violation('WORKSPACE_IDENTITY_MISMATCH', 'The visible workspace/subview identity does not match the clicked sidebar target.', {
      actual: metrics.root,
      expected: { workspace: expected.workspace, subview: expected.subview },
    }));
  }
  if (metrics.h1?.count !== 1 || metrics.h1?.labels?.[0] !== expected.heading) {
    violations.push(violation('H1_CONTRACT', 'The workspace must expose exactly one expected visible h1.', {
      actual: metrics.h1,
      expected: expected.heading,
    }));
  }
  if (metrics.primaryAction?.count !== 1) {
    violations.push(violation('PRIMARY_ACTION_CONTRACT', 'The first viewport must expose exactly one visible primary action.', metrics.primaryAction));
  }
  if (metrics.activeNavigation?.count !== 1 || !String(metrics.activeNavigation?.label || '').includes(expected.label)) {
    violations.push(violation('ACTIVE_NAVIGATION_CONTRACT', 'Exactly one sidebar item must be active and match the clicked workspace.', {
      actual: metrics.activeNavigation,
      expected: expected.label,
    }));
  }
  if ((metrics.horizontalOverflow?.violations || []).length > 0) {
    violations.push(violation('PAGE_HORIZONTAL_OVERFLOW', 'Page-level containers must not overflow horizontally.', metrics.horizontalOverflow.violations));
  }
  if (
    metrics.scrollOwnership?.defaultOwner?.matchCount !== 1
    || metrics.scrollOwnership?.defaultOwner?.declared !== true
  ) {
    violations.push(violation('DEFAULT_SCROLL_OWNER', '.app-content must remain the single declared workspace scroll owner.', metrics.scrollOwnership?.defaultOwner));
  }
  const workspaceScrollTop = Number(metrics.scrollOwnership?.defaultOwner?.scrollTop);
  if (!Number.isFinite(workspaceScrollTop) || Math.abs(workspaceScrollTop) > 1) {
    violations.push(violation('WORKSPACE_NOT_AT_TOP', 'Every workspace capture must start at the top of the shared .app-content scroll owner.', {
      scrollTop: metrics.scrollOwnership?.defaultOwner?.scrollTop ?? null,
    }));
  }
  if ((metrics.scrollOwnership?.unlabelledActiveOwners || []).length > 0) {
    violations.push(violation('UNLABELLED_SCROLL_OWNER', 'Active nested vertical scroll owners must be explicitly labelled exceptions.', metrics.scrollOwnership.unlabelledActiveOwners));
  }
  if ((metrics.aria?.duplicateIds || []).length > 0) {
    violations.push(violation('DUPLICATE_DOM_ID', 'DOM ids referenced by accessibility relationships must be unique.', metrics.aria.duplicateIds));
  }
  if ((metrics.aria?.brokenReferences || []).length > 0) {
    violations.push(violation('BROKEN_ARIA_REFERENCE', 'ARIA id references must resolve to an existing unique element.', metrics.aria.brokenReferences));
  }
  if ((metrics.previewMarkers || []).length > 0) {
    violations.push(violation('PREVIEW_MARKER_PRESENT', 'A packaged production renderer must not expose preview identity markers.', metrics.previewMarkers));
  }
  const workspaceDeviceScaleFactor = Number.isFinite(Number(metrics.deviceScaleFactor))
    ? Number(metrics.deviceScaleFactor)
    : 1;
  const viewportContract = evaluatePackageViewportContract({
    actual: metrics.viewport,
    actualDeviceScaleFactor: workspaceDeviceScaleFactor,
    expectedDeviceScaleFactor: workspaceDeviceScaleFactor,
    requested: requestedViewport,
  });
  if (viewportContract.violations.some((item) => item.code === 'VIEWPORT_DIMENSION_DELTA')) {
    violations.push(violation('VIEWPORT_MISMATCH', 'The packaged UI viewport exceeds the strict 1200x700 Windows DPI rounding tolerance.', viewportContract));
  }
  let rendererUrl;
  try {
    rendererUrl = new URL(metrics.rendererUrl);
  } catch {
    rendererUrl = null;
  }
  if (!rendererUrl || rendererUrl.protocol !== 'file:' || rendererUrl.searchParams.get('preview') === '1') {
    violations.push(violation('WORKSPACE_RENDERER_IDENTITY', 'Workspace metrics did not come from the packaged file renderer.', metrics.rendererUrl));
  }
  return { passed: violations.length === 0, violations };
}

function validateObjectWorkspaceExperienceEvidence({
  aiRunState,
  capacity,
  metrics,
  requiredVisibleCapacity,
  workspace,
}) {
  const violations = [];
  const numericRequiredCapacity = Number(requiredVisibleCapacity);
  const visibleRowCapacity = Number(capacity?.visibleRowCapacity);
  if (!Number.isFinite(numericRequiredCapacity)
    || !Number.isFinite(visibleRowCapacity)
    || visibleRowCapacity < numericRequiredCapacity) {
    violations.push(violation(
      'QUEUE_CAPACITY_INSUFFICIENT',
      'The fixed object queue viewport must have measured row capacity for the profile target.',
      { actual: capacity, requiredVisibleCapacity },
    ));
  }
  const ariaRowCount = Number(capacity?.ariaRowCount);
  const initial = metrics?.experience?.initial;
  const probe = metrics?.experience?.probe;
  const maxRenderedRows = Number(metrics?.experience?.contract?.maxRenderedRows || 30);
  const indexes = Array.isArray(initial?.rowIndexes) ? initial.rowIndexes : [];
  const rowCountCredible = Number.isInteger(ariaRowCount)
    && ariaRowCount >= 1
    && ariaRowCount === Number(initial?.ariaRowCount)
    && Number(initial?.renderedRowCount) >= 1
    && Number(initial?.renderedRowCount) <= maxRenderedRows
    && indexes.length > 0
    && indexes.every((index) => Number.isInteger(index) && index >= 0 && index < ariaRowCount)
    && initial?.rowKeysUnique === true;
  if (!rowCountCredible) {
    violations.push(violation(
      'QUEUE_ROWCOUNT_NOT_CREDIBLE',
      'The package queue must expose a positive authoritative row count consistent with bounded keyed DOM rows.',
      { capacity, initial, maxRenderedRows },
    ));
  }
  const shortDataset = capacity?.scrollable === false
    && capacity?.allRowsFit === true
    && Number.isFinite(ariaRowCount)
    && Number.isFinite(visibleRowCapacity)
    && ariaRowCount <= visibleRowCapacity;
  const shortDatasetNotApplicableCodes = new Set([
    'QUEUE_VIRTUAL_WINDOW_STALE',
    'QUEUE_SCROLL_OWNER',
    'QUEUE_STICKY_HEADER',
    'QUEUE_SCROLL_LEAK',
  ]);
  const collectorViolations = Array.isArray(metrics?.contract?.violations) ? metrics.contract.violations : [];
  const applicableCollectorViolations = shortDataset
    ? collectorViolations.filter((item) => !shortDatasetNotApplicableCodes.has(item?.code))
    : collectorViolations;
  if (metrics?.experience?.enabled !== true || applicableCollectorViolations.length > 0) {
    violations.push(violation(
      'OBJECT_WORKSPACE_EXPERIENCE_CONTRACT',
      'The shared workspace DOM/experience contract must pass for the packaged object queue.',
      applicableCollectorViolations.length > 0 ? applicableCollectorViolations : metrics?.contract || null,
    ));
  }
  if (shortDataset && Number(initial?.fullyVisibleRowCount) < ariaRowCount) {
    violations.push(violation(
      'SHORT_DATASET_NOT_FULLY_VISIBLE',
      'A non-scrollable short object dataset must render every authoritative row fully in the queue viewport.',
      { ariaRowCount, fullyVisibleRowCount: initial?.fullyVisibleRowCount ?? null },
    ));
  }
  const restoredScrollTop = Number(probe?.restoredScrollTop);
  const restored = shortDataset ? null : Number.isFinite(restoredScrollTop) && Math.abs(restoredScrollTop) <= 1;
  if (!shortDataset && !restored) {
    violations.push(violation(
      'OBJECT_WORKSPACE_SCROLL_NOT_RESTORED',
      'The virtual queue probe must restore its original top window before row selection evidence.',
      { restoredScrollTop: metrics?.experience?.probe?.restoredScrollTop ?? null },
    ));
  }
  const probeApplicability = shortDataset
    ? { applicable: false, passed: true, reason: 'short-dataset' }
    : {
        applicable: true,
        passed: metrics?.contract?.passed === true
          && probe?.virtualWindowAdvanced === true
          && restored === true,
        reason: 'scrollable-dataset',
      };
  if (workspace === 'diagnosis' && (
    aiRunState?.observed !== true
    || !String(aiRunState?.text || '').trim()
  )) {
    violations.push(violation(
      'DIAGNOSIS_AI_STATE_MISSING',
      'The packaged Diagnosis workspace must record its current visible real AI run state.',
      aiRunState || null,
    ));
  }
  return {
    aiRunState,
    capacity,
    contract: metrics?.experience?.contract || null,
    metrics,
    passed: violations.length === 0,
    probeApplicability,
    requiredVisibleCapacity,
    restored,
    rowCountCredible,
    violations,
    workspace,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function packageUiSchedulerAuditCounts(value) {
  return Object.fromEntries(PACKAGE_UI_SCHEDULER_COUNT_KEYS.map((key) => [
    key,
    Number.isInteger(value?.[key]) && value[key] >= 0 ? value[key] : null,
  ]));
}

function derivePackageUiSchedulerGuards(counts, suppressed) {
  return {
    localSchedulerStarted: counts.localSchedulerStart > 0,
    storeCollectionSchedulerStarted: counts.storeSchedulerStart > 0,
    runNowIpcDisabled: counts.runNow === counts.runNowRejected,
    startupReconcileSuppressed:
      counts.storeSchedulerStart === 0
      && suppressed.startupReconcile > 0,
    automaticReconcileSuppressed: counts.reconcile === 0,
    readOnlyInvariantPassed:
      counts.localSchedulerStart === 0
      && counts.storeSchedulerStart === 0
      && counts.reconcile === 0
      && counts.execute === 0
      && counts.runNow === 0,
  };
}

function packageUiSchedulerAuditSnapshotViolations(snapshot, label) {
  const violations = [];
  if (
    snapshot?.kind !== 'package-ui-scheduler-audit'
    || snapshot?.schemaVersion !== 1
    || snapshot?.evidenceMode !== PACKAGE_UI_EVIDENCE_MODE
    || !Number.isInteger(snapshot?.pid)
    || snapshot.pid < 1
    || !String(snapshot?.userDataDir || '').trim()
    || !Number.isFinite(Date.parse(snapshot?.generatedAt || ''))
    || snapshot?.policies?.runNow !== 'reject'
  ) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_INVALID',
      `${label} is not a valid package UI scheduler audit snapshot.`,
      snapshot ?? null,
    ));
    return violations;
  }
  const counts = packageUiSchedulerAuditCounts(snapshot.counts);
  if (Object.values(counts).some((value) => value === null)) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_COUNTS_INVALID',
      `${label} must contain every non-negative scheduler audit counter.`,
      snapshot.counts ?? null,
    ));
  }
  const suppressed = snapshot.suppressed || {};
  if (
    !Number.isInteger(suppressed.localSchedulerStart)
    || suppressed.localSchedulerStart < 0
    || !Number.isInteger(suppressed.storeSchedulerStart)
    || suppressed.storeSchedulerStart < 0
    || !Number.isInteger(suppressed.startupReconcile)
    || suppressed.startupReconcile < 0
    || !Number.isInteger(suppressed.automaticReconcile)
    || suppressed.automaticReconcile < 0
  ) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_SUPPRESSED_COUNTS_INVALID',
      `${label} must contain every non-negative suppression counter.`,
      suppressed,
    ));
  }
  if (!Array.isArray(snapshot.events)) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_EVENTS_INVALID',
      `${label} must contain the bounded Main handler event ledger.`,
      snapshot.events ?? null,
    ));
  } else if (snapshot.events.some((event, index) => (
    event?.sequence !== index + 1
    || !Number.isFinite(Date.parse(event?.at || ''))
    || !['pending', 'succeeded', 'rejected', 'recorded'].includes(event?.outcome)
  ))) {
    violations.push(violation(
      'PACKAGE_UI_SCHEDULER_AUDIT_EVENT_INVALID',
      `${label} contains an invalid Main handler event.`,
      snapshot.events,
    ));
  }
  if (Array.isArray(snapshot.events)) {
    const eventCounts = { ...Object.fromEntries(PACKAGE_UI_SCHEDULER_COUNT_KEYS.map((key) => [key, 0])) };
    const sourceCounts = {
      'mission-control:query': 'workspaceQuery',
      'store-collection-scheduler:get': 'schedulerGet',
      'store-evidence-retention:preview': 'retentionPreview',
      'store-collection-scheduler:run-now': 'runNow',
      localSchedulerStart: 'localSchedulerStart',
      storeSchedulerStart: 'storeSchedulerStart',
      reconcile: 'reconcile',
      execute: 'execute',
    };
    for (const event of snapshot.events) {
      const countKey = sourceCounts[event?.source];
      if (countKey) eventCounts[countKey] += 1;
      if (
        event?.source === 'store-collection-scheduler:run-now'
        && event?.outcome === 'rejected'
      ) eventCounts.runNowRejected += 1;
    }
    if (canonicalJson(eventCounts) !== canonicalJson(counts)) {
      violations.push(violation(
        'PACKAGE_UI_SCHEDULER_AUDIT_EVENT_COUNT_MISMATCH',
        `${label} counters must be derived exactly from its handler/control event ledger.`,
        { actual: counts, expected: eventCounts },
      ));
    }
  }
  return violations;
}

function packageUiSchedulerAuditDelta(before, after) {
  const beforeCounts = packageUiSchedulerAuditCounts(before?.counts);
  const afterCounts = packageUiSchedulerAuditCounts(after?.counts);
  const counts = Object.fromEntries(PACKAGE_UI_SCHEDULER_COUNT_KEYS.map((key) => [
    key,
    beforeCounts[key] === null || afterCounts[key] === null
      ? null
      : afterCounts[key] - beforeCounts[key],
  ]));
  const beforeEvents = Array.isArray(before?.events) ? before.events : [];
  const afterEvents = Array.isArray(after?.events) ? after.events : [];
  const prefixMatched = canonicalJson(beforeEvents) === canonicalJson(
    afterEvents.slice(0, beforeEvents.length),
  );
  return {
    counts,
    events: prefixMatched ? afterEvents.slice(beforeEvents.length) : [],
    prefixMatched,
  };
}

function validateSchedulerSubviewRuntimeBinding(subviewEvidence, runtimeEvidence) {
  const violations = [];
  const ledgerAfter = subviewEvidence?.ledgerAfter;
  const runtimeMarker = runtimeEvidence?.marker;
  const runtimeDelta = packageUiSchedulerAuditDelta(ledgerAfter, runtimeMarker);
  const identityMatched = ledgerAfter?.pid === runtimeMarker?.pid
    && normalizedWindowsPath(ledgerAfter?.userDataDir || '')
      === normalizedWindowsPath(runtimeMarker?.userDataDir || '')
    && ledgerAfter?.evidenceMode === runtimeMarker?.evidenceMode
    && canonicalJson(ledgerAfter?.policies) === canonicalJson(runtimeMarker?.policies);
  const suppressionMatched = canonicalJson(ledgerAfter?.suppressed)
    === canonicalJson(runtimeMarker?.suppressed);
  const generatedAt = Date.parse(ledgerAfter?.generatedAt || '');
  const runtimeGeneratedAt = Date.parse(runtimeMarker?.generatedAt || '');
  const generatedAtMonotonic = Number.isFinite(generatedAt)
    && Number.isFinite(runtimeGeneratedAt)
    && runtimeGeneratedAt >= generatedAt;
  const countsMonotonic = Object.values(runtimeDelta.counts).every(
    (value) => value !== null && value >= 0,
  );

  if (
    !identityMatched
    || !suppressionMatched
    || !generatedAtMonotonic
    || !runtimeDelta.prefixMatched
    || !countsMonotonic
  ) {
    violations.push(violation(
      'SCHEDULER_SUBVIEW_RUNTIME_LEDGER_NOT_BOUND',
      'The scheduler subview ledger must be an exact event prefix of the hash-bound Main runtime attestation with one identity and monotonic counters.',
      {
        counts: runtimeDelta.counts,
        generatedAtMonotonic,
        identityMatched,
        prefixMatched: runtimeDelta.prefixMatched,
        suppressionMatched,
      },
    ));
  }

  return {
    counts: runtimeDelta.counts,
    generatedAtMonotonic,
    identityMatched,
    passed: violations.length === 0,
    prefixMatched: runtimeDelta.prefixMatched,
    suppressionMatched,
    violations,
  };
}

function latestSucceededSchedulerAuditEvent(events, source) {
  return [...(Array.isArray(events) ? events : [])]
    .reverse()
    .find((event) => event?.source === source && event?.outcome === 'succeeded') || null;
}

function validateSchedulerSubviewEvidence(input, expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0]) {
  const violations = [];
  const contextFields = [
    'storeId',
    'browserProfileId',
    'marketplace',
    'currency',
    'businessTimezone',
    'businessDate',
    'sessionGeneration',
  ];
  const contextIdentity = (value) => Object.fromEntries(
    contextFields.map((field) => [field, value?.[field] ?? null]),
  );
  const before = input?.ledgerBefore;
  const after = input?.ledgerAfter;
  violations.push(...packageUiSchedulerAuditSnapshotViolations(before, 'The pre-navigation scheduler ledger'));
  violations.push(...packageUiSchedulerAuditSnapshotViolations(after, 'The post-navigation scheduler ledger'));
  if (
    before?.pid !== after?.pid
    || normalizedWindowsPath(before?.userDataDir || '') !== normalizedWindowsPath(after?.userDataDir || '')
  ) {
    violations.push(violation(
      'SCHEDULER_AUDIT_IDENTITY_CHANGED',
      'The scheduler ledger must retain one Main PID and isolated userData identity across navigation.',
      { before: before ? { pid: before.pid, userDataDir: before.userDataDir } : null, after: after ? { pid: after.pid, userDataDir: after.userDataDir } : null },
    ));
  }
  const ledgerDelta = packageUiSchedulerAuditDelta(before, after);
  if (!ledgerDelta.prefixMatched || Object.values(ledgerDelta.counts).some((value) => value === null || value < 0)) {
    violations.push(violation(
      'SCHEDULER_AUDIT_LEDGER_NOT_APPEND_ONLY',
      'The Main scheduler audit must be append-only with monotonic counters across page navigation.',
      ledgerDelta,
    ));
  }
  if (
    ledgerDelta.counts.workspaceQuery < 1
    || ledgerDelta.counts.schedulerGet < 1
    || ledgerDelta.counts.retentionPreview < 1
    || ledgerDelta.counts.runNow !== 0
    || ledgerDelta.counts.runNowRejected !== 0
    || ledgerDelta.counts.localSchedulerStart !== 0
    || ledgerDelta.counts.storeSchedulerStart !== 0
    || ledgerDelta.counts.reconcile !== 0
    || ledgerDelta.counts.execute !== 0
  ) {
    violations.push(violation(
      'SCHEDULER_HANDLER_LEDGER_CONTRACT_FAILED',
      'Scheduler navigation must cause real page schedule/retention reads and zero run-now/start/reconcile/execute calls.',
      ledgerDelta.counts,
    ));
  }
  const afterCounts = packageUiSchedulerAuditCounts(after?.counts);
  if (
    afterCounts.workspaceQuery < 1
    || afterCounts.runNow !== 0
    || afterCounts.runNowRejected !== 0
    || afterCounts.localSchedulerStart !== 0
    || afterCounts.storeSchedulerStart !== 0
    || afterCounts.reconcile !== 0
    || afterCounts.execute !== 0
  ) {
    violations.push(violation(
      'SCHEDULER_MAIN_READ_ONLY_TOTALS_FAILED',
      'The live Main ledger must include a real workspace query and no scheduler mutation attempts.',
      afterCounts,
    ));
  }
  if (ledgerDelta.events.some((event) => event?.outcome !== 'succeeded')) {
    violations.push(violation(
      'SCHEDULER_HANDLER_EVENT_FAILED',
      'Every handler event caused by scheduler navigation must complete successfully.',
      ledgerDelta.events,
    ));
  }
  const missionEvent = latestSucceededSchedulerAuditEvent(
    ledgerDelta.events,
    'mission-control:query',
  );
  const scheduleEvent = latestSucceededSchedulerAuditEvent(
    ledgerDelta.events,
    'store-collection-scheduler:get',
  );
  const retentionEvent = latestSucceededSchedulerAuditEvent(
    ledgerDelta.events,
    'store-evidence-retention:preview',
  );
  const requestedContext = contextIdentity(missionEvent?.request?.context ?? missionEvent?.context);
  const authoritativeContext = contextIdentity(missionEvent?.response?.authoritativeContext);
  if (canonicalJson(requestedContext) !== canonicalJson(authoritativeContext)) {
    violations.push(violation(
      'SCHEDULER_AUTHORITY_CONTEXT_MISMATCH',
      'The read-only scheduler bootstrap response must retain the exact active StoreContext identity.',
      { authoritativeContext, requestedContext },
    ));
  }
  if (authoritativeContext.marketplace !== 'US' || authoritativeContext.currency !== 'USD') {
    violations.push(violation(
      'SCHEDULER_USD_IDENTITY_MISMATCH',
      'The packaged scheduler evidence is restricted to the US marketplace and USD currency.',
      authoritativeContext,
    ));
  }
  if (
    missionEvent?.request?.query !== 'workspace-bootstrap'
    || !String(missionEvent?.request?.requestId || '').startsWith('renderer-bootstrap-')
    || missionEvent?.response?.requestId !== missionEvent?.request?.requestId
    || !Number.isInteger(missionEvent?.request?.contextEpoch)
    || missionEvent?.response?.contextEpoch !== missionEvent?.request?.contextEpoch
    || missionEvent?.response?.query !== 'workspace-bootstrap'
  ) {
    violations.push(violation(
      'SCHEDULER_BOOTSTRAP_RESPONSE_MISMATCH',
      'The scheduler capability assertion must come from the matching read-only workspace bootstrap response.',
      {
        request: missionEvent?.request ?? null,
        response: missionEvent?.response ?? null,
      },
    ));
  }
  const expectedCapabilities = expected.capabilities.map((capability) => ({
    action: capability.action,
    capabilityId: capability.capabilityId,
    legacyRoute: capability.legacyRoute,
    state: capability.state,
    view: `${expected.workspace}/${expected.subview}`,
    workspace: expected.workspace,
  })).sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const actualCapabilities = (
    Array.isArray(missionEvent?.response?.capabilities)
      ? missionEvent.response.capabilities
      : []
  ).map((capability) => ({
    action: capability?.action ?? null,
    capabilityId: capability?.capabilityId ?? null,
    legacyRoute: capability?.legacyRoute ?? null,
    state: capability?.state ?? null,
    view: capability?.view ?? null,
    workspace: capability?.workspace ?? null,
  })).sort((left, right) => String(left.capabilityId).localeCompare(String(right.capabilityId)));
  if (canonicalJson(actualCapabilities) !== canonicalJson(expectedCapabilities)) {
    violations.push(violation(
      'SCHEDULER_CAPABILITY_PROJECTION_MISMATCH',
      'The scheduler subview must expose the exact view, run-now, and read-only retention capability projection.',
      { actual: actualCapabilities, expected: expectedCapabilities },
    ));
  }
  const schedule = scheduleEvent?.response || {};
  if (
    String(schedule.storeId ?? '') !== String(authoritativeContext.storeId ?? '')
    || String(schedule.businessDate ?? '') !== String(authoritativeContext.businessDate ?? '')
    || !['not_configured', 'archived', 'waiting', 'due', 'claimed', 'succeeded', 'failed'].includes(schedule.state)
    || typeof schedule.enabled !== 'boolean'
    || !String(schedule.detail || '').trim()
  ) {
    violations.push(violation(
      'SCHEDULER_SCHEDULE_API_RESPONSE_INVALID',
      'The packaged page schedule API must succeed with a current-store projection.',
      schedule,
    ));
  }
  const retention = retentionEvent?.response || {};
  if (
    retention.schemaVersion !== 1
    || retention.mode !== 'dry-run'
    || retention.deletionSupported !== false
    || retention.applyable !== false
    || String(retention.storeId ?? '') !== String(authoritativeContext.storeId ?? '')
    || String(retention.profileId ?? '') !== String(authoritativeContext.browserProfileId ?? '')
    || retention.marketplace !== 'US'
    || retention.currency !== 'USD'
    || !Number.isInteger(retention.candidateCount)
    || retention.candidateCount < 0
    || !Number.isInteger(retention.blockerCount)
    || retention.blockerCount < 0
  ) {
    violations.push(violation(
      'SCHEDULER_RETENTION_API_RESPONSE_INVALID',
      'The packaged page retention API must succeed with a current-store, path-free dry-run summary.',
      retention,
    ));
  }

  const dom = input?.dom || {};
  if (
    dom.rootCount !== 1
    || dom.workspace !== expected.workspace
    || dom.subview !== expected.subview
    || dom.pageCount !== 1
    || dom.headingCount !== 1
    || dom.heading !== expected.heading
  ) {
    violations.push(violation(
      'SCHEDULER_DOM_IDENTITY_MISMATCH',
      'The visible packaged scheduler page must retain one exact settings/scheduler root and heading.',
      dom,
    ));
  }
  if (
    dom.selectedTabCount !== 1
    || dom.selectedTabId !== expected.tabId
    || dom.selectedTabCapabilityState !== 'LEGACY_ADAPTER'
  ) {
    violations.push(violation(
      'SCHEDULER_TAB_CAPABILITY_MISMATCH',
      'The selected scheduler tab must expose its exact LEGACY_ADAPTER view state.',
      dom,
    ));
  }
  if (
    dom.legacyBoundaryCount !== 1
    || dom.legacyRoute !== 'scheduler'
    || dom.legacyCapabilityState !== 'LEGACY_ADAPTER'
  ) {
    violations.push(violation(
      'SCHEDULER_LEGACY_BOUNDARY_MISMATCH',
      'The production scheduler must remain inside the exact authorized legacy adapter boundary.',
      dom,
    ));
  }
  const expectedStoreId = String(authoritativeContext.storeId ?? '');
  if (
    !expectedStoreId
    || String(dom.shellStoreId ?? '') !== expectedStoreId
    || String(dom.selectedStoreId ?? '') !== expectedStoreId
    || String(dom.legacyStoreId ?? '') !== expectedStoreId
  ) {
    violations.push(violation(
      'SCHEDULER_STORE_IDENTITY_MISMATCH',
      'The shell, selected store, legacy boundary, and Main authority must name the same store.',
      { authoritativeStoreId: expectedStoreId || null, dom },
    ));
  }
  const fixedScopeText = String(dom.fixedScopeText || '').replace(/\s+/g, ' ').trim();
  const fixedScopeTokens = fixedScopeText.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const fixedScopeIdentityTokens = fixedScopeTokens.filter((token) => /^[A-Z]{2,4}$/.test(token));
  if (canonicalJson(fixedScopeIdentityTokens) !== canonicalJson(['US', 'USD'])) {
    violations.push(violation(
      'SCHEDULER_FIXED_SCOPE_MISSING',
      'The packaged scheduler must visibly retain exactly the US marketplace and USD currency without another uppercase marketplace/currency token.',
      { fixedScopeIdentityTokens, fixedScopeText },
    ));
  }
  if (
    String(dom.scheduleStoreId ?? '') !== String(schedule.storeId ?? '')
    || String(dom.scheduleBusinessDate ?? '') !== String(schedule.businessDate ?? '')
    || String(dom.scheduleState ?? '') !== String(schedule.state ?? '')
    || String(dom.scheduleEnabled ?? '') !== String(schedule.enabled)
    || dom.scheduleMarketplace !== 'US'
    || dom.scheduleCurrency !== 'USD'
    || String(dom.retentionStoreId ?? '') !== String(retention.storeId ?? '')
    || String(dom.retentionProfileId ?? '') !== String(retention.profileId ?? '')
    || Number(dom.retentionCandidateCount) !== retention.candidateCount
    || Number(dom.retentionBlockerCount) !== retention.blockerCount
    || dom.retentionMarketplace !== 'US'
    || dom.retentionCurrency !== 'USD'
  ) {
    violations.push(violation(
      'SCHEDULER_DOM_MAIN_RESPONSE_BINDING_MISMATCH',
      'Visible scheduler data attributes must bind field-by-field to the actual Main schedule and retention responses.',
      { dom, retention, schedule },
    ));
  }
  if (
    dom.retentionPreviewControlCount !== 1
    || dom.retentionPreviewCapabilityId !== 'settings.scheduler.retention-preview'
    || dom.retentionPreviewEnabledCount !== 1
  ) {
    violations.push(violation(
      'SCHEDULER_RETENTION_CAPABILITY_MISSING',
      'The scheduler must expose exactly one capability-bound read-only retention preview control.',
      dom,
    ));
  }
  if (
    dom.scheduleProjectionCount !== 1
    || dom.retentionSummaryCount !== 1
    || dom.schedulerErrorCount !== 0
    || dom.loadingStateCount !== 0
    || dom.busyControlCount !== 0
    || dom.scheduleRefreshEnabledCount < 1
  ) {
    violations.push(violation(
      'SCHEDULER_PAGE_RUNTIME_STATE_INVALID',
      'The packaged scheduler page must finish both read APIs without an error/loading state and retain enabled read controls.',
      dom,
    ));
  }
  if (
    dom.previewMarkerCount !== 0
    || dom.alertDialogCount !== 0
    || dom.confirmRunDialogCount !== 0
  ) {
    violations.push(violation(
      'SCHEDULER_UNSAFE_CAPTURE_STATE',
      'The scheduler screenshot must not contain preview identity or an opened run-now confirmation.',
      dom,
    ));
  }
  return {
    ...input,
    authoritativeContext,
    capabilities: actualCapabilities,
    expected: {
      capabilities: expectedCapabilities,
      heading: expected.heading,
      subview: expected.subview,
      workspace: expected.workspace,
    },
    ledgerDelta,
    passed: violations.length === 0,
    requestedContext,
    retentionApi: retention,
    scheduleApi: schedule,
    violations,
  };
}

function validateObjectInspectorEvidence(input) {
  const violations = [];
  const identityMatched = input.row?.selectedAfterClick === true
    && Boolean(input.row?.key)
    && input.row.key === input.escape?.focusedRowKey
    && Boolean(String(input.row?.title || '').trim())
    && String(input.row.title).trim() === String(input.inspector?.title || '').trim();
  if (!identityMatched) {
    violations.push(violation(
      'OBJECT_INSPECTOR_IDENTITY_MISMATCH',
      'The selected virtual row, visible inspector, and restored focus target must retain one stable object identity.',
      { escape: input.escape, inspector: input.inspector, row: input.row },
    ));
  }
  const modeMatched = input.expectedMode === 'drawer'
    ? input.inspector?.mode === 'drawer'
      && input.inspector?.role === 'dialog'
      && input.inspector?.ariaModal === 'true'
    : input.expectedMode === 'inline'
      && input.inspector?.mode === 'inline'
      && input.inspector?.role === 'complementary'
      && input.inspector?.ariaModal !== 'true';
  if (!modeMatched) {
    violations.push(violation(
      'OBJECT_INSPECTOR_MODALITY_MISMATCH',
      'Object details must use a modal drawer below 1400px and a non-modal inline inspector at 1400px and above.',
      { expectedMode: input.expectedMode, inspector: input.inspector },
    ));
  }
  if (input.escape?.closed !== true || input.escape?.focusRestored !== true) {
    violations.push(violation(
      'OBJECT_INSPECTOR_FOCUS_NOT_RESTORED',
      'Escape must close the object inspector and restore focus to the selected virtual row.',
      input.escape,
    ));
  }
  const operationScopeUnchanged = input.workspace !== 'product'
    || canonicalJson(input.operationScope?.before) === canonicalJson(input.operationScope?.after);
  if (!operationScopeUnchanged) {
    violations.push(violation(
      'PRODUCT_VIEW_MUTATED_OPERATION_SCOPE',
      'Selecting a product row for viewing must not change the operation scope or locked ASIN.',
      input.operationScope,
    ));
  }
  if (!/^[A-F0-9]{64}$/.test(String(input.screenshot?.sha256 || ''))) {
    violations.push(violation(
      'OBJECT_INSPECTOR_SCREENSHOT_MISSING_OR_UNHASHED',
      'The visible object inspector must have a hashed viewport screenshot.',
      input.screenshot,
    ));
  }
  return {
    ...input,
    identityMatched,
    modeMatched,
    operationScopeUnchanged,
    passed: violations.length === 0,
    violations,
  };
}

function validateReadOnlyInteractionPlan(plan = READ_ONLY_INTERACTION_PLAN) {
  const violations = [];
  const allowedKinds = new Set(['navigation', 'keyboard-navigation', 'subview', 'overlay']);
  const expectedIds = new Set([
    'workspace-navigation',
    'workspace-tab-keyboard-navigation',
    'report-subview-navigation',
    'scheduler-subview-readonly',
    ...EXPECTED_OVERLAY_CHECK_IDS,
  ]);
  const ids = new Set();
  for (const item of plan) {
    ids.add(item.id);
    if (!allowedKinds.has(item.kind)) {
      violations.push(violation('FORBIDDEN_INTERACTION_KIND', 'Package evidence may not execute a mutating interaction.', item));
    }
  }
  for (const expectedId of expectedIds) {
    if (!ids.has(expectedId)) {
      violations.push(violation('READ_ONLY_INTERACTION_MISSING', 'The fixed read-only interaction plan is incomplete.', expectedId));
    }
  }
  for (const id of ids) {
    if (!expectedIds.has(id)) {
      violations.push(violation('UNAPPROVED_INTERACTION', 'The interaction plan contains an unapproved action.', id));
    }
  }
  return { passed: violations.length === 0, violations };
}

function validateOverlayTriggerContract({
  actionId,
  ariaDisabled,
  disabled,
  expectedActionId,
  rendered,
  tagName,
  triggerCount,
}) {
  const violations = [];
  if (triggerCount !== 1) {
    violations.push(violation(
      'OVERLAY_TRIGGER_COUNT_MISMATCH',
      'A read-only package evidence overlay must have exactly one trigger before any click.',
      { expected: 1, actual: triggerCount, expectedActionId },
    ));
    return { passed: false, violations };
  }
  if (String(tagName || '').toLowerCase() !== 'button') {
    violations.push(violation('OVERLAY_TRIGGER_NOT_BUTTON', 'The package evidence overlay trigger must be a real button.', tagName));
  }
  if (disabled === true || ariaDisabled === 'true') {
    violations.push(violation('OVERLAY_TRIGGER_DISABLED', 'The package evidence overlay trigger must be enabled before clicking.'));
  }
  if (rendered !== true) {
    violations.push(violation('OVERLAY_TRIGGER_NOT_RENDERED', 'The package evidence overlay trigger must be visibly rendered before clicking.'));
  }
  if (expectedActionId && actionId !== expectedActionId) {
    violations.push(violation(
      'OVERLAY_TRIGGER_ACTION_MISMATCH',
      'The package evidence runner refused to click a task action that is not the approved read-only overlay trigger.',
      { expected: expectedActionId, actual: actionId || null },
    ));
  }
  return { passed: violations.length === 0, violations };
}

function validateOverlayKeyboardEvidence({ backwardFocus, focusableCount, forwardFocus }) {
  const count = Number(focusableCount);
  const violations = [];
  if (!Number.isInteger(count) || count <= 0) {
    violations.push(violation('OVERLAY_FOCUSABLE_CONTROL_MISSING', 'The dialog must expose at least one enabled focusable control.'));
    return { mode: 'no-controls', passed: false, violations };
  }
  if (count === 1) {
    const shiftTabRetained = backwardFocus?.insideDialog === true && backwardFocus?.evidenceBoundary === 'single';
    const tabRetained = forwardFocus?.insideDialog === true && forwardFocus?.evidenceBoundary === 'single';
    if (!shiftTabRetained) {
      violations.push(violation('SINGLE_CONTROL_SHIFT_TAB_ESCAPED', 'Shift+Tab must retain focus on the unique enabled dialog control.', backwardFocus));
    }
    if (!tabRetained) {
      violations.push(violation('SINGLE_CONTROL_TAB_ESCAPED', 'Tab must retain focus on the unique enabled dialog control.', forwardFocus));
    }
    return {
      mode: 'single-control',
      passed: violations.length === 0,
      singleControlEvidence: {
        shiftTabRetained,
        tabRetained,
        uniqueBoundary: 'single',
      },
      violations,
    };
  }
  const backwardWrapped = backwardFocus?.insideDialog === true && backwardFocus?.evidenceBoundary === 'last';
  const forwardWrapped = forwardFocus?.insideDialog === true && forwardFocus?.evidenceBoundary === 'first';
  if (!backwardWrapped) {
    violations.push(violation('MULTI_CONTROL_SHIFT_TAB_DID_NOT_WRAP', 'Shift+Tab must wrap from the first to the last enabled dialog control.', backwardFocus));
  }
  if (!forwardWrapped) {
    violations.push(violation('MULTI_CONTROL_TAB_DID_NOT_WRAP', 'Tab must wrap from the last to the first enabled dialog control.', forwardFocus));
  }
  return {
    mode: 'multi-control-wrap',
    multiControlEvidence: { backwardWrapped, forwardWrapped },
    passed: violations.length === 0,
    violations,
  };
}

function validateWorkspaceTabKeyboardEvidence(input, expected) {
  const violations = [];
  const expectedTabs = Array.isArray(expected?.tabs) ? expected.tabs : [];
  const defaultSubview = expected?.subview;
  const endSubview = expectedTabs[expectedTabs.length - 1];
  for (const [phase, snapshot, expectedSubview] of [
    ['initial', input?.initial, defaultSubview],
    ['end', input?.end, endSubview],
    ['restored', input?.restored, defaultSubview],
  ]) {
    if (!snapshot || snapshot.tabCount !== expectedTabs.length) {
      violations.push(violation(
        'WORKSPACE_TAB_COUNT_MISMATCH',
        `${expected?.workspace || 'workspace'} ${phase} keyboard snapshot must expose every registered subview tab.`,
        { actual: snapshot?.tabCount ?? null, expected: expectedTabs.length },
      ));
      continue;
    }
    if (snapshot.selectedCount !== 1
      || snapshot.activeSubview !== expectedSubview
      || snapshot.selectedSubview !== expectedSubview
      || snapshot.focusedSubview !== expectedSubview) {
      violations.push(violation(
        'WORKSPACE_TAB_KEYBOARD_STATE_MISMATCH',
        `${expected?.workspace || 'workspace'} ${phase} keyboard state must select and focus ${expectedSubview}.`,
        snapshot,
      ));
    }
  }
  return {
    ...input,
    expectedTabs,
    passed: violations.length === 0,
    violations,
  };
}

function validateIsolatedProfileBootstrapEvidence(session, diagnostics) {
  const violations = [];
  const storeGate = session?.storeGate;
  const selectedStore = storeGate?.selectedStore;
  if (
    !['created-and-selected-isolated-evidence-store', 'selected-existing-store']
      .includes(storeGate?.outcome)
    || storeGate?.marketplace !== 'US'
    || storeGate?.currency !== 'USD'
    || !Number.isInteger(selectedStore?.idLength)
    || selectedStore.idLength < 1
    || !/^[A-F0-9]{64}$/.test(String(selectedStore?.idSha256 || ''))
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_STORE_BOOTSTRAP_INVALID',
      'Each packaged run must visibly and explicitly enter one bounded US/USD store in the isolated evidence profile.',
      storeGate ?? null,
    ));
  }
  if (
    storeGate?.outcome === 'created-and-selected-isolated-evidence-store'
    && (
      storeGate.createdEvidenceStore !== true
      || selectedStore?.displayName !== PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME
    )
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_CREATED_STORE_REFERENCE_INVALID',
      'A created evidence store must be clearly labelled as the fixed isolated Package UI store.',
      storeGate,
    ));
  }
  if (
    storeGate?.outcome === 'selected-existing-store'
    && (
      storeGate.createdEvidenceStore !== false
      || selectedStore?.displayName !== null
    )
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_EXISTING_STORE_REFERENCE_UNBOUNDED',
      'An existing store reference must retain only its bounded hashed id and may not expose its display name.',
      storeGate,
    ));
  }

  const connectionBootstrap = session?.connectionBootstrap;
  const connectionStartedAt = Date.parse(connectionBootstrap?.startedAt);
  const connectionCompletedAt = Date.parse(connectionBootstrap?.completedAt);
  const allowedConnectionOutcomes = new Set([
    'existing-lingxing-connection',
    'bound-isolated-evidence-lingxing-connection',
    'not-required-authenticated-workspace',
    'not-required-workspace-authenticated-during-observation',
    'operator-established-lingxing-connection-and-session',
  ]);
  if (
    !allowedConnectionOutcomes.has(connectionBootstrap?.outcome)
    || !Number.isFinite(connectionStartedAt)
    || !Number.isFinite(connectionCompletedAt)
    || connectionCompletedAt < connectionStartedAt
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_LINGXING_CONNECTION_BOOTSTRAP_INVALID',
      'Each packaged run must prove a visible ready Lingxing connection or an already authenticated workspace without retaining account data.',
      connectionBootstrap ?? null,
    ));
  }
  if (canonicalJson(connectionBootstrap) !== canonicalJson(diagnostics?.login?.connectionBootstrap)) {
    violations.push(violation(
      'ISOLATED_PROFILE_CONNECTION_DIAGNOSTICS_MISMATCH',
      'The bounded session connection bootstrap evidence must match the structured run diagnostics.',
      {
        diagnostics: diagnostics?.login?.connectionBootstrap ?? null,
        session: connectionBootstrap ?? null,
      },
    ));
  }
  const loginSessionAttestation = validateLoginSessionAttestation(
    session?.loginSessionAttestation,
    session?.mode,
  );
  if (!loginSessionAttestation.passed) {
    violations.push(...loginSessionAttestation.violations);
  }
  const storeGateDiagnostics = diagnostics?.storeGate;
  const diagnosticStoreGateStartedAt = Date.parse(storeGateDiagnostics?.startedAt);
  const diagnosticStoreGateCompletedAt = Date.parse(storeGateDiagnostics?.completedAt);
  if (
    storeGateDiagnostics?.outcome !== storeGate?.outcome
    || storeGateDiagnostics?.createdEvidenceStore !== storeGate?.createdEvidenceStore
    || storeGateDiagnostics?.marketplace !== 'US'
    || storeGateDiagnostics?.currency !== 'USD'
    || !['login', 'workspace'].includes(storeGateDiagnostics?.resultingSurface)
    || !Number.isFinite(diagnosticStoreGateStartedAt)
    || !Number.isFinite(diagnosticStoreGateCompletedAt)
    || diagnosticStoreGateCompletedAt < diagnosticStoreGateStartedAt
    || canonicalJson(storeGateDiagnostics?.selectedStore) !== canonicalJson(selectedStore)
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_STORE_DIAGNOSTICS_MISMATCH',
      'The bounded session store selection must match the structured run diagnostics.',
      {
        diagnostics: storeGateDiagnostics ?? null,
        session: storeGate ?? null,
      },
    ));
  }
  const storeAuthorityReadback = session?.storeAuthorityReadback;
  if (
    storeAuthorityReadback?.passed !== true
    || storeAuthorityReadback.actualIdSha256 !== selectedStore?.idSha256
    || storeAuthorityReadback.expectedIdSha256 !== selectedStore?.idSha256
    || storeAuthorityReadback.marketplace !== 'US'
    || storeAuthorityReadback.currency !== 'USD'
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_STORE_AUTHORITY_READBACK_INVALID',
      'The packaged shell Store Authority must hash-match the explicitly selected US/USD Store Gate option.',
      storeAuthorityReadback ?? null,
    ));
  }
  return {
    connectionBootstrap,
    loginSessionAttestation,
    passed: violations.length === 0,
    storeAuthorityReadback,
    storeGate,
    violations,
  };
}

function evaluatePackageUiEvidenceCompleteness(input) {
  const violations = [];
  const schemaVersion = Number(input.schemaVersion || 0);
  const legacyV5 = schemaVersion === LEGACY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION;
  const legacySchedulerReadOnlyV6 =
    schemaVersion === LEGACY_SCHEDULER_READ_ONLY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION;
  const interactiveLoginV7 = schemaVersion === PACKAGE_UI_EVIDENCE_SCHEMA_VERSION;
  const schedulerReadOnlyContract = legacySchedulerReadOnlyV6 || interactiveLoginV7;
  if (!legacyV5 && !schedulerReadOnlyContract) {
    violations.push(violation(
      'PACKAGE_UI_SCHEMA_UNSUPPORTED',
      'Package UI evidence must use historical schema v5/v6 or current interactive-login schema v7.',
      { schemaVersion },
    ));
  }
  if (
    interactiveLoginV7
    && canonicalJson(input.interactiveLoginContract) !== canonicalJson(INTERACTIVE_LOGIN_CONTRACT)
  ) {
    violations.push(violation(
      'INTERACTIVE_LOGIN_CONTRACT_MISSING_OR_CHANGED',
      'Schema v7 must declare the exact visible, bounded, secret-blind operator login contract.',
      input.interactiveLoginContract ?? null,
    ));
  }
  if (
    interactiveLoginV7
    && (
      input.requested?.allowInteractiveLogin !== true
      || input.requested?.allowSavedLogin !== false
      || input.requested?.loginMode !== 'interactive-operator-each-run'
      || !Number.isInteger(input.requested?.interactiveLoginTimeoutMs)
      || input.requested.interactiveLoginTimeoutMs < 60_000
      || input.requested.interactiveLoginTimeoutMs > 900_000
    )
  ) {
    violations.push(violation(
      'INTERACTIVE_LOGIN_REQUEST_CONTRACT_MISMATCH',
      'Schema v7 must request a bounded visible operator handoff for every run and must not enable saved-login automation.',
      {
        allowInteractiveLogin: input.requested?.allowInteractiveLogin ?? null,
        allowSavedLogin: input.requested?.allowSavedLogin ?? null,
        interactiveLoginTimeoutMs: input.requested?.interactiveLoginTimeoutMs ?? null,
        loginMode: input.requested?.loginMode ?? null,
      },
    ));
  }
  if (input.artifactHashesStable !== true) {
    violations.push(violation('ARTIFACT_CHANGED_DURING_RUN', 'EXE or unpacked app content changed while evidence was being captured.'));
  }
  if (input.protectedDatabase?.passed !== true) {
    violations.push(violation(
      'PROTECTED_DATABASE_CHANGED_DURING_RUN',
      'The protected real AppData SQLite file must retain the same path, SHA-256, size, and mtime during package evidence capture.',
      input.protectedDatabase,
    ));
  }
  if (input.profileDatabaseProvenance?.passed !== true) {
    violations.push(violation(
      'PROFILE_DATABASE_PROVENANCE_FAILED',
      'The isolated profile amazon-ai-ops.db must be a distinct byte-for-byte source copy of --protected-db before launch.',
      input.profileDatabaseProvenance,
    ));
  }
  if (schedulerReadOnlyContract && input.profileDatabaseFileIsolation?.passed !== true) {
    violations.push(violation(
      'PROFILE_DATABASE_FILE_ISOLATION_FAILED',
      'Schema v6/v7 evidence must prove that the isolated profile database is not a hardlink alias of --protected-db.',
      input.profileDatabaseFileIsolation,
    ));
  }
  if (
    schedulerReadOnlyContract
    && canonicalJson(input.isolatedProfileBootstrapContract)
      !== canonicalJson(ISOLATED_PROFILE_BOOTSTRAP_CONTRACT)
  ) {
    violations.push(violation(
      'ISOLATED_PROFILE_BOOTSTRAP_CONTRACT_MISSING_OR_CHANGED',
      'Schema v6/v7 must declare the exact isolated-profile-only visible bootstrap contract with no business readiness credit.',
      input.isolatedProfileBootstrapContract ?? null,
    ));
  }
  if (!processSnapshotEvidencePassed(input.packageProcessIsolation?.before)
    || input.packageProcessIsolation?.before?.matchingCount !== 0
    || input.packageProcessIsolation?.before?.unresolvedCount !== 0) {
    violations.push(violation(
      'PACKAGE_PROCESS_PREEXISTING_OR_UNRESOLVED',
      'No matching packaged process may be running before evidence capture.',
      input.packageProcessIsolation?.before,
    ));
  }
  if (!processIsolationEvidencePassed(input.packageProcessIsolation)) {
    violations.push(violation(
      'PACKAGE_PROCESS_CLEANUP_FAILED',
      'All matching packaged processes must be gone after evidence capture.',
      input.packageProcessIsolation?.after,
    ));
  }
  if (!processIsolationEvidencePassed(input.profileProcessIsolation)) {
    violations.push(violation(
      'PROFILE_PROCESS_CLEANUP_FAILED',
      'The exact isolated browser profile must have zero Chrome, Chromium, or Edge processes before and after evidence capture.',
      input.profileProcessIsolation,
    ));
  }
  const runs = Array.isArray(input.runs) ? input.runs : [];
  for (const scale of EXPECTED_PACKAGE_UI_SCALES) {
    const run = runs.find((candidate) => candidate.scalePercent === scale.scalePercent);
    if (!run) {
      violations.push(violation('SCALE_RUN_MISSING', `Missing ${scale.scalePercent}% packaged UI run.`));
      continue;
    }
    if (interactiveLoginV7 && run.session?.mode !== 'interactive-operator-login') {
      violations.push(violation(
        'SCALE_INTERACTIVE_LOGIN_HANDOFF_MISSING',
        `The ${scale.scalePercent}% schema v7 run must be reached through its own visible operator handoff.`,
        { mode: run.session?.mode ?? null },
      ));
    }
    if (
      interactiveLoginV7
      && scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent
      && !firstInteractiveLoginAttestationPassed(run.session?.loginSessionAttestation)
    ) {
      violations.push(violation(
        'INTERACTIVE_LOGIN_FIRST_RUN_TYPED_PROOF_MISSING',
        'The first schema v7 run must establish a fresh typed-and-saved, non-reused, identity-verified ERP session before any saved-session continuation.',
        run.session?.loginSessionAttestation ?? null,
      ));
    }
    const viewportContract = evaluatePackageViewportContract({
      actual: run.viewport,
      actualDeviceScaleFactor: run.actualDeviceScaleFactor,
      expectedDeviceScaleFactor: scale.deviceScaleFactor,
    });
    if (viewportContract.violations.some((item) => item.code === 'DEVICE_SCALE_FACTOR_DELTA')) {
      violations.push(violation('DEVICE_SCALE_FACTOR_MISMATCH', `The ${scale.scalePercent}% run did not use the expected device scale factor.`, {
        viewportContract,
      }));
    }
    if (viewportContract.violations.some((item) => item.code === 'VIEWPORT_DIMENSION_DELTA')) {
      violations.push(violation('SCALE_VIEWPORT_MISMATCH', `The ${scale.scalePercent}% run exceeded the strict nominal 1200x700 DPI rounding tolerance.`, viewportContract));
    }
    if (run.identity?.passed !== true) {
      violations.push(violation('SCALE_IDENTITY_FAILED', `The ${scale.scalePercent}% packaged identity check failed.`, run.identity?.violations));
    }
    if (!processIsolationEvidencePassed(run.packageProcessIsolation)) {
      violations.push(violation('SCALE_PACKAGE_PROCESS_ISOLATION_FAILED', `The ${scale.scalePercent}% product process isolation evidence is missing or failed.`, run.packageProcessIsolation));
    }
    if (!processIsolationEvidencePassed(run.profileProcessIsolation)) {
      violations.push(violation('SCALE_PROFILE_PROCESS_ISOLATION_FAILED', `The ${scale.scalePercent}% profile browser isolation evidence is missing or failed.`, run.profileProcessIsolation));
    }
    const schedulerReadOnlyRuntime = schedulerReadOnlyContract
      ? validatePackageUiReadOnlyRuntimeEvidence(
          run.schedulerReadOnlyRuntime,
          { requireSchedulerReads: true },
        )
      : null;
    if (schedulerReadOnlyContract && schedulerReadOnlyRuntime?.passed !== true) {
      violations.push(violation(
        'SCALE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED',
        `${scale.scalePercent}% package UI did not prove the live Main scheduler read-only guard.`,
        schedulerReadOnlyRuntime,
      ));
    }
    const databaseCheckpointBinding = schedulerReadOnlyContract
      ? validatePackageUiDatabaseCheckpointReceipts(
          run.databaseAuditCheckpoints,
          run.schedulerReadOnlyRuntime,
        )
      : null;
    if (schedulerReadOnlyContract && databaseCheckpointBinding?.passed !== true) {
      violations.push(violation(
        'SCALE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED',
        `${scale.scalePercent}% package UI database checkpoint receipts are not bound to the copied Main audit.`,
        databaseCheckpointBinding,
      ));
    }
    if (!validRunDiagnostics(run.diagnostics, run)) {
      violations.push(violation('SCALE_DIAGNOSTICS_MISSING_OR_FAILED', `The ${scale.scalePercent}% structured run diagnostics are missing or invalid.`, run.diagnostics));
    }
    const profileBootstrap = schedulerReadOnlyContract
      ? validateIsolatedProfileBootstrapEvidence(run.session, run.diagnostics)
      : null;
    if (schedulerReadOnlyContract && profileBootstrap?.passed !== true) {
      violations.push(violation(
        'SCALE_ISOLATED_PROFILE_BOOTSTRAP_MISSING_OR_FAILED',
        `${scale.scalePercent}% package UI did not prove bounded visible Store Gate and Lingxing-connection bootstrap.`,
        profileBootstrap,
      ));
    }
    if ((run.consoleErrors || []).length > 0) {
      violations.push(violation('RENDERER_CONSOLE_ERROR', `The ${scale.scalePercent}% packaged renderer emitted console errors.`, run.consoleErrors));
    }
    if ((run.pageErrors || []).length > 0) {
      violations.push(violation('RENDERER_PAGE_ERROR', `The ${scale.scalePercent}% packaged renderer emitted uncaught page errors.`, run.pageErrors));
    }
    for (const workspace of EXPECTED_PACKAGE_UI_WORKSPACES) {
      const check = (run.workspaceChecks || []).find((candidate) => (
        candidate.workspace === workspace.workspace && candidate.subview === workspace.subview
      ));
      if (!check || check.passed !== true) {
        violations.push(violation('WORKSPACE_CHECK_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace}/${workspace.subview} runtime check is missing or failed.`, check));
      }
      if (check?.settleEvidence?.passed !== true || check?.compositeEvidence?.passed !== true) {
        violations.push(violation('WORKSPACE_NOT_SETTLED_FOR_CAPTURE', `${scale.scalePercent}% ${workspace.workspace}/${workspace.subview} was not stably rendered before capture.`, check));
      }
      if (check?.keyboardEvidence?.passed !== true) {
        violations.push(violation('WORKSPACE_KEYBOARD_EVIDENCE_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace}/${workspace.subview} tab keyboard evidence is missing or failed.`, check?.keyboardEvidence));
      }
      const screenshot = (run.screenshots || []).find((candidate) => (
        candidate.workspace === workspace.workspace && candidate.subview === workspace.subview
      ));
      if (!screenshot || !/^[A-F0-9]{64}$/.test(String(screenshot.sha256 || ''))) {
        violations.push(violation('WORKSPACE_SCREENSHOT_MISSING_OR_UNHASHED', `${scale.scalePercent}% ${workspace.workspace}/${workspace.subview} screenshot is missing or unhashed.`, screenshot));
      }
      if (PACKAGE_OBJECT_WORKSPACES.some((item) => item.workspace === workspace.workspace)) {
        if (check?.experienceEvidence?.passed !== true) {
          violations.push(violation('OBJECT_WORKSPACE_EXPERIENCE_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace} queue experience evidence is missing or failed.`, check?.experienceEvidence));
        }
        if (check?.inspectorEvidence?.passed !== true) {
          violations.push(violation('OBJECT_INSPECTOR_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace} read-only drawer evidence is missing or failed.`, check?.inspectorEvidence));
        }
        if (!/^[A-F0-9]{64}$/.test(String(check?.inspectorEvidence?.screenshot?.sha256 || ''))) {
          violations.push(violation('OBJECT_INSPECTOR_SCREENSHOT_MISSING_OR_UNHASHED', `${scale.scalePercent}% ${workspace.workspace} read-only drawer screenshot is missing or unhashed.`, check?.inspectorEvidence?.screenshot));
        }
      }
    }
    // Schema v5 is intentionally interpreted with its historical ten-workspace
    // contract. Schemas v6/v7 prove the scheduler subview, Main read-only guard,
    // and current screenshot bytes; v5 must never be silently upgraded in place.
    for (const expectedSubview of schedulerReadOnlyContract ? EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS : []) {
      const check = (run.subviewChecks || []).find((candidate) => (
        candidate.workspace === expectedSubview.workspace
        && candidate.subview === expectedSubview.subview
      ));
      if (!check || check.passed !== true) {
        violations.push(violation(
          'SUBVIEW_CHECK_MISSING_OR_FAILED',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} read-only subview check is missing or failed.`,
          check,
        ));
        continue;
      }
      if (check.settleEvidence?.passed !== true || check.compositeEvidence?.passed !== true) {
        violations.push(violation(
          'SUBVIEW_NOT_SETTLED_FOR_CAPTURE',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} was not stably rendered before capture.`,
          check,
        ));
      }
      const schedulerSubviewValidation = validateSchedulerSubviewEvidence(
        check.identityCapabilityEvidence,
        expectedSubview,
      );
      if (schedulerSubviewValidation.passed !== true) {
        violations.push(violation(
          'SUBVIEW_IDENTITY_CAPABILITY_MISSING_OR_FAILED',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} identity/capability evidence is missing or failed.`,
          schedulerSubviewValidation,
        ));
      }
      const schedulerSubviewRuntimeBinding = validateSchedulerSubviewRuntimeBinding(
        check.identityCapabilityEvidence,
        run.schedulerReadOnlyRuntime,
      );
      if (schedulerSubviewRuntimeBinding.passed !== true) {
        violations.push(violation(
          'SUBVIEW_RUNTIME_ATTESTATION_BINDING_FAILED',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} IPC/DOM evidence is not bound to the hash-proven Main scheduler ledger.`,
          schedulerSubviewRuntimeBinding,
        ));
      }
      if (!currentFileRecordMatches(check.screenshot)) {
        violations.push(violation(
          'SUBVIEW_SCREENSHOT_MISSING_OR_STALE',
          `${scale.scalePercent}% ${expectedSubview.workspace}/${expectedSubview.subview} screenshot is missing or its current SHA-256/size is stale.`,
          check.screenshot,
        ));
      }
    }
    for (const overlayId of EXPECTED_OVERLAY_CHECK_IDS) {
      const check = (run.overlayChecks || []).find((candidate) => candidate.id === overlayId);
      if (!check || check.passed !== true) {
        violations.push(violation('OVERLAY_CHECK_MISSING_OR_FAILED', `${scale.scalePercent}% ${overlayId} focus check is missing or failed.`, check));
        continue;
      }
      if (check.compositeEvidence?.passed !== true
        || check.overlayVisibleBeforeCapture !== true
        || check.overlayVisibleAfterCapture !== true) {
        violations.push(violation('OVERLAY_NOT_STABLE_FOR_CAPTURE', `${scale.scalePercent}% ${overlayId} was not visibly stable across screenshot capture.`, check));
      }
      if (!/^[A-F0-9]{64}$/.test(String(check.screenshot?.sha256 || ''))) {
        violations.push(violation('OVERLAY_SCREENSHOT_MISSING_OR_UNHASHED', `${scale.scalePercent}% ${overlayId} screenshot is missing or unhashed.`, check.screenshot));
      }
    }
  }
  const wideRun = input.wideProfile;
  if (!wideRun || wideRun.profileId !== PACKAGE_UI_WIDE_PROFILE.id) {
    violations.push(violation('WIDE_PROFILE_MISSING', 'Missing the fixed 1400x900@100 Product/Diagnosis package profile.', wideRun));
  } else {
    if (interactiveLoginV7 && wideRun.session?.mode !== 'interactive-operator-login') {
      violations.push(violation(
        'WIDE_INTERACTIVE_LOGIN_HANDOFF_MISSING',
        'The wide schema v7 run must be reached through its own visible operator handoff.',
        { mode: wideRun.session?.mode ?? null },
      ));
    }
    const wideViewportContract = evaluatePackageViewportContract({
      actual: wideRun.viewport,
      actualDeviceScaleFactor: wideRun.actualDeviceScaleFactor,
      expectedDeviceScaleFactor: PACKAGE_UI_WIDE_PROFILE.deviceScaleFactor,
      requested: PACKAGE_UI_WIDE_PROFILE.viewport,
    });
    if (!wideViewportContract.passed) {
      violations.push(violation('WIDE_PROFILE_VIEWPORT_MISMATCH', 'The wide package profile must remain 1400x900@100 within DPI tolerance.', wideViewportContract));
    }
    if (wideRun.identity?.passed !== true) {
      violations.push(violation('WIDE_PROFILE_IDENTITY_FAILED', 'The wide package profile did not retain packaged runtime identity.', wideRun.identity));
    }
    if (!processIsolationEvidencePassed(wideRun.packageProcessIsolation)) {
      violations.push(violation('WIDE_PACKAGE_PROCESS_ISOLATION_FAILED', 'The wide profile product process isolation evidence is missing or failed.', wideRun.packageProcessIsolation));
    }
    if (!processIsolationEvidencePassed(wideRun.profileProcessIsolation)) {
      violations.push(violation('WIDE_PROFILE_PROCESS_ISOLATION_FAILED', 'The wide profile browser isolation evidence is missing or failed.', wideRun.profileProcessIsolation));
    }
    const schedulerReadOnlyRuntime = schedulerReadOnlyContract
      ? validatePackageUiReadOnlyRuntimeEvidence(
          wideRun.schedulerReadOnlyRuntime,
          { requireSchedulerReads: false },
        )
      : null;
    if (schedulerReadOnlyContract && schedulerReadOnlyRuntime?.passed !== true) {
      violations.push(violation(
        'WIDE_SCHEDULER_READ_ONLY_RUNTIME_MISSING_OR_FAILED',
        'The wide package UI profile did not prove the live Main scheduler read-only guard.',
        schedulerReadOnlyRuntime,
      ));
    }
    const databaseCheckpointBinding = schedulerReadOnlyContract
      ? validatePackageUiDatabaseCheckpointReceipts(
          wideRun.databaseAuditCheckpoints,
          wideRun.schedulerReadOnlyRuntime,
        )
      : null;
    if (schedulerReadOnlyContract && databaseCheckpointBinding?.passed !== true) {
      violations.push(violation(
        'WIDE_DATABASE_AUDIT_CHECKPOINTS_MISSING_OR_FAILED',
        'The wide package UI database checkpoint receipts are not bound to the copied Main audit.',
        databaseCheckpointBinding,
      ));
    }
    if (!validRunDiagnostics(wideRun.diagnostics, wideRun)) {
      violations.push(violation('WIDE_DIAGNOSTICS_MISSING_OR_FAILED', 'The wide profile structured run diagnostics are missing or invalid.', wideRun.diagnostics));
    }
    const wideProfileBootstrap = schedulerReadOnlyContract
      ? validateIsolatedProfileBootstrapEvidence(wideRun.session, wideRun.diagnostics)
      : null;
    if (schedulerReadOnlyContract && wideProfileBootstrap?.passed !== true) {
      violations.push(violation(
        'WIDE_ISOLATED_PROFILE_BOOTSTRAP_MISSING_OR_FAILED',
        'The wide package UI profile did not prove bounded visible Store Gate and Lingxing-connection bootstrap.',
        wideProfileBootstrap,
      ));
    }
    if ((wideRun.consoleErrors || []).length > 0 || (wideRun.pageErrors || []).length > 0) {
      violations.push(violation('WIDE_PROFILE_RENDERER_ERROR', 'The wide package profile emitted renderer errors.', {
        consoleErrors: wideRun.consoleErrors,
        pageErrors: wideRun.pageErrors,
      }));
    }
    for (const workspace of PACKAGE_OBJECT_WORKSPACES) {
      const check = (wideRun.workspaceChecks || []).find((candidate) => candidate.workspace === workspace.workspace);
      if (!check || check.passed !== true
        || check.experienceEvidence?.passed !== true
        || check.inspectorEvidence?.passed !== true
        || check.inspectorEvidence?.inspector?.mode !== 'inline'
        || check.inspectorEvidence?.inspector?.ariaModal === 'true') {
        violations.push(violation('WIDE_OBJECT_WORKSPACE_MISSING_OR_FAILED', `Wide ${workspace.workspace} experience/inline-inspector evidence is missing or failed.`, check));
      }
      const screenshot = (wideRun.screenshots || []).find((candidate) => candidate.workspace === workspace.workspace);
      if (!/^[A-F0-9]{64}$/.test(String(screenshot?.sha256 || ''))
        || !/^[A-F0-9]{64}$/.test(String(check?.inspectorEvidence?.screenshot?.sha256 || ''))) {
        violations.push(violation('WIDE_SCREENSHOT_MISSING_OR_UNHASHED', `Wide ${workspace.workspace} queue or inline-inspector screenshot is missing or unhashed.`, {
          inspector: check?.inspectorEvidence?.screenshot,
          workspace: screenshot,
        }));
      }
    }
  }
  return { passed: violations.length === 0, violations };
}

function readPngDimensions(buffer) {
  const pngSignature = '89504e470d0a1a0a';
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function screenshotRecord(filePath, extra = {}) {
  const buffer = fs.readFileSync(filePath);
  return {
    ...extra,
    path: filePath,
    sha256: sha256Buffer(buffer),
    dimensions: readPngDimensions(buffer),
    sizeBytes: buffer.length,
  };
}

async function captureViewportScreenshot(electronApp, screenshotPath) {
  const capture = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      throw new Error('No live packaged BrowserWindow is available for evidence capture.');
    }
    const image = await window.webContents.capturePage();
    return {
      data: image.toPNG().toString('base64'),
      empty: image.isEmpty(),
      nativeSize: image.getSize(),
    };
  });
  if (capture?.empty || !capture?.data) {
    fail('Electron webContents.capturePage returned no PNG payload', screenshotPath);
  }
  fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
  const dimensions = readPngDimensions(fs.readFileSync(screenshotPath));
  if (!dimensions) fail('Electron webContents.capturePage did not produce a valid PNG', screenshotPath);
  return {
    dimensions,
    method: 'electron-webcontents-capture-page',
    nativeSize: capture.nativeSize,
  };
}

function timestampSegment(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function safeSegment(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function artifactInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    fail('Required packaged artifact is missing', filePath);
  }
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink() || !before.isFile()) {
    fail('Required packaged artifact must be a real file, not a symbolic link or junction', filePath);
  }
  const buffer = fs.readFileSync(filePath);
  const after = fs.lstatSync(filePath);
  if (
    before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
    || buffer.length !== after.size
  ) {
    fail('Required packaged artifact changed while it was being hashed', filePath);
  }
  return {
    path: safeRealPath(filePath),
    sha256: sha256Buffer(buffer),
    sizeBytes: buffer.length,
    mtime: after.mtime.toISOString(),
    mtimeMs: after.mtimeMs,
  };
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function stableFileRecord(rootPath, filePath) {
  const before = fs.lstatSync(filePath);
  if (before.isSymbolicLink()) {
    fail('Packaged app content may not contain symbolic links or junctions', filePath);
  }
  if (!before.isFile()) fail('Packaged app content contains a non-file leaf', filePath);
  const realPath = fs.realpathSync.native(filePath);
  if (!isPathWithin(rootPath, realPath)) {
    fail('Packaged app content escapes the fixed resources/app directory', filePath);
  }
  const relativePath = path.relative(rootPath, realPath).split(path.sep).join('/');
  if (!relativePath || relativePath === '..' || relativePath.startsWith('../') || path.posix.isAbsolute(relativePath)) {
    fail('Packaged app content produced an unsafe relative path', relativePath || filePath);
  }
  const buffer = fs.readFileSync(realPath);
  const after = fs.lstatSync(filePath);
  if (
    before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
    || before.ctimeMs !== after.ctimeMs
    || buffer.length !== after.size
  ) {
    fail('Packaged app content changed while it was being hashed', relativePath);
  }
  return {
    path: relativePath,
    sha256: sha256Buffer(buffer),
    sizeBytes: buffer.length,
  };
}

function buildProductionBuildContentManifest(distPath) {
  const resolvedRoot = path.resolve(distPath);
  if (!fs.existsSync(resolvedRoot)) fail('Required desktop production-build directory is missing', resolvedRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('Desktop production-build directory must be a real directory, not a symbolic link or junction', resolvedRoot);
  }
  const rootPath = fs.realpathSync.native(resolvedRoot);
  if (resolvedRoot.replace(/\\/g, '/').toLowerCase() !== rootPath.replace(/\\/g, '/').toLowerCase()) {
    fail('Desktop production-build directory resolves through a symbolic link or junction', `${resolvedRoot} -> ${rootPath}`);
  }
  const files = [];
  const mtimes = [];
  const addFile = (filePath) => {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail('Desktop production-build payload may contain only real files', filePath);
    }
    const realPath = fs.realpathSync.native(filePath);
    if (!isPathWithin(rootPath, realPath)) fail('Desktop production-build payload escapes its fixed dist directory', filePath);
    files.push(stableFileRecord(rootPath, filePath));
    mtimes.push(stat.mtimeMs);
  };
  const fixedRuntimeEntries = [
    'main/index.cjs',
    'main/index.js',
    'preload/index.cjs',
    'preload/index.js',
  ];
  for (const relativePath of fixedRuntimeEntries) {
    const filePath = path.join(rootPath, ...relativePath.split('/'));
    if (!fs.existsSync(filePath)) fail('Required desktop production-build entry is missing', relativePath);
    addFile(filePath);
  }
  const rendererRoot = path.join(rootPath, 'renderer');
  if (!fs.existsSync(rendererRoot) || !fs.lstatSync(rendererRoot).isDirectory()) {
    fail('Required desktop renderer production-build directory is missing', 'renderer');
  }
  const visitRenderer = (directoryPath) => {
    for (const name of fs.readdirSync(directoryPath).sort()) {
      const targetPath = path.join(directoryPath, name);
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) fail('Desktop renderer production-build may not contain symbolic links or junctions', targetPath);
      const realPath = fs.realpathSync.native(targetPath);
      if (!isPathWithin(rootPath, realPath)) fail('Desktop renderer production-build escapes its fixed dist directory', targetPath);
      if (stat.isDirectory()) {
        visitRenderer(realPath);
      } else if (!name.endsWith('.map')) {
        addFile(targetPath);
      }
    }
  };
  visitRenderer(rendererRoot);
  if (!files.some((file) => file.path === 'renderer/index.html')) {
    fail('Required desktop production-build entry is missing', 'renderer/index.html');
  }
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const canonical = JSON.stringify({ schemaVersion: 1, files });
  return {
    kind: 'desktop-production-build-content-manifest',
    schemaVersion: 1,
    rootPath,
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    oldestMtimeMs: Math.min(...mtimes),
    newestMtimeMs: Math.max(...mtimes),
    files,
    sha256: sha256Buffer(Buffer.from(canonical, 'utf8')),
  };
}

function buildAppContentManifest(appContentPath) {
  const resolvedRoot = path.resolve(appContentPath);
  if (!fs.existsSync(resolvedRoot)) fail('Required packaged app-content directory is missing', resolvedRoot);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink()) {
    fail('Fixed packaged app-content directory may not be a symbolic link or junction', resolvedRoot);
  }
  if (!rootStat.isDirectory()) fail('Required packaged app-content path is not a directory', resolvedRoot);
  const rootPath = fs.realpathSync.native(resolvedRoot);
  const requestedRootIdentity = resolvedRoot.replace(/\\/g, '/').toLowerCase();
  const realRootIdentity = rootPath.replace(/\\/g, '/').toLowerCase();
  if (requestedRootIdentity !== realRootIdentity) {
    fail('Fixed packaged app-content path resolves through a symbolic link or junction', `${resolvedRoot} -> ${rootPath}`);
  }
  for (const relativePath of REQUIRED_APP_CONTENT_ENTRIES) {
    const entryPath = path.join(rootPath, ...relativePath.split('/'));
    if (!fs.existsSync(entryPath) || !fs.lstatSync(entryPath).isFile()) {
      fail('Required packaged runtime entry is missing', relativePath);
    }
  }
  let packageMetadata;
  try {
    packageMetadata = JSON.parse(fs.readFileSync(path.join(rootPath, 'package.json'), 'utf8'));
  } catch (error) {
    fail('Packaged app package.json is not valid JSON', String(error?.message || error));
  }
  const packageMain = String(packageMetadata?.main || '').replace(/\\/g, '/');
  if (
    !packageMain
    || path.posix.isAbsolute(packageMain)
    || path.win32.isAbsolute(packageMain)
    || packageMain.split('/').some((segment) => segment === '..')
  ) {
    fail('package.json main must be a safe relative path inside resources/app', packageMain || '<missing>');
  }
  const mainPath = path.resolve(rootPath, ...packageMain.split('/'));
  if (!isPathWithin(rootPath, mainPath) || !fs.existsSync(mainPath) || !fs.lstatSync(mainPath).isFile()) {
    fail('package.json main does not resolve to a packaged runtime file', packageMain);
  }
  if (
    String(packageMetadata?.name || '') !== String(DESKTOP_PACKAGE.name || '')
    || String(packageMetadata?.version || '') !== String(DESKTOP_PACKAGE.version || '')
    || packageMain !== String(DESKTOP_PACKAGE.main || '').replace(/\\/g, '/')
  ) {
    fail('Packaged app package.json metadata does not match the expected desktop package', JSON.stringify({
      actual: { main: packageMain, name: packageMetadata?.name, version: packageMetadata?.version },
      expected: { main: DESKTOP_PACKAGE.main, name: DESKTOP_PACKAGE.name, version: DESKTOP_PACKAGE.version },
    }));
  }
  const files = [];
  const visit = (directoryPath) => {
    for (const name of fs.readdirSync(directoryPath).sort((left, right) => left.localeCompare(right, 'en'))) {
      const targetPath = path.join(directoryPath, name);
      const stat = fs.lstatSync(targetPath);
      if (stat.isSymbolicLink()) {
        fail('Packaged app content may not contain symbolic links or junctions', targetPath);
      }
      const realPath = fs.realpathSync.native(targetPath);
      if (!isPathWithin(rootPath, realPath)) {
        fail('Packaged app content escapes the fixed resources/app directory', targetPath);
      }
      if (stat.isDirectory()) {
        visit(realPath);
      } else {
        files.push(stableFileRecord(rootPath, targetPath));
      }
    }
  };
  visit(rootPath);
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const canonical = JSON.stringify({ schemaVersion: 1, files });
  return {
    kind: 'unpacked-app-content-manifest',
    schemaVersion: 1,
    rootPath,
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    package: {
      main: packageMain,
      name: String(packageMetadata?.name || ''),
      version: String(packageMetadata?.version || ''),
    },
    files,
    sha256: sha256Buffer(Buffer.from(canonical, 'utf8')),
  };
}

function collectFixedPackageHashes() {
  const executable = artifactInfo(DEFAULT_EXECUTABLE_PATH);
  const appContent = buildAppContentManifest(DEFAULT_APP_CONTENT_PATH);
  const executableAfter = artifactInfo(DEFAULT_EXECUTABLE_PATH);
  const appContentAfter = buildAppContentManifest(DEFAULT_APP_CONTENT_PATH);
  if (executable.sha256 !== executableAfter.sha256 || appContent.sha256 !== appContentAfter.sha256) {
    fail('Fixed package artifacts changed during hash preflight. Rebuild or stop writers, then retry.');
  }
  return {
    kind: 'package-ui-hash-preflight',
    executablePath: executable.path,
    exeSha256: executable.sha256,
    exeSizeBytes: executable.sizeBytes,
    appContentPath: appContent.rootPath,
    appContentSha256: appContent.sha256,
    appContentFileCount: appContent.fileCount,
    appContentSizeBytes: appContent.totalSizeBytes,
  };
}

function latestProductionSourceWatermark(sourceRoots) {
  const roots = sourceRoots || [
    path.join(ROOT, 'apps', 'desktop', 'src'),
    path.join(ROOT, 'packages'),
  ];
  const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json']);
  const excludedDirectories = new Set([
    '__snapshots__',
    '__tests__',
    'coverage',
    'dist',
    'fixtures',
    'linux-unpacked',
    'node_modules',
    'output',
    'release',
    'test',
    'tests',
    'win-unpacked',
  ]);
  const isTestFile = (name) => /(?:^|[._-])(spec|stories|test)(?:[._-]|$)/i.test(name);
  let latest = { path: null, mtimeMs: 0, mtime: null };
  const visit = (target) => {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target)) {
        if (excludedDirectories.has(name.toLowerCase())) continue;
        visit(path.join(target, name));
      }
      return;
    }
    if (isTestFile(path.basename(target))) return;
    if (!extensions.has(path.extname(target).toLowerCase())) return;
    if (stat.mtimeMs > latest.mtimeMs) {
      latest = { path: target, mtimeMs: stat.mtimeMs, mtime: stat.mtime.toISOString() };
    }
  };
  roots.forEach(visit);
  return latest;
}

function validatePackageFreshness({ buildContent, packagedDistContent, sourceWatermark }) {
  const toleranceMs = 2_000;
  const violations = [];
  if (!sourceWatermark?.path) {
    return { passed: false, violations: [violation('SOURCE_WATERMARK_MISSING', 'Could not determine the newest packaged source file.')] };
  }
  if (!buildContent || !Number.isFinite(buildContent.oldestMtimeMs)) {
    violations.push(violation('BUILD_ARTIFACTS_MISSING', 'Could not determine the current desktop build artifacts.'));
  } else if (buildContent.oldestMtimeMs + toleranceMs < sourceWatermark.mtimeMs) {
    violations.push(violation('CURRENT_BUILD_STALE', 'Current desktop build artifacts are older than source and must be rebuilt.', {
      build: buildContent,
      newestSource: sourceWatermark,
    }));
  }
  if (!buildContent?.sha256 || !packagedDistContent?.sha256) {
    violations.push(violation('BUILD_CONTENT_HASH_MISSING', 'Current and packaged dist content hashes are required.'));
  } else if (String(buildContent.sha256).toUpperCase() !== String(packagedDistContent.sha256).toUpperCase()) {
    violations.push(violation('PACKAGED_DIST_MISMATCH', 'Packaged dist content is not byte-identical to the current desktop build.', {
      currentBuildSha256: buildContent.sha256,
      packagedDistSha256: packagedDistContent.sha256,
    }));
  }
  return { passed: violations.length === 0, violations };
}

async function collectPackageWorkspaceMetrics(page, expected) {
  return page.evaluate((settings) => {
    const tolerance = 1;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const targetSelector = `[data-workspace-evidence-root][data-workspace="${settings.workspace}"][data-workspace-subview="${settings.subview}"]`;
    const targetRoots = Array.from(document.querySelectorAll(targetSelector));
    const anyRoot = targetRoots[0] || document.querySelector('[data-workspace-evidence-root]');
    const rendered = (element) => {
      if (!(element instanceof Element) || !element.isConnected) return false;
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    };
    const inViewport = (element) => {
      if (!rendered(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
    };
    const compactText = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    const selectorFor = (element) => {
      if (element === document.documentElement) return 'documentElement';
      if (element === document.body) return 'body';
      if (element.id) return `#${CSS.escape(element.id)}`;
      const className = Array.from(element.classList || []).find(Boolean);
      if (className) return `.${CSS.escape(className)}`;
      return element.tagName.toLowerCase();
    };

    const h1Elements = anyRoot ? Array.from(anyRoot.querySelectorAll('h1')).filter(rendered) : [];
    const primaryActions = anyRoot
      ? Array.from(anyRoot.querySelectorAll('[data-action-priority="primary"]')).filter(inViewport)
      : [];
    const activeNavigation = Array.from(document.querySelectorAll('.app-sidebar .nav-item[aria-current="page"]')).filter(rendered);

    const horizontalTargets = [
      { element: document.documentElement, selector: 'documentElement' },
      { element: document.body, selector: 'body' },
      { element: document.querySelector('.app-shell'), selector: '.app-shell' },
      { element: document.querySelector('.app-content'), selector: '.app-content' },
    ];
    const horizontalMeasurements = horizontalTargets.map(({ element, selector }) => ({
      selector,
      missing: !element,
      clientWidth: element?.clientWidth ?? null,
      scrollWidth: element?.scrollWidth ?? null,
      overflowPx: element ? Math.max(0, element.scrollWidth - element.clientWidth) : null,
    }));
    const horizontalViolations = horizontalMeasurements.filter((item) => !item.missing && item.overflowPx > tolerance);

    const defaultOwners = Array.from(document.querySelectorAll('.app-content'));
    const defaultOwner = defaultOwners[0] || null;
    const defaultStyle = defaultOwner ? window.getComputedStyle(defaultOwner) : null;
    const declared = Boolean(defaultStyle && /^(auto|scroll|overlay)$/.test(defaultStyle.overflowY));
    const activeOwners = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const style = window.getComputedStyle(element);
      const active = /^(auto|scroll|overlay)$/.test(style.overflowY)
        && element.scrollHeight - element.clientHeight > tolerance;
      if (!active) continue;
      const explicitException = element === defaultOwner
        || element.matches('[data-scroll-owner], .app-sidebar, [role="dialog"], [role="complementary"], .responsive-inspector__body');
      activeOwners.push({
        selector: selectorFor(element),
        overflowY: style.overflowY,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        defaultOwner: element === defaultOwner,
        explicitException,
      });
    }

    const ids = new Map();
    for (const element of Array.from(document.querySelectorAll('[id]'))) {
      const id = element.id;
      if (!id) continue;
      ids.set(id, (ids.get(id) || 0) + 1);
    }
    const duplicateIds = Array.from(ids.entries()).filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
    const ariaReferenceAttributes = [
      'aria-labelledby',
      'aria-describedby',
      'aria-controls',
      'aria-owns',
      'aria-flowto',
      'aria-activedescendant',
    ];
    const brokenReferences = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of ariaReferenceAttributes) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        for (const token of value.trim().split(/\s+/).filter(Boolean)) {
          const count = ids.get(token) || 0;
          if (count !== 1) {
            brokenReferences.push({
              attribute,
              token,
              count,
              owner: selectorFor(element),
            });
          }
        }
      }
    }

    const previewMarkers = Array.from(document.querySelectorAll('[data-workspace-preview-notice], [data-preview-scenario], [data-readback-mode="preview-readonly"]'))
      .filter(rendered)
      .map((element) => ({ selector: selectorFor(element), text: compactText(element) }));
    if (/仅开发预览/.test(document.body?.innerText || '')) previewMarkers.push({ selector: 'body-text', text: '仅开发预览' });

    return {
      activeNavigation: { count: activeNavigation.length, label: compactText(activeNavigation[0]) },
      aria: { brokenReferences, duplicateIds },
      deviceScaleFactor: window.devicePixelRatio,
      h1: { count: h1Elements.length, labels: h1Elements.map(compactText) },
      horizontalOverflow: { measurements: horizontalMeasurements, violations: horizontalViolations },
      primaryAction: { count: primaryActions.length, labels: primaryActions.map(compactText) },
      previewMarkers,
      rendererUrl: window.location.href,
      root: {
        count: targetRoots.length,
        workspace: anyRoot?.getAttribute('data-workspace') || null,
        subview: anyRoot?.getAttribute('data-workspace-subview') || null,
      },
      scrollOwnership: {
        activeOwners,
        defaultOwner: {
          declared,
          matchCount: defaultOwners.length,
          overflowY: defaultStyle?.overflowY || null,
          scrollLeft: defaultOwner?.scrollLeft ?? null,
          scrollTop: defaultOwner?.scrollTop ?? null,
        },
        unlabelledActiveOwners: activeOwners.filter((owner) => !owner.explicitException),
      },
      viewport: { width: viewportWidth, height: viewportHeight },
    };
  }, expected);
}

async function waitForNavigationIdle(page) {
  await page.waitForFunction(() => {
    const nav = document.querySelector('nav[aria-label="主业务导航"]');
    return Boolean(nav) && nav.getAttribute('aria-busy') !== 'true';
  }, undefined, { timeout: 10_000 });
}

async function waitForRendererComposite(page, electronApp, requiredLocator) {
  if (requiredLocator) {
    await requiredLocator.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      throw new Error('No live packaged BrowserWindow is available for composite settling.');
    }
    if (typeof window.webContents.invalidate === 'function') {
      window.webContents.invalidate();
    }
  });
  await page.waitForTimeout(180);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const requiredVisible = requiredLocator ? await requiredLocator.isVisible() : true;
  if (!requiredVisible) fail('Required packaged UI surface disappeared while the compositor settled.');
  return { passed: true, requiredVisible };
}

async function collectWorkspaceSettleSnapshot(page, selector) {
  return page.evaluate(({ rootSelector, busyTokens }) => {
    const root = document.querySelector(rootSelector);
    const visible = (node) => {
      if (!(node instanceof HTMLElement)) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const liveCandidates = Array.from(document.querySelectorAll([
      '[aria-busy="true"]',
      '.button-loading',
      '.route-handoff-feedback',
      'button',
      '[role="status"]',
      '[aria-live]',
    ].join(','))).filter(visible);
    const busyLabels = liveCandidates
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => busyTokens.some((token) => text.includes(token)));
    const normalizedText = (root?.innerText || '').replace(/\s+/g, ' ').trim();
    return {
      busyCount: liveCandidates.filter((node) => node.matches('[aria-busy="true"], .button-loading, .route-handoff-feedback')).length,
      busyLabels,
      navigationBusy: document.querySelector('nav[aria-label="主业务导航"]')?.getAttribute('aria-busy') === 'true',
      rootVisible: Boolean(root && visible(root)),
      routeHandoffVisible: Array.from(document.querySelectorAll('.route-handoff-feedback')).some(visible),
      text: normalizedText,
    };
  }, {
    busyTokens: ['加载中', '正在载入', '正在刷新', '刷新中', '转跳中', '处理中'],
    rootSelector: selector,
  });
}

async function waitForWorkspaceSettled(page, selector, settleMs) {
  const minimumWaitMs = Math.max(Number(settleMs || 0), 2_500);
  await page.waitForTimeout(minimumWaitMs);
  const startedAt = Date.now();
  const timeoutMs = 20_000;
  let previousText = null;
  let stableSamples = 0;
  let sampleCount = 0;
  let latest = null;
  while (Date.now() - startedAt <= timeoutMs) {
    latest = await collectWorkspaceSettleSnapshot(page, selector);
    sampleCount += 1;
    const idle = latest.rootVisible
      && !latest.navigationBusy
      && !latest.routeHandoffVisible
      && latest.busyCount === 0
      && latest.busyLabels.length === 0
      && latest.text.length > 0;
    stableSamples = idle && latest.text === previousText ? stableSamples + 1 : 0;
    if (stableSamples >= 3) {
      return {
        busyCount: latest.busyCount,
        busyLabels: latest.busyLabels,
        minimumWaitMs,
        passed: true,
        sampleCount,
        stableSamples,
        textLength: latest.text.length,
        textSha256: sha256Buffer(Buffer.from(latest.text, 'utf8')),
      };
    }
    previousText = latest.text;
    await page.waitForTimeout(400);
  }
  fail('Packaged workspace did not reach a stable non-busy state', JSON.stringify({
    ...latest,
    text: undefined,
    sampleCount,
    stableSamples,
  }));
}

async function navigateToWorkspace(page, expected, settleMs) {
  await waitForNavigationIdle(page);
  const button = page.locator('.app-sidebar .nav-item').filter({ hasText: expected.label });
  if (await button.count() !== 1) fail('Expected exactly one sidebar workspace button', expected.label);
  await button.click();
  if (expected.tabLabel) {
    const tab = page.getByRole('tab', { name: decisionsTabAccessibleNamePattern(expected.tabLabel) });
    await tab.waitFor({ state: 'visible', timeout: 10_000 });
    if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
  }
  const selector = `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${expected.subview}"]`;
  await page.locator(selector).waitFor({ state: 'visible', timeout: 15_000 });
  await waitForNavigationIdle(page);
  await page.waitForFunction(() => {
    const content = document.querySelector('.app-content');
    return Boolean(content) && Math.abs(content.scrollTop) <= 1;
  }, undefined, { timeout: 10_000 });
  return waitForWorkspaceSettled(page, selector, settleMs);
}

async function workspaceTabKeyboardSnapshot(page, expected) {
  return page.evaluate((settings) => {
    const root = document.querySelector(
      `[data-workspace-evidence-root][data-workspace="${settings.workspace}"]`,
    );
    const tabs = root
      ? Array.from(root.querySelectorAll(':scope > .workspace-subview-shell__navigation [role="tab"]'))
      : [];
    const subviewFor = (tab) => {
      const prefix = `${settings.workspace}-workspace-tab-`;
      return tab?.id?.startsWith(prefix) ? tab.id.slice(prefix.length) : null;
    };
    const selected = tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true');
    const focused = tabs.find((tab) => tab === document.activeElement) || null;
    return {
      activeSubview: root?.getAttribute('data-workspace-subview') || null,
      focusedSubview: subviewFor(focused),
      selectedCount: selected.length,
      selectedSubview: subviewFor(selected[0] || null),
      tabCount: tabs.length,
    };
  }, expected);
}

async function waitForWorkspaceSubview(page, workspace, subview) {
  const selector = `[data-workspace-evidence-root][data-workspace="${workspace}"][data-workspace-subview="${subview}"]`;
  await page.locator(selector).waitFor({ state: 'visible', timeout: 15_000 });
  await waitForNavigationIdle(page);
}

async function exerciseWorkspaceTabKeyboard(page, expected) {
  const root = page.locator(
    `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${expected.subview}"]`,
  );
  const activeTab = root.locator(':scope > .workspace-subview-shell__navigation [role="tab"][aria-selected="true"]');
  if (await activeTab.count() !== 1) {
    fail('Workspace must expose one selected canonical subview tab before keyboard evidence', expected.workspace);
  }
  await activeTab.focus();
  const initial = await workspaceTabKeyboardSnapshot(page, expected);
  const endSubview = expected.tabs[expected.tabs.length - 1];
  await page.keyboard.press('End');
  await waitForWorkspaceSubview(page, expected.workspace, endSubview);
  const end = await workspaceTabKeyboardSnapshot(page, expected);
  await page.keyboard.press('Home');
  await waitForWorkspaceSubview(page, expected.workspace, expected.subview);
  const restored = await workspaceTabKeyboardSnapshot(page, expected);
  const evidence = validateWorkspaceTabKeyboardEvidence({
    initial,
    end,
    restored,
  }, expected);
  if (!evidence.passed) {
    fail('Workspace canonical subview keyboard evidence failed', `${expected.workspace}: ${JSON.stringify(evidence.violations)}`);
  }
  return evidence;
}

async function navigateToReadOnlySubview(page, expected, settleMs) {
  const defaultWorkspace = EXPECTED_PACKAGE_UI_WORKSPACES.find(
    (workspace) => workspace.workspace === expected.workspace,
  );
  if (!defaultWorkspace) {
    fail('Read-only subview has no canonical workspace navigation entry', `${expected.workspace}/${expected.subview}`);
  }
  await navigateToWorkspace(page, defaultWorkspace, settleMs);
  const root = page.locator(
    `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${defaultWorkspace.subview}"]`,
  );
  const tab = root.locator(`#${expected.tabId}`);
  if (await tab.count() !== 1) {
    fail('Read-only subview must expose one exact canonical tab', `${expected.workspace}/${expected.subview}`);
  }
  await tab.click();
  await waitForWorkspaceSubview(page, expected.workspace, expected.subview);
  await page.waitForFunction(() => {
    const content = document.querySelector('.app-content');
    return Boolean(content) && Math.abs(content.scrollTop) <= 1;
  }, undefined, { timeout: 10_000 });
  const selector = `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${expected.subview}"]`;
  return waitForWorkspaceSettled(page, selector, settleMs);
}

async function collectSchedulerSubviewEvidence(
  page,
  ledgerBefore,
  ledgerAfter,
  expected = EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS[0],
) {
  const dom = await page.evaluate((settings) => {
    const rootSelector = `[data-workspace-evidence-root][data-workspace="${settings.workspace}"][data-workspace-subview="${settings.subview}"]`;
    const roots = Array.from(document.querySelectorAll(rootSelector));
    const root = roots[0] || null;
    const visible = (node) => {
      if (!(node instanceof HTMLElement) || !node.isConnected) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const compactText = (node) => (node?.textContent || '').replace(/\s+/g, ' ').trim();
    const headings = root ? Array.from(root.querySelectorAll('h1')).filter(visible) : [];
    const selectedTabs = root
      ? Array.from(root.querySelectorAll(':scope > .workspace-subview-shell__navigation [role="tab"][aria-selected="true"]')).filter(visible)
      : [];
    const selectedTab = selectedTabs[0] || null;
    const selectedTabState = selectedTab?.querySelector('[data-capability-state]') || null;
    const legacyBoundaries = root
      ? Array.from(root.querySelectorAll('.legacy-adapter-boundary[data-legacy-route="scheduler"]')).filter(visible)
      : [];
    const legacyBoundary = legacyBoundaries[0] || null;
    const pages = root
      ? Array.from(root.querySelectorAll('[data-workspace-page="store-automation"]')).filter(visible)
      : [];
    const retentionControls = root
      ? Array.from(root.querySelectorAll('[data-capability-id="settings.scheduler.retention-preview"]')).filter(visible)
      : [];
    const scheduleRefreshControls = root
      ? Array.from(root.querySelectorAll(
          '[data-action-id="settings.scheduler.refresh"], [data-action-id="settings.scheduler.refresh-secondary"]',
        )).filter(visible)
      : [];
    const scheduleProjections = root
      ? Array.from(root.querySelectorAll('[aria-label="店铺自动化七状态计划"]')).filter(visible)
      : [];
    const retentionSummaries = root
      ? Array.from(root.querySelectorAll('[aria-label="证据保留 dry-run 摘要"]')).filter(visible)
      : [];
    const scheduleProjection = root
      ? Array.from(root.querySelectorAll('.mission-control-automation-window')).find(visible) || null
      : null;
    const retentionSummary = retentionSummaries[0] || null;
    const schedulerErrors = root
      ? Array.from(root.querySelectorAll(
          '.mission-control-store-error[role="alert"], [data-workspace-state="error"]',
        )).filter(visible)
      : [];
    const loadingStates = root
      ? Array.from(root.querySelectorAll(
          '[data-workspace-state="loading"], [data-workspace-state="busy"]',
        )).filter(visible)
      : [];
    const busyControls = root
      ? Array.from(root.querySelectorAll('button[aria-busy="true"]')).filter(visible)
      : [];
    const shell = document.querySelector('.mission-control-shell[data-store-context]');
    const storeSelect = document.querySelector('select[aria-label="切换店铺"]');
    const fixedScope = document.querySelector('.mission-control-fixed-scope');
    const previewMarkers = root
      ? Array.from(root.querySelectorAll('[data-workspace-preview-notice], [data-preview-scenario], [data-readback-mode="preview-readonly"]')).filter(visible)
      : [];
    const dialogs = Array.from(document.querySelectorAll('[role="alertdialog"]')).filter(visible);
    const confirmRunDialogs = Array.from(document.querySelectorAll('#store-automation-confirm-title'))
      .filter((node) => visible(node.closest('[role="alertdialog"]')));
    return {
      alertDialogCount: dialogs.length,
      confirmRunDialogCount: confirmRunDialogs.length,
      fixedScopeText: compactText(fixedScope),
      heading: compactText(headings[0]),
      headingCount: headings.length,
      legacyBoundaryCount: legacyBoundaries.length,
      legacyCapabilityState: legacyBoundary?.getAttribute('data-capability-state') || null,
      legacyRoute: legacyBoundary?.getAttribute('data-legacy-route') || null,
      legacyStoreId: legacyBoundary?.getAttribute('data-store-id') || null,
      pageCount: pages.length,
      previewMarkerCount: previewMarkers.length + (/仅开发预览/.test(document.body?.innerText || '') ? 1 : 0),
      busyControlCount: busyControls.length,
      loadingStateCount: loadingStates.length,
      retentionBlockerCount: retentionSummary?.getAttribute('data-blocker-count') || null,
      retentionCandidateCount: retentionSummary?.getAttribute('data-candidate-count') || null,
      retentionCurrency: retentionSummary?.getAttribute('data-currency') || null,
      retentionMarketplace: retentionSummary?.getAttribute('data-marketplace') || null,
      retentionPreviewCapabilityId: retentionControls[0]?.getAttribute('data-capability-id') || null,
      retentionPreviewControlCount: retentionControls.length,
      retentionPreviewEnabledCount: retentionControls.filter((node) => !node.disabled).length,
      retentionProfileId: retentionSummary?.getAttribute('data-browser-profile-id') || null,
      retentionStoreId: retentionSummary?.getAttribute('data-store-id') || null,
      retentionSummaryCount: retentionSummaries.length,
      rootCount: roots.length,
      scheduleBusinessDate: scheduleProjection?.getAttribute('data-business-date') || null,
      scheduleCurrency: scheduleProjection?.getAttribute('data-currency') || null,
      scheduleEnabled: scheduleProjection?.getAttribute('data-schedule-enabled') || null,
      scheduleMarketplace: scheduleProjection?.getAttribute('data-marketplace') || null,
      scheduleProjectionCount: scheduleProjections.length,
      scheduleRefreshEnabledCount: scheduleRefreshControls.filter((node) => !node.disabled).length,
      scheduleState: scheduleProjection?.getAttribute('data-schedule-state') || null,
      scheduleStoreId: scheduleProjection?.getAttribute('data-store-id') || null,
      schedulerErrorCount: schedulerErrors.length,
      selectedStoreId: storeSelect?.value || null,
      selectedTabCapabilityState: selectedTabState?.getAttribute('data-capability-state') || null,
      selectedTabCount: selectedTabs.length,
      selectedTabId: selectedTab?.id || null,
      shellStoreId: shell?.getAttribute('data-store-context') || null,
      subview: root?.getAttribute('data-workspace-subview') || null,
      workspace: root?.getAttribute('data-workspace') || null,
    };
  }, expected);
  return validateSchedulerSubviewEvidence({
    dom,
    ledgerAfter,
    ledgerBefore,
  }, expected);
}

function isRetryableLoginNavigationError(value) {
  return /execution context was destroyed|most likely because of a navigation/i.test(String(value || ''));
}

function isWorkspaceProbeAbsenceError(error) {
  return error?.name === 'TimeoutError'
    || /locator\.waitFor:\s*Timeout\s+\d+ms\s+exceeded/i.test(String(error?.message || error || ''))
    || isRetryableLoginNavigationError(error?.message || error);
}

async function hasAuthenticatedWorkspace(page, timeoutMs = 0) {
  const workspace = page.locator('nav[aria-label="主业务导航"]');
  const login = page.locator('[data-login-connection-status]');
  try {
    if (timeoutMs > 0) {
      await workspace.waitFor({ state: 'visible', timeout: timeoutMs });
    } else if (!await workspace.isVisible()) {
      return false;
    }
    return !await login.isVisible();
  } catch (error) {
    if (isWorkspaceProbeAbsenceError(error)) return false;
    throw error;
  }
}

function validateLoginSessionAttestation(attestation, mode) {
  const violations = [];
  const allowedKeys = new Set([
    'adsSessionReady',
    'credentialPersistence',
    'credentialSource',
    'erpSessionReady',
    'erpSessionReused',
    'ok',
    'sessionIdentityVerified',
  ]);
  const unexpectedKeys = attestation && typeof attestation === 'object'
    ? Object.keys(attestation).filter((key) => !allowedKeys.has(key))
    : [];
  if (unexpectedKeys.length > 0) {
    violations.push(violation(
      'LOGIN_SESSION_ATTESTATION_UNBOUNDED',
      'The login-session attestation may retain only the fixed non-secret projection.',
      { unexpectedKeys },
    ));
  }
  const commonReady = attestation?.ok === true
    && attestation?.erpSessionReady === true
    && attestation?.adsSessionReady === true
    && typeof attestation?.erpSessionReused === 'boolean'
    && typeof attestation?.sessionIdentityVerified === 'boolean'
    && ['saved', 'typed'].includes(attestation?.credentialSource)
    && ['saved', 'cleared', 'main_managed', 'not_saved_unverified_session']
      .includes(attestation?.credentialPersistence);
  if (!commonReady) {
    violations.push(violation(
      'LOGIN_SESSION_ATTESTATION_NOT_READY',
      'The bounded Main login-session projection must prove both ERP and Ads ready without account, URL, title, or secret fields.',
      attestation ?? null,
    ));
  }

  const verifiedTypedSave = attestation?.credentialSource === 'typed'
    && attestation?.credentialPersistence === 'saved'
    && attestation?.erpSessionReused === false
    && attestation?.sessionIdentityVerified === true;
  const verifiedSavedLogin = attestation?.credentialSource === 'saved'
    && attestation?.credentialPersistence === 'main_managed'
    && attestation?.erpSessionReused === false
    && attestation?.sessionIdentityVerified === true;
  const packageUiSavedReuse = attestation?.credentialSource === 'saved'
    && attestation?.credentialPersistence === 'main_managed'
    && attestation?.erpSessionReused === true
    && attestation?.sessionIdentityVerified === false;
  const validModeProjection = mode === 'interactive-operator-login'
    ? verifiedTypedSave || verifiedSavedLogin || packageUiSavedReuse
    : mode === 'saved-credentials-login'
      ? verifiedSavedLogin || packageUiSavedReuse
      : ['existing-authenticated-session', 'authenticated-during-credential-observation'].includes(mode)
        ? verifiedTypedSave || verifiedSavedLogin || packageUiSavedReuse
        : false;
  if (!validModeProjection) {
    violations.push(violation(
      'LOGIN_SESSION_ATTESTATION_MODE_MISMATCH',
      'The bounded credential source, persistence, session reuse, and identity verification fields contradict the evidence login mode.',
      { attestation: attestation ?? null, mode: mode || null },
    ));
  }
  return {
    attestation,
    mode,
    passed: violations.length === 0,
    violations,
  };
}

async function collectLoginSessionAttestation(page) {
  return page.evaluate(async () => {
    const runtimeState = await window.electronAPI?.getState?.();
    const loginSession = runtimeState?.loginSession;
    return {
      adsSessionReady: loginSession?.adsSessionReady === true,
      credentialPersistence: loginSession?.credentialPersistence ?? null,
      credentialSource: loginSession?.credentialSource ?? null,
      erpSessionReady: loginSession?.erpSessionReady === true,
      erpSessionReused: loginSession?.erpSessionReused === true,
      ok: loginSession?.ok === true && runtimeState?.isLoggedIn === true,
      sessionIdentityVerified: loginSession?.sessionIdentityVerified === true,
    };
  });
}

async function waitForInteractiveAuthenticatedWorkspace(page, timeoutMs) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  do {
    try {
      const workspaceVisible = await page.locator('nav[aria-label="主业务导航"]').isVisible();
      const loginVisible = await page.locator('[data-login-connection-status]').isVisible();
      if (workspaceVisible && !loginVisible) {
        const loginSessionAttestation = await collectLoginSessionAttestation(page);
        if (validateLoginSessionAttestation(
          loginSessionAttestation,
          'interactive-operator-login',
        ).passed) {
          return loginSessionAttestation;
        }
      }
    } catch (error) {
      if (!isWorkspaceProbeAbsenceError(error)) throw error;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return null;
    await page.waitForTimeout(Math.min(500, remainingMs));
  } while (true);
}

function beginLoginDiagnostics(diagnostics) {
  const login = diagnostics?.login;
  if (!login) return null;
  if (!login.startedAt) login.startedAt = new Date().toISOString();
  login.outcome = 'in-progress';
  return login;
}

function completeLoginDiagnostics(login, outcome, extra = {}) {
  if (!login) return;
  login.completedAt = new Date().toISOString();
  login.outcome = outcome;
  Object.assign(login, extra);
}

function beginStoreGateDiagnostics(diagnostics) {
  const storeGate = diagnostics?.storeGate;
  if (!storeGate) return null;
  if (!storeGate.startedAt) storeGate.startedAt = new Date().toISOString();
  storeGate.outcome = 'in-progress';
  return storeGate;
}

function completeStoreGateDiagnostics(storeGate, outcome, extra = {}) {
  if (!storeGate) return;
  storeGate.completedAt = new Date().toISOString();
  storeGate.outcome = outcome;
  Object.assign(storeGate, extra);
}

async function ensureEvidenceLingxingConnection(page, loginDiagnostics) {
  const status = page.locator('[data-login-connection-status]');
  await status.waitFor({ state: 'visible', timeout: 10_000 });
  const startedAt = new Date().toISOString();
  const initialState = await status.getAttribute('data-state');
  if (initialState === 'ready') {
    const evidence = {
      completedAt: new Date().toISOString(),
      outcome: 'existing-lingxing-connection',
      startedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = evidence;
    return evidence;
  }
  if (initialState !== 'missing') {
    const evidence = {
      completedAt: new Date().toISOString(),
      failureMessage: `unexpected visible connection state: ${sanitizeDiagnosticText(initialState || 'none', 80)}`,
      outcome: 'invalid-connection-state',
      startedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = evidence;
    fail(
      'Package login did not expose a bindable or ready Lingxing store connection',
      evidence.failureMessage,
    );
  }

  const bindButton = page.locator(
    '[data-package-ui-evidence-action="bind-lingxing-connection"]',
  );
  await bindButton.waitFor({ state: 'visible', timeout: 10_000 });
  await bindButton.click();
  const outcomeHandle = await page.waitForFunction(() => {
    const status = document.querySelector('[data-login-connection-status]');
    const state = status?.getAttribute('data-state') || null;
    if (state === 'ready') return { kind: 'ready' };
    if (state === 'error') {
      return {
        kind: 'error',
        message: status?.textContent || 'visible Lingxing connection binding failed',
      };
    }
    return null;
  }, undefined, { timeout: 10_000 });
  const outcome = await outcomeHandle.jsonValue();
  if (outcome?.kind !== 'ready') {
    const evidence = {
      completedAt: new Date().toISOString(),
      failureMessage: sanitizeDiagnosticText(
        outcome?.message || 'unknown visible connection binding failure',
        500,
      ),
      outcome: 'binding-failed',
      startedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = evidence;
    fail(
      'Could not bind the isolated evidence store to the visible saved Lingxing account label',
      evidence.failureMessage,
    );
  }
  const evidence = {
    completedAt: new Date().toISOString(),
    outcome: 'bound-isolated-evidence-lingxing-connection',
    startedAt,
  };
  if (loginDiagnostics) loginDiagnostics.connectionBootstrap = evidence;
  return evidence;
}

function selectDeterministicEvidenceStoreCandidate(options) {
  if (!Array.isArray(options)) return null;
  for (const option of options) {
    const value = String(option?.value || '').trim();
    if (!value) continue;
    return {
      label: sanitizeDiagnosticText(option?.label || '', 160),
      value,
    };
  }
  return null;
}

function boundedEvidenceStoreReference(candidate, createdEvidenceStore) {
  if (!candidate?.value) return null;
  return {
    displayName: createdEvidenceStore ? PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME : null,
    idLength: candidate.value.length,
    idSha256: sha256Buffer(Buffer.from(candidate.value, 'utf8')),
  };
}

async function waitForPackageEntrySurface(page, timeoutMs = 30_000) {
  const handle = await page.waitForFunction(() => {
    if (document.querySelector('nav[aria-label="主业务导航"]')) return { kind: 'workspace' };
    if (
      document.querySelector('button.login-submit-button')
      || Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.trim() === '登录并进入 Ads')
    ) {
      return { kind: 'login' };
    }
    const storeGate = document.querySelector('main.mission-control-store-gate');
    if (storeGate?.getAttribute('data-state') === 'needs-selection') {
      return { kind: 'store-gate' };
    }
    if (storeGate?.getAttribute('data-state') === 'error') {
      return {
        kind: 'store-gate-error',
        message: storeGate.querySelector('.mission-control-store-gate__error')?.textContent || '',
      };
    }
    return null;
  }, undefined, { timeout: timeoutMs });
  return handle.jsonValue();
}

async function ensureEvidenceStoreContext(page, diagnostics) {
  const storeGateDiagnostics = beginStoreGateDiagnostics(diagnostics);
  const storeSelect = page.locator('#mission-control-store-select');
  let candidates = [];
  if (await storeSelect.count() > 0) {
    await storeSelect.waitFor({ state: 'visible', timeout: 10_000 });
    candidates = await storeSelect.locator('option').evaluateAll((options) =>
      options.map((option) => ({
        label: option.textContent || '',
        value: option.value || '',
      })));
  }

  let candidate = selectDeterministicEvidenceStoreCandidate(candidates);
  let createdEvidenceStore = false;
  if (!candidate) {
    const storeNameInput = page.locator('#mission-control-store-name');
    const createButton = page.getByRole('button', { name: '创建美国站店铺', exact: true });
    await storeNameInput.waitFor({ state: 'visible', timeout: 10_000 });
    await storeNameInput.fill(PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME);
    await createButton.waitFor({ state: 'visible', timeout: 10_000 });
    await createButton.click();
    const creationHandle = await page.waitForFunction((displayName) => {
      const error = document.querySelector('.mission-control-store-gate__create-form .mission-control-store-gate__error');
      if (error?.textContent?.trim()) {
        return { kind: 'error', message: error.textContent.trim() };
      }
      const options = Array.from(document.querySelectorAll('#mission-control-store-select option'));
      const option = options.find((item) => (
        item.value
        && (item.textContent || '').trim().startsWith(`${displayName} ·`)
      ));
      return option
        ? { kind: 'created', label: option.textContent || '', value: option.value }
        : null;
    }, PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME, { timeout: 15_000 });
    const creation = await creationHandle.jsonValue();
    if (creation?.kind !== 'created') {
      completeStoreGateDiagnostics(storeGateDiagnostics, 'creation-failed', {
        failureMessage: sanitizeDiagnosticText(creation?.message || 'unknown store creation failure', 500),
      });
      fail(
        'Could not create the isolated Package UI evidence store through the visible Store Gate',
        sanitizeDiagnosticText(creation?.message || 'unknown store creation failure', 500),
      );
    }
    candidate = selectDeterministicEvidenceStoreCandidate([creation]);
    createdEvidenceStore = true;
  }
  if (!candidate) {
    completeStoreGateDiagnostics(storeGateDiagnostics, 'selection-failed');
    fail('Store Gate did not expose an active US/USD store for the isolated Package UI profile.');
  }

  const currentStoreSelect = page.locator('#mission-control-store-select');
  await currentStoreSelect.waitFor({ state: 'visible', timeout: 10_000 });
  await currentStoreSelect.selectOption(candidate.value);
  const confirmButton = page.getByRole('button', { name: '进入所选店铺', exact: true });
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.trim() === '进入所选店铺');
    return Boolean(button && !button.disabled);
  }, undefined, { timeout: 10_000 });
  await confirmButton.click();

  const selectedStore = boundedEvidenceStoreReference(candidate, createdEvidenceStore);
  const outcomeHandle = await page.waitForFunction(() => {
    if (document.querySelector('nav[aria-label="主业务导航"]')) return { kind: 'workspace' };
    if (
      document.querySelector('button.login-submit-button')
      || Array.from(document.querySelectorAll('button')).some((button) =>
        button.textContent?.trim() === '登录并进入 Ads')
    ) {
      return { kind: 'login' };
    }
    const storeGate = document.querySelector('main.mission-control-store-gate');
    if (storeGate?.getAttribute('data-state') === 'error') {
      return {
        kind: 'store-gate-error',
        message: storeGate.querySelector('.mission-control-store-gate__error')?.textContent || '',
      };
    }
    return null;
  }, undefined, { timeout: 15_000 });
  const outcome = await outcomeHandle.jsonValue();
  if (outcome?.kind === 'store-gate-error') {
    completeStoreGateDiagnostics(storeGateDiagnostics, 'switch-failed', {
      createdEvidenceStore,
      failureMessage: sanitizeDiagnosticText(outcome.message || 'unknown store switch failure', 500),
      selectedStore,
    });
    fail(
      'Could not enter the explicitly selected isolated Package UI evidence store',
      sanitizeDiagnosticText(outcome.message || 'unknown store switch failure', 500),
    );
  }
  completeStoreGateDiagnostics(
    storeGateDiagnostics,
    createdEvidenceStore
      ? 'created-and-selected-isolated-evidence-store'
      : 'selected-existing-store',
    {
      createdEvidenceStore,
      selectedStore,
      resultingSurface: outcome?.kind || null,
    },
  );
  return {
    createdEvidenceStore,
    currency: 'USD',
    marketplace: 'US',
    outcome: storeGateDiagnostics?.outcome || (
      createdEvidenceStore
        ? 'created-and-selected-isolated-evidence-store'
        : 'selected-existing-store'
    ),
    selectedStore,
  };
}

async function collectEvidenceStoreAuthorityReadback(page, storeGate) {
  const shell = page.locator('.mission-control-shell[data-store-context]');
  await shell.waitFor({ state: 'visible', timeout: 10_000 });
  const storeId = String(await shell.getAttribute('data-store-context') || '').trim();
  const actualIdSha256 = storeId ? sha256Buffer(Buffer.from(storeId, 'utf8')) : null;
  const expectedIdSha256 = storeGate?.selectedStore?.idSha256 || null;
  return {
    actualIdSha256,
    expectedIdSha256,
    marketplace: storeGate?.marketplace || null,
    currency: storeGate?.currency || null,
    passed: Boolean(
      actualIdSha256
      && actualIdSha256 === expectedIdSha256
      && storeGate?.marketplace === 'US'
      && storeGate?.currency === 'USD'
    ),
  };
}

async function ensureAuthenticatedWorkspace(page, options) {
  let entrySurface = await waitForPackageEntrySurface(page);
  if (entrySurface?.kind === 'store-gate-error') {
    fail(
      'Package opened on a failed Store Gate',
      sanitizeDiagnosticText(entrySurface.message || 'unknown store authority failure', 500),
    );
  }
  let storeGate = {
    createdEvidenceStore: false,
    currency: 'USD',
    marketplace: 'US',
    outcome: 'not-required',
    selectedStore: null,
  };
  if (entrySurface?.kind === 'store-gate') {
    setRunDiagnosticPhase(options.diagnostics, 'store-gate');
    storeGate = await ensureEvidenceStoreContext(page, options.diagnostics);
    entrySurface = await waitForPackageEntrySurface(page, 15_000);
  } else {
    completeStoreGateDiagnostics(options.diagnostics?.storeGate, 'not-required');
  }
  if (entrySurface?.kind === 'store-gate-error') {
    fail(
      'Store Gate failed after explicit evidence-profile selection',
      sanitizeDiagnosticText(entrySurface.message || 'unknown store authority failure', 500),
    );
  }
  if (entrySurface?.kind !== 'workspace' && entrySurface?.kind !== 'login') {
    fail(
      'Package did not reach a login or workspace surface after Store Gate handling',
      sanitizeDiagnosticText(entrySurface?.kind || 'unknown entry surface', 160),
    );
  }

  setRunDiagnosticPhase(options.diagnostics, 'login');
  const loginDiagnostics = beginLoginDiagnostics(options.diagnostics);
  if (await hasAuthenticatedWorkspace(page)) {
    if (options.allowInteractiveLogin) {
      completeLoginDiagnostics(loginDiagnostics, 'interactive-login-surface-missing');
      fail(
        'Schema v7 interactive evidence must begin from the visible login surface',
        'The packaged workspace was already authenticated before the operator handoff.',
      );
    }
    const loginSessionAttestation = await collectLoginSessionAttestation(page);
    const attestationContract = validateLoginSessionAttestation(
      loginSessionAttestation,
      'existing-authenticated-session',
    );
    if (!attestationContract.passed) {
      fail(
        'Existing authenticated workspace did not expose a valid bounded Main session attestation',
        JSON.stringify(attestationContract.violations),
      );
    }
    const connectionStartedAt = new Date().toISOString();
    const connectionBootstrap = {
      completedAt: new Date().toISOString(),
      outcome: 'not-required-authenticated-workspace',
      startedAt: connectionStartedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = connectionBootstrap;
    completeLoginDiagnostics(loginDiagnostics, 'existing-authenticated-session');
    return {
      connectionBootstrap,
      loginSessionAttestation,
      mode: 'existing-authenticated-session',
      savedCredentialsLoginUsed: false,
      storeGate,
    };
  }
  if (options.allowInteractiveLogin) {
    await page.locator('[data-login-connection-status]').waitFor({
      state: 'visible',
      timeout: 10_000,
    });
    const operatorHandoff = {
      automationReadSecrets: false,
      automationTypedSecrets: false,
      completedAt: null,
      kind: 'visible-user-handoff',
      outcome: 'waiting-for-user',
      startedAt: new Date().toISOString(),
    };
    if (loginDiagnostics) loginDiagnostics.operatorHandoff = operatorHandoff;
    console.error(
      `[HANDOFF] Packaged UI is waiting up to ${options.interactiveLoginTimeoutMs} ms for the operator `
      + 'to complete the visible connection binding and Lingxing/Amazon Ads login in this isolated profile. '
      + 'The evidence runner will not read, type, click, or retain credentials.',
    );
    const loginSessionAttestation = await waitForInteractiveAuthenticatedWorkspace(
      page,
      options.interactiveLoginTimeoutMs,
    );
    operatorHandoff.completedAt = new Date().toISOString();
    if (!loginSessionAttestation) {
      operatorHandoff.outcome = 'timeout';
      completeLoginDiagnostics(loginDiagnostics, 'interactive-timeout', {
        operatorHandoff,
      });
      fail(
        'Interactive operator login did not prove both ERP and Ads ready before the bounded timeout',
        `${options.interactiveLoginTimeoutMs} ms`,
      );
    }
    const attestationContract = validateLoginSessionAttestation(
      loginSessionAttestation,
      'interactive-operator-login',
    );
    if (!attestationContract.passed) {
      operatorHandoff.outcome = 'invalid-session-attestation';
      completeLoginDiagnostics(loginDiagnostics, 'interactive-session-invalid', {
        operatorHandoff,
      });
      fail(
        'Interactive operator login reached the workspace without a valid bounded Main session attestation',
        JSON.stringify(attestationContract.violations),
      );
    }
    const connectionBootstrap = {
      completedAt: operatorHandoff.completedAt,
      outcome: 'operator-established-lingxing-connection-and-session',
      startedAt: operatorHandoff.startedAt,
    };
    if (loginDiagnostics) loginDiagnostics.connectionBootstrap = connectionBootstrap;
    operatorHandoff.outcome = 'workspace-reached';
    completeLoginDiagnostics(loginDiagnostics, 'interactive-operator-login', {
      operatorHandoff,
    });
    return {
      connectionBootstrap,
      loginSessionAttestation,
      mode: 'interactive-operator-login',
      operatorHandoff,
      savedCredentialsLoginUsed: false,
      storeGate,
    };
  }
  if (!options.allowSavedLogin) {
    completeLoginDiagnostics(loginDiagnostics, 'blocked-login-screen');
    fail(
      'Package opened on the login screen. Re-run with --allow-saved-login for valid saved credentials '
      + 'or --allow-interactive-login for a visible operator handoff.',
    );
  }

  const username = page.locator('input[placeholder="领星用户名"]');
  const password = page.locator('input[placeholder="领星密码"]');
  await username.waitFor({ state: 'visible', timeout: 10_000 });
  await password.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const account = document.querySelector('input[placeholder="领星用户名"]');
    const secret = document.querySelector('input[placeholder="领星密码"]');
    const status = document.querySelector('.login-status-line');
    return Boolean(
      account?.value
      && secret?.getAttribute('data-credential-source') === 'saved'
      && !secret?.value
      && status?.textContent?.includes('本机安全区托管'),
    );
  }, undefined, { timeout: 10_000 }).catch(() => undefined);
  let savedCredentialState;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      savedCredentialState = await page.evaluate(() => ({
        usernameAvailable: Boolean(document.querySelector('input[placeholder="领星用户名"]')?.value),
        passwordInputEmpty: !document.querySelector('input[placeholder="领星密码"]')?.value,
        passwordManagedByMain:
          document.querySelector('input[placeholder="领星密码"]')?.getAttribute('data-credential-source') === 'saved',
        rememberPassword: Boolean(document.querySelector('input[type="checkbox"]')?.checked),
        statusConfirmsMainOnly: Boolean(document.querySelector('.login-status-line')?.textContent?.includes('本机安全区托管')),
      }));
      break;
    } catch (error) {
      if (!isRetryableLoginNavigationError(error?.message || error)) throw error;
      if (await hasAuthenticatedWorkspace(page, 2_000)) {
        const loginSessionAttestation = await collectLoginSessionAttestation(page);
        const attestationContract = validateLoginSessionAttestation(
          loginSessionAttestation,
          'authenticated-during-credential-observation',
        );
        if (!attestationContract.passed) {
          fail(
            'Authenticated workspace reached during credential observation without a valid bounded Main session attestation',
            JSON.stringify(attestationContract.violations),
          );
        }
        const connectionStartedAt = new Date().toISOString();
        const connectionBootstrap = {
          completedAt: new Date().toISOString(),
          outcome: 'not-required-workspace-authenticated-during-observation',
          startedAt: connectionStartedAt,
        };
        if (loginDiagnostics) loginDiagnostics.connectionBootstrap = connectionBootstrap;
        completeLoginDiagnostics(loginDiagnostics, 'authenticated-during-credential-observation', {
          savedCredentials: savedCredentialState || null,
        });
        return {
          connectionBootstrap,
          loginSessionAttestation,
          mode: 'authenticated-during-credential-observation',
          savedCredentialsLoginUsed: false,
          savedCredentialState: savedCredentialState || null,
          storeGate,
        };
      }
      if (attempt === 3) throw error;
      await page.waitForTimeout(500);
    }
  }
  if (
    !savedCredentialState.usernameAvailable
    || !savedCredentialState.passwordInputEmpty
    || !savedCredentialState.passwordManagedByMain
    || !savedCredentialState.rememberPassword
    || !savedCredentialState.statusConfirmsMainOnly
  ) {
    completeLoginDiagnostics(loginDiagnostics, 'saved-credentials-incomplete', {
      savedCredentials: savedCredentialState,
    });
    fail('Saved credential status is incomplete; package UI evidence requires Main-managed login and refuses to read or type secrets.');
  }
  if (loginDiagnostics) loginDiagnostics.savedCredentials = savedCredentialState;
  const connectionBootstrap = await ensureEvidenceLingxingConnection(page, loginDiagnostics);

  const loginButton = page.getByRole('button', { name: '登录并进入 Ads', exact: true });
  let lastLoginError = 'no visible login error';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptEvidence = {
      attempt,
      completedAt: null,
      message: null,
      outcome: 'in-progress',
      retryable: false,
      startedAt: new Date().toISOString(),
    };
    loginDiagnostics?.attempts.push(attemptEvidence);
    await loginButton.waitFor({ state: 'visible', timeout: 10_000 });
    await loginButton.click();
    await page.waitForTimeout(250);
    try {
      const outcome = await page.waitForFunction(() => {
        if (document.querySelector('nav[aria-label="主业务导航"]')) return { kind: 'workspace' };
        const bodyText = document.body?.innerText || '';
        if (/execution context was destroyed|most likely because of a navigation/i.test(bodyText)) {
          return { kind: 'retryable-navigation' };
        }
        return null;
      }, undefined, { timeout: options.loginTimeoutMs });
      const value = await outcome.jsonValue();
      if (value?.kind === 'workspace') {
        attemptEvidence.outcome = 'workspace-reached';
        attemptEvidence.completedAt = new Date().toISOString();
        break;
      }
      lastLoginError = 'saved-session browser navigation replaced its execution context';
      attemptEvidence.outcome = 'retryable-navigation';
      attemptEvidence.retryable = true;
      attemptEvidence.message = sanitizeDiagnosticText(lastLoginError, 500);
      attemptEvidence.completedAt = new Date().toISOString();
      if (attempt < 2) {
        await page.waitForTimeout(1_000);
        continue;
      }
    } catch (error) {
      if (await hasAuthenticatedWorkspace(page, 2_000)) {
        attemptEvidence.outcome = 'workspace-reached-after-navigation';
        attemptEvidence.completedAt = new Date().toISOString();
        break;
      }
      lastLoginError = await page.locator('[role="alert"]').first().innerText().catch(() => String(error?.message || error));
      attemptEvidence.message = sanitizeDiagnosticText(lastLoginError, 500);
      attemptEvidence.retryable = isRetryableLoginNavigationError(lastLoginError);
      attemptEvidence.outcome = attemptEvidence.retryable ? 'retryable-navigation' : 'failed';
      attemptEvidence.completedAt = new Date().toISOString();
      if (attempt < 2 && isRetryableLoginNavigationError(lastLoginError)) {
        await page.waitForTimeout(1_000);
        continue;
      }
    }
    completeLoginDiagnostics(loginDiagnostics, 'failed', {
      failureMessage: sanitizeDiagnosticText(lastLoginError, 500),
    });
    fail('Saved-credential session establishment did not reach the workspace shell', lastLoginError.slice(0, 500));
  }
  if (!await hasAuthenticatedWorkspace(page)) {
    completeLoginDiagnostics(loginDiagnostics, 'failed', {
      failureMessage: sanitizeDiagnosticText(lastLoginError, 500),
    });
    fail('Saved-credential session establishment did not reach the workspace shell', lastLoginError.slice(0, 500));
  }
  const loginSessionAttestation = await collectLoginSessionAttestation(page);
  const attestationContract = validateLoginSessionAttestation(
    loginSessionAttestation,
    'saved-credentials-login',
  );
  if (!attestationContract.passed) {
    completeLoginDiagnostics(loginDiagnostics, 'failed', {
      failureMessage: 'bounded Main session attestation did not match saved-login mode',
    });
    fail(
      'Saved-credential session reached the workspace without a valid bounded Main session attestation',
      JSON.stringify(attestationContract.violations),
    );
  }
  completeLoginDiagnostics(loginDiagnostics, 'saved-credentials-login');
  return {
    loginSessionAttestation,
    mode: 'saved-credentials-login',
    savedCredentialsLoginUsed: true,
    savedCredentialState,
    storeGate,
    connectionBootstrap,
  };
}

function firstInteractiveLoginAttestationPassed(attestation) {
  return attestation?.ok === true
    && attestation?.erpSessionReady === true
    && attestation?.adsSessionReady === true
    && attestation?.credentialSource === 'typed'
    && attestation?.credentialPersistence === 'saved'
    && attestation?.erpSessionReused === false
    && attestation?.sessionIdentityVerified === true;
}

async function elementDescriptor(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof Element)) return null;
    return {
      ariaLabel: element.getAttribute('aria-label'),
      evidenceBoundary: element.getAttribute('data-package-ui-focus-boundary'),
      evidenceTrigger: element.getAttribute('data-package-ui-evidence-trigger'),
      id: element.id || null,
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    };
  });
}

async function overlayElementDescriptor(page, dialog) {
  const descriptor = await elementDescriptor(page);
  const insideDialog = await dialog.evaluate((node) => node.contains(document.activeElement));
  return descriptor ? { ...descriptor, insideDialog } : { insideDialog };
}

async function exerciseOverlayFocus(page, options) {
  const trigger = options.trigger;
  const triggerCount = await trigger.count();
  const triggerState = triggerCount === 1
    ? await trigger.evaluate((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        actionId: node.getAttribute('data-action-id'),
        ariaDisabled: node.getAttribute('aria-disabled'),
        disabled: node.matches(':disabled'),
        rendered: style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0,
        tagName: node.tagName.toLowerCase(),
      };
    })
    : {};
  const triggerContract = validateOverlayTriggerContract({
    ...triggerState,
    expectedActionId: options.expectedActionId,
    triggerCount,
  });
  if (!triggerContract.passed) {
    fail('Overlay trigger failed the read-only pre-click contract', `${options.id}: ${JSON.stringify(triggerContract.violations)}`);
  }
  const triggerMarker = `${options.id}-${options.scalePercent}`;
  await trigger.evaluate((node, marker) => node.setAttribute('data-package-ui-evidence-trigger', marker), triggerMarker);
  await trigger.focus();
  const triggerBefore = await elementDescriptor(page);
  await trigger.click();
  const dialog = options.dialogLocator
    || page.getByRole('dialog', { name: options.dialogName, exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  if (await dialog.count() !== 1) fail('Expected exactly one named overlay dialog', options.id);
  await page.waitForTimeout(80);
  const initialFocus = await elementDescriptor(page);
  const overlayState = await dialog.evaluate((node, focusableSelector) => {
    const rendered = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.matches(':disabled')
        && element.getAttribute('aria-disabled') !== 'true'
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    const focusables = Array.from(node.querySelectorAll(focusableSelector)).filter(rendered);
    focusables.forEach((element) => element.removeAttribute('data-package-ui-focus-boundary'));
    if (focusables.length === 1) {
      focusables[0].setAttribute('data-package-ui-focus-boundary', 'single');
    } else {
      focusables[0]?.setAttribute('data-package-ui-focus-boundary', 'first');
      focusables[focusables.length - 1]?.setAttribute('data-package-ui-focus-boundary', 'last');
    }
    const idCounts = new Map();
    for (const element of Array.from(document.querySelectorAll('[id]'))) {
      if (!element.id) continue;
      idCounts.set(element.id, (idCounts.get(element.id) || 0) + 1);
    }
    const duplicateIds = Array.from(idCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count }));
    const brokenReferences = [];
    const referenceAttributes = [
      'aria-labelledby',
      'aria-describedby',
      'aria-controls',
      'aria-owns',
      'aria-flowto',
      'aria-activedescendant',
    ];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      for (const attribute of referenceAttributes) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        for (const token of value.trim().split(/\s+/).filter(Boolean)) {
          const count = idCounts.get(token) || 0;
          if (count !== 1) brokenReferences.push({ attribute, token, count });
        }
      }
    }
    return {
      ariaModal: node.getAttribute('aria-modal'),
      brokenReferences,
      duplicateIds,
      focusableCount: focusables.length,
      initialFocusInside: node.contains(document.activeElement),
      inspectorMode: node.getAttribute('data-inspector-mode'),
    };
  }, OVERLAY_FOCUSABLE_SELECTOR);
  if (!overlayState.initialFocusInside) fail('Overlay did not move initial focus inside', options.id);
  if (overlayState.focusableCount === 0) fail('Overlay exposes no enabled focusable control for keyboard evidence', options.id);
  if (overlayState.ariaModal !== 'true') fail('Overlay is not aria-modal', options.id);
  if (overlayState.duplicateIds.length > 0) fail('Overlay introduced duplicate DOM ids', `${options.id}: ${JSON.stringify(overlayState.duplicateIds)}`);
  if (overlayState.brokenReferences.length > 0) fail('Overlay introduced broken ARIA references', `${options.id}: ${JSON.stringify(overlayState.brokenReferences)}`);
  if (options.expectedInspectorMode && overlayState.inspectorMode !== options.expectedInspectorMode) {
    fail('Responsive inspector mode mismatch', `${options.id}: ${overlayState.inspectorMode}`);
  }

  let keyboardStartFocus;
  let backwardFocus;
  let forwardFocus;
  if (overlayState.focusableCount === 1) {
    const singleControl = dialog.locator('[data-package-ui-focus-boundary="single"]');
    if (await singleControl.count() !== 1) fail('Single-control overlay boundary marker is missing or ambiguous', options.id);
    await singleControl.focus();
    keyboardStartFocus = await overlayElementDescriptor(page, dialog);
    await page.keyboard.press('Shift+Tab');
    backwardFocus = await overlayElementDescriptor(page, dialog);
    await page.keyboard.press('Tab');
    forwardFocus = await overlayElementDescriptor(page, dialog);
  } else {
    await dialog.locator('[data-package-ui-focus-boundary="first"]').focus();
    keyboardStartFocus = await overlayElementDescriptor(page, dialog);
    await page.keyboard.press('Shift+Tab');
    backwardFocus = await overlayElementDescriptor(page, dialog);

    await dialog.locator('[data-package-ui-focus-boundary="last"]').focus();
    await page.keyboard.press('Tab');
    forwardFocus = await overlayElementDescriptor(page, dialog);
  }
  const keyboardEvidence = validateOverlayKeyboardEvidence({
    backwardFocus,
    focusableCount: overlayState.focusableCount,
    forwardFocus,
  });
  if (!keyboardEvidence.passed) {
    fail('Overlay keyboard focus contract failed', `${options.id}: ${JSON.stringify(keyboardEvidence.violations)}`);
  }
  const backwardWrapped = keyboardEvidence.multiControlEvidence?.backwardWrapped ?? null;
  const forwardWrapped = keyboardEvidence.multiControlEvidence?.forwardWrapped ?? null;
  const singleControlEvidence = keyboardEvidence.mode === 'single-control'
    ? {
      ...keyboardEvidence.singleControlEvidence,
      focusBeforeKeys: keyboardStartFocus,
      shiftTabFocus: backwardFocus,
      tabFocus: forwardFocus,
    }
    : null;

  const requiredContent = [];
  for (const text of options.requiredTexts || []) {
    const matches = dialog.getByText(text, { exact: true });
    const count = await matches.count();
    requiredContent.push({ text, count });
    if (count < 1) fail('Required overlay content is missing', `${options.id}: ${text}`);
  }
  if (options.screenshotAnchor) {
    if (await options.screenshotAnchor.count() !== 1) {
      fail('Expected exactly one screenshot anchor in overlay', options.id);
    }
    await options.screenshotAnchor.scrollIntoViewIfNeeded();
  }

  const compositeEvidence = await waitForRendererComposite(page, options.electronApp, dialog);
  const overlayVisibleBeforeCapture = await dialog.isVisible();
  if (!overlayVisibleBeforeCapture) fail('Overlay disappeared before screenshot capture', options.id);
  const screenshotPath = path.join(options.runDir, `${options.scalePercent}-${safeSegment(options.id)}.png`);
  const screenshotCapture = await captureViewportScreenshot(options.electronApp, screenshotPath);
  const overlayVisibleAfterCapture = await dialog.isVisible();
  if (!overlayVisibleAfterCapture) fail('Overlay disappeared during screenshot capture', options.id);
  const screenshot = screenshotRecord(screenshotPath, {
    capture: screenshotCapture,
    overlayId: options.id,
  });

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 10_000 }).catch(async () => {
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const focusAfterEscape = await elementDescriptor(page);
  const focusRestored = focusAfterEscape?.evidenceTrigger === triggerMarker;
  if (!focusRestored) fail('Escape did not restore focus to the overlay trigger', options.id);
  await page.locator(`[data-package-ui-evidence-trigger="${triggerMarker}"]`).evaluate((node) => {
    node.removeAttribute('data-package-ui-evidence-trigger');
  }).catch(() => undefined);

  return {
    id: options.id,
    passed: true,
    triggerContract,
    triggerState,
    triggerBefore,
    initialFocus,
    overlayState,
    requiredContent,
    keyboardMode: keyboardEvidence.mode,
    keyboardStartFocus,
    backwardFocus,
    backwardWrapped,
    forwardFocus,
    forwardWrapped,
    singleControlEvidence,
    focusAfterEscape,
    focusRestored,
    compositeEvidence,
    overlayVisibleAfterCapture,
    overlayVisibleBeforeCapture,
    screenshot,
  };
}

async function collectVisibleAiRunState(page) {
  return page.evaluate(() => {
    const node = document.querySelector('[data-ai-run-status-visible="true"]');
    if (!node) return { ariaBusy: false, observed: false, statusLabel: null, text: '', tone: null };
    const rendered = (() => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })();
    return {
      ariaBusy: node.getAttribute('aria-busy') === 'true',
      observed: rendered,
      statusLabel: (node.querySelector('.diagnosis-ai-run-inline__state')?.textContent || '').replace(/\s+/g, ' ').trim() || null,
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      tone: node.getAttribute('data-ai-run-tone'),
    };
  });
}

async function collectObjectQueueCapacityMetrics(page, rootSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const queue = root?.querySelector('[data-workspace-queue-scroll]') || null;
    const table = queue?.querySelector('[aria-rowcount]') || null;
    const header = queue?.querySelector('[data-workspace-queue-header]') || null;
    const status = queue?.querySelector('.virtual-table-status') || null;
    const rows = queue ? Array.from(queue.querySelectorAll('[data-workspace-row]')) : [];
    const rowHeights = rows
      .map((row) => row.getBoundingClientRect().height)
      .filter((height) => Number.isFinite(height) && height > 0);
    const rowHeightPx = rowHeights.length > 0 ? Math.max(...rowHeights) : null;
    const clientHeight = queue?.clientHeight || 0;
    const headerHeightPx = header?.getBoundingClientRect().height || 0;
    const statusHeightPx = status?.getBoundingClientRect().height || 0;
    const availableRowViewportHeightPx = Math.max(0, clientHeight - headerHeightPx - statusHeightPx);
    const ariaRowCount = Number.parseInt(table?.getAttribute('aria-rowcount') || '', 10);
    return {
      allRowsFit: Number.isInteger(ariaRowCount)
        && ariaRowCount >= 1
        && rowHeightPx !== null
        && ariaRowCount <= Math.floor(availableRowViewportHeightPx / rowHeightPx),
      ariaRowCount: Number.isInteger(ariaRowCount) ? ariaRowCount : null,
      availableRowViewportHeightPx,
      clientHeight,
      headerHeightPx,
      rowHeightPx,
      scrollHeight: queue?.scrollHeight || 0,
      scrollable: Boolean(queue && queue.scrollHeight > queue.clientHeight + 1),
      statusHeightPx,
      visibleRowCapacity: rowHeightPx === null ? 0 : Math.floor(availableRowViewportHeightPx / rowHeightPx),
    };
  }, rootSelector);
}

function adaptiveObjectExperienceContract(baseContract, capacity) {
  const ariaRowCount = Math.max(1, Number(capacity?.ariaRowCount) || 1);
  return {
    ...baseContract,
    minAriaRowCount: 1,
    minFullyVisibleRows: Math.min(baseContract.minFullyVisibleRows, ariaRowCount),
  };
}

async function readOperationScope(page) {
  return page.evaluate(async () => {
    const api = window.electronAPI;
    if (!api || typeof api.getOperationScope !== 'function') return null;
    return api.getOperationScope();
  });
}

async function exerciseObjectInspector(page, options) {
  const workspaceRoot = page.locator(
    `[data-workspace-evidence-root][data-workspace="${options.workspace.workspace}"][data-workspace-subview="${options.workspace.subview}"]`,
  );
  const rows = workspaceRoot.locator('[data-workspace-row]');
  if (await rows.count() < 1) fail('Object workspace has no selectable virtual row', options.workspace.workspace);
  let row = rows.first();
  if (options.workspace.workspace === 'product') {
    const unlockedRows = rows.filter({ hasText: '仅查看' });
    if (await unlockedRows.count() > 0) row = unlockedRows.first();
  }
  await row.scrollIntoViewIfNeeded();
  const rowBefore = await row.evaluate((node) => ({
    ariaLabel: node.getAttribute('aria-label'),
    key: node.getAttribute('data-row-key'),
    title: (node.querySelector('.virtual-table-cell strong')?.textContent || '').replace(/\s+/g, ' ').trim(),
  }));
  if (!rowBefore.key || !rowBefore.title) fail('Selectable object row lacks a stable key or title', JSON.stringify(rowBefore));
  const operationScopeBefore = options.workspace.workspace === 'product' ? await readOperationScope(page) : undefined;
  if (options.workspace.workspace === 'product' && !operationScopeBefore) {
    fail('Product read-only evidence could not read operation scope before row selection.');
  }
  await row.focus();
  await row.press('Enter');
  const inspector = page.locator(`.responsive-inspector[data-inspector-mode="${options.expectedMode}"]`);
  await inspector.waitFor({ state: 'visible', timeout: 10_000 });
  const inspectorState = await inspector.evaluate((node) => ({
    ariaModal: node.getAttribute('aria-modal'),
    description: (node.querySelector('.responsive-inspector__description')?.textContent || '').replace(/\s+/g, ' ').trim(),
    mode: node.getAttribute('data-inspector-mode'),
    role: node.getAttribute('role'),
    title: (node.querySelector('h2')?.textContent || '').replace(/\s+/g, ' ').trim(),
    visible: true,
  }));
  const selectedAfterClick = await row.getAttribute('aria-selected') === 'true';
  const screenshotPath = path.join(
    options.runDir,
    `${safeSegment(options.profileId)}-${safeSegment(options.workspace.workspace)}-row-inspector.png`,
  );
  const screenshotCapture = await captureViewportScreenshot(options.electronApp, screenshotPath);
  const screenshot = screenshotRecord(screenshotPath, {
    capture: screenshotCapture,
    inspectorMode: options.expectedMode,
    kind: 'read-only-object-inspector',
    profileId: options.profileId,
    workspace: options.workspace.workspace,
  });
  await page.keyboard.press('Escape');
  await inspector.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.waitForFunction((rowKey) => (
    document.activeElement?.getAttribute('data-row-key') === rowKey
  ), rowBefore.key, { timeout: 10_000 });
  const focusedRowKey = await page.evaluate(() => document.activeElement?.getAttribute('data-row-key') || null);
  const operationScopeAfter = options.workspace.workspace === 'product' ? await readOperationScope(page) : undefined;
  const input = {
    escape: {
      closed: await inspector.count() === 0 || !(await inspector.isVisible().catch(() => false)),
      focusRestored: focusedRowKey === rowBefore.key,
      focusedRowKey,
    },
    expectedMode: options.expectedMode,
    inspector: inspectorState,
    operationScope: options.workspace.workspace === 'product'
      ? { before: operationScopeBefore, after: operationScopeAfter }
      : undefined,
    row: { ...rowBefore, selectedAfterClick },
    screenshot,
    workspace: options.workspace.workspace,
  };
  const evidence = validateObjectInspectorEvidence(input);
  if (!evidence.passed) fail('Read-only object inspector evidence failed', JSON.stringify(evidence.violations));
  return evidence;
}

async function runOverlayChecks(page, runOptions) {
  const collection = EXPECTED_PACKAGE_UI_WORKSPACES.find((item) => item.workspace === 'collection');
  await navigateToWorkspace(page, collection, runOptions.settleMs);
  await page.getByRole('tab', { name: /采集任务/ }).click();
  const reportRootSelector = '[data-workspace-evidence-root][data-workspace="collection"][data-workspace-subview="reports"]';
  await page.locator(reportRootSelector).waitFor({ state: 'visible', timeout: 10_000 });
  await waitForWorkspaceSettled(page, reportRootSelector, runOptions.settleMs);
  const reportCheck = await exerciseOverlayFocus(page, {
    dialogName: '调整本次下载/重建的报表',
    electronApp: runOptions.electronApp,
    id: 'report-selector-dialog',
    runDir: runOptions.runDir,
    scalePercent: runOptions.scalePercent,
    trigger: page.getByRole('button', { name: '调整', exact: true }),
  });

  const decisions = EXPECTED_PACKAGE_UI_WORKSPACES.find((item) => item.workspace === 'decisions');
  await navigateToWorkspace(page, decisions, runOptions.settleMs);
  await page.getByRole('tab', { name: decisionsTabAccessibleNamePattern('待判断') }).click();
  const recommendationsRootSelector = '[data-workspace-evidence-root][data-workspace="decisions"][data-workspace-subview="recommendations"]';
  await page.locator(recommendationsRootSelector).waitFor({ state: 'visible', timeout: 10_000 });
  await waitForWorkspaceSettled(page, recommendationsRootSelector, runOptions.settleMs);
  const decisionsCheck = await exerciseOverlayFocus(page, {
    dialogLocator: page.locator('.responsive-inspector[role="dialog"]'),
    electronApp: runOptions.electronApp,
    expectedActionId: 'open-controlled-review-inspector',
    expectedInspectorMode: 'drawer',
    id: 'decisions-controlled-review-inspector',
    requiredTexts: [
      '确认受控复核',
      '此操作只会把建议从“需复核”恢复为“待审批”，不会批准建议，也不会执行 Ads 动作。',
      'Ads 对象 ID',
      '来源文件',
      '唯一来源行',
      '身份核验证据路径',
      '身份核验说明',
    ],
    runDir: runOptions.runDir,
    scalePercent: runOptions.scalePercent,
    screenshotAnchor: page.locator('#decisions-inspector-form-title'),
    trigger: page.locator('[data-workspace="decisions"] .task-banner [data-action-id="open-controlled-review-inspector"]'),
  });

  const execution = EXPECTED_PACKAGE_UI_WORKSPACES.find((item) => item.workspace === 'execution');
  await navigateToWorkspace(page, execution, runOptions.settleMs);
  await page.getByRole('tab', { name: /执行回读/ }).click();
  const readbackRootSelector = '[data-workspace-evidence-root][data-workspace="execution"][data-workspace-subview="evidence"]';
  await page.locator(readbackRootSelector).waitFor({ state: 'visible', timeout: 10_000 });
  await waitForWorkspaceSettled(page, readbackRootSelector, runOptions.settleMs);
  const readbackCheck = await exerciseOverlayFocus(page, {
    dialogName: '技术与证据详情',
    electronApp: runOptions.electronApp,
    expectedInspectorMode: 'drawer',
    id: 'readback-technical-drawer',
    runDir: runOptions.runDir,
    scalePercent: runOptions.scalePercent,
    trigger: page.getByRole('button', { name: '查看技术与证据详情', exact: true }),
  });
  return [reportCheck, decisionsCheck, readbackCheck];
}

async function collectElectronIdentity(electronApp, page) {
  const mainIdentity = await electronApp.evaluate(
    ({ app }, envKeys) => ({
      appName: app.getName(),
      appPath: app.getAppPath(),
      appVersion: app.getVersion(),
      actualExecutablePath: process.execPath,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      actualUserDataDir: app.getPath('userData'),
      evidenceMode: process.env[envKeys.evidenceMode] || null,
      requestedUserDataDir: process.env[envKeys.userDataDir] || null,
    }),
    {
      evidenceMode: EVIDENCE_MODE_ENV,
      userDataDir: EVIDENCE_USER_DATA_DIR_ENV,
    },
  );
  return {
    ...mainIdentity,
    rendererTitle: await page.title(),
    rendererUrl: page.url(),
  };
}

function readPackageUiSchedulerAudit(userDataDir) {
  const filePath = path.join(userDataDir, PACKAGE_UI_SCHEDULER_AUDIT_FILE);
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

const PACKAGE_UI_DATABASE_CHECKPOINT_PHASES = [
  'post-bootstrap',
  'post-navigation',
  'pre-close-terminal',
];
const PACKAGE_UI_DATABASE_METRIC_KEYS = [
  'digestSha256',
  'serializedBytes',
  'totalChanges',
  'dataVersion',
  'pageCount',
  'pageSize',
  'schemaVersion',
  'userVersion',
];
const PACKAGE_UI_DATABASE_COMPARISON_KEYS = [
  'contextDigestMatched',
  'digestMatched',
  'serializedBytesMatched',
  'totalChangesMatched',
  'dataVersionMatched',
  'pageCountMatched',
  'pageSizeMatched',
  'schemaVersionMatched',
  'userVersionMatched',
];

function exactObjectKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function derivePackageUiDatabaseComparisons(checkpoints) {
  const baseline = checkpoints?.[0]?.metrics;
  const allCheckpointsMatch = (key) => baseline
    && checkpoints?.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
    ? checkpoints.every((checkpoint) => checkpoint?.metrics?.[key] === baseline[key])
    : null;
  return {
    contextDigestMatched: checkpoints?.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
      ? checkpoints.every(
          (checkpoint) => checkpoint?.contextDigestSha256 === checkpoints[0]?.contextDigestSha256,
        )
      : null,
    digestMatched: allCheckpointsMatch('digestSha256'),
    serializedBytesMatched: allCheckpointsMatch('serializedBytes'),
    totalChangesMatched: allCheckpointsMatch('totalChanges'),
    dataVersionMatched: allCheckpointsMatch('dataVersion'),
    pageCountMatched: allCheckpointsMatch('pageCount'),
    pageSizeMatched: allCheckpointsMatch('pageSize'),
    schemaVersionMatched: allCheckpointsMatch('schemaVersion'),
    userVersionMatched: allCheckpointsMatch('userVersion'),
  };
}

function validatePackageUiDatabaseMutationAudit(audit) {
  const violations = [];
  if (!exactObjectKeys(audit, [
    'kind',
    'schemaVersion',
    'requiredPhases',
    'checkpoints',
    'comparisons',
    'passed',
  ]) || audit?.kind !== 'package-ui-database-mutation-audit' || audit?.schemaVersion !== 1) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_AUDIT_INVALID',
      'The Main database mutation audit has missing, extra, or invalid top-level fields.',
      audit ?? null,
    ));
    return { audit, passed: false, violations };
  }
  if (canonicalJson(audit.requiredPhases) !== canonicalJson(PACKAGE_UI_DATABASE_CHECKPOINT_PHASES)) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_AUDIT_PHASE_CONTRACT_INVALID',
      'The database mutation audit must declare post-bootstrap, post-navigation, then Main pre-close-terminal order.',
      audit.requiredPhases,
    ));
  }
  const checkpoints = Array.isArray(audit.checkpoints) ? audit.checkpoints : [];
  if (checkpoints.length !== PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_AUDIT_CHECKPOINT_COUNT_INVALID',
      'The database mutation audit must contain exactly three checkpoints.',
      checkpoints,
    ));
  }
  checkpoints.forEach((checkpoint, index) => {
    const metrics = checkpoint?.metrics;
    if (
      !exactObjectKeys(checkpoint, [
        'sequence',
        'phase',
        'capturedAt',
        'contextDigestSha256',
        'metrics',
      ])
      || checkpoint.sequence !== index + 1
      || checkpoint.phase !== PACKAGE_UI_DATABASE_CHECKPOINT_PHASES[index]
      || !Number.isFinite(Date.parse(checkpoint.capturedAt || ''))
      || !/^[A-F0-9]{64}$/.test(String(checkpoint.contextDigestSha256 || ''))
      || !exactObjectKeys(metrics, PACKAGE_UI_DATABASE_METRIC_KEYS)
      || !/^[A-F0-9]{64}$/.test(String(metrics?.digestSha256 || ''))
      || PACKAGE_UI_DATABASE_METRIC_KEYS
        .filter((key) => key !== 'digestSha256')
        .some((key) => !Number.isSafeInteger(metrics?.[key]) || metrics[key] < 0)
    ) {
      violations.push(violation(
        'PACKAGE_UI_DATABASE_AUDIT_CHECKPOINT_INVALID',
        'A database checkpoint is malformed, reordered, or contains unapproved fields.',
        checkpoint ?? null,
      ));
    }
  });
  const derivedComparisons = derivePackageUiDatabaseComparisons(checkpoints);
  const ordered = checkpoints.length === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
    && checkpoints.every((checkpoint, index) => (
      checkpoint?.sequence === index + 1
      && checkpoint?.phase === PACKAGE_UI_DATABASE_CHECKPOINT_PHASES[index]
    ));
  const derivedPassed = ordered
    && Object.values(derivedComparisons).every((value) => value === true);
  if (
    !exactObjectKeys(audit.comparisons, PACKAGE_UI_DATABASE_COMPARISON_KEYS)
    || canonicalJson(audit.comparisons) !== canonicalJson(derivedComparisons)
    || audit.passed !== derivedPassed
  ) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_AUDIT_DERIVATION_INVALID',
      'Database comparison and pass fields must be derived exactly from checkpoint metrics.',
      {
        actualComparisons: audit.comparisons ?? null,
        actualPassed: audit.passed,
        derivedComparisons,
        derivedPassed,
      },
    ));
  }
  if (!derivedPassed) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_MUTATION_DETECTED',
      'The live isolated SQLite database changed after allowed bootstrap completed.',
      derivedComparisons,
    ));
  }
  return {
    audit,
    comparisons: derivedComparisons,
    passed: violations.length === 0,
    violations,
  };
}

function validatePackageUiDatabaseCheckpointReceipts(receipts, runtimeEvidence) {
  const violations = [];
  const markerCheckpoints = runtimeEvidence?.marker?.databaseMutationAudit?.checkpoints;
  if (!exactObjectKeys(receipts, ['postBootstrap', 'postNavigation'])) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_CHECKPOINT_RECEIPTS_INVALID',
      'The runner must retain exactly the Main-issued post-bootstrap and post-navigation receipts.',
      receipts ?? null,
    ));
  }
  if (
    !Array.isArray(markerCheckpoints)
    || markerCheckpoints.length !== PACKAGE_UI_DATABASE_CHECKPOINT_PHASES.length
    || canonicalJson(receipts?.postBootstrap) !== canonicalJson(markerCheckpoints[0])
    || canonicalJson(receipts?.postNavigation) !== canonicalJson(markerCheckpoints[1])
  ) {
    violations.push(violation(
      'PACKAGE_UI_DATABASE_CHECKPOINT_RECEIPTS_NOT_BOUND',
      'Renderer-held database checkpoint receipts must match the ordered checkpoints copied from Main.',
      {
        markerCheckpoints: markerCheckpoints ?? null,
        receipts: receipts ?? null,
      },
    ));
  }
  return {
    passed: violations.length === 0,
    receipts: receipts ?? null,
    terminalCheckpoint: markerCheckpoints?.[2] ?? null,
    violations,
  };
}

function validatePackageUiReadOnlyRuntimeEvidence(input, options = {}) {
  const violations = [];
  const requireSchedulerReads = options.requireSchedulerReads === true;
  violations.push(...packageUiSchedulerAuditSnapshotViolations(
    input?.marker,
    'The copied Main scheduler audit',
  ));
  const databaseMutationAudit = validatePackageUiDatabaseMutationAudit(
    input?.marker?.databaseMutationAudit,
  );
  violations.push(...databaseMutationAudit.violations);
  if (input?.processExitConfirmed !== true) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_PROCESS_EXIT_UNCONFIRMED',
      'The Main runtime attestation may only be copied after packaged Electron has exited.',
      input?.processExitConfirmed ?? null,
    ));
  }
  if (
    input?.main?.pid !== input?.marker?.pid
    || input?.main?.evidenceMode !== PACKAGE_UI_EVIDENCE_MODE
    || normalizedWindowsPath(input?.main?.userDataDir || '')
      !== normalizedWindowsPath(input?.marker?.userDataDir || '')
  ) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_IDENTITY_MISMATCH',
      'The live Main PID, evidence mode, and isolated userData identity must match the marker.',
      { main: input?.main ?? null, marker: input?.marker ?? null },
    ));
  }
  const counts = packageUiSchedulerAuditCounts(input?.marker?.counts);
  const suppressed = input?.marker?.suppressed || {};
  const expectedGuards = derivePackageUiSchedulerGuards(counts, suppressed);
  if (canonicalJson(input?.marker?.guards) !== canonicalJson(expectedGuards)) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_GUARDS_NOT_DERIVED',
      'The scheduler guard attestation must be derived exactly from its recorded counts and suppressions.',
      { actual: input?.marker?.guards ?? null, expected: expectedGuards },
    ));
  }
  if (
    counts.runNow !== 0
    || counts.runNowRejected !== 0
    || counts.localSchedulerStart !== 0
    || counts.storeSchedulerStart !== 0
    || counts.reconcile !== 0
    || counts.execute !== 0
    || suppressed.localSchedulerStart < 1
    || suppressed.storeSchedulerStart < 1
    || suppressed.startupReconcile < 1
    || expectedGuards.readOnlyInvariantPassed !== true
  ) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_MUTATION_COUNT',
      'Package UI Main must record zero run-now/start/reconcile/execute calls and explicit startup suppression.',
      { counts, suppressed },
    ));
  }
  if (
    requireSchedulerReads
    && (
      counts.workspaceQuery < 1
      || counts.schedulerGet < 1
      || counts.retentionPreview < 1
    )
  ) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_READS_MISSING',
      'A compact scheduler evidence run must record real workspace, schedule, and retention handler reads.',
      counts,
    ));
  }
  if ((input?.marker?.events || []).some((event) => event?.outcome === 'pending')) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_PENDING_EVENT',
      'The copied scheduler audit must not contain an incomplete handler event.',
      input.marker.events,
    ));
  }
  if (!currentFileRecordMatches(input?.artifact)) {
    violations.push(violation(
      'PACKAGE_UI_READ_ONLY_RUNTIME_ARTIFACT_STALE',
      'The copied runtime attestation is missing or its current SHA-256/size does not match.',
      input?.artifact ?? null,
    ));
  } else {
    try {
      const copied = JSON.parse(fs.readFileSync(input.artifact.path, 'utf8'));
      if (canonicalJson(copied) !== canonicalJson(input.marker)) {
        violations.push(violation(
          'PACKAGE_UI_READ_ONLY_RUNTIME_ARTIFACT_MISMATCH',
          'The copied runtime attestation bytes do not represent the live Main marker.',
          input.artifact,
        ));
      }
    } catch (error) {
      violations.push(violation(
        'PACKAGE_UI_READ_ONLY_RUNTIME_ARTIFACT_INVALID',
        'The copied runtime attestation is not valid JSON.',
        String(error?.message || error),
      ));
    }
  }
  return {
    ...input,
    counts,
    databaseMutationAudit,
    expectedGuards,
    passed: violations.length === 0,
    requireSchedulerReads,
    violations,
  };
}

async function collectPackageUiMainIdentity(electronApp) {
  return electronApp.evaluate(({ app }, evidenceModeEnv) => ({
    evidenceMode: process.env[evidenceModeEnv] || null,
    pid: process.pid,
    userDataDir: app.getPath('userData'),
  }), EVIDENCE_MODE_ENV);
}

function collectPackageUiReadOnlyRuntimeEvidence(
  main,
  userDataDir,
  runDir,
  profileId,
  options = {},
) {
  const sourceMarkerPath = path.join(userDataDir, PACKAGE_UI_SCHEDULER_AUDIT_FILE);
  if (!fs.existsSync(sourceMarkerPath) || !fs.statSync(sourceMarkerPath).isFile()) {
    return validatePackageUiReadOnlyRuntimeEvidence({
      artifact: null,
      main,
      marker: null,
      processExitConfirmed: true,
      sourceMarkerPath,
    });
  }
  let marker;
  let markerBytes;
  try {
    markerBytes = fs.readFileSync(sourceMarkerPath);
    marker = JSON.parse(markerBytes.toString('utf8'));
  } catch {
    marker = null;
    markerBytes = Buffer.alloc(0);
  }
  const artifactPath = path.join(
    runDir,
    `${safeSegment(profileId)}-${PACKAGE_UI_SCHEDULER_AUDIT_FILE}`,
  );
  fs.writeFileSync(artifactPath, markerBytes);
  const artifact = {
    path: artifactPath,
    sha256: sha256File(artifactPath),
    sizeBytes: fs.statSync(artifactPath).size,
  };
  return validatePackageUiReadOnlyRuntimeEvidence({
    artifact,
    main,
    marker,
    processExitConfirmed: true,
    sourceMarkerPath,
  }, options);
}

async function requestPackageUiDatabaseCheckpoint(page, phase) {
  return page.evaluate(async (requestedPhase) => {
    const api = window.electronAPI;
    if (typeof api?.packageUiDatabaseCheckpoint !== 'function') {
      throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_PRELOAD_UNAVAILABLE');
    }
    return api.packageUiDatabaseCheckpoint(requestedPhase);
  }, phase);
}

async function setElectronViewport(electronApp, viewport) {
  await electronApp.evaluate(({ BrowserWindow }, target) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window) throw new Error('No BrowserWindow available for package UI evidence.');
    window.setContentSize(target.width, target.height, false);
    window.show();
    window.focus();
  }, viewport);
}

async function readElectronViewport(page) {
  return page.evaluate(() => ({
    deviceScaleFactor: window.devicePixelRatio,
    height: window.innerHeight,
    width: window.innerWidth,
  }));
}

function attachRendererDiagnostics(page, diagnostics, attachedPages) {
  if (!page || attachedPages.has(page)) return;
  attachedPages.add(page);
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    let location = null;
    try {
      const source = message.location();
      location = source ? {
        columnNumber: Number(source.columnNumber) || 0,
        lineNumber: Number(source.lineNumber) || 0,
        url: sanitizeDiagnosticText(source.url || '', 1_000),
      } : null;
    } catch {
      location = null;
    }
    appendRendererDiagnostic(diagnostics, 'consoleErrors', {
      at: new Date().toISOString(),
      kind: 'console-error',
      location,
      message: sanitizeDiagnosticText(message.text(), DIAGNOSTIC_MESSAGE_LIMIT),
      phase: diagnostics.phase,
    });
  });
  page.on('pageerror', (error) => {
    appendRendererDiagnostic(diagnostics, 'pageErrors', {
      at: new Date().toISOString(),
      kind: 'page-error',
      message: sanitizeDiagnosticText(error?.message || error, DIAGNOSTIC_MESSAGE_LIMIT),
      name: sanitizeDiagnosticText(error?.name || 'Error', 120),
      phase: diagnostics.phase,
      stack: sanitizeDiagnosticText(error?.stack || '', DIAGNOSTIC_STACK_LIMIT),
    });
  });
}

async function runScaleEvidenceCore(options, scale, artifacts, runDir, diagnostics) {
  const consoleErrors = diagnostics.renderer.consoleErrors;
  const pageErrors = diagnostics.renderer.pageErrors;
  const attachedPages = new WeakSet();
  let electronApp;
  let mainIdentity = null;
  let pendingEvidence = null;
  let processExitConfirmed = false;
  try {
    setRunDiagnosticPhase(diagnostics, 'electron-launch');
    electronApp = await _electron.launch({
      executablePath: options.executablePath,
      args: [`--force-device-scale-factor=${scale.deviceScaleFactor}`],
      cwd: path.dirname(options.executablePath),
      env: {
        ...buildEvidenceUserDataEnv(process.env, PACKAGE_UI_EVIDENCE_MODE, options.userDataDir),
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_ENABLE_STACK_DUMPING: '1',
      },
      timeout: 60_000,
    });
    const attachPage = (candidate) => attachRendererDiagnostics(candidate, diagnostics, attachedPages);
    electronApp.on('window', attachPage);
    for (const existingPage of electronApp.windows()) attachPage(existingPage);
    setRunDiagnosticPhase(diagnostics, 'first-window');
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    attachPage(page);
    setRunDiagnosticPhase(diagnostics, 'viewport');
    await setElectronViewport(electronApp, PACKAGE_UI_VIEWPORT);
    const viewportWait = {
      width: PACKAGE_UI_VIEWPORT.width,
      height: PACKAGE_UI_VIEWPORT.height,
      dpr: scale.deviceScaleFactor,
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    };
    try {
      await page.waitForFunction(({ width, height, dpr, tolerance }) => (
        Math.abs(window.innerWidth - width) <= tolerance.width
        && Math.abs(window.innerHeight - height) <= tolerance.height
        && Math.abs(window.devicePixelRatio - dpr) <= tolerance.deviceScaleFactor
      ), viewportWait, { timeout: 20_000 });
    } catch (error) {
      const actualAfterTimeout = await readElectronViewport(page).catch(() => ({
        deviceScaleFactor: null,
        height: null,
        width: null,
      }));
      const timeoutContract = evaluatePackageViewportContract({
        actual: actualAfterTimeout,
        actualDeviceScaleFactor: actualAfterTimeout.deviceScaleFactor,
        expectedDeviceScaleFactor: scale.deviceScaleFactor,
      });
      fail('Packaged viewport did not settle within the strict DPI rounding tolerance', JSON.stringify({
        actual: timeoutContract.actual,
        delta: timeoutContract.delta,
        requested: timeoutContract.requested,
        scalePercent: scale.scalePercent,
        timeoutError: String(error?.message || error),
        tolerance: timeoutContract.tolerance,
      }));
    }
    const actualViewport = await readElectronViewport(page);
    const viewportContract = evaluatePackageViewportContract({
      actual: actualViewport,
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      expectedDeviceScaleFactor: scale.deviceScaleFactor,
    });
    if (!viewportContract.passed) {
      fail('Packaged viewport contract failed after settling', JSON.stringify(viewportContract));
    }

    setRunDiagnosticPhase(diagnostics, 'identity');
    const actualIdentity = await collectElectronIdentity(electronApp, page);
    const identity = validatePackageIdentity({
      ...actualIdentity,
      actualAppContentSha256: artifacts.appContent.sha256,
      actualExeSha256: artifacts.exe.sha256,
      expectedAppContentSha256: options.expectedAppContentSha256,
      expectedExeSha256: options.expectedExeSha256,
      expectedExecutablePath: options.executablePath,
      expectedEvidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      expectedUserDataDir: options.userDataDir,
      expectedVersion: DESKTOP_PACKAGE.version,
    });
    if (!identity.passed) fail('Packaged runtime identity failed', JSON.stringify(identity.violations));

    setRunDiagnosticPhase(diagnostics, 'login');
    const session = await ensureAuthenticatedWorkspace(page, { ...options, diagnostics });
    session.storeAuthorityReadback = await collectEvidenceStoreAuthorityReadback(
      page,
      session.storeGate,
    );
    if (!session.storeAuthorityReadback.passed) {
      fail(
        'Packaged shell Store Authority did not match the explicitly selected isolated evidence store',
        JSON.stringify(session.storeAuthorityReadback),
      );
    }
    const databaseAuditCheckpoints = {
      postBootstrap: await requestPackageUiDatabaseCheckpoint(page, 'post-bootstrap'),
      postNavigation: null,
    };
    const workspaceChecks = [];
    const subviewChecks = [];
    const screenshots = [];
    for (const workspace of EXPECTED_PACKAGE_UI_WORKSPACES) {
      setRunDiagnosticPhase(diagnostics, `workspace:${workspace.workspace}/${workspace.subview}`);
      const settleEvidence = await navigateToWorkspace(page, workspace, options.settleMs);
      const keyboardEvidence = await exerciseWorkspaceTabKeyboard(page, workspace);
      const workspaceRoot = page.locator(
        `[data-workspace-evidence-root][data-workspace="${workspace.workspace}"][data-workspace-subview="${workspace.subview}"]`,
      );
      await waitForWorkspaceSettled(
        page,
        `[data-workspace-evidence-root][data-workspace="${workspace.workspace}"][data-workspace-subview="${workspace.subview}"]`,
        options.settleMs,
      );
      const compositeEvidence = await waitForRendererComposite(page, electronApp, workspaceRoot);
      const metrics = await collectPackageWorkspaceMetrics(page, workspace);
      const contract = validateWorkspaceRuntimeMetrics(metrics, workspace);
      let experienceEvidence = null;
      let inspectorEvidence = null;
      if (PACKAGE_OBJECT_WORKSPACES.some((item) => item.workspace === workspace.workspace)) {
        const rootSelector = `[data-workspace-evidence-root][data-workspace="${workspace.workspace}"][data-workspace-subview="${workspace.subview}"]`;
        const capacity = await collectObjectQueueCapacityMetrics(page, rootSelector);
        const requiredVisibleCapacity = PACKAGE_OBJECT_EXPERIENCE_CONTRACTS.compact.minFullyVisibleRows;
        const experienceMetrics = await collectWorkspaceDomMetrics(page, {
          experienceContract: adaptiveObjectExperienceContract(
            PACKAGE_OBJECT_EXPERIENCE_CONTRACTS.compact,
            capacity,
          ),
          rootSelector,
        });
        const aiRunState = workspace.workspace === 'diagnosis'
          ? await collectVisibleAiRunState(page)
          : { ariaBusy: false, observed: false, statusLabel: null, text: '', tone: null };
        experienceEvidence = validateObjectWorkspaceExperienceEvidence({
          aiRunState,
          capacity,
          metrics: experienceMetrics,
          requiredVisibleCapacity,
          workspace: workspace.workspace,
        });
        if (!experienceEvidence.passed) {
          fail('Packaged object-workspace experience contract failed', `${workspace.workspace}: ${JSON.stringify(experienceEvidence.violations)}`);
        }
      }
      const screenshotPath = path.join(
        runDir,
        `${scale.scalePercent}-${safeSegment(workspace.workspace)}-${safeSegment(workspace.subview)}.png`,
      );
      const screenshotCapture = await captureViewportScreenshot(electronApp, screenshotPath);
      const screenshot = screenshotRecord(screenshotPath, {
        capture: screenshotCapture,
        heading: workspace.heading,
        scalePercent: scale.scalePercent,
        subview: workspace.subview,
        workspace: workspace.workspace,
      });
      screenshots.push(screenshot);
      if (experienceEvidence) {
        inspectorEvidence = await exerciseObjectInspector(page, {
          electronApp,
          expectedMode: 'drawer',
          profileId: `${scale.scalePercent}-compact`,
          runDir,
          workspace,
        });
      }
      workspaceChecks.push({
        ...workspace,
        compositeEvidence,
        passed: contract.passed,
        settleEvidence,
        violations: contract.violations,
        metrics,
        experienceEvidence,
        inspectorEvidence,
        keyboardEvidence,
        screenshot,
      });
      if (!contract.passed) {
        fail('Packaged workspace runtime contract failed', `${workspace.workspace}/${workspace.subview}: ${JSON.stringify(contract.violations)}`);
      }
    }

    for (const subview of EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS) {
      setRunDiagnosticPhase(diagnostics, `subview:${subview.workspace}/${subview.subview}`);
      const schedulerLedgerBefore = readPackageUiSchedulerAudit(options.userDataDir);
      const settleEvidence = await navigateToReadOnlySubview(page, subview, options.settleMs);
      const rootSelector = `[data-workspace-evidence-root][data-workspace="${subview.workspace}"][data-workspace-subview="${subview.subview}"]`;
      const subviewRoot = page.locator(rootSelector);
      const compositeEvidence = await waitForRendererComposite(page, electronApp, subviewRoot);
      const metrics = await collectPackageWorkspaceMetrics(page, subview);
      const contract = validateWorkspaceRuntimeMetrics(metrics, subview);
      const schedulerLedgerAfter = readPackageUiSchedulerAudit(options.userDataDir);
      const identityCapabilityEvidence = await collectSchedulerSubviewEvidence(
        page,
        schedulerLedgerBefore,
        schedulerLedgerAfter,
        subview,
      );
      const screenshotPath = path.join(
        runDir,
        `${scale.scalePercent}-${safeSegment(subview.workspace)}-${safeSegment(subview.subview)}.png`,
      );
      const screenshotCapture = await captureViewportScreenshot(electronApp, screenshotPath);
      const screenshot = screenshotRecord(screenshotPath, {
        capture: screenshotCapture,
        heading: subview.heading,
        scalePercent: scale.scalePercent,
        subview: subview.subview,
        workspace: subview.workspace,
      });
      const passed = contract.passed && identityCapabilityEvidence.passed;
      subviewChecks.push({
        ...subview,
        compositeEvidence,
        identityCapabilityEvidence,
        metrics,
        passed,
        screenshot,
        settleEvidence,
        violations: [...contract.violations, ...identityCapabilityEvidence.violations],
      });
      if (!passed) {
        fail(
          'Packaged read-only subview contract failed',
          `${subview.workspace}/${subview.subview}: ${JSON.stringify([
            ...contract.violations,
            ...identityCapabilityEvidence.violations,
          ])}`,
        );
      }
    }

    setRunDiagnosticPhase(diagnostics, 'overlays');
    const overlayChecks = await runOverlayChecks(page, {
      electronApp,
      runDir,
      scalePercent: scale.scalePercent,
      settleMs: options.settleMs,
    });
    databaseAuditCheckpoints.postNavigation = await requestPackageUiDatabaseCheckpoint(
      page,
      'post-navigation',
    );
    mainIdentity = await collectPackageUiMainIdentity(electronApp);
    if (consoleErrors.length > 0) fail('Renderer console errors were observed', JSON.stringify(consoleErrors));
    if (pageErrors.length > 0) fail('Renderer page errors were observed', JSON.stringify(pageErrors));

    pendingEvidence = {
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      actualIdentity,
      consoleErrors,
      databaseAuditCheckpoints,
      identity,
      overlayChecks,
      pageErrors,
      passed: true,
      scalePercent: scale.scalePercent,
      screenshots,
      session,
      subviewChecks,
      viewport: { width: actualViewport.width, height: actualViewport.height },
      viewportContract,
      workspaceChecks,
    };
  } finally {
    if (electronApp) {
      setRunDiagnosticPhase(diagnostics, 'electron-close');
      try {
        await electronApp.close();
        processExitConfirmed = true;
      } catch (error) {
        diagnostics.cleanupErrors.push(createStructuredFailure(error, 'electron-close'));
      }
    }
  }
  if (!processExitConfirmed || !mainIdentity || !pendingEvidence) {
    fail('Packaged Electron did not exit before terminal Main attestation was collected.');
  }
  setRunDiagnosticPhase(diagnostics, 'terminal-main-attestation');
  const schedulerReadOnlyRuntime = collectPackageUiReadOnlyRuntimeEvidence(
    mainIdentity,
    options.userDataDir,
    runDir,
    `${scale.scalePercent}-compact`,
    { requireSchedulerReads: true },
  );
  if (!schedulerReadOnlyRuntime.passed) {
    fail(
      'Package UI terminal Main scheduler read-only attestation failed',
      JSON.stringify(schedulerReadOnlyRuntime.violations),
    );
  }
  return {
    ...pendingEvidence,
    schedulerReadOnlyRuntime,
  };
}

async function runWideProfileEvidenceCore(options, artifacts, runDir, diagnostics) {
  const profile = PACKAGE_UI_WIDE_PROFILE;
  const consoleErrors = diagnostics.renderer.consoleErrors;
  const pageErrors = diagnostics.renderer.pageErrors;
  const attachedPages = new WeakSet();
  let electronApp;
  let mainIdentity = null;
  let pendingEvidence = null;
  let processExitConfirmed = false;
  try {
    setRunDiagnosticPhase(diagnostics, 'electron-launch');
    electronApp = await _electron.launch({
      executablePath: options.executablePath,
      args: [`--force-device-scale-factor=${profile.deviceScaleFactor}`],
      cwd: path.dirname(options.executablePath),
      env: {
        ...buildEvidenceUserDataEnv(process.env, PACKAGE_UI_EVIDENCE_MODE, options.userDataDir),
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_ENABLE_STACK_DUMPING: '1',
      },
      timeout: 60_000,
    });
    const attachPage = (candidate) => attachRendererDiagnostics(candidate, diagnostics, attachedPages);
    electronApp.on('window', attachPage);
    for (const existingPage of electronApp.windows()) attachPage(existingPage);
    setRunDiagnosticPhase(diagnostics, 'first-window');
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    attachPage(page);
    setRunDiagnosticPhase(diagnostics, 'viewport');
    await setElectronViewport(electronApp, profile.viewport);
    await page.waitForFunction(({ viewport, dpr, tolerance }) => (
      Math.abs(window.innerWidth - viewport.width) <= tolerance.width
      && Math.abs(window.innerHeight - viewport.height) <= tolerance.height
      && Math.abs(window.devicePixelRatio - dpr) <= tolerance.deviceScaleFactor
    ), {
      viewport: profile.viewport,
      dpr: profile.deviceScaleFactor,
      tolerance: PACKAGE_UI_VIEWPORT_TOLERANCE,
    }, { timeout: 20_000 });
    const actualViewport = await readElectronViewport(page);
    const viewportContract = evaluatePackageViewportContract({
      actual: actualViewport,
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      expectedDeviceScaleFactor: profile.deviceScaleFactor,
      requested: profile.viewport,
    });
    if (!viewportContract.passed) fail('Wide packaged viewport contract failed', JSON.stringify(viewportContract));
    setRunDiagnosticPhase(diagnostics, 'identity');
    const actualIdentity = await collectElectronIdentity(electronApp, page);
    const identity = validatePackageIdentity({
      ...actualIdentity,
      actualAppContentSha256: artifacts.appContent.sha256,
      actualExeSha256: artifacts.exe.sha256,
      expectedAppContentSha256: options.expectedAppContentSha256,
      expectedExeSha256: options.expectedExeSha256,
      expectedExecutablePath: options.executablePath,
      expectedEvidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      expectedUserDataDir: options.userDataDir,
      expectedVersion: DESKTOP_PACKAGE.version,
    });
    if (!identity.passed) fail('Wide packaged runtime identity failed', JSON.stringify(identity.violations));
    setRunDiagnosticPhase(diagnostics, 'login');
    const session = await ensureAuthenticatedWorkspace(page, { ...options, diagnostics });
    session.storeAuthorityReadback = await collectEvidenceStoreAuthorityReadback(
      page,
      session.storeGate,
    );
    if (!session.storeAuthorityReadback.passed) {
      fail(
        'Wide packaged shell Store Authority did not match the explicitly selected isolated evidence store',
        JSON.stringify(session.storeAuthorityReadback),
      );
    }
    const databaseAuditCheckpoints = {
      postBootstrap: await requestPackageUiDatabaseCheckpoint(page, 'post-bootstrap'),
      postNavigation: null,
    };
    const workspaceChecks = [];
    const screenshots = [];
    for (const workspace of profile.workspaces) {
      setRunDiagnosticPhase(diagnostics, `workspace:${workspace.workspace}/${workspace.subview}`);
      const settleEvidence = await navigateToWorkspace(page, workspace, options.settleMs);
      const rootSelector = `[data-workspace-evidence-root][data-workspace="${workspace.workspace}"][data-workspace-subview="${workspace.subview}"]`;
      const workspaceRoot = page.locator(rootSelector);
      const compositeEvidence = await waitForRendererComposite(page, electronApp, workspaceRoot);
      const metrics = await collectPackageWorkspaceMetrics(page, workspace);
      const contract = validateWorkspaceRuntimeMetrics(metrics, workspace, profile.viewport);
      const capacity = await collectObjectQueueCapacityMetrics(page, rootSelector);
      const requiredVisibleCapacity = PACKAGE_OBJECT_EXPERIENCE_CONTRACTS.wide.minFullyVisibleRows;
      const experienceMetrics = await collectWorkspaceDomMetrics(page, {
        experienceContract: adaptiveObjectExperienceContract(
          PACKAGE_OBJECT_EXPERIENCE_CONTRACTS.wide,
          capacity,
        ),
        rootSelector,
      });
      const aiRunState = workspace.workspace === 'diagnosis'
        ? await collectVisibleAiRunState(page)
        : { ariaBusy: false, observed: false, statusLabel: null, text: '', tone: null };
      const experienceEvidence = validateObjectWorkspaceExperienceEvidence({
        aiRunState,
        capacity,
        metrics: experienceMetrics,
        requiredVisibleCapacity,
        workspace: workspace.workspace,
      });
      if (!contract.passed || !experienceEvidence.passed) {
        fail('Wide object-workspace contract failed', `${workspace.workspace}: ${JSON.stringify([
          ...contract.violations,
          ...experienceEvidence.violations,
        ])}`);
      }
      const screenshotPath = path.join(runDir, `${profile.id}-${safeSegment(workspace.workspace)}-${safeSegment(workspace.subview)}.png`);
      const screenshotCapture = await captureViewportScreenshot(electronApp, screenshotPath);
      const screenshot = screenshotRecord(screenshotPath, {
        capture: screenshotCapture,
        heading: workspace.heading,
        profileId: profile.id,
        subview: workspace.subview,
        workspace: workspace.workspace,
      });
      screenshots.push(screenshot);
      const inspectorEvidence = await exerciseObjectInspector(page, {
        electronApp,
        expectedMode: 'inline',
        profileId: profile.id,
        runDir,
        workspace,
      });
      workspaceChecks.push({
        ...workspace,
        compositeEvidence,
        experienceEvidence,
        inspectorEvidence,
        metrics,
        passed: contract.passed && experienceEvidence.passed && inspectorEvidence.passed,
        screenshot,
        settleEvidence,
        violations: [...contract.violations, ...experienceEvidence.violations, ...inspectorEvidence.violations],
      });
    }
    databaseAuditCheckpoints.postNavigation = await requestPackageUiDatabaseCheckpoint(
      page,
      'post-navigation',
    );
    mainIdentity = await collectPackageUiMainIdentity(electronApp);
    if (consoleErrors.length > 0) fail('Wide packaged renderer console errors were observed', JSON.stringify(consoleErrors));
    if (pageErrors.length > 0) fail('Wide packaged renderer page errors were observed', JSON.stringify(pageErrors));
    pendingEvidence = {
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      actualIdentity,
      consoleErrors,
      databaseAuditCheckpoints,
      identity,
      pageErrors,
      passed: true,
      profileId: profile.id,
      screenshots,
      session,
      viewport: { width: actualViewport.width, height: actualViewport.height },
      viewportContract,
      workspaceChecks,
    };
  } finally {
    if (electronApp) {
      setRunDiagnosticPhase(diagnostics, 'electron-close');
      try {
        await electronApp.close();
        processExitConfirmed = true;
      } catch (error) {
        diagnostics.cleanupErrors.push(createStructuredFailure(error, 'electron-close'));
      }
    }
  }
  if (!processExitConfirmed || !mainIdentity || !pendingEvidence) {
    fail('Wide packaged Electron did not exit before terminal Main attestation was collected.');
  }
  setRunDiagnosticPhase(diagnostics, 'terminal-main-attestation');
  const schedulerReadOnlyRuntime = collectPackageUiReadOnlyRuntimeEvidence(
    mainIdentity,
    options.userDataDir,
    runDir,
    profile.id,
    { requireSchedulerReads: false },
  );
  if (!schedulerReadOnlyRuntime.passed) {
    fail(
      'Wide package UI terminal Main scheduler read-only attestation failed',
      JSON.stringify(schedulerReadOnlyRuntime.violations),
    );
  }
  return {
    ...pendingEvidence,
    schedulerReadOnlyRuntime,
  };
}

async function executeEvidenceRunWithIsolation({
  baseEvidence,
  options,
  processApi = {},
  profileId,
  run,
}) {
  const diagnostics = createRunDiagnostics(profileId);
  const profileBrowserPath = path.join(options.userDataDir, 'stores');
  setRunDiagnosticPhase(diagnostics, 'process-preflight');
  const collectPackage = processApi.collectPackage || collectMatchingPackageProcesses;
  const collectProfile = processApi.collectProfile || collectMatchingProfileBrowserProcesses;
  const waitPackage = processApi.waitPackage || waitForPackageProcessCleanup;
  const waitProfile = processApi.waitProfile || waitForProfileBrowserProcessCleanup;
  const packageProcessesBefore = collectPackage(options.executablePath);
  const profileProcessesBefore = collectProfile(profileBrowserPath);
  let coreEvidence = null;

  try {
    if (packageProcessesBefore.passed !== true || packageProcessesBefore.matchingCount !== 0) {
      fail('A matching packaged process was already running or unresolved before this evidence profile', JSON.stringify(packageProcessesBefore));
    }
    if (profileProcessesBefore.passed !== true || profileProcessesBefore.matchingCount !== 0) {
      fail('A Chromium profile process was already running or unresolved before this evidence profile', JSON.stringify(profileProcessesBefore));
    }
    coreEvidence = await run(diagnostics);
  } catch (error) {
    recordRunDiagnosticFailure(diagnostics, error, diagnosticFailurePhase(diagnostics));
  }

  setRunDiagnosticPhase(diagnostics, 'process-cleanup-attestation');
  let packageProcessesAfter;
  let profileProcessesAfter;
  try {
    [packageProcessesAfter, profileProcessesAfter] = await Promise.all([
      waitPackage(options.executablePath),
      waitProfile(profileBrowserPath),
    ]);
  } catch (error) {
    recordRunDiagnosticFailure(diagnostics, error, 'process-cleanup-attestation');
    packageProcessesAfter ||= {
      attempts: null,
      error: sanitizeDiagnosticText(error?.message || error),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      unresolved: [],
      unresolvedCount: null,
    };
    profileProcessesAfter ||= {
      attempts: null,
      error: sanitizeDiagnosticText(error?.message || error),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      profilePath: profileBrowserPath,
      unresolved: [],
      unresolvedCount: null,
    };
  }
  const packageProcessIsolation = buildProcessIsolationEvidence(packageProcessesBefore, packageProcessesAfter);
  const profileProcessIsolation = buildProcessIsolationEvidence(profileProcessesBefore, profileProcessesAfter);
  if (diagnostics.cleanupErrors.length > 0 && !diagnostics.failure) {
    recordRunDiagnosticFailure(
      diagnostics,
      new Error('Electron close reported one or more cleanup errors.'),
      'electron-close',
    );
  }
  if ((!packageProcessIsolation.passed || !profileProcessIsolation.passed) && !diagnostics.failure) {
    recordRunDiagnosticFailure(
      diagnostics,
      new Error('Packaged product or profile browser process isolation failed.'),
      'process-cleanup-attestation',
    );
  }
  const passed = coreEvidence?.passed === true
    && diagnostics.failure === null
    && diagnostics.cleanupErrors.length === 0
    && packageProcessIsolation.passed
    && profileProcessIsolation.passed;
  if (diagnostics.login.outcome === 'not-started') diagnostics.login.outcome = 'not-reached';
  if (diagnostics.login.outcome === 'in-progress') diagnostics.login.outcome = passed ? 'completed' : 'failed-before-outcome';
  completeRunDiagnostics(diagnostics, passed);

  return {
    ...baseEvidence,
    ...(coreEvidence || {}),
    consoleErrors: diagnostics.renderer.consoleErrors,
    diagnostics,
    failure: diagnostics.failure,
    packageProcessIsolation,
    pageErrors: diagnostics.renderer.pageErrors,
    passed,
    profileProcessIsolation,
  };
}

async function runScaleEvidence(options, scale, artifacts, runDir) {
  return executeEvidenceRunWithIsolation({
    baseEvidence: {
      actualDeviceScaleFactor: null,
      overlayChecks: [],
      scalePercent: scale.scalePercent,
      screenshots: [],
      schedulerReadOnlyRuntime: null,
      subviewChecks: [],
      viewport: { ...PACKAGE_UI_VIEWPORT },
      workspaceChecks: [],
    },
    options,
    profileId: `${scale.scalePercent}-compact`,
    run: (diagnostics) => runScaleEvidenceCore(options, scale, artifacts, runDir, diagnostics),
  });
}

async function runWideProfileEvidence(options, artifacts, runDir) {
  return executeEvidenceRunWithIsolation({
    baseEvidence: {
      actualDeviceScaleFactor: null,
      profileId: PACKAGE_UI_WIDE_PROFILE.id,
      screenshots: [],
      schedulerReadOnlyRuntime: null,
      viewport: { ...PACKAGE_UI_WIDE_PROFILE.viewport },
      workspaceChecks: [],
    },
    options,
    profileId: PACKAGE_UI_WIDE_PROFILE.id,
    run: (diagnostics) => runWideProfileEvidenceCore(options, artifacts, runDir, diagnostics),
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runPackageUiEvidence(options) {
  if (process.platform !== 'win32') fail('Package UI evidence currently supports Windows only', process.platform);
  const runId = timestampSegment();
  const outputDir = path.resolve(ROOT, options.outputDir);
  const runDir = path.join(outputDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const manifestPath = path.join(runDir, 'manifest.json');
  const summaryPath = path.join(outputDir, `package-ui-evidence-${runId}.json`);
  const manifest = {
    kind: 'package-ui-evidence',
    schemaVersion: PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runId,
    requested: {
      allowInteractiveLogin: options.allowInteractiveLogin,
      allowSavedLogin: options.allowSavedLogin,
      appContentPath: options.appContentPath,
      executablePath: options.executablePath,
      expectedAppContentSha256: options.expectedAppContentSha256,
      expectedExeSha256: options.expectedExeSha256,
      evidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      interactiveLoginTimeoutMs: options.interactiveLoginTimeoutMs,
      loginMode: 'interactive-operator-each-run',
      protectedDatabasePath: options.protectedDatabasePath,
      profileBrowserUserDataDir: path.join(options.userDataDir, 'stores'),
      scales: EXPECTED_PACKAGE_UI_SCALES,
      subviewChecks: EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
      userDataDir: options.userDataDir,
      viewport: PACKAGE_UI_VIEWPORT,
      wideProfile: PACKAGE_UI_WIDE_PROFILE,
    },
    interactiveLoginContract: INTERACTIVE_LOGIN_CONTRACT,
    interactionPlan: READ_ONLY_INTERACTION_PLAN,
    isolatedProfileBootstrapContract: ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    runs: [],
    passed: false,
    violations: [],
  };

  try {
    const interactionContract = validateReadOnlyInteractionPlan();
    manifest.interactionContract = interactionContract;
    if (!interactionContract.passed) fail('Read-only interaction contract failed', JSON.stringify(interactionContract.violations));

    manifest.userDataPreflight = {
      evidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      requestedUserDataDir: options.userDataDir,
      validatedUserDataDir: validateEvidenceUserDataPath(options.userDataDir),
      passed: true,
    };
    manifest.userDataOverrideBundleContract = inspectPackagedUserDataOverrideContract(
      path.join(options.appContentPath, 'dist', 'main', 'index.js'),
    );
    if (!manifest.userDataOverrideBundleContract.passed) {
      fail('Packaged main bundle does not contain the fail-closed userData override contract', JSON.stringify(
        manifest.userDataOverrideBundleContract.violations,
      ));
    }

    const profileDatabasePath = path.join(options.userDataDir, 'amazon-ai-ops.db');
    const protectedDatabaseBefore = artifactInfo(options.protectedDatabasePath);
    manifest.protectedDatabase = {
      before: protectedDatabaseBefore,
      after: null,
      passed: false,
      unchanged: false,
    };
    manifest.profileDatabaseProvenance = evaluateProfileDatabaseProvenance({
      profileDatabase: artifactInfo(profileDatabasePath),
      protectedDatabase: protectedDatabaseBefore,
    });
    if (!manifest.profileDatabaseProvenance.passed) {
      fail('Isolated profile database provenance failed', JSON.stringify(
        manifest.profileDatabaseProvenance.violations,
      ));
    }
    const packageProcessesBefore = collectMatchingPackageProcesses(options.executablePath);
    const profileBrowserProcessesBefore = collectMatchingProfileBrowserProcesses(
      manifest.requested.profileBrowserUserDataDir,
    );
    manifest.packageProcessIsolation = {
      before: packageProcessesBefore,
      after: null,
      passed: false,
    };
    manifest.profileProcessIsolation = {
      before: profileBrowserProcessesBefore,
      after: null,
      passed: false,
    };
    if (packageProcessesBefore.passed !== true || packageProcessesBefore.matchingCount !== 0) {
      fail('A matching packaged process was already running or could not be resolved before evidence capture', JSON.stringify(packageProcessesBefore));
    }
    if (profileBrowserProcessesBefore.passed !== true || profileBrowserProcessesBefore.matchingCount !== 0) {
      fail('A Chromium profile process was already running or could not be resolved before evidence capture', JSON.stringify(profileBrowserProcessesBefore));
    }

    const artifacts = {
      exe: artifactInfo(options.executablePath),
      appContent: buildAppContentManifest(options.appContentPath),
    };
    manifest.artifactsBefore = artifacts;
    if (artifacts.exe.sha256 !== options.expectedExeSha256) {
      fail('EXE hash does not match --expected-exe-sha256', `${artifacts.exe.sha256} != ${options.expectedExeSha256}`);
    }
    if (artifacts.appContent.sha256 !== options.expectedAppContentSha256) {
      fail('Unpacked app-content hash does not match --expected-app-content-sha256', `${artifacts.appContent.sha256} != ${options.expectedAppContentSha256}`);
    }
    const sourceWatermark = latestProductionSourceWatermark();
    const buildContent = buildProductionBuildContentManifest(path.join(ROOT, 'apps', 'desktop', 'dist'));
    const packagedDistContent = buildProductionBuildContentManifest(path.join(options.appContentPath, 'dist'));
    const freshness = validatePackageFreshness({ buildContent, packagedDistContent, sourceWatermark });
    manifest.sourceWatermark = sourceWatermark;
    manifest.buildContent = buildContent;
    manifest.packagedDistContent = packagedDistContent;
    manifest.freshness = freshness;
    if (!freshness.passed) fail('Packaged app content is stale or differs from the current build', JSON.stringify(freshness.violations));

    manifest.profileDatabaseFileIsolation = evaluateProfileDatabaseFileIsolation({
      profileDatabasePath,
      protectedDatabasePath: options.protectedDatabasePath,
    });
    if (!manifest.profileDatabaseFileIsolation.passed) {
      fail('Isolated profile database file-identity check failed before packaged Electron launch', JSON.stringify(
        manifest.profileDatabaseFileIsolation.violations,
      ));
    }

    for (const scale of EXPECTED_PACKAGE_UI_SCALES) {
      const run = await runScaleEvidence(options, scale, artifacts, runDir);
      manifest.runs.push(run);
      if (!run.passed) {
        fail(`Packaged UI ${scale.scalePercent}% evidence profile failed`, JSON.stringify(run.failure || {
          packageProcessIsolation: run.packageProcessIsolation,
          profileProcessIsolation: run.profileProcessIsolation,
        }));
      }
      if (
        scale.scalePercent === EXPECTED_PACKAGE_UI_SCALES[0].scalePercent
        && !firstInteractiveLoginAttestationPassed(run.session?.loginSessionAttestation)
      ) {
        fail(
          'The first schema v7 run did not establish a fresh typed identity proof',
          JSON.stringify(run.session?.loginSessionAttestation ?? null),
        );
      }
    }
    manifest.wideProfile = await runWideProfileEvidence(options, artifacts, runDir);
    if (!manifest.wideProfile.passed) {
      fail('Packaged UI wide evidence profile failed', JSON.stringify(manifest.wideProfile.failure || {
        packageProcessIsolation: manifest.wideProfile.packageProcessIsolation,
        profileProcessIsolation: manifest.wideProfile.profileProcessIsolation,
      }));
    }

    const artifactsAfter = {
      exe: artifactInfo(options.executablePath),
      appContent: buildAppContentManifest(options.appContentPath),
    };
    manifest.artifactsAfter = artifactsAfter;
    manifest.artifactHashesStable = artifacts.exe.sha256 === artifactsAfter.exe.sha256
      && artifacts.appContent.sha256 === artifactsAfter.appContent.sha256;
    const protectedDatabaseAfter = artifactInfo(options.protectedDatabasePath);
    manifest.protectedDatabase = buildProtectedFileEvidence(protectedDatabaseBefore, protectedDatabaseAfter);
    const [packageProcessesAfter, profileBrowserProcessesAfter] = await Promise.all([
      waitForPackageProcessCleanup(options.executablePath),
      waitForProfileBrowserProcessCleanup(manifest.requested.profileBrowserUserDataDir),
    ]);
    manifest.packageProcessIsolation = buildProcessIsolationEvidence(packageProcessesBefore, packageProcessesAfter);
    manifest.profileProcessIsolation = buildProcessIsolationEvidence(
      profileBrowserProcessesBefore,
      profileBrowserProcessesAfter,
    );
    const completeness = evaluatePackageUiEvidenceCompleteness(manifest);
    manifest.completeness = completeness;
    manifest.passed = completeness.passed;
    manifest.violations = completeness.violations;
    if (!manifest.passed) fail('Package UI evidence completeness failed', JSON.stringify(completeness.violations));
  } catch (error) {
    manifest.passed = false;
    manifest.failure = createStructuredFailure(error, 'package-ui-evidence');
    manifest.violations = manifest.violations || [];
    manifest.violations.push(violation('RUN_FAILED', 'Packaged UI evidence stopped fail-closed.', manifest.failure.message));
  } finally {
    const postRunAttestationErrors = [];
    if (manifest.packageProcessIsolation?.before && !manifest.packageProcessIsolation.after) {
      try {
        const packageProcessesAfter = await waitForPackageProcessCleanup(options.executablePath);
        manifest.packageProcessIsolation = buildProcessIsolationEvidence(
          manifest.packageProcessIsolation.before,
          packageProcessesAfter,
        );
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'package-process-isolation',
          message: String(error?.message || error),
        });
      }
    }
    if (manifest.profileProcessIsolation?.before && !manifest.profileProcessIsolation.after) {
      try {
        const profileProcessesAfter = await waitForProfileBrowserProcessCleanup(
          manifest.requested.profileBrowserUserDataDir,
        );
        manifest.profileProcessIsolation = buildProcessIsolationEvidence(
          manifest.profileProcessIsolation.before,
          profileProcessesAfter,
        );
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'profile-process-isolation',
          message: sanitizeDiagnosticText(error?.message || error),
        });
      }
    }
    if (manifest.protectedDatabase?.before && !manifest.protectedDatabase.after) {
      try {
        manifest.protectedDatabase = buildProtectedFileEvidence(
          manifest.protectedDatabase.before,
          artifactInfo(options.protectedDatabasePath),
        );
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'protected-database',
          message: String(error?.message || error),
        });
      }
    }
    if (postRunAttestationErrors.length > 0) {
      manifest.postRunAttestationErrors = postRunAttestationErrors;
      manifest.passed = false;
    }
    manifest.completedAt = new Date().toISOString();
    writeJson(manifestPath, manifest);
    writeJson(summaryPath, manifest);
  }

  if (!manifest.passed) {
    const error = new Error(`Package UI evidence failed: ${manifestPath}`);
    error.evidencePath = manifestPath;
    throw error;
  }
  return { manifest, manifestPath, summaryPath };
}

module.exports = {
  DEFAULT_APP_CONTENT_PATH,
  DEFAULT_EXECUTABLE_PATH,
  EXPECTED_OVERLAY_CHECK_IDS,
  EXPECTED_PACKAGE_UI_SCALES,
  EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
  EXPECTED_PACKAGE_UI_WORKSPACES,
  EXPECTED_RENDERER_ENTRY_PATH,
  INTERACTIVE_LOGIN_CONTRACT,
  ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
  LEGACY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
  LEGACY_SCHEDULER_READ_ONLY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
  PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
  PACKAGE_UI_VIEWPORT,
  PACKAGE_UI_WIDE_PROFILE,
  PACKAGE_OBJECT_EXPERIENCE_CONTRACTS,
  PACKAGE_OBJECT_WORKSPACES,
  READ_ONLY_INTERACTION_PLAN,
  appendRendererDiagnostic,
  buildAppContentManifest,
  buildProcessIsolationEvidence,
  buildProtectedFileEvidence,
  buildProductionBuildContentManifest,
  captureViewportScreenshot,
  collectElectronIdentity,
  collectEvidenceStoreAuthorityReadback,
  collectPackageUiMainIdentity,
  collectPackageUiReadOnlyRuntimeEvidence,
  collectMatchingPackageProcesses,
  collectMatchingProfileBrowserProcesses,
  decisionsTabAccessibleNamePattern,
  ensureEvidenceStoreContext,
  ensureEvidenceLingxingConnection,
  collectWorkspaceSettleSnapshot,
  evaluatePackageViewportContract,
  collectFixedPackageHashes,
  collectPackageWorkspaceMetrics,
  evaluatePackageUiEvidenceCompleteness,
  evaluateProfileDatabaseFileIsolation,
  evaluateProfileDatabaseProvenance,
  executeEvidenceRunWithIsolation,
  extractProfileUserDataDirectories,
  hasAuthenticatedWorkspace,
  latestProductionSourceWatermark,
  isWorkspaceProbeAbsenceError,
  isRetryableLoginNavigationError,
  selectDeterministicEvidenceStoreCandidate,
  parsePackageUiEvidenceArgs,
  readPngDimensions,
  runPackageUiEvidence,
  sanitizeDiagnosticText,
  screenshotRecord,
  sha256Buffer,
  sha256File,
  validatePackageFreshness,
  validatePackageIdentity,
  validatePackageUiDatabaseCheckpointReceipts,
  validatePackageUiDatabaseMutationAudit,
  validatePackageUiReadOnlyRuntimeEvidence,
  validateOverlayTriggerContract,
  validateOverlayKeyboardEvidence,
  validateReadOnlyInteractionPlan,
  validateIsolatedProfileBootstrapEvidence,
  validateLoginSessionAttestation,
  validateSchedulerSubviewEvidence,
  validateSchedulerSubviewRuntimeBinding,
  validateWorkspaceTabKeyboardEvidence,
  validateObjectWorkspaceExperienceEvidence,
  validateObjectInspectorEvidence,
  validateWorkspaceRuntimeMetrics,
  validRunDiagnostics,
  waitForPackageProcessCleanup,
  waitForProfileBrowserProcessCleanup,
  waitForInteractiveAuthenticatedWorkspace,
  waitForRendererComposite,
  waitForWorkspaceSettled,
};
