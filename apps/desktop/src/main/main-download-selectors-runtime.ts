import * as path from 'path';
import * as fs from 'fs';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import { LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterActionSelectorCheck, DownloadCenterActionSelectors, DownloadCenterDiagnosticResult, DownloadCenterPageModel, DownloadCenterSelectorCandidate } from '@amazon-ai-ops/shared-types';
import { selectorUsesDateScope, selectorUsesReportScope } from './download-center-page-model-validation';
import { countVisibleLocatorMatches, sanitizeEvidenceUrl } from './main-download-diagnostics-runtime';
import { getControllerPageOrThrow, renderDownloadCenterSelector } from './main-download-automation-runtime';
import { navigateToLingxingDownloadCenter, waitForCreateReportPage } from './main-download-navigation-runtime';
import { authorizedLingxingCollectionTarget } from './main-business-pipeline-runtime';
import type { DownloadCenterReportSelectorContext } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export async function captureDownloadCenterDiagnosticScreenshot(
  controller: BrowserController,
  screenshotsDir = getMainRuntimeContext().SCREENSHOTS_DIR,
): Promise<string | undefined> {
  const mainRuntimeContext = getMainRuntimeContext();
  const page = controller.getPage();
  if (!page) return undefined;
  fs.mkdirSync(screenshotsDir, { recursive: true });
  const screenshotPath = path.join(screenshotsDir, `download_center_diagnostic_${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

export async function captureDownloadCenterDiagnosticDomSnapshot(
  controller: BrowserController,
  evidenceDir = getMainRuntimeContext().DOM_SNAPSHOTS_DIR,
): Promise<string | undefined> {
  const mainRuntimeContext = getMainRuntimeContext();
  const page = controller.getPage();
  if (!page) return undefined;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const domSnapshotPath = path.join(evidenceDir, `download_center_diagnostic_${Date.now()}.html`);
  const html = await collectSanitizedDomEvidence(controller);
  const metadata = [
    '<!--',
    `capturedAt: ${new Date().toISOString()}`,
    `url: ${sanitizeEvidenceUrl(page.url())}`,
    'purpose: download center selector verification',
    '-->',
    '',
  ].join('\n');
  fs.writeFileSync(domSnapshotPath, `${metadata}${html}`, 'utf8');
  return domSnapshotPath;
}

export async function collectDownloadCenterSelectorCandidates(controller: BrowserController): Promise<DownloadCenterSelectorCandidate[]> {
  return controller.evaluate<DownloadCenterSelectorCandidate[]>(() => {
    const keywords = [
      '创建',
      '生成',
      '下载',
      '广告活动',
      '广告组',
      '广告位',
      '推广的商品',
      '自动投放',
      '关键词',
      '商品投放',
      '用户搜索词',
      '日期',
    ];
    const elements = Array.from(document.querySelectorAll([
      'button',
      'input',
      'textarea',
      '[role="button"]',
      '[role="dialog"]',
      'a',
      'tr',
      'tr[role="row"]',
      'td',
      '.ant-picker',
      '.ant-select',
      '.ant-modal',
      '.ant-table-row',
      '.el-date-editor',
      '.el-select',
      '.el-dialog',
      '.el-checkbox',
      '.el-radio',
      '.JS-download-report',
      '.dataTable',
      '.vxe-body--row',
    ].join(', ')));

    function maskText(value: string): string {
      return value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
        .replace(/(token|session|authorization|cookie)\s*[:=]\s*\S+/gi, '$1=[redacted]')
        .slice(0, 120);
    }

    function cssIdentifierEscape(value: string): string {
      const css = globalThis.CSS as { escape?: (input: string) => string } | undefined;
      if (css?.escape) return css.escape(value);
      return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match) => `\\${match}`);
    }

    function cssStringEscape(value: string): string {
      return value.replace(/["\\]/g, '\\$&');
    }

    function safeMatchCount(selector: string): number {
      try {
        return document.querySelectorAll(selector).length;
      } catch {
        return 0;
      }
    }

    function candidateAttributes(element: Element): Record<string, string> {
      const attrs: Record<string, string> = {};
      for (const attr of ['data-testid', 'data-test', 'data-row-key', 'aria-label', 'name', 'placeholder', 'title', 'type']) {
        const value = element.getAttribute(attr);
        if (value) attrs[attr] = maskText(value);
      }
      return attrs;
    }

    function selectorFor(element: Element): { selector: string; matchCount: number } {
      const html = element as HTMLElement;
      if (html.id) {
        const selector = `#${cssIdentifierEscape(html.id)}`;
        return { selector, matchCount: safeMatchCount(selector) };
      }
      const dataAttrs = ['data-testid', 'data-test', 'data-row-key', 'aria-label', 'name', 'placeholder'];
      for (const attr of dataAttrs) {
        const value = html.getAttribute(attr);
        if (value) {
          const selector = `${element.tagName.toLowerCase()}[${attr}="${cssStringEscape(value)}"]`;
          return { selector, matchCount: safeMatchCount(selector) };
        }
      }
      const text = (html.innerText || html.getAttribute('value') || '').trim().replace(/\s+/g, ' ');
      if (text && text.length <= 40) {
        const tagName = element.tagName.toLowerCase();
        const matchCount = Array.from(document.querySelectorAll(tagName)).filter((item) => ((item as HTMLElement).innerText || '').trim().replace(/\s+/g, ' ') === text).length;
        return { selector: `${tagName}:has-text("${cssStringEscape(text)}")`, matchCount };
      }
      const classes = Array.from(html.classList).slice(0, 3);
      if (classes.length > 0) {
        const selector = `${element.tagName.toLowerCase()}.${classes.map(cssIdentifierEscape).join('.')}`;
        return { selector, matchCount: safeMatchCount(selector) };
      }
      const selector = element.tagName.toLowerCase();
      return { selector, matchCount: safeMatchCount(selector) };
    }

    function roleFor(element: Element, text: string): string {
      const tag = element.tagName.toLowerCase();
      if (element.classList.contains('JS-download-report')) return 'downloadButton';
      if (tag === 'button' || tag === 'a' || element.getAttribute('role') === 'button') {
        return text.includes('下载') ? 'downloadButton' : 'createOrConfirmButton';
      }
      if (tag === 'input' || tag === 'textarea') return 'input';
      if (tag === 'tr' || element.getAttribute('role') === 'row' || element.classList.contains('ant-table-row') || element.classList.contains('vxe-body--row')) return 'readyReportSelector';
      if (element.classList.contains('ant-picker') || element.classList.contains('el-date-editor') || text.includes('开始日期') || text.includes('结束日期')) return 'dateInput';
      if (element.classList.contains('ant-modal') || element.classList.contains('el-dialog') || element.getAttribute('role') === 'dialog') return 'confirmDialog';
      return 'candidate';
    }

    return elements
      .map((element) => {
        try {
          const html = element as HTMLElement;
          const text = maskText((html.innerText || html.getAttribute('placeholder') || html.getAttribute('aria-label') || html.getAttribute('value') || '')
            .trim()
            .replace(/\s+/g, ' '));
          const selector = selectorFor(element);
          const candidate: DownloadCenterSelectorCandidate = {
            role: roleFor(element, text),
            text,
            tagName: element.tagName.toLowerCase(),
            selector: selector.selector,
            matchCount: selector.matchCount,
            unique: selector.matchCount === 1,
            attributes: candidateAttributes(element),
          };
          return candidate;
        } catch {
          return null;
        }
      })
      .filter((candidate): candidate is DownloadCenterSelectorCandidate => Boolean(candidate?.text && keywords.some((keyword) => candidate.text.includes(keyword))))
      .slice(0, 80);
  });
}

export function getDownloadCenterActionSelectorKind(name: string): DownloadCenterActionSelectorCheck['kind'] {
  if (name === 'dateStartInput' || name === 'dateEndInput' || name === 'reportSearchInput') {
    return 'input';
  }
  if (name === 'readyReportSelector') {
    return 'row';
  }
  if (name === 'statusTextSelector') {
    return 'status';
  }
  if (
    name === 'createReportButton'
    || name === 'confirmCreateButton'
    || name === 'downloadButton'
    || name === 'listRefreshButton'
    || name === 'createTimeSortHeader'
  ) {
    return 'click';
  }
  return 'optional';
}

export function evaluateActionSelectorUsability(name: string, selector: string, matchCount: number): {
  usable: boolean;
  ambiguous: boolean;
  errorMessage?: string;
} {
  const mainRuntimeContext = getMainRuntimeContext();
  const requiresReportScope = mainRuntimeContext.REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(name);
  const requiresDateScope = mainRuntimeContext.REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(name);
  if (matchCount === 0) {
    return { usable: false, ambiguous: false };
  }
  if (matchCount > 1) {
    return {
      usable: false,
      ambiguous: true,
      errorMessage: `selector 命中 ${matchCount} 个元素，请收窄到唯一目标`,
    };
  }
  if (requiresReportScope && !selectorUsesReportScope(selector)) {
    return {
      usable: false,
      ambiguous: false,
      errorMessage: '报告相关 selector 必须包含 {reportName}、{reportType}、{expectedFilenameKeyword} 或 {generatedReportName} 占位符',
    };
  }
  if (requiresDateScope && !selectorUsesDateScope(selector)) {
    return {
      usable: false,
      ambiguous: false,
      errorMessage: '报告相关 selector 必须包含 {dateStart}、{dateEnd} 或 {dateRange} 占位符，避免匹配旧报表',
    };
  }
  return { usable: true, ambiguous: false };
}

export async function collectDownloadCenterActionSelectorChecks(
  controller: BrowserController,
  model: DownloadCenterPageModel,
  dateRange?: { start: string; end: string },
  options: {
    names?: Set<string>;
    context?: DownloadCenterReportSelectorContext;
  } = {},
): Promise<DownloadCenterActionSelectorCheck[]> {
  const mainRuntimeContext = getMainRuntimeContext();
  const selectors = model.actionSelectors;
  if (!selectors) {
    return [];
  }
  const page = getControllerPageOrThrow(controller);
  const checks: DownloadCenterActionSelectorCheck[] = [];
  const entries = Object.entries(selectors)
    .filter(([name]) => !options.names || options.names.has(name))
    .filter(([name, selector]) => !name.endsWith('TimeoutMs') && typeof selector === 'string') as Array<[keyof DownloadCenterActionSelectors, string]>;

  for (const [name, selector] of entries) {
    const required = mainRuntimeContext.REQUIRED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(String(name));
    const kind = getDownloadCenterActionSelectorKind(String(name));
    if (!selector.trim()) {
      checks.push({
        name: String(name),
        selector,
        renderedSelector: '',
        required,
        kind,
        matchCount: 0,
        found: false,
        usable: false,
        ambiguous: false,
      });
      continue;
    }

    const needsReport = selector.includes('{reportType}')
      || selector.includes('{reportName}')
      || selector.includes('{expectedFilenameKeyword}')
      || selector.includes('{generatedReportName}');
    const reports = options.context ? [options.context] : needsReport ? LINGXING_AD_REPORTS : [undefined];

    for (const report of reports) {
      const renderedSelector = report
        ? renderDownloadCenterSelector(selector, report, dateRange)
        : selector
          .replaceAll('{dateStart}', dateRange?.start ?? '')
          .replaceAll('{dateEnd}', dateRange?.end ?? '')
          .replaceAll('{dateRange}', dateRange ? `${dateRange.start}_${dateRange.end}` : '');
      try {
        const matchCount = await countVisibleLocatorMatches(page, renderedSelector);
        const usability = evaluateActionSelectorUsability(String(name), selector, matchCount);
        checks.push({
          name: String(name),
          selector,
          renderedSelector,
          required,
          kind,
          reportType: report?.type,
          reportDisplayName: report?.displayName,
          matchCount,
          found: matchCount > 0,
          ...usability,
        });
      } catch (error) {
        checks.push({
          name: String(name),
          selector,
          renderedSelector,
          required,
          kind,
          reportType: report?.type,
          reportDisplayName: report?.displayName,
          matchCount: 0,
          found: false,
          usable: false,
          ambiguous: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return checks;
}

export async function collectDownloadCenterDiagnosticActionSelectorChecks(
  controller: BrowserController,
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string } | undefined,
  context: DownloadCenterReportSelectorContext,
): Promise<DownloadCenterActionSelectorCheck[]> {
  const mainRuntimeContext = getMainRuntimeContext();
  const listPageSelectorNames = new Set([
    'createReportButton',
    'listRefreshButton',
    'createTimeSortHeader',
    'readyReportSelector',
    'statusTextSelector',
    'downloadButton',
  ]);
  const createPageSelectorNames = new Set([
    'storeSearchInput',
    'storeOption',
    'storeMoveButton',
    'reportSearchInput',
    'reportTypeSelect',
    'reportTypeOption',
    'dateStartInput',
    'dateEndInput',
    'dailyDetailRadio',
    'confirmCreateButton',
  ]);

  const listChecks = await collectDownloadCenterActionSelectorChecks(controller, model, dateRange, {
    names: listPageSelectorNames,
    context,
  });
  const selectors = model.actionSelectors;
  if (!selectors?.createReportButton?.trim()) {
    return [
      ...listChecks,
      ...await collectDownloadCenterActionSelectorChecks(controller, model, dateRange, {
        names: createPageSelectorNames,
        context,
      }),
    ];
  }

  const page = getControllerPageOrThrow(controller);
  const createReportButton = renderDownloadCenterSelector(selectors.createReportButton, context, dateRange);
  const canOpenCreatePage = await page.locator(createReportButton).isVisible({ timeout: 5000 }).catch(() => false);
  if (!canOpenCreatePage) {
    return [
      ...listChecks,
      ...await collectDownloadCenterActionSelectorChecks(controller, model, dateRange, {
        names: createPageSelectorNames,
        context,
      }),
    ];
  }

  await page.locator(createReportButton).click();
  await waitForCreateReportPage(page);
  const reportTypeSelect = renderDownloadCenterSelector(
    selectors.reportTypeSelect || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeSelect,
    context,
    dateRange,
  );
  if (await page.locator(reportTypeSelect).isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator(reportTypeSelect).click();
    await page.waitForTimeout(500);
  }
  const createChecks = await collectDownloadCenterActionSelectorChecks(controller, model, dateRange, {
    names: createPageSelectorNames,
    context,
  });
  if (!context.storeName) {
    throw new Error('下载中心诊断缺少当前店铺名称，无法恢复唯一店铺筛选。');
  }
  await navigateToLingxingDownloadCenter(controller, model, context.storeName);
  return [...listChecks, ...createChecks];
}

export async function collectSanitizedDomEvidence(controller: BrowserController): Promise<string> {
  return controller.evaluate<string>(() => {
    function mask(value: string): string {
      return value
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
        .replace(/(token|session|authorization|cookie)\s*[:=]\s*["']?[^"'\s<>]+/gi, '$1=[redacted]')
        .replace(/(access[_-]?token|refresh[_-]?token|csrf[_-]?token)\s*[:=]\s*["']?[^"'\s<>]+/gi, '$1=[redacted]');
    }

    const clone = document.body?.cloneNode(true) as HTMLElement | undefined;
    if (!clone) return '<body></body>';

    clone.querySelectorAll('script, style, noscript, iframe, canvas, svg, img, video, audio').forEach((node) => node.remove());
    clone.querySelectorAll('input, textarea').forEach((node) => {
      const element = node as HTMLInputElement | HTMLTextAreaElement;
      if ('value' in element) element.value = '';
      element.setAttribute('value', '');
    });
    clone.querySelectorAll('table tbody tr:nth-child(n+6), .ant-table-tbody tr:nth-child(n+6)').forEach((node) => node.remove());
    clone.querySelectorAll('*').forEach((node) => {
      const element = node as HTMLElement;
      for (const attr of Array.from(element.attributes)) {
        if (/token|session|cookie|authorization|password/i.test(attr.name) || /token|session|cookie|authorization|password/i.test(attr.value)) {
          element.setAttribute(attr.name, '[redacted]');
        }
      }
      if (element.childNodes.length === 1 && element.childNodes[0].nodeType === Node.TEXT_NODE) {
        element.textContent = mask(element.textContent || '').slice(0, 200);
      }
    });

    return `<!doctype html><html><head><meta charset="utf-8"><title>Sanitized Download Center Evidence</title></head><body>${clone.innerHTML}</body></html>`;
  });
}

export function persistDownloadCenterDiagnostic(result: DownloadCenterDiagnosticResult): DownloadCenterDiagnosticResult {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) return result;
  const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext) throw new Error('下载中心诊断缺少当前店铺权威。');
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  if (
    result.storeName !== authorized.target.storeName
    || result.marketplaceCode !== authorized.target.marketplaceCode
  ) {
    throw new Error('下载中心诊断结果与当前店铺权威不一致，拒绝持久化。');
  }

  const insert = mainRuntimeContext.state.db.prepare(`
    INSERT INTO download_center_diagnostics
      (store_id, app_version, page_model, page_model_source, page_model_snapshot_json, date_start, date_end, store_name, marketplace_code, url, title, ready, requires_manual_verification, matched_entry_hints_json,
       matched_report_names_json, selector_checks_json, missing_required_selectors_json, selector_candidates_json,
       action_selector_checks_json,
       screenshot_path, dom_snapshot_path, error_message, checked_at)
    VALUES
      (@storeId, @appVersion, @pageModel, @pageModelSource, @pageModelSnapshotJson, @dateStart, @dateEnd, @storeName, @marketplaceCode, @url, @title, @ready, @requiresManualVerification, @matchedEntryHintsJson,
       @matchedReportNamesJson, @selectorChecksJson, @missingRequiredSelectorsJson, @selectorCandidatesJson,
       @actionSelectorChecksJson,
       @screenshotPath, @domSnapshotPath, @errorMessage, @checkedAt)
  `);
  const response = insert.run({
    storeId: authorized.context.storeId,
    appVersion: result.appVersion ?? mainRuntimeContext.APP_VERSION,
    pageModel: result.pageModel,
    pageModelSource: result.pageModelSource ?? null,
    pageModelSnapshotJson: result.pageModelSnapshot ? JSON.stringify(result.pageModelSnapshot) : null,
    dateStart: result.dateStart ?? null,
    dateEnd: result.dateEnd ?? null,
    storeName: result.storeName ?? null,
    marketplaceCode: result.marketplaceCode ?? null,
    url: result.url,
    title: result.title,
    ready: result.ready ? 1 : 0,
    requiresManualVerification: result.requiresManualVerification ? 1 : 0,
    matchedEntryHintsJson: JSON.stringify(result.matchedEntryHints),
    matchedReportNamesJson: JSON.stringify(result.matchedReportNames),
    selectorChecksJson: JSON.stringify(result.selectorChecks),
    missingRequiredSelectorsJson: JSON.stringify(result.missingRequiredSelectors),
    selectorCandidatesJson: JSON.stringify(result.selectorCandidates ?? []),
    actionSelectorChecksJson: JSON.stringify(result.actionSelectorChecks ?? []),
    screenshotPath: result.screenshotPath ?? null,
    domSnapshotPath: result.domSnapshotPath ?? null,
    errorMessage: result.errorMessage ?? null,
    checkedAt: result.checkedAt,
  });

  return {
    ...result,
    id: Number(response.lastInsertRowid),
  };
}
