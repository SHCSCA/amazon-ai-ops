import { describe, expect, it } from 'vitest';
import { AdStrategyDiagnoser } from './ad-strategy-diagnosis';
import type { AIProvider, ChatMessage, ChatOptions, CompleteOptions } from './provider';
import type { AIResponse } from './types';

class FakeProvider implements AIProvider {
  public messages: ChatMessage[] = [];
  public options?: ChatOptions;

  constructor(private response: AIResponse) {}

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<AIResponse> {
    this.messages = messages;
    this.options = options;
    return this.response;
  }

  async complete(_prompt: string, _options?: CompleteOptions): Promise<AIResponse> {
    return this.response;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('AdStrategyDiagnoser', () => {
  it('asks AI to diagnose lifecycle stage, dynamic thresholds, and actions with operation events in USD context', async () => {
    const provider = new FakeProvider({
      success: true,
      content: JSON.stringify({
        lifecycleStage: 'keyword_exploration',
        summary: 'Coupon started while search-term spend is high, so keep exploration but tighten no-order spend.',
        mainProblems: ['no_order_spend', 'high_acos'],
        thresholdSuggestions: {
          targetAcos: { value: 0.35, reason: 'Exploration phase can tolerate higher ACOS than profit harvesting.' },
          highAcosThreshold: { value: 0.55, reason: 'Coupon should improve CVR before lowering aggressively.' },
          noOrderClickThreshold: { value: 18, reason: 'Product already has enough click data.' },
          minSpend: { value: 15, reason: 'Avoid acting on tiny samples.' },
        },
        aiCandidates: [
          {
            entityType: 'search_term',
            entityName: 'smart lock outdoor',
            actionType: 'lower_bid',
            recommendedValue: '-12%',
            reason: 'Spend is high with no orders after coupon launch.',
            confidence: 0.78,
          },
        ],
        riskWarnings: ['Do not negate core product terms before checking relevance.'],
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
    });

    expect(result.source).toBe('ai');
    expect(result.lifecycleStage).toBe('keyword_exploration');
    expect(result.thresholdSuggestions.targetAcos.value).toBe(0.35);
    expect(result.aiCandidates[0]).toMatchObject({
      entityType: 'search_term',
      entityName: 'smart lock outdoor',
      actionType: 'lower_bid',
    });
    const prompt = provider.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('productContexts');
    expect(prompt).toContain('targetTacos');
    expect(prompt).toContain('keyword_exploration');
    expect(prompt).toContain('Use product stage, cost structure, target margin, target ACOS, and target TACOS');
    expect(prompt).toContain('USD');
    expect(prompt).toContain('10% Coupon started');
    expect(prompt).toContain('smart lock outdoor');
    expect(prompt).toContain('Daily timeline shows no-order spend.');
    expect(prompt).not.toMatch(/¥|RMB|CNY|人民币|元/);
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
      source: 'rule',
      lifecycleStage: 'unknown',
      aiFallbackReason: '401 unauthorized',
      aiCandidates: [],
    });
  });
});
