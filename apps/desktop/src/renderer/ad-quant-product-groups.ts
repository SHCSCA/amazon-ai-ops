export const UNBOUND_PRODUCT_KEY = '__unbound_product__';

type MetricLike = {
  asin?: string;
  cost?: number;
  spend?: number;
  sales?: number;
  orders?: number;
  clicks?: number;
  riskLevel?: string;
};

type TimelineLike = {
  asin?: string;
  cost?: number;
  sales?: number;
  orders?: number;
  clicks?: number;
};

type LedgerLike = {
  asin?: string;
  totalCost?: number;
  totalSales?: number;
  totalOrders?: number;
  totalClicks?: number;
  inferredStage?: string;
  totals?: {
    cost?: number;
    sales?: number;
    orders?: number;
    clicks?: number;
  };
};

type CanonicalSummaryLike = {
  asin?: string;
  cost?: number;
  sales?: number;
  orders?: number;
  clicks?: number;
};

export interface AdQuantProductGroup {
  productKey: string;
  asin?: string;
  label: string;
  cost: number;
  sales: number;
  orders: number;
  clicks: number;
  acos: number;
  diagnosticCount: number;
  timelineCount: number;
  ledgerCount: number;
  highRiskCount: number;
  stage?: string;
}

export function buildAdQuantProductGroups(input: {
  scopeAsin?: string;
  canonicalSummary?: CanonicalSummaryLike;
  diagnostics: MetricLike[];
  timelines: TimelineLike[];
  ledgers: LedgerLike[];
}): { groups: AdQuantProductGroup[]; selectedProductKey: string } {
  const groups = new Map<string, AdQuantProductGroup>();

  const ensureGroup = (asin?: string): AdQuantProductGroup => {
    const normalized = normalizeAsin(asin);
    const productKey = normalized || UNBOUND_PRODUCT_KEY;
    const existing = groups.get(productKey);
    if (existing) return existing;

    const created: AdQuantProductGroup = {
      productKey,
      asin: normalized || undefined,
      label: normalized || '未绑定 ASIN',
      cost: 0,
      sales: 0,
      orders: 0,
      clicks: 0,
      acos: 0,
      diagnosticCount: 0,
      timelineCount: 0,
      ledgerCount: 0,
      highRiskCount: 0,
    };
    groups.set(productKey, created);
    return created;
  };

  for (const row of input.diagnostics || []) {
    const group = ensureGroup(row.asin);
    group.cost += numberValue(row.cost ?? row.spend);
    group.sales += numberValue(row.sales);
    group.orders += numberValue(row.orders);
    group.clicks += numberValue(row.clicks);
    group.diagnosticCount += 1;
    if (String(row.riskLevel || '').toLowerCase() === 'high') group.highRiskCount += 1;
  }

  for (const row of input.timelines || []) {
    const group = ensureGroup(row.asin);
    group.timelineCount += 1;
  }

  for (const row of input.ledgers || []) {
    const group = ensureGroup(row.asin);
    group.ledgerCount += 1;
    group.stage = group.stage || row.inferredStage;
    group.cost = Math.max(group.cost, numberValue(row.totalCost ?? row.totals?.cost));
    group.sales = Math.max(group.sales, numberValue(row.totalSales ?? row.totals?.sales));
    group.orders = Math.max(group.orders, numberValue(row.totalOrders ?? row.totals?.orders));
    group.clicks = Math.max(group.clicks, numberValue(row.totalClicks ?? row.totals?.clicks));
  }

  const canonicalSummary = input.canonicalSummary;
  if (canonicalSummary) {
    const group = ensureGroup(canonicalSummary.asin || input.scopeAsin);
    group.cost = numberValue(canonicalSummary.cost);
    group.sales = numberValue(canonicalSummary.sales);
    group.orders = numberValue(canonicalSummary.orders);
    group.clicks = numberValue(canonicalSummary.clicks);
  }

  const scopedAsin = normalizeAsin(input.scopeAsin);
  const groupsSorted = [...groups.values()]
    .map((group) => ({
      ...group,
      acos: group.sales > 0 ? group.cost / group.sales : 0,
    }))
    .sort((left, right) => {
      if (scopedAsin && left.productKey === scopedAsin) return -1;
      if (scopedAsin && right.productKey === scopedAsin) return 1;
      return right.cost - left.cost
        || right.highRiskCount - left.highRiskCount
        || left.label.localeCompare(right.label);
    });

  return {
    groups: groupsSorted,
    selectedProductKey: groupsSorted[0]?.productKey || '',
  };
}

export function filterAdQuantByProduct<
  TDiagnostic extends { asin?: string },
  TTimeline extends { asin?: string },
  TLedger extends { asin?: string },
>(input: {
  productKey: string;
  diagnostics: TDiagnostic[];
  timelines: TTimeline[];
  ledgers: TLedger[];
}): { diagnostics: TDiagnostic[]; timelines: TTimeline[]; ledgers: TLedger[] } {
  return {
    diagnostics: input.diagnostics.filter((item) => productMatches(item.asin, input.productKey)),
    timelines: input.timelines.filter((item) => productMatches(item.asin, input.productKey)),
    ledgers: input.ledgers.filter((item) => productMatches(item.asin, input.productKey)),
  };
}

export function productGroupScopePatch(productKey: string): { asin?: string; currency: 'USD' } {
  if (!productKey || productKey === UNBOUND_PRODUCT_KEY) return { asin: undefined, currency: 'USD' };
  return { asin: productKey, currency: 'USD' };
}

function productMatches(asin: string | undefined, productKey: string): boolean {
  if (!productKey) return true;
  if (productKey === UNBOUND_PRODUCT_KEY) return !normalizeAsin(asin);
  return normalizeAsin(asin) === productKey;
}

function normalizeAsin(value?: string): string {
  return String(value || '').trim().toUpperCase();
}

function numberValue(value?: number): number {
  return Number.isFinite(value) ? Number(value) : 0;
}
