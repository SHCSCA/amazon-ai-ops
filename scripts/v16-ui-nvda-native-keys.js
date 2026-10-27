const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { insist } = require('./v16-performance-artifacts');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const { at, validateNativeKeysAck, validateReportFocusInputReceipt } = require('./v16-nvda-native-keys-contract');
async function readNativeFocusMode(locator, node, options = {}) {
  const value = await require('./v16-ui-accessible-node').readAccessibleMode(locator, node, options);
  insist(value.id === node.id && value.name === node.name, 'UI_NVDA_PROVIDER_CURRENT_DOM_CHANGED');
  insist(!value.disabled && !value.inert && Number.isInteger(value.tabIndex),
    'UI_NVDA_NATIVE_FOCUS_MODE_INVALID');
  if (value.tabIndex >= 0) return { mode: 'sequential', node: value };
  insist(value.tabIndex === -1 && value.role === 'dialog' && node.role === 'dialog' && Boolean(value.name), 'UI_NVDA_NATIVE_FOCUS_MODE_INVALID');
  return { mode: 'named-dialog-container', node: value };
}
async function runNativeKeys({ runtime, directory, binding, pid, request, phase, focusMode, deadline, writer, assertActive }) {
  let command, pending;
  try {
    insist(['tab', 'target-focus', 'report-focus'].includes(phase) && deadline === at(request.deadlineAt)
      && at(request.startedAt) <= Date.now() && Date.now() < deadline && deadline - at(request.startedAt) <= 10000,
    'UI_NVDA_NATIVE_KEYS_ORIGINAL_BUDGET_REQUIRED');
    assertActive();
    command = { kind: 'nvda-owned-native-keys-request', schemaVersion: 1, runToken: binding.runToken, pid, nonce: randomUUID(),
      nodeSequence: request.sequence, nodeNonce: request.nonce, nodeId: request.nodeId, phase, focusMode,
      action: { tab: 'Tab', 'target-focus': 'ShiftTab', 'report-focus': 'ReportFocus' }[phase], phaseStartedAt: new Date().toISOString(), startedAt: request.startedAt, deadlineAt: request.deadlineAt };
    insist(command.nonce !== command.nodeNonce, 'UI_NVDA_NATIVE_KEYS_NONCE_REUSED');
    insist(['sequential', 'named-dialog-container'].includes(focusMode), 'UI_NVDA_NATIVE_FOCUS_MODE_INVALID');
    insist(phase !== 'report-focus' || focusMode === 'named-dialog-container', 'UI_NVDA_REPORT_NAMED_DIALOG_REQUIRED');
    pending = path.join(directory, 'collector-keys.json');
    const ackFile = path.join(directory, 'collector-keys-ack-' + command.nonce + '.json');
    insist(!fs.existsSync(pending) && !fs.existsSync(ackFile), 'UI_NVDA_NATIVE_KEYS_REQUEST_PENDING');
    const temporary = path.join(directory, '.keys-' + command.nonce + '.tmp');
    fs.writeFileSync(temporary, JSON.stringify(command), { flag: 'wx' });
    fs.linkSync(temporary, pending); fs.unlinkSync(temporary);
    while (Date.now() < deadline) {
      assertActive();
      if (fs.existsSync(ackFile)) {
        const ack = validateNativeKeysAck(JSON.parse(fs.readFileSync(ackFile, 'utf8')), command, binding);
        // 原生输入确认仅证明本次有限输入；焦点和自然朗读仍各自独立验收。
        writer.json('screen-reader/native-keys-' + request.sequence + '-' + phase + '.json', {
          kind: 'v16-nvda-native-keys', schemaVersion: 1, formalCredit: false, inputAcceptanceOnly: true, request: command, ack });
        return ack;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
    throw new Error('UI_NVDA_OPERATION_DEADLINE_EXCEEDED');
  } catch (error) {
    try {
      if (command && pending && fs.existsSync(pending) && same(JSON.parse(fs.readFileSync(pending, 'utf8')), command)) {
        fs.linkSync(pending, path.join(directory, 'collector-keys-cancelled-' + command.nonce + '.json')); fs.unlinkSync(pending);
      }
    } catch (cleanupError) {
      try { writer.log('v16.ui_nvda_native_keys_cancel_failed', cleanupError, { phase }); } catch { /* 保留输入首错。 */ }
    }
    try { writer.log('v16.ui_nvda_native_keys_failed', error, { phase }); }
    catch (loggingError) {
      try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.ui_nvda_native_keys_log_failed', { error: loggingError, originalError: error })) + '\n'); }
      catch { /* 日志出口故障仍保留原异常。 */ }
    }
    throw error;
  }
}
module.exports = { runNativeKeys, validateNativeKeysAck, readNativeFocusMode, validateReportFocusInputReceipt };
