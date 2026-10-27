const { PACKAGE_UI_VIEWPORT, PACKAGE_UI_VIEWPORT_TOLERANCE, PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS, PACKAGE_UI_VIEWPORT_STABILITY_MS, PACKAGE_UI_VIEWPORT_STATE_POLL_MS, PACKAGE_UI_MINIMUM_WINDOW, PACKAGE_UI_NATIVE_GEOMETRY_LIMITS } = require('./package-ui-viewport-contract.cjs');
module.exports = function createPackageUiContracts(runtimeDependencies) {
  const {
    crypto,
    spawnSync,
    fs,
    os,
    path,
    performance,
    fileURLToPath,
    _electron,
    CURRENTNESS_METHOD,
    SQLITE_AUTHORITY_CURRENTNESS_SCHEMA_VERSION,
    runReadonlySqliteOnlineBackupSync,
    cleanupOwnedSqliteTempRoot,
    restrictWindowsTempAcl,
    PRODUCTION_AUTHORITY_SELECTION_KIND,
    PRODUCTION_AUTHORITY_SELECTION_SCHEMA_VERSION,
    inspectProductionAuthoritySelection,
    collectWorkspaceDomMetrics,
    EVIDENCE_MODE_ENV,
    EVIDENCE_USER_DATA_DIR_ENV,
    PACKAGE_UI_EVIDENCE_MODE,
    PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV,
    buildEvidenceUserDataEnv,
    inspectPackagedUserDataOverrideContract,
    validateEvidenceUserDataIdentity,
    validateEvidenceUserDataPath,
  } = runtimeDependencies;

const ROOT = runtimeDependencies.root || path.resolve(__dirname, '..');

const DESKTOP_PACKAGE = runtimeDependencies.desktopPackage || JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'package.json'), 'utf8'));

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

const PACKAGE_UI_EVIDENCE_SCHEMA_VERSION = 9;

const PACKAGE_UI_RUN_GROUP_SCHEMA_VERSION = 'package-ui-run-group/v2';

const PACKAGE_UI_PROFILE_CHECKPOINT_SCHEMA_VERSION = 'package-ui-profile-checkpoint/v2';

const PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION = 'package-ui-profile-attempt/v3';

const PACKAGE_UI_RUNNER_LEASE_SCHEMA_VERSION = 'package-ui-runner-lease/v1';

const PACKAGE_UI_RESUME_INSPECTION_SCHEMA_VERSION = 'package-ui-resume-inspection/v1';

const PACKAGE_UI_ATTEMPT_INVOCATION_SCHEMA_VERSION = 'package-ui-attempt-invocation/v1';

const PACKAGE_UI_INVOCATION_RECEIPT_SCHEMA_VERSION = 'package-ui-invocation-receipt/v1';

const PACKAGED_APP_NAME = '@amazon-ai-ops/desktop';

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

const BUNDLED_CHROMIUM_RELATIVE_PATH = path.join(
  'playwright-browsers',
  'chrome-win64',
  'chrome.exe',
);

const WINDOWS_HARDLINK_ENUMERATION_TIMEOUT_MS = 5_000;

const PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES = 20_000;

const PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS = 2_000_000;

const PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES = 1_024;

const PACKAGE_UI_PROFILE_LOCK_PROBE_TIMEOUT_MS = 60_000;

const PACKAGE_UI_PROFILE_LOCK_INTERNAL_DEADLINE_MS = 45_000;

const PACKAGE_UI_SQLITE_TEMP_ROOT_PREFIX =
  'amazon-ai-ops-package-ui-sqlite-';

const DEFAULT_INTERACTIVE_LOGIN_TIMEOUT_MS = 900_000;

const PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS = 20_000;

const PACKAGE_UI_NATIVE_RUNTIME_CONTRACT = Object.freeze({
  nativeLaunchKind: 'v16-package-ui-native-launch', schemaVersion: 1,
  operationTimeoutMs: PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS,
  mainExitSource: 'native-main-process-handle',
  birthPrecision: 'cim-microsecond+handle-100ns',
  readerExecutableOption: '--screen-reader-executable', readerOptional: true,
  readerBeforeMainClose: true,
});







const DIAGNOSTIC_MESSAGE_LIMIT = 2_000;

const DIAGNOSTIC_STACK_LIMIT = 4_000;

const DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT = 100;

const DIAGNOSTIC_RENDERER_ENTRY_LIMIT = 100;

const SENSITIVE_DIAGNOSTIC_KEY = /^(?:account|api[_-]?key|access[_-]?token|authorization|commandline|cookie|password|passwd|proxy-authorization|pwd|secret|session(?:[_-]?(?:id|key|token))?|set-cookie|token|username|user[_-]?name)$/i;

const REQUIRED_APP_CONTENT_ENTRIES = Object.freeze([
  'package.json',
  'dist/main/index.js',
  'dist/preload/index.js',
  'dist/renderer/index.html',
  'playwright-browsers/chrome-win64/chrome.exe',
]);





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
  Object.freeze({ workspace: 'objects', subview: 'products', label: '产品与广告对象', heading: '产品与广告对象', tabs: Object.freeze(['products', 'targets', 'keywords', 'listing']) }),
  Object.freeze({ workspace: 'collection', subview: 'scope', label: '数据采集', heading: '工作范围', tabs: Object.freeze(['scope', 'reports', 'import-check']) }),
  Object.freeze({ workspace: 'policy', subview: 'rules', label: '策略与风控', heading: '策略与风控', tabs: Object.freeze(['rules']) }),
  Object.freeze({ workspace: 'settings', subview: 'ai-and-local', label: '系统设置', heading: '店铺与运行设置', tabs: Object.freeze(['ai-and-local', 'scheduler', 'delivery']) }),
]);

const EXPECTED_PACKAGE_UI_MODULES = Object.freeze([
  { id: 'today', workspaces: ['today'] },
  { id: 'operations-assets', workspaces: ['objects', 'collection'] },
  { id: 'decision-center', workspaces: ['missions', 'decisions'] },
  { id: 'execution-experiments', workspaces: ['execution', 'experiments'] },
  { id: 'operating-memory', workspaces: ['memory'] },
  { id: 'system-settings', workspaces: ['policy', 'settings'] },
]);

const PACKAGE_UI_SUBVIEW_HEADINGS = Object.freeze({
  'today/events': '运营事件',
  'missions/facts': '运营任务事实链',
  'execution/evidence': '结果核对',
  'objects/targets': '广告对象事实',
  'objects/keywords': '关键词事实与机会',
  'objects/listing': '商品详情内容库',
  'collection/reports': '报表采集',
  'collection/import-check': '导入检查',
  'settings/scheduler': '当前店铺自动化',
  'settings/delivery': '交付验收',
});

const EXPECTED_PACKAGE_UI_ENTRIES = Object.freeze(EXPECTED_PACKAGE_UI_WORKSPACES.flatMap(
  (workspace) => workspace.tabs.map((subview) => Object.freeze({
    ...workspace,
    subview,
    heading: PACKAGE_UI_SUBVIEW_HEADINGS[`${workspace.workspace}/${subview}`] || workspace.heading,
  })),
));

const PACKAGE_UI_WIDE_WORKSPACES = EXPECTED_PACKAGE_UI_ENTRIES;

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

// 保留旧对象队列探针；当前包覆盖六模块的 22 个入口，大表容量另行验证。
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
  workspaces: PACKAGE_UI_WIDE_WORKSPACES,
});

const PACKAGE_UI_PROFILE_SEQUENCE = Object.freeze([
  ...EXPECTED_PACKAGE_UI_SCALES.map((scale) => `${scale.scalePercent}-compact`),
  PACKAGE_UI_WIDE_PROFILE.id,
]);

const EXPECTED_OVERLAY_CHECK_IDS = Object.freeze([
  'report-selector-dialog',
  'decisions-controlled-review-inspector',
  'readback-technical-drawer',
]);

const READ_ONLY_INTERACTION_PLAN = Object.freeze([
  Object.freeze({
    id: 'workspace-navigation',
    kind: 'navigation',
    targets: EXPECTED_PACKAGE_UI_ENTRIES.map((item) => `${item.workspace}/${item.subview}`),
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
    target: '当前店铺的决策能力与会话隔离边界',
    trigger: '查看接入边界',
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
  authorizationStartSignal: 'durable-login-attempt-sequence-or-visible-login-submit-aria-busy-or-authenticated-workspace',
  boundedTimeout: true,
  credentialStorageOwner: 'electron-main-safe-storage',
  deadlineClock: 'monotonic-performance-now',
  durationEvidence: 'monotonic-elapsed-ms',
  firstRunFreshTypedIdentityProof: true,
  maximumTotalTimeoutMultiplier: 2,
  mode: 'visible-operator-each-run',
  phaseModel: 'operator-preparation-then-browser-authorization',
  phaseTimeoutAppliedSeparately: true,
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

  return {
    ...runtimeDependencies,
    ROOT,
    DESKTOP_PACKAGE,
    DEFAULT_EXECUTABLE_PATH,
    DEFAULT_APP_CONTENT_PATH,
    EXPECTED_RENDERER_ENTRY_PATH,
    DEFAULT_OUTPUT_DIR,
    PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    PACKAGE_UI_RUN_GROUP_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_CHECKPOINT_SCHEMA_VERSION,
    PACKAGE_UI_PROFILE_ATTEMPT_SCHEMA_VERSION,
    PACKAGE_UI_RUNNER_LEASE_SCHEMA_VERSION,
    PACKAGE_UI_RESUME_INSPECTION_SCHEMA_VERSION,
    PACKAGE_UI_ATTEMPT_INVOCATION_SCHEMA_VERSION,
    PACKAGE_UI_INVOCATION_RECEIPT_SCHEMA_VERSION,
    PACKAGED_APP_NAME,
    LEGACY_SCHEDULER_READ_ONLY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    LEGACY_PACKAGE_UI_EVIDENCE_SCHEMA_VERSION,
    PACKAGE_UI_SCHEDULER_AUDIT_FILE,
    PACKAGE_UI_EVIDENCE_STORE_DISPLAY_NAME,
    PACKAGE_UI_SCHEDULER_COUNT_KEYS,
    PACKAGE_PROCESS_NAME,
    PROFILE_BROWSER_PROCESS_NAMES,
    BUNDLED_CHROMIUM_RELATIVE_PATH,
    WINDOWS_HARDLINK_ENUMERATION_TIMEOUT_MS,
    PACKAGE_UI_PROFILE_LOCK_MAX_ENTRIES,
    PACKAGE_UI_PROFILE_LOCK_MAX_PATH_CHARACTERS,
    PACKAGE_UI_PROFILE_LOCK_MAX_CRITICAL_ENTRIES,
    PACKAGE_UI_PROFILE_LOCK_PROBE_TIMEOUT_MS,
    PACKAGE_UI_PROFILE_LOCK_INTERNAL_DEADLINE_MS,
    PACKAGE_UI_SQLITE_TEMP_ROOT_PREFIX,
    DEFAULT_INTERACTIVE_LOGIN_TIMEOUT_MS,
    PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS,
    PACKAGE_UI_NATIVE_RUNTIME_CONTRACT,
    PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS,
    PACKAGE_UI_VIEWPORT_STABILITY_MS,
    PACKAGE_UI_VIEWPORT_STATE_POLL_MS,
    DIAGNOSTIC_MESSAGE_LIMIT,
    DIAGNOSTIC_STACK_LIMIT,
    DIAGNOSTIC_LIFECYCLE_ENTRY_LIMIT,
    DIAGNOSTIC_RENDERER_ENTRY_LIMIT,
    SENSITIVE_DIAGNOSTIC_KEY,
    REQUIRED_APP_CONTENT_ENTRIES,
    PACKAGE_UI_VIEWPORT,
    PACKAGE_UI_MINIMUM_WINDOW,
    PACKAGE_UI_NATIVE_GEOMETRY_LIMITS,
    PACKAGE_UI_VIEWPORT_TOLERANCE,
    EXPECTED_PACKAGE_UI_SCALES,
    EXPECTED_PACKAGE_UI_WORKSPACES,
    EXPECTED_PACKAGE_UI_MODULES,
    PACKAGE_UI_SUBVIEW_HEADINGS,
    EXPECTED_PACKAGE_UI_ENTRIES,
    PACKAGE_UI_WIDE_WORKSPACES,
    EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS,
    PACKAGE_OBJECT_WORKSPACES,
    PACKAGE_OBJECT_EXPERIENCE_CONTRACTS,
    PACKAGE_UI_WIDE_PROFILE,
    PACKAGE_UI_PROFILE_SEQUENCE,
    EXPECTED_OVERLAY_CHECK_IDS,
    READ_ONLY_INTERACTION_PLAN,
    INTERACTIVE_LOGIN_CONTRACT,
    ISOLATED_PROFILE_BOOTSTRAP_CONTRACT,
    OVERLAY_FOCUSABLE_SELECTOR,
    PACKAGE_UI_DATABASE_CHECKPOINT_PHASES,
    PACKAGE_UI_DATABASE_METRIC_KEYS,
    PACKAGE_UI_DATABASE_COMPARISON_KEYS,
  };
};
