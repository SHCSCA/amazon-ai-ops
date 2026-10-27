import { readFileSync } from 'node:fs';
import type { RecommendationView } from '../types';

export const decisionsPageSource = readFileSync(new URL('./decisions-view.tsx', import.meta.url), 'utf8');

export const decisionsCssSource = readFileSync(new URL('../styles/decisions.css', import.meta.url), 'utf8');

export function recommendation(
  status: RecommendationView['status'] = 'pending',
  patch: Partial<RecommendationView> = {},
): RecommendationView {
  return {
    id: 101,
    actionType: 'lower_bid',
    entityType: 'keyword',
    entityName: 'wireless charger',
    currentValue: '1.20',
    recommendedValue: '0.90',
    reason: 'ACOS 高于目标值，先收紧出价。',
    acos: 0.46,
    clicks: 38,
    cost: 72.5,
    riskLevel: 'low',
    status,
    revision: 7,
    confidence: 0.91,
    evidence: {
      asin: 'B0TEST101',
      batchId: 'batch-20260714',
      date: '2026-07-13',
      campaignName: 'SP - Charger',
      adGroupName: 'Exact',
      targeting: 'wireless charger',
      sourceFiles: ['D:/reports/keyword.xlsx'],
      sourceRow: 18,
      decisionAgreement: 'aligned',
      decisionReasons: ['规则与 AI 对高 ACOS 判断一致'],
      explanationSource: 'rule',
      writableTarget: {
        entityType: 'keyword',
        entityId: 'amzn-keyword-101',
        entityName: 'wireless charger',
        campaignName: 'SP - Charger',
        adGroupName: 'Exact',
        metricDate: '2026-07-13',
        sourceFile: 'D:/reports/keyword.xlsx',
        sourceRow: 18,
        identitySource: 'ads_ui',
        verifiedBy: 'Alice',
        verifiedAt: '2026-07-16T04:30:00.000Z',
        verificationNote: 'Matched the editable keyword row.',
        identityProofPath: 'D:/proof/keyword-101.png',
      },
    },
    ...patch,
  };
}

export const eligibilityContext = {
  scope: {
    storeName: 'US Store',
    marketplaceCode: 'US',
  },
  currentBatchId: 'batch-20260714',
  allowedSourceFiles: ['D:/reports/keyword.xlsx'],
  stale: false,
};
