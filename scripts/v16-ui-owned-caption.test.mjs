import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import contract from './v16-ui-owned-caption-contract.js';

const require = createRequire(import.meta.url), root = process.cwd();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function load(relative, ports, globals = {}) {
  const file = path.join(root, 'scripts', relative), module = { exports: {} };
  const localRequire = name => {
    if (Object.hasOwn(ports, name)) return ports[name];
    throw new Error('UNIT_CAPTION_UNEXPECTED_PORT:' + name);
  };
  // 运行真实职责模块，系统窗口、子进程与文件写入均只经过显式隔离端口。
  vm.runInNewContext('(function(require,module,exports,__dirname){' + fs.readFileSync(file, 'utf8') + '\n})',
    { Buffer, Date, setTimeout, clearTimeout, ...globals }, { filename: file })(localRequire, module, module.exports, path.dirname(file));
  return module.exports;
}
function windowPort(options = {}) {
  const clock = { now: Date.now(), held: false, pending: null }, mutations = [], setterArguments = [];
  const timers = new Map(); let nextTimer = 0;
  const timeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay, at: clock.now + delay }); return id; };
  const clear = id => timers.delete(id);
  const fire = id => { const timer = timers.get(id); assert.ok(timer, 'UNIT_CAPTION_TIMER_REQUIRED'); timers.delete(id); timer.callback(); };
  clock.yieldCount = () => [...timers.values()].filter(timer => timer.delay === 0).length;
  clock.fireYield = () => { const entry = [...timers].find(([, timer]) => timer.delay === 0); assert.ok(entry, 'UNIT_CAPTION_YIELD_REQUIRED'); clock.now++; fire(entry[0]); };
  clock.fireDeadline = () => { const entry = [...timers].find(([, timer]) => timer.delay > 0); assert.ok(entry, 'UNIT_CAPTION_DEADLINE_REQUIRED'); clock.now = entry[1].at; fire(entry[0]); };
  class Clock extends Date { static now() { return clock.now; } }
  const expected = { pid: 123, exe: path.join(root, 'unit-caption.exe'), appRoot: path.join(root, 'unit-app'), profile: path.join(root, 'unit-profile'),
    windowId: 7, rendererPid: 456, rootHwnd: '1000' };
  const held = { pid: 123, ownerToken: '11111111-1111-4111-8111-111111111111', handleCreationTimeUtc: '2026-10-21T08:00:00.1234567Z' };
  const processPort = { pid: 123, execPath: expected.exe };
  const window = { id: 7, topmost: Boolean(options.original), nativeRoot: 1000n,
    isDestroyed() { return Boolean(this.destroyed); }, isVisible: () => true, isAlwaysOnTop() { return this.topmost; },
    setAlwaysOnTop(value, ...args) { setterArguments.push([value, ...args]); mutations.push(['topmost', value]); if (options.restoreFails && value === Boolean(options.original)) throw options.restoreFails; if (value && options.deferApply || !value && options.deferRestore) return; this.topmost = value && options.taskbarNonTopmost && args[0] !== 'pop-up-menu' ? false : value; },
    show() { mutations.push(['show']); }, moveTop() { mutations.push(['moveTop']); },
    getNativeWindowHandle() { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(this.nativeRoot); return bytes; },
    webContents: { getOSProcessId: () => expected.rendererPid } };
  const electron = { app: { isPackaged: true, getAppPath: () => expected.appRoot, getPath: () => expected.profile }, BrowserWindow: { getAllWindows: () => clock.windows ?? [window] } };
  const runtime = { app: { evaluate: async (callback, request) => {
    if (options.delayApply && request.mode === 'apply') return new Promise((resolve, reject) => {
      clock.pending = () => { try { resolve(callback(electron, request)); } catch (error) { reject(error); } };
    });
    return callback(electron, request);
  } } };
  const api = load('v16-ui-owned-caption-window.js', { './v16-ui-owned-caption-artifacts': { createCaptionArtifacts: () => ({ assert }) } },
    { Date: Clock, process: processPort, setTimeout: timeout, clearTimeout: clear });
  const call = mode => api.topmost(runtime, expected, held, 'unit-token', mode, clock.now + 1000);
  return { api, runtime, expected, held, window, electron, processPort, clock, mutations, setterArguments, call };
}

describe('正式caption单一只读协议合同', () => {
  it('冻结全部原生setup上限且没有业务配置或环境fallback', () => {
    expect(Object.isFrozen(contract.OWNED_CAPTION_PROTOCOL)).toBe(true);
    expect(contract.validateOwnedCaptionProtocol()).toBe(contract.OWNED_CAPTION_PROTOCOL);
    expect(contract.OWNED_CAPTION_PROTOCOL).toMatchObject({ setupMs: 30000, failureRestoreMs: 5000, hitTestMaxMs: 1000,
      observationMs: 1000, pollMs: 10, helperCleanupGraceMs: 1000, helperForcedCloseMs: 15000 });
  });
  it.each(Object.keys(contract.OWNED_CAPTION_PROTOCOL))('拒绝修改固定协议字段%s', key => {
    expect(() => contract.validateOwnedCaptionProtocol({ ...contract.OWNED_CAPTION_PROTOCOL,
      [key]: typeof contract.OWNED_CAPTION_PROTOCOL[key] === 'number' ? contract.OWNED_CAPTION_PROTOCOL[key] + 1 : 'other' })).toThrow('UI_CAPTION_FIXED_PROTOCOL_REQUIRED');
  });
  it.each([{}, null, { ...contract.OWNED_CAPTION_PROTOCOL, unknown: true }])('拒绝缺失或未知配置字段%j', value => {
    expect(() => contract.validateOwnedCaptionProtocol(value)).toThrow('UI_CAPTION_FIXED_PROTOCOL_REQUIRED');
  });
});

describe('正式同一owned窗口临时置顶与有界恢复', () => {
  it.each([false])('保存并恢复真实原布尔%s，仅做一次show/moveTop', async original => {
    const f = windowPort({ original }), setup = await f.call('apply'), restored = await f.call('restore');
    expect(setup.alwaysOnTopBefore).toBe(original); expect(setup.alwaysOnTopAfter).toBe(true);
    expect(restored.tokenClosed).toBe(true); expect(restored.alwaysOnTopAfter).toBe(original);
    expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop'], ['topmost', original]]);
    await expect(f.call('apply')).rejects.toThrow('UI_CAPTION_TOPMOST_SESSION_ALREADY_CLOSED');
  });
  it('恢复先到会封闭令牌，迟到apply零置顶零show零输入', async () => {
    const f = windowPort({ delayApply: true }), pending = f.call('apply');
    await Promise.resolve(); await Promise.resolve(); expect(f.clock.pending).toBeTypeOf('function');
    const restored = await f.call('restore'); expect(restored.tokenClosed).toBe(true);
    f.clock.pending(); await expect(pending).rejects.toThrow('UI_CAPTION_TOPMOST_SESSION_ALREADY_CLOSED');
    expect(f.mutations).toEqual([]);
  });
  it('原setup截止后的迟到apply不会修改窗口', async () => {
    const f = windowPort({ delayApply: true }), pending = f.call('apply');
    await Promise.resolve(); await Promise.resolve(); f.clock.now += 1001;
    f.clock.pending(); await expect(pending).rejects.toThrow('UI_CAPTION_SETUP_DEADLINE'); expect(f.mutations).toEqual([]);
  });
  it.each(['pid', 'window', 'root', 'renderer'])('真实Main/window/root身份变化%s拒绝输入前置顶', async field => {
    const f = windowPort();
    if (field === 'pid') f.processPort.pid++;
    if (field === 'window') f.window.id++;
    if (field === 'root') f.window.nativeRoot++;
    if (field === 'renderer') f.window.webContents.getOSProcessId = () => 999;
    await expect(f.call('apply')).rejects.toThrow(/UI_CAPTION_(RUNTIME_CHANGED|HELD_WINDOW_CHANGED)/); expect(f.mutations).toEqual([]);
  });
  it.each(['ownerToken', 'handleCreationTimeUtc'])('恢复拒绝已绑定heldMain字段%s变化', async field => {
    const f = windowPort(); await f.call('apply'); f.held[field] += '-changed';
    await expect(f.call('restore')).rejects.toThrow('UI_CAPTION_TOPMOST_SESSION_CHANGED');
    expect(f.mutations.filter(([event]) => event === 'topmost')).toHaveLength(1);
  });
  it('恢复setter异常保留原错误并先封闭令牌，不再允许activation', async () => {
    const original = new Error('UNIT_RESTORE_FAILED'), f = windowPort({ restoreFails: original }); await f.call('apply');
    await expect(f.call('restore')).rejects.toBe(original);
    await expect(f.call('apply')).rejects.toThrow('UI_CAPTION_TOPMOST_SESSION_ALREADY_CLOSED');
    expect(f.mutations.filter(([event]) => event === 'moveTop')).toHaveLength(1);
  });
});

function setupPort(options = {}) {
  const records = new Map(), logs = [], calls = [], writerRoot = path.join(root, 'unit-caption-artifacts');
  const record = (file, bytes) => ({ path: file, sha256: digest(bytes), sizeBytes: bytes.length });
  const put = (file, value) => { const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)); records.set(file, bytes); return record(file, bytes); };
  const writer = { root: writerRoot, log: (...args) => logs.push(args), write: (name, bytes) => put(path.join(writerRoot, name), bytes.toString()), json: (name, value) => put(path.join(writerRoot, name), value) };
  const held = { pid: 123, ownerToken: '11111111-1111-4111-8111-111111111111', handleAcquired: true, handleCreationTimeUtc: '2026-10-21T08:00:00.1234567Z' };
  const launch = { processBinding: { method: 'windows-shell' }, verification: { mainExitObserver: held }, packageIdentity: { unit: true } };
  const launchRef = put(path.join(writerRoot, 'native-launch.json'), launch), binding = { runToken: '22222222-2222-4222-8222-222222222222',
    main: { pid: 123, handleCreationTimeUtc: held.handleCreationTimeUtc, ownerToken: held.ownerToken }, window: { rootHwnd: '1000' } };
  const runtime = { launch: { receipt: launchRef }, identity: { pid: 123, executablePath: path.join(root, 'unit.exe'), appRoot: path.join(root, 'unit-app'), windows: [{ id: 7, rendererPid: 456 }] }, userDataDir: path.join(root, 'unit-profile') };
  const c = { assert, path, canonical: file => path.resolve(file).toLowerCase(), fs: { mkdirSync() {}, readFileSync: file => records.get(file).toString('utf8') },
    read: file => JSON.parse(records.get(file).toString('utf8')), record: file => fs.existsSync(file) ? record(file, fs.readFileSync(file)) : record(file, records.get(file)),
    validate: value => value, write: (file, value) => put(file, value), log: (_config, ...args) => logs.push(args) };
  const observed = { visible: true, rootHwnd: '1000', tokenClosed: false, alwaysOnTopBefore: false, alwaysOnTopAfter: true };
  const ports = {
    'node:crypto': { randomUUID: () => '33333333-3333-4333-8333-333333333333' }, 'node:path': path,
    './v16-ui-owned-caption-artifacts': { createCaptionArtifacts: () => c, captureShellIdentity: () => ({ unit: true }) },
    './v16-ui-owned-caption-contract': contract,
    './v16-ui-owned-caption-window': { topmost: async (_runtime, _expected, _held, _token, mode) => {
      calls.push(mode); if (options.topmost) return options.topmost(mode);
      if (mode === 'restore' && options.restoreFailure) throw options.restoreFailure;
      return mode === 'apply' ? observed : { ...observed, tokenClosed: true, alwaysOnTopAfter: false };
    } },
    './v16-ui-owned-caption-child': { runCaptionChild: async (_config, directory, request) => {
      calls.push('child'); if (options.nativeFailure) throw options.nativeFailure;
      const report = put(path.join(directory, 'native-report.json'), { kind: 'v16-owned-caption-activation', passed: true, request: c.read(request.path),
        result: { exactRoot: true, heldMainVerified: true, sendInputCalls: options.inputCalls ?? 1, inputSent: 3, inputReleased: true, releaseCleanupAttempted: false } });
      const stdout = put(path.join(directory, 'stdout.log'), JSON.stringify({ report: report.path, passed: true }) + '\n');
      return { spawnObserved: true, exitObserved: { code: 0, signal: null }, closeObserved: { code: 0, signal: null }, error: null, timedOut: false, report, stdout };
    } },
  };
  const api = load('v16-ui-owned-caption.js', ports);
  return { records, logs, calls, run: () => api.activateOwnedCaption({ runtime, writer, binding, nativeLaunch: launch, nativeLaunchRef: launchRef, root,
    protocol: contract.OWNED_CAPTION_PROTOCOL, trustedRuntime: { executable: { path: 'unit-system-shell' } }, sourceIdentity: { sourceSha256: 'a'.repeat(64) } }) };
}

describe('正式setup真实组合层首错与输入次数门', () => {
  it('唯一native child成功且正常恢复后才授setup通过', async () => {
    const f = setupPort(), proof = await f.run(); expect(proof.passed).toBe(true);
    expect(f.calls).toEqual(['apply', 'child', 'restore']); expect(proof.nodeTimingCredit).toBe(false); expect(proof.formalCredit).toBe(false);
  });
  it('native首错与恢复失败并存仍抛原错误，恢复失败另存且setup无通过信用', async () => {
    const first = new Error('UNIT_NATIVE_ORIGINAL'), secondary = new Error('UNIT_RESTORE_SECONDARY');
    const f = setupPort({ nativeFailure: first, restoreFailure: secondary }); await expect(f.run()).rejects.toBe(first);
    expect(f.calls).toEqual(['apply', 'child', 'restore']);
    expect(f.logs.some(([, error]) => error === first)).toBe(true); expect(f.logs.some(([, error]) => error === secondary)).toBe(true);
    const proof = [...f.records].find(([file]) => file.endsWith(path.join('caption', 'setup.json')));
    expect(JSON.parse(proof[1].toString('utf8')).topmostRestoration.errors).toEqual([expect.objectContaining({ message: secondary.message, cleanupOnly: true })]);
  });
  it('伪造两次输入报告被真实组合断言拒绝，仍只做恢复而不重试child', async () => {
    const f = setupPort({ inputCalls: 2 }); await expect(f.run()).rejects.toThrow();
    expect(f.calls).toEqual(['apply', 'child', 'restore']);
  });
});

async function flushCaptionObservation() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}
const captionOutcome = promise => promise.then(value => ({ value }), error => ({ error }));

describe('正式caption只读等待真实置顶与原截止', () => {
  it('getter短暂为false时只让出事件循环，后续真实true才通过且不重发setter', async () => {
    const f = windowPort({ deferApply: true }), outcome = captionOutcome(f.call('apply'));
    await flushCaptionObservation(); expect(f.clock.yieldCount()).toBe(1);
    f.clock.fireYield(); await flushCaptionObservation();
    expect(f.clock.yieldCount()).toBe(1); expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop']]);
    f.window.topmost = true; f.clock.fireYield();
    const result = await outcome; expect(result.error).toBeUndefined(); expect(result.value.alwaysOnTopAfter).toBe(true);
    expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop']]);
  });

  it('getter恒false到原30秒绝对截止必须失败，不重设预算或重发激活', async () => {
    const f = windowPort({ deferApply: true }), deadline = f.clock.now + contract.OWNED_CAPTION_PROTOCOL.setupMs;
    const outcome = captionOutcome(f.api.topmost(f.runtime, f.expected, f.held, 'unit-token', 'apply', deadline));
    await flushCaptionObservation(); f.clock.fireDeadline();
    expect((await outcome).error.message).toBe('UI_CAPTION_SETUP_DEADLINE'); expect(f.clock.now).toBe(deadline);
    f.clock.fireYield(); await flushCaptionObservation();
    expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop']]);
  });

  it('恢复先封闭令牌，真实getter延迟回原值才结束且只发一次恢复setter', async () => {
    const f = windowPort({ deferRestore: true }); await f.call('apply');
    const outcome = captionOutcome(f.call('restore')); await flushCaptionObservation();
    expect(f.window[Symbol.for('amazon-ai-ops.v16.caption-topmost.unit-token')].closed).toBe(true);
    expect(f.clock.yieldCount()).toBe(1); expect(f.window.topmost).toBe(true);
    f.window.topmost = false; f.clock.fireYield();
    const result = await outcome; expect(result.error).toBeUndefined(); expect(result.value.alwaysOnTopAfter).toBe(false);
    expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop'], ['topmost', false]]);
  });

  it('host超时先触发恢复后，迟到apply观察不得再次置顶show或move', async () => {
    const f = windowPort({ deferApply: true }), deadline = f.clock.now + contract.OWNED_CAPTION_PROTOCOL.setupMs;
    const outcome = captionOutcome(f.api.topmost(f.runtime, f.expected, f.held, 'unit-token', 'apply', deadline));
    await flushCaptionObservation(); f.clock.fireDeadline(); await outcome;
    const restored = await f.api.topmost(f.runtime, f.expected, f.held, 'unit-token', 'restore', f.clock.now + contract.OWNED_CAPTION_PROTOCOL.failureRestoreMs);
    expect(restored.tokenClosed).toBe(true); expect(restored.alwaysOnTopAfter).toBe(false);
    f.clock.fireYield(); await flushCaptionObservation();
    expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop'], ['topmost', false]]);
  });

  it.each(['pid', 'window', 'root', 'renderer', 'owner', 'birth', 'token', 'closed', 'original', 'replacement'])
  ('await后身份或令牌变化%s必须拒绝继续确认', async field => {
    const f = windowPort({ deferApply: true }), outcome = captionOutcome(f.call('apply'));
    await flushCaptionObservation();
    const state = f.window[Symbol.for('amazon-ai-ops.v16.caption-topmost.unit-token')];
    if (field === 'pid') f.processPort.pid++;
    if (field === 'window') f.window.id++;
    if (field === 'root') f.window.nativeRoot++;
    if (field === 'renderer') f.window.webContents.getOSProcessId = () => 999;
    if (field === 'owner') f.held.ownerToken += '-changed';
    if (field === 'birth') f.held.handleCreationTimeUtc += '-changed';
    if (field === 'token') state.token += '-changed';
    if (field === 'closed') state.closed = true;
    if (field === 'original') state.original = true;
    if (field === 'replacement') f.clock.windows = [{ ...f.window }];
    f.clock.fireYield();
    expect((await outcome).error.message).toMatch(/UI_CAPTION_(RUNTIME_CHANGED|HELD_WINDOW_CHANGED|TOPMOST_SESSION_CHANGED|TOPMOST_SESSION_ALREADY_CLOSED)/);
    expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop']]);
  });

  it.each(['replacement', 'reopened-token'])('恢复等待期间%s变化不授原值确认', async field => {
    const f = windowPort({ deferRestore: true }); await f.call('apply');
    const outcome = captionOutcome(f.call('restore')); await flushCaptionObservation();
    if (field === 'replacement') f.clock.windows = [{ ...f.window }];
    else f.window[Symbol.for('amazon-ai-ops.v16.caption-topmost.unit-token')].closed = false;
    f.clock.fireYield(); expect((await outcome).error.message).toMatch(/UI_CAPTION_(RUNTIME_CHANGED|TOPMOST_SESSION_CHANGED)/);
    expect(f.mutations.filter(([event]) => event === 'topmost')).toHaveLength(2);
  });

  it('恢复恒未到原值只用原5秒清理预算，截止后仍保持令牌封闭', async () => {
    const f = windowPort({ deferRestore: true }); await f.call('apply');
    const deadline = f.clock.now + contract.OWNED_CAPTION_PROTOCOL.failureRestoreMs;
    const outcome = captionOutcome(f.api.topmost(f.runtime, f.expected, f.held, 'unit-token', 'restore', deadline));
    await flushCaptionObservation(); f.clock.fireDeadline(); expect((await outcome).error.message).toMatch(/UI_CAPTION_.*DEADLINE$/);
    expect(f.clock.now).toBe(deadline); f.clock.fireYield(); await flushCaptionObservation();
    expect(f.window[Symbol.for('amazon-ai-ops.v16.caption-topmost.unit-token')].closed).toBe(true);
    expect(f.mutations.filter(([event]) => event === 'topmost')).toHaveLength(2);
  });
});

describe('正式caption显式popup层级与未知原层级拒绝', () => {
  it('原已置顶窗口在任何副作用前拒绝，恢复不得覆盖未知原level', async () => {
    const f = windowPort({ original: true });
    await expect(f.call('apply')).rejects.toThrow('UI_CAPTION_ORIGINAL_TOPMOST_UNSUPPORTED');
    expect(f.window[Symbol.for('amazon-ai-ops.v16.caption-topmost.unit-token')]).toBeUndefined();
    expect(f.window.topmost).toBe(true); expect(f.mutations).toEqual([]); expect(f.setterArguments).toEqual([]);
    const restored = await f.call('restore'); expect(restored.tokenClosed).toBe(true);
    expect(restored.alwaysOnTopBefore).toBeNull(); expect(f.window.topmost).toBe(true);
    expect(f.mutations).toEqual([]); expect(f.setterArguments).toEqual([]);
    await expect(f.call('apply')).rejects.toThrow('UI_CAPTION_TOPMOST_SESSION_ALREADY_CLOSED');
  });

  it('非topmost任务栏模型降floating而popup真实getter保持true，唯一setter绑定层级', async () => {
    const defaultLevel = windowPort({ taskbarNonTopmost: true });
    defaultLevel.window.setAlwaysOnTop(true); expect(defaultLevel.window.isAlwaysOnTop()).toBe(false);
    const f = windowPort({ taskbarNonTopmost: true }), outcome = captionOutcome(f.call('apply'));
    await flushCaptionObservation();
    expect(f.window.isAlwaysOnTop()).toBe(true); expect(f.clock.yieldCount()).toBe(0);
    const setup = (await outcome).value; expect(setup.alwaysOnTopBefore).toBe(false); expect(setup.alwaysOnTopAfter).toBe(true);
    expect(f.setterArguments).toEqual([[true, 'pop-up-menu']]);
    await f.call('restore'); expect(f.setterArguments).toEqual([[true, 'pop-up-menu'], [false]]);
    expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop'], ['topmost', false]]);
  });

  it.each([undefined, null, 1, 'false'])('原getter异常值%j必须在窗口副作用前拒绝', async original => {
    const f = windowPort(); f.window.isAlwaysOnTop = () => original;
    const outcome = captionOutcome(f.call('apply')); await flushCaptionObservation();
    expect(f.mutations).toEqual([]); expect(f.setterArguments).toEqual([]);
    expect((await outcome).error.message).toBe('UI_CAPTION_ORIGINAL_TOPMOST_UNSUPPORTED');
    await f.call('restore'); expect(f.mutations).toEqual([]); expect(f.setterArguments).toEqual([]);
  });

  it('恢复遇到被污染的originaltrue先封闭令牌并拒绝写未知层级', async () => {
    const f = windowPort(); await f.call('apply');
    const state = f.window[Symbol.for('amazon-ai-ops.v16.caption-topmost.unit-token')]; state.original = true;
    await expect(f.call('restore')).rejects.toThrow('UI_CAPTION_ORIGINAL_TOPMOST_UNSUPPORTED');
    expect(state.closed).toBe(true); expect(f.setterArguments).toEqual([[true, 'pop-up-menu']]);
    expect(f.mutations).toEqual([['topmost', true], ['show'], ['moveTop']]);
    await expect(f.call('apply')).rejects.toThrow('UI_CAPTION_TOPMOST_SESSION_ALREADY_CLOSED');
  });

  it('真实窗口职责getter首错与恢复setter失败并存仍抛首错且不调用native child', async () => {
    const first = new Error('UNIT_GETTER_ORIGINAL'), secondary = new Error('UNIT_RESTORE_SECONDARY');
    const windowModel = windowPort({ restoreFails: secondary }); let reads = 0;
    windowModel.window.isAlwaysOnTop = () => { if (++reads > 1) throw first; return false; };
    const f = setupPort({ topmost: mode => windowModel.call(mode) });
    await expect(f.run()).rejects.toBe(first); expect(f.calls).toEqual(['apply', 'restore']);
    expect(f.logs.some(([, error]) => error === first)).toBe(true); expect(f.logs.some(([, error]) => error === secondary)).toBe(true);
    expect(windowModel.window[Symbol.for('amazon-ai-ops.v16.caption-topmost.unit-token')].closed).toBe(true);
    expect(windowModel.setterArguments).toEqual([[true, 'pop-up-menu'], [false]]);
  });

  it('原true且恢复先到时迟到apply仍为封闭令牌拒绝，零setter或激活', async () => {
    const f = windowPort({ original: true, delayApply: true }), outcome = captionOutcome(f.call('apply'));
    await flushCaptionObservation(); expect(f.clock.pending).toBeTypeOf('function');
    const restored = await f.call('restore'); expect(restored.tokenClosed).toBe(true);
    f.clock.pending(); expect((await outcome).error.message).toBe('UI_CAPTION_TOPMOST_SESSION_ALREADY_CLOSED');
    expect(f.window.topmost).toBe(true); expect(f.setterArguments).toEqual([]); expect(f.mutations).toEqual([]);
  });
});
