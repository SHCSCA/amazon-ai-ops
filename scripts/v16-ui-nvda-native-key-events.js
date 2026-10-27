const { insist } = require('./v16-performance-artifacts');
const { isDeepStrictEqual: same } = require('node:util');
async function bounded(action, deadline) {
  let timer;
  insist(Date.now() < deadline, 'UI_NVDA_NATIVE_KEYS_DOM_DEADLINE');
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('UI_NVDA_NATIVE_KEYS_DOM_DEADLINE')), Math.max(1, deadline - Date.now()));
  })]); } finally { clearTimeout(timer); }
}
async function armNativeKeyEvents(runtime, command, deadline) {
  await bounded(() => runtime.page.evaluate(request => {
    const key = '__amazonAiOpsNativeKeysEvent', prior = window[key];
    if (prior && !prior.closed) throw new Error('UI_NVDA_NATIVE_KEYS_DOM_PENDING');
    const state = { nonce: request.nonce, action: request.action, closed: false, keydownAt: null, keyupAt: null, completedAt: null, trusted: false };
    const matches = event => !state.closed && window[key] === state && Date.now() <= request.deadline
      && event.isTrusted === true && event.key === 'Tab' && event.code === 'Tab'
      && event.shiftKey === (request.action === 'ShiftTab') && !event.ctrlKey && !event.altKey && !event.metaKey;
    const down = event => { if (matches(event) && state.keydownAt === null) state.keydownAt = new Date().toISOString(); };
    const up = event => {
      if (!matches(event) || state.keydownAt === null || state.keyupAt !== null) return;
      state.keyupAt = new Date().toISOString();
      // 只读等待真实事件任务及默认动作结束，不派发事件或修改应用焦点。
      requestAnimationFrame(() => {
        if (state.closed || window[key] !== state || Date.now() > request.deadline) return;
        state.completedAt = new Date().toISOString(); state.trusted = true;
      });
    };
    state.close = () => { state.closed = true; document.removeEventListener('keydown', down, true); document.removeEventListener('keyup', up, true); clearTimeout(state.timer); };
    window[key] = state;
    document.addEventListener('keydown', down, true); document.addEventListener('keyup', up, true);
    state.timer = setTimeout(state.close, Math.max(0, request.deadline - Date.now()));
  }, { kind: 'v16-native-key-events-arm', nonce: command.nonce, action: command.action, deadline }), deadline);
}
function validateNativeKeyProcessing(value, command, ack) {
  const fields = ['nonce', 'action', 'closed', 'keydownAt', 'keyupAt', 'completedAt', 'trusted'];
  insist(value && same(Object.keys(value).sort(), fields.sort()) && value.nonce === command.nonce && value.action === command.action
    && value.closed === false && value.trusted === true, 'UI_NVDA_NATIVE_KEYS_DOM_INVALID');
  const stamps = [value.keydownAt, value.keyupAt, value.completedAt].map(value => {
    const at = Date.parse(value); insist(Number.isFinite(at) && new Date(at).toISOString() === value, 'UI_NVDA_NATIVE_KEYS_DOM_TIME_INVALID'); return at;
  });
  const down = ack.result.steps.find(step => step.key === 9 && step.flags === 0), up = ack.result.steps.find(step => step.key === 9 && step.flags === 2);
  insist(stamps[0] >= Date.parse(command.phaseStartedAt) && stamps[0] >= Date.parse(down.beforeInputAt)
    && stamps[1] >= stamps[0] && stamps[1] >= Date.parse(up.beforeInputAt) && stamps[2] >= stamps[1]
    && stamps[2] <= Date.now() && Date.now() <= Date.parse(command.deadlineAt), 'UI_NVDA_NATIVE_KEYS_DOM_NOT_CURRENT');
  return value;
}
async function waitNativeKeyEvents(runtime, command, ack, deadline, assertActive) {
  while (Date.now() < deadline) {
    assertActive();
    const value = await bounded(() => runtime.page.evaluate(request => {
      const state = window.__amazonAiOpsNativeKeysEvent;
      if (!state || state.nonce !== request.nonce || !state.completedAt) return null;
      return { nonce: state.nonce, action: state.action, closed: state.closed, keydownAt: state.keydownAt,
        keyupAt: state.keyupAt, completedAt: state.completedAt, trusted: state.trusted };
    }, { kind: 'v16-native-key-events-read', nonce: command.nonce }), deadline);
    if (value) return validateNativeKeyProcessing(value, command, ack);
    await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
  }
  throw new Error('UI_NVDA_NATIVE_KEYS_DOM_TIMEOUT');
}
async function closeNativeKeyEvents(runtime, command) {
  return bounded(() => runtime.page.evaluate(request => {
    const state = window.__amazonAiOpsNativeKeysEvent;
    if (state?.nonce === request.nonce) state.close();
  }, { kind: 'v16-native-key-events-close', nonce: command.nonce }), Date.now() + 1000);
}
module.exports = { armNativeKeyEvents, waitNativeKeyEvents, closeNativeKeyEvents, validateNativeKeyProcessing };
