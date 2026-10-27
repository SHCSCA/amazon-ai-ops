const { insist } = require('./v16-performance-artifacts');
const timeFailures = new WeakMap();
const receivedProbes = new WeakMap();
function timeValue(value) {
  const type = value === null ? 'null' : typeof value, length = type === 'string' ? value.length : null;
  // 仅保留有界时间字面量；其它原始内容不进入日志。
  const timestamp = type === 'string' && length <= 64
    && /^[+-]?\d{4,6}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value);
  return Object.freeze({ type, length, value: timestamp || type === 'number' && Number.isFinite(value) ? value : null });
}
function domFocusTimeFailure(error) { return timeFailures.get(error) || null; }
async function bounded(action, deadline) {
  let timer;
  insist(Date.now() < deadline, 'UI_NVDA_DOM_FOCUS_DEADLINE');
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('UI_NVDA_DOM_FOCUS_DEADLINE')), Math.max(1, deadline - Date.now()));
  })]); } finally { clearTimeout(timer); }
}
async function armDomFocus(locator, context, deadline) {
  return bounded(() => locator.evaluate((target, request) => {
    if (Date.now() >= request.deadline) throw new Error('UI_NVDA_DOM_FOCUS_DEADLINE');
    const key = '__amazonAiOpsDomFocus', prior = window[key];
    if (prior && !prior.closed) throw new Error('UI_NVDA_DOM_FOCUS_PENDING');
    window[key] = { ...request, closed: false, target, before: document.activeElement };
    return document.activeElement === target;
  }, context), deadline);
}
function canonicalTime(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
function rendererInterval(value, expected) {
  const timing = value.rendererTiming && { ...value.rendererTiming };
  insist(timing && timing.kind === 'v16-dom-renderer-interval' && timing.schemaVersion === 1
    && timing.clock === 'renderer-wall' && typeof timing.probeNonce === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(timing.probeNonce)
    && timing.nonce === expected.nonce && timing.phase === expected.phase && timing.targetId === expected.targetId,
  'UI_NVDA_DOM_FOCUS_RENDERER_INTERVAL_INVALID');
  const started = canonicalTime(timing.startedAt), finished = canonicalTime(timing.finishedAt);
  insist(Number.isFinite(started) && Number.isFinite(finished) && started <= finished
    && value.observedAt === timing.finishedAt, 'UI_NVDA_DOM_FOCUS_RENDERER_INTERVAL_INVALID');
  return Object.freeze(timing);
}
async function readDomFocus(runtime, context, deadline, node, assertActive) {
  insist(typeof node?.id === 'string' && Boolean(node.id), 'UI_NVDA_DOM_FOCUS_IDENTITY_CHANGED');
  const expected = { nonce: context.nonce, phase: context.phase, targetId: node.id,
    phaseStartedAt: context.phaseStartedAt, deadline: context.deadline };
  assertActive?.();
  const readStarted = Date.now();
  return bounded(async () => {
    const value = await require('./v16-ui-accessible-node').readAccessibleFocus(runtime.page, context, node,
      { deadline, assertActive });
    assertActive?.();
    if (!value) return null;
    const payload = { ...value }, timing = rendererInterval(payload, expected);
    insist(payload.nonce === expected.nonce && payload.phase === expected.phase && payload.targetId === expected.targetId
      && context.nonce === expected.nonce && context.phase === expected.phase && node.id === expected.targetId
      && context.phaseStartedAt === expected.phaseStartedAt && context.deadline === expected.deadline,
    'UI_NVDA_DOM_FOCUS_IDENTITY_CHANGED');
    const seen = receivedProbes.get(context) || new Set(), phaseStarted = canonicalTime(expected.phaseStartedAt);
    insist(!seen.has(timing.probeNonce), 'UI_NVDA_DOM_FOCUS_CLOCK_RECEIPT_INVALID');
    assertActive?.();
    insist(context.nonce === expected.nonce && context.phase === expected.phase && node.id === expected.targetId
      && context.phaseStartedAt === expected.phaseStartedAt && context.deadline === expected.deadline,
    'UI_NVDA_DOM_FOCUS_IDENTITY_CHANGED');
    // AX 最终清理与身份校验完成后，只采一次本进程接收时间；两个时钟域不作偏移补偿。
    const received = Date.now();
    insist(Number.isSafeInteger(readStarted) && Number.isSafeInteger(received) && Number.isFinite(phaseStarted)
      && deadline === expected.deadline && Number.isFinite(deadline) && readStarted >= phaseStarted
      && received >= readStarted && received <= deadline, 'UI_NVDA_DOM_FOCUS_CLOCK_RECEIPT_INVALID');
    const receivedAt = new Date(received).toISOString();
    const collectorTiming = Object.freeze({ kind: 'v16-dom-collector-receipt', schemaVersion: 1, clock: 'collector-node-wall',
      nonce: expected.nonce, phase: expected.phase, targetId: expected.targetId, probeNonce: timing.probeNonce,
      readStartedAt: new Date(readStarted).toISOString(), receivedAt });
    seen.add(timing.probeNonce); receivedProbes.set(context, seen);
    return { ...payload, rendererObservedAt: payload.observedAt, rendererTiming: timing, collectorTiming, observedAt: receivedAt };
  }, deadline);
}
function matchesDomFocus(value, context, node) {
  if (!value) return false;
  insist(value.nonce === context.nonce && value.phase === context.phase && value.targetId === node.id
    && value.targetConnected === true && value.activeConnected === true, 'UI_NVDA_DOM_FOCUS_IDENTITY_CHANGED');
  insist(value.documentFocused === true, 'UI_NVDA_DOM_FOCUS_DOCUMENT_LOST');
  const rawObservedAt = value.observedAt, observed = Date.parse(rawObservedAt);
  let canonicalObservedAt, phaseStartedAt, deadline, hostNowObserved = null, hostNowDeadline = null;
  const gates = { finite: null, canonical: null, notBeforePhase: null, notFutureHost: null, withinDeadline: null };
  // 赋值只记录原短路路径；两个主机采样仍在原谓词位置执行。
  const valid = (gates.finite = Number.isFinite(observed))
    && (gates.canonical = new Date(observed).toISOString() === (canonicalObservedAt = value.observedAt))
    && (gates.notBeforePhase = observed >= Date.parse(phaseStartedAt = context.phaseStartedAt))
    && (gates.notFutureHost = observed <= (hostNowObserved = Date.now()))
    && (gates.withinDeadline = (hostNowDeadline = Date.now()) <= (deadline = context.deadline));
  try { insist(valid, 'UI_NVDA_DOM_FOCUS_TIME_INVALID'); }
  catch (error) {
    timeFailures.set(error, Object.freeze({ schemaVersion: 1, observedAt: timeValue(rawObservedAt),
      canonicalObservedAt: gates.canonical === null ? null : timeValue(canonicalObservedAt),
      predicatePhaseStartedAt: gates.notBeforePhase === null ? null : timeValue(phaseStartedAt),
      predicateDeadline: gates.withinDeadline === null ? null : timeValue(deadline),
      hostNowObserved, hostNowDeadline, gates: Object.freeze(gates) }));
    throw error;
  }
  if (['first-focus', 'target-focus'].includes(context.phase)) {
    if (!value.sameTarget) return false;
    insist(value.name === node.name && value.role === node.role, 'UI_NVDA_FOCUS_DOM_TARGET_CHANGED');
  } else if (context.phase === 'tab') { if (value.sameTarget) return false; }
  else if (context.phase === 'target-handoff') { if (value.sameBefore || value.sameTarget) return false; }
  else throw new Error('UI_NVDA_FOCUS_PHASE_INVALID');
  insist(Boolean(value.name && value.role), 'UI_NVDA_FOCUS_DOM_TARGET_REQUIRED');
  return true;
}
async function waitDomFocus(runtime, context, node, deadline, assertActive) {
  while (Date.now() < deadline) {
    assertActive();
    const value = await readDomFocus(runtime, context, deadline, node, assertActive); assertActive();
    if (matchesDomFocus(value, context, node)) return value;
    await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
  }
  throw new Error('UI_NVDA_DOM_FOCUS_TRANSITION_TIMEOUT');
}
async function closeDomFocus(runtime, context) {
  return bounded(() => runtime.page.evaluate(request => {
    const state = window.__amazonAiOpsDomFocus;
    if (state?.nonce === request.nonce) { state.closed = true; state.target = null; state.before = null; }
  }, context), Date.now() + 1000);
}
module.exports = { armDomFocus, waitDomFocus, readDomFocus, matchesDomFocus, closeDomFocus, domFocusTimeFailure };
