import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { StoreScopeSwitcher } from '../apps/desktop/src/renderer/components/store-scope-switcher';
import { BROWSER_LIFECYCLE_BUDGET, ownBrowserServer } from './v16-performance-observe.test-support.mjs';

const require = createRequire(import.meta.url);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const desktopRequire = createRequire(path.join(projectRoot, 'apps/desktop/package.json'));
const { createElement } = desktopRequire('react');
const { renderToStaticMarkup } = desktopRequire('react-dom/server');
const { chromium } = require('./playwright-loader.js');
const artifacts = require('./v16-performance-artifacts');
const { waitForBoundedElectronClose } = require('./package-ui-arguments')({ path });
const runtimePath = fileURLToPath(new URL('./v16-performance-runtime.js', import.meta.url));
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const triggerSelector = 'section[aria-label="店铺与站点"] .store-scope-switcher__trigger';
const operationTimeoutMs = 1_000;
const store = {
  storeId: 'unit-only-store', browserProfileId: 'unit-only-profile', displayName: '隔离软件店铺',
  marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', status: 'active',
  createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
};
let browser, ownedBrowser;
const pages = [], directories = [];

beforeAll(async () => {
  const server = await chromium.launchServer({ headless: true, timeout: BROWSER_LIFECYCLE_BUDGET.launchMs });
  ownedBrowser = ownBrowserServer(server);
  browser = await chromium.connect(server.wsEndpoint(), { timeout: BROWSER_LIFECYCLE_BUDGET.connectMs });
}, BROWSER_LIFECYCLE_BUDGET.setupHookMs);
afterEach(async () => {
  try { await Promise.all(pages.splice(0).map(page => page.close())); }
  finally { for (const directory of directories.splice(0)) cleanupUnitRoot(directory); }
});
afterAll(async () => { await ownedBrowser?.close(); }, BROWSER_LIFECYCLE_BUDGET.teardownHookMs);

function cleanupUnitRoot(directory) {
  const resolved = path.resolve(directory), temporary = path.resolve(os.tmpdir());
  const real = path.resolve(fs.realpathSync.native(resolved));
  if (!path.isAbsolute(directory) || path.dirname(resolved).toLowerCase() !== temporary.toLowerCase()
    || !path.basename(resolved).startsWith('nfr-runtime-unit-') || real.toLowerCase() !== resolved.toLowerCase()
    || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('UNIT_RUNTIME_CLEANUP_PATH_REJECTED');
  fs.rmSync(resolved, { recursive: true, force: true });
}

function switcherHtml(collapsed = false) {
  return renderToStaticMarkup(createElement(StoreScopeSwitcher, {
    stores: [store], activeStore: store, phase: 'ready', collapsed,
    onRetry: () => undefined, onSwitch: () => undefined, onCreate: () => store,
  }));
}

function isolatedCjs(file, source, mocks, nativeProcess) {
  // 原样执行当前 CJS 字节；局部 require 不修改全局缓存，也不启动原生应用或数据库。
  const module = { exports: {} };
  const localRequire = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('node:') || ['./v16-performance-artifacts', './v16-performance-memory'].includes(name)) return require(name);
    throw new Error('UNIT_UNEXPECTED_RUNTIME_DEPENDENCY:' + name);
  };
  const wrapper = runInNewContext('(function (exports, require, module, __filename, __dirname) {\n' + source + '\n})',
    { process: nativeProcess, Buffer }, { filename: file });
  wrapper(module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}

function isolatedRuntime(mocks, nativeProcess) {
  return isolatedCjs(runtimePath, runtimeSource, mocks, nativeProcess);
}

async function fixture(options = {}) {
  const page = await browser.newPage(); pages.push(page);
  const markup = switcherHtml(options.collapsed);
  const content = options.hidden ? '<div style="display:none">' + markup + '</div>' : markup;
  // 清理用例增加独立旧名称按钮，只为使旧入口走到原本失败的关闭语句。
  await page.setContent(content + (options.duplicate ? markup : '')
    + (options.legacyReadiness ? '<button type="button">店铺与站点</button>' : ''));
  const trigger = page.locator(triggerSelector), locatorCalls = [];
  const locate = page.locator.bind(page);
  vi.spyOn(page, 'locator').mockImplementation((selector, settings) => {
    const locator = locate(selector, settings), wait = vi.spyOn(locator, 'waitFor');
    locatorCalls.push({ selector, settings, wait });
    return locator;
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nfr-runtime-unit-')); directories.push(root);
  const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const markerPath = path.join(profile, 'evidence-user-data-runtime.json');
  const windowMarkerPath = path.join(profile, 'package-launch-window-ready.json');
  const writer = artifacts.createArtifactWriter(path.join(root, 'unit-output'));
  if (options.writerLogError) vi.spyOn(writer, 'log').mockImplementation(() => { throw options.writerLogError; });
  if (options.launchReceiptError) {
    const json = writer.json.bind(writer);
    vi.spyOn(writer, 'json').mockImplementation((name, value) => {
      if (name.endsWith('/launch.json')) throw options.launchReceiptError;
      return json(name, value);
    });
  }
  const label = 'unit-only-runtime', lock = path.join(profile, 'v16-nfr-collector.lock');
  const current = { executablePath: path.join(root, 'unit-package/AmazonAIOpsAgent.exe'),
    appRoot: path.join(root, 'unit-package/resources/app'), packageIdentity: { unitOnly: true } };
  const child = new ChildProcess(); child.pid = 10_001;
  const collectorPid = 9_000, mainPid = options.shell ? 10_003 : child.pid;
  if (options.shell) child.spawnfile = options.shellPath ?? 'C:\\Windows\\System32\\cmd.exe';
  const nativeProcess = { platform: 'win32', pid: collectorPid, execPath: current.executablePath,
    versions: { electron: 'unit-only' }, stderr: { write: vi.fn() }, env: { SystemRoot: 'C:\\Windows', NODE_ENV: 'development', ELECTRON_RUN_AS_NODE: '1' }, cwd: () => projectRoot };
  const mainProcess = { ...nativeProcess, pid: mainPid };
  let disposed = false, launchedAtMs, mainCreationTime, mainCreationTimeUtc, launcherCreationTimeUtc, runtimeMarkerGeneratedAt;
  const watcherEvents = [];
  const previousMarker = { mode: 'package-launch-smoke', overridden: true, userDataDir: profile,
    generatedAt: new Date(Date.now() - 10_000).toISOString(), pid: mainPid };
  if (options.previousMarker) fs.writeFileSync(markerPath, JSON.stringify(previousMarker));
  if (options.previousWindowMarker) fs.writeFileSync(windowMarkerPath, JSON.stringify({ ...previousMarker, kind: 'package-launch-window-ready' }));
  const app = {
    process: vi.fn(() => {
      if (disposed) throw new TypeError('Cannot read properties of undefined (reading "_object")');
      return child;
    }),
    firstWindow: vi.fn(async () => page),
    evaluate: vi.fn(async callback => {
      if (options.evaluateError) throw options.evaluateError;
      const electron = {
        app: { isPackaged: true, getAppPath: () => current.appRoot, getPath: () => profile,
          getAppMetrics: () => [{ pid: mainPid, creationTime: options.shell ? mainCreationTime : 1_000 }, { pid: 10_002, creationTime: 1_001 }] },
        BrowserWindow: { getAllWindows: () => [{ id: 1, isDestroyed: () => false, isVisible: () => true,
          webContents: { getURL: () => pathToFileURL(path.join(current.appRoot, 'dist/renderer/index.html')).href,
            getOSProcessId: () => 10_002, getLastWebPreferences: () => ({ contextIsolation: true, nodeIntegration: false }) } }] },
      };
      // Electron 本来会序列化回调到 Main；隔离测试也为该回调提供独立 Main 进程上下文。
      const value = runInNewContext('(' + callback.toString() + ')(electron)', { process: mainProcess, electron });
      options.changeIdentity?.(value);
      return value;
    }),
    close: vi.fn(async () => {
      disposed = true;
      child.exitCode = options.exitCode === undefined ? 0 : options.exitCode;
      child.signalCode = options.signalCode ?? null;
      options.onClose?.({ lock, child });
      if (options.closeError) throw options.closeError;
    }),
  };
  const admitNativeProfile = vi.fn(async input => {
    expect(fs.existsSync(lock)).toBe(true);
    expect(input).toMatchObject({ root: projectRoot, profile, label, writer });
    if (options.admissionError) throw options.admissionError;
  });
  const launch = vi.fn(async () => {
    launchedAtMs = Date.now();
    launcherCreationTimeUtc = new Date(launchedAtMs).toISOString().replace('Z', '0000Z');
    mainCreationTimeUtc = new Date(launchedAtMs).toISOString().replace('Z', '7720Z');
    mainCreationTime = launchedAtMs + 0.772;
    if (options.shell && !options.keepPreviousMarker) {
      const marker = { mode: 'package-launch-smoke', overridden: true, userDataDir: profile,
        generatedAt: new Date().toISOString(), pid: mainPid };
      runtimeMarkerGeneratedAt = marker.generatedAt;
      options.changeMarker?.(marker);
      if (!options.missingMarker) fs.writeFileSync(markerPath, JSON.stringify(marker));
    }
    if (options.shell && !options.keepPreviousWindowMarker) {
      const windowMarker = { kind: 'package-launch-window-ready', schemaVersion: 1, pid: mainPid, browserWindowId: 1,
        evidenceMode: 'package-launch-smoke', userDataDir: profile,
        rendererUrl: pathToFileURL(path.join(current.appRoot, 'dist/renderer/index.html')).href, generatedAt: new Date().toISOString() };
      options.changeWindowMarker?.(windowMarker, { runtimeMarkerGeneratedAt });
      if (!options.missingWindowMarker) fs.writeFileSync(windowMarkerPath, JSON.stringify(windowMarker));
    }
    return app;
  });
  const boundedClose = vi.fn((target, timeoutMs) => waitForBoundedElectronClose(target, timeoutMs));
  const validateProfile = vi.fn(value => { expect(value).toBe(profile); return value; });
  const buildEnv = vi.fn((env, mode, userDataDir) => ({ ...env, UNIT_EVIDENCE_MODE: mode, UNIT_PROFILE: userDataDir }));
  const nativeProbe = vi.fn((_executable, args, settings) => {
    expect(settings.shell).toBe(false);
    expect(settings.timeout).toBeGreaterThan(0); expect(settings.timeout).toBeLessThanOrEqual(operationTimeoutMs);
    const script = args[args.indexOf('-Command') + 1];
    const ids = [...script.matchAll(/ProcessId=(\d+)/g)].map(match => Number(match[1]));
    const rows = [
      { pid: child.pid, parentPid: collectorPid, executablePath: child.spawnfile, creationTimeUtc: launcherCreationTimeUtc },
      { pid: mainPid, parentPid: child.pid, executablePath: current.executablePath, creationTimeUtc: mainCreationTimeUtc },
    ].filter(row => ids.includes(row.pid));
    options.changeSnapshot?.(rows, nativeProbe.mock.calls.length);
    if (options.queryFailure) return { status: 1, signal: null, stdout: '', stderr: 'UNIT_CIM_FAILED' };
    return { status: 0, signal: null, stdout: JSON.stringify(rows), stderr: '' };
  });
  const watcher = {
    ready: null,
    observeExit: vi.fn(async timeoutMs => {
      expect(timeoutMs).toBe(operationTimeoutMs); watcherEvents.push('observe-exit');
      expect(disposed).toBe(true);
      if (options.completeLauncherOnObserve) { child.exitCode = 0; child.signalCode = null; }
      if (options.mainExitError) throw options.mainExitError;
      return { pid: mainPid, parentPid: child.pid, executablePath: current.executablePath,
        creationTimeUtc: mainCreationTimeUtc, handleCreationTimeUtc: mainCreationTimeUtc,
        creationPrecision: 'cim-microsecond+handle-100ns', exited: true,
        exitCode: options.mainExitCode ?? 0, signalCode: options.mainExitSignal ?? null, observedAt: new Date().toISOString() };
    }),
    dispose: vi.fn(async timeoutMs => {
      expect(timeoutMs).toBe(operationTimeoutMs); watcherEvents.push('dispose');
      if (options.watcherDisposeError) throw options.watcherDisposeError;
    }),
  };
  const openMainExitWatcher = vi.fn(async ({ main, timeoutMs }) => {
    expect(timeoutMs).toBe(operationTimeoutMs);
    expect(main).toMatchObject({ pid: mainPid, parentPid: child.pid, executablePath: current.executablePath, creationTimeUtc: mainCreationTimeUtc });
    if (options.watcherOpenError) throw options.watcherOpenError;
    watcher.ready = { ...main, watcherPid: 11_001, handleAcquired: true, handleCreationTimeUtc: mainCreationTimeUtc,
      creationPrecision: 'cim-microsecond+handle-100ns' };
    watcherEvents.push('ready'); return watcher;
  });
  const evidenceMock = { validateEvidenceUserDataPath: validateProfile, buildEvidenceUserDataEnv: buildEnv,
    PACKAGE_LAUNCH_SMOKE_MODE: 'package-launch-smoke', EVIDENCE_USER_DATA_RUNTIME_MARKER: 'evidence-user-data-runtime.json',
    validateEvidenceUserDataIdentity: value => ({ passed: value.actualUserDataDir === profile
      && value.expectedUserDataDir === profile && value.evidenceMode === 'package-launch-smoke' }) };
  const mocks = {
    './evidence-user-data': evidenceMock,
    './v16-performance-admission': { admitNativeProfile },
    './playwright-loader': { _electron: { launch } },
    './package-ui-evidence': { waitForBoundedElectronClose: boundedClose },
    './v16-performance-main-exit': { openMainExitWatcher },
    '../packages/shared-types/src/runtime-log-format.cjs': require('../packages/shared-types/src/runtime-log-format.cjs'),
  };
  Object.defineProperty(mocks, './v16-performance-process-binding', { get() {
    // 旧生产不加载新模块，RED 必须来自原 PID 门，不能来自尚未应用的模块缺失。
    const file = path.join(path.dirname(runtimePath), 'v16-performance-process-binding.js');
    return isolatedCjs(file, fs.readFileSync(file, 'utf8'), {
      './evidence-user-data': evidenceMock,
      'node:child_process': { spawnSync: nativeProbe },
      './package-launch-processes': require('./package-launch-processes'),
      './package-launch-contracts': require('./package-launch-contracts'),
      './package-launch-validation': require('./package-launch-validation'),
      './s7-launch-operator-security': {
        minimalWindowsRuntimeEnvironment: () => ({ SYSTEMROOT: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }),
        resolveTrustedWindowsPowerShell: () => ({ realPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', unitOnly: true }),
      },
    }, nativeProcess);
  } });
  const runtime = isolatedRuntime(mocks, nativeProcess);
  const input = { current, fixture: { fixture: 'typical', classification: 'isolated-software-fixture' },
    profile, writer, label, timeoutMs: operationTimeoutMs, root: projectRoot };
  const logs = () => {
    const file = path.join(writer.root, 'collector.jsonl');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  };
  const cleanup = () => JSON.parse(fs.readFileSync(path.join(writer.root, label, 'cleanup.json'), 'utf8'));
  const launchRecord = () => JSON.parse(fs.readFileSync(path.join(writer.root, label, 'launch.json'), 'utf8'));
  return { page, trigger, root, profile, writer, label, lock, markerPath, windowMarkerPath, current, child, app, launch, admitNativeProfile,
    boundedClose, locatorCalls, validateProfile, buildEnv, input, logs, cleanup, launchRecord, mainPid, collectorPid,
    nativeProbe, watcher, openMainExitWatcher, watcherEvents, nativeStderr: nativeProcess.stderr.write, open: () => runtime.openNativeRuntime(input) };
}

async function openForCleanup(options = {}) {
  const f = await fixture({ legacyReadiness: true, ...options });
  return { ...f, runtime: await f.open() };
}

describe('原生采集器真实店铺按钮与关闭后进程引用', () => {
  it.each([['展开', false], ['折叠', true]])('%s模式使用当前生产按钮DOM并保持visible等待原预算', async (_label, collapsed) => {
    const f = await fixture({ collapsed });
    expect(await f.page.getByRole('button', { name: '店铺与站点', exact: true }).count()).toBe(0);
    expect(await f.trigger.count()).toBe(1);
    expect(await f.trigger.textContent()).toContain('Amazon US · USD');
    if (collapsed) expect(await f.trigger.getAttribute('aria-label')).toContain('店铺与站点：隔离软件店铺');
    const runtime = await f.open();
    expect(f.locatorCalls).toHaveLength(1);
    expect(f.locatorCalls[0].selector).toBe(triggerSelector);
    expect(f.locatorCalls[0].wait).toHaveBeenCalledWith({ state: 'visible', timeout: operationTimeoutMs });
    expect(f.app.firstWindow).toHaveBeenCalledWith({ timeout: operationTimeoutMs });
    expect(f.launch.mock.calls[0][0]).toMatchObject({ executablePath: f.current.executablePath,
      args: [], timeout: operationTimeoutMs, env: { NODE_ENV: 'production' } });
    expect(f.launch.mock.calls[0][0].env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(f.admitNativeProfile.mock.invocationCallOrder[0]).toBeLessThan(f.launch.mock.invocationCallOrder[0]);
    expect(f.validateProfile).toHaveBeenCalledOnce();
    expect(f.buildEnv).toHaveBeenCalledWith(expect.any(Object), 'package-launch-smoke', f.profile);
    expect(runtime.page.nfrOperationTimeoutMs).toBe(operationTimeoutMs);
    await runtime.close();
  });

  it('重复section内trigger保持严格单一匹配并记录原始定位失败', async () => {
    const f = await fixture({ duplicate: true });
    await expect(f.open()).rejects.toThrow(/strict mode violation/);
    expect(f.app.evaluate).not.toHaveBeenCalled();
    expect(f.logs().map(row => row.event)).toContain('v16.nfr_launch_failed');
    expect(f.logs().map(row => row.event)).not.toContain('v16.nfr_launch_cleanup_failed');
    expect(fs.existsSync(f.lock)).toBe(false);
  });

  it('隐藏的生产trigger仍按原预算拒绝就绪', async () => {
    const f = await fixture({ hidden: true });
    await expect(f.open()).rejects.toThrow(/Timeout/);
    expect(f.locatorCalls[0].wait).toHaveBeenCalledWith({ state: 'visible', timeout: operationTimeoutMs });
    expect(f.app.evaluate).not.toHaveBeenCalled();
    expect(fs.existsSync(f.lock)).toBe(false);
  });

  it('成功关闭后getter失效仍由缓存原ChildProcess核对退出并幂等释放自有锁', async () => {
    const f = await openForCleanup();
    expect(f.child).toBeInstanceOf(ChildProcess);
    expect(f.app.process).toHaveBeenCalledOnce();
    await f.runtime.close();
    expect(f.app.process).toHaveBeenCalledOnce();
    expect(() => f.app.process()).toThrow(/_object/);
    expect(f.cleanup()).toMatchObject({ pid: f.child.pid, exited: true, closed: true, exitCode: 0, signalCode: null, rendererErrors: [] });
    expect(f.boundedClose).toHaveBeenCalledWith(expect.any(Object), operationTimeoutMs);
    expect(fs.existsSync(f.lock)).toBe(false);
    await f.runtime.close();
    expect(f.app.close).toHaveBeenCalledOnce();
  });

  it('首屏后launch失败保留原异常且在getter失效后清理缓存子进程的锁', async () => {
    const failure = new Error('UNIT_MAIN_IDENTITY_READ_FAILED');
    const f = await fixture({ legacyReadiness: true, evaluateError: failure });
    await expect(f.open()).rejects.toBe(failure);
    expect(f.app.process).toHaveBeenCalledOnce();
    expect(() => f.app.process()).toThrow(/_object/);
    expect(f.child.exitCode).toBe(0); expect(f.child.signalCode).toBeNull();
    expect(f.boundedClose).toHaveBeenCalledWith(expect.any(Object), operationTimeoutMs);
    expect(f.logs().map(row => row.event)).toEqual(['v16.nfr_launch_failed']);
    expect(fs.existsSync(f.lock)).toBe(false);
  });

  it.each([
    ['非零退出', { exitCode: 7 }],
    ['信号退出', { exitCode: null, signalCode: 'SIGTERM' }],
    ['尚未退出', { exitCode: null, signalCode: null }],
    ['close异常', { closeError: new Error('UNIT_CLOSE_FAILED') }],
  ])('%s仍不能通过清理断言', async (_label, options) => {
    const f = await openForCleanup(options);
    await expect(f.runtime.close()).rejects.toThrow('NFR_RUNTIME_CLEANUP_NOT_CONFIRMED');
    expect(f.app.process).toHaveBeenCalledOnce();
    expect(f.cleanup()).toMatchObject({ exitCode: f.child.exitCode, signalCode: f.child.signalCode });
    if (options.closeError) expect(f.logs().map(row => row.event)).toContain('v16.nfr_runtime_close_failed');
    await expect(f.runtime.close()).rejects.toThrow('NFR_RUNTIME_CLEANUP_NOT_CONFIRMED');
    expect(f.app.close).toHaveBeenCalledOnce();
  });

  it('真实pageerror仍通过统一writer记录并使关闭校验失败', async () => {
    const f = await openForCleanup();
    const pageError = f.page.waitForEvent('pageerror');
    await f.page.evaluate(() => { setTimeout(() => { throw new Error('UNIT_RENDERER_FAILED'); }, 0); });
    await pageError;
    await expect(f.runtime.close()).rejects.toThrow('NFR_RENDERER_RUNTIME_ERRORS');
    expect(f.cleanup().rendererErrors).toContain('UNIT_RENDERER_FAILED');
    expect(f.logs()).toContainEqual(expect.objectContaining({ event: 'v16.nfr_renderer_failed',
      context: expect.objectContaining({ label: f.label, pid: f.child.pid }) }));
    expect(f.app.process).toHaveBeenCalledOnce();
  });

  it('关闭只释放原token所有权而不删除新所有者的锁', async () => {
    const f = await openForCleanup({ onClose: ({ lock }) => fs.writeFileSync(lock, 'new-unit-owner') });
    await f.runtime.close();
    expect(fs.readFileSync(f.lock, 'utf8')).toBe('new-unit-owner');
  });

  it('原生身份不匹配仍拒绝launch并在清理后移除原锁', async () => {
    const f = await fixture({ legacyReadiness: true, changeIdentity: value => { value.pid++; } });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.app.close).toHaveBeenCalledOnce();
    expect(fs.existsSync(f.lock)).toBe(false);
  });

  it('Renderer隔离边界不匹配仍拒绝launch', async () => {
    const f = await fixture({ legacyReadiness: true, changeIdentity: value => { value.windows[0].preferences.nodeIntegration = true; } });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_RENDERER_BOUNDARY_MISMATCH');
    expect(f.app.close).toHaveBeenCalledOnce();
    expect(fs.existsSync(f.lock)).toBe(false);
  });

  it('预启动admission失败仍在原生启动前失败并移除自有锁', async () => {
    const failure = new Error('UNIT_ADMISSION_FAILED');
    const f = await fixture({ admissionError: failure });
    await expect(f.open()).rejects.toBe(failure);
    expect(f.launch).not.toHaveBeenCalled();
    expect(f.app.process).not.toHaveBeenCalled();
    expect(f.logs().map(row => row.event)).toEqual(['v16.nfr_launch_failed']);
    expect(fs.existsSync(f.lock)).toBe(false);
  });
});

describe('Windows shell与真实Main的独立OS归属和退出证明', () => {
  it('direct PID原门仍可通过且不查询native PID或启动观察器', async () => {
    const f = await openForCleanup();
    expect(f.runtime.identity.pid).toBe(f.child.pid);
    expect(f.nativeProbe).not.toHaveBeenCalled(); expect(f.openMainExitWatcher).not.toHaveBeenCalled();
    await f.runtime.close();
    expect(f.cleanup()).toMatchObject({ pid: f.child.pid, exitCode: 0, signalCode: null });
  });

  it('当前cmd父子出生时刻和fresh marker证明Main归属并分记真实Main与launcher退出', async () => {
    const f = await fixture({ shell: true });
    const runtime = await f.open(), launch = f.launchRecord();
    expect(runtime.identity.pid).toBe(f.mainPid); expect(runtime.identity.pid).not.toBe(f.child.pid);
    expect(f.nativeProbe).toHaveBeenCalledTimes(2);
    expect(launch.processBinding).toMatchObject({ method: 'windows-shell', collectorPid: f.collectorPid,
      launcher: { pid: f.child.pid, parentPid: f.collectorPid }, main: { pid: f.mainPid, parentPid: f.child.pid },
      marker: { pid: f.mainPid, userDataDir: f.profile, replacedPrevious: false } });
    expect(launch.processBinding.main.creationTimeUtc).toMatch(/\d{3}7720Z$/);
    expect(Date.parse(launch.verification.verifiedAt)).toBeGreaterThanOrEqual(Date.parse(launch.finishedAt));
    expect(launch.verification.mainExitObserver).toMatchObject({ handleAcquired: true, pid: f.mainPid });
    await runtime.close();
    expect(f.cleanup()).toMatchObject({ pid: f.mainPid, exited: true, closed: true, exitCode: 0, signalCode: null,
      exitCodeSource: 'native-main-process-handle', launcher: { pid: f.child.pid, exited: true, exitCode: 0, signalCode: null },
      mainExit: { pid: f.mainPid, handleCreationTimeUtc: launch.verification.mainExitObserver.handleCreationTimeUtc } });
    expect(f.watcherEvents).toEqual(['ready', 'observe-exit', 'dispose']);
    expect(f.app.process).toHaveBeenCalledOnce(); expect(fs.existsSync(f.lock)).toBe(false);
  });

  it('warm profile旧marker只有被本次重新生成并核对hash后才被接受', async () => {
    const f = await fixture({ shell: true, previousMarker: true, previousWindowMarker: true });
    const runtime = await f.open(), marker = f.launchRecord().processBinding.marker;
    expect(marker.replacedPrevious).toBe(true); expect(marker.previousSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(marker.sha256).not.toBe(marker.previousSha256);
    const windowReady = f.launchRecord().processBinding.windowReady;
    expect(windowReady.replacedPrevious).toBe(true); expect(windowReady.sha256).not.toBe(windowReady.previousSha256);
    await runtime.close();
  });

  it.each([
    ['launcher错误父亲', rows => { const row = rows.find(item => item.pid === 10_001); if (row) row.parentPid++; }],
    ['Main错误父亲', rows => { const row = rows.find(item => item.pid === 10_003); if (row) row.parentPid++; }],
    ['launcher错误EXE', rows => { const row = rows.find(item => item.pid === 10_001); if (row) row.executablePath = 'C:\\Temp\\cmd.exe'; }],
    ['Main错误EXE', rows => { const row = rows.find(item => item.pid === 10_003); if (row) row.executablePath += '.old'; }],
    ['launcher缺出生时刻', rows => { const row = rows.find(item => item.pid === 10_001); if (row) delete row.creationTimeUtc; }],
    ['Main缺出生时刻', rows => { const row = rows.find(item => item.pid === 10_003); if (row) delete row.creationTimeUtc; }],
    ['Main旧出生时刻复用PID', rows => { const row = rows.find(item => item.pid === 10_003); if (row) row.creationTimeUtc = '2020-01-01T00:00:00.0000000Z'; }],
    ['Main亚毫秒出生时刻不符', rows => { const row = rows.find(item => item.pid === 10_003); if (row) row.creationTimeUtc = row.creationTimeUtc.replace('7720Z', '7730Z'); }],
    ['重复native PID行', rows => { rows.push({ ...rows[0] }); }],
  ])('%s仍拒绝shell归属而不启动Main观察器', async (_label, changeSnapshot) => {
    const f = await fixture({ shell: true, changeSnapshot });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.openMainExitWatcher).not.toHaveBeenCalled();
    expect(f.logs().map(row => row.event)).toContain('v16.nfr_launch_failed');
  });

  it('launcher第二次native观察出生时刻变化拒绝PID复用', async () => {
    const f = await fixture({ shell: true, changeSnapshot: (rows, index) => {
      if (index === 2) rows.find(row => row.pid === 10_001).creationTimeUtc = rows.find(row => row.pid === 10_001).creationTimeUtc.replace('0000Z', '0010Z');
    } });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.nativeProbe).toHaveBeenCalledTimes(2); expect(f.openMainExitWatcher).not.toHaveBeenCalled();
  });

  it.each([
    ['Main PID不符', marker => { marker.pid++; }],
    ['profile不符', marker => { marker.userDataDir += '-other'; }],
    ['mode不符', marker => { marker.mode = 'package-ui'; }],
    ['override缺失', marker => { delete marker.overridden; }],
    ['generatedAt缺失', marker => { delete marker.generatedAt; }],
    ['generatedAt属于旧启动', marker => { marker.generatedAt = '2020-01-01T00:00:00.000Z'; }],
    ['generatedAt来自未来', marker => { marker.generatedAt = '2099-01-01T00:00:00.000Z'; }],
  ])('fresh marker的%s仍拒绝Main归属', async (_label, changeMarker) => {
    const f = await fixture({ shell: true, changeMarker });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.openMainExitWatcher).not.toHaveBeenCalled();
  });

  it.each([['缺marker', { missingMarker: true }], ['未更新旧marker', { previousMarker: true, keepPreviousMarker: true }]])('%s仍拒绝Main归属', async (_label, options) => {
    const f = await fixture({ shell: true, ...options });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.openMainExitWatcher).not.toHaveBeenCalled();
  });

  it('不可信cmd路径在任何fake PID查询前被拒绝', async () => {
    const f = await fixture({ shell: true, shellPath: 'C:\\Temp\\cmd.exe' });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.nativeProbe).not.toHaveBeenCalled(); expect(f.openMainExitWatcher).not.toHaveBeenCalled();
    expect(f.app.close).toHaveBeenCalledOnce(); expect(fs.existsSync(f.lock)).toBe(true);
  });

  it('native查询失败保留原失败分类且不启动Main观察器', async () => {
    const f = await fixture({ shell: true, queryFailure: true });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_PROCESS_QUERY_FAILED');
    expect(f.openMainExitWatcher).not.toHaveBeenCalled();
    expect(f.app.close).toHaveBeenCalledOnce(); expect(f.child.exitCode).toBe(0); expect(fs.existsSync(f.lock)).toBe(true);
  });

  it('Main真实非零退出不能被launcher零退出覆盖', async () => {
    const f = await fixture({ shell: true, mainExitCode: 7 }), runtime = await f.open();
    await expect(runtime.close()).rejects.toThrow('NFR_RUNTIME_CLEANUP_NOT_CONFIRMED');
    expect(f.cleanup()).toMatchObject({ pid: f.mainPid, exitCode: 7, launcher: { pid: f.child.pid, exitCode: 0 } });
    expect(f.watcher.dispose).toHaveBeenCalledWith(operationTimeoutMs);
  });

  it.each([
    ['launcher残留', { exitCode: null }],
    ['launcher非零退出', { exitCode: 7 }],
    ['launcher信号退出', { exitCode: null, signalCode: 'SIGTERM' }],
    ['Main观察超时', { mainExitError: new Error('UNIT_MAIN_EXIT_TIMEOUT') }],
    ['Main观察异常', { mainExitError: new Error('UNIT_MAIN_EXIT_FAILED') }],
    ['observer回收失败', { watcherDisposeError: new Error('UNIT_WATCHER_DISPOSE_FAILED') }],
  ])('%s仍使shell清理失败并保留原锁', async (_label, options) => {
    const f = await fixture({ shell: true, ...options }), runtime = await f.open();
    await expect(runtime.close()).rejects.toThrow('NFR_RUNTIME_CLEANUP_NOT_CONFIRMED');
    expect(f.watcher.dispose).toHaveBeenCalledWith(operationTimeoutMs);
    expect(f.cleanup().closed).toBe(false); expect(fs.existsSync(f.lock)).toBe(true);
  });

  it('observer无法ready时仍关闭应用并保留缺Main退出证据的锁', async () => {
    const failure = new Error('UNIT_MAIN_WATCHER_NOT_READY');
    const f = await fixture({ shell: true, watcherOpenError: failure });
    await expect(f.open()).rejects.toBe(failure);
    expect(f.app.close).toHaveBeenCalledOnce(); expect(fs.existsSync(f.lock)).toBe(true);
    expect(f.logs().map(row => row.event)).toContain('v16.nfr_launch_cleanup_failed');
  });

  it('shell绑定后的Renderer边界失败仍回收实际Main和observer并保留原异常', async () => {
    const f = await fixture({ shell: true, changeIdentity: identity => { identity.windows[0].preferences.nodeIntegration = true; } });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_RENDERER_BOUNDARY_MISMATCH');
    expect(f.openMainExitWatcher).toHaveBeenCalledOnce(); expect(f.watcher.observeExit).toHaveBeenCalledWith(operationTimeoutMs);
    expect(f.watcher.dispose).toHaveBeenCalledWith(operationTimeoutMs); expect(fs.existsSync(f.lock)).toBe(false);
  });
});

describe('当前Main和窗口的fresh window-ready文件', () => {
  it.each([
    ['错误kind', marker => { marker.kind = 'old-window-ready'; }],
    ['错误schema', marker => { marker.schemaVersion = 2; }],
    ['Main PID不符', marker => { marker.pid++; }],
    ['profile不符', marker => { marker.userDataDir += '-other'; }],
    ['mode不符', marker => { marker.evidenceMode = 'package-ui'; }],
    ['窗口ID不符', marker => { marker.browserWindowId++; }],
    ['Renderer URL不符', marker => { marker.rendererUrl += '?old'; }],
    ['生成时刻缺失', marker => { delete marker.generatedAt; }],
    ['生成时刻早于runtime marker', (marker, context) => { marker.generatedAt = new Date(Date.parse(context.runtimeMarkerGeneratedAt) - 1).toISOString(); }],
    ['生成时刻属于旧启动', marker => { marker.generatedAt = '2020-01-01T00:00:00.000Z'; }],
    ['生成时刻来自未来', marker => { marker.generatedAt = '2099-01-01T00:00:00.000Z'; }],
  ])('window-ready的%s仍拒绝shell归属', async (_label, changeWindowMarker) => {
    const f = await fixture({ shell: true, changeWindowMarker });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.openMainExitWatcher).not.toHaveBeenCalled(); expect(fs.existsSync(f.lock)).toBe(true);
  });

  it.each([['缺window-ready', { missingWindowMarker: true }],
    ['未更新旧window-ready', { previousWindowMarker: true, keepPreviousWindowMarker: true }]])('%s仍拒绝Main归属', async (_label, options) => {
    const f = await fixture({ shell: true, ...options });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.openMainExitWatcher).not.toHaveBeenCalled(); expect(fs.existsSync(f.lock)).toBe(true);
  });
});

describe('shell事实与关闭后的最终launcher状态', () => {
  it('已识别cmd即使报告同PID也不能退回direct分支', async () => {
    const f = await fixture({ shell: true, changeIdentity: value => { value.pid = 10_001; } });
    await expect(f.open()).rejects.toThrow('NFR_RUNTIME_IDENTITY_MISMATCH');
    expect(f.nativeProbe).toHaveBeenCalledTimes(1); expect(f.openMainExitWatcher).not.toHaveBeenCalled();
    expect(fs.existsSync(f.lock)).toBe(true);
  });

  it('shell观察完成后重新读取同一launcher句柄而不使用close前的null快照', async () => {
    const f = await fixture({ shell: true, exitCode: null, completeLauncherOnObserve: true }), runtime = await f.open();
    await runtime.close();
    expect(f.cleanup()).toMatchObject({ pid: f.mainPid, exited: true, closed: true,
      launcher: { pid: f.child.pid, exited: true, exitCode: 0, signalCode: null } });
    expect(f.app.process).toHaveBeenCalledOnce(); expect(fs.existsSync(f.lock)).toBe(false);
  });
});

describe('观察器生命周期的日志失败边界', () => {
  it('launch日志IO失败仍回收App与Main观察器并抛原业务Error', async () => {
    const original = new Error('UNIT_LAUNCH_RECEIPT_FAILED');
    const f = await fixture({ shell: true, launchReceiptError: original, writerLogError: new Error('UNIT_LOG_IO_FAILED') });
    await expect(f.open()).rejects.toBe(original);
    expect(f.app.close).toHaveBeenCalledOnce(); expect(f.watcher.observeExit).toHaveBeenCalledWith(operationTimeoutMs);
    expect(f.watcher.dispose).toHaveBeenCalledWith(operationTimeoutMs); expect(fs.existsSync(f.lock)).toBe(false);
    expect(f.nativeStderr.mock.calls.some(call => call[0].includes('v16.nfr_log_failed') && call[0].includes('UNIT_LAUNCH_RECEIPT_FAILED'))).toBe(true);
  });

  it('app.close异常的日志IO失败仍完成Main观察与observer回收并保持失败', async () => {
    const f = await fixture({ shell: true, closeError: new Error('UNIT_APP_CLOSE_FAILED'), writerLogError: new Error('UNIT_LOG_IO_FAILED') });
    const runtime = await f.open();
    await expect(runtime.close()).rejects.toThrow('NFR_RUNTIME_CLEANUP_NOT_CONFIRMED');
    expect(f.watcher.observeExit).toHaveBeenCalledWith(operationTimeoutMs); expect(f.watcher.dispose).toHaveBeenCalledWith(operationTimeoutMs);
    expect(fs.existsSync(f.lock)).toBe(true);
    expect(f.nativeStderr.mock.calls.some(call => call[0].includes('UNIT_APP_CLOSE_FAILED'))).toBe(true);
  });
});
