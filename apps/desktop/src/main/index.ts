import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  BrowserController,
  BrowserLeaseManager,
  CollectionOperationGuard,
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
  resolveStoreCapsuleDownloadTarget,
  type StoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import { LocalScheduler } from '@amazon-ai-ops/scheduler';
import { AuditLogger, ScreenshotManager, TraceManager } from '@amazon-ai-ops/audit-log';
import { AdQuantifier, RecommendationGenerator, DEFAULT_RULE_CONFIG, buildAdMetricObjectIdentity, mergeAdDecisions } from '@amazon-ai-ops/rules-engine';
import { ReportParser, keywordMetricDiagnosticsToCsv, parseKeywordMetricsWithDiagnostics, parseListingContent } from '@amazon-ai-ops/report-parser';
import { assertLingxingParsedReportImportable } from './lingxing-report-import-validation';
import { AdActionReasonExplainer, AdStrategyDiagnoser, OpenAICompatibleProvider, DailyReportGenerator, assessAdEvidenceSufficiency, type AdStrategyDiagnosisOutput, type AiEvidenceItem, type AiReasonedDecision, type ProductStrategyContext } from '@amazon-ai-ops/ai-adapter';
import {
  initGuardedExistingSqlite,
  initSqlite,
  getSqliteDb,
} from '@amazon-ai-ops/local-db/src/sqlite/db';
import {
  adMetricCanonicalWhere,
  adMetricGrainWhere,
  inferAdMetricReportType,
  type AdMetricReportGrain,
} from '@amazon-ai-ops/local-db/src/sqlite/ad-metric-grain';
import { ActionLogRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/action-log-repo';
import { AdMetricsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ad-metrics-repo';
import { ProductRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/product-repo';
import { RecommendationRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/recommendation-repo';
import { SettingsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/settings-repo';
import { OperationEventRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/operation-event-repo';
import { ReportFileRepository, type ReportFileRecord } from '@amazon-ai-ops/local-db/src/sqlite/repositories/report-file-repo';
import { AiCallLogRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ai-call-log-repo';
import { AiDiagnosisRunRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ai-diagnosis-run-repo';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import { LingxingImportRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-repo';
import { MissionDomainRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/mission-domain-repo';
import { AnalysisAuthorityRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/analysis-authority-repo';
import { ExecutionAuthorityRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/execution-authority-repo';
import { assertDownloadCenterCollectionPreflightReady, auditDownloadCenterPageModelEnablement, auditLingxingAcceptanceEvidence, buildDownloadCenterCollectionPreflight, buildDownloadCenterPageModelDraft, downloadCenterPageModelDraftToMarkdown, evaluateDownloadCenterCanaryEvidenceReadiness, evaluateDownloadCenterDiagnosticEvidenceReadiness, evaluateDownloadCenterPageModel, getDownloadCenterAutomationReadiness, LINGXING_AD_REPORTS, lingxingAcceptanceAuditToMarkdown, pollReportGenerationStatus, type DownloadCenterAutomationPort, verifyDownloadedFile, writeManifest } from '@amazon-ai-ops/lingxing-report-collector';
import { buildKeywordOpportunities } from '@amazon-ai-ops/keyword-opportunity';
import { analyzeKeywordCoverage, buildListingSuggestions as buildSafeListingSuggestions, buildRuleBasedListingDrafts, draftsToCsv, draftsToMarkdown, draftsToXlsxBuffer, suggestionsToCsv, suggestionsToMarkdown, suggestionsToXlsxBuffer } from '@amazon-ai-ops/listing-analyzer';
import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { TaskName } from '@amazon-ai-ops/scheduler';
import type { ActionRecommendation, AdDailyMetrics, DownloadCenterActionSelectorCheck, DownloadCenterActionSelectors, DownloadCenterDiagnosticResult, DownloadCenterPageModel, DownloadCenterSelectorCandidate, KeywordMetric, KeywordOpportunity, LingxingCreatedReportIdentity, LingxingReportBatch, LingxingReportFile, LingxingReportType, ListingContent, ListingDraft, ListingSuggestion } from '@amazon-ai-ops/shared-types';
import type {
  BindRecommendationWritableTargetRequest,
  BindRecommendationWritableTargetResult,
  ResolveRecommendationReviewRequest,
  ResolveRecommendationReviewResult,
  StoreConnection,
  StoreConnectionProvider,
  StoreContextEnvelope,
  StoreRecord,
  StoreWorkspaceView,
  LingxingCollectionImportState,
  LingxingCollectionJobSnapshot,
  LingxingCollectionProgressEvent,
  LingxingCollectionReportCheckpoint,
  LingxingCollectionResumeState,
} from '@amazon-ai-ops/shared-types';
import {
  canonicalizeAmazonAsin,
  missionControlContextKey,
  normalizeStoreId,
} from '@amazon-ai-ops/shared-types';
import type { BrowserLoginRequest, BrowserLoginResult } from '../shared/login-contract';
import { buildDownloadedReportEvidenceIndex, isPathInsideDirectory, isPathWithinRealDirectory, isSafeManifestPath, readLingxingManifestForAudit, safeFileSegment } from './acceptance-audit-export';
import { cleanupAppResources, createBeforeQuitCoordinator } from './app-shutdown';
import { summarizeBusinessReportCoverage } from './business-report-coverage';
import { requireBrowserLoginProviderConnections } from './browser-login-provider-connections';
import { normalizeBrowserLoginRequest } from './browser-login-request';
import { countImportedRowsForReportFile } from './business-report-import-coverage';
import {
  configureEvidenceUserDataPath,
  isPackageLaunchWindowReadyMarker,
  PACKAGE_LAUNCH_SMOKE_MODE,
  PACKAGE_LAUNCH_WINDOW_READY_MARKER,
  PACKAGE_UI_EVIDENCE_MODE,
  PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV,
} from './evidence-user-data-path';
import {
  completeS7MainStartupAdmission,
  enforceS7MainStartupGate,
  resolveCanonicalAuthorityUserDataDir,
  type S7MainStartupAdmission,
} from './s7-migration-startup-gate';
import { PackageUiSchedulerAudit } from './package-ui-scheduler-audit';
import { writeLingxingCollectionPreflightEvidenceBundle } from './collection-preflight-export';
import { copyDiagnosticEvidenceFileToBundle, copyReportFailureEvidenceFilesToBundle, evaluateDownloadCenterDiagnosticEvidenceFiles } from './download-center-diagnostic-evidence-files';
import { getLatestDownloadCenterDiagnosticRowForModel } from './download-center-diagnostic-store';
import { fillAndCommitLingxingDateRange } from './download-center-date-range';
import { readDailyReportRecommendationSummary } from './daily-report-recommendation-summary';
import { writeDownloadCenterPageModelEnablementAuditBundle } from './page-model-enablement-audit-export';
import { selectorUsesDateScope, selectorUsesReportScope, validateDownloadCenterPageModel } from './download-center-page-model-validation';
import { backupExistingDownloadCenterPageModelOverride, getDownloadCenterPageModelOverrideMetadataPath, saveDownloadCenterPageModelOverride } from './download-center-page-model-override-store';
import { getLingxingSessionNavigationPlan, isLingxingAdsLoggedInPage } from './lingxing-session-flow';
import { bindLingxingCollectionCancellation } from './lingxing-collection-control';
import { buildAdExecutionUnavailableResult, buildActionLogForExecution, getRecommendationExecutionOutcome } from './recommendation-execution-policy';
import { applyRecommendationDecision, assertRecommendationDecisionRevision, normalizeRecommendationDecisionRequest } from './recommendation-approval-policy';
import { extractLingxingListingFromSnapshot, type ListingDomFieldSnapshot, type ListingExtractionResult, type ListingPageSnapshot } from './listing-lingxing-extractor';
import { adReadbackEvidenceToMarkdown, buildAdReadbackEvidence } from './ad-readback-evidence';
import {
  assertCurrentAdReadbackEvidenceAuthority,
  buildAuthorizedAdReadbackEvidenceInput,
  type ExportAuthorizedAdReadbackEvidenceRequest,
} from './ad-readback-authority';
import { verifyAdReadbackEvidenceFile, type VerifiedAdReadbackEvidence } from './ad-readback-evidence-verifier';
import { assertCurrentWritableAdTargetAuthority, resolveWritableAdTargetAuthority } from './writable-ad-target-resolution';
import { resolveRecommendationReview } from './recommendation-review-resolution';
import { bindRecommendationWritableTarget } from './recommendation-writable-target-binding';
import {
  getRecommendationWritableTargetOwnershipBlockers,
  type RecommendationMetricSourceAuthority,
} from './recommendation-writable-target-policy';
import { assertRecommendationMetricSourceAuthority } from './recommendation-metric-source-authority';
import { fillAdReadbackSession, prepareAdReadbackSession, verifyAdReadbackSession, type FilledAdReadbackSession, type PreparedAdReadbackSession, type VerifiedAdReadbackSession } from './ad-readback-session';
import { saveReadbackCaptureFile, type ReadbackCaptureSlot, type SavedReadbackCapture } from './ad-readback-capture';
import { refreshFinalReadiness } from './final-readiness-refresh';
import { getDeliveryEvidenceStatus, getPackageEvidenceStatus } from './delivery-evidence-status';
import { annotateRecommendationsWithStrategy, bindRecommendationsToScopeAsin, buildAdStrategyDiagnosisInput, createAiOnlyRecommendationsFromDecisions } from './ad-recommendation-ai-context';
import { buildAdAiEvidencePack, summarizeAiEvidencePack } from './ad-ai-evidence-pack';
import { validateAiDiagnosisEvidence } from './ad-ai-evidence-validator';
import { buildAdProductHistoryLedger } from './ad-product-history-ledger';
import { projectBusinessOperationEventForRenderer } from './business-operation-event-projection';
import { filterBusinessPipelineOperationEvents } from './operation-event-scope';
import { assertRecommendationMetricsLoaded, filterFormalRecommendationMetrics } from './recommendation-generation-gate';
import {
  assertFormalBusinessWorkflowReady,
  type FormalBusinessWorkflow,
} from './formal-business-data-gate';
import { buildListingAiCallLogInput, buildListingRewritePrompt, parseAiDraftResponse } from './listing-ai-draft';
import { buildAdActionReasonAiCallLogInput, type AdActionExplanationForLog } from './ad-action-ai-call-log';
import { mergeAdActionExplanationEvidence } from './ad-action-explanation-merge';
import {
  readSavedLoginCredentialStatus,
  resolveSavedLoginPassword,
  saveLoginCredentials,
  type LoginCredentialCipher,
  type SavedLoginCredentialStatus,
} from './login-credentials';
import {
  decideLoginSessionCredentialPolicy,
  isPackageUiSavedSessionContinuationAllowed,
} from './login-session-credential-policy';
import {
  assertProviderActiveIdentity,
  PROVIDER_ACTIVE_IDENTITY_DOM_PROBES,
  type ProviderCredentialSubmission,
} from './provider-active-identity';
import {
  EXTERNAL_OPEN_POLICY_MARKER,
  createMainWindowNavigationHandler,
  createSecureWindowOpenHandler,
  type NavigationSecurityReport,
  type TrustedRendererTarget,
} from './window-navigation-security';
import {
  resolveAiSettingsWithPersistedKey,
  savePersistedAiApiKey,
  stripPersistedAiApiKeyFields,
  type AiKeyCipher,
} from './ai-key-persistence';
import {
  normalizeAiSettingsForSaveInput,
  normalizeAiSettingsForTestInput,
  normalizeAiSettingsRecord,
  sanitizeAiSettingsForRenderer as sanitizeAiSettingsForRendererRecord,
} from './ai-settings-normalization';
import {
  AD_STRATEGY_ANALYSIS_PROMPT_SCHEMA_VERSION,
  analysisAiRuntimeRevision,
  buildSystemAiProviderConfig,
  resolveSystemAiRuntimeConfig,
} from './system-ai-runtime-config';
import {
  BUSINESS_REAL_REPORT_EXTENSIONS,
  BUSINESS_REJECTED_EVIDENCE_EXTENSIONS,
  isExistingRawBusinessReportFile,
  isExistingRawBusinessReportPath,
  isRejectedEvidenceLikePath,
  resolveBusinessReportImportState,
  selectLatestRawBusinessReportsByType,
} from './business-report-files';
import {
  deliveryReadinessAllowsExport,
  missingReadinessView as buildMissingReadinessView,
  normalizeDeliveryReadiness,
} from './delivery-readiness-view';
import type { DeliveryReadinessView } from './delivery-readiness-view';
import {
  DurableStoreSessionGenerationAuthority,
  StoreCoordinator,
} from './store-coordinator';
import { registerStoreIpcHandlers } from './store-ipc';
import { registerMissionControlIpcHandlers } from './mission-control-ipc';
import { registerMissionDomainIpcHandlers } from './mission-domain-ipc';
import { MissionDomainService } from './mission-domain-service';
import { registerAnalysisAuthorityIpcHandlers } from './analysis-authority-ipc';
import {
  AnalysisAuthorityService,
  type AnalysisRecommendationGenerationScope,
} from './analysis-authority-service';
import { ExecutionAuthorityService } from './execution-authority-service';
import {
  EXECUTION_AUTHORITY_PROGRESS_CHANNEL,
  registerExecutionAuthorityIpcHandlers,
} from './execution-authority-ipc';
import { currentAdEntityBelongsToStore } from './legacy-writable-ad-entity-authority';
import { registerStoreScopedObjectsIpcHandlers } from './store-scoped-objects-ipc';
import { StoreScopedObjectsService } from './store-scoped-objects-service';
import { registerStoreScopedAdListingIpcHandlers } from './store-scoped-ad-listing-ipc';
import { StoreScopedAdListingService } from './store-scoped-ad-listing-service';
import { StoreOperationScopeService } from './store-operation-scope-service';
import { StoreRuntimeConfigService } from './store-runtime-config-service';
import { registerStoreRuntimeConfigIpcHandlers } from './store-runtime-config-ipc';
import {
  registerStoreEvidenceRetentionIpcHandlers,
  StoreEvidenceRetentionPreviewService,
} from './store-evidence-retention-ipc';
import { projectStoreEvidenceReferencePaths } from './store-evidence-reference-projection';
import { StoreCollectionScheduler } from './store-collection-scheduler';
import { registerStoreCollectionSchedulerIpcHandlers } from './store-collection-scheduler-ipc';
import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';
import {
  assertRuntimeAnalysisWindow,
  assertRuntimeConfigStore,
  recommendationMeetsStoreConfidence,
  requireStoreRuntimeAnalysisConfig,
  storeRuntimeRuleRevisionPayload,
  type StoreRuntimeAnalysisConfig,
} from './store-runtime-analysis-config';
import { createMissionControlLegacyAdapter } from './mission-control-legacy-adapter';
import {
  buildMissionControlTodayProjection,
  selectLatestMissionControlCollectionWindow,
} from './mission-control-today-projection';
import {
  LingxingCollectionCoordinator,
  type StartLingxingCollectionInput,
} from './lingxing-collection-coordinator';
import {
  assertRendererPayloadIsPathFree,
  MainArtifactRegistry,
  type MainArtifactDescriptor,
  type MainArtifactKind,
} from './main-artifact-registry';

// ============================================================================
// App State
// ============================================================================

interface StoreBrowserRuntime {
  context: StoreContextEnvelope;
  controllers: { lingxing: BrowserController; amazon_ads?: BrowserController };
  profileDirs: { lingxing: string; amazon_ads?: string };
  connections: { lingxing: StoreConnection; amazon_ads?: StoreConnection };
}

interface AppState {
  browserRuntime: StoreBrowserRuntime | null;
  scheduler: LocalScheduler | null;
  db: import('better-sqlite3').Database | null;
  settingsRepo: SettingsRepository | null;
  productRepo: ProductRepository | null;
  actionLogRepo: ActionLogRepository | null;
  adMetricsRepo: AdMetricsRepository | null;
  recommendationRepo: RecommendationRepository | null;
  operationEventRepo: OperationEventRepository | null;
  reportFileRepo: ReportFileRepository | null;
  aiCallLogRepo: AiCallLogRepository | null;
  aiDiagnosisRunRepo: AiDiagnosisRunRepository | null;
  storeRepo: StoreRepository | null;
  lingxingImportRepo: LingxingImportRepository | null;
  missionDomainRepo: MissionDomainRepository | null;
  missionDomainService: MissionDomainService | null;
  analysisAuthorityRepo: AnalysisAuthorityRepository | null;
  analysisAuthorityService: AnalysisAuthorityService | null;
  executionAuthorityRepo: ExecutionAuthorityRepository | null;
  executionAuthorityService: ExecutionAuthorityService | null;
  lingxingCollectionCoordinator: LingxingCollectionCoordinator | null;
  lingxingCollectionOperations: CollectionOperationGuard | null;
  storeCoordinator: StoreCoordinator | null;
  storeScopedAdListingService: StoreScopedAdListingService | null;
  storeRuntimeConfigService: StoreRuntimeConfigService | null;
  storeEvidenceRetentionService: StoreEvidenceRetentionPreviewService | null;
  storeCollectionScheduler: StoreCollectionScheduler | null;
  storeCollectionPolicySuppression: StoreCollectionPolicySuppressionController | null;
  ruleConfig: RuleConfig;
  isLoggedIn: boolean;
  currentStore: string;
  loginSession: BrowserLoginResult | null;
}

const state: AppState = {
  browserRuntime: null,
  scheduler: null,
  db: null,
  settingsRepo: null,
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
  storeScopedAdListingService: null,
  storeRuntimeConfigService: null,
  storeEvidenceRetentionService: null,
  storeCollectionScheduler: null,
  storeCollectionPolicySuppression: null,
  ruleConfig: DEFAULT_RULE_CONFIG,
  isLoggedIn: false,
  currentStore: '',
  loginSession: null,
};

const browserOperationLeases = new BrowserLeaseManager();
const cancelledLingxingCollectionRequests = new Set<string>();
const mainArtifactRegistry = new MainArtifactRegistry();

function analysisRuleRevision(value: unknown): string {
  const stable = (candidate: unknown): string => {
    if (Array.isArray(candidate)) return `[${candidate.map(stable).join(',')}]`;
    if (candidate && typeof candidate === 'object') {
      const record = candidate as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(candidate) ?? 'null';
  };
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function currentStoreRuntimeAnalysisConfig(): StoreRuntimeAnalysisConfig {
  const context = state.storeCoordinator?.getActiveStoreContext();
  if (!context || !state.storeRuntimeConfigService) {
    throw new Error('当前店铺运行配置服务尚未就绪。');
  }
  return requireStoreRuntimeAnalysisConfig(
    state.ruleConfig,
    state.storeRuntimeConfigService.get(context),
  );
}

// ============================================================================
// Paths
// ============================================================================

const evidenceUserDataIdentity = configureEvidenceUserDataPath(app);
const packageUiReadOnlyRuntime = evidenceUserDataIdentity.mode === PACKAGE_UI_EVIDENCE_MODE;
const packageUiFreshTypedProofRequired = packageUiReadOnlyRuntime
  && process.env[PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV] === '1';
const packageLaunchSmokeRuntime = evidenceUserDataIdentity.mode === PACKAGE_LAUNCH_SMOKE_MODE;
const USER_DATA_DIR = app.getPath('userData');
let mainStartupAdmission: S7MainStartupAdmission | null = null;
try {
  mainStartupAdmission = enforceS7MainStartupGate({
    app: {
      requestSingleInstanceLock: () => app.requestSingleInstanceLock(),
    },
    currentUserDataDir: USER_DATA_DIR,
    canonicalUserDataDir: resolveCanonicalAuthorityUserDataDir(),
    evidenceUserDataIdentity,
    isPackaged: app.isPackaged,
    executablePath: process.execPath,
    mainModulePath: __filename,
  });
  console.info('[Security] Main startup admission', JSON.stringify({
    mode: mainStartupAdmission.mode,
    admitted: mainStartupAdmission.admitted,
    singleInstanceLockAcquired: mainStartupAdmission.singleInstanceLockAcquired,
  }));
} catch (error) {
  console.error('[Security] Main startup blocked before initialization:', error);
  app.exit(78);
}
const packageUiSchedulerAudit = new PackageUiSchedulerAudit({
  enabled: packageUiReadOnlyRuntime,
  evidenceMode: evidenceUserDataIdentity.mode,
  database: () => state.db,
  authorizeDatabaseCheckpoint: () => authorizePackageUiDatabaseCheckpoint(),
  userDataDir: USER_DATA_DIR,
});
if (packageLaunchSmokeRuntime) {
  fs.rmSync(path.join(USER_DATA_DIR, PACKAGE_LAUNCH_WINDOW_READY_MARKER), { force: true });
}
const STORAGE_DIR = path.join(USER_DATA_DIR, 'storage');
const STORES_DIR = path.join(USER_DATA_DIR, 'stores');
const SCREENSHOTS_DIR = path.join(STORAGE_DIR, 'screenshots');
const DOM_SNAPSHOTS_DIR = path.join(STORAGE_DIR, 'dom-snapshots');
const TRACES_DIR = path.join(STORAGE_DIR, 'traces');
const REPORTS_DIR = path.join(STORAGE_DIR, 'reports');
const DOWNLOADS_DIR = path.join(STORAGE_DIR, 'downloads');
const EXPORTS_DIR = path.join(STORAGE_DIR, 'exports');
const DELIVERY_BUNDLES_DIR = path.join(EXPORTS_DIR, 'delivery-bundles');
const REPO_ROOT_DIR = process.cwd();
const CODEX_EVIDENCE_DIR = path.join(REPO_ROOT_DIR, 'output', 'codex-evidence');
const PAGE_MODELS_DIR = path.join(STORAGE_DIR, 'page-models');
const DOWNLOAD_CENTER_PAGE_MODEL_FILENAME = 'lingxing-download-center.json';
const DOWNLOAD_CENTER_PAGE_MODEL_OVERRIDE_FILENAME = 'lingxing-download-center.override.json';
const DB_PATH = path.join(USER_DATA_DIR, 'amazon-ai-ops.db');
const STORE_SESSION_GENERATION_SETTING_PREFIX = 'store_session_generation:';
const APP_VERSION = '1.5.0';
const RECOMMENDATION_METRIC_LOAD_LIMIT = 5000;
const LINGXING_REPORT_TYPE_SET = new Set<string>(LINGXING_AD_REPORTS.map((report) => report.type));
type KeywordImportDuplicateStrategy = 'overwrite' | 'merge' | 'skip';

function storeCapsuleFor(store: { storeId: string; browserProfileId: string }): StoreCapsulePaths {
  return ensureStoreCapsulePaths(deriveStoreCapsulePaths(
    STORES_DIR,
    store.storeId,
    store.browserProfileId,
  ));
}

function storeEvidenceRetentionReferencesFor(
  context: StoreContextEnvelope,
  capsule: StoreCapsulePaths,
) {
  if (!state.db) throw new Error('STORE_RETENTION_DATABASE_UNAVAILABLE');
  return {
    databaseReferences: projectStoreEvidenceReferencePaths(
      state.db,
      context.storeId,
      capsule,
    ),
    // Execution Authority and delivery artifacts live under the planner's
    // permanently protected evidence/backups scopes and are never enumerated.
    authorityReferencedPaths: [],
  };
}

type RendererArtifactReference = MainArtifactDescriptor;

function artifactAllowedRootsForStore(
  store: { storeId: string; browserProfileId: string },
  kind: MainArtifactKind,
): string[] {
  const capsule = storeCapsuleFor(store);
  const roots = [
    capsule.downloadsDir,
    capsule.reportsDir,
    capsule.screenshotsDir,
    capsule.tracesDir,
    capsule.evidenceDir,
  ];
  if (kind === 'export-file' || kind === 'export-folder') roots.push(EXPORTS_DIR);
  return roots;
}

function issueRendererArtifact(
  storeId: string,
  targetPath: unknown,
  kind: MainArtifactKind,
  displayName?: string,
): RendererArtifactReference | undefined {
  if (typeof targetPath !== 'string' || !targetPath.trim()) return undefined;
  const normalizedStoreId = normalizeStoreId(storeId);
  const store = state.storeRepo?.getStore(normalizedStoreId);
  if (!store || store.status !== 'active') return undefined;
  try {
    return mainArtifactRegistry.issue({
      storeId: normalizedStoreId,
      absolutePath: path.resolve(targetPath),
      allowedRoots: artifactAllowedRootsForStore(store, kind),
      kind,
      displayName,
    });
  } catch (error) {
    console.warn('[Security] artifact registration rejected', JSON.stringify({
      storeId: normalizedStoreId,
      kind,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }));
    return undefined;
  }
}

function rendererPayload<T>(value: T): T {
  assertRendererPayloadIsPathFree(value);
  return value;
}

function rendererSafeDetail(value: unknown, fallback = '操作未完成，请在当前店铺的数据采集诊断中查看详情。'): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const withoutDrivePaths = value.replace(/[A-Za-z]:[\\/][^\r\n，。；;,)\]}]*/g, '[本地文件]');
  const withoutUncPaths = withoutDrivePaths.replace(/\\\\[^\\/\s]+[\\/][^\r\n，。；;,)\]}]*/g, '[本地文件]');
  return withoutUncPaths.trim() || fallback;
}

function storeSessionGenerationSettingKey(storeId: string): string {
  return `${STORE_SESSION_GENERATION_SETTING_PREFIX}${storeId}`;
}

interface BusinessUiScope {
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  batchId?: string;
  currency?: 'USD';
  storeContext?: StoreContextEnvelope;
}

type NormalizedBusinessUiScope = ReturnType<typeof normalizeBusinessUiScope>;

interface BusinessBatchResult {
  batch: LingxingReportBatch;
  files: LingxingReportFile[];
  scopeMismatch?: string[];
  sourceBatchIds?: string[];
  fileDownloadDirs?: Record<string, string>;
}

type LingxingBatchFilesResult = {
  batch: LingxingReportBatch;
  files: LingxingReportFile[];
};

interface BusinessMetricSource {
  batchId?: string;
  batchIds?: string[];
  sourceFiles: string[];
}

interface BusinessBatchOptionView {
  id: string;
  status: string;
  dateStart: string;
  dateEnd: string;
  storeName?: string;
  marketplaceCode?: string;
  downloadDir?: string;
  manifestPath?: string;
  createdAt?: string;
  completedAt?: string;
  totalFileRecords: number;
  realReportFileCount: number;
  importedReportTypeCount: number;
  importedRowCount: number;
  missingReportLabels: string[];
}

interface BusinessKeywordOpportunityRow {
  asin?: string;
  portfolioName?: string;
  campaignName?: string;
  adGroupName?: string;
  entityType: string;
  keyword: string;
  coverageStatus: string;
  clicks: number;
  orders: number;
  spend: number;
  sales: number;
  acos: number;
  opportunityLevel: 'high' | 'medium' | 'low';
  recommendedPlacement: string;
  risk: string;
  sourceFile?: string;
}

function getBundledResourcesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.resolve(app.getAppPath(), '../../resources');
}

function ensureDirs(): void {
  for (const dir of [STORAGE_DIR, SCREENSHOTS_DIR, DOM_SNAPSHOTS_DIR, TRACES_DIR, REPORTS_DIR, DOWNLOADS_DIR, EXPORTS_DIR, PAGE_MODELS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function canonicalizeExistingPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

// ============================================================================
// Window
// ============================================================================

let mainWindow: BrowserWindow | null = null;
let packageLaunchWindowReadyWritten = false;
let lastPublishedStoreContext: StoreContextEnvelope | null = null;
let storeBusinessDateAuthorityTimer: ReturnType<typeof setInterval> | null = null;
const STORE_BUSINESS_DATE_AUTHORITY_POLL_MS = 30_000;

function publishStoreContextChanged(view: StoreWorkspaceView): void {
  lastPublishedStoreContext = Object.freeze({ ...view.context });
  mainWindow?.webContents.send('store-context:changed', view);
}

function refreshActiveStoreBusinessDateAuthority(): boolean {
  const view = state.storeCoordinator?.getActiveStoreWorkspaceView();
  const previous = lastPublishedStoreContext;
  if (!view || !previous) return false;
  const next = view.context;
  if (
    previous.storeId !== next.storeId
    || previous.browserProfileId !== next.browserProfileId
    || previous.sessionGeneration !== next.sessionGeneration
    || previous.businessDate === next.businessDate
  ) return false;

  // A date rollover changes authority even when the browser profile and
  // durable generation remain the same. Rebind the already-visible browser
  // runtime to the freshly minted business date; all requests captured before
  // midnight remain fail-closed in StoreCoordinator.assertActiveStoreContext.
  if (
    state.browserRuntime
    && missionControlContextKey(state.browserRuntime.context) === missionControlContextKey(previous)
  ) {
    state.browserRuntime = { ...state.browserRuntime, context: Object.freeze({ ...next }) };
  }
  publishStoreContextChanged(view);
  reconcileStoreCollectionScheduler(next, 'business-date');
  mainWindow?.webContents.send('business-ui:data-updated');
  return true;
}

function startStoreBusinessDateAuthorityMonitor(): void {
  if (storeBusinessDateAuthorityTimer) return;
  storeBusinessDateAuthorityTimer = setInterval(
    refreshActiveStoreBusinessDateAuthority,
    STORE_BUSINESS_DATE_AUTHORITY_POLL_MS,
  );
  storeBusinessDateAuthorityTimer.unref?.();
}

function stopStoreBusinessDateAuthorityMonitor(): void {
  if (!storeBusinessDateAuthorityTimer) return;
  clearInterval(storeBusinessDateAuthorityTimer);
  storeBusinessDateAuthorityTimer = null;
}

function reconcileStoreCollectionScheduler(
  context: StoreContextEnvelope,
  source: 'business-date' | 'config' | 'login',
): void {
  if (packageUiReadOnlyRuntime) {
    packageUiSchedulerAudit.recordSuppressed('automaticReconcile');
    console.info(`[CollectionScheduler] package-ui read-only reconciliation suppressed: ${source}`);
    return;
  }
  packageUiSchedulerAudit.recordControl('reconcile', context);
  void state.storeCollectionScheduler?.reconcile(context).catch((error) => {
    console.error(`[CollectionScheduler] ${source} reconciliation failed:`, error);
  });
}

function reportNavigationSecurityBoundary(report: NavigationSecurityReport): void {
  console.warn('[Security] renderer navigation boundary', JSON.stringify(report));
}

function createWindow(): void {
  const createdWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Amazon AI Ops Agent',
    show: false,
  });
  mainWindow = createdWindow;

  let rendererDidFinishLoad = false;
  let windowDidShow = false;
  const writeLaunchReadyMarkerWhenComplete = (): void => {
    if (
      !packageLaunchSmokeRuntime
      || packageLaunchWindowReadyWritten
      || !rendererDidFinishLoad
      || !windowDidShow
      || createdWindow.isDestroyed()
      || createdWindow.webContents.isDestroyed()
    ) return;
    const marker = {
      kind: 'package-launch-window-ready' as const,
      schemaVersion: 1 as const,
      pid: process.pid,
      browserWindowId: createdWindow.id,
      evidenceMode: PACKAGE_LAUNCH_SMOKE_MODE,
      userDataDir: USER_DATA_DIR,
      rendererUrl: createdWindow.webContents.getURL(),
      generatedAt: new Date().toISOString(),
    };
    if (!isPackageLaunchWindowReadyMarker(marker, {
      pid: process.pid,
      browserWindowId: createdWindow.id,
      userDataDir: USER_DATA_DIR,
    })) {
      throw new Error('PACKAGE_LAUNCH_WINDOW_READY_MARKER_INVALID');
    }
    const markerPath = path.join(USER_DATA_DIR, PACKAGE_LAUNCH_WINDOW_READY_MARKER);
    const temporaryPath = `${markerPath}.${process.pid}.${createdWindow.id}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, markerPath);
    packageLaunchWindowReadyWritten = true;
    console.info('[App] package-launch-window-ready', JSON.stringify(marker));
  };

  createdWindow.webContents.once('did-finish-load', () => {
    rendererDidFinishLoad = true;
    writeLaunchReadyMarkerWhenComplete();
  });
  createdWindow.once('ready-to-show', () => {
    createdWindow.show();
    windowDidShow = true;
    writeLaunchReadyMarkerWhenComplete();
  });

  const development = !app.isPackaged && process.env.NODE_ENV === 'development';
  const rendererFilePath = path.join(__dirname, '../renderer/index.html');
  const trustedRendererTarget: TrustedRendererTarget = development
    ? { kind: 'development', rendererUrl: 'http://localhost:5173' }
    : { kind: 'packaged', rendererFilePath };
  createdWindow.webContents.on('will-navigate', createMainWindowNavigationHandler({
    surface: 'will-navigate',
    target: trustedRendererTarget,
    report: reportNavigationSecurityBoundary,
  }));
  createdWindow.webContents.on('will-redirect', createMainWindowNavigationHandler({
    surface: 'will-redirect',
    target: trustedRendererTarget,
    report: reportNavigationSecurityBoundary,
  }));
  createdWindow.webContents.setWindowOpenHandler(createSecureWindowOpenHandler({
    externalOpenPolicy: EXTERNAL_OPEN_POLICY_MARKER,
    report: reportNavigationSecurityBoundary,
  }));

  if (development) {
    void createdWindow.loadURL('http://localhost:5173');
    createdWindow.webContents.openDevTools();
  } else {
    void createdWindow.loadFile(rendererFilePath);
  }

  createdWindow.on('closed', () => {
    if (mainWindow === createdWindow) mainWindow = null;
  });
}

// ============================================================================
// Initialization
// ============================================================================

async function initApp(): Promise<void> {
  console.log('[App] init:start');

  // Init database
  if (mainStartupAdmission?.mode === 'S7_APPROVED_CHILD') {
    state.db = initGuardedExistingSqlite(DB_PATH, ({ database, resolvedPath }) => (
      completeS7MainStartupAdmission({
        startup: mainStartupAdmission as Extract<
          S7MainStartupAdmission,
          { mode: 'S7_APPROVED_CHILD' }
        >,
        database,
        resolvedDatabasePath: resolvedPath,
        executablePath: process.execPath,
        mainModulePath: __filename,
      })
    )).database;
  } else {
    state.db = initSqlite(DB_PATH);
  }
  console.log('[App] init:sqlite-ready');
  ensureDirs();
  console.log('[App] init:dirs-ready');

  // Init repositories
  state.settingsRepo = new SettingsRepository(state.db);
  try {
    const credentialStatus = handleGetSavedLoginCredentialStatus();
    console.log('[Security] login credential state', JSON.stringify({
      credentialState: credentialStatus.credentialState,
      passwordAvailable: credentialStatus.passwordAvailable,
      rememberPassword: credentialStatus.rememberPassword,
    }));
  } catch {
    console.warn('[Security] login credential state unavailable', JSON.stringify({
      credentialState: 'migration_failed',
    }));
  }
  state.productRepo = new ProductRepository(state.db);
  state.actionLogRepo = new ActionLogRepository(state.db);
  state.adMetricsRepo = new AdMetricsRepository(state.db);
  state.recommendationRepo = new RecommendationRepository(state.db);
  state.operationEventRepo = new OperationEventRepository(state.db);
  state.reportFileRepo = new ReportFileRepository(state.db);
  state.aiCallLogRepo = new AiCallLogRepository(state.db);
  state.aiDiagnosisRunRepo = new AiDiagnosisRunRepository(state.db);
  state.storeRepo = new StoreRepository(state.db);
  state.lingxingImportRepo = new LingxingImportRepository(state.db);
  const storeSessions = new DurableStoreSessionGenerationAuthority({
    transaction: (work) => state.settingsRepo!.transaction(work),
    read: (storeId) => {
      const raw = state.settingsRepo!.get(storeSessionGenerationSettingKey(storeId));
      return raw === null ? undefined : Number(raw);
    },
    write: (storeId, sessionGeneration) => {
      state.settingsRepo!.set(
        storeSessionGenerationSettingKey(storeId),
        String(sessionGeneration),
      );
    },
  });
  for (const store of state.storeRepo.listStores({ includeArchived: true })) {
    const durableGeneration = state.storeRepo.listSessionMetadata(store.storeId)
      .reduce((maximum, session) => Math.max(maximum, session.sessionGeneration), 0);
    storeSessions.seed(store.storeId, durableGeneration);
  }
  const storeCoordinator = new StoreCoordinator({
    repository: state.storeRepo,
    sessions: storeSessions,
  });
  const analysisAuthorityRepo = new AnalysisAuthorityRepository(state.db);
  const missionDomainRepo = new MissionDomainRepository(state.db, {
    references: {
      productBelongsToStore: (context, productId) => Boolean(
        state.productRepo?.findByAsinForStore(context.storeId, productId),
      ),
      adEntityBelongsToStore: (context, adEntityId) => Boolean(
        currentAdEntityBelongsToStore(analysisAuthorityRepo, state.db!, context, adEntityId),
      ),
    },
  });
  const missionDomainService = new MissionDomainService({
    repository: missionDomainRepo,
    storeCoordinator,
  });
  const storeRuntimeConfigService = new StoreRuntimeConfigService({
    storeCoordinator,
    settings: state.settingsRepo!,
  });
  const storeEvidenceRetentionService = new StoreEvidenceRetentionPreviewService({
    authority: storeCoordinator,
    runtimeConfig: storeRuntimeConfigService,
    deriveCapsuleFor: (context) => deriveStoreCapsulePaths(
      STORES_DIR,
      context.storeId,
      context.browserProfileId,
    ),
    referencesFor: storeEvidenceRetentionReferencesFor,
    artifactResolver: mainArtifactRegistry,
  });
  const analysisAuthorityService = new AnalysisAuthorityService({
    db: state.db,
    repository: analysisAuthorityRepo,
    missionRepository: missionDomainRepo,
    recommendationRepository: state.recommendationRepo,
    storeCoordinator,
    generateRecommendations: (scope) => runRecommendationGeneration(scope),
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
      const store = state.storeRepo?.getStore(context.storeId);
      return store?.status === 'active'
        ? artifactAllowedRootsForStore(store, 'diagnostic-file')
        : [];
    },
    onAutomaticGrantIssued: (context, grant) => {
      const service = state.executionAuthorityService;
      if (!service) {
        console.error('[Execution] policy grant issued before execution authority initialization');
        return;
      }
      void service.enqueuePolicyGrant(context, grant).catch(() => {
        console.error('[Execution] automatic grant enqueue rejected before safe queue entry');
      });
    },
  });
  const executionAuthorityRepo = new ExecutionAuthorityRepository(state.db);
  const storeCollectionPolicySuppression = new StoreCollectionPolicySuppressionController();
  const executionAuthorityService = new ExecutionAuthorityService({
    repository: executionAuthorityRepo,
    missionRepository: missionDomainRepo,
    analysisRepository: analysisAuthorityRepo,
    storeCoordinator,
    leases: browserOperationLeases,
    policyDispatchSuppression: storeCollectionPolicySuppression,
    resolveBrowserRuntime: (context) => {
      const runtime = state.browserRuntime;
      if (!runtime || !state.isLoggedIn
        || missionControlContextKey(runtime.context) !== missionControlContextKey(context)) {
        throw new Error('请先为当前店铺启动并登录独立的领星 ERP 与 Amazon Ads 可见浏览器。');
      }
      const store = state.storeRepo?.getStore(context.storeId);
      const controller = runtime.controllers.amazon_ads;
      const connection = runtime.connections.amazon_ads;
      const page = controller?.getPage();
      const externalAccountId = connection?.externalAccountId?.trim();
      const adsSession = state.storeRepo?.getSessionMetadata(context.storeId, 'amazon_ads');
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
        context: runtime.context,
        externalAccountId,
        page,
        capsule: storeCapsuleFor(store),
        navigate: (url: string) => controller.navigate(url),
        bringToFront: () => controller.bringToFront(),
      };
    },
    emitProgress: (event) => {
      mainWindow?.webContents.send(
        EXECUTION_AUTHORITY_PROGRESS_CHANNEL,
        rendererPayload(event),
      );
      mainWindow?.webContents.send('business-ui:data-updated');
    },
  });
  // Publish the authority graph atomically only after every constructor has
  // succeeded. IPC registration later in startup therefore never observes a
  // half-initialized Mission/Analysis/Execution authority.
  state.storeCoordinator = storeCoordinator;
  state.analysisAuthorityRepo = analysisAuthorityRepo;
  state.missionDomainRepo = missionDomainRepo;
  state.missionDomainService = missionDomainService;
  state.analysisAuthorityService = analysisAuthorityService;
  state.executionAuthorityRepo = executionAuthorityRepo;
  state.executionAuthorityService = executionAuthorityService;
  state.storeCollectionPolicySuppression = storeCollectionPolicySuppression;
  state.storeRuntimeConfigService = storeRuntimeConfigService;
  state.storeEvidenceRetentionService = storeEvidenceRetentionService;
  const executionRecovery = executionAuthorityService.recoverStartup();
  console.log('[App] init:execution-recovery', JSON.stringify(executionRecovery));
  const collectionRecovery = recoverInterruptedLingxingCollectionJobsOnStartup();
  console.log('[App] init:lingxing-collection-recovery', JSON.stringify(collectionRecovery));
  initializeLingxingCollectionCoordinator();
  initializeStoreCollectionScheduler();
  for (const store of state.storeRepo.listStores({ includeArchived: true })) {
    storeCapsuleFor(store);
  }
  const importRecovery = recoverPendingLingxingCollectionImportsOnStartup();
  console.log('[App] init:lingxing-import-recovery', JSON.stringify(importRecovery));
  readAiSettingsForMain();
  console.log('[App] init:repositories-ready');

  // Init audit/trace/screenshot managers
  const auditLogger = new AuditLogger(state.db);
  const screenshotMgr = new ScreenshotManager(SCREENSHOTS_DIR);
  const traceMgr = new TraceManager(TRACES_DIR);

  // Load saved config
  const savedConfig = state.settingsRepo.getRuleConfig();
  if (savedConfig) {
    state.ruleConfig = savedConfig as unknown as RuleConfig;
  }

  // Init scheduler
  state.scheduler = new LocalScheduler({
    timezone: 'Asia/Shanghai',
    onTaskStart: (taskName: TaskName) => {
      mainWindow?.webContents.send('scheduler:task-start', taskName);
    },
    onTaskComplete: (taskName: TaskName, duration: number) => {
      mainWindow?.webContents.send('scheduler:task-complete', { taskName, duration });
    },
    onTaskError: (taskName: TaskName, error: Error) => {
      mainWindow?.webContents.send('scheduler:task-error', { taskName, error: error.message });
    },
  });

  // Register scheduled tasks
  state.scheduler.register({
    name: 'daily_recommendation_generate',
    cron: '0 9 * * *',
    enabled: false,
    callback: async () => {
      await runRecommendationGeneration(handleGetOperationScope());
    },
  });

  state.scheduler.register({
    name: 'daily_report_generate',
    cron: '0 21 * * *',
    enabled: false,
    callback: () => runDailyReportGeneration(),
  });

  state.scheduler.register({
    name: 'data_cleanup',
    cron: '0 3 * * *',
    enabled: false,
    callback: async () => {
      if (!state.storeEvidenceRetentionService) {
        throw new Error('STORE_RETENTION_SERVICE_UNAVAILABLE');
      }
      const manifest = state.storeEvidenceRetentionService.previewActiveStore();
      if (!manifest) {
        console.info('[Retention] data_cleanup dry-run skipped: no active store');
        return;
      }
      mainWindow?.webContents.send('cleanup:report', rendererPayload(manifest));
    },
  });

  // Package UI evidence must exercise the production read APIs without
  // starting timers or executing the StoreContext scheduler. Normal packaged
  // runtime stays unchanged because the guard is bound to the explicit,
  // isolated package-ui evidence mode.
  if (packageUiReadOnlyRuntime) {
    packageUiSchedulerAudit.recordSuppressed('localSchedulerStart');
    packageUiSchedulerAudit.recordSuppressed('storeSchedulerStart');
    packageUiSchedulerAudit.recordSuppressed('startupReconcile');
    packageUiSchedulerAudit.checkpoint();
  } else {
    packageUiSchedulerAudit.recordControl('localSchedulerStart');
    state.scheduler.start();
    packageUiSchedulerAudit.recordControl('storeSchedulerStart');
    state.storeCollectionScheduler?.start();
  }

  console.log('[App] Initialized successfully');
}

// ============================================================================
// Browser / Session
// ============================================================================

type AdsSessionResult = {
  entryMode: 'erp_ads_entry';
  adsUrl: string;
  adsTitle: string;
};

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

function readAiSettingsForMain(): Record<string, string> {
  const repo = state.settingsRepo;
  if (!repo) return normalizeAiSettingsRecord({});
  return normalizeAiSettingsRecord(
    resolveAiSettingsWithPersistedKey(repo.getAll(), repo, electronLoginCredentialCipher),
  );
}

function persistAiSettingsForMain(
  settings: Record<string, string>,
  options: { clearApiKey?: boolean } = {},
): void {
  const repo = state.settingsRepo;
  if (!repo) return;
  const apiKey = String(settings.ai_api_key || settings.aiApiKey || '').trim();
  if (options.clearApiKey) {
    savePersistedAiApiKey(repo, '', electronLoginCredentialCipher);
  } else if (apiKey) {
    savePersistedAiApiKey(repo, apiKey, electronLoginCredentialCipher);
  }
  repo.save(stripPersistedAiApiKeyFields(settings));
}

function inputRequestsAiKeyClear(input: Record<string, unknown>): boolean {
  const value = input.clearAiKey ?? input.clear_ai_key;
  if (typeof value === 'boolean') return value;
  return typeof value === 'string' && ['true', '1', 'yes'].includes(value.trim().toLowerCase());
}

function emptySavedLoginCredentialStatus(): SavedLoginCredentialStatus {
  return {
    username: '',
    rememberPassword: false,
    passwordAvailable: false,
    credentialState: 'none',
  };
}

type SavedLoginCredentialRuntimeStatus = SavedLoginCredentialStatus & {
  packageUiEvidenceMode: boolean;
  freshTypedProofRequired: boolean;
};

function handleGetSavedLoginCredentialStatus(): SavedLoginCredentialRuntimeStatus {
  const credentialStatus = state.settingsRepo
    ? readSavedLoginCredentialStatus(state.settingsRepo, electronLoginCredentialCipher)
    : emptySavedLoginCredentialStatus();
  return {
    ...credentialStatus,
    packageUiEvidenceMode: packageUiReadOnlyRuntime,
    freshTypedProofRequired: packageUiFreshTypedProofRequired,
  };
}

async function readLingxingPageState(page: NonNullable<ReturnType<BrowserController['getPage']>>) {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText ?? '',
    hasAccountInput: Boolean(document.querySelector('input[name="account"]')),
  }));
}

const AMAZON_ADS_AUTHORIZATION_TIMEOUT_MS = 120_000;
const PACKAGE_UI_AMAZON_ADS_AUTHORIZATION_TIMEOUT_MS = 900_000;
const AMAZON_ADS_AUTHORIZATION_POLL_MS = 1_000;

function isRetryableAdsAuthorizationNavigationError(error: unknown): boolean {
  return /execution context was destroyed|most likely because of a navigation|cannot find context/i
    .test(String(error instanceof Error ? error.message : error));
}

async function waitForLingxingAdsSessionReady(
  controller: BrowserController,
  assertAttemptActive: () => void,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof readLingxingPageState>> | null> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    assertAttemptActive();
    try {
      const pageState = await readLingxingPageState(getControllerPageOrThrow(controller));
      if (isLingxingAdsLoggedInPage(pageState)) return pageState;
    } catch (error) {
      if (!isRetryableAdsAuthorizationNavigationError(error)) throw error;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return null;
    await controller.waitForTimeout(Math.min(AMAZON_ADS_AUTHORIZATION_POLL_MS, remainingMs));
  }
}

async function assertProviderPageActiveIdentity(input: {
  connection: StoreConnection;
  page: NonNullable<ReturnType<BrowserController['getPage']>>;
  pageUrl: string;
  credentialSubmission?: ProviderCredentialSubmission;
}): Promise<void> {
  const probes = PROVIDER_ACTIVE_IDENTITY_DOM_PROBES.map((probe) => ({
    id: probe.id,
    selector: probe.selector,
    attribute: probe.attribute,
  }));
  const domObservations = await input.page.evaluate((activeIdentityProbes) => (
    activeIdentityProbes.flatMap((probe) => (
      [...document.querySelectorAll(probe.selector)]
        .filter((element) => {
          if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
          const style = window.getComputedStyle(element);
          return element.getClientRects().length > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity) > 0;
        })
        .slice(0, 2)
        .flatMap((element) => {
          const value = element.getAttribute(probe.attribute);
          return value === null ? [] : [{ probeId: probe.id, value }];
        })
    ))
  ), probes);
  assertProviderActiveIdentity({
    connection: input.connection,
    pageUrl: input.pageUrl,
    domObservations,
    credentialSubmission: input.credentialSubmission,
  });
}

function adsSessionResultFromPageState(pageState: { url: string; title?: string }): AdsSessionResult {
  return {
    entryMode: 'erp_ads_entry',
    adsUrl: pageState.url,
    adsTitle: pageState.title || pageState.url,
  };
}

function clearBrowserLoginState(): void {
  state.isLoggedIn = false;
  try {
    const activeContext = state.storeCoordinator?.getActiveStoreContext();
    state.currentStore = activeContext && state.storeRepo
      ? state.storeRepo.getStore(activeContext.storeId)?.displayName ?? ''
      : '';
  } catch {
    state.currentStore = '';
  }
  state.loginSession = null;
}

let browserLoginAttempt = 0;
let pendingBrowserLogin: {
  attemptId: number;
  context: StoreContextEnvelope;
  controllers: Set<BrowserController>;
} | null = null;

function browserRuntimeController(provider: StoreConnectionProvider): BrowserController | null {
  const runtime = state.browserRuntime;
  if (!runtime || !state.storeCoordinator) return null;
  try {
    state.storeCoordinator.assertActiveStoreContext(runtime.context);
    return runtime.controllers[provider] ?? null;
  } catch {
    return null;
  }
}

function isProviderBrowserSessionReady(
  context: StoreContextEnvelope,
  provider: StoreConnectionProvider,
): boolean {
  const runtime = state.browserRuntime;
  const session = state.storeRepo?.getSessionMetadata(context.storeId, provider);
  return Boolean(
    state.isLoggedIn
    && runtime
    && missionControlContextKey(runtime.context) === missionControlContextKey(context)
    && runtime.controllers[provider]?.getPage()
    && session
    && session.status === 'ready'
    && session.browserProfileId === context.browserProfileId
    && session.sessionGeneration === context.sessionGeneration,
  );
}

function authorizePackageUiDatabaseCheckpoint(): StoreContextEnvelope {
  if (!packageUiReadOnlyRuntime) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_DISABLED');
  }
  if (!state.db) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_UNAVAILABLE');
  }
  const coordinator = state.storeCoordinator;
  const activeContext = coordinator?.getActiveStoreContext();
  if (!coordinator || !activeContext) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_CONTEXT_UNAVAILABLE');
  }
  const authorized = coordinator.assertActiveStoreContext(activeContext);
  if (authorized.marketplace !== 'US' || authorized.currency !== 'USD') {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_USD_CONTEXT_REQUIRED');
  }
  const runtime = state.browserRuntime;
  if (
    !runtime
    || missionControlContextKey(runtime.context) !== missionControlContextKey(authorized)
  ) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_BROWSER_CONTEXT_MISMATCH');
  }
  if (
    !state.loginSession?.ok
    || !state.loginSession.erpSessionReady
    || !state.loginSession.adsSessionReady
    || !isProviderBrowserSessionReady(authorized, 'lingxing')
    || !isProviderBrowserSessionReady(authorized, 'amazon_ads')
  ) {
    throw new Error('PACKAGE_UI_DATABASE_CHECKPOINT_SESSION_NOT_READY');
  }
  return authorized;
}

function detachBrowserRuntimeForStore(storeId?: string): StoreBrowserRuntime | null {
  const runtime = state.browserRuntime;
  if (!runtime || (storeId && runtime.context.storeId !== storeId)) return null;
  state.browserRuntime = null;
  return runtime;
}

async function closeBrowserControllers(controllers: Iterable<BrowserController>): Promise<void> {
  const unique = [...new Set(controllers)];
  const settled = await Promise.allSettled(unique.map((controller) => controller.close()));
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.error('[StoreSession] failed to close store-bound browser controller', result.reason);
    }
  }
}

async function closeBrowserRuntime(runtime: StoreBrowserRuntime | null): Promise<void> {
  if (!runtime) return;
  await closeBrowserControllers(Object.values(runtime.controllers));
}

function invalidatePendingBrowserLogin(storeId?: string): BrowserController[] {
  if (storeId && pendingBrowserLogin?.context.storeId !== storeId) return [];
  browserLoginAttempt += 1;
  const controllers = pendingBrowserLogin ? [...pendingBrowserLogin.controllers] : [];
  pendingBrowserLogin = null;
  return controllers;
}

function assertBrowserLoginAttempt(attemptId: number, context: StoreContextEnvelope): void {
  if (browserLoginAttempt !== attemptId || pendingBrowserLogin?.attemptId !== attemptId) {
    throw new Error('登录目标店铺已变化，本次浏览器登录已取消。');
  }
  if (!state.storeCoordinator) {
    throw new Error('店铺会话协调器尚未就绪。');
  }
  state.storeCoordinator.assertActiveStoreContext(context);
}

async function handleBrowserLogin(request: BrowserLoginRequest): Promise<BrowserLoginResult> {
  if (packageUiFreshTypedProofRequired
    && (request.credentialSource !== 'typed'
      || request.rememberPassword !== true
      || typeof request.password !== 'string'
      || request.password.length === 0)) {
    throw new Error('正式 Package UI 首轮登录必须手动输入凭证并勾选记住密码。');
  }
  const username = request.username;
  const rememberPassword = request.rememberPassword;
  if (!state.storeCoordinator || !state.storeRepo) {
    throw new Error('店铺会话尚未初始化。');
  }
  const initialContext = state.storeCoordinator.assertActiveStoreContext(request.storeContext);
  state.executionAuthorityService?.assertStoreMutationAllowed(initialContext);

  const password = request.credentialSource === 'saved'
    ? (() => {
        if (!state.settingsRepo) {
          throw new Error('本机凭证存储尚未就绪，请重新输入密码。');
        }
        return resolveSavedLoginPassword(state.settingsRepo, electronLoginCredentialCipher, username);
      })()
    : request.password;

  const attemptId = browserLoginAttempt + 1;
  browserLoginAttempt = attemptId;
  const previousPendingControllers = pendingBrowserLogin
    ? [...pendingBrowserLogin.controllers]
    : [];
  pendingBrowserLogin = { attemptId, context: initialContext, controllers: new Set() };
  const previousRuntime = detachBrowserRuntimeForStore();
  clearBrowserLoginState();

  await Promise.all([
    closeBrowserRuntime(previousRuntime),
    closeBrowserControllers(previousPendingControllers),
  ]);
  if (browserLoginAttempt !== attemptId || pendingBrowserLogin?.attemptId !== attemptId) {
    throw new Error('登录目标店铺已变化，本次浏览器登录已取消。');
  }

  let loginSetup: {
    loginContext: StoreContextEnvelope;
    store: StoreRecord;
    capsule: StoreCapsulePaths;
    connections: {
      lingxing: StoreConnection;
      amazon_ads: StoreConnection;
    };
  };
  try {
    const view = state.storeCoordinator.reconnectStore(initialContext.storeId);
    const loginContext = view.context;
    if (pendingBrowserLogin?.attemptId === attemptId) {
      pendingBrowserLogin.context = loginContext;
    }
    publishStoreContextChanged(view);
    const store = state.storeRepo.getStore(loginContext.storeId);
    if (!store) throw new Error('当前店铺授权记录不存在。');
    const connections = requireBrowserLoginProviderConnections(
      state.storeRepo.listConnections(loginContext.storeId),
      request.amazonAdsProfileId,
    );
    loginSetup = {
      loginContext,
      store,
      capsule: storeCapsuleFor(store),
      connections,
    };
  } catch (error) {
    if (pendingBrowserLogin?.attemptId === attemptId) pendingBrowserLogin = null;
    if (browserLoginAttempt === attemptId) clearBrowserLoginState();
    throw error;
  }
  const { loginContext, store, capsule, connections } = loginSetup;
  const navigationPlan = getLingxingSessionNavigationPlan();
  const lingxingController = new BrowserController({
    headless: false,
    userDataDir: capsule.lingxingProfileDir,
  });
  const amazonAdsController = new BrowserController({
    headless: false,
    userDataDir: capsule.amazonAdsProfileDir,
  });
  pendingBrowserLogin.controllers.add(lingxingController);
  pendingBrowserLogin.controllers.add(amazonAdsController);

  try {
    await lingxingController.launch();
    await lingxingController.navigate(navigationPlan.initialUrl);
    await lingxingController.waitForTimeout(3000);

    const page = getControllerPageOrThrow(lingxingController);
    const accountInput = page.locator('input[name="account"], input[placeholder*="用户名"], input[placeholder*="手机号"]').first();
    const passwordInput = page.locator('input[name="pwd"], input[type="password"]').first();
    const needsLogin = await accountInput.isVisible({ timeout: 5000 }).catch(() => false);
    const erpSessionReused = !needsLogin;

    if (needsLogin) {
      await accountInput.fill(username);
      await passwordInput.fill(password);
      await Promise.all([
        page.waitForURL(/\/erp\/home|\/erp\/index|dashboard|home|index/, { timeout: 30000 }).catch(() => undefined),
        page.locator('button.loginBtn, button:has-text("登录")').first().click(),
      ]);
      await lingxingController.waitForTimeout(3000);
    }

    const erpLoginState = await readLingxingPageState(page);
    if (erpLoginState.hasAccountInput && erpLoginState.bodyText.includes('账号登录')) {
      throw new Error('领星 ERP 登录未完成：仍停留在账号登录页，请检查账号、密码或验证码要求');
    }

    const credentialPolicy = decideLoginSessionCredentialPolicy({
      credentialSource: request.credentialSource,
      erpSessionReused,
      rememberPassword,
    });
    const packageUiSavedSessionContinuationAllowed =
      isPackageUiSavedSessionContinuationAllowed({
        credentialSource: request.credentialSource,
        erpSessionReused,
        packageUiReadOnlyRuntime,
        policy: credentialPolicy,
      });
    if (
      !credentialPolicy.sessionIdentityVerified
      && !packageUiSavedSessionContinuationAllowed
    ) {
      throw new Error('当前领星会话身份未经本次凭证验证；请在自动化浏览器中退出旧会话后重试。');
    }
    await assertProviderPageActiveIdentity({
      connection: connections.lingxing,
      page,
      pageUrl: erpLoginState.url,
      credentialSubmission: request.credentialSource === 'typed' && needsLogin
        ? {
            credentialSource: 'typed',
            credentialsSubmitted: true,
            username,
          }
        : undefined,
    });
    assertBrowserLoginAttempt(attemptId, loginContext);

    const { credentialAction } = credentialPolicy;
    if (
      request.credentialSource === 'typed'
      && (credentialAction === 'save' || credentialAction === 'clear')
    ) {
      if (!state.settingsRepo) {
        throw new Error('本机凭证存储尚未就绪，本次登录未完成。');
      }
      try {
        saveLoginCredentials(
          state.settingsRepo,
          { username, password, rememberPassword },
          electronLoginCredentialCipher,
        );
      } catch {
        throw new Error(rememberPassword
          ? '登录已确认，但密码未能安全保存；本次会话已关闭，请取消“记住密码”后重试。'
          : '登录已确认，但旧凭证未能安全清除；本次会话已关闭，请重试。');
      }
    }
    assertBrowserLoginAttempt(attemptId, loginContext);

    const lingxingObservedAt = new Date().toISOString();
    state.db!.transaction(() => {
      state.storeRepo!.updateConnection({
        id: connections.lingxing.id,
        storeId: loginContext.storeId,
        status: 'ready',
        lastVerifiedAt: lingxingObservedAt,
        lastFailureCode: '',
      });
      state.storeRepo!.saveSessionMetadata({
        storeId: loginContext.storeId,
        browserProfileId: loginContext.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: loginContext.sessionGeneration,
        observedAt: lingxingObservedAt,
        accountLabel: connections.lingxing.accountLabel,
        externalAccountId: connections.lingxing.externalAccountId,
        verifiedAt: lingxingObservedAt,
      });
    })();
    assertBrowserLoginAttempt(attemptId, loginContext);

    // Publish the verified Lingxing runtime before probing the independent Ads
    // profile. Report collection must remain available even when Ads needs a
    // separate human authorization; Ads writes are gated below by ready session
    // metadata on every execution-runtime resolution.
    state.browserRuntime = {
      context: loginContext,
      controllers: {
        lingxing: lingxingController,
        amazon_ads: amazonAdsController,
      },
      profileDirs: {
        lingxing: capsule.lingxingProfileDir,
        amazon_ads: capsule.amazonAdsProfileDir,
      },
      connections: {
        lingxing: connections.lingxing,
        amazon_ads: connections.amazon_ads,
      },
    };
    state.isLoggedIn = true;
    state.currentStore = store.displayName;

    let adsSession: AdsSessionResult | null = null;
    let adsUnavailableReason: string | undefined;
    const adsConnection = connections.amazon_ads;
    try {
      await amazonAdsController.launch();
      await amazonAdsController.navigate('https://ads.lingxing.com/');
      const amazonAdsState = await waitForLingxingAdsSessionReady(
        amazonAdsController,
        () => assertBrowserLoginAttempt(attemptId, loginContext),
        packageUiReadOnlyRuntime
          ? PACKAGE_UI_AMAZON_ADS_AUTHORIZATION_TIMEOUT_MS
          : AMAZON_ADS_AUTHORIZATION_TIMEOUT_MS,
      );
      if (!amazonAdsState) {
        throw new Error('ADS_SESSION_NOT_READY');
      }
      const adsPage = getControllerPageOrThrow(amazonAdsController);
      await assertProviderPageActiveIdentity({
        connection: adsConnection,
        page: adsPage,
        pageUrl: amazonAdsState.url,
      });
      assertBrowserLoginAttempt(attemptId, loginContext);
      adsSession = adsSessionResultFromPageState(amazonAdsState);
      const adsObservedAt = new Date().toISOString();
      state.db!.transaction(() => {
        state.storeRepo!.updateConnection({
          id: adsConnection.id,
          storeId: loginContext.storeId,
          status: 'ready',
          lastVerifiedAt: adsObservedAt,
          lastFailureCode: '',
        });
        state.storeRepo!.saveSessionMetadata({
          storeId: loginContext.storeId,
          browserProfileId: loginContext.browserProfileId,
          provider: 'amazon_ads',
          status: 'ready',
          sessionGeneration: loginContext.sessionGeneration,
          observedAt: adsObservedAt,
          accountLabel: adsConnection.accountLabel,
          externalAccountId: adsConnection.externalAccountId,
          verifiedAt: adsObservedAt,
        });
      })();
    } catch {
      // A store switch/cancel must still tear down the whole stale runtime.
      assertBrowserLoginAttempt(attemptId, loginContext);
      adsSession = null;
      adsUnavailableReason = '独立 Amazon Ads Profile 待授权，广告执行保持阻断。';
      const adsObservedAt = new Date().toISOString();
      state.db!.transaction(() => {
        state.storeRepo!.updateConnection({
          id: adsConnection.id,
          storeId: loginContext.storeId,
          status: 'attention_required',
          lastFailureCode: 'ADS_SESSION_NOT_READY',
        });
        state.storeRepo!.saveSessionMetadata({
          storeId: loginContext.storeId,
          browserProfileId: loginContext.browserProfileId,
          provider: 'amazon_ads',
          status: 'blocked',
          sessionGeneration: loginContext.sessionGeneration,
          observedAt: adsObservedAt,
          failureCode: 'ADS_SESSION_NOT_READY',
        });
      })();
      if (packageUiReadOnlyRuntime) {
        throw new Error('独立 Amazon Ads Profile 未在正式 Package UI 时限内完成授权，登录已拒绝。');
      }
    }
    assertBrowserLoginAttempt(attemptId, loginContext);

    const loginResult: BrowserLoginResult = {
      ok: true,
      credentialSource: request.credentialSource,
      currentStore: state.currentStore,
      erpSessionReady: true,
      erpSessionReused,
      sessionIdentityVerified: credentialPolicy.sessionIdentityVerified,
      adsSessionReady: Boolean(adsSession),
      ...(adsSession ? {
        adsEntryMode: adsSession.entryMode,
        adsUrl: adsSession.adsUrl,
        adsTitle: adsSession.adsTitle,
      } : { adsUnavailableReason }),
      credentialPersistence: credentialPolicy.credentialPersistence,
    };
    state.loginSession = loginResult;
    if (pendingBrowserLogin?.attemptId === attemptId) {
      pendingBrowserLogin = null;
    }
    if (adsSession) {
      void state.executionAuthorityService?.resumePolicyGrantDispatches(
        loginContext,
        'session_ready',
      ).catch(() => {
        console.error('[Execution] persisted policy-grant recovery failed after Ads session readiness');
      });
    }
    reconcileStoreCollectionScheduler(loginContext, 'login');
    if (packageUiReadOnlyRuntime) {
      packageUiSchedulerAudit.capturePostBootstrapDatabaseBaseline();
    }
    return loginResult;
  } catch (error) {
    await closeBrowserControllers([
      lingxingController,
      amazonAdsController,
    ]);
    if (state.browserRuntime?.controllers.lingxing === lingxingController) {
      state.browserRuntime = null;
    }
    if (pendingBrowserLogin?.attemptId === attemptId) pendingBrowserLogin = null;
    if (state.storeCoordinator && state.storeRepo) {
      const observedAt = new Date().toISOString();
      try {
        state.storeCoordinator.assertStoreContext(loginContext);
        for (const provider of ['lingxing', 'amazon_ads'] as const) {
          state.storeRepo.saveSessionMetadata({
            storeId: loginContext.storeId,
            browserProfileId: loginContext.browserProfileId,
            provider,
            status: 'blocked',
            sessionGeneration: loginContext.sessionGeneration,
            observedAt,
            failureCode: 'LOGIN_FAILED',
          });
        }
      } catch (metadataError) {
        console.error('[StoreSession] failed to persist blocked login state', metadataError);
      }
    }
    if (browserLoginAttempt === attemptId) clearBrowserLoginState();
    throw error;
  }
}

async function handleBrowserLogout(): Promise<void> {
  const activeContext = state.storeCoordinator?.getActiveStoreContext() ?? null;
  if (activeContext) state.executionAuthorityService?.assertStoreMutationAllowed(activeContext);
  const pendingControllers = invalidatePendingBrowserLogin();
  const runtime = detachBrowserRuntimeForStore();
  try {
    await Promise.all([
      closeBrowserRuntime(runtime),
      closeBrowserControllers(pendingControllers),
    ]);
  } finally {
    if (activeContext && state.storeCoordinator && state.storeRepo) {
      try {
        const invalidated = state.storeCoordinator.invalidateStoreSession(activeContext.storeId);
        const observedAt = new Date().toISOString();
        for (const provider of ['lingxing', 'amazon_ads'] as const) {
          state.storeRepo.saveSessionMetadata({
            storeId: invalidated.storeId,
            browserProfileId: invalidated.browserProfileId,
            provider,
            status: 'signed_out',
            sessionGeneration: invalidated.sessionGeneration,
            observedAt,
          });
        }
      } catch (metadataError) {
        console.error('[StoreSession] failed to persist signed-out state', metadataError);
      }
    }
    clearBrowserLoginState();
  }
}

async function handleScreenshot(label: 'before' | 'after' | 'error'): Promise<string> {
  const runtime = state.browserRuntime;
  const controller = browserRuntimeController('lingxing');
  if (!runtime || !controller || !state.storeRepo || !state.storeCoordinator) {
    throw new Error('Browser not initialized');
  }
  const context = state.storeCoordinator.assertActiveStoreContext(runtime.context);
  const store = state.storeRepo.getStore(context.storeId);
  if (!store) throw new Error('Active store not found');
  const screenshotPath = path.join(
    storeCapsuleFor(store).screenshotsDir,
    `${label}_${Date.now()}.png`,
  );
  const screenshot = await controller.screenshotToPath(screenshotPath, label);
  return screenshot.path;
}

function normalizeScreenshotLabel(value: unknown): 'before' | 'after' | 'error' {
  if (value !== 'before' && value !== 'after' && value !== 'error') {
    throw new TypeError('unsupported screenshot label');
  }
  return value;
}

async function tryCaptureExecutionScreenshot(label: 'before' | 'after'): Promise<string | undefined> {
  try {
    const runtime = state.browserRuntime;
    const controller = browserRuntimeController('amazon_ads');
    if (!runtime || !controller || !state.storeRepo || !state.storeCoordinator) {
      throw new Error('Amazon Ads browser not initialized');
    }
    const context = state.storeCoordinator.assertActiveStoreContext(runtime.context);
    const store = state.storeRepo.getStore(context.storeId);
    if (!store) throw new Error('Active store not found');
    const screenshotPath = path.join(
      storeCapsuleFor(store).screenshotsDir,
      `${label}_${Date.now()}.png`,
    );
    return (await controller.screenshotToPath(screenshotPath, label)).path;
  } catch (error) {
    console.warn(`[AdExecution] ${label} screenshot unavailable; writing fail-closed audit without screenshot`, error);
    return undefined;
  }
}

// ============================================================================
// Report Download & Parse
// ============================================================================

async function handleDownloadReport(dateRange: { start: string; end: string }): Promise<string> {
  throw new Error(
    `旧版单报表下载入口已停用，避免访问过期的领星页面和未验证 selector。请在左侧“广告报表”中使用“采集预检”/“验证页面”/“启动采集”流程。日期范围：${dateRange.start} - ${dateRange.end}`,
  );
}

async function handleParseReport(filePath: string): Promise<number> {
  throw new Error(
    `旧版无店铺归属的报表解析入口已停用：${path.basename(filePath || '') || '未提供文件'}。`
    + ' 请从当前美国站店铺的“采集与导入”工作台执行，系统会写入 store_id、文件快照与对账记录。',
  );
}

// ============================================================================
// v1.5 Report Collector / Keyword / Listing
// ============================================================================

function localBatchStamp(): string {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeLocalReportFileName(filePath: string, index: number): string {
  const extension = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, path.extname(filePath)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 96) || `report_${index + 1}`;
  return `${String(index + 1).padStart(2, '0')}_${baseName}${extension}`;
}

function inferLingxingReportTypeFromLocalPath(filePath: string): LingxingReportType | undefined {
  const name = path.basename(filePath).toLowerCase().replace(/[\s\-()（）]+/g, '_');
  const explicit = inferAdMetricReportType('', name);
  if (explicit === 'search_term') return 'user_search_term';
  if (explicit && LINGXING_REPORT_TYPE_SET.has(explicit)) return explicit as LingxingReportType;
  if (/用户.*搜索词|search.*term|搜索词/.test(name)) return 'user_search_term';
  if (/商品.*投放|product.*target|asin.*target/.test(name)) return 'product_targeting';
  if (/推广.*商品|广告.*商品|advertised.*product/.test(name)) return 'advertised_product';
  if (/自动.*投放|auto.*target/.test(name)) return 'auto_targeting';
  if (/关键词|keyword/.test(name)) return 'keyword';
  if (/广告位|placement/.test(name)) return 'placement';
  if (/广告组|ad_group|ad.*group/.test(name)) return 'ad_group';
  if (/广告活动|campaign/.test(name)) return 'campaign';
  return undefined;
}

function buildLocalBusinessReportBatch(
  scope: NormalizedBusinessUiScope,
  selectedPaths: string[],
  capsule: StoreCapsulePaths,
): { batch: LingxingReportBatch; files: LingxingReportFile[] } {
  const uniquePaths = Array.from(new Set(selectedPaths.map((item) => canonicalizeExistingPath(item)).filter(Boolean)));
  const rejectedPaths = uniquePaths.filter((filePath) => !isExistingRawBusinessReportPath(filePath));
  if (rejectedPaths.length > 0) {
    throw new Error(`本地导入被阻断：以下文件不是可用的 .xlsx/.xls/.csv 原始广告表格：${rejectedPaths.map((item) => path.basename(item)).join('、')}`);
  }

  const now = new Date().toISOString();
  const batchId = `batch_local_${localBatchStamp()}`;
  const downloadDir = path.join(
    capsule.downloadsDir,
    'local-imports',
    `${scope.dateFrom}_${scope.dateTo}`,
    batchId,
  );
  if (!isPathInsideDirectory(downloadDir, capsule.downloadsDir)) {
    throw new Error('本地导入被阻断：目标目录不属于当前店铺独立数据舱。');
  }
  fs.mkdirSync(downloadDir, { recursive: true });

  const files: LingxingReportFile[] = [];
  const usedReportTypes = new Set<string>();
  const unknownFiles: string[] = [];

  uniquePaths.forEach((sourcePath, index) => {
    const reportType = inferLingxingReportTypeFromLocalPath(sourcePath);
    if (!reportType) {
      unknownFiles.push(path.basename(sourcePath));
      return;
    }
    if (usedReportTypes.has(reportType)) {
      throw new Error(`本地导入被阻断：${path.basename(sourcePath)} 与已选择文件重复对应 ${reportType}，每类报表当前只保留 1 个文件。`);
    }
    usedReportTypes.add(reportType);
    const definition = LINGXING_AD_REPORTS.find((item) => item.type === reportType);
    const targetPath = path.join(downloadDir, safeLocalReportFileName(sourcePath, index));
    fs.copyFileSync(sourcePath, targetPath);
    const verification = verifyDownloadedFile(targetPath, {
      minBytes: 1,
      expectedDownloadDir: downloadDir,
      expectedReportType: reportType,
    });
    if (!verification.valid) {
      throw new Error(`本地导入被阻断：${path.basename(sourcePath)} 校验失败：${verification.errorMessage || '不是有效广告报表'}`);
    }
    files.push({
      id: `${batchId}_${reportType}`,
      batchId,
      reportType,
      displayName: definition?.displayName || reportType,
      status: 'downloaded',
      maxAutoRetries: 0,
      autoRetryCount: 0,
      filePath: targetPath,
      fileSizeBytes: verification.fileSizeBytes,
      attemptErrors: [],
      createdAt: now,
      updatedAt: now,
    });
  });

  if (unknownFiles.length > 0) {
    throw new Error(`本地导入被阻断：无法从文件名识别报表类型：${unknownFiles.join('、')}。请使用包含 campaign、ad_group、placement、advertised_product、auto_targeting、keyword、product_targeting、search_term，或中文报表名的文件名。`);
  }
  if (files.length === 0) {
    throw new Error('本地导入被阻断：未选择可导入的真实广告报表。');
  }

  const batch: LingxingReportBatch = {
    id: batchId,
    requestId: `local-import:${batchId}`,
    storeId: scope.storeId,
    browserProfileId: scope.storeContext.browserProfileId,
    businessDate: scope.storeContext.businessDate,
    sessionGeneration: scope.storeContext.sessionGeneration,
    appVersion: APP_VERSION,
    dateStart: scope.dateFrom,
    dateEnd: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    status: files.length === LINGXING_AD_REPORTS.length ? 'completed' : 'completed_with_errors',
    downloadDir,
    createdAt: now,
    completedAt: now,
  };
  batch.manifestPath = writeManifest(batch, files);
  return { batch, files };
}

function fileSizeOrZero(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function fileHashOrNull(filePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function reportFileIndexKey(batchId: string, reportType: string, filePath: string): string {
  return [
    batchId,
    reportType,
    canonicalizeExistingPath(filePath).toLowerCase(),
  ].join('|');
}

function metricProductContextKey(metric: { date?: string; campaignName?: string; adGroupName?: string }, includeDate: boolean): string {
  return [
    includeDate ? metric.date || '' : '*',
    (metric.campaignName || '').trim().toLowerCase(),
    (metric.adGroupName || '').trim().toLowerCase(),
  ].join('|');
}

function uniqueProductContext(
  map: Map<string, Map<string, { asin: string; msku: string }>>,
  key: string,
): { asin: string; msku: string } | undefined {
  const values = map.get(key);
  if (!values || values.size !== 1) return undefined;
  return Array.from(values.values())[0];
}

function attachUniqueProductContext(metrics: AdDailyMetrics[]): AdDailyMetrics[] {
  const productByKey = new Map<string, Map<string, { asin: string; msku: string }>>();
  const addContext = (key: string, metric: AdDailyMetrics) => {
    if (!metric.asin) return;
    const bucket = productByKey.get(key) ?? new Map<string, { asin: string; msku: string }>();
    bucket.set(metric.asin.toUpperCase(), { asin: metric.asin, msku: metric.msku || '' });
    productByKey.set(key, bucket);
  };

  for (const metric of metrics) {
    addContext(metricProductContextKey(metric, true), metric);
    addContext(metricProductContextKey(metric, false), metric);
  }

  return metrics.map((metric) => {
    if (metric.asin) return metric;
    const exact = uniqueProductContext(productByKey, metricProductContextKey(metric, true));
    const fallback = exact ?? uniqueProductContext(productByKey, metricProductContextKey(metric, false));
    return fallback
      ? { ...metric, asin: fallback.asin, msku: metric.msku || fallback.msku }
      : metric;
  });
}

function importStoreScopedLingxingDownloadedReportMetrics(result: LingxingBatchFilesResult): {
  inserted: number;
  parsedFiles: number;
  skippedFiles: number;
  deletedExisting: number;
  deduplicated: boolean;
  importRunId?: string;
  errors: Array<{ reportType: string; filePath?: string; message: string }>;
} {
  if (!state.lingxingImportRepo || !state.storeRepo || !result.batch.storeId) {
    throw new Error('店铺级领星导入仓库或批次 StoreContext 尚未就绪。');
  }
  const storeId = result.batch.storeId;
  const store = state.storeRepo.getStore(storeId);
  if (!store || store.status !== 'active') {
    throw new Error(`店铺 ${storeId} 不存在或已停用，拒绝导入领星报表。`);
  }
  const parser = new ReportParser();
  const errors: Array<{ reportType: string; filePath?: string; message: string }> = [];
  const parsedMetrics: AdDailyMetrics[] = [];
  const importFiles: Array<{
    lingxingFileId: string;
    reportType: string;
    filePath: string;
    fileName: string;
    fileSizeBytes: number;
    fileHash: string;
    importedRows: number;
  }> = [];
  let skippedFiles = 0;

  for (const file of result.files) {
    if (file.status !== 'downloaded' || !file.filePath) {
      skippedFiles += 1;
      continue;
    }
    try {
      const sourceFile = canonicalizeExistingPath(file.filePath);
      const parsed = parser.autoParse(sourceFile, { reportType: file.reportType });
      assertLingxingParsedReportImportable(parsed, {
        dateStart: result.batch.dateStart,
        dateEnd: result.batch.dateEnd,
        sourceName: path.basename(sourceFile),
      });
      const fileHash = fileHashOrNull(sourceFile);
      if (!fileHash) throw new Error(`无法计算报表 SHA-256：${path.basename(sourceFile)}。`);
      importFiles.push({
        lingxingFileId: file.id,
        reportType: file.reportType,
        filePath: sourceFile,
        fileName: path.basename(sourceFile),
        fileSizeBytes: file.fileSizeBytes ?? fileSizeOrZero(sourceFile),
        fileHash,
        importedRows: parsed.data.length,
      });
      parsedMetrics.push(...parsed.data.map((metric) => ({
        ...metric,
        batchId: result.batch.id,
        reportType: file.reportType,
        storeName: store.displayName,
        marketplaceCode: 'US',
        currency: 'USD',
        sourceFile,
      })));
    } catch (error) {
      errors.push({
        reportType: file.reportType,
        filePath: file.filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const metrics = attachUniqueProductContext(parsedMetrics);
  if (errors.length > 0 || importFiles.length === 0) {
    return {
      inserted: 0,
      parsedFiles: importFiles.length,
      skippedFiles,
      deletedExisting: 0,
      deduplicated: false,
      errors,
    };
  }

  const runId = `import_${result.batch.id}`;
  const commit = state.lingxingImportRepo.commitImportForStore(storeId, {
    runId,
    idempotencyKey: `lingxing:${result.batch.id}`,
    batchId: result.batch.id,
    files: importFiles,
    metrics,
    // Parsed rows cannot independently prove their own completeness. Until
    // Lingxing supplies a separate control total, persist no "matched"
    // business reconciliation evidence for this run.
    reconciliations: [],
    startedAt: result.batch.completedAt ?? result.batch.createdAt,
  });
  return {
    inserted: commit.run.metricRowCount,
    parsedFiles: commit.run.sourceFileCount,
    skippedFiles,
    deletedExisting: 0,
    deduplicated: commit.deduplicated,
    importRunId: commit.run.runId,
    errors,
  };
}

function loadLatestImportableLingxingBatchForScope(scope: NormalizedBusinessUiScope): LingxingBatchFilesResult | undefined {
  if (!state.db) return undefined;
  const batch = state.db.prepare(`
    SELECT *
    FROM lingxing_report_batches
    WHERE status IN ('completed', 'completed_with_errors')
      AND store_id = @storeId
      AND COALESCE(request_id, '') NOT LIKE 'canary:%'
      AND date_start = @dateFrom
      AND date_end = @dateTo
      AND store_name = @storeName
      AND marketplace_code = @marketplaceCode
    ORDER BY completed_at DESC, created_at DESC
    LIMIT 1
  `).get(scope) as any;
  if (!batch) return undefined;

  const rows = state.db.prepare(`
    SELECT *
    FROM lingxing_report_files
    WHERE store_id = ? AND batch_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(scope.storeId, batch.id) as any[];

  return {
    batch: {
      id: batch.id,
      requestId: batch.request_id,
      storeId: batch.store_id,
      browserProfileId: batch.browser_profile_id,
      businessDate: batch.business_date,
      sessionGeneration: batch.session_generation,
      appVersion: batch.app_version,
      dateStart: batch.date_start,
      dateEnd: batch.date_end,
      storeName: batch.store_name,
      marketplaceCode: batch.marketplace_code,
      status: batch.status,
      downloadDir: batch.download_dir,
      manifestPath: batch.manifest_path,
      createdAt: batch.created_at,
      completedAt: batch.completed_at,
    },
    files: rows.map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      reportType: row.report_type,
      displayName: row.display_name,
      status: row.status,
      maxAutoRetries: row.max_auto_retries,
      autoRetryCount: row.auto_retry_count,
      filePath: row.file_path,
      fileSizeBytes: row.file_size_bytes,
      errorMessage: row.error_message,
      attemptErrors: row.attempt_errors_json ? JSON.parse(row.attempt_errors_json) : [],
      failureScreenshotPath: row.failure_screenshot_path,
      failureDomSnapshotPath: row.failure_dom_snapshot_path,
      failureTracePath: row.failure_trace_path,
      traceUnavailableReason: row.trace_unavailable_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

function backfillAdMetricsFromLatestBatchIfNeeded(scope: NormalizedBusinessUiScope) {
  const existing = state.db?.prepare(`
    SELECT 1 FROM ad_daily_metrics
    WHERE store_id = ? AND date >= ? AND date <= ?
    LIMIT 1
  `).get(scope.storeId, scope.dateFrom, scope.dateTo);
  if (existing) return undefined;
  const latestBatch = loadLatestImportableLingxingBatchForScope(scope);
  return latestBatch ? importStoreScopedLingxingDownloadedReportMetrics(latestBatch) : undefined;
}

function resolveBusinessStoreAuthority(submittedContext?: unknown): {
  context: StoreContextEnvelope;
  store: StoreRecord;
} {
  if (!state.storeCoordinator || !state.storeRepo) {
    throw new Error('店铺数据域尚未初始化。');
  }
  const context = submittedContext
    ? state.storeCoordinator.assertActiveStoreContext(submittedContext)
    : state.storeCoordinator.getActiveStoreContext();
  if (!context) throw new Error('请先选择美国站店铺。');
  const store = state.storeRepo.getStore(context.storeId);
  if (!store || store.status !== 'active') {
    throw new Error('当前店铺不存在或已停用。');
  }
  if (store.marketplace !== 'US' || store.currency !== 'USD') {
    throw new Error('当前版本仅支持 Amazon 美国站与 USD。');
  }
  return { context, store };
}

function normalizeBusinessUiScope(input: unknown) {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const dateFrom = typeof value.dateFrom === 'string' ? value.dateFrom.trim() : '';
  const dateTo = typeof value.dateTo === 'string' ? value.dateTo.trim() : '';
  validateDateRange({ start: dateFrom, end: dateTo });
  const { context, store } = resolveBusinessStoreAuthority(value.storeContext);
  return {
    dateFrom,
    dateTo,
    storeId: context.storeId,
    storeContext: Object.freeze({ ...context }),
    storeName: store.displayName,
    marketplaceCode: 'US' as const,
    asin: optionalTrimmedString(value.asin),
    batchId: optionalTrimmedString(value.batchId),
    currency: 'USD' as const,
  };
}

function normalizeBusinessMutationScope(input: unknown): NormalizedBusinessUiScope {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (!value.storeContext) {
    throw new Error('该写入操作缺少 StoreContext，请刷新当前店铺后重试。');
  }
  return normalizeBusinessUiScope(value);
}

function businessMetricsWhere(
  scope: NormalizedBusinessUiScope,
  source?: BusinessMetricSource,
  grain: AdMetricReportGrain = 'actionable',
): { sql: string; params: (string | number)[] } {
  let sql = `
    store_id = ?
    AND date >= ?
    AND date <= ?
    AND COALESCE(store_name, '') = COALESCE(?, '')
    AND COALESCE(marketplace_code, '') = COALESCE(?, '')
    AND ${adMetricGrainWhere(grain)}
  `;
  const params: (string | number)[] = [scope.storeId, scope.dateFrom, scope.dateTo, scope.storeName, scope.marketplaceCode];
  if (scope.asin) {
    sql += ' AND upper(COALESCE(asin, \'\')) = upper(?)';
    params.push(scope.asin);
  }
  const sourceFiles = Array.from(new Set(source?.sourceFiles.filter(Boolean) ?? []));
  const batchIds = Array.from(new Set(source?.batchIds?.filter(Boolean) ?? (source?.batchId ? [source.batchId] : [])));
  if (batchIds.length > 0 && sourceFiles.length > 0) {
    sql += `
      AND source_file IN (${sourceFiles.map(() => '?').join(', ')})
      AND batch_id IN (${batchIds.map(() => '?').join(', ')})
    `;
    params.push(...sourceFiles, ...batchIds);
  } else if (batchIds.length > 0) {
    sql += ' AND 1 = 0';
  } else if (sourceFiles.length > 0) {
    sql += ` AND source_file IN (${sourceFiles.map(() => '?').join(', ')})`;
    params.push(...sourceFiles);
  } else {
    sql += ' AND 1 = 0';
  }
  return { sql, params };
}

function collectBusinessBatchScopeMismatches(batch: LingxingReportBatch, scope: NormalizedBusinessUiScope): string[] {
  const mismatches: string[] = [];
  if (batch.dateStart !== scope.dateFrom) mismatches.push(`开始日期不一致：批次 ${batch.dateStart}，当前范围 ${scope.dateFrom}`);
  if (batch.dateEnd !== scope.dateTo) mismatches.push(`结束日期不一致：批次 ${batch.dateEnd}，当前范围 ${scope.dateTo}`);
  if ((batch.storeName || '') !== (scope.storeName || '')) mismatches.push(`店铺不一致：批次 ${batch.storeName || '-'}，当前范围 ${scope.storeName || '-'}`);
  if ((batch.marketplaceCode || '') !== (scope.marketplaceCode || '')) mismatches.push(`站点不一致：批次 ${batch.marketplaceCode || '-'}，当前范围 ${scope.marketplaceCode || '-'}`);
  return mismatches;
}

function loadLatestBusinessBatch(scope: NormalizedBusinessUiScope): BusinessBatchResult | undefined {
  if (!state.db) return undefined;
  if (scope.batchId) {
    try {
      const batchResult = loadPersistedLingxingBatch(scope.batchId);
      const scopeMismatch = collectBusinessBatchScopeMismatches(batchResult.batch, scope);
      const statusMismatch = batchResult.batch.status === 'completed' || batchResult.batch.status === 'completed_with_errors'
        ? []
        : [`数据批次尚未完成：当前状态 ${batchResult.batch.status}`];
      const mismatches = [...statusMismatch, ...scopeMismatch];
      return mismatches.length > 0
        ? { ...batchResult, scopeMismatch: mismatches, sourceBatchIds: [batchResult.batch.id] }
        : { ...batchResult, sourceBatchIds: [batchResult.batch.id] };
    } catch {
      return undefined;
    }
  }
  return composeBusinessBatchForScope(scope);
}

function loadBusinessBatchesForScope(scope: NormalizedBusinessUiScope): BusinessBatchResult[] {
  if (!state.db) return [];
  const rows = state.db.prepare(`
    SELECT id
    FROM lingxing_report_batches
    WHERE store_id = @storeId
      AND COALESCE(request_id, '') NOT LIKE 'canary:%'
      AND date_start = @dateFrom
      AND date_end = @dateTo
      AND COALESCE(store_name, '') = COALESCE(@storeName, '')
      AND COALESCE(marketplace_code, '') = COALESCE(@marketplaceCode, '')
      AND status IN ('completed', 'completed_with_errors')
    ORDER BY completed_at DESC, created_at DESC, id DESC
  `).all(scope) as Array<{ id?: string }>;
  return rows
    .map((row) => {
      try {
        return row.id ? loadPersistedLingxingBatch(row.id) : undefined;
      } catch {
        return undefined;
      }
    })
    .filter(Boolean) as BusinessBatchResult[];
}

function composeBusinessBatchForScope(scope: NormalizedBusinessUiScope): BusinessBatchResult | undefined {
  const batches = loadBusinessBatchesForScope(scope);
  if (batches.length === 0) return undefined;

  const latestBatch = batches[0].batch;
  const { files, fileDownloadDirs } = selectLatestRawBusinessReportsByType<LingxingReportFile>(batches);
  return {
    batch: {
      ...latestBatch,
      id: latestBatch.id,
      status: files.length === LINGXING_AD_REPORTS.length ? 'completed' : 'completed_with_errors',
    },
    files,
    sourceBatchIds: batches.map((item) => item.batch.id),
    fileDownloadDirs,
  };
}

function summarizeBusinessBatchOption(scope: NormalizedBusinessUiScope, batchResult: BusinessBatchResult): BusinessBatchOptionView {
  const realFiles = batchResult.files.filter((file) => isExistingRawBusinessReportFile(file, batchResult.batch));
  const indexedFilesByKey = new Map<string, ReportFileRecord>();
  const batchIds = Array.from(new Set([
    batchResult.batch.id,
    ...(batchResult.sourceBatchIds || []),
    ...realFiles.map((file) => file.batchId).filter((value): value is string => Boolean(value)),
  ]));
  for (const batchId of batchIds) {
    for (const indexed of state.reportFileRepo?.findForStore(scope.storeId, { batchId, limit: 5000 }) || []) {
      indexedFilesByKey.set(reportFileIndexKey(indexed.batchId, indexed.reportType, indexed.filePath), indexed);
    }
  }
  const importedReportTypes = new Set<string>();
  const importedRowCount = realFiles.reduce((sum, file) => {
    if (!file.filePath) return sum;
    const filePath = canonicalizeExistingPath(file.filePath);
    const batchId = file.batchId || batchResult.batch.id;
    const indexed = indexedFilesByKey.get(reportFileIndexKey(batchId, file.reportType, filePath));
    const importState = resolveBusinessReportImportState({
      fileStatus: file.status,
      indexedStatus: indexed?.status,
      countedMetricRows: countImportedRowsForFile(scope, filePath, batchId),
    });
    if (importState.status === 'imported') importedReportTypes.add(file.reportType);
    return sum + importState.importedRows;
  }, 0);
  const coverage = summarizeBusinessReportCoverage({
    expectedTypes: LINGXING_AD_REPORTS.map((report) => report.type),
    realReportFiles: realFiles,
  });

  return {
    id: batchResult.batch.id,
    status: batchResult.batch.status,
    dateStart: batchResult.batch.dateStart,
    dateEnd: batchResult.batch.dateEnd,
    storeName: batchResult.batch.storeName,
    marketplaceCode: batchResult.batch.marketplaceCode,
    downloadDir: batchResult.batch.downloadDir,
    manifestPath: batchResult.batch.manifestPath,
    createdAt: batchResult.batch.createdAt,
    completedAt: batchResult.batch.completedAt,
    totalFileRecords: batchResult.files.length,
    realReportFileCount: coverage.realReportFileCount,
    importedReportTypeCount: importedReportTypes.size,
    importedRowCount,
    missingReportLabels: LINGXING_AD_REPORTS
      .filter((report) => coverage.missingReportTypes.includes(report.type))
      .map((report) => report.displayName),
  };
}

function handleGetBusinessBatchOptions(input: unknown): BusinessBatchOptionView[] {
  const scope = normalizeBusinessUiScope(input);
  return loadBusinessBatchesForScope(scope).map((batchResult) => summarizeBusinessBatchOption(scope, batchResult));
}

function isExistingRawReportFile(file: LingxingReportFile, batch?: LingxingReportBatch): file is LingxingReportFile & { filePath: string } {
  return isExistingRawBusinessReportFile(file, batch);
}

function metricSourceFileCandidates(filePath: string): string[] {
  return Array.from(new Set([
    filePath,
    canonicalizeExistingPath(filePath),
  ]));
}

function countImportedRowsForFile(scope: NormalizedBusinessUiScope, filePath: string, batchId?: string): number {
  if (!state.db) return 0;
  return countImportedRowsForReportFile(state.db, {
    scope,
    sourceFiles: metricSourceFileCandidates(filePath),
    batchId,
  });
}

function readBusinessMetricSummary(sql: string, params: (string | number)[]) {
  return state.db!.prepare(`
    SELECT
      COUNT(*) AS importedRows,
      COALESCE(SUM(cost), 0) AS totalSpend,
      COALESCE(SUM(sales), 0) AS totalSales,
      COALESCE(SUM(orders), 0) AS totalOrders,
      COALESCE(SUM(clicks), 0) AS totalClicks,
      COALESCE(SUM(impressions), 0) AS totalImpressions
    FROM ad_daily_metrics
    WHERE ${sql}
  `).get(...params) as {
    importedRows?: number;
    totalSpend?: number;
    totalSales?: number;
    totalOrders?: number;
    totalClicks?: number;
    totalImpressions?: number;
  } | undefined;
}

function loadAvailableBusinessMetricReportTypes(sql: string, params: (string | number)[]): string[] {
  if (!state.db) return [];
  const rows = state.db.prepare(`
    SELECT report_type AS reportType, source_file AS sourceFile
    FROM ad_daily_metrics
    WHERE ${sql}
  `).all(...params) as Array<{ reportType?: string | null; sourceFile?: string | null }>;
  return Array.from(new Set(
    rows
      .map((row) => inferAdMetricReportType(row.reportType, row.sourceFile))
      .filter(Boolean),
  ));
}

function loadBusinessQuantSummary(scope: NormalizedBusinessUiScope, realReportFileCount: number, source?: BusinessMetricSource) {
  if (!state.db) {
    return {
      hasImportedMetrics: false,
      importedRows: 0,
      canonicalRows: 0,
      actionableRows: 0,
      breakdownRows: 0,
      summarySource: 'blocked',
      summaryWarning: undefined,
      totalSpend: 0,
      totalSales: 0,
      totalOrders: 0,
      totalClicks: 0,
      totalImpressions: 0,
      acos: 0,
      cvr: 0,
      cpc: 0,
      wastedSpend: null,
      highRiskCount: 0,
      adObjectTimelines: [],
      diagnostics: [],
      blockers: ['本地数据库不可用，无法读取广告量化指标。'],
    };
  }

  const allMetrics = businessMetricsWhere(scope, source, 'all');
  const actionableMetrics = businessMetricsWhere(scope, source, 'actionable');
  const breakdownMetrics = businessMetricsWhere(scope, source, 'breakdown');
  const allSummary = readBusinessMetricSummary(allMetrics.sql, allMetrics.params);
  const actionableSummary = readBusinessMetricSummary(actionableMetrics.sql, actionableMetrics.params);
  const breakdownSummary = readBusinessMetricSummary(breakdownMetrics.sql, breakdownMetrics.params);
  const canonical = adMetricCanonicalWhere(
    loadAvailableBusinessMetricReportTypes(allMetrics.sql, allMetrics.params),
  );
  const canonicalSelection = canonical.selection;
  const canonicalSql = `${allMetrics.sql} AND ${canonical.whereSql}`;
  const canonicalSummary = readBusinessMetricSummary(canonicalSql, allMetrics.params);

  const importedRows = Number(allSummary?.importedRows || 0);
  const actionableRows = Number(actionableSummary?.importedRows || 0);
  const breakdownRows = Number(breakdownSummary?.importedRows || 0);
  const canonicalRows = Number(canonicalSummary?.importedRows || 0);
  const summary = canonicalRows > 0 ? canonicalSummary : undefined;
  const summarySource = canonicalRows > 0 ? canonicalSelection.summarySource : 'none';
  const totalSpend = Number(summary?.totalSpend || 0);
  const totalSales = Number(summary?.totalSales || 0);
  const totalOrders = Number(summary?.totalOrders || 0);
  const totalClicks = Number(summary?.totalClicks || 0);
  const totalImpressions = Number(summary?.totalImpressions || 0);
  const acos = totalSales > 0 ? totalSpend / totalSales : 0;
  const cvr = totalClicks > 0 ? totalOrders / totalClicks : 0;
  const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

  const rows = actionableRows > 0
    ? state.db.prepare(`
      SELECT
        COALESCE(portfolio_name, '') AS portfolioName,
        COALESCE(campaign_name, '') AS campaignName,
        COALESCE(ad_group_name, '') AS adGroupName,
        COALESCE(asin, '') AS asin,
        COALESCE(report_type, '') AS reportType,
        COALESCE(NULLIF(search_term, ''), NULLIF(targeting, ''), NULLIF(match_type, ''), '-') AS objectName,
        COALESCE(NULLIF(search_term, ''), '') AS searchTerm,
        COALESCE(NULLIF(targeting, ''), '') AS targeting,
        COALESCE(NULLIF(match_type, ''), '') AS matchType,
        MAX(date) AS metricDate,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(cost), 0) AS spend,
        COALESCE(SUM(sales), 0) AS sales,
        COALESCE(SUM(orders), 0) AS orders,
        COALESCE(SUM(clicks), 0) AS clicks
      FROM ad_daily_metrics
      WHERE ${actionableMetrics.sql}
      GROUP BY portfolio_name, campaign_name, ad_group_name, asin, report_type, objectName
      ORDER BY spend DESC, clicks DESC
      LIMIT 50
    `).all(...actionableMetrics.params) as Array<{
      portfolioName?: string;
      campaignName?: string;
      adGroupName?: string;
      asin?: string;
      reportType?: string;
      objectName?: string;
      searchTerm?: string;
      targeting?: string;
      matchType?: string;
      metricDate?: string;
      impressions?: number;
      spend?: number;
      sales?: number;
      orders?: number;
      clicks?: number;
    }>
    : [];

  const runtimeConfig = currentStoreRuntimeAnalysisConfig();
  assertRuntimeConfigStore(runtimeConfig, scope.storeId);
  assertRuntimeAnalysisWindow(runtimeConfig, scope.dateFrom, scope.dateTo);
  const quantifier = new AdQuantifier(runtimeConfig.ruleConfig);
  const timelineMetrics = actionableRows > 0
    ? state.db.prepare(`
      SELECT *
      FROM ad_daily_metrics
      WHERE ${actionableMetrics.sql}
      ORDER BY date ASC, campaign_name, ad_group_name, source_row
      LIMIT 3000
    `).all(...actionableMetrics.params).map(mapBusinessAdMetricRow)
    : [];
  const adObjectTimelines = quantifier.quantifyTimeline(timelineMetrics)
    .slice(0, 20)
    .map((timeline) => ({
      objectKey: timeline.objectKey,
      objectType: timeline.objectType,
      objectName: timeline.objectName,
      asin: timeline.asin || undefined,
      campaignName: timeline.campaignName || undefined,
      adGroupName: timeline.adGroupName || undefined,
      dateFrom: timeline.dateFrom,
      dateTo: timeline.dateTo,
      daysActive: timeline.daysActive,
      lifecycleStage: timeline.lifecycleStage,
      quantStatus: timeline.status,
      recommendedAction: timeline.recommendedAction,
      recommendedValue: timeline.recommendedValue,
      trend: timeline.trend,
      totals: timeline.totals,
      thresholds: timeline.thresholdSuggestion,
      reasons: timeline.reasons,
      reviewRequired: timeline.reviewRequired,
    }));
  const diagnostics = rows.map((row) => {
    const spend = Number(row.spend || 0);
    const sales = Number(row.sales || 0);
    const orders = Number(row.orders || 0);
    const clicks = Number(row.clicks || 0);
    const impressions = Number(row.impressions || 0);
    const rowAcos = sales > 0 ? spend / sales : 0;
    const rowCvr = clicks > 0 ? orders / clicks : 0;
    const rowCpc = clicks > 0 ? spend / clicks : 0;
    const metric: AdDailyMetrics = {
      date: row.metricDate || scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: row.asin || '',
      msku: '',
      campaignName: row.campaignName || '',
      adGroupName: row.adGroupName || '',
      targeting: row.targeting || '',
      searchTerm: row.searchTerm || (String(row.reportType || '').includes('search') ? row.objectName || '' : ''),
      matchType: normalizeAdMetricMatchType(row.matchType),
      impressions,
      clicks,
      cost: spend,
      orders,
      sales,
      acos: rowAcos,
      cpc: rowCpc,
      cvr: rowCvr,
      sourceFile: '',
      reportType: row.reportType || '',
    };
    const quant = quantifier.quantify(metric);
    const identity = buildAdMetricObjectIdentity(metric);
    return {
      portfolioName: row.portfolioName || undefined,
      campaignName: row.campaignName || undefined,
      adGroupName: row.adGroupName || undefined,
      asin: row.asin || undefined,
      objectKey: identity.key,
      objectType: identity.objectType,
      objectName: identity.objectName,
      spend,
      sales,
      orders,
      clicks,
      acos: rowAcos,
      cvr: rowCvr,
      cpc: rowCpc,
      quantStatus: quant.status,
      lifecycleStage: quant.lifecycleStage,
      severity: quant.severity,
      recommendedAction: quant.recommendedAction,
      recommendedValue: quant.recommendedValue,
      thresholds: quant.thresholds,
      diagnosis: quant.status === 'waste'
        ? '浪费风险'
        : quant.status === 'scale'
          ? '可扩量候选'
          : quant.status === 'watch'
            ? '观察复核'
            : quant.status === 'blocked'
              ? '样本不足'
              : '健康',
      suggestedDirection: quant.recommendedAction
        ? `${quant.recommendedAction}${quant.recommendedValue ? ` -> ${quant.recommendedValue}` : ''}`
        : quant.reasons[0],
    };
  });

  const blockers: string[] = [];
  if (realReportFileCount === 0) blockers.push('当前范围还没有可量化的真实广告数据');
  if (importedRows === 0) blockers.push('没有真实报表文件和导入指标，本页不生成建议。');
  if (importedRows > 0 && actionableRows === 0) blockers.push('当前范围只有广告活动/广告组/广告位等分解报表，没有关键词、投放或搜索词等可生成建议的行动报表。');
  if (canonicalSelection.warning) blockers.push(canonicalSelection.warning);

  return {
    hasImportedMetrics: actionableRows > 0,
    importedRows,
    canonicalRows,
    actionableRows,
    breakdownRows,
    summarySource,
    summaryWarning: canonicalSelection.warning,
    totalSpend,
    totalSales,
    totalOrders,
    totalClicks,
    totalImpressions,
    acos,
    cvr,
    cpc,
    wastedSpend: importedRows > 0 ? diagnostics.filter((row) => row.sales <= 0).reduce((sum, row) => sum + row.spend, 0) : null,
    highRiskCount: diagnostics.filter((row) => row.quantStatus === 'waste' || row.severity === 'high').length,
    adObjectTimelines,
    diagnostics,
    blockers,
  };
}

function normalizeAdMetricMatchType(value: unknown): AdDailyMetrics['matchType'] {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'exact' || normalized === 'broad' || normalized === 'phrase' || normalized === 'auto') {
    return normalized;
  }
  return 'auto';
}

function loadBusinessRecommendationMetrics(scope: NormalizedBusinessUiScope, source: BusinessMetricSource, limit: number): AdDailyMetrics[] {
  if (!state.db) return [];
  const { sql, params } = businessMetricsWhere(scope, source);
  const rows = state.db.prepare(`
    SELECT *
    FROM ad_daily_metrics
    WHERE ${sql}
    ORDER BY date DESC, created_at DESC
    LIMIT ?
  `).all(...params, limit) as any[];
  return rows.map(mapBusinessAdMetricRow);
}

function loadBusinessCanonicalMetrics(scope: NormalizedBusinessUiScope, source: BusinessMetricSource, limit: number): AdDailyMetrics[] {
  if (!state.db) return [];
  const allMetrics = businessMetricsWhere(scope, source, 'all');
  const canonical = adMetricCanonicalWhere(
    loadAvailableBusinessMetricReportTypes(allMetrics.sql, allMetrics.params),
  );
  if (canonical.selection.reportTypes.length === 0) return [];
  const rows = state.db.prepare(`
    SELECT *
    FROM ad_daily_metrics
    WHERE ${allMetrics.sql}
      AND ${canonical.whereSql}
    ORDER BY date ASC, created_at DESC
    LIMIT ?
  `).all(...allMetrics.params, limit) as any[];
  return rows.map(mapBusinessAdMetricRow);
}

function mapBusinessAdMetricRow(row: any): AdDailyMetrics {
  return {
    id: row.id,
    batchId: row.batch_id,
    reportType: row.report_type,
    portfolioName: row.portfolio_name,
    date: row.date,
    storeName: row.store_name,
    marketplaceCode: row.marketplace_code,
    asin: row.asin,
    msku: row.msku,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    targeting: row.targeting,
    searchTerm: row.search_term,
    matchType: row.match_type,
    impressions: row.impressions,
    clicks: row.clicks,
    cost: row.cost,
    orders: row.orders,
    sales: row.sales,
    currency: row.currency || 'USD',
    acos: row.acos,
    cpc: row.cpc,
    cvr: row.cvr,
    sourceFile: row.source_file,
    sourceRow: row.source_row ?? undefined,
    createdAt: row.created_at,
  };
}

function countMetricsWithSourceRow(metrics: AdDailyMetrics[]): number {
  return metrics.filter((metric) => Number.isFinite(Number(metric.sourceRow)) && Number(metric.sourceRow) > 0).length;
}

function countMetricsWithSourceFileAndRow(metrics: AdDailyMetrics[]): number {
  return metrics.filter((metric) => (
    String(metric.sourceFile || '').trim().length > 0
    && Number.isFinite(Number(metric.sourceRow))
    && Number(metric.sourceRow) > 0
  )).length;
}

function countMetricsWithAsin(metrics: AdDailyMetrics[]): number {
  return metrics.filter((metric) => String(metric.asin || '').trim().length > 0).length;
}

function getBusinessRecommendationGate(input: unknown, workflow: FormalBusinessWorkflow): {
  scope: NormalizedBusinessUiScope;
  pipeline: ReturnType<typeof handleGetBusinessUiDataPipeline>;
  metricSource: BusinessMetricSource;
} {
  const scope = normalizeBusinessUiScope(input);
  const pipeline = handleGetBusinessUiDataPipeline(scope);
  assertFormalBusinessWorkflowReady({
    workflow,
    requiredReportTypes: LINGXING_AD_REPORTS.map((report) => report.type),
    realReportFiles: pipeline.collection.realReportFiles,
  });
  if (!pipeline.quant.hasImportedMetrics || pipeline.quant.importedRows <= 0) {
    throw new Error('正式业务分析被阻断：当前范围没有由真实报表导入的广告指标行。');
  }
  const batchId = pipeline.collection.latestBatch?.id;
  const realReportBatchIds = Array.from(new Set(
    pipeline.collection.realReportFiles
      .map((file) => file.batchId || batchId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ));
  const batchIds = realReportBatchIds.length
    ? realReportBatchIds
    : (pipeline.collection.sourceBatchIds?.length ? pipeline.collection.sourceBatchIds : (batchId ? [batchId] : []));
  const sourceFiles = pipeline.collection.realReportFiles.flatMap((file) => metricSourceFileCandidates(file.filePath));
  if (batchIds.length === 0 || sourceFiles.length === 0) {
    throw new Error('生成优化建议被阻断：缺少可绑定的当前数据批次或真实报表 source_file。');
  }
  return {
    scope: { ...scope, batchId },
    pipeline,
    metricSource: { batchId, batchIds, sourceFiles },
  };
}

function handleGetBusinessKeywordOpportunities(input: unknown): BusinessKeywordOpportunityRow[] {
  const gate = getBusinessRecommendationGate(input, 'keyword-opportunities');
  const { sql, params } = businessMetricsWhere(gate.scope, gate.metricSource);
  if (!state.db) return [];
  const rows = state.db.prepare(`
    SELECT
      COALESCE(asin, '') AS asin,
      COALESCE(portfolio_name, '') AS portfolioName,
      COALESCE(campaign_name, '') AS campaignName,
      COALESCE(ad_group_name, '') AS adGroupName,
      COALESCE(report_type, '') AS entityType,
      COALESCE(NULLIF(search_term, ''), NULLIF(targeting, ''), NULLIF(match_type, ''), '') AS keyword,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(orders), 0) AS orders,
      COALESCE(SUM(cost), 0) AS spend,
      COALESCE(SUM(sales), 0) AS sales,
      COALESCE(MAX(source_file), '') AS sourceFile
    FROM ad_daily_metrics
    WHERE ${sql}
    GROUP BY asin, portfolio_name, campaign_name, ad_group_name, report_type, keyword
    HAVING keyword <> ''
    ORDER BY spend DESC, clicks DESC
    LIMIT 200
  `).all(...params) as Array<{
    asin?: string;
    portfolioName?: string;
    campaignName?: string;
    adGroupName?: string;
    entityType?: string;
    keyword?: string;
    clicks?: number;
    orders?: number;
    spend?: number;
    sales?: number;
    sourceFile?: string;
  }>;

  const deduped = new Map<string, BusinessKeywordOpportunityRow>();
  for (const row of rows) {
    const clicks = Number(row.clicks || 0);
    const orders = Number(row.orders || 0);
    const spend = Number(row.spend || 0);
    const sales = Number(row.sales || 0);
    const acos = sales > 0 ? spend / sales : 0;
    const key = [
      gate.scope.storeName,
      gate.scope.marketplaceCode,
      row.asin || '',
      row.campaignName || '',
      row.adGroupName || '',
      row.entityType || '',
      (row.keyword || '').trim().toLowerCase(),
    ].join('|');
    if (deduped.has(key)) continue;
    const waste = spend > 0 && orders === 0;
    const converting = orders > 0 || sales > 0;
    deduped.set(key, {
      asin: row.asin || undefined,
      portfolioName: row.portfolioName || undefined,
      campaignName: row.campaignName || undefined,
      adGroupName: row.adGroupName || undefined,
      entityType: row.entityType || 'keyword',
      keyword: row.keyword || '-',
      coverageStatus: '待 Listing 覆盖核对',
      clicks,
      orders,
      spend,
      sales,
      acos,
      opportunityLevel: converting ? 'high' : waste ? 'medium' : 'low',
      recommendedPlacement: converting ? '优先进入标题/五点或精准词库' : waste ? '先否定或降价后再观察' : '保留观察',
      risk: waste ? '花费无订单，避免直接扩量' : '需结合 Listing 相关性复核',
      sourceFile: row.sourceFile || undefined,
    });
  }

  return Array.from(deduped.values());
}

function handleGetBusinessUiDataPipeline(input: unknown) {
  const scope = normalizeBusinessUiScope(input);
  const batchResult = loadLatestBusinessBatch(scope);
  const availableBatches = loadBusinessBatchesForScope(scope).map((item) => summarizeBusinessBatchOption(scope, item));
  const files = batchResult?.files || [];
  const reportFileIndexByKey = new Map<string, ReportFileRecord>();
  const indexBatchIds = Array.from(new Set([
    batchResult?.batch.id,
    ...(batchResult?.sourceBatchIds || []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)));
  for (const batchId of indexBatchIds) {
    const indexedFiles = state.reportFileRepo?.findForStore(scope.storeId, { batchId, limit: 5000 }) || [];
    for (const indexedFile of indexedFiles) {
      reportFileIndexByKey.set(reportFileIndexKey(indexedFile.batchId, indexedFile.reportType, indexedFile.filePath), indexedFile);
    }
  }
  const fileBatchForPath = (file: LingxingReportFile): LingxingReportBatch | undefined => {
    const downloadDir = batchResult?.fileDownloadDirs?.[file.id] || batchResult?.batch.downloadDir;
    return batchResult?.batch && downloadDir ? { ...batchResult.batch, downloadDir } : batchResult?.batch;
  };
  const realReportFiles = files
    .filter((file) => isExistingRawReportFile(file, fileBatchForPath(file)))
    .map((file) => {
      const filePath = canonicalizeExistingPath(file.filePath);
      const batchId = file.batchId || batchResult?.batch.id || '';
      const indexedFile = reportFileIndexByKey.get(reportFileIndexKey(batchId, file.reportType, filePath));
      const countedRows = countImportedRowsForFile(scope, filePath, batchId);
      const { importedRows, status } = resolveBusinessReportImportState({
        fileStatus: file.status,
        indexedStatus: indexedFile?.status,
        countedMetricRows: countedRows,
      });
      return {
        id: file.id,
        batchId,
        reportType: file.reportType,
        displayName: file.displayName,
        status,
        filePath,
        folderPath: path.dirname(filePath),
        fileName: path.basename(filePath),
        fileSizeBytes: fs.statSync(filePath).size,
        importedRows,
        fileHash: indexedFile?.fileHash || undefined,
        importError: indexedFile?.importError || undefined,
        lastImportedAt: indexedFile?.lastImportedAt || undefined,
        updatedAt: indexedFile?.updatedAt || file.updatedAt,
      };
    });
  const realReportSourceFiles = Array.from(new Set(realReportFiles.flatMap((file) => metricSourceFileCandidates(file.filePath))));
  const realReportBatchIds = Array.from(new Set(
    realReportFiles
      .map((file) => file.batchId || batchResult?.batch.id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ));
  const metricSource: BusinessMetricSource | undefined = batchResult && !batchResult.scopeMismatch?.length && realReportSourceFiles.length > 0
    ? { batchId: batchResult.batch.id, batchIds: realReportBatchIds, sourceFiles: realReportSourceFiles }
    : undefined;

  const reportCoverage = summarizeBusinessReportCoverage({
    expectedTypes: LINGXING_AD_REPORTS.map((report) => report.type),
    realReportFiles,
  });
  const latestFileByType = new Map<string, (typeof realReportFiles)[number]>();
  for (const file of realReportFiles) {
    if (!latestFileByType.has(file.reportType)) latestFileByType.set(file.reportType, file);
  }

  const reportOptions = LINGXING_AD_REPORTS.map((report) => {
    const file = latestFileByType.get(report.type);
    return {
      type: report.type,
      label: report.displayName,
      status: file?.status || 'missing',
      realFileAvailable: !reportCoverage.missingReportTypes.includes(report.type),
      importedRows: reportCoverage.importedRowsByType.get(report.type) || 0,
    };
  });
  const fileAuditRecords = files.map((file) => {
    const filePath = file.filePath ? path.resolve(file.filePath) : '';
    const extension = filePath ? path.extname(filePath).toLowerCase() : '';
    let exists = false;
    try {
      exists = Boolean(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      exists = false;
    }
    const realReport = Boolean(filePath) && isExistingRawReportFile(file, fileBatchForPath(file));
    return {
      status: file.status,
      extension,
      exists,
      realReport,
      evidenceLike: exists && !realReport && isRejectedEvidenceLikePath(filePath),
    };
  });
  const importedRowCount = reportOptions.reduce((sum, item) => sum + item.importedRows, 0);
  const missingReportLabels = reportOptions
    .filter((item) => !item.realFileAvailable)
    .map((item) => item.label);

  const quant = loadBusinessQuantSummary(scope, reportCoverage.realReportFileCount, metricSource);
  const operationEventsInRange = state.operationEventRepo?.findByScopeForStore(scope.storeId, {
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    marketplaceCode: scope.marketplaceCode,
    limit: 300,
  }) || [];
  const operationEvents = filterBusinessPipelineOperationEvents({
    scopeAsin: scope.asin,
    events: operationEventsInRange,
  });
  const productContexts = loadProductStrategyContexts(scope);
  const productHistoryMetrics = metricSource
    ? loadBusinessCanonicalMetrics(scope, metricSource, 5000)
    : [];
  const productHistoryLedgers = buildAdProductHistoryLedger({
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId || batchResult?.batch.id,
    },
    metrics: productHistoryMetrics,
    operationEvents,
    productContexts,
  });
  const blockers = Array.from(new Set([
    ...(batchResult?.scopeMismatch?.length ? ['数据批次与当前运营范围不一致，已阻断文件和指标展示。', ...batchResult.scopeMismatch] : []),
    ...(!batchResult ? ['当前范围没有匹配的数据批次。'] : []),
    ...(reportCoverage.realReportFileCount === 0 ? ['当前范围还没有可量化的真实广告数据'] : []),
    ...(quant.importedRows === 0 ? ['当前范围没有导入广告指标行，广告量化保持阻断。'] : []),
  ]));

  const evidencePaths = [
    ...(batchResult?.batch.downloadDir ? [{ label: '下载文件夹', path: batchResult.batch.downloadDir, kind: 'folder' as const }] : []),
    ...(batchResult?.batch.manifestPath ? [{ label: '采集 Manifest', path: batchResult.batch.manifestPath, kind: 'audit' as const }] : []),
    ...realReportFiles.slice(0, 8).map((file) => ({ label: file.displayName, path: file.filePath, kind: 'file' as const })),
  ];

  return {
    scope: {
      storeId: scope.storeId,
      storeContext: scope.storeContext,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
      currency: 'USD' as const,
    },
    generatedAt: new Date().toISOString(),
    collection: {
      status: reportCoverage.statusWithImportedRows(quant.importedRows),
      latestBatch: batchResult?.batch ? {
        id: batchResult.batch.id,
        status: batchResult.batch.status,
        dateStart: batchResult.batch.dateStart,
        dateEnd: batchResult.batch.dateEnd,
        storeName: batchResult.batch.storeName,
        marketplaceCode: batchResult.batch.marketplaceCode,
        downloadDir: batchResult.batch.downloadDir,
        manifestPath: batchResult.batch.manifestPath,
        completedAt: batchResult.batch.completedAt,
      } : null,
      sourceBatchIds: batchResult?.sourceBatchIds || (batchResult?.batch.id ? [batchResult.batch.id] : []),
      availableBatches,
      reportOptions,
      realReportFiles,
      evidencePaths,
      fileAudit: {
        totalFileRecords: files.length,
        downloadedFileRecords: fileAuditRecords.filter((file) => file.status === 'downloaded' && file.realReport).length,
        existingFileRecords: fileAuditRecords.filter((file) => file.exists).length,
        realReportFileCount: reportCoverage.realReportFileCount,
        importedRowCount,
        rejectedEvidenceFileCount: fileAuditRecords.filter((file) => file.evidenceLike).length,
        missingReportLabels,
        downloadDir: batchResult?.batch.downloadDir,
        manifestPath: batchResult?.batch.manifestPath,
      },
      blockers,
      audit: {
        databaseReady: Boolean(state.db),
        acceptedExtensions: Array.from(BUSINESS_REAL_REPORT_EXTENSIONS),
        rejectedEvidenceExtensions: BUSINESS_REJECTED_EVIDENCE_EXTENSIONS,
        notes: [
          '只读读取 lingxing_report_batches、lingxing_report_files 和 ad_daily_metrics。',
          '广告量化指标必须绑定当前数据批次 batch_id，旧导入数据仅允许通过当前真实报表 source_file 回退匹配。',
          '手动输入的数据批次必须与当前日期、店铺和站点一致，否则整条数据管道阻断。',
          '只有存在于磁盘的 .xlsx/.xls/.csv filePath 计为真实原始报表文件。',
          '审计 JSON、PNG 截图、HTML/DOM 快照和 Trace 不计为真实报表文件。',
          ...(batchResult?.scopeMismatch?.length ? batchResult.scopeMismatch : []),
        ],
      },
    },
    quant,
    operations: {
      events: operationEvents,
      eventCount: operationEvents.length,
      notes: [
        '运营事件用于解释广告波动和 AI 阶段诊断，例如 Coupon、BD、价格、Listing、库存和站外推广。',
        '当前版本由运营手动维护事件；后续可接入领星/亚马逊活动、价格和库存自动读取。',
      ],
    },
    productContext: {
      products: productContexts,
      productCount: productContexts.length,
      notes: [
        '产品配置用于给 AI 提供推广阶段、成本结构、最低价、目标净利率、目标 ACOS 和目标 TACOS。',
        '未配置产品时，AI 仍可分析广告数据，但动态阈值不会包含利润空间约束。',
      ],
    },
    productHistory: {
      ledgers: productHistoryLedgers,
      ledgerCount: productHistoryLedgers.length,
      notes: [
        '产品广告历史账本按当前运营范围、真实报表批次和 source_file 生成，保留日级广告事实。',
        'AI 阶段判断和动态阈值会优先参考这份按 ASIN 聚合的每日历史，而不是只看周期汇总。',
      ],
    },
  };
}

function assertBatchContainsRealReportFiles(
  result: { batch: LingxingReportBatch; files: LingxingReportFile[] },
  actionLabel: string,
): void {
  const realFiles = result.files.filter((file) => isExistingRawReportFile(file, result.batch));
  if (realFiles.length > 0) return;

  const failureReasons = result.files
    .filter((file) => file.status === 'failed' || file.errorMessage)
    .map((file) => `${file.displayName || file.reportType}: ${file.errorMessage || '未拿到真实报表文件'}`)
    .slice(0, 5);
  const detail = failureReasons.length ? `失败原因：${failureReasons.join('；')}` : '没有任何 .xlsx/.xls/.csv 原始报表落盘。';
  throw new Error(`${actionLabel}未完成：当前动作没有拿到真实领星广告表格。${detail}`);
}

function lingxingCollectionCancellationKey(input: {
  storeId: string;
  requestId?: string;
  jobId?: string;
}): string[] {
  return [
    input.requestId ? `request:${input.storeId}:${input.requestId}` : undefined,
    input.jobId ? `job:${input.storeId}:${input.jobId}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

function authorizedLingxingCollectionTarget(
  submittedContext: StoreContextEnvelope,
): { context: StoreContextEnvelope; store: StoreRecord; target: { marketplaceCode: 'US'; storeId: string; storeName: string } } {
  if (!state.storeCoordinator || !state.storeRepo) {
    throw new Error('店铺会话协调器尚未就绪。');
  }
  const context = state.storeCoordinator.assertActiveStoreContext(submittedContext);
  const store = state.storeRepo.getStore(context.storeId);
  if (!store || store.status !== 'active') {
    throw new Error('当前店铺不存在或已停用，领星操作已拒绝。');
  }
  const connection = state.storeRepo.getConnection(context.storeId, 'lingxing');
  if (!connection) {
    throw new Error('当前店铺尚未配置领星连接，仅领星采集被阻断。');
  }
  const targetStoreName = connection.externalAccountId?.trim();
  if (!targetStoreName) {
    throw new Error('当前店铺的领星连接缺少 externalAccountId 店铺映射，仅领星采集被阻断。');
  }
  return {
    context,
    store,
    target: {
      marketplaceCode: 'US',
      storeId: context.storeId,
      storeName: targetStoreName,
    },
  };
}

function projectBusinessReportFileForRenderer(storeId: string, file: any) {
  const fileArtifact = issueRendererArtifact(
    storeId,
    file.filePath,
    'report-file',
    file.fileName || file.displayName,
  );
  const folderArtifact = issueRendererArtifact(
    storeId,
    file.folderPath || (file.filePath ? path.dirname(file.filePath) : undefined),
    'report-folder',
    '原始报表目录',
  );
  return {
    id: String(file.id || ''),
    ...(file.batchId ? { batchId: String(file.batchId) } : {}),
    reportType: String(file.reportType || ''),
    displayName: String(file.displayName || file.reportType || '原始报表'),
    status: String(file.status || 'missing'),
    fileName: String(file.fileName || (file.filePath ? path.basename(file.filePath) : '')),
    fileExtension: String(path.extname(file.fileName || file.filePath || '')).toLowerCase(),
    fileSizeBytes: Number(file.fileSizeBytes || 0),
    importedRows: Number(file.importedRows || 0),
    ...(file.fileHash ? { fileHash: String(file.fileHash) } : {}),
    ...(file.importError ? { importError: rendererSafeDetail(file.importError) } : {}),
    ...(file.lastImportedAt ? { lastImportedAt: String(file.lastImportedAt) } : {}),
    ...(file.updatedAt ? { updatedAt: String(file.updatedAt) } : {}),
    ...(fileArtifact ? {
      artifactId: fileArtifact.artifactId,
      sourceArtifactId: fileArtifact.artifactId,
      artifactDisplayName: fileArtifact.displayName,
    } : {}),
    ...(folderArtifact ? {
      folderArtifactId: folderArtifact.artifactId,
      folderDisplayName: folderArtifact.displayName,
    } : {}),
  };
}

function projectBusinessBatchForRenderer(storeId: string, batch: any) {
  if (!batch) return null;
  const downloadArtifact = issueRendererArtifact(storeId, batch.downloadDir, 'report-folder', '原始报表目录');
  const manifestArtifact = issueRendererArtifact(storeId, batch.manifestPath, 'manifest', '采集清单');
  return {
    id: String(batch.id || ''),
    status: String(batch.status || ''),
    dateStart: String(batch.dateStart || ''),
    dateEnd: String(batch.dateEnd || ''),
    ...(batch.storeName ? { storeName: String(batch.storeName) } : {}),
    ...(batch.marketplaceCode ? { marketplaceCode: String(batch.marketplaceCode) } : {}),
    ...(batch.createdAt ? { createdAt: String(batch.createdAt) } : {}),
    ...(batch.completedAt ? { completedAt: String(batch.completedAt) } : {}),
    ...(downloadArtifact ? {
      downloadArtifactId: downloadArtifact.artifactId,
      downloadDisplayName: downloadArtifact.displayName,
    } : {}),
    ...(manifestArtifact ? {
      manifestArtifactId: manifestArtifact.artifactId,
      manifestDisplayName: manifestArtifact.displayName,
    } : {}),
  };
}

function projectBusinessBatchOptionForRenderer(storeId: string, batch: any) {
  const safeBatch = projectBusinessBatchForRenderer(storeId, batch)!;
  return {
    ...safeBatch,
    totalFileRecords: Number(batch.totalFileRecords || 0),
    realReportFileCount: Number(batch.realReportFileCount || 0),
    importedReportTypeCount: Number(batch.importedReportTypeCount || 0),
    importedRowCount: Number(batch.importedRowCount || 0),
    missingReportLabels: Array.isArray(batch.missingReportLabels)
      ? batch.missingReportLabels.map((item: unknown) => String(item))
      : [],
  };
}

function projectBusinessPipelineForRenderer(pipeline: any) {
  const storeId = String(pipeline?.scope?.storeId || pipeline?.scope?.storeContext?.storeId || '');
  if (!storeId) throw new Error('业务数据投影缺少当前店铺权威。');
  const collection = pipeline?.collection || {};
  const realReportFiles = Array.isArray(collection.realReportFiles)
    ? collection.realReportFiles.map((file: any) => projectBusinessReportFileForRenderer(storeId, file))
    : [];
  const evidenceArtifacts = (Array.isArray(collection.evidencePaths) ? collection.evidencePaths : [])
    .map((item: any) => {
      const artifactKind: MainArtifactKind = item.kind === 'folder'
        ? 'report-folder'
        : item.kind === 'file'
          ? 'report-file'
          : 'manifest';
      const artifact = issueRendererArtifact(storeId, item.path, artifactKind, String(item.label || '本地证据'));
      return artifact ? {
        label: String(item.label || artifact.displayName),
        artifactId: artifact.artifactId,
        displayName: artifact.displayName,
        kind: item.kind === 'folder' || item.kind === 'file' ? item.kind : 'audit',
      } : undefined;
    })
    .filter(Boolean);
  const latestBatch = projectBusinessBatchForRenderer(storeId, collection.latestBatch);
  const safeOperationEvents = Array.isArray(pipeline?.operations?.events)
    ? pipeline.operations.events.map(projectBusinessOperationEventForRenderer)
    : [];
  const safeProductHistoryLedgers = Array.isArray(pipeline?.productHistory?.ledgers)
    ? pipeline.productHistory.ledgers.map((ledger: any) => ({
        ...ledger,
        events: Array.isArray(ledger?.events)
          ? ledger.events.map(projectBusinessOperationEventForRenderer)
          : [],
      }))
    : [];
  const safe = {
    ...pipeline,
    operations: {
      ...pipeline.operations,
      events: safeOperationEvents,
      eventCount: safeOperationEvents.length,
    },
    productHistory: {
      ...pipeline.productHistory,
      ledgers: safeProductHistoryLedgers,
      ledgerCount: safeProductHistoryLedgers.length,
    },
    collection: {
      status: collection.status,
      latestBatch,
      sourceBatchIds: Array.isArray(collection.sourceBatchIds) ? [...collection.sourceBatchIds] : [],
      availableBatches: Array.isArray(collection.availableBatches)
        ? collection.availableBatches.map((batch: any) => projectBusinessBatchOptionForRenderer(storeId, batch))
        : [],
      reportOptions: Array.isArray(collection.reportOptions) ? collection.reportOptions : [],
      realReportFiles,
      evidenceArtifacts,
      fileAudit: {
        totalFileRecords: Number(collection.fileAudit?.totalFileRecords || 0),
        downloadedFileRecords: Number(collection.fileAudit?.downloadedFileRecords || 0),
        existingFileRecords: Number(collection.fileAudit?.existingFileRecords || 0),
        realReportFileCount: Number(collection.fileAudit?.realReportFileCount || 0),
        importedRowCount: Number(collection.fileAudit?.importedRowCount || 0),
        rejectedEvidenceFileCount: Number(collection.fileAudit?.rejectedEvidenceFileCount || 0),
        missingReportLabels: Array.isArray(collection.fileAudit?.missingReportLabels)
          ? collection.fileAudit.missingReportLabels.map((item: unknown) => String(item))
          : [],
        ...(latestBatch?.downloadArtifactId ? {
          downloadArtifactId: latestBatch.downloadArtifactId,
          downloadDisplayName: latestBatch.downloadDisplayName,
        } : {}),
        ...(latestBatch?.manifestArtifactId ? {
          manifestArtifactId: latestBatch.manifestArtifactId,
          manifestDisplayName: latestBatch.manifestDisplayName,
        } : {}),
      },
      blockers: Array.isArray(collection.blockers) ? collection.blockers.map((item: unknown) => rendererSafeDetail(item) || '') : [],
      audit: {
        ...collection.audit,
        notes: [
          '只读读取当前店铺的报表批次、报表文件和广告指标。',
          '广告量化指标必须绑定当前数据批次；旧导入数据只允许由 Main 按当前真实报表来源回退匹配。',
          '手动输入的数据批次必须与当前日期、店铺和站点一致，否则整条数据管道阻断。',
          '只有 Main 已校验存在的 xlsx/xls/csv 原始报表计为真实文件。',
          '审计 JSON、PNG 截图、HTML/DOM 快照和 Trace 不计为真实报表文件。',
        ],
      },
    },
  };
  return rendererPayload(safe);
}

function initializeLingxingCollectionCoordinator(): void {
  if (!state.storeCoordinator || !state.storeRepo || !state.lingxingImportRepo) {
    throw new Error('店铺级领星采集依赖尚未初始化。');
  }
  const operations = new CollectionOperationGuard({
    leases: browserOperationLeases,
    assertActiveContext: (context) => state.storeCoordinator!.assertActiveStoreContext(context),
  });
  state.lingxingCollectionOperations = operations;
  state.lingxingCollectionCoordinator = new LingxingCollectionCoordinator({
    authority: state.storeCoordinator,
    operations,
    resolveRuntime(context, options) {
      const authorized = authorizedLingxingCollectionTarget(context);
      const activeContext = authorized.context;
      const browserRuntime = state.browserRuntime;
      assertVisibleLingxingCollectionSession(activeContext);
      if (!browserRuntime) throw new Error('请先为当前店铺启动并登录独立的领星 ERP 浏览器。');
      const capsule = storeCapsuleFor(authorized.store);
      return {
        automation: createDownloadCenterAutomation(
          browserRuntime.controllers.lingxing,
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
      if (
        !state.browserRuntime
        || missionControlContextKey(state.browserRuntime.context) !== missionControlContextKey(context)
      ) {
        throw new Error('当前店铺浏览器会话已变化，本次采集已停止。');
      }
    },
    clearCancellation: ({ jobId, requestId, storeId }) => {
      for (const key of lingxingCollectionCancellationKey({ jobId, requestId, storeId })) {
        cancelledLingxingCollectionRequests.delete(key);
      }
    },
    persistence: {
      persistProgress(event) {
        state.lingxingImportRepo!.upsertCollectionProgressForStore(
          event.job.request.storeContext.storeId,
          event,
        );
      },
      persistResult(result) {
        const context = state.storeCoordinator!.assertActiveStoreContext(
          result.job.request.storeContext,
        );
        const store = state.storeRepo!.getStore(context.storeId);
        if (!store || store.status !== 'active') {
          throw new Error('采集结果所属店铺不存在或已停用，拒绝持久化。');
        }
        state.lingxingImportRepo!.commitCollectionTerminalForStore(context.storeId, {
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
        state.lingxingImportRepo!.upsertCollectionJobSnapshotForStore(
          job.request.storeContext.storeId,
          job,
        );
      },
    },
    importResult: (result) => {
      const summary = importStoreScopedLingxingDownloadedReportMetrics(result);
      if (summary.errors.length > 0 || summary.parsedFiles <= 0 || !summary.importRunId) {
        const detail = summary.errors.map((error) => error.message).join('；')
          || '真实报表未形成可提交的逐文件导入凭证。';
        throw new Error(`LINGXING_COLLECTION_IMPORT_FAILED: ${detail}`);
      }
      return summary;
    },
    publishProgress: (event) => {
      mainWindow?.webContents.send('lingxing-collection:progress', rendererPayload(event));
    },
    isCancelled: ({ jobId, requestId, storeId }) => lingxingCollectionCancellationKey({
      jobId,
      requestId,
      storeId,
    }).some((key) => cancelledLingxingCollectionRequests.has(key)),
  });
}

function initializeStoreCollectionScheduler(): void {
  if (
    !state.storeCoordinator
    || !state.storeRuntimeConfigService
    || !state.settingsRepo
    || !state.storeRepo
    || !state.lingxingCollectionCoordinator
  ) {
    throw new Error('店铺级采集调度依赖尚未初始化。');
  }
  state.storeCollectionScheduler = new StoreCollectionScheduler({
    authority: state.storeCoordinator,
    config: state.storeRuntimeConfigService,
    settings: state.settingsRepo,
    recordCodec: {
      isAvailable: () => electronLoginCredentialCipher.isEncryptionAvailable(),
      seal: (plaintext) => electronLoginCredentialCipher.encrypt(plaintext),
      open: (envelope) => electronLoginCredentialCipher.decrypt(envelope),
    },
    assertVisibleSession(context) {
      assertVisibleLingxingCollectionSession(context);
    },
    cancelActiveCollection({ requestId, storeId }) {
      for (const key of lingxingCollectionCancellationKey({ requestId, storeId })) {
        cancelledLingxingCollectionRequests.add(key);
      }
    },
    startCollection(input) {
      packageUiSchedulerAudit.recordControl('execute', input.storeContext);
      return state.lingxingCollectionCoordinator!.start(input);
    },
    onChanged(projection) {
      mainWindow?.webContents.send('store-collection-scheduler:changed', rendererPayload(projection));
      mainWindow?.webContents.send('business-ui:data-updated');
    },
    onError(error) {
      console.error('[CollectionScheduler] scheduled reconciliation failed:', error);
    },
  });
}

function assertVisibleLingxingCollectionSession(context: StoreContextEnvelope): void {
  if (!state.storeCoordinator || !state.storeRepo) {
    throw new Error('VISIBLE_SESSION_REQUIRED: 店铺会话协调器尚未就绪。');
  }
  const authorized = state.storeCoordinator.assertActiveStoreContext(context);
  const runtime = state.browserRuntime;
  const session = state.storeRepo.getSessionMetadata(authorized.storeId, 'lingxing');
  if (
    !runtime
    || missionControlContextKey(runtime.context) !== missionControlContextKey(authorized)
    || !runtime.controllers.lingxing.getPage()
    || !session
    || session.status !== 'ready'
    || session.browserProfileId !== authorized.browserProfileId
    || session.sessionGeneration !== authorized.sessionGeneration
  ) {
    throw new Error('VISIBLE_SESSION_REQUIRED: 当前激活店铺的领星可见会话/Profile 与 StoreContext generation 不一致。');
  }
}

function buildAuthoritativeMissionControlTodayProjection(contextInput: StoreContextEnvelope) {
  if (!state.storeCoordinator || !state.productRepo || !state.lingxingImportRepo || !state.db) {
    throw new Error('MISSION_CONTROL_TODAY_DEPENDENCIES_UNAVAILABLE');
  }
  const context = state.storeCoordinator.assertActiveStoreContext(contextInput);
  const collectionJobs = state.lingxingImportRepo.listCollectionJobsForStore(context.storeId, 100);
  const latestCollectionWindow = selectLatestMissionControlCollectionWindow(collectionJobs, context);
  const lineageBatchIds = latestCollectionWindow?.jobs.map((job) => job.jobId) ?? [];
  const metricFacts = latestCollectionWindow && lineageBatchIds.length > 0
    ? state.db.prepare(`
      SELECT COUNT(*) AS rowCount, MAX(date) AS latestMetricDate
      FROM ad_daily_metrics
      WHERE store_id = ?
        AND batch_id IN (${lineageBatchIds.map(() => '?').join(', ')})
        AND date >= ? AND date <= ?
        AND upper(trim(marketplace_code)) = 'US'
        AND upper(trim(currency)) = 'USD'
    `).get(
      context.storeId,
      ...lineageBatchIds,
      latestCollectionWindow.dateStart,
      latestCollectionWindow.dateEnd,
    ) as { rowCount: number; latestMetricDate: string | null }
    : { rowCount: 0, latestMetricDate: null };
  const reportImportProofs = latestCollectionWindow && lineageBatchIds.length > 0
    ? state.db.prepare(`
      SELECT
        snapshots.batch_id AS batchId,
        snapshots.report_type AS reportType,
        snapshots.imported_rows AS importedRows,
        snapshots.file_hash AS fileHash,
        snapshots.run_id AS runId
      FROM report_import_file_snapshots snapshots
      INNER JOIN report_import_runs runs
        ON runs.store_id = snapshots.store_id
       AND runs.run_id = snapshots.run_id
       AND runs.batch_id = snapshots.batch_id
      WHERE snapshots.store_id = ?
        AND snapshots.batch_id IN (${lineageBatchIds.map(() => '?').join(', ')})
        AND runs.status = 'completed'
        AND snapshots.report_file_id IS NOT NULL
      ORDER BY snapshots.captured_at DESC, snapshots.snapshot_id DESC
    `).all(context.storeId, ...lineageBatchIds) as Array<{
      batchId: string;
      reportType: LingxingReportType;
      importedRows: number;
      fileHash: string;
      runId: string;
    }>
    : [];
  const eventFacts = state.db.prepare(`
    SELECT COUNT(*) AS rowCount
    FROM operation_events
    WHERE store_id = ? AND event_date = ? AND archived_at IS NULL
  `).get(context.storeId, context.businessDate) as { rowCount: number };
  const browserSessionReady = isProviderBrowserSessionReady(context, 'amazon_ads');
  const projection = buildMissionControlTodayProjection({
    context,
    products: state.productRepo.findAllWithCostsForStore(context.storeId),
    collectionJobs,
    reportImportProofs,
    importedMetricRows: Number(metricFacts.rowCount) || 0,
    ...(metricFacts.latestMetricDate ? { latestMetricDate: metricFacts.latestMetricDate } : {}),
    operationEventsToday: Number(eventFacts.rowCount) || 0,
    browserSessionReady,
  });
  const activeMission = state.missionDomainRepo?.listMissions(context, { includeArchived: false })
    .find((mission) => mission.status === 'active');
  const analysis = activeMission && state.analysisAuthorityService
    ? state.analysisAuthorityService.getMissionAnalysisProjection(context, activeMission.id)
    : null;
  const latestActionBatchId = analysis?.actionBatches[0]?.id;
  const latestProposals = latestActionBatchId
    ? analysis!.proposals.filter((proposal) => proposal.actionBatchId === latestActionBatchId)
    : [];
  return {
    ...projection,
    analysis: {
      ...(activeMission ? { activeMissionId: activeMission.id } : {}),
      evidencePackageCount: analysis?.evidencePackages.length ?? 0,
      proposalCount: latestProposals.length,
      humanEligibleCount: latestProposals.filter((proposal) => proposal.authorization.human.eligible).length,
      policyEligibleCount: latestProposals.filter((proposal) => proposal.authorization.policy.eligible).length,
      ...(analysis?.evidencePackages[0]?.freshUntil
        ? { latestFreshUntil: analysis.evidencePackages[0].freshUntil }
        : {}),
    },
  };
}

async function runAuthorizedLingxingCollection(
  input: unknown,
  options: {
    mode: 'create-and-download' | 'download-existing';
    reportTypes?: readonly LingxingReportType[];
    maxRetries?: number;
    canary?: boolean;
    resumeFrom?: LingxingCollectionResumeState;
    lineage?: StartLingxingCollectionInput['lineage'];
  },
) {
  if (!state.lingxingCollectionCoordinator) {
    throw new Error('店铺级领星采集协调器尚未就绪。');
  }
  const request = normalizeLingxingCollectionRequest(input);
  if (!request.requestId || !request.storeContext) {
    throw new Error('领星采集请求缺少 Main 可复核的 requestId 或 StoreContext。请刷新当前店铺后重试。');
  }
  if (!options.canary && request.requestId.startsWith('canary:')) {
    throw new Error('普通领星采集不得使用系统保留的 canary: requestId 前缀。');
  }
  if (options.canary && !request.requestId.startsWith('canary:')) {
    throw new Error('Canary 采集必须使用 Main 生成的 canary: requestId。');
  }
  const startInput: StartLingxingCollectionInput = {
    requestId: request.requestId,
    storeContext: request.storeContext,
    dateStart: request.start,
    dateEnd: request.end,
    mode: options.mode,
    ...(options.reportTypes ? { reportTypes: options.reportTypes } : {}),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.canary ? { canary: true } : {}),
    ...(options.resumeFrom ? { resumeFrom: options.resumeFrom } : {}),
    ...(options.lineage ? { lineage: options.lineage } : {}),
    appVersion: APP_VERSION,
  };
  return state.lingxingCollectionCoordinator.start(startInput);
}

async function handleCollectLingxingReports(input: unknown) {
  const output = await runAuthorizedLingxingCollection(input, {
    mode: 'create-and-download',
  });
  mainWindow?.webContents.send('business-ui:data-updated');
  return { ...output.result, metricsImport: output.importSummary };
}

function handleImportCurrentBusinessReports(input: unknown) {
  const scope = normalizeBusinessMutationScope(input);
  const batchResult = loadLatestBusinessBatch(scope);
  if (!batchResult) {
    throw new Error('导入被阻断：当前范围没有 completed 数据批次。');
  }
  if (batchResult.scopeMismatch?.length) {
    throw new Error(`导入被阻断：${batchResult.scopeMismatch.join('；')}`);
  }
  const fileBatchForPath = (file: LingxingReportFile): LingxingReportBatch => {
    const downloadDir = batchResult.fileDownloadDirs?.[file.id] || batchResult.batch.downloadDir;
    return { ...batchResult.batch, downloadDir };
  };
  const realReportFiles = batchResult.files.filter((file) => isExistingRawReportFile(file, fileBatchForPath(file)));
  if (realReportFiles.length === 0) {
    throw new Error('导入被阻断：当前范围没有真实 .xlsx/.xls/.csv 原始报表文件。');
  }
  const sourceBatchIds = Array.from(new Set(
    realReportFiles.map((file) => file.batchId || batchResult.batch.id),
  ));
  const importSummaries = sourceBatchIds.map((batchId) => {
    state.storeCoordinator!.assertActiveStoreContext(scope.storeContext);
    const sourceBatch = loadPersistedLingxingBatch(batchId);
    const sourceFiles = sourceBatch.files.filter((file) => isExistingRawReportFile(file, sourceBatch.batch));
    if (sourceFiles.length === 0) {
      throw new Error(`导入被阻断：来源批次 ${batchId} 没有可验证的真实报表文件。`);
    }
    return importStoreScopedLingxingDownloadedReportMetrics({
      batch: sourceBatch.batch,
      files: sourceFiles,
    });
  });
  const metricsImport = {
    inserted: importSummaries.reduce((sum, item) => sum + item.inserted, 0),
    parsedFiles: importSummaries.reduce((sum, item) => sum + item.parsedFiles, 0),
    skippedFiles: importSummaries.reduce((sum, item) => sum + item.skippedFiles, 0),
    deletedExisting: 0,
    deduplicated: importSummaries.length > 0 && importSummaries.every((item) => item.deduplicated),
    importRunIds: importSummaries
      .map((item) => item.importRunId)
      .filter((value): value is string => Boolean(value)),
    errors: importSummaries.flatMap((item) => item.errors),
  };
  return {
    batch: batchResult.batch,
    files: realReportFiles,
    metricsImport,
    pipeline: handleGetBusinessUiDataPipeline({ ...scope, batchId: batchResult.batch.id }),
  };
}

async function handleImportLocalBusinessReportFiles(input: unknown) {
  const scope = normalizeBusinessMutationScope(input);
  if (!mainWindow) {
    throw new Error('本地导入被阻断：主窗口未就绪。');
  }
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: '选择领星原始广告报表',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Lingxing ad report files', extensions: ['xlsx', 'xls', 'csv'] },
    ],
  });
  if (selected.canceled || selected.filePaths.length === 0) {
    return {
      cancelled: true,
      metricsImport: { inserted: 0, parsedFiles: 0, skippedFiles: 0, deletedExisting: 0, errors: [] },
      pipeline: handleGetBusinessUiDataPipeline(scope),
    };
  }
  const context = state.storeCoordinator!.assertActiveStoreContext(scope.storeContext);
  const store = state.storeRepo?.getStore(context.storeId);
  if (!store || store.status !== 'active') {
    throw new Error('本地导入被阻断：当前店铺不存在或已停用。');
  }
  const result = buildLocalBusinessReportBatch(
    scope,
    selected.filePaths,
    storeCapsuleFor(store),
  );
  state.storeCoordinator!.assertActiveStoreContext(context);
  state.lingxingImportRepo!.saveCollectionSnapshotForStore(context.storeId, result);
  const metricsImport = importStoreScopedLingxingDownloadedReportMetrics(result);
  mainWindow.webContents.send('business-ui:data-updated');
  return {
    cancelled: false,
    ...result,
    metricsImport,
    pipeline: handleGetBusinessUiDataPipeline({ ...scope, batchId: result.batch.id }),
  };
}

function handlePreflightLingxingCollection(input: unknown) {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  validateDateRange(dateRange);
  const submittedContext = request.storeContext ?? state.storeCoordinator?.getActiveStoreContext();
  if (!submittedContext) throw new Error('请先选择店铺，再检查领星采集条件。');
  const authorized = authorizedLingxingCollectionTarget(submittedContext);
  const model = readDownloadCenterPageModel();
  const diagnosticEvidenceReadiness = getDownloadCenterDiagnosticEvidenceReadiness(
    model,
    dateRange,
    authorized.target,
  );
  const browserSessionReady = (() => {
    try {
      assertVisibleLingxingCollectionSession(authorized.context);
      return true;
    } catch {
      return false;
    }
  })();
  return buildDownloadCenterCollectionPreflight(model, dateRange, undefined, {
    target: authorized.target,
    diagnosticEvidenceReadiness,
    browserSessionReady,
    browserSessionReason: browserSessionReady ? undefined : '请先启动并登录领星 ERP 浏览器',
  });
}

function assertLingxingCollectionPreflightReady(dateRange: { start: string; end: string }, target: LingxingCollectionTarget = {}): void {
  const preflight = handlePreflightLingxingCollection({ ...dateRange, ...target });
  assertDownloadCenterCollectionPreflightReady(preflight);
}

function handleExportLingxingCollectionPreflight(input: unknown): string {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const submittedContext = request.storeContext ?? state.storeCoordinator?.getActiveStoreContext();
  if (!submittedContext) throw new Error('请先选择店铺，再导出领星采集检查。');
  const authorized = authorizedLingxingCollectionTarget(submittedContext);
  const capsule = storeCapsuleFor(authorized.store);
  const preflight = handlePreflightLingxingCollection(request);
  const model = readDownloadCenterPageModel();
  const diagnostic = preflight.diagnosticEvidenceReadiness.diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(preflight.diagnosticEvidenceReadiness.diagnosticId, dateRange.start, dateRange.end)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(
        model,
        dateRange.start,
        dateRange.end,
        authorized.target,
      );
  const exportDir = path.join(
    capsule.evidenceDir,
    `lingxing_collection_preflight_${safeFileSegment(dateRange.start)}_${safeFileSegment(dateRange.end)}_${Date.now()}`,
  );
  writeLingxingCollectionPreflightEvidenceBundle({
    exportDir,
    preflight,
    model,
    diagnostic,
    directories: {
      screenshotsDir: capsule.screenshotsDir,
      domSnapshotsDir: capsule.evidenceDir,
    },
  });
  return exportDir;
}

async function handleRetryLingxingReport(input: unknown, reportType: LingxingReportType) {
  validateLingxingReportType(reportType);
  const output = await runAuthorizedLingxingCollection(input, {
    mode: 'create-and-download',
    reportTypes: [reportType],
  });
  mainWindow?.webContents.send('business-ui:data-updated');
  return { ...output.result, metricsImport: output.importSummary };
}

async function handleDownloadExistingLingxingReports(input: unknown, reportTypes: LingxingReportType[]) {
  const selectedReportTypes = Array.from(new Set(reportTypes));
  if (selectedReportTypes.length === 0) {
    throw new Error('请至少选择 1 类已创建报表。');
  }
  selectedReportTypes.forEach(validateLingxingReportType);
  const output = await runAuthorizedLingxingCollection(input, {
    mode: 'download-existing',
    reportTypes: selectedReportTypes,
    maxRetries: 0,
  });
  mainWindow?.webContents.send('business-ui:data-updated');
  return { ...output.result, metricsImport: output.importSummary };
}

async function handleRunLingxingCanaryReport(input: unknown, reportType: LingxingReportType) {
  validateLingxingReportType(reportType);
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const originalRequestId = optionalTrimmedString(value.requestId);
  if (!originalRequestId) throw new Error('单报表 canary 缺少有效 requestId。');
  const canaryRequestId = asLingxingCanaryRequestId(originalRequestId);
  const output = await runAuthorizedLingxingCollection({
    ...value,
    requestId: canaryRequestId,
  }, {
    canary: true,
    mode: 'create-and-download',
    reportTypes: [reportType],
    maxRetries: 0,
  });
  assertBatchContainsRealReportFiles(output.result, '单报表 canary');
  mainWindow?.webContents.send('business-ui:data-updated');
  return output.result;
}

function asLingxingCanaryRequestId(requestId: string): string {
  return requestId.startsWith('canary:')
    ? requestId.slice(0, 128)
    : `canary:${requestId.slice(0, 120)}`;
}

function requireCurrentCollectionStoreContext(value: unknown): StoreContextEnvelope {
  if (!state.storeCoordinator) throw new Error('店铺会话协调器尚未就绪。');
  if (!value || typeof value !== 'object') {
    throw new Error('领星采集操作缺少 StoreContext。');
  }
  return state.storeCoordinator.assertActiveStoreContext(value);
}

function handleListLingxingCollectionJobs(input: unknown): LingxingCollectionJobSnapshot[] {
  if (!state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const context = requireCurrentCollectionStoreContext(value.storeContext);
  const requestedLimit = typeof value.limit === 'number' ? value.limit : 30;
  const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)));
  return state.lingxingImportRepo.listCollectionJobsForStore(context.storeId, limit);
}

function handleCancelLingxingCollection(
  input: unknown,
): { cancelled: true; requestId: string; jobId: string } {
  if (!state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const context = requireCurrentCollectionStoreContext(value.storeContext);
  const { requestId, jobId } = bindLingxingCollectionCancellation(
    state.lingxingImportRepo,
    context.storeId,
    { requestId: value.requestId, jobId: value.jobId },
  );
  // A cancellation acknowledgement is a durable boundary. Persist the
  // cancelled terminal before exposing the in-memory runner guard or
  // returning to Renderer. Late runner progress is rejected by the repo's
  // monotonic cancelled-state rule.
  state.lingxingImportRepo.cancelCollectionJobForStore(context.storeId, jobId, {
    requestId,
    completedAt: new Date().toISOString(),
  });
  for (const key of lingxingCollectionCancellationKey({
    storeId: context.storeId,
    requestId,
    jobId,
  })) {
    cancelledLingxingCollectionRequests.add(key);
  }
  return { cancelled: true, requestId, jobId };
}

function validatedDownloadedResumeReportTypes(
  job: LingxingCollectionJobSnapshot,
): LingxingReportType[] {
  if (!state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const snapshot = state.lingxingImportRepo.getCollectionSnapshotForStore(
    job.request.storeContext.storeId,
    job.jobId,
  );
  const downloaded = job.reports
    .filter((checkpoint) => checkpoint.state === 'downloaded')
    .map((checkpoint) => checkpoint.reportType);
  for (const reportType of downloaded) {
    const file = snapshot?.files.find((candidate) => (
      candidate.reportType === reportType
      && candidate.status === 'downloaded'
      && Boolean(candidate.filePath)
    ));
    const definition = LINGXING_AD_REPORTS.find((candidate) => candidate.type === reportType);
    const verification = file?.filePath && snapshot
      ? verifyDownloadedFile(file.filePath, {
          expectedDateRange: {
            start: job.request.dateStart,
            end: job.request.dateEnd,
          },
          expectedDownloadDir: snapshot.batch.downloadDir,
          expectedFilenameKeyword: definition?.expectedFilenameKeyword,
          expectedReportType: reportType,
        })
      : { valid: false, errorMessage: '缺少已下载文件快照' };
    if (!verification.valid) {
      throw new Error(
        `任务 ${job.jobId} 的已下载报表 ${reportType} 无法重新验证：${verification.errorMessage || '未知原因'}。`
        + ' 请先人工核对本地文件，系统不会自动重复下载。',
      );
    }
  }
  return downloaded;
}

function rebindLingxingResumeState(
  job: LingxingCollectionJobSnapshot,
  requestId: string,
  context: StoreContextEnvelope,
): {
  resumeFrom?: LingxingCollectionResumeState;
  reportTypes: LingxingReportType[];
  reused: LingxingReportType[];
  lineage?: StartLingxingCollectionInput['lineage'];
} {
  if (
    job.request.storeContext.storeId !== context.storeId
    || job.request.storeContext.browserProfileId !== context.browserProfileId
  ) {
    throw new Error('历史采集任务不属于当前店铺浏览器 Profile，拒绝恢复。');
  }
  const manualReconciliation = job.reports.find((checkpoint) => (
    checkpoint.state === 'creating' || checkpoint.state === 'create_unknown'
  ));
  if (manualReconciliation) {
    throw new Error(
      `${manualReconciliation.reportType} 的创建结果不确定，必须先在领星下载中心人工核对；系统不会自动恢复或重复创建。`,
    );
  }
  const reused = validatedDownloadedResumeReportTypes(job);
  const reportTypes = job.request.reportTypes.filter((reportType) => !reused.includes(reportType));
  if (reportTypes.length === 0) return { reportTypes: [], reused };

  const resumableReports: LingxingCollectionReportCheckpoint[] = [];
  for (const checkpoint of job.reports) {
    if (!reportTypes.includes(checkpoint.reportType) || !checkpoint.createdReportIdentity) continue;
    resumableReports.push({
      ...checkpoint,
      state: ['ready', 'downloading', 'verifying'].includes(checkpoint.state)
        ? 'ready'
        : 'created',
      updatedAt: new Date().toISOString(),
    });
  }
  const reboundRequest = {
    requestId,
    storeContext: context,
    dateStart: job.request.dateStart,
    dateEnd: job.request.dateEnd,
    mode: job.request.mode,
    reportTypes,
  } as const;
  const fullOriginalRequest = job.request.reportTypes.length === LINGXING_REPORT_TYPE_SET.size
    && job.request.reportTypes.every((reportType) => LINGXING_REPORT_TYPE_SET.has(reportType));
  const sourceLineage = job.lineage ?? (fullOriginalRequest ? {
    lineageId: job.jobId,
    rootJobId: job.jobId,
    expectedReportTypes: [...job.request.reportTypes],
    purpose: 'production_full' as const,
  } : undefined);
  return {
    reportTypes,
    reused,
    ...(sourceLineage ? {
      lineage: {
        ...sourceLineage,
        parentJobId: job.jobId,
        expectedReportTypes: [...sourceLineage.expectedReportTypes],
        purpose: 'resume' as const,
      },
    } : {}),
    resumeFrom: {
      jobId: `resume_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      request: reboundRequest,
      reports: resumableReports,
    },
  };
}

function nextLingxingCollectionSnapshotTimestamp(previous: string): string {
  const previousMs = Date.parse(previous);
  const nextMs = Number.isFinite(previousMs)
    ? Math.max(Date.now(), previousMs + 1)
    : Date.now();
  return new Date(nextMs).toISOString();
}

function persistLingxingCollectionImportState(
  job: LingxingCollectionJobSnapshot,
  importState: LingxingCollectionImportState,
  options: {
    attemptedAt?: string;
    completedAt?: string;
    error?: string;
  } = {},
): LingxingCollectionJobSnapshot {
  if (!state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const {
    importState: _previousImportState,
    importAttemptedAt: _previousImportAttemptedAt,
    importCompletedAt: _previousImportCompletedAt,
    importError: _previousImportError,
    ...base
  } = job;
  const updatedAt = nextLingxingCollectionSnapshotTimestamp(job.updatedAt);
  const next: LingxingCollectionJobSnapshot = {
    ...base,
    importState,
    updatedAt,
    ...(options.attemptedAt ? { importAttemptedAt: options.attemptedAt } : {}),
    ...(options.completedAt ? { importCompletedAt: options.completedAt } : {}),
    ...(options.error ? { importError: options.error } : {}),
  };
  const persisted = state.lingxingImportRepo.upsertCollectionProgressForStore(
    next.request.storeContext.storeId,
    {
      eventId: `${next.jobId}:import-recovery:${importState}`,
      emittedAt: updatedAt,
      job: next,
    },
  );
  try {
    state.storeCoordinator?.assertActiveStoreContext(persisted.request.storeContext);
    mainWindow?.webContents.send('lingxing-collection:progress', rendererPayload({
      eventId: `${persisted.jobId}:import-recovery:${importState}`,
      emittedAt: persisted.updatedAt,
      job: persisted,
    } satisfies LingxingCollectionProgressEvent));
  } catch {
    // The import state is durable; never leak a previous store's recovery event
    // into a workspace selected while recovery was finishing.
  }
  return persisted;
}

function recoverCompletedLingxingCollectionImport(
  job: LingxingCollectionJobSnapshot,
  context: StoreContextEnvelope,
  options: { requireActiveContext?: boolean } = {},
) {
  if (!state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  if (job.state !== 'completed' && job.state !== 'completed_with_errors') {
    throw new Error(`任务 ${job.jobId} 的下载终态为 ${job.state}，不能直接补导。`);
  }
  if (job.reports.some((checkpoint) => checkpoint.state === 'create_unknown')) {
    throw new Error('任务存在 create_unknown，必须先在领星下载中心人工核对，禁止自动补导。');
  }
  const snapshot = state.lingxingImportRepo.getCollectionSnapshotForStore(context.storeId, job.jobId);
  if (!snapshot) throw new Error(`任务 ${job.jobId} 缺少店铺级下载批次快照，无法补导。`);

  const runId = `import_${job.jobId}`;
  const existing = state.lingxingImportRepo.getImportRunForStore(context.storeId, runId);
  if (existing) {
    if (job.importState === 'succeeded') {
      return {
        job,
        importRecovered: false,
        metricsImport: {
          inserted: existing.metricRowCount,
          parsedFiles: existing.sourceFileCount,
          skippedFiles: 0,
          deletedExisting: 0,
          deduplicated: true,
          importRunId: existing.runId,
          errors: [],
        },
      };
    }
    const completedAt = nextLingxingCollectionSnapshotTimestamp(job.updatedAt);
    const succeeded = persistLingxingCollectionImportState(job, 'succeeded', {
      attemptedAt: job.importAttemptedAt || existing.startedAt,
      completedAt,
    });
    return {
      job: succeeded,
      importRecovered: true,
      metricsImport: {
        inserted: existing.metricRowCount,
        parsedFiles: existing.sourceFileCount,
        skippedFiles: 0,
        deletedExisting: 0,
        deduplicated: true,
        importRunId: existing.runId,
        errors: [],
      },
    };
  }

  if (options.requireActiveContext !== false) {
    state.storeCoordinator!.assertActiveStoreContext(context);
  }
  const attemptedAt = nextLingxingCollectionSnapshotTimestamp(job.updatedAt);
  let pending = persistLingxingCollectionImportState(job, 'pending', { attemptedAt });
  let metricsImport: ReturnType<typeof importStoreScopedLingxingDownloadedReportMetrics>;
  try {
    metricsImport = importStoreScopedLingxingDownloadedReportMetrics(snapshot);
    if (metricsImport.errors.length > 0 || metricsImport.parsedFiles <= 0 || !metricsImport.importRunId) {
      const detail = metricsImport.errors.map((error) => error.message).join('；')
        || '真实报表未形成可提交的逐文件导入凭证。';
      throw new Error(`LINGXING_COLLECTION_IMPORT_FAILED: ${detail}`);
    }
  } catch (error) {
    const completedAt = nextLingxingCollectionSnapshotTimestamp(pending.updatedAt);
    persistLingxingCollectionImportState(pending, 'failed', {
      attemptedAt,
      completedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const completedAt = nextLingxingCollectionSnapshotTimestamp(pending.updatedAt);
  pending = persistLingxingCollectionImportState(pending, 'succeeded', {
    attemptedAt,
    completedAt,
  });
  mainWindow?.webContents.send('business-ui:data-updated');
  return { job: pending, importRecovered: true, metricsImport };
}

function recoverPendingLingxingCollectionImportsOnStartup(): {
  inspected: number;
  recovered: number;
  failed: number;
} {
  if (!state.lingxingImportRepo || !state.storeRepo) {
    return { inspected: 0, recovered: 0, failed: 0 };
  }
  let inspected = 0;
  let recovered = 0;
  let failed = 0;
  const stores = state.storeRepo.listStores().filter((store) => store.status === 'active');
  for (const store of stores) {
    let cursor: { updatedAt: string; jobId: string } | undefined;
    do {
      const page = state.lingxingImportRepo.listRecoverableCollectionImportsForStore(
        store.storeId,
        {
          limit: 200,
          cursor,
          importStates: ['pending', 'failed'],
        },
      );
      for (const job of page.jobs) {
        inspected += 1;
        try {
          recoverCompletedLingxingCollectionImport(job, job.request.storeContext, {
            requireActiveContext: false,
          });
          recovered += 1;
        } catch (error) {
          failed += 1;
          console.warn('[Lingxing] pending import recovery failed', JSON.stringify({
            storeId: store.storeId,
            jobId: job.jobId,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            blockerCode: 'LINGXING_COLLECTION_IMPORT_RECOVERY_FAILED',
          }));
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  return { inspected, recovered, failed };
}

function recoverInterruptedLingxingCollectionJobsOnStartup(): {
  cancelled: number;
  failedStores: number;
} {
  if (!state.lingxingImportRepo || !state.storeRepo) {
    return { cancelled: 0, failedStores: 0 };
  }
  let cancelled = 0;
  let failedStores = 0;
  const completedAt = new Date().toISOString();
  for (const store of state.storeRepo.listStores({ includeArchived: true })) {
    try {
      cancelled += state.lingxingImportRepo.recoverInterruptedCollectionJobsForStore(
        store.storeId,
        { completedAt },
      ).length;
    } catch (error) {
      failedStores += 1;
      console.warn('[Lingxing] interrupted collection recovery failed', JSON.stringify({
        storeId: store.storeId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        blockerCode: 'LINGXING_COLLECTION_RESTART_RECOVERY_FAILED',
      }));
    }
  }
  return { cancelled, failedStores };
}

function sanitizeLingxingImportSummaryForRenderer(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const summary = value as Record<string, unknown>;
  const finiteCount = (input: unknown) => {
    const count = Number(input);
    return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
  };
  const errors = Array.isArray(summary.errors)
    ? summary.errors.map((error) => {
        const item = error && typeof error === 'object' ? error as Record<string, unknown> : {};
        return {
          reportType: optionalTrimmedString(item.reportType) || 'unknown',
          message: '导入未完成，请在当前店铺的数据采集诊断中查看详情。',
        };
      })
    : [];
  return {
    inserted: finiteCount(summary.inserted),
    parsedFiles: finiteCount(summary.parsedFiles),
    skippedFiles: finiteCount(summary.skippedFiles),
    deletedExisting: finiteCount(summary.deletedExisting),
    deduplicated: summary.deduplicated === true,
    ...(optionalTrimmedString(summary.importRunId)
      ? { importRunId: optionalTrimmedString(summary.importRunId) }
      : {}),
    ...(Array.isArray(summary.importRunIds)
      ? { importRunIds: summary.importRunIds.map(optionalTrimmedString).filter(Boolean) }
      : {}),
    errors,
  };
}

function minimalLingxingCollectionJobForRenderer(job: LingxingCollectionJobSnapshot) {
  return {
    jobId: job.jobId,
    request: {
      requestId: job.request.requestId,
      storeContext: job.request.storeContext,
      dateStart: job.request.dateStart,
      dateEnd: job.request.dateEnd,
      mode: job.request.mode,
      reportTypes: [...job.request.reportTypes],
    },
    state: job.state,
    importState: job.importState,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
  };
}

function projectLingxingReportFileForRenderer(storeId: string, file: LingxingReportFile) {
  const fileArtifact = issueRendererArtifact(
    storeId,
    file.filePath,
    'report-file',
    file.filePath ? path.basename(file.filePath) : file.displayName,
  );
  const folderArtifact = issueRendererArtifact(
    storeId,
    file.filePath ? path.dirname(file.filePath) : undefined,
    'report-folder',
    '原始报表目录',
  );
  const failureArtifacts = [
    issueRendererArtifact(storeId, file.failureScreenshotPath, 'diagnostic-file', '失败截图'),
    issueRendererArtifact(storeId, file.failureDomSnapshotPath, 'diagnostic-file', '失败页面快照'),
    issueRendererArtifact(storeId, file.failureTracePath, 'diagnostic-file', '失败 Trace'),
  ].filter((item): item is RendererArtifactReference => Boolean(item));
  return {
    id: file.id,
    ...(file.batchId ? { batchId: file.batchId } : {}),
    reportType: file.reportType,
    displayName: file.displayName,
    status: file.status,
    maxAutoRetries: Number(file.maxAutoRetries || 0),
    autoRetryCount: Number(file.autoRetryCount || 0),
    fileName: file.filePath ? path.basename(file.filePath) : '',
    fileExtension: file.filePath ? path.extname(file.filePath).toLowerCase() : '',
    fileSizeBytes: Number(file.fileSizeBytes || 0),
    ...(file.errorMessage ? { errorMessage: rendererSafeDetail(file.errorMessage) } : {}),
    ...(file.traceUnavailableReason ? { traceUnavailableReason: String(file.traceUnavailableReason) } : {}),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    ...(fileArtifact ? {
      artifactId: fileArtifact.artifactId,
      artifactDisplayName: fileArtifact.displayName,
    } : {}),
    ...(folderArtifact ? {
      folderArtifactId: folderArtifact.artifactId,
      folderDisplayName: folderArtifact.displayName,
    } : {}),
    ...(failureArtifacts.length > 0 ? { failureArtifacts } : {}),
  };
}

function projectLingxingCollectionResultForRenderer(result: LingxingBatchFilesResult & { job?: LingxingCollectionJobSnapshot }, importSummary?: unknown) {
  const storeId = String(result.batch.storeId || result.job?.request.storeContext.storeId || '');
  if (!storeId) throw new Error('领星采集结果缺少当前店铺权威。');
  return rendererPayload({
    batch: projectBusinessBatchForRenderer(storeId, result.batch),
    files: result.files.map((file) => projectLingxingReportFileForRenderer(storeId, file)),
    ...(result.job ? { job: result.job } : {}),
    ...(importSummary === undefined ? {} : { metricsImport: sanitizeLingxingImportSummaryForRenderer(importSummary) }),
  });
}

function projectBusinessImportResultForRenderer(result: any) {
  const pipeline = projectBusinessPipelineForRenderer(result.pipeline);
  const storeId = String(pipeline?.scope?.storeId || pipeline?.scope?.storeContext?.storeId || '');
  return rendererPayload({
    cancelled: result.cancelled === true,
    ...(result.batch ? { batch: projectBusinessBatchForRenderer(storeId, result.batch) } : {}),
    files: Array.isArray(result.files)
      ? result.files.map((file: LingxingReportFile) => projectLingxingReportFileForRenderer(storeId, file))
      : [],
    metricsImport: sanitizeLingxingImportSummaryForRenderer(result.metricsImport),
    pipeline,
  });
}

function currentArtifactStore(): StoreRecord {
  const context = state.storeCoordinator?.getActiveStoreContext();
  if (!context) throw new Error('请先选择店铺，再访问本地 Artifact。');
  const store = state.storeRepo?.getStore(context.storeId);
  if (!store || store.status !== 'active') throw new Error('当前店铺不存在或已停用。');
  return store;
}

function projectDiagnosticForRenderer(diagnostic: DownloadCenterDiagnosticResult) {
  const store = currentArtifactStore();
  const screenshotArtifact = issueRendererArtifact(
    store.storeId,
    diagnostic.screenshotPath,
    'diagnostic-file',
    '下载中心截图',
  );
  const domArtifact = issueRendererArtifact(
    store.storeId,
    diagnostic.domSnapshotPath,
    'diagnostic-file',
    '下载中心页面快照',
  );
  const {
    screenshotPath: _screenshotPath,
    domSnapshotPath: _domSnapshotPath,
    errorMessage,
    ...safeDiagnostic
  } = diagnostic;
  return rendererPayload({
    ...safeDiagnostic,
    ...(errorMessage ? { errorMessage: rendererSafeDetail(errorMessage) } : {}),
    ...(screenshotArtifact ? {
      screenshotArtifactId: screenshotArtifact.artifactId,
      screenshotDisplayName: screenshotArtifact.displayName,
    } : {}),
    ...(domArtifact ? {
      domArtifactId: domArtifact.artifactId,
      domDisplayName: domArtifact.displayName,
    } : {}),
  });
}

function projectExportArtifactForCurrentStore(
  targetPath: string,
  kind: 'diagnostic-folder' | 'export-folder' | 'export-file',
  displayName: string,
) {
  const store = currentArtifactStore();
  const artifact = issueRendererArtifact(store.storeId, targetPath, kind, displayName);
  if (!artifact) throw new Error('导出已完成，但 Artifact 未通过当前店铺目录校验。');
  return rendererPayload(artifact);
}

async function handleResumeLingxingCollection(input: unknown) {
  if (!state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const context = requireCurrentCollectionStoreContext(value.storeContext);
  const requestId = optionalTrimmedString(value.requestId);
  const jobId = optionalTrimmedString(value.jobId);
  if (!requestId || !jobId) throw new Error('恢复采集需要有效的 requestId 与 jobId。');
  const job = state.lingxingImportRepo.getCollectionJobForStore(context.storeId, jobId);
  if (!job) throw new Error(`当前店铺未找到采集任务：${jobId}`);
  const isCanary = job.request.requestId.startsWith('canary:');
  const reboundRequestId = isCanary ? asLingxingCanaryRequestId(requestId) : requestId;
  const rebound = rebindLingxingResumeState(job, reboundRequestId, context);
  if (!rebound.resumeFrom || rebound.reportTypes.length === 0) {
    if (isCanary) {
      const canaryJob = job.importState === 'not_applicable'
        ? job
        : persistLingxingCollectionImportState(job, 'not_applicable');
      return {
        alreadyComplete: true,
        job: minimalLingxingCollectionJobForRenderer(canaryJob),
        importRecovered: false,
        resumedFromJobId: jobId,
        reusedDownloadedReportTypes: rebound.reused,
      };
    }
    const recovery = recoverCompletedLingxingCollectionImport(job, context);
    return {
      alreadyComplete: true,
      job: minimalLingxingCollectionJobForRenderer(recovery.job),
      importRecovered: recovery.importRecovered,
      metricsImport: sanitizeLingxingImportSummaryForRenderer(recovery.metricsImport),
      resumedFromJobId: jobId,
      reusedDownloadedReportTypes: rebound.reused,
    };
  }
  const output = await runAuthorizedLingxingCollection({
    requestId: reboundRequestId,
    storeContext: context,
    start: job.request.dateStart,
    end: job.request.dateEnd,
  }, {
    ...(isCanary ? { canary: true } : {}),
    mode: job.request.mode,
    reportTypes: rebound.reportTypes,
    resumeFrom: rebound.resumeFrom,
    ...(rebound.lineage ? { lineage: rebound.lineage } : {}),
  });
  mainWindow?.webContents.send('business-ui:data-updated');
  return {
    alreadyComplete: false,
    job: minimalLingxingCollectionJobForRenderer(output.result.job),
    importState: output.result.job.importState,
    metricsImport: sanitizeLingxingImportSummaryForRenderer(output.importSummary),
    resumedFromJobId: jobId,
    reusedDownloadedReportTypes: rebound.reused,
  };
}

const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS = {
  createReportButton: 'a:has-text("创建报告")',
  storeSearchInput: '.el-transfer-panel:has-text("待选店铺") input[placeholder="店铺搜索"]',
  storeOption: '.el-transfer-panel:has-text("待选店铺") label.el-transfer-panel__item:has-text("{storeName}")',
  storeMoveButton: '.el-transfer__buttons button:has(.el-icon-arrow-right)',
  reportSearchInput: 'input[placeholder="报告名称"].el-input__inner',
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

function reportContextKey(report: { type: LingxingReportType }, dateRange: { start: string; end: string }): string {
  return `${report.type}:${dateRange.start}:${dateRange.end}`;
}

async function waitForDownloadCenterListPage(page: NonNullable<ReturnType<BrowserController['getPage']>>): Promise<boolean> {
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText ?? '',
  }));
  return state.url.includes('/ak_download/download_center/download_report_log/index')
    && state.bodyText.includes('下载中心')
    && state.bodyText.includes('创建报告');
}

async function navigateToLingxingDownloadCenter(controller: BrowserController, model: DownloadCenterPageModel): Promise<void> {
  const page = getControllerPageOrThrow(controller);

  // Report collection is authorized by the verified Lingxing ERP session and
  // may follow Lingxing's own SSO into the read-only download center. Real Ads
  // writes still use the separate amazon_ads Profile and its strict runtime
  // gate; this navigation helper must not require or reuse that write session.
  await page.goto(model.candidateUrls[0], { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
  if (await waitForDownloadCenterListPage(page)) return;

  const menuSelectors = [
    'a.fa-download_menu[href="/ak_download/download_center/download_report_log/index"]',
    'a.not-root[href="/ak_download/download_center/download_report_log/index"]',
    'a[href="/ak_download/download_center/download_report_log/index"]:has-text("下载中心")',
  ];
  for (const selector of menuSelectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) continue;
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => undefined),
      locator.click({ timeout: 15000 }),
    ]);
    if (await waitForDownloadCenterListPage(page)) return;
  }

  await page.evaluate(() => {
    window.location.href = '/ak_download/download_center/download_report_log/index';
  });
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => undefined);
  if (await waitForDownloadCenterListPage(page)) return;
  throw new Error(`无法进入领星广告下载中心，当前页面：${await page.title().catch(() => page.url())}`);
}

async function waitForCreateReportPage(page: NonNullable<ReturnType<BrowserController['getPage']>>): Promise<void> {
  await page.waitForURL(/\/ak_download\/download_center\/download_report_log\/create_report/, { timeout: 45000 }).catch(() => undefined);
  const container = page.locator('.create-report-container').first();
  if (await container.isVisible({ timeout: 5000 }).catch(() => false)) return;
  await page.getByText('创建报告', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
}

async function refreshDownloadCenterReportList(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  selectors: DownloadCenterActionSelectors,
): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  let acted = false;

  const refreshSelector = selectors.listRefreshButton || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.listRefreshButton;
  const refreshButton = page.locator(refreshSelector).first();
  if (await refreshButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await refreshButton.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    acted = true;
  }

  const sorted = await ensureDownloadCenterCreateTimeLatestFirst(
    page,
    selectors.createTimeSortHeader || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.createTimeSortHeader,
  );
  acted = acted || sorted;

  if (!acted) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
  }
  await page.waitForTimeout(500);
}

async function ensureDownloadCenterCreateTimeLatestFirst(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  selector: string,
): Promise<boolean> {
  const header = page.locator(selector).first();
  if (!await header.isVisible({ timeout: 1500 }).catch(() => false)) {
    return false;
  }

  let clicked = false;
  let state = await readDownloadCenterSortState(header);
  if (state === 'descending') {
    await header.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(350);
    clicked = true;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    state = await readDownloadCenterSortState(header);
    if (state === 'descending' && clicked) {
      return true;
    }
    await header.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    clicked = true;
    if (state === 'unknown' && attempt >= 1) {
      return true;
    }
  }
  return clicked;
}

async function readDownloadCenterSortState(
  locator: ReturnType<NonNullable<ReturnType<BrowserController['getPage']>>['locator']>,
): Promise<'ascending' | 'descending' | 'unknown'> {
  return locator.evaluate((element) => {
    const target = (element.closest('th,[role="columnheader"],.el-table__cell') || element) as HTMLElement;
    const text = [
      target.className?.toString() || '',
      target.getAttribute('aria-sort') || '',
      target.getAttribute('class') || '',
      target.querySelector('[class*="sort"]')?.getAttribute('class') || '',
    ].join(' ').toLowerCase();
    if (/desc|descending|降序/.test(text)) return 'descending';
    if (/asc|ascending|升序/.test(text)) return 'ascending';
    return 'unknown';
  }).catch(() => 'unknown' as const);
}

function createDownloadCenterAutomation(
  controller: BrowserController,
  target: LingxingCollectionTarget & { marketplaceCode: string; storeId: string; storeName: string },
  options: {
    allowManualVerificationForCanary?: boolean;
    storeCapsule?: StoreCapsulePaths;
  } = {},
): DownloadCenterAutomationPort {
  const model = readDownloadCenterPageModel();
  const automationReadiness = getDownloadCenterAutomationReadiness(
    options.allowManualVerificationForCanary
      ? { ...model, requiresManualVerification: false }
      : model,
  );
  const generatedReportNames = new Map<string, string>();
  let traceStarted = false;
  let traceStartError: string | undefined;

  const reportContext = (
    report: { type: LingxingReportType; displayName: string; expectedFilenameKeyword: string },
    dateRange: { start: string; end: string },
    createdReportIdentity?: LingxingCreatedReportIdentity,
  ): DownloadCenterReportSelectorContext => {
    const key = reportContextKey(report, dateRange);
    if (!generatedReportNames.has(key)) {
      generatedReportNames.set(key, buildGeneratedDownloadCenterReportName(report, dateRange));
    }
    return {
      ...report,
      generatedReportName: createdReportIdentity?.externalReportName ?? generatedReportNames.get(key),
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
    };
  };

  return {
    async navigateToDownloadCenter() {
      await navigateToLingxingDownloadCenter(controller, model);
    },
    async createReport(report, dateRange) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName, target);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      const context = reportContext(report, dateRange);
      if (!context.storeName) {
        throw new Error('启动领星报表采集前必须选择店铺，例如 FT-US-US');
      }

      const createReportButton = await assertUsableDownloadCenterActionSelector(
        page,
        'createReportButton',
        selectors.createReportButton || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.createReportButton,
        context,
        dateRange,
      );
      await page.locator(createReportButton).click();
      await waitForCreateReportPage(page);

      const storeSearchInput = selectors.storeSearchInput || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeSearchInput;
      const storeOptionSelector = selectors.storeOption || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeOption;
      const storeMoveButtonSelector = selectors.storeMoveButton || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeMoveButton;
      const renderedStoreSearchInput = renderDownloadCenterSelector(storeSearchInput, context, dateRange);
      const renderedStoreOption = renderDownloadCenterSelector(storeOptionSelector, context, dateRange);
      const renderedStoreMoveButton = renderDownloadCenterSelector(storeMoveButtonSelector, context, dateRange);
      await page.locator(renderedStoreSearchInput).fill(context.storeName);
      await page.locator(renderedStoreOption).click();
      await page.locator(renderedStoreMoveButton).click();

      const reportSearchInput = await assertUsableDownloadCenterActionSelector(
        page,
        'reportSearchInput',
        selectors.reportSearchInput || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportSearchInput,
        context,
        dateRange,
      );
      await page.locator(reportSearchInput).fill(context.generatedReportName || report.displayName);

      const reportTypeSelect = renderDownloadCenterSelector(
        selectors.reportTypeSelect || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeSelect,
        context,
        dateRange,
      );
      await page.locator(reportTypeSelect).click();
      const reportTypeOption = renderDownloadCenterSelector(
        selectors.reportTypeOption || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeOption,
        context,
        dateRange,
      );
      await page.locator(reportTypeOption).click();

      const dateStartInput = await assertUsableDownloadCenterActionSelector(
        page,
        'dateStartInput',
        selectors.dateStartInput || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dateStartInput,
        context,
        dateRange,
      );
      const dateEndInput = await assertUsableDownloadCenterActionSelector(
        page,
        'dateEndInput',
        selectors.dateEndInput || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dateEndInput,
        context,
        dateRange,
      );
      await fillAndCommitLingxingDateRange(page, {
        startInputSelector: dateStartInput,
        endInputSelector: dateEndInput,
        dateRange,
      });

      const dailyDetailRadio = renderDownloadCenterSelector(
        selectors.dailyDetailRadio || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dailyDetailRadio,
        context,
        dateRange,
      );
      const dailyVisible = await page.locator(dailyDetailRadio).isVisible({ timeout: 5000 }).catch(() => false);
      if (dailyVisible) {
        await page.locator(dailyDetailRadio).click();
      }

      const confirmCreateButton = renderDownloadCenterSelector(
        selectors.confirmCreateButton || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.confirmCreateButton,
        context,
        dateRange,
      );
      await page.locator(confirmCreateButton).waitFor({ state: 'visible', timeout: 15000 });
      await assertUsableDownloadCenterActionSelector(page, 'confirmCreateButton', confirmCreateButton, context, dateRange);
      await page.locator(confirmCreateButton).click();
      await page.getByText('正在创建报告', { exact: false }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
      const okButton = page.locator('.layui-layer-btn0, button:has-text("确定"), a:has-text("确定")').first();
      if (await okButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await okButton.click();
      }
      await navigateToLingxingDownloadCenter(controller, model);
      const createdRow = page.locator('tr').filter({
        hasText: context.generatedReportName || report.displayName,
      }).first();
      await createdRow.waitFor({ state: 'visible', timeout: 30000 });
      return {
        status: 'created',
        identity: {
          provider: 'lingxing',
          reportType: report.type,
          externalReportName: context.generatedReportName || report.displayName,
          dateStart: dateRange.start,
          dateEnd: dateRange.end,
          createdAt: new Date().toISOString(),
        },
      };
    },
    async waitForReportReady(report, dateRange, createdReportIdentity) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName, target);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      const context = reportContext(report, dateRange, createdReportIdentity);
      let lastRecoveryAt = 0;
      const recoverListIfNeeded = async (attempt: number) => {
        const now = Date.now();
        if (attempt > 1 && now - lastRecoveryAt < DOWNLOAD_CENTER_LIST_RECOVERY_INTERVAL_MS) {
          return;
        }
        lastRecoveryAt = now;
        await refreshDownloadCenterReportList(page, selectors);
      };
      await recoverListIfNeeded(0);

      if (selectors.statusTextSelector) {
        await pollReportGenerationStatus(async () => {
          const statusTextSelector = renderDownloadCenterSelector(selectors.statusTextSelector!, context, dateRange);
          const statusLocator = page.locator(statusTextSelector).first();
          if (!await statusLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
            return '';
          }
          return statusLocator.innerText();
        }, {
          intervalMs: 2000,
          timeoutMs: selectors.readyTimeoutMs ?? 300000,
          onPendingSnapshot: async (snapshot) => {
            if (snapshot.status === 'unknown' || snapshot.attempt % 3 === 0) {
              await recoverListIfNeeded(snapshot.attempt);
            }
          },
        });
      } else {
        const readyReportSelector = renderDownloadCenterSelector(selectors.readyReportSelector, context, dateRange);
        await pollReportGenerationStatus(async () => {
          const readyRow = page.locator(readyReportSelector).first();
          return await readyRow.isVisible({ timeout: 2000 }).catch(() => false)
            ? '生成成功，可下载'
            : '生成中';
        }, {
          intervalMs: 2000,
          timeoutMs: selectors.readyTimeoutMs ?? 300000,
          onPendingSnapshot: async (snapshot) => {
            if (snapshot.attempt % 3 === 0) {
              await recoverListIfNeeded(snapshot.attempt);
            }
          },
        });
      }
      await assertUsableDownloadCenterActionSelector(page, 'readyReportSelector', selectors.readyReportSelector, context, dateRange);
    },
    async downloadReport(report, downloadDir, dateRange, createdReportIdentity) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName, target);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      fs.mkdirSync(downloadDir, { recursive: true });
      const context = reportContext(report, dateRange, createdReportIdentity);
      const downloadButton = await assertUsableDownloadCenterActionSelector(page, 'downloadButton', selectors.downloadButton, context, dateRange);

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: selectors.downloadTimeoutMs ?? 120000 }),
        page.locator(downloadButton).click(),
      ]);
      if (!options.storeCapsule) {
        throw new Error('当前领星采集缺少店铺独立下载舱，拒绝保存报表。');
      }
      const targetFile = resolveStoreCapsuleDownloadTarget(
        options.storeCapsule,
        download.suggestedFilename(),
        downloadDir,
      );
      await download.saveAs(targetFile.path);
      return targetFile.path;
    },
    async startAttemptTrace(report, dateRange, attemptIndex) {
      traceStartError = undefined;
      traceStarted = false;
      const context = controller.getContext();
      if (!context) {
        traceStartError = 'Playwright browser context is not available';
        return;
      }
      try {
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true,
          title: `${report.type}_${dateRange.start}_${dateRange.end}_attempt_${attemptIndex}`,
        });
        traceStarted = true;
      } catch (error) {
        traceStartError = error instanceof Error ? error.message : String(error);
      }
    },
    async stopAttemptTrace(report, dateRange, attemptIndex, retain) {
      const context = controller.getContext();
      if (!context || !traceStarted) {
        return undefined;
      }
      try {
        if (!retain) {
          await context.tracing.stop();
          traceStarted = false;
          return undefined;
        }

        const tracePath = buildReportFailureTracePath(
          report.type,
          dateRange,
          attemptIndex,
          options.storeCapsule?.tracesDir,
        );
        await context.tracing.stop({ path: tracePath });
        traceStarted = false;
        return tracePath;
      } catch (error) {
        traceStartError = error instanceof Error ? error.message : String(error);
        traceStarted = false;
        return undefined;
      }
    },
    async captureFailureEvidence(report, dateRange, attemptErrors) {
      return captureReportFailureEvidence(
        controller,
        report.type,
        dateRange,
        attemptErrors,
        traceStartError,
        options.storeCapsule,
      );
    },
  };
}

function buildReportFailureTracePath(
  reportType: LingxingReportType,
  dateRange: { start: string; end: string },
  attemptIndex: number,
  traceDirectory = TRACES_DIR,
): string {
  fs.mkdirSync(traceDirectory, { recursive: true });
  return path.join(
    traceDirectory,
    `report_failure_${reportType}_${dateRange.start}_${dateRange.end}_attempt_${attemptIndex}_${Date.now()}.zip`,
  );
}

function assertDownloadCenterAutomationReady(
  readiness: ReturnType<typeof getDownloadCenterAutomationReadiness>,
  displayName: string,
): void {
  if (readiness.ready) return;
  if (readiness.reason?.includes('action selectors')) {
    throw new Error(`下载中心页面模型动作选择器不完整，无法安全创建或下载：${displayName}。缺失：${readiness.missing.join(', ')}`);
  }
  throw new Error(`下载中心页面模型尚未人工固化，无法安全创建或下载：${displayName}`);
}

function assertDownloadCenterDiagnosticEvidenceReady(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  displayName: string,
  target: LingxingCollectionTarget & { marketplaceCode: string; storeId: string; storeName: string },
): void {
  const evidence = getDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, target);
  if (evidence.ready) return;
  throw new Error(
    `下载中心页面模型缺少同模型、同日期范围、同店铺/站点的近期诊断证据，无法创建或下载：${displayName}。请先运行“验证页面”。${evidence.reason || ''}${evidence.missing.length ? ` 缺失：${evidence.missing.join(', ')}` : ''}`,
  );
}

function getDownloadCenterDiagnosticEvidenceReadiness(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  target: LingxingCollectionTarget & { marketplaceCode: string; storeId: string; storeName: string },
): { ready: boolean; missing: string[]; reason?: string; diagnosticId?: number; checkedAt?: string } {
  if (!state.db) {
    return { ready: false, missing: ['download_center_diagnostics'], reason: 'local database is not available' };
  }
  const activeContext = state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext) {
    return { ready: false, missing: ['activeStoreContext'], reason: 'active store context is not available' };
  }
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  if (
    target.storeName !== authorized.target.storeName
    || target.marketplaceCode !== authorized.target.marketplaceCode
  ) {
    return { ready: false, missing: ['storeAuthority'], reason: 'diagnostic target does not match the active store authority' };
  }
  const capsule = storeCapsuleFor(authorized.store);
  const modelSnapshotJson = JSON.stringify(model);
  const row = state.db.prepare(`
    SELECT
      id,
      ready,
      page_model AS pageModel,
      page_model_snapshot_json AS pageModelSnapshotJson,
      date_start AS dateStart,
      date_end AS dateEnd,
      store_name AS storeName,
      marketplace_code AS marketplaceCode,
      action_selector_checks_json AS actionSelectorChecksJson,
      screenshot_path AS screenshotPath,
      dom_snapshot_path AS domSnapshotPath,
      checked_at AS checkedAt
    FROM download_center_diagnostics
    WHERE store_id = @storeId
      AND page_model = @pageModel
      AND page_model_snapshot_json = @modelSnapshotJson
      AND date_start = @dateStart
      AND date_end = @dateEnd
      AND COALESCE(store_name, '') = COALESCE(@storeName, '')
      AND COALESCE(marketplace_code, '') = COALESCE(@marketplaceCode, '')
    ORDER BY checked_at DESC, id DESC
    LIMIT 1
  `).get({
    storeId: target.storeId,
    pageModel: model.name,
    modelSnapshotJson,
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    storeName: target.storeName ?? '',
    marketplaceCode: target.marketplaceCode ?? '',
  }) as { id: number; ready: number; pageModel?: string; pageModelSnapshotJson?: string; dateStart?: string; dateEnd?: string; storeName?: string; marketplaceCode?: string; actionSelectorChecksJson?: string; screenshotPath?: string; domSnapshotPath?: string; checkedAt?: string } | undefined;

  if (!row) {
    return {
      ready: false,
      missing: ['diagnosticEvidence'],
      reason: 'no matching download-center diagnostic exists for this page model, date range, store, and marketplace',
    };
  }

  const diagnosticReadiness = evaluateDownloadCenterDiagnosticEvidenceReadiness(
    model,
    dateRange,
    {
      id: row.id,
      pageModel: row.pageModel || model.name,
      pageModelSnapshot: parseDownloadCenterPageModelSnapshot(row.pageModelSnapshotJson),
      dateStart: row.dateStart ?? undefined,
      dateEnd: row.dateEnd ?? undefined,
      storeName: row.storeName ?? undefined,
      marketplaceCode: row.marketplaceCode ?? undefined,
      url: '',
      title: '',
      ready: Boolean(row.ready),
      requiresManualVerification: model.requiresManualVerification,
      matchedEntryHints: [],
      matchedReportNames: [],
      selectorChecks: [],
      missingRequiredSelectors: [],
      actionSelectorChecks: parseDiagnosticActionSelectorChecks(row.actionSelectorChecksJson),
      checkedAt: row.checkedAt || '',
    },
    { target },
  );
  const fileReadiness = evaluateDownloadCenterDiagnosticEvidenceFiles(row, {
    screenshotsDir: capsule.screenshotsDir,
    domSnapshotsDir: capsule.evidenceDir,
  });
  const missing = Array.from(new Set([...diagnosticReadiness.missing, ...fileReadiness.missing]));
  return {
    ...diagnosticReadiness,
    ready: diagnosticReadiness.ready && fileReadiness.ready,
    missing,
    reason: diagnosticReadiness.ready ? fileReadiness.reason : diagnosticReadiness.reason,
  };
}

function parseDownloadCenterPageModelSnapshot(jsonText: string | undefined): DownloadCenterPageModel | undefined {
  if (!jsonText) return undefined;
  try {
    return JSON.parse(jsonText) as DownloadCenterPageModel;
  } catch {
    return undefined;
  }
}

function parseDiagnosticActionSelectorChecks(jsonText: string | undefined): DownloadCenterActionSelectorCheck[] {
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed as DownloadCenterActionSelectorCheck[] : [];
  } catch {
    return [];
  }
}

function getControllerPageOrThrow(controller: BrowserController) {
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面尚未初始化');
  }
  return page;
}

interface LingxingCollectionTarget {
  storeName?: string;
  marketplaceCode?: string;
  storeId?: string;
}

interface LingxingCollectionRequest extends LingxingCollectionTarget {
  start: string;
  end: string;
  requestId?: string;
  storeContext?: StoreContextEnvelope;
}

interface DownloadCenterReportSelectorContext {
  type: LingxingReportType;
  displayName: string;
  expectedFilenameKeyword: string;
  generatedReportName?: string;
  storeName?: string;
  marketplaceCode?: string;
}

function normalizeLingxingCollectionRequest(input: unknown): LingxingCollectionRequest {
  const value = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const start = typeof value.start === 'string' ? value.start : '';
  const end = typeof value.end === 'string' ? value.end : '';
  return {
    start,
    end,
    requestId: optionalTrimmedString(value.requestId),
    storeContext: value.storeContext && typeof value.storeContext === 'object'
      ? value.storeContext as StoreContextEnvelope
      : undefined,
    storeName: optionalTrimmedString(value.storeName),
    marketplaceCode: optionalTrimmedString(value.marketplaceCode ?? value.site),
  };
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function safeReportNameSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'report';
}

function buildGeneratedDownloadCenterReportName(
  report: { expectedFilenameKeyword: string },
  dateRange: { start: string; end: string },
): string {
  const start = dateRange.start.replaceAll('-', '');
  const end = dateRange.end.replaceAll('-', '');
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(8, 14);
  const reportToken = safeReportNameSegment(report.expectedFilenameKeyword).slice(0, 24);
  return `AAO_${start}_${end}_${reportToken}_${suffix}`;
}

function renderDownloadCenterSelector(
  selector: string,
  report: DownloadCenterReportSelectorContext,
  dateRange?: { start: string; end: string },
): string {
  return selector
    .replaceAll('{reportType}', report.type)
    .replaceAll('{reportName}', report.displayName)
    .replaceAll('{expectedFilenameKeyword}', report.expectedFilenameKeyword)
    .replaceAll('{generatedReportName}', report.generatedReportName ?? report.displayName)
    .replaceAll('{storeName}', report.storeName ?? '')
    .replaceAll('{marketplaceCode}', report.marketplaceCode ?? '')
    .replaceAll('{dateStart}', dateRange?.start ?? '')
    .replaceAll('{dateEnd}', dateRange?.end ?? '')
    .replaceAll('{dateRange}', dateRange ? `${dateRange.start}_${dateRange.end}` : '');
}

async function assertUsableDownloadCenterActionSelector(
  page: ReturnType<BrowserController['getPage']>,
  name: keyof DownloadCenterActionSelectors,
  selector: string,
  report: DownloadCenterReportSelectorContext | undefined,
  dateRange?: { start: string; end: string },
): Promise<string> {
  if (!page) {
    throw new Error('领星浏览器页面尚未初始化');
  }
  const renderedSelector = report
    ? renderDownloadCenterSelector(selector, report, dateRange)
    : selector
      .replaceAll('{dateStart}', dateRange?.start ?? '')
      .replaceAll('{dateEnd}', dateRange?.end ?? '')
      .replaceAll('{dateRange}', dateRange ? `${dateRange.start}_${dateRange.end}` : '');
  let matchCount = 0;
  try {
    matchCount = await countVisibleLocatorMatches(page, renderedSelector);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`动作选择器 ${String(name)} 无法解析：${message}`);
  }
  const usability = evaluateActionSelectorUsability(String(name), selector, matchCount);
  if (!usability.usable) {
    throw new Error(
      `动作选择器 ${String(name)} 不可安全执行：${usability.errorMessage || `命中数 ${matchCount}`}。selector=${renderedSelector}`,
    );
  }
  return renderedSelector;
}

async function countVisibleLocatorMatches(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  selector: string,
): Promise<number> {
  return page.locator(selector).evaluateAll((elements) => elements.filter((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden'
      && style.display !== 'none'
      && rect.width > 0
      && rect.height > 0;
  }).length);
}

function redactEvidenceSecrets(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
    .replace(/(authorization\s*:\s*bearer\s+)[^"',\s<>]+/gi, '$1[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'bearer [redacted]')
    .replace(/((?:set-)?cookie\s*:\s*)[^\r\n"'<>]+/gi, '$1[redacted]')
    .replace(/(token|session|authorization|cookie|password)\s*[:=]\s*["']?[^"',\s<>]+/gi, '$1=[redacted]')
    .replace(/(access[_-]?token|refresh[_-]?token|csrf[_-]?token|download[_-]?url|signature|sign)\s*[:=]\s*["']?[^"',\s<>]+/gi, '$1=[redacted]');
}

function sanitizeEvidenceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return redactEvidenceSecrets(url.toString());
  } catch {
    return redactEvidenceSecrets(value).replace(/[?#].*$/, '');
  }
}

function sanitizeEvidenceText(value: string): string {
  const redacted = redactEvidenceSecrets(value);
  return redacted.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
    const trailing = rawUrl.match(/[),.;]+$/)?.[0] ?? '';
    const coreUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    return `${sanitizeEvidenceUrl(coreUrl)}${trailing}`;
  });
}

async function captureReportFailureEvidence(
  controller: BrowserController,
  reportType: LingxingReportType,
  dateRange: { start: string; end: string },
  attemptErrors: string[],
  traceUnavailableReason?: string,
  storeCapsule?: StoreCapsulePaths,
) {
  const page = controller.getPage();
  const evidenceId = `${reportType}_${dateRange.start}_${dateRange.end}_${Date.now()}`;
  let screenshotPath: string | undefined;
  let domSnapshotPath: string | undefined;

  if (page) {
    const screenshotsDir = storeCapsule?.screenshotsDir ?? SCREENSHOTS_DIR;
    const domSnapshotsDir = storeCapsule?.evidenceDir ?? DOM_SNAPSHOTS_DIR;
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(domSnapshotsDir, { recursive: true });
    screenshotPath = path.join(screenshotsDir, `report_failure_${evidenceId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    domSnapshotPath = path.join(domSnapshotsDir, `report_failure_${evidenceId}.html`);
    const html = await collectSanitizedDomEvidence(controller);
    const metadata = [
      '<!--',
      `reportType: ${reportType}`,
      `dateStart: ${dateRange.start}`,
      `dateEnd: ${dateRange.end}`,
      `capturedAt: ${new Date().toISOString()}`,
      `url: ${sanitizeEvidenceUrl(page.url())}`,
      `attemptErrors: ${sanitizeEvidenceText(JSON.stringify(attemptErrors))}`,
      '-->',
      '',
    ].join('\n');
    fs.writeFileSync(domSnapshotPath, `${metadata}${html}`, 'utf8');
  }

  return {
    screenshotPath,
    domSnapshotPath,
    traceUnavailableReason,
  };
}

async function handleDiagnoseLingxingDownloadCenter(input?: unknown): Promise<DownloadCenterDiagnosticResult> {
  const request = input ? normalizeLingxingCollectionRequest(input) : undefined;
  const submittedContext = request?.storeContext ?? state.storeCoordinator?.getActiveStoreContext();
  if (!submittedContext) throw new Error('请先选择店铺，再验证领星下载中心。');
  const authorized = authorizedLingxingCollectionTarget(submittedContext);
  if (!state.lingxingCollectionOperations) throw new Error('店铺浏览器互斥协调器尚未就绪。');
  return state.lingxingCollectionOperations.run({
    context: authorized.context,
    owner: `lingxing-diagnostic:${request?.requestId || Date.now()}`,
    ttlMs: 10 * 60 * 1_000,
  }, async (operation) => {
    operation.assertStepCurrent();
    const browserRuntime = state.browserRuntime;
    if (
      !browserRuntime
      || !state.isLoggedIn
      || missionControlContextKey(browserRuntime.context) !== missionControlContextKey(authorized.context)
    ) {
      throw new Error('请先启动并登录当前店铺的独立领星 ERP 浏览器');
    }
    assertVisibleLingxingCollectionSession(authorized.context);
    const controller = browserRuntime.controllers.lingxing;
    const capsule = storeCapsuleFor(authorized.store);
  const dateRange = request ? { start: request.start, end: request.end } : undefined;
  const target = authorized.target;
  if (dateRange) {
    validateDateRange(dateRange);
  }

  const modelInfo = handleGetDownloadCenterPageModel();
  const model = modelInfo.model;
  const url = model.candidateUrls[0];
  let result: DownloadCenterDiagnosticResult;

  try {
    operation.assertStepCurrent();
    await navigateToLingxingDownloadCenter(controller, model);
    const selectorMatches: Record<string, boolean> = {};
    for (const hint of model.verifySelectors) {
      selectorMatches[hint.selector] = await controller.evaluate<boolean>((selector: string) => {
        return Boolean(document.querySelector(selector));
      }, hint.selector);
    }
    const snapshot = await controller.evaluate<{ url: string; title: string; bodyText: string }>(() => ({
      url: window.location.href,
      title: document.title,
      bodyText: document.body?.innerText ?? '',
    }));
    const selectorCandidates = await collectDownloadCenterSelectorCandidates(controller);
    const diagnosticContext: DownloadCenterReportSelectorContext = {
      ...LINGXING_AD_REPORTS[0],
      generatedReportName: dateRange ? buildGeneratedDownloadCenterReportName(LINGXING_AD_REPORTS[0], dateRange) : undefined,
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
    };
    const actionSelectorChecks = await collectDownloadCenterDiagnosticActionSelectorChecks(
      controller,
      model,
      dateRange,
      diagnosticContext,
    );

    result = evaluateDownloadCenterPageModel(model, {
      ...snapshot,
      selectorMatches,
    });
    result.pageModelSource = modelInfo.source as 'bundled' | 'override';
    result.pageModelSnapshot = model;
    result.dateStart = dateRange?.start;
    result.dateEnd = dateRange?.end;
    result.storeName = target.storeName;
    result.marketplaceCode = target.marketplaceCode;
    result.selectorCandidates = selectorCandidates;
    result.actionSelectorChecks = actionSelectorChecks;
  } catch (error) {
    result = {
      pageModel: model.name,
      pageModelSource: modelInfo.source as 'bundled' | 'override',
      pageModelSnapshot: model,
      dateStart: dateRange?.start,
      dateEnd: dateRange?.end,
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
      url,
      title: '',
      ready: false,
      requiresManualVerification: model.requiresManualVerification,
      matchedEntryHints: [],
      matchedReportNames: [],
      selectorChecks: model.verifySelectors.map((hint) => ({ ...hint, found: false })),
      missingRequiredSelectors: model.verifySelectors.filter((hint) => hint.required).map((hint) => hint.name),
      actionSelectorChecks: [],
      checkedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  result.appVersion = APP_VERSION;
  try {
    operation.assertStepCurrent();
    result.screenshotPath = await captureDownloadCenterDiagnosticScreenshot(
      controller,
      capsule.screenshotsDir,
    );
  } catch (error) {
    result.errorMessage = appendDiagnosticError(result.errorMessage, `screenshot: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    operation.assertStepCurrent();
    result.domSnapshotPath = await captureDownloadCenterDiagnosticDomSnapshot(
      controller,
      capsule.evidenceDir,
    );
  } catch (error) {
    result.errorMessage = appendDiagnosticError(result.errorMessage, `domSnapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
    operation.assertStepCurrent();
    return persistDownloadCenterDiagnostic(result);
  });
}

function appendDiagnosticError(existing: string | undefined, next: string): string {
  return existing ? `${existing}; ${next}` : next;
}

function readDownloadCenterPageModel(): DownloadCenterPageModel {
  const overridePath = getDownloadCenterPageModelOverridePath();
  if (fs.existsSync(overridePath)) {
    try {
      return readAndValidateDownloadCenterPageModel(overridePath);
    } catch {
      return readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath());
    }
  }
  return readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath());
}

function getBundledDownloadCenterPageModelPath(): string {
  return path.join(getBundledResourcesPath(), 'page-models', DOWNLOAD_CENTER_PAGE_MODEL_FILENAME);
}

function getDownloadCenterPageModelOverridePath(): string {
  return path.join(PAGE_MODELS_DIR, DOWNLOAD_CENTER_PAGE_MODEL_OVERRIDE_FILENAME);
}

function readAndValidateDownloadCenterPageModel(modelPath: string): DownloadCenterPageModel {
  const parsed = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as unknown;
  validateDownloadCenterPageModel(parsed);
  return parsed;
}

function handleGetDownloadCenterPageModel() {
  const overridePath = getDownloadCenterPageModelOverridePath();
  const source = fs.existsSync(overridePath) ? 'override' : 'bundled';
  const pathInUse = source === 'override' ? overridePath : getBundledDownloadCenterPageModelPath();
  let model: DownloadCenterPageModel;
  let overrideError: string | undefined;

  if (source === 'override') {
    try {
      model = readAndValidateDownloadCenterPageModel(overridePath);
    } catch (error) {
      overrideError = error instanceof Error ? error.message : String(error);
      model = readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath());
    }
  } else {
    model = readAndValidateDownloadCenterPageModel(pathInUse);
  }

  return {
    model,
    source: overrideError ? 'bundled' : source,
    path: overrideError ? getBundledDownloadCenterPageModelPath() : pathInUse,
    overridePath,
    overrideMetadataPath: getDownloadCenterPageModelOverrideMetadataPath(overridePath),
    overrideError,
    readiness: getDownloadCenterAutomationReadiness(model),
  };
}

function handleSaveDownloadCenterPageModel(model: DownloadCenterPageModel) {
  validateDownloadCenterPageModel(model);
  const overridePath = getDownloadCenterPageModelOverridePath();
  const readiness = getDownloadCenterAutomationReadiness(model);
  const metadata = saveDownloadCenterPageModelOverride({
    model,
    overridePath,
    appVersion: APP_VERSION,
    readiness,
  });
  return {
    ...handleGetDownloadCenterPageModel(),
    overrideSaveMetadata: metadata,
  };
}

function handleResetDownloadCenterPageModel() {
  const overridePath = getDownloadCenterPageModelOverridePath();
  const backupPath = backupExistingDownloadCenterPageModelOverride(overridePath);
  if (fs.existsSync(overridePath)) {
    fs.unlinkSync(overridePath);
  }
  const metadataPath = getDownloadCenterPageModelOverrideMetadataPath(overridePath);
  if (fs.existsSync(metadataPath)) {
    fs.unlinkSync(metadataPath);
  }
  return {
    ...handleGetDownloadCenterPageModel(),
    resetBackupPath: backupPath,
  };
}

async function captureDownloadCenterDiagnosticScreenshot(
  controller: BrowserController,
  screenshotsDir = SCREENSHOTS_DIR,
): Promise<string | undefined> {
  const page = controller.getPage();
  if (!page) return undefined;
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const screenshotPath = path.join(screenshotsDir, `download_center_diagnostic_${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

async function captureDownloadCenterDiagnosticDomSnapshot(
  controller: BrowserController,
  evidenceDir = DOM_SNAPSHOTS_DIR,
): Promise<string | undefined> {
  const page = controller.getPage();
  if (!page) return undefined;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const domSnapshotPath = path.join(evidenceDir, `download_center_diagnostic_${Date.now()}.html`);
  const html = await collectSanitizedDomEvidence(controller);
  const metadata = [
    '<!--',
    `capturedAt: ${new Date().toISOString()}`,
    `url: ${sanitizeEvidenceUrl(page.url())}`,
    'purpose: download center selector verification',
    '-->',
    '',
  ].join('\n');
  fs.writeFileSync(domSnapshotPath, `${metadata}${html}`, 'utf8');
  return domSnapshotPath;
}

async function collectDownloadCenterSelectorCandidates(controller: BrowserController): Promise<DownloadCenterSelectorCandidate[]> {
  return controller.evaluate<DownloadCenterSelectorCandidate[]>(() => {
    const keywords = [
      '创建',
      '生成',
      '下载',
      '广告活动',
      '广告组',
      '广告位',
      '推广的商品',
      '自动投放',
      '关键词',
      '商品投放',
      '用户搜索词',
      '日期',
    ];
    const elements = Array.from(document.querySelectorAll([
      'button',
      'input',
      'textarea',
      '[role="button"]',
      '[role="dialog"]',
      'a',
      'tr',
      'tr[role="row"]',
      'td',
      '.ant-picker',
      '.ant-select',
      '.ant-modal',
      '.ant-table-row',
      '.el-date-editor',
      '.el-select',
      '.el-dialog',
      '.el-checkbox',
      '.el-radio',
      '.JS-download-report',
      '.dataTable',
      '.vxe-body--row',
    ].join(', ')));

    function maskText(value: string): string {
      return value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
        .replace(/(token|session|authorization|cookie)\s*[:=]\s*\S+/gi, '$1=[redacted]')
        .slice(0, 120);
    }

    function cssIdentifierEscape(value: string): string {
      const css = globalThis.CSS as { escape?: (input: string) => string } | undefined;
      if (css?.escape) return css.escape(value);
      return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match) => `\\${match}`);
    }

    function cssStringEscape(value: string): string {
      return value.replace(/["\\]/g, '\\$&');
    }

    function safeMatchCount(selector: string): number {
      try {
        return document.querySelectorAll(selector).length;
      } catch {
        return 0;
      }
    }

    function candidateAttributes(element: Element): Record<string, string> {
      const attrs: Record<string, string> = {};
      for (const attr of ['data-testid', 'data-test', 'data-row-key', 'aria-label', 'name', 'placeholder', 'title', 'type']) {
        const value = element.getAttribute(attr);
        if (value) attrs[attr] = maskText(value);
      }
      return attrs;
    }

    function selectorFor(element: Element): { selector: string; matchCount: number } {
      const html = element as HTMLElement;
      if (html.id) {
        const selector = `#${cssIdentifierEscape(html.id)}`;
        return { selector, matchCount: safeMatchCount(selector) };
      }
      const dataAttrs = ['data-testid', 'data-test', 'data-row-key', 'aria-label', 'name', 'placeholder'];
      for (const attr of dataAttrs) {
        const value = html.getAttribute(attr);
        if (value) {
          const selector = `${element.tagName.toLowerCase()}[${attr}="${cssStringEscape(value)}"]`;
          return { selector, matchCount: safeMatchCount(selector) };
        }
      }
      const text = (html.innerText || html.getAttribute('value') || '').trim().replace(/\s+/g, ' ');
      if (text && text.length <= 40) {
        const tagName = element.tagName.toLowerCase();
        const matchCount = Array.from(document.querySelectorAll(tagName)).filter((item) => ((item as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ') === text).length;
        return { selector: `${tagName}:has-text("${cssStringEscape(text)}")`, matchCount };
      }
      const classes = Array.from(html.classList).slice(0, 3);
      if (classes.length > 0) {
        const selector = `${element.tagName.toLowerCase()}.${classes.map(cssIdentifierEscape).join('.')}`;
        return { selector, matchCount: safeMatchCount(selector) };
      }
      const selector = element.tagName.toLowerCase();
      return { selector, matchCount: safeMatchCount(selector) };
    }

    function roleFor(element: Element, text: string): string {
      const tag = element.tagName.toLowerCase();
      if (element.classList.contains('JS-download-report')) return 'downloadButton';
      if (tag === 'button' || tag === 'a' || element.getAttribute('role') === 'button') {
        return text.includes('下载') ? 'downloadButton' : 'createOrConfirmButton';
      }
      if (tag === 'input' || tag === 'textarea') return 'input';
      if (tag === 'tr' || element.getAttribute('role') === 'row' || element.classList.contains('ant-table-row') || element.classList.contains('vxe-body--row')) return 'readyReportSelector';
      if (element.classList.contains('ant-picker') || element.classList.contains('el-date-editor') || text.includes('开始日期') || text.includes('结束日期')) return 'dateInput';
      if (element.classList.contains('ant-modal') || element.classList.contains('el-dialog') || element.getAttribute('role') === 'dialog') return 'confirmDialog';
      return 'candidate';
    }

    return elements
      .map((element) => {
        try {
          const html = element as HTMLElement;
          const text = maskText((html.innerText || html.getAttribute('placeholder') || html.getAttribute('aria-label') || html.getAttribute('value') || '')
            .trim()
            .replace(/\s+/g, ' '));
          const selector = selectorFor(element);
          const candidate: DownloadCenterSelectorCandidate = {
            role: roleFor(element, text),
            text,
            tagName: element.tagName.toLowerCase(),
            selector: selector.selector,
            matchCount: selector.matchCount,
            unique: selector.matchCount === 1,
            attributes: candidateAttributes(element),
          };
          return candidate;
        } catch {
          return null;
        }
      })
      .filter((candidate): candidate is DownloadCenterSelectorCandidate => Boolean(candidate?.text && keywords.some((keyword) => candidate.text.includes(keyword))))
      .slice(0, 80);
  });
}

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

function getDownloadCenterActionSelectorKind(name: string): DownloadCenterActionSelectorCheck['kind'] {
  if (name === 'dateStartInput' || name === 'dateEndInput' || name === 'reportSearchInput') {
    return 'input';
  }
  if (name === 'readyReportSelector') {
    return 'row';
  }
  if (name === 'statusTextSelector') {
    return 'status';
  }
  if (
    name === 'createReportButton'
    || name === 'confirmCreateButton'
    || name === 'downloadButton'
    || name === 'listRefreshButton'
    || name === 'createTimeSortHeader'
  ) {
    return 'click';
  }
  return 'optional';
}

function evaluateActionSelectorUsability(name: string, selector: string, matchCount: number): {
  usable: boolean;
  ambiguous: boolean;
  errorMessage?: string;
} {
  const requiresReportScope = REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(name);
  const requiresDateScope = REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(name);
  if (matchCount === 0) {
    return { usable: false, ambiguous: false };
  }
  if (matchCount > 1) {
    return {
      usable: false,
      ambiguous: true,
      errorMessage: `selector 命中 ${matchCount} 个元素，请收窄到唯一目标`,
    };
  }
  if (requiresReportScope && !selectorUsesReportScope(selector)) {
    return {
      usable: false,
      ambiguous: false,
      errorMessage: '报告相关 selector 必须包含 {reportName}、{reportType}、{expectedFilenameKeyword} 或 {generatedReportName} 占位符',
    };
  }
  if (requiresDateScope && !selectorUsesDateScope(selector)) {
    return {
      usable: false,
      ambiguous: false,
      errorMessage: '报告相关 selector 必须包含 {dateStart}、{dateEnd} 或 {dateRange} 占位符，避免匹配旧报表',
    };
  }
  return { usable: true, ambiguous: false };
}

async function collectDownloadCenterActionSelectorChecks(
  controller: BrowserController,
  model: DownloadCenterPageModel,
  dateRange?: { start: string; end: string },
  options: {
    names?: Set<string>;
    context?: DownloadCenterReportSelectorContext;
  } = {},
): Promise<DownloadCenterActionSelectorCheck[]> {
  const selectors = model.actionSelectors;
  if (!selectors) {
    return [];
  }
  const page = getControllerPageOrThrow(controller);
  const checks: DownloadCenterActionSelectorCheck[] = [];
  const entries = Object.entries(selectors)
    .filter(([name]) => !options.names || options.names.has(name))
    .filter(([name, selector]) => !name.endsWith('TimeoutMs') && typeof selector === 'string') as Array<[keyof DownloadCenterActionSelectors, string]>;

  for (const [name, selector] of entries) {
    const required = REQUIRED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(String(name));
    const kind = getDownloadCenterActionSelectorKind(String(name));
    if (!selector.trim()) {
      checks.push({
        name: String(name),
        selector,
        renderedSelector: '',
        required,
        kind,
        matchCount: 0,
        found: false,
        usable: false,
        ambiguous: false,
      });
      continue;
    }

    const needsReport = selector.includes('{reportType}')
      || selector.includes('{reportName}')
      || selector.includes('{expectedFilenameKeyword}')
      || selector.includes('{generatedReportName}');
    const reports = options.context ? [options.context] : needsReport ? LINGXING_AD_REPORTS : [undefined];

    for (const report of reports) {
      const renderedSelector = report
        ? renderDownloadCenterSelector(selector, report, dateRange)
        : selector
          .replaceAll('{dateStart}', dateRange?.start ?? '')
          .replaceAll('{dateEnd}', dateRange?.end ?? '')
          .replaceAll('{dateRange}', dateRange ? `${dateRange.start}_${dateRange.end}` : '');
      try {
        const matchCount = await countVisibleLocatorMatches(page, renderedSelector);
        const usability = evaluateActionSelectorUsability(String(name), selector, matchCount);
        checks.push({
          name: String(name),
          selector,
          renderedSelector,
          required,
          kind,
          reportType: report?.type,
          reportDisplayName: report?.displayName,
          matchCount,
          found: matchCount > 0,
          ...usability,
        });
      } catch (error) {
        checks.push({
          name: String(name),
          selector,
          renderedSelector,
          required,
          kind,
          reportType: report?.type,
          reportDisplayName: report?.displayName,
          matchCount: 0,
          found: false,
          usable: false,
          ambiguous: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return checks;
}

async function collectDownloadCenterDiagnosticActionSelectorChecks(
  controller: BrowserController,
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string } | undefined,
  context: DownloadCenterReportSelectorContext,
): Promise<DownloadCenterActionSelectorCheck[]> {
  const listPageSelectorNames = new Set([
    'createReportButton',
    'listRefreshButton',
    'createTimeSortHeader',
    'readyReportSelector',
    'statusTextSelector',
    'downloadButton',
  ]);
  const createPageSelectorNames = new Set([
    'storeSearchInput',
    'storeOption',
    'storeMoveButton',
    'reportSearchInput',
    'reportTypeSelect',
    'reportTypeOption',
    'dateStartInput',
    'dateEndInput',
    'dailyDetailRadio',
    'confirmCreateButton',
  ]);

  const listChecks = await collectDownloadCenterActionSelectorChecks(controller, model, dateRange, {
    names: listPageSelectorNames,
    context,
  });
  const selectors = model.actionSelectors;
  if (!selectors?.createReportButton?.trim()) {
    return [
      ...listChecks,
      ...await collectDownloadCenterActionSelectorChecks(controller, model, dateRange, {
        names: createPageSelectorNames,
        context,
      }),
    ];
  }

  const page = getControllerPageOrThrow(controller);
  const createReportButton = renderDownloadCenterSelector(selectors.createReportButton, context, dateRange);
  const canOpenCreatePage = await page.locator(createReportButton).isVisible({ timeout: 5000 }).catch(() => false);
  if (!canOpenCreatePage) {
    return [
      ...listChecks,
      ...await collectDownloadCenterActionSelectorChecks(controller, model, dateRange, {
        names: createPageSelectorNames,
        context,
      }),
    ];
  }

  await page.locator(createReportButton).click();
  await waitForCreateReportPage(page);
  const reportTypeSelect = renderDownloadCenterSelector(
    selectors.reportTypeSelect || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeSelect,
    context,
    dateRange,
  );
  if (await page.locator(reportTypeSelect).isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator(reportTypeSelect).click();
    await page.waitForTimeout(500);
  }
  const createChecks = await collectDownloadCenterActionSelectorChecks(controller, model, dateRange, {
    names: createPageSelectorNames,
    context,
  });
  await navigateToLingxingDownloadCenter(controller, model);
  return [...listChecks, ...createChecks];
}

async function collectSanitizedDomEvidence(controller: BrowserController): Promise<string> {
  return controller.evaluate<string>(() => {
    function mask(value: string): string {
      return value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
        .replace(/(token|session|authorization|cookie)\s*[:=]\s*["']?[^"'\s<>]+/gi, '$1=[redacted]')
        .replace(/(access[_-]?token|refresh[_-]?token|csrf[_-]?token)\s*[:=]\s*["']?[^"'\s<>]+/gi, '$1=[redacted]');
    }

    const clone = document.body?.cloneNode(true) as HTMLElement | undefined;
    if (!clone) return '<body></body>';

    clone.querySelectorAll('script, style, noscript, iframe, canvas, svg, img, video, audio').forEach((node) => node.remove());
    clone.querySelectorAll('input, textarea').forEach((node) => {
      const element = node as HTMLInputElement | HTMLTextAreaElement;
      if ('value' in element) element.value = '';
      element.setAttribute('value', '');
    });
    clone.querySelectorAll('table tbody tr:nth-child(n+6), .ant-table-tbody tr:nth-child(n+6)').forEach((node) => node.remove());
    clone.querySelectorAll('*').forEach((node) => {
      const element = node as HTMLElement;
      for (const attr of Array.from(element.attributes)) {
        if (/token|session|cookie|authorization|password/i.test(attr.name) || /token|session|cookie|authorization|password/i.test(attr.value)) {
          element.setAttribute(attr.name, '[redacted]');
        }
      }
      if (element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE) {
        element.textContent = mask(element.textContent || '').slice(0, 200);
      }
    });

    return `<!doctype html><html><head><meta charset="utf-8"><title>Sanitized Download Center Evidence</title></head><body>${clone.innerHTML}</body></html>`;
  });
}

function persistDownloadCenterDiagnostic(result: DownloadCenterDiagnosticResult): DownloadCenterDiagnosticResult {
  if (!state.db) return result;
  const activeContext = state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext) throw new Error('下载中心诊断缺少当前店铺权威。');
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  if (
    result.storeName !== authorized.target.storeName
    || result.marketplaceCode !== authorized.target.marketplaceCode
  ) {
    throw new Error('下载中心诊断结果与当前店铺权威不一致，拒绝持久化。');
  }

  const insert = state.db.prepare(`
    INSERT INTO download_center_diagnostics
      (store_id, app_version, page_model, page_model_source, page_model_snapshot_json, date_start, date_end, store_name, marketplace_code, url, title, ready, requires_manual_verification, matched_entry_hints_json,
       matched_report_names_json, selector_checks_json, missing_required_selectors_json, selector_candidates_json,
       action_selector_checks_json,
       screenshot_path, dom_snapshot_path, error_message, checked_at)
    VALUES
      (@storeId, @appVersion, @pageModel, @pageModelSource, @pageModelSnapshotJson, @dateStart, @dateEnd, @storeName, @marketplaceCode, @url, @title, @ready, @requiresManualVerification, @matchedEntryHintsJson,
       @matchedReportNamesJson, @selectorChecksJson, @missingRequiredSelectorsJson, @selectorCandidatesJson,
       @actionSelectorChecksJson,
       @screenshotPath, @domSnapshotPath, @errorMessage, @checkedAt)
  `);
  const response = insert.run({
    storeId: authorized.context.storeId,
    appVersion: result.appVersion ?? APP_VERSION,
    pageModel: result.pageModel,
    pageModelSource: result.pageModelSource ?? null,
    pageModelSnapshotJson: result.pageModelSnapshot ? JSON.stringify(result.pageModelSnapshot) : null,
    dateStart: result.dateStart ?? null,
    dateEnd: result.dateEnd ?? null,
    storeName: result.storeName ?? null,
    marketplaceCode: result.marketplaceCode ?? null,
    url: result.url,
    title: result.title,
    ready: result.ready ? 1 : 0,
    requiresManualVerification: result.requiresManualVerification ? 1 : 0,
    matchedEntryHintsJson: JSON.stringify(result.matchedEntryHints),
    matchedReportNamesJson: JSON.stringify(result.matchedReportNames),
    selectorChecksJson: JSON.stringify(result.selectorChecks),
    missingRequiredSelectorsJson: JSON.stringify(result.missingRequiredSelectors),
    selectorCandidatesJson: JSON.stringify(result.selectorCandidates ?? []),
    actionSelectorChecksJson: JSON.stringify(result.actionSelectorChecks ?? []),
    screenshotPath: result.screenshotPath ?? null,
    domSnapshotPath: result.domSnapshotPath ?? null,
    errorMessage: result.errorMessage ?? null,
    checkedAt: result.checkedAt,
  });

  return {
    ...result,
    id: Number(response.lastInsertRowid),
  };
}

function countKeywordMetricsBySourceFile(source: KeywordMetric['source'], sourceFile: string): number {
  if (!state.db) return 0;
  const row = state.db
    .prepare('SELECT COUNT(*) AS count FROM keyword_metrics WHERE source = ? AND source_file = ?')
    .get(source, sourceFile) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

function deleteKeywordMetricsBySourceFile(source: KeywordMetric['source'], sourceFile: string): void {
  state.db?.prepare('DELETE FROM keyword_metrics WHERE source = ? AND source_file = ?').run(source, sourceFile);
}

function loadPersistedKeywordMetrics(): KeywordMetric[] {
  if (!state.db) return [];
  const rows = state.db.prepare(`
    SELECT
      normalized_keyword AS normalizedKeyword,
      raw_keyword AS rawKeyword,
      source,
      asin,
      impressions,
      clicks,
      cost,
      orders,
      sales,
      acos,
      cvr,
      source_file AS sourceFile,
      source_row AS sourceRow
    FROM keyword_metrics
    ORDER BY id ASC
  `).all() as Array<KeywordMetric & { sourceRow?: number | null }>;

  return rows.map((row) => ({
    ...row,
    asin: row.asin ?? undefined,
    sourceFile: row.sourceFile ?? undefined,
    sourceRow: row.sourceRow ?? undefined,
  }));
}

function persistKeywordMetrics(
  metrics: KeywordMetric[],
  duplicateStrategy: KeywordImportDuplicateStrategy = 'merge',
): { existingRows: number; skipped: boolean; insertedRows: number } {
  if (!state.db || metrics.length === 0) return { existingRows: 0, skipped: false, insertedRows: 0 };
  const source = metrics[0].source;
  const sourceFile = metrics[0]?.sourceFile ? canonicalizeExistingPath(metrics[0].sourceFile) : undefined;
  const existingRows = sourceFile ? countKeywordMetricsBySourceFile(source, sourceFile) : 0;
  if (existingRows > 0 && duplicateStrategy === 'skip') {
    return { existingRows, skipped: true, insertedRows: 0 };
  }

  let insertedRows = 0;
  const save = state.db.transaction(() => {
    if (sourceFile && existingRows > 0 && duplicateStrategy === 'overwrite') {
      deleteKeywordMetricsBySourceFile(source, sourceFile);
    }
    const exists = state.db!.prepare(`
      SELECT id
      FROM keyword_metrics
      WHERE source = @source
        AND source_file = @sourceFile
        AND source_row = @sourceRow
      LIMIT 1
    `);
    const insert = state.db!.prepare(`
      INSERT INTO keyword_metrics
        (normalized_keyword, raw_keyword, source, asin, impressions, clicks, cost, orders, sales, acos, cvr, source_file, source_row)
      VALUES
        (@normalizedKeyword, @rawKeyword, @source, @asin, @impressions, @clicks, @cost, @orders, @sales, @acos, @cvr, @sourceFile, @sourceRow)
    `);

    for (const metric of metrics) {
      const sourceFileValue = metric.sourceFile ? canonicalizeExistingPath(metric.sourceFile) : null;
      const sourceRowValue = metric.sourceRow ?? null;
      if (duplicateStrategy === 'merge' && sourceFileValue && sourceRowValue !== null) {
        const existing = exists.get({
          source: metric.source,
          sourceFile: sourceFileValue,
          sourceRow: sourceRowValue,
        });
        if (existing) {
          continue;
        }
      }

      insert.run({
        ...metric,
        asin: metric.asin ?? null,
        sourceFile: sourceFileValue,
        sourceRow: sourceRowValue,
      });
      insertedRows += 1;
    }
  });
  save();
  return { existingRows, skipped: false, insertedRows };
}

function persistKeywordOpportunities(opportunities: KeywordOpportunity[]): void {
  if (!state.db || opportunities.length === 0) return;

  const save = state.db.transaction(() => {
    const findExisting = state.db!.prepare(`
      SELECT id, status
      FROM keyword_opportunities
      WHERE COALESCE(asin, '') = @asinKey
        AND normalized_keyword = @normalizedKeyword
      LIMIT 1
    `);
    const update = state.db!.prepare(`
      UPDATE keyword_opportunities
      SET
        opportunity_level = @opportunityLevel,
        score = @score,
        evidence = @evidence,
        risk_flags_json = @riskFlagsJson,
        recommended_sections_json = @recommendedSectionsJson,
        updated_at = datetime('now')
      WHERE id = @id
    `);
    const insert = state.db!.prepare(`
      INSERT INTO keyword_opportunities
        (asin, normalized_keyword, opportunity_level, score, evidence, risk_flags_json, recommended_sections_json, status)
      VALUES
        (@asin, @normalizedKeyword, @opportunityLevel, @score, @evidence, @riskFlagsJson, @recommendedSectionsJson, @status)
    `);
    for (const opportunity of opportunities) {
      const row = {
        ...opportunity,
        asin: opportunity.asin ?? null,
        asinKey: opportunity.asin ?? '',
        riskFlagsJson: JSON.stringify(opportunity.riskFlags),
        recommendedSectionsJson: JSON.stringify(opportunity.recommendedSections),
      };
      const existing = findExisting.get(row) as { id: number; status: KeywordOpportunity['status'] } | undefined;
      if (existing) {
        update.run({ ...row, id: existing.id });
      } else {
        insert.run(row);
      }
    }
  });
  save();
}

function pruneKeywordOpportunitiesTo(opportunities: KeywordOpportunity[]): void {
  if (!state.db) return;
  const allowedKeys = new Set(opportunities.map((opportunity) => `${opportunity.asin ?? ''}\u0000${opportunity.normalizedKeyword}`));
  const rows = state.db.prepare(`
    SELECT id, asin, normalized_keyword AS normalizedKeyword
    FROM keyword_opportunities
  `).all() as Array<{ id: number; asin?: string | null; normalizedKeyword: string }>;
  const staleIds = rows
    .filter((row) => !allowedKeys.has(`${row.asin ?? ''}\u0000${row.normalizedKeyword}`))
    .map((row) => row.id);
  if (staleIds.length === 0) return;

  const remove = state.db.transaction(() => {
    const deleteRow = state.db!.prepare('DELETE FROM keyword_opportunities WHERE id = ?');
    for (const id of staleIds) {
      deleteRow.run(id);
    }
  });
  remove();
}

function handleImportKeywordMetrics(
  filePath: string,
  source?: string,
  duplicateStrategy: KeywordImportDuplicateStrategy = 'merge',
) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('请选择关键词报表文件');
  }
  if (!['overwrite', 'merge', 'skip'].includes(duplicateStrategy)) {
    throw new Error('重复导入策略只支持 overwrite、merge 或 skip');
  }

  const resolvedFilePath = canonicalizeExistingPath(filePath);
  const parseResult = parseKeywordMetricsWithDiagnostics(resolvedFilePath, {
    source: normalizeKeywordSource(source),
    fieldMappingsDir: path.join(getBundledResourcesPath(), 'field-mappings'),
  });
  const { metrics, diagnostics } = parseResult;
  if (metrics.length === 0) {
    throw new Error('未在报表中识别到关键词指标，请检查字段映射');
  }

  const metricsForPersistence = metrics.map((metric) => ({ ...metric, sourceFile: resolvedFilePath }));
  const importResult = persistKeywordMetrics(metricsForPersistence, duplicateStrategy);
  if (importResult.skipped) {
    const persistedMetrics = loadPersistedKeywordMetrics();
    const opportunities = buildKeywordOpportunities(persistedMetrics);
    return {
      filePath: resolvedFilePath,
      metricsCount: 0,
      metrics: persistedMetrics,
      diagnostics,
      opportunities,
      duplicate: true,
      duplicateStrategy,
      existingRows: importResult.existingRows,
      skipped: true,
    };
  }

  const persistedMetrics = loadPersistedKeywordMetrics();
  const opportunities = buildKeywordOpportunities(persistedMetrics);
  persistKeywordOpportunities(opportunities);
  pruneKeywordOpportunitiesTo(opportunities);

  return {
    filePath: resolvedFilePath,
    metricsCount: importResult.insertedRows,
    metrics: persistedMetrics,
    diagnostics,
    opportunities,
    duplicate: importResult.existingRows > 0,
    duplicateStrategy,
    existingRows: importResult.existingRows,
    skipped: false,
  };
}

function handleBuildKeywordOpportunities(metrics: KeywordMetric[], options: { brandWhitelist?: string[] } = {}) {
  validateArray(metrics, 'metrics', 20000);
  const opportunities = buildKeywordOpportunities(metrics, options);
  persistKeywordOpportunities(opportunities);
  return opportunities;
}

function handleExportKeywordDiagnostics(diagnostics: unknown): string {
  if (!diagnostics || typeof diagnostics !== 'object') {
    throw new Error('解析诊断数据无效');
  }
  const value = diagnostics as {
    errors?: unknown;
    warnings?: unknown;
    totalRows?: unknown;
    parsedRows?: unknown;
    invalidRows?: unknown;
    invalidRowRatio?: unknown;
  };
  if (!Array.isArray(value.errors) || !Array.isArray(value.warnings)) {
    throw new Error('解析诊断数据缺少 errors 或 warnings');
  }
  const output = keywordMetricDiagnosticsToCsv({
    totalRows: Number(value.totalRows) || 0,
    parsedRows: Number(value.parsedRows) || 0,
    invalidRows: Number(value.invalidRows) || 0,
    invalidRowRatio: Number(value.invalidRowRatio) || 0,
    errors: value.errors as any[],
    warnings: value.warnings as any[],
  });
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }
  const filePath = path.join(EXPORTS_DIR, `keyword_parse_diagnostics_${Date.now()}.csv`);
  fs.writeFileSync(filePath, output, 'utf8');
  return filePath;
}

function handleAnalyzeListingCoverage(listing: ListingContent, keywords: string[]) {
  validateListing(listing);
  validateArray(keywords, 'keywords', 10000);
  const coverage = analyzeKeywordCoverage(listing, keywords);

  if (state.db) {
    const save = state.db.transaction(() => {
      persistListingContent(listing, {
        storeName: readCurrentOperationScopeValue('storeName'),
        marketplaceCode: readCurrentOperationScopeValue('marketplaceCode'),
      });

      const insertCoverage = state.db!.prepare(`
        INSERT INTO keyword_coverage (asin, normalized_keyword, covered, sections_json, strength)
        VALUES (@asin, @normalizedKeyword, @covered, @sectionsJson, @strength)
      `);
      for (const item of coverage) {
        insertCoverage.run({
          asin: listing.asin,
          normalizedKeyword: item.normalizedKeyword,
          covered: item.covered ? 1 : 0,
          sectionsJson: JSON.stringify(item.sections),
          strength: item.strength,
        });
      }
    });
    save();
  }

  return coverage;
}

function handleImportListingContent(filePath: string): ListingContent {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('请选择 Listing 文案文件');
  }

  const listing = parseListingContent(filePath, {
    fieldMappingsDir: path.join(getBundledResourcesPath(), 'field-mappings'),
  });
  validateListing(listing);
  return listing;
}

interface ListingReadPersistContext {
  storeName?: string;
  marketplaceCode?: string;
  sourceUrl?: string;
  screenshotPath?: string;
  source?: ListingContent['source'];
  versionLabel?: string;
  changeSummary?: string;
}

interface ListingReadOptions {
  expectedAsin?: string;
  persist?: boolean;
  scope?: {
    storeName?: string;
    marketplaceCode?: string;
  };
}

async function handleExtractListingFromLingxing(options: ListingReadOptions = {}) {
  const controller = browserRuntimeController('lingxing');
  if (!controller || !state.isLoggedIn) {
    throw new Error('请先通过本应用登录领星，并打开需要读取的 Listing 页面。');
  }
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面未就绪，请重新打开登录窗口后再试。');
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined);
  const capturedAt = new Date().toISOString();
  const screenshotPath = path.join(SCREENSHOTS_DIR, `lingxing_listing_read_${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
  const snapshot = await page.evaluate(() => {
    const textOf = (element: Element | null | undefined) =>
      (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const cssPathOf = (element: Element) => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const id = current.getAttribute('id');
        if (id) {
          parts.unshift(`${tag}#${CSS.escape(id)}`);
          break;
        }
        const className = String(current.getAttribute('class') || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((value) => `.${CSS.escape(value)}`)
          .join('');
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((item) => item.tagName === current!.tagName)
          : [];
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
        parts.unshift(`${tag}${className}${nth}`);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const fieldLabel = (element: HTMLElement) => {
      const id = element.getAttribute('id');
      const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const closest = element.closest('label, .form-item, .ant-form-item, .el-form-item, .layui-form-item, tr');
      const rect = element.getBoundingClientRect();
      const nearbyLabels = Array.from(document.querySelectorAll('label, span, div'))
        .map((candidate) => {
          const labelRect = candidate.getBoundingClientRect();
          const text = textOf(candidate);
          return { text, rect: labelRect, childCount: candidate.children.length };
        })
        .filter((candidate) =>
          candidate.text
          && candidate.text.length <= 80
          && candidate.childCount <= 4
          && candidate.rect.width > 0
          && candidate.rect.height > 0
          && candidate.rect.left < rect.left
          && candidate.rect.right <= rect.left + 12
          && Math.abs((candidate.rect.top + candidate.rect.height / 2) - (rect.top + rect.height / 2)) <= Math.max(24, rect.height)
        )
        .sort((a, b) => Math.abs(a.rect.right - rect.left) - Math.abs(b.rect.right - rect.left))
        .slice(0, 2)
        .map((candidate) => candidate.text);
      return [
        textOf(explicit),
        ...nearbyLabels,
        element.getAttribute('aria-label') || '',
        element.getAttribute('placeholder') || '',
        element.getAttribute('name') || '',
        textOf(closest),
      ].filter(Boolean).join(' ');
    };
    const formFields: ListingDomFieldSnapshot[] = Array.from(
      document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'),
    ).map((element, index) => {
      const htmlElement = element as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
      const value = 'value' in htmlElement
        ? String(htmlElement.value || '')
        : String(htmlElement.textContent || '');
      return {
        key: `${htmlElement.tagName.toLowerCase()}-${index}`,
        label: fieldLabel(htmlElement),
        value: value.replace(/\s+\n/g, '\n').trim(),
      };
    }).filter((field) => field.value || field.label);
    const rowFields: ListingDomFieldSnapshot[] = Array.from(
      document.querySelectorAll('tr, .el-table__row, .vxe-body--row, [role="row"], [class*="body--row"]'),
    ).slice(0, 100).map((element, index) => ({
      key: `row-${index}`,
      label: 'listing table row visible text',
      value: String(element.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim().slice(0, 2000),
    })).filter((field) => field.value);
    const asinPattern = /\bB0[A-Z0-9]{8}\b/i;
    const asinContextFields: ListingDomFieldSnapshot[] = [];
    const seenContextText = new Set<string>();
    for (const element of Array.from(document.querySelectorAll('*')).slice(0, 5000)) {
      const text = String(element.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
      if (!asinPattern.test(text)) continue;
      const row = element.closest('tr, .el-table__row, .vxe-body--row, [role="row"], [class*="body--row"], [class*="table"]') || element;
      const rowText = String(row.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim().slice(0, 2000);
      if (!rowText || seenContextText.has(rowText)) continue;
      seenContextText.add(rowText);
      asinContextFields.push({
        key: `asin-context-${asinContextFields.length}`,
        label: 'listing asin row context visible text',
        value: rowText,
      });
      if (asinContextFields.length >= 30) break;
    }
    const visualItems = Array.from(document.querySelectorAll('body *')).slice(0, 8000).map((element) => {
      const rect = element.getBoundingClientRect();
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        text,
        x: Math.round(rect.left),
        y: Math.round(rect.top / 6) * 6,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        childCount: element.children.length,
      };
    }).filter((item) =>
      item.text
      && item.text.length <= 220
      && item.width > 0
      && item.height > 0
      && item.y > 60
      && item.childCount <= 3
    );
    const visualRows = new Map<number, Array<{ text: string; x: number }>>();
    for (const item of visualItems) {
      const row = visualRows.get(item.y) || [];
      row.push({ text: item.text, x: item.x });
      visualRows.set(item.y, row);
    }
    const visualRowFields: ListingDomFieldSnapshot[] = Array.from(visualRows.entries())
      .sort(([a], [b]) => a - b)
      .slice(0, 120)
      .map(([y, items], index) => ({
        key: `visual-row-${index}`,
        label: `listing visual row y=${y}`,
        value: Array.from(new Set(items.sort((a, b) => a.x - b.x).map((item) => item.text))).join('\n').slice(0, 2000),
      }))
      .filter((field) => field.value);
    const bodyVisibleText = String(document.body?.innerText || '').replace(/[ \t]+/g, ' ').trim().slice(0, 12000);
    const bodyField: ListingDomFieldSnapshot[] = bodyVisibleText
      ? [{
          key: 'body-visible-text',
          label: 'listing page visible body text',
          value: bodyVisibleText,
        }]
      : [];
    const detailCandidates = Array.from(document.querySelectorAll('a, button, [role="button"], .el-dropdown-menu__item, [class*="dropdown"], [class*="operation"]'))
      .slice(0, 1200)
      .map((element, index) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        const text = textOf(element);
        const href = element instanceof HTMLAnchorElement ? element.href : '';
        const aria = htmlElement.getAttribute('aria-label') || '';
        const title = htmlElement.getAttribute('title') || '';
        return {
          key: `detail-candidate-${index}`,
          label: [aria, title].filter(Boolean).join(' '),
          text,
          href,
          selectorHint: cssPathOf(element),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((candidate) => candidate.visible)
      .filter((candidate) => {
        const haystack = `${candidate.text} ${candidate.label} ${candidate.href}`.toLowerCase();
        return /(详情|编辑|修改|查看|管理|listing|product|goods|spu|sku|edit|detail|view)/i.test(haystack);
      })
      .map(({ visible, ...candidate }) => candidate)
      .slice(0, 30);
    const fields = [...formFields, ...rowFields, ...asinContextFields, ...visualRowFields, ...bodyField];
    const metaAsin = Array.from(document.querySelectorAll('meta, [data-asin], [asin]')).map((element) =>
      [
        element.getAttribute('content'),
        element.getAttribute('data-asin'),
        element.getAttribute('asin'),
      ].filter(Boolean).join(' '),
    );
    return {
      url: window.location.href,
      title: document.title,
      asinCandidates: [
        window.location.href,
        document.title,
        ...metaAsin,
        ...fields.map((field) => `${field.label} ${field.value}`),
      ],
      fields,
      detailCandidates,
      capturedAt: new Date().toISOString(),
    } satisfies ListingPageSnapshot;
  });

  const result = extractLingxingListingFromSnapshot({ ...snapshot, capturedAt });
  result.evidence.screenshotPath = screenshotPath;
  result.evidence.pageUrl = sanitizeEvidenceUrl(result.evidence.pageUrl);
  const expectedAsin = options.expectedAsin?.toUpperCase();
  if (expectedAsin && result.listing?.asin && result.listing.asin.toUpperCase() !== expectedAsin) {
    return {
      ...result,
      ready: false,
      partialReady: false,
      fullContentReady: false,
      reason: `详情页 ASIN 与列表页不一致：期望 ${expectedAsin}，实际 ${result.listing.asin}`,
      listing: undefined,
      evidence: {
        ...result.evidence,
        partialReady: false,
        fullContentReady: false,
      },
    };
  }

  if (result.ready && result.listing && options.persist !== false) {
    persistListingContent(result.listing, {
      storeName: options.scope?.storeName || readCurrentOperationScopeValue('storeName'),
      marketplaceCode: options.scope?.marketplaceCode || readCurrentOperationScopeValue('marketplaceCode'),
      sourceUrl: result.evidence.pageUrl,
      screenshotPath: result.evidence.screenshotPath,
      source: 'lingxing_readonly',
      versionLabel: '领星只读读取',
      changeSummary: '从当前领星页面辅助读取 Listing 内容',
    });
  }

  return result;
}

function persistListingContent(listing: ListingContent, context: ListingReadPersistContext = {}): { id: number; versionId: number; savedAt: string } | null {
  if (!state.storeScopedAdListingService) return null;
  const { context: activeContext } = resolveBusinessStoreAuthority();
  const normalized = {
    ...listing,
    asin: canonicalizeAmazonAsin(listing.asin),
    title: String(listing.title || '').trim(),
    bullets: Array.isArray(listing.bullets) ? listing.bullets.map((item) => String(item || '').trim()).filter(Boolean) : [],
  };
  const payload = {
    asin: normalized.asin,
    title: normalized.title,
    bullets: normalized.bullets,
    description: normalized.description ?? '',
    aPlus: normalized.aPlus ?? '',
    imageCopy: normalized.imageCopy ?? '',
    backendTerms: normalized.backendTerms ?? '',
    source: context.source || normalized.source || 'manual',
    versionLabel: context.versionLabel || normalized.versionLabel || '',
    changeSummary: context.changeSummary || normalized.changeSummary || '',
  };
  const existing = state.storeScopedAdListingService.listListingContent(activeContext, {
    asin: normalized.asin,
    limit: 1,
  })[0];
  const saved = existing
    ? state.storeScopedAdListingService.updateListingContent(activeContext, {
        id: existing.id,
        expectedRevision: existing.revision,
        patch: payload,
      })
    : state.storeScopedAdListingService.createListingContent(activeContext, payload);
  const version = state.storeScopedAdListingService.listListingVersions(activeContext, {
    listingContentId: saved.id,
    limit: 1,
  })[0];
  if (!version) throw new Error('Listing 版本回读失败，已拒绝返回未验证的保存结果。');
  return {
    id: saved.id,
    versionId: version.id,
    savedAt: saved.updatedAt,
  };
}

function readCurrentOperationScopeValue(key: 'storeName' | 'marketplaceCode'): string {
  try {
    const scope = handleGetOperationScope();
    return typeof scope?.[key] === 'string' ? scope[key] : '';
  } catch {
    return '';
  }
}

async function clickLingxingListingReadOnlyTab(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  labels: string[],
): Promise<boolean> {
  return page.evaluate((targetLabels) => {
    const textOf = (element: Element | null | undefined) =>
      String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = Array.from(document.querySelectorAll('a, button, [role="tab"], [role="button"], li, span, div'))
      .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element))
      .filter((element) => {
        const text = textOf(element);
        if (!targetLabels.some((label) => text === label || text.includes(label))) return false;
        const rect = element.getBoundingClientRect();
        return rect.left < 260 || /tab|menu|nav|sidebar|anchor/i.test(element.getAttribute('class') || '');
      })
      .sort((a, b) => {
        const aText = textOf(a);
        const bText = textOf(b);
        const aExact = targetLabels.some((label) => aText === label) ? 0 : 1;
        const bExact = targetLabels.some((label) => bText === label) ? 0 : 1;
        return aExact - bExact || a.getBoundingClientRect().left - b.getBoundingClientRect().left;
      });
    const selected = candidates[0];
    if (!selected) return false;
    selected.click();
    return true;
  }, labels);
}

function mergeListingExtractionResults(
  primary: ListingExtractionResult,
  secondary: ListingExtractionResult,
): ListingExtractionResult {
  if (!primary.listing || !secondary.listing) {
    return primary;
  }
  const listing: ListingContent = {
    ...primary.listing,
    title: primary.listing.title || secondary.listing.title,
    bullets: secondary.listing.bullets.length > 0 ? secondary.listing.bullets : primary.listing.bullets,
    aPlus: secondary.listing.aPlus || primary.listing.aPlus,
    imageCopy: secondary.listing.imageCopy || primary.listing.imageCopy,
    backendTerms: primary.listing.backendTerms || secondary.listing.backendTerms,
    updatedAt: secondary.listing.updatedAt || primary.listing.updatedAt,
  };
  const partialReady = Boolean(listing.asin && listing.title);
  const fullContentReady = Boolean(partialReady && listing.bullets.length > 0 && listing.backendTerms);
  return {
    ready: partialReady,
    partialReady,
    fullContentReady,
    listing,
    evidence: {
      ...secondary.evidence,
      fieldMatches: {
        ...primary.evidence.fieldMatches,
        ...secondary.evidence.fieldMatches,
        title: primary.evidence.fieldMatches.title?.length ? primary.evidence.fieldMatches.title : secondary.evidence.fieldMatches.title,
        backendTerms: primary.evidence.fieldMatches.backendTerms?.length
          ? primary.evidence.fieldMatches.backendTerms
          : secondary.evidence.fieldMatches.backendTerms,
        bullets: secondary.evidence.fieldMatches.bullets?.length
          ? secondary.evidence.fieldMatches.bullets
          : primary.evidence.fieldMatches.bullets,
      },
      completeness: {
        asin: Boolean(listing.asin),
        title: Boolean(listing.title),
        bullets: listing.bullets.length > 0,
        backendTerms: Boolean(listing.backendTerms),
      },
      partialReady,
      fullContentReady,
      detailCandidates: [
        ...(primary.evidence.detailCandidates ?? []),
        ...(secondary.evidence.detailCandidates ?? []),
      ].slice(0, 20),
    },
  };
}

async function handleOpenLingxingListingAndExtract(input: unknown) {
  const controller = browserRuntimeController('lingxing');
  if (!controller || !state.isLoggedIn) {
    throw new Error('请先通过本应用登录领星，再打开 Listing 页面。');
  }
  const targetUrl = parseLingxingListingReadUrl(input);
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面未就绪，请重新打开登录窗口后再试。');
  }

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(8000);
  const hasNetworkError = await page.getByText('网络异常', { exact: false }).first().isVisible({ timeout: 1000 }).catch(() => false);
  if (hasNetworkError) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
    await page.waitForTimeout(10000);
  }
  return handleExtractListingFromLingxing();
}

async function handleProbeLingxingListingDetailAndExtract(input?: unknown) {
  const controller = browserRuntimeController('lingxing');
  if (!controller || !state.isLoggedIn) {
    throw new Error('请先通过本应用登录领星，再探测 Listing 详情页。');
  }
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面未就绪，请重新打开登录窗口后再试。');
  }

  const rawUrl = input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string'
    ? (input as { url: string }).url.trim()
    : typeof input === 'string'
      ? input.trim()
      : '';
  const expectedAsin = input && typeof input === 'object' && typeof (input as { expectedAsin?: unknown }).expectedAsin === 'string'
    ? (input as { expectedAsin: string }).expectedAsin.trim().toUpperCase()
    : '';
  const scope = input && typeof input === 'object' && (input as { scope?: unknown }).scope && typeof (input as { scope?: unknown }).scope === 'object'
    ? (input as { scope: { storeName?: unknown; marketplaceCode?: unknown } }).scope
    : undefined;
  const persistContext = {
    storeName: typeof scope?.storeName === 'string' && scope.storeName.trim() ? scope.storeName.trim() : readCurrentOperationScopeValue('storeName'),
    marketplaceCode: typeof scope?.marketplaceCode === 'string' && scope.marketplaceCode.trim() ? scope.marketplaceCode.trim() : readCurrentOperationScopeValue('marketplaceCode'),
  };
  const shouldPersist = !(input && typeof input === 'object' && (input as { persist?: unknown }).persist === false);
  if (rawUrl) {
    const targetUrl = parseLingxingListingReadUrl(rawUrl);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);
  }

  const current = await handleExtractListingFromLingxing({ persist: false });
  const probe = {
    started: true,
    clicked: false,
    status: 'not_attempted',
    fromUrl: current.evidence.pageUrl,
    finalUrl: current.evidence.pageUrl,
    candidateCount: current.evidence.detailCandidates?.length || 0,
    asinMatched: Boolean(current.listing?.asin && (!expectedAsin || current.listing.asin.toUpperCase() === expectedAsin)),
  };

  const currentAsin = current.listing?.asin?.toUpperCase();
  const targetAsin = expectedAsin || currentAsin || '';
  if (current.fullContentReady && (!targetAsin || currentAsin === targetAsin)) {
    current.evidence.detailProbe = { ...probe, status: 'already_full_content_ready' };
    if (shouldPersist && current.listing) {
      persistListingContent(current.listing, {
        storeName: persistContext.storeName,
        marketplaceCode: persistContext.marketplaceCode,
        sourceUrl: current.evidence.pageUrl,
        screenshotPath: current.evidence.screenshotPath,
      });
    }
    return current;
  }
  if (!targetAsin) {
    current.evidence.detailProbe = {
      ...probe,
      status: 'no_asin',
      reason: '当前页面未读取到 ASIN，且当前操作范围没有目标 ASIN，不能定位详情页候选。',
    };
    return current;
  }

  const candidate = await findVisibleListingDetailCandidate(page, targetAsin);
  if (candidate.status !== 'unique' || !candidate.token) {
    current.evidence.detailProbe = {
      ...probe,
      status: candidate.status,
      candidateCount: candidate.candidateCount,
      candidateText: candidate.text,
      candidateHref: candidate.href,
      reason: candidate.reason,
    };
    return current;
  }

  const context = controller.getContext();
  const popupPromise = context?.waitForEvent('page', { timeout: 12000 }).catch(() => null);
  await page.locator(`[data-amazon-ai-ops-listing-probe="${candidate.token}"]`).first().click({ timeout: 15000 });
  const popup = await popupPromise;
  const detailPage = popup || page;
  if (popup) {
    controller.setActivePage(popup);
  }
  await detailPage.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => undefined);
  await detailPage.waitForTimeout(8000);

  const finalUrl = detailPage.url();
  let safeFinalUrl = '';
  try {
    safeFinalUrl = parseLingxingListingReadUrl(finalUrl);
  } catch (error) {
    current.evidence.detailProbe = {
      ...probe,
      clicked: true,
      status: 'unsafe_final_url',
      finalUrl: sanitizeEvidenceUrl(finalUrl),
      candidateCount: candidate.candidateCount,
      candidateText: candidate.text,
      candidateHref: candidate.href,
      reason: error instanceof Error ? error.message : String(error),
    };
    return current;
  }

  const basicRead = await handleExtractListingFromLingxing({ expectedAsin: targetAsin, persist: false, scope: persistContext });
  let probed = basicRead;
  if (!basicRead.fullContentReady) {
    const switchedToDescription = await clickLingxingListingReadOnlyTab(detailPage, ['描述', 'Description', '商品描述']);
    if (switchedToDescription) {
      await detailPage.waitForTimeout(2500);
      const descriptionRead = await handleExtractListingFromLingxing({ expectedAsin: targetAsin, persist: false, scope: persistContext });
      probed = mergeListingExtractionResults(basicRead, descriptionRead);
    }
  }
  probed.evidence.detailProbe = {
    ...probe,
    clicked: true,
    status: probed.fullContentReady ? 'full_content_ready' : 'partial_after_probe',
    finalUrl: sanitizeEvidenceUrl(safeFinalUrl),
    candidateCount: candidate.candidateCount,
    candidateText: candidate.text,
    candidateHref: candidate.href,
    asinMatched: Boolean(probed.listing?.asin && probed.listing.asin.toUpperCase() === targetAsin),
    reason: probed.fullContentReady ? undefined : '详情页已打开，但仍未读取到完整五点和后台词。',
  };
  if (shouldPersist && probed.fullContentReady && probed.listing) {
    persistListingContent(probed.listing, {
      storeName: persistContext.storeName,
      marketplaceCode: persistContext.marketplaceCode,
      sourceUrl: probed.evidence.pageUrl,
      screenshotPath: probed.evidence.screenshotPath,
    });
  }
  return probed;
}

async function findVisibleListingDetailCandidate(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  asin: string,
): Promise<{ status: string; token?: string; candidateCount: number; text?: string; href?: string; reason?: string }> {
  const direct = await page.evaluate((targetAsin) => {
    const token = `aao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const textOf = (element: Element | null | undefined) =>
      String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const safeTextPattern = /(详情|查看|编辑本地信息|编辑在线商品|查看基本|detail|view|edit)/i;
    const unsafeTextPattern = /(保存|发布|提交|同步|删除|移除|下架|上架|打印|条码|fnsku|help|帮助|save|submit|publish|delete|remove|sync|print|barcode)/i;
    const globalToolbarPattern = /(更多筛选|操作记录|上传商品记录|导入配对记录|自动配对记录|导入分配负责人记录|导入本地信息记录|导入标签记录|导入调价记录)/;
    const rowSelector = 'tr, .el-table__row, .vxe-body--row, [role="row"], [class*="body--row"], [class*="table-row"]';
    const rows = Array.from(document.querySelectorAll(rowSelector))
      .filter((element) => {
        const text = textOf(element);
        return text.toUpperCase().includes(targetAsin.toUpperCase()) && !globalToolbarPattern.test(text);
      });
    if (rows.length === 0) {
      return { status: 'no_asin_row', candidateCount: 0, reason: '当前页面没有找到包含目标 ASIN 的可见行。' };
    }
    const candidates: Array<{ element: HTMLElement; text: string; href: string }> = [];
    for (const row of rows.slice(0, 5)) {
      for (const element of Array.from(row.querySelectorAll('a, button, [role="button"]'))) {
        if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
        const text = textOf(element);
        const href = element instanceof HTMLAnchorElement ? element.href : '';
        const label = [
          text,
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || '',
          href,
        ].join(' ');
        if (!safeTextPattern.test(label) || unsafeTextPattern.test(label) || globalToolbarPattern.test(label)) continue;
        candidates.push({ element, text, href });
      }
    }
    const unique = candidates.filter((candidate, index) =>
      candidates.findIndex((item) => item.text === candidate.text && item.href === candidate.href) === index,
    );
    if (unique.length === 0) {
      return { status: 'no_candidate', candidateCount: 0, reason: '目标 ASIN 行内没有可见的详情/查看/编辑入口。' };
    }
    if (unique.length > 1) {
      return {
        status: 'ambiguous_candidates',
        candidateCount: unique.length,
        text: unique.slice(0, 3).map((candidate) => candidate.text || candidate.href || '未命名入口').join('；'),
        href: unique[0].href,
        reason: '目标 ASIN 行内发现多个候选入口，需要人工确认或更精确 selector。',
      };
    }
    unique[0].element.setAttribute('data-amazon-ai-ops-listing-probe', token);
    return {
      status: 'unique',
      token,
      candidateCount: 1,
      text: unique[0].text,
      href: unique[0].href,
    };
  }, asin);
  if (direct.status === 'unique' || direct.status === 'ambiguous_candidates') {
    return direct;
  }

  const dropdown = await page.evaluate((targetAsin) => {
    const token = `aao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const textOf = (element: Element | null | undefined) =>
      String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const rowSelector = 'tr, .el-table__row, .vxe-body--row, [role="row"], [class*="body--row"], [class*="table-row"]';
    const globalToolbarPattern = /(更多筛选|操作记录|上传商品记录|导入配对记录|自动配对记录|导入分配负责人记录|导入本地信息记录|导入标签记录|导入调价记录)/;
    const rowOperationPattern = /(操作|编辑在线商品|编辑本地信息|查看基本)/;
    const targetOperationPattern = /(编辑在线商品|编辑本地信息|查看基本)/;
    const isOperationDropdown = (element: Element) => {
      const text = textOf(element);
      const label = [
        text,
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || '',
        element.getAttribute('class') || '',
      ].join(' ');
      if (globalToolbarPattern.test(label)) return false;
      if (!rowOperationPattern.test(label)) return false;
      if (targetOperationPattern.test(label)) return true;
      const parentText = textOf(element.closest('td, [role="cell"], .vxe-cell, .el-table__cell'));
      return targetOperationPattern.test(parentText);
    };
    const allRows = Array.from(document.querySelectorAll(rowSelector));
    const asinRows = allRows
      .filter((element) => {
        const text = textOf(element);
        return text.toUpperCase().includes(targetAsin.toUpperCase()) && !globalToolbarPattern.test(text) && isVisible(element);
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { element, top: Math.round(rect.top), text: textOf(element) };
      });
    if (asinRows.length === 0) {
      return { status: 'no_asin_row', candidateCount: 0, reason: '当前页面没有找到包含目标 ASIN 的可见行。' };
    }

    const operationDropdowns = Array.from(document.querySelectorAll('.ak-dropdown, [class*="dropdown"], [role="button"], button'))
      .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element))
      .filter(isOperationDropdown)
      .map((element) => {
        const row = element.closest(rowSelector);
        const rect = (row || element).getBoundingClientRect();
        return { element, top: Math.round(rect.top), text: textOf(element), rowText: textOf(row || element) };
      })
      .filter((candidate) =>
        asinRows.some((row) =>
          candidate.rowText.toUpperCase().includes(targetAsin.toUpperCase())
          || Math.abs(candidate.top - row.top) <= 6
        )
      )
      .filter((candidate, index, list) =>
        list.findIndex((item) => item.element === candidate.element) === index
      );

    const preferredDropdowns = operationDropdowns.filter((candidate) => targetOperationPattern.test(candidate.text));
    const selectedDropdowns = preferredDropdowns.length > 0 ? preferredDropdowns : operationDropdowns;

    if (selectedDropdowns.length === 1) {
      const trigger = Array.from(selectedDropdowns[0].element.querySelectorAll('span, a, button, [role="button"]'))
        .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element))
        .find((element) => /^操作\s*$/.test(textOf(element)))
        || selectedDropdowns[0].element;
      trigger.setAttribute('data-amazon-ai-ops-listing-probe-dropdown', token);
      return {
        status: 'dropdown_unique',
        token,
        candidateCount: 1,
        text: selectedDropdowns[0].text,
      };
    }
    if (selectedDropdowns.length > 1) {
      return {
        status: 'ambiguous_dropdowns',
        candidateCount: selectedDropdowns.length,
        text: selectedDropdowns.slice(0, 3).map((candidate) => candidate.text || '未命名下拉').join('；'),
        reason: '目标 ASIN 视觉行内发现多个操作下拉候选，需要更精确 selector。',
      };
    }
    return { status: 'no_candidate', candidateCount: 0, reason: '目标 ASIN 行内没有可见的详情/查看/编辑入口。' };
  }, asin);
  if (dropdown.status !== 'dropdown_unique' || !dropdown.token) {
    return dropdown;
  }

  const dropdownLocator = page.locator(`[data-amazon-ai-ops-listing-probe-dropdown="${dropdown.token}"]`).first();
  await dropdownLocator.hover({ timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await dropdownLocator.click({ timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  return page.evaluate((dropdownText) => {
    const token = `aao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const textOf = (element: Element | null | undefined) =>
      String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const priority = ['编辑在线商品', '查看基本', '编辑本地信息'];
    const items = Array.from(document.querySelectorAll('.el-dropdown-menu__item, [role="menuitem"], .el-dropdown-menu *, .ak-dropdown-menu *, li, a, button, span'))
      .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element))
      .map((element) => ({ element, text: textOf(element), href: element instanceof HTMLAnchorElement ? element.href : '' }))
      .filter((item) => priority.some((label) => item.text === label || item.text.includes(label)));
    const selected = priority
      .map((label) => items.find((item) => item.text === label) || items.find((item) => item.text.includes(label)))
      .find(Boolean);
    if (!selected) {
      return {
        status: 'no_safe_dropdown_item',
        candidateCount: items.length,
        text: dropdownText,
        reason: '已展开操作下拉，但没有找到明确的编辑在线商品/查看基本/编辑本地信息入口。',
      };
    }
    selected.element.setAttribute('data-amazon-ai-ops-listing-probe', token);
    return {
      status: 'unique',
      token,
      candidateCount: 1,
      text: selected.text,
      href: selected.href,
    };
  }, dropdown.text || '');
}

function parseLingxingListingReadUrl(input: unknown): string {
  const rawUrl = typeof input === 'string'
    ? input
    : input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string'
      ? (input as { url: string }).url
      : '';
  if (!rawUrl.trim()) {
    throw new Error('请输入领星 Listing 页面 URL');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('领星 Listing URL 无效');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !['erp.lingxing.com', 'ads.lingxing.com'].includes(host)) {
    throw new Error('仅允许打开领星 ERP/Ads 的 HTTPS 页面用于只读读取。');
  }
  const pathText = `${url.pathname} ${url.search}`.toLowerCase();
  if (!/(listing|product|goods|spu|sku)/i.test(pathText)) {
    throw new Error('该 URL 看起来不是 Listing/商品相关页面，请打开领星 Listing 页面后再读取。');
  }
  url.hash = '';
  return url.toString();
}

function handleBuildListingSuggestions(listing: ListingContent, opportunities: KeywordOpportunity[]): ListingSuggestion[] {
  validateListing(listing);
  validateArray(opportunities, 'opportunities', 10000);
  for (const opportunity of opportunities) {
    validateOpportunity(opportunity);
  }
  const suggestions = buildSafeListingSuggestions(listing, opportunities, { appVersion: APP_VERSION });

  if (state.db) {
    const persistedSuggestions: ListingSuggestion[] = [];
    const save = state.db.transaction(() => {
      const insert = state.db!.prepare(`
        INSERT INTO listing_suggestions
          (asin, keyword, section, current_text, suggested_text, evidence, risk_warnings_json, status, created_at)
        VALUES
          (@asin, @keyword, @section, @currentText, @suggestedText, @evidence, @riskWarningsJson, @status, @createdAt)
      `);
      for (const suggestion of suggestions) {
        const createdAt = suggestion.createdAt ?? new Date().toISOString();
        const result = insert.run({
          ...suggestion,
          currentText: suggestion.currentText ?? null,
          createdAt,
          riskWarningsJson: JSON.stringify(suggestion.riskWarnings),
        });
        persistedSuggestions.push({
          ...suggestion,
          id: Number(result.lastInsertRowid),
          createdAt,
        });
      }
    });
    save();
    return persistedSuggestions;
  }

  return suggestions;
}

function handleUpdateListingSuggestionStatus(id: number, status: ListingSuggestion['status']): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Listing 建议 ID 无效');
  }
  if (!['pending', 'accepted', 'ignored'].includes(status)) {
    throw new Error('Listing 建议状态无效');
  }
  state.db?.prepare(`
    UPDATE listing_suggestions
    SET status = @status, updated_at = datetime('now')
    WHERE id = @id
  `).run({ id, status });
}

async function handleGenerateListingDrafts(suggestions: ListingSuggestion[]): Promise<ListingDraft[]> {
  validateArray(suggestions, 'suggestions', 20000);
  for (const suggestion of suggestions) {
    validateSuggestion(suggestion);
  }

  let drafts = buildRuleBasedListingDrafts(suggestions, { appVersion: APP_VERSION });
  const settings = readAiSettingsForMain();
  const aiApiKey = settings.aiApiKey;

  if (aiApiKey) {
    drafts = await generateAiListingDrafts(drafts, settings);
  } else {
    drafts = drafts.map((draft) => ({
      ...draft,
      aiFallbackReason: '未配置 AI Key，使用规则草案',
    }));
  }

  return persistListingDrafts(drafts);
}

async function generateAiListingDrafts(drafts: ListingDraft[], settings: Record<string, string>): Promise<ListingDraft[]> {
  const provider = new OpenAICompatibleProvider(buildAiProviderConfig(settings));
  const promptTemplate = readPromptTemplate('listing-rewrite.md');
  const model = settings.aiModel || settings.ai_model || 'deepseek-v4-flash';

  const enhanced: ListingDraft[] = [];
  for (const draft of drafts) {
    let response;
    try {
      response = await provider.complete(buildListingRewritePrompt(promptTemplate, draft, settings), {
        temperature: 0.3,
        maxTokens: parseIntegerSetting(settings.aiMaxTokens || settings.ai_max_tokens, 8192),
        responseFormat: 'json_object',
      });
    } catch (error) {
      recordListingAiCallLog({
        draft,
        model,
        outputJson: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      enhanced.push({
        ...draft,
        aiFallbackReason: `AI 调用异常：${error instanceof Error ? error.message : String(error)}，使用规则草案`,
      });
      continue;
    }
    if (!response.success || !response.content) {
      recordListingAiCallLog({
        draft,
        model,
        outputJson: response.content || JSON.stringify({ error: response.error || 'empty_content' }),
        success: false,
        errorMessage: response.error || 'AI 未返回草案内容',
      });
      enhanced.push({
        ...draft,
        aiFallbackReason: response.error ? `AI 生成失败：${response.error}` : 'AI 未返回草案内容，使用规则草案',
      });
      continue;
    }

    const parsed = parseAiDraftResponse(response.content);
    recordListingAiCallLog({
      draft,
      model,
      outputJson: response.content,
      success: Boolean(parsed),
      errorMessage: parsed ? undefined : 'AI 响应无法解析为 listing_rewrite_v1 JSON 或中文理由校验失败',
    });
    enhanced.push(parsed
      ? {
          ...draft,
          draftedText: parsed.suggestedText,
          riskWarnings: Array.from(new Set([...draft.riskWarnings, ...parsed.riskWarnings])),
          evidence: `${draft.evidence}\nAI 理由：${parsed.reason}`,
          source: 'ai',
          aiFallbackReason: undefined,
        }
      : {
          ...draft,
          aiFallbackReason: 'AI 响应无法解析为 Listing 草案，使用规则草案',
        });
  }

  return enhanced;
}

function recordListingAiCallLog(input: {
  draft: ListingDraft;
  model: string;
  outputJson: string;
  success: boolean;
  errorMessage?: string;
}): void {
  try {
    state.aiCallLogRepo?.insert(buildListingAiCallLogInput(input));
  } catch (error) {
    console.warn('[AI] Failed to write Listing AI call log', error);
  }
}

function stringSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAiSettings(settings: Record<string, unknown>): Record<string, string> {
  return normalizeAiSettingsRecord(settings);
}

function buildAiProviderConfig(settings: Record<string, unknown>) {
  return buildSystemAiProviderConfig(resolveSystemAiRuntimeConfig(settings));
}

async function handleTestAiSettings(settings: Record<string, unknown>) {
  const runtime = resolveSystemAiRuntimeConfig(settings || {});
  const config = buildSystemAiProviderConfig(runtime);
  function persistTestStatus(status: 'available' | 'failed', message: string) {
    const testedAt = new Date().toISOString();
    persistAiSettingsForMain({
      aiProvider: runtime.provider,
      ai_provider: runtime.provider,
      aiApiKey: config.apiKey,
      ai_api_key: config.apiKey,
      aiBaseUrl: config.baseUrl,
      ai_base_url: config.baseUrl,
      aiModel: config.model,
      ai_model: config.model,
      aiTemperature: String(config.temperature),
      ai_temperature: String(config.temperature),
      aiMaxTokens: String(config.maxTokens),
      ai_max_tokens: String(config.maxTokens),
      aiOutputLanguage: normalizeAiSettings(settings).aiOutputLanguage,
      ai_output_language: normalizeAiSettings(settings).ai_output_language,
      aiPersona: normalizeAiSettings(settings).aiPersona,
      ai_persona: normalizeAiSettings(settings).ai_persona,
      aiLastTestStatus: status,
      ai_last_test_status: status,
      aiLastTestAt: testedAt,
      ai_last_test_at: testedAt,
      aiLastTestBaseUrl: config.baseUrl,
      ai_last_test_base_url: config.baseUrl,
      aiLastTestModel: config.model,
      ai_last_test_model: config.model,
      aiLastTestMessage: message,
      ai_last_test_message: message,
    });
  }

  if (!config.apiKey.trim()) {
    const message = '未配置 AI Key：请填写 DeepSeek 或 OpenAI 兼容 API Key 后再测试。';
    return {
      success: false,
      message,
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  const provider = new OpenAICompatibleProvider(config);
  const response = await provider.complete('只回复 ok，用于连接测试。', {
    model: config.model,
    temperature: 0,
    maxTokens: 32,
  });

  if (!response.success || !response.content) {
    const message = summarizeAiError(response.error || 'AI 未返回内容');
    persistTestStatus('failed', message);
    return {
      success: false,
      message,
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  const message = `AI 连接测试通过：${config.model}`;
  persistTestStatus('available', message);
  return {
    success: true,
    message,
    baseUrl: config.baseUrl,
    model: config.model,
    usage: response.usage,
  };
}

function handleListAiCallLogs(request: any = {}) {
  if (!state.aiCallLogRepo) return [];
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(20, Number(request.limit))) : 5;
  return state.aiCallLogRepo.findRecent(limit);
}

function parseNumberSetting(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerSetting(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function summarizeAiError(error: string): string {
  const firstLine = String(error || '').split(/\r?\n/).find(Boolean) || '未知错误';
  if (/401|unauthorized|invalid api key/i.test(firstLine)) {
    return 'AI 连接失败：API Key 无效或没有权限。';
  }
  if (/429|rate limit|quota/i.test(firstLine)) {
    return 'AI 连接失败：额度不足或请求频率过高。';
  }
  if (/network|fetch|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(firstLine)) {
    return 'AI 连接失败：网络或 Base URL 不可达。';
  }
  return `AI 连接失败：${firstLine.slice(0, 240)}`;
}

function persistListingDrafts(drafts: ListingDraft[]): ListingDraft[] {
  if (!state.db || drafts.length === 0) return drafts;

  const persisted: ListingDraft[] = [];
  const storeName = readCurrentOperationScopeValue('storeName') || null;
  const marketplaceCode = readCurrentOperationScopeValue('marketplaceCode') || null;
  const save = state.db.transaction(() => {
    const insert = state.db!.prepare(`
      INSERT INTO listing_drafts
        (asin, store_name, marketplace_code, section, current_text, drafted_text, keywords_json, evidence, risk_warnings_json, source, ai_fallback_reason, status, created_at)
      VALUES
        (@asin, @storeName, @marketplaceCode, @section, @currentText, @draftedText, @keywordsJson, @evidence, @riskWarningsJson, @source, @aiFallbackReason, @status, @createdAt)
    `);
    for (const draft of drafts) {
      const createdAt = draft.createdAt ?? new Date().toISOString();
      const result = insert.run({
        ...draft,
        storeName,
        marketplaceCode,
        currentText: draft.currentText ?? null,
        keywordsJson: JSON.stringify(draft.keywords),
        riskWarningsJson: JSON.stringify(draft.riskWarnings),
        aiFallbackReason: draft.aiFallbackReason ?? null,
        createdAt,
      });
      persisted.push({
        ...draft,
        id: Number(result.lastInsertRowid),
        createdAt,
      });
    }
  });
  save();
  return persisted;
}

function readPromptTemplate(filename: string): string {
  const promptPath = path.join(getBundledResourcesPath(), 'prompts', filename);
  if (!fs.existsSync(promptPath)) {
    return '';
  }
  return fs.readFileSync(promptPath, 'utf8');
}

async function handleExportListingSuggestions(suggestions: ListingSuggestion[], format: 'csv' | 'markdown' | 'xlsx'): Promise<string> {
  validateArray(suggestions, 'suggestions', 20000);
  if (!['csv', 'markdown', 'xlsx'].includes(format)) {
    throw new Error('导出格式只支持 csv、xlsx 或 markdown');
  }

  const extension = format === 'markdown' ? 'md' : format;
  const output = format === 'markdown'
    ? suggestionsToMarkdown(suggestions)
    : format === 'xlsx'
      ? suggestionsToXlsxBuffer(suggestions)
      : suggestionsToCsv(suggestions);
  const exportDir = EXPORTS_DIR;
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  const filePath = path.join(exportDir, `listing_suggestions_${Date.now()}.${extension}`);
  fs.writeFileSync(filePath, output, typeof output === 'string' ? 'utf8' : undefined);
  return filePath;
}

async function handleExportListingDrafts(drafts: ListingDraft[], format: 'csv' | 'markdown' | 'xlsx'): Promise<string> {
  validateArray(drafts, 'drafts', 20000);
  if (!['csv', 'markdown', 'xlsx'].includes(format)) {
    throw new Error('导出格式只支持 csv、xlsx 或 markdown');
  }
  for (const draft of drafts) {
    validateListingDraft(draft);
  }

  const extension = format === 'markdown' ? 'md' : format;
  const output = format === 'markdown'
    ? draftsToMarkdown(drafts)
    : format === 'xlsx'
      ? draftsToXlsxBuffer(drafts)
      : draftsToCsv(drafts);
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }
  const filePath = path.join(EXPORTS_DIR, `listing_drafts_${Date.now()}.${extension}`);
  fs.writeFileSync(filePath, output, typeof output === 'string' ? 'utf8' : undefined);
  return filePath;
}

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

function readJsonFile(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestFileByPattern(directory: string, pattern: RegExp): string | null {
  if (!fs.existsSync(directory)) return null;
  const files = fs.readdirSync(directory)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(directory, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function configuredFinalReadinessPath(): string | null {
  const configured = process.env.AMAZON_AI_OPS_FINAL_READINESS_PATH || process.env.FINAL_READINESS_PATH;
  if (!configured || !configured.trim()) return null;
  return path.resolve(configured);
}

function getFinalReadinessPath(): string | null {
  const configured = configuredFinalReadinessPath();
  if (configured) return configured;
  return latestFileByPattern(CODEX_EVIDENCE_DIR, /^final-readiness-.*\.json$/i);
}

function missingReadinessView(message: string): DeliveryReadinessView {
  return buildMissingReadinessView(message, configuredFinalReadinessPath());
}

function sanitizeAiSettingsForRenderer(settings: Record<string, unknown>): Record<string, string | boolean> {
  return sanitizeAiSettingsForRendererRecord(settings);
}

function normalizeAiSettingsForSave(incoming: Record<string, unknown>): Record<string, string> {
  return normalizeAiSettingsForSaveInput(incoming, readAiSettingsForMain());
}

function normalizeAiSettingsForTest(incoming: Record<string, unknown>): Record<string, string> {
  return normalizeAiSettingsForTestInput(incoming, readAiSettingsForMain());
}

function handleGetDeliveryReadiness(): DeliveryReadinessView {
  const finalReadinessPath = getFinalReadinessPath();
  if (!finalReadinessPath) {
    return missingReadinessView(`最终验收 manifest 尚未生成：${CODEX_EVIDENCE_DIR}`);
  }
  if (!fs.existsSync(finalReadinessPath)) {
    return missingReadinessView(`最终验收 manifest 尚未生成：${finalReadinessPath}`);
  }
  try {
    return normalizeDeliveryReadiness(readJsonFile(finalReadinessPath), finalReadinessPath, {
      currentPackage: getPackageEvidenceStatus(path.join(REPO_ROOT_DIR, 'apps', 'desktop', 'release')),
    });
  } catch (error) {
    return {
      ...missingReadinessView(`最终验收 manifest 读取失败：${error instanceof Error ? error.message : String(error)}`),
      path: finalReadinessPath,
      exists: true,
      missing: ['最终验收 manifest 无法解析'],
      actionItems: ['重新运行最终验收，生成可解析的 final-readiness JSON。'],
    };
  }
}

function handleGetStoragePaths() {
  return {
    settingsPath: path.join(USER_DATA_DIR, 'settings.json'),
    evidenceDir: CODEX_EVIDENCE_DIR,
    downloadsDir: DOWNLOADS_DIR,
    exportsDir: EXPORTS_DIR,
    deliveryDir: DELIVERY_BUNDLES_DIR,
    localDbPath: DB_PATH,
  };
}

function handleGetDeliveryEvidenceStatus(input?: unknown) {
  const scope = normalizePersistedOperationScope(input || handleGetOperationScope() || {});
  return getDeliveryEvidenceStatus({
    db: state.db,
    readbackDir: path.join(EXPORTS_DIR, 'ad-readback-evidence'),
    releaseDir: path.join(REPO_ROOT_DIR, 'apps', 'desktop', 'release'),
    scope,
  });
}

function normalizePersistedOperationScope(input: unknown) {
  const request = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const dateFrom = typeof request.dateFrom === 'string' ? request.dateFrom.trim() : '';
  const dateTo = typeof request.dateTo === 'string' ? request.dateTo.trim() : '';
  const storeName = typeof request.storeName === 'string' ? request.storeName.trim() : '';
  const marketplaceCode = typeof request.marketplaceCode === 'string' ? request.marketplaceCode.trim() : '';
  if (!dateFrom || !dateTo || !storeName || !marketplaceCode) {
    throw new Error('运营范围缺少日期、店铺或站点。');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    throw new Error('运营范围日期必须是 YYYY-MM-DD。');
  }
  if (dateFrom > dateTo) {
    throw new Error('运营范围开始日期不能晚于结束日期。');
  }
  return {
    dateFrom,
    dateTo,
    storeName,
    marketplaceCode,
    asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
    batchId: typeof request.batchId === 'string' && request.batchId.trim() ? request.batchId.trim() : undefined,
    currency: 'USD' as const,
  };
}

function currentStoreOperationScopeService(): StoreOperationScopeService {
  if (!state.storeCoordinator || !state.settingsRepo) {
    throw new Error('店铺级运营范围服务尚未初始化。');
  }
  return new StoreOperationScopeService({
    storeCoordinator: state.storeCoordinator,
    settings: state.settingsRepo,
  });
}

function handleGetOperationScope(contextInput?: unknown) {
  const context = contextInput ?? state.storeCoordinator?.getActiveStoreContext();
  if (!context) return null;
  return currentStoreOperationScopeService().get(context as StoreContextEnvelope);
}

function handleSaveOperationScope(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('保存运营范围需要 StoreContext 与 scope。');
  }
  const request = input as { storeContext?: unknown; scope?: unknown };
  if (!request.storeContext || !Object.prototype.hasOwnProperty.call(request, 'scope')) {
    throw new TypeError('保存运营范围需要 StoreContext 与 scope。');
  }
  return currentStoreOperationScopeService().save(
    request.storeContext as StoreContextEnvelope,
    request.scope,
  );
}

function copyDeliveryBundleFile(sourcePath: string | undefined, targetDir: string, targetName: string): string | undefined {
  if (!sourcePath || !fs.existsSync(sourcePath)) return undefined;
  const targetPath = path.join(targetDir, targetName);
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

function handleExportDeliveryBundle(input?: unknown) {
  const readiness = handleGetDeliveryReadiness();
  if (!readiness.available || !readiness.path) {
    return {
      success: false,
      status: 'APP_NEEDS_WORK',
      message: readiness.message || '最终验收 manifest 尚未生成，无法导出交付包。',
      missing: readiness.missing,
      actionItems: readiness.actionItems,
    };
  }
  if (!readiness.manifestDriven) {
    return {
      success: false,
      status: 'APP_NEEDS_WORK',
      message: '最终就绪结果不是 manifest 驱动，请先重新生成 evidence manifest 并运行最终验收。',
      finalReadinessPath: readiness.path,
      missing: ['最终验收结果不是 manifest 驱动'],
      actionItems: ['先运行 write:v15-evidence-manifest，再用该 manifest 运行 verify:v15-final-readiness。'],
    };
  }
  if (!deliveryReadinessAllowsExport(readiness)) {
    return {
      success: false,
      status: readiness.status,
      message: '最终就绪 manifest 未通过，不能导出 READY 交付包。',
      finalReadinessPath: readiness.path,
      gates: readiness.gates,
      missing: readiness.missing,
      actionItems: readiness.actionItems,
    };
  }
  const finalReadiness = readJsonFile(readiness.path);
  const evidenceManifestPath = typeof finalReadiness?.evidenceSelection?.manifestPath === 'string'
    ? path.resolve(finalReadiness.evidenceSelection.manifestPath)
    : '';
  if (!evidenceManifestPath || !fs.existsSync(evidenceManifestPath)) {
    return {
      success: false,
      status: 'APP_NEEDS_WORK',
      message: '最终就绪 evidence manifest 缺失，不能导出 READY 交付包。',
      finalReadinessPath: readiness.path,
      missing: ['最终就绪 evidence manifest 缺失'],
      actionItems: ['重新运行 write:v15-evidence-manifest 和 verify:v15-final-readiness，确认 evidenceSelection.manifestPath 存在。'],
    };
  }
  fs.mkdirSync(DELIVERY_BUNDLES_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bundleDir = path.join(DELIVERY_BUNDLES_DIR, `v15-delivery-bundle-${stamp}`);
  fs.mkdirSync(bundleDir, { recursive: true });
  const manifestPath = path.join(bundleDir, 'delivery-bundle-manifest.json');
  const finalReadinessCopyPath = path.join(bundleDir, path.basename(readiness.path));
  fs.copyFileSync(readiness.path, finalReadinessCopyPath);
  let dataReconciliation: any = {
    success: false,
    blockers: ['未生成数据口径核对报告：交付包导出时没有收到当前运营范围。'],
  };
  let dataReconciliationJsonCopy: string | undefined;
  let dataReconciliationMarkdownCopy: string | undefined;
  try {
    const reconciliationScope = input || handleGetOperationScope() || finalReadiness.scope;
    if (reconciliationScope) {
      dataReconciliation = handleExportDataReconciliation(reconciliationScope);
      dataReconciliationJsonCopy = copyDeliveryBundleFile(dataReconciliation.jsonPath, bundleDir, 'data-reconciliation.json');
      dataReconciliationMarkdownCopy = copyDeliveryBundleFile(dataReconciliation.markdownPath, bundleDir, 'data-reconciliation.md');
    }
  } catch (error) {
    dataReconciliation = {
      success: false,
      blockers: [`数据口径核对报告生成失败：${error instanceof Error ? error.message : String(error)}`],
    };
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    status: readiness.status,
    appReady: readiness.appReady,
    finalReadinessPath: readiness.path,
    finalReadinessCopy: path.basename(finalReadinessCopyPath),
    dataReconciliation: {
      canonicalSource: dataReconciliation.canonicalSource,
      canonical: dataReconciliation.canonical,
      blockers: dataReconciliation.blockers,
      sourceJsonPath: dataReconciliation.jsonPath,
      sourceMarkdownPath: dataReconciliation.markdownPath,
      bundleJson: dataReconciliationJsonCopy ? path.basename(dataReconciliationJsonCopy) : undefined,
      bundleMarkdown: dataReconciliationMarkdownCopy ? path.basename(dataReconciliationMarkdownCopy) : undefined,
    },
    gates: readiness.gates,
    gatesSummary: readiness.gatesSummary,
    note: 'Renderer-triggered delivery bundle marker created from the final readiness manifest. Includes current-scope data reconciliation; full evidence export can be refreshed with export-v15-delivery-bundle.js.',
  }, null, 2)}\n`, 'utf8');
  return {
    success: true,
    status: readiness.status,
    bundleDir,
    manifestPath,
    dataReconciliation: {
      jsonPath: dataReconciliationJsonCopy,
      markdownPath: dataReconciliationMarkdownCopy,
      canonical: dataReconciliation.canonical,
      canonicalSource: dataReconciliation.canonicalSource,
      blockers: dataReconciliation.blockers,
    },
  };
}

function roundMoney(value: unknown): number {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
}

function businessMetricSummaryForExport(sql: string, params: (string | number)[]) {
  const summary = readBusinessMetricSummary(sql, params);
  return {
    rows: Number(summary?.importedRows || 0),
    spend: roundMoney(summary?.totalSpend),
    sales: roundMoney(summary?.totalSales),
    orders: Number(summary?.totalOrders || 0),
    clicks: Number(summary?.totalClicks || 0),
    impressions: Number(summary?.totalImpressions || 0),
    currency: 'USD',
  };
}

function buildDataReconciliationMarkdown(report: any): string {
  const blockers = Array.isArray(report.blockers) && report.blockers.length
    ? report.blockers.map((item: string) => `- ${item}`).join('\n')
    : '- none';
  const files = (report.realReportFiles || [])
    .map((file: any) => `- ${file.reportType}: ${file.filePath} (${file.importedRows || 0} rows)`)
    .join('\n') || '- none';
  const byType = (report.db?.byReportType || [])
    .map((row: any) => `- ${row.reportType || 'unknown'}: ${row.rows} rows, spend ${row.spend} USD, orders ${row.orders}, sales ${row.sales} USD`)
    .join('\n') || '- none';
  return [
    '# Amazon AI Ops Data Reconciliation',
    '',
    `Generated at: ${report.generatedAt}`,
    `Scope: ${report.scope.dateFrom} to ${report.scope.dateTo} / ${report.scope.storeName} / ${report.scope.marketplaceCode} / USD`,
    `Batch ids: ${(report.sourceBatchIds || []).join(', ') || 'none'}`,
    '',
    '## Canonical Totals',
    '',
    `Source: ${report.db?.canonical?.summarySource || 'none'}`,
    `Rows: ${report.db?.totals?.canonical?.rows ?? 0}`,
    `Spend: ${report.db?.totals?.canonical?.spend ?? 0} USD`,
    `Orders: ${report.db?.totals?.canonical?.orders ?? 0}`,
    `Sales: ${report.db?.totals?.canonical?.sales ?? 0} USD`,
    `Clicks: ${report.db?.totals?.canonical?.clicks ?? 0}`,
    '',
    '## Real Report Files',
    '',
    files,
    '',
    '## DB By Report Type',
    '',
    byType,
    '',
    '## Blockers',
    '',
    blockers,
    '',
    '## Interpretation',
    '',
    '- Do not add campaign/ad_group/placement/advertised_product totals together with keyword/search term/targeting totals.',
    '- Canonical totals use user_search_term first, then search_term, then actionable fallback only when no search term table exists.',
    '- This report proves local data consistency only; final delivery still depends on the final readiness manifest.',
    '',
  ].join('\n');
}

function handleExportDataReconciliation(input: unknown) {
  const scope = normalizeBusinessUiScope(input);
  const pipeline = handleGetBusinessUiDataPipeline(scope);
  const sourceFiles = Array.from(new Set((pipeline.collection.realReportFiles || []).flatMap((file: any) => metricSourceFileCandidates(file.filePath))));
  const sourceBatchIds = Array.from(new Set((pipeline.collection.sourceBatchIds || []).filter(Boolean)));
  const metricSource: BusinessMetricSource | undefined = sourceFiles.length > 0
    ? { batchIds: sourceBatchIds, batchId: sourceBatchIds[0], sourceFiles }
    : undefined;
  const blockers = new Set<string>([
    ...(pipeline.collection.blockers || []),
    ...(pipeline.quant.blockers || []),
  ]);
  let dbReport: any = {
    databaseReady: Boolean(state.db),
    availableReportTypes: [],
    canonical: { reportTypes: [], summarySource: 'none', isApproximate: false },
    totals: {
      canonical: { rows: 0, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, currency: 'USD' },
      actionable: { rows: 0, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, currency: 'USD' },
      breakdown: { rows: 0, spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0, currency: 'USD' },
    },
    byReportType: [],
  };

  if (!state.db) {
    blockers.add('本地数据库不可用，无法导出口径核对。');
  } else if (!metricSource) {
    blockers.add('当前范围缺少真实报表文件，无法绑定 DB 指标来源。');
  } else {
    const allMetrics = businessMetricsWhere(scope, metricSource, 'all');
    const actionableMetrics = businessMetricsWhere(scope, metricSource, 'actionable');
    const breakdownMetrics = businessMetricsWhere(scope, metricSource, 'breakdown');
    const availableReportTypes = loadAvailableBusinessMetricReportTypes(allMetrics.sql, allMetrics.params);
    const canonical = adMetricCanonicalWhere(availableReportTypes);
    const canonicalSql = `${allMetrics.sql} AND ${canonical.whereSql}`;
    const byReportType = state.db.prepare(`
      SELECT
        report_type AS reportType,
        COUNT(*) AS rows,
        ROUND(COALESCE(SUM(cost), 0), 2) AS spend,
        COALESCE(SUM(orders), 0) AS orders,
        ROUND(COALESCE(SUM(sales), 0), 2) AS sales,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(impressions), 0) AS impressions
      FROM ad_daily_metrics
      WHERE ${allMetrics.sql}
      GROUP BY report_type
      ORDER BY report_type
    `).all(...allMetrics.params) as any[];
    dbReport = {
      databaseReady: true,
      availableReportTypes,
      canonical: canonical.selection,
      totals: {
        canonical: businessMetricSummaryForExport(canonicalSql, allMetrics.params),
        actionable: businessMetricSummaryForExport(actionableMetrics.sql, actionableMetrics.params),
        breakdown: businessMetricSummaryForExport(breakdownMetrics.sql, breakdownMetrics.params),
      },
      byReportType: byReportType.map((row) => ({
        reportType: row.reportType || 'unknown',
        rows: Number(row.rows || 0),
        spend: roundMoney(row.spend),
        orders: Number(row.orders || 0),
        sales: roundMoney(row.sales),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
      })),
    };
    if (canonical.selection.warning) blockers.add(canonical.selection.warning);
    if (dbReport.totals.canonical.rows === 0) blockers.add('DB canonical 汇总行数为 0，不能证明广告总盘口径。');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    scope: pipeline.scope,
    sourceBatchIds,
    dbPath: DB_PATH,
    collection: {
      status: pipeline.collection.status,
      realReportFileCount: pipeline.collection.fileAudit.realReportFileCount,
      importedRowCount: pipeline.collection.fileAudit.importedRowCount,
      missingReportLabels: pipeline.collection.fileAudit.missingReportLabels,
      manifestPath: pipeline.collection.fileAudit.manifestPath,
      downloadDir: pipeline.collection.fileAudit.downloadDir,
    },
    realReportFiles: pipeline.collection.realReportFiles.map((file: any) => ({
      reportType: file.reportType,
      displayName: file.displayName,
      filePath: file.filePath,
      fileSizeBytes: file.fileSizeBytes,
      importedRows: file.importedRows,
      fileHash: file.fileHash,
      status: file.status,
    })),
    quant: {
      summarySource: pipeline.quant.summarySource,
      canonicalRows: pipeline.quant.canonicalRows,
      actionableRows: pipeline.quant.actionableRows,
      breakdownRows: pipeline.quant.breakdownRows,
      totalSpend: roundMoney(pipeline.quant.totalSpend),
      totalSales: roundMoney(pipeline.quant.totalSales),
      totalOrders: Number(pipeline.quant.totalOrders || 0),
      totalClicks: Number(pipeline.quant.totalClicks || 0),
      acos: pipeline.quant.acos,
    },
    db: dbReport,
    blockers: Array.from(blockers).filter(Boolean),
  };

  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `data-reconciliation-${safeFileSegment(scope.dateFrom)}_${safeFileSegment(scope.dateTo)}_${safeFileSegment(scope.storeName)}_${safeFileSegment(scope.marketplaceCode)}_${stamp}`;
  const jsonPath = path.join(EXPORTS_DIR, `${baseName}.json`);
  const markdownPath = path.join(EXPORTS_DIR, `${baseName}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, buildDataReconciliationMarkdown(report), 'utf8');
  return {
    success: true,
    jsonPath,
    markdownPath,
    canonical: dbReport.totals.canonical,
    canonicalSource: dbReport.canonical.summarySource,
    blockers: report.blockers,
  };
}

function handleExportDataReconciliationArtifacts(input: unknown) {
  const result = handleExportDataReconciliation(input);
  const store = currentArtifactStore();
  const jsonArtifact = issueRendererArtifact(store.storeId, result.jsonPath, 'export-file', '数据对账 JSON');
  const markdownArtifact = issueRendererArtifact(store.storeId, result.markdownPath, 'export-file', '数据对账 Markdown');
  if (!jsonArtifact || !markdownArtifact) {
    throw new Error('数据对账已导出，但受控工件登记失败。');
  }
  return rendererPayload({
    success: result.success,
    jsonArtifactId: jsonArtifact.artifactId,
    jsonDisplayName: jsonArtifact.displayName,
    markdownArtifactId: markdownArtifact.artifactId,
    markdownDisplayName: markdownArtifact.displayName,
    canonical: result.canonical,
    canonicalSource: result.canonicalSource,
    blockers: result.blockers.map((item: unknown) => rendererSafeDetail(item) || ''),
  });
}

function downloadCenterDiagnosticChecklist(diagnostic: DownloadCenterDiagnosticResult, readiness: ReturnType<typeof getDownloadCenterAutomationReadiness>): string {
  const missing = readiness.missing.length > 0 ? readiness.missing.join(', ') : 'none';
  return [
    '# Lingxing Download Center Diagnostic Bundle',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `App version: ${APP_VERSION}`,
    `Checked URL: ${diagnostic.url || 'unknown'}`,
    `Diagnostic ready: ${diagnostic.ready ? 'yes' : 'no'}`,
    `Automation ready: ${readiness.ready ? 'yes' : 'no'}`,
    `Readiness reason: ${readiness.reason || 'none'}`,
    `Missing readiness items: ${missing}`,
    '',
    '## Manual Verification Checklist',
    '',
    '- Confirm the URL is the real Lingxing download center.',
    '- Confirm all 8 report names match the live page.',
    '- Confirm start and end date fields apply the selected range before report creation.',
    '- Confirm create, status, ready-row, and download selectors each match one visible target.',
    '- Confirm ready-row, status, and download selectors are scoped by both report identity and date range.',
    '- Confirm downloaded filenames include the selected start and end date tokens.',
    '- Keep `requiresManualVerification: true` until every item above is proven from screenshot/DOM evidence.',
    '',
    '## Files',
    '',
    '- `diagnostic.json`: persisted diagnostic result.',
    '- `active-page-model.json`: page model active when the bundle was exported.',
    '- `readiness.json`: structural automation readiness result.',
    '- `selector-candidates.json`: candidate selectors found on the live page.',
    '- `action-selector-checks.json`: locator counts and usability checks for configured action selectors.',
    '- `screenshot.*`: copied diagnostic screenshot when available.',
    '- `dom-snapshot.*`: copied sanitized DOM evidence when available.',
    '',
  ].join('\n');
}

function handleExportDownloadCenterDiagnosticBundle(diagnosticId: number): string {
  if (!Number.isInteger(diagnosticId) || diagnosticId <= 0) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const diagnostic = loadPersistedDownloadCenterDiagnostic(diagnosticId, '', '');
  if (!diagnostic) {
    throw new Error(`未找到下载中心诊断记录：${diagnosticId}`);
  }
  const activeContext = state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext) throw new Error('请先选择店铺，再导出下载中心诊断。');
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  if (
    diagnostic.storeName !== authorized.target.storeName
    || diagnostic.marketplaceCode !== authorized.target.marketplaceCode
  ) {
    throw new Error('诊断记录不属于当前店铺，拒绝导出。');
  }
  const capsule = storeCapsuleFor(authorized.store);
  const model = diagnostic.pageModelSnapshot ?? readDownloadCenterPageModel();
  const readiness = getDownloadCenterAutomationReadiness(model);
  const bundleDir = path.join(capsule.evidenceDir, `download_center_diagnostic_${diagnosticId}_${Date.now()}`);
  fs.mkdirSync(bundleDir, { recursive: true });

  const screenshotCopyPath = copyDiagnosticEvidenceFileToBundle(diagnostic.screenshotPath, bundleDir, 'screenshot', capsule.screenshotsDir, new Set(['.png', '.jpg', '.jpeg']));
  const domSnapshotCopyPath = copyDiagnosticEvidenceFileToBundle(diagnostic.domSnapshotPath, bundleDir, 'dom-snapshot', capsule.evidenceDir, new Set(['.html', '.htm']));
  const bundleDiagnostic = {
    ...diagnostic,
    copiedScreenshotPath: screenshotCopyPath,
    copiedDomSnapshotPath: domSnapshotCopyPath,
  };

  fs.writeFileSync(path.join(bundleDir, 'diagnostic.json'), `${JSON.stringify(bundleDiagnostic, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'active-page-model.json'), `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'readiness.json'), `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'selector-candidates.json'), `${JSON.stringify(diagnostic.selectorCandidates ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'action-selector-checks.json'), `${JSON.stringify(diagnostic.actionSelectorChecks ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'manual-verification-checklist.md'), downloadCenterDiagnosticChecklist(diagnostic, readiness), 'utf8');
  return bundleDir;
}

function handleExportDownloadCenterPageModelDraft(diagnosticId: number): { exportPath: string; draft: DownloadCenterPageModel; notes: string[] } {
  if (!Number.isInteger(diagnosticId) || diagnosticId <= 0) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const diagnostic = loadPersistedDownloadCenterDiagnostic(diagnosticId, '', '');
  if (!diagnostic) {
    throw new Error(`未找到下载中心诊断记录：${diagnosticId}`);
  }
  const activeContext = state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext) throw new Error('请先选择店铺，再导出页面模型草稿。');
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  if (
    diagnostic.storeName !== authorized.target.storeName
    || diagnostic.marketplaceCode !== authorized.target.marketplaceCode
  ) {
    throw new Error('诊断记录不属于当前店铺，拒绝生成页面模型草稿。');
  }
  const capsule = storeCapsuleFor(authorized.store);
  const baseModel = diagnostic.pageModelSnapshot ?? readDownloadCenterPageModel();
  const draftResult = buildDownloadCenterPageModelDraft(baseModel, diagnostic);
  const draftDir = path.join(capsule.evidenceDir, `download_center_page_model_draft_${diagnosticId}_${Date.now()}`);
  fs.mkdirSync(draftDir, { recursive: true });
  fs.writeFileSync(path.join(draftDir, 'page-model-draft.json'), `${JSON.stringify(draftResult.draft, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(draftDir, 'solidification-notes.md'), downloadCenterPageModelDraftToMarkdown(draftResult, diagnostic), 'utf8');
  fs.writeFileSync(path.join(draftDir, 'selector-candidates.json'), `${JSON.stringify(diagnostic.selectorCandidates ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(draftDir, 'action-selector-checks.json'), `${JSON.stringify(diagnostic.actionSelectorChecks ?? [], null, 2)}\n`, 'utf8');
  return { exportPath: draftDir, draft: draftResult.draft, notes: draftResult.notes };
}

function handleExportDownloadCenterPageModelEnablementAudit(
  input: unknown,
  diagnosticId?: number,
): { exportPath: string; canDisableManualVerification: boolean; missing: string[] } {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const submittedContext = request.storeContext ?? state.storeCoordinator?.getActiveStoreContext();
  if (!submittedContext) throw new Error('请先选择店铺，再导出页面模型放行审计。');
  const authorized = authorizedLingxingCollectionTarget(submittedContext);
  const target = authorized.target;
  const capsule = storeCapsuleFor(authorized.store);
  validateDateRange(dateRange);
  if (diagnosticId !== undefined && (!Number.isInteger(diagnosticId) || diagnosticId <= 0)) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const model = readDownloadCenterPageModel();
  const diagnostic = diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(diagnosticId, dateRange.start, dateRange.end)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(model, dateRange.start, dateRange.end, target);
  const selectorEvidenceReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, diagnostic, { target })
    : undefined;
  const diagnosticFileReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceFiles(diagnostic, {
      screenshotsDir: capsule.screenshotsDir,
      domSnapshotsDir: capsule.evidenceDir,
    })
    : undefined;
  const diagnosticEvidenceReadiness = selectorEvidenceReadiness && diagnosticFileReadiness
    ? {
      ...selectorEvidenceReadiness,
      ready: selectorEvidenceReadiness.ready && diagnosticFileReadiness.ready,
      missing: Array.from(new Set([...selectorEvidenceReadiness.missing, ...diagnosticFileReadiness.missing])),
      reason: selectorEvidenceReadiness.ready ? diagnosticFileReadiness.reason : selectorEvidenceReadiness.reason,
    }
    : selectorEvidenceReadiness;
  const canaryReportTypes = loadSuccessfulCanaryReportTypesForScope(dateRange, target);
  const canaryEvidenceReadiness = evaluateDownloadCenterCanaryEvidenceReadiness(canaryReportTypes);
  const audit = auditDownloadCenterPageModelEnablement(model, dateRange, diagnostic, {
    target,
    diagnosticEvidenceReadiness,
    canaryEvidenceReadiness,
  });
  const auditDir = path.join(
    capsule.evidenceDir,
    `download_center_page_model_enablement_${safeFileSegment(dateRange.start)}_${safeFileSegment(dateRange.end)}_${Date.now()}`,
  );
  writeDownloadCenterPageModelEnablementAuditBundle({
    auditDir,
    audit,
    model,
    diagnostic,
    directories: {
      screenshotsDir: capsule.screenshotsDir,
      domSnapshotsDir: capsule.evidenceDir,
    },
  });
  return {
    exportPath: auditDir,
    canDisableManualVerification: audit.canDisableManualVerification,
    missing: audit.checks.flatMap((check) => check.missing),
  };
}

function handleExportLingxingAcceptanceAudit(batchId: string, diagnosticId?: number): string {
  if (typeof batchId !== 'string' || !batchId.trim()) {
    throw new Error('领星验收审计需要有效批次 ID');
  }
  const persisted = loadPersistedLingxingBatch(batchId);
  const { batch, files } = persisted;
  const activeContext = state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext || batch.storeId !== activeContext.storeId) {
    throw new Error('领星批次不属于当前店铺，拒绝导出验收审计。');
  }
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  const target = authorized.target;
  const capsule = storeCapsuleFor(authorized.store);
  const activeModel = readDownloadCenterPageModel();
  const diagnostic = diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(diagnosticId, batch.dateStart, batch.dateEnd)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(activeModel, batch.dateStart, batch.dateEnd, target);
  const selectorEvidenceReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceReadiness(activeModel, { start: batch.dateStart, end: batch.dateEnd }, diagnostic, { target })
    : undefined;
  const diagnosticFileReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceFiles(diagnostic, {
      screenshotsDir: capsule.screenshotsDir,
      domSnapshotsDir: capsule.evidenceDir,
    })
    : undefined;
  const diagnosticEvidenceReadiness = selectorEvidenceReadiness && diagnosticFileReadiness
    ? {
      ...selectorEvidenceReadiness,
      ready: selectorEvidenceReadiness.ready && diagnosticFileReadiness.ready,
      missing: Array.from(new Set([...selectorEvidenceReadiness.missing, ...diagnosticFileReadiness.missing])),
      reason: selectorEvidenceReadiness.ready ? diagnosticFileReadiness.reason : selectorEvidenceReadiness.reason,
    }
    : selectorEvidenceReadiness;
  const manifest = readLingxingManifestForAudit(batch);
  const audit = auditLingxingAcceptanceEvidence({
    batch,
    files,
    diagnostic,
    diagnosticTarget: target,
    diagnosticEvidenceReadiness,
    manifest,
    fileExists: (filePath) => {
      try {
        return isPathWithinRealDirectory(filePath, batch.downloadDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    },
    getFileSizeBytes: (filePath) => {
      try {
        if (!isPathWithinRealDirectory(filePath, batch.downloadDir)) return undefined;
        const stat = fs.statSync(filePath);
        return stat.isFile() ? stat.size : undefined;
      } catch {
        return undefined;
      }
    },
  });
  const auditDir = path.join(capsule.evidenceDir, `lingxing_acceptance_audit_${safeFileSegment(batch.id)}_${Date.now()}`);
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'acceptance-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'acceptance-audit.md'), lingxingAcceptanceAuditToMarkdown(audit), 'utf8');
  fs.writeFileSync(path.join(auditDir, 'filename-date-range-analysis.json'), `${JSON.stringify(audit.filenameDateRangeAnalyses, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'batch-result.json'), `${JSON.stringify({ batch, files }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'downloaded-report-files.json'), `${JSON.stringify(buildDownloadedReportEvidenceIndex(batch, files), null, 2)}\n`, 'utf8');
  const failureEvidenceFiles = copyReportFailureEvidenceFilesToBundle(files, auditDir, {
    screenshotsDir: capsule.screenshotsDir,
    domSnapshotsDir: capsule.evidenceDir,
    tracesDir: capsule.tracesDir,
  });
  fs.writeFileSync(path.join(auditDir, 'report-failure-evidence-files.json'), `${JSON.stringify(failureEvidenceFiles, null, 2)}\n`, 'utf8');
  if (diagnostic) {
    const copiedScreenshotPath = copyDiagnosticEvidenceFileToBundle(diagnostic.screenshotPath, auditDir, 'diagnostic-screenshot', capsule.screenshotsDir, new Set(['.png', '.jpg', '.jpeg']));
    const copiedDomSnapshotPath = copyDiagnosticEvidenceFileToBundle(diagnostic.domSnapshotPath, auditDir, 'diagnostic-dom-snapshot', capsule.evidenceDir, new Set(['.html', '.htm']));
    fs.writeFileSync(path.join(auditDir, 'diagnostic.json'), `${JSON.stringify({
      ...diagnostic,
      copiedScreenshotPath,
      copiedDomSnapshotPath,
    }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(auditDir, 'diagnostic-evidence-files.json'), `${JSON.stringify({
      sourceScreenshotPath: diagnostic.screenshotPath,
      sourceDomSnapshotPath: diagnostic.domSnapshotPath,
      copiedScreenshotPath,
      copiedDomSnapshotPath,
      readiness: diagnosticFileReadiness,
    }, null, 2)}\n`, 'utf8');
  }
  if (batch.manifestPath && isSafeManifestPath(batch.manifestPath, batch.downloadDir)) {
    fs.copyFileSync(fs.realpathSync(batch.manifestPath), path.join(auditDir, 'manifest.json'));
  }
  return auditDir;
}

function loadPersistedLingxingBatch(batchId: string): { batch: LingxingReportBatch; files: LingxingReportFile[] } {
  if (!state.db) {
    throw new Error('本地数据库尚未初始化');
  }
  const storeId = state.storeCoordinator?.getActiveStoreContext()?.storeId;
  if (!storeId) throw new Error('请先选择店铺，再读取领星采集批次。');
  const batchRow = state.db.prepare(`
    SELECT
      id,
      store_id AS storeId,
      request_id AS requestId,
      browser_profile_id AS browserProfileId,
      business_date AS businessDate,
      session_generation AS sessionGeneration,
      app_version AS appVersion,
      date_start AS dateStart,
      date_end AS dateEnd,
      store_name AS storeName,
      marketplace_code AS marketplaceCode,
      status,
      download_dir AS downloadDir,
      manifest_path AS manifestPath,
      created_at AS createdAt,
      completed_at AS completedAt
    FROM lingxing_report_batches
    WHERE store_id = ? AND id = ?
  `).get(storeId, batchId) as (LingxingReportBatch & { appVersion?: string | null; manifestPath?: string | null; completedAt?: string | null }) | undefined;
  if (!batchRow) {
    throw new Error(`未找到领星采集批次：${batchId}`);
  }
  const fileRows = state.db.prepare(`
    SELECT
      id,
      batch_id AS batchId,
      report_type AS reportType,
      display_name AS displayName,
      status,
      max_auto_retries AS maxAutoRetries,
      auto_retry_count AS autoRetryCount,
      file_path AS filePath,
      file_size_bytes AS fileSizeBytes,
      error_message AS errorMessage,
      attempt_errors_json AS attemptErrorsJson,
      failure_screenshot_path AS failureScreenshotPath,
      failure_dom_snapshot_path AS failureDomSnapshotPath,
      failure_trace_path AS failureTracePath,
      trace_unavailable_reason AS traceUnavailableReason,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM lingxing_report_files
    WHERE store_id = ? AND batch_id = ?
    ORDER BY id ASC
  `).all(storeId, batchId) as Array<LingxingReportFile & { attemptErrorsJson?: string | null; filePath?: string | null; errorMessage?: string | null }>;

  return {
    batch: {
      ...batchRow,
      appVersion: batchRow.appVersion ?? undefined,
      storeName: batchRow.storeName ?? undefined,
      marketplaceCode: batchRow.marketplaceCode ?? undefined,
      manifestPath: batchRow.manifestPath ?? undefined,
      completedAt: batchRow.completedAt ?? undefined,
    },
    files: fileRows.map((row) => ({
      ...row,
      filePath: row.filePath ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      attemptErrors: parseStringArray(row.attemptErrorsJson),
      failureScreenshotPath: row.failureScreenshotPath ?? undefined,
      failureDomSnapshotPath: row.failureDomSnapshotPath ?? undefined,
      failureTracePath: row.failureTracePath ?? undefined,
      traceUnavailableReason: row.traceUnavailableReason ?? undefined,
    })),
  };
}

function loadSuccessfulCanaryReportTypesForScope(
  dateRange: { start: string; end: string },
  target: LingxingCollectionTarget & { storeId: string },
  afterCheckedAt?: string,
): LingxingReportType[] {
  if (!state.db) return [];
  const rows = state.db.prepare(`
    SELECT
      b.id AS batchId,
      b.created_at AS batchCreatedAt,
      b.download_dir AS downloadDir,
      f.report_type AS reportType,
      f.file_path AS filePath,
      f.file_size_bytes AS fileSizeBytes,
      f.error_message AS errorMessage,
      f.attempt_errors_json AS attemptErrorsJson
    FROM lingxing_report_batches b
    JOIN lingxing_report_files f ON f.store_id = b.store_id AND f.batch_id = b.id
    WHERE b.store_id = ?
      AND b.app_version = ?
      AND b.date_start = ?
      AND b.date_end = ?
      AND COALESCE(b.request_id, '') LIKE 'canary:%'
      AND COALESCE(b.marketplace_code, '') = COALESCE(?, '')
      AND b.status = 'completed'
      AND f.status = 'downloaded'
      AND (
        SELECT COUNT(*)
        FROM lingxing_report_files count_files
        WHERE count_files.store_id = b.store_id AND count_files.batch_id = b.id
      ) = 1
    ORDER BY b.created_at DESC, b.id DESC
  `).all(
    target.storeId,
    APP_VERSION,
    dateRange.start,
    dateRange.end,
    target.marketplaceCode ?? '',
  ) as Array<{
    batchId: string;
    batchCreatedAt: string;
    downloadDir: string;
    reportType: string;
    filePath?: string | null;
    fileSizeBytes?: number | null;
    errorMessage?: string | null;
    attemptErrorsJson?: string | null;
  }>;

  const afterMs = afterCheckedAt ? Date.parse(afterCheckedAt) : Number.NaN;
  const dateStartToken = compactDateToken(dateRange.start);
  const dateEndToken = compactDateToken(dateRange.end);
  const covered = new Set<LingxingReportType>();

  for (const row of rows) {
    const report = LINGXING_AD_REPORTS.find((item) => item.type === row.reportType);
    if (!report) continue;
    const createdAtMs = Date.parse(row.batchCreatedAt);
    if (Number.isFinite(afterMs) && (!Number.isFinite(createdAtMs) || createdAtMs < afterMs)) continue;
    if (row.errorMessage) continue;
    if (JSON.stringify(parseStringArray(row.attemptErrorsJson)) !== '[]') continue;
    if (!row.filePath || !fs.existsSync(row.filePath)) continue;
    if (!isPathInsideDirectory(path.resolve(row.filePath), path.resolve(row.downloadDir))) continue;
    const actualSize = fs.statSync(row.filePath).size;
    if (actualSize < 128 || row.fileSizeBytes !== actualSize) continue;
    const basename = path.basename(row.filePath).toLowerCase();
    if (!basename.includes(report.expectedFilenameKeyword.toLowerCase())) continue;
    if (!basename.includes(dateStartToken) || !basename.includes(dateEndToken)) continue;
    covered.add(report.type);
  }

  return [...covered];
}

function compactDateToken(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

function loadPersistedDownloadCenterDiagnostic(
  diagnosticId: number | undefined,
  dateStart: string,
  dateEnd: string,
): DownloadCenterDiagnosticResult | undefined {
  if (!state.db) return undefined;
  const storeId = state.storeCoordinator?.getActiveStoreContext()?.storeId;
  if (!storeId) return undefined;
  const row = diagnosticId
    ? state.db.prepare(`
        SELECT * FROM download_center_diagnostics WHERE store_id = ? AND id = ?
      `).get(storeId, diagnosticId)
    : state.db.prepare(`
        SELECT * FROM download_center_diagnostics
        WHERE store_id = ? AND date_start = ? AND date_end = ?
        ORDER BY checked_at DESC, id DESC
        LIMIT 1
      `).get(storeId, dateStart, dateEnd);
  if (!row) return undefined;
  return mapDownloadCenterDiagnosticRow(row as Record<string, unknown>);
}

function loadLatestPersistedDownloadCenterDiagnosticForModel(
  model: DownloadCenterPageModel,
  dateStart: string,
  dateEnd: string,
  target: LingxingCollectionTarget & { storeId: string },
): DownloadCenterDiagnosticResult | undefined {
  if (!state.db) return undefined;
  const row = getLatestDownloadCenterDiagnosticRowForModel(state.db, model, dateStart, dateEnd, target);
  if (!row) return undefined;
  return mapDownloadCenterDiagnosticRow(row as Record<string, unknown>);
}

function mapDownloadCenterDiagnosticRow(row: Record<string, unknown>): DownloadCenterDiagnosticResult {
  return {
    id: Number(row.id),
    appVersion: stringOrUndefined(row.app_version),
    pageModel: String(row.page_model || ''),
    pageModelSource: row.page_model_source === 'override' ? 'override' : row.page_model_source === 'bundled' ? 'bundled' : undefined,
    pageModelSnapshot: parseDownloadCenterPageModelSnapshot(stringOrUndefined(row.page_model_snapshot_json)),
    dateStart: stringOrUndefined(row.date_start),
    dateEnd: stringOrUndefined(row.date_end),
    storeName: stringOrUndefined(row.store_name),
    marketplaceCode: stringOrUndefined(row.marketplace_code),
    url: String(row.url || ''),
    title: String(row.title || ''),
    ready: Boolean(row.ready),
    requiresManualVerification: Boolean(row.requires_manual_verification),
    matchedEntryHints: parseStringArray(row.matched_entry_hints_json),
    matchedReportNames: parseStringArray(row.matched_report_names_json),
    selectorChecks: parseJsonArray(row.selector_checks_json) as DownloadCenterDiagnosticResult['selectorChecks'],
    missingRequiredSelectors: parseStringArray(row.missing_required_selectors_json),
    selectorCandidates: parseJsonArray(row.selector_candidates_json) as DownloadCenterSelectorCandidate[],
    actionSelectorChecks: parseDiagnosticActionSelectorChecks(stringOrUndefined(row.action_selector_checks_json)),
    checkedAt: String(row.checked_at || ''),
    screenshotPath: stringOrUndefined(row.screenshot_path),
    domSnapshotPath: stringOrUndefined(row.dom_snapshot_path),
    errorMessage: stringOrUndefined(row.error_message),
  };
}

function parseStringArray(value: unknown): string[] {
  return parseJsonArray(value).map((item) => String(item));
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

async function handleOpenArtifact(input: unknown): Promise<void> {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const context = requireCurrentCollectionStoreContext(value.storeContext);
  const artifactId = optionalTrimmedString(value.artifactId);
  if (!artifactId) throw new Error('Artifact ID 无效或已失效。');
  const store = state.storeRepo?.getStore(context.storeId);
  if (!store || store.status !== 'active') throw new Error('当前店铺不存在或已停用。');
  const realPath = mainArtifactRegistry.resolve({
    artifactId,
    currentStoreId: context.storeId,
    allowedRoots: artifactAllowedRootsForStore(store, 'export-file'),
  });
  const stat = fs.statSync(realPath);
  if (stat.isFile() && !OPEN_PATH_ALLOWED_EXTENSIONS.has(path.extname(realPath).toLowerCase())) {
    throw new Error('文件类型不允许直接打开');
  }
  const error = await shell.openPath(realPath);
  if (error) {
    throw new Error(error);
  }
}

function validateDateRange(dateRange: { start: string; end: string }): void {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(dateRange?.start || '') || !pattern.test(dateRange?.end || '')) {
    throw new Error('日期范围必须使用 YYYY-MM-DD 格式');
  }
  if (dateRange.start > dateRange.end) {
    throw new Error('开始日期不能晚于结束日期');
  }
}

function validateLingxingReportType(reportType: unknown): asserts reportType is LingxingReportType {
  if (typeof reportType !== 'string' || !LINGXING_REPORT_TYPE_SET.has(reportType)) {
    throw new Error('领星报告类型无效');
  }
}

function validateArray(value: unknown, name: string, maxLength: number): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} 必须是数组`);
  }
  if (value.length > maxLength) {
    throw new Error(`${name} 超过最大数量限制 ${maxLength}`);
  }
}

function validateListing(listing: ListingContent): void {
  if (!listing || typeof listing.asin !== 'string' || !listing.asin.trim() || listing.asin.length > 32) {
    throw new Error('Listing ASIN 无效');
  }
  if (typeof listing.title !== 'string' || !listing.title.trim() || listing.title.length > 500) {
    throw new Error('Listing title 无效');
  }
  if (!Array.isArray(listing.bullets)) {
    throw new Error('Listing bullets 必须是数组');
  }
  if (listing.bullets.length > 10 || listing.bullets.some((bullet) => typeof bullet !== 'string' || bullet.length > 1000)) {
    throw new Error('Listing bullets 内容无效');
  }
  for (const field of [listing.aPlus, listing.imageCopy, listing.backendTerms]) {
    if (field !== undefined && typeof field !== 'string') {
      throw new Error('Listing 文案字段必须是字符串');
    }
  }
}

function validateOpportunity(opportunity: KeywordOpportunity): void {
  if (!opportunity || typeof opportunity.normalizedKeyword !== 'string' || !opportunity.normalizedKeyword.trim()) {
    throw new Error('关键词机会无效');
  }
  if (!['high', 'medium', 'low'].includes(opportunity.opportunityLevel)) {
    throw new Error('关键词机会等级无效');
  }
  if (!Number.isFinite(Number(opportunity.score))) {
    throw new Error('关键词机会分数无效');
  }
  if (!Array.isArray(opportunity.riskFlags) || !Array.isArray(opportunity.recommendedSections)) {
    throw new Error('关键词机会风险或推荐位置无效');
  }
}

function validateSuggestion(suggestion: ListingSuggestion): void {
  if (!suggestion || typeof suggestion.asin !== 'string' || typeof suggestion.keyword !== 'string') {
    throw new Error('Listing 建议无效');
  }
  if (!['title', 'bullet', 'a_plus', 'image_copy', 'backend_terms'].includes(suggestion.section)) {
    throw new Error('Listing 建议位置无效');
  }
  if (typeof suggestion.suggestedText !== 'string' || !suggestion.suggestedText.trim()) {
    throw new Error('Listing 建议文案无效');
  }
  if (!Array.isArray(suggestion.riskWarnings)) {
    throw new Error('Listing 建议风险字段无效');
  }
}

function validateListingDraft(draft: ListingDraft): void {
  if (!draft || typeof draft.asin !== 'string' || typeof draft.draftedText !== 'string') {
    throw new Error('Listing 草案无效');
  }
  if (!['title', 'bullet', 'a_plus', 'image_copy', 'backend_terms'].includes(draft.section)) {
    throw new Error('Listing 草案位置无效');
  }
  if (!draft.draftedText.trim()) {
    throw new Error('Listing 草案文案无效');
  }
  if (!Array.isArray(draft.keywords) || !Array.isArray(draft.riskWarnings)) {
    throw new Error('Listing 草案关键词或风险字段无效');
  }
  if (!['ai', 'rule'].includes(draft.source)) {
    throw new Error('Listing 草案来源无效');
  }
}

function normalizeKeywordSource(source?: string): KeywordMetric['source'] | undefined {
  if (!source) return undefined;
  if (['search_term', 'sqp', 'keyword_report', 'manual'].includes(source)) {
    return source as KeywordMetric['source'];
  }
  throw new Error('关键词报表来源无效');
}

// ============================================================================
// Recommendation & Execution
// ============================================================================

interface RecommendationGenerationRuntimeSnapshot {
  runtimeConfig: StoreRuntimeAnalysisConfig;
  aiSettings: Record<string, string>;
}

function captureRecommendationGenerationRuntimeSnapshot(): RecommendationGenerationRuntimeSnapshot {
  const currentRuntime = currentStoreRuntimeAnalysisConfig();
  const snapshot: RecommendationGenerationRuntimeSnapshot = {
    runtimeConfig: {
      ...currentRuntime,
      values: { ...currentRuntime.values },
      ruleConfig: {
        ...currentRuntime.ruleConfig,
        coreWordWhitelist: [...currentRuntime.ruleConfig.coreWordWhitelist],
        brandWordWhitelist: [...currentRuntime.ruleConfig.brandWordWhitelist],
      },
    },
    aiSettings: { ...readAiSettingsForMain() },
  };
  return deepFreezeGenerationSnapshot(snapshot);
}

function deepFreezeGenerationSnapshot<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreezeGenerationSnapshot(child);
    }
    Object.freeze(value);
  }
  return value;
}

async function runRecommendationGeneration(
  request: any = {},
  capturedRuntime?: RecommendationGenerationRuntimeSnapshot,
): Promise<{
  generated: number;
  metrics: number;
  skippedDuplicates: number;
  refreshedDuplicates: number;
  recommendationCandidates: number;
  suppressedLowConfidence: number;
  minimumConfidencePercent: number;
  recommendationIds: number[];
  aiExplanation: {
    configured: boolean;
    invoked: boolean;
    aiCount: number;
    ruleCount: number;
    reason: string;
    model?: string;
    strategyDiagnosis?: AdStrategyGenerationSummary;
    aiInsights?: AiInsightSummary[];
    evidencePackSummary?: AiEvidencePackSummary;
  };
  scope: any;
  metricsBackfill?: ReturnType<typeof backfillAdMetricsFromLatestBatchIfNeeded>;
}> {
  const operatorRequested = request && typeof request === 'object' && Object.keys(request).length > 0;
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(1000, Number(request.limit))) : 300;
  const scope = {
    dateFrom: typeof request.dateFrom === 'string' && request.dateFrom.trim() ? request.dateFrom.trim() : undefined,
    dateTo: typeof request.dateTo === 'string' && request.dateTo.trim() ? request.dateTo.trim() : undefined,
    storeName: typeof request.storeName === 'string' && request.storeName.trim() ? request.storeName.trim() : operatorRequested ? undefined : state.currentStore || undefined,
    marketplaceCode: typeof request.marketplaceCode === 'string' && request.marketplaceCode.trim() ? request.marketplaceCode.trim() : undefined,
    asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
    limit,
  };

  if (operatorRequested && (!scope.dateFrom || !scope.dateTo || !scope.storeName || !scope.marketplaceCode)) {
    throw new Error('生成优化建议需要明确填写开始日期、结束日期、店铺和站点，不能使用登录账号名代替店铺范围。');
  }

  if (!scope.dateFrom || !scope.dateTo || !scope.storeName || !scope.marketplaceCode) {
    throw new Error('生成优化建议需要明确当前运营范围，并且必须先完成真实报表采集和导入。');
  }

  // One immutable snapshot supplies both rule generation and every AI phase.
  // Mission analysis captures this before sealing its revisions, so a settings
  // edit during a long model call cannot create a mixed A/B result.
  const generationRuntime = capturedRuntime ?? captureRecommendationGenerationRuntimeSnapshot();
  const gate = getBusinessRecommendationGate(scope, 'recommendation');
  const metricsBackfill = undefined;
  const metrics = filterFormalRecommendationMetrics(
    loadBusinessRecommendationMetrics(gate.scope, gate.metricSource, Math.max(limit, RECOMMENDATION_METRIC_LOAD_LIMIT)),
    gate.scope.asin,
  );
  assertRecommendationMetricsLoaded({
    metricsLength: metrics.length,
    realReportFileCount: gate.pipeline.collection.fileAudit.realReportFileCount,
    requiredReportCount: LINGXING_AD_REPORTS.length,
    sourceFileCount: gate.metricSource.sourceFiles.length,
    sourceRowCount: countMetricsWithSourceRow(metrics),
    sourceFileRowCount: countMetricsWithSourceFileAndRow(metrics),
    asinBoundCount: countMetricsWithAsin(metrics),
    scopeAsin: gate.scope.asin,
    importedRows: gate.pipeline.collection.fileAudit.importedRowCount,
  });

  // Generate recommendations from the active store's runtime configuration.
  const runtimeConfig = generationRuntime.runtimeConfig;
  assertRuntimeConfigStore(runtimeConfig, gate.scope.storeId);
  assertRuntimeAnalysisWindow(runtimeConfig, gate.scope.dateFrom, gate.scope.dateTo);
  const generator = new RecommendationGenerator(runtimeConfig.ruleConfig);
  const firstMetric = metrics[0];
  const taskId = `task_${Date.now()}`;
  let recommendations = generator.generateTimelineBatch(metrics, {
    storeName: scope.storeName || firstMetric?.storeName || state.currentStore || 'unknown',
    marketplaceCode: scope.marketplaceCode || firstMetric?.marketplaceCode || 'US',
    config: runtimeConfig.ruleConfig,
    taskId,
  });
  recommendations = bindRecommendationsToScopeAsin(recommendations, gate.scope.asin);
  const recommendationCandidates = recommendations.length;
  recommendations = recommendations.map((rec) => ({
    ...rec,
    evidence: {
      ...rec.evidence,
      batchId: gate.scope.batchId,
    },
  }));
  const strategyDiagnosisResult = await enrichAdRecommendationsWithStrategyDiagnosis(recommendations, metrics, gate.scope, {
    taskId,
    sourceFiles: gate.metricSource.sourceFiles,
    runtimeConfig,
    aiSettings: generationRuntime.aiSettings,
  });
  recommendations = strategyDiagnosisResult.recommendations;
  recommendations = await enrichAdRecommendationsWithAiExplanations(
    recommendations,
    runtimeConfig,
    generationRuntime.aiSettings,
  );
  const recommendationsBeforeConfidenceGate = recommendations.length;
  recommendations = recommendations.filter((recommendation) => (
    recommendationMeetsStoreConfidence(recommendation.confidence, runtimeConfig)
  ));
  const suppressedLowConfidence = recommendationsBeforeConfidenceGate - recommendations.length;
  const aiCount = recommendations.filter((rec) => rec.evidence?.aiStrategySource === 'ai' || rec.evidence?.explanationSource === 'ai').length;
  const settings = generationRuntime.aiSettings;
  const aiInvoked = runtimeConfig.values.aiRecommendationsEnabled
    && metrics.length > 0
    && Boolean(settings.aiApiKey);
  const aiFallbackReason = recommendations
    .map((rec) => rec.evidence?.aiFallbackReason)
    .find((reason): reason is string => typeof reason === 'string' && reason.length > 0);
  const strategySource = strategyDiagnosisResult.summary?.source;
  const aiExplanation = {
    configured: Boolean(settings.aiApiKey),
    invoked: aiInvoked,
    aiCount,
    ruleCount: recommendations.length - aiCount,
    strategyDiagnosis: strategyDiagnosisResult.summary,
    aiInsights: strategyDiagnosisResult.summary?.aiInsights || [],
    evidencePackSummary: strategyDiagnosisResult.summary?.evidencePackSummary,
    reason: !runtimeConfig.values.aiRecommendationsEnabled
      ? `当前店铺已关闭 AI 建议，使用规则引擎；低于 ${runtimeConfig.values.minimumRecommendationConfidencePercent}% 的建议已阻断。`
      : !settings.aiApiKey
      ? '未配置 AI Key，建议解释使用规则引擎 fallback。'
      : recommendations.length === 0
        ? strategySource === 'ai'
          ? 'AI 已完成广告阶段诊断和动态阈值建议，但没有找到可安全绑定到当前真实指标的可审批动作。'
          : '规则引擎没有找到可安全绑定到当前真实指标的可审批动作。'
        : aiInvoked && aiCount === 0 && strategySource === 'ai'
          ? 'AI 已完成广告阶段诊断和动态阈值建议；本次没有形成可绑定到具体广告对象的 AI 建议解释，动作仍按规则证据进入人工复核。'
        : aiInvoked && aiCount === 0
          ? `已尝试调用 AI，但本次没有可用 AI 输出，建议已回落到规则引擎。${aiFallbackReason ? `原因：${aiFallbackReason}` : ''}`
        : `AI 已参与广告阶段诊断、动态阈值建议和 ${aiCount}/${recommendations.length} 条建议解释；AI-only 动作仅进入人工审批。`,
    model: settings.aiModel,
  };

  // Save to database
  let inserted = 0;
  let skippedDuplicates = 0;
  let refreshedDuplicates = 0;
  const recommendationIds: number[] = [];
  for (const rec of recommendations) {
    const result = state.recommendationRepo?.insertIfNoDuplicateForStore
      ? state.recommendationRepo.insertIfNoDuplicateForStore(gate.scope.storeId, rec)
      : { id: state.recommendationRepo?.insertForStore(gate.scope.storeId, rec) || 0, inserted: true };
    if (result.id > 0) recommendationIds.push(result.id);
    if (result.inserted) {
      inserted++;
    } else if (result.updated) {
      refreshedDuplicates++;
    } else {
      skippedDuplicates++;
    }
  }

  console.log(`[Scheduler] Generated ${inserted} recommendations; refreshed ${refreshedDuplicates} incomplete duplicate(s); skipped ${skippedDuplicates} duplicate(s)`);
  mainWindow?.webContents.send('recommendations:generated', inserted);
  return {
    generated: inserted,
    metrics: metrics.length,
    skippedDuplicates,
    refreshedDuplicates,
    recommendationCandidates,
    suppressedLowConfidence,
    minimumConfidencePercent: runtimeConfig.values.minimumRecommendationConfidencePercent,
    recommendationIds,
    aiExplanation,
    scope: gate.scope,
    metricsBackfill,
  };
}

interface AdStrategyGenerationSummary {
  source: 'ai' | 'rule';
  evidenceSufficiency: AdStrategyDiagnosisOutput['evidenceSufficiency'];
  lifecycleStage: string;
  summary: string;
  mainProblems: string[];
  riskWarnings: string[];
  thresholdSuggestions: AdStrategyDiagnosisOutput['thresholdSuggestions'];
  lifecycleStageReason: string;
  lifecycleStageEvidenceRefs: string[];
  lifecycleStageRequiresReview?: boolean;
  lifecycleStageInvalidReasons?: string[];
  aiCandidateCount: number;
  insightOnlyCandidateCount: number;
  aiInsights?: AiInsightSummary[];
  evidencePackSummary?: AiEvidencePackSummary;
  evidencePackPreview?: AiEvidenceItem[];
  operationEventCount: number;
  productContextCount: number;
  decisionCounts: {
    total: number;
    aligned: number;
    ruleOnly: number;
    aiOnly: number;
    conflict: number;
    reviewRequired: number;
  };
  finalCandidateCount: number;
  filteredAiOnlyCandidateCount: number;
  filterReasons: string[];
  fallbackReason?: string;
}

interface AiEvidencePackSummary {
  total: number;
  metric: number;
  timeline: number;
  operationEvent: number;
  productContext: number;
  ruleCandidate: number;
}

interface AiInsightSummary {
  entityType: string;
  entityName: string;
  actionType: string;
  reason: string;
  reasoningSteps: string[];
  evidenceRefs: string[];
  invalidReasons: string[];
  riskWarnings: string[];
  confidence: number;
}

function summarizeStrategyDiagnosis(
  diagnosis: AdStrategyDiagnosisOutput,
  operationEventCount: number,
  productContextCount = 0,
  aiInsights: AiInsightSummary[] = [],
  evidencePackSummary?: AiEvidencePackSummary,
  evidencePackPreview?: AiEvidenceItem[],
): AdStrategyGenerationSummary {
  return {
    source: diagnosis.source,
    evidenceSufficiency: diagnosis.evidenceSufficiency,
    lifecycleStage: diagnosis.lifecycleStage,
    summary: diagnosis.summary,
    mainProblems: diagnosis.mainProblems,
    riskWarnings: diagnosis.riskWarnings,
    thresholdSuggestions: diagnosis.thresholdSuggestions,
    lifecycleStageReason: diagnosis.lifecycleStageReason,
    lifecycleStageEvidenceRefs: diagnosis.lifecycleStageEvidenceRefs,
    lifecycleStageRequiresReview: diagnosis.lifecycleStageRequiresReview,
    lifecycleStageInvalidReasons: diagnosis.lifecycleStageInvalidReasons,
    aiCandidateCount: diagnosis.aiCandidates.length,
    insightOnlyCandidateCount: aiInsights.length,
    aiInsights,
    evidencePackSummary,
    evidencePackPreview,
    operationEventCount,
    productContextCount,
    decisionCounts: {
      total: 0,
      aligned: 0,
      ruleOnly: 0,
      aiOnly: 0,
      conflict: 0,
      reviewRequired: 0,
    },
    finalCandidateCount: 0,
    filteredAiOnlyCandidateCount: 0,
    filterReasons: [],
    fallbackReason: diagnosis.aiFallbackReason,
  };
}

function summarizeMergedDecisionDiagnostics(
  decisions: Array<{ agreement: string; requiresReview?: boolean }>,
  acceptedAiOnlyCount: number,
  finalCandidateCount: number,
) {
  const decisionCounts = {
    total: decisions.length,
    aligned: decisions.filter((decision) => decision.agreement === 'aligned').length,
    ruleOnly: decisions.filter((decision) => decision.agreement === 'rule_only').length,
    aiOnly: decisions.filter((decision) => decision.agreement === 'ai_only').length,
    conflict: decisions.filter((decision) => decision.agreement === 'conflict').length,
    reviewRequired: decisions.filter((decision) => decision.requiresReview === true).length,
  };
  const filteredAiOnlyCandidateCount = Math.max(0, decisionCounts.aiOnly - acceptedAiOnlyCount);
  const filterReasons: string[] = [];
  if (decisions.length === 0) {
    filterReasons.push('规则和 AI 都没有返回可合并的候选动作。');
  }
  if (filteredAiOnlyCandidateCount > 0) {
    filterReasons.push(`${filteredAiOnlyCandidateCount} 条 AI-only 候选缺少可映射的真实 keyword/search term/target 指标，未进入待审批。`);
  }
  if (decisionCounts.conflict > 0) {
    filterReasons.push(`${decisionCounts.conflict} 条 AI/规则冲突建议已标记为人工复核，不会直接进入普通审批。`);
  }
  if (decisionCounts.ruleOnly > 0) {
    filterReasons.push(`${decisionCounts.ruleOnly} 条规则-only 建议缺少 AI 确认，仍需按证据完整性审批。`);
  }
  if (acceptedAiOnlyCount > 0) {
    filterReasons.push(`${acceptedAiOnlyCount} 条 AI-only 候选已找到真实指标上下文，只能进入人工复核。`);
  }
  if (finalCandidateCount === 0 && filterReasons.length === 0) {
    filterReasons.push('本次诊断完成，但没有形成可绑定当前广告对象的安全动作。');
  }

  return {
    decisionCounts,
    finalCandidateCount,
    filteredAiOnlyCandidateCount,
    filterReasons,
  };
}

function loadProductStrategyContexts(scope: {
  storeId: StoreContextEnvelope['storeId'];
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
}): ProductStrategyContext[] {
  if (!state.productRepo || !scope.storeName || !scope.marketplaceCode) return [];
  const products = state.productRepo
    .findAllForStore(scope.storeId)
    .filter((product) => product.marketplace_code === scope.marketplaceCode)
    .filter((product) => !scope.asin || product.asin.toLowerCase() === scope.asin.toLowerCase())
    .slice(0, 20);

  return products.map((product) => {
    const cost = state.productRepo?.getCostForStore(scope.storeId, product.id);
    return {
      asin: product.asin,
      parentAsin: product.parent_asin || undefined,
      msku: product.msku || undefined,
      sku: product.sku || undefined,
      title: product.title || undefined,
      productStage: product.product_stage || undefined,
      status: product.status || undefined,
      cost: cost
        ? {
            purchaseCost: finiteNumberOrUndefined(cost.purchaseCost),
            firstLegCost: finiteNumberOrUndefined(cost.firstLegCost),
            fbaFee: finiteNumberOrUndefined(cost.fbaFee),
            referralFeeRate: finiteNumberOrUndefined(cost.referralFeeRate),
            storageFee: finiteNumberOrUndefined(cost.storageFee),
            otherCost: finiteNumberOrUndefined(cost.otherCost),
            minPrice: finiteNumberOrUndefined(cost.minPrice),
            targetNetMargin: finiteNumberOrUndefined(cost.targetNetMargin),
            targetAcos: finiteNumberOrUndefined(cost.targetAcos),
            targetTacos: finiteNumberOrUndefined(cost.targetTacos),
          }
        : undefined,
    };
  });
}

function finiteNumberOrUndefined(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

async function enrichAdRecommendationsWithAiExplanations(
  recommendations: ActionRecommendation[],
  runtimeConfig: StoreRuntimeAnalysisConfig,
  settings: Record<string, string>,
): Promise<ActionRecommendation[]> {
  if (recommendations.length === 0) return recommendations;

  const aiApiKey = settings.aiApiKey;
  if (!runtimeConfig.values.aiRecommendationsEnabled || !aiApiKey) {
    const fallbackReason = runtimeConfig.values.aiRecommendationsEnabled
      ? '未配置 AI Key，广告建议解释使用规则引擎'
      : '当前店铺已关闭 AI 建议，广告建议解释使用规则引擎';
    return recommendations.map((rec) => mergeAdActionExplanationEvidence({
      recommendation: rec,
      explanation: {
        source: 'rule',
        explanation: rec.reason,
        riskWarnings: [`${fallbackReason}。`],
        aiFallbackReason: fallbackReason,
      },
      model: settings.aiModel,
    }));
  }

  const provider = new OpenAICompatibleProvider(buildAiProviderConfig(settings));
  const explainer = new AdActionReasonExplainer(provider, {
    persona: settings.aiPersona,
    outputLanguage: settings.aiOutputLanguage,
  });
  const enhanced: ActionRecommendation[] = [];
  for (const rec of recommendations) {
    try {
      const explanation = await explainer.explain({
        actionType: rec.actionType,
        entityName: rec.entityName,
        currentMetrics: {
          impressions: rec.evidence.impressions,
          clicks: rec.evidence.clicks,
          cost: rec.evidence.cost,
          orders: rec.evidence.orders,
          sales: rec.evidence.sales,
          acos: rec.evidence.acos,
        },
        recommendedAction: rec.recommendedValue || rec.actionType,
      });
      recordAdActionReasonAiCallLog({
        recommendation: rec,
        explanation,
        model: settings.aiModel,
      });
      enhanced.push(mergeAdActionExplanationEvidence({
        recommendation: rec,
        explanation,
        model: settings.aiModel,
      }));
    } catch (error) {
      const fallbackReason = `AI 广告解释异常：${error instanceof Error ? error.message : String(error)}，使用规则解释`;
      const fallbackExplanation: AdActionExplanationForLog = {
        source: 'rule',
        explanation: rec.reason,
        riskWarnings: ['AI 广告解释异常，使用规则解释。'],
        aiFallbackReason: fallbackReason,
      };
      recordAdActionReasonAiCallLog({
        recommendation: rec,
        explanation: fallbackExplanation,
        model: settings.aiModel,
      });
      enhanced.push(mergeAdActionExplanationEvidence({
        recommendation: rec,
        explanation: fallbackExplanation,
        model: settings.aiModel,
      }));
    }
  }
  return enhanced;
}

async function enrichAdRecommendationsWithStrategyDiagnosis(
  recommendations: ActionRecommendation[],
  metrics: AdDailyMetrics[],
  scope: {
    storeId: StoreContextEnvelope['storeId'];
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
    batchId?: string;
  },
  options: {
    taskId: string;
    sourceFiles: string[];
    runtimeConfig: StoreRuntimeAnalysisConfig;
    aiSettings: Record<string, string>;
  },
): Promise<{ recommendations: ActionRecommendation[]; summary?: AdStrategyGenerationSummary }> {
  if (!scope.dateFrom || !scope.dateTo || !scope.storeName || !scope.marketplaceCode) {
    return { recommendations };
  }

  const operationEvents = state.operationEventRepo?.findByScopeForStore(scope.storeId, {
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    limit: 100,
  }) || [];
  const productContexts = loadProductStrategyContexts(scope);
  const productHistoryLedgers = buildAdProductHistoryLedger({
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    metrics,
    operationEvents,
    productContexts,
  });
  const evidencePack = buildAdAiEvidencePack({
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    metrics,
    operationEvents,
    productContexts,
    ruleRecommendations: recommendations,
    productHistoryLedgers,
  });
  const evidencePackSummary = summarizeAiEvidencePack(evidencePack);
  const diagnosisInput = buildAdStrategyDiagnosisInput({
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    metrics,
    operationEvents,
    productContexts,
    ruleConfig: options.runtimeConfig.ruleConfig as RuleConfig & { minSpend?: number },
    recommendations,
    evidencePack,
  });
  const settings = options.aiSettings;
  const diagnosis = options.runtimeConfig.values.aiRecommendationsEnabled && settings.aiApiKey
    ? await new AdStrategyDiagnoser(new OpenAICompatibleProvider(buildAiProviderConfig(settings)), {
        persona: settings.aiPersona,
        outputLanguage: settings.aiOutputLanguage,
        maxTokens: parseIntegerSetting(settings.aiMaxTokens || settings.ai_max_tokens, 8192),
      }).diagnose(diagnosisInput)
    : {
        schemaVersion: 'ad_strategy_diagnosis_v1' as const,
        evidenceSufficiency: assessAdEvidenceSufficiency(diagnosisInput),
        lifecycleStage: 'unknown' as const,
        lifecycleStageReason: options.runtimeConfig.values.aiRecommendationsEnabled
          ? '未配置 AI Key，不能执行 AI 阶段判断。'
          : '当前店铺已关闭 AI 建议，不能执行 AI 阶段判断。',
        lifecycleStageEvidenceRefs: [],
        summary: options.runtimeConfig.values.aiRecommendationsEnabled
          ? '未配置 AI Key，广告阶段诊断使用规则 fallback。'
          : '当前店铺已关闭 AI 建议，广告阶段诊断使用规则 fallback。',
        mainProblems: [],
        thresholdSuggestions: {
          targetAcos: {
            value: diagnosisInput.currentRuleConfig.targetAcos,
            reason: '当前规则配置 fallback。',
          },
          highAcosThreshold: {
            value: diagnosisInput.currentRuleConfig.highAcosThreshold,
            reason: '当前规则配置 fallback。',
          },
          noOrderClickThreshold: {
            value: diagnosisInput.currentRuleConfig.noOrderClickThreshold,
            reason: '当前规则配置 fallback。',
          },
          minSpend: {
            value: diagnosisInput.currentRuleConfig.minSpend,
            reason: '当前规则配置 fallback。',
          },
        },
        aiCandidates: [],
        insightOnlyCandidates: [],
        riskWarnings: ['AI 不可用，必须人工复核规则建议。'],
        source: 'rule' as const,
        aiFallbackReason: options.runtimeConfig.values.aiRecommendationsEnabled
          ? '未配置 AI Key，广告阶段诊断使用规则 fallback'
          : '当前店铺已关闭 AI 建议，广告阶段诊断使用规则 fallback',
      };
  recordAdStrategyAiCallLog(diagnosisInput, diagnosis, settings, evidencePackSummary);
  const validation = validateAiDiagnosisEvidence({
    diagnosis,
    evidencePack,
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
  });
  const aiInsights = buildAiInsightsFromValidation(diagnosis, validation.invalidReasons);
  const mergeDiagnosis: AdStrategyDiagnosisOutput = {
    ...diagnosis,
    aiCandidates: diagnosis.aiCandidates.filter((_, index) => validation.validCandidateIndexes.includes(index)),
  };
  const decisions = mergeAdDecisions({
    ruleCandidates: recommendations.map((recommendation) => ({
      entityType: recommendation.entityType,
      entityName: recommendation.entityName,
      actionType: recommendation.actionType,
      recommendedValue: recommendation.recommendedValue,
      reason: recommendation.reason,
      confidence: recommendation.confidence,
    })),
    aiCandidates: mergeDiagnosis.aiCandidates.map((candidate) => ({
      entityType: candidate.entityType,
      entityName: candidate.entityName,
      actionType: candidate.actionType,
      recommendedValue: candidate.recommendedValue,
      reason: candidate.reason,
      confidence: candidate.confidence,
    })),
  });

  const annotated = annotateRecommendationsWithStrategy({
    recommendations,
    diagnosis: mergeDiagnosis,
    decisions,
    operationEventCount: operationEvents.length,
    productContexts,
    evidencePack,
  });
  const aiOnlyRecommendations = createAiOnlyRecommendationsFromDecisions({
    decisions,
    diagnosis: mergeDiagnosis,
    metrics,
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    taskId: options.taskId,
    sourceFiles: options.sourceFiles,
    operationEventCount: operationEvents.length,
    productContexts,
    evidencePack,
  });
  const decisionDiagnostics = summarizeMergedDecisionDiagnostics(
    decisions,
    aiOnlyRecommendations.length,
    annotated.length + aiOnlyRecommendations.length,
  );
  const evidencePackPreview = selectStrategyEvidencePreview(mergeDiagnosis, aiInsights, evidencePack);
  const summary = {
    ...summarizeStrategyDiagnosis(mergeDiagnosis, operationEvents.length, productContexts.length, aiInsights, evidencePackSummary, evidencePackPreview),
    ...decisionDiagnostics,
  };
  recordAdStrategyDiagnosisRun({
    diagnosis: mergeDiagnosis,
    settings,
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
      batchId: scope.batchId,
    },
    evidencePackSummary,
    evidencePackPreview,
    aiInsights,
    formalRecommendationCount: annotated.length + aiOnlyRecommendations.length,
  });

  return {
    recommendations: [...annotated, ...aiOnlyRecommendations],
    summary,
  };
}

function buildAiInsightsFromValidation(
  diagnosis: AdStrategyDiagnosisOutput,
  invalidReasons: Array<{ candidateIndex: number; reason: string; missingRefs: string[] }>,
): AiInsightSummary[] {
  const invalidReasonByIndex = new Map(invalidReasons.map((item) => [item.candidateIndex, item]));
  const invalidCandidateInsights = diagnosis.aiCandidates
    .map((candidate, index) => ({ candidate, invalid: invalidReasonByIndex.get(index) }))
    .filter((item): item is { candidate: AiReasonedDecision; invalid: { candidateIndex: number; reason: string; missingRefs: string[] } } => Boolean(item.invalid))
    .map(({ candidate, invalid }) => candidateToInsight(candidate, [invalid.reason]));

  const explicitInsightCandidates = diagnosis.insightOnlyCandidates.map((candidate) => candidateToInsight(candidate, [
    'AI 返回了判断，但缺少可回查证据引用，因此只作为洞察展示，未进入优化建议池。',
  ]));

  return [...invalidCandidateInsights, ...explicitInsightCandidates];
}

function candidateToInsight(candidate: AiReasonedDecision, invalidReasons: string[]): AiInsightSummary {
  return {
    entityType: candidate.entityType,
    entityName: candidate.entityName,
    actionType: candidate.actionType,
    reason: candidate.reason,
    reasoningSteps: candidate.reasoningSteps,
    evidenceRefs: candidate.evidenceRefs,
    invalidReasons,
    riskWarnings: candidate.riskWarnings,
    confidence: candidate.confidence,
  };
}

function selectStrategyEvidencePreview(
  diagnosis: AdStrategyDiagnosisOutput,
  aiInsights: AiInsightSummary[],
  evidencePack: AiEvidenceItem[],
  maxItems = 12,
): AiEvidenceItem[] {
  const referencedIds = new Set<string>();
  for (const ref of diagnosis.lifecycleStageEvidenceRefs || []) referencedIds.add(ref);
  for (const suggestion of Object.values(diagnosis.thresholdSuggestions || {})) {
    for (const ref of suggestion.evidenceRefs || []) referencedIds.add(ref);
  }
  for (const candidate of [...(diagnosis.aiCandidates || []), ...(diagnosis.insightOnlyCandidates || [])]) {
    for (const ref of candidate.evidenceRefs || []) referencedIds.add(ref);
  }
  for (const insight of aiInsights) {
    for (const ref of insight.evidenceRefs || []) referencedIds.add(ref);
  }

  const referenced = evidencePack.filter((item) => referencedIds.has(item.evidenceId));
  if (referenced.length) return referenced.slice(0, maxItems);
  return evidencePack.slice(0, Math.min(maxItems, 6));
}

function recordAdStrategyAiCallLog(
  input: ReturnType<typeof buildAdStrategyDiagnosisInput>,
  diagnosis: AdStrategyDiagnosisOutput,
  settings: ReturnType<typeof normalizeAiSettings>,
  evidencePackSummary?: AiEvidencePackSummary,
): void {
  try {
    state.aiCallLogRepo?.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: settings.aiModel,
      inputHash: hashAiDiagnosisInput(input, evidencePackSummary),
      outputJson: JSON.stringify(diagnosis),
      success: diagnosis.source === 'ai' && !diagnosis.aiFallbackReason,
      errorMessage: diagnosis.aiFallbackReason,
      schemaVersion: diagnosis.schemaVersion,
      evidencePackSummary,
    });
  } catch (error) {
    console.warn('[AI] Failed to write ad strategy diagnosis log', error);
  }
}

function assertRecommendationWritableTargetCurrent(
  recommendation: ActionRecommendation | undefined,
  scope: {
    dateFrom: string;
    dateTo: string;
    storeName: string;
    marketplaceCode: string;
    asin?: string;
    batchId: string;
  },
  allowedSourceFiles: string[],
): RecommendationMetricSourceAuthority {
  if (!state.db || !recommendation?.evidence?.writableTarget) {
    throw new Error('结果核对被阻断：当前建议没有经验证的 Ads 可写对象。');
  }
  const sourceAuthority = assertRecommendationMetricSourceAuthority(state.db, {
    recommendation,
    scope: {
      ...scope,
      asin: scope.asin || '',
    },
    allowedSourceFiles,
  });
  const canonicalTarget = assertCurrentWritableAdTargetAuthority(state.db, {
    scope,
    target: recommendation.evidence.writableTarget,
    allowedSourceFiles,
    syntheticRecommendationEntityId: recommendation.entityId,
  });
  const ownershipBlockers = getRecommendationWritableTargetOwnershipBlockers(
    recommendation,
    canonicalTarget,
    sourceAuthority,
  );
  if (ownershipBlockers.length > 0) {
    throw new Error(`结果核对被阻断：Ads 可写对象不属于当前建议：${ownershipBlockers.join('、')}。`);
  }
  return sourceAuthority;
}

function validateCurrentAdReadbackEvidenceAuthority(
  evidencePath: string,
  stage: 'verify' | 'final-readiness',
): { ok: true } | { ok: false; message: string } {
  let evidence: Record<string, any> = {};
  try {
    evidence = JSON.parse(fs.readFileSync(path.resolve(evidencePath), 'utf8')) as Record<string, any>;
    const authority = evidence.authority || {};
    const gate = getBusinessRecommendationGate(authority, 'readback');
    const recommendation = state.recommendationRepo?.findById(Number(authority.recommendationId));
    const sourceAuthority = assertRecommendationWritableTargetCurrent(
      recommendation,
      {
        dateFrom: gate.scope.dateFrom,
        dateTo: gate.scope.dateTo,
        storeName: gate.scope.storeName,
        marketplaceCode: gate.scope.marketplaceCode,
        asin: gate.scope.asin,
        batchId: gate.scope.batchId || '',
      },
      gate.metricSource.sourceFiles,
    );
    assertCurrentAdReadbackEvidenceAuthority({
      evidence,
      recommendation,
      resolvedScope: {
        dateFrom: gate.scope.dateFrom,
        dateTo: gate.scope.dateTo,
        storeName: gate.scope.storeName,
        marketplaceCode: gate.scope.marketplaceCode,
        asin: gate.scope.asin,
        batchId: gate.scope.batchId || '',
      },
      allowedSourceFiles: gate.metricSource.sourceFiles,
      sourceAuthority,
    });
    return { ok: true };
  } catch (caught) {
    const authority = evidence.authority || {};
    console.warn('[AdReadbackAuthority]', {
      stage,
      recommendationId: Number(authority.recommendationId) || null,
      revision: Number(authority.recommendationRevision) || 0,
      batchId: String(authority.batchId || ''),
      reason: caught instanceof Error ? caught.message : 'authority check failed',
    });
    return {
      ok: false,
      message: '数据库中的已批准建议或当前范围已变化，请刷新后重新导出并校验。',
    };
  }
}

function handleRefreshFinalReadiness(input?: { adReadbackPath?: string }): { success: boolean; evidenceManifestPath: string; finalReadinessPath: string; readiness: DeliveryReadinessView } {
  const result = refreshFinalReadiness({
    repoRootDir: REPO_ROOT_DIR,
    evidenceDir: CODEX_EVIDENCE_DIR,
    releaseDir: path.join(REPO_ROOT_DIR, 'apps', 'desktop', 'release'),
    appVersion: APP_VERSION,
    adReadbackPath: typeof input?.adReadbackPath === 'string' && input.adReadbackPath.trim() ? input.adReadbackPath : undefined,
    validateAdReadbackAuthority: (evidencePath) => validateCurrentAdReadbackEvidenceAuthority(evidencePath, 'final-readiness'),
  });
  return {
    success: true,
    evidenceManifestPath: result.evidenceManifestPath,
    finalReadinessPath: result.finalReadinessPath,
    readiness: normalizeDeliveryReadiness(readJsonFile(result.finalReadinessPath), result.finalReadinessPath, {
      currentPackage: getPackageEvidenceStatus(path.join(REPO_ROOT_DIR, 'apps', 'desktop', 'release')),
    }),
  };
}

function recordAdActionReasonAiCallLog(input: {
  recommendation: ActionRecommendation;
  explanation: AdActionExplanationForLog;
  model: string;
}): void {
  try {
    state.aiCallLogRepo?.insert(buildAdActionReasonAiCallLogInput(input));
  } catch (error) {
    console.warn('[AI] Failed to write ad action reason log', error);
  }
}

function recordAdStrategyDiagnosisRun(input: {
  diagnosis: AdStrategyDiagnosisOutput;
  settings: ReturnType<typeof normalizeAiSettings>;
  scope: Record<string, unknown>;
  evidencePackSummary?: AiEvidencePackSummary;
  evidencePackPreview?: AiEvidenceItem[];
  aiInsights: AiInsightSummary[];
  formalRecommendationCount: number;
}): void {
  try {
    state.aiDiagnosisRunRepo?.insert({
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'ad_strategy_diagnosis_v1',
      model: input.settings.aiModel,
      scope: input.scope,
      evidencePackSummary: input.evidencePackSummary,
      evidencePackPreview: input.evidencePackPreview,
      diagnosis: {
        schemaVersion: input.diagnosis.schemaVersion,
        source: input.diagnosis.source,
        lifecycleStage: input.diagnosis.lifecycleStage,
        lifecycleStageReason: input.diagnosis.lifecycleStageReason,
        lifecycleStageEvidenceRefs: input.diagnosis.lifecycleStageEvidenceRefs,
        lifecycleStageRequiresReview: input.diagnosis.lifecycleStageRequiresReview,
        lifecycleStageInvalidReasons: input.diagnosis.lifecycleStageInvalidReasons,
        summary: input.diagnosis.summary,
        mainProblems: input.diagnosis.mainProblems,
        thresholdSuggestions: input.diagnosis.thresholdSuggestions,
        aiCandidateCount: input.diagnosis.aiCandidates.length,
        riskWarnings: input.diagnosis.riskWarnings,
        aiFallbackReason: input.diagnosis.aiFallbackReason,
      },
      insights: input.aiInsights,
      formalRecommendationCount: input.formalRecommendationCount,
      success: input.diagnosis.source === 'ai' && !input.diagnosis.aiFallbackReason,
      errorMessage: input.diagnosis.aiFallbackReason,
    });
  } catch (error) {
    console.warn('[AI] Failed to write ad strategy diagnosis run', error);
  }
}

function handleListAiDiagnosisRuns(request: any = {}) {
  if (!state.aiDiagnosisRunRepo) return [];
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(20, Number(request.limit))) : 5;
  return state.aiDiagnosisRunRepo.findRecent({
    dateFrom: typeof request.dateFrom === 'string' && request.dateFrom.trim() ? request.dateFrom.trim() : undefined,
    dateTo: typeof request.dateTo === 'string' && request.dateTo.trim() ? request.dateTo.trim() : undefined,
    storeName: typeof request.storeName === 'string' && request.storeName.trim() ? request.storeName.trim() : undefined,
    marketplaceCode: typeof request.marketplaceCode === 'string' && request.marketplaceCode.trim() ? request.marketplaceCode.trim() : undefined,
    asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
    batchId: typeof request.batchId === 'string' && request.batchId.trim() ? request.batchId.trim() : undefined,
    limit,
  });
}

function hashAiDiagnosisInput(
  input: ReturnType<typeof buildAdStrategyDiagnosisInput>,
  evidencePackSummary?: AiEvidencePackSummary,
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      scope: input.scope,
      currentRuleConfig: input.currentRuleConfig,
      metricCount: input.metrics.length,
      operationEventCount: input.operationEvents.length,
      productContextCount: input.productContexts?.length || 0,
      ruleCandidateCount: input.ruleCandidates.length,
      evidencePackSummary,
    }))
    .digest('hex');
}

async function handleRunAdStrategyDiagnosis(request: any = {}): Promise<{
  configured: boolean;
  invoked: boolean;
  model: string;
  metrics: number;
  ruleCandidateCount: number;
  summary: AdStrategyGenerationSummary;
}> {
  const scope = {
    dateFrom: typeof request.dateFrom === 'string' && request.dateFrom.trim() ? request.dateFrom.trim() : undefined,
    dateTo: typeof request.dateTo === 'string' && request.dateTo.trim() ? request.dateTo.trim() : undefined,
    storeName: typeof request.storeName === 'string' && request.storeName.trim() ? request.storeName.trim() : undefined,
    marketplaceCode: typeof request.marketplaceCode === 'string' && request.marketplaceCode.trim() ? request.marketplaceCode.trim() : undefined,
    asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
    batchId: typeof request.batchId === 'string' && request.batchId.trim() ? request.batchId.trim() : undefined,
  };
  if (!scope.dateFrom || !scope.dateTo || !scope.storeName || !scope.marketplaceCode) {
    throw new Error('AI 阶段诊断需要明确当前操作范围：开始日期、结束日期、店铺和站点。');
  }

  const gate = getBusinessRecommendationGate(scope, 'diagnosis');
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(1000, Number(request.limit))) : 300;
  const metrics = filterFormalRecommendationMetrics(
    loadBusinessRecommendationMetrics(gate.scope, gate.metricSource, Math.max(limit, RECOMMENDATION_METRIC_LOAD_LIMIT)),
    gate.scope.asin,
  );
  assertRecommendationMetricsLoaded({
    metricsLength: metrics.length,
    realReportFileCount: gate.pipeline.collection.fileAudit.realReportFileCount,
    requiredReportCount: LINGXING_AD_REPORTS.length,
    sourceFileCount: gate.metricSource.sourceFiles.length,
    sourceRowCount: countMetricsWithSourceRow(metrics),
    sourceFileRowCount: countMetricsWithSourceFileAndRow(metrics),
    asinBoundCount: countMetricsWithAsin(metrics),
    scopeAsin: gate.scope.asin,
    importedRows: gate.pipeline.collection.fileAudit.importedRowCount,
  });

  const runtimeConfig = currentStoreRuntimeAnalysisConfig();
  assertRuntimeConfigStore(runtimeConfig, gate.scope.storeId);
  assertRuntimeAnalysisWindow(runtimeConfig, gate.scope.dateFrom, gate.scope.dateTo);
  const generator = new RecommendationGenerator(runtimeConfig.ruleConfig);
  const firstMetric = metrics[0];
  const ruleCandidates = bindRecommendationsToScopeAsin(generator.generateTimelineBatch(metrics, {
    storeName: scope.storeName || firstMetric?.storeName || state.currentStore || 'unknown',
    marketplaceCode: scope.marketplaceCode || firstMetric?.marketplaceCode || 'US',
    config: runtimeConfig.ruleConfig,
    taskId: `strategy_${Date.now()}`,
  }), gate.scope.asin);
  const operationEvents = state.operationEventRepo?.findByScopeForStore(gate.scope.storeId, {
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    limit: 100,
  }) || [];
  const productContexts = loadProductStrategyContexts(gate.scope);
  const productHistoryLedgers = buildAdProductHistoryLedger({
    scope: gate.scope,
    metrics,
    operationEvents,
    productContexts,
  });
  const evidencePack = buildAdAiEvidencePack({
    scope: {
      dateFrom: gate.scope.dateFrom,
      dateTo: gate.scope.dateTo,
      storeName: gate.scope.storeName,
      marketplaceCode: gate.scope.marketplaceCode,
      asin: gate.scope.asin,
      batchId: gate.scope.batchId,
    },
    metrics,
    operationEvents,
    productContexts,
    ruleRecommendations: ruleCandidates,
    productHistoryLedgers,
  });
  const evidencePackSummary = summarizeAiEvidencePack(evidencePack);
  const diagnosisInput = buildAdStrategyDiagnosisInput({
    scope: gate.scope,
    metrics,
    operationEvents,
    productContexts,
    ruleConfig: runtimeConfig.ruleConfig as RuleConfig & { minSpend?: number },
    recommendations: ruleCandidates,
    evidencePack,
  });
  const settings = readAiSettingsForMain();
  const fallbackDiagnosis: AdStrategyDiagnosisOutput = {
    schemaVersion: 'ad_strategy_diagnosis_v1',
    evidenceSufficiency: assessAdEvidenceSufficiency(diagnosisInput),
    lifecycleStage: 'unknown',
    lifecycleStageReason: runtimeConfig.values.aiRecommendationsEnabled
      ? '未配置 AI Key，不能执行 AI 阶段判断。'
      : '当前店铺已关闭 AI 建议，不能执行 AI 阶段判断。',
    lifecycleStageEvidenceRefs: [],
    summary: runtimeConfig.values.aiRecommendationsEnabled
      ? '未配置 AI Key，广告阶段诊断使用规则 fallback。'
      : '当前店铺已关闭 AI 建议，广告阶段诊断使用规则 fallback。',
    mainProblems: [],
    thresholdSuggestions: {
      targetAcos: {
        value: diagnosisInput.currentRuleConfig.targetAcos,
        reason: '当前规则配置 fallback。',
      },
      highAcosThreshold: {
        value: diagnosisInput.currentRuleConfig.highAcosThreshold,
        reason: '当前规则配置 fallback。',
      },
      noOrderClickThreshold: {
        value: diagnosisInput.currentRuleConfig.noOrderClickThreshold,
        reason: '当前规则配置 fallback。',
      },
      minSpend: {
        value: diagnosisInput.currentRuleConfig.minSpend,
        reason: '当前规则配置 fallback。',
      },
    },
    aiCandidates: [],
    insightOnlyCandidates: [],
    riskWarnings: ['AI 不可用，必须人工复核规则建议。'],
    source: 'rule',
    aiFallbackReason: runtimeConfig.values.aiRecommendationsEnabled
      ? '未配置 AI Key，广告阶段诊断使用规则 fallback'
      : '当前店铺已关闭 AI 建议，广告阶段诊断使用规则 fallback',
  };
  const diagnosis = runtimeConfig.values.aiRecommendationsEnabled && settings.aiApiKey
    ? await new AdStrategyDiagnoser(new OpenAICompatibleProvider(buildAiProviderConfig(settings)), {
        persona: settings.aiPersona,
        outputLanguage: settings.aiOutputLanguage,
        maxTokens: parseIntegerSetting(settings.aiMaxTokens || settings.ai_max_tokens, 8192),
      }).diagnose(diagnosisInput)
    : fallbackDiagnosis;
  recordAdStrategyAiCallLog(diagnosisInput, diagnosis, settings, evidencePackSummary);
  const validation = validateAiDiagnosisEvidence({
    diagnosis,
    evidencePack,
    scope: gate.scope,
  });
  const aiInsights = buildAiInsightsFromValidation(diagnosis, validation.invalidReasons);
  const mergeDiagnosis: AdStrategyDiagnosisOutput = {
    ...diagnosis,
    aiCandidates: diagnosis.aiCandidates.filter((_, index) => validation.validCandidateIndexes.includes(index)),
  };
  const evidencePackPreview = selectStrategyEvidencePreview(mergeDiagnosis, aiInsights, evidencePack);
  recordAdStrategyDiagnosisRun({
    diagnosis: mergeDiagnosis,
    settings,
    scope: gate.scope,
    evidencePackSummary,
    evidencePackPreview,
    aiInsights,
    formalRecommendationCount: 0,
  });

  return {
    configured: runtimeConfig.values.aiRecommendationsEnabled && Boolean(settings.aiApiKey),
    invoked: runtimeConfig.values.aiRecommendationsEnabled && Boolean(settings.aiApiKey),
    model: settings.aiModel,
    metrics: metrics.length,
    ruleCandidateCount: ruleCandidates.length,
    summary: summarizeStrategyDiagnosis(mergeDiagnosis, operationEvents.length, productContexts.length, aiInsights, evidencePackSummary, evidencePackPreview),
  };
}

function assertRecommendationCurrentDataGate(recommendationId: number): {
  recommendation: ActionRecommendation;
  allowedSourceFiles: string[];
  sourceAuthority: RecommendationMetricSourceAuthority;
} {
  const recommendation = state.recommendationRepo?.findById(recommendationId);
  if (!recommendation) {
    throw new Error('审批被阻断：建议不存在，请刷新后重试。');
  }
  const batchId = recommendation.evidence?.batchId;
  if (!batchId) {
    throw new Error('审批被阻断：该建议缺少当前数据批次 evidence.batchId，请基于真实报表重新生成建议。');
  }
  let batchResult: BusinessBatchResult;
  try {
    batchResult = loadPersistedLingxingBatch(batchId);
  } catch {
    throw new Error(`审批被阻断：建议绑定的数据批次不存在或不可读取：${batchId}`);
  }
  const scope = {
    dateFrom: batchResult.batch.dateStart,
    dateTo: batchResult.batch.dateEnd,
    storeName: batchResult.batch.storeName || recommendation.storeName,
    marketplaceCode: batchResult.batch.marketplaceCode || recommendation.marketplaceCode,
    asin: recommendation.asin,
    batchId,
  };
  const gate = getBusinessRecommendationGate(scope, 'approval');
  const sourceAuthority = assertRecommendationWritableTargetCurrent(
    recommendation,
    scope,
    gate.metricSource.sourceFiles,
  );
  return {
    recommendation,
    allowedSourceFiles: gate.metricSource.sourceFiles,
    sourceAuthority,
  };
}

function handleBindRecommendationWritableTarget(
  input: BindRecommendationWritableTargetRequest,
): BindRecommendationWritableTargetResult {
  const request = input || {} as BindRecommendationWritableTargetRequest;
  if (!Number.isInteger(request.recommendationId) || request.recommendationId <= 0) {
    throw new Error('Ads 对象核验被阻断：缺少有效 recommendation id。');
  }
  if (!state.db || !state.recommendationRepo) {
    throw new Error('Ads 对象核验被阻断：本地权威数据库尚未初始化。');
  }
  const recommendation = state.recommendationRepo.findById(request.recommendationId);
  if (!recommendation) {
    throw new Error('Ads 对象核验被阻断：建议不存在，请刷新后重试。');
  }
  const gate = getBusinessRecommendationGate(request.scope, 'approval');
  const sourceAuthority = assertRecommendationMetricSourceAuthority(state.db, {
    recommendation,
    scope: request.scope,
    allowedSourceFiles: gate.metricSource.sourceFiles,
  });
  const boundAt = new Date().toISOString();
  const result = bindRecommendationWritableTarget({
    recommendation,
    request,
    allowedSourceFiles: gate.metricSource.sourceFiles,
    sourceAuthority,
    boundAt,
    resolveWritableTarget: (candidate, context) => resolveWritableAdTargetAuthority(state.db!, {
      scope: request.scope,
      candidate,
      allowedSourceFiles: gate.metricSource.sourceFiles,
      syntheticRecommendationEntityId: recommendation.entityId,
      verifiedBy: context.boundBy,
      verifiedAt: context.boundAt,
    }),
    persist: (evidencePatch) => state.recommendationRepo!.bindWritableTargetIfCurrent(
      request.recommendationId,
      request.expectedRevision,
      evidencePatch,
    ),
  });
  mainWindow?.webContents.send('business-ui:data-updated');
  return result;
}

function handleResolveRecommendationReview(input: ResolveRecommendationReviewRequest): ResolveRecommendationReviewResult {
  const request = input || {} as ResolveRecommendationReviewRequest;
  if (!Number.isInteger(request.recommendationId) || request.recommendationId <= 0) {
    throw new Error('复核被阻断：缺少有效 recommendation id。');
  }
  if (!state.db || !state.recommendationRepo) {
    throw new Error('复核被阻断：本地权威数据库尚未初始化。');
  }
  const recommendation = state.recommendationRepo.findById(request.recommendationId);
  if (!recommendation) {
    throw new Error('复核被阻断：建议不存在，请刷新后重试。');
  }
  const gate = getBusinessRecommendationGate(request.scope, 'approval');
  const sourceAuthority = assertRecommendationMetricSourceAuthority(state.db, {
    recommendation,
    scope: request.scope,
    allowedSourceFiles: gate.metricSource.sourceFiles,
  });
  const reviewedAt = new Date().toISOString();
  const result = resolveRecommendationReview({
    recommendation,
    request,
    allowedSourceFiles: gate.metricSource.sourceFiles,
    sourceAuthority,
    reviewedAt,
    resolveWritableTarget: (candidate, context) => resolveWritableAdTargetAuthority(state.db!, {
      scope: request.scope,
      candidate,
      allowedSourceFiles: gate.metricSource.sourceFiles,
      syntheticRecommendationEntityId: recommendation.entityId,
      verifiedBy: context.reviewedBy,
      verifiedAt: context.reviewedAt,
    }),
    persist: (status, evidencePatch) => state.recommendationRepo!.updateStatusWithEvidenceIfCurrent(
      request.recommendationId,
      'needs_review',
      request.expectedRevision,
      status,
      evidencePatch,
    ),
  });
  mainWindow?.webContents.send('business-ui:data-updated');
  return result;
}

async function handleApproveRecommendation(input: any): Promise<void> {
  const { id, expectedRevision: requestedRevision, decision } = normalizeRecommendationDecisionRequest(input);
  if (!id) throw new Error('批准建议失败：缺少 recommendation id。');
  const { recommendation, allowedSourceFiles, sourceAuthority } = assertRecommendationCurrentDataGate(id);
  const expectedRevision = assertRecommendationDecisionRevision(recommendation, requestedRevision);
  applyRecommendationDecision({
    recommendation,
    targetStatus: 'approved',
    decision,
    approvalOptions: { allowedSourceFiles, sourceAuthority },
    persist: (status, evidencePatch) => {
      const updated = state.recommendationRepo?.updateStatusWithEvidenceIfCurrent(
        id,
        recommendation.status,
        expectedRevision,
        status,
        evidencePatch,
      );
      if (!updated) {
        throw new Error('审批状态冲突：建议状态已变化，请刷新后重试。');
      }
    },
  });
}

async function handleRejectRecommendation(input: any): Promise<void> {
  const { id, expectedRevision: requestedRevision, decision } = normalizeRecommendationDecisionRequest(input);
  if (!id) throw new Error('拒绝建议失败：缺少 recommendation id。');
  const recommendation = state.recommendationRepo?.findById(id);
  if (!recommendation) {
    throw new Error('拒绝建议失败：建议不存在，请刷新后重试。');
  }
  const expectedRevision = assertRecommendationDecisionRevision(recommendation, requestedRevision);
  applyRecommendationDecision({
    recommendation,
    targetStatus: 'rejected',
    decision,
    persist: (status, evidencePatch) => {
      const updated = state.recommendationRepo?.updateStatusWithEvidenceIfCurrent(
        id,
        recommendation.status,
        expectedRevision,
        status,
        evidencePatch,
      );
      if (!updated) {
        throw new Error('审批状态冲突：建议状态已变化，请刷新后重试。');
      }
    },
  });
}

function handleGetRecommendations(filter: any = []): any[] {
  const request = Array.isArray(filter) ? {} : (filter || {});
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(500, Number(request.limit))) : 100;
  const status = typeof request.status === 'string' && request.status.trim() ? request.status.trim() : undefined;
  const hasFullScope = Boolean(
    typeof request.dateFrom === 'string' && request.dateFrom.trim()
      && typeof request.dateTo === 'string' && request.dateTo.trim()
      && typeof request.storeName === 'string' && request.storeName.trim()
      && typeof request.marketplaceCode === 'string' && request.marketplaceCode.trim(),
  );
  if (!hasFullScope) {
    return [];
  }

  let gate: ReturnType<typeof getBusinessRecommendationGate>;
  try {
    gate = getBusinessRecommendationGate({
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      storeName: request.storeName,
      marketplaceCode: request.marketplaceCode,
      asin: request.asin,
      batchId: request.batchId,
    }, 'recommendation-list');
  } catch {
    return [];
  }

  if (state.recommendationRepo?.findByFilter) {
    const normalizedFilter = {
      storeName: gate.scope.storeName,
      marketplaceCode: gate.scope.marketplaceCode,
      asin: gate.scope.asin,
      status,
      dateFrom: gate.scope.dateFrom,
      dateTo: gate.scope.dateTo,
      page: 0,
      pageSize: limit,
    };
    return state.recommendationRepo.findByFilter(normalizedFilter).items.filter((item) => item.evidence?.batchId === gate.scope.batchId);
  }

  return [];
}

function handleExportAdReadbackEvidence(input: ExportAuthorizedAdReadbackEvidenceRequest): {
  jsonPath: string;
  markdownPath: string;
  sha256: string;
  status: string;
  readyForVerifier: boolean;
  nextAction: 'verify' | 'prepare';
  authority: { recommendationId: number; revision: number; batchId: string };
} {
  const request = input || {} as ExportAuthorizedAdReadbackEvidenceRequest;
  let gate: ReturnType<typeof getBusinessRecommendationGate>;
  try {
    gate = getBusinessRecommendationGate(request.scope, 'readback');
  } catch (caught) {
    console.warn('[AdReadbackAuthority]', {
      stage: 'export-gate',
      recommendationId: Number(request.recommendationId) || null,
      reason: caught instanceof Error ? caught.message : String(caught || '当前范围不可用'),
    });
    throw new Error('结果核对被阻断：当前范围无法绑定真实报表批次，请刷新范围后重试。');
  }
  const recommendation = state.recommendationRepo?.findById(Number(request.recommendationId));
  const sourceAuthority = assertRecommendationWritableTargetCurrent(
    recommendation,
    {
      dateFrom: gate.scope.dateFrom,
      dateTo: gate.scope.dateTo,
      storeName: gate.scope.storeName,
      marketplaceCode: gate.scope.marketplaceCode,
      asin: gate.scope.asin,
      batchId: gate.scope.batchId || '',
    },
    gate.metricSource.sourceFiles,
  );
  const evidenceInput = buildAuthorizedAdReadbackEvidenceInput({
    request,
    recommendation,
    resolvedScope: {
      dateFrom: gate.scope.dateFrom,
      dateTo: gate.scope.dateTo,
      storeName: gate.scope.storeName,
      marketplaceCode: gate.scope.marketplaceCode,
      asin: gate.scope.asin,
      batchId: gate.scope.batchId || '',
    },
    allowedSourceFiles: gate.metricSource.sourceFiles,
    sourceAuthority,
  });
  const evidence = buildAdReadbackEvidence(evidenceInput);
  const exportDir = path.join(EXPORTS_DIR, 'ad-readback-evidence');
  fs.mkdirSync(exportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(exportDir, `real-ad-execution-readback-${stamp}.json`);
  const markdownPath = jsonPath.replace(/\.json$/i, '.md');
  const jsonContent = `${JSON.stringify(evidence, null, 2)}\n`;
  fs.writeFileSync(jsonPath, jsonContent, 'utf8');
  fs.writeFileSync(markdownPath, adReadbackEvidenceToMarkdown(evidence, jsonPath), 'utf8');
  const readyForVerifier = evidence.status === 'PASS';
  return {
    jsonPath,
    markdownPath,
    sha256: crypto.createHash('sha256').update(jsonContent, 'utf8').digest('hex').toUpperCase(),
    status: evidence.status,
    readyForVerifier,
    nextAction: readyForVerifier ? 'verify' : 'prepare',
    authority: {
      recommendationId: request.recommendationId,
      revision: request.expectedRevision,
      batchId: gate.scope.batchId || '',
    },
  };
}

function handlePrepareAdReadbackSession(input: { sourcePath?: string; outDir?: string }): PreparedAdReadbackSession {
  return prepareAdReadbackSession({
    sourcePath: String(input?.sourcePath || ''),
    outDir: typeof input?.outDir === 'string' && input.outDir.trim() ? input.outDir : undefined,
  });
}

function handleVerifyAdReadbackSession(input: { sessionDir?: string }): VerifiedAdReadbackSession {
  return verifyAdReadbackSession(String(input?.sessionDir || ''));
}

function handleFillAdReadbackSession(input: { sessionDir?: string }): FilledAdReadbackSession {
  return fillAdReadbackSession(String(input?.sessionDir || ''));
}

function handleVerifyAdReadbackEvidence(input: { evidencePath?: string }): VerifiedAdReadbackEvidence {
  const result = verifyAdReadbackEvidenceFile(String(input?.evidencePath || ''));
  if (!result.ready) return result;

  const authority = validateCurrentAdReadbackEvidenceAuthority(result.evidencePath, 'verify');
  if (authority.ok) {
    return {
      ...result,
      checks: [
        ...result.checks,
        { label: 'database authority is still approved and current', passed: true },
      ],
    };
  }

  return {
    ...result,
    ready: false,
    status: 'NEEDS_WORK',
    checks: [
      ...result.checks,
      { label: 'database authority is still approved and current', passed: false, details: authority.message },
    ],
    issues: [...result.issues, authority.message],
  };
}

function handleSaveReadbackCapture(input: {
  slot?: ReadbackCaptureSlot;
  dataUrl?: string;
  fileName?: string;
  sessionDir?: string;
}): SavedReadbackCapture {
  const slot = input?.slot;
  if (!slot || !['approval', 'before', 'after', 'readback'].includes(slot)) {
    throw new Error(`Unsupported readback capture slot: ${slot || '<missing>'}`);
  }
  return saveReadbackCaptureFile({
    slot,
    dataUrl: String(input?.dataUrl || ''),
    fileName: typeof input?.fileName === 'string' ? input.fileName : undefined,
    sessionDir: typeof input?.sessionDir === 'string' && input.sessionDir.trim() ? input.sessionDir : undefined,
    fallbackRootDir: path.join(EXPORTS_DIR, 'ad-readback-captures'),
  });
}

async function handleExecuteRecommendation(recommendationId: number): Promise<void> {
  const recommendation = state.recommendationRepo?.findById(recommendationId);
  if (!recommendation) {
    throw new Error('执行被阻断：建议不存在，请刷新后重试。');
  }

  if (recommendation.status !== 'approved') {
    throw new Error('执行被阻断：建议必须先完成人工批准。');
  }

  const executionResult = buildAdExecutionUnavailableResult(
    recommendation,
    '真实广告执行器尚未接入可验证回读。为避免误改广告账户或产生假成功记录，本次执行已阻断。',
  );
  const executionOutcome = getRecommendationExecutionOutcome(executionResult);

  const screenshotBefore = await tryCaptureExecutionScreenshot('before');
  const screenshotAfter = await tryCaptureExecutionScreenshot('after');

  // Log execution
  state.actionLogRepo?.insert(buildActionLogForExecution({
    recommendationId,
    recommendation,
    executionResult,
    outcome: executionOutcome,
    screenshotBefore,
    screenshotAfter,
  }));

  if (executionOutcome.shouldMarkExecuted) {
    state.recommendationRepo?.updateStatus(recommendationId, executionOutcome.recommendationStatus);
    return;
  }

  throw new Error(executionResult.error || '广告执行未通过回读确认，建议状态保持为 approved。');
}

// ============================================================================
// Daily Reports
// ============================================================================

async function runDailyReportGeneration(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Get summary data
  const totalRevenue = state.adMetricsRepo?.getTotalSales(today) || 0;
  const totalCost = state.adMetricsRepo?.getTotalCost(today) || 0;
  const avgAcos = totalRevenue > 0 ? totalCost / totalRevenue : 0;
  const totalClicks = state.adMetricsRepo?.getTotalClicks(today) || 0;
  const totalOrders = state.adMetricsRepo?.getTotalOrders(today) || 0;

  const summary = {
    date: today,
    storeName: state.currentStore || 'unknown',
    salesOverview: {
      totalRevenue,
      totalOrders,
      avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      comparedToYesterday: 0,
    },
    adPerformance: {
      totalCost,
      totalSales: totalRevenue,
      avgAcos,
      totalClicks,
      comparedToYesterday: 0,
    },
    recommendationsSummary: readDailyReportRecommendationSummary(state.recommendationRepo, today),
    inventoryAlerts: {
      outOfStock: 0,
      lowStock: 0,
    },
    topRisks: [] as string[],
  };

  // Generate AI report if configured
  const settings = readAiSettingsForMain();
  if (!settings.aiApiKey) {
    throw new Error('AI Key 未配置，无法生成每日运营报告。');
  }
  try {
    const provider = new OpenAICompatibleProvider(buildAiProviderConfig(settings));
    const reportGen = new DailyReportGenerator(provider);
    const report = await reportGen.generate(summary);

    // Save report
    const reportPath = path.join(REPORTS_DIR, `daily_${today}.json`);
    fs.writeFileSync(reportPath, report);
    console.log(`[Scheduler] Daily report generated: ${reportPath}`);
  } catch (err) {
    console.error('[Scheduler] AI report generation failed:', err);
    throw err;
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

function registerIpcHandlers(): void {
  if (!state.storeCoordinator) throw new Error('Store coordinator is not initialized');
  if (!state.missionDomainService) throw new Error('Mission domain service is not initialized');
  if (!state.analysisAuthorityService) throw new Error('Analysis authority service is not initialized');
  if (!state.executionAuthorityService) throw new Error('Execution authority service is not initialized');
  if (!state.storeRuntimeConfigService) throw new Error('Store runtime config service is not initialized');
  if (!state.productRepo || !state.operationEventRepo) {
    throw new Error('Store-scoped object repositories are not initialized');
  }
  const schedulerEvidenceIpc = packageUiSchedulerAudit.wrapRegistrar(ipcMain);
  packageUiSchedulerAudit.registerDatabaseCheckpointIpc(ipcMain);
  registerStoreIpcHandlers(ipcMain, state.storeCoordinator, {
    beforeActiveStoreMutation: (context) => {
      state.executionAuthorityService?.assertStoreMutationAllowed(context);
    },
    onStoreChanged: (view) => {
      const runtime = state.browserRuntime;
      const staleRuntime = runtime && (
        runtime.context.storeId !== view.context.storeId
        || runtime.context.sessionGeneration !== view.context.sessionGeneration
      )
        ? detachBrowserRuntimeForStore(runtime.context.storeId)
        : null;
      const pendingControllers = invalidatePendingBrowserLogin();
      if (staleRuntime || pendingControllers.length > 0) {
        clearBrowserLoginState();
        void Promise.all([
          closeBrowserRuntime(staleRuntime),
          closeBrowserControllers(pendingControllers),
        ]);
      }
      storeCapsuleFor(view.store);
      try {
        state.executionAuthorityService?.reconcileActiveStore(view.context);
      } catch (error) {
        console.error('[Execution] recovered Mission stop reconciliation failed:', error);
      }
      void state.executionAuthorityService?.resumePolicyGrantDispatches(
        view.context,
        'store_activated',
      ).catch(() => {
        console.error('[Execution] persisted policy-grant recovery failed after store activation');
      });
      state.currentStore = view.store.displayName;
      publishStoreContextChanged(view);
      mainWindow?.webContents.send('business-ui:data-updated');
    },
    onStoreRecordChanged: (store) => {
      const activeContext = state.storeCoordinator?.getActiveStoreContext();
      if (activeContext?.storeId === store.storeId) {
        state.currentStore = store.status === 'active' ? store.displayName : '';
      }
      if (store.status !== 'active' && state.browserRuntime?.context.storeId === store.storeId) {
        const runtime = detachBrowserRuntimeForStore(store.storeId);
        const pendingControllers = invalidatePendingBrowserLogin(store.storeId);
        clearBrowserLoginState();
        void Promise.all([
          closeBrowserRuntime(runtime),
          closeBrowserControllers(pendingControllers),
        ]);
      } else if (store.status !== 'active' && pendingBrowserLogin?.context.storeId === store.storeId) {
        const pendingControllers = invalidatePendingBrowserLogin(store.storeId);
        clearBrowserLoginState();
        void closeBrowserControllers(pendingControllers);
      }
      storeCapsuleFor(store);
      mainWindow?.webContents.send('stores:changed', store);
      mainWindow?.webContents.send('business-ui:data-updated');
    },
  });
  registerMissionControlIpcHandlers(
    schedulerEvidenceIpc,
    state.storeCoordinator,
    createMissionControlLegacyAdapter({
      buildTodayProjection: buildAuthoritativeMissionControlTodayProjection,
      analysisAuthorityReady: Boolean(state.analysisAuthorityService),
      executionAuthorityReady: Boolean(state.executionAuthorityService),
      storeRuntimeConfigReady: Boolean(state.storeRuntimeConfigService),
      storeAutomationReady: Boolean(
        state.storeCollectionScheduler && state.storeEvidenceRetentionService
      ),
      missionDomain: state.missionDomainService,
    }),
  );
  registerMissionDomainIpcHandlers(ipcMain, state.missionDomainService);
  registerAnalysisAuthorityIpcHandlers(ipcMain, state.analysisAuthorityService);
  registerExecutionAuthorityIpcHandlers(ipcMain, state.executionAuthorityService);
  registerStoreRuntimeConfigIpcHandlers(
    ipcMain,
    state.storeRuntimeConfigService,
    (context) => {
      mainWindow?.webContents.send('business-ui:data-updated');
      reconcileStoreCollectionScheduler(context, 'config');
    },
  );
  if (!state.storeEvidenceRetentionService) {
    throw new Error('店铺证据保留预览服务尚未就绪。');
  }
  registerStoreEvidenceRetentionIpcHandlers(
    schedulerEvidenceIpc,
    state.storeEvidenceRetentionService,
  );
  if (!state.storeCollectionScheduler) {
    throw new Error('店铺级采集调度服务尚未就绪。');
  }
  registerStoreCollectionSchedulerIpcHandlers(
    schedulerEvidenceIpc,
    packageUiReadOnlyRuntime
      ? {
          get: (context) => state.storeCollectionScheduler!.get(context),
          runNow: async () => {
            throw new Error(
              'PACKAGE_UI_EVIDENCE_READ_ONLY: package UI evidence may read scheduler state but may not execute collection.',
            );
          },
        }
      : state.storeCollectionScheduler,
  );
  registerStoreScopedObjectsIpcHandlers(
    ipcMain,
    new StoreScopedObjectsService({
      storeCoordinator: state.storeCoordinator,
      productRepository: state.productRepo,
      operationEventRepository: state.operationEventRepo,
      validateEvidenceArtifact: (store, artifactId) => {
        try {
          mainArtifactRegistry.resolve({
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
        state.missionDomainService!.recordOperationEventMutation(context, mutation);
        mainWindow?.webContents.send('business-ui:data-updated');
      },
    },
  );
  state.storeScopedAdListingService = new StoreScopedAdListingService({
    db: state.db!,
    storeCoordinator: state.storeCoordinator,
  });
  registerStoreScopedAdListingIpcHandlers(
    ipcMain,
    state.storeScopedAdListingService,
    {
      onListingChanged: () => {
        mainWindow?.webContents.send('business-ui:data-updated');
      },
    },
  );

  // App
  ipcMain.handle('app:get-version', () => '1.5.0');
  ipcMain.handle('app:get-state', () => ({
    isLoggedIn: state.isLoggedIn,
    currentStore: state.currentStore,
    loginSession: state.loginSession,
    storeContext: state.storeCoordinator?.getActiveStoreContext() ?? null,
  }));

  // Settings
  ipcMain.handle('settings:get', () => sanitizeAiSettingsForRenderer(readAiSettingsForMain()));
  ipcMain.handle('settings:save', (_, settings) => {
    const incoming = settings && typeof settings === 'object'
      ? settings as Record<string, unknown>
      : {};
    persistAiSettingsForMain(normalizeAiSettingsForSave(incoming), {
      clearApiKey: inputRequestsAiKeyClear(incoming),
    });
    if (incoming.ruleConfig) {
      state.ruleConfig = incoming.ruleConfig as RuleConfig;
    }
    mainWindow?.webContents.send('business-ui:data-updated');
    return { success: true };
  });
  ipcMain.handle('settings:test-ai', async (_, settings) => {
    const result = await handleTestAiSettings(normalizeAiSettingsForTest(settings || {}));
    mainWindow?.webContents.send('business-ui:data-updated');
    return result;
  });
  ipcMain.handle('settings:ai-call-logs', (_, params) => handleListAiCallLogs(params));
  ipcMain.handle('settings:get-rule-config', () => state.ruleConfig);
  ipcMain.handle('settings:save-rule-config', (_, config: RuleConfig) => {
    state.settingsRepo?.saveRuleConfig(config);
    state.ruleConfig = config;
  });
  ipcMain.handle('settings:get-operation-scope', (_, storeContext) => handleGetOperationScope(storeContext));
  ipcMain.handle('settings:save-operation-scope', (_, request) => handleSaveOperationScope(request));
  ipcMain.handle('settings:get-storage-paths', () => handleGetStoragePaths());

  // Browser
  ipcMain.handle('browser:get-saved-credential-status', () => handleGetSavedLoginCredentialStatus());
  ipcMain.handle('browser:login', (_, input) =>
    handleBrowserLogin(normalizeBrowserLoginRequest(input))
  );
  ipcMain.handle('browser:logout', () => handleBrowserLogout());
  ipcMain.handle('browser:screenshot', (_, label) => handleScreenshot(normalizeScreenshotLabel(label)));
  ipcMain.handle('browser:is-ready', () => Boolean(
    state.storeCoordinator?.getActiveStoreContext()
    && isProviderBrowserSessionReady(state.storeCoordinator.getActiveStoreContext()!, 'lingxing')
    && isProviderBrowserSessionReady(state.storeCoordinator.getActiveStoreContext()!, 'amazon_ads'),
  ));

  // Reports
  ipcMain.handle('v1_5:reports:collect-lingxing', async (_, dateRange) => {
    const result = await handleCollectLingxingReports(dateRange);
    return projectLingxingCollectionResultForRenderer(result, result.metricsImport);
  });
  ipcMain.handle('v1_5:business-ui:data-pipeline', (_, scope) =>
    projectBusinessPipelineForRenderer(handleGetBusinessUiDataPipeline(scope))
  );
  ipcMain.handle('v1_5:business-ui:batch-options', (_, scope) => {
    const storeId = currentArtifactStore().storeId;
    return rendererPayload(handleGetBusinessBatchOptions(scope).map((batch) => (
      projectBusinessBatchOptionForRenderer(storeId, batch)
    )));
  });
  ipcMain.handle('v1_5:business-ui:import-current-reports', (_, scope) =>
    projectBusinessImportResultForRenderer(handleImportCurrentBusinessReports(scope))
  );
  ipcMain.handle('v1_5:business-ui:import-local-report-files', async (_, scope) =>
    projectBusinessImportResultForRenderer(await handleImportLocalBusinessReportFiles(scope))
  );
  ipcMain.handle('v1_5:delivery:readiness', () =>
    handleGetDeliveryReadiness()
  );
  ipcMain.handle('v1_5:delivery:refresh-final-readiness', (_, input) =>
    handleRefreshFinalReadiness(input)
  );
  ipcMain.handle('v1_5:delivery:evidence-status', (_, scope) =>
    handleGetDeliveryEvidenceStatus(scope)
  );
  ipcMain.handle('v1_5:delivery:export-bundle', (_, scope) =>
    handleExportDeliveryBundle(scope)
  );
  ipcMain.handle('v1_5:delivery:export-data-reconciliation', (_, scope) =>
    handleExportDataReconciliation(scope)
  );
  ipcMain.handle('v1_5:business-ui:export-data-reconciliation-artifacts', (_, scope) =>
    handleExportDataReconciliationArtifacts(scope)
  );
  ipcMain.handle('v1_5:settings:storage-paths', () =>
    handleGetStoragePaths()
  );
  ipcMain.handle('v1_5:reports:preflight-lingxing-collection', (_, dateRange) =>
    handlePreflightLingxingCollection(dateRange)
  );
  ipcMain.handle('v1_5:reports:export-lingxing-collection-preflight', (_, dateRange) =>
    projectExportArtifactForCurrentStore(
      handleExportLingxingCollectionPreflight(dateRange),
      'diagnostic-folder',
      '采集预检证据',
    )
  );
  ipcMain.handle('v1_5:reports:retry-lingxing-report', async (_, { dateRange, reportType }) => {
    const result = await handleRetryLingxingReport(dateRange, reportType);
    return projectLingxingCollectionResultForRenderer(result, result.metricsImport);
  });
  ipcMain.handle('v1_5:reports:download-existing-lingxing-reports', async (_, { dateRange, reportTypes }) => {
    const result = await handleDownloadExistingLingxingReports(dateRange, Array.isArray(reportTypes) ? reportTypes : []);
    return projectLingxingCollectionResultForRenderer(result, result.metricsImport);
  });
  ipcMain.handle('v1_5:reports:run-lingxing-canary-report', async (_, { dateRange, reportType }) => (
    projectLingxingCollectionResultForRenderer(await handleRunLingxingCanaryReport(dateRange, reportType))
  ));
  ipcMain.handle('v1_5:reports:list-lingxing-collection-jobs', (_, input) =>
    rendererPayload(handleListLingxingCollectionJobs(input))
  );
  ipcMain.handle('v1_5:reports:resume-lingxing-collection', async (_, input) =>
    rendererPayload(await handleResumeLingxingCollection(input))
  );
  ipcMain.handle('v1_5:reports:cancel-lingxing-collection', (_, input) =>
    handleCancelLingxingCollection(input)
  );
  ipcMain.handle('v1_5:reports:export-acceptance-audit', (_, { batchId, diagnosticId }) =>
    projectExportArtifactForCurrentStore(
      handleExportLingxingAcceptanceAudit(batchId, diagnosticId),
      'diagnostic-folder',
      '采集验收审计',
    )
  );
  ipcMain.handle('v1_5:reports:diagnose-download-center', async (_, dateRange) =>
    projectDiagnosticForRenderer(await handleDiagnoseLingxingDownloadCenter(dateRange))
  );
  ipcMain.handle('v1_5:reports:export-download-center-diagnostic-bundle', (_, { diagnosticId }) =>
    projectExportArtifactForCurrentStore(
      handleExportDownloadCenterDiagnosticBundle(diagnosticId),
      'diagnostic-folder',
      '下载中心诊断包',
    )
  );
  ipcMain.handle('v1_5:reports:export-download-center-page-model-draft', (_, { diagnosticId }) => {
    const result = handleExportDownloadCenterPageModelDraft(diagnosticId);
    return rendererPayload({
      artifact: projectExportArtifactForCurrentStore(result.exportPath, 'diagnostic-folder', '页面模型草稿'),
      draft: result.draft,
      notes: result.notes,
    });
  });
  ipcMain.handle('v1_5:reports:export-download-center-page-model-enablement-audit', (_, { dateRange, diagnosticId }) => {
    const result = handleExportDownloadCenterPageModelEnablementAudit(dateRange, diagnosticId);
    return rendererPayload({
      artifact: projectExportArtifactForCurrentStore(result.exportPath, 'diagnostic-folder', '页面模型放行审计'),
      canDisableManualVerification: result.canDisableManualVerification,
      missing: result.missing,
    });
  });
  ipcMain.handle('v1_5:reports:get-download-center-page-model', () =>
    handleGetDownloadCenterPageModel()
  );
  ipcMain.handle('v1_5:reports:save-download-center-page-model', (_, model) =>
    handleSaveDownloadCenterPageModel(model)
  );
  ipcMain.handle('v1_5:reports:reset-download-center-page-model', () =>
    handleResetDownloadCenterPageModel()
  );
  ipcMain.handle('v1_5:reports:open-artifact', (_, input) =>
    handleOpenArtifact(input)
  );
  // Recommendations
  ipcMain.handle('recommendations:get', (_, filter) => handleGetRecommendations(filter));
  ipcMain.handle('recommendations:generate', (_, filter) => runRecommendationGeneration(filter));
  ipcMain.handle('v1_5:business-ui:ad-strategy-diagnosis', (_, filter) => handleRunAdStrategyDiagnosis(filter));
  ipcMain.handle('v1_5:business-ui:ai-diagnosis-runs', (_, filter) => handleListAiDiagnosisRuns(filter));
  ipcMain.handle('recommendations:bind-writable-target', (_, input) => handleBindRecommendationWritableTarget(input));
  ipcMain.handle('recommendations:resolve-review', (_, input) => handleResolveRecommendationReview(input));
  ipcMain.handle('recommendations:approve', (_, id) => handleApproveRecommendation(id));
  ipcMain.handle('recommendations:reject', (_, id) => handleRejectRecommendation(id));
  ipcMain.handle('recommendations:execute', (_, id) => handleExecuteRecommendation(id));
  ipcMain.handle('recommendations:export-ad-readback-evidence', (_, input) => handleExportAdReadbackEvidence(input));
  ipcMain.handle('recommendations:prepare-ad-readback-session', (_, input) => handlePrepareAdReadbackSession(input));
  ipcMain.handle('recommendations:verify-ad-readback-session', (_, input) => handleVerifyAdReadbackSession(input));
  ipcMain.handle('recommendations:fill-ad-readback-session', (_, input) => handleFillAdReadbackSession(input));
  ipcMain.handle('recommendations:verify-ad-readback-evidence', (_, input) => handleVerifyAdReadbackEvidence(input));
  ipcMain.handle('recommendations:save-readback-capture', (_, input) => handleSaveReadbackCapture(input));

  // Scheduler
  ipcMain.handle('scheduler:get-tasks', () => state.scheduler?.getTasks() || []);
  ipcMain.handle('scheduler:set-task-enabled', () => {
    throw new Error('LEGACY_SCHEDULER_IPC_DISABLED: 请使用带 StoreContext 的店铺采集调度配置。');
  });
  ipcMain.handle('scheduler:run-now', async () => {
    throw new Error('LEGACY_SCHEDULER_IPC_DISABLED: 旧调度入口没有店铺授权，已失败关闭。');
  });

  // Logs
  ipcMain.handle('logs:get', (_, { dateFrom, dateTo, limit }) =>
    state.actionLogRepo?.findByDateRange(dateFrom, dateTo, limit) || []
  );

  // Metrics
  ipcMain.handle('metrics:get-recent', (_, days) =>
    state.adMetricsRepo?.getRecent(days) || []
  );
  ipcMain.handle('metrics:get-summary', (_, date) => ({
    totalSales: state.adMetricsRepo?.getTotalSales(date) || 0,
    totalCost: state.adMetricsRepo?.getTotalCost(date) || 0,
    totalClicks: state.adMetricsRepo?.getTotalClicks(date) || 0,
    totalOrders: state.adMetricsRepo?.getTotalOrders(date) || 0,
    avgAcos: 0,
  }));

  ipcMain.handle('v1_5:keywords:build-opportunities', (_, { metrics, options }) =>
    handleBuildKeywordOpportunities(metrics, options)
  );
  ipcMain.handle('v1_5:keywords:export-diagnostics', (_, { diagnostics }) =>
    handleExportKeywordDiagnostics(diagnostics)
  );
  ipcMain.handle('v1_5:listing:analyze-coverage', (_, { listing, keywords }) =>
    handleAnalyzeListingCoverage(listing, keywords)
  );
  ipcMain.handle('v1_5:listing:build-suggestions', (_, { listing, opportunities }) =>
    handleBuildListingSuggestions(listing, opportunities)
  );
  ipcMain.handle('v1_5:listing:update-suggestion-status', (_, { id, status }) =>
    handleUpdateListingSuggestionStatus(id, status)
  );
  ipcMain.handle('v1_5:listing:generate-drafts', (_, { suggestions }) =>
    handleGenerateListingDrafts(suggestions)
  );
  ipcMain.handle('v1_5:listing:export-suggestions', (_, { suggestions, format }) =>
    handleExportListingSuggestions(suggestions, format)
  );
  ipcMain.handle('v1_5:listing:export-drafts', (_, { drafts, format }) =>
    handleExportListingDrafts(drafts, format)
  );
}

// ============================================================================
// App Lifecycle
// ============================================================================

if (mainStartupAdmission) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      console.log('[App] ready');
      await initApp();
      registerIpcHandlers();
      console.log('[App] ipc-ready');
      createWindow();
      startStoreBusinessDateAuthorityMonitor();
      console.log('[App] window-created');

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    } catch (error) {
      console.error('[App] startup failed:', error);
      throw error;
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const handleBeforeQuit = createBeforeQuitCoordinator({
  cleanup: async () => {
    stopStoreBusinessDateAuthorityMonitor();
    await state.executionAuthorityService?.prepareForShutdown();
    const runtime = detachBrowserRuntimeForStore();
    const pendingControllers = invalidatePendingBrowserLogin();
    const localScheduler = state.scheduler;
    const storeCollectionScheduler = state.storeCollectionScheduler;
    const db = state.db;
    state.scheduler = null;
    state.storeCollectionScheduler = null;
    state.db = null;
    await cleanupAppResources({
      browserController: runtime || pendingControllers.length > 0
        ? {
            close: () => Promise.all([
              closeBrowserRuntime(runtime),
              closeBrowserControllers(pendingControllers),
            ]).then(() => undefined),
          }
        : null,
      scheduler: localScheduler || storeCollectionScheduler
        ? {
            stop: async () => {
              try {
                await storeCollectionScheduler?.stopAndDrain();
              } finally {
                localScheduler?.stop();
              }
            },
          }
        : null,
      db: db && packageUiReadOnlyRuntime
        ? {
            close: async () => {
              try {
                packageUiSchedulerAudit.capturePreCloseTerminalDatabaseCheckpoint();
              } finally {
                await db.close();
              }
            },
          }
        : db,
    }, (resource, error) => {
      console.error(`[App] shutdown ${resource} cleanup failed:`, error);
    });
  },
  requestQuit: () => app.quit(),
  reportError: (error) => {
    console.error('[App] shutdown cleanup failed:', error);
  },
});

app.on('before-quit', handleBeforeQuit);
