export type AppRoute =
  | 'dashboard'
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

export interface BusinessReportFile {
  id: string;
  reportType: string;
  displayName: string;
  status: string;
  filePath: string;
  folderPath: string;
  fileName: string;
  fileSizeBytes: number;
  importedRows: number;
  fileHash?: string;
  importError?: string;
  lastImportedAt?: string;
  updatedAt?: string;
}

export interface BusinessEvidencePath {
  label: string;
  path: string;
  kind: 'folder' | 'file' | 'audit';
}

export interface BusinessBatchOption {
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
    downloadDir?: string;
    manifestPath?: string;
    completedAt?: string;
  } | null;
  sourceBatchIds?: string[];
  availableBatches?: BusinessBatchOption[];
  reportOptions: BusinessReportOptionStatus[];
  realReportFiles: BusinessReportFile[];
  evidencePaths: BusinessEvidencePath[];
  fileAudit: {
    totalFileRecords: number;
    downloadedFileRecords: number;
    existingFileRecords: number;
    realReportFileCount: number;
    importedRowCount: number;
    rejectedEvidenceFileCount: number;
    missingReportLabels: string[];
    downloadDir?: string;
    manifestPath?: string;
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
}

export interface AdStrategyDiagnosisView {
  configured: boolean;
  invoked: boolean;
  model: string;
  metrics: number;
  ruleCandidateCount: number;
  summary: {
    source: 'ai' | 'rule';
    lifecycleStage: string;
    summary: string;
    mainProblems: string[];
    riskWarnings: string[];
    thresholdSuggestions: {
      targetAcos: AdStrategyThresholdSuggestionView;
      highAcosThreshold: AdStrategyThresholdSuggestionView;
      noOrderClickThreshold: AdStrategyThresholdSuggestionView;
      minSpend: AdStrategyThresholdSuggestionView;
    };
    aiCandidateCount: number;
    operationEventCount: number;
    productContextCount: number;
    fallbackReason?: string;
  };
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
    minPrice?: number;
    targetNetMargin?: number;
    targetAcos?: number;
    targetTacos?: number;
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
  evidencePath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryReadinessGate {
  name: string;
  status?: string;
  ok: boolean;
  evidencePath?: string | null;
  message?: string;
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
  gatesSummary?: {
    total: number;
    passed: number;
    failed: number;
  };
  missing?: string[];
  actionItems?: string[];
  message?: string;
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
  aiModel?: string;
  aiStrategySource?: 'ai' | 'rule';
  aiLifecycleStage?: string;
  aiStrategySummary?: string;
  aiMainProblems?: string[];
  aiThresholdSuggestions?: Record<string, { value: number; reason: string }>;
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
  batchId?: string;
  sourceFiles?: string[];
  sourceRow?: number;
  approvalDecision?: {
    decision?: 'approved' | 'rejected';
    approvedBy?: string;
    rejectedBy?: string;
    decidedAt?: string;
    note?: string;
    batchId?: string;
    sourceBatchId?: string;
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
}

export interface RecommendationView {
  id: number;
  actionType: string;
  entityType?: string;
  entityName: string;
  currentValue?: string;
  recommendedValue?: string;
  reason: string;
  acos: number;
  clicks: number;
  cost: number;
  riskLevel: string;
  status: string;
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
  asin?: string;
  title?: string;
  bullets?: string[];
  aPlus?: string;
  imageCopy?: string;
  backendTerms?: string;
  source?: string;
  pageUrl?: string;
  screenshotPath?: string;
  updatedAt?: string;
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
  aiLastTestStatus?: 'available' | 'failed' | '';
  aiLastTestAt?: string;
  aiLastTestBaseUrl?: string;
  aiLastTestModel?: string;
  aiLastTestMessage?: string;
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
