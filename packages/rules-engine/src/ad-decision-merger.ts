export interface AdDecisionIdentity {
  storeId: string;
  storeName: string;
  marketplaceCode: string;
  asin: string;
  batchId: string;
  kind: 'report_object';
  reportType?: string;
  sourceFile: string;
  sourceRow: number;
  metricDate: string;
  dateFrom: string;
  dateTo: string;
  nativeEntityId?: string;
  nativeEntityType?: string;
  campaignName: string;
  adGroupName?: string;
  matchType?: string;
  campaignId?: string;
  adGroupId?: string;
}

// 报表对象身份仅用于建议比较，不是 Ads 原生对象或执行权限。
export function adDecisionIdentityKey(candidate: Pick<AdDecisionCandidate, 'identity' | 'entityType' | 'entityName'>): string | undefined {
  const identity = candidate.identity;
  if (!identity || identity.kind !== 'report_object' || !Number.isSafeInteger(identity.sourceRow) || identity.sourceRow <= 0) return undefined;
  const dates = [identity.metricDate, identity.dateFrom, identity.dateTo];
  if (dates.some((date) => typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    || identity.dateFrom > identity.dateTo || identity.metricDate < identity.dateFrom || identity.metricDate > identity.dateTo) return undefined;
  const type = normalize(candidate.entityType);
  if (!['target', 'search_term', 'campaign', 'ad_group'].includes(type)) return undefined;
  const required = [identity.storeId, identity.storeName, identity.marketplaceCode, identity.asin,
    identity.batchId, identity.sourceFile, identity.metricDate, identity.dateFrom, identity.dateTo, identity.campaignName, candidate.entityName];
  if (type !== 'campaign') required.push(identity.adGroupName || '');
  if (type === 'target' || type === 'search_term') required.push(identity.matchType || '');
  if (required.some((value) => typeof value !== 'string' || !value.trim())) return undefined;
  return JSON.stringify([type, candidate.entityName, identity.storeId, identity.storeName,
    identity.marketplaceCode, identity.asin, identity.batchId, identity.kind, identity.reportType, identity.sourceFile, identity.sourceRow, identity.metricDate, identity.dateFrom, identity.dateTo, identity.nativeEntityId, identity.nativeEntityType,
    identity.campaignName, identity.adGroupName, identity.matchType, identity.campaignId, identity.adGroupId]);
}

export type DecisionAgreement = 'aligned' | 'rule_only' | 'ai_only' | 'conflict';

export interface AdDecisionCandidate {
  identity?: AdDecisionIdentity;
  entityType: string;
  entityName: string;
  actionType: string;
  recommendedValue?: string;
  reason: string;
  confidence: number;
}

export interface MergeAdDecisionsInput {
  ruleCandidates: AdDecisionCandidate[];
  aiCandidates: AdDecisionCandidate[];
}

export interface MergedAdDecision {
  agreement: DecisionAgreement;
  ruleCandidateIndex?: number;
  aiCandidateIndex?: number;
  source: 'rule' | 'ai' | 'rule_ai';
  identity?: AdDecisionIdentity;
  entityType: string;
  entityName: string;
  actionType: string;
  recommendedValue?: string;
  confidence: number;
  reasons: string[];
  riskWarnings: string[];
  requiresReview: boolean;
}

export function mergeAdDecisions(input: MergeAdDecisionsInput): MergedAdDecision[] {
  const merged: MergedAdDecision[] = [];
  const usedAiIndexes = new Set<number>();

  input.ruleCandidates.forEach((ruleCandidate, ruleIndex) => {
    const key = adDecisionIdentityKey(ruleCandidate);
    const aiIndexes = input.aiCandidates.flatMap((candidate, index) =>
      key && adDecisionIdentityKey(candidate) === key ? [index] : []);
    const ruleCount = key ? input.ruleCandidates.filter((candidate) => adDecisionIdentityKey(candidate) === key).length : 0;
    if (!key || ruleCount !== 1 || aiIndexes.length !== 1) {
      const decision = toRuleOnlyDecision(ruleCandidate);
      decision.ruleCandidateIndex = ruleIndex;
      decision.requiresReview = input.aiCandidates.length > 0 || ruleCount > 1
        || (!key && input.ruleCandidates.filter((candidate) => normalize(candidate.entityType) === normalize(ruleCandidate.entityType)
          && normalize(candidate.entityName) === normalize(ruleCandidate.entityName)).length > 1);
      if (decision.requiresReview) decision.riskWarnings.push('Scoped object identity is missing, unconfirmed, or not one-to-one; manual review is required.');
      merged.push(decision);
      return;
    }
    const aiIndex = aiIndexes[0];
    const aiCandidate = input.aiCandidates[aiIndex];
    usedAiIndexes.add(aiIndex);
    const decision = sameAction(ruleCandidate, aiCandidate)
      ? toAlignedDecision(ruleCandidate, aiCandidate)
      : toConflictDecision(ruleCandidate, aiCandidate);
    merged.push({ ...decision, ruleCandidateIndex: ruleIndex, aiCandidateIndex: aiIndex });
  });

  input.aiCandidates.forEach((aiCandidate, index) => {
    if (!usedAiIndexes.has(index)) {
      merged.push({ ...toAiOnlyDecision(aiCandidate), aiCandidateIndex: index });
    }
  });

  return merged;
}

function toAlignedDecision(ruleCandidate: AdDecisionCandidate, aiCandidate: AdDecisionCandidate): MergedAdDecision {
  return {
    agreement: 'aligned',
    source: 'rule_ai',
    identity: ruleCandidate.identity,
    entityType: ruleCandidate.entityType,
    entityName: ruleCandidate.entityName,
    actionType: ruleCandidate.actionType,
    recommendedValue: aiCandidate.recommendedValue ?? ruleCandidate.recommendedValue,
    confidence: boostedConfidence(ruleCandidate.confidence, aiCandidate.confidence),
    reasons: [`Rule: ${ruleCandidate.reason}`, `AI: ${aiCandidate.reason}`],
    riskWarnings: [],
    requiresReview: false,
  };
}

function toConflictDecision(ruleCandidate: AdDecisionCandidate, aiCandidate: AdDecisionCandidate): MergedAdDecision {
  return {
    agreement: 'conflict',
    source: 'rule_ai',
    identity: ruleCandidate.identity,
    entityType: ruleCandidate.entityType,
    entityName: ruleCandidate.entityName,
    actionType: ruleCandidate.actionType,
    recommendedValue: ruleCandidate.recommendedValue,
    confidence: rounded(Math.max(ruleCandidate.confidence, aiCandidate.confidence)),
    reasons: [`Rule: ${ruleCandidate.reason}`, `AI: ${aiCandidate.reason}`],
    riskWarnings: [normalize(ruleCandidate.actionType) === normalize(aiCandidate.actionType)
      ? 'Rule and AI recommend different parameter values for the same action and target.'
      : 'Rule and AI recommend different actions for the same target.'],
    requiresReview: true,
  };
}

function toRuleOnlyDecision(candidate: AdDecisionCandidate): MergedAdDecision {
  return {
    agreement: 'rule_only',
    source: 'rule',
    identity: candidate.identity,
    entityType: candidate.entityType,
    entityName: candidate.entityName,
    actionType: candidate.actionType,
    recommendedValue: candidate.recommendedValue,
    confidence: rounded(candidate.confidence),
    reasons: [`Rule: ${candidate.reason}`],
    riskWarnings: ['Rule-only candidate; AI confirmation is missing.'],
    requiresReview: false,
  };
}

function toAiOnlyDecision(candidate: AdDecisionCandidate): MergedAdDecision {
  return {
    agreement: 'ai_only',
    source: 'ai',
    identity: candidate.identity,
    entityType: candidate.entityType,
    entityName: candidate.entityName,
    actionType: candidate.actionType,
    recommendedValue: candidate.recommendedValue,
    confidence: rounded(candidate.confidence),
    reasons: [`AI: ${candidate.reason}`],
    riskWarnings: ['AI-only candidate; rule confirmation is missing.'],
    requiresReview: true,
  };
}

function sameAction(left: AdDecisionCandidate, right: AdDecisionCandidate): boolean {
  return normalize(left.actionType) === normalize(right.actionType)
    && normalizeRecommendedValue(left.recommendedValue) === normalizeRecommendedValue(right.recommendedValue);
}

function normalizeRecommendedValue(value?: string): string | undefined {
  // 只忽略首尾空白；不推断数值格式、单位或文本大小写等价。
  // 双方均缺值沿用原比较行为，可执行性仍由下游审批策略校验。
  return value?.trim() || undefined;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function boostedConfidence(ruleConfidence: number, aiConfidence: number): number {
  return rounded(Math.min(0.95, Math.max(ruleConfidence, aiConfidence) + 0.07));
}

function rounded(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
