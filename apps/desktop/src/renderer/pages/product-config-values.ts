// 保留页面编排与原有交互，纯值规则和展示规则按职责复用。
import type { AppRoute } from '../types';
import { type ProductCostInput, DEFAULT_COST, type ProductCostKey, PRODUCT_COST_FIELD_LABELS, RATE_COST_FIELDS, STAGE_OPTIONS } from './product-config-contracts';

export function buildCostInputFromProduct(product: any): ProductCostInput {
    const source = product?.cost || {};
    const numberOrDefault = (key: keyof ProductCostInput) => {
        const value = Number(source[key]);
        return Number.isFinite(value) ? value : DEFAULT_COST[key];
    };
    return {
        purchaseCost: numberOrDefault('purchaseCost'),
        firstLegCost: numberOrDefault('firstLegCost'),
        fbaFee: numberOrDefault('fbaFee'),
        referralFeeRate: numberOrDefault('referralFeeRate'),
        storageFee: numberOrDefault('storageFee'),
        otherCost: numberOrDefault('otherCost'),
        currentPrice: numberOrDefault('currentPrice'),
        minPrice: numberOrDefault('minPrice'),
        targetNetMargin: numberOrDefault('targetNetMargin'),
        targetAcos: numberOrDefault('targetAcos'),
        targetTacos: numberOrDefault('targetTacos'),
    };
}

export function isProductConfigAutoSaveField(key: string): key is ProductCostKey {
    return Object.prototype.hasOwnProperty.call(PRODUCT_COST_FIELD_LABELS, key);
}

export function stepPrecision(step: string): number {
    const decimal = String(step || '').split('.')[1];
    return Math.max(2, decimal?.length || 0);
}

export function productConfigNudgeCostValue(key: ProductCostKey, value: number, direction: 'up' | 'down', step = '0.01'): number {
    const delta = Math.abs(Number(step) || 0.01);
    const current = Number.isFinite(Number(value)) ? Number(value) : 0;
    const next = current + (direction === 'up' ? delta : -delta);
    const clampedLow = Math.max(0, next);
    const clamped = RATE_COST_FIELDS.has(key) ? Math.min(1, clampedLow) : clampedLow;
    return Number(clamped.toFixed(stepPrecision(step)));
}

export function normalizeProductConfigAcosPercent(value: string | number): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100)
        return null;
    return Number((parsed / 100).toFixed(4));
}

export function productConfigProductKey(product: any): string {
    return String(product?.id ?? product?.asin ?? '');
}

export function buildProductConfigBulkSaveInput(product: any, scope: {
    storeName: string;
    marketplaceCode: string;
}, targetAcos: number) {
    return {
        product: {
            asin: String(product?.asin || '').trim(),
            parentAsin: product?.parent_asin || product?.parentAsin || '',
            msku: product?.msku || '',
            sku: product?.sku || '',
            title: product?.title || '',
            productStage: product?.product_stage || product?.productStage || 'keyword_exploration',
            status: product?.status || 'active',
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
        },
        cost: {
            ...buildCostInputFromProduct(product),
            targetAcos,
        },
    };
}

export function navigate(route: AppRoute) {
    window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export function toNumber(value: string | number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export function stageLabel(stage?: string): string {
    return STAGE_OPTIONS.find((item) => item.value === stage)?.label || stage || '未配置';
}
