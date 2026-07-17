import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AiDiagnosisRunView, BusinessQuantDiagnostic, BusinessQuantTimeline } from '../types';
import { adQuantActionButtonView, adQuantBlockerDetail, adQuantDiagnosticMatchesFocus, adQuantFocusLabel, adQuantScopeKey, adQuantTimelineMatchesFocus, buildAdQuantDecisionStatus, buildAiDiagnosisRunsRequest, buildQuantAccountingLine, buildStrategyRunFeedback, buildWasteRiskSpendTile, createAdQuantScopeRequestGate, diagnosisRunEvidenceLabel, diagnosisRunInsightPreview, diagnosisRunSummaryText, diagnosisTimelineMatchesDiagnostic, runAdQuantDiagnosisWorkflowMutation, strategyDiagnosisSourceLabel, strategyThresholdTitle, thresholdEvidenceReviewLine } from './ad-quant-page';
import { subscribeWorkflowInvalidation } from '../workflow-invalidation';

describe('ad quant workflow invalidation contract', () => {
  it('invalidates workflow evidence after a successful diagnosis mutation', async () => {
    const target = new EventTarget();
    const sources: string[] = [];
    const unsubscribe = subscribeWorkflowInvalidation((detail) => sources.push(detail.source), target);

    await expect(runAdQuantDiagnosisWorkflowMutation(async () => 'diagnosed', target)).resolves.toBe('diagnosed');
    expect(sources).toEqual(['ad-quant-diagnosis']);
    unsubscribe();
  });
});

describe('ad quant async scope authority', () => {
  it('publishes only the latest request for the currently active scope', () => {
    const gate = createAdQuantScopeRequestGate();
    const scopeA = adQuantScopeKey({
      dateFrom: '2026-06-01', dateTo: '2026-06-07', storeName: 'A', marketplaceCode: 'US', asin: 'B0AAA', batchId: 'batch-a',
    });
    const scopeB = adQuantScopeKey({
      dateFrom: '2026-06-08', dateTo: '2026-06-14', storeName: 'B', marketplaceCode: 'US', asin: 'B0BBB', batchId: 'batch-b',
    });

    gate.activate(scopeA);
    const firstA = gate.begin(scopeA);
    const secondA = gate.begin(scopeA);
    expect(gate.isCurrent(firstA)).toBe(false);
    expect(gate.isCurrent(secondA)).toBe(true);

    gate.activate(scopeB);
    expect(gate.isCurrent(secondA)).toBe(false);
    expect(gate.isCurrent(gate.begin(scopeA))).toBe(false);

    const currentB = gate.begin(scopeB);
    expect(gate.isCurrent(currentB)).toBe(true);
  });
});

describe('strategyDiagnosisSourceLabel', () => {
  it('uses Chinese fallback copy for rule-based strategy diagnosis', () => {
    expect(strategyDiagnosisSourceLabel('rule')).toBe('规则兜底');
    expect(strategyThresholdTitle('rule')).toBe('规则兜底阈值建议');
  });
});

describe('buildAiDiagnosisRunsRequest', () => {
  it('carries ASIN scope when loading recent AI diagnosis runs', () => {
    expect(buildAiDiagnosisRunsRequest({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0AAA',
        batchId: '',
        currency: 'USD',
      },
      latestBatchId: 'batch_1',
    })).toMatchObject({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0AAA',
      batchId: 'batch_1',
      limit: 5,
    });
  });
});

describe('diagnosisRunEvidenceLabel', () => {
  it('labels historical AI diagnosis evidence as evidence-pack count', () => {
    expect(diagnosisRunEvidenceLabel({
      evidencePackSummary: { total: 5 },
    } as AiDiagnosisRunView)).toBe('证据包 5 条');
  });

  it('keeps empty evidence packs explicit', () => {
    expect(diagnosisRunEvidenceLabel({} as AiDiagnosisRunView)).toBe('证据包 0 条');
  });
});

describe('diagnosisRunSummaryText', () => {
  it('explains insight-only AI runs instead of showing no diagnosis output', () => {
    const text = diagnosisRunSummaryText({
      id: 1,
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'v1',
      model: 'deepseek-v4-flash',
      scope: {},
      insights: [{
        entityType: 'search_term',
        entityName: 'door lock',
        actionType: 'lower_bid',
        reason: 'AI 判断 ACOS 偏高，但缺少可回查来源行。',
        reasoningSteps: [],
        evidenceRefs: [],
        invalidReasons: ['缺少 source row'],
        riskWarnings: [],
        confidence: 0.71,
      }],
      formalRecommendationCount: 0,
      createdAt: '2026-06-17T10:00:00.000Z',
    } as AiDiagnosisRunView);

    expect(text).toContain('AI 已完成诊断');
    expect(text).toContain('1 条洞察');
    expect(text).toContain('未形成可审批建议');
    expect(text).toContain('先补齐证据引用');
  });
});

describe('diagnosisRunInsightPreview', () => {
  it('summarizes the insight object and invalid reason for review', () => {
    const lines = diagnosisRunInsightPreview({
      id: 1,
      promptKey: 'ad_strategy_diagnosis',
      promptVersion: 'v1',
      model: 'deepseek-v4-flash',
      scope: {},
      insights: [{
        entityType: 'search_term',
        entityName: 'door lock',
        actionType: 'lower_bid',
        reason: 'ACOS 偏高。',
        reasoningSteps: [],
        evidenceRefs: ['metric:1'],
        invalidReasons: ['无法绑定当前广告组'],
        riskWarnings: [],
        confidence: 0.71,
      }],
      formalRecommendationCount: 0,
      createdAt: '2026-06-17T10:00:00.000Z',
    } as AiDiagnosisRunView);

    expect(lines).toEqual([
      'search_term / lower_bid / door lock：无法绑定当前广告组',
    ]);
  });
});

describe('thresholdEvidenceReviewLine', () => {
  it('requires review when threshold evidence refs have no displayable details', () => {
    const result = thresholdEvidenceReviewLine({
      item: {
        value: 0.35,
        reason: 'AI 建议目标 ACOS。',
        evidenceRefs: ['metric_missing'],
      },
      evidencePackPreview: [],
    });

    expect(result.tone).toBe('warning');
    expect(result.text).toContain('缺少证据明细：metric_missing');
    expect(result.text).toContain('需要人工复核后才能覆盖规则阈值');
  });

  it('uses operator-facing wording for technical evidence ref errors', () => {
    const result = thresholdEvidenceReviewLine({
      item: {
        value: 0.35,
        reason: 'AI 建议目标 ACOS。',
        evidenceRefs: [],
        requiresReview: true,
        reviewReasons: ['AI 阈值建议缺少 evidenceRefs。'],
      },
      evidencePackPreview: [],
    });

    expect(result.text).toContain('AI 阈值建议没有正确引用当前证据');
    expect(result.text).not.toContain('evidenceRefs');
  });
});

describe('buildStrategyRunFeedback', () => {
  it('routes complete report files with partial per-type imports to import validation', () => {
    const feedback = buildStrategyRunFeedback({
      canDiagnose: false,
      loading: false,
      realReportCount: 8,
      importedReportTypeCount: 5,
      requiredReportCount: 8,
    });

    expect(feedback.detail).toContain('逐类入库 5/8');
    expect(feedback.primaryAction).toEqual({
      label: '补齐逐类入库',
      target: 'data-import-validation',
    });
  });

  it('shows an explicit running state while AI diagnosis is pending', () => {
    const feedback = buildStrategyRunFeedback({
      canDiagnose: true,
      loading: true,
    });

    expect(feedback.title).toBe('AI 阶段分析运行中');
    expect(feedback.statusLabel).toBe('运行中');
    expect(feedback.detail).toContain('完成或失败都会在这里显示');
    expect(feedback).toMatchObject({
      ariaBusy: true,
      radarVisible: true,
    });
    expect(feedback.className).toContain('ad-quant-strategy-feedback-running');

    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.ad-quant-strategy-radar');
    expect(css).toContain('@keyframes ad-quant-radar-sweep');
    expect(css).toContain('@keyframes ad-quant-radar-pulse');
  });

  it('shows rule fallback as a completed AI run with a clear reason', () => {
    const feedback = buildStrategyRunFeedback({
      canDiagnose: true,
      loading: false,
      lastRunAt: '2026-06-25T10:30:00.000Z',
      diagnosis: {
        configured: true,
        invoked: true,
        model: 'deepseek-v4-flash',
        metrics: 100,
        ruleCandidateCount: 2,
        summary: {
          source: 'rule',
          lifecycleStage: 'unknown',
          summary: '',
          lifecycleStageReason: '',
          lifecycleStageEvidenceRefs: [],
          mainProblems: [],
          riskWarnings: [],
          thresholdSuggestions: {
            targetAcos: { value: 0.25, reason: '', evidenceRefs: [] },
            highAcosThreshold: { value: 0.4, reason: '', evidenceRefs: [] },
            noOrderClickThreshold: { value: 30, reason: '', evidenceRefs: [] },
            minSpend: { value: 10, reason: '', evidenceRefs: [] },
          },
          aiCandidateCount: 0,
          operationEventCount: 0,
          productContextCount: 0,
          fallbackReason: 'AI 阶段判断缺少 evidenceRefs。',
        },
      },
    });

    expect(feedback.title).toContain('规则兜底');
    expect(feedback.statusLabel).toBe('规则兜底');
    expect(feedback.detail).toContain('没有正确引用当前证据');
    expect(feedback.detail).toContain('2026-06-25 10:30');
  });

  it('turns JSON contract fallback into a retryable AI feedback state', () => {
    const feedback = buildStrategyRunFeedback({
      canDiagnose: true,
      loading: false,
      lastRunAt: '2026-06-25T10:30:00.000Z',
      diagnosis: {
        configured: true,
        invoked: true,
        model: 'deepseek-v4-flash',
        metrics: 129,
        ruleCandidateCount: 3,
        summary: {
          source: 'rule',
          lifecycleStage: 'unknown',
          summary: '',
          lifecycleStageReason: '',
          lifecycleStageEvidenceRefs: [],
          mainProblems: [],
          riskWarnings: [],
          thresholdSuggestions: {
            targetAcos: { value: 0.25, reason: '', evidenceRefs: [] },
            highAcosThreshold: { value: 0.4, reason: '', evidenceRefs: [] },
            noOrderClickThreshold: { value: 30, reason: '', evidenceRefs: [] },
            minSpend: { value: 10, reason: '', evidenceRefs: [] },
          },
          aiCandidateCount: 0,
          operationEventCount: 0,
          productContextCount: 0,
          fallbackReason: 'AI 输出格式未通过校验，当前使用规则引擎兜底。',
          evidencePackSummary: { total: 126, metric: 120, timeline: 1, operationEvent: 0, productContext: 1, ruleCandidate: 4 },
        },
      },
    });

    expect(feedback.title).toBe('上次 AI 输出契约失败，等待重新运行');
    expect(feedback.statusLabel).toBe('待复测');
    expect(feedback.detail).toContain('8192');
    expect(feedback.detail).toContain('JSON 示例契约');
    expect(feedback.primaryAction?.label).toBe('重新运行 AI');
    expect(feedback.secondaryAction?.label).toBe('检查 AI 设置');
  });

  it('summarizes a successful AI run with model, candidates, and evidence', () => {
    const feedback = buildStrategyRunFeedback({
      canDiagnose: true,
      loading: false,
      lastRunAt: '2026-06-25T10:30:00.000Z',
      diagnosis: {
        configured: true,
        invoked: true,
        model: 'deepseek-chat',
        metrics: 120,
        ruleCandidateCount: 3,
        summary: {
          source: 'ai',
          lifecycleStage: 'keyword_exploration',
          summary: 'AI diagnosis completed.',
          lifecycleStageReason: 'Evidence supports exploration.',
          lifecycleStageEvidenceRefs: ['timeline:1'],
          mainProblems: [],
          riskWarnings: [],
          thresholdSuggestions: {
            targetAcos: { value: 0.25, reason: '', evidenceRefs: ['metric:1'] },
            highAcosThreshold: { value: 0.4, reason: '', evidenceRefs: ['metric:1'] },
            noOrderClickThreshold: { value: 30, reason: '', evidenceRefs: ['metric:1'] },
            minSpend: { value: 10, reason: '', evidenceRefs: ['metric:1'] },
          },
          aiCandidateCount: 2,
          insightOnlyCandidateCount: 1,
          operationEventCount: 0,
          productContextCount: 1,
          evidencePackSummary: { total: 8, metric: 5, timeline: 1, operationEvent: 1, productContext: 1, ruleCandidate: 0 },
        },
      },
    });

    expect(feedback.title).toBe('AI 阶段分析已完成');
    expect(feedback.statusLabel).toBe('AI 已完成');
    expect(feedback.detail).toContain('模型 deepseek-chat');
    expect(feedback.detail).toContain('2 条 AI 候选');
    expect(feedback.detail).toContain('引用 8 条证据');
  });

  it('keeps the original safe failure reason and both recovery actions', () => {
    const feedback = buildStrategyRunFeedback({
      canDiagnose: true,
      loading: false,
      error: 'AI provider timeout；未生成任何正式建议。',
    });

    expect(feedback.title).toBe('AI 阶段分析失败');
    expect(feedback.statusLabel).toBe('需处理');
    expect(feedback.detail).toBe('AI provider timeout；未生成任何正式建议。');
    expect(feedback.primaryAction).toEqual({ label: '重新运行 AI', target: 'run-ai' });
    expect(feedback.secondaryAction).toEqual({ label: '检查 AI 设置', target: 'settings' });
  });
});

describe('adQuantBlockerDetail', () => {
  it('names the remaining per-type imports when all report files already exist', () => {
    expect(adQuantBlockerDetail({
      realReportCount: 8,
      importedReportTypeCount: 5,
      requiredReportCount: 8,
      fallback: '请先完成 8 类真实报表采集并导入 DB。',
    })).toBe('报表文件 8/8 已齐，当前仅 5/8 类逐类入库；请到导入检查补齐剩余 3 类。截图、审计文件和空报表不作为广告数据。');
  });

  it('preserves a specific upstream blocker outside the partial-import branch', () => {
    expect(adQuantBlockerDetail({
      realReportCount: 3,
      importedReportTypeCount: 2,
      requiredReportCount: 8,
      fallback: '还缺 5 类真实报表。',
    })).toBe('还缺 5 类真实报表。');
  });
});

describe('buildQuantAccountingLine', () => {
  it('explains active batch, ASIN scope, and duplicate collection isolation', () => {
    const line = buildQuantAccountingLine({
      summarySource: 'canonical_advertised_product',
      batchIds: ['batch_1'],
      asin: 'B0TEST',
      canonicalRows: 34,
    });

    expect(line).toContain('batch_1');
    expect(line).toContain('ASIN B0TEST');
    expect(line).toContain('推广商品报表口径');
    expect(line).toContain('不跨批次');
    expect(line).toContain('不跨报表层级重复相加');
  });
});

describe('adQuantActionButtonView', () => {
  it('renders the active AI run button as an explicit busy control', () => {
    const active = adQuantActionButtonView({
      active: true,
      baseClassName: 'secondary-button',
      busyLabel: 'AI 分析中...',
      idleLabel: '运行 AI 阶段分析',
    });

    expect(active.label).toBe('AI 分析中...');
    expect(active.ariaBusy).toBe(true);
    expect(active.disabled).toBe(true);
    expect(active.showSpinner).toBe(true);
    expect(active.className).toContain('button-loading');
  });

  it('locks peer actions during AI analysis without making them look active', () => {
    const peer = adQuantActionButtonView({
      active: false,
      baseClassName: 'primary-button',
      busyLabel: '转跳中...',
      groupBusy: true,
      idleLabel: '生成 AI+规则建议',
    });

    expect(peer.label).toBe('生成 AI+规则建议');
    expect(peer.ariaBusy).toBeUndefined();
    expect(peer.disabled).toBe(true);
    expect(peer.showSpinner).toBe(false);
    expect(peer.className).not.toContain('button-loading');
  });
});

describe('buildWasteRiskSpendTile', () => {
  it('turns wasted spend into a product-level amount and spend share', () => {
    const tile = buildWasteRiskSpendTile({
      wastedSpend: 25,
      totalSpend: 100,
      highRiskCount: 3,
    });

    expect(tile.label).toBe('浪费/高风险花费');
    expect(tile.value).toBe('$25.00');
    expect(tile.detail).toContain('占当前产品花费 25.0%');
    expect(tile.detail).toContain('3 个高风险对象');
    expect(tile.tone).toBe('blocked');
  });

  it('uses actionable missing-data copy instead of placeholder wording', () => {
    const tile = buildWasteRiskSpendTile({
      wastedSpend: null,
      totalSpend: 0,
      highRiskCount: 0,
    });

    expect(tile.value).toBe('待日级数据');
    expect(tile.detail).toContain('先导入 8 类真实报表');
    expect(`${tile.label}${tile.value}${tile.detail}`).not.toContain('占位');
    expect(tile.tone).toBe('pending');
  });
});

describe('ad quant metric focus filters', () => {
  const ruleConfig = {
    highAcosThreshold: 0.4,
    noOrderClickThreshold: 30,
    minSpend: 10,
  };

  function diagnostic(overrides: Partial<BusinessQuantDiagnostic>): BusinessQuantDiagnostic {
    return {
      portfolioName: '',
      campaignName: 'campaign',
      adGroupName: 'ad group',
      asin: 'B0TEST',
      objectKey: 'B0TEST|campaign|ad group|user_search_term|search_term|door lock',
      objectType: 'search_term',
      objectName: 'door lock',
      spend: 0,
      sales: 0,
      orders: 0,
      clicks: 0,
      acos: 0,
      cvr: 0,
      cpc: 0,
      diagnosis: '',
      suggestedDirection: '',
      ...overrides,
    };
  }

  function timeline(overrides: Partial<BusinessQuantTimeline>): BusinessQuantTimeline {
    return {
      objectKey: 'B0TEST|campaign|ad group|user_search_term|search_term|door lock',
      objectType: 'search_term',
      objectName: 'door lock',
      asin: 'B0TEST',
      campaignName: 'campaign',
      adGroupName: 'ad group',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      daysActive: 12,
      lifecycleStage: 'keyword_exploration',
      quantStatus: 'healthy',
      trend: { spend: 'flat', sales: 'flat' },
      totals: {
        impressions: 0,
        clicks: 0,
        cost: 0,
        orders: 0,
        sales: 0,
        acos: 0,
        cpc: 0,
        cvr: 0,
        currency: 'USD',
      },
      thresholds: {},
      reasons: [],
      reviewRequired: false,
      ...overrides,
    };
  }

  it('keeps each metric bucket tied to a concrete diagnostic business meaning', () => {
    const rows = [
      diagnostic({ objectName: 'high-acos', spend: 50, orders: 1, acos: 0.65 }),
      diagnostic({ objectName: 'waste', spend: 20, orders: 0, clicks: 5, quantStatus: 'waste' }),
      diagnostic({ objectName: 'orders', spend: 8, orders: 2, acos: 0.2 }),
      diagnostic({ objectName: 'scale', spend: 15, orders: 5, acos: 0.15, quantStatus: 'scale' }),
      diagnostic({ objectName: 'review', spend: 4, orders: 0, quantStatus: 'watch' }),
    ];

    expect(rows.filter((row) => adQuantDiagnosticMatchesFocus(row, 'all', ruleConfig)).map((row) => row.objectName)).toEqual([
      'high-acos',
      'waste',
      'orders',
      'scale',
      'review',
    ]);
    expect(rows.filter((row) => adQuantDiagnosticMatchesFocus(row, 'high_acos', ruleConfig)).map((row) => row.objectName)).toEqual(['high-acos']);
    expect(rows.filter((row) => adQuantDiagnosticMatchesFocus(row, 'waste', ruleConfig)).map((row) => row.objectName)).toEqual(['waste']);
    expect(rows.filter((row) => adQuantDiagnosticMatchesFocus(row, 'orders', ruleConfig)).map((row) => row.objectName)).toEqual(['high-acos', 'orders', 'scale']);
    expect(rows.filter((row) => adQuantDiagnosticMatchesFocus(row, 'scale', ruleConfig)).map((row) => row.objectName)).toEqual(['scale']);
    expect(rows.filter((row) => adQuantDiagnosticMatchesFocus(row, 'review', ruleConfig)).map((row) => row.objectName)).toEqual(['review']);
  });

  it('filters object timelines with the same metric focus contract', () => {
    const rows = [
      timeline({ objectName: 'timeline-high', totals: { ...timeline({}).totals, cost: 30, orders: 1, acos: 0.5 } }),
      timeline({ objectName: 'timeline-waste', quantStatus: 'waste', totals: { ...timeline({}).totals, cost: 12, orders: 0 } }),
      timeline({ objectName: 'timeline-scale', quantStatus: 'scale', totals: { ...timeline({}).totals, cost: 20, orders: 4 } }),
      timeline({ objectName: 'timeline-review', quantStatus: 'watch', reviewRequired: true }),
    ];

    expect(rows.filter((row) => adQuantTimelineMatchesFocus(row, 'high_acos', ruleConfig)).map((row) => row.objectName)).toEqual(['timeline-high']);
    expect(rows.filter((row) => adQuantTimelineMatchesFocus(row, 'waste', ruleConfig)).map((row) => row.objectName)).toEqual(['timeline-waste']);
    expect(rows.filter((row) => adQuantTimelineMatchesFocus(row, 'scale', ruleConfig)).map((row) => row.objectName)).toEqual(['timeline-scale']);
    expect(rows.filter((row) => adQuantTimelineMatchesFocus(row, 'review', ruleConfig)).map((row) => row.objectName)).toEqual(['timeline-review']);
    expect(adQuantFocusLabel('waste')).toBe('无订单浪费对象');
  });

  it('binds timeline evidence only when the complete object identity matches', () => {
    const exactKey = 'B0TEST|campaign|ad group|user_search_term|search_term|door lock';
    const row = diagnostic({ objectKey: exactKey });

    expect(diagnosisTimelineMatchesDiagnostic(timeline({ objectKey: exactKey }), row)).toBe(true);
    expect(diagnosisTimelineMatchesDiagnostic(
      timeline({ objectKey: 'B0TEST|campaign|ad group|keyword|search_term|door lock' }),
      row,
    )).toBe(false);
    expect(diagnosisTimelineMatchesDiagnostic(timeline({ objectKey: exactKey, objectType: 'target' }), row)).toBe(false);
    expect(diagnosisTimelineMatchesDiagnostic(timeline({ objectKey: exactKey }), diagnostic({ objectKey: undefined }))).toBe(false);
    expect(diagnosisTimelineMatchesDiagnostic(timeline({ objectKey: '' }), row)).toBe(false);
  });
});

describe('buildAdQuantDecisionStatus', () => {
  it('labels accepted AI diagnosis as AI plus rule recommendation generation', () => {
    const status = buildAdQuantDecisionStatus({
      canDiagnose: true,
      canGenerateFormalRecommendations: true,
      diagnosticCount: 3,
      diagnosis: {
        source: 'ai',
        lifecycleStage: 'keyword_exploration',
        summary: '',
        lifecycleStageReason: '',
        lifecycleStageEvidenceRefs: ['metric_1'],
        mainProblems: [],
        riskWarnings: [],
        thresholdSuggestions: {
          targetAcos: { value: 0.25, reason: '', evidenceRefs: ['metric_1'] },
          highAcosThreshold: { value: 0.4, reason: '', evidenceRefs: ['metric_1'] },
          noOrderClickThreshold: { value: 30, reason: '', evidenceRefs: ['metric_1'] },
          minSpend: { value: 10, reason: '', evidenceRefs: ['metric_1'] },
        },
        aiCandidateCount: 1,
        operationEventCount: 0,
        productContextCount: 0,
        evidenceSufficiency: {
          level: 'high',
          metricEvidenceCount: 4,
          sampleDays: 7,
          totalClicks: 80,
          totalCost: 100,
          totalOrders: 3,
          canUseForFormalActions: true,
          blockers: [],
          warnings: [],
        },
      },
    });

    expect(status.aiLabel).toBe('已采纳');
    expect(status.actionLabel).toBe('可生成 AI+规则建议');
    expect(status.primaryActionLabel).toBe('生成 AI+规则建议');
  });

  it('does not label fallback diagnosis as AI plus rule generation', () => {
    const status = buildAdQuantDecisionStatus({
      canDiagnose: true,
      canGenerateFormalRecommendations: true,
      diagnosticCount: 3,
      diagnosis: {
        source: 'rule',
        lifecycleStage: 'unknown',
        summary: '',
        lifecycleStageReason: '',
        lifecycleStageEvidenceRefs: [],
        mainProblems: [],
        riskWarnings: [],
        thresholdSuggestions: {
          targetAcos: { value: 0.25, reason: '', evidenceRefs: [] },
          highAcosThreshold: { value: 0.4, reason: '', evidenceRefs: [] },
          noOrderClickThreshold: { value: 30, reason: '', evidenceRefs: [] },
          minSpend: { value: 10, reason: '', evidenceRefs: [] },
        },
        aiCandidateCount: 0,
        operationEventCount: 0,
        productContextCount: 0,
        fallbackReason: 'AI 阶段判断缺少 evidenceRefs。',
      },
    });

    expect(status.aiLabel).toBe('未采纳');
    expect(status.actionLabel).toBe('可生成规则建议');
    expect(status.primaryActionLabel).toBe('生成规则建议');
  });

  it('blocks recommendation generation when real quant data is not closed', () => {
    const status = buildAdQuantDecisionStatus({
      canDiagnose: false,
      canGenerateFormalRecommendations: false,
      diagnosticCount: 0,
    });

    expect(status.aiLabel).toBe('未调用');
    expect(status.ruleLabel).toBe('待数据');
    expect(status.primaryActionLabel).toBe('补齐数据后再生成');
  });
});

describe('ad quant task-first surface', () => {
  it('uses the shared task banner as the only first-screen primary action', () => {
    const source = readFileSync(new URL('./ad-quant-page.tsx', import.meta.url), 'utf8');
    const blockedStateSource = source.match(/\) : !canDiagnose \? \([\s\S]*?\) : diagnosticCount <= 0 \? \(/)?.[0] || '';

    expect(source.match(/<TaskBanner/g)).toHaveLength(1);
    expect(source).not.toContain('data-diagnosis-primary-action');
    expect(source).toContain('label: workspaceModel.primaryAction.label');
    expect(blockedStateSource).not.toContain('action={');
  });

  it('marks timeline and product evidence as diagnosis-specific compact summaries', () => {
    const source = readFileSync(new URL('./ad-quant-page.tsx', import.meta.url), 'utf8');

    expect(source).toContain('diagnosis-inspector-summary--timeline');
    expect(source).toContain('diagnosis-inspector-summary--product');
    expect(source).toContain('className="diagnosis-inspector-date-range"');
    expect(source).toContain('<time dateTime={selectedTimeline.dateFrom}>');
    expect(source).toContain('<time dateTime={selectedTimeline.dateTo}>');
    expect(source.match(/diagnosis-inspector-trend__item/g)).toHaveLength(2);
  });
});
