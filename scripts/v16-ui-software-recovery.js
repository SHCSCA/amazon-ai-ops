const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { insist, fileRecord, within } = require('./v16-performance-artifacts');
const { until } = require('./v16-ui-software-screen-reader');

function readRuntimeLogs(userDataDir) {
  const root = path.join(userDataDir, 'logs');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter(name => /^runtime-\d{4}-\d{2}-\d{2}(?:\.\d{6})?\.jsonl$/.test(name)).sort()
    .flatMap(name => fs.readFileSync(path.join(root, name), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
}

async function collectSoftwareRecovery(runtime, fixture, writer, binding, ui = require('./package-ui-evidence'), dependencies = {}) {
  insist(fixture.classification === 'isolated-software-fixture' && fixture.formalCredit === false, 'UI_RECOVERY_ISOLATED_SOFTWARE_ONLY');
  const databasePath = path.join(runtime.userDataDir, 'amazon-ai-ops.db');
  const storage = await runtime.page.evaluate(() => window.electronAPI.getStoragePaths());
  insist(path.resolve(storage.localDbPath).toLowerCase() === databasePath.toLowerCase()
    && within(runtime.userDataDir, databasePath), 'UI_RECOVERY_DATABASE_BOUNDARY_MISMATCH');
  const context = await runtime.page.evaluate(() => window.electronAPI.getActiveStoreContext());
  insist(context && fixture.storeIds.includes(context.storeId), 'UI_RECOVERY_CURRENT_SOFTWARE_STORE_REQUIRED');
  const entry = ui.EXPECTED_PACKAGE_UI_ENTRIES.find(entry => entry.workspace === 'memory');
  await ui.navigateToWorkspace(runtime.page, entry, 2500);
  const Database = dependencies.Database ?? createRequire(path.resolve('packages/local-db/package.json'))('better-sqlite3');
  const correlationId = randomUUID(), events = [], channel = 'mission-domain:causal:list-events';
  const observed = (event, extra = {}, timestamp = new Date().toISOString()) => events.push({ event, observedAt: timestamp, correlationId, storeContext: context, ...extra });
  let database, before, renamed = false, captureError;
  const retry = runtime.page.getByRole('button', { name: '刷新因果记忆', exact: true });
  try {
    database = new Database(databasePath, { fileMustExist: true });
    database.pragma('busy_timeout = 5000');
    before = database.prepare('SELECT COUNT(*) count FROM causal_events').get().count;
    // 故障只发生于本次隔离库的只读表；finally 恢复表，永不进入正式数据目录。
    database.exec('ALTER TABLE causal_events RENAME TO v16_ui_recovery_causal_events'); renamed = true;
    observed('action.started', { channel });
    await retry.click();
    const failedUi = runtime.page.locator('.memory-feedback[data-tone="error"]');
    await failedUi.waitFor({ state: 'visible' });
    const injected = await until(() => readRuntimeLogs(runtime.userDataDir).filter(record => record.level === 'error'
      && record.timestamp >= events[0].observedAt && (record.event === 'ipc.handler_failed' && record.context?.channel === channel
        || record.event === 'renderer.reported' && record.context?.reportedEvent === 'renderer.memory_load_failed'
          && /causal_events/.test(JSON.stringify(record.context.details)))), rows => rows.length >= 2,
    5000, 'UI_RECOVERY_MAIN_AND_RENDERER_FAILURE_NOT_OBSERVED');
    const failure = injected.filter(record => record.event === 'ipc.handler_failed');
    insist(failure.length === 1 && failure[0].level === 'error', 'UI_RECOVERY_MAIN_FAILURE_NOT_OBSERVED');
    insist(injected.length === 2 && injected.filter(record => record.event === 'renderer.reported').length === 1,
      'UI_RECOVERY_DUPLICATED_FAILURE_NOT_ALLOWED');
    observed('ipc.failed', { channel }, failure[0].timestamp);
    const errorAt = new Date().toISOString(), errorText = await failedUi.innerText();
    insist(/[\u3400-\u9fff]/.test(errorText) && await retry.isEnabled(), 'UI_RECOVERY_READABLE_RETRY_REQUIRED');
    const errorImage = path.join(writer.root, 'recovery/error.png'); fs.mkdirSync(path.dirname(errorImage), { recursive: true });
    await ui.captureViewportScreenshot(runtime.app, errorImage);
    observed('ui.error-visible', {}, errorAt);
    const errorSnapshot = writer.json('recovery/error.json', { kind: 'v16-software-ui-recovery-snapshot', state: 'error', observedAt: errorAt,
      storeContext: context, errorText, retry: { enabled: true, name: '刷新因果记忆' }, screenshot: fileRecord(errorImage) });
    database.exec('ALTER TABLE v16_ui_recovery_causal_events RENAME TO causal_events'); renamed = false;
    insist(database.prepare('SELECT COUNT(*) count FROM causal_events').get().count === before, 'UI_RECOVERY_SOFTWARE_ROWS_CHANGED');
    observed('ui.retry-invoked', { accessibleName: '刷新因果记忆' });
    await retry.click();
    const confirmation = runtime.page.getByRole('status').filter({ hasText: '当前店铺因果记忆已刷新。' });
    await confirmation.waitFor({ state: 'visible' });
    insist(await runtime.page.locator('.memory-feedback[data-tone="error"]').count() === 0 && await retry.isEnabled(), 'UI_RECOVERY_BUSY_OR_ERROR_REMAINED');
    observed('ipc.succeeded', { channel, observation: '同一次真实刷新后的已读取投影与状态确认' });
    const readyAt = new Date().toISOString(), readyImage = path.join(writer.root, 'recovery/recovered.png');
    await ui.captureViewportScreenshot(runtime.app, readyImage);
    observed('ui.recovered', {}, readyAt);
    const recoveredSnapshot = writer.json('recovery/recovered.json', { kind: 'v16-software-ui-recovery-snapshot', state: 'ready', observedAt: readyAt,
      storeContext: context, errorText: null, busy: false, confirmation: { role: 'status', text: await confirmation.innerText() }, screenshot: fileRecord(readyImage) });
    const runtimeLog = writer.write('recovery/runtime-log.jsonl', readRuntimeLogs(runtime.userDataDir).map(line => JSON.stringify(line)).join('\n') + '\n');
    return { kind: 'v16-software-ui-recovery', schemaVersion: 1, classification: fixture.classification, formalCredit: false, binding,
      correlationId, storeContext: context, errorSnapshot, recoveredSnapshot, runtimeLog,
      expectedFaultRecords: injected,
      telemetry: writer.json('recovery/telemetry.json', { kind: 'v16-software-ui-recovery-telemetry', correlationId, storeContext: context, events }) };
  } catch (error) { captureError = error; writer.log('v16.ui_recovery_capture_failed', error, { pid: runtime.identity.pid, correlationId }); throw error; }
  finally {
    const cleanupErrors = [];
    try { if (renamed) database.exec('ALTER TABLE v16_ui_recovery_causal_events RENAME TO causal_events'); }
    catch (error) { writer.log('v16.ui_recovery_restore_failed', error, { pid: runtime.identity.pid, correlationId }); cleanupErrors.push(error); }
    try { if (database?.open) database.close(); }
    catch (error) { writer.log('v16.ui_recovery_database_close_failed', error, { pid: runtime.identity.pid, correlationId }); cleanupErrors.push(error); }
    if (cleanupErrors.length) throw new AggregateError([...(captureError ? [captureError] : []), ...cleanupErrors], 'UI_RECOVERY_CLEANUP_FAILED');
  }
}
module.exports = { readRuntimeLogs, collectSoftwareRecovery };
