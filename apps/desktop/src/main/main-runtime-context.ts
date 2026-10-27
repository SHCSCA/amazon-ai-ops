import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import type { Page } from 'playwright';
import { BrowserController, BrowserLeaseManager } from '@amazon-ai-ops/browser-worker';
import { DEFAULT_RULE_CONFIG } from '@amazon-ai-ops/rules-engine';
import type { StoreConnection, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createBeforeQuitCoordinator, invokeShutdownOperationNow } from './app-shutdown';
import { createAppLifecycleRecoveryController } from './app-lifecycle-recovery';
import { createDesktopWindowFactory } from './desktop-window';
import { runtimeLogger } from './runtime-logger';
import { runtimeLog } from './runtime-log-adapter';
import { MainIpcOperationTracker } from './main-ipc-operation-tracker';
import { createTrackedIpcRegistrar } from './tracked-ipc-handler';
import { StrictBrowserControllerCleanup } from './strict-browser-controller-cleanup';
import { initializeDesktopBootstrap } from './desktop-bootstrap';
import { PackageUiSchedulerAudit } from './package-ui-scheduler-audit';
import { createDeliveryRuntime } from './delivery-runtime';
import { createDeliveryBundleExporter } from './delivery-bundle-export';
import { type LoginCredentialCipher } from './login-credentials';
import { type AiKeyCipher } from './ai-key-persistence';
import { storeContextTracker } from './v16-store-context-guard';
import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';
import { StoreMutationLane, VisibleBrowserRuntimeRegistry, type AmazonAdsVisibleIdentityClaim } from './visible-browser-runtime-registry';
import { MainArtifactRegistry } from './main-artifact-registry';
import { authorizePackageUiDatabaseCheckpoint } from './main-package-ui-authority-runtime';
import { handleGetOperationScope, normalizePersistedOperationScope } from './main-delivery-scope-runtime';
import { currentStoreScopedReadbackAccess } from './main-store-access-runtime';
import { validateCurrentAdReadbackEvidenceAuthority } from './main-ad-readback-authority-runtime';
import { handleExportDataReconciliation } from './main-data-reconciliation-runtime';
import { stopStoreBusinessDateAuthorityMonitor } from './main-store-context-runtime';
import { clearBrowserLoginState, closeBrowserControllers, invalidatePendingBrowserLogin } from './main-browser-session-runtime';
import type { AdsSessionResult, AppState } from './main-runtime-contracts';

interface MutableMainRuntimeBindings {
  packageUiFreshTypedProof: Readonly<{
  storeId: string;
  username: string;
}> | null;
  mainWindow: BrowserWindow | null;
  lastPublishedStoreContext: StoreContextEnvelope | null;
  storeBusinessDateAuthorityTimer: ReturnType<typeof setInterval> | null;
  browserLoginAttempt: number;
  pendingBrowserLogin: {
  attemptId: number;
  context: StoreContextEnvelope;
  controllers: Set<BrowserController>;
} | null;
  pendingAmazonAdsIdentityConfirmation: {
  token: string;
  context: StoreContextEnvelope;
  runtimeId: string;
  runtimeEpoch: number;
  claim: AmazonAdsVisibleIdentityClaim;
  connection: StoreConnection;
  detectedExternalAccountId: string;
  detectedAccountLabel?: string;
  expectedStoreAlias: string;
  profileEvidenceUrl: string;
  adsSession: AdsSessionResult;
} | null;
  pendingAmazonAdsIdentityRetry: {
  context: StoreContextEnvelope;
  runtimeId: string;
  runtimeEpoch: number;
  claim: AmazonAdsVisibleIdentityClaim;
} | null;
}

// 所有可变运行状态只创建一次；领域函数按调用读取同一对象，授权查询仍留在原事务。
export function createMainRuntimeContext(mainModulePath: string) {
const state: AppState = {
  scheduler: null,
  db: null,
  configurationBus: null,
  productRepo: null,
  actionLogRepo: null,
  adMetricsRepo: null,
  recommendationRepo: null,
  operationEventRepo: null,
  reportFileRepo: null,
  aiCallLogRepo: null,
  aiDiagnosisRunRepo: null,
  storeRepo: null,
  lingxingImportRepo: null,
  missionDomainRepo: null,
  missionDomainService: null,
  analysisAuthorityRepo: null,
  analysisAuthorityService: null,
  executionAuthorityRepo: null,
  executionAuthorityService: null,
  lingxingCollectionCoordinator: null,
  lingxingCollectionOperations: null,
  storeCoordinator: null,
  storeDailyStatusReader: null,
  storeScopedAdListingService: null,
  storeRuntimeConfigService: null,
  storeCollectionAutomationService: null,
  storeEvidenceRetentionService: null,
  storeCollectionMainRuntime: null,
  storeCollectionOrchestrator: null,
  storeCollectionSchedulerReadModel: null,
  ruleConfig: DEFAULT_RULE_CONFIG,
  isLoggedIn: false,
  currentStore: '',
  loginSession: null,


};

const browserOperationLeases = new BrowserLeaseManager();

const visibleBrowserRuntimeRegistry = new VisibleBrowserRuntimeRegistry();

const expectedVisibleRuntimeCloseIds = new Set<string>();

const storeMutationLane = new StoreMutationLane();

const storeCollectionPolicySuppression = new StoreCollectionPolicySuppressionController();

const STORE_COLLECTION_ORCHESTRATOR_HISTORY_KEY = 'store_collection_orchestrator_history_v5';

const executionPolicyDispatchSuppression = Object.freeze({
  isPolicyDispatchSuppressed: (): boolean => (
    state.storeCollectionMainRuntime?.isPolicyDispatchSuppressed()
    ?? storeCollectionPolicySuppression.isPolicyDispatchSuppressed()
  ),
});

const cancelledLingxingCollectionRequests = new Set<string>();

const mainArtifactRegistry = new MainArtifactRegistry();

const mainIpcOperationTracker = new MainIpcOperationTracker();

const pendingBrowserControllerCleanup = new StrictBrowserControllerCleanup<BrowserController>();

const registerTrackedIpcHandler = createTrackedIpcRegistrar(
  ipcMain,
  mainIpcOperationTracker,
  runtimeLogger,
);

const trackedIpcRegistrar = Object.freeze({
  handle(
    channel: string,
    listener: (event: unknown, input?: unknown) => unknown,
  ): void {
    registerTrackedIpcHandler(channel, (event, input) => listener(event, input));
  },
});

const desktopBootstrap = initializeDesktopBootstrap(app, {
  repositoryRoot: process.cwd(),
  executablePath: process.execPath,
  mainModulePath,
});

const bootstrapConfiguration = desktopBootstrap.configuration;

const mainStartupAdmission = desktopBootstrap.admission;

const evidenceUserDataIdentity = bootstrapConfiguration.evidenceIdentity;

const packageUiReadOnlyRuntime = bootstrapConfiguration.packageUiReadOnly;

const packageUiFreshTypedProofRequired = bootstrapConfiguration.packageUiFreshTypedProofRequired;

let packageUiFreshTypedProof: Readonly<{
  storeId: string;
  username: string;
}> | null = null;

const packageLaunchSmokeRuntime = bootstrapConfiguration.packageLaunchSmoke;

const {
  userDataDir: USER_DATA_DIR,
  storageDir: STORAGE_DIR,
  storesDir: STORES_DIR,
  screenshotsDir: SCREENSHOTS_DIR,
  domSnapshotsDir: DOM_SNAPSHOTS_DIR,
  tracesDir: TRACES_DIR,
  reportsDir: REPORTS_DIR,
  downloadsDir: DOWNLOADS_DIR,
  exportsDir: EXPORTS_DIR,
  deliveryBundlesDir: DELIVERY_BUNDLES_DIR,
  repositoryRoot: REPO_ROOT_DIR,
  codexEvidenceDir: CODEX_EVIDENCE_DIR,
  pageModelsDir: PAGE_MODELS_DIR,
  databasePath: DB_PATH,
} = bootstrapConfiguration.paths;

const packageUiSchedulerAudit = new PackageUiSchedulerAudit({
  enabled: packageUiReadOnlyRuntime,
  evidenceMode: evidenceUserDataIdentity.mode,
  database: () => state.db,
  authorizeDatabaseCheckpoint: () => authorizePackageUiDatabaseCheckpoint(),
  userDataDir: USER_DATA_DIR,
});

const DOWNLOAD_CENTER_PAGE_MODEL_FILENAME = 'lingxing-download-center.json';

const DOWNLOAD_CENTER_PAGE_MODEL_OVERRIDE_FILENAME = 'lingxing-download-center.override.json';

const STORE_SESSION_GENERATION_SETTING_PREFIX = 'store_session_generation:';

const OPERATOR_WORKSPACE_SELECTION_SETTING_KEY = 'operator_workspace_selection:v1';

const APP_VERSION = '1.6.0';

const RECOMMENDATION_METRIC_LOAD_LIMIT = 5000;

let mainWindow: BrowserWindow | null = null;

let lastPublishedStoreContext: StoreContextEnvelope | null = null;

let storeBusinessDateAuthorityTimer: ReturnType<typeof setInterval> | null = null;

const STORE_BUSINESS_DATE_AUTHORITY_POLL_MS = 30_000;

const createWindow = createDesktopWindowFactory({
  development: bootstrapConfiguration.development,
  preloadPath: bootstrapConfiguration.paths.preloadPath,
  rendererFilePath: bootstrapConfiguration.paths.rendererFilePath,
  userDataDir: USER_DATA_DIR,
  packageLaunchSmoke: packageLaunchSmokeRuntime,
  onCreated: (window) => { mainWindow = window; },
  onClosed: (window) => { if (mainWindow === window) mainWindow = null; },
});

const electronLoginCredentialCipher: LoginCredentialCipher & AiKeyCipher = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (value: string) => `safe:${safeStorage.encryptString(value).toString('base64')}`,
  decrypt: (value: string) => {
    if (!value.startsWith('safe:')) {
      throw new Error('invalid encrypted credential envelope');
    }
    const payload = value.slice(5);
    return safeStorage.decryptString(Buffer.from(payload, 'base64'));
  },
};

let browserLoginAttempt = 0;

let pendingBrowserLogin: {
  attemptId: number;
  context: StoreContextEnvelope;
  controllers: Set<BrowserController>;
} | null = null;

let pendingAmazonAdsIdentityConfirmation: {
  token: string;
  context: StoreContextEnvelope;
  runtimeId: string;
  runtimeEpoch: number;
  claim: AmazonAdsVisibleIdentityClaim;
  connection: StoreConnection;
  detectedExternalAccountId: string;
  detectedAccountLabel?: string;
  expectedStoreAlias: string;
  profileEvidenceUrl: string;
  adsSession: AdsSessionResult;
} | null = null;

let pendingAmazonAdsIdentityRetry: {
  context: StoreContextEnvelope;
  runtimeId: string;
  runtimeEpoch: number;
  claim: AmazonAdsVisibleIdentityClaim;
} | null = null;

const completedLoginLivenessBindings = new WeakMap<Page, Set<string>>();

const pendingAmazonAdsIdentityRecognitionContinuations = new Set<string>();

const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS = {
  createReportButton: 'a:has-text("创建报告")',
  storeSearchInput: '.el-transfer-panel:has-text("待选店铺") input[placeholder="店铺搜索"]',
  storeOption: '.el-transfer-panel:has-text("待选店铺") label.el-transfer-panel__item:has-text("{storeName}")',
  storeMoveButton: '.el-transfer__buttons button:has(.el-icon-arrow-right)',
  reportSearchInput: 'input[placeholder="报告名称"].el-input__inner, input#report_name[name="keyword"][placeholder="报告名称"].form-control',
  reportTypeSelect: '.report-item .el-select input.el-input__inner',
  reportTypeOption: '.el-select-dropdown:visible .el-select-dropdown__item:has-text("{reportName}")',
  dateStartInput: 'input[placeholder="开始日期"].el-range-input',
  dateEndInput: 'input[placeholder="结束日期"].el-range-input',
  dailyDetailRadio: 'label.el-radio:has-text("每日明细")',
  confirmCreateButton: 'button:has-text("生成报告")',
  listRefreshButton: 'button:has-text("查询"), button:has-text("搜索"), button:has-text("刷新"), a:has-text("刷新")',
  createTimeSortHeader: 'th:has-text("创建时间"), [role="columnheader"]:has-text("创建时间"), .el-table__header-wrapper th:has-text("创建时间")',
} as const;

const DOWNLOAD_CENTER_LIST_RECOVERY_INTERVAL_MS = 6000;

const REQUIRED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS = new Set([
  'dateStartInput',
  'dateEndInput',
  'createReportButton',
  'readyReportSelector',
  'downloadButton',
]);

const REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS = new Set([
  'readyReportSelector',
  'statusTextSelector',
  'downloadButton',
]);

const OPEN_PATH_ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.htm',
  '.html',
  '.jpeg',
  '.jpg',
  '.json',
  '.md',
  '.png',
  '.txt',
  '.xls',
  '.xlsx',
  '.zip',
]);

const deliveryRuntime = createDeliveryRuntime({
  paths: bootstrapConfiguration.paths,
  appVersion: APP_VERSION,
  getDatabase: () => state.db,
  getOperationScope: () => handleGetOperationScope(),
  normalizeOperationScope: normalizePersistedOperationScope,
  getReadbackAccess: () => currentStoreScopedReadbackAccess(),
  validateAdReadbackAuthority: (evidencePath, stage) => validateCurrentAdReadbackEvidenceAuthority(evidencePath, stage),
  logger: runtimeLogger,
  v16Host: {
    mainModulePath: bootstrapConfiguration.mainModulePath,
    executablePath: bootstrapConfiguration.executablePath,
    getStoreContext: () => state.storeCoordinator?.getActiveStoreContext() ?? null,
    getConfigurationBus: () => state.configurationBus,
    getMode: context => state.missionDomainService?.getAutonomyProjection(context) ?? null,
  },
});

const exportCurrentDeliveryBundle = createDeliveryBundleExporter({
  paths: bootstrapConfiguration.paths,
  getReadiness: () => deliveryRuntime.getReadiness(),
  exportV16Bundle: deliveryRuntime.exportBundle,
  getOperationScope: () => handleGetOperationScope(),
  exportDataReconciliation: handleExportDataReconciliation,
  logger: runtimeLogger,
});

const lifecycleRecovery = createAppLifecycleRecoveryController({
  requestStrictQuit: () => app.quit(),
  ensureVisibleWindow: () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createWindow({ forceVisible: true });
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    if (!mainWindow.isVisible()) {
      throw new Error('LIFECYCLE_RECOVERY_WINDOW_NOT_VISIBLE');
    }
  },
  showCleanupFailureDialog: async (notice) => {
    const options = {
      type: 'error' as const,
      title: notice.title,
      message: notice.message,
      detail: notice.detail,
      buttons: ['重试安全退出', '暂不退出'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    return result.response === 0 ? 'retry-safe-quit' : 'keep-app-open';
  },
  showSynchronousError: (title, message) => dialog.showErrorBox(title, message),
  reportDiagnostic: (scope, error) => {
    runtimeLog.error(`[App] lifecycle recovery ${scope}:`, error);
  },
});

const handleBeforeQuit = createBeforeQuitCoordinator({
  cleanupFailurePolicy: 'fail-closed',
  cleanup: async () => {
    stopStoreBusinessDateAuthorityMonitor();
    
    
    storeContextTracker.reset();
    runtimeLog.log('[StoreContextTracker] cleared during shutdown');
    
    const shutdownTimeoutMs = 5_000;
    const mainRuntime = state.storeCollectionMainRuntime;
    const localScheduler = state.scheduler;
    const executionAuthority = state.executionAuthorityService;
    const db = state.db;

    
    
    
    const shutdownBarrierSteps = [
      {
        name: 'main-ipc-drain',
        operation: invokeShutdownOperationNow(
          () => deliveryRuntime.stopAndDrain(() => mainIpcOperationTracker.stopAndDrain(shutdownTimeoutMs)),
        ),
      },
      {
        name: 'local-scheduler-drain',
        operation: invokeShutdownOperationNow(
          () => localScheduler?.stopAndDrain(shutdownTimeoutMs),
        ),
      },
      {
        name: 'store-collection-drain',
        operation: invokeShutdownOperationNow(
          () => mainRuntime?.stopAndDrain(shutdownTimeoutMs),
        ),
      },
      {
        name: 'execution-authority',
        operation: invokeShutdownOperationNow(() => (
          executionAuthority?.prepareForShutdown(shutdownTimeoutMs)
        )),
      },
    ] as const;
    const shutdownBarrier = await Promise.allSettled(
      shutdownBarrierSteps.map((step) => step.operation),
    );
    const barrierFailures = shutdownBarrier.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [];
      const step = shutdownBarrierSteps[index];
      runtimeLog.error(`[App] shutdown ${step.name} barrier failed:`, result.reason);
      return [result.reason];
    });
    if (barrierFailures.length > 0) {
      throw new AggregateError(
        barrierFailures,
        'shutdown drain barrier failed; browser and database authority remain open',
      );
    }

    await mainRuntime?.closeRegistry(shutdownTimeoutMs);
    const pendingControllers = invalidatePendingBrowserLogin();
    await closeBrowserControllers(pendingControllers);
    clearBrowserLoginState();
    if (db && packageUiReadOnlyRuntime) {
      packageUiSchedulerAudit.capturePreCloseTerminalDatabaseCheckpointIfReady();
    }
    await db?.close();
    state.scheduler = null;
    state.storeCollectionMainRuntime = null;
    state.storeCollectionOrchestrator = null;
    state.storeCollectionSchedulerReadModel = null;
    state.db = null;
  },
  requestQuit: () => app.quit(),
  reportError: (error) => {
    runtimeLog.error('[App] shutdown cleanup failed:', error);
    void lifecycleRecovery.handleCleanupFailure(error);
  },
});

  const runtime = {
    state,
    browserOperationLeases,
    visibleBrowserRuntimeRegistry,
    expectedVisibleRuntimeCloseIds,
    storeMutationLane,
    storeCollectionPolicySuppression,
    STORE_COLLECTION_ORCHESTRATOR_HISTORY_KEY,
    executionPolicyDispatchSuppression,
    cancelledLingxingCollectionRequests,
    mainArtifactRegistry,
    mainIpcOperationTracker,
    pendingBrowserControllerCleanup,
    registerTrackedIpcHandler,
    trackedIpcRegistrar,
    desktopBootstrap,
    bootstrapConfiguration,
    mainStartupAdmission,
    evidenceUserDataIdentity,
    packageUiReadOnlyRuntime,
    packageUiFreshTypedProofRequired,
    get packageUiFreshTypedProof(): MutableMainRuntimeBindings['packageUiFreshTypedProof'] {
      return packageUiFreshTypedProof;
    },
    set packageUiFreshTypedProof(value: MutableMainRuntimeBindings['packageUiFreshTypedProof']) {
      packageUiFreshTypedProof = value;
    },
    packageLaunchSmokeRuntime,
    USER_DATA_DIR,
    STORAGE_DIR,
    STORES_DIR,
    SCREENSHOTS_DIR,
    DOM_SNAPSHOTS_DIR,
    TRACES_DIR,
    REPORTS_DIR,
    DOWNLOADS_DIR,
    EXPORTS_DIR,
    DELIVERY_BUNDLES_DIR,
    REPO_ROOT_DIR,
    CODEX_EVIDENCE_DIR,
    PAGE_MODELS_DIR,
    DB_PATH,
    packageUiSchedulerAudit,
    DOWNLOAD_CENTER_PAGE_MODEL_FILENAME,
    DOWNLOAD_CENTER_PAGE_MODEL_OVERRIDE_FILENAME,
    STORE_SESSION_GENERATION_SETTING_PREFIX,
    OPERATOR_WORKSPACE_SELECTION_SETTING_KEY,
    APP_VERSION,
    RECOMMENDATION_METRIC_LOAD_LIMIT,
    get mainWindow(): MutableMainRuntimeBindings['mainWindow'] {
      return mainWindow;
    },
    set mainWindow(value: MutableMainRuntimeBindings['mainWindow']) {
      mainWindow = value;
    },
    get lastPublishedStoreContext(): MutableMainRuntimeBindings['lastPublishedStoreContext'] {
      return lastPublishedStoreContext;
    },
    set lastPublishedStoreContext(value: MutableMainRuntimeBindings['lastPublishedStoreContext']) {
      lastPublishedStoreContext = value;
      deliveryRuntime.invalidateAuthority('store-context-published');
    },
    get storeBusinessDateAuthorityTimer(): MutableMainRuntimeBindings['storeBusinessDateAuthorityTimer'] {
      return storeBusinessDateAuthorityTimer;
    },
    set storeBusinessDateAuthorityTimer(value: MutableMainRuntimeBindings['storeBusinessDateAuthorityTimer']) {
      storeBusinessDateAuthorityTimer = value;
    },
    STORE_BUSINESS_DATE_AUTHORITY_POLL_MS,
    createWindow,
    electronLoginCredentialCipher,
    get browserLoginAttempt(): MutableMainRuntimeBindings['browserLoginAttempt'] {
      return browserLoginAttempt;
    },
    set browserLoginAttempt(value: MutableMainRuntimeBindings['browserLoginAttempt']) {
      browserLoginAttempt = value;
    },
    get pendingBrowserLogin(): MutableMainRuntimeBindings['pendingBrowserLogin'] {
      return pendingBrowserLogin;
    },
    set pendingBrowserLogin(value: MutableMainRuntimeBindings['pendingBrowserLogin']) {
      pendingBrowserLogin = value;
    },
    get pendingAmazonAdsIdentityConfirmation(): MutableMainRuntimeBindings['pendingAmazonAdsIdentityConfirmation'] {
      return pendingAmazonAdsIdentityConfirmation;
    },
    set pendingAmazonAdsIdentityConfirmation(value: MutableMainRuntimeBindings['pendingAmazonAdsIdentityConfirmation']) {
      pendingAmazonAdsIdentityConfirmation = value;
    },
    get pendingAmazonAdsIdentityRetry(): MutableMainRuntimeBindings['pendingAmazonAdsIdentityRetry'] {
      return pendingAmazonAdsIdentityRetry;
    },
    set pendingAmazonAdsIdentityRetry(value: MutableMainRuntimeBindings['pendingAmazonAdsIdentityRetry']) {
      pendingAmazonAdsIdentityRetry = value;
    },
    completedLoginLivenessBindings,
    pendingAmazonAdsIdentityRecognitionContinuations,
    DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS,
    DOWNLOAD_CENTER_LIST_RECOVERY_INTERVAL_MS,
    REQUIRED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS,
    REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS,
    OPEN_PATH_ALLOWED_EXTENSIONS,
    deliveryRuntime,
    exportCurrentDeliveryBundle,
    lifecycleRecovery,
    handleBeforeQuit,
  };
  Object.freeze(runtime);
  return runtime;
}
