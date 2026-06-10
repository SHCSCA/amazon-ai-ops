import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import { LocalScheduler } from '@amazon-ai-ops/scheduler';
import { AuditLogger, ScreenshotManager, TraceManager, CleanupManager } from '@amazon-ai-ops/audit-log';
import { RecommendationGenerator, DEFAULT_RULE_CONFIG } from '@amazon-ai-ops/rules-engine';
import { ReportParser, keywordMetricDiagnosticsToCsv, parseKeywordMetricsWithDiagnostics, parseListingContent } from '@amazon-ai-ops/report-parser';
import { AdActionReasonExplainer, OpenAICompatibleProvider, DailyReportGenerator } from '@amazon-ai-ops/ai-adapter';
import { initSqlite, getSqliteDb } from '@amazon-ai-ops/local-db/src/sqlite/db';
import { ActionLogRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/action-log-repo';
import { AdMetricsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/ad-metrics-repo';
import { ProductRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/product-repo';
import { RecommendationRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/recommendation-repo';
import { SettingsRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/settings-repo';
import { assertDownloadCenterCollectionPreflightReady, auditDownloadCenterPageModelEnablement, auditLingxingAcceptanceEvidence, buildDownloadCenterCollectionPreflight, buildDownloadCenterPageModelDraft, downloadCenterPageModelDraftToMarkdown, evaluateDownloadCenterCanaryEvidenceReadiness, evaluateDownloadCenterDiagnosticEvidenceReadiness, evaluateDownloadCenterPageModel, getDownloadCenterAutomationReadiness, LINGXING_AD_REPORTS, lingxingAcceptanceAuditToMarkdown, pollReportGenerationStatus, runLingxingReportBatch, type DownloadCenterAutomationPort } from '@amazon-ai-ops/lingxing-report-collector';
import { buildKeywordOpportunities } from '@amazon-ai-ops/keyword-opportunity';
import { analyzeKeywordCoverage, buildListingSuggestions as buildSafeListingSuggestions, buildRuleBasedListingDrafts, draftsToCsv, draftsToMarkdown, draftsToXlsxBuffer, suggestionsToCsv, suggestionsToMarkdown, suggestionsToXlsxBuffer } from '@amazon-ai-ops/listing-analyzer';
import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { TaskName } from '@amazon-ai-ops/scheduler';
import type { ActionRecommendation, AdDailyMetrics, DownloadCenterActionSelectorCheck, DownloadCenterActionSelectors, DownloadCenterDiagnosticResult, DownloadCenterPageModel, DownloadCenterSelectorCandidate, KeywordMetric, KeywordOpportunity, LingxingReportBatch, LingxingReportFile, LingxingReportType, ListingContent, ListingDraft, ListingSuggestion } from '@amazon-ai-ops/shared-types';
import { buildDownloadedReportEvidenceIndex, isPathInsideDirectory, isPathWithinRealDirectory, isSafeManifestPath, readLingxingManifestForAudit, safeFileSegment } from './acceptance-audit-export';
import { writeLingxingCollectionPreflightEvidenceBundle } from './collection-preflight-export';
import { copyDiagnosticEvidenceFileToBundle, copyReportFailureEvidenceFilesToBundle, evaluateDownloadCenterDiagnosticEvidenceFiles } from './download-center-diagnostic-evidence-files';
import { getLatestDownloadCenterDiagnosticRowForModel } from './download-center-diagnostic-store';
import { writeDownloadCenterPageModelEnablementAuditBundle } from './page-model-enablement-audit-export';
import { selectorUsesDateScope, selectorUsesReportScope, validateDownloadCenterPageModel } from './download-center-page-model-validation';
import { backupExistingDownloadCenterPageModelOverride, getDownloadCenterPageModelOverrideMetadataPath, saveDownloadCenterPageModelOverride } from './download-center-page-model-override-store';
import { getLingxingSessionNavigationPlan, isLingxingAdsLoggedInPage } from './lingxing-session-flow';
import { buildAdExecutionUnavailableResult, buildActionLogForExecution, getRecommendationExecutionOutcome } from './recommendation-execution-policy';
import { extractLingxingListingFromSnapshot, type ListingDomFieldSnapshot, type ListingExtractionResult, type ListingPageSnapshot } from './listing-lingxing-extractor';
import { adReadbackEvidenceToMarkdown, buildAdReadbackEvidence, type AdReadbackEvidenceInput } from './ad-readback-evidence';

// ============================================================================
// App State
// ============================================================================

interface AppState {
  browserController: BrowserController | null;
  scheduler: LocalScheduler | null;
  db: import('better-sqlite3').Database | null;
  settingsRepo: SettingsRepository | null;
  productRepo: ProductRepository | null;
  actionLogRepo: ActionLogRepository | null;
  adMetricsRepo: AdMetricsRepository | null;
  recommendationRepo: RecommendationRepository | null;
  ruleConfig: RuleConfig;
  isLoggedIn: boolean;
  currentStore: string;
}

const state: AppState = {
  browserController: null,
  scheduler: null,
  db: null,
  settingsRepo: null,
  productRepo: null,
  actionLogRepo: null,
  adMetricsRepo: null,
  recommendationRepo: null,
  ruleConfig: DEFAULT_RULE_CONFIG,
  isLoggedIn: false,
  currentStore: '',
};

// ============================================================================
// Paths
// ============================================================================

const USER_DATA_DIR = app.getPath('userData');
const STORAGE_DIR = path.join(USER_DATA_DIR, 'storage');
const SCREENSHOTS_DIR = path.join(STORAGE_DIR, 'screenshots');
const DOM_SNAPSHOTS_DIR = path.join(STORAGE_DIR, 'dom-snapshots');
const TRACES_DIR = path.join(STORAGE_DIR, 'traces');
const REPORTS_DIR = path.join(STORAGE_DIR, 'reports');
const DOWNLOADS_DIR = path.join(STORAGE_DIR, 'downloads');
const EXPORTS_DIR = path.join(STORAGE_DIR, 'exports');
const PAGE_MODELS_DIR = path.join(STORAGE_DIR, 'page-models');
const DOWNLOAD_CENTER_PAGE_MODEL_FILENAME = 'lingxing-download-center.json';
const DOWNLOAD_CENTER_PAGE_MODEL_OVERRIDE_FILENAME = 'lingxing-download-center.override.json';
const DB_PATH = path.join(USER_DATA_DIR, 'amazon-ai-ops.db');
const APP_VERSION = '1.5.0';
const LINGXING_REPORT_TYPE_SET = new Set<string>(LINGXING_AD_REPORTS.map((report) => report.type));
type KeywordImportDuplicateStrategy = 'overwrite' | 'merge' | 'skip';

function getBundledResourcesPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.resolve(app.getAppPath(), '../../resources');
}

function ensureDirs(): void {
  for (const dir of [STORAGE_DIR, SCREENSHOTS_DIR, DOM_SNAPSHOTS_DIR, TRACES_DIR, REPORTS_DIR, DOWNLOADS_DIR, EXPORTS_DIR, PAGE_MODELS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function canonicalizeExistingPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

// ============================================================================
// Window
// ============================================================================

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Amazon AI Ops Agent',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ============================================================================
// Initialization
// ============================================================================

async function initApp(): Promise<void> {
  console.log('[App] init:start');
  ensureDirs();
  console.log('[App] init:dirs-ready');

  // Init database
  state.db = initSqlite(DB_PATH);
  console.log('[App] init:sqlite-ready');

  // Init repositories
  state.settingsRepo = new SettingsRepository(state.db);
  state.productRepo = new ProductRepository(state.db);
  state.actionLogRepo = new ActionLogRepository(state.db);
  state.adMetricsRepo = new AdMetricsRepository(state.db);
  state.recommendationRepo = new RecommendationRepository(state.db);
  console.log('[App] init:repositories-ready');

  // Init audit/trace/screenshot managers
  const auditLogger = new AuditLogger(state.db);
  const screenshotMgr = new ScreenshotManager(SCREENSHOTS_DIR);
  const traceMgr = new TraceManager(TRACES_DIR);
  const cleanupMgr = new CleanupManager(STORAGE_DIR);

  // Load saved config
  const savedConfig = state.settingsRepo.getRuleConfig();
  if (savedConfig) {
    state.ruleConfig = savedConfig as unknown as RuleConfig;
  }

  // Init scheduler
  state.scheduler = new LocalScheduler({
    timezone: 'Asia/Shanghai',
    onTaskStart: (taskName: TaskName) => {
      mainWindow?.webContents.send('scheduler:task-start', taskName);
    },
    onTaskComplete: (taskName: TaskName, duration: number) => {
      mainWindow?.webContents.send('scheduler:task-complete', { taskName, duration });
    },
    onTaskError: (taskName: TaskName, error: Error) => {
      mainWindow?.webContents.send('scheduler:task-error', { taskName, error: error.message });
    },
  });

  // Register scheduled tasks
  state.scheduler.register({
    name: 'daily_recommendation_generate',
    cron: '0 9 * * *',
    enabled: false,
    callback: async () => {
      await runRecommendationGeneration();
    },
  });

  state.scheduler.register({
    name: 'daily_report_generate',
    cron: '0 21 * * *',
    enabled: false,
    callback: () => runDailyReportGeneration(),
  });

  state.scheduler.register({
    name: 'data_cleanup',
    cron: '0 3 * * *',
    enabled: true,
    callback: async () => {
      const report = await cleanupMgr.cleanup();
      mainWindow?.webContents.send('cleanup:report', report);
    },
  });

  // Start scheduler
  state.scheduler.start();

  console.log('[App] Initialized successfully');
}

// ============================================================================
// Browser / Session
// ============================================================================

type BrowserLoginResult = {
  ok: true;
  erpSessionReused: boolean;
  adsEntryMode: 'erp_ads_entry';
  adsUrl: string;
  adsTitle: string;
};

type AdsSessionResult = {
  entryMode: 'erp_ads_entry';
  adsUrl: string;
  adsTitle: string;
};

async function readLingxingPageState(page: NonNullable<ReturnType<BrowserController['getPage']>>) {
  return page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText ?? '',
    hasAccountInput: Boolean(document.querySelector('input[name="account"]')),
  }));
}

function adsSessionResultFromPageState(pageState: { url: string; title?: string }): AdsSessionResult {
  return {
    entryMode: 'erp_ads_entry',
    adsUrl: pageState.url,
    adsTitle: pageState.title || pageState.url,
  };
}

async function handleBrowserLogin(username: string, password: string): Promise<BrowserLoginResult> {
  if (state.browserController) {
    await state.browserController.close().catch(() => undefined);
    state.browserController = null;
    state.isLoggedIn = false;
  }

  const navigationPlan = getLingxingSessionNavigationPlan();
  const controller = new BrowserController({
    headless: false,
    userDataDir: path.join(STORAGE_DIR, 'browser-data'),
  });

  state.browserController = controller;

  try {
    await controller.launch();
    await controller.navigate(navigationPlan.initialUrl);
    await controller.waitForTimeout(3000);

    const page = getControllerPageOrThrow(controller);
    const accountInput = page.locator('input[name="account"], input[placeholder*="用户名"], input[placeholder*="手机号"]').first();
    const passwordInput = page.locator('input[name="pwd"], input[type="password"]').first();
    const needsLogin = await accountInput.isVisible({ timeout: 5000 }).catch(() => false);
    const erpSessionReused = !needsLogin;

    if (needsLogin) {
      await accountInput.fill(username);
      await passwordInput.fill(password);
      await Promise.all([
        page.waitForURL(/\/erp\/home|\/erp\/index|dashboard|home|index/, { timeout: 30000 }).catch(() => undefined),
        page.locator('button.loginBtn, button:has-text("登录")').first().click(),
      ]);
      await controller.waitForTimeout(3000);
    }

    const erpLoginState = await page.evaluate(() => ({
      url: window.location.href,
      bodyText: document.body?.innerText ?? '',
      hasAccountInput: Boolean(document.querySelector('input[name="account"]')),
    }));
    if (erpLoginState.hasAccountInput && erpLoginState.bodyText.includes('账号登录')) {
      throw new Error('领星 ERP 登录未完成：仍停留在账号登录页，请检查账号、密码或验证码要求');
    }

    const adsSession = await ensureLingxingAdsSession(controller);

    state.isLoggedIn = true;
    state.currentStore = username;

    // Store only the username; password stays with the user's manual ERP session.
    state.settingsRepo?.saveCredentials({ username });

    return {
      ok: true,
      erpSessionReused,
      adsEntryMode: adsSession.entryMode,
      adsUrl: adsSession.adsUrl,
      adsTitle: adsSession.adsTitle,
    };
  } catch (error) {
    await controller.close().catch(() => undefined);
    if (state.browserController === controller) {
      state.browserController = null;
    }
    state.isLoggedIn = false;
    state.currentStore = '';
    throw error;
  }
}

async function ensureLingxingAdsSession(controller: BrowserController): Promise<AdsSessionResult> {
  const navigationPlan = getLingxingSessionNavigationPlan();
  const page = getControllerPageOrThrow(controller);
  const currentState = await readLingxingPageState(page).catch(() => null);
  if (currentState && isLingxingAdsLoggedInPage(currentState)) {
    return adsSessionResultFromPageState(currentState);
  }

  await page.goto(navigationPlan.erpHomeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await controller.waitForTimeout(4000);

  const erpState = await readLingxingPageState(page);
  if (erpState.hasAccountInput || erpState.bodyText.includes('账号登录')) {
    throw new Error('领星 ERP 登录未完成：请先完成账号登录，再进入广告系统');
  }

  const context = controller.getContext();
  const pagesBefore = new Set(context?.pages() ?? []);
  const popupPromise = context?.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  const adTextEntry = page.getByText('广告', { exact: true }).first();
  const hasAdTextEntry = await adTextEntry.isVisible({ timeout: 15000 }).catch(() => false);

  if (hasAdTextEntry) {
    await adTextEntry.click({ timeout: 15000 });
  } else {
    const adLinkEntry = page.locator('a[href*="ads.lingxing.com"], a[href*="/ak_"], [onclick*="ads.lingxing"]').first();
    const hasAdLinkEntry = await adLinkEntry.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasAdLinkEntry) {
      throw new Error('领星 ERP 已登录，但未找到“广告”入口。请在打开的 ERP 页面手动进入广告系统后重试。');
    }
    await adLinkEntry.click({ timeout: 15000 });
  }

  const popup = await popupPromise;
  const adsPage = popup
    || context?.pages().find((candidate) => !pagesBefore.has(candidate) && candidate.url().includes('ads.lingxing.com'))
    || context?.pages().find((candidate) => candidate.url().includes('ads.lingxing.com'))
    || page;
  if (adsPage !== page) {
    controller.setActivePage(adsPage);
  }

  await adsPage.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => undefined);
  await adsPage.waitForTimeout(6000);
  const adsState = await readLingxingPageState(adsPage);

  if (!isLingxingAdsLoggedInPage(adsState)) {
    throw new Error(
      `领星 ERP 已登录，但广告系统会话未就绪。请在打开的 ERP 浏览器中通过“广告”入口完成授权后重试。当前页面：${adsState.title || adsState.url}`,
    );
  }

  return adsSessionResultFromPageState(adsState);
}

async function handleBrowserLogout(): Promise<void> {
  if (state.browserController) {
    await state.browserController.close();
    state.browserController = null;
  }
  state.isLoggedIn = false;
  state.currentStore = '';
}

async function handleScreenshot(label: 'before' | 'after' | 'error'): Promise<string> {
  if (!state.browserController) {
    throw new Error('Browser not initialized');
  }

  const screenshotPath = path.join(SCREENSHOTS_DIR, `${label}_${Date.now()}.png`);
  await state.browserController.screenshot(screenshotPath);
  return screenshotPath;
}

async function tryCaptureExecutionScreenshot(label: 'before' | 'after'): Promise<string | undefined> {
  try {
    return await handleScreenshot(label);
  } catch (error) {
    console.warn(`[AdExecution] ${label} screenshot unavailable; writing fail-closed audit without screenshot`, error);
    return undefined;
  }
}

// ============================================================================
// Report Download & Parse
// ============================================================================

async function handleDownloadReport(dateRange: { start: string; end: string }): Promise<string> {
  throw new Error(
    `旧版单报表下载入口已停用，避免访问过期的领星页面和未验证 selector。请在左侧“广告报表”中使用“采集预检”/“验证页面”/“启动采集”流程。日期范围：${dateRange.start} - ${dateRange.end}`,
  );
}

async function handleParseReport(filePath: string): Promise<number> {
  const parser = new ReportParser();
  const result = parser.autoParse(filePath);

  if (!result.success) {
    throw new Error(`Parse failed: ${result.validation.errors.slice(0, 3).map(e => e.message).join('; ')}`);
  }

  // Save to database
  for (const metrics of result.data) {
    state.adMetricsRepo?.insert({
      ...metrics,
      id: 0, // auto
    });
  }

  return result.totalRows;
}

// ============================================================================
// v1.5 Report Collector / Keyword / Listing
// ============================================================================

function persistLingxingBatch(result: Awaited<ReturnType<typeof runLingxingReportBatch>>): void {
  if (!state.db) return;

  const save = state.db.transaction(() => {
    state.db!.prepare(`
      INSERT OR REPLACE INTO lingxing_report_batches
        (id, app_version, date_start, date_end, store_name, marketplace_code, status, download_dir, manifest_path, created_at, completed_at)
      VALUES
        (@id, @appVersion, @dateStart, @dateEnd, @storeName, @marketplaceCode, @status, @downloadDir, @manifestPath, @createdAt, @completedAt)
    `).run({
      ...result.batch,
      appVersion: result.batch.appVersion ?? APP_VERSION,
      storeName: result.batch.storeName ?? null,
      marketplaceCode: result.batch.marketplaceCode ?? null,
      manifestPath: result.batch.manifestPath ?? null,
      completedAt: result.batch.completedAt ?? null,
    });

    const insertFile = state.db!.prepare(`
      INSERT OR REPLACE INTO lingxing_report_files
        (id, batch_id, report_type, display_name, status, max_auto_retries, auto_retry_count,
         file_path, file_size_bytes, error_message, attempt_errors_json, failure_screenshot_path,
         failure_dom_snapshot_path, failure_trace_path, trace_unavailable_reason, created_at, updated_at)
      VALUES
        (@id, @batchId, @reportType, @displayName, @status, @maxAutoRetries, @autoRetryCount,
         @filePath, @fileSizeBytes, @errorMessage, @attemptErrorsJson, @failureScreenshotPath,
         @failureDomSnapshotPath, @failureTracePath, @traceUnavailableReason, @createdAt, @updatedAt)
    `);

    for (const file of result.files) {
      insertFile.run({
        ...file,
        filePath: file.filePath ?? null,
        fileSizeBytes: file.fileSizeBytes ?? 0,
        errorMessage: file.errorMessage ?? null,
        maxAutoRetries: file.maxAutoRetries ?? 2,
        autoRetryCount: file.autoRetryCount ?? 0,
        attemptErrorsJson: JSON.stringify(file.attemptErrors ?? []),
        failureScreenshotPath: file.failureScreenshotPath ?? null,
        failureDomSnapshotPath: file.failureDomSnapshotPath ?? null,
        failureTracePath: file.failureTracePath ?? null,
        traceUnavailableReason: file.traceUnavailableReason ?? null,
      });
    }
  });
  save();
}

function metricProductContextKey(metric: { date?: string; campaignName?: string; adGroupName?: string }, includeDate: boolean): string {
  return [
    includeDate ? metric.date || '' : '*',
    (metric.campaignName || '').trim().toLowerCase(),
    (metric.adGroupName || '').trim().toLowerCase(),
  ].join('|');
}

function uniqueProductContext(
  map: Map<string, Map<string, { asin: string; msku: string }>>,
  key: string,
): { asin: string; msku: string } | undefined {
  const values = map.get(key);
  if (!values || values.size !== 1) return undefined;
  return Array.from(values.values())[0];
}

function attachUniqueProductContext(metrics: AdDailyMetrics[]): AdDailyMetrics[] {
  const productByKey = new Map<string, Map<string, { asin: string; msku: string }>>();
  const addContext = (key: string, metric: AdDailyMetrics) => {
    if (!metric.asin) return;
    const bucket = productByKey.get(key) ?? new Map<string, { asin: string; msku: string }>();
    bucket.set(metric.asin.toUpperCase(), { asin: metric.asin, msku: metric.msku || '' });
    productByKey.set(key, bucket);
  };

  for (const metric of metrics) {
    addContext(metricProductContextKey(metric, true), metric);
    addContext(metricProductContextKey(metric, false), metric);
  }

  return metrics.map((metric) => {
    if (metric.asin) return metric;
    const exact = uniqueProductContext(productByKey, metricProductContextKey(metric, true));
    const fallback = exact ?? uniqueProductContext(productByKey, metricProductContextKey(metric, false));
    return fallback
      ? { ...metric, asin: fallback.asin, msku: metric.msku || fallback.msku }
      : metric;
  });
}

function importLingxingDownloadedReportMetrics(result: Awaited<ReturnType<typeof runLingxingReportBatch>>): {
  inserted: number;
  parsedFiles: number;
  skippedFiles: number;
  deletedExisting: number;
  errors: Array<{ reportType: string; filePath?: string; message: string }>;
} {
  if (!state.adMetricsRepo) {
    return { inserted: 0, parsedFiles: 0, skippedFiles: result.files.length, deletedExisting: 0, errors: [] };
  }

  const parser = new ReportParser();
  const errors: Array<{ reportType: string; filePath?: string; message: string }> = [];
  const parsedMetrics: AdDailyMetrics[] = [];
  let parsedFiles = 0;
  let skippedFiles = 0;

  for (const file of result.files) {
    if (file.status !== 'downloaded' || !file.filePath) {
      skippedFiles++;
      continue;
    }
    try {
      const parsed = parser.autoParse(file.filePath);
      parsedMetrics.push(...parsed.data.map((metric) => ({
        ...metric,
        batchId: result.batch.id,
        reportType: file.reportType,
        storeName: result.batch.storeName || metric.storeName,
        marketplaceCode: result.batch.marketplaceCode || metric.marketplaceCode,
        sourceFile: file.filePath || metric.sourceFile,
      })));
      parsedFiles++;
    } catch (error) {
      errors.push({
        reportType: file.reportType,
        filePath: file.filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const readyMetrics = attachUniqueProductContext(parsedMetrics);
  const deletedExisting = state.adMetricsRepo.deleteByBatch(result.batch.id);
  const inserted = readyMetrics.length ? state.adMetricsRepo.insertBatch(readyMetrics) : 0;
  return { inserted, parsedFiles, skippedFiles, deletedExisting, errors };
}

function loadLatestCompletedLingxingBatchForScope(scope: {
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
}): Awaited<ReturnType<typeof runLingxingReportBatch>> | undefined {
  if (!state.db || !scope.dateFrom || !scope.dateTo || !scope.storeName || !scope.marketplaceCode) return undefined;
  const batch = state.db.prepare(`
    SELECT *
    FROM lingxing_report_batches
    WHERE status = 'completed'
      AND date_start = @dateFrom
      AND date_end = @dateTo
      AND store_name = @storeName
      AND marketplace_code = @marketplaceCode
    ORDER BY completed_at DESC, created_at DESC
    LIMIT 1
  `).get(scope) as any;
  if (!batch) return undefined;

  const rows = state.db.prepare(`
    SELECT *
    FROM lingxing_report_files
    WHERE batch_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(batch.id) as any[];

  return {
    batch: {
      id: batch.id,
      appVersion: batch.app_version,
      dateStart: batch.date_start,
      dateEnd: batch.date_end,
      storeName: batch.store_name,
      marketplaceCode: batch.marketplace_code,
      status: batch.status,
      downloadDir: batch.download_dir,
      manifestPath: batch.manifest_path,
      createdAt: batch.created_at,
      completedAt: batch.completed_at,
    },
    files: rows.map((row) => ({
      id: row.id,
      batchId: row.batch_id,
      reportType: row.report_type,
      displayName: row.display_name,
      status: row.status,
      maxAutoRetries: row.max_auto_retries,
      autoRetryCount: row.auto_retry_count,
      filePath: row.file_path,
      fileSizeBytes: row.file_size_bytes,
      errorMessage: row.error_message,
      attemptErrors: row.attempt_errors_json ? JSON.parse(row.attempt_errors_json) : [],
      failureScreenshotPath: row.failure_screenshot_path,
      failureDomSnapshotPath: row.failure_dom_snapshot_path,
      failureTracePath: row.failure_trace_path,
      traceUnavailableReason: row.trace_unavailable_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
}

function backfillAdMetricsFromLatestBatchIfNeeded(scope: {
  dateFrom?: string;
  dateTo?: string;
  storeName?: string;
  marketplaceCode?: string;
}) {
  const existing = state.adMetricsRepo?.findForRecommendations({ ...scope, limit: 1 }) ?? [];
  if (existing.length > 0) return undefined;
  const latestBatch = loadLatestCompletedLingxingBatchForScope(scope);
  return latestBatch ? importLingxingDownloadedReportMetrics(latestBatch) : undefined;
}

async function handleCollectLingxingReports(input: unknown) {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const target = { storeName: request.storeName, marketplaceCode: request.marketplaceCode };
  validateDateRange(dateRange);
  assertLingxingCollectionPreflightReady(dateRange, target);

  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先启动并登录领星 ERP 浏览器');
  }

  const result = await runLingxingReportBatch({
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    storeName: target.storeName,
    marketplaceCode: target.marketplaceCode,
    rootDownloadDir: DOWNLOADS_DIR,
    appVersion: APP_VERSION,
    automation: createDownloadCenterAutomation(state.browserController, target),
  });
  persistLingxingBatch(result);
  return result;
}

function handlePreflightLingxingCollection(input: unknown) {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  validateDateRange(dateRange);
  const model = readDownloadCenterPageModel();
  const diagnosticEvidenceReadiness = getDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, {
    storeName: request.storeName,
    marketplaceCode: request.marketplaceCode,
  });
  const browserSessionReady = Boolean(state.browserController && state.isLoggedIn);
  return buildDownloadCenterCollectionPreflight(model, dateRange, undefined, {
    target: {
      storeName: request.storeName,
      marketplaceCode: request.marketplaceCode,
    },
    diagnosticEvidenceReadiness,
    browserSessionReady,
    browserSessionReason: browserSessionReady ? undefined : '请先启动并登录领星 ERP 浏览器',
  });
}

function assertLingxingCollectionPreflightReady(dateRange: { start: string; end: string }, target: LingxingCollectionTarget = {}): void {
  const preflight = handlePreflightLingxingCollection({ ...dateRange, ...target });
  assertDownloadCenterCollectionPreflightReady(preflight);
}

function handleExportLingxingCollectionPreflight(input: unknown): string {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const preflight = handlePreflightLingxingCollection(request);
  const model = readDownloadCenterPageModel();
  const diagnostic = preflight.diagnosticEvidenceReadiness.diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(preflight.diagnosticEvidenceReadiness.diagnosticId, dateRange.start, dateRange.end)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(model, dateRange.start, dateRange.end, {
      storeName: request.storeName,
      marketplaceCode: request.marketplaceCode,
    });
  const exportDir = path.join(
    EXPORTS_DIR,
    `lingxing_collection_preflight_${safeFileSegment(dateRange.start)}_${safeFileSegment(dateRange.end)}_${Date.now()}`,
  );
  writeLingxingCollectionPreflightEvidenceBundle({
    exportDir,
    preflight,
    model,
    diagnostic,
    directories: {
      screenshotsDir: SCREENSHOTS_DIR,
      domSnapshotsDir: DOM_SNAPSHOTS_DIR,
    },
  });
  return exportDir;
}

async function handleRetryLingxingReport(input: unknown, reportType: LingxingReportType) {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const target = { storeName: request.storeName, marketplaceCode: request.marketplaceCode };
  validateDateRange(dateRange);
  validateLingxingReportType(reportType);
  assertLingxingCollectionPreflightReady(dateRange, target);

  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先启动并登录领星 ERP 浏览器');
  }

  const result = await runLingxingReportBatch({
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    storeName: target.storeName,
    marketplaceCode: target.marketplaceCode,
    rootDownloadDir: DOWNLOADS_DIR,
    appVersion: APP_VERSION,
    reportTypes: [reportType],
    automation: createDownloadCenterAutomation(state.browserController, target),
  });
  persistLingxingBatch(result);
  const metricsImport = importLingxingDownloadedReportMetrics(result);
  return { ...result, metricsImport };
}

async function handleRunLingxingCanaryReport(input: unknown, reportType: LingxingReportType) {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const target = { storeName: request.storeName, marketplaceCode: request.marketplaceCode };
  validateDateRange(dateRange);
  validateLingxingReportType(reportType);

  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先启动并登录领星 ERP 浏览器');
  }

  const model = readDownloadCenterPageModel();
  const report = LINGXING_AD_REPORTS.find((item) => item.type === reportType);
  const displayName = report?.displayName || reportType;
  const automationReadiness = getDownloadCenterAutomationReadiness({
    ...model,
    requiresManualVerification: false,
  });
  assertDownloadCenterAutomationReady(automationReadiness, displayName);
  assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, displayName, target);

  const result = await runLingxingReportBatch({
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    storeName: target.storeName,
    marketplaceCode: target.marketplaceCode,
    rootDownloadDir: DOWNLOADS_DIR,
    appVersion: APP_VERSION,
    reportTypes: [reportType],
    maxRetries: 0,
    automation: createDownloadCenterAutomation(state.browserController, target, {
      allowManualVerificationForCanary: true,
    }),
  });
  persistLingxingBatch(result);
  return result;
}

const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS = {
  createReportButton: 'a:has-text("创建报告")',
  storeSearchInput: '.el-transfer-panel:has-text("待选店铺") input[placeholder="店铺搜索"]',
  storeOption: '.el-transfer-panel:has-text("待选店铺") label.el-transfer-panel__item:has-text("{storeName}")',
  storeMoveButton: '.el-transfer__buttons button:has(.el-icon-arrow-right)',
  reportSearchInput: 'input[placeholder="报告名称"].el-input__inner',
  reportTypeSelect: '.report-item .el-select input.el-input__inner',
  reportTypeOption: '.el-select-dropdown:visible .el-select-dropdown__item:has-text("{reportName}")',
  dateStartInput: 'input[placeholder="开始日期"].el-range-input',
  dateEndInput: 'input[placeholder="结束日期"].el-range-input',
  dailyDetailRadio: 'label.el-radio:has-text("每日明细")',
  confirmCreateButton: 'button:has-text("生成报告")',
} as const;

function reportContextKey(report: { type: LingxingReportType }, dateRange: { start: string; end: string }): string {
  return `${report.type}:${dateRange.start}:${dateRange.end}`;
}

async function waitForDownloadCenterListPage(page: NonNullable<ReturnType<BrowserController['getPage']>>): Promise<boolean> {
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText ?? '',
  }));
  return state.url.includes('/ak_download/download_center/download_report_log/index')
    && state.bodyText.includes('下载中心')
    && state.bodyText.includes('创建报告');
}

async function navigateToLingxingDownloadCenter(controller: BrowserController, model: DownloadCenterPageModel): Promise<void> {
  await ensureLingxingAdsSession(controller);
  const page = getControllerPageOrThrow(controller);

  await page.goto(model.candidateUrls[0], { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => undefined);
  if (await waitForDownloadCenterListPage(page)) return;

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
    if (await waitForDownloadCenterListPage(page)) return;
  }

  await page.evaluate(() => {
    window.location.href = '/ak_download/download_center/download_report_log/index';
  });
  await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => undefined);
  if (await waitForDownloadCenterListPage(page)) return;
  throw new Error(`无法进入领星广告下载中心，当前页面：${await page.title().catch(() => page.url())}`);
}

async function waitForCreateReportPage(page: NonNullable<ReturnType<BrowserController['getPage']>>): Promise<void> {
  await page.waitForURL(/\/ak_download\/download_center\/download_report_log\/create_report/, { timeout: 45000 }).catch(() => undefined);
  const container = page.locator('.create-report-container').first();
  if (await container.isVisible({ timeout: 5000 }).catch(() => false)) return;
  await page.getByText('创建报告', { exact: false }).first().waitFor({ state: 'visible', timeout: 30000 });
}

function createDownloadCenterAutomation(
  controller: BrowserController,
  target: LingxingCollectionTarget = {},
  options: { allowManualVerificationForCanary?: boolean } = {},
): DownloadCenterAutomationPort {
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
  ): DownloadCenterReportSelectorContext => {
    const key = reportContextKey(report, dateRange);
    if (!generatedReportNames.has(key)) {
      generatedReportNames.set(key, buildGeneratedDownloadCenterReportName(report, dateRange));
    }
    return {
      ...report,
      generatedReportName: generatedReportNames.get(key),
      storeName: target.storeName,
      marketplaceCode: target.marketplaceCode,
    };
  };

  return {
    async navigateToDownloadCenter() {
      await navigateToLingxingDownloadCenter(controller, model);
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
        selectors.createReportButton || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.createReportButton,
        context,
        dateRange,
      );
      await page.locator(createReportButton).click();
      await waitForCreateReportPage(page);

      const storeSearchInput = selectors.storeSearchInput || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeSearchInput;
      const storeOptionSelector = selectors.storeOption || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeOption;
      const storeMoveButtonSelector = selectors.storeMoveButton || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.storeMoveButton;
      const renderedStoreSearchInput = renderDownloadCenterSelector(storeSearchInput, context, dateRange);
      const renderedStoreOption = renderDownloadCenterSelector(storeOptionSelector, context, dateRange);
      const renderedStoreMoveButton = renderDownloadCenterSelector(storeMoveButtonSelector, context, dateRange);
      await page.locator(renderedStoreSearchInput).fill(context.storeName);
      await page.locator(renderedStoreOption).click();
      await page.locator(renderedStoreMoveButton).click();

      const reportSearchInput = await assertUsableDownloadCenterActionSelector(
        page,
        'reportSearchInput',
        selectors.reportSearchInput || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportSearchInput,
        context,
        dateRange,
      );
      await page.locator(reportSearchInput).fill(context.generatedReportName || report.displayName);

      const reportTypeSelect = renderDownloadCenterSelector(
        selectors.reportTypeSelect || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeSelect,
        context,
        dateRange,
      );
      await page.locator(reportTypeSelect).click();
      const reportTypeOption = renderDownloadCenterSelector(
        selectors.reportTypeOption || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeOption,
        context,
        dateRange,
      );
      await page.locator(reportTypeOption).click();

      const dateStartInput = await assertUsableDownloadCenterActionSelector(
        page,
        'dateStartInput',
        selectors.dateStartInput || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dateStartInput,
        context,
        dateRange,
      );
      await page.locator(dateStartInput).fill(dateRange.start);
      const dateEndInput = await assertUsableDownloadCenterActionSelector(
        page,
        'dateEndInput',
        selectors.dateEndInput || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dateEndInput,
        context,
        dateRange,
      );
      await page.locator(dateEndInput).fill(dateRange.end);

      const dailyDetailRadio = renderDownloadCenterSelector(
        selectors.dailyDetailRadio || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.dailyDetailRadio,
        context,
        dateRange,
      );
      const dailyVisible = await page.locator(dailyDetailRadio).isVisible({ timeout: 5000 }).catch(() => false);
      if (dailyVisible) {
        await page.locator(dailyDetailRadio).click();
      }

      const confirmCreateButton = renderDownloadCenterSelector(
        selectors.confirmCreateButton || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.confirmCreateButton,
        context,
        dateRange,
      );
      await page.locator(confirmCreateButton).waitFor({ state: 'visible', timeout: 15000 });
      await assertUsableDownloadCenterActionSelector(page, 'confirmCreateButton', confirmCreateButton, context, dateRange);
      await page.locator(confirmCreateButton).click();
      await page.getByText('正在创建报告', { exact: false }).waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
      const okButton = page.locator('.layui-layer-btn0, button:has-text("确定"), a:has-text("确定")').first();
      if (await okButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await okButton.click();
      }
      await navigateToLingxingDownloadCenter(controller, model);
    },
    async waitForReportReady(report, dateRange) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName, target);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      const context = reportContext(report, dateRange);
      if (selectors.statusTextSelector) {
        await pollReportGenerationStatus(async () => {
          const statusTextSelector = await assertUsableDownloadCenterActionSelector(page, 'statusTextSelector', selectors.statusTextSelector!, context, dateRange);
          await page.locator(statusTextSelector).waitFor({ state: 'visible', timeout: 10000 });
          return page.locator(statusTextSelector).innerText();
        }, {
          intervalMs: 2000,
          timeoutMs: selectors.readyTimeoutMs ?? 300000,
        });
      } else {
        const readyReportSelector = renderDownloadCenterSelector(selectors.readyReportSelector, context, dateRange);
        await page
          .locator(readyReportSelector)
          .waitFor({ state: 'visible', timeout: selectors.readyTimeoutMs ?? 300000 });
      }
      await assertUsableDownloadCenterActionSelector(page, 'readyReportSelector', selectors.readyReportSelector, context, dateRange);
    },
    async downloadReport(report, downloadDir, dateRange) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName, target);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      fs.mkdirSync(downloadDir, { recursive: true });
      const context = reportContext(report, dateRange);
      const downloadButton = await assertUsableDownloadCenterActionSelector(page, 'downloadButton', selectors.downloadButton, context, dateRange);

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: selectors.downloadTimeoutMs ?? 120000 }),
        page.locator(downloadButton).click(),
      ]);
      const filePath = path.join(downloadDir, download.suggestedFilename());
      await download.saveAs(filePath);
      return filePath;
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

        const tracePath = buildReportFailureTracePath(report.type, dateRange, attemptIndex);
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
      return captureReportFailureEvidence(controller, report.type, dateRange, attemptErrors, traceStartError);
    },
  };
}

function buildReportFailureTracePath(
  reportType: LingxingReportType,
  dateRange: { start: string; end: string },
  attemptIndex: number,
): string {
  fs.mkdirSync(TRACES_DIR, { recursive: true });
  return path.join(
    TRACES_DIR,
    `report_failure_${reportType}_${dateRange.start}_${dateRange.end}_attempt_${attemptIndex}_${Date.now()}.zip`,
  );
}

function assertDownloadCenterAutomationReady(
  readiness: ReturnType<typeof getDownloadCenterAutomationReadiness>,
  displayName: string,
): void {
  if (readiness.ready) return;
  if (readiness.reason?.includes('action selectors')) {
    throw new Error(`下载中心页面模型动作选择器不完整，无法安全创建或下载：${displayName}。缺失：${readiness.missing.join(', ')}`);
  }
  throw new Error(`下载中心页面模型尚未人工固化，无法安全创建或下载：${displayName}`);
}

function assertDownloadCenterDiagnosticEvidenceReady(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  displayName: string,
  target: LingxingCollectionTarget = {},
): void {
  const evidence = getDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, target);
  if (evidence.ready) return;
  throw new Error(
    `下载中心页面模型缺少同模型、同日期范围、同店铺/站点的近期诊断证据，无法创建或下载：${displayName}。请先运行“验证页面”。${evidence.reason || ''}${evidence.missing.length ? ` 缺失：${evidence.missing.join(', ')}` : ''}`,
  );
}

function getDownloadCenterDiagnosticEvidenceReadiness(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  target: LingxingCollectionTarget = {},
): { ready: boolean; missing: string[]; reason?: string; diagnosticId?: number; checkedAt?: string } {
  if (!state.db) {
    return { ready: false, missing: ['download_center_diagnostics'], reason: 'local database is not available' };
  }
  const modelSnapshotJson = JSON.stringify(model);
  const row = state.db.prepare(`
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
    WHERE page_model = @pageModel
      AND page_model_snapshot_json = @modelSnapshotJson
      AND date_start = @dateStart
      AND date_end = @dateEnd
      AND COALESCE(store_name, '') = COALESCE(@storeName, '')
      AND COALESCE(marketplace_code, '') = COALESCE(@marketplaceCode, '')
    ORDER BY checked_at DESC, id DESC
    LIMIT 1
  `).get({
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
    screenshotsDir: SCREENSHOTS_DIR,
    domSnapshotsDir: DOM_SNAPSHOTS_DIR,
  });
  const missing = Array.from(new Set([...diagnosticReadiness.missing, ...fileReadiness.missing]));
  return {
    ...diagnosticReadiness,
    ready: diagnosticReadiness.ready && fileReadiness.ready,
    missing,
    reason: diagnosticReadiness.ready ? fileReadiness.reason : diagnosticReadiness.reason,
  };
}

function parseDownloadCenterPageModelSnapshot(jsonText: string | undefined): DownloadCenterPageModel | undefined {
  if (!jsonText) return undefined;
  try {
    return JSON.parse(jsonText) as DownloadCenterPageModel;
  } catch {
    return undefined;
  }
}

function parseDiagnosticActionSelectorChecks(jsonText: string | undefined): DownloadCenterActionSelectorCheck[] {
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed) ? parsed as DownloadCenterActionSelectorCheck[] : [];
  } catch {
    return [];
  }
}

function getControllerPageOrThrow(controller: BrowserController) {
  const page = controller.getPage();
  if (!page) {
    throw new Error('领星浏览器页面尚未初始化');
  }
  return page;
}

interface LingxingCollectionTarget {
  storeName?: string;
  marketplaceCode?: string;
}

interface LingxingCollectionRequest extends LingxingCollectionTarget {
  start: string;
  end: string;
}

interface DownloadCenterReportSelectorContext {
  type: LingxingReportType;
  displayName: string;
  expectedFilenameKeyword: string;
  generatedReportName?: string;
  storeName?: string;
  marketplaceCode?: string;
}

function normalizeLingxingCollectionRequest(input: unknown): LingxingCollectionRequest {
  const value = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  const start = typeof value.start === 'string' ? value.start : '';
  const end = typeof value.end === 'string' ? value.end : '';
  return {
    start,
    end,
    storeName: optionalTrimmedString(value.storeName),
    marketplaceCode: optionalTrimmedString(value.marketplaceCode ?? value.site),
  };
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function safeReportNameSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'report';
}

function buildGeneratedDownloadCenterReportName(
  report: { expectedFilenameKeyword: string },
  dateRange: { start: string; end: string },
): string {
  const start = dateRange.start.replaceAll('-', '');
  const end = dateRange.end.replaceAll('-', '');
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(8, 14);
  const reportToken = safeReportNameSegment(report.expectedFilenameKeyword).slice(0, 24);
  return `AAO_${start}_${end}_${reportToken}_${suffix}`;
}

function renderDownloadCenterSelector(
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

async function assertUsableDownloadCenterActionSelector(
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

async function countVisibleLocatorMatches(
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

function redactEvidenceSecrets(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b1[3-9]\d{9}\b/g, '[phone]')
    .replace(/(authorization\s*:\s*bearer\s+)[^"',\s<>]+/gi, '$1[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'bearer [redacted]')
    .replace(/((?:set-)?cookie\s*:\s*)[^\r\n"'<>]+/gi, '$1[redacted]')
    .replace(/(token|session|authorization|cookie|password)\s*[:=]\s*["']?[^"',\s<>]+/gi, '$1=[redacted]')
    .replace(/(access[_-]?token|refresh[_-]?token|csrf[_-]?token|download[_-]?url|signature|sign)\s*[:=]\s*["']?[^"',\s<>]+/gi, '$1=[redacted]');
}

function sanitizeEvidenceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return redactEvidenceSecrets(url.toString());
  } catch {
    return redactEvidenceSecrets(value).replace(/[?#].*$/, '');
  }
}

function sanitizeEvidenceText(value: string): string {
  const redacted = redactEvidenceSecrets(value);
  return redacted.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
    const trailing = rawUrl.match(/[),.;]+$/)?.[0] ?? '';
    const coreUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
    return `${sanitizeEvidenceUrl(coreUrl)}${trailing}`;
  });
}

async function captureReportFailureEvidence(
  controller: BrowserController,
  reportType: LingxingReportType,
  dateRange: { start: string; end: string },
  attemptErrors: string[],
  traceUnavailableReason?: string,
) {
  const page = controller.getPage();
  const evidenceId = `${reportType}_${dateRange.start}_${dateRange.end}_${Date.now()}`;
  let screenshotPath: string | undefined;
  let domSnapshotPath: string | undefined;

  if (page) {
    screenshotPath = path.join(SCREENSHOTS_DIR, `report_failure_${evidenceId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    domSnapshotPath = path.join(DOM_SNAPSHOTS_DIR, `report_failure_${evidenceId}.html`);
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

async function handleDiagnoseLingxingDownloadCenter(input?: unknown): Promise<DownloadCenterDiagnosticResult> {
  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先启动并登录领星 ERP 浏览器');
  }
  const request = input ? normalizeLingxingCollectionRequest(input) : undefined;
  const dateRange = request ? { start: request.start, end: request.end } : undefined;
  const target = request ? { storeName: request.storeName, marketplaceCode: request.marketplaceCode } : {};
  if (dateRange) {
    validateDateRange(dateRange);
  }

  const modelInfo = handleGetDownloadCenterPageModel();
  const model = modelInfo.model;
  const controller = state.browserController;
  const url = model.candidateUrls[0];
  let result: DownloadCenterDiagnosticResult;

  try {
    await navigateToLingxingDownloadCenter(controller, model);
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

  result.appVersion = APP_VERSION;
  try {
    result.screenshotPath = await captureDownloadCenterDiagnosticScreenshot(controller);
  } catch (error) {
    result.errorMessage = appendDiagnosticError(result.errorMessage, `screenshot: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    result.domSnapshotPath = await captureDownloadCenterDiagnosticDomSnapshot(controller);
  } catch (error) {
    result.errorMessage = appendDiagnosticError(result.errorMessage, `domSnapshot: ${error instanceof Error ? error.message : String(error)}`);
  }
  return persistDownloadCenterDiagnostic(result);
}

function appendDiagnosticError(existing: string | undefined, next: string): string {
  return existing ? `${existing}; ${next}` : next;
}

function readDownloadCenterPageModel(): DownloadCenterPageModel {
  const overridePath = getDownloadCenterPageModelOverridePath();
  if (fs.existsSync(overridePath)) {
    try {
      return readAndValidateDownloadCenterPageModel(overridePath);
    } catch {
      return readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath());
    }
  }
  return readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath());
}

function getBundledDownloadCenterPageModelPath(): string {
  return path.join(getBundledResourcesPath(), 'page-models', DOWNLOAD_CENTER_PAGE_MODEL_FILENAME);
}

function getDownloadCenterPageModelOverridePath(): string {
  return path.join(PAGE_MODELS_DIR, DOWNLOAD_CENTER_PAGE_MODEL_OVERRIDE_FILENAME);
}

function readAndValidateDownloadCenterPageModel(modelPath: string): DownloadCenterPageModel {
  const parsed = JSON.parse(fs.readFileSync(modelPath, 'utf8')) as unknown;
  validateDownloadCenterPageModel(parsed);
  return parsed;
}

function handleGetDownloadCenterPageModel() {
  const overridePath = getDownloadCenterPageModelOverridePath();
  const source = fs.existsSync(overridePath) ? 'override' : 'bundled';
  const pathInUse = source === 'override' ? overridePath : getBundledDownloadCenterPageModelPath();
  let model: DownloadCenterPageModel;
  let overrideError: string | undefined;

  if (source === 'override') {
    try {
      model = readAndValidateDownloadCenterPageModel(overridePath);
    } catch (error) {
      overrideError = error instanceof Error ? error.message : String(error);
      model = readAndValidateDownloadCenterPageModel(getBundledDownloadCenterPageModelPath());
    }
  } else {
    model = readAndValidateDownloadCenterPageModel(pathInUse);
  }

  return {
    model,
    source: overrideError ? 'bundled' : source,
    path: overrideError ? getBundledDownloadCenterPageModelPath() : pathInUse,
    overridePath,
    overrideMetadataPath: getDownloadCenterPageModelOverrideMetadataPath(overridePath),
    overrideError,
    readiness: getDownloadCenterAutomationReadiness(model),
  };
}

function handleSaveDownloadCenterPageModel(model: DownloadCenterPageModel) {
  validateDownloadCenterPageModel(model);
  const overridePath = getDownloadCenterPageModelOverridePath();
  const readiness = getDownloadCenterAutomationReadiness(model);
  const metadata = saveDownloadCenterPageModelOverride({
    model,
    overridePath,
    appVersion: APP_VERSION,
    readiness,
  });
  return {
    ...handleGetDownloadCenterPageModel(),
    overrideSaveMetadata: metadata,
  };
}

function handleResetDownloadCenterPageModel() {
  const overridePath = getDownloadCenterPageModelOverridePath();
  const backupPath = backupExistingDownloadCenterPageModelOverride(overridePath);
  if (fs.existsSync(overridePath)) {
    fs.unlinkSync(overridePath);
  }
  const metadataPath = getDownloadCenterPageModelOverrideMetadataPath(overridePath);
  if (fs.existsSync(metadataPath)) {
    fs.unlinkSync(metadataPath);
  }
  return {
    ...handleGetDownloadCenterPageModel(),
    resetBackupPath: backupPath,
  };
}

async function captureDownloadCenterDiagnosticScreenshot(controller: BrowserController): Promise<string | undefined> {
  const page = controller.getPage();
  if (!page) return undefined;
  const screenshotPath = path.join(SCREENSHOTS_DIR, `download_center_diagnostic_${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

async function captureDownloadCenterDiagnosticDomSnapshot(controller: BrowserController): Promise<string | undefined> {
  const page = controller.getPage();
  if (!page) return undefined;
  const domSnapshotPath = path.join(DOM_SNAPSHOTS_DIR, `download_center_diagnostic_${Date.now()}.html`);
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

async function collectDownloadCenterSelectorCandidates(controller: BrowserController): Promise<DownloadCenterSelectorCandidate[]> {
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

const REQUIRED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS = new Set([
  'dateStartInput',
  'dateEndInput',
  'createReportButton',
  'readyReportSelector',
  'downloadButton',
]);

const REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS = new Set([
  'readyReportSelector',
  'statusTextSelector',
  'downloadButton',
]);

function getDownloadCenterActionSelectorKind(name: string): DownloadCenterActionSelectorCheck['kind'] {
  if (name === 'dateStartInput' || name === 'dateEndInput' || name === 'reportSearchInput') {
    return 'input';
  }
  if (name === 'readyReportSelector') {
    return 'row';
  }
  if (name === 'statusTextSelector') {
    return 'status';
  }
  if (name === 'createReportButton' || name === 'confirmCreateButton' || name === 'downloadButton') {
    return 'click';
  }
  return 'optional';
}

function evaluateActionSelectorUsability(name: string, selector: string, matchCount: number): {
  usable: boolean;
  ambiguous: boolean;
  errorMessage?: string;
} {
  const requiresReportScope = REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(name);
  const requiresDateScope = REPORT_SCOPED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(name);
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

async function collectDownloadCenterActionSelectorChecks(
  controller: BrowserController,
  model: DownloadCenterPageModel,
  dateRange?: { start: string; end: string },
  options: {
    names?: Set<string>;
    context?: DownloadCenterReportSelectorContext;
  } = {},
): Promise<DownloadCenterActionSelectorCheck[]> {
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
    const required = REQUIRED_DOWNLOAD_CENTER_ACTION_SELECTOR_KEYS.has(String(name));
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

async function collectDownloadCenterDiagnosticActionSelectorChecks(
  controller: BrowserController,
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string } | undefined,
  context: DownloadCenterReportSelectorContext,
): Promise<DownloadCenterActionSelectorCheck[]> {
  const listPageSelectorNames = new Set([
    'createReportButton',
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
    selectors.reportTypeSelect || DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportTypeSelect,
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
  await navigateToLingxingDownloadCenter(controller, model);
  return [...listChecks, ...createChecks];
}

async function collectSanitizedDomEvidence(controller: BrowserController): Promise<string> {
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

function persistDownloadCenterDiagnostic(result: DownloadCenterDiagnosticResult): DownloadCenterDiagnosticResult {
  if (!state.db) return result;

  const insert = state.db.prepare(`
    INSERT INTO download_center_diagnostics
      (app_version, page_model, page_model_source, page_model_snapshot_json, date_start, date_end, store_name, marketplace_code, url, title, ready, requires_manual_verification, matched_entry_hints_json,
       matched_report_names_json, selector_checks_json, missing_required_selectors_json, selector_candidates_json,
       action_selector_checks_json,
       screenshot_path, dom_snapshot_path, error_message, checked_at)
    VALUES
      (@appVersion, @pageModel, @pageModelSource, @pageModelSnapshotJson, @dateStart, @dateEnd, @storeName, @marketplaceCode, @url, @title, @ready, @requiresManualVerification, @matchedEntryHintsJson,
       @matchedReportNamesJson, @selectorChecksJson, @missingRequiredSelectorsJson, @selectorCandidatesJson,
       @actionSelectorChecksJson,
       @screenshotPath, @domSnapshotPath, @errorMessage, @checkedAt)
  `);
  const response = insert.run({
    appVersion: result.appVersion ?? APP_VERSION,
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

function countKeywordMetricsBySourceFile(source: KeywordMetric['source'], sourceFile: string): number {
  if (!state.db) return 0;
  const row = state.db
    .prepare('SELECT COUNT(*) AS count FROM keyword_metrics WHERE source = ? AND source_file = ?')
    .get(source, sourceFile) as { count?: number } | undefined;
  return Number(row?.count || 0);
}

function deleteKeywordMetricsBySourceFile(source: KeywordMetric['source'], sourceFile: string): void {
  state.db?.prepare('DELETE FROM keyword_metrics WHERE source = ? AND source_file = ?').run(source, sourceFile);
}

function loadPersistedKeywordMetrics(): KeywordMetric[] {
  if (!state.db) return [];
  const rows = state.db.prepare(`
    SELECT
      normalized_keyword AS normalizedKeyword,
      raw_keyword AS rawKeyword,
      source,
      asin,
      impressions,
      clicks,
      cost,
      orders,
      sales,
      acos,
      cvr,
      source_file AS sourceFile,
      source_row AS sourceRow
    FROM keyword_metrics
    ORDER BY id ASC
  `).all() as Array<KeywordMetric & { sourceRow?: number | null }>;

  return rows.map((row) => ({
    ...row,
    asin: row.asin ?? undefined,
    sourceFile: row.sourceFile ?? undefined,
    sourceRow: row.sourceRow ?? undefined,
  }));
}

function persistKeywordMetrics(
  metrics: KeywordMetric[],
  duplicateStrategy: KeywordImportDuplicateStrategy = 'merge',
): { existingRows: number; skipped: boolean; insertedRows: number } {
  if (!state.db || metrics.length === 0) return { existingRows: 0, skipped: false, insertedRows: 0 };
  const source = metrics[0].source;
  const sourceFile = metrics[0]?.sourceFile ? canonicalizeExistingPath(metrics[0].sourceFile) : undefined;
  const existingRows = sourceFile ? countKeywordMetricsBySourceFile(source, sourceFile) : 0;
  if (existingRows > 0 && duplicateStrategy === 'skip') {
    return { existingRows, skipped: true, insertedRows: 0 };
  }

  let insertedRows = 0;
  const save = state.db.transaction(() => {
    if (sourceFile && existingRows > 0 && duplicateStrategy === 'overwrite') {
      deleteKeywordMetricsBySourceFile(source, sourceFile);
    }
    const exists = state.db!.prepare(`
      SELECT id
      FROM keyword_metrics
      WHERE source = @source
        AND source_file = @sourceFile
        AND source_row = @sourceRow
      LIMIT 1
    `);
    const insert = state.db!.prepare(`
      INSERT INTO keyword_metrics
        (normalized_keyword, raw_keyword, source, asin, impressions, clicks, cost, orders, sales, acos, cvr, source_file, source_row)
      VALUES
        (@normalizedKeyword, @rawKeyword, @source, @asin, @impressions, @clicks, @cost, @orders, @sales, @acos, @cvr, @sourceFile, @sourceRow)
    `);

    for (const metric of metrics) {
      const sourceFileValue = metric.sourceFile ? canonicalizeExistingPath(metric.sourceFile) : null;
      const sourceRowValue = metric.sourceRow ?? null;
      if (duplicateStrategy === 'merge' && sourceFileValue && sourceRowValue !== null) {
        const existing = exists.get({
          source: metric.source,
          sourceFile: sourceFileValue,
          sourceRow: sourceRowValue,
        });
        if (existing) {
          continue;
        }
      }

      insert.run({
        ...metric,
        asin: metric.asin ?? null,
        sourceFile: sourceFileValue,
        sourceRow: sourceRowValue,
      });
      insertedRows += 1;
    }
  });
  save();
  return { existingRows, skipped: false, insertedRows };
}

function persistKeywordOpportunities(opportunities: KeywordOpportunity[]): void {
  if (!state.db || opportunities.length === 0) return;

  const save = state.db.transaction(() => {
    const findExisting = state.db!.prepare(`
      SELECT id, status
      FROM keyword_opportunities
      WHERE COALESCE(asin, '') = @asinKey
        AND normalized_keyword = @normalizedKeyword
      LIMIT 1
    `);
    const update = state.db!.prepare(`
      UPDATE keyword_opportunities
      SET
        opportunity_level = @opportunityLevel,
        score = @score,
        evidence = @evidence,
        risk_flags_json = @riskFlagsJson,
        recommended_sections_json = @recommendedSectionsJson,
        updated_at = datetime('now')
      WHERE id = @id
    `);
    const insert = state.db!.prepare(`
      INSERT INTO keyword_opportunities
        (asin, normalized_keyword, opportunity_level, score, evidence, risk_flags_json, recommended_sections_json, status)
      VALUES
        (@asin, @normalizedKeyword, @opportunityLevel, @score, @evidence, @riskFlagsJson, @recommendedSectionsJson, @status)
    `);
    for (const opportunity of opportunities) {
      const row = {
        ...opportunity,
        asin: opportunity.asin ?? null,
        asinKey: opportunity.asin ?? '',
        riskFlagsJson: JSON.stringify(opportunity.riskFlags),
        recommendedSectionsJson: JSON.stringify(opportunity.recommendedSections),
      };
      const existing = findExisting.get(row) as { id: number; status: KeywordOpportunity['status'] } | undefined;
      if (existing) {
        update.run({ ...row, id: existing.id });
      } else {
        insert.run(row);
      }
    }
  });
  save();
}

function pruneKeywordOpportunitiesTo(opportunities: KeywordOpportunity[]): void {
  if (!state.db) return;
  const allowedKeys = new Set(opportunities.map((opportunity) => `${opportunity.asin ?? ''}\u0000${opportunity.normalizedKeyword}`));
  const rows = state.db.prepare(`
    SELECT id, asin, normalized_keyword AS normalizedKeyword
    FROM keyword_opportunities
  `).all() as Array<{ id: number; asin?: string | null; normalizedKeyword: string }>;
  const staleIds = rows
    .filter((row) => !allowedKeys.has(`${row.asin ?? ''}\u0000${row.normalizedKeyword}`))
    .map((row) => row.id);
  if (staleIds.length === 0) return;

  const remove = state.db.transaction(() => {
    const deleteRow = state.db!.prepare('DELETE FROM keyword_opportunities WHERE id = ?');
    for (const id of staleIds) {
      deleteRow.run(id);
    }
  });
  remove();
}

function handleImportKeywordMetrics(
  filePath: string,
  source?: string,
  duplicateStrategy: KeywordImportDuplicateStrategy = 'merge',
) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('请选择关键词报表文件');
  }
  if (!['overwrite', 'merge', 'skip'].includes(duplicateStrategy)) {
    throw new Error('重复导入策略只支持 overwrite、merge 或 skip');
  }

  const resolvedFilePath = canonicalizeExistingPath(filePath);
  const parseResult = parseKeywordMetricsWithDiagnostics(resolvedFilePath, {
    source: normalizeKeywordSource(source),
    fieldMappingsDir: path.join(getBundledResourcesPath(), 'field-mappings'),
  });
  const { metrics, diagnostics } = parseResult;
  if (metrics.length === 0) {
    throw new Error('未在报表中识别到关键词指标，请检查字段映射');
  }

  const metricsForPersistence = metrics.map((metric) => ({ ...metric, sourceFile: resolvedFilePath }));
  const importResult = persistKeywordMetrics(metricsForPersistence, duplicateStrategy);
  if (importResult.skipped) {
    const persistedMetrics = loadPersistedKeywordMetrics();
    const opportunities = buildKeywordOpportunities(persistedMetrics);
    return {
      filePath: resolvedFilePath,
      metricsCount: 0,
      metrics: persistedMetrics,
      diagnostics,
      opportunities,
      duplicate: true,
      duplicateStrategy,
      existingRows: importResult.existingRows,
      skipped: true,
    };
  }

  const persistedMetrics = loadPersistedKeywordMetrics();
  const opportunities = buildKeywordOpportunities(persistedMetrics);
  persistKeywordOpportunities(opportunities);
  pruneKeywordOpportunitiesTo(opportunities);

  return {
    filePath: resolvedFilePath,
    metricsCount: importResult.insertedRows,
    metrics: persistedMetrics,
    diagnostics,
    opportunities,
    duplicate: importResult.existingRows > 0,
    duplicateStrategy,
    existingRows: importResult.existingRows,
    skipped: false,
  };
}

function handleBuildKeywordOpportunities(metrics: KeywordMetric[], options: { brandWhitelist?: string[] } = {}) {
  validateArray(metrics, 'metrics', 20000);
  const opportunities = buildKeywordOpportunities(metrics, options);
  persistKeywordOpportunities(opportunities);
  return opportunities;
}

function handleExportKeywordDiagnostics(diagnostics: unknown): string {
  if (!diagnostics || typeof diagnostics !== 'object') {
    throw new Error('解析诊断数据无效');
  }
  const value = diagnostics as {
    errors?: unknown;
    warnings?: unknown;
    totalRows?: unknown;
    parsedRows?: unknown;
    invalidRows?: unknown;
    invalidRowRatio?: unknown;
  };
  if (!Array.isArray(value.errors) || !Array.isArray(value.warnings)) {
    throw new Error('解析诊断数据缺少 errors 或 warnings');
  }
  const output = keywordMetricDiagnosticsToCsv({
    totalRows: Number(value.totalRows) || 0,
    parsedRows: Number(value.parsedRows) || 0,
    invalidRows: Number(value.invalidRows) || 0,
    invalidRowRatio: Number(value.invalidRowRatio) || 0,
    errors: value.errors as any[],
    warnings: value.warnings as any[],
  });
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }
  const filePath = path.join(EXPORTS_DIR, `keyword_parse_diagnostics_${Date.now()}.csv`);
  fs.writeFileSync(filePath, output, 'utf8');
  return filePath;
}

function handleAnalyzeListingCoverage(listing: ListingContent, keywords: string[]) {
  validateListing(listing);
  validateArray(keywords, 'keywords', 10000);
  const coverage = analyzeKeywordCoverage(listing, keywords);

  if (state.db) {
    const save = state.db.transaction(() => {
      state.db!.prepare(`
        INSERT INTO listing_content (asin, title, bullets_json, a_plus, image_copy, backend_terms, updated_at)
        VALUES (@asin, @title, @bulletsJson, @aPlus, @imageCopy, @backendTerms, datetime('now'))
      `).run({
        asin: listing.asin,
        title: listing.title,
        bulletsJson: JSON.stringify(listing.bullets),
        aPlus: listing.aPlus ?? null,
        imageCopy: listing.imageCopy ?? null,
        backendTerms: listing.backendTerms ?? null,
      });

      const insertCoverage = state.db!.prepare(`
        INSERT INTO keyword_coverage (asin, normalized_keyword, covered, sections_json, strength)
        VALUES (@asin, @normalizedKeyword, @covered, @sectionsJson, @strength)
      `);
      for (const item of coverage) {
        insertCoverage.run({
          asin: listing.asin,
          normalizedKeyword: item.normalizedKeyword,
          covered: item.covered ? 1 : 0,
          sectionsJson: JSON.stringify(item.sections),
          strength: item.strength,
        });
      }
    });
    save();
  }

  return coverage;
}

function handleImportListingContent(filePath: string): ListingContent {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('请选择 Listing 文案文件');
  }

  const listing = parseListingContent(filePath, {
    fieldMappingsDir: path.join(getBundledResourcesPath(), 'field-mappings'),
  });
  validateListing(listing);
  return listing;
}

async function handleExtractListingFromLingxing(options: { expectedAsin?: string; persist?: boolean } = {}) {
  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先通过本应用登录领星，并打开需要读取的 Listing 页面。');
  }
  const page = state.browserController.getPage();
  if (!page) {
    throw new Error('领星浏览器页面未就绪，请重新打开登录窗口后再试。');
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => undefined);
  const capturedAt = new Date().toISOString();
  const screenshotPath = path.join(SCREENSHOTS_DIR, `lingxing_listing_read_${Date.now()}.png`);
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
    persistListingContent(result.listing);
  }

  return result;
}

function persistListingContent(listing: ListingContent): void {
  if (!state.db) return;
  state.db.prepare(`
    INSERT INTO listing_content (asin, title, bullets_json, a_plus, image_copy, backend_terms, updated_at)
    VALUES (@asin, @title, @bulletsJson, @aPlus, @imageCopy, @backendTerms, datetime('now'))
  `).run({
    asin: listing.asin,
    title: listing.title,
    bulletsJson: JSON.stringify(listing.bullets),
    aPlus: listing.aPlus ?? null,
    imageCopy: listing.imageCopy ?? null,
    backendTerms: listing.backendTerms ?? null,
  });
}

async function clickLingxingListingReadOnlyTab(
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

function mergeListingExtractionResults(
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

async function handleOpenLingxingListingAndExtract(input: unknown) {
  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先通过本应用登录领星，再打开 Listing 页面。');
  }
  const targetUrl = parseLingxingListingReadUrl(input);
  const page = state.browserController.getPage();
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
  return handleExtractListingFromLingxing();
}

async function handleProbeLingxingListingDetailAndExtract(input?: unknown) {
  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先通过本应用登录领星，再探测 Listing 详情页。');
  }
  const page = state.browserController.getPage();
  if (!page) {
    throw new Error('领星浏览器页面未就绪，请重新打开登录窗口后再试。');
  }

  const rawUrl = input && typeof input === 'object' && typeof (input as { url?: unknown }).url === 'string'
    ? (input as { url: string }).url.trim()
    : typeof input === 'string'
      ? input.trim()
      : '';
  if (rawUrl) {
    const targetUrl = parseLingxingListingReadUrl(rawUrl);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);
  }

  const current = await handleExtractListingFromLingxing({ persist: false });
  const probe = {
    started: true,
    clicked: false,
    status: 'not_attempted',
    fromUrl: current.evidence.pageUrl,
    finalUrl: current.evidence.pageUrl,
    candidateCount: current.evidence.detailCandidates?.length || 0,
    asinMatched: Boolean(current.listing?.asin),
  };

  if (current.fullContentReady) {
    current.evidence.detailProbe = { ...probe, status: 'already_full_content_ready' };
    return current;
  }
  const asin = current.listing?.asin?.toUpperCase();
  if (!asin) {
    current.evidence.detailProbe = { ...probe, status: 'no_asin', reason: '当前页面未读取到 ASIN，不能定位详情页候选。' };
    return current;
  }

  const candidate = await findVisibleListingDetailCandidate(page, asin);
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

  const context = state.browserController.getContext();
  const popupPromise = context?.waitForEvent('page', { timeout: 12000 }).catch(() => null);
  await page.locator(`[data-amazon-ai-ops-listing-probe="${candidate.token}"]`).first().click({ timeout: 15000 });
  const popup = await popupPromise;
  const detailPage = popup || page;
  if (popup) {
    state.browserController.setActivePage(popup);
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

  const basicRead = await handleExtractListingFromLingxing({ expectedAsin: asin, persist: false });
  let probed = basicRead;
  if (!basicRead.fullContentReady) {
    const switchedToDescription = await clickLingxingListingReadOnlyTab(detailPage, ['描述', 'Description', '商品描述']);
    if (switchedToDescription) {
      await detailPage.waitForTimeout(2500);
      const descriptionRead = await handleExtractListingFromLingxing({ expectedAsin: asin, persist: false });
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
    asinMatched: Boolean(probed.listing?.asin && probed.listing.asin.toUpperCase() === asin),
    reason: probed.fullContentReady ? undefined : '详情页已打开，但仍未读取到完整五点和后台词。',
  };
  if (probed.fullContentReady && probed.listing) {
    persistListingContent(probed.listing);
  }
  return probed;
}

async function findVisibleListingDetailCandidate(
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

function parseLingxingListingReadUrl(input: unknown): string {
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

function handleBuildListingSuggestions(listing: ListingContent, opportunities: KeywordOpportunity[]): ListingSuggestion[] {
  validateListing(listing);
  validateArray(opportunities, 'opportunities', 10000);
  for (const opportunity of opportunities) {
    validateOpportunity(opportunity);
  }
  const suggestions = buildSafeListingSuggestions(listing, opportunities, { appVersion: APP_VERSION });

  if (state.db) {
    const persistedSuggestions: ListingSuggestion[] = [];
    const save = state.db.transaction(() => {
      const insert = state.db!.prepare(`
        INSERT INTO listing_suggestions
          (asin, keyword, section, current_text, suggested_text, evidence, risk_warnings_json, status, created_at)
        VALUES
          (@asin, @keyword, @section, @currentText, @suggestedText, @evidence, @riskWarningsJson, @status, @createdAt)
      `);
      for (const suggestion of suggestions) {
        const createdAt = suggestion.createdAt ?? new Date().toISOString();
        const result = insert.run({
          ...suggestion,
          currentText: suggestion.currentText ?? null,
          createdAt,
          riskWarningsJson: JSON.stringify(suggestion.riskWarnings),
        });
        persistedSuggestions.push({
          ...suggestion,
          id: Number(result.lastInsertRowid),
          createdAt,
        });
      }
    });
    save();
    return persistedSuggestions;
  }

  return suggestions;
}

function handleUpdateListingSuggestionStatus(id: number, status: ListingSuggestion['status']): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Listing 建议 ID 无效');
  }
  if (!['pending', 'accepted', 'ignored'].includes(status)) {
    throw new Error('Listing 建议状态无效');
  }
  state.db?.prepare(`
    UPDATE listing_suggestions
    SET status = @status, updated_at = datetime('now')
    WHERE id = @id
  `).run({ id, status });
}

async function handleGenerateListingDrafts(suggestions: ListingSuggestion[]): Promise<ListingDraft[]> {
  validateArray(suggestions, 'suggestions', 20000);
  for (const suggestion of suggestions) {
    validateSuggestion(suggestion);
  }

  let drafts = buildRuleBasedListingDrafts(suggestions, { appVersion: APP_VERSION });
  const settings = normalizeAiSettings(state.settingsRepo?.getAll() ?? {});
  const aiApiKey = settings.aiApiKey;

  if (aiApiKey) {
    drafts = await generateAiListingDrafts(drafts, settings);
  } else {
    drafts = drafts.map((draft) => ({
      ...draft,
      aiFallbackReason: '未配置 AI Key，使用规则草案',
    }));
  }

  return persistListingDrafts(drafts);
}

async function generateAiListingDrafts(drafts: ListingDraft[], settings: Record<string, string>): Promise<ListingDraft[]> {
  const provider = new OpenAICompatibleProvider(buildAiProviderConfig(settings));
  const promptTemplate = readPromptTemplate('listing-rewrite.md');

  const enhanced: ListingDraft[] = [];
  for (const draft of drafts) {
    let response;
    try {
      response = await provider.complete(buildListingRewritePrompt(promptTemplate, draft), {
        temperature: 0.3,
        maxTokens: 700,
      });
    } catch (error) {
      enhanced.push({
        ...draft,
        aiFallbackReason: `AI 调用异常：${error instanceof Error ? error.message : String(error)}，使用规则草案`,
      });
      continue;
    }
    if (!response.success || !response.content) {
      enhanced.push({
        ...draft,
        aiFallbackReason: response.error ? `AI 生成失败：${response.error}` : 'AI 未返回草案内容，使用规则草案',
      });
      continue;
    }

    const parsed = parseAiDraftResponse(response.content);
    enhanced.push(parsed
      ? {
          ...draft,
          draftedText: parsed.suggestedText,
          riskWarnings: Array.from(new Set([...draft.riskWarnings, ...parsed.riskWarnings])),
          evidence: `${draft.evidence}\nAI reason: ${parsed.reason}`,
          source: 'ai',
          aiFallbackReason: undefined,
        }
      : {
          ...draft,
          aiFallbackReason: 'AI 响应无法解析为 Listing 草案，使用规则草案',
        });
  }

  return enhanced;
}

function stringSetting(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAiSettings(settings: Record<string, unknown>): Record<string, string> {
  const asStrings = Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [key, String(value ?? '')]),
  );
  const apiKey = stringSetting(settings.ai_api_key) || stringSetting(settings.aiApiKey);
  const baseUrl = (stringSetting(settings.ai_base_url) || stringSetting(settings.aiBaseUrl) || 'https://api.deepseek.com').replace(/\/+$/, '');
  const model = stringSetting(settings.ai_model) || stringSetting(settings.aiModel) || 'deepseek-v4-flash';
  const temperature = stringSetting(settings.ai_temperature) || stringSetting(settings.aiTemperature) || '0.3';
  const maxTokens = stringSetting(settings.ai_max_tokens) || stringSetting(settings.aiMaxTokens) || '700';
  return {
    ...asStrings,
    aiApiKey: apiKey,
    ai_api_key: apiKey,
    aiBaseUrl: baseUrl,
    ai_base_url: baseUrl,
    aiModel: model,
    ai_model: model,
    aiTemperature: temperature,
    ai_temperature: temperature,
    aiMaxTokens: maxTokens,
    ai_max_tokens: maxTokens,
  };
}

function buildAiProviderConfig(settings: Record<string, unknown>) {
  const normalized = normalizeAiSettings(settings);
  return {
    apiKey: normalized.aiApiKey,
    baseUrl: normalized.aiBaseUrl,
    model: normalized.aiModel,
    temperature: parseNumberSetting(normalized.aiTemperature, 0.3),
    maxTokens: parseIntegerSetting(normalized.aiMaxTokens, 700),
  };
}

async function handleTestAiSettings(settings: Record<string, unknown>) {
  const config = buildAiProviderConfig(settings || {});
  if (!config.apiKey.trim()) {
    return {
      success: false,
      message: '未配置 AI Key：请填写 DeepSeek 或 OpenAI 兼容 API Key 后再测试。',
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  const provider = new OpenAICompatibleProvider(config);
  const response = await provider.complete('只回复 ok，用于连接测试。', {
    model: config.model,
    temperature: 0,
    maxTokens: 32,
  });

  if (!response.success || !response.content) {
    return {
      success: false,
      message: summarizeAiError(response.error || 'AI 未返回内容'),
      baseUrl: config.baseUrl,
      model: config.model,
    };
  }

  return {
    success: true,
    message: `AI 连接测试通过：${config.model}`,
    baseUrl: config.baseUrl,
    model: config.model,
    usage: response.usage,
  };
}

function parseNumberSetting(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerSetting(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function summarizeAiError(error: string): string {
  const firstLine = String(error || '').split(/\r?\n/).find(Boolean) || '未知错误';
  if (/401|unauthorized|invalid api key/i.test(firstLine)) {
    return 'AI 连接失败：API Key 无效或没有权限。';
  }
  if (/429|rate limit|quota/i.test(firstLine)) {
    return 'AI 连接失败：额度不足或请求频率过高。';
  }
  if (/network|fetch|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(firstLine)) {
    return 'AI 连接失败：网络或 Base URL 不可达。';
  }
  return `AI 连接失败：${firstLine.slice(0, 240)}`;
}

function persistListingDrafts(drafts: ListingDraft[]): ListingDraft[] {
  if (!state.db || drafts.length === 0) return drafts;

  const persisted: ListingDraft[] = [];
  const save = state.db.transaction(() => {
    const insert = state.db!.prepare(`
      INSERT INTO listing_drafts
        (asin, section, current_text, drafted_text, keywords_json, evidence, risk_warnings_json, source, ai_fallback_reason, status, created_at)
      VALUES
        (@asin, @section, @currentText, @draftedText, @keywordsJson, @evidence, @riskWarningsJson, @source, @aiFallbackReason, @status, @createdAt)
    `);
    for (const draft of drafts) {
      const createdAt = draft.createdAt ?? new Date().toISOString();
      const result = insert.run({
        ...draft,
        currentText: draft.currentText ?? null,
        keywordsJson: JSON.stringify(draft.keywords),
        riskWarningsJson: JSON.stringify(draft.riskWarnings),
        aiFallbackReason: draft.aiFallbackReason ?? null,
        createdAt,
      });
      persisted.push({
        ...draft,
        id: Number(result.lastInsertRowid),
        createdAt,
      });
    }
  });
  save();
  return persisted;
}

function readPromptTemplate(filename: string): string {
  const promptPath = path.join(getBundledResourcesPath(), 'prompts', filename);
  if (!fs.existsSync(promptPath)) {
    return '';
  }
  return fs.readFileSync(promptPath, 'utf8');
}

function buildListingRewritePrompt(promptTemplate: string, draft: ListingDraft): string {
  return `${promptTemplate}

当前模块：${draft.section}
当前文案：
${draft.currentText || ''}

目标关键词：
${draft.keywords.join(', ')}

数据证据：
${draft.evidence}

当前规则草案：
${draft.draftedText}
`;
}

function parseAiDraftResponse(content: string): { suggestedText: string; reason: string; riskWarnings: string[] } | null {
  const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  try {
    const parsed = JSON.parse(jsonText) as { suggestedText?: unknown; reason?: unknown; riskWarnings?: unknown };
    if (typeof parsed.suggestedText !== 'string' || !parsed.suggestedText.trim()) {
      return null;
    }
    return {
      suggestedText: parsed.suggestedText.trim(),
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      riskWarnings: Array.isArray(parsed.riskWarnings) ? parsed.riskWarnings.map((item) => String(item)) : [],
    };
  } catch {
    return null;
  }
}

async function handleExportListingSuggestions(suggestions: ListingSuggestion[], format: 'csv' | 'markdown' | 'xlsx'): Promise<string> {
  validateArray(suggestions, 'suggestions', 20000);
  if (!['csv', 'markdown', 'xlsx'].includes(format)) {
    throw new Error('导出格式只支持 csv、xlsx 或 markdown');
  }

  const extension = format === 'markdown' ? 'md' : format;
  const output = format === 'markdown'
    ? suggestionsToMarkdown(suggestions)
    : format === 'xlsx'
      ? suggestionsToXlsxBuffer(suggestions)
      : suggestionsToCsv(suggestions);
  const exportDir = EXPORTS_DIR;
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  const filePath = path.join(exportDir, `listing_suggestions_${Date.now()}.${extension}`);
  fs.writeFileSync(filePath, output, typeof output === 'string' ? 'utf8' : undefined);
  return filePath;
}

async function handleExportListingDrafts(drafts: ListingDraft[], format: 'csv' | 'markdown' | 'xlsx'): Promise<string> {
  validateArray(drafts, 'drafts', 20000);
  if (!['csv', 'markdown', 'xlsx'].includes(format)) {
    throw new Error('导出格式只支持 csv、xlsx 或 markdown');
  }
  for (const draft of drafts) {
    validateListingDraft(draft);
  }

  const extension = format === 'markdown' ? 'md' : format;
  const output = format === 'markdown'
    ? draftsToMarkdown(drafts)
    : format === 'xlsx'
      ? draftsToXlsxBuffer(drafts)
      : draftsToCsv(drafts);
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }
  const filePath = path.join(EXPORTS_DIR, `listing_drafts_${Date.now()}.${extension}`);
  fs.writeFileSync(filePath, output, typeof output === 'string' ? 'utf8' : undefined);
  return filePath;
}

const OPEN_PATH_ALLOWED_DIRS = [
  DOWNLOADS_DIR,
  SCREENSHOTS_DIR,
  DOM_SNAPSHOTS_DIR,
  TRACES_DIR,
  EXPORTS_DIR,
  REPORTS_DIR,
];

const OPEN_PATH_ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.htm',
  '.html',
  '.jpeg',
  '.jpg',
  '.json',
  '.md',
  '.png',
  '.txt',
  '.xls',
  '.xlsx',
  '.zip',
]);

function downloadCenterDiagnosticChecklist(diagnostic: DownloadCenterDiagnosticResult, readiness: ReturnType<typeof getDownloadCenterAutomationReadiness>): string {
  const missing = readiness.missing.length > 0 ? readiness.missing.join(', ') : 'none';
  return [
    '# Lingxing Download Center Diagnostic Bundle',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `App version: ${APP_VERSION}`,
    `Checked URL: ${diagnostic.url || 'unknown'}`,
    `Diagnostic ready: ${diagnostic.ready ? 'yes' : 'no'}`,
    `Automation ready: ${readiness.ready ? 'yes' : 'no'}`,
    `Readiness reason: ${readiness.reason || 'none'}`,
    `Missing readiness items: ${missing}`,
    '',
    '## Manual Verification Checklist',
    '',
    '- Confirm the URL is the real Lingxing download center.',
    '- Confirm all 8 report names match the live page.',
    '- Confirm start and end date fields apply the selected range before report creation.',
    '- Confirm create, status, ready-row, and download selectors each match one visible target.',
    '- Confirm ready-row, status, and download selectors are scoped by both report identity and date range.',
    '- Confirm downloaded filenames include the selected start and end date tokens.',
    '- Keep `requiresManualVerification: true` until every item above is proven from screenshot/DOM evidence.',
    '',
    '## Files',
    '',
    '- `diagnostic.json`: persisted diagnostic result.',
    '- `active-page-model.json`: page model active when the bundle was exported.',
    '- `readiness.json`: structural automation readiness result.',
    '- `selector-candidates.json`: candidate selectors found on the live page.',
    '- `action-selector-checks.json`: locator counts and usability checks for configured action selectors.',
    '- `screenshot.*`: copied diagnostic screenshot when available.',
    '- `dom-snapshot.*`: copied sanitized DOM evidence when available.',
    '',
  ].join('\n');
}

function handleExportDownloadCenterDiagnosticBundle(diagnosticId: number): string {
  if (!Number.isInteger(diagnosticId) || diagnosticId <= 0) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const diagnostic = loadPersistedDownloadCenterDiagnostic(diagnosticId, '', '');
  if (!diagnostic) {
    throw new Error(`未找到下载中心诊断记录：${diagnosticId}`);
  }
  const model = diagnostic.pageModelSnapshot ?? readDownloadCenterPageModel();
  const readiness = getDownloadCenterAutomationReadiness(model);
  const bundleDir = path.join(EXPORTS_DIR, `download_center_diagnostic_${diagnosticId}_${Date.now()}`);
  fs.mkdirSync(bundleDir, { recursive: true });

  const screenshotCopyPath = copyDiagnosticEvidenceFileToBundle(diagnostic.screenshotPath, bundleDir, 'screenshot', SCREENSHOTS_DIR, new Set(['.png', '.jpg', '.jpeg']));
  const domSnapshotCopyPath = copyDiagnosticEvidenceFileToBundle(diagnostic.domSnapshotPath, bundleDir, 'dom-snapshot', DOM_SNAPSHOTS_DIR, new Set(['.html', '.htm']));
  const bundleDiagnostic = {
    ...diagnostic,
    copiedScreenshotPath: screenshotCopyPath,
    copiedDomSnapshotPath: domSnapshotCopyPath,
  };

  fs.writeFileSync(path.join(bundleDir, 'diagnostic.json'), `${JSON.stringify(bundleDiagnostic, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'active-page-model.json'), `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'readiness.json'), `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'selector-candidates.json'), `${JSON.stringify(diagnostic.selectorCandidates ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'action-selector-checks.json'), `${JSON.stringify(diagnostic.actionSelectorChecks ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'manual-verification-checklist.md'), downloadCenterDiagnosticChecklist(diagnostic, readiness), 'utf8');
  return bundleDir;
}

function handleExportDownloadCenterPageModelDraft(diagnosticId: number): { exportPath: string; draft: DownloadCenterPageModel; notes: string[] } {
  if (!Number.isInteger(diagnosticId) || diagnosticId <= 0) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const diagnostic = loadPersistedDownloadCenterDiagnostic(diagnosticId, '', '');
  if (!diagnostic) {
    throw new Error(`未找到下载中心诊断记录：${diagnosticId}`);
  }
  const baseModel = diagnostic.pageModelSnapshot ?? readDownloadCenterPageModel();
  const draftResult = buildDownloadCenterPageModelDraft(baseModel, diagnostic);
  const draftDir = path.join(EXPORTS_DIR, `download_center_page_model_draft_${diagnosticId}_${Date.now()}`);
  fs.mkdirSync(draftDir, { recursive: true });
  fs.writeFileSync(path.join(draftDir, 'page-model-draft.json'), `${JSON.stringify(draftResult.draft, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(draftDir, 'solidification-notes.md'), downloadCenterPageModelDraftToMarkdown(draftResult, diagnostic), 'utf8');
  fs.writeFileSync(path.join(draftDir, 'selector-candidates.json'), `${JSON.stringify(diagnostic.selectorCandidates ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(draftDir, 'action-selector-checks.json'), `${JSON.stringify(diagnostic.actionSelectorChecks ?? [], null, 2)}\n`, 'utf8');
  return { exportPath: draftDir, draft: draftResult.draft, notes: draftResult.notes };
}

function handleExportDownloadCenterPageModelEnablementAudit(
  input: unknown,
  diagnosticId?: number,
): { exportPath: string; canDisableManualVerification: boolean; missing: string[] } {
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const target = { storeName: request.storeName, marketplaceCode: request.marketplaceCode };
  validateDateRange(dateRange);
  if (diagnosticId !== undefined && (!Number.isInteger(diagnosticId) || diagnosticId <= 0)) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const model = readDownloadCenterPageModel();
  const diagnostic = diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(diagnosticId, dateRange.start, dateRange.end)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(model, dateRange.start, dateRange.end, target);
  const selectorEvidenceReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, diagnostic, { target })
    : undefined;
  const diagnosticFileReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceFiles(diagnostic, {
      screenshotsDir: SCREENSHOTS_DIR,
      domSnapshotsDir: DOM_SNAPSHOTS_DIR,
    })
    : undefined;
  const diagnosticEvidenceReadiness = selectorEvidenceReadiness && diagnosticFileReadiness
    ? {
      ...selectorEvidenceReadiness,
      ready: selectorEvidenceReadiness.ready && diagnosticFileReadiness.ready,
      missing: Array.from(new Set([...selectorEvidenceReadiness.missing, ...diagnosticFileReadiness.missing])),
      reason: selectorEvidenceReadiness.ready ? diagnosticFileReadiness.reason : selectorEvidenceReadiness.reason,
    }
    : selectorEvidenceReadiness;
  const canaryReportTypes = loadSuccessfulCanaryReportTypesForScope(dateRange, target);
  const canaryEvidenceReadiness = evaluateDownloadCenterCanaryEvidenceReadiness(canaryReportTypes);
  const audit = auditDownloadCenterPageModelEnablement(model, dateRange, diagnostic, {
    target,
    diagnosticEvidenceReadiness,
    canaryEvidenceReadiness,
  });
  const auditDir = path.join(
    EXPORTS_DIR,
    `download_center_page_model_enablement_${safeFileSegment(dateRange.start)}_${safeFileSegment(dateRange.end)}_${Date.now()}`,
  );
  writeDownloadCenterPageModelEnablementAuditBundle({
    auditDir,
    audit,
    model,
    diagnostic,
    directories: {
      screenshotsDir: SCREENSHOTS_DIR,
      domSnapshotsDir: DOM_SNAPSHOTS_DIR,
    },
  });
  return {
    exportPath: auditDir,
    canDisableManualVerification: audit.canDisableManualVerification,
    missing: audit.checks.flatMap((check) => check.missing),
  };
}

function handleExportLingxingAcceptanceAudit(batchId: string, diagnosticId?: number): string {
  if (typeof batchId !== 'string' || !batchId.trim()) {
    throw new Error('领星验收审计需要有效批次 ID');
  }
  const persisted = loadPersistedLingxingBatch(batchId);
  const { batch, files } = persisted;
  const target = { storeName: batch.storeName, marketplaceCode: batch.marketplaceCode };
  const activeModel = readDownloadCenterPageModel();
  const diagnostic = diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(diagnosticId, batch.dateStart, batch.dateEnd)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(activeModel, batch.dateStart, batch.dateEnd, target);
  const selectorEvidenceReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceReadiness(activeModel, { start: batch.dateStart, end: batch.dateEnd }, diagnostic, { target })
    : undefined;
  const diagnosticFileReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceFiles(diagnostic, {
      screenshotsDir: SCREENSHOTS_DIR,
      domSnapshotsDir: DOM_SNAPSHOTS_DIR,
    })
    : undefined;
  const diagnosticEvidenceReadiness = selectorEvidenceReadiness && diagnosticFileReadiness
    ? {
      ...selectorEvidenceReadiness,
      ready: selectorEvidenceReadiness.ready && diagnosticFileReadiness.ready,
      missing: Array.from(new Set([...selectorEvidenceReadiness.missing, ...diagnosticFileReadiness.missing])),
      reason: selectorEvidenceReadiness.ready ? diagnosticFileReadiness.reason : selectorEvidenceReadiness.reason,
    }
    : selectorEvidenceReadiness;
  const manifest = readLingxingManifestForAudit(batch);
  const audit = auditLingxingAcceptanceEvidence({
    batch,
    files,
    diagnostic,
    diagnosticEvidenceReadiness,
    manifest,
    fileExists: (filePath) => {
      try {
        return isPathWithinRealDirectory(filePath, batch.downloadDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    },
    getFileSizeBytes: (filePath) => {
      try {
        if (!isPathWithinRealDirectory(filePath, batch.downloadDir)) return undefined;
        const stat = fs.statSync(filePath);
        return stat.isFile() ? stat.size : undefined;
      } catch {
        return undefined;
      }
    },
  });
  const auditDir = path.join(EXPORTS_DIR, `lingxing_acceptance_audit_${safeFileSegment(batch.id)}_${Date.now()}`);
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'acceptance-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'acceptance-audit.md'), lingxingAcceptanceAuditToMarkdown(audit), 'utf8');
  fs.writeFileSync(path.join(auditDir, 'filename-date-range-analysis.json'), `${JSON.stringify(audit.filenameDateRangeAnalyses, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'batch-result.json'), `${JSON.stringify({ batch, files }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'downloaded-report-files.json'), `${JSON.stringify(buildDownloadedReportEvidenceIndex(batch, files), null, 2)}\n`, 'utf8');
  const failureEvidenceFiles = copyReportFailureEvidenceFilesToBundle(files, auditDir, {
    screenshotsDir: SCREENSHOTS_DIR,
    domSnapshotsDir: DOM_SNAPSHOTS_DIR,
    tracesDir: TRACES_DIR,
  });
  fs.writeFileSync(path.join(auditDir, 'report-failure-evidence-files.json'), `${JSON.stringify(failureEvidenceFiles, null, 2)}\n`, 'utf8');
  if (diagnostic) {
    const copiedScreenshotPath = copyDiagnosticEvidenceFileToBundle(diagnostic.screenshotPath, auditDir, 'diagnostic-screenshot', SCREENSHOTS_DIR, new Set(['.png', '.jpg', '.jpeg']));
    const copiedDomSnapshotPath = copyDiagnosticEvidenceFileToBundle(diagnostic.domSnapshotPath, auditDir, 'diagnostic-dom-snapshot', DOM_SNAPSHOTS_DIR, new Set(['.html', '.htm']));
    fs.writeFileSync(path.join(auditDir, 'diagnostic.json'), `${JSON.stringify({
      ...diagnostic,
      copiedScreenshotPath,
      copiedDomSnapshotPath,
    }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(auditDir, 'diagnostic-evidence-files.json'), `${JSON.stringify({
      sourceScreenshotPath: diagnostic.screenshotPath,
      sourceDomSnapshotPath: diagnostic.domSnapshotPath,
      copiedScreenshotPath,
      copiedDomSnapshotPath,
      readiness: diagnosticFileReadiness,
    }, null, 2)}\n`, 'utf8');
  }
  if (batch.manifestPath && isSafeManifestPath(batch.manifestPath, batch.downloadDir)) {
    fs.copyFileSync(fs.realpathSync(batch.manifestPath), path.join(auditDir, 'manifest.json'));
  }
  return auditDir;
}

function loadPersistedLingxingBatch(batchId: string): { batch: LingxingReportBatch; files: LingxingReportFile[] } {
  if (!state.db) {
    throw new Error('本地数据库尚未初始化');
  }
  const batchRow = state.db.prepare(`
    SELECT
      id,
      app_version AS appVersion,
      date_start AS dateStart,
      date_end AS dateEnd,
      store_name AS storeName,
      marketplace_code AS marketplaceCode,
      status,
      download_dir AS downloadDir,
      manifest_path AS manifestPath,
      created_at AS createdAt,
      completed_at AS completedAt
    FROM lingxing_report_batches
    WHERE id = ?
  `).get(batchId) as (LingxingReportBatch & { appVersion?: string | null; manifestPath?: string | null; completedAt?: string | null }) | undefined;
  if (!batchRow) {
    throw new Error(`未找到领星采集批次：${batchId}`);
  }
  const fileRows = state.db.prepare(`
    SELECT
      id,
      batch_id AS batchId,
      report_type AS reportType,
      display_name AS displayName,
      status,
      max_auto_retries AS maxAutoRetries,
      auto_retry_count AS autoRetryCount,
      file_path AS filePath,
      file_size_bytes AS fileSizeBytes,
      error_message AS errorMessage,
      attempt_errors_json AS attemptErrorsJson,
      failure_screenshot_path AS failureScreenshotPath,
      failure_dom_snapshot_path AS failureDomSnapshotPath,
      failure_trace_path AS failureTracePath,
      trace_unavailable_reason AS traceUnavailableReason,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM lingxing_report_files
    WHERE batch_id = ?
    ORDER BY id ASC
  `).all(batchId) as Array<LingxingReportFile & { attemptErrorsJson?: string | null; filePath?: string | null; errorMessage?: string | null }>;

  return {
    batch: {
      ...batchRow,
      appVersion: batchRow.appVersion ?? undefined,
      storeName: batchRow.storeName ?? undefined,
      marketplaceCode: batchRow.marketplaceCode ?? undefined,
      manifestPath: batchRow.manifestPath ?? undefined,
      completedAt: batchRow.completedAt ?? undefined,
    },
    files: fileRows.map((row) => ({
      ...row,
      filePath: row.filePath ?? undefined,
      errorMessage: row.errorMessage ?? undefined,
      attemptErrors: parseStringArray(row.attemptErrorsJson),
      failureScreenshotPath: row.failureScreenshotPath ?? undefined,
      failureDomSnapshotPath: row.failureDomSnapshotPath ?? undefined,
      failureTracePath: row.failureTracePath ?? undefined,
      traceUnavailableReason: row.traceUnavailableReason ?? undefined,
    })),
  };
}

function loadSuccessfulCanaryReportTypesForScope(
  dateRange: { start: string; end: string },
  target: LingxingCollectionTarget,
  afterCheckedAt?: string,
): LingxingReportType[] {
  if (!state.db) return [];
  const rows = state.db.prepare(`
    SELECT
      b.id AS batchId,
      b.created_at AS batchCreatedAt,
      b.download_dir AS downloadDir,
      f.report_type AS reportType,
      f.file_path AS filePath,
      f.file_size_bytes AS fileSizeBytes,
      f.error_message AS errorMessage,
      f.attempt_errors_json AS attemptErrorsJson
    FROM lingxing_report_batches b
    JOIN lingxing_report_files f ON f.batch_id = b.id
    WHERE b.app_version = ?
      AND b.date_start = ?
      AND b.date_end = ?
      AND COALESCE(b.store_name, '') = COALESCE(?, '')
      AND COALESCE(b.marketplace_code, '') = COALESCE(?, '')
      AND b.status = 'completed'
      AND f.status = 'downloaded'
      AND (
        SELECT COUNT(*)
        FROM lingxing_report_files count_files
        WHERE count_files.batch_id = b.id
      ) = 1
    ORDER BY b.created_at DESC, b.id DESC
  `).all(
    APP_VERSION,
    dateRange.start,
    dateRange.end,
    target.storeName ?? '',
    target.marketplaceCode ?? '',
  ) as Array<{
    batchId: string;
    batchCreatedAt: string;
    downloadDir: string;
    reportType: string;
    filePath?: string | null;
    fileSizeBytes?: number | null;
    errorMessage?: string | null;
    attemptErrorsJson?: string | null;
  }>;

  const afterMs = afterCheckedAt ? Date.parse(afterCheckedAt) : Number.NaN;
  const dateStartToken = compactDateToken(dateRange.start);
  const dateEndToken = compactDateToken(dateRange.end);
  const covered = new Set<LingxingReportType>();

  for (const row of rows) {
    const report = LINGXING_AD_REPORTS.find((item) => item.type === row.reportType);
    if (!report) continue;
    const createdAtMs = Date.parse(row.batchCreatedAt);
    if (Number.isFinite(afterMs) && (!Number.isFinite(createdAtMs) || createdAtMs < afterMs)) continue;
    if (row.errorMessage) continue;
    if (JSON.stringify(parseStringArray(row.attemptErrorsJson)) !== '[]') continue;
    if (!row.filePath || !fs.existsSync(row.filePath)) continue;
    if (!isPathInsideDirectory(path.resolve(row.filePath), path.resolve(row.downloadDir))) continue;
    const actualSize = fs.statSync(row.filePath).size;
    if (actualSize < 128 || row.fileSizeBytes !== actualSize) continue;
    const basename = path.basename(row.filePath).toLowerCase();
    if (!basename.includes(report.expectedFilenameKeyword.toLowerCase())) continue;
    if (!basename.includes(dateStartToken) || !basename.includes(dateEndToken)) continue;
    covered.add(report.type);
  }

  return [...covered];
}

function compactDateToken(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

function loadPersistedDownloadCenterDiagnostic(
  diagnosticId: number | undefined,
  dateStart: string,
  dateEnd: string,
): DownloadCenterDiagnosticResult | undefined {
  if (!state.db) return undefined;
  const row = diagnosticId
    ? state.db.prepare(`
        SELECT * FROM download_center_diagnostics WHERE id = ?
      `).get(diagnosticId)
    : state.db.prepare(`
        SELECT * FROM download_center_diagnostics
        WHERE date_start = ? AND date_end = ?
        ORDER BY checked_at DESC, id DESC
        LIMIT 1
      `).get(dateStart, dateEnd);
  if (!row) return undefined;
  return mapDownloadCenterDiagnosticRow(row as Record<string, unknown>);
}

function loadLatestPersistedDownloadCenterDiagnosticForModel(
  model: DownloadCenterPageModel,
  dateStart: string,
  dateEnd: string,
  target: LingxingCollectionTarget = {},
): DownloadCenterDiagnosticResult | undefined {
  if (!state.db) return undefined;
  const row = getLatestDownloadCenterDiagnosticRowForModel(state.db, model, dateStart, dateEnd, target);
  if (!row) return undefined;
  return mapDownloadCenterDiagnosticRow(row as Record<string, unknown>);
}

function mapDownloadCenterDiagnosticRow(row: Record<string, unknown>): DownloadCenterDiagnosticResult {
  return {
    id: Number(row.id),
    appVersion: stringOrUndefined(row.app_version),
    pageModel: String(row.page_model || ''),
    pageModelSource: row.page_model_source === 'override' ? 'override' : row.page_model_source === 'bundled' ? 'bundled' : undefined,
    pageModelSnapshot: parseDownloadCenterPageModelSnapshot(stringOrUndefined(row.page_model_snapshot_json)),
    dateStart: stringOrUndefined(row.date_start),
    dateEnd: stringOrUndefined(row.date_end),
    storeName: stringOrUndefined(row.store_name),
    marketplaceCode: stringOrUndefined(row.marketplace_code),
    url: String(row.url || ''),
    title: String(row.title || ''),
    ready: Boolean(row.ready),
    requiresManualVerification: Boolean(row.requires_manual_verification),
    matchedEntryHints: parseStringArray(row.matched_entry_hints_json),
    matchedReportNames: parseStringArray(row.matched_report_names_json),
    selectorChecks: parseJsonArray(row.selector_checks_json) as DownloadCenterDiagnosticResult['selectorChecks'],
    missingRequiredSelectors: parseStringArray(row.missing_required_selectors_json),
    selectorCandidates: parseJsonArray(row.selector_candidates_json) as DownloadCenterSelectorCandidate[],
    actionSelectorChecks: parseDiagnosticActionSelectorChecks(stringOrUndefined(row.action_selector_checks_json)),
    checkedAt: String(row.checked_at || ''),
    screenshotPath: stringOrUndefined(row.screenshot_path),
    domSnapshotPath: stringOrUndefined(row.dom_snapshot_path),
    errorMessage: stringOrUndefined(row.error_message),
  };
}

function parseStringArray(value: unknown): string[] {
  return parseJsonArray(value).map((item) => String(item));
}

function parseJsonArray(value: unknown): unknown[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function getOpenPathAllowedRealDirs(): string[] {
  return OPEN_PATH_ALLOWED_DIRS
    .filter((allowedDir) => fs.existsSync(allowedDir))
    .map((allowedDir) => fs.realpathSync(allowedDir));
}

async function handleOpenPath(targetPath: string): Promise<void> {
  if (typeof targetPath !== 'string' || !targetPath.trim()) {
    throw new Error('路径无效');
  }
  const resolvedPath = path.resolve(targetPath);
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolvedPath);
  } catch {
    throw new Error(`路径不存在：${resolvedPath}`);
  }
  if (!getOpenPathAllowedRealDirs().some((allowedDir) => isPathInsideDirectory(realPath, allowedDir))) {
    throw new Error('只允许打开应用本地证据、下载和导出目录内的文件');
  }
  const stat = fs.statSync(realPath);
  if (stat.isFile() && !OPEN_PATH_ALLOWED_EXTENSIONS.has(path.extname(realPath).toLowerCase())) {
    throw new Error('文件类型不允许直接打开');
  }
  const error = await shell.openPath(realPath);
  if (error) {
    throw new Error(error);
  }
}

function validateDateRange(dateRange: { start: string; end: string }): void {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(dateRange?.start || '') || !pattern.test(dateRange?.end || '')) {
    throw new Error('日期范围必须使用 YYYY-MM-DD 格式');
  }
  if (dateRange.start > dateRange.end) {
    throw new Error('开始日期不能晚于结束日期');
  }
}

function validateLingxingReportType(reportType: unknown): asserts reportType is LingxingReportType {
  if (typeof reportType !== 'string' || !LINGXING_REPORT_TYPE_SET.has(reportType)) {
    throw new Error('领星报告类型无效');
  }
}

function validateArray(value: unknown, name: string, maxLength: number): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} 必须是数组`);
  }
  if (value.length > maxLength) {
    throw new Error(`${name} 超过最大数量限制 ${maxLength}`);
  }
}

function validateListing(listing: ListingContent): void {
  if (!listing || typeof listing.asin !== 'string' || !listing.asin.trim() || listing.asin.length > 32) {
    throw new Error('Listing ASIN 无效');
  }
  if (typeof listing.title !== 'string' || !listing.title.trim() || listing.title.length > 500) {
    throw new Error('Listing title 无效');
  }
  if (!Array.isArray(listing.bullets)) {
    throw new Error('Listing bullets 必须是数组');
  }
  if (listing.bullets.length > 10 || listing.bullets.some((bullet) => typeof bullet !== 'string' || bullet.length > 1000)) {
    throw new Error('Listing bullets 内容无效');
  }
  for (const field of [listing.aPlus, listing.imageCopy, listing.backendTerms]) {
    if (field !== undefined && typeof field !== 'string') {
      throw new Error('Listing 文案字段必须是字符串');
    }
  }
}

function validateOpportunity(opportunity: KeywordOpportunity): void {
  if (!opportunity || typeof opportunity.normalizedKeyword !== 'string' || !opportunity.normalizedKeyword.trim()) {
    throw new Error('关键词机会无效');
  }
  if (!['high', 'medium', 'low'].includes(opportunity.opportunityLevel)) {
    throw new Error('关键词机会等级无效');
  }
  if (!Number.isFinite(Number(opportunity.score))) {
    throw new Error('关键词机会分数无效');
  }
  if (!Array.isArray(opportunity.riskFlags) || !Array.isArray(opportunity.recommendedSections)) {
    throw new Error('关键词机会风险或推荐位置无效');
  }
}

function validateSuggestion(suggestion: ListingSuggestion): void {
  if (!suggestion || typeof suggestion.asin !== 'string' || typeof suggestion.keyword !== 'string') {
    throw new Error('Listing 建议无效');
  }
  if (!['title', 'bullet', 'a_plus', 'image_copy', 'backend_terms'].includes(suggestion.section)) {
    throw new Error('Listing 建议位置无效');
  }
  if (typeof suggestion.suggestedText !== 'string' || !suggestion.suggestedText.trim()) {
    throw new Error('Listing 建议文案无效');
  }
  if (!Array.isArray(suggestion.riskWarnings)) {
    throw new Error('Listing 建议风险字段无效');
  }
}

function validateListingDraft(draft: ListingDraft): void {
  if (!draft || typeof draft.asin !== 'string' || typeof draft.draftedText !== 'string') {
    throw new Error('Listing 草案无效');
  }
  if (!['title', 'bullet', 'a_plus', 'image_copy', 'backend_terms'].includes(draft.section)) {
    throw new Error('Listing 草案位置无效');
  }
  if (!draft.draftedText.trim()) {
    throw new Error('Listing 草案文案无效');
  }
  if (!Array.isArray(draft.keywords) || !Array.isArray(draft.riskWarnings)) {
    throw new Error('Listing 草案关键词或风险字段无效');
  }
  if (!['ai', 'rule'].includes(draft.source)) {
    throw new Error('Listing 草案来源无效');
  }
}

function normalizeKeywordSource(source?: string): KeywordMetric['source'] | undefined {
  if (!source) return undefined;
  if (['search_term', 'sqp', 'keyword_report', 'manual'].includes(source)) {
    return source as KeywordMetric['source'];
  }
  throw new Error('关键词报表来源无效');
}

// ============================================================================
// Recommendation & Execution
// ============================================================================

async function runRecommendationGeneration(request: any = {}): Promise<{
  generated: number;
  metrics: number;
  skippedDuplicates: number;
  scope: any;
  metricsBackfill?: ReturnType<typeof backfillAdMetricsFromLatestBatchIfNeeded>;
}> {
  if (!state.isLoggedIn) {
    throw new Error('Not logged in');
  }

  const operatorRequested = request && typeof request === 'object' && Object.keys(request).length > 0;
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(1000, Number(request.limit))) : 300;
  const scope = {
    dateFrom: typeof request.dateFrom === 'string' && request.dateFrom.trim() ? request.dateFrom.trim() : undefined,
    dateTo: typeof request.dateTo === 'string' && request.dateTo.trim() ? request.dateTo.trim() : undefined,
    storeName: typeof request.storeName === 'string' && request.storeName.trim() ? request.storeName.trim() : operatorRequested ? undefined : state.currentStore || undefined,
    marketplaceCode: typeof request.marketplaceCode === 'string' && request.marketplaceCode.trim() ? request.marketplaceCode.trim() : undefined,
    asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
    limit,
  };

  if (operatorRequested && (!scope.dateFrom || !scope.dateTo || !scope.storeName || !scope.marketplaceCode)) {
    throw new Error('生成优化建议需要明确填写开始日期、结束日期、店铺和站点，不能使用登录账号名代替店铺范围。');
  }

  const hasScopedRequest = Boolean(scope.dateFrom || scope.dateTo || scope.storeName || scope.marketplaceCode || scope.asin);
  const metricsBackfill = hasScopedRequest ? backfillAdMetricsFromLatestBatchIfNeeded(scope) : undefined;
  const metrics = hasScopedRequest && state.adMetricsRepo?.findForRecommendations
    ? state.adMetricsRepo.findForRecommendations(scope)
    : state.adMetricsRepo?.getRecent(limit, scope.storeName) || [];
  if (metrics.length === 0) {
    console.log('[Scheduler] No metrics to process');
    return { generated: 0, metrics: 0, skippedDuplicates: 0, scope, metricsBackfill };
  }

  // Generate recommendations
  const generator = new RecommendationGenerator(state.ruleConfig);
  const firstMetric = metrics[0];
  let recommendations = generator.generateBatch(metrics, {
    storeName: scope.storeName || firstMetric?.storeName || state.currentStore || 'unknown',
    marketplaceCode: scope.marketplaceCode || firstMetric?.marketplaceCode || 'US',
    config: state.ruleConfig,
    taskId: `task_${Date.now()}`,
  });
  recommendations = await enrichAdRecommendationsWithAiExplanations(recommendations);

  // Save to database
  let inserted = 0;
  let skippedDuplicates = 0;
  for (const rec of recommendations) {
    const result = state.recommendationRepo?.insertIfNoDuplicate
      ? state.recommendationRepo.insertIfNoDuplicate(rec)
      : { id: state.recommendationRepo?.insert(rec) || 0, inserted: true };
    if (result.inserted) {
      inserted++;
    } else {
      skippedDuplicates++;
    }
  }

  console.log(`[Scheduler] Generated ${inserted} recommendations; skipped ${skippedDuplicates} duplicate(s)`);
  mainWindow?.webContents.send('recommendations:generated', inserted);
  return { generated: inserted, metrics: metrics.length, skippedDuplicates, scope, metricsBackfill };
}

async function enrichAdRecommendationsWithAiExplanations(
  recommendations: ActionRecommendation[],
): Promise<ActionRecommendation[]> {
  if (recommendations.length === 0) return recommendations;

  const settings = normalizeAiSettings(state.settingsRepo?.getAll() ?? {});
  const aiApiKey = settings.aiApiKey;
  if (!aiApiKey) {
    return recommendations.map((rec) => ({
      ...rec,
      evidence: {
        ...rec.evidence,
        explanationSource: 'rule',
        aiFallbackReason: '未配置 AI Key，广告建议解释使用规则引擎',
      },
    }));
  }

  const provider = new OpenAICompatibleProvider(buildAiProviderConfig(settings));
  const explainer = new AdActionReasonExplainer(provider);
  const enhanced: ActionRecommendation[] = [];
  for (const rec of recommendations) {
    try {
      const explanation = await explainer.explain({
        actionType: rec.actionType,
        entityName: rec.entityName,
        currentMetrics: {
          impressions: rec.evidence.impressions,
          clicks: rec.evidence.clicks,
          cost: rec.evidence.cost,
          orders: rec.evidence.orders,
          sales: rec.evidence.sales,
          acos: rec.evidence.acos,
        },
        recommendedAction: rec.recommendedValue || rec.actionType,
      });
      enhanced.push({
        ...rec,
        reason: explanation.source === 'ai' && explanation.explanation ? explanation.explanation : rec.reason,
        evidence: {
          ...rec.evidence,
          explanationSource: explanation.source,
          aiExplanation: explanation.explanation,
          aiRiskWarnings: explanation.riskWarnings,
          aiAlternativeSuggestions: explanation.alternativeSuggestions,
          aiFallbackReason: explanation.aiFallbackReason,
          aiModel: settings.aiModel,
        },
      });
    } catch (error) {
      enhanced.push({
        ...rec,
        evidence: {
          ...rec.evidence,
          explanationSource: 'rule',
          aiFallbackReason: `AI 广告解释异常：${error instanceof Error ? error.message : String(error)}，使用规则解释`,
        },
      });
    }
  }
  return enhanced;
}

async function handleApproveRecommendation(recommendationId: number): Promise<void> {
  state.recommendationRepo?.updateStatus(recommendationId, 'approved');
}

async function handleRejectRecommendation(recommendationId: number): Promise<void> {
  state.recommendationRepo?.updateStatus(recommendationId, 'rejected');
}

function handleGetRecommendations(filter: any = []): any[] {
  const request = Array.isArray(filter) ? {} : (filter || {});
  const limit = Number.isFinite(Number(request.limit)) ? Math.max(1, Math.min(500, Number(request.limit))) : 100;
  const status = typeof request.status === 'string' && request.status.trim() ? request.status.trim() : undefined;

  if (state.recommendationRepo?.findByFilter) {
    const normalizedFilter = {
      storeName: typeof request.storeName === 'string' && request.storeName.trim() ? request.storeName.trim() : undefined,
      marketplaceCode: typeof request.marketplaceCode === 'string' && request.marketplaceCode.trim() ? request.marketplaceCode.trim() : undefined,
      asin: typeof request.asin === 'string' && request.asin.trim() ? request.asin.trim() : undefined,
      status,
      dateFrom: typeof request.dateFrom === 'string' && request.dateFrom.trim() ? request.dateFrom.trim() : request.date,
      dateTo: typeof request.dateTo === 'string' && request.dateTo.trim() ? request.dateTo.trim() : request.date,
      page: 0,
      pageSize: limit,
    };
    return state.recommendationRepo.findByFilter(normalizedFilter).items;
  }

  if (request.date && status) {
    return state.recommendationRepo?.findByDateAndStatus(request.date, status, limit) || [];
  }

  return [];
}

function handleExportAdReadbackEvidence(input: AdReadbackEvidenceInput): { jsonPath: string; markdownPath: string; status: string; readyForVerifier: boolean } {
  const evidence = buildAdReadbackEvidence(input || {});
  const exportDir = path.join(EXPORTS_DIR, 'ad-readback-evidence');
  fs.mkdirSync(exportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(exportDir, `real-ad-execution-readback-${stamp}.json`);
  const markdownPath = jsonPath.replace(/\.json$/i, '.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  fs.writeFileSync(markdownPath, adReadbackEvidenceToMarkdown(evidence, jsonPath), 'utf8');
  return {
    jsonPath,
    markdownPath,
    status: evidence.status,
    readyForVerifier: evidence.status === 'PASS',
  };
}

async function handleExecuteRecommendation(recommendationId: number): Promise<void> {
  const recommendation = state.recommendationRepo?.findById(recommendationId);
  if (!recommendation) {
    throw new Error('Recommendation not found');
  }

  if (recommendation.status !== 'approved') {
    throw new Error('Recommendation must be approved before execution');
  }

  const executionResult = buildAdExecutionUnavailableResult(
    recommendation,
    '真实广告执行器尚未接入可验证回读。为避免误改广告账户或产生假成功记录，本次执行已阻断。',
  );
  const executionOutcome = getRecommendationExecutionOutcome(executionResult);

  const screenshotBefore = await tryCaptureExecutionScreenshot('before');
  const screenshotAfter = await tryCaptureExecutionScreenshot('after');

  // Log execution
  state.actionLogRepo?.insert(buildActionLogForExecution({
    recommendationId,
    recommendation,
    executionResult,
    outcome: executionOutcome,
    screenshotBefore,
    screenshotAfter,
  }));

  if (executionOutcome.shouldMarkExecuted) {
    state.recommendationRepo?.updateStatus(recommendationId, executionOutcome.recommendationStatus);
    return;
  }

  throw new Error(executionResult.error || '广告执行未通过回读确认，建议状态保持为 approved。');
}

// ============================================================================
// Daily Reports
// ============================================================================

async function runDailyReportGeneration(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Get summary data
  const totalRevenue = state.adMetricsRepo?.getTotalSales(today) || 0;
  const totalCost = state.adMetricsRepo?.getTotalCost(today) || 0;
  const avgAcos = totalRevenue > 0 ? totalCost / totalRevenue : 0;
  const totalClicks = state.adMetricsRepo?.getTotalClicks(today) || 0;
  const totalOrders = state.adMetricsRepo?.getTotalOrders(today) || 0;

  const summary = {
    date: today,
    storeName: state.currentStore || 'unknown',
    salesOverview: {
      totalRevenue,
      totalOrders,
      avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
      comparedToYesterday: 0,
    },
    adPerformance: {
      totalCost,
      totalSales: totalRevenue,
      avgAcos,
      totalClicks,
      comparedToYesterday: 0,
    },
    recommendationsSummary: {
      total: state.recommendationRepo?.countByDate(today) || 0,
      auto: state.recommendationRepo?.countByDateAndStatus(today, 'executed') || 0,
      pending: state.recommendationRepo?.countByDateAndStatus(today, 'pending') || 0,
      executed: state.recommendationRepo?.countByDateAndStatus(today, 'approved') || 0,
    },
    inventoryAlerts: {
      outOfStock: 0,
      lowStock: 0,
    },
    topRisks: [] as string[],
  };

  // Generate AI report if configured
  const settings = normalizeAiSettings(state.settingsRepo?.getAll() ?? {});
  if (settings.aiApiKey) {
    try {
      const provider = new OpenAICompatibleProvider(buildAiProviderConfig(settings));
      const reportGen = new DailyReportGenerator(provider);
      const report = await reportGen.generate(summary);

      // Save report
      const reportPath = path.join(REPORTS_DIR, `daily_${today}.json`);
      fs.writeFileSync(reportPath, report);
      console.log(`[Scheduler] Daily report generated: ${reportPath}`);
    } catch (err) {
      console.error('[Scheduler] AI report generation failed:', err);
    }
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

function registerIpcHandlers(): void {
  // App
  ipcMain.handle('app:get-version', () => '1.5.0');
  ipcMain.handle('app:get-state', () => ({
    isLoggedIn: state.isLoggedIn,
    currentStore: state.currentStore,
  }));

  // Settings
  ipcMain.handle('settings:get', () => normalizeAiSettings(state.settingsRepo?.getAll() ?? {}));
  ipcMain.handle('settings:save', (_, settings) => {
    state.settingsRepo?.save(normalizeAiSettings(settings || {}));
    if (settings.ruleConfig) {
      state.ruleConfig = settings.ruleConfig;
    }
    return { success: true };
  });
  ipcMain.handle('settings:test-ai', (_, settings) => handleTestAiSettings(settings || {}));
  ipcMain.handle('settings:get-rule-config', () => state.ruleConfig);
  ipcMain.handle('settings:save-rule-config', (_, config: RuleConfig) => {
    state.settingsRepo?.saveRuleConfig(config);
    state.ruleConfig = config;
  });

  // Browser
  ipcMain.handle('browser:login', (_, { username, password }) =>
    handleBrowserLogin(username, password)
  );
  ipcMain.handle('browser:logout', () => handleBrowserLogout());
  ipcMain.handle('browser:screenshot', (_, label) => handleScreenshot(label));
  ipcMain.handle('browser:is-ready', () => state.browserController !== null);

  // Reports
  ipcMain.handle('report:download', (_, dateRange) =>
    handleDownloadReport(dateRange)
  );
  ipcMain.handle('report:parse', (_, filePath) => handleParseReport(filePath));
  ipcMain.handle('v1_5:reports:collect-lingxing', (_, dateRange) =>
    handleCollectLingxingReports(dateRange)
  );
  ipcMain.handle('v1_5:reports:preflight-lingxing-collection', (_, dateRange) =>
    handlePreflightLingxingCollection(dateRange)
  );
  ipcMain.handle('v1_5:reports:export-lingxing-collection-preflight', (_, dateRange) =>
    handleExportLingxingCollectionPreflight(dateRange)
  );
  ipcMain.handle('v1_5:reports:retry-lingxing-report', (_, { dateRange, reportType }) =>
    handleRetryLingxingReport(dateRange, reportType)
  );
  ipcMain.handle('v1_5:reports:run-lingxing-canary-report', (_, { dateRange, reportType }) =>
    handleRunLingxingCanaryReport(dateRange, reportType)
  );
  ipcMain.handle('v1_5:reports:export-acceptance-audit', (_, { batchId, diagnosticId }) =>
    handleExportLingxingAcceptanceAudit(batchId, diagnosticId)
  );
  ipcMain.handle('v1_5:reports:diagnose-download-center', (_, dateRange) =>
    handleDiagnoseLingxingDownloadCenter(dateRange)
  );
  ipcMain.handle('v1_5:reports:export-download-center-diagnostic-bundle', (_, { diagnosticId }) =>
    handleExportDownloadCenterDiagnosticBundle(diagnosticId)
  );
  ipcMain.handle('v1_5:reports:export-download-center-page-model-draft', (_, { diagnosticId }) =>
    handleExportDownloadCenterPageModelDraft(diagnosticId)
  );
  ipcMain.handle('v1_5:reports:export-download-center-page-model-enablement-audit', (_, { dateRange, diagnosticId }) =>
    handleExportDownloadCenterPageModelEnablementAudit(dateRange, diagnosticId)
  );
  ipcMain.handle('v1_5:reports:get-download-center-page-model', () =>
    handleGetDownloadCenterPageModel()
  );
  ipcMain.handle('v1_5:reports:save-download-center-page-model', (_, model) =>
    handleSaveDownloadCenterPageModel(model)
  );
  ipcMain.handle('v1_5:reports:reset-download-center-page-model', () =>
    handleResetDownloadCenterPageModel()
  );
  ipcMain.handle('v1_5:reports:open-path', (_, targetPath) =>
    handleOpenPath(targetPath)
  );
  ipcMain.handle('report:select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'Excel Files', extensions: ['xlsx', 'xls', 'csv'] },
      ],
    });
    return result.filePaths[0] || null;
  });

  // Recommendations
  ipcMain.handle('recommendations:get', (_, filter) => handleGetRecommendations(filter));
  ipcMain.handle('recommendations:generate', (_, filter) => runRecommendationGeneration(filter));
  ipcMain.handle('recommendations:approve', (_, id) => handleApproveRecommendation(id));
  ipcMain.handle('recommendations:reject', (_, id) => handleRejectRecommendation(id));
  ipcMain.handle('recommendations:execute', (_, id) => handleExecuteRecommendation(id));
  ipcMain.handle('recommendations:export-ad-readback-evidence', (_, input) => handleExportAdReadbackEvidence(input));

  // Scheduler
  ipcMain.handle('scheduler:get-tasks', () => state.scheduler?.getTasks() || []);
  ipcMain.handle('scheduler:set-task-enabled', (_, { name, enabled }) => {
    state.scheduler?.setTaskEnabled(name, enabled);
  });
  ipcMain.handle('scheduler:run-now', async (_, name: TaskName) => {
    await state.scheduler?.runNow(name);
  });

  // Products
  ipcMain.handle('products:get', () => state.productRepo?.findAll() || []);
  ipcMain.handle('products:add', (_, product) => {
    state.productRepo?.insert(product);
  });

  // Logs
  ipcMain.handle('logs:get', (_, { dateFrom, dateTo, limit }) =>
    state.actionLogRepo?.findByDateRange(dateFrom, dateTo, limit) || []
  );

  // Metrics
  ipcMain.handle('metrics:get-recent', (_, days) =>
    state.adMetricsRepo?.getRecent(days) || []
  );
  ipcMain.handle('metrics:get-summary', (_, date) => ({
    totalSales: state.adMetricsRepo?.getTotalSales(date) || 0,
    totalCost: state.adMetricsRepo?.getTotalCost(date) || 0,
    totalClicks: state.adMetricsRepo?.getTotalClicks(date) || 0,
    totalOrders: state.adMetricsRepo?.getTotalOrders(date) || 0,
    avgAcos: 0,
  }));

  ipcMain.handle('v1_5:keywords:build-opportunities', (_, { metrics, options }) =>
    handleBuildKeywordOpportunities(metrics, options)
  );
  ipcMain.handle('v1_5:keywords:import-report', (_, { filePath, source, duplicateStrategy }) =>
    handleImportKeywordMetrics(filePath, source, duplicateStrategy)
  );
  ipcMain.handle('v1_5:keywords:export-diagnostics', (_, { diagnostics }) =>
    handleExportKeywordDiagnostics(diagnostics)
  );
  ipcMain.handle('v1_5:listing:analyze-coverage', (_, { listing, keywords }) =>
    handleAnalyzeListingCoverage(listing, keywords)
  );
  ipcMain.handle('v1_5:listing:import-content', (_, { filePath }) =>
    handleImportListingContent(filePath)
  );
  ipcMain.handle('v1_5:listing:extract-from-lingxing', () =>
    handleExtractListingFromLingxing()
  );
  ipcMain.handle('v1_5:listing:open-and-extract-from-lingxing', (_, input) =>
    handleOpenLingxingListingAndExtract(input)
  );
  ipcMain.handle('v1_5:listing:probe-detail-and-extract', (_, input) =>
    handleProbeLingxingListingDetailAndExtract(input)
  );
  ipcMain.handle('v1_5:listing:build-suggestions', (_, { listing, opportunities }) =>
    handleBuildListingSuggestions(listing, opportunities)
  );
  ipcMain.handle('v1_5:listing:update-suggestion-status', (_, { id, status }) =>
    handleUpdateListingSuggestionStatus(id, status)
  );
  ipcMain.handle('v1_5:listing:generate-drafts', (_, { suggestions }) =>
    handleGenerateListingDrafts(suggestions)
  );
  ipcMain.handle('v1_5:listing:export-suggestions', (_, { suggestions, format }) =>
    handleExportListingSuggestions(suggestions, format)
  );
  ipcMain.handle('v1_5:listing:export-drafts', (_, { drafts, format }) =>
    handleExportListingDrafts(drafts, format)
  );
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(async () => {
  try {
    console.log('[App] ready');
    await initApp();
    registerIpcHandlers();
    console.log('[App] ipc-ready');
    createWindow();
    console.log('[App] window-created');

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    console.error('[App] startup failed:', error);
    throw error;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Cleanup
  if (state.browserController) {
    await state.browserController.close();
  }
  if (state.scheduler) {
    state.scheduler.stop();
  }
  if (state.db) {
    state.db.close();
  }
});
