const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isDeepStrictEqual } = require('node:util');
const { createArtifactWriter, fileRecord, readBound, insist } = require('./v16-performance-artifacts');
const { captureNativeLauncher, isNativeShellLauncher, queryProcesses, currentBirth, creationTicks } = require('./v16-performance-process-binding');
const { openMainExitWatcher } = require('./v16-performance-main-exit');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

const KIND = 'v16-package-ui-native-launch';
const normalized = value => typeof value === 'string' && path.isAbsolute(value) ? path.normalize(value).toLowerCase() : '';
const samePath = (left, right) => normalized(left) !== '' && normalized(left) === normalized(right);
const record = value => ({ path: value.path, sha256: value.sha256, sizeBytes: value.sizeBytes });
const defaults = { captureNativeLauncher, isNativeShellLauncher, queryProcesses, currentBirth, creationTicks, openMainExitWatcher, createArtifactWriter };

function collectPackageUiGovernanceSource(options, artifacts, root,
  currentSource = directory => require('./verify-v16-required-test-manifest').sourceIdentity(directory)) {
  if (!options.screenReaderExecutablePath) return null;
  const states = artifacts.appContent.files.filter(item => item.path === 'dist/main/v16-build-state.json');
  insist(states.length === 1, 'PACKAGE_UI_READER_PACKAGED_BUILD_STATE_REQUIRED');
  const buildState = { path: path.join(options.appContentPath, states[0].path), sha256: states[0].sha256, sizeBytes: states[0].sizeBytes };
  const original = readBound(buildState);
  insist(original.bytes.length === buildState.sizeBytes, 'PACKAGE_UI_READER_PACKAGED_BUILD_STATE_SIZE_MISMATCH');
  const state = original.json(), identity = currentSource(root);
  insist(state.schemaVersion === 'v16.build-state/1' && state.status === 'CURRENT'
    && isDeepStrictEqual(Object.keys(identity || {}).sort(), ['packageVersion', 'sourceRevision', 'sourceSha256'])
    && /^[a-f0-9]{64}$/.test(identity.sourceSha256) && typeof identity.sourceRevision === 'string' && identity.sourceRevision
    && typeof identity.packageVersion === 'string' && identity.packageVersion && isDeepStrictEqual(state.identity, identity),
  'PACKAGE_UI_READER_CURRENT_SOURCE_MISMATCH');
  return { identity, buildState };
}

function logPackageUiNativeFailure(writer, event, error) {
  try { writer.log(event, error); }
  catch (loggingError) {
    // 日志失败不能覆盖首先发生的运行错误。
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'package_ui.native_log_failed', { error: loggingError, originalError: error })) + '\n'); }
    catch { /* 输出流关闭后由原错误维持失败状态。 */ }
  }
}

function preparePackageUiNativeLaunch(app, startedAt, timeoutMs, ports = defaults) {
  insist(process.platform === 'win32', 'PACKAGE_UI_NATIVE_WINDOWS_REQUIRED');
  const child = app.process();
  insist(Number.isSafeInteger(child?.pid) && child.pid > 0, 'PACKAGE_UI_NATIVE_OWNED_LAUNCHER_REQUIRED');
  return { startedAt, child, launcherObservation: ports.captureNativeLauncher({ child, startedAt, timeoutMs }) };
}

async function collectPackageUiNativeIdentity(app, evidenceModeEnv) {
  return app.evaluate(({ app, BrowserWindow }, modeEnv) => {
    const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
    const metrics = app.getAppMetrics();
    return { pid: process.pid, creationTime: metrics.find(metric => metric.pid === process.pid)?.creationTime, electronVersion: process.versions.electron,
      executablePath: process.execPath, packaged: app.isPackaged, appRoot: app.getAppPath(), userDataDir: app.getPath('userData'),
      evidenceMode: process.env[modeEnv] || null,
      windows: windows.map(window => ({ id: window.id, visible: window.isVisible(), url: window.webContents.getURL(),
        rendererPid: window.webContents.getOSProcessId(),
        creationTime: metrics.find(metric => metric.pid === window.webContents.getOSProcessId())?.creationTime,
        preferences: { contextIsolation: window.webContents.getLastWebPreferences().contextIsolation,
          nodeIntegration: window.webContents.getLastWebPreferences().nodeIntegration } })) };
  }, evidenceModeEnv);
}

function validateLiveIdentity(identity, options) {
  const window = identity?.windows?.[0];
  insist(identity?.packaged === true && Number.isSafeInteger(identity.pid) && identity.pid > 0
    && Number.isFinite(identity.creationTime) && identity.creationTime > 0 && identity.evidenceMode === 'package-ui'
    && samePath(identity.executablePath, options.executablePath) && samePath(identity.appRoot, options.appContentPath)
    && samePath(identity.userDataDir, options.userDataDir) && identity.windows?.length === 1
    && Number.isSafeInteger(window.id) && window.id > 0 && window.visible === true
    && window.url === pathToFileURL(path.join(options.appContentPath, 'dist/renderer/index.html')).href
    && Number.isSafeInteger(window.rendererPid) && window.rendererPid > 0 && window.rendererPid !== identity.pid
    && Number.isFinite(window.creationTime) && window.creationTime > 0
    && window.preferences?.contextIsolation === true && window.preferences.nodeIntegration === false,
  'PACKAGE_UI_NATIVE_LIVE_IDENTITY_MISMATCH');
  return identity;
}

function packageIdentity(artifacts) {
  const main = artifacts.appContent.files.filter(item => item.path === 'dist/main/index.js');
  insist(main.length === 1 && [artifacts.exe.sha256, artifacts.appContent.sha256, main[0].sha256]
    .every(value => /^[A-F0-9]{64}$/.test(value)), 'PACKAGE_UI_NATIVE_PACKAGE_IDENTITY_REQUIRED');
  return { executableSha256: artifacts.exe.sha256, appContentSha256: artifacts.appContent.sha256, mainBundleSha256: main[0].sha256 };
}

function bindPackageUiMain(prepared, identity, options, timeoutMs, ports = defaults) {
  const { child, startedAt, launcherObservation } = prepared;
  const shell = ports.isNativeShellLauncher(child);
  insist(shell ? child.pid !== identity.pid : child.pid === identity.pid, 'PACKAGE_UI_NATIVE_LAUNCH_PATH_MISMATCH');
  const observation = ports.queryProcesses(shell ? [child.pid, identity.pid] : [identity.pid], timeoutMs);
  const main = observation.rows.find(row => row.pid === identity.pid);
  insist(main && samePath(main.executablePath, options.executablePath), 'PACKAGE_UI_NATIVE_MAIN_EXE_MISMATCH');
  const birth = ports.currentBirth(main.creationTimeUtc, startedAt, observation.observedAt);
  // CIM 原件保留七位，只在比较 Electron 微秒指标时换算。
  const microseconds = Math.round(identity.creationTime * 1000);
  insist(Number.isSafeInteger(microseconds) && BigInt(microseconds) === (birth + 5n) / 10n,
    'PACKAGE_UI_NATIVE_MAIN_BIRTH_MISMATCH');
  let launcher = main;
  if (shell) {
    launcher = observation.rows.find(row => row.pid === child.pid);
    const pinned = launcherObservation?.launcher;
    insist(launcherObservation?.collectorPid === process.pid && launcher && pinned && launcher.pid === pinned.pid
      && launcher.parentPid === process.pid && pinned.parentPid === process.pid
      && samePath(launcher.executablePath, child.spawnfile) && samePath(launcher.executablePath, pinned.executablePath)
      && ports.creationTicks(launcher.creationTimeUtc) === ports.creationTicks(pinned.creationTimeUtc)
      && main.parentPid === launcher.pid, 'PACKAGE_UI_NATIVE_LAUNCHER_BINDING_MISMATCH');
    insist(ports.currentBirth(launcher.creationTimeUtc, startedAt, observation.observedAt) <= birth,
      'PACKAGE_UI_NATIVE_LAUNCHER_BIRTH_MISMATCH');
  } else {
    insist(main.parentPid === process.pid && samePath(child.spawnfile, options.executablePath),
      'PACKAGE_UI_NATIVE_DIRECT_PARENT_MISMATCH');
  }
  return { method: shell ? 'windows-shell' : 'windows-direct', collectorPid: process.pid, main, launcher,
    creationPrecision: 'cim-microsecond+electron-microsecond', observedAt: observation.observedAt,
    query: observation.query, launcherObservation };
}

function createPackageUiNativeWriter(runDir, ports = defaults) {
  const writer = ports.createArtifactWriter(path.join(runDir, 'native-runtime'));
  return { ...writer, write: (...args) => record(writer.write(...args)), json: (...args) => record(writer.json(...args)),
    copy: (...args) => record(writer.copy(...args)), artifacts: () => writer.artifacts().map(record) };
}

async function openPackageUiNativeLaunch({ app, page, prepared, options, artifacts, runDir, timeoutMs, evidenceModeEnv }, ports = defaults) {
  const writer = createPackageUiNativeWriter(runDir, ports);
  let watcher;
  try {
    const identity = validateLiveIdentity(await collectPackageUiNativeIdentity(app, evidenceModeEnv), options);
    const processBinding = bindPackageUiMain(prepared, identity, options, timeoutMs, ports);
    watcher = await ports.openMainExitWatcher({ main: processBinding.main, timeoutMs, writer, label: 'native' });
    const packageBuildState = options.governanceBuildState ? writer.copy('native/package-build-state.json', options.governanceBuildState) : undefined;
    const finishedAt = new Date().toISOString();
    const receipt = writer.json('native/launch.json', { kind: KIND, schemaVersion: 1, startedAt: prepared.startedAt, finishedAt,
      generatedAt: finishedAt, packageIdentity: packageIdentity(artifacts), processBinding,
      verification: { mainExitObserver: watcher.ready }, identity, sourceIdentity: options.governanceSourceIdentity, packageBuildState });
    const runtime = { app, page, identity, userDataDir: options.userDataDir, launch: { receipt }, writer,
      nativeCleanup: null, readerLaunch: null, readerCleanup: null, governance: null, reader: null,
      async confirmMainExit(mainIdentity, remainingMs) {
        insist(mainIdentity?.pid === identity.pid && mainIdentity.evidenceMode === 'package-ui'
          && samePath(mainIdentity.userDataDir, identity.userDataDir), 'PACKAGE_UI_NATIVE_TERMINAL_MAIN_MISMATCH');
        const exit = await watcher.observeExit(remainingMs);
        insist(exit.pid === identity.pid && exit.creationTimeUtc === processBinding.main.creationTimeUtc
          && exit.handleCreationTimeUtc === watcher.ready.handleCreationTimeUtc && exit.exited === true
          && exit.exitCode === 0 && exit.signalCode === null && prepared.child.exitCode === 0
          && prepared.child.signalCode === null, 'PACKAGE_UI_NATIVE_MAIN_NORMAL_EXIT_REQUIRED');
        runtime.nativeCleanup = writer.json('native/cleanup.json', { kind: 'v16-package-ui-native-cleanup', schemaVersion: 1,
          nativeLaunch: receipt, mainExit: exit, exitCodeSource: 'native-main-process-handle',
          launcher: { pid: prepared.child.pid, exitCode: prepared.child.exitCode, signalCode: prepared.child.signalCode } });
        return true;
      },
      async dispose() { await watcher.dispose(timeoutMs); },
      evidence() {
        const files = [];
        const walk = directory => {
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(target); else files.push(record(fileRecord(target)));
          }
        };
        walk(writer.root);
        return { nativeLaunch: receipt, nativeCleanup: runtime.nativeCleanup, readerLaunch: runtime.readerLaunch,
          readerCleanup: runtime.readerCleanup, governance: runtime.governance, nativeRuntimeArtifacts: files,
          packageIdentity: packageIdentity(artifacts), sourceIdentity: options.governanceSourceIdentity || null,
          screenReaderRequested: Boolean(options.screenReaderExecutablePath) };
      },
    };
    return runtime;
  } catch (error) {
    logPackageUiNativeFailure(writer, 'package_ui.native_launch_failed', error);
    if (watcher) { try { await watcher.dispose(timeoutMs); } catch (cleanupError) { logPackageUiNativeFailure(writer, 'package_ui.native_launch_cleanup_failed', cleanupError); } }
    throw error;
  }
}

module.exports = { KIND, preparePackageUiNativeLaunch, collectPackageUiNativeIdentity, validateLiveIdentity,
  packageIdentity, bindPackageUiMain, createPackageUiNativeWriter, openPackageUiNativeLaunch, logPackageUiNativeFailure, collectPackageUiGovernanceSource };
