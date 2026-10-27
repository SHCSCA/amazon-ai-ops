const { randomUUID } = require('node:crypto');
// 旧 reader 模型只替代新读取端口，实际 CDP 身份门由独立职责模型覆盖。
async function readAccessibleMode(locator) {
  return locator.evaluate(element => ({ id: element.getAttribute('data-v16-a11y-node'), tabIndex: element.tabIndex,
    role: element.getAttribute('role'), name: element.getAttribute('aria-label') || element.textContent,
    disabled: element.matches(':disabled'), inert: Boolean(element.closest('[inert]')) }));
}
async function readAccessibleCurrent(locator) {
  return locator.evaluate(element => ({ id: element.getAttribute('data-v16-a11y-node'), role: element.getAttribute('role'),
    name: element.getAttribute('aria-label') || element.textContent,
    activeElementId: document.activeElement?.getAttribute('data-v16-a11y-node') }));
}
async function readAccessibleFocus(page, context) {
  const probeNonce = randomUUID();
  return page.evaluate(request => {
    const startedAt = new Date().toISOString();
    const state = window.__amazonAiOpsDomFocus;
    if (!state || state.closed || state.nonce !== request.nonce || state.phase !== request.phase
      || state.deadline !== request.deadline || Date.now() > state.deadline) return null;
    const active = document.activeElement;
    if (!active) return null;
    const roles = { BUTTON: 'button', INPUT: 'textbox' };
    const finishedAt = new Date().toISOString();
    return { nonce: state.nonce, phase: state.phase, observedAt: finishedAt, rendererTiming: {
      kind: 'v16-dom-renderer-interval', schemaVersion: 1, clock: 'renderer-wall', probeNonce: request.probeNonce,
      nonce: state.nonce, phase: state.phase, targetId: state.target.getAttribute('data-v16-a11y-node'), startedAt, finishedAt,
    }, documentFocused: document.hasFocus(),
      targetConnected: state.target.isConnected, activeConnected: active.isConnected,
      sameTarget: active === state.target, sameBefore: active === state.before,
      targetId: state.target.getAttribute('data-v16-a11y-node'), name: active.getAttribute('aria-label') || active.textContent,
      role: active.getAttribute('role') || roles[active.tagName] || 'group' };
  }, { ...context, probeNonce });
}
module.exports = { readAccessibleMode, readAccessibleCurrent, readAccessibleFocus };
