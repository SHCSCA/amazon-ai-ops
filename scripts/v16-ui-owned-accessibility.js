const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { insist } = require('./v16-performance-artifacts');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

// 固定采集协议只作用于本次自有Main，清理边界是该Main的正常退出。
const REQUIRED_FEATURES = Object.freeze(['nativeAPIs', 'webContents', 'inlineTextBoxes', 'extendedProperties']);
const OWNED_ACCESSIBILITY_PROTOCOL = Object.freeze({ schemaVersion: 'v16.owned-app-accessibility/1',
  mode: 'native-tree-for-owned-reader', cleanupBoundary: 'owned-main-normal-exit', requiredFeatures: REQUIRED_FEATURES });
const sessions = new WeakMap();
function validateOwnedAccessibilityProtocol(value = OWNED_ACCESSIBILITY_PROTOCOL) {
  insist(same(value, OWNED_ACCESSIBILITY_PROTOCOL), 'UI_NVDA_APP_ACCESSIBILITY_PROTOCOL_REQUIRED');
  return OWNED_ACCESSIBILITY_PROTOCOL;
}
function logFailure(writer, event, error) {
  try { writer.log(event, error); }
  catch (loggingError) {
    try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_owned_accessibility_log_failed',
      { event, error: loggingError, originalError: error })) + '\n'); }
    catch { /* 日志出口故障仍保留首错。 */ }
  }
}
async function bounded(action, deadline) {
  let timer;
  const remaining = deadline - Date.now(); insist(remaining > 0, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED')), remaining);
  })]); } finally { clearTimeout(timer); }
}
function mainObservation({ app, BrowserWindow }, request) {
  const { expected, token, deadline, mode } = request;
  const key = Symbol.for('amazon-ai-ops.v16.owned-app-accessibility');
  const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
    && a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();
  let window;
  function identify() {
    if (Date.now() >= deadline) throw new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
    const windows = BrowserWindow.getAllWindows().filter(value => !value.isDestroyed()), metrics = app.getAppMetrics();
    if (!app.isPackaged || process.pid !== expected.pid || !samePath(process.execPath, expected.exe)
      || !samePath(app.getAppPath(), expected.appRoot) || !samePath(app.getPath('userData'), expected.profile)
      || windows.length !== 1 || windows[0].id !== expected.windowId || window && windows[0] !== window
      || windows[0].webContents.getOSProcessId() !== expected.rendererPid || windows[0].webContents.getURL() !== expected.url
      || metrics.find(value => value.pid === process.pid)?.creationTime !== expected.mainCreation
      || metrics.find(value => value.pid === expected.rendererPid)?.creationTime !== expected.rendererCreation)
      throw new Error('UI_NVDA_APP_ACCESSIBILITY_OWNER_CHANGED');
    const current = windows[0], handle = current.getNativeWindowHandle();
    if (![4, 8].includes(handle.length)) throw new Error('UI_NVDA_APP_ACCESSIBILITY_HANDLE_INVALID');
    const hwnd = (handle.length === 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString();
    if (hwnd !== expected.rootHwnd || !expected.ownerToken || !expected.birth)
      throw new Error('UI_NVDA_APP_ACCESSIBILITY_OWNER_CHANGED');
    return current;
  }
  window = identify();
  const read = () => {
    const enabled = app.isAccessibilitySupportEnabled(), features = app.getAccessibilitySupportFeatures();
    const allowed = ['nativeAPIs', 'webContents', 'inlineTextBoxes', 'extendedProperties', 'screenReader', 'html', 'labelImages', 'pdfPrinting'];
    if (typeof enabled !== 'boolean' || !Array.isArray(features) || features.length > allowed.length
      || new Set(features).size !== features.length || !features.every(value => allowed.includes(value)))
      throw new Error('UI_NVDA_APP_ACCESSIBILITY_STATE_INVALID');
    return { enabled, features: [...features] };
  };
  let before = null, state = window[key];
  if (mode === 'enable') {
    if (state) throw new Error('UI_NVDA_APP_ACCESSIBILITY_SESSION_EXISTS');
    before = read(); identify();
    if (Date.now() >= deadline) throw new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
    state = window[key] = { token, ownerToken: expected.ownerToken, birth: expected.birth, rootHwnd: expected.rootHwnd, setterCalls: 0 };
    // 此同步段不让出事件循环，迟到调用先由同一原截止和身份检查拒绝。
    state.setterCalls++; app.setAccessibilitySupportEnabled(true);
  } else if (mode !== 'observe') throw new Error('UI_NVDA_APP_ACCESSIBILITY_MODE_INVALID');
  identify();
  if (window[key] !== state || state?.token !== token || state.ownerToken !== expected.ownerToken
    || state.birth !== expected.birth || state.rootHwnd !== expected.rootHwnd || state.setterCalls !== 1)
    throw new Error('UI_NVDA_APP_ACCESSIBILITY_SESSION_CHANGED');
  const after = read(); identify();
  if (Date.now() >= deadline) throw new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
  return { mode, before, after, setterCalls: state.setterCalls, observedAt: new Date().toISOString() };
}
function active(session) {
  insist(Date.now() < session.deadline, 'UI_NVDA_OPERATION_DEADLINE_EXCEEDED'); session.assertActive();
  insist(same(session.binding, session.boundBinding), 'UI_NVDA_APP_ACCESSIBILITY_BINDING_CHANGED');
}
async function observe(session, mode) {
  active(session);
  const value = await bounded(() => {
    active(session);
    return session.runtime.app.evaluate(mainObservation, { expected: session.expected, token: session.token, deadline: session.deadline, mode });
  }, session.deadline);
  active(session);
  insist(value.mode === mode && value.setterCalls === 1 && value.after && typeof value.after.enabled === 'boolean',
    'UI_NVDA_APP_ACCESSIBILITY_OBSERVATION_INVALID');
  insist(value.after.enabled === true, 'UI_NVDA_APP_ACCESSIBILITY_ENABLE_NOT_CONFIRMED');
  insist(Array.isArray(value.after.features) && REQUIRED_FEATURES.every(feature => value.after.features.includes(feature)),
    'UI_NVDA_APP_ACCESSIBILITY_FEATURES_NOT_CONFIRMED');
  return value;
}
async function setupOwnedAccessibility({ runtime, binding, nativeLaunch, sourceIdentity, deadline, writer,
  protocol = OWNED_ACCESSIBILITY_PROTOCOL, assertActive = () => {} }) {
  try {
    const trustedProtocol = validateOwnedAccessibilityProtocol(protocol);
    insist(Number.isFinite(deadline) && binding?.main && binding.renderer && binding.window
      && nativeLaunch?.identity && runtime?.app, 'UI_NVDA_APP_ACCESSIBILITY_BINDING_REQUIRED');
    const held = nativeLaunch.verification?.mainExitObserver;
    insist(held?.pid === binding.main.pid && held.ownerToken === binding.main.ownerToken
      && held.handleCreationTimeUtc === binding.main.handleCreationTimeUtc, 'UI_NVDA_APP_ACCESSIBILITY_HELD_OWNER_REQUIRED');
    const session = { runtime, binding, boundBinding: JSON.parse(JSON.stringify(binding)), deadline, writer, assertActive, token: randomUUID(),
      expected: { pid: binding.main.pid, exe: binding.main.executablePath, profile: binding.main.userDataDir,
        appRoot: nativeLaunch.identity.appRoot, windowId: binding.window.id, rendererPid: binding.renderer.pid,
        mainCreation: nativeLaunch.identity.creationTime, rendererCreation: binding.renderer.creationTime, url: binding.window.url,
        rootHwnd: binding.window.rootHwnd, ownerToken: binding.main.ownerToken, birth: binding.main.handleCreationTimeUtc } };
    const observation = await observe(session, 'enable');
    const value = { kind: 'v16-owned-app-accessibility-setup', schemaVersion: 1, formalCredit: false, nativeFocusCredit: false,
      source: 'electron.app.setAccessibilitySupportEnabled', protocol: trustedProtocol, binding: session.boundBinding,
      nativeLaunch: binding.nativeLaunch, sourceIdentity: sourceIdentity ?? nativeLaunch.sourceIdentity ?? null,
      cleanupContract: { boundary: trustedProtocol.cleanupBoundary, mainPid: binding.main.pid,
        handleCreationTimeUtc: binding.main.handleCreationTimeUtc, ownerToken: binding.main.ownerToken,
        restoresExactFeatures: false, requiresNormalMainExit: true }, ...observation };
    const receipt = writer.json('screen-reader/app-accessibility-setup.json', value), handle = Object.freeze({ receipt });
    sessions.set(handle, session); return handle;
  } catch (error) { logFailure(writer, 'v16.ui_owned_accessibility_setup_failed', error); throw error; }
}
async function observeOwnedAccessibility(handle, { runtime, binding, writer, assertActive = () => {} }) {
  try {
    const session = sessions.get(handle);
    insist(session && session.runtime === runtime && same(session.boundBinding, binding), 'UI_NVDA_APP_ACCESSIBILITY_SESSION_REQUIRED');
    session.assertActive = assertActive;
    const observation = await observe(session, 'observe');
    return writer.json('screen-reader/app-accessibility-ready.json', { kind: 'v16-owned-app-accessibility-ready', schemaVersion: 1,
      formalCredit: false, nativeFocusCredit: false, setup: handle.receipt, binding: session.boundBinding, ...observation });
  } catch (error) { logFailure(writer, 'v16.ui_owned_accessibility_observe_failed', error); throw error; }
}
module.exports = { OWNED_ACCESSIBILITY_PROTOCOL, validateOwnedAccessibilityProtocol, setupOwnedAccessibility, observeOwnedAccessibility };
