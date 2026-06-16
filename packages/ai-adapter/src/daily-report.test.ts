import { describe, expect, it } from 'vitest';
import { DailyReportGenerator } from './daily-report';
import type { AIProvider, ChatMessage, ChatOptions, CompleteOptions } from './provider';
import type { AIResponse, DailyReportSummaryInput } from './types';

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

describe('DailyReportGenerator', () => {
  it('uses USD in prompts and fallback reports', async () => {
    const provider = new FakeProvider({ success: false, error: 'unavailable' });
    const generator = new DailyReportGenerator(provider);

    const report = await generator.generate(sampleInput());
    const prompt = provider.messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('USD 170.25');
    expect(prompt).not.toMatch(/¥|RMB|CNY|人民币|元/);
    expect(report).toContain('USD 42.50');
    expect(report).not.toMatch(/¥|RMB|CNY|人民币|元/);
  });
});

function sampleInput(): DailyReportSummaryInput {
  return {
    date: '2026-06-12',
    storeName: 'FT-US-US',
    salesOverview: {
      totalRevenue: 170.25,
      totalOrders: 3,
      avgOrderValue: 56.75,
      comparedToYesterday: 0.1,
    },
    adPerformance: {
      totalCost: 42.5,
      totalSales: 170.25,
      avgAcos: 0.25,
      totalClicks: 120,
      comparedToYesterday: -0.05,
    },
    recommendationsSummary: {
      total: 2,
      auto: 0,
      pending: 2,
      executed: 0,
    },
    inventoryAlerts: {
      outOfStock: 0,
      lowStock: 1,
    },
    topRisks: [],
  };
}
