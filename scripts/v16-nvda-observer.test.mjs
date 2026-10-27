import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import speech from './v16-ui-software-screen-reader.js';
import readerPorts from './v16-nvda-reader-test-model.cjs';
const { readerModel } = readerPorts;

describe('actual NVDA observer privacy boundary', () => {
  it('excludes another foreground application before any name or speech is written', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-observer-unit-'));
    const result = execFileSync('python', [path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
      path.resolve('scripts/v16-nvda-speech-observer.py')], { encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(result)).toEqual({ excludedOtherProcessBeforeWrite: true, matchingProcessOnly: true, rejectedExtraTargets: true });
  });
  it('rejects missing, plural or invalid target process identities before starting NVDA', async () => {
    const executablePath = path.join(os.tmpdir(), 'nvda-must-not-be-opened.exe');
    for (const rendererPid of [undefined, 0, -1, [1234, 5678]]) {
      await expect(speech.openNvdaObserver({ executablePath, directory: path.join(os.tmpdir(), 'unused-nvda-config'),
        writer: null, rendererPid })).rejects.toThrow('SINGLE_RENDERER_PID');
    }
  });
  it('requires a zero exit code without a signal after actual reader cleanup', () => {
    expect(() => speech.assertNvdaNormalExit({ exited: true, exitCode: 0, signalCode: null })).not.toThrow();
    for (const receipt of [{ exited: false, exitCode: null, signalCode: null }, { exited: true, exitCode: 2, signalCode: null },
      { exited: true, exitCode: null, signalCode: 'SIGTERM' }, { exited: true, exitCode: 0, signalCode: 'SIGKILL' }]) {
      expect(() => speech.assertNvdaNormalExit(receipt)).toThrow('NORMAL_EXIT_NOT_CONFIRMED');
    }
  });
});

describe('真实NativeOwner隔离端口与节点协议', () => {
  it('原生出生和窗口关系门先于名称及实际语音且只写有界原因', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-native-unit-'));
    const result = execFileSync('python', [path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
      path.resolve('scripts/v16-nvda-speech-observer.py'), 'native-gates'], { encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(result)).toEqual({ nativeGatesBeforeContent: true, fixedBoundedReasonsOnly: true, sameRootAccepted: true, heldHandleDisposed: true });
  });
  it('就绪不是语音且节点名称时间token在遍历实际字符串前验证', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-node-unit-'));
    const result = execFileSync('python', [path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
      path.resolve('scripts/v16-nvda-speech-observer.py'), 'node-gates'], { encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(result)).toEqual({ readyIsNotSpeech: true, nameTimeTokenBeforeStrings: true, actualStringsOnly: true, distinctNodeNonces: true });
  });
  it('仅本次token停止请求可产生句柄释放后的ack并请求正常退出', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-stop-unit-'));
    const result = execFileSync('python', [path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
      path.resolve('scripts/v16-nvda-speech-observer.py'), 'owned-stop'], { encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(result)).toEqual({ foreignStopRejected: true, ownedAckOnly: true, normalExitRequested: true, handleDisposedBeforeAck: true });
  });
});

// 真实CJS与共享合同在同一VM域加载；所有系统端口均为显式隔离替身，假PID不访问系统。


describe('真实CJS reader隔离端口集成', () => {
  it('单一Main provider两节点语音保留独立Renderer与原始witness并仅用owned STOP收尾', async () => {
    const f = readerModel(), reader = await f.open(); expect(reader).toHaveProperty('binding.main.pid', 123);
    expect(reader).toHaveProperty('binding.renderer.pid', 456);
    const first = f.node(), second = f.node('unit-return');
    const a = await reader.capture(f.runtime, f.locator(first), first), b = await reader.capture(f.runtime, f.locator(second), second);
    expect(a.rows[0].focusPid).toBe(123); expect(a.providerWitness.binding.renderer.pid).toBe(456);
    expect(a.providerWitness.request.nonce).not.toBe(b.providerWitness.request.nonce);
    expect(a.providerWitness.request.sequence).toBeLessThan(b.providerWitness.request.sequence);
    expect(a.providerWitness.request.deadlineAt && Date.parse(a.providerWitness.request.deadlineAt) - Date.parse(a.providerWitness.request.startedAt)).toBe(10000);
    const close = reader.close(); expect(reader.close()).toBe(close); const result = await close;
    expect(result).toMatchObject({ exited: true, closed: true, forced: false, stopRequested: true, exitCode: 0, signalCode: null });
    expect(result.stopAck.nonce).toBe(result.stopRequest.nonce); expect(f.kills).toEqual([]);
    expect(f.execCalls.some(call => call.args.includes('--quit'))).toBe(false);
  });
  it.each([
    ['rendererChanged', 'UI_NVDA_PROVIDER_CURRENT_RUNTIME_CHANGED'], ['domChanged', 'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED'],
    ['badFocusName', 'UI_NVDA_PROVIDER_ACTUAL_NAME_OR_ROLE_MISMATCH'], ['tamperRaw', 'UI_NVDA_PROVIDER_RAW_ROW_MISMATCH'],
    ['badSpeechTime', 'UI_NVDA_PROVIDER_TIME_INVALID'], ['noSpeech', /UI_NVDA_(OPERATION_DEADLINE_EXCEEDED|SPOKEN_NODE_NOT_OBSERVED)/],
    ['overBudget', 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED'],
  ])('真实reader拒绝%s且记录原错误后仍回收自有reader', async (field, code) => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f[field] = true;
    const captureStartedAt = f.now;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(code);
    expect(f.logs.some(line => line.event === 'v16.ui_screen_reader_capture_failed')).toBe(true);
    if (field === 'noSpeech') expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']);
    if (field === 'noSpeech') {
      expect(f.now - captureStartedAt).toBeGreaterThanOrEqual(10_000);
      expect(f.now - captureStartedAt).toBeLessThan(10_100);
    }
    const cleanupStartedAt = f.now;
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 });
    if (field === 'noSpeech') {
      expect(f.now - cleanupStartedAt).toBeLessThanOrEqual(100);
      expect(f.pendingTimerCount()).toBe(0);
      expect(f.cleanup()).toMatchObject({ exited: true, closed: true, forced: false, stopRequested: true, earlyExit: false, exitCode: 0, signalCode: null });
    }
    expect(f.kills).toEqual([]); expect(f.execCalls.some(call => call.args.includes('--quit'))).toBe(false);
  });
  it('正常停止缺失nonce ack必须失败且只可kill缓存的自有child', async () => {
    const f = readerModel(), reader = await f.open(); f.noStopAck = true;
    await expect(reader.close()).rejects.toThrow('OWNED_STOP_TIMEOUT');
    expect(f.cleanup()).toMatchObject({ forced: true, stopRequested: true });
    expect(f.kills).toEqual([{ child: f.child, signal: 'SIGKILL' }]);
    expect(f.execCalls.some(call => call.args.includes('--quit'))).toBe(false);
  });
  it('自有kill失败仍保留最初停止错误并记录回收失败且不授关闭信用', async () => {
    const f = readerModel(), reader = await f.open(); f.noStopAck = true; f.killFails = true;
    await expect(reader.close()).rejects.toThrow('OWNED_STOP_TIMEOUT');
    expect(f.cleanup()).toMatchObject({ exited: false, closed: false, forced: true });
    expect(f.logs.some(line => line.event === 'v16.ui_screen_reader_owned_cleanup_failed' && line.error.message === 'UI_NVDA_OWNED_KILL_FAILED')).toBe(true);
    expect(f.kills).toEqual([{ child: f.child, signal: 'SIGKILL' }]);
  });
  it('真实reader child错误记录后保留原异常并只回收本次缓存对象', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(), original = new Error('UNIT_OWNED_CHILD_ERROR');
    f.child.emit('error', original);
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toBe(original);
    await expect(reader.close()).rejects.toBe(original);
    expect(f.logs.some(line => line.event === 'v16.ui_screen_reader_child_failed' && line.error === original)).toBe(true);
    expect(f.kills).toEqual([{ child: f.child, signal: 'SIGKILL' }]);
  });
  it('外来ack即使reader实际exit0也不得形成正常关闭信用', async () => {
    const f = readerModel(), reader = await f.open(); f.badAck = true;
    await expect(reader.close()).rejects.toThrow('OWNED_STOP_ACK_REQUIRED'); expect(f.kills).toEqual([]);
  });
  it('未发owned STOP前的exit0与close0必须失败且保留阶段事实', async () => {
    const f = readerModel(), reader = await f.open(); f.exit(0);
    await expect(reader.close()).rejects.toThrow('EXITED_BEFORE_OWNED_STOP');
    expect(f.cleanup()).toMatchObject({ earlyExit: true, stopRequested: false, forced: false }); expect(f.kills).toEqual([]);
  });
  it('本次owned STOP后非零退出保留真实退出码并拒绝正常信用', async () => {
    const f = readerModel(), reader = await f.open(); f.stopExitCode = 2;
    await expect(reader.close()).rejects.toThrow('NORMAL_OWNED_CLOSE_REQUIRED');
    expect(f.cleanup()).toMatchObject({ exitCode: 2, signalCode: null, forced: false });
  });
});


describe('前台握手真实生产路径的隔离合同', () => {
  it.each([
    ['already-owned', 0, 'ALREADY_OWNED'], ['switch-true', 1, 'EXACT_ROOT_ESTABLISHED'], ['switch-false-exact', 1, 'EXACT_ROOT_ESTABLISHED'],
    ['false-wrong', 1, 'NOT_ESTABLISHED'], ['true-wrong', 1, 'NOT_ESTABLISHED'], ['null-window', 1, 'NOT_ESTABLISHED'],
    ['same-main-other-root', 1, 'NOT_ESTABLISHED'], ['birth-before', 0, 'BIRTH'], ['exe-before', 0, 'BIRTH'],
    ['root-before', 0, 'ROOT_OWNER'], ['ancestor-before', 0, 'ANCESTOR'], ['api-before', 0, 'API'],
    ['birth-after', 1, 'BIRTH'], ['exe-after', 1, 'BIRTH'], ['root-after', 1, 'ROOT_OWNER'], ['ancestor-after', 1, 'ANCESTOR'],
    ['api-after', 1, 'API'], ['expire-before-activation', 0, 'REQUEST_EXPIRED'], ['expire-after-activation', 1, 'REQUEST_EXPIRED'],
  ])('真实NativeOwner前台%s只按held Main与exactRoot回读裁决且不生成语音', (scenario, calls, reason) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-foreground-native-unit-'));
    const result = execFileSync('python', [path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
      path.resolve('scripts/v16-nvda-speech-observer.py'), 'foreground-native', scenario], { encoding: 'utf8', windowsHide: true });
    expect(JSON.parse(result)).toEqual({ isolatedModel: true, setForegroundCalls: calls, reason,
      exactOnly: true, noSpeechOrNames: true, oneConsumedRequest: true, ownedStopAfterward: true, heldHandleDisposed: true });
  });
  it.each(['expired', 'future', 'over-budget', 'cross-token', 'cross-pid', 'unknown-field', 'replay-nonce', 'replay-sequence', 'duplicate-poll', 'stop-priority', 'processing-busy'])(
    '真实plugin前台请求%s严格拒绝或单次消费且STOP优先', scenario => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-foreground-request-unit-'));
      const result = execFileSync('python', [path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
        path.resolve('scripts/v16-nvda-speech-observer.py'), 'foreground-request', scenario], { encoding: 'utf8', windowsHide: true });
      expect(JSON.parse(result)).toEqual({ isolatedModel: true, invalidOrOnceOnly: true, noSpeechOrNames: true,
        noForeignIdentityPersisted: true, ownedStopAfterward: true, heldHandleDisposed: true });
    });
  it.each(['success', 'alreadyOwned', 'falseExact'])('真实reader前台%s与同节点speech共享原10秒且nonce独立', async mode => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.foregroundMode = mode;
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.foregroundRequests).toHaveLength(1); expect(f.foregroundAcks).toHaveLength(1);
    const foreground = f.foregroundRequests[0], speechRequest = result.providerWitness.request;
    expect(Object.keys(foreground).sort()).toEqual(['schemaVersion', 'command', 'runToken', 'nonce', 'pid', 'nodeSequence', 'startedAt', 'deadlineAt'].sort());
    expect(foreground).toMatchObject({ schemaVersion: 1, command: 'ensure-foreground', pid: f.child.pid, runToken: reader.binding.runToken,
      nodeSequence: speechRequest.sequence, startedAt: speechRequest.startedAt, deadlineAt: speechRequest.deadlineAt });
    expect(foreground.nonce).not.toBe(speechRequest.nonce);
    expect(Date.parse(foreground.deadlineAt) - Date.parse(foreground.startedAt)).toBe(10_000);
    expect(f.protocolEvents.indexOf('foreground-ack')).toBeLessThan(f.protocolEvents.indexOf('speech-request'));
    expect(result.rows.map(row => row.kind)).toEqual(['nvda-synth-speech']);
    expect(result.providerWitness).not.toHaveProperty('foregroundAck');
    expect(f.foregroundFiles().filter(row => path.basename(row.file).startsWith('collector-foreground-ack-'))).toHaveLength(1);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, stopRequested: true, exitCode: 0, signalCode: null });
    expect(f.kills).toEqual([]); expect(f.pendingTimerCount()).toBe(0);
  });
  it.each(['falseWrong', 'trueWrong', 'nullWindow', 'sameMainOtherRoot', 'birth', 'api', 'expired', 'crossToken', 'crossPid',
    'crossNonce', 'crossSequence', 'wrongStartedAt', 'wrongDeadlineAt', 'unknownField'])(
    '真实reader拒绝前台%s且未发speech仍可owned STOP回收', async mode => {
      const f = readerModel(), reader = await f.open(), node = f.node(); f.foregroundMode = mode;
      let original;
      try { await reader.capture(f.runtime, f.locator(node), node); } catch (error) { original = error; }
      expect(original?.message).toBe('UI_NVDA_OWNED_FOREGROUND_NOT_ESTABLISHED');
      expect(original.cause?.message).toMatch(/UI_NVDA_OWNED_FOREGROUND_(ACK_INVALID|REJECTED)/);
      expect(f.logs.some(line => line.event === 'v16.ui_screen_reader_capture_failed' && line.error === original)).toBe(true);
      expect(f.foregroundRequests).toHaveLength(1); expect(f.speechRequest()).toBeNull();
      expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']);
      await expect(reader.close()).resolves.toMatchObject({ exited: true, closed: true, forced: false, stopRequested: true, exitCode: 0, signalCode: null });
      expect(f.cleanup().stopAck.nonce).toBe(f.cleanup().stopRequest.nonce);
      expect(f.kills).toEqual([]); expect(f.execCalls.some(call => call.args.includes('--quit'))).toBe(false);
      expect(f.pendingTimerCount()).toBe(0);
    });
  it('真实reader拒绝前节点ACK重放且新foreground与speech序号同增', async () => {
    const f = readerModel(), reader = await f.open(), first = f.node(), second = f.node('unit-return');
    const a = await reader.capture(f.runtime, f.locator(first), first); f.foregroundMode = 'replay';
    await expect(reader.capture(f.runtime, f.locator(second), second)).rejects.toThrow('UI_NVDA_OWNED_FOREGROUND_NOT_ESTABLISHED');
    expect(f.foregroundRequests).toHaveLength(2);
    expect(f.foregroundRequests[1].nodeSequence).toBe(a.providerWitness.request.sequence + 1);
    expect(f.foregroundRequests[1].nonce).not.toBe(f.foregroundRequests[0].nonce);
    expect(f.speechRequest().nonce).toBe(a.providerWitness.request.nonce);
    expect(f.rawRows().filter(row => row.kind === 'nvda-synth-speech')).toHaveLength(1);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 }); expect(f.kills).toEqual([]);
  });
  it('前台ACK等待计入同一10秒且超时不发speech也不阻断owned STOP', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.foregroundMode = 'timeout'; const startedAt = f.now;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_OWNED_FOREGROUND_NOT_ESTABLISHED');
    expect(f.now - startedAt).toBeGreaterThanOrEqual(10_000); expect(f.now - startedAt).toBeLessThan(10_100);
    expect(f.speechRequest()).toBeNull(); expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']);
    const cancelled = f.foregroundFiles().filter(row => path.basename(row.file).startsWith('collector-foreground-cancelled-'));
    expect(cancelled).toHaveLength(1); expect(JSON.parse(cancelled[0].text)).toEqual(f.foregroundRequests[0]);
    expect(f.foregroundFiles().some(row => path.basename(row.file) === 'collector-foreground.json')).toBe(false);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, stopRequested: true, exitCode: 0 });
    expect(f.kills).toEqual([]); expect(f.pendingTimerCount()).toBe(0);
  });
  it('前台处理耗时不重置speech剩余预算且ACK本身不能补实际语音', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.foregroundElapsedMs = 9800; f.noSpeech = true; const startedAt = f.now;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(OPERATION_DEADLINE_EXCEEDED|SPOKEN_NODE_NOT_OBSERVED)/);
    expect(f.foregroundAcks).toHaveLength(1); expect(f.speechRequest()).not.toBeNull();
    expect(f.now - startedAt).toBeGreaterThanOrEqual(10_000); expect(f.now - startedAt).toBeLessThan(10_100);
    expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 }); expect(f.pendingTimerCount()).toBe(0);
  });
  it('前台超时撤销仅能移动自己完整pending而不触碰其它nonce', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.foregroundMode = 'timeoutForeign';
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_OWNED_FOREGROUND_NOT_ESTABLISHED');
    const pending = f.foregroundFiles().find(row => path.basename(row.file) === 'collector-foreground.json');
    expect(pending).toBeDefined(); expect(JSON.parse(pending.text).nonce).toBe('33333333-3333-4333-8333-333333333333');
    expect(f.foregroundFiles().filter(row => path.basename(row.file).startsWith('collector-foreground-cancelled-'))).toEqual([]);
    expect(f.speechRequest()).toBeNull();
    await expect(reader.close()).resolves.toMatchObject({ forced: false, stopRequested: true, exitCode: 0 }); expect(f.kills).toEqual([]);
  });
  it('两个节点nonce化ACK原件分别保留且不覆盖第一节点', async () => {
    const f = readerModel(), reader = await f.open(), first = f.node(), second = f.node('unit-return');
    await reader.capture(f.runtime, f.locator(first), first);
    const original = f.foregroundFiles().find(row => path.basename(row.file).startsWith('collector-foreground-ack-'));
    expect(original).toBeDefined();
    await reader.capture(f.runtime, f.locator(second), second);
    const acks = f.foregroundFiles().filter(row => path.basename(row.file).startsWith('collector-foreground-ack-'));
    expect(acks).toHaveLength(2); expect(acks.find(row => row.file === original.file).text).toBe(original.text);
    expect(f.foregroundRequests[1].nodeSequence).toBe(f.foregroundRequests[0].nodeSequence + 1);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 }); expect(f.kills).toEqual([]);
  });
});


describe('R30真实reader首次焦点布防与失败会话边界', () => {
  it('首次真实焦点前原子arm且单次自然延迟语音保留原Tab回焦与全部阶段原件', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node();
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.protocolEvents.indexOf('speech-request')).toBeLessThan(f.protocolEvents.indexOf('node-focus'));
    expect(f.focusCounts(node)).toBe(2); expect(f.protocolEvents.filter(event => event === 'first-focus-natural-speech')).toHaveLength(1);
    expect(result.rows).toHaveLength(1); expect(reader.sessionFailure).toBeNull();
    expect(f.phaseRows().map(row => row.phase)).toEqual(['armed', 'first-focus-completed', 'host-before-completed', 'tab-completed',
      'target-focus-completed', 'wait-started', 'wait-completed']);
    for (const row of f.phaseRows()) {
      expect(row).toMatchObject({ kind: 'v16-nvda-node-phase', schemaVersion: 1, pid: f.child.pid, nodeSequence: 1,
        runToken: reader.binding.runToken, nonce: result.providerWitness.request.nonce, nodeId: node.id });
      expect(Date.parse(row.deadlineAt) - Date.parse(row.startedAt)).toBe(10_000);
    }
    expect(Date.parse(result.rows[0].timestamp)).toBeGreaterThanOrEqual(Date.parse(result.providerWitness.hostBefore.observedAt));
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 });
  });
  it('首次焦点触发的延迟目标语音前有非匹配祖先语音仍只接纳真实目标且保留全部raw', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.ancestorBeforeTarget = true;
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(result.rows).toHaveLength(1); expect(result.rows[0].focusName).toBe(node.name);
    expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready', 'nvda-synth-speech', 'nvda-synth-speech']);
    expect(f.rawRows()[1]).toMatchObject({ focusName: node.name, focusRole: node.role, spoken: '延迟祖先容器' });
    expect(result.providerWitness.request.rawOffset).toBe(1); expect(result.rows[0].rawIndex).toBe(2);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 });
  });
  it('只有延迟祖先语音不能形成目标信用且原十秒失败后立即STOP并禁止后续runtime操作', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.onlyAncestorSpeech = true; const started = f.now;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(OPERATION_DEADLINE_EXCEEDED|SPOKEN_NODE_NOT_OBSERVED)/);
    expect(f.now - started).toBeGreaterThanOrEqual(10_000); expect(f.now - started).toBeLessThan(10_100);
    expect(f.protocolEvents.filter(event => event === 'owned-stop-request')).toHaveLength(1);
    expect(reader.sessionFailure?.message).toMatch(/UI_NVDA_(OPERATION_DEADLINE_EXCEEDED|SPOKEN_NODE_NOT_OBSERVED)/);
    const operations = f.runtimeOperations, firstFailure = reader.sessionFailure;
    await expect(reader.capture(f.runtime, f.locator(f.node('unit-return')), f.node('unit-return'))).rejects.toMatchObject({
      message: 'UI_NVDA_CAPTURE_SESSION_UNUSABLE', cause: firstFailure });
    expect(f.runtimeOperations).toBe(operations); expect(reader.sessionFailure).toBe(firstFailure);
    expect(f.phaseRows().filter(row => row.phase === 'capture-failed')).toHaveLength(2);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, stopRequested: true, exitCode: 0 }); expect(f.kills).toEqual([]);
  });
  it.each([
    ['first-focus', ['armed']], ['host-before', ['armed', 'first-focus-completed']],
    ['tab', ['armed', 'first-focus-completed', 'host-before-completed']],
    ['target-focus', ['armed', 'first-focus-completed', 'host-before-completed', 'tab-completed']],
  ])('真实%s边界失败保留已完成阶段与原异常且只发一次owned STOP', async (step, phases) => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.failStep = step;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toBe(f.boundaryError);
    expect(f.phaseRows().map(row => row.phase)).toEqual([...phases, 'capture-failed']);
    expect(f.phaseRows().at(-1).errorCode).toBe(f.boundaryError.message);
    expect(reader.sessionFailure).toBe(f.boundaryError); expect(f.protocolEvents.filter(event => event === 'owned-stop-request')).toHaveLength(1);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 }); expect(f.kills).toEqual([]);
  });
  it('阶段原件writer故障不能掩盖真实first-focus原异常且仍记录故障并owned STOP', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.failStep = 'first-focus'; f.phaseWriteFails = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toBe(f.boundaryError);
    expect(f.logs.some(row => row.event === 'v16.ui_screen_reader_phase_record_failed' && row.error.message === 'UNIT_PHASE_WRITER_FAILED')).toBe(true);
    expect(f.logs.some(row => row.event === 'v16.ui_screen_reader_capture_failed' && row.error === f.boundaryError)).toBe(true);
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 });
  });
  it('实际首次焦点过早语音原样保留但仍被hostBefore时间门拒绝且不接受补造语音', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.earlySpeech = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_PROVIDER_TIME_INVALID');
    expect(f.rawRows().filter(row => row.kind === 'nvda-synth-speech')).toHaveLength(1);
    expect(f.protocolEvents.filter(event => event === 'first-focus-natural-speech')).toHaveLength(1);
    expect(reader.sessionFailure?.message).toBe('UI_NVDA_PROVIDER_TIME_INVALID');
    await expect(reader.close()).resolves.toMatchObject({ forced: false, exitCode: 0 });
  });
  it('失败时owned STOP已ack但未退出仍必须按原十五秒失败并仅强制回收自有child', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.failStep = 'first-focus'; f.stopAckWithoutExit = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toBe(f.boundaryError); const started = f.now;
    await expect(reader.close()).rejects.toThrow('UI_NVDA_OWNED_STOP_TIMEOUT');
    expect(f.now - started).toBeGreaterThanOrEqual(15_000); expect(f.now - started).toBeLessThanOrEqual(15_100);
    expect(f.cleanup()).toMatchObject({ forced: true, stopRequested: true, signalCode: 'SIGKILL' });
    expect(f.cleanup().stopAck.nonce).toBe(f.cleanup().stopRequest.nonce); expect(f.kills).toEqual([{ child: f.child, signal: 'SIGKILL' }]);
  });
  it('正常关闭后的capture在任何runtime与locator操作前拒绝且不再发STOP', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); await reader.close(); const operations = f.runtimeOperations;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_CAPTURE_SESSION_CLOSED');
    expect(f.runtimeOperations).toBe(operations); expect(f.protocolEvents.filter(event => event === 'owned-stop-request')).toHaveLength(1);
  });
});


describe('R30-r2真实reader原STOP绝对截止', () => {
  it('及时ACK但exit与close迟到再迟调close仍拒绝正常信用并保留真实晚到时刻', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.failStep = 'first-focus'; f.stopAckWithoutExit = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toBe(f.boundaryError);
    const request = f.stopRequest(), requestedAt = Date.parse(request.requestedAt);
    f.now = requestedAt + 16_000; f.exit(0); f.now = requestedAt + 17_000;
    const closing = reader.close(); expect(reader.close()).toBe(closing);
    await expect(closing).rejects.toThrow('UI_NVDA_OWNED_STOP_TIMEOUT');
    const receipt = f.cleanup();
    expect(receipt).toMatchObject({ exited: true, closed: true, forced: false, stopRequested: true, exitCode: 0, signalCode: null });
    expect(Object.keys(receipt.exitEvent).sort()).toEqual(['code', 'signal']); expect(Object.keys(receipt.closeEvent).sort()).toEqual(['code', 'signal']);
    expect(Date.parse(receipt.stopAck.timestamp)).toBeLessThanOrEqual(requestedAt + 15_000);
    expect(f.stopTiming()).toMatchObject({ kind: 'v16-nvda-owned-stop-timing', schemaVersion: 1, formalCredit: false,
      nonce: request.nonce, requestedAt: request.requestedAt, deadlineAt: new Date(requestedAt + 15_000).toISOString(),
      exitObservedAt: new Date(requestedAt + 16_000).toISOString(), closeObservedAt: new Date(requestedAt + 16_000).toISOString(),
      completedWithinOriginalDeadline: false });
    expect(reader.sessionFailure).toBe(f.boundaryError); expect(f.kills).toEqual([]);
    expect(f.protocolEvents.filter(event => event === 'owned-stop-request')).toHaveLength(1);
  });
  it('及时ACK及原截止内退出后迟调close仍凭真实观察时刻允许且不重发或重启STOP预算', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.failStep = 'first-focus'; f.stopAckWithoutExit = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toBe(f.boundaryError);
    const request = f.stopRequest(), requestedAt = Date.parse(request.requestedAt);
    f.now = requestedAt + 14_999; f.exit(0); f.now = requestedAt + 17_000;
    const closing = reader.close(); expect(reader.close()).toBe(closing);
    await expect(closing).resolves.toMatchObject({ exited: true, closed: true, forced: false, stopRequested: true, exitCode: 0, signalCode: null });
    expect(f.now).toBe(requestedAt + 17_000);
    expect(f.stopTiming()).toMatchObject({ requestedAt: request.requestedAt, deadlineAt: new Date(requestedAt + 15_000).toISOString(),
      exitObservedAt: new Date(requestedAt + 14_999).toISOString(), closeObservedAt: new Date(requestedAt + 14_999).toISOString(),
      completedWithinOriginalDeadline: true });
    expect(reader.sessionFailure).toBe(f.boundaryError); expect(f.kills).toEqual([]); expect(f.pendingTimerCount()).toBe(0);
    expect(f.protocolEvents.filter(event => event === 'owned-stop-request')).toHaveLength(1);
  });
  it('原STOP截止已过仍未退出时迟调close立即超时并仅走原自有强制回收', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.failStep = 'first-focus'; f.stopAckWithoutExit = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toBe(f.boundaryError);
    const request = f.stopRequest(), requestedAt = Date.parse(request.requestedAt); f.now = requestedAt + 17_000;
    const callerAt = f.now, closing = reader.close(); expect(reader.close()).toBe(closing);
    const failureLog = f.logs.find(row => row.event === 'v16.ui_screen_reader_owned_stop_failed');
    expect(failureLog?.error.message).toBe('UI_NVDA_OWNED_STOP_TIMEOUT'); expect(failureLog.hostObservedAtMs).toBe(callerAt);
    await expect(closing).rejects.toThrow('UI_NVDA_OWNED_STOP_TIMEOUT');
    expect(f.now - callerAt).toBeLessThanOrEqual(100);
    expect(f.cleanup()).toMatchObject({ exited: true, closed: true, forced: true, stopRequested: true, signalCode: 'SIGKILL' });
    expect(f.stopTiming()).toMatchObject({ requestedAt: request.requestedAt, deadlineAt: new Date(requestedAt + 15_000).toISOString(),
      completedWithinOriginalDeadline: false });
    expect(Date.parse(f.stopTiming().exitObservedAt)).toBeGreaterThan(requestedAt + 15_000);
    expect(Date.parse(f.stopTiming().closeObservedAt)).toBeGreaterThan(requestedAt + 15_000);
    expect(reader.sessionFailure).toBe(f.boundaryError); expect(f.kills).toEqual([{ child: f.child, signal: 'SIGKILL' }]);
    expect(f.protocolEvents.filter(event => event === 'owned-stop-request')).toHaveLength(1);
  });
});

describe('正式reader一次caption setup与原节点预算边界', () => {
  it('ready后只做一次setup，两节点分别从新起点使用原10秒预算', async () => {
    const f = readerModel(); f.captionElapsedMs = 15000;
    const before = f.now, reader = await f.open();
    expect(f.captionSetups).toBe(1); expect(f.now - before).toBeGreaterThanOrEqual(15000);
    await reader.capture(f.runtime, f.locator(f.node()), f.node());
    const second = f.node('unit-return'); await reader.capture(f.runtime, f.locator(second), second);
    expect(f.captionSetups).toBe(1); expect(f.foregroundRequests).toHaveLength(2);
    for (const request of f.foregroundRequests) expect(Date.parse(request.deadlineAt) - Date.parse(request.startedAt)).toBe(10000);
    await reader.close(); expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0, signalCode: null });
  });
  it('setup首错沿真实open catch请求ownedSTOP并正常exit close，不进入任何节点焦点', async () => {
    const f = readerModel(), original = new Error('UNIT_CAPTION_SETUP_FAILED'); f.captionFailure = original;
    await expect(f.open()).rejects.toBe(original); expect(f.captionSetups).toBe(1);
    expect(f.protocolEvents.filter(event => event === 'owned-stop-request')).toHaveLength(1);
    expect(f.protocolEvents).not.toContain('node-focus'); expect(f.foregroundRequests).toHaveLength(0);
    expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0, signalCode: null }); expect(f.kills).toEqual([]);
  });
  it('setup失败与STOP失败并存时原setup异常不被退出错误覆盖', async () => {
    const f = readerModel(), original = new Error('UNIT_CAPTION_SETUP_ORIGINAL'); f.captionFailure = original; f.badAck = true;
    await expect(f.open()).rejects.toBe(original);
    expect(f.logs.some(row => row.event === 'v16.ui_screen_reader_cleanup_failed')).toBe(true);
    expect(f.foregroundRequests).toHaveLength(0);
  });
});


describe('官方启动完成通知先于caption的隔离合同', () => {
  it('插件ready后等待独立官方startup原件再做唯一caption且不污染自然语音', async () => {
    const f = readerModel(); f.startupDelayMs = 500;
    const startedAt = f.now, reader = await f.open();
    expect(f.now - startedAt).toBeGreaterThanOrEqual(500);
    expect(f.protocolEvents.indexOf('startup-complete')).toBeGreaterThanOrEqual(0);
    expect(f.protocolEvents.indexOf('startup-complete')).toBeLessThan(f.protocolEvents.indexOf('caption-setup'));
    expect(f.captionSetups).toBe(1); expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']);
    const launch = f.launchReceipt();
    expect(launch.startupComplete).toMatchObject({ kind: 'nvda-observer-startup-complete', pid: f.child.pid, runToken: reader.binding.runToken });
    expect(launch.startupCompleteRef).toMatchObject({ path: path.join(f.output, 'screen-reader/startup-complete.json'), sha256: expect.any(String), sizeBytes: expect.any(Number) });
    expect(launch.startupValidation).toMatchObject({ passed: true, original: launch.startupCompleteRef, eventTimestamp: launch.startupComplete.timestamp });
    expect(Date.parse(launch.startupValidation.hostObservedAt)).toBeLessThanOrEqual(Date.parse(f.captionObservedAt));
    const node = f.node(), observation = await reader.capture(f.runtime, f.locator(node), node);
    expect(observation.providerWitness.readerLaunch).toEqual(reader.receipt);
    expect(observation.rows.every(row => row.kind === 'nvda-synth-speech')).toBe(true);
    await reader.close(); expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0, signalCode: null });
  });
  it('只有ready而无startup时原30秒截止失败并零caption零节点后正常ownedSTOP', async () => {
    const f = readerModel(); f.noStartupComplete = true;
    const startedAt = f.now;
    await expect(f.open()).rejects.toThrow(/UI_NVDA_(STARTUP_NOT_COMPLETE|OPERATION_DEADLINE_EXCEEDED)/);
    const requestedAfterMs = Date.parse(f.stopRequest().requestedAt) - startedAt;
    expect(requestedAfterMs).toBeGreaterThanOrEqual(30_000); expect(requestedAfterMs).toBeLessThan(30_100);
    expect(f.captionSetups || 0).toBe(0); expect(f.foregroundRequests).toHaveLength(0);
    expect(f.protocolEvents).not.toContain('node-focus'); expect(f.protocolEvents.filter(event => event === 'owned-stop-request')).toHaveLength(1);
    expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']);
    expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0, signalCode: null }); expect(f.pendingTimerCount()).toBe(0);
  });
  it.each(['crossPid', 'crossToken', 'crossBinding', 'crossVersion', 'beforeOpen', 'future', 'unknownField', 'wrongSource'])(
    'startup拒绝%s且不得调用caption或给自然语音信用', async startupMode => {
      const f = readerModel(); f.startupMode = startupMode;
      await expect(f.open()).rejects.toThrow('UI_NVDA_STARTUP_COMPLETE_INVALID');
      expect(f.captionSetups || 0).toBe(0); expect(f.foregroundRequests).toHaveLength(0);
      expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']);
      expect(f.logs.some(row => row.event === 'v16.ui_screen_reader_failed')).toBe(true);
      expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0, signalCode: null });
    });
  it('启动完成前reader退出必须保留早退错误且不调用caption', async () => {
    const f = readerModel(); f.noStartupComplete = true; f.exitBeforeStartup = true;
    await expect(f.open()).rejects.toThrow(/UI_NVDA_EXITED_BEFORE_(STARTUP_COMPLETE|READY|OWNED_STOP)/);
    expect(f.captionSetups || 0).toBe(0); expect(f.kills).toEqual([]);
    expect(f.cleanup()).toMatchObject({ earlyExit: true, forced: false, exitCode: 0, signalCode: null });
  });
  it('startup身份错误和STOP错误并存仍保留启动首错与独立回收日志', async () => {
    const f = readerModel(); f.startupMode = 'crossToken'; f.badAck = true;
    await expect(f.open()).rejects.toThrow('UI_NVDA_STARTUP_COMPLETE_INVALID');
    expect(f.captionSetups || 0).toBe(0);
    expect(f.logs.some(row => row.event === 'v16.ui_screen_reader_cleanup_failed')).toBe(true);
  });
  it.each(['notify', 'terminate-before-notify', 'publish-failure', 'register-failure', 'missing-api', 'unregister-failure'])(
    '真实observer隔离官方Action的%s生命周期不调用输入或合成语音', scenario => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-startup-unit-'));
      const result = execFileSync('python', ['-B', path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
        path.resolve('scripts/v16-nvda-speech-observer.py'), 'startup-gates', scenario], { encoding: 'utf8', windowsHide: true });
      expect(JSON.parse(result)).toEqual({ isolatedModel: true, officialActionOnly: true, readyIsNotStartupOrSpeech: true,
        lateOrFailedCallbackClosed: true, ownedHandleDisposed: true, noInputOrContent: true });
    });
});


describe('真实NVDA焦点处理阶段与自然语音隔离', () => {
  it('同一原十秒内等first-focus处理ACK后才Tab并等Tab处理ACK后才回焦', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.focusAckDelayMs = 200;
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.focusRequests.map(row => row.phase)).toEqual(['first-focus', 'tab', 'target-focus']);
    expect(f.protocolEvents.indexOf('focus-ack-first-focus')).toBeLessThan(f.protocolEvents.indexOf('key-Tab'));
    const secondFocus = f.protocolEvents.lastIndexOf('node-focus');
    expect(f.protocolEvents.indexOf('focus-ack-tab')).toBeLessThan(secondFocus);
    expect(result.rows).toHaveLength(1); expect(f.focusCounts(node)).toBe(2);
    for (const request of f.focusRequests) { expect(request.nodeNonce).toBe(result.providerWitness.request.nonce);
      expect(Date.parse(request.deadlineAt) - Date.parse(request.startedAt)).toBe(10_000); }
    await reader.close(); expect(f.kills).toEqual([]);
  });
  it('DOM本已focused时明确允许already-focused元数据且不伪造自然gainFocus', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.domInitiallyFocused = true;
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.focusAcks).toHaveLength(3); expect(f.focusAcks[0]).toMatchObject({ source: 'already-focused', eventGeneration: 0, eventTimestamp: null });
    expect(result.rows).toHaveLength(1); expect(f.rawRows().filter(row => row.kind === 'nvda-synth-speech')).toHaveLength(1);
    await reader.close();
  });
  it('Tab仍停留最终目标时明确失败且禁止already-focused冒充移焦', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.tabDestination = null;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(DOM_FOCUS_|OPERATION_DEADLINE)/);
    expect(f.focusAcks.map(row => row.source)).toEqual(['event-gainFocus']);
    expect(f.focusRequests.map(row => row.phase)).toEqual(['first-focus']); await reader.close();
  });
  it('没有真实处理ACK时不得越过first-focus继续Tab且不重启十秒截止', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.focusAckMode = 'timeout'; const started = f.now;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(OPERATION_DEADLINE_EXCEEDED|FOCUS_PHASE_TIMEOUT)/);
    expect(f.protocolEvents).not.toContain('key-Tab'); expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']);
    expect(f.now - started).toBeGreaterThanOrEqual(10_000); expect(f.now - started).toBeLessThanOrEqual(10_100);
    await reader.close(); expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0 });
  });
  it.each(['nonce', 'sequence', 'phase', 'unknown', 'source', 'pending', 'oldEvent', 'already', 'future', 'owner', 'birth'])(
    '真实consumer拒绝%s焦点ACK且不能用元数据代替自然speech', async mode => {
      const f = readerModel(), reader = await f.open(), node = f.node(); f.focusAckMode = mode;
      await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_FOCUS_/);
      expect(f.rawRows().map(row => row.kind)).toEqual(['nvda-observer-ready']); await reader.close();
      expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0 });
    });
  it('所有focus ACK正确也不能放行当前focusName正确但spoken仍是前节点的自然记录', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.speechMismatch = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(OPERATION_DEADLINE_EXCEEDED|SPOKEN_NODE_NOT_OBSERVED)/);
    expect(f.focusAcks).toHaveLength(3); expect(f.rawRows().at(-1)).toMatchObject({ focusName: node.name, spoken: '前一个节点的自然语音' });
    await reader.close(); expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0 });
  });
  it('focus元数据等待消耗原节点预算而不会为后续阶段或speech续十秒', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.focusAckDelayMs = 9_800; const started = f.now;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(OPERATION_DEADLINE_EXCEEDED|FOCUS_PHASE_TIMEOUT)/);
    expect(f.now - started).toBeGreaterThanOrEqual(10_000); expect(f.now - started).toBeLessThanOrEqual(10_100);
    await reader.close(); expect(f.kills).toEqual([]);
  });
  it.each(['event', 'already', 'pending', 'foreign', 'handler-failure', 'replay', 'unknown', 'expired', 'identity', 'phase',
    'long-path', 'ack-open-failure', 'ack-write-failure', 'ack-temp-collision', 'ack-target-collision', 'ack-publish-failure'])(
    '真实Python处理链的%s焦点metadata只通过隔离端口且零合成语音', scenario => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-nvda-focus-unit-'));
      const result = execFileSync('python', ['-B', path.resolve('scripts/v16-nvda-observer-test-harness.py'), directory,
        path.resolve('scripts/v16-nvda-speech-observer.py'), 'focus-phases', scenario], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
      expect(JSON.parse(result)).toEqual({ isolatedModel: true, source: scenario, speechCredit: false, originalSpeechStatePreserved: true, nextHandlerOnce: true });
    });
});

describe('隔离Tab移焦的真实consumer协议覆盖', () => {
  it('Tab转到不同名称及角色后要求新generation再回原目标并保留同一十秒期限', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node();
    f.tabDestination = { name: '下一输入项', role: 'textbox' };
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.focusRequests.map(row => [row.phase, row.name, row.role])).toEqual([
      ['first-focus', node.name, node.role], ['tab', '下一输入项', 'textbox'], ['target-focus', node.name, node.role] ]);
    expect(f.focusAcks.map(row => row.source)).toEqual(['event-gainFocus', 'event-gainFocus', 'event-gainFocus']);
    expect(f.focusAcks.map(row => row.eventGeneration)).toEqual([1, 2, 3]);
    expect(f.focusRequests.map(row => row.baselineGeneration)).toEqual([0, 1, 2]);
    expect(new Set(f.focusRequests.map(row => row.deadlineAt)).size).toBe(1);
    for (const request of f.focusRequests) expect(Date.parse(request.deadlineAt) - Date.parse(request.startedAt)).toBe(10_000);
    expect(result.providerWitness.hostAfter.dom.activeElementId).toBe(node.id); expect(result.rows).toHaveLength(1);
    expect(f.focusCounts(node)).toBe(2); await reader.close();
    expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0, signalCode: null }); expect(f.kills).toEqual([]);
  });
  it('Tab已离开原目标时拒绝前一focus阶段的旧ACK并停止回焦且不授语音信用', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node();
    f.tabDestination = { name: '下一输入项', role: 'textbox' }; f.focusAckMode = 'priorFocusOnTab';
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_FOCUS_ACK_IDENTITY_MISMATCH');
    expect(f.focusRequests.map(row => row.phase)).toEqual(['first-focus', 'tab']);
    expect(f.focusRequests[1]).toMatchObject({ name: '下一输入项', role: 'textbox', baselineGeneration: 1 });
    expect(f.focusAcks[1]).toMatchObject({ phase: 'first-focus', name: node.name, role: node.role, eventGeneration: 1 });
    expect(f.focusAcks[1].nonce).toBe(f.focusAcks[0].nonce); expect(f.focusAcks[1].nonce).not.toBe(f.focusRequests[1].nonce);
    expect(f.focusCounts(node)).toBe(1); expect(f.protocolEvents.filter(event => event === 'key-Tab')).toHaveLength(1);
    await reader.close(); expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0, signalCode: null }); expect(f.kills).toEqual([]);
  });
});

describe('原生窄按键与旧焦点及自然语音门并行保持', () => {
  it('仅原生Tab及ShiftTab输入且与焦点和自然speech共用原十秒', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node();
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.nativeKeysRequests.map(row => [row.phase, row.action])).toEqual([['tab', 'Tab'], ['target-focus', 'ShiftTab']]);
    expect(f.cdpKeyCalls || 0).toBe(0); expect(f.focusCounts(node)).toBe(2);
    for (const command of f.nativeKeysRequests) {
      expect(command.nodeNonce).toBe(result.providerWitness.request.nonce);
      expect(Date.parse(command.deadlineAt) - Date.parse(command.startedAt)).toBe(10000);
    }
    expect(new Set([...f.nativeKeysRequests, ...f.focusRequests, ...f.foregroundRequests].map(row => row.nonce)).size).toBe(6);
    expect(result.rows).toHaveLength(1); await reader.close(); expect(f.kills).toEqual([]);
  });
  it.each(['nonce', 'partial', 'cleanup', 'owner', 'timeout'])('原生%s不能授输入或自然节点信用且仍owned STOP', async mode => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.nativeKeysMode = mode;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(NATIVE_KEYS_|OPERATION_DEADLINE)/);
    expect(f.nativeKeysRequests).toHaveLength(1); expect(f.focusCounts(node)).toBe(1);
    expect(f.focusRequests.map(row => row.phase)).toEqual(['first-focus']);
    expect(f.protocolEvents.filter(value => value === 'owned-stop-request')).toHaveLength(1);
    await reader.close(); expect(f.cleanup()).toMatchObject({ forced: false, exitCode: 0 });
  });
});

describe('登记的ARIA容器与顺序焦点路径', () => {
  it('具名dialog负tabindex预先固定原生ShiftTab再DOM移交并保留自然语音', async () => {
    const f = readerModel(), reader = await f.open(); f.dialogContainer = true;
    const node = { ...f.node(), role: 'dialog' }; const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.nativeKeysRequests.map(row => row.action)).toEqual(['Tab', 'ShiftTab', 'ReportFocus']);
    expect(f.phaseRows().every(row => row.focusMode === 'named-dialog-container')).toBe(true);
    expect(f.focusCounts(node)).toBe(2); expect(result.rows[0].spoken).toContain(node.name); await reader.close();
  });
  it('任意负tabindex按钮不获得对话框容器路径也不发送原生输入', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.negativeTabIndex = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_NATIVE_FOCUS_MODE_INVALID');
    expect(f.nativeKeysRequests).toHaveLength(0); expect(f.focusCounts(node)).toBe(0); await reader.close();
  });
});

describe('原生ACK与Renderer真实按键处理保持独立', () => {
  it('输入ACK先到而DOM稍后移焦时先等真实离开原目标再读取Tab目标', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.nativeDomDelayMs = 250;
    f.tabDestination = { name: '下一输入项', role: 'textbox' };
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.nativeKeysRequests).toHaveLength(2); expect(f.protocolEvents.indexOf('native-dom-Tab')).toBeGreaterThanOrEqual(0);
    expect(f.focusRequests[1]).toMatchObject({ phase: 'tab', name: '下一输入项', role: 'textbox' });
    expect(f.protocolEvents.indexOf('native-dom-Tab')).toBeLessThan(f.protocolEvents.indexOf('focus-request-tab'));
    expect(result.rows).toHaveLength(1); await reader.close();
  });
  it('只有原生ACK而没有实际DOM移焦时不得继续Tab焦点ACK或自然节点', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.nativeFocusMissing = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(DOM_FOCUS_|OPERATION_DEADLINE)/);
    expect(f.focusRequests.map(row => row.phase)).toEqual(['first-focus']); await reader.close();
  });
});


describe('固定DOM焦点与NVDA处理路径兼容browse override', () => {
  it('browse override不发DOM键盘事件但实际移焦及新gainFocus后仍独立要求自然语音', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.nativeDomMissing = true;
    const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.nativeEvent).toBeUndefined(); expect(f.focusAcks.map(row => row.source)).toEqual(['event-gainFocus', 'event-gainFocus', 'event-gainFocus']);
    expect(result.rows).toHaveLength(1); expect(f.nativeKeysRequests.map(row => row.action)).toEqual(['Tab', 'ShiftTab']); await reader.close();
  });
  it.each(['alreadyOnTab', 'alreadyOnTarget'])('%s不能用已聚焦来源替代实际新处理事件', async mode => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.focusAckMode = mode;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_FOCUS_ALREADY_NOT_ALLOWED'); await reader.close();
  });
  it('ShiftTab未回原目标不得以输入ACK或过期后事件补目标信用', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.targetMissing = true; const started = f.now;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow(/UI_NVDA_(DOM_FOCUS_|OPERATION_DEADLINE)/);
    expect(f.now - started).toBeGreaterThanOrEqual(10000); expect(f.focusRequests.map(row => row.phase)).toEqual(['first-focus', 'tab']); await reader.close();
  });
  it('页面实际失焦时不得用activeElement或正确名称继续输入', async () => {
    const f = readerModel(), reader = await f.open(), node = f.node(); f.documentUnfocused = true;
    await expect(reader.capture(f.runtime, f.locator(node), node)).rejects.toThrow('UI_NVDA_DOM_FOCUS_DOCUMENT_LOST');
    expect(f.nativeKeysRequests).toHaveLength(0); await reader.close();
  });
  it('dialog固定handoff处理后才DOM回焦且四个阶段共享原deadline与模式', async () => {
    const f = readerModel(), reader = await f.open(); f.dialogContainer = true; f.nativeDomDelayMs = 250;
    const node = { ...f.node(), role: 'dialog' }; const result = await reader.capture(f.runtime, f.locator(node), node);
    expect(f.focusRequests.map(row => row.phase)).toEqual(['first-focus', 'tab', 'target-handoff', 'target-focus']);
    expect(f.protocolEvents.indexOf('focus-ack-target-handoff')).toBeLessThan(f.protocolEvents.lastIndexOf('node-focus'));
    expect(new Set(f.focusRequests.map(row => row.deadlineAt)).size).toBe(1); expect(f.focusRequests.every(row => row.focusMode === 'named-dialog-container' && (row.phase === 'first-focus' || !row.allowAlreadyFocused))).toBe(true);
    expect(f.nativeKeysRequests.map(row => row.action)).toEqual(['Tab', 'ShiftTab', 'ReportFocus']); expect(result.rows).toHaveLength(1); await reader.close();
  });
});
