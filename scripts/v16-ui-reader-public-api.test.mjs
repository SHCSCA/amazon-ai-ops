import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ui = require('./package-ui-evidence.js');
const registry = require('./package-ui-module-registry.js');
const { axModel } = require('./v16-ui-ax-test-model.cjs');
const { describeAccessibleElement } = require('./v16-ui-accessible-node.js');
const { prepareReaderTarget } = require('./v16-ui-reader-target-setup.js');

describe('真实公开UI接口与页签准备调用合同', () => {
  it('实际134出口中的稳定等待能被真实prepare调用，内部未导出函数不能成为模型API', async () => {
    expect(Object.keys(ui)).toHaveLength(134);
    expect(ui.waitForNavigationIdle).toBeUndefined();
    expect(typeof ui.waitForWorkspaceSettled).toBe('function');
    expect(registry.runnerSourcePaths).toHaveLength(114);
    const f = axModel(), events = [], records = [], snapshots = [], waits = [];
    const evaluate = f.page.evaluate.bind(f.page);
    f.page.evaluate = async (callback, request) => {
      if (request?.rootSelector) {
        snapshots.push(request.rootSelector);
        return { rootVisible: true, navigationBusy: false, routeHandoffVisible: false, busyCount: 0, busyLabels: [], text: '当前真实工作区稳定' };
      }
      if (callback.toString().includes('requestAnimationFrame')) { events.push('composite-frame'); return; }
      return evaluate(callback, request);
    };
    f.page.waitForTimeout = async value => { waits.push(value); };
    f.locator.waitFor = async () => undefined; f.locator.isVisible = async () => true;
    f.locator.elementHandle = async () => Object.assign(f.target, { click: async () => { events.push('click'); }, dispose: async () => events.push('target-dispose') });
    const root = { isConnected: true, ownerDocument: f.document, contains: target => target === f.target, dispose: async () => events.push('root-dispose') };
    const runtime = { page: f.page, app: { evaluate: async callback => callback({ BrowserWindow: { getAllWindows: () => [{
      isDestroyed: () => false, webContents: { isDestroyed: () => false, invalidate: () => events.push('invalidate') } }] } }) } };
    const node = await describeAccessibleElement(f.locator, 'unit-node');
    await prepareReaderTarget(runtime, f.locator, node, { elementHandle: async () => root }, ui,
      { log: f.writer.log, json: (label, value) => records.push({ label, value }) }, 'governance/1');
    expect(events.filter(value => value === 'click')).toHaveLength(1);
    expect(snapshots).toHaveLength(4);
    expect(snapshots.every(value => value === '[data-workspace-evidence-root]:has([data-v16-a11y-node="unit-node"])')).toBe(true);
    expect(waits).toEqual([2500, 400, 400, 400, 180]);
    expect(events.slice(-2)).toEqual(['target-dispose', 'root-dispose']);
    expect(records[0].value).toMatchObject({ clickCount: 1, setupOnly: true, noTimingCredit: true, formalCredit: false });
  });
});
