import { BrowserController, CollectionOperationGuard } from '@amazon-ai-ops/browser-worker';
import { getDownloadCenterAutomationReadiness, LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { runtimeLog } from './runtime-log-adapter';
import { openLingxingAdsFromErp, readLingxingAdsProfileEvidence, resolveLingxingStableIdentityFromAdsProfile } from './lingxing-ads-sso';
import { deriveStoreCollectionWindow } from './store-collection-window';
import { createStoreCollectionProductionComposition } from './store-collection-production-composition';
import { LingxingCollectionCoordinator } from './lingxing-collection-coordinator';
import { authorizedLingxingCollectionTarget, lingxingCollectionCancellationKey } from './main-business-pipeline-runtime';
import { assertVisibleLingxingCollectionSession } from './main-mission-today-runtime';
import { browserControllerFromVisibleRuntime, reconcileBrowserLoginProjectionWithVisibleRuntime, sameExactStoreContext } from './main-browser-session-runtime';
import { storeCapsuleFor } from './main-store-access-runtime';
import { assertDownloadCenterAutomationReady, assertDownloadCenterDiagnosticEvidenceReady, createDownloadCenterAutomation, getControllerPageOrThrow } from './main-download-automation-runtime';
import { readDownloadCenterPageModel } from './main-download-page-model-runtime';
import { assertLingxingCollectionPreflightReady } from './main-collection-commands-runtime';
import { importStoreScopedLingxingDownloadedReportMetrics } from './main-local-report-import-runtime';
import { rendererPayload } from './main-artifacts-runtime';
import { navigateToLingxingDownloadCenter } from './main-download-navigation-runtime';
import { persistCollectionOnlyDownloadCenterDiagnostic } from './main-download-diagnostics-runtime';
import { publishStoreContextChanged } from './main-store-context-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function initializeLingxingCollectionCoordinator(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.storeRepo || !mainRuntimeContext.state.lingxingImportRepo) {
    throw new Error('店铺级领星采集依赖尚未初始化。');
  }
  const operations = new CollectionOperationGuard({
    leases: mainRuntimeContext.browserOperationLeases,
    assertActiveContext: (context) => mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context),
  });
  mainRuntimeContext.state.lingxingCollectionOperations = operations;
  mainRuntimeContext.state.lingxingCollectionCoordinator = new LingxingCollectionCoordinator({
    authority: mainRuntimeContext.state.storeCoordinator,
    operations,
    resolveRuntime(context, options) {
      const authorized = authorizedLingxingCollectionTarget(context);
      const activeContext = authorized.context;
      const browserRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
      assertVisibleLingxingCollectionSession(activeContext);
      if (!browserRuntime) throw new Error('请先为当前店铺启动并登录独立的领星 ERP 浏览器。');
      const controller = browserControllerFromVisibleRuntime(browserRuntime, 'lingxing');
      if (!controller) throw new Error('当前领星可见浏览器类型不受 Main 支持。');
      const capsule = storeCapsuleFor(authorized.store);
      return {
        automation: createDownloadCenterAutomation(
          controller,
          authorized.target,
          {
            allowManualVerificationForCanary: options.canary,
            storeCapsule: capsule,
          },
        ),
        browserProfileId: activeContext.browserProfileId,
        canary: options.canary,
        capsule,
        storeDisplayName: authorized.store.displayName,
        storeId: activeContext.storeId,
        target: {
          marketplaceCode: 'US',
          storeId: activeContext.storeId,
          storeName: authorized.target.storeName,
        },
      };
    },
    preflight(request, runtime) {
      const dateRange = { start: request.dateStart, end: request.dateEnd };
      if (runtime.canary) {
        const model = readDownloadCenterPageModel();
        const report = LINGXING_AD_REPORTS.find((item) => item.type === request.reportTypes[0]);
        const displayName = report?.displayName || request.reportTypes[0] || '单报表 canary';
        const automationReadiness = getDownloadCenterAutomationReadiness({
          ...model,
          requiresManualVerification: false,
        });
        assertDownloadCenterAutomationReady(automationReadiness, displayName);
        assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, displayName, runtime.target);
        return;
      }
      assertLingxingCollectionPreflightReady(dateRange, runtime.target);
    },
    assertRuntimeCurrent(context, runtime) {
      const authorized = authorizedLingxingCollectionTarget(context);
      assertVisibleLingxingCollectionSession(authorized.context);
      if (
        authorized.target.storeId !== runtime.target.storeId
        || authorized.target.marketplaceCode !== runtime.target.marketplaceCode
        || authorized.target.storeName !== runtime.target.storeName
      ) {
        throw new Error('领星店铺/Ads 账户映射已变化，本次采集已停止；请重新确认会话后发起新任务。');
      }
      const currentRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
      if (
        !currentRuntime
        || currentRuntime.providerIdentityStatus.lingxing !== 'verified'
        || !sameExactStoreContext(currentRuntime.context, context)
      ) {
        throw new Error('当前店铺浏览器会话已变化，本次采集已停止。');
      }
    },
    clearCancellation: ({ jobId, requestId, storeId }) => {
      for (const key of lingxingCollectionCancellationKey({ jobId, requestId, storeId })) {
        mainRuntimeContext.cancelledLingxingCollectionRequests.delete(key);
      }
    },
    persistence: {
      persistProgress(event) {
        mainRuntimeContext.state.lingxingImportRepo!.upsertCollectionProgressForStore(
          event.job.request.storeContext.storeId,
          event,
        );
      },
      persistResult(result) {
        const context = mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(
          result.job.request.storeContext,
        );
        const store = mainRuntimeContext.state.storeRepo!.getStore(context.storeId);
        if (!store || store.status !== 'active') {
          throw new Error('采集结果所属店铺不存在或已停用，拒绝持久化。');
        }
        mainRuntimeContext.state.lingxingImportRepo!.commitCollectionTerminalForStore(context.storeId, {
          job: result.job,
          batch: {
            ...result.batch,
            storeName: store.displayName,
            marketplaceCode: 'US',
          },
          files: result.files,
        });
      },
      persistImportState(job) {
        mainRuntimeContext.state.lingxingImportRepo!.upsertCollectionJobSnapshotForStore(
          job.request.storeContext.storeId,
          job,
        );
      },
      acquireCollectionResumeClaimForStore(storeId, input) {
        return mainRuntimeContext.state.lingxingImportRepo!.acquireCollectionResumeClaimForStore(storeId, input);
      },
      commitCollectionResumeProgressForStore(storeId, input) {
        return mainRuntimeContext.state.lingxingImportRepo!.commitCollectionResumeProgressForStore(storeId, input);
      },
      commitCollectionResumeRunnerResultForStore(storeId, input) {
        return mainRuntimeContext.state.lingxingImportRepo!.commitCollectionResumeRunnerResultForStore(storeId, input);
      },
      advanceCollectionResumeClaimAfterImportForStore(storeId, input) {
        return mainRuntimeContext.state.lingxingImportRepo!.advanceCollectionResumeClaimAfterImportForStore(storeId, input);
      },
      finalizeCollectionResumeAttemptForStore(storeId, input) {
        return mainRuntimeContext.state.lingxingImportRepo!.finalizeCollectionResumeAttemptForStore(storeId, input);
      },
      interruptCollectionResumeClaimForStore(storeId, input) {
        return mainRuntimeContext.state.lingxingImportRepo!.interruptCollectionResumeClaimForStore(storeId, input);
      },
    },
    productionImport: {
      policy: 'exact-eight-lineage-v1',
      run: (result, options) => {
        const summary = importStoreScopedLingxingDownloadedReportMetrics(result, options);
        if (summary.errors.length > 0 || summary.parsedFiles <= 0 || !summary.importRunId) {
          const detail = summary.errors.map((error) => error.message).join('；')
            || '真实报表未形成可提交的逐文件导入凭证。';
          throw new Error(`LINGXING_COLLECTION_IMPORT_FAILED: ${detail}`);
        }
        return summary;
      },
    },
    publishProgress: (event) => {
      mainRuntimeContext.mainWindow?.webContents.send('lingxing-collection:progress', rendererPayload(event));
    },
    isCancelled: ({ jobId, requestId, storeId }) => lingxingCollectionCancellationKey({
      jobId,
      requestId,
      storeId,
    }).some((key) => mainRuntimeContext.cancelledLingxingCollectionRequests.has(key)),
  });
}

export function initializeStoreCollectionProductionRuntime(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  if (
    !mainRuntimeContext.state.storeCoordinator
    || !mainRuntimeContext.state.storeRuntimeConfigService
    || !mainRuntimeContext.state.storeCollectionAutomationService
    || !mainRuntimeContext.state.configurationBus
    || !mainRuntimeContext.state.db
    || !mainRuntimeContext.state.storeRepo
    || !mainRuntimeContext.state.lingxingImportRepo
    || !mainRuntimeContext.state.lingxingCollectionCoordinator
  ) {
    throw new Error('店铺级采集生产运行时依赖尚未初始化。');
  }
  const coordinator = mainRuntimeContext.state.storeCoordinator;
  const productionStoreCoordinator = Object.freeze({
    listStores: coordinator.listStores.bind(coordinator),
    getCollectionAuthority: coordinator.getCollectionAuthority.bind(coordinator),
    issueCollectionTransitionCapability:
      coordinator.issueCollectionTransitionCapability.bind(coordinator),
    transitionForCollection: coordinator.transitionForCollection.bind(coordinator),
    assertActiveStoreContext: coordinator.assertActiveStoreContext.bind(coordinator),
    getActiveStoreContext: coordinator.getActiveStoreContext.bind(coordinator),
    listConnections: (storeId: StoreContextEnvelope['storeId']) => (
      mainRuntimeContext.state.storeRepo!.listConnections(storeId)
    ),
  });
  const composition = createStoreCollectionProductionComposition({
    registry: mainRuntimeContext.visibleBrowserRuntimeRegistry,
    mutationLane: mainRuntimeContext.storeMutationLane,
    policySuppression: mainRuntimeContext.storeCollectionPolicySuppression,
    storeCoordinator: productionStoreCoordinator,
    runtimeConfig: mainRuntimeContext.state.storeRuntimeConfigService,
    automationControl: mainRuntimeContext.state.storeCollectionAutomationService,
    lingxingCoordinator: mainRuntimeContext.state.lingxingCollectionCoordinator,
    importRepository: mainRuntimeContext.state.lingxingImportRepo,
    settings: {
      history: {
        get: () => mainRuntimeContext.state.configurationBus!.get(mainRuntimeContext.STORE_COLLECTION_ORCHESTRATOR_HISTORY_KEY),
        set: (value) => mainRuntimeContext.state.configurationBus!.set(mainRuntimeContext.STORE_COLLECTION_ORCHESTRATOR_HISTORY_KEY, value),
        transaction: (work) => mainRuntimeContext.state.configurationBus!.transaction(work),
      },
      recordCodec: {
        isAvailable: () => mainRuntimeContext.electronLoginCredentialCipher.isEncryptionAvailable(),
        seal: (plaintext) => mainRuntimeContext.electronLoginCredentialCipher.encrypt(plaintext),
        open: (envelope) => mainRuntimeContext.electronLoginCredentialCipher.decrypt(envelope),
      },
    },
    browser: {
      leases: mainRuntimeContext.browserOperationLeases,
      resolveStoreCapsule: (context) => {
        const authorized = mainRuntimeContext.state.storeCoordinator!.assertStoreContext(context);
        const store = mainRuntimeContext.state.storeRepo!.getStore(authorized.storeId);
        if (!store || store.status !== 'active') {
          throw new Error('STORE_COLLECTION_CAPSULE_STORE_NOT_ACTIVE');
        }
        return storeCapsuleFor(store);
      },
      createHeadedBrowserController: (input) => new BrowserController({
        headless: false,
        userDataDir: input.userDataDir,
      }),
      inspectLingxingIdentity: async ({ page, connection: inspectedConnection }) => {
        const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
        const controller = runtime
          ? browserControllerFromVisibleRuntime(runtime, 'lingxing')
          : null;
        if (!runtime
          || runtime.purpose !== 'collection_only'
          || !controller
          || controller.getPage() !== page) {
          throw new Error('采集专用领星窗口与当前店铺会话不一致，身份确认已阻断。');
        }
        mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(runtime.context);
        const connection = mainRuntimeContext.state.storeRepo!
          .listConnections(runtime.context.storeId)
          .find((candidate) => candidate.provider === 'lingxing');
        const collectionStoreName = connection?.collectionStoreName?.trim();
        if (!connection
          || connection.status !== 'ready'
          || !connection.accountLabel?.trim()
          || !connection.externalAccountId
          || !collectionStoreName
          || connection.accountLabel !== inspectedConnection.accountLabel
          || connection.externalAccountId !== inspectedConnection.externalAccountId) {
          throw new Error('当前店铺领星连接缺少已验证的账号、店铺或稳定身份，采集已阻断。');
        }

        const adsPage = await openLingxingAdsFromErp(controller);
        const evidence = await readLingxingAdsProfileEvidence(
          adsPage,
          collectionStoreName,
        );
        resolveLingxingStableIdentityFromAdsProfile({
          accountLabel: connection.accountLabel,
          collectionStoreName: connection.collectionStoreName!,
          configuredExternalAccountId: connection.externalAccountId,
          evidence,
        });
        await navigateToLingxingDownloadCenter(
          controller,
          readDownloadCenterPageModel(),
          collectionStoreName,
        );
        const runtimeConfig = mainRuntimeContext.state.storeRuntimeConfigService!.get(runtime.context).current;
        if (!runtimeConfig || runtimeConfig.status === 'archived') {
          throw new Error('当前店铺尚未配置可用的采集窗口，采集身份确认已阻断。');
        }
        const dateRange = deriveStoreCollectionWindow(
          runtime.context.businessDate,
          runtimeConfig.values.collectionLookbackDays,
        );
        const authorized = authorizedLingxingCollectionTarget(runtime.context);
        await persistCollectionOnlyDownloadCenterDiagnostic(
          controller,
          storeCapsuleFor(authorized.store),
          authorized.target,
          { start: dateRange.dateStart, end: dateRange.dateEnd },
        );
        const scopedPage = getControllerPageOrThrow(controller);
        return Object.freeze({
          status: 'ready' as const,
          pageUrl: scopedPage.url(),
          title: await scopedPage.title(),
          domObservations: Object.freeze([]),
        });
      },
    },
    sessionMetadata: {
      withLingxingReadyMetadataTransaction: (work) => mainRuntimeContext.state.db!.transaction(() => work({
        saveReady: (metadata) => mainRuntimeContext.state.storeRepo!.saveSessionMetadata(metadata),
      }))(),
    },
    authorityReadback: {
      readCurrentAuthority: () => mainRuntimeContext.state.storeCoordinator!.getCollectionAuthority(),
    },
    packageUiReadOnly: mainRuntimeContext.packageUiReadOnlyRuntime,
    onAuthoritySettled: () => {
      reconcileBrowserLoginProjectionWithVisibleRuntime();
      const view = mainRuntimeContext.state.storeCoordinator!.getActiveStoreWorkspaceView();
      if (!view) {
        mainRuntimeContext.state.currentStore = '';
        mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
        return;
      }
      mainRuntimeContext.state.currentStore = view.store.displayName;
      publishStoreContextChanged(view);
      mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
    },
    onError(error) {
      runtimeLog.error('[CollectionRuntime] production orchestration failed:', error);
    },
    mainRuntime: {
      reportError(error) {
        runtimeLog.error('[CollectionRuntime] Main runtime cycle failed:', error);
      },
    },
  });
  mainRuntimeContext.state.storeCollectionMainRuntime = composition.runtime;
  mainRuntimeContext.state.storeCollectionOrchestrator = composition.orchestrator;
  mainRuntimeContext.state.storeCollectionSchedulerReadModel = composition.schedulerReadModel;
}
