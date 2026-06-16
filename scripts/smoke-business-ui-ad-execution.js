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
  if (!textContent.includes('USD')) fail('USD marker is missing', key);
  if (textContent.includes('¥')) fail('RMB marker is visible', key);
  if (textContent.includes('v1.5 工作台')) fail('Old v1.5 workbench is visible', key);
  if (textContent.includes('APP_READY')) fail('False APP_READY state is visible', key);
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
    const recommendationBase = {
      id: 101,
      actionType: 'lower_bid',
      entityType: 'target',
      entityName: 'tight match target',
      currentValue: '1.20',
      recommendedValue: '1.08',
      reason: 'High ACOS with spend and no efficient orders.',
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
        aiExplanation: 'DeepSeek explanation with scope and risk notes.',
        aiRiskWarnings: ['Keep approval and readback before any live operation.'],
        aiModel: 'deepseek-chat',
        aiStrategySource: 'ai',
        aiLifecycleStage: 'keyword_exploration',
        aiStrategySummary: 'Coupon context keeps this product in keyword exploration while tightening no-order spend.',
        aiMainProblems: ['no_order_spend', 'high_acos'],
        aiThresholdSuggestions: {
          targetAcos: { value: 0.35, reason: 'Exploration tolerance.' },
          highAcosThreshold: { value: 0.55, reason: 'Coupon context.' },
          noOrderClickThreshold: { value: 18, reason: 'Enough click data.' },
          minSpend: { value: 15, reason: 'Avoid small samples.' },
        },
        aiStrategyRiskWarnings: ['Do not negate core terms blindly.'],
        decisionAgreement: 'aligned',
        decisionSource: 'rule_ai',
        decisionReasons: ['Rule: High ACOS with spend.', 'AI: Coupon did not convert enough traffic.'],
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
      reason: 'AI-only recommendation requires strategy review.',
      evidence: {
        ...recommendationBase.evidence,
        decisionAgreement: 'ai_only',
        decisionSource: 'ai',
        decisionRequiresReview: true,
        quantReviewRequired: true,
        quantReasons: ['规则量化要求人工复核，不能直接进入执行。'],
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
          totalFileRecords: 1,
          realReportFileCount: 1,
          importedRowCount: 24,
          missingReportLabels: [],
        }],
        reportOptions: [],
        realReportFiles: [{ id: 'f1', displayName: '关键词报告', filePath: 'C:/reports/keyword.xlsx' }],
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
        notes: ['Coupon context should enter AI diagnosis.'],
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
        return [{ ...scopedRecommendation, status: 'pending' }];
      },
      generateRecommendations: async (params) => {
        window.__businessUiActionLog.push({ type: 'generateRecommendations', params });
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
                summary: 'Current performance is stable; no immediate bid or negative keyword action is safe.',
                mainProblems: [],
                riskWarnings: ['No safe action candidate.'],
                thresholdSuggestions: {
                  targetAcos: { value: 0.25, reason: 'Keep current target.' },
                  highAcosThreshold: { value: 0.5, reason: 'Keep current risk boundary.' },
                  noOrderClickThreshold: { value: 30, reason: 'Keep current click threshold.' },
                  minSpend: { value: 10, reason: 'Keep current minimum spend.' },
                },
                aiCandidateCount: 0,
                operationEventCount: 1,
                productContextCount: 1,
                decisionCounts: { total: 0, aligned: 0, ruleOnly: 0, aiOnly: 0, conflict: 0, reviewRequired: 0 },
                finalCandidateCount: 0,
                filteredAiOnlyCandidateCount: 0,
                filterReasons: ['规则和 AI 都没有返回可合并的候选动作。'],
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
              reason: '未配置 AI Key，建议解释使用规则引擎 fallback。',
              model: 'deepseek-chat',
              strategyDiagnosis: {
                source: 'rule',
                lifecycleStage: 'unknown',
                summary: '未配置 AI Key，广告阶段诊断使用规则 fallback。',
                mainProblems: [],
                riskWarnings: ['AI unavailable'],
                thresholdSuggestions: {
                  targetAcos: { value: 0.25, reason: 'Current rule configuration fallback.' },
                  highAcosThreshold: { value: 0.5, reason: 'Current rule configuration fallback.' },
                  noOrderClickThreshold: { value: 30, reason: 'Current rule configuration fallback.' },
                  minSpend: { value: 10, reason: 'Current rule configuration fallback.' },
                },
                aiCandidateCount: 0,
                operationEventCount: 1,
                productContextCount: 1,
                decisionCounts: { total: 1, aligned: 0, ruleOnly: 1, aiOnly: 0, conflict: 0, reviewRequired: 0 },
                finalCandidateCount: 1,
                filteredAiOnlyCandidateCount: 0,
                filterReasons: ['1 条规则-only 建议缺少 AI 确认，仍需按证据完整性审批。'],
                fallbackReason: '未配置 AI Key，广告阶段诊断使用规则 fallback',
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
              reason: '已尝试调用 AI，但本次没有可用 AI 输出，建议已回落到规则引擎。原因：AI provider timeout',
              model: 'deepseek-chat',
              strategyDiagnosis: {
                source: 'rule',
                lifecycleStage: 'unknown',
                summary: 'AI diagnosis unavailable; using deterministic rules only.',
                mainProblems: [],
                riskWarnings: ['AI provider timeout'],
                thresholdSuggestions: {
                  targetAcos: { value: 0.25, reason: 'Current rule configuration fallback.' },
                  highAcosThreshold: { value: 0.5, reason: 'Current rule configuration fallback.' },
                  noOrderClickThreshold: { value: 30, reason: 'Current rule configuration fallback.' },
                  minSpend: { value: 10, reason: 'Current rule configuration fallback.' },
                },
                aiCandidateCount: 0,
                operationEventCount: 1,
                productContextCount: 1,
                decisionCounts: { total: 1, aligned: 0, ruleOnly: 1, aiOnly: 0, conflict: 0, reviewRequired: 0 },
                finalCandidateCount: 1,
                filteredAiOnlyCandidateCount: 0,
                filterReasons: ['1 条规则-only 建议缺少 AI 确认，仍需按证据完整性审批。'],
                fallbackReason: 'AI provider timeout',
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
              summary: 'Coupon context keeps this product in keyword exploration while tightening no-order spend.',
              mainProblems: ['no_order_spend', 'high_acos'],
              riskWarnings: ['Keep approval and readback before any live operation.'],
              thresholdSuggestions: {
                targetAcos: { value: 0.35, reason: 'Exploration tolerance.' },
                highAcosThreshold: { value: 0.55, reason: 'Coupon context.' },
                noOrderClickThreshold: { value: 18, reason: 'Enough click data.' },
                minSpend: { value: 15, reason: 'Avoid small samples.' },
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
      openReportPath: async () => ({ success: true }),
    };
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.getByLabel('数据批次来源').selectOption('__manual__');
  await page.getByRole('textbox', { name: '数据批次', exact: true }).fill('manual_ad_execution_batch');
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('manual_ad_execution_batch'), null, { timeout: 5000 });
  await page.getByText('手动批次待校验', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText('待校验', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText('手动批次未自动校验：manual_ad_execution_batch', { exact: true }).waitFor({ timeout: 5000 });
  await expectInBody(page, '该批次不在当前范围自动匹配列表中，后续页面会按这个 ID 尝试读取；如不确定，请切回“自动”。', 'manual batch scope guidance');

  const routes = [
    ['优化建议', 'recommendations'],
    ['审批中心', 'approval'],
    ['执行回读', 'readback'],
  ];
  for (const [label, key] of routes) {
    await page.locator('.app-sidebar').getByRole('button', { name: new RegExp(label) }).click();
    await page.getByRole('heading', { name: label, level: 2 }).waitFor();
    await assertGlobalGuards(page, key);
    const screenshotPath = path.join(evidenceDir, `business-ui-ad-execution-${key}-${runId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    evidence.pages[key] = {
      label,
      screenshotPath,
      bodyTextSample: (await bodyText(page)).slice(0, 1800),
    };
  }

  await page.locator('.app-sidebar').getByRole('button', { name: /优化建议/ }).click();
  await expectVisible(page, '建议处理路径');
  await expectVisible(page, '1. 生成解释');
  await expectVisible(page, '2. 审批决策');
  await expectVisible(page, '3. 执行回读');
  await expectVisible(page, '本页不审批、不执行广告、不写入 Amazon；真实动作必须在审批后逐条记录截图和回读证据。');
  await expectVisible(page, '建议上下文检查');
  await expectVisible(page, 'AI 可用');
  await expectVisible(page, 'deepseek-chat');
  await expectInBody(page, '生成建议时会调用 AI 参与产品阶段诊断、动态阈值建议和动作解释。', 'recommendation ai readiness');
  await expectVisible(page, '真实广告事实');
  await expectVisible(page, '1 个表格 / 24 行 DB 指标');
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
  await expectVisible(page, '只生成待审批建议');
  for (const text of [
    'AI + 规则并行决策模型',
    '硬阈值与安全边界',
    'AI 可用',
    '规则和 AI 一致才进入普通审批；冲突、AI-only 和样本不足进入人工复核。',
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
  await expectInBody(page, '1 条 AI 策略诊断，1 条 AI 文本解释，0 条纯规则 fallback。', 'ai strategy/text split');
  await expectVisible(page, 'AI参与 1');
  await expectVisible(page, 'AI解释 1');
  await expectVisible(page, '1 浪费 / 0 需复核');
  await expectVisible(page, 'manual_ad_execution_batch');
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
  await expectVisible(page, '生成优化建议');
  await page.getByRole('button', { name: '生成优化建议', exact: true }).click();
  await page.getByText('已生成 1 条新建议，规则候选 1 条，AI 候选 1 条，最终可审批动作 1 条，处理 24 行广告指标。', { exact: false }).waitFor({ timeout: 5000 });
  await page.getByText('AI 已参与广告阶段诊断、动态阈值建议和 1/1 条规则候选解释。', { exact: false }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, '本次生成 AI 参与状态');
  await expectVisible(page, 'AI 已参与');
  await expectVisible(page, '1 新建议 / 1 可审批动作');
  await expectInBody(page, '规则候选 1 条，AI 候选 1 条，跳过 0 条重复建议。', 'candidate source split');
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
  await expectVisible(page, '一致 1 / 规则-only 0 / AI-only 0 / 冲突 0 / 需复核 0');
  await expectVisible(page, '本次没有返回额外过滤原因。');
  await expectVisible(page, '来自当前保存的 DeepSeek/OpenAI Compatible 设置。');
  await page.evaluate(() => {
    window.__mockAiConfigured = false;
  });
  await page.getByRole('button', { name: '生成优化建议', exact: true }).click();
  await page.getByText('未配置 AI Key，建议解释使用规则引擎 fallback。', { exact: false }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, '未配置 AI Key');
  await expectVisible(page, '0 AI 建议解释 / 1 规则解释');
  await expectVisible(page, '未配置 Key 时不会伪装成 AI 策略。');
  await expectVisible(page, '一致 0 / 规则-only 1 / AI-only 0 / 冲突 0 / 需复核 0');
  await expectVisible(page, '1 条规则-only 建议缺少 AI 确认，仍需按证据完整性审批。');
  await page.evaluate(() => {
    window.__mockAiConfigured = true;
    window.__mockAiNoOutput = true;
  });
  await page.getByRole('button', { name: '生成优化建议', exact: true }).click();
  await page.getByText('已尝试调用 AI，但本次没有可用 AI 输出，建议已回落到规则引擎。原因：AI provider timeout', { exact: false }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, 'AI 无可用输出');
  await expectVisible(page, '0 AI 建议解释 / 1 规则解释');
  await expectVisible(page, '一致 0 / 规则-only 1 / AI-only 0 / 冲突 0 / 需复核 0');
  await expectVisible(page, '查看详情');
  await expectVisible(page, 'DeepSeek AI');
  await page.getByRole('button', { name: '查看详情' }).first().click();
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
  await expectVisible(page, 'Coupon context keeps this product in keyword exploration while tightening no-order spend.');
  await expectVisible(page, 'Rule: High ACOS with spend.');
  await expectVisible(page, 'AI: Coupon did not convert enough traffic.');
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
  await page.getByText('当前范围还没有待审批建议。', { exact: true }).waitFor({ timeout: 5000 });
  await expectVisible(page, '为什么现在没有建议');
  await expectVisible(page, '待审批列表为空');
  await expectVisible(page, '本次生成可能已经完成但当前筛选状态没有 pending 建议，或建议已被处理。');
  await expectNotInBody(page, 'C:/reports/source_user_search_term.xlsx');
  await page.evaluate(() => {
    window.__mockNoRecommendationCandidates = true;
  });
  await page.getByRole('button', { name: '生成优化建议', exact: true }).click();
  await page.getByText('已生成 0 条新建议，规则候选 0 条，AI 候选 0 条，最终可审批动作 0 条，处理 24 行广告指标。', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, 'AI 已参与诊断');
  await expectVisible(page, '0 新建议 / 0 可审批动作');
  await expectVisible(page, '一致 0 / 规则-only 0 / AI-only 0 / 冲突 0 / 需复核 0');
  await expectVisible(page, '规则和 AI 都没有返回可合并的候选动作。');
  await expectVisible(page, '没有可安全绑定的广告动作');
  await expectVisible(page, 'AI 已运行广告阶段诊断，但没有找到可安全绑定到当前真实指标的可审批动作。');
  await expectInBody(page, 'AI 没有返回可审批动作候选。', 'no-candidate AI action explanation');
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
  const blockedGenerateDisabled = await page.getByRole('button', { name: '重新生成优化建议', exact: true }).isDisabled();
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

  await page.locator('.app-sidebar').getByRole('button', { name: /审批中心/ }).click();
  await expectVisible(page, '审批安全边界');
  await expectVisible(page, '仅审批，不执行');
  await expectVisible(page, '审批处理要求');
  await expectVisible(page, '批准后下一步');
  await expectVisible(page, '在执行回读页补录审批凭证、before/after 截图、回读值和现场行证明。');
  await page.getByRole('button', { name: 'AI 复核' }).click();
  await expectInBody(page, 'AI-only 建议不能直接批准');
  await expectInBody(page, '规则量化要求人工复核');
  await page.getByRole('button', { name: '处理' }).first().click();
  await expectInBody(page, '这条建议不能走普通批准');
  await page.getByRole('button', { name: '批准并进入待执行' }).evaluate((node) => {
    if (!node.disabled) throw new Error('Blocked review recommendation approve button was not disabled');
  });
  await page.getByRole('button', { name: '待审批' }).click();
  await expectVisible(page, '广告组合');
  await expectVisible(page, 'ASIN');
  await expectVisible(page, 'D6 Portfolio');
  await expectVisible(page, 'B0TESTASIN');
  await page.getByRole('button', { name: '处理' }).first().click();
  await expectVisible(page, '审批人、备注、范围和数据批次会写入建议证据；真实 Ads UI 操作和审批凭证路径仍必须在“执行回读”页逐条补齐。');
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
  await expectVisible(page, 'Rule: High ACOS with spend.');
  await expectVisible(page, 'AI: Coupon did not convert enough traffic.');
  await expectVisible(page, 'AI 主要问题：no_order_spend；high_acos');
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

  await page.locator('.app-sidebar').getByRole('button', { name: /执行回读/ }).click();
  await expectVisible(page, '1. 选择已批准动作');
  await expectVisible(page, '2. 执行目标与来源');
  await expectVisible(page, '3. 审批、执行与回读证据');
  await expectVisible(page, '4. 回读预检与导出');
  await expectVisible(page, '广告组合');
  await expectVisible(page, 'ASIN');
  await expectVisible(page, '对象类型');
  await expectVisible(page, 'D6 Portfolio');
  await expectVisible(page, 'B0TESTASIN');
  await expectVisible(page, 'target');
  await expectVisible(page, '导出缺口草稿');
  await expectVisible(page, '缺项状态下只能导出本地草稿，方便定位缺口；不能作为最终执行完成证据。');
  await expectNotInBody(page, 'pnpm run verify:ad-readback');
  await expectNotInBody(page, 'create:ad-readback-template');
  await page.getByRole('button', { name: '载入' }).first().click();
  await expectVisible(page, '来源批次');
  await expectVisible(page, '指标日期');
  await expectVisible(page, '当前有效批次：manual_ad_execution_batch');
  await expectVisible(page, '来源批次匹配');
  await expectVisible(page, '来源批次、指标日期、来源文件、来源当前值和建议值是回读证据的一部分；缺失或串批次时只能导出缺口草稿。');
  await expectVisible(page, '产品阶段');
  await expectVisible(page, 'keyword_exploration');
  await expectVisible(page, 'AI 与规则关系');
  await expectVisible(page, 'aligned / rule_ai');
  await expectVisible(page, '量化阈值');
  await expectVisible(page, 'ACOS 25.0% / 高 ACOS 50.0%');
  await page.getByRole('textbox', { name: '审批人', exact: true }).evaluate((node) => {
    if (node.value !== 'QA Approver') throw new Error(`Unexpected carried approver: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '审批备注', exact: true }).evaluate((node) => {
    if (node.value !== 'Approved for smoke scope only.') throw new Error(`Unexpected carried approval note: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '审批时间', exact: true }).evaluate((node) => {
    if (!String(node.value || '').includes('T')) throw new Error(`Approval time was not carried into readback: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '来源批次', exact: true }).evaluate((node) => {
    if (node.value !== 'manual_ad_execution_batch') throw new Error(`Unexpected source batch: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '指标日期', exact: true }).evaluate((node) => {
    if (node.value !== '2026-06-12') throw new Error(`Unexpected metric date: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '推荐来源文件', exact: true }).evaluate((node) => {
    if (!node.value.includes('C:/reports/source_user_search_term.xlsx')) throw new Error(`Unexpected source files: ${node.value}`);
  });
  await page.getByRole('textbox', { name: '来源批次', exact: true }).fill('stale_ad_execution_batch');
  await expectVisible(page, '来源批次不一致');
  await expectVisible(page, '来源批次必须等于当前批次');
  await expectVisible(page, '导出缺口草稿');
  await page.getByRole('textbox', { name: '来源批次', exact: true }).fill('manual_ad_execution_batch');
  await expectVisible(page, '来源批次匹配');
  await page.getByRole('textbox', { name: '审批人', exact: true }).fill('QA Approver');
  await page.getByRole('textbox', { name: '审批凭证', exact: true }).fill('C:/evidence/approval.png');
  await page.getByRole('textbox', { name: '审批时间', exact: true }).fill('2026-06-12T10:00:00.000Z');
  await page.getByRole('textbox', { name: '执行人', exact: true }).fill('QA Operator');
  await page.getByRole('textbox', { name: '执行编号', exact: true }).fill('manual-smoke-001');
  await page.getByRole('textbox', { name: '执行时间', exact: true }).fill('2026-06-12T10:05:00.000Z');
  await page.getByRole('textbox', { name: 'Before 值', exact: true }).fill('1.20');
  await page.getByRole('textbox', { name: 'Before 截图', exact: true }).fill('C:/evidence/before.png');
  await page.getByRole('textbox', { name: 'Before 时间', exact: true }).fill('2026-06-12T10:03:00.000Z');
  await page.getByRole('textbox', { name: 'After 值', exact: true }).fill('1.08');
  await page.getByRole('textbox', { name: 'After 截图', exact: true }).fill('C:/evidence/after.png');
  await page.getByRole('textbox', { name: 'After 时间', exact: true }).fill('2026-06-12T10:06:00.000Z');
  await page.getByRole('textbox', { name: '回读值', exact: true }).fill('1.08');
  await page.getByRole('textbox', { name: '回读证据', exact: true }).fill('C:/evidence/readback.png');
  await page.getByRole('textbox', { name: '回读时间', exact: true }).fill('2026-06-12T10:10:00.000Z');
  await page.getByRole('textbox', { name: '现场行证明', exact: true }).fill('Ads UI row reloaded and target bid stayed at 1.08.');
  for (const label of ['审批人确认范围', '外部审批允许', '低风险策略允许', '执行成功确认', '执行已核验', '回读已核验']) {
  await page.getByLabel(label).check();
  }
  await expectVisible(page, '字段完整时导出的 JSON/Markdown 可交给最终验收 verifier 复核。');
  await page.getByRole('button', { name: '导出读回证据' }).click();
  await page.getByText('导出状态', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('可进入最终验收', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('C:/evidence/readback.json', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('C:/evidence/readback.md', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('该导出只写入本地证据文件，不会提交 Amazon。', { exact: false }).waitFor({ timeout: 5000 });
  const afterExportScreenshotPath = path.join(evidenceDir, `business-ui-ad-execution-readback-after-export-${runId}.png`);
  await page.screenshot({ path: afterExportScreenshotPath, fullPage: true });
  evidence.pages.readbackAfterExport = {
    label: '执行回读导出结果',
    screenshotPath: afterExportScreenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 1800),
  };
  await page.getByRole('textbox', { name: 'After 值', exact: true }).fill('1.07');
  await expectNotInBody(page, 'C:/evidence/readback.json');
  await expectNotInBody(page, 'C:/evidence/readback.md');

  const actionLog = await page.evaluate(() => window.__businessUiActionLog || []);
  evidence.actionLog = actionLog;
  const pendingRecommendationCalls = actionLog.filter((item) => item.type === 'getRecommendations' && item.filter?.status === 'pending');
  if (!pendingRecommendationCalls.length) {
    fail('Pending recommendations IPC mock was not called', JSON.stringify(actionLog));
  }
  const scopedPendingRecommendationCalls = pendingRecommendationCalls.filter((call) => call.filter?.batchId === 'manual_ad_execution_batch');
  if (!scopedPendingRecommendationCalls.length) {
    fail('No pending recommendations IPC call used the manual execution batch scope', JSON.stringify(pendingRecommendationCalls));
  }
  for (const call of scopedPendingRecommendationCalls) assertScopeParams(call.filter, 'getRecommendations');
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
    || !approvalCall.input?.decision?.decisionReasons?.includes('AI: Coupon did not convert enough traffic.')
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
  if (readbackExport.input?.source?.batchId !== 'manual_ad_execution_batch'
    || readbackExport.input?.source?.metricDate !== '2026-06-12'
    || readbackExport.input?.source?.entityType !== 'target'
    || readbackExport.input?.source?.aiModel !== 'deepseek-chat'
    || readbackExport.input?.source?.decisionAgreement !== 'aligned'
    || readbackExport.input?.source?.decisionSource !== 'rule_ai'
    || !readbackExport.input?.source?.decisionReasons?.includes('AI: Coupon did not convert enough traffic.')
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
