const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MAIN_BUNDLE_PATH = path.join(
  ROOT,
  'apps',
  'desktop',
  'release',
  'win-unpacked',
  'resources',
  'app',
  'dist',
  'main',
  'index.js',
);
const DEFAULT_SETTINGS_REPOSITORY_PATH = path.join(
  ROOT,
  'packages',
  'local-db',
  'src',
  'sqlite',
  'repositories',
  'settings-repo.ts',
);
const DEFAULT_SQLITE_DB_PATH = path.join(
  ROOT,
  'packages',
  'local-db',
  'src',
  'sqlite',
  'db.ts',
);

const NAVIGATION_SECURITY_MARKER = 'amazon-ai-ops:navigation-security/v1';
const LEGACY_LOGIN_MIGRATION_MARKER = 'amazon-ai-ops:legacy-login-migration/v1';
const EXPECTED_PACKAGE_SECURITY_CHECK_CODES = Object.freeze([
  'PACKAGE_EXECUTABLE_HASH_MATCH',
  'PACKAGE_APP_CONTENT_HASH_MATCH',
  'PACKAGE_MAIN_BUNDLE_HASH_VALID',
  'NAVIGATION_SECURITY_MARKER_PRESENT',
  'LEGACY_LOGIN_MIGRATION_MARKER_PRESENT',
  'PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT',
  'NAVIGATION_GUARDS_WIRED',
  'LEGACY_SAVED_PASSWORD_IPC_ABSENT',
  'DIRECT_EXTERNAL_URL_FORWARDING_ABSENT',
  'PLAINTEXT_CREDENTIAL_WRITER_ABSENT',
  'SQLITE_VERBOSE_LOGGING_ABSENT',
]);

function normalizeSha256(value, label) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character SHA-256 value`);
  }
  return normalized;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function parsePackageSecurityBoundaryArgs(argv) {
  const allowed = new Set(['expected-exe-sha256', 'expected-app-content-sha256', 'out']);
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
  if (!parsed['expected-exe-sha256']) throw new Error('Missing required --expected-exe-sha256');
  if (!parsed['expected-app-content-sha256']) throw new Error('Missing required --expected-app-content-sha256');
  if (!parsed.out) throw new Error('Missing required --out');
  return {
    expectedExeSha256: normalizeSha256(parsed['expected-exe-sha256'], '--expected-exe-sha256'),
    expectedAppContentSha256: normalizeSha256(
      parsed['expected-app-content-sha256'],
      '--expected-app-content-sha256',
    ),
    out: parsed.out,
  };
}

function checkRecord(code, passed) {
  return { code, passed: Boolean(passed) };
}

function collectPackageSecurityBoundaries(options) {
  const packageHashes = options?.packageHashes || {};
  const executableSha256 = normalizeSha256(packageHashes.exeSha256, 'package executable hash');
  const appContentSha256 = normalizeSha256(packageHashes.appContentSha256, 'package app-content hash');
  const expectedExeSha256 = normalizeSha256(options?.expectedExeSha256, 'expected package executable hash');
  const expectedAppContentSha256 = normalizeSha256(
    options?.expectedAppContentSha256,
    'expected package app-content hash',
  );
  const mainBundleText = fs.readFileSync(options.mainBundlePath, 'utf8');
  const settingsRepositoryText = fs.readFileSync(options.settingsRepositoryPath, 'utf8');
  const sqliteDbText = fs.readFileSync(options.sqliteDbPath, 'utf8');
  const mainBundleSha256 = sha256File(options.mainBundlePath);

  const directExternalUrlForwarding = /setWindowOpenHandler\s*\(\s*\(\s*\{\s*url\s*\}\s*\)\s*=>[\s\S]{0,500}?\bshell\s*\.\s*openExternal\s*\(\s*url\s*\)/
    .test(mainBundleText);
  const plaintextCredentialWriter = /\bsaveCredentials\s*\(/.test(settingsRepositoryText)
    || /\b(?:this\s*\.\s*)?set\s*\(\s*['"]login_password['"]/.test(settingsRepositoryText);
  const sqliteVerboseLogging = /\bverbose\s*:\s*console\s*\.\s*log\b/.test(sqliteDbText);
  const packagedDevDowngradeGuard = /const\s+development\s*=\s*!\s*[\w$.]+\s*\.\s*isPackaged\s*&&\s*process\s*\.\s*env\s*\.\s*NODE_ENV\s*===\s*['"]development['"]/
    .test(mainBundleText);
  const navigationGuardsWired = /webContents\s*\.\s*on\s*\(\s*['"]will-navigate['"]\s*,\s*createMainWindowNavigationHandler/.test(mainBundleText)
    && /webContents\s*\.\s*on\s*\(\s*['"]will-redirect['"]\s*,\s*createMainWindowNavigationHandler/.test(mainBundleText)
    && /webContents\s*\.\s*setWindowOpenHandler\s*\(\s*createSecureWindowOpenHandler/.test(mainBundleText);
  const legacySavedPasswordIpcAbsent = !mainBundleText.includes('browser:get-saved-credentials')
    && mainBundleText.includes('browser:get-saved-credential-status');
  const checks = [
    checkRecord('PACKAGE_EXECUTABLE_HASH_MATCH', executableSha256 === expectedExeSha256),
    checkRecord('PACKAGE_APP_CONTENT_HASH_MATCH', appContentSha256 === expectedAppContentSha256),
    checkRecord('PACKAGE_MAIN_BUNDLE_HASH_VALID', /^[A-F0-9]{64}$/.test(mainBundleSha256)),
    checkRecord('NAVIGATION_SECURITY_MARKER_PRESENT', mainBundleText.includes(NAVIGATION_SECURITY_MARKER)),
    checkRecord('LEGACY_LOGIN_MIGRATION_MARKER_PRESENT', mainBundleText.includes(LEGACY_LOGIN_MIGRATION_MARKER)),
    checkRecord('PACKAGED_DEV_DOWNGRADE_GUARD_PRESENT', packagedDevDowngradeGuard),
    checkRecord('NAVIGATION_GUARDS_WIRED', navigationGuardsWired),
    checkRecord('LEGACY_SAVED_PASSWORD_IPC_ABSENT', legacySavedPasswordIpcAbsent),
    checkRecord('DIRECT_EXTERNAL_URL_FORWARDING_ABSENT', !directExternalUrlForwarding),
    checkRecord('PLAINTEXT_CREDENTIAL_WRITER_ABSENT', !plaintextCredentialWriter),
    checkRecord('SQLITE_VERBOSE_LOGGING_ABSENT', !sqliteVerboseLogging),
  ];
  const passedCount = checks.filter((check) => check.passed).length;
  return {
    kind: 'package-security-boundaries',
    schemaVersion: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    passed: passedCount === checks.length,
    package: {
      executableSha256,
      appContentSha256,
      mainBundleSha256,
    },
    summary: {
      total: checks.length,
      passed: passedCount,
      failed: checks.length - passedCount,
    },
    checks,
  };
}

function exactFields(value, expectedFields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function validatePackageSecurityEvidence(evidence, expectedHashes = {}) {
  const violations = [];
  if (!exactFields(evidence, ['kind', 'schemaVersion', 'generatedAt', 'passed', 'package', 'summary', 'checks'])) {
    violations.push('unexpected top-level evidence fields');
  }
  if (evidence?.kind !== 'package-security-boundaries') violations.push('unexpected evidence kind');
  if (evidence?.schemaVersion !== 1) violations.push('unexpected evidence schema version');
  if (!Number.isFinite(Date.parse(evidence?.generatedAt))) violations.push('invalid evidence generation time');
  if (typeof evidence?.passed !== 'boolean') violations.push('evidence passed must be boolean');

  if (!exactFields(evidence?.package, ['executableSha256', 'appContentSha256', 'mainBundleSha256'])) {
    violations.push('unexpected package hash fields');
  }
  for (const field of ['executableSha256', 'appContentSha256', 'mainBundleSha256']) {
    if (!/^[A-F0-9]{64}$/.test(String(evidence?.package?.[field] || ''))) {
      violations.push(`invalid ${field}`);
    }
  }
  if (expectedHashes.executableSha256
    && String(evidence?.package?.executableSha256 || '') !== String(expectedHashes.executableSha256).toUpperCase()) {
    violations.push('package executable hash mismatch');
  }
  if (expectedHashes.appContentSha256
    && String(evidence?.package?.appContentSha256 || '') !== String(expectedHashes.appContentSha256).toUpperCase()) {
    violations.push('package app-content hash mismatch');
  }
  if (expectedHashes.mainBundleSha256
    && String(evidence?.package?.mainBundleSha256 || '') !== String(expectedHashes.mainBundleSha256).toUpperCase()) {
    violations.push('package main-bundle hash mismatch');
  }

  const checks = Array.isArray(evidence?.checks) ? evidence.checks : [];
  if (checks.length !== EXPECTED_PACKAGE_SECURITY_CHECK_CODES.length) {
    violations.push('unexpected package security check count');
  }
  const codes = checks.map((check) => check?.code);
  if (new Set(codes).size !== codes.length
    || codes.some((code, index) => code !== EXPECTED_PACKAGE_SECURITY_CHECK_CODES[index])) {
    violations.push('unexpected package security check codes');
  }
  if (checks.some((check) => !exactFields(check, ['code', 'passed']) || typeof check.passed !== 'boolean')) {
    violations.push('unexpected package security check fields');
  }
  const passedCount = checks.filter((check) => check?.passed === true).length;
  const failedCount = checks.length - passedCount;
  if (!exactFields(evidence?.summary, ['total', 'passed', 'failed'])
    || evidence?.summary?.total !== checks.length
    || evidence?.summary?.passed !== passedCount
    || evidence?.summary?.failed !== failedCount) {
    violations.push('package security summary mismatch');
  }
  if (evidence?.passed !== (checks.length === EXPECTED_PACKAGE_SECURITY_CHECK_CODES.length && failedCount === 0)) {
    violations.push('package security pass state mismatch');
  }
  if (evidence?.passed !== true) violations.push('package security evidence did not pass');
  return { passed: violations.length === 0, violations };
}

function main(argv = process.argv) {
  const args = parsePackageSecurityBoundaryArgs(argv);
  const { collectFixedPackageHashes } = require('./package-ui-evidence');
  const packageHashes = collectFixedPackageHashes();
  const evidence = collectPackageSecurityBoundaries({
    packageHashes,
    expectedExeSha256: args.expectedExeSha256,
    expectedAppContentSha256: args.expectedAppContentSha256,
    mainBundlePath: DEFAULT_MAIN_BUNDLE_PATH,
    settingsRepositoryPath: DEFAULT_SETTINGS_REPOSITORY_PATH,
    sqliteDbPath: DEFAULT_SQLITE_DB_PATH,
  });
  const outputPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`Package security boundary evidence: ${evidence.passed ? 'PASS' : 'FAIL'}`);
  console.log(`Evidence: ${outputPath}`);
  if (!evidence.passed) process.exitCode = 1;
  return evidence;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_MAIN_BUNDLE_PATH,
  DEFAULT_SETTINGS_REPOSITORY_PATH,
  DEFAULT_SQLITE_DB_PATH,
  EXPECTED_PACKAGE_SECURITY_CHECK_CODES,
  LEGACY_LOGIN_MIGRATION_MARKER,
  NAVIGATION_SECURITY_MARKER,
  collectPackageSecurityBoundaries,
  main,
  parsePackageSecurityBoundaryArgs,
  validatePackageSecurityEvidence,
};
