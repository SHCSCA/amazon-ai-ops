const fs = require('fs');
const path = require('path');
const { chromium } = require('./playwright-loader');
const {
  enterPreviewStore,
  installPreviewApiBridge,
  navigateLegacyRoute,
  startBusinessUiDevServer,
  switchPreviewStore,
} = require('./business-ui-smoke-navigation');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const NEW_ASIN = 'B0SMOKE001';

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function expectBody(page, text, context) {
  const body = await bodyText(page);
  if (!body.includes(text)) fail(`Expected visible text not found: ${text}`, context);
}

async function expectBodyWithout(page, text, context) {
  const body = await bodyText(page);
  if (body.includes(text)) fail(`Unexpected visible text: ${text}`, context);
}

async function dispatchClick(locator) {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  await locator.dispatchEvent('click');
}

async function assertGlobalGuards(page, context) {
  const text = await bodyText(page);
  const fixedScope = page.getByLabel('美国站，美元');
  await fixedScope.waitFor({ state: 'visible', timeout: 10_000 });
  if (!text.includes('USD')) fail('USD currency marker is missing', context);
  for (const forbidden of ['USDT', 'CNY', 'RMB', '人民币', '¥', '￥']) {
    if (text.includes(forbidden)) fail('Unsupported currency marker is visible', `${context}: ${forbidden}`);
  }
  if (text.includes('APP_READY') && !text.includes('不可视为 APP_READY')) {
    fail('A false APP_READY claim is visible', context);
  }
  if (text.includes('v1.5 工作台')) fail('Legacy v1.5 workbench copy is visible', context);
  if (text.includes('pnpm run verify:ad-readback')) fail('Internal verifier command wall is visible', context);
}

async function waitForStore(page, storeId, storeName) {
  await page.waitForFunction(
    ({ expectedId, expectedName }) => (
      document.querySelector('.app-shell')?.getAttribute('data-store-context') === expectedId
      && document.body.innerText.includes(expectedName)
    ),
    { expectedId: storeId, expectedName: storeName },
    { timeout: 15_000 },
  );
}

async function switchStore(page, storeId, storeName) {
  await switchPreviewStore(page, storeId, storeName);
  await waitForStore(page, storeId, storeName);
}

async function capture(page, evidence, key, filename) {
  const screenshotPath = path.join(evidenceDir, filename);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  evidence.pages[key] = {
    screenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 3_000),
  };
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const evidence = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: 'mission-control-dev-preview',
    mutations: 'isolated in-memory Listing CRUD only; no Amazon or Lingxing writes',
    pages: {},
    consoleErrors: [],
  };

  let server;
  let browser;
  try {
    server = await startBusinessUiDevServer(root, 'diagnosis-ready');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1480, height: 1080 } });
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => evidence.consoleErrors.push(error.message));

    await installPreviewApiBridge(page);
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await enterPreviewStore(page, 'SHC001-US · US · USD');
    await waitForStore(page, 'preview-store-shc001', 'SHC001-US');

    await navigateLegacyRoute(page, 'keyword-opportunities');
    await page.getByRole('heading', { name: '关键词事实与机会', level: 1 }).waitFor();
    await page.getByText('shc001 smart lock', { exact: true }).waitFor();
    await expectBody(page, 'preview-store-shc001', 'store 1 keyword authority');
    await expectBody(page, 'Amazon US · USD · 指标与机会合并', 'store 1 keyword authority');
    await expectBody(page, 'B0GTTJFQTM', 'store 1 keyword fact');
    await expectBody(page, 'shc001 bedroom lock', 'store 1 keyword fact');

    await page.getByLabel('查询关键词').fill('bedroom');
    await page.getByText('shc001 bedroom lock', { exact: true }).waitFor();
    await expectBodyWithout(page, 'shc001 smart lock', 'keyword query filter');
    await page.getByLabel('查询关键词').fill('');
    await page.getByText('shc001 smart lock', { exact: true }).waitFor();

    await page.getByLabel('按 ASIN 筛选关键词').fill('B0GTTJFQTM');
    await page.getByText('shc001 smart lock', { exact: true }).waitFor();
    await expectBodyWithout(page, 'shc001 bedroom lock', 'keyword ASIN filter');
    await page.getByLabel('按 ASIN 筛选关键词').fill('');
    await page.getByText('shc001 bedroom lock', { exact: true }).waitFor();
    await assertGlobalGuards(page, 'store-1-keywords');
    await capture(page, evidence, 'store-1-keywords', `business-ui-keywords-store1-${runId}.png`);

    await switchStore(page, 'preview-store-shc002', 'SHC002-US');
    await page.getByText('shc002 smart lock', { exact: true }).waitFor();
    await expectBody(page, 'preview-store-shc002', 'store 2 keyword authority');
    await expectBody(page, 'B0SHC00201', 'store 2 keyword fact');
    await expectBodyWithout(page, 'shc001 smart lock', 'keyword store isolation');
    await expectBodyWithout(page, 'B0GTTJFQTM', 'keyword store isolation');
    await assertGlobalGuards(page, 'store-2-keywords');
    await capture(page, evidence, 'store-2-keywords', `business-ui-keywords-store2-${runId}.png`);

    await switchStore(page, 'preview-store-shc001', 'SHC001-US');
    await navigateLegacyRoute(page, 'listing-optimization');
    await page.getByRole('heading', { name: 'Listing 内容库', level: 1 }).waitFor();
    await page.getByText('SHC001-US Preview Listing', { exact: true }).waitFor();
    await expectBody(page, 'Amazon US · USD · 本地内容库', 'store 1 Listing authority');
    await expectBody(page, '本阶段只保存在本地，不自动发布 Amazon', 'Listing local-only contract');

    await dispatchClick(page.getByRole('button', { name: '新建 Listing', exact: true }));
    const createDialog = page.getByRole('dialog', { name: '新建美国站 Listing' });
    await createDialog.waitFor();
    await createDialog.getByLabel('ASIN *').fill(NEW_ASIN);
    await createDialog.getByLabel('版本标签').fill('smoke-v1');
    await createDialog.getByLabel('标题').fill('Store One Mission Control Listing');
    await createDialog.getByLabel('Bullet Points（每行一条）').fill('Store-scoped bullet one\nStore-scoped bullet two');
    await createDialog.getByLabel('产品描述').fill('In-memory CRUD smoke content for store one.');
    await createDialog.getByLabel('后台搜索词').fill('store one isolated keyword');
    await createDialog.getByLabel('变更说明').fill('创建店铺一隔离 smoke Listing');
    await dispatchClick(createDialog.getByRole('button', { name: '保存 Listing', exact: true }));
    await page.getByText(`${NEW_ASIN} 已保存到当前店铺，本地内容不会自动发布到 Amazon。`, { exact: true }).waitFor();
    await page.getByText('Store One Mission Control Listing', { exact: true }).waitFor();

    await dispatchClick(page.getByRole('button', { name: `编辑 ${NEW_ASIN}`, exact: true }));
    const editDialog = page.getByRole('dialog', { name: `编辑 ${NEW_ASIN}` });
    await editDialog.waitFor();
    await editDialog.getByLabel('版本标签').fill('smoke-v2');
    await editDialog.getByLabel('标题').fill('Store One Mission Control Listing Updated');
    await editDialog.getByLabel('变更说明').fill('更新店铺一隔离 smoke Listing');
    await dispatchClick(editDialog.getByRole('button', { name: '保存 Listing', exact: true }));
    await page.getByText('Store One Mission Control Listing Updated', { exact: true }).waitFor();

    await dispatchClick(page.getByRole('button', { name: `查看 ${NEW_ASIN} 版本历史`, exact: true }));
    const historyDialog = page.getByRole('dialog', { name: `${NEW_ASIN} 版本历史` });
    await historyDialog.waitFor();
    await historyDialog.getByText('smoke-v2', { exact: false }).waitFor();
    await historyDialog.getByText('smoke-v1', { exact: false }).waitFor();
    await expectBody(page, '历史快照只读，不会提交 Amazon 或改写领星', 'Listing version history contract');
    await dispatchClick(historyDialog.getByRole('button', { name: '关闭 Listing 版本历史', exact: true }));

    await dispatchClick(page.getByRole('button', { name: `删除 ${NEW_ASIN}`, exact: true }));
    const deleteDialog = page.getByRole('alertdialog', { name: `删除 ${NEW_ASIN}？` });
    await deleteDialog.waitFor();
    await dispatchClick(deleteDialog.getByRole('button', { name: '确认删除', exact: true }));
    await page.getByText(`${NEW_ASIN} 已从当前店铺内容库删除；历史版本仍保留。`, { exact: true }).waitFor();
    await expectBodyWithout(page, 'Store One Mission Control Listing Updated', 'deleted Listing current row');

    await dispatchClick(page.getByRole('button', { name: '查看当前店铺 Listing 版本账本', exact: true }));
    const ledgerDialog = page.getByRole('dialog', { name: '当前店铺 Listing 版本账本' });
    await ledgerDialog.waitFor();
    await ledgerDialog.getByText(NEW_ASIN, { exact: false }).first().waitFor();
    await ledgerDialog.getByText('已删除 Listing 的历史快照也会保留在这里', { exact: false }).waitFor();
    await capture(page, evidence, 'listing-version-ledger', `business-ui-listing-ledger-${runId}.png`);
    await dispatchClick(ledgerDialog.getByRole('button', { name: '关闭 Listing 版本账本', exact: true }));

    await switchStore(page, 'preview-store-shc002', 'SHC002-US');
    await page.getByText('SHC002-US Preview Listing', { exact: true }).waitFor();
    await expectBodyWithout(page, NEW_ASIN, 'Listing store isolation');
    await expectBodyWithout(page, 'Store One Mission Control Listing', 'Listing store isolation');
    await assertGlobalGuards(page, 'store-2-listing');
    await capture(page, evidence, 'store-2-listing', `business-ui-listing-store2-${runId}.png`);

    if (evidence.consoleErrors.length > 0) {
      fail('Renderer emitted console or page errors', evidence.consoleErrors.join('\n'));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }

  const evidencePath = path.join(evidenceDir, `business-ui-keyword-listing-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] business UI keyword/Listing smoke evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
