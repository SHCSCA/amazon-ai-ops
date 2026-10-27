import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const start = Date.parse('2026-10-24T02:22:24.000Z');
const iso = time => new Date(time).toISOString();
// 原生产函数逐字保留为并行模型，测试不依赖忽略目录中的历史原件。
const originalSource = `const { insist } = require('./v16-performance-artifacts');
function matchesDomFocus(value, context, node) {
  if (!value) return false;
  insist(value.nonce === context.nonce && value.phase === context.phase && value.targetId === node.id
    && value.targetConnected === true && value.activeConnected === true, 'UI_NVDA_DOM_FOCUS_IDENTITY_CHANGED');
  insist(value.documentFocused === true, 'UI_NVDA_DOM_FOCUS_DOCUMENT_LOST');
  const observed = Date.parse(value.observedAt);
  insist(Number.isFinite(observed) && new Date(observed).toISOString() === value.observedAt
    && observed >= Date.parse(context.phaseStartedAt) && observed <= Date.now() && Date.now() <= context.deadline,
  'UI_NVDA_DOM_FOCUS_TIME_INVALID');
  if (['first-focus', 'target-focus'].includes(context.phase)) {
    if (!value.sameTarget) return false;
    insist(value.name === node.name && value.role === node.role, 'UI_NVDA_FOCUS_DOM_TARGET_CHANGED');
  } else if (context.phase === 'tab') { if (value.sameTarget) return false; }
  else if (context.phase === 'target-handoff') { if (value.sameBefore || value.sameTarget) return false; }
  else throw new Error('UI_NVDA_FOCUS_PHASE_INVALID');
  insist(Boolean(value.name && value.role), 'UI_NVDA_FOCUS_DOM_TARGET_REQUIRED');
  return true;
}
module.exports = { matchesDomFocus };`;
const originalFile = null;
const currentFile = path.resolve('scripts/v16-ui-nvda-dom-focus.js');
const phaseFile = path.resolve('scripts/v16-ui-nvda-focus-phase.js');
const insist = (condition, code) => { if (!condition) throw new Error(code); };
function load(file, ports = {}, DatePort = Date) {
  const module = { exports: {} };
  const host = require('node:module').createRequire(file || currentFile);
  vm.runInNewContext(file ? fs.readFileSync(file, 'utf8') : originalSource, { module, exports: module.exports, Date: DatePort,
    setTimeout, clearTimeout, process: ports.process || process,
    require: key => Object.hasOwn(ports, key) ? ports[key] : key === './v16-performance-artifacts' ? { insist } : host(key) }, { filename: file || 'original-predicate-model.cjs' });
  return module.exports;
}
function traceRun(file, options = {}) {
  const trace = [], errors = [], clock = [...(options.clock || [start + 10, start + 11])];
  class Clock extends Date {
    constructor(...args) { trace.push(['newDate', ...args]); super(...args); }
    static parse(value) { trace.push(['parse', value]); return Date.parse(value); }
    static now() { const value = clock.shift(); trace.push(['now', value]); return value; }
  }
  const checked = (condition, code) => { trace.push(['insist', condition, code]); if (!condition) { const error = new Error(code); errors.push(error); throw error; } };
  const module = load(file, { './v16-performance-artifacts': { insist: checked } }, Clock);
  let reads = 0;
  const value = new Proxy({ nonce: 'unit', phase: 'tab', targetId: 'node', targetConnected: true,
    activeConnected: true, documentFocused: true, sameTarget: false, name: 'unit-name', role: 'button', ...options.value }, {
    get(target, key) { trace.push(['value', key]); if (key === 'observedAt') {
      if (options.observedThrow && reads++ === 1) throw options.observedThrow;
      return options.observedValues ? options.observedValues[Math.min(reads++, options.observedValues.length - 1)] : options.observedAt ?? iso(start + 5);
    } return target[key]; },
  });
  const context = new Proxy({ nonce: 'unit', phase: 'tab', phaseStartedAt: options.phaseStartedAt ?? iso(start), deadline: options.deadline ?? start + 10000 }, {
    get(target, key) { trace.push(['context', key]); return target[key]; },
  });
  const node = new Proxy({ id: 'node', name: 'unit-name', role: 'button' }, { get(target, key) { trace.push(['node', key]); return target[key]; } });
  let result, error;
  try { result = module.matchesDomFocus(value, context, node); } catch (caught) { error = caught; }
  const beforeLookup = [...trace], diagnostic = module.domFocusTimeFailure?.(error) ?? null;
  return { trace, beforeLookup, result, error, diagnostic, errors, module };
}
const cases = [
  ['有限值拒绝', { observedAt: 'not-a-time' }, [false, null, null, null, null], 0],
  ['非规范时间拒绝', { observedAt: '2026-10-24T02:22:24Z' }, [true, false, null, null, null], 0],
  ['早于本phase拒绝', { phaseStartedAt: iso(start + 6) }, [true, true, false, null, null], 0],
  ['未来时间拒绝', { clock: [start + 4] }, [true, true, true, false, null], 1],
  ['过截止拒绝', { deadline: start + 10 }, [true, true, true, true, false], 2],
  ['原有效路径', {}, [true, true, true, true, true], 2],
  ['原截止相等允许', { deadline: start + 11 }, [true, true, true, true, true], 2],
  ['两次采样间跨截止', { deadline: start + 10, clock: [start + 9, start + 11] }, [true, true, true, true, false], 2],
  ['两次属性值不同', { observedValues: [iso(start + 5), iso(start + 6)] }, [true, false, null, null, null], 0],
  ['phase时间无效', { phaseStartedAt: 'invalid' }, [true, true, false, null, null], 0],
];
describe('DOM焦点时间谓词的逐步等价', () => {
  it.each(cases)('%s保留属性读取、短路、原时钟调用和异常代码', (_, options, gates, calls) => {
    const old = traceRun(originalFile, options), current = traceRun(currentFile, options);
    expect(current.trace).toEqual(old.trace);
    expect(current.beforeLookup).toEqual(current.trace);
    expect(current.result).toBe(old.result);
    expect(current.error?.message).toBe(old.error?.message);
    expect(current.trace.filter(row => row[0] === 'now')).toHaveLength(calls);
    if (current.error) {
      expect(current.error).toBe(current.errors[0]);
      expect(Object.keys(current.error)).toEqual([]);
      expect(Object.values(current.diagnostic?.gates || {})).toEqual(gates);
    } else expect(current.diagnostic).toBeNull();
  });
  it('异常属性读取仍抛同一原错且不伪造TIME诊断', () => {
    const error = new Error('UI_NVDA_DOM_FOCUS_TIME_INVALID');
    const old = traceRun(originalFile, { observedThrow: error }), current = traceRun(currentFile, { observedThrow: error });
    expect(current.trace).toEqual(old.trace);
    expect(current.error).toBe(error);
    expect(current.diagnostic).toBeNull();
  });
  it('身份前置门失败保持原轨迹并不采样时间', () => {
    const options = { value: { nonce: 'other' } }, old = traceRun(originalFile, options), current = traceRun(currentFile, options);
    expect(current.trace).toEqual(old.trace);
    expect(current.error?.message).toBe('UI_NVDA_DOM_FOCUS_IDENTITY_CHANGED');
    expect(current.diagnostic).toBeNull();
    expect(current.trace.some(row => row[0] === 'now' || row[0] === 'parse')).toBe(false);
  });
});
describe('仅原Error持有的有界时间诊断', () => {
  it('保存两次原谓词实际时钟采样以及精确原时间字符串', () => {
    const value = traceRun(currentFile, { deadline: start + 10 });
    expect(value.diagnostic).toEqual({ schemaVersion: 1,
      observedAt: { type: 'string', length: 24, value: iso(start + 5) },
      canonicalObservedAt: { type: 'string', length: 24, value: iso(start + 5) },
      predicatePhaseStartedAt: { type: 'string', length: 24, value: iso(start) },
      predicateDeadline: { type: 'number', length: null, value: start + 10 },
      hostNowObserved: start + 10, hostNowDeadline: start + 11,
      gates: { finite: true, canonical: true, notBeforePhase: true, notFutureHost: true, withinDeadline: false } });
    expect(Object.isFrozen(value.diagnostic)).toBe(true);
    expect(Object.isFrozen(value.diagnostic.gates)).toBe(true);
    expect(Object.isFrozen(value.diagnostic.observedAt)).toBe(true);
  });
  it('未执行比较及其时钟不填伪值', () => {
    const value = traceRun(currentFile, { clock: [start + 4] });
    expect(value.diagnostic?.hostNowObserved).toBe(start + 4);
    expect(value.diagnostic?.hostNowDeadline).toBeNull();
    expect(value.diagnostic?.predicateDeadline).toBeNull();
    expect(value.diagnostic?.gates.withinDeadline).toBeNull();
  });
  it.each(['SECRET-not-time', 'x'.repeat(1000), '2026-10-24T02:22:24.000Z SECRET'])('非时间内容只留类型和长度 %s', raw => {
    const value = traceRun(currentFile, { observedAt: raw });
    expect(value.diagnostic?.observedAt).toEqual({ type: 'string', length: raw.length, value: null });
    expect(JSON.stringify(value.diagnostic)).not.toContain(raw);
  });
  it('两个原属性读不同仍分别保留有界值', () => {
    const value = traceRun(currentFile, { observedValues: [iso(start + 5), iso(start + 6)] });
    expect(value.diagnostic?.observedAt.value).toBe(iso(start + 5));
    expect(value.diagnostic?.canonicalObservedAt.value).toBe(iso(start + 6));
  });
  it('外来同名Error及伪造属性不能领取诊断', () => {
    const value = traceRun(currentFile, { deadline: start + 10 });
    const foreign = Object.assign(new Error('UI_NVDA_DOM_FOCUS_TIME_INVALID'), { domFocusTime: value.diagnostic });
    expect(typeof value.module.domFocusTimeFailure).toBe('function');
    expect(value.module.domFocusTimeFailure?.(foreign)).toBeNull();
    expect(value.module.domFocusTimeFailure?.(undefined)).toBeNull();
  });
});
async function phaseRun({ foreign = false, cleanupFails = false, loggerFails = false } = {}) {
  const logs = [], stderr = [], counts = { arm: 0, action: 0, close: 0, native: 0, fileWrites: 0, active: 0 };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [start])); } static now() { return start; } }
  const dom = load(currentFile, {}, Clock), original = new Error('UI_NVDA_DOM_FOCUS_TIME_INVALID');
  let thrown;
  const phase = load(phaseFile, {
    'node:fs': { existsSync: () => false, writeFileSync() { counts.fileWrites++; throw new Error('UNEXPECTED_WRITE'); } },
    './v16-ui-nvda-dom-focus': { ...dom,
      armDomFocus: async () => { counts.arm++; return true; },
      waitDomFocus: async (_runtime, context, node) => {
        if (foreign) { thrown = original; throw original; }
        try { dom.matchesDomFocus({ nonce: context.nonce, phase: context.phase, targetId: node.id,
          targetConnected: true, activeConnected: true, documentFocused: true, observedAt: iso(start + 1) }, context, node); }
        catch (error) { thrown = error; throw error; }
      },
      closeDomFocus: async () => { counts.close++; if (cleanupFails) throw new Error('CLEANUP_FAILED'); },
    },
    process: { stderr: { write: value => stderr.push(value) } },
  }, Clock);
  let caught;
  try { await phase.runFocusPhase({ runtime: {}, locator: {}, node: { id: 'node' }, phase: 'first-focus', focusMode: 'sequential',
    action: async () => { counts.action++; }, directory: 'unit', binding: {}, pid: 1,
    request: { startedAt: iso(start), deadlineAt: iso(start + 10000) }, deadline: start + 10000,
    writer: { log(event, error, context) { logs.push({ event, error, context }); if (loggerFails) throw new Error('LOGGER_FAILED'); } },
    assertActive() { counts.active++; } }); } catch (error) { caught = error; }
  return { logs, stderr, counts, caught, thrown, dom };
}
describe('原单一phase失败日志与清理边界', () => {
  it('同一失败事件附原context时间且不增加输入或文件写', async () => {
    const value = await phaseRun();
    expect(value.caught).toBe(value.thrown);
    expect(value.logs).toHaveLength(1);
    expect(value.logs[0].event).toBe('v16.ui_nvda_focus_phase_failed');
    expect(value.logs[0].error).toBe(value.thrown);
    expect(value.logs[0].context.domFocusTime).toEqual({ ...value.dom.domFocusTimeFailure?.(value.thrown), phaseStartedAt: iso(start), deadline: start + 10000 });
    expect(value.logs[0].context.domFocusTime?.gates.notFutureHost).toBe(false);
    expect(value.counts).toEqual({ arm: 1, action: 1, close: 1, native: 0, fileWrites: 0, active: 1 });
  });
  it('同名外来Error仍只有旧日志上下文', async () => {
    const value = await phaseRun({ foreign: true });
    expect(value.caught).toBe(value.thrown);
    expect(value.logs[0].context).toEqual({ phase: 'first-focus', nodeId: 'node' });
  });
  it('清理失败仍保留原TIME Error与诊断', async () => {
    const value = await phaseRun({ cleanupFails: true });
    expect(value.caught).toBe(value.thrown);
    expect(value.logs.map(row => row.event)).toEqual(['v16.ui_nvda_focus_phase_failed', 'v16.ui_nvda_dom_focus_cleanup_failed']);
    expect(value.logs[0].context.domFocusTime?.hostNowObserved).toBe(start);
    expect(value.counts.close).toBe(1);
  });
  it('统一日志出口失败不替换首错或追加phase事件', async () => {
    const value = await phaseRun({ loggerFails: true });
    expect(value.caught).toBe(value.thrown);
    expect(value.logs).toHaveLength(1);
    expect(value.logs[0].context.domFocusTime?.hostNowObserved).toBe(start);
    expect(value.stderr).toHaveLength(1);
    expect(JSON.parse(value.stderr[0]).event).toBe('v16.ui_nvda_focus_log_failed');
    expect(value.counts.close).toBe(1);
  });
});
