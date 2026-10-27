const path = require('node:path');
const { insist } = require('./v16-performance-artifacts');

const ROOT = '[data-workspace-evidence-root][data-workspace="collection"][data-workspace-subview="scope"]';
const FIELDS = Object.freeze([
  ['dateFrom', '运营范围开始日期'], ['dateTo', '运营范围结束日期'],
  ['asin', '运营范围 ASIN'], ['batchId', '运营范围采集批次'],
]);
const CONTEXT_FIELDS = ['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration'];
const STORE_FIELDS = ['storeId', 'browserProfileId', 'displayName', 'marketplace', 'currency', 'businessTimezone'];
const scopeValues = scope => Object.fromEntries(['dateFrom', 'dateTo', 'storeName', 'marketplaceCode', 'asin', 'batchId', 'currency']
  .map(key => [key, scope?.[key] ?? '']));
const sameContext = (left, right) => CONTEXT_FIELDS.every(key => left?.[key] === right?.[key]);
const sameScope = (left, right) => JSON.stringify(scopeValues(left)) === JSON.stringify(scopeValues(right));
const samePath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

function expectedScope(fixture, view) {
  const context = view?.context, store = view?.store, scope = fixture.scope;
  insist(context && store && fixture.storeIds.includes(context.storeId) && context.storeId === store.storeId
    && context.browserProfileId === store.browserProfileId && context.marketplace === 'US' && store.marketplace === 'US'
    && context.currency === 'USD' && store.currency === 'USD' && context.businessTimezone === store.businessTimezone
    && typeof context.browserProfileId === 'string' && context.browserProfileId.length > 0
    && /^\d{4}-\d{2}-\d{2}$/.test(context.businessDate) && Number.isSafeInteger(context.sessionGeneration) && context.sessionGeneration >= 0
    && typeof store.displayName === 'string' && store.displayName.length > 0, 'UI_SOFTWARE_SCOPE_AUTHORITY_MISMATCH');
  insist(scope && scope.marketplaceCode === context.marketplace && /^\d{4}-\d{2}-\d{2}$/.test(scope.dateFrom)
    && /^\d{4}-\d{2}-\d{2}$/.test(scope.dateTo) && scope.dateFrom <= scope.dateTo
    && (scope.storeName === undefined || scope.storeName === store.displayName) && (scope.currency === undefined || scope.currency === context.currency)
    && ['asin', 'batchId'].every(key => scope[key] === undefined || typeof scope[key] === 'string'),
  'UI_SOFTWARE_FIXTURE_SCOPE_INVALID');
  return { ...scopeValues(scope), storeName: store.displayName, currency: context.currency };
}

async function readMainScope(page) {
  return page.evaluate(async () => {
    const view = await window.electronAPI.getActiveStoreWorkspaceView();
    const saved = view?.context ? await window.electronAPI.getOperationScope(view.context) : null;
    return { view, saved };
  });
}

async function readEditor(page) {
  return page.evaluate(({ selector, fields }) => {
    const roots = document.querySelectorAll(selector);
    if (roots.length !== 1) throw new Error('UI_SOFTWARE_SCOPE_DOM_NOT_UNIQUE');
    const editors = roots[0].querySelectorAll('.operation-scope-editor-panel');
    if (editors.length !== 1 || !editors[0].checkVisibility()) throw new Error('UI_SOFTWARE_SCOPE_EDITOR_NOT_VISIBLE');
    const values = {};
    for (const [key, label] of fields) {
      const inputs = [...editors[0].querySelectorAll('input')].filter(node => node.getAttribute('aria-label') === label);
      if (inputs.length !== 1 || !inputs[0].checkVisibility()) throw new Error('UI_SOFTWARE_SCOPE_FIELD_NOT_UNIQUE:' + key);
      values[key] = inputs[0].value;
    }
    const locked = editors[0].querySelectorAll('[aria-label="当前锁定店铺站点币种"]');
    if (locked.length !== 1 || !locked[0].checkVisibility()) throw new Error('UI_SOFTWARE_SCOPE_LOCKED_AUTHORITY_NOT_UNIQUE');
    return { fields: values, lockedAuthority: [...locked[0].children].map(node => node.textContent) };
  }, { selector: ROOT, fields: FIELDS });
}

async function readSummary(page) {
  return page.evaluate(selector => {
    const roots = document.querySelectorAll(selector);
    if (roots.length !== 1) throw new Error('UI_SOFTWARE_SCOPE_DOM_NOT_UNIQUE');
    const facts = roots[0].querySelectorAll('[aria-label="当前范围字段"]');
    if (facts.length !== 1 || !facts[0].checkVisibility()) {
      throw new Error('UI_SOFTWARE_SCOPE_SUMMARY_NOT_VISIBLE');
    }
    const values = {};
    for (const label of ['日期', '店铺 / 站点', '产品', '批次 / 币种']) {
      const cards = [...facts[0].children].filter(node => node.querySelector(':scope > span')?.textContent === label);
      if (cards.length !== 1 || !cards[0].checkVisibility()) throw new Error('UI_SOFTWARE_SCOPE_SUMMARY_NOT_UNIQUE:' + label);
      values[label] = cards[0].querySelector(':scope > strong')?.textContent;
    }
    return values;
  }, ROOT);
}

async function currentRenderer(runtime) {
  const observed = await runtime.app.evaluate(({ app, BrowserWindow }) => {
    const metrics = app.getAppMetrics();
    return { pid: process.pid, executablePath: process.execPath, appRoot: app.getAppPath(), userDataDir: app.getPath('userData'),
      creationTime: metrics.find(metric => metric.pid === process.pid)?.creationTime, packaged: app.isPackaged,
      windows: BrowserWindow.getAllWindows().filter(window => !window.isDestroyed()).map(window => {
        const rendererPid = window.webContents.getOSProcessId(), preferences = window.webContents.getLastWebPreferences();
        return { id: window.id, visible: window.isVisible(), url: window.webContents.getURL(), rendererPid,
          creationTime: metrics.find(metric => metric.pid === rendererPid)?.creationTime,
          preferences: { contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration } };
      }) };
  });
  const original = runtime.identity, before = original.windows[0], after = observed.windows[0];
  insist(observed.pid === original.pid && observed.creationTime === original.creationTime && observed.packaged === true
    && samePath(observed.executablePath, original.executablePath) && samePath(observed.appRoot, original.appRoot)
    && samePath(observed.userDataDir, runtime.userDataDir), 'UI_SOFTWARE_SCOPE_MAIN_IDENTITY_CHANGED');
  insist(observed.windows.length === 1 && original.windows.length === 1 && after.id === before.id && after.visible
    && after.url === before.url && after.preferences.contextIsolation === true && after.preferences.nodeIntegration === false
    && Number.isSafeInteger(after.rendererPid) && after.rendererPid > 0 && Number.isFinite(after.creationTime) && after.creationTime > 0,
  'UI_SOFTWARE_SCOPE_RENDERER_BINDING_MISMATCH');
  return { before, after };
}

async function synchronizeSoftwareScope(runtime, fixture, initialView, writer, timeoutMs, ui = require('./package-ui-evidence')) {
  const startedAt = new Date().toISOString(), deadline = Date.now() + timeoutMs;
  const remaining = () => { const value = deadline - Date.now(); insist(value > 0, 'UI_SOFTWARE_SCOPE_SYNC_TIMEOUT'); return value; };
  const bounded = async action => {
    let timer;
    try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('UI_SOFTWARE_SCOPE_SYNC_TIMEOUT')), remaining());
    })]); } finally { clearTimeout(timer); }
  };
  const expected = expectedScope(fixture, initialView), page = runtime.page;
  const root = page.locator(ROOT), edit = root.getByRole('button', { name: '编辑范围', exact: true });
  const editor = root.locator('.operation-scope-editor-panel');
  const assertMain = value => {
    insist(sameContext(value.view?.context, initialView.context)
      && STORE_FIELDS.every(key => value.view?.store?.[key] === initialView.store[key]), 'UI_SOFTWARE_SCOPE_AUTHORITY_CHANGED');
    insist(sameScope(value.saved, expected), 'UI_SOFTWARE_SCOPE_MAIN_SAVED_MISMATCH');
  };
  try {
    insist(typeof ui.navigateToWorkspace === 'function' && Array.isArray(ui.EXPECTED_PACKAGE_UI_ENTRIES), 'UI_SOFTWARE_SCOPE_PUBLIC_NAVIGATION_REQUIRED');
    const entries = ui.EXPECTED_PACKAGE_UI_ENTRIES.filter(entry => entry.workspace === 'collection' && entry.subview === 'scope');
    insist(entries.length === 1, 'UI_SOFTWARE_SCOPE_CANONICAL_ENTRY_REQUIRED');
    // 第三参是 settleMs 而非超时；保留公共导航默认稳定门，外层统一限制原剩余预算。
    const navigation = await bounded(() => ui.navigateToWorkspace(page, entries[0]));
    await root.waitFor({ state: 'visible', timeout: remaining() });
    await root.locator('section[aria-label="旧页面兼容适配器"][data-legacy-route="operation-scope"][data-capability-state="LEGACY_ADAPTER"]')
      .waitFor({ state: 'visible', timeout: remaining() });
    await edit.click({ timeout: remaining() });
    await editor.waitFor({ state: 'visible', timeout: remaining() });
    const initialEditor = await bounded(() => readEditor(page));
    insist(JSON.stringify(initialEditor.lockedAuthority) === JSON.stringify([expected.storeName, expected.marketplaceCode, expected.currency]),
      'UI_SOFTWARE_SCOPE_LOCKED_AUTHORITY_MISMATCH');
    // 仅四个生产公开输入可编辑；店铺、美国站和币种由实际页面锁定并只读核验。
    for (const [key, label] of FIELDS) await editor.getByLabel(label, { exact: true }).fill(expected[key], { timeout: remaining() });
    await editor.getByRole('button', { name: '保存范围', exact: true }).click({ timeout: remaining() });
    await page.waitForFunction(selector => {
      const scope = document.querySelector(selector), error = scope?.querySelector('.operation-scope-editor-panel [role="alert"]');
      if (error?.checkVisibility()) throw new Error('UI_SOFTWARE_SCOPE_SAVE_FAILED:' + error.textContent);
      return Boolean(scope) && !scope.querySelector('.operation-scope-editor-panel');
    }, ROOT, { timeout: remaining() });
    await editor.waitFor({ state: 'hidden', timeout: remaining() });
    await root.locator('.operation-scope-save-feedback[data-tone="success"]').waitFor({ state: 'visible', timeout: remaining() });
    const main = await bounded(() => readMainScope(page)); assertMain(main);
    await edit.click({ timeout: remaining() });
    await editor.waitFor({ state: 'visible', timeout: remaining() });
    const restored = await bounded(() => readEditor(page));
    insist(FIELDS.every(([key]) => restored.fields[key] === expected[key])
      && JSON.stringify(restored.lockedAuthority) === JSON.stringify(initialEditor.lockedAuthority), 'UI_SOFTWARE_SCOPE_RENDERER_FIELDS_MISMATCH');
    await editor.getByRole('button', { name: '取消', exact: true }).click({ timeout: remaining() });
    await editor.waitFor({ state: 'hidden', timeout: remaining() });
    const summary = await bounded(() => readSummary(page));
    insist(summary['日期'] === `${expected.dateFrom} ~ ${expected.dateTo}`
      && summary['店铺 / 站点'] === `${expected.storeName} / ${expected.marketplaceCode}` && summary['产品'] === (expected.asin || '全部产品')
      && (expected.batchId ? summary['批次 / 币种'] === `${expected.batchId} / USD`
        : typeof summary['批次 / 币种'] === 'string' && summary['批次 / 币种'].endsWith(' / USD')),
    'UI_SOFTWARE_SCOPE_RENDERER_SUMMARY_MISMATCH');
    const finalMain = await bounded(() => readMainScope(page)); assertMain(finalMain);
    const renderer = await bounded(() => currentRenderer(runtime));
    // 后续屏读绑定读取同一 Main/窗口刚核验的当前 Renderer，不能沿用启动快照里的旧 PID。
    runtime.identity.windows = [renderer.after];
    const proof = { kind: 'v16-software-ui-scope-initialization', schemaVersion: 1, formalCredit: false,
      method: 'production-operation-scope-page-save-and-readback', startedAt, verifiedAt: new Date().toISOString(), timeoutMs,
      entry: entries[0], navigation, scope: expected, mainSaved: finalMain.saved, context: finalMain.view.context,
      fields: restored.fields, lockedAuthority: restored.lockedAuthority, summary, automaticBatch: !expected.batchId, renderer };
    return { ...proof, artifact: writer.json('native/scope-initialization.json', proof) };
  } catch (error) {
    writer.log('v16.ui_software_scope_sync_failed', error, { pid: runtime.identity.pid });
    throw error;
  }
}

module.exports = { synchronizeSoftwareScope };
