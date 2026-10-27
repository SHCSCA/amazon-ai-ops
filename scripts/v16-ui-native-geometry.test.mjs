import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { createNativeGeometryObserver } = require('./v16-ui-native-geometry');
const { createArtifactWriter } = require('./v16-performance-artifacts');
const { PACKAGE_UI_NATIVE_GEOMETRY_LIMITS: limits } = require('./package-ui-viewport-contract.cjs');
const epoch = 621355968000000000n;
function utc(ticks) {
  const seconds = ticks / 10000000n, fraction = (ticks % 10000000n).toString().padStart(7, '0');
  return new Date(Number(seconds * 1000n)).toISOString().slice(0, 19) + '.' + fraction + 'Z';
}
function harness({ kind = 'v16-nfr-native-launch', remainder = 0, mode = 'normal', mutateRaw, held = true } = {}) {
  const writer = createArtifactWriter(fs.mkdtempSync(path.join(os.tmpdir(), 'native-geometry-model-parent-')) + '/run');
  const logs = [], originalLog = writer.log; writer.log = (event, error, context) => { logs.push({ event, error }); originalLog(event, error, context); };
  const executablePath = 'G:\\isolated-geometry-model\\AmazonAIOpsAgent.exe';
  const mainBase = 1793025927000000n, rendererBase = 1793025927432405n;
  const mainTicks = mainBase * 10n + BigInt(remainder), rendererTicks = rendererBase * 10n + BigInt(remainder);
  const owner = { mainPid: 101, mainCreationTime: Number(mainBase) / 1000, windowId: 1,
    rendererPid: 202, rendererCreationTime: Number(rendererBase) / 1000, url: 'file:///isolated-geometry-model/index.html', electronVersion: '44.2.0' };
  const identity = { pid: 101, creationTime: owner.mainCreationTime, electronVersion: owner.electronVersion,
    executablePath, packaged: true, appRoot: 'G:\\isolated-geometry-model\\resources\\app', userDataDir: 'F:\\isolated-geometry-model-profile',
    windows: [{ id: 1, rendererPid: 202, creationTime: owner.rendererCreationTime, url: owner.url, visible: true,
      preferences: { contextIsolation: true, nodeIntegration: false } }] };
  const launch = { kind, schemaVersion: 1, identity, processBinding: { main: { pid: 101, executablePath } },
    verification: { mainExitObserver: held ? { pid: 101, executablePath, handleAcquired: true, handleCreationTimeUtc: utc(mainTicks),
      creationPrecision: 'cim-microsecond+handle-100ns' } : undefined } };
  const runtime = { app: {}, identity, launch: { receipt: writer.json('model-inputs/launch.json', launch) } };
  const main = { ...owner, hwnd: '4660', nativeHandleBytes: 8, bounds: { x: 1, y: 2, width: 1382, height: 835 },
    contentBounds: { x: 9, y: 61, width: 1366, height: 768 }, contentSize: { width: 1366, height: 768 },
    minimumSize: { width: 1200, height: 700 }, maximumSize: { width: 0, height: 0 }, zoomFactor: 1,
    maximized: false, minimized: false, fullScreen: false, visible: true, resizable: true, menuBarVisible: true, menuBarAutoHide: false,
    display: { id: 9, scaleFactor: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    forceDeviceScaleFactor: '', chromiumFeatureSwitches: { enabled: '', disabled: '' },
    renderer: { url: owner.url, innerWidth: 1366, innerHeight: 768, devicePixelRatio: 1 },
    appMetrics: [{ pid: 101, type: 'Browser', creationTime: owner.mainCreationTime }, { pid: 202, type: 'Tab', creationTime: owner.rendererCreationTime }],
    observedAt: new Date().toISOString() };
  let timer, spawnCount = 0, reads = 0; const completions = [], calls = [];
  const dependencies = { resolveTrustedWindowsPowerShell: () => ({ realPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }),
    minimalWindowsRuntimeEnvironment: () => ({ SYSTEMROOT: 'C:\\Windows' }),
    readMotionMain: async () => ({ ...structuredClone(main), ...(mode === 'main-drift' && ++reads > 1 ? { hwnd: '999' } : {}), observedAt: new Date().toISOString() }),
    setTimeout(callback, milliseconds) { expect(milliseconds).toBe(limits.helperTimeoutMs); timer = callback; return 1; }, clearTimeout() {},
    spawn(executable, args, options) {
      spawnCount++; calls.push({ executable, args, options }); const child = new EventEmitter();
      child.pid = 3030 + spawnCount; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      const arg = key => args[args.indexOf('-' + key) + 1];
      const processOwner = { pid: 101, creationTimeUtcTicks: (mainTicks + epoch).toString(), creationTimeUtc: utc(mainTicks),
        executablePath, hwnd: '4660', windowPid: 101, windowThreadId: 88 };
      const renderer = { pid: 202, creationTimeUtcTicks: (rendererTicks + epoch).toString(), creationTimeUtc: utc(rendererTicks), executablePath };
      const primary = { hwnd: '4660', observedAt: new Date().toISOString() };
      const raw = { schemaVersion: 'v16.native-physical-geometry/2', passed: true, diagnosticOnly: true, formalCredit: false,
        limits: { ...limits }, ownerRequest: { mainPid: 101, mainCreationTimeUtcTicks: arg('MainCreationTimeUtcTicks'),
          mainExecutablePath: arg('MainExecutablePath'), hwnd: arg('Hwnd'), requestNonce: arg('RequestNonce'), expectedRendererPid: 202 },
        ownerBefore: { ...processOwner }, ownerAfter: { ...processOwner }, rendererBefore: { ...renderer }, rendererAfter: { ...renderer },
        contextRestore: { confirmed: true }, native: { pmv2Verified: true, primaryBefore: primary, primaryAfter: { ...primary },
          children: [{ hwnd: '55', ownerAdmission: 'ADMITTED_MAIN', complete: true, isVisibleRenderWidgetCandidate: true }],
          childInventoryVerdict: { rawChildCount: 1, visibleRenderWidgetCandidateCount: 1, visibleRenderWidgetCandidateHwnds: ['55'],
            selectedWidgetHwnd: '55', selectedWidgetOwnerAdmission: 'ADMITTED_MAIN', completed: true, accepted: true } } };
      mutateRaw?.(raw);
      const complete = () => {
        child.emit('spawn');
        if (mode === 'timeout') timer();
        if (mode === 'stream-error') child.stdout.emit('error', new Error('MODEL_STREAM_ERROR'));
        const bytes = mode === 'malformed' ? Buffer.from('not-json') : mode === 'limit' ? Buffer.alloc(limits.maxOutputBytes + 1) : Buffer.from(JSON.stringify(raw));
        const middle = Math.floor(bytes.length / 2); child.stdout.emit('data', bytes.subarray(0, middle)); child.stdout.emit('data', bytes.subarray(middle));
        child.emit('exit', mode === 'nonzero' ? 1 : 0, null); child.emit('close', mode === 'nonzero' ? 1 : 0, null);
      };
      if (mode === 'held') completions.push(complete); else queueMicrotask(complete);
      return child;
    } };
  return { writer, runtime, owner, main, dependencies, calls, logs, completions, get spawnCount() { return spawnCount; } };
}
describe('原生几何 observer 的所属、预算与原始原件', () => {
  test.each(['v16-package-ui-native-launch', 'v16-nfr-native-launch'])('%s 均读取同一持有 Main handle；不依赖 runtime.writer', async kind => {
    const x = harness({ kind }); expect(x.runtime.writer).toBeUndefined();
    const value = await createNativeGeometryObserver(x.runtime, x.writer, { dependencies: x.dependencies }).snapshot(x.owner, 'model/native');
    expect(value.beforeMain.forceDeviceScaleFactor).toBe(''); expect(value.afterMain.forceDeviceScaleFactor).toBe('');
    expect(value.invocation.events.map(event => event.event)).toEqual(['spawn', 'exit', 'close']);
    expect(value.invocation.error).toBeNull(); expect(value.invocation.timedOut).toBe(false);
    expect(JSON.parse(fs.readFileSync(value.invocation.stdout.path, 'utf8'))).toEqual(value.native);
    expect(x.calls[0].options.shell).toBe(false); expect(x.calls[0].options.windowsHide).toBe(true);
    for (const [name, amount] of Object.entries({ HelperTimeoutMs: limits.helperTimeoutMs, WmQueryTimeoutMs: limits.wmQueryTimeoutMs,
      MaxOutputBytes: limits.maxOutputBytes, MaxChildren: limits.maxChildren })) {
      const args = x.calls[0].args; expect(args[args.indexOf('-' + name) + 1]).toBe(String(amount));
    }
  });
  test.each(Array.from({ length: 10 }, (_, index) => index))('FILETIME 尾数 %i 保持 Main 原 100ns，并按来源截断 Renderer 微秒', async remainder => {
    const x = harness({ remainder }), value = await createNativeGeometryObserver(x.runtime, x.writer, { dependencies: x.dependencies }).snapshot(x.owner, 'model/remainder');
    expect(BigInt(value.native.ownerBefore.creationTimeUtcTicks) % 10n).toBe(BigInt(remainder));
    expect(BigInt(value.native.rendererBefore.creationTimeUtcTicks) % 10n).toBe(BigInt(remainder));
  });
  test('没有持有 Main handle 时不以 CIM 或模拟时刻补证', () => {
    const x = harness({ held: false }); expect(() => createNativeGeometryObserver(x.runtime, x.writer, { dependencies: x.dependencies })).toThrow('UI_NATIVE_GEOMETRY_TRUSTED_MAIN_HANDLE_REQUIRED');
    expect(x.spawnCount).toBe(0);
  });
  test('非原生 launch kind 在任何 helper 启动前拒绝', () => {
    const x = harness({ kind: 'invented' }); expect(() => createNativeGeometryObserver(x.runtime, x.writer, { dependencies: x.dependencies })).toThrow('UI_NATIVE_GEOMETRY_NATIVE_LAUNCH_REQUIRED');
    expect(x.spawnCount).toBe(0);
  });
  test('期望所属与当前 runtime 不符时不启动 helper', async () => {
    const x = harness(), observer = createNativeGeometryObserver(x.runtime, x.writer, { dependencies: x.dependencies });
    await expect(observer.snapshot({ ...x.owner, rendererPid: 999 }, 'model/owner')).rejects.toThrow('UI_NATIVE_GEOMETRY_OWNER_CHANGED'); expect(x.spawnCount).toBe(0);
  });
  test.each([
    ['nonce', raw => { raw.ownerRequest.requestNonce = 'other'; }],
    ['Main PID', raw => { raw.ownerBefore.pid = 999; raw.ownerAfter.pid = 999; }],
    ['Main 出生', raw => { raw.ownerBefore.creationTimeUtcTicks = '1'; raw.ownerAfter.creationTimeUtcTicks = '1'; }],
    ['Renderer 出生增加一微秒', raw => { raw.rendererBefore.creationTimeUtcTicks = String(BigInt(raw.rendererBefore.creationTimeUtcTicks) + 10n); raw.rendererAfter = { ...raw.rendererBefore }; }],
    ['Renderer 出生减少一微秒', raw => { raw.rendererBefore.creationTimeUtcTicks = String(BigInt(raw.rendererBefore.creationTimeUtcTicks) - 10n); raw.rendererAfter = { ...raw.rendererBefore }; }],
    ['PMv2 恢复', raw => { raw.contextRestore.confirmed = false; }],
    ['前后原生几何', raw => { raw.native.primaryAfter.hwnd = '999'; }],
    ['自由扩大限额', raw => { raw.limits.helperTimeoutMs++; }],
    ['未知 widget', raw => { raw.native.children[0].ownerAdmission = 'UNADMITTED'; }],
    ['两个可见 widget', raw => { raw.native.children.push({ ...raw.native.children[0], hwnd: '66' }); raw.native.childInventoryVerdict.rawChildCount = 2; }],
    ['不完整库存', raw => { raw.native.childInventoryVerdict.completed = false; }]
  ])('%s 异常拒绝且保留真实 stdout 与 invocation', async (_label, mutateRaw) => {
    const x = harness({ mutateRaw });
    await expect(createNativeGeometryObserver(x.runtime, x.writer, { dependencies: x.dependencies }).snapshot(x.owner, 'model/reject')).rejects.toThrow();
    expect(x.writer.artifacts().some(row => row.path.endsWith('stdout.log'))).toBe(true); expect(x.logs.at(-1).error).toBeInstanceOf(Error);
  });
  test.each(['timeout', 'stream-error', 'limit', 'nonzero', 'malformed', 'main-drift'])('%s 不因晚到正常 helper 结果转绿', async mode => {
    const x = harness({ mode });
    await expect(createNativeGeometryObserver(x.runtime, x.writer, { dependencies: x.dependencies }).snapshot(x.owner, 'model/fail')).rejects.toThrow();
    const invocation = x.writer.artifacts().find(row => row.path.endsWith('invocation.json'));
    expect(invocation).toBeDefined();
    const receipt = JSON.parse(fs.readFileSync(invocation.path, 'utf8')); expect(receipt.events.at(-1).event).toBe('close');
    if (mode === 'timeout') { expect(receipt.timedOut).toBe(true); expect(receipt.recoveryFinished.remainsFailed).toBe(true); }
    if (mode === 'limit') expect(fs.statSync(receipt.stdout.path).size).toBeLessThanOrEqual(limits.maxOutputBytes);
  });
  test('并发拒绝不能解锁仍未完成的第一份实际观测', async () => {
    const x = harness({ mode: 'held' }), observer = createNativeGeometryObserver(x.runtime, x.writer, { dependencies: x.dependencies });
    const first = observer.snapshot(x.owner, 'model/first'); await new Promise(resolve => setImmediate(resolve));
    await expect(observer.snapshot(x.owner, 'model/second')).rejects.toThrow('UI_NATIVE_GEOMETRY_SNAPSHOT_ALREADY_RUNNING');
    await expect(observer.snapshot(x.owner, 'model/third')).rejects.toThrow('UI_NATIVE_GEOMETRY_SNAPSHOT_ALREADY_RUNNING');
    expect(x.spawnCount).toBe(1); x.completions[0](); await first;
  });
});

