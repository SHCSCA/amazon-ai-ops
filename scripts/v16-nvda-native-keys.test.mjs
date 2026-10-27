import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const { loadWithAccessiblePort } = require('./v16-ui-accessible-test-loader.cjs');
const { validateNativeKeysAck, readNativeFocusMode } = loadWithAccessiblePort('./v16-ui-nvda-native-keys.js');
const { armNativeKeyEvents, closeNativeKeyEvents, validateNativeKeyProcessing } = require('./v16-ui-nvda-native-key-events.js');

function fixture(action = 'Tab') {
  const start = new Date(Date.now() - 100).toISOString(), end = new Date(Date.parse(start) + 10000).toISOString();
  const binding = { main: { pid: 1234, handleCreationTimeUtc: '2026-10-20T08:00:00.1234567Z' }, window: { rootHwnd: '1000' } };
  const request = { kind: 'nvda-owned-native-keys-request', schemaVersion: 1, runToken: '22222222-2222-4222-8222-222222222222',
    pid: 789, nonce: '33333333-3333-4333-8333-333333333333', nodeSequence: 1, nodeNonce: '44444444-4444-4444-8444-444444444444',
    nodeId: 'unit-node', focusMode: 'sequential', phase: action === 'Tab' ? 'tab' : 'target-focus', action, phaseStartedAt: start, startedAt: start, deadlineAt: end };
  const held = [], owner = () => ({ mainPid: 1234, mainAlive: true, handleCreationTimeUtc: binding.main.handleCreationTimeUtc,
    mainExeMatches: true, rootHwnd: '1000', activeHwnd: '1000', focusHwnd: '1001', focusOwnerPid: 1234,
    focusAncestorHwnd: '1000', inputDesktopMatched: true, otherInputReleased: true, heldKeys: [...held] });
  const events = action === 'Tab' ? [[9, 0], [9, 2]] : [[160, 0], [9, 0], [9, 2], [160, 2]];
  const steps = events.map(([key, flags], index) => {
    const step = { index, key, flags, accepted: 1, proof: owner(), beforeInputAt: start, timestamp: start };
    if (flags === 0) held.push(key); else held.splice(held.indexOf(key), 1); return step;
  });
  const ack = { ...request, observedAt: start, result: { passed: true, reason: 'COMPLETE', requestedEvents: events.length,
    acceptedEvents: events.length, sendInputCalls: events.length, steps, afterProof: owner(), cleanupOnly: false,
    cleanupAttempted: false, cleanupAcceptedEvents: 0, cleanupKeys: [], cleanupKeysReleased: true, cleanupErrors: [], atomicTargetGuarantee: false } };
  return { request, binding, ack };
}

describe('原生窄按键ACK只授本次输入元数据', () => {
  it.each(['Tab', 'ShiftTab'])('%s每个事件独立确认且不提升原子目标或自然语音信用', action => {
    const value = fixture(action);
    expect(validateNativeKeysAck(value.ack, value.request, value.binding)).toBe(value.ack);
  });
  it.each(['nonce', 'token', 'pid', 'sequence', 'node', 'phase', 'action', 'unknown', 'future', 'partial', 'cleanup',
    'atomic', 'owner', 'birth', 'foreground', 'desktop', 'held', 'key', 'up', 'calls', 'step-time'])(
    '拒绝%s的ACK而不把清理或其他owner当作当前输入', scenario => {
      const value = fixture(), a = value.ack, r = a.result;
      const changes = {
        nonce: () => { a.nonce = value.request.nodeNonce; }, token: () => { a.runToken = value.request.nodeNonce; },
        pid: () => { a.pid++; }, sequence: () => { a.nodeSequence++; }, node: () => { a.nodeNonce = a.nonce; },
        phase: () => { a.phase = 'target-focus'; }, action: () => { a.action = 'Enter'; }, unknown: () => { a.extra = true; },
        future: () => { a.observedAt = new Date(Date.now() + 1000).toISOString(); }, partial: () => { r.acceptedEvents = 1; },
        cleanup: () => { r.cleanupOnly = true; }, atomic: () => { r.atomicTargetGuarantee = true; },
        owner: () => { r.afterProof.mainPid++; }, birth: () => { r.afterProof.handleCreationTimeUtc = '2020-01-01T00:00:00.0000000Z'; },
        foreground: () => { r.steps[0].proof.activeHwnd = '2000'; }, desktop: () => { r.steps[0].proof.inputDesktopMatched = false; },
        held: () => { r.steps[0].proof.heldKeys = [9]; }, key: () => { r.steps[0].key = 13; }, up: () => { r.steps[1].flags = 0; },
        calls: () => { r.sendInputCalls++; }, 'step-time': () => { r.steps[0].timestamp = '2020-01-01T00:00:00.000Z'; },
      };
      changes[scenario](); expect(() => validateNativeKeysAck(a, value.request, value.binding)).toThrow(/UI_NVDA_NATIVE_KEYS_/);
    });
});

describe('真实Python原生按键消费及WinAPI隔离端口', () => {
  it.each(['tab', 'shift', 'replay', 'token', 'pid', 'node', 'unknown', 'action', 'phase', 'sequence', 'future', 'over-budget',
    'reused-foreground', 'reused-focus', 'reused-speech', 'expired', 'birth', 'exe', 'foreground', 'root-owner', 'focus-owner',
    'gui-active', 'gui-focus', 'gui-capture', 'gui-api', 'desktop-open', 'desktop-api', 'desktop-close', 'desktop-mismatch',
    'hidden', 'held-tab', 'held-shift', 'held-control', 'held-mouse', 'partial', 'shift-partial', 'cleanup-send-failure',
    'cleanup-query-failure', 'owner-after-down', 'expired-after-down', 'stop-after-down', 'stop-priority', 'processing-busy', 'send-api'])(
    '%s只发限定输入并保持单事件账本及失败不重试', scenario => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-keys-unit-'));
      const output = execFileSync('python', ['-B', path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
        path.resolve('scripts/v16-nvda-speech-observer.py'), 'native-keys', scenario], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      expect(JSON.parse(output)).toEqual({ isolatedModel: true, scenario, nativeOnly: true, speechCredit: false,
        singleEventLedger: true, originalDeadlinePreserved: true, failedDownNotRetried: true });
    });
});

describe('原生回焦策略在动作前按实际节点登记', () => {
  it.each(['ordinary', 'dialog', 'negative-button', 'unnamed', 'disabled', 'inert', 'wrong-id'])(
    '%s不能按按键失败结果临时扩大ARIA回焦路径', async scenario => {
      const node = { id: 'unit-node', name: '当前操作', role: scenario === 'dialog' ? 'dialog' : 'button' };
      const meta = { id: node.id, name: node.name, role: node.role, tabIndex: ['dialog', 'negative-button'].includes(scenario) ? -1 : 0,
        disabled: scenario === 'disabled', inert: scenario === 'inert' };
      if (scenario === 'unnamed') meta.name = '';
      if (scenario === 'wrong-id') meta.id = 'other-node';
      const locator = { evaluate: async () => meta };
      if (['ordinary', 'dialog'].includes(scenario)) {
        expect((await readNativeFocusMode(locator, node)).mode).toBe(scenario === 'dialog' ? 'named-dialog-container' : 'sequential');
      } else await expect(readNativeFocusMode(locator, node)).rejects.toThrow(
        ['unnamed', 'wrong-id'].includes(scenario) ? 'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED' : 'UI_NVDA_NATIVE_FOCUS_MODE_INVALID');
    });
});

function rendererEventsPort() {
  const listeners = new Map(), frames = [], window = {};
  const context = vm.createContext({ window, Date, setTimeout, clearTimeout,
    requestAnimationFrame: callback => frames.push(callback),
    document: { addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); } } });
  return { window, frames, listeners, runtime: { page: { evaluate: async (callback, request) =>
    vm.runInContext('(' + callback.toString() + ')', context)(request) } },
  emit(name, extra = {}) { listeners.get(name)?.({ isTrusted: true, key: 'Tab', code: 'Tab', shiftKey: false,
    ctrlKey: false, altKey: false, metaKey: false, ...extra }); } };
}

describe('真实监听源码只记录可信keyup任务后的被动证明', () => {
  it('原生输入ACK与keyup前不得提前授DOM处理完成且关闭后晚到帧无效', async () => {
    const value = fixture(), port = rendererEventsPort();
    try {
      await armNativeKeyEvents(port.runtime, value.request, Date.parse(value.request.deadlineAt));
      port.emit('keydown'); port.emit('keyup');
      expect(port.window.__amazonAiOpsNativeKeysEvent.completedAt).toBeNull();
      expect(port.frames).toHaveLength(1); port.frames.shift()();
      const state = port.window.__amazonAiOpsNativeKeysEvent;
      const proof = Object.fromEntries(['nonce', 'action', 'closed', 'keydownAt', 'keyupAt', 'completedAt', 'trusted'].map(key => [key, state[key]]));
      expect(validateNativeKeyProcessing(proof, value.request, value.ack)).toBe(proof);
    } finally { await closeNativeKeyEvents(port.runtime, value.request); }
    expect(port.listeners.size).toBe(0); expect(port.window.__amazonAiOpsNativeKeysEvent.closed).toBe(true);
  });
  it.each(['untrusted', 'other-key', 'other-code', 'shift', 'control', 'alt', 'meta'])(
    '%s事件不满足窄输入处理证明且不调用任何焦点或派发接口', async scenario => {
      const value = fixture(), port = rendererEventsPort();
      const extra = { untrusted: { isTrusted: false }, 'other-key': { key: 'Enter' }, 'other-code': { code: 'Enter' },
        shift: { shiftKey: true }, control: { ctrlKey: true }, alt: { altKey: true }, meta: { metaKey: true } }[scenario];
      try {
        await armNativeKeyEvents(port.runtime, value.request, Date.parse(value.request.deadlineAt));
        port.emit('keydown', extra); port.emit('keyup', extra);
        expect(port.window.__amazonAiOpsNativeKeysEvent.keydownAt).toBeNull(); expect(port.frames).toHaveLength(0);
      } finally { await closeNativeKeyEvents(port.runtime, value.request); }
    });
  it('关闭后的keyup和已经排队的帧均不能给新请求或旧请求补信用', async () => {
    const value = fixture(), port = rendererEventsPort();
    await armNativeKeyEvents(port.runtime, value.request, Date.parse(value.request.deadlineAt));
    port.emit('keydown'); port.emit('keyup'); await closeNativeKeyEvents(port.runtime, value.request);
    port.frames.shift()(); port.emit('keydown'); port.emit('keyup');
    expect(port.window.__amazonAiOpsNativeKeysEvent.completedAt).toBeNull(); expect(port.listeners.size).toBe(0);
  });
  it.each(['nonce', 'untrusted', 'early-down', 'early-up', 'closed', 'future', 'action'])(
    '%s证明不能冒充本次输入处理完成', scenario => {
      const value = fixture(), proof = { nonce: value.request.nonce, action: value.request.action, closed: false,
        trusted: true, keydownAt: value.request.startedAt, keyupAt: value.request.startedAt, completedAt: value.request.startedAt };
      if (scenario === 'nonce') proof.nonce = value.request.nodeNonce;
      if (scenario === 'untrusted') proof.trusted = false;
      if (scenario === 'early-down') proof.keydownAt = '2020-01-01T00:00:00.000Z';
      if (scenario === 'early-up') proof.keyupAt = '2020-01-01T00:00:00.000Z';
      if (scenario === 'closed') proof.closed = true;
      if (scenario === 'future') proof.completedAt = '2099-01-01T00:00:00.000Z';
      if (scenario === 'action') proof.action = 'ShiftTab';
      expect(() => validateNativeKeyProcessing(proof, value.request, value.ack)).toThrow(/UI_NVDA_NATIVE_KEYS_DOM_/);
    });
});


describe('真实observer固定模式及handoff顺序拒绝绕行', () => {
  it.each(['tab-already', 'target-already', 'handoff-sequential', 'mode-switch', 'dialog-handoff', 'dialog-final', 'dialog-skip', 'dialog-mode-rewrite'])(
    '%s严格绑定原件模式、顺序和新gainFocus且不输入或合成语音', scenario => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-focus-order-unit-'));
      const output = execFileSync('python', ['-B', path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
        path.resolve('scripts/v16-nvda-speech-observer.py'), 'focus-phases', scenario], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      expect(JSON.parse(output)).toEqual({ isolatedModel: true, source: scenario, speechCredit: false, originalSpeechStatePreserved: true, nextHandlerOnce: true });
    });
});


const domFocusApi = loadWithAccessiblePort('./v16-ui-nvda-dom-focus.js');
const { armDomFocus, matchesDomFocus, closeDomFocus } = domFocusApi;
const domFocusNodes = new WeakMap();
const readDomFocus = (runtime, context, deadline) => domFocusApi.readDomFocus(runtime, context, deadline, domFocusNodes.get(runtime));
function domFocusPort(phase = 'tab') {
  const value = fixture(), node = { id: 'unit-node', name: '当前操作', role: 'button' };
  const element = (id, name, role) => ({ isConnected: true, labels: [], textContent: name, tagName: role === 'button' ? 'BUTTON' : 'INPUT',
    getAttribute(key) { return ({ 'data-v16-a11y-node': id, 'aria-label': name, role })[key] || null; } });
  const target = element(node.id, node.name, node.role), other = element('next', '下一输入项', 'textbox');
  const window = {}, document = { activeElement: target, hasFocus: () => true, getElementById: () => null };
  const vmContext = vm.createContext({ window, document, Date });
  const run = (callback, args) => vm.runInContext('(' + callback.toString() + ')', vmContext)(...args);
  const runtime = { page: { evaluate: async (callback, request) => run(callback, [request]) } };
  domFocusNodes.set(runtime, node);
  return { node, target, other, window, document, context: { nonce: value.request.nonce, phase, phaseStartedAt: value.request.phaseStartedAt,
    deadline: Date.parse(value.request.deadlineAt) }, locator: { evaluate: async (callback, request) => run(callback, [target, request]) },
  runtime };
}

describe('真实DOM焦点源码只读等待且不输入或改变页面焦点', () => {
  it('Tab必须实际离开原target，ACK与同名active不能提前给处理信用', async () => {
    const p = domFocusPort();
    expect(await armDomFocus(p.locator, p.context, p.context.deadline)).toBe(true);
    const before = await readDomFocus(p.runtime, p.context, p.context.deadline);
    expect(matchesDomFocus(before, p.context, p.node)).toBe(false);
    p.document.activeElement = p.other;
    const moved = await readDomFocus(p.runtime, p.context, p.context.deadline);
    expect(matchesDomFocus(moved, p.context, p.node)).toBe(true); expect(moved.name).toBe('下一输入项');
    await closeDomFocus(p.runtime, p.context); expect(p.document.activeElement).toBe(p.other);
    expect(await readDomFocus(p.runtime, p.context, p.context.deadline)).toBeNull();
  });
  it('handoff必须从先前Tab控件真实改变且不能把最终target提前当交接中间节点', async () => {
    const p = domFocusPort('target-handoff'); p.document.activeElement = p.other;
    expect(await armDomFocus(p.locator, p.context, p.context.deadline)).toBe(false);
    expect(matchesDomFocus(await readDomFocus(p.runtime, p.context, p.context.deadline), p.context, p.node)).toBe(false);
    p.document.activeElement = p.target;
    expect(matchesDomFocus(await readDomFocus(p.runtime, p.context, p.context.deadline), p.context, p.node)).toBe(false);
    p.document.activeElement = { ...p.other };
    expect(matchesDomFocus(await readDomFocus(p.runtime, p.context, p.context.deadline), p.context, p.node)).toBe(true);
    await closeDomFocus(p.runtime, p.context);
  });
  it.each(['nonce', 'phase', 'target-id', 'target-detached', 'active-detached', 'document-lost', 'old-time', 'future-time', 'name', 'role'])(
    '%s不得把错误身份、失焦、脱离DOM或错误时间冒充最终焦点', async scenario => {
      const p = domFocusPort('target-focus');
      await armDomFocus(p.locator, p.context, p.context.deadline);
      const current = await readDomFocus(p.runtime, p.context, p.context.deadline);
      if (scenario === 'nonce') current.nonce = 'other';
      if (scenario === 'phase') current.phase = 'tab';
      if (scenario === 'target-id') current.targetId = 'other';
      if (scenario === 'target-detached') current.targetConnected = false;
      if (scenario === 'active-detached') current.activeConnected = false;
      if (scenario === 'document-lost') current.documentFocused = false;
      if (scenario === 'old-time') current.observedAt = '2020-01-01T00:00:00.000Z';
      if (scenario === 'future-time') current.observedAt = '2099-01-01T00:00:00.000Z';
      if (scenario === 'name') current.name = '别的名称';
      if (scenario === 'role') current.role = 'textbox';
      expect(() => matchesDomFocus(current, p.context, p.node)).toThrow(/UI_NVDA_(DOM_FOCUS_|FOCUS_DOM_)/);
      await closeDomFocus(p.runtime, p.context);
    });
  it('过期arm不能登记新状态且关闭后迟到读不能恢复引用或信用', async () => {
    const p = domFocusPort();
    await expect(armDomFocus(p.locator, p.context, Date.now() - 1)).rejects.toThrow('UI_NVDA_DOM_FOCUS_DEADLINE');
    expect(p.window.__amazonAiOpsDomFocus).toBeUndefined();
    await armDomFocus(p.locator, p.context, p.context.deadline); await closeDomFocus(p.runtime, p.context);
    expect(p.window.__amazonAiOpsDomFocus).toMatchObject({ closed: true, target: null, before: null });
    expect(await readDomFocus(p.runtime, p.context, p.context.deadline)).toBeNull();
  });
});


function originalReaderModel() {
  const file = path.resolve('scripts/v16-nvda-reader-test-model.cjs'), source = fs.readFileSync(file, 'utf8');
  const { parse } = require('acorn'), { EventEmitter } = require('node:events');
  const { createHash } = require('node:crypto'), { isDeepStrictEqual } = require('node:util');
  const models = parse(source, { sourceType: 'module', ecmaVersion: 'latest' }).body
    .filter(node => node.type === 'FunctionDeclaration' && node.id.name === 'readerModel');
  if (models.length !== 1) throw new Error('EXACT_ORIGINAL_READER_MODEL_REQUIRED');
  // 精确复用原隔离端口模型，不注册重复测试或访问实际产品与原生输入。
  const context = vm.createContext({ fs, path, os, vm, EventEmitter, createHash, isDeepStrictEqual, Buffer, process, queueMicrotask });
  vm.runInContext(source.slice(models[0].start, models[0].end) + '\nglobalThis.makeModel=readerModel;', context);
  return context.makeModel();
}

describe('对话框异步模式读取后的取消与原截止边界', () => {
  it.each(['stop-final', 'deadline-final', 'read-error-final', 'stop-native-return', 'deadline-native-return'])(
    '%s不发生晚到focus或额外原生输入并保留首错与owned清理', async scenario => {
      const f = originalReaderModel(), reader = await f.open(); f.dialogContainer = true;
      const node = { ...f.node(), role: 'dialog' }, locator = f.locator(node), evaluate = locator.evaluate.bind(locator), focus = locator.focus.bind(locator);
      const focusCalls = []; let modeReads = 0, stopCompleted = false;
      locator.evaluate = async (callback, request) => {
        const value = await evaluate(callback, request);
        if (value && Object.prototype.hasOwnProperty.call(value, 'tabIndex')
          && ++modeReads === (scenario.endsWith('native-return') ? 2 : 3)) {
          if (scenario.startsWith('stop')) { await reader.close(); stopCompleted = true; }
          if (scenario.startsWith('deadline')) f.now = Date.parse(f.speechRequest().deadlineAt);
          if (scenario.startsWith('read-error')) throw f.boundaryError;
        }
        return value;
      };
      locator.focus = async () => { focusCalls.push({ stopCompleted, at: f.now }); return focus(); };
      let failure;
      try { await reader.capture(f.runtime, locator, node); } catch (error) { failure = error; }
      expect(focusCalls).toHaveLength(1); expect(focusCalls.some(row => row.stopCompleted)).toBe(false);
      expect(failure).toBeDefined();
      if (scenario.startsWith('read-error')) expect(failure).toBe(f.boundaryError);
      else if (scenario.startsWith('stop')) expect(failure.message).toBe('UI_NVDA_EXITED_DURING_CAPTURE');
      else expect(failure.message).toMatch(/UI_NVDA_(OPERATION_DEADLINE_EXCEEDED|NATIVE_KEYS_ORIGINAL_BUDGET_REQUIRED)/);
      expect(f.nativeKeysRequests.map(row => row.action)).toEqual(scenario.endsWith('native-return') ? ['Tab'] : ['Tab', 'ShiftTab']);
      expect(f.focusRequests.map(row => row.phase)).toEqual(scenario.endsWith('native-return') ? ['first-focus', 'tab'] : ['first-focus', 'tab', 'target-handoff']);
      await reader.close(); expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0, signalCode: null });
      expect(f.protocolEvents.filter(row => row === 'owned-stop-request')).toHaveLength(1);
    });
});
