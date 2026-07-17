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
const PACKAGE_PROCESS_NAME = path.basename(DEFAULT_EXECUTABLE_PATH);
const REQUIRED_APP_CONTENT_ENTRIES = Object.freeze([
  'package.json',
  'dist/main/index.js',
  'dist/preload/index.js',
  'dist/renderer/index.html',
]);
const PACKAGE_UI_VIEWPORT = Object.freeze({ width: 1200, height: 700 });
const PACKAGE_UI_VIEWPORT_TOLERANCE = Object.freeze({ width: 2, height: 2, deviceScaleFactor: 0.02 });
const EXPECTED_PACKAGE_UI_SCALES = Object.freeze([
  Object.freeze({ scalePercent: 100, deviceScaleFactor: 1 }),
  Object.freeze({ scalePercent: 125, deviceScaleFactor: 1.25 }),
]);
const EXPECTED_PACKAGE_UI_WORKSPACES = Object.freeze([
  Object.freeze({ workspace: 'today', subview: 'overview', label: '今日任务', heading: '今日任务' }),
  Object.freeze({ workspace: 'product', subview: 'products', label: '产品工作台', heading: '产品工作台' }),
  Object.freeze({ workspace: 'data-preparation', subview: 'scope', label: '数据准备', heading: '工作范围' }),
  Object.freeze({ workspace: 'diagnosis', subview: 'analysis', label: '广告诊断', heading: '广告诊断' }),
  Object.freeze({ workspace: 'decisions', subview: 'recommendations', label: '建议与审批', heading: '建议与审批' }),
  Object.freeze({ workspace: 'readback', subview: 'evidence', label: '结果核对', heading: '结果核对' }),
  Object.freeze({ workspace: 'growth', subview: 'keywords', label: '关键词与 Listing', heading: '关键词机会' }),
  Object.freeze({ workspace: 'system', subview: 'settings', label: '系统与交付', heading: 'AI 与规则' }),
]);
const PACKAGE_OBJECT_WORKSPACES = Object.freeze(
  EXPECTED_PACKAGE_UI_WORKSPACES.filter((item) => item.workspace === 'product' || item.workspace === 'diagnosis'),
);
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
    id: 'report-subview-navigation',
    kind: 'subview',
    target: '报表采集',
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
  Object.freeze({
    id: 'product-read-only-row-inspector',
    kind: 'row-selection',
    target: '产品对象队列首个非锁定行，只读查看详情后 Escape 关闭',
    trigger: 'Enter',
  }),
  Object.freeze({
    id: 'diagnosis-read-only-row-inspector',
    kind: 'row-selection',
    target: '广告对象诊断队列首行，只读查看证据后 Escape 关闭',
    trigger: 'Enter',
  }),
]);
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
    allowSavedLogin: false,
    appContentPath: DEFAULT_APP_CONTENT_PATH,
    executablePath: DEFAULT_EXECUTABLE_PATH,
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
  if (!values.userDataDir) fail('--user-data-dir is required and must point to an isolated D-drive profile copy.');
  if (!values.protectedDatabasePath) fail('--protected-db is required so the real AppData SQLite file is hashed before and after evidence capture.');
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
  if (result.status !== 0) {
    return {
      error: String(result.stderr || result.error?.message || `PowerShell exited ${result.status}`).trim(),
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
      unresolvedCount: null,
    };
  }
  let observed;
  try {
    const parsed = JSON.parse(String(result.stdout || '').trim() || '[]');
    observed = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch (error) {
    return {
      error: `Could not parse package process snapshot: ${error instanceof Error ? error.message : String(error)}`,
      matching: [],
      matchingCount: null,
      observedCount: null,
      passed: false,
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
      parentProcessId: Number(item.ParentProcessId),
      processId: Number(item.ProcessId),
    }));
  return {
    error: null,
    matching,
    matchingCount: matching.length,
    observedCount: observed.length,
    passed: unresolved.length === 0,
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
  const allowedKinds = new Set(['navigation', 'subview', 'overlay', 'row-selection']);
  const expectedIds = new Set([
    'workspace-navigation',
    'report-subview-navigation',
    ...EXPECTED_OVERLAY_CHECK_IDS,
    'product-read-only-row-inspector',
    'diagnosis-read-only-row-inspector',
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

function evaluatePackageUiEvidenceCompleteness(input) {
  const violations = [];
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
  if (input.packageProcessIsolation?.before?.passed !== true
    || input.packageProcessIsolation?.before?.matchingCount !== 0) {
    violations.push(violation(
      'PACKAGE_PROCESS_PREEXISTING_OR_UNRESOLVED',
      'No matching packaged process may be running before evidence capture.',
      input.packageProcessIsolation?.before,
    ));
  }
  if (input.packageProcessIsolation?.after?.passed !== true
    || input.packageProcessIsolation?.after?.matchingCount !== 0
    || input.packageProcessIsolation?.passed !== true) {
    violations.push(violation(
      'PACKAGE_PROCESS_CLEANUP_FAILED',
      'All matching packaged processes must be gone after evidence capture.',
      input.packageProcessIsolation?.after,
    ));
  }
  const runs = Array.isArray(input.runs) ? input.runs : [];
  for (const scale of EXPECTED_PACKAGE_UI_SCALES) {
    const run = runs.find((candidate) => candidate.scalePercent === scale.scalePercent);
    if (!run) {
      violations.push(violation('SCALE_RUN_MISSING', `Missing ${scale.scalePercent}% packaged UI run.`));
      continue;
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
    if ((run.consoleErrors || []).length > 0) {
      violations.push(violation('RENDERER_CONSOLE_ERROR', `The ${scale.scalePercent}% packaged renderer emitted console errors.`, run.consoleErrors));
    }
    if ((run.pageErrors || []).length > 0) {
      violations.push(violation('RENDERER_PAGE_ERROR', `The ${scale.scalePercent}% packaged renderer emitted uncaught page errors.`, run.pageErrors));
    }
    for (const workspace of EXPECTED_PACKAGE_UI_WORKSPACES) {
      const check = (run.workspaceChecks || []).find((candidate) => candidate.workspace === workspace.workspace);
      if (!check || check.passed !== true) {
        violations.push(violation('WORKSPACE_CHECK_MISSING_OR_FAILED', `${scale.scalePercent}% ${workspace.workspace} runtime check is missing or failed.`, check));
      }
      if (check?.settleEvidence?.passed !== true || check?.compositeEvidence?.passed !== true) {
        violations.push(violation('WORKSPACE_NOT_SETTLED_FOR_CAPTURE', `${scale.scalePercent}% ${workspace.workspace} was not stably rendered before capture.`, check));
      }
      const screenshot = (run.screenshots || []).find((candidate) => candidate.workspace === workspace.workspace);
      if (!screenshot || !/^[A-F0-9]{64}$/.test(String(screenshot.sha256 || ''))) {
        violations.push(violation('WORKSPACE_SCREENSHOT_MISSING_OR_UNHASHED', `${scale.scalePercent}% ${workspace.workspace} screenshot is missing or unhashed.`, screenshot));
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
  const selector = `[data-workspace-evidence-root][data-workspace="${expected.workspace}"][data-workspace-subview="${expected.subview}"]`;
  await page.locator(selector).waitFor({ state: 'visible', timeout: 15_000 });
  await waitForNavigationIdle(page);
  await page.waitForFunction(() => {
    const content = document.querySelector('.app-content');
    return Boolean(content) && Math.abs(content.scrollTop) <= 1;
  }, undefined, { timeout: 10_000 });
  return waitForWorkspaceSettled(page, selector, settleMs);
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
  try {
    if (timeoutMs > 0) {
      await workspace.waitFor({ state: 'visible', timeout: timeoutMs });
      return true;
    }
    return await workspace.count() > 0;
  } catch (error) {
    if (isWorkspaceProbeAbsenceError(error)) return false;
    throw error;
  }
}

async function ensureAuthenticatedWorkspace(page, options) {
  await page.waitForFunction(() => Boolean(
    document.querySelector('nav[aria-label="主业务导航"]')
    || document.querySelector('button.login-submit-button')
    || document.querySelector('button[type="button"]')?.textContent?.includes('登录并进入 Ads'),
  ), undefined, { timeout: 30_000 });

  if (await hasAuthenticatedWorkspace(page)) {
    return { mode: 'existing-authenticated-session', savedCredentialsLoginUsed: false };
  }
  if (!options.allowSavedLogin) {
    fail('Package opened on the login screen. Re-run with --allow-saved-login only after confirming the app already holds valid saved credentials.');
  }

  const username = page.locator('input[placeholder="领星用户名"]');
  const password = page.locator('input[placeholder="领星密码"]');
  await username.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => {
    const account = document.querySelector('input[placeholder="领星用户名"]');
    const secret = document.querySelector('input[placeholder="领星密码"]');
    return Boolean(account?.value && secret?.value);
  }, undefined, { timeout: 10_000 }).catch(() => undefined);
  let savedCredentialState;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      savedCredentialState = await page.evaluate(() => ({
        usernameAvailable: Boolean(document.querySelector('input[placeholder="领星用户名"]')?.value),
        passwordAvailable: Boolean(document.querySelector('input[placeholder="领星密码"]')?.value),
        rememberPassword: Boolean(document.querySelector('input[type="checkbox"]')?.checked),
      }));
      break;
    } catch (error) {
      if (!isRetryableLoginNavigationError(error?.message || error)) throw error;
      if (await hasAuthenticatedWorkspace(page, 2_000)) {
        return { mode: 'saved-credentials-auto-login', savedCredentialsLoginUsed: true };
      }
      if (attempt === 3) throw error;
      await page.waitForTimeout(500);
    }
  }
  if (!savedCredentialState.usernameAvailable || !savedCredentialState.passwordAvailable) {
    fail('Saved credentials are incomplete; package UI evidence refuses to read environment credentials or type secrets.');
  }

  const loginButton = page.getByRole('button', { name: '登录并进入 Ads', exact: true });
  let lastLoginError = 'no visible login error';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
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
      if (value?.kind === 'workspace') break;
      lastLoginError = 'saved-session browser navigation replaced its execution context';
      if (attempt < 2) {
        await page.waitForTimeout(1_000);
        continue;
      }
    } catch (error) {
      if (await hasAuthenticatedWorkspace(page, 2_000)) break;
      lastLoginError = await page.locator('[role="alert"]').first().innerText().catch(() => String(error?.message || error));
      if (attempt < 2 && isRetryableLoginNavigationError(lastLoginError)) {
        await page.waitForTimeout(1_000);
        continue;
      }
    }
    fail('Saved-credential session establishment did not reach the workspace shell', lastLoginError.slice(0, 500));
  }
  if (!await hasAuthenticatedWorkspace(page)) {
    fail('Saved-credential session establishment did not reach the workspace shell', lastLoginError.slice(0, 500));
  }
  return {
    mode: 'saved-credentials-login',
    savedCredentialsLoginUsed: true,
    savedCredentialState,
  };
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
  const dataPreparation = EXPECTED_PACKAGE_UI_WORKSPACES.find((item) => item.workspace === 'data-preparation');
  await navigateToWorkspace(page, dataPreparation, runOptions.settleMs);
  await page.getByRole('tab', { name: '报表采集', exact: true }).click();
  const reportRootSelector = '[data-workspace-evidence-root][data-workspace="data-preparation"][data-workspace-subview="reports"]';
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

  const readback = EXPECTED_PACKAGE_UI_WORKSPACES.find((item) => item.workspace === 'readback');
  await navigateToWorkspace(page, readback, runOptions.settleMs);
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

async function runScaleEvidence(options, scale, artifacts, runDir) {
  const consoleErrors = [];
  const pageErrors = [];
  let electronApp;
  try {
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
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2_000));
    });
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error).slice(0, 4_000)));
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

    const session = await ensureAuthenticatedWorkspace(page, options);
    const workspaceChecks = [];
    const screenshots = [];
    for (const workspace of EXPECTED_PACKAGE_UI_WORKSPACES) {
      const settleEvidence = await navigateToWorkspace(page, workspace, options.settleMs);
      const workspaceRoot = page.locator(
        `[data-workspace-evidence-root][data-workspace="${workspace.workspace}"][data-workspace-subview="${workspace.subview}"]`,
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
        screenshot,
      });
      if (!contract.passed) {
        fail('Packaged workspace runtime contract failed', `${workspace.workspace}/${workspace.subview}: ${JSON.stringify(contract.violations)}`);
      }
    }

    const overlayChecks = await runOverlayChecks(page, {
      electronApp,
      runDir,
      scalePercent: scale.scalePercent,
      settleMs: options.settleMs,
    });
    if (consoleErrors.length > 0) fail('Renderer console errors were observed', JSON.stringify(consoleErrors));
    if (pageErrors.length > 0) fail('Renderer page errors were observed', JSON.stringify(pageErrors));

    return {
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      actualIdentity,
      consoleErrors,
      identity,
      overlayChecks,
      pageErrors,
      passed: true,
      scalePercent: scale.scalePercent,
      screenshots,
      session,
      viewport: { width: actualViewport.width, height: actualViewport.height },
      viewportContract,
      workspaceChecks,
    };
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
}

async function runWideProfileEvidence(options, artifacts, runDir) {
  const profile = PACKAGE_UI_WIDE_PROFILE;
  const consoleErrors = [];
  const pageErrors = [];
  let electronApp;
  try {
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
    const page = await electronApp.firstWindow({ timeout: 60_000 });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2_000));
    });
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error?.message || error).slice(0, 4_000)));
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
    const session = await ensureAuthenticatedWorkspace(page, options);
    const workspaceChecks = [];
    const screenshots = [];
    for (const workspace of profile.workspaces) {
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
    if (consoleErrors.length > 0) fail('Wide packaged renderer console errors were observed', JSON.stringify(consoleErrors));
    if (pageErrors.length > 0) fail('Wide packaged renderer page errors were observed', JSON.stringify(pageErrors));
    return {
      actualDeviceScaleFactor: actualViewport.deviceScaleFactor,
      actualIdentity,
      consoleErrors,
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
    await electronApp?.close().catch(() => undefined);
  }
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
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    runId,
    requested: {
      allowSavedLogin: options.allowSavedLogin,
      appContentPath: options.appContentPath,
      executablePath: options.executablePath,
      expectedAppContentSha256: options.expectedAppContentSha256,
      expectedExeSha256: options.expectedExeSha256,
      evidenceMode: PACKAGE_UI_EVIDENCE_MODE,
      protectedDatabasePath: options.protectedDatabasePath,
      scales: EXPECTED_PACKAGE_UI_SCALES,
      userDataDir: options.userDataDir,
      viewport: PACKAGE_UI_VIEWPORT,
      wideProfile: PACKAGE_UI_WIDE_PROFILE,
    },
    interactionPlan: READ_ONLY_INTERACTION_PLAN,
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

    const protectedDatabaseBefore = artifactInfo(options.protectedDatabasePath);
    manifest.protectedDatabase = {
      before: protectedDatabaseBefore,
      after: null,
      passed: false,
      unchanged: false,
    };
    const profileDatabasePath = path.join(options.userDataDir, 'amazon-ai-ops.db');
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
    manifest.packageProcessIsolation = {
      before: packageProcessesBefore,
      after: null,
      passed: false,
    };
    if (packageProcessesBefore.passed !== true || packageProcessesBefore.matchingCount !== 0) {
      fail('A matching packaged process was already running or could not be resolved before evidence capture', JSON.stringify(packageProcessesBefore));
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

    for (const scale of EXPECTED_PACKAGE_UI_SCALES) {
      const run = await runScaleEvidence(options, scale, artifacts, runDir);
      manifest.runs.push(run);
    }
    manifest.wideProfile = await runWideProfileEvidence(options, artifacts, runDir);

    const artifactsAfter = {
      exe: artifactInfo(options.executablePath),
      appContent: buildAppContentManifest(options.appContentPath),
    };
    manifest.artifactsAfter = artifactsAfter;
    manifest.artifactHashesStable = artifacts.exe.sha256 === artifactsAfter.exe.sha256
      && artifacts.appContent.sha256 === artifactsAfter.appContent.sha256;
    const protectedDatabaseAfter = artifactInfo(options.protectedDatabasePath);
    manifest.protectedDatabase = buildProtectedFileEvidence(protectedDatabaseBefore, protectedDatabaseAfter);
    const packageProcessesAfter = await waitForPackageProcessCleanup(options.executablePath);
    manifest.packageProcessIsolation = {
      before: packageProcessesBefore,
      after: packageProcessesAfter,
      passed: packageProcessesBefore.passed === true
        && packageProcessesBefore.matchingCount === 0
        && packageProcessesAfter.passed === true
        && packageProcessesAfter.matchingCount === 0,
    };
    const completeness = evaluatePackageUiEvidenceCompleteness(manifest);
    manifest.completeness = completeness;
    manifest.passed = completeness.passed;
    manifest.violations = completeness.violations;
    if (!manifest.passed) fail('Package UI evidence completeness failed', JSON.stringify(completeness.violations));
  } catch (error) {
    manifest.passed = false;
    manifest.failure = {
      message: String(error?.message || error),
      stack: String(error?.stack || '').split('\n').slice(0, 12).join('\n'),
    };
    manifest.violations = manifest.violations || [];
    manifest.violations.push(violation('RUN_FAILED', 'Packaged UI evidence stopped fail-closed.', manifest.failure.message));
  } finally {
    const postRunAttestationErrors = [];
    if (manifest.packageProcessIsolation?.before && !manifest.packageProcessIsolation.after) {
      try {
        const packageProcessesAfter = await waitForPackageProcessCleanup(options.executablePath);
        manifest.packageProcessIsolation = {
          before: manifest.packageProcessIsolation.before,
          after: packageProcessesAfter,
          passed: manifest.packageProcessIsolation.before.passed === true
            && manifest.packageProcessIsolation.before.matchingCount === 0
            && packageProcessesAfter.passed === true
            && packageProcessesAfter.matchingCount === 0,
        };
      } catch (error) {
        postRunAttestationErrors.push({
          check: 'package-process-isolation',
          message: String(error?.message || error),
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
  EXPECTED_PACKAGE_UI_WORKSPACES,
  EXPECTED_RENDERER_ENTRY_PATH,
  PACKAGE_UI_VIEWPORT,
  PACKAGE_UI_WIDE_PROFILE,
  PACKAGE_OBJECT_EXPERIENCE_CONTRACTS,
  PACKAGE_OBJECT_WORKSPACES,
  READ_ONLY_INTERACTION_PLAN,
  buildAppContentManifest,
  buildProtectedFileEvidence,
  buildProductionBuildContentManifest,
  captureViewportScreenshot,
  collectElectronIdentity,
  collectMatchingPackageProcesses,
  collectWorkspaceSettleSnapshot,
  evaluatePackageViewportContract,
  collectFixedPackageHashes,
  collectPackageWorkspaceMetrics,
  evaluatePackageUiEvidenceCompleteness,
  evaluateProfileDatabaseProvenance,
  latestProductionSourceWatermark,
  isWorkspaceProbeAbsenceError,
  isRetryableLoginNavigationError,
  parsePackageUiEvidenceArgs,
  readPngDimensions,
  runPackageUiEvidence,
  screenshotRecord,
  sha256Buffer,
  sha256File,
  validatePackageFreshness,
  validatePackageIdentity,
  validateOverlayTriggerContract,
  validateOverlayKeyboardEvidence,
  validateReadOnlyInteractionPlan,
  validateObjectWorkspaceExperienceEvidence,
  validateObjectInspectorEvidence,
  validateWorkspaceRuntimeMetrics,
  waitForPackageProcessCleanup,
  waitForRendererComposite,
  waitForWorkspaceSettled,
};
