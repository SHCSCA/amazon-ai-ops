import type { RiskLevel } from './common';
import type { AdActionType } from './action';

export interface RecommendationFilter {
  storeName?: string;
  marketplaceCode?: string;
  asin?: string;
  riskLevel?: RiskLevel;
  actionType?: AdActionType;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export interface RecommendationSummary {
  total: number;
  autoCount: number;
  approvalCount: number;
  pendingCount: number;
  executedCount: number;
  rejectedCount: number;
  expiredCount: number;
  topReasons: { reason: string; count: number }[];
}

export interface RecommendationExport {
  format: 'csv' | 'xlsx';
  filters: RecommendationFilter;
  includeScreenshot: boolean;
  includeEvidence: boolean;
}
