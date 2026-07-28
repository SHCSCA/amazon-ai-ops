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
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const previewScenario = 'delivery-ready';

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function expectBodyText(page, text, key) {
  const content = await bodyText(page);
  if (!content.includes(text)) fail(`Expected body text missing: ${text}`, key);
}

async function expectNoBodyText(page, text, key) {
  const content = await bodyText(page);
  if (content.includes(text)) fail(`Unexpected body text: ${text}`, key);
}

async function expectWorkspace(page, heading, subview) {
  await page.getByRole('heading', { name: heading, level: 1, exact: true })
    .waitFor({ state: 'visible', timeout: 10_000 });
  const rootNode = page.locator(
    `[data-workspace-evidence-root][data-workspace="settings"][data-workspace-subview="${subview}"]`,
  );
  await rootNode.waitFor({ state: 'visible', timeout: 10_000 });
  if (await rootNode.count() !== 1) {
    fail('Expected exactly one settings workspace evidence root', subview);
  }
}

async function assertUsUsdOnly(page, key, { allowPreviewReadyWarning = false } = {}) {
  const content = await bodyText(page);
  for (const forbidden of ['USDT', 'CNY', '人民币', '¥', 'APP_NEEDS_WORK']) {
    if (content.includes(forbidden)) fail(`Non-US/USD or raw readiness text is visible: ${forbidden}`, key);
  }
  if (content.includes('APP_READY')) {
    if (!allowPreviewReadyWarning || !content.includes('不可视为 APP_READY')) {
      fail('False APP_READY state is visible', key);
    }
  }
  const fixedMarketScope = await page.getByLabel('美国站，美元').innerText();
  if (!fixedMarketScope.includes('US') || !fixedMarketScope.includes('USD')) {
    fail('Mission Control top bar lost the fixed Amazon US / USD scope', key);
  }
}

async function switchStore(page, storeId, storeName) {
  const selector = page.getByLabel('切换店铺');
  await selector.selectOption(storeId);
  await page.waitForFunction(
    ({ id, name }) => {
      const select = document.querySelector('select[aria-label="切换店铺"]');
      return select instanceof HTMLSelectElement
        && select.value === id
        && select.selectedOptions[0]?.textContent?.trim() === name;
    },
    { id: storeId, name: storeName },
    { timeout: 10_000 },
  );
  await page.locator(`[data-authority-key*="${storeId}"]`).waitFor({ state: 'visible', timeout: 10_000 });
}

async function clickButton(page, name, options = {}) {
  const button = page.getByRole('button', { name, exact: options.exact ?? true }).first();
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.dispatchEvent('click');
}

async function fillRuntimeConfig(page, values) {
  const field = (label) => page.locator('.mission-control-config-form label')
    .filter({ hasText: label })
    .locator('input')
    .first();
  if (values.collectionScheduleLocalTime !== undefined) {
    await field('每日采集时间').fill(values.collectionScheduleLocalTime);
  }
  if (values.collectionLookbackDays !== undefined) {
    await field('采集回看天数').fill(String(values.collectionLookbackDays));
  }
  if (values.analysisWindowDays !== undefined) {
    await field('量化分析窗口').fill(String(values.analysisWindowDays));
  }
  if (values.defaultTargetAcosPercent !== undefined) {
    await field('默认目标 ACOS').fill(String(values.defaultTargetAcosPercent));
  }
  if (values.minimumRecommendationConfidencePercent !== undefined) {
    await field('最低建议置信度').fill(String(values.minimumRecommendationConfidencePercent));
  }
  if (values.evidenceRetentionDays !== undefined) {
    await field('证据保留期').fill(String(values.evidenceRetentionDays));
  }
  if (values.aiRecommendationsEnabled !== undefined) {
    const toggle = field('AI 调整建议');
    if (await toggle.isChecked() !== values.aiRecommendationsEnabled) {
      await toggle.setChecked(values.aiRecommendationsEnabled);
    }
  }
}

async function capture(page, evidence, key, runId) {
  const screenshotPath = path.join(
    evidenceDir,
    `business-ui-settings-delivery-${key}-${runId}.png`,
  );
  await page.screenshot({ path: screenshotPath, fullPage: true });
  evidence.pages[key] = {
    assertion: 'PASS',
    screenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 2_000),
  };
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const evidence = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    scenario: previewScenario,
    runtime: {
      mode: 'dev-preview-memory-only',
      credentialsUsed: false,
      amazonAdsWrites: false,
    },
    pages: {},
    actionLog: [],
    consoleErrors: [],
  };

  let browser;
  let server;
  try {
    server = await startBusinessUiDevServer(root, previewScenario);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1480, height: 980 } });

    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => {
      evidence.consoleErrors.push(`pageerror: ${error.message}`);
    });

    await page.addInitScript(() => {
      window.__settingsDeliverySmokeActions = [];
      const wrapPreview = (type, method) => async (...args) => {
        window.__settingsDeliverySmokeActions.push({
          type,
          storeId: args[0]?.storeId || args[0]?.storeContext?.storeId || null,
          input: args[1] || null,
        });
        return window.__businessUiPreviewApiBase[method](...args);
      };
      window.__businessUiSmokeOverrides = {
        createStoreRuntimeConfig: wrapPreview('createStoreRuntimeConfig', 'createStoreRuntimeConfig'),
        updateStoreRuntimeConfig: wrapPreview('updateStoreRuntimeConfig', 'updateStoreRuntimeConfig'),
        archiveStoreRuntimeConfig: wrapPreview('archiveStoreRuntimeConfig', 'archiveStoreRuntimeConfig'),
        restoreStoreRuntimeConfig: wrapPreview('restoreStoreRuntimeConfig', 'restoreStoreRuntimeConfig'),
      };
    });
    await installPreviewApiBridge(page);
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await enterPreviewStore(page);

    await navigateLegacyRoute(page, 'settings');
    await expectWorkspace(page, '店铺与运行设置', 'ai-and-local');
    await assertUsUsdOnly(page, 'settings-shc001');
    for (const text of [
      '店铺运行配置',
      '当前店铺独立保存采集、量化与 AI 建议参数',
      '08:00 · 回看 14 天',
      '30 天 · 目标 ACOS 28%',
      '启用 · ≥ 72%',
      '365 天',
      'US / USD',
      'AI 服务连接',
      '系统回退规则（兼容）',
      '不会直接写入广告账户',
    ]) {
      await expectBodyText(page, text, 'settings-shc001');
    }

    await clickButton(page, '编辑配置');
    await page.getByRole('heading', { name: '编辑店铺运行配置', level: 2, exact: true })
      .waitFor({ state: 'visible' });
    await fillRuntimeConfig(page, {
      collectionScheduleLocalTime: '07:45',
      collectionLookbackDays: 17,
      defaultTargetAcosPercent: 31.5,
      minimumRecommendationConfidencePercent: 79,
      evidenceRetentionDays: 400,
    });
    await clickButton(page, '保存变更');
    await page.getByRole('heading', { name: '编辑店铺运行配置', level: 2, exact: true })
      .waitFor({ state: 'hidden', timeout: 10_000 });
    for (const text of [
      'r2 · 生效中',
      '07:45 · 回看 17 天',
      '30 天 · 目标 ACOS 31.5%',
      '启用 · ≥ 79%',
      '400 天',
      '2 个版本',
    ]) {
      await expectBodyText(page, text, 'settings-shc001-updated');
    }

    await clickButton(page, '编辑规则阈值');
    await page.getByRole('heading', {
      name: '编辑规则阈值、动作边界和白名单',
      level: 2,
      exact: true,
    }).waitFor({ state: 'visible' });
    for (const text of [
      '目标 ACOS',
      '高 ACOS 阈值',
      '最低花费',
      '降价比例',
      '只生成建议，不自动写入 Ads',
      '执行仍走审批和回读',
    ]) {
      await expectBodyText(page, text, 'settings-rules');
    }
    const previewRuleSave = page.getByRole('button', { name: '保存系统回退规则', exact: true });
    if (!await previewRuleSave.isDisabled()) {
      fail('Dev preview must not persist system-level fallback rules');
    }
    await clickButton(page, '取消');
    await capture(page, evidence, 'settings-shc001-updated', runId);

    await switchStore(page, 'preview-store-shc002', 'SHC002-US');
    await expectWorkspace(page, '店铺与运行设置', 'ai-and-local');
    for (const text of [
      'r2 · 生效中',
      '09:30 · 回看 21 天',
      '180 天',
      'US / USD',
    ]) {
      await expectBodyText(page, text, 'settings-shc002-isolated');
    }
    for (const storeOneValue of ['07:45 · 回看 17 天', '400 天']) {
      await expectNoBodyText(page, storeOneValue, 'settings-shc002-isolated');
    }

    await clickButton(page, '编辑配置');
    await fillRuntimeConfig(page, {
      evidenceRetentionDays: 210,
      aiRecommendationsEnabled: false,
    });
    await clickButton(page, '保存变更');
    await page.getByRole('heading', { name: '编辑店铺运行配置', level: 2, exact: true })
      .waitFor({ state: 'hidden', timeout: 10_000 });
    for (const text of ['r3 · 生效中', '210 天', '已关闭']) {
      await expectBodyText(page, text, 'settings-shc002-updated');
    }

    await clickButton(page, '归档');
    await page.getByRole('heading', { name: '归档当前店铺配置？', level: 2, exact: true })
      .waitFor({ state: 'visible' });
    await expectBodyText(page, '配置会停止生效但保留全部版本，可随时恢复；不会影响其他店铺。', 'settings-archive-confirm');
    await clickButton(page, '确认归档');
    await expectBodyText(page, 'r4 · 已归档', 'settings-shc002-archived');
    await clickButton(page, '恢复配置');
    await expectBodyText(page, 'r5 · 生效中', 'settings-shc002-restored');
    await expectBodyText(page, '4 个版本', 'settings-shc002-restored');
    await capture(page, evidence, 'settings-shc002-restored', runId);

    await navigateLegacyRoute(page, 'scheduler');
    await expectWorkspace(page, '当前店铺自动化', 'scheduler');
    for (const text of [
      '本业务日计划',
      '失败关闭',
      '同一店铺、业务日与采集口径的失败终态不会回到等待',
      '证据保留预览',
      'DRY-RUN · deletionSupported=false',
      '同采集口径关闭 · 不重试',
      '210 天',
      '当前版本始终不支持删除或应用',
    ]) {
      await expectBodyText(page, text, 'scheduler-shc002');
    }
    await assertUsUsdOnly(page, 'scheduler-shc002');
    await capture(page, evidence, 'scheduler-shc002-failed-closed', runId);

    await switchStore(page, 'preview-store-shc001', 'SHC001-US');
    await expectWorkspace(page, '当前店铺自动化', 'scheduler');
    for (const text of [
      '07:45',
      '等待计划',
      '400 天',
      '只读扫描通过安全检查',
    ]) {
      await expectBodyText(page, text, 'scheduler-shc001-isolated');
    }
    for (const storeTwoValue of ['09:30', '210 天']) {
      await expectNoBodyText(page, storeTwoValue, 'scheduler-shc001-isolated');
    }
    await capture(page, evidence, 'scheduler-shc001-waiting', runId);

    await navigateLegacyRoute(page, 'settings');
    await expectWorkspace(page, '店铺与运行设置', 'ai-and-local');
    for (const text of ['r2 · 生效中', '07:45 · 回看 17 天', '400 天']) {
      await expectBodyText(page, text, 'settings-shc001-roundtrip');
    }
    await expectNoBodyText(page, '210 天', 'settings-shc001-roundtrip');

    await navigateLegacyRoute(page, 'delivery');
    await expectWorkspace(page, '交付验收', 'delivery');
    for (const text of [
      '交付摘要',
      '仅开发预览',
      '仅开发预览已走通',
      '不可视为 APP_READY',
      '也不能满足真实导出或验收 gate',
      '开发预览',
      '还不能交付',
      '最终验收',
      '未就绪',
      '交付包',
      '阻断',
    ]) {
      await expectBodyText(page, text, 'delivery-preview-only');
    }
    await assertUsUsdOnly(page, 'delivery-preview-only', { allowPreviewReadyWarning: true });

    const exportButtons = page.getByRole('button', { name: '导出交付包', exact: true });
    const exportCount = await exportButtons.count();
    for (let index = 0; index < exportCount; index += 1) {
      if (!await exportButtons.nth(index).isDisabled()) {
        fail('Preview-only delivery must not enable delivery bundle export', `button ${index + 1}`);
      }
    }
    await capture(page, evidence, 'delivery-preview-only', runId);

    evidence.actionLog = await page.evaluate(() => window.__settingsDeliverySmokeActions || []);
    const actionTypes = evidence.actionLog.map((item) => item.type);
    for (const requiredAction of [
      'updateStoreRuntimeConfig',
      'archiveStoreRuntimeConfig',
      'restoreStoreRuntimeConfig',
    ]) {
      if (!actionTypes.includes(requiredAction)) {
        fail('Required runtime config CRUD action missing', requiredAction);
      }
    }
    const storeOneUpdates = evidence.actionLog.filter((item) =>
      item.type === 'updateStoreRuntimeConfig' && item.storeId === 'preview-store-shc001');
    const storeTwoUpdates = evidence.actionLog.filter((item) =>
      item.type === 'updateStoreRuntimeConfig' && item.storeId === 'preview-store-shc002');
    if (storeOneUpdates.length !== 1 || storeTwoUpdates.length !== 1) {
      fail('Runtime config writes were not isolated by store', JSON.stringify(evidence.actionLog));
    }
    if (evidence.actionLog.some((item) =>
      /credential|password|amazon.?ads|execute|exportDeliveryBundle/i.test(String(item.type)))) {
      fail('Smoke crossed the approved memory-only settings boundary', JSON.stringify(evidence.actionLog));
    }
    if (evidence.consoleErrors.length > 0) {
      fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }

  const evidencePath = path.join(
    evidenceDir,
    `business-ui-settings-delivery-smoke-${runId}.json`,
  );
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] business UI settings/delivery smoke evidence: ${evidencePath}`);
}

main().catch((error) => {
  console.error(`[FAIL] ${error.stack || error.message}`);
  process.exit(1);
});
