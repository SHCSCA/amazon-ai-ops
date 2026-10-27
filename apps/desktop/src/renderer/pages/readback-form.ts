import {
  localizeAgreement,
  localizeRecommendationSource,
} from '@amazon-ai-ops/business-presenters';
import type { RecommendationView } from '../types';
import {
  type ReadbackFormState,
} from "./readback-contracts";
import {
  EMPTY_FORM,
} from "./readback-constants";

export function decisionAgreementLabel(value?: string): string {
  const label = localizeAgreement(value);
  if (label === '未知一致性') return String(value || '-') || '-';
  return label;
}

export function decisionSourceLabel(value?: string): string {
  const label = localizeRecommendationSource(value);
  if (label === '未知来源') return String(value || '-') || '-';
  return label;
}

export function objectName(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '';
}

export function formFromRecommendation(rec: RecommendationView, scope: { storeName: string; marketplaceCode: string }, batchId?: string): ReadbackFormState {
  const evidence = rec.evidence || {};
  const approvalSourceRow = evidence.approvalDecision?.sourceRow;
  const sourceRow = approvalSourceRow != null ? approvalSourceRow : evidence.sourceRow;
  return {
    ...EMPTY_FORM,
    recommendationId: String(rec.id),
    recommendationRevision: rec.revision,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    portfolioName: evidence.portfolioName || '',
    asin: evidence.asin || '',
    campaignName: evidence.campaignName || '',
    adGroupName: evidence.adGroupName || '',
    entityType: rec.entityType || evidence.matchType || '',
    entityName: objectName(rec),
    actionType: rec.actionType,
    currentValue: rec.currentValue || '',
    recommendedValue: rec.recommendedValue || '',
    sourceBatchId: evidence.approvalDecision?.sourceBatchId || evidence.approvalDecision?.batchId || evidence.batchId || batchId || '',
    sourceMetricDate: evidence.date || '',
    sourceRow: sourceRow != null ? String(sourceRow) : '',
    sourceFiles: (evidence.sourceFiles || []).join('\n'),
    sourceExplanationSource: evidence.explanationSource || '',
    sourceAiModel: evidence.aiModel || '',
    decisionAgreement: evidence.decisionAgreement || '',
    decisionSource: evidence.decisionSource || '',
    decisionReasons: evidence.decisionReasons || [],
    decisionRiskWarnings: evidence.decisionRiskWarnings || [],
    aiStrategySource: evidence.aiStrategySource || '',
    aiLifecycleStage: evidence.aiLifecycleStage || '',
    aiStrategySummary: evidence.aiStrategySummary || '',
    aiStrategyFallbackReason: evidence.aiStrategyFallbackReason || '',
    aiActionFallbackReason: evidence.aiActionFallbackReason || '',
    aiMainProblems: evidence.aiMainProblems || [],
    aiThresholdSuggestions: evidence.aiThresholdSuggestions || {},
    aiStrategyRiskWarnings: evidence.aiStrategyRiskWarnings || [],
    quantStatus: evidence.quantStatus || '',
    quantLifecycleStage: evidence.quantLifecycleStage || '',
    quantReasons: evidence.quantReasons || [],
    quantThresholds: evidence.quantThresholds || {},
    quantReviewRequired: evidence.quantReviewRequired === true,
    operationEventCount: evidence.operationEventCount || 0,
    productContextCount: evidence.productContextCount || 0,
    productStage: evidence.productStage || '',
    productTargetAcos: evidence.productTargetAcos != null ? String(evidence.productTargetAcos) : '',
    productTargetTacos: evidence.productTargetTacos != null ? String(evidence.productTargetTacos) : '',
    productTargetNetMargin: evidence.productTargetNetMargin != null ? String(evidence.productTargetNetMargin) : '',
    productMinPrice: evidence.productMinPrice != null ? String(evidence.productMinPrice) : '',
    approverName: evidence.approvalDecision?.approvedBy || '',
    approvalNote: evidence.approvalDecision?.note || '',
    approvalConfirmedAt: evidence.approvalDecision?.decidedAt || '',
  };
}

export function executableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || /[%％]/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(/^\$/, '').replace(/\s*usd$/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function valuesMatch(left: string, right: string): boolean {
  const leftNumber = executableNumber(left);
  const rightNumber = executableNumber(right);
  if (leftNumber !== null && rightNumber !== null) {
    return Math.abs(leftNumber - rightNumber) < 0.0001;
  }
  return left.trim() === right.trim();
}

export function normalizePathForCompare(value: string): string {
  return value.trim().replace(/\\/g, '/').toLowerCase();
}

export function sourceFileLines(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export function isSpreadsheetReportPath(value: string): boolean {
  return /\.(xlsx|xls|csv)$/i.test(value.trim().split(/[?#]/)[0]);
}

export function readbackPreviewFormFromRecommendation(
  rec: RecommendationView,
  scope: { storeName: string; marketplaceCode: string },
  batchId: string | undefined,
  complete: boolean,
): ReadbackFormState {
  const base = formFromRecommendation(rec, scope, batchId);
  const approvalTime = base.approvalConfirmedAt || '2026-06-24T10:00:00.000Z';
  return {
    ...base,
    approverName: base.approverName || '预览审批人',
    approvalNote: base.approvalNote || '仅开发预览的只读审批记录。',
    approvalArtifactPath: 'D:/preview/readback/approval.png',
    approvalConfirmedAt: approvalTime,
    operatorConfirmed: true,
    realWriteApproved: true,
    allowedByPolicy: true,
    executedBy: '预览操作员',
    executionId: 'preview-manual-001',
    executionExecutedAt: '2026-06-24T10:05:00.000Z',
    beforeValue: rec.currentValue || '1.20',
    beforeCapturedAt: '2026-06-24T10:03:00.000Z',
    beforeScreenshotPath: complete ? 'D:/preview/readback/before.png' : '',
    afterValue: rec.recommendedValue || '1.08',
    afterCapturedAt: '2026-06-24T10:06:00.000Z',
    afterScreenshotPath: complete ? 'D:/preview/readback/after.png' : '',
    readbackActualValue: complete ? (rec.recommendedValue || '1.08') : '',
    readbackReadAt: '2026-06-24T10:10:00.000Z',
    readbackEvidencePath: complete ? 'D:/preview/readback/readback.png' : '',
    liveBidSourceNote: '仅开发预览的 Ads UI 行级回读说明。',
    riskRationale: rec.reason || '仅开发预览的受控低风险动作。',
    executionSuccess: true,
    executionVerified: true,
    readbackVerified: complete,
  };
}
