import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import type { AdStrategyDiagnosisInput } from '@amazon-ai-ops/ai-adapter';
import type { AdProductHistoryScope } from './ad-product-history-ledger';

export type AdProductHistoryQuality = NonNullable<AdStrategyDiagnosisInput['productHistoryQuality']>;

export function buildAdProductHistoryQuality(
  scope: AdProductHistoryScope,
  metrics: AdDailyMetrics[],
): AdProductHistoryQuality {
  const observed = metrics.filter((metric) => (
    metric.date >= scope.dateFrom && metric.date <= scope.dateTo
    && (!metric.storeName || metric.storeName === scope.storeName)
    && (!metric.marketplaceCode || metric.marketplaceCode === scope.marketplaceCode)
    && (!scope.batchId || metric.batchId === scope.batchId)
    && (!scope.asin || !metric.asin || metric.asin.toUpperCase() === scope.asin.toUpperCase())
  ));
  // 存在指标行不代表逐产品日覆盖完整；不按文件名、时间或活动总量补齐。
  return {
    status: 'unavailable',
    coverage: 'unverified',
    reason: '产品汇总不可用：缺少已核验的逐产品日覆盖与报表替代关系。对象明细可能重叠，不能相加为产品总量；阶段、阈值和 AI 动作需人工复核。',
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    observedDates: Array.from(new Set(observed.map((metric) => metric.date))).sort(),
    observedRowCount: observed.length,
    unboundAsinRowCount: observed.filter((metric) => !String(metric.asin || '').trim()).length,
    omittedSourceRowCount: Math.max(0, observed.length - 120),
    sources: observed.slice(0, 120).map((metric) => ({
      date: metric.date,
      asin: metric.asin || undefined,
      reportType: metric.reportType,
      batchId: metric.batchId,
      sourceFile: String(metric.sourceFile || ''),
      sourceRow: metric.sourceRow,
    })),
  };
}
