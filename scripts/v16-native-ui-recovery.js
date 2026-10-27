const { insist, same, readArtifact, timeWithin } = require('./v16-native-artifacts');

const RECOVERY_EVENTS = ['action.started', 'ipc.failed', 'ui.error-visible', 'ui.retry-invoked', 'ipc.succeeded', 'ui.recovered'];
function verifyUiRecovery(raw, descriptor, context) {
  insist(raw.kind === 'v16-ui-recovery' && raw.schemaVersion === 1 && raw.runId === descriptor.runId, 'UI_RECOVERY_SCHEMA_OR_RUN_MISMATCH');
  insist(typeof raw.correlationId === 'string' && raw.correlationId.length > 0, 'UI_RECOVERY_CORRELATION_REQUIRED');
  insist(same(raw.packageIdentity, context.current.packageIdentity) && raw.storeContext?.storeId && Number.isInteger(raw.storeContext.sessionGeneration), 'UI_RECOVERY_PACKAGE_OR_STORE_MISMATCH');
  const telemetry = readArtifact(context.root, raw.telemetry).json();
  insist(telemetry.kind === 'v16-ui-recovery-telemetry' && telemetry.runId === raw.runId && same(telemetry.storeContext, raw.storeContext), 'UI_RECOVERY_TELEMETRY_IDENTITY');
  const events = telemetry.events ?? [];
  insist(same(events.map(x => x.event), RECOVERY_EVENTS), 'UI_RECOVERY_EVENT_SEQUENCE_MISMATCH');
  let previous = -Infinity;
  for (const event of events) {
    const at = timeWithin(event.observedAt, context.execution, 'ui-recovery-' + event.event);
    insist(at >= previous && event.correlationId === raw.correlationId && same(event.storeContext, raw.storeContext), 'UI_RECOVERY_CONTEXT_CHANGED');
    previous = at;
  }
  const log = readArtifact(context.root, raw.runtimeLog).bytes.toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  const failure = events[1], corresponding = log.filter(x => x.event === 'ipc.handler_failed' && x.context?.channel === failure.channel && x.timestamp === failure.observedAt);
  insist(corresponding.length === 1 && corresponding[0].level === 'error', 'UI_RECOVERY_IPC_FAILURE_NOT_LOGGED');
  const failed = readArtifact(context.root, raw.errorSnapshot).json(), recovered = readArtifact(context.root, raw.recoveredSnapshot).json();
  insist(failed.kind === 'v16-ui-recovery-snapshot' && recovered.kind === failed.kind && same(failed.storeContext, raw.storeContext) && same(recovered.storeContext, raw.storeContext), 'UI_RECOVERY_SNAPSHOT_STORE_MISMATCH');
  insist(failed.state === 'error' && typeof failed.errorText === 'string' && /[\u3400-\u9fff]/.test(failed.errorText) && !/undefined|NaN|TODO|模拟|preview/i.test(failed.errorText), 'UI_RECOVERY_CHINESE_ERROR_MISSING');
  insist(failed.retry?.enabled === true && /[\u3400-\u9fff]/.test(failed.retry.name ?? '') && events[3].accessibleName === failed.retry.name, 'UI_RECOVERY_VISIBLE_RETRY_MISSING');
  insist(recovered.state === 'ready' && recovered.errorText === null && recovered.busy === false && recovered.confirmation?.role === 'status' && /[\u3400-\u9fff]/.test(recovered.confirmation.text ?? ''), 'UI_RECOVERY_READY_CONFIRMATION_MISSING');
  insist(failed.observedAt === events[2].observedAt && recovered.observedAt === events[5].observedAt, 'UI_RECOVERY_SNAPSHOT_TIME_MISMATCH');
  for (const snapshot of [failed, recovered]) {
    timeWithin(snapshot.observedAt, context.execution, 'ui-recovery-snapshot');
    const image = readArtifact(context.root, snapshot.screenshot);
    require('./canary-png-evidence').inspectPngEvidenceBytes(image.bytes);
  }
  insist(failed.screenshot.sha256 !== recovered.screenshot.sha256, 'UI_RECOVERY_SCREENSHOTS_NOT_INDEPENDENT');
  return true;
}
module.exports = { RECOVERY_EVENTS, verifyUiRecovery };
