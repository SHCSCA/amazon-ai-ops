const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { insist } = require('./v16-performance-artifacts');
const evidence = require('./evidence-user-data');
const { selectNativeMemoryPeaks } = require('./v16-performance-memory');
const { snapshotNativeMarkers, isNativeShellLauncher, captureNativeLauncher, bindNativeMainProcess } = require('./v16-performance-process-binding');
const { openMainExitWatcher } = require('./v16-performance-main-exit');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

function assertNativeCleanup({ exited, exitCode, signalCode, closeError, rendererErrors = [] }) {
  insist(exited && exitCode === 0 && signalCode === null && !closeError, 'NFR_RUNTIME_CLEANUP_NOT_CONFIRMED');
  insist(rendererErrors.length === 0, 'NFR_RENDERER_RUNTIME_ERRORS');
}

function logNativeFailure(writer, event, error, context) {
  try { writer.log(event, error, context); }
  catch (loggingError) {
    // 日志失败不能截断自有应用和观察器的回收，也不能替换首先发生的业务错误。
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.nfr_log_failed',
      { ...context, event, error: loggingError, originalError: error })) + '\n'); }
    catch { /* 最后日志出口关闭时仍由调用方保留原异常并完成回收。 */ }
  }
}

async function closeNativeOwnership({ app, child, shellLauncher, processBinding, watcher, writer, label, timeoutMs }) {
  let closeError;
  try { await require('./package-ui-evidence').waitForBoundedElectronClose({ close: () => app.close() }, timeoutMs); }
  catch (error) { closeError = error; logNativeFailure(writer, 'v16.nfr_runtime_close_failed', error, { label, pid: child.pid }); }
  const launcherExit = { pid: child.pid, exited: child.exitCode !== null || child.signalCode !== null,
    exitCode: child.exitCode, signalCode: child.signalCode };
  let mainExit = launcherExit;
  const shell = shellLauncher;
  if (shell) {
    mainExit = { pid: processBinding?.main?.pid ?? null, exited: false, exitCode: null, signalCode: null };
    try {
      insist(processBinding?.method === 'windows-shell' && watcher, 'NFR_RUNTIME_MAIN_EXIT_NOT_CONFIRMED');
      const observed = await watcher.observeExit(timeoutMs);
      insist(observed.pid === processBinding.main.pid && observed.creationTimeUtc === processBinding.main.creationTimeUtc
        && observed.executablePath.toLowerCase() === processBinding.main.executablePath.toLowerCase()
        && observed.handleCreationTimeUtc === watcher.ready.handleCreationTimeUtc,
      'NFR_RUNTIME_MAIN_EXIT_NOT_CONFIRMED');
      mainExit = observed;
    } catch (error) {
      closeError ??= error; logNativeFailure(writer, 'v16.nfr_main_exit_failed', error, { label, pid: processBinding?.main?.pid, launcherPid: child.pid });
    } finally {
      try { await watcher?.dispose(timeoutMs); }
      catch (error) { closeError ??= error; logNativeFailure(writer, 'v16.nfr_main_exit_observer_cleanup_failed', error, { label, launcherPid: child.pid }); }
    }
    Object.assign(launcherExit, { exited: child.exitCode !== null || child.signalCode !== null,
      exitCode: child.exitCode, signalCode: child.signalCode });
    try { assertNativeCleanup(launcherExit); }
    catch (error) { closeError ??= error; logNativeFailure(writer, 'v16.nfr_launcher_cleanup_failed', error, { label, pid: child.pid }); }
  }
  return { mainExit, launcherExit, shell, closeError, exited: mainExit.exited && launcherExit.exited };
}

async function openNativeRuntime({ current, fixture, profile, writer, label, timeoutMs, root = process.cwd() }) {
  insist(process.platform === 'win32', 'NFR_REAL_WINDOWS_EXE_REQUIRED');
  const userDataDir = evidence.validateEvidenceUserDataPath(profile);
  const lock = path.join(userDataDir, 'v16-nfr-collector.lock'), token = randomUUID();
  fs.writeFileSync(lock, token, { flag: 'wx' });
  let app, child, launcherObservation, processBinding, watcher, shellLauncher = false, closed = false, closeAttempted = false, closeFailure;
  const rendererErrors = [];
  try {
    await require('./v16-performance-admission').admitNativeProfile({ root, profile: userDataDir, fixture, writer, label });
    const env = evidence.buildEvidenceUserDataEnv(process.env, evidence.PACKAGE_LAUNCH_SMOKE_MODE, userDataDir);
    delete env.ELECTRON_RUN_AS_NODE;
    env.NODE_ENV = 'production';
    const initialMarkers = snapshotNativeMarkers(userDataDir);
    const startedAt = new Date().toISOString(), start = performance.now();
    app = await require('./playwright-loader')._electron.launch({ executablePath: current.executablePath,
      args: [], cwd: path.dirname(current.executablePath), env, timeout: timeoutMs });
    child = app.process();
    shellLauncher = isNativeShellLauncher(child);
    launcherObservation = captureNativeLauncher({ child, startedAt, timeoutMs });
    const page = await app.firstWindow({ timeout: timeoutMs });
    page.on('pageerror', error => { rendererErrors.push(error.message); logNativeFailure(writer, 'v16.nfr_renderer_failed', error, { label, pid: child.pid }); });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('section[aria-label="店铺与站点"] .store-scope-switcher__trigger').waitFor({ state: 'visible', timeout: timeoutMs });
    const identity = await app.evaluate(({ app, BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
      const metrics = app.getAppMetrics();
      return { pid: process.pid, creationTime: metrics.find(metric => metric.pid === process.pid)?.creationTime,
        executablePath: process.execPath, packaged: app.isPackaged, appRoot: app.getAppPath(),
        userDataDir: app.getPath('userData'), electronVersion: process.versions.electron,
        windows: windows.map(window => ({ id: window.id, visible: window.isVisible(), url: window.webContents.getURL(),
          rendererPid: window.webContents.getOSProcessId(),
          creationTime: metrics.find(metric => metric.pid === window.webContents.getOSProcessId())?.creationTime, preferences: window.webContents.getLastWebPreferences() })) };
    });
    const elapsedMs = performance.now() - start, finishedAt = new Date().toISOString();
    for (const error of await page.pageErrors()) if (!rendererErrors.includes(error.message)) {
      rendererErrors.push(error.message); logNativeFailure(writer, 'v16.nfr_renderer_failed', error, { label, pid: child.pid });
    }
    insist(identity.packaged === true
      && path.resolve(identity.executablePath).toLowerCase() === current.executablePath.toLowerCase()
      && path.resolve(identity.appRoot).toLowerCase() === current.appRoot.toLowerCase()
      && path.resolve(identity.userDataDir).toLowerCase() === userDataDir.toLowerCase(), 'NFR_RUNTIME_IDENTITY_MISMATCH');
    const verificationStartedAt = new Date().toISOString(), verificationStart = performance.now();
    processBinding = bindNativeMainProcess({ child, identity, current, userDataDir, startedAt, initialMarkers, launcherObservation, timeoutMs });
    if (processBinding.method === 'windows-shell') watcher = await openMainExitWatcher({ main: processBinding.main, timeoutMs, writer, label });
    insist(identity.windows.length === 1 && identity.windows[0].visible
      && identity.windows[0].url === pathToFileURL(path.join(current.appRoot, 'dist/renderer/index.html')).href
      && identity.windows[0].preferences.contextIsolation === true && identity.windows[0].preferences.nodeIntegration === false,
    'NFR_RUNTIME_RENDERER_BOUNDARY_MISMATCH');
    const verification = { startedAt: verificationStartedAt, verifiedAt: new Date().toISOString(),
      elapsedMs: performance.now() - verificationStart, initialLauncherObservationElapsedMs: launcherObservation?.elapsedMs ?? 0,
      mainExitObserver: watcher?.ready };
    const receipt = writer.json(`${label}/launch.json`, { kind: 'v16-nfr-native-launch', schemaVersion: 1,
      classification: fixture.classification, fixture: fixture.fixture, label, startedAt, finishedAt, elapsedMs,
      packageIdentity: current.packageIdentity, processBinding, verification,
      identity: { ...identity, windows: identity.windows.map(({ preferences, ...window }) => ({
        ...window, preferences: { contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration } })) } });
    const ownership = () => ({ app, child, shellLauncher, processBinding, watcher, writer, label, timeoutMs });
    const runtime = { app, page, identity, userDataDir, launch: { elapsedMs, receipt },
      async close() {
        if (closed) return;
        if (closeAttempted) throw closeFailure ?? new Error('NFR_RUNTIME_CLEANUP_NOT_CONFIRMED');
        closeAttempted = true;
        const cleanup = await closeNativeOwnership(ownership());
        const { mainExit, launcherExit, exited, closeError, shell } = cleanup;
        writer.json(`${label}/cleanup.json`, { kind: 'v16-nfr-runtime-cleanup', pid: identity.pid, exited, closed: !closeError,
          exitCode: mainExit.exitCode, signalCode: mainExit.signalCode, rendererErrors,
          exitCodeSource: shell ? 'native-main-process-handle' : 'owned-child-process',
          ...(shell ? { mainExit, launcher: launcherExit } : {}),
          observedAt: new Date().toISOString(), packageIdentity: current.packageIdentity });
        if (exited && (!shell || !closeError)) {
          if (fs.readFileSync(lock, 'utf8') === token) fs.unlinkSync(lock);
        }
        try { assertNativeCleanup({ exited, exitCode: mainExit.exitCode, signalCode: mainExit.signalCode, closeError, rendererErrors }); }
        catch (error) { closeFailure = error; throw error; }
        closed = true;
      },
    };
    page.setDefaultTimeout(timeoutMs);
    page.nfrOperationTimeoutMs = timeoutMs;
    runtime.rendererErrors = rendererErrors;
    return runtime;
  } catch (error) {
    logNativeFailure(writer, 'v16.nfr_launch_failed', error, { label });
    if (app) {
      try {
        const cleanup = await closeNativeOwnership({ app, child, shellLauncher, processBinding, watcher, writer, label, timeoutMs });
        if (shellLauncher) {
          assertNativeCleanup({ ...cleanup.mainExit, exited: cleanup.exited, closeError: cleanup.closeError, rendererErrors });
          closed = true;
          writer.json(`${label}/launch-failure-cleanup.json`, { kind: 'v16-nfr-launch-failure-cleanup',
            mainExit: cleanup.mainExit, launcher: cleanup.launcherExit, observedAt: new Date().toISOString() });
        } else closed = child.exitCode !== null && !cleanup.closeError;
        insist(closed, 'NFR_LAUNCH_FAILURE_CLEANUP_NOT_CONFIRMED');
      }
      catch (cleanupError) { logNativeFailure(writer, 'v16.nfr_launch_cleanup_failed', cleanupError, { label }); }
    } else closed = true;
    if (closed && fs.existsSync(lock) && fs.readFileSync(lock, 'utf8') === token) fs.unlinkSync(lock);
    throw error;
  }
}

async function readNativeMemory(runtime) {
  const observed = await runtime.app.evaluate(({ app, BrowserWindow }) => {
    const rendererPid = BrowserWindow.getAllWindows().find(window => !window.isDestroyed())?.webContents.getOSProcessId();
    const metrics = app.getAppMetrics();
    return { pid: process.pid, rendererPid, metrics: metrics.map(metric => ({ pid: metric.pid, type: metric.type, creationTime: metric.creationTime, memory: metric.memory })) };
  });
  return selectNativeMemoryPeaks(observed, runtime.identity);
}
module.exports = { openNativeRuntime, readNativeMemory, assertNativeCleanup };
