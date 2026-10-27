import { registerRendererRuntimeLogIpc } from './renderer-runtime-log-ipc';
import { registerV16ServicesIpc } from './v16-services-ipc';
import { registerAnalysisRunsIpcHandlers } from './analysis-runs-ipc';
import { runtimeLogger } from './runtime-logger';
import { runtimeLog } from './runtime-log-adapter';
import { runUserVisibleBrowserTransition, storeMutationRequiresVisibleBrowserTransition } from './user-visible-browser-transition';
import { normalizeBrowserLoginAdsIdentityConfirmation } from './browser-login-ads-confirmation';
import { normalizeBrowserLoginRequest } from './browser-login-request';
import { registerSettingsIpcHandlers } from './settings-ipc';
import { assertStoreIpcMutationTargetPreflight, registerStoreIpcHandlers } from './store-ipc';
import { registerMissionControlIpcHandlers } from './mission-control-ipc';
import { registerMissionDomainIpcHandlers } from './mission-domain-ipc';
import { registerAnalysisAuthorityIpcHandlers } from './analysis-authority-ipc';
import { registerExecutionAuthorityIpcHandlers } from './execution-authority-ipc';
import { registerStoreScopedObjectsIpcHandlers } from './store-scoped-objects-ipc';
import { StoreScopedObjectsService } from './store-scoped-objects-service';
import { registerStoreScopedAdListingIpcHandlers } from './store-scoped-ad-listing-ipc';
import { StoreScopedAdListingService } from './store-scoped-ad-listing-service';
import { registerStoreRuntimeConfigIpcHandlers } from './store-runtime-config-ipc';
import { registerStoreCollectionAutomationIpcHandlers } from './store-collection-automation-ipc';
import { registerStoreEvidenceRetentionIpcHandlers } from './store-evidence-retention-ipc';
import { registerStoreCollectionSchedulerIpcHandlers } from './store-collection-scheduler-ipc';
import { StoreCollectionMainRuntimeError } from './store-collection-main-runtime';
import { createMissionControlLegacyAdapter } from './mission-control-legacy-adapter';
import { assertUserVisibleBrowserRuntimeClosed, closeUserVisibleBrowserRuntimeForTransition, handleBrowserLogout, handleGetSavedLoginCredentialStatus, isProviderBrowserSessionReady, readEmptyUserVisibleBrowserTransitionState } from './main-browser-session-runtime';
import { storeCapsuleFor } from './main-store-access-runtime';
import { publishStoreContextChanged } from './main-store-context-runtime';
import { buildAuthoritativeMissionControlTodayProjection } from './main-mission-today-runtime';
import { handleDiscoverRecommendationTarget, handleScreenshot, normalizeScreenshotLabel } from './main-operator-browser-runtime';
import { readPackageUiStoreCollectionSchedule } from './main-package-ui-authority-runtime';
import { artifactAllowedRootsForStore, currentArtifactStore, handleOpenArtifact, projectDiagnosticForRenderer, projectExportArtifactForCurrentStore, rendererPayload } from './main-artifacts-runtime';
import { handleListAiCallLogs, handleTestAiSettings, persistAiSettingsForMain, readAiSettingsForMain } from './main-ai-settings-runtime';
import { handleGetBusinessBatchOptions, resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { handleExportDeliveryBundle, handleGetDeliveryEvidenceStatus, handleGetDeliveryReadiness, handleGetOperationScope, handleGetStoragePaths, handleRefreshFinalReadiness, handleSaveOperationScope } from './main-delivery-scope-runtime';
import { handleBrowserLogin } from './main-browser-login-runtime';
import { handleConfirmBrowserLoginAdsIdentity } from './main-ads-enrollment-runtime';
import { handleCancelLingxingCollection, handleCollectLingxingReports, handleDownloadExistingLingxingReports, handleExportLingxingCollectionPreflight, handleImportCurrentBusinessReports, handleImportLocalBusinessReportFiles, handleListLingxingCollectionJobs, handlePreflightLingxingCollection, handleRetryLingxingReport, handleRunLingxingCanaryReport } from './main-collection-commands-runtime';
import { projectBusinessImportResultForRenderer, projectLingxingCollectionResultForRenderer } from './main-collection-projection-runtime';
import { handleGetBusinessUiDataPipeline, projectBusinessBatchOptionForRenderer, projectBusinessPipelineForRenderer } from './main-business-pipeline-runtime';
import { handleExportDataReconciliation, handleExportDataReconciliationArtifacts } from './main-data-reconciliation-runtime';
import { handleResumeLingxingCollection } from './main-collection-resume-runtime';
import { handleExportDownloadCenterDiagnosticBundle, handleExportDownloadCenterPageModelDraft, handleExportDownloadCenterPageModelEnablementAudit, handleExportLingxingAcceptanceAudit } from './main-acceptance-export-runtime';
import { handleDiagnoseLingxingDownloadCenter } from './main-download-diagnostics-runtime';
import { handleGetDownloadCenterPageModel, handleResetDownloadCenterPageModel, handleSaveDownloadCenterPageModel } from './main-download-page-model-runtime';
import { handleApproveRecommendation, handleBindRecommendationWritableTarget, handleGetRecommendations, handleRejectRecommendation, handleResolveRecommendationReview } from './main-recommendation-review-runtime';
import { runRecommendationGeneration } from './main-recommendation-generation-runtime';
import { handleListAiDiagnosisRuns, handleRunAdStrategyDiagnosis } from './main-ad-diagnosis-runtime';
import { handleExecuteRecommendation, handleExportAdReadbackEvidence, handleFillAdReadbackSession, handlePrepareAdReadbackSession, handleSaveReadbackCapture, handleVerifyAdReadbackEvidence, handleVerifyAdReadbackSession } from './main-ad-execution-runtime';
import { handleAnalyzeListingCoverage, handleBuildKeywordOpportunities, handleExportKeywordDiagnostics } from './main-keyword-runtime';
import { handleBuildListingSuggestions, handleExportListingDrafts, handleExportListingSuggestions, handleGenerateListingDrafts, handleUpdateListingSuggestionStatus } from './main-listing-draft-runtime';
import type { DiscoverRecommendationTargetRequest } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function registerIpcHandlers(): void {
  const mainRuntimeContext = getMainRuntimeContext();
  registerRendererRuntimeLogIpc(mainRuntimeContext.trackedIpcRegistrar, runtimeLogger);
  if (!mainRuntimeContext.state.storeCoordinator) throw new Error('Store coordinator is not initialized');
  if (!mainRuntimeContext.state.storeDailyStatusReader) throw new Error('Store daily status reader is not initialized');
  if (!mainRuntimeContext.state.missionDomainService) throw new Error('Mission domain service is not initialized');
  if (!mainRuntimeContext.state.analysisAuthorityService) throw new Error('Analysis authority service is not initialized');
  if (!mainRuntimeContext.state.executionAuthorityService) throw new Error('Execution authority service is not initialized');
  if (!mainRuntimeContext.state.storeRuntimeConfigService) throw new Error('Store runtime config service is not initialized');
  if (!mainRuntimeContext.state.storeCollectionAutomationService) throw new Error('店铺自动采集配置服务尚未初始化。');
  if (!mainRuntimeContext.state.storeCollectionMainRuntime || !mainRuntimeContext.state.storeCollectionSchedulerReadModel) {
    throw new Error('Store collection production runtime is not initialized');
  }
  if (!mainRuntimeContext.state.productRepo || !mainRuntimeContext.state.operationEventRepo) {
    throw new Error('Store-scoped object repositories are not initialized');
  }
  const schedulerEvidenceIpc = mainRuntimeContext.packageUiSchedulerAudit.wrapRegistrar(mainRuntimeContext.trackedIpcRegistrar);
  mainRuntimeContext.packageUiSchedulerAudit.registerDatabaseCheckpointIpc(schedulerEvidenceIpc);
  registerStoreIpcHandlers(mainRuntimeContext.trackedIpcRegistrar, mainRuntimeContext.state.storeCoordinator, {
    withUserStoreMutation: async (scope, work) => {
      if (mainRuntimeContext.packageUiReadOnlyRuntime) {
        if (
          mainRuntimeContext.pendingBrowserLogin
          || mainRuntimeContext.state.isLoggedIn
          || mainRuntimeContext.state.loginSession
          || mainRuntimeContext.visibleBrowserRuntimeRegistry.read()
        ) {
          throw new StoreCollectionMainRuntimeError(
            'USER_OPERATION_BLOCKED',
            'Package UI setup mutations are allowed only before visible login starts',
          );
        }
        return mainRuntimeContext.state.storeCollectionMainRuntime!.withPackageUiSetupMutation(
          scope,
          () => {
            const laneActive = mainRuntimeContext.state.storeCoordinator!.getActiveStoreContext();
            assertStoreIpcMutationTargetPreflight(
              mainRuntimeContext.state.storeCoordinator!,
              scope,
              laneActive,
            );
            return work();
          },
        );
      }
      const active = mainRuntimeContext.state.storeCoordinator!.getActiveStoreContext();
      if (active) mainRuntimeContext.state.executionAuthorityService!.assertStoreMutationAllowed(active);
      let transitionedActiveAuthority = false;
      const result = await mainRuntimeContext.state.storeCollectionMainRuntime!.withUserStoreMutation(
        scope,
        () => {
          const laneActive = mainRuntimeContext.state.storeCoordinator!.getActiveStoreContext();
          assertStoreIpcMutationTargetPreflight(
            mainRuntimeContext.state.storeCoordinator!,
            scope,
            laneActive,
          );
          const requiresTransition = storeMutationRequiresVisibleBrowserTransition(
            scope,
            laneActive ? String(laneActive.storeId) : undefined,
          );
          if (!requiresTransition) return work();
          transitionedActiveAuthority = true;
          return runUserVisibleBrowserTransition({
            leases: mainRuntimeContext.browserOperationLeases,
            owner: `store-ipc:${scope.operation}`,
            closeRuntime: closeUserVisibleBrowserRuntimeForTransition,
            assertRuntimeClosed: assertUserVisibleBrowserRuntimeClosed,
            work,
            readFinalState: readEmptyUserVisibleBrowserTransitionState,
          });
        },
      );
      const fresh = mainRuntimeContext.state.storeCoordinator!.getActiveStoreContext();
      if (transitionedActiveAuthority && fresh) {
        await mainRuntimeContext.state.executionAuthorityService!.resumePolicyGrantDispatches(
          fresh,
          'store_activated',
        ).catch(() => {
          runtimeLog.error('[Execution] persisted policy-grant recovery failed after store activation');
        });
      }
      return result;
    },
    beforeActiveStoreMutation: async (context) => {
      mainRuntimeContext.state.executionAuthorityService!.assertStoreMutationAllowed(context);
      mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context);
    },
    onStoreChanged: async (view) => {
      if (view === null) {
        if (mainRuntimeContext.state.storeCoordinator!.getActiveStoreContext() !== null) {
          throw new Error('STORE_CHANGED_NULL_CONFLICTS_WITH_ACTIVE_AUTHORITY');
        }
        mainRuntimeContext.lastPublishedStoreContext = null;
        mainRuntimeContext.state.currentStore = '';
        mainRuntimeContext.mainWindow?.webContents.send('store-context:changed', null);
        mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
        return;
      }
      const freshView = mainRuntimeContext.state.storeCoordinator!.getActiveStoreWorkspaceView();
      if (!freshView || freshView.store.storeId !== view.store.storeId) {
        throw new Error('STORE_CHANGED_FRESH_AUTHORITY_MISSING');
      }
      storeCapsuleFor(freshView.store);
      try {
        mainRuntimeContext.state.executionAuthorityService!.reconcileActiveStore(freshView.context);
      } catch (error) {
        runtimeLog.error('[Execution] recovered Mission stop reconciliation failed:', error);
      }
      mainRuntimeContext.state.currentStore = freshView.store.displayName;
      publishStoreContextChanged(freshView);
      mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
    },
    onStoreRecordChanged: async (store) => {
      const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
      if (activeContext?.storeId === store.storeId) {
        mainRuntimeContext.state.currentStore = store.status === 'active' ? store.displayName : '';
      }
      storeCapsuleFor(store);
      mainRuntimeContext.mainWindow?.webContents.send('stores:changed', store);
      const freshView = mainRuntimeContext.state.storeCoordinator!.getActiveStoreWorkspaceView();
      if (freshView?.store.storeId === store.storeId) {
        mainRuntimeContext.state.currentStore = freshView.store.displayName;
        publishStoreContextChanged(freshView);
      } else if (!freshView && activeContext?.storeId === store.storeId) {
        mainRuntimeContext.lastPublishedStoreContext = null;
        mainRuntimeContext.state.currentStore = '';
        mainRuntimeContext.mainWindow?.webContents.send('store-context:changed', null);
      }
      mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
    },
    onPostCommitFailure: ({ operation, targetStoreId, error }) => {
      runtimeLog.error(
        `[StoreIPC] ${operation} committed but Renderer publication failed`
          + (targetStoreId ? ` for ${targetStoreId}` : ''),
        error,
      );
    },
  }, mainRuntimeContext.state.storeDailyStatusReader);
  registerMissionControlIpcHandlers(
    schedulerEvidenceIpc,
    mainRuntimeContext.state.storeCoordinator,
    createMissionControlLegacyAdapter({
      buildTodayProjection: buildAuthoritativeMissionControlTodayProjection,
      analysisAuthorityReady: Boolean(mainRuntimeContext.state.analysisAuthorityService),
      executionAuthorityReady: Boolean(mainRuntimeContext.state.executionAuthorityService),
      deliveryReadinessReady: true,
      storeRuntimeConfigReady: Boolean(mainRuntimeContext.state.storeRuntimeConfigService),
      storeAutomationReady: Boolean(
        mainRuntimeContext.state.storeCollectionMainRuntime && mainRuntimeContext.state.storeEvidenceRetentionService
      ),
      missionDomain: mainRuntimeContext.state.missionDomainService,
    }),
  );
  registerMissionDomainIpcHandlers(mainRuntimeContext.trackedIpcRegistrar, mainRuntimeContext.state.missionDomainService);
  registerAnalysisAuthorityIpcHandlers(mainRuntimeContext.trackedIpcRegistrar, mainRuntimeContext.state.analysisAuthorityService);
  registerExecutionAuthorityIpcHandlers(mainRuntimeContext.trackedIpcRegistrar, mainRuntimeContext.state.executionAuthorityService);
  registerAnalysisRunsIpcHandlers(mainRuntimeContext.trackedIpcRegistrar, mainRuntimeContext.state.analysisAuthorityService!, mainRuntimeContext.state.storeCoordinator!);
  
  registerV16ServicesIpc(mainRuntimeContext.trackedIpcRegistrar, {
    domain: mainRuntimeContext.state.missionDomainService,
    analysis: mainRuntimeContext.state.analysisAuthorityService,
    execution: mainRuntimeContext.state.executionAuthorityService,
    storeCoordinator: mainRuntimeContext.state.storeCoordinator!,
  });
  runtimeLog.log('[App] ipc:v16-services-registered');

  mainRuntimeContext.registerTrackedIpcHandler('execution-authority:discover-recommendation-target',
    (_, input: DiscoverRecommendationTargetRequest) => handleDiscoverRecommendationTarget(input),
  );
  registerStoreRuntimeConfigIpcHandlers(
    mainRuntimeContext.trackedIpcRegistrar,
    mainRuntimeContext.state.storeRuntimeConfigService,
    () => {
      mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
    },
  );
  registerStoreCollectionAutomationIpcHandlers(
    mainRuntimeContext.trackedIpcRegistrar,
    mainRuntimeContext.state.storeCollectionAutomationService,
    runtimeLogger,
    () => { mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated'); },
  );
  if (!mainRuntimeContext.state.storeEvidenceRetentionService) {
    throw new Error('店铺证据保留预览服务尚未就绪。');
  }
  registerStoreEvidenceRetentionIpcHandlers(
    schedulerEvidenceIpc,
    mainRuntimeContext.state.storeEvidenceRetentionService,
  );
  registerStoreCollectionSchedulerIpcHandlers(
    schedulerEvidenceIpc,
    mainRuntimeContext.packageUiReadOnlyRuntime
      ? {
          get: (context) => readPackageUiStoreCollectionSchedule(context),
          runNow: async () => {
            throw new Error(
              'PACKAGE_UI_EVIDENCE_READ_ONLY: package UI evidence may read scheduler state but may not execute collection.',
            );
          },
        }
      : mainRuntimeContext.state.storeCollectionSchedulerReadModel
        ? {
            get: (context) => mainRuntimeContext.state.storeCollectionSchedulerReadModel!.get(context),
            runNow: (context) => mainRuntimeContext.state.storeCollectionSchedulerReadModel!.runNow(context),
          }
        : (() => {
            throw new Error('正式采集调度读模型尚未初始化。');
          })(),
  );
  registerStoreScopedObjectsIpcHandlers(
    mainRuntimeContext.trackedIpcRegistrar,
    new StoreScopedObjectsService({
      storeCoordinator: mainRuntimeContext.state.storeCoordinator,
      productRepository: mainRuntimeContext.state.productRepo,
      operationEventRepository: mainRuntimeContext.state.operationEventRepo,
      validateEvidenceArtifact: (store, artifactId) => {
        try {
          mainRuntimeContext.mainArtifactRegistry.resolve({
            artifactId,
            currentStoreId: store.storeId,
            allowedRoots: artifactAllowedRootsForStore(store, 'export-file'),
          });
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      onObjectsChanged: (context, mutation) => {
        mainRuntimeContext.state.missionDomainService!.recordOperationEventMutation(context, mutation);
        mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
      },
    },
  );
  mainRuntimeContext.state.storeScopedAdListingService = new StoreScopedAdListingService({
    db: mainRuntimeContext.state.db!,
    storeCoordinator: mainRuntimeContext.state.storeCoordinator,
  });
  registerStoreScopedAdListingIpcHandlers(
    mainRuntimeContext.trackedIpcRegistrar,
    mainRuntimeContext.state.storeScopedAdListingService,
    {
      onListingChanged: () => {
        mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
      },
    },
  );

  
  mainRuntimeContext.registerTrackedIpcHandler('app:get-version', () => mainRuntimeContext.APP_VERSION);
  mainRuntimeContext.registerTrackedIpcHandler('app:get-state', () => ({
    isLoggedIn: mainRuntimeContext.state.isLoggedIn,
    currentStore: mainRuntimeContext.state.currentStore,
    loginSession: mainRuntimeContext.state.loginSession,
    storeContext: mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext() ?? null,
  }));

  // 设置入口与其余领域共用异常边界和关闭准入。
  registerSettingsIpcHandlers(mainRuntimeContext.trackedIpcRegistrar, {
    readAiSettingsForMain,
    persistAiSettingsForMain,
    resolveBusinessStoreAuthority,
    handleTestAiSettings,
    handleListAiCallLogs,
    getRuleConfig: () => mainRuntimeContext.state.ruleConfig,
    saveRuleConfig: (config) => mainRuntimeContext.state.configurationBus?.saveRuleConfig(config),
    handleGetOperationScope,
    handleSaveOperationScope,
    handleGetStoragePaths,
    onBusinessDataUpdated: () => mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated'),
  });

  
  mainRuntimeContext.registerTrackedIpcHandler('browser:get-saved-credential-status', () => handleGetSavedLoginCredentialStatus());
  mainRuntimeContext.registerTrackedIpcHandler('browser:login', (_, input) =>
    handleBrowserLogin(normalizeBrowserLoginRequest(input))
  );
  mainRuntimeContext.registerTrackedIpcHandler('browser:confirm-ads-identity', (_, input) =>
    handleConfirmBrowserLoginAdsIdentity(
      normalizeBrowserLoginAdsIdentityConfirmation(input),
    )
  );
  mainRuntimeContext.registerTrackedIpcHandler('browser:logout', () => handleBrowserLogout());
  mainRuntimeContext.registerTrackedIpcHandler('browser:screenshot', (_, label) => handleScreenshot(normalizeScreenshotLabel(label)));
  mainRuntimeContext.registerTrackedIpcHandler('browser:is-ready', () => Boolean(
    mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext()
    && isProviderBrowserSessionReady(mainRuntimeContext.state.storeCoordinator.getActiveStoreContext()!, 'lingxing')
    && isProviderBrowserSessionReady(mainRuntimeContext.state.storeCoordinator.getActiveStoreContext()!, 'amazon_ads'),
  ));

  
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:collect-lingxing', async (_, dateRange) => {
    const result = await handleCollectLingxingReports(dateRange);
    return projectLingxingCollectionResultForRenderer(result, result.metricsImport);
  });
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:business-ui:data-pipeline', (_, scope) =>
    projectBusinessPipelineForRenderer(handleGetBusinessUiDataPipeline(scope))
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:business-ui:batch-options', (_, scope) => {
    const storeId = currentArtifactStore().storeId;
    return rendererPayload(handleGetBusinessBatchOptions(scope).map((batch) => (
      projectBusinessBatchOptionForRenderer(storeId, batch)
    )));
  });
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:business-ui:import-current-reports', (_, scope) =>
    projectBusinessImportResultForRenderer(handleImportCurrentBusinessReports(scope))
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:business-ui:import-local-report-files', async (_, scope) =>
    projectBusinessImportResultForRenderer(await handleImportLocalBusinessReportFiles(scope))
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:delivery:readiness', () =>
    handleGetDeliveryReadiness()
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:delivery:refresh-final-readiness', (_, input) =>
    handleRefreshFinalReadiness(input)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:delivery:evidence-status', (_, scope) =>
    handleGetDeliveryEvidenceStatus(scope)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:delivery:export-bundle', (_, scope) =>
    handleExportDeliveryBundle(scope)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:delivery:export-data-reconciliation', (_, scope) =>
    handleExportDataReconciliation(scope)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:business-ui:export-data-reconciliation-artifacts', (_, scope) =>
    handleExportDataReconciliationArtifacts(scope)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:settings:storage-paths', () =>
    handleGetStoragePaths()
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:preflight-lingxing-collection', (_, dateRange) =>
    handlePreflightLingxingCollection(dateRange)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:export-lingxing-collection-preflight', (_, dateRange) =>
    projectExportArtifactForCurrentStore(
      handleExportLingxingCollectionPreflight(dateRange),
      'diagnostic-folder',
      '采集预检证据',
    )
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:retry-lingxing-report', async (_, { dateRange, reportType }) => {
    const result = await handleRetryLingxingReport(dateRange, reportType);
    return projectLingxingCollectionResultForRenderer(result, result.metricsImport);
  });
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:download-existing-lingxing-reports', async (_, { dateRange, reportTypes }) => {
    const result = await handleDownloadExistingLingxingReports(dateRange, Array.isArray(reportTypes) ? reportTypes : []);
    return projectLingxingCollectionResultForRenderer(result, result.metricsImport);
  });
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:run-lingxing-canary-report', async (_, { dateRange, reportType }) => (
    projectLingxingCollectionResultForRenderer(await handleRunLingxingCanaryReport(dateRange, reportType))
  ));
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:list-lingxing-collection-jobs', (_, input) =>
    rendererPayload(handleListLingxingCollectionJobs(input))
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:resume-lingxing-collection', async (_, input) =>
    rendererPayload(await handleResumeLingxingCollection(input))
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:cancel-lingxing-collection', (_, input) =>
    handleCancelLingxingCollection(input)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:export-acceptance-audit', (_, { batchId, diagnosticId }) =>
    projectExportArtifactForCurrentStore(
      handleExportLingxingAcceptanceAudit(batchId, diagnosticId),
      'diagnostic-folder',
      '采集验收审计',
    )
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:diagnose-download-center', async (_, dateRange) =>
    projectDiagnosticForRenderer(await handleDiagnoseLingxingDownloadCenter(dateRange))
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:export-download-center-diagnostic-bundle', (_, { diagnosticId }) =>
    projectExportArtifactForCurrentStore(
      handleExportDownloadCenterDiagnosticBundle(diagnosticId),
      'diagnostic-folder',
      '下载中心诊断包',
    )
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:export-download-center-page-model-draft', (_, { diagnosticId }) => {
    const result = handleExportDownloadCenterPageModelDraft(diagnosticId);
    return rendererPayload({
      artifact: projectExportArtifactForCurrentStore(result.exportPath, 'diagnostic-folder', '页面模型草稿'),
      draft: result.draft,
      notes: result.notes,
    });
  });
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:export-download-center-page-model-enablement-audit', (_, { dateRange, diagnosticId }) => {
    const result = handleExportDownloadCenterPageModelEnablementAudit(dateRange, diagnosticId);
    return rendererPayload({
      artifact: projectExportArtifactForCurrentStore(result.exportPath, 'diagnostic-folder', '页面模型放行审计'),
      canDisableManualVerification: result.canDisableManualVerification,
      missing: result.missing,
    });
  });
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:get-download-center-page-model', () =>
    handleGetDownloadCenterPageModel()
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:save-download-center-page-model', (_, model) =>
    handleSaveDownloadCenterPageModel(model)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:reset-download-center-page-model', () =>
    handleResetDownloadCenterPageModel()
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:reports:open-artifact', (_, input) =>
    handleOpenArtifact(input)
  );
  
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:get', (_, filter) => handleGetRecommendations(filter));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:generate', (_, filter) => runRecommendationGeneration(filter));
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:business-ui:ad-strategy-diagnosis', (_, filter) => handleRunAdStrategyDiagnosis(filter));
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:business-ui:ai-diagnosis-runs', (_, filter) => handleListAiDiagnosisRuns(filter));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:bind-writable-target', (_, input) => handleBindRecommendationWritableTarget(input));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:resolve-review', (_, input) => handleResolveRecommendationReview(input));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:approve', (_, id) => handleApproveRecommendation(id));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:reject', (_, id) => handleRejectRecommendation(id));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:execute', (_, id) => handleExecuteRecommendation(id));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:export-ad-readback-evidence', (_, input) => handleExportAdReadbackEvidence(input));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:prepare-ad-readback-session', (_, input) => handlePrepareAdReadbackSession(input));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:verify-ad-readback-session', (_, input) => handleVerifyAdReadbackSession(input));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:fill-ad-readback-session', (_, input) => handleFillAdReadbackSession(input));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:verify-ad-readback-evidence', (_, input) => handleVerifyAdReadbackEvidence(input));
  mainRuntimeContext.registerTrackedIpcHandler('recommendations:save-readback-capture', (_, input) => handleSaveReadbackCapture(input));

  
  mainRuntimeContext.registerTrackedIpcHandler('scheduler:get-tasks', () => mainRuntimeContext.state.scheduler?.getTasks() || []);
  mainRuntimeContext.registerTrackedIpcHandler('scheduler:set-task-enabled', () => {
    throw new Error('LEGACY_SCHEDULER_IPC_DISABLED: 请使用带 StoreContext 的店铺采集调度配置。');
  });
  mainRuntimeContext.registerTrackedIpcHandler('scheduler:run-now', async () => {
    throw new Error('LEGACY_SCHEDULER_IPC_DISABLED: 旧调度入口没有店铺授权，已失败关闭。');
  });

  
  mainRuntimeContext.registerTrackedIpcHandler('logs:get', (_, { dateFrom, dateTo, limit }) => {
    const { context } = resolveBusinessStoreAuthority();
    return mainRuntimeContext.state.actionLogRepo?.findByDateRangeForStore(context.storeId, dateFrom, dateTo, limit) || [];
  });

  
  mainRuntimeContext.registerTrackedIpcHandler('metrics:get-recent', (_, days) => {
    const { context } = resolveBusinessStoreAuthority();
    return mainRuntimeContext.state.adMetricsRepo?.getRecentForStore(context.storeId, days) || [];
  });
  mainRuntimeContext.registerTrackedIpcHandler('metrics:get-summary', (_, date) => {
    const { context } = resolveBusinessStoreAuthority();
    return {
      totalSales: mainRuntimeContext.state.adMetricsRepo?.getTotalSalesForStore(context.storeId, date) || 0,
      totalCost: mainRuntimeContext.state.adMetricsRepo?.getTotalCostForStore(context.storeId, date) || 0,
      totalClicks: mainRuntimeContext.state.adMetricsRepo?.getTotalClicksForStore(context.storeId, date) || 0,
      totalOrders: mainRuntimeContext.state.adMetricsRepo?.getTotalOrdersForStore(context.storeId, date) || 0,
      avgAcos: 0,
    };
  });

  mainRuntimeContext.registerTrackedIpcHandler('v1_5:keywords:build-opportunities', (_, { metrics, options }) =>
    handleBuildKeywordOpportunities(metrics, options)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:keywords:export-diagnostics', (_, { diagnostics }) =>
    handleExportKeywordDiagnostics(diagnostics)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:listing:analyze-coverage', (_, { listing, keywords }) =>
    handleAnalyzeListingCoverage(listing, keywords)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:listing:build-suggestions', (_, { listing, opportunities }) =>
    handleBuildListingSuggestions(listing, opportunities)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:listing:update-suggestion-status', (_, { id, status }) =>
    handleUpdateListingSuggestionStatus(id, status)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:listing:generate-drafts', (_, { suggestions }) =>
    handleGenerateListingDrafts(suggestions)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:listing:export-suggestions', (_, { suggestions, format }) =>
    handleExportListingSuggestions(suggestions, format)
  );
  mainRuntimeContext.registerTrackedIpcHandler('v1_5:listing:export-drafts', (_, { drafts, format }) =>
    handleExportListingDrafts(drafts, format)
  );
}
