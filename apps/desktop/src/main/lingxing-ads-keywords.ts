// 职责模块保留原有公开接口及安全校验边界。
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { PlaywrightLingxingKeywordBidPage } from '@amazon-ai-ops/action-executor';
import { type LingxingKeywordTargetRowSnapshot, type DiscoverLingxingAdsKeywordTargetInput, type LingxingVisibleLink, LINGXING_KEYWORD_TARGET_PATH, type NavigateLingxingAdsCampaignKeywordTargetInput, ADS_SSO_TIMEOUT_MS, LINGXING_KEYWORD_DETAIL_PATH, type DiscoveredLingxingAdsKeywordTarget } from './lingxing-ads-contracts';
import { normalizedKeywordTargetText, normalizedKeywordMatchType, parseLingxingBidCents, requireLingxingSelectorId, isPageClosed, adsBrowserClosedError, errorMessage } from './lingxing-ads-values';
import { dismissLingxingAdsChangeAnnouncements } from './lingxing-ads-announcements';
import { ensureLingxingAdsHeaderStore } from './lingxing-ads-header';

export function resolveLingxingKeywordTargetRows(rows: readonly LingxingKeywordTargetRowSnapshot[], input: Pick<DiscoverLingxingAdsKeywordTargetInput, 'campaignName' | 'adGroupName' | 'entityName' | 'matchType' | 'currentBidCents'>): {
    adGroupId: string;
    keywordId: string;
    bidCents: number;
} {
    const expected = {
        campaignName: normalizedKeywordTargetText(input.campaignName),
        adGroupName: normalizedKeywordTargetText(input.adGroupName),
        entityName: normalizedKeywordTargetText(input.entityName),
        matchType: normalizedKeywordMatchType(input.matchType),
        currentBidCents: Number(input.currentBidCents),
    };
    if (!expected.campaignName || !expected.adGroupName || !expected.entityName
        || !expected.matchType
        || (input.currentBidCents !== 'read_current' && (!Number.isSafeInteger(expected.currentBidCents) || expected.currentBidCents < 0))) {
        throw new Error('待识别关键词的活动、广告组、关键词、匹配方式或竞价权威不完整，操作已阻断。');
    }
    const normalizedRows = rows.map((row) => ({
        ...row,
        headers: row.headers.map(normalizedKeywordTargetText),
        cellTexts: row.cellTexts.map(normalizedKeywordTargetText),
        adGroupNames: row.adGroupNames.map(normalizedKeywordTargetText),
    }));
    const matchTypeHeaders = new Set(['匹配类型', '匹配方式', '匹配模式', 'match type', 'matchtype']);
    const matchTypeHeaderCounts = normalizedRows.map((row) => (row.headers.filter((header) => matchTypeHeaders.has(header)).length));
    if (!matchTypeHeaderCounts.some((count) => count === 1)
        || matchTypeHeaderCounts.some((count) => count > 1)) {
        throw new Error('领星 Ads 关键词页缺少唯一匹配方式列，对象识别已阻断。');
    }
    const campaignHeaders = new Set(['广告活动', '广告活动名称', 'campaign', 'campaign name']);
    const campaignColumnPresent = normalizedRows.some((row) => (row.headers.some((header) => campaignHeaders.has(header))));
    const candidateRows = normalizedRows.flatMap((row) => {
        const matchTypeIndex = row.headers.findIndex((header) => matchTypeHeaders.has(header));
        const campaignIndex = row.headers.findIndex((header) => campaignHeaders.has(header));
        const rowMatchType = normalizedKeywordMatchType(row.cellTexts[matchTypeIndex]);
        const bidValues = row.bidValues.map(parseLingxingBidCents).filter((value): value is number => value !== null);
        if ((campaignColumnPresent && (campaignIndex < 0 || row.cellTexts[campaignIndex] !== expected.campaignName))
            || !row.adGroupNames.includes(expected.adGroupName)
            || !row.cellTexts.includes(expected.entityName)
            || rowMatchType !== expected.matchType
            || row.adGroupIds.length !== 1
            || row.keywordIds.length !== 1)
            return [];
        try {
            return [{
                    keywordId: requireLingxingSelectorId(row.keywordIds[0], '关键词 ID'),
                    adGroupId: requireLingxingSelectorId(row.adGroupIds[0], '广告组 ID'),
                    bidValues,
                }];
        }
        catch {
            return [];
        }
    });
    const identityGroups = new Map<string, {
        adGroupId: string;
        keywordId: string;
        bidValues: Set<number>;
    }>();
    for (const candidate of candidateRows) {
        const key = `${candidate.adGroupId}\u0000${candidate.keywordId}`;
        const group = identityGroups.get(key) ?? {
            adGroupId: candidate.adGroupId,
            keywordId: candidate.keywordId,
            bidValues: new Set<number>(),
        };
        candidate.bidValues.forEach((bid) => group.bidValues.add(bid));
        identityGroups.set(key, group);
    }
    const identities = [...identityGroups.values()].map((group) => ({
        adGroupId: group.adGroupId,
        keywordId: group.keywordId,
        bidValues: [...group.bidValues],
    }));
    if (identities.length === 1 && identities[0].bidValues.length === 1) {
        const observedBid = identities[0].bidValues[0];
        if (input.currentBidCents !== 'read_current' && observedBid !== expected.currentBidCents) {
            throw new Error(`领星 Ads 关键词 ${input.entityName} 当前竞价已变化：`
                + `报表 $${(expected.currentBidCents / 100).toFixed(2)}，页面 $${(observedBid / 100).toFixed(2)}；`
                + '建议已失效，禁止绑定或执行，请刷新数据后重新生成建议。');
        }
        return {
            adGroupId: identities[0].adGroupId,
            keywordId: identities[0].keywordId,
            bidCents: observedBid,
        };
    }
    throw new Error(`领星 Ads 关键词页无法唯一定位 ${input.campaignName} > ${input.adGroupName}`
        + ` > ${input.entityName}（${input.matchType}），操作已阻断。`);
}

export async function readLingxingVisibleLinks(page: Page): Promise<LingxingVisibleLink[]> {
    const frameLinks = await Promise.all(page.frames().map((frame) => frame.evaluate(() => ([...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
        .flatMap((anchor) => {
        const style = window.getComputedStyle(anchor);
        const rect = anchor.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0
            || rect.width <= 0 || rect.height <= 0)
            return [];
        return [{ href: anchor.href, text: anchor.innerText || anchor.textContent || '' }];
    }))).catch(() => [])));
    return frameLinks.flat();
}

export function trustedLingxingKeywordTargetUrl(rawUrl: string, expectedProfileId: string): URL | null {
    let candidate: URL;
    try {
        candidate = new URL(rawUrl, 'https://ads.lingxing.com');
    }
    catch {
        return null;
    }
    if (candidate.username || candidate.password
        || candidate.origin !== 'https://ads.lingxing.com'
        || candidate.pathname !== LINGXING_KEYWORD_TARGET_PATH)
        return null;
    const profiles = candidate.searchParams.getAll('profile_id');
    if (profiles.length === 0)
        candidate.searchParams.set('profile_id', expectedProfileId);
    else if (profiles.length !== 1 || profiles[0] !== expectedProfileId)
        return null;
    return candidate;
}

export async function navigateToLingxingAdsCampaignKeywordTarget(page: Page, input: NavigateLingxingAdsCampaignKeywordTargetInput): Promise<void> {
    if (isPageClosed(page))
        throw adsBrowserClosedError();
    const expectedProfileId = requireLingxingSelectorId(input.externalAccountId, 'profile_id');
    const expectedCampaignName = normalizedKeywordTargetText(input.campaignName);
    if (!expectedCampaignName)
        throw new Error('广告活动名称不完整，对象识别已阻断。');
    await dismissLingxingAdsChangeAnnouncements(page);
    let current = new URL(page.url());
    if (current.origin !== 'https://ads.lingxing.com'
        || /\/restartLogin(?:\/|$)/iu.test(current.pathname)) {
        throw new Error('领星 Ads 会话未就绪，对象识别已阻断。');
    }
    if (current.pathname !== LINGXING_KEYWORD_TARGET_PATH) {
        const navigationCandidates = (await readLingxingVisibleLinks(page))
            .map((link) => trustedLingxingKeywordTargetUrl(link.href, expectedProfileId))
            .filter((candidate): candidate is URL => candidate !== null);
        const unique = [...new Map(navigationCandidates.map((candidate) => [candidate.href, candidate])).values()];
        if (unique.length > 1) {
            throw new Error('领星 Ads 侧边栏无法唯一定位关键词页，操作已阻断。');
        }
        const directProfileTarget = trustedLingxingKeywordTargetUrl(`https://ads.lingxing.com${LINGXING_KEYWORD_TARGET_PATH}?profile_id=${encodeURIComponent(expectedProfileId)}`, expectedProfileId);
        const keywordTarget = unique[0] ?? directProfileTarget;
        if (!keywordTarget) {
            throw new Error('领星 Ads 当前店铺关键词路径无效，操作已阻断。');
        }
        await page.goto(keywordTarget.href, { waitUntil: 'domcontentloaded', timeout: ADS_SSO_TIMEOUT_MS });
        await dismissLingxingAdsChangeAnnouncements(page);
        current = new URL(page.url());
    }
    if (input.expectedStoreAlias) {
        await ensureLingxingAdsHeaderStore(page, input.expectedStoreAlias);
        await dismissLingxingAdsChangeAnnouncements(page);
        current = new URL(page.url());
    }
    const campaignLinks = (await readLingxingVisibleLinks(page))
        .filter((link) => String(link.text ?? '')
        .split(/\r?\n/gu)
        .map(normalizedKeywordTargetText)
        .filter(Boolean)
        .includes(expectedCampaignName))
        .map((link) => trustedLingxingKeywordTargetUrl(link.href, expectedProfileId))
        .filter((candidate): candidate is URL => candidate !== null)
        .filter((candidate) => candidate.searchParams.getAll('id').length === 1);
    const uniqueCampaignLinks = [...new Map(campaignLinks.map((candidate) => [candidate.href, candidate])).values()];
    let exactClickableCounts: number[] = [];
    let exactCampaignRowIds: string[] = [];
    if (uniqueCampaignLinks.length === 1 && uniqueCampaignLinks[0].href !== current.href) {
        await page.goto(uniqueCampaignLinks[0].href, { waitUntil: 'domcontentloaded', timeout: ADS_SSO_TIMEOUT_MS });
        await dismissLingxingAdsChangeAnnouncements(page);
        current = new URL(page.url());
    }
    else if (uniqueCampaignLinks.length > 1) {
        throw new Error(`领星 Ads 存在多个同名广告活动 ${input.campaignName}，操作已阻断。`);
    }
    else if (current.searchParams.getAll('id').length !== 1) {
        const frameCampaignRows = await Promise.all(page.frames().map((frame) => frame.evaluate((expected) => {
            const normalize = (value: unknown) => String(value ?? '')
                .normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
            return [...document.querySelectorAll<HTMLTableRowElement>('tr')].flatMap((row) => {
                const style = window.getComputedStyle(row);
                const rect = row.getBoundingClientRect();
                const lines = String(row.innerText || row.textContent || '')
                    .split(/\r?\n/gu).map(normalize).filter(Boolean);
                if (style.display === 'none' || style.visibility === 'hidden'
                    || Number(style.opacity || '1') === 0 || rect.width <= 0 || rect.height <= 0
                    || !lines.includes(expected))
                    return [];
                const exactElements = [...row.querySelectorAll<HTMLElement>('*')].filter((element) => (String(element.innerText || element.textContent || '')
                    .split(/\r?\n/gu).map(normalize).filter(Boolean)
                    .includes(expected)));
                const leaves = exactElements.filter((candidate) => !exactElements.some((other) => (other !== candidate && candidate.contains(other))));
                const lineage = [...new Set(leaves.flatMap((leaf) => {
                        const elements: HTMLElement[] = [];
                        let current: HTMLElement | null = leaf;
                        while (current && current !== row) {
                            elements.push(current);
                            current = current.parentElement;
                        }
                        elements.push(row);
                        return elements;
                    }))];
                const groups = [
                    lineage.map((element) => element.getAttribute('data-campaign-id')),
                    lineage.flatMap((element) => {
                        if (!(element instanceof HTMLAnchorElement) || !element.href)
                            return [];
                        try {
                            return new URL(element.href, window.location.href).searchParams.getAll('id');
                        }
                        catch {
                            return [];
                        }
                    }),
                    lineage.filter((element): element is HTMLInputElement => (element instanceof HTMLInputElement && element.matches('input.select-item[value]'))).map((element) => element.value),
                    lineage.filter((element): element is HTMLInputElement => (element instanceof HTMLInputElement && element.matches('input[type="checkbox"][value]'))).map((element) => element.value),
                    lineage.map((element) => element.getAttribute('data-id')),
                ].map((values) => values.filter((value): value is string => (Boolean(value && !/^(?:on|true|false)$/iu.test(value)))));
                const values = groups.find((group) => group.length > 0) ?? [];
                return [{ values }];
            });
        }, expectedCampaignName).catch(() => [])));
        const exactRows = frameCampaignRows.flat();
        exactCampaignRowIds = [...new Set(exactRows.flatMap((row) => row.values))];
        if (exactRows.length > 0 && exactCampaignRowIds.length === 1) {
            const campaignId = requireLingxingSelectorId(exactCampaignRowIds[0], '广告活动 ID');
            const directCampaignTarget = trustedLingxingKeywordTargetUrl(`https://ads.lingxing.com${LINGXING_KEYWORD_TARGET_PATH}?profile_id=${encodeURIComponent(expectedProfileId)}&id=${encodeURIComponent(campaignId)}`, expectedProfileId);
            if (!directCampaignTarget) {
                throw new Error(`领星 Ads 广告活动 ${input.campaignName} 的稳定路径无效，操作已阻断。`);
            }
            await page.goto(directCampaignTarget.href, { waitUntil: 'domcontentloaded', timeout: ADS_SSO_TIMEOUT_MS });
            await dismissLingxingAdsChangeAnnouncements(page);
            current = new URL(page.url());
        }
        const clickableFrames = current.searchParams.getAll('id').length === 1 ? [] : await Promise.all(page.frames().map(async (frame) => ({
            frame,
            count: await frame.evaluate((expected) => {
                const normalize = (value: unknown) => String(value ?? '')
                    .normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
                const matches = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
                    const style = window.getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    const lines = String(element.innerText || element.textContent || '')
                        .split(/\r?\n/gu).map(normalize).filter(Boolean);
                    return style.display !== 'none' && style.visibility !== 'hidden'
                        && Number(style.opacity || '1') !== 0 && rect.width > 0 && rect.height > 0
                        && lines.includes(expected);
                });
                const leaves = matches.filter((candidate) => !matches.some((other) => (other !== candidate && candidate.contains(other))));
                const byArea = [...leaves].sort((left, right) => {
                    const a = left.getBoundingClientRect();
                    const b = right.getBoundingClientRect();
                    return (a.width * a.height) - (b.width * b.height);
                });
                const visualTargets = byArea.filter((candidate, index) => {
                    const current = candidate.getBoundingClientRect();
                    return !byArea.slice(0, index).some((prior) => {
                        const previous = prior.getBoundingClientRect();
                        const overlapWidth = Math.max(0, Math.min(current.right, previous.right) - Math.max(current.left, previous.left));
                        const overlapHeight = Math.max(0, Math.min(current.bottom, previous.bottom) - Math.max(current.top, previous.top));
                        const smallerArea = Math.min(current.width * current.height, previous.width * previous.height);
                        return smallerArea > 0 && (overlapWidth * overlapHeight) / smallerArea >= 0.75;
                    });
                });
                return visualTargets.length;
            }, expectedCampaignName).catch(() => 0),
        })));
        exactClickableCounts = clickableFrames.map((candidate) => candidate.count);
        const exactFrames = clickableFrames.filter((candidate) => candidate.count > 0);
        if (exactFrames.length === 1 && exactFrames[0].count === 1) {
            await exactFrames[0].frame.evaluate((expected) => {
                const normalize = (value: unknown) => String(value ?? '')
                    .normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
                const matches = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
                    const style = window.getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    const lines = String(element.innerText || element.textContent || '')
                        .split(/\r?\n/gu).map(normalize).filter(Boolean);
                    return style.display !== 'none' && style.visibility !== 'hidden'
                        && Number(style.opacity || '1') !== 0 && rect.width > 0 && rect.height > 0
                        && lines.includes(expected);
                });
                const leaves = matches.filter((candidate) => !matches.some((other) => (other !== candidate && candidate.contains(other))));
                const byArea = [...leaves].sort((left, right) => {
                    const a = left.getBoundingClientRect();
                    const b = right.getBoundingClientRect();
                    return (a.width * a.height) - (b.width * b.height);
                });
                const visualTargets = byArea.filter((candidate, index) => {
                    const current = candidate.getBoundingClientRect();
                    return !byArea.slice(0, index).some((prior) => {
                        const previous = prior.getBoundingClientRect();
                        const overlapWidth = Math.max(0, Math.min(current.right, previous.right) - Math.max(current.left, previous.left));
                        const overlapHeight = Math.max(0, Math.min(current.bottom, previous.bottom) - Math.max(current.top, previous.top));
                        const smallerArea = Math.min(current.width * current.height, previous.width * previous.height);
                        return smallerArea > 0 && (overlapWidth * overlapHeight) / smallerArea >= 0.75;
                    });
                });
                if (visualTargets.length !== 1)
                    throw new Error('ADS_CAMPAIGN_TARGET_CHANGED');
                visualTargets[0].click();
            }, expectedCampaignName).catch((error) => {
                if (!/execution context was destroyed|frame was detached|navigation/iu.test(errorMessage(error)))
                    throw error;
            });
            await page.waitForTimeout(500);
            await dismissLingxingAdsChangeAnnouncements(page);
            current = new URL(page.url());
        }
    }
    const profiles = current.searchParams.getAll('profile_id');
    const campaignIds = current.searchParams.getAll('id');
    const frameBodyTexts = await Promise.all(page.frames().map((frame) => frame
        .locator('body').innerText().catch(() => '')));
    const exactTextLines = frameBodyTexts.join('\n')
        .split(/\r?\n/gu)
        .map(normalizedKeywordTargetText)
        .filter(Boolean);
    if (current.origin !== 'https://ads.lingxing.com'
        || (current.pathname !== LINGXING_KEYWORD_TARGET_PATH
            && current.pathname !== LINGXING_KEYWORD_DETAIL_PATH)
        || profiles.length !== 1
        || profiles[0] !== expectedProfileId
        || campaignIds.length !== 1) {
        throw new Error(`领星 Ads 无法唯一进入广告活动 ${input.campaignName} 的关键词页，操作已阻断。`
            + ` 诊断：可信链接=${uniqueCampaignLinks.length}，精确可点击=${exactClickableCounts.join('/') || '未扫描'}，`
            + `活动行ID=${exactCampaignRowIds.join('|') || '无'}，path=${current.pathname}，`
            + `profile参数=${profiles.length}，profile匹配=${profiles[0] === expectedProfileId}，活动参数=${campaignIds.length}，frame=${page.frames().length}。`);
    }
    requireLingxingSelectorId(campaignIds[0], '广告活动 ID');
}

export async function discoverLingxingAdsKeywordTarget(page: Page, input: DiscoverLingxingAdsKeywordTargetInput): Promise<DiscoveredLingxingAdsKeywordTarget> {
    if (isPageClosed(page))
        throw adsBrowserClosedError();
    const current = new URL(page.url());
    if (current.origin !== 'https://ads.lingxing.com'
        || (current.pathname !== LINGXING_KEYWORD_TARGET_PATH
            && current.pathname !== LINGXING_KEYWORD_DETAIL_PATH)) {
        throw new Error('领星 Ads 当前页面不是关键词竞价页，对象识别已阻断。');
    }
    const profileValues = current.searchParams.getAll('profile_id');
    const campaignValues = current.searchParams.getAll('id');
    const expectedProfileId = requireLingxingSelectorId(input.externalAccountId, 'profile_id');
    if (profileValues.length !== 1 || requireLingxingSelectorId(profileValues[0], 'profile_id') !== expectedProfileId) {
        throw new Error('领星 Ads 当前页面不属于当前店铺，对象识别已阻断。');
    }
    if (campaignValues.length !== 1) {
        throw new Error('领星 Ads 当前页面缺少唯一广告活动身份，对象识别已阻断。');
    }
    const campaignId = requireLingxingSelectorId(campaignValues[0], '广告活动 ID');
    const expected = {
        campaignName: normalizedKeywordTargetText(input.campaignName),
        adGroupName: normalizedKeywordTargetText(input.adGroupName),
        entityName: normalizedKeywordTargetText(input.entityName),
        matchType: normalizedKeywordMatchType(input.matchType),
        currentBidCents: Number(input.currentBidCents),
    };
    if (!expected.campaignName || !expected.adGroupName || !expected.entityName || !expected.matchType
        || (input.currentBidCents !== 'read_current' && (!Number.isSafeInteger(expected.currentBidCents) || expected.currentBidCents < 0))) {
        throw new Error('待识别关键词的活动、广告组、关键词、匹配方式或竞价权威不完整，操作已阻断。');
    }
    const frameRows = await Promise.all(page.frames().map((frame) => frame.evaluate(() => ([...document.querySelectorAll<HTMLTableRowElement>('tr')]
        .flatMap((row) => {
        const markers = [...row.querySelectorAll<HTMLInputElement>('input.select-item[value], input[type="checkbox"][value]')];
        if (markers.length === 0 || row.querySelectorAll('td').length === 0)
            return [];
        const normalize = (value: string | null | undefined) => String(value ?? '')
            .replace(/\s+/gu, ' ')
            .trim();
        const table = row.closest('table');
        const headers = table
            ? [...table.querySelectorAll<HTMLElement>('thead tr:last-child th')].map((header) => normalize(header.innerText || header.textContent))
            : [];
        const cells = [...row.querySelectorAll<HTMLElement>(':scope > td, :scope > th')];
        const bidColumnIndex = headers.findIndex((header) => header === '竞价');
        const namedBidInputs = bidColumnIndex >= 0
            ? [...(cells[bidColumnIndex]?.querySelectorAll<HTMLInputElement>('input') ?? [])]
            : [];
        const bidInputs = [...new Set([
                ...row.querySelectorAll<HTMLInputElement>('input.form-control.price'),
                ...namedBidInputs,
            ])];
        const adGroupIds = [...new Set([...row.querySelectorAll<HTMLAnchorElement>('a[href*="ad_group_id="]')]
                .flatMap((anchor) => {
                try {
                    const values = new URL(anchor.href, window.location.href).searchParams.getAll('ad_group_id');
                    return values.length === 1 ? values : [];
                }
                catch {
                    return [];
                }
            }))];
        const adGroupNames = [...new Set([...row.querySelectorAll<HTMLAnchorElement>('a[href*="ad_group_id="]')]
                .map((anchor) => normalize(anchor.innerText || anchor.textContent))
                .filter(Boolean))];
        return [{
                headers,
                keywordIds: [...new Set(markers.map((marker) => marker.value).filter(Boolean))],
                cellTexts: [...row.querySelectorAll<HTMLElement>('td,th')]
                    .map((cell) => cell.innerText || cell.textContent || ''),
                bidValues: bidInputs.map((bid) => bid.value),
                adGroupIds,
                adGroupNames,
            }];
    }))).catch(() => [])));
    const rows = frameRows.flat();
    const identity = resolveLingxingKeywordTargetRows(rows, input);
    await new PlaywrightLingxingKeywordBidPage(page).assertServing(identity.keywordId);
    return {
        adsAccountId: expectedProfileId,
        campaignId,
        ...identity,
    };
}
