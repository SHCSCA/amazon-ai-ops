// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { type LingxingAdsProfileResponseSlot, type CapturedLingxingAdsProfileResponse, ADS_PROFILE_LIST_PATH, ADS_PROFILE_ENTRY_RESPONSE_GRACE_MS } from './lingxing-ads-contracts';

export const observedAdsProfileContexts = new WeakSet<BrowserContext>();

export const adsProfileResponseSlots = new WeakMap<Page, LingxingAdsProfileResponseSlot>();

export function ensureAdsProfileResponseSlot(page: Page): LingxingAdsProfileResponseSlot {
    const current = adsProfileResponseSlots.get(page);
    if (current)
        return current;
    let resolve!: (response: CapturedLingxingAdsProfileResponse) => void;
    const promise = new Promise<CapturedLingxingAdsProfileResponse>((accept) => {
        resolve = accept;
    });
    const created = { promise, resolve, settled: false };
    adsProfileResponseSlots.set(page, created);
    return created;
}

export function isLingxingAdsProfileListResponse(response: Response): boolean {
    try {
        const responseUrl = new URL(response.url());
        return responseUrl.origin === 'https://ads.lingxing.com'
            && responseUrl.pathname === ADS_PROFILE_LIST_PATH
            && response.request().method() === 'POST';
    }
    catch {
        return false;
    }
}

export function observeLingxingAdsProfileResponses(context: BrowserContext): void {
    if (observedAdsProfileContexts.has(context)
        || typeof context.on !== 'function')
        return;
    observedAdsProfileContexts.add(context);
    context.on('response', (response) => {
        if (!isLingxingAdsProfileListResponse(response))
            return;
        let responsePage: Page;
        try {
            responsePage = response.frame().page();
        }
        catch {
            return;
        }
        const slot = ensureAdsProfileResponseSlot(responsePage);
        if (slot.settled)
            return;
        slot.settled = true;
        slot.resolve({
            ok: response.ok(),
            payload: response.json(),
        });
    });
}

export async function consumeObservedAdsProfileResponse(page: Page): Promise<CapturedLingxingAdsProfileResponse | null> {
    const slot = adsProfileResponseSlots.get(page);
    if (!slot)
        return null;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            slot.promise,
            new Promise<null>((resolve) => {
                timeoutId = setTimeout(() => resolve(null), ADS_PROFILE_ENTRY_RESPONSE_GRACE_MS);
            }),
        ]);
    }
    finally {
        if (timeoutId)
            clearTimeout(timeoutId);
        adsProfileResponseSlots.delete(page);
    }
}
