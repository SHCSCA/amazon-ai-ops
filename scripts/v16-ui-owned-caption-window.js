const { createCaptionArtifacts } = require('./v16-ui-owned-caption-artifacts');
const c = createCaptionArtifacts();
async function bounded(action, deadline) {
  let timer;
  try {
    const remaining = deadline - Date.now(); c.assert.ok(remaining > 0, 'UI_CAPTION_SETUP_DEADLINE');
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('UI_CAPTION_SETUP_DEADLINE')), remaining);
    })]);
  } finally { clearTimeout(timer); }
}
async function topmost(runtime, expected, held, token, mode, deadline) {
  return bounded(() => runtime.app.evaluate(async ({ app, BrowserWindow }, request) => {
    const { expected, held, token, mode, deadline } = request;
    const same = (a, b) => String(a).replaceAll('\\', '/').toLowerCase() === String(b).replaceAll('\\', '/').toLowerCase();
    const key = Symbol.for('amazon-ai-ops.v16.caption-topmost.' + token);
    let window, state;
    const identify = () => {
      const windows = BrowserWindow.getAllWindows().filter(value => !value.isDestroyed());
      if (process.pid !== expected.pid || !app.isPackaged || !same(process.execPath, expected.exe)
        || !same(app.getAppPath(), expected.appRoot) || !same(app.getPath('userData'), expected.profile)
        || windows.length !== 1 || windows[0].id !== expected.windowId
        || windows[0].webContents.getOSProcessId() !== expected.rendererPid || window && windows[0] !== window)
        throw new Error('UI_CAPTION_RUNTIME_CHANGED');
      const current = windows[0], handle = current.getNativeWindowHandle();
      if (![4, 8].includes(handle.length)) throw new Error('UI_CAPTION_HANDLE_SIZE');
      const rootHwnd = (handle.length === 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString();
      if (rootHwnd !== expected.rootHwnd || held.pid !== process.pid || !held.ownerToken || !held.handleCreationTimeUtc)
        throw new Error('UI_CAPTION_HELD_WINDOW_CHANGED');
      return { window: current, rootHwnd };
    };
    const first = identify(); window = first.window;
    const rootHwnd = first.rootHwnd, deadlineError = mode === 'apply' ? 'UI_CAPTION_SETUP_DEADLINE' : 'UI_CAPTION_RESTORE_DEADLINE';
    const validateState = () => {
      identify();
      if (window[key] !== state || state.token !== token || state.ownerToken !== held.ownerToken
        || state.birth !== held.handleCreationTimeUtc || state.rootHwnd !== rootHwnd || state.original !== original)
        throw new Error('UI_CAPTION_TOPMOST_SESSION_CHANGED');
      if (state.closed !== (mode === 'restore')) throw new Error(mode === 'apply'
        ? 'UI_CAPTION_TOPMOST_SESSION_ALREADY_CLOSED' : 'UI_CAPTION_TOPMOST_SESSION_CHANGED');
      if (Date.now() >= deadline) throw new Error(deadlineError);
    };
    if (mode === 'apply') {
      if (Date.now() >= deadline) throw new Error(deadlineError);
      if (window[key]) throw new Error('UI_CAPTION_TOPMOST_SESSION_ALREADY_CLOSED');
      // 无法读取原层级；只接受原本非置顶窗口，避免恢复时覆盖未知层级。
      const original = window.isAlwaysOnTop();
      if (original !== false) throw new Error('UI_CAPTION_ORIGINAL_TOPMOST_UNSUPPORTED');
      state = window[key] = { token, ownerToken: held.ownerToken, birth: held.handleCreationTimeUtc,
        rootHwnd, original, closed: false };
      window.setAlwaysOnTop(true, 'pop-up-menu'); window.show(); window.moveTop();
    } else {
      if (mode !== 'restore' || Date.now() >= deadline) throw new Error('UI_CAPTION_RESTORE_DEADLINE');
      state = window[key];
      if (state && (state.token !== token || state.ownerToken !== held.ownerToken
        || state.birth !== held.handleCreationTimeUtc || state.rootHwnd !== rootHwnd))
        throw new Error('UI_CAPTION_TOPMOST_SESSION_CHANGED');
      if (!state) state = window[key] = { token, ownerToken: held.ownerToken, birth: held.handleCreationTimeUtc,
        rootHwnd, original: null, closed: true };
      else {
        // 恢复先封闭令牌，迟到的 apply 在下一次观察时只能失败，不能再次修改窗口。
        state.closed = true;
        if (typeof state.original === 'boolean') {
          if (state.original !== false) throw new Error('UI_CAPTION_ORIGINAL_TOPMOST_UNSUPPORTED');
          window.setAlwaysOnTop(false);
        }
      }
    }
    const original = state.original, desired = mode === 'apply' ? true : original;
    validateState();
    let observed = window.isAlwaysOnTop();
    while (typeof desired === 'boolean' && observed !== desired) {
      await new Promise(resolve => setTimeout(resolve, 0));
      validateState();
      observed = window.isAlwaysOnTop();
    }
    validateState();
    return { pid: process.pid, windowId: window.id, rendererPid: window.webContents.getOSProcessId(), rootHwnd,
      visible: window.isVisible(), alwaysOnTopBefore: state.original, alwaysOnTopAfter: observed,
      tokenClosed: state.closed, mode, sameMainConnection: true, observedAt: new Date().toISOString() };
  }, { expected, held, token, mode, deadline }), deadline);
}
module.exports = { topmost };
