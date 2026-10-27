// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { type LingxingAdsAnnouncementAction, ADS_CHANGE_ANNOUNCEMENT_DIALOG_SELECTOR, ADS_CHANGE_ANNOUNCEMENT_TITLE_SELECTOR, ADS_CHANGE_ANNOUNCEMENT_MAX_INTERACTIONS, LINGXING_TRANSIENT_TOAST_SELECTOR } from './lingxing-ads-contracts';
import { isPageClosed, adsBrowserClosedError } from './lingxing-ads-values';

export function isLingxingAdsChangeAnnouncementTitle(value: string): boolean {
    return /变更公告/u.test(value.normalize('NFKC').replace(/\s+/g, ' ').trim());
}

export async function readLingxingAdsChangeAnnouncementAction(page: Page): Promise<LingxingAdsAnnouncementAction | null> {
    const snapshots = await page.evaluate(({ dialogSelector, titleSelector }) => {
        const visible = (element: Element): element is HTMLElement => {
            if (!(element instanceof HTMLElement))
                return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none'
                && style.visibility !== 'hidden'
                && Number(style.opacity || '1') !== 0
                && rect.width > 0
                && rect.height > 0;
        };
        return [...document.querySelectorAll<HTMLElement>(dialogSelector)]
            .filter(visible)
            .map((dialog) => {
            const headerTexts = [...dialog.querySelectorAll<HTMLElement>(titleSelector)]
                .filter(visible)
                .map((element) => element.innerText || element.textContent || '');
            const firstLine = (dialog.innerText || dialog.textContent || '')
                .split(/\r?\n/u)
                .map((line) => line.trim())
                .find(Boolean) ?? '';
            const actions = [...dialog.querySelectorAll<HTMLElement>('button, [role="button"], a')]
                .filter(visible)
                .map((element) => element.innerText || element.textContent || '');
            return { actions, firstLine, headerTexts };
        });
    }, {
        dialogSelector: ADS_CHANGE_ANNOUNCEMENT_DIALOG_SELECTOR.replaceAll(':visible', ''),
        titleSelector: ADS_CHANGE_ANNOUNCEMENT_TITLE_SELECTOR,
    });
    const recognized: Array<{
        dialogIndex: number;
        title: string;
    }> = [];
    for (let dialogIndex = 0; dialogIndex < snapshots.length; dialogIndex += 1) {
        const snapshot = snapshots[dialogIndex];
        const title = snapshot.headerTexts.find(isLingxingAdsChangeAnnouncementTitle)
            ?? snapshot.firstLine;
        if (isLingxingAdsChangeAnnouncementTitle(title)) {
            recognized.push({ dialogIndex, title: title.normalize('NFKC').replace(/\s+/g, ' ').trim() });
        }
    }
    if (recognized.length === 0)
        return null;
    if (recognized.length !== 1) {
        throw new Error('领星 Ads 同时出现多个变更公告弹窗，无法安全判断处理顺序，操作已阻断。');
    }
    const current = recognized[0];
    const accepted: Array<{
        actionIndex: number;
        actionText: string;
    }> = [];
    const actionTexts = snapshots[current.dialogIndex].actions;
    for (let actionIndex = 0; actionIndex < actionTexts.length; actionIndex += 1) {
        const actionText = actionTexts[actionIndex]
            .normalize('NFKC')
            .replace(/\s+/g, ' ')
            .trim();
        const next = /^下一条\s*[（(]\s*(\d+)\s*\/\s*(\d+)\s*[）)]$/u.exec(actionText);
        if (next) {
            const currentPage = Number(next[1]);
            const totalPages = Number(next[2]);
            if (!Number.isSafeInteger(currentPage)
                || !Number.isSafeInteger(totalPages)
                || currentPage < 1
                || totalPages < 1
                || currentPage > totalPages
                || totalPages > ADS_CHANGE_ANNOUNCEMENT_MAX_INTERACTIONS) {
                throw new Error(`领星 Ads 变更公告页码 ${actionText} 无效，操作已阻断。`);
            }
            accepted.push({ actionIndex, actionText });
            continue;
        }
        if (/^(?:我知道了|知道了|完成|关闭公告|关闭)$/u.test(actionText)) {
            accepted.push({ actionIndex, actionText });
        }
    }
    if (accepted.length !== 1) {
        throw new Error('领星 Ads 变更公告没有唯一可识别的“下一条/关闭”动作，操作已阻断。');
    }
    return {
        dialogIndex: current.dialogIndex,
        actionIndex: accepted[0].actionIndex,
        actionText: accepted[0].actionText,
        fingerprint: `${current.title}\u0000${accepted[0].actionText}`,
    };
}

export async function dismissLingxingAdsChangeAnnouncements(page: Page): Promise<number> {
    if (isPageClosed(page))
        throw adsBrowserClosedError();
    if (typeof page.locator !== 'function' || typeof page.evaluate !== 'function')
        return 0;
    let currentUrl: URL;
    try {
        currentUrl = new URL(page.url());
    }
    catch {
        throw new Error('领星 Ads 变更公告所在页面地址无效，操作已阻断。');
    }
    if (currentUrl.origin !== 'https://ads.lingxing.com') {
        throw new Error('仅允许在可信领星 Ads 页面处理变更公告，操作已阻断。');
    }
    let interactions = 0;
    let initialPollsRemaining = 4;
    while (interactions < ADS_CHANGE_ANNOUNCEMENT_MAX_INTERACTIONS) {
        const action = await readLingxingAdsChangeAnnouncementAction(page);
        if (!action) {
            if (interactions === 0 && initialPollsRemaining > 0) {
                initialPollsRemaining -= 1;
                await page.waitForTimeout(250);
                continue;
            }
            return interactions;
        }
        const dialogs = page.locator(ADS_CHANGE_ANNOUNCEMENT_DIALOG_SELECTOR);
        const dialog = dialogs.nth(action.dialogIndex);
        const button = dialog.locator('button:visible, [role="button"]:visible, a:visible')
            .nth(action.actionIndex);
        await button.click({ timeout: 5000 });
        interactions += 1;
        let changed = false;
        for (let poll = 0; poll < 20; poll += 1) {
            await page.waitForTimeout(100);
            const next = await readLingxingAdsChangeAnnouncementAction(page);
            if (!next || next.fingerprint !== action.fingerprint) {
                changed = true;
                break;
            }
        }
        if (!changed) {
            throw new Error(`领星 Ads 变更公告动作“${action.actionText}”执行后页面未推进，操作已阻断。`);
        }
    }
    throw new Error(`领星 Ads 变更公告超过 ${ADS_CHANGE_ANNOUNCEMENT_MAX_INTERACTIONS} 次有界处理，操作已阻断。`);
}

export async function clearLingxingTransientToast(page: Page): Promise<void> {
    const toastCandidates = page.locator(LINGXING_TRANSIENT_TOAST_SELECTOR) as Locator & {
        first?: () => Locator;
    };
    if (typeof toastCandidates.isVisible !== 'function')
        return;
    const toast = typeof toastCandidates.first === 'function'
        ? toastCandidates.first()
        : toastCandidates;
    if (!await toast.isVisible({ timeout: 250 }).catch(() => false))
        return;
    const close = toast.locator('[aria-label="关闭"], [title="关闭"], .el-icon-close, .anticon-close, button').first();
    if (await close.isVisible({ timeout: 250 }).catch(() => false)) {
        await close.click({ timeout: 1000 }).catch(() => undefined);
    }
    if (await toast.isVisible({ timeout: 250 }).catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => undefined);
    }
    if (await toast.isVisible({ timeout: 250 }).catch(() => false)) {
        await toast.waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {
            throw new Error('领星页面提示层未关闭，店铺选择已阻断。');
        });
    }
}
