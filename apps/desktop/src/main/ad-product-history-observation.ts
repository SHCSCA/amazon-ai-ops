import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import type { AdProductHistoryQuality } from './ad-product-history-quality';
import { buildAdProductHistoryQuality } from './ad-product-history-quality';

export interface ProductHistoryObservationScope {
  storeId: string;
  storeName: string;
  marketplaceCode: string;
  dateFrom: string;
  dateTo: string;
  asin?: string;
}
export type ProductHistoryObservedMetric = AdDailyMetrics & { storeId?: string };
const REPORT_TYPES = new Set(['advertised_product', 'user_search_term', 'search_term']);

export function calendarDays(from: string, to: string): string[] {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) return [];
  const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (count > 366) return [];
  return Array.from({ length: count }, (_, index) => new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10));
}

export function buildProductHistoryObservation(
  scope: ProductHistoryObservationScope,
  rows: ProductHistoryObservedMetric[],
  input: { truncated: boolean; sourceBound: boolean },
): AdProductHistoryQuality {
  const dates = calendarDays(scope.dateFrom, scope.dateTo);
  const scoped = rows.filter((row) => row.storeId === scope.storeId
    && row.marketplaceCode === scope.marketplaceCode && dates.includes(row.date)
    && (!scope.asin || row.asin?.toUpperCase() === scope.asin.toUpperCase()));
  const eligible = scoped.filter((row) => REPORT_TYPES.has(row.reportType || ''));
  const quality = buildAdProductHistoryQuality(scope, eligible);
  const asins = scope.asin ? [scope.asin.toUpperCase()]
    : Array.from(new Set(eligible.map((row) => row.asin?.trim().toUpperCase()).filter((asin): asin is string => Boolean(asin)))).sort();
  const days: NonNullable<AdProductHistoryQuality['canonicalObservation']>['days'] = [];
  for (const asin of asins.slice(0, 20)) for (const date of dates) {
    if (days.length >= 120) break;
    const observed = eligible.filter((row) => row.asin?.toUpperCase() === asin && row.date === date);
    const identities = new Set<string>();
    const families = new Map<string, Set<string>>();
    let duplicateSourceRowCount = 0;
    let missingSourceIdentityRowCount = 0;
    for (const row of observed) {
      if (!row.batchId || !row.sourceFile || !Number.isSafeInteger(row.sourceRow) || Number(row.sourceRow) <= 0) {
        missingSourceIdentityRowCount++;
        continue;
      }
      const source = JSON.stringify([scope.storeId, row.batchId, row.reportType, row.sourceFile]);
      const identity = JSON.stringify([source, row.sourceRow]);
      if (identities.has(identity)) duplicateSourceRowCount++;
      identities.add(identity);
      const sources = families.get(row.reportType!) || new Set<string>();
      sources.add(source);
      families.set(row.reportType!, sources);
    }
    const ambiguous = duplicateSourceRowCount > 0 || [...families.values()].some((sources) => sources.size > 1);
    days.push({ asin, date, status: ambiguous ? 'ambiguous' : observed.length ? 'partial' : 'missing',
      observedRowCount: observed.length, reportTypes: [...new Set(observed.map((row) => row.reportType!))].sort(),
      duplicateSourceRowCount, missingSourceIdentityRowCount,
      observedZeroRowCount: observed.filter((row) => [row.impressions, row.clicks, row.cost, row.orders, row.sales].every((value) => value === 0)).length,
    });
  }
  // 混合历史行可能由名称回填；此诊断不认证原生归属、逐日覆盖或替代关系。
  quality.canonicalObservation = {
    storeId: scope.storeId, status: 'unverified', source: 'canonical_report_rows',
    rowLimitExceeded: input.truncated, sourceBound: input.sourceBound,
    scopeValid: Boolean(scope.storeId && dates.length && scope.marketplaceCode === 'US'),
    productUniverse: scope.asin ? 'explicit_scope' : 'observed_only',
    omittedProductCount: Math.max(0, asins.length - 20),
    omittedProductDayCount: asins.length * dates.length - days.length,
    excludedReportRowCount: scoped.length - eligible.length,
    nativeAsinProvenance: 'unknown', coverageProof: 'absent', replacementProof: 'absent', days,
  };
  quality.reason += ' 此覆盖诊断未认证原生归属；仅展示规范报表观察，不认证零值或产品日总量。独立快照观察如可用，仍仅为部分来源小计。';
  return quality;
}
