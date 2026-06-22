import type { ProductStrategyContextView } from './types';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanCost(value: unknown): ProductStrategyContextView['cost'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cost = value as Record<string, unknown>;
  const cleaned = {
    purchaseCost: cleanNumber(cost.purchaseCost),
    firstLegCost: cleanNumber(cost.firstLegCost),
    fbaFee: cleanNumber(cost.fbaFee),
    referralFeeRate: cleanNumber(cost.referralFeeRate),
    storageFee: cleanNumber(cost.storageFee),
    otherCost: cleanNumber(cost.otherCost),
    minPrice: cleanNumber(cost.minPrice),
    targetNetMargin: cleanNumber(cost.targetNetMargin),
    targetAcos: cleanNumber(cost.targetAcos),
    targetTacos: cleanNumber(cost.targetTacos),
  };
  return Object.values(cleaned).some((item) => item !== undefined) ? cleaned : undefined;
}

export function normalizeProductContexts(input: unknown): ProductStrategyContextView[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const asin = cleanString(row.asin).toUpperCase();
    if (!asin) return [];
    return [{
      asin,
      parentAsin: cleanString(row.parentAsin) || undefined,
      msku: cleanString(row.msku) || undefined,
      sku: cleanString(row.sku) || undefined,
      title: cleanString(row.title) || undefined,
      productStage: cleanString(row.productStage) || undefined,
      status: cleanString(row.status) || undefined,
      cost: cleanCost(row.cost),
    }];
  });
}

export function countProductsWithTargets(input: unknown): number {
  return normalizeProductContexts(input).filter((product) => {
    const cost = product.cost;
    return Number(cost?.targetAcos || 0) > 0
      || Number(cost?.targetTacos || 0) > 0
      || Number(cost?.targetNetMargin || 0) > 0
      || Number(cost?.minPrice || 0) > 0;
  }).length;
}

export function pickPrimaryProductContext(products: ProductStrategyContextView[], scopeAsin?: string): ProductStrategyContextView | undefined {
  const normalizedScopeAsin = cleanString(scopeAsin).toUpperCase();
  if (normalizedScopeAsin) {
    return products.find((product) => product.asin.toUpperCase() === normalizedScopeAsin) || products[0];
  }
  return products[0];
}
