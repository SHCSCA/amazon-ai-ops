import { contextBridge, ipcRenderer } from 'electron';
import type {
  BindRecommendationWritableTargetRequest,
  BindRecommendationWritableTargetResult,
  ArchiveStoreInput,
  ArchiveStoreRuntimeConfigInput,
  CreateStoreRuntimeConfigInput,
  CreateStoreConnectionInput,
  CreateStoreInput,
  ExportAdReadbackEvidenceRequest,
  LingxingCollectionJobSnapshot,
  LingxingCollectionProgressEvent,
  ListStoresInput,
  RestoreStoreInput,
  RestoreStoreRuntimeConfigInput,
  RemoveStoreConnectionInput,
  ResolveRecommendationReviewRequest,
  ResolveRecommendationReviewResult,
  StoreContextEnvelope,
  StoreCollectionScheduleProjection,
  StoreCollectionScheduleRunResult,
  StoreEvidenceRetentionPreviewSummary,
  StoreId,
  StoreRecord,
  StoreRuntimeConfigProjection,
  StoreConnection,
  StoreWorkspaceView,
  UpdateStoreConnectionInput,
  UpdateStoreInput,
  UpdateStoreRuntimeConfigInput,
} from '@amazon-ai-ops/shared-types';
import type { BrowserLoginRequest, BrowserLoginResult } from '../shared/login-contract';
import type {
  StoreOperationEventCreateInput,
  StoreOperationEventDeleteInput,
  StoreOperationEventListInput,
  StoreOperationEventUpdateInput,
  StoreProductArchiveInput,
  StoreProductCreateInput,
  StoreProductListInput,
  StoreProductLookupInput,
  StoreProductUpdateInput,
  VersionedStoreOperationEvent,
  VersionedStoreProduct,
} from '../main/store-scoped-objects-service';
import type {
  StoreAdObjectListInput,
  StoreKeywordFactListInput,
  StoreListingContentCreateInput,
  StoreListingContentDeleteInput,
  StoreListingContentListInput,
  StoreListingContentLookupInput,
  StoreListingContentUpdateInput,
  StoreListingContentVersion,
  StoreListingVersionListInput,
  StoreScopedAdObjectFact,
  StoreScopedKeywordFact,
  VersionedStoreListingContent,
} from '../main/store-scoped-ad-listing-service';
import { createMissionControlPreloadApi } from './mission-control-api';
import { createMissionDomainPreloadApi } from './mission-domain-api';
import { createAnalysisAuthorityPreloadApi } from './analysis-authority-api';
import { createExecutionAuthorityPreloadApi } from './execution-authority-api';

type AuthoritativeLingxingCollectionRange = {
  start: string;
  end: string;
  requestId: string;
  storeContext: StoreContextEnvelope;
  storeName?: string;
  marketplaceCode?: string;
};

type LingxingCollectionJobListInput = {
  storeContext: StoreContextEnvelope;
  limit?: number;
};

type LingxingCollectionCancelInput = {
  jobId: string;
  requestId: string;
  storeContext: StoreContextEnvelope;
};

type LingxingCollectionResumeInput = LingxingCollectionCancelInput;

type BusinessUiScope = {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  batchId?: string;
};

type AuthoritativeBusinessImportScope = BusinessUiScope & {
  storeContext: StoreContextEnvelope;
};

ipcRenderer.on('business-ui:data-updated', () => {
  window.dispatchEvent(new Event('business-ui:data-updated'));
});

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  missionControl: createMissionControlPreloadApi(ipcRenderer),
  missionDomain: createMissionDomainPreloadApi(ipcRenderer),
  analysisAuthority: createAnalysisAuthorityPreloadApi(ipcRenderer),
  executionAuthority: createExecutionAuthorityPreloadApi(ipcRenderer),

  // App
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getState: () => ipcRenderer.invoke('app:get-state'),

  // Main-authorized US store context. No local profile or artifact path crosses this bridge.
  listStores: (input?: ListStoresInput): Promise<StoreRecord[]> =>
    ipcRenderer.invoke('stores:list', input) as Promise<StoreRecord[]>,
  getStore: (storeId: StoreId): Promise<StoreRecord> =>
    ipcRenderer.invoke('stores:get', { storeId }) as Promise<StoreRecord>,
  createStore: (input: CreateStoreInput): Promise<StoreRecord> =>
    ipcRenderer.invoke('stores:create', input) as Promise<StoreRecord>,
  updateStore: (input: UpdateStoreInput): Promise<StoreRecord> =>
    ipcRenderer.invoke('stores:update', input) as Promise<StoreRecord>,
  archiveStore: (input: ArchiveStoreInput): Promise<StoreRecord> =>
    ipcRenderer.invoke('stores:archive', input) as Promise<StoreRecord>,
  restoreStore: (input: RestoreStoreInput): Promise<StoreRecord> =>
    ipcRenderer.invoke('stores:restore', input) as Promise<StoreRecord>,
  createStoreConnection: (input: CreateStoreConnectionInput): Promise<StoreConnection> =>
    ipcRenderer.invoke('stores:connections:create', input) as Promise<StoreConnection>,
  updateStoreConnection: (input: UpdateStoreConnectionInput): Promise<StoreConnection> =>
    ipcRenderer.invoke('stores:connections:update', input) as Promise<StoreConnection>,
  removeStoreConnection: (input: RemoveStoreConnectionInput): Promise<{ success: true }> =>
    ipcRenderer.invoke('stores:connections:remove', input) as Promise<{ success: true }>,
  switchStore: (storeId: StoreId): Promise<StoreWorkspaceView> =>
    ipcRenderer.invoke('stores:switch', { storeId }) as Promise<StoreWorkspaceView>,
  reconnectStore: (storeId: StoreId): Promise<StoreWorkspaceView> =>
    ipcRenderer.invoke('stores:reconnect', { storeId }) as Promise<StoreWorkspaceView>,
  getActiveStoreContext: (): Promise<StoreContextEnvelope | null> =>
    ipcRenderer.invoke('stores:get-active-context') as Promise<StoreContextEnvelope | null>,

  // Main-authorized product and operation-event objects. Every request carries
  // the complete captured StoreContext and every write uses expectedRevision.
  listStoreProducts: (
    storeContext: StoreContextEnvelope,
    input: StoreProductListInput = {},
  ): Promise<VersionedStoreProduct[]> =>
    ipcRenderer.invoke('store-objects:products:list', { storeContext, input }) as Promise<VersionedStoreProduct[]>,
  getStoreProduct: (
    storeContext: StoreContextEnvelope,
    input: StoreProductLookupInput,
  ): Promise<VersionedStoreProduct> =>
    ipcRenderer.invoke('store-objects:products:get', { storeContext, input }) as Promise<VersionedStoreProduct>,
  createStoreProduct: (
    storeContext: StoreContextEnvelope,
    input: StoreProductCreateInput,
  ): Promise<VersionedStoreProduct> =>
    ipcRenderer.invoke('store-objects:products:create', { storeContext, input }) as Promise<VersionedStoreProduct>,
  updateStoreProduct: (
    storeContext: StoreContextEnvelope,
    input: StoreProductUpdateInput,
  ): Promise<VersionedStoreProduct> =>
    ipcRenderer.invoke('store-objects:products:update', { storeContext, input }) as Promise<VersionedStoreProduct>,
  archiveStoreProduct: (
    storeContext: StoreContextEnvelope,
    input: StoreProductArchiveInput,
  ): Promise<VersionedStoreProduct> =>
    ipcRenderer.invoke('store-objects:products:archive', { storeContext, input }) as Promise<VersionedStoreProduct>,
  listStoreOperationEvents: (
    storeContext: StoreContextEnvelope,
    input: StoreOperationEventListInput = {},
  ): Promise<VersionedStoreOperationEvent[]> =>
    ipcRenderer.invoke('store-objects:operation-events:list', { storeContext, input }) as Promise<VersionedStoreOperationEvent[]>,
  createStoreOperationEvent: (
    storeContext: StoreContextEnvelope,
    input: StoreOperationEventCreateInput,
  ): Promise<VersionedStoreOperationEvent> =>
    ipcRenderer.invoke('store-objects:operation-events:create', { storeContext, input }) as Promise<VersionedStoreOperationEvent>,
  updateStoreOperationEvent: (
    storeContext: StoreContextEnvelope,
    input: StoreOperationEventUpdateInput,
  ): Promise<VersionedStoreOperationEvent> =>
    ipcRenderer.invoke('store-objects:operation-events:update', { storeContext, input }) as Promise<VersionedStoreOperationEvent>,
  deleteStoreOperationEvent: (
    storeContext: StoreContextEnvelope,
    input: StoreOperationEventDeleteInput,
  ): Promise<VersionedStoreOperationEvent> =>
    ipcRenderer.invoke('store-objects:operation-events:delete', { storeContext, input }) as Promise<VersionedStoreOperationEvent>,

  // Main-authorized imported advertising facts and local Listing content.
  // Only sanitized store_id-owned projections cross this boundary.
  listStoreAdObjects: (
    storeContext: StoreContextEnvelope,
    input: StoreAdObjectListInput = {},
  ): Promise<StoreScopedAdObjectFact[]> =>
    ipcRenderer.invoke('store-ad-listing:ad-objects:list', { storeContext, input }) as Promise<StoreScopedAdObjectFact[]>,
  listStoreKeywordFacts: (
    storeContext: StoreContextEnvelope,
    input: StoreKeywordFactListInput = {},
  ): Promise<StoreScopedKeywordFact[]> =>
    ipcRenderer.invoke('store-ad-listing:keyword-facts:list', { storeContext, input }) as Promise<StoreScopedKeywordFact[]>,
  listStoreListingContent: (
    storeContext: StoreContextEnvelope,
    input: StoreListingContentListInput = {},
  ): Promise<VersionedStoreListingContent[]> =>
    ipcRenderer.invoke('store-ad-listing:listing:list', { storeContext, input }) as Promise<VersionedStoreListingContent[]>,
  getStoreListingContent: (
    storeContext: StoreContextEnvelope,
    input: StoreListingContentLookupInput,
  ): Promise<VersionedStoreListingContent> =>
    ipcRenderer.invoke('store-ad-listing:listing:get', { storeContext, input }) as Promise<VersionedStoreListingContent>,
  createStoreListingContent: (
    storeContext: StoreContextEnvelope,
    input: StoreListingContentCreateInput,
  ): Promise<VersionedStoreListingContent> =>
    ipcRenderer.invoke('store-ad-listing:listing:create', { storeContext, input }) as Promise<VersionedStoreListingContent>,
  updateStoreListingContent: (
    storeContext: StoreContextEnvelope,
    input: StoreListingContentUpdateInput,
  ): Promise<VersionedStoreListingContent> =>
    ipcRenderer.invoke('store-ad-listing:listing:update', { storeContext, input }) as Promise<VersionedStoreListingContent>,
  deleteStoreListingContent: (
    storeContext: StoreContextEnvelope,
    input: StoreListingContentDeleteInput,
  ): Promise<{ id: number; deleted: true }> =>
    ipcRenderer.invoke('store-ad-listing:listing:delete', { storeContext, input }) as Promise<{ id: number; deleted: true }>,
  listStoreListingContentVersions: (
    storeContext: StoreContextEnvelope,
    input: StoreListingVersionListInput = {},
  ): Promise<StoreListingContentVersion[]> =>
    ipcRenderer.invoke('store-ad-listing:listing-versions:list', { storeContext, input }) as Promise<StoreListingContentVersion[]>,

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  testAiSettings: (settings: any) => ipcRenderer.invoke('settings:test-ai', settings),
  listAiCallLogs: (params?: { limit?: number }) => ipcRenderer.invoke('settings:ai-call-logs', params),
  getRuleConfig: () => ipcRenderer.invoke('settings:get-rule-config'),
  saveRuleConfig: (config: any) => ipcRenderer.invoke('settings:save-rule-config', config),
  getOperationScope: (storeContext: StoreContextEnvelope) =>
    ipcRenderer.invoke('settings:get-operation-scope', storeContext),
  saveOperationScope: (storeContext: StoreContextEnvelope, scope: any) =>
    ipcRenderer.invoke('settings:save-operation-scope', { storeContext, scope }),
  getStoreRuntimeConfig: (storeContext: StoreContextEnvelope): Promise<StoreRuntimeConfigProjection> =>
    ipcRenderer.invoke('store-runtime-config:get', { storeContext }) as Promise<StoreRuntimeConfigProjection>,
  createStoreRuntimeConfig: (
    storeContext: StoreContextEnvelope,
    input: CreateStoreRuntimeConfigInput,
  ): Promise<StoreRuntimeConfigProjection> =>
    ipcRenderer.invoke('store-runtime-config:create', { storeContext, input }) as Promise<StoreRuntimeConfigProjection>,
  updateStoreRuntimeConfig: (
    storeContext: StoreContextEnvelope,
    input: UpdateStoreRuntimeConfigInput,
  ): Promise<StoreRuntimeConfigProjection> =>
    ipcRenderer.invoke('store-runtime-config:update', { storeContext, input }) as Promise<StoreRuntimeConfigProjection>,
  archiveStoreRuntimeConfig: (
    storeContext: StoreContextEnvelope,
    input: ArchiveStoreRuntimeConfigInput,
  ): Promise<StoreRuntimeConfigProjection> =>
    ipcRenderer.invoke('store-runtime-config:archive', { storeContext, input }) as Promise<StoreRuntimeConfigProjection>,
  restoreStoreRuntimeConfig: (
    storeContext: StoreContextEnvelope,
    input: RestoreStoreRuntimeConfigInput,
  ): Promise<StoreRuntimeConfigProjection> =>
    ipcRenderer.invoke('store-runtime-config:restore', { storeContext, input }) as Promise<StoreRuntimeConfigProjection>,
  previewStoreEvidenceRetention: (
    storeContext: StoreContextEnvelope,
  ): Promise<StoreEvidenceRetentionPreviewSummary> =>
    ipcRenderer.invoke('store-evidence-retention:preview', { storeContext }) as Promise<StoreEvidenceRetentionPreviewSummary>,
  getStoreCollectionSchedule: (
    storeContext: StoreContextEnvelope,
  ): Promise<StoreCollectionScheduleProjection> =>
    ipcRenderer.invoke('store-collection-scheduler:get', { storeContext }) as Promise<StoreCollectionScheduleProjection>,
  runStoreCollectionScheduleNow: (
    storeContext: StoreContextEnvelope,
  ): Promise<StoreCollectionScheduleRunResult> =>
    ipcRenderer.invoke('store-collection-scheduler:run-now', { storeContext }) as Promise<StoreCollectionScheduleRunResult>,

  // Browser
  getSavedLoginCredentialStatus: () => ipcRenderer.invoke('browser:get-saved-credential-status'),
  browserLogin: (request: BrowserLoginRequest): Promise<BrowserLoginResult> =>
    ipcRenderer.invoke('browser:login', request) as Promise<BrowserLoginResult>,
  browserLogout: () => ipcRenderer.invoke('browser:logout'),
  browserScreenshot: (label: 'before' | 'after' | 'error') =>
    ipcRenderer.invoke('browser:screenshot', label),
  isBrowserReady: () => ipcRenderer.invoke('browser:is-ready'),

  // Reports
  collectLingxingReports: (dateRange: AuthoritativeLingxingCollectionRange) =>
    ipcRenderer.invoke('v1_5:reports:collect-lingxing', dateRange),
  getBusinessUiDataPipeline: (scope: BusinessUiScope) =>
    ipcRenderer.invoke('v1_5:business-ui:data-pipeline', scope),
  getBusinessBatchOptions: (scope: BusinessUiScope) =>
    ipcRenderer.invoke('v1_5:business-ui:batch-options', scope),
  importCurrentBusinessReports: (scope: AuthoritativeBusinessImportScope) =>
    ipcRenderer.invoke('v1_5:business-ui:import-current-reports', scope),
  importLocalBusinessReportFiles: (scope: AuthoritativeBusinessImportScope) =>
    ipcRenderer.invoke('v1_5:business-ui:import-local-report-files', scope),
  getDeliveryReadiness: () => ipcRenderer.invoke('v1_5:delivery:readiness'),
  refreshFinalReadiness: (input?: { adReadbackPath?: string }) =>
    ipcRenderer.invoke('v1_5:delivery:refresh-final-readiness', input),
  getDeliveryEvidenceStatus: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:delivery:evidence-status', scope),
  exportDeliveryBundle: (scope?: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:delivery:export-bundle', scope),
  exportDataReconciliation: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:delivery:export-data-reconciliation', scope),
  exportDataReconciliationArtifacts: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:business-ui:export-data-reconciliation-artifacts', scope),
  getStoragePaths: () => ipcRenderer.invoke('v1_5:settings:storage-paths'),
  preflightLingxingCollection: (dateRange: AuthoritativeLingxingCollectionRange) =>
    ipcRenderer.invoke('v1_5:reports:preflight-lingxing-collection', dateRange),
  exportLingxingCollectionPreflight: (dateRange: AuthoritativeLingxingCollectionRange) =>
    ipcRenderer.invoke('v1_5:reports:export-lingxing-collection-preflight', dateRange),
  retryLingxingReport: (dateRange: AuthoritativeLingxingCollectionRange, reportType: string) =>
    ipcRenderer.invoke('v1_5:reports:retry-lingxing-report', { dateRange, reportType }),
  downloadExistingLingxingReports: (dateRange: AuthoritativeLingxingCollectionRange, reportTypes: string[]) =>
    ipcRenderer.invoke('v1_5:reports:download-existing-lingxing-reports', { dateRange, reportTypes }),
  runLingxingCanaryReport: (dateRange: AuthoritativeLingxingCollectionRange, reportType: string) =>
    ipcRenderer.invoke('v1_5:reports:run-lingxing-canary-report', { dateRange, reportType }),
  exportLingxingAcceptanceAudit: (batchId: string, diagnosticId?: number) =>
    ipcRenderer.invoke('v1_5:reports:export-acceptance-audit', { batchId, diagnosticId }),
  diagnoseLingxingDownloadCenter: (dateRange: AuthoritativeLingxingCollectionRange) =>
    ipcRenderer.invoke('v1_5:reports:diagnose-download-center', dateRange),
  exportDownloadCenterDiagnosticBundle: (diagnosticId: number) =>
    ipcRenderer.invoke('v1_5:reports:export-download-center-diagnostic-bundle', { diagnosticId }),
  exportDownloadCenterPageModelDraft: (diagnosticId: number) =>
    ipcRenderer.invoke('v1_5:reports:export-download-center-page-model-draft', { diagnosticId }),
  exportDownloadCenterPageModelEnablementAudit: (dateRange: AuthoritativeLingxingCollectionRange, diagnosticId?: number) =>
    ipcRenderer.invoke('v1_5:reports:export-download-center-page-model-enablement-audit', { dateRange, diagnosticId }),
  listLingxingCollectionJobs: (input: LingxingCollectionJobListInput): Promise<LingxingCollectionJobSnapshot[]> =>
    ipcRenderer.invoke('v1_5:reports:list-lingxing-collection-jobs', input) as Promise<LingxingCollectionJobSnapshot[]>,
  resumeLingxingCollection: (input: LingxingCollectionResumeInput) =>
    ipcRenderer.invoke('v1_5:reports:resume-lingxing-collection', input),
  cancelLingxingCollection: (input: LingxingCollectionCancelInput) =>
    ipcRenderer.invoke('v1_5:reports:cancel-lingxing-collection', input),
  getDownloadCenterPageModel: () => ipcRenderer.invoke('v1_5:reports:get-download-center-page-model'),
  saveDownloadCenterPageModel: (model: any) => ipcRenderer.invoke('v1_5:reports:save-download-center-page-model', model),
  resetDownloadCenterPageModel: () => ipcRenderer.invoke('v1_5:reports:reset-download-center-page-model'),
  openReportArtifact: (artifactId: string, storeContext: StoreContextEnvelope) =>
    ipcRenderer.invoke('v1_5:reports:open-artifact', { artifactId, storeContext }),

  // Recommendations
  getRecommendations: (params: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
    batchId?: string;
    status?: string;
    limit?: number;
  }) =>
    ipcRenderer.invoke('recommendations:get', params),
  generateRecommendations: (params?: {
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
    batchId?: string;
    limit?: number;
  }) => ipcRenderer.invoke('recommendations:generate', params),
  runAdStrategyDiagnosis: (params?: {
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
    batchId?: string;
    limit?: number;
  }) => ipcRenderer.invoke('v1_5:business-ui:ad-strategy-diagnosis', params),
  listAiDiagnosisRuns: (params?: {
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
    batchId?: string;
    limit?: number;
  }) => ipcRenderer.invoke('v1_5:business-ui:ai-diagnosis-runs', params),
  approveRecommendation: (input: number | { id: number; expectedRevision: number; decision?: any }) => ipcRenderer.invoke('recommendations:approve', input),
  rejectRecommendation: (input: number | { id: number; expectedRevision: number; decision?: any }) => ipcRenderer.invoke('recommendations:reject', input),
  resolveRecommendationReview: (input: ResolveRecommendationReviewRequest): Promise<ResolveRecommendationReviewResult> =>
    ipcRenderer.invoke('recommendations:resolve-review', input),
  bindRecommendationWritableTarget: (input: BindRecommendationWritableTargetRequest): Promise<BindRecommendationWritableTargetResult> =>
    ipcRenderer.invoke('recommendations:bind-writable-target', input),
  executeRecommendation: (id: number) => ipcRenderer.invoke('recommendations:execute', id),
  exportAdReadbackEvidence: (input: ExportAdReadbackEvidenceRequest) =>
    ipcRenderer.invoke('recommendations:export-ad-readback-evidence', input),
  prepareAdReadbackSession: (input: { sourcePath: string; outDir?: string }) =>
    ipcRenderer.invoke('recommendations:prepare-ad-readback-session', input),
  verifyAdReadbackSession: (input: { sessionDir: string }) =>
    ipcRenderer.invoke('recommendations:verify-ad-readback-session', input),
  fillAdReadbackSession: (input: { sessionDir: string }) =>
    ipcRenderer.invoke('recommendations:fill-ad-readback-session', input),
  verifyAdReadbackEvidence: (input: { evidencePath: string }) =>
    ipcRenderer.invoke('recommendations:verify-ad-readback-evidence', input),
  saveReadbackCapture: (input: { slot: 'approval' | 'before' | 'after' | 'readback'; dataUrl: string; fileName?: string; sessionDir?: string }) =>
    ipcRenderer.invoke('recommendations:save-readback-capture', input),

  // Scheduler
  // Legacy unscoped scheduler bridge. Main keeps mutation channels fail-closed;
  // store collection uses the StoreContext-authorized methods above.
  getScheduledTasks: () => ipcRenderer.invoke('scheduler:get-tasks'),
  setTaskEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('scheduler:set-task-enabled', { name, enabled }),
  runTaskNow: (name: string) => ipcRenderer.invoke('scheduler:run-now', name),

  // Logs
  getLogs: (params: { dateFrom: string; dateTo: string; limit?: number }) =>
    ipcRenderer.invoke('logs:get', params),

  // Metrics
  getRecentMetrics: (days: number) => ipcRenderer.invoke('metrics:get-recent', days),
  getMetricsSummary: (date: string) => ipcRenderer.invoke('metrics:get-summary', date),

  // v1.5 Keyword / Listing
  exportKeywordDiagnostics: (diagnostics: any) =>
    ipcRenderer.invoke('v1_5:keywords:export-diagnostics', { diagnostics }),
  buildKeywordOpportunities: (metrics: any[], options?: any) =>
    ipcRenderer.invoke('v1_5:keywords:build-opportunities', { metrics, options }),
  analyzeListingCoverage: (listing: any, keywords: string[]) =>
    ipcRenderer.invoke('v1_5:listing:analyze-coverage', { listing, keywords }),
  buildListingSuggestions: (listing: any, opportunities: any[]) =>
    ipcRenderer.invoke('v1_5:listing:build-suggestions', { listing, opportunities }),
  updateListingSuggestionStatus: (id: number, status: 'pending' | 'accepted' | 'ignored') =>
    ipcRenderer.invoke('v1_5:listing:update-suggestion-status', { id, status }),
  generateListingDrafts: (suggestions: any[]) =>
    ipcRenderer.invoke('v1_5:listing:generate-drafts', { suggestions }),
  exportListingSuggestions: (suggestions: any[], format: 'csv' | 'xlsx' | 'markdown') =>
    ipcRenderer.invoke('v1_5:listing:export-suggestions', { suggestions, format }),
  exportListingDrafts: (drafts: any[], format: 'csv' | 'xlsx' | 'markdown') =>
    ipcRenderer.invoke('v1_5:listing:export-drafts', { drafts, format }),

  // Event listeners
  onStoreContextChanged: (callback: (view: StoreWorkspaceView) => void) => {
    const handler = (_: unknown, view: StoreWorkspaceView) => callback(view);
    ipcRenderer.on('store-context:changed', handler);
    return () => ipcRenderer.removeListener('store-context:changed', handler);
  },
  onStoresChanged: (callback: (store: StoreRecord) => void) => {
    const handler = (_: unknown, store: StoreRecord) => callback(store);
    ipcRenderer.on('stores:changed', handler);
    return () => ipcRenderer.removeListener('stores:changed', handler);
  },
  onLingxingCollectionProgress: (callback: (event: LingxingCollectionProgressEvent) => void) => {
    const handler = (_: unknown, event: LingxingCollectionProgressEvent) => callback(event);
    ipcRenderer.on('lingxing-collection:progress', handler);
    return () => ipcRenderer.removeListener('lingxing-collection:progress', handler);
  },
  onSchedulerTaskStart: (callback: (taskName: string) => void) => {
    const handler = (_: any, taskName: string) => callback(taskName);
    ipcRenderer.on('scheduler:task-start', handler);
    return () => ipcRenderer.removeListener('scheduler:task-start', handler);
  },
  onSchedulerTaskComplete: (callback: (data: { taskName: string; duration: number }) => void) => {
    const handler = (_: any, data: { taskName: string; duration: number }) => callback(data);
    ipcRenderer.on('scheduler:task-complete', handler);
    return () => ipcRenderer.removeListener('scheduler:task-complete', handler);
  },
  onSchedulerTaskError: (callback: (data: { taskName: string; error: string }) => void) => {
    const handler = (_: any, data: { taskName: string; error: string }) => callback(data);
    ipcRenderer.on('scheduler:task-error', handler);
    return () => ipcRenderer.removeListener('scheduler:task-error', handler);
  },
  onRecommendationsGenerated: (callback: (count: number) => void) => {
    const handler = (_: any, count: number) => callback(count);
    ipcRenderer.on('recommendations:generated', handler);
    return () => ipcRenderer.removeListener('recommendations:generated', handler);
  },
  onCleanupReport: (callback: (report: any) => void) => {
    const handler = (_: any, report: any) => callback(report);
    ipcRenderer.on('cleanup:report', handler);
    return () => ipcRenderer.removeListener('cleanup:report', handler);
  },
});
