const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('./playwright-loader');
const { navigateLegacyRoute, setManualScopeBatch } = require('./business-ui-smoke-navigation');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const NAV_RE = {
  approval: /审批历史中心|审批中心/,
  readback: /结果核对|结果核对/,
  recommendations: /优化建议草案|优化建议/,
};
const HEADING_RE = {
  approval: /建议与审批/,
  readback: /结果核对|结果核对/,
  recommendations: /建议与审批/,
};

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function assertScopeParams(params, context) {
  const expected = {
    dateFrom: '2026-06-01',
    dateTo: '2026-06-12',
    storeName: 'FT-US-US',
    marketplaceCode: 'US',
    batchId: 'manual_ad_execution_batch',
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
      resolve({ url: `http://127.0.0.1:${address.port}/index.html?preview=1&scenario=mixed-recommendations`, close: () => server.close() });
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
  if (textContent.includes(text)) fail(`Unexpected visible text: ${text}`);
}

async function expectInBody(page, text, details) {
  const textContent = await bodyText(page);
  if (!textContent.includes(text)) {
    fail(`Expected visible text not found: ${text}`, details || textContent.slice(0, 3000));
  }
}

async function openEvidenceDisclosures(page) {
  await page.locator('details.evidence-disclosure, details.progressive-details').evaluateAll((nodes) => {
    for (const node of nodes) node.open = true;
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function clickReadbackStep(page, title) {
  const label = title.replace(/^\d+\.\s*/, '');
  await page.getByRole('tab', { name: new RegExp(escapeRegExp(label)) }).click();
}

async function assertGlobalGuards(page, key) {
  const textContent = await bodyText(page);
  const scopeRangeTitle = await page.locator('.scope-compact-trigger').getAttribute('title');
  if (!textContent.includes('USD') && !scopeRangeTitle?.includes('/ USD')) fail('USD marker is missing', key);
  if (textContent.includes('¥')) fail('RMB marker is visible', key);
  if (textContent.includes('v1.5 工作台')) fail('Old v1.5 workbench is visible', key);
  if (textContent.includes('APP_READY')) fail('False APP_READY state is visible', key);
  if (textContent.includes('pnpm run verify:ad-readback')) fail('Readback command wall is visible', key);
  if (textContent.includes('create:ad-readback-template')) fail('Readback template command is visible', key);
}

async function navigateBusinessPage(page, nav, route) {
  await navigateLegacyRoute(page, route);
}

async function waitForDecisionsSubview(page, subview) {
  const rootLocator = page.locator('[data-workspace="decisions"]');
  await rootLocator.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction((expectedSubview) => (
    document.querySelector('[data-workspace="decisions"]')?.getAttribute('data-workspace-subview') === expectedSubview
  ), subview, { timeout: 5000 });
  const headings = page.getByRole('heading', { name: '建议与审批', level: 1 });
  if (await headings.count() !== 1) {
    fail('Decisions workspace must expose exactly one h1', `subview=${subview}, count=${await headings.count()}`);
  }
  return rootLocator;
}

async function assertNoPageHorizontalOverflow(page, context) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  if (overflow.scrollWidth > overflow.clientWidth + 1) {
    fail('Page has horizontal overflow', `${context}: ${JSON.stringify(overflow)}`);
  }
}

async function captureViewportScreenshot(page, evidence, key, runId, details = {}) {
  const screenshotPath = path.join(evidenceDir, `business-ui-ad-execution-${key}-${runId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  evidence.pages[key] = {
    screenshotPath,
    viewport: page.viewportSize(),
    bodyTextSample: (await bodyText(page)).slice(0, 1800),
    ...details,
  };
  return screenshotPath;
}

async function openReadbackSourceEditor(page) {
  const dialog = page.getByRole('dialog', { name: '修正来源字段' });
  if (!await dialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '修正来源字段', exact: true }).click();
  }
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
}

async function closeReadbackSourceEditor(page) {
  const dialog = page.getByRole('dialog', { name: '修正来源字段' });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
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
    pageErrors: [],
    tabTrajectory: [],
  };

  let server;
  let browser;

  try {
    server = await startStaticServer(rendererDir);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1480, height: 1080 } });
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => {
      evidence.pageErrors.push(String(error?.stack || error?.message || error));
    });

  await page.addInitScript(() => {
    const fullReportFiles = [
      ['campaign', '广告活动报告', 'campaign.xlsx'],
      ['ad_group', '广告组报告', 'ad_group.xlsx'],
      ['placement', '广告位报告', 'placement.xlsx'],
      ['advertised_product', '广告（推广的商品）报告', 'advertised_product.xlsx'],
      ['auto_targeting', '自动投放报告', 'auto_targeting.xlsx'],
      ['keyword', '关键词报告', 'keyword.xlsx'],
      ['product_targeting', '商品投放报告', 'product_targeting.xlsx'],
      ['user_search_term', '用户搜索词报告', 'source_user_search_term.xlsx'],
    ].map(([reportType, displayName, fileName], index) => ({
      id: `f${index + 1}`,
      reportType,
      displayName,
      status: 'downloaded',
      filePath: `C:/reports/${fileName}`,
      folderPath: 'C:/reports',
      fileName,
      fileSizeBytes: 2048 + index,
      importedRows: 3,
      updatedAt: '2026-06-12T10:00:00.000Z',
    }));

    const recommendationBase = {
      id: 101,
      actionType: 'lower_bid',
      entityType: 'target',
      entityName: 'tight match target',
      currentValue: '1.20',
      recommendedValue: '1.08',
      reason: '高 ACOS 且已有花费，当前订单效率不足。',
      acos: 0.72,
      clicks: 32,
      cost: 42.18,
      riskLevel: 'APPROVAL',
      status: 'pending',
      revision: 0,
      confidence: 0.82,
      evidence: {
        date: '2026-06-12',
        portfolioName: 'D6 Portfolio',
        campaignName: 'D6-auto-test',
        adGroupName: 'D6-ad-group',
        asin: 'B0TESTASIN',
        targeting: 'tight match target',
        explanationSource: 'ai',
        aiExplanation: 'DeepSeek 已结合当前范围和风险边界给出解释。',
        aiRiskWarnings: ['任何真实广告动作前都要保留审批和回读证据。'],
        aiModel: 'deepseek-chat',
        aiStrategySource: 'ai',
        aiLifecycleStage: 'keyword_exploration',
        aiLifecycleStageReason: '搜索词花费与 Coupon 事件显示仍处于探索期。',
        aiLifecycleStageEvidenceRefs: ['metric:batch_mock_ready:search_term:2026-06-12:target:abc'],
        aiLifecycleStageEvidenceDetails: [{
          evidenceId: 'metric:batch_mock_ready:search_term:2026-06-12:target:abc',
          type: 'metric',
          label: 'tight match target / 2026-06-12',
          dateRange: '2026-06-12~2026-06-12',
          batchId: 'batch_mock_ready',
          reportType: 'user_search_term',
          sourceFile: 'C:/reports/source_user_search_term.xlsx',
          sourceRow: 12,
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B0TESTASIN',
          campaignName: 'D6-auto-test',
          adGroupName: 'D6-ad-group',
          entityType: 'target',
          entityName: 'tight match target',
          metrics: {
            impressions: 1200,
            clicks: 32,
            cost: 42.18,
            orders: 1,
            sales: 58.58,
            acos: 0.72,
            cpc: 1.32,
            cvr: 0.031,
            currency: 'USD',
          },
        }],
        aiStrategySummary: 'Coupon 背景显示该产品仍处于测词阶段，同时需要收紧无订单花费。',
        aiMainProblems: ['no_order_spend', 'high_acos'],
        aiThresholdSuggestions: {
          targetAcos: { value: 0.35, reason: '测词期允许更高容忍度。' },
          highAcosThreshold: { value: 0.55, reason: 'Coupon 期间临时放宽高 ACOS 边界。' },
          noOrderClickThreshold: { value: 18, reason: '当前点击样本已经足够。' },
          minSpend: { value: 15, reason: '避免基于过小样本动作。' },
        },
        aiStrategyRiskWarnings: ['不要盲目否定核心词。'],
        aiEvidenceRefs: [
          'metric:batch_mock_ready:search_term:2026-06-12:target:abc',
          'event:301',
        ],
        aiReasoningSteps: [
          '报表指标显示 tight match target 在当前范围 ACOS 72.0%。',
          'Coupon 事件说明当前仍处于促销探索窗口。',
        ],
        aiEvidenceDetails: [{
          evidenceId: 'metric:batch_mock_ready:search_term:2026-06-12:target:abc',
          type: 'metric',
          label: 'tight match target / 2026-06-12',
          dateRange: '2026-06-12~2026-06-12',
          batchId: 'batch_mock_ready',
          reportType: 'user_search_term',
          sourceFile: 'C:/reports/source_user_search_term.xlsx',
          sourceRow: 12,
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B0TESTASIN',
          campaignName: 'D6-auto-test',
          adGroupName: 'D6-ad-group',
          entityType: 'target',
          entityName: 'tight match target',
          metrics: {
            impressions: 1200,
            clicks: 32,
            cost: 42.18,
            orders: 1,
            sales: 58.58,
            acos: 0.72,
            cpc: 1.32,
            cvr: 0.031,
            currency: 'USD',
          },
        }, {
          evidenceId: 'event:301',
          type: 'operation_event',
          label: '10% Coupon started',
          dateRange: '2026-06-10~2026-06-10',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B0TESTASIN',
          campaignName: 'D6-auto-test',
          adGroupName: 'D6-ad-group',
          entityType: 'operation_event',
          entityName: '10% Coupon started',
          event: {
            eventDate: '2026-06-10',
            eventType: 'coupon',
            title: '10% Coupon started',
            impactExpectation: 'conversion_up',
          },
        }],
        decisionAgreement: 'aligned',
        decisionSource: 'rule_ai',
        decisionReasons: ['规则：高 ACOS 且已有花费。', 'AI：Coupon 未带来足够转化。'],
        decisionRiskWarnings: [],
        decisionRequiresReview: false,
        operationEventCount: 1,
        productContextCount: 1,
        productStage: 'keyword_exploration',
        productTargetAcos: 0.35,
        productTargetTacos: 0.12,
        productTargetNetMargin: 0.22,
        productMinPrice: 29.99,
        quantStatus: 'waste',
        quantLifecycleStage: 'keyword_exploration',
        quantSeverity: 'medium',
        quantReasons: ['ACOS 72.0% 高于高风险阈值 50.0%。'],
        quantThresholds: {
          targetAcos: 0.25,
          highAcosThreshold: 0.5,
          noOrderClickThreshold: 30,
          minSpend: 10,
          bidAdjustPercent: 0.1,
        },
        quantReviewRequired: false,
        batchId: 'batch_mock_ready',
        sourceFiles: ['C:/reports/source_user_search_term.xlsx'],
        sourceRow: 12,
        impressions: 1200,
        acos: 0.72,
        cost: 42.18,
        clicks: 32,
        orders: 1,
        sales: 58.58,
      },
    };
    const blockedRecommendation = {
      ...recommendationBase,
      id: 102,
      status: 'needs_review',
      reason: 'AI 独立洞察需要策略复核。',
      evidence: {
        ...recommendationBase.evidence,
        decisionAgreement: 'ai_only',
        decisionSource: 'ai',
        decisionRequiresReview: true,
        quantReviewRequired: true,
        quantReasons: ['规则量化要求人工复核，不能直接进入执行。'],
      },
    };
    const aiNoEvidenceRecommendation = {
      ...recommendationBase,
      id: 103,
      status: 'pending',
      reason: '缺少可回查证据引用的 AI 建议不能进入审批。',
      evidence: {
        ...recommendationBase.evidence,
        aiEvidenceRefs: [],
        aiEvidenceDetails: [],
        aiInsightInvalidReasons: ['AI 动作缺少可回查证据引用'],
        decisionAgreement: 'aligned',
        decisionSource: 'rule_ai',
        decisionRequiresReview: false,
        quantReviewRequired: false,
      },
    };
    const aiExplanationOnlyRecommendation = {
      ...recommendationBase,
      id: 104,
      status: 'pending',
      reason: '规则建议在证据完整时可审批，AI 只提供解释。',
      evidence: {
        ...recommendationBase.evidence,
        targeting: 'ai explanation only target',
        aiStrategySource: 'rule',
        explanationSource: 'ai',
        aiEvidenceRefs: [],
        aiEvidenceDetails: [],
        aiInsightInvalidReasons: [],
        decisionAgreement: 'rule_only',
        decisionSource: 'rule',
        decisionRequiresReview: false,
        quantReviewRequired: false,
      },
    };
    const recommendationState = new Map([
      [recommendationBase.id, { ...recommendationBase, evidence: { ...recommendationBase.evidence } }],
      [blockedRecommendation.id, { ...blockedRecommendation, evidence: { ...blockedRecommendation.evidence } }],
    ]);
    const readyPipeline = {
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
        batchId: 'batch_mock_ready',
      },
      generatedAt: '2026-06-12T10:00:00.000Z',
      collection: {
        status: 'ready',
        latestBatch: { id: 'batch_mock_ready' },
        sourceBatchIds: ['batch_mock_ready'],
        availableBatches: [{
          id: 'batch_mock_ready',
          status: 'completed',
          dateStart: '2026-06-01',
          dateEnd: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          downloadDir: 'C:/reports',
          totalFileRecords: 8,
          realReportFileCount: 8,
          importedRowCount: 24,
          missingReportLabels: [],
        }],
        reportOptions: fullReportFiles.map((file) => ({
          type: file.reportType,
          label: file.displayName,
          status: 'ready',
          realFileAvailable: true,
          importedRows: file.importedRows,
        })),
        realReportFiles: fullReportFiles,
        evidencePaths: [],
        blockers: [],
        audit: { databaseReady: true, acceptedExtensions: ['.xlsx'], rejectedEvidenceExtensions: ['.json'], notes: [] },
      },
      quant: {
        hasImportedMetrics: true,
        importedRows: 24,
        totalSpend: 170.25,
        totalSales: 240.5,
        totalOrders: 3,
        totalClicks: 120,
        totalImpressions: 8000,
        acos: 0.708,
        cvr: 0.025,
        cpc: 1.41,
        wastedSpend: 42.18,
        highRiskCount: 1,
        adObjectTimelines: [{
          objectKey: 'B0TESTASIN|d6-auto-test|d6-ad-group|target|tight match target',
          objectType: 'target',
          objectName: 'tight match target',
          asin: 'B0TESTASIN',
          campaignName: 'D6-auto-test',
          adGroupName: 'D6-ad-group',
          dateFrom: '2026-06-01',
          dateTo: '2026-06-12',
          daysActive: 12,
          lifecycleStage: 'keyword_exploration',
          quantStatus: 'waste',
          recommendedAction: 'lower_bid',
          recommendedValue: '1.08',
          trend: { spend: 'up', sales: 'flat' },
          totals: {
            impressions: 1200,
            clicks: 32,
            cost: 42.18,
            orders: 1,
            sales: 58.58,
            acos: 0.72,
            cpc: 1.32,
            cvr: 0.031,
            currency: 'USD',
          },
          thresholds: {
            targetAcos: 0.25,
            highAcosThreshold: 0.5,
            noOrderClickThreshold: 30,
            minSpend: 10,
            bidAdjustPercent: 0.1,
          },
          reasons: ['ACOS 72.0% 高于高风险阈值 50.0%。'],
          reviewRequired: true,
        }],
        diagnostics: [],
        blockers: [],
      },
      operations: {
        eventCount: 1,
        notes: ['Coupon 背景应进入 AI 诊断。'],
        events: [{
          id: 301,
          eventDate: '2026-06-10',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B0TESTASIN',
          campaignName: 'D6-auto-test',
          adGroupName: 'D6-ad-group',
          eventType: 'coupon',
          title: '10% Coupon started',
          impactExpectation: 'conversion_up',
          notes: '运营录入：Coupon 期间允许探索，但需要控制无订单花费。',
          createdAt: '2026-06-10T00:00:00.000Z',
          updatedAt: '2026-06-10T00:00:00.000Z',
        }],
      },
      productContext: {
        productCount: 1,
        products: [{
          asin: 'B0TESTASIN',
          title: 'Smoke product',
          productStage: 'keyword_exploration',
          status: 'active',
          cost: {
            targetAcos: 0.35,
            targetTacos: 0.12,
            targetNetMargin: 0.22,
            minPrice: 29.99,
          },
        }],
        notes: ['Product context should enter AI diagnosis.'],
      },
    };
    const blockedPipeline = {
      ...readyPipeline,
      collection: {
        ...readyPipeline.collection,
        status: 'blocked',
        latestBatch: null,
        sourceBatchIds: [],
        availableBatches: [],
        realReportFiles: [],
        fileAudit: {
          realReportFileCount: 0,
          importedRowCount: 0,
          missingReportLabels: ['关键词报告', '用户搜索词报告'],
        },
        blockers: ['当前范围缺少真实 xlsx/xls/csv 原始报表文件', '当前范围没有写入 DB 的广告指标行'],
      },
      quant: {
        ...readyPipeline.quant,
        hasImportedMetrics: false,
        importedRows: 0,
        actionableRows: 0,
        blockers: ['当前范围没有 keyword/search term/target 等可执行口径指标'],
      },
    };
    window.__businessUiActionLog = [];
    window.__hideRecommendations = false;
    window.__mockAiConfigured = true;
    window.__mockBlockedPipeline = false;
    window.__mockDecisionDelayMs = 0;
    window.__mockRecommendationReadDelayMs = 0;
    window.__lastApprovalDecision = null;
    window.electronAPI = {
      getState: async () => ({
        isLoggedIn: true,
        currentStore: 'FT-US-US',
        loginSession: { erpSessionReused: true, adsTitle: 'Amazon AI Ops' },
      }),
      browserLogout: async () => ({ success: true }),
      getBusinessUiDataPipeline: async () => window.__mockBlockedPipeline ? blockedPipeline : readyPipeline,
      getBusinessBatchOptions: async () => readyPipeline.collection.availableBatches,
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
      getRuleConfig: async () => ({
        targetAcos: 0.25,
        highAcosThreshold: 0.5,
        noOrderClickThreshold: 30,
        minSpend: 10,
        bidAdjustPercent: 0.1,
        maxBidDecrement: 0.2,
        brandWordWhitelist: ['brand'],
        coreWordWhitelist: ['core'],
      }),
      getRecommendations: async (filter) => {
        window.__businessUiActionLog.push({ type: 'getRecommendations', filter });
        if (window.__mockRecommendationReadDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, window.__mockRecommendationReadDelayMs));
        }
        if (window.__hideRecommendations) return [];
        if (filter?.status === 'pending' && window.__mockAiNoEvidenceRecommendation) {
          return [{
            ...aiNoEvidenceRecommendation,
            status: 'pending',
            evidence: { ...aiNoEvidenceRecommendation.evidence, batchId: filter?.batchId || aiNoEvidenceRecommendation.evidence.batchId },
          }];
        }
        if (filter?.status === 'pending' && window.__mockAiExplanationOnlyRecommendation) {
          return [{
            ...aiExplanationOnlyRecommendation,
            status: 'pending',
            evidence: { ...aiExplanationOnlyRecommendation.evidence, batchId: filter?.batchId || aiExplanationOnlyRecommendation.evidence.batchId },
          }];
        }
        return Array.from(recommendationState.values())
          .filter((recommendation) => recommendation.status === filter?.status)
          .map((recommendation) => ({
            ...recommendation,
            evidence: {
              ...recommendation.evidence,
              batchId: filter?.batchId || recommendation.evidence.batchId,
            },
          }));
      },
      generateRecommendations: async (params) => {
        window.__businessUiActionLog.push({ type: 'generateRecommendations', params });
        if (window.__mockScopedMetricsMissing) {
          throw new Error('生成优化建议被阻断：当前范围缺少可绑定的日级广告指标。请回到数据导入与校验页，确认真实报表 source_file、批次、店铺、站点和日期范围与 DB 指标一致。');
        }
        if (window.__mockNoRecommendationCandidates) {
          return {
            generated: 0,
            metrics: 24,
            skippedDuplicates: 0,
            recommendationCandidates: 0,
            aiExplanation: {
              configured: true,
              invoked: true,
              aiCount: 0,
              ruleCount: 0,
              reason: 'AI 已运行广告阶段诊断，但没有找到可安全绑定到当前真实指标的可审批动作。',
              model: 'deepseek-chat',
              strategyDiagnosis: {
                source: 'ai',
                lifecycleStage: 'stable_conversion',
                summary: '当前表现相对稳定，暂时没有足够证据支持调整出价或新增否定词。',
                mainProblems: [],
                riskWarnings: ['当前没有可安全执行的广告动作候选。'],
                thresholdSuggestions: {
                  targetAcos: { value: 0.25, reason: '保持当前目标 ACOS，等待更多稳定样本。' },
                  highAcosThreshold: { value: 0.5, reason: '保持当前风险边界，避免过早调整。' },
                  noOrderClickThreshold: { value: 30, reason: '保持当前点击阈值，继续观察无订单样本。' },
                  minSpend: { value: 10, reason: '保持当前最低花费门槛。' },
                },
                aiCandidateCount: 0,
                operationEventCount: 1,
                productContextCount: 1,
                decisionCounts: { total: 0, aligned: 0, ruleOnly: 0, aiOnly: 0, conflict: 0, reviewRequired: 0 },
                finalCandidateCount: 0,
                filteredAiOnlyCandidateCount: 0,
                filterReasons: ['规则和 AI 都没有返回可合并的候选动作。'],
                insightOnlyCandidateCount: 1,
                aiInsights: [{
                  entityType: 'search_term',
                  entityName: 'unbound no-candidate insight',
                  actionType: 'observe',
                  reason: 'AI 认为当前对象应继续观察，但缺少可执行动作和可绑定广告对象。',
                  invalidReasons: ['没有可绑定到当前真实指标的广告活动/广告组/对象。'],
                  confidence: 0.68,
                }],
              },
            },
          };
        }
        if (!window.__mockAiConfigured) {
          return {
            generated: 1,
            metrics: 24,
            skippedDuplicates: 0,
            recommendationCandidates: 1,
            aiExplanation: {
              configured: false,
              invoked: false,
              aiCount: 0,
              ruleCount: 1,
              reason: '未配置 AI Key，建议解释使用规则引擎兜底。',
              model: 'deepseek-chat',
              strategyDiagnosis: {
                source: 'rule',
                lifecycleStage: 'unknown',
                summary: '未配置 AI Key，广告阶段诊断使用规则兜底。',
                mainProblems: [],
                riskWarnings: ['AI unavailable'],
                thresholdSuggestions: {
                  targetAcos: { value: 0.25, reason: '当前规则配置兜底。' },
                  highAcosThreshold: { value: 0.5, reason: '当前规则配置兜底。' },
                  noOrderClickThreshold: { value: 30, reason: '当前规则配置兜底。' },
                  minSpend: { value: 10, reason: '当前规则配置兜底。' },
                },
                aiCandidateCount: 0,
                operationEventCount: 1,
                productContextCount: 1,
                decisionCounts: { total: 1, aligned: 0, ruleOnly: 1, aiOnly: 0, conflict: 0, reviewRequired: 0 },
                finalCandidateCount: 1,
                filteredAiOnlyCandidateCount: 0,
                filterReasons: ['1 条规则独立建议缺少 AI 确认，仍需按证据完整性审批。'],
                fallbackReason: '未配置 AI Key，广告阶段诊断使用规则兜底',
              },
            },
          };
        }
        if (window.__mockAiNoOutput) {
          return {
            generated: 1,
            metrics: 24,
            skippedDuplicates: 0,
            recommendationCandidates: 1,
            aiExplanation: {
              configured: true,
              invoked: true,
              aiCount: 0,
              ruleCount: 1,
              reason: '已尝试调用 AI，但本次没有可用 AI 输出，建议已回落到规则引擎。原因：AI 服务超时',
              model: 'deepseek-chat',
              strategyDiagnosis: {
                source: 'rule',
                lifecycleStage: 'unknown',
                summary: 'AI 诊断不可用，当前只使用确定性规则。',
                mainProblems: [],
                riskWarnings: ['AI 服务超时'],
                thresholdSuggestions: {
                  targetAcos: { value: 0.25, reason: '当前规则配置兜底。' },
                  highAcosThreshold: { value: 0.5, reason: '当前规则配置兜底。' },
                  noOrderClickThreshold: { value: 30, reason: '当前规则配置兜底。' },
                  minSpend: { value: 10, reason: '当前规则配置兜底。' },
                },
                aiCandidateCount: 0,
                operationEventCount: 1,
                productContextCount: 1,
                decisionCounts: { total: 1, aligned: 0, ruleOnly: 1, aiOnly: 0, conflict: 0, reviewRequired: 0 },
                finalCandidateCount: 1,
                filteredAiOnlyCandidateCount: 0,
                filterReasons: ['1 条规则独立建议缺少 AI 确认，仍需按证据完整性审批。'],
                fallbackReason: 'AI 服务超时',
              },
            },
          };
        }
        return {
          generated: 1,
          metrics: 24,
          skippedDuplicates: 0,
          recommendationCandidates: 1,
          aiExplanation: {
            configured: true,
            invoked: true,
            aiCount: 1,
            ruleCount: 0,
            reason: 'AI 已参与广告阶段诊断、动态阈值建议和 1/1 条规则候选解释。',
            model: 'deepseek-chat',
            strategyDiagnosis: {
              source: 'ai',
              lifecycleStage: 'keyword_exploration',
              summary: 'Coupon 背景显示该产品仍处于测词阶段，同时需要收紧无订单花费。',
              mainProblems: ['no_order_spend', 'high_acos'],
              riskWarnings: ['任何真实广告动作前都要保留审批和回读证据。'],
              thresholdSuggestions: {
                targetAcos: { value: 0.35, reason: '测词期允许更高容忍度。' },
                highAcosThreshold: { value: 0.55, reason: 'Coupon 期间临时放宽高 ACOS 边界。' },
                noOrderClickThreshold: { value: 18, reason: '当前点击样本已经足够。' },
                minSpend: { value: 15, reason: '避免基于过小样本动作。' },
              },
              aiCandidateCount: 1,
              operationEventCount: 1,
              productContextCount: 1,
              decisionCounts: { total: 1, aligned: 1, ruleOnly: 0, aiOnly: 0, conflict: 0, reviewRequired: 0 },
              finalCandidateCount: 1,
              filteredAiOnlyCandidateCount: 0,
              filterReasons: [],
            },
          },
        };
      },
      approveRecommendation: async (input) => {
        window.__businessUiActionLog.push({ type: 'approveRecommendation', input });
        const recommendation = recommendationState.get(input?.id);
        if (!recommendation || recommendation.status !== 'pending') {
          throw new Error(`Illegal recommendation transition: ${recommendation?.status || 'missing'} -> approved`);
        }
        if (!Number.isInteger(input?.expectedRevision) || input.expectedRevision !== recommendation.revision) {
          throw new Error('Recommendation revision conflict: refresh before approving');
        }
        if (!String(input?.decision?.approvedBy || '').trim()) {
          throw new Error('审批被阻断：批准前必须填写审批人。');
        }
        if (window.__mockDecisionDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, window.__mockDecisionDelayMs));
        }
        window.__lastApprovalDecision = input?.decision || null;
        recommendationState.set(input.id, {
          ...recommendation,
          status: 'approved',
          revision: recommendation.revision + 1,
          evidence: { ...recommendation.evidence, approvalDecision: input?.decision || undefined },
        });
        return undefined;
      },
      rejectRecommendation: async (input) => {
        window.__businessUiActionLog.push({ type: 'rejectRecommendation', input });
        const recommendation = recommendationState.get(input?.id);
        if (!recommendation || !['pending', 'needs_review'].includes(recommendation.status)) {
          throw new Error(`Illegal recommendation transition: ${recommendation?.status || 'missing'} -> rejected`);
        }
        if (!Number.isInteger(input?.expectedRevision) || input.expectedRevision !== recommendation.revision) {
          throw new Error('Recommendation revision conflict: refresh before rejecting');
        }
        if (!String(input?.decision?.rejectedBy || '').trim()) {
          throw new Error('审批被阻断：拒绝前必须填写处理人。');
        }
        if (!String(input?.decision?.note || '').trim()) {
          throw new Error('审批被阻断：拒绝前必须填写拒绝原因。');
        }
        if (window.__mockDecisionDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, window.__mockDecisionDelayMs));
        }
        window.__lastRejectedDecision = input?.decision || null;
        recommendationState.set(input.id, {
          ...recommendation,
          status: 'rejected',
          revision: recommendation.revision + 1,
          evidence: { ...recommendation.evidence, rejectionDecision: input?.decision || undefined },
        });
        return undefined;
      },
      exportAdReadbackEvidence: async (input) => {
        window.__businessUiActionLog.push({ type: 'exportAdReadbackEvidence', input });
        const readyForVerifier = Boolean(
          input?.approval?.approverName
            && input?.approval?.approvalArtifactPath
            && input?.approval?.confirmedAt
            && input?.execution?.executedBy
            && input?.execution?.executionId
            && input?.execution?.executedAt
            && input?.before?.capturedAt
            && input?.after?.capturedAt
            && input?.readback?.readAt
            && input?.readback?.actualValue === input?.after?.value
            && input?.execution?.success
            && input?.execution?.verified
            && input?.readback?.verified
        );
        return {
          jsonPath: 'C:/evidence/readback.json',
          markdownPath: 'C:/evidence/readback.md',
          status: readyForVerifier ? 'PASS' : 'NEEDS_WORK',
          readyForVerifier,
        };
      },
      prepareAdReadbackSession: async (input) => {
        window.__businessUiActionLog.push({ type: 'prepareAdReadbackSession', input });
        return {
          sessionDir: 'C:/evidence/readback-session',
          sourceCandidatePath: input?.sourcePath,
          passEvidencePath: 'C:/evidence/readback-session/real-ad-execution-readback-pass.json',
          approvalsDir: 'C:/evidence/readback-session/approvals',
          beforeScreenshotsDir: 'C:/evidence/readback-session/screenshots/before',
          afterScreenshotsDir: 'C:/evidence/readback-session/screenshots/after',
          readbackScreenshotsDir: 'C:/evidence/readback-session/screenshots/readback',
          checklistPath: 'C:/evidence/readback-session/operator-checklist.md',
          sessionInputPath: 'C:/evidence/readback-session/session-input.json',
          sessionInputGuidePath: 'C:/evidence/readback-session/session-input-guide.md',
          fillScriptPath: 'C:/evidence/readback-session/fill-ad-readback.ps1',
          sourceReportsCopied: false,
        };
      },
      verifyAdReadbackSession: async (input) => {
        window.__businessUiActionLog.push({ type: 'verifyAdReadbackSession', input });
        return {
          sessionDir: input?.sessionDir,
          ready: true,
          captureReady: false,
          checks: [
            { label: 'source candidate is NEEDS_WORK', passed: true },
            { label: 'raw report files are not copied into session', passed: true },
          ],
          issues: [],
          unresolvedFields: ['approverName', 'beforeValue', 'afterValue', 'readbackEvidencePath'],
          captureMissingFields: [
            { field: 'approverName', label: '审批人', group: '审批' },
            { field: 'beforeValue', label: '现场出价', group: '执行前' },
            { field: 'afterValue', label: '现场出价', group: '执行后' },
            { field: 'readbackEvidencePath', label: '刷新回读截图文件', group: '回读' },
          ],
          captureIssues: ['填写文件仍有未填写项：审批/审批人、执行前/现场出价、执行后/现场出价、回读/刷新回读截图文件'],
        };
      },
      fillAdReadbackSession: async (input) => {
        window.__businessUiActionLog.push({ type: 'fillAdReadbackSession', input });
        return {
          sessionDir: input?.sessionDir,
          jsonPath: 'C:/evidence/readback-session/real-ad-execution-readback-pass.json',
          markdownPath: 'C:/evidence/readback-session/real-ad-execution-readback-pass.md',
          status: 'PASS',
          readyForVerifier: true,
          issues: [],
        };
      },
      verifyAdReadbackEvidence: async (input) => {
        window.__businessUiActionLog.push({ type: 'verifyAdReadbackEvidence', input });
        return {
          evidencePath: input?.evidencePath,
          ready: true,
          status: 'PASS',
          checks: [
            { label: '执行结果已成功、已核验，并限定为人工广告后台操作', passed: true },
            { label: 'source report traceability includes real spreadsheet file(s) and row number', passed: true },
          ],
          issues: [],
        };
      },
      openReportPath: async (targetPath) => {
        window.__businessUiActionLog.push({ type: 'openReportPath', targetPath });
        return { success: true };
      },
    };
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });
  await setManualScopeBatch(page, 'manual_ad_execution_batch');
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.locator('.scope-compact-trigger').click();
  await page.getByLabel('当前范围详情').getByText('批次', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('真实报表', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.body.textContent?.includes('手动批次未自动校验：manual_ad_execution_batch'), null, { timeout: 5000 });
  await expectInBody(page, 'manual_ad_execution_batch', 'manual batch scope value');
  await page.locator('.scope-compact-trigger').click();

  const legacyDecisionRoutes = [
    {
      route: 'recommendations',
      subview: 'recommendations',
      label: '旧优化建议入口',
      key: 'legacyRecommendations',
    },
    {
      route: 'approval',
      subview: 'approval',
      label: '旧审批中心入口',
      key: 'legacyApproval',
    },
  ];
  for (const { route, subview, label, key } of legacyDecisionRoutes) {
    await navigateBusinessPage(page, NAV_RE[route], route);
    await waitForDecisionsSubview(page, subview);
    await assertGlobalGuards(page, key);
    await captureViewportScreenshot(page, evidence, key, runId, {
      label,
      legacyRoute: route,
      workspace: 'decisions',
      subview,
    });
  }

  await navigateBusinessPage(page, NAV_RE.readback, 'readback');
  await page.getByRole('heading', { name: HEADING_RE.readback, level: 1 }).waitFor();
  await assertGlobalGuards(page, 'readback');
  await captureViewportScreenshot(page, evidence, 'readback', runId, {
    label: '结果核对',
    legacyRoute: 'readback',
  });

  await page.setViewportSize({ width: 1200, height: 700 });
  await navigateBusinessPage(page, NAV_RE.recommendations, 'recommendations');
  const decisionsRoot = await waitForDecisionsSubview(page, 'recommendations');
  await decisionsRoot.locator('.priority-table tbody tr[aria-label]').first().waitFor({ timeout: 5000 });

  const fiveColumnState = await decisionsRoot.locator('.priority-table thead th').evaluateAll((nodes) => nodes.map((node) => ({
    label: String(node.textContent || '').trim(),
    display: getComputedStyle(node).display,
    width: node.getBoundingClientRect().width,
  })));
  const expectedDecisionColumns = ['动作', '对象', '当前 → 建议', '证据', '决策'];
  if (fiveColumnState.length !== expectedDecisionColumns.length
    || fiveColumnState.some((column, index) => (
      column.label !== expectedDecisionColumns[index]
      || column.display === 'none'
      || column.width <= 0
    ))) {
    fail('Decisions table did not keep all five columns visible at 1200px', JSON.stringify(fiveColumnState));
  }
  await assertNoPageHorizontalOverflow(page, '1200x700 decisions queue');

  const drawerTrigger = decisionsRoot.locator('.priority-table tbody tr[aria-label]').first();
  await drawerTrigger.evaluate((node) => node.setAttribute('data-smoke-drawer-trigger', 'true'));
  await drawerTrigger.focus();
  await drawerTrigger.press('Enter');
  const drawer = page.getByRole('dialog');
  await drawer.waitFor({ state: 'visible', timeout: 5000 });
  if (await drawer.getAttribute('aria-modal') !== 'true'
    || await drawer.getAttribute('data-inspector-mode') !== 'drawer') {
    fail('1200px row inspector did not open as an aria-modal drawer');
  }
  const inertState = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][data-inspector-mode="drawer"]');
    const backdrop = dialog?.closest('.responsive-inspector__backdrop');
    const immediateSiblings = backdrop?.parentElement
      ? Array.from(backdrop.parentElement.children).filter((node) => node !== backdrop)
      : [];
    return {
      inertCount: document.querySelectorAll('[inert]').length,
      immediateSiblingCount: immediateSiblings.length,
      immediateSiblingsInert: immediateSiblings.every((node) => node.hasAttribute('inert') && node.inert === true),
    };
  });
  if (!inertState.inertCount
    || !inertState.immediateSiblingCount
    || !inertState.immediateSiblingsInert) {
    fail('Drawer background was not made inert across the active ancestor path', JSON.stringify(inertState));
  }

  const drawerLayerState = await page.evaluate(() => {
    const backdrop = document.querySelector('.responsive-inspector__backdrop');
    const dialog = backdrop?.querySelector('[role="dialog"]');
    const header = dialog?.querySelector('.responsive-inspector__header');
    const close = dialog?.querySelector('button[aria-label="关闭详情检查器"]');
    const topbar = document.querySelector('.topbar');
    const rect = (node) => node?.getBoundingClientRect();
    const headerRect = rect(header);
    const closeRect = rect(close);
    return {
      backdropZ: Number.parseInt(getComputedStyle(backdrop).zIndex || '0', 10),
      topbarZ: Number.parseInt(getComputedStyle(topbar).zIndex || '0', 10),
      headerTop: headerRect?.top ?? null,
      headerBottom: headerRect?.bottom ?? null,
      closeTop: closeRect?.top ?? null,
      closeBottom: closeRect?.bottom ?? null,
      viewportHeight: window.innerHeight,
    };
  });
  if (!(drawerLayerState.backdropZ > drawerLayerState.topbarZ)
    || drawerLayerState.headerTop === null
    || drawerLayerState.headerTop < -1
    || drawerLayerState.headerBottom > drawerLayerState.viewportHeight + 1
    || drawerLayerState.closeTop === null
    || drawerLayerState.closeTop < -1
    || drawerLayerState.closeBottom > drawerLayerState.viewportHeight + 1) {
    fail('Drawer title and close control were obscured by the global topbar', JSON.stringify(drawerLayerState));
  }

  const drawerClose = drawer.getByRole('button', { name: '关闭详情检查器' });
  await drawerClose.focus();
  await page.keyboard.press('Shift+Tab');
  const wrappedBackward = await drawer.evaluate((node) => {
    const focusable = Array.from(node.querySelectorAll(
      'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    ));
    return focusable.length > 1
      && document.activeElement === focusable[focusable.length - 1]
      && node.contains(document.activeElement);
  });
  if (!wrappedBackward) fail('Drawer Shift+Tab did not wrap focus to the last control');
  await page.keyboard.press('Tab');
  const wrappedForward = await drawer.evaluate((node) => (
    node.querySelector('button[aria-label="关闭详情检查器"]') === document.activeElement
  ));
  if (!wrappedForward) fail('Drawer Tab did not wrap focus to the first control');

  await captureViewportScreenshot(page, evidence, 'decisionsDrawer1200', runId, {
    label: '建议与审批抽屉检查器',
    workspace: 'decisions',
    subview: 'recommendations',
    inspectorMode: 'drawer',
    fiveColumns: fiveColumnState.map((column) => column.label),
    inertState,
    drawerLayerState,
    focusTrap: { backward: wrappedBackward, forward: wrappedForward },
  });
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached', timeout: 5000 });
  await page.waitForTimeout(100);
  const drawerFocusState = await page.evaluate(() => ({
    restored: document.activeElement?.getAttribute('data-smoke-drawer-trigger') === 'true',
    activeElement: {
      tagName: document.activeElement?.tagName || null,
      className: document.activeElement?.getAttribute('class') || null,
      ariaLabel: document.activeElement?.getAttribute('aria-label') || null,
    },
    triggerPresent: Boolean(document.querySelector('[data-smoke-drawer-trigger="true"]')),
  }));
  const drawerFocusRestored = drawerFocusState.restored;
  if (!drawerFocusRestored) {
    fail('Drawer Escape did not restore focus to the originating row', JSON.stringify(drawerFocusState));
  }
  if (await page.locator('[inert]').count()) fail('Drawer close did not restore background interactivity');
  evidence.drawerInteraction = {
    viewport: { width: 1200, height: 700 },
    ariaModal: true,
    inertState,
    focusTrap: { backward: wrappedBackward, forward: wrappedForward },
    escapeClosed: true,
    focusRestored: drawerFocusRestored,
  };

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(50);
  const inlineTrigger = decisionsRoot.locator('.priority-table tbody tr[aria-label]').first();
  await inlineTrigger.focus();
  await inlineTrigger.press('Enter');
  const inlineInspector = page.getByRole('complementary');
  await inlineInspector.waitFor({ state: 'visible', timeout: 5000 });
  if (await inlineInspector.getAttribute('data-inspector-mode') !== 'inline') {
    fail('1400px row inspector did not open inline');
  }
  if (await page.getByRole('dialog').count()
    || await page.locator('.responsive-inspector__backdrop').count()) {
    fail('1400px inline inspector unexpectedly exposed a dialog or backdrop');
  }
  await assertNoPageHorizontalOverflow(page, '1400x900 inline decisions inspector');
  const inlineLayoutState = await page.evaluate(() => {
    const tableScroll = document.querySelector('[data-workspace="decisions"] .priority-table-scroll');
    const table = tableScroll?.querySelector('.priority-table');
    const inspector = document.querySelector('.responsive-inspector--inline');
    const technical = inspector?.querySelector('details.decisions-technical-disclosure');
    const decisionForm = inspector?.querySelector('.decisions-decision-form');
    const technicalRect = technical?.getBoundingClientRect();
    const decisionRect = decisionForm?.getBoundingClientRect();
    return {
      tableClientWidth: tableScroll?.clientWidth ?? null,
      tableScrollWidth: tableScroll?.scrollWidth ?? null,
      tableWidth: table?.getBoundingClientRect().width ?? null,
      technicalOpen: technical?.hasAttribute('open') ?? null,
      decisionBeforeTechnical: Boolean(
        decisionRect
        && technicalRect
        && decisionRect.top < technicalRect.top
      ),
    };
  });
  if (inlineLayoutState.tableClientWidth === null
    || inlineLayoutState.tableScrollWidth > inlineLayoutState.tableClientWidth + 1
    || inlineLayoutState.technicalOpen !== false
    || !inlineLayoutState.decisionBeforeTechnical) {
    fail('1400px inline inspector obscured the five-column queue or exposed technical detail before the decision task', JSON.stringify(inlineLayoutState));
  }
  await captureViewportScreenshot(page, evidence, 'decisionsInline1400', runId, {
    label: '建议与审批内联检查器',
    workspace: 'decisions',
    subview: 'recommendations',
    inspectorMode: 'inline',
    inlineLayoutState,
    pageHorizontalOverflow: false,
  });
  await inlineInspector.getByRole('textbox', { name: /审批人|处理人/ }).fill('Transient Row Owner');
  await inlineInspector.getByRole('textbox', { name: /审批备注|拒绝原因/ }).fill('Transient row note must not cross rows.');
  await inlineInspector.getByRole('button', { name: '关闭详情检查器' }).click();
  await inlineInspector.waitFor({ state: 'detached', timeout: 5000 });
  const secondInlineTrigger = decisionsRoot.locator('.priority-table tbody tr[aria-label]').nth(1);
  await secondInlineTrigger.focus();
  await secondInlineTrigger.press('Enter');
  const secondInlineInspector = page.getByRole('complementary');
  await secondInlineInspector.waitFor({ state: 'visible', timeout: 5000 });
  const crossRowFormValues = await secondInlineInspector.locator('input, textarea').evaluateAll((nodes) => (
    nodes.map((node) => node.value)
  ));
  if (crossRowFormValues.some((value) => value !== '')) {
    fail('Decision form values leaked across selected rows', JSON.stringify(crossRowFormValues));
  }
  evidence.crossRowFormReset = {
    fromRowIndex: 0,
    toRowIndex: 1,
    formValues: crossRowFormValues,
    cleared: true,
  };
  await secondInlineInspector.getByRole('button', { name: '关闭详情检查器' }).click();
  await secondInlineInspector.waitFor({ state: 'detached', timeout: 5000 });

  async function recordTabState(step, expectedSubview) {
    await waitForDecisionsSubview(page, expectedSubview);
    const state = await page.evaluate(() => {
      const rootElement = document.querySelector('[data-workspace="decisions"]');
      const selectedTabs = Array.from(document.querySelectorAll('.decisions-tabs [role="tab"][aria-selected="true"]'));
      const focusedTab = document.activeElement?.closest?.('.decisions-tabs [role="tab"]');
      const panels = Array.from(document.querySelectorAll('[data-workspace="decisions"] [role="tabpanel"]'))
        .filter((panel) => getComputedStyle(panel).display !== 'none');
      return {
        subview: rootElement?.getAttribute('data-workspace-subview') || null,
        selectedTabCount: selectedTabs.length,
        selectedTab: String(selectedTabs[0]?.textContent || '').trim(),
        focusedTab: String(focusedTab?.textContent || '').trim(),
        visibleTabpanelCount: panels.length,
        tabpanelId: panels[0]?.id || null,
      };
    });
    evidence.tabTrajectory.push({ step, ...state });
    if (state.subview !== expectedSubview
      || state.selectedTabCount !== 1
      || state.visibleTabpanelCount !== 1) {
      fail('Decisions tab semantics became inconsistent', JSON.stringify({ step, expectedSubview, state }));
    }
    return state;
  }

  const recommendationsTab = page.getByRole('tab', { name: /待判断/ });
  await recommendationsTab.focus();
  await recordTabState('initial:recommendations', 'recommendations');
  await page.keyboard.press('ArrowRight');
  const approvalTabState = await recordTabState('ArrowRight:approval', 'approval');
  if (!approvalTabState.focusedTab.includes('待审批')) {
    fail('ArrowRight did not move roving focus to 待审批', JSON.stringify(approvalTabState));
  }
  await page.keyboard.press('End');
  const decidedTabState = await recordTabState('End:decided', 'decided');
  if (!decidedTabState.focusedTab.includes('已决策')) {
    fail('End did not move roving focus to 已决策', JSON.stringify(decidedTabState));
  }
  await page.keyboard.press('Home');
  const homeTabState = await recordTabState('Home:recommendations', 'recommendations');
  if (!homeTabState.focusedTab.includes('待判断')) {
    fail('Home did not return roving focus to 待判断', JSON.stringify(homeTabState));
  }

  const alternateBatchId = 'manual_ad_execution_batch_next';
  await page.evaluate(() => {
    window.__mockRecommendationReadDelayMs = 500;
  });
  await setManualScopeBatch(page, alternateBatchId);
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.waitForFunction((batchId) => (
    (window.__businessUiActionLog || []).some((item) => (
      item.type === 'getRecommendations' && item.filter?.batchId === batchId
    ))
  ), alternateBatchId, { timeout: 5000 });
  await page.waitForFunction(() => (
    Array.from(document.querySelectorAll('.decisions-tabs button')).length === 3
      && Array.from(document.querySelectorAll('.decisions-tabs button')).every((node) => node.disabled)
  ), null, { timeout: 2000 });
  const publishedQueryLock = await page.evaluate(() => ({
    oldRowsStillVisible: document.querySelectorAll('.priority-table tbody tr[aria-label]').length,
    tabsLocked: Array.from(document.querySelectorAll('.decisions-tabs button')).every((node) => node.disabled),
    checkboxesLocked: Array.from(document.querySelectorAll('.decisions-selection-checkbox')).every((node) => node.disabled),
    taskActionsLocked: Array.from(document.querySelectorAll('.task-banner__actions button')).every((node) => node.disabled),
  }));
  if (!publishedQueryLock.tabsLocked
    || !publishedQueryLock.checkboxesLocked
    || !publishedQueryLock.taskActionsLocked) {
    fail('Scope commit did not synchronously lock the previous query rows', JSON.stringify(publishedQueryLock));
  }
  if (publishedQueryLock.oldRowsStillVisible > 0) {
    const lockedOldRow = decisionsRoot.locator('.priority-table tbody tr[aria-label]').first();
    await lockedOldRow.focus();
    await lockedOldRow.press('Enter');
    await page.waitForTimeout(50);
    if (await page.getByRole('dialog').count() || await page.getByRole('complementary').count()) {
      fail('A previous-query row opened while the new scope was still unpublished');
    }
  }
  await page.waitForFunction(() => (
    Array.from(document.querySelectorAll('.decisions-tabs button')).length === 3
      && Array.from(document.querySelectorAll('.decisions-tabs button')).every((node) => !node.disabled)
  ), null, { timeout: 5000 });

  const originalBatchReadsBeforeRestore = await page.evaluate(() => (
    (window.__businessUiActionLog || []).filter((item) => (
      item.type === 'getRecommendations' && item.filter?.batchId === 'manual_ad_execution_batch'
    )).length
  ));
  await page.evaluate(() => {
    window.__mockRecommendationReadDelayMs = 0;
  });
  await setManualScopeBatch(page, 'manual_ad_execution_batch');
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.waitForFunction((before) => (
    (window.__businessUiActionLog || []).filter((item) => (
      item.type === 'getRecommendations' && item.filter?.batchId === 'manual_ad_execution_batch'
    )).length > before
  ), originalBatchReadsBeforeRestore, { timeout: 5000 });
  await page.waitForFunction(() => (
    Array.from(document.querySelectorAll('.decisions-tabs button')).length === 3
      && Array.from(document.querySelectorAll('.decisions-tabs button')).every((node) => !node.disabled)
  ), null, { timeout: 5000 });
  evidence.publishedQueryLock = {
    alternateBatchId,
    ...publishedQueryLock,
    oldRowInteractionBlocked: publishedQueryLock.oldRowsStillVisible > 0,
    oldRowsHiddenDuringLock: publishedQueryLock.oldRowsStillVisible === 0,
    originalBatchRestored: true,
  };

  const generationBefore = await page.evaluate(() => {
    const statuses = ['pending', 'needs_review', 'approved', 'rejected'];
    const log = window.__businessUiActionLog || [];
    return {
      generateCount: log.filter((item) => item.type === 'generateRecommendations').length,
      getCounts: Object.fromEntries(statuses.map((status) => [
        status,
        log.filter((item) => item.type === 'getRecommendations' && item.filter?.status === status).length,
      ])),
    };
  });
  await page.evaluate(() => {
    window.__mockNoRecommendationCandidates = true;
  });
  const generateButton = page.locator('.task-banner').getByRole('button', { name: /生成.*建议/ });
  if (await generateButton.count() !== 1) {
    fail('Recommendations subview must expose one task-level generate action', String(await generateButton.count()));
  }
  await generateButton.click();
  await page.waitForFunction((before) => {
    const log = window.__businessUiActionLog || [];
    const statuses = ['pending', 'needs_review', 'approved', 'rejected'];
    return log.filter((item) => item.type === 'generateRecommendations').length > before.generateCount
      && statuses.every((status) => (
        log.filter((item) => item.type === 'getRecommendations' && item.filter?.status === status).length
          > before.getCounts[status]
      ));
  }, generationBefore, { timeout: 5000 });
  const generationAuthorityReload = await page.evaluate((before) => {
    const statuses = ['pending', 'needs_review', 'approved', 'rejected'];
    const log = window.__businessUiActionLog || [];
    const generationCall = log.filter((item) => item.type === 'generateRecommendations').at(-1);
    return {
      generationCall,
      authorityReloadCounts: Object.fromEntries(statuses.map((status) => [
        status,
        log.filter((item) => item.type === 'getRecommendations' && item.filter?.status === status).length
          - before.getCounts[status],
      ])),
    };
  }, generationBefore);
  if (!generationAuthorityReload.generationCall) {
    fail('Zero-candidate generation did not call the production IPC contract');
  }
  assertScopeParams(generationAuthorityReload.generationCall.params, 'generateRecommendations zero-candidate');
  if (Object.values(generationAuthorityReload.authorityReloadCounts).some((count) => count < 1)) {
    fail('Zero-candidate generation did not reload all authoritative statuses', JSON.stringify(generationAuthorityReload));
  }
  evidence.generationAuthorityReload = generationAuthorityReload;
  await page.evaluate(() => {
    window.__mockNoRecommendationCandidates = false;
  });
  await decisionsRoot.locator('.priority-table tbody tr[aria-label]').first().waitFor({ timeout: 5000 });
  const authoritativeRowsAfterGeneration = await decisionsRoot.locator('.priority-table tbody tr[aria-label]').count();
  if (authoritativeRowsAfterGeneration !== 2) {
    fail('Zero-candidate generation replaced authoritative rows with a synthetic response', String(authoritativeRowsAfterGeneration));
  }

  const eligibleBatchCheckboxes = decisionsRoot.locator('.priority-table tbody input[type="checkbox"]');
  if (await eligibleBatchCheckboxes.count() !== 1) {
    fail('Batch selection must expose only eligibility-complete pending rows', String(await eligibleBatchCheckboxes.count()));
  }
  await eligibleBatchCheckboxes.first().click();
  const batchHandoffButton = page.getByRole('button', { name: /复核所选\s*1\s*项/ });
  if (await batchHandoffButton.count() !== 1 || await batchHandoffButton.isDisabled()) {
    fail('Selecting the eligible pending row did not enable the batch approval handoff');
  }
  await batchHandoffButton.click();
  await waitForDecisionsSubview(page, 'approval');
  await page.waitForFunction(() => (
    window.sessionStorage?.getItem('amazon-ai-ops:approval-selection') === null
  ), null, { timeout: 2000 });
  const handoffStorageConsumed = await page.evaluate(() => (
    window.sessionStorage?.getItem('amazon-ai-ops:approval-selection') === null
  ));
  if (!handoffStorageConsumed) fail('Batch handoff sessionStorage hint was not consumed once');
  await decisionsRoot.locator('.priority-table tbody tr[aria-label]').first().waitFor({ timeout: 5000 });
  if (await decisionsRoot.locator('.priority-table tbody tr[aria-label]').count() !== 1) {
    fail('Approval handoff did not show the authoritative pending row');
  }
  const decisionsCountAfterHandoff = await page.getByRole('tab', { name: /待判断/ }).innerText();
  if (!/已载入\s*2/.test(decisionsCountAfterHandoff)) {
    fail('Batch handoff hid another authoritative row from the decisions workspace', decisionsCountAfterHandoff);
  }
  await page.getByRole('tab', { name: /待判断/ }).click();
  await waitForDecisionsSubview(page, 'recommendations');
  if (await decisionsRoot.locator('.priority-table tbody tr[aria-label]').count() !== 2) {
    fail('Batch handoff filtered the authoritative recommendation view instead of only focusing it');
  }
  await page.getByRole('tab', { name: /待审批/ }).click();
  await waitForDecisionsSubview(page, 'approval');
  evidence.batchHandoff = {
    selectableEligiblePendingRows: 1,
    approvalRows: 1,
    recommendationsRowsAfterReturn: 2,
    preservedAuthoritativeRows: true,
    sessionStorageConsumed: handoffStorageConsumed,
  };

  await page.setViewportSize({ width: 1200, height: 700 });
  await page.waitForTimeout(50);
  const pendingRow = decisionsRoot.locator('.priority-table tbody tr[aria-label]').first();
  await pendingRow.focus();
  await pendingRow.press('Enter');
  const approvalDrawer = page.getByRole('dialog');
  await approvalDrawer.waitFor({ state: 'visible', timeout: 5000 });
  const approveButton = approvalDrawer.getByRole('button', { name: '批准，进入结果核对', exact: true });
  const approvalCallsBeforeValidation = await page.evaluate(() => (
    (window.__businessUiActionLog || []).filter((item) => item.type === 'approveRecommendation').length
  ));
  await approveButton.click();
  await expectVisible(page, '批准前必须填写审批人。');
  const approvalCallsAfterEmptyActor = await page.evaluate(() => (
    (window.__businessUiActionLog || []).filter((item) => item.type === 'approveRecommendation').length
  ));
  if (approvalCallsAfterEmptyActor !== approvalCallsBeforeValidation) {
    fail('Empty approval actor escaped the renderer fail-closed guard');
  }

  await approvalDrawer.getByRole('textbox', { name: /审批人|处理人/ }).fill('QA Approver');
  await approvalDrawer.getByRole('textbox', { name: /审批备注|拒绝原因/ }).fill('Approved for smoke scope only.');
  await page.evaluate(() => {
    window.__mockDecisionDelayMs = 500;
  });
  await approveButton.click();
  await page.waitForFunction(() => (
    document.querySelector('[role="dialog"][data-inspector-mode="drawer"]')?.getAttribute('aria-busy') === 'true'
  ), null, { timeout: 2000 });
  if (!await approvalDrawer.getByRole('button', { name: '关闭详情检查器' }).isDisabled()
    || !await approvalDrawer.getByRole('button', { name: '拒绝', exact: true }).isDisabled()) {
    fail('Decision busy state did not lock close and peer decision actions');
  }
  const busyTabsLocked = await page.locator('.decisions-tabs button').evaluateAll((nodes) => (
    nodes.length === 3 && nodes.every((node) => node.disabled)
  ));
  const busyTaskActionsLocked = await page.locator('.task-banner__actions button').evaluateAll((nodes) => (
    nodes.length > 0 && nodes.every((node) => node.disabled)
  ));
  if (!busyTabsLocked || !busyTaskActionsLocked) {
    fail('Decision busy state did not lock tab and task-action peers', JSON.stringify({ busyTabsLocked, busyTaskActionsLocked }));
  }
  await page.keyboard.press('Escape');
  if (!await approvalDrawer.isVisible()) fail('Busy decision drawer closed on Escape');
  await page.getByText(/审批已通过 #101/).waitFor({ timeout: 5000 });
  await expectVisible(page, '已批准，尚不代表已执行。');
  await approvalDrawer.waitFor({ state: 'detached', timeout: 5000 });
  await page.waitForFunction(() => (
    document.activeElement?.getAttribute('role') === 'tab'
      && document.activeElement?.getAttribute('aria-selected') === 'true'
      && String(document.activeElement?.textContent || '').includes('待审批')
  ), null, { timeout: 2000 });
  const approvalFocusOwner = await page.evaluate(() => String(document.activeElement?.textContent || '').trim());
  await page.evaluate(() => {
    window.__mockDecisionDelayMs = 0;
  });
  if (await decisionsRoot.locator('.priority-table tbody tr[aria-label]').count()) {
    fail('Approved row remained in the authoritative pending view after refresh');
  }
  evidence.busyDecisionLock = {
    closeLocked: true,
    peerDecisionLocked: true,
    tabsLocked: busyTabsLocked,
    taskActionsLocked: busyTaskActionsLocked,
    escapeLocked: true,
    completionFocusOwner: approvalFocusOwner,
  };

  await page.getByRole('tab', { name: /待判断/ }).click();
  await waitForDecisionsSubview(page, 'recommendations');
  const needsReviewRow = decisionsRoot.locator('.priority-table tbody tr[aria-label*="需复核"]').first();
  await needsReviewRow.waitFor({ state: 'visible', timeout: 5000 });
  await needsReviewRow.focus();
  await needsReviewRow.press('Enter');
  const reviewDrawer = page.getByRole('dialog');
  await reviewDrawer.waitFor({ state: 'visible', timeout: 5000 });
  if (await reviewDrawer.getByRole('button', { name: '批准，进入结果核对', exact: true }).count()) {
    fail('Needs-review recommendation exposed an approve action');
  }
  const rejectButton = reviewDrawer.getByRole('button', { name: '拒绝', exact: true });
  const rejectCallsBeforeValidation = await page.evaluate(() => (
    (window.__businessUiActionLog || []).filter((item) => item.type === 'rejectRecommendation').length
  ));
  await rejectButton.click();
  await expectVisible(page, '拒绝前必须填写处理人。');
  await reviewDrawer.getByRole('textbox', { name: /处理人/ }).fill('QA Rejector');
  await rejectButton.click();
  await expectVisible(page, '拒绝前必须填写拒绝原因。');
  const rejectCallsAfterEmptyFields = await page.evaluate(() => (
    (window.__businessUiActionLog || []).filter((item) => item.type === 'rejectRecommendation').length
  ));
  if (rejectCallsAfterEmptyFields !== rejectCallsBeforeValidation) {
    fail('Incomplete reject form escaped the renderer fail-closed guard');
  }
  await reviewDrawer.getByRole('textbox', { name: /拒绝原因|审批备注/ }).fill('Rejected during smoke audit.');
  await rejectButton.click();
  await page.getByText(/建议已拦截 #102/).waitFor({ timeout: 5000 });
  await reviewDrawer.waitFor({ state: 'detached', timeout: 5000 });
  await page.waitForFunction(() => (
    document.activeElement?.getAttribute('role') === 'tab'
      && document.activeElement?.getAttribute('aria-selected') === 'true'
      && String(document.activeElement?.textContent || '').includes('待判断')
  ), null, { timeout: 2000 });
  evidence.rejectionCompletionFocusOwner = await page.evaluate(() => (
    String(document.activeElement?.textContent || '').trim()
  ));
  if (await decisionsRoot.locator('.priority-table tbody tr[aria-label]').count()) {
    fail('Rejected needs-review row remained in the active authoritative view after refresh');
  }

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('tab', { name: /已决策/ }).click();
  await waitForDecisionsSubview(page, 'decided');
  const historyRows = decisionsRoot.locator('.priority-table tbody tr[aria-label]');
  await historyRows.first().waitFor({ state: 'visible', timeout: 5000 });
  if (await historyRows.count() !== 2) {
    fail('Decided history did not contain both authoritative decisions', String(await historyRows.count()));
  }

  async function assertReadOnlyHistoryRow(statusLabel, screenshotKey) {
    const historyRow = decisionsRoot.locator('.priority-table tbody tr[aria-label*="' + statusLabel + '"]').first();
    await historyRow.focus();
    await historyRow.press('Enter');
    const inspector = page.getByRole('complementary');
    await inspector.waitFor({ state: 'visible', timeout: 5000 });
    if (await inspector.locator('.decisions-decision-form').count()
      || await inspector.getByRole('button', { name: '批准，进入结果核对', exact: true }).count()
      || await inspector.getByRole('button', { name: '拒绝', exact: true }).count()
      || await inspector.locator('input, textarea, select').count()) {
      fail('Historical decision exposed editable decision controls', statusLabel);
    }
    if (statusLabel === '已批准') {
      await inspector.getByText('已批准，尚不代表已执行。', { exact: true }).waitFor({ timeout: 5000 });
    } else {
      await inspector.getByText('已拒绝，当前决定只读。', { exact: true }).waitFor({ timeout: 5000 });
    }
    await captureViewportScreenshot(page, evidence, screenshotKey, runId, {
      label: statusLabel + '只读历史',
      workspace: 'decisions',
      subview: 'decided',
      inspectorMode: 'inline',
      readOnly: true,
    });
    await inspector.getByRole('button', { name: '关闭详情检查器' }).click();
    await inspector.waitFor({ state: 'detached', timeout: 5000 });
  }

  await assertReadOnlyHistoryRow('已批准', 'decisionsHistoryApproved1400');
  await assertReadOnlyHistoryRow('已拒绝', 'decisionsHistoryRejected1400');
  await assertNoPageHorizontalOverflow(page, '1400x900 decided history');

  const decisionStateContract = await page.evaluate(async () => {
    const scopeFilter = {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      batchId: 'manual_ad_execution_batch',
    };
    const [pending, needsReview, approved, rejected] = await Promise.all([
      window.electronAPI.getRecommendations({ ...scopeFilter, status: 'pending' }),
      window.electronAPI.getRecommendations({ ...scopeFilter, status: 'needs_review' }),
      window.electronAPI.getRecommendations({ ...scopeFilter, status: 'approved' }),
      window.electronAPI.getRecommendations({ ...scopeFilter, status: 'rejected' }),
    ]);
    const guardedTransitions = [];
    for (const transition of [
      {
        method: 'approveRecommendation',
        id: 101,
        expectedRevision: 1,
        decision: { approvedBy: 'Terminal Guard' },
      },
      {
        method: 'rejectRecommendation',
        id: 101,
        expectedRevision: 1,
        decision: { rejectedBy: 'Terminal Guard', note: 'Must stay terminal.' },
      },
      {
        method: 'approveRecommendation',
        id: 102,
        expectedRevision: 1,
        decision: { approvedBy: 'Terminal Guard' },
      },
      {
        method: 'rejectRecommendation',
        id: 102,
        expectedRevision: 1,
        decision: { rejectedBy: 'Terminal Guard', note: 'Must stay terminal.' },
      },
    ]) {
      try {
        await window.electronAPI[transition.method]({
          id: transition.id,
          expectedRevision: transition.expectedRevision,
          decision: transition.decision,
        });
        guardedTransitions.push({ method: transition.method, id: transition.id, rejected: false });
      } catch (error) {
        guardedTransitions.push({
          method: transition.method,
          id: transition.id,
          rejected: true,
          message: String(error?.message || error),
        });
      }
    }
    const compact = (rows) => rows.map((item) => ({ id: item.id, revision: item.revision }));
    return {
      finalStatuses: {
        pending: compact(pending),
        needs_review: compact(needsReview),
        approved: compact(approved),
        rejected: compact(rejected),
      },
      guardedTransitions,
    };
  });
  evidence.decisionStateContract = decisionStateContract;
  const expectedApprovedState = JSON.stringify([{ id: 101, revision: 1 }]);
  const expectedRejectedState = JSON.stringify([{ id: 102, revision: 1 }]);
  if (decisionStateContract.finalStatuses.pending.length
    || decisionStateContract.finalStatuses.needs_review.length
    || JSON.stringify(decisionStateContract.finalStatuses.approved) !== expectedApprovedState
    || JSON.stringify(decisionStateContract.finalStatuses.rejected) !== expectedRejectedState
    || decisionStateContract.guardedTransitions.some((transition) => !transition.rejected)) {
    fail('Recommendation decision state contract did not stay authoritative', JSON.stringify(decisionStateContract));
  }

  await navigateBusinessPage(page, NAV_RE.readback, 'readback');
  await expectVisible(page, '选择已批准动作');
  await expectVisible(page, '填写审批凭证');
  await expectVisible(page, '记录执行和回读');
  await expectVisible(page, '校验并导出证据');
  await page.getByRole('button', { name: '查看安全门', exact: true }).click();
  await expectVisible(page, '安全门与当前缺口');
  await expectVisible(page, '人工执行：本页只收集审批、截图、前后值和回读证据，不自动写 Amazon Ads。');
  await expectVisible(page, '截图不复用：审批、执行前、执行后和回读截图必须来自不同证据。');
  await expectVisible(page, '时间可追溯：审批、执行前、执行动作、执行后和回读时间必须可排序。');
  await expectVisible(page, '回读值一致');
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await expectVisible(page, '广告组合');
  await expectVisible(page, 'ASIN');
  await expectVisible(page, '对象类型');
  await expectVisible(page, 'D6 Portfolio');
  await expectVisible(page, 'B0TESTASIN');
  await expectVisible(page, 'target');
  await expectNotInBody(page, 'pnpm run verify:ad-readback');
  await expectNotInBody(page, 'create:ad-readback-template');
  await page.getByRole('button', { name: '载入' }).first().click();
  await clickReadbackStep(page, '1. 选择已批准动作');
  await expectVisible(page, '来源批次');
  await expectVisible(page, '指标日期');
  await expectVisible(page, '来源行号');
  await expectVisible(page, '当前有效批次：manual_ad_execution_batch');
  await expectVisible(page, '来源批次匹配');
  await expectVisible(page, '来源批次、指标日期、来源行号、来源文件、来源当前值和建议值是回读证据的一部分；缺失或串批次时只能导出缺口草稿。');
  await openReadbackSourceEditor(page);
  await expectVisible(page, '产品阶段');
  await expectVisible(page, 'keyword_exploration');
  await expectVisible(page, 'AI 与规则关系');
  await expectVisible(page, '规则+AI 一致 / 规则+AI 合并');
  await expectVisible(page, '量化阈值');
  await expectVisible(page, 'ACOS 25.0% / 高 ACOS 50.0%');
  await page.getByRole('textbox', { name: '来源批次', exact: true }).evaluate((node) => {
    if (node.value !== 'manual_ad_execution_batch') throw new Error(`Unexpected source batch: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '指标日期', exact: true }).evaluate((node) => {
    if (node.value !== '2026-06-12') throw new Error(`Unexpected metric date: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '来源行号', exact: true }).evaluate((node) => {
    if (node.value !== '12') throw new Error(`Unexpected source row: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '推荐来源文件', exact: true }).evaluate((node) => {
    if (!node.value.includes('C:/reports/source_user_search_term.xlsx')) throw new Error(`Unexpected source files: ${node.value}`);
  });
  await closeReadbackSourceEditor(page);
  await clickReadbackStep(page, '2. 填写审批凭证');
  await page.getByRole('textbox', { name: '审批人', exact: true }).evaluate((node) => {
    if (node.value !== 'QA Approver') throw new Error(`Unexpected carried approver: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '审批备注', exact: true }).evaluate((node) => {
    if (node.value !== 'Approved for smoke scope only.') throw new Error(`Unexpected carried approval note: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '审批时间', exact: true }).evaluate((node) => {
    if (!String(node.value || '').includes('T')) throw new Error(`Approval time was not carried into readback: ${node.value}`);
  });
  await clickReadbackStep(page, '1. 选择已批准动作');
  await openReadbackSourceEditor(page);
  await page.getByRole('textbox', { name: '来源批次', exact: true }).fill('stale_ad_execution_batch');
  await closeReadbackSourceEditor(page);
  await expectVisible(page, '来源批次不一致');
  await clickReadbackStep(page, '4. 校验并导出证据');
  await expectVisible(page, '来源批次必须等于当前批次');
  await expectVisible(page, '导出缺口草稿');
  await clickReadbackStep(page, '1. 选择已批准动作');
  await openReadbackSourceEditor(page);
  await page.getByRole('textbox', { name: '来源批次', exact: true }).fill('manual_ad_execution_batch');
  await closeReadbackSourceEditor(page);
  await clickReadbackStep(page, '1. 选择已批准动作');
  await expectVisible(page, '来源批次匹配');
  await clickReadbackStep(page, '2. 填写审批凭证');
  await page.getByRole('textbox', { name: '审批人', exact: true }).fill('QA Approver');
  await page.getByRole('textbox', { name: '审批凭证', exact: true }).fill('C:/evidence/approval.png');
  await page.getByRole('textbox', { name: '审批时间', exact: true }).fill('2026-06-12T10:00:00.000Z');
  for (const label of ['审批人确认范围', '外部审批允许', '低风险策略允许']) {
    await page.getByLabel(label).check();
  }
  await clickReadbackStep(page, '3. 记录执行和回读');
  await page.getByRole('textbox', { name: '执行人', exact: true }).fill('QA Operator');
  await page.getByRole('textbox', { name: '执行编号', exact: true }).fill('manual-smoke-001');
  await page.getByRole('textbox', { name: '执行时间', exact: true }).fill('2026-06-12T10:05:00.000Z');
  await page.getByRole('textbox', { name: '执行前值', exact: true }).fill('1.20');
  await page.getByRole('textbox', { name: '执行前截图', exact: true }).fill('C:/evidence/before.png');
  await page.getByRole('textbox', { name: '执行前时间', exact: true }).fill('2026-06-12T10:03:00.000Z');
  await page.getByRole('textbox', { name: '执行后值', exact: true }).fill('1.08');
  await page.getByRole('textbox', { name: '执行后截图', exact: true }).fill('C:/evidence/after.png');
  await page.getByRole('textbox', { name: '执行后时间', exact: true }).fill('2026-06-12T10:06:00.000Z');
  await page.getByRole('textbox', { name: '回读值', exact: true }).fill('1.08');
  await page.getByRole('textbox', { name: '回读证据', exact: true }).fill('C:/evidence/readback.png');
  await page.getByRole('textbox', { name: '回读时间', exact: true }).fill('2026-06-12T10:10:00.000Z');
  await page.getByRole('textbox', { name: '现场行证明', exact: true }).fill('广告后台行已刷新，目标出价保持在 1.08。');
  await clickReadbackStep(page, '4. 校验并导出证据');
  for (const label of ['执行成功确认', '执行已核验', '回读已核验']) {
    await page.getByLabel(label).check();
  }
  await expectVisible(page, '字段已填写，待导出校验');
  await expectVisible(page, '字段已填写时仍需导出证据文件和说明文件，并由后端校验截图、真实报表和回读证据文件是否存在。');
  await page.getByRole('button', { name: '导出回读证据' }).click();
  await page.getByText('导出结果和证据路径', { exact: true }).click();
  await page.getByText('导出状态', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('可进入最终验收', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('C:/evidence/readback.json', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('C:/evidence/readback.md', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('该导出只写入本地证据文件，不会提交 Amazon。', { exact: false }).waitFor({ timeout: 5000 });
  await page.getByText('回读工作包流程', { exact: true }).click();
  await expectVisible(page, '工作包状态：创建工作包后，按清单补审批、执行前、执行后和回读截图。');
  await page.getByText('工作包内要做什么', { exact: true }).click();
  await expectVisible(page, '工作包目录：C:/evidence/readback-session');
  await expectVisible(page, '填写现场信息后生成可进入最终验收的回读证据。');
  await expectVisible(page, '检查工作包只证明目录和文件结构安全，不等于最终验收通过；最终仍以生成后的回读证据校验和最终验收汇总为准。');
  await expectVisible(page, '创建回读工作包');
  await page.getByRole('button', { name: '创建回读工作包', exact: true }).click();
  await page.getByText('回读工作包已创建。', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText('查看工作包路径', { exact: true }).click();
  await expectVisible(page, '工作包目录');
  await expectVisible(page, 'C:/evidence/readback-session/session-input.json');
  await expectVisible(page, 'C:/evidence/readback-session/session-input-guide.md');
  await expectVisible(page, 'C:/evidence/readback-session/operator-checklist.md');
  await expectVisible(page, 'C:/evidence/readback-session/real-ad-execution-readback-pass.json');
  await expectVisible(page, '检查工作包');
  await page.getByRole('button', { name: '打开填写文件', exact: true }).click();
  await page.getByRole('button', { name: '打开填写说明', exact: true }).click();
  await page.getByRole('button', { name: '检查工作包', exact: true }).click();
  await page.getByText('工作包结构检查通过，现场证据仍待填写。', { exact: true }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, '工作包结构通过，现场证据待填写');
  await expectVisible(page, '还需填写：审批/审批人、执行前/现场出价、执行后/现场出价、回读/刷新回读截图文件');
  await expectVisible(page, '检查工作包只证明目录和文件结构安全；还必须填写现场信息并生成最终证据后，才可能进入最终验收。');
  await expectVisible(page, '生成回读证据');
  await page.getByRole('button', { name: '生成回读证据', exact: true }).click();
  await page.getByText('回读证据已生成，等待最终校验。', { exact: true }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, '回读证据已生成，待最终校验');
  await expectInBody(page, '最终可交付仍必须通过本地回读证据校验和最终验收汇总。');
  await expectVisible(page, 'C:/evidence/readback-session/real-ad-execution-readback-pass.json');
  await expectVisible(page, '校验回读证据');
  await page.getByRole('button', { name: '校验回读证据', exact: true }).click();
  await page.getByText('回读证据校验通过。', { exact: true }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, '回读证据校验已通过');
  await expectVisible(page, '这份证据已通过本地回读证据校验；最终可交付仍需进入最终验收汇总。');
  await page.getByText('命令备用入口和技术验收说明', { exact: true }).click();
  await expectVisible(page, '复制创建工作包命令');
  await expectVisible(page, '复制检查工作包命令');
  await expectVisible(page, '复制生成回读证据命令');
  await expectVisible(page, '复制长参数生成命令');
  await expectNotInBody(page, 'pnpm run verify:ad-readback');
  const afterExportScreenshotPath = path.join(evidenceDir, `business-ui-ad-execution-readback-after-export-${runId}.png`);
  await page.screenshot({ path: afterExportScreenshotPath, fullPage: false });
  evidence.pages.readbackAfterExport = {
    label: '结果核对导出结果',
    screenshotPath: afterExportScreenshotPath,
    viewport: page.viewportSize(),
    bodyTextSample: (await bodyText(page)).slice(0, 1800),
  };
  await clickReadbackStep(page, '3. 记录执行和回读');
  await page.getByRole('textbox', { name: '执行后值', exact: true }).fill('');
  await page.getByRole('textbox', { name: '执行后值', exact: true }).fill('1.07');
  await page.waitForTimeout(50);
  await page.getByRole('textbox', { name: '回读值', exact: true }).fill('1.07');
  await page.getByRole('textbox', { name: '回读值', exact: true }).evaluate((node) => {
    if (node.value !== '1.07') throw new Error(`Readback value was not editable after after-value change: ${node.value}`);
  });
  await expectNotInBody(page, 'C:/evidence/readback.json');
  await expectNotInBody(page, 'C:/evidence/readback.md');

  const actionLog = await page.evaluate(() => window.__businessUiActionLog || []);
  evidence.actionLog = actionLog;
  const pendingRecommendationCalls = actionLog.filter((item) => item.type === 'getRecommendations' && item.filter?.status === 'pending');
  const reviewRecommendationCalls = actionLog.filter((item) => item.type === 'getRecommendations' && item.filter?.status === 'needs_review');
  if (!pendingRecommendationCalls.length) {
    fail('Pending recommendations IPC mock was not called', JSON.stringify(actionLog));
  }
  if (!reviewRecommendationCalls.length) {
    fail('Needs-review recommendations IPC mock was not called', JSON.stringify(actionLog));
  }
  if (!actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/evidence/readback-session/session-input.json')) {
    fail('Open readback session input did not call openReportPath', JSON.stringify(actionLog));
  }
  if (!actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/evidence/readback-session/session-input-guide.md')) {
    fail('Open readback session input guide did not call openReportPath', JSON.stringify(actionLog));
  }
  const scopedPendingRecommendationCalls = pendingRecommendationCalls.filter((call) => call.filter?.batchId === 'manual_ad_execution_batch');
  const scopedReviewRecommendationCalls = reviewRecommendationCalls.filter((call) => call.filter?.batchId === 'manual_ad_execution_batch');
  if (!scopedPendingRecommendationCalls.length) {
    fail('No pending recommendations IPC call used the manual execution batch scope', JSON.stringify(pendingRecommendationCalls));
  }
  if (!scopedReviewRecommendationCalls.length) {
    fail('No needs-review recommendations IPC call used the manual execution batch scope', JSON.stringify(reviewRecommendationCalls));
  }
  for (const call of scopedPendingRecommendationCalls) assertScopeParams(call.filter, 'getRecommendations');
  for (const call of scopedReviewRecommendationCalls) assertScopeParams(call.filter, 'getRecommendations needs_review');
  const approvalCall = actionLog.find((item) => item.type === 'approveRecommendation');
  if (!approvalCall) {
    fail('Approval IPC mock was not called', JSON.stringify(actionLog));
  }
  if (approvalCall.input?.id !== 101
    || approvalCall.input?.expectedRevision !== 0
    || approvalCall.input?.decision?.approvedBy !== 'QA Approver'
    || approvalCall.input?.decision?.note !== 'Approved for smoke scope only.'
    || approvalCall.input?.decision?.batchId !== 'manual_ad_execution_batch'
    || approvalCall.input?.decision?.sourceBatchId !== 'manual_ad_execution_batch'
    || approvalCall.input?.decision?.metricDate !== '2026-06-12'
    || approvalCall.input?.decision?.sourceRow !== 12
    || approvalCall.input?.decision?.portfolioName !== 'D6 Portfolio'
    || approvalCall.input?.decision?.campaignName !== 'D6-auto-test'
    || approvalCall.input?.decision?.adGroupName !== 'D6-ad-group'
    || approvalCall.input?.decision?.asin !== 'B0TESTASIN'
    || approvalCall.input?.decision?.entityType !== 'target'
    || approvalCall.input?.decision?.entityName !== 'tight match target'
    || approvalCall.input?.decision?.actionType !== 'lower_bid'
    || approvalCall.input?.decision?.explanationSource !== 'ai'
    || approvalCall.input?.decision?.aiModel !== 'deepseek-chat'
    || approvalCall.input?.decision?.aiStrategySource !== 'ai'
    || approvalCall.input?.decision?.decisionAgreement !== 'aligned'
    || !approvalCall.input?.decision?.decisionReasons?.includes('AI：Coupon 未带来足够转化。')
    || approvalCall.input?.decision?.aiThresholdSuggestions?.targetAcos?.value !== 0.35
    || approvalCall.input?.decision?.productStage !== 'keyword_exploration'
    || approvalCall.input?.decision?.productTargetAcos !== 0.35
    || approvalCall.input?.decision?.productTargetTacos !== 0.12
    || approvalCall.input?.decision?.productTargetNetMargin !== 0.22
    || approvalCall.input?.decision?.productMinPrice !== 29.99
    || approvalCall.input?.decision?.scope?.storeName !== 'FT-US-US') {
    fail('Approval IPC did not include approval metadata', JSON.stringify(approvalCall.input));
  }
  const rejectCall = actionLog.find((item) => item.type === 'rejectRecommendation');
  if (!rejectCall) {
    fail('Reject IPC mock was not called after audited reject', JSON.stringify(actionLog));
  }
  if (rejectCall.input?.id !== 102
    || rejectCall.input?.expectedRevision !== 0
    || rejectCall.input?.decision?.rejectedBy !== 'QA Rejector'
    || rejectCall.input?.decision?.note !== 'Rejected during smoke audit.'
    || rejectCall.input?.decision?.batchId !== 'manual_ad_execution_batch') {
    fail('Reject IPC did not include rejection metadata', JSON.stringify(rejectCall.input));
  }
  const readbackExport = actionLog.find((item) => item.type === 'exportAdReadbackEvidence');
  if (!readbackExport) {
    fail('Readback export IPC mock was not called', JSON.stringify(actionLog));
  }
  const readbackSession = actionLog.find((item) => item.type === 'prepareAdReadbackSession');
  if (!readbackSession || readbackSession.input?.sourcePath !== 'C:/evidence/readback.json') {
    fail('Readback session IPC mock was not called with exported JSON path', JSON.stringify(actionLog));
  }
  const readbackSessionVerify = actionLog.find((item) => item.type === 'verifyAdReadbackSession');
  if (!readbackSessionVerify || readbackSessionVerify.input?.sessionDir !== 'C:/evidence/readback-session') {
    fail('Readback session verify IPC mock was not called with session directory', JSON.stringify(actionLog));
  }
  const readbackSessionFill = actionLog.find((item) => item.type === 'fillAdReadbackSession');
  if (!readbackSessionFill || readbackSessionFill.input?.sessionDir !== 'C:/evidence/readback-session') {
    fail('Readback session fill IPC mock was not called with session directory', JSON.stringify(actionLog));
  }
  const readbackEvidenceVerify = actionLog.find((item) => item.type === 'verifyAdReadbackEvidence');
  if (!readbackEvidenceVerify || readbackEvidenceVerify.input?.evidencePath !== 'C:/evidence/readback-session/real-ad-execution-readback-pass.json') {
    fail('Readback evidence verification IPC mock was not called with pass evidence path', JSON.stringify(actionLog));
  }
  if (readbackExport.input?.source?.batchId !== 'manual_ad_execution_batch'
    || readbackExport.input?.source?.metricDate !== '2026-06-12'
    || readbackExport.input?.source?.sourceRow !== 12
    || readbackExport.input?.source?.entityType !== 'target'
    || readbackExport.input?.source?.aiModel !== 'deepseek-chat'
    || readbackExport.input?.source?.decisionAgreement !== 'aligned'
    || readbackExport.input?.source?.decisionSource !== 'rule_ai'
    || !readbackExport.input?.source?.decisionReasons?.includes('AI：Coupon 未带来足够转化。')
    || readbackExport.input?.source?.aiStrategySource !== 'ai'
    || readbackExport.input?.source?.aiLifecycleStage !== 'keyword_exploration'
    || readbackExport.input?.source?.aiThresholdSuggestions?.targetAcos?.value !== 0.35
    || readbackExport.input?.source?.quantThresholds?.targetAcos !== 0.25
    || readbackExport.input?.source?.productStage !== 'keyword_exploration'
    || readbackExport.input?.source?.productTargetAcos !== 0.35
    || readbackExport.input?.source?.productTargetTacos !== 0.12
    || readbackExport.input?.source?.productTargetNetMargin !== 0.22
    || readbackExport.input?.source?.productMinPrice !== 29.99
    || readbackExport.input?.target?.portfolioName !== 'D6 Portfolio'
    || readbackExport.input?.target?.asin !== 'B0TESTASIN'
    || readbackExport.input?.target?.entityType !== 'target'
    || readbackExport.input?.approval?.note !== 'Approved for smoke scope only.'
    || readbackExport.input?.approval?.confirmedAt !== '2026-06-12T10:00:00.000Z'
    || readbackExport.input?.execution?.executedBy !== 'QA Operator'
    || readbackExport.input?.execution?.executionId !== 'manual-smoke-001'
    || readbackExport.input?.execution?.executedAt !== '2026-06-12T10:05:00.000Z'
    || readbackExport.input?.before?.capturedAt !== '2026-06-12T10:03:00.000Z'
    || readbackExport.input?.after?.capturedAt !== '2026-06-12T10:06:00.000Z'
    || readbackExport.input?.readback?.readAt !== '2026-06-12T10:10:00.000Z'
    || !Array.isArray(readbackExport.input?.source?.sourceFiles)
    || !readbackExport.input.source.sourceFiles.includes('C:/reports/source_user_search_term.xlsx')) {
    fail('Readback export did not include full source, execution, and readback binding', JSON.stringify(readbackExport.input));
  }

    if (evidence.consoleErrors.length > 0) {
      fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
    }
    if (evidence.pageErrors.length > 0) {
      fail('Renderer emitted uncaught page errors', evidence.pageErrors.join('\n'));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }

  const evidencePath = path.join(evidenceDir, `business-ui-ad-execution-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] business UI ad execution smoke evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
