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

async function expectDecisionSubview(page, queueHeading) {
  await expectHeading(page, '建议与审批');
  await page.getByRole('heading', { name: queueHeading, level: 2, exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertWorkspace(page, workspace, subview) {
  const locator = page.locator(
    `[data-workspace-evidence-root][data-workspace="${workspace}"][data-workspace-subview="${subview}"]`,
  );
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  if (await locator.count() !== 1) fail('Expected one workspace evidence root', `${workspace}/${subview}`);
}

async function assertGlobalGuards(page, key) {
  const text = await bodyText(page);
  const fixedScope = await page.getByLabel('美国站，美元').innerText();
  if (!fixedScope.includes('US') || !fixedScope.includes('USD')) {
    fail('Fixed US/USD authority marker is missing', key);
  }
  for (const forbidden of ['¥', 'v1.5 工作台', 'pnpm run verify:ad-readback', 'create:ad-readback-template']) {
    if (text.includes(forbidden)) fail(`Unsafe or obsolete text is visible: ${forbidden}`, key);
  }
  if (text.includes('APP_READY') && !text.includes('不可视为 APP_READY')) {
    fail('A false APP_READY claim is visible', key);
  }
}

async function capture(page, evidence, key, label, runId) {
  const screenshotPath = path.join(evidenceDir, `business-ui-ad-execution-${key}-${runId}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  evidence.pages[key] = {
    label,
    screenshotPath,
    bodyTextSample: (await bodyText(page)).slice(0, 2_500),
  };
}

async function resolvePreviewIdentityAndCreateBatch(page) {
  await page.getByRole('button', { name: '解析当前 Ads 页身份', exact: true }).click();
  await expectVisibleText(page, '当前对象的可见 Ads 页身份已解析');
  await page.getByRole('button', { name: '从完整 Grant 建队列', exact: true }).click();
}

async function main() {
  if (!fs.existsSync(rendererIndex)) fail('Renderer build not found', rendererIndex);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const runId = Date.now();
  const evidence = {
    kind: 'business-ui-ad-execution-smoke',
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    scenario: 'missing-readback-evidence',
    rendererIndex,
    pages: {},
    previewExecutions: [],
    consoleErrors: [],
  };

  let server;
  let browser;
  try {
    server = await startBusinessUiDevServer(root, 'missing-readback-evidence');
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1480, height: 980 } });
    page.on('console', (message) => {
      if (message.type() === 'error') evidence.consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => evidence.consoleErrors.push(`pageerror: ${error.message}`));

    await installPreviewApiBridge(page);
    await page.goto(server.url, { waitUntil: 'networkidle' });
    await enterPreviewStore(page);

    await navigateLegacyRoute(page, 'recommendations');
    await expectDecisionSubview(page, 'AI 建议');
    await assertWorkspace(page, 'decisions', 'recommendations');
    await assertGlobalGuards(page, 'decisions-recommendations');
    await expectVisibleText(page, '建议本身不代表已获执行授权');
    await page.getByRole('button', { name: /新建 Decision/, exact: false }).first().dispatchEvent('click');
    await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 });
    for (const label of ['决策标题', 'Mission ID', '数据批次', '策略版本', '决策理由', '推荐动作']) {
      await expectVisibleText(page, label);
    }
    await page.getByRole('button', { name: '关闭策略编辑器', exact: true })
      .or(page.getByRole('button', { name: '取消', exact: true }))
      .last()
      .dispatchEvent('click');
    await capture(page, evidence, 'decisions-recommendations', 'AI 建议与 Decision CRUD', runId);

    await navigateLegacyRoute(page, 'approval');
    await expectDecisionSubview(page, '人工审批');
    await assertWorkspace(page, 'decisions', 'approval');
    await assertGlobalGuards(page, 'decisions-approval');
    await expectVisibleText(page, '批准只形成 Decision 状态，不代表已写入 Amazon Ads');
    await expectVisibleText(page, 'append-only history');
    await capture(page, evidence, 'decisions-approval', '人工审批与不可变历史', runId);

    await navigateLegacyRoute(page, { workspace: 'decisions', subview: 'decided' });
    await expectDecisionSubview(page, '已决策');
    await assertWorkspace(page, 'decisions', 'decided');
    await assertGlobalGuards(page, 'decisions-decided');
    await expectVisibleText(page, '整批授权一次');
    await expectVisibleText(page, '人工审批与策略自动签发同一种 MissionGrant');
    await capture(page, evidence, 'decisions-decided', '已决策与 MissionGrant 整批授权', runId);

    await navigateLegacyRoute(page, { workspace: 'execution', subview: 'live' });
    await assertWorkspace(page, 'execution', 'live');
    await page.locator('.execution-workspace--mission[data-mutations-disabled="true"]')
      .waitFor({ state: 'visible', timeout: 15_000 });
    await assertGlobalGuards(page, 'execution-live');
    for (const text of [
      '内存 mock · Amazon US / USD',
      '不调用真实 API、不写入 Ads',
      '低风险 · 降幅 ≤ 10%',
      '超出策略内自动边界，已隔离转人工审批',
      'preview://visible-ads-session',
      '排队 → 预检 → intent → 提交 → after → reload',
      'intent 后必须完成回读或进入 UNKNOWN 人工对账',
    ]) {
      await expectVisibleText(page, text);
    }

    await page.getByRole('button', { name: '执行来源', exact: true }).click();
    await expectVisibleText(page, 'MISSIONGRANT → SERIAL EXECUTION');
    await expectVisibleText(page, 'Renderer 只提交 context 与已有 grant / batch / adEntity ID');

    await resolvePreviewIdentityAndCreateBatch(page);
    await expectVisibleText(page, '已从不可变 MissionGrant 创建完整串行批次');
    await page.getByRole('button', { name: '开始串行执行', exact: true }).click();
    await expectVisibleText(page, '串行执行已返回最新 Authority 投影');
    await page.getByRole('tab', { name: '前后对比', exact: true }).click();
    for (const text of ['before', 'after', 'reload']) await expectVisibleText(page, text);
    await page.getByRole('tab', { name: '回读验证', exact: true }).click();
    await expectVisibleText(page, '三段回读已验证');
    await expectVisibleText(page, '任何不确定性都停止队列且不自动重试');
    evidence.previewExecutions.push({ issuer: 'human', result: 'succeeded-with-three-part-readback' });

    const grantSelect = page.getByLabel('有效 MissionGrant');
    await grantSelect.selectOption('preview-grant-policy');
    await resolvePreviewIdentityAndCreateBatch(page);
    await expectVisibleText(page, '策略签发批次已由内存 Main 自动推进');
    await expectVisibleText(page, '执行模式');
    await expectVisibleText(page, '策略签发');
    evidence.previewExecutions.push({ issuer: 'policy', result: 'auto-advanced-in-memory-only' });

    await grantSelect.selectOption('preview-grant-unknown-human');
    await resolvePreviewIdentityAndCreateBatch(page);
    await page.getByRole('tab', { name: '动作详情', exact: true }).click();
    await page.getByRole('button', { name: '开始串行执行', exact: true }).click();
    await expectVisibleText(page, '结果为 UNKNOWN：串行队列已停止，不会自动重试');
    await expectVisibleText(page, 'UNKNOWN · 队列已停止');
    await expectVisibleText(page, '人工接管');
    evidence.previewExecutions.push({ issuer: 'human', result: 'unknown-stopped-no-auto-retry' });
    await capture(page, evidence, 'execution-live', '人工、策略与 UNKNOWN 执行分支（内存预览）', runId);

    await navigateLegacyRoute(page, 'readback');
    await expectHeading(page, '结果核对');
    await assertWorkspace(page, 'execution', 'evidence');
    await assertGlobalGuards(page, 'execution-evidence');
    const readback = page.locator('.readback-page-preview-readonly');
    await readback.waitFor({ state: 'visible', timeout: 15_000 });
    if (await readback.getAttribute('data-preview-scenario') !== 'missing-readback-evidence') {
      fail('Readback preview scenario identity is missing');
    }
    for (const text of [
      '仅开发预览，不代表正式交付就绪',
      '当前仅展示只读结果核对布局',
      '所有证据写入与真实校验均已锁定',
      '选择已批准动作',
      '填写审批凭证',
      '记录执行和回读',
      '校验并导出证据',
    ]) {
      await expectVisibleText(page, text);
    }
    const readbackMutationButtons = readback.getByRole('button', {
      name: /^(载入|导出回读证据|创建回读工作包|检查工作包|生成回读证据|校验证据文件)$/,
    });
    for (let index = 0; index < await readbackMutationButtons.count(); index += 1) {
      if (!await readbackMutationButtons.nth(index).isDisabled()) {
        fail('Readback preview exposed an enabled mutation button', await readbackMutationButtons.nth(index).innerText());
      }
    }
    await capture(page, evidence, 'execution-evidence', '只读执行回读与正式证据锁', runId);

    if (evidence.consoleErrors.length > 0) {
      fail('Renderer emitted console errors', evidence.consoleErrors.join('\n'));
    }

    const evidencePath = path.join(evidenceDir, `business-ui-ad-execution-smoke-${runId}.json`);
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(`[PASS] business UI ad execution smoke evidence: ${evidencePath}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${error.message}`);
  process.exit(1);
});
