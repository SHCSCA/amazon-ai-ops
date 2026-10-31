import * as fs from 'fs';
import { deriveStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { LocalScheduler } from '@amazon-ai-ops/scheduler';
import { registerScheduledAnalysisTask } from './scheduled-analysis-task';
import { createScheduledTaskErrorHandler, notifyScheduledTask } from './scheduled-task-error-handler';
import { AuditLogger, ScreenshotManager, TraceManager } from '@amazon-ai-ops/audit-log';
import { initGuardedExistingSqlite, initSqlite } from '@amazon-ai-ops/local-db/src/sqlite/db';
import { ActionLogRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/action-log-repo';
import { AdMetricsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ad-metrics-repo';
import { ProductRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/product-repo';
import { RecommendationRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/recommendation-repo';
import { ConfigurationBus } from './configuration-bus';
import { bindRuleConfiguration } from './rule-configuration';
import { OperationEventRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/operation-event-repo';
import { ReportFileRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/report-file-repo';
import { AiCallLogRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ai-call-log-repo';
import { AiDiagnosisRunRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ai-diagnosis-run-repo';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import { LingxingImportRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-repo';
import { MissionDomainRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/mission-domain-repo';
import { AnalysisAuthorityRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/analysis-authority-repo';
import { ExecutionAuthorityRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/execution-authority-repo';
import type { TaskName } from '@amazon-ai-ops/scheduler';
import { runtimeLogger } from './runtime-logger';
import { runtimeLog } from './runtime-log-adapter';
import { assertLingxingImportStartupRecoverySafe } from './lingxing-import-startup-recovery-gate';
import { completeS7MainStartupAdmission, protectFreshS7AuthorityPath, type S7MainStartupAdmission } from './s7-migration-startup-gate';
import { AD_STRATEGY_ANALYSIS_PROMPT_SCHEMA_VERSION, analysisAiRuntimeRevision, resolveSystemAiRuntimeConfig } from './system-ai-runtime-config';
import { storeContextTracker } from './v16-store-context-guard';
import { DurableStoreSessionGenerationAuthority, StoreCoordinator } from './store-coordinator';
import { StoreDailyStatusProjectionReader } from './store-daily-status-projection-reader';
import { MissionDomainService } from './mission-domain-service';
import { AnalysisAuthorityService, type AnalysisRecommendationGenerationScope } from './analysis-authority-service';
import { ExecutionAuthorityService } from './execution-authority-service';
import { EXECUTION_AUTHORITY_PROGRESS_CHANNEL } from './execution-authority-ipc';
import { currentAdEntityBelongsToStore } from './legacy-writable-ad-entity-authority';
import { StoreRuntimeConfigService } from './store-runtime-config-service';
import { StoreCollectionAutomationService } from './store-collection-automation-service';
import { StoreEvidenceRetentionPreviewService } from './store-evidence-retention-ipc';
import { storeRuntimeRuleRevisionPayload } from './store-runtime-analysis-config';
import { assertRendererPayloadIsPathFree } from './main-artifact-registry';
import { analysisRuleRevision, currentStoreRuntimeAnalysisConfig, ensureDirs, storeCapsuleFor, storeEvidenceRetentionReferencesFor, storeSessionGenerationSettingKey } from './main-store-access-runtime';
import { browserControllerFromVisibleRuntime, handleGetSavedLoginCredentialStatus, sameExactStoreContext } from './main-browser-session-runtime';
import { captureRecommendationGenerationRuntimeSnapshot, captureTrustedAnalysisCausalMemory, runRecommendationGeneration } from './main-recommendation-generation-runtime';
import { readAiSettingsForMain } from './main-ai-settings-runtime';
import { artifactAllowedRootsForStore, rendererPayload } from './main-artifacts-runtime';
import { initializeLingxingCollectionCoordinator, initializeStoreCollectionProductionRuntime } from './main-collection-initialization-runtime';
import { recoverInterruptedLingxingCollectionJobsOnStartup, recoverPendingLingxingCollectionImportsOnStartup } from './main-collection-import-recovery-runtime';
import { handleGetOperationScope } from './main-delivery-scope-runtime';
import { runDailyReportGeneration } from './main-ad-execution-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export async function initApp(): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  runtimeLog.log('[App] init:start');

  
  const freshCanonicalAuthority = mainRuntimeContext.mainStartupAdmission?.mode === 'NORMAL'
    && !fs.existsSync(mainRuntimeContext.DB_PATH);
  if (freshCanonicalAuthority) {
    fs.mkdirSync(mainRuntimeContext.USER_DATA_DIR, { recursive: true });
    protectFreshS7AuthorityPath(
      mainRuntimeContext.USER_DATA_DIR,
      'directory',
      'Fresh authority userData directory',
    );
  }
  if (mainRuntimeContext.mainStartupAdmission?.mode === 'S7_APPROVED_CHILD') {
    mainRuntimeContext.state.db = initGuardedExistingSqlite(mainRuntimeContext.DB_PATH, ({ database, resolvedPath }) => (
      completeS7MainStartupAdmission({
        startup: mainRuntimeContext.mainStartupAdmission as Extract<
          S7MainStartupAdmission,
          { mode: 'S7_APPROVED_CHILD' }
        >,
        database,
        resolvedDatabasePath: resolvedPath,
        executablePath: mainRuntimeContext.bootstrapConfiguration.executablePath,
        mainModulePath: mainRuntimeContext.bootstrapConfiguration.mainModulePath,
      })
    )).database;
  } else {
    mainRuntimeContext.state.db = initSqlite(mainRuntimeContext.DB_PATH);
  }
  if (freshCanonicalAuthority) {
    protectFreshS7AuthorityPath(
      mainRuntimeContext.DB_PATH,
      'file',
      'Fresh authority database',
    );
    runtimeLog.info('[Security] Fresh authority path ACLs protected');
  }
  runtimeLog.log('[App] init:sqlite-ready');
  ensureDirs();
  runtimeLog.log('[App] init:dirs-ready');

  
  mainRuntimeContext.state.configurationBus = new ConfigurationBus(mainRuntimeContext.state.db);
  try {
    const credentialStatus = handleGetSavedLoginCredentialStatus();
    runtimeLog.log('[Security] login credential state', JSON.stringify({
      credentialState: credentialStatus.credentialState,
      passwordAvailable: credentialStatus.passwordAvailable,
      rememberPassword: credentialStatus.rememberPassword,
    }));
  } catch (error) {
    runtimeLogger.warn('security.login_credential_state_unavailable', {
      credentialState: 'migration_failed',
      error,
    });
  }
  mainRuntimeContext.state.productRepo = new ProductRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.actionLogRepo = new ActionLogRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.adMetricsRepo = new AdMetricsRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.recommendationRepo = new RecommendationRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.operationEventRepo = new OperationEventRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.reportFileRepo = new ReportFileRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.aiCallLogRepo = new AiCallLogRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.aiCallLogRepo.recoverInterruptedCosts();
  mainRuntimeContext.state.aiDiagnosisRunRepo = new AiDiagnosisRunRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.storeRepo = new StoreRepository(mainRuntimeContext.state.db);
  mainRuntimeContext.state.lingxingImportRepo = new LingxingImportRepository(mainRuntimeContext.state.db);
  const storeSessions = new DurableStoreSessionGenerationAuthority({
    transaction: (work) => mainRuntimeContext.state.configurationBus!.transaction(work),
    read: (storeId) => {
      const raw = mainRuntimeContext.state.configurationBus!.get(storeSessionGenerationSettingKey(storeId));
      return raw === null ? undefined : Number(raw);
    },
    write: (storeId, sessionGeneration) => {
      mainRuntimeContext.state.configurationBus!.set(
        storeSessionGenerationSettingKey(storeId),
        String(sessionGeneration),
      );
    },
  });
  for (const store of mainRuntimeContext.state.storeRepo.listStores({ includeArchived: true })) {
    const durableGeneration = mainRuntimeContext.state.storeRepo.listSessionMetadata(store.storeId)
      .reduce((maximum, session) => Math.max(maximum, session.sessionGeneration), 0);
    storeSessions.seed(store.storeId, durableGeneration);
  }
  const storeCoordinator = new StoreCoordinator({
    repository: mainRuntimeContext.state.storeRepo,
    sessions: storeSessions,
    selectionStorage: {
      read: () => {
        const raw = mainRuntimeContext.state.configurationBus!.get(mainRuntimeContext.OPERATOR_WORKSPACE_SELECTION_SETTING_KEY);
        if (raw === null) return null;
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return raw;
        }
      },
      write: (selection) => {
        if (mainRuntimeContext.packageUiReadOnlyRuntime) {
          throw new Error('PACKAGE_UI_EVIDENCE_READ_ONLY: operator selection write rejected');
        }
        mainRuntimeContext.state.configurationBus!.set(
          mainRuntimeContext.OPERATOR_WORKSPACE_SELECTION_SETTING_KEY,
          JSON.stringify(selection),
        );
      },
      clear: () => {
        if (mainRuntimeContext.packageUiReadOnlyRuntime) {
          throw new Error('PACKAGE_UI_EVIDENCE_READ_ONLY: operator selection clear rejected');
        }
        mainRuntimeContext.state.configurationBus!.delete(mainRuntimeContext.OPERATOR_WORKSPACE_SELECTION_SETTING_KEY);
      },
    },
    selectionPersistence: mainRuntimeContext.packageUiReadOnlyRuntime ? 'memory_only' : 'read_write',
  });
  const storeDailyStatusReader = new StoreDailyStatusProjectionReader({
    stores: mainRuntimeContext.state.storeRepo,
    imports: mainRuntimeContext.state.lingxingImportRepo,
    generations: storeSessions,
    selection: storeCoordinator,
    readTransaction: (work) => mainRuntimeContext.state.db!.transaction(work).deferred(),
  });
  const analysisAuthorityRepo = new AnalysisAuthorityRepository(mainRuntimeContext.state.db);
  const missionDomainRepo = new MissionDomainRepository(mainRuntimeContext.state.db, {
    references: {
      productBelongsToStore: (context, productId) => Boolean(
        mainRuntimeContext.state.productRepo?.findByAsinForStore(context.storeId, productId),
      ),
      adEntityBelongsToStore: (context, adEntityId) => Boolean(
        currentAdEntityBelongsToStore(analysisAuthorityRepo, mainRuntimeContext.state.db!, context, adEntityId),
      ),
      adEntitySupportsKeywordBid: (context, adEntityId) => {
        const authority = analysisAuthorityRepo.getLatestVerifiedAdEntityById(context, adEntityId);
        return authority?.entityType === 'keyword' && authority.sourceReportType === 'keyword';
      },
    },
  });
  const missionDomainService = new MissionDomainService({
    repository: missionDomainRepo,
    aiCalls: mainRuntimeContext.state.aiCallLogRepo,
    storeCoordinator,
  });
  const storeRuntimeConfigService = new StoreRuntimeConfigService({
    storeCoordinator,
    settings: mainRuntimeContext.state.configurationBus!,
  });
  const storeCollectionAutomationService = new StoreCollectionAutomationService({
    storeCoordinator, settings: mainRuntimeContext.state.configurationBus!,
  });
  const storeEvidenceRetentionService = new StoreEvidenceRetentionPreviewService({
    authority: storeCoordinator,
    runtimeConfig: storeRuntimeConfigService,
    deriveCapsuleFor: (context) => deriveStoreCapsulePaths(
      mainRuntimeContext.STORES_DIR,
      context.storeId,
      context.browserProfileId,
    ),
    referencesFor: storeEvidenceRetentionReferencesFor,
    artifactResolver: mainRuntimeContext.mainArtifactRegistry,
  });
  const analysisAuthorityService = new AnalysisAuthorityService({
    db: mainRuntimeContext.state.db,
    repository: analysisAuthorityRepo,
    missionRepository: missionDomainRepo,
    recommendationRepository: mainRuntimeContext.state.recommendationRepo,
    storeCoordinator,
    generateRecommendations: (scope) => runRecommendationGeneration(
      scope,
      undefined,
      captureTrustedAnalysisCausalMemory(scope),
    ),
    captureGenerationAuthority: () => {
      const captured = captureRecommendationGenerationRuntimeSnapshot();
      return Object.freeze({
        ruleRevision: analysisRuleRevision(
          storeRuntimeRuleRevisionPayload(captured.runtimeConfig),
        ),
        modelRevision: analysisAiRuntimeRevision({
          system: resolveSystemAiRuntimeConfig(captured.aiSettings),
          storeAiRecommendationsEnabled: captured.runtimeConfig.values.aiRecommendationsEnabled,
          promptSchemaVersion: AD_STRATEGY_ANALYSIS_PROMPT_SCHEMA_VERSION,
        }),
        generateRecommendations: (scope: AnalysisRecommendationGenerationScope) => (
          runRecommendationGeneration(scope, captured)
        ),
      });
    },
    currentRuleRevision: () => analysisRuleRevision(
      storeRuntimeRuleRevisionPayload(currentStoreRuntimeAnalysisConfig()),
    ),
    currentModelRevision: () => {
      const settings = readAiSettingsForMain();
      const runtime = currentStoreRuntimeAnalysisConfig();
      return analysisAiRuntimeRevision({
        system: resolveSystemAiRuntimeConfig(settings),
        storeAiRecommendationsEnabled: runtime.values.aiRecommendationsEnabled,
        promptSchemaVersion: AD_STRATEGY_ANALYSIS_PROMPT_SCHEMA_VERSION,
      });
    },
    allowedProofRoots: (context) => {
      const store = mainRuntimeContext.state.storeRepo?.getStore(context.storeId);
      return store?.status === 'active'
        ? artifactAllowedRootsForStore(store, 'diagnostic-file')
        : [];
    },
    onAnalysisRunCompleted: (run) => {
      try {
        assertRendererPayloadIsPathFree(run);
        mainRuntimeContext.mainWindow?.webContents.send('analysis-authority:analysis-completed', run);
      } catch (error) {
        runtimeLog.error('[Analysis] completion payload rejected before renderer emit', error);
      }
    },
    onAutomaticGrantIssued: (context, grant) => {
      const service = mainRuntimeContext.state.executionAuthorityService;
      if (!service) {
        runtimeLog.error('[Execution] policy grant issued before execution authority initialization');
        return;
      }
      void service.enqueuePolicyGrant(context, grant).catch(() => {
        runtimeLog.error('[Execution] automatic grant enqueue rejected before safe queue entry');
      });
    },
  });
  const executionAuthorityRepo = new ExecutionAuthorityRepository(mainRuntimeContext.state.db);
  const executionAuthorityService = new ExecutionAuthorityService({
    repository: executionAuthorityRepo,
    missionRepository: missionDomainRepo,
    analysisRepository: analysisAuthorityRepo,
    storeCoordinator,
    leases: mainRuntimeContext.browserOperationLeases,
    policyDispatchSuppression: mainRuntimeContext.executionPolicyDispatchSuppression,
    resolveBrowserRuntime: (context) => {
      const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
      if (!runtime
        || runtime.purpose !== 'operator_full'
        || runtime.providerIdentityStatus.lingxing !== 'verified'
        || runtime.providerIdentityStatus.amazonAds !== 'verified'
        || !sameExactStoreContext(runtime.context, context)) {
        throw new Error('请先为当前店铺启动并登录独立的领星 ERP 与 Amazon Ads 可见浏览器。');
      }
      const store = mainRuntimeContext.state.storeRepo?.getStore(context.storeId);
      const controller = browserControllerFromVisibleRuntime(runtime, 'amazon_ads');
      const connection = runtime.connections?.amazonAds;
      const page = controller?.getPage();
      const externalAccountId = connection?.externalAccountId?.trim();
      const adsSession = mainRuntimeContext.state.storeRepo?.getSessionMetadata(context.storeId, 'amazon_ads');
      if (!store
        || store.status !== 'active'
        || !controller
        || !connection
        || !page
        || !externalAccountId
        || !adsSession
        || adsSession.status !== 'ready'
        || adsSession.browserProfileId !== context.browserProfileId
        || adsSession.sessionGeneration !== context.sessionGeneration) {
        throw new Error('当前店铺的 Amazon Ads 会话或 externalAccountId 尚未就绪。');
      }
      return {
        context: Object.freeze({ ...runtime.context }),
        externalAccountId,
        page,
        capsule: storeCapsuleFor(store),
        navigate: (url: string) => controller.navigate(url),
        bringToFront: () => controller.bringToFront(),
      };
    },
    emitProgress: (event) => {
      mainRuntimeContext.mainWindow?.webContents.send(
        EXECUTION_AUTHORITY_PROGRESS_CHANNEL,
        rendererPayload(event),
      );
      mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
    },
  });
  
  
  
  mainRuntimeContext.state.storeCoordinator = storeCoordinator;
  mainRuntimeContext.state.storeDailyStatusReader = storeDailyStatusReader;
  mainRuntimeContext.state.analysisAuthorityRepo = analysisAuthorityRepo;
  mainRuntimeContext.state.missionDomainRepo = missionDomainRepo;
  mainRuntimeContext.state.missionDomainService = missionDomainService;
  mainRuntimeContext.state.analysisAuthorityService = analysisAuthorityService;
  mainRuntimeContext.state.executionAuthorityRepo = executionAuthorityRepo;
  mainRuntimeContext.state.executionAuthorityService = executionAuthorityService;
  mainRuntimeContext.state.storeRuntimeConfigService = storeRuntimeConfigService;
  mainRuntimeContext.state.storeCollectionAutomationService = storeCollectionAutomationService;
  mainRuntimeContext.state.storeEvidenceRetentionService = storeEvidenceRetentionService;
  initializeLingxingCollectionCoordinator();
  initializeStoreCollectionProductionRuntime();
  for (const store of mainRuntimeContext.state.storeRepo.listStores({ includeArchived: true })) {
    storeCapsuleFor(store);
  }
  if (mainRuntimeContext.packageUiReadOnlyRuntime) {
    mainRuntimeContext.packageUiSchedulerAudit.recordSuppressed('startupReconcile');
    runtimeLog.info('[CollectionRuntime] package-ui read-only startup recovery suppressed');
  } else {
    
    
    
    
    const resumeRecovery = mainRuntimeContext.state.lingxingImportRepo!
      .interruptOrphanedCollectionResumeClaimsForStartup();
    runtimeLog.log('[App] init:lingxing-resume-recovery', JSON.stringify({
      interrupted: resumeRecovery.filter((receipt) => receipt.outcome === 'interrupted').length,
      succeeded: resumeRecovery.filter((receipt) => receipt.outcome === 'succeeded').length,
    }));
    const importRecovery = await recoverPendingLingxingCollectionImportsOnStartup();
    runtimeLog.log('[App] init:lingxing-import-recovery', JSON.stringify(importRecovery));
    assertLingxingImportStartupRecoverySafe(importRecovery);
    const collectionRecovery = recoverInterruptedLingxingCollectionJobsOnStartup();
    runtimeLog.log('[App] init:lingxing-collection-recovery', JSON.stringify(collectionRecovery));
    if (collectionRecovery.failedStores !== 0) {
      throw new Error(
        'LINGXING_COLLECTION_RESTART_RECOVERY_FAILED: interrupted queued/running jobs were not terminalized for every Store',
      );
    }
    await mainRuntimeContext.state.storeCollectionMainRuntime!.recoverStartupThenConfirm();
    runtimeLog.log('[App] init:store-collection-runtime-recovery-confirmed');
    const executionRecovery = executionAuthorityService.recoverStartup();
    runtimeLog.log('[App] init:execution-recovery', JSON.stringify(executionRecovery));
  }
  const restoredSelection = storeCoordinator.restoreOperatorWorkspaceSelectionAfterRecovery();
  const restoredWorkspace = restoredSelection
    ? storeCoordinator.getActiveStoreWorkspaceView()
    : null;
  mainRuntimeContext.state.currentStore = restoredWorkspace?.store.displayName ?? '';
  runtimeLog.log('[App] init:operator-workspace-selection', JSON.stringify({
    restored: Boolean(restoredSelection),
    storeId: restoredSelection?.storeId ?? null,
    marketplace: restoredSelection?.marketplace ?? null,
    persistence: mainRuntimeContext.packageUiReadOnlyRuntime ? 'read_only' : 'read_write',
  }));
  readAiSettingsForMain();
  runtimeLog.log('[App] init:repositories-ready');

  
  const auditLogger = new AuditLogger(mainRuntimeContext.state.db);
  const screenshotMgr = new ScreenshotManager(mainRuntimeContext.SCREENSHOTS_DIR);
  const traceMgr = new TraceManager(mainRuntimeContext.TRACES_DIR);

  bindRuleConfiguration(mainRuntimeContext.state.configurationBus, (configuration) => { mainRuntimeContext.state.ruleConfig = configuration; });

  
  mainRuntimeContext.state.scheduler = new LocalScheduler({
    timezone: 'Asia/Shanghai',
    onTaskStart: (taskName: TaskName) => {
      notifyScheduledTask('start', taskName, () => mainRuntimeContext.mainWindow?.webContents.send('scheduler:task-start', taskName));
    },
    onTaskComplete: (taskName: TaskName, duration: number) => {
      notifyScheduledTask('complete', taskName, () => mainRuntimeContext.mainWindow?.webContents.send('scheduler:task-complete', { taskName, duration }));
    },
    onTaskError: createScheduledTaskErrorHandler((taskName: TaskName, error: Error) => {
      mainRuntimeContext.mainWindow?.webContents.send('scheduler:task-error', { taskName, error: error.message });
    }),
  });

  
  registerScheduledAnalysisTask(mainRuntimeContext.state.scheduler, {
    readScope: handleGetOperationScope,
    runAnalysis: runRecommendationGeneration,
  });

  mainRuntimeContext.state.scheduler.register({
    name: 'daily_report_generate',
    cron: '0 21 * * *',
    enabled: false,
    callback: () => runDailyReportGeneration(),
  });

  mainRuntimeContext.state.scheduler.register({
    name: 'data_cleanup',
    cron: '0 3 * * *',
    enabled: false,
    callback: async () => {
      if (!mainRuntimeContext.state.storeEvidenceRetentionService) {
        throw new Error('STORE_RETENTION_SERVICE_UNAVAILABLE');
      }
      const manifest = mainRuntimeContext.state.storeEvidenceRetentionService.previewActiveStore();
      if (!manifest) {
        runtimeLog.info('[Retention] data_cleanup dry-run skipped: no active store');
        return;
      }
      mainRuntimeContext.mainWindow?.webContents.send('cleanup:report', rendererPayload(manifest));
    },
  });

  
  
  
  
  if (mainRuntimeContext.packageUiReadOnlyRuntime) {
    mainRuntimeContext.packageUiSchedulerAudit.recordSuppressed('localSchedulerStart');
    mainRuntimeContext.packageUiSchedulerAudit.recordSuppressed('storeSchedulerStart');
    mainRuntimeContext.packageUiSchedulerAudit.checkpoint();
  } else {
    mainRuntimeContext.packageUiSchedulerAudit.recordControl('localSchedulerStart');
    mainRuntimeContext.state.scheduler.start();
    mainRuntimeContext.packageUiSchedulerAudit.recordControl('storeSchedulerStart');
    mainRuntimeContext.state.storeCollectionMainRuntime!.start();
  }

  
  const initialView = mainRuntimeContext.state.storeCoordinator.getActiveStoreWorkspaceView();
  if (initialView) {
    storeContextTracker.setContext(initialView.context);
    runtimeLog.log('[StoreContextTracker] initialized with active store', JSON.stringify({
      storeId: initialView.context.storeId,
      sessionGeneration: initialView.context.sessionGeneration,
      businessDate: initialView.context.businessDate,
    }));
  } else {
    runtimeLog.log('[StoreContextTracker] initialized with no active store');
  }

  runtimeLog.log('[App] Initialized successfully');
}
