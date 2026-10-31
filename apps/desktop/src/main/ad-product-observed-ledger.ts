import { AD_SOURCE_METRIC_BITS, AD_SOURCE_METRIC_MASK_ALL, type AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import type { AdProductObservedLedger } from '@amazon-ai-ops/ai-adapter';
import type { ProductHistoryObservationScope } from './ad-product-history-observation';
import { calendarDays } from './ad-product-history-observation';

type Field = keyof typeof AD_SOURCE_METRIC_BITS;
const fields = Object.keys(AD_SOURCE_METRIC_BITS) as Field[];
const emptyMetrics = () => ({ impressions: null, clicks: null, cost: null, orders: null, sales: null });
const emptyCounts = () => ({ impressions: 0, clicks: 0, cost: 0, orders: 0, sales: 0 });
const nativeAsin = (value: unknown): string => typeof value === 'string' && /^[A-Z0-9]{10}$/.test(value) ? value : '';

export function buildAdProductObservedLedger(
  scope: ProductHistoryObservationScope,
  snapshot: {
    status: 'verified' | 'unavailable'; reason: string;
    source?: AdProductObservedLedger['source']; metrics: AdDailyMetrics[];
  },
): AdProductObservedLedger {
  const unavailable = (reason: string): AdProductObservedLedger => ({
    status: 'unavailable', coverage: 'unverified', reason, days: [], excludedRowCount: snapshot.metrics.length,
  });
  const dates = calendarDays(scope.dateFrom, scope.dateTo);
  const source = snapshot.source;
  if (snapshot.status !== 'verified' || !source) return unavailable(snapshot.reason);
  if (!dates.length || !scope.storeId || scope.marketplaceCode !== 'US'
    || source.storeId !== scope.storeId || source.dateFrom > scope.dateFrom || source.dateTo < scope.dateTo
    || (scope.asin && !nativeAsin(scope.asin.toUpperCase()))) return unavailable('产品日观察范围无效。');
  const rows = snapshot.metrics.filter((row) => row.reportType === 'advertised_product'
    && row.batchId === source.batchId && row.sourceFile === source.sourceFile
    && row.marketplaceCode === 'US' && row.currency === 'USD'
    && dates.includes(row.date) && nativeAsin(row.sourceAsin)
    && (!scope.asin || row.sourceAsin === scope.asin.toUpperCase()));
  const asins = scope.asin ? [scope.asin.toUpperCase()] : [...new Set(rows.map((row) => row.sourceAsin!))].sort();
  if (asins.length * dates.length > 120) return unavailable('产品日观察超过 120 项；请缩小日期或产品范围，未返回截断汇总。');
  const days: AdProductObservedLedger['days'] = [];
  for (const asin of asins) for (const date of dates) {
    const observed = rows.filter((row) => row.sourceAsin === asin && row.date === date);
    const counts = emptyCounts();
    const metrics: AdProductObservedLedger['days'][number]['metrics'] = emptyMetrics();
    const identities = observed.map((row) => row.sourceRow);
    const ambiguous = identities.some((row) => !Number.isSafeInteger(row) || Number(row) <= 0)
      || new Set(identities).size !== identities.length;
    if (!ambiguous) for (const field of fields) {
      const valid = observed.filter((row) => Number.isInteger(row.sourceMetricMask)
        && Number(row.sourceMetricMask) >= 0 && Number(row.sourceMetricMask) <= AD_SOURCE_METRIC_MASK_ALL
        && (Number(row.sourceMetricMask) & AD_SOURCE_METRIC_BITS[field]) !== 0
        && typeof row[field] === 'number' && Number.isFinite(row[field]) && row[field] >= 0
        && (field === 'cost' || field === 'sales' || Number.isSafeInteger(row[field])));
      counts[field] = valid.length;
      // 单元格缺失不参与补零；只有全部原生行具有该字段才展示观察小计。
      if (observed.length && valid.length === observed.length) {
        const total = valid.reduce((sum, row) => sum + row[field], 0);
        if (Number.isFinite(total) && (field === 'cost' || field === 'sales' || Number.isSafeInteger(total))) {
          metrics[field] = total;
        }
      }
    }
    days.push({ asin, date, status: ambiguous ? 'ambiguous' : observed.length ? 'partial' : 'missing',
      observedRowCount: observed.length, sourceRows: ambiguous ? [] : identities.map(Number).sort((a, b) => a - b), observedFieldRowCounts: counts, metrics,
      explicitZeroFields: fields.filter((field) => metrics[field] === 0),
      unknownFields: fields.filter((field) => metrics[field] === null),
    });
  }
  return {
    status: 'partial', coverage: 'unverified', source, days,
    excludedRowCount: snapshot.metrics.length - rows.length,
    reason: '仅为单一已完成文件快照中原生 ASIN 行的观察小计；缺失单元格和日期为未知。观察零不是完整产品日零，不能用于正式 AI 动作、阶段或阈值资格。',
  };
}
