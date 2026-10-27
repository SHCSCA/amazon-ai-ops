import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { START, iso, createDomClockModel } = require('./v16-ui-dom-clock-test-support.cjs');
const INTERVAL = 'UI_NVDA_DOM_FOCUS_RENDERER_INTERVAL_INVALID';
const RECEIPT = 'UI_NVDA_DOM_FOCUS_CLOCK_RECEIPT_INVALID';
const IDENTITY = 'UI_NVDA_DOM_FOCUS_IDENTITY_CHANGED';
const identityOrInterval = /UI_NVDA_DOM_FOCUS_(?:RENDERER_INTERVAL_INVALID|IDENTITY_CHANGED)/;
const identityOrReceipt = /UI_NVDA_DOM_FOCUS_(?:CLOCK_RECEIPT_INVALID|IDENTITY_CHANGED)/;
function cleaned(model) {
  expect(model.f.sessions.every(session => session.detached)).toBe(true);
  expect(model.f.window.__amazonAiOpsAxProbes.size).toBe(0);
  expect(JSON.stringify(model.stderr)).not.toContain('UNIT_SECRET_NEVER_PERSIST');
}
async function fixture(options) { return createDomClockModel(options).prepare(); }
function corrupt(model, change) {
  model.afterAccessible = value => { if (value) change(value, model); };
}

describe('真实CJS完整读取链的独立时钟', () => {
  it('Renderer精确快1ms仍通过真实AX和最终DOM校验，旧谓词仍拒绝原未来值', async () => {
    const model = await fixture({ nodeNow: START + 100, rendererNow: START + 101 });
    const value = await model.read();
    const receiptSamples = model.nodeClock.calls.slice(model.nodeAfterAccessibleClockStart).filter(row => row.method === 'now');
    expect(model.runtime.dom.matchesDomFocus(value, model.context, model.node)).toBe(true);
    expect(receiptSamples).toEqual([{ method: 'now', value: START + 100 }]);
    expect(model.rendererClock.calls.filter(row => row.method === 'constructor' && row.implicit).map(row => row.args))
      .toEqual([[START + 101], [START + 101]]);
    expect(value.observedAt).toBe(iso(START + 100));
    expect(value.rendererObservedAt).toBe(iso(START + 101));
    expect(value.rendererTiming).toEqual({ kind: 'v16-dom-renderer-interval', schemaVersion: 1, clock: 'renderer-wall',
      probeNonce: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      nonce: model.context.nonce, phase: model.context.phase, targetId: model.node.id,
      startedAt: iso(START + 101), finishedAt: iso(START + 101) });
    expect(value.collectorTiming).toEqual({ kind: 'v16-dom-collector-receipt', schemaVersion: 1, clock: 'collector-node-wall',
      nonce: model.context.nonce, phase: model.context.phase, targetId: model.node.id,
      probeNonce: value.rendererTiming.probeNonce, readStartedAt: iso(START + 100), receivedAt: iso(START + 100) });
    expect(() => model.runtime.dom.matchesDomFocus({ ...value, observedAt: value.rendererObservedAt }, model.context, model.node))
      .toThrow('UI_NVDA_DOM_FOCUS_TIME_INVALID');
    expect([...model.runtime.loaded.keys()].sort()).toEqual(['v16-ui-accessible-node.js', 'v16-ui-ax-identity.js', 'v16-ui-nvda-dom-focus.js']);
    expect(model.accessibleReads).toBe(1);
    expect(model.readEvaluations().map(row => row.name)).toEqual(['registerProbe', 'finishProbe']);
    expect(model.readEvaluations().at(-1).request.validate).toBe(true);
    expect(model.readSessions()).toHaveLength(1);
    expect(model.readSessions()[0].axReads).toBe(2);
    expect(model.f.calls.filter(row => row.method === 'Runtime.releaseObject').length).toBeGreaterThanOrEqual(4);
    cleaned(model);
  });
  it('Renderer初终值和Node读区间分别原样保留', async () => {
    const model = await fixture({ rendererTimes: [START + 101, START + 104] });
    model.afterAccessible = () => model.nodeClock.set(START + 103);
    const value = await model.read();
    expect(value.rendererTiming.startedAt).toBe(iso(START + 101));
    expect(value.rendererTiming.finishedAt).toBe(iso(START + 104));
    expect(value.rendererObservedAt).toBe(iso(START + 104));
    expect(value.collectorTiming.readStartedAt).toBe(iso(START + 100));
    expect(value.collectorTiming.receivedAt).toBe(iso(START + 103));
    expect(value.observedAt).toBe(iso(START + 103));
    expect(model.runtime.dom.matchesDomFocus(value, model.context, model.node)).toBe(true);
    cleaned(model);
  });
  it('同一context的每次真实读取生成新probe并将两域直接绑定', async () => {
    const model = await fixture(), first = await model.read(), second = await model.read();
    expect(first.rendererTiming.probeNonce).not.toBe(second.rendererTiming.probeNonce);
    expect(first.collectorTiming.probeNonce).toBe(first.rendererTiming.probeNonce);
    expect(second.collectorTiming.probeNonce).toBe(second.rendererTiming.probeNonce);
    expect(model.readSessions()).toHaveLength(2);
    expect(model.readSessions().every(session => session.axReads === 2)).toBe(true);
    cleaned(model);
  });
  it('真实register初值丢失时不能由finish终值回填', async () => {
    const model = await fixture();
    model.afterRegister = value => { delete value.focus.observedAt; };
    await expect(model.read()).rejects.toThrow(INTERVAL);
    expect(model.readEvaluations().map(row => row.name)).toEqual(['registerProbe', 'finishProbe']);
    expect(model.readSessions()[0].axReads).toBe(2);
    cleaned(model);
  });
  it.each(['nonce', 'phase', 'targetId'])('真实register初始%s被换且final正常时仍拒绝重贴身份', async field => {
    const model = await fixture();
    model.afterRegister = value => { value.focus = { ...value.focus, [field]: 'foreign' }; };
    await expect(model.read()).rejects.toThrow('UI_AX_FOCUS_INTERVAL_IDENTITY_CHANGED');
    expect(model.readSessions()[0].axReads).toBe(2);
    expect(model.readEvaluations().at(-1).request.validate).toBe(true);
    cleaned(model);
  });
  it('Renderer同名扩展字段不能覆盖可信Node receipt', async () => {
    const model = await fixture();
    corrupt(model, value => { value.collectorTiming = { clock: 'foreign' }; value.rendererObservedAt = 'foreign'; });
    const value = await model.read();
    expect(value.collectorTiming.clock).toBe('collector-node-wall');
    expect(value.collectorTiming.receivedAt).toBe(iso(START + 100));
    expect(value.rendererObservedAt).toBe(iso(START + 101));
    expect(value.observedAt).toBe(iso(START + 100));
    cleaned(model);
  });
});

const malformed = [
  ['缺失区间', focus => { delete focus.rendererTiming; }],
  ['非对象区间', focus => { focus.rendererTiming = 'invalid'; }],
  ['错误kind', focus => { focus.rendererTiming.kind = 'foreign-interval'; }],
  ['错误版本', focus => { focus.rendererTiming.schemaVersion = 2; }],
  ['错误时钟域', focus => { focus.rendererTiming.clock = 'collector-node-wall'; }],
  ['起点无效', focus => { focus.rendererTiming.startedAt = 'not-a-time'; }],
  ['终点无效', focus => { focus.rendererTiming.finishedAt = 'not-a-time'; }],
  ['起点非字符串', focus => { focus.rendererTiming.startedAt = START + 101; }],
  ['起点非规范', focus => { focus.rendererTiming.startedAt = '2026-10-24T02:22:24Z'; }],
  ['终点非规范', focus => { focus.rendererTiming.finishedAt = '2026-10-24T02:22:24Z'; }],
  ['自身倒序', focus => { focus.rendererTiming.startedAt = iso(START + 102); }],
  ['原observedAt无效', focus => { focus.observedAt = 'not-a-time'; }],
  ['原observedAt非规范', focus => { focus.observedAt = '2026-10-24T02:22:24Z'; }],
  ['原observedAt与终点不等', focus => { focus.observedAt = iso(START + 102); }],
  ['probe缺失', focus => { delete focus.rendererTiming.probeNonce; }],
  ['probe非规范UUID', focus => { focus.rendererTiming.probeNonce = 'A2345678-1234-4123-8123-123456789ABC'; }],
];
describe('完整AX读取后拒绝无效Renderer原始证据', () => {
  it.each(malformed)('%s不能被Node receipt掩盖', async (_, change) => {
    const model = await fixture(); corrupt(model, change);
    await expect(model.read()).rejects.toThrow(INTERVAL);
    expect(model.readSessions()[0].axReads).toBe(2);
    expect(model.readEvaluations().at(-1).request.validate).toBe(true);
    cleaned(model);
  });
  it.each([
    ['顶层nonce', focus => { focus.nonce = 'foreign'; }],
    ['顶层phase', focus => { focus.phase = 'tab'; }],
    ['顶层target', focus => { focus.targetId = 'foreign'; }],
    ['区间nonce', focus => { focus.rendererTiming.nonce = 'foreign'; }],
    ['区间phase', focus => { focus.rendererTiming.phase = 'tab'; }],
    ['区间target', focus => { focus.rendererTiming.targetId = 'foreign'; }],
  ])('%s变化不能取得当前身份信用', async (_, change) => {
    const model = await fixture(); corrupt(model, change);
    await expect(model.read()).rejects.toThrow(identityOrInterval);
    cleaned(model);
  });
  it('同一context重放旧probeNonce失败且新真实probe仍被清理', async () => {
    const model = await fixture(), first = await model.read();
    corrupt(model, focus => { focus.rendererTiming.probeNonce = first.rendererTiming.probeNonce; });
    await expect(model.read()).rejects.toThrow(RECEIPT);
    expect(model.readSessions()).toHaveLength(2);
    cleaned(model);
  });
});

describe('Node receipt区间与context身份', () => {
  it('真实finally完成后Node回拨到读起点之前仍失败', async () => {
    const model = await fixture(); model.afterAccessible = () => model.nodeClock.set(START + 99);
    await expect(model.read()).rejects.toThrow(RECEIPT);
    expect(model.accessibleReads).toBe(1);
    cleaned(model);
  });
  it('真实finally完成后receipt晚于截止不能返回成功', async () => {
    const model = await fixture(); model.afterAccessible = () => model.nodeClock.set(model.context.deadline + 1);
    await expect(model.read()).rejects.toThrow(RECEIPT);
    expect(model.accessibleReads).toBe(1);
    cleaned(model);
  });
  it('真实finally完成后的STOP先于receipt与成功返回', async () => {
    const model = await fixture(); model.afterAccessible = () => { model.f.stopped = true; };
    await expect(model.read()).rejects.toThrow('UNIT_STOPPED');
    expect(model.accessibleReads).toBe(1);
    cleaned(model);
  });
  it('phase在Node未来时不能由正常Renderer区间补偿', async () => {
    const model = await createDomClockModel().prepare({ phaseStartedAt: iso(START + 101) });
    await expect(model.read()).rejects.toThrow(RECEIPT);
    cleaned(model);
  });
  it.each([
    ['nonce', model => { model.context.nonce = 'changed'; }],
    ['phase', model => { model.context.phase = 'tab'; }],
    ['target', model => { model.node.id = 'changed'; }],
    ['phaseStartedAt', model => { model.context.phaseStartedAt = iso(START + 1); }],
    ['deadline', model => { model.context.deadline++; }],
  ])('完整await内%s改变拒绝旧结果', async (_, change) => {
    const model = await fixture(); model.afterAccessible = () => change(model);
    await expect(model.read()).rejects.toThrow(identityOrReceipt);
    cleaned(model);
  });
  it('读取入口缺失显式node.id不能以Renderer marker补齐', async () => {
    const model = await fixture();
    await expect(model.read({})).rejects.toThrow(IDENTITY);
    cleaned(model);
  });
});

describe('完整读取链仍受真实AX身份、取消和清理约束', () => {
  it.each(['backend', 'documentBackend'])('%s在两次AX间改变仍拒绝', async field => {
    const model = await fixture();
    model.f.onSend = (method, _params, session) => {
      if (method === 'DOM.getDocument' && session.axReads === 1) model.f[field] = 999;
    };
    await expect(model.read()).rejects.toThrow(field === 'backend' ? 'UI_AX_BACKEND_NODE_CHANGED' : 'UI_AX_DOCUMENT_IDENTITY_CHANGED');
    cleaned(model);
  });
  it.each(['marker', 'document', 'active', 'phase-closed', 'phase-replaced'])('最后真实AX await内%s变化仍由最终DOM校验拒绝', async scenario => {
    const model = await fixture();
    model.f.onSend = (method, _params, session) => {
      if (method !== 'Accessibility.getPartialAXTree' || session.axReads !== 1) return;
      if (scenario === 'marker') model.f.target.dataset.v16A11yNode = 'changed';
      if (scenario === 'document') model.f.target.ownerDocument = {};
      if (scenario === 'active') model.f.document.activeElement = model.f.element('other');
      if (scenario === 'phase-closed') model.f.window.__amazonAiOpsDomFocus.closed = true;
      if (scenario === 'phase-replaced') model.f.window.__amazonAiOpsDomFocus = { ...model.f.window.__amazonAiOpsDomFocus };
    };
    await expect(model.read()).rejects.toThrow('UI_AX_FINAL_DOM_IDENTITY_CHANGED');
    cleaned(model);
  });
  it.each(['DOM.resolveNode', 'Accessibility.getPartialAXTree', 'detach', 'finishProbe']
    .flatMap(boundary => ['stop', 'deadline'].map(reason => [boundary, reason])))(
    '%s真实await内%s不返回旧结果', async (boundary, reason) => {
      const model = await fixture(); let changed = false;
      const change = () => {
        if (changed) return; changed = true;
        if (reason === 'stop') model.f.stopped = true; else model.nodeClock.set(model.context.deadline + 1);
      };
      if (boundary === 'detach') model.f.onDetach = change;
      else if (boundary === 'finishProbe') model.f.onEvaluate = name => { if (name === 'finishProbe') change(); };
      else model.f.onSend = method => { if (method === boundary) change(); };
      await expect(model.read()).rejects.toThrow(reason === 'stop' ? 'UNIT_STOPPED' : 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
      expect(changed).toBe(true);
      cleaned(model);
    });
  it.each(['releaseFailure', 'detachFailure'])('%s不能把真实AX成功读取伪装成可接受结果', async scenario => {
    const model = await fixture(); model.f[scenario] = true;
    await expect(model.read()).rejects.toThrow(/UNIT_(?:RELEASE|DETACH)_FAILED/);
    cleaned(model);
  });
});
