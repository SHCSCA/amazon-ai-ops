// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { type LingxingVisibleProvider, ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS, ADS_PENDING_NAVIGATION_PAGE_RECOVERY_WAIT_MS } from './lingxing-ads-contracts';
import { isPageClosed } from './lingxing-ads-values';

export function isTrustedLingxingProviderUrl(provider: LingxingVisibleProvider, value: string): boolean {
    try {
        const currentUrl = new URL(value);
        const isLoginPath = /(?:^|\/)(?:login|restartLogin)(?:\/|$)/iu.test(currentUrl.pathname);
        return provider === 'lingxing'
            ? currentUrl.origin === 'https://erp.lingxing.com' && !isLoginPath
            : currentUrl.origin === 'https://ads.lingxing.com'
                && !isLoginPath;
    }
    catch {
        return false;
    }
}

export function findTrustedLingxingProviderReplacementPage(provider: LingxingVisibleProvider, closingPage: Page, candidates: readonly Page[]): Page | null {
    const seen = new Set<Page>();
    for (const candidate of candidates) {
        if (candidate === closingPage || seen.has(candidate))
            continue;
        seen.add(candidate);
        if (isPageClosed(candidate))
            continue;
        if (isTrustedLingxingProviderUrl(provider, candidate.url()))
            return candidate;
    }
    return null;
}

export async function findTrustedLingxingProviderPageAfterPendingNavigation(provider: LingxingVisibleProvider, observedPage: Page, readCandidates: () => readonly Page[]): Promise<Page | null> {
    for (let attempt = 0; attempt < ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS; attempt += 1) {
        if (!isPageClosed(observedPage)
            && isTrustedLingxingProviderUrl(provider, observedPage.url())) {
            return observedPage;
        }
        let candidates: readonly Page[] = [];
        try {
            candidates = readCandidates();
        }
        catch {
            candidates = [];
        }
        const replacement = findTrustedLingxingProviderReplacementPage(provider, observedPage, candidates);
        if (replacement)
            return replacement;
        if (attempt + 1 < ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS) {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, ADS_PENDING_NAVIGATION_PAGE_RECOVERY_WAIT_MS);
            });
        }
    }
    return null;
}

export function bindPendingLingxingAdsNewPageAdoption(input: Readonly<{
    observedPage: Page;
    context: Pick<BrowserContext, 'on' | 'off'>;
    readCandidates: () => readonly Page[];
    onTrustedPage: (page: Page) => void | Promise<void>;
    onUnsafeCandidates: (reason: string) => void | Promise<void>;
}>): () => void {
    let stopped = false;
    let inspectionRunning = false;
    const stop = (): void => {
        if (stopped)
            return;
        stopped = true;
        input.context.off('page', inspectCandidate);
    };
    const inspectCandidate = (): void => {
        if (stopped || inspectionRunning)
            return;
        inspectionRunning = true;
        void (async () => {
            let stableCandidate: Page | null = null;
            for (let attempt = 0; attempt < ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS; attempt += 1) {
                let candidates: readonly Page[] = [];
                try {
                    candidates = input.readCandidates();
                }
                catch {
                    candidates = [];
                }
                const trustedCandidates = [...new Set(candidates)].filter((candidate) => (candidate !== input.observedPage
                    && !isPageClosed(candidate)
                    && isTrustedLingxingProviderUrl('amazon_ads', candidate.url())));
                if (trustedCandidates.length > 1) {
                    stop();
                    await input.onUnsafeCandidates('领星 Ads 同一隔离浏览器出现多个可信页面，无法唯一继续当前店铺识别，操作已阻断。');
                    return;
                }
                const candidate = trustedCandidates[0] ?? null;
                if (candidate && candidate === stableCandidate) {
                    stop();
                    await input.onTrustedPage(candidate);
                    return;
                }
                stableCandidate = candidate;
                if (attempt + 1 < ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS) {
                    await new Promise<void>((resolve) => {
                        setTimeout(resolve, ADS_PENDING_NAVIGATION_PAGE_RECOVERY_WAIT_MS);
                    });
                }
            }
        })().finally(() => {
            inspectionRunning = false;
        });
    };
    input.context.on('page', inspectCandidate);
    inspectCandidate();
    return stop;
}

export function bindPendingLingxingAdsPageCloseOnlyLiveness(input: Readonly<{
    page: Page;
    readCandidates: () => readonly Page[];
    onTrustedReplacement: (page: Page) => void | Promise<void>;
    onClosed: (reason: string) => void | Promise<void>;
}>): void {
    let recoveryStarted = false;
    const recoverOrClose = (): void => {
        if (recoveryStarted)
            return;
        recoveryStarted = true;
        void (async () => {
            const replacement = await findTrustedLingxingProviderPageAfterPendingNavigation('amazon_ads', input.page, input.readCandidates);
            if (replacement) {
                await input.onTrustedReplacement(replacement);
                return;
            }
            await input.onClosed('可见浏览器已关闭。');
        })();
    };
    input.page.once('close', recoverOrClose);
    if (isPageClosed(input.page))
        recoverOrClose();
}
