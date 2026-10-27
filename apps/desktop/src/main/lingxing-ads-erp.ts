// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { type LingxingAdsSsoController, ADS_SSO_TIMEOUT_MS, ERP_ADS_ENTRY_READY_ATTEMPTS, ERP_ADS_ENTRY_READY_POLL_MS, type LingxingAdsProfileEvidence, ADS_PROFILE_LIST_PATH } from './lingxing-ads-contracts';
import { observeLingxingAdsProfileResponses, ensureAdsProfileResponseSlot, consumeObservedAdsProfileResponse } from './lingxing-ads-responses';
import { findAuthenticatedAdsPage, waitForAuthenticatedAdsPage } from './lingxing-ads-state';
import { isPageClosed, adsBrowserClosedError, errorMessage } from './lingxing-ads-values';
import { dismissLingxingAdsChangeAnnouncements } from './lingxing-ads-announcements';
import { selectLingxingAdsProfileEvidence } from './lingxing-ads-identity';

export async function ensureLingxingErpAuthenticated(page: Page, credentials: Readonly<{
    username: string;
    password: string;
}>): Promise<{
    sessionReused: boolean;
}> {
    const accountInput = page
        .locator('input[name="account"], input[placeholder*="用户名"], input[placeholder*="手机号"]')
        .first();
    const passwordInput = page.locator('input[name="pwd"], input[type="password"]').first();
    const needsLogin = await accountInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (needsLogin) {
        if (!await passwordInput.isVisible({ timeout: 5000 }).catch(() => false)) {
            throw new Error('领星 ERP 密码输入框不可见，隔离 Ads 会话登录已阻断。');
        }
        await accountInput.fill(credentials.username);
        await passwordInput.fill(credentials.password);
        await Promise.all([
            page.waitForURL(/\/erp\/home|\/erp\/index|dashboard|home|index/, { timeout: 30000 })
                .catch(() => undefined),
            page.locator('button.loginBtn, button:has-text("登录")').first().click({ timeout: 15000 }),
        ]);
        await page.waitForTimeout(2000);
    }
    const state = await page.evaluate(() => ({
        bodyText: (document.body?.innerText ?? '').slice(0, 8192),
        hasAccountInput: Boolean(document.querySelector('input[name="account"]')),
    }));
    let currentUrl: URL;
    try {
        currentUrl = new URL(page.url());
    }
    catch {
        throw new Error('领星 ERP 登录完成后的页面地址无效，隔离 Ads 会话已阻断。');
    }
    if (currentUrl.origin !== 'https://erp.lingxing.com'
        || state.hasAccountInput
        || /账号登录|微信登录/.test(state.bodyText)) {
        throw new Error('领星 ERP 隔离 Ads 会话登录未完成，请检查账号、密码或验证码要求。');
    }
    return { sessionReused: !needsLogin };
}

export async function openLingxingAdsFromErp(controller: LingxingAdsSsoController): Promise<Page> {
    const activePage = controller.getPage();
    const context = controller.getContext();
    if (!activePage || !context) {
        throw new Error('领星 ERP 可见浏览器尚未就绪，Ads SSO 已阻断。');
    }
    observeLingxingAdsProfileResponses(context);
    const currentAdsPage = await findAuthenticatedAdsPage(context.pages());
    if (currentAdsPage) {
        ensureAdsProfileResponseSlot(currentAdsPage);
        controller.setActivePage(currentAdsPage);
        await currentAdsPage.bringToFront();
        return currentAdsPage;
    }
    const erpEntry = await findVisibleLingxingAdsEntry(activePage, context);
    if (!erpEntry) {
        throw new Error('领星 ERP 登录完成后未停留在可信 ERP 页面，Ads SSO 已阻断。');
    }
    const { page: erpPage, entry: adsMenu } = erpEntry;
    const popupPromise = context.waitForEvent('page', { timeout: ADS_SSO_TIMEOUT_MS })
        .catch(() => null);
    await adsMenu.click({ timeout: 15000 });
    let entryResolved = false;
    const navigationPromise = (async (): Promise<Page> => {
        const deadline = Date.now() + ADS_SSO_TIMEOUT_MS;
        while (!entryResolved && Date.now() < deadline) {
            const candidates = [erpPage!, ...context.pages()];
            const adsCandidate = candidates.find((candidate) => {
                try {
                    const url = new URL(candidate.url());
                    return url.origin === 'https://ads.lingxing.com'
                        && !/\/restartLogin(?:\/|$)/i.test(url.pathname);
                }
                catch {
                    return false;
                }
            });
            if (adsCandidate)
                return adsCandidate;
            await erpPage!.waitForTimeout(200);
        }
        if (entryResolved)
            return erpPage!;
        throw new Error('从领星 ERP 打开 Ads 后，页面在限定时间内未出现。');
    })();
    let adsPage = await Promise.race([popupPromise, navigationPromise]);
    if (!adsPage) {
        entryResolved = true;
        throw new Error('从领星 ERP 打开 Ads 后，没有检测到可见 Ads 页面。');
    }
    if (isPageClosed(adsPage)) {
        entryResolved = true;
        throw adsBrowserClosedError();
    }
    let firstAdsUrl: URL | null = null;
    try {
        firstAdsUrl = new URL(adsPage.url());
    }
    catch {
        firstAdsUrl = null;
    }
    if (firstAdsUrl?.origin === 'https://ads.lingxing.com'
        && /\/restartLogin(?:\/|$)/i.test(firstAdsUrl.pathname)) {
        try {
            adsPage = await navigationPromise;
        }
        catch {
            throw new Error('领星 ERP 已登录，但 Ads SSO 未建立；请保留窗口并从当前 ERP 左侧“广告”入口重试，直接打开 Ads 地址无效。');
        }
    }
    entryResolved = true;
    if (isPageClosed(adsPage))
        throw adsBrowserClosedError();
    try {
        await adsPage.waitForLoadState('domcontentloaded', { timeout: ADS_SSO_TIMEOUT_MS });
        await adsPage.waitForURL(/^https:\/\/ads\.lingxing\.com\//i, { timeout: ADS_SSO_TIMEOUT_MS });
    }
    catch (error) {
        if (isPageClosed(adsPage) || /page|context|browser.*closed|target.*closed/i.test(errorMessage(error))) {
            throw adsBrowserClosedError();
        }
        throw error;
    }
    await waitForAuthenticatedAdsPage(adsPage);
    await dismissLingxingAdsChangeAnnouncements(adsPage);
    ensureAdsProfileResponseSlot(adsPage);
    controller.setActivePage(adsPage);
    await adsPage.bringToFront();
    return adsPage;
}

export async function findVisibleLingxingAdsEntry(activePage: Page, context: BrowserContext): Promise<Readonly<{
    page: Page;
    entry: Locator;
}> | null> {
    for (let attempt = 0; attempt < ERP_ADS_ENTRY_READY_ATTEMPTS; attempt += 1) {
        const erpCandidates = [...new Set([activePage, ...context.pages()])]
            .filter((page) => {
            try {
                return new URL(page.url()).origin === 'https://erp.lingxing.com';
            }
            catch {
                return false;
            }
        });
        for (const candidate of erpCandidates) {
            const entries: Locator[] = [
                candidate.getByRole('menuitem', { name: /广告/ }).first(),
                candidate.getByRole('link', { name: /广告/ }).first(),
            ];
            if (typeof candidate.locator === 'function') {
                entries.push(candidate
                    .locator('aside a, aside button, nav a, nav button, .el-menu-item, [class*="sidebar"] a, [class*="sidebar"] [role="menuitem"]')
                    .filter({ hasText: /^\s*广告\s*$/u })
                    .first());
            }
            for (const entry of entries) {
                if (await entry.isVisible({ timeout: 250 }).catch(() => false)) {
                    return { page: candidate, entry };
                }
            }
        }
        if (attempt + 1 < ERP_ADS_ENTRY_READY_ATTEMPTS) {
            await activePage.waitForTimeout(ERP_ADS_ENTRY_READY_POLL_MS);
        }
    }
    return null;
}

export async function restoreAuthenticatedLingxingErpPage(controller: LingxingAdsSsoController): Promise<boolean> {
    const context = controller.getContext();
    if (!context)
        return false;
    for (const page of context.pages()) {
        if (isPageClosed(page))
            continue;
        try {
            if (new URL(page.url()).origin !== 'https://erp.lingxing.com')
                continue;
        }
        catch {
            continue;
        }
        const title = await page.title().catch(() => '');
        const bodyText = await page
            .evaluate(() => (document.body?.innerText ?? '').slice(0, 8192))
            .catch(() => '');
        const hasAccountInput = typeof page.locator === 'function'
            && await page
                .locator('input[name="account"], input[placeholder*="用户名"], input[placeholder*="手机号"]')
                .first()
                .isVisible({ timeout: 250 })
                .catch(() => false);
        if (hasAccountInput || /账号登录|微信登录|登录领星/u.test(`${title}\n${bodyText}`))
            continue;
        controller.setActivePage(page);
        await page.bringToFront();
        return true;
    }
    return false;
}

export async function readLingxingAdsProfileEvidence(page: Page, expectedAlias: string): Promise<LingxingAdsProfileEvidence> {
    if (isPageClosed(page))
        throw adsBrowserClosedError();
    let currentUrl: URL;
    try {
        currentUrl = new URL(page.url());
    }
    catch {
        throw new Error('领星 Ads 当前页面地址无效，店铺身份识别已阻断。');
    }
    if (currentUrl.origin !== 'https://ads.lingxing.com'
        || /\/restartLogin(?:\/|$)/i.test(currentUrl.pathname)) {
        throw new Error('领星 Ads SSO 尚未建立，不能读取店铺身份。');
    }
    const observedResponse = await consumeObservedAdsProfileResponse(page);
    if (observedResponse) {
        if (!observedResponse.ok) {
            throw new Error('领星 Ads 店铺身份请求失败，登录已阻断。');
        }
        return selectLingxingAdsProfileEvidence(await observedResponse.payload, expectedAlias);
    }
    const responsePromise = page.waitForResponse((response) => {
        try {
            const responseUrl = new URL(response.url());
            return responseUrl.origin === 'https://ads.lingxing.com'
                && responseUrl.pathname === ADS_PROFILE_LIST_PATH
                && response.request().method() === 'POST';
        }
        catch {
            return false;
        }
    }, { timeout: ADS_SSO_TIMEOUT_MS });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: ADS_SSO_TIMEOUT_MS });
    const response = await responsePromise;
    await dismissLingxingAdsChangeAnnouncements(page);
    if (!response.ok()) {
        throw new Error('领星 Ads 店铺身份请求失败，登录已阻断。');
    }
    return selectLingxingAdsProfileEvidence(await response.json(), expectedAlias);
}
