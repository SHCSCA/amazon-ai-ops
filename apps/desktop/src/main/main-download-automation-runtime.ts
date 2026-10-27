import * as path from 'path';
import * as fs from 'fs';
import { BrowserController, type StoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { saveLingxingReportDownload } from './lingxing-download-save';
import { evaluateDownloadCenterDiagnosticEvidenceReadiness, getDownloadCenterAutomationReadiness, pollReportGenerationStatus, type DownloadCenterAutomationPort } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterActionSelectorCheck, DownloadCenterActionSelectors, DownloadCenterPageModel, LingxingCreatedReportIdentity, LingxingReportType } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { evaluateDownloadCenterDiagnosticEvidenceFiles } from './download-center-diagnostic-evidence-files';
import { fillAndCommitLingxingDateRange } from './download-center-date-range';
import { readDownloadCenterPageModel } from './main-download-page-model-runtime';
import { assertLingxingCreateStoreSelected, captureLingxingCreateSubmissionResponses, clickUniqueVisibleLingxingCreateConfirmation, navigateToLingxingDownloadCenter, readLingxingCreateSubmissionFeedback, refreshDownloadCenterReportList, reportContextKey, summarizeLingxingCreateSubmissionResponses, waitForCreateReportPage, waitForCreatedReportRowByExactSearch } from './main-download-navigation-runtime';
import { captureReportFailureEvidence, countVisibleLocatorMatches } from './main-download-diagnostics-runtime';
import { authorizedLingxingCollectionTarget } from './main-business-pipeline-runtime';
import { storeCapsuleFor } from './main-store-access-runtime';
import { evaluateActionSelectorUsability } from './main-download-selectors-runtime';
import type { DownloadCenterReportSelectorContext, LingxingCollectionRequest, LingxingCollectionTarget } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export function createDownloadCenterAutomation(
  controller: BrowserController,
  target: LingxingCollectionTarget & { marketplaceCode: string; storeId: string; storeName: string },
  options: {
    allowManualVerificationForCanary?: boolean;
    storeCapsule?: StoreCapsulePaths;
  } = {},
): DownloadCenterAutomationPort {
  const mainRuntimeContext = getMainRuntimeContext();
  const model = readDownloadCenterPageModel();
  const automationReadiness = getDownloadCenterAutomationReadiness(
    options.allowManualVerificationForCanary
      ? { ...model, requiresManualVerification: false }
      : model,
  );
  const generatedReportNames = new Map<string, string>();
  let traceStarted = false;
  let traceStartError: string | undefined;

  const reportContext = (
    report: { type: LingxingReportType; displayName: string; expectedFilenameKeyword: string },
    dateRange: { start: string; end: string },
    createdReportIdentity?: LingxingCreatedReportIdentity,
  ): DownloadCenterReportSelectorContext => {
    const key = reportContextKey(report, dateRange);
    if (!generatedReportNames.has(key)) {
      generatedReportNames.set(key, buildGeneratedDownloadCenterReportName(report, dateRange));
    }
    return {
      ...report,
      generatedReportName: createdReportIdentity?.externalReportName ?? generatedReportNames.get(key),
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
    };
  };
  const existingReportContext = (
    report: { type: LingxingReportType; displayName: string; expectedFilenameKeyword: string },
    dateRange: { start: string; end: string },
    createdReportIdentity?: LingxingCreatedReportIdentity,
  ): DownloadCenterReportSelectorContext => ({
    ...reportContext(report, dateRange, createdReportIdentity),
    
    
    
    
    generatedReportName: createdReportIdentity?.externalReportName ?? report.displayName,
  });

  return {
    async navigateToDownloadCenter() {
      await navigateToLingxingDownloadCenter(controller, model, target.storeName);
    },
    async createReport(report, dateRange) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName, target);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      const context = reportContext(report, dateRange);
      if (!context.storeName) {
        throw new Error('启动领星报表采集前必须选择店铺，例如 FT-US-US');
      }

      const createReportButton = await assertUsableDownloadCenterActionSelector(
        page,
        'createReportButton',
        selectors.createReportButton || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.createReportButton,
        context,
        dateRange,
      );
      await page.locator(createReportButton).click();
      await waitForCreateReportPage(page);

      const storeSearchInput = selectors.storeSearchInput || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeSearchInput;
      const storeOptionSelector = selectors.storeOption || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeOption;
      const storeMoveButtonSelector = selectors.storeMoveButton || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeMoveButton;
      const renderedStoreSearchInput = renderDownloadCenterSelector(storeSearchInput, context, dateRange);
      const renderedStoreOption = renderDownloadCenterSelector(storeOptionSelector, context, dateRange);
      const renderedStoreMoveButton = renderDownloadCenterSelector(storeMoveButtonSelector, context, dateRange);
      await page.locator(renderedStoreSearchInput).fill(context.storeName);
      await page.locator(renderedStoreOption).click();
      await page.locator(renderedStoreMoveButton).click();
      try {
        await assertLingxingCreateStoreSelected(page, context.storeName, context.marketplaceCode);
      } catch (error) {
        return {
          status: 'not_created',
          retryable: true,
          blockerCode: 'LINGXING_CREATE_STORE_NOT_SELECTED',
          detail: error instanceof Error ? error.message : String(error),
        };
      }

      const reportSearchInput = await assertUsableDownloadCenterActionSelector(
        page,
        'reportSearchInput',
        selectors.reportSearchInput || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportSearchInput,
        context,
        dateRange,
      );
      await page.locator(reportSearchInput).fill(context.generatedReportName || report.displayName);

      const reportTypeSelect = renderDownloadCenterSelector(
        selectors.reportTypeSelect || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeSelect,
        context,
        dateRange,
      );
      await page.locator(reportTypeSelect).click();
      const reportTypeOption = renderDownloadCenterSelector(
        selectors.reportTypeOption || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeOption,
        context,
        dateRange,
      );
      await page.locator(reportTypeOption).click();
      const selectedReportType = (await page.locator(reportTypeSelect).inputValue()).trim();
      if (selectedReportType !== report.displayName) {
        throw new Error(`领星报表类型未锁定为“${report.displayName}”；当前回读“${selectedReportType || '空'}”，未提交创建。`);
      }
      const enteredReportName = (await page.locator(reportSearchInput).inputValue()).trim();
      const expectedReportName = context.generatedReportName || report.displayName;
      if (enteredReportName !== expectedReportName) {
        throw new Error(`领星报表名称回读不一致；预期“${expectedReportName}”，当前“${enteredReportName || '空'}”，未提交创建。`);
      }

      const dateStartInput = await assertUsableDownloadCenterActionSelector(
        page,
        'dateStartInput',
        selectors.dateStartInput || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dateStartInput,
        context,
        dateRange,
      );
      const dateEndInput = await assertUsableDownloadCenterActionSelector(
        page,
        'dateEndInput',
        selectors.dateEndInput || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dateEndInput,
        context,
        dateRange,
      );
      await fillAndCommitLingxingDateRange(page, {
        startInputSelector: dateStartInput,
        endInputSelector: dateEndInput,
        dateRange,
      });

      const dailyDetailRadio = renderDownloadCenterSelector(
        selectors.dailyDetailRadio || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dailyDetailRadio,
        context,
        dateRange,
      );
      const dailyVisible = await page.locator(dailyDetailRadio).isVisible({ timeout: 5000 }).catch(() => false);
      if (dailyVisible) {
        await page.locator(dailyDetailRadio).click();
      }

      const confirmCreateButton = renderDownloadCenterSelector(
        selectors.confirmCreateButton || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.confirmCreateButton,
        context,
        dateRange,
      );
      await page.locator(confirmCreateButton).waitFor({ state: 'visible', timeout: 15000 });
      await assertUsableDownloadCenterActionSelector(page, 'confirmCreateButton', confirmCreateButton, context, dateRange);
      const submission = await captureLingxingCreateSubmissionResponses(page, async () => {
        await page.locator(confirmCreateButton).click();
        await page.getByText('正在创建报告', { exact: false }).waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
        const clicked = await clickUniqueVisibleLingxingCreateConfirmation(page);
        if (clicked) await page.waitForTimeout(500);
        return clicked;
      });
      const confirmationClicked = submission.value;
      const responseSummary = summarizeLingxingCreateSubmissionResponses(submission.responses);
      const submissionFeedback = await readLingxingCreateSubmissionFeedback(page, confirmationClicked);
      if (submissionFeedback.visibleMessages.length > 0) {
        throw new Error(`领星创建表单未提交：${submissionFeedback.visibleMessages.join('；')}；提交确认：${confirmationClicked ? '已点击唯一可见确认按钮' : '未出现可见确认按钮'}；提交响应：${responseSummary}`);
      }
      await navigateToLingxingDownloadCenter(controller, model, target.storeName);
      try {
        await waitForCreatedReportRowByExactSearch(page, selectors, context, dateRange);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}；提交确认：${submissionFeedback.confirmationClicked ? '已点击唯一可见确认按钮' : '未出现可见确认按钮'}；提交响应：${responseSummary}`);
      }
      return {
        status: 'created',
        identity: {
          provider: 'lingxing',
          reportType: report.type,
          externalReportName: context.generatedReportName || report.displayName,
          dateStart: dateRange.start,
          dateEnd: dateRange.end,
          createdAt: new Date().toISOString(),
        },
      };
    },
    async waitForReportReady(report, dateRange, createdReportIdentity) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName, target);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      const existingReport = !createdReportIdentity;
      const context = existingReport ? existingReportContext(report, dateRange, createdReportIdentity) : reportContext(report, dateRange, createdReportIdentity);
      let lastRecoveryAt = 0;
      const recoverListIfNeeded = async (attempt: number) => {
        const now = Date.now();
        if (attempt > 1 && now - lastRecoveryAt < mainRuntimeContext.DOWNLOAD_CENTER_LIST_RECOVERY_INTERVAL_MS) {
          return;
        }
        lastRecoveryAt = now;
        await refreshDownloadCenterReportList(page, selectors);
      };
      await recoverListIfNeeded(0);

      if (selectors.statusTextSelector) {
        await pollReportGenerationStatus(async () => {
          const statusTextSelector = renderDownloadCenterSelector(selectors.statusTextSelector!, context, dateRange);
          const statusLocator = page.locator(statusTextSelector).first();
          if (!await statusLocator.isVisible({ timeout: 2000 }).catch(() => false)) {
            return '';
          }
          return statusLocator.innerText();
        }, {
          intervalMs: 2000,
          timeoutMs: selectors.readyTimeoutMs ?? 300000,
          onPendingSnapshot: async (snapshot) => {
            if (snapshot.status === 'unknown' || snapshot.attempt % 3 === 0) {
              await recoverListIfNeeded(snapshot.attempt);
            }
          },
        });
      } else {
        const readyReportSelector = renderDownloadCenterSelector(selectors.readyReportSelector, context, dateRange);
        await pollReportGenerationStatus(async () => {
          const readyRow = page.locator(readyReportSelector).first();
          return await readyRow.isVisible({ timeout: 2000 }).catch(() => false)
            ? '生成成功，可下载'
            : '生成中';
        }, {
          intervalMs: 2000,
          timeoutMs: selectors.readyTimeoutMs ?? 300000,
          onPendingSnapshot: async (snapshot) => {
            if (snapshot.attempt % 3 === 0) {
              await recoverListIfNeeded(snapshot.attempt);
            }
          },
        });
      }
      await assertUsableDownloadCenterActionSelector(page, 'readyReportSelector', selectors.readyReportSelector, context, dateRange);
    },
    async downloadReport(report, downloadDir, dateRange, createdReportIdentity) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName, target);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      fs.mkdirSync(downloadDir, { recursive: true });
      const existingReport = !createdReportIdentity;
      const context = existingReport
        ? existingReportContext(report, dateRange, createdReportIdentity)
        : reportContext(report, dateRange, createdReportIdentity);
      const downloadButton = await assertUsableDownloadCenterActionSelector(page, 'downloadButton', selectors.downloadButton, context, dateRange);

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: selectors.downloadTimeoutMs ?? 120000 }),
        page.locator(downloadButton).click(),
      ]);
      if (!options.storeCapsule) {
        throw new Error('当前领星采集缺少店铺独立下载舱，拒绝保存报表。');
      }
      return saveLingxingReportDownload({
        download,
        request: page.request,
        storeCapsule: options.storeCapsule,
        downloadDir,
        fallbackTimeoutMs: selectors.downloadTimeoutMs ?? 120000,
      });
    },
    async startAttemptTrace(report, dateRange, attemptIndex) {
      traceStartError = undefined;
      traceStarted = false;
      const context = controller.getContext();
      if (!context) {
        traceStartError = 'Playwright browser context is not available';
        return;
      }
      try {
        await context.tracing.start({
          screenshots: true,
          snapshots: true,
          sources: true,
          title: `${report.type}_${dateRange.start}_${dateRange.end}_attempt_${attemptIndex}`,
        });
        traceStarted = true;
      } catch (error) {
        traceStartError = error instanceof Error ? error.message : String(error);
      }
    },
    async stopAttemptTrace(report, dateRange, attemptIndex, retain) {
      const context = controller.getContext();
      if (!context || !traceStarted) {
        return undefined;
      }
      try {
        if (!retain) {
          await context.tracing.stop();
          traceStarted = false;
          return undefined;
        }

        const tracePath = buildReportFailureTracePath(
          report.type,
          dateRange,
          attemptIndex,
          options.storeCapsule?.tracesDir,
        );
        await context.tracing.stop({ path: tracePath });
        traceStarted = false;
        return tracePath;
      } catch (error) {
        traceStartError = error instanceof Error ? error.message : String(error);
        traceStarted = false;
        return undefined;
      }
    },
    async captureFailureEvidence(report, dateRange, attemptErrors) {
      return captureReportFailureEvidence(
        controller,
        report.type,
        dateRange,
        attemptErrors,
        traceStartError,
        options.storeCapsule,
      );
    },
  };
}

export function buildReportFailureTracePath(
  reportType: LingxingReportType,
  dateRange: { start: string; end: string },
  attemptIndex: number,
  traceDirectory = getMainRuntimeContext().TRACES_DIR,
): string {
  const mainRuntimeContext = getMainRuntimeContext();
  fs.mkdirSync(traceDirectory, { recursive: true });
  return path.join(
    traceDirectory,
    `report_failure_${reportType}_${dateRange.start}_${dateRange.end}_attempt_${attemptIndex}_${Date.now()}.zip`,
  );
}

export function assertDownloadCenterAutomationReady(
  readiness: ReturnType<typeof getDownloadCenterAutomationReadiness>,
  displayName: string,
): void {
  if (readiness.ready) return;
  if (readiness.reason?.includes('action selectors')) {
    throw new Error(`下载中心页面模型动作选择器不完整，无法安全创建或下载：${displayName}。缺失：${readiness.missing.join(', ')}`);
  }
  throw new Error(`下载中心页面模型尚未人工固化，无法安全创建或下载：${displayName}`);
}

export function assertDownloadCenterDiagnosticEvidenceReady(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  displayName: string,
  target: LingxingCollectionTarget & { marketplaceCode: string; storeId: string; storeName: string },
): void {
  const evidence = getDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, target);
  if (evidence.ready) return;
  throw new Error(
    `下载中心页面模型缺少同模型、同日期范围、同店铺/站点的近期诊断证据，无法创建或下载：${displayName}。请先运行“验证页面”。${evidence.reason || ''}${evidence.missing.length ? ` 缺失：${evidence.missing.join(', ')}` : ''}`,
  );
}

export function getDownloadCenterDiagnosticEvidenceReadiness(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  target: LingxingCollectionTarget & { marketplaceCode: string; storeId: string; storeName: string },
): { ready: boolean; missing: string[]; reason?: string; diagnosticId?: number; checkedAt?: string } {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.db) {
    return { ready: false, missing: ['download_center_diagnostics'], reason: 'local database is not available' };
  }
  const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext) {
    return { ready: false, missing: ['activeStoreContext'], reason: 'active store context is not available' };
  }
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  if (
    target.storeName !== authorized.target.storeName
    || target.marketplaceCode !== authorized.target.marketplaceCode
  ) {
    return { ready: false, missing: ['storeAuthority'], reason: 'diagnostic target does not match the active store authority' };
  }
  const capsule = storeCapsuleFor(authorized.store);
  const modelSnapshotJson = JSON.stringify(model);
  const row = mainRuntimeContext.state.db.prepare(`
    SELECT
      id,
      ready,
      page_model AS pageModel,
      page_model_snapshot_json AS pageModelSnapshotJson,
      date_start AS dateStart,
      date_end AS dateEnd,
      store_name AS storeName,
      marketplace_code AS marketplaceCode,
      action_selector_checks_json AS actionSelectorChecksJson,
      screenshot_path AS screenshotPath,
      dom_snapshot_path AS domSnapshotPath,
      checked_at AS checkedAt
    FROM download_center_diagnostics
    WHERE store_id = @storeId
      AND page_model = @pageModel
      AND page_model_snapshot_json = @modelSnapshotJson
      AND date_start = @dateStart
      AND date_end = @dateEnd
      AND COALESCE(store_name, '') = COALESCE(@storeName, '')
      AND COALESCE(marketplace_code, '') = COALESCE(@marketplaceCode, '')
    ORDER BY checked_at DESC, id DESC
    LIMIT 1
  `).get({
    storeId: target.storeId,
    pageModel: model.name,
    modelSnapshotJson,
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    storeName: target.storeName ?? '',
    marketplaceCode: target.marketplaceCode ?? '',
  }) as { id: number; ready: number; pageModel?: string; pageModelSnapshotJson?: string; dateStart?: string; dateEnd?: string; storeName?: string; marketplaceCode?: string; actionSelectorChecksJson?: string; screenshotPath?: string; domSnapshotPath?: string; checkedAt?: string } | undefined;

  if (!row) {
    return {
      ready: false,
      missing: ['diagnosticEvidence'],
      reason: 'no matching download-center diagnostic exists for this page model, date range, store, and marketplace',
    };
  }

  const diagnosticReadiness = evaluateDownloadCenterDiagnosticEvidenceReadiness(
    model,
    dateRange,
    {
      id: row.id,
      pageModel: row.pageModel || model.name,
      pageModelSnapshot: parseDownloadCenterPageModelSnapshot(row.pageModelSnapshotJson),
      dateStart: row.dateStart ?? undefined,
      dateEnd: row.dateEnd ?? undefined,
      storeName: row.storeName ?? undefined,
      marketplaceCode: row.marketplaceCode ?? undefined,
      url: '',
      title: '',
      ready: Boolean(row.ready),
      requiresManualVerification: model.requiresManualVerification,
      matchedEntryHints: [],
      matchedReportNames: [],
      selectorChecks: [],
      missingRequiredSelectors: [],
      actionSelectorChecks: parseDiagnosticActionSelectorChecks(row.actionSelectorChecksJson),
      checkedAt: row.checkedAt || '',
    },
    { target },
  );
  const fileReadiness = evaluateDownloadCenterDiagnosticEvidenceFiles(row, {
    screenshotsDir: capsule.screenshotsDir,
    domSnapshotsDir: capsule.evidenceDir,
  });
  const missing = Array.from(new Set([...diagnosticReadiness.missing, ...fileReadiness.missing]));
  return {
    ...diagnosticReadiness,
    ready: diagnosticReadiness.ready && fileReadiness.ready,
    missing,
    reason: diagnosticReadiness.ready ? fileReadiness.reason : diagnosticReadiness.reason,
  };
}

export function parseDownloadCenterPageModelSnapshot(jsonText: string | undefined): DownloadCenterPageModel | undefined {
  if (!jsonText) return undefined;
  try {
    return JSON.parse(jsonText) as DownloadCenterPageModel;
  } catch {
    return undefined;
  }
}

export function parseDiagnosticActionSelectorChecks(jsonText: string | undefined): DownloadCenterActionSelectorCheck[] {
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed as DownloadCenterActionSelectorCheck[] : [];
  } catch {
    return [];
  }
}

export function getControllerPageOrThrow(controller: BrowserController) {
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面尚未初始化');
  }
  return page;
}

export function normalizeLingxingCollectionRequest(input: unknown): LingxingCollectionRequest {
  const value = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const start = typeof value.start === 'string' ? value.start : '';
  const end = typeof value.end === 'string' ? value.end : '';
  return {
    start,
    end,
    requestId: optionalTrimmedString(value.requestId),
    storeContext: value.storeContext && typeof value.storeContext === 'object'
      ? value.storeContext as StoreContextEnvelope
      : undefined,
    storeName: optionalTrimmedString(value.storeName),
    marketplaceCode: optionalTrimmedString(value.marketplaceCode ?? value.site),
  };
}

export function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function safeReportNameSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'report';
}

export function buildGeneratedDownloadCenterReportName(
  report: { expectedFilenameKeyword: string },
  dateRange: { start: string; end: string },
): string {
  const start = dateRange.start.replaceAll('-', '');
  const end = dateRange.end.replaceAll('-', '');
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(8, 14);
  const reportToken = safeReportNameSegment(report.expectedFilenameKeyword).slice(0, 24);
  return `AAO_${start}_${end}_${reportToken}_${suffix}`;
}

export function renderDownloadCenterSelector(
  selector: string,
  report: DownloadCenterReportSelectorContext,
  dateRange?: { start: string; end: string },
): string {
  return selector
    .replaceAll('{reportType}', report.type)
    .replaceAll('{reportName}', report.displayName)
    .replaceAll('{expectedFilenameKeyword}', report.expectedFilenameKeyword)
    .replaceAll('{generatedReportName}', report.generatedReportName ?? report.displayName)
    .replaceAll('{storeName}', report.storeName ?? '')
    .replaceAll('{marketplaceCode}', report.marketplaceCode ?? '')
    .replaceAll('{dateStart}', dateRange?.start ?? '')
    .replaceAll('{dateEnd}', dateRange?.end ?? '')
    .replaceAll('{dateRange}', dateRange ? `${dateRange.start}_${dateRange.end}` : '');
}

export async function assertUsableDownloadCenterActionSelector(
  page: ReturnType<BrowserController['getPage']>,
  name: keyof DownloadCenterActionSelectors,
  selector: string,
  report: DownloadCenterReportSelectorContext | undefined,
  dateRange?: { start: string; end: string },
): Promise<string> {
  if (!page) {
    throw new Error('领星浏览器页面尚未初始化');
  }
  const renderedSelector = report
    ? renderDownloadCenterSelector(selector, report, dateRange)
    : selector
      .replaceAll('{dateStart}', dateRange?.start ?? '')
      .replaceAll('{dateEnd}', dateRange?.end ?? '')
      .replaceAll('{dateRange}', dateRange ? `${dateRange.start}_${dateRange.end}` : '');
  let matchCount = 0;
  try {
    matchCount = await countVisibleLocatorMatches(page, renderedSelector);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`动作选择器 ${String(name)} 无法解析：${message}`);
  }
  const usability = evaluateActionSelectorUsability(String(name), selector, matchCount);
  if (!usability.usable) {
    throw new Error(
      `动作选择器 ${String(name)} 不可安全执行：${usability.errorMessage || `命中数 ${matchCount}`}。selector=${renderedSelector}`,
    );
  }
  return renderedSelector;
}
