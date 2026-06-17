import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';

export interface AdActionExplanationForMerge {
  explanation?: string;
  riskWarnings?: string[];
  alternativeSuggestions?: string[];
  source?: 'ai' | 'rule';
  aiFallbackReason?: string;
}

export function mergeAdActionExplanationEvidence(input: {
  recommendation: ActionRecommendation;
  explanation: AdActionExplanationForMerge;
  model: string;
}): ActionRecommendation {
  const previousEvidence = input.recommendation.evidence || ({} as ActionRecommendation['evidence']);
  const actionFallbackReason = input.explanation.aiFallbackReason || previousEvidence.aiActionFallbackReason;
  const strategyFallbackReason = previousEvidence.aiStrategyFallbackReason
    || (previousEvidence.aiStrategySource === 'rule' ? previousEvidence.aiFallbackReason : undefined);

  return {
    ...input.recommendation,
    reason: input.explanation.source === 'ai' && input.explanation.explanation
      ? input.explanation.explanation
      : input.recommendation.reason,
    evidence: {
      ...previousEvidence,
      explanationSource: input.explanation.source,
      aiExplanation: input.explanation.explanation,
      aiRiskWarnings: input.explanation.riskWarnings,
      aiAlternativeSuggestions: input.explanation.alternativeSuggestions,
      aiStrategyFallbackReason: strategyFallbackReason,
      aiActionFallbackReason: actionFallbackReason,
      aiFallbackReason: actionFallbackReason,
      aiModel: input.model,
    },
  };
}
