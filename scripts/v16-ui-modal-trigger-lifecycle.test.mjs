import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { modalModel, loadProductionInert } = require('./v16-ui-modal-lifecycle-test-model.cjs');
const makeOverlayBackgroundInert = loadProductionInert();
const primitives = require('./v16-ui-software-governance.js');
describe('生产modal背景inert与触发器真实AX生命周期', () => {
  it.each(['ReasonRequiredDialog', 'ResponsiveInspector'])(
    '%s真实prepare/capture只在打开前及Escape后读trigger AX并保留原事件数量', async primitive => {
      const f = modalModel(primitive, makeOverlayBackgroundInert), label = 'lifecycle';
      const prepared = await primitives.preparePrimitive(f.runtime, f.item, f.ui, { triggerEvidenceId: label + '-trigger' });
      expect(f.trigger.inert).toBe(true); expect(f.isOpen()).toBe(true);
      expect(prepared.triggerNode.name).toBe(f.trigger.axName);
      const before = prepared.triggerNode;
      const evidence = await primitives.captureKeyboard(f.runtime, prepared, { primitive }, f.writer, label);
      const dom = f.records.get(evidence.dom.label), rows = f.records.get(evidence.log.label).trim().split('\n').map(JSON.parse);
      expect(f.events).not.toContain('trigger-AX-open');
      expect(f.events.filter(event => event === 'trigger-AX-closed')).toHaveLength(4);
      expect(f.events.filter(event => event === 'open')).toHaveLength(1);
      expect(f.trigger.inert).toBe(false);
      expect(dom.nodes).toHaveLength(2);
      expect(dom.nodes[1]).not.toBe(before);
      expect(dom.nodes[1]).toMatchObject({ id: before.id, name: before.name, role: before.role, focusable: true, bounds: { x: 40 } });
      expect(before.bounds.x).toBe(10);
      expect(rows.map(row => row.event)).toEqual(primitive === 'ReasonRequiredDialog'
        ? ['focus-enter', 'tab-wrap', 'shift-tab-wrap', 'escape', 'focus-return'] : ['focus-enter', 'keyboard-action', 'focus-return']);
      expect(rows.every(row => row.targetId === row.activeElementId)).toBe(true);
    });
  it('真实生产背景inert函数使当前AX拒绝，不能用手工DOM名称绕过', async () => {
    const f = modalModel('ReasonRequiredDialog', makeOverlayBackgroundInert);
    await primitives.preparePrimitive(f.runtime, f.item, f.ui);
    expect(f.trigger.inert).toBe(true);
    await expect(primitives.describeElement(f.triggerLocator, 'must-not-read-background')).rejects.toThrow('UI_AX_ACTUAL_NODE_INVALID');
    expect(f.events).toContain('trigger-AX-open');
  });
  it.each(['name', 'role', 'backend', 'disabled', 'inert', 'focus'])(
    'Escape后%s变化不能沿用旧trigger AX或输出键盘成功原件', async scenario => {
      const f = modalModel('ReasonRequiredDialog', makeOverlayBackgroundInert), label = 'failure'; f.afterEscape = scenario;
      const prepared = await primitives.preparePrimitive(f.runtime, f.item, f.ui, { triggerEvidenceId: label + '-trigger' });
      const code = { name: 'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED', role: 'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED',
        disabled: 'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED', backend: 'UI_AX_PREBOUND_TARGET_CHANGED',
        inert: 'UI_AX_ACTUAL_NODE_INVALID', focus: 'UNIT_RESTORE_FOCUS_MISSING' }[scenario];
      await expect(primitives.captureKeyboard(f.runtime, prepared, { primitive: f.item.primitive }, f.writer, label)).rejects.toThrow(code);
      expect(f.records.has(label + '/keyboard-dom.json')).toBe(false);
      expect(f.events.filter(event => event === 'open')).toHaveLength(1);
      expect(f.events).not.toContain('trigger-AX-open'); expect(f.isOpen()).toBe(false);
    });
  it('打开前实际AX无名称即拒绝且不能先点击再采集', async () => {
    const f = modalModel('ReasonRequiredDialog', makeOverlayBackgroundInert); f.trigger.axName = '';
    await expect(primitives.preparePrimitive(f.runtime, f.item, f.ui, { triggerEvidenceId: 'invalid-trigger' })).rejects.toThrow('UI_AX_ACTUAL_NODE_INVALID');
    expect(f.events).not.toContain('open'); expect(f.isOpen()).toBe(false);
  });
});
