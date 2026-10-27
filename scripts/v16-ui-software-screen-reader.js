const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { insist, directPath, fileRecord, readBound } = require('./v16-performance-artifacts');
const { validateProviderBinding, validateProviderReady, validateProviderObservation, SPEECH_PROTOCOL } = require('./v16-nvda-provider-binding');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const { captureTrustedWindowsRuntime } = require('./s7-launch-operator-security');
const { activateOwnedCaption } = require('./v16-ui-owned-caption');
const { OWNED_CAPTION_PROTOCOL, validateOwnedCaptionProtocol } = require('./v16-ui-owned-caption-contract');
const { runFocusPhase } = require('./v16-ui-nvda-focus-phase');
const { OWNED_ACCESSIBILITY_PROTOCOL, setupOwnedAccessibility, observeOwnedAccessibility } = require('./v16-ui-owned-accessibility');
const { runNativeKeys, readNativeFocusMode } = require('./v16-ui-nvda-native-keys');
const { selectBracketedSpeech, waitForBracketedSpeech } = require('./v16-ui-nvda-speech-bracket');

function logFailure(writer, event, error, context) {
  try { writer.log(event, error, context); }
  catch (loggingError) {
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_screen_reader_log_failed', { event, error: loggingError, originalError: error })) + '\n'); }
    catch { /* 日志出口关闭仍保留原异常并回收本次自有屏读进程。 */ }
  }
}
function capturePhase(writer, context, phase, error) {
  try {
    const row = { kind: 'v16-nvda-node-phase', schemaVersion: 1, ...context, phase, timestamp: new Date().toISOString() };
    if (error) row.errorCode = String(error.message || 'UI_NVDA_CAPTURE_FAILED').slice(0, 160);
    writer.json(`screen-reader/node-${context.nodeSequence}-${phase}.json`, row);
  } catch (loggingError) {
    // 阶段原件失败仅记录自身故障，不替换真实采集的原异常。
    logFailure(writer, 'v16.ui_screen_reader_phase_record_failed', loggingError, { pid: context.pid, nodeSequence: context.nodeSequence, phase });
  }
}
async function bounded(action, deadline) {
  let timer;
  const remaining = deadline - Date.now(); insist(remaining > 0, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED')), remaining);
  })]); } finally { clearTimeout(timer); }
}
async function runtimeSnapshot(runtime) {
  const value = await runtime.app.evaluate(({ app, BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
    if (windows.length !== 1) throw new Error('UI_NVDA_SINGLE_OWNED_WINDOW_REQUIRED');
    const window = windows[0], metrics = app.getAppMetrics(), rendererPid = window.webContents.getOSProcessId();
    const handle = window.getNativeWindowHandle(), preferences = window.webContents.getLastWebPreferences();
    const rootHwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : handle.length === 4 ? String(handle.readUInt32LE()) : '';
    return { pid: process.pid, creationTime: metrics.find(metric => metric.pid === process.pid)?.creationTime,
      executablePath: process.execPath, appRoot: app.getAppPath(), userDataDir: app.getPath('userData'), packaged: app.isPackaged,
      renderer: { pid: rendererPid, creationTime: metrics.find(metric => metric.pid === rendererPid)?.creationTime,
        creationTimeSource: 'electron.app.getAppMetrics.creationTime' },
      window: { id: window.id, url: window.webContents.getURL(), rootHwnd, visible: window.isVisible(),
        preferences: { contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration } } };
  });
  value.storeContext = await runtime.page.evaluate(async () => (await window.electronAPI.getActiveStoreWorkspaceView())?.context);
  return value;
}
function bindingFromSnapshot(snapshot, nativeLaunchRef, nativeLaunch, runToken) {
  const main = nativeLaunch.processBinding?.main, held = nativeLaunch.verification?.mainExitObserver;
  insist(main && held && snapshot.pid === nativeLaunch.identity?.pid && snapshot.creationTime === nativeLaunch.identity.creationTime
    && snapshot.appRoot === nativeLaunch.identity.appRoot && snapshot.packaged === true && snapshot.window.visible
    && snapshot.window.preferences.contextIsolation === true && snapshot.window.preferences.nodeIntegration === false,
  'UI_NVDA_PROVIDER_CURRENT_RUNTIME_REQUIRED');
  return { schemaVersion: 'v16.nvda-provider-binding/1', providerKind: 'nvda-main-window-accessibility', runToken,
    main: { pid: snapshot.pid, creationTimeUtc: main.creationTimeUtc, handleCreationTimeUtc: held.handleCreationTimeUtc,
      creationPrecision: held.creationPrecision, executablePath: snapshot.executablePath, userDataDir: snapshot.userDataDir, ownerToken: held.ownerToken },
    renderer: snapshot.renderer, window: { id: snapshot.window.id, url: snapshot.window.url, rootHwnd: snapshot.window.rootHwnd },
    storeContext: snapshot.storeContext, nativeLaunch: nativeLaunchRef };
}
async function currentNode(runtime, locator, node, binding, nativeLaunch, options) {
  const snapshot = await runtimeSnapshot(runtime), current = bindingFromSnapshot(snapshot, binding.nativeLaunch, nativeLaunch, binding.runToken);
  insist(same(current, binding), 'UI_NVDA_PROVIDER_CURRENT_RUNTIME_CHANGED');
  const dom = await require('./v16-ui-accessible-node').readAccessibleCurrent(locator, node, { ...options, requireActiveTarget: true });
  insist(dom.id === node.id && dom.name === node.name && dom.role === node.role && dom.activeElementId === node.id, 'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED');
  return { observedAt: new Date().toISOString(), binding: current, dom };
}

function readSpeech(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8'), lines = text.split(/\r?\n/).filter(Boolean);
  return lines.flatMap((line, index) => {
    try { return [JSON.parse(line)]; }
    catch (error) { if (index === lines.length - 1 && !text.endsWith('\n')) return []; throw error; }
  });
}
async function until(read, predicate, timeoutMs, code) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read(); if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(code);
}
async function ensureOwnedForeground({ directory, binding, pid, nodeSequence, startedAt, deadline, writer, assertActive }) {
  let request;
  try {
    request = { schemaVersion: 1, command: 'ensure-foreground', runToken: binding.runToken, nonce: randomUUID(),
      pid, nodeSequence, startedAt, deadlineAt: new Date(deadline).toISOString() };
    const commandFile = path.join(directory, 'collector-foreground.json');
    const ackFile = path.join(directory, `collector-foreground-ack-${request.nonce}.json`);
    insist(!fs.existsSync(commandFile) && !fs.existsSync(ackFile), 'UI_NVDA_OWNED_FOREGROUND_REQUEST_PENDING');
    insist(deadline > Date.now(), 'UI_NVDA_OWNED_FOREGROUND_TIMEOUT');
    const temporary = path.join(directory, `collector-foreground-${request.nonce}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(request), { flag: 'wx' });
    fs.renameSync(temporary, commandFile);
    const ack = await bounded(() => until(() => {
      assertActive();
      if (!fs.existsSync(ackFile)) return null;
      const value = JSON.parse(fs.readFileSync(ackFile, 'utf8'));
      insist(value && typeof value === 'object' && !Array.isArray(value), 'UI_NVDA_OWNED_FOREGROUND_ACK_INVALID');
      return value;
    }, Boolean, Math.max(1, deadline - Date.now()), 'UI_NVDA_OWNED_FOREGROUND_TIMEOUT'), deadline);
    const fields = ['kind', 'schemaVersion', 'runToken', 'nonce', 'pid', 'nodeSequence', 'startedAt', 'deadlineAt',
      'timestamp', 'reason', 'foregroundNull', 'ownerIsBoundMain', 'exactRoot', 'callReturnedTrue'];
    const reasons = ['ALREADY_OWNED', 'EXACT_ROOT_ESTABLISHED', 'NOT_ESTABLISHED', 'BIRTH', 'ROOT_OWNER', 'ANCESTOR',
      'API', 'REQUEST_INVALID', 'REQUEST_EXPIRED', 'REQUEST_REPLAY'];
    const observed = Date.parse(ack.timestamp);
    insist(same(Object.keys(ack).sort(), fields.sort()) && ack.kind === 'nvda-observer-foreground-ack'
      && ack.schemaVersion === 1 && ack.runToken === request.runToken && ack.nonce === request.nonce && ack.pid === pid
      && ack.nodeSequence === nodeSequence && ack.startedAt === startedAt && ack.deadlineAt === request.deadlineAt
      && Number.isFinite(observed) && new Date(observed).toISOString() === ack.timestamp
      && observed >= Date.parse(startedAt) && observed <= deadline && reasons.includes(ack.reason)
      && ['foregroundNull', 'ownerIsBoundMain', 'exactRoot', 'callReturnedTrue'].every(key => ack[key] === null || typeof ack[key] === 'boolean'),
    'UI_NVDA_OWNED_FOREGROUND_ACK_INVALID');
    writer.json(`screen-reader/foreground-${nodeSequence}.json`, { request, ack });
    // 仅同一自有根窗口的严格回读形成前台信用，系统调用返回值单独留作诊断。
    insist(['ALREADY_OWNED', 'EXACT_ROOT_ESTABLISHED'].includes(ack.reason) && ack.foregroundNull === false
      && ack.ownerIsBoundMain === true && ack.exactRoot === true
      && (ack.reason === 'ALREADY_OWNED' ? ack.callReturnedTrue === null : typeof ack.callReturnedTrue === 'boolean'),
    'UI_NVDA_OWNED_FOREGROUND_REJECTED');
    insist(Date.now() <= deadline, 'UI_NVDA_OWNED_FOREGROUND_TIMEOUT');
    return ack;
  } catch (error) {
    try {
      const pending = path.join(directory, 'collector-foreground.json');
      if (request && fs.existsSync(pending) && same(JSON.parse(fs.readFileSync(pending, 'utf8')), request)) {
        // 只撤销本次尚未消费的命令，保留原字节并避免超时后迟到激活。
        const cancelled = path.join(directory, `collector-foreground-cancelled-${request.nonce}-${randomUUID()}.json`);
        insist(!fs.existsSync(cancelled), 'UI_NVDA_OWNED_FOREGROUND_HISTORY_EXISTS');
        fs.renameSync(pending, cancelled);
      }
    } catch (cancelError) { logFailure(writer, 'v16.ui_screen_reader_foreground_cancel_failed', cancelError, { pid, nodeSequence }); }
    assertActive();
    throw new Error('UI_NVDA_OWNED_FOREGROUND_NOT_ESTABLISHED', { cause: error });
  }
}
async function openNvdaObserver({ executablePath, directory, writer, rendererPid, runtime, storeContext,
  nativeLaunchKind = 'v16-nfr-native-launch', timeoutMs = 30000, root = process.cwd(), sourceIdentity, captionProtocol = OWNED_CAPTION_PROTOCOL, accessibilityProtocol = OWNED_ACCESSIBILITY_PROTOCOL }) {
  insist(process.platform === 'win32', 'UI_SCREEN_READER_WINDOWS_REQUIRED');
  insist(Number.isSafeInteger(rendererPid) && rendererPid > 0, 'UI_NVDA_SINGLE_RENDERER_PID_REQUIRED');
  insist(['v16-nfr-native-launch', 'v16-package-ui-native-launch'].includes(nativeLaunchKind), 'UI_NVDA_PROVIDER_TRUSTED_NATIVE_LAUNCH_KIND_REQUIRED');
  const openDeadline = Date.now() + timeoutMs;
  validateOwnedCaptionProtocol(captionProtocol);
  const trustedRuntime = captureTrustedWindowsRuntime(undefined, { spawnSync: (file, args, options = {}) => {
    const remaining = openDeadline - Date.now(); insist(remaining > 0, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
    return spawnSync(file, args, { ...options, timeout: Math.min(options.timeout ?? remaining, remaining) });
  } });
  insist(runtime?.launch?.receipt && storeContext, 'UI_NVDA_PROVIDER_NATIVE_RUNTIME_REQUIRED');
  const nativeLaunchRef = runtime.launch.receipt, nativeLaunch = readBound(nativeLaunchRef).json();
  const snapshot = await bounded(() => runtimeSnapshot(runtime), openDeadline);
  insist(snapshot.renderer.pid === rendererPid && same(snapshot.storeContext, storeContext), 'UI_NVDA_PROVIDER_CURRENT_RUNTIME_CHANGED');
  const binding = bindingFromSnapshot(snapshot, nativeLaunchRef, nativeLaunch, randomUUID());
  validateProviderBinding(binding, nativeLaunch, { pid: runtime.identity.pid, packageIdentity: nativeLaunch.packageIdentity, nativeLaunchRef,
    nativeLaunchKind });
  const exe = directPath(path.resolve(executablePath)).path;
  insist(path.basename(exe).toLowerCase() === 'nvda.exe', 'UI_NVDA_ACTUAL_EXECUTABLE_REQUIRED');
  const queryRemaining = openDeadline - Date.now(); insist(queryRemaining > 0, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
  const existing = execFileSync('powershell.exe', ['-NoProfile', '-Command', "@(Get-Process -Name nvda -ErrorAction SilentlyContinue).Count"],
    { encoding: 'utf8', windowsHide: true, timeout: queryRemaining }).trim();
  insist(existing === '0', 'UI_EXISTING_SCREEN_READER_MUST_BE_PRESERVED');
  insist(!fs.existsSync(directory), 'UI_SCREEN_READER_NEW_CONFIGURATION_REQUIRED');
  const ownedAccessibility = await setupOwnedAccessibility({ runtime, binding, nativeLaunch,
    sourceIdentity, deadline: openDeadline, writer, protocol: accessibilityProtocol });
  fs.mkdirSync(path.join(directory, 'scratchpad/globalPlugins'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'v16-nvda-speech-observer.py'), path.join(directory, 'scratchpad/globalPlugins/amazonEvidence.py'));
  fs.writeFileSync(path.join(directory, 'collector-target.json'), JSON.stringify(binding), { flag: 'wx' });
  fs.writeFileSync(path.join(directory, 'nvda.ini'), '[general]\nshowWelcomeDialogAtStartup = False\naskedAllowUsageStats = True\nsaveConfigurationOnExit = False\nconfirmExit = False\n[update]\nautoCheck = False\nstartupNotification = False\n[development]\nenableScratchpadDir = True\n[speech]\nsynth = espeak\n[keyboard]\nkeyboardLayout = desktop\nNVDAModifierKeys = 4\nhandleInjectedKeys = True\n');
  const rawFile = path.join(directory, 'actual-speech.jsonl'), logFile = path.join(directory, 'nvda.log');
  const child = spawn(exe, ['--config-path=' + directory, '--log-file=' + logFile, '--minimal', '--no-sr-flag', '--lang=zh_CN'], { windowsHide: true, stdio: 'ignore' });
  let startError, exitEvent, closeEvent, earlyExit, stopRequested = false, stopRequest = null, stopDeadline = null, sessionFailure = null;
  let exitObservedAtMs = null, closeObservedAtMs = null;
  child.once('error', error => { startError = error; logFailure(writer, 'v16.ui_screen_reader_child_failed', error, { pid: child.pid }); });
  const exited = () => {
    if (!stopRequested && !earlyExit) {
      earlyExit = new Error('UI_NVDA_EXITED_BEFORE_OWNED_STOP');
      logFailure(writer, 'v16.ui_screen_reader_early_exit_failed', earlyExit, { pid: child.pid });
    }
  };
  child.once('exit', (code, signal) => { exitObservedAtMs = Date.now(); exitEvent = { code, signal }; exited(); });
  child.once('close', (code, signal) => { closeObservedAtMs = Date.now(); closeEvent = { code, signal }; exited(); });
  let cleanupPromise;
  const close = () => {
    cleanupPromise ??= closeOwnedReader();
    return cleanupPromise;
  };
  function requestOwnedStop() {
    if (stopRequested) return;
    insist(Number.isSafeInteger(child.pid) && child.pid > 0 && !exitEvent && !closeEvent
      && child.exitCode === null && child.signalCode === null && !earlyExit && !startError, 'UI_NVDA_EXITED_BEFORE_OWNED_STOP');
    const requestedAt = Date.now();
    stopRequest = { command: 'stop', runToken: binding.runToken, nonce: randomUUID(), pid: child.pid, requestedAt: new Date(requestedAt).toISOString() };
    stopDeadline = requestedAt + 15000;
    fs.writeFileSync(path.join(directory, 'collector-stop.json'), JSON.stringify(stopRequest), { flag: 'wx' });
    stopRequested = true;
  }
  function completedWithinStopDeadline() {
    const startedAt = Date.parse(stopRequest?.requestedAt);
    return Boolean(exitEvent && closeEvent) && Number.isFinite(startedAt) && Number.isFinite(stopDeadline)
      && [exitObservedAtMs, closeObservedAtMs].every(value => Number.isFinite(value) && value >= startedAt && value <= stopDeadline);
  }
  async function closeOwnedReader() {
    let failure = earlyExit || startError, forced = false, stopAck = null;
    try {
      // 节点失败立即发出自有 STOP；关闭校验沿用发出时的原十五秒截止。
      requestOwnedStop();
      insist(!failure, 'UI_NVDA_EXITED_BEFORE_OWNED_STOP');
      const deadline = stopDeadline;
      const readStopState = () => {
        if (startError) throw startError;
        const file = path.join(directory, 'collector-stop-ack.json');
        if (fs.existsSync(file)) stopAck = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Boolean(exitEvent && closeEvent);
      };
      // 迟调关闭只核对已观察事件；未完成时不得在原截止后重开等待窗口。
      if (!readStopState()) {
        const remaining = deadline - Date.now();
        insist(remaining > 0, 'UI_NVDA_OWNED_STOP_TIMEOUT');
        await until(readStopState, Boolean, remaining, 'UI_NVDA_OWNED_STOP_TIMEOUT');
      }
      insist(completedWithinStopDeadline(), 'UI_NVDA_OWNED_STOP_TIMEOUT');
      insist(stopAck && same(Object.keys(stopAck).sort(), ['kind', 'schemaVersion', 'runToken', 'nonce', 'pid', 'timestamp'].sort())
        && stopAck.kind === 'nvda-observer-stop-ack' && stopAck.schemaVersion === 1 && stopAck.runToken === binding.runToken
        && stopAck.nonce === stopRequest.nonce && stopAck.pid === child.pid && Number.isFinite(Date.parse(stopAck.timestamp))
        && Date.parse(stopAck.timestamp) >= Date.parse(stopRequest.requestedAt) && Date.parse(stopAck.timestamp) <= deadline,
      'UI_NVDA_OWNED_STOP_ACK_REQUIRED');
    } catch (error) {
      failure ??= error; logFailure(writer, 'v16.ui_screen_reader_owned_stop_failed', error, { pid: child.pid });
      try {
        const deadline = Date.now() + 15000;
        if (!exitEvent && !closeEvent && Number.isSafeInteger(child.pid) && child.pid > 0) {
          // 仅回收本次缓存的子进程；强制退出永远不能形成正常退出信用。
          forced = true; insist(child.kill('SIGKILL') === true, 'UI_NVDA_OWNED_KILL_FAILED');
        }
        if (child.pid) await until(() => Boolean(exitEvent && closeEvent), Boolean,
          Math.max(1, deadline - Date.now()), 'UI_NVDA_OWNED_CLOSE_NOT_CONFIRMED');
      } catch (cleanupError) { logFailure(writer, 'v16.ui_screen_reader_owned_cleanup_failed', cleanupError, { pid: child.pid }); }
    }
    try {
      // 独立原件保留宿主观察时刻，不改变既有退出事件对象的精确键。
      writer.json('screen-reader/stop-timing.json', { kind: 'v16-nvda-owned-stop-timing', schemaVersion: 1, formalCredit: false,
        pid: child.pid ?? null, runToken: binding.runToken, nonce: stopRequest?.nonce ?? null, requestedAt: stopRequest?.requestedAt ?? null,
        deadlineAt: stopDeadline === null ? null : new Date(stopDeadline).toISOString(),
        exitObservedAt: exitObservedAtMs === null ? null : new Date(exitObservedAtMs).toISOString(),
        closeObservedAt: closeObservedAtMs === null ? null : new Date(closeObservedAtMs).toISOString(),
        completedWithinOriginalDeadline: completedWithinStopDeadline() });
    } catch (error) {
      failure ??= error; logFailure(writer, 'v16.ui_screen_reader_stop_timing_failed', error, { pid: child.pid });
    }
    const receipt = { pid: child.pid ?? null, exited: Boolean(exitEvent), closed: Boolean(closeEvent), forced, stopRequested,
      stopRequest, stopAck, earlyExit: Boolean(earlyExit), exitCode: child.exitCode, signalCode: child.signalCode,
      exitEvent: exitEvent ?? null, closeEvent: closeEvent ?? null,
      raw: fs.existsSync(rawFile) ? fileRecord(rawFile) : null,
      diagnostic: fs.existsSync(logFile) ? fileRecord(logFile) : null };
    writer.json('screen-reader/cleanup.json', receipt);
    if (failure) throw failure;
    insist(receipt.closed && !forced && !earlyExit && stopRequested && stopAck && exitEvent.code === 0 && exitEvent.signal === null
      && closeEvent.code === 0 && closeEvent.signal === null,
      'UI_NVDA_NORMAL_OWNED_CLOSE_REQUIRED');
    assertNvdaNormalExit(receipt);
    return receipt;
  }
  try {
    insist(openDeadline > Date.now(), 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
    const rows = await until(() => {
      if (startError) throw startError;
      insist(child.exitCode === null && child.signalCode === null, 'UI_NVDA_EXITED_BEFORE_READY');
      return readSpeech(rawFile);
    },
      rows => rows.some(row => row.kind === 'nvda-observer-ready'), Math.max(1, openDeadline - Date.now()), 'UI_NVDA_OBSERVER_NOT_LOADED');
    const ready = rows.find(row => row.kind === 'nvda-observer-ready');
    insist(ready.pid === child.pid && ready.engine === 'NVDA' && typeof ready.version === 'string', 'UI_NVDA_PROCESS_IDENTITY_MISMATCH');
    validateProviderReady(ready, binding, child.pid);
    const accessibilityReady = await observeOwnedAccessibility(ownedAccessibility, { runtime, binding, writer, assertActive() {
      if (startError || earlyExit) throw startError || earlyExit;
      insist(!stopRequested && !cleanupPromise && child.exitCode === null && child.signalCode === null, 'UI_NVDA_EXITED_BEFORE_READY');
    } });
    // 插件装载就绪不等于初始焦点已处理；只接受官方启动通知产生的本次独立原件。
    insist(openDeadline > Date.now(), 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
    const startupFile = path.join(directory, 'nvda-startup-complete.json');
    const startupComplete = await bounded(() => until(() => {
      if (startError) throw startError;
      insist(child.exitCode === null && child.signalCode === null && !earlyExit, 'UI_NVDA_EXITED_BEFORE_STARTUP_COMPLETE');
      if (!fs.existsSync(startupFile)) return null;
      const value = readBound(fileRecord(startupFile)).json();
      const fields = ['kind', 'schemaVersion', 'engine', 'version', 'pid', 'runToken', 'binding', 'startupSource', 'timestamp'];
      const at = Date.parse(value?.timestamp), now = Date.now();
      insist(value && typeof value === 'object' && !Array.isArray(value)
        && same(Object.keys(value).sort(), fields.sort()) && value.kind === 'nvda-observer-startup-complete'
        && value.schemaVersion === 1 && value.engine === 'NVDA' && value.version === ready.version
        && value.pid === child.pid && value.runToken === binding.runToken && same(value.binding, binding)
        && value.startupSource === 'core.postNvdaStartup' && typeof value.timestamp === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.timestamp)
        && Number.isFinite(at) && new Date(at).toISOString() === value.timestamp
        && at >= openDeadline - timeoutMs && at >= Date.parse(ready.timestamp) && at <= now && now <= openDeadline,
      'UI_NVDA_STARTUP_COMPLETE_INVALID');
      return value;
    }, Boolean, Math.max(1, openDeadline - Date.now()), 'UI_NVDA_STARTUP_NOT_COMPLETE'), openDeadline);
    const startupCompleteRef = writer.copy('screen-reader/startup-complete.json', fileRecord(startupFile));
    insist(same(readBound(startupCompleteRef).json(), startupComplete), 'UI_NVDA_STARTUP_COMPLETE_CHANGED');
    insist(Date.now() <= openDeadline, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
    const startupValidation = { passed: true, hostObservedAt: new Date().toISOString(), eventTimestamp: startupComplete.timestamp,
      openDeadlineAt: new Date(openDeadline).toISOString(), original: startupCompleteRef };
    // 一次 setup 与每个节点的原十秒采集分开计时；失败沿原 owned STOP/close 回收。
    const captionSetup = await activateOwnedCaption({ runtime, writer, binding, nativeLaunch, nativeLaunchRef, root,
      protocol: captionProtocol, trustedRuntime, sourceIdentity: sourceIdentity ?? nativeLaunch.sourceIdentity });
    insist(captionSetup.passed && captionSetup.receipt, 'UI_CAPTION_SETUP_REQUIRED');
    const launch = { kind: 'v16-nvda-observer-launch', schemaVersion: 1, executable: fileRecord(exe), observer: fileRecord(path.join(__dirname, 'v16-nvda-speech-observer.py')),
      ready, startupComplete, startupCompleteRef, startupValidation, binding, speechProtocol: SPEECH_PROTOCOL, nativeLaunch: nativeLaunchRef, runtimeSnapshot: snapshot, rendererPid, configDirectory: directory, noSystemScreenReaderFlag: true, portable: true, captionSetup: captionSetup.receipt, accessibilitySupport: { setup: ownedAccessibility.receipt,
        ready: accessibilityReady, cleanupBoundary: OWNED_ACCESSIBILITY_PROTOCOL.cleanupBoundary } };
    const receipt = writer.json('screen-reader/launch.json', launch), seenNonces = new Set(), sequenceState = new Map();
    let sequence = 0;
    return { ready, receipt, rawFile, close, binding,
      get sessionFailure() { return sessionFailure; },
      async capture(runtime, locator, node, timeout = 10000) {
        const startedMs = Date.now(), startedAt = new Date(startedMs).toISOString(), deadline = startedMs + timeout, nodeSequence = ++sequence;
        insist(Number.isFinite(timeout) && timeout > 0 && timeout <= 10000, 'UI_NVDA_ORIGINAL_NODE_BUDGET_REQUIRED');
        const phaseContext = { pid: child.pid, runToken: binding.runToken, nodeSequence, nodeId: String(node.id).slice(0, 128),
          nonce: null, startedAt, deadlineAt: new Date(deadline).toISOString() };
        try {
          if (sessionFailure) throw new Error('UI_NVDA_CAPTURE_SESSION_UNUSABLE', { cause: sessionFailure });
          insist(!stopRequested && !cleanupPromise, 'UI_NVDA_CAPTURE_SESSION_CLOSED');
          await bounded(() => runtime.app.evaluate(({ BrowserWindow }, id) => {
            const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
            if (windows.length !== 1 || windows[0].id !== id) throw new Error('UI_NVDA_OWNED_WINDOW_CHANGED');
            windows[0].show(); windows[0].focus();
          }, binding.window.id), deadline);
          const foregroundSnapshot = await bounded(() => runtimeSnapshot(runtime), deadline);
          insist(same(bindingFromSnapshot(foregroundSnapshot, nativeLaunchRef, nativeLaunch, binding.runToken), binding),
            'UI_NVDA_PROVIDER_CURRENT_RUNTIME_CHANGED');
          const foregroundAck = await ensureOwnedForeground({ directory, binding, pid: child.pid, nodeSequence, startedAt, deadline, writer,
            assertActive() {
              if (startError || earlyExit) throw startError || earlyExit;
              insist(child.exitCode === null && child.signalCode === null, 'UI_NVDA_EXITED_DURING_CAPTURE');
            } });
          const assertNativeActive = () => {
            if (startError || earlyExit) throw startError || earlyExit;
            insist(!stopRequested && child.exitCode === null && child.signalCode === null, 'UI_NVDA_EXITED_DURING_CAPTURE');
          };
          const focusMode = await bounded(() => readNativeFocusMode(locator, node, { deadline, assertActive: assertNativeActive, writer }), deadline);
          const request = { sequence: nodeSequence, nonce: randomUUID(), nodeId: node.id, name: node.name, role: node.role,
            rawOffset: readSpeech(rawFile).length, startedAt, deadlineAt: new Date(deadline).toISOString() };
          insist(request.nonce !== foregroundAck.nonce, 'UI_NVDA_OWNED_FOREGROUND_NONCE_REUSED');
          const temporary = path.join(directory, `collector-node-${sequence}.tmp`);
          fs.writeFileSync(temporary, JSON.stringify({ runToken: binding.runToken, request, focusMode: focusMode.mode }), { flag: 'wx' });
          fs.renameSync(temporary, path.join(directory, 'collector-node.json'));
          phaseContext.nonce = request.nonce;
          phaseContext.focusMode = focusMode.mode;
          const focusModeRef = writer.json('screen-reader/focus-mode-' + nodeSequence + '.json', { kind: 'v16-nvda-focus-mode', schemaVersion: 1,
            formalCredit: false, binding, request, ...focusMode });
          capturePhase(writer, phaseContext, 'armed');
          // 首次真实焦点事件前原子布防；后续真实 Tab 和回焦仍走原有时间与身份门。
          await bounded(() => runFocusPhase({ runtime, locator, node, focusMode: focusMode.mode, phase: 'first-focus', action: () => locator.focus(),
            directory, binding, pid: child.pid, request, deadline, writer, assertActive() {
              if (startError || earlyExit) throw startError || earlyExit;
              insist(!stopRequested && child.exitCode === null && child.signalCode === null, 'UI_NVDA_EXITED_DURING_CAPTURE');
            } }), deadline);
          capturePhase(writer, phaseContext, 'first-focus-completed');
          const hostBefore = await bounded(() => currentNode(runtime, locator, node, binding, nativeLaunch, { deadline, assertActive: assertNativeActive, writer }), deadline);
          capturePhase(writer, phaseContext, 'host-before-completed');
          await bounded(() => runFocusPhase({ runtime, locator, node, focusMode: focusMode.mode, phase: 'tab', action: () => runNativeKeys({ runtime, directory, binding, pid: child.pid, request, phase: 'tab', focusMode: focusMode.mode, deadline, writer, assertActive: assertNativeActive }),
            directory, binding, pid: child.pid, request, deadline, writer, assertActive() {
              if (startError || earlyExit) throw startError || earlyExit;
              insist(!stopRequested && child.exitCode === null && child.signalCode === null, 'UI_NVDA_EXITED_DURING_CAPTURE');
            } }), deadline);
          capturePhase(writer, phaseContext, 'tab-completed');
          const returnWithNativeKeys = async () => {
            insist(same(await readNativeFocusMode(locator, node, { deadline, assertActive: assertNativeActive, writer }), focusMode), 'UI_NVDA_NATIVE_FOCUS_MODE_CHANGED');
            await runNativeKeys({ runtime, directory, binding, pid: child.pid, request, phase: 'target-focus', focusMode: focusMode.mode,
              deadline, writer, assertActive: assertNativeActive });
          };
          if (focusMode.mode === 'named-dialog-container') {
            await bounded(() => runFocusPhase({ runtime, locator, node, phase: 'target-handoff', focusMode: focusMode.mode,
              action: returnWithNativeKeys, directory, binding, pid: child.pid, request, deadline, writer, assertActive: assertNativeActive }), deadline);
            capturePhase(writer, phaseContext, 'target-handoff-completed');
          }
          await bounded(() => runFocusPhase({ runtime, locator, node, phase: 'target-focus', focusMode: focusMode.mode,
            action: focusMode.mode === 'named-dialog-container' ? async () => {
              insist(same(await readNativeFocusMode(locator, node, { deadline, assertActive: assertNativeActive, writer }), focusMode), 'UI_NVDA_NATIVE_FOCUS_MODE_CHANGED');
              assertNativeActive(); insist(Date.now() < deadline, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
              await locator.focus();
            } : returnWithNativeKeys, directory, binding, pid: child.pid, request, deadline, writer, assertActive: assertNativeActive }), deadline);
          capturePhase(writer, phaseContext, 'target-focus-completed');
          let inputReceiptRef, inputReceipt, speechBefore = hostBefore;
          const speechSource = { schemaVersion: SPEECH_PROTOCOL.schemaVersion, method: SPEECH_PROTOCOL.automaticMethod,
            focusMode: focusMode.mode, focusModeReceipt: focusModeRef, input: null, focusBefore: null };
          if (focusMode.mode === 'named-dialog-container') {
            insist(same(await readNativeFocusMode(locator, node, { deadline, assertActive: assertNativeActive, writer }), focusMode), 'UI_NVDA_NATIVE_FOCUS_MODE_CHANGED');
            speechBefore = await bounded(() => currentNode(runtime, locator, node, binding, nativeLaunch,
              { deadline, assertActive: assertNativeActive, writer }), deadline);
            // 最终焦点完成后固定一次真实朗读手势，不等待失败或超时后补发。
            await bounded(() => runNativeKeys({ runtime, directory, binding, pid: child.pid, request,
              phase: 'report-focus', focusMode: focusMode.mode, deadline, assertActive: assertNativeActive,
              writer: { log: (...args) => writer.log(...args), json(label, value) {
                const reference = writer.json(label, value);
                insist(label === 'screen-reader/native-keys-' + nodeSequence + '-report-focus.json', 'UI_NVDA_REPORT_FOCUS_RECEIPT_INVALID');
                inputReceiptRef = reference; inputReceipt = value; return reference;
              } } }), deadline);
            insist(inputReceiptRef && inputReceipt, 'UI_NVDA_REPORT_FOCUS_RECEIPT_REQUIRED');
            Object.assign(speechSource, { method: SPEECH_PROTOCOL.namedDialogMethod, input: inputReceiptRef, focusBefore: speechBefore });
            capturePhase(writer, phaseContext, 'report-focus-completed');
          }
          writer.json('screen-reader/speech-source-' + nodeSequence + '.json', { kind: 'v16-nvda-speech-source',
            schemaVersion: 1, formalCredit: false, binding, request, source: speechSource });
          const sourceRows = rows => inputReceipt
            ? rows.filter(row => Date.parse(row.timestamp) >= Date.parse(inputReceipt.ack.result.steps[1].beforeInputAt)) : rows;
          capturePhase(writer, phaseContext, 'wait-started');
          const speechBracket = await waitForBracketedSpeech({ binding, ready, request, node, hostBefore: speechBefore,
            read: () => {
              if (startError || earlyExit) throw startError || earlyExit;
              insist(child.exitCode === null && child.signalCode === null, 'UI_NVDA_EXITED_DURING_CAPTURE');
              return readSpeech(rawFile);
            },
            wait: (read, predicate) => bounded(() => until(() => {
              const value = read(); return inputReceipt ? { ...value, matching: sourceRows(value.matching) } : value;
            }, predicate,
              Math.max(1, deadline - Date.now()), 'UI_NVDA_SPOKEN_NODE_NOT_OBSERVED'), deadline) });
          capturePhase(writer, phaseContext, 'wait-completed');
          const hostAfter = await bounded(() => currentNode(runtime, locator, node, binding, nativeLaunch, { deadline, assertActive: assertNativeActive, writer }), deadline);
          const rawSpeech = writer.copy(`screen-reader/raw-${sequence}.jsonl`, fileRecord(rawFile));
          const rawRows = readBound(rawSpeech).bytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
          const selected = selectBracketedSpeech(rawRows, { binding, ready, request, node, hostBefore: speechBefore, hostAfter, expectedPrefix: speechBracket.rawRows });
          const matching = sourceRows(selected.matching);
          insist(matching.length > 0, 'UI_NVDA_ACTUAL_SPOKEN_TEXT_REQUIRED');
          const providerWitness = { binding, ready, nativeLaunch: nativeLaunchRef, readerLaunch: receipt, rawSpeech, request, hostBefore, hostAfter, speechSource };
          const spoken = matching.map(row => row.spoken).join(' ');
          validateProviderObservation(providerWitness, matching, node, { nativeLaunch: readBound(nativeLaunchRef).json(), readerLaunch: readBound(receipt).json(), rawRows,
            focusModeReceipt: readBound(focusModeRef).json(), focusModeReceiptRef: focusModeRef,
            inputReceipt: inputReceiptRef ? readBound(inputReceiptRef).json() : undefined, inputReceiptRef,
            expected: { pid: runtime.identity.pid, packageIdentity: nativeLaunch.packageIdentity, nativeLaunchRef, readerLaunchRef: receipt,
              nativeLaunchKind },
            execution: { startedAt, finishedAt: new Date().toISOString() }, spoken, seenNonces, sequenceState });
          insist(Date.now() <= deadline, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
          return { nodeId: node.id, engine: { name: 'NVDA', version: ready.version }, rows: matching, observedAt: matching.at(-1).timestamp, providerWitness };
        } catch (error) {
          sessionFailure ??= error;
          try { requestOwnedStop(); }
          catch (cleanupError) { logFailure(writer, 'v16.ui_screen_reader_failure_stop_failed', cleanupError, { pid: child.pid, nodeId: node.id }); }
          capturePhase(writer, phaseContext, 'capture-failed', error);
          logFailure(writer, 'v16.ui_screen_reader_capture_failed', error, { pid: child.pid, nodeId: node.id }); throw error;
        }
      },
    };
  } catch (error) {
    logFailure(writer, 'v16.ui_screen_reader_failed', error, { pid: child.pid });
    try { await close(); } catch (cleanupError) { logFailure(writer, 'v16.ui_screen_reader_cleanup_failed', cleanupError, { pid: child.pid }); }
    throw error;
  }
}
function assertNvdaNormalExit(receipt) {
  insist(receipt.exited && receipt.exitCode === 0 && receipt.signalCode === null, 'UI_NVDA_NORMAL_EXIT_NOT_CONFIRMED');
}
module.exports = { readSpeech, until, openNvdaObserver, assertNvdaNormalExit };
