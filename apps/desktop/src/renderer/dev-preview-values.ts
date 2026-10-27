// 历史开发预览职责模块；启用边界由原引导入口统一控制。
import type { ProductCost, StoreRecord } from '@amazon-ai-ops/shared-types';

export function clonePreviewSnapshot<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => clonePreviewSnapshot(item)) as T;
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePreviewSnapshot(item)])) as T;
    }
    return value;
}

export function previewRevision(prefix: string, id: number, version: number): string {
    const value = (BigInt(id) * 1000000n + BigInt(version)).toString(16).padStart(64, '0');
    return `${prefix}:${value}`;
}

export function previewInputRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} 必须是对象。`);
    }
    return value as Record<string, unknown>;
}

export function previewRequiredText(value: unknown, label: string, maxLength: number): string {
    if (typeof value !== 'string')
        throw new Error(`${label} 必须是文本。`);
    const normalized = value.trim();
    if (!normalized)
        throw new Error(`${label} 不能为空。`);
    if (normalized.length > maxLength)
        throw new Error(`${label} 不能超过 ${maxLength} 个字符。`);
    return normalized;
}

export function previewOptionalText(value: unknown, label: string, maxLength: number): string | undefined {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'string')
        throw new Error(`${label} 必须是文本。`);
    const normalized = value.trim();
    if (normalized.length > maxLength)
        throw new Error(`${label} 不能超过 ${maxLength} 个字符。`);
    return normalized || undefined;
}

export function previewAsin(value: unknown): string {
    const asin = previewRequiredText(value, 'ASIN', 64).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(asin))
        throw new Error('ASIN 包含不支持的字符。');
    return asin;
}

export function previewIsoDate(value: unknown, label: string): string {
    const date = previewRequiredText(value, label, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match)
        throw new Error(`${label} 必须使用 YYYY-MM-DD。`);
    const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (parsed.getUTCFullYear() !== Number(match[1])
        || parsed.getUTCMonth() !== Number(match[2]) - 1
        || parsed.getUTCDate() !== Number(match[3]))
        throw new Error(`${label} 必须是真实日历日期。`);
    return date;
}

export function previewPositiveInteger(value: unknown, label: string): number {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0)
        throw new Error(`${label} 必须是正整数。`);
    return number;
}

export function previewTextArray(value: unknown, label: string, maxItems: number, maxItemLength: number): string[] {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw new Error(`${label} 必须是文本数组。`);
    if (value.length > maxItems)
        throw new Error(`${label} 不能超过 ${maxItems} 项。`);
    return value.map((item, index) => {
        if (typeof item !== 'string')
            throw new Error(`${label}[${index}] 必须是文本。`);
        const normalized = item.trim();
        if (normalized.length > maxItemLength) {
            throw new Error(`${label}[${index}] 不能超过 ${maxItemLength} 个字符。`);
        }
        return normalized;
    }).filter(Boolean);
}

export function assertPreviewIdentityHints(store: StoreRecord, input: Record<string, unknown>): void {
    const normalizedStoreName = store.displayName.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    for (const value of [input.storeName, input.store_name].filter((item) => item !== undefined)) {
        if (String(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase() !== normalizedStoreName) {
            throw new Error('PREVIEW_STORE_IDENTITY_MISMATCH: storeName');
        }
    }
    for (const value of [input.marketplace, input.marketplaceCode, input.marketplace_code]
        .filter((item) => item !== undefined)) {
        if (String(value).trim().toUpperCase() !== 'US') {
            throw new Error('PREVIEW_STORE_IDENTITY_MISMATCH: marketplace');
        }
    }
    if (input.currency !== undefined && String(input.currency).trim().toUpperCase() !== 'USD') {
        throw new Error('PREVIEW_STORE_IDENTITY_MISMATCH: currency');
    }
}

export const PREVIEW_COST_FIELDS = [
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

export function previewProductCost(productId: number, value: unknown, current?: ProductCost): ProductCost | undefined {
    if (value === undefined)
        return current ? clonePreviewSnapshot(current) : undefined;
    const input = previewInputRecord(value, '产品成本');
    if (Object.keys(input).length === 0)
        throw new Error('产品成本补丁不能为空。');
    const allowed = new Set<string>(PREVIEW_COST_FIELDS);
    const unknown = Object.keys(input).filter((key) => !allowed.has(key));
    if (unknown.length > 0)
        throw new Error(`产品成本包含不支持的字段：${unknown.join(', ')}`);
    const base: ProductCost = current ? clonePreviewSnapshot(current) : {
        productId,
        purchaseCost: 0,
        firstLegCost: 0,
        fbaFee: 0,
        referralFeeRate: 0.15,
        storageFee: 0,
        otherCost: 0,
        currentPrice: 0,
        minPrice: 0,
        targetNetMargin: 0,
        targetAcos: 0,
        targetTacos: 0,
    };
    for (const key of PREVIEW_COST_FIELDS) {
        if (input[key] === undefined)
            continue;
        const number = Number(input[key]);
        if (!Number.isFinite(number))
            throw new Error(`${key} 必须是有限数字。`);
        if (key === 'targetNetMargin') {
            if (number < -1 || number > 1)
                throw new Error(`${key} 必须在 -1 到 1 之间。`);
        }
        else if (key === 'referralFeeRate' || key === 'targetAcos' || key === 'targetTacos') {
            if (number < 0 || number > 1)
                throw new Error(`${key} 必须在 0 到 1 之间。`);
        }
        else if (number < 0) {
            throw new Error(`${key} 不能为负数。`);
        }
        base[key] = number;
    }
    base.productId = productId;
    base.updatedAt = new Date().toISOString();
    return base;
}

export function normalizedPreviewText(value: unknown): string {
    return String(value ?? '').trim();
}

export function normalizedPreviewPath(value: unknown): string {
    return normalizedPreviewText(value).replace(/\\/g, '/').toLowerCase();
}
