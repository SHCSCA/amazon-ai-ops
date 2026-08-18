const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('./playwright-loader');
const {
  enterPreviewStore,
  installPreviewApiBridge,
  navigateLegacyRoute,
  startBusinessUiDevServer,
} = require('./business-ui-smoke-navigation');

const root = path.resolve(__dirname, '..');
const rendererDir = path.join(root, 'apps', 'desktop', 'dist', 'renderer');
const rendererIndex = path.join(rendererDir, 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const NAV_RE = {
  adQuant: /广告表现/,
  approval: /建议与审批/,
  dashboard: /今日看板|仪表盘/,
  dataCollection: /数据采集/,
  dataImport: /导入校验/,
  delivery: /交付验收/,
  keyword: /关键词机会/,
  listing: /Listing草案/,
  operationEvents: /运营事件/,
  productManagement: /产品工作台|产品管理/,
  readback: /结果核对/,
  recommendations: /建议与审批/,
  scheduler: /自动任务/,
  settings: /AI与规则/,
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
        url: `http://127.0.0.1:${address.port}/index.html?preview=1&scenario=diagnosis-ready`,
        close: () => server.close(),
      });
    });
  });
}

async function expectVisible(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor({ timeout: 5000 });
}

async function expectNotInBody(page, text) {
  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes(text)) {
    fail(`Unexpected visible text: ${text}`);
  }
}

async function expectProductObjectWorkspace(page) {
  await page.locator('.store-scoped-objects[data-store-object-subview="products"]')
    .waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('heading', { name: '产品与经营目标', level: 2, exact: true }).first()
    .waitFor({ timeout: 5000 });
  await page.getByPlaceholder('查询 ASIN / 标题 / SKU', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /新建产品/, exact: false }).waitFor({ timeout: 5000 });
  const h1Count = await page.getByRole('heading', { level: 1 }).count();
  if (h1Count !== 1) fail('Product workspace must expose exactly one h1', String(h1Count));
}

async function expectWorkspaceIdentity(page, { heading, workspace, subview }) {
  await page.getByRole('heading', { name: heading, level: 1, exact: true }).waitFor({ timeout: 5000 });
  const root = page.locator(
    `[data-workspace-evidence-root][data-workspace="${workspace}"][data-workspace-subview="${subview}"]`,
  );
  await root.waitFor({ state: 'visible', timeout: 5000 });
  if (await root.count() !== 1) {
    fail('Exactly one visible workspace evidence root expected', `${workspace}/${subview}`);
  }
}

async function expectSingleActiveNavigation(page, label) {
  const activeNavigation = page.locator('.nav-item[aria-current="page"]');
  const activeNavCount = await activeNavigation.count();
  if (activeNavCount !== 1) {
    fail('Exactly one active navigation item expected', String(activeNavCount));
  }
  const activeLabel = (await activeNavigation.first().innerText()).replace(/\s+/g, ' ').trim();
  if (!activeLabel.includes(label)) {
    fail('Unexpected active navigation item', `${activeLabel}; expected ${label}`);
  }
}

async function expectUnifiedDecisionsWorkspace(page, subview) {
  await expectWorkspaceIdentity(page, {
    heading: '建议与审批',
    workspace: 'decisions',
    subview,
  });
  const queueHeading = subview === 'approval'
    ? '人工审批'
    : subview === 'decided'
      ? '已决策'
      : 'AI 建议';
  await page.getByRole('heading', { name: queueHeading, level: 2, exact: true })
    .first()
    .waitFor({ timeout: 5000 });
  await expectSingleActiveNavigation(page, '决策与审批');
  for (const oldHeading of ['优化建议', '审批中心']) {
    if (await page.getByRole('heading', { name: oldHeading, level: 1, exact: true }).count() > 0) {
      fail('Legacy decisions page heading is still rendered', oldHeading);
    }
  }
}

async function expectDialogActionsReachable(page, dialog, label) {
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const footer = element.querySelector(':scope > footer');
    const footerRect = footer?.getBoundingClientRect();
    const styles = window.getComputedStyle(element);
    return {
      dialog: { top: rect.top, bottom: rect.bottom, height: rect.height },
      footer: footerRect ? { top: footerRect.top, bottom: footerRect.bottom } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflowY: styles.overflowY,
    };
  });
  if (geometry.dialog.top < 0 || geometry.dialog.bottom > geometry.viewport.height + 1) {
    fail(`${label} dialog is clipped`, JSON.stringify(geometry));
  }
  if (!geometry.footer || geometry.footer.bottom > geometry.viewport.height + 1) {
    fail(`${label} dialog actions are not reachable`, JSON.stringify(geometry));
  }
  return geometry;
}

async function expectOrdinaryOperatorCopy(page, label) {
  const ordinaryText = await page.locator('body').evaluate((root) => {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('details, [hidden], [aria-hidden="true"]').forEach((node) => node.remove());
    return clone.innerText;
  });
  const exposedInternalCopy = ordinaryText.match(
    /\b(?:Mission|Experiment|UNKNOWN|revision|draft|Main|StoreContext|Authority|Profile|manifest|fingerprint|Renderer|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|correction|DECISION|ACTION|READBACK|EFFECT)\b|\bset_keyword_bid\b|\bdry-run\b|\bappend-only\b/i,
  );
  if (exposedInternalCopy) {
    const index = Math.max(0, exposedInternalCopy.index ?? 0);
    const context = ordinaryText.slice(Math.max(0, index - 48), Math.min(ordinaryText.length, index + 96));
    fail('Ordinary UI exposes internal copy', `${label}: ${exposedInternalCopy[0]} · ${context}`);
  }
}

async function expandDetails(page, summaryText) {
  await page.getByText(summaryText, { exact: false }).first().waitFor({ timeout: 5000 });
  await page.evaluate((text) => {
    for (const details of document.querySelectorAll('details')) {
      const summary = details.querySelector('summary');
      if (summary?.textContent?.includes(text)) details.open = true;
    }
  }, summaryText);
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
    actionLog: [],
    coreFlows: {},
    consoleErrors: [],
  };

  const server = await startBusinessUiDevServer(root, 'diagnosis-ready');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('console', (message) => {
    if (message.type() === 'error') evidence.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => {
    evidence.consoleErrors.push(`pageerror: ${error.message}`);
    console.error(`[pageerror] ${error.stack || error.message}`);
  });

  await page.addInitScript(() => {
    window.__businessShellActions = [];
    window.__businessUiSmokeOverrides = {
      getState: async () => ({
        isLoggedIn: true,
        currentStore: 'SHC001',
        loginSession: { erpSessionReused: true, adsTitle: '仪表盘' },
      }),
      getBusinessBatchOptions: async () => [],
      getBusinessUiDataPipeline: async (scope) => ({
        scope: { ...scope, currency: 'USD' },
        generatedAt: new Date().toISOString(),
        collection: {
          status: 'partial',
          latestBatch: {
            id: 'batch_shell_smoke',
            status: 'completed',
            dateStart: scope.dateFrom,
            dateEnd: scope.dateTo,
            storeName: scope.storeName,
            marketplaceCode: scope.marketplaceCode,
            downloadDir: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke',
            manifestPath: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke\\manifest.json',
          },
          sourceBatchIds: ['batch_shell_smoke'],
          availableBatches: [],
          reportOptions: [
            { type: 'campaign', label: '广告活动报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'ad_group', label: '广告组报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'placement', label: '广告位报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'advertised_product', label: '广告（推广的商品）报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'auto_targeting', label: '自动投放报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'keyword', label: '关键词报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'product_targeting', label: '商品投放报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
            { type: 'user_search_term', label: '用户搜索词报告', status: 'downloaded', realFileAvailable: true, importedRows: 10 },
          ],
          realReportFiles: [
            {
              id: 'file-keyword',
              reportType: 'keyword',
              displayName: '关键词报告',
              status: 'downloaded',
              filePath: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke\\keyword.xlsx',
              folderPath: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke',
              fileName: 'keyword.xlsx',
              fileSizeBytes: 20480,
              importedRows: 10,
            },
          ],
          evidencePaths: [],
          fileAudit: {
            totalFileRecords: 8,
            downloadedFileRecords: 8,
            existingFileRecords: 8,
            realReportFileCount: 8,
            importedRowCount: 80,
            rejectedEvidenceFileCount: 3,
            missingReportLabels: [],
            downloadDir: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke',
            manifestPath: 'C:\\mock\\lingxing-ad-reports\\batch_shell_smoke\\manifest.json',
          },
          blockers: [],
          audit: {
            databaseReady: true,
            acceptedExtensions: ['.xlsx', '.xls', '.csv'],
            rejectedEvidenceExtensions: ['.json', '.png', '.html'],
            notes: ['smoke mock'],
          },
        },
        quant: {
          hasImportedMetrics: true,
          importedRows: 80,
          canonicalRows: 40,
          actionableRows: 30,
          breakdownRows: 40,
          summarySource: 'canonical_user_search_term',
          totalSpend: 170.25,
          totalSales: 350.5,
          totalOrders: 3,
          totalClicks: 120,
          totalImpressions: 10000,
          acos: 0.486,
          cvr: 0.025,
          cpc: 1.42,
          wastedSpend: 25,
          highRiskCount: 1,
          adObjectTimelines: [],
          diagnostics: [],
          blockers: [],
        },
        operations: { events: [], eventCount: 0, notes: [] },
        productContext: {
          productCount: 1,
          products: [
            {
              asin: 'B0SHELLSMOKE',
              title: 'Shell smoke product',
              productStage: 'scaling',
              status: 'active',
              cost: {
                purchaseCost: 13.5,
                firstLegCost: 1.2,
                fbaFee: 4.1,
                referralFeeRate: 0.15,
                minPrice: 29.99,
                targetNetMargin: 0.22,
                targetAcos: 0.35,
                targetTacos: 0.12,
              },
            },
          ],
          notes: ['smoke product context'],
        },
      }),
      getDeliveryReadiness: async () => ({
        available: false,
        path: null,
        exists: false,
        status: 'APP_NEEDS_WORK',
        appReady: false,
        manifestDriven: false,
        gates: [],
        gatesSummary: { total: 0, passed: 0, failed: 0 },
        missing: ['最终验收汇总尚未生成'],
        actionItems: ['运行最终验收。'],
        message: '最终验收汇总尚未生成',
      }),
      getProducts: async () => [
        {
          id: 1,
          asin: 'B0SHELLSMOKE',
          parent_asin: 'PARENT-SHELL',
          msku: 'MSKU-SHELL',
          sku: 'SKU-SHELL',
          title: 'Shell smoke product',
          product_stage: 'scaling',
          status: 'active',
          store_name: 'FT-US-US',
          marketplace_code: 'US',
        },
      ],
      getRecommendations: async () => [],
      saveProductConfig: async (payload) => {
        window.__businessShellActions.push({ type: 'saveProductConfig', payload });
        return {
          success: true,
          product: {
            id: 1,
            asin: payload.asin,
            store_name: payload.storeName,
            marketplace_code: payload.marketplaceCode,
          },
          cost: payload.cost || null,
        };
      },
      browserLogout: async () => ({ success: true }),
      getScheduledTasks: async () => [
        {
          name: 'daily_report_download',
          cron: '30 8 * * *',
          enabled: false,
          nextRun: '2026-06-13T08:30:00.000Z',
          lastRun: '',
          lastResult: '等待登录和真实报表范围',
        },
        {
          name: 'daily_recommendation_generate',
          cron: '0 9 * * *',
          enabled: false,
          nextRun: '2026-06-13T09:00:00.000Z',
          lastRun: '',
          lastResult: '等待真实数据门槛',
        },
      ],
      setTaskEnabled: async (name, enabled) => {
        window.__businessShellActions.push({ type: 'setTaskEnabled', name, enabled });
        return { success: true };
      },
      runTaskNow: async (name) => {
        window.__businessShellActions.push({ type: 'runTaskNow', name });
        return { success: true };
      },
      runStoreCollectionScheduleNow: async (context) => {
        window.__businessShellActions.push({
          type: 'runStoreCollectionScheduleNow',
          storeId: context.storeId,
          businessDate: context.businessDate,
        });
        return window.__businessUiPreviewApiBase.runStoreCollectionScheduleNow(context);
      },
    };
  });

  await installPreviewApiBridge(page);
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await enterPreviewStore(page);

  await expectWorkspaceIdentity(page, {
    heading: '今日任务',
    workspace: 'today',
    subview: 'overview',
  });
  await expectSingleActiveNavigation(page, '今日任务');

  for (const text of [
    '今日任务',
    '任务中心',
    '决策与审批',
    '经营实验',
    '实时执行',
    '因果记忆',
    '产品与广告对象',
    '数据采集',
    '策略与风控',
    '系统设置',
  ]) {
    await expectVisible(page, text);
  }
  const fixedMarketScope = await page.getByLabel('美国站，美元').innerText();
  if (!fixedMarketScope.includes('US') || !fixedMarketScope.includes('USD')) {
    fail('Fixed US/USD marker is missing from the Mission Control store selector');
  }

  await expectNotInBody(page, 'v1.5 工作台');
  await expectNotInBody(page, 'APP_READY');
  await expectNotInBody(page, 'APP_NEEDS_WORK');
  await expectNotInBody(page, '¥');
  await expectNotInBody(page, 'pnpm run verify:ad-readback');
  await expectNotInBody(page, 'pnpm run verify:ai-live');
  await expectNotInBody(page, '套用已验证范围');

  await page.locator('.nav-item').filter({ hasText: '决策与审批' }).dispatchEvent('click');
  await expectUnifiedDecisionsWorkspace(page, 'recommendations');
  evidence.pages['decisions-sidebar'] = {
    label: '决策与审批（真实侧栏点击）',
    workspace: 'decisions',
    subview: 'recommendations',
    assertion: 'PASS',
  };

  await navigateLegacyRoute(page, 'recommendations');
  await expectUnifiedDecisionsWorkspace(page, 'recommendations');
  evidence.pages['decisions-legacy-recommendations'] = {
    label: 'legacy recommendations → 决策与审批 / AI 建议',
    workspace: 'decisions',
    subview: 'recommendations',
    assertion: 'PASS',
  };

  await navigateLegacyRoute(page, 'approval');
  await expectUnifiedDecisionsWorkspace(page, 'approval');
  evidence.pages['decisions-legacy-approval'] = {
    label: 'legacy approval → 决策与审批 / 人工审批',
    workspace: 'decisions',
    subview: 'approval',
    assertion: 'PASS',
  };

  await navigateLegacyRoute(page, { workspace: 'settings', subview: 'ai-and-local' });
  await expectWorkspaceIdentity(page, {
    heading: '店铺与运行设置',
    workspace: 'settings',
    subview: 'ai-and-local',
  });
  const connectionWorkbench = page.getByRole('region', { name: '当前店铺外部连接工作台' });
  await connectionWorkbench.waitFor({ state: 'visible', timeout: 5000 });
  for (const text of ['当前步骤：', 'ERP', 'Ads']) {
    if (!(await connectionWorkbench.innerText()).includes(text)) fail('Connection flow status is missing', text);
  }
  const ordinaryConnectionText = await connectionWorkbench.evaluate((root) => {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('details, [hidden]').forEach((node) => node.remove());
    return clone.innerText;
  });
  const exposedConnectionTechnicalValue = ordinaryConnectionText.match(
    /\b(?:Main|Electron|Playwright|UNKNOWN|revision|draft|set_keyword_bid)\b|Package UI|Profile ID/,
  );
  if (exposedConnectionTechnicalValue) {
    fail('Connection ordinary UI exposes a technical value', exposedConnectionTechnicalValue[0]);
  }
  evidence.coreFlows.connection = {
    assertion: 'PASS',
    detail: 'ERP / Ads 分阶段状态、当前步骤与安全阻断文案可见；技术值仅允许进入折叠诊断',
  };

  await navigateLegacyRoute(page, { workspace: 'policy', subview: 'rules' });
  await expectWorkspaceIdentity(page, { heading: '策略与风控', workspace: 'policy', subview: 'rules' });
  await page.getByRole('button', { name: '新建策略', exact: true }).first().dispatchEvent('click');
  const strategyDialog = page.getByRole('dialog', { name: '新建策略' });
  await strategyDialog.waitFor({ state: 'visible', timeout: 5000 });
  for (const text of ['对象范围', '允许动作', '变更、预算、次数、冷却与时段限制', '中文证据与停止条件', '数字越小越先匹配']) {
    if (!(await strategyDialog.innerText()).includes(text)) fail('Policy wizard contract is missing', text);
  }
  evidence.coreFlows.policy = {
    assertion: 'PASS',
    detail: '四步策略向导、五级对象范围入口与优先级说明可见',
    dialog: await expectDialogActionsReachable(page, strategyDialog, 'Policy'),
  };
  await strategyDialog.getByRole('button', { name: '取消', exact: true }).dispatchEvent('click');

  await navigateLegacyRoute(page, { workspace: 'missions', subview: 'overview' });
  await expectWorkspaceIdentity(page, { heading: '任务中心', workspace: 'missions', subview: 'overview' });
  await expectOrdinaryOperatorCopy(page, 'missions/overview');
  await page.getByRole('button', { name: '新建运营任务', exact: true }).first().dispatchEvent('click');
  const missionDialog = page.getByRole('dialog', { name: '新建运营任务' });
  await missionDialog.waitFor({ state: 'visible', timeout: 5000 });
  for (const text of ['已完成数据批次', '已启用策略', '关联产品']) {
    if (!(await missionDialog.innerText()).includes(text)) fail('Mission real dependency selector is missing', text);
  }
  const missionText = await missionDialog.innerText();
  if (/BATCH-|ACTIVE-|UNKNOWN|\bdraft\b/.test(missionText)) fail('Mission dialog exposes fabricated or technical values', missionText);
  evidence.coreFlows.missions = {
    assertion: 'PASS',
    detail: '运营任务只显示真实依赖选择器；无伪造批次或版本',
    dialog: await expectDialogActionsReachable(page, missionDialog, 'Mission'),
  };
  await missionDialog.getByRole('button', { name: '关闭运营任务编辑器' }).dispatchEvent('click');

  await navigateLegacyRoute(page, { workspace: 'experiments', subview: 'ledger' });
  await expectWorkspaceIdentity(page, { heading: '经营实验', workspace: 'experiments', subview: 'ledger' });
  await page.getByRole('button', { name: '新建经营实验', exact: true }).first().dispatchEvent('click');
  const experimentDialog = page.getByRole('dialog', { name: '新建经营实验' });
  await experimentDialog.waitFor({ state: 'visible', timeout: 5000 });
  for (const label of ['搜索运营任务', '搜索主指标', '搜索产品', '搜索广告对象（活动 > 广告组 > 关键词/投放）']) {
    await experimentDialog.getByRole('searchbox', { name: label, exact: true }).waitFor({ timeout: 5000 });
  }
  for (const text of ['指标', '比较符', '阈值']) {
    if (!(await experimentDialog.innerText()).includes(text)) fail('Experiment guardrail builder is missing', text);
  }
  const experimentGeometry = await expectDialogActionsReachable(page, experimentDialog, 'Experiment');
  evidence.coreFlows.experiments = {
    assertion: 'PASS',
    detail: '经营实验的运营任务、指标、产品、广告对象均可搜索，守护条件结构化',
    dialog: experimentGeometry,
  };
  evidence.coreFlows.dialog = {
    assertion: 'PASS',
    detail: '1366×768 下策略、运营任务、经营实验弹窗均未裁切且底部动作可达',
  };
  const buttonLayout = await experimentDialog.locator('.workspace-button').evaluateAll((buttons) => buttons.map((button) => {
    const style = window.getComputedStyle(button);
    return { text: button.textContent?.trim(), display: style.display, alignItems: style.alignItems };
  }));
  if (!buttonLayout.length || buttonLayout.some((button) => !['flex', 'inline-flex'].includes(button.display) || button.alignItems !== 'center')) {
    fail('Dialog button icon/text alignment contract failed', JSON.stringify(buttonLayout));
  }
  evidence.coreFlows.buttons = {
    assertion: 'PASS',
    detail: '动作按钮采用水平 flex/inline-flex 并垂直居中',
    inspected: buttonLayout,
  };
  await experimentDialog.getByRole('button', { name: '关闭实验编辑器' }).dispatchEvent('click');
  await experimentDialog.waitFor({ state: 'detached', timeout: 5000 });

  evidence.coreFlows.collection = {
    assertion: 'PASS',
    detail: '生产 renderer 的真实请求 ID 与采集 IPC 由独立 data-collection smoke 验证',
  };

  const routes = [
    { nav: NAV_RE.dashboard, heading: /今日任务/, label: '今日任务', key: 'dashboard' },
    { nav: NAV_RE.productManagement, heading: /产品与广告对象/, label: '产品与广告对象', key: 'product-management' },
    { nav: /工作范围/, heading: /工作范围/, label: '工作范围', key: 'operation-scope' },
    { nav: NAV_RE.dataCollection, heading: /报表采集/, label: '报表采集', key: 'data-collection' },
    { nav: NAV_RE.dataImport, heading: /导入检查/, label: '导入检查', key: 'data-import-validation' },
    { nav: NAV_RE.operationEvents, heading: /运营事件/, label: '运营事件', key: 'operation-events' },
    { nav: NAV_RE.adQuant, heading: /运营任务事实链/, label: '运营任务事实链', key: 'ad-quant' },
    { nav: NAV_RE.recommendations, heading: /建议与审批/, label: '决策与审批 · AI 建议', key: 'recommendations' },
    { nav: NAV_RE.approval, heading: /建议与审批/, label: '决策与审批 · 人工审批', key: 'approval' },
    { nav: NAV_RE.readback, heading: /结果核对/, label: '结果核对', key: 'readback' },
    { nav: NAV_RE.keyword, heading: /关键词事实与机会/, label: '关键词事实与机会', key: 'keyword-opportunities' },
    { nav: NAV_RE.listing, heading: /商品详情内容库/, label: '商品详情内容库', key: 'listing-optimization' },
    { nav: NAV_RE.scheduler, heading: /当前店铺自动化/, label: '当前店铺自动化', key: 'scheduler' },
    { nav: NAV_RE.settings, heading: /店铺与运行设置/, label: '店铺与运行设置', key: 'settings' },
    { nav: NAV_RE.delivery, heading: /交付验收/, label: '交付验收', key: 'delivery' },
  ];

  for (const { nav, heading, label, key } of routes) {
    await navigateLegacyRoute(page, key);
    await page.getByRole('heading', { name: heading, level: 1 }).waitFor();
    await expectOrdinaryOperatorCopy(page, key);
    if (key === 'product-management') await expectProductObjectWorkspace(page);
    const screenshotPath = path.join(evidenceDir, `business-ui-shell-${key}-${runId}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const bodyText = await page.locator('body').innerText();
    evidence.pages[key] = {
      label,
      screenshotPath,
      bodyTextSample: bodyText.slice(0, 1200),
    };
    if (bodyText.includes('v1.5 工作台')) fail('Old nested workbench text is visible', key);
    if (bodyText.includes('¥')) fail('RMB currency symbol is visible', key);
    if (
      bodyText.includes('APP_READY')
      && !(key === 'delivery' && bodyText.includes('不可视为 APP_READY'))
    ) fail('False ready state is visible', key);
    if (bodyText.includes('APP_NEEDS_WORK')) fail('Raw APP_NEEDS_WORK state is visible', key);
    if (bodyText.includes('套用已验证范围')) fail('Misleading hard-coded verified scope preset is visible', key);
    if (bodyText.includes('pnpm run verify:ai-live')) fail('Settings command wall is visible', key);
    if (key === 'readback' && bodyText.includes('pnpm run verify:ad-readback')) {
      fail('Readback command wall is visible in primary UI');
    }
    if (key === 'recommendations' || key === 'approval') {
      await expectUnifiedDecisionsWorkspace(page, key === 'recommendations' ? 'recommendations' : 'approval');
    }
    if (key === 'scheduler') {
      const schedulerBodyText = await page.locator('body').innerText();
      for (const text of [
        '本业务日计划',
        '同一店铺、业务日与采集口径的失败终态不会回到等待',
        '证据保留预览',
        '仅预览 · 不支持删除',
        '状态无法确认或采集失败时，均需人工核对',
      ]) {
        if (!schedulerBodyText.includes(text)) fail('Scheduler safety boundary text missing', text);
      }
      const exposedSchedulerCopy = schedulerBodyText.match(
        /\b(?:Main|StoreContext|Profile|fingerprint|UNKNOWN)\b|DRY-RUN|deletionSupported|RUN NOW/,
      );
      if (exposedSchedulerCopy) {
        fail('Scheduler ordinary UI exposes internal copy', exposedSchedulerCopy[0]);
      }
      await page.getByRole('button', { name: '立即采集', exact: true }).click();
      await page.getByRole('heading', { name: '立即触发当前店铺采集？', exact: true }).waitFor();
      await expectVisible(page, '确认立即采集');
      const afterFirstClickActions = await page.evaluate(() => window.__businessShellActions || []);
      if (afterFirstClickActions.some((action) => action.type === 'runStoreCollectionScheduleNow')) {
        fail('Store collection executed before confirmation');
      }
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('button', { name: '立即采集', exact: true }).click();
      await page.getByRole('button', { name: '确认立即采集', exact: true }).click();
      await expectVisible(page, '当前店铺本业务日采集已完成。');
      const afterConfirmActions = await page.evaluate(() => window.__businessShellActions || []);
      if (!afterConfirmActions.some((action) => action.type === 'runStoreCollectionScheduleNow')) {
        fail('Store collection did not execute after confirmation');
      }
      evidence.actionLog = afterConfirmActions;
    }
  }

  await expectSingleActiveNavigation(page, '系统设置');

  await browser.close();
  server.close();

  if (evidence.consoleErrors.length > 0) {
    fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
  }

  const evidencePath = path.join(evidenceDir, `business-ui-shell-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] business UI shell smoke evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
