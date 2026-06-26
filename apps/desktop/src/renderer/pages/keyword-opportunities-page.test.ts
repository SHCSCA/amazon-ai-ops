import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { KeywordOpportunityView } from '../types';
import {
  buildKeywordOpportunityFilterFeedback,
  keywordOpportunityTableFeedbackClass,
  nextKeywordOpportunitySort,
  sortKeywordOpportunities,
} from './keyword-opportunities-page';

function row(overrides: Partial<KeywordOpportunityView>): KeywordOpportunityView {
  return {
    asin: 'B000000000',
    portfolioName: 'portfolio',
    campaignName: 'campaign',
    adGroupName: 'ad-group',
    entityType: 'keyword',
    keyword: 'keyword',
    coverageStatus: '未覆盖',
    clicks: 0,
    orders: 0,
    spend: 0,
    sales: 0,
    acos: 0,
    opportunityLevel: 'low',
    recommendedPlacement: '标题',
    risk: '无',
    ...overrides,
  };
}

describe('keyword opportunity sorting', () => {
  it('sorts opportunity rows without mutating the original result order', () => {
    const rows = [
      row({ keyword: 'low order', orders: 1, spend: 120, opportunityLevel: 'low' }),
      row({ keyword: 'top order', orders: 8, spend: 30, opportunityLevel: 'medium' }),
      row({ keyword: 'mid order', orders: 4, spend: 90, opportunityLevel: 'high' }),
    ];

    expect(sortKeywordOpportunities(rows, { key: 'orders', direction: 'desc' }).map((item) => item.keyword)).toEqual([
      'top order',
      'mid order',
      'low order',
    ]);
    expect(rows.map((item) => item.keyword)).toEqual(['low order', 'top order', 'mid order']);
  });

  it('keeps high opportunity levels first when sorting by opportunity level', () => {
    const rows = [
      row({ keyword: 'low', opportunityLevel: 'low', orders: 10 }),
      row({ keyword: 'high', opportunityLevel: 'high', orders: 1 }),
      row({ keyword: 'medium', opportunityLevel: 'medium', orders: 3 }),
    ];

    expect(sortKeywordOpportunities(rows, { key: 'opportunityLevel', direction: 'desc' }).map((item) => item.keyword)).toEqual([
      'high',
      'medium',
      'low',
    ]);
  });

  it('uses text-first ascending order for keyword headers and descending order for numeric headers', () => {
    expect(nextKeywordOpportunitySort({ key: 'orders', direction: 'desc' }, 'orders')).toEqual({ key: 'orders', direction: 'asc' });
    expect(nextKeywordOpportunitySort({ key: 'orders', direction: 'asc' }, 'keyword')).toEqual({ key: 'keyword', direction: 'asc' });
    expect(nextKeywordOpportunitySort({ key: 'keyword', direction: 'asc' }, 'spend')).toEqual({ key: 'spend', direction: 'desc' });
  });
});

describe('keyword opportunity filter micro-feedback', () => {
  it('summarizes filter and sort changes for the live feedback line', () => {
    expect(buildKeywordOpportunityFilterFeedback({
      activeFilterCount: 2,
      sortDirection: 'desc',
      sortLabel: '花费',
      totalCount: 12,
      visibleCount: 7,
    })).toBe('已应用 2 个筛选条件，按花费降序展示 7/12 个机会。');

    expect(buildKeywordOpportunityFilterFeedback({
      activeFilterCount: 0,
      sortDirection: 'desc',
      sortLabel: '机会等级',
      totalCount: 12,
      visibleCount: 12,
    })).toBe('未设置筛选条件，按机会等级降序展示 12/12 个机会。');
  });

  it('marks the table shell only while the filter transition is refreshing', () => {
    expect(keywordOpportunityTableFeedbackClass(false)).toBe('keyword-opportunity-table-shell');
    expect(keywordOpportunityTableFeedbackClass(true)).toContain('keyword-opportunity-table-refreshing');
  });

  it('keeps the 100ms vertical crossfade and aria-live source contract wired', () => {
    const source = readFileSync(new URL('./keyword-opportunities-page.tsx', import.meta.url), 'utf8');
    const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('keyword-opportunity-filter-feedback');
    expect(source).toContain('setTableRefreshing');
    expect(styles).toContain('.keyword-opportunity-table-refreshing');
    expect(styles).toContain('@keyframes keyword-opportunity-filter-refresh');
    expect(styles).toMatch(/animation:\s*keyword-opportunity-filter-refresh 100ms/);
    expect(styles).toContain('transform: translateY(4px)');
  });
});
