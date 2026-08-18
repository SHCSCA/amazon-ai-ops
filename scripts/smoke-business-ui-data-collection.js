const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('./playwright-loader');
const {
  enterPreviewStore,
  installPreviewApiBridge,
  navigateLegacyRoute,
} = require('./business-ui-smoke-navigation');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function startProductionRendererServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const relative = decodeURIComponent(requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.replace(/^\/+/, ''));
    const target = path.resolve(rendererDir, relative);
    if (!target.startsWith(`${rendererDir}${path.sep}`) && target !== rendererIndex) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    const contentType = target.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : target.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'text/html; charset=utf-8';
    response.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(target).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    resolve({
      close: () => new Promise((done) => server.close(done)),
      url: `http://127.0.0.1:${address.port}/index.html?preview=1&scenario=diagnosis-ready`,
    });
  }));
}

async function main() {
  if (!fs.existsSync(rendererIndex)) {
    fail('Production renderer build not found', rendererIndex);
  }
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    kind: 'business-ui-data-collection-production-smoke',
    generatedAt: new Date().toISOString(),
    rendererIndex,
    consoleErrors: [],
    pageErrors: [],
    collectionCalls: [],
  };
  let browser;
  const server = await startProductionRendererServer();
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    await installPreviewApiBridge(page);
    await page.addInitScript(() => {
      const reportOptions = [
        ['campaign', '广告活动报告'],
        ['ad_group', '广告组报告'],
        ['placement', '广告位报告'],
        ['advertised_product', '广告商品报告'],
        ['auto_targeting', '自动投放报告'],
        ['keyword', '关键词报告'],
        ['product_targeting', '商品投放报告'],
        ['user_search_term', '用户搜索词报告'],
      ].map(([type, label]) => ({ type, label, status: 'missing', realFileAvailable: false, importedRows: 0 }));
      window.__dataCollectionProductionCalls = [];
      const store = {
        storeId: 'preview-store-shc001',
        browserProfileId: 'preview-profile-shc001',
        marketplace: 'US',
        currency: 'USD',
        displayName: 'SHC001-US',
        status: 'active',
        businessTimezone: 'America/Los_Angeles',
        createdAt: '2026-08-07T00:00:00.000Z',
        updatedAt: '2026-08-07T00:00:00.000Z',
      };
      const context = {
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        marketplace: 'US',
        currency: 'USD',
        businessTimezone: store.businessTimezone,
        businessDate: '2026-08-07',
        sessionGeneration: 1,
      };
      const view = { store, context, connections: [] };
      const overrides = {
        getBusinessUiDataPipeline: async (scope) => ({
          scope: { ...scope, currency: 'USD' },
          generatedAt: new Date().toISOString(),
          collection: {
            status: 'blocked',
            latestBatch: null,
            sourceBatchIds: [],
            availableBatches: [],
            reportOptions,
            realReportFiles: [],
            evidenceArtifacts: [],
            fileAudit: {
              totalFileRecords: 0,
              downloadedFileRecords: 0,
              existingFileRecords: 0,
              importedRowCount: 0,
              realReportFileCount: 0,
              rejectedEvidenceFileCount: 0,
              missingReportLabels: reportOptions.map((item) => item.label),
            },
            blockers: ['当前范围尚未采集报表。'],
            audit: {
              databaseReady: false,
              acceptedExtensions: ['.xlsx', '.xls', '.csv'],
              rejectedEvidenceExtensions: ['.json', '.png', '.html'],
              notes: ['生产构建采集 IPC 回归不写入正式库。'],
            },
          },
          quant: {
            hasImportedMetrics: false,
            importedRows: 0,
            summarySource: 'none',
            totalSpend: 0,
            totalSales: 0,
            totalOrders: 0,
            totalClicks: 0,
            totalImpressions: 0,
            acos: 0,
            cvr: 0,
            cpc: 0,
            wastedSpend: null,
            highRiskCount: 0,
            adObjectTimelines: [],
            diagnostics: [],
            blockers: ['尚未导入采集报表。'],
          },
          operations: { events: [], eventCount: 0, notes: [] },
          productContext: { products: [], productCount: 0, notes: [] },
        }),
        listLingxingCollectionJobs: async () => [],
        onLingxingCollectionProgress: () => () => undefined,
        collectLingxingReports: async (dateRange) => {
          window.__dataCollectionProductionCalls.push(JSON.parse(JSON.stringify(dateRange)));
          return { files: [], metricsImport: { errors: [], inserted: 0, parsedFiles: 0 } };
        },
      };
      const requiredApi = {
        ...overrides,
        missionControl: {
          query: async (request) => ({
            query: 'workspace-bootstrap',
            requestId: request.requestId,
            contextEpoch: request.contextEpoch,
            authoritativeContext: { ...context },
            completedAt: new Date().toISOString(),
            data: {
              capabilities: [
                ['collection.reports.view', 'view'],
                ['collection.reports.start', 'start'],
                ['collection.reports.resume', 'resume'],
                ['collection.reports.cancel', 'pause'],
                ['collection.reports.import', 'import'],
                ['collection.reports.open-artifact', 'view'],
              ].map(([capabilityId, action]) => ({
                capabilityId,
                workspace: 'collection',
                view: 'collection/reports',
                action,
                legacyRoute: 'data-collection',
                state: 'LEGACY_ADAPTER',
                detail: '生产构建采集 IPC 回归。',
              })),
              autonomy: { currentMode: 'manual_approval', manualApprovalAvailable: true, policyAutoAvailable: false },
              today: null,
            },
          }),
          command: async () => { throw new Error('本 smoke 不执行状态变更。'); },
        },
        listStores: async () => [{ ...store }],
        getStore: async () => ({ ...store }),
        createStore: async () => { throw new Error('本 smoke 不创建店铺。'); },
        updateStore: async () => { throw new Error('本 smoke 不更新店铺。'); },
        archiveStore: async () => { throw new Error('本 smoke 不归档店铺。'); },
        restoreStore: async () => { throw new Error('本 smoke 不恢复店铺。'); },
        createStoreConnection: async () => { throw new Error('本 smoke 不创建连接。'); },
        updateStoreConnection: async () => { throw new Error('本 smoke 不更新连接。'); },
        removeStoreConnection: async () => { throw new Error('本 smoke 不删除连接。'); },
        switchStore: async () => ({ ...view }),
        listStoreDailyStatuses: async () => ({ marketplace: 'US', generatedAt: new Date().toISOString(), items: [] }),
        getActiveStoreContext: async () => ({ ...context }),
        getActiveStoreWorkspaceView: async () => ({ ...view }),
        onStoreContextChanged: () => () => undefined,
        onStoresChanged: () => () => undefined,
        getState: async () => ({
          isLoggedIn: true,
          currentStore: store.displayName,
          loginSession: { erpSessionReady: true, adsSessionReady: false },
          storeContext: { ...context },
        }),
        getOperationScope: async () => ({
          dateFrom: '2026-07-25',
          dateTo: '2026-08-07',
          storeName: store.displayName,
          marketplaceCode: 'US',
          currency: 'USD',
        }),
        getStoreCollectionSchedule: async () => ({
          storeId: store.storeId,
          businessDate: context.businessDate,
          enabled: true,
          state: 'due',
          detail: '当前店铺可以手动启动完整采集。',
          dateStart: '2026-07-24',
          dateEnd: '2026-08-06',
        }),
      };
      window.__businessUiSmokeOverrides = overrides;
      window.electronAPI = requiredApi;
    });
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await enterPreviewStore(page);
    await navigateLegacyRoute(page, 'data-collection');
    const action = page.getByRole('button', { name: /重新获取完整 8 类报表/, exact: false }).first();
    await action.waitFor({ state: 'visible', timeout: 15_000 });
    await action.click();
    await page.waitForFunction(() => window.__dataCollectionProductionCalls?.length === 1, null, { timeout: 10_000 });
    evidence.collectionCalls = await page.evaluate(() => window.__dataCollectionProductionCalls);
    const requestId = evidence.collectionCalls[0]?.requestId;
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(requestId || ''))) {
      fail('Production click did not send a safe requestId to collection IPC', String(requestId));
    }
    if (evidence.collectionCalls[0]?.start !== '2026-07-24' || evidence.collectionCalls[0]?.end !== '2026-08-06') {
      fail('Production click did not replace the stale page range with the current Main schedule', JSON.stringify(evidence.collectionCalls[0]));
    }
    const allErrors = [...evidence.consoleErrors, ...evidence.pageErrors];
    if (allErrors.some((message) => /s is not defined/i.test(message))) {
      fail('Production collection click still throws s is not defined', allErrors.join('\n'));
    }
    const screenshotPath = path.join(evidenceDir, `business-ui-data-collection-production-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.screenshotPath = screenshotPath;
    evidence.passed = true;
    const evidencePath = path.join(evidenceDir, `business-ui-data-collection-production-${Date.now()}.json`);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`[business-ui-data-collection] requestId=${requestId}`);
    console.log(`[business-ui-data-collection] evidence=${evidencePath}`);
  } catch (error) {
    console.error(`[business-ui-data-collection] consoleErrors=${JSON.stringify(evidence.consoleErrors)}`);
    console.error(`[business-ui-data-collection] pageErrors=${JSON.stringify(evidence.pageErrors)}`);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
