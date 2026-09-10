import { describe, expect, it, vi } from 'vitest';
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
  it.each(['not json', '{"summary":"missing required fields"}', JSON.stringify({ title: '2026-06-12 日报', summary: '花费 CNY 10 元',
    highlights: [], concerns: [], tomorrowFocus: [], generatedBy: 'AI' })])('audits malformed/invalid structured output and falls back: %s', async content => {
    const reportOutput = vi.fn();
    const generated = await new DailyReportGenerator(new FakeProvider({ success: true, content, reportOutput })).generate(sampleInput());
    expect(JSON.parse(generated).generatedBy).toBe('规则引擎');
    expect(reportOutput).toHaveBeenCalledTimes(1);
    expect(reportOutput).toHaveBeenCalledWith('invalid');
  });
  it('records validated JSON without retaining unexpected fields', async () => {
    const reportOutput = vi.fn();
    const report = { title: '2026-06-12 日报', summary: '广告花费已下降，需要继续观察。', highlights: ['花费为 USD 42.50'],
      concerns: [], tomorrowFocus: ['观察订单变化'], generatedBy: 'AI' };
    const generated = await new DailyReportGenerator(new FakeProvider({ success: true, content: JSON.stringify({ ...report, unexpected: 'not part of this contract' }), reportOutput })).generate(sampleInput());
    expect(JSON.parse(generated)).toEqual(report);
    expect(reportOutput).toHaveBeenCalledTimes(1);
    expect(reportOutput).toHaveBeenCalledWith('accepted');
  });
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
