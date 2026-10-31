import { validateListing } from './main-input-contract';
import * as path from 'path';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import { loadFixedReportFieldMapping } from './report-parser-field-mapping';
import type { ListingContent } from '@amazon-ai-ops/shared-types';
import { canonicalizeAmazonAsin } from '@amazon-ai-ops/shared-types';
import { extractLingxingListingFromSnapshot, type ListingDomFieldSnapshot, type ListingExtractionResult, type ListingPageSnapshot } from './listing-lingxing-extractor';
import { getBundledResourcesPath } from './main-store-access-runtime';
import { withLegacyOperatorBrowserLease } from './main-operator-browser-runtime';
import { sanitizeEvidenceUrl } from './main-download-diagnostics-runtime';
import { resolveBusinessStoreAuthority } from './main-business-scope-runtime';
import { handleGetOperationScope } from './main-delivery-scope-runtime';
import type { ListingReadOptions, ListingReadPersistContext } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export async function handleImportListingContent(filePath: string): Promise<ListingContent> {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('请选择 Listing 文案文件');
  }

  const mainRuntimeContext = getMainRuntimeContext();
  const context = resolveBusinessStoreAuthority().context;
  const parser = mainRuntimeContext.reportParserRuntime.createSession();
  const snapshot = parser.read(filePath);
  try {
  const listing = await parser.listing(snapshot, {
    fieldMapping: loadFixedReportFieldMapping('listing'),
  });
  mainRuntimeContext.state.storeCoordinator!.assertActiveStoreContext(context);
  parser.assertCurrent(snapshot);
  validateListing(listing);
  return listing;
  } finally { parser.release(snapshot); }
}

export function handleExtractListingFromLingxing(options: ListingReadOptions = {}) {
  return withLegacyOperatorBrowserLease(
    'lingxing',
    'legacy-listing-extract',
    ({ controller }) => extractListingFromLingxingCore(controller, options),
  );
}

export async function extractListingFromLingxingCore(
  controller: BrowserController,
  options: ListingReadOptions = {},
) {
  const mainRuntimeContext = getMainRuntimeContext();
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面未就绪，请重新打开登录窗口后再试。');
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined);
  const capturedAt = new Date().toISOString();
  const screenshotPath = path.join(mainRuntimeContext.SCREENSHOTS_DIR, `lingxing_listing_read_${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
  const snapshot = await page.evaluate(() => {
    const textOf = (element: Element | null | undefined) =>
      (element?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const cssPathOf = (element: Element) => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && parts.length < 4) {
        const tag = current.tagName.toLowerCase();
        const id = current.getAttribute('id');
        if (id) {
          parts.unshift(`${tag}#${CSS.escape(id)}`);
          break;
        }
        const className = String(current.getAttribute('class') || '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((value) => `.${CSS.escape(value)}`)
          .join('');
        const siblings = current.parentElement
          ? Array.from(current.parentElement.children).filter((item) => item.tagName === current!.tagName)
          : [];
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
        parts.unshift(`${tag}${className}${nth}`);
        current = current.parentElement;
      }
      return parts.join(' > ');
    };
    const fieldLabel = (element: HTMLElement) => {
      const id = element.getAttribute('id');
      const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const closest = element.closest('label, .form-item, .ant-form-item, .el-form-item, .layui-form-item, tr');
      const rect = element.getBoundingClientRect();
      const nearbyLabels = Array.from(document.querySelectorAll('label, span, div'))
        .map((candidate) => {
          const labelRect = candidate.getBoundingClientRect();
          const text = textOf(candidate);
          return { text, rect: labelRect, childCount: candidate.children.length };
        })
        .filter((candidate) =>
          candidate.text
          && candidate.text.length <= 80
          && candidate.childCount <= 4
          && candidate.rect.width > 0
          && candidate.rect.height > 0
          && candidate.rect.left < rect.left
          && candidate.rect.right <= rect.left + 12
          && Math.abs((candidate.rect.top + candidate.rect.height / 2) - (rect.top + rect.height / 2)) <= Math.max(24, rect.height)
        )
        .sort((a, b) => Math.abs(a.rect.right - rect.left) - Math.abs(b.rect.right - rect.left))
        .slice(0, 2)
        .map((candidate) => candidate.text);
      return [
        textOf(explicit),
        ...nearbyLabels,
        element.getAttribute('aria-label') || '',
        element.getAttribute('placeholder') || '',
        element.getAttribute('name') || '',
        textOf(closest),
      ].filter(Boolean).join(' ');
    };
    const formFields: ListingDomFieldSnapshot[] = Array.from(
      document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'),
    ).map((element, index) => {
      const htmlElement = element as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
      const value = 'value' in htmlElement
        ? String(htmlElement.value || '')
        : String(htmlElement.textContent || '');
      return {
        key: `${htmlElement.tagName.toLowerCase()}-${index}`,
        label: fieldLabel(htmlElement),
        value: value.replace(/\s+\n/g, '\n').trim(),
      };
    }).filter((field) => field.value || field.label);
    const rowFields: ListingDomFieldSnapshot[] = Array.from(
      document.querySelectorAll('tr, .el-table__row, .vxe-body--row, [role="row"], [class*="body--row"]'),
    ).slice(0, 100).map((element, index) => ({
      key: `row-${index}`,
      label: 'listing table row visible text',
      value: String(element.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim().slice(0, 2000),
    })).filter((field) => field.value);
    const asinPattern = /\bB0[A-Z0-9]{8}\b/i;
    const asinContextFields: ListingDomFieldSnapshot[] = [];
    const seenContextText = new Set<string>();
    for (const element of Array.from(document.querySelectorAll('*')).slice(0, 5000)) {
      const text = String(element.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
      if (!asinPattern.test(text)) continue;
      const row = element.closest('tr, .el-table__row, .vxe-body--row, [role="row"], [class*="body--row"], [class*="table"]') || element;
      const rowText = String(row.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim().slice(0, 2000);
      if (!rowText || seenContextText.has(rowText)) continue;
      seenContextText.add(rowText);
      asinContextFields.push({
        key: `asin-context-${asinContextFields.length}`,
        label: 'listing asin row context visible text',
        value: rowText,
      });
      if (asinContextFields.length >= 30) break;
    }
    const visualItems = Array.from(document.querySelectorAll('body *')).slice(0, 8000).map((element) => {
      const rect = element.getBoundingClientRect();
      const text = String(element.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        text,
        x: Math.round(rect.left),
        y: Math.round(rect.top / 6) * 6,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        childCount: element.children.length,
      };
    }).filter((item) =>
      item.text
      && item.text.length <= 220
      && item.width > 0
      && item.height > 0
      && item.y > 60
      && item.childCount <= 3
    );
    const visualRows = new Map<number, Array<{ text: string; x: number }>>();
    for (const item of visualItems) {
      const row = visualRows.get(item.y) || [];
      row.push({ text: item.text, x: item.x });
      visualRows.set(item.y, row);
    }
    const visualRowFields: ListingDomFieldSnapshot[] = Array.from(visualRows.entries())
      .sort(([a], [b]) => a - b)
      .slice(0, 120)
      .map(([y, items], index) => ({
        key: `visual-row-${index}`,
        label: `listing visual row y=${y}`,
        value: Array.from(new Set(items.sort((a, b) => a.x - b.x).map((item) => item.text))).join('\n').slice(0, 2000),
      }))
      .filter((field) => field.value);
    const bodyVisibleText = String(document.body?.innerText || '').replace(/[ \t]+/g, ' ').trim().slice(0, 12000);
    const bodyField: ListingDomFieldSnapshot[] = bodyVisibleText
      ? [{
          key: 'body-visible-text',
          label: 'listing page visible body text',
          value: bodyVisibleText,
        }]
      : [];
    const detailCandidates = Array.from(document.querySelectorAll('a, button, [role="button"], .el-dropdown-menu__item, [class*="dropdown"], [class*="operation"]'))
      .slice(0, 1200)
      .map((element, index) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        const text = textOf(element);
        const href = element instanceof HTMLAnchorElement ? element.href : '';
        const aria = htmlElement.getAttribute('aria-label') || '';
        const title = htmlElement.getAttribute('title') || '';
        return {
          key: `detail-candidate-${index}`,
          label: [aria, title].filter(Boolean).join(' '),
          text,
          href,
          selectorHint: cssPathOf(element),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((candidate) => candidate.visible)
      .filter((candidate) => {
        const haystack = `${candidate.text} ${candidate.label} ${candidate.href}`.toLowerCase();
        return /(详情|编辑|修改|查看|管理|listing|product|goods|spu|sku|edit|detail|view)/i.test(haystack);
      })
      .map(({ visible, ...candidate }) => candidate)
      .slice(0, 30);
    const fields = [...formFields, ...rowFields, ...asinContextFields, ...visualRowFields, ...bodyField];
    const metaAsin = Array.from(document.querySelectorAll('meta, [data-asin], [asin]')).map((element) =>
      [
        element.getAttribute('content'),
        element.getAttribute('data-asin'),
        element.getAttribute('asin'),
      ].filter(Boolean).join(' '),
    );
    return {
      url: window.location.href,
      title: document.title,
      asinCandidates: [
        window.location.href,
        document.title,
        ...metaAsin,
        ...fields.map((field) => `${field.label} ${field.value}`),
      ],
      fields,
      detailCandidates,
      capturedAt: new Date().toISOString(),
    } satisfies ListingPageSnapshot;
  });

  const result = extractLingxingListingFromSnapshot({ ...snapshot, capturedAt });
  result.evidence.screenshotPath = screenshotPath;
  result.evidence.pageUrl = sanitizeEvidenceUrl(result.evidence.pageUrl);
  const expectedAsin = options.expectedAsin?.toUpperCase();
  if (expectedAsin && result.listing?.asin && result.listing.asin.toUpperCase() !== expectedAsin) {
    return {
      ...result,
      ready: false,
      partialReady: false,
      fullContentReady: false,
      reason: `详情页 ASIN 与列表页不一致：期望 ${expectedAsin}，实际 ${result.listing.asin}`,
      listing: undefined,
      evidence: {
        ...result.evidence,
        partialReady: false,
        fullContentReady: false,
      },
    };
  }

  if (result.ready && result.listing && options.persist !== false) {
    persistListingContent(result.listing, {
      storeName: options.scope?.storeName || readCurrentOperationScopeValue('storeName'),
      marketplaceCode: options.scope?.marketplaceCode || readCurrentOperationScopeValue('marketplaceCode'),
      sourceUrl: result.evidence.pageUrl,
      screenshotPath: result.evidence.screenshotPath,
      source: 'lingxing_readonly',
      versionLabel: '领星只读读取',
      changeSummary: '从当前领星页面辅助读取 Listing 内容',
    });
  }

  return result;
}

export function persistListingContent(listing: ListingContent, context: ListingReadPersistContext = {}): { id: number; versionId: number; savedAt: string } | null {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeScopedAdListingService) return null;
  const { context: activeContext } = resolveBusinessStoreAuthority();
  const normalized = {
    ...listing,
    asin: canonicalizeAmazonAsin(listing.asin),
    title: String(listing.title || '').trim(),
    bullets: Array.isArray(listing.bullets) ? listing.bullets.map((item) => String(item || '').trim()).filter(Boolean) : [],
  };
  const payload = {
    asin: normalized.asin,
    title: normalized.title,
    bullets: normalized.bullets,
    description: normalized.description ?? '',
    aPlus: normalized.aPlus ?? '',
    imageCopy: normalized.imageCopy ?? '',
    backendTerms: normalized.backendTerms ?? '',
    source: context.source || normalized.source || 'manual',
    versionLabel: context.versionLabel || normalized.versionLabel || '',
    changeSummary: context.changeSummary || normalized.changeSummary || '',
  };
  const existing = mainRuntimeContext.state.storeScopedAdListingService.listListingContent(activeContext, {
    asin: normalized.asin,
    limit: 1,
  })[0];
  const saved = existing
    ? mainRuntimeContext.state.storeScopedAdListingService.updateListingContent(activeContext, {
        id: existing.id,
        expectedRevision: existing.revision,
        patch: payload,
      })
    : mainRuntimeContext.state.storeScopedAdListingService.createListingContent(activeContext, payload);
  const version = mainRuntimeContext.state.storeScopedAdListingService.listListingVersions(activeContext, {
    listingContentId: saved.id,
    limit: 1,
  })[0];
  if (!version) throw new Error('Listing 版本回读失败，已拒绝返回未验证的保存结果。');
  return {
    id: saved.id,
    versionId: version.id,
    savedAt: saved.updatedAt,
  };
}

export function readCurrentOperationScopeValue(key: 'storeName' | 'marketplaceCode'): string {
  try {
    const scope = handleGetOperationScope();
    return typeof scope?.[key] === 'string' ? scope[key] : '';
  } catch {
    return '';
  }
}

export async function clickLingxingListingReadOnlyTab(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  labels: string[],
): Promise<boolean> {
  return page.evaluate((targetLabels) => {
    const textOf = (element: Element | null | undefined) =>
      String(element?.textContent || '').replace(/\s+/g, ' ').trim();
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = Array.from(document.querySelectorAll('a, button, [role="tab"], [role="button"], li, span, div'))
      .filter((element): element is HTMLElement => element instanceof HTMLElement && isVisible(element))
      .filter((element) => {
        const text = textOf(element);
        if (!targetLabels.some((label) => text === label || text.includes(label))) return false;
        const rect = element.getBoundingClientRect();
        return rect.left < 260 || /tab|menu|nav|sidebar|anchor/i.test(element.getAttribute('class') || '');
      })
      .sort((a, b) => {
        const aText = textOf(a);
        const bText = textOf(b);
        const aExact = targetLabels.some((label) => aText === label) ? 0 : 1;
        const bExact = targetLabels.some((label) => bText === label) ? 0 : 1;
        return aExact - bExact || a.getBoundingClientRect().left - b.getBoundingClientRect().left;
      });
    const selected = candidates[0];
    if (!selected) return false;
    selected.click();
    return true;
  }, labels);
}

export function mergeListingExtractionResults(
  primary: ListingExtractionResult,
  secondary: ListingExtractionResult,
): ListingExtractionResult {
  if (!primary.listing || !secondary.listing) {
    return primary;
  }
  const listing: ListingContent = {
    ...primary.listing,
    title: primary.listing.title || secondary.listing.title,
    bullets: secondary.listing.bullets.length > 0 ? secondary.listing.bullets : primary.listing.bullets,
    aPlus: secondary.listing.aPlus || primary.listing.aPlus,
    imageCopy: secondary.listing.imageCopy || primary.listing.imageCopy,
    backendTerms: primary.listing.backendTerms || secondary.listing.backendTerms,
    updatedAt: secondary.listing.updatedAt || primary.listing.updatedAt,
  };
  const partialReady = Boolean(listing.asin && listing.title);
  const fullContentReady = Boolean(partialReady && listing.bullets.length > 0 && listing.backendTerms);
  return {
    ready: partialReady,
    partialReady,
    fullContentReady,
    listing,
    evidence: {
      ...secondary.evidence,
      fieldMatches: {
        ...primary.evidence.fieldMatches,
        ...secondary.evidence.fieldMatches,
        title: primary.evidence.fieldMatches.title?.length ? primary.evidence.fieldMatches.title : secondary.evidence.fieldMatches.title,
        backendTerms: primary.evidence.fieldMatches.backendTerms?.length
          ? primary.evidence.fieldMatches.backendTerms
          : secondary.evidence.fieldMatches.backendTerms,
        bullets: secondary.evidence.fieldMatches.bullets?.length
          ? secondary.evidence.fieldMatches.bullets
          : primary.evidence.fieldMatches.bullets,
      },
      completeness: {
        asin: Boolean(listing.asin),
        title: Boolean(listing.title),
        bullets: listing.bullets.length > 0,
        backendTerms: Boolean(listing.backendTerms),
      },
      partialReady,
      fullContentReady,
      detailCandidates: [
        ...(primary.evidence.detailCandidates ?? []),
        ...(secondary.evidence.detailCandidates ?? []),
      ].slice(0, 20),
    },
  };
}
