import { describe, expect, it } from 'vitest';
import {
  generateAiStatus,
  generateDecisionDiagnosticLine,
  emptyRecommendationReason,
  recommendationStatusFiltersForPage,
  recommendationCanEnterFormalApproval,
  recommendationHasEvidenceBlocker,
  recommendationMatchesBucketFilter,
  recommendationNeedsOperatorResolution,
  recommendationMergeSummaryText,
  recommendationBatchSelectionState,
  recommendationPrimaryTaskActionState,
  recommendationReviewExplanationText,
  recommendationWorkflowActionState,
  thresholdSuggestionSummary,
} from './recommendations-page';

function summary(overrides: Record<string, unknown>) {
  return {
    generated: 0,
    metrics: 0,
    candidates: 0,
    skipped: 0,
    refreshed: 0,
    configured: true,
    invoked: true,
    aiCount: 0,
    ruleCount: 0,
    reason: '',
    aiCandidateCount: 0,
    finalActionCount: 0,
    ...overrides,
  };
}

describe('generateAiStatus', () => {
  it('shows explicit fallback reason in operator-facing Chinese instead of a vague no-output status', () => {
    expect(generateAiStatus(summary({
      strategy: {
        source: 'rule',
        fallbackReason: 'AI 返回的自然语言字段不是简体中文。',
      },
    }))).toBe('AI 已转为规则兜底：AI 返回的自然语言字段不是简体中文。');
  });

  it('distinguishes insight-only output from no usable AI output', () => {
    expect(generateAiStatus(summary({
      strategy: {
        source: 'rule',
        aiInsights: [{ invalidReasons: ['缺少可回查证据'] }],
      },
    }))).toBe('AI 仅作洞察');
  });

  it('explains refreshed incomplete duplicates as actionable instead of no new output', () => {
    const reason = emptyRecommendationReason(true, summary({
      generated: 0,
      candidates: 2,
      refreshed: 1,
      finalActionCount: 1,
    }) as any, {
      status: 'available',
    } as any, []);

    expect(reason.title).toBe('已刷新历史不完整建议');
    expect(reason.detail).toContain('1 条旧建议已补齐');
  });
});

describe('generateDecisionDiagnosticLine', () => {
  it('uses operator-facing labels for rule-only and AI-only decision counts', () => {
    const line = generateDecisionDiagnosticLine(summary({
      strategy: {
        decisionCounts: {
          aligned: 1,
          ruleOnly: 2,
          aiOnly: 3,
          conflict: 4,
          reviewRequired: 5,
        },
      },
    }));

    expect(line).toContain('规则独立 2');
    expect(line).toContain('AI 独立洞察 3');
    expect(line).not.toContain('规则-only');
    expect(line).not.toContain('AI-only');
  });
});

describe('emptyRecommendationReason', () => {
  it('explains AI insight-only output as evidence/action binding work instead of generic no-output', () => {
    const reason = emptyRecommendationReason(true, summary({
      generated: 0,
      candidates: 0,
      aiCandidateCount: 2,
      finalActionCount: 0,
      reason: 'AI 返回洞察，但没有形成正式动作。',
      strategy: {
        source: 'ai',
        aiInsights: [{
          entityName: 'smart lock',
          invalidReasons: ['AI 候选动作缺少可回查证据引用。'],
        }],
        filterReasons: ['AI 候选无法绑定当前广告活动/广告组/关键词。'],
      },
    }) as any, {
      status: 'available',
      label: 'AI 可用',
      tone: 'ready',
      message: '',
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com',
    }, []);

    expect(reason.title).toBe('AI 仅生成洞察，未进入建议池');
    expect(reason.detail).toContain('AI 返回 2 条候选');
    expect(reason.detail).toContain('AI 候选动作缺少可回查证据引用');
    expect(reason.detail).toContain('AI 候选无法绑定当前广告活动/广告组/关键词');
    expect(reason.nextStep).toContain('补齐证据');
    expect(reason.nextStep).toContain('广告活动/广告组/关键词');
    expect(`${reason.detail} ${reason.nextStep}`).not.toContain('campaign/ad group');
  });
});

describe('recommendationStatusFiltersForPage', () => {
  it('loads both formal pending recommendations and review queue recommendations', () => {
    expect(recommendationStatusFiltersForPage()).toEqual(['pending', 'needs_review']);
  });
});

describe('recommendation operator copy', () => {
  it('does not expose raw merge or status enum names in review guidance', () => {
    const copy = [
      recommendationReviewExplanationText(),
      recommendationMergeSummaryText({ aligned: 2, conflict: 1, aiOnly: 3 }),
    ].join('\n');

    expect(copy).toContain('AI 独立洞察');
    expect(copy).toContain('复核队列');
    expect(copy).not.toContain('AI-only');
    expect(copy).not.toContain('needs_review');
    expect(copy).not.toContain('ai_only');
  });
});

describe('recommendation evidence gate', () => {
  it('blocks formal approval when AI evidence refs have no displayable details', () => {
    const recommendation = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        date: '2026-06-12',
        sourceFiles: ['C:/reports/user_search_term.xlsx'],
        sourceRow: 12,
        campaignName: 'SP exact',
        adGroupName: 'Main',
        searchTerm: 'smart lock',
        aiStrategySource: 'ai',
        decisionAgreement: 'aligned',
        aiEvidenceRefs: ['metric:batch_1:user_search_term:2026-06-12:search_term:abc'],
        aiEvidenceDetails: [],
      },
    } as any;

    expect(recommendationHasEvidenceBlocker(recommendation, 'batch_1')).toBe(true);
    expect(recommendationCanEnterFormalApproval(recommendation, 'batch_1')).toBe(false);
  });

  it('does not block rule-only recommendations just because an AI strategy diagnosis ran for the batch', () => {
    const recommendation = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        date: '2026-06-12',
        sourceFiles: ['C:/reports/user_search_term.xlsx'],
        sourceRow: 12,
        campaignName: 'SP exact',
        adGroupName: 'Main',
        searchTerm: 'smart lock',
        decisionAgreement: 'rule_only',
        aiStrategySource: 'ai',
        aiStrategySummary: 'AI ran batch-level diagnosis but did not produce this action.',
      },
    } as any;

    expect(recommendationHasEvidenceBlocker(recommendation, 'batch_1')).toBe(false);
    expect(recommendationCanEnterFormalApproval(recommendation, 'batch_1')).toBe(true);
  });

  it('does not block rule-only recommendations when only batch-level AI lifecycle requires review', () => {
    const recommendation = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        date: '2026-06-12',
        sourceFiles: ['C:/reports/user_search_term.xlsx'],
        sourceRow: 12,
        campaignName: 'SP exact',
        adGroupName: 'Main',
        searchTerm: 'smart lock',
        decisionAgreement: 'rule_only',
        aiStrategySource: 'ai',
        aiLifecycleStageRequiresReview: true,
        aiLifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
      },
    } as any;

    expect(recommendationHasEvidenceBlocker(recommendation, 'batch_1')).toBe(false);
    expect(recommendationCanEnterFormalApproval(recommendation, 'batch_1')).toBe(true);
  });

  it('blocks formal approval when AI lifecycle stage requires review', () => {
    const recommendation = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        date: '2026-06-12',
        sourceFiles: ['C:/reports/user_search_term.xlsx'],
        sourceRow: 12,
        campaignName: 'SP exact',
        adGroupName: 'Main',
        searchTerm: 'smart lock',
        aiStrategySource: 'ai',
        decisionAgreement: 'aligned',
        aiLifecycleStageRequiresReview: true,
        aiLifecycleStageInvalidReasons: ['AI 阶段判断引用了不可用证据：missing_ref。'],
      },
    } as any;

    expect(recommendationHasEvidenceBlocker(recommendation, 'batch_1')).toBe(true);
    expect(recommendationCanEnterFormalApproval(recommendation, 'batch_1')).toBe(false);
  });

  it('blocks formal approval when current batch real report files are not loaded', () => {
    const recommendation = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        date: '2026-06-12',
        sourceFiles: ['C:/reports/user_search_term.xlsx'],
        sourceRow: 12,
        campaignName: 'SP exact',
        adGroupName: 'Main',
        searchTerm: 'smart lock',
        decisionAgreement: 'rule_only',
      },
    } as any;

    expect(recommendationHasEvidenceBlocker(recommendation, 'batch_1', [])).toBe(true);
    expect(recommendationCanEnterFormalApproval(recommendation, 'batch_1', [])).toBe(false);
  });

  it('blocks stale historical recommendations without an original report source row', () => {
    const recommendation = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        date: '2026-06-12',
        sourceFiles: ['C:/reports/user_search_term.xlsx'],
        campaignName: 'SP exact',
        adGroupName: 'Main',
        searchTerm: 'smart lock',
        decisionAgreement: 'rule_only',
      },
    } as any;

    expect(recommendationHasEvidenceBlocker(recommendation, 'batch_1')).toBe(true);
    expect(recommendationCanEnterFormalApproval(recommendation, 'batch_1')).toBe(false);
  });

  it('blocks stale historical recommendations whose source files are not real spreadsheet reports', () => {
    const recommendation = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        date: '2026-06-12',
        sourceFiles: ['C:/reports/acceptance-audit.json'],
        sourceRow: 12,
        campaignName: 'SP exact',
        adGroupName: 'Main',
        searchTerm: 'smart lock',
        decisionAgreement: 'rule_only',
      },
    } as any;

    expect(recommendationHasEvidenceBlocker(recommendation, 'batch_1')).toBe(true);
    expect(recommendationCanEnterFormalApproval(recommendation, 'batch_1')).toBe(false);
  });

  it('counts AI-only review and evidence blockers as operator resolution work', () => {
    const baseEvidence = {
      batchId: 'batch_1',
      date: '2026-06-12',
      sourceFiles: ['C:/reports/user_search_term.xlsx'],
      sourceRow: 12,
      campaignName: 'SP exact',
      adGroupName: 'Main',
      searchTerm: 'smart lock',
    };
    const aiOnly = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        ...baseEvidence,
        decisionAgreement: 'ai_only',
      },
    } as any;
    const evidenceBlocked = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        ...baseEvidence,
        sourceFiles: [],
        decisionAgreement: 'rule_only',
      },
    } as any;
    const formalRule = {
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        ...baseEvidence,
        decisionAgreement: 'rule_only',
      },
    } as any;

    expect([aiOnly, evidenceBlocked, formalRule].filter((item) => recommendationNeedsOperatorResolution(item, 'batch_1'))).toHaveLength(2);
    expect(recommendationCanEnterFormalApproval(formalRule, 'batch_1')).toBe(true);
  });
});

describe('recommendationMatchesBucketFilter', () => {
  function recommendation(overrides: Record<string, unknown> = {}) {
    return {
      id: String(overrides.id || 'rec_1'),
      status: 'pending',
      entityName: 'smart lock',
      currentValue: '1.20',
      recommendedValue: '1.08',
      evidence: {
        batchId: 'batch_1',
        date: '2026-06-12',
        sourceFiles: ['C:/reports/user_search_term.xlsx'],
        sourceRow: 12,
        campaignName: 'SP exact',
        adGroupName: 'Main',
        searchTerm: 'smart lock',
        decisionAgreement: 'rule_only',
      },
      ...overrides,
    } as any;
  }

  it('keeps all recommendations visible in the all bucket', () => {
    expect([
      recommendation({ id: 'ready' }),
      recommendation({ id: 'review', evidence: { ...recommendation().evidence, decisionAgreement: 'ai_only' } }),
      recommendation({ id: 'blocked', evidence: { ...recommendation().evidence, sourceFiles: [] } }),
    ].filter((item) => recommendationMatchesBucketFilter(item, 'all', 'batch_1')).map((item) => item.id)).toEqual([
      'ready',
      'review',
      'blocked',
    ]);
  });

  it('separates evidence blockers from manual-review rows', () => {
    const ready = recommendation({ id: 'ready' });
    const review = recommendation({
      id: 'review',
      evidence: { ...recommendation().evidence, decisionAgreement: 'ai_only' },
    });
    const blocked = recommendation({
      id: 'blocked',
      evidence: { ...recommendation().evidence, sourceFiles: [] },
    });
    const rows = [ready, review, blocked];

    expect(rows.filter((item) => recommendationMatchesBucketFilter(item, 'blocked', 'batch_1')).map((item) => item.id)).toEqual(['blocked']);
    expect(rows.filter((item) => recommendationMatchesBucketFilter(item, 'review', 'batch_1')).map((item) => item.id)).toEqual(['review']);
    expect(rows.filter((item) => recommendationMatchesBucketFilter(item, 'ready', 'batch_1')).map((item) => item.id)).toEqual(['ready']);
  });

  it('uses current source-file membership for ready bucket filtering', () => {
    const ready = recommendation({ id: 'ready' });
    const stale = recommendation({ id: 'stale' });

    expect([ready, stale].filter((item) => recommendationMatchesBucketFilter(item, 'ready', 'batch_1', ['C:/reports/user_search_term.xlsx'])).map((item) => item.id)).toEqual([
      'ready',
      'stale',
    ]);
    expect([ready, stale].filter((item) => recommendationMatchesBucketFilter(item, 'ready', 'batch_1', ['C:/reports/other.xlsx']))).toHaveLength(0);
  });
});

describe('recommendationWorkflowActionState', () => {
  it('does not route operators to approval or readback when all recommendations are review-only or evidence-blocked', () => {
    expect(recommendationWorkflowActionState({
      recommendationCount: 2,
      formalApprovalCount: 0,
      manualReviewCount: 1,
      evidenceBlockedCount: 1,
    })).toEqual({
      approvalDisabled: true,
      readbackDisabled: true,
      approvalLabel: '先处理复核/证据',
      readbackLabel: '等待可审批建议',
    });
  });

  it('allows approval but not readback when formal recommendations exist but none are approved yet', () => {
    expect(recommendationWorkflowActionState({
      recommendationCount: 2,
      formalApprovalCount: 1,
      manualReviewCount: 1,
      evidenceBlockedCount: 0,
    })).toMatchObject({
      approvalDisabled: false,
      readbackDisabled: true,
      approvalLabel: '去审批中心',
      readbackLabel: '审批后回读',
    });
  });
});

describe('recommendationPrimaryTaskActionState', () => {
  it('uses generation as the only primary action before a recommendation pool exists', () => {
    expect(recommendationPrimaryTaskActionState({
      quantReady: true,
      recommendationCount: 0,
      formalApprovalCount: 0,
      manualReviewCount: 0,
      evidenceBlockedCount: 0,
      realReportCount: 8,
      importedRowCount: 24,
      actionableMetricRows: 3,
    })).toMatchObject({
      label: '生成优化建议',
      action: 'generate',
      disabled: false,
    });
  });

  it('routes to approval center when formal recommendations exist', () => {
    expect(recommendationPrimaryTaskActionState({
      quantReady: true,
      recommendationCount: 3,
      formalApprovalCount: 1,
      manualReviewCount: 1,
      evidenceBlockedCount: 1,
      realReportCount: 8,
      importedRowCount: 24,
      actionableMetricRows: 3,
    })).toMatchObject({
      label: '去审批中心',
      action: 'navigate',
      route: 'approval',
      disabled: false,
    });
  });

  it('routes operators to evidence or review work when no recommendation can enter approval', () => {
    expect(recommendationPrimaryTaskActionState({
      quantReady: true,
      recommendationCount: 2,
      formalApprovalCount: 0,
      manualReviewCount: 1,
      evidenceBlockedCount: 1,
      realReportCount: 8,
      importedRowCount: 24,
      actionableMetricRows: 3,
    })).toMatchObject({
      label: '补齐证据或复核',
      action: 'navigate',
      route: 'ad-quant',
      disabled: false,
    });
  });

  it('keeps the same blocker label while routing missing real reports back to collection', () => {
    expect(recommendationPrimaryTaskActionState({
      quantReady: false,
      recommendationCount: 0,
      formalApprovalCount: 0,
      manualReviewCount: 0,
      evidenceBlockedCount: 0,
      realReportCount: 2,
      importedRowCount: 0,
      actionableMetricRows: 0,
    })).toMatchObject({
      label: '补齐证据或复核',
      action: 'navigate',
      route: 'data-collection',
      disabled: false,
    });
  });
});

describe('recommendationBatchSelectionState', () => {
  it('blocks batch handoff when no recommendation can enter formal approval', () => {
    expect(recommendationBatchSelectionState({
      selectableCount: 0,
      selectedCount: 0,
    })).toMatchObject({
      actionLabel: '等待可审批建议',
      disabled: true,
      tone: 'blocked',
    });
  });

  it('shows a disabled zero-selection action while selectable rows exist', () => {
    expect(recommendationBatchSelectionState({
      selectableCount: 4,
      selectedCount: 0,
    })).toMatchObject({
      actionLabel: '批量提交 0/4 项到审批中心',
      disabled: true,
      tone: 'pending',
    });
  });

  it('turns the primary batch action into a count-confirming approval handoff', () => {
    const state = recommendationBatchSelectionState({
      selectableCount: 4,
      selectedCount: 3,
    });

    expect(state).toMatchObject({
      actionLabel: '批量提交 3 项到审批中心',
      disabled: false,
      tone: 'ready',
    });
    expect(state.helperText).toContain('不执行广告动作');
  });
});

describe('thresholdSuggestionSummary', () => {
  it('marks AI dynamic thresholds as requiring review when validator flagged them', () => {
    const summaryText = thresholdSuggestionSummary({
      evidence: {
        aiThresholdSuggestions: {
          targetAcos: { value: 0.35, reason: '产品探索期', evidenceRefs: ['timeline_1'] },
          highAcosThreshold: {
            value: 0.5,
            reason: '缺少指标证据',
            evidenceRefs: ['event_1'],
            requiresReview: true,
            reviewReasons: ['AI 阈值建议缺少指标或对象时间线证据。'],
          },
        },
      },
    } as any);

    expect(summaryText).toContain('高 ACOS 50.0%');
    expect(summaryText).toContain('需复核');
    expect(summaryText).toContain('AI 阈值建议缺少指标或对象时间线证据');
  });
});
