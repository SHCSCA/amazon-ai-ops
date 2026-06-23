const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const NAV_RE = {
  keyword: /关键词机会矩阵|关键词机会/,
  listing: /Listing 结构重写|Listing 优化/,
};

function fail(message, details) {
  const error = details ? `${message}: ${details}` : message;
  throw new Error(error);
}

async function main() {
  if (!fs.existsSync(rendererIndex)) {
    fail('Renderer build not found. Run pnpm --filter @amazon-ai-ops/desktop run build:renderer first', rendererIndex);
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    generatedAt: new Date().toISOString(),
    rendererIndex,
    calls: [],
    clipboardText: '',
    screenshotPath: '',
  };

  const server = await startStaticServer(rendererDir);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      evidence.calls.push({ type: 'console-error', text: message.text() });
    }
  });

  await page.addInitScript(() => {
    const calls = [];
    const opportunities = [{
      asin: 'B001',
      keyword: 'insulated travel mug',
      normalizedKeyword: 'insulated travel mug',
      opportunityLevel: 'high',
      score: 91,
      portfolioName: 'D6 Portfolio',
      campaignName: 'D6 Listing Campaign',
      adGroupName: 'D6 Listing Ad Group',
      entityType: 'user_search_term',
      coverageStatus: '待 Listing 覆盖核对',
      recommendedPlacement: '优先进入标题/五点或精准词库',
      risk: '需结合 Listing 相关性复核',
      sourceFile: 'C:/mock/search-term.xlsx',
      clicks: 42,
      orders: 3,
      spend: 170.25,
      sales: 238.5,
      acos: 0.714,
      evidence: 'clicks=42,orders=3,impressions=900,cost=170.25,sales=238.5,acos=71.4%,cvr=7.1%,source=search_term,source_file=C:/mock/search-term.xlsx,source_row=12',
      riskFlags: [],
      recommendedSections: ['title', 'bullet'],
    }];
    const suggestions = [{
      asin: 'B001',
      keyword: 'insulated travel mug',
      section: 'title',
      currentText: 'Old title',
      suggestedText: 'New insulated travel mug title',
      evidence: 'orders=3, spend=170.25, row=12',
      riskWarnings: [],
      status: 'pending',
    }];
    const drafts = [{
      asin: 'B001',
      section: 'title',
      currentText: 'Old title',
      draftedText: 'New insulated travel mug title',
      keywords: ['insulated travel mug'],
      evidence: 'orders=3, spend=170.25, row=12',
      riskWarnings: [],
      source: 'rule',
      aiFallbackReason: '未配置 AI Key，使用规则草案',
      status: 'pending',
    }];

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__clipboardText = text;
          calls.push({ method: 'clipboard.writeText', text });
        },
      },
    });

    window.__smokeCalls = calls;
    window.__clipboardText = '';
    const reportTypes = ['campaign', 'ad_group', 'placement', 'advertised_product', 'auto_targeting', 'keyword', 'product_targeting', 'user_search_term'];
    const readyPipeline = {
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
        batchId: 'listing_draft_smoke_batch',
      },
      generatedAt: '2026-06-12T10:00:00.000Z',
      collection: {
        status: 'ready',
        latestBatch: { id: 'listing_draft_smoke_batch', status: 'completed' },
        sourceBatchIds: ['listing_draft_smoke_batch'],
        availableBatches: [],
        reportOptions: reportTypes.map((type) => ({ type, label: type, status: 'downloaded', realFileAvailable: true, importedRows: 12 })),
        realReportFiles: reportTypes.map((type, index) => ({
          id: `file_${type}`,
          reportType: type,
          displayName: type,
          status: 'downloaded',
          filePath: `C:/mock/${type}.xlsx`,
          folderPath: 'C:/mock',
          fileName: `${type}.xlsx`,
          fileSizeBytes: 2048 + index,
          importedRows: 12,
        })),
        evidencePaths: [],
        fileAudit: {
          totalFileRecords: 8,
          downloadedFileRecords: 8,
          existingFileRecords: 8,
          realReportFileCount: 8,
          importedRowCount: 96,
          rejectedEvidenceFileCount: 0,
          missingReportLabels: [],
        },
        blockers: [],
        audit: { databaseReady: true, acceptedExtensions: ['.xlsx', '.xls', '.csv'], rejectedEvidenceExtensions: ['.json', '.png', '.html'], notes: [] },
      },
      quant: {
        hasImportedMetrics: true,
        importedRows: 96,
        summarySource: 'mock',
        totalSpend: 170.25,
        totalSales: 238.5,
        totalOrders: 3,
        totalClicks: 42,
        totalImpressions: 900,
        acos: 0.714,
        cvr: 0.071,
        cpc: 4.05,
        wastedSpend: 0,
        highRiskCount: 0,
        adObjectTimelines: [],
        diagnostics: [],
        blockers: [],
      },
      operations: { events: [], eventCount: 0, notes: [] },
      productContext: { products: [], productCount: 0, notes: [] },
    };
    window.electronAPI = {
      getVersion: async () => '1.5.0',
      getState: async () => ({ isLoggedIn: true, currentStore: 'SHC001', loginSession: { erpSessionReused: true, adsTitle: '仪表盘' } }),
      getBusinessUiDataPipeline: async () => readyPipeline,
      listOperationEvents: async () => [],
      getSettings: async () => ({
        aiApiKey: '',
        aiKeyConfigured: false,
        aiBaseUrl: 'https://api.deepseek.com',
        aiModel: 'deepseek-v4-flash',
        aiLastTestStatus: '',
        aiLastTestBaseUrl: '',
        aiLastTestModel: '',
        aiLastTestMessage: '',
      }),
      getBusinessKeywordOpportunities: async () => opportunities,
      getDownloadCenterPageModel: async () => ({
        source: 'mock',
        path: 'mock-page-model.json',
        model: { name: 'mock', requiresManualVerification: true },
        readiness: { ready: false, reason: 'mock' },
      }),
      selectReportFile: async () => 'C:/mock/search-term.xlsx',
      importKeywordReport: async () => ({
        metrics: [{
          asin: 'B001',
          normalizedKeyword: 'insulated travel mug',
          rawKeyword: 'insulated travel mug',
          source: 'search_term',
          clicks: 42,
          orders: 3,
          cost: 170.25,
          sales: 238.5,
        }],
        diagnostics: null,
        opportunities,
        metricsCount: 1,
      }),
      analyzeListingCoverage: async () => [{ normalizedKeyword: 'insulated travel mug', covered: false, sections: [], strength: 0 }],
      buildKeywordOpportunities: async () => opportunities,
      buildListingSuggestions: async () => suggestions,
      updateListingSuggestionStatus: async () => ({ success: true }),
      saveManualListingContent: async (listing) => ({
        ...listing,
        versionId: 1,
        source: 'manual',
        updatedAt: '2026-06-12T10:05:00.000Z',
      }),
      listListingContentVersions: async () => [],
      generateListingDrafts: async (items) => {
        calls.push({ method: 'generateListingDrafts', statuses: items.map((item) => item.status) });
        return drafts;
      },
      exportListingDrafts: async (_drafts, format) => {
        calls.push({ method: 'exportListingDrafts', format, draftCount: _drafts.length });
        return `C:/Users/wz/AppData/Roaming/@amazon-ai-ops/desktop/storage/exports/listing_drafts_smoke.${format}`;
      },
      openReportPath: async (targetPath) => {
        calls.push({ method: 'openReportPath', targetPath });
        return { success: true };
      },
    };
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  if (!(await page.getByRole('button', { name: NAV_RE.keyword }).count())) {
    const debugScreenshot = path.join(evidenceDir, `listing-draft-renderer-debug-${Date.now()}.png`);
    await page.screenshot({ path: debugScreenshot, fullPage: true });
    const bodyText = await page.locator('body').innerText().catch(() => '');
    await browser.close();
    server.close();
    fail('Renderer did not show the authenticated app shell', `${debugScreenshot}\n${bodyText.slice(0, 1000)}`);
  }
  await page.getByRole('button', { name: NAV_RE.keyword }).click();

  await page.getByRole('button', { name: '刷新机会' }).click();
  await page.getByText('insulated travel mug').first().waitFor();
  await page.getByRole('button', { name: '带入 Listing' }).first().click();
  await page.getByRole('button', { name: NAV_RE.listing }).click();
  await page.getByLabel('ASIN').fill('B001');
  await page.getByLabel('标题').fill('Old title');
  await page.getByLabel('五点 1').fill('Keeps drinks hot');
  await page.getByLabel('后台搜索词').fill('travel mug');
  await page.getByRole('button', { name: '保存为新版本' }).click();
  await page.getByText('已保存为 Listing 版本', { exact: false }).waitFor();
  await page.getByRole('button', { name: '生成本地草案' }).click();

  await page.getByText('当前文本', { exact: true }).waitFor();
  if ((await page.getByText('Old title').count()) < 1) fail('Current text was not visible');
  await page.getByText('草案文本', { exact: true }).waitFor();
  if ((await page.getByText('New insulated travel mug title').count()) < 1) fail('Drafted text was not visible');
  if ((await page.getByText('orders=3, spend=170.25, row=12').count()) < 1) fail('Draft evidence was not visible');
  await page.getByText('规则兜底 / 未配置 AI Key，使用规则草案').waitFor();

  await page.getByRole('button', { name: '导出草案' }).click();
  await page.getByText('已导出 Listing 草案', { exact: false }).waitFor();

  evidence.calls = await page.evaluate(() => window.__smokeCalls || []);
  evidence.clipboardText = await page.evaluate(() => window.__clipboardText || '');
  evidence.screenshotPath = path.join(evidenceDir, `listing-draft-renderer-smoke-${Date.now()}.png`);
  await page.screenshot({ path: evidence.screenshotPath, fullPage: true });
  await browser.close();
  server.close();

  const generateCall = evidence.calls.find((call) => call.method === 'generateListingDrafts');
  if (!generateCall) fail('generateListingDrafts was not called');
  if (!generateCall.statuses.every((status) => status === 'pending')) {
    fail('Draft generation received unexpected suggestion statuses', JSON.stringify(generateCall.statuses));
  }
  if (!evidence.calls.some((call) => call.method === 'exportListingDrafts' && call.format === 'xlsx' && call.draftCount === 1)) {
    fail('Draft XLSX export was not called with one draft');
  }

  const evidencePath = path.join(evidenceDir, `listing-draft-renderer-smoke-${Date.now()}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] Listing draft renderer smoke evidence: ${evidencePath}`);
  console.log(`[PASS] Screenshot: ${evidence.screenshotPath}`);
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
        url: `http://127.0.0.1:${address.port}/`,
        close: () => server.close(),
      });
    });
  });
}

main().catch((error) => {
  console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
