import type {
  BusinessQuantDiagnostic,
  OperationEventView,
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

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(4));
}
