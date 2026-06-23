const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('./playwright-loader');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function startStaticServer(directory) {
  const mimeTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
  ]);

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
    const targetPath = path.normalize(path.join(directory, pathname));
    if (!targetPath.startsWith(directory)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes.get(path.extname(targetPath)) || 'application/octet-stream' });
    fs.createReadStream(targetPath).pipe(response);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/index.html`,
        close: () => server.close(),
      });
    });
  });
}

async function expectVisible(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor({ timeout: 5000 });
}

async function expectNotInBody(page, text) {
  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes(text)) {
    fail(`Unexpected visible text: ${text}`);
  }
}

async function expandDetails(page, summaryText) {
  await page.getByText(summaryText, { exact: false }).first().waitFor({ timeout: 5000 });
  await page.evaluate((text) => {
    for (const details of document.querySelectorAll('details')) {
      const summary = details.querySelector('summary');
      if (summary?.textContent?.includes(text)) details.open = true;
    }
  }, summaryText);
}

async function main() {
  if (!fs.existsSync(rendererIndex)) {
    fail('Renderer build not found. Run pnpm --filter @amazon-ai-ops/desktop run build:renderer first', rendererIndex);
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const evidence = {
    generatedAt: new Date().toISOString(),
    rendererIndex,
    pages: {},
    actionLog: [],
    consoleErrors: [],
  };

  const server = await startStaticServer(rendererDir);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1480, height: 980 } });
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });

  await page.addInitScript(() => {
    window.__businessShellActions = [];
    window.electronAPI = {
      getState: async () => ({
        isLoggedIn: true,
        currentStore: 'SHC001',
        loginSession: { erpSessionReused: true, adsTitle: '仪表盘' },
      }),
      getBusinessBatchOptions: async () => [],
      getBusinessUiDataPipeline: async (scope) => ({
        scope: { ...scope, currency: 'USD' },
        generatedAt: new Date().toISOString(),
        collection: {
          status: 'partial',
          latestBatch: {
            id: 'batch_shell_smoke',
            status: 'completed',
            dateStart: scope.dateFrom,
            dateEnd: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            downloadDir: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke',
            manifestPath: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke\\manifest.json',
          },
          sourceBatchIds: ['batch_shell_smoke'],
          availableBatches: [],
          reportOptions: [
            { type: 'campaign', label: '广告活动报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'ad_group', label: '广告组报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'placement', label: '广告位报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'advertised_product', label: '广告（推广的商品）报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'auto_targeting', label: '自动投放报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'keyword', label: '关键词报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'product_targeting', label: '商品投放报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'user_search_term', label: '用户搜索词报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
          ],
          realReportFiles: [
            {
              id: 'file-keyword',
              reportType: 'keyword',
              displayName: '关键词报告',
              status: 'downloaded',
              filePath: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke\\keyword.xlsx',
              folderPath: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke',
              fileName: 'keyword.xlsx',
              fileSizeBytes: 20480,
              importedRows: 10,
            },
          ],
          evidencePaths: [],
          fileAudit: {
            totalFileRecords: 8,
            downloadedFileRecords: 8,
            existingFileRecords: 8,
            realReportFileCount: 8,
            importedRowCount: 80,
            rejectedEvidenceFileCount: 3,
            missingReportLabels: [],
            downloadDir: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke',
            manifestPath: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke\\manifest.json',
          },
          blockers: [],
          audit: {
            databaseReady: true,
            acceptedExtensions: ['.xlsx', '.xls', '.csv'],
            rejectedEvidenceExtensions: ['.json', '.png', '.html'],
            notes: ['smoke mock'],
          },
        },
        quant: {
          hasImportedMetrics: true,
          importedRows: 80,
          canonicalRows: 40,
          actionableRows: 30,
          breakdownRows: 40,
          summarySource: 'canonical_user_search_term',
          totalSpend: 170.25,
          totalSales: 350.5,
          totalOrders: 3,
          totalClicks: 120,
          totalImpressions: 10000,
          acos: 0.486,
          cvr: 0.025,
          cpc: 1.42,
          wastedSpend: 25,
          highRiskCount: 1,
          adObjectTimelines: [],
          diagnostics: [],
          blockers: [],
        },
        operations: { events: [], eventCount: 0, notes: [] },
        productContext: {
          productCount: 1,
          products: [
            {
              asin: 'B0SHELLSMOKE',
              title: 'Shell smoke product',
              productStage: 'scaling',
              status: 'active',
              cost: {
                purchaseCost: 13.5,
                firstLegCost: 1.2,
                fbaFee: 4.1,
                referralFeeRate: 0.15,
                minPrice: 29.99,
                targetNetMargin: 0.22,
                targetAcos: 0.35,
                targetTacos: 0.12,
              },
            },
          ],
          notes: ['smoke product context'],
        },
      }),
      getDeliveryReadiness: async () => ({
        available: false,
        path: null,
        exists: false,
        status: 'APP_NEEDS_WORK',
        appReady: false,
        manifestDriven: false,
        gates: [],
        gatesSummary: { total: 0, passed: 0, failed: 0 },
        missing: ['最终验收汇总尚未生成'],
        actionItems: ['运行最终验收。'],
        message: '最终验收汇总尚未生成',
      }),
      getProducts: async () => [
        {
          id: 1,
          asin: 'B0SHELLSMOKE',
          parent_asin: 'PARENT-SHELL',
          msku: 'MSKU-SHELL',
          sku: 'SKU-SHELL',
          title: 'Shell smoke product',
          product_stage: 'scaling',
          status: 'active',
          store_name: 'FT-US-US',
          marketplace_code: 'US',
        },
      ],
      saveProductConfig: async (payload) => {
        window.__businessShellActions.push({ type: 'saveProductConfig', payload });
        return {
          success: true,
          product: {
            id: 1,
            asin: payload.asin,
            store_name: payload.storeName,
            marketplace_code: payload.marketplaceCode,
          },
          cost: payload.cost || null,
        };
      },
      browserLogout: async () => ({ success: true }),
      getScheduledTasks: async () => [
        {
          name: 'daily_report_download',
          cron: '30 8 * * *',
          enabled: false,
          nextRun: '2026-06-13T08:30:00.000Z',
          lastRun: '',
          lastResult: '等待登录和真实报表范围',
        },
        {
          name: 'daily_recommendation_generate',
          cron: '0 9 * * *',
          enabled: false,
          nextRun: '2026-06-13T09:00:00.000Z',
          lastRun: '',
          lastResult: '等待真实数据门槛',
        },
      ],
      setTaskEnabled: async (name, enabled) => {
        window.__businessShellActions.push({ type: 'setTaskEnabled', name, enabled });
        return { success: true };
      },
      runTaskNow: async (name) => {
        window.__businessShellActions.push({ type: 'runTaskNow', name });
        return { success: true };
      },
    };
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });

  for (const text of [
    '运营总览',
    '数据与量化',
    '广告执行',
    '关键词与 Listing',
    '系统与交付',
    '当前操作范围',
    '批次',
    '报表',
    '指标',
    'ASIN',
    '待生成验收',
  ]) {
    await expectVisible(page, text);
  }
  const initialBodyText = await page.locator('body').innerText();
  if (!initialBodyText.includes('/ USD')) fail('Scope currency marker is missing from the compact range line');

  await expectNotInBody(page, 'v1.5 工作台');
  await expectNotInBody(page, 'APP_READY');
  await expectNotInBody(page, 'APP_NEEDS_WORK');
  await expectNotInBody(page, '¥');
  await expectNotInBody(page, 'pnpm run verify:ad-readback');
  await expectNotInBody(page, 'pnpm run verify:ai-live');
  await expectNotInBody(page, '套用已验证范围');

  const routes = [
    ['仪表盘', 'dashboard'],
    ['工作范围', 'operation-scope'],
    ['数据采集', 'data-collection'],
    ['数据导入与校验', 'data-import-validation'],
    ['广告量化', 'ad-quant'],
    ['优化建议', 'recommendations'],
    ['审批中心', 'approval'],
    ['执行回读', 'readback'],
    ['关键词机会', 'keyword-opportunities'],
    ['Listing 优化', 'listing-optimization'],
    ['产品配置', 'product-config'],
    ['定时任务', 'scheduler'],
    ['设置', 'settings'],
    ['交付验收', 'delivery'],
  ];

  for (const [label, key] of routes) {
    await page.locator('.app-sidebar').getByRole('button', { name: new RegExp(label) }).click();
    await page.getByRole('heading', { name: label, level: 2 }).waitFor();
    const screenshotPath = path.join(evidenceDir, `business-ui-shell-${key}-${runId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const bodyText = await page.locator('body').innerText();
    evidence.pages[key] = {
      label,
      screenshotPath,
      bodyTextSample: bodyText.slice(0, 1200),
    };
    if (bodyText.includes('v1.5 工作台')) fail('Old nested workbench text is visible', key);
    if (bodyText.includes('¥')) fail('RMB currency symbol is visible', key);
    if (bodyText.includes('APP_READY')) fail('False ready state is visible', key);
    if (bodyText.includes('APP_NEEDS_WORK')) fail('Raw APP_NEEDS_WORK state is visible', key);
    if (bodyText.includes('套用已验证范围')) fail('Misleading hard-coded verified scope preset is visible', key);
    if (bodyText.includes('pnpm run verify:ai-live')) fail('Settings command wall is visible', key);
    if (key === 'readback' && bodyText.includes('pnpm run verify:ad-readback')) {
      fail('Readback command wall is visible in primary UI');
    }
    if (key === 'recommendations') {
      await expandDetails(page, '生成范围、AI 配置和规则阈值');
      const expandedBodyText = await page.locator('body').innerText();
      for (const text of [
        '产品配置',
        '目标 ACOS',
        'TACOS',
      ]) {
        if (!expandedBodyText.includes(text)) fail('Recommendation product context text missing', text);
      }
    }
    if (key === 'scheduler') {
      for (const text of [
        '每日广告报表下载',
        '任务职责',
        '允许自动做',
        '禁止自动做',
        '待处理建议池',
        '需复核项不会自动批准',
        '定时任务不会自动改 bid、否词、暂停投放或批量操作 Amazon Ads。',
      ]) {
        if (!bodyText.includes(text)) fail('Scheduler safety boundary text missing', text);
      }
      if (bodyText.includes('daily_report_download')) {
        fail('Scheduler leaked raw daily_report_download task name instead of business label');
      }

      await page.getByRole('button', { name: '立即执行' }).first().click();
      await expectVisible(page, '确认立即执行');
      await expectVisible(page, '确认触发');
      const afterFirstClickActions = await page.evaluate(() => window.__businessShellActions || []);
      if (afterFirstClickActions.some((action) => action.type === 'runTaskNow')) {
        fail('Scheduler run-now action executed before confirmation');
      }
      await page.getByRole('button', { name: '取消' }).click();
      await page.getByRole('button', { name: '立即执行' }).first().click();
      await page.getByRole('button', { name: '确认触发' }).click();
      await expectVisible(page, '每日广告报表下载 已触发。真实报表、审批和回读门槛仍然生效。');
      const afterConfirmActions = await page.evaluate(() => window.__businessShellActions || []);
      if (!afterConfirmActions.some((action) => action.type === 'runTaskNow' && action.name === 'daily_report_download')) {
        fail('Scheduler run-now action did not execute after confirmation');
      }
      evidence.actionLog = afterConfirmActions;
    }
  }

  const activeNavCount = await page.locator('.nav-item[aria-current="page"]').count();
  if (activeNavCount !== 1) {
    fail('Exactly one active navigation item expected', String(activeNavCount));
  }

  await browser.close();
  server.close();

  if (evidence.consoleErrors.length > 0) {
    fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
  }

  const evidencePath = path.join(evidenceDir, `business-ui-shell-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] business UI shell smoke evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
