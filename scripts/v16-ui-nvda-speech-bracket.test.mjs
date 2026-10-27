import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
const require = createRequire(import.meta.url);
const clone = value => JSON.parse(JSON.stringify(value));
const stamp = ms => new Date(Date.parse('2026-10-24T04:23:45.000Z') + ms).toISOString();
let hostNow = Date.parse(stamp(10000));
class Clock extends Date { static now() { return hostNow; } }
const helperModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.resolve('scripts/v16-ui-nvda-speech-bracket.js'), 'utf8'), {
  module: helperModule, Date: Clock, require(key) {
    if (key === 'node:util') return { isDeepStrictEqual };
    if (key === './v16-performance-artifacts') return require('./v16-performance-artifacts');
    throw new Error('UNIT_UNKNOWN_SPEECH_BRACKET_DEPENDENCY:' + key);
  },
});
const { selectBracketedSpeech, waitForBracketedSpeech } = helperModule.exports;
function fixture() {
  const binding = { main: { pid: 123, handleCreationTimeUtc: '2026-10-24T04:23:44.0000000Z' }, window: { rootHwnd: '1000' } };
  const ready = { kind: 'nvda-observer-ready', version: 'unit', pid: 789, binding, rawIndex: 0 };
  const request = { sequence: 1, nonce: 'unit-nonce', nodeId: 'node', name: '当前操作', role: 'button', rawOffset: 1,
    startedAt: stamp(0), deadlineAt: stamp(10000) }, node = { id: 'node', name: request.name, role: request.role };
  const row = (index, ms) => ({ kind: 'nvda-synth-speech', engine: 'NVDA', version: ready.version, pid: ready.pid, binding, request,
    rawIndex: index, timestamp: stamp(ms), focusPid: 123, focusOwnerPid: 123, rootOwnerPid: 123, foregroundHwnd: '1000',
    ancestorHwnd: '1000', focusHwnd: '1001', isChild: true, mainAlive: true, handleCreationTimeUtc: binding.main.handleCreationTimeUtc,
    focusName: node.name, focusRole: node.role, synthesizer: 'unit', spoken: '按钮 ' + node.name });
  return { context: { binding, ready, request, node, hostBefore: { observedAt: stamp(500) }, hostAfter: { observedAt: stamp(900) } },
    raw: [ready, row(1, 100), row(2, 800)], row };
}
describe('同nonce完整流审核与真实host区间选择', () => {
  it('早行与后段自然语音均保留原索引，只授真实hostBefore之后行', () => {
    const f = fixture(), original = clone(f.raw), result = selectBracketedSpeech(f.raw, f.context);
    expect(result.matching).toEqual([f.raw[2]]); expect(result.matching[0]).toBe(f.raw[2]);
    expect(result.earlyCount).toBe(1); expect(result.rawRows).toBe(f.raw); expect(f.raw).toEqual(original);
    expect(f.context.request.rawOffset).toBe(1);
  });
  it('与hostBefore相同毫秒继续遵守原大于等于谓词', () => {
    const f = fixture(); f.raw[1].timestamp = stamp(500);
    expect(selectBracketedSpeech(f.raw, f.context).matching).toEqual(f.raw.slice(1));
  });
  it('同nonce自然非目标片段仍审核身份和时间但不授名称信用', () => {
    const f = fixture(); f.raw[1].spoken = '自然状态片段';
    expect(selectBracketedSpeech(f.raw, f.context).matching).toEqual([f.raw[2]]);
    f.raw[1].pid = 999; expect(() => selectBracketedSpeech(f.raw, f.context)).toThrow('RAW_ROW_MISMATCH');
  });
  it('合法祖先片段保留raw，不冒充目标名称或角色', () => {
    const f = fixture(); Object.assign(f.raw[1], { spoken: '祖先容器' });
    expect(selectBracketedSpeech(f.raw, f.context).matching).toEqual([f.raw[2]]);
  });
  it.each([
    ['非完整UTC', row => { row.timestamp = '2026-10-24T04:23:45Z'; }, 'TIME_INVALID'],
    ['非canonical日期', row => { row.timestamp = '2026-02-30T04:23:45.100Z'; }, 'TIME_INVALID'],
    ['早于请求', row => { row.timestamp = stamp(-1); }, 'TIME_INVALID'],
    ['超原截止', row => { row.timestamp = stamp(10001); }, 'TIME_INVALID'],
    ['超真实hostAfter', row => { row.timestamp = stamp(901); }, 'TIME_INVALID'],
    ['伪造rawIndex', row => { row.rawIndex = 0; }, 'RAW_ROW_MISMATCH'],
    ['foreign reader', row => { row.pid = 790; }, 'RAW_ROW_MISMATCH'],
    ['foreign version', row => { row.version = 'foreign'; }, 'RAW_ROW_MISMATCH'],
    ['foreign engine', row => { row.engine = 'fake'; }, 'RAW_ROW_MISMATCH'],
    ['foreign binding', row => { row.binding = { ...row.binding, foreign: true }; }, 'RAW_ROW_MISMATCH'],
    ['foreign request', row => { row.request = { ...row.request, sequence: 2 }; }, 'RAW_ROW_MISMATCH'],
    ['foreign focus PID', row => { row.focusPid = 999; }, 'NATIVE_WINDOW_MISMATCH'],
    ['foreign focus owner', row => { row.focusOwnerPid = 999; }, 'NATIVE_WINDOW_MISMATCH'],
    ['foreign root owner', row => { row.rootOwnerPid = 999; }, 'NATIVE_WINDOW_MISMATCH'],
    ['foreign foreground', row => { row.foregroundHwnd = '1002'; }, 'NATIVE_WINDOW_MISMATCH'],
    ['foreign ancestor', row => { row.ancestorHwnd = '1002'; }, 'NATIVE_WINDOW_MISMATCH'],
    ['非自有子窗', row => { row.isChild = false; }, 'NATIVE_WINDOW_MISMATCH'],
    ['无存活证明', row => { row.mainAlive = false; }, 'NATIVE_WINDOW_MISMATCH'],
    ['foreign birth', row => { row.handleCreationTimeUtc = 'foreign'; }, 'NATIVE_WINDOW_MISMATCH'],
    ['HWND溢出', row => { row.focusHwnd = '18446744073709551616'; }, 'NATIVE_WINDOW_MISMATCH'],
    ['错误目标name', row => { row.focusName = '另一个操作'; }, 'ACTUAL_NAME_OR_ROLE_MISMATCH'],
    ['错误目标role', row => { row.focusRole = 'textbox'; }, 'ACTUAL_NAME_OR_ROLE_MISMATCH'],
    ['无synth', row => { row.synthesizer = ''; }, 'ACTUAL_NAME_OR_ROLE_MISMATCH'],
  ])('早行%s不能被后续合法行隐藏', (name, mutate, code) => {
    const f = fixture(); mutate(f.raw[1]); expect(() => selectBracketedSpeech(f.raw, f.context)).toThrow(code);
  });
  it.each([
    ['early-name', false, 'focusName', 'foreign'], ['early-role', false, 'focusRole', 'group'],
    ['tail-name', true, 'focusName', 'foreign'], ['tail-role', true, 'focusRole', 'group'],
  ])('不含目标文本的%s坏焦点元数据不能被筛掉', (name, tail, key, value) => {
    const f = fixture(); if (tail) f.raw.push(f.row(3, 950));
    const row = f.raw[tail ? 3 : 1]; row.spoken = '自然非名称片段'; row[key] = value;
    expect(() => selectBracketedSpeech(f.raw, f.context)).toThrow('ACTUAL_NAME_OR_ROLE_MISMATCH');
  });
  it('完整流倒序即拒绝，不先筛选或排序成合法子集', () => {
    const f = fixture(); f.raw[1].timestamp = stamp(850);
    expect(() => selectBracketedSpeech(f.raw, f.context)).toThrow('TIME_INVALID');
  });
  it('合法request内hostAfter尾行完整保留，只授真实区间内行', () => {
    const f = fixture(), prefix = clone(f.raw); f.raw.push(f.row(3, 950));
    const result = selectBracketedSpeech(f.raw, { ...f.context, expectedPrefix: prefix });
    expect(result.matching).toEqual([f.raw[2]]); expect(result.rawRows).toHaveLength(4); expect(f.raw[3].timestamp).toBe(stamp(950));
  });
  it.each([
    ['超request截止', row => { row.timestamp = stamp(10001); }, 'TIME_INVALID'],
    ['倒序', row => { row.timestamp = stamp(700); }, 'TIME_INVALID'],
    ['坏canonical', row => { row.timestamp = '2026-10-24T04:23:45Z'; }, 'TIME_INVALID'],
    ['foreign reader', row => { row.pid = 999; }, 'RAW_ROW_MISMATCH'],
    ['foreign owner', row => { row.focusOwnerPid = 999; }, 'NATIVE_WINDOW_MISMATCH'],
    ['伪造ordinal', row => { row.rawIndex = 1; }, 'RAW_ROW_MISMATCH'],
  ])('hostAfter之后%s坏行不能被双侧选择隐藏', (name, mutate, code) => {
    const f = fixture(); f.raw.push(f.row(3, 950)); mutate(f.raw[3]);
    expect(() => selectBracketedSpeech(f.raw, f.context)).toThrow(code);
  });
  it('hostAfter同毫秒行维持原小于等于上界', () => {
    const f = fixture(); f.raw[2].timestamp = stamp(900);
    expect(selectBracketedSpeech(f.raw, f.context).matching).toEqual([f.raw[2]]);
  });
  it.each(['rewrite', 'truncate'])('poll前缀%s不能以重新选择合法行掩盖', mode => {
    const f = fixture(), prefix = clone(f.raw);
    if (mode === 'rewrite') f.raw[1].timestamp = stamp(101); else f.raw.pop();
    expect(() => selectBracketedSpeech(f.raw, { ...f.context, expectedPrefix: prefix })).toThrow('RAW_ROW_MISMATCH');
  });
  it('只见早行时继续等待真实后段行，全部原raw前缀保持', async () => {
    const f = fixture(); let polls = 0;
    const result = await waitForBracketedSpeech({ ...f.context, hostAfter: undefined, read: () => ++polls === 1 ? f.raw.slice(0, 2) : f.raw,
      wait: async (read, predicate) => { expect(predicate(read())).toBe(false); const value = read(); expect(predicate(value)).toBe(true); return value; } });
    expect(polls).toBe(2); expect(result.matching[0].rawIndex).toBe(2);
  });
  it.each(['UI_NVDA_OPERATION_DEADLINE_EXCEEDED', 'UI_NVDA_SPOKEN_NODE_NOT_OBSERVED'])('early-only在原%s后保留TIME失败', async code => {
    const f = fixture(), error = new Error(code);
    await expect(waitForBracketedSpeech({ ...f.context, read: () => f.raw.slice(0, 2),
      wait: async (read, predicate) => { expect(predicate(read())).toBe(false); throw error; } })).rejects.toMatchObject({ message: 'UI_NVDA_PROVIDER_TIME_INVALID', cause: error });
  });
  it.each(['STOP', 'CHILD_EXIT', 'SOURCE_CHANGED'])('合法早行不能覆盖%s首错', async code => {
    const f = fixture(), error = new Error(code);
    await expect(waitForBracketedSpeech({ ...f.context, read: () => f.raw.slice(0, 2), wait: async read => { read(); throw error; } })).rejects.toBe(error);
  });
  it('尚无目标语音不转换原timeout', async () => {
    const f = fixture(), error = new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
    await expect(waitForBracketedSpeech({ ...f.context, read: () => f.raw.slice(0, 1), wait: async read => { read(); throw error; } })).rejects.toBe(error);
  });
  it('原截止尚未到时不按错误文本转换首错', async () => {
    const f = fixture(), error = new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED'); hostNow = Date.parse(stamp(9000));
    try {
      await expect(waitForBracketedSpeech({ ...f.context, read: () => f.raw.slice(0, 2), wait: async read => { read(); throw error; } })).rejects.toBe(error);
    } finally { hostNow = Date.parse(stamp(10000)); }
  });
  it('read自身同名deadline首错在原截止后也不被转换', async () => {
    const f = fixture(), error = new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED'); let calls = 0;
    await expect(waitForBracketedSpeech({ ...f.context, read: () => { if (++calls === 2) throw error; return f.raw.slice(0, 2); },
      wait: async read => { read(); read(); } })).rejects.toBe(error);
  });
});
function readerFixture() {
  const acorn = require('acorn'), text = fs.readFileSync(path.resolve('scripts/v16-nvda-reader-test-model.cjs'), 'utf8');
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  const node = ast.body.find(value => value.type === 'FunctionDeclaration' && value.id.name === 'readerModel');
  let source = text.slice(node.start, node.end);
  const marker = "    if (key === 'ShiftTab' && !f.targetMissing) {";
  const injection = `    if (key === 'ShiftTab' && f.lateTargetSpeech) {
      const append = () => {
        const rows = bytes(rawFile).toString('utf8').trim().split('\\n').map(JSON.parse);
        const row = { ...rows.at(-1), rawIndex: rows.length, timestamp: stamp(),
          focusName: f.nativeTarget.node.name, focusRole: f.nativeTarget.node.role, spoken: '按钮 ' + f.nativeTarget.node.name };
        if (f.lateMutation) f.lateMutation(row);
        put(rawFile, bytes(rawFile).toString('utf8') + JSON.stringify(row) + '\\n');
      };
      if (f.lateDelayMs) schedule(append, f.lateDelayMs); else append();
    }
`;
  if (source.split(marker).length !== 2) throw new Error('UNIT_SPEECH_FIXTURE_PORT_CHANGED');
  source = source.replace(marker, injection + marker);
  return vm.runInNewContext('(' + source + ')', { fs, path, vm, Buffer, Date, EventEmitter, createHash,
    isDeepStrictEqual, process, queueMicrotask, setTimeout, clearTimeout })();
}
describe('真实reader CJS顺序冲突回归', () => {
  it.each([0, 200])('真实早focus语音加回焦后%dms自然语音只选后段且保留原raw/nonce/offset', async delay => {
    const f = readerFixture(), reader = await f.open(), node = f.node(); f.earlySpeech = true; f.lateTargetSpeech = true; f.lateDelayMs = delay;
    try {
      const result = await reader.capture(f.runtime, f.locator(node), node);
      expect(result.rows).toHaveLength(1); expect(result.rows[0].rawIndex).toBe(2); expect(f.rawRows()).toHaveLength(3);
      expect(result.providerWitness.request.rawOffset).toBe(1); expect(result.rows[0].request).toEqual(result.providerWitness.request);
      expect(Date.parse(f.rawRows()[1].timestamp)).toBeLessThan(Date.parse(result.providerWitness.hostBefore.observedAt));
      expect(Date.parse(result.rows[0].timestamp)).toBeGreaterThanOrEqual(Date.parse(result.providerWitness.hostBefore.observedAt));
      expect(reader.sessionFailure).toBeNull(); expect(f.nativeKeysRequests.map(row => row.phase)).toEqual(['tab', 'target-focus']);
      expect(f.cdpKeyCalls || 0).toBe(0);
    } finally { await reader.close(); }
  });
  it('early-only不能通行，原十秒失败后STOP并禁止下一节点输入', async () => {
    const f = readerFixture(), reader = await f.open(), node = f.node(); f.earlySpeech = true; const started = f.now;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_PROVIDER_TIME_INVALID');
    expect(f.now - started).toBeGreaterThanOrEqual(10000); expect(f.rawRows()).toHaveLength(2);
    const error = reader.sessionFailure, operations = f.runtimeOperations;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toMatchObject({ message: 'UI_NVDA_CAPTURE_SESSION_UNUSABLE', cause: error });
    expect(f.runtimeOperations).toBe(operations); expect(f.protocolEvents.filter(value => value === 'owned-stop-request')).toHaveLength(1);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 });
  });
  it.each(['badSpeechTime', 'badFocusName', 'tamperRaw'])('原%s即使附后段自然语音也不能变通过', async key => {
    const f = readerFixture(), reader = await f.open(), node = f.node(); f.earlySpeech = true; f.lateTargetSpeech = true; f[key] = true;
    try { await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_PROVIDER_(TIME_INVALID|ACTUAL_NAME_OR_ROLE_MISMATCH|RAW_ROW_MISMATCH)/); }
    finally { await reader.close(); }
  });
});
