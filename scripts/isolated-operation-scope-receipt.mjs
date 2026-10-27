import assert from 'node:assert/strict';
import { createRuntimeLogRecord } from '../packages/shared-types/src/runtime-log-format.cjs';

const CONTEXT_FIELDS = ['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration'];
const ROOT = '[data-workspace-evidence-root][data-workspace="collection"][data-workspace-subview="scope"]';

export function requireRuntimeStoreContext(context) {
  assert.ok(context && typeof context === 'object' && !Array.isArray(context), '范围回读缺少真实 Main 店铺上下文。');
  assert.deepEqual(Object.keys(context).sort(), [...CONTEXT_FIELDS].sort(), '必须保留完整七字段 StoreContext。');
  for (const field of ['storeId', 'browserProfileId', 'businessTimezone']) assert.ok(typeof context[field] === 'string' && context[field].trim());
  assert.equal(context.marketplace, 'US'); assert.equal(context.currency, 'USD');
  assert.match(context.businessDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isSafeInteger(context.sessionGeneration) && context.sessionGeneration >= 0);
  return { ...context };
}

export function normalizeRuntimeScope(scope) {
  assert.ok(scope && typeof scope === 'object' && !Array.isArray(scope), '范围尚未通过可见页面显式保存。');
  const result = {};
  for (const field of ['dateFrom', 'dateTo', 'storeName', 'marketplaceCode', 'currency']) {
    assert.ok(typeof scope[field] === 'string' && scope[field].trim(), `范围缺少 ${field}。`);
    result[field] = scope[field].trim();
  }
  assert.match(result.dateFrom, /^\d{4}-\d{2}-\d{2}$/); assert.match(result.dateTo, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(result.dateFrom <= result.dateTo); assert.equal(result.marketplaceCode, 'US'); assert.equal(result.currency, 'USD');
  for (const field of ['asin', 'batchId']) if (typeof scope[field] === 'string' && scope[field].trim()) result[field] = scope[field].trim();
  assert.ok(Object.keys(scope).every(field => ['dateFrom', 'dateTo', 'storeName', 'marketplaceCode', 'currency', 'asin', 'batchId'].includes(field)));
  return result;
}

export function requireScopeUiReadback({ context, contextAfter, viewContext, store, scope }, visible) {
  requireRuntimeStoreContext(context); requireRuntimeStoreContext(contextAfter); requireRuntimeStoreContext(viewContext);
  assert.deepEqual(contextAfter, context, '范围操作期间 Main StoreContext 已变化。');
  assert.deepEqual(viewContext, context, '工作区与 Main 当前七字段上下文不一致。');
  for (const field of ['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone']) assert.equal(store[field], context[field]);
  const expected = normalizeRuntimeScope(visible.draft), actual = normalizeRuntimeScope(scope);
  assert.equal(store.displayName, expected.storeName, '可见范围店铺必须是 Main 当前店铺。');
  assert.equal(visible.summary['日期'], `${expected.dateFrom} ~ ${expected.dateTo}`);
  assert.equal(visible.summary['店铺 / 站点'], `${expected.storeName} / US`);
  assert.equal(visible.summary['产品'], expected.asin || '全部产品');
  assert.deepEqual(actual, expected, 'Main 持久范围与刚确认的可见字段不一致。');
  return actual;
}

async function readMainScope(page) {
  const value = await page.evaluate(async () => {
    const api = window.electronAPI, context = await api.getActiveStoreContext();
    if (!context) throw new Error('范围回读需要 Main 当前店铺。');
    const view = await api.getActiveStoreWorkspaceView();
    const scope = await api.getOperationScope(context);
    return { context, contextAfter: await api.getActiveStoreContext(), viewContext: view?.context,
      store: view?.store, scope };
  });
  requireRuntimeStoreContext(value.context); assert.deepEqual(value.contextAfter, value.context);
  assert.deepEqual(value.viewContext, value.context);
  return value;
}

async function openScopePage(page) {
  const expand = page.getByRole('button', { name: '展开主导航', exact: true });
  if (await expand.isVisible()) await expand.click();
  const module = page.locator('.app-sidebar [data-operator-module="operations-assets"]');
  assert.equal(await module.count(), 1); assert.equal(await module.isVisible(), true);
  if (await module.getAttribute('aria-expanded') !== 'true') await module.click();
  await page.locator('.route-handoff-feedback').waitFor({ state: 'hidden' });
  const entry = page.locator('.app-sidebar [data-operator-entry="collection/scope"]');
  assert.equal(await entry.count(), 1); assert.equal(await entry.isVisible(), true);
  if (await entry.getAttribute('aria-current') !== 'page') await entry.click();
  await page.locator('.route-handoff-feedback').waitFor({ state: 'hidden' });
  await page.locator(ROOT).waitFor({ state: 'visible' });
}

async function readVisibleScope(page, persistedScope) {
  const root = page.locator(ROOT), editor = root.locator('.operation-scope-editor-panel');
  await root.getByRole('button', { name: '编辑范围', exact: true }).click();
  await editor.waitFor({ state: 'visible' });
  try {
    if (persistedScope) await page.waitForFunction(expected => {
      const value = label => document.querySelector('.operation-scope-editor-panel [aria-label="' + label + '"]')?.value;
      return value('运营范围开始日期') === expected.dateFrom && value('运营范围结束日期') === expected.dateTo
        && value('运营范围 ASIN') === (expected.asin || '') && value('运营范围采集批次') === (expected.batchId || '');
    }, persistedScope);
    const locked = editor.locator('[aria-label="当前锁定店铺站点币种"]');
    assert.equal(await locked.getByText('US', { exact: true }).isVisible(), true);
    assert.equal(await locked.getByText('USD', { exact: true }).isVisible(), true);
    const draft = { dateFrom: await editor.getByLabel('运营范围开始日期', { exact: true }).inputValue(),
      dateTo: await editor.getByLabel('运营范围结束日期', { exact: true }).inputValue(),
      storeName: (await locked.locator('strong').innerText()).trim(), marketplaceCode: 'US', currency: 'USD',
      asin: await editor.getByLabel('运营范围 ASIN', { exact: true }).inputValue(),
      batchId: await editor.getByLabel('运营范围采集批次', { exact: true }).inputValue() };
    const summary = await root.locator('.operation-scope-confirm-panel [aria-label="当前范围字段"]').evaluate(element =>
      Object.fromEntries([...element.querySelectorAll('.operation-scope-field-card')].map(card =>
        [card.querySelector(':scope > span')?.textContent?.trim(), card.querySelector(':scope > strong')?.textContent?.trim()])));
    return { draft, summary, observedAt: new Date().toISOString() };
  } finally {
    // 读取编辑字段后取消，不让测试读回路径产生第二次范围保存。
    await editor.getByRole('button', { name: '取消', exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
  }
}

export async function confirmVisibleOperationScope({ page, capture }) {
  try {
    await openScopePage(page);
    const before = await readMainScope(page), visible = await readVisibleScope(page);
    assert.equal(before.scope, null, '全新隔离店铺的范围不能由程序自动初始化。');
    const visibleExpected = normalizeRuntimeScope(visible.draft);
    assert.equal(before.store.displayName, visibleExpected.storeName);
    await capture(page, 'operation-scope-before-confirm');
    const action = { accessibleName: '确认并保存范围', startedAt: new Date().toISOString(), origin: 'visible-production-page-button' };
    await page.locator(ROOT).getByRole('button', { name: action.accessibleName, exact: true }).click();
    const feedback = page.locator(ROOT).locator('.operation-scope-save-feedback[data-tone="success"][role="status"]');
    await feedback.waitFor({ state: 'visible' });
    assert.equal((await feedback.innerText()).trim(), '范围已保存，后续页面会按此读取');
    action.finishedAt = new Date().toISOString();
    const after = await readMainScope(page);
    assert.deepEqual(after.context, before.context);
    const savedScope = requireScopeUiReadback(after, visible);
    await capture(page, 'operation-scope-confirmed');
    return { kind: 'isolated-visible-operation-scope-confirmation', formalAppReadiness: false, realStoreEvidence: false,
      route: 'collection/scope', before, visible, action, after, savedScope };
  } catch (error) {
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'desktop.isolated_scope_confirmation_failed', { error })) + '\n');
    throw error;
  }
}

export async function verifyPersistedOperationScopeOnRestart({ page, capture, first }) {
  try {
    await openScopePage(page);
    const current = await readMainScope(page);
    const persistedScope = normalizeRuntimeScope(current.scope);
    assert.deepEqual(persistedScope, first.savedScope, '重启后 Main 必须回读第一次可见确认的同一持久范围。');
    for (const field of ['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone']) assert.equal(current.context[field], first.after.context[field]);
    const visible = await readVisibleScope(page, persistedScope);
    requireScopeUiReadback(current, visible);
    await capture(page, 'operation-scope-restart-readback');
    return { kind: 'isolated-operation-scope-restart-readback', formalAppReadiness: false, realStoreEvidence: false,
      observedAt: new Date().toISOString(), current, visible, savedScope: persistedScope, freshMainContextRead: true, saveInvoked: false };
  } catch (error) {
    process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'desktop.isolated_scope_restart_readback_failed', { error })) + '\n');
    throw error;
  }
}
