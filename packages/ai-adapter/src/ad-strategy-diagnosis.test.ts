import { describe, expect, it } from 'vitest';
import { AdStrategyDiagnoser, assessAdEvidenceSufficiency } from './ad-strategy-diagnosis';
import type { AIProvider, ChatMessage, ChatOptions, CompleteOptions } from './provider';
import type { AIResponse } from './types';

class FakeProvider implements AIProvider {
  public messages: ChatMessage[] = [];
  public messageBatches: ChatMessage[][] = [];
  public chatCount = 0;
  public options?: ChatOptions;
  public optionsHistory: Array<ChatOptions | undefined> = [];

  private responses: AIResponse[];

  constructor(response: AIResponse | AIResponse[]) {
    this.responses = Array.isArray(response) ? [...response] : [response];
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse> {
    this.messages = messages;
    this.messageBatches.push(messages);
    this.options = options;
    this.optionsHistory.push(options);
    this.chatCount += 1;
    return this.responses.shift() || this.responses[this.responses.length - 1] || { success: false, error: 'missing fake response' };
  }

  async complete(_prompt: string, _options?: CompleteOptions): Promise<AIResponse> {
    return this.responses[0] || { success: false, error: 'missing fake response' };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('AdStrategyDiagnoser', () => {
  it('asks AI to diagnose lifecycle stage, dynamic thresholds, and actions with operation events in USD context', async () => {
    const provider = new FakeProvider({
      success: true,
      content: `\n${JSON.stringify({
        schemaVersion: 'ad_strategy_diagnosis_v1',
        lifecycleStage: 'keyword_exploration',
        lifecycleStageReason: '搜索词在探索期仍缺少稳定订单证据。',
        lifecycleStageEvidenceRefs: ['metric_1'],
        summary: 'Coupon 已开启但搜索词花费偏高，建议保持探索并收紧无订单门槛。',
        mainProblems: ['no_order_spend', 'high_acos'],
        thresholdSuggestions: {
          targetAcos: { value: 0.35, reason: '关键词探索期可接受高于利润收割期的 ACOS。', evidenceRefs: ['product_1'] },
          highAcosThreshold: { value: 0.55, reason: 'Coupon 可能提升 CVR，先避免过度降价。', evidenceRefs: ['event_1'] },
          noOrderClickThreshold: { value: 18, reason: '产品已经有足够点击样本。', evidenceRefs: ['metric_1'] },
          minSpend: { value: 15, reason: '避免基于过小样本动作。', evidenceRefs: ['metric_1'] },
        },
        aiCandidates: [
          {
            entityType: 'search_term',
            entityName: 'smart lock outdoor',
            actionType: 'lower_bid',
            recommendedValue: '-12%',
            reason: 'Coupon 开启后仍高花费无订单，建议小幅降价观察。',
            reasoningSteps: ['metric_1 显示高花费无订单。', 'event_1 显示 Coupon 已开启。'],
            evidenceRefs: ['metric_1', 'event_1'],
            riskWarnings: ['Coupon 期间不要一次性大幅降价。'],
            confidence: 0.78,
          },
        ],
        insightOnlyCandidates: [],
        riskWarnings: ['否定核心产品词前必须先复核相关性。'],
      })}\n`,
    });
    const diagnoser = new AdStrategyDiagnoser(provider);

    const result = await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        currency: 'USD',
      },
      metrics: [
        {
          date: '2026-06-10',
          campaignName: 'SP exact',
          adGroupName: 'Main',
          asin: 'B001',
          searchTerm: 'smart lock outdoor',
          impressions: 1000,
          clicks: 32,
          cost: 41.5,
          orders: 0,
          sales: 0,
          acos: 0,
          cpc: 1.3,
          cvr: 0,
        },
      ],
      productContexts: [
        {
          asin: 'B001',
          title: 'Smart lock',
          productStage: 'keyword_exploration',
          status: 'active',
          cost: {
            purchaseCost: 13.5,
            firstLegCost: 1.2,
            fbaFee: 4.1,
            referralFeeRate: 0.15,
            minPrice: 29.99,
            targetNetMargin: 0.22,
            targetAcos: 0.35,
            targetTacos: 0.12,
          },
        },
      ],
      productHistoryLedgers: [
        {
          asin: 'B001',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-12',
          activeDays: 10,
          firstMetricDate: '2026-06-01',
          lastMetricDate: '2026-06-10',
          inferredStage: 'keyword_exploration',
          stageReasons: ['有点击和花费但订单不足，仍处于关键词/投放探索。'],
          totals: {
            impressions: 1000,
            clicks: 32,
            cost: 41.5,
            orders: 0,
            sales: 0,
            acos: 0,
            cpc: 1.3,
            cvr: 0,
            currency: 'USD',
          },
          recentDaily: [
            {
              date: '2026-06-10',
              clicks: 32,
              cost: 41.5,
              orders: 0,
              sales: 0,
              acos: 0,
              cvr: 0,
              currency: 'USD',
            },
          ],
          events: [
            {
              eventDate: '2026-06-10',
              eventType: 'coupon',
              title: '10% Coupon started',
              impactExpectation: 'conversion_up',
            },
          ],
          product: {
            productStage: 'keyword_exploration',
            targetAcos: 0.35,
            targetTacos: 0.12,
            targetNetMargin: 0.22,
            minPrice: 29.99,
          },
        },
      ],
      adObjectTimelines: [
        {
          objectType: 'search_term',
          objectName: 'smart lock outdoor',
          asin: 'B001',
          campaignName: 'SP exact',
          adGroupName: 'Main',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-10',
          daysActive: 10,
          lifecycleStage: 'keyword_exploration',
          status: 'waste',
          totals: {
            clicks: 32,
            cost: 41.5,
            orders: 0,
            sales: 0,
            acos: 0,
            cvr: 0,
            currency: 'USD',
          },
          thresholdSuggestion: {
            targetAcos: 0.25,
            highAcosThreshold: 0.4,
            noOrderClickThreshold: 30,
            minSpend: 10,
            bidAdjustPercent: 0.1,
          },
          trend: { spend: 'up', sales: 'flat' },
          reasons: ['Daily timeline shows no-order spend.'],
        },
      ],
      operationEvents: [
        {
          eventDate: '2026-06-10',
          eventType: 'coupon',
          title: '10% Coupon started',
          impactExpectation: 'conversion_up',
        },
      ],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [
        {
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          reason: 'No order spend',
          confidence: 0.7,
        },
      ],
      evidencePack: [
        {
          evidenceId: 'metric_1',
          type: 'metric',
          label: 'smart lock outdoor / 2026-06-10',
          dateRange: '2026-06-10~2026-06-10',
          batchId: 'batch_1',
          reportType: 'search_term',
          sourceFile: 'C:/reports/search-term.xlsx',
          sourceRow: 18,
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B001',
          campaignName: 'SP exact',
          adGroupName: 'Main',
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          metrics: {
            clicks: 32,
            cost: 41.5,
            orders: 0,
            sales: 0,
            currency: 'USD',
          },
        },
      ],
    });

    expect(result.source).toBe('ai');
    expect(result.schemaVersion).toBe('ad_strategy_diagnosis_v1');
    expect(result.lifecycleStage).toBe('keyword_exploration');
    expect(result.evidenceSufficiency).toMatchObject({
      level: 'high',
      canUseForFormalActions: true,
      metricEvidenceCount: 1,
      sampleDays: 1,
      totalClicks: 32,
      totalCost: 41.5,
      totalOrders: 0,
    });
    expect(result.lifecycleStageEvidenceRefs).toEqual(['metric_1']);
    expect(result.thresholdSuggestions.targetAcos.value).toBe(0.35);
    expect(result.thresholdSuggestions.targetAcos.evidenceRefs).toEqual(['metric_1']);
    expect(result.thresholdSuggestions.highAcosThreshold.evidenceRefs).toEqual(['metric_1']);
    expect(result.aiCandidates[0]).toMatchObject({
      entityType: 'search_term',
      entityName: 'smart lock outdoor',
      actionType: 'lower_bid',
      evidenceRefs: ['metric_1'],
    });
    expect(result.aiCandidates[0].evidenceRefs).not.toContain('event_1');
    const prompt = provider.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('productContexts');
    expect(prompt).toContain('productHistoryLedgers');
    expect(prompt).toContain('activeDays');
    expect(prompt).toContain('targetTacos');
    expect(prompt).toContain('keyword_exploration');
    expect(prompt).toContain('给出阈值时必须结合产品阶段、成本结构、目标净利率、目标 ACOS 和目标 TACOS');
    expect(prompt).toContain('所有自然语言字段必须使用简体中文');
    expect(prompt).toContain('只返回一个 JSON 对象');
    expect(prompt).toContain('USD');
    expect(prompt).toContain('10% Coupon started');
    expect(prompt).toContain('smart lock outdoor');
    expect(prompt).toContain('evidencePack');
    expect(prompt).toContain('evidenceSufficiency');
    expect(prompt).toContain('证据充分性不足时，动作必须进入 insightOnlyCandidates');
    expect(prompt).toContain('只能引用 input.evidencePack 中存在的 evidenceId');
    expect(prompt).toContain('判断产品阶段和动态阈值时必须优先引用 type 为 timeline 的 evidenceId');
    expect(prompt).toContain('timeline:* 证据代表产品日级广告历史和运营事件叠加');
    expect(prompt).toContain('schemaVersion');
    expect(prompt).toContain('缺少证据时进入 insightOnlyCandidates');
    expect(prompt).toContain('metric_1');
    expect(prompt).toContain('Daily timeline shows no-order spend.');
    expect(prompt).toContain('金额必须使用 USD');
    expect(prompt).toContain('不得使用人民币、RMB、CNY、¥');
    expect(prompt).toContain('lower_bid | raise_bid | pause_target | resume_target | add_negative_exact | add_negative_phrase | add_negative_broad | adjust_campaign_budget');
    expect(prompt).toContain('不属于以上正式动作的判断，例如 observe、harvest 或泛化 add_negative，必须进入 insightOnlyCandidates');
    expect(prompt).toContain('aiCandidates.confidence 必须大于等于 0.6');
    expect(prompt).toContain('低于 0.6 的 AI 判断必须进入 insightOnlyCandidates');
    expect(prompt).toContain('aiCandidates 必须至少引用一条 type 为 metric 且带 sourceFile/sourceRow 的 evidenceId');
    expect(prompt).toContain('recommendedValue 必须是可直接录入 Ads UI 的绝对数字金额');
    expect(prompt).toContain('不得使用 -10%、降低10%、10% 等相对值');
    expect(prompt).toContain('如果只能给相对比例或方向判断，必须进入 insightOnlyCandidates');
    expect(prompt).toContain('产品阶段判断不能只引用 operation_event');
    expect(prompt).not.toContain('lower_bid | raise_bid | pause | add_negative | harvest | observe');
    expect(prompt).not.toContain('"currency": "CNY"');
    expect(provider.options).toMatchObject({ temperature: 0.2 });
  });

  it('falls back to rule-only diagnosis when AI provider fails', async () => {
    const provider = new FakeProvider({ success: false, error: '401 unauthorized' });
    const diagnoser = new AdStrategyDiagnoser(provider);

    const result = await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
    });

    expect(result).toMatchObject({
      schemaVersion: 'ad_strategy_diagnosis_v1',
      source: 'rule',
      lifecycleStage: 'unknown',
      aiFallbackReason: 'AI 服务调用失败：401 unauthorized',
      aiCandidates: [],
    });
    expect(result.evidenceSufficiency).toMatchObject({
      level: 'none',
      canUseForFormalActions: false,
    });
    expect(result.summary).toContain('AI 诊断不可用');
    expect(result.riskWarnings[0]).toContain('AI 不可用');
    expect(result.summary).toMatch(/[一-龥]/);
  });

  it('repairs missing or invented evidence references with traceable evidence from the current pack', async () => {
    const provider = new FakeProvider({
      success: true,
      content: JSON.stringify({
        schemaVersion: 'ad_strategy_diagnosis_v1',
        lifecycleStage: 'keyword_exploration',
        lifecycleStageReason: '阶段判断引用了当前时间线与指标证据。',
        lifecycleStageEvidenceRefs: ['timeline_not_real'],
        summary: '当前搜索词花费达到门槛，可以形成可复核的降价建议。',
        mainProblems: ['NO_ORDER_SPEND'],
        thresholdSuggestions: {
          targetAcos: { value: 0.32, reason: '使用当前阶段阈值。', evidenceRefs: ['product_not_real'] },
          highAcosThreshold: { value: 0.48, reason: '使用当前时间线阈值。', evidenceRefs: [] },
          noOrderClickThreshold: { value: 24, reason: '点击已达到样本。', evidenceRefs: [] },
          minSpend: { value: 12, reason: '花费已达到样本。', evidenceRefs: [] },
        },
        aiCandidates: [{
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'lower_bid',
          recommendedValue: '1.10',
          reason: '无订单花费达到门槛，建议小幅降价。',
          reasoningSteps: ['当前指标证据显示点击和花费都已达到门槛。'],
          evidenceRefs: [],
          riskWarnings: ['执行前仍需人工审批。'],
          confidence: 0.81,
        }],
        insightOnlyCandidates: [],
        riskWarnings: ['执行前必须复核广告后台当前值。'],
      }),
    });
    const diagnoser = new AdStrategyDiagnoser(provider);

    const result = await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
      evidencePack: [
        {
          evidenceId: 'timeline_1',
          type: 'timeline',
          label: 'smart lock outdoor 时间线',
          dateRange: '2026-06-01~2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B001',
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          timeline: {
            activeDays: 12,
            inferredStage: 'keyword_exploration',
          },
        },
        {
          evidenceId: 'metric_1',
          type: 'metric',
          label: 'smart lock outdoor / 2026-06-10',
          dateRange: '2026-06-10~2026-06-10',
          batchId: 'batch_1',
          reportType: 'search_term',
          sourceFile: 'C:/reports/search-term.xlsx',
          sourceRow: 18,
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B001',
          campaignName: 'SP exact',
          adGroupName: 'Main',
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          metrics: {
            clicks: 34,
            cost: 42,
            orders: 0,
            sales: 0,
            currency: 'USD',
          },
        },
      ],
    });

    expect(result.source).toBe('ai');
    expect(result.lifecycleStageEvidenceRefs).toEqual(['timeline_1']);
    expect(result.thresholdSuggestions.targetAcos.evidenceRefs).toEqual(['timeline_1']);
    expect(result.thresholdSuggestions.highAcosThreshold.evidenceRefs).toEqual(['timeline_1']);
    expect(result.aiCandidates[0].evidenceRefs).toEqual(['metric_1']);
    expect(JSON.stringify(result)).not.toContain('not_real');
  });

  it('parses JSON returned inside a markdown fence', async () => {
    const provider = new FakeProvider({
      success: true,
      content: '```json\n{"schemaVersion":"ad_strategy_diagnosis_v1","lifecycleStage":"unknown","summary":"已解析","mainProblems":[],"thresholdSuggestions":{},"aiCandidates":[],"insightOnlyCandidates":[],"riskWarnings":[]}\n```',
    });
    const diagnoser = new AdStrategyDiagnoser(provider);

    const result = await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
    });

    expect(result.source).toBe('ai');
    expect(result.summary).toBe('已解析');
  });

  it('repairs malformed JSON once and parses the repaired structured diagnosis', async () => {
    const provider = new FakeProvider([
      {
        success: true,
        content: '{"schemaVersion":"ad_strategy_diagnosis_v1","lifecycleStage":"keyword_exploration","summary":"坏 JSON","mainProblems":["HIGH_ACOS",],"thresholdSuggestions":{},"aiCandidates":[],"insightOnlyCandidates":[],"riskWarnings":[]}',
      },
      {
        success: true,
        content: JSON.stringify({
          schemaVersion: 'ad_strategy_diagnosis_v1',
          lifecycleStage: 'keyword_exploration',
          lifecycleStageReason: '修复后可解析，阶段仍需结合证据复核。',
          lifecycleStageEvidenceRefs: [],
          summary: 'AI 输出已修复为标准 JSON，当前只展示可控字段。',
          mainProblems: ['HIGH_ACOS'],
          thresholdSuggestions: {},
          aiCandidates: [],
          insightOnlyCandidates: [],
          riskWarnings: ['修复后的结果仍需人工复核。'],
        }),
      },
    ]);
    const diagnoser = new AdStrategyDiagnoser(provider);

    const result = await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
    });

    expect(provider.chatCount).toBe(2);
    expect(provider.messageBatches[1].map((message) => message.content).join('\n')).toContain('修复为一个合法 JSON 对象');
    expect(result.source).toBe('ai');
    expect(result.summary).toBe('AI 输出已修复为标准 JSON，当前只展示可控字段。');
    expect(result.aiFallbackReason).toBeUndefined();
  });

  it('falls back with a Chinese user-facing reason when malformed JSON repair fails', async () => {
    const provider = new FakeProvider([
      {
        success: true,
        content: '{"schemaVersion":"ad_strategy_diagnosis_v1","mainProblems":["HIGH_ACOS",],"summary":"坏 JSON"}',
      },
      {
        success: true,
        content: '仍然不是 JSON',
      },
    ]);
    const diagnoser = new AdStrategyDiagnoser(provider);

    const result = await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
    });

    expect(provider.chatCount).toBe(2);
    expect(result.source).toBe('rule');
    expect(result.aiFallbackReason).toBe('AI 输出格式未通过校验，当前使用规则引擎兜底。');
    expect(result.summary).toContain('AI 诊断不可用');
    expect(JSON.stringify(result)).not.toContain("Expected ',' or ']'");
    expect(JSON.stringify(result)).not.toContain('position');
  });

  it('falls back when AI returns the wrong schemaVersion', async () => {
    const provider = new FakeProvider({
      success: true,
      content: JSON.stringify({
        schemaVersion: 'legacy_strategy_v0',
        lifecycleStage: 'stable_conversion',
        lifecycleStageReason: '当前数据不足以形成新动作。',
        lifecycleStageEvidenceRefs: [],
        summary: '当前结构版本错误，不能采纳。',
        mainProblems: [],
        thresholdSuggestions: {
          targetAcos: { value: 0.25, reason: '保持当前规则。', evidenceRefs: [] },
          highAcosThreshold: { value: 0.4, reason: '保持当前规则。', evidenceRefs: [] },
          noOrderClickThreshold: { value: 30, reason: '保持当前规则。', evidenceRefs: [] },
          minSpend: { value: 10, reason: '保持当前规则。', evidenceRefs: [] },
        },
        aiCandidates: [],
        insightOnlyCandidates: [],
        riskWarnings: ['需要重新生成标准结构。'],
      }),
    });
    const diagnoser = new AdStrategyDiagnoser(provider);

    const result = await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
    });

    expect(result.source).toBe('rule');
    expect(result.aiFallbackReason).toContain('schemaVersion');
    expect(result.aiCandidates).toEqual([]);
    expect(result.summary).toContain('AI 诊断不可用');
  });

  it('falls back when AI returns English natural-language fields for a Chinese diagnosis', async () => {
    const provider = new FakeProvider({
      success: true,
      content: JSON.stringify({
        schemaVersion: 'ad_strategy_diagnosis_v1',
        lifecycleStage: 'stable_conversion',
        lifecycleStageReason: 'Current performance is stable.',
        lifecycleStageEvidenceRefs: ['metric_1'],
        summary: 'Current performance is stable; no immediate bid action is safe.',
        mainProblems: [],
        thresholdSuggestions: {
          targetAcos: { value: 0.25, reason: 'Keep current target.', evidenceRefs: ['metric_1'] },
          highAcosThreshold: { value: 0.5, reason: 'Keep current risk boundary.', evidenceRefs: ['metric_1'] },
          noOrderClickThreshold: { value: 30, reason: 'Keep current click threshold.', evidenceRefs: ['metric_1'] },
          minSpend: { value: 10, reason: 'Keep current minimum spend.', evidenceRefs: ['metric_1'] },
        },
        aiCandidates: [{
          entityType: 'search_term',
          entityName: 'smart lock outdoor',
          actionType: 'observe',
          reason: 'No safe action candidate.',
          reasoningSteps: ['Metrics do not justify a bid change.'],
          evidenceRefs: ['metric_1'],
          riskWarnings: ['Do not change bids prematurely.'],
          confidence: 0.6,
        }],
        insightOnlyCandidates: [],
        riskWarnings: ['No safe action candidate.'],
      }),
    });
    const diagnoser = new AdStrategyDiagnoser(provider);

    const result = await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
      evidencePack: [{
        evidenceId: 'metric_1',
        type: 'metric',
        label: 'smart lock outdoor / 2026-06-10',
        metrics: { clicks: 32, cost: 41.5, orders: 0, sales: 0, currency: 'USD' },
      }],
    });

    expect(result.source).toBe('rule');
    expect(result.aiFallbackReason).toContain('自然语言字段不是简体中文');
    expect(result.summary).toContain('AI 诊断不可用');
    expect(result.summary).toMatch(/[一-龥]/);
    expect(result.aiCandidates).toEqual([]);
  });

  it('passes configurable persona and output language into the structured prompt', async () => {
    const provider = new FakeProvider({
      success: true,
      content: JSON.stringify({
        lifecycleStage: 'unknown',
        summary: '繁體中文摘要',
        mainProblems: [],
        thresholdSuggestions: {},
        aiCandidates: [],
        riskWarnings: [],
      }),
    });
    const diagnoser = new AdStrategyDiagnoser(provider, {
      persona: '你是资深广告总监。',
      outputLanguage: '繁體中文',
    });

    await diagnoser.diagnose({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
    });

    const prompt = provider.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('你是资深广告总监。');
    expect(prompt).toContain('所有自然语言字段必须使用繁體中文');
  });
});

describe('assessAdEvidenceSufficiency', () => {
  it('blocks formal AI actions when high-volume metric evidence lacks real report traceability', () => {
    const result = assessAdEvidenceSufficiency({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
      evidencePack: [{
        evidenceId: 'metric_without_trace',
        type: 'metric',
        label: 'smart lock outdoor',
        dateRange: '2026-06-10~2026-06-10',
        asin: 'B001',
        metrics: {
          clicks: 80,
          cost: 120,
          orders: 0,
          sales: 0,
          currency: 'USD',
        },
      }],
    });

    expect(result.level).toBe('low');
    expect(result.canUseForFormalActions).toBe(false);
    expect(result.blockers.join('；')).toContain('sourceFile/sourceRow');
  });

  it('blocks formal AI actions when metric evidence lacks product ASIN in a non-ASIN scope', () => {
    const result = assessAdEvidenceSufficiency({
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      metrics: [],
      adObjectTimelines: [],
      operationEvents: [],
      currentRuleConfig: {
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      },
      ruleCandidates: [],
      evidencePack: [{
        evidenceId: 'metric_without_asin',
        type: 'metric',
        label: 'smart lock outdoor',
        dateRange: '2026-06-10~2026-06-10',
        sourceFile: 'C:/reports/user-search-term.xlsx',
        sourceRow: 12,
        metrics: {
          clicks: 80,
          cost: 120,
          orders: 0,
          sales: 0,
          currency: 'USD',
        },
      }],
    });

    expect(result.level).toBe('low');
    expect(result.canUseForFormalActions).toBe(false);
    expect(result.blockers.join('；')).toContain('产品 ASIN');
  });
});
