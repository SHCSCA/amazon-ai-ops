import type { ActionLog, ActionRecommendation, ExecutionStatus } from '@amazon-ai-ops/shared-types';
import type { ExecutionResult } from '@amazon-ai-ops/action-executor';

export interface RecommendationExecutionOutcome {
  executionStatus: ExecutionStatus;
  recommendationStatus: ActionRecommendation['status'];
  shouldMarkExecuted: boolean;
}

export function buildAdExecutionUnavailableResult(
  recommendation: ActionRecommendation,
  reason: string,
): ExecutionResult {
  return {
    success: false,
    executionId: `exec_blocked_${Date.now()}`,
    actionType: recommendation.actionType,
    beforeValue: recommendation.currentValue,
    afterValue: recommendation.recommendedValue,
    verified: false,
    error: reason,
    errorCode: 'EXECUTOR_UNAVAILABLE',
    executedAt: new Date().toISOString(),
  };
}

export function getRecommendationExecutionOutcome(result: Pick<ExecutionResult, 'success' | 'verified'>): RecommendationExecutionOutcome {
  if (result.success && result.verified) {
    return {
      executionStatus: 'success',
      recommendationStatus: 'executed',
      shouldMarkExecuted: true,
    };
  }

  return {
    executionStatus: 'failed',
    recommendationStatus: 'approved',
    shouldMarkExecuted: false,
  };
}

export interface BuildActionLogForExecutionInput {
  recommendationId: number;
  recommendation: ActionRecommendation;
  executionResult: ExecutionResult;
  outcome: RecommendationExecutionOutcome;
  screenshotBefore?: string;
  screenshotAfter?: string;
  pageUrl?: string;
}

export function buildActionLogForExecution(input: BuildActionLogForExecutionInput): Omit<ActionLog, 'id' | 'createdAt'> {
  const { recommendation, executionResult, outcome } = input;
  return {
    recommendationId: input.recommendationId,
    taskId: recommendation.taskId,
    actionType: recommendation.actionType,
    entityType: recommendation.entityType,
    entityId: recommendation.entityId,
    entityName: recommendation.entityName,
    beforeValue: executionResult.beforeValue,
    afterValue: executionResult.afterValue,
    executionStatus: outcome.executionStatus,
    failureReason: outcome.executionStatus === 'success' ? undefined : executionResult.error || '广告执行未通过回读确认',
    screenshotBefore: input.screenshotBefore,
    screenshotAfter: input.screenshotAfter,
    tracePath: executionResult.tracePath,
    pageUrl: input.pageUrl,
  };
}
