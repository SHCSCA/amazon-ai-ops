import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';

function metricProductContextKey(metric: { date?: string; campaignName?: string; adGroupName?: string }, includeDate: boolean): string {
  return [
    includeDate ? metric.date || '' : '*',
    (metric.campaignName || '').trim().toLowerCase(),
    (metric.adGroupName || '').trim().toLowerCase(),
  ].join('|');
}

function uniqueProductContext(
  map: Map<string, Map<string, { asin: string; msku: string }>>,
  key: string,
): { asin: string; msku: string } | undefined {
  const values = map.get(key);
  if (!values || values.size !== 1) return undefined;
  return Array.from(values.values())[0];
}

export function attachUniqueProductContext(metrics: AdDailyMetrics[]): AdDailyMetrics[] {
  // 仅新解析报表首次捕获；重复归属计算不得把推断值升级为原生来源。
  const capturedMetrics = metrics.map((metric) => {
    if (metric.sourceAsin !== undefined && typeof metric.sourceAsin !== 'string') {
      throw new Error('IMPORT_SOURCE_ASIN_INVALID: sourceAsin 必须为字符串或 undefined。');
    }
    return { ...metric, sourceAsin: metric.sourceAsin ?? metric.asin };
  });
  const productByKey = new Map<string, Map<string, { asin: string; msku: string }>>();
  const addContext = (key: string, metric: AdDailyMetrics) => {
    if (!metric.asin) return;
    const bucket = productByKey.get(key) ?? new Map<string, { asin: string; msku: string }>();
    bucket.set(metric.asin.toUpperCase(), { asin: metric.asin, msku: metric.msku || '' });
    productByKey.set(key, bucket);
  };

  for (const metric of capturedMetrics) {
    addContext(metricProductContextKey(metric, true), metric);
    addContext(metricProductContextKey(metric, false), metric);
  }

  return capturedMetrics.map((metric) => {
    if (metric.asin) return metric;
    const exact = uniqueProductContext(productByKey, metricProductContextKey(metric, true));
    const fallback = exact ?? uniqueProductContext(productByKey, metricProductContextKey(metric, false));
    return fallback
      ? { ...metric, asin: fallback.asin, msku: metric.msku || fallback.msku }
      : metric;
  });
}

