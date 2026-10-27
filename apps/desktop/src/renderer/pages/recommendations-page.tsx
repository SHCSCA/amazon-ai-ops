import React from 'react';
import { useRecommendationsPage } from './recommendation-controller';
import { RecommendationsPageView } from './recommendation-view';

export function RecommendationsPage() {
  return <RecommendationsPageView {...useRecommendationsPage()} />;
}

export { runRecommendationWorkflowMutation, type RecommendationBucketFilter, recommendationMatchesBucketFilter, recommendationWorkflowActionState, recommendationPrimaryTaskActionState, recommendationBatchSelectionState, type RecommendationActionButtonView, recommendationActionButtonView, recommendationStatusFiltersForPage } from './recommendation-selection';
export { thresholdSuggestionSummary, recommendationFormalApprovalExplanationText, recommendationReviewExplanationText, recommendationMergeSummaryText, recommendationMergeExplanationText } from './recommendation-labels';
export { recommendationHasEvidenceBlocker, recommendationCanEnterFormalApproval, recommendationNeedsOperatorResolution } from './recommendation-evidence';
export { generateAiStatus, generateDecisionDiagnosticLine, emptyRecommendationReason } from './recommendation-ai-status';
