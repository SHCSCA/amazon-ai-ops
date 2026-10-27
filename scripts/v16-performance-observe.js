const { performance } = require('node:perf_hooks');
const { insist } = require('./v16-performance-artifacts');

function contextKey(context) {
  return [context.storeId, context.browserProfileId, context.marketplace, context.currency,
    context.businessTimezone, context.businessDate, context.sessionGeneration].join('|');
}
async function fixedIpc(page, operation, input) {
  let timer;
  const invocation = page.evaluate(async ({ operation, input }) => {
    const api = window.electronAPI;
    switch (operation) {
      case 'active': return api.getActiveStoreWorkspaceView();
      case 'storage': return api.getStoragePaths();
      case 'settings': return api.getSettings();
      case 'autonomy': return api.missionDomain.policyRuntime.get(input, {});
      case 'grants': return api.v16.grantList(input);
      case 'execution-batches': return api.v16.executionListBatches(input);
      case 'authority': {
        const request = value => ({ apiVersion: 'v16/1', storeContext: input, input: value });
        const take = value => { if (value?.success !== true) throw new Error('NFR_AUTHORITY_READ_REJECTED:' + (value?.code ?? 'NO_RESULT')); return value.data; };
        const missions = take(await api.v16.missionList(request({ includeArchived: true })));
        const grants = [];
        for (const mission of missions) grants.push(...take(await api.v16.grantList(request({ missionId: mission.id }))));
        return { missionIds: missions.map(mission => mission.id), grants, batches: take(await api.v16.executionListBatches(request({}))) };
      }
      case 'switch': return api.switchStore(input);
      case 'pipeline': return api.getBusinessUiDataPipeline(input);
      case 'import': return api.importCurrentBusinessReports(input);
      case 'analysis': return api.v16.analysisRun(input);
      case 'ai-spend': return api.v16.aiSpendGet(input);
      case 'ai-diagnostics': return api.listAiCallLogs({ limit: 20 });
      case 'jobs': return api.listLingxingCollectionJobs(input);
      case 'cancel': return api.cancelLingxingCollection(input);
      case 'resume': return api.resumeLingxingCollection(input);
      default: throw new Error('NFR_FIXED_IPC_OPERATION_REQUIRED');
    }
  }, { operation, input });
  try {
    return await Promise.race([invocation, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error('NFR_OPERATION_TIMEOUT:' + operation);
        error.fatal = true;
        reject(error);
      }, page.nfrOperationTimeoutMs ?? 30000);
    })]);
  } finally { clearTimeout(timer); }
}
async function currentStore(page, fixture) {
  const view = await fixedIpc(page, 'active');
  const context = view?.context;
  insist(context && fixture.storeIds.includes(context.storeId) && context.marketplace === 'US' && context.currency === 'USD'
    && context.browserProfileId && Number.isSafeInteger(context.sessionGeneration) && context.sessionGeneration >= 0
    && view.store?.storeId === context.storeId, 'NFR_CURRENT_FIXTURE_STORE_REQUIRED');
  return view;
}
async function awaitProjection(page, selector, timeoutMs) {
  await page.locator(selector).waitFor({ state: 'visible', timeout: timeoutMs });
  await page.waitForFunction(selector => {
    const root = document.querySelector(selector);
    const visible = node => { const box=node.getBoundingClientRect(), style=getComputedStyle(node); return box.width>0 && box.height>0 && style.visibility!=='hidden' && style.display!=='none'; };
    return root && ![...document.querySelectorAll('[aria-busy="true"],.route-handoff-feedback,.button-loading')].some(visible)
      && !root.querySelector('[role="alert"]') && (root.textContent ?? '').trim().length > 0;
  }, selector, { timeout: timeoutMs });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function measureNavigation(page, entry, timeoutMs) {
  const selector = `[data-workspace-evidence-root][data-workspace="${entry.workspace}"][data-workspace-subview="${entry.subview}"]`;
  const before = await page.locator(selector).count() && await page.locator(selector).isVisible();
  insist(!before, 'NFR_NAVIGATION_SAME_ENTRY_NOOP');
  const control = page.locator(`.app-sidebar [data-operator-entry="${entry.workspace}/${entry.subview}"]`);
  // 模块按钮本身会转到默认入口，必须纳入第一次导航动作的计时。
  const startedAt = new Date().toISOString(), start = performance.now();
  if (!await control.isVisible()) {
    const module = page.locator(`.app-sidebar [data-operator-module="${entry.module}"]`);
    insist(await module.count() === 1, 'NFR_MODULE_CONTROL_NOT_UNIQUE');
    await module.click();
  }
  if (!(await page.locator(selector).count() && await page.locator(selector).isVisible())) await control.click();
  await awaitProjection(page, selector, timeoutMs);
  const elapsedMs = performance.now() - start;
  return { elapsedMs, startedAt, finishedAt: new Date().toISOString(), entry: { workspace: entry.workspace, subview: entry.subview }, selector };
}
async function measureStoreSwitch(page, fixture, timeoutMs) {
  const before = await currentStore(page, fixture);
  const nextId = fixture.storeIds.find(id => id !== before.context.storeId);
  insist(nextId, 'NFR_TWO_EXISTING_STORES_REQUIRED_FOR_SWITCH');
  const startedAt = new Date().toISOString(), start = performance.now();
  const response = await fixedIpc(page, 'switch', { storeId: nextId, marketplace: 'US' });
  insist(response?.context?.storeId === nextId && response.store?.storeId === nextId, 'NFR_SWITCH_RETURNED_OTHER_STORE');
  const key = contextKey(response.context);
  await page.waitForFunction(key => document.querySelector('[data-authority-key]')?.getAttribute('data-authority-key') === key, key, { timeout: timeoutMs });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await currentStore(page, fixture);
  insist(contextKey(after.context) === key, 'NFR_SWITCH_AUTHORITY_NOT_STABLE');
  return { elapsedMs: performance.now() - start, startedAt, finishedAt: new Date().toISOString(), before: before.context, after: after.context };
}
async function measureLongTable(page, selector, minimumRows, tableSelector) {
  insist(typeof selector === 'string' && selector.length > 0 && Number.isSafeInteger(minimumRows) && minimumRows > 0, 'NFR_LONG_TABLE_CONTRACT_REQUIRED');
  await page.locator(selector).evaluate(element => { element.scrollTop = 0; });
  const before = await page.locator(selector).evaluate((element, tableSelector) => {
    const table = tableSelector ? element.querySelector(tableSelector) : element;
    if (!table) throw new Error('NFR_ACTUAL_TABLE_NOT_FOUND');
    const ariaRows = table.getAttribute('aria-rowcount') ?? table.querySelector('[aria-rowcount]')?.getAttribute('aria-rowcount');
    const dataRows = [...table.querySelectorAll('tbody tr')];
    return { scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollTop: element.scrollTop,
      rowCount: ariaRows === null || ariaRows === undefined ? dataRows.length : Number(ariaRows),
      rowCountBasis: ariaRows === null || ariaRows === undefined ? 'actual-tbody-rows' : 'actual-dom-aria-rowcount',
      rows: [...table.querySelectorAll('[role="row"],tr')].slice(0,5).map(row => row.textContent) };
  }, tableSelector);
  insist(before.scrollHeight > before.clientHeight * 2 && before.rowCount >= minimumRows, 'NFR_ACTUAL_LONG_TABLE_VOLUME_NOT_OBSERVED');
  const start = performance.now(), startedAt = new Date().toISOString();
  await page.locator(selector).hover();
  await page.mouse.wheel(0, before.scrollHeight);
  await page.waitForFunction(selector => document.querySelector(selector)?.scrollTop > 0, selector);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await page.locator(selector).evaluate(element => ({ scrollTop: element.scrollTop,
    rows: [...element.querySelectorAll('[role="row"],tr')].slice(0,5).map(row => row.textContent) }));
  insist(after.scrollTop !== before.scrollTop, 'NFR_TABLE_SCROLL_NOT_OBSERVED');
  return { elapsedMs: performance.now() - start, startedAt, finishedAt: new Date().toISOString(), before, after };
}
module.exports = { fixedIpc, currentStore, contextKey, awaitProjection, measureNavigation, measureStoreSwitch, measureLongTable };
