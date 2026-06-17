import { describe, expect, it } from 'vitest';
import { buildAdActionReasonAiCallLogInput } from './ad-action-ai-call-log';

describe('buildAdActionReasonAiCallLogInput', () => {
  it('records successful ad action explanation calls without storing raw prompt text', () => {
    const input = buildAdActionReasonAiCallLogInput({
      recommendation: recommendation(),
      explanation: {
        source: 'ai',
        explanation: '建议降低出价，因为当前 ACOS 高于目标。',
        riskWarnings: ['需要人工复核。'],
        alternativeSuggestions: ['继续观察 3 天。'],
      },
      model: 'deepseek-chat',
    });

    expect(input.promptKey).toBe('ad_action_reason');
    expect(input.promptVersion).toBe('ad_action_reason_v1');
    expect(input.schemaVersion).toBe('ad_action_reason_v1');
    expect(input.model).toBe('deepseek-chat');
    expect(input.success).toBe(true);
    expect(input.errorMessage).toBeUndefined();
    expect(input.inputHash).toHaveLength(64);
    expect(input.outputJson).toContain('建议降低出价');
    expect(input.outputJson).not.toContain('当前数据表现');
    expect(input.evidencePackSummary).toMatchObject({
      total: 2,
      sourceFileCount: 1,
      aiEvidenceRefCount: 1,
      actionType: 'lower_bid',
      entityType: 'target',
    });
  });

  it('records fallback explanations as failed AI calls with an error reason', () => {
    const input = buildAdActionReasonAiCallLogInput({
      recommendation: recommendation(),
      explanation: {
        source: 'rule',
        explanation: 'AI 响应无法解析为标准 JSON，已回退到规则解释。',
        riskWarnings: ['AI 输出结构异常，不能直接作为审批依据。'],
        aiFallbackReason: 'AI 响应无法解析为标准 JSON',
      },
      model: 'deepseek-chat',
    });

    expect(input.success).toBe(false);
    expect(input.errorMessage).toBe('AI 响应无法解析为标准 JSON');
    expect(JSON.parse(input.outputJson)).toMatchObject({
      schemaVersion: 'ad_action_reason_v1',
      source: 'rule',
      aiFallbackReason: 'AI 响应无法解析为标准 JSON',
    });
  });
});

function recommendation(): any {
  return {
    actionType: 'lower_bid',
    entityType: 'target',
    entityName: 'tight match target',
    currentValue: '1.20',
    recommendedValue: '1.08',
    evidence: {
      date: '2026-06-12',
      batchId: 'batch_mock_ready',
      sourceFiles: ['C:/reports/source_user_search_term.xlsx'],
      sourceRow: 12,
      aiEvidenceRefs: ['metric:batch_mock_ready:target:abc'],
      cost: 42.18,
      sales: 58.58,
      orders: 1,
      clicks: 32,
      acos: 0.72,
    },
  };
}
