import { describe, expect, it } from 'vitest';
import { AdActionReasonExplainer } from './ad-action-reason';
import type { AIProvider, ChatMessage, ChatOptions, CompleteOptions } from './provider';
import type { AIResponse } from './types';

class FakeProvider implements AIProvider {
  public messages: ChatMessage[] = [];

  constructor(private response: AIResponse) {}

  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<AIResponse> {
    this.messages = messages;
    return this.response;
  }

  async complete(_prompt: string, _options?: CompleteOptions): Promise<AIResponse> {
    return this.response;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe('AdActionReasonExplainer', () => {
  it('uses USD in prompts and never asks AI to explain US ads in yuan', async () => {
    const provider = new FakeProvider({
      success: true,
      content: `\`\`\`json\n${JSON.stringify({
        schemaVersion: 'ad_action_reason_v1',
        explanation: '花费偏高且没有订单，建议降低出价。',
        riskWarnings: [],
      })}\n\`\`\``,
    });
    const explainer = new AdActionReasonExplainer(provider);

    await explainer.explain({
      actionType: 'lower_bid',
      entityName: 'smart lock outdoor',
      currentMetrics: {
        impressions: 1000,
        clicks: 32,
        cost: 41.5,
        orders: 0,
        sales: 0,
        acos: 0,
      },
      recommendedAction: 'lower bid',
    });

    const prompt = provider.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('USD 41.50');
    expect(prompt).toContain('自然语言必须使用简体中文');
    expect(prompt).toContain('只输出 JSON');
    expect(prompt).not.toMatch(/¥|RMB|CNY|人民币|元/);
  });

  it('uses USD in fallback explanations when AI is unavailable', async () => {
    const provider = new FakeProvider({ success: false, error: 'network timeout' });
    const explainer = new AdActionReasonExplainer(provider);

    const result = await explainer.explain({
      actionType: 'add_negative_exact',
      entityName: 'irrelevant search term',
      currentMetrics: {
        impressions: 500,
        clicks: 31,
        cost: 22.3,
        orders: 0,
        sales: 0,
        acos: 0,
      },
      recommendedAction: 'add negative exact',
    });

    expect(result.explanation).toContain('USD 22.30');
    expect(result.explanation).not.toMatch(/¥|RMB|CNY|人民币|元/);
    expect(result.source).toBe('rule');
  });

  it('falls back when AI returns English natural-language fields for Chinese explanations', async () => {
    const provider = new FakeProvider({
      success: true,
      content: JSON.stringify({
        schemaVersion: 'ad_action_reason_v1',
        explanation: 'Lower the bid because ACOS is too high.',
        riskWarnings: ['Do not change bids too aggressively.'],
        alternativeSuggestions: ['Observe for three days.'],
      }),
    });
    const explainer = new AdActionReasonExplainer(provider);

    const result = await explainer.explain({
      actionType: 'lower_bid',
      entityName: 'smart lock outdoor',
      currentMetrics: {
        impressions: 1000,
        clicks: 32,
        cost: 41.5,
        orders: 0,
        sales: 0,
        acos: 0,
      },
      recommendedAction: 'lower bid',
    });

    expect(result.source).toBe('rule');
    expect(result.aiFallbackReason).toContain('自然语言字段不是简体中文');
    expect(result.explanation).toMatch(/[一-龥]/);
    expect(result.explanation).toContain('USD 41.50');
  });

  it('passes configurable persona and language into action explanation prompts', async () => {
    const provider = new FakeProvider({
      success: true,
      content: JSON.stringify({
        schemaVersion: 'ad_action_reason_v1',
        explanation: '繁體中文解释',
        riskWarnings: [],
      }),
    });
    const explainer = new AdActionReasonExplainer(provider, {
      persona: '你是广告审批负责人。',
      outputLanguage: '繁體中文',
    });

    await explainer.explain({
      actionType: 'lower_bid',
      entityName: 'smart lock outdoor',
      currentMetrics: {
        impressions: 100,
        clicks: 10,
        cost: 12,
        orders: 0,
        sales: 0,
        acos: 0,
      },
      recommendedAction: 'lower bid',
    });

    const prompt = provider.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('你是广告审批负责人。');
    expect(prompt).toContain('所有自然语言字段必须使用繁體中文');
  });

  it('requires the ad action reason schema version and falls back on mismatched schema', async () => {
    const provider = new FakeProvider({
      success: true,
      content: JSON.stringify({
        schemaVersion: 'legacy_action_reason_v0',
        explanation: '旧格式解释。',
        riskWarnings: [],
      }),
    });
    const explainer = new AdActionReasonExplainer(provider);

    const result = await explainer.explain({
      actionType: 'lower_bid',
      entityName: 'smart lock outdoor',
      currentMetrics: {
        impressions: 100,
        clicks: 10,
        cost: 12,
        orders: 0,
        sales: 0,
        acos: 0,
      },
      recommendedAction: 'lower bid',
    });

    const prompt = provider.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('"schemaVersion": "ad_action_reason_v1"');
    expect(result.source).toBe('rule');
    expect(result.aiFallbackReason).toContain('schemaVersion');
  });
});
