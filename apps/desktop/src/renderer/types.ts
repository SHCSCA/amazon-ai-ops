import type {
  RecommendationReviewResolution,
  WritableAdTargetEvidence,
  WritableAdTargetBinding,
} from '@amazon-ai-ops/shared-types';

export type AppRoute =
  | 'dashboard'
  | 'product-management'
  | 'operation-scope'
  | 'data-collection'
  | 'data-import-validation'
  | 'operation-events'
  | 'product-config'
  | 'ad-quant'
  | 'recommendations'
  | 'approval'
  | 'readback'
  | 'keyword-opportunities'
  | 'listing-optimization'
  | 'scheduler'
  | 'settings'
  | 'delivery';

export interface OperationScope {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  batchId?: string;
  currency: 'USD';
}

export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  primaryTask?: string;
  nextAction?: string;
  primaryAction?: {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    busy?: boolean;
    busyLabel?: string;
    className?: string;
  };
}

export interface NavItem {
  id: AppRoute;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface BusinessReportOptionStatus {
  type: string;
  label: string;
  status: string;
  realFileAvailable: boolean;
  importedRows: number;
}

/** Opaque, store-bound handle issued by Main for a local file or directory. */
export type RendererArtifactId = `artifact:v1:${string}`;

export interface BusinessReportFile {
  id: string;
  /** Authoritative collection/import batch identity used for lineage checks. */
  batchId?: string;
  reportType: string;
  displayName: string;
  status: string;
  artifactId?: RendererArtifactId;
  sourceArtifactId?: RendererArtifactId;
  artifactDisplayName?: string;
  folderArtifactId?: RendererArtifactId;
  folderDisplayName?: string;
  fileName: string;
  fileExtension: string;
  fileSizeBytes: number;
  importedRows: number;
  fileHash?: string;
  importError?: string;
  lastImportedAt?: string;
  updatedAt?: string;
}

export interface BusinessEvidenceArtifact {
  label: string;
  artifactId: RendererArtifactId;
  displayName: string;
  kind: 'folder' | 'file' | 'audit';
}

export interface BusinessBatchOption {
  id: string;
  status: string;
  dateStart: string;
  dateEnd: string;
  storeName?: string;
  marketplaceCode?: string;
  downloadArtifactId?: RendererArtifactId;
  downloadDisplayName?: string;
  manifestArtifactId?: RendererArtifactId;
  manifestDisplayName?: string;
  createdAt?: string;
  completedAt?: string;
  totalFileRecords: number;
  realReportFileCount: number;
  importedReportTypeCount?: number;
  importedRowCount: number;
  missingReportLabels: string[];
}

export interface BusinessCollectionState {
  status: 'ready' | 'partial' | 'blocked';
  latestBatch?: {
    id: string;
    status: string;
    dateStart: string;
    dateEnd: string;
    storeName?: string;
    marketplaceCode?: string;
    downloadArtifactId?: RendererArtifactId;
    downloadDisplayName?: string;
    manifestArtifactId?: RendererArtifactId;
    manifestDisplayName?: string;
    completedAt?: string;
  } | null;
  sourceBatchIds?: string[];
  availableBatches?: BusinessBatchOption[];
  reportOptions: BusinessReportOptionStatus[];
  realReportFiles: BusinessReportFile[];
  evidenceArtifacts: BusinessEvidenceArtifact[];
  fileAudit: {
    totalFileRecords: number;
    downloadedFileRecords: number;
    existingFileRecords: number;
    realReportFileCount: number;
    importedRowCount: number;
    rejectedEvidenceFileCount: number;
    missingReportLabels: string[];
    downloadArtifactId?: RendererArtifactId;
    downloadDisplayName?: string;
    manifestArtifactId?: RendererArtifactId;
    manifestDisplayName?: string;
  };
  blockers: string[];
  audit: {
    databaseReady: boolean;
    acceptedExtensions: string[];
    rejectedEvidenceExtensions: string[];
    notes: string[];
  };
}

export interface BusinessQuantDiagnostic {
  portfolioName?: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  objectKey?: string;
  objectType?: string;
  objectName?: string;
  spend: number;
  sales: number;
  orders: number;
  clicks: number;
  acos: number;
  cvr: number;
  cpc: number;
  quantStatus?: 'healthy' | 'watch' | 'waste' | 'scale' | 'blocked';
  lifecycleStage?: string;
  severity?: 'low' | 'medium' | 'high';
  recommendedAction?: string;
  recommendedValue?: string;
  thresholds?: Record<string, number>;
  diagnosis: string;
  suggestedDirection: string;
}

export interface BusinessQuantTimeline {
  objectKey: string;
  objectType: 'search_term' | 'target' | 'ad_group' | 'campaign';
  objectName: string;
  asin?: string;
  campaignName?: string;
  adGroupName?: string;
  dateFrom: string;
  dateTo: string;
  daysActive: number;
  lifecycleStage: string;
  quantStatus: 'healthy' | 'watch' | 'waste' | 'scale' | 'blocked';
  recommendedAction?: string;
  recommendedValue?: string;
  trend: {
    spend: 'up' | 'down' | 'flat' | 'insufficient';
    sales: 'up' | 'down' | 'flat' | 'insufficient';
  };
  totals: {
    impressions: number;
    clicks: number;
    cost: number;
    orders: number;
    sales: number;
    acos: number;
    cpc: number;
    cvr: number;
    currency: 'USD';
  };
  thresholds: Record<string, number>;
  reasons: string[];
  reviewRequired: boolean;
}

export interface BusinessQuantSummary {
  hasImportedMetrics: boolean;
  importedRows: number;
  canonicalRows?: number;
  actionableRows?: number;
  breakdownRows?: number;
  summarySource?: string;
  summaryWarning?: string;
  totalSpend: number;
  totalSales: number;
  totalOrders: number;
  totalClicks: number;
  totalImpressions: number;
  acos: number;
  cvr: number;
  cpc: number;
  wastedSpend: number | null;
  highRiskCount: number;
  adObjectTimelines: BusinessQuantTimeline[];
  diagnostics: BusinessQuantDiagnostic[];
  blockers: string[];
}

export interface AdStrategyThresholdSuggestionView {
  value: number;
  reason: string;
  evidenceRefs?: string[];
  requiresReview?: boolean;
  reviewReasons?: string[];
}

export interface AiInsightView {
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

export interface AiEvidencePackSummaryView {
  total: number;
  metric: number;
  timeline: number;
  operationEvent: number;
  productContext: number;
  ruleCandidate: number;
}

export interface AiEvidenceDisplayItemView {
  evidenceId: string;
  type: 'metric' | 'timeline' | 'operation_event' | 'product_context' | 'rule_candidate';
  label: string;
  dateRange?: string;
  batchId?: string;
  reportType?: string;
  sourceFile?: string;
  sourceRow?: number;
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  portfolioName?: string;
  campaignName?: string;
  adGroupName?: string;
  entityType?: string;
  entityName?: string;
  metrics?: {
    impressions?: number;
    clicks?: number;
    cost?: number;
    orders?: number;
    sales?: number;
    acos?: number;
    cpc?: number;
    cvr?: number;
    currency: 'USD';
  };
  event?: {
    eventDate?: string;
    eventType?: string;
    title?: string;
    impactExpectation?: string;
  };
  product?: {
    productStage?: string;
    targetAcos?: number;
    targetTacos?: number;
    targetNetMargin?: number;
    minPrice?: number;
  };
  timeline?: {
    activeDays?: number;
    firstMetricDate?: string;
    lastMetricDate?: string;
    inferredStage?: string;
    stageReasons?: string[];
    recentDaily?: Array<{
      date: string;
      clicks?: number;
      cost?: number;
      orders?: number;
      sales?: number;
      acos?: number;
      cvr?: number;
      currency: 'USD';
    }>;
  };
}

export interface AiEvidenceSufficiencyView {
  level: 'none' | 'low' | 'medium' | 'high';
  metricEvidenceCount: number;
  sampleDays: number;
  totalClicks: number;
  totalCost: number;
  totalOrders: number;
  canUseForFormalActions: boolean;
  blockers: string[];
  warnings: string[];
}

export interface AdStrategyDiagnosisView {
  configured: boolean;
  invoked: boolean;
  model: string;
  metrics: number;
  ruleCandidateCount: number;
  summary: {
    source: 'ai' | 'rule';
    evidenceSufficiency?: AiEvidenceSufficiencyView;
    lifecycleStage: string;
    summary: string;
    lifecycleStageReason: string;
    lifecycleStageEvidenceRefs: string[];
    lifecycleStageRequiresReview?: boolean;
    lifecycleStageInvalidReasons?: string[];
    mainProblems: string[];
    riskWarnings: string[];
    thresholdSuggestions: {
      targetAcos: AdStrategyThresholdSuggestionView;
      highAcosThreshold: AdStrategyThresholdSuggestionView;
      noOrderClickThreshold: AdStrategyThresholdSuggestionView;
      minSpend: AdStrategyThresholdSuggestionView;
    };
    aiCandidateCount: number;
    insightOnlyCandidateCount?: number;
    aiInsights?: AiInsightView[];
    evidencePackSummary?: AiEvidencePackSummaryView;
    evidencePackPreview?: AiEvidenceDisplayItemView[];
    operationEventCount: number;
    productContextCount: number;
    fallbackReason?: string;
  };
}

export interface AiDiagnosisRunView {
  id: number;
  promptKey: string;
  promptVersion: string;
  model: string;
  scope: Partial<OperationScope>;
  evidencePackSummary?: AiEvidencePackSummaryView | null;
  evidencePackPreview?: AiEvidenceDisplayItemView[];
  diagnosis?: {
    source?: 'ai' | 'rule';
    evidenceSufficiency?: AiEvidenceSufficiencyView;
    lifecycleStage?: string;
    lifecycleStageReason?: string;
    lifecycleStageEvidenceRefs?: string[];
    lifecycleStageRequiresReview?: boolean;
    lifecycleStageInvalidReasons?: string[];
    summary?: string;
    aiFallbackReason?: string;
  } | null;
  insights: AiInsightView[];
  formalRecommendationCount: number;
  success?: boolean;
  errorMessage?: string;
  createdAt: string;
}

export interface ProductStrategyContextView {
  asin: string;
  parentAsin?: string;
  msku?: string;
  sku?: string;
  title?: string;
  productStage?: string;
  status?: string;
  cost?: {
    purchaseCost?: number;
    firstLegCost?: number;
    fbaFee?: number;
    referralFeeRate?: number;
    storageFee?: number;
    otherCost?: number;
    currentPrice?: number;
    minPrice?: number;
    targetNetMargin?: number;
    targetAcos?: number;
    targetTacos?: number;
  };
}

export interface ProductHistoryDailyView {
  date: string;
  impressions: number;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
  acos: number;
  cpc: number;
  cvr: number;
  currency: 'USD';
}

export interface ProductHistoryLedgerView {
  asin: string;
  storeName: string;
  marketplaceCode: string;
  dateFrom: string;
  dateTo: string;
  activeDays: number;
  firstMetricDate?: string;
  lastMetricDate?: string;
  inferredStage: string;
  stageReasons: string[];
  daily: ProductHistoryDailyView[];
  totals: {
    impressions: number;
    clicks: number;
    cost: number;
    orders: number;
    sales: number;
    acos: number;
    cpc: number;
    cvr: number;
    currency: 'USD';
  };
  events: OperationEventView[];
  product?: {
    productStage?: string;
    targetAcos?: number;
    targetTacos?: number;
    targetNetMargin?: number;
    minPrice?: number;
  };
}

export interface BusinessDataPipeline {
  scope: OperationScope;
  generatedAt: string;
  collection: BusinessCollectionState;
  quant: BusinessQuantSummary;
  operations?: {
    events: OperationEventView[];
    eventCount: number;
    notes: string[];
  };
  productContext?: {
    products: ProductStrategyContextView[];
    productCount: number;
    notes: string[];
  };
  productHistory?: {
    ledgers: ProductHistoryLedgerView[];
    ledgerCount: number;
    notes: string[];
  };
}

export interface OperationEventView {
  id: number;
  eventDate: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  campaignName?: string;
  adGroupName?: string;
  eventType: string;
  title: string;
  impactExpectation?: string;
  notes?: string;
  /** Legacy-only draft field. Production business-pipeline projections omit this Main path. */
  evidencePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryReadinessGate {
  id?: string;
  name: string;
  status?: string;
  ok: boolean;
  evidencePath?: string | null;
  message?: string;
}

export interface DeliveryReadinessFailure {
  gateId: string;
  code: string;
  message: string;
  evidencePath: string | null;
}

export interface DeliveryReadinessView {
  available: boolean;
  path: string | null;
  exists?: boolean;
  status: string;
  appReady: boolean;
  manifestDriven: boolean;
  generatedAt?: string;
  checkedAt?: string;
  gates: DeliveryReadinessGate[];
  failures?: DeliveryReadinessFailure[];
  gatesSummary?: {
    total: number;
    passed: number;
    failed: number;
  };
  missing?: string[];
  actionItems?: string[];
  recommendationReviewReasons?: string[];
  reviewBlockers?: string[];
  deliveryReviewReasons?: string[];
  finalReadinessBlockers?: string[];
  message?: string;
  previewOnly?: boolean;
  previewReady?: boolean;
  previewScenarioId?: string;
}

export interface DeliveryEvidenceStatusView {
  listing: {
    readReady: boolean;
    draftReady: boolean;
    contentCount: number;
    fullContentCount: number;
    draftCount: number;
    aiDraftCount: number;
    ruleFallbackDraftCount: number;
    latestAsin?: string;
    latestUpdatedAt?: string;
  };
  readback: {
    verifiedCount: number;
    latestStatus?: string;
    latestJsonPath?: string;
    latestUpdatedAt?: string;
  };
  package?: {
    installerAvailable: boolean;
    installerPath?: string;
    portablePath?: string;
    sha256?: string;
    latestBuiltAt?: string;
  };
  preview?: {
    previewOnly: true;
    scenarioId: string;
    workflowComplete: boolean;
    message: string;
  };
}

export interface StoragePathsView {
  settingsPath?: string;
  evidenceDir?: string;
  downloadsDir?: string;
  exportsDir?: string;
  deliveryDir?: string;
  localDbPath?: string;
}

export interface RecommendationEvidence {
  impressions?: number;
  date?: string;
  portfolioName?: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  targeting?: string;
  searchTerm?: string;
  matchType?: string;
  explanationSource?: 'ai' | 'rule';
  aiExplanation?: string;
  aiRiskWarnings?: string[];
  aiAlternativeSuggestions?: string[];
  aiFallbackReason?: string;
  aiStrategyFallbackReason?: string;
  aiActionFallbackReason?: string;
  aiModel?: string;
  aiStrategySource?: 'ai' | 'rule';
  aiEvidenceSufficiency?: AiEvidenceSufficiencyView;
  aiLifecycleStage?: string;
  aiLifecycleStageReason?: string;
  aiLifecycleStageEvidenceRefs?: string[];
  aiLifecycleStageRequiresReview?: boolean;
  aiLifecycleStageInvalidReasons?: string[];
  aiLifecycleStageEvidenceDetails?: AiEvidenceDisplayItemView[];
  aiStrategySummary?: string;
  aiMainProblems?: string[];
  aiThresholdSuggestions?: Record<string, { value: number; reason: string; evidenceRefs?: string[]; requiresReview?: boolean; reviewReasons?: string[] }>;
  aiThresholdEvidenceRefs?: Record<string, string[]>;
  aiEvidenceRefs?: string[];
  aiEvidenceDetails?: AiEvidenceDisplayItemView[];
  aiReasoningSteps?: string[];
  aiInsightOnly?: boolean;
  aiInsightInvalidReasons?: string[];
  aiStrategyRiskWarnings?: string[];
  decisionAgreement?: 'aligned' | 'rule_only' | 'ai_only' | 'conflict';
  decisionSource?: 'rule' | 'ai' | 'rule_ai';
  decisionReasons?: string[];
  decisionRiskWarnings?: string[];
  decisionRequiresReview?: boolean;
  operationEventCount?: number;
  productContextCount?: number;
  productStage?: string;
  productTargetAcos?: number;
  productTargetTacos?: number;
  productTargetNetMargin?: number;
  productMinPrice?: number;
  quantStatus?: 'healthy' | 'watch' | 'waste' | 'scale' | 'blocked';
  quantLifecycleStage?: string;
  quantSeverity?: 'low' | 'medium' | 'high';
  quantReasons?: string[];
  quantThresholds?: Record<string, number>;
  quantReviewRequired?: boolean;
  writableTarget?: WritableAdTargetEvidence;
  reviewResolution?: RecommendationReviewResolution;
  writableTargetBinding?: WritableAdTargetBinding;
  batchId?: string;
  reportType?: string;
  sourceFile?: string;
  sourceFiles?: string[];
  sourceRow?: number;
  currency?: 'USD';
  approvalDecision?: {
    decision?: 'approved' | 'rejected';
    approvedBy?: string;
    rejectedBy?: string;
    decidedAt?: string;
    note?: string;
    batchId?: string;
    sourceBatchId?: string;
    metricDate?: string;
    sourceRow?: number;
    sourceFiles?: string[];
    scope?: {
      dateFrom?: string;
      dateTo?: string;
      storeName?: string;
      marketplaceCode?: string;
      asin?: string;
    };
  };
  acos?: number;
  cost?: number;
  clicks?: number;
  orders?: number;
  sales?: number;
  cpc?: number;
  cvr?: number;
}

export interface RecommendationView {
  id: number;
  actionType: string;
  entityType?: string;
  entityId?: string;
  entityName: string;
  currentValue?: string;
  recommendedValue?: string;
  reason: string;
  acos: number;
  clicks: number;
  cost: number;
  riskLevel: string;
  status: string;
  revision: number;
  confidence: number;
  evidence?: RecommendationEvidence;
}

export interface KeywordOpportunityView {
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

export type ListingSection = 'title' | 'bullet' | 'a_plus' | 'image_copy' | 'backend_terms';

export interface ListingContentView {
  id?: number;
  asin?: string;
  title?: string;
  bullets?: string[];
  description?: string;
  aPlus?: string;
  imageCopy?: string;
  backendTerms?: string;
  source?: string;
  pageUrl?: string;
  screenshotPath?: string;
  versionLabel?: string;
  changeSummary?: string;
  createdAt?: string;
  updatedAt?: string;
  versionId?: number;
  storeName?: string;
  marketplaceCode?: string;
}

export interface ListingContentVersionView extends ListingContentView {
  versionId: number;
  listingContentId?: number;
}

export interface ListingSuggestionView {
  asin: string;
  keyword: string;
  section: ListingSection;
  currentText?: string;
  suggestedText: string;
  evidence: string;
  riskWarnings: string[];
  status: 'pending' | 'accepted' | 'ignored';
}

export interface ListingDraftView {
  id?: number;
  asin: string;
  section: ListingSection;
  currentText?: string;
  draftedText: string;
  keywords: string[];
  evidence: string;
  riskWarnings: string[];
  source: 'ai' | 'rule';
  aiFallbackReason?: string;
  status: 'pending' | 'accepted' | 'ignored';
  createdAt?: string;
}

export interface ListingHandoffPayload {
  asin?: string;
  keywords: string[];
  source: 'keyword-opportunities';
  createdAt: string;
  scope?: Pick<OperationScope, 'dateFrom' | 'dateTo' | 'storeName' | 'marketplaceCode' | 'batchId'>;
  context?: {
    portfolioName?: string;
    campaignName?: string;
    adGroupName?: string;
    entityType?: string;
    keyword?: string;
    sourceFile?: string;
    clicks?: number;
    orders?: number;
    spend?: number;
    sales?: number;
  };
}

export type AiConnectionStatus = 'unconfigured' | 'pending_test' | 'testing' | 'available' | 'failed';

export interface AiProviderSettings {
  aiApiKey: string;
  aiKeyConfigured?: boolean;
  aiBaseUrl: string;
  aiModel: string;
  aiTemperature: string;
  aiMaxTokens: string;
  aiOutputLanguage?: string;
  aiPersona?: string;
  aiLastTestStatus?: 'available' | 'failed' | '';
  aiLastTestAt?: string;
  aiLastTestBaseUrl?: string;
  aiLastTestModel?: string;
  aiLastTestMessage?: string;
}

export interface AiCallLogView {
  id: number;
  promptKey: string;
  promptVersion: string;
  model: string;
  inputHash: string;
  outputJson: string;
  success: boolean;
  errorMessage?: string;
  schemaVersion?: string;
  evidencePackSummary?: AiEvidencePackSummaryView | Record<string, unknown> | null;
  createdAt: string;
}

export interface SettingsRuleConfig {
  targetAcos: number;
  highAcosThreshold: number;
  noOrderClickThreshold: number;
  minSpend: number;
  bidAdjustPercent: number;
  maxBidDecrement: number;
  brandWordWhitelist: string[];
  coreWordWhitelist: string[];
  maxCpc?: number;
  minCpc?: number;
  enableAutoLowerBid?: boolean;
  enableAutoAddNegative?: boolean;
}
