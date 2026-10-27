import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { axModel } = require('./v16-ui-ax-test-model.cjs');
const { describeAccessibleElement } = require('./v16-ui-accessible-node.js');
const { prepareReaderTarget } = require('./v16-ui-reader-target-setup.js');
function setup(f) {
  const events = [], receipts = [], root = { isConnected: true, ownerDocument: f.document, contains: element => element === f.target };
  const handle = root; handle.dispose = async () => { events.push('dispose'); };
  f.locator.click = async () => { events.push('click'); f.target.tabIndex = 0; f.target.attrs['aria-selected'] = 'true'; };
  f.locator.elementHandle = async () => Object.assign(f.target, { click: () => f.locator.click(), dispose: async () => events.push('target-dispose') });
  return { events, receipts, root, rootPort: { elementHandle: async () => handle },
    ui: { waitForWorkspaceSettled: async () => events.push('navigation'), waitForRendererComposite: async () => events.push('composite') },
    writer: { log: f.writer.log, json: (label, value) => receipts.push({ label, value }) } };
}
describe('原first2页签在自然读屏之前走固定正常选择准备', () => {
  it.each([true, false])('原页签active=%s也固定只点击一次且准备无十秒信用', async selected => {
    const f = axModel(), p = setup(f);
    f.target.tabIndex = selected ? 0 : -1; f.target.attrs['aria-selected'] = String(selected);
    const node = await describeAccessibleElement(f.locator, 'unit-node');
    await prepareReaderTarget({ page: f.page, app: {} }, f.locator, node, p.rootPort, p.ui, p.writer, 'governance/1');
    expect(p.events).toEqual(['click', 'navigation', 'composite', 'target-dispose', 'dispose']);
    expect(p.receipts[0].value).toMatchObject({ nodeId: node.id, clickCount: 1, setupOnly: true, noTimingCredit: true, formalCredit: false });
    expect(f.target.tabIndex).toBe(0);
    expect(f.calls.filter(call => call.method.includes('Input'))).toHaveLength(0);
  });
  it.each(['root-detached', 'selection-rejected', 'same-name-replacement', 'navigation-failed'])(
    '%s不得换节点、重试点击或进入capture', async scenario => {
      const f = axModel(), p = setup(f), node = await describeAccessibleElement(f.locator, 'unit-node');
      if (scenario === 'root-detached') p.root.isConnected = false;
      if (scenario === 'selection-rejected') f.locator.click = async () => { p.events.push('click'); f.target.attrs['aria-selected'] = 'false'; };
      if (scenario === 'same-name-replacement') p.ui.waitForWorkspaceSettled = async () => { f.replaced = f.element('unit-node'); };
      if (scenario === 'navigation-failed') p.ui.waitForWorkspaceSettled = async () => { throw new Error('UNIT_NAVIGATION_FAILED'); };
      await expect(prepareReaderTarget({ page: f.page, app: {} }, f.locator, node, p.rootPort, p.ui, p.writer, 'governance/1')).rejects.toThrow();
      expect(p.events.filter(event => event === 'click').length).toBeLessThanOrEqual(1);
      expect(p.receipts).toEqual([]); expect(p.events.at(-1)).toBe('dispose');
    });
  it('普通控件和合法负tabindex dialog不进入页签点击准备', async () => {
    const f = axModel(), p = setup(f);
    for (const role of ['button', 'dialog']) await prepareReaderTarget({}, f.locator, { role }, p.rootPort, p.ui, p.writer, 'g');
    expect(p.events).toEqual([]); expect(f.calls).toEqual([]);
  });
});
