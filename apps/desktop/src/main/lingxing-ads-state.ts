// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { isLingxingAdsLoggedInPage } from './lingxing-session-flow';
import { type LingxingAdsPageState, type LingxingVisibleProvider, ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS, ADS_NAVIGATION_CONTEXT_RETRY_WAIT_MS, ADS_SSO_TIMEOUT_MS } from './lingxing-ads-contracts';
import { errorMessage, isPageClosed } from './lingxing-ads-values';

export function isLingxingAdsExplicitlyLoggedOutPage(state: LingxingAdsPageState): boolean {
    return isLingxingProviderExplicitlyLoggedOutPage('amazon_ads', state);
}

export function isLingxingProviderExplicitlyLoggedOutPage(provider: LingxingVisibleProvider, state: LingxingAdsPageState): boolean {
    const visibleText = `${state.title ?? ''}\n${state.bodyText ?? ''}`;
    let loginPath = false;
    try {
        const currentUrl = new URL(state.url);
        const expectedOrigin = provider === 'lingxing'
            ? 'https://erp.lingxing.com'
            : 'https://ads.lingxing.com';
        loginPath = currentUrl.origin === expectedOrigin
            && /(?:^|\/)(?:login|restartLogin)(?:\/|$)/iu.test(currentUrl.pathname);
    }
    catch {
        loginPath = false;
    }
    return loginPath
        || state.hasAccountInput === true
        || state.hasPasswordInput === true
        || /您尚未登录|账号登录|密码登录|微信登录|登录领星|请从领星\s*ERP\s*进入/iu.test(visibleText);
}

export function isTransientLingxingAdsNavigationError(error: unknown): boolean {
    return /Execution context was destroyed(?:, most likely because of a navigation)?|Cannot find context with specified id/iu
        .test(errorMessage(error));
}

export async function readLingxingAdsStateAcrossNavigation<T>(page: Page, readState: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS; attempt += 1) {
        try {
            return await readState();
        }
        catch (error) {
            if (!isTransientLingxingAdsNavigationError(error)
                || attempt + 1 >= ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS) {
                throw error;
            }
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 })
                .catch((loadError) => {
                if (isPageClosed(page)
                    || /page|context|browser.*closed|target.*closed/iu.test(errorMessage(loadError))) {
                    throw loadError;
                }
            });
            await page.waitForTimeout(ADS_NAVIGATION_CONTEXT_RETRY_WAIT_MS);
        }
    }
    throw new Error('领星 Ads 页面导航完成后无法读取页面状态，操作已阻断。');
}

export async function readLingxingAdsPageStateAfterNavigation(page: Page): Promise<Readonly<{
    url: string;
    title: string;
    bodyText: string;
    hasAccountInput?: boolean;
    hasPasswordInput?: boolean;
}>> {
    for (let attempt = 0; attempt < ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS; attempt += 1) {
        try {
            return await page.evaluate(() => {
                const visible = (element: Element): boolean => {
                    const style = window.getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return !element.closest('[hidden], [aria-hidden="true"], [inert]')
                        && style.display !== 'none'
                        && style.visibility !== 'hidden'
                        && Number(style.opacity || '1') !== 0
                        && rect.width > 0
                        && rect.height > 0;
                };
                const hasAccountInput = [...document.querySelectorAll('input[name="account"], input[autocomplete="username"], input[placeholder*="用户名"], input[placeholder*="手机号"]')].some(visible);
                const hasPasswordInput = [...document.querySelectorAll('input[name="pwd"], input[type="password"], input[autocomplete="current-password"]')].some(visible);
                return {
                    url: window.location.href,
                    title: document.title,
                    bodyText: document.body?.innerText ?? '',
                    ...(hasAccountInput ? { hasAccountInput: true as const } : {}),
                    ...(hasPasswordInput ? { hasPasswordInput: true as const } : {}),
                };
            });
        }
        catch (error) {
            if (!isTransientLingxingAdsNavigationError(error)
                || attempt + 1 >= ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS) {
                throw error;
            }
            await page.waitForLoadState('domcontentloaded', { timeout: 5000 })
                .catch((loadError) => {
                if (isPageClosed(page)
                    || /page|context|browser.*closed|target.*closed/iu.test(errorMessage(loadError))) {
                    throw loadError;
                }
            });
            await page.waitForTimeout(ADS_NAVIGATION_CONTEXT_RETRY_WAIT_MS);
        }
    }
    throw new Error('领星 Ads 页面导航完成后无法读取页面状态，操作已阻断。');
}

export async function findAuthenticatedAdsPage(pages: readonly Page[]): Promise<Page | undefined> {
    for (const page of pages) {
        if (!/^https:\/\/ads\.lingxing\.com\//i.test(page.url()))
            continue;
        const state = await readAdsPageState(page);
        if (isLingxingAdsExplicitlyLoggedOutPage(state))
            continue;
        if (isLingxingAdsLoggedInPage(state))
            return page;
    }
    return undefined;
}

export async function waitForAuthenticatedAdsPage(page: Page): Promise<void> {
    const deadline = Date.now() + ADS_SSO_TIMEOUT_MS;
    while (true) {
        const state = await readAdsPageState(page);
        if (isLingxingAdsExplicitlyLoggedOutPage(state)) {
            throw new Error('领星 ERP 已登录，但 Ads SSO 未建立；请保留窗口并重新从 ERP 左侧“广告”入口进入。');
        }
        if (isLingxingAdsLoggedInPage(state))
            return;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            throw new Error('领星 ERP 已登录，但 Ads SSO 页面在限定时间内未就绪。');
        }
        await page.waitForTimeout(Math.min(500, remainingMs));
    }
}

export async function readAdsPageState(page: Page): Promise<{
    url: string;
    title: string;
    bodyText: string;
}> {
    return readLingxingAdsStateAcrossNavigation(page, async () => ({
        url: page.url(),
        title: await page.title(),
        bodyText: await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 8192)),
    }));
}
