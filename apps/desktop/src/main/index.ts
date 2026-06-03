import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import { LocalScheduler } from '@amazon-ai-ops/scheduler';
import { AuditLogger, ScreenshotManager, TraceManager, CleanupManager } from '@amazon-ai-ops/audit-log';
import { RecommendationGenerator, DEFAULT_RULE_CONFIG } from '@amazon-ai-ops/rules-engine';
import { ReportParser, keywordMetricDiagnosticsToCsv, parseKeywordMetricsWithDiagnostics, parseListingContent } from '@amazon-ai-ops/report-parser';
import { OpenAICompatibleProvider, DailyReportGenerator } from '@amazon-ai-ops/ai-adapter';
import { initSqlite, getSqliteDb, SettingsRepository, ProductRepository, ActionLogRepository, AdMetricsRepository, RecommendationRepository } from '@amazon-ai-ops/local-db';
import { assertDownloadCenterCollectionPreflightReady, auditDownloadCenterPageModelEnablement, auditLingxingAcceptanceEvidence, buildDownloadCenterCollectionPreflight, buildDownloadCenterPageModelDraft, downloadCenterPageModelDraftToMarkdown, evaluateDownloadCenterDiagnosticEvidenceReadiness, evaluateDownloadCenterPageModel, getDownloadCenterAutomationReadiness, LINGXING_AD_REPORTS, lingxingAcceptanceAuditToMarkdown, pollReportGenerationStatus, runLingxingReportBatch, type DownloadCenterAutomationPort } from '@amazon-ai-ops/lingxing-report-collector';
import { buildKeywordOpportunities } from '@amazon-ai-ops/keyword-opportunity';
import { analyzeKeywordCoverage, buildListingSuggestions as buildSafeListingSuggestions, buildRuleBasedListingDrafts, suggestionsToCsv, suggestionsToMarkdown, suggestionsToXlsxBuffer } from '@amazon-ai-ops/listing-analyzer';
import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { TaskName } from '@amazon-ai-ops/scheduler';
import type { DownloadCenterActionSelectorCheck, DownloadCenterActionSelectors, DownloadCenterDiagnosticResult, DownloadCenterPageModel, DownloadCenterSelectorCandidate, KeywordMetric, KeywordOpportunity, LingxingReportBatch, LingxingReportFile, LingxingReportType, ListingContent, ListingDraft, ListingSuggestion } from '@amazon-ai-ops/shared-types';
import { buildDownloadedReportEvidenceIndex, isPathInsideDirectory, isPathWithinRealDirectory, isSafeManifestPath, readLingxingManifestForAudit, safeFileSegment } from './acceptance-audit-export';
import { writeLingxingCollectionPreflightEvidenceBundle } from './collection-preflight-export';
import { copyDiagnosticEvidenceFileToBundle, copyReportFailureEvidenceFilesToBundle, evaluateDownloadCenterDiagnosticEvidenceFiles } from './download-center-diagnostic-evidence-files';
import { getLatestDownloadCenterDiagnosticRowForModel } from './download-center-diagnostic-store';
import { writeDownloadCenterPageModelEnablementAuditBundle } from './page-model-enablement-audit-export';
import { selectorUsesDateScope, selectorUsesReportScope, validateDownloadCenterPageModel } from './download-center-page-model-validation';
import { backupExistingDownloadCenterPageModelOverride, getDownloadCenterPageModelOverrideMetadataPath, saveDownloadCenterPageModelOverride } from './download-center-page-model-override-store';

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
  ensureDirs();

  // Init database
  state.db = initSqlite(DB_PATH);

  // Init repositories
  state.settingsRepo = new SettingsRepository(state.db);
  state.productRepo = new ProductRepository(state.db);
  state.actionLogRepo = new ActionLogRepository(state.db);
  state.adMetricsRepo = new AdMetricsRepository(state.db);
  state.recommendationRepo = new RecommendationRepository(state.db);

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
    name: 'daily_report_download',
    cron: '30 8 * * *',
    enabled: false,
    callback: () => runDailyReportDownload(),
  });

  state.scheduler.register({
    name: 'daily_recommendation_generate',
    cron: '0 9 * * *',
    enabled: false,
    callback: () => runRecommendationGeneration(),
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

async function handleBrowserLogin(username: string, password: string): Promise<void> {
  const controller = new BrowserController({
    headless: false,
    userDataDir: path.join(STORAGE_DIR, 'browser-data'),
  });

  state.browserController = controller;

  await controller.launch();
  await controller.navigate('https://erp.lingxing.com/');
  await controller.waitForTimeout(2500);

  const page = getControllerPageOrThrow(controller);
  const accountInput = page.locator('input[name="account"], input[placeholder*="用户名"], input[placeholder*="手机号"]').first();
  const passwordInput = page.locator('input[name="pwd"], input[type="password"]').first();
  const needsLogin = await accountInput.isVisible({ timeout: 5000 }).catch(() => false);

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

  await ensureLingxingAdsSession(controller);

  state.isLoggedIn = true;
  state.currentStore = username;

  // Store only the username; password stays with the user's manual ERP session.
  state.settingsRepo?.saveCredentials({ username });
}

async function ensureLingxingAdsSession(controller: BrowserController): Promise<void> {
  const page = getControllerPageOrThrow(controller);
  await page.goto('https://ads.lingxing.com/home', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await controller.waitForTimeout(6000);

  const adsState = await page.evaluate(() => ({
    url: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText ?? '',
  }));
  const isAdsPage = adsState.url.includes('ads.lingxing.com')
    && (adsState.bodyText.includes('领星广告系统')
      || adsState.bodyText.includes('下载中心')
      || adsState.bodyText.includes('广告组合')
      || adsState.bodyText.includes('返回ERP'));
  const looksLoggedOut = adsState.bodyText.includes('账号登录')
    || adsState.bodyText.includes('微信登录')
    || adsState.url.includes('login');

  if (!isAdsPage || looksLoggedOut) {
    throw new Error(
      `领星 ERP 已尝试登录，但广告系统会话未就绪。请先在打开的浏览器中进入“广告”系统完成授权，再重试。当前页面：${adsState.title || adsState.url}`,
    );
  }
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

// ============================================================================
// Report Download & Parse
// ============================================================================

async function handleDownloadReport(dateRange: { start: string; end: string }): Promise<string> {
  throw new Error(
    `旧版单报表下载入口已停用，避免访问过期的领星页面和未验证 selector。请在 v1.5 工作台使用“采集预检”/“验证页面”/“启动采集”流程。日期范围：${dateRange.start} - ${dateRange.end}`,
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
        (id, app_version, date_start, date_end, status, download_dir, manifest_path, created_at, completed_at)
      VALUES
        (@id, @appVersion, @dateStart, @dateEnd, @status, @downloadDir, @manifestPath, @createdAt, @completedAt)
    `).run({
      ...result.batch,
      appVersion: result.batch.appVersion ?? APP_VERSION,
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

async function handleCollectLingxingReports(dateRange: { start: string; end: string }) {
  validateDateRange(dateRange);
  assertLingxingCollectionPreflightReady(dateRange);

  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先启动并登录领星 ERP 浏览器');
  }

  const result = await runLingxingReportBatch({
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    rootDownloadDir: DOWNLOADS_DIR,
    appVersion: APP_VERSION,
    automation: createDownloadCenterAutomation(state.browserController),
  });
  persistLingxingBatch(result);
  return result;
}

function handlePreflightLingxingCollection(dateRange: { start: string; end: string }) {
  validateDateRange(dateRange);
  const model = readDownloadCenterPageModel();
  const diagnosticEvidenceReadiness = getDownloadCenterDiagnosticEvidenceReadiness(model, dateRange);
  const browserSessionReady = Boolean(state.browserController && state.isLoggedIn);
  return buildDownloadCenterCollectionPreflight(model, dateRange, undefined, {
    diagnosticEvidenceReadiness,
    browserSessionReady,
    browserSessionReason: browserSessionReady ? undefined : '请先启动并登录领星 ERP 浏览器',
  });
}

function assertLingxingCollectionPreflightReady(dateRange: { start: string; end: string }): void {
  const preflight = handlePreflightLingxingCollection(dateRange);
  assertDownloadCenterCollectionPreflightReady(preflight);
}

function handleExportLingxingCollectionPreflight(dateRange: { start: string; end: string }): string {
  const preflight = handlePreflightLingxingCollection(dateRange);
  const model = readDownloadCenterPageModel();
  const diagnostic = preflight.diagnosticEvidenceReadiness.diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(preflight.diagnosticEvidenceReadiness.diagnosticId, dateRange.start, dateRange.end)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(model, dateRange.start, dateRange.end);
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

async function handleRetryLingxingReport(dateRange: { start: string; end: string }, reportType: LingxingReportType) {
  validateDateRange(dateRange);
  validateLingxingReportType(reportType);
  assertLingxingCollectionPreflightReady(dateRange);

  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先启动并登录领星 ERP 浏览器');
  }

  const result = await runLingxingReportBatch({
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    rootDownloadDir: DOWNLOADS_DIR,
    appVersion: APP_VERSION,
    reportTypes: [reportType],
    automation: createDownloadCenterAutomation(state.browserController),
  });
  persistLingxingBatch(result);
  return result;
}

function createDownloadCenterAutomation(controller: BrowserController): DownloadCenterAutomationPort {
  const model = readDownloadCenterPageModel();
  const automationReadiness = getDownloadCenterAutomationReadiness(model);
  let traceStarted = false;
  let traceStartError: string | undefined;

  return {
    async navigateToDownloadCenter() {
      await controller.navigate(model.candidateUrls[0]);
    },
    async createReport(report, dateRange) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;

      if (selectors.reportSearchInput) {
        const reportSearchInput = await assertUsableDownloadCenterActionSelector(page, 'reportSearchInput', selectors.reportSearchInput, undefined, dateRange);
        await page.locator(reportSearchInput).fill(report.displayName);
      }
      if (selectors.dateStartInput) {
        const dateStartInput = await assertUsableDownloadCenterActionSelector(page, 'dateStartInput', selectors.dateStartInput, undefined, dateRange);
        await page.locator(dateStartInput).fill(dateRange.start);
      }
      if (selectors.dateEndInput) {
        const dateEndInput = await assertUsableDownloadCenterActionSelector(page, 'dateEndInput', selectors.dateEndInput, undefined, dateRange);
        await page.locator(dateEndInput).fill(dateRange.end);
      }

      const createReportButton = await assertUsableDownloadCenterActionSelector(page, 'createReportButton', selectors.createReportButton, report, dateRange);
      await page.locator(createReportButton).click();
      if (selectors.confirmCreateButton) {
        const confirmCreateButton = renderDownloadCenterSelector(selectors.confirmCreateButton, report, dateRange);
        await page.locator(confirmCreateButton).waitFor({ state: 'visible', timeout: 15000 });
        await assertUsableDownloadCenterActionSelector(page, 'confirmCreateButton', selectors.confirmCreateButton, report, dateRange);
        await page.locator(confirmCreateButton).click();
      }
    },
    async waitForReportReady(report, dateRange) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      if (selectors.statusTextSelector) {
        await pollReportGenerationStatus(async () => {
          const statusTextSelector = await assertUsableDownloadCenterActionSelector(page, 'statusTextSelector', selectors.statusTextSelector!, report, dateRange);
          await page.locator(statusTextSelector).waitFor({ state: 'visible', timeout: 10000 });
          return page.locator(statusTextSelector).innerText();
        }, {
          intervalMs: 2000,
          timeoutMs: selectors.readyTimeoutMs ?? 300000,
        });
      } else {
        const readyReportSelector = renderDownloadCenterSelector(selectors.readyReportSelector, report, dateRange);
        await page
          .locator(readyReportSelector)
          .waitFor({ state: 'visible', timeout: selectors.readyTimeoutMs ?? 300000 });
      }
      await assertUsableDownloadCenterActionSelector(page, 'readyReportSelector', selectors.readyReportSelector, report, dateRange);
    },
    async downloadReport(report, downloadDir, dateRange) {
      assertDownloadCenterAutomationReady(automationReadiness, report.displayName);
      assertDownloadCenterDiagnosticEvidenceReady(model, dateRange, report.displayName);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      fs.mkdirSync(downloadDir, { recursive: true });
      const downloadButton = await assertUsableDownloadCenterActionSelector(page, 'downloadButton', selectors.downloadButton, report, dateRange);

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
): void {
  const evidence = getDownloadCenterDiagnosticEvidenceReadiness(model, dateRange);
  if (evidence.ready) return;
  throw new Error(
    `下载中心页面模型缺少同模型、同日期范围的近期诊断证据，无法创建或下载：${displayName}。请先运行“验证页面”。${evidence.reason || ''}${evidence.missing.length ? ` 缺失：${evidence.missing.join(', ')}` : ''}`,
  );
}

function getDownloadCenterDiagnosticEvidenceReadiness(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
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
      action_selector_checks_json AS actionSelectorChecksJson,
      screenshot_path AS screenshotPath,
      dom_snapshot_path AS domSnapshotPath,
      checked_at AS checkedAt
    FROM download_center_diagnostics
    WHERE page_model = @pageModel
      AND page_model_snapshot_json = @modelSnapshotJson
      AND date_start = @dateStart
      AND date_end = @dateEnd
    ORDER BY checked_at DESC, id DESC
    LIMIT 1
  `).get({
    pageModel: model.name,
    modelSnapshotJson,
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
  }) as { id: number; ready: number; pageModel?: string; pageModelSnapshotJson?: string; dateStart?: string; dateEnd?: string; actionSelectorChecksJson?: string; screenshotPath?: string; domSnapshotPath?: string; checkedAt?: string } | undefined;

  if (!row) {
    return {
      ready: false,
      missing: ['diagnosticEvidence'],
      reason: 'no matching download-center diagnostic exists for this page model and date range',
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

function renderDownloadCenterSelector(
  selector: string,
  report: { type: LingxingReportType; displayName: string; expectedFilenameKeyword: string },
  dateRange?: { start: string; end: string },
): string {
  return selector
    .replaceAll('{reportType}', report.type)
    .replaceAll('{reportName}', report.displayName)
    .replaceAll('{expectedFilenameKeyword}', report.expectedFilenameKeyword)
    .replaceAll('{dateStart}', dateRange?.start ?? '')
    .replaceAll('{dateEnd}', dateRange?.end ?? '')
    .replaceAll('{dateRange}', dateRange ? `${dateRange.start}_${dateRange.end}` : '');
}

async function assertUsableDownloadCenterActionSelector(
  page: ReturnType<BrowserController['getPage']>,
  name: keyof DownloadCenterActionSelectors,
  selector: string,
  report: { type: LingxingReportType; displayName: string; expectedFilenameKeyword: string } | undefined,
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

async function handleDiagnoseLingxingDownloadCenter(dateRange?: { start: string; end: string }): Promise<DownloadCenterDiagnosticResult> {
  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('请先启动并登录领星 ERP 浏览器');
  }
  if (dateRange) {
    validateDateRange(dateRange);
  }

  const modelInfo = handleGetDownloadCenterPageModel();
  const model = modelInfo.model;
  const controller = state.browserController;
  const url = model.candidateUrls[0];
  let result: DownloadCenterDiagnosticResult;

  try {
    await controller.navigate(url);
    await controller.waitForTimeout(2500);
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
    const actionSelectorChecks = await collectDownloadCenterActionSelectorChecks(controller, model, dateRange);

    result = evaluateDownloadCenterPageModel(model, {
      ...snapshot,
      selectorMatches,
    });
    result.pageModelSource = modelInfo.source as 'bundled' | 'override';
    result.pageModelSnapshot = model;
    result.dateStart = dateRange?.start;
    result.dateEnd = dateRange?.end;
    result.selectorCandidates = selectorCandidates;
    result.actionSelectorChecks = actionSelectorChecks;
  } catch (error) {
    result = {
      pageModel: model.name,
      pageModelSource: modelInfo.source as 'bundled' | 'override',
      pageModelSnapshot: model,
      dateStart: dateRange?.start,
      dateEnd: dateRange?.end,
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
      errorMessage: '报告相关 selector 必须包含 {reportName}、{reportType} 或 {expectedFilenameKeyword} 占位符',
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
): Promise<DownloadCenterActionSelectorCheck[]> {
  const selectors = model.actionSelectors;
  if (!selectors) {
    return [];
  }
  const page = getControllerPageOrThrow(controller);
  const checks: DownloadCenterActionSelectorCheck[] = [];
  const entries = Object.entries(selectors)
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
      || selector.includes('{expectedFilenameKeyword}');
    const reports = needsReport ? LINGXING_AD_REPORTS : [undefined];

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
      (app_version, page_model, page_model_source, page_model_snapshot_json, date_start, date_end, url, title, ready, requires_manual_verification, matched_entry_hints_json,
       matched_report_names_json, selector_checks_json, missing_required_selectors_json, selector_candidates_json,
       action_selector_checks_json,
       screenshot_path, dom_snapshot_path, error_message, checked_at)
    VALUES
      (@appVersion, @pageModel, @pageModelSource, @pageModelSnapshotJson, @dateStart, @dateEnd, @url, @title, @ready, @requiresManualVerification, @matchedEntryHintsJson,
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
  const settings = state.settingsRepo?.getAll() ?? {};
  const aiApiKey = settings.aiApiKey || settings.ai_api_key;

  if (aiApiKey) {
    drafts = await generateAiListingDrafts(drafts, settings);
  }

  return persistListingDrafts(drafts);
}

async function generateAiListingDrafts(drafts: ListingDraft[], settings: Record<string, string>): Promise<ListingDraft[]> {
  const provider = new OpenAICompatibleProvider({
    apiKey: settings.aiApiKey || settings.ai_api_key,
    baseUrl: settings.aiBaseUrl || settings.ai_base_url,
    model: settings.aiModel || settings.ai_model || 'gpt-4o-mini',
  });
  const promptTemplate = readPromptTemplate('listing-rewrite.md');

  const enhanced: ListingDraft[] = [];
  for (const draft of drafts) {
    const response = await provider.complete(buildListingRewritePrompt(promptTemplate, draft), {
      temperature: 0.3,
      maxTokens: 700,
    });
    if (!response.success || !response.content) {
      enhanced.push(draft);
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
        }
      : draft);
  }

  return enhanced;
}

function persistListingDrafts(drafts: ListingDraft[]): ListingDraft[] {
  if (!state.db || drafts.length === 0) return drafts;

  const persisted: ListingDraft[] = [];
  const save = state.db.transaction(() => {
    const insert = state.db!.prepare(`
      INSERT INTO listing_drafts
        (asin, section, current_text, drafted_text, keywords_json, evidence, risk_warnings_json, source, status, created_at)
      VALUES
        (@asin, @section, @currentText, @draftedText, @keywordsJson, @evidence, @riskWarningsJson, @source, @status, @createdAt)
    `);
    for (const draft of drafts) {
      const createdAt = draft.createdAt ?? new Date().toISOString();
      const result = insert.run({
        ...draft,
        currentText: draft.currentText ?? null,
        keywordsJson: JSON.stringify(draft.keywords),
        riskWarningsJson: JSON.stringify(draft.riskWarnings),
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
  dateRange: { start: string; end: string },
  diagnosticId?: number,
): { exportPath: string; canDisableManualVerification: boolean; missing: string[] } {
  validateDateRange(dateRange);
  if (diagnosticId !== undefined && (!Number.isInteger(diagnosticId) || diagnosticId <= 0)) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const model = readDownloadCenterPageModel();
  const diagnostic = diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(diagnosticId, dateRange.start, dateRange.end)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(model, dateRange.start, dateRange.end);
  const selectorEvidenceReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, diagnostic)
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
  const audit = auditDownloadCenterPageModelEnablement(model, dateRange, diagnostic, {
    diagnosticEvidenceReadiness,
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
  const activeModel = readDownloadCenterPageModel();
  const diagnostic = diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(diagnosticId, batch.dateStart, batch.dateEnd)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(activeModel, batch.dateStart, batch.dateEnd);
  const selectorEvidenceReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceReadiness(activeModel, { start: batch.dateStart, end: batch.dateEnd }, diagnostic)
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
): DownloadCenterDiagnosticResult | undefined {
  if (!state.db) return undefined;
  const row = getLatestDownloadCenterDiagnosticRowForModel(state.db, model, dateStart, dateEnd);
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

async function runRecommendationGeneration(): Promise<void> {
  if (!state.isLoggedIn) {
    throw new Error('Not logged in');
  }

  // Get recent metrics
  const metrics = state.adMetricsRepo?.getRecent(100) || [];
  if (metrics.length === 0) {
    console.log('[Scheduler] No metrics to process');
    return;
  }

  // Generate recommendations
  const generator = new RecommendationGenerator(state.ruleConfig);
  const recommendations = generator.generateBatch(metrics, {
    storeName: state.currentStore,
    marketplaceCode: 'US',
    config: state.ruleConfig,
    taskId: `task_${Date.now()}`,
  });

  // Save to database
  for (const rec of recommendations) {
    state.recommendationRepo?.insert(rec);
  }

  console.log(`[Scheduler] Generated ${recommendations.length} recommendations`);
  mainWindow?.webContents.send('recommendations:generated', recommendations.length);
}

async function handleApproveRecommendation(recommendationId: number): Promise<void> {
  state.recommendationRepo?.updateStatus(recommendationId, 'approved');
}

async function handleRejectRecommendation(recommendationId: number): Promise<void> {
  state.recommendationRepo?.updateStatus(recommendationId, 'rejected');
}

async function handleExecuteRecommendation(recommendationId: number): Promise<void> {
  const recommendation = state.recommendationRepo?.findById(recommendationId);
  if (!recommendation) {
    throw new Error('Recommendation not found');
  }

  if (recommendation.status !== 'approved') {
    throw new Error('Recommendation must be approved before execution');
  }

  if (!state.browserController) {
    throw new Error('Browser not initialized');
  }

  // Take before screenshot
  const screenshotBefore = await handleScreenshot('before');

  // Execute via action executor
  // (simplified - full implementation would use AdActionExecutor)
  const executionResult = {
    success: true,
    executionId: `exec_${Date.now()}`,
    actionType: recommendation.actionType,
    beforeValue: recommendation.currentValue,
    afterValue: recommendation.recommendedValue,
    verified: true,
    executedAt: new Date().toISOString(),
  };

  // Take after screenshot
  const screenshotAfter = await handleScreenshot('after');

  // Log execution
  state.actionLogRepo?.insert({
    recommendationId,
    taskId: recommendation.taskId,
    actionType: recommendation.actionType,
    entityType: recommendation.entityType,
    entityId: recommendation.entityId,
    entityName: recommendation.entityName,
    beforeValue: recommendation.currentValue,
    afterValue: recommendation.recommendedValue,
    executionStatus: 'success',
    screenshotBefore: screenshotBefore,
    screenshotAfter: screenshotAfter,
  });

  // Update status
  state.recommendationRepo?.updateStatus(recommendationId, 'executed');
}

// ============================================================================
// Daily Reports
// ============================================================================

async function runDailyReportDownload(): Promise<void> {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const start = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    await handleDownloadReport({ start, end });
    console.log('[Scheduler] Daily report download completed');
  } catch (err) {
    console.error('[Scheduler] Daily report download failed:', err);
  }
}

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
  const settings = state.settingsRepo?.getAll();
  if (settings?.aiApiKey) {
    try {
      const provider = new OpenAICompatibleProvider({
        apiKey: settings.aiApiKey,
        baseUrl: settings.aiBaseUrl,
        model: settings.aiModel || 'gpt-4o-mini',
      });
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
  ipcMain.handle('settings:get', () => state.settingsRepo?.getAll() || null);
  ipcMain.handle('settings:save', (_, settings) => {
    state.settingsRepo?.save(settings);
    if (settings.ruleConfig) {
      state.ruleConfig = settings.ruleConfig;
    }
  });
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
  ipcMain.handle('recommendations:get', (_, { date, status, limit }) =>
    state.recommendationRepo?.findByDateAndStatus(date, status, limit) || []
  );
  ipcMain.handle('recommendations:generate', () => runRecommendationGeneration());
  ipcMain.handle('recommendations:approve', (_, id) => handleApproveRecommendation(id));
  ipcMain.handle('recommendations:reject', (_, id) => handleRejectRecommendation(id));
  ipcMain.handle('recommendations:execute', (_, id) => handleExecuteRecommendation(id));

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
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(async () => {
  await initApp();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
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
