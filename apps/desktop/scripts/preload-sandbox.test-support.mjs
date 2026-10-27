import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

export function writeSandboxFixtures(directory, desktopDirectory, productionPreload) {
  const renderer = path.join(directory, 'renderer.js');
  const main = path.join(directory, 'main.cjs');
  esbuild.buildSync({
    stdin: { loader: 'tsx', resolveDir: desktopDirectory, contents: rendererSource },
    bundle: true, platform: 'browser', format: 'iife', outfile: renderer,
    nodePaths: [path.join(desktopDirectory, 'node_modules')],
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  esbuild.buildSync({
    stdin: { loader: 'ts', resolveDir: desktopDirectory, contents: mainSource },
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outfile: main,
    nodePaths: [path.join(desktopDirectory, 'node_modules')],
  });
  fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>隔离沙盒启动回归</title><main id="root"></main><script src="./renderer.js"></script></html>');
  fs.writeFileSync(path.join(directory, 'broken-preload.cjs'), "require('node:crypto');\n");
  fs.writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify({
    directory, productionPreload, profile: path.join(directory, 'profile'),
  }));
  return main;
}

const rendererSource = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StartupErrorBoundary } from './src/renderer/startup-error-boundary';
import { getMissionControlWindowApi } from './src/renderer/mission-control/bridge/window-api';

function PassiveBridgeProbe() {
  const api = getMissionControlWindowApi();
  if (typeof api.missionControl.query !== 'function' || typeof api.missionControl.command !== 'function') {
    throw new Error('MISSION_CONTROL_METHODS_UNAVAILABLE');
  }
  return <h1>生产预加载接口已就绪</h1>;
}
createRoot(document.getElementById('root')!).render(
  <StartupErrorBoundary><PassiveBridgeProbe /></StartupErrorBoundary>,
);
`;

const mainSource = String.raw`
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import { installRendererProcessErrorHandler } from './src/main/runtime-error-handlers';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture.json'), 'utf8'));
app.setName('Amazon AI Ops isolated preload regression');
app.setPath('userData', fixture.profile);
app.setPath('sessionData', path.join(fixture.profile, 'session'));
// 两个窗口顺序验证完才退出，关闭正例窗口不能提前终止负例。
app.on('window-all-closed', () => {});
const result = { softwareOnly: true, pid: process.pid, executable: process.execPath,
  versions: process.versions, userData: app.getPath('userData'), cases: [], fatal: null };
const write = () => fs.writeFileSync(path.join(fixture.directory, 'electron-result.json'), JSON.stringify(result, null, 2));
let activeWindow;
const serializeError = error => ({ name: error?.name ?? 'Error', message: String(error?.message ?? error), stack: error?.stack });
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read, description) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(25);
  }
  throw new Error('SANDBOX_FIXTURE_WAIT_TIMEOUT: ' + description);
}

async function runCase(name, preload) {
  const observation = { name, preloadErrors: [], diagnosticRecords: [], console: [], ipcInvocations: [],
    unexpectedNavigations: [], navigationCount: 0 };
  result.cases.push(observation);
  const window = new BrowserWindow({ show: false, width: 1024, height: 768,
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  activeWindow = window;
  const logger = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (event, context) => {
    observation.diagnosticRecords.push({ level, event, context });
  }]));
  installRendererProcessErrorHandler(window, logger, preload);
  window.webContents.on('preload-error', (_event, actualPath, error) => {
    observation.preloadErrors.push({ actualPath, error: serializeError(error) });
  });
  window.webContents.on('console-message', event => {
    observation.console.push({ level: event.level, message: event.message });
  });
  window.webContents.on('did-finish-load', () => observation.navigationCount++);
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) { event.preventDefault(); observation.unexpectedNavigations.push(url); }
  });
  // 固定 Electron 版本下监控实际 invoke 分发，诊断通道校准后才能给出零业务调用结论。
  const handlers = ipcMain._invokeHandlers;
  if (!(handlers instanceof Map)) throw new Error('ELECTRON_INVOKE_OBSERVER_UNAVAILABLE');
  const originalGet = handlers.get;
  handlers.get = function(channel) {
    observation.ipcInvocations.push(channel);
    return originalGet.call(this, channel);
  };
  ipcMain.handle('runtime:report-renderer-log', () => ({ softwareOnly: true }));
  try {
    await window.loadFile(path.join(fixture.directory, 'index.html'));
    await until(() => window.webContents.executeJavaScript('document.body.innerText.trim()'), 'nonblank Renderer');
    observation.preferences = window.webContents.getLastWebPreferences();
    observation.visible = window.isVisible();
    observation.initial = await window.webContents.executeJavaScript(snapshotSource);
    observation.passiveInvocations = observation.ipcInvocations.slice();
    if (name === 'production') {
      await window.webContents.executeJavaScript("window.electronAPI.reportRuntimeLog({level:'info',event:'software.sandbox_observer_calibration'})");
      observation.calibratedInvocations = observation.ipcInvocations.slice();
    } else {
      await until(() => window.webContents.executeJavaScript("Boolean(document.querySelector('[role=alert] button'))"), 'manual retry');
      await wait(80);
      observation.beforeRetryNavigationCount = observation.navigationCount;
      await window.webContents.executeJavaScript("document.querySelector('[role=alert] button').click()");
      await until(async () => observation.navigationCount > observation.beforeRetryNavigationCount
        && await window.webContents.executeJavaScript("Boolean(document.querySelector('[role=alert] button:not(:disabled)'))"), 'actual document reload');
      observation.afterRetry = await window.webContents.executeJavaScript(snapshotSource);
      observation.afterRetryNavigationCount = observation.navigationCount;
    }
  } finally {
    handlers.get = originalGet;
    ipcMain.removeHandler('runtime:report-renderer-log');
    if (!window.isDestroyed()) window.destroy();
    activeWindow = undefined;
    write();
  }
}

const snapshotSource = [
  '(() => ({ text: document.body.innerText, bridgeKeys: Object.keys(window.electronAPI || {}),',
  'query: typeof window.electronAPI?.missionControl?.query, command: typeof window.electronAPI?.missionControl?.command,',
  'nodeRequire: typeof window.require, nodeProcess: typeof window.process,',
  'alert: document.querySelector("[role=alert]")?.innerText ?? null,',
  'retry: document.querySelector("[role=alert] button")?.innerText ?? null, }))()',
].join('');

app.whenReady().then(async () => {
  await runCase('production', fixture.productionPreload);
  await runCase('broken', path.join(fixture.directory, 'broken-preload.cjs'));
}).catch(error => {
  result.fatal = serializeError(error);
  process.stderr.write(JSON.stringify({ event: 'software.preload_sandbox_failed', error: result.fatal }) + '\n');
  process.exitCode = 1;
}).finally(() => {
  if (activeWindow && !activeWindow.isDestroyed()) activeWindow.destroy();
  write();
  app.exit(result.fatal ? 1 : 0);
});
`;
