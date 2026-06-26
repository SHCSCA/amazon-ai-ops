import { describe, expect, it } from 'vitest';
import type { RecommendationView } from '../types';
import { aiThresholdSummary, approvalBlockers, approvalDecisionState, approvalMissing, approvalQueueRowClass, approvalRowsAfterDecision, approvalSubmitBlockers, buildApprovalDecisionPayload, buildApprovalStampFeedback, parseApprovalSelectionIntent, strategyLabel } from './approval-page';

function recommendation(sourceRow: number | undefined = 12, sourceFiles = ['C:/reports/user-search-term.xlsx']): RecommendationView {
  return {
    id: 101,
    actionType: 'lower_bid',
    entityType: 'target',
    entityName: 'tight match target',
    currentValue: '1.20',
    recommendedValue: '1.08',
    reason: 'High ACOS',
    acos: 0.72,
    clicks: 32,
    cost: 42.18,
    riskLevel: 'APPROVAL',
    status: 'pending',
    confidence: 0.8,
    evidence: {
      batchId: 'batch_1',
      date: '2026-06-12',
      campaignName: 'D6-auto-test',
      adGroupName: 'D6-ad-group',
      asin: 'B0TESTASIN',
      targeting: 'tight match target',
      sourceFiles,
      sourceRow,
    },
  };
}

describe('approvalMissing', () => {
  it('does not mark complete recommendations as missing approval source fields', () => {
    expect(approvalMissing(recommendation(), {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    }, 'batch_1')).toEqual([]);
  });

  it('requires source row to be a positive original report row number', () => {
    expect(approvalMissing(recommendation(-1), {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    }, 'batch_1')).toContain('来源行号');
  });

  it('requires source files to be real report spreadsheets', () => {
    expect(approvalMissing(recommendation(12, ['C:/reports/acceptance-audit.json']), {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    }, 'batch_1')).toContain('真实来源报表');
  });

  it('requires every source file to belong to the current real-report scope when provided', () => {
    expect(approvalMissing(recommendation(12, [
      'C:/reports/current-user-search-term.xlsx',
      'C:/reports/stale-campaign.xlsx',
    ]), {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    }, 'batch_1', ['C:/reports/current-user-search-term.xlsx'])).toContain('来源文件不属于当前数据批次真实报表');
  });

  it('requires recommendations to be bound to a concrete product ASIN before approval', () => {
    expect(approvalMissing({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        asin: '',
      },
    }, {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    }, 'batch_1')).toContain('ASIN');
  });
});

describe('approvalBlockers', () => {
  it('blocks AI-only and insight-only recommendations from normal approval', () => {
    const aiOnlyBlockers = approvalBlockers({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        decisionAgreement: 'ai_only',
      },
    });

    expect(aiOnlyBlockers).toContain('AI 独立洞察不能直接批准');
    expect(aiOnlyBlockers.join('\n')).not.toContain('AI-only');

    expect(approvalBlockers({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        aiInsightOnly: true,
      },
    })).toContain('该建议缺少 AI 可回查证据，仅作为洞察展示，不能审批');
  });

  it('describes needs-review recommendations as a general review queue, not only AI review', () => {
    const blockers = approvalBlockers({
      ...recommendation(),
      status: 'needs_review',
      evidence: {
        ...recommendation().evidence,
        quantReviewRequired: true,
      },
    });

    expect(blockers).toContain('建议已进入复核队列');
    expect(blockers.join('\n')).not.toContain('AI 复核队列');
  });

  it('blocks AI-sourced recommendations that have no checkable AI evidence refs', () => {
    expect(approvalBlockers({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        decisionAgreement: 'aligned',
        aiEvidenceRefs: [],
      },
    })).toContain('AI 建议缺少可回查证据引用');
  });

  it('does not block rule-only recommendations that only carry batch-level AI strategy context', () => {
    expect(approvalBlockers({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiStrategySummary: 'AI ran batch-level diagnosis but did not produce this action.',
        decisionAgreement: 'rule_only',
      },
    })).not.toContain('AI 建议缺少可回查证据引用');
  });

  it('does not block rule-only recommendations when only batch-level AI lifecycle requires review', () => {
    const blockers = approvalBlockers({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        decisionAgreement: 'rule_only',
        aiLifecycleStageRequiresReview: true,
        aiLifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
      },
    });

    expect(blockers).not.toContain('AI 阶段判断需要人工复核');
  });

  it('blocks AI-sourced recommendations whose evidence refs have no displayable details', () => {
    expect(approvalBlockers({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        decisionAgreement: 'aligned',
        aiEvidenceRefs: ['metric:batch_1:search_term:abc'],
        aiEvidenceDetails: [],
      },
    })).toContain('AI 建议缺少可展示的证据详情');
  });

  it('blocks recommendations whose AI lifecycle stage requires review', () => {
    const blockers = approvalBlockers({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'ai',
        aiLifecycleStageRequiresReview: true,
        aiLifecycleStageInvalidReasons: [
          'AI 阶段判断引用的指标证据缺少产品 ASIN。',
          'AI 阶段判断引用了不可用证据：missing_ref。',
        ],
        decisionAgreement: 'aligned',
      },
    });

    expect(blockers).toContain('AI 阶段判断需要人工复核');
    expect(blockers).toContain('AI 阶段判断引用的指标证据缺少产品 ASIN。');
    expect(blockers).toContain('AI 阶段判断引用了不可用证据：missing_ref。');
  });

  it('blocks bid actions with relative or wrong-direction values in the UI before submit', () => {
    expect(approvalBlockers({
      ...recommendation(),
      actionType: 'lower_bid',
      currentValue: '1.20',
      recommendedValue: '-10%',
    })).toContain('出价建议值必须是可执行的正数金额');

    expect(approvalBlockers({
      ...recommendation(),
      actionType: 'lower_bid',
      currentValue: '1.20',
      recommendedValue: '1.25',
    })).toContain('降价动作的建议出价必须低于当前出价');

    expect(approvalBlockers({
      ...recommendation(),
      actionType: 'raise_bid',
      currentValue: '1.20',
      recommendedValue: '1.10',
    })).toContain('提价动作的建议出价必须高于当前出价');
  });
});

describe('strategyLabel', () => {
  it('uses Chinese fallback copy for rule strategy labels', () => {
    expect(strategyLabel({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        aiStrategySource: 'rule',
      },
    })).toBe('规则策略兜底');
  });
});

describe('approvalSubmitBlockers', () => {
  it('uses missing approval evidence and policy blockers as the same disable condition as submit', () => {
    const blockers = approvalSubmitBlockers(
      recommendation(12, ['C:/reports/stale-user-search-term.xlsx']),
      { storeName: 'FT-US-US', marketplaceCode: 'US' },
      'batch_1',
      ['C:/reports/current-user-search-term.xlsx'],
    );

    expect(blockers).toContain('来源文件不属于当前数据批次真实报表');
  });

  it('blocks approval when current batch real report files have not loaded', () => {
    const blockers = approvalSubmitBlockers(
      recommendation(),
      { storeName: 'FT-US-US', marketplaceCode: 'US' },
      'batch_1',
      [],
    );

    expect(blockers).toContain('当前批次真实报表文件未加载');
  });

  it('keeps complete current-scope recommendations approvable', () => {
    expect(approvalSubmitBlockers(
      recommendation(),
      { storeName: 'FT-US-US', marketplaceCode: 'US' },
      'batch_1',
      ['C:/reports/user-search-term.xlsx'],
    )).toEqual([]);
  });
});

describe('approvalDecisionState', () => {
  it('uses the compact approvable state when no evidence or policy blocker exists', () => {
    expect(approvalDecisionState({
      selected: recommendation(),
      missing: [],
      blockers: [],
    })).toMatchObject({
      statusLabel: '可以批准',
      canApprove: true,
      tone: 'ready',
    });
  });

  it('uses the cannot-normal-approve state when required approval evidence is missing', () => {
    const selected = recommendation(-1);
    expect(approvalDecisionState({
      selected,
      missing: approvalMissing(selected, {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
      }, 'batch_1'),
      blockers: approvalBlockers(selected),
    })).toMatchObject({
      statusLabel: '不能普通批准',
      canApprove: false,
      tone: 'blocked',
    });
  });

  it('uses the review state for AI and rule conflicts', () => {
    const selected = {
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        decisionAgreement: 'conflict' as const,
      },
    };

    expect(approvalDecisionState({
      selected,
      missing: approvalMissing(selected, {
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
      }, 'batch_1'),
      blockers: approvalBlockers(selected),
    })).toMatchObject({
      statusLabel: '需要复核',
      canApprove: false,
      tone: 'warning',
    });
  });
});

describe('buildApprovalStampFeedback', () => {
  it('builds an immediate pending stamp while approval is being written', () => {
    expect(buildApprovalStampFeedback({
      state: 'approving',
      recommendationId: 101,
      targetName: 'door lock',
    })).toMatchObject({
      label: 'SEALING',
      title: '正在建立审批契约 #101',
      tone: 'pending',
    });
  });

  it('builds a passed stamp that routes the operator to readback instead of implying execution', () => {
    const feedback = buildApprovalStampFeedback({
      state: 'approved',
      recommendationId: 101,
      targetName: 'door lock',
    });

    expect(feedback).toMatchObject({
      label: 'PASSED',
      title: '审批已通过 #101',
      tone: 'ready',
    });
    expect(feedback.detail).toContain('执行回读');
  });

  it('builds a rejected stamp for blocked decisions', () => {
    expect(buildApprovalStampFeedback({
      state: 'rejected',
      recommendationId: 101,
      message: '已拒绝建议 #101，拒绝原因已写入建议证据：风险过高',
    })).toMatchObject({
      label: 'REJECTED',
      title: '建议已拦截 #101',
      detail: '已拒绝建议 #101，拒绝原因已写入建议证据：风险过高',
      tone: 'blocked',
    });
  });

  it('builds a blocked stamp when approval preconditions are missing', () => {
    expect(buildApprovalStampFeedback({
      state: 'blocked',
      recommendationId: 101,
      message: '批准前必须填写审批人。',
    })).toMatchObject({
      label: 'BLOCKED',
      title: '审批被阻断 #101',
      detail: '批准前必须填写审批人。',
      tone: 'blocked',
    });
  });
});

describe('parseApprovalSelectionIntent', () => {
  it('normalizes batch handoff ids from recommendation selection', () => {
    expect(parseApprovalSelectionIntent({
      ids: [101, '102', '102', '', null],
      count: 4,
      batchId: 'batch_1',
    })).toEqual({
      ids: ['101', '102'],
      count: 4,
      batchId: 'batch_1',
    });
  });

  it('rejects empty or malformed handoff payloads', () => {
    expect(parseApprovalSelectionIntent(null)).toBeNull();
    expect(parseApprovalSelectionIntent({ ids: [] })).toBeNull();
    expect(parseApprovalSelectionIntent({ ids: [''] })).toBeNull();
  });
});

describe('approval queue optimistic exit', () => {
  it('removes a decided recommendation from the current local queue', () => {
    const rows = [
      recommendation(),
      { ...recommendation(), id: 102, entityName: 'second target' },
    ];

    expect(approvalRowsAfterDecision(rows, 101).map((row) => row.id)).toEqual([102]);
    expect(approvalRowsAfterDecision(rows, 999).map((row) => row.id)).toEqual([101, 102]);
  });

  it('marks only the decided row with a tone-specific exit class', () => {
    const rows = [
      recommendation(),
      { ...recommendation(), id: 102, entityName: 'second target' },
    ];

    expect(approvalQueueRowClass(rows[0], { id: 101, decision: 'approved' })).toBe('approval-row-exiting approval-row-exiting-approved');
    expect(approvalQueueRowClass(rows[1], { id: 101, decision: 'approved' })).toBe('');
    expect(approvalQueueRowClass(rows[0], { id: 101, decision: 'rejected' })).toBe('approval-row-exiting approval-row-exiting-rejected');
  });
});

describe('aiThresholdSummary', () => {
  it('marks AI dynamic thresholds as requiring review when validator flagged them', () => {
    const summaryText = aiThresholdSummary({
      ...recommendation(),
      evidence: {
        ...recommendation().evidence,
        aiThresholdSuggestions: {
          targetAcos: { value: 0.35, reason: '产品探索期', evidenceRefs: ['timeline_1'] },
          minSpend: {
            value: 10,
            reason: '缺少证据',
            evidenceRefs: ['missing_ref'],
            requiresReview: true,
            reviewReasons: ['AI 阈值建议引用了不可用证据：missing_ref。'],
          },
        },
      },
    } as any);

    expect(summaryText).toContain('最低花费 $10.00');
    expect(summaryText).toContain('需复核');
    expect(summaryText).toContain('missing_ref');
  });
});

describe('buildApprovalDecisionPayload', () => {
  it('preserves separated AI fallback reasons in approval decision records', () => {
    const payload = buildApprovalDecisionPayload({
      decision: 'approved',
      approverName: 'Ops Lead',
      approvalNote: 'Approved for one target only.',
      currentBatchId: 'batch_1',
      selected: {
        ...recommendation(),
        evidence: {
          ...recommendation().evidence,
          aiStrategyFallbackReason: 'AI 策略诊断 schemaVersion 错误，已回退规则。',
          aiActionFallbackReason: 'AI 单条解释无法解析 JSON，使用规则解释。',
        },
      },
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
      },
    });

    expect(payload.aiStrategyFallbackReason).toBe('AI 策略诊断 schemaVersion 错误，已回退规则。');
    expect(payload.aiActionFallbackReason).toBe('AI 单条解释无法解析 JSON，使用规则解释。');
  });
});
