import {
  describe,
  expect,
  it,
  setElectronViewport,
} from './package-ui-test-context.mjs';

describe('packaged Electron viewport restoration', () => {
  it.each([1, 3])('applies the same two-pixel DPI tolerance while setting the native viewport (offset %i)', async (offset) => {
    let size = [0, 0];
    const window = {
      focus() {}, show() {},
      isDestroyed: () => false,
      isFullScreen: () => false,
      isMaximized: () => false,
      isMinimized: () => false,
      getContentSize: () => size,
      setContentSize: (width, height) => { size = [width + offset, height + offset]; },
    };
    const electronApp = { evaluate: (callback, settings) => callback(
      { BrowserWindow: { getAllWindows: () => [window] } },
      { ...settings, restoreTimeoutMs: 100, stabilityMs: 10, pollMs: 1 },
    ) };
    const result = setElectronViewport(electronApp, { width: 1366, height: 768 });
    if (offset <= 2) await expect(result).resolves.toBeUndefined();
    else await expect(result).rejects.toThrow(/viewport did not stabilize/);
  });

  it.each(['maximized', 'minimized'])('waits through a delayed Windows %s restore and returns only after the requested content size is stable', async (state) => {
    let inactive = true;
    let contentSize = [1200, 785];
    const requestedSizes = [];
    const restore = () => {
      setTimeout(() => { inactive = false; }, 5);
      setTimeout(() => { contentSize = [1200, 785]; }, 25);
    };
    const window = {
      focus() {},
      getContentSize: () => [...contentSize],
      isDestroyed: () => false,
      isFullScreen: () => false,
      isMaximized: () => state === 'maximized' && inactive,
      isMinimized: () => state === 'minimized' && inactive,
      setContentSize(width, height) {
        requestedSizes.push({ height, inactive, width });
        contentSize = [width, height];
      },
      show() {},
      unmaximize: restore,
      restore,
    };
    const electronApp = {
      evaluate: async (callback, argument) => callback({
        BrowserWindow: { getAllWindows: () => [window] },
      }, argument),
    };

    await setElectronViewport(electronApp, { height: 700, width: 1200 });
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(contentSize).toEqual([1200, 700]);
    expect(requestedSizes.length).toBeGreaterThan(0);
    expect(requestedSizes.every((entry) => entry.inactive === false)).toBe(true);
  });
});

import nativeFs from 'node:fs';
import nativePath from 'node:path';
import nativeOs from 'node:os';
import nativeVm from 'node:vm';
import { createRequire as createNativeRequire } from 'node:module';
import { pathToFileURL as nativeFileUrl } from 'node:url';

const nativeRequire = createNativeRequire(import.meta.url);

async function nativeProfileBridge(wide = false, settings = {}) {
  const events = [], original = nativeFs.readFileSync(new URL('./package-ui-profile-run.js', import.meta.url), 'utf8');
  const nativeRef = { path: nativePath.resolve('unit-native-launch.json'), sha256: 'A'.repeat(64), sizeBytes: 10 };
  const readerRef = { path: nativePath.resolve('unit-reader-launch.json'), sha256: 'B'.repeat(64), sizeBytes: 20 };
  const page = { waitForFunction: async () => {}, on() {}, waitForLoadState: async () => {} };
  const app = { on() {}, windows: () => [], firstWindow: async () => { events.push('first-window'); return page; },
    close: async () => { events.push('main-close'); if (settings.mainCloseError) throw new Error('unit-main-close-failed'); } };
  const runtime = { identity: { pid: 501, evidenceMode: 'package-ui', userDataDir: nativePath.resolve('unit-profile') },
    confirmMainExit: async (_main, remaining) => { expect(Number.isSafeInteger(remaining)).toBe(true); expect(remaining).toBeGreaterThan(0); expect(remaining).toBeLessThanOrEqual(20_000); events.push('held-main-exit'); if (settings.exitError) throw new Error('unit-held-exit-failed'); return true; },
    dispose: async () => { events.push('watcher-dispose'); }, evidence: () => ({ nativeLaunch: nativeRef, readerLaunch: readerRef }) };
  const module = { exports: {} };
  nativeVm.runInNewContext(`(function(require, module, exports) { ${original}\n})`, { process, Date, WeakSet, Math })(
    (name) => {
      if (name === './package-ui-native-launch') return {
        preparePackageUiNativeLaunch: () => { events.push('prepare'); return {}; },
        openPackageUiNativeLaunch: async (input) => { expect(input.app).toBe(app); expect(input.page).toBe(page); events.push('native-open'); return runtime; },
      };
      if (name === './package-ui-native-reader') return {
        collectPackageUiNativeGovernance: async (owned) => { expect(owned).toBe(runtime); events.push('reader-governance'); },
        closePackageUiNativeReader: async () => { events.push('reader-close'); if (settings.readerError) throw new Error('unit-reader-close-failed'); },
      };
      throw new Error('Unexpected unit dependency: ' + name);
    }, module, module.exports,
  );
  const profile = { id: 'wide', viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1, scalePercent: 100 };
  const options = { executablePath: nativePath.resolve('unit-app.exe'), userDataDir: nativePath.resolve('unit-profile'),
    appContentPath: nativePath.resolve('unit-app'), profileId: wide ? 'wide' : '100-compact', requireFreshTypedProof: true };
  const diagnostics = { renderer: { consoleErrors: [], pageErrors: [] }, cleanupErrors: [] };
  const deps = new Proxy({ path: nativePath, performance: globalThis.performance, _electron: { launch: async (input) => { events.push('launch'); expect(input.timeout).toBe(60_000); return app; } },
    DESKTOP_PACKAGE: { version: 'unit' }, PACKAGE_UI_EVIDENCE_MODE: 'package-ui', EVIDENCE_MODE_ENV: 'UNIT_MODE',
    PACKAGE_UI_REQUIRE_FRESH_TYPED_PROOF_ENV: 'UNIT_PROOF', PACKAGE_UI_VIEWPORT: { width: 1366, height: 768 },
    PACKAGE_UI_VIEWPORT_TOLERANCE: {}, PACKAGE_UI_WIDE_PROFILE: profile, EXPECTED_PACKAGE_UI_SUBVIEW_CHECKS: [],
    PACKAGE_UI_ELECTRON_CLOSE_TIMEOUT_MS: 20_000, PACKAGE_UI_NATIVE_RUNTIME_CONTRACT: { operationTimeoutMs: 20_000 },
    buildEvidenceUserDataEnv: () => ({}), attachElectronLifecycleDiagnostics: () => ({ attachPage() {} }),
    readElectronViewport: async () => ({ width: wide ? 1400 : 1366, height: wide ? 900 : 768, deviceScaleFactor: 1 }),
    evaluatePackageViewportContract: () => ({ passed: true }), validatePackageIdentity: () => ({ passed: true }),
    collectElectronIdentity: async () => ({}), ensureAuthenticatedWorkspace: async () => { events.push('auth'); return { storeGate: {} }; },
    waitForActiveBundledChromiumLineage: async () => ({}), chromiumLineageEvidencePassed: () => true,
    collectEvidenceStoreAuthorityReadback: async () => ({ passed: true }),
    requestPackageUiDatabaseCheckpoint: async (ownedPage, phase) => { events.push('checkpoint:' + phase); return {}; },
    capturePackageWorkspaceMatrix: async () => { events.push('matrix'); return { workspaceChecks: [], screenshots: [] }; },
    runOverlayChecks: async () => [], collectPackageUiMainIdentity: async () => runtime.identity,
    createStructuredFailure: (error, phase) => ({ phase, message: error.message }),
    waitForBoundedElectronClose: async ({ close }) => { await close(); },
    collectPackageUiReadOnlyRuntimeEvidence: () => { events.push('audit'); return { passed: true }; },
    fail: message => { throw new Error(message); },
  }, { get: (target, key) => key in target ? target[key] : () => undefined });
  const producer = module.exports(deps);
  let result, failure;
  try { result = wide ? await producer.runWideProfileEvidenceCore(options, { exe: {}, appContent: {} }, 'unit-run', diagnostics)
    : await producer.runScaleEvidenceCore(options, { scalePercent: 100, deviceScaleFactor: 1 }, { exe: {}, appContent: {} }, 'unit-run', diagnostics); }
  catch (error) { failure = error; }
  // 旧生产采集器必须先因没有接线而失败，不能靠缺少新模块取得红灯。
  expect(events).toContain('native-open');
  return { events, result, failure, diagnostics, nativeRef, readerRef };
}

async function nativeUnitFixture(shell = false) {
  await nativeProfileBridge();
  const adapter = nativeRequire('./package-ui-native-launch');
  const bindingPorts = nativeRequire('./v16-performance-process-binding');
  const root = nativeFs.mkdtempSync(nativePath.join(nativeOs.tmpdir(), 'package-ui-native-unit-'));
  const options = { executablePath: nativePath.join(root, 'AmazonAIOpsAgent.exe'), appContentPath: nativePath.join(root, 'resources/app'), userDataDir: nativePath.join(root, 'profile') };
  const startedAt = '2026-10-20T00:00:00.100Z', observedAt = '2026-10-20T00:00:00.200Z';
  const main = { pid: 401, parentPid: shell ? 300 : process.pid, executablePath: options.executablePath, creationTimeUtc: '2026-10-20T00:00:00.1230000Z' };
  const launcher = shell ? { pid: 300, parentPid: process.pid, executablePath: nativePath.join(root, 'cmd.exe'), creationTimeUtc: '2026-10-20T00:00:00.1100000Z' } : main;
  const child = { pid: launcher.pid, spawnfile: launcher.executablePath, exitCode: 0, signalCode: null };
  const identity = { pid: main.pid, creationTime: Date.parse('2026-10-20T00:00:00.123Z'), packaged: true,
    evidenceMode: 'package-ui', executablePath: options.executablePath, appRoot: options.appContentPath, userDataDir: options.userDataDir,
    windows: [{ id: 1, visible: true, url: nativeFileUrl(nativePath.join(options.appContentPath, 'dist/renderer/index.html')).href,
      rendererPid: 402, creationTime: Date.parse('2026-10-20T00:00:00.130Z'), preferences: { contextIsolation: true, nodeIntegration: false } }] };
  const rows = shell ? [launcher, main] : [main];
  const query = { rawStdout: JSON.stringify(rows), status: 0, signal: null };
  const prepared = { child, startedAt, launcherObservation: shell ? { collectorPid: process.pid, launcher: { ...launcher } } : null };
  const ready = { kind: 'v16-main-exit-ready', schemaVersion: 1, pid: main.pid, parentPid: main.parentPid, executablePath: main.executablePath, creationTimeUtc: main.creationTimeUtc,
    handleCreationTimeUtc: '2026-10-20T00:00:00.1230007Z', handleAcquired: true, watcherPid: 600,
    ownerToken: '184d066a-4993-44dc-88a7-dcf8e092cd36', creationPrecision: 'cim-microsecond+handle-100ns' };
  const calls = [];
  const ports = { ...bindingPorts, isNativeShellLauncher: () => shell,
    queryProcesses: () => ({ rows, query, observedAt }),
    createArtifactWriter: nativeRequire('./v16-performance-artifacts').createArtifactWriter,
    openMainExitWatcher: async (input) => { calls.push(input); return { ready,
      observeExit: async () => ({ ...ready, kind: 'v16-main-exit-proof', exited: true, exitCode: 0, signalCode: null }), dispose: async () => {} }; } };
  const artifacts = { exe: { sha256: 'A'.repeat(64) }, appContent: { sha256: 'B'.repeat(64), files: [{ path: 'dist/main/index.js', sha256: 'C'.repeat(64) }] } };
  const open = () => adapter.openPackageUiNativeLaunch({ app: { evaluate: async () => identity }, page: {}, prepared, options,
    artifacts, runDir: root, timeoutMs: 20_000, evidenceModeEnv: 'UNIT_MODE' }, ports);
  return { adapter, ports, root, options, prepared, identity, main, launcher, ready, artifacts, calls, open,
    dispose: () => {
      expect(nativePath.dirname(nativePath.resolve(root))).toBe(nativePath.resolve(nativeOs.tmpdir()));
      expect(nativePath.basename(root)).toMatch(/^package-ui-native-unit-/);
      nativeFs.rmSync(root, { recursive: true, force: true });
    } };
}

describe('package UI native ownership unit boundaries', () => {
  it.each([false, true])('drives the existing real %s profile producer through native/reader/close/audit wiring with unit OS boundaries', async (wide) => {
    const run = await nativeProfileBridge(wide);
    expect(run.failure).toBeUndefined();
    expect(run.result.nativeLaunch).toEqual(run.nativeRef);
    expect(run.result.readerLaunch).toEqual(run.readerRef);
    for (const [before, after] of [['launch', 'prepare'], ['prepare', 'first-window'], ['native-open', 'auth'], ['matrix', 'reader-governance'],
      ['reader-governance', 'checkpoint:post-navigation'], ['reader-close', 'main-close'], ['main-close', 'held-main-exit'], ['held-main-exit', 'audit']]) {
      expect(run.events.indexOf(before)).toBeLessThan(run.events.indexOf(after));
    }
  });

  it('records reader cleanup failure in the original cleanup error gate and still closes the bound Main', async () => {
    const run = await nativeProfileBridge(false, { readerError: true });
    expect(run.diagnostics.cleanupErrors).toContainEqual({ phase: 'reader-close', message: 'unit-reader-close-failed' });
    expect(run.events).toContain('main-close');
    const isolated = nativeFs.readFileSync(new URL('./package-ui-isolated-run.js', import.meta.url), 'utf8');
    expect(isolated).toContain('diagnostics.cleanupErrors.length === 0');
  });

  it('refuses terminal read-only audit when the held Main exit proof fails', async () => {
    const run = await nativeProfileBridge(false, { exitError: true });
    expect(run.failure?.message).toMatch(/did not exit/);
    expect(run.events).not.toContain('audit');
    expect(run.events).toContain('watcher-dispose');
  });

  it('retains the original Main close error while still observing the same held Main exit', async () => {
    const run = await nativeProfileBridge(false, { mainCloseError: true });
    expect(run.diagnostics.cleanupErrors).toContainEqual({ phase: 'electron-close', message: 'unit-main-close-failed' });
    expect(run.events).toContain('held-main-exit');
    expect(run.events).toContain('watcher-dispose');
  });

  it.each([false, true])('uses real adapter logic with unit CIM/Main boundaries for shell=%s and retains exact seven-digit held identity', async (shell) => {
    const fixture = await nativeUnitFixture(shell);
    try {
      const runtime = await fixture.open();
      expect(fixture.calls).toHaveLength(1);
      expect(fixture.calls[0].main).toEqual(fixture.main);
      const raw = JSON.parse(nativeFs.readFileSync(runtime.launch.receipt.path, 'utf8'));
      expect(raw.kind).toBe('v16-package-ui-native-launch');
      expect(raw.processBinding.method).toBe(shell ? 'windows-shell' : 'windows-direct');
      expect(raw.verification.mainExitObserver.handleCreationTimeUtc).toBe('2026-10-20T00:00:00.1230007Z');
      expect(raw.processBinding.main.creationTimeUtc).toBe('2026-10-20T00:00:00.1230000Z');
      await runtime.confirmMainExit({ pid: fixture.main.pid, userDataDir: fixture.options.userDataDir, evidenceMode: 'package-ui' }, 1000);
      expect(runtime.evidence().nativeCleanup).toEqual(expect.objectContaining({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/i) }));
      await runtime.dispose();
    } finally { fixture.dispose(); }
  });

  it.each([
    ['wrong Main EXE', f => { f.main.executablePath = nativePath.join(f.root, 'foreign.exe'); }],
    ['old Main birth', f => { f.main.creationTimeUtc = '2026-10-19T00:00:00.1230000Z'; }],
    ['truncated Main birth', f => { f.main.creationTimeUtc = '2026-10-20T00:00:00.123Z'; }],
    ['different Electron birth', f => { f.identity.creationTime += 1; }],
    ['foreign direct parent', f => { f.main.parentPid = process.pid + 10; }],
    ['foreign direct launcher', f => { f.prepared.child.pid += 1; }],
    ['second BrowserWindow', f => { f.identity.windows.push({ ...f.identity.windows[0], id: 2 }); }],
    ['foreign userData', f => { f.identity.userDataDir = nativePath.join(f.root, 'foreign-profile'); }],
    ['Renderer pretending to be Main', f => { f.identity.windows[0].rendererPid = f.main.pid; }],
    ['wrong renderer URL', f => { f.identity.windows[0].url = 'https://example.invalid/'; }],
    ['unsafe window preferences', f => { f.identity.windows[0].preferences.nodeIntegration = true; }],
  ])('fails the real native adapter for %s without touching WinAPI', async (_label, mutate) => {
    const fixture = await nativeUnitFixture();
    try { mutate(fixture); await expect(fixture.open()).rejects.toThrow(/PACKAGE_UI_NATIVE|NFR_RUNTIME/); expect(fixture.calls).toHaveLength(0); }
    finally { fixture.dispose(); }
  });

  it.each([
    ['wrong shell parent', f => { f.main.parentPid = process.pid; }],
    ['old pinned launcher birth', f => { f.prepared.launcherObservation.launcher.creationTimeUtc = '2026-10-19T00:00:00.1100000Z'; }],
    ['foreign launcher owner', f => { f.launcher.parentPid = process.pid + 1; }],
  ])('rejects %s before opening a Main handle', async (_label, mutate) => {
    const fixture = await nativeUnitFixture(true);
    try { mutate(fixture); await expect(fixture.open()).rejects.toThrow(/PACKAGE_UI_NATIVE|NFR_RUNTIME/); expect(fixture.calls).toHaveLength(0); }
    finally { fixture.dispose(); }
  });

  it('keeps NVDA disabled without the explicit option and never selects an installed executable or environment fallback', async () => {
    await nativeProfileBridge();
    const reader = nativeRequire('./package-ui-native-reader');
    await expect(reader.collectPackageUiNativeGovernance(null, {}, null, 20_000)).resolves.toBeUndefined();
    const source = nativeFs.readFileSync(new URL('./package-ui-native-reader.js', import.meta.url), 'utf8');
    expect(source).toContain("nativeLaunchKind: 'v16-package-ui-native-launch'");
    expect(source).not.toContain('process.env');
  });

  it.each(['CURRENT', 'STALE', 'source-mismatch', 'changed-state-bytes'])('binds packaged source to controlled current source with unit metadata for %s', async (mode) => {
    const fixture = await nativeUnitFixture();
    try {
      const identity = { sourceRevision: 'a'.repeat(40), sourceSha256: 'd'.repeat(64), packageVersion: 'unit' };
      const statePath = nativePath.join(fixture.options.appContentPath, 'dist/main/v16-build-state.json');
      nativeFs.mkdirSync(nativePath.dirname(statePath), { recursive: true });
      nativeFs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 'v16.build-state/1', status: mode === 'STALE' ? 'STALE' : 'CURRENT', identity }));
      const state = nativeRequire('./v16-performance-artifacts').fileRecord(statePath);
      fixture.artifacts.appContent.files.push({ path: 'dist/main/v16-build-state.json', sha256: state.sha256.toUpperCase(), sizeBytes: state.sizeBytes });
      fixture.options.screenReaderExecutablePath = nativePath.join(fixture.root, 'nvda.exe');
      if (mode === 'changed-state-bytes') nativeFs.appendFileSync(statePath, ' ');
      const capture = () => fixture.adapter.collectPackageUiGovernanceSource(fixture.options, fixture.artifacts, fixture.root,
        controlledRoot => { expect(controlledRoot).toBe(fixture.root); return mode === 'source-mismatch' ? { ...identity, sourceSha256: 'e'.repeat(64) } : identity; });
      if (mode !== 'CURRENT') expect(capture).toThrow(/PACKAGE_UI_READER|NFR_ARTIFACT/);
      else {
        const source = capture();
        expect(source.identity).toEqual(identity);
        fixture.options.governanceSourceIdentity = source.identity;
        fixture.options.governanceBuildState = source.buildState;
        const runtime = await fixture.open();
        const launch = JSON.parse(nativeFs.readFileSync(runtime.launch.receipt.path, 'utf8'));
        expect(launch.sourceIdentity).toEqual(identity);
        expect(launch.finishedAt).toEqual(expect.any(String));
        expect(nativeFs.readFileSync(launch.packageBuildState.path)).toEqual(nativeFs.readFileSync(statePath));
        await runtime.confirmMainExit({ pid: fixture.main.pid, userDataDir: fixture.options.userDataDir, evidenceMode: 'package-ui' }, 1000);
        await runtime.dispose();
      }
    } finally { fixture.dispose(); }
  });

  it.each(['missing native original', 'changed original bytes', 'missing reader original'])('rejects %s through the actual native evidence validator', async (mode) => {
    const fixture = await nativeUnitFixture();
    try {
      const runtime = await fixture.open();
      await runtime.confirmMainExit({ pid: fixture.main.pid, userDataDir: fixture.options.userDataDir, evidenceMode: 'package-ui' }, 1000);
      const run = { ...runtime.evidence(), actualIdentity: { actualExecutablePath: fixture.identity.executablePath, appPath: fixture.identity.appRoot,
        actualUserDataDir: fixture.identity.userDataDir, evidenceMode: 'package-ui', rendererUrl: fixture.identity.windows[0].url },
        schedulerReadOnlyRuntime: { main: { pid: fixture.main.pid, userDataDir: fixture.identity.userDataDir } }, attemptArtifacts: { rootPath: fixture.root } };
      const validate = nativeRequire('./package-ui-native-evidence').validatePackageUiNativeEvidence;
      expect(validate(run, { artifacts: fixture.artifacts }).passed).toBe(true);
      if (mode === 'missing native original') run.nativeLaunch = null;
      if (mode === 'changed original bytes') nativeFs.appendFileSync(run.nativeLaunch.path, ' ');
      expect(validate(run, { requireReader: mode === 'missing reader original', artifacts: fixture.artifacts }).passed).toBe(false);
      await runtime.dispose();
    } finally { fixture.dispose(); }
  });

  it.each([
    ['truncated held birth', (native) => { native.verification.mainExitObserver.handleCreationTimeUtc = '2026-10-20T00:00:00.123Z'; }],
    ['foreign held Main', (native) => { native.verification.mainExitObserver.pid += 1; }],
    ['Main pretending to be watcher', (native) => { native.verification.mainExitObserver.watcherPid = native.identity.pid; }],
    ['self-selected native kind', (native) => { native.kind = 'v16-nfr-native-launch'; }],
    ['extra package version in both identities', (native, _cleanup, run) => { native.packageIdentity.version = 'unit'; run.packageIdentity.version = 'unit'; }],
    ['different package version', (native, _cleanup, run) => { native.packageIdentity.version = 'unit-a'; run.packageIdentity.version = 'unit-b'; }],
    ['nonzero Main exit', (_native, cleanup) => { cleanup.mainExit.exitCode = 1; }],
    ['cross-attempt original', (_native, _cleanup, run, fixture) => { run.attemptArtifacts.rootPath = nativePath.join(fixture.root, 'foreign-attempt'); }],
  ])('rejects %s from genuine current-attempt unit files', async (_label, mutate) => {
    const fixture = await nativeUnitFixture();
    try {
      const runtime = await fixture.open();
      await runtime.confirmMainExit({ pid: fixture.main.pid, userDataDir: fixture.options.userDataDir, evidenceMode: 'package-ui' }, 1000);
      const run = { ...runtime.evidence(), actualIdentity: { actualExecutablePath: fixture.identity.executablePath, appPath: fixture.identity.appRoot,
        actualUserDataDir: fixture.identity.userDataDir, evidenceMode: 'package-ui', rendererUrl: fixture.identity.windows[0].url },
        schedulerReadOnlyRuntime: { main: { pid: fixture.main.pid, userDataDir: fixture.identity.userDataDir } }, attemptArtifacts: { rootPath: fixture.root } };
      const native = JSON.parse(nativeFs.readFileSync(run.nativeLaunch.path, 'utf8'));
      const cleanup = JSON.parse(nativeFs.readFileSync(run.nativeCleanup.path, 'utf8'));
      mutate(native, cleanup, run, fixture);
      run.nativeLaunch = runtime.writer.json('unit-mutated-native.json', native);
      cleanup.nativeLaunch = run.nativeLaunch;
      run.nativeCleanup = runtime.writer.json('unit-mutated-cleanup.json', cleanup);
      expect(nativeRequire('./package-ui-native-evidence').validatePackageUiNativeEvidence(run, { artifacts: fixture.artifacts }).passed).toBe(false);
      await runtime.dispose();
    } finally { fixture.dispose(); }
  });
});
function ownedViewportRestoreModel(mutateAfterFirstRead) {
  let clock = 0, reads = 0, ownedSets = 0, foreignSets = 0, evaluations = 0, getAllCalls = 0;
  let ownedSize = [1184, 633], foreignSize = [200, 100], rendererPid = 22, mainCreationTime = 1000, url = 'file:///owned/index.html';
  const expectedOwner = { mainPid: 11, mainCreationTime: 1000, windowId: 1, rendererPid: 22,
    rendererCreationTime: 1100, url, electronVersion: '44.2.0' };
  const selections = [], budgets = [];
  const window = { id: 1, show() {}, focus() {}, isDestroyed: () => false,
    isFullScreen: () => false, isMaximized: () => false, isMinimized: () => false,
    getContentSize: () => {
      reads++;
      if (reads === 1) {
        if (mutateAfterFirstRead === 'renderer') rendererPid = 33;
        if (mutateAfterFirstRead === 'Main birth') mainCreationTime = 2000;
        if (mutateAfterFirstRead === 'URL') url = 'file:///other/index.html';
      }
      return [...ownedSize];
    },
    setContentSize: (width, height) => { ownedSets++; ownedSize = [width, height]; },
    webContents: { isDestroyed: () => false, getOSProcessId: () => rendererPid, getURL: () => url } };
  const foreign = { ...window, id: 9, getContentSize: () => [...foreignSize],
    setContentSize: (width, height) => { foreignSets++; foreignSize = [width, height]; } };
  const electron = { app: { getAppMetrics: () => [{ pid: 11, creationTime: mainCreationTime }, { pid: 22, creationTime: 1100 }] },
    BrowserWindow: { fromId: id => { selections.push(id); return id === 1 ? window : null; },
      getAllWindows: () => { getAllCalls++; return [foreign, window]; } } };
  const app = { evaluate: async (callback, settings) => {
    evaluations++; budgets.push({ timeout: settings.restoreTimeoutMs, stable: settings.stabilityMs, poll: settings.pollMs });
    return nativeVm.runInNewContext(`(${callback.toString()})`, {
      process: { pid: 11, versions: { electron: '44.2.0' } }, Date: class extends Date { static now() { return clock; } },
      setTimeout: (next, delay) => { clock += delay; Promise.resolve().then(next); return 1; },
    })(electron, settings);
  } };
  return { app, expectedOwner, selections, budgets, state: () => ({ reads, ownedSets, foreignSets, evaluations, getAllCalls, ownedSize, foreignSize, clock }) };
}

describe('owned motion native viewport恢复', () => {
  it('实际执行原稳定循环且first window干扰不能改写其它窗口', async () => {
    const model = ownedViewportRestoreModel();
    await setElectronViewport(model.app, { width: 1366, height: 768 }, model.expectedOwner);
    expect(model.selections).toEqual([1]); expect(model.state().getAllCalls).toBe(0);
    expect(model.state().foreignSets).toBe(0); expect(model.state().foreignSize).toEqual([200, 100]);
    expect(model.state().ownedSize).toEqual([1366, 768]); expect(model.state().reads).toBeGreaterThan(1);
    expect(model.state().clock).toBeGreaterThanOrEqual(250);
    expect(model.budgets).toEqual([{ timeout: 5000, stable: 250, poll: 25 }]);
  });
  it.each(['renderer', 'Main birth', 'URL'])('稳定读回期间%s改变立即拒绝且不再重设尺寸', async change => {
    const model = ownedViewportRestoreModel(change);
    await expect(setElectronViewport(model.app, { width: 1366, height: 768 }, model.expectedOwner)).rejects.toThrow('RESTORE_OWNED_WINDOW_REQUIRED');
    expect(model.state().reads).toBe(1); expect(model.state().ownedSets).toBe(1); expect(model.state().foreignSets).toBe(0);
  });
  it('显式未知owner不能退回first window或进入原生回调', async () => {
    const model = ownedViewportRestoreModel();
    await expect(setElectronViewport(model.app, { width: 1366, height: 768 }, null)).rejects.toThrow('RESTORE_OWNER_INVALID');
    expect(model.state().evaluations).toBe(0); expect(model.state().ownedSets).toBe(0); expect(model.state().foreignSets).toBe(0);
  });
});
describe('owned Main版本原件', () => {
  it('实际执行identity生产回调并从process.versions读取版本', async () => {
    const collect = nativeRequire('./package-ui-native-launch').collectPackageUiNativeIdentity;
    const window = { id: 1, isDestroyed: () => false, isVisible: () => true,
      webContents: { getURL: () => 'file:///owned/index.html', getOSProcessId: () => 22,
        getLastWebPreferences: () => ({ contextIsolation: true, nodeIntegration: false }) } };
    const electron = { app: { isPackaged: true, getAppMetrics: () => [{ pid: 11, creationTime: 1000 }, { pid: 22, creationTime: 1100 }],
      getAppPath: () => 'F:\\owned\\resources\\app', getPath: () => 'F:\\owned-profile' },
      BrowserWindow: { getAllWindows: () => [window] } };
    const app = { evaluate: (callback, argument) => nativeVm.runInNewContext(`(${callback.toString()})`, {
      process: { pid: 11, execPath: 'F:\\owned\\AmazonAIOpsAgent.exe', versions: { electron: '44.2.0' }, env: { UNIT_MODE: 'package-ui' } },
    })(electron, argument) };
    const identity = await collect(app, 'UNIT_MODE');
    expect(identity.electronVersion).toBe('44.2.0'); expect(identity.pid).toBe(11);
    expect(identity.windows[0]).toMatchObject({ id: 1, rendererPid: 22, creationTime: 1100 });
  });
});
