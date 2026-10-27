import { validateDateRange } from './main-input-contract';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserController, type StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { evaluateDownloadCenterPageModel, LINGXING_AD_REPORTS } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel, LingxingReportType } from '@amazon-ai-ops/shared-types';
import { captureDownloadCenterDiagnosticDomSnapshot, captureDownloadCenterDiagnosticScreenshot, collectDownloadCenterDiagnosticActionSelectorChecks, collectDownloadCenterSelectorCandidates, collectSanitizedDomEvidence, persistDownloadCenterDiagnostic } from './main-download-selectors-runtime';
import { buildGeneratedDownloadCenterReportName, normalizeLingxingCollectionRequest } from './main-download-automation-runtime';
import { authorizedLingxingCollectionTarget } from './main-business-pipeline-runtime';
import { browserControllerFromVisibleRuntime, sameExactStoreContext } from './main-browser-session-runtime';
import { assertVisibleLingxingCollectionSession } from './main-mission-today-runtime';
import { storeCapsuleFor } from './main-store-access-runtime';
import { handleGetDownloadCenterPageModel } from './main-download-page-model-runtime';
import { navigateToLingxingDownloadCenter } from './main-download-navigation-runtime';
import type { DownloadCenterReportSelectorContext, LingxingCollectionTarget } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export async function countVisibleLocatorMatches(
  page: NonNullable<ReturnType<BrowserController['getPage']>>,
  selector: string,
): Promise<number> {
  return page.locator(selector).evaluateAll((elements) => elements.filter((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden'
      && style.display !== 'none'
      && rect.width > 0
      && rect.height > 0;
  }).length);
}

export function redactEvidenceSecrets(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
    .replace(/(authorization\s*:\s*bearer\s+)[^"',\s<>]+/gi, '$1[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'bearer [redacted]')
    .replace(/((?:set-)?cookie\s*:\s*)[^\r\n"'<>]+/gi, '$1[redacted]')
    .replace(/(token|session|authorization|cookie|password)\s*[:=]\s*["']?[^"',\s<>]+/gi, '$1=[redacted]')
    .replace(/(access[_-]?token|refresh[_-]?token|csrf[_-]?token|download[_-]?url|signature|sign)\s*[:=]\s*["']?[^"',\s<>]+/gi, '$1=[redacted]');
}

export function sanitizeEvidenceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return redactEvidenceSecrets(url.toString());
  } catch {
    return redactEvidenceSecrets(value).replace(/[?#].*$/, '');
  }
}

export function sanitizeEvidenceText(value: string): string {
  const redacted = redactEvidenceSecrets(value);
  return redacted.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
    const trailing = rawUrl.match(/[),.;]+$/)?.[0] ?? '';
    const coreUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    return `${sanitizeEvidenceUrl(coreUrl)}${trailing}`;
  });
}

export async function captureReportFailureEvidence(
  controller: BrowserController,
  reportType: LingxingReportType,
  dateRange: { start: string; end: string },
  attemptErrors: string[],
  traceUnavailableReason?: string,
  storeCapsule?: StoreCapsulePaths,
) {
  const mainRuntimeContext = getMainRuntimeContext();
  const page = controller.getPage();
  const evidenceId = `${reportType}_${dateRange.start}_${dateRange.end}_${Date.now()}`;
  let screenshotPath: string | undefined;
  let domSnapshotPath: string | undefined;

  if (page) {
    const screenshotsDir = storeCapsule?.screenshotsDir ?? mainRuntimeContext.SCREENSHOTS_DIR;
    const domSnapshotsDir = storeCapsule?.evidenceDir ?? mainRuntimeContext.DOM_SNAPSHOTS_DIR;
    fs.mkdirSync(screenshotsDir, { recursive: true });
    fs.mkdirSync(domSnapshotsDir, { recursive: true });
    screenshotPath = path.join(screenshotsDir, `report_failure_${evidenceId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    domSnapshotPath = path.join(domSnapshotsDir, `report_failure_${evidenceId}.html`);
    const html = await collectSanitizedDomEvidence(controller);
    const metadata = [
      '<!--',
      `reportType: ${reportType}`,
      `dateStart: ${dateRange.start}`,
      `dateEnd: ${dateRange.end}`,
      `capturedAt: ${new Date().toISOString()}`,
      `url: ${sanitizeEvidenceUrl(page.url())}`,
      `attemptErrors: ${sanitizeEvidenceText(JSON.stringify(attemptErrors))}`,
      '-->',
      '',
    ].join('\n');
    fs.writeFileSync(domSnapshotPath, `${metadata}${html}`, 'utf8');
  }

  return {
    screenshotPath,
    domSnapshotPath,
    traceUnavailableReason,
  };
}

export async function handleDiagnoseLingxingDownloadCenter(input?: unknown): Promise<DownloadCenterDiagnosticResult> {
  const mainRuntimeContext = getMainRuntimeContext();
  const request = input ? normalizeLingxingCollectionRequest(input) : undefined;
  const submittedContext = request?.storeContext ?? mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!submittedContext) throw new Error('请先选择店铺，再验证领星下载中心。');
  const authorized = authorizedLingxingCollectionTarget(submittedContext);
  if (!mainRuntimeContext.state.lingxingCollectionOperations) throw new Error('店铺浏览器互斥协调器尚未就绪。');
  if (!mainRuntimeContext.state.executionAuthorityService) throw new Error('浏览器任务准入屏障尚未就绪。');
  return mainRuntimeContext.state.executionAuthorityService.withAdmittedBrowserOperation(
    'legacy:lingxing-download-center-diagnostic',
    () => mainRuntimeContext.state.lingxingCollectionOperations!.run({
      context: authorized.context,
      owner: `lingxing-diagnostic:${request?.requestId || Date.now()}`,
      ttlMs: 10 * 60 * 1_000,
    }, async (operation) => {
    operation.assertStepCurrent();
    const browserRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
    if (
      !browserRuntime
      || !mainRuntimeContext.state.isLoggedIn
      || browserRuntime.providerIdentityStatus.lingxing !== 'verified'
      || !sameExactStoreContext(browserRuntime.context, authorized.context)
    ) {
      throw new Error('请先启动并登录当前店铺的独立领星 ERP 浏览器');
    }
    assertVisibleLingxingCollectionSession(authorized.context);
    const controller = browserControllerFromVisibleRuntime(browserRuntime, 'lingxing');
    if (!controller) throw new Error('当前领星可见浏览器类型不受 Main 支持。');
    const capsule = storeCapsuleFor(authorized.store);
  const dateRange = request ? { start: request.start, end: request.end } : undefined;
  const target = authorized.target;
  if (dateRange) {
    validateDateRange(dateRange);
  }

  const modelInfo = handleGetDownloadCenterPageModel();
  const model = modelInfo.model;
  const url = model.candidateUrls[0];
  let result: DownloadCenterDiagnosticResult;

  try {
    operation.assertStepCurrent();
    await navigateToLingxingDownloadCenter(controller, model, target.storeName);
    const selectorMatches: Record<string, boolean> = {};
    for (const hint of model.verifySelectors) {
      selectorMatches[hint.selector] = await controller.evaluate<boolean>((selector: string) => {
        return Boolean(document.querySelector(selector));
      }, hint.selector);
    }
    const snapshot = await controller.evaluate<{ url: string; title: string; bodyText: string }>(() => ({
      url: window.location.href,
      title: document.title,
      bodyText: document.body?.innerText ?? '',
    }));
    const selectorCandidates = await collectDownloadCenterSelectorCandidates(controller);
    const diagnosticContext: DownloadCenterReportSelectorContext = {
      ...LINGXING_AD_REPORTS[0],
      generatedReportName: dateRange ? buildGeneratedDownloadCenterReportName(LINGXING_AD_REPORTS[0], dateRange) : undefined,
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
    };
    const actionSelectorChecks = await collectDownloadCenterDiagnosticActionSelectorChecks(
      controller,
      model,
      dateRange,
      diagnosticContext,
    );

    result = evaluateDownloadCenterPageModel(model, {
      ...snapshot,
      selectorMatches,
    });
    result.pageModelSource = modelInfo.source as 'bundled' | 'override';
    result.pageModelSnapshot = model;
    result.dateStart = dateRange?.start;
    result.dateEnd = dateRange?.end;
    result.storeName = target.storeName;
    result.marketplaceCode = target.marketplaceCode;
    result.selectorCandidates = selectorCandidates;
    result.actionSelectorChecks = actionSelectorChecks;
  } catch (error) {
    result = {
      pageModel: model.name,
      pageModelSource: modelInfo.source as 'bundled' | 'override',
      pageModelSnapshot: model,
      dateStart: dateRange?.start,
      dateEnd: dateRange?.end,
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
      url,
      title: '',
      ready: false,
      requiresManualVerification: model.requiresManualVerification,
      matchedEntryHints: [],
      matchedReportNames: [],
      selectorChecks: model.verifySelectors.map((hint) => ({ ...hint, found: false })),
      missingRequiredSelectors: model.verifySelectors.filter((hint) => hint.required).map((hint) => hint.name),
      actionSelectorChecks: [],
      checkedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  result.appVersion = mainRuntimeContext.APP_VERSION;
  try {
    operation.assertStepCurrent();
    result.screenshotPath = await captureDownloadCenterDiagnosticScreenshot(
      controller,
      capsule.screenshotsDir,
    );
  } catch (error) {
    result.errorMessage = appendDiagnosticError(result.errorMessage, `screenshot: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    operation.assertStepCurrent();
    result.domSnapshotPath = await captureDownloadCenterDiagnosticDomSnapshot(
      controller,
      capsule.evidenceDir,
    );
  } catch (error) {
    result.errorMessage = appendDiagnosticError(result.errorMessage, `domSnapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
      operation.assertStepCurrent();
      return persistDownloadCenterDiagnostic(result);
    }),
  );
}

export async function persistCollectionOnlyDownloadCenterDiagnostic(
  controller: BrowserController,
  capsule: StoreCapsulePaths,
  target: LingxingCollectionTarget & { marketplaceCode: string; storeId: string; storeName: string },
  dateRange: { start: string; end: string },
): Promise<DownloadCenterDiagnosticResult> {
  const mainRuntimeContext = getMainRuntimeContext();
  validateDateRange(dateRange);
  const modelInfo = handleGetDownloadCenterPageModel();
  const model = modelInfo.model;
  const fallbackUrl = model.candidateUrls[0];
  let result: DownloadCenterDiagnosticResult;

  try {
    const selectorMatches: Record<string, boolean> = {};
    for (const hint of model.verifySelectors) {
      selectorMatches[hint.selector] = await controller.evaluate<boolean>((selector: string) => (
        Boolean(document.querySelector(selector))
      ), hint.selector);
    }
    const snapshot = await controller.evaluate<{ url: string; title: string; bodyText: string }>(() => ({
      url: window.location.href,
      title: document.title,
      bodyText: document.body?.innerText ?? '',
    }));
    const selectorCandidates = await collectDownloadCenterSelectorCandidates(controller);
    const diagnosticContext: DownloadCenterReportSelectorContext = {
      ...LINGXING_AD_REPORTS[0],
      generatedReportName: buildGeneratedDownloadCenterReportName(LINGXING_AD_REPORTS[0], dateRange),
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
    };
    const actionSelectorChecks = await collectDownloadCenterDiagnosticActionSelectorChecks(
      controller,
      model,
      dateRange,
      diagnosticContext,
    );
    result = evaluateDownloadCenterPageModel(model, { ...snapshot, selectorMatches });
    result.pageModelSource = modelInfo.source as 'bundled' | 'override';
    result.pageModelSnapshot = model;
    result.dateStart = dateRange.start;
    result.dateEnd = dateRange.end;
    result.storeName = target.storeName;
    result.marketplaceCode = target.marketplaceCode;
    result.selectorCandidates = selectorCandidates;
    result.actionSelectorChecks = actionSelectorChecks;
  } catch (error) {
    result = {
      pageModel: model.name,
      pageModelSource: modelInfo.source as 'bundled' | 'override',
      pageModelSnapshot: model,
      dateStart: dateRange.start,
      dateEnd: dateRange.end,
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
      url: fallbackUrl,
      title: '',
      ready: false,
      requiresManualVerification: model.requiresManualVerification,
      matchedEntryHints: [],
      matchedReportNames: [],
      selectorChecks: model.verifySelectors.map((hint) => ({ ...hint, found: false })),
      missingRequiredSelectors: model.verifySelectors.filter((hint) => hint.required).map((hint) => hint.name),
      actionSelectorChecks: [],
      checkedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  result.appVersion = mainRuntimeContext.APP_VERSION;
  try {
    result.screenshotPath = await captureDownloadCenterDiagnosticScreenshot(controller, capsule.screenshotsDir);
  } catch (error) {
    result.errorMessage = appendDiagnosticError(
      result.errorMessage,
      `screenshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    result.domSnapshotPath = await captureDownloadCenterDiagnosticDomSnapshot(controller, capsule.evidenceDir);
  } catch (error) {
    result.errorMessage = appendDiagnosticError(
      result.errorMessage,
      `domSnapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return persistDownloadCenterDiagnostic(result);
}

export function appendDiagnosticError(existing: string | undefined, next: string): string {
  return existing ? `${existing}; ${next}` : next;
}

export function withTrustedDownloadCenterReportSearchSelector(
  model: DownloadCenterPageModel,
): DownloadCenterPageModel {
  const mainRuntimeContext = getMainRuntimeContext();
  const actionSelectors = model.actionSelectors;
  if (!actionSelectors) return model;
  const configured = actionSelectors.reportSearchInput?.trim();
  const trusted = mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportSearchInput;
  const reportSearchInput = configured && !trusted.split(', ').includes(configured)
    ? `${configured}, ${trusted}`
    : trusted;
  if (actionSelectors.reportSearchInput === reportSearchInput) return model;
  return {
    ...model,
    actionSelectors: {
      ...actionSelectors,
      reportSearchInput,
    },
  };
}
