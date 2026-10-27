// 跨职责调用通过组合入口注入，延迟转发保留单一实现和初始化顺序。
module.exports = function createPackageUiModule(dependencies) {
  const {
    DEFAULT_APP_CONTENT_PATH,
    DEFAULT_EXECUTABLE_PATH,
    DEFAULT_INTERACTIVE_LOGIN_TIMEOUT_MS,
    DEFAULT_OUTPUT_DIR,
    PACKAGED_APP_NAME,
    PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS,
    path,
    spawnSync,
    validateEvidenceUserDataPath,
  } = dependencies;


function decisionsTabAccessibleNamePattern(label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${escaped}(?:（已载入 \\d+）|\\s+(?:生产|适配|原型|受阻|读取中))$`,
  );
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

async function waitForBoundedElectronClose(
  electronApp,
  timeoutMs = PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS,
) {
  if (!electronApp || typeof electronApp.close !== 'function') {
    fail('PACKAGE_UI_ELECTRON_CLOSE_INVALID: Packaged Electron close is unavailable.');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    fail('PACKAGE_UI_ELECTRON_CLOSE_INVALID: Close timeout must be a positive integer.');
  }

  let timeoutId;
  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => electronApp.close())
        .then(() => 'closed'),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), timeoutMs);
      }),
    ]);
    if (outcome === 'timeout') {
      fail(
        'PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT',
        `Packaged Electron did not close within ${timeoutMs}ms.`,
      );
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeRunGroupId(value, name) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,80}$/.test(normalized)) {
    fail(`${name} must be a 6-81 character path-safe identifier.`);
  }
  return normalized;
}

function resolveWindowsKnownFolder(specialFolder, label, run = spawnSync) {
  if (process.platform !== 'win32') {
    fail(`Windows Known Folder lookup for ${label} is supported only on Windows.`);
  }
  if (!new Set(['ApplicationData', 'UserProfile']).has(specialFolder)) {
    fail(`Unsupported Windows Known Folder request for ${label}.`);
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
  if (
    result?.error
    || result?.status !== 0
    || result?.signal
    || !path.isAbsolute(value)
  ) {
    fail(`Windows Known Folder lookup for ${label} failed.`);
  }
  return path.resolve(value);
}

function canonicalPackageUiAuthorityPaths(injected = {}) {
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

function parsePackageUiEvidenceArgs(argv) {
  const values = {
    allowInteractiveLogin: false,
    allowSavedLogin: false,
    appContentPath: DEFAULT_APP_CONTENT_PATH,
    executablePath: DEFAULT_EXECUTABLE_PATH,
    interactiveLoginTimeoutMs: DEFAULT_INTERACTIVE_LOGIN_TIMEOUT_MS,
    loginTimeoutMs: 120_000,
    outputDir: DEFAULT_OUTPUT_DIR,
    resumeInspectionReceiptPath: null,
    resumeRunGroupId: null,
    runGroupId: null,
    settleMs: 800,
    screenReaderExecutablePath: null,
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
      case '--screen-reader-executable':
        if (!path.isAbsolute(value) || path.basename(value).toLowerCase() !== 'nvda.exe' || value.includes('\0')) {
          fail('--screen-reader-executable requires an explicit absolute nvda.exe path.');
        }
        values.screenReaderExecutablePath = path.resolve(value);
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
      case '--authority-selection':
        values.authoritySelectionPath = path.resolve(value);
        break;
      case '--resume-inspection-receipt':
        values.resumeInspectionReceiptPath = path.resolve(value);
        break;
      case '--resume-run-group':
        values.resumeRunGroupId = normalizeRunGroupId(value, name);
        break;
      case '--run-group':
        values.runGroupId = normalizeRunGroupId(value, name);
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
  if (values.runGroupId && values.resumeRunGroupId) {
    fail('--run-group cannot be combined with --resume-run-group.');
  }
  if (!values.userDataDir) fail('--user-data-dir is required and must point to an isolated D-drive profile copy.');
  if (!values.protectedDatabasePath) fail('--protected-db is required so the canonical authority SQLite file is hashed before and after evidence capture.');
  if (!values.authoritySelectionPath) {
    fail('--authority-selection is required and must be the current production authority-selection receipt.');
  }
  if (values.resumeRunGroupId && !values.resumeInspectionReceiptPath) {
    fail('--resume-inspection-receipt is required with --resume-run-group.');
  }
  if (!values.resumeRunGroupId && values.resumeInspectionReceiptPath) {
    fail('--resume-inspection-receipt may be used only with --resume-run-group.');
  }
  if (!values.allowInteractiveLogin) {
    fail('Package UI schema v9 requires --allow-interactive-login; saved-login or existing-session-only capture is historical and unsupported.');
  }
  values.executablePath = path.resolve(values.executablePath);
  values.appContentPath = path.resolve(values.appContentPath);
  values.invocationArgv = [...argv];
  return values;
}

function assertPackageUiRuntimeLoginBoundary(options) {
  if (options?.screenReaderExecutablePath != null && (!path.isAbsolute(options.screenReaderExecutablePath)
    || path.basename(options.screenReaderExecutablePath).toLowerCase() !== 'nvda.exe' || options.screenReaderExecutablePath.includes('\0'))) {
    fail('--screen-reader-executable requires an explicit absolute nvda.exe path.');
  }
  if (options?.allowInteractiveLogin !== true || options?.allowSavedLogin === true) {
    fail(
      'Package UI schema v9 runtime requires the visible secret-blind interactive login boundary; saved-login automation is forbidden.',
    );
  }
  return true;
}

  return {
    decisionsTabAccessibleNamePattern,
    fail,
    argumentValue,
    normalizeSha256,
    parsePositiveInteger,
    waitForBoundedElectronClose,
    normalizeRunGroupId,
    resolveWindowsKnownFolder,
    canonicalPackageUiAuthorityPaths,
    parsePackageUiEvidenceArgs,
    assertPackageUiRuntimeLoginBoundary,
  };
};
