import { describe, expect, it } from 'vitest';
import { aiCallEvidenceLabel, buildAiCallDiagnostics } from './ai-call-diagnostics';
import type { AiCallLogView } from './types';

describe('buildAiCallDiagnostics', () => {
  it('summarizes the latest successful AI call with evidence pack status', () => {
    const diagnostics = buildAiCallDiagnostics([
      aiLog({
        success: true,
        promptKey: 'ad_strategy_diagnosis',
        model: 'deepseek-chat',
        schemaVersion: 'ad_strategy_diagnosis_v1',
        evidencePackSummary: { total: 5, metric: 2, timeline: 1, operationEvent: 1, productContext: 1, ruleCandidate: 0 },
      }),
    ]);

    expect(diagnostics.status).toBe('ready');
    expect(diagnostics.headline).toBe('最近 AI 调用成功');
    expect(diagnostics.detail).toContain('广告策略诊断');
    expect(diagnostics.detail).toContain('deepseek-chat');
    expect(diagnostics.detail).toContain('输出格式 广告策略诊断 v1');
    expect(diagnostics.detail).toContain('证据包 5 条');
    expect(diagnostics.detail).not.toContain('ad_strategy_diagnosis');
    expect(diagnostics.detail).not.toContain('schema');
    expect(diagnostics.nextAction).toBe('查看广告量化或优化建议中的 AI 判断依据');
  });

  it('surfaces the latest failed AI call and tells the operator what to check next', () => {
    const diagnostics = buildAiCallDiagnostics([
      aiLog({
        success: false,
        errorMessage: 'AI 输出 schemaVersion 错误：legacy_strategy_v0',
        evidencePackSummary: { total: 0 },
      }),
    ]);

    expect(diagnostics.status).toBe('blocked');
    expect(diagnostics.headline).toBe('最近 AI 调用失败');
    expect(diagnostics.detail).toContain('广告策略诊断');
    expect(diagnostics.detail).toContain('输出格式错误');
    expect(diagnostics.detail).not.toContain('ad_strategy_diagnosis');
    expect(diagnostics.detail).not.toContain('schemaVersion');
    expect(diagnostics.nextAction).toBe('检查模型、Base URL、标准 JSON 输出格式和证据包');
  });

  it('uses createdAt and id to find the latest call instead of trusting input order', () => {
    const diagnostics = buildAiCallDiagnostics([
      aiLog({
        id: 1,
        success: true,
        createdAt: '2026-06-12T10:00:00.000Z',
        evidencePackSummary: { total: 5 },
      }),
      aiLog({
        id: 2,
        success: false,
        createdAt: '2026-06-12T10:01:00.000Z',
        errorMessage: '后一次 AI JSON 解析失败',
        evidencePackSummary: { total: 5 },
      }),
    ]);

    expect(diagnostics.status).toBe('blocked');
    expect(diagnostics.headline).toBe('最近 AI 调用失败');
    expect(diagnostics.detail).toContain('后一次 AI JSON 解析失败');
  });

  it('explains that no records means AI has not participated yet', () => {
    const diagnostics = buildAiCallDiagnostics([]);

    expect(diagnostics.status).toBe('warning');
    expect(diagnostics.headline).toBe('暂无 AI 调用记录');
    expect(diagnostics.nextAction).toBe('先测试 AI 连接，再运行广告量化或优化建议');
  });

  it('labels evidence count by AI call type so operators know what was checked', () => {
    expect(aiCallEvidenceLabel(aiLog({
      promptKey: 'ad_strategy_diagnosis',
      evidencePackSummary: { total: 7 },
    }))).toBe('证据包 7 条');
    expect(aiCallEvidenceLabel(aiLog({
      promptKey: 'ad_action_reason',
      evidencePackSummary: { total: 2, sourceFileCount: 1, aiEvidenceRefCount: 1 },
    }))).toBe('源文件/证据引用 2 条');
    expect(aiCallEvidenceLabel(aiLog({
      promptKey: 'listing_rewrite',
      evidencePackSummary: { total: 1, listingDraft: 1 },
    }))).toBe('草案证据 1 条');
  });
});

function aiLog(patch: Partial<AiCallLogView> = {}): AiCallLogView {
  return {
    id: 1,
    promptKey: 'ad_strategy_diagnosis',
    promptVersion: 'ad_strategy_diagnosis_v1',
    model: 'deepseek-chat',
    inputHash: 'hash',
    outputJson: '{}',
    success: true,
    createdAt: '2026-06-12T10:00:00.000Z',
    ...patch,
  };
}
