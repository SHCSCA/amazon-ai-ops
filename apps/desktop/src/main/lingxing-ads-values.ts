// 职责模块保留原有公开接口及安全校验边界。
import { normalizeLingxingCollectionStoreName, normalizeProviderExternalAccountId, } from '@amazon-ai-ops/shared-types';
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { MAX_IDENTITY_LENGTH, CONTROL_CHARACTERS, LINGXING_SAFE_SELECTOR_ID } from './lingxing-ads-contracts';

export function normalizedKeywordTargetText(value: unknown): string {
    return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

export function requireLingxingSelectorId(value: unknown, label: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized
        || normalized.length > MAX_IDENTITY_LENGTH
        || CONTROL_CHARACTERS.test(normalized)
        || !LINGXING_SAFE_SELECTOR_ID.test(normalized)) {
        throw new Error(`领星 Ads ${label}无效，对象识别已阻断。`);
    }
    return normalized;
}

export function parseLingxingBidCents(value: unknown): number | null {
    const normalized = String(value ?? '').normalize('NFKC').trim();
    const match = /^\$?\s*(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
    if (!match)
        return null;
    const cents = (Number(match[1]) * 100) + Number((match[2] ?? '').padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function normalizedKeywordMatchType(value: unknown): 'exact' | 'phrase' | 'broad' | '' {
    const normalized = normalizedKeywordTargetText(value);
    if (['exact', 'exact match', '精准', '精确', '精准匹配', '精确匹配'].includes(normalized))
        return 'exact';
    if (['phrase', 'phrase match', '词组', '短语', '词组匹配', '短语匹配'].includes(normalized))
        return 'phrase';
    if (['broad', 'broad match', '广泛', '广泛匹配'].includes(normalized))
        return 'broad';
    return '';
}

export function normalizeAccountIdentity(value: unknown): string | null {
    if (typeof value !== 'string'
        || value.length > MAX_IDENTITY_LENGTH
        || CONTROL_CHARACTERS.test(value))
        return null;
    const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
    return normalized && normalized.length <= MAX_IDENTITY_LENGTH ? normalized : null;
}

export function normalizeLingxingAdsStoreText(value: unknown): string | undefined {
    return normalizeLingxingCollectionStoreName(value)?.replace(/\s+/g, ' ').trim();
}

export function adsBrowserClosedError(): Error {
    return new Error('Ads 可见浏览器已关闭；ERP 已连接，可继续只读采集，请点击“重试 Ads”恢复广告身份识别。');
}

export function isPageClosed(page: Page): boolean {
    return typeof page.isClosed === 'function' && page.isClosed();
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
