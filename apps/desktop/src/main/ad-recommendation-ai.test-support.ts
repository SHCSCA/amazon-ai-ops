import { describe, expect, it } from 'vitest';
import type { ActionRecommendation, AdDailyMetrics, CreateOperationEventInput } from '@amazon-ai-ops/shared-types';
import type { AdStrategyDiagnosisOutput, AiEvidenceItem } from '@amazon-ai-ops/ai-adapter';
import type { MergedAdDecision } from '@amazon-ai-ops/rules-engine';
import {
  annotateRecommendationsWithStrategy,
  buildAdStrategyDiagnosisInput,
  bindRecommendationsToScopeAsin,
  createAiOnlyRecommendationsFromDecisions,
} from './ad-recommendation-ai-context';

export const TEST_EVIDENCE_SUFFICIENCY: AdStrategyDiagnosisOutput['evidenceSufficiency'] = {
  level: 'high',
  metricEvidenceCount: 1,
  sampleDays: 1,
  totalClicks: 30,
  totalCost: 42,
  totalOrders: 0,
  canUseForFormalActions: true,
  blockers: [],
  warnings: [],
};

export function recommendation(
  patch: Partial<ActionRecommendation> & Pick<ActionRecommendation, 'entityType' | 'entityName' | 'actionType' | 'reason' | 'confidence'>,
): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    msku: '',
    entityId: `${patch.entityType}_${patch.entityName}`,
    currentValue: '1.40',
    recommendedValue: '',
    riskLevel: 'APPROVAL',
    status: 'pending',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 42,
      orders: 0,
      sales: 0,
      acos: 0,
      cpc: 1.4,
      cvr: 0,
      campaignName: 'SP exact',
      adGroupName: 'Main',
      searchTerm: patch.entityName,
    },
    ...patch,
  };
}

export function evidenceItem(patch: Partial<AiEvidenceItem>): AiEvidenceItem {
  return {
    evidenceId: 'metric_1',
    type: 'metric',
    label: 'smart lock outdoor',
    dateRange: '2026-06-10~2026-06-10',
    batchId: 'batch_1',
    reportType: 'search_term',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    campaignName: 'SP exact',
    adGroupName: 'Main',
    entityType: 'search_term',
    entityName: 'smart lock outdoor',
    ...patch,
  };
}
