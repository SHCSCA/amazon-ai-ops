const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./playwright-loader');
const {
  enterPreviewStore,
  installPreviewApiBridge,
  navigateLegacyRoute,
  startBusinessUiDevServer,
} = require('./business-ui-smoke-navigation');

const root = path.resolve(__dirname, '..');
const rendererIndex = path.join(root, 'apps', 'desktop', 'dist', 'renderer', 'index.html');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function expectVisibleText(page, text, timeout = 10_000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });
  } catch (error) {
    fail(`Expected visible text missing: ${text}`, (await bodyText(page).catch(() => '')).slice(0, 3_000));
  }
}

async function expectHeading(page, name) {
  await page.getByRole('heading', { name, level: 1, exact: true })
    .waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertWorkspace(page, workspace, subview) {
  const rootLocator = page.locator(
    `[data-workspace-evidence-root][data-workspace="${workspace}"][data-workspace-subview="${subview}"]`,
  );
  await rootLocator.waitFor({ state: 'visible', timeout: 10_000 });
  if (await rootLocator.count() !== 1) {
    fail('Expected one authoritative workspace root', `${workspace}/${subview}`);
  }
}

async function assertGlobalGuards(page, key) {
  const text = await bodyText(page);
  const fixedScope = await page.getByLabel('美国站，美元').innerText();
  if (!fixedScope.includes('US') || !fixedScope.includes('USD')) {
    fail('Fixed US/USD authority marker is missing', key);
  }
  for (const forbidden of ['¥', 'v1.5 工作台', 'pnpm run verify:ad-readback']) {
    if (text.includes(forbidden)) fail(`Unsafe or obsolete text is visible: ${forbidden}`, key);
  }
  if (text.includes('APP_READY') && !text.includes('不可视为 APP_READY')) {
    fail('A false APP_READY claim is visible', key);
  }
}

async function capture(page, evidence, key, label, runId) {
  const screenshotPath = path.join(evidenceDir, `business-ui-data-pipeline-${key}-${runId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  evidence.pages[key] = {
    label,
    screenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 2_000),
  };
}

async function main() {
  if (!fs.existsSync(rendererIndex)) {
    fail('Renderer build not found', rendererIndex);
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const evidence = {
    kind: 'business-ui-data-pipeline-smoke',
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    scenario: 'diagnosis-ready',
    rendererIndex,
    pages: {},
    consoleErrors: [],
  };

  let server;
  let browser;
  try {
    server = await startBusinessUiDevServer(root, 'diagnosis-ready');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1480, height: 980 } });
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => evidence.consoleErrors.push(`pageerror: ${error.message}`));

    await installPreviewApiBridge(page);
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await enterPreviewStore(page);

    await expectHeading(page, '今日任务');
    await assertWorkspace(page, 'today', 'overview');
    await assertGlobalGuards(page, 'today');
    await expectVisibleText(page, '下一安全动作');
    await expectVisibleText(page, 'Amazon US / USD');
    await capture(page, evidence, 'today', '今日任务与下一安全动作', runId);

    await navigateLegacyRoute(page, 'operation-scope');
    await expectHeading(page, '工作范围');
    await assertWorkspace(page, 'collection', 'scope');
    await assertGlobalGuards(page, 'collection-scope');
    await expectVisibleText(page, 'USD');
    await capture(page, evidence, 'collection-scope', '店铺隔离的采集范围', runId);

    await navigateLegacyRoute(page, 'data-collection');
    await expectHeading(page, '报表采集');
    await assertWorkspace(page, 'collection', 'reports');
    await assertGlobalGuards(page, 'collection-reports');
    for (const text of [
      '8 类报表工作台',
      '真实报表',
      '8/8',
      '入库指标',
      '重新获取完整 8 类报表',
      '浏览器状态',
      '采集进度',
    ]) {
      await expectVisibleText(page, text);
    }
    const reportsAdapter = page.getByRole('region', {
      name: '采集任务生产适配内容',
      exact: true,
    });
    await reportsAdapter.waitFor({ state: 'visible', timeout: 10_000 });
    await capture(page, evidence, 'collection-reports', '八类领星报表采集任务', runId);

    await navigateLegacyRoute(page, 'data-import-validation');
    await expectHeading(page, '导入检查');
    await assertWorkspace(page, 'collection', 'import-check');
    await assertGlobalGuards(page, 'collection-import');
    for (const text of [
      '数据流程四段闭环',
      '生产采集血缘待建立',
      '生产血缘导入状态',
      '真实报表 0/8',
      '入库 0 行',
      'DEV 预览不会注入伪造任务',
      '导出数据对账',
    ]) {
      await expectVisibleText(page, text);
    }
    await capture(page, evidence, 'collection-import', '逐类入库与数据对账', runId);

    await navigateLegacyRoute(page, 'operation-events');
    await expectHeading(page, '运营事件');
    await assertWorkspace(page, 'today', 'events');
    await assertGlobalGuards(page, 'today-events');
    await page.getByRole('button', { name: /记录事件/, exact: false })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('button', { name: /记录事件/, exact: false }).click();
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 });
    await expectVisibleText(page, '事件标题');
    await expectVisibleText(page, 'AI 因果上下文');
    await page.getByRole('button', { name: '关闭事件编辑器', exact: true }).click();
    await capture(page, evidence, 'today-events', '运营事件 CRUD 入口', runId);

    await navigateLegacyRoute(page, 'ad-quant');
    await expectHeading(page, '运营任务事实链');
    await assertWorkspace(page, 'missions', 'facts');
    await assertGlobalGuards(page, 'mission-facts');
    for (const text of [
      '核验当前运营任务的事实与来源',
      '运营任务事实范围',
      '任务来源链',
      '不进入决策',
    ]) {
      await expectVisibleText(page, text);
    }
    await capture(page, evidence, 'mission-facts', '运营任务事实与数据来源链', runId);

    if (evidence.consoleErrors.length > 0) {
      fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
    }

    const evidencePath = path.join(evidenceDir, `business-ui-data-pipeline-smoke-${runId}.json`);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`[PASS] business UI data pipeline smoke evidence: ${evidencePath}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
