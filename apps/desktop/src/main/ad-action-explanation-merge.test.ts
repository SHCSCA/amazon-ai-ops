import { describe, expect, it } from 'vitest';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import { mergeAdActionExplanationEvidence } from './ad-action-explanation-merge';

describe('mergeAdActionExplanationEvidence', () => {
  it('preserves strategy fallback reason when action explanation succeeds', () => {
    const merged = mergeAdActionExplanationEvidence({
      recommendation: recommendation({
        aiFallbackReason: 'AI 策略诊断 schemaVersion 错误，已回退规则。',
        aiStrategyFallbackReason: 'AI 策略诊断 schemaVersion 错误，已回退规则。',
      }),
      explanation: {
        source: 'ai',
        explanation: '建议降低出价，因为当前 ACOS 高于目标。',
        riskWarnings: ['审批前核对当前 bid。'],
        alternativeSuggestions: ['继续观察 3 天。'],
      },
      model: 'deepseek-chat',
    });

    expect(merged.evidence.aiStrategyFallbackReason).toBe('AI 策略诊断 schemaVersion 错误，已回退规则。');
    expect(merged.evidence.aiActionFallbackReason).toBeUndefined();
    expect(merged.evidence.aiFallbackReason).toBeUndefined();
    expect(merged.evidence.explanationSource).toBe('ai');
    expect(merged.evidence.aiExplanation).toBe('建议降低出价，因为当前 ACOS 高于目标。');
  });

  it('records action fallback separately from strategy fallback', () => {
    const merged = mergeAdActionExplanationEvidence({
      recommendation: recommendation({
        aiStrategyFallbackReason: 'AI 策略诊断证据不足，已回退规则。',
      }),
      explanation: {
        source: 'rule',
        explanation: 'AI 文本解释无法解析，使用规则解释。',
        riskWarnings: ['AI 输出结构异常。'],
        aiFallbackReason: 'AI 文本解释无法解析为标准 JSON',
      },
      model: 'deepseek-chat',
    });

    expect(merged.evidence.aiStrategyFallbackReason).toBe('AI 策略诊断证据不足，已回退规则。');
    expect(merged.evidence.aiActionFallbackReason).toBe('AI 文本解释无法解析为标准 JSON');
    expect(merged.evidence.aiFallbackReason).toBe('AI 文本解释无法解析为标准 JSON');
    expect(merged.evidence.explanationSource).toBe('rule');
  });
});

function recommendation(evidencePatch: Partial<ActionRecommendation['evidence']> = {}): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B001',
    msku: '',
    entityType: 'target',
    entityId: 'target_1',
    entityName: 'tight match target',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '1.08',
    reason: 'High ACOS',
    evidence: {
      impressions: 100,
      clicks: 20,
      cost: 30,
      orders: 0,
      sales: 0,
      acos: 0,
      cpc: 1.5,
      cvr: 0,
      ...evidencePatch,
    },
    confidence: 0.7,
    riskLevel: 'APPROVAL',
    status: 'pending',
  };
}
