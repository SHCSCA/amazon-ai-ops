const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('./playwright-loader');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const NAV_RE = {
  approval: /审批历史中心|审批中心/,
  readback: /渐进执行回读|执行回读/,
  recommendations: /优化建议草案|优化建议/,
};
const HEADING_RE = {
  approval: /审批中心/,
  readback: /回读向导|执行回读/,
  recommendations: /优化建议/,
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
      resolve({ url: `http://127.0.0.1:${address.port}/index.html`, close: () => server.close() });
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
  await page.getByRole('tab', { name: new RegExp(escapeRegExp(title)) }).click();
}

async function clickRecommendationGeneration(page) {
  await openEvidenceDisclosures(page);
  await page.getByRole('button', { name: /1\. 生成解释/ }).first().click();
}

async function assertGlobalGuards(page, key) {
  const textContent = await bodyText(page);
  if (!textContent.includes('USD')) fail('USD marker is missing', key);
  if (textContent.includes('¥')) fail('RMB marker is visible', key);
  if (textContent.includes('v1.5 工作台')) fail('Old v1.5 workbench is visible', key);
  if (textContent.includes('APP_READY')) fail('False APP_READY state is visible', key);
  if (textContent.includes('pnpm run verify:ad-readback')) fail('Readback command wall is visible', key);
  if (textContent.includes('create:ad-readback-template')) fail('Readback template command is visible', key);
}

async function navigateBusinessPage(page, nav, route) {
  const button = page.locator('.app-sidebar').getByRole('button', { name: nav }).first();
  try {
    await button.click({ timeout: 8000 });
  } catch {
    await page.evaluate((nextRoute) => {
      window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: nextRoute }));
    }, route);
  }
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
        if (window.__hideRecommendations) return [];
        const scopedRecommendation = {
          ...recommendationBase,
          evidence: { ...recommendationBase.evidence, batchId: filter?.batchId || recommendationBase.evidence.batchId },
        };
        if (filter?.status === 'approved') {
          return [{
            ...scopedRecommendation,
            status: 'approved',
            evidence: {
              ...scopedRecommendation.evidence,
              approvalDecision: window.__lastApprovalDecision || undefined,
            },
          }];
        }
        if (filter?.status === 'needs_review') {
          return [{
            ...blockedRecommendation,
            evidence: { ...blockedRecommendation.evidence, batchId: filter?.batchId || blockedRecommendation.evidence.batchId },
          }];
        }
        if (filter?.status === 'rejected') return [];
        if (window.__mockAiNoEvidenceRecommendation) {
          return [{
            ...aiNoEvidenceRecommendation,
            status: 'pending',
            evidence: { ...aiNoEvidenceRecommendation.evidence, batchId: filter?.batchId || aiNoEvidenceRecommendation.evidence.batchId },
          }];
        }
        if (window.__mockAiExplanationOnlyRecommendation) {
          return [{
            ...aiExplanationOnlyRecommendation,
            status: 'pending',
            evidence: { ...aiExplanationOnlyRecommendation.evidence, batchId: filter?.batchId || aiExplanationOnlyRecommendation.evidence.batchId },
          }];
        }
        return [{ ...scopedRecommendation, status: 'pending' }];
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
        window.__lastApprovalDecision = input?.decision || null;
        return undefined;
      },
      rejectRecommendation: async (input) => {
        window.__businessUiActionLog.push({ type: 'rejectRecommendation', input });
        window.__lastRejectedDecision = input?.decision || null;
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
  await page.getByLabel('数据批次来源').selectOption('__manual__');
  await page.getByRole('textbox', { name: '数据批次', exact: true }).fill('manual_ad_execution_batch');
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('manual_ad_execution_batch'), null, { timeout: 5000 });
  await page.getByText('批次', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText('报表', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.body.textContent?.includes('手动批次未自动校验：manual_ad_execution_batch'), null, { timeout: 5000 });
  await expectInBody(page, 'manual_ad_execution_batch', 'manual batch scope value');

  const routes = [
    { nav: NAV_RE.recommendations, heading: HEADING_RE.recommendations, label: '优化建议', key: 'recommendations' },
    { nav: NAV_RE.approval, heading: HEADING_RE.approval, label: '审批中心', key: 'approval' },
    { nav: NAV_RE.readback, heading: HEADING_RE.readback, label: '执行回读', key: 'readback' },
  ];
  for (const { nav, heading, label, key } of routes) {
    await navigateBusinessPage(page, nav, key);
    await page.getByRole('heading', { name: heading, level: 2 }).waitFor();
    await assertGlobalGuards(page, key);
    const screenshotPath = path.join(evidenceDir, `business-ui-ad-execution-${key}-${runId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.pages[key] = {
      label,
      screenshotPath,
      bodyTextSample: (await bodyText(page)).slice(0, 1800),
    };
  }

  await navigateBusinessPage(page, NAV_RE.recommendations, 'recommendations');
  await expectVisible(page, '建议池');
  await expectVisible(page, '正式可审批 1');
  await expectInBody(page, '需复核 1', 'recommendation task review count');
  await expectInBody(page, '缺证据 0', 'recommendation task evidence blocker count');
  await expectVisible(page, '去审批中心');
  await openEvidenceDisclosures(page);
  await expectVisible(page, '建议处理路径');
  await expectVisible(page, '1. 生成解释');
  await expectVisible(page, '2. 审批决策');
  await expectVisible(page, '3. 执行回读');
  await expectVisible(page, '本页不审批、不执行广告、不写入 Amazon；真实动作必须在审批后逐条记录截图和回读证据。');
  await expectVisible(page, '建议上下文检查');
  await expectVisible(page, '建议决策总览');
  await expectVisible(page, '正式可审批');
  await expectVisible(page, '人工复核');
  await expectVisible(page, 'AI 洞察未采纳');
  await expectVisible(page, '证据不足阻断');
  await expectInBody(page, '只把证据完整、可绑定当前广告对象的动作送入审批中心。', 'recommendation decision routing summary');
  await expectVisible(page, 'AI 可用');
  await expectVisible(page, 'deepseek-chat');
  await expectInBody(page, '生成建议时会调用 AI 参与产品阶段诊断、动态阈值建议和动作解释。', 'recommendation ai readiness');
  await expectVisible(page, '真实广告事实');
  await expectVisible(page, '8/8 类真实报表 / 24 行 DB 指标');
  await expectVisible(page, '只使用当前范围真实 xlsx/xls/csv 导入后的每日广告事实。');
  await expectVisible(page, '可执行口径');
  await expectVisible(page, '0 行 / 0 个诊断对象');
  await expectVisible(page, '建议只绑定 keyword、search term、target 等能落到广告对象的行。');
  await expectVisible(page, '阶段与运营上下文');
  await expectVisible(page, '1 条时间线 / 1 条运营事件');
  await expectVisible(page, 'AI 会结合对象生命周期、Coupon、BD、调价、库存和 Listing 变更解释波动。');
  await expectVisible(page, '本次 AI 输入');
  await expectVisible(page, '广告事实 + 产品配置 + 运营事件 + 规则阈值 + 量化诊断');
  await expectVisible(page, 'AI 不直接读取审计包，也不会在缺真实数据时用 0 值生成建议。');
  await expectVisible(page, '产品配置');
  await expectVisible(page, '1 个产品 / 1 个有目标阈值');
  await expectInBody(page, '目标 ACOS 35.0%', 'recommendation product target ACOS');
  await expectVisible(page, '安全边界');
  await expectVisible(page, '生成建议池');
  for (const text of [
    'AI + 规则并行决策模型',
    '硬阈值与安全边界',
    'AI 可用',
    '规则和 AI 一致才进入普通审批；冲突、AI 独立洞察和样本不足进入人工复核。',
    '建议只基于当前范围真实报表、产品配置和运营事件；没有导入指标时不调用 AI 生成建议。',
  ]) {
    await expectInBody(page, text, 'recommendation ai-rule decision model');
  }
  await expectVisible(page, '当前批次');
  await expectVisible(page, 'AI/规则合并');
  await expectVisible(page, '规则量化');
  await expectVisible(page, '运营事件');
  await expectVisible(page, '1 条进入 AI 上下文');
  await expectVisible(page, '产品目标');
  await expectInBody(page, 'TACOS 12.0%', 'recommendation product target TACOS');
  await expectVisible(page, '2026-06-10 / 10% Coupon started');
  await expectInBody(page, '2 条 AI 策略诊断，2 条 AI 文本解释，0 条纯规则兜底。', 'ai strategy/text split');
  await expectVisible(page, 'AI参与 2');
  await expectVisible(page, 'AI解释 2');
  await expectVisible(page, '2 浪费 / 1 需处理');
  await expectVisible(page, 'manual_ad_execution_batch');
  await openEvidenceDisclosures(page);
  await expectVisible(page, '对象类型');
  await expectVisible(page, '批次/来源');
  await expectVisible(page, 'AI/规则判断');
  await expectVisible(page, '浪费风险');
  await expectVisible(page, '可进入普通审批');
  await expectVisible(page, '规则+AI 一致');
  await expectVisible(page, '关键词探索');
  await expectVisible(page, '建议优先级与判断标准');
  await expectInBody(page, '规则阈值：目标 ACOS 25.0% / 高 ACOS 50.0% / 无订单 30 点击 / 最低花费 $10.00', 'recommendation threshold summary');
  await expectVisible(page, '调整规则阈值');
  await expectVisible(page, '去审批中心');
  await clickRecommendationGeneration(page);
  await page.getByText('已生成 1 条新建议，规则候选 1 条，AI 候选 1 条，最终可审批动作 1 条，处理 24 行广告指标。', { exact: false }).waitFor({ timeout: 5000 });
  await page.getByText('AI 已参与广告阶段诊断、动态阈值建议和 1/1 条规则候选解释。', { exact: false }).first().waitFor({ timeout: 5000 });
  await openEvidenceDisclosures(page);
  await expectVisible(page, '本次生成 AI 参与状态');
  await expectVisible(page, 'AI 已参与');
  await expectVisible(page, '1 新建议 / 1 可审批动作');
  await expectInBody(page, '正式可审批 1', 'formal recommendation count');
  await expectInBody(page, '人工复核 1', 'manual review recommendation count');
  await expectInBody(page, 'AI 洞察未采纳 0', 'insight only recommendation count');
  await expectInBody(page, '证据不足阻断 0', 'blocked evidence recommendation count');
  await expectInBody(page, '规则候选 1 条，AI 候选 1 条，刷新 0 条旧建议，跳过 0 条重复建议。', 'candidate source split');
  await expectVisible(page, '1 AI 建议解释 / 0 规则解释');
  await expectVisible(page, '事件上下文');
  await expectVisible(page, '1 条运营事件');
  await expectVisible(page, '已进入广告阶段诊断和动态阈值判断。');
  await expectVisible(page, '产品上下文');
  await expectVisible(page, '1 个产品配置');
  await expectVisible(page, '广告阶段诊断');
  await expectVisible(page, '关键词探索 / AI');
  await expectVisible(page, '动态阈值建议');
  await expectVisible(page, '目标 ACOS 35.0% / 高 ACOS 55.0% / 无订单 18 点击 / 最低花费 $15.00');
  await expectInBody(page, 'AI 候选 1 条，', 'strategy diagnosis AI candidate count');
  await expectInBody(page, '产品配置 1 个进入诊断上下文。', 'strategy diagnosis product context count');
  await expectVisible(page, 'AI/规则合并诊断');
  await expectVisible(page, '一致 1 / 规则独立 0 / AI 独立洞察 0 / 冲突 0 / 需复核 0');
  await expectVisible(page, '本次没有返回额外过滤原因。');
  await expectVisible(page, '来自当前保存的 DeepSeek/OpenAI Compatible 设置。');
  await page.evaluate(() => {
    window.__mockAiConfigured = false;
  });
  await clickRecommendationGeneration(page);
  await page.getByText('未配置 AI Key，建议解释使用规则引擎兜底。', { exact: false }).first().waitFor({ timeout: 5000 });
  await openEvidenceDisclosures(page);
  await expectVisible(page, '未配置 AI Key');
  await expectVisible(page, '0 AI 建议解释 / 1 规则解释');
  await expectVisible(page, '未配置 Key 时不会伪装成 AI 策略。');
  await expectVisible(page, '一致 0 / 规则独立 1 / AI 独立洞察 0 / 冲突 0 / 需复核 0');
  await expectVisible(page, '1 条规则独立建议缺少 AI 确认，仍需按证据完整性审批。');
  await page.evaluate(() => {
    window.__mockAiConfigured = true;
    window.__mockAiNoOutput = true;
  });
  await clickRecommendationGeneration(page);
  await page.getByText('已尝试调用 AI，但本次没有可用 AI 输出，建议已回落到规则引擎。原因：AI 服务超时', { exact: false }).first().waitFor({ timeout: 5000 });
  await openEvidenceDisclosures(page);
  await expectVisible(page, 'AI 已转为规则兜底：AI 服务超时');
  await expectVisible(page, '0 AI 建议解释 / 1 规则解释');
  await expectVisible(page, '一致 0 / 规则独立 1 / AI 独立洞察 0 / 冲突 0 / 需复核 0');
  await page.evaluate(() => {
    window.__mockAiNoOutput = false;
    window.__mockScopedMetricsMissing = true;
  });
  await clickRecommendationGeneration(page);
  await expectInBody(page, '当前产品范围缺少可回查的日级广告指标', 'scoped metrics binding gate error');
  await expectInBody(page, '请先在产品管理选择 ASIN，并在数据导入与校验页重新导入当前批次真实报表后再运行 AI', 'scoped metrics binding recovery guidance');
  await page.evaluate(() => {
    window.__mockScopedMetricsMissing = false;
  });
  await expectVisible(page, '查看详情');
  await expectVisible(page, 'DeepSeek AI');
  await page.getByRole('button', { name: '查看详情' }).first().click();
  await openEvidenceDisclosures(page);
  await expectVisible(page, '送审前证据检查');
  await expectVisible(page, '证据完整');
  await expectVisible(page, '来源批次匹配');
  await expectVisible(page, '当前/建议值');
  await expectVisible(page, '当前值');
  await expectVisible(page, '建议值');
  await expectVisible(page, '策略诊断');
  await expectVisible(page, 'AI 动态阈值');
  await expectVisible(page, '规则量化');
  await expectVisible(page, '规则阈值');
  await expectVisible(page, '产品阶段');
  await expectVisible(page, '产品目标 ACOS / TACOS');
  await expectVisible(page, '目标净利率 / 最低价');
  await expectVisible(page, '复核原因');
  await expectVisible(page, '关联运营事件');
  await expectVisible(page, '2026-06-10 / Coupon');
  await expectVisible(page, '10% Coupon started');
  await expectVisible(page, 'conversion_up / B0TESTASIN');
  await expectVisible(page, '规则量化依据');
  await expectVisible(page, 'ACOS 72.0% 高于高风险阈值 50.0%。');
  await expectVisible(page, '目标 ACOS 25.0% / 高风险 50.0% / 无订单 30 点击 / 止损 $10.00');
  await expectVisible(page, '目标 ACOS 35.0% / 高 ACOS 55.0% / 无订单 18 点击 / 最低花费 $15.00');
  await expectVisible(page, '1 条进入诊断上下文');
  await expectVisible(page, 'AI 策略诊断');
  await expectVisible(page, 'Coupon 背景显示该产品仍处于测词阶段，同时需要收紧无订单花费。');
  await expectVisible(page, 'AI/规则决策摘要');
  await expectVisible(page, '规则与 AI 一致，且已绑定可回查证据。');
  await expectVisible(page, '可进入审批，但仍需人工确认和执行回读。');
  await expectVisible(page, 'AI 判断依据');
  await expectVisible(page, '引用证据详情');
  await expectVisible(page, '报表指标');
  await expectVisible(page, '运营事件');
  await expectVisible(page, 'tight match target / 2026-06-12');
  await expectInBody(page, '报表 user_search_term');
  await expectInBody(page, '$42.18 / $58.58 / 1 单 / 32 点击');
  await expectInBody(page, '2026-06-10 / coupon / conversion_up');
  await expectVisible(page, '规则：高 ACOS 且已有花费。');
  await expectVisible(page, 'AI：Coupon 未带来足够转化。');
  await expectVisible(page, '来源文件');
  await expectVisible(page, '来源文件 1');
  await expectVisible(page, '来源行号');
  await expectVisible(page, '12');
  await expectVisible(page, 'C:/reports/source_user_search_term.xlsx');
  await expectInBody(page, '可进入审批中心复核；来源批次 manual_ad_execution_batch 已绑定当前范围。', 'recommendation evidence readiness');
  await expectVisible(page, '只解释和送审，不执行广告动作');
  await expectInBody(page, 'deepseek-chat', 'recommendation detail AI model');
  await page.evaluate(() => {
    window.__hideRecommendations = true;
  });
  await page.getByRole('button', { name: '刷新建议' }).click();
  await page.getByText('当前范围还没有待审批或需复核建议。', { exact: true }).waitFor({ timeout: 5000 });
  await expectVisible(page, '为什么现在没有建议');
  await expectVisible(page, '建议池为空');
  await expectVisible(page, '本次生成可能已经完成但当前筛选状态没有待审批或需复核建议，或建议已被处理。');
  await expectNotInBody(page, 'C:/reports/source_user_search_term.xlsx');
  await page.evaluate(() => {
    window.__mockNoRecommendationCandidates = true;
  });
  await page.getByRole('button', { name: '生成优化建议', exact: true }).first().click();
  await page.getByText('已生成 0 条新建议，规则候选 0 条，AI 候选 0 条，最终可审批动作 0 条，处理 24 行广告指标。', { exact: false }).waitFor({ timeout: 5000 });
  await openEvidenceDisclosures(page);
  await expectVisible(page, 'AI 已参与诊断');
  await expectVisible(page, '0 新建议 / 0 可审批动作');
  await expectVisible(page, '一致 0 / 规则独立 0 / AI 独立洞察 0 / 冲突 0 / 需复核 0');
  await expectVisible(page, '规则和 AI 都没有返回可合并的候选动作。');
  await expectVisible(page, 'AI 仅生成洞察，未进入建议池');
  await expectVisible(page, 'AI 已运行广告阶段诊断，但没有找到可安全绑定到当前真实指标的可审批动作。');
  await expectInBody(page, '未进入建议池原因：规则和 AI 都没有返回可合并的候选动作。', 'no-candidate blocked reason');
  await expectInBody(page, '先补齐证据和对象绑定：确认来源行、广告活动/广告组/关键词或投放对象能回查到当前真实报表', 'no-candidate next action');
  await expectInBody(page, 'AI 没有返回可审批动作候选。', 'no-candidate AI action explanation');
  await expectVisible(page, 'AI 诊断已完成，但未形成正式建议');
  await expectVisible(page, '0 建议原因分布');
  await expectVisible(page, '规则候选 0');
  await expectVisible(page, 'AI 候选 0');
  await expectVisible(page, '洞察未采纳 1');
  await expectVisible(page, '最终可审批 0');
  await expectVisible(page, '下一步处理顺序');
  await expectVisible(page, '先回广告量化页查看风险对象和样本量');
  await expectVisible(page, '补充运营事件或产品配置后重新生成');
  await expectVisible(page, '确认广告活动、广告组、关键词/搜索词/投放对象能绑定真实报表行');
  await expectVisible(page, 'AI 诊断摘要');
  await expectVisible(page, '当前表现相对稳定，暂时没有足够证据支持调整出价或新增否定词。');
  await expectVisible(page, '未进入建议池的原因');
  await expectVisible(page, '下一步补证据');
  await expectVisible(page, '回到广告量化页复核风险对象、样本量和规则阈值；必要时补充运营事件或产品配置后重新生成。');
  await expectVisible(page, 'AI 洞察但未采纳');
  await expectVisible(page, 'unbound no-candidate insight');
  await expectVisible(page, '没有可绑定到当前真实指标的广告活动/广告组/对象。');
  await expectVisible(page, '查看广告量化');
  await expectVisible(page, '稳定转化 / AI');
  await page.evaluate(() => {
    window.__mockBlockedPipeline = true;
    window.__hideRecommendations = true;
    window.dispatchEvent(new Event('business-ui:data-updated'));
  });
  await page.getByText('缺真实数据，建议生成锁定', { exact: true }).waitFor({ timeout: 5000 });
  await expectVisible(page, '当前不能生成建议的原因');
  await expectVisible(page, '当前范围缺少真实 xlsx/xls/csv 原始报表文件');
  await expectVisible(page, '当前范围没有写入 DB 的广告指标行');
  await expectVisible(page, '当前范围没有 keyword/search term/target 等可执行口径指标');
  const blockedGenerateDisabled = await page.getByRole('button', { name: '生成优化建议', exact: true }).first().isDisabled();
  if (!blockedGenerateDisabled) {
    fail('Blocked recommendation generation button should stay disabled until real files and DB metrics exist');
  }
  await page.evaluate(() => {
    window.__mockNoRecommendationCandidates = false;
    window.__mockBlockedPipeline = false;
  });
  await page.evaluate(() => {
    window.__hideRecommendations = false;
    window.dispatchEvent(new Event('business-ui:data-updated'));
  });
  await page.getByRole('button', { name: '刷新建议' }).click();
  await expectVisible(page, '查看详情');

  await navigateBusinessPage(page, NAV_RE.approval, 'approval');
  await expectVisible(page, '选择一条建议');
  await expectVisible(page, '查看审批队列');
  await openEvidenceDisclosures(page);
  await expectVisible(page, '审批安全边界');
  await expectVisible(page, '仅审批，不执行');
  await expectVisible(page, '审批处理要求');
  await expectVisible(page, '批准后下一步');
  await expectVisible(page, '在执行回读页补录审批凭证、执行前/执行后截图、回读值和现场行证明。');
  await page.getByRole('button', { name: '复核队列' }).click();
  await openEvidenceDisclosures(page);
  await expectInBody(page, 'AI 独立洞察不能直接批准');
  await expectInBody(page, '规则量化要求人工复核');
  await page.getByRole('button', { name: '处理' }).first().click();
  await expectVisible(page, '需要复核');
  await expectVisible(page, '普通批准不可用');
  await openEvidenceDisclosures(page);
  await expectInBody(page, '这条建议不能走普通批准');
  await page.getByRole('button', { name: '普通批准不可用' }).evaluate((node) => {
    if (!node.disabled) throw new Error('Blocked review recommendation approve button was not disabled');
  });
  await page.getByRole('button', { name: '待审批' }).click();
  await page.evaluate(() => {
    window.__mockAiNoEvidenceRecommendation = true;
    window.dispatchEvent(new Event('business-ui:data-updated'));
  });
  await page.getByRole('button', { name: '复核队列' }).click();
  await openEvidenceDisclosures(page);
  await expectInBody(page, 'AI 独立洞察不能直接批准');
  await page.getByRole('button', { name: '待审批' }).click();
  await page.waitForFunction(() => window.__businessUiActionLog?.some((item) => item.type === 'getRecommendations' && item.filter?.status === 'pending'));
  await page.getByRole('button', { name: '处理' }).first().click();
  await expectVisible(page, '不能普通批准');
  await expectVisible(page, '普通批准不可用');
  await openEvidenceDisclosures(page);
  await expectInBody(page, 'AI 建议缺少可回查证据引用');
  await page.getByRole('button', { name: '普通批准不可用' }).evaluate((node) => {
    if (!node.disabled) throw new Error('AI recommendation without evidence refs approve button was not disabled');
  });
  await page.evaluate(() => {
    window.__mockAiNoEvidenceRecommendation = false;
    window.__mockAiExplanationOnlyRecommendation = true;
    window.dispatchEvent(new Event('business-ui:data-updated'));
  });
  await page.getByRole('button', { name: '复核队列' }).click();
  await openEvidenceDisclosures(page);
  await expectInBody(page, 'AI 独立洞察不能直接批准');
  await page.getByRole('button', { name: '待审批' }).click();
  await expectInBody(page, 'ai explanation only target');
  await page.getByRole('button', { name: '处理' }).first().click();
  await expectNotInBody(page, 'AI 建议缺少可回查证据引用');
  await page.getByRole('button', { name: '批准并进入待执行' }).evaluate((node) => {
    if (node.disabled) throw new Error('Rule recommendation with AI explanation only should remain approvable');
  });
  await page.evaluate(() => {
    window.__mockAiNoEvidenceRecommendation = false;
    window.__mockAiExplanationOnlyRecommendation = false;
    window.dispatchEvent(new Event('business-ui:data-updated'));
  });
  await page.getByRole('button', { name: '复核队列' }).click();
  await openEvidenceDisclosures(page);
  await expectInBody(page, 'AI 独立洞察不能直接批准');
  await page.getByRole('button', { name: '待审批' }).click();
  await openEvidenceDisclosures(page);
  await expectVisible(page, '广告组合');
  await expectVisible(page, 'ASIN');
  await expectVisible(page, 'D6 Portfolio');
  await expectVisible(page, 'B0TESTASIN');
  await page.getByRole('button', { name: '处理' }).first().click();
  await expectVisible(page, '可以批准');
  await openEvidenceDisclosures(page);
  await expectVisible(page, '审批人、备注、范围和数据批次会写入建议证据；真实广告后台操作和审批凭证路径仍必须在“执行回读”页逐条补齐。');
  await expectVisible(page, 'AI/规则决策摘要');
  await expectVisible(page, '规则与 AI 一致，且已绑定可回查证据。');
  await expectVisible(page, '可进入审批，但仍需人工确认和执行回读。');
  await expectVisible(page, '当前值/建议值');
  await expectVisible(page, '来源文件');
  await expectVisible(page, '当前批次');
  await expectVisible(page, '来源批次');
  await expectVisible(page, '来源批次匹配');
  await expectVisible(page, '指标日期');
  await expectVisible(page, '对象类型');
  await expectVisible(page, '审批预检');
  await expectVisible(page, '通过');
  await expectVisible(page, 'AI/规则决策关系');
  await expectVisible(page, '规则+AI 一致');
  await expectVisible(page, 'AI 策略诊断');
  await expectVisible(page, 'AI 阶段诊断 / keyword_exploration');
  await expectVisible(page, 'AI 动态阈值');
  await expectInBody(page, '目标 ACOS 35.0% / 高 ACOS 55.0% / 无订单 18 点击 / 最低花费 $15.00', 'approval AI dynamic threshold summary');
  await expectVisible(page, '产品阶段');
  await expectVisible(page, '产品目标 ACOS / TACOS');
  await expectVisible(page, '目标净利率 / 最低价');
  await expectInBody(page, '35.0% / 12.0%', 'approval product target thresholds');
  await expectVisible(page, 'AI/规则合并依据');
  await expectVisible(page, '规则：高 ACOS 且已有花费。');
  await expectVisible(page, 'AI：Coupon 未带来足够转化。');
  await expectVisible(page, 'AI 主要问题：no_order_spend；high_acos');
  await expectVisible(page, 'AI 判断依据');
  await expectVisible(page, '引用证据详情');
  await expectVisible(page, '报表指标');
  await expectInBody(page, 'tight match target / 2026-06-12');
  await expectInBody(page, '$42.18 / $58.58 / 1 单 / 32 点击');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByText('拒绝前必须填写处理人。', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByPlaceholder('负责人姓名').fill('QA Rejector');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByText('拒绝前必须填写拒绝原因。', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByPlaceholder('记录审批范围、外部审批凭证或拒绝原因').fill('Rejected during smoke audit.');
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await page.getByText('已拒绝建议 #101，拒绝原因已写入建议证据', { exact: false }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '处理' }).first().click();
  await page.getByPlaceholder('负责人姓名').fill('QA Approver');
  await page.getByPlaceholder('记录审批范围、外部审批凭证或拒绝原因').fill('Approved for smoke scope only.');
  await page.getByRole('button', { name: '批准并进入待执行' }).click();

  await navigateBusinessPage(page, NAV_RE.readback, 'readback');
  await expectVisible(page, '1. 确认动作和来源');
  await expectVisible(page, '2. 填写审批允许');
  await expectVisible(page, '3. 补执行前后和回读');
  await expectVisible(page, '4. 校验并导出证据');
  await expectVisible(page, '人工执行证据，不批量写入');
  await expectVisible(page, '执行前、执行后、回读截图不能复用');
  await expectVisible(page, '回读值必须等于执行后值');
  await expectVisible(page, '广告组合');
  await expectVisible(page, 'ASIN');
  await expectVisible(page, '对象类型');
  await expectVisible(page, 'D6 Portfolio');
  await expectVisible(page, 'B0TESTASIN');
  await expectVisible(page, 'target');
  await expectNotInBody(page, 'pnpm run verify:ad-readback');
  await expectNotInBody(page, 'create:ad-readback-template');
  await page.getByRole('button', { name: '载入' }).first().click();
  await clickReadbackStep(page, '1. 确认动作和来源');
  await expectVisible(page, '来源批次');
  await expectVisible(page, '指标日期');
  await expectVisible(page, '来源行号');
  await expectVisible(page, '当前有效批次：manual_ad_execution_batch');
  await expectVisible(page, '来源批次匹配');
  await expectVisible(page, '来源批次、指标日期、来源行号、来源文件、来源当前值和建议值是回读证据的一部分；缺失或串批次时只能导出缺口草稿。');
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
  await clickReadbackStep(page, '2. 填写审批允许');
  await page.getByRole('textbox', { name: '审批人', exact: true }).evaluate((node) => {
    if (node.value !== 'QA Approver') throw new Error(`Unexpected carried approver: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '审批备注', exact: true }).evaluate((node) => {
    if (node.value !== 'Approved for smoke scope only.') throw new Error(`Unexpected carried approval note: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '审批时间', exact: true }).evaluate((node) => {
    if (!String(node.value || '').includes('T')) throw new Error(`Approval time was not carried into readback: ${node.value}`);
  });
  await clickReadbackStep(page, '1. 确认动作和来源');
  await page.getByRole('textbox', { name: '来源批次', exact: true }).fill('stale_ad_execution_batch');
  await expectVisible(page, '来源批次不一致');
  await clickReadbackStep(page, '4. 校验并导出证据');
  await expectVisible(page, '来源批次必须等于当前批次');
  await expectVisible(page, '导出缺口草稿');
  await clickReadbackStep(page, '1. 确认动作和来源');
  await page.getByRole('textbox', { name: '来源批次', exact: true }).fill('manual_ad_execution_batch');
  await clickReadbackStep(page, '1. 确认动作和来源');
  await expectVisible(page, '来源批次匹配');
  await clickReadbackStep(page, '2. 填写审批允许');
  await page.getByRole('textbox', { name: '审批人', exact: true }).fill('QA Approver');
  await page.getByRole('textbox', { name: '审批凭证', exact: true }).fill('C:/evidence/approval.png');
  await page.getByRole('textbox', { name: '审批时间', exact: true }).fill('2026-06-12T10:00:00.000Z');
  for (const label of ['审批人确认范围', '外部审批允许', '低风险策略允许']) {
    await page.getByLabel(label).check();
  }
  await clickReadbackStep(page, '3. 补执行前后和回读');
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
  await page.screenshot({ path: afterExportScreenshotPath, fullPage: true });
  evidence.pages.readbackAfterExport = {
    label: '执行回读导出结果',
    screenshotPath: afterExportScreenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 1800),
  };
  await clickReadbackStep(page, '3. 补执行前后和回读');
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
  const generateCall = actionLog.find((item) => item.type === 'generateRecommendations');
  if (!generateCall) {
    fail('Generate recommendations IPC mock was not called', JSON.stringify(actionLog));
  }
  assertScopeParams(generateCall.params, 'generateRecommendations');
  const approvalCall = actionLog.find((item) => item.type === 'approveRecommendation');
  if (!approvalCall) {
    fail('Approval IPC mock was not called', JSON.stringify(actionLog));
  }
  if (approvalCall.input?.id !== 101
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
  if (rejectCall.input?.id !== 101
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
