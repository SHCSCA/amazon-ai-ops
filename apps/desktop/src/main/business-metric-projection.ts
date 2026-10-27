import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';

export function normalizeAdMetricMatchType(value: unknown): AdDailyMetrics['matchType'] {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'exact' || normalized === 'broad' || normalized === 'phrase' || normalized === 'auto') {
    return normalized;
  }
  return 'auto';
}

export function mapBusinessAdMetricRow(row: any): AdDailyMetrics {
  return {
    id: row.id,
    batchId: row.batch_id,
    reportType: row.report_type,
    portfolioName: row.portfolio_name,
    date: row.date,
    storeName: row.store_name,
    marketplaceCode: row.marketplace_code,
    asin: row.asin,
    msku: row.msku,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    targeting: row.targeting,
    searchTerm: row.search_term,
    matchType: row.match_type,
    impressions: row.impressions,
    clicks: row.clicks,
    cost: row.cost,
    orders: row.orders,
    sales: row.sales,
    currency: row.currency || 'USD',
    acos: row.acos,
    cpc: row.cpc,
    cvr: row.cvr,
    sourceFile: row.source_file,
    sourceRow: row.source_row ?? undefined,
    createdAt: row.created_at,
  };
}

export function countMetricsWithSourceRow(metrics: AdDailyMetrics[]): number {
  return metrics.filter((metric) => Number.isFinite(Number(metric.sourceRow)) && Number(metric.sourceRow) > 0).length;
}

export function countMetricsWithSourceFileAndRow(metrics: AdDailyMetrics[]): number {
  return metrics.filter((metric) => (
    String(metric.sourceFile || '').trim().length > 0
    && Number.isFinite(Number(metric.sourceRow))
    && Number(metric.sourceRow) > 0
  )).length;
}

export function countMetricsWithAsin(metrics: AdDailyMetrics[]): number {
  return metrics.filter((metric) => String(metric.asin || '').trim().length > 0).length;
}

export function roundMoney(value: unknown): number {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0;
}
