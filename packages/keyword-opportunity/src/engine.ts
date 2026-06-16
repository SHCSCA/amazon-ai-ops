import type { KeywordMetric, KeywordOpportunity, ListingSection } from '@amazon-ai-ops/shared-types';
import { normalizeKeyword } from './normalizer';
import { scoreKeywordOpportunity } from './scoring';

export interface BuildOpportunitiesOptions {
  brandWhitelist?: string[];
  coverageByKeyword?: Record<string, ListingSection[]>;
}

export function buildKeywordOpportunities(
  metrics: KeywordMetric[],
  options: BuildOpportunitiesOptions = {},
): KeywordOpportunity[] {
  const aggregated = aggregateKeywordMetrics(metrics);

  return aggregated
    .map((metric) =>
      scoreKeywordOpportunity(metric, {
        brandWhitelist: options.brandWhitelist,
        coveredSections: options.coverageByKeyword?.[metric.normalizedKeyword],
      }),
    )
    .sort((a, b) => b.score - a.score);
}

export function aggregateKeywordMetrics(metrics: KeywordMetric[]): KeywordMetric[] {
  const groups = new Map<string, KeywordMetric>();

  for (const metric of metrics) {
    const normalizedKeyword = metric.normalizedKeyword || normalizeKeyword(metric.rawKeyword);
    const key = [
      metric.asin || 'unknown',
      metric.portfolioName || '',
      metric.campaignName || '',
      metric.adGroupName || '',
      metric.source,
      normalizedKeyword,
    ].map((part) => part.trim().toLowerCase()).join('::');
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, { ...metric, normalizedKeyword });
      continue;
    }

    existing.impressions += metric.impressions;
    existing.clicks += metric.clicks;
    existing.cost += metric.cost;
    existing.orders += metric.orders;
    existing.sales += metric.sales;
    existing.acos = existing.sales > 0 ? existing.cost / existing.sales : 0;
    existing.cvr = existing.clicks > 0 ? existing.orders / existing.clicks : 0;
  }

  return Array.from(groups.values());
}
