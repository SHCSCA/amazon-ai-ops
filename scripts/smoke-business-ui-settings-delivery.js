const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('./playwright-loader');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

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
      resolve({ url: `http://127.0.0.1:${address.port}/index.html`, close: () => server.close() });
    });
  });
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function expectVisible(page, text) {
  try {
    await page.getByText(text, { exact: true }).first().waitFor({ timeout: 5000 });
  } catch (error) {
    const textContent = await bodyText(page).catch(() => '');
    fail(`Expected visible text missing: ${text}`, JSON.stringify({
      bodyIncludesText: textContent.includes(text),
      bodySample: textContent.slice(0, 1800),
      originalError: error instanceof Error ? error.message : String(error),
    }, null, 2));
  }
}

async function expectInBody(page, text, key) {
  const textContent = await bodyText(page);
  if (!textContent.includes(text)) fail(`Expected body text missing: ${text}`, key);
}

async function screenshotScrollableContent(page, screenshotPath) {
  await page.evaluate(() => {
    const shell = document.querySelector('.app-shell');
    const body = document.querySelector('.app-body');
    const content = document.querySelector('.app-content');
    for (const element of [shell, body, content]) {
      if (!(element instanceof HTMLElement)) continue;
      element.dataset.smokeOldStyle = element.getAttribute('style') || '';
    }
    if (shell instanceof HTMLElement) shell.style.height = 'auto';
    if (body instanceof HTMLElement) body.style.alignItems = 'stretch';
    if (content instanceof HTMLElement) {
      content.scrollTo({ top: 0, left: 0 });
      content.style.height = `${content.scrollHeight}px`;
      content.style.overflow = 'visible';
    }
  });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('[data-smoke-old-style]')) {
      if (!(element instanceof HTMLElement)) continue;
      const oldStyle = element.dataset.smokeOldStyle || '';
      if (oldStyle) element.setAttribute('style', oldStyle);
      else element.removeAttribute('style');
      delete element.dataset.smokeOldStyle;
    }
  });
}

async function assertAbsent(page, text, key) {
  const textContent = await bodyText(page);
  if (textContent.includes(text)) fail(`Unexpected visible text: ${text}`, key);
}

async function assertGlobalGuards(page, key, options = {}) {
  const forbiddenTexts = ['v1.5 工作台', 'pnpm run verify:ad-readback', 'pnpm run verify:ai-live', '查看技术命令', '¥', '￥', 'RMB', 'CNY', '人民币'];
  if (!options.allowRawStatus) forbiddenTexts.push('APP_READY', 'APP_NEEDS_WORK');
  for (const forbiddenText of forbiddenTexts) {
    await assertAbsent(page, forbiddenText, key);
  }
}

async function main() {
  if (!fs.existsSync(rendererIndex)) {
    fail('Renderer build not found. Run pnpm --filter @amazon-ai-ops/desktop run build:renderer first', rendererIndex);
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const evidence = { generatedAt: new Date().toISOString(), rendererIndex, pages: {}, consoleErrors: [], actionLog: [] };

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
    const pipeline = {
      scope: {
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        currency: 'USD',
        batchId: 'mock_delivery_batch',
      },
      generatedAt: '2026-06-12T10:00:00.000Z',
      collection: {
        status: 'partial',
        latestBatch: {
          id: 'mock_delivery_batch',
          status: 'partial',
          dateStart: '2026-06-01',
          dateEnd: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          downloadDir: 'C:/evidence/reports',
          manifestPath: 'C:/wrong/lingxing-batch-manifest.json',
        },
        sourceBatchIds: ['mock_delivery_batch'],
        availableBatches: [{
          id: 'mock_delivery_batch',
          status: 'completed_with_errors',
          dateStart: '2026-06-01',
          dateEnd: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          downloadDir: 'C:/evidence/reports',
          manifestPath: 'C:/wrong/lingxing-batch-manifest.json',
          createdAt: '2026-06-12T09:30:00.000Z',
          completedAt: '2026-06-12T09:55:00.000Z',
          totalFileRecords: 3,
          realReportFileCount: 1,
          importedRowCount: 18,
          missingReportLabels: ['关键词报告', '用户搜索词报告'],
        }],
        reportOptions: [
          { type: 'campaign', label: '广告活动报告', status: 'ready', realFileAvailable: true, importedRows: 18 },
          { type: 'keyword', label: '关键词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
          { type: 'user_search_term', label: '用户搜索词报告', status: 'missing', realFileAvailable: false, importedRows: 0 },
        ],
        realReportFiles: [
          {
            id: 'campaign-file',
            reportType: 'campaign',
            displayName: '广告活动报告',
            status: 'downloaded',
            filePath: 'C:/evidence/reports/campaign.xlsx',
            folderPath: 'C:/evidence/reports',
            fileName: 'campaign.xlsx',
            fileSizeBytes: 2048,
            importedRows: 18,
            updatedAt: '2026-06-12T09:55:00.000Z',
          },
        ],
        evidencePaths: [
          { label: '报表目录', path: 'C:/evidence/reports', kind: 'folder' },
          { label: 'final readiness', path: 'output/codex-evidence/final-readiness-2026-06-12.json', kind: 'audit' },
        ],
        fileAudit: {
          totalFileRecords: 3,
          downloadedFileRecords: 1,
          existingFileRecords: 3,
          realReportFileCount: 1,
          importedRowCount: 18,
          rejectedEvidenceFileCount: 2,
          missingReportLabels: ['关键词报告', '用户搜索词报告'],
          downloadDir: 'C:/evidence/reports',
          manifestPath: 'C:/wrong/lingxing-batch-manifest.json',
        },
        blockers: ['缺少关键词报告和用户搜索词报告。'],
        audit: {
          databaseReady: true,
          acceptedExtensions: ['.xlsx', '.xls', '.csv'],
          rejectedEvidenceExtensions: ['.json', '.png', '.html'],
          notes: ['mock smoke delivery state'],
        },
      },
      quant: {
        hasImportedMetrics: true,
        importedRows: 12,
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
        diagnostics: [
          {
            portfolioName: 'D6 Portfolio',
            campaignName: 'D6-auto-test',
            adGroupName: 'D6-ad-group',
            asin: 'B0TESTASIN',
            objectType: 'keyword',
            objectName: 'motion sensor wall light',
            spend: 25.5,
            sales: 98.25,
            orders: 4,
            clicks: 36,
            acos: 0.2595,
            cvr: 0.111,
            cpc: 0.71,
            diagnosis: '可量化但未形成最终审批回读。',
            suggestedDirection: '进入人工审批和只读回读链路。',
          },
        ],
        blockers: ['缺少真实广告回读聚合证据。'],
      },
    };

    const failedReadiness = {
      available: true,
      path: 'C:/final/final-readiness-needs-work.json',
      exists: true,
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: true,
      generatedAt: '2026-06-12T10:10:00.000Z',
      checkedAt: '2026-06-12T10:11:00.000Z',
      gatesSummary: { total: 2, passed: 1, failed: 1 },
      missing: ['缺少真实广告回读聚合证据。'],
      actionItems: ['补齐真实广告回读后重新运行最终验收。'],
      gates: [
        { name: 'report_collection', ok: true, status: 'passed', message: '报表已进入候选证据。', evidencePath: 'C:/evidence/reports/campaign.xlsx' },
        { name: 'ad_readback', ok: false, status: 'blocked', message: '缺少真实广告回读聚合证据。', evidencePath: 'C:/final/readback-missing.json' },
      ],
    };
    const missingReadiness = {
      available: false,
      path: null,
      exists: false,
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: false,
      generatedAt: undefined,
      checkedAt: undefined,
      gatesSummary: { total: 0, passed: 0, failed: 0 },
      missing: ['最终验收汇总尚未生成'],
      actionItems: ['运行最终验收，生成 output/codex-evidence/final-readiness-*.json。'],
      gates: [],
      message: '最终验收汇总尚未生成',
    };
    const fakeReadyReadiness = {
      available: true,
      path: 'C:/final/final-readiness-fake-ready.json',
      exists: true,
      status: 'APP_READY',
      appReady: false,
      manifestDriven: true,
      generatedAt: '2026-06-12T10:13:00.000Z',
      checkedAt: '2026-06-12T10:14:00.000Z',
      gatesSummary: { total: 1, passed: 1, failed: 0 },
      missing: ['最终验收未通过，不能声明可交付。'],
      actionItems: ['重新运行最终验收，确认 appReady=true。'],
      gates: [
        { name: 'status_consistency', ok: true, status: 'passed', message: '状态字段被故意设置为可交付，但最终验收未通过。' },
      ],
    };
    const nonManifestReadyReadiness = {
      available: true,
      path: 'C:/final/final-readiness-non-manifest.json',
      exists: true,
      status: 'APP_READY',
      appReady: true,
      manifestDriven: false,
      generatedAt: '2026-06-12T10:14:30.000Z',
      checkedAt: '2026-06-12T10:14:45.000Z',
      gatesSummary: { total: 1, passed: 1, failed: 0 },
      missing: ['最终验收汇总不是本次验收来源，不能声明可交付。'],
      actionItems: ['重新生成最终验收汇总，并用该汇总运行最终验收。'],
      gates: [
        { name: 'manifest_mode', ok: false, status: 'blocked', message: '最终验收汇总不是本次验收来源，不能声明可交付。' },
      ],
    };
    const passedReadiness = {
      available: true,
      path: 'C:/final/final-readiness-ready.json',
      exists: true,
      status: 'APP_READY',
      appReady: true,
      manifestDriven: true,
      generatedAt: '2026-06-12T10:15:00.000Z',
      checkedAt: '2026-06-12T10:16:00.000Z',
      gatesSummary: { total: 2, passed: 2, failed: 0 },
      missing: [],
      actionItems: [],
      gates: [
        { name: 'report_collection', ok: true, status: 'passed', message: '真实报表验收通过。', evidencePath: 'C:/evidence/reports/campaign.xlsx' },
        { name: 'ad_readback', ok: true, status: 'passed', message: '真实广告回读验收通过。', evidencePath: 'C:/final/readback-pass.json' },
      ],
    };

    window.__businessUiActionLog = [];
    window.__deliveryReadinessMode = 'fail';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__businessUiActionLog.push({ type: 'clipboard', text: String(text || '') });
        },
      },
    });
    window.__mockSettings = {
      aiApiKey: '',
      aiKeyConfigured: true,
      aiBaseUrl: 'https://api.deepseek.com',
      aiModel: 'deepseek-v4-flash',
      aiTemperature: '0.3',
      aiMaxTokens: '700',
      aiLastTestStatus: '',
      aiLastTestAt: '',
      aiLastTestBaseUrl: '',
      aiLastTestModel: '',
      aiLastTestMessage: '',
    };
    window.electronAPI = {
      getState: async () => ({
        isLoggedIn: true,
        currentStore: 'FT-US-US',
        loginSession: { erpSessionReused: true, adsTitle: 'Amazon AI Ops' },
      }),
      browserLogout: async () => ({ success: true }),
      getBusinessUiDataPipeline: async (scope) => {
        window.__businessUiActionLog.push({ type: 'getBusinessUiDataPipeline', scope });
        return {
          ...pipeline,
          scope: { ...pipeline.scope, ...(scope || {}), currency: 'USD' },
        };
      },
      getBusinessBatchOptions: async () => pipeline.collection.availableBatches,
      getDeliveryEvidenceStatus: async (scope) => {
        window.__businessUiActionLog.push({ type: 'getDeliveryEvidenceStatus', scope });
        return {
          listing: {
            readReady: true,
            draftReady: true,
            contentCount: 1,
            fullContentCount: 1,
            draftCount: 2,
            aiDraftCount: 1,
            ruleFallbackDraftCount: 1,
            latestAsin: 'B0TESTASIN',
            latestUpdatedAt: '2026-06-12T10:10:00.000Z',
          },
          readback: window.__deliveryReadinessMode === 'pass'
            ? {
              verifiedCount: 1,
              latestStatus: 'PASS',
              latestJsonPath: 'C:/final/readback-pass.json',
              latestUpdatedAt: '2026-06-12T10:16:00.000Z',
            }
            : {
              verifiedCount: 0,
              latestStatus: 'NEEDS_WORK',
              latestJsonPath: 'C:/final/readback-missing.json',
              latestUpdatedAt: '2026-06-12T10:11:00.000Z',
            },
        };
      },
      getSettings: async () => ({ ...window.__mockSettings, aiApiKey: '' }),
      listAiDiagnosisRuns: async (params) => {
        window.__businessUiActionLog.push({ type: 'listAiDiagnosisRuns', params });
        return [{
          id: 801,
          promptKey: 'ad_strategy_diagnosis',
          promptVersion: 'ad_strategy_diagnosis_v1',
          model: 'deepseek-v4-flash',
          scope: params || {},
          evidencePackSummary: { total: 4, metric: 1, operationEvent: 1, productContext: 1, ruleCandidate: 1 },
          diagnosis: { source: 'ai', lifecycleStage: 'keyword_exploration', summary: '测试阶段诊断已脱敏。' },
          insights: [{ entityType: 'search_term', entityName: 'delivery smoke insight', actionType: 'observe' }],
          formalRecommendationCount: 1,
          success: true,
          createdAt: '2026-06-15T06:03:00.000Z',
        }];
      },
      listAiCallLogs: async (params) => {
        window.__businessUiActionLog.push({ type: 'listAiCallLogs', params });
        return [{
          id: 501,
          promptKey: 'ad_strategy_diagnosis',
          promptVersion: 'ad_strategy_diagnosis_v1',
          model: 'deepseek-v4-flash',
          inputHash: 'hash_ai_audit_1',
          schemaVersion: 'ad_strategy_diagnosis_v1',
          evidencePackSummary: { total: 4, metric: 1, operationEvent: 1, productContext: 1, ruleCandidate: 1 },
          outputJson: '{"schemaVersion":"ad_strategy_diagnosis_v1","evidencePackSummary":{"total":4},"output":{"summary":"已脱敏"}}',
          success: true,
          createdAt: '2026-06-15T06:01:00.000Z',
        }, {
          id: 502,
          promptKey: 'listing_rewrite',
          promptVersion: 'listing_rewrite_v1',
          model: 'deepseek-v4-flash',
          inputHash: 'hash_ai_audit_2',
          schemaVersion: 'listing_rewrite_v1',
          evidencePackSummary: { total: 1, listingDraft: 1, keywordCount: 2 },
          outputJson: '{"output":{"summary":"sk-***REDACTED***"}}',
          success: false,
          errorMessage: 'AI response was not valid JSON',
          createdAt: '2026-06-15T06:02:00.000Z',
        }];
      },
      getRuleConfig: async () => ({
        targetAcos: 0.25,
        highAcosThreshold: 0.4,
        noOrderClickThreshold: 30,
        minSpend: 10,
        bidAdjustPercent: 0.1,
        maxBidDecrement: 0.2,
        maxCpc: 5,
        minCpc: 0.02,
        enableAutoLowerBid: false,
        enableAutoAddNegative: false,
        brandWordWhitelist: ['brand'],
        coreWordWhitelist: ['core'],
      }),
      getRecommendations: async (filter) => {
        window.__businessUiActionLog.push({ type: 'getRecommendations', filter });
        if (filter?.status === 'pending') {
          return [{
            id: 9101,
            actionType: 'lower_bid',
            entityType: 'keyword',
            entityName: 'motion sensor wall light',
            currentValue: '1.50',
            recommendedValue: '1.35',
            reason: 'AI+规则建议测试数据。',
            acos: 0.413,
            clicks: 36,
            cost: 25.5,
            riskLevel: 'medium',
            status: 'pending',
            confidence: 0.72,
            evidence: { explanationSource: 'ai', aiEvidenceRefs: ['metric:delivery:keyword:1'] },
          }];
        }
        if (filter?.status === 'approved') {
          return [{
            id: 9102,
            actionType: 'lower_bid',
            entityType: 'keyword',
            entityName: 'approved delivery smoke keyword',
            currentValue: '1.70',
            recommendedValue: '1.50',
            reason: '已审批测试数据。',
            acos: 0.39,
            clicks: 42,
            cost: 30.2,
            riskLevel: 'medium',
            status: 'approved',
            confidence: 0.75,
            evidence: { explanationSource: 'ai', aiEvidenceRefs: ['metric:delivery:keyword:2'] },
          }];
        }
        if (filter?.status === 'needs_review') {
          return [{
            id: 9103,
            actionType: 'lower_bid',
            entityType: 'keyword',
            entityName: 'review delivery smoke keyword',
            currentValue: '1.80',
            recommendedValue: '1.65',
            reason: 'AI 阶段判断需要人工复核。',
            acos: 0.52,
            clicks: 48,
            cost: 42.8,
            riskLevel: 'APPROVAL',
            status: 'needs_review',
            confidence: 0.68,
            evidence: {
              explanationSource: 'ai',
              aiStrategySource: 'ai',
              aiLifecycleStageRequiresReview: true,
              aiLifecycleStageInvalidReasons: ['AI 阶段判断缺少有效可回查证据。'],
              aiEvidenceRefs: ['metric:delivery:keyword:3'],
            },
          }];
        }
        return [];
      },
      saveSettings: async (settings) => {
        window.__businessUiActionLog.push({ type: 'saveSettings', settings });
        if (settings.clearAiKey) {
          window.__mockSettings = {
            ...window.__mockSettings,
            ...settings,
            aiApiKey: '',
            aiKeyConfigured: false,
            aiLastTestStatus: '',
            aiLastTestAt: '',
            aiLastTestBaseUrl: '',
            aiLastTestModel: '',
            aiLastTestMessage: '',
          };
          return { success: true };
        }
        window.__mockSettings = {
          ...window.__mockSettings,
          ...settings,
          aiApiKey: settings.aiApiKey || window.__mockSettings.aiApiKey,
          aiKeyConfigured: true,
        };
        return { success: true };
      },
      saveRuleConfig: async (config) => {
        window.__businessUiActionLog.push({ type: 'saveRuleConfig', config });
        return { success: true };
      },
      testAiSettings: async () => {
        window.__mockSettings = {
          ...window.__mockSettings,
          aiLastTestStatus: 'available',
          aiLastTestAt: '2026-06-15T06:00:00.000Z',
          aiLastTestBaseUrl: window.__mockSettings.aiBaseUrl,
          aiLastTestModel: window.__mockSettings.aiModel,
          aiLastTestMessage: `AI 连接测试通过：${window.__mockSettings.aiModel}`,
        };
        return { success: true, message: `AI 连接测试通过：${window.__mockSettings.aiModel}` };
      },
      getStoragePaths: async () => ({
        settingsPath: 'C:/Users/wz/AppData/Roaming/Amazon AI Ops/settings.json',
        evidenceDir: 'C:/Users/wz/Desktop/py/amazon-ai-ops/output/codex-evidence',
        downloadsDir: 'C:/Users/wz/AppData/Roaming/Amazon AI Ops/storage/downloads',
        exportsDir: 'C:/Users/wz/AppData/Roaming/Amazon AI Ops/storage/exports',
        deliveryDir: 'C:/Users/wz/AppData/Roaming/Amazon AI Ops/storage/exports/delivery-bundles',
        localDbPath: 'C:/Users/wz/AppData/Roaming/Amazon AI Ops/amazon-ai-ops.db',
      }),
      getDeliveryReadiness: async () => {
        if (window.__deliveryReadinessMode === 'pass') return passedReadiness;
        if (window.__deliveryReadinessMode === 'missing') return missingReadiness;
        if (window.__deliveryReadinessMode === 'fake-ready') return fakeReadyReadiness;
        if (window.__deliveryReadinessMode === 'non-manifest-ready') return nonManifestReadyReadiness;
        return failedReadiness;
      },
      refreshFinalReadiness: async (input) => {
        const readiness = input?.adReadbackPath
          ? {
            ...passedReadiness,
            path: 'C:/final/final-readiness-with-readback-pass.json',
            generatedAt: '2026-06-12T10:21:00.000Z',
            checkedAt: '2026-06-12T10:21:00.000Z',
          }
          : {
            ...failedReadiness,
            path: 'C:/final/final-readiness-refreshed.json',
            generatedAt: '2026-06-12T10:20:00.000Z',
            checkedAt: '2026-06-12T10:20:00.000Z',
          };
        const result = {
          success: true,
          evidenceManifestPath: input?.adReadbackPath
            ? 'C:/final/v15-final-readiness-evidence-manifest-with-readback-pass.json'
            : 'C:/final/v15-final-readiness-evidence-manifest-refreshed.json',
          finalReadinessPath: readiness.path,
          readiness,
        };
        window.__businessUiActionLog.push({ type: 'refreshFinalReadiness', input, result });
        return result;
      },
      prepareAdReadbackSession: async (input) => {
        const result = {
          sessionDir: 'C:/final/readback-missing-session',
          sourceCandidatePath: input?.sourcePath || '',
          passEvidencePath: 'C:/final/readback-missing-session/real-ad-execution-readback-pass.json',
          checklistPath: 'C:/final/readback-missing-session/operator-checklist.md',
          locatorGuidePath: 'C:/final/readback-missing-session/ads-ui-locator.md',
          sessionInputPath: 'C:/final/readback-missing-session/session-input.json',
          sessionInputGuidePath: 'C:/final/readback-missing-session/session-input-guide.md',
        };
        window.__businessUiActionLog.push({ type: 'prepareAdReadbackSession', input, result });
        return result;
      },
      verifyAdReadbackSession: async (input) => {
        const result = {
          sessionDir: input?.sessionDir || '',
          ready: true,
          captureReady: false,
          checks: [
            { label: 'session folder exists', passed: true, details: input?.sessionDir || '' },
            { label: 'session input exists', passed: true, details: 'session-input.json' },
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
          sessionDir: input?.sessionDir || '',
          jsonPath: 'C:/final/readback-missing-session/real-ad-execution-readback-pass.json',
          markdownPath: 'C:/final/readback-missing-session/real-ad-execution-readback-pass.md',
          status: 'PASS',
          readyForVerifier: true,
          issues: [],
        };
        window.__businessUiActionLog.push({ type: 'fillAdReadbackSession', input, result });
        return result;
      },
      verifyAdReadbackEvidence: async (input) => {
        const result = {
          status: 'PASS',
          ok: true,
          verified: true,
          issues: [],
          checks: [{ label: 'readback evidence passed', passed: true, details: input?.evidencePath || '' }],
        };
        window.__businessUiActionLog.push({ type: 'verifyAdReadbackEvidence', input, result });
        return result;
      },
      exportDeliveryBundle: async (scope) => {
        const result = window.__deliveryReadinessMode === 'pass'
          ? {
            success: true,
            bundleDir: 'C:/exports/delivery/v15-ready-bundle',
            manifestPath: 'C:/exports/delivery/v15-ready-bundle/delivery-bundle-manifest.json',
            status: 'APP_READY',
            dataReconciliation: {
              jsonPath: 'C:/exports/delivery/v15-ready-bundle/data-reconciliation.json',
              markdownPath: 'C:/exports/delivery/v15-ready-bundle/data-reconciliation.md',
              canonicalSource: 'canonical_user_search_term',
              canonical: {
                rows: 18,
                spend: 170.25,
                orders: 3,
                sales: 240.5,
                clicks: 120,
                impressions: 8000,
                currency: 'USD',
              },
              blockers: [],
            },
          }
          : { success: false, status: 'APP_NEEDS_WORK', message: '最终验收汇总未通过，不能导出可交付包。' };
        window.__businessUiActionLog.push({ type: 'exportDeliveryBundle', scope, result });
        return result;
      },
      exportDataReconciliation: async (scope) => {
        const result = {
          success: true,
          jsonPath: 'C:/exports/data-reconciliation/mock-delivery.json',
          markdownPath: 'C:/exports/data-reconciliation/mock-delivery.md',
          canonicalSource: 'canonical_user_search_term',
          canonical: {
            rows: 18,
            spend: 170.25,
            orders: 3,
            sales: 240.5,
            clicks: 120,
            impressions: 8000,
            currency: 'USD',
          },
          blockers: ['缺少关键词报告和用户搜索词报告。'],
        };
        window.__businessUiActionLog.push({ type: 'exportDataReconciliation', scope, result });
        return result;
      },
      openReportPath: async (targetPath) => {
        window.__businessUiActionLog.push({ type: 'openReportPath', targetPath });
        return { success: true };
      },
    };
  });

  await page.goto(server.url, { waitUntil: 'networkidle' });
  await assertGlobalGuards(page, 'initial');

  await page.locator('.app-sidebar').getByRole('button', { name: /设置/ }).click();
  await page.getByRole('heading', { name: '设置', level: 2 }).waitFor();
  await expectVisible(page, '待测试');
  await expectVisible(page, '已配置（已隐藏）');
  await expectVisible(page, '已配置，待测试');
  for (const text of ['DeepSeek / OpenAI Compatible', '广告量化阈值', '安全策略', '本地存储路径', '诊断工具']) {
    await expectVisible(page, text);
  }
  await expectVisible(page, 'AI 调用审计');
  await expectVisible(page, '最近 AI 是否参与');
  await expectVisible(page, '最近 AI 调用失败');
  await expectVisible(page, '检查模型、Base URL、标准 JSON 输出格式和证据包');
  await expectVisible(page, 'AI response was not valid JSON');
  await expectVisible(page, '日志数量');
  await expectVisible(page, '广告策略诊断');
  await expectVisible(page, 'Listing 草案');
  await expectVisible(page, '输出格式 广告策略诊断 v1');
  await expectVisible(page, '输出格式 Listing 草案 v1');
  await assertAbsent(page, 'ad_strategy_diagnosis', 'settings-ai-audit');
  await assertAbsent(page, 'listing_rewrite', 'settings-ai-audit');
  await assertAbsent(page, 'schema ad_strategy_diagnosis_v1', 'settings-ai-audit');
  await expectVisible(page, '证据包 4 条');
  await expectVisible(page, '草案证据 1 条');
  await expectVisible(page, '成功');
  await expectVisible(page, '失败');
  await assertAbsent(page, 'sk-1234567890abcdef', 'settings-ai-audit');
  const auditCalls = await page.evaluate(() => (window.__businessUiActionLog || []).filter((item) => item.type === 'listAiCallLogs'));
  if (!auditCalls.some((item) => item.params?.limit === 5)) {
    fail('Settings page did not request recent AI call logs', JSON.stringify(auditCalls));
  }
  const settingsTextBeforeDetails = await bodyText(page);
  if (settingsTextBeforeDetails.includes('pnpm run verify:ai-live')) {
    fail('Settings diagnostic commands are visible');
  }
  await assertGlobalGuards(page, 'settings');
  const settingsScreenshotPath = path.join(evidenceDir, `business-ui-settings-delivery-settings-${runId}.png`);
  await screenshotScrollableContent(page, settingsScreenshotPath);
  evidence.pages.settings = {
    label: '设置',
    screenshotPath: settingsScreenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 2200),
  };
  await page.getByText('查看诊断覆盖项', { exact: true }).click();
  await page.getByText('AI 连接：确认 Provider、Base URL、模型和脱敏 Key 状态。', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByPlaceholder('DeepSeek 或 OpenAI Compatible API Key').fill('test-redacted-smoke-key');
  await page.getByRole('button', { name: '保存 AI 设置' }).click();
  await page.waitForFunction(
    () => (window.__businessUiActionLog || []).some((item) => item.type === 'saveSettings'),
    null,
    { timeout: 5000 },
  );
  await page.getByText('AI 设置已保存', { exact: false }).waitFor({ timeout: 5000 });
  await page.getByPlaceholder('DeepSeek 或 OpenAI Compatible API Key').evaluate((node) => {
    if (node.value !== '') throw new Error(`API key input should be cleared after save, got: ${node.value}`);
  });
  await expectVisible(page, '已配置（已隐藏）');
  await page.getByRole('button', { name: '测试 AI 连接' }).click();
  await page.getByText('AI 连接测试通过', { exact: false }).first().waitFor({ timeout: 5000 });
  await expectVisible(page, 'AI 可用');
  await page.locator('.app-sidebar').getByRole('button', { name: /交付验收/ }).click();
  await page.getByRole('heading', { name: '交付验收', level: 2 }).waitFor();
  await page.locator('.app-sidebar').getByRole('button', { name: /设置/ }).click();
  await page.getByRole('heading', { name: '设置', level: 2 }).waitFor();
  await expectVisible(page, 'AI 可用');
  await page.getByText('AI 连接测试通过', { exact: false }).first().waitFor({ timeout: 5000 });
  await page.locator('.app-sidebar').getByRole('button', { name: /仪表盘/ }).click();
  await page.getByRole('heading', { name: '仪表盘', level: 2 }).waitFor();
  await expectVisible(page, 'AI 已产出建议');
  await expectVisible(page, '1 条待审批，1 条需复核。');
  await page.locator('.app-sidebar').getByRole('button', { name: /优化建议/ }).click();
  await page.getByRole('heading', { name: '优化建议', level: 2 }).waitFor();
  await expectVisible(page, 'AI 可用');
  await expectVisible(page, 'deepseek-v4-flash');
  await expectInBody(page, '生成建议时会调用 AI 参与产品阶段诊断、动态阈值建议和动作解释。', 'cross-page AI readiness after settings test');
  await page.locator('.app-sidebar').getByRole('button', { name: /设置/ }).click();
  await page.getByRole('heading', { name: '设置', level: 2 }).waitFor();
  await expectVisible(page, 'AI 可用');
  await page.getByLabel('AI 人设与输出约束').fill('你是中文亚马逊广告量化运营顾问。必须输出简体中文 JSON，并引用证据说明判断。');
  await page.getByRole('button', { name: '保存 AI 设置' }).click();
  await page.getByText('AI 设置已保存', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, 'AI 可用');
  await page.locator('.app-sidebar').getByRole('button', { name: /交付验收/ }).click();
  await page.getByRole('heading', { name: '交付验收', level: 2 }).waitFor();
  await page.locator('.app-sidebar').getByRole('button', { name: /设置/ }).click();
  await page.getByRole('heading', { name: '设置', level: 2 }).waitFor();
  await expectVisible(page, 'AI 可用');
  await page.getByText('AI 连接测试通过', { exact: false }).first().waitFor({ timeout: 5000 });
  const savedAiSettingsCalls = await page.evaluate(() => (window.__businessUiActionLog || []).filter((item) => item.type === 'saveSettings'));
  const latestAiSave = savedAiSettingsCalls[savedAiSettingsCalls.length - 1];
  if (!latestAiSave?.settings?.aiPersona?.includes('中文亚马逊广告量化运营顾问')) {
    fail('AI persona save did not include configured persona', JSON.stringify(latestAiSave));
  }
  if (latestAiSave?.settings?.aiLastTestStatus !== 'available') {
    fail('Saving AI persona after a successful test should preserve available status', JSON.stringify(latestAiSave));
  }
  await page.getByRole('button', { name: '清除本地 AI Key' }).click();
  await page.getByText('AI Key 已清除', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, '未配置');
  const clearKeySave = (await page.evaluate(() => (window.__businessUiActionLog || []).filter((item) => item.type === 'saveSettings')))
    .find((item) => item.settings?.clearAiKey === true);
  if (!clearKeySave) {
    fail('Clearing AI key should save with clearAiKey=true', JSON.stringify(await page.evaluate(() => window.__businessUiActionLog || [])));
  }
  for (const text of ['设置路径', '证据目录', '下载目录', '导出目录', '交付包目录', '本地数据库', '品牌词白名单', '核心词白名单']) {
    await expectVisible(page, text);
  }
  for (const text of ['目标利润线', '风险线', '无订单浪费', '动作边界', '最高 CPC', '最低 CPC', '自动生成降价建议', '自动生成否词建议']) {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 5000 });
  }
  await page.getByLabel('高 ACOS 阈值').fill('0.10');
  await page.getByRole('button', { name: '保存阈值' }).click();
  await page.getByText('阈值保存已阻断：高 ACOS 阈值不能低于目标 ACOS。', { exact: false }).waitFor({ timeout: 5000 });
  const saveCountBeforeValid = await page.evaluate(() => (window.__businessUiActionLog || []).filter((item) => item.type === 'saveRuleConfig').length);
  if (saveCountBeforeValid !== 0) {
    fail('Invalid rule config should not call saveRuleConfig', String(saveCountBeforeValid));
  }
  await page.getByLabel('高 ACOS 阈值').fill('0.40');
  await page.getByLabel('品牌词白名单').fill('brand one,brand two');
  await page.getByLabel('核心词白名单').fill('core one\ncore two');
  await page.getByRole('button', { name: '保存阈值' }).click();
  await page.waitForFunction(
    () => (window.__businessUiActionLog || []).some((item) => item.type === 'saveRuleConfig'),
    null,
    { timeout: 5000 },
  );

  await page.getByLabel('数据批次来源').selectOption('mock_delivery_batch');
  await page.waitForFunction(() => document.body.innerText.includes('mock_delivery_batch'), null, { timeout: 5000 });
  await page.getByRole('button', { name: '编辑范围' }).click();
  await page.getByLabel('开始日期').fill('2026-06-14');
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.getByText('开始日期不能晚于结束日期。', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('2026-06-01 至 2026-06-12 / FT-US-US / US / USD', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByLabel('开始日期').fill('2026-06-02');
  await page.getByLabel('结束日期').fill('2026-06-13');
  await page.getByLabel('店铺').fill('  FT-US-TEST  ');
  await page.getByLabel('站点').fill('  CA  ');
  await page.getByText('修改日期、店铺或站点会自动清空旧批次；如需固定历史批次，请重新输入批次 ID。', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '保存范围' }).click();
  await page.getByText('2026-06-02 至 2026-06-13 / FT-US-TEST / CA / USD', { exact: true }).waitFor({ timeout: 5000 });

  await page.locator('.app-sidebar').getByRole('button', { name: /交付验收/ }).click();
  await page.getByRole('heading', { name: '交付验收', level: 2 }).waitFor();
  await page.getByText('文件与技术入口', { exact: true }).click();
  for (const text of [
    '应用就绪状态',
    '当前范围交付矩阵',
    '原始广告报表',
    '广告指标入库',
    '广告量化',
    'AI 业务证据',
    '优化建议证据',
    '审批与回读',
    '关键词机会',
    'Listing 草案证据',
    '安装包',
  ]) {
    await expectVisible(page, text);
  }
  for (const text of [
    '未就绪',
    '最终验收汇总是交付状态的唯一来源。',
    '矩阵只说明当前日期、店铺、站点和批次的业务环节；最终是否可交付仍以最终验收汇总为准。',
    '真实数据闭环未完成，不能进入正式交付',
    '真实数据闭环',
    'AI 证据链',
    '运营上下文',
    'Listing 草案证据',
    '建议与审批',
    '执行回读',
    '最终交付包',
    '最终验收汇总尚未证明真实 AI 连接、广告 AI 解释和 Listing AI 草案。',
    '1 条待审批，1 条已批准，1 条复核中；后续必须进入执行回读。',
    '先完成真实报表下载和 DB 日级指标导入',
    '最终证据清单',
    '这里列出最终验收汇总采用的证据文件。',
    'FT-US-TEST / CA / 2026-06-02 - 2026-06-13 / USD',
    '真实数据',
    '采集清单',
    'C:/wrong/lingxing-batch-manifest.json',
    'C:/evidence/reports/campaign.xlsx',
    '当前范围已有 18 行广告指标。',
    '缺少关键词报告和用户搜索词报告。',
    '缺少真实广告回读聚合证据。',
    '广告回读补证',
    '创建回读工作包',
    '打开候选证据',
    '打开证据目录',
    '打开最终验收汇总',
    '刷新最终验收',
    '导出数据口径核对',
    '复制摘要',
    '技术细节',
  ]) {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 5000 });
  }
  await assertGlobalGuards(page, 'delivery');
  const deliveryScreenshotPath = path.join(evidenceDir, `business-ui-settings-delivery-delivery-${runId}.png`);
  await screenshotScrollableContent(page, deliveryScreenshotPath);
  evidence.pages.delivery = {
    label: '交付验收',
    screenshotPath: deliveryScreenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 2600),
  };

  await page.getByRole('button', { name: '刷新最终验收' }).click();
  await page.getByText('最终验收已刷新，仍未就绪', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, '最终验收刷新结果');
  await expectVisible(page, 'C:/final/v15-final-readiness-evidence-manifest-refreshed.json');
  await expectVisible(page, 'C:/final/final-readiness-refreshed.json');
  await expectVisible(page, '最终验收已生成诊断文件，但仍有验收项未通过，不能声明可交付。');
  await page.getByRole('button', { name: '创建回读工作包' }).click();
  await page.getByText('回读工作包已创建', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, 'C:/final/readback-missing-session');
  await expectVisible(page, 'C:/final/readback-missing-session/session-input.json');
  await expectVisible(page, 'C:/final/readback-missing-session/session-input-guide.md');
  await expectVisible(page, 'C:/final/readback-missing-session/operator-checklist.md');
  await expectVisible(page, 'C:/final/readback-missing-session/ads-ui-locator.md');
  await page.getByRole('button', { name: '打开候选证据' }).click();
  await page.getByRole('button', { name: '打开回读工作包' }).click();
  await page.getByRole('button', { name: '打开操作清单' }).click();
  await page.getByRole('button', { name: '打开广告后台定位单' }).click();
  await page.getByRole('button', { name: '打开待填写文件' }).click();
  await page.getByRole('button', { name: '打开填写说明' }).click();
  await page.getByRole('button', { name: '检查工作包' }).click();
  await page.getByText('回读工作包结构已通过，但现场证据仍待填写', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, '工作包检查：结构通过，现场证据待填写');
  await expectVisible(page, '还需填写：审批/审批人、执行前/现场出价、执行后/现场出价、回读/刷新回读截图文件');
  await page.getByRole('button', { name: '生成回读证据' }).click();
  await page.getByText('回读证据已生成，可进入校验', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, '回读证据生成：可校验');
  await page.getByRole('button', { name: '校验回读证据' }).click();
  await page.getByText('回读证据校验通过', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, '回读证据校验：通过');
  await page.getByRole('button', { name: '导出交付包' }).click();
  await expectInBody(page, '最终验收汇总未通过，不能导出可交付包。', 'delivery export blocked message');
  await assertAbsent(page, 'APP_NEEDS_WORK', 'delivery-export-message');
  await assertAbsent(page, 'READY 交付包', 'delivery-export-message');
  await page.getByRole('button', { name: '导出数据口径核对' }).click();
  await page.getByText('数据口径核对报告已导出', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, '数据口径核对报告');
  await expectVisible(page, '权威口径');
  await expectVisible(page, '用户搜索词权威口径');
  await expectVisible(page, 'DB 汇总');
  await expectVisible(page, '18 行 / 170.25 USD / 3 单');
  await expectVisible(page, '报告数据文件');
  await expectVisible(page, 'C:/exports/data-reconciliation/mock-delivery.json');
  await expectVisible(page, '报告说明文件');
  await expectVisible(page, 'C:/exports/data-reconciliation/mock-delivery.md');
  await expectVisible(page, '打开说明文件');
  await expectVisible(page, '打开数据文件');
  await page.getByRole('button', { name: '打开证据目录' }).click();
  await page.getByRole('button', { name: '打开最终验收汇总' }).click();
  await page.getByRole('button', { name: '打开说明文件' }).click();
  await page.getByRole('button', { name: '打开数据文件' }).click();
  await page.getByRole('button', { name: '复制摘要' }).click();
  await page.getByRole('button', { name: '用回读证据刷新最终验收' }).click();
  await page.getByText('已使用回读证据刷新并通过最终验收', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, 'C:/final/v15-final-readiness-evidence-manifest-with-readback-pass.json');
  await expectVisible(page, 'C:/final/final-readiness-with-readback-pass.json');
  evidence.actionLog = await page.evaluate(() => window.__businessUiActionLog || []);
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '').includes('C:/evidence/reports'))) {
    fail('Open evidence folder did not call openReportPath');
  }
  if (!evidence.actionLog.some((item) => item.type === 'prepareAdReadbackSession' && String(item.input?.sourcePath || '') === 'C:/final/readback-missing.json')) {
    fail('Readback blocker did not prepare a session from the failed gate candidate path');
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/final/readback-missing.json')) {
    fail('Open readback candidate did not call openReportPath');
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/final/readback-missing-session')) {
    fail('Open readback session directory did not call openReportPath');
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/final/readback-missing-session/operator-checklist.md')) {
    fail('Open readback session checklist did not call openReportPath');
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/final/readback-missing-session/ads-ui-locator.md')) {
    fail('Open readback Ads UI locator did not call openReportPath');
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/final/readback-missing-session/session-input.json')) {
    fail('Open readback session input did not call openReportPath');
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/final/readback-missing-session/session-input-guide.md')) {
    fail('Open readback session input guide did not call openReportPath');
  }
  if (!evidence.actionLog.some((item) => item.type === 'verifyAdReadbackSession' && String(item.input?.sessionDir || '') === 'C:/final/readback-missing-session')) {
    fail('Readback session check did not call verifyAdReadbackSession with the session directory');
  }
  if (!evidence.actionLog.some((item) => item.type === 'fillAdReadbackSession' && String(item.input?.sessionDir || '') === 'C:/final/readback-missing-session')) {
    fail('Readback session fill did not call fillAdReadbackSession with the session directory');
  }
  if (!evidence.actionLog.some((item) => item.type === 'verifyAdReadbackEvidence' && String(item.input?.evidencePath || '') === 'C:/final/readback-missing-session/real-ad-execution-readback-pass.json')) {
    fail('Generated readback evidence was not sent to verifyAdReadbackEvidence');
  }
  if (!evidence.actionLog.some((item) => item.type === 'refreshFinalReadiness' && String(item.input?.adReadbackPath || '') === 'C:/final/readback-missing-session/real-ad-execution-readback-pass.json')) {
    fail('Final readiness refresh did not use the generated readback evidence path');
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/final/final-readiness-refreshed.json')) {
    fail('Open final manifest did not call the refreshed final readiness manifest path');
  }
  if (!evidence.actionLog.some((item) => item.type === 'exportDataReconciliation'
    && item.scope?.dateFrom === '2026-06-02'
    && item.scope?.dateTo === '2026-06-13'
    && item.scope?.storeName === 'FT-US-TEST'
    && item.scope?.marketplaceCode === 'CA')) {
    fail('Data reconciliation export did not use the edited global scope', JSON.stringify(evidence.actionLog.filter((item) => item.type === 'exportDataReconciliation')));
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/exports/data-reconciliation/mock-delivery.md')) {
    fail('Open reconciliation markdown did not call openReportPath');
  }
  if (!evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '') === 'C:/exports/data-reconciliation/mock-delivery.json')) {
    fail('Open reconciliation json did not call openReportPath');
  }
  if (evidence.actionLog.some((item) => item.type === 'openReportPath' && String(item.targetPath || '').includes('lingxing-batch-manifest'))) {
    fail('Open final manifest fell back to Lingxing batch manifest');
  }
  if (!evidence.actionLog.some((item) => item.type === 'clipboard' && String(item.text || '').includes('交付状态：未就绪'))) {
    fail('Copy summary did not write business-readable not-ready summary');
  }
  if (!evidence.actionLog.some((item) => item.type === 'clipboard'
    && String(item.text || '').includes('真实报表目录：C:/evidence/reports')
    && String(item.text || '').includes('真实报表清单：C:/wrong/lingxing-batch-manifest.json')
    && String(item.text || '').includes('原始文件：广告活动报告 / C:/evidence/reports/campaign.xlsx'))) {
    fail('Copy summary did not include report directory, manifest, and original file path');
  }
  if (evidence.actionLog.some((item) => item.type === 'clipboard' && /APP_(READY|NEEDS_WORK)/.test(String(item.text || '')))) {
    fail('Copy summary leaked raw APP status', JSON.stringify(evidence.actionLog.filter((item) => item.type === 'clipboard')));
  }
  const editedScopeRequests = evidence.actionLog.filter((item) => item.type === 'getBusinessUiDataPipeline'
    && item.scope?.dateFrom === '2026-06-02'
    && item.scope?.dateTo === '2026-06-13'
    && item.scope?.storeName === 'FT-US-TEST'
    && item.scope?.marketplaceCode === 'CA');
  if (!editedScopeRequests.length) {
    fail('Delivery page did not request business data with the edited global scope', JSON.stringify(evidence.actionLog.filter((item) => item.type === 'getBusinessUiDataPipeline')));
  }
  if (editedScopeRequests.some((item) => item.scope?.batchId === 'mock_delivery_batch')) {
    fail('Edited global scope retained stale batch id after date/store/site changed', JSON.stringify(editedScopeRequests));
  }
  const savedAiSettings = evidence.actionLog.find((item) => item.type === 'saveSettings')?.settings;
  if (!savedAiSettings || savedAiSettings.aiApiKey !== 'test-redacted-smoke-key') {
    fail('AI settings save did not receive the typed key before UI cleared it', JSON.stringify(savedAiSettings));
  }
  const savedRuleConfig = evidence.actionLog.find((item) => item.type === 'saveRuleConfig')?.config;
  if (!savedRuleConfig || savedRuleConfig.brandWordWhitelist.join('|') !== 'brand one|brand two' || savedRuleConfig.coreWordWhitelist.join('|') !== 'core one|core two') {
    fail('Brand/core whitelist fields were not saved independently', JSON.stringify(savedRuleConfig));
  }
  if (!evidence.actionLog.some((item) => item.type === 'exportDeliveryBundle')) {
    fail('Export delivery bundle button did not call export API');
  }
  if (!evidence.actionLog.some((item) => item.type === 'refreshFinalReadiness')) {
    fail('Refresh final readiness button did not call refresh API');
  }

  await page.evaluate(() => {
    window.__deliveryReadinessMode = 'missing';
  });
  await page.locator('.app-sidebar').getByRole('button', { name: /设置/ }).click();
  await page.locator('.app-sidebar').getByRole('button', { name: /交付验收/ }).click();
  await page.getByRole('heading', { name: '交付验收', level: 2 }).waitFor();
  await page.getByText('文件与技术入口', { exact: true }).click();
  await page.getByText('最终验收汇总尚未生成', { exact: false }).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '打开最终验收汇总' }).click();
  await page.getByText('最终验收汇总尚未生成。', { exact: false }).first().waitFor({ timeout: 5000 });
  await assertGlobalGuards(page, 'delivery-missing');

  await page.evaluate(() => {
    window.__deliveryReadinessMode = 'fake-ready';
  });
  await page.locator('.app-sidebar').getByRole('button', { name: /设置/ }).click();
  await page.locator('.app-sidebar').getByRole('button', { name: /交付验收/ }).click();
  await page.getByRole('heading', { name: '交付验收', level: 2 }).waitFor();
  await page.getByText('最终验收未通过，不能声明可交付。', { exact: true }).waitFor({ timeout: 5000 });
  await assertGlobalGuards(page, 'delivery-fake-ready');

  await page.evaluate(() => {
    window.__deliveryReadinessMode = 'non-manifest-ready';
  });
  await page.locator('.app-sidebar').getByRole('button', { name: /设置/ }).click();
  await page.locator('.app-sidebar').getByRole('button', { name: /交付验收/ }).click();
  await page.getByRole('heading', { name: '交付验收', level: 2 }).waitFor();
  await page.locator('main').getByText('未就绪', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByText('最终验收汇总不是本次验收来源，不能声明可交付。', { exact: true }).first().waitFor({ timeout: 5000 });
  for (const text of [
    '最终验收汇总已接受 AI 相关证据。',
    '最终验收汇总已接受优化建议证据。',
    '最终验收汇总已接受审批和回读证据。',
    '最终验收汇总已接受关键词机会证据。',
    '最终验收汇总已接受 Listing AI 草案证据。',
    '最终验收项已通过。',
    '可以进入安装包/校验码交付步骤。',
  ]) {
    await assertAbsent(page, text, 'delivery-non-manifest-ready');
  }
  await assertGlobalGuards(page, 'delivery-non-manifest-ready');

  await page.evaluate(() => {
    window.__deliveryReadinessMode = 'pass';
  });
  await page.locator('.app-sidebar').getByRole('button', { name: /设置/ }).click();
  await page.locator('.app-sidebar').getByRole('button', { name: /交付验收/ }).click();
  await page.getByRole('heading', { name: '交付验收', level: 2 }).waitFor();
  await page.getByText('可交付', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('可交付只代表最终验收汇总选中的证据已通过', { exact: false }).waitFor({ timeout: 5000 });
  await page.getByText('C:/final/readback-pass.json', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('真实广告回读验收通过。', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '导出交付包' }).click();
  await page.getByText('交付包已导出', { exact: false }).waitFor({ timeout: 5000 });
  await page.getByText('已包含当前范围数据口径核对', { exact: false }).waitFor({ timeout: 5000 });
  await expectVisible(page, '数据口径核对报告');
  await expectVisible(page, '用户搜索词权威口径');
  await expectVisible(page, '18 行 / 170.25 USD / 3 单');
  await expectVisible(page, 'C:/exports/delivery/v15-ready-bundle/data-reconciliation.json');
  await expectVisible(page, 'C:/exports/delivery/v15-ready-bundle/data-reconciliation.md');
  await assertGlobalGuards(page, 'delivery-pass');
  evidence.actionLog = await page.evaluate(() => window.__businessUiActionLog || []);
  const readyBundleExports = evidence.actionLog.filter((item) => item.type === 'exportDeliveryBundle'
    && item.result?.success
    && item.scope?.dateFrom === '2026-06-02'
    && item.scope?.dateTo === '2026-06-13'
    && item.scope?.storeName === 'FT-US-TEST'
    && item.scope?.marketplaceCode === 'CA');
  if (!readyBundleExports.length) {
    fail('READY delivery bundle export did not receive the edited global scope', JSON.stringify(evidence.actionLog.filter((item) => item.type === 'exportDeliveryBundle')));
  }
  if (!readyBundleExports.some((item) => item.result?.dataReconciliation?.jsonPath?.includes('data-reconciliation.json'))) {
    fail('READY delivery bundle export did not surface data reconciliation files', JSON.stringify(readyBundleExports));
  }

    if (evidence.consoleErrors.length > 0) fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) server.close();
  }

  const evidencePath = path.join(evidenceDir, `business-ui-settings-delivery-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] business UI settings/delivery smoke evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
