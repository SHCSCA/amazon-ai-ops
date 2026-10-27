import { describe, expect, it } from 'vitest';
import type { KeywordOpportunity, ListingContent, ListingDraft, ListingSuggestion } from '@amazon-ai-ops/shared-types';
import {
  LINGXING_REPORT_TYPE_SET, normalizeKeywordSource, validateArray, validateDateRange,
  validateLingxingReportType, validateListing, validateListingDraft, validateOpportunity, validateSuggestion,
} from './main-input-contract';

describe('Main input contracts', () => {
  it('preserves the report whitelist and rejects unsupported types', () => {
    expect(LINGXING_REPORT_TYPE_SET.size).toBe(8);
    for (const type of LINGXING_REPORT_TYPE_SET) expect(() => validateLingxingReportType(type)).not.toThrow();
    expect(() => validateLingxingReportType('search_term')).toThrow('类型无效');
    expect(() => validateLingxingReportType(null)).toThrow('类型无效');
  });

  it('rejects malformed and reversed date ranges before importing', () => {
    expect(() => validateDateRange({ start: '2026-10-01', end: '2026-10-16' })).not.toThrow();
    expect(() => validateDateRange({ start: '2026/10/01', end: '2026-10-16' })).toThrow('格式');
    expect(() => validateDateRange({ start: '2026-10-16', end: '2026-10-01' })).toThrow('晚于');
  });

  it('retains array boundaries and keyword source admission', () => {
    expect(() => validateArray([1, 2], '关键词', 2)).not.toThrow();
    expect(() => validateArray('wrong', '关键词', 2)).toThrow('必须是数组');
    expect(() => validateArray([1, 2, 3], '关键词', 2)).toThrow('最大数量');
    expect(normalizeKeywordSource()).toBeUndefined();
    for (const source of ['search_term', 'sqp', 'keyword_report', 'manual']) expect(normalizeKeywordSource(source)).toBe(source);
    expect(() => normalizeKeywordSource('campaign')).toThrow('来源无效');
  });

  it('retains Listing text and bullet limits', () => {
    const listing = { asin: 'B000000001', title: '本地商品', bullets: ['卖点'], backendTerms: 'sample' } as ListingContent;
    expect(() => validateListing(listing)).not.toThrow();
    expect(() => validateListing({ ...listing, title: 'x'.repeat(501) })).toThrow('title');
    expect(() => validateListing({ ...listing, bullets: ['x'.repeat(1001)] })).toThrow('bullets');
    expect(() => validateListing({ ...listing, aPlus: 1 } as unknown as ListingContent)).toThrow('字符串');
  });

  it('requires opportunity identity, level, score and structured evidence', () => {
    const opportunity = { normalizedKeyword: 'smart lock', opportunityLevel: 'high', score: 10,
      riskFlags: [], recommendedSections: [] } as unknown as KeywordOpportunity;
    expect(() => validateOpportunity(opportunity)).not.toThrow();
    expect(() => validateOpportunity({ ...opportunity, normalizedKeyword: ' ' })).toThrow('机会无效');
    expect(() => validateOpportunity({ ...opportunity, score: Number.NaN })).toThrow('分数');
    expect(() => validateOpportunity({ ...opportunity, riskFlags: undefined } as unknown as KeywordOpportunity)).toThrow('风险');
  });

  it('retains local suggestion and draft admission without adding write authority', () => {
    const suggestion = { asin: 'B000000001', keyword: 'smart lock', section: 'title',
      suggestedText: '商品标题', riskWarnings: [] } as unknown as ListingSuggestion;
    expect(() => validateSuggestion(suggestion)).not.toThrow();
    expect(() => validateSuggestion({ ...suggestion, suggestedText: ' ' })).toThrow('文案无效');
    const draft = { asin: 'B000000001', draftedText: '本地草稿', section: 'title',
      keywords: [], riskWarnings: [], source: 'rule' } as unknown as ListingDraft;
    expect(() => validateListingDraft(draft)).not.toThrow();
    expect(() => validateListingDraft({ ...draft, source: 'external' } as unknown as ListingDraft)).toThrow('来源无效');
    expect(() => validateListingDraft({ ...draft, draftedText: ' ' })).toThrow('文案无效');
  });
});
