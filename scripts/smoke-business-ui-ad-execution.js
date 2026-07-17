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
      resolve({ url: `http://127.0.0.1:${address.port}/index.html?smoke=ad-execution-authoritative`, close: () => server.close() });
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

async function pasteReadbackCapture(page, slot, fileName) {
  const target = page.locator(`[data-capture-slot="${slot}"]`);
  await target.waitFor({ state: 'visible', timeout: 5000 });
  const priorCount = await page.evaluate((expectedSlot) => (window.__businessUiActionLog || [])
    .filter((item) => item.type === 'saveReadbackCapture' && item.input?.slot === expectedSlot).length, slot);
  await target.evaluate((node, input) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File(['smoke-capture'], input.fileName, { type: 'image/png' }));
    node.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, { fileName });
  await page.waitForFunction(({ expectedSlot, expectedCount }) => (window.__businessUiActionLog || [])
    .filter((item) => item.type === 'saveReadbackCapture' && item.input?.slot === expectedSlot).length > expectedCount, {
    expectedSlot: slot,
    expectedCount: priorCount,
  }, { timeout: 5000 });
  await target.getByText(/已安全固定/, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
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

function assertPassReadbackBranch(actionLog, startIndex) {
  const branch = actionLog.slice(startIndex);
  const exports = branch.filter((item) => item.type === 'exportAdReadbackEvidence');
  const verifications = branch.filter((item) => item.type === 'verifyAdReadbackEvidence');
  const workPackageActions = branch.filter((item) => [
    'prepareAdReadbackSession',
    'verifyAdReadbackSession',
    'fillAdReadbackSession',
  ].includes(item.type));
  if (exports.length !== 1
    || exports[0].result?.status !== 'PASS'
    || exports[0].result?.readyForVerifier !== true
    || exports[0].result?.nextAction !== 'verify') {
    fail('PASS readback branch did not publish the strict direct-verify export result', JSON.stringify(branch));
  }
  if (verifications.length !== 1
    || verifications[0].input?.evidencePath !== exports[0].result?.jsonPath
    || verifications[0].result?.status !== 'PASS'
    || verifications[0].result?.ready !== true) {
    fail('PASS readback branch did not directly verify the exported evidence', JSON.stringify(branch));
  }
  if (workPackageActions.length > 0) {
    fail('PASS readback branch used a work-package action', JSON.stringify(workPackageActions));
  }
  if (branch.indexOf(verifications[0]) < branch.indexOf(exports[0])) {
    fail('PASS readback branch verified before export completed', JSON.stringify(branch));
  }
  return {
    exportCount: exports.length,
    verifyCount: verifications.length,
    prepareCount: 0,
    checkCount: 0,
    fillCount: 0,
    exportPath: exports[0].result.jsonPath,
  };
}

function assertNeedsWorkReadbackBranch(actionLog, startIndex) {
  const branch = actionLog.slice(startIndex);
  const relevant = branch.filter((item) => [
    'exportAdReadbackEvidence',
    'prepareAdReadbackSession',
    'verifyAdReadbackSession',
    'fillAdReadbackSession',
    'verifyAdReadbackEvidence',
  ].includes(item.type));
  const expectedOrder = [
    'exportAdReadbackEvidence',
    'prepareAdReadbackSession',
    'verifyAdReadbackSession',
    'fillAdReadbackSession',
    'verifyAdReadbackEvidence',
  ];
  if (JSON.stringify(relevant.map((item) => item.type)) !== JSON.stringify(expectedOrder)) {
    fail('NEEDS_WORK readback branch did not preserve strict action order', JSON.stringify(relevant));
  }
  const [exportCall, prepareCall, checkCall, fillCall, verifyCall] = relevant;
  if (exportCall.result?.status !== 'NEEDS_WORK'
    || exportCall.result?.readyForVerifier !== false
    || exportCall.result?.nextAction !== 'prepare') {
    fail('NEEDS_WORK readback branch did not publish the strict prepare result', JSON.stringify(exportCall));
  }
  if (prepareCall.input?.sourcePath !== exportCall.result?.jsonPath
    || !prepareCall.result?.sessionDir
    || checkCall.input?.sessionDir !== prepareCall.result.sessionDir
    || fillCall.input?.sessionDir !== prepareCall.result.sessionDir
    || verifyCall.input?.evidencePath !== fillCall.result?.jsonPath
    || verifyCall.result?.status !== 'PASS'
    || verifyCall.result?.ready !== true) {
    fail('NEEDS_WORK readback branch did not carry authoritative paths through the work package', JSON.stringify(relevant));
  }
  return {
    exportCount: 1,
    prepareCount: 1,
    checkCount: 1,
    fillCount: 1,
    verifyCount: 1,
    sourcePath: exportCall.result.jsonPath,
    finalEvidencePath: fillCall.result.jsonPath,
  };
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
        writableTarget: {
          entityType: 'auto_targeting',
          entityId: 'amzn-auto-target-opaque-101',
          entityName: 'tight match target',
          campaignName: 'D6-auto-test',
          adGroupName: 'D6-ad-group',
          metricDate: '2026-06-12',
          sourceFile: 'C:/reports/auto_targeting.xlsx',
          sourceRow: 12,
          identitySource: 'ads_ui',
          verifiedBy: 'Smoke Operator',
          verifiedAt: '2026-06-12T10:05:00.000Z',
          verificationNote: 'Smoke fixture: matched the authenticated Ads UI target row.',
          identityProofPath: 'C:/evidence/auto-target-101.png',
        },
        batchId: 'batch_mock_ready',
        reportType: 'auto_targeting',
        sourceFile: 'C:/reports/auto_targeting.xlsx',
        sourceFiles: ['C:/reports/auto_targeting.xlsx'],
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
    const unboundRecommendationEvidence = {
      ...recommendationBase.evidence,
      batchId: 'manual_ad_execution_batch',
      targeting: 'unbound smoke target',
      aiLifecycleStageEvidenceRefs: (recommendationBase.evidence.aiLifecycleStageEvidenceRefs || [])
        .map((reference) => String(reference).replace(/batch_mock_ready/g, 'manual_ad_execution_batch')),
      aiLifecycleStageEvidenceDetails: (recommendationBase.evidence.aiLifecycleStageEvidenceDetails || [])
        .map((detail) => detail.type === 'metric' ? {
          ...detail,
          evidenceId: String(detail.evidenceId || '').replace(/batch_mock_ready/g, 'manual_ad_execution_batch'),
          label: 'unbound smoke target / 2026-06-12',
          batchId: 'manual_ad_execution_batch',
          entityName: 'unbound smoke target',
        } : { ...detail }),
      aiEvidenceRefs: (recommendationBase.evidence.aiEvidenceRefs || [])
        .map((reference) => String(reference).replace(/batch_mock_ready/g, 'manual_ad_execution_batch')),
      aiEvidenceDetails: (recommendationBase.evidence.aiEvidenceDetails || [])
        .map((detail) => detail.type === 'metric' ? {
          ...detail,
          evidenceId: String(detail.evidenceId || '').replace(/batch_mock_ready/g, 'manual_ad_execution_batch'),
          label: 'unbound smoke target / 2026-06-12',
          batchId: 'manual_ad_execution_batch',
          entityName: 'unbound smoke target',
        } : { ...detail }),
      aiReasoningSteps: (recommendationBase.evidence.aiReasoningSteps || [])
        .map((step) => String(step).replace(/tight match target/g, 'unbound smoke target')),
    };
    delete unboundRecommendationEvidence.writableTarget;
    delete unboundRecommendationEvidence.writableTargetBinding;
    const unboundRecommendation = {
      ...recommendationBase,
      id: 105,
      entityName: 'unbound smoke target',
      revision: 0,
      status: 'pending',
      evidence: unboundRecommendationEvidence,
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
      [unboundRecommendation.id, { ...unboundRecommendation, evidence: { ...unboundRecommendation.evidence } }],
    ]);
    const assertRendererReadbackExportRequest = (input) => {
      const allowedKeys = ['expectedRevision', 'operatorEvidence', 'recommendationId', 'scope'];
      const inputKeys = Object.keys(input || {}).sort();
      if (JSON.stringify(inputKeys) !== JSON.stringify(allowedKeys)) {
        throw new Error(`Renderer submitted non-authoritative readback export fields: ${inputKeys.join(', ')}`);
      }
      if (input.recommendationId !== 101 || input.expectedRevision !== 1) {
        throw new Error(`Readback export did not bind approved recommendation #101 revision 1: ${JSON.stringify(input)}`);
      }
      const expectedScope = {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B0TESTASIN',
        batchId: 'manual_ad_execution_batch',
      };
      for (const [key, value] of Object.entries(expectedScope)) {
        if (input.scope?.[key] !== value) {
          throw new Error(`Readback export scope mismatch for ${key}: ${JSON.stringify(input.scope)}`);
        }
      }
      if (!input.operatorEvidence || typeof input.operatorEvidence !== 'object') {
        throw new Error('Readback export omitted operatorEvidence');
      }
    };
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
    window.__mockUnboundRecommendation = false;
    window.__mockAiConfigured = true;
    window.__mockBlockedPipeline = false;
    window.__mockDecisionDelayMs = 0;
    window.__mockRecommendationReadDelayMs = 0;
    window.__forceReadbackNeedsWork = false;
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
          .filter((recommendation) => (
            recommendation.status === filter?.status
              && (recommendation.id !== unboundRecommendation.id || window.__mockUnboundRecommendation)
          ))
          .map((recommendation) => ({
            ...recommendation,
            evidence: {
              ...recommendation.evidence,
              batchId: recommendation.id === unboundRecommendation.id
                ? recommendation.evidence.batchId
                : (filter?.batchId || recommendation.evidence.batchId),
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
      bindRecommendationWritableTarget: async (input) => {
        const recommendation = recommendationState.get(input?.recommendationId);
        if (!recommendation || recommendation.status !== 'pending') {
          throw new Error(`Illegal recommendation target-binding transition: ${recommendation?.status || 'missing'} -> pending`);
        }
        if (!Number.isInteger(input?.expectedRevision) || input.expectedRevision !== recommendation.revision) {
          throw new Error('Ads 对象核验状态冲突：建议内容已更新，请刷新后重试。');
        }
        if (recommendation.evidence?.writableTarget || recommendation.evidence?.writableTargetBinding) {
          throw new Error('Ads 对象核验被阻断：当前建议已经存在 Ads 可写对象或绑定审计。');
        }
        const rawTarget = input?.binding?.writableTarget || {};
        const expectedScope = {
          dateFrom: '2026-06-01',
          dateTo: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: recommendation.evidence?.asin,
          batchId: recommendation.evidence?.batchId,
        };
        if (recommendation.id !== unboundRecommendation.id
          || recommendation.evidence?.batchId !== 'manual_ad_execution_batch'
          || recommendation.evidence?.asin !== 'B0TESTASIN'
          || recommendation.evidence?.targeting !== 'unbound smoke target'
          || recommendation.evidence?.date !== '2026-06-12'
          || recommendation.evidence?.reportType !== 'auto_targeting'
          || recommendation.evidence?.sourceFile !== 'C:/reports/auto_targeting.xlsx'
          || JSON.stringify(recommendation.evidence).includes('batch_mock_ready')) {
          throw new Error(`Target-binding request escaped the isolated fixture authority: ${JSON.stringify(recommendation)}`);
        }
        for (const [key, value] of Object.entries(expectedScope)) {
          if (input?.scope?.[key] !== value) {
            throw new Error(`Target-binding fixture scope mismatch for ${key}: ${JSON.stringify(input?.scope)}`);
          }
        }
        const fixtureMetricSourceFiles = [...(recommendation.evidence?.sourceFiles || [])];
        const knownReportFiles = new Map(fullReportFiles.map((report) => [
          String(report.filePath || '').replace(/\\/g, '/').toLowerCase(),
          report.reportType,
        ]));
        if (fixtureMetricSourceFiles.length !== 1
          || fixtureMetricSourceFiles[0] !== 'C:/reports/auto_targeting.xlsx'
          || !fixtureMetricSourceFiles.every((filePath) => knownReportFiles.has(String(filePath).replace(/\\/g, '/').toLowerCase()))
          || recommendation.evidence?.sourceRow !== 12) {
          throw new Error(`Target-binding fixture metric source is not authoritative: ${JSON.stringify({
            batchId: recommendation.evidence?.batchId,
            sourceFiles: fixtureMetricSourceFiles,
            sourceRow: recommendation.evidence?.sourceRow,
          })}`);
        }
        const normalizedTargetSourceFile = String(rawTarget.sourceFile || '').replace(/\\/g, '/').toLowerCase();
        if (input?.binding?.boundBy !== 'Smoke Binder'
          || input?.binding?.note !== 'Smoke fixture verified the unique Ads target and keeps the recommendation pending.'
          || rawTarget.entityType !== 'auto_targeting'
          || rawTarget.entityId !== 'amzn-auto-target-unbound-105'
          || knownReportFiles.get(normalizedTargetSourceFile) !== rawTarget.entityType
          || rawTarget.sourceRow !== recommendation.evidence?.sourceRow
          || rawTarget.identitySource !== 'ads_ui'
          || rawTarget.identityProofPath !== 'C:/evidence/unbound-target-105.png'
          || rawTarget.verificationNote !== 'Matched campaign, ad group, target name, and immutable Ads object ID.') {
          throw new Error(`Target-binding fixture writable identity mismatch: ${JSON.stringify(input?.binding)}`);
        }
        const actionEntry = {
          type: 'bindRecommendationWritableTarget',
          input,
          fixtureAuthority: {
            recommendationId: recommendation.id,
            status: recommendation.status,
            revision: recommendation.revision,
            batchId: recommendation.evidence?.batchId,
            asin: recommendation.evidence?.asin,
            reportType: recommendation.evidence?.reportType,
            sourceFile: recommendation.evidence?.sourceFile,
            sourceFiles: fixtureMetricSourceFiles,
            sourceRow: recommendation.evidence?.sourceRow,
          },
        };
        window.__businessUiActionLog.push(actionEntry);
        const boundAt = '2026-07-16T05:30:00.000Z';
        const writableTarget = {
          entityType: rawTarget.entityType,
          entityId: rawTarget.entityId,
          entityName: recommendation.evidence?.targeting || recommendation.entityName,
          campaignName: recommendation.evidence?.campaignName,
          adGroupName: recommendation.evidence?.adGroupName,
          metricDate: recommendation.evidence?.date,
          sourceFile: rawTarget.sourceFile,
          sourceRow: rawTarget.sourceRow,
          identitySource: rawTarget.identitySource,
          verifiedBy: input?.binding?.boundBy,
          verifiedAt: boundAt,
          verificationNote: rawTarget.verificationNote,
          identityProofPath: rawTarget.identityProofPath,
        };
        const fromRevision = recommendation.revision;
        const boundRevision = fromRevision + 1;
        const writableTargetBinding = {
          schemaVersion: 1,
          fromRevision,
          boundRevision,
          boundBy: input?.binding?.boundBy,
          boundAt,
          note: input?.binding?.note,
          scope: { ...input.scope },
          metricSource: {
            batchId: recommendation.evidence?.batchId,
            sourceFiles: [...(recommendation.evidence?.sourceFiles || [])],
            sourceRow: recommendation.evidence?.sourceRow,
          },
          writableTarget,
        };
        const persistedRecommendation = {
          ...recommendation,
          revision: boundRevision,
          evidence: {
            ...recommendation.evidence,
            writableTarget,
            writableTargetBinding,
          },
        };
        recommendationState.set(input.recommendationId, persistedRecommendation);
        const result = {
          ok: true,
          recommendationId: input.recommendationId,
          status: 'pending',
          revision: boundRevision,
          boundAt,
        };
        actionEntry.result = result;
        actionEntry.persisted = {
          recommendationId: persistedRecommendation.id,
          status: persistedRecommendation.status,
          revision: persistedRecommendation.revision,
          evidence: {
            batchId: persistedRecommendation.evidence?.batchId,
            asin: persistedRecommendation.evidence?.asin,
            reportType: persistedRecommendation.evidence?.reportType,
            sourceFile: persistedRecommendation.evidence?.sourceFile,
            sourceFiles: [...(persistedRecommendation.evidence?.sourceFiles || [])],
            sourceRow: persistedRecommendation.evidence?.sourceRow,
            writableTarget: { ...persistedRecommendation.evidence?.writableTarget },
            writableTargetBinding: {
              ...persistedRecommendation.evidence?.writableTargetBinding,
              scope: { ...persistedRecommendation.evidence?.writableTargetBinding?.scope },
              metricSource: {
                ...persistedRecommendation.evidence?.writableTargetBinding?.metricSource,
                sourceFiles: [...(persistedRecommendation.evidence?.writableTargetBinding?.metricSource?.sourceFiles || [])],
              },
              writableTarget: { ...persistedRecommendation.evidence?.writableTargetBinding?.writableTarget },
            },
          },
        };
        return result;
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
        assertRendererReadbackExportRequest(input);
        const recommendation = recommendationState.get(input.recommendationId);
        if (!recommendation || recommendation.status !== 'approved' || recommendation.revision !== input.expectedRevision) {
          throw new Error('Readback export authority row is no longer approved at the expected revision');
        }
        const approvalDecision = recommendation.evidence?.approvalDecision;
        if (!approvalDecision
          || approvalDecision.batchId !== input.scope.batchId
          || approvalDecision.sourceBatchId !== input.scope.batchId
          || approvalDecision.asin !== input.scope.asin) {
          throw new Error('Readback export authority row no longer matches the current scope and batch');
        }
        const operatorEvidence = input.operatorEvidence || {};
        const readyForVerifier = !window.__forceReadbackNeedsWork && Boolean(
          operatorEvidence.approval?.operatorConfirmed
            && operatorEvidence.approval?.realWriteApproved
            && operatorEvidence.approval?.approvalArtifactPath
            && operatorEvidence.risk?.allowedByPolicy
            && operatorEvidence.execution?.executedBy
            && operatorEvidence.execution?.executionId
            && operatorEvidence.execution?.executedAt
            && operatorEvidence.before?.value
            && operatorEvidence.before?.capturedAt
            && operatorEvidence.before?.screenshotPath
            && operatorEvidence.after?.value
            && operatorEvidence.after?.capturedAt
            && operatorEvidence.after?.screenshotPath
            && operatorEvidence.readback?.readAt
            && operatorEvidence.readback?.evidencePath
            && operatorEvidence.readback?.actualValue === operatorEvidence.after?.value
            && operatorEvidence.execution?.success
            && operatorEvidence.execution?.verified
            && operatorEvidence.readback?.verified
        );
        const result = {
          jsonPath: readyForVerifier ? 'C:/evidence/readback-pass.json' : 'C:/evidence/readback-needs-work.json',
          markdownPath: readyForVerifier ? 'C:/evidence/readback-pass.md' : 'C:/evidence/readback-needs-work.md',
          sha256: readyForVerifier ? 'SMOKE_PASS_SHA256' : 'SMOKE_NEEDS_WORK_SHA256',
          status: readyForVerifier ? 'PASS' : 'NEEDS_WORK',
          readyForVerifier,
          nextAction: readyForVerifier ? 'verify' : 'prepare',
          authority: {
            recommendationId: recommendation.id,
            revision: recommendation.revision,
            batchId: approvalDecision.batchId,
          },
        };
        window.__businessUiActionLog.push({
          type: 'exportAdReadbackEvidence',
          input,
          result,
          authoritySource: {
            recommendationId: recommendation.id,
            revision: recommendation.revision,
            status: recommendation.status,
            target: {
              asin: recommendation.evidence?.asin,
              entityType: recommendation.entityType,
              entityName: recommendation.entityName,
            },
            source: {
              batchId: approvalDecision.sourceBatchId,
              metricDate: approvalDecision.metricDate,
              sourceRow: approvalDecision.sourceRow,
              sourceFiles: recommendation.evidence?.sourceFiles,
            },
            approval: approvalDecision,
            riskLevel: recommendation.riskLevel,
          },
        });
        return result;
      },
      prepareAdReadbackSession: async (input) => {
        const result = {
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
        window.__businessUiActionLog.push({ type: 'prepareAdReadbackSession', input, result });
        return result;
      },
      verifyAdReadbackSession: async (input) => {
        const result = {
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
        window.__businessUiActionLog.push({ type: 'verifyAdReadbackSession', input, result });
        return result;
      },
      fillAdReadbackSession: async (input) => {
        const result = {
          sessionDir: input?.sessionDir,
          jsonPath: 'C:/evidence/readback-session/real-ad-execution-readback-pass.json',
          markdownPath: 'C:/evidence/readback-session/real-ad-execution-readback-pass.md',
          status: 'PASS',
          readyForVerifier: true,
          issues: [],
        };
        window.__businessUiActionLog.push({ type: 'fillAdReadbackSession', input, result });
        return result;
      },
      saveReadbackCapture: async (input) => {
        const savedAtBySlot = {
          approval: '2026-06-12T10:00:00.000Z',
          before: '2026-06-12T10:03:00.000Z',
          after: '2026-06-12T10:06:00.000Z',
          readback: '2026-06-12T10:10:00.000Z',
        };
        if (!Object.prototype.hasOwnProperty.call(savedAtBySlot, input?.slot)
          || !String(input?.dataUrl || '').startsWith('data:image/png;base64,')) {
          throw new Error(`Invalid readback capture input: ${JSON.stringify(input)}`);
        }
        const result = {
          slot: input.slot,
          filePath: `C:/evidence/${input.slot}.png`,
          directory: 'C:/evidence',
          mimeType: 'image/png',
          byteLength: 13,
          savedAt: savedAtBySlot[input.slot],
        };
        window.__businessUiActionLog.push({ type: 'saveReadbackCapture', input, result });
        return result;
      },
      verifyAdReadbackEvidence: async (input) => {
        const result = {
          evidencePath: input?.evidencePath,
          ready: true,
          status: 'PASS',
          checks: [
            { label: '执行结果已成功、已核验，并限定为人工广告后台操作', passed: true },
            { label: 'source report traceability includes real spreadsheet file(s) and row number', passed: true },
          ],
          issues: [],
        };
        window.__businessUiActionLog.push({ type: 'verifyAdReadbackEvidence', input, result });
        return result;
      },
      openReportPath: async (targetPath) => {
        window.__businessUiActionLog.push({ type: 'openReportPath', targetPath });
        return { success: true };
      },
    };
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });
  await setManualScopeBatch(page, 'manual_ad_execution_batch');
  await page.getByRole('textbox', { name: 'ASIN', exact: true }).fill('B0TESTASIN');
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.locator('.scope-compact-trigger').click();
  await page.getByLabel('当前范围详情').getByText('批次', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('报表文件', { exact: true }).first().waitFor({ timeout: 5000 });
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
  const backwardFocusState = await drawer.evaluate((node) => {
    const focusable = Array.from(node.querySelectorAll(
      'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
      element.getClientRects().length > 0
      && !element.matches(':disabled, [aria-hidden="true"], [inert]')
    ));
    return {
      activeElement: document.activeElement?.tagName || null,
      activeText: String(document.activeElement?.textContent || '').trim(),
      focusable: focusable.map((element) => ({
        tagName: element.tagName,
        text: String(element.textContent || '').trim(),
      })),
      wrapped: focusable.length > 1
        && document.activeElement === focusable[focusable.length - 1]
        && node.contains(document.activeElement),
    };
  });
  const wrappedBackward = backwardFocusState.wrapped;
  if (!wrappedBackward) fail('Drawer Shift+Tab did not wrap focus to the last control', JSON.stringify(backwardFocusState));
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

  await page.setViewportSize({ width: 1200, height: 700 });
  await page.evaluate(() => {
    window.__mockUnboundRecommendation = true;
  });
  await navigateBusinessPage(page, NAV_RE.readback, 'readback');
  await navigateBusinessPage(page, NAV_RE.recommendations, 'recommendations');
  await waitForDecisionsSubview(page, 'recommendations');
  const unboundRow = decisionsRoot.locator('.priority-table tbody tr[aria-label]').filter({ hasText: 'unbound smoke target' });
  if (await unboundRow.count() !== 1) {
    fail('Target-binding fixture did not expose exactly one pending unbound row', String(await unboundRow.count()));
  }
  await unboundRow.focus();
  await unboundRow.press('Enter');
  const targetBindingDrawer = page.getByRole('dialog');
  await targetBindingDrawer.waitFor({ state: 'visible', timeout: 5000 });
  await targetBindingDrawer.getByRole('heading', { name: '核验 Ads 对象，保持待审批', exact: true }).waitFor({ timeout: 5000 });
  await targetBindingDrawer.getByText(
    '此步骤只绑定当前建议对应的唯一 Ads 可写对象并生成不可覆盖的审计记录；不会批准建议，也不会执行 Ads 动作。',
    { exact: true },
  ).waitFor({ timeout: 5000 });
  if (await targetBindingDrawer.getByRole('button', { name: '批准建议（不执行 Ads）', exact: true }).count()) {
    fail('Pending unbound recommendation exposed approval before Ads target verification');
  }
  const inspectorTaskActionIsolation = await decisionsRoot.evaluate((root) => {
    const actionGroup = root.querySelector('.task-banner__actions');
    const actionButtons = actionGroup?.querySelectorAll('button') ?? [];
    const actionGroupStyle = actionGroup ? window.getComputedStyle(actionGroup) : null;
    return {
      inspectorOpen: root.getAttribute('data-inspector-open') === 'true',
      actionGroupMounted: Boolean(actionGroup),
      actionButtonCount: actionButtons.length,
      actionGroupDisplay: actionGroupStyle?.display ?? null,
      actionGroupHasLayoutBox: actionGroup ? actionGroup.getClientRects().length > 0 : null,
      actionGroupContainsFocus: actionGroup ? actionGroup.contains(document.activeElement) : null,
    };
  });
  if (!inspectorTaskActionIsolation.inspectorOpen
    || !inspectorTaskActionIsolation.actionGroupMounted
    || inspectorTaskActionIsolation.actionButtonCount < 1
    || inspectorTaskActionIsolation.actionGroupDisplay !== 'none'
    || inspectorTaskActionIsolation.actionGroupHasLayoutBox !== false
    || inspectorTaskActionIsolation.actionGroupContainsFocus !== false) {
    fail(
      'Inspector-open state did not preserve the focus-return trigger as a hidden, non-competing task action',
      JSON.stringify(inspectorTaskActionIsolation),
    );
  }
  await targetBindingDrawer.getByRole('textbox', { name: '核验人', exact: true }).fill('Smoke Binder');
  await targetBindingDrawer.getByRole('textbox', { name: '对象绑定说明', exact: true }).fill('Smoke fixture verified the unique Ads target and keeps the recommendation pending.');
  await targetBindingDrawer.getByRole('combobox', { name: '可写对象类型', exact: true }).selectOption('auto_targeting');
  await targetBindingDrawer.getByRole('textbox', { name: 'Ads 对象 ID', exact: true }).fill('amzn-auto-target-unbound-105');
  await targetBindingDrawer.getByRole('combobox', { name: '来源文件', exact: true }).selectOption('C:/reports/auto_targeting.xlsx');
  await targetBindingDrawer.getByRole('spinbutton', { name: '唯一来源行', exact: true }).fill('12');
  await targetBindingDrawer.getByRole('combobox', { name: '身份核验来源', exact: true }).selectOption('ads_ui');
  await targetBindingDrawer.getByRole('textbox', { name: '身份核验证据路径', exact: true }).fill('C:/evidence/unbound-target-105.png');
  await targetBindingDrawer.getByRole('textbox', { name: '身份核验说明', exact: true }).fill('Matched campaign, ad group, target name, and immutable Ads object ID.');
  await targetBindingDrawer.getByRole('heading', { name: '核验 Ads 对象，保持待审批', exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    document.querySelector('[data-smoke-fixture-evidence-label]')?.remove();
    const label = document.createElement('div');
    label.setAttribute('data-smoke-fixture-evidence-label', 'true');
    label.setAttribute('role', 'note');
    label.textContent = '隔离 Smoke Fixture｜非生产数据｜不写真实 Ads｜未触发批准';
    Object.assign(label.style, {
      position: 'fixed',
      left: '188px',
      bottom: '12px',
      zIndex: '2147483647',
      border: '2px solid #c2410c',
      borderRadius: '6px',
      background: '#fff7ed',
      padding: '8px 12px',
      color: '#9a3412',
      font: '700 13px/18px system-ui, sans-serif',
      boxShadow: '0 4px 16px rgba(154, 52, 18, 0.2)',
      pointerEvents: 'none',
    });
    document.body.append(label);
  });
  const targetBindingVisualProof = await page.evaluate(() => {
    const inViewport = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0
        && rect.height > 0
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
    };
    const elements = Array.from(document.querySelectorAll('h1, h2, h3, p, div'));
    const heading = elements.find((element) => String(element.textContent || '').trim() === '核验 Ads 对象，保持待审批');
    const safetyCopy = elements.find((element) => String(element.textContent || '').trim()
      === '此步骤只绑定当前建议对应的唯一 Ads 可写对象并生成不可覆盖的审计记录；不会批准建议，也不会执行 Ads 动作。');
    const badge = document.querySelector('[data-smoke-fixture-evidence-label]');
    return {
      headingVisible: inViewport(heading),
      safetyCopyVisible: inViewport(safetyCopy),
      fixtureBadgeVisible: inViewport(badge),
      fixtureBadgeText: String(badge?.textContent || '').trim(),
    };
  });
  if (!targetBindingVisualProof.headingVisible
    || !targetBindingVisualProof.safetyCopyVisible
    || !targetBindingVisualProof.fixtureBadgeVisible
    || targetBindingVisualProof.fixtureBadgeText !== '隔离 Smoke Fixture｜非生产数据｜不写真实 Ads｜未触发批准') {
    fail('Target-binding screenshot did not visibly prove fixture isolation and the safe verification boundary', JSON.stringify(targetBindingVisualProof));
  }
  await captureViewportScreenshot(page, evidence, 'decisionsTargetBindingBefore1200', runId, {
    label: '待审批未绑定对象核验表单（隔离 smoke fixture）',
    workspace: 'decisions',
    subview: 'recommendations',
    inspectorMode: 'drawer',
    fixtureOnly: true,
    writesRealAds: false,
    visualProof: targetBindingVisualProof,
  });
  const targetBindingCountsBefore = await page.evaluate(() => ({
    binding: (window.__businessUiActionLog || []).filter((item) => item.type === 'bindRecommendationWritableTarget').length,
    approval: (window.__businessUiActionLog || []).filter((item) => item.type === 'approveRecommendation' && item.input?.id === 105).length,
  }));
  await targetBindingDrawer.getByRole('button', { name: '确认对象绑定（仍待审批）', exact: true }).click();
  await targetBindingDrawer.getByText('对象已核验 · 仍待审批 #105', { exact: true }).waitFor({ timeout: 5000 });
  await targetBindingDrawer.getByRole('heading', { name: '人工决定', exact: true }).waitFor({ timeout: 5000 });
  await targetBindingDrawer.getByRole('button', { name: '批准建议（不执行 Ads）', exact: true }).waitFor({ timeout: 5000 });
  const targetBindingCountsAfter = await page.evaluate(() => ({
    binding: (window.__businessUiActionLog || []).filter((item) => item.type === 'bindRecommendationWritableTarget').length,
    approval: (window.__businessUiActionLog || []).filter((item) => item.type === 'approveRecommendation' && item.input?.id === 105).length,
  }));
  if (targetBindingCountsAfter.binding !== targetBindingCountsBefore.binding + 1
    || targetBindingCountsAfter.approval !== targetBindingCountsBefore.approval) {
    fail('Target-binding success did not remain isolated from approval', JSON.stringify({ targetBindingCountsBefore, targetBindingCountsAfter }));
  }
  const targetBindingAudit = await page.evaluate(() => {
    const calls = (window.__businessUiActionLog || []).filter((item) => item.type === 'bindRecommendationWritableTarget');
    return calls[calls.length - 1] || null;
  });
  if (targetBindingAudit?.persisted?.status !== 'pending'
    || targetBindingAudit?.persisted?.revision !== 1
    || targetBindingAudit?.persisted?.evidence?.batchId !== 'manual_ad_execution_batch'
    || targetBindingAudit?.persisted?.evidence?.writableTargetBinding?.scope?.batchId !== 'manual_ad_execution_batch'
    || targetBindingAudit?.persisted?.evidence?.writableTargetBinding?.metricSource?.batchId !== 'manual_ad_execution_batch') {
    fail('Target-binding fixture did not persist the pending same-batch audit contract', JSON.stringify(targetBindingAudit));
  }
  await captureViewportScreenshot(page, evidence, 'decisionsTargetBindingSuccess1200', runId, {
    label: '对象已核验且仍待审批（隔离 smoke fixture）',
    workspace: 'decisions',
    subview: 'recommendations',
    inspectorMode: 'drawer',
    fixtureOnly: true,
    status: 'pending',
    writesRealAds: false,
  });
  evidence.targetBindingFixture = {
    recommendationId: 105,
    statusAfterBinding: 'pending',
    bindingCalls: targetBindingCountsAfter.binding - targetBindingCountsBefore.binding,
    approvalCalls: targetBindingCountsAfter.approval - targetBindingCountsBefore.approval,
    requestScope: targetBindingAudit.input?.scope,
    fixtureAuthority: targetBindingAudit.fixtureAuthority,
    persistedBinding: targetBindingAudit.persisted?.evidence?.writableTargetBinding,
    visualProof: targetBindingVisualProof,
    fixtureOnly: true,
    writesRealAds: false,
  };
  await targetBindingDrawer.getByRole('button', { name: '关闭详情检查器' }).click();
  await targetBindingDrawer.waitFor({ state: 'detached', timeout: 5000 });
  await page.evaluate(() => {
    document.querySelector('[data-smoke-fixture-evidence-label]')?.remove();
    window.__mockUnboundRecommendation = false;
  });
  await navigateBusinessPage(page, NAV_RE.readback, 'readback');
  await navigateBusinessPage(page, NAV_RE.recommendations, 'recommendations');
  await waitForDecisionsSubview(page, 'recommendations');
  if (await decisionsRoot.locator('.priority-table tbody tr[aria-label]').count() !== 2) {
    fail('Target-binding fixture leaked into the normal authoritative smoke queue');
  }
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.waitForTimeout(50);

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
  const approveButton = approvalDrawer.getByRole('button', { name: '批准建议（不执行 Ads）', exact: true });
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
    || !await approvalDrawer.getByRole('button', { name: '拒绝建议', exact: true }).isDisabled()) {
    fail('Decision busy state did not lock close and peer decision actions');
  }
  const busyTabsLocked = await page.locator('.decisions-tabs button').evaluateAll((nodes) => (
    nodes.length === 3 && nodes.every((node) => node.disabled)
  ));
  const busyTaskActionsSafe = await page.locator('.task-banner__actions button').evaluateAll((nodes) => (
    nodes.length === 0 || nodes.every((node) => node.disabled)
  ));
  if (!busyTabsLocked || !busyTaskActionsSafe) {
    fail('Decision busy state did not lock tabs or hide/lock competing task actions', JSON.stringify({ busyTabsLocked, busyTaskActionsSafe }));
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
    taskActionsHiddenOrLocked: busyTaskActionsSafe,
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
  if (await reviewDrawer.getByRole('button', { name: '批准建议（不执行 Ads）', exact: true }).count()) {
    fail('Needs-review recommendation exposed an approve action');
  }
  const rejectButton = reviewDrawer.getByRole('button', { name: '拒绝建议', exact: true });
  const rejectCallsBeforeValidation = await page.evaluate(() => (
    (window.__businessUiActionLog || []).filter((item) => item.type === 'rejectRecommendation').length
  ));
  await rejectButton.click();
  await expectVisible(page, '拒绝前必须填写处理人。');
  await reviewDrawer.getByRole('textbox', { name: /复核人/ }).fill('QA Rejector');
  await rejectButton.click();
  await expectVisible(page, '拒绝前必须填写拒绝原因。');
  const rejectCallsAfterEmptyFields = await page.evaluate(() => (
    (window.__businessUiActionLog || []).filter((item) => item.type === 'rejectRecommendation').length
  ));
  if (rejectCallsAfterEmptyFields !== rejectCallsBeforeValidation) {
    fail('Incomplete reject form escaped the renderer fail-closed guard');
  }
  await reviewDrawer.getByRole('textbox', { name: /复核依据|拒绝原因/ }).fill('Rejected during smoke audit.');
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
      || await inspector.getByRole('button', { name: '批准建议（不执行 Ads）', exact: true }).count()
      || await inspector.getByRole('button', { name: '拒绝建议', exact: true }).count()
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
  const readbackWorkspace = page.locator('[data-workspace-evidence-root="true"]');
  await readbackWorkspace.waitFor({ state: 'visible', timeout: 5000 });
  if (await readbackWorkspace.getAttribute('data-workspace') !== 'readback'
    || await readbackWorkspace.getAttribute('data-workspace-subview') !== 'evidence'
    || await readbackWorkspace.getAttribute('data-readback-mode') !== 'production') {
    fail('Readback workspace did not expose the production evidence-root contract');
  }
  await expectVisible(page, '选择已批准动作');
  await expectVisible(page, '填写审批凭证');
  await expectVisible(page, '记录执行和回读');
  await expectVisible(page, '校验并导出证据');
  await expectVisible(page, '对象');
  await expectVisible(page, '位置');
  await expectVisible(page, '动作与值');
  await expectVisible(page, '审批版本');
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
  const authoritySource = readbackWorkspace.locator('[data-readback-authority-source="main-derived"]');
  await authoritySource.waitFor({ state: 'visible', timeout: 5000 });
  if (await authoritySource.getAttribute('aria-label') !== '已批准动作与来源') {
    fail('Main-derived readback authority section is missing its operator-facing accessible name');
  }
  const authoritySourceState = await authoritySource.evaluate((node) => ({
    hasEditableControl: Boolean(node.querySelector('input, textarea, select, [contenteditable="true"]')),
    text: node.textContent || '',
  }));
  if (authoritySourceState.hasEditableControl
    || !authoritySourceState.text.includes('manual_ad_execution_batch')
    || !authoritySourceState.text.includes('2026-06-12')
    || !authoritySourceState.text.includes('来源行 12')
    || !authoritySourceState.text.includes('来源文件')
    || !authoritySourceState.text.includes('1 个')
    || !authoritySourceState.text.includes('页面不可修改')) {
    fail('Main-derived readback authority was not rendered as complete read-only content', JSON.stringify(authoritySourceState));
  }
  if (await readbackWorkspace.getByRole('button', { name: '修正来源字段', exact: true }).count() > 0) {
    fail('Readback workspace still exposes an authority-source editor');
  }
  await clickReadbackStep(page, '2. 填写审批凭证');
  const approvalPanel = readbackWorkspace.getByRole('tabpanel', { name: /填写审批凭证/ });
  await approvalPanel.getByText('QA Approver', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await approvalPanel.getByText('Approved for smoke scope only.', { exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  const approvalAuthorityText = await approvalPanel.locator('dl').innerText();
  if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(approvalAuthorityText)) {
    fail('Main-derived approval time was not rendered as read-only ISO evidence', approvalAuthorityText);
  }
  if (await approvalPanel.getByRole('textbox', { name: /审批人|审批备注|审批时间|审批凭证/ }).count() > 0) {
    fail('Main-derived approval identity or capture path remained editable');
  }
  await pasteReadbackCapture(page, 'approval', 'approval-smoke.png');
  for (const label of ['审批人确认范围', '外部审批允许', '低风险策略允许']) {
    await page.getByLabel(label).check();
  }
  await clickReadbackStep(page, '3. 记录执行和回读');
  await page.getByRole('textbox', { name: '执行人', exact: true }).fill('QA Operator');
  await page.getByRole('textbox', { name: '执行编号', exact: true }).fill('manual-smoke-001');
  await page.getByRole('textbox', { name: '执行时间', exact: true }).fill('2026-06-12T10:05:00.000Z');
  await page.getByRole('textbox', { name: '执行前值', exact: true }).fill('1.20');
  await page.getByRole('textbox', { name: '执行后值', exact: true }).fill('1.08');
  await page.getByRole('textbox', { name: '回读值', exact: true }).fill('1.08');
  await page.getByRole('textbox', { name: '现场行证明', exact: true }).fill('广告后台行已刷新，目标出价保持在 1.08。');
  if (await readbackWorkspace.getByRole('textbox', { name: /执行前截图|执行后截图|回读证据/ }).count() > 0) {
    fail('Capture paths remained editable');
  }
  await pasteReadbackCapture(page, 'before', 'before-smoke.png');
  await pasteReadbackCapture(page, 'after', 'after-smoke.png');
  await pasteReadbackCapture(page, 'readback', 'readback-smoke.png');
  await expectVisible(page, '截图不复用');
  await expectVisible(page, '回读值一致');
  await clickReadbackStep(page, '4. 校验并导出证据');
  for (const label of ['执行成功确认', '执行已核验', '回读已核验']) {
    await page.getByLabel(label).check();
  }
  await expectVisible(page, '字段已填写，待导出校验');
  await expectVisible(page, '字段已填写时仍需导出证据文件和说明文件，并由后端校验截图、真实报表和回读证据文件是否存在。');
  const passBranchStart = await page.evaluate(() => window.__businessUiActionLog.length);
  const finalVerifyAction = readbackWorkspace.getByRole('button', { name: '运行最终校验', exact: true });
  if (await finalVerifyAction.count() !== 1) fail('Readback workspace must expose exactly one final verification action');
  await finalVerifyAction.click();
  await page.waitForFunction((startIndex) => {
    const branch = (window.__businessUiActionLog || []).slice(startIndex);
    const exportCall = branch.find((item) => item.type === 'exportAdReadbackEvidence');
    const verifyCall = branch.find((item) => item.type === 'verifyAdReadbackEvidence');
    return exportCall?.result?.status === 'PASS'
      && exportCall?.result?.nextAction === 'verify'
      && verifyCall?.input?.evidencePath === exportCall?.result?.jsonPath
      && verifyCall?.result?.ready === true;
  }, passBranchStart, { timeout: 5000 });
  const passBranchLog = await page.evaluate(() => window.__businessUiActionLog || []);
  evidence.readbackPassBranch = assertPassReadbackBranch(passBranchLog, passBranchStart);
  await expectVisible(page, '最终校验通过：权威动作、现场证据和回读结果一致。');
  await expectNotInBody(page, 'pnpm run verify:ad-readback');
  const afterExportScreenshotPath = path.join(evidenceDir, `business-ui-ad-execution-readback-after-export-${runId}.png`);
  await page.screenshot({ path: afterExportScreenshotPath, fullPage: false });
  evidence.pages.readbackAfterExport = {
    label: '结果核对导出结果',
    screenshotPath: afterExportScreenshotPath,
    viewport: page.viewportSize(),
    bodyTextSample: (await bodyText(page)).slice(0, 1800),
  };
  await page.evaluate(() => {
    window.__forceReadbackNeedsWork = true;
  });
  await page.getByLabel('回读已核验').uncheck();
  await page.getByLabel('回读已核验').check();
  const needsWorkFinalVerifyAction = readbackWorkspace.getByRole('button', { name: '运行最终校验', exact: true });
  await needsWorkFinalVerifyAction.waitFor({ state: 'visible', timeout: 5000 });
  const needsWorkBranchStart = await page.evaluate(() => window.__businessUiActionLog.length);
  await needsWorkFinalVerifyAction.click();
  await page.waitForFunction((startIndex) => {
    const branch = (window.__businessUiActionLog || []).slice(startIndex);
    const exportCall = branch.find((item) => item.type === 'exportAdReadbackEvidence');
    return exportCall?.result?.status === 'NEEDS_WORK'
      && exportCall?.result?.readyForVerifier === false
      && exportCall?.result?.nextAction === 'prepare';
  }, needsWorkBranchStart, { timeout: 5000 });
  const beforeWorkPackageLog = await page.evaluate(() => window.__businessUiActionLog || []);
  if (beforeWorkPackageLog.slice(needsWorkBranchStart).some((item) => [
    'prepareAdReadbackSession',
    'verifyAdReadbackSession',
    'fillAdReadbackSession',
    'verifyAdReadbackEvidence',
  ].includes(item.type))) {
    fail('NEEDS_WORK main action performed work-package or verification steps automatically');
  }
  const technicalInspector = page.locator('.responsive-inspector').filter({ hasText: '技术与证据详情' });
  if (!await technicalInspector.isVisible().catch(() => false)) {
    await readbackWorkspace.locator('[data-action="open-technical-inspector"]').click();
  }
  await technicalInspector.waitFor({ state: 'visible', timeout: 5000 });
  const technicalInspectorMode = await technicalInspector.getAttribute('data-inspector-mode');
  if (!['inline', 'drawer'].includes(technicalInspectorMode)) {
    fail('Readback technical inspector did not expose a responsive mode', String(technicalInspectorMode));
  }
  await technicalInspector.getByRole('button', { name: '创建回读工作包', exact: true }).click();
  await page.waitForFunction((startIndex) => (window.__businessUiActionLog || []).slice(startIndex)
    .some((item) => item.type === 'prepareAdReadbackSession'), needsWorkBranchStart, { timeout: 5000 });
  await technicalInspector.getByRole('button', { name: '检查工作包', exact: true }).click();
  await page.waitForFunction((startIndex) => (window.__businessUiActionLog || []).slice(startIndex)
    .some((item) => item.type === 'verifyAdReadbackSession'), needsWorkBranchStart, { timeout: 5000 });
  await technicalInspector.getByRole('button', { name: '生成回读证据', exact: true }).click();
  await page.waitForFunction((startIndex) => (window.__businessUiActionLog || []).slice(startIndex)
    .some((item) => item.type === 'fillAdReadbackSession'), needsWorkBranchStart, { timeout: 5000 });
  await technicalInspector.getByRole('button', { name: '校验证据文件', exact: true }).click();
  await page.waitForFunction((startIndex) => (window.__businessUiActionLog || []).slice(startIndex)
    .some((item) => item.type === 'verifyAdReadbackEvidence' && item.result?.ready === true), needsWorkBranchStart, { timeout: 5000 });
  const needsWorkBranchLog = await page.evaluate(() => window.__businessUiActionLog || []);
  evidence.readbackNeedsWorkBranch = assertNeedsWorkReadbackBranch(needsWorkBranchLog, needsWorkBranchStart);
  await expectVisible(page, '结果核对已通过');
  await expectVisible(page, '最终证据已收齐');
  await expectVisible(page, '初始缺口已由工作包补齐并通过校验');
  await expectNotInBody(page, '证据仍需补齐；请在技术详情中创建工作包补证，系统不会自动代填。');
  await expectNotInBody(page, '工作包结构通过，现场证据待填写');
  await expectNotInBody(page, '还必须填写现场信息并生成最终证据后');
  const needsWorkScreenshotPath = path.join(evidenceDir, `business-ui-ad-execution-readback-needs-work-${runId}.png`);
  await page.screenshot({ path: needsWorkScreenshotPath, fullPage: false });
  evidence.pages.readbackNeedsWork = {
    label: '结果核对 NEEDS_WORK 补证链',
    screenshotPath: needsWorkScreenshotPath,
    viewport: page.viewportSize(),
    bodyTextSample: (await bodyText(page)).slice(0, 1800),
  };

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
  const targetBindingCalls = actionLog.filter((item) => item.type === 'bindRecommendationWritableTarget');
  const targetBindingCall = targetBindingCalls[0];
  const targetBindingScope = targetBindingCall?.input?.scope;
  const targetBindingInput = targetBindingCall?.input?.binding;
  const targetBindingTarget = targetBindingInput?.writableTarget;
  const persistedTargetBinding = targetBindingCall?.persisted?.evidence?.writableTargetBinding;
  if (targetBindingCalls.length !== 1
    || targetBindingCall?.input?.recommendationId !== 105
    || targetBindingCall?.input?.expectedRevision !== 0
    || targetBindingScope?.dateFrom !== '2026-06-01'
    || targetBindingScope?.dateTo !== '2026-06-12'
    || targetBindingScope?.storeName !== 'FT-US-US'
    || targetBindingScope?.marketplaceCode !== 'US'
    || targetBindingScope?.asin !== 'B0TESTASIN'
    || targetBindingScope?.batchId !== 'manual_ad_execution_batch'
    || targetBindingInput?.boundBy !== 'Smoke Binder'
    || targetBindingInput?.note !== 'Smoke fixture verified the unique Ads target and keeps the recommendation pending.'
    || targetBindingTarget?.entityType !== 'auto_targeting'
    || targetBindingTarget?.entityId !== 'amzn-auto-target-unbound-105'
    || targetBindingTarget?.sourceFile !== 'C:/reports/auto_targeting.xlsx'
    || targetBindingTarget?.sourceRow !== 12
    || targetBindingTarget?.identitySource !== 'ads_ui'
    || targetBindingTarget?.identityProofPath !== 'C:/evidence/unbound-target-105.png'
    || targetBindingCall?.fixtureAuthority?.batchId !== 'manual_ad_execution_batch'
    || targetBindingCall?.fixtureAuthority?.asin !== 'B0TESTASIN'
    || targetBindingCall?.fixtureAuthority?.reportType !== 'auto_targeting'
    || targetBindingCall?.fixtureAuthority?.sourceFile !== 'C:/reports/auto_targeting.xlsx'
    || JSON.stringify(targetBindingCall?.fixtureAuthority?.sourceFiles) !== JSON.stringify(['C:/reports/auto_targeting.xlsx'])
    || targetBindingCall?.fixtureAuthority?.sourceRow !== 12
    || targetBindingCall?.result?.status !== 'pending'
    || targetBindingCall?.result?.revision !== 1
    || targetBindingCall?.persisted?.status !== 'pending'
    || targetBindingCall?.persisted?.revision !== 1
    || targetBindingCall?.persisted?.evidence?.batchId !== 'manual_ad_execution_batch'
    || targetBindingCall?.persisted?.evidence?.asin !== 'B0TESTASIN'
    || targetBindingCall?.persisted?.evidence?.reportType !== 'auto_targeting'
    || targetBindingCall?.persisted?.evidence?.sourceFile !== 'C:/reports/auto_targeting.xlsx'
    || JSON.stringify(targetBindingCall?.persisted?.evidence?.sourceFiles) !== JSON.stringify(['C:/reports/auto_targeting.xlsx'])
    || targetBindingCall?.persisted?.evidence?.sourceRow !== 12
    || persistedTargetBinding?.fromRevision !== 0
    || persistedTargetBinding?.boundRevision !== 1
    || persistedTargetBinding?.boundBy !== 'Smoke Binder'
    || persistedTargetBinding?.scope?.batchId !== 'manual_ad_execution_batch'
    || persistedTargetBinding?.scope?.asin !== 'B0TESTASIN'
    || persistedTargetBinding?.metricSource?.batchId !== 'manual_ad_execution_batch'
    || JSON.stringify(persistedTargetBinding?.metricSource?.sourceFiles) !== JSON.stringify(['C:/reports/auto_targeting.xlsx'])
    || persistedTargetBinding?.metricSource?.sourceRow !== 12
    || persistedTargetBinding?.writableTarget?.entityId !== 'amzn-auto-target-unbound-105') {
    fail('Target-binding smoke did not submit the isolated immutable Ads identity contract', JSON.stringify(targetBindingCalls));
  }
  if (actionLog.some((item) => item.type === 'approveRecommendation' && item.input?.id === 105)) {
    fail('Target-binding smoke fixture incorrectly approved recommendation #105');
  }
  const readbackExports = actionLog.filter((item) => item.type === 'exportAdReadbackEvidence');
  if (readbackExports.length !== 2
    || readbackExports[0].result?.status !== 'PASS'
    || readbackExports[1].result?.status !== 'NEEDS_WORK') {
    fail('Readback smoke did not exercise exactly one PASS export and one NEEDS_WORK export', JSON.stringify(readbackExports));
  }
  for (const readbackExport of readbackExports) {
    if (JSON.stringify(Object.keys(readbackExport.input || {}).sort()) !== JSON.stringify(['expectedRevision', 'operatorEvidence', 'recommendationId', 'scope'])
      || readbackExport.input?.recommendationId !== 101
      || readbackExport.input?.expectedRevision !== 1
      || readbackExport.input?.scope?.batchId !== 'manual_ad_execution_batch'
      || readbackExport.input?.scope?.asin !== 'B0TESTASIN'
      || !readbackExport.input?.operatorEvidence
      || readbackExport.authoritySource?.recommendationId !== 101
      || readbackExport.authoritySource?.revision !== 1
      || readbackExport.authoritySource?.status !== 'approved'
      || readbackExport.authoritySource?.source?.batchId !== 'manual_ad_execution_batch'
      || readbackExport.authoritySource?.source?.metricDate !== '2026-06-12'
      || readbackExport.authoritySource?.source?.sourceRow !== 12
      || !readbackExport.authoritySource?.source?.sourceFiles?.includes('C:/reports/auto_targeting.xlsx')
      || readbackExport.authoritySource?.target?.asin !== 'B0TESTASIN'
      || readbackExport.authoritySource?.approval?.note !== 'Approved for smoke scope only.'
      || readbackExport.authoritySource?.riskLevel !== 'APPROVAL') {
      fail('Readback export did not bind renderer operator evidence to the internal approved authority row', JSON.stringify(readbackExport));
    }
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
