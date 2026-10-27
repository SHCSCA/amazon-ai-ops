const { isDeepStrictEqual } = require('node:util');
const { performance } = require('node:perf_hooks');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const contracts = require('./package-ui-viewport-contract.cjs');

function logMotionNativeFailure(writer, event, error, context = {}) {
  try {
    if (writer?.log) writer.log(event, error, context);
    else process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', event, { ...context, error })) + '\n');
  } catch (loggingError) {
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_motion_native_log_failed',
      { event, error: loggingError, originalError: error })) + '\n'); }
    catch { /* 日志出口关闭时仍向调用方保留首错。 */ }
  }
}
function validateMotionOwner(owner) {
  const fields = ['electronVersion', 'mainCreationTime', 'mainPid', 'rendererCreationTime', 'rendererPid', 'url', 'windowId'];
  if (!owner || !isDeepStrictEqual(Object.keys(owner).sort(), fields)
    || !['mainPid', 'rendererPid', 'windowId'].every(field => Number.isSafeInteger(owner[field]) && owner[field] > 0)
    || owner.mainPid === owner.rendererPid
    || !['mainCreationTime', 'rendererCreationTime'].every(field => Number.isFinite(owner[field]) && owner[field] > 0)
    || typeof owner.electronVersion !== 'string' || !owner.electronVersion
    || typeof owner.url !== 'string' || !owner.url.startsWith('file:')) throw new Error('UI_MOTION_OWNER_INVALID');
  return owner;
}
async function accessMotionMain({ app, BrowserWindow, screen }, { owner, operation, kind, attemptId, viewport, minimum, restoreTimeoutMs, pollMs }) {
  const window = BrowserWindow.fromId(owner.windowId);
  function owned() {
    const metrics = app.getAppMetrics();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() || process.pid !== owner.mainPid
      || metrics.find(row => row.pid === process.pid)?.creationTime !== owner.mainCreationTime
      || window.webContents.getOSProcessId() !== owner.rendererPid
      || metrics.find(row => row.pid === owner.rendererPid)?.creationTime !== owner.rendererCreationTime
      || window.webContents.getURL() !== owner.url || process.versions.electron !== owner.electronVersion) {
      throw new Error('UI_MOTION_NATIVE_WINDOW_REQUIRED');
    }
  }
  async function snapshot() {
    owned();
    const renderer = await window.webContents.executeJavaScript('({url:location.href,innerWidth,innerHeight,devicePixelRatio})');
    owned();
    const bounds = window.getBounds(), contentBounds = window.getContentBounds();
    const [width, height] = window.getContentSize(), [minWidth, minHeight] = window.getMinimumSize();
    const [maxWidth, maxHeight] = window.getMaximumSize(), display = screen.getDisplayMatching(bounds);
    const handle = window.getNativeWindowHandle();
    if (![4, 8].includes(handle.length)) throw new Error('UI_MOTION_NATIVE_HANDLE_SIZE_INVALID');
    const hwnd = (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString();
    if (BigInt(hwnd) <= 0n) throw new Error('UI_MOTION_NATIVE_HANDLE_INVALID');
    const appMetrics = app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type,
      creationTime: metric.creationTime, ...(typeof metric.name === 'string' ? { name: metric.name } : {}) }))
      .sort((left, right) => left.pid - right.pid);
    return { ...owner, hwnd, nativeHandleBytes: handle.length, bounds, contentBounds, contentSize: { width, height },
      minimumSize: { width: minWidth, height: minHeight }, maximumSize: { width: maxWidth, height: maxHeight },
      zoomFactor: window.webContents.getZoomFactor(), maximized: window.isMaximized(), minimized: window.isMinimized(),
      fullScreen: window.isFullScreen(), visible: window.isVisible(), resizable: window.isResizable(),
      menuBarVisible: window.isMenuBarVisible(), menuBarAutoHide: window.isMenuBarAutoHide(),
      display: { id: display.id, scaleFactor: display.scaleFactor, bounds: display.bounds, workArea: display.workArea },
      forceDeviceScaleFactor: app.commandLine.getSwitchValue('force-device-scale-factor'),
      chromiumFeatureSwitches: { enabled: app.commandLine.getSwitchValue('enable-features'), disabled: app.commandLine.getSwitchValue('disable-features') },
      renderer, appMetrics, observedAt: new Date().toISOString() };
  }
  owned();
  if (operation === 'read') return snapshot();
  if (operation === 'zoom-reset') { window.webContents.setZoomFactor(1); return snapshot(); }
  if (operation !== 'resize' || !['125-percent', 'minimum-window'].includes(kind)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attemptId)) {
    throw new Error('UI_MOTION_RESIZE_REQUEST_INVALID');
  }
  const restoreDeadline = Date.now() + restoreTimeoutMs;
  if (window.isMaximized()) window.unmaximize();
  if (window.isFullScreen()) window.setFullScreen(false);
  while (window.isMaximized() || window.isFullScreen()) {
    owned();
    if (Date.now() >= restoreDeadline) throw new Error('UI_MOTION_NORMAL_WINDOW_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, restoreDeadline - Date.now())));
  }
  const before = await snapshot();
  if (before.maximized || before.fullScreen || before.minimized || !before.visible
    || before.minimumSize.width !== minimum.width || before.minimumSize.height !== minimum.height) {
    throw new Error('UI_MOTION_NORMAL_WINDOW_REQUIRED');
  }
  const zoomFactor = kind === '125-percent' ? 1.25 : 1;
  const request = kind === '125-percent' ? { method: 'setContentSize', width: viewport.width, height: viewport.height, animate: false }
    : { method: 'setSize', width: before.minimumSize.width - 1, height: before.minimumSize.height - 1, animate: false };
  const startedAt = new Date().toISOString();
  window.webContents.setZoomFactor(zoomFactor); owned();
  const setterStartedAt = new Date().toISOString();
  window[request.method](request.width, request.height, request.animate);
  const setterReturnedAt = new Date().toISOString(); owned();
  return { attemptId, kind, startedAt, before, request, zoomRequest: zoomFactor, setterStartedAt, setterReturnedAt,
    afterImmediate: await snapshot(), finishedAt: new Date().toISOString() };
}
async function invoke(electronApp, owner, operation, request, writer) {
  try {
    validateMotionOwner(owner);
    if (!electronApp || typeof electronApp.evaluate !== 'function') throw new Error('UI_MOTION_MAIN_REQUIRED');
    return await electronApp.evaluate(accessMotionMain, { owner, operation, ...request,
      viewport: contracts.PACKAGE_UI_VIEWPORT, minimum: contracts.PACKAGE_UI_MINIMUM_WINDOW,
      restoreTimeoutMs: contracts.PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS, pollMs: contracts.PACKAGE_UI_VIEWPORT_STATE_POLL_MS });
  } catch (error) { logMotionNativeFailure(writer, 'v16.ui_motion_main_failed', error, { operation }); throw error; }
}
const readMotionMain = (electronApp, owner, { writer } = {}) => invoke(electronApp, owner, 'read', {}, writer);
const resetMotionZoom = (electronApp, owner, { writer } = {}) => invoke(electronApp, owner, 'zoom-reset', {}, writer);
async function resizeMotionWindow(electronApp, owner, { kind, attemptId, writer } = {}) {
  return invoke(electronApp, owner, 'resize', { kind, attemptId }, writer);
}
const stableMotionMain = value => { const { observedAt, ...rest } = value; return rest; };
function sameMotionMain(left, right) {
  if (!isDeepStrictEqual(stableMotionMain(left), stableMotionMain(right))) throw new Error('UI_MOTION_MAIN_GEOMETRY_CHANGED');
}
async function settleMotionMain(electronApp, owner, { writer, dependencies = {} } = {}) {
  const now = dependencies.now || (() => performance.now());
  const wait = dependencies.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const read = dependencies.read || (() => readMotionMain(electronApp, owner, { writer }));
  const started = now(), deadline = started + contracts.PACKAGE_UI_VIEWPORT_RESTORE_TIMEOUT_MS, snapshots = [];
  let previous, stableSince;
  try {
    while (now() < deadline) {
      const snapshot = await read(); snapshots.push(snapshot);
      const same = previous && isDeepStrictEqual(stableMotionMain(previous), stableMotionMain(snapshot));
      if (!same) stableSince = now();
      if (now() >= deadline) break;
      if (same && now() - stableSince >= contracts.PACKAGE_UI_VIEWPORT_STABILITY_MS) {
        return { snapshots, elapsedMs: now() - started, stableForMs: now() - stableSince };
      }
      previous = snapshot;
      await wait(Math.min(contracts.PACKAGE_UI_VIEWPORT_STATE_POLL_MS, deadline - now()));
    }
    throw new Error('UI_MOTION_MAIN_GEOMETRY_NOT_STABLE');
  } catch (error) { logMotionNativeFailure(writer, 'v16.ui_motion_main_settle_failed', error); throw error; }
}
module.exports = { validateMotionOwner, readMotionMain, resizeMotionWindow, resetMotionZoom,
  stableMotionMain, sameMotionMain, settleMotionMain, logMotionNativeFailure };

