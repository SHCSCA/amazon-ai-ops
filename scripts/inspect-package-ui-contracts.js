module.exports = function createInspectorContracts(runtimeDependencies) {
  const {
    crypto,
    fs,
    os,
    path,
    spawnSync,
    CURRENTNESS_METHOD,
    SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
    runReadonlySqliteOnlineBackupSync,
    cleanupOwnedSqliteTempRoot,
    restrictWindowsTempAcl,
    validateEvidenceUserDataPath,
  } = runtimeDependencies;

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

  return {
    ...runtimeDependencies,
    ROOT,
    RUN_GROUP_SCHEMA,
    CHECKPOINT_SCHEMA,
    ATTEMPT_SCHEMA,
    ATTEMPT_INVOCATION_SCHEMA,
    INVOCATION_RECEIPT_SCHEMA,
    RESUME_INSPECTION_SCHEMA,
    PROFILE_SEQUENCE,
    EXPECTED_OVERLAY_IDS,
    BUNDLED_CHROMIUM_RELATIVE_PATH,
    DEFAULT_EXE,
    DEFAULT_APP_CONTENT,
    PACKAGED_APP_NAME,
    TEMP_ROOT_PREFIX,
    DIAGNOSTIC_MESSAGE_LIMIT,
    DIAGNOSTIC_STACK_LIMIT,
    DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT,
    PROFILE_LOCK_MAX_ENTRIES,
    PROFILE_LOCK_MAX_PATH_CHARACTERS,
    PROFILE_LOCK_MAX_CRITICAL_ENTRIES,
    SENSITIVE_DIAGNOSTIC_KEY,
    ALLOWED_RUN_GROUP_ENTRIES,
    USAGE,
    InspectionError,
  };
};
