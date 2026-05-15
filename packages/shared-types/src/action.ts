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
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'expired';
  createdAt?: string;
  updatedAt?: string;
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
  searchTerm?: string;
  matchType?: string;
  competitorAsin?: string;
  historicalAcos?: number[];
  conversionRate7d?: number;
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
