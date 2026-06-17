import type { AdStrategyDiagnosisOutput, AiEvidenceItem } from '@amazon-ai-ops/ai-adapter';
import type { AdActionType } from '@amazon-ai-ops/shared-types';
import type { RecommendationDiagnosisScope } from './ad-recommendation-ai-context';

export interface ValidatedAiDiagnosis {
  diagnosis: AdStrategyDiagnosisOutput;
  validCandidateIndexes: number[];
  insightOnlyCandidateIndexes: number[];
  invalidReasons: Array<{
    candidateIndex: number;
    reason: string;
    missingRefs: string[];
  }>;
}

const FORMAL_AD_ACTION_TYPES = new Set<AdActionType>([
  'add_negative_exact',
  'add_negative_phrase',
  'add_negative_broad',
  'lower_bid',
  'raise_bid',
  'pause_target',
  'resume_target',
  'adjust_campaign_budget',
  'create_campaign',
  'archive_campaign',
]);
const MIN_FORMAL_AI_CONFIDENCE = 0.6;

export function validateAiDiagnosisEvidence(input: {
  diagnosis: AdStrategyDiagnosisOutput;
  evidencePack: AiEvidenceItem[];
  scope: RecommendationDiagnosisScope;
}): ValidatedAiDiagnosis {
  const evidenceById = new Map(input.evidencePack.map((item) => [item.evidenceId, item]));
  const invalidReasons: ValidatedAiDiagnosis['invalidReasons'] = [];
  const validCandidateIndexes: number[] = [];
  const insightOnlyCandidateIndexes: number[] = [];
  const schemaValid = input.diagnosis.schemaVersion === 'ad_strategy_diagnosis_v1';
  const evidenceSufficiency = input.diagnosis.evidenceSufficiency;

  markLifecycleReviewIfNeeded(input.diagnosis, evidenceById, input.scope);
  markThresholdReviewIfNeeded(input.diagnosis, evidenceById, input.scope);

  input.diagnosis.aiCandidates.forEach((candidate, index) => {
    const missingRefs = candidate.evidenceRefs.filter((ref) => !evidenceById.has(ref));
    const referencedEvidence = candidate.evidenceRefs
      .map((ref) => evidenceById.get(ref))
      .filter((item): item is AiEvidenceItem => Boolean(item));
    const outOfScopeRefs = referencedEvidence
      .filter((evidence) => !evidenceBelongsToScope(evidence, input.scope))
      .map((evidence) => evidence.evidenceId);
    const canBindEntity = referencedEvidence.some((evidence) => evidenceCanBindCandidate(evidence, candidate));
    const hasTraceableMetricBindingEvidence = referencedEvidence.some((evidence) => (
      evidence.type === 'metric'
      && evidenceCanBindCandidate(evidence, candidate)
      && evidenceHasReportTrace(evidence)
    ));
    const hasMetricBindingEvidenceWithoutProductAsin = referencedEvidence.some((evidence) => (
      evidence.type === 'metric'
      && evidenceCanBindCandidate(evidence, candidate)
      && !String(evidence.asin || input.scope.asin || '').trim()
    ));
    const hasMetricBindingEvidenceWithNonReportSource = referencedEvidence.some((evidence) => (
      evidence.type === 'metric'
      && evidenceCanBindCandidate(evidence, candidate)
      && evidenceHasSourceFileAndRow(evidence)
      && !evidenceHasRealReportSource(evidence)
    ));
    const hasMetricBindingEvidence = referencedEvidence.some((evidence) => (
      evidence.type === 'metric'
      && evidenceCanBindCandidate(evidence, candidate)
    ));
    const reasons: string[] = [];

    if (!schemaValid) {
      reasons.push('AI 输出 schemaVersion 错误，不能进入正式建议池。');
    }
    if (candidate.evidenceRefs.length === 0) {
      reasons.push('AI 候选动作缺少 evidenceRefs。');
    }
    if (!candidate.reason.trim()) {
      reasons.push('AI 候选动作缺少可展示的判断理由。');
    }
    if (!candidate.reasoningSteps.some((step) => step.trim().length > 0)) {
      reasons.push('AI 候选动作缺少 reasoningSteps，不能进入正式建议池。');
    }
    if (!FORMAL_AD_ACTION_TYPES.has(candidate.actionType as AdActionType)) {
      reasons.push(`AI 候选动作类型不属于系统可审批广告动作：${candidate.actionType}。`);
    }
    if (candidate.confidence < MIN_FORMAL_AI_CONFIDENCE) {
      reasons.push(`AI 候选动作置信度低于正式建议门槛 ${MIN_FORMAL_AI_CONFIDENCE.toFixed(2)}。`);
    }
    if (missingRefs.length > 0) {
      reasons.push('AI 引用了不可用证据。');
    }
    if (outOfScopeRefs.length > 0) {
      reasons.push('证据不属于当前运营范围。');
    }
    if (!canBindEntity) {
      reasons.push('AI 候选动作无法绑定当前范围内的真实广告对象。');
    }
    if (canBindEntity && hasMetricBindingEvidenceWithNonReportSource) {
      reasons.push('AI 候选动作绑定的指标 source_file 不是真实广告报表 xlsx/xls/csv，不能进入正式建议池。');
    } else if (canBindEntity && hasMetricBindingEvidence && !hasTraceableMetricBindingEvidence) {
      reasons.push('AI 候选动作绑定的指标证据缺少原始报表 source_file/source_row，不能进入正式建议池。');
    }
    if (canBindEntity && !hasMetricBindingEvidence) {
      reasons.push('AI 候选动作缺少可追溯的真实报表指标证据，不能进入正式建议池。');
    }
    if (canBindEntity && hasMetricBindingEvidenceWithoutProductAsin) {
      reasons.push('AI 候选动作绑定的指标证据缺少产品 ASIN，不能进入正式建议池。');
    }
    if (evidenceSufficiency && !evidenceSufficiency.canUseForFormalActions) {
      reasons.push([
        '证据充分性不足，AI 候选动作只能作为洞察展示。',
        ...evidenceSufficiency.blockers,
      ].join('；'));
    }

    if (reasons.length > 0) {
      insightOnlyCandidateIndexes.push(index);
      invalidReasons.push({
        candidateIndex: index,
        reason: reasons.join('；'),
        missingRefs: [...missingRefs, ...outOfScopeRefs],
      });
      return;
    }

    validCandidateIndexes.push(index);
  });

  if (!schemaValid && input.diagnosis.aiCandidates.length === 0) {
    invalidReasons.push({
      candidateIndex: -1,
      reason: 'AI 输出 schemaVersion 错误，已按规则 fallback 处理。',
      missingRefs: [],
    });
  }

  return {
    diagnosis: input.diagnosis,
    validCandidateIndexes,
    insightOnlyCandidateIndexes,
    invalidReasons,
  };
}

function markLifecycleReviewIfNeeded(
  diagnosis: AdStrategyDiagnosisOutput,
  evidenceById: Map<string, AiEvidenceItem>,
  scope: RecommendationDiagnosisScope,
): void {
  const refs = diagnosis.lifecycleStageEvidenceRefs || [];
  const missingRefs = refs.filter((ref) => !evidenceById.has(ref));
  const outOfScopeRefs = refs
    .map((ref) => evidenceById.get(ref))
    .filter((item): item is AiEvidenceItem => Boolean(item))
    .filter((evidence) => !evidenceBelongsToScope(evidence, scope))
    .map((evidence) => evidence.evidenceId);
  const invalidReasons = [
    ...missingRefs.map((ref) => `AI 阶段判断引用了不可用证据：${ref}。`),
    ...outOfScopeRefs.map((ref) => `AI 阶段判断引用了当前运营范围之外的证据：${ref}。`),
  ];
  const referencedEvidence = refs
    .map((ref) => evidenceById.get(ref))
    .filter((item): item is AiEvidenceItem => Boolean(item));
  const hasLifecycleEvidence = referencedEvidence.some((evidence) => (
    ['metric', 'timeline', 'product_context'].includes(evidence.type)
  ));
  const lifecycleEvidenceWithoutProductAsin = referencedEvidence
    .filter((evidence) => ['metric', 'timeline', 'product_context'].includes(evidence.type))
    .filter((evidence) => !evidenceHasProductBinding(evidence, scope))
    .map((evidence) => evidence.evidenceId);

  if (refs.length === 0) {
    invalidReasons.unshift('AI 阶段判断缺少 evidenceRefs。');
  }
  if (refs.length > 0 && !hasLifecycleEvidence) {
    invalidReasons.push('AI 阶段判断缺少指标或对象时间线证据。');
  }
  if (lifecycleEvidenceWithoutProductAsin.length > 0) {
    invalidReasons.push('AI 阶段判断引用的指标证据缺少产品 ASIN。');
  }
  if (!invalidReasons.length) return;

  diagnosis.lifecycleStageRequiresReview = true;
  diagnosis.lifecycleStageInvalidReasons = invalidReasons;
  if (!diagnosis.riskWarnings.includes('AI 阶段判断证据不足或跨范围，需要人工复核后再采用。')) {
    diagnosis.riskWarnings = [
      ...diagnosis.riskWarnings,
      'AI 阶段判断证据不足或跨范围，需要人工复核后再采用。',
    ];
  }
}

function markThresholdReviewIfNeeded(
  diagnosis: AdStrategyDiagnosisOutput,
  evidenceById: Map<string, AiEvidenceItem>,
  scope: RecommendationDiagnosisScope,
): void {
  const requiredEvidenceTypes: Record<keyof AdStrategyDiagnosisOutput['thresholdSuggestions'], AiEvidenceItem['type'][]> = {
    targetAcos: ['metric', 'timeline', 'product_context'],
    highAcosThreshold: ['metric', 'timeline'],
    noOrderClickThreshold: ['metric', 'timeline'],
    minSpend: ['metric', 'timeline'],
  };

  for (const [thresholdKey, suggestion] of Object.entries(diagnosis.thresholdSuggestions) as Array<[
    keyof AdStrategyDiagnosisOutput['thresholdSuggestions'],
    AdStrategyDiagnosisOutput['thresholdSuggestions'][keyof AdStrategyDiagnosisOutput['thresholdSuggestions']],
  ]>) {
    const refs = suggestion.evidenceRefs || [];
    const referencedEvidence = refs
      .map((ref) => evidenceById.get(ref))
      .filter((item): item is AiEvidenceItem => Boolean(item));
    const missingRefs = refs.filter((ref) => !evidenceById.has(ref));
    const outOfScopeRefs = referencedEvidence
      .filter((evidence) => !evidenceBelongsToScope(evidence, scope))
      .map((evidence) => evidence.evidenceId);
    const reviewReasons = [
      ...(refs.length === 0 ? ['AI 阈值建议缺少 evidenceRefs。'] : []),
      ...missingRefs.map((ref) => `AI 阈值建议引用了不可用证据：${ref}。`),
      ...outOfScopeRefs.map((ref) => `AI 阈值建议引用了当前运营范围之外的证据：${ref}。`),
    ];
    const hasRequiredEvidenceType = referencedEvidence.some((evidence) => (
      requiredEvidenceTypes[thresholdKey].includes(evidence.type)
    ));
    const requiredEvidenceWithoutProductAsin = referencedEvidence.some((evidence) => (
      requiredEvidenceTypes[thresholdKey].includes(evidence.type)
      && !evidenceHasProductBinding(evidence, scope)
    ));

    if (!hasRequiredEvidenceType) {
      reviewReasons.push(thresholdKey === 'targetAcos'
        ? 'AI 阈值建议缺少指标、对象时间线或产品配置证据。'
        : 'AI 阈值建议缺少指标或对象时间线证据。');
    }
    if (requiredEvidenceWithoutProductAsin) {
      reviewReasons.push('AI 阈值建议引用的指标证据缺少产品 ASIN。');
    }

    if (reviewReasons.length > 0) {
      suggestion.requiresReview = true;
      suggestion.reviewReasons = Array.from(new Set(reviewReasons));
    }
  }
}

function evidenceBelongsToScope(evidence: AiEvidenceItem, scope: RecommendationDiagnosisScope): boolean {
  if (evidence.storeName && evidence.storeName !== scope.storeName) return false;
  if (evidence.marketplaceCode && evidence.marketplaceCode !== scope.marketplaceCode) return false;
  if (scope.asin && evidence.asin && normalize(evidence.asin) !== normalize(scope.asin)) return false;
  if (scope.batchId && evidence.batchId && evidence.type !== 'operation_event' && evidence.batchId !== scope.batchId) return false;
  if (evidence.dateRange) {
    const [dateFrom, dateTo = dateFrom] = evidence.dateRange.split('~');
    if (dateFrom && dateTo && (dateTo < scope.dateFrom || dateFrom > scope.dateTo)) return false;
  }
  return true;
}

function evidenceHasReportTrace(evidence: AiEvidenceItem): boolean {
  return evidenceHasSourceFileAndRow(evidence) && evidenceHasRealReportSource(evidence);
}

function evidenceHasProductBinding(evidence: AiEvidenceItem, scope: RecommendationDiagnosisScope): boolean {
  return Boolean(String(evidence.asin || scope.asin || '').trim());
}

function evidenceHasSourceFileAndRow(evidence: AiEvidenceItem): boolean {
  return Boolean(
    String(evidence.sourceFile || '').trim()
    && Number.isFinite(Number(evidence.sourceRow))
    && Number(evidence.sourceRow) > 0,
  );
}

function evidenceHasRealReportSource(evidence: AiEvidenceItem): boolean {
  const sourceFile = String(evidence.sourceFile || '').trim().toLowerCase().split(/[?#]/)[0];
  return /\.(xlsx|xls|csv)$/.test(sourceFile);
}

function evidenceCanBindCandidate(
  evidence: AiEvidenceItem,
  candidate: AdStrategyDiagnosisOutput['aiCandidates'][number],
): boolean {
  if (!['metric', 'rule_candidate'].includes(evidence.type)) return false;
  const candidateEntity = normalize(candidate.entityName);
  if (!candidateEntity) return false;

  const evidenceNames = [
    evidence.entityName,
    evidence.campaignName,
    evidence.adGroupName,
    evidence.asin,
  ].map((value) => normalize(value || ''));
  if (!evidenceNames.includes(candidateEntity)) return false;

  const candidateType = normalizeEntityType(candidate.entityType);
  const evidenceType = normalizeEntityType(evidence.entityType || '');
  return !candidateType || !evidenceType || candidateType === evidenceType
    || (candidateType === 'target' && evidenceType === 'keyword')
    || (candidateType === 'keyword' && evidenceType === 'target');
}

function normalizeEntityType(value: string): string {
  const normalized = normalize(value);
  if (normalized === 'adgroup') return 'ad_group';
  if (normalized === 'keyword') return 'target';
  return normalized;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
