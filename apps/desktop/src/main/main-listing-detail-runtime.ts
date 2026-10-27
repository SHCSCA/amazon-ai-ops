import { BrowserController } from '@amazon-ai-ops/browser-worker';
import { withLegacyOperatorBrowserLease } from './main-operator-browser-runtime';
import { clickLingxingListingReadOnlyTab, extractListingFromLingxingCore, mergeListingExtractionResults, persistListingContent, readCurrentOperationScopeValue } from './main-listing-extraction-runtime';
import { sanitizeEvidenceUrl } from './main-download-diagnostics-runtime';

export async function handleOpenLingxingListingAndExtract(input: unknown) {
  return withLegacyOperatorBrowserLease(
    'lingxing',
    'legacy-listing-open-extract',
    ({ controller }) => openLingxingListingAndExtractCore(controller, input),
  );
}

export async function openLingxingListingAndExtractCore(
  controller: BrowserController,
  input: unknown,
) {
  const targetUrl = parseLingxingListingReadUrl(input);
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面未就绪，请重新打开登录窗口后再试。');
  }

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(8000);
  const hasNetworkError = await page.getByText('网络异常', { exact: false }).first().isVisible({ timeout: 1000 }).catch(() => false);
  if (hasNetworkError) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
    await page.waitForTimeout(10000);
  }
  return extractListingFromLingxingCore(controller);
}

export async function handleProbeLingxingListingDetailAndExtract(input?: unknown) {
  return withLegacyOperatorBrowserLease(
    'lingxing',
    'legacy-listing-probe-extract',
    ({ controller }) => probeLingxingListingDetailAndExtractCore(controller, input),
  );
}

export async function probeLingxingListingDetailAndExtractCore(
  controller: BrowserController,
  input?: unknown,
) {
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面未就绪，请重新打开登录窗口后再试。');
  }

  const rawUrl = input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string'
    ? (input as { url: string }).url.trim()
    : typeof input === 'string'
      ? input.trim()
      : '';
  const expectedAsin = input && typeof input === 'object' && typeof (input as { expectedAsin?: unknown }).expectedAsin === 'string'
    ? (input as { expectedAsin: string }).expectedAsin.trim().toUpperCase()
    : '';
  const scope = input && typeof input === 'object' && (input as { scope?: unknown }).scope && typeof (input as { scope?: unknown }).scope === 'object'
    ? (input as { scope: { storeName?: unknown; marketplaceCode?: unknown } }).scope
    : undefined;
  const persistContext = {
    storeName: typeof scope?.storeName === 'string' && scope.storeName.trim() ? scope.storeName.trim() : readCurrentOperationScopeValue('storeName'),
    marketplaceCode: typeof scope?.marketplaceCode === 'string' && scope.marketplaceCode.trim() ? scope.marketplaceCode.trim() : readCurrentOperationScopeValue('marketplaceCode'),
  };
  const shouldPersist = !(input && typeof input === 'object' && (input as { persist?: unknown }).persist === false);
  if (rawUrl) {
    const targetUrl = parseLingxingListingReadUrl(rawUrl);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);
  }

  const current = await extractListingFromLingxingCore(controller, { persist: false });
  const probe = {
    started: true,
    clicked: false,
    status: 'not_attempted',
    fromUrl: current.evidence.pageUrl,
    finalUrl: current.evidence.pageUrl,
    candidateCount: current.evidence.detailCandidates?.length || 0,
    asinMatched: Boolean(current.listing?.asin && (!expectedAsin || current.listing.asin.toUpperCase() === expectedAsin)),
  };

  const currentAsin = current.listing?.asin?.toUpperCase();
  const targetAsin = expectedAsin || currentAsin || '';
  if (current.fullContentReady && (!targetAsin || currentAsin === targetAsin)) {
    current.evidence.detailProbe = { ...probe, status: 'already_full_content_ready' };
    if (shouldPersist && current.listing) {
      persistListingContent(current.listing, {
        storeName: persistContext.storeName,
        marketplaceCode: persistContext.marketplaceCode,
        sourceUrl: current.evidence.pageUrl,
        screenshotPath: current.evidence.screenshotPath,
      });
    }
    return current;
  }
  if (!targetAsin) {
    current.evidence.detailProbe = {
      ...probe,
      status: 'no_asin',
      reason: '当前页面未读取到 ASIN，且当前操作范围没有目标 ASIN，不能定位详情页候选。',
    };
    return current;
  }

  const candidate = await findVisibleListingDetailCandidate(page, targetAsin);
  if (candidate.status !== 'unique' || !candidate.token) {
    current.evidence.detailProbe = {
      ...probe,
      status: candidate.status,
      candidateCount: candidate.candidateCount,
      candidateText: candidate.text,
      candidateHref: candidate.href,
      reason: candidate.reason,
    };
    return current;
  }

  const context = controller.getContext();
  const popupPromise = context?.waitForEvent('page', { timeout: 12000 }).catch(() => null);
  await page.locator(`[data-amazon-ai-ops-listing-probe="${candidate.token}"]`).first().click({ timeout: 15000 });
  const popup = await popupPromise;
  const detailPage = popup || page;
  if (popup) {
    controller.setActivePage(popup);
  }
  await detailPage.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => undefined);
  await detailPage.waitForTimeout(8000);

  const finalUrl = detailPage.url();
  let safeFinalUrl = '';
  try {
    safeFinalUrl = parseLingxingListingReadUrl(finalUrl);
  } catch (error) {
    current.evidence.detailProbe = {
      ...probe,
      clicked: true,
      status: 'unsafe_final_url',
      finalUrl: sanitizeEvidenceUrl(finalUrl),
      candidateCount: candidate.candidateCount,
      candidateText: candidate.text,
      candidateHref: candidate.href,
      reason: error instanceof Error ? error.message : String(error),
    };
    return current;
  }

  const basicRead = await extractListingFromLingxingCore(controller, { expectedAsin: targetAsin, persist: false, scope: persistContext });
  let probed = basicRead;
  if (!basicRead.fullContentReady) {
    const switchedToDescription = await clickLingxingListingReadOnlyTab(detailPage, ['描述', 'Description', '商品描述']);
    if (switchedToDescription) {
      await detailPage.waitForTimeout(2500);
      const descriptionRead = await extractListingFromLingxingCore(controller, { expectedAsin: targetAsin, persist: false, scope: persistContext });
      probed = mergeListingExtractionResults(basicRead, descriptionRead);
    }
  }
  probed.evidence.detailProbe = {
    ...probe,
    clicked: true,
    status: probed.fullContentReady ? 'full_content_ready' : 'partial_after_probe',
    finalUrl: sanitizeEvidenceUrl(safeFinalUrl),
    candidateCount: candidate.candidateCount,
    candidateText: candidate.text,
    candidateHref: candidate.href,
    asinMatched: Boolean(probed.listing?.asin && probed.listing.asin.toUpperCase() === targetAsin),
    reason: probed.fullContentReady ? undefined : '详情页已打开，但仍未读取到完整五点和后台词。',
  };
  if (shouldPersist && probed.fullContentReady && probed.listing) {
    persistListingContent(probed.listing, {
      storeName: persistContext.storeName,
      marketplaceCode: persistContext.marketplaceCode,
      sourceUrl: probed.evidence.pageUrl,
      screenshotPath: probed.evidence.screenshotPath,
    });
  }
  return probed;
}

export async function findVisibleListingDetailCandidate(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  asin: string,
): Promise<{ status: string; token?: string; candidateCount: number; text?: string; href?: string; reason?: string }> {
  const direct = await page.evaluate((targetAsin) => {
    const token = `aao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const textOf = (element: Element | null | undefined) =>
      String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const safeTextPattern = /(详情|查看|编辑本地信息|编辑在线商品|查看基本|detail|view|edit)/i;
    const unsafeTextPattern = /(保存|发布|提交|同步|删除|移除|下架|上架|打印|条码|fnsku|help|帮助|save|submit|publish|delete|remove|sync|print|barcode)/i;
    const globalToolbarPattern = /(更多筛选|操作记录|上传商品记录|导入配对记录|自动配对记录|导入分配负责人记录|导入本地信息记录|导入标签记录|导入调价记录)/;
    const rowSelector = 'tr, .el-table__row, .vxe-body--row, [role="row"], [class*="body--row"], [class*="table-row"]';
    const rows = Array.from(document.querySelectorAll(rowSelector))
      .filter((element) => {
        const text = textOf(element);
        return text.toUpperCase().includes(targetAsin.toUpperCase()) && !globalToolbarPattern.test(text);
      });
    if (rows.length === 0) {
      return { status: 'no_asin_row', candidateCount: 0, reason: '当前页面没有找到包含目标 ASIN 的可见行。' };
    }
    const candidates: Array<{ element: HTMLElement; text: string; href: string }> = [];
    for (const row of rows.slice(0, 5)) {
      for (const element of Array.from(row.querySelectorAll('a, button, [role="button"]'))) {
        if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
        const text = textOf(element);
        const href = element instanceof HTMLAnchorElement ? element.href : '';
        const label = [
          text,
          element.getAttribute('aria-label') || '',
          element.getAttribute('title') || '',
          href,
        ].join(' ');
        if (!safeTextPattern.test(label) || unsafeTextPattern.test(label) || globalToolbarPattern.test(label)) continue;
        candidates.push({ element, text, href });
      }
    }
    const unique = candidates.filter((candidate, index) =>
      candidates.findIndex((item) => item.text === candidate.text && item.href === candidate.href) === index,
    );
    if (unique.length === 0) {
      return { status: 'no_candidate', candidateCount: 0, reason: '目标 ASIN 行内没有可见的详情/查看/编辑入口。' };
    }
    if (unique.length > 1) {
      return {
        status: 'ambiguous_candidates',
        candidateCount: unique.length,
        text: unique.slice(0, 3).map((candidate) => candidate.text || candidate.href || '未命名入口').join('；'),
        href: unique[0].href,
        reason: '目标 ASIN 行内发现多个候选入口，需要人工确认或更精确 selector。',
      };
    }
    unique[0].element.setAttribute('data-amazon-ai-ops-listing-probe', token);
    return {
      status: 'unique',
      token,
      candidateCount: 1,
      text: unique[0].text,
      href: unique[0].href,
    };
  }, asin);
  if (direct.status === 'unique' || direct.status === 'ambiguous_candidates') {
    return direct;
  }

  const dropdown = await page.evaluate((targetAsin) => {
    const token = `aao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const textOf = (element: Element | null | undefined) =>
      String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const rowSelector = 'tr, .el-table__row, .vxe-body--row, [role="row"], [class*="body--row"], [class*="table-row"]';
    const globalToolbarPattern = /(更多筛选|操作记录|上传商品记录|导入配对记录|自动配对记录|导入分配负责人记录|导入本地信息记录|导入标签记录|导入调价记录)/;
    const rowOperationPattern = /(操作|编辑在线商品|编辑本地信息|查看基本)/;
    const targetOperationPattern = /(编辑在线商品|编辑本地信息|查看基本)/;
    const isOperationDropdown = (element: Element) => {
      const text = textOf(element);
      const label = [
        text,
        element.getAttribute('aria-label') || '',
        element.getAttribute('title') || '',
        element.getAttribute('class') || '',
      ].join(' ');
      if (globalToolbarPattern.test(label)) return false;
      if (!rowOperationPattern.test(label)) return false;
      if (targetOperationPattern.test(label)) return true;
      const parentText = textOf(element.closest('td, [role="cell"], .vxe-cell, .el-table__cell'));
      return targetOperationPattern.test(parentText);
    };
    const allRows = Array.from(document.querySelectorAll(rowSelector));
    const asinRows = allRows
      .filter((element) => {
        const text = textOf(element);
        return text.toUpperCase().includes(targetAsin.toUpperCase()) && !globalToolbarPattern.test(text) && isVisible(element);
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { element, top: Math.round(rect.top), text: textOf(element) };
      });
    if (asinRows.length === 0) {
      return { status: 'no_asin_row', candidateCount: 0, reason: '当前页面没有找到包含目标 ASIN 的可见行。' };
    }

    const operationDropdowns = Array.from(document.querySelectorAll('.ak-dropdown, [class*="dropdown"], [role="button"], button'))
      .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element))
      .filter(isOperationDropdown)
      .map((element) => {
        const row = element.closest(rowSelector);
        const rect = (row || element).getBoundingClientRect();
        return { element, top: Math.round(rect.top), text: textOf(element), rowText: textOf(row || element) };
      })
      .filter((candidate) =>
        asinRows.some((row) =>
          candidate.rowText.toUpperCase().includes(targetAsin.toUpperCase())
          || Math.abs(candidate.top - row.top) <= 6
        )
      )
      .filter((candidate, index, list) =>
        list.findIndex((item) => item.element === candidate.element) === index
      );

    const preferredDropdowns = operationDropdowns.filter((candidate) => targetOperationPattern.test(candidate.text));
    const selectedDropdowns = preferredDropdowns.length > 0 ? preferredDropdowns : operationDropdowns;

    if (selectedDropdowns.length === 1) {
      const trigger = Array.from(selectedDropdowns[0].element.querySelectorAll('span, a, button, [role="button"]'))
        .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element))
        .find((element) => /^操作\s*$/.test(textOf(element)))
        || selectedDropdowns[0].element;
      trigger.setAttribute('data-amazon-ai-ops-listing-probe-dropdown', token);
      return {
        status: 'dropdown_unique',
        token,
        candidateCount: 1,
        text: selectedDropdowns[0].text,
      };
    }
    if (selectedDropdowns.length > 1) {
      return {
        status: 'ambiguous_dropdowns',
        candidateCount: selectedDropdowns.length,
        text: selectedDropdowns.slice(0, 3).map((candidate) => candidate.text || '未命名下拉').join('；'),
        reason: '目标 ASIN 视觉行内发现多个操作下拉候选，需要更精确 selector。',
      };
    }
    return { status: 'no_candidate', candidateCount: 0, reason: '目标 ASIN 行内没有可见的详情/查看/编辑入口。' };
  }, asin);
  if (dropdown.status !== 'dropdown_unique' || !dropdown.token) {
    return dropdown;
  }

  const dropdownLocator = page.locator(`[data-amazon-ai-ops-listing-probe-dropdown="${dropdown.token}"]`).first();
  await dropdownLocator.hover({ timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await dropdownLocator.click({ timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(1500);

  return page.evaluate((dropdownText) => {
    const token = `aao-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const textOf = (element: Element | null | undefined) =>
      String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const priority = ['编辑在线商品', '查看基本', '编辑本地信息'];
    const items = Array.from(document.querySelectorAll('.el-dropdown-menu__item, [role="menuitem"], .el-dropdown-menu *, .ak-dropdown-menu *, li, a, button, span'))
      .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element))
      .map((element) => ({ element, text: textOf(element), href: element instanceof HTMLAnchorElement ? element.href : '' }))
      .filter((item) => priority.some((label) => item.text === label || item.text.includes(label)));
    const selected = priority
      .map((label) => items.find((item) => item.text === label) || items.find((item) => item.text.includes(label)))
      .find(Boolean);
    if (!selected) {
      return {
        status: 'no_safe_dropdown_item',
        candidateCount: items.length,
        text: dropdownText,
        reason: '已展开操作下拉，但没有找到明确的编辑在线商品/查看基本/编辑本地信息入口。',
      };
    }
    selected.element.setAttribute('data-amazon-ai-ops-listing-probe', token);
    return {
      status: 'unique',
      token,
      candidateCount: 1,
      text: selected.text,
      href: selected.href,
    };
  }, dropdown.text || '');
}

export function parseLingxingListingReadUrl(input: unknown): string {
  const rawUrl = typeof input === 'string'
    ? input
    : input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string'
      ? (input as { url: string }).url
      : '';
  if (!rawUrl.trim()) {
    throw new Error('请输入领星 Listing 页面 URL');
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('领星 Listing URL 无效');
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !['erp.lingxing.com', 'ads.lingxing.com'].includes(host)) {
    throw new Error('仅允许打开领星 ERP/Ads 的 HTTPS 页面用于只读读取。');
  }
  const pathText = `${url.pathname} ${url.search}`.toLowerCase();
  if (!/(listing|product|goods|spu|sku)/i.test(pathText)) {
    throw new Error('该 URL 看起来不是 Listing/商品相关页面，请打开领星 Listing 页面后再读取。');
  }
  url.hash = '';
  return url.toString();
}
