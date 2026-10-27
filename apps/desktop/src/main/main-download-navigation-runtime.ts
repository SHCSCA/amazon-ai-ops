import type { Locator, Response } from 'playwright';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import { reconcileLingxingCreatedReportRows } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterActionSelectors, DownloadCenterPageModel, LingxingReportType } from '@amazon-ai-ops/shared-types';
import { normalizeLingxingCollectionStoreName } from '@amazon-ai-ops/shared-types';
import { dismissLingxingAdsChangeAnnouncements, isLingxingAdsExplicitlyLoggedOutPage, openLingxingAdsFromErp, readLingxingAdsPageStateAfterNavigation, selectOnlyLingxingAdsStore } from './lingxing-ads-sso';
import { assertUsableDownloadCenterActionSelector, getControllerPageOrThrow } from './main-download-automation-runtime';
import { sanitizeEvidenceText } from './main-download-diagnostics-runtime';
import type { DownloadCenterReportSelectorContext, LingxingCreateSubmissionResponseEvidence } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function reportContextKey(report: { type: LingxingReportType }, dateRange: { start: string; end: string }): string {
  return `${report.type}:${dateRange.start}:${dateRange.end}`;
}

export async function waitForDownloadCenterListPage(page: NonNullable<ReturnType<BrowserController['getPage']>>): Promise<boolean> {
  await page.waitForTimeout(1500);
  const state = await readLingxingAdsPageStateAfterNavigation(page);
  if (isLingxingAdsExplicitlyLoggedOutPage(state)) return false;
  return state.url.includes('/ak_download/download_center/download_report_log/index')
    && state.bodyText.includes('下载中心')
    && state.bodyText.includes('创建报告');
}

export async function finalizeLingxingDownloadCenterPage(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  storeName: string,
): Promise<boolean> {
  if (!await waitForDownloadCenterListPage(page)) return false;
  await dismissLingxingAdsChangeAnnouncements(page);
  await selectOnlyLingxingAdsStore(page, storeName);
  return true;
}

export async function navigateToLingxingDownloadCenter(
  controller: BrowserController,
  model: DownloadCenterPageModel,
  storeName: string,
): Promise<void> {
  let page = getControllerPageOrThrow(controller);

  try {
    if (new URL(page.url()).origin !== 'https://ads.lingxing.com'
      || /^https:\/\/ads\.lingxing\.com\/restartLogin(?:\/|$)/i.test(page.url())) {
      page = await openLingxingAdsFromErp(controller);
    }
  } catch (error) {
    if (/可信 ERP 页面|Ads SSO|可见浏览器/u.test(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
    page = await openLingxingAdsFromErp(controller);
  }

  
  
  
  
  await page.goto(model.candidateUrls[0], { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
  if (await finalizeLingxingDownloadCenterPage(page, storeName)) return;
  if (/^https:\/\/ads\.lingxing\.com\/restartLogin(?:\/|$)/i.test(page.url())) {
    page = await openLingxingAdsFromErp(controller);
    await page.goto(model.candidateUrls[0], { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
    if (await finalizeLingxingDownloadCenterPage(page, storeName)) return;
  }

  const menuSelectors = [
    'a.fa-download_menu[href="/ak_download/download_center/download_report_log/index"]',
    'a.not-root[href="/ak_download/download_center/download_report_log/index"]',
    'a[href="/ak_download/download_center/download_report_log/index"]:has-text("下载中心")',
  ];
  for (const selector of menuSelectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) continue;
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => undefined),
      locator.click({ timeout: 15000 }),
    ]);
    if (await finalizeLingxingDownloadCenterPage(page, storeName)) return;
  }

  await page.evaluate(() => {
    window.location.href = '/ak_download/download_center/download_report_log/index';
  });
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => undefined);
  if (await finalizeLingxingDownloadCenterPage(page, storeName)) return;
  throw new Error(`无法进入领星广告下载中心，当前页面：${await page.title().catch(() => page.url())}`);
}

export async function waitForCreateReportPage(page: NonNullable<ReturnType<BrowserController['getPage']>>): Promise<void> {
  await page.waitForURL(/\/ak_download\/download_center\/download_report_log\/create_report/, { timeout: 45000 }).catch(() => undefined);
  const container = page.locator('.create-report-container').first();
  if (await container.isVisible({ timeout: 5000 }).catch(() => false)) return;
  await page.getByText('创建报告', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
}

export async function assertLingxingCreateStoreSelected(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  storeName: string,
  marketplaceCode?: string,
): Promise<void> {
  const normalizedStoreName = normalizeLingxingCollectionStoreName(storeName);
  const normalizedMarketplaceCode = normalizeLingxingCollectionStoreName(marketplaceCode);
  if (!normalizedStoreName || !normalizedMarketplaceCode) {
    throw new Error('领星创建报表缺少有效的当前店铺名称，未提交创建。');
  }
  const expectedStoreNames = new Set([
    normalizedStoreName,
    `${normalizedStoreName}-${normalizedMarketplaceCode}`,
  ]);
  const panels = page.locator('.el-transfer-panel:visible');
  const panelCount = await panels.count();
  if (panelCount !== 2) {
    throw new Error(`领星创建报表店铺选择器应有 2 个可见列表，当前为 ${panelCount} 个；未提交创建。`);
  }
  const countExactVisibleStoreItems = async (panel: Locator): Promise<number> => {
    const items = panel.locator('label.el-transfer-panel__item:visible');
    let exactMatches = 0;
    for (let index = 0; index < await items.count(); index += 1) {
      const storeLabel = items.nth(index).locator('.el-checkbox__label').first();
      const normalizedItemText = normalizeLingxingCollectionStoreName(await storeLabel.innerText());
      if (normalizedItemText === normalizedStoreName || (normalizedItemText && expectedStoreNames.has(normalizedItemText))) {
        exactMatches += 1;
      }
    }
    return exactMatches;
  };
  const selectionDeadline = Date.now() + 5_000;
  let sourceMatches = 0;
  let selectedMatches = 0;
  do {
    sourceMatches = await countExactVisibleStoreItems(panels.nth(0));
    selectedMatches = await countExactVisibleStoreItems(panels.nth(1));
    if (sourceMatches === 0 && selectedMatches === 1) return;
    if (Date.now() < selectionDeadline) await page.waitForTimeout(200);
  } while (Date.now() < selectionDeadline);
  throw new Error(`领星创建报表未唯一选中当前店铺“${normalizedStoreName}”；待选列表 ${sourceMatches} 条，已选列表 ${selectedMatches} 条，未提交创建。`);
}

export async function refreshDownloadCenterReportList(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  selectors: DownloadCenterActionSelectors,
): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  await page.keyboard.press('Escape').catch(() => undefined);
  let acted = false;

  const refreshSelector = selectors.listRefreshButton || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.listRefreshButton;
  const refreshButton = page.locator(refreshSelector).first();
  if (await refreshButton.isVisible({ timeout: 1500 }).catch(() => false)) {
    await refreshButton.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    acted = true;
  }

  const sorted = await ensureDownloadCenterCreateTimeLatestFirst(
    page,
    selectors.createTimeSortHeader || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.createTimeSortHeader,
  );
  acted = acted || sorted;

  if (!acted) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
  }
  await page.waitForTimeout(500);
}

export async function submitExactDownloadCenterReportSearch(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  searchInput: Locator,
  expectedReportName: string,
): Promise<void> {
  await searchInput.fill(expectedReportName);
  if ((await searchInput.inputValue()).trim() !== expectedReportName) {
    throw new Error('下载中心没有保持本次生成名的精确搜索条件；任务继续阻断，未重复创建。');
  }

  const form = searchInput.locator('xpath=ancestor::form[1]');
  const hasUniqueForm = (await form.count()) === 1;
  const queryCandidates = hasUniqueForm
    ? form.locator([
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("查询")',
      'button:has-text("搜索")',
      'a:has-text("查询")',
      'a:has-text("搜索")',
    ].join(', '))
    : page.locator([
      'button:has-text("查询")',
      'button:has-text("搜索")',
      'a:has-text("查询")',
      'a:has-text("搜索")',
    ].join(', '));
  const visibleCandidates: number[] = [];
  const candidateCount = await queryCandidates.count();
  for (let index = 0; index < candidateCount; index += 1) {
    if (await queryCandidates.nth(index).isVisible().catch(() => false)) {
      visibleCandidates.push(index);
    }
  }
  if (visibleCandidates.length !== 1) {
    throw new Error(`下载中心精确查询动作命中 ${visibleCandidates.length} 个可见按钮；为避免误查，任务已阻断。`);
  }
  await queryCandidates.nth(visibleCandidates[0]).click({ timeout: 5000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(750);
  if ((await searchInput.inputValue()).trim() !== expectedReportName) {
    throw new Error('下载中心提交查询后丢失本次生成名；任务继续阻断，未重复创建。');
  }
}

export async function waitForCreatedReportRowByExactSearch(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  selectors: DownloadCenterActionSelectors,
  context: DownloadCenterReportSelectorContext,
  dateRange: { start: string; end: string },
  timeoutMs = 30_000,
): Promise<void> {
  const mainRuntimeContext = getMainRuntimeContext();
  const expectedReportName = context.generatedReportName || context.displayName;
  const reportSearchInput = await assertUsableDownloadCenterActionSelector(
    page,
    'reportSearchInput',
    selectors.reportSearchInput || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportSearchInput,
    context,
    dateRange,
  );
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await refreshDownloadCenterReportList(page, selectors);
    const searchInput = page.locator(reportSearchInput).first();
    await submitExactDownloadCenterReportSearch(page, searchInput, expectedReportName);

    const observed = reconcileLingxingCreatedReportRows(await page.locator('tr').allInnerTexts(), {
      expectedReportName,
      dateStart: dateRange.start,
      dateEnd: dateRange.end,
      exactSearchApplied: true,
    });
    if (observed.outcome === 'found') return;
    if (observed.outcome === 'ambiguous') {
      throw new Error('下载中心出现重复或状态不明的同名报表；创建结果保持未知，禁止重复创建。');
    }
    if (Date.now() < deadline) {
      await page.waitForTimeout(Math.min(1_500, Math.max(0, deadline - Date.now())));
    }
  }

  throw new Error(`下载中心精确搜索未发现新建报表：${expectedReportName}`);
}

export async function clickUniqueVisibleLingxingCreateConfirmation(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  timeoutMs = 5_000,
): Promise<boolean> {
  const candidates = page.locator([
    '.layui-layer-btn0',
    '.el-message-box:visible button:has-text("确定")',
    '.el-message-box:visible button:has-text("确认")',
    '.el-dialog:visible button:has-text("确定")',
    '.el-dialog:visible button:has-text("确认")',
    '[role="dialog"]:visible button:has-text("确定")',
    '[role="dialog"]:visible button:has-text("确认")',
    'button:has-text("确定")',
    'a:has-text("确定")',
  ].join(', '));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visibleIndexes: number[] = [];
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      if (await candidates.nth(index).isVisible().catch(() => false)) visibleIndexes.push(index);
    }
    if (visibleIndexes.length > 1) {
      throw new Error(`领星创建确认弹窗同时出现 ${visibleIndexes.length} 个可见“确定/确认”按钮；为避免误提交，操作已阻断。`);
    }
    if (visibleIndexes.length === 1) {
      await candidates.nth(visibleIndexes[0]).click();
      return true;
    }
    await page.waitForTimeout(200);
  }
  return false;
}

export async function readLingxingCreateSubmissionFeedback(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  confirmationClicked: boolean,
): Promise<{ confirmationClicked: boolean; pathname: string; visibleMessages: string[] }> {
  return page.evaluate(({ clicked }) => {
    const failurePattern = /失败|错误|请选择|不能为空|必填|未选择|至少|频繁|稍后|超时|限制|无权限|不支持|已存在|重复|异常|不足/;
    const selectors = [
      '.el-form-item__error',
      '.el-message__content',
      '.el-notification__content',
      '.layui-layer-content',
      '.alert',
      '[role="alert"]',
      '.invalid-feedback',
      '.text-danger',
    ].join(', ');
    const isVisible = (element: Element) => {
      const html = element as HTMLElement;
      const style = window.getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const sanitize = (value: string) => value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
      .replace(/\b[a-f0-9]{24,}\b/gi, '[redacted]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    const visibleMessages = Array.from(document.querySelectorAll(selectors))
      .filter(isVisible)
      .map((element) => sanitize(element.textContent || ''))
      .filter((message) => Boolean(message) && failurePattern.test(message));
    let pathname = '';
    try {
      pathname = new URL(window.location.href).pathname;
    } catch {
      pathname = '';
    }
    return {
      confirmationClicked: clicked,
      pathname,
      visibleMessages: Array.from(new Set(visibleMessages)).slice(0, 8),
    };
  }, { clicked: confirmationClicked });
}

export function extractLingxingCreateResponseMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['message', 'msg', 'error', 'errmsg', 'error_message']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return sanitizeEvidenceText(value)
        .replace(/\b[a-f0-9]{24,}\b/gi, '[redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
    }
  }
  return extractLingxingCreateResponseMessage(record.data);
}

export async function captureLingxingCreateSubmissionResponses(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  action: () => Promise<boolean>,
): Promise<{ value: boolean; responses: LingxingCreateSubmissionResponseEvidence[] }> {
  const responses: LingxingCreateSubmissionResponseEvidence[] = [];
  const pending: Promise<void>[] = [];
  const handleResponse = (response: Response) => {
    const method = response.request().method().toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (url.hostname !== 'lingxing.com' && !url.hostname.endsWith('.lingxing.com')) return;
    pending.push((async () => {
      let message: string | undefined;
      const contentType = response.headers()['content-type'] || '';
      if (/json/i.test(contentType)) {
        try {
          const body = await response.text();
          if (body.length <= 16_384) {
            message = extractLingxingCreateResponseMessage(JSON.parse(body));
          }
        } catch {
          // 提供方响应体不可读时，状态码和路径仍用于诊断。
        }
      }
      responses.push({
        method,
        pathname: url.pathname,
        status: response.status(),
        ...(message ? { message } : {}),
      });
    })());
  };

  page.on('response', handleResponse);
  try {
    const value = await action();
    await page.waitForTimeout(750);
    return { value, responses };
  } finally {
    page.off('response', handleResponse);
    await Promise.allSettled(pending);
  }
}

export function summarizeLingxingCreateSubmissionResponses(
  responses: LingxingCreateSubmissionResponseEvidence[],
): string {
  if (responses.length === 0) return '未捕获领星非 GET 请求';
  return responses.slice(0, 8).map((response) => {
    const base = `${response.method} ${response.pathname} -> ${response.status}`;
    return response.message ? `${base}（${response.message}）` : base;
  }).join('；');
}

export async function ensureDownloadCenterCreateTimeLatestFirst(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  selector: string,
): Promise<boolean> {
  const header = page.locator(selector).first();
  if (!await header.isVisible({ timeout: 1500 }).catch(() => false)) {
    return false;
  }

  let clicked = false;
  let state = await readDownloadCenterSortState(header);
  if (state === 'descending') {
    await header.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(350);
    clicked = true;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    state = await readDownloadCenterSortState(header);
    if (state === 'descending' && clicked) {
      return true;
    }
    await header.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    clicked = true;
    if (state === 'unknown' && attempt >= 1) {
      return true;
    }
  }
  return clicked;
}

export async function readDownloadCenterSortState(
  locator: ReturnType<NonNullable<ReturnType<BrowserController['getPage']>>['locator']>,
): Promise<'ascending' | 'descending' | 'unknown'> {
  return locator.evaluate((element) => {
    const target = (element.closest('th,[role="columnheader"],.el-table__cell') || element) as HTMLElement;
    const text = [
      target.className?.toString() || '',
      target.getAttribute('aria-sort') || '',
      target.getAttribute('class') || '',
      target.querySelector('[class*="sort"]')?.getAttribute('class') || '',
    ].join(' ').toLowerCase();
    if (/desc|descending|降序/.test(text)) return 'descending';
    if (/asc|ascending|升序/.test(text)) return 'ascending';
    return 'unknown';
  }).catch(() => 'unknown' as const);
}
