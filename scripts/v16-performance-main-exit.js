const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { resolveTrustedWindowsPowerShell, minimalWindowsRuntimeEnvironment } = require('./s7-launch-operator-security');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

const PRECISION = 'cim-microsecond+handle-100ns';
const UTC_TICKS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/;
const MAX_OUTPUT = 128 * 1024;
const normalizedPath = value => path.win32.normalize(value).toLowerCase();
const validTime = value => typeof value === 'string' && UTC_TICKS.test(value) && Number.isFinite(Date.parse(value));
const microsecond = value => value.slice(0, -2);
const insist = (condition, code) => { if (!condition) throw new Error(code); };

async function openMainExitWatcher({ main, timeoutMs, writer, label }) {
  let child, readyValue, proofValue, firstFailure, exitReceipt, closeReceipt;
  let output = '', stderr = '', exitRequested = false, disposalStarted = false;
  let disposalPromise, observationPromise;
  const ownerToken = randomUUID();
  const waiters = new Set();
  const budget = value => {
    insist(Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647, 'NFR_MAIN_EXIT_TIMEOUT_INVALID');
    return value;
  };
  const remaining = (deadline, code) => { const value = deadline - Date.now(); insist(value > 0, code); return value; };
  const operationBudget = value => { budget(value); insist(value <= timeoutMs, 'NFR_MAIN_EXIT_TIMEOUT_EXCEEDS_ORIGINAL'); return value; };
  const bounded = (promise, duration, code) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), duration);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const log = (event, error) => {
    try { writer.log(event, error, { label, mainPid: main?.pid, watcherPid: child?.pid, stderr }); }
    catch (loggingError) {
      // 日志落盘失败不能替换首先发生的业务错误。
      try { process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'v16.main_exit_watch_log_failed', { error: loggingError, originalError: error })) + '\n'); }
      catch { /* 输出流关闭后保留原错误，由调用方处理。 */ }
    }
  };
  const pulse = () => { for (const waiter of [...waiters]) waiter(); };
  const fail = (error, event = 'v16.main_exit_watch_failed') => {
    if (!firstFailure) { firstFailure = error; log(event, error); }
    pulse();
  };
  const waitFor = (read, duration, code, ignoreFailure = false) => new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); waiters.delete(check); callback(value);
    };
    const check = () => {
      try {
        if (!ignoreFailure && firstFailure) throw firstFailure;
        const value = read(); if (value) finish(resolve, value);
      } catch (error) { finish(reject, error); }
    };
    waiters.add(check);
    timer = setTimeout(() => finish(reject, new Error(code)), duration);
    check();
  });
  const matchesMain = value => value && value.pid === main.pid && value.parentPid === main.parentPid
    && typeof value.executablePath === 'string' && normalizedPath(value.executablePath) === normalizedPath(main.executablePath)
    && value.creationTimeUtc === main.creationTimeUtc && value.creationPrecision === PRECISION
    && validTime(value.handleCreationTimeUtc) && microsecond(value.handleCreationTimeUtc) === microsecond(main.creationTimeUtc);
  const accept = record => {
    insist(record && typeof record === 'object' && !Array.isArray(record), 'NFR_MAIN_EXIT_HELPER_MESSAGE_INVALID');
    insist(record.ownerToken === ownerToken && record.watcherPid === child.pid && record.pid === main.pid,
      'NFR_MAIN_EXIT_HELPER_OWNER_MISMATCH');
    if (record.kind === 'v16-main-exit-error') {
      const error = new Error(String(record.message || 'NFR_MAIN_EXIT_HELPER_ERROR'));
      error.name = String(record.name || 'Error'); throw error;
    }
    if (record.kind === 'v16-main-exit-ready') {
      insist(!readyValue && !exitRequested && !disposalStarted && record.schemaVersion === 1
        && record.ownerToken === ownerToken && record.watcherPid === child.pid && record.handleAcquired === true && matchesMain(record)
        && validTime(record.observedAt), 'NFR_MAIN_EXIT_HANDLE_IDENTITY_MISMATCH');
      readyValue = Object.freeze({ ...record });
    } else if (record.kind === 'v16-main-exit-proof') {
      insist(readyValue && exitRequested && !proofValue && record.schemaVersion === 1
        && record.ownerToken === ownerToken && record.watcherPid === child.pid && matchesMain(record)
        && record.handleCreationTimeUtc === readyValue.handleCreationTimeUtc && record.exited === true
        && Number.isInteger(record.exitCode) && record.signalCode === null && validTime(record.observedAt)
        && Date.parse(record.observedAt) >= Date.parse(readyValue.observedAt),
      'NFR_MAIN_EXIT_PROOF_IDENTITY_MISMATCH');
      proofValue = Object.freeze({ ...record });
    } else if (record.kind === 'v16-main-exit-disposed') {
      insist(disposalStarted && record.ownerToken === ownerToken && record.watcherPid === child.pid && record.pid === main.pid, 'NFR_MAIN_EXIT_DISPOSE_MESSAGE_INVALID');
    } else throw new Error('NFR_MAIN_EXIT_HELPER_MESSAGE_UNEXPECTED');
    pulse();
  };
  const write = command => new Promise((resolve, reject) => {
    try {
      insist(child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded, 'NFR_MAIN_EXIT_HELPER_INPUT_CLOSED');
      child.stdin.write(JSON.stringify({ ...command, ownerToken }) + '\n', 'utf8', error => error ? reject(error) : resolve());
    } catch (error) { reject(error); }
  });
  const reaped = () => closeReceipt && (exitReceipt || !Number.isSafeInteger(child.pid)) ? { exit: exitReceipt, close: closeReceipt } : null;
  const normalHelperExit = receipt => insist(receipt.exit && receipt.exit.code === 0 && receipt.exit.signal === null
    && receipt.close.code === 0 && receipt.close.signal === null, 'NFR_MAIN_EXIT_HELPER_NOT_NORMAL');
  const dispose = (duration = timeoutMs) => {
    try { operationBudget(duration); }
    catch (error) { log('v16.main_exit_watch_dispose_budget_failed', error); return Promise.reject(error); }
    if (disposalPromise) return disposalPromise;
    disposalPromise = (async () => {
      budget(duration); disposalStarted = true;
      if (!child) return { watcherPid: null, exited: true, closed: true };
      const deadline = Date.now() + duration;
      let disposalFailure;
      try {
        if (!firstFailure && !closeReceipt && !exitRequested && child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) {
          await bounded(write({ command: 'dispose' }), Math.max(1, Math.floor(duration / 2)), 'NFR_MAIN_EXIT_DISPOSE_WRITE_TIMEOUT');
        }
      } catch (error) { disposalFailure = error; log('v16.main_exit_watch_dispose_command_failed', error); }
      try { if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end(); }
      catch (error) { disposalFailure ??= error; log('v16.main_exit_watch_eof_failed', error); }
      let receipt;
      try { receipt = await waitFor(reaped, Math.max(1, Math.floor((deadline - Date.now()) / 2)), 'NFR_MAIN_EXIT_HELPER_DISPOSE_TIMEOUT', true); }
      catch (error) {
        disposalFailure ??= error; log('v16.main_exit_watch_helper_reap_failed', error);
        // 只终止创建时缓存的观察器实例，永不根据 Main PID 终止业务进程。
        try { if (!closeReceipt && !exitReceipt && Number.isSafeInteger(child.pid) && child.pid > 0) child.kill('SIGKILL'); }
        catch (killError) { log('v16.main_exit_watch_owned_helper_kill_failed', killError); }
        try { receipt = await waitFor(reaped, Math.max(1, deadline - Date.now()), 'NFR_MAIN_EXIT_HELPER_CLOSE_NOT_OBSERVED', true); }
        catch (closeError) { log('v16.main_exit_watch_owned_helper_close_failed', closeError); }
      }
      if (disposalFailure) throw disposalFailure;
      insist(receipt, 'NFR_MAIN_EXIT_HELPER_CLOSE_NOT_OBSERVED'); normalHelperExit(receipt);
      return { watcherPid: child.pid, exited: true, closed: true, exitCode: receipt.exit.code, signalCode: receipt.exit.signal };
    })().catch(error => { log('v16.main_exit_watch_dispose_failed', error); throw error; });
    return disposalPromise;
  };
  const observeExit = (duration = timeoutMs) => {
    if (observationPromise) return observationPromise;
    observationPromise = (async () => {
      operationBudget(duration); if (firstFailure) throw firstFailure;
      insist(readyValue && !disposalStarted, 'NFR_MAIN_EXIT_WATCHER_NOT_READY');
      const deadline = Date.now() + duration; exitRequested = true;
      await bounded(write({ command: 'close', timeoutMs: duration }), remaining(deadline, 'NFR_MAIN_EXIT_CLOSE_WRITE_TIMEOUT'), 'NFR_MAIN_EXIT_CLOSE_WRITE_TIMEOUT');
      child.stdin.end();
      const proof = await waitFor(() => proofValue, Math.max(1, deadline - Date.now()), 'NFR_MAIN_EXIT_NOT_OBSERVED');
      const receipt = await waitFor(reaped, Math.max(1, deadline - Date.now()), 'NFR_MAIN_EXIT_HELPER_CLOSE_NOT_OBSERVED');
      normalHelperExit(receipt); return proof;
    })().catch(async error => {
      const original = firstFailure || error; fail(original);
      try { await dispose(timeoutMs); } catch (cleanupError) { log('v16.main_exit_watch_failure_cleanup_failed', cleanupError); }
      throw original;
    });
    return observationPromise;
  };
  try {
    budget(timeoutMs);
    insist(process.platform === 'win32', 'NFR_MAIN_EXIT_WINDOWS_REQUIRED');
    insist(main && Number.isSafeInteger(main.pid) && main.pid > 0 && Number.isSafeInteger(main.parentPid)
      && main.parentPid > 0 && main.pid !== main.parentPid && typeof main.executablePath === 'string'
      && path.win32.isAbsolute(main.executablePath) && !main.executablePath.includes('\0') && validTime(main.creationTimeUtc),
    'NFR_MAIN_EXIT_BOUND_IDENTITY_REQUIRED');
    main = Object.freeze({ ...main });
    const readyDeadline = Date.now() + timeoutMs;
    const executable = resolveTrustedWindowsPowerShell(process.env, { spawnSync: (file, args, options = {}) => {
      const left = remaining(readyDeadline, 'NFR_MAIN_EXIT_HANDLE_READY_TIMEOUT');
      return spawnSync(file, args, { ...options, timeout: Math.min(options.timeout ?? left, left) });
    } });
    remaining(readyDeadline, 'NFR_MAIN_EXIT_HANDLE_READY_TIMEOUT');
    child = spawn(executable.realPath, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'v16-performance-main-exit.ps1'), '-TargetProcessId', String(main.pid),
      '-TargetParentProcessId', String(main.parentPid), '-ExpectedExecutablePath', main.executablePath,
      '-ExpectedCreationTimeUtc', main.creationTimeUtc, '-OwnerToken', ownerToken, '-MaxWaitTimeoutMs', String(timeoutMs)], {
      env: minimalWindowsRuntimeEnvironment(process.env), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.once('error', error => fail(error));
    child.once('exit', (code, signal) => {
      exitReceipt = { code, signal };
      if (code !== 0 || signal !== null) fail(new Error('NFR_MAIN_EXIT_HELPER_NOT_NORMAL'));
      if (!disposalStarted && !exitRequested) fail(new Error('NFR_MAIN_EXIT_HELPER_EXITED_WITHOUT_PROOF'));
      pulse();
    });
    child.once('close', (code, signal) => {
      closeReceipt = { code, signal };
      if (output.trim()) fail(new Error('NFR_MAIN_EXIT_HELPER_PARTIAL_MESSAGE'));
      if (code !== 0 || signal !== null) fail(new Error('NFR_MAIN_EXIT_HELPER_NOT_NORMAL'));
      if (!disposalStarted && (!exitRequested || !proofValue)) fail(new Error('NFR_MAIN_EXIT_HELPER_EXITED_WITHOUT_PROOF'));
      pulse();
    });
    insist(Number.isSafeInteger(child.pid) && child.pid > 0 && child.pid !== main.pid, 'NFR_MAIN_EXIT_HELPER_PID_INVALID');
    insist(child.stdout && child.stderr && child.stdin, 'NFR_MAIN_EXIT_HELPER_STREAMS_REQUIRED');
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => {
      if (firstFailure) return;
      try {
        output += text; insist(output.length <= MAX_OUTPUT, 'NFR_MAIN_EXIT_HELPER_OUTPUT_LIMIT');
        let end;
        while ((end = output.indexOf('\n')) >= 0) {
          const line = output.slice(0, end).trim(); output = output.slice(end + 1);
          insist(line, 'NFR_MAIN_EXIT_HELPER_EMPTY_MESSAGE'); accept(JSON.parse(line));
        }
      } catch (error) { fail(error); }
    });
    child.stderr.on('data', text => {
      if (firstFailure) return;
      stderr = (stderr + text).slice(0, MAX_OUTPUT + 1);
      if (stderr.length > MAX_OUTPUT) fail(new Error('NFR_MAIN_EXIT_HELPER_STDERR_LIMIT'));
    });
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.on('error', error => fail(error));
    await waitFor(() => readyValue, remaining(readyDeadline, 'NFR_MAIN_EXIT_HANDLE_READY_TIMEOUT'), 'NFR_MAIN_EXIT_HANDLE_READY_TIMEOUT');
    return { ready: readyValue, observeExit, dispose };
  } catch (error) {
    const original = firstFailure || error; fail(original);
    try { await dispose(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1); }
    catch (cleanupError) { log('v16.main_exit_watch_open_cleanup_failed', cleanupError); }
    throw original;
  }
}

module.exports = { openMainExitWatcher };
