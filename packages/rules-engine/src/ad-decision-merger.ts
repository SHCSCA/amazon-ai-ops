export type DecisionAgreement = 'aligned' | 'rule_only' | 'ai_only' | 'conflict';

export interface AdDecisionCandidate {
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
  source: 'rule' | 'ai' | 'rule_ai';
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

  for (const ruleCandidate of input.ruleCandidates) {
    const sameEntityAiIndex = input.aiCandidates.findIndex(
      (aiCandidate, index) => !usedAiIndexes.has(index) && hasSameEntity(ruleCandidate, aiCandidate),
    );

    if (sameEntityAiIndex === -1) {
      merged.push(toRuleOnlyDecision(ruleCandidate));
      continue;
    }

    const aiCandidate = input.aiCandidates[sameEntityAiIndex];
    usedAiIndexes.add(sameEntityAiIndex);

    if (sameAction(ruleCandidate, aiCandidate)) {
      merged.push(toAlignedDecision(ruleCandidate, aiCandidate));
    } else {
      merged.push(toConflictDecision(ruleCandidate, aiCandidate));
    }
  }

  input.aiCandidates.forEach((aiCandidate, index) => {
    if (!usedAiIndexes.has(index)) {
      merged.push(toAiOnlyDecision(aiCandidate));
    }
  });

  return merged;
}

function toAlignedDecision(ruleCandidate: AdDecisionCandidate, aiCandidate: AdDecisionCandidate): MergedAdDecision {
  return {
    agreement: 'aligned',
    source: 'rule_ai',
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
    entityType: ruleCandidate.entityType,
    entityName: ruleCandidate.entityName,
    actionType: ruleCandidate.actionType,
    recommendedValue: ruleCandidate.recommendedValue,
    confidence: rounded(Math.max(ruleCandidate.confidence, aiCandidate.confidence)),
    reasons: [`Rule: ${ruleCandidate.reason}`, `AI: ${aiCandidate.reason}`],
    riskWarnings: ['Rule and AI recommend different actions for the same target.'],
    requiresReview: true,
  };
}

function toRuleOnlyDecision(candidate: AdDecisionCandidate): MergedAdDecision {
  return {
    agreement: 'rule_only',
    source: 'rule',
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

function hasSameEntity(left: AdDecisionCandidate, right: AdDecisionCandidate): boolean {
  return normalize(left.entityType) === normalize(right.entityType) && normalize(left.entityName) === normalize(right.entityName);
}

function sameAction(left: AdDecisionCandidate, right: AdDecisionCandidate): boolean {
  return normalize(left.actionType) === normalize(right.actionType);
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
