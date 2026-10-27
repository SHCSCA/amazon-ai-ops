import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRuntimeLogRecord } from '../packages/shared-types/src/runtime-log-format.cjs';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const defaultLog = (level, event, context) => process[level === 'error' ? 'stderr' : 'stdout'].write(
  `${JSON.stringify(createRuntimeLogRecord(level, event, context))}\n`);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const normalized = file => path.resolve(file).toLowerCase();
const statKeys = ['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink'];

function record(file) {
  const before = fs.lstatSync(file);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, '关闭收据必须是独立普通文件。');
  assert.equal(normalized(fs.realpathSync.native(file)), normalized(file));
  const bytes = fs.readFileSync(file), after = fs.lstatSync(file);
  const stat = value => Object.fromEntries(statKeys.map(key => [key, value[key]]));
  assert.deepEqual(stat(before), stat(after), '关闭收据读取期间变化。');
  return { path: file, sha256: sha(bytes), sizeBytes: bytes.length, stat: stat(after) };
}

export function createCloseReceiptWriter({ file, ownedRoot = path.dirname(file), maximumBytes = 2 * 1024 * 1024 }) {
  file = path.resolve(file); ownedRoot = path.resolve(ownedRoot);
  assert.equal(normalized(path.dirname(file)), normalized(ownedRoot), '关闭收据只能写入本轮拥有目录。');
  assert.ok(Number.isSafeInteger(maximumBytes) && maximumBytes > 0 && maximumBytes <= 2 * 1024 * 1024);
  let previous;
  return receipt => {
    const directory = fs.lstatSync(ownedRoot);
    assert.ok(directory.isDirectory() && !directory.isSymbolicLink());
    assert.equal(normalized(fs.realpathSync.native(ownedRoot)), normalized(ownedRoot));
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    assert.ok(bytes.length <= maximumBytes, '关闭收据超过保留上限。');
    if (previous) assert.deepEqual(record(file), previous, '关闭收据被外部修改。');
    else assert.equal(fs.existsSync(file), false, '关闭收据不得覆盖既有原件。');
    const temporary = path.join(ownedRoot, `${path.basename(file)}.tmp-${crypto.randomUUID()}`);
    let descriptor, created = false, result, firstError; const cleanupErrors = [];
    try {
      descriptor = fs.openSync(temporary, 'wx'); created = true;
      fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = undefined;
      // 首次以完整临时文件非覆盖发布；短暂双链接仅存在于移除本次临时名之前。
      if (!previous) { fs.linkSync(temporary, file); fs.unlinkSync(temporary); }
      else fs.renameSync(temporary, file);
      previous = record(file);
      assert.equal(previous.sha256, sha(bytes)); assert.equal(previous.sizeBytes, bytes.length);
      result = { path: previous.path, sha256: previous.sha256, sizeBytes: previous.sizeBytes };
    } catch (error) { firstError = error; }
    finally {
      for (const cleanup of [() => { if (descriptor !== undefined) fs.closeSync(descriptor); },
        () => { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary); }]) {
        try { cleanup(); } catch (error) {
          if (!firstError) firstError = error;
          else cleanupErrors.push({ name: error.name, message: error.message, code: error.code || null });
        }
      }
    }
    if (firstError) { firstError.receiptCleanupErrors = cleanupErrors; throw firstError; }
    return result;
  };
}

export function createPortableCloseController({ child, rpc, browser, runtimeIdentity, observedProcessIds,
  closeTimeoutMs = 45000, descendants, processes, extractionRemoved, now = Date.now,
  monotonic = () => performance.now(), sleep = wait, publish, logger = defaultLog,
  onFailure = () => {}, onClosed = () => {} }) {
  assert.equal(typeof publish, 'function', 'portable 关闭必须保存真实收据。');
  assert.ok(Number.isFinite(closeTimeoutMs) && closeTimeoutMs > 0);
  const identity = structuredClone(runtimeIdentity);
  const receipt = { kind: 'portable-runtime-close', schemaVersion: 1, status: 'IDLE', owner: identity,
    budget: { closeTimeoutMs, deadlineStartedAt: null, deadlineAt: null, startedMs: null, deadlineMs: null },
    events: { exit: null, close: null, error: null }, samples: [], transports: {}, errors: [] };
  let closePromise, firstError, artifact = null, frozen = false, failureNotified = false;
  const transports = new Map(), iso = () => new Date(now()).toISOString();
  function remember(stage, error) {
    firstError ??= error;
    receipt.errors.push({ stage, name: error.name, message: String(error.message).slice(0, 1000), code: error.code || null, cleanupErrors: error.receiptCleanupErrors || [] });
    try { logger('error', 'portable.close_observation_failed', { stage, message: error.message }); }
    catch (loggingError) { firstError ??= loggingError; receipt.errors.push({ stage: 'error-log', name: loggingError.name, message: String(loggingError.message).slice(0, 1000), code: loggingError.code || null }); }
  }
  function persist(event) {
    receipt.lastEvent = event; receipt.updatedAt = iso();
    try {
      const reference = publish(structuredClone(receipt));
      assert.ok(reference && typeof reference.path === 'string' && /^[a-f0-9]{64}$/i.test(reference.sha256)
        && Number.isSafeInteger(reference.sizeBytes) && reference.sizeBytes > 0, '关闭收据发布未得到真实原件引用。');
      artifact = reference;
    } catch (error) { remember('publish:' + event, error); }
  }
  const onExit = (exitCode, signal) => { if (!frozen) { receipt.events.exit = { observedAt: iso(), exitCode, signal }; if (closePromise) persist('child-exit'); } };
  const onClose = (exitCode, signal) => { if (!frozen) { receipt.events.close = { observedAt: iso(), exitCode, signal }; if (closePromise) persist('child-close'); } };
  const onError = error => { if (!frozen) { receipt.events.error = { observedAt: iso(), name: error.name, message: error.message }; remember('child-error', error); if (closePromise) persist('child-error'); } };
  child.once('exit', onExit); child.once('close', onClose); child.once('error', onError);
  function disconnect(name, target) {
    if (!transports.has(name)) transports.set(name, Promise.resolve().then(async () => {
      receipt.transports[name] = { startedAt: iso(), status: 'CLOSING' }; persist(name + '-close-started');
      try { await target.close(); receipt.transports[name].status = 'CLOSED'; }
      catch (error) { receipt.transports[name].status = 'FAILED'; receipt.transports[name].error = error.message; throw error; }
      finally { receipt.transports[name].finishedAt = iso(); persist(name + '-close-finished'); }
    }));
    return transports.get(name);
  }
  async function run() {
    receipt.status = 'CLOSING'; receipt.startedAt = iso(); persist('started');
    try {
      const queryStart = monotonic(); receipt.descendants = { startedAt: iso() };
      try {
        const tree = descendants(); receipt.descendants.processes = tree.processes; receipt.descendants.error = tree.error || null;
        assert.ok(!tree.error, tree.error); for (const item of tree.processes) observedProcessIds.add(Number(item.ProcessId));
      } finally { receipt.descendants.finishedAt = iso(); receipt.descendants.durationMs = monotonic() - queryStart; persist('descendants-finished'); }
      receipt.quitRequestedAt = iso(); persist('quit-requested');
      await rpc.request('Runtime.evaluate', { expression: identity.quitExpression, includeCommandLineAPI: true });
      receipt.quitAcknowledgedAt = iso(); persist('quit-acknowledged'); await disconnect('rpc', rpc);
      // 保留原45秒起算点；同步查询的实际耗时单独保存，不倒推超时根因。
      const startedMs = now(), deadlineMs = startedMs + closeTimeoutMs;
      Object.assign(receipt.budget, { startedMs, deadlineMs, deadlineStartedAt: iso(), deadlineAt: new Date(deadlineMs).toISOString() }); persist('deadline-started');
      let observedRemoved = false, completed = false;
      while (now() < deadlineMs) {
        assert.ok(receipt.samples.length < 128, '关闭采样超过保留上限。');
        const queryStart = monotonic(), sample = { queryStartedAt: iso(), requestedProcessIds: [...observedProcessIds], conditions: null };
        receipt.samples.push(sample);
        try {
          const snapshot = processes(sample.requestedProcessIds); sample.processes = snapshot.processes; sample.queryError = snapshot.error || null;
          assert.ok(!snapshot.error, snapshot.error);
          sample.launcher = { exitCode: child.exitCode, signalCode: child.signalCode };
          sample.conditions = { ownedProcessesRemoved: snapshot.processes.length === 0, launcherExited: child.exitCode !== null, extractionRemoved: extractionRemoved() };
          observedRemoved = Object.values(sample.conditions).every(Boolean);
        } finally { sample.queryFinishedAt = iso(); sample.queryDurationMs = monotonic() - queryStart; sample.deadlineExceededAfterQuery = now() >= deadlineMs; persist('sample'); }
        if (observedRemoved && receipt.events.exit && receipt.events.close) {
          assert.ok(now() < deadlineMs, 'portable 正常退出或解压清理未在期限内完成，保留现场。');
          assert.equal(child.exitCode, 0, 'portable 启动器非零退出。'); assert.equal(child.signalCode, null);
          for (const event of [receipt.events.exit, receipt.events.close]) { assert.equal(event.exitCode, 0); assert.equal(event.signal, null); }
          await disconnect('browser', browser); completed = true; break;
        }
        await sleep(500);
      }
      assert.ok(completed, 'portable 正常退出或解压清理未在期限内完成，保留现场。');
      if (!firstError) { try { onClosed(); } catch (error) { remember('closed-log', error); } }
    } catch (error) { remember('close', error); }
    finally {
      if (firstError) {
        for (const [name, target] of [['rpc', rpc], ['browser', browser]]) {
          try { await disconnect(name, target); } catch (error) { if (error !== firstError) remember('disconnect:' + name, error); }
        }
        try { child.unref(); } catch (error) { remember('unref', error); }
        try { onFailure(firstError); } catch (error) { remember('failure-log', error); }
        failureNotified = true;
      }
      receipt.status = firstError ? 'FAILED' : 'CLOSED'; receipt.finishedAt = iso(); persist('terminal');
      if (firstError && !failureNotified) {
        try { onFailure(firstError); } catch (error) { remember('failure-log', error); }
        receipt.status = 'FAILED'; persist('terminal-publication-failed');
      }
      receipt.status = firstError ? 'FAILED' : 'CLOSED'; frozen = true;
      child.removeListener('exit', onExit); child.removeListener('close', onClose); child.removeListener('error', onError);
    }
    if (firstError) throw firstError;
  }
  return {
    // 所有调用复用同一结果，失败后不再次发送退出或重开期限。
    close() { closePromise ??= Promise.resolve().then(run); return closePromise; },
    snapshot() { return structuredClone({ ...receipt, artifact }); },
  };
}

export function createIsolatedRuntimeCloser({ beforeClose, afterClose, onSettled = () => {}, logger = defaultLog }) {
  const operations = new WeakMap();
  return app => {
    if (!operations.has(app)) operations.set(app, Promise.resolve().then(async () => {
      let firstError, closed = false; const secondaryErrors = [];
      function remember(stage, error) {
        if (!firstError) firstError = error; else if (firstError !== error) secondaryErrors.push({ stage, name: error.name, message: error.message });
        try { logger('error', 'desktop.isolated_close_failed', { stage, message: error.message }); }
        catch (loggingError) { if (!firstError) firstError = loggingError; else secondaryErrors.push({ stage: 'error-log', name: loggingError.name, message: loggingError.message }); }
      }
      try { await beforeClose(app); } catch (error) { remember('preflight', error); }
      // 完整性失败仍关闭本轮应用，但原始错误继续使验收失败。
      try { await app.close(); closed = true; } catch (error) { remember('runtime-close', error); }
      if (closed) { try { await afterClose(app); } catch (error) { remember('postflight', error); } }
      try { await onSettled(app, { error: firstError || null, secondaryErrors }); } catch (error) { remember('receipt', error); }
      if (firstError) throw firstError;
    }));
    return operations.get(app);
  };
}
