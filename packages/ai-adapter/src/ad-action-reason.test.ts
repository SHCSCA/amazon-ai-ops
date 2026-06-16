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
      content: JSON.stringify({
        explanation: 'Lower bid because spend is high.',
        riskWarnings: [],
      }),
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
});
