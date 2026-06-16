import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getState: () => ipcRenderer.invoke('app:get-state'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: any) => ipcRenderer.invoke('settings:save', settings),
  testAiSettings: (settings: any) => ipcRenderer.invoke('settings:test-ai', settings),
  getRuleConfig: () => ipcRenderer.invoke('settings:get-rule-config'),
  saveRuleConfig: (config: any) => ipcRenderer.invoke('settings:save-rule-config', config),
  getOperationScope: () => ipcRenderer.invoke('settings:get-operation-scope'),
  saveOperationScope: (scope: any) => ipcRenderer.invoke('settings:save-operation-scope', scope),

  // Browser
  browserLogin: (username: string, password: string) =>
    ipcRenderer.invoke('browser:login', { username, password }),
  browserLogout: () => ipcRenderer.invoke('browser:logout'),
  browserScreenshot: (label: 'before' | 'after' | 'error') =>
    ipcRenderer.invoke('browser:screenshot', label),
  isBrowserReady: () => ipcRenderer.invoke('browser:is-ready'),

  // Reports
  downloadReport: (dateRange: { start: string; end: string }) =>
    ipcRenderer.invoke('report:download', dateRange),
  parseReport: (filePath: string) => ipcRenderer.invoke('report:parse', filePath),
  selectReportFile: () => ipcRenderer.invoke('report:select-file'),
  collectLingxingReports: (dateRange: { start: string; end: string; storeName?: string; marketplaceCode?: string }) =>
    ipcRenderer.invoke('v1_5:reports:collect-lingxing', dateRange),
  getBusinessUiDataPipeline: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:business-ui:data-pipeline', scope),
  getBusinessBatchOptions: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:business-ui:batch-options', scope),
  importCurrentBusinessReports: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:business-ui:import-current-reports', scope),
  importLocalBusinessReportFiles: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:business-ui:import-local-report-files', scope),
  getDeliveryReadiness: () => ipcRenderer.invoke('v1_5:delivery:readiness'),
  exportDeliveryBundle: (scope?: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:delivery:export-bundle', scope),
  exportDataReconciliation: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:delivery:export-data-reconciliation', scope),
  getStoragePaths: () => ipcRenderer.invoke('v1_5:settings:storage-paths'),
  getBusinessKeywordOpportunities: (scope: { dateFrom: string; dateTo: string; storeName: string; marketplaceCode: string; asin?: string; batchId?: string }) =>
    ipcRenderer.invoke('v1_5:business-ui:keyword-opportunities', scope),
  listOperationEvents: (filter: any) =>
    ipcRenderer.invoke('operation-events:list', filter),
  createOperationEvent: (input: any) =>
    ipcRenderer.invoke('operation-events:create', input),
  updateOperationEvent: (input: any) =>
    ipcRenderer.invoke('operation-events:update', input),
  deleteOperationEvent: (input: number | { id: number }) =>
    ipcRenderer.invoke('operation-events:delete', input),
  preflightLingxingCollection: (dateRange: { start: string; end: string; storeName?: string; marketplaceCode?: string }) =>
    ipcRenderer.invoke('v1_5:reports:preflight-lingxing-collection', dateRange),
  exportLingxingCollectionPreflight: (dateRange: { start: string; end: string; storeName?: string; marketplaceCode?: string }) =>
    ipcRenderer.invoke('v1_5:reports:export-lingxing-collection-preflight', dateRange),
  retryLingxingReport: (dateRange: { start: string; end: string; storeName?: string; marketplaceCode?: string }, reportType: string) =>
    ipcRenderer.invoke('v1_5:reports:retry-lingxing-report', { dateRange, reportType }),
  downloadExistingLingxingReports: (dateRange: { start: string; end: string; storeName?: string; marketplaceCode?: string }, reportTypes: string[]) =>
    ipcRenderer.invoke('v1_5:reports:download-existing-lingxing-reports', { dateRange, reportTypes }),
  runLingxingCanaryReport: (dateRange: { start: string; end: string; storeName?: string; marketplaceCode?: string }, reportType: string) =>
    ipcRenderer.invoke('v1_5:reports:run-lingxing-canary-report', { dateRange, reportType }),
  exportLingxingAcceptanceAudit: (batchId: string, diagnosticId?: number) =>
    ipcRenderer.invoke('v1_5:reports:export-acceptance-audit', { batchId, diagnosticId }),
  diagnoseLingxingDownloadCenter: (dateRange?: { start: string; end: string; storeName?: string; marketplaceCode?: string }) =>
    ipcRenderer.invoke('v1_5:reports:diagnose-download-center', dateRange),
  exportDownloadCenterDiagnosticBundle: (diagnosticId: number) =>
    ipcRenderer.invoke('v1_5:reports:export-download-center-diagnostic-bundle', { diagnosticId }),
  exportDownloadCenterPageModelDraft: (diagnosticId: number) =>
    ipcRenderer.invoke('v1_5:reports:export-download-center-page-model-draft', { diagnosticId }),
  exportDownloadCenterPageModelEnablementAudit: (dateRange: { start: string; end: string; storeName?: string; marketplaceCode?: string }, diagnosticId?: number) =>
    ipcRenderer.invoke('v1_5:reports:export-download-center-page-model-enablement-audit', { dateRange, diagnosticId }),
  getDownloadCenterPageModel: () => ipcRenderer.invoke('v1_5:reports:get-download-center-page-model'),
  saveDownloadCenterPageModel: (model: any) => ipcRenderer.invoke('v1_5:reports:save-download-center-page-model', model),
  resetDownloadCenterPageModel: () => ipcRenderer.invoke('v1_5:reports:reset-download-center-page-model'),
  openReportPath: (targetPath: string) => ipcRenderer.invoke('v1_5:reports:open-path', targetPath),

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
  approveRecommendation: (input: number | { id: number; decision?: any }) => ipcRenderer.invoke('recommendations:approve', input),
  rejectRecommendation: (input: number | { id: number; decision?: any }) => ipcRenderer.invoke('recommendations:reject', input),
  executeRecommendation: (id: number) => ipcRenderer.invoke('recommendations:execute', id),
  exportAdReadbackEvidence: (input: any) =>
    ipcRenderer.invoke('recommendations:export-ad-readback-evidence', input),

  // Scheduler
  getScheduledTasks: () => ipcRenderer.invoke('scheduler:get-tasks'),
  setTaskEnabled: (name: string, enabled: boolean) =>
    ipcRenderer.invoke('scheduler:set-task-enabled', { name, enabled }),
  runTaskNow: (name: string) => ipcRenderer.invoke('scheduler:run-now', name),

  // Products
  getProducts: () => ipcRenderer.invoke('products:get'),
  addProduct: (product: any) => ipcRenderer.invoke('products:add', product),
  saveProductConfig: (input: any) => ipcRenderer.invoke('products:save-config', input),

  // Logs
  getLogs: (params: { dateFrom: string; dateTo: string; limit?: number }) =>
    ipcRenderer.invoke('logs:get', params),

  // Metrics
  getRecentMetrics: (days: number) => ipcRenderer.invoke('metrics:get-recent', days),
  getMetricsSummary: (date: string) => ipcRenderer.invoke('metrics:get-summary', date),

  // v1.5 Keyword / Listing
  importKeywordReport: (filePath: string, source?: string, duplicateStrategy?: 'overwrite' | 'merge' | 'skip') =>
    ipcRenderer.invoke('v1_5:keywords:import-report', { filePath, source, duplicateStrategy }),
  exportKeywordDiagnostics: (diagnostics: any) =>
    ipcRenderer.invoke('v1_5:keywords:export-diagnostics', { diagnostics }),
  buildKeywordOpportunities: (metrics: any[], options?: any) =>
    ipcRenderer.invoke('v1_5:keywords:build-opportunities', { metrics, options }),
  analyzeListingCoverage: (listing: any, keywords: string[]) =>
    ipcRenderer.invoke('v1_5:listing:analyze-coverage', { listing, keywords }),
  importListingContent: (filePath: string) =>
    ipcRenderer.invoke('v1_5:listing:import-content', { filePath }),
  extractListingFromLingxing: (options?: { expectedAsin?: string; persist?: boolean }) =>
    ipcRenderer.invoke('v1_5:listing:extract-from-lingxing', options ?? {}),
  openLingxingListingAndExtract: (url: string) =>
    ipcRenderer.invoke('v1_5:listing:open-and-extract-from-lingxing', { url }),
  probeLingxingListingDetailAndExtract: (url?: string) =>
    ipcRenderer.invoke('v1_5:listing:probe-detail-and-extract', { url }),
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
