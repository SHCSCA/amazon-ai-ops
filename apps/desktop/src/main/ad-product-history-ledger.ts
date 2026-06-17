import type { ProductStrategyContext } from '@amazon-ai-ops/ai-adapter';
import type { AdDailyMetrics, CreateOperationEventInput, OperationEvent } from '@amazon-ai-ops/shared-types';

export interface AdProductHistoryScope {
  dateFrom: string;
  dateTo: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  batchId?: string;
}

export interface AdProductDailyHistory {
  date: string;
  impressions: number;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
  acos: number;
  cpc: number;
  cvr: number;
  currency: 'USD';
}

export interface AdProductHistoryLedger {
  asin: string;
  storeName: string;
  marketplaceCode: string;
  dateFrom: string;
  dateTo: string;
  activeDays: number;
  firstMetricDate?: string;
  lastMetricDate?: string;
  inferredStage: string;
  stageReasons: string[];
  daily: AdProductDailyHistory[];
  totals: {
    impressions: number;
    clicks: number;
    cost: number;
    orders: number;
    sales: number;
    acos: number;
    cpc: number;
    cvr: number;
    currency: 'USD';
  };
  events: Array<CreateOperationEventInput | OperationEvent>;
  product?: {
    productStage?: string;
    targetAcos?: number;
    targetTacos?: number;
    targetNetMargin?: number;
    minPrice?: number;
  };
}

export function buildAdProductHistoryLedger(input: {
  scope: AdProductHistoryScope;
  metrics: AdDailyMetrics[];
  operationEvents: Array<CreateOperationEventInput | OperationEvent>;
  productContexts: ProductStrategyContext[];
}): AdProductHistoryLedger[] {
  const metrics = input.metrics.filter((item) => metricInScope(item, input.scope));
  const events = input.operationEvents.filter((item) => eventInScope(item, input.scope));
  const products = input.productContexts.filter((item) => productInScope(item, input.scope));
  const byAsin = new Map<string, AdDailyMetrics[]>();

  for (const metric of metrics) {
    const asin = normalizedAsin(metric.asin || input.scope.asin);
    if (!asin) continue;
    byAsin.set(asin, [...(byAsin.get(asin) || []), metric]);
  }

  return Array.from(byAsin.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([asin, asinMetrics]) => buildLedgerForAsin(asin, asinMetrics, events, products, input.scope));
}

function buildLedgerForAsin(
  asin: string,
  metrics: AdDailyMetrics[],
  events: Array<CreateOperationEventInput | OperationEvent>,
  products: ProductStrategyContext[],
  scope: AdProductHistoryScope,
): AdProductHistoryLedger {
  const daily = Array.from(groupByDate(metrics).entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => dailyHistory(date, items));
  const totals = sumDaily(daily);
  const productContext = products.find((item) => normalizedAsin(item.asin) === asin);
  const product = productContext
    ? {
        productStage: productContext.productStage,
        targetAcos: productContext.cost?.targetAcos,
        targetTacos: productContext.cost?.targetTacos,
        targetNetMargin: productContext.cost?.targetNetMargin,
        minPrice: productContext.cost?.minPrice,
      }
    : undefined;
  const { inferredStage, stageReasons } = inferStage(product?.productStage, daily, totals);

  return {
    asin,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    activeDays: daily.length,
    firstMetricDate: daily[0]?.date,
    lastMetricDate: daily[daily.length - 1]?.date,
    inferredStage,
    stageReasons,
    daily,
    totals,
    events: events.filter((item) => !item.asin || normalizedAsin(item.asin) === asin),
    product,
  };
}

function dailyHistory(date: string, metrics: AdDailyMetrics[]): AdProductDailyHistory {
  const impressions = sum(metrics.map((item) => item.impressions));
  const clicks = sum(metrics.map((item) => item.clicks));
  const cost = sum(metrics.map((item) => item.cost));
  const orders = sum(metrics.map((item) => item.orders));
  const sales = sum(metrics.map((item) => item.sales));
  return {
    date,
    impressions,
    clicks,
    cost,
    orders,
    sales,
    acos: sales > 0 ? cost / sales : 0,
    cpc: clicks > 0 ? cost / clicks : 0,
    cvr: clicks > 0 ? orders / clicks : 0,
    currency: 'USD',
  };
}

function sumDaily(daily: AdProductDailyHistory[]): AdProductHistoryLedger['totals'] {
  const impressions = sum(daily.map((item) => item.impressions));
  const clicks = sum(daily.map((item) => item.clicks));
  const cost = sum(daily.map((item) => item.cost));
  const orders = sum(daily.map((item) => item.orders));
  const sales = sum(daily.map((item) => item.sales));
  return {
    impressions,
    clicks,
    cost,
    orders,
    sales,
    acos: sales > 0 ? cost / sales : 0,
    cpc: clicks > 0 ? cost / clicks : 0,
    cvr: clicks > 0 ? orders / clicks : 0,
    currency: 'USD',
  };
}

function inferStage(
  configuredStage: string | undefined,
  daily: AdProductDailyHistory[],
  totals: AdProductHistoryLedger['totals'],
): { inferredStage: string; stageReasons: string[] } {
  if (configuredStage) {
    return {
      inferredStage: configuredStage,
      stageReasons: [`产品配置阶段为 ${configuredStage}。`],
    };
  }
  if (daily.length === 0) {
    return {
      inferredStage: 'unknown',
      stageReasons: ['当前范围没有广告日级数据，无法判断产品推广阶段。'],
    };
  }
  if (totals.orders === 0 && totals.clicks > 0) {
    return {
      inferredStage: 'keyword_exploration',
      stageReasons: ['有点击和花费但订单不足，仍处于关键词/投放探索。'],
    };
  }
  if (totals.orders >= 3 && totals.acos > 0 && totals.acos <= 0.35) {
    return {
      inferredStage: 'stable_conversion',
      stageReasons: ['已有多个订单且 ACOS 处于可控区间，具备稳定转化迹象。'],
    };
  }
  if (totals.orders >= 3) {
    return {
      inferredStage: 'declining_repair',
      stageReasons: ['已有订单但效率未达稳定阈值，需要继续修复广告效率。'],
    };
  }
  return {
    inferredStage: 'cold_start',
    stageReasons: ['样本较少，仍处于冷启动观察。'],
  };
}

function groupByDate(metrics: AdDailyMetrics[]): Map<string, AdDailyMetrics[]> {
  const byDate = new Map<string, AdDailyMetrics[]>();
  for (const metric of metrics) {
    byDate.set(metric.date, [...(byDate.get(metric.date) || []), metric]);
  }
  return byDate;
}

function metricInScope(metric: AdDailyMetrics, scope: AdProductHistoryScope): boolean {
  if (metric.date < scope.dateFrom || metric.date > scope.dateTo) return false;
  if (metric.storeName && metric.storeName !== scope.storeName) return false;
  if (metric.marketplaceCode && metric.marketplaceCode !== scope.marketplaceCode) return false;
  if (scope.asin && metric.asin && normalizedAsin(metric.asin) !== normalizedAsin(scope.asin)) return false;
  if (scope.batchId && metric.batchId && metric.batchId !== scope.batchId) return false;
  return true;
}

function eventInScope(event: CreateOperationEventInput | OperationEvent, scope: AdProductHistoryScope): boolean {
  if (event.eventDate < scope.dateFrom || event.eventDate > scope.dateTo) return false;
  if (event.storeName && event.storeName !== scope.storeName) return false;
  if (event.marketplaceCode && event.marketplaceCode !== scope.marketplaceCode) return false;
  if (scope.asin && event.asin && normalizedAsin(event.asin) !== normalizedAsin(scope.asin)) return false;
  return true;
}

function productInScope(product: ProductStrategyContext, scope: AdProductHistoryScope): boolean {
  return !scope.asin || normalizedAsin(product.asin) === normalizedAsin(scope.asin);
}

function normalizedAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function sum(values: Array<number | null | undefined>): number {
  const total = values.reduce<number>((result, value) => {
    const numeric = Number(value);
    return result + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
  return Number(total.toFixed(4));
}
