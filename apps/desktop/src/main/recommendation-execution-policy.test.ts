import { describe, expect, it } from 'vitest';
import {
  buildAdExecutionUnavailableResult,
  buildActionLogForExecution,
  getRecommendationExecutionOutcome,
} from './recommendation-execution-policy';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import type { ExecutionResult } from '@amazon-ai-ops/action-executor';

function recommendation(overrides: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B000TEST',
    msku: 'MSKU-1',
    entityType: 'target',
    entityId: 'target_1',
    entityName: 'bad keyword',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '0.80',
    reason: 'test',
    evidence: {
      impressions: 100,
      clicks: 20,
      cost: 12,
      orders: 0,
      sales: 0,
      acos: 0,
      cpc: 0.6,
      cvr: 0,
    },
    confidence: 0.8,
    riskLevel: 'APPROVAL',
    status: 'approved',
    ...overrides,
  };
}

describe('recommendation execution policy', () => {
  it('creates a failed execution result when real ad execution is unavailable', () => {
    const result = buildAdExecutionUnavailableResult(recommendation(), '真实广告执行器尚未接入可验证回读');

    expect(result.success).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.error).toBe('真实广告执行器尚未接入可验证回读');
  });

  it('only marks a recommendation executed when the action both succeeds and is verified', () => {
    const unverifiedSuccess: ExecutionResult = {
      success: true,
      verified: false,
      executionId: 'exec_1',
      actionType: 'lower_bid',
      beforeValue: '1.20',
      afterValue: '0.80',
      executedAt: '2026-06-08T00:00:00.000Z',
    };

    expect(getRecommendationExecutionOutcome(unverifiedSuccess)).toEqual({
      executionStatus: 'failed',
      recommendationStatus: 'approved',
      shouldMarkExecuted: false,
    });

    expect(getRecommendationExecutionOutcome({ ...unverifiedSuccess, verified: true })).toEqual({
      executionStatus: 'success',
      recommendationStatus: 'executed',
      shouldMarkExecuted: true,
    });
  });

  it('builds a failed action log and keeps recommendation approved for blocked execution', () => {
    const rec = recommendation({ id: 42, status: 'approved' });
    const executionResult = buildAdExecutionUnavailableResult(rec, '真实广告执行器尚未接入可验证回读');
    const outcome = getRecommendationExecutionOutcome(executionResult);

    const log = buildActionLogForExecution({
      recommendationId: 42,
      recommendation: rec,
      executionResult,
      outcome,
      screenshotBefore: 'before.png',
      screenshotAfter: 'after.png',
    });

    expect(outcome).toMatchObject({
      executionStatus: 'failed',
      recommendationStatus: 'approved',
      shouldMarkExecuted: false,
    });
    expect(log).toMatchObject({
      recommendationId: 42,
      executionStatus: 'failed',
      failureReason: '真实广告执行器尚未接入可验证回读',
      beforeValue: '1.20',
      afterValue: '0.80',
      screenshotBefore: 'before.png',
      screenshotAfter: 'after.png',
    });
  });
});
