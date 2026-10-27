import fs from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInspectorRpc, evaluationParameters, isStrictChild, PORTABLE_QUIT_EXPRESSION,
  verifyPortableObservation, verifyPortOwners } from './portable-desktop-runtime.mjs';

afterEach(() => vi.restoreAllMocks());

function observation() {
  const generatedAt = new Date().toISOString();
  const executable = 'G:\\Temp\\amazon-ai-ops-portable-123\\unpacked\\AmazonAIOpsAgent.exe';
  const core = { ProcessId: 202, ParentProcessId: 101, Name: 'AmazonAIOpsAgent.exe',
    ExecutablePath: executable, CreationDate: generatedAt, MainWindowHandle: 77,
    MainWindowTitle: 'Amazon AI Ops', WindowVisible: true };
  const profile = 'G:\\Temp\\amazon-ai-ops-profile-123';
  return {
    profile, marker: { pid: 202, mode: 'package-launch-smoke', overridden: true, userDataDir: profile, generatedAt },
    launcher: { processId: 101 }, descendants: [core], windowSnapshot: { processes: [core] },
    temporaryRoot: 'G:\\Temp\\amazon-ai-ops-portable-123', startedAt: Date.now() - 100,
    bindings: [12341, 12342].map((port) => ({ LocalPort: port, LocalAddress: '127.0.0.1', OwningProcess: 202 })),
    ports: [12341, 12342], actualHash: 'abc', expectedHash: 'abc',
  };
}

describe('portable runtime identity', () => {
  it('binds current marker, launcher lineage, visible window, core bytes and loopback owners', () => {
    expect(verifyPortableObservation(observation())).toMatchObject({ processId: 202, parentProcessId: 101, windowVisible: true });
  });

  it.each([
    ['canonical userData', (input) => { input.marker.userDataDir = 'C:\\Users\\operator\\AppData\\Roaming\\desktop'; }],
    ['wrong mode', (input) => { input.marker.mode = 'package-ui'; }],
    ['no explicit override', (input) => { input.marker.overridden = false; }],
    ['unrelated parent', (input) => { input.descendants[0].ParentProcessId = 303; }],
    ['cyclic lineage', (input) => { input.descendants[0].ParentProcessId = 202; }],
    ['stale process', (input) => { input.descendants[0].CreationDate = '2020-01-01T00:00:00.000Z'; }],
    ['stale marker', (input) => { input.marker.generatedAt = '2020-01-01T00:00:00.000Z'; }],
    ['foreign extraction', (input) => { input.descendants[0].ExecutablePath = 'G:\\Temp\\amazon-ai-ops-else\\AmazonAIOpsAgent.exe'; }],
    ['different bytes', (input) => { input.actualHash = 'def'; }],
    ['invisible window', (input) => { input.windowSnapshot.processes[0].WindowVisible = false; }],
    ['wrong TCP owner', (input) => { input.bindings[0].OwningProcess = 303; }],
    ['public TCP listener', (input) => { input.bindings[0].LocalAddress = '0.0.0.0'; }],
    ['missing TCP listener', (input) => { input.bindings.pop(); }],
  ])('rejects %s', (_name, change) => {
    const input = observation();
    change(input);
    expect(() => verifyPortableObservation(input)).toThrow();
  });

  it('accepts a complete multi-process launcher lineage and rejects an incomplete link', () => {
    const input = observation();
    input.descendants[0].ParentProcessId = 150;
    input.descendants.push({ ProcessId: 150, ParentProcessId: 101, CreationDate: new Date().toISOString() });
    expect(verifyPortableObservation(input).processId).toBe(202);
    input.descendants.pop();
    expect(() => verifyPortableObservation(input)).toThrow(/不属于本轮启动器/);
  });

  it('checks exact path segment containment and every listener on both ports', () => {
    expect(isStrictChild('G:\\Temp\\amazon-ai-ops-run', 'G:\\Temp\\amazon-ai-ops-run\\app')).toBe(true);
    for (const path of ['G:\\Temp\\amazon-ai-ops-run', 'G:\\Temp\\amazon-ai-ops-run-other\\app', 'C:\\Temp\\app']) {
      expect(isStrictChild('G:\\Temp\\amazon-ai-ops-run', path)).toBe(false);
    }
    const input = observation();
    input.bindings.push({ ...input.bindings[0], LocalAddress: '::', OwningProcess: 202 });
    expect(() => verifyPortOwners(input.bindings, input.ports, 202)).toThrow(/回环地址/);
  });
});

class FakeSocket extends EventTarget {
  static instances = [];
  static reply = undefined;
  readyState = 0;
  sent = [];
  constructor() {
    super();
    FakeSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); });
  }
  send(message) {
    const command = JSON.parse(message);
    this.sent.push(command);
    if (FakeSocket.reply) queueMicrotask(() => this.receive({ id: command.id, ...FakeSocket.reply }));
  }
  receive(reply) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(reply) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

describe('portable Main inspector transport', () => {
  afterEach(() => { FakeSocket.instances = []; FakeSocket.reply = undefined; });

  it('evaluates functions with the production Electron module and serialized arguments', () => {
    const input = { name: '含引号"与中文', nested: { value: 2 } };
    const parameters = evaluationParameters(({ app }, argument) => app.getPath(argument.name), input);
    expect(parameters).toMatchObject({ includeCommandLineAPI: true, returnByValue: true, awaitPromise: true });
    expect(parameters.expression).toContain("require('electron')");
    expect(parameters.expression).toContain(JSON.stringify(input));
    expect(evaluationParameters(() => 1).expression).toContain(', undefined)');
    expect(() => evaluationParameters('process.exit()')).toThrow();
  });

  it('captures Electron app before the inspector command-line require disappears', () => {
    const quit = vi.fn();
    const require = vi.fn(() => ({ app: { quit } }));
    let deferred;
    const context = createContext({ require, setTimeout: (callback, delay) => {
      expect(delay).toBe(100);
      deferred = callback;
    } });
    runInContext(PORTABLE_QUIT_EXPRESSION, context);
    expect(require).toHaveBeenCalledTimes(1);
    expect(require).toHaveBeenCalledWith('electron');
    expect(quit).not.toHaveBeenCalled();
    delete context.require;
    expect(() => deferred()).not.toThrow();
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('pairs concurrent commands by id and ignores unsolicited inspector events', async () => {
    const rpc = await createInspectorRpc('ws://127.0.0.1:1/test', { WebSocketImpl: FakeSocket });
    const socket = FakeSocket.instances[0];
    const first = rpc.request('Runtime.evaluate', { expression: '1' });
    const second = rpc.request('Runtime.evaluate', { expression: '2' });
    socket.receive({ method: 'Runtime.consoleAPICalled' });
    socket.receive({ id: socket.sent[1].id, result: { value: 2 } });
    socket.receive({ id: socket.sent[0].id, result: { value: 1 } });
    await expect(first).resolves.toEqual({ value: 1 });
    await expect(second).resolves.toEqual({ value: 2 });
    await rpc.close();
  });

  it('propagates protocol errors, closes pending requests, and bounds requests', async () => {
    FakeSocket.reply = { error: { message: '拒绝此请求' } };
    const rpc = await createInspectorRpc('ws://127.0.0.1:1/test', { WebSocketImpl: FakeSocket, timeoutMs: 20 });
    await expect(rpc.request('Runtime.evaluate', {})).rejects.toThrow('拒绝此请求');
    FakeSocket.reply = undefined;
    await expect(rpc.request('Runtime.evaluate', {})).rejects.toThrow(/请求超时/);
    const pending = expect(rpc.request('Runtime.evaluate', {})).rejects.toThrow(/正在关闭/);
    await rpc.close();
    await pending;
  });
});

describe('portable adapter safety contract', () => {
  it('uses the real launcher, dedicated TEMP/TMP, original identities and normal NSIS shutdown', () => {
    const source = fs.readFileSync(new URL('./portable-desktop-runtime.mjs', import.meta.url), 'utf8');
    for (const marker of ['child = spawn(executablePath', 'TEMP: temporaryRoot, TMP: temporaryRoot',
      'stdio: \'ignore\'', 'windowsDescendants(child.pid)', 'readPackageLaunchWindowReadyEvidence',
      'connectOverCDP', 'PORTABLE_EXECUTABLE_FILE', "const app = require('electron').app; setTimeout(() => app.quit(), 100)",
      '!fs.existsSync(runtimeIdentity.extractionRoot)', 'portable.close_failed']) expect(source).toContain(marker);
    expect(source).not.toMatch(/rmSync|rmdir|Remove-Item|taskkill|\.kill\(/);
    expect(source.split('\n').length).toBeLessThan(350);
  });
});

import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createCloseReceiptWriter, createPortableCloseController } from './portable-runtime-close.mjs';

function portableCloseFixture(options = {}) {
  let elapsed = 0;
  const epoch = Date.parse('2026-10-22T09:00:00.000Z');
  const child = Object.assign(new EventEmitter(), { pid: 101, exitCode: null, signalCode: null, unref: vi.fn() });
  child.on('error', () => {});
  const runtimeIdentity = { processId: 202, launcherPid: 101, extractionRoot: 'G:\\Temp\\portable-software\\unpacked',
    executableSha256: 'a'.repeat(64), quitExpression: PORTABLE_QUIT_EXPRESSION, marker: { pid: 202, generatedAt: '2026-10-22T08:59:59.000Z' } };
  const published = [];
  const advance = milliseconds => { elapsed += milliseconds; };
  const finish = ({ exitCode = 0, signal = null, exitEvent = true, closeEvent = true } = {}) => {
    child.exitCode = exitCode; child.signalCode = signal;
    if (exitEvent) child.emit('exit', exitCode, signal);
    if (closeEvent) child.emit('close', exitCode, signal);
  };
  const rpc = { request: vi.fn(async () => options.onQuit?.(fixture)), close: vi.fn(async () => options.onRpcClose?.(fixture)) };
  const browser = { close: vi.fn(async () => options.onBrowserClose?.(fixture)) };
  const descendants = vi.fn(() => options.onDescendants?.(fixture)
    ?? { processes: [{ ProcessId: 303, ParentProcessId: 202 }], error: null });
  const processes = vi.fn(ids => {
    if (options.onQuery) return options.onQuery(fixture, ids);
    finish(); return { processes: [], error: null };
  });
  const publish = vi.fn(receipt => {
    if (options.onPublish) return options.onPublish(receipt, fixture);
    const bytes = Buffer.from(JSON.stringify(receipt));
    published.push(JSON.parse(bytes.toString('utf8')));
    return { path: path.join(os.tmpdir(), 'portable-software-close-receipt.json'),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length };
  });
  const logger = vi.fn((...arguments_) => options.logger?.(...arguments_));
  const onFailure = vi.fn(error => options.onFailure?.(error)), onClosed = vi.fn(() => options.onClosed?.());
  const fixture = { child, runtimeIdentity, rpc, browser, descendants, processes, publish, published, advance, finish,
    logger, onFailure, onClosed, elapsed: () => elapsed, wall: () => epoch + elapsed };
  fixture.controller = createPortableCloseController({ child, rpc, browser, runtimeIdentity,
    observedProcessIds: new Set([101, 202]), descendants, processes,
    extractionRemoved: () => options.extractionRemoved?.(fixture) ?? true,
    now: fixture.wall, monotonic: fixture.elapsed, sleep: async milliseconds => {
      advance(milliseconds); options.onSleep?.(fixture, milliseconds);
    }, publish, logger, onFailure, onClosed });
  return fixture;
}

describe('portable normal close ownership and receipt', () => {
  it('shares the same close Promise across concurrent and completed calls with one real quit', async () => {
    const fixture = portableCloseFixture();
    const first = fixture.controller.close(), second = fixture.controller.close();
    await Promise.allSettled([first, second]);
    const third = fixture.controller.close(); await third;
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fixture.rpc.request).toHaveBeenCalledTimes(1);
    expect(fixture.rpc.request).toHaveBeenCalledWith('Runtime.evaluate', expect.objectContaining({ expression: PORTABLE_QUIT_EXPRESSION }));
    expect(fixture.descendants).toHaveBeenCalledTimes(1);
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
    expect(fixture.onClosed).toHaveBeenCalledTimes(1);
  });

  it('clones the full owner and publishes genuine exit and close event observations', async () => {
    const fixture = portableCloseFixture(), owner = structuredClone(fixture.runtimeIdentity);
    expect(fixture.controller.snapshot()).toMatchObject({ kind: 'portable-runtime-close', schemaVersion: 1, status: 'IDLE', owner });
    fixture.runtimeIdentity.marker.pid = 999;
    await fixture.controller.close();
    const receipt = fixture.controller.snapshot();
    expect(receipt).toMatchObject({ status: 'CLOSED', owner, events: {
      exit: { exitCode: 0, signal: null }, close: { exitCode: 0, signal: null }, error: null } });
    expect(receipt.events.exit.observedAt).toBe(new Date(fixture.wall()).toISOString());
    expect(receipt.events.close.observedAt).toBe(new Date(fixture.wall()).toISOString());
    expect(receipt.artifact).toMatchObject({ sha256: expect.stringMatching(/^[a-f0-9]{64}$/), sizeBytes: expect.any(Number) });
    expect(fixture.published.at(-1)).toMatchObject({ status: 'CLOSED', owner });
    expect(fixture.publish.mock.calls.length).toBeGreaterThan(0);
  });

  it('starts the unchanged 45000 ms deadline after descendants and inspector disconnect and retains timed samples', async () => {
    const fixture = portableCloseFixture({ onDescendants: current => {
      current.advance(1000); return { processes: [{ ProcessId: 303 }], error: null };
    }, onQuit: current => current.advance(250), onRpcClose: current => current.advance(750),
    onQuery: current => { current.advance(125); return { processes: [{ ProcessId: 202 }], error: null }; },
    extractionRemoved: () => false });
    await expect(fixture.controller.close()).rejects.toThrow();
    const receipt = fixture.controller.snapshot();
    expect(receipt).toMatchObject({ status: 'FAILED', budget: { closeTimeoutMs: 45000 } });
    expect(receipt.budget.startedMs).toBe(Date.parse('2026-10-22T09:00:02.000Z'));
    expect(receipt.budget.deadlineMs - receipt.budget.startedMs).toBe(45000);
    expect(Date.parse(receipt.budget.deadlineStartedAt)).toBe(receipt.budget.startedMs);
    expect(Date.parse(receipt.budget.deadlineAt)).toBe(receipt.budget.deadlineMs);
    expect(fixture.wall()).toBeGreaterThanOrEqual(receipt.budget.deadlineMs);
    expect(receipt.samples.length).toBeGreaterThan(0);
    expect(receipt.samples.length).toBeLessThanOrEqual(128);
    for (const sample of receipt.samples) {
      expect(sample.queryDurationMs).toBe(125);
      expect(Date.parse(sample.queryFinishedAt) - Date.parse(sample.queryStartedAt)).toBe(125);
      expect(new Set(sample.requestedProcessIds)).toEqual(new Set([101, 202, 303]));
      expect(sample.processes).toEqual([{ ProcessId: 202 }]);
      expect(sample.conditions).toEqual({ ownedProcessesRemoved: false, launcherExited: false, extractionRemoved: false });
    }
  });

  it('rejects zero exitCode without observing the actual child exit and close events', async () => {
    const fixture = portableCloseFixture({ onQuery: current => {
      current.finish({ exitEvent: false, closeEvent: false }); return { processes: [], error: null };
    } });
    await expect(fixture.controller.close()).rejects.toThrow();
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED', events: { exit: null, close: null } });
    expect(fixture.onClosed).not.toHaveBeenCalled();
  });

  it('rejects a nonempty launcher signal even when its exitCode is zero and all processes disappeared', async () => {
    const fixture = portableCloseFixture({ onQuery: current => {
      current.finish({ signal: 'SIGTERM' }); return { processes: [], error: null };
    } });
    await expect(fixture.controller.close()).rejects.toThrow();
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED', events: { exit: { signal: 'SIGTERM' } } });
    expect(fixture.onClosed).not.toHaveBeenCalled();
  });

  it('keeps all three original success gates and each owned process sample before normal close', async () => {
    let queryCount = 0;
    const fixture = portableCloseFixture({ onQuery: current => {
      if (++queryCount === 1) return { processes: [{ ProcessId: 303 }], error: null };
      current.finish(); return { processes: [], error: null };
    }, extractionRemoved: () => queryCount > 1 });
    await fixture.controller.close();
    const receipt = fixture.controller.snapshot();
    expect(receipt).toMatchObject({ status: 'CLOSED' });
    expect(receipt.samples).toHaveLength(2);
    expect(receipt.samples[0]).toMatchObject({ processes: [{ ProcessId: 303 }],
      conditions: { ownedProcessesRemoved: false, launcherExited: false, extractionRemoved: false },
      launcher: { exitCode: null, signalCode: null } });
    expect(receipt.samples[1]).toMatchObject({ processes: [],
      conditions: { ownedProcessesRemoved: true, launcherExited: true, extractionRemoved: true },
      launcher: { exitCode: 0, signalCode: null } });
    expect(Date.parse(receipt.samples[1].queryStartedAt) - Date.parse(receipt.samples[0].queryStartedAt)).toBe(500);
  });

  it('rejects an empty process result that finishes after the real 45000 ms close deadline', async () => {
    const fixture = portableCloseFixture({ onQuery: current => {
      current.advance(45001); current.finish(); return { processes: [], error: null };
    } });
    await expect(fixture.controller.close()).rejects.toThrow();
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED' });
    expect(fixture.onClosed).not.toHaveBeenCalled();
  });

  it.each(['descendants', 'processes', 'extractionRemoved'])('reuses the first %s error and logs a failed receipt without another quit', async stage => {
    const original = new Error(`software-only-${stage}`);
    const options = stage === 'descendants' ? { onDescendants: () => { throw original; } }
      : stage === 'processes' ? { onQuery: () => { throw original; } }
        : { extractionRemoved: () => { throw original; } };
    const fixture = portableCloseFixture(options), first = fixture.controller.close();
    await expect(first).rejects.toBe(original);
    const repeated = fixture.controller.close(); await expect(repeated).rejects.toBe(original);
    expect(repeated).toBe(first);
    expect(fixture.rpc.request).toHaveBeenCalledTimes(stage === 'descendants' ? 0 : 1);
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED' });
    expect(fixture.controller.snapshot().errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: original.message })]));
    expect(fixture.logger).toHaveBeenCalledWith('error', expect.any(String), expect.objectContaining({ message: original.message }));
    expect(fixture.onFailure).toHaveBeenCalledTimes(1);
    expect(fixture.onFailure).toHaveBeenCalledWith(original);
  });

  it('fails closed when receipt publication throws after a normal process exit', async () => {
    const original = new Error('software-only-publication');
    const fixture = portableCloseFixture({ onPublish: () => { throw original; } });
    await expect(fixture.controller.close()).rejects.toBe(original);
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED', artifact: null });
    expect(fixture.controller.snapshot().errors).toEqual(expect.arrayContaining([expect.objectContaining({ message: original.message })]));
    expect(fixture.onClosed).not.toHaveBeenCalled();
    expect(fixture.onFailure).toHaveBeenCalledWith(original);
  });

  it('preserves the original query failure when inspector or browser cleanup also fails', async () => {
    const original = new Error('software-only-original-query'), secondary = new Error('software-only-browser-cleanup');
    const fixture = portableCloseFixture({ onQuery: () => { throw original; }, onBrowserClose: () => { throw secondary; } });
    await expect(fixture.controller.close()).rejects.toBe(original);
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED' });
    expect(fixture.controller.snapshot().errors.map(error => error.message)).toEqual(expect.arrayContaining([original.message, secondary.message]));
    expect(fixture.rpc.request).toHaveBeenCalledTimes(1);
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
  });

  it('records a real child error event and never reports it as a successful close', async () => {
    const original = new Error('software-only-child-event');
    const fixture = portableCloseFixture({ onQuery: current => {
      current.child.emit('error', original); current.finish(); return { processes: [], error: null };
    } });
    await expect(fixture.controller.close()).rejects.toBe(original);
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED', events: { error: expect.objectContaining({ message: original.message }) } });
    expect(fixture.onClosed).not.toHaveBeenCalled();
  });

  it.each([null, { path: 'G:\\Temp\\invalid-close.json', sha256: 'a'.repeat(64), sizeBytes: 0 }])('fails closed when publication returns an invalid artifact reference %j', async reference => {
    const fixture = portableCloseFixture({ onPublish: () => reference });
    await expect(fixture.controller.close()).rejects.toThrow();
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED', artifact: null });
    expect(fixture.onClosed).not.toHaveBeenCalled();
  });

  it.each(['logger', 'onFailure', 'onClosed'])('captures the %s callback failure without masking an earlier error or reporting CLOSED', async callback => {
    const callbackError = new Error('software-only-' + callback);
    const original = callback === 'onClosed' ? callbackError : new Error('software-only-first-query');
    const options = { [callback]: () => { throw callbackError; } };
    if (callback !== 'onClosed') options.onQuery = () => { throw original; };
    const fixture = portableCloseFixture(options), first = fixture.controller.close();
    await expect(first).rejects.toBe(original);
    const repeated = fixture.controller.close(); await expect(repeated).rejects.toBe(original);
    expect(repeated).toBe(first);
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED' });
    expect(fixture.controller.snapshot().errors.map(error => error.message)).toContain(callbackError.message);
    expect(fixture.rpc.request).toHaveBeenCalledTimes(1);
  });

});

function withCloseReceiptDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-close-writer-'));
  try { return callback(directory); }
  finally {
    for (const name of fs.readdirSync(directory)) {
      const file = path.join(directory, name);
      if (!fs.lstatSync(file).isFile()) throw new Error('关闭收据测试只允许清理本轮普通文件。');
      fs.unlinkSync(file);
    }
    fs.rmdirSync(directory);
  }
}

describe('portable close receipt atomic writer', () => {
  it('publishes complete JSON with exact bytes and SHA and leaves one ordinary link', () => withCloseReceiptDirectory(directory => {
    const file = path.join(directory, 'receipt.json'), receipt = { kind: 'software-only-close', status: 'CLOSED', owner: { processId: 202 } };
    const write = createCloseReceiptWriter({ file }), reference = write(receipt), bytes = fs.readFileSync(file);
    expect(JSON.parse(bytes.toString('utf8'))).toEqual(receipt);
    expect(reference).toEqual({ path: file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length });
    expect(fs.lstatSync(file).nlink).toBe(1);
    expect(fs.readdirSync(directory)).toEqual(['receipt.json']);
  }));

  it('refuses to overwrite a foreign destination during first publication', () => withCloseReceiptDirectory(directory => {
    const file = path.join(directory, 'receipt.json'); fs.writeFileSync(file, 'foreign-original', { flag: 'wx' });
    expect(() => createCloseReceiptWriter({ file })({ status: 'FAILED' })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('foreign-original');
  }));

  it('replaces only its own unchanged prior receipt and rejects a subsequently tampered destination', () => withCloseReceiptDirectory(directory => {
    const file = path.join(directory, 'receipt.json'), write = createCloseReceiptWriter({ file });
    write({ status: 'CLOSING' }); write({ status: 'CLOSED' });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ status: 'CLOSED' });
    fs.writeFileSync(file, 'tampered-owned-receipt');
    expect(() => write({ status: 'FAILED' })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('tampered-owned-receipt');
    expect(fs.lstatSync(file).nlink).toBe(1);
  }));

  it('rejects receipts above the production 2 MiB limit before publishing any destination', () => withCloseReceiptDirectory(directory => {
    const file = path.join(directory, 'receipt.json'), write = createCloseReceiptWriter({ file });
    expect(() => write({ status: 'FAILED', payload: 'x'.repeat(2 * 1024 * 1024) })).toThrow();
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(directory)).toEqual([]);
  }));
});

describe('portable close production factory wiring', () => {
  it('uses the tested controller factory for the real portable launcher close method', () => {
    const source = fs.readFileSync(new URL('./portable-desktop-runtime.mjs', import.meta.url), 'utf8');
    expect(source).toMatch(/import\s*\{[^}]*createPortableCloseController[^}]*\}\s*from\s*['"]\.\/portable-runtime-close\.mjs['"]/);
    expect(source).toMatch(/createPortableCloseController\s*\(\s*\{/);
    expect(source).toMatch(/close\s*:\s*[A-Za-z_$][\w$]*\.close/);
  });
});

describe('portable close deadline terminal boundary', () => {
  it('rejects real exit and close events that arrive only after the last sleep crossed the original deadline', async () => {
    const fixture = portableCloseFixture({ onQuery: current => {
      current.finish({ exitEvent: false, closeEvent: false });
      return { processes: [], error: null };
    }, onSleep: current => {
      if (current.elapsed() >= 45000) current.finish();
    } });
    await expect(fixture.controller.close()).rejects.toThrow();
    expect(fixture.controller.snapshot()).toMatchObject({ status: 'FAILED' });
    expect(fixture.onClosed).not.toHaveBeenCalled();
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
  });
});

import { createIsolatedRuntimeStorage } from './isolated-desktop-target.mjs';
import { verifyPortableRuntimeStorage } from './portable-desktop-runtime.mjs';

function portableStorageFixture(driveRoot = 'G:\\', launchLabel = 'first') {
  const runtimeStorage = createIsolatedRuntimeStorage({ runtimeDrive: driveRoot }, `${driveRoot}AI\\repo`, '2026-10-22T10-00-00-000Z');
  return { runtimeStorage, launchLabel, profile: runtimeStorage.profile,
    temporaryRoot: path.win32.join(runtimeStorage.portableRoot, launchLabel) };
}

describe('portable explicitly selected runtime storage', () => {
  it.each(['first', 'restart'])('accepts the same selected F drive for %s without requiring the repository drive', label => {
    const input = portableStorageFixture('F:\\', label);
    expect(verifyPortableRuntimeStorage(input)).toBe(input.runtimeStorage);
    expect(input.profile).toBe(`F:\\Temp\\amazon-ai-ops-runtime-validation\\2026-10-22T10-00-00-000Z`);
    expect(input.temporaryRoot).toBe(`F:\\Temp\\amazon-ai-ops-portable-runtime\\2026-10-22T10-00-00-000Z\\${label}`);
  });

  it('preserves the default repository drive and distinct profile and extraction paths', () => {
    const input = portableStorageFixture();
    expect(verifyPortableRuntimeStorage(input)).toBe(input.runtimeStorage);
    expect(isStrictChild(input.profile, input.temporaryRoot)).toBe(false);
    expect(isStrictChild(input.temporaryRoot, input.profile)).toBe(false);
  });

  it('rejects missing mutable or altered frozen storage configuration', () => {
    const input = portableStorageFixture();
    for (const runtimeStorage of [undefined, { ...input.runtimeStorage },
      Object.freeze({ ...input.runtimeStorage, driveRoot: 'F:\\' }),
      Object.freeze({ ...input.runtimeStorage, profile: 'G:\\Temp\\amazon-ai-ops-foreign' }),
      Object.freeze({ ...input.runtimeStorage, portableRoot: 'G:\\Temp\\amazon-ai-ops-foreign' }),
      Object.freeze({ ...input.runtimeStorage, unknown: true })]) {
      expect(() => verifyPortableRuntimeStorage({ ...input, runtimeStorage })).toThrow();
    }
  });

  it('rejects a foreign profile root or extraction label even on the selected drive', () => {
    const input = portableStorageFixture();
    for (const change of [{ profile: 'G:\\Temp\\amazon-ai-ops-other' },
      { temporaryRoot: path.win32.join(input.runtimeStorage.portableRoot, 'restart') },
      { temporaryRoot: 'G:\\Temp\\amazon-ai-ops-other' },
      { temporaryRoot: 'F:\\Temp\\amazon-ai-ops-other' },
      { temporaryRoot: path.win32.join(input.runtimeStorage.portableRoot, '..', 'foreign') },
      { launchLabel: '../foreign' }, { launchLabel: 'first\\foreign' }, { launchLabel: 'other' }]) {
      expect(() => verifyPortableRuntimeStorage({ ...input, ...change })).toThrow();
    }
  });

  it('uses the same tested storage consumer before native launch and records the selected run configuration', () => {
    const portable = fs.readFileSync(new URL('./portable-desktop-runtime.mjs', import.meta.url), 'utf8');
    const verifier = fs.readFileSync(new URL('./verify-isolated-desktop-runtime.mjs', import.meta.url), 'utf8');
    const validate = portable.indexOf('verifyPortableRuntimeStorage({ runtimeStorage, launchLabel, profile, temporaryRoot });');
    expect(validate).toBeGreaterThan(-1);
    expect(validate).toBeLessThan(portable.indexOf('child = spawn(executablePath'));
    expect(verifier).toContain('runtimeStorage = createIsolatedRuntimeStorage(target, ROOT, RUN_ID)');
    expect(verifier).toContain('PROFILE = runtimeStorage.profile');
    expect(verifier).toContain('path.join(runtimeStorage.portableRoot, label)');
    expect(verifier).toContain('runtimeStorage, launchLabel: label');
    expect(verifier).toContain('report.runtimeStorage = runtimeStorage');
    expect(verifier).toContain('report.profile = PROFILE');
  });
});
