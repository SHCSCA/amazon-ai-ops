import type { KeywordMetric, KeywordOpportunity, LingxingReportType, ListingContent, ListingDraft, ListingSuggestion } from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';

export const LINGXING_REPORT_TYPE_SET = new Set<string>(LINGXING_AD_REPORTS.map((report) => report.type));

export function validateDateRange(dateRange: { start: string; end: string }): void {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(dateRange?.start || '') || !pattern.test(dateRange?.end || '')) {
    throw new Error('日期范围必须使用 YYYY-MM-DD 格式');
  }
  if (dateRange.start > dateRange.end) {
    throw new Error('开始日期不能晚于结束日期');
  }
}

export function validateLingxingReportType(reportType: unknown): asserts reportType is LingxingReportType {
  if (typeof reportType !== 'string' || !LINGXING_REPORT_TYPE_SET.has(reportType)) {
    throw new Error('领星报告类型无效');
  }
}

export function validateArray(value: unknown, name: string, maxLength: number): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} 必须是数组`);
  }
  if (value.length > maxLength) {
    throw new Error(`${name} 超过最大数量限制 ${maxLength}`);
  }
}

export function validateListing(listing: ListingContent): void {
  if (!listing || typeof listing.asin !== 'string' || !listing.asin.trim() || listing.asin.length > 32) {
    throw new Error('Listing ASIN 无效');
  }
  if (typeof listing.title !== 'string' || !listing.title.trim() || listing.title.length > 500) {
    throw new Error('Listing title 无效');
  }
  if (!Array.isArray(listing.bullets)) {
    throw new Error('Listing bullets 必须是数组');
  }
  if (listing.bullets.length > 10 || listing.bullets.some((bullet) => typeof bullet !== 'string' || bullet.length > 1000)) {
    throw new Error('Listing bullets 内容无效');
  }
  for (const field of [listing.aPlus, listing.imageCopy, listing.backendTerms]) {
    if (field !== undefined && typeof field !== 'string') {
      throw new Error('Listing 文案字段必须是字符串');
    }
  }
}

export function validateOpportunity(opportunity: KeywordOpportunity): void {
  if (!opportunity || typeof opportunity.normalizedKeyword !== 'string' || !opportunity.normalizedKeyword.trim()) {
    throw new Error('关键词机会无效');
  }
  if (!['high', 'medium', 'low'].includes(opportunity.opportunityLevel)) {
    throw new Error('关键词机会等级无效');
  }
  if (!Number.isFinite(Number(opportunity.score))) {
    throw new Error('关键词机会分数无效');
  }
  if (!Array.isArray(opportunity.riskFlags) || !Array.isArray(opportunity.recommendedSections)) {
    throw new Error('关键词机会风险或推荐位置无效');
  }
}

export function validateSuggestion(suggestion: ListingSuggestion): void {
  if (!suggestion || typeof suggestion.asin !== 'string' || typeof suggestion.keyword !== 'string') {
    throw new Error('Listing 建议无效');
  }
  if (!['title', 'bullet', 'a_plus', 'image_copy', 'backend_terms'].includes(suggestion.section)) {
    throw new Error('Listing 建议位置无效');
  }
  if (typeof suggestion.suggestedText !== 'string' || !suggestion.suggestedText.trim()) {
    throw new Error('Listing 建议文案无效');
  }
  if (!Array.isArray(suggestion.riskWarnings)) {
    throw new Error('Listing 建议风险字段无效');
  }
}

export function validateListingDraft(draft: ListingDraft): void {
  if (!draft || typeof draft.asin !== 'string' || typeof draft.draftedText !== 'string') {
    throw new Error('Listing 草案无效');
  }
  if (!['title', 'bullet', 'a_plus', 'image_copy', 'backend_terms'].includes(draft.section)) {
    throw new Error('Listing 草案位置无效');
  }
  if (!draft.draftedText.trim()) {
    throw new Error('Listing 草案文案无效');
  }
  if (!Array.isArray(draft.keywords) || !Array.isArray(draft.riskWarnings)) {
    throw new Error('Listing 草案关键词或风险字段无效');
  }
  if (!['ai', 'rule'].includes(draft.source)) {
    throw new Error('Listing 草案来源无效');
  }
}

export function normalizeKeywordSource(source?: string): KeywordMetric['source'] | undefined {
  if (!source) return undefined;
  if (['search_term', 'sqp', 'keyword_report', 'manual'].includes(source)) {
    return source as KeywordMetric['source'];
  }
  throw new Error('关键词报表来源无效');
}
