import type { BrowserController, CollectionOperationGuard, BrowserLease } from '@amazon-ai-ops/browser-worker';
import type { LocalScheduler } from '@amazon-ai-ops/scheduler';
import type { AdStrategyDiagnosisOutput, AiEvidenceItem } from '@amazon-ai-ops/ai-adapter';
import type { ActionLogRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/action-log-repo';
import type { AdMetricsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ad-metrics-repo';
import type { ProductRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/product-repo';
import type { RecommendationRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/recommendation-repo';
import type { ConfigurationBus } from './configuration-bus';
import type { OperationEventRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/operation-event-repo';
import type { ReportFileRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/report-file-repo';
import type { AiCallLogRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ai-call-log-repo';
import type { AiDiagnosisRunRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ai-diagnosis-run-repo';
import type { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import type { LingxingImportRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/lingxing-import-repo';
import type { MissionDomainRepository, AnalysisCausalMemoryItem } from '@amazon-ai-ops/local-db/src/sqlite/repositories/mission-domain-repo';
import type { AnalysisAuthorityRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/analysis-authority-repo';
import type { ExecutionAuthorityRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/execution-authority-repo';
import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { LingxingReportBatch, LingxingReportFile, LingxingReportType, ListingContent } from '@amazon-ai-ops/shared-types';
import type { StoreConnection, StoreConnectionProvider, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { BrowserLoginResult } from '../shared/login-contract';
import type { BrowserLoginProviderConnections } from './browser-login-provider-connections';
import type { StoreCoordinator } from './store-coordinator';
import type { StoreDailyStatusProjectionReader } from './store-daily-status-projection-reader';
import type { MissionDomainService } from './mission-domain-service';
import type { AnalysisAuthorityService } from './analysis-authority-service';
import type { ExecutionAuthorityService } from './execution-authority-service';
import type { StoreScopedAdListingService } from './store-scoped-ad-listing-service';
import type { StoreRuntimeConfigService } from './store-runtime-config-service';
import type { StoreCollectionAutomationService } from './store-collection-automation-service';
import type { StoreEvidenceRetentionPreviewService } from './store-evidence-retention-ipc';
import type { StoreCollectionMainRuntime } from './store-collection-main-runtime';
import type { StoreCollectionOrchestrator } from './store-collection-orchestrator';
import type { StoreCollectionSchedulerReadModel } from './store-collection-scheduler-read-model';
import type { VisibleBrowserRuntime } from './visible-browser-runtime-registry';
import type { StoreRuntimeAnalysisConfig } from './store-runtime-analysis-config';
import type { LingxingCollectionCoordinator } from './lingxing-collection-coordinator';
import type { MainArtifactDescriptor } from './main-artifact-registry';
import type { normalizeBusinessUiScope } from './main-business-scope-runtime';

export interface AppState {
  scheduler: LocalScheduler | null;
  db: import('better-sqlite3').Database | null;
  configurationBus: ConfigurationBus | null;
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
  storeDailyStatusReader: StoreDailyStatusProjectionReader | null;
  storeScopedAdListingService: StoreScopedAdListingService | null;
  storeRuntimeConfigService: StoreRuntimeConfigService | null;
  storeCollectionAutomationService: StoreCollectionAutomationService | null;
  storeEvidenceRetentionService: StoreEvidenceRetentionPreviewService | null;
  storeCollectionMainRuntime: StoreCollectionMainRuntime | null;
  storeCollectionOrchestrator: StoreCollectionOrchestrator | null;
  storeCollectionSchedulerReadModel: StoreCollectionSchedulerReadModel | null;
  ruleConfig: RuleConfig;
  isLoggedIn: boolean;
  currentStore: string;
  loginSession: BrowserLoginResult | null;


}

export type KeywordImportDuplicateStrategy = 'overwrite' | 'merge' | 'skip';

export type RendererArtifactReference = MainArtifactDescriptor;

export interface BusinessUiScope {
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  batchId?: string;
  currency?: 'USD';
  storeContext?: StoreContextEnvelope;
}

export type NormalizedBusinessUiScope = ReturnType<typeof normalizeBusinessUiScope>;

export interface BusinessBatchResult {
  batch: LingxingReportBatch;
  files: LingxingReportFile[];
  scopeMismatch?: string[];
  sourceBatchIds?: string[];
  fileDownloadDirs?: Record<string, string>;
}

export interface BusinessMetricSource {
  batchId?: string;
  batchIds?: string[];
  sourceFiles: string[];
}

export interface BusinessBatchOptionView {
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

export interface BusinessKeywordOpportunityRow {
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

export type AdsSessionResult = {
  entryMode: 'erp_ads_entry';
  adsUrl: string;
  adsTitle: string;
};

export type BrowserLoginTransitionOutcome = Readonly<
  | { ok: true; value: BrowserLoginResult }
  | { ok: false; error: unknown }
>;

export type CurrentAmazonAdsRetryConnections = Omit<BrowserLoginProviderConnections, 'amazon_ads'> & {
  amazon_ads: StoreConnection;
};

export interface LegacyOperatorBrowserAccess {
  provider: StoreConnectionProvider;
  runtime: VisibleBrowserRuntime;
  context: StoreContextEnvelope;
  controller: BrowserController;
  lease: BrowserLease;
}

export type DiscoverRecommendationTargetRequest = Readonly<{
  context: StoreContextEnvelope;
  recommendationId: number;
}>;

export interface LingxingCreateSubmissionResponseEvidence {
  method: string;
  pathname: string;
  status: number;
  message?: string;
}

export interface LingxingCollectionTarget {
  storeName?: string;
  marketplaceCode?: string;
  storeId?: string;
}

export interface LingxingCollectionRequest extends LingxingCollectionTarget {
  start: string;
  end: string;
  requestId?: string;
  storeContext?: StoreContextEnvelope;
}

export interface DownloadCenterReportSelectorContext {
  type: LingxingReportType;
  displayName: string;
  expectedFilenameKeyword: string;
  generatedReportName?: string;
  storeName?: string;
  marketplaceCode?: string;
}

export interface ListingReadPersistContext {
  storeName?: string;
  marketplaceCode?: string;
  sourceUrl?: string;
  screenshotPath?: string;
  source?: ListingContent['source'];
  versionLabel?: string;
  changeSummary?: string;
}

export interface ListingReadOptions {
  expectedAsin?: string;
  persist?: boolean;
  scope?: {
    storeName?: string;
    marketplaceCode?: string;
  };
}

export interface RecommendationGenerationRuntimeSnapshot {
  runtimeConfig: StoreRuntimeAnalysisConfig;
  aiSettings: Record<string, string>;
}

export interface TrustedAnalysisCausalMemory {
  readonly items: readonly AnalysisCausalMemoryItem[];
  readonly memoryDigest: string;
}

export interface AdStrategyGenerationSummary {
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

export interface AiEvidencePackSummary {
  total: number;
  metric: number;
  timeline: number;
  operationEvent: number;
  productContext: number;
  ruleCandidate: number;
}

export interface AiInsightSummary {
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
