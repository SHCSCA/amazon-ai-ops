const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE_MODE_ENV = 'AMAZON_AI_OPS_EVIDENCE_MODE';
const EVIDENCE_USER_DATA_DIR_ENV = 'AMAZON_AI_OPS_USER_DATA_DIR';
const PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV =
  'AMAZON_AI_OPS_PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF';
const PACKAGE_UI_EVIDENCE_MODE = 'package-ui';
const PACKAGE_LAUNCH_SMOKE_MODE = 'package-launch-smoke';
const EVIDENCE_USER_DATA_LOG_PREFIX = '[App] evidence-user-data ';
const EVIDENCE_USER_DATA_RUNTIME_MARKER = 'evidence-user-data-runtime.json';
const ALLOWED_USER_DATA_ROOT = 'D:\\Temp';
const ALLOWED_TOP_LEVEL_SEGMENT = /^amazon-ai-ops(?:-|$)/i;

function normalizeWindowsPath(filePath) {
  return path.win32.normalize(filePath).replace(/[\\/]+$/, '').toLowerCase();
}

function validateEvidenceUserDataPath(requestedPath, options = {}) {
  const value = String(requestedPath || '');
  if (!value || value !== value.trim() || value.includes('\0')) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must be a non-empty path without surrounding whitespace or NUL bytes.`);
  }
  const normalized = path.win32.normalize(value);
  if (!path.win32.isAbsolute(normalized) || normalized.startsWith('\\\\')) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must be an absolute local Windows path.`);
  }
  if (path.win32.parse(normalized).root.toUpperCase() !== 'D:\\') {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must be located on the D: drive.`);
  }
  if (normalized.slice(2).includes(':')) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} may not contain an alternate data stream.`);
  }
  const relative = path.win32.relative(ALLOWED_USER_DATA_ROOT, normalized);
  if (!relative || relative.startsWith('..\\') || relative === '..' || path.win32.isAbsolute(relative)) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must be a child of ${ALLOWED_USER_DATA_ROOT}.`);
  }
  if (!ALLOWED_TOP_LEVEL_SEGMENT.test(relative.split('\\')[0])) {
    throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must use an amazon-ai-ops-prefixed directory under ${ALLOWED_USER_DATA_ROOT}.`);
  }

  const requireExisting = options.requireExisting !== false;
  if (requireExisting) {
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} must already exist as a directory before Electron starts.`);
    }
    const realPath = path.win32.normalize(fs.realpathSync.native(normalized));
    validateEvidenceUserDataPath(realPath, { requireExisting: false });
    if (normalizeWindowsPath(realPath) !== normalizeWindowsPath(normalized)) {
      throw new Error(`${EVIDENCE_USER_DATA_DIR_ENV} may not traverse a symlink or junction.`);
    }
    return realPath;
  }
  return normalized;
}

function buildEvidenceUserDataEnv(baseEnv, mode, userDataDir) {
  if (![PACKAGE_UI_EVIDENCE_MODE, PACKAGE_LAUNCH_SMOKE_MODE].includes(mode)) {
    throw new Error(`Unsupported packaged evidence mode: ${mode}`);
  }
  const validated = validateEvidenceUserDataPath(userDataDir);
  return {
    ...baseEnv,
    [EVIDENCE_MODE_ENV]: mode,
    [EVIDENCE_USER_DATA_DIR_ENV]: validated,
  };
}

function validateEvidenceUserDataIdentity({ actualUserDataDir, evidenceMode, expectedMode, expectedUserDataDir }) {
  const violations = [];
  let expected;
  let actual;
  try {
    expected = validateEvidenceUserDataPath(expectedUserDataDir, { requireExisting: false });
  } catch (error) {
    violations.push({ code: 'EXPECTED_USER_DATA_UNSAFE', message: String(error?.message || error) });
  }
  try {
    actual = validateEvidenceUserDataPath(actualUserDataDir, { requireExisting: false });
  } catch (error) {
    violations.push({ code: 'ACTUAL_USER_DATA_UNSAFE', message: String(error?.message || error) });
  }
  if (String(evidenceMode || '') !== String(expectedMode || '')) {
    violations.push({
      code: 'EVIDENCE_MODE_MISMATCH',
      message: 'The packaged runtime evidence mode does not match the requested mode.',
      actual: evidenceMode || null,
      expected: expectedMode || null,
    });
  }
  if (actual && expected && normalizeWindowsPath(actual) !== normalizeWindowsPath(expected)) {
    violations.push({
      code: 'USER_DATA_PATH_MISMATCH',
      message: 'Electron app.getPath(\'userData\') does not match the explicit isolated path.',
      actual,
      expected,
    });
  }
  return { actualUserDataDir: actual || actualUserDataDir || null, expectedUserDataDir: expected || expectedUserDataDir || null, passed: violations.length === 0, violations };
}

function parseEvidenceUserDataLog(output) {
  const lines = String(output || '').split(/\r?\n/);
  for (const line of lines) {
    const markerIndex = line.indexOf(EVIDENCE_USER_DATA_LOG_PREFIX);
    if (markerIndex < 0) continue;
    try {
      return JSON.parse(line.slice(markerIndex + EVIDENCE_USER_DATA_LOG_PREFIX.length));
    } catch {
      return null;
    }
  }
  return null;
}

function readEvidenceUserDataRuntimeMarker(userDataDir) {
  const validated = validateEvidenceUserDataPath(userDataDir);
  const markerPath = path.join(validated, EVIDENCE_USER_DATA_RUNTIME_MARKER);
  if (!fs.existsSync(markerPath)) return { marker: null, markerPath };
  try {
    return { marker: JSON.parse(fs.readFileSync(markerPath, 'utf8')), markerPath };
  } catch (error) {
    return { error: String(error?.message || error), marker: null, markerPath };
  }
}

function inspectPackagedUserDataOverrideContract(mainBundlePath) {
  const filePath = path.resolve(mainBundlePath);
  const violations = [];
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    violations.push({ code: 'MAIN_BUNDLE_MISSING', message: 'Packaged main bundle is missing.', filePath });
    return { filePath, passed: false, violations };
  }
  const source = fs.readFileSync(filePath, 'utf8');
  const requirements = [
    [EVIDENCE_MODE_ENV, 'EVIDENCE_MODE_ENV_MISSING'],
    [EVIDENCE_USER_DATA_DIR_ENV, 'USER_DATA_DIR_ENV_MISSING'],
    [EVIDENCE_USER_DATA_RUNTIME_MARKER, 'RUNTIME_MARKER_MISSING'],
    [PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV, 'PACKAGE_UI_FRESH_TYPED_PROOF_ENV_MISSING'],
  ];
  for (const [marker, code] of requirements) {
    if (!source.includes(marker)) violations.push({ code, message: `Packaged main bundle is missing ${marker}.`, filePath });
  }
  if (!/\.setPath\(["']userData["']/.test(source)) {
    violations.push({ code: 'APP_SET_PATH_MISSING', message: 'Packaged main bundle does not bind Electron userData with app.setPath.', filePath });
  }
  return { filePath, passed: violations.length === 0, violations };
}

module.exports = {
  ALLOWED_USER_DATA_ROOT,
  EVIDENCE_MODE_ENV,
  EVIDENCE_USER_DATA_DIR_ENV,
  EVIDENCE_USER_DATA_LOG_PREFIX,
  EVIDENCE_USER_DATA_RUNTIME_MARKER,
  PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV,
  PACKAGE_LAUNCH_SMOKE_MODE,
  PACKAGE_UI_EVIDENCE_MODE,
  buildEvidenceUserDataEnv,
  inspectPackagedUserDataOverrideContract,
  normalizeWindowsPath,
  parseEvidenceUserDataLog,
  readEvidenceUserDataRuntimeMarker,
  validateEvidenceUserDataIdentity,
  validateEvidenceUserDataPath,
};
