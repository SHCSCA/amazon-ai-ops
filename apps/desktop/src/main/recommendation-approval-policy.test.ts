import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ActionRecommendation } from '@amazon-ai-ops/shared-types';
import {
  applyRecommendationDecision,
  assertRecommendationApprovalPolicy,
  assertRecommendationDecisionRevision,
  assertRecommendationDecisionTransition,
  getRecommendationApprovalBlockers,
  getRecommendationApprovalMissingFields,
  normalizeRecommendationDecisionRequest,
} from './recommendation-approval-policy';

function recommendation(overrides: Partial<ActionRecommendation> = {}): ActionRecommendation {
  return {
    taskId: 'task_1',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    asin: 'B0TESTASIN',
    msku: 'MSKU-1',
    entityType: 'target',
    entityId: 'target_1',
    entityName: 'tight match target',
    actionType: 'lower_bid',
    currentValue: '1.20',
    recommendedValue: '1.08',
    reason: 'High ACOS',
    evidence: {
      impressions: 1000,
      clicks: 30,
      cost: 40,
      orders: 1,
      sales: 60,
      acos: 0.67,
      cpc: 1.33,
      cvr: 0.03,
      date: '2026-06-12',
      campaignName: 'SP exact',
      adGroupName: 'Main',
      targeting: 'tight match target',
      batchId: 'batch_1',
      sourceFiles: ['C:/reports/user-search-term.xlsx'],
      sourceRow: 12,
      decisionAgreement: 'aligned',
      decisionRequiresReview: false,
      quantReviewRequired: false,
    },
    confidence: 0.8,
    riskLevel: 'APPROVAL',
    status: 'pending',
    ...overrides,
  };
}

const READ_ONLY_RECOMMENDATION_STATUSES = ['approved', 'rejected', 'executed', 'expired'] as const;
const DECISION_TARGET_STATUSES = ['approved', 'rejected'] as const;

describe('recommendation approval policy', () => {
  it('preserves the displayed recommendation revision in structured decision requests', () => {
    expect(normalizeRecommendationDecisionRequest({
      id: 101,
      expectedRevision: 4,
      decision: { approvedBy: 'Alice' },
    })).toEqual({
      id: 101,
      expectedRevision: 4,
      decision: { approvedBy: 'Alice' },
    });
    expect(normalizeRecommendationDecisionRequest(101)).toEqual({
      id: 101,
      expectedRevision: undefined,
      decision: {},
    });
  });

  it.each([undefined, -1, 1.5, '2'])('rejects missing or invalid displayed revision %s', (expectedRevision) => {
    expect(() => assertRecommendationDecisionRevision(
      recommendation({ revision: 2 }),
      expectedRevision,
    )).toThrow(/缺少有效建议版本.*刷新/);
  });

  it('rejects a decision when the displayed revision no longer matches current content', () => {
    expect(() => assertRecommendationDecisionRevision(
      recommendation({ revision: 3 }),
      2,
    )).toThrow(/建议内容已更新.*刷新/);
  });

  it('returns the exact displayed revision when it still matches current content', () => {
    expect(assertRecommendationDecisionRevision(
      recommendation({ revision: 3 }),
      3,
    )).toBe(3);
  });

  it.each(READ_ONLY_RECOMMENDATION_STATUSES.flatMap((sourceStatus) => (
    DECISION_TARGET_STATUSES.map((targetStatus) => ({ sourceStatus, targetStatus }))
  )))('keeps $sourceStatus read-only when a $targetStatus decision is requested', ({ sourceStatus, targetStatus }) => {
    const persist = vi.fn();
    const decision = targetStatus === 'approved'
      ? { approvedBy: 'Alice' }
      : { rejectedBy: 'Alice', note: 'Do not proceed.' };

    expect(() => applyRecommendationDecision({
      recommendation: recommendation({ status: sourceStatus }),
      targetStatus,
      decision,
      persist,
    })).toThrow(new RegExp(`当前状态 ${sourceStatus} 不允许转为 ${targetStatus}`));
    expect(persist).not.toHaveBeenCalled();
  });

  it('allows pending recommendations to become approved and persists the decision evidence', () => {
    const persist = vi.fn();

    applyRecommendationDecision({
      recommendation: recommendation({ status: 'pending' }),
      targetStatus: 'approved',
      decision: { approvedBy: 'Alice', note: 'Evidence checked.' },
      persist,
    });

    expect(persist).toHaveBeenCalledWith('approved', {
      approvalDecision: {
        approvedBy: 'Alice',
        note: 'Evidence checked.',
        decision: 'approved',
      },
    });
  });

  it.each(['pending', 'needs_review'] as const)(
    'allows %s recommendations to become rejected and persists the decision evidence',
    (sourceStatus) => {
      const persist = vi.fn();

      applyRecommendationDecision({
        recommendation: recommendation({ status: sourceStatus }),
        targetStatus: 'rejected',
        decision: { rejectedBy: 'Alice', note: 'Do not proceed.' },
        persist,
      });

      expect(persist).toHaveBeenCalledWith('rejected', {
        approvalDecision: {
          rejectedBy: 'Alice',
          note: 'Do not proceed.',
          decision: 'rejected',
        },
      });
    },
  );

  it('does not allow needs-review recommendations through the normal approval transition', () => {
    expect(() => assertRecommendationDecisionTransition(
      recommendation({ status: 'needs_review' }),
      'approved',
      { approvedBy: 'Alice' },
    )).toThrow(/当前状态 needs_review 不允许转为 approved/);
  });

  it('requires a processing person before approving a pending recommendation', () => {
    const rec = recommendation({ status: 'pending' });

    expect(() => assertRecommendationDecisionTransition(rec, 'approved', {
      approvedBy: '   ',
    })).toThrow(/批准前必须填写审批人/);
  });

  it('requires a processing person before rejecting a reviewable recommendation', () => {
    const rec = recommendation({ status: 'needs_review' });

    expect(() => assertRecommendationDecisionTransition(rec, 'rejected', {
      rejectedBy: '',
      note: 'Do not proceed.',
    })).toThrow(/拒绝前必须填写处理人/);
  });

  it('requires a non-empty reason before rejecting a reviewable recommendation', () => {
    const rec = recommendation({ status: 'pending' });

    expect(() => assertRecommendationDecisionTransition(rec, 'rejected', {
      rejectedBy: 'Alice',
      note: '  ',
    })).toThrow(/拒绝前必须填写拒绝原因/);
  });

  it('blocks the legacy numeric rejection path before persistence because its decision is empty', () => {
    const persist = vi.fn();

    expect(() => applyRecommendationDecision({
      recommendation: recommendation({ status: 'pending' }),
      targetStatus: 'rejected',
      decision: {},
      persist,
    })).toThrow(/拒绝前必须填写处理人/);
    expect(persist).not.toHaveBeenCalled();
  });

  it('does not persist approval when the existing authority and evidence policy blocks it', () => {
    const persist = vi.fn();
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        adGroupName: '',
      },
    });

    expect(() => applyRecommendationDecision({
      recommendation: rec,
      targetStatus: 'approved',
      decision: { approvedBy: 'Alice' },
      persist,
    })).toThrow(/缺少审批字段：广告组/);
    expect(persist).not.toHaveBeenCalled();
  });

  it('wires both Main decision handlers through a guarded CAS and surfaces stale-state conflicts', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    const approveHandler = source.slice(
      source.indexOf('async function handleApproveRecommendation'),
      source.indexOf('async function handleRejectRecommendation'),
    );
    const rejectHandler = source.slice(
      source.indexOf('async function handleRejectRecommendation'),
      source.indexOf('function handleGetRecommendations'),
    );

    for (const handler of [approveHandler, rejectHandler]) {
      expect(handler).toContain('applyRecommendationDecision({');
      expect(handler).toContain('assertRecommendationDecisionRevision(');
      expect(handler.indexOf('assertRecommendationDecisionRevision(')).toBeLessThan(handler.indexOf('applyRecommendationDecision({'));
      expect(handler).toContain('updateStatusWithEvidenceIfCurrent(');
      expect(handler.indexOf('applyRecommendationDecision({')).toBeLessThan(handler.indexOf('updateStatusWithEvidenceIfCurrent('));
      expect(handler).toContain('recommendation.status');
      expect(handler).toContain('requestedRevision');
      expect(handler).toContain('expectedRevision');
      expect(handler).toContain('建议状态已变化，请刷新后重试');
      expect(handler).not.toMatch(/\.updateStatusWithEvidence\s*\(/);
      expect(handler).not.toMatch(/\.updateStatus\s*\(/);
    }
  });

  it('allows normal approval-required recommendations after human approval', () => {
    const rec = recommendation();

    expect(getRecommendationApprovalMissingFields(rec)).toEqual([]);
    expect(getRecommendationApprovalBlockers(rec)).toEqual([]);
    expect(() => assertRecommendationApprovalPolicy(rec)).not.toThrow();
  });

  it('blocks recommendations that cannot be bound to a concrete ads UI action', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        adGroupName: '',
        sourceFiles: [],
      },
      currentValue: '',
    });

    expect(getRecommendationApprovalMissingFields(rec)).toEqual([
      '广告组',
      '当前值',
      '来源文件',
    ]);
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/缺少审批字段：广告组、当前值、来源文件/);
  });

  it('blocks recommendations that are not bound to a concrete product ASIN', () => {
    const rec = recommendation({
      asin: '',
      evidence: {
        ...recommendation().evidence,
        asin: '',
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('ASIN');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/ASIN/);
  });

  it('blocks AI-only, conflict, and explicit strategy review recommendations', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: { ...recommendation().evidence, decisionAgreement: 'ai_only' },
    }))).toContain('AI-only 建议');

    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: { ...recommendation().evidence, decisionAgreement: 'conflict' },
    }))).toContain('AI/规则冲突');

    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: { ...recommendation().evidence, decisionRequiresReview: true },
    }))).toContain('AI/规则合并标记需复核');
  });

  it('blocks recommendations without a source row for original report traceability', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceRow: undefined,
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('来源行号');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/来源行号/);
  });

  it('blocks recommendations whose source row is not a positive original report row number', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceRow: -1,
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('来源行号');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/来源行号/);
  });

  it('blocks recommendations whose source files are only audit or diagnostic artifacts', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [
          'C:/reports/acceptance-audit.json',
          'C:/reports/diagnostic-screenshot.png',
        ],
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('真实来源报表');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/真实来源报表/);
  });

  it('blocks recommendations when any source file is an audit artifact even if another source is a real spreadsheet', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [
          'C:/reports/user-search-term.xlsx',
          'C:/reports/acceptance-audit.json',
        ],
      },
    });

    expect(getRecommendationApprovalMissingFields(rec)).toContain('真实来源报表');
    expect(() => assertRecommendationApprovalPolicy(rec)).toThrow(/真实来源报表/);
  });

  it('blocks recommendations whose source files are not part of the current real-report gate', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceFiles: ['C:/reports/stale-user-search-term.xlsx'],
      },
    });

    const blockers = getRecommendationApprovalBlockers(rec, {
      allowedSourceFiles: ['C:/reports/current-user-search-term.xlsx'],
    });

    expect(blockers).toContain('来源文件不属于当前数据批次真实报表');
    expect(() => assertRecommendationApprovalPolicy(rec, {
      allowedSourceFiles: ['C:/reports/current-user-search-term.xlsx'],
    })).toThrow(/来源文件不属于当前数据批次真实报表/);
  });

  it('blocks bid recommendations with relative or wrong-direction values before approval', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      actionType: 'lower_bid',
      currentValue: '1.20',
      recommendedValue: '-10%',
    }))).toContain('出价建议值必须是可执行的正数金额');

    expect(getRecommendationApprovalBlockers(recommendation({
      actionType: 'lower_bid',
      currentValue: '1.20',
      recommendedValue: '1.25',
    }))).toContain('降价动作的建议出价必须低于当前出价');

    expect(getRecommendationApprovalBlockers(recommendation({
      actionType: 'raise_bid',
      currentValue: '1.20',
      recommendedValue: '1.10',
    }))).toContain('提价动作的建议出价必须高于当前出价');
  });

  it('blocks recommendations when any source file is outside the current real-report gate', () => {
    const rec = recommendation({
      evidence: {
        ...recommendation().evidence,
        sourceFiles: [
          'C:/reports/current-user-search-term.xlsx',
          'C:/reports/stale-campaign.xlsx',
        ],
      },
    });

    const blockers = getRecommendationApprovalBlockers(rec, {
      allowedSourceFiles: ['C:/reports/current-user-search-term.xlsx'],
    });

    expect(blockers).toContain('来源文件不属于当前数据批次真实报表');
  });

  it('blocks insight-only or AI sourced recommendations without checkable AI evidence refs', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiInsightOnly: true,
        decisionAgreement: 'aligned',
      },
    }))).toContain('AI 洞察未进入正式建议池');

    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiEvidenceRefs: [],
        decisionAgreement: 'aligned',
      },
    }))).toContain('AI 建议缺少可回查证据引用');
  });

  it('does not block rule-only recommendations that only carry batch-level AI strategy context', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiStrategySummary: 'AI ran batch-level diagnosis but did not produce this action.',
        decisionAgreement: 'rule_only',
      },
    }))).not.toContain('AI 建议缺少可回查证据引用');
  });

  it('does not block rule-only recommendations when only batch-level AI lifecycle requires review', () => {
    expect(getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        decisionAgreement: 'rule_only',
        aiLifecycleStageRequiresReview: true,
        aiLifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
      },
    }))).not.toContain('AI 阶段判断需要人工复核');
  });

  it('blocks AI sourced recommendations whose evidence refs are not resolved into evidence details', () => {
    const blockers = getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiEvidenceRefs: ['metric:batch_1:search_term:abc'],
        aiEvidenceDetails: [],
        decisionAgreement: 'aligned',
      },
    }));

    expect(blockers).toContain('AI 建议缺少可展示的证据详情');
  });

  it('blocks recommendations whose AI lifecycle stage requires review', () => {
    const blockers = getRecommendationApprovalBlockers(recommendation({
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiLifecycleStageRequiresReview: true,
        aiLifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
        decisionAgreement: 'aligned',
      },
    }));

    expect(blockers).toContain('AI 阶段判断需要人工复核');
  });

  it('blocks rule quantification review and forbidden/high risk recommendations', () => {
    expect(() => assertRecommendationApprovalPolicy(recommendation({
      evidence: { ...recommendation().evidence, quantReviewRequired: true },
    }))).toThrow(/规则量化要求人工复核/);

    expect(() => assertRecommendationApprovalPolicy(recommendation({
      riskLevel: 'FORBIDDEN',
    }))).toThrow(/高风险或禁止执行风险等级/);
  });
});
