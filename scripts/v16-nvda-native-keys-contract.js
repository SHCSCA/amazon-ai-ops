const { isDeepStrictEqual: same } = require('node:util');
const { insist } = require('./v16-performance-artifacts');
const FIELDS = ['kind', 'schemaVersion', 'runToken', 'pid', 'nonce', 'nodeSequence', 'nodeNonce', 'nodeId', 'phase', 'focusMode', 'action', 'phaseStartedAt', 'startedAt', 'deadlineAt'];
const RESULT_FIELDS = ['passed', 'reason', 'requestedEvents', 'acceptedEvents', 'sendInputCalls', 'steps', 'afterProof',
  'cleanupOnly', 'cleanupAttempted', 'cleanupAcceptedEvents', 'cleanupKeys', 'cleanupKeysReleased', 'cleanupErrors', 'atomicTargetGuarantee'];
const PROOF_FIELDS = ['mainPid', 'mainAlive', 'handleCreationTimeUtc', 'mainExeMatches', 'rootHwnd', 'activeHwnd', 'focusHwnd',
  'focusOwnerPid', 'focusAncestorHwnd', 'inputDesktopMatched', 'otherInputReleased', 'heldKeys'];
function exact(value, fields, code) {
  insist(value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...fields].sort()), code);
}
function at(value) {
  const stamp = Date.parse(value);
  insist(typeof value === 'string' && Number.isFinite(stamp) && new Date(stamp).toISOString() === value, 'UI_NVDA_NATIVE_KEYS_TIME_INVALID');
  return stamp;
}
function events(action) {
  if (action === 'ReportFocus') return [[45, 1], [9, 0], [9, 2], [45, 3]];
  insist(['Tab', 'ShiftTab'].includes(action), 'UI_NVDA_NATIVE_KEYS_ACTION_INVALID');
  return action === 'Tab' ? [[9, 0], [9, 2]] : [[160, 0], [9, 0], [9, 2], [160, 2]];
}
function proof(value, binding, held) {
  exact(value, PROOF_FIELDS, 'UI_NVDA_NATIVE_KEYS_OWNER_INVALID');
  insist(value.mainPid === binding.main.pid && value.mainAlive === true && value.mainExeMatches === true
    && value.handleCreationTimeUtc === binding.main.handleCreationTimeUtc && value.rootHwnd === binding.window.rootHwnd
    && value.activeHwnd === binding.window.rootHwnd && /^[1-9]\d*$/.test(value.focusHwnd)
    && value.focusOwnerPid === binding.main.pid && value.focusAncestorHwnd === binding.window.rootHwnd
    && value.inputDesktopMatched === true && value.otherInputReleased === true && same(value.heldKeys, held), 'UI_NVDA_NATIVE_KEYS_OWNER_INVALID');
}
function validateAckEnvelope(value, request) {
  const reportFocus = request.action === 'ReportFocus';
  insist(!reportFocus || request.phase === 'report-focus' && request.focusMode === 'named-dialog-container', 'UI_NVDA_REPORT_NAMED_DIALOG_REQUIRED');
  exact(value, [...FIELDS, 'result', 'observedAt', ...(reportFocus ? ['modifierEvidence'] : [])], 'UI_NVDA_NATIVE_KEYS_ACK_INVALID');
  if (reportFocus) {
    const evidence = value.modifierEvidence;
    exact(evidence, ['kind', 'schemaVersion', 'source', 'keyboardLayout', 'modifierKeys', 'extendedInsertMask', 'handleInjectedKeys'], 'UI_NVDA_REPORT_MODIFIER_EVIDENCE_INVALID');
    insist(evidence.kind === 'nvda-report-focus-modifier' && evidence.schemaVersion === 1 && evidence.source === 'nvda.config.conf'
      && evidence.keyboardLayout === 'desktop' && evidence.modifierKeys === 4 && evidence.extendedInsertMask === 4
      && evidence.handleInjectedKeys === true, 'UI_NVDA_REPORT_MODIFIER_EVIDENCE_INVALID');
  }
  for (const field of FIELDS) insist(same(value[field], request[field]), 'UI_NVDA_NATIVE_KEYS_ACK_IDENTITY_MISMATCH');
}
function validateAckSteps(value, request, binding) {
  const observed = at(value.observedAt), start = at(request.phaseStartedAt);
  const result = value.result, expected = events(request.action), held = [];
  exact(result, RESULT_FIELDS, 'UI_NVDA_NATIVE_KEYS_RESULT_INVALID');
  insist(result.passed === true && result.reason === 'COMPLETE' && result.requestedEvents === expected.length
    && result.acceptedEvents === expected.length && result.sendInputCalls === expected.length && result.atomicTargetGuarantee === false
    && result.cleanupOnly === false && result.cleanupAttempted === false && result.cleanupAcceptedEvents === 0
    && same(result.cleanupKeys, []) && result.cleanupKeysReleased === true && same(result.cleanupErrors, [])
    && Array.isArray(result.steps) && result.steps.length === expected.length, 'UI_NVDA_NATIVE_KEYS_NOT_COMPLETE');
  result.steps.forEach((step, index) => {
    exact(step, ['index', 'key', 'flags', 'accepted', 'proof', 'beforeInputAt', 'timestamp'], 'UI_NVDA_NATIVE_KEYS_STEP_INVALID');
    insist(step.index === index && step.key === expected[index][0] && step.flags === expected[index][1] && step.accepted === 1
      && at(step.beforeInputAt) >= start && at(step.timestamp) >= at(step.beforeInputAt) && at(step.timestamp) <= observed, 'UI_NVDA_NATIVE_KEYS_STEP_INVALID');
    proof(step.proof, binding, held);
    if ((step.flags & 2) === 0) held.push(step.key); else held.splice(held.indexOf(step.key), 1);
  });
  proof(result.afterProof, binding, []);
  return value;
}
function validateNativeKeysAck(value, request, binding) {
  validateAckEnvelope(value, request);
  const observed = at(value.observedAt), start = at(request.phaseStartedAt), end = at(request.deadlineAt);
  insist(observed >= start && observed <= Date.now() && Date.now() <= end, 'UI_NVDA_NATIVE_KEYS_ACK_EXPIRED');
  return validateAckSteps(value, request, binding);
}
function validateReportFocusInputReceipt(artifact, binding, nodeRequest, readerPid, execution) {
  exact(artifact, ['kind', 'schemaVersion', 'formalCredit', 'inputAcceptanceOnly', 'request', 'ack'], 'UI_NVDA_REPORT_INPUT_RECEIPT_INVALID');
  insist(artifact.kind === 'v16-nvda-native-keys' && artifact.schemaVersion === 1 && artifact.formalCredit === false
    && artifact.inputAcceptanceOnly === true, 'UI_NVDA_REPORT_INPUT_RECEIPT_INVALID');
  const request = artifact.request;
  exact(request, FIELDS, 'UI_NVDA_REPORT_INPUT_REQUEST_INVALID');
  exact(execution, ['startedAt', 'finishedAt'], 'UI_NVDA_REPORT_INPUT_EXECUTION_INVALID');
  insist(binding && binding.main && nodeRequest && Number.isSafeInteger(readerPid) && readerPid > 0 && readerPid !== binding.main.pid
    && request.pid === readerPid && request.runToken === binding.runToken && request.kind === 'nvda-owned-native-keys-request'
    && request.schemaVersion === 1 && request.phase === 'report-focus' && request.action === 'ReportFocus'
    && request.focusMode === 'named-dialog-container' && nodeRequest.role === 'dialog', 'UI_NVDA_REPORT_INPUT_IDENTITY_INVALID');
  insist(request.nodeSequence === nodeRequest.sequence && Number.isSafeInteger(request.nodeSequence) && request.nodeSequence > 0
    && request.nodeNonce === nodeRequest.nonce && request.nodeId === nodeRequest.nodeId && request.startedAt === nodeRequest.startedAt
    && request.deadlineAt === nodeRequest.deadlineAt && request.nonce !== request.nodeNonce
    && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(request.nonce), 'UI_NVDA_REPORT_INPUT_NODE_INVALID');
  validateAckEnvelope(artifact.ack, request);
  const start = at(request.startedAt), end = at(request.deadlineAt), phase = at(request.phaseStartedAt);
  const began = at(execution.startedAt), finished = at(execution.finishedAt), observed = at(artifact.ack.observedAt);
  insist(end > start && end - start <= 10000 && began === start && phase >= start && observed >= phase
    && finished >= observed && finished <= end, 'UI_NVDA_REPORT_INPUT_EXECUTION_INVALID');
  validateAckSteps(artifact.ack, request, binding);
  let prior = phase;
  for (const step of artifact.ack.result.steps) {
    insist(at(step.beforeInputAt) >= prior, 'UI_NVDA_REPORT_INPUT_SEQUENCE_INVALID');
    prior = at(step.timestamp);
  }
  return artifact;
}
module.exports = { at, validateNativeKeysAck, validateReportFocusInputReceipt };
