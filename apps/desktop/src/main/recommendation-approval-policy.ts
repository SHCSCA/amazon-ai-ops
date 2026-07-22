import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import {
  applyRecommendationDecision as applySharedRecommendationDecision,
  assertRecommendationApprovalPolicy as assertSharedRecommendationApprovalPolicy,
  getRecommendationApprovalBlockers as getSharedRecommendationApprovalBlockers,
  type RecommendationDecisionInput,
  type RecommendationDecisionStatus,
} from '@amazon-ai-ops/rules-engine';
import {
  getRecommendationWritableTargetOwnershipBlockers,
  type RecommendationMetricSourceAuthority,
} from './recommendation-writable-target-policy';

export {
  assertRecommendationDecisionRevision,
  assertRecommendationDecisionTransition,
  getExecutableValueBlockers,
  getRecommendationApprovalMissingFields,
  normalizeRecommendationDecisionRequest,
} from '@amazon-ai-ops/rules-engine';
export type {
  RecommendationDecisionInput,
  RecommendationDecisionRequest,
  RecommendationDecisionStatus,
} from '@amazon-ai-ops/rules-engine';

export interface RecommendationApprovalPolicyOptions {
  allowedSourceFiles?: string[];
  sourceAuthority?: RecommendationMetricSourceAuthority;
}

export interface ApplyRecommendationDecisionInput {
  recommendation: ActionRecommendation;
  targetStatus: RecommendationDecisionStatus;
  decision: RecommendationDecisionInput;
  approvalOptions?: RecommendationApprovalPolicyOptions;
  persist: (status: RecommendationDecisionStatus, evidencePatch: Record<string, unknown>) => void;
}

function sharedApprovalOptions(
  recommendation: ActionRecommendation,
  options: RecommendationApprovalPolicyOptions = {},
) {
  const writableTarget = recommendation.evidence?.writableTarget;
  return {
    allowedSourceFiles: options.allowedSourceFiles,
    writableTargetOwnershipBlockers: writableTarget
      ? getRecommendationWritableTargetOwnershipBlockers(
        recommendation,
        writableTarget,
        options.sourceAuthority,
      )
      : [],
  };
}

export function getRecommendationApprovalBlockers(
  recommendation: ActionRecommendation,
  options: RecommendationApprovalPolicyOptions = {},
): string[] {
  return getSharedRecommendationApprovalBlockers(
    recommendation,
    sharedApprovalOptions(recommendation, options),
  );
}

export function assertRecommendationApprovalPolicy(
  recommendation: ActionRecommendation,
  options: RecommendationApprovalPolicyOptions = {},
): void {
  assertSharedRecommendationApprovalPolicy(
    recommendation,
    sharedApprovalOptions(recommendation, options),
  );
}

export function applyRecommendationDecision(input: ApplyRecommendationDecisionInput): void {
  applySharedRecommendationDecision({
    recommendation: input.recommendation,
    targetStatus: input.targetStatus,
    decision: input.decision,
    approvalOptions: sharedApprovalOptions(input.recommendation, input.approvalOptions),
    persist: input.persist,
  });
}
