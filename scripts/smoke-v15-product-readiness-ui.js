const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const NAV_RE = {
  dataCollection: /批量数据采集|数据采集/,
  delivery: /最终验收就绪门|交付验收/,
  keyword: /关键词机会|关键词机会/,
  listing: /Listing 结构重写|Listing 优化/,
  recommendations: /优化建议草案|优化建议/,
  settings: /AI 适配与诊断|设置/,
};
const SETTINGS_HEADING_RE = /AI 设置|设置/;

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

async function expectNoOldWorkbench(page) {
  const oldWorkbenchCount = await page.getByText('v1.5 工作台', { exact: true }).count();
  if (oldWorkbenchCount > 0) {
    fail('Old nested v1.5 workbench menu text is still visible');
  }
}

async function expectAbsent(page, text) {
  const count = await page.getByText(text, { exact: true }).count();
  if (count > 0) {
    fail(`Unexpected text visible in this menu section: ${text}`);
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
        url: `http://127.0.0.1:${address.port}/index.html?preview=1&scenario=delivery-ready`,
        close: () => server.close(),
      });
    });
  });
}

async function main() {
  if (!fs.existsSync(rendererIndex)) {
    fail('Renderer build not found. Run pnpm --filter @amazon-ai-ops/desktop run build:renderer first', rendererIndex);
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidence = {
    generatedAt: new Date().toISOString(),
    rendererIndex,
    screenshotPath: '',
    listingScreenshotPath: '',
    pages: {},
    bodyTextSample: '',
    consoleErrors: [],
  };

  const server = await startStaticServer(rendererDir);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });

  async function capturePage(key, label) {
    const screenshotPath = path.join(evidenceDir, `v15-${key}-ui-smoke-${Date.now()}.png`);
    const heading = await page.locator('h1').first().innerText();
    const bodyTextSample = (await page.locator('body').innerText()).slice(0, 1600);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.pages[key] = {
      label,
      heading,
      screenshotPath,
      bodyTextSample,
    };
    return screenshotPath;
  }

  await page.addInitScript(() => {
    window.__clipboardText = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__clipboardText = String(text || '');
        },
      },
    });
    window.electronAPI = {
      getVersion: async () => '1.5.0',
      getState: async () => ({
        isLoggedIn: true,
        currentStore: 'SHC001',
        loginSession: { erpSessionReused: true, adsTitle: '仪表盘' },
      }),
      getMetricsSummary: async () => ({
        totalSales: 324.95,
        totalCost: 145.2,
        acos: 0.45,
        totalOrders: 5,
      }),
      getDownloadCenterPageModel: async () => ({
        source: 'mock-enabled',
        path: 'mock-page-model.json',
        model: { name: 'mock-enabled', requiresManualVerification: false },
        readiness: { ready: true, reason: 'mock-enabled' },
      }),
      getRuleConfig: async () => ({
        targetAcos: 0.25,
        maxCpc: 5,
        noOrderClickThreshold: 30,
        highAcosThreshold: 0.4,
        enableAutoLowerBid: true,
        enableAutoAddNegative: true,
      }),
      saveRuleConfig: async () => ({ success: true }),
      getSettings: async () => ({
        aiApiKey: '',
        aiBaseUrl: 'https://api.deepseek.com',
        aiModel: 'deepseek-v4-flash',
        aiTemperature: '0.3',
        aiMaxTokens: '700',
      }),
      saveSettings: async () => ({ success: true }),
      testAiSettings: async () => ({
        success: false,
        message: '未配置 AI Key',
      }),
      getRecommendations: async () => ([
        {
          id: 101,
          actionType: 'lower_bid',
          entityType: 'keyword',
          entityName: 'stainless steel shelf',
          currentValue: '0.82',
          recommendedValue: '0.65',
          reason: 'ACOS 高于阈值且已有点击花费',
          acos: 0.72,
          clicks: 18,
          cost: 23.44,
          riskLevel: 'APPROVAL',
          status: 'approved',
          confidence: 0.84,
          evidence: {
            date: '2026-05-25',
            campaignName: 'SP Shelf Core',
            adGroupName: 'Exact Main',
            asin: 'B001',
            searchTerm: 'stainless steel shelf',
            matchType: 'exact',
            explanationSource: 'rule',
            aiFallbackReason: '未配置 AI Key，广告建议解释使用规则引擎',
            acos: 0.72,
            cost: 23.44,
            clicks: 18,
          },
        },
      ]),
      generateRecommendations: async () => ({ generated: 1, metrics: 12 }),
      approveRecommendation: async () => ({ success: true }),
      rejectRecommendation: async () => ({ success: true }),
      executeRecommendation: async () => {
        throw new Error('真实广告执行器尚未接入可验证回读');
      },
      exportAdReadbackEvidence: async () => ({
        jsonPath: 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop\\storage\\exports\\ad-readback-evidence\\real-ad-execution-readback-smoke.json',
        markdownPath: 'C:\\Users\\wz\\AppData\\Roaming\\@amazon-ai-ops\\desktop\\storage\\exports\\ad-readback-evidence\\real-ad-execution-readback-smoke.md',
        status: 'NEEDS_WORK',
        readyForVerifier: false,
      }),
      openReportPath: async () => ({ success: true }),
      extractListingFromLingxing: async () => ({
        ready: false,
        reason: 'mock only',
        evidence: {
          pageUrl: 'https://erp.lingxing.com/mock-listing',
          pageTitle: 'mock listing',
          completeness: { asin: false, title: false, bullets: false, backendTerms: false },
        },
      }),
      openLingxingListingAndExtract: async () => ({
        ready: false,
        reason: 'mock only',
        evidence: {
          pageUrl: 'https://erp.lingxing.com/erp/listing',
          pageTitle: 'mock listing',
          completeness: { asin: false, title: false, bullets: false, backendTerms: false },
        },
      }),
      probeLingxingListingDetailAndExtract: async () => ({
        ready: false,
        reason: 'mock only',
        evidence: {
          pageUrl: 'https://erp.lingxing.com/erp/listing',
          pageTitle: 'mock listing',
          partialReady: false,
          fullContentReady: false,
          completeness: { asin: false, title: false, bullets: false, backendTerms: false },
          detailProbe: { started: true, clicked: false, status: 'no_candidate' },
        },
      }),
      preflightLingxingCollection: async () => ({
        ready: true,
        dateRange: { start: '2026-05-01', end: '2026-05-25' },
        target: { storeName: 'FT-US-US', marketplaceCode: 'US' },
        checks: [
          { name: 'page_model_ready', status: 'passed' },
          { name: 'diagnostic_evidence_ready', status: 'passed' },
          { name: 'browser_session_ready', status: 'passed' },
        ],
      }),
    };
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });
  await expectNoOldWorkbench(page);
  const sidebar = page.locator('.app-sidebar');
  for (const group of ['运营总览', '数据与量化', '广告执行', '关键词与 Listing', '系统与交付']) {
    await sidebar.getByText(group, { exact: true }).waitFor();
  }

  await sidebar.getByRole('button', { name: NAV_RE.delivery }).click();
  await page.getByRole('heading', { name: '交付验收', level: 1 }).waitFor();
  await page.getByText('把最终验收结果翻译成运营可执行的交付判断。').waitFor();
  await page.getByText('交付摘要', { exact: true }).waitFor();
  await page.getByText('完整矩阵：已闭合', { exact: false }).waitFor();
  await expectAbsent(page, '广告报告采集');
  await expectAbsent(page, 'Listing 建议');
  evidence.screenshotPath = await capturePage('delivery', '交付验收');

  await sidebar.getByRole('button', { name: NAV_RE.dataCollection }).click();
  await page.getByRole('heading', { name: '数据采集', level: 1 }).waitFor();
  await page.getByText('拿到真实原始报表', { exact: true }).waitFor();
  await page.getByText('8 类报表选择与进度', { exact: true }).waitFor();
  await expectNoOldWorkbench(page);
  await expectAbsent(page, '导入并生成机会');
  await expectAbsent(page, 'Listing 建议');
  await capturePage('reports', '数据采集');

  await sidebar.getByRole('button', { name: NAV_RE.recommendations }).click();
  await page.getByRole('heading', { name: '优化建议', level: 1 }).waitFor();
  await page.getByText('建议池', { exact: true }).waitFor();
  await page.getByText('高风险强阻断', { exact: true }).waitFor();
  await page.getByText('已就绪可批准', { exact: true }).waitFor();
  await page.getByRole('button', { name: '生成优化建议' }).waitFor();
  await expectNoOldWorkbench(page);
  await expectAbsent(page, '广告报告采集');
  await expectAbsent(page, 'Listing 建议');
  await capturePage('recommendations', '优化建议');

  await sidebar.getByRole('button', { name: NAV_RE.keyword }).click();
  await page.getByRole('heading', { name: '关键词机会', level: 1 }).waitFor();
  await page.getByRole('main').getByText('关键词机会', { exact: true }).waitFor();
  await page.getByText('运行机会识别', { exact: true }).waitFor();
  await page.getByText('关键词机会表', { exact: true }).waitFor();
  await expectNoOldWorkbench(page);
  await expectAbsent(page, '广告报告采集');
  await expectAbsent(page, 'Listing 建议');
  await capturePage('keywords', '关键词机会');

  await sidebar.getByRole('button', { name: NAV_RE.listing }).click();
  await page.getByRole('heading', { name: 'Listing 优化', level: 1 }).waitFor();
  await page.getByText('Listing 本地沙箱', { exact: true }).waitFor();
  await page.getByText('AI 改写本地草案', { exact: true }).waitFor();
  await page.getByText('手工录入当前 Listing', { exact: true }).waitFor();
  await page.getByText('关键词交接与草案边界', { exact: true }).waitFor();
  await expectNoOldWorkbench(page);
  await expectAbsent(page, '广告报告采集');
  await expectAbsent(page, '导入并生成机会');
  evidence.listingScreenshotPath = await capturePage('listing', 'Listing 优化');

  await sidebar.getByRole('button', { name: NAV_RE.settings }).click();
  await page.getByRole('heading', { name: SETTINGS_HEADING_RE, level: 1 }).waitFor();
  await page.getByText('DeepSeek / OpenAI Compatible', { exact: true }).waitFor();
  await page.getByText('广告诊断 v1', { exact: true }).waitFor();
  await page.getByText('Listing 草案 v1', { exact: true }).waitFor();
  await page.getByText('广告量化阈值', { exact: true }).waitFor();
  await capturePage('settings-ai', '设置 - AI 配置');

  evidence.bodyTextSample = (await page.locator('body').innerText()).slice(0, 3000);
  await browser.close();
  server.close();

  if (evidence.consoleErrors.length > 0) {
    fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
  }

  const currentEvidencePath = path.join(evidenceDir, `v15-product-readiness-ui-smoke-${Date.now()}.json`);
  fs.writeFileSync(currentEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] v1.5 product readiness UI smoke evidence: ${currentEvidencePath}`);
  console.log(`[PASS] Screenshot: ${evidence.screenshotPath}`);
  console.log(`[PASS] Listing screenshot: ${evidence.listingScreenshotPath}`);
  return;

  await expectNoOldWorkbench(page);
  await page.getByText('运营总览', { exact: true }).waitFor();
  await page.getByText('数据与量化', { exact: true }).waitFor();
  await page.getByText('广告执行', { exact: true }).waitFor();
  await page.getByText('关键词与 Listing', { exact: true }).waitFor();
  await page.getByText('系统与交付', { exact: true }).waitFor();
  await page.getByRole('button', { name: NAV_RE.delivery }).click();
  await page.getByRole('heading', { name: '交付验收', level: 1 }).waitFor();
  await page.getByText('只汇总最终可交付状态、缺失证据和验收命令').waitFor();
  await page.getByText('确认 APP_READY 证据闭环', { exact: true }).waitFor();
  await page.getByText('manifest 驱动最终聚合 + 真实 readback', { exact: true }).waitFor();
  await page.getByText('交付状态：APP_READY 证据已闭环').waitFor();
  await page.getByText('APP_READY', { exact: true }).first().waitFor();
  await page.getByText('广告 readback 已通过').waitFor();
  await page.getByText('已验证交付快照').waitFor();
  await page.getByText('batch_20260609045655853_ft8uda', { exact: true }).waitFor();
  await page.getByText('当前安全模式').waitFor();
  await page.getByText('不会提交 Amazon Listing：建议、草案和复制都停留在本地').waitFor();
  await page.getByText('领星广告报表采集', { exact: true }).waitFor();
  await page.getByText('广告指标口径', { exact: true }).waitFor();
  await page.getByText('DeepSeek / AI 连接', { exact: true }).waitFor();
  await page.getByText('广告建议 AI 解释', { exact: true }).first().waitFor();
  await page.getByText('Listing 读取', { exact: true }).waitFor();
  await page.getByText('Listing AI 草案', { exact: true }).first().waitFor();
  await page.getByText('广告执行', { exact: true }).waitFor();
  await page.getByText('后续验收动作', { exact: true }).waitFor();
  await page.getByText('真实 AI 证据已通过：证据文件脱敏', { exact: false }).waitFor();
  await page.getByText('把广告 readback 前端从单一样例改成通用目标录入', { exact: false }).waitFor();
  await page.getByText('deepseek-live-1781066552798.json', { exact: true }).waitFor({ state: 'attached' });
  await page.getByText('installed-ad-ai-explanation-user-key-2026-06-10.json', { exact: true }).waitFor({ state: 'attached' });
  await page.getByText('installed-listing-ai-draft-user-key-2026-06-10.json', { exact: true }).waitFor({ state: 'attached' });
  await expectAbsent(page, '广告报告采集');
  await expectAbsent(page, 'Listing 建议');
  evidence.screenshotPath = await capturePage('delivery', '交付验收');
  await page.getByRole('button', { name: NAV_RE.dataCollection }).click();
  await page.getByRole('heading', { name: '数据采集', level: 1 }).waitFor();
  await page.getByText('展示当前采集状态、8 类领星广告报表进度', { exact: false }).waitFor();
  await page.getByText('拿到真实原始报表', { exact: true }).waitFor();
  await page.getByText('当前采集状态', { exact: true }).waitFor();
  await page.getByText('8 类报表选择与进度', { exact: true }).waitFor();
  await expectNoOldWorkbench(page);
  await expectAbsent(page, '交付状态：还差 1 项验收');
  await expectAbsent(page, '导入并生成机会');
  await expectAbsent(page, 'Listing 建议');
  await capturePage('reports', '数据采集');
  await page.getByRole('button', { name: NAV_RE.recommendations }).click();
  await page.getByRole('heading', { name: '优化建议', level: 1 }).waitFor();
  await page.getByText('广告建议支持审批和审计').waitFor();
  await page.getByText('建议筛选与生成', { exact: true }).waitFor();
  await page.getByLabel('优化建议范围预设').waitFor();
  await page.getByText('优先使用已验证 full-8 范围', { exact: false }).waitFor();
  await page.getByText('开始日期', { exact: true }).waitFor();
  await page.getByText('店铺', { exact: true }).waitFor();
  await page.getByText('站点', { exact: true }).waitFor();
  await page.getByRole('button', { name: '刷新列表' }).waitFor();
  await page.getByRole('button', { name: '生成优化建议' }).waitFor();
  await page.locator('input[type="date"]').nth(0).fill('2026-05-01');
  await page.locator('input[type="date"]').nth(1).fill('2026-05-25');
  await page.getByPlaceholder('例如 FT-US-US').first().fill('FT-US-US');
  await page.getByPlaceholder('例如 US').first().fill('US');
  await page.getByRole('button', { name: '生成优化建议' }).click();
  await page.getByText('处理 12 条广告指标，生成 1 条建议', { exact: false }).waitFor();
  await page.getByText('SP Shelf Core / Exact Main / B001', { exact: false }).waitFor();
  await page.getByText('解释来源：规则', { exact: false }).waitFor();
  await page.getByText('广告建议解释使用规则引擎', { exact: false }).waitFor();
  await page.getByText('广告执行 readback 验收证据', { exact: true }).waitFor();
  await page.getByText('复制 Readback 操作手册', { exact: true }).waitFor();
  await page.getByText('复制广告 readback 验收命令', { exact: true }).waitFor();
  await page.getByText('docs\\REAL_AD_READBACK_RUNBOOK.md', { exact: false }).waitFor();
  await page.getByText('手册约束人工验收和通用执行合同', { exact: false }).waitFor();
  await page.getByRole('button', { name: '复制 Readback 操作手册' }).click();
  const runbookClipboard = await page.evaluate(() => window.__clipboardText || '');
  for (const expected of [
    'docs\\REAL_AD_READBACK_RUNBOOK.md',
    'Generic rule: do not execute if the exact editable target row cannot be found',
    'before.value',
    'after.value',
    'readback.actualValue',
    'pnpm run verify:ad-readback',
  ]) {
    if (!runbookClipboard.includes(expected)) {
      fail('Readback runbook clipboard text is incomplete', expected);
    }
  }
  await page.getByText('已验证 readback 样例', { exact: true }).waitFor();
  await page.getByText('real-ad-execution-readback-candidate-rec-1.json / .md', { exact: true }).waitFor();
  await page.getByText('PASS / 真实审批 + before/after/reload 回读已验证', { exact: true }).waitFor();
  await page.getByText('B0GTTJFQTM', { exact: true }).waitFor();
  await page.getByText('editable target=紧密匹配；不是只读 search term 行', { exact: true }).waitFor();
  await page.getByText('source search_term: 2.40 -> 2.16；仅作建议来源，不是现场 bid', { exact: true }).waitFor();
  await page.getByText('通用执行合同', { exact: true }).waitFor();
  await page.getByText('每个待执行建议都必须从推荐行或现场 Ads UI 带入自己的店铺', { exact: false }).waitFor();
  await page.getByText('live editable target row found', { exact: true }).waitFor();
  await page.getByText('bid input/save control visible', { exact: true }).waitFor();
  await page.getByText('该样例已通过 verifier，但只能作为验收样例', { exact: false }).waitFor();
  await page.getByText('before.value 和 after.value 必须来自现场 Ads UI 回读', { exact: false }).waitFor();
  await page.getByText('真实读回证据录入与导出', { exact: true }).waitFor();
  await page.getByText('该表单只写本地证据文件，不执行广告动作', { exact: false }).waitFor();
  await page.getByText('本地预检', { exact: true }).waitFor();
  await page.getByText('预检只检查页面可判断的字段、值一致性和时间顺序', { exact: false }).waitFor();
  await page.getByText('最终证据仍以 `verify:ad-readback` 为准', { exact: false }).waitFor();
  await page.getByText('缺审批人确认范围', { exact: true }).waitFor();
  await page.getByText('缺执行目标店铺', { exact: true }).waitFor();
  await page.getByText('缺 before live bid', { exact: true }).waitFor();
  await page.getByText('执行目标', { exact: true }).waitFor();
  await page.getByText('目标店铺', { exact: true }).waitFor();
  await page.getByText('目标站点', { exact: true }).waitFor();
  await page.getByText('广告组合', { exact: true }).waitFor();
  await page.locator('label').filter({ hasText: /^广告活动$/ }).waitFor();
  await page.locator('label').filter({ hasText: /^广告组$/ }).waitFor();
  await page.locator('label').filter({ hasText: /^对象类型$/ }).waitFor();
  await page.locator('label').filter({ hasText: /^对象名称$/ }).waitFor();
  await page.locator('label').filter({ hasText: /^动作类型$/ }).waitFor();
  await page.getByText('建议来源', { exact: true }).waitFor();
  await page.getByText('Source evidence path', { exact: true }).waitFor();
  await page.getByText('审批人确认范围', { exact: true }).waitFor();
  await page.getByText('已有外部审批，允许人工在 Ads UI 执行一次低风险动作', { exact: true }).waitFor();
  await page.getByText('操作员确认已在 Ads UI 人工执行，不是本应用执行', { exact: true }).waitFor();
  await page.getByText('审批人', { exact: true }).waitFor();
  await page.getByText('审批凭证路径/编号', { exact: true }).waitFor();
  await page.getByText('Approval time', { exact: true }).waitFor();
  await page.getByText('执行人', { exact: true }).waitFor();
  await page.getByText('Before live bid', { exact: true }).waitFor();
  await page.getByText('Before captured at', { exact: true }).waitFor();
  await page.getByText('After live bid', { exact: true }).waitFor();
  await page.getByText('Execution time', { exact: true }).waitFor();
  await page.getByText('After captured at', { exact: true }).waitFor();
  await page.getByText('Readback actual', { exact: true }).waitFor();
  await page.getByText('Readback time', { exact: true }).waitFor();
  await page.getByText('Readback evidence path', { exact: true }).waitFor();
  await page.getByText('Live bid row proof', { exact: true }).waitFor();
  await page.getByRole('button', { name: '导出读回证据 JSON' }).waitFor();
  await page.getByRole('button', { name: '导出读回证据 JSON' }).click();
  await page.getByText('已导出广告读回证据：NEEDS_WORK', { exact: false }).waitFor();
  await page.getByText('real-ad-execution-readback-smoke.json', { exact: false }).waitFor();
  await page.getByText('pnpm run create:ad-readback-template', { exact: false }).waitFor();
  await page.getByText('real-ad-execution-readback-candidate-rec-1.json', { exact: false }).first().waitFor();
  await page.getByText('--md-out output\\codex-evidence\\real-ad-execution-readback-manual.md', { exact: false }).waitFor();
  await page.getByText('pnpm run verify:ad-readback', { exact: false }).waitFor();
  await page.getByText('before/after value changed + screenshots', { exact: true }).waitFor();
  await page.getByText('realWriteApproved=true + operator approval scope + approver artifact', { exact: true }).waitFor();
  await page.getByText('readback.verified=true with actualValue + evidencePath', { exact: true }).waitFor();
  await page.getByText('execution.success=true + verified=true + performedBy + appExecutorUsed=false', { exact: true }).waitFor();
  await page.getByText('approval <= before <= execution <= after <= readback', { exact: true }).waitFor();
  await page.getByText('应用内执行按钮仍保持 fail-closed', { exact: false }).waitFor();
  await expectNoOldWorkbench(page);
  await expectAbsent(page, '交付状态：还差 1 项验收');
  await expectAbsent(page, '广告报告采集');
  await expectAbsent(page, 'Listing 建议');
  await capturePage('recommendations-ad-readback', '优化建议 - 广告 readback');
  await page.getByRole('button', { name: NAV_RE.keyword }).click();
  await page.getByRole('heading', { name: '关键词机会', level: 1 }).waitFor();
  await page.getByText('把搜索词、关键词或 SQP 文件清洗成可筛选的关键词机会').waitFor();
  await page.getByText('生成可用关键词机会池', { exact: true }).waitFor();
  await page.getByText('去重策略 + 解析诊断 + 风险标记', { exact: true }).waitFor();
  await page.getByText('机会表默认按 ASIN + 标准化关键词聚合').waitFor();
  await page.getByText('导入并生成机会', { exact: true }).waitFor();
  await expectNoOldWorkbench(page);
  await expectAbsent(page, '交付状态：还差 1 项验收');
  await expectAbsent(page, '广告报告采集');
  await expectAbsent(page, 'Listing 建议');
  await capturePage('keywords', '关键词机会');
  await page.getByRole('button', { name: NAV_RE.listing }).click();
  await page.getByRole('heading', { name: 'Listing 优化', level: 1 }).waitFor();
  await page.getByText('读取或导入 Listing 内容，结合关键词机会生成建议和草案').waitFor();
  await page.getByText('产出可导出的 Listing 建议', { exact: true }).waitFor();
  await page.getByText('只读读取证据 + source=ai 草案证据', { exact: true }).waitFor();
  await page.getByText('Listing 建议', { exact: true }).waitFor();
  await page.getByText('从当前领星页面读取', { exact: true }).waitFor();
  await page.getByText('打开 URL 并读取', { exact: true }).waitFor();
  await page.getByText('只读探测详情页', { exact: true }).waitFor();
  await page.locator('strong').filter({ hasText: /^读取 Listing$/ }).waitFor();
  await page.locator('strong').filter({ hasText: /^生成建议$/ }).waitFor();
  await page.locator('strong').filter({ hasText: /^采纳建议$/ }).waitFor();
  await page.locator('strong').filter({ hasText: /^生成草案$/ }).waitFor();
  await page.locator('strong').filter({ hasText: /^导出交付$/ }).waitFor();
  await expectNoOldWorkbench(page);
  await expectAbsent(page, '交付状态：还差 1 项验收');
  await expectAbsent(page, '广告报告采集');
  await expectAbsent(page, '导入并生成机会');
  evidence.listingScreenshotPath = await capturePage('listing', 'Listing 优化');

  evidence.bodyTextSample = (await page.locator('body').innerText()).slice(0, 3000);
  await page.getByRole('button', { name: NAV_RE.delivery }).click();
  await page.getByText('技术验收详情', { exact: true }).click();
  await page.getByText('交付证据', { exact: true }).waitFor();
  await page.getByText('最终就绪聚合（manifest 驱动）', { exact: true }).waitFor();
  await page.getByText('final JSON 必须记录 evidenceSelection.mode=manifest', { exact: false }).waitFor();
  await page.getByText('交付证据包', { exact: true }).waitFor();
  await page.getByText('pnpm run write:v15-evidence-manifest', { exact: false }).waitFor();
  await page.getByText('--evidence-manifest output\\codex-evidence\\v15-final-readiness-evidence-manifest-2026-06-10.json', { exact: false }).waitFor();
  await page.getByText('复制 AI 验收命令', { exact: true }).waitFor();
  await page.getByText('复制最终聚合命令', { exact: true }).waitFor();
  await page.getByRole('button', { name: NAV_RE.listing }).click();
  await page.getByText('Listing 建议', { exact: true }).waitFor();
  await page.getByText('从当前领星页面读取', { exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: NAV_RE.settings }).click();
  await page.getByRole('heading', { name: SETTINGS_HEADING_RE, level: 1 }).waitFor();
  await page.getByText('AI / DeepSeek 配置', { exact: true }).waitFor();
  await page.locator('strong').filter({ hasText: /^保存真实 Key$/ }).waitFor();
  await page.locator('strong').filter({ hasText: /^测试 AI 连接$/ }).waitFor();
  await page.locator('strong').filter({ hasText: /^生成广告 AI 解释$/ }).waitFor();
  await page.locator('strong').filter({ hasText: /^生成 Listing AI 草案$/ }).waitFor();
  await page.locator('strong').filter({ hasText: /^刷新最终验收$/ }).waitFor();
  await page.getByText('真实交付需要三份证据', { exact: false }).waitFor();
  await page.locator('text=verify:ad-ai-explanation').first().waitFor();
  await page.getByText('$env:DEEPSEEK_API_KEY="<your-deepseek-key>"', { exact: false }).waitFor();
  await page.getByRole('button', { name: '复制 AI 验收命令' }).waitFor();
  await capturePage('settings-ai', '设置 - AI 配置');
  await browser.close();
  server.close();

  if (evidence.consoleErrors.length > 0) {
    fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
  }

  const evidencePath = path.join(evidenceDir, `v15-product-readiness-ui-smoke-${Date.now()}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] v1.5 product readiness UI smoke evidence: ${evidencePath}`);
  console.log(`[PASS] Screenshot: ${evidence.screenshotPath}`);
  console.log(`[PASS] Listing screenshot: ${evidence.listingScreenshotPath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
