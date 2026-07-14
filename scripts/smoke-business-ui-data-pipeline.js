const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('./playwright-loader');
const { navigateLegacyRoute } = require('./business-ui-smoke-navigation');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const NAV_RE = {
  dashboard: /今日看板|仪表盘/,
  productManagement: /产品管理/,
  dataCollection: /数据采集/,
  dataImport: /导入校验/,
  adQuant: /广告表现/,
};

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
    const targetPath = path.resolve(path.join(directory, pathname));
    const relative = path.relative(path.resolve(directory), targetPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
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
        url: `http://127.0.0.1:${address.port}/index.html?preview=1&scenario=diagnosis-ready`,
        close: () => server.close(),
      });
    });
  });
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function expectVisible(page, text) {
  try {
    await page.waitForFunction((expected) => document.body.innerText.includes(expected), text, { timeout: 5000 });
  } catch (error) {
    const textContent = await bodyText(page).catch(() => '');
    fail(`Expected visible text not found: ${text}`, textContent.slice(0, 3000));
  }
}

async function expectNotInBody(page, text) {
  const textContent = await bodyText(page);
  if (textContent.includes(text)) {
    fail(`Unexpected visible text: ${text}`);
  }
}

async function expectInBody(page, text) {
  const textContent = await bodyText(page);
  if (!textContent.includes(text)) {
    fail(`Expected visible text not found: ${text}\nBody sample:\n${textContent.slice(0, 3000)}`);
  }
}

async function viewportTextMatches(page, text) {
  const matches = await page.evaluate((expected) => {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const results = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const textValue = node.textContent || '';
      if (textValue.includes(expected)) {
        const parent = node.parentElement;
        const closedDetails = parent?.closest('details:not([open])');
        if (parent && (!closedDetails || parent.closest('summary'))) {
          const style = window.getComputedStyle(parent);
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of Array.from(range.getClientRects())) {
            const visible = style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
            const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
            if (visible && inViewport) {
              results.push({ text: textValue.trim(), visible, inViewport });
              break;
            }
          }
          range.detach();
        }
      }
      node = walker.nextNode();
    }
    return results;
  }, text).catch(() => []);
  return matches.filter((item) => item.visible && item.inViewport);
}

async function expectInViewport(page, text, label) {
  const matches = await viewportTextMatches(page, text);
  if (!matches.length) {
    const textContent = await bodyText(page).catch(() => '');
    fail(`Expected viewport-visible text not found: ${text}`, `${label || 'viewport'}\n${textContent.slice(0, 3000)}`);
  }
}

async function expectLocatorInViewport(locator, label) {
  const inViewport = await locator.first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.right > 0
      && rect.top < window.innerHeight
      && rect.left < window.innerWidth;
  });
  if (!inViewport) fail('Expected locator to be viewport-visible', label);
}

async function expectNotInViewport(page, text, label) {
  const matches = await viewportTextMatches(page, text);
  if (matches.length) {
    fail(`Unexpected viewport-visible text: ${text}`, `${label || 'viewport'}\n${matches.map((item) => item.text).join('\n').slice(0, 1000)}`);
  }
}

async function assertGlobalGuards(page, key) {
  const textContent = await bodyText(page);
  const scopeRangeTitle = await page.locator('.scope-compact-trigger').getAttribute('title');
  if (!textContent.includes('USD') && !scopeRangeTitle?.includes('/ USD')) fail('USD currency marker is missing', key);
  if (textContent.includes('¥')) fail('RMB currency symbol is visible', key);
  if (textContent.includes('v1.5 工作台')) fail('Old v1.5 workbench is visible', key);
  if (textContent.includes('APP_READY')) fail('False APP_READY state is visible', key);
  if (textContent.includes('pnpm run verify:ad-readback')) fail('Readback command wall is visible', key);
}

async function navigateBusinessPage(page, nav, route) {
  await navigateLegacyRoute(page, route);
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
    consoleErrors: [],
  };

  let server;
  let browser;
  try {
    server = await startStaticServer(rendererDir);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1480, height: 980 } });
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });

    await page.addInitScript(() => {
    const reportOptions = [
      { type: 'campaign', label: '广告活动报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      { type: 'ad_group', label: '广告组报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      { type: 'placement', label: '广告位报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      { type: 'advertised_product', label: '广告（推广的商品）报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      { type: 'auto_targeting', label: '自动投放报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      { type: 'keyword', label: '关键词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      { type: 'product_targeting', label: '商品投放报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
      { type: 'user_search_term', label: '用户搜索词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
    ];
    const realReportFiles = reportOptions.map((item, index) => ({
      id: `file_${item.type}`,
      batchId: 'mock_batch_scope',
      reportType: item.type,
      displayName: item.label,
      status: 'downloaded',
      filePath: `C:/AmazonAIOps/storage/downloads/mock-batch/${item.type}.xlsx`,
      folderPath: 'C:/AmazonAIOps/storage/downloads/mock-batch',
      fileName: `${item.type}.xlsx`,
      fileSizeBytes: 1024 + index,
      importedRows: 0,
      updatedAt: '2026-06-12T10:00:00.000Z',
    }));
    const mockBatch = {
      id: 'mock_batch_scope',
      status: 'completed',
      dateStart: '2026-06-01',
      dateEnd: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      downloadDir: 'C:/AmazonAIOps/storage/downloads/mock-batch',
      manifestPath: 'C:/AmazonAIOps/storage/downloads/mock-batch/manifest.json',
    };
    function makeBatchOptions({ hasRealFiles = false, importedRows = 0 } = {}) {
      return hasRealFiles ? [{
        id: 'mock_batch_scope',
        status: 'completed',
        dateStart: '2026-06-01',
        dateEnd: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        downloadDir: 'C:/AmazonAIOps/storage/downloads/mock-batch',
        manifestPath: 'C:/AmazonAIOps/storage/downloads/mock-batch/manifest.json',
        createdAt: '2026-06-12T09:55:00.000Z',
        completedAt: '2026-06-12T10:00:00.000Z',
        totalFileRecords: 8,
        realReportFileCount: 8,
        importedRowCount: importedRows * 8,
        missingReportLabels: [],
      }] : [];
    }
    function makePipeline({ hasRealFiles = false, importedRows = 0 } = {}) {
      const nextReportOptions = reportOptions.map((item) => ({
        ...item,
        status: hasRealFiles ? 'downloaded' : 'missing',
        realFileAvailable: hasRealFiles,
        importedRows: hasRealFiles ? importedRows : 0,
      }));
      const nextRealFiles = hasRealFiles
        ? realReportFiles.map((file) => ({ ...file, importedRows }))
        : [];
      return {
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
      },
      generatedAt: '2026-06-12T10:00:00.000Z',
      collection: {
        status: hasRealFiles && importedRows > 0 ? 'ready' : hasRealFiles ? 'partial' : 'blocked',
        latestBatch: null,
        sourceBatchIds: hasRealFiles ? ['mock_batch_scope'] : [],
        availableBatches: makeBatchOptions({ hasRealFiles, importedRows }),
        reportOptions: nextReportOptions,
        realReportFiles: nextRealFiles,
        evidencePaths: [
          { label: '下载文件夹', path: 'C:/AmazonAIOps/storage/downloads/mock-batch', kind: 'folder' },
          { label: '采集清单', path: 'C:/AmazonAIOps/storage/downloads/mock-batch/manifest.json', kind: 'audit' },
        ],
        fileAudit: {
          totalFileRecords: 8,
          downloadedFileRecords: 8,
          existingFileRecords: hasRealFiles ? 9 : 2,
          realReportFileCount: hasRealFiles ? 8 : 0,
          importedRowCount: hasRealFiles ? importedRows * 8 : 0,
          rejectedEvidenceFileCount: 2,
          missingReportLabels: hasRealFiles ? [] : reportOptions.map((item) => item.label),
          downloadDir: 'C:/AmazonAIOps/storage/downloads/mock-batch',
          manifestPath: 'C:/AmazonAIOps/storage/downloads/mock-batch/manifest.json',
        },
        blockers: hasRealFiles && importedRows > 0
          ? []
          : hasRealFiles
            ? ['当前范围没有导入广告指标行，广告表现保持阻断。']
            : ['当前范围还没有可量化的真实广告数据'],
        audit: {
          databaseReady: true,
          acceptedExtensions: ['.xlsx', '.xls', '.csv'],
          rejectedEvidenceExtensions: ['.json', '.png', '.html'],
          notes: ['mock smoke: empty real report state'],
        },
      },
      quant: {
        hasImportedMetrics: importedRows > 0,
        importedRows,
        canonicalRows: importedRows,
        actionableRows: importedRows,
        breakdownRows: importedRows * 6,
        summarySource: importedRows > 0 ? 'canonical_search_term' : 'blocked',
        totalSpend: importedRows > 0 ? 170.25 : 0,
        totalSales: importedRows > 0 ? 300.5 : 0,
        totalOrders: importedRows > 0 ? 3 : 0,
        totalClicks: 0,
        totalImpressions: 0,
        acos: importedRows > 0 ? 0.566 : 0,
        cvr: importedRows > 0 ? 0.034 : 0,
        cpc: importedRows > 0 ? 1.93 : 0,
        wastedSpend: null,
        highRiskCount: importedRows > 0 ? 1 : 0,
        adObjectTimelines: importedRows > 0 ? [{
          objectKey: 'B0TESTASIN|d6-auto-test|d6-ad-group|search_term|test search term',
          objectType: 'search_term',
          objectName: 'test search term',
          asin: 'B0TESTASIN',
          campaignName: 'D6-auto-test',
          adGroupName: 'D6-ad-group',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-12',
          daysActive: 12,
          lifecycleStage: 'keyword_exploration',
          quantStatus: 'waste',
          recommendedAction: 'lower_bid',
          recommendedValue: '1.70',
          trend: { spend: 'up', sales: 'flat' },
          totals: {
            impressions: 1000,
            clicks: 88,
            cost: 170.25,
            orders: 3,
            sales: 300.5,
            acos: 0.566,
            cpc: 1.93,
            cvr: 0.034,
            currency: 'USD',
          },
          thresholds: {
            targetAcos: 0.25,
            highAcosThreshold: 0.4,
            noOrderClickThreshold: 30,
            minSpend: 10,
            bidAdjustPercent: 0.1,
          },
          reasons: ['mock smoke: object timeline uses imported daily facts.'],
          reviewRequired: true,
        }] : [],
        diagnostics: importedRows > 0 ? [{
          portfolioName: 'D6 Portfolio',
          campaignName: 'D6-auto-test',
          adGroupName: 'D6-ad-group',
          asin: 'B0TESTASIN',
          objectType: 'user_search_term',
          objectName: 'test search term',
          spend: 170.25,
          sales: 300.5,
          orders: 3,
          clicks: 88,
          acos: 0.566,
          cvr: 0.034,
          cpc: 1.93,
          diagnosis: '高风险待复核',
          suggestedDirection: '先人工确认是否降本或否定',
        }] : [],
        blockers: importedRows > 0 ? [] : ['没有真实报表文件和导入指标，本页不生成建议。'],
      },
      operations: {
        events: operationEvents,
        eventCount: operationEvents.length,
        notes: ['mock smoke operation events'],
      },
      productContext: {
        productCount: importedRows > 0 ? 1 : 0,
        products: importedRows > 0 ? [{
          asin: 'B0TESTASIN',
          title: 'D6 Sensor Light',
          productStage: 'keyword_exploration',
          status: 'active',
          cost: {
            minPrice: 29.99,
            targetNetMargin: 0.22,
            targetAcos: 0.35,
            targetTacos: 0.12,
          },
        }] : [],
        notes: ['mock smoke product context'],
      },
      productHistory: {
        ledgerCount: importedRows > 0 ? 1 : 0,
        ledgers: importedRows > 0 ? [{
          asin: 'B0TESTASIN',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-12',
          activeDays: 12,
          firstMetricDate: '2026-06-01',
          lastMetricDate: '2026-06-12',
          inferredStage: 'keyword_exploration',
          stageReasons: ['广告对象已连续 12 天有花费，订单 3 单，ACOS 高于目标。'],
          totals: {
            impressions: 1000,
            clicks: 88,
            cost: 170.25,
            orders: 3,
            sales: 300.5,
            acos: 0.566,
            cpc: 1.93,
            cvr: 0.034,
            currency: 'USD',
          },
          events: operationEvents,
          product: {
            productStage: 'keyword_exploration',
            targetAcos: 0.35,
            targetTacos: 0.12,
            targetNetMargin: 0.22,
            minPrice: 29.99,
          },
          daily: [
            {
              date: '2026-06-01',
              impressions: 180,
              clicks: 12,
              cost: 22.5,
              orders: 0,
              sales: 0,
              acos: 0,
              cpc: 1.88,
              cvr: 0,
              currency: 'USD',
            },
            {
              date: '2026-06-08',
              impressions: 360,
              clicks: 34,
              cost: 63.2,
              orders: 1,
              sales: 99.99,
              acos: 0.632,
              cpc: 1.86,
              cvr: 0.029,
              currency: 'USD',
            },
            {
              date: '2026-06-12',
              impressions: 460,
              clicks: 42,
              cost: 84.55,
              orders: 2,
              sales: 200.51,
              acos: 0.422,
              cpc: 2.01,
              cvr: 0.048,
              currency: 'USD',
            },
          ],
        }] : [],
        notes: ['mock smoke product history ledger'],
      },
      };
    }
    let operationEvents = [{
      id: 1,
      eventDate: '2026-06-08',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      campaignName: 'D6-auto-test',
      adGroupName: 'D6-ad-group',
      eventType: 'coupon',
      title: '10% Coupon started',
      impactExpectation: 'conversion_up',
      notes: 'Coupon opened for launch push.',
      evidencePath: 'C:/AmazonAIOps/evidence/coupon.png',
      createdAt: '2026-06-08T10:00:00.000Z',
      updatedAt: '2026-06-08T10:00:00.000Z',
    }];
    let pipeline = makePipeline();
    window.__businessUiActionLog = [];

    window.electronAPI = {
      getState: async () => ({
        isLoggedIn: true,
        currentStore: 'FT-US-US',
        loginSession: { erpSessionReused: true, adsTitle: 'Amazon AI Ops' },
      }),
      browserLogout: async () => ({ success: true }),
      getBusinessUiDataPipeline: async () => pipeline,
      getBusinessBatchOptions: async () => pipeline.collection.availableBatches,
      getDeliveryEvidenceStatus: async (scope) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'getDeliveryEvidenceStatus', scope });
        const hasRealListing = Boolean(pipeline.quant?.hasImportedMetrics);
        return {
          listing: {
            readReady: hasRealListing,
            draftReady: hasRealListing,
            contentCount: hasRealListing ? 1 : 0,
            fullContentCount: hasRealListing ? 1 : 0,
            draftCount: hasRealListing ? 1 : 0,
            aiDraftCount: hasRealListing ? 1 : 0,
            ruleFallbackDraftCount: 0,
            latestAsin: hasRealListing ? 'B0TESTASIN' : undefined,
            latestUpdatedAt: hasRealListing ? '2026-06-12T10:10:00.000Z' : undefined,
          },
          readback: {
            verifiedCount: 0,
            latestStatus: 'NEEDS_WORK',
            latestJsonPath: '',
            latestUpdatedAt: '2026-06-12T10:11:00.000Z',
          },
        };
      },
      getRuleConfig: async () => ({
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
      }),
      getSettings: async () => ({
        aiApiKey: '',
        aiKeyConfigured: true,
        aiBaseUrl: 'https://api.deepseek.com',
        aiModel: 'deepseek-chat',
        aiTemperature: '0.3',
        aiMaxTokens: '700',
        aiLastTestStatus: 'available',
        aiLastTestAt: '2026-06-15T06:00:00.000Z',
        aiLastTestBaseUrl: 'https://api.deepseek.com',
        aiLastTestModel: 'deepseek-chat',
        aiLastTestMessage: 'AI 连接测试通过：deepseek-chat',
      }),
      listAiDiagnosisRuns: async (params) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'listAiDiagnosisRuns', params });
        return [{
          id: 701,
          promptKey: 'ad_strategy_diagnosis',
          promptVersion: 'ad_strategy_diagnosis_v1',
          model: 'deepseek-chat',
          scope: {
            dateFrom: '2026-06-01',
            dateTo: '2026-06-12',
            storeName: 'FT-US-US',
            marketplaceCode: 'US',
            batchId: 'mock_batch_scope',
          },
          evidencePackSummary: { total: 5, metric: 1, timeline: 1, operationEvent: 1, productContext: 1, ruleCandidate: 1 },
          evidencePackPreview: [{
            evidenceId: 'metric:mock_batch_scope:search_term:2026-06-12:search_term:history',
            type: 'metric',
            label: 'historical test search term / 2026-06-12',
            dateRange: '2026-06-12~2026-06-12',
            batchId: 'mock_batch_scope',
            reportType: 'user_search_term',
            sourceFile: 'C:/AmazonAIOps/storage/downloads/mock-batch/user_search_term.xlsx',
            sourceRow: 19,
            storeName: 'FT-US-US',
            marketplaceCode: 'US',
            asin: 'B0TESTASIN',
            campaignName: 'D6-auto-test',
            adGroupName: 'D6-ad-group',
            entityType: 'search_term',
            entityName: 'historical test search term',
            metrics: {
              cost: 170.25,
              sales: 300.5,
              orders: 3,
              clicks: 88,
              currency: 'USD',
            },
          }, {
            evidenceId: 'timeline:mock_batch_scope:product:B0TESTASIN',
            type: 'timeline',
            label: 'product B0TESTASIN / keyword_exploration / 12 days',
            dateRange: '2026-06-01~2026-06-12',
            batchId: 'mock_batch_scope',
            storeName: 'FT-US-US',
            marketplaceCode: 'US',
            asin: 'B0TESTASIN',
            entityType: 'product',
            entityName: 'B0TESTASIN',
            metrics: {
              cost: 170.25,
              sales: 300.5,
              orders: 3,
              clicks: 88,
              currency: 'USD',
            },
            timeline: {
              activeDays: 12,
              firstMetricDate: '2026-06-01',
              lastMetricDate: '2026-06-12',
              inferredStage: 'keyword_exploration',
              recentDaily: [
                { date: '2026-06-01', clicks: 12, cost: 22.5, orders: 0, sales: 0, acos: 0, cvr: 0, currency: 'USD' },
                { date: '2026-06-12', clicks: 42, cost: 84.55, orders: 2, sales: 200.51, acos: 0.422, cvr: 0.048, currency: 'USD' },
              ],
            },
          }],
          diagnosis: {
            source: 'ai',
            lifecycleStage: 'keyword_exploration',
            summary: 'Coupon 和 BD 背景显示该产品仍处于测词阶段。',
          },
          insights: [{
            entityType: 'search_term',
            entityName: '未绑定洞察词',
            actionType: 'observe',
            reason: '缺少可回查证据，未进入建议池。',
          }],
          formalRecommendationCount: 1,
          success: true,
          createdAt: '2026-06-12T11:00:00.000Z',
        }, {
          id: 702,
          promptKey: 'ad_strategy_diagnosis',
          promptVersion: 'ad_strategy_diagnosis_v1',
          model: 'deepseek-chat',
          scope: {
            dateFrom: '2026-06-01',
            dateTo: '2026-06-12',
            storeName: 'FT-US-US',
            marketplaceCode: 'US',
            batchId: 'mock_batch_scope',
          },
          evidencePackSummary: { total: 5, metric: 1, timeline: 1, operationEvent: 1, productContext: 1, ruleCandidate: 1 },
          evidencePackPreview: [],
          diagnosis: {
            source: 'rule',
            lifecycleStage: 'unknown',
            summary: 'AI 诊断不可用，当前使用规则引擎兜底。',
            aiFallbackReason: 'AI 输出 schemaVersion 错误：legacy_strategy_v0',
          },
          insights: [],
          formalRecommendationCount: 0,
          success: false,
          errorMessage: 'AI 输出 schemaVersion 错误：legacy_strategy_v0',
          createdAt: '2026-06-12T10:30:00.000Z',
        }];
      },
      runAdStrategyDiagnosis: async (params) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'runAdStrategyDiagnosis', params });
        if (window.__mockAdQuantAiFallback) {
          return {
            configured: false,
            invoked: false,
            model: 'deepseek-chat',
            metrics: 96,
            ruleCandidateCount: 1,
            summary: {
              source: 'rule',
              lifecycleStage: 'unknown',
              lifecycleStageReason: '未配置 AI Key，不能执行 AI 阶段判断。',
              lifecycleStageEvidenceRefs: [],
              summary: '未配置 AI Key，广告阶段诊断使用规则兜底。',
              mainProblems: [],
              riskWarnings: ['AI unavailable'],
              thresholdSuggestions: {
                targetAcos: { value: 0.25, reason: '当前规则配置兜底。' },
                highAcosThreshold: { value: 0.4, reason: '当前规则配置兜底。' },
                noOrderClickThreshold: { value: 30, reason: '当前规则配置兜底。' },
                minSpend: { value: 10, reason: '当前规则配置兜底。' },
              },
              aiCandidateCount: 0,
              insightOnlyCandidateCount: 0,
              aiInsights: [],
              evidencePackSummary: { total: 0, metric: 0, timeline: 0, operationEvent: 0, productContext: 0, ruleCandidate: 0 },
              operationEventCount: operationEvents.length,
              productContextCount: 1,
              fallbackReason: '未配置 AI Key，广告阶段诊断使用规则兜底',
            },
          };
        }
        return {
          configured: true,
          invoked: true,
          model: 'deepseek-chat',
          metrics: 96,
          ruleCandidateCount: 1,
          summary: {
            source: 'ai',
            lifecycleStage: 'keyword_exploration',
            lifecycleStageReason: '搜索词花费和促销事件显示仍处于测词阶段。',
            lifecycleStageEvidenceRefs: ['timeline:mock_batch_scope:product:B0TESTASIN'],
            summary: 'Coupon 和 BD 背景显示该产品仍处于测词阶段，同时需要收紧高 ACOS 浪费对象。',
            mainProblems: ['high_acos', 'promotion_context'],
            riskWarnings: ['促销冷却期不要直接放量加价。'],
            thresholdSuggestions: {
              targetAcos: { value: 0.35, reason: '产品目标 ACOS 和探索阶段允许更高容忍度。', evidenceRefs: ['timeline:mock_batch_scope:product:B0TESTASIN', 'product:FT-US-US:US:B0TESTASIN'] },
              highAcosThreshold: {
                value: 0.55,
                reason: 'Coupon/BD 期间高风险线临时放宽。',
                evidenceRefs: ['event:1'],
                requiresReview: true,
                reviewReasons: ['AI 阈值建议缺少指标或对象时间线证据。'],
              },
              noOrderClickThreshold: { value: 18, reason: '当前阶段需要更快处理无订单点击。', evidenceRefs: ['timeline:mock_batch_scope:product:B0TESTASIN', 'metric:mock_batch_scope:search_term:2026-06-12:search_term:abc'] },
              minSpend: { value: 15, reason: '提高最低花费避免小样本误判。', evidenceRefs: ['timeline:mock_batch_scope:product:B0TESTASIN', 'metric:mock_batch_scope:search_term:2026-06-12:search_term:abc'] },
            },
            aiCandidateCount: 1,
            insightOnlyCandidateCount: 1,
            aiInsights: [{
              entityType: 'search_term',
              entityName: '未绑定洞察词',
              actionType: 'observe',
              reason: 'AI 认为可能存在浪费，但没有绑定到当前真实广告对象。',
              reasoningSteps: ['缺少可绑定的 metric evidence。'],
              evidenceRefs: [],
              invalidReasons: ['AI 候选动作无法绑定当前范围内的真实广告对象。'],
              riskWarnings: ['未进入建议池。'],
              confidence: 0.4,
            }],
            evidencePackSummary: { total: 5, metric: 1, timeline: 1, operationEvent: 1, productContext: 1, ruleCandidate: 1 },
            evidencePackPreview: [{
              evidenceId: 'metric:mock_batch_scope:search_term:2026-06-12:search_term:abc',
              type: 'metric',
              label: 'test search term / 2026-06-12',
              dateRange: '2026-06-12~2026-06-12',
              batchId: 'mock_batch_scope',
              reportType: 'user_search_term',
              sourceFile: 'C:/AmazonAIOps/storage/downloads/mock-batch/user_search_term.xlsx',
              sourceRow: 9,
              storeName: 'FT-US-US',
              marketplaceCode: 'US',
              asin: 'B0TESTASIN',
              campaignName: 'D6-auto-test',
              adGroupName: 'D6-ad-group',
              entityType: 'search_term',
              entityName: 'test search term',
              metrics: {
                impressions: 1000,
                clicks: 88,
                cost: 170.25,
                orders: 3,
                sales: 300.5,
                acos: 0.566,
                cpc: 1.93,
                cvr: 0.034,
                currency: 'USD',
              },
            }, {
              evidenceId: 'timeline:mock_batch_scope:product:B0TESTASIN',
              type: 'timeline',
              label: 'product B0TESTASIN / keyword_exploration / 12 days',
              dateRange: '2026-06-01~2026-06-12',
              batchId: 'mock_batch_scope',
              storeName: 'FT-US-US',
              marketplaceCode: 'US',
              asin: 'B0TESTASIN',
              entityType: 'product',
              entityName: 'B0TESTASIN',
              metrics: {
                impressions: 1000,
                clicks: 88,
                cost: 170.25,
                orders: 3,
                sales: 300.5,
                acos: 0.566,
                cpc: 1.93,
                cvr: 0.034,
                currency: 'USD',
              },
              product: {
                productStage: 'keyword_exploration',
                targetAcos: 0.35,
                targetTacos: 0.12,
                targetNetMargin: 0.22,
                minPrice: 29.99,
              },
              timeline: {
                activeDays: 12,
                firstMetricDate: '2026-06-01',
                lastMetricDate: '2026-06-12',
                inferredStage: 'keyword_exploration',
                stageReasons: ['广告对象已连续 12 天有花费，订单 3 单，ACOS 高于目标。'],
                recentDaily: [
                  { date: '2026-06-01', clicks: 12, cost: 22.5, orders: 0, sales: 0, acos: 0, cvr: 0, currency: 'USD' },
                  { date: '2026-06-08', clicks: 34, cost: 63.2, orders: 1, sales: 99.99, acos: 0.632, cvr: 0.029, currency: 'USD' },
                  { date: '2026-06-12', clicks: 42, cost: 84.55, orders: 2, sales: 200.51, acos: 0.422, cvr: 0.048, currency: 'USD' },
                ],
              },
            }, {
              evidenceId: 'event:1',
              type: 'operation_event',
              label: '10% Coupon started',
              dateRange: '2026-06-08~2026-06-08',
              storeName: 'FT-US-US',
              marketplaceCode: 'US',
              asin: 'B0TESTASIN',
              campaignName: 'D6-auto-test',
              adGroupName: 'D6-ad-group',
              entityType: 'operation_event',
              entityName: '10% Coupon started',
              event: {
                eventDate: '2026-06-08',
                eventType: 'coupon',
                title: '10% Coupon started',
                impactExpectation: 'conversion_up',
              },
            }, {
              evidenceId: 'product:FT-US-US:US:B0TESTASIN',
              type: 'product_context',
              label: 'B0TESTASIN / keyword_exploration',
              dateRange: '2026-06-01~2026-06-12',
              storeName: 'FT-US-US',
              marketplaceCode: 'US',
              asin: 'B0TESTASIN',
              entityType: 'product',
              entityName: 'B0TESTASIN',
              product: {
                productStage: 'keyword_exploration',
                targetAcos: 0.35,
                targetTacos: 0.12,
                targetNetMargin: 0.22,
                minPrice: 29.99,
              },
            }],
            operationEventCount: operationEvents.length,
            productContextCount: 1,
          },
        };
      },
      getRecommendations: async (filter) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'getRecommendations', filter });
        const importedRows = pipeline.collection.fileAudit.importedRowCount || 0;
        if (importedRows <= 0) return [];
        const recommendation = {
          id: 9001,
          actionType: 'lower_bid',
          entityType: 'search_term',
          entityName: 'test search term',
          currentValue: '1.90',
          recommendedValue: '1.70',
          reason: 'mock dashboard pending recommendation',
          acos: 0.566,
          clicks: 88,
          cost: 170.25,
          riskLevel: 'APPROVAL',
          status: 'pending',
          confidence: 0.82,
          evidence: { batchId: 'mock_batch_scope', campaignName: 'D6-auto-test', adGroupName: 'D6-ad-group' },
        };
        if (filter?.status === 'pending') return [recommendation];
        if (filter?.status === 'needs_review') {
          return [{
            ...recommendation,
            id: 9002,
            status: 'needs_review',
            reason: 'mock dashboard review recommendation',
            evidence: { ...recommendation.evidence, decisionRequiresReview: true },
          }];
        }
        return [];
      },
      collectLingxingReports: async (dateRange) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'collectLingxingReports', dateRange });
        if (window.__forceRecreateNeedsDiagnostic) {
          throw new Error('no matching download-center diagnostic exists for this page model, date range, store, and marketplace');
        }
        pipeline = makePipeline({ hasRealFiles: true, importedRows: 0 });
        return { batch: { ...mockBatch, id: 'mock_recreate_full_batch' }, files: realReportFiles, metricsImport: { inserted: 0, parsedFiles: 0, errors: [] } };
      },
      diagnoseLingxingDownloadCenter: async (dateRange) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'diagnoseLingxingDownloadCenter', dateRange });
        return {
          id: 7788,
          ready: true,
          pageModel: 'lingxing-download-center',
          dateStart: dateRange?.start,
          dateEnd: dateRange?.end,
          storeName: dateRange?.storeName,
          marketplaceCode: dateRange?.marketplaceCode,
          screenshotPath: 'C:/AmazonAIOps/evidence/download-center-diagnostic.png',
          domSnapshotPath: 'C:/AmazonAIOps/evidence/download-center-diagnostic.html',
        };
      },
      retryLingxingReport: async (dateRange, reportType) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'retryLingxingReport', dateRange, reportType });
        const file = realReportFiles.find((item) => item.reportType === reportType);
        pipeline = makePipeline({ hasRealFiles: true, importedRows: 12 });
        return { batch: { ...mockBatch, id: `mock_batch_${reportType}` }, files: file ? [file] : [], metricsImport: { inserted: 12, parsedFiles: 1, errors: [] } };
      },
      downloadExistingLingxingReports: async (dateRange, reportTypes) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'downloadExistingLingxingReports', dateRange, reportTypes });
        if (window.__forceDownloadExistingNoNewFiles) {
          pipeline = makePipeline({ hasRealFiles: true, importedRows: 0 });
          return {
            batch: { ...mockBatch, id: 'mock_existing_no_new_files_batch' },
            files: [],
            metricsImport: { inserted: 0, parsedFiles: 0, errors: [] },
            pipeline,
          };
        }
        if (window.__forceDownloadExistingMissingError) {
          return {
            batch: {
              ...mockBatch,
              id: 'mock_existing_failed_batch',
              status: 'failed',
              downloadDir: 'C:/AmazonAIOps/storage/downloads/mock-failed-batch',
              manifestPath: 'C:/AmazonAIOps/storage/downloads/mock-failed-batch/manifest.json',
            },
            files: reportTypes.map((reportType) => {
              const option = reportOptions.find((item) => item.type === reportType);
              return {
                id: `mock_failed_${reportType}`,
                batchId: 'mock_existing_failed_batch',
                reportType,
                displayName: option?.label || reportType,
                status: 'failed',
                errorMessage: '未找到当前范围已创建/ready/可下载的领星报表行',
              };
            }),
            metricsImport: { inserted: 0, parsedFiles: 0, skippedFiles: reportTypes.length, errors: [] },
          };
        }
        pipeline = makePipeline({ hasRealFiles: true, importedRows: 0 });
        return {
          batch: { ...mockBatch, id: 'mock_existing_batch' },
          files: realReportFiles.filter((file) => reportTypes.includes(file.reportType)),
          metricsImport: { inserted: 0, parsedFiles: 0, errors: [] },
        };
      },
      importCurrentBusinessReports: async (scope) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'importCurrentBusinessReports', scope });
        if (window.__forceZeroImportResult) {
          pipeline = makePipeline({ hasRealFiles: true, importedRows: 0 });
          return {
            batch: mockBatch,
            files: realReportFiles,
            metricsImport: {
              inserted: 0,
              parsedFiles: 8,
              errors: [{ reportType: 'keyword', filePath: 'C:/AmazonAIOps/storage/downloads/mock-batch/keyword.xlsx', message: '真实报表未解析出广告指标行' }],
            },
            pipeline,
          };
        }
        pipeline = makePipeline({ hasRealFiles: true, importedRows: 12 });
        return { batch: mockBatch, files: realReportFiles, metricsImport: { inserted: 96, parsedFiles: 8, errors: [] }, pipeline };
      },
      importLocalBusinessReportFiles: async (scope) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'importLocalBusinessReportFiles', scope });
        return {
          cancelled: true,
          metricsImport: { inserted: 0, parsedFiles: 0, errors: [] },
          pipeline,
        };
      },
      exportDataReconciliation: async (scope) => {
        window.__businessUiActionLog = window.__businessUiActionLog || [];
        window.__businessUiActionLog.push({ type: 'exportDataReconciliation', scope });
        return {
          success: true,
          jsonPath: 'C:/AmazonAIOps/app-data/exports/data-reconciliation-mock.json',
          markdownPath: 'C:/AmazonAIOps/app-data/exports/data-reconciliation-mock.md',
          canonical: {
            rows: 96,
            spend: 170.25,
            sales: 300.5,
            orders: 3,
            clicks: 88,
            currency: 'USD',
          },
          canonicalSource: 'canonical_search_term',
          blockers: [],
        };
      },
      openReportPath: async (targetPath) => {
        window.__businessUiActionLog.push({ type: 'openReportPath', targetPath });
        return { success: true };
      },
      listOperationEvents: async (filter) => {
        window.__businessUiActionLog.push({ type: 'listOperationEvents', filter });
        return operationEvents;
      },
      createOperationEvent: async (input) => {
        window.__businessUiActionLog.push({ type: 'createOperationEvent', input });
        const event = {
          id: operationEvents.length + 1,
          eventDate: input.eventDate,
          storeName: input.storeName,
          marketplaceCode: input.marketplaceCode,
          asin: input.asin,
          campaignName: input.campaignName,
          adGroupName: input.adGroupName,
          eventType: input.eventType,
          title: input.title,
          impactExpectation: input.impactExpectation,
          notes: input.notes,
          evidencePath: input.evidencePath,
          createdAt: '2026-06-12T10:00:00.000Z',
          updatedAt: '2026-06-12T10:00:00.000Z',
        };
        operationEvents = [event, ...operationEvents];
        return { id: event.id };
      },
      deleteOperationEvent: async (id) => {
        window.__businessUiActionLog.push({ type: 'deleteOperationEvent', id });
        operationEvents = operationEvents.filter((item) => item.id !== id);
        return { success: true };
      },
    };
  });

    await page.goto(server.url, { waitUntil: 'networkidle' });

    await expectNotInBody(page, 'v1.5 工作台');
  await expectNotInBody(page, 'APP_READY');
  await expectNotInBody(page, '¥');
    await expectNotInBody(page, 'pnpm run verify:ad-readback');

  const routes = [
    { nav: NAV_RE.dashboard, heading: /今日任务/, label: '今日任务', key: 'dashboard' },
    { nav: NAV_RE.productManagement, heading: /产品管理/, label: '产品管理', key: 'product-management' },
    { nav: NAV_RE.dataCollection, heading: /数据采集/, label: '数据采集', key: 'data-collection' },
    { nav: NAV_RE.dataImport, heading: /导入校验/, label: '导入校验', key: 'data-import-validation' },
    { nav: /运营事件/, heading: /运营事件/, label: '运营事件', key: 'operation-events' },
    { nav: NAV_RE.adQuant, heading: /广告表现/, label: '广告表现', key: 'ad-quant' },
  ];

    for (const { nav, heading, label, key } of routes) {
    await navigateBusinessPage(page, nav, key);
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
    await assertGlobalGuards(page, key);
    if (key === 'product-management') {
      await expectVisible(page, '管理产品池、锁定当前 ASIN，再把产品上下文交给广告表现、关键词和 Listing。');
      await expectVisible(page, '产品池');
      await expectVisible(page, '当前产品');
      await expectVisible(page, '数据状态');
      await expectVisible(page, '日级账本');
      await expectVisible(page, '产品列表');
      await expectVisible(page, '搜索产品');
    }
    const screenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-${key}-${runId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.pages[key] = {
      label,
      screenshotPath,
      bodyTextSample: (await bodyText(page)).slice(0, 1800),
    };
    }

  await expectVisible(page, '广告表现阻断');
  await expectVisible(page, '没有真实报表文件和导入指标，本页不生成建议。');
  await expectNotInBody(page, '总花费');
  await expectNotInBody(page, '总销售');

  await navigateBusinessPage(page, NAV_RE.dashboard, 'dashboard');
  await expectVisible(page, '今日任务');
  await expectVisible(page, '下一安全动作');
  await expectVisible(page, '选择运营产品');
  await expectVisible(page, '当前产品');
  await expectVisible(page, '待锁定');
  await expectVisible(page, '真实数据');
  await expectVisible(page, '0/8 类');
  await expectVisible(page, '广告表现');
  await expectVisible(page, '待量化');
  await expectVisible(page, '风险对象队列');
  await expectVisible(page, '缺少真实广告表格，无法给出风险对象。');
  await expectVisible(page, '产品上下文');
  await expectVisible(page, '尚未锁定产品');
  await expectVisible(page, '数据、产品历史与交付明细');
  await page.locator('summary').filter({ hasText: '数据、产品历史与交付明细' }).click();
  await expectVisible(page, '数据健康');
  await expectVisible(page, '数据门槛');
  await expectVisible(page, '0/8 类 · 0 行');
  await expectVisible(page, 'AI / 建议');
  await expectVisible(page, '广告历史摘要');
  await expectVisible(page, '锁定产品后展示该产品的历史账本。');
  await expectVisible(page, '交付缺口');
  await expectVisible(page, '最近文件路径');
  await expectNotInBody(page, '总花费');
  await expectNotInBody(page, '总销售');
  await expectNotInBody(page, '任务入口会按领星任务、真实报表、DB 指标、AI+规则建议顺序推进。');

  await navigateBusinessPage(page, NAV_RE.dataImport, 'data-import-validation');
  await expectVisible(page, '数据流程四段闭环');
  await expectVisible(page, '真实报表');
  await expectVisible(page, '0/8');
  await expectVisible(page, '入库行数');
  await expectVisible(page, '0 行');
  await expectVisible(page, '导入批次状态');
  await expectVisible(page, '缺报表');
  await expectVisible(page, '去数据采集');
  await expectVisible(page, '导入本地报表');
  await page.getByRole('heading', { name: '导入批次状态', level: 3 }).scrollIntoViewIfNeeded();
  await expectInViewport(page, '导入批次状态', 'initial data import first viewport');
  await expectLocatorInViewport(
    page.locator('.data-import-title-pills').getByText(/真实报表\s*0\/8/),
    'initial data import first viewport: 0/8',
  );
  await expectInViewport(page, '去数据采集', 'initial data import first viewport');
  await expectInViewport(page, '导入本地报表', 'initial data import first viewport');
  await expectNotInViewport(page, '真实报表目录', 'initial data import first viewport');
  await expectNotInViewport(page, '领星任务已创建', 'initial data import first viewport');
  await page.locator('summary').filter({ hasText: '数据流程四段闭环' }).click();
  await expectVisible(page, '领星任务已创建');
  await expectVisible(page, '真实报表已下载');
  await expectVisible(page, '日级指标已入库');
  await expectVisible(page, '可用于 AI+规则建议');
  await expectInBody(page, '导入页只负责把真实报表变成日级广告事实；审计证据不能替代广告数据。', 'data import four-stage summary');
  await expectVisible(page, '数据链未闭合');
  await expectVisible(page, '文件位置与用途');
  await page.locator('summary').filter({ hasText: '文件位置与用途' }).click();
  await expectVisible(page, '广告数据现在在哪');
  await expectVisible(page, '暂无真实报表目录');
  await expectVisible(page, 'SQLite 日级指标');
  await expectVisible(page, '0 行可用');
  await expectVisible(page, '审计文件不参与计算');
  await expectVisible(page, '回数据采集获取真实报表');

  await navigateBusinessPage(page, /运营事件/, 'operation-events');
  await page.locator('summary').filter({ hasText: '新增/维护事件、AI 使用说明和覆盖统计' }).click();
  await expectVisible(page, 'AI 与规则如何使用这些事件');
  await expectVisible(page, '解释阈值变化');
  await expectVisible(page, '判断产品推广阶段');
  await expectVisible(page, '只影响建议，不自动执行');
  await expectVisible(page, '当前事件覆盖');
  await page.getByRole('button', { name: '新增事件', exact: true }).click();
  await expectVisible(page, 'Coupon/折扣');
  await expectVisible(page, 'BD/秒杀');
  await expectVisible(page, '大促');
  await expectVisible(page, '调价');
  await expectVisible(page, '库存异常');
  await expectVisible(page, 'Listing 修改');
  await expectInBody(page, 'Coupon / 折扣券', 'operation event selected type');
  await expectVisible(page, '优惠券通常会抬高转化预期。AI 会允许短期测试花费，但会重点检查 Coupon 期间是否仍然无订单或 ACOS 失控。');
  await expectVisible(page, '10% Coupon started');
  await page.getByRole('button', { name: 'BD/秒杀' }).click();
  await expectInBody(page, 'BD/秒杀会改变流量和转化基线。AI 会把活动日单独解释，避免把活动流量误判为自然稳定放量。', 'BD event hint');
  await page.getByRole('button', { name: '保存到上下文' }).click();
  await page.getByText('运营事件已记录，会进入广告表现和 AI 诊断上下文。', { exact: true }).waitFor({ timeout: 5000 });
  await expectVisible(page, 'BD 活动开始');
  await expectVisible(page, '查看广告表现');
  await expectVisible(page, '生成 AI+规则建议');

  await navigateBusinessPage(page, /数据采集/, 'data-collection');
  await expectInViewport(page, '8 类报表工作台', 'initial data collection first viewport');
  await expectInViewport(page, '真实报表', 'initial data collection first viewport');
  await expectLocatorInViewport(
    page.locator('.data-collection-summary-strip').getByText('0/8', { exact: true }),
    'initial data collection first viewport: 0/8 real reports',
  );
  await expectInViewport(page, '入库指标', 'initial data collection first viewport');
  await expectInViewport(page, '重新获取完整 8 类报表', 'initial data collection first viewport');
  await expectInViewport(page, '更多报表操作', 'initial data collection first viewport');
  await expectNotInViewport(page, '浏览器状态', 'initial data collection first viewport');
  await expectNotInViewport(page, '采集进度', 'initial data collection first viewport');
  await expectNotInViewport(page, '真实报表目录', 'initial data collection first viewport');
  await expectNotInViewport(page, '当前范围没有可分析的 Lingxing xlsx/xls/csv', 'initial data collection first viewport');
  await expectNotInViewport(page, '系统只在四段都闭合后放行', 'initial data collection first viewport');
  await page.locator('summary').filter({ hasText: '更多报表操作' }).click();
  for (const text of [
    '导入本地报表',
    '下载已创建',
    '重新获取已选',
    '重新获取完整 8 类',
  ]) {
    await expectInBody(page, text, 'data collection action copy');
  }
  {
    const actionButtonsScreenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-data-collection-actions-${runId}.png`);
    const actionButtonsText = await page.locator('.data-collection-primary-panel').innerText({ timeout: 5000 });
    await page.locator('.data-collection-primary-panel').screenshot({ path: actionButtonsScreenshotPath });
    evidence.pages.dataCollectionActions = {
      label: '数据采集动作按钮',
      screenshotPath: actionButtonsScreenshotPath,
      bodyTextSample: actionButtonsText,
    };
  }
  await page.evaluate(() => {
    window.__forceRecreateNeedsDiagnostic = true;
  });
  await page.getByRole('button', { name: '重新获取完整 8 类报表', exact: true }).first().click();
  await expectVisible(page, '动作未完成');
  await expectVisible(page, '重新创建报表前，需要先验证当前范围的下载中心页面');
  await page.locator('summary').filter({ hasText: '辅助采集账本、流程和技术细节' }).click();
  await expectVisible(page, '验证页面');
  await expectVisible(page, '重试获取 8 类');
  {
    const needsVerifyScreenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-data-collection-needs-verify-${runId}.png`);
    const needsVerifyText = await page.locator('.collection-action-feedback').first().innerText({ timeout: 5000 });
    await page.locator('.collection-action-feedback').first().screenshot({ path: needsVerifyScreenshotPath });
    evidence.pages.dataCollectionNeedsVerify = {
      label: '数据采集需要页面验证',
      screenshotPath: needsVerifyScreenshotPath,
      bodyTextSample: needsVerifyText,
    };
  }
  await page.getByRole('button', { name: '验证页面', exact: true }).click();
  await expectVisible(page, '页面验证通过');
  await expectVisible(page, '可以重新获取完整 8 类报表');
  {
    const verifyFeedbackScreenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-data-collection-verify-feedback-${runId}.png`);
    const verifyFeedbackText = await page.locator('.collection-action-feedback').first().innerText({ timeout: 5000 });
    await page.locator('.collection-action-feedback').first().screenshot({ path: verifyFeedbackScreenshotPath });
    evidence.pages.dataCollectionVerifyFeedback = {
      label: '数据采集页面验证反馈',
      screenshotPath: verifyFeedbackScreenshotPath,
      bodyTextSample: verifyFeedbackText,
    };
  }
  await page.evaluate(() => {
    window.__forceRecreateNeedsDiagnostic = false;
  });
  for (const text of [
    '浏览器状态',
    'Lingxing 会话有效',
    '下载中心',
    '0/8 类真实报表',
    '采集进度',
    '只接受 xlsx/xls/csv 原始广告报表。',
    '截图、DOM、审计包只做证据，不参与广告表现计算。',
    '下载完成后进入导入校验。',
  ]) {
    await expectInBody(page, text, 'data collection action copy');
  }
  await expectNotInBody(page, '尚未单独接入');
  await expectVisible(page, '真实原始报表文件');
  await expectVisible(page, '当前范围数据账本');
  await page.locator('summary').filter({ hasText: '当前范围数据账本' }).click();
  await expectVisible(page, '没有真实广告报表');
  await expectVisible(page, '下载或导入真实报表');
  await expectVisible(page, '数据流程四段闭环');
  await page.locator('summary').filter({ hasText: '数据流程四段闭环' }).click();
  await expectVisible(page, '领星任务已创建');
  await expectVisible(page, '真实报表已下载');
  await expectVisible(page, '日级指标已入库');
  await expectVisible(page, '可用于 AI+规则建议');
  await expectInBody(page, '系统只在四段都闭合后放行广告表现、AI 证据包和优化建议。', 'four-step data evidence gate');
  await expectInBody(page, '批次号和审计文件只用于追溯；运营判断看这四段是否完成。', 'batch id is audit context not primary workflow');
  await expectVisible(page, '真实报表文件检查');
  await page.locator('summary').filter({ hasText: '真实报表文件检查' }).click();
  await expectVisible(page, '文件位置与用途');
  await page.getByRole('button', { name: '调整', exact: true }).click();
  await expectVisible(page, '调整本次下载/重建的报表');
  await expectVisible(page, '已选 8/8 类');
  await expectVisible(page, '已选择 8 类报表，下载和重建只会作用于这些勾选项。');
  const initialSelectedReportCount = await page.locator('.collection-selector-modal input[type="checkbox"]:checked').count();
  if (initialSelectedReportCount !== 8) {
    fail('Expected all eight reports to be selected', String(initialSelectedReportCount));
  }
  await expectVisible(page, '全选 8 类');
  await expectVisible(page, '只选缺失');
  await expectVisible(page, '只选未入库');
  await expectVisible(page, '清空');
  await page.getByRole('button', { name: '清空' }).click();
  await expectVisible(page, '已选 0/8 类');
  await expectVisible(page, '当前未选择报表；可一键选择 8 个缺失报表或 0 个待入库报表。');
  const emptySelectedReportCount = await page.locator('.collection-selector-modal input[type="checkbox"]:checked').count();
  if (emptySelectedReportCount !== 0) {
    fail('Expected report selection to be empty', String(emptySelectedReportCount));
  }
  if (!(await page.getByRole('button', { name: /下载已创建/ }).isDisabled())) {
    fail('Download-existing button should be disabled after clearing report selection');
  }
  await page.getByRole('button', { name: '全选 8 类' }).click();
  await expectVisible(page, '已选 8/8 类');
  await page.getByRole('button', { name: '确认选择', exact: true }).click();
  await page.locator('summary').filter({ hasText: '文件位置与用途' }).click();
  await expectVisible(page, '真实广告表格');
  await expectVisible(page, '采集清单');
  await expectVisible(page, '验收/诊断证据');
  await expectVisible(page, 'C:/AmazonAIOps/storage/downloads/mock-batch');
  await expectVisible(page, 'C:/AmazonAIOps/storage/downloads/mock-batch/manifest.json');
  await expectVisible(page, '这里应能看到 Lingxing 下载的 xlsx/xls/csv，后续广告表现只读取这些文件。');
  await expectVisible(page, '这里只放审计文件、截图、HTML 等证据；找广告数据请打开“真实广告表格”目录。');
  await expectVisible(page, '打开真实报表目录');
  await expectVisible(page, '打开采集清单');
  await expectVisible(page, '打开审计证据');
  await expectVisible(page, '当前真实报表清单');
  await expectVisible(page, '暂无 xlsx/xls/csv 文件');
  await expectVisible(page, '当前没有真实广告报表。请先下载并导入已创建报表，或重新创建、下载并导入 8 类报表；只有审计包时系统不能量化广告。');
  await expectVisible(page, '0/8');
  await expectVisible(page, '本地真实报表已下载');
  await expectVisible(page, '审计/诊断文件');
  await expectVisible(page, '当前文件夹只有诊断/审计文件，没有真实广告报表。系统不能用于广告表现计算。');
  await expectVisible(page, '审计文件、截图、DOM/HTML 和采集清单只用于证明流程，不是广告数据，不能参与广告表现计算。');
  await expectVisible(page, '打开真实报表目录');
  await expectVisible(page, '打开采集清单');
  await expectVisible(page, '当前范围没有可分析的 Lingxing xlsx/xls/csv');
  await expectVisible(page, '验收审计/技术细节');
  await page.locator('summary').filter({ hasText: '验收审计/技术细节' }).click();
  await expectVisible(page, '数据库可读：');
  await page.getByRole('button', { name: /导入本地/ }).first().click();
  await page.getByText('已取消本地报表选择。', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.evaluate(() => {
    window.__forceDownloadExistingMissingError = true;
  });
  await page.getByRole('button', { name: /下载已创建/ }).click();
  await page.getByText('采集动作返回，但当前范围仍未满足量化门槛', { exact: false }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, '下载并导入已创建报表未完成');
  await expectVisible(page, '批次：mock_existing_failed_batch');
  await expectVisible(page, '当前范围覆盖 0/8 类');
  await expectVisible(page, '本次新增真实下载 0');
  await expectVisible(page, '失败 8');
  await expectVisible(page, '下一步：查看失败原因和本次采集清单，确认领星 ready 行、页面模型、日期/店铺/站点后再重试。');
  await expectInBody(page, '未找到当前范围已创建/ready/可下载的领星报表行', 'download-existing failed report reason');
  await expectVisible(page, '打开本次下载目录');
  await expectVisible(page, '打开本次采集清单');
  await page.evaluate(() => {
    window.__forceDownloadExistingMissingError = false;
  });
  await page.getByRole('button', { name: /下载已创建/ }).click();
  await page.getByText('真实报表已下载，但自动导入未写入广告指标', { exact: false }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, '动作结果摘要');
  await expectVisible(page, '本次拿到了 8 个真实报表文件，但还没有写入 DB 指标。');
  await expectVisible(page, '已下载，待导入');
  await expectVisible(page, '点击“导入已下载表格”，把 xlsx/xls/csv 写入日级广告指标。');
  await expectVisible(page, '本次动作结果');
  await expectInBody(page, '已创建报表下载完成，自动导入未完成', 'download existing partial result title');
  await expectVisible(page, '最近采集动作');
  await expectVisible(page, '1. 验证当前范围');
  await expectVisible(page, '2. 查找 ready 行');
  await expectVisible(page, '3. 下载并校验表格');
  await expectVisible(page, '4. 自动导入广告指标');
  await expectVisible(page, '批次：mock_existing_batch');
  await expectVisible(page, '当前范围覆盖 8/8 类');
  await expectVisible(page, '本次新增真实下载 8');
  await expectVisible(page, '本次真实下载表格');
  await expectVisible(page, '真实报表目录');
  await expectVisible(page, '打开报表目录');
  await expectVisible(page, '本次解析 0 表');
  await expectVisible(page, '本次写入 0 行');
  await expectVisible(page, '下一步：点击“导入已下载表格”，把本地表格写入广告指标。');
  await expectVisible(page, '打开本次下载目录');
  await expectVisible(page, '打开本次采集清单');
  await page.evaluate(() => {
    window.__forceDownloadExistingNoNewFiles = true;
  });
  await page.getByRole('button', { name: /下载已创建/ }).click();
  await page.getByText('本次没有新增真实原始报表文件', { exact: false }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, '当前范围已有 8/8 类真实报表覆盖，但本次动作没有新增下载，且还没有写入 DB 指标。');
  await expectVisible(page, '打开真实报表目录确认 xlsx/xls/csv 后，点击“导入已下载表格”。');
  await expectVisible(page, '本次新增真实下载 0');
  await expectVisible(page, '当前范围已有真实报表，但本次动作没有新增真实下载文件。请点击“打开当前真实报表目录”确认文件，或直接导入已下载报表。');
  await page.evaluate(() => {
    window.__forceDownloadExistingNoNewFiles = false;
  });
  await page.locator('.data-collection-primary-panel').getByRole('button', { name: /重新获取完整 8 类/ }).click();
  await page.getByText('真实报表已下载，但自动导入未写入广告指标', { exact: false }).first().waitFor({ timeout: 5000 });
  const recreateFullFeedback = await page.locator('.collection-action-feedback').first().innerText({ timeout: 5000 });
  for (const text of ['最近动作', '已返回', '真实报表已下载，但自动导入未写入广告指标']) {
    if (!recreateFullFeedback.includes(text)) {
      fail(`Top collection feedback is missing text after recreate-full: ${text}`, recreateFullFeedback);
    }
  }
  {
    const feedbackScreenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-data-collection-recreate-feedback-${runId}.png`);
    await page.locator('.collection-action-feedback').first().screenshot({ path: feedbackScreenshotPath });
    evidence.pages.dataCollectionRecreateFeedback = {
      label: '数据采集动作反馈',
      screenshotPath: feedbackScreenshotPath,
      bodyTextSample: recreateFullFeedback,
    };
  }
  await expectInBody(page, '全部报表下载完成，自动导入未完成', 'recreate full partial result title');
  await page.evaluate(() => {
    window.__forceZeroImportResult = true;
  });
  await page.getByRole('button', { name: '导入已下载表格' }).click();
    await page.getByText('导入未完成：解析 8 个真实报表，写入 0 行广告指标，错误 1 个。', { exact: true }).first().waitFor({ timeout: 5000 });
    await page.getByText('真实报表导入未形成可量化广告数据', { exact: false }).first().waitFor({ timeout: 5000 });
    await expectInBody(page, '真实报表未解析出广告指标行', 'zero import error reason');
    await expectVisible(page, '当前指标 0 行');
  await page.evaluate(() => {
    window.__forceZeroImportResult = false;
  });
  await page.getByRole('button', { name: '导入已下载表格' }).click();
    await page.getByText('导入完成：解析 8 个真实报表，写入 96 行广告指标，错误 0 个。', { exact: true }).first().waitFor({ timeout: 5000 });
    await expectVisible(page, '真实报表已经入库，当前范围有 96 行日级广告指标。');
    await expectVisible(page, '可进入建议');
    await expectVisible(page, '下一步：查看广告表现，复核 ACOS、花费和订单口径。');
    await expectVisible(page, '真实报表导入完成');
    await expectVisible(page, '当前范围覆盖 8/8 类');
    await expectVisible(page, '本次真实导入表格 8');
    await expectVisible(page, '本次真实导入表格');
    await expectVisible(page, '本次解析 8 表');
    await expectVisible(page, '本次写入 96 行');
    await expectVisible(page, '当前指标 96 行');
    await expectVisible(page, '下一步：查看广告表现，复核 ACOS、花费和订单口径。');
    await expectVisible(page, '本次写入 96 行');
    await expectVisible(page, '打开当前真实报表目录');
    await expectVisible(page, 'campaign.xlsx');
    await page.locator('summary').filter({ hasText: '真实原始报表文件' }).click();
    await expectVisible(page, 'user_search_term.xlsx');
    await page.getByRole('button', { name: '查看广告活动报告文件详情', exact: true }).click();
    await expectVisible(page, 'C:/AmazonAIOps/storage/downloads/mock-batch/campaign.xlsx');
    for (const detailLabel of ['文件名', '扩展名', '文件大小', '最近入库', '文件指纹', '所在目录', '完整文件路径', '入库状态', 'DB 指标行数', '文件状态']) {
      await expectVisible(page, detailLabel);
    }
    await page.getByRole('button', { name: '打开文件', exact: true }).click();
    await page.getByText('已请求打开：', { exact: false }).first().waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: '知道了', exact: true }).click();
    await page.getByRole('button', { name: '打开本次导入目录' }).click();
    for (const header of ['报表类型', '文件', '文件大小', '入库状态', 'DB 指标行数', '最近入库', '状态', '操作']) {
    await expectVisible(page, header);
    }
    await expectVisible(page, '.xlsx');
    await expectVisible(page, '1 KB');
    await page.getByRole('button', { name: /重新获取已选/ }).click();
    await page.getByText('采集动作已完成：本次新增', { exact: false }).first().waitFor({ timeout: 5000 });
    await expectInBody(page, '已自动导入 96 行广告指标', 'retry selected auto-import notice');
    await expectVisible(page, '8/8');
    await expectVisible(page, '96');
    await navigateBusinessPage(page, NAV_RE.dataImport, 'data-import-validation');
    await expectVisible(page, '数据流程四段闭环');
    await expectVisible(page, '真实报表');
    await expectVisible(page, '8/8');
    await expectVisible(page, '入库行数');
    await expectVisible(page, '96 行');
    await expectVisible(page, '导入批次状态');
    await expectVisible(page, '已入库');
    await expectVisible(page, '打开报表目录');
    await page.locator('summary').filter({ hasText: '数据流程四段闭环' }).click();
    await expectVisible(page, '数据链已闭合');
    await expectVisible(page, '查看广告表现');
    await expectVisible(page, '领星任务已创建');
    await expectVisible(page, '真实报表已下载');
    await expectVisible(page, '日级指标已入库');
    await expectVisible(page, '可用于 AI+规则建议');
    await expectVisible(page, '已放行');
    await expectInBody(page, '下一步：查看广告表现，复核 ACOS、花费、订单和产品阶段。', 'data import next step after success');
    await expectVisible(page, '文件位置与用途');
    await page.locator('summary').filter({ hasText: '文件位置与用途' }).click();
    await expectVisible(page, '广告数据现在在哪');
    await expectVisible(page, '...\\storage\\downloads\\mock-batch');
    await expectVisible(page, 'SQLite 日级指标');
    await expectVisible(page, '96 行可用');
    await expectVisible(page, '审计文件不参与计算');
    await expectVisible(page, '下一步查看广告表现');
    await expectVisible(page, '导出数据对账');
    await page.getByRole('button', { name: '导出数据对账' }).first().click();
    await expectVisible(page, '数据对账已导出');
    await expectVisible(page, 'C:/AmazonAIOps/app-data/exports/data-reconciliation-mock.json');
    await expectVisible(page, 'C:/AmazonAIOps/app-data/exports/data-reconciliation-mock.md');
    await expectVisible(page, '权威口径 搜索词总盘口径 / 96 行 / $170.25 / 3 单');
    await page.getByRole('button', { name: '打开对账数据文件' }).click();
    await page.getByRole('button', { name: '打开对账说明文件' }).click();
    const afterImportScreenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-data-collection-after-import-${runId}.png`);
    await page.screenshot({ path: afterImportScreenshotPath, fullPage: true });
    evidence.pages.dataCollectionAfterImport = {
      label: '数据采集导入后',
      screenshotPath: afterImportScreenshotPath,
      bodyTextSample: (await bodyText(page)).slice(0, 1800),
  };
  await navigateBusinessPage(page, NAV_RE.productManagement, 'product-management');
  await page.locator('tr', { hasText: 'B0TESTASIN' }).getByRole('button', { name: '锁定' }).click();
  await expectVisible(page, 'D6 Sensor Light / B0TESTASIN');
  await page.locator('tr', { hasText: 'B0TESTASIN' }).getByRole('button', { name: '详情' }).click();
  await page.getByRole('button', { name: '维护', exact: true }).click();
  await expectVisible(page, '维护产品信息');
  await navigateBusinessPage(page, NAV_RE.dashboard, 'dashboard');
  await expectVisible(page, '下一安全动作');
  await expectVisible(page, '复核优化建议');
  await expectVisible(page, '当前阻塞');
  await expectVisible(page, '建议中仍有高风险或需人工复核项，不能直接进入执行。');
  await expectVisible(page, '当前产品');
  await expectVisible(page, 'B0TESTASIN');
  await expectVisible(page, '真实数据');
  await expectVisible(page, '8/8');
  await expectVisible(page, '已入库 96 行');
  await expectVisible(page, '96 行');
  await expectVisible(page, '广告表现');
  await expectVisible(page, 'ACOS 56.6%');
  await expectVisible(page, '花费 $170.25 · 销售 $300.50');
  await expectVisible(page, '$170.25');
  await expectVisible(page, '$300.50');
  await expectVisible(page, '待判断');
  await expectVisible(page, '2 条');
  await expectVisible(page, '1 条需人工复核');
  await expectVisible(page, '风险对象队列');
  await expectVisible(page, '1 个待看');
  await expectVisible(page, '查看完整诊断');
  await expectVisible(page, '管理当前产品');
  await expectNotInBody(page, '尚未生成最终证据');
  await expectNotInBody(page, '查看缺失证据');
  await expectVisible(page, '按真实花费、转化与风险判断，先处理最需要人工复核的对象。');
  await expectNotInBody(page, '任务入口会按领星任务、真实报表、DB 指标、AI+规则建议顺序推进。');
  await expectVisible(page, 'test search term');
  await expectVisible(page, '高风险待复核');
  await page.locator('summary').filter({ hasText: '数据、产品历史与交付明细' }).click();
  await expectVisible(page, '数据健康');
  await expectVisible(page, '数据门槛');
  await expectVisible(page, '8/8 类 · 96 行');
  await expectVisible(page, 'AI / 建议');
  await expectVisible(page, '1 条待审批，1 条需复核。');
  await expectVisible(page, '交付缺口');
  await expectVisible(page, '已闭合 4/7');
  await expectVisible(page, '最近文件路径');
  await expectVisible(page, '2 个入口');
  await expectVisible(page, '广告历史摘要');
  await expectVisible(page, 'ASIN B0TESTASIN · D6 Sensor Light');
  await expectVisible(page, '阶段 测词');
  await expectVisible(page, '12 天');
  await expectNotInBody(page, '日级趋势');
  await expectNotInBody(page, '事件叠加');
  const dashboardAfterImportScreenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-dashboard-after-import-${runId}.png`);
  await page.screenshot({ path: dashboardAfterImportScreenshotPath, fullPage: true });
  evidence.pages.dashboardAfterImport = {
    label: '仪表盘导入后',
    screenshotPath: dashboardAfterImportScreenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 1800),
  };
    const actionLog = await page.evaluate(() => window.__businessUiActionLog || []);
  if (!actionLog.some((item) => item.type === 'collectLingxingReports')) {
    fail('Data collection smoke did not call collection IPC mock', JSON.stringify(actionLog));
  }
  if (!actionLog.some((item) => item.type === 'downloadExistingLingxingReports')) {
    fail('Data collection smoke did not call download-existing IPC mock', JSON.stringify(actionLog));
  }
    if (!actionLog.some((item) => item.type === 'importCurrentBusinessReports')) {
    fail('Data collection smoke did not call import IPC mock', JSON.stringify(actionLog));
    }
    if (!actionLog.some((item) => item.type === 'importLocalBusinessReportFiles')) {
      fail('Data collection smoke did not call local import IPC mock', JSON.stringify(actionLog));
    }
    if (!actionLog.some((item) => item.type === 'listOperationEvents')) {
      fail('Operation events smoke did not list events', JSON.stringify(actionLog));
    }
    if (!actionLog.some((item) => item.type === 'createOperationEvent' && item.input?.eventType === 'bd')) {
      fail('Operation events smoke did not create a BD event from quick template', JSON.stringify(actionLog));
    }
    if (!actionLog.some((item) => item.type === 'openReportPath' && item.targetPath === 'C:/AmazonAIOps/storage/downloads/mock-batch/campaign.xlsx')) {
      fail('Data collection smoke did not open a concrete xlsx report file', JSON.stringify(actionLog));
    }
    if (!actionLog.some((item) => item.type === 'openReportPath' && item.targetPath === 'C:/AmazonAIOps/storage/downloads/mock-batch')) {
      fail('Data collection smoke did not open the real report download directory', JSON.stringify(actionLog));
    }
    const retryCount = actionLog.filter((item) => item.type === 'retryLingxingReport').length;
    if (retryCount !== 8) {
      fail('Selected retry smoke should call retry for all selected report types without losing full-8 state', JSON.stringify(actionLog));
    }

    await navigateBusinessPage(page, NAV_RE.adQuant, 'ad-quant');
  await page.locator('summary').filter({ hasText: '辅助口径、AI 诊断和上下文' }).click();
  await page.getByText('展开当前产品实体诊断表', { exact: false }).click();
  await expectVisible(page, '广告组合');
  await expectVisible(page, '广告活动');
  await expectVisible(page, '广告组');
  await expectVisible(page, '产品/ASIN');
  await expectVisible(page, '对象类型');
  await expectVisible(page, '关键词/搜索词/投放对象');
  await expectVisible(page, '花费');
  await expectVisible(page, '销售');
  await expectVisible(page, '订单');
  await expectVisible(page, '点击');
  await expectVisible(page, 'ACOS');
  await expectVisible(page, 'CVR');
  await expectVisible(page, 'CPC');
  await expectVisible(page, '诊断');
  await expectVisible(page, '建议方向');
  await expectVisible(page, '数据来源与量化口径');
  await expectVisible(page, '真实原始报表');
  await expectVisible(page, '导入指标行');
  await expectVisible(page, '量化口径');
  await expectVisible(page, '搜索词总盘口径');
  await expectVisible(page, '实体诊断');
  await expectVisible(page, '对象时间线');
  await expectVisible(page, '阈值与策略来源');
  await expectVisible(page, '规则量化');
  await expectVisible(page, '当前页先用确定性规则打底');
  await expectVisible(page, '最近 AI 诊断记录');
  await page.getByText('展开最近 AI 诊断记录', { exact: false }).click();
  await expectVisible(page, 'deepseek-chat');
  await expectVisible(page, 'AI 调用成功');
  await expectVisible(page, 'AI 调用失败');
  await expectVisible(page, 'AI 输出格式错误：legacy_strategy_v0');
  await expectVisible(page, '正式建议 1');
  await expectVisible(page, '洞察 1');
  await expectVisible(page, '证据包 5 条');
  await expectVisible(page, '历史证据明细');
  await expectInBody(page, 'historical test search term / 2026-06-12');
  await expectInBody(page, '行 19');
  await expectVisible(page, '2026-06-12T11:00:00.000Z');
  await expectVisible(page, 'AI 阶段诊断');
  await expectVisible(page, 'DeepSeek 会结合每日广告事实、运营事件、产品配置和规则结果，给出动态阈值和解释，不写入广告账户。');
  await expectVisible(page, '人工覆盖');
  await expectVisible(page, '执行边界');
  await expectVisible(page, '量化不直接改广告');
  await expectVisible(page, '调整规则阈值');
  await expectVisible(page, '记录运营事件');
  await expectVisible(page, '生成规则建议');
  await expectVisible(page, '建议输入检查');
  await expectVisible(page, '真实报表');
  await expectVisible(page, '8/8');
  await expectVisible(page, '指标');
  await expectVisible(page, '96 行');
  await expectVisible(page, '可建议对象');
  await expectVisible(page, '诊断');
  await expectVisible(page, '对象时间线');
  await expectVisible(page, '产品目标');
  await expectVisible(page, '运营事件');
  await expectVisible(page, '规则阈值');
  await expectVisible(page, '建议入口：可生成规则建议。按钮不会执行广告动作，只进入建议页等待审批。');
  await expectVisible(page, '输入明细和判断依据');
  await page.locator('summary').filter({ hasText: '输入明细和判断依据' }).click();
  await expectVisible(page, '真实数据输入');
  await expectVisible(page, '8/8 类真实报表 / 96 行指标');
  await expectVisible(page, '只读取当前范围真实 xlsx/xls/csv 和 DB 指标，不使用审计文件代替广告数据。');
  await expectVisible(page, '可行动对象');
  await expectVisible(page, '1 个诊断 / 12 行可建议');
  await expectVisible(page, '只有 keyword、search term、target 等可执行口径会进入建议生成。');
  await expectVisible(page, '产品阶段线索');
  await expectVisible(page, '1 条对象时间线 / 1 个产品配置');
  await expectVisible(page, 'AI 会结合对象生命周期、产品阶段、成本目标和趋势判断当前推广阶段。');
  await expectVisible(page, '运营事件');
  await expectInBody(page, '2 条事件');
  await expectVisible(page, 'Coupon、BD、调价、库存和 Listing 事件会进入 AI 上下文。');
  await expectVisible(page, '规则阈值');
  await expectVisible(page, '目标 ACOS 25.0% / 高风险 40.0% / 无订单 30 点击 / 最低花费 $10.00');
  await expectVisible(page, '产品目标');
  await expectVisible(page, '1 个产品有目标阈值');
  await expectVisible(page, '目标 ACOS、TACOS、净利率和最低价会约束 AI 阈值建议。');
  await expectVisible(page, '批次 1');
  await expectVisible(page, '真实文件 8/8');
  await expectVisible(page, 'DB 指标 96');
  await expectInBody(page, '运营事件 2');
  await expectVisible(page, '可建议对象 12');
  await expectVisible(page, '补充运营事件');
  await expectVisible(page, '生成规则建议');
  await expectVisible(page, '批次：mock_batch_scope');
  await expectVisible(page, '产品广告历史账本');
  await page.getByText('展开当前产品广告历史账本', { exact: false }).click();
  await expectVisible(page, 'B0TESTASIN');
  await expectVisible(page, '活跃 12 天');
  await expectInBody(page, '$170.25 / $300.50 / 3 单');
  await expectVisible(page, '日级趋势');
  await expectVisible(page, '2026-06-01');
  await expectVisible(page, '2026-06-12');
  await expectVisible(page, '事件叠加');
  await expectVisible(page, '10% Coupon started');
  await expectVisible(page, '测词');
  await expectVisible(page, '产品/广告对象阶段时间线');
  await page.getByText('展开当前产品对象时间线', { exact: false }).click();
  await expectVisible(page, '浪费风险');
  await expectInBody(page, '趋势：花费上升 / 销售平稳');
  await expectInBody(page, '阈值：目标 ACOS 25.0% / 高风险 40.0% / 无订单 30 点击 / 止损 $10.00');
  await expectInBody(page, '来源：当前规则配置；AI 动态阈值在“优化建议”生成时结合运营事件、产品阶段和每日趋势复核。');
  await expectVisible(page, '主要问题摘要');
  await expectVisible(page, '无订单花费');
  await expectVisible(page, '复核队列');
  await expectVisible(page, '风险 ACOS 40.0%');
  await expectVisible(page, '#1 ACOS 高于 40.0%');
  await expectVisible(page, '复核队列只用于决定先看哪几行；真正的广告动作仍需进入优化建议、审批和结果核对。');
  await page.getByRole('button', { name: '运行 AI 阶段分析', exact: true }).first().click();
  await expectVisible(page, 'AI 动态阈值建议');
  await expectVisible(page, 'AI 与规则诊断状态');
  await expectVisible(page, 'AI 判断当前处于测词，可用于动态阈值复核。');
  await expectVisible(page, '可生成 AI+规则建议');
  await expectVisible(page, '可以进入优化建议，但正式动作仍需审批和结果核对。');
  await expectVisible(page, '模型：deepseek-chat；输入 96 行广告指标、1 条规则候选、2 条运营事件、1 个产品配置。');
  await expectInBody(page, '引用证据包：共 5 条，其中报表指标 1、对象时间线 1、运营事件 1、产品配置 1、规则候选 1。');
  await expectVisible(page, 'Coupon 和 BD 背景显示该产品仍处于测词阶段，同时需要收紧高 ACOS 浪费对象。');
  await expectInBody(page, 'AI 阶段判断：测词。为什么这么判断：搜索词花费和促销事件显示仍处于测词阶段。 引用证据 1 条。');
  await expectVisible(page, 'AI 已参与');
  await expectVisible(page, 'AI 候选 1');
  await expectVisible(page, '洞察未采纳 1');
  await expectVisible(page, '产品配置 1');
  await expectVisible(page, 'AI 判断依据');
  await expectInBody(page, '阶段证据：对象时间线 / product B0TESTASIN / keyword_exploration / 12 days');
  await expectInBody(page, '$170.25 / $300.50 / 3 单 / 88 点击');
  await expectVisible(page, 'AI 证据明细');
  await expectVisible(page, '引用状态');
  await expectVisible(page, '已被 AI 引用');
  await expectVisible(page, '报表指标');
  await expectInBody(page, 'test search term / 2026-06-12');
  await expectInBody(page, '$170.25 / $300.50 / 3 单 / 88 点击');
  await expectVisible(page, '对象时间线');
  await expectVisible(page, 'product B0TESTASIN / keyword_exploration / 12 days');
  await expectVisible(page, '阶段 测词 / 活跃 12 天 / 2026-06-01 至 2026-06-12');
  await expectInBody(page, '最近日级：2026-06-01 $22.50 / 0 单；2026-06-08 $63.20 / 1 单；2026-06-12 $84.55 / 2 单');
  await expectVisible(page, '运营事件');
  await expectVisible(page, '10% Coupon started');
  await expectVisible(page, '产品配置');
  await expectVisible(page, 'B0TESTASIN / keyword_exploration');
  await expectVisible(page, '目标 ACOS 对比');
  await expectVisible(page, '规则 25.0% / AI 35.0%');
  await expectInBody(page, 'AI 更宽松 10.0%。AI 理由：产品目标 ACOS 和探索阶段允许更高容忍度。 引用证据 2 条。');
  await expectVisible(page, '高风险 ACOS 对比');
  await expectVisible(page, '规则 40.0% / AI 55.0%');
  await expectInBody(page, '复核原因：AI 阈值建议缺少指标或对象时间线证据。');
  await expectVisible(page, '无订单点击 对比');
  await expectVisible(page, '规则 30 点击 / AI 18 点击');
  await expectVisible(page, '最低花费 对比');
  await expectVisible(page, '规则 $10.00 / AI $15.00');
  await expectVisible(page, 'AI 洞察但未采纳的候选动作');
  await expectVisible(page, '未绑定洞察词');
  await expectInBody(page, '未进入优化建议池');
  await expectVisible(page, '最终采用方式');
  await expectInBody(page, '规则阈值继续作为确定性安全边界；AI 阈值只作为当前范围的阶段诊断建议。');
  await page.evaluate(() => {
    window.__mockAdQuantAiFallback = true;
  });
  await page.getByRole('button', { name: '运行 AI 阶段分析', exact: true }).first().click();
  await expectVisible(page, '规则兜底阈值建议');
  await expectVisible(page, '规则兜底');
  await expectVisible(page, 'AI 未连接：当前只使用规则量化。可在设置页测试 DeepSeek 后重新分析。');
  const adQuantActionLog = await page.evaluate(() => window.__businessUiActionLog || []);
  if (adQuantActionLog.filter((item) => item.type === 'runAdStrategyDiagnosis').length < 2) {
    fail('Ad quant smoke did not call AI strategy diagnosis for success and fallback states', JSON.stringify(adQuantActionLog));
  }
  if (!adQuantActionLog.some((item) => item.type === 'listAiDiagnosisRuns' && item.params?.limit === 5)) {
    fail('Ad quant smoke did not request recent AI diagnosis runs', JSON.stringify(adQuantActionLog));
  }
  await expectVisible(page, '量化后动作');
  await expectVisible(page, '可以进入优化建议，但仍需人工审批和回读。');
  await expectVisible(page, '去生成优化建议');
  await page.getByText('总盘使用搜索词报表汇总，避免广告活动/广告组/投放位置等报表重复累加。', { exact: false }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, 'test search term');
  const adQuantAfterImportScreenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-ad-quant-after-import-${runId}.png`);
    await page.screenshot({ path: adQuantAfterImportScreenshotPath, fullPage: true });
    evidence.pages.adQuantAfterImport = {
      label: '广告表现导入后',
      screenshotPath: adQuantAfterImportScreenshotPath,
      bodyTextSample: (await bodyText(page)).slice(0, 1800),
    };

    if (evidence.consoleErrors.length > 0) {
    fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
    }

    const evidencePath = path.join(evidenceDir, `business-ui-data-pipeline-smoke-${runId}.json`);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`[PASS] business UI data pipeline smoke evidence: ${evidencePath}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
