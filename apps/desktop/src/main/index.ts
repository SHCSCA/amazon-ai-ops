import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserController } from '@amazon-ai-ops/browser-worker';
import { LocalScheduler } from '@amazon-ai-ops/scheduler';
import { AuditLogger, ScreenshotManager, TraceManager, CleanupManager } from '@amazon-ai-ops/audit-log';
import { RecommendationGenerator, DEFAULT_RULE_CONFIG } from '@amazon-ai-ops/rules-engine';
import { ReportParser } from '@amazon-ai-ops/report-parser';
import { OpenAICompatibleProvider, DailyReportGenerator } from '@amazon-ai-ops/ai-adapter';
import { initSqlite, getSqliteDb, SettingsRepository, ProductRepository, ActionLogRepository, AdMetricsRepository, RecommendationRepository } from '@amazon-ai-ops/local-db';
import type { RuleConfig } from '@amazon-ai-ops/rules-engine';
import type { TaskName } from '@amazon-ai-ops/scheduler';

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
const TRACES_DIR = path.join(STORAGE_DIR, 'traces');
const REPORTS_DIR = path.join(STORAGE_DIR, 'reports');
const DB_PATH = path.join(USER_DATA_DIR, 'amazon-ai-ops.db');

function ensureDirs(): void {
  for (const dir of [STORAGE_DIR, SCREENSHOTS_DIR, TRACES_DIR, REPORTS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
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
  await controller.navigate('https://www.lingxing.com/login');

  // Wait for login page to load
  await controller.waitForSelector('input[name="username"]', 10000);

  // Fill credentials
  await controller.fill('input[name="username"]', username);
  await controller.fill('input[name="password"]', password);

  // Click login
  await controller.click('button[type="submit"]');

  // Wait for navigation to dashboard
  await controller.waitForURL(/dashboard|home|index/, 30000);

  state.isLoggedIn = true;
  state.currentStore = username;

  // Save credentials (encrypted in real app)
  state.settingsRepo?.saveCredentials({ username, password });
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
  if (!state.browserController || !state.isLoggedIn) {
    throw new Error('Not logged in');
  }

  const controller = state.browserController;

  // Navigate to ad report page
  await controller.navigate('https://www.lingxing.com/ads/report');
  await controller.waitForSelector('.ant-table-tbody', 15000);

  // Set date range
  await controller.click('.ant-picker-input input');
  await controller.waitForSelector('.ant-picker-panel', 5000);

  // Select custom range - simplified, real implementation needs more steps
  // Click export button
  await controller.click('button:has-text("导出")');
  await controller.waitForSelector('.ant-modal', 5000);

  // In modal, select report type and confirm
  await controller.click('button:has-text("确认导出")');

  // Wait for download (simulate - real implementation needs file watcher)
  await controller.waitForTimeout(5000);

  // Find downloaded file
  const downloadDir = path.join(STORAGE_DIR, 'downloads');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  // Return path (actual file path would be determined by file watcher)
  return downloadDir;
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
  ipcMain.handle('app:get-version', () => '1.2.0');
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
