import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describeElement } = require('./v16-ui-software-governance.js');
const { readNativeFocusMode } = require('./v16-ui-nvda-native-keys.js');
const { readDomFocus } = require('./v16-ui-nvda-dom-focus.js');
const { axModel } = require('./v16-ui-ax-test-model.cjs');
const { readActualAx, extractAx } = require('./v16-ui-ax-identity.js');
const { describeAccessibleElement, readAccessibleMode, readAccessibleCurrent, readAccessibleFocus, semanticRole } = require('./v16-ui-accessible-node.js');

describe('统一真实AX名称与精确DOM身份', () => {
  it.each(['今日总览 生产', 'API Key 必填 仅保存脱敏状态，页面不展示完整 Key。', '  空白必须逐字保留  '])(
    '实际名称%s逐字保留且不使用textContent或完整AX值', async name => {
      const f = axModel(); f.name = name;
      const node = await describeElement(f.locator, 'unit-node');
      expect(node).toMatchObject({ id: 'unit-node', name, role: 'tab', focusable: true });
      const current = await readAccessibleCurrent(f.locator, node, f.options());
      expect(Object.keys(current).sort()).toEqual(['id', 'name', 'role', 'activeElementId'].sort());
      expect(current.name).toBe(name);
      expect((await readNativeFocusMode(f.locator, node, f.options())).node).toEqual({ id: node.id, tabIndex: 0, role: 'tab', name, disabled: false, inert: false });
      expect(JSON.stringify(node) + JSON.stringify(current) + JSON.stringify(f.logs)).not.toContain('UNIT_SECRET_NEVER_PERSIST');
      expect(f.sessions.every(session => session.detached)).toBe(true);
      expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    });
  it.each(['ignored', 'empty', 'multiple', 'badBackend', 'duplicate', 'replaced', 'changeName', 'changeRole'])(
    '%s原件必须失败且回收自有CDP与nonce引用', async scenario => {
      const f = axModel(); f[scenario] = scenario === 'replaced' ? f.element('unit-node') : true;
      await expect(readActualAx(f.locator, f.options())).rejects.toThrow(/UI_AX_/);
      expect(f.sessions.every(session => session.detached)).toBe(true);
      expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
      expect(f.logs.some(log => log.event === 'v16.ui_accessible_node_failed')).toBe(true);
      expect(JSON.stringify(f.logs)).not.toContain('UNIT_SECRET_NEVER_PERSIST');
    });
  it.each(['backend', 'frame', 'loader', 'documentBackend'])(
    '预登记后的%s变化不能由同名同selector替换取得信用', async key => {
      const f = axModel(), node = await describeAccessibleElement(f.locator, 'unit-node');
      f[key] = ['frame', 'loader'].includes(key) ? 'changed' : 999;
      await expect(readAccessibleCurrent(f.locator, node, f.options())).rejects.toThrow('UI_AX_PREBOUND_TARGET_CHANGED');
      expect(f.sessions.every(session => session.detached)).toBe(true);
    });
  it.each(['stop', 'deadline'])(
    '任一CDP await期间%s后禁止继续AX读取并清理元数据', async scenario => {
      const f = axModel(), options = f.options();
      f.onSend = method => { if (method === 'DOM.resolveNode') {
        if (scenario === 'stop') f.stopped = true; else options.deadline = Date.now() - 1;
      } };
      await expect(readActualAx(f.locator, options)).rejects.toThrow(scenario === 'stop' ? 'UNIT_STOPPED' : 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
      expect(f.calls.filter(call => call.method === 'Accessibility.getPartialAXTree')).toHaveLength(0);
      expect(f.sessions.every(session => session.detached)).toBe(true);
      expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    });
  it.each(['Page.getFrameTree', 'DOM.getDocument', 'DOM.querySelectorAll', 'DOM.describeNode', 'DOM.resolveNode',
    'Runtime.callFunctionOn', 'Accessibility.getPartialAXTree'].flatMap(method => ['stop', 'deadline'].map(reason => [method, reason])))(
    '%s完成时%s只允许自有清理、不继续下一步查询', async (method, reason) => {
      const f = axModel(), options = f.options(); let cutoff;
      f.onSend = current => { if (current === method && cutoff === undefined) {
        cutoff = f.calls.length; if (reason === 'stop') f.stopped = true; else options.deadline = Date.now() - 1;
      } };
      await expect(readActualAx(f.locator, options)).rejects.toThrow(reason === 'stop' ? 'UNIT_STOPPED' : 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
      expect(f.calls.slice(cutoff).every(call => call.method === 'Runtime.releaseObject')).toBe(true);
      expect(f.sessions.every(session => session.detached)).toBe(true);
      expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    });
  it.each(['   ', '单行\n第二行'])('无实际名称或多行名称%s不能成为预登记期望', async name => {
    const f = axModel(); f.name = name;
    await expect(describeAccessibleElement(f.locator, 'unit-node')).rejects.toThrow('UI_AX_ACTUAL_NODE_INVALID');
  });
  it.each(['marker', 'document', 'active', 'phase-closed', 'phase-replaced'])(
    '最后AX await期间%s变化不能返回旧focus或身份证明', async scenario => {
      const f = axModel(), node = await describeAccessibleElement(f.locator, 'unit-node');
      const context = { nonce: 'unit-final', phase: 'first-focus', deadline: Date.now() + 10000 };
      f.window.__amazonAiOpsDomFocus = { ...context, closed: false, target: f.target, before: f.target };
      f.onSend = (method, params, session) => { if (method === 'Accessibility.getPartialAXTree' && session.axReads === 1) {
        if (scenario === 'marker') f.target.dataset.v16A11yNode = 'changed';
        if (scenario === 'document') f.target.ownerDocument = {};
        if (scenario === 'active') f.document.activeElement = f.element('other');
        if (scenario === 'phase-closed') f.window.__amazonAiOpsDomFocus.closed = true;
        if (scenario === 'phase-replaced') f.window.__amazonAiOpsDomFocus = { ...f.window.__amazonAiOpsDomFocus };
      } };
      await expect(readAccessibleFocus(f.page, context, node, { ...f.options(), deadline: context.deadline })).rejects.toThrow('UI_AX_FINAL_DOM_IDENTITY_CHANGED');
      expect(f.sessions.every(session => session.detached)).toBe(true);
      expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    });
  it.each(['detach', 'probe-delete'].flatMap(boundary => ['stop', 'deadline'].map(reason => [boundary, reason])))(
    '最后清理%s await期间%s仍不能成功返回模式或元数据', async (boundary, reason) => {
      const f = axModel(), options = f.options();
      const change = () => { if (reason === 'stop') f.stopped = true; else options.deadline = Date.now() - 1; };
      if (boundary === 'detach') f.onDetach = change;
      else f.onEvaluate = name => { if (name === 'finishProbe') change(); };
      await expect(readActualAx(f.locator, options)).rejects.toThrow(reason === 'stop' ? 'UNIT_STOPPED' : 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
      expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
      expect(f.sessions.every(session => session.detached)).toBe(true);
    });
  it.each(['releaseFailure', 'detachFailure'])(
    '%s不能吸收首错或让成功读取掩盖清理失败', async scenario => {
      const f = axModel(); f[scenario] = true; f.badBackend = true;
      await expect(readActualAx(f.locator, f.options())).rejects.toThrow('UI_AX_ACTUAL_NODE_INVALID');
      expect(f.logs.some(log => log.metadata.cleanupOnly === true)).toBe(true);
      expect(f.sessions.every(session => session.detached)).toBe(true);
      expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
      const g = axModel(); g[scenario] = true;
      await expect(readActualAx(g.locator, g.options())).rejects.toThrow(/UNIT_(RELEASE|DETACH)_FAILED/);
    });
  it('Tab中间active的实际AX名称独立于原目标并保留精确focus字段', async () => {
    const f = axModel(), node = await describeAccessibleElement(f.locator, 'unit-node');
    const context = { nonce: 'unit-phase', phase: 'tab', phaseStartedAt: new Date().toISOString(), deadline: Date.now() + 10000 };
    f.window.__amazonAiOpsDomFocus = { ...context, closed: false, target: f.target, before: f.target };
    f.document.activeElement = f.element('next', 'textbox'); f.name = '下一 输入项'; f.role = 'textbox';
    const current = await readDomFocus({ page: f.page }, context, context.deadline, node, f.options().assertActive);
    expect(current).toMatchObject({ name: '下一 输入项', role: 'textbox', sameTarget: false, sameBefore: false, targetId: node.id });
    expect(Object.keys(current).sort()).toEqual(['nonce', 'phase', 'observedAt', 'documentFocused', 'targetConnected',
      'activeConnected', 'sameTarget', 'sameBefore', 'targetId', 'name', 'role', 'rendererObservedAt', 'rendererTiming', 'collectorTiming'].sort());
  });
  it('已关闭phase与跨nonce不能建立active探针', async () => {
    const f = axModel(), context = { nonce: 'current', phase: 'tab', deadline: Date.now() + 10000 };
    f.window.__amazonAiOpsDomFocus = { ...context, nonce: 'other', closed: false, target: f.target };
    expect(await readAccessibleFocus(f.page, context, {}, f.options())).toBeNull();
    expect(f.sessions).toHaveLength(0);
    f.window.__amazonAiOpsDomFocus = { ...context, closed: true, target: f.target };
    expect(await readAccessibleFocus(f.page, context, {}, f.options())).toBeNull();
  });
  it('host当前焦点即使具有相同marker仍必须是预登记真实对象', async () => {
    const f = axModel(), node = await describeAccessibleElement(f.locator, 'unit-node');
    f.document.activeElement = f.element('unit-node');
    await expect(readAccessibleCurrent(f.locator, node, { ...f.options(), requireActiveTarget: true })).rejects.toThrow('UI_AX_EXACT_DOM_REFERENCE_CHANGED');
  });
  it('仅SUMMARY与DisclosureTriangle组合映射现button，不接受heading或任意div', () => {
    expect(semanticRole({ tagName: 'SUMMARY', declaredRole: null }, { rawRole: 'DisclosureTriangle' })).toBe('button');
    expect(() => semanticRole({ tagName: 'SUMMARY', declaredRole: null }, { rawRole: 'heading' })).toThrow('UI_AX_SEMANTIC_ROLE_MISMATCH');
    expect(() => semanticRole({ tagName: 'DIV', declaredRole: null }, { rawRole: 'DisclosureTriangle' })).toThrow('UI_AX_SEMANTIC_ROLE_MISMATCH');
    expect(() => extractAx({ nodes: [] }, 20)).toThrow('UI_AX_ONE_ACTUAL_NODE_REQUIRED');
  });
  it('原生UL只接受真实list角色，显式role仍优先', () => {
    expect(semanticRole({ tagName: 'UL', declaredRole: null }, { rawRole: 'list' })).toBe('list');
    for (const rawRole of ['group', 'heading']) {
      expect(() => semanticRole({ tagName: 'UL', declaredRole: null }, { rawRole })).toThrow('UI_AX_SEMANTIC_ROLE_MISMATCH');
    }
    expect(semanticRole({ tagName: 'UL', declaredRole: 'group' }, { rawRole: 'group' })).toBe('group');
    expect(() => semanticRole({ tagName: 'UL', declaredRole: 'group' }, { rawRole: 'list' })).toThrow('UI_AX_SEMANTIC_ROLE_MISMATCH');
  });
  it.each(['DIV', 'OL'])('%s保持既有group回退且不扩大为list', tagName => {
    expect(semanticRole({ tagName, declaredRole: null }, { rawRole: 'group' })).toBe('group');
    expect(() => semanticRole({ tagName, declaredRole: null }, { rawRole: 'list' })).toThrow('UI_AX_SEMANTIC_ROLE_MISMATCH');
  });
  it('SUMMARY确定映射与显式role边界保持不变', () => {
    expect(semanticRole({ tagName: 'SUMMARY', declaredRole: null }, { rawRole: 'DisclosureTriangle' })).toBe('button');
    expect(semanticRole({ tagName: 'SUMMARY', declaredRole: 'group' }, { rawRole: 'group' })).toBe('group');
    expect(() => semanticRole({ tagName: 'SUMMARY', declaredRole: 'group' }, { rawRole: 'DisclosureTriangle' })).toThrow('UI_AX_SEMANTIC_ROLE_MISMATCH');
  });
  function nativeUlModel() {
    const f = axModel(); f.target.tagName = 'UL'; delete f.target.attrs.role;
    f.name = '最终校验安全门'; f.role = 'list';
    return f;
  }
  function assertUlCleanup(f) {
    expect(f.sessions.length).toBeGreaterThan(0);
    expect(f.sessions.every(session => session.detached)).toBe(true);
    expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    expect(JSON.stringify(f.logs)).not.toContain('UNIT_SECRET_NEVER_PERSIST');
  }
  it('原生UL经真实AX预登记和焦点读取仍绑定身份、双时钟与清理', async () => {
    const f = nativeUlModel(), node = await describeAccessibleElement(f.locator, 'unit-node');
    expect(node).toMatchObject({ id: 'unit-node', name: '最终校验安全门', role: 'list', focusable: true });
    const context = { nonce: 'unit-native-ul', phase: 'target-focus', phaseStartedAt: new Date().toISOString(), deadline: Date.now() + 10000 };
    f.window.__amazonAiOpsDomFocus = { ...context, closed: false, target: f.target, before: f.target };
    const focus = await readAccessibleFocus(f.page, context, node, { ...f.options(), deadline: context.deadline });
    expect(focus).toMatchObject({ nonce: context.nonce, phase: context.phase, targetId: node.id,
      name: node.name, role: 'list', targetConnected: true, activeConnected: true, sameTarget: true });
    expect(focus.rendererTiming).toMatchObject({ kind: 'v16-dom-renderer-interval', clock: 'renderer-wall', targetId: node.id });
    const current = await readDomFocus({ page: f.page }, context, context.deadline, node, f.options().assertActive);
    expect(current).toMatchObject({ name: node.name, role: 'list', targetId: node.id, sameTarget: true });
    expect(current.rendererTiming.clock).toBe('renderer-wall');
    expect(current.collectorTiming).toMatchObject({ kind: 'v16-dom-collector-receipt', clock: 'collector-node-wall', targetId: node.id });
    expect(current.observedAt).toBe(current.collectorTiming.receivedAt);
    expect(current.rendererObservedAt).toBe(current.rendererTiming.finishedAt);
    expect(Date.parse(current.collectorTiming.readStartedAt)).toBeGreaterThanOrEqual(Date.parse(context.phaseStartedAt));
    expect(Date.parse(current.collectorTiming.receivedAt)).toBeLessThanOrEqual(context.deadline);
    assertUlCleanup(f);
  });
  it.each(['backend', 'name-change', 'stop', 'deadline'])('原生UL的%s失败仍拒绝焦点并回收探针', async scenario => {
    const f = nativeUlModel(), node = await describeAccessibleElement(f.locator, 'unit-node');
    const context = { nonce: 'unit-native-ul-failure', phase: 'target-focus', phaseStartedAt: new Date().toISOString(), deadline: Date.now() + 10000 };
    f.window.__amazonAiOpsDomFocus = { ...context, closed: false, target: f.target, before: f.target };
    const options = { ...f.options(), deadline: context.deadline }, originalNow = Date.now;
    if (scenario === 'backend') f.backend = 999;
    if (scenario === 'name-change') f.changeName = true;
    if (scenario === 'stop' || scenario === 'deadline') f.onSend = method => {
      if (method === 'Accessibility.getPartialAXTree') {
        if (scenario === 'stop') f.stopped = true; else Date.now = () => context.deadline + 1;
      }
    };
    const codes = { backend: 'UI_AX_PREBOUND_TARGET_CHANGED', 'name-change': 'UI_AX_NAME_OR_ROLE_CHANGED',
      stop: 'UNIT_STOPPED', deadline: 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED' };
    try { await expect(readAccessibleFocus(f.page, context, node, options)).rejects.toThrow(codes[scenario]); }
    finally { Date.now = originalNow; }
    assertUlCleanup(f);
    expect(f.logs.some(log => log.event === 'v16.ui_accessible_node_failed')).toBe(true);
  });
});


describe('同次AX身份判定有限诊断', () => {
  function observeActualProofs(f, transform) {
    const observed = [], context = f.page.context.bind(f.page);
    f.page.context = () => {
      const actualContext = context();
      return { ...actualContext, async newCDPSession(...args) {
        const session = await actualContext.newCDPSession(...args), send = session.send.bind(session);
        session.send = async (method, params) => {
          const response = await send(method, params);
          if (method !== 'Runtime.callFunctionOn') return response;
          observed.push(response.result?.value);
          // 只损坏真实回调之后的传输响应，不替换生产身份谓词。
          return transform ? transform(response) : response;
        };
        return session;
      } };
    };
    return observed;
  }
  function diagnostic(f) {
    return f.logs.find(row => row.event === 'v16.ui_accessible_node_failed' && row.metadata.axReferenceProofs)?.metadata.axReferenceProofs;
  }
  function assertCleanup(f) {
    expect(f.sessions.every(session => session.detached)).toBe(true);
    expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    expect(JSON.stringify(f.logs)).not.toContain('UNIT_SECRET_NEVER_PERSIST');
  }
  it('真实同次判定返回固定26门且不增加CDP查询或改变通过值', async () => {
    const f = axModel(), proofs = observeActualProofs(f);
    await readActualAx(f.locator, f.options());
    expect(proofs).toHaveLength(2);
    for (const proof of proofs) {
      expect(Object.keys(proof).sort()).toEqual(['gates', 'kind', 'schemaVersion', 'valid']);
      expect(proof).toMatchObject({ kind: 'v16-ax-dom-proof', schemaVersion: 1, valid: true });
      expect(proof.gates).toHaveLength(26);
      expect(proof.gates.slice(0, 13)).toEqual(Array(13).fill(true));
      expect(proof.gates.slice(13)).toEqual([true, null, true, ...Array(8).fill(null), false, true]);
    }
    for (const method of ['Page.getFrameTree', 'DOM.getDocument', 'DOM.querySelectorAll', 'DOM.describeNode',
      'DOM.resolveNode', 'Runtime.callFunctionOn', 'Accessibility.getPartialAXTree', 'Runtime.releaseObject']) {
      expect(f.calls.filter(call => call.method === method)).toHaveLength(2);
    }
    assertCleanup(f);
  });
  it('同selector对象替换只记录原短路前两门且不读取后续DOM属性', async () => {
    const f = axModel(); f.replaced = f.element('unit-node');
    const proofs = observeActualProofs(f); let forbiddenReads = 0;
    f.onSend = method => { if (method === 'Runtime.callFunctionOn') {
      Object.defineProperty(f.target, 'isConnected', { configurable: true, get() {
        forbiddenReads++; throw new Error('UNIT_FORBIDDEN_DOM_RESAMPLE');
      } });
    } };
    await expect(readActualAx(f.locator, f.options())).rejects.toThrow('UI_AX_EXACT_DOM_REFERENCE_CHANGED');
    expect(forbiddenReads).toBe(0); expect(proofs).toHaveLength(1);
    expect(proofs[0].gates).toEqual([true, false, ...Array(24).fill(null)]);
    expect(diagnostic(f)).toEqual([{ kind: 'v16-ax-dom-proof-observation', schemaVersion: 1,
      resolveKind: 'element', resolveNumber: 1, exceptionPresent: false, booleanResult: false,
      booleanResultTrue: false, envelopeValid: true, gates: proofs[0].gates }]);
    expect(f.calls.filter(call => call.method === 'Accessibility.getPartialAXTree')).toHaveLength(0);
    assertCleanup(f);
  });
  it('活动目标不一致时只记录原active比较false且后续状态门不求值', async () => {
    const f = axModel(), proofs = observeActualProofs(f);
    f.document.activeElement = f.element('unit-node');
    await expect(readActualAx(f.locator, { ...f.options(), requireActiveTarget: true })).rejects.toThrow('UI_AX_EXACT_DOM_REFERENCE_CHANGED');
    expect(proofs).toHaveLength(1);
    expect(proofs[0].gates).toEqual([...Array(13).fill(true), false, false, ...Array(11).fill(null)]);
    expect(diagnostic(f)[0]).toMatchObject({ resolveKind: 'element', resolveNumber: 1,
      exceptionPresent: false, booleanResult: false, booleanResultTrue: false, envelopeValid: true });
    assertCleanup(f);
  });
  it('后续AX失败保留原四次element与target判定的真实序号和通过值', async () => {
    const f = axModel(), proofs = observeActualProofs(f); f.changeName = true;
    await expect(readActualAx(f.locator, { ...f.options(), active: true })).rejects.toThrow('UI_AX_NAME_OR_ROLE_CHANGED');
    expect(proofs).toHaveLength(4);
    expect(diagnostic(f).map(row => [row.resolveKind, row.resolveNumber])).toEqual([
      ['element', 1], ['target', 2], ['element', 3], ['target', 4],
    ]);
    expect(diagnostic(f).every(row => row.exceptionPresent === false && row.booleanResult === true
      && row.booleanResultTrue === true && row.envelopeValid === true)).toBe(true);
    assertCleanup(f);
  });
  it.each(['legacy-boolean', 'unknown-version', 'extra-field', 'invalid-gate', 'incoherent-trace', 'exception'])(
    '真实生产回调后的%s传输损坏失败关闭且不保存未知内容', async mode => {
      const f = axModel(), proofs = observeActualProofs(f, response => {
        const value = response.result.value;
        if (mode === 'exception') return { ...response, exceptionDetails: { text: 'UNIT_SECRET_NEVER_PERSIST' } };
        if (mode === 'legacy-boolean') return { ...response, result: { ...response.result, value: true } };
        const changed = { ...value };
        if (mode === 'unknown-version') changed.schemaVersion = 2;
        if (mode === 'extra-field') changed.unknown = 'UNIT_SECRET_NEVER_PERSIST';
        if (mode === 'invalid-gate') changed.gates = ['UNIT_SECRET_NEVER_PERSIST', ...value.gates.slice(1)];
        if (mode === 'incoherent-trace') changed.gates = [false, ...value.gates.slice(1)];
        return { ...response, result: { ...response.result, value: changed } };
      });
      await expect(readActualAx(f.locator, f.options())).rejects.toThrow('UI_AX_EXACT_DOM_REFERENCE_CHANGED');
      expect(proofs).toHaveLength(1);
      expect(proofs[0]).toMatchObject({ kind: 'v16-ax-dom-proof', schemaVersion: 1, valid: true });
      expect(diagnostic(f)).toHaveLength(1);
      expect(diagnostic(f)[0].exceptionPresent).toBe(mode === 'exception');
      expect(diagnostic(f)[0].envelopeValid).toBe(mode === 'exception');
      expect(JSON.stringify(f.logs)).not.toContain('UNIT_SECRET_NEVER_PERSIST');
      assertCleanup(f);
    });
});

describe('交接未准备时不创建AX探针', () => {
  it.each(['before', 'target'])('%s仍活动时只返回pending，真正交接后完整证明且后续引用失配仍失败', async pending => {
    const f = axModel(), node = await describeAccessibleElement(f.locator, 'unit-node');
    const context = { nonce: 'unit-pending-' + pending, phase: 'target-handoff',
      phaseStartedAt: new Date().toISOString(), deadline: Date.now() + 10000 };
    const before = f.element('unit-before', 'button');
    f.window.__amazonAiOpsDomFocus = { ...context, closed: false, target: f.target, before };
    f.document.activeElement = pending === 'before' ? before : f.target;
    const probes = f.window.__amazonAiOpsAxProbes, set = probes.set; let insertions = 0;
    probes.set = function(...args) { insertions++; return Reflect.apply(set, this, args); };
    const callsBefore = f.calls.length, sessionsBefore = f.sessions.length;
    const options = { ...f.options(), deadline: context.deadline };
    expect(await readAccessibleFocus(f.page, context, node, options)).toBeNull();
    expect(insertions).toBe(0); expect(probes.size).toBe(0);
    expect(f.calls).toHaveLength(callsBefore); expect(f.sessions).toHaveLength(sessionsBefore);
    expect(f.logs).toHaveLength(0);

    f.document.activeElement = f.element('unit-handoff', 'button');
    f.name = '交接后的实际按钮'; f.role = 'button';
    const current = await readAccessibleFocus(f.page, context, node, options);
    expect(current).toMatchObject({ nonce: context.nonce, phase: 'target-handoff',
      targetId: node.id, sameTarget: false, sameBefore: false, name: f.name, role: 'button' });
    expect(insertions).toBe(1); expect(probes.size).toBe(0);
    const acceptedCalls = f.calls.slice(callsBefore);
    expect(acceptedCalls.filter(call => call.method === 'Runtime.callFunctionOn')).toHaveLength(4);
    expect(acceptedCalls.filter(call => call.method === 'Accessibility.getPartialAXTree')).toHaveLength(2);
    expect(acceptedCalls.filter(call => call.method === 'Runtime.releaseObject')).toHaveLength(4);
    expect(f.sessions.every(session => session.detached)).toBe(true);
    expect(f.logs).toHaveLength(0);

    const failureStart = f.calls.length;
    f.onSend = method => { if (method === 'DOM.querySelectorAll') {
      f.document.activeElement = f.element('unit-replaced-active', 'button'); f.onSend = null;
    } };
    await expect(readAccessibleFocus(f.page, context, node, options)).rejects.toThrow('UI_AX_EXACT_DOM_REFERENCE_CHANGED');
    expect(f.calls.slice(failureStart).filter(call => call.method === 'Accessibility.getPartialAXTree')).toHaveLength(0);
    expect(f.calls.slice(failureStart).filter(call => call.method === 'Runtime.callFunctionOn')).toHaveLength(1);
    expect(probes.size).toBe(0); expect(f.sessions.every(session => session.detached)).toBe(true);
    const failure = f.logs.find(row => row.event === 'v16.ui_accessible_node_failed');
    expect(failure.metadata.axReferenceProofs).toHaveLength(1);
    expect(failure.metadata.axReferenceProofs[0].gates).toEqual([true, false, ...Array(24).fill(null)]);
  });
});

describe('焦点阶段准备条件先于AX探针准入', () => {
  const { waitDomFocus: waitRegisteredPhase } = require('./v16-ui-nvda-dom-focus.js');
  function phaseFixture(phase) {
    const f = axModel();
    return describeAccessibleElement(f.locator, 'unit-node').then(node => {
      const start = Date.now(), context = Object.freeze({ nonce: 'unit-phase-admission-' + phase, phase,
        phaseStartedAt: new Date(start).toISOString(), deadline: start + 10000 });
      const before = f.element('unit-before', 'button');
      f.window.__amazonAiOpsDomFocus = { ...context, closed: false, target: f.target, before };
      f.document.activeElement = phase === 'tab' ? f.target : before;
      const probes = f.window.__amazonAiOpsAxProbes, insert = probes.set;
      const observed = { insertions: 0, probeReads: [], requests: [] };
      probes.set = function(...args) { observed.insertions++; return Reflect.apply(insert, this, args); };
      return { f, node, context, before, observed, callsBefore: f.calls.length, sessionsBefore: f.sessions.length };
    });
  }
  it.each(['first-focus', 'target-focus', 'tab'])('%s等待旧焦点完成既定过渡再在原十秒内取得证明', async phase => {
    const { f, node, context, observed, callsBefore, sessionsBefore } = await phaseFixture(phase);
    const original = { ...context }, ready = phase === 'tab' ? f.element('unit-next', 'tab') : f.target;
    f.onEvaluate = (name, request) => {
      if (name !== 'registerProbe') return;
      observed.requests.push({ deadline: request.deadline, context: { ...request.context } });
      observed.probeReads.push(f.window.__amazonAiOpsAxProbes.size);
      if (observed.requests.length === 1) f.document.activeElement = ready;
    };
    const value = await waitRegisteredPhase({ page: f.page }, context, node, context.deadline, f.options().assertActive);
    expect(value).toMatchObject({ nonce: context.nonce, phase, targetId: node.id, sameTarget: phase !== 'tab' });
    expect(observed.requests).toHaveLength(2); expect(observed.probeReads).toEqual([0, 1]);
    expect(observed.requests.every(row => row.deadline === original.deadline
      && row.context.nonce === original.nonce && row.context.phase === original.phase
      && row.context.deadline === original.deadline && row.context.phaseStartedAt === original.phaseStartedAt)).toBe(true);
    expect(context).toEqual(original); expect(original.deadline - Date.parse(original.phaseStartedAt)).toBe(10000);
    expect(Date.now()).toBeLessThanOrEqual(original.deadline);
    expect(observed.insertions).toBe(1); expect(f.sessions.length - sessionsBefore).toBe(1);
    expect(f.calls.slice(callsBefore).filter(call => call.method === 'Runtime.callFunctionOn')).toHaveLength(4);
    expect(f.calls.slice(callsBefore).filter(call => call.method === 'Accessibility.getPartialAXTree')).toHaveLength(2);
    expect(f.sessions.every(session => session.detached)).toBe(true);
    expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
  });
  it.each(['first-focus', 'target-focus', 'tab'])('%s尚未达到原谓词时没有探针、CDP或错误重试', async phase => {
    const { f, node, context, observed, callsBefore, sessionsBefore } = await phaseFixture(phase);
    const original = { ...context };
    expect(await readAccessibleFocus(f.page, context, node, { ...f.options(), deadline: context.deadline })).toBeNull();
    expect(observed.insertions).toBe(0); expect(f.calls).toHaveLength(callsBefore);
    expect(f.sessions).toHaveLength(sessionsBefore); expect(f.logs).toHaveLength(0);
    expect(f.window.__amazonAiOpsAxProbes.size).toBe(0); expect(context).toEqual(original);
  });
  it.each(['first-focus', 'target-focus', 'tab'])('%s准入后对象变化仍立即失败，不能被等待吞掉', async phase => {
    const { f, node, context, observed, callsBefore } = await phaseFixture(phase);
    f.document.activeElement = phase === 'tab' ? f.element('unit-next', 'tab') : f.target;
    f.onSend = method => {
      if (method !== 'DOM.querySelectorAll') return;
      f.document.activeElement = f.element('unit-changed', 'tab'); f.onSend = null;
    };
    await expect(readAccessibleFocus(f.page, context, node, { ...f.options(), deadline: context.deadline }))
      .rejects.toThrow('UI_AX_EXACT_DOM_REFERENCE_CHANGED');
    expect(observed.insertions).toBe(1);
    expect(f.calls.slice(callsBefore).filter(call => call.method === 'Runtime.callFunctionOn')).toHaveLength(1);
    expect(f.calls.slice(callsBefore).filter(call => call.method === 'Accessibility.getPartialAXTree')).toHaveLength(0);
    expect(f.sessions.every(session => session.detached)).toBe(true); expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    const failure = f.logs.find(row => row.event === 'v16.ui_accessible_node_failed');
    expect(failure.metadata.axReferenceProofs[0].gates).toEqual([true, false, ...Array(24).fill(null)]);
  });
  it.each(['target-disconnected', 'active-disconnected', 'foreign-document', 'subframe'])(
    'pending之前的%s边界仍拒绝且没有探针或CDP', async reason => {
      const { f, node, context, before, observed, callsBefore, sessionsBefore } = await phaseFixture('target-focus');
      if (reason === 'target-disconnected') f.target.isConnected = false;
      if (reason === 'active-disconnected') before.isConnected = false;
      if (reason === 'foreign-document') before.ownerDocument = {};
      if (reason === 'subframe') f.window.top = {};
      await expect(readAccessibleFocus(f.page, context, node, { ...f.options(), deadline: context.deadline }))
        .rejects.toThrow('UI_AX_EXACT_MAIN_FRAME_ELEMENT_REQUIRED');
      expect(observed.insertions).toBe(0); expect(f.calls).toHaveLength(callsBefore);
      expect(f.sessions).toHaveLength(sessionsBefore); expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    });
  it.each(['stop', 'deadline'])('pending后的%s不重置原截止且不能进入AX读取', async reason => {
    const { f, node, context, observed, callsBefore, sessionsBefore } = await phaseFixture('target-focus');
    const originalNow = Date.now, original = { ...context };
    f.onEvaluate = name => { if (name === 'registerProbe') {
      if (reason === 'stop') f.stopped = true; else Date.now = () => context.deadline + 1;
    } };
    try {
      await expect(waitRegisteredPhase({ page: f.page }, context, node, context.deadline, f.options().assertActive))
        .rejects.toThrow(reason === 'stop' ? 'UNIT_STOPPED' : 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
    } finally { Date.now = originalNow; }
    expect(observed.insertions).toBe(0); expect(f.calls).toHaveLength(callsBefore);
    expect(f.sessions).toHaveLength(sessionsBefore); expect(f.window.__amazonAiOpsAxProbes.size).toBe(0);
    expect(context).toEqual(original);
  });
});

