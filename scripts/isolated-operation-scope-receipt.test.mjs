import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeRuntimeScope, requireScopeUiReadback } from './isolated-operation-scope-receipt.mjs';

const fields = ['storeId', 'browserProfileId', 'marketplace', 'currency', 'businessTimezone', 'businessDate', 'sessionGeneration'];
const scopeFields = ['dateFrom', 'dateTo', 'storeName', 'marketplaceCode', 'currency', 'asin', 'batchId'];
const context = () => ({ storeId: 'software-only-A', browserProfileId: 'software-profile-A', marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 1 });
const scope = () => ({ dateFrom: '2026-10-03', dateTo: '2026-10-16', storeName: '隔离范围合同A', marketplaceCode: 'US', currency: 'USD' });

function fixture() {
  const current = context(), saved = scope();
  return { value: { context: current, contextAfter: { ...current }, viewContext: { ...current },
    store: { ...current, displayName: saved.storeName }, scope: saved },
  visible: { draft: { ...saved, asin: '', batchId: '' }, summary: { '日期': `${saved.dateFrom} ~ ${saved.dateTo}`,
    '店铺 / 站点': `${saved.storeName} / US`, '产品': '全部产品', '批次 / 币种': '自动匹配 / USD' } } };
}

describe('isolated packaged operation scope prerequisite receipt', () => {
  it('requires visible confirmation before first settings and fresh readback immediately after restart', () => {
    const source = fs.readFileSync(fileURLToPath(new URL('./verify-isolated-desktop-runtime.mjs', import.meta.url)), 'utf8');
    const first = source.indexOf('report.operationScope = { first: await confirmVisibleOperationScope({ page, capture }) };');
    const restart = source.indexOf("({ app, page } = await launch('restart'));");
    const readback = source.indexOf('report.operationScope.restart = await verifyPersistedOperationScopeOnRestart(');
    expect(first, '全新隔离店铺必须显式经过可见确认，不能假设范围已保存。').toBeGreaterThan(-1);
    expect(source.indexOf('await openSettings(page);', source.indexOf('async function main'))).toBeGreaterThan(first);
    expect(readback).toBeGreaterThan(restart);
    expect(source.indexOf('await openSettings(page);', restart)).toBeGreaterThan(readback);
    expect(source).toContain('report.checks.operationScopeExplicitUiConfirmation = true;');
    expect(source).toContain('report.checks.operationScopePersistedAcrossRestart = true;');
  });
  it('keeps helper scope writes behind the visible production button and reads final context after scope', () => {
    const source = fs.readFileSync(fileURLToPath(new URL('./isolated-operation-scope-receipt.mjs', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/\bapi\.saveOperationScope\s*\(/);
    expect(source).toContain("accessibleName: '确认并保存范围'");
    expect(source.indexOf('const scope = await api.getOperationScope(context);')).toBeLessThan(source.indexOf('contextAfter: await api.getActiveStoreContext()'));
  });
  it('accepts only matching visible scope and complete current Main context', () => {
    const { value, visible } = fixture(); expect(requireScopeUiReadback(value, visible)).toEqual(scope());
  });
  it.each(fields)('rejects changed final Main %s', field => {
    const { value, visible } = fixture(); value.contextAfter[field] = field === 'sessionGeneration' ? 2 : 'changed';
    expect(() => requireScopeUiReadback(value, visible)).toThrow();
  });
  it.each(fields)('rejects a workspace with stale %s', field => {
    const { value, visible } = fixture(); value.viewContext[field] = field === 'sessionGeneration' ? 2 : 'changed';
    expect(() => requireScopeUiReadback(value, visible)).toThrow();
  });
  it.each(scopeFields)('rejects persisted %s different from the visible confirmation', field => {
    const { value, visible } = fixture(); value.scope[field] = field === 'dateFrom' ? '2026-10-02' : field === 'dateTo' ? '2026-10-17' : 'changed';
    expect(() => requireScopeUiReadback(value, visible)).toThrow();
  });
  it.each(fields)('requires the complete %s context field', field => {
    const { value, visible } = fixture(); delete value.context[field]; expect(() => requireScopeUiReadback(value, visible)).toThrow();
  });
  it('rejects an unsaved scope instead of manufacturing a default persisted range', () => {
    const { value, visible } = fixture(); value.scope = null; expect(() => requireScopeUiReadback(value, visible)).toThrow();
  });
  it('rejects a current store inconsistent with the visible store', () => {
    const { value, visible } = fixture(); value.store.displayName = '其它店铺'; expect(() => requireScopeUiReadback(value, visible)).toThrow();
  });
  it('keeps optional exact product and batch fields while rejecting unknown authority fields', () => {
    expect(normalizeRuntimeScope({ ...scope(), asin: ' B000000001 ', batchId: ' batch-a ' })).toEqual({ ...scope(), asin: 'B000000001', batchId: 'batch-a' });
    expect(() => normalizeRuntimeScope({ ...scope(), approved: true })).toThrow();
  });
  it('wires real collection automation IPC before settings and verifies a fresh read-only projection after Main restart', () => {
    const source = fs.readFileSync(fileURLToPath(new URL('./verify-isolated-desktop-runtime.mjs', import.meta.url)), 'utf8');
    const firstHelper = source.slice(source.indexOf('async function verifyCollectionAutomationFirst('), source.indexOf('async function verifyCollectionAutomationRestart('));
    const restartHelper = source.slice(source.indexOf('async function verifyCollectionAutomationRestart('), source.indexOf('async function verifyDeliveryPorts('));
    expect(firstHelper).toContain('context = await api.getActiveStoreContext()');
    expect(firstHelper.match(/api\.getStoreCollectionAutomation\(context\)/g)).toHaveLength(2);
    expect(firstHelper).toContain('api.setStoreCollectionAutomation(context, { expectedRevision: 0, automaticCollectionEnabled: false })');
    expect(firstHelper).toContain("source: 'legacy-default', revision: 0, updatedAt: null");
    expect(firstHelper).toContain("source: 'explicit-override', revision: 1");
    expect(firstHelper).toContain('assert.deepEqual(value.written, value.after)');
    expect(restartHelper).toContain('context = await api.getActiveStoreContext()');
    expect(restartHelper).toContain('api.getStoreCollectionAutomation(context)');
    expect(restartHelper).not.toContain('setStoreCollectionAutomation');
    expect(restartHelper).toContain('assert.equal(value.context.browserProfileId, first.context.browserProfileId)');
    expect(restartHelper).toContain('assert.deepEqual(value.current, first.after');
    const main = source.indexOf('async function main()'), first = source.indexOf('report.storeCollectionAutomation = { first:', main);
    const restart = source.indexOf("({ app, page } = await launch('restart'));", main);
    const readback = source.indexOf('report.storeCollectionAutomation.restart = await verifyCollectionAutomationRestart(', restart);
    expect(first).toBeGreaterThan(source.indexOf('report.operationScope = { first:', main));
    expect(first).toBeLessThan(source.indexOf('await openSettings(page);', main));
    expect(readback).toBeGreaterThan(source.indexOf('report.operationScope.restart =', restart));
    expect(readback).toBeLessThan(source.indexOf('await openSettings(page);', restart));
    expect(source).toContain('report.checks.collectionAutomationPublicIpcWriteReadback = true;');
    expect(source).toContain('report.checks.collectionAutomationPersistedAcrossMainRestart = true;');
  });

});

import { vi } from 'vitest';
import { createIsolatedRuntimeCloser } from './portable-runtime-close.mjs';

function isolatedCloseFixture(options = {}) {
  const calls = [], app = { close: vi.fn(async () => {
    calls.push('runtime-close'); await options.runtimeClose?.();
  }) };
  const beforeClose = vi.fn(current => { calls.push('preflight'); return options.beforeClose?.(current); });
  const afterClose = vi.fn(current => { calls.push('postflight'); return options.afterClose?.(current); });
  const onSettled = vi.fn((current, information) => { calls.push('settled'); return options.onSettled?.(current, information); });
  const logger = vi.fn((...arguments_) => options.logger?.(...arguments_));
  return { app, calls, beforeClose, afterClose, onSettled, logger,
    close: createIsolatedRuntimeCloser({ beforeClose, afterClose, onSettled, logger }) };
}

describe('isolated runtime close lifecycle', () => {
  it('reuses the same Promise and preflight for concurrent close and repeated finally cleanup', async () => {
    const fixture = isolatedCloseFixture(), first = fixture.close(fixture.app), second = fixture.close(fixture.app);
    await Promise.allSettled([first, second]);
    const fromFinally = fixture.close(fixture.app); await fromFinally;
    expect(second).toBe(first);
    expect(fromFinally).toBe(first);
    expect(fixture.beforeClose).toHaveBeenCalledTimes(1);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(fixture.afterClose).toHaveBeenCalledTimes(1);
    expect(fixture.onSettled).toHaveBeenCalledTimes(1);
    expect(fixture.calls).toEqual(['preflight', 'runtime-close', 'postflight', 'settled']);
  });

  it('still closes the application once after a preflight hash failure and reuses that original error', async () => {
    const original = new Error('software-only-prehash');
    const fixture = isolatedCloseFixture({ beforeClose: () => { throw original; } }), first = fixture.close(fixture.app);
    await expect(first).rejects.toBe(original);
    const repeated = fixture.close(fixture.app); await expect(repeated).rejects.toBe(original);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(repeated).toBe(first);
    expect(fixture.beforeClose).toHaveBeenCalledTimes(1);
    expect(fixture.afterClose).toHaveBeenCalledTimes(1);
    expect(fixture.onSettled).toHaveBeenCalledWith(fixture.app, { error: original, secondaryErrors: [] });
    expect(fixture.logger).toHaveBeenCalledWith('error', expect.any(String), expect.objectContaining({ message: original.message }));
  });

  it('preserves a preflight failure when application cleanup also fails and records the secondary error', async () => {
    const original = new Error('software-only-prehash'), secondary = new Error('software-only-app-close');
    const fixture = isolatedCloseFixture({ beforeClose: () => { throw original; }, runtimeClose: () => { throw secondary; } });
    await expect(fixture.close(fixture.app)).rejects.toBe(original);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(fixture.afterClose).not.toHaveBeenCalled();
    expect(fixture.onSettled).toHaveBeenCalledWith(fixture.app, { error: original,
      secondaryErrors: expect.arrayContaining([expect.objectContaining({ message: secondary.message })]) });
  });

  it('skips postflight only when the real application close failed and keeps its original failure', async () => {
    const original = new Error('software-only-runtime-close'), fixture = isolatedCloseFixture({ runtimeClose: () => { throw original; } });
    const first = fixture.close(fixture.app); await expect(first).rejects.toBe(original);
    const repeated = fixture.close(fixture.app); await expect(repeated).rejects.toBe(original);
    expect(repeated).toBe(first);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(fixture.afterClose).not.toHaveBeenCalled();
    expect(fixture.onSettled).toHaveBeenCalledWith(fixture.app, { error: original, secondaryErrors: [] });
  });

  it('keeps a postflight failure without closing or hashing the same application again', async () => {
    const original = new Error('software-only-postflight'), fixture = isolatedCloseFixture({ afterClose: () => { throw original; } });
    const first = fixture.close(fixture.app); await expect(first).rejects.toBe(original);
    const repeated = fixture.close(fixture.app); await expect(repeated).rejects.toBe(original);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(repeated).toBe(first);
    expect(fixture.beforeClose).toHaveBeenCalledTimes(1);
    expect(fixture.afterClose).toHaveBeenCalledTimes(1);
    expect(fixture.onSettled).toHaveBeenCalledWith(fixture.app, { error: original, secondaryErrors: [] });
  });

  it('fails closed on a settlement receipt error after completing application cleanup', async () => {
    const original = new Error('software-only-settlement'), fixture = isolatedCloseFixture({ onSettled: () => { throw original; } });
    await expect(fixture.close(fixture.app)).rejects.toBe(original);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(fixture.afterClose).toHaveBeenCalledTimes(1);
    expect(fixture.logger).toHaveBeenCalledWith('error', expect.any(String), expect.objectContaining({ message: original.message }));
  });

  it('preserves the first error and still closes once when error logging and settlement also throw', async () => {
    const original = new Error('software-only-first'), logging = new Error('software-only-log'), settlement = new Error('software-only-settlement');
    const fixture = isolatedCloseFixture({ beforeClose: () => { throw original; }, logger: () => { throw logging; },
      onSettled: () => { throw settlement; } });
    const first = fixture.close(fixture.app); await expect(first).rejects.toBe(original);
    const repeated = fixture.close(fixture.app); await expect(repeated).rejects.toBe(original);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(repeated).toBe(first);
    expect(fixture.afterClose).toHaveBeenCalledTimes(1);
    expect(fixture.onSettled).toHaveBeenCalledWith(fixture.app, { error: original,
      secondaryErrors: expect.arrayContaining([expect.objectContaining({ message: logging.message })]) });
  });

  it('keeps separate application owners independent while sharing each owner cleanup', async () => {
    const fixture = isolatedCloseFixture(), other = { close: vi.fn(async () => {}) };
    const first = fixture.close(fixture.app), second = fixture.close(other); await Promise.all([first, second]);
    expect(first).not.toBe(second);
    expect(fixture.close(fixture.app)).toBe(first);
    expect(fixture.close(other)).toBe(second);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(other.close).toHaveBeenCalledTimes(1);
    expect(fixture.beforeClose).toHaveBeenCalledTimes(2);
  });
});

describe('isolated runtime close production factory wiring', () => {
  it('uses the tested closer for the real first close restart close and final cleanup', () => {
    const source = fs.readFileSync(fileURLToPath(new URL('./verify-isolated-desktop-runtime.mjs', import.meta.url)), 'utf8');
    expect(source).toMatch(/import\s*\{[^}]*createIsolatedRuntimeCloser[^}]*\}\s*from\s*['"]\.\/portable-runtime-close\.mjs['"]/);
    expect(source).toMatch(/const\s+close\s*=\s*createIsolatedRuntimeCloser\s*\(\s*\{/);
    expect(source).toContain('beforeClose(app)');
    expect(source).toContain('afterClose(app)');
    expect(source).toContain('onSettled(app,');
    expect(source.match(/await close\(app\);/g)).toHaveLength(2);
    expect(source).toContain('await close(activeApp)');
  });
});
