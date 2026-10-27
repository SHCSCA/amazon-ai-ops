import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import evidence from './evidence-user-data.js';
import smoke from './smoke-package-launch.js';
import { createPortableCloseController } from './portable-runtime-close.mjs';
import { createIsolatedRuntimeStorage } from './isolated-desktop-target.mjs';

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url));
const normalize = evidence.normalizeWindowsPath;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const PORTABLE_QUIT_EXPRESSION = "(() => { const app = require('electron').app; setTimeout(() => app.quit(), 100); })(); undefined";
const log = (level, event, context) => process[level === 'error' ? 'stderr' : 'stdout'].write(
  `${JSON.stringify({ timestamp: new Date().toISOString(), level, event, context })}\n`,
);

export function isStrictChild(root, candidate) {
  const relative = path.win32.relative(root, candidate);
  return Boolean(relative) && relative !== '..' && !relative.startsWith('..\\') && !path.win32.isAbsolute(relative);
}

function regularFile(file) {
  const resolved = path.resolve(file);
  assert.ok(fs.lstatSync(resolved).isFile(), '必须指定普通文件。');
  assert.equal(normalize(fs.realpathSync.native(resolved)), normalize(resolved), '文件不允许经过链接。');
  return resolved;
}

async function debugPorts() {
  const servers = [net.createServer(), net.createServer()];
  try {
    return await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    })));
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
  }
}

function portOwners(ports) {
  const result = spawnSync(process.env.AMAZON_AI_OPS_POWERSHELL_EXE || 'pwsh.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(${ports.join(',')}) } | Select-Object LocalPort,LocalAddress,OwningProcess) | ConvertTo-Json -Compress`,
  ], { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`监听端口检查失败：${result.error?.message || result.stderr}`);
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function verifyPortOwners(bindings, ports, processId) {
  for (const port of ports) {
    const owners = bindings.filter((binding) => Number(binding.LocalPort) === port);
    assert.ok(owners.length > 0, '调试端口尚未监听。');
    assert.ok(owners.every((binding) => Number(binding.OwningProcess) === processId
      && ['127.0.0.1', '::1'].includes(binding.LocalAddress)), '调试端口必须仅由本轮主进程在回环地址监听。');
  }
}

export function verifyPortableObservation({ marker, profile, launcher, descendants, windowSnapshot,
  temporaryRoot, startedAt, bindings, ports, actualHash, expectedHash }) {
  assert.equal(marker.overridden, true);
  assert.ok(evidence.validateEvidenceUserDataIdentity({ actualUserDataDir: marker.userDataDir,
    evidenceMode: marker.mode, expectedMode: evidence.PACKAGE_LAUNCH_SMOKE_MODE, expectedUserDataDir: profile }).passed);
  const records = new Map(descendants.map((item) => [Number(item.ProcessId), item]));
  let item = records.get(Number(marker.pid));
  const core = item;
  const seen = new Set();
  while (item && Number(item.ProcessId) !== launcher.processId) {
    assert.ok(!seen.has(Number(item.ProcessId)), '进程父子链存在环。');
    seen.add(Number(item.ProcessId));
    const created = Date.parse(item.CreationDate || '');
    assert.ok(created >= startedAt - 2000 && created <= Date.now() + 10000, '进程创建时间不属于本轮。');
    if (Number(item.ParentProcessId) === launcher.processId) break;
    item = records.get(Number(item.ParentProcessId));
  }
  assert.ok(item && Number(item.ParentProcessId) === launcher.processId, '实际主进程不属于本轮启动器。');
  assert.ok(isStrictChild(temporaryRoot, core.ExecutablePath), '实际主进程必须位于本轮解压目录。');
  assert.equal(actualHash, expectedHash, 'portable 主程序与当前目录包不一致。');
  const verified = smoke.selectVerifiedPortableRuntimeProcess({ passed: true, marker }, windowSnapshot, {
    allowedProcessIds: new Set(records.keys()), expectedCreationDate: core.CreationDate,
    expectedExecutablePath: core.ExecutablePath, notBeforeMs: startedAt,
  });
  assert.ok(verified, '实际可见窗口与 marker/进程身份不一致。');
  verifyPortOwners(bindings, ports, verified.processId);
  return verified;
}

export function evaluationParameters(fn, argument) {
  assert.equal(typeof fn, 'function', 'Main 求值只接受函数。');
  return { expression: `(${fn.toString()})(require('electron'), ${JSON.stringify(argument) ?? 'undefined'})`,
    includeCommandLineAPI: true, returnByValue: true, awaitPromise: true };
}

export async function createInspectorRpc(url, { WebSocketImpl = WebSocket, timeoutMs = 10000 } = {}) {
  const socket = new WebSocketImpl(url);
  const pending = new Map();
  let sequence = 0;
  const failPending = (error) => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  };
  socket.addEventListener('message', (event) => {
    try {
      const reply = JSON.parse(String(event.data));
      const entry = pending.get(reply.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(reply.id);
      if (reply.error) entry.reject(new Error(reply.error.message));
      else entry.resolve(reply.result);
    } catch (error) { log('error', 'portable.inspector_message_failed', { message: error.message }); failPending(error); }
  });
  socket.addEventListener('close', () => failPending(new Error('Main inspector 已断开。')));
  socket.addEventListener('error', () => failPending(new Error('Main inspector 连接失败。')));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Main inspector 连接超时。')); }, timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Main inspector 无法连接。')); }, { once: true });
  });
  return {
    request(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Main inspector 请求超时：${method}`)); }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    async close() {
      failPending(new Error('Main inspector 正在关闭。'));
      if (socket.readyState === 3) return;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.close();
      });
    },
  };
}

async function endpoint(port, node) {
  const response = await fetch(`http://127.0.0.1:${port}/json/${node ? 'list' : 'version'}`, { signal: AbortSignal.timeout(3000) });
  assert.ok(response.ok, '调试端点响应无效。');
  const value = await response.json();
  const url = new URL(node ? value.find((item) => item.type === 'node')?.webSocketDebuggerUrl : value.webSocketDebuggerUrl);
  assert.equal(url.protocol, 'ws:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(Number(url.port), port);
  return url.href;
}

export async function launchPortableDesktop({ executablePath, profile, temporaryRoot, env,
  expectedCoreExecutablePath, timeoutMs = 300000, closeTimeoutMs = 45000, publishCloseReceipt, runtimeStorage, launchLabel }) {
  let child;
  let rpc;
  let browser;
  try {
    assert.equal(process.platform, 'win32', 'portable 验收仅支持 Windows。');
    executablePath = regularFile(executablePath);
    expectedCoreExecutablePath = regularFile(expectedCoreExecutablePath);
    profile = evidence.validateEvidenceUserDataPath(profile);
    temporaryRoot = evidence.validateEvidenceUserDataPath(temporaryRoot);
    verifyPortableRuntimeStorage({ runtimeStorage, launchLabel, profile, temporaryRoot });
    assert.ok(!isStrictChild(temporaryRoot, profile) && !isStrictChild(profile, temporaryRoot)
      && normalize(profile) !== normalize(temporaryRoot), '解压目录与持久化资料目录必须独立。');
    assert.equal(fs.readdirSync(temporaryRoot).length, 0, '本轮解压根目录必须为空。');
    const expectedHash = hash(expectedCoreExecutablePath);
    const ports = await debugPorts();
    const startedAt = Date.now();
    const runtimeEnv = evidence.buildEvidenceUserDataEnv(env || process.env, evidence.PACKAGE_LAUNCH_SMOKE_MODE, profile);
    delete runtimeEnv.ELECTRON_RUN_AS_NODE;
    delete runtimeEnv.NODE_OPTIONS;
    Object.assign(runtimeEnv, { TEMP: temporaryRoot, TMP: temporaryRoot, NODE_ENV: 'production' });
    child = spawn(executablePath, [`--inspect=127.0.0.1:${ports[0]}`,
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${ports[1]}`], {
      env: runtimeEnv, cwd: path.dirname(executablePath), windowsHide: true, stdio: 'ignore',
    });
    let spawnError;
    child.on('error', (error) => { spawnError = error; log('error', 'portable.launcher_failed', { message: error.message }); });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const launcherSnapshot = smoke.windowsProcessesByIds([child.pid]);
    assert.ok(!launcherSnapshot.error, launcherSnapshot.error);
    const launched = launcherSnapshot.processes.find((item) => Number(item.ProcessId) === child.pid);
    assert.ok(launched && normalize(launched.ExecutablePath) === normalize(executablePath), '启动器进程身份未确认。');
    assert.ok(Date.parse(launched.CreationDate) >= startedAt - 2000, '启动器创建时间无效。');
    const launcher = { processId: child.pid, executablePath, creationDate: launched.CreationDate };
    const observedProcessIds = new Set([child.pid]);
    let runtimeIdentity;
    while (Date.now() < startedAt + timeoutMs) {
      if (spawnError) throw spawnError;
      assert.equal(child.exitCode, null, 'portable 启动器提前退出。');
      const marker = evidence.readEvidenceUserDataRuntimeMarker(profile).marker;
      if (marker && Date.parse(marker.generatedAt) >= startedAt - 2000) {
        const tree = smoke.windowsDescendants(child.pid);
        assert.ok(!tree.error, tree.error);
        for (const item of tree.processes) observedProcessIds.add(Number(item.ProcessId));
        const core = tree.processes.find((item) => Number(item.ProcessId) === Number(marker.pid));
        if (core) {
          const snapshot = smoke.windowsRuntimeWindowById(marker.pid);
          assert.ok(!snapshot.error, snapshot.error);
          if (snapshot.processes.some((item) => item.WindowVisible === true)) {
            const bindings = portOwners(ports);
            if (ports.every((port) => bindings.some((binding) => Number(binding.LocalPort) === port))) {
              const actualPath = regularFile(core.ExecutablePath);
              assert.ok(isStrictChild(temporaryRoot, path.dirname(actualPath)), '解压应用必须位于本轮临时根的子目录。');
              const verified = verifyPortableObservation({ marker, profile, launcher, descendants: tree.processes,
                windowSnapshot: snapshot, temporaryRoot, startedAt, bindings, ports, actualHash: hash(actualPath), expectedHash });
              const ready = smoke.readPackageLaunchWindowReadyEvidence(profile, { expectedPid: verified.processId,
                expectedRendererPath: smoke.packagedRendererPathForExecutable(actualPath), expectedUserDataDir: profile,
                notBeforeMs: startedAt, runtimeMarkerGeneratedAt: marker.generatedAt });
              if (ready.state === 'missing') { await wait(500); continue; }
              assert.ok(ready.passed, JSON.stringify(ready.violations));
              runtimeIdentity = { ...verified, launcherPid: child.pid, launcherCreationDate: launcher.creationDate,
                launcherExecutablePath: executablePath, launcherSha256: hash(executablePath), executablePath: actualPath,
                executableSha256: expectedHash, extractionRoot: path.dirname(actualPath), temporaryRoot, ports, marker, ready };
              break;
            }
          }
        }
      }
      await wait(500);
    }
    assert.ok(runtimeIdentity, 'portable 未在期限内产生已验证的可见主窗口。');
    rpc = await createInspectorRpc(await endpoint(ports[0], true));
    const evaluate = async (fn, argument) => {
      try {
        const result = await rpc.request('Runtime.evaluate', evaluationParameters(fn, argument));
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result?.value;
      } catch (error) { log('error', 'portable.main_evaluation_failed', { message: error.message }); throw error; }
    };
    const observed = await evaluate(() => ({ pid: process.pid, executablePath: process.execPath,
      launcher: process.env.PORTABLE_EXECUTABLE_FILE }));
    assert.equal(observed.pid, runtimeIdentity.processId);
    assert.equal(normalize(observed.executablePath), normalize(runtimeIdentity.executablePath));
    assert.equal(normalize(observed.launcher), normalize(executablePath));
    verifyPortOwners(portOwners(ports), ports, runtimeIdentity.processId);
    browser = await require('playwright').chromium.connectOverCDP(await endpoint(ports[1], false), { timeout: 15000 });
    const closeController = createPortableCloseController({ child, rpc, browser,
      runtimeIdentity: { ...runtimeIdentity, quitExpression: PORTABLE_QUIT_EXPRESSION }, observedProcessIds, closeTimeoutMs,
      descendants: () => smoke.windowsDescendants(child.pid), processes: ids => smoke.windowsProcessesByIds(ids),
      extractionRemoved: () => !fs.existsSync(runtimeIdentity.extractionRoot), publish: publishCloseReceipt, logger: log,
      onClosed: () => log('info', 'portable.runtime_closed', { launcherPid: child.pid, processId: runtimeIdentity.processId, launcherExitCode: child.exitCode }),
      onFailure: error => log('error', 'portable.close_failed', { message: error.message, runtimeIdentity }),
    });
    log('info', 'portable.runtime_attached', runtimeIdentity);
    return {
      runtimeIdentity, process: () => child,
      async firstWindow() {
        const context = browser.contexts()[0];
        assert.ok(context, '实际 Electron 浏览器上下文不存在。');
        const expected = runtimeIdentity.ready.marker.rendererUrl;
        return context.pages().find((page) => page.url() === expected)
          || context.waitForEvent('page', { predicate: (page) => page.url() === expected, timeout: 30000 });
      },
      evaluate,
      close: closeController.close, closeReceipt: closeController.snapshot,
    };
  } catch (error) {
    try { await rpc?.close(); } catch (cleanupError) { log('error', 'portable.inspector_cleanup_failed', { message: cleanupError.message }); }
    try { await browser?.close(); } catch (cleanupError) { log('error', 'portable.cdp_cleanup_failed', { message: cleanupError.message }); }
    child?.unref();
    log('error', 'portable.verification_failed', { message: error.message, launcherPid: child?.pid, temporaryRoot });
    throw error;
  }
}

export function verifyPortableRuntimeStorage({ runtimeStorage, launchLabel, profile, temporaryRoot }) {
  assert.ok(runtimeStorage && Object.isFrozen(runtimeStorage), '运行存储配置必须来自已冻结的可信入口。');
  assert.deepEqual(runtimeStorage, createIsolatedRuntimeStorage({ runtimeDrive: runtimeStorage.driveRoot }, runtimeStorage.driveRoot, runtimeStorage.runId));
  assert.ok(['first', 'restart'].includes(launchLabel), '便携启动阶段无效。');
  assert.equal(normalize(profile), normalize(runtimeStorage.profile), '资料目录与所选运行配置不一致。');
  assert.equal(normalize(temporaryRoot), normalize(path.win32.join(runtimeStorage.portableRoot, launchLabel)), '解压目录与所选运行配置不一致。');
  return runtimeStorage;
}
