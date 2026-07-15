import type { RiskLevel, ExecutionStatus } from './common';

export type AdActionType = 
  | 'add_negative_exact'
  | 'add_negative_phrase'
  | 'add_negative_broad'
  | 'lower_bid'
  | 'raise_bid'
  | 'pause_target'
  | 'resume_target'
  | 'adjust_campaign_budget'
  | 'create_campaign'
  | 'archive_campaign';

export interface ActionRecommendation {
  id?: number;
  taskId: string;
  storeName: string;
  marketplaceCode: string;
  asin: string;
  msku: string;
  entityType: 'search_term' | 'target' | 'campaign' | 'ad_group';
  entityId: string;
  entityName: string;             // 搜索词或target名称
  actionType: AdActionType;
  currentValue: string;            // 当前值
  recommendedValue: string;       // 建议值
  reason: string;                // 原因
  evidence: ActionEvidence;
  confidence: number;             // 0-1
  riskLevel: RiskLevel;
  status: 'pending' | 'needs_review' | 'approved' | 'rejected' | 'executed' | 'expired';
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface AiEvidenceDisplayItem {
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
}

export interface AiEvidenceSufficiency {
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

export interface ActionEvidence {
  impressions: number;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
  acos: number;
  cpc: number;
  cvr: number;
  // 额外证据
  date?: string;
  portfolioName?: string;
  campaignName?: string;
  adGroupName?: string;
  asin?: string;
  targeting?: string;
  searchTerm?: string;
  matchType?: string;
  competitorAsin?: string;
  historicalAcos?: number[];
  conversionRate7d?: number;
  explanationSource?: 'ai' | 'rule';
  aiExplanation?: string;
  aiRiskWarnings?: string[];
  aiAlternativeSuggestions?: string[];
  aiFallbackReason?: string;
  aiStrategyFallbackReason?: string;
  aiActionFallbackReason?: string;
  aiModel?: string;
  aiStrategySource?: 'ai' | 'rule';
  aiEvidenceSufficiency?: AiEvidenceSufficiency;
  aiLifecycleStage?: string;
  aiStrategySummary?: string;
  aiMainProblems?: string[];
  aiThresholdSuggestions?: Record<string, { value: number; reason: string; evidenceRefs?: string[]; requiresReview?: boolean; reviewReasons?: string[] }>;
  aiStrategyRiskWarnings?: string[];
  aiEvidenceRefs?: string[];
  aiEvidenceDetails?: AiEvidenceDisplayItem[];
  aiReasoningSteps?: string[];
  aiInsightOnly?: boolean;
  aiInsightInvalidReasons?: string[];
  aiLifecycleStageReason?: string;
  aiLifecycleStageEvidenceRefs?: string[];
  aiLifecycleStageRequiresReview?: boolean;
  aiLifecycleStageInvalidReasons?: string[];
  aiLifecycleStageEvidenceDetails?: AiEvidenceDisplayItem[];
  aiThresholdEvidenceRefs?: Record<string, string[]>;
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
  currency?: 'USD';
  approvalDecision?: {
    [key: string]: unknown;
    decision?: 'approved' | 'rejected';
    approvedBy?: string;
    rejectedBy?: string;
    decidedAt?: string;
    note?: string;
    recommendationId?: number;
    actionType?: string;
    portfolioName?: string;
    campaignName?: string;
    adGroupName?: string;
    asin?: string;
    entityType?: string;
    entityName?: string;
    currentValue?: string;
    recommendedValue?: string;
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
}

export interface ActionLog {
  id?: number;
  recommendationId?: number;
  taskId: string;
  actionType: AdActionType;
  entityType: string;
  entityId: string;
  entityName: string;
  beforeValue: string;
  afterValue: string;
  executionStatus: ExecutionStatus;
  failureReason?: string;
  screenshotBefore?: string;
  screenshotAfter?: string;
  tracePath?: string;
  pageUrl?: string;
  createdAt?: string;
}

export interface ApprovalTask {
  id: number;
  recommendationId: number;
  title: string;
  summary: string;
  riskLevel: RiskLevel;
  status: 'pending' | 'approved' | 'rejected' | 'modified';
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  modifiedValue?: string;
  createdAt: string;
}
