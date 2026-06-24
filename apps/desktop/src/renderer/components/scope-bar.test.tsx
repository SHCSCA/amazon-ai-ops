import { describe, expect, it } from 'vitest';
import { buildScopeSummaryFacts } from './scope-bar';

describe('ScopeBar summary facts', () => {
  it('shows product title plus ASIN when product label is available', () => {
    const facts = buildScopeSummaryFacts({
      batchId: 'batch_1',
      batchModeLabel: '手动指定已校验批次',
      reportCoverage: '8/8 类真实报表',
      importedRows: '2416 行',
      asin: 'B001',
      productLabel: 'D6 Smart Lock / B001',
    });

    expect(facts.find((item) => item.label === '产品')?.value).toBe('D6 Smart Lock / B001');
  });

  it('falls back to all products when no ASIN is selected', () => {
    const facts = buildScopeSummaryFacts({
      batchModeLabel: '自动匹配当前范围',
      reportCoverage: '暂无匹配批次',
      importedRows: '0 行',
    });

    expect(facts.find((item) => item.label === '产品')?.value).toBe('全部产品');
  });
});
