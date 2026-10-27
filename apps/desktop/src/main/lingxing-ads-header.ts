// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { normalizedKeywordTargetText, normalizeLingxingAdsStoreText, errorMessage } from './lingxing-ads-values';
import { ADS_STORE_FILTER_READY_ATTEMPTS, ADS_STORE_FILTER_READY_POLL_MS } from './lingxing-ads-contracts';

export async function ensureLingxingAdsHeaderStore(page: Page, expectedAlias: string): Promise<void> {
    const displayAlias = String(expectedAlias ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const expectedLabels = [
        normalizedKeywordTargetText(displayAlias),
        normalizedKeywordTargetText(`${displayAlias} 美国`),
        normalizedKeywordTargetText(`${displayAlias}美国`),
    ];
    if (!displayAlias || !normalizeLingxingAdsStoreText(displayAlias)) {
        throw new Error('领星 Ads 顶部店铺名称无效，操作已阻断。');
    }
    const readHeaderState = (frame: ReturnType<Page['mainFrame']>) => frame.evaluate((labels) => {
        const normalize = (value: unknown) => String(value ?? '')
            .normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
        const visible = (element: Element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
                && Number(style.opacity || '1') !== 0 && rect.width > 0 && rect.height > 0;
        };
        const candidates = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
            const rect = element.getBoundingClientRect();
            const text = normalize(element.innerText || element.textContent);
            return visible(element) && rect.y >= 0 && rect.y <= 96 && rect.x >= 0 && rect.x <= 520
                && text.length <= 64 && text.endsWith('美国') && text.slice(0, -2).trim().length > 0;
        });
        const controls = candidates.filter((candidate) => !candidates.some((other) => (other !== candidate && candidate.contains(other))));
        const selected = controls.filter((element) => labels.includes(normalize(element.innerText || element.textContent)));
        return { selectedCount: selected.length, controlCount: controls.length };
    }, expectedLabels);
    const headerStates = await Promise.all(page.frames().map(async (frame) => ({
        frame,
        state: await readHeaderState(frame).catch(() => ({ selectedCount: 0, controlCount: 0 })),
    })));
    const selectedFrames = headerStates.filter(({ state: current }) => current.selectedCount === 1);
    if (selectedFrames.length === 1
        && headerStates.reduce((sum, current) => sum + current.state.selectedCount, 0) === 1
        && headerStates.reduce((sum, current) => sum + current.state.controlCount, 0) === 1)
        return;
    const controlFrames = headerStates.filter(({ state: current }) => current.controlCount > 0);
    if (controlFrames.length !== 1 || controlFrames[0].state.controlCount !== 1) {
        throw new Error(`领星 Ads 顶部无法唯一定位当前账户下拉 ${displayAlias}，操作已阻断。`);
    }
    await controlFrames[0].frame.evaluate(() => {
        const normalize = (value: unknown) => String(value ?? '')
            .normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
        const candidates = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const text = normalize(element.innerText || element.textContent);
            return style.display !== 'none' && style.visibility !== 'hidden'
                && Number(style.opacity || '1') !== 0 && rect.width > 0 && rect.height > 0
                && rect.y >= 0 && rect.y <= 96 && rect.x >= 0 && rect.x <= 520
                && text.length <= 64 && text.endsWith('美国') && text.slice(0, -2).trim().length > 0;
        });
        const controls = candidates.filter((candidate) => !candidates.some((other) => (other !== candidate && candidate.contains(other))));
        if (controls.length !== 1)
            throw new Error('ADS_HEADER_CONTROL_CHANGED');
        controls[0].click();
    }).catch((error) => {
        if (!/execution context was destroyed|frame was detached|navigation/iu.test(errorMessage(error)))
            throw error;
    });
    await page.waitForTimeout(150);
    const refreshedHeaderStates = await Promise.all(page.frames().map(async (frame) => ({
        state: await readHeaderState(frame).catch(() => ({ selectedCount: 0, controlCount: 0 })),
    })));
    const refreshedSelectedCount = refreshedHeaderStates
        .reduce((sum, current) => sum + current.state.selectedCount, 0);
    const refreshedControlCount = refreshedHeaderStates
        .reduce((sum, current) => sum + current.state.controlCount, 0);
    if (refreshedSelectedCount === 1 && refreshedControlCount === 1) {
        await page.keyboard.press('Escape').catch(() => undefined);
        return;
    }
    const readTargetState = (frame: ReturnType<Page['mainFrame']>) => frame.evaluate((labels) => {
        const normalize = (value: unknown) => String(value ?? '')
            .normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
        const visible = (element: Element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
                && Number(style.opacity || '1') !== 0 && rect.width > 0 && rect.height > 0;
        };
        const matches = [...document.querySelectorAll<HTMLElement>('body *')]
            .filter((element) => visible(element) && labels.includes(normalize(element.innerText || element.textContent)));
        const leaves = matches.filter((candidate) => !matches.some((other) => (other !== candidate && candidate.contains(other))));
        return { count: leaves.length };
    }, expectedLabels);
    const targetStates = await Promise.all(page.frames().map(async (frame) => ({
        frame,
        state: await readTargetState(frame).catch(() => ({ count: 0 })),
    })));
    const targetFrames = targetStates.filter(({ state: current }) => current.count > 0);
    if (targetFrames.length !== 1 || targetFrames[0].state.count !== 1) {
        throw new Error(`领星 Ads 顶部账户列表无法唯一定位 ${displayAlias} 美国，操作已阻断。`);
    }
    await targetFrames[0].frame.evaluate((labels) => {
        const normalize = (value: unknown) => String(value ?? '')
            .normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
        const matches = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden'
                && Number(style.opacity || '1') !== 0 && rect.width > 0 && rect.height > 0
                && labels.includes(normalize(element.innerText || element.textContent));
        });
        const leaves = matches.filter((candidate) => !matches.some((other) => (other !== candidate && candidate.contains(other))));
        if (leaves.length !== 1)
            throw new Error('ADS_HEADER_TARGET_CHANGED');
        leaves[0].click();
    }, expectedLabels).catch((error) => {
        if (!/execution context was destroyed|frame was detached|navigation/iu.test(errorMessage(error)))
            throw error;
    });
    for (let attempt = 0; attempt < ADS_STORE_FILTER_READY_ATTEMPTS; attempt += 1) {
        const selectedCounts = await Promise.all(page.frames().map((frame) => frame.evaluate((labels) => {
            const normalize = (value: unknown) => String(value ?? '')
                .normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
            const candidates = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden'
                    && Number(style.opacity || '1') !== 0 && rect.width > 0 && rect.height > 0
                    && rect.y >= 0 && rect.y <= 96 && rect.x >= 0 && rect.x <= 520
                    && labels.includes(normalize(element.innerText || element.textContent));
            });
            return candidates.filter((candidate) => !candidates.some((other) => (other !== candidate && candidate.contains(other)))).length;
        }, expectedLabels).catch(() => 0)));
        const selectedCount = selectedCounts.reduce((sum, count) => sum + count, 0);
        if (selectedCount === 1)
            return;
        if (attempt + 1 < ADS_STORE_FILTER_READY_ATTEMPTS) {
            await page.waitForTimeout(ADS_STORE_FILTER_READY_POLL_MS);
        }
    }
    throw new Error(`领星 Ads 顶部账户切换到 ${displayAlias} 后回读不一致，操作已阻断。`);
}
