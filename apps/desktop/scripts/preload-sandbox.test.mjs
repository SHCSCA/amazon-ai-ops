import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { writeSandboxFixtures } from './preload-sandbox.test-support.mjs';

const require = createRequire(import.meta.url);
const { buildPreload } = require('./build-preload.js');
const desktopDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let report;

beforeAll(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-preload-sandbox-'));
  const preload = path.join(directory, 'production-preload.cjs');
  const productionBuild = buildPreload({ outfile: preload });
  fs.writeFileSync(path.join(directory, 'production-preload-metafile.json'), JSON.stringify(productionBuild.metafile, null, 2));
  const main = writeSandboxFixtures(directory, desktopDirectory, preload);
  const boundFiles = [preload, `${preload}.map`, main, path.join(directory, 'renderer.js'),
    fileURLToPath(import.meta.url), path.join(desktopDirectory, 'scripts/preload-sandbox.test-support.mjs'),
    path.join(desktopDirectory, 'scripts/build-preload.js'),
    path.join(desktopDirectory, 'src/main/runtime-error-handlers.ts'),
    path.join(desktopDirectory, 'src/renderer/startup-error-boundary.tsx'),
    path.join(desktopDirectory, 'src/renderer/mission-control/bridge/window-api.ts'),
    ...Object.keys(productionBuild.metafile.inputs).map(file => path.resolve(desktopDirectory, file))];
  fs.writeFileSync(path.join(directory, 'input-bindings.json'), JSON.stringify({
    softwareOnly: true, files: [...new Set(boundFiles)].map(file => ({ path: file,
      sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') })),
  }, null, 2));
  const executable = require('electron');
  const outcome = await runElectron(executable, main, directory);
  fs.writeFileSync(path.join(directory, 'launch-result.json'), JSON.stringify(outcome, null, 2));
  expect(outcome.exitCode, `${directory}\n${outcome.stderr}`).toBe(0);
  expect(outcome.signal).toBeNull();
  expect(JSON.parse(fs.readFileSync(path.join(directory, 'process-cleanup.json'), 'utf8')).closed).toBe(true);
  report = JSON.parse(fs.readFileSync(path.join(directory, 'electron-result.json'), 'utf8'));
  expect(report.fatal, directory).toBeNull();
  expect(report.userData).toBe(path.join(directory, 'profile'));
  expect(report.executable.toLowerCase()).toBe(executable.toLowerCase());
  expect(report.versions.electron).toBe('44.2.0');
  expect(report.softwareOnly).toBe(true);
  process.stdout.write(JSON.stringify({ event: 'software.preload_sandbox_completed', directory }) + '\n');
}, 90_000);

describe('actual Electron sandbox production preload', () => {
  it('exposes the real production bridge through the sandbox with no Node globals or passive IPC', () => {
    const actual = report.cases.find(item => item.name === 'production');
    expect(actual.preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(actual.visible).toBe(false);
    expect(actual.preloadErrors).toEqual([]);
    expect(actual.unexpectedNavigations).toEqual([]);
    expect(actual.initial).toMatchObject({ query: 'function', command: 'function', nodeRequire: 'undefined',
      nodeProcess: 'undefined', alert: null, retry: null });
    expect(actual.initial.bridgeKeys.length).toBeGreaterThan(100);
    expect(actual.initial.text).toContain('生产预加载接口已就绪');
    expect(actual.passiveInvocations).toEqual([]);
    expect(actual.calibratedInvocations).toEqual(['runtime:report-renderer-log']);
    expect(actual.ipcInvocations.filter(channel => channel !== 'runtime:report-renderer-log')).toEqual([]);
  });

  it('records the real forbidden-module preload failure through the production Main diagnostic handler', () => {
    const actual = report.cases.find(item => item.name === 'broken');
    expect(actual.preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
    expect(actual.preloadErrors).toHaveLength(2);
    for (const entry of actual.preloadErrors) {
      expect(entry.actualPath).toBe(path.join(path.dirname(report.userData), 'broken-preload.cjs'));
      expect(entry.error.message).toMatch(/module not found: node:crypto|Cannot find module: node:crypto/i);
    }
    const records = actual.diagnosticRecords.filter(item => item.event === 'electron.preload_error');
    expect(records).toHaveLength(2);
    for (const entry of records) {
      expect(entry.level).toBe('error');
      expect(entry.context).toMatchObject({ reportedPreloadMatchesConfigured: true,
        configuredPreloadPath: expect.stringMatching(/^\[path:[a-f0-9]{20}\]$/) });
      expect(entry.context.error.message).toMatch(/node:crypto/);
    }
    expect(actual.initial.bridgeKeys).toEqual([]);
    expect(actual.unexpectedNavigations).toEqual([]);
    expect(actual.ipcInvocations).toEqual([]);
  });

  it('shows the production Chinese recovery UI and reloads only after the real manual button click', () => {
    const actual = report.cases.find(item => item.name === 'broken');
    expect(actual.initial.text).toContain('应用未能完成启动');
    expect(actual.initial.alert).toContain('请手动重新加载');
    expect(actual.initial.retry).toBe('重新加载应用');
    expect(actual.beforeRetryNavigationCount).toBe(1);
    expect(actual.afterRetryNavigationCount).toBe(2);
    expect(actual.afterRetry.alert).toContain('应用未能完成启动');
    expect(actual.afterRetry.retry).toBe('重新加载应用');
    expect(actual.afterRetry.bridgeKeys).toEqual([]);
    expect(actual.afterRetry.text).not.toMatch(/MISSION_CONTROL_PRELOAD_API_UNAVAILABLE|node:crypto/);
    expect(actual.console.some(item => item.message.includes('renderer.startup_render_failed'))).toBe(true);
    expect(actual.ipcInvocations).toEqual([]);
  });
});

async function runElectron(executable, main, directory) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [main, `--user-data-dir=${path.join(directory, 'profile')}`], {
    cwd: directory, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let timer, originalError, closed = false;
  const completion = new Promise(resolve => child.once('close', (exitCode, signal) => {
    closed = true;
    resolve({ pid: child.pid, exitCode, signal, stdout, stderr });
  }));
  const launchError = new Promise((_, reject) => child.once('error', reject));
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`SOFTWARE_PRELOAD_ELECTRON_TIMEOUT: ${directory}\n${stdout}\n${stderr}`)), 60_000);
    });
    return await Promise.race([completion, launchError, timeout]);
  } catch (error) {
    originalError = error;
    fs.writeFileSync(path.join(directory, 'launch-failure.json'), JSON.stringify({
      event: 'software.preload_sandbox_launch_failed', pid: child.pid, stdout, stderr,
      error: { message: error.message, stack: error.stack },
    }, null, 2));
    throw error;
  } finally {
    clearTimeout(timer);
    const cleanup = { pid: child.pid, closedBeforeCleanup: closed, killRequested: false, closed, failure: null };
    let cleanupError;
    try {
      if (!closed) {
        // 只使用本次 spawn 持有的进程句柄，退出回执未到达前保留所有夹具。
        cleanup.killRequested = child.kill();
        const stopped = await new Promise(resolve => {
          const deadline = setTimeout(() => resolve(false), 5_000);
          completion.then(() => { clearTimeout(deadline); resolve(true); });
        });
        if (!stopped) throw new Error('SOFTWARE_PRELOAD_OWNED_PROCESS_DID_NOT_CLOSE');
      }
    } catch (error) {
      cleanupError = error;
      cleanup.failure = { message: error.message, stack: error.stack };
    }
    cleanup.closed = closed;
    fs.writeFileSync(path.join(directory, 'process-cleanup.json'), JSON.stringify(cleanup, null, 2));
    fs.writeFileSync(path.join(directory, 'electron-stdout.log'), stdout);
    fs.writeFileSync(path.join(directory, 'electron-stderr.log'), stderr);
    if (cleanupError) throw originalError
      ? new AggregateError([originalError, cleanupError], '软件沙盒启动和自有进程清理均失败，原始记录已保留。')
      : cleanupError;
  }
}
