import {
  normalizeLingxingCollectionStoreName,
  normalizeProviderExternalAccountId,
} from '@amazon-ai-ops/shared-types';
import type { BrowserContext, Locator, Page, Response } from 'playwright';
import { isLingxingAdsLoggedInPage } from './lingxing-session-flow';
import type { ProviderCredentialSubmission } from './provider-active-identity';

export interface LingxingAdsProfileEvidence {
  readonly alias: string;
  readonly country: 'US';
  readonly externalAccountId: string;
}

export interface LingxingAdsSsoController {
  getPage(): Page | null;
  getContext(): BrowserContext | null;
  setActivePage(page: Page): void;
}

export interface DiscoverLingxingAdsKeywordTargetInput {
  readonly externalAccountId: string;
  readonly campaignName: string;
  readonly adGroupName: string;
  readonly entityName: string;
  readonly currentBidCents: number;
}

export interface DiscoveredLingxingAdsKeywordTarget {
  readonly adsAccountId: string;
  readonly campaignId: string;
  readonly adGroupId: string;
  readonly keywordId: string;
  readonly bidCents: number;
}

export interface NavigateLingxingAdsCampaignKeywordTargetInput {
  readonly externalAccountId: string;
  readonly campaignName: string;
  readonly expectedStoreAlias?: string;
}

/** Selects one exact visible US store in the Ads account header and reads it back. */
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
        && text.length <= 64 && /^[a-z0-9._:-]+\s*美国$/iu.test(text);
    });
    const controls = candidates.filter((candidate) => !candidates.some((other) => (
      other !== candidate && candidate.contains(other)
    )));
    const selected = controls.filter((element) => labels.includes(
      normalize(element.innerText || element.textContent),
    ));
    return { selectedCount: selected.length, controlCount: controls.length };
  }, expectedLabels);
  const headerStates = await Promise.all(page.frames().map(async (frame) => ({
    frame,
    state: await readHeaderState(frame).catch(() => ({ selectedCount: 0, controlCount: 0 })),
  })));
  const selectedFrames = headerStates.filter(({ state: current }) => current.selectedCount === 1);
  if (selectedFrames.length === 1
    && headerStates.reduce((sum, current) => sum + current.state.selectedCount, 0) === 1) return;
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
        && text.length <= 64 && /^[a-z0-9._:-]+\s*美国$/iu.test(text);
    });
    const controls = candidates.filter((candidate) => !candidates.some((other) => (
      other !== candidate && candidate.contains(other)
    )));
    if (controls.length !== 1) throw new Error('ADS_HEADER_CONTROL_CHANGED');
    controls[0].click();
  }).catch((error) => {
    if (!/execution context was destroyed|frame was detached|navigation/iu.test(errorMessage(error))) throw error;
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
      .filter((element) => visible(element) && labels.includes(
      normalize(element.innerText || element.textContent),
      ));
    const leaves = matches.filter((candidate) => !matches.some((other) => (
      other !== candidate && candidate.contains(other)
    )));
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
    const leaves = matches.filter((candidate) => !matches.some((other) => (
      other !== candidate && candidate.contains(other)
    )));
    if (leaves.length !== 1) throw new Error('ADS_HEADER_TARGET_CHANGED');
    leaves[0].click();
  }, expectedLabels).catch((error) => {
    if (!/execution context was destroyed|frame was detached|navigation/iu.test(errorMessage(error))) throw error;
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
      return candidates.filter((candidate) => !candidates.some((other) => (
        other !== candidate && candidate.contains(other)
      ))).length;
    }, expectedLabels).catch(() => 0)));
    const selectedCount = selectedCounts.reduce((sum, count) => sum + count, 0);
    if (selectedCount === 1) return;
    if (attempt + 1 < ADS_STORE_FILTER_READY_ATTEMPTS) {
      await page.waitForTimeout(ADS_STORE_FILTER_READY_POLL_MS);
    }
  }
  throw new Error(`领星 Ads 顶部账户切换到 ${displayAlias} 后回读不一致，操作已阻断。`);
}

type LingxingAdsPageState = Readonly<{
  url: string;
  title?: string;
  bodyText?: string;
  hasAccountInput?: true;
}>;

const ADS_SSO_TIMEOUT_MS = 45_000;
const ADS_PROFILE_LIST_PATH = '/common/common_list/common_list/get_profile_list';
const ADS_PROFILE_ENTRY_RESPONSE_GRACE_MS = 5_000;
const ADS_CHANGE_ANNOUNCEMENT_MAX_INTERACTIONS = 64;
const ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS = 4;
const ADS_NAVIGATION_CONTEXT_RETRY_WAIT_MS = 250;
const ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS = 4;
const ADS_PENDING_NAVIGATION_PAGE_RECOVERY_WAIT_MS = 100;
const ADS_STORE_FILTER_READY_ATTEMPTS = 40;
const ADS_STORE_FILTER_READY_POLL_MS = 250;
const ERP_ADS_ENTRY_READY_ATTEMPTS = 60;
const ERP_ADS_ENTRY_READY_POLL_MS = 250;
const ADS_CHANGE_ANNOUNCEMENT_DIALOG_SELECTOR = [
  '.el-dialog:visible',
  '.ant-modal:visible',
  '[role="dialog"]:visible',
].join(', ');
const ADS_CHANGE_ANNOUNCEMENT_TITLE_SELECTOR = [
  '.el-dialog__header',
  '.ant-modal-title',
  '[class*="dialog"][class*="title"]',
  '[class*="modal"][class*="title"]',
  '[role="heading"]',
].join(', ');
const LINGXING_TRANSIENT_TOAST_SELECTOR = [
  '#toast-container [aria-live="polite"]:visible',
  '#toast-container .toast-success:visible',
  '#toast-container .toast-error:visible',
].join(', ');
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const MAX_IDENTITY_LENGTH = 256;
const LINGXING_KEYWORD_TARGET_PATH = '/ad_report/target/index/index';
const LINGXING_KEYWORD_DETAIL_PATH = '/ad_report/keyword/index/index';
const LINGXING_SAFE_SELECTOR_ID = /^[A-Za-z0-9._:-]+$/u;

function normalizedKeywordTargetText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function requireLingxingSelectorId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized
    || normalized.length > MAX_IDENTITY_LENGTH
    || CONTROL_CHARACTERS.test(normalized)
    || !LINGXING_SAFE_SELECTOR_ID.test(normalized)) {
    throw new Error(`领星 Ads ${label}无效，对象识别已阻断。`);
  }
  return normalized;
}

function parseLingxingBidCents(value: unknown): number | null {
  const normalized = String(value ?? '').normalize('NFKC').trim();
  const match = /^\$?\s*(\d+)(?:\.(\d{1,2}))?$/u.exec(normalized);
  if (!match) return null;
  const cents = (Number(match[1]) * 100) + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

type LingxingVisibleLink = Readonly<{ href: string; text: string }>;

async function readLingxingVisibleLinks(page: Page): Promise<LingxingVisibleLink[]> {
  const frameLinks = await Promise.all(page.frames().map((frame) => frame.evaluate(() => (
    [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .flatMap((anchor) => {
        const style = window.getComputedStyle(anchor);
        const rect = anchor.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0
          || rect.width <= 0 || rect.height <= 0) return [];
        return [{ href: anchor.href, text: anchor.innerText || anchor.textContent || '' }];
      })
  )).catch(() => [])));
  return frameLinks.flat();
}

function trustedLingxingKeywordTargetUrl(
  rawUrl: string,
  expectedProfileId: string,
): URL | null {
  let candidate: URL;
  try {
    candidate = new URL(rawUrl, 'https://ads.lingxing.com');
  } catch {
    return null;
  }
  if (candidate.username || candidate.password
    || candidate.origin !== 'https://ads.lingxing.com'
    || candidate.pathname !== LINGXING_KEYWORD_TARGET_PATH) return null;
  const profiles = candidate.searchParams.getAll('profile_id');
  if (profiles.length === 0) candidate.searchParams.set('profile_id', expectedProfileId);
  else if (profiles.length !== 1 || profiles[0] !== expectedProfileId) return null;
  return candidate;
}

/** Opens only the current Ads profile's keyword page and one exact campaign. */
export async function navigateToLingxingAdsCampaignKeywordTarget(
  page: Page,
  input: NavigateLingxingAdsCampaignKeywordTargetInput,
): Promise<void> {
  if (isPageClosed(page)) throw adsBrowserClosedError();
  const expectedProfileId = requireLingxingSelectorId(input.externalAccountId, 'profile_id');
  const expectedCampaignName = normalizedKeywordTargetText(input.campaignName);
  if (!expectedCampaignName) throw new Error('广告活动名称不完整，对象识别已阻断。');
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
    const directProfileTarget = trustedLingxingKeywordTargetUrl(
      `https://ads.lingxing.com${LINGXING_KEYWORD_TARGET_PATH}?profile_id=${encodeURIComponent(expectedProfileId)}`,
      expectedProfileId,
    );
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
  } else if (uniqueCampaignLinks.length > 1) {
    throw new Error(`领星 Ads 存在多个同名广告活动 ${input.campaignName}，操作已阻断。`);
  } else if (current.searchParams.getAll('id').length !== 1) {
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
          || !lines.includes(expected)) return [];
        const exactElements = [...row.querySelectorAll<HTMLElement>('*')].filter((element) => (
          String(element.innerText || element.textContent || '')
            .split(/\r?\n/gu).map(normalize).filter(Boolean)
            .includes(expected)
        ));
        const leaves = exactElements.filter((candidate) => !exactElements.some((other) => (
          other !== candidate && candidate.contains(other)
        )));
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
            if (!(element instanceof HTMLAnchorElement) || !element.href) return [];
            try {
              return new URL(element.href, window.location.href).searchParams.getAll('id');
            } catch {
              return [];
            }
          }),
          lineage.filter((element): element is HTMLInputElement => (
            element instanceof HTMLInputElement && element.matches('input.select-item[value]')
          )).map((element) => element.value),
          lineage.filter((element): element is HTMLInputElement => (
            element instanceof HTMLInputElement && element.matches('input[type="checkbox"][value]')
          )).map((element) => element.value),
          lineage.map((element) => element.getAttribute('data-id')),
        ].map((values) => values.filter((value): value is string => (
          Boolean(value && !/^(?:on|true|false)$/iu.test(value))
        )));
        const values = groups.find((group) => group.length > 0) ?? [];
        return [{ values }];
      });
    }, expectedCampaignName).catch(() => [])));
    const exactRows = frameCampaignRows.flat();
    exactCampaignRowIds = [...new Set(exactRows.flatMap((row) => row.values))];
    if (exactRows.length > 0 && exactCampaignRowIds.length === 1) {
      const campaignId = requireLingxingSelectorId(exactCampaignRowIds[0], '广告活动 ID');
      const directCampaignTarget = trustedLingxingKeywordTargetUrl(
        `https://ads.lingxing.com${LINGXING_KEYWORD_TARGET_PATH}?profile_id=${encodeURIComponent(expectedProfileId)}&id=${encodeURIComponent(campaignId)}`,
        expectedProfileId,
      );
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
        const leaves = matches.filter((candidate) => !matches.some((other) => (
          other !== candidate && candidate.contains(other)
        )));
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
        const leaves = matches.filter((candidate) => !matches.some((other) => (
          other !== candidate && candidate.contains(other)
        )));
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
        if (visualTargets.length !== 1) throw new Error('ADS_CAMPAIGN_TARGET_CHANGED');
        visualTargets[0].click();
      }, expectedCampaignName).catch((error) => {
        if (!/execution context was destroyed|frame was detached|navigation/iu.test(errorMessage(error))) throw error;
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
    throw new Error(
      `领星 Ads 无法唯一进入广告活动 ${input.campaignName} 的关键词页，操作已阻断。`
      + ` 诊断：可信链接=${uniqueCampaignLinks.length}，精确可点击=${exactClickableCounts.join('/') || '未扫描'}，`
      + `活动行ID=${exactCampaignRowIds.join('|') || '无'}，path=${current.pathname}，`
      + `profile参数=${profiles.length}，profile匹配=${profiles[0] === expectedProfileId}，活动参数=${campaignIds.length}，frame=${page.frames().length}。`,
    );
  }
  requireLingxingSelectorId(campaignIds[0], '广告活动 ID');
}

/**
 * Read-only discovery for a keyword row already displayed on Lingxing's
 * canonical keyword-target page. It reads stable ids from the exact row and
 * never fills an input or clicks a save control.
 */
export async function discoverLingxingAdsKeywordTarget(
  page: Page,
  input: DiscoverLingxingAdsKeywordTargetInput,
): Promise<DiscoveredLingxingAdsKeywordTarget> {
  if (isPageClosed(page)) throw adsBrowserClosedError();
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
    currentBidCents: Number(input.currentBidCents),
  };
  if (!expected.campaignName || !expected.adGroupName || !expected.entityName
    || !Number.isSafeInteger(expected.currentBidCents) || expected.currentBidCents < 0) {
    throw new Error('待识别关键词的业务身份不完整，操作已阻断。');
  }

  const frameRows = await Promise.all(page.frames().map((frame) => frame.evaluate(() => (
    [...document.querySelectorAll<HTMLTableRowElement>('tr')]
      .flatMap((row) => {
        const markers = [...row.querySelectorAll<HTMLInputElement>(
          'input.select-item[value], input[type="checkbox"][value]',
        )];
        if (markers.length === 0 || row.querySelectorAll('td').length === 0) return [];
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
            } catch {
              return [];
            }
          }))];
        return [{
          keywordIds: [...new Set(markers.map((marker) => marker.value).filter(Boolean))],
          cellTexts: [...row.querySelectorAll<HTMLElement>('td,th')]
            .map((cell) => cell.innerText || cell.textContent || ''),
          bidValues: bidInputs.map((bid) => bid.value),
          adGroupIds,
        }];
      })
  )).catch(() => [])));
  const rows = frameRows.flat();
  const campaignColumnPresent = rows.some((row) => row.cellTexts
    .map(normalizedKeywordTargetText)
    .includes(expected.campaignName));

  const candidateRows = rows.flatMap((row) => {
    const cellTexts = row.cellTexts.map(normalizedKeywordTargetText);
    const bidValues = row.bidValues.map(parseLingxingBidCents).filter((value): value is number => value !== null);
    if ((campaignColumnPresent && !cellTexts.includes(expected.campaignName))
      || !cellTexts.includes(expected.adGroupName)
      || !cellTexts.includes(expected.entityName)
      || row.adGroupIds.length !== 1
      || row.keywordIds.length !== 1) return [];
    try {
      return [{
        keywordId: requireLingxingSelectorId(row.keywordIds[0], '关键词 ID'),
        adGroupId: requireLingxingSelectorId(row.adGroupIds[0], '广告组 ID'),
        bidValues,
      }];
    } catch {
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
    if (observedBid !== expected.currentBidCents) {
      throw new Error(
        `领星 Ads 关键词 ${input.entityName} 当前竞价已变化：`
        + `报表 $${(expected.currentBidCents / 100).toFixed(2)}，页面 $${(observedBid / 100).toFixed(2)}；`
        + '建议已失效，禁止绑定或执行，请刷新数据后重新生成建议。',
      );
    }
    return {
      adsAccountId: expectedProfileId,
      campaignId,
      adGroupId: identities[0].adGroupId,
      keywordId: identities[0].keywordId,
      bidCents: observedBid,
    };
  }
  throw new Error(`领星 Ads 关键词页无法唯一定位 ${input.campaignName} > ${input.adGroupName} > ${input.entityName}，操作已阻断。`);
}

type CapturedLingxingAdsProfileResponse = Readonly<{
  ok: boolean;
  payload: Promise<unknown>;
}>;

type LingxingAdsProfileResponseSlot = {
  promise: Promise<CapturedLingxingAdsProfileResponse>;
  resolve: (response: CapturedLingxingAdsProfileResponse) => void;
  settled: boolean;
};

const observedAdsProfileContexts = new WeakSet<BrowserContext>();
const adsProfileResponseSlots = new WeakMap<Page, LingxingAdsProfileResponseSlot>();

function ensureAdsProfileResponseSlot(page: Page): LingxingAdsProfileResponseSlot {
  const current = adsProfileResponseSlots.get(page);
  if (current) return current;
  let resolve!: (response: CapturedLingxingAdsProfileResponse) => void;
  const promise = new Promise<CapturedLingxingAdsProfileResponse>((accept) => {
    resolve = accept;
  });
  const created = { promise, resolve, settled: false };
  adsProfileResponseSlots.set(page, created);
  return created;
}

function isLingxingAdsProfileListResponse(response: Response): boolean {
  try {
    const responseUrl = new URL(response.url());
    return responseUrl.origin === 'https://ads.lingxing.com'
      && responseUrl.pathname === ADS_PROFILE_LIST_PATH
      && response.request().method() === 'POST';
  } catch {
    return false;
  }
}

function observeLingxingAdsProfileResponses(context: BrowserContext): void {
  if (observedAdsProfileContexts.has(context)
    || typeof context.on !== 'function') return;
  observedAdsProfileContexts.add(context);
  context.on('response', (response) => {
    if (!isLingxingAdsProfileListResponse(response)) return;
    let responsePage: Page;
    try {
      responsePage = response.frame().page();
    } catch {
      return;
    }
    const slot = ensureAdsProfileResponseSlot(responsePage);
    if (slot.settled) return;
    slot.settled = true;
    slot.resolve({
      ok: response.ok(),
      payload: response.json(),
    });
  });
}

async function consumeObservedAdsProfileResponse(
  page: Page,
): Promise<CapturedLingxingAdsProfileResponse | null> {
  const slot = adsProfileResponseSlots.get(page);
  if (!slot) return null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      slot.promise,
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), ADS_PROFILE_ENTRY_RESPONSE_GRACE_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    adsProfileResponseSlots.delete(page);
  }
}

export function isLingxingAdsExplicitlyLoggedOutPage(
  state: LingxingAdsPageState,
): boolean {
  const visibleText = `${state.title ?? ''}\n${state.bodyText ?? ''}`;
  return /\/restartLogin(?:\/|$)/i.test(state.url)
    || /您尚未登录|账号登录|微信登录|请从领星\s*ERP\s*进入/u.test(visibleText);
}

type LingxingAdsAnnouncementAction = Readonly<{
  dialogIndex: number;
  actionIndex: number;
  actionText: string;
  fingerprint: string;
}>;

function isLingxingAdsChangeAnnouncementTitle(value: string): boolean {
  return /变更公告/u.test(value.normalize('NFKC').replace(/\s+/g, ' ').trim());
}

async function readLingxingAdsChangeAnnouncementAction(
  page: Page,
): Promise<LingxingAdsAnnouncementAction | null> {
  const snapshots = await page.evaluate(({ dialogSelector, titleSelector }) => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
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
  const recognized: Array<{ dialogIndex: number; title: string }> = [];
  for (let dialogIndex = 0; dialogIndex < snapshots.length; dialogIndex += 1) {
    const snapshot = snapshots[dialogIndex];
    const title = snapshot.headerTexts.find(isLingxingAdsChangeAnnouncementTitle)
      ?? snapshot.firstLine;
    if (isLingxingAdsChangeAnnouncementTitle(title)) {
      recognized.push({ dialogIndex, title: title.normalize('NFKC').replace(/\s+/g, ' ').trim() });
    }
  }
  if (recognized.length === 0) return null;
  if (recognized.length !== 1) {
    throw new Error('领星 Ads 同时出现多个变更公告弹窗，无法安全判断处理顺序，操作已阻断。');
  }

  const current = recognized[0];
  const accepted: Array<{ actionIndex: number; actionText: string }> = [];
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

export function isTransientLingxingAdsNavigationError(error: unknown): boolean {
  return /Execution context was destroyed(?:, most likely because of a navigation)?|Cannot find context with specified id/iu
    .test(errorMessage(error));
}

/**
 * Reads a small, non-secret page snapshot across a document replacement.
 * Only Chromium's explicit stale-execution-context errors are retryable;
 * page/context closure and every other evaluate failure remain terminal.
 */
export async function readLingxingAdsPageStateAfterNavigation(
  page: Page,
): Promise<Readonly<{
  url: string;
  title: string;
  bodyText: string;
  hasAccountInput?: true;
}>> {
  for (let attempt = 0; attempt < ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS; attempt += 1) {
    try {
      return await page.evaluate(() => {
        const hasAccountInput = Boolean(document.querySelector('input[name="account"]'));
        return {
          url: window.location.href,
          title: document.title,
          bodyText: document.body?.innerText ?? '',
          ...(hasAccountInput ? { hasAccountInput: true as const } : {}),
        };
      });
    } catch (error) {
      if (!isTransientLingxingAdsNavigationError(error)
        || attempt + 1 >= ADS_NAVIGATION_CONTEXT_READ_ATTEMPTS) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 5_000 })
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

export type LingxingVisibleProvider = 'lingxing' | 'amazon_ads';

export function isTrustedLingxingProviderUrl(
  provider: LingxingVisibleProvider,
  value: string,
): boolean {
  try {
    const currentUrl = new URL(value);
    return provider === 'lingxing'
      ? currentUrl.origin === 'https://erp.lingxing.com'
      : currentUrl.origin === 'https://ads.lingxing.com'
        && !/\/restartLogin(?:\/|$)/i.test(currentUrl.pathname);
  } catch {
    return false;
  }
}

/**
 * Resolves only an already-open, same-provider page from the controller's
 * isolated BrowserContext. This never treats an ERP page, restartLogin page,
 * or cross-origin page as an Ads replacement.
 */
export function findTrustedLingxingProviderReplacementPage(
  provider: LingxingVisibleProvider,
  closingPage: Page,
  candidates: readonly Page[],
): Page | null {
  const seen = new Set<Page>();
  for (const candidate of candidates) {
    if (candidate === closingPage || seen.has(candidate)) continue;
    seen.add(candidate);
    if (isPageClosed(candidate)) continue;
    if (isTrustedLingxingProviderUrl(provider, candidate.url())) return candidate;
  }
  return null;
}

/**
 * Resolves a document replacement only while Ads identity is still pending.
 * Pending identity has no write authority, so this bounded 300 ms handoff can
 * distinguish Chromium navigation churn from a genuinely closed/changed page
 * without weakening the verified-provider liveness gate.
 */
export async function findTrustedLingxingProviderPageAfterPendingNavigation(
  provider: LingxingVisibleProvider,
  observedPage: Page,
  readCandidates: () => readonly Page[],
): Promise<Page | null> {
  for (let attempt = 0; attempt < ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS; attempt += 1) {
    if (!isPageClosed(observedPage)
      && isTrustedLingxingProviderUrl(provider, observedPage.url())) {
      return observedPage;
    }
    let candidates: readonly Page[] = [];
    try {
      candidates = readCandidates();
    } catch {
      candidates = [];
    }
    const replacement = findTrustedLingxingProviderReplacementPage(
      provider,
      observedPage,
      candidates,
    );
    if (replacement) return replacement;
    if (attempt + 1 < ADS_PENDING_NAVIGATION_PAGE_RECOVERY_ATTEMPTS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ADS_PENDING_NAVIGATION_PAGE_RECOVERY_WAIT_MS);
      });
    }
  }
  return null;
}

/**
 * Clears only recognized Lingxing Ads change-announcement dialogs.
 *
 * The live current/total label is authoritative; no fixed announcement count
 * is assumed. Unknown or ambiguous dialogs fail closed so this helper cannot
 * become a generic modal clicker.
 */
export async function dismissLingxingAdsChangeAnnouncements(page: Page): Promise<number> {
  if (isPageClosed(page)) throw adsBrowserClosedError();
  if (typeof page.locator !== 'function' || typeof page.evaluate !== 'function') return 0;
  let currentUrl: URL;
  try {
    currentUrl = new URL(page.url());
  } catch {
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
    await button.click({ timeout: 5_000 });
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

function normalizeAccountIdentity(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length > MAX_IDENTITY_LENGTH
    || CONTROL_CHARACTERS.test(value)) return null;
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
  return normalized && normalized.length <= MAX_IDENTITY_LENGTH ? normalized : null;
}

function normalizeLingxingAdsStoreText(value: unknown): string | undefined {
  return normalizeLingxingCollectionStoreName(value)?.replace(/\s+/g, ' ').trim();
}

type LegacyLingxingAdsDropdownReference = Readonly<{
  documentIndex: number | null;
  visibleIndex: number;
}>;

async function readVisibleLegacyLingxingAdsDropdowns(page: Page): Promise<Readonly<{
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

function legacyLingxingAdsDropdown(
  page: Page,
  reference: LegacyLingxingAdsDropdownReference,
): ReturnType<Page['locator']> {
  return reference.documentIndex === null
    ? page.locator('.el-select-dropdown:visible').nth(reference.visibleIndex)
    : page.locator('.el-select-dropdown').nth(reference.documentIndex);
}

async function exactLegacyLingxingAdsStoreRowIndexes(
  dropdown: ReturnType<Page['locator']>,
  expected: string,
): Promise<number[]> {
  const rows = dropdown.locator('li.el-select-dropdown__item[title]');
  const titles = await rows.evaluateAll((elements) => (
    elements.map((element) => element.getAttribute('title'))
  ));
  return titles.flatMap((title, rowIndex) => (
    normalizeLingxingAdsStoreText(title) === expected ? [rowIndex] : []
  ));
}

export function assertLingxingAdsSelectedStoreTags(
  selectedTags: readonly string[],
  expectedAlias: string,
): void {
  const expected = normalizeLingxingAdsStoreText(expectedAlias);
  const normalizedTags = selectedTags.map((tag) => normalizeLingxingAdsStoreText(tag));
  if (!expected
    || normalizedTags.some((tag) => !tag)
    || normalizedTags.length !== 1
    || normalizedTags[0] !== expected) {
    throw new Error(`领星 Ads 当前范围没有唯一锁定美国站店铺 ${expected || expectedAlias}，操作已阻断。`);
  }
}

async function trySelectOnlyLegacyLingxingAdsStore(
  page: Page,
  expected: string,
  displayAlias: string,
): Promise<boolean> {
  const selects = page.locator('.el-select.is-multiple:visible');
  if (await selects.count() === 0) return false;
  const alreadySelected: number[] = [];
  for (let index = 0; index < await selects.count(); index += 1) {
    const tags = await selects.nth(index)
      .locator('.el-select__tags .el-select__tags-text')
      .allTextContents();
    try {
      assertLingxingAdsSelectedStoreTags(tags, expected);
      alreadySelected.push(index);
    } catch {
      // The visible body-level dropdown is inspected below.
    }
  }
  if (alreadySelected.length === 1) return true;
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
    const previouslyVisible = new Set(beforeClick.references.flatMap((reference) => (
      reference.documentIndex === null ? [] : [reference.documentIndex]
    )));
    const openedByCurrentControl = beforeClick.stableIdentity && afterClick.stableIdentity
      ? afterClick.references.filter((reference) => (
          reference.documentIndex !== null && !previouslyVisible.has(reference.documentIndex)
        ))
      : afterClick.references;
    let matchCount = 0;
    let matchingDropdown: LegacyLingxingAdsDropdownReference | null = null;
    for (const dropdownReference of openedByCurrentControl) {
      const rowIndexes = await exactLegacyLingxingAdsStoreRowIndexes(
        legacyLingxingAdsDropdown(page, dropdownReference),
        expected,
      );
      matchCount += rowIndexes.length;
      if (rowIndexes.length === 1) matchingDropdown = dropdownReference;
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
  if (matchingSelects.length === 0) return false;
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
  await dropdown.waitFor({ state: 'visible', timeout: 10_000 });
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
  if (!await onlyAction.isVisible({ timeout: 5_000 }).catch(() => false)) {
    throw new Error(`领星 Ads 店铺 ${displayAlias} 的“仅筛选此项”操作不可见，操作已阻断。`);
  }
  await onlyAction.click({ timeout: 10_000 });
  await page.waitForTimeout(600);
  assertLingxingAdsSelectedStoreTags(
    await storeSelect.locator('.el-select__tags .el-select__tags-text').allTextContents(),
    expected,
  );
  return true;
}

function isExactLingxingAdsUsStoreOption(label: string | null | undefined, expected: string): boolean {
  const normalizedLabel = normalizeLingxingAdsStoreText(label);
  return normalizedLabel === expected || normalizedLabel === `${expected} 美国`;
}

function assertLingxingAdsFilterSelectedStore(
  selectedLabels: readonly string[],
  expected: string,
  displayAlias: string,
): void {
  if (selectedLabels.length !== 1 || !isExactLingxingAdsUsStoreOption(selectedLabels[0], expected)) {
    throw new Error(`领星 Ads 当前筛选没有唯一锁定美国站店铺 ${displayAlias}，请重新选择当前店铺后重试 Ads。`);
  }
}

async function clearLingxingTransientToast(page: Page): Promise<void> {
  const toastCandidates = page.locator(LINGXING_TRANSIENT_TOAST_SELECTOR) as Locator & {
    first?: () => Locator;
  };
  if (typeof toastCandidates.isVisible !== 'function') return;
  const toast = typeof toastCandidates.first === 'function'
    ? toastCandidates.first()
    : toastCandidates;
  if (!await toast.isVisible({ timeout: 250 }).catch(() => false)) return;

  const close = toast.locator(
    '[aria-label="关闭"], [title="关闭"], .el-icon-close, .anticon-close, button',
  ).first();
  if (await close.isVisible({ timeout: 250 }).catch(() => false)) {
    await close.click({ timeout: 1_000 }).catch(() => undefined);
  }
  if (await toast.isVisible({ timeout: 250 }).catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => undefined);
  }
  if (await toast.isVisible({ timeout: 250 }).catch(() => false)) {
    await toast.waitFor({ state: 'hidden', timeout: 1_500 }).catch(() => {
      throw new Error('领星页面提示层未关闭，店铺选择已阻断。');
    });
  }
}

async function trySelectOnlyCurrentLingxingAdsStore(
  page: Page,
  expected: string,
  displayAlias: string,
): Promise<boolean> {
  const controls = page.locator('.fs-wrap.multiple:visible');
  const matches: Array<{ controlIndex: number; optionIndex: number }> = [];

  for (let controlIndex = 0; controlIndex < await controls.count(); controlIndex += 1) {
    const control = controls.nth(controlIndex);
    const dropdown = control.locator('.fs-dropdown');
    let optionLabels = await control
      .locator('.fs-option .fs-option-label-detail')
      .allTextContents();
    let optionIndexes = optionLabels.flatMap((label, optionIndex) => (
      isExactLingxingAdsUsStoreOption(label, expected) ? [optionIndex] : []
    ));
    let openedForDiscovery = false;
    if (optionIndexes.length === 0 && !await dropdown.isVisible().catch(() => false)) {
      const trigger = control.locator('.fs-label-wrap');
      if (await trigger.isVisible().catch(() => false)) {
        await clearLingxingTransientToast(page);
        await trigger.click({ timeout: 5_000 });
        openedForDiscovery = await dropdown
          .waitFor({ state: 'visible', timeout: 1_000 })
          .then(() => true)
          .catch(() => false);
        if (openedForDiscovery) {
          await page.waitForTimeout(150);
          optionLabels = await control
            .locator('.fs-option .fs-option-label-detail')
            .allTextContents();
          optionIndexes = optionLabels.flatMap((label, optionIndex) => (
            isExactLingxingAdsUsStoreOption(label, expected) ? [optionIndex] : []
          ));
        }
      }
    }
    if (openedForDiscovery) {
      await page.keyboard.press('Escape').catch(() => undefined);
      await dropdown.waitFor({ state: 'hidden', timeout: 1_000 }).catch(() => undefined);
    }
    if (optionIndexes.length > 1) {
      throw new Error(`领星 Ads 店铺筛选器中存在重复的 ${displayAlias}，操作已阻断。`);
    }
    if (optionIndexes.length === 1) {
      matches.push({ controlIndex, optionIndex: optionIndexes[0] });
    }
  }

  if (matches.length === 0) return false;
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
  await dropdown.waitFor({ state: 'visible', timeout: 10_000 });

  const options = control.locator('.fs-option');
  const optionLabels = await options
    .locator('.fs-option-label-detail')
    .allTextContents();
  const targetIndexes = optionLabels.flatMap((label, optionIndex) => (
    isExactLingxingAdsUsStoreOption(label, expected) ? [optionIndex] : []
  ));
  if (targetIndexes.length !== 1) {
    throw new Error(`领星 Ads 店铺筛选器无法唯一定位 ${displayAlias}，操作已阻断。`);
  }
  const targetIndex = targetIndexes[0];
  const selectedIndexes = await options.evaluateAll((elements) => elements.flatMap((element, optionIndex) => (
    element.classList.contains('selected') ? [optionIndex] : []
  )));
  for (const selectedIndex of selectedIndexes) {
    if (selectedIndex !== targetIndex) await options.nth(selectedIndex).click();
  }
  const target = options.nth(targetIndex);
  if (!await target.evaluate((element) => element.classList.contains('selected'))) {
    await target.click();
  }

  assertLingxingAdsFilterSelectedStore(
    await control.locator('.fs-option.selected .fs-option-label-detail').allTextContents(),
    expected,
    displayAlias,
  );
  const save = control.locator('.fs-save');
  await save.waitFor({ state: 'visible', timeout: 5_000 });
  await save.click({ timeout: 10_000 });
  await dropdown.waitFor({ state: 'hidden', timeout: 10_000 });
  await page.waitForTimeout(300);

  assertLingxingAdsFilterSelectedStore(
    await control.locator('.fs-option.selected .fs-option-label-detail').allTextContents(),
    expected,
    displayAlias,
  );
  assertLingxingAdsFilterSelectedStore(
    await control.locator('.fs-label-wrap .fs-label').allTextContents(),
    expected,
    displayAlias,
  );
  return true;
}

export async function selectOnlyLingxingAdsStore(page: Page, expectedAlias: string): Promise<void> {
  const expected = normalizeLingxingAdsStoreText(expectedAlias);
  if (!expected) throw new Error('领星 Ads 目标店铺名称无效，操作已阻断。');
  const displayAlias = expectedAlias.normalize('NFKC').replace(/\s+/g, ' ').trim();

  for (let attempt = 0; attempt < ADS_STORE_FILTER_READY_ATTEMPTS; attempt += 1) {
    if (isPageClosed(page)) throw adsBrowserClosedError();
    if (await trySelectOnlyLegacyLingxingAdsStore(page, expected, displayAlias)) return;
    if (await trySelectOnlyCurrentLingxingAdsStore(page, expected, displayAlias)) return;
    if (attempt + 1 < ADS_STORE_FILTER_READY_ATTEMPTS) {
      await page.waitForTimeout(ADS_STORE_FILTER_READY_POLL_MS);
    }
  }
  throw new Error(`领星 Ads 页面无法唯一定位当前店铺 ${displayAlias} 的筛选器，请确认 Ads 页面已加载该店铺后重试。`);
}

export function resolveLingxingStableIdentityFromAdsProfile(input: Readonly<{
  accountLabel: string;
  collectionStoreName: string;
  configuredExternalAccountId?: string;
  evidence: LingxingAdsProfileEvidence;
  credentialSubmission?: ProviderCredentialSubmission;
}>): string {
  const observedId = resolveMatchedLingxingAdsProfileIdentity(input);

  const configuredId = normalizeProviderExternalAccountId('lingxing', input.configuredExternalAccountId);
  if (configuredId) {
    if (configuredId !== observedId) {
      throw new Error('领星 Ads 稳定店铺身份与当前连接不一致，登录已阻断。');
    }
    return configuredId;
  }

  const submission = input.credentialSubmission;
  if (!submission
    || submission.credentialSource !== 'typed'
    || !submission.credentialsSubmitted
    || normalizeAccountIdentity(input.accountLabel) !== normalizeAccountIdentity(submission.username)) {
    throw new Error('领星稳定身份首次绑定必须使用与连接账号一致的本次手动登录凭证。');
  }
  return observedId;
}

export function resolveLingxingStableIdentityFromVerifiedContinuation(input: Readonly<{
  accountLabel: string;
  collectionStoreName: string;
  evidence: LingxingAdsProfileEvidence;
  continuation: Readonly<{
    credentialSource: string;
    credentialPersistence: string;
    sessionIdentityVerified: boolean;
    username: string;
  }>;
}>): string {
  const continuation = input.continuation;
  if (continuation.credentialSource !== 'saved'
    || !continuation.sessionIdentityVerified
    || (continuation.credentialPersistence !== 'saved'
      && continuation.credentialPersistence !== 'main_managed')
    || normalizeAccountIdentity(input.accountLabel)
      !== normalizeAccountIdentity(continuation.username)) {
    throw new Error('领星稳定身份续绑只允许使用同一已验证会话与 Main 托管凭证。');
  }
  return resolveMatchedLingxingAdsProfileIdentity(input);
}

function resolveMatchedLingxingAdsProfileIdentity(input: Readonly<{
  collectionStoreName: string;
  evidence: LingxingAdsProfileEvidence;
}>): string {
  const expectedAlias = normalizeLingxingCollectionStoreName(input.collectionStoreName);
  const observedAlias = normalizeLingxingCollectionStoreName(input.evidence.alias);
  const observedId = normalizeProviderExternalAccountId('lingxing', input.evidence.externalAccountId);
  if (!expectedAlias || observedAlias !== expectedAlias || input.evidence.country !== 'US' || !observedId) {
    throw new Error('领星 Ads 美国站店铺证据与当前连接不一致，登录已阻断。');
  }
  return observedId;
}

export async function ensureLingxingErpAuthenticated(
  page: Page,
  credentials: Readonly<{ username: string; password: string }>,
): Promise<{ sessionReused: boolean }> {
  const accountInput = page
    .locator('input[name="account"], input[placeholder*="用户名"], input[placeholder*="手机号"]')
    .first();
  const passwordInput = page.locator('input[name="pwd"], input[type="password"]').first();
  const needsLogin = await accountInput.isVisible({ timeout: 5_000 }).catch(() => false);

  if (needsLogin) {
    if (!await passwordInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      throw new Error('领星 ERP 密码输入框不可见，隔离 Ads 会话登录已阻断。');
    }
    await accountInput.fill(credentials.username);
    await passwordInput.fill(credentials.password);
    await Promise.all([
      page.waitForURL(/\/erp\/home|\/erp\/index|dashboard|home|index/, { timeout: 30_000 })
        .catch(() => undefined),
      page.locator('button.loginBtn, button:has-text("登录")').first().click({ timeout: 15_000 }),
    ]);
    await page.waitForTimeout(2_000);
  }

  const state = await page.evaluate(() => ({
    bodyText: (document.body?.innerText ?? '').slice(0, 8_192),
    hasAccountInput: Boolean(document.querySelector('input[name="account"]')),
  }));
  let currentUrl: URL;
  try {
    currentUrl = new URL(page.url());
  } catch {
    throw new Error('领星 ERP 登录完成后的页面地址无效，隔离 Ads 会话已阻断。');
  }
  if (currentUrl.origin !== 'https://erp.lingxing.com'
    || state.hasAccountInput
    || /账号登录|微信登录/.test(state.bodyText)) {
    throw new Error('领星 ERP 隔离 Ads 会话登录未完成，请检查账号、密码或验证码要求。');
  }
  return { sessionReused: !needsLogin };
}

export async function openLingxingAdsFromErp(
  controller: LingxingAdsSsoController,
): Promise<Page> {
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
  await adsMenu.click({ timeout: 15_000 });
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
        } catch {
          return false;
        }
      });
      if (adsCandidate) return adsCandidate;
      await erpPage!.waitForTimeout(200);
    }
    if (entryResolved) return erpPage!;
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
  } catch {
    firstAdsUrl = null;
  }
  if (firstAdsUrl?.origin === 'https://ads.lingxing.com'
    && /\/restartLogin(?:\/|$)/i.test(firstAdsUrl.pathname)) {
    try {
      adsPage = await navigationPromise;
    } catch {
      throw new Error('领星 ERP 已登录，但 Ads SSO 未建立；请保留窗口并从当前 ERP 左侧“广告”入口重试，直接打开 Ads 地址无效。');
    }
  }
  entryResolved = true;
  if (isPageClosed(adsPage)) throw adsBrowserClosedError();
  try {
    await adsPage.waitForLoadState('domcontentloaded', { timeout: ADS_SSO_TIMEOUT_MS });
    await adsPage.waitForURL(/^https:\/\/ads\.lingxing\.com\//i, { timeout: ADS_SSO_TIMEOUT_MS });
  } catch (error) {
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

async function findVisibleLingxingAdsEntry(
  activePage: Page,
  context: BrowserContext,
): Promise<Readonly<{ page: Page; entry: Locator }> | null> {
  for (let attempt = 0; attempt < ERP_ADS_ENTRY_READY_ATTEMPTS; attempt += 1) {
    const erpCandidates = [...new Set([activePage, ...context.pages()])]
      .filter((page) => {
        try {
          return new URL(page.url()).origin === 'https://erp.lingxing.com';
        } catch {
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

export async function restoreAuthenticatedLingxingErpPage(
  controller: LingxingAdsSsoController,
): Promise<boolean> {
  const context = controller.getContext();
  if (!context) return false;
  for (const page of context.pages()) {
    if (isPageClosed(page)) continue;
    try {
      if (new URL(page.url()).origin !== 'https://erp.lingxing.com') continue;
    } catch {
      continue;
    }
    const title = await page.title().catch(() => '');
    const bodyText = await page
      .evaluate(() => (document.body?.innerText ?? '').slice(0, 8_192))
      .catch(() => '');
    const hasAccountInput = typeof page.locator === 'function'
      && await page
        .locator('input[name="account"], input[placeholder*="用户名"], input[placeholder*="手机号"]')
        .first()
        .isVisible({ timeout: 250 })
        .catch(() => false);
    if (hasAccountInput || /账号登录|微信登录|登录领星/u.test(`${title}\n${bodyText}`)) continue;
    controller.setActivePage(page);
    await page.bringToFront();
    return true;
  }
  return false;
}

export async function readLingxingAdsProfileEvidence(
  page: Page,
  expectedAlias: string,
): Promise<LingxingAdsProfileEvidence> {
  if (isPageClosed(page)) throw adsBrowserClosedError();
  let currentUrl: URL;
  try {
    currentUrl = new URL(page.url());
  } catch {
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
    } catch {
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

function adsBrowserClosedError(): Error {
  return new Error('Ads 可见浏览器已关闭；ERP 已连接，可继续只读采集，请点击“重试 Ads”恢复广告身份识别。');
}

function isPageClosed(page: Page): boolean {
  return typeof page.isClosed === 'function' && page.isClosed();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function findAuthenticatedAdsPage(pages: readonly Page[]): Promise<Page | undefined> {
  for (const page of pages) {
    if (!/^https:\/\/ads\.lingxing\.com\//i.test(page.url())) continue;
    const state = await readAdsPageState(page);
    if (isLingxingAdsExplicitlyLoggedOutPage(state)) continue;
    if (isLingxingAdsLoggedInPage(state)) return page;
  }
  return undefined;
}

async function waitForAuthenticatedAdsPage(page: Page): Promise<void> {
  const deadline = Date.now() + ADS_SSO_TIMEOUT_MS;
  while (true) {
    const state = await readAdsPageState(page);
    if (isLingxingAdsExplicitlyLoggedOutPage(state)) {
      throw new Error('领星 ERP 已登录，但 Ads SSO 未建立；请保留窗口并重新从 ERP 左侧“广告”入口进入。');
    }
    if (isLingxingAdsLoggedInPage(state)) return;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error('领星 ERP 已登录，但 Ads SSO 页面在限定时间内未就绪。');
    }
    await page.waitForTimeout(Math.min(500, remainingMs));
  }
}

async function readAdsPageState(page: Page): Promise<{
  url: string;
  title: string;
  bodyText: string;
}> {
  return {
    url: page.url(),
    title: await page.title(),
    bodyText: await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 8_192)),
  };
}

export function selectLingxingAdsProfileEvidence(
  payload: unknown,
  expectedAlias: string,
): LingxingAdsProfileEvidence {
  const normalizedExpectedAlias = normalizeLingxingCollectionStoreName(expectedAlias);
  if (!normalizedExpectedAlias) {
    throw new Error('领星下载中心店铺名称无效，Ads 身份识别已阻断。');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('领星 Ads 店铺身份响应无效，登录已阻断。');
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error('领星 Ads 店铺身份响应缺少店铺列表，登录已阻断。');
  }

  const matches = data.flatMap((candidate): LingxingAdsProfileEvidence[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const record = candidate as Record<string, unknown>;
    const alias = normalizeLingxingCollectionStoreName(record.alias);
    if (alias !== normalizedExpectedAlias || record.country !== 'US') return [];
    const displayAlias = typeof record.alias === 'string'
      ? record.alias.normalize('NFKC').trim()
      : '';
    const externalAccountId = normalizeProviderExternalAccountId('amazon_ads', record.profile_id);
    if (!externalAccountId) {
      throw new Error('领星 Ads 店铺身份缺少稳定 profile_id，登录已阻断。');
    }
    return [{ alias: displayAlias, country: 'US', externalAccountId }];
  });

  const unique = [...new Map(matches.map((match) => [match.externalAccountId, match])).values()];
  if (unique.length === 0) {
    throw new Error(`领星 Ads 未找到美国站店铺 ${normalizedExpectedAlias}，登录已阻断。`);
  }
  if (unique.length !== 1) {
    throw new Error(`领星 Ads 店铺 ${normalizedExpectedAlias} 对应多个 profile_id，登录已阻断。`);
  }
  return Object.freeze(unique[0]);
}
