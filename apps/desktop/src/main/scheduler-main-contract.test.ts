import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('desktop scheduler scope contract', () => {
  it('runs scheduled recommendation generation with the persisted operation scope', () => {
    const registration = source.match(/name: 'daily_recommendation_generate',[\s\S]*?\n\s*\}\);/)?.[0] || '';

    expect(registration).toContain('runRecommendationGeneration(handleGetOperationScope())');
    expect(registration).not.toContain('runRecommendationGeneration();');
  });

  it('retires the legacy collection scheduler and exposes only the production read model IPC', () => {
    expect(source).not.toContain("from './store-collection-scheduler';");
    expect(source).not.toContain('new StoreCollectionScheduler(');
    expect(source).not.toContain('state.storeCollectionScheduler =');
    expect(source).not.toContain('reconcileStoreCollectionScheduler');
    expect(source).not.toContain('.reconcile(context)');
    expect(source).toContain('createStoreCollectionProductionComposition({');
    expect(source).toContain('state.storeCollectionSchedulerReadModel = composition.schedulerReadModel');
    expect(source).toContain('registerStoreCollectionSchedulerIpcHandlers(');
    expect(source).toContain(': state.storeCollectionSchedulerReadModel');

    const legacyStart = source.indexOf("registerTrackedIpcHandler('scheduler:set-task-enabled'");
    const legacyEnd = source.indexOf('// Logs', legacyStart);
    const legacyHandlers = source.slice(legacyStart, legacyEnd);
    expect(legacyHandlers).toContain('LEGACY_SCHEDULER_IPC_DISABLED');
    expect(legacyHandlers).not.toContain('setTaskEnabled(');
    expect(legacyHandlers).not.toContain('runNow(');
  });

  it('constructs the production runtime with one registry, lane, suppression controller and durable ports', () => {
    const composition = between(
      'function initializeStoreCollectionProductionRuntime',
      'function assertVisibleLingxingCollectionSession',
    );

    expect(source.match(/new VisibleBrowserRuntimeRegistry\(\)/g)).toHaveLength(1);
    expect(source.match(/new StoreMutationLane\(\)/g)).toHaveLength(1);
    expect(source.match(/new StoreCollectionPolicySuppressionController\(\)/g)).toHaveLength(1);
    expect(composition).toContain('registry: visibleBrowserRuntimeRegistry');
    expect(composition).toContain('mutationLane: storeMutationLane');
    expect(composition).toContain('policySuppression: storeCollectionPolicySuppression');
    expect(composition).toContain('STORE_COLLECTION_ORCHESTRATOR_HISTORY_KEY');
    expect(composition).toContain('transaction: (work) => state.settingsRepo!.transaction(work)');
    expect(composition).toContain('electronLoginCredentialCipher.encrypt(plaintext)');
    expect(composition).toContain('headless: false');
    expect(composition).toContain('userDataDir: input.userDataDir');
    expect(composition).toContain('state.db!.transaction(() => work({');
    expect(composition).toContain('readCurrentAuthority: () => state.storeCoordinator!.getCollectionAuthority()');
  });

  it('orders normal startup recovery before collection automation starts', () => {
    const init = between('async function initApp', '// Browser / Session');
    const imports = init.indexOf('recoverPendingLingxingCollectionImportsOnStartup()');
    const failedImportAuthorityGate = init.indexOf(
      'assertLingxingImportStartupRecoverySafe(importRecovery)',
    );
    const interrupted = init.indexOf('recoverInterruptedLingxingCollectionJobsOnStartup()');
    const failedStoreGate = init.indexOf('if (collectionRecovery.failedStores !== 0)');
    const runtimeRecovery = init.indexOf('await state.storeCollectionMainRuntime!.recoverStartupThenConfirm()');
    const execution = init.indexOf('executionAuthorityService.recoverStartup()');
    const runtimeStart = init.indexOf('state.storeCollectionMainRuntime!.start()');

    expect(imports).toBeGreaterThan(0);
    expect(failedImportAuthorityGate).toBeGreaterThan(imports);
    expect(interrupted).toBeGreaterThan(failedImportAuthorityGate);
    expect(failedStoreGate).toBeGreaterThan(interrupted);
    expect(runtimeRecovery).toBeGreaterThan(failedStoreGate);
    expect(execution).toBeGreaterThan(runtimeRecovery);
    expect(runtimeStart).toBeGreaterThan(execution);
  });

  it('binds collection reads to the exact registry Lingxing identity without requiring Ads', () => {
    const authority = between(
      'function assertVisibleLingxingCollectionSession',
      'function buildAuthoritativeMissionControlTodayProjection',
    );
    const coordinator = between(
      'function initializeLingxingCollectionCoordinator',
      'function initializeStoreCollectionProductionRuntime',
    );

    expect(authority).toContain('visibleBrowserRuntimeRegistry.read()');
    expect(authority).toContain("browserControllerFromVisibleRuntime(runtime, 'lingxing')");
    expect(authority).toContain("runtime.providerIdentityStatus.lingxing !== 'verified'");
    expect(authority).toContain("getSessionMetadata(authorized.storeId, 'lingxing')");
    expect(authority).not.toContain("getSessionMetadata(authorized.storeId, 'amazon_ads')");
    expect(authority).not.toContain('providerIdentityStatus.amazonAds');
    expect(coordinator).toContain('visibleBrowserRuntimeRegistry.read()');
    expect(coordinator).toContain("browserControllerFromVisibleRuntime(browserRuntime, 'lingxing')");
  });

  it('publishes one operator_full candidate and gates both provider identities before Ads execution', () => {
    const login = between(
      'async function performBrowserLoginInUserLane',
      'async function handleBrowserLogout',
    );
    const readyMetadata = login.indexOf("provider: 'lingxing'");
    const publish = login.indexOf('visibleBrowserRuntimeRegistry.publishCandidate({');
    const verifyLingxing = login.indexOf('.verifyLingxingCandidate(candidateClaim)');
    const adsProbe = login.indexOf('await amazonAdsController.launch()');

    expect(publish).toBeGreaterThan(readyMetadata);
    expect(verifyLingxing).toBeGreaterThan(publish);
    expect(adsProbe).toBeGreaterThan(verifyLingxing);
    expect(login).toContain("purpose: 'operator_full'");
    expect(login).toContain('amazonAds: amazonAdsController');
    expect(login).toContain('amazonAds: capsule.amazonAdsProfileDir');
    expect(login).toContain('amazonAds: connections.amazon_ads');
    expect(login).toContain('claimAmazonAdsIdentity({');
    expect(login).toContain('runtimeId: lingxingVerifiedRuntime.runtimeId');
    expect(login).toContain('epoch: lingxingVerifiedRuntime.epoch');
    expect(login).toContain('context: lingxingVerifiedRuntime.context');
    expect(login).toContain('verifyAmazonAdsIdentity(adsIdentityClaim, adsConnection)');
    expect(login).toContain('blockAmazonAdsIdentity(adsIdentityClaim)');

    const execution = between('resolveBrowserRuntime: (context) => {', 'emitProgress:');
    expect(execution).toContain("runtime.purpose !== 'operator_full'");
    expect(execution).toContain("runtime.providerIdentityStatus.lingxing !== 'verified'");
    expect(execution).toContain("runtime.providerIdentityStatus.amazonAds !== 'verified'");
    expect(execution).toContain('!sameExactStoreContext(runtime.context, context)');
    expect(execution).toContain("getSessionMetadata(context.storeId, 'amazon_ads')");
  });

  it('publishes automation readiness from MainRuntime plus retention and settles fresh authority', () => {
    const registration = between(
      'createMissionControlLegacyAdapter({',
      'registerMissionDomainIpcHandlers',
    );
    const composition = between(
      'function initializeStoreCollectionProductionRuntime',
      'function assertVisibleLingxingCollectionSession',
    );

    expect(registration).toContain(
      'state.storeCollectionMainRuntime && state.storeEvidenceRetentionService',
    );
    expect(registration).toContain('deliveryReadinessReady: true');
    expect(composition).toContain('onAuthoritySettled: () => {');
    expect(composition).toContain('getActiveStoreWorkspaceView()');
    expect(composition).toContain('state.currentStore = view.store.displayName');
    expect(composition).toContain('publishStoreContextChanged(view)');
    expect(composition).toContain("send('business-ui:data-updated')");
  });

  it('keeps package UI collection read-only while routing visible login through bounded setup', () => {
    const init = between('async function initApp', '// Browser / Session');
    const schedulerIpc = between(
      'registerStoreCollectionSchedulerIpcHandlers(',
      'registerStoreScopedObjectsIpcHandlers(',
    );
    const login = between('async function handleBrowserLogin', 'async function performBrowserLoginInUserLane');

    expect(init).toContain('if (packageUiReadOnlyRuntime)');
    expect(init).toContain("recordSuppressed('startupReconcile')");
    expect(init).toContain("recordSuppressed('localSchedulerStart')");
    expect(init).toContain("recordSuppressed('storeSchedulerStart')");
    expect(init).toContain('state.storeCollectionMainRuntime!.start()');
    expect(schedulerIpc).toContain('state.storeCollectionSchedulerReadModel!.get(context)');
    expect(schedulerIpc).toContain('PACKAGE_UI_EVIDENCE_READ_ONLY');
    expect(login).toContain('withPackageUiSetupMutation');
    expect(source).toContain('package UI evidence cannot start or resume collection');
    expect(source).toContain('package UI evidence cannot cancel collection');
  });

  it('starts every drain before awaiting one barrier and closes authority only after full success', () => {
    const shutdown = between(
      'const handleBeforeQuit = createBeforeQuitCoordinator',
      "app.on('before-quit'",
    );
    const barrierDeclaration = shutdown.indexOf('const shutdownBarrierSteps = [');
    const barrierAwait = shutdown.indexOf('await Promise.allSettled(');
    const barrierAbort = shutdown.indexOf('if (barrierFailures.length > 0)');
    const registryClose = shutdown.indexOf('await mainRuntime?.closeRegistry(shutdownTimeoutMs)');
    const pendingClose = shutdown.indexOf('await closeBrowserControllers(pendingControllers)');
    const loginProjectionClear = shutdown.indexOf('clearBrowserLoginState()');
    const checkpoint = shutdown.indexOf('capturePreCloseTerminalDatabaseCheckpointIfReady()');
    const database = shutdown.indexOf('await db?.close()');

    expect(barrierDeclaration).toBeGreaterThan(0);
    expect(barrierAwait).toBeGreaterThan(barrierDeclaration);
    expect(barrierAbort).toBeGreaterThan(barrierAwait);
    expect(registryClose).toBeGreaterThan(barrierAbort);
    expect(pendingClose).toBeGreaterThan(registryClose);
    expect(loginProjectionClear).toBeGreaterThan(pendingClose);
    expect(checkpoint).toBeGreaterThan(loginProjectionClear);
    expect(database).toBeGreaterThan(checkpoint);
    expect(shutdown).toContain('localScheduler?.stopAndDrain(shutdownTimeoutMs)');
    expect(shutdown).toContain('mainRuntime?.stopAndDrain(shutdownTimeoutMs)');
    expect(shutdown).toContain('executionAuthority?.prepareForShutdown(shutdownTimeoutMs)');
    expect(shutdown).toContain('mainIpcOperationTracker.stopAndDrain(shutdownTimeoutMs)');
    expect(shutdown.match(/invokeShutdownOperationNow\(/g)).toHaveLength(4);
    expect(shutdown).not.toContain('Promise.resolve().then');
    expect(shutdown).toContain('throw new AggregateError(');
    expect(shutdown).toContain('await mainRuntime?.closeRegistry(shutdownTimeoutMs)');
    expect(shutdown).toContain('capturePreCloseTerminalDatabaseCheckpointIfReady()');
    expect(shutdown).not.toContain('capturePreCloseTerminalDatabaseCheckpoint()');
    expect(shutdown).toContain("cleanupFailurePolicy: 'fail-closed'");
    expect(source).toContain('pendingBrowserControllerCleanup.retain(controllers)');
    expect(source).toContain('pendingBrowserControllerCleanup.closeRetained()');
    expect(source).toContain('pendingBrowserControllerCleanup.hasRetainedControllers()');
    expect(shutdown).not.toContain('shutdownStep(');
    expect(shutdown).not.toContain('state.storeCollectionScheduler =');
  });

  it('routes every invoke handler through the process-wide Main IPC drain barrier', () => {
    const directRegistrations = source.match(/ipcMain\.handle\(/g) ?? [];
    const trackedRegistrations = source.match(/registerTrackedIpcHandler\('/g) ?? [];

    expect(directRegistrations).toHaveLength(1);
    expect(source).toContain('ipcMain.handle(channel, (event, ...args) => (');
    expect(trackedRegistrations.length).toBeGreaterThan(70);
    expect(source).toContain('mainIpcOperationTracker.run(channel');
    expect(source).toContain(
      'packageUiSchedulerAudit.wrapRegistrar(trackedIpcRegistrar)',
    );
    expect(source).toContain(
      'packageUiSchedulerAudit.registerDatabaseCheckpointIpc(schedulerEvidenceIpc)',
    );
    expect(source).not.toMatch(/registerStoreIpcHandlers\(ipcMain/);
    expect(source).not.toMatch(/registerMissionDomainIpcHandlers\(ipcMain/);
    expect(source).not.toMatch(/registerAnalysisAuthorityIpcHandlers\(ipcMain/);
    expect(source).not.toMatch(/registerExecutionAuthorityIpcHandlers\(ipcMain/);
    expect(source).not.toMatch(/registerStoreRuntimeConfigIpcHandlers\(\s*ipcMain/);
    expect(source).not.toMatch(/registerStoreScopedObjectsIpcHandlers\(\s*ipcMain/);
    expect(source).not.toMatch(/registerStoreScopedAdListingIpcHandlers\(\s*ipcMain/);
  });

  it('routes startup and strict-cleanup failures through one visible fail-closed lifecycle', () => {
    const recovery = source.indexOf('const lifecycleRecovery = createAppLifecycleRecoveryController');
    const beforeQuitRegistration = source.indexOf("app.on('before-quit', handleBeforeQuit)");
    const startup = source.indexOf('void lifecycleRecovery.runStartupBootstrap(async () => {');
    const lifecycle = source.slice(recovery);

    expect(recovery).toBeGreaterThan(0);
    expect(beforeQuitRegistration).toBeGreaterThan(recovery);
    expect(startup).toBeGreaterThan(beforeQuitRegistration);
    expect(source).toContain('await app.whenReady()');
    expect(source).toContain('void lifecycleRecovery.handleCleanupFailure(error)');
    expect(source).toContain("buttons: ['重试安全退出', '暂不退出']");
    expect(source).toContain("return result.response === 0 ? 'retry-safe-quit' : 'keep-app-open'");
    expect(source).toContain('createWindow({ forceVisible: true })');
    expect(source).toContain("throw new Error('LIFECYCLE_RECOVERY_WINDOW_NOT_VISIBLE')");
    expect(source).not.toContain('app.whenReady().then(');
    expect(lifecycle).not.toContain('app.exit(');
  });

  it('shows a recovery shell immediately and contains renderer load rejection', () => {
    const createWindowSource = between('interface CreateMainWindowOptions', '// Initialization');
    const forcedShow = createWindowSource.indexOf('if (options.forceVisible)');
    const rendererLoad = createWindowSource.indexOf('const rendererLoad = development');
    const loadFailure = createWindowSource.indexOf('void rendererLoad.catch((error) => {');

    expect(forcedShow).toBeGreaterThan(0);
    expect(rendererLoad).toBeGreaterThan(forcedShow);
    expect(loadFailure).toBeGreaterThan(rendererLoad);
    expect(createWindowSource.slice(forcedShow, rendererLoad)).toContain('createdWindow.show()');
    expect(createWindowSource).toContain("dialog.showErrorBox(");
    expect(createWindowSource).toContain("'界面加载失败'");
    expect(createWindowSource).not.toContain("void createdWindow.loadFile(rendererFilePath)");
    expect(createWindowSource).not.toContain("void createdWindow.loadURL('http://localhost:5173')");
  });

  it('fails the daily report task when no artifact can be produced and propagates failures', () => {
    const body = between('async function runDailyReportGeneration', '// IPC Handlers');

    expect(body).toContain("if (!settings.aiApiKey)");
    expect(body).toContain("throw new Error('AI Key 未配置，无法生成每日运营报告。')");
    expect(body).toMatch(/catch \(err\) \{[\s\S]*?throw err;/);
  });
});
