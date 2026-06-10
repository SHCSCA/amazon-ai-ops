const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

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
      normalizedKeyword: 'insulated travel mug',
      opportunityLevel: 'high',
      score: 91,
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
    window.electronAPI = {
      getVersion: async () => '1.5.0',
      getState: async () => ({ isLoggedIn: true, currentStore: 'SHC001', loginSession: { erpSessionReused: true, adsTitle: '仪表盘' } }),
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
  if (!(await page.getByRole('button', { name: '关键词机会' }).count())) {
    const debugScreenshot = path.join(evidenceDir, `listing-draft-renderer-debug-${Date.now()}.png`);
    await page.screenshot({ path: debugScreenshot, fullPage: true });
    const bodyText = await page.locator('body').innerText().catch(() => '');
    await browser.close();
    server.close();
    fail('Renderer did not show the authenticated app shell', `${debugScreenshot}\n${bodyText.slice(0, 1000)}`);
  }
  await page.getByRole('button', { name: '关键词机会' }).click();

  await page.getByText('选择报表').click();
  await page.getByText('导入并生成机会').click();
  await page.getByRole('button', { name: 'Listing 优化' }).click();
  await page.getByPlaceholder('ASIN').fill('B001');
  await page.getByPlaceholder('标题').fill('Old title');
  await page.getByText('生成建议').click();
  await page.getByText('标记采纳').click();
  await page.getByText('用已采纳建议生成草案').click();

  await page.getByText('当前原文', { exact: true }).waitFor();
  if ((await page.getByText('Old title').count()) < 1) fail('Current text was not visible');
  await page.getByText('修改草案', { exact: true }).waitFor();
  if ((await page.getByText('New insulated travel mug title').count()) < 1) fail('Drafted text was not visible');
  if ((await page.getByText('orders=3, spend=170.25, row=12').count()) < 1) fail('Draft evidence was not visible');
  await page.getByText('AI 回退：未配置 AI Key，使用规则草案').waitFor();

  await page.getByText('导出草案 CSV').click();
  await page.getByText('最近草案导出：').waitFor();
  await page.getByText('打开最近草案导出').click();
  await page.getByText('复制草案').click();

  evidence.calls = await page.evaluate(() => window.__smokeCalls || []);
  evidence.clipboardText = await page.evaluate(() => window.__clipboardText || '');
  evidence.screenshotPath = path.join(evidenceDir, `listing-draft-renderer-smoke-${Date.now()}.png`);
  await page.screenshot({ path: evidence.screenshotPath, fullPage: true });
  await browser.close();
  server.close();

  const generateCall = evidence.calls.find((call) => call.method === 'generateListingDrafts');
  if (!generateCall) fail('generateListingDrafts was not called');
  if (!generateCall.statuses.every((status) => status === 'accepted')) {
    fail('Draft generation received non-accepted suggestions', JSON.stringify(generateCall.statuses));
  }
  if (!evidence.calls.some((call) => call.method === 'exportListingDrafts' && call.format === 'csv' && call.draftCount === 1)) {
    fail('Draft CSV export was not called with one draft');
  }
  if (!evidence.calls.some((call) => call.method === 'openReportPath' && /listing_drafts_smoke\.csv$/.test(call.targetPath))) {
    fail('Latest draft export was not opened');
  }
  if (!/New insulated travel mug title/.test(evidence.clipboardText)) {
    fail('Copied draft text did not contain drafted Listing text');
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
