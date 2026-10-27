import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

export const BROWSER_LIFECYCLE_BUDGET = Object.freeze({
  launchMs: 15_000,
  connectMs: 5_000,
  setupHookMs: 25_000,
  gracefulMs: 30_000,
  forcedMs: 10_000,
  teardownHookMs: 45_000,
});

function bounded(operation, timeoutMs, code) {
  let timer;
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(code)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

function writeLifecycle(event, context) {
  const level = event.endsWith('_failed') ? 'error' : 'info';
  process.stderr.write(JSON.stringify(createRuntimeLogRecord(level, event, context)) + '\n');
}

export function ownBrowserServer(server, { log = writeLifecycle } = {}) {
  const child = server.process();
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0) throw new Error('NFR_TEST_BROWSER_OWNED_PROCESS_REQUIRED');
  const receipt = { pid: child.pid, startedAt: new Date().toISOString(), exitObserved: false, closeObserved: false };
  const emit = (event, details = {}) => {
    // 日志失败不能阻止自有浏览器回收，原清理异常仍向测试框架传播。
    try { log(event, { ...receipt, ...details }); }
    catch (error) {
      try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'software.browser_lifecycle_log_failed', { error })) + '\n'); }
      catch { /* 最后日志出口失效时仍须回收自有进程并保留原清理异常。 */ }
    }
  };
  const exited = (code, signal) => {
    Object.assign(receipt, { exitObserved: true, exitCode: code, signal });
    emit('software.browser_process_exited');
  };
  child.once('exit', exited);
  let closed;
  const processClosed = new Promise(resolve => {
    closed = (code, signal) => {
      Object.assign(receipt, { closeObserved: true, closeCode: code, closeSignal: signal });
      emit('software.browser_process_closed');
      resolve();
    };
    child.once('close', closed);
  });
  emit('software.browser_process_owned');
  let cleanup;
  return {
    receipt,
    close({ gracefulMs = BROWSER_LIFECYCLE_BUDGET.gracefulMs, forcedMs = BROWSER_LIFECYCLE_BUDGET.forcedMs } = {}) {
      if (cleanup) return cleanup;
      cleanup = (async () => {
        const started = performance.now();
        emit('software.browser_close_started', { gracefulMs, forcedMs });
        try {
          // server.close 默认可能超过 Vitest 的 10 秒；收尾必须同时等到自有子进程 close。
          await bounded(async () => { await server.close(); await processClosed; }, gracefulMs, 'NFR_TEST_BROWSER_GRACEFUL_CLOSE_TIMEOUT');
          emit('software.browser_close_completed', { elapsedMs: performance.now() - started });
        } catch (primaryError) {
          emit('software.browser_close_failed', { error: primaryError });
          try {
            // BrowserServer 持有原始 ChildProcess；不按裸 PID 搜索或终止其它浏览器。
            await bounded(async () => { await server.kill(); await processClosed; }, forcedMs, 'NFR_TEST_BROWSER_FORCED_CLOSE_TIMEOUT');
            emit('software.browser_forced_cleanup_completed', { elapsedMs: performance.now() - started });
          } catch (cleanupError) {
            emit('software.browser_forced_cleanup_failed', { error: cleanupError });
            throw new AggregateError([primaryError, cleanupError], 'NFR_TEST_BROWSER_CLOSE_AND_CLEANUP_FAILED');
          }
          throw primaryError;
        } finally {
          child.removeListener('exit', exited);
          child.removeListener('close', closed);
        }
      })();
      return cleanup;
    },
  };
}
