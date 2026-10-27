const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { insist } = require('./v16-performance-artifacts');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const { armDomFocus, waitDomFocus, readDomFocus, matchesDomFocus, closeDomFocus, domFocusTimeFailure } = require('./v16-ui-nvda-dom-focus');
const STATE_FIELDS = ['kind', 'schemaVersion', 'runToken', 'pid', 'binding', 'generation', 'eventTimestamp'];
const REQUEST_FIELDS = ['kind', 'schemaVersion', 'runToken', 'pid', 'nonce', 'nodeSequence', 'nodeNonce', 'nodeId', 'phase', 'focusMode',
  'phaseStartedAt', 'startedAt', 'deadlineAt', 'baselineGeneration', 'allowAlreadyFocused', 'name', 'role'];
const ACK_EXTRA = ['source', 'eventGeneration', 'eventTimestamp', 'observedAt', 'pendingFocusEvents', 'focusMatchesExpected', 'proof'];
function exact(value, fields, code) {
  insist(value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...fields].sort()), code);
}
function at(value) {
  const time = Date.parse(value); insist(Number.isFinite(time) && new Date(time).toISOString() === value, 'UI_NVDA_FOCUS_TIME_INVALID'); return time;
}
function baseline(directory, binding, pid) {
  const file = path.join(directory, 'collector-focus-state.json');
  if (!fs.existsSync(file)) return 0;
  const value = JSON.parse(fs.readFileSync(file, 'utf8')); exact(value, STATE_FIELDS, 'UI_NVDA_FOCUS_STATE_INVALID');
  insist(value.kind === 'nvda-owned-focus-state' && value.schemaVersion === 1 && value.runToken === binding.runToken
    && value.pid === pid && same(value.binding, binding) && Number.isSafeInteger(value.generation) && value.generation > 0
    && at(value.eventTimestamp) <= Date.now(), 'UI_NVDA_FOCUS_STATE_INVALID');
  return value.generation;
}
function validateFocusAck(value, request, binding) {
  exact(value, [...REQUEST_FIELDS, ...ACK_EXTRA], 'UI_NVDA_FOCUS_ACK_INVALID');
  for (const key of REQUEST_FIELDS) insist(same(value[key], request[key]), 'UI_NVDA_FOCUS_ACK_IDENTITY_MISMATCH');
  const observed = at(value.observedAt), start = at(request.phaseStartedAt), end = at(request.deadlineAt);
  insist(observed >= start && observed <= Date.now() && Date.now() <= end && value.pendingFocusEvents === false
    && value.focusMatchesExpected === true && Number.isSafeInteger(value.eventGeneration)
    && value.eventGeneration >= request.baselineGeneration, 'UI_NVDA_FOCUS_ACK_NOT_PROCESSED');
  if (value.source === 'event-gainFocus') insist(value.eventGeneration > request.baselineGeneration
    && at(value.eventTimestamp) >= start && at(value.eventTimestamp) <= observed, 'UI_NVDA_FOCUS_EVENT_NOT_CURRENT');
  else insist(value.source === 'already-focused' && request.phase === 'first-focus' && request.allowAlreadyFocused === true
    && (value.eventTimestamp === null || at(value.eventTimestamp) <= observed), 'UI_NVDA_FOCUS_ALREADY_NOT_ALLOWED');
  const p = value.proof;
  exact(p, ['focusPid', 'focusHwnd', 'rootOwnerPid', 'focusOwnerPid', 'foregroundHwnd', 'ancestorHwnd', 'isChild', 'mainAlive', 'handleCreationTimeUtc'], 'UI_NVDA_FOCUS_OWNER_INVALID');
  insist(p.focusPid === binding.main.pid && p.rootOwnerPid === binding.main.pid && p.focusOwnerPid === binding.main.pid
    && p.foregroundHwnd === binding.window.rootHwnd && p.ancestorHwnd === binding.window.rootHwnd
    && /^[1-9]\d*$/.test(p.focusHwnd) && (p.focusHwnd === binding.window.rootHwnd || p.isChild === true)
    && p.mainAlive === true && p.handleCreationTimeUtc === binding.main.handleCreationTimeUtc, 'UI_NVDA_FOCUS_OWNER_INVALID');
  return value;
}
async function runFocusPhase({ runtime, locator, node, phase, focusMode, action, directory, binding, pid, request, deadline, writer, assertActive }) {
  let command, pending, context, firstError;
  try {
    const phases = focusMode === 'sequential' ? ['first-focus', 'tab', 'target-focus']
      : focusMode === 'named-dialog-container' ? ['first-focus', 'tab', 'target-handoff', 'target-focus'] : [];
    insist(phases.includes(phase), 'UI_NVDA_FOCUS_PHASE_INVALID');
    insist(deadline === at(request.deadlineAt) && deadline - at(request.startedAt) <= 10000, 'UI_NVDA_ORIGINAL_NODE_BUDGET_REQUIRED');
    const generation = baseline(directory, binding, pid), phaseStartedAt = new Date().toISOString();
    context = { nonce: randomUUID(), phase, phaseStartedAt, deadline };
    const beforeSame = await armDomFocus(locator, context, deadline);
    if (phase === 'tab') insist(beforeSame === true, 'UI_NVDA_DOM_FOCUS_START_INVALID');
    if (['target-handoff', 'target-focus'].includes(phase)) insist(beforeSame === false, 'UI_NVDA_DOM_FOCUS_START_INVALID');
    assertActive(); await action();
    const active = await waitDomFocus(runtime, context, node, deadline, assertActive);
    command = { kind: 'nvda-owned-focus-request', schemaVersion: 1, runToken: binding.runToken, pid, nonce: context.nonce,
      nodeSequence: request.sequence, nodeNonce: request.nonce, nodeId: request.nodeId, phase, focusMode, phaseStartedAt,
      startedAt: request.startedAt, deadlineAt: request.deadlineAt, baselineGeneration: generation,
      allowAlreadyFocused: phase === 'first-focus' && beforeSame === true, name: active.name, role: active.role };
    pending = path.join(directory, 'collector-focus.json'); const ackFile = path.join(directory, `collector-focus-ack-${command.nonce}.json`);
    insist(!fs.existsSync(pending) && !fs.existsSync(ackFile), 'UI_NVDA_FOCUS_REQUEST_PENDING');
    const temporary = path.join(directory, `collector-focus-${command.nonce}.tmp`);
    fs.writeFileSync(temporary, JSON.stringify(command), { flag: 'wx' });
    // 只对本owner临时信号原子不覆盖发布，移除临时名后恢复单link。
    fs.linkSync(temporary, pending); fs.unlinkSync(temporary);
    // 元数据确认只串行真实焦点处理；实际自然语音仍由原pre_synthSpeak与名称门独立判断。
    while (Date.now() < deadline) {
      assertActive();
      if (fs.existsSync(ackFile)) {
        const ack = validateFocusAck(JSON.parse(fs.readFileSync(ackFile, 'utf8')), command, binding);
        const current = await readDomFocus(runtime, context, deadline, node, assertActive); assertActive();
        insist(matchesDomFocus(current, context, node) && current.name === active.name && current.role === active.role, 'UI_NVDA_DOM_FOCUS_CHANGED_DURING_ACK');
        writer.json(`screen-reader/focus-${request.sequence}-${phase}.json`, { kind: 'v16-nvda-focus-phase', schemaVersion: 1, formalCredit: false, request: command, ack, dom: current });
        return ack;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
    throw new Error('UI_NVDA_FOCUS_PHASE_TIMEOUT');
  } catch (error) {
    firstError = error;
    try {
      if (command && pending && fs.existsSync(pending) && same(JSON.parse(fs.readFileSync(pending, 'utf8')), command)) {
        fs.linkSync(pending, path.join(directory, `collector-focus-cancelled-${command.nonce}.json`)); fs.unlinkSync(pending);
      }
    } catch (cleanupError) {
      try { writer.log('v16.ui_nvda_focus_cancel_failed', cleanupError, { phase, nodeId: node.id }); } catch { /* 保留首错，取消失败不授节点信用。 */ }
    }
    try {
      const timeFailure = domFocusTimeFailure(error);
      writer.log('v16.ui_nvda_focus_phase_failed', error, { phase, nodeId: node.id,
        ...(timeFailure ? { domFocusTime: { ...timeFailure, phaseStartedAt: context.phaseStartedAt, deadline } } : {}) });
    }
    catch (loggingError) { try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_nvda_focus_log_failed', { error: loggingError, originalError: error })) + '\n'); } catch { /* 日志出口故障仍保留原异常。 */ } }
    throw error;
  } finally {
    if (context) {
      try { await closeDomFocus(runtime, context); }
      catch (cleanupError) {
        try { writer.log('v16.ui_nvda_dom_focus_cleanup_failed', cleanupError, { phase, cleanupOnly: true }); } catch { /* 保留焦点首错。 */ }
        if (!firstError) throw cleanupError;
      }
    }
  }
}
module.exports = { runFocusPhase, validateFocusAck };
