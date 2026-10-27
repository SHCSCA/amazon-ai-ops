// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { type LegacyLingxingAdsDropdownReference, ADS_STORE_FILTER_READY_ATTEMPTS, ADS_STORE_FILTER_READY_POLL_MS } from './lingxing-ads-contracts';
import { normalizeLingxingAdsStoreText, isPageClosed, adsBrowserClosedError } from './lingxing-ads-values';
import { clearLingxingTransientToast } from './lingxing-ads-announcements';

export async function readVisibleLegacyLingxingAdsDropdowns(page: Page): Promise<Readonly<{
    references: readonly LegacyLingxingAdsDropdownReference[];
    stableIdentity: boolean;
}>> {
    const visibleDropdowns = page.locator('.el-select-dropdown:visible');
    const visibleCount = await visibleDropdowns.count();
    if (typeof visibleDropdowns.evaluateAll !== 'function') {
        return {
            references: Array.from({ length: visibleCount }, (_, visibleIndex) => ({
                documentIndex: null,
                visibleIndex,
            })),
            stableIdentity: false,
        };
    }
    const documentIndexes = await visibleDropdowns.evaluateAll((elements) => {
        const allDropdowns = [...document.querySelectorAll('.el-select-dropdown')];
        return elements.map((element) => allDropdowns.indexOf(element));
    });
    if (documentIndexes.length !== visibleCount || documentIndexes.some((index) => index < 0)) {
        return {
            references: Array.from({ length: visibleCount }, (_, visibleIndex) => ({
                documentIndex: null,
                visibleIndex,
            })),
            stableIdentity: false,
        };
    }
    return {
        references: documentIndexes.map((documentIndex, visibleIndex) => ({
            documentIndex,
            visibleIndex,
        })),
        stableIdentity: true,
    };
}

export function legacyLingxingAdsDropdown(page: Page, reference: LegacyLingxingAdsDropdownReference): ReturnType<Page['locator']> {
    return reference.documentIndex === null
        ? page.locator('.el-select-dropdown:visible').nth(reference.visibleIndex)
        : page.locator('.el-select-dropdown').nth(reference.documentIndex);
}

export async function exactLegacyLingxingAdsStoreRowIndexes(dropdown: ReturnType<Page['locator']>, expected: string): Promise<number[]> {
    const rows = dropdown.locator('li.el-select-dropdown__item[title]');
    const titles = await rows.evaluateAll((elements) => (elements.map((element) => element.getAttribute('title'))));
    return titles.flatMap((title, rowIndex) => (normalizeLingxingAdsStoreText(title) === expected ? [rowIndex] : []));
}

export function assertLingxingAdsSelectedStoreTags(selectedTags: readonly string[], expectedAlias: string): void {
    const expected = normalizeLingxingAdsStoreText(expectedAlias);
    const normalizedTags = selectedTags.map((tag) => normalizeLingxingAdsStoreText(tag));
    if (!expected
        || normalizedTags.some((tag) => !tag)
        || normalizedTags.length !== 1
        || normalizedTags[0] !== expected) {
        throw new Error(`领星 Ads 当前范围没有唯一锁定美国站店铺 ${expected || expectedAlias}，操作已阻断。`);
    }
}

export async function trySelectOnlyLegacyLingxingAdsStore(page: Page, expected: string, displayAlias: string): Promise<boolean> {
    const selects = page.locator('.el-select.is-multiple:visible');
    if (await selects.count() === 0)
        return false;
    const alreadySelected: number[] = [];
    for (let index = 0; index < await selects.count(); index += 1) {
        const tags = await selects.nth(index)
            .locator('.el-select__tags .el-select__tags-text')
            .allTextContents();
        try {
            assertLingxingAdsSelectedStoreTags(tags, expected);
            alreadySelected.push(index);
        }
        catch {
        }
    }
    if (alreadySelected.length === 1)
        return true;
    if (alreadySelected.length > 1) {
        throw new Error(`领星 Ads 页面存在多个已锁定 ${displayAlias} 的店铺选择器，操作已阻断。`);
    }
    const matchingSelects: Array<{
        controlIndex: number;
        dropdown: LegacyLingxingAdsDropdownReference;
    }> = [];
    for (let index = 0; index < await selects.count(); index += 1) {
        const storeSelect = selects.nth(index);
        const beforeClick = await readVisibleLegacyLingxingAdsDropdowns(page);
        await clearLingxingTransientToast(page);
        await storeSelect.click();
        const afterClick = await readVisibleLegacyLingxingAdsDropdowns(page);
        const previouslyVisible = new Set(beforeClick.references.flatMap((reference) => (reference.documentIndex === null ? [] : [reference.documentIndex])));
        const openedByCurrentControl = beforeClick.stableIdentity && afterClick.stableIdentity
            ? afterClick.references.filter((reference) => (reference.documentIndex !== null && !previouslyVisible.has(reference.documentIndex)))
            : afterClick.references;
        let matchCount = 0;
        let matchingDropdown: LegacyLingxingAdsDropdownReference | null = null;
        for (const dropdownReference of openedByCurrentControl) {
            const rowIndexes = await exactLegacyLingxingAdsStoreRowIndexes(legacyLingxingAdsDropdown(page, dropdownReference), expected);
            matchCount += rowIndexes.length;
            if (rowIndexes.length === 1)
                matchingDropdown = dropdownReference;
            if (rowIndexes.length > 1) {
                throw new Error(`领星 Ads 店铺选择器中存在重复的 ${displayAlias}，操作已阻断。`);
            }
        }
        await page.keyboard.press('Escape').catch(() => undefined);
        if (matchCount === 1 && matchingDropdown) {
            matchingSelects.push({ controlIndex: index, dropdown: matchingDropdown });
        }
        if (matchCount > 1) {
            throw new Error(`领星 Ads 店铺选择器中存在重复的 ${displayAlias}，操作已阻断。`);
        }
    }
    if (matchingSelects.length === 0)
        return false;
    if (matchingSelects.length > 1) {
        throw new Error(`领星 Ads 页面存在多个包含 ${displayAlias} 的店铺选择器，操作已阻断。`);
    }
    const matched = matchingSelects[0];
    const storeSelect = selects.nth(matched.controlIndex);
    const dropdown = legacyLingxingAdsDropdown(page, matched.dropdown);
    if (matched.dropdown.documentIndex === null
        || !await dropdown.isVisible().catch(() => false)) {
        await clearLingxingTransientToast(page);
        await storeSelect.click();
    }
    await dropdown.waitFor({ state: 'visible', timeout: 10000 });
    const rows = dropdown.locator('li.el-select-dropdown__item[title]');
    const rowIndexes = await exactLegacyLingxingAdsStoreRowIndexes(dropdown, expected);
    if (rowIndexes.length > 1) {
        throw new Error(`领星 Ads 店铺选择器中存在重复的 ${displayAlias}，操作已阻断。`);
    }
    if (rowIndexes.length !== 1) {
        throw new Error(`领星 Ads 页面无法定位店铺 ${displayAlias}，操作已阻断。`);
    }
    const targetRow = rows.nth(rowIndexes[0]);
    await targetRow.hover();
    const onlyAction = targetRow.locator('.select-tag').getByText('仅筛选此项', { exact: true });
    if (!await onlyAction.isVisible({ timeout: 5000 }).catch(() => false)) {
        throw new Error(`领星 Ads 店铺 ${displayAlias} 的“仅筛选此项”操作不可见，操作已阻断。`);
    }
    await onlyAction.click({ timeout: 10000 });
    await page.waitForTimeout(600);
    assertLingxingAdsSelectedStoreTags(await storeSelect.locator('.el-select__tags .el-select__tags-text').allTextContents(), expected);
    return true;
}

export function isExactLingxingAdsUsStoreOption(label: string | null | undefined, expected: string): boolean {
    const normalizedLabel = normalizeLingxingAdsStoreText(label);
    return normalizedLabel === expected || normalizedLabel === `${expected} 美国`;
}

export function assertLingxingAdsFilterSelectedStore(selectedLabels: readonly string[], expected: string, displayAlias: string): void {
    if (selectedLabels.length !== 1 || !isExactLingxingAdsUsStoreOption(selectedLabels[0], expected)) {
        throw new Error(`领星 Ads 当前筛选没有唯一锁定美国站店铺 ${displayAlias}，请重新选择当前店铺后重试 Ads。`);
    }
}

export async function trySelectOnlyCurrentLingxingAdsStore(page: Page, expected: string, displayAlias: string): Promise<boolean> {
    const controls = page.locator('.fs-wrap.multiple:visible');
    const matches: Array<{
        controlIndex: number;
        optionIndex: number;
    }> = [];
    for (let controlIndex = 0; controlIndex < await controls.count(); controlIndex += 1) {
        const control = controls.nth(controlIndex);
        const dropdown = control.locator('.fs-dropdown');
        let optionLabels = await control
            .locator('.fs-option .fs-option-label-detail')
            .allTextContents();
        let optionIndexes = optionLabels.flatMap((label, optionIndex) => (isExactLingxingAdsUsStoreOption(label, expected) ? [optionIndex] : []));
        let openedForDiscovery = false;
        if (optionIndexes.length === 0 && !await dropdown.isVisible().catch(() => false)) {
            const trigger = control.locator('.fs-label-wrap');
            if (await trigger.isVisible().catch(() => false)) {
                await clearLingxingTransientToast(page);
                await trigger.click({ timeout: 5000 });
                openedForDiscovery = await dropdown
                    .waitFor({ state: 'visible', timeout: 1000 })
                    .then(() => true)
                    .catch(() => false);
                if (openedForDiscovery) {
                    await page.waitForTimeout(150);
                    optionLabels = await control
                        .locator('.fs-option .fs-option-label-detail')
                        .allTextContents();
                    optionIndexes = optionLabels.flatMap((label, optionIndex) => (isExactLingxingAdsUsStoreOption(label, expected) ? [optionIndex] : []));
                }
            }
        }
        if (openedForDiscovery) {
            await page.keyboard.press('Escape').catch(() => undefined);
            await dropdown.waitFor({ state: 'hidden', timeout: 1000 }).catch(() => undefined);
        }
        if (optionIndexes.length > 1) {
            throw new Error(`领星 Ads 店铺筛选器中存在重复的 ${displayAlias}，操作已阻断。`);
        }
        if (optionIndexes.length === 1) {
            matches.push({ controlIndex, optionIndex: optionIndexes[0] });
        }
    }
    if (matches.length === 0)
        return false;
    if (matches.length > 1) {
        throw new Error(`领星 Ads 页面存在多个包含 ${displayAlias} 的店铺筛选器，操作已阻断。`);
    }
    const { controlIndex } = matches[0];
    const control = controls.nth(controlIndex);
    const selectedLabels = await control
        .locator('.fs-option.selected .fs-option-label-detail')
        .allTextContents();
    const visibleLabels = await control.locator('.fs-label-wrap .fs-label').allTextContents();
    if (selectedLabels.length === 1
        && isExactLingxingAdsUsStoreOption(selectedLabels[0], expected)
        && visibleLabels.length === 1
        && isExactLingxingAdsUsStoreOption(visibleLabels[0], expected)) {
        return true;
    }
    await clearLingxingTransientToast(page);
    await control.locator('.fs-label-wrap').click();
    const dropdown = control.locator('.fs-dropdown');
    await dropdown.waitFor({ state: 'visible', timeout: 10000 });
    const options = control.locator('.fs-option');
    const optionLabels = await options
        .locator('.fs-option-label-detail')
        .allTextContents();
    const targetIndexes = optionLabels.flatMap((label, optionIndex) => (isExactLingxingAdsUsStoreOption(label, expected) ? [optionIndex] : []));
    if (targetIndexes.length !== 1) {
        throw new Error(`领星 Ads 店铺筛选器无法唯一定位 ${displayAlias}，操作已阻断。`);
    }
    const targetIndex = targetIndexes[0];
    const selectedIndexes = await options.evaluateAll((elements) => elements.flatMap((element, optionIndex) => (element.classList.contains('selected') ? [optionIndex] : [])));
    for (const selectedIndex of selectedIndexes) {
        if (selectedIndex !== targetIndex)
            await options.nth(selectedIndex).click();
    }
    const target = options.nth(targetIndex);
    if (!await target.evaluate((element) => element.classList.contains('selected'))) {
        await target.click();
    }
    assertLingxingAdsFilterSelectedStore(await control.locator('.fs-option.selected .fs-option-label-detail').allTextContents(), expected, displayAlias);
    const save = control.locator('.fs-save');
    await save.waitFor({ state: 'visible', timeout: 5000 });
    await save.click({ timeout: 10000 });
    await dropdown.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(300);
    assertLingxingAdsFilterSelectedStore(await control.locator('.fs-option.selected .fs-option-label-detail').allTextContents(), expected, displayAlias);
    assertLingxingAdsFilterSelectedStore(await control.locator('.fs-label-wrap .fs-label').allTextContents(), expected, displayAlias);
    return true;
}

export async function selectOnlyLingxingAdsStore(page: Page, expectedAlias: string): Promise<void> {
    const expected = normalizeLingxingAdsStoreText(expectedAlias);
    if (!expected)
        throw new Error('领星 Ads 目标店铺名称无效，操作已阻断。');
    const displayAlias = expectedAlias.normalize('NFKC').replace(/\s+/g, ' ').trim();
    for (let attempt = 0; attempt < ADS_STORE_FILTER_READY_ATTEMPTS; attempt += 1) {
        if (isPageClosed(page))
            throw adsBrowserClosedError();
        if (await trySelectOnlyLegacyLingxingAdsStore(page, expected, displayAlias))
            return;
        if (await trySelectOnlyCurrentLingxingAdsStore(page, expected, displayAlias))
            return;
        if (attempt + 1 < ADS_STORE_FILTER_READY_ATTEMPTS) {
            await page.waitForTimeout(ADS_STORE_FILTER_READY_POLL_MS);
        }
    }
    throw new Error(`领星 Ads 页面无法唯一定位当前店铺 ${displayAlias} 的筛选器，请确认 Ads 页面已加载该店铺后重试。`);
}
