const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const {
  EVIDENCE_MODE_ENV,
  PACKAGE_LAUNCH_SMOKE_MODE,
  buildEvidenceUserDataEnv,
  normalizeWindowsPath,
  validateEvidenceUserDataIdentity,
  validateEvidenceUserDataPath,
} = require('./evidence-user-data');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_RELEASE_DIR = path.join(ROOT, 'apps', 'desktop', 'release');
const DEFAULT_EXECUTABLE_PATH = path.join(DEFAULT_RELEASE_DIR, 'win-unpacked', 'AmazonAIOpsAgent.exe');
const DEFAULT_APP_CONTENT_PATH = path.join(DEFAULT_RELEASE_DIR, 'win-unpacked', 'resources', 'app');
const DEFAULT_MAIN_BUNDLE_PATH = path.join(DEFAULT_APP_CONTENT_PATH, 'dist', 'main', 'index.js');
const DEFAULT_RENDERER_ENTRY_PATH = path.join(DEFAULT_APP_CONTENT_PATH, 'dist', 'renderer', 'index.html');
const PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION = 'package-adversarial-node-env/v1';
const PACKAGE_ADVERSARIAL_NODE_ENV_EVIDENCE_KIND = 'package-adversarial-node-env-smoke';
const PACKAGE_ADVERSARIAL_NODE_ENV_EVIDENCE_SCHEMA_VERSION = 1;
const EXPECTED_ADVERSARIAL_NODE_ENV_CHECK_CODES = Object.freeze([
  'PACKAGE_EXECUTABLE_HASH_MATCH',
  'PACKAGE_APP_CONTENT_HASH_MATCH',
  'PACKAGE_MAIN_BUNDLE_HASH_MATCH',
  'NODE_ENV_DEVELOPMENT_INJECTED',
  'RUNTIME_IS_PACKAGED',
  'RENDERER_EXACT_PACKAGED_FILE',
  'DEVTOOLS_CLOSED',
  'LOCALHOST_RENDERER_ABSENT',
  'ISOLATED_USER_DATA_CONFIRMED',
  'PROCESS_CLEANUP_CONFIRMED',
]);

function normalizeSha256(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character SHA-256 value`);
  }
  return normalized;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').toUpperCase();
}

function rendererPathIdentity(filePath) {
  return sha256Text(normalizeWindowsPath(filePath));
}

function exactFields(value, expectedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function validateAdversarialNodeEnvManifestEntryContract(entry) {
  const violations = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    violations.push('missing packageAdversarialNodeEnv manifest entry');
    return { passed: false, violations };
  }
  if (entry.contractVersion !== PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION) {
    violations.push('unexpected packageAdversarialNodeEnv manifest contract version');
  }
  if (entry.requiredForAppReady !== true) {
    violations.push('packageAdversarialNodeEnv manifest entry is not required for APP_READY');
  }
  return { passed: violations.length === 0, violations };
}

function validateAdversarialNodeEnvSelectionContract(selection) {
  const violations = [];
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    violations.push('missing packageAdversarialNodeEnv selection');
    return { passed: false, violations };
  }
  if (selection.contractVersion !== PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION) {
    violations.push('unexpected packageAdversarialNodeEnv selection contract version');
  }
  if (selection.requiredForDeliverySafety !== true) {
    violations.push('packageAdversarialNodeEnv selection is not required for delivery safety');
  }
  if (selection.present !== true) violations.push('packageAdversarialNodeEnv evidence is not present');
  if (selection.passed !== true) violations.push('packageAdversarialNodeEnv evidence selection did not pass');
  if (typeof selection.evidencePath !== 'string' || !selection.evidencePath.trim()) {
    violations.push('packageAdversarialNodeEnv evidence path is missing');
  }
  if (typeof selection.selectedBy !== 'string' || !selection.selectedBy.trim()) {
    violations.push('packageAdversarialNodeEnv selection source is missing');
  }
  if (!/^[A-F0-9]{64}$/.test(String(selection.evidenceSha256 || ''))) {
    violations.push('packageAdversarialNodeEnv evidence SHA-256 is invalid');
  }
  if (!exactFields(selection.package, ['executableSha256', 'appContentSha256', 'mainBundleSha256'])) {
    violations.push('unexpected packageAdversarialNodeEnv selection package fields');
  }
  for (const field of ['executableSha256', 'appContentSha256', 'mainBundleSha256']) {
    if (!/^[A-F0-9]{64}$/.test(String(selection.package?.[field] || ''))) {
      violations.push(`invalid packageAdversarialNodeEnv selection ${field}`);
    }
  }
  return { passed: violations.length === 0, violations };
}

function validateAdversarialNodeEnvBundleSummaryContract(summary) {
  const violations = [];
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    violations.push('missing packageAdversarialNodeEnv bundle summary');
    return { passed: false, violations };
  }
  if (summary.contractVersion !== PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION) {
    violations.push('unexpected packageAdversarialNodeEnv bundle contract version');
  }
  if (summary.present !== true) violations.push('packageAdversarialNodeEnv bundle evidence is not present');
  if (summary.requiredByFinalReadiness !== true) {
    violations.push('packageAdversarialNodeEnv bundle evidence is not required by final readiness');
  }
  if (typeof summary.sourcePath !== 'string' || !summary.sourcePath.trim()) {
    violations.push('packageAdversarialNodeEnv bundle source path is missing');
  }
  if (typeof summary.bundlePath !== 'string' || !summary.bundlePath.trim()) {
    violations.push('packageAdversarialNodeEnv bundle path is missing');
  }
  if (!/^[A-F0-9]{64}$/.test(String(summary.sha256 || ''))) {
    violations.push('packageAdversarialNodeEnv bundle SHA-256 is invalid');
  }
  return { passed: violations.length === 0, violations };
}

function parseAdversarialNodeEnvArgs(argv) {
  const allowed = new Set([
    'app-content',
    'executable',
    'expected-app-content-sha256',
    'expected-exe-sha256',
    'expected-main-bundle-sha256',
    'out',
    'user-data-dir',
  ]);
  const parsed = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (!allowed.has(key)) throw new Error(`Unexpected argument: --${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    if (Object.prototype.hasOwnProperty.call(parsed, key)) throw new Error(`Duplicate argument: --${key}`);
    parsed[key] = value;
    index += 1;
  }
  for (const key of [
    'expected-exe-sha256',
    'expected-app-content-sha256',
    'expected-main-bundle-sha256',
    'out',
  ]) {
    if (!parsed[key]) throw new Error(`Missing required --${key}`);
  }
  const runId = Date.now();
  return {
    appContentPath: path.resolve(parsed['app-content'] || DEFAULT_APP_CONTENT_PATH),
    executablePath: path.resolve(parsed.executable || DEFAULT_EXECUTABLE_PATH),
    expectedAppContentSha256: normalizeSha256(parsed['expected-app-content-sha256'], '--expected-app-content-sha256'),
    expectedExeSha256: normalizeSha256(parsed['expected-exe-sha256'], '--expected-exe-sha256'),
    expectedMainBundleSha256: normalizeSha256(parsed['expected-main-bundle-sha256'], '--expected-main-bundle-sha256'),
    out: path.resolve(parsed.out),
    userDataDir: path.win32.resolve(
      parsed['user-data-dir'] || path.join('D:\\Temp', 'amazon-ai-ops-adversarial-node-env', String(runId)),
    ),
  };
}

function injectAdversarialNodeEnv(baseEnv) {
  return { ...baseEnv, NODE_ENV: 'development' };
}

function buildAdversarialLaunchEnvironment(baseEnv, userDataDir) {
  return injectAdversarialNodeEnv(
    buildEvidenceUserDataEnv(baseEnv, PACKAGE_LAUNCH_SMOKE_MODE, userDataDir),
  );
}

function collectPackageIdentity({ appContentPath, executablePath }) {
  const { buildAppContentManifest, sha256File } = require('./package-ui-evidence');
  const mainBundlePath = path.join(appContentPath, 'dist', 'main', 'index.js');
  const rendererEntryPath = path.join(appContentPath, 'dist', 'renderer', 'index.html');
  if (!fs.existsSync(executablePath) || !fs.statSync(executablePath).isFile()) {
    throw new Error('win-unpacked executable is missing');
  }
  if (!fs.existsSync(mainBundlePath) || !fs.statSync(mainBundlePath).isFile()) {
    throw new Error('packaged main bundle is missing');
  }
  if (!fs.existsSync(rendererEntryPath) || !fs.statSync(rendererEntryPath).isFile()) {
    throw new Error('packaged renderer entry is missing');
  }
  return {
    appContentSha256: buildAppContentManifest(appContentPath).sha256,
    executableSha256: sha256File(executablePath),
    mainBundleSha256: sha256File(mainBundlePath),
    rendererEntrySha256: rendererPathIdentity(rendererEntryPath),
  };
}

function emptyRuntimeEvidence() {
  return {
    allDevToolsClosed: false,
    evidenceMode: null,
    isPackaged: false,
    isolatedUserData: false,
    localhostDetected: true,
    nodeEnv: null,
    rendererEntrySha256: null,
    rendererExact: false,
    rendererScheme: null,
    windowCount: 0,
  };
}

function summarizeRuntimeProbe(raw, { expectedRendererEntryPath, expectedUserDataDir }) {
  const windows = Array.isArray(raw?.windows) ? raw.windows : [];
  const expectedRendererIdentity = rendererPathIdentity(expectedRendererEntryPath);
  const rendererPaths = windows.map((item) => {
    try {
      const parsed = new URL(String(item?.url || ''));
      if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) return null;
      return fileURLToPath(parsed);
    } catch {
      return null;
    }
  });
  const rendererEntryIdentities = rendererPaths.map((filePath) => (
    filePath ? rendererPathIdentity(filePath) : null
  ));
  const rendererExact = windows.length > 0
    && rendererEntryIdentities.every((identity) => identity === expectedRendererIdentity);
  const localhostDetected = windows.some((item) => {
    try {
      const parsed = new URL(String(item?.url || ''));
      return /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(parsed.hostname);
    } catch {
      return true;
    }
  });
  const userDataIdentity = validateEvidenceUserDataIdentity({
    actualUserDataDir: raw?.actualUserDataDir,
    evidenceMode: raw?.evidenceMode,
    expectedMode: PACKAGE_LAUNCH_SMOKE_MODE,
    expectedUserDataDir,
  });
  return {
    allDevToolsClosed: windows.length > 0 && windows.every((item) => item?.devToolsOpened === false),
    evidenceMode: typeof raw?.evidenceMode === 'string' ? raw.evidenceMode : null,
    isPackaged: raw?.isPackaged === true,
    isolatedUserData: userDataIdentity.passed,
    localhostDetected,
    nodeEnv: typeof raw?.nodeEnv === 'string' ? raw.nodeEnv : null,
    rendererEntrySha256: rendererEntryIdentities.length === 1 ? rendererEntryIdentities[0] : null,
    rendererExact,
    rendererScheme: rendererPaths.length === 1 && rendererPaths[0] ? 'file:' : null,
    windowCount: windows.length,
  };
}

async function collectElectronRuntime(electronApp) {
  const page = await electronApp.firstWindow({ timeout: 20_000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
  return electronApp.evaluate(
    ({ app, BrowserWindow }, evidenceModeEnv) => ({
      actualUserDataDir: app.getPath('userData'),
      evidenceMode: process.env[evidenceModeEnv] || null,
      isPackaged: app.isPackaged,
      nodeEnv: process.env.NODE_ENV || null,
      windows: BrowserWindow.getAllWindows()
        .filter((candidate) => !candidate.isDestroyed())
        .map((candidate) => ({
          devToolsOpened: candidate.webContents.isDevToolsOpened(),
          url: candidate.webContents.getURL(),
        })),
    }),
    EVIDENCE_MODE_ENV,
  );
}

function checkRecord(code, passed) {
  return { code, passed: Boolean(passed) };
}

function buildAdversarialNodeEnvEvidence({
  generatedAt = new Date().toISOString(),
  identityAfter,
  identityBefore,
  expected,
  processCleanup,
  runtime,
}) {
  const stableHashMatch = (field) => (
    /^[A-F0-9]{64}$/.test(String(identityBefore?.[field] || ''))
    && identityBefore[field] === identityAfter?.[field]
    && identityAfter[field] === expected[field]
  );
  const checks = [
    checkRecord('PACKAGE_EXECUTABLE_HASH_MATCH', stableHashMatch('executableSha256')),
    checkRecord('PACKAGE_APP_CONTENT_HASH_MATCH', stableHashMatch('appContentSha256')),
    checkRecord('PACKAGE_MAIN_BUNDLE_HASH_MATCH', stableHashMatch('mainBundleSha256')),
    checkRecord('NODE_ENV_DEVELOPMENT_INJECTED', runtime?.nodeEnv === 'development'),
    checkRecord('RUNTIME_IS_PACKAGED', runtime?.isPackaged === true),
    checkRecord(
      'RENDERER_EXACT_PACKAGED_FILE',
      runtime?.rendererExact === true
        && runtime?.rendererScheme === 'file:'
        && runtime?.rendererEntrySha256 === expected.rendererEntrySha256,
    ),
    checkRecord('DEVTOOLS_CLOSED', runtime?.allDevToolsClosed === true),
    checkRecord('LOCALHOST_RENDERER_ABSENT', runtime?.localhostDetected === false),
    checkRecord('ISOLATED_USER_DATA_CONFIRMED', runtime?.isolatedUserData === true),
    checkRecord('PROCESS_CLEANUP_CONFIRMED', processCleanup?.passed === true),
  ];
  const passedCount = checks.filter((check) => check.passed).length;
  return {
    kind: PACKAGE_ADVERSARIAL_NODE_ENV_EVIDENCE_KIND,
    schemaVersion: PACKAGE_ADVERSARIAL_NODE_ENV_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    passed: passedCount === checks.length,
    package: {
      executableSha256: String(identityAfter?.executableSha256 || '').toUpperCase(),
      appContentSha256: String(identityAfter?.appContentSha256 || '').toUpperCase(),
      mainBundleSha256: String(identityAfter?.mainBundleSha256 || '').toUpperCase(),
    },
    runtime: runtime || emptyRuntimeEvidence(),
    processCleanup: {
      afterMatchingCount: Number.isInteger(processCleanup?.afterMatchingCount) ? processCleanup.afterMatchingCount : null,
      attempts: Number.isInteger(processCleanup?.attempts) ? processCleanup.attempts : null,
      beforeMatchingCount: Number.isInteger(processCleanup?.beforeMatchingCount) ? processCleanup.beforeMatchingCount : null,
      passed: processCleanup?.passed === true,
    },
    summary: {
      failed: checks.length - passedCount,
      passed: passedCount,
      total: checks.length,
    },
    checks,
  };
}

function validateAdversarialNodeEnvEvidence(evidence, expected = {}) {
  const violations = [];
  if (!exactFields(evidence, [
    'kind',
    'schemaVersion',
    'generatedAt',
    'passed',
    'package',
    'runtime',
    'processCleanup',
    'summary',
    'checks',
  ])) violations.push('unexpected top-level evidence fields');
  if (evidence?.kind !== PACKAGE_ADVERSARIAL_NODE_ENV_EVIDENCE_KIND) violations.push('unexpected evidence kind');
  if (evidence?.schemaVersion !== PACKAGE_ADVERSARIAL_NODE_ENV_EVIDENCE_SCHEMA_VERSION) {
    violations.push('unexpected evidence schema version');
  }
  if (!Number.isFinite(Date.parse(evidence?.generatedAt))) violations.push('invalid evidence generation time');
  if (!exactFields(evidence?.package, ['executableSha256', 'appContentSha256', 'mainBundleSha256'])) {
    violations.push('unexpected package hash fields');
  }
  for (const field of ['executableSha256', 'appContentSha256', 'mainBundleSha256']) {
    if (!/^[A-F0-9]{64}$/.test(String(evidence?.package?.[field] || ''))) violations.push(`invalid ${field}`);
    if (expected[field] && String(evidence?.package?.[field] || '') !== String(expected[field]).toUpperCase()) {
      violations.push(`package ${field} mismatch`);
    }
  }
  if (!exactFields(evidence?.runtime, [
    'allDevToolsClosed',
    'evidenceMode',
    'isPackaged',
    'isolatedUserData',
    'localhostDetected',
    'nodeEnv',
    'rendererEntrySha256',
    'rendererExact',
    'rendererScheme',
    'windowCount',
  ])) violations.push('unexpected runtime fields');
  if (evidence?.runtime?.evidenceMode !== PACKAGE_LAUNCH_SMOKE_MODE) {
    violations.push('unexpected runtime evidence mode');
  }
  if (evidence?.runtime?.nodeEnv !== 'development') violations.push('runtime NODE_ENV was not development');
  if (evidence?.runtime?.isPackaged !== true) violations.push('runtime was not packaged');
  if (evidence?.runtime?.rendererScheme !== 'file:' || evidence?.runtime?.rendererExact !== true) {
    violations.push('renderer was not the exact packaged file entry');
  }
  if (!/^[A-F0-9]{64}$/.test(String(evidence?.runtime?.rendererEntrySha256 || ''))) {
    violations.push('invalid renderer entry identity');
  }
  if (expected.rendererEntrySha256
    && String(evidence?.runtime?.rendererEntrySha256 || '') !== String(expected.rendererEntrySha256).toUpperCase()) {
    violations.push('renderer entry identity mismatch');
  }
  if (evidence?.runtime?.allDevToolsClosed !== true) violations.push('DevTools was open');
  if (evidence?.runtime?.localhostDetected !== false) violations.push('localhost renderer was detected');
  if (evidence?.runtime?.isolatedUserData !== true) violations.push('isolated userData was not confirmed');
  if (!Number.isInteger(evidence?.runtime?.windowCount) || evidence.runtime.windowCount < 1) {
    violations.push('runtime window count is invalid');
  }
  if (!exactFields(evidence?.processCleanup, ['afterMatchingCount', 'attempts', 'beforeMatchingCount', 'passed'])) {
    violations.push('unexpected process cleanup fields');
  }
  if (evidence?.processCleanup?.passed !== true
    || evidence?.processCleanup?.beforeMatchingCount !== 0
    || evidence?.processCleanup?.afterMatchingCount !== 0
    || !Number.isInteger(evidence?.processCleanup?.attempts)
    || evidence.processCleanup.attempts < 1) {
    violations.push('package process cleanup was not confirmed');
  }
  const checks = Array.isArray(evidence?.checks) ? evidence.checks : [];
  const codes = checks.map((check) => check?.code);
  if (checks.length !== EXPECTED_ADVERSARIAL_NODE_ENV_CHECK_CODES.length
    || codes.some((code, index) => code !== EXPECTED_ADVERSARIAL_NODE_ENV_CHECK_CODES[index])
    || new Set(codes).size !== codes.length) {
    violations.push('unexpected adversarial NODE_ENV check codes');
  }
  if (checks.some((check) => !exactFields(check, ['code', 'passed']) || typeof check.passed !== 'boolean')) {
    violations.push('unexpected check fields');
  }
  const passedCount = checks.filter((check) => check?.passed === true).length;
  const failedCount = checks.length - passedCount;
  if (!exactFields(evidence?.summary, ['total', 'passed', 'failed'])
    || evidence?.summary?.total !== checks.length
    || evidence?.summary?.passed !== passedCount
    || evidence?.summary?.failed !== failedCount) {
    violations.push('summary mismatch');
  }
  if (evidence?.passed !== (checks.length === EXPECTED_ADVERSARIAL_NODE_ENV_CHECK_CODES.length && failedCount === 0)) {
    violations.push('evidence pass state mismatch');
  }
  if (evidence?.passed !== true) violations.push('adversarial NODE_ENV evidence did not pass');
  return { passed: violations.length === 0, violations };
}

async function runAdversarialNodeEnvSmoke(options, dependencies = {}) {
  const collectIdentity = dependencies.collectPackageIdentity || collectPackageIdentity;
  const collectProcesses = dependencies.collectPackageProcesses || ((executablePath) => {
    const { collectMatchingPackageProcesses } = require('./package-ui-evidence');
    return collectMatchingPackageProcesses(executablePath);
  });
  const waitForCleanup = dependencies.waitForPackageCleanup || ((executablePath) => {
    const { waitForPackageProcessCleanup } = require('./package-ui-evidence');
    return waitForPackageProcessCleanup(executablePath);
  });
  const buildLaunchEnvironment = dependencies.buildLaunchEnvironment || buildAdversarialLaunchEnvironment;
  const launchElectron = dependencies.launchElectron || ((launchOptions) => {
    const { _electron } = require('./playwright-loader');
    return _electron.launch(launchOptions);
  });
  const probeRuntime = dependencies.collectElectronRuntime || collectElectronRuntime;
  const expectedRendererEntryPath = path.join(options.appContentPath, 'dist', 'renderer', 'index.html');
  const expected = {
    appContentSha256: options.expectedAppContentSha256,
    executableSha256: options.expectedExeSha256,
    mainBundleSha256: options.expectedMainBundleSha256,
    rendererEntrySha256: rendererPathIdentity(expectedRendererEntryPath),
  };
  const identityBefore = collectIdentity(options);
  const before = collectProcesses(options.executablePath);
  let electronApp = null;
  let rawRuntime = null;
  let cleanup = null;
  try {
    if (before?.passed !== true || before?.matchingCount !== 0 || before?.unresolvedCount !== 0) {
      throw new Error('A matching packaged process was already running or unresolved before the smoke.');
    }
    const env = buildLaunchEnvironment(process.env, options.userDataDir);
    electronApp = await launchElectron({
      cwd: path.dirname(options.executablePath),
      env,
      executablePath: options.executablePath,
      timeout: 30_000,
    });
    rawRuntime = await probeRuntime(electronApp);
  } finally {
    if (electronApp) {
      try {
        await electronApp.close();
      } catch {
        // Cleanup attestation below remains authoritative and fail-closed.
      }
    }
    try {
      cleanup = await waitForCleanup(options.executablePath);
    } catch {
      cleanup = null;
    }
  }
  const identityAfter = collectIdentity(options);
  const runtime = rawRuntime
    ? summarizeRuntimeProbe(rawRuntime, { expectedRendererEntryPath, expectedUserDataDir: options.userDataDir })
    : emptyRuntimeEvidence();
  const processCleanup = {
    afterMatchingCount: Number.isInteger(cleanup?.matchingCount) ? cleanup.matchingCount : null,
    attempts: Number.isInteger(cleanup?.attempts) ? cleanup.attempts : null,
    beforeMatchingCount: Number.isInteger(before?.matchingCount) ? before.matchingCount : null,
    passed: before?.passed === true
      && before?.matchingCount === 0
      && before?.unresolvedCount === 0
      && cleanup?.passed === true
      && cleanup?.matchingCount === 0
      && cleanup?.unresolvedCount === 0,
  };
  return buildAdversarialNodeEnvEvidence({
    identityAfter,
    identityBefore,
    expected,
    processCleanup,
    runtime,
  });
}

async function main(argv = process.argv) {
  if (process.platform !== 'win32') throw new Error('Adversarial NODE_ENV package smoke supports Windows only.');
  const options = parseAdversarialNodeEnvArgs(argv);
  fs.mkdirSync(options.userDataDir, { recursive: true });
  options.userDataDir = validateEvidenceUserDataPath(options.userDataDir);
  let evidence;
  try {
    evidence = await runAdversarialNodeEnvSmoke(options);
  } catch {
    const identity = collectPackageIdentity(options);
    evidence = buildAdversarialNodeEnvEvidence({
      identityAfter: identity,
      identityBefore: identity,
      expected: {
        appContentSha256: options.expectedAppContentSha256,
        executableSha256: options.expectedExeSha256,
        mainBundleSha256: options.expectedMainBundleSha256,
        rendererEntrySha256: rendererPathIdentity(path.join(options.appContentPath, 'dist', 'renderer', 'index.html')),
      },
      processCleanup: { afterMatchingCount: null, attempts: null, beforeMatchingCount: null, passed: false },
      runtime: emptyRuntimeEvidence(),
    });
  }
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Adversarial NODE_ENV package smoke: ${evidence.passed ? 'PASS' : 'FAIL'}`);
  console.log(`Evidence: ${options.out}`);
  if (!evidence.passed) process.exitCode = 1;
  return evidence;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_APP_CONTENT_PATH,
  DEFAULT_EXECUTABLE_PATH,
  DEFAULT_MAIN_BUNDLE_PATH,
  DEFAULT_RENDERER_ENTRY_PATH,
  EXPECTED_ADVERSARIAL_NODE_ENV_CHECK_CODES,
  PACKAGE_ADVERSARIAL_NODE_ENV_CONTRACT_VERSION,
  PACKAGE_ADVERSARIAL_NODE_ENV_EVIDENCE_KIND,
  PACKAGE_ADVERSARIAL_NODE_ENV_EVIDENCE_SCHEMA_VERSION,
  buildAdversarialLaunchEnvironment,
  buildAdversarialNodeEnvEvidence,
  collectElectronRuntime,
  collectPackageIdentity,
  injectAdversarialNodeEnv,
  main,
  parseAdversarialNodeEnvArgs,
  rendererPathIdentity,
  runAdversarialNodeEnvSmoke,
  summarizeRuntimeProbe,
  validateAdversarialNodeEnvBundleSummaryContract,
  validateAdversarialNodeEnvEvidence,
  validateAdversarialNodeEnvManifestEntryContract,
  validateAdversarialNodeEnvSelectionContract,
};
