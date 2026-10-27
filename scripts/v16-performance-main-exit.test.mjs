import fs from 'node:fs';
import path from 'node:path';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const adapterPath = fileURLToPath(new URL('./v16-performance-main-exit.js', import.meta.url));
const adapterSource = fs.readFileSync(adapterPath, 'utf8');
const helperBytes = fs.readFileSync(new URL('./v16-performance-main-exit.ps1', import.meta.url));
const ownerToken = '00000000-0000-4000-8000-000000000001';
const main = { pid: 41_001, parentPid: 41_000, executablePath: 'G:\\unit-only\\AmazonAIOpsAgent.exe',
  creationTimeUtc: '2026-10-20T08:00:00.1234560Z' };
const handleCreationTimeUtc = '2026-10-20T08:00:00.1234567Z';
const timeoutMs = 1_000;
const precision = 'cim-microsecond+handle-100ns';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T08:00:01.000Z')); });
afterEach(() => { vi.useRealTimers(); });

function fixture(options = {}) {
  // ChildProcess 和流均为局部替身，固定 PID 只参与协议断言，不接触操作系统。
  const child = new ChildProcess(); child.pid = Object.hasOwn(options, 'helperPid') ? options.helperPid : 42_001;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const commands = [], logs = [];
  let input = '', finished = false, closeReceived = false, eof = false;
  const observedAt = () => new Date().toISOString().replace(/\.(\d{3})Z$/, (_whole, fraction) => '.' + fraction + '0000Z');
  const identity = () => ({ schemaVersion: 1, ownerToken, watcherPid: child.pid, ...main,
    handleCreationTimeUtc, creationPrecision: precision });
  const ready = () => ({ ...identity(), kind: 'v16-main-exit-ready', handleAcquired: true, observedAt: observedAt() });
  const proof = () => ({ ...identity(), kind: 'v16-main-exit-proof', exited: true,
    exitCode: options.mainExitCode ?? 0, signalCode: null, observedAt: observedAt() });
  const send = record => child.stdout.write(JSON.stringify(record) + '\n');
  const finish = (code = 0, signal = null, omitClose = false) => {
    if (finished) return;
    finished = true; child.exitCode = code; child.signalCode = signal;
    child.stdout.end(); child.stderr.end(); child.emit('exit', code, signal);
    if (!omitClose) child.emit('close', code, signal);
  };
  child.kill = vi.fn(function (signal) {
    queueMicrotask(() => finish(null, signal)); return true;
  });
  child.stdin.on('data', chunk => {
    input += chunk.toString(); let end;
    while ((end = input.indexOf('\n')) >= 0) {
      const command = JSON.parse(input.slice(0, end)); input = input.slice(end + 1); commands.push(command);
      if (command.command === 'dispose') {
        if (!options.ignoreEof) {
          send({ kind: 'v16-main-exit-disposed', ownerToken, watcherPid: child.pid, pid: main.pid });
          queueMicrotask(() => finish());
        }
      } else if (command.command === 'close') {
        closeReceived = true;
        if (!options.silentExit) {
          send({ ...proof(), ...options.proofChange });
          queueMicrotask(() => finish(options.helperExitCode ?? 0, null, options.omitClose));
        }
      }
    }
  });
  child.stdin.on('end', () => {
    eof = true;
    if (!closeReceived && !options.ignoreEof) queueMicrotask(() => finish());
  });
  const spawn = vi.fn(() => {
    queueMicrotask(() => {
      if (options.spawnError) { child.emit('error', options.spawnError); return; }
      if (options.helperError) { send({ ...identity(), kind: 'v16-main-exit-error', message: options.helperError, name: 'UnitHelperError' }); return; }
      if (options.malformed) { child.stdout.write('{malformed\n'); return; }
      if (!options.silentReady) send({ ...ready(), ...options.readyChange });
    });
    return child;
  });
  const spawnSync = vi.fn(() => ({ status: 0, signal: null, stdout: '{}', stderr: '' }));
  const resolveTrustedWindowsPowerShell = vi.fn((_env, dependencies) => {
    dependencies.spawnSync('C:\\Windows\\System32\\fsutil.exe', ['unit-only'], { timeout: 20_000 });
    if (options.trustElapsedMs) vi.setSystemTime(Date.now() + options.trustElapsedMs);
    if (!options.stopTrustAfterFirst) dependencies.spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['unit-only'], { timeout: 30_000 });
    if (options.trustError) throw options.trustError;
    return { realPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' };
  });
  const nativeProcess = { platform: options.platform ?? 'win32', env: { SystemRoot: 'C:\\Windows' },
    stderr: { write: vi.fn() }, kill: vi.fn(() => { throw new Error('UNIT_BARE_PID_KILL_FORBIDDEN'); }) };
  const writer = { log: vi.fn((event, error, context) => {
    logs.push({ event, error, context }); if (options.writerError) throw options.writerError;
  }) };
  const module = { exports: {} };
  const dependencies = {
    'node:path': path,
    'node:child_process': { spawn, spawnSync },
    'node:crypto': { randomUUID: () => ownerToken },
    './s7-launch-operator-security': { resolveTrustedWindowsPowerShell,
      minimalWindowsRuntimeEnvironment: vi.fn(() => ({ SYSTEMROOT: 'C:\\Windows' })) },
    '../packages/shared-types/src/runtime-log-format.cjs': { createRuntimeLogRecord: (level, event, context) => ({ level, event, context }) },
  };
  const wrapper = runInNewContext('(function (exports, require, module, __filename, __dirname) {\n' + adapterSource + '\n})',
    { process: nativeProcess, setTimeout, clearTimeout, Date, Promise }, { filename: adapterPath });
  wrapper(module.exports, name => {
    if (!Object.hasOwn(dependencies, name)) throw new Error('UNIT_UNEXPECTED_DEPENDENCY:' + name);
    return dependencies[name];
  }, module, adapterPath, path.dirname(adapterPath));
  return { child, commands, logs, spawn, spawnSync, resolveTrustedWindowsPowerShell, nativeProcess, writer, send, finish, ready, proof,
    eof: () => eof, open: (change = {}) => module.exports.openMainExitWatcher({ main, timeoutMs, writer, label: 'unit-only', ...change }) };
}

describe('独立 Main 持句柄退出观察器', () => {
  it('ready 验证完整身份与独立 helper PID并通过可信 PowerShell File 无 shell 启动', async () => {
    const f = fixture(), watcher = await f.open();
    expect(f.child).toBeInstanceOf(ChildProcess);
    expect(watcher.ready).toMatchObject({ ...main, watcherPid: f.child.pid, handleAcquired: true,
      handleCreationTimeUtc, creationPrecision: precision });
    expect(Object.isFrozen(watcher.ready)).toBe(true);
    expect(f.spawn).toHaveBeenCalledWith('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      expect.arrayContaining(['-File', path.join(path.dirname(adapterPath), 'v16-performance-main-exit.ps1'),
        '-TargetProcessId', String(main.pid), '-TargetParentProcessId', String(main.parentPid), '-OwnerToken', ownerToken]),
      expect.objectContaining({ shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    expect(f.resolveTrustedWindowsPowerShell.mock.calls[0][1].spawnSync).toBeTypeOf('function');
    expect(f.spawnSync.mock.calls.map(call => call[2].timeout)).toEqual([timeoutMs, timeoutMs]);
    await watcher.dispose(timeoutMs);
  });

  it('可信解析器每次内部调用均受同一 ready deadline 剩余预算约束', async () => {
    const f = fixture({ trustElapsedMs: 300 }), watcher = await f.open();
    expect(f.spawnSync.mock.calls.map(call => call[2].timeout)).toEqual([1_000, 700]);
    await watcher.dispose(timeoutMs);
  });

  it('可信解析器耗尽原预算后不得启动 observer', async () => {
    const f = fixture({ trustElapsedMs: timeoutMs, stopTrustAfterFirst: true });
    await expect(f.open()).rejects.toThrow('NFR_MAIN_EXIT_HANDLE_READY_TIMEOUT');
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['Main PID', { pid: main.pid + 1 }],
    ['父进程 PID', { parentPid: main.parentPid + 1 }],
    ['EXE', { executablePath: 'G:\\unit-only\\other.exe' }],
    ['CIM 创建时刻', { creationTimeUtc: '2026-10-20T08:00:00.1234570Z' }],
    ['句柄创建时刻', { handleCreationTimeUtc: '2026-10-20T08:00:00.1234557Z' }],
    ['helper PID', { watcherPid: 43_001 }],
    ['未持有句柄', { handleAcquired: false }],
    ['所有权 token', { ownerToken: '00000000-0000-4000-8000-000000000002' }],
    ['毫秒降精度', { creationTimeUtc: '2026-10-20T08:00:00.123Z' }],
  ])('ready 的%s不匹配保持失败并以 EOF 回收 helper', async (_name, readyChange) => {
    const f = fixture({ readyChange });
    await expect(f.open()).rejects.toThrow(/NFR_MAIN_EXIT_/);
    expect(f.commands).toEqual([]); expect(f.eof()).toBe(true);
    expect(f.child.kill).not.toHaveBeenCalled(); expect(f.nativeProcess.kill).not.toHaveBeenCalled();
  });

  it('Main 真退出0返回Main PID与同一句柄时刻并核helper exit和close', async () => {
    const f = fixture(), watcher = await f.open();
    const first = watcher.observeExit(timeoutMs), second = watcher.observeExit(timeoutMs);
    expect(first).toBe(second);
    const proof = await first;
    expect(proof).toMatchObject({ pid: main.pid, exited: true, exitCode: 0, signalCode: null,
      creationTimeUtc: main.creationTimeUtc, handleCreationTimeUtc });
    expect(proof.pid).not.toBe(f.child.pid);
    expect(f.commands).toEqual([{ command: 'close', timeoutMs, ownerToken }]);
    expect(await watcher.dispose(timeoutMs)).toMatchObject({ watcherPid: f.child.pid, exited: true, closed: true, exitCode: 0 });
  });

  it('Main 非零退出仍返回真实 proof 而不会代填0', async () => {
    const f = fixture({ mainExitCode: 9 }), watcher = await f.open();
    expect(await watcher.observeExit(timeoutMs)).toMatchObject({ pid: main.pid, exitCode: 9, exited: true });
    await watcher.dispose(timeoutMs);
  });

  it('observeExit 不能把原 timeoutMs 扩大且失败后仍回收 helper', async () => {
    const f = fixture(), watcher = await f.open();
    await expect(watcher.observeExit(timeoutMs + 1)).rejects.toThrow('NFR_MAIN_EXIT_TIMEOUT_EXCEEDS_ORIGINAL');
    expect(f.commands.some(command => command.command === 'close')).toBe(false);
    expect(f.eof()).toBe(true); expect(f.child.kill).not.toHaveBeenCalled();
  });

  it('exit proof 同微秒但句柄七位时刻改变仍被拒绝', async () => {
    const f = fixture({ proofChange: { handleCreationTimeUtc: '2026-10-20T08:00:00.1234568Z' } }), watcher = await f.open();
    await expect(watcher.observeExit(timeoutMs)).rejects.toThrow('NFR_MAIN_EXIT_PROOF_IDENTITY_MISMATCH');
    expect(f.nativeProcess.kill).not.toHaveBeenCalled();
  });

  it('Main 未退出按原预算失败且只可终止缓存自有 observer 实例', async () => {
    const f = fixture({ silentExit: true, ignoreEof: true }), watcher = await f.open();
    const result = watcher.observeExit(timeoutMs).catch(error => error);
    await vi.advanceTimersByTimeAsync(3 * timeoutMs);
    expect((await result).message).toBe('NFR_MAIN_EXIT_NOT_OBSERVED');
    expect(f.child.kill).toHaveBeenCalledOnce(); expect(f.child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(f.child.kill.mock.instances[0]).toBe(f.child);
    expect(f.nativeProcess.kill).not.toHaveBeenCalled();
    expect(f.logs.some(row => row.event === 'v16.main_exit_watch_failed')).toBe(true);
  });

  it('ready 超时保持原错误并有界回收不响应 EOF 的 helper', async () => {
    const f = fixture({ silentReady: true, ignoreEof: true });
    const result = f.open().catch(error => error);
    await vi.advanceTimersByTimeAsync(3 * timeoutMs);
    expect((await result).message).toBe('NFR_MAIN_EXIT_HANDLE_READY_TIMEOUT');
    expect(f.child.kill).toHaveBeenCalledOnce(); expect(f.nativeProcess.kill).not.toHaveBeenCalled();
  });

  it('ready 消耗可信解析后只等待剩余预算', async () => {
    const f = fixture({ trustElapsedMs: 600, silentReady: true });
    const result = f.open().catch(error => error);
    await vi.advanceTimersByTimeAsync(399);
    expect(f.logs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).message).toBe('NFR_MAIN_EXIT_HANDLE_READY_TIMEOUT');
    expect(f.child.kill).not.toHaveBeenCalled();
  });

  it('spawn error 保留原 Error 身份且不查杀 Main', async () => {
    const original = new Error('UNIT_SPAWN_ERROR'), f = fixture({ spawnError: original });
    await expect(f.open()).rejects.toBe(original);
    expect(f.logs[0].error).toBe(original); expect(f.nativeProcess.kill).not.toHaveBeenCalled();
  });

  it('malformed stdout 失败并通过 EOF 正常回收', async () => {
    const f = fixture({ malformed: true });
    await expect(f.open()).rejects.toThrow();
    expect(f.eof()).toBe(true); expect(f.child.exitCode).toBe(0); expect(f.child.kill).not.toHaveBeenCalled();
  });

  it('helper 结构化错误保留原消息且不会制造 Main exit proof', async () => {
    const f = fixture({ helperError: 'UNIT_HANDLE_ACCESS_DENIED' });
    await expect(f.open()).rejects.toThrow('UNIT_HANDLE_ACCESS_DENIED');
    expect(f.commands).toEqual([]); expect(f.child.kill).not.toHaveBeenCalled();
  });

  it('helper 非零退出使 Main 退出观察失败', async () => {
    const f = fixture({ helperExitCode: 7 }), watcher = await f.open();
    await expect(watcher.observeExit(timeoutMs)).rejects.toThrow('NFR_MAIN_EXIT_HELPER_NOT_NORMAL');
    expect(f.child.exitCode).toBe(7); expect(f.nativeProcess.kill).not.toHaveBeenCalled();
  });

  it('只有 helper exit 没有 close 不能获得完整回收信用', async () => {
    const f = fixture({ omitClose: true }), watcher = await f.open();
    const result = watcher.observeExit(timeoutMs).catch(error => error);
    await vi.advanceTimersByTimeAsync(3 * timeoutMs);
    expect((await result).message).toBe('NFR_MAIN_EXIT_HELPER_CLOSE_NOT_OBSERVED');
    expect(f.child.kill).not.toHaveBeenCalled(); expect(f.nativeProcess.kill).not.toHaveBeenCalled();
  });

  it('dispose 仅发送自有 token 并结束 stdin，幂等回收且不证明 Main 已退出', async () => {
    const f = fixture(), watcher = await f.open();
    const stdinEnd = new Promise(resolve => f.child.stdin.once('end', resolve));
    const first = watcher.dispose(timeoutMs), second = watcher.dispose(timeoutMs);
    expect(first).toBe(second); expect(await first).toMatchObject({ watcherPid: f.child.pid, exitCode: 0, closed: true });
    expect(f.child.stdin.writableEnded).toBe(true); await stdinEnd;
    expect(f.commands).toEqual([{ command: 'dispose', ownerToken }]); expect(f.eof()).toBe(true);
    expect(f.child.kill).not.toHaveBeenCalled(); expect(f.nativeProcess.kill).not.toHaveBeenCalled();
    await expect(watcher.observeExit(timeoutMs)).rejects.toThrow('NFR_MAIN_EXIT_WATCHER_NOT_READY');
  });

  it('日志失败仍保留首先发生的 Error', async () => {
    const original = new Error('UNIT_TRUST_FAILED'), f = fixture({ trustError: original, writerError: new Error('UNIT_LOG_FAILED') });
    await expect(f.open()).rejects.toBe(original);
    expect(f.nativeProcess.stderr.write).toHaveBeenCalled(); expect(f.spawn).not.toHaveBeenCalled();
  });

  it('无效身份或平台在启动 helper 前拒绝', async () => {
    const f = fixture();
    await expect(f.open({ main: { ...main, pid: main.parentPid } })).rejects.toThrow('NFR_MAIN_EXIT_BOUND_IDENTITY_REQUIRED');
    expect(f.spawn).not.toHaveBeenCalled();
    const other = fixture({ platform: 'linux' });
    await expect(other.open()).rejects.toThrow('NFR_MAIN_EXIT_WINDOWS_REQUIRED');
    expect(other.spawn).not.toHaveBeenCalled();
  });

  it('PS5 helper 以 UTF8 BOM 交付并持同一进程句柄直到 finally Dispose', () => {
    expect([...helperBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const helper = helperBytes.toString('utf8');
    expect(helper).toContain('$heldHandle = $target.Handle');
    expect(helper.indexOf('$heldHandle = $target.Handle')).toBeLessThan(helper.indexOf("$ready.kind = 'v16-main-exit-ready'"));
    expect(helper).toContain('$target.WaitForExit([int]$command.timeoutMs)');
    expect(helper).toContain('$proof.exitCode = [int]$target.ExitCode');
    expect(helper).toContain('if ($null -eq $line) { break }');
    expect(helper).toContain('try { $target.Dispose() }');
    expect(helper).not.toMatch(/Stop-Process|taskkill|\.Kill\s*\(/i);
  });
});

describe('Main观察器自有PID和idle退出边界', () => {
  it.each([['缺失', undefined], ['零', 0], ['负数', -1], ['等于Main', main.pid]])('helper PID%s在ready验收前拒绝并回收自有实例', async (_label, helperPid) => {
    const f = fixture({ helperPid });
    await expect(f.open()).rejects.toThrow('NFR_MAIN_EXIT_HELPER_PID_INVALID');
    expect(f.eof()).toBe(true); expect(f.nativeProcess.kill).not.toHaveBeenCalled();
  });

  it('ready后尚未发送close命令的exit0即刻失败而不等待延迟close', async () => {
    const f = fixture({ ignoreEof: true }), watcher = await f.open();
    f.child.exitCode = 0; f.child.emit('exit', 0, null);
    expect(f.logs.some(row => row.error?.message === 'NFR_MAIN_EXIT_HELPER_EXITED_WITHOUT_PROOF')).toBe(true);
    const pending = watcher.observeExit(timeoutMs);
    const rejected = expect(pending).rejects.toThrow('NFR_MAIN_EXIT_HELPER_EXITED_WITHOUT_PROOF');
    await Promise.resolve();
    expect(f.commands.some(command => command.command === 'close')).toBe(false);
    f.finish(); await rejected;
    expect(f.nativeProcess.kill).not.toHaveBeenCalled();
  });
});
