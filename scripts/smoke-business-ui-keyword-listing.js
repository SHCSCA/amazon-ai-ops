const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function assertScopeParams(params, context) {
  const expected = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    batchId: 'manual_keyword_listing_batch',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (params?.[key] !== value) fail(`Unexpected ${context} scope param ${key}`, JSON.stringify(params));
  }
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
      resolve({ url: `http://127.0.0.1:${address.port}/index.html`, close: () => server.close() });
    });
  });
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function expectVisible(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor({ timeout: 5000 });
}

async function expectNotInBody(page, text) {
  const textContent = await bodyText(page);
  if (textContent.includes(text)) fail(`Unexpected visible text: ${text}`);
}

async function expectInBody(page, text, details) {
  const textContent = await bodyText(page);
  if (!textContent.includes(text)) fail(`Expected visible text not found: ${text}`, details);
}

async function assertGlobalGuards(page, key) {
  const textContent = await bodyText(page);
  if (!textContent.includes('USD')) fail('USD currency marker is missing', key);
  for (const forbiddenCurrencyText of ['¥', '￥', 'RMB', 'CNY', '人民币']) {
    if (textContent.includes(forbiddenCurrencyText)) fail('RMB currency marker is visible', `${key}: ${forbiddenCurrencyText}`);
  }
  if (textContent.includes('APP_READY')) fail('False APP_READY state is visible', key);
  if (textContent.includes('v1.5 工作台')) fail('Old v1.5 workbench is visible', key);
  if (textContent.includes('pnpm run verify:ad-readback')) fail('Readback command wall is visible', key);
  if (textContent.includes('create:ad-readback-template')) fail('Readback template command is visible', key);
}

async function main() {
  if (!fs.existsSync(rendererIndex)) {
    fail('Renderer build not found. Run pnpm --filter @amazon-ai-ops/desktop run build:renderer first', rendererIndex);
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const evidence = { generatedAt: new Date().toISOString(), rendererIndex, pages: {}, consoleErrors: [] };

  let server;
  let browser;

  try {
    server = await startStaticServer(rendererDir);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1480, height: 1080 } });
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });

  await page.addInitScript(() => {
    const readyPipeline = {
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
        batchId: 'batch_keyword_listing_mock',
      },
      generatedAt: '2026-06-12T10:00:00.000Z',
      collection: {
        status: 'ready',
        latestBatch: { id: 'batch_keyword_listing_mock', status: 'completed' },
        sourceBatchIds: ['batch_keyword_listing_mock'],
        availableBatches: [{
          id: 'batch_keyword_listing_mock',
          status: 'completed',
          dateStart: '2026-06-01',
          dateEnd: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          downloadDir: 'C:/reports',
          totalFileRecords: 1,
          realReportFileCount: 1,
          importedRowCount: 42,
          missingReportLabels: [],
        }],
        reportOptions: [],
        fileAudit: {
          totalFileRecords: 8,
          downloadedFileRecords: 8,
          existingFileRecords: 8,
          realReportFileCount: 8,
          importedRowCount: 96,
          rejectedEvidenceFileCount: 0,
          missingReportLabels: [],
          downloadDir: 'C:/reports',
          manifestPath: 'C:/reports/manifest.json',
        },
        realReportFiles: [
          {
            id: 'file_keyword',
            reportType: 'keyword',
            displayName: '关键词报告',
            status: 'downloaded',
            filePath: 'C:/reports/keyword.xlsx',
            folderPath: 'C:/reports',
            fileName: 'keyword.xlsx',
            fileSizeBytes: 2048,
            importedRows: 42,
          },
        ],
        evidencePaths: [],
        blockers: [],
        audit: { databaseReady: true, acceptedExtensions: ['.xlsx', '.csv'], rejectedEvidenceExtensions: ['.json', '.png', '.html'], notes: [] },
      },
      quant: {
        hasImportedMetrics: true,
        importedRows: 42,
        totalSpend: 128.45,
        totalSales: 310.9,
        totalOrders: 9,
        totalClicks: 188,
        totalImpressions: 12300,
        acos: 0.413,
        cvr: 0.047,
        cpc: 0.68,
        wastedSpend: 12.25,
        highRiskCount: 1,
        diagnostics: [],
        blockers: [],
      },
    };
    window.__businessUiActionLog = [];
    window.electronAPI = {
      getState: async () => ({
        isLoggedIn: true,
        currentStore: 'FT-US-US',
        loginSession: { erpSessionReused: true, adsTitle: 'Amazon AI Ops' },
      }),
      browserLogout: async () => ({ success: true }),
      getBusinessUiDataPipeline: async () => readyPipeline,
      getBusinessBatchOptions: async () => readyPipeline.collection.availableBatches,
      getSettings: async () => ({
        aiApiKey: '',
        aiKeyConfigured: true,
        aiBaseUrl: 'https://api.deepseek.com',
        aiModel: 'deepseek-v4-flash',
        aiTemperature: '0.3',
        aiMaxTokens: '700',
        aiLastTestStatus: 'available',
        aiLastTestAt: '2026-06-15T06:00:00.000Z',
        aiLastTestBaseUrl: 'https://api.deepseek.com',
        aiLastTestModel: 'deepseek-v4-flash',
        aiLastTestMessage: 'AI 连接测试通过：deepseek-v4-flash',
      }),
      getBusinessKeywordOpportunities: async (scope) => {
        window.__businessUiActionLog.push({ type: 'getBusinessKeywordOpportunities', scope });
        return [
          {
            asin: 'B0TESTASIN',
            portfolioName: 'D6 Portfolio',
            campaignName: 'D6-auto-test',
            adGroupName: 'D6-ad-group',
            entityType: 'user_search_term',
            keyword: 'motion sensor wall light',
            coverageStatus: '待 Listing 覆盖核对',
            clicks: 36,
            orders: 4,
            spend: 25.5,
            sales: 98.25,
            acos: 0.2595,
            opportunityLevel: 'high',
            recommendedPlacement: '优先进入标题/五点或精准词库',
            risk: '需结合 Listing 相关性复核',
            sourceFile: 'C:/reports/keyword.xlsx',
          },
          {
            asin: 'B0TESTASIN',
            portfolioName: 'D6 Portfolio',
            campaignName: 'D6-manual-test',
            adGroupName: 'D6-research-group',
            entityType: 'user_search_term',
            keyword: 'motion sensor wall light',
            coverageStatus: '待 Listing 覆盖核对',
            clicks: 14,
            orders: 0,
            spend: 11.75,
            sales: 0,
            acos: 0,
            opportunityLevel: 'medium',
            recommendedPlacement: '先复核相关性，再决定是否进入五点或后台词',
            risk: '同词不同广告组，需单独判断',
            sourceFile: 'C:/reports/keyword.xlsx',
          },
        ];
      },
      extractListingFromLingxing: async (options) => {
        window.__businessUiActionLog.push({ type: 'extractListingFromLingxing', options });
        return {
          ready: true,
          partialReady: true,
          fullContentReady: true,
          listing: {
            asin: 'B0TESTASIN',
            title: 'Rechargeable Motion Sensor Wall Light',
            bullets: ['Motion sensor lighting for closets', 'USB rechargeable battery'],
            backendTerms: 'closet light wall sconce',
          },
          evidence: {
            pageUrl: 'https://erp.lingxing.com/erp/listing/mock',
            screenshotPath: 'C:/evidence/listing-read.png',
            completeness: { asin: true, title: true, bullets: true, backendTerms: true },
            detailProbe: { asinMatched: true, status: 'matched', finalUrl: 'https://erp.lingxing.com/erp/listing/mock/detail' },
          },
        };
      },
      probeLingxingListingDetailAndExtract: async (options) => {
        window.__businessUiActionLog.push({ type: 'probeLingxingListingDetailAndExtract', options });
        if (window.__mockEvidenceOnlyListingRead) {
          return {
            ready: false,
            partialReady: true,
            fullContentReady: false,
            reason: '当前页面已探测，但未解析到 ASIN、标题、五点或后台词。',
            evidence: {
              pageUrl: 'https://erp.lingxing.com/erp/listing/mock/unparsed',
              screenshotPath: 'C:/evidence/listing-read-unparsed.png',
              completeness: { asin: false, title: false, bullets: false, backendTerms: false },
              detailProbe: {
                asinMatched: false,
                status: 'no_asin',
                finalUrl: 'https://erp.lingxing.com/erp/listing/mock/unparsed',
                reason: '当前页面未读取到 ASIN。',
              },
            },
          };
        }
        if (window.__mockPartialListingRead) {
          return {
            ready: true,
            partialReady: true,
            fullContentReady: false,
            listing: {
              asin: 'B0TESTASIN',
              title: 'Rechargeable Motion Sensor Wall Light',
              bullets: [],
              backendTerms: '',
            },
            evidence: {
              pageUrl: 'https://erp.lingxing.com/erp/listing/mock/detail',
              screenshotPath: 'C:/evidence/listing-read-partial.png',
              completeness: { asin: true, title: true, bullets: false, backendTerms: false },
              detailProbe: { asinMatched: true, status: 'partial_after_probe', finalUrl: 'https://erp.lingxing.com/erp/listing/mock/detail' },
            },
          };
        }
        return {
          ready: true,
          partialReady: true,
          fullContentReady: true,
          listing: {
            asin: 'B0TESTASIN',
            title: 'Rechargeable Motion Sensor Wall Light',
            bullets: ['Motion sensor lighting for closets', 'USB rechargeable battery'],
            backendTerms: 'closet light wall sconce',
          },
          evidence: {
            pageUrl: 'https://erp.lingxing.com/erp/listing/mock/detail',
            screenshotPath: 'C:/evidence/listing-read.png',
            completeness: { asin: true, title: true, bullets: true, backendTerms: true },
            detailProbe: { asinMatched: true, status: 'full_content_ready', finalUrl: 'https://erp.lingxing.com/erp/listing/mock/detail' },
          },
        };
      },
      generateListingDrafts: async (suggestions) => {
        window.__businessUiActionLog.push({ type: 'generateListingDrafts', suggestions });
        return suggestions.map((suggestion, index) => ({
          id: index + 1,
          asin: suggestion.asin,
          section: suggestion.section,
          currentText: suggestion.currentText,
          draftedText: `${suggestion.suggestedText} - optimized draft`,
          keywords: [suggestion.keyword],
          evidence: 'AI 理由：关键词来自当前范围，草案仅本地保存',
          riskWarnings: ['需人工复核相关性'],
          source: index === 0 ? 'ai' : 'rule',
          aiFallbackReason: index === 0 ? undefined : '模拟规则兜底状态',
          status: 'pending',
          createdAt: '2026-06-12T10:01:00.000Z',
        }));
      },
      exportListingDrafts: async (drafts) => {
        window.__businessUiActionLog.push({ type: 'exportListingDrafts', count: drafts.length });
        return 'C:/exports/listing_drafts_mock.xlsx';
      },
      openReportPath: async () => ({ success: true }),
    };
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.localStorage.setItem('amazon-ai-ops-listing-handoff', JSON.stringify({
      asin: 'B0STALEASIN',
      keywords: ['stale keyword should not appear'],
      source: 'keyword-opportunities',
      createdAt: '2026-06-12T09:30:00.000Z',
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        batchId: 'stale_keyword_listing_batch',
      },
    }));
  });
  await page.locator('.app-sidebar').getByRole('button', { name: /Listing 优化/ }).click();
  await page.getByRole('heading', { name: 'Listing 优化', level: 2 }).waitFor();
  await expectInBody(page, '已忽略过期关键词机会带入：数据批次不一致', 'stale handoff should be rejected in auto batch mode');
  await expectNotInBody(page, 'stale keyword should not appear');
  const staleHandoffCache = await page.evaluate(() => window.localStorage.getItem('amazon-ai-ops-listing-handoff'));
  if (staleHandoffCache !== null) fail('Stale Listing handoff cache was not cleared', staleHandoffCache);

  await page.getByLabel('数据批次来源').selectOption('__manual__');
  await page.getByRole('textbox', { name: '数据批次', exact: true }).fill('manual_keyword_listing_batch');
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('manual_keyword_listing_batch'), null, { timeout: 5000 });
  await expectNotInBody(page, '¥');
  await expectNotInBody(page, '￥');
  await expectNotInBody(page, 'RMB');
  await expectNotInBody(page, 'CNY');
  await expectNotInBody(page, '人民币');
  await expectNotInBody(page, 'APP_READY');
  await expectNotInBody(page, 'v1.5 工作台');
  await expectNotInBody(page, 'pnpm run verify:ad-readback');

  await page.locator('.app-sidebar').getByRole('button', { name: /关键词机会/ }).click();
  await page.getByRole('heading', { name: '关键词机会', level: 2 }).waitFor();
  await expectVisible(page, '机会来源');
  await expectVisible(page, '关键词机会来源与覆盖关系');
  await expectVisible(page, '真实广告报表');
  await expectVisible(page, '导入指标行');
  await page.locator('.context-summary-grid').filter({ hasText: '导入指标行' }).getByText('96', { exact: true }).waitFor({ timeout: 5000 });
  await expectVisible(page, '覆盖 ASIN');
  await expectVisible(page, '这里是广告数据到 Listing 的交接池，不读取 Listing 页面，也不会修改 Amazon；点击“带入 Listing”后仍需在 Listing 优化页读取真实 Listing 并人工复核。');
  await expectVisible(page, '机会摘要');
  await expectVisible(page, '高优先级机会');
  await expectVisible(page, '无订单花费');
  await expectVisible(page, '优先复核对象');
  await expectVisible(page, 'manual_keyword_listing_batch');
  await expectVisible(page, '筛选');
  await expectVisible(page, '当前日期范围');
  await expectVisible(page, '店铺 / 站点');
  await expectVisible(page, '广告上下文');
  await expectVisible(page, '2 个活动 / 2 个广告组');
  await expectVisible(page, '关键词机会表');
  for (const text of ['ASIN', '广告组合', '广告活动', '广告组', '关键词/搜索词/投放对象', '覆盖状态', '点击/订单', '花费/销售', 'ACOS', '机会等级', '建议位置', '风险']) {
    await expectVisible(page, text);
  }
  await expectVisible(page, 'motion sensor wall light');
  await expectVisible(page, 'D6-ad-group');
  await expectVisible(page, 'D6-research-group');
  await page.getByLabel('Ad Group').fill('D6-research-group');
  await expectVisible(page, '同词不同广告组，需单独判断');
  await expectNotInBody(page, '36 / 4');
  await page.getByLabel('Ad Group').fill('');
  await expectVisible(page, '36 / 4');
  await assertGlobalGuards(page, 'keyword-opportunities');
  const keywordScreenshotPath = path.join(evidenceDir, `business-ui-keyword-listing-keywords-${runId}.png`);
  await page.screenshot({ path: keywordScreenshotPath, fullPage: true });
  evidence.pages['keyword-opportunities'] = {
    label: '关键词机会',
    screenshotPath: keywordScreenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 1800),
  };
  await page.getByRole('button', { name: '来源详情' }).first().click();
  await expectVisible(page, '数据口径');
  await expectVisible(page, '店铺/站点/ASIN/广告活动/广告组/对象类型/关键词去重');
  await expectVisible(page, '来源文件');
  await expectVisible(page, 'C:/reports/keyword.xlsx');
  await page.getByRole('button', { name: '带入 Listing' }).first().click();

  await page.locator('.app-sidebar').getByRole('button', { name: /Listing 优化/ }).click();
  await page.getByRole('heading', { name: 'Listing 优化', level: 2 }).waitFor();
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('textarea')).some((item) => item.value.includes('motion sensor wall light')),
    null,
    { timeout: 5000 },
  );
  for (const text of ['Listing 来源', '关键词交接与草案边界', '关键词来源', '带入 ASIN', '草案来源', 'AI 连接', 'Listing AI 可用', '本页只生成本地草案和导出文件，不提交 Amazon，不修改 Lingxing Listing。', '当前 Listing 内容', '关键词覆盖', '本地修改建议与草案导出', '草案可信度', '可引用当前广告数据', '草案只保存在本地，不会自动提交 Amazon。']) {
    await expectVisible(page, text);
  }
  await expectInBody(page, 'deepseek-v4-flash 已测试通过', 'listing ai readiness detail');
  for (const text of ['Listing 工作流状态', '1 关键词机会', '2 领星 Listing 读取', '3 AI / 规则草案', '4 导出与发布边界']) {
    await expectInBody(page, text, 'listing workflow status');
  }
  await expectVisible(page, '当前主任务');
  await expectVisible(page, '关键词已就绪，但 Listing 读取未达到生成草案门槛。');
  await expectVisible(page, '尚未读取领星 Listing 页面');
  for (const text of ['广告组合', 'D6 Portfolio', '广告活动', 'D6-auto-test', '广告组', 'D6-ad-group', '对象类型', 'user_search_term', '触发关键词', 'motion sensor wall light', '点击/订单', '36 / 4', '花费/销售 USD', '25.5 / 98.25', '来源文件', 'C:/reports/keyword.xlsx']) {
    await expectVisible(page, text);
  }
  await page.evaluate(() => {
    window.__mockEvidenceOnlyListingRead = true;
  });
  await page.getByRole('button', { name: '从当前领星页面读取' }).click();
  await expectVisible(page, '已探测页面，但没有解析到可用 Listing 内容');
  await expectVisible(page, '已探测未解析');
  await expectInBody(page, 'no_asin', 'listing evidence-only detail probe status');
  await expectVisible(page, 'https://erp.lingxing.com/erp/listing/mock/unparsed');
  await expectVisible(page, 'C:/evidence/listing-read-unparsed.png');
  await expectInBody(page, '当前页面已探测，但未解析到 ASIN、标题、五点或后台词。', 'listing evidence-only read guidance');
  await page.getByRole('button', { name: '生成本地草案' }).evaluate((node) => {
    if (!node.disabled) throw new Error('Draft generation button should stay disabled for evidence-only Listing read');
  });
  await page.evaluate(() => {
    window.__mockEvidenceOnlyListingRead = false;
  });
  await page.evaluate(() => {
    window.__mockPartialListingRead = true;
  });
  await page.getByRole('button', { name: '从当前领星页面读取' }).click();
  await expectVisible(page, '已读取 Listing 部分内容，生成草案前需补齐缺失字段');
  await expectVisible(page, '已读取部分内容');
  await expectVisible(page, 'Bullets read');
  await expectVisible(page, '缺失');
  await expectVisible(page, 'Backend terms read');
  await expectVisible(page, 'Listing 读取缺口');
  await expectInBody(page, '生成草案前需补齐：五点缺失、后台词缺失', 'partial listing field-level blockers');
  await expectInBody(page, '详情页已读取但 Listing 内容不完整', 'partial listing read guidance');
  await page.getByRole('button', { name: '生成本地草案' }).evaluate((node) => {
    if (!node.disabled) throw new Error('Draft generation button should stay disabled for partial Listing read');
  });
  await page.evaluate(() => {
    window.__mockPartialListingRead = false;
  });
  await page.getByRole('button', { name: '从当前领星页面读取' }).click();
  await expectVisible(page, 'ASIN matched/status');
  await expectVisible(page, 'Title read');
  await expectVisible(page, 'Bullets read');
  await expectVisible(page, 'Backend terms read');
  await expectVisible(page, 'Page URL');
  await expectVisible(page, 'Screenshot path');
  await expectVisible(page, '范围核对');
  await expectVisible(page, '当前店铺/站点');
  await expectVisible(page, '读取店铺/站点');
  await expectVisible(page, 'B0TESTASIN');
  await expectVisible(page, '目标 ASIN');
  await expectVisible(page, '页面匹配');
  await expectVisible(page, '通过');
  await expectInBody(page, 'Listing 读取缺口', 'complete listing readiness section');
  await expectInBody(page, '无，当前页面已满足草案门槛。', 'complete listing no blocker message');
  await expectVisible(page, 'Rechargeable Motion Sensor Wall Light');
  await expectVisible(page, '关键词和 Listing 已就绪，可以生成本地草案。');
  await page.getByRole('button', { name: '生成本地草案' }).click();
  await page.getByText('已生成 1 条 AI 草案', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, '已有 1 条本地 Listing 草案，可导出给运营复核。');
  await expectVisible(page, '导出草案并人工复核，不自动提交 Amazon 或改写 Lingxing Listing。');
  await expectVisible(page, '1 AI / 0 规则');
  await expectInBody(page, '条草案可导出', 'listing export readiness');
  await expectVisible(page, '标题');
  await expectVisible(page, '五点');
  await expectNotInBody(page, 'backend_terms');
  await expectInBody(page, 'AI', 'listing draft source');
  await expectInBody(page, 'AI 理由：关键词来自当前范围，草案仅本地保存', 'listing draft evidence');
  await page.getByRole('button', { name: '导出草案' }).click();
  await page.getByText('已导出 Listing 草案', { exact: false }).waitFor({ timeout: 5000 });
  await assertGlobalGuards(page, 'listing-optimization');
  const listingScreenshotPath = path.join(evidenceDir, `business-ui-keyword-listing-listing-${runId}.png`);
  await page.screenshot({ path: listingScreenshotPath, fullPage: true });
  evidence.pages['listing-optimization'] = {
    label: 'Listing 优化',
    screenshotPath: listingScreenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 2200),
  };

  const actionLog = await page.evaluate(() => window.__businessUiActionLog || []);
  const keywordCalls = actionLog.filter((item) => item.type === 'getBusinessKeywordOpportunities');
  if (!keywordCalls.length) {
    fail('Keyword opportunities IPC mock was not called', JSON.stringify(actionLog));
  }
  for (const call of keywordCalls) assertScopeParams(call.scope, 'getBusinessKeywordOpportunities');
  for (const requiredAction of ['probeLingxingListingDetailAndExtract', 'generateListingDrafts', 'exportListingDrafts']) {
    if (!actionLog.some((item) => item.type === requiredAction)) {
      fail('Expected Listing IPC mock was not called', requiredAction);
    }
  }
  const listingReadAction = actionLog.find((item) => item.type === 'probeLingxingListingDetailAndExtract');
  if (listingReadAction?.options?.expectedAsin !== 'B0TESTASIN') {
    fail('Listing read did not pass expected ASIN to main process', JSON.stringify(listingReadAction));
  }
  if (listingReadAction?.options?.scope?.storeName !== 'FT-US-US' || listingReadAction?.options?.scope?.marketplaceCode !== 'US') {
    fail('Listing read did not pass current store/site scope to main process', JSON.stringify(listingReadAction));
  }
  evidence.actionLog = actionLog;

    if (evidence.consoleErrors.length > 0) {
      fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }

  const evidencePath = path.join(evidenceDir, `business-ui-keyword-listing-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] business UI keyword/listing smoke evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
