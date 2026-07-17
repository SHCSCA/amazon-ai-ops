import type {
  BusinessQuantDiagnostic,
  OperationEventView,
  OperationScope,
  ProductHistoryLedgerView,
  ProductStrategyContextView,
} from './types';

export type ProductEventScope = 'global' | 'product' | 'ad_object' | 'other_product';

export interface ProductManagementSummary {
  productKey: string;
  asin: string;
  title: string;
  skuLine: string;
  stage?: string;
  status?: string;
  cost: number;
  sales: number;
  orders: number;
  clicks: number;
  acos: number;
  cvr: number;
  cpc: number;
  activeDays: number;
  lastMetricDate?: string;
  targetAcos?: number;
  diagnosticCount: number;
  highRiskCount: number;
  productEventCount: number;
  globalEventCount: number;
  eventCount: number;
  configured: boolean;
}

export interface ProductTimelineItem {
  event: OperationEventView;
  scope: Exclude<ProductEventScope, 'other_product'>;
}

export interface ProductCanonicalSummary {
  asin?: string;
  cost?: number;
  sales?: number;
  orders?: number;
  clicks?: number;
}

const PRODUCT_CONTEXT_COST_KEYS = [
  'purchaseCost',
  'firstLegCost',
  'fbaFee',
  'referralFeeRate',
  'storageFee',
  'otherCost',
  'currentPrice',
  'minPrice',
  'targetNetMargin',
  'targetAcos',
  'targetTacos',
] as const;

export function normalizeProductPortfolioRows(
  rows: unknown,
  scope: Pick<OperationScope, 'storeName' | 'marketplaceCode'>,
): ProductStrategyContextView[] {
  if (!Array.isArray(rows)) return [];
  const expectedStore = normalizedMatchValue(scope.storeName);
  const expectedMarketplace = normalizedMatchValue(scope.marketplaceCode);
  if (!expectedStore || !expectedMarketplace) return [];

  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const storeName = normalizedMatchValue(row.store_name ?? row.storeName);
    const marketplaceCode = normalizedMatchValue(row.marketplace_code ?? row.marketplaceCode);
    if (storeName !== expectedStore) return [];
    if (marketplaceCode !== expectedMarketplace) return [];

    const asin = normalizeAsin(String(row.asin || ''));
    if (!asin) return [];
    const rawCost = row.cost && typeof row.cost === 'object'
      ? row.cost as Record<string, unknown>
      : undefined;
    const cost = rawCost
      ? Object.fromEntries(PRODUCT_CONTEXT_COST_KEYS.flatMap((key) => {
          const numeric = Number(rawCost[key]);
          return Number.isFinite(numeric) ? [[key, numeric]] : [];
        })) as ProductStrategyContextView['cost']
      : undefined;

    return [{
      asin,
      parentAsin: clean(String(row.parentAsin ?? row.parent_asin ?? '')) || undefined,
      msku: clean(String(row.msku ?? '')) || undefined,
      sku: clean(String(row.sku ?? '')) || undefined,
      title: clean(String(row.title ?? '')) || undefined,
      productStage: clean(String(row.productStage ?? row.product_stage ?? '')) || undefined,
      status: clean(String(row.status ?? '')) || undefined,
      cost,
    }];
  });
}

export function mergeProductStrategyContexts(
  ...groups: ProductStrategyContextView[][]
): ProductStrategyContextView[] {
  const merged = new Map<string, ProductStrategyContextView>();
  for (const group of groups) {
    for (const product of group || []) {
      const asin = normalizeAsin(product.asin);
      if (!asin) continue;
      const existing = merged.get(asin);
      const next: ProductStrategyContextView = existing ? { ...existing } : { asin };
      for (const [key, value] of Object.entries(product)) {
        if (key === 'cost' || key === 'asin' || value === undefined) continue;
        (next as unknown as Record<string, unknown>)[key] = value;
      }
      if (existing?.cost || product.cost) {
        next.cost = { ...(existing?.cost || {}), ...(product.cost || {}) };
      }
      next.asin = asin;
      merged.set(asin, next);
    }
  }
  return [...merged.values()];
}

export function buildProductManagementSummaries(input: {
  products: ProductStrategyContextView[];
  diagnostics: BusinessQuantDiagnostic[];
  ledgers: ProductHistoryLedgerView[];
  events: OperationEventView[];
  canonicalSummary?: ProductCanonicalSummary;
}): ProductManagementSummary[] {
  const summaries = new Map<string, ProductManagementSummary>();
  const globalEventCount = countGlobalEvents(input.events);
  const ensure = (asinValue: string, configured = false): ProductManagementSummary => {
    const asin = normalizeAsin(asinValue);
    const existing = summaries.get(asin);
    if (existing) {
      existing.configured = existing.configured || configured;
      return existing;
    }
    const created: ProductManagementSummary = {
      productKey: asin,
      asin,
      title: asin,
      skuLine: '-',
      cost: 0,
      sales: 0,
      orders: 0,
      clicks: 0,
      acos: 0,
      cvr: 0,
      cpc: 0,
      activeDays: 0,
      diagnosticCount: 0,
      highRiskCount: 0,
      productEventCount: 0,
      globalEventCount,
      eventCount: globalEventCount,
      configured,
    };
    summaries.set(asin, created);
    return created;
  };

  for (const product of input.products || []) {
    const asin = normalizeAsin(product.asin);
    if (!asin) continue;
    const summary = ensure(asin, true);
    summary.title = product.title?.trim() || asin;
    summary.skuLine = [product.msku, product.sku]
      .map((item) => item?.trim())
      .filter(Boolean)
      .join(' / ') || '-';
    summary.stage = product.productStage;
    summary.status = product.status;
    summary.targetAcos = optionalNumber(product.cost?.targetAcos);
  }

  for (const diagnostic of input.diagnostics || []) {
    const asin = normalizeAsin(diagnostic.asin);
    if (!asin) continue;
    const summary = ensure(asin);
    summary.cost += numberValue(diagnostic.spend);
    summary.sales += numberValue(diagnostic.sales);
    summary.orders += numberValue(diagnostic.orders);
    summary.clicks += numberValue(diagnostic.clicks);
    summary.diagnosticCount += 1;
    if (diagnostic.severity === 'high' || diagnostic.quantStatus === 'waste') summary.highRiskCount += 1;
  }

  for (const ledger of input.ledgers || []) {
    const asin = normalizeAsin(ledger.asin);
    if (!asin) continue;
    const summary = ensure(asin);
    summary.cost = Math.max(summary.cost, numberValue(ledger.totals.cost));
    summary.sales = Math.max(summary.sales, numberValue(ledger.totals.sales));
    summary.orders = Math.max(summary.orders, numberValue(ledger.totals.orders));
    summary.clicks = Math.max(summary.clicks, numberValue(ledger.totals.clicks));
    summary.activeDays = Math.max(summary.activeDays, numberValue(ledger.activeDays));
    if (ledger.lastMetricDate && (!summary.lastMetricDate || ledger.lastMetricDate > summary.lastMetricDate)) {
      summary.lastMetricDate = ledger.lastMetricDate;
    }
    summary.stage = summary.stage || ledger.inferredStage;
  }

  if (input.canonicalSummary) {
    const asin = normalizeAsin(input.canonicalSummary.asin);
    if (asin) {
      const summary = ensure(asin);
      summary.cost = numberValue(input.canonicalSummary.cost);
      summary.sales = numberValue(input.canonicalSummary.sales);
      summary.orders = numberValue(input.canonicalSummary.orders);
      summary.clicks = numberValue(input.canonicalSummary.clicks);
    }
  }

  for (const event of input.events || []) {
    const asin = normalizeAsin(event.asin);
    if (!asin) continue;
    const summary = ensure(asin);
    summary.productEventCount += 1;
    summary.eventCount = summary.productEventCount + summary.globalEventCount;
  }

  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      cost: roundMoney(summary.cost),
      sales: roundMoney(summary.sales),
      acos: summary.sales > 0 ? summary.cost / summary.sales : 0,
      cpc: summary.clicks > 0 ? summary.cost / summary.clicks : 0,
      cvr: summary.clicks > 0 ? summary.orders / summary.clicks : 0,
    }))
    .sort((left, right) => right.cost - left.cost
      || right.highRiskCount - left.highRiskCount
      || right.eventCount - left.eventCount
      || left.title.localeCompare(right.title)
      || left.asin.localeCompare(right.asin));
}

export function buildProductTimeline(input: {
  selectedAsin: string;
  events: OperationEventView[];
}): ProductTimelineItem[] {
  const selectedAsin = normalizeAsin(input.selectedAsin);
  return (input.events || [])
    .map((event) => ({ event, scope: classifyOperationEventScope(event, selectedAsin) }))
    .filter((item): item is ProductTimelineItem => item.scope === 'global' || item.scope === 'product' || item.scope === 'ad_object')
    .sort((left, right) => right.event.eventDate.localeCompare(left.event.eventDate)
      || scopePriority(left.scope) - scopePriority(right.scope)
      || right.event.id - left.event.id);
}

export function classifyOperationEventScope(event: OperationEventView, selectedAsin?: string): ProductEventScope {
  const eventAsin = normalizeAsin(event.asin);
  const scopeAsin = normalizeAsin(selectedAsin);
  const hasAdObject = Boolean(clean(event.campaignName) || clean(event.adGroupName));
  if (!eventAsin && !hasAdObject) return 'global';
  if (scopeAsin && eventAsin === scopeAsin && hasAdObject) return 'ad_object';
  if (scopeAsin && eventAsin === scopeAsin) return 'product';
  return 'other_product';
}

export function formatScopeProductLabel(scopeAsin: string | undefined, products: ProductStrategyContextView[]): string {
  const asin = normalizeAsin(scopeAsin);
  if (!asin) return '全部产品';
  const product = (products || []).find((item) => normalizeAsin(item.asin) === asin);
  const title = product?.title?.trim();
  return title ? `${title} / ${asin}` : asin;
}

function countGlobalEvents(events: OperationEventView[]): number {
  return (events || []).filter((event) => classifyOperationEventScope(event) === 'global').length;
}

function scopePriority(scope: Exclude<ProductEventScope, 'other_product'>): number {
  if (scope === 'product') return 1;
  if (scope === 'ad_object') return 2;
  return 3;
}

function normalizeAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function clean(value?: string): string {
  return String(value || '').trim();
}

function normalizedMatchValue(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(4));
}
