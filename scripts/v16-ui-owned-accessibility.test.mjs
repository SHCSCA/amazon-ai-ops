import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
const require = createRequire(import.meta.url);
const protocol = { schemaVersion: 'v16.owned-app-accessibility/1', mode: 'native-tree-for-owned-reader', cleanupBoundary: 'owned-main-normal-exit',
  requiredFeatures: ['nativeAPIs', 'webContents', 'inlineTextBoxes', 'extendedProperties'] };
function model() {
  const f = { now: 1792483201000, enabled: false, features: ['nativeAPIs'], sets: [], logs: [], writes: [], timers: new Map(),
    mainCreation: 100, rendererCreation: 101, rendererPid: 456, windows: 1, rootHwnd: 1000n, appCalls: 0, getterCalls: 0, hold: false, pending: [] };
  const mainPath = path.resolve('unit-main.exe'), appRoot = path.resolve('unit-app'), profile = path.resolve('unit-profile');
  const window = { id: 1, isDestroyed: () => false, getNativeWindowHandle() {
    f.handleReads = (f.handleReads || 0) + 1;
    if (f.handleReads === f.expireOnHandleRead) f.now += 30000;
    const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(f.rootHwnd); return bytes;
  },
    webContents: { getOSProcessId: () => f.rendererPid, getURL: () => 'file:///unit-app/index.html' } };
  const app = { isPackaged: true, getAppPath: () => appRoot, getPath: () => profile,
    getAppMetrics: () => [{ pid: 123, creationTime: f.mainCreation }, { pid: f.rendererPid, creationTime: f.rendererCreation }],
    isAccessibilitySupportEnabled() { f.getterCalls++; if (f.readError) throw f.readError; return f.enabled; },
    getAccessibilitySupportFeatures: () => [...f.features],
    setAccessibilitySupportEnabled(value) { f.sets.push(value); if (f.setterError) throw f.setterError;
      f.enabled = !f.notEnabled; f.features = f.setterFeatures || ['nativeAPIs', 'webContents', 'inlineTextBoxes', 'extendedProperties']; } };
  let timer = 0, uuid = 0;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [f.now])); } static now() { return f.now; } }
  const context = vm.createContext({ module: { exports: {} }, Date: Clock, Buffer, process: { pid: 123, execPath: mainPath, stderr: { write() {} } },
    setTimeout(callback, ms) { const id = ++timer; f.timers.set(id, { callback, ms }); return id; }, clearTimeout: id => f.timers.delete(id),
    require(key) {
      if (key === 'node:crypto') return { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` };
      if (key === 'node:util') return { isDeepStrictEqual };
      if (key === './v16-performance-artifacts') return { insist(value, code) { if (!value) throw new Error(code); } };
      if (key.includes('runtime-log-format')) return { createRuntimeLogRecord: (level, event) => ({ level, event }) };
      throw new Error('UNIT_UNKNOWN_AX_DEPENDENCY:' + key);
    } });
  vm.runInContext(fs.readFileSync(path.resolve('scripts/v16-ui-owned-accessibility.js'), 'utf8'), context);
  const clone = vm.runInContext('(value) => JSON.parse(JSON.stringify(value))', context), api = context.module.exports;
  const binding = clone({ main: { pid: 123, executablePath: mainPath, userDataDir: profile, ownerToken: 'unit-owner', handleCreationTimeUtc: 'unit-birth' },
    renderer: { pid: 456, creationTime: 101 }, window: { id: 1, url: 'file:///unit-app/index.html', rootHwnd: '1000' },
    nativeLaunch: { path: 'unit-launch', sha256: 'a'.repeat(64), sizeBytes: 10 } });
  const nativeLaunch = clone({ identity: { appRoot, creationTime: 100 }, sourceIdentity: { sourceSha256: 'a'.repeat(64) },
    verification: { mainExitObserver: { pid: 123, ownerToken: 'unit-owner', handleCreationTimeUtc: 'unit-birth' } } });
  const runtime = { app: { evaluate(callback, request) {
    f.appCalls++;
    const invoke = () => callback({ app, BrowserWindow: { getAllWindows: () => f.windows === 1 ? [window] : [] } }, request);
    if (f.hold) return new Promise((resolve, reject) => f.pending.push(() => { try { resolve(invoke()); } catch (error) { reject(error); } }));
    return invoke();
  } } };
  const writer = { json(name, value) { if (f.writeError) throw f.writeError; f.writes.push({ name, value }); return { path: name, sha256: 'a'.repeat(64), sizeBytes: 10 }; },
    log(event, error) { f.logs.push({ event, error }); if (f.logError) throw f.logError; } };
  const options = { runtime, binding, nativeLaunch, deadline: f.now + 30000, writer };
  return Object.assign(f, { api, app, binding, nativeLaunch, runtime, writer, options, clone,
    setup: extra => api.setupOwnedAccessibility({ ...options, ...extra }),
    ready: (handle, extra) => api.observeOwnedAccessibility(handle, { runtime, binding, writer, ...extra }) });
}
describe('自有Main的固定AX setup协议', () => {
  it('原boolfalse但nativeAPIs存在时保存原状态，一次true且ready只读', async () => {
    const f = model(), handle = await f.setup(); await f.ready(handle);
    expect(f.sets).toEqual([true]); expect(f.getterCalls).toBe(3); expect(f.timers.size).toBe(0);
    const setup = f.writes[0].value;
    expect(setup.before).toEqual({ enabled: false, features: ['nativeAPIs'] });
    expect(setup.after.enabled).toBe(true); expect(setup.nativeFocusCredit).toBe(false);
    expect(setup.cleanupContract).toEqual({ boundary: 'owned-main-normal-exit', mainPid: 123,
      handleCreationTimeUtc: 'unit-birth', ownerToken: 'unit-owner', restoresExactFeatures: false, requiresNormalMainExit: true });
    expect(f.writes[1].value.setup).toBe(handle.receipt);
    expect(f.writes[1].value.before).toBeNull();
  });
  it('原enabledtrue也只调用一次true，不调用false恢复未知features', async () => {
    const f = model(); f.enabled = true; await f.ready(await f.setup()); expect(f.sets).toEqual([true]);
  });
  it('完整固定协议和来源/binding进入原件，不增加输入或系统flag端口', async () => {
    const f = model(); await f.setup(); const row = f.writes[0].value;
    expect(row.protocol).toEqual(protocol); expect(row.binding).toEqual(f.binding);
    expect(row.source).toBe('electron.app.setAccessibilitySupportEnabled');
    expect(row.sourceIdentity).toEqual(f.nativeLaunch.sourceIdentity); expect(row.formalCredit).toBe(false);
    expect(Object.isFrozen(f.api.OWNED_ACCESSIBILITY_PROTOCOL)).toBe(true);
  });
  it('caller协议跨await修改不改变固定原件和清理边界', async () => {
    const f = model(), caller = f.clone(protocol); f.hold = true;
    const operation = f.setup({ protocol: caller }); await Promise.resolve(); await Promise.resolve();
    caller.mode = 'foreign-mode'; caller.cleanupBoundary = 'foreign-boundary'; caller.requiredFeatures = [];
    f.pending.shift()(); await operation; const row = f.writes[0].value;
    expect(row.protocol).toEqual(protocol); expect(row.cleanupContract.boundary).toBe('owned-main-normal-exit');
    expect(row.protocol).toBe(f.api.OWNED_ACCESSIBILITY_PROTOCOL);
    expect(Object.isFrozen(row.protocol.requiredFeatures)).toBe(true); expect(f.sets).toEqual([true]);
    expect(f.api.OWNED_ACCESSIBILITY_PROTOCOL.requiredFeatures).toEqual(protocol.requiredFeatures);
  });
  it.each(['mode', 'cleanupBoundary', 'schemaVersion'])('%s未知值在任何Main调用前拒绝', async key => {
    const f = model(); await expect(f.setup({ protocol: f.clone({ ...protocol, [key]: 'foreign' }) })).rejects.toThrow('PROTOCOL_REQUIRED');
    expect(f.appCalls).toBe(0); expect(f.sets).toEqual([]);
  });
  it('额外配置键不能扩容协议', async () => {
    const f = model(); await expect(f.setup({ protocol: f.clone({ ...protocol, timeoutMs: 60000 }) })).rejects.toThrow('PROTOCOL_REQUIRED');
    expect(f.sets).toEqual([]);
  });
  it.each(['mainCreation', 'rendererCreation', 'rendererPid', 'rootHwnd', 'windows'])('%s变化在setter前拒绝', async key => {
    const f = model(); f[key] = key === 'rootHwnd' ? 2000n : 999;
    await expect(f.setup()).rejects.toThrow('OWNER_CHANGED'); expect(f.sets).toEqual([]);
  });
  it('held birth变化在Main调用前拒绝', async () => {
    const f = model(); f.nativeLaunch.verification.mainExitObserver.handleCreationTimeUtc = 'other-birth';
    await expect(f.setup()).rejects.toThrow('HELD_OWNER_REQUIRED'); expect(f.appCalls).toBe(0);
  });
  it('原截止已到时零setter和零app调用', async () => {
    const f = model(); f.now = f.options.deadline;
    await expect(f.setup()).rejects.toThrow('DEADLINE_EXCEEDED'); expect(f.sets).toEqual([]); expect(f.appCalls).toBe(0);
  });
  it('排队到Main时已过同一截止，不执行迟到setter', async () => {
    const f = model(); f.hold = true; const operation = f.setup(); await Promise.resolve(); await Promise.resolve();
    f.now = f.options.deadline; f.pending.shift()();
    await expect(operation).rejects.toThrow('DEADLINE_EXCEEDED'); expect(f.sets).toEqual([]); expect(f.timers.size).toBe(0);
  });
  it('host超时后晚到Main仍以原截止拒绝且不重试', async () => {
    const f = model(); f.hold = true; const operation = f.setup(); await Promise.resolve(); await Promise.resolve();
    f.now = f.options.deadline; [...f.timers.values()][0].callback();
    await expect(operation).rejects.toThrow('DEADLINE_EXCEEDED'); f.pending.shift()(); await Promise.resolve();
    expect(f.sets).toEqual([]); expect(f.appCalls).toBe(1); expect(f.timers.size).toBe(0);
  });
  it('最后一次identity同步getter跨原截止时setter仍零调用', async () => {
    const f = model(); f.expireOnHandleRead = 2;
    await expect(f.setup()).rejects.toThrow('DEADLINE_EXCEEDED');
    expect(f.handleReads).toBe(2); expect(f.sets).toEqual([]); expect(f.writes).toHaveLength(0);
  });
  it('同一Main重复setup不再次设置或授第二份原件', async () => {
    const f = model(); await f.setup(); await expect(f.setup()).rejects.toThrow('SESSION_EXISTS');
    expect(f.sets).toEqual([true]); expect(f.writes).toHaveLength(1);
  });
  it('伪造handle、替换runtime和换binding均不能读取或重新设置', async () => {
    const f = model(), handle = await f.setup(), calls = f.appCalls;
    await expect(f.ready({ receipt: handle.receipt })).rejects.toThrow('SESSION_REQUIRED');
    await expect(f.ready(handle, { runtime: {} })).rejects.toThrow('SESSION_REQUIRED');
    f.binding.main.ownerToken = 'foreign'; await expect(f.ready(handle)).rejects.toThrow('SESSION_REQUIRED');
    expect(f.appCalls).toBe(calls); expect(f.sets).toEqual([true]);
  });
  it('ready的STOP首错在任何新app读取前保留', async () => {
    const f = model(), handle = await f.setup(), error = new Error('UNIT_STOP'), calls = f.appCalls;
    await expect(f.ready(handle, { assertActive() { throw error; } })).rejects.toBe(error);
    expect(f.appCalls).toBe(calls); expect(f.sets).toEqual([true]);
  });
  it('ready时renderer变化仍拒绝，不重复setter', async () => {
    const f = model(), handle = await f.setup(); f.rendererPid = 999;
    await expect(f.ready(handle)).rejects.toThrow('OWNER_CHANGED'); expect(f.sets).toEqual([true]);
  });
  it('未知features在setter前拒绝且原日志不包含内容', async () => {
    const f = model(); f.features = ['PRIVATE']; await expect(f.setup()).rejects.toThrow('STATE_INVALID');
    expect(f.sets).toEqual([]); expect(JSON.stringify(f.logs)).not.toContain('PRIVATE');
  });
  it('setter未确认enabled时只授失败，不从features代取信用', async () => {
    const f = model(); f.notEnabled = true; await expect(f.setup()).rejects.toThrow('ENABLE_NOT_CONFIRMED');
    expect(f.writes).toHaveLength(0); expect(f.sets).toEqual([true]);
  });
  it('enabledtrue但setup缺webContents时不授AX setup信用', async () => {
    const f = model(); f.setterFeatures = ['nativeAPIs', 'inlineTextBoxes', 'extendedProperties'];
    await expect(f.setup()).rejects.toThrow('FEATURES_NOT_CONFIRMED'); expect(f.sets).toEqual([true]); expect(f.writes).toHaveLength(0);
  });
  it('ready丢失required feature时拒绝且不重新setter', async () => {
    const f = model(), handle = await f.setup(); f.features = ['nativeAPIs', 'inlineTextBoxes', 'extendedProperties'];
    await expect(f.ready(handle)).rejects.toThrow('FEATURES_NOT_CONFIRMED'); expect(f.sets).toEqual([true]); expect(f.writes).toHaveLength(1);
  });
  it.each(['readError', 'setterError', 'writeError'])('%s首错不被统一日志出口失败替换', async key => {
    const f = model(), error = new Error('UNIT_FIRST_ERROR'); f[key] = error; f.logError = new Error('UNIT_LOG_FAILED');
    await expect(f.setup()).rejects.toBe(error); expect(f.logs.at(-1).error).toBe(error); expect(f.timers.size).toBe(0);
  });
});
function readerFixture() {
  const acorn = require('acorn'), file = path.resolve('scripts/v16-nvda-reader-test-model.cjs'), text = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' });
  const node = ast.body.find(value => value.type === 'FunctionDeclaration' && value.id.name === 'readerModel');
  return vm.runInNewContext('(' + text.slice(node.start, node.end) + ')', { fs, path, vm, Buffer, Date, EventEmitter, createHash,
    isDeepStrictEqual, process, queueMicrotask, setTimeout, clearTimeout })();
}
describe('reader真实CJS接线与明确隔离AX端口', () => {
  it('launch只引用本次setup与ready原件，不把test端口当原生信用', async () => {
    const f = readerFixture(), reader = await f.open();
    try {
      const launch = f.launchReceipt(); expect(launch.accessibilitySupport?.setup.path).toContain('app-accessibility-setup.json');
      expect(launch.accessibilitySupport?.ready.path).toContain('app-accessibility-ready.json');
      expect(launch.accessibilitySupport?.cleanupBoundary).toBe('owned-main-normal-exit');
      expect(f.spawn.args).toContain('--no-sr-flag');
    } finally { await reader.close(); }
  });
  it('reader不接受宽化AX协议，且无NVDA spawn', async () => {
    const f = readerFixture(); let reader, error;
    try { reader = await f.api.openNvdaObserver({ executablePath: path.resolve('unit-reader/nvda.exe'), directory: f.directory,
      writer: f.writer, rendererPid: 456, runtime: f.runtime, storeContext: f.storeContext, timeoutMs: 30000,
      accessibilityProtocol: { ...protocol, mode: 'system-global' } }); } catch (caught) { error = caught; }
    finally { if (reader) await reader.close(); }
    expect(error?.message).toContain('FIXED_PROTOCOL_REQUIRED'); expect(f.spawn).toBeUndefined();
  });
});
