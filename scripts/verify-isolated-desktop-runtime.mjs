import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import evidence from './evidence-user-data.js';
import { probeInputForMode, resolveInstalledElectronMetadata, resolvePackageNativePaths,
  resolveSourceNativePaths, runNativeProbe } from './prepare-native-runtime.js';
import { createIsolatedRuntimeStorage, resolveIsolatedDesktopTarget } from './isolated-desktop-target.mjs';
import { launchPortableDesktop } from './portable-desktop-runtime.mjs';
import { createCloseReceiptWriter, createIsolatedRuntimeCloser } from './portable-runtime-close.mjs';
import { copyIsolatedWorkPackage, assertRuntimeWorkPackageUnchanged } from './isolated-v16-work-package.mjs';
import { bindRuntimeWorkerLogReceipts, classifyIsolatedRuntimeLogs, currentWorkerRuntimeHashes, verifyIsolatedV16Delivery } from './isolated-v16-delivery-receipt.mjs';
import { confirmVisibleOperationScope, verifyPersistedOperationScopeOnRestart, requireRuntimeStoreContext } from './isolated-operation-scope-receipt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = path.join(ROOT, 'apps/desktop');
const require = createRequire(path.join(DESKTOP, 'package.json'));
const { _electron } = require('playwright');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT = path.join(ROOT, 'output/playwright/isolated-desktop-runtime', RUN_ID);
let PROFILE;
let runtimeStorage;
const STORE_NAME = '隔离运行验收（无真实授权）';
const PERSONA = `仅用于隔离运行验收，不调用 AI，不执行广告。${RUN_ID}`;
const report = {
  kind: 'isolated-source-desktop-runtime', schemaVersion: 1, generatedAt: new Date().toISOString(),
  passed: false, formalAppReadiness: false, realStoreEvidence: false,
  profile: PROFILE, checks: {}, launches: [], rendererErrors: [], consoleErrors: [],
};
let activeApp;
let target;
const portableRuns = new Map();
const processLifecycles = new Map();
let workPackageReceipt;

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function bundleHashes(directory) {
  const assets = fs.readdirSync(path.join(directory, 'renderer/assets'))
    .filter((name) => /\.(?:js|css)$/.test(name)).map((name) => `renderer/assets/${name}`);
  return Object.fromEntries(['main/index.js', 'preload/index.js', 'preload/index.cjs', 'renderer/index.html', ...assets]
    .map((name) => [name, digest(path.join(directory, name))]));
}

function nativeHashes(paths) {
  return { sqlite: digest(paths.sqliteBindingPath), duckdb: digest(paths.duckdbBindingPath) };
}

function bindPortableRuntime(app, label) {
  const identity = app.runtimeIdentity;
  assert.equal(identity.launcherSha256, report.target.executableSha256);
  const paths = resolvePackageNativePaths(identity.executablePath, resolveInstalledElectronMetadata().version);
  const baseline = resolvePackageNativePaths(target.coreExecutablePath, resolveInstalledElectronMetadata().version);
  const hashes = nativeHashes(paths);
  assert.deepEqual(hashes, nativeHashes(baseline));
  const actualBundle = path.join(path.dirname(identity.executablePath), 'resources/app/dist');
  const bundles = bundleHashes(actualBundle);
  assert.deepEqual(bundles, report.expectedSourceBundleHashes);
  const runtime = { label, identity, nativeBefore: hashes, bundleHashes: bundles,
    nativeProbe: runNativeProbe(probeInputForMode('electron', paths)) };
  portableRuns.set(app, { paths, actualBundle, runtime });
  (report.portableRuns ??= []).push(runtime);
}

function authoritySnapshot() {
  const directory = path.join(process.env.APPDATA, '@amazon-ai-ops/desktop');
  return {
    directory, exists: fs.existsSync(directory),
    files: ['amazon-ai-ops.db', 'amazon-ai-ops.db-wal', 'Local State'].map((name) => {
      const target = path.join(directory, name);
      return { name, sha256: fs.existsSync(target) ? digest(target) : null };
    }),
  };
}

async function capture(page, name) {
  fs.writeFileSync(path.join(OUTPUT, `${name}.txt`), await page.locator('body').innerText());
  fs.writeFileSync(path.join(OUTPUT, `${name}.yaml`), await page.locator('body').ariaSnapshot());
  await page.screenshot({ path: path.join(OUTPUT, `${name}.png`) });
}

async function launch(label) {
  const env = evidence.buildEvidenceUserDataEnv(process.env, evidence.PACKAGE_LAUNCH_SMOKE_MODE, PROFILE);
  delete env.ELECTRON_RUN_AS_NODE;
  env.NODE_ENV = 'production';
  let app;
  if (target.deliveryKind === 'portable') {
    const temporaryRoot = path.join(runtimeStorage.portableRoot, label);
    fs.mkdirSync(temporaryRoot, { recursive: true });
    app = await launchPortableDesktop({ executablePath: target.executablePath, profile: PROFILE,
      temporaryRoot, env, expectedCoreExecutablePath: target.coreExecutablePath, runtimeStorage, launchLabel: label,
      publishCloseReceipt: createCloseReceiptWriter({ file: path.join(OUTPUT, `${label}-portable-close.json`), ownedRoot: OUTPUT }) });
  } else {
    app = await _electron.launch({ executablePath: target.executablePath,
      args: [...target.launchArguments], env, timeout: 45000 });
  }
  activeApp = app;
  const child = app.process();
  for (const name of ['stdout', 'stderr']) {
    child[name]?.on('data', (chunk) => fs.appendFileSync(path.join(OUTPUT, `${label}-${name}.log`), chunk));
  }
  if (target.deliveryKind === 'portable') bindPortableRuntime(app, label);
  const page = await app.firstWindow({ timeout: 30000 });
  page.on('pageerror', (error) => report.rendererErrors.push({ label, message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push({ label, message: message.text() });
  });
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: '店铺与站点' }).waitFor();
  // 页面就绪可能早于原生窗口显示，等待实际可见状态后再采集身份。
  await app.evaluate(async ({ BrowserWindow }) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length === 1 && windows[0].isVisible()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('原生主窗口未在限定时间内显示。');
  });
  const identity = await app.evaluate(({ app, BrowserWindow }) => ({
    pid: process.pid, userDataDir: app.getPath('userData'), packaged: app.isPackaged,
    electronVersion: process.versions.electron,
    modulesAbi: process.versions.modules, executablePath: process.execPath,
    windows: BrowserWindow.getAllWindows().map((window) => ({
      id: window.id, visible: window.isVisible(), destroyed: window.isDestroyed(),
      url: window.webContents.getURL(),
      preferences: {
        contextIsolation: window.webContents.getLastWebPreferences().contextIsolation,
        nodeIntegration: window.webContents.getLastWebPreferences().nodeIntegration,
      },
    })),
  }));
  assert.equal(identity.packaged, target.packaged);
  assert.equal(evidence.normalizeWindowsPath(identity.userDataDir), evidence.normalizeWindowsPath(PROFILE));
  assert.equal(identity.windows.length, 1);
  assert.equal(identity.windows[0].visible, true);
  assert.equal(identity.windows[0].preferences.contextIsolation, true);
  assert.equal(identity.windows[0].preferences.nodeIntegration, false);
  const marker = evidence.readEvidenceUserDataRuntimeMarker(PROFILE).marker;
  assert.equal(marker.pid, identity.pid);
  assert.equal(marker.mode, evidence.PACKAGE_LAUNCH_SMOKE_MODE);
  const ready = JSON.parse(fs.readFileSync(path.join(PROFILE, 'package-launch-window-ready.json'), 'utf8'));
  assert.equal(ready.pid, identity.pid);
  assert.equal(ready.browserWindowId, identity.windows[0].id);
  assert.equal(ready.rendererUrl, identity.windows[0].url);
  const lifecycle = { label, ...identity, ready, launcherPid: child.pid, launchedAt: new Date().toISOString() };
  report.launches.push(lifecycle);
  processLifecycles.set(app, { child, lifecycle });
  await capture(page, `${label}-initial`);
  return { app, page };
}

const close = createIsolatedRuntimeCloser({
  beforeClose(app) {
    const portable = portableRuns.get(app);
    if (portable) {
      portable.runtime.nativeAfter = nativeHashes(portable.paths);
      assert.deepEqual(portable.runtime.nativeAfter, portable.runtime.nativeBefore);
      assert.deepEqual(bundleHashes(portable.actualBundle), portable.runtime.bundleHashes);
    }
  },
  afterClose(app) {
    const owned = processLifecycles.get(app);
    if (owned) {
      owned.lifecycle.closedAt = new Date().toISOString();
      owned.lifecycle.launcherExitCode = owned.child.exitCode;
      owned.lifecycle.launcherSignal = owned.child.signalCode;
      let alive = true;
      try { process.kill(owned.lifecycle.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
      owned.lifecycle.mainProcessRemoved = !alive;
      assert.equal(alive, false, '本次 Electron Main 进程退出后仍存在。');
      assert.equal(owned.child.exitCode, 0, '隔离启动的进程必须正常退出。');
      assert.equal(owned.child.signalCode, null);
    }
    const portable = portableRuns.get(app);
    if (portable) {
      portable.runtime.extractionRemoved = !fs.existsSync(app.runtimeIdentity.extractionRoot);
      assert.equal(portable.runtime.extractionRemoved, true);
    }
    activeApp = undefined;
  },
  onSettled(app, { error, secondaryErrors }) {
    const portable = portableRuns.get(app);
    if (portable) {
      const receipt = app.closeReceipt();
      if (receipt) portable.runtime.closeReceipt = receipt;
      if (error) portable.runtime.closeFailure = { name: error.name, message: error.message, secondaryErrors };
    }
  },
});

async function openSettings(page) {
  // 通过可见导航进入真实页面，等待路由交接完成后再操作表单。
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.locator('.route-handoff-feedback').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'AI 与本地', exact: true }).click();
  await page.locator('.route-handoff-feedback').waitFor({ state: 'hidden' });
  await capture(page, `settings-navigation-${report.launches.length}`);
  await page.getByRole('heading', { name: 'AI 服务连接', exact: true }).waitFor();
}

async function readConfiguration(page) {
  return page.evaluate(async () => ({
    settings: await window.electronAPI.getSettings(),
    rules: await window.electronAPI.getRuleConfig(),
  }));
}


async function verifyCollectionAutomationFirst(page, expectedContext) {
  const startedAt = new Date().toISOString();
  const value = await page.evaluate(async () => {
    const api = window.electronAPI, context = await api.getActiveStoreContext();
    if (!context) throw new Error('自动采集验收缺少当前 Main 店铺上下文。');
    const before = await api.getStoreCollectionAutomation(context);
    const written = await api.setStoreCollectionAutomation(context, { expectedRevision: 0, automaticCollectionEnabled: false });
    const after = await api.getStoreCollectionAutomation(context);
    return { context, before, written, after, contextAfter: await api.getActiveStoreContext() };
  });
  requireRuntimeStoreContext(value.context); requireRuntimeStoreContext(value.contextAfter);
  assert.deepEqual(value.context, expectedContext);
  assert.deepEqual(value.contextAfter, value.context, '自动采集写入期间 Main 店铺上下文已变化。');
  const owner = { storeId: value.context.storeId, browserProfileId: value.context.browserProfileId };
  assert.deepEqual(value.before, { ...owner, automaticCollectionEnabled: true, source: 'legacy-default', revision: 0, updatedAt: null });
  assert.equal(typeof value.after.updatedAt, 'string');
  assert.equal(new Date(value.after.updatedAt).toISOString(), value.after.updatedAt);
  assert.deepEqual(value.after, { ...owner, automaticCollectionEnabled: false, source: 'explicit-override', revision: 1, updatedAt: value.after.updatedAt });
  assert.deepEqual(value.written, value.after);
  return { startedAt, finishedAt: new Date().toISOString(), ...value };
}

async function verifyCollectionAutomationRestart(page, first) {
  const startedAt = new Date().toISOString();
  // 重启后只读取新的 Main 上下文与持久投影，不再次写入或借用首启上下文发请求。
  const value = await page.evaluate(async () => {
    const api = window.electronAPI, context = await api.getActiveStoreContext();
    if (!context) throw new Error('自动采集重启回读缺少当前 Main 店铺上下文。');
    const current = await api.getStoreCollectionAutomation(context);
    return { context, current, contextAfter: await api.getActiveStoreContext() };
  });
  requireRuntimeStoreContext(value.context); requireRuntimeStoreContext(value.contextAfter);
  assert.deepEqual(value.contextAfter, value.context, '自动采集重启回读期间 Main 店铺上下文已变化。');
  assert.equal(value.context.storeId, first.context.storeId);
  assert.equal(value.context.browserProfileId, first.context.browserProfileId);
  assert.deepEqual(value.current, first.after, '同一店铺自动采集关闭状态必须经 Main 重启原样持久。');
  return { startedAt, finishedAt: new Date().toISOString(), ...value };
}

async function verifyDeliveryPorts(page) {
  const ports = await page.evaluate(async () => ({
    storage: await window.electronAPI.getStoragePaths(),
    readiness: await window.electronAPI.getDeliveryReadiness(),
  }));
  assert.equal(evidence.normalizeWindowsPath(ports.storage.localDbPath),
    evidence.normalizeWindowsPath(path.join(PROFILE, 'amazon-ai-ops.db')));
  assert.equal(typeof ports.readiness.appReady, 'boolean');
  assert.equal(typeof ports.readiness.available, 'boolean');
  report.deliveryPorts = ports;
  report.checks.deliveryAndStorageIpcReadback = true;
}

async function verifyForms(page) {
  await page.getByRole('button', { name: /^(填写并保存 AI 设置|编辑连接)$/ }).click();
  let dialog = page.getByRole('dialog', { name: '编辑 AI 连接和输出参数' });
  await dialog.getByRole('textbox', { name: 'AI 人设与表达风格' }).fill(PERSONA);
  await dialog.getByRole('button', { name: '保存 AI 设置', exact: true }).click();
  await page.waitForFunction(async (expected) =>
    (await window.electronAPI.getSettings()).aiPersona === expected, PERSONA);
  await capture(page, 'settings-saved');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  report.checks.settingsUiSave = true;

  await page.getByRole('button', { name: '编辑规则阈值', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑规则阈值、动作边界和白名单' });
  await dialog.getByRole('spinbutton').first().fill('0.27');
  await dialog.getByRole('button', { name: '保存系统回退规则', exact: true }).click();
  await page.waitForFunction(async () => (await window.electronAPI.getRuleConfig()).targetAcos === 0.27);
  await capture(page, 'rules-saved');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  report.checks.ruleSubscriptionRefresh = true;

  // 组合写入仍走生产 IPC，读取规则投影验证事务提交后的总线订阅。
  const combined = await page.evaluate(async (persona) => {
    const api = window.electronAPI;
    const settings = await api.getSettings();
    const rules = await api.getRuleConfig();
    // 读取接口兼容双字段名；写入使用页面相同的 camelCase 字段，避免旧别名覆盖新值。
    delete settings.ai_persona;
    await api.saveSettings({ ...settings, aiPersona: `${persona}：组合保存`, ruleConfig: { ...rules, targetAcos: 0.29 } });
    return { settings: await api.getSettings(), rules: await api.getRuleConfig() };
  }, PERSONA);
  assert.equal(combined.settings.aiPersona, `${PERSONA}：组合保存`);
  assert.equal(combined.rules.targetAcos, 0.29);
  assert.equal(combined.settings.aiApiKey, '');
  assert.equal(combined.settings.aiKeyConfigured, false);
  report.checks.combinedSettingsAndRulesSave = true;

  const fault = await page.evaluate(async () => {
    try {
      await window.electronAPI.saveRuleConfig(null);
      return { rejected: false };
    } catch (error) {
      return { rejected: true, message: error.message };
    }
  });
  assert.equal(fault.rejected, true);
  assert.match(fault.message, /规则配置必须是 JSON 对象/);
  assert.equal((await readConfiguration(page)).rules.targetAcos, 0.29);
  report.expectedFault = fault;
  report.checks.ipcErrorRejectedWithoutCorruption = true;
}

function verifyLogs() {
  const directory = path.join(PROFILE, 'logs');
  const files = fs.readdirSync(directory).filter((name) => /^runtime-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name));
  assert.ok(files.length > 0);
  const records = files.flatMap((name) => fs.readFileSync(path.join(directory, name), 'utf8')
    .trim().split(/\r?\n/).map((line) => JSON.parse(line)));
  for (const record of records) {
    assert.ok(Number.isFinite(Date.parse(record.timestamp)));
    assert.ok(['info', 'warn', 'error'].includes(record.level));
    assert.equal(typeof record.event, 'string');
  }
  const classified = classifyIsolatedRuntimeLogs(records);
  if (report.v16WorkerFlow) report.v16WorkerFlow.workerLogReceipts = bindRuntimeWorkerLogReceipts(records, report.v16WorkerFlow);
  const shutdowns = records.filter((record) => record.context?.message === '[StoreContextTracker] cleared during shutdown');
  assert.equal(shutdowns.length, 2);
  fs.cpSync(directory, path.join(OUTPUT, 'runtime-logs'), { recursive: true });
  report.logs = { files, recordCount: records.length, expectedErrorCount: classified.expectedFaults.length,
    missingWorkPackageWarningCount: classified.missingWorkPackageWarnings.length, shutdownCount: shutdowns.length };
  report.checks.structuredLogPersistence = true;
}

function verifyIsolatedDatabase() {
  const Database = require('better-sqlite3');
  const database = new Database(path.join(PROFILE, 'amazon-ai-ops.db'), { readonly: true, fileMustExist: true });
  try {
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    const tables = ['stores', 'store_connections', 'mission_grants', 'ad_execution_jobs', 'ai_cost_records'];
    const counts = Object.fromEntries(tables.map((table) =>
      [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
    assert.equal(counts.stores, 1);
    for (const table of tables.slice(1)) assert.equal(counts[table], 0);
    report.database = { integrity: 'ok', counts };
    report.checks.noExternalConnectionGrantExecutionOrAiSpend = true;
  } finally {
    database.close();
  }
}

async function main() {
  target = resolveIsolatedDesktopTarget(process.argv.slice(2), ROOT);
  runtimeStorage = createIsolatedRuntimeStorage(target, ROOT, RUN_ID);
  PROFILE = runtimeStorage.profile;
  report.runtimeStorage = runtimeStorage;
  report.profile = PROFILE;
  report.kind = target.packaged ? 'isolated-packaged-desktop-runtime' : 'isolated-source-desktop-runtime';
  report.target = { ...target, executableSha256: digest(target.executablePath) };
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.mkdirSync(path.dirname(PROFILE), { recursive: true });
  fs.mkdirSync(PROFILE);
  if (target.acceptanceWorkPackagePath) {
    workPackageReceipt = copyIsolatedWorkPackage(target.acceptanceWorkPackagePath, PROFILE);
    report.acceptanceWorkPackage = workPackageReceipt;
    report.expectedWorkerBundleHashes = currentWorkerRuntimeHashes(path.join(DESKTOP, 'dist'));
    assert.deepEqual(currentWorkerRuntimeHashes(target.bundleRoot), report.expectedWorkerBundleHashes);
  }
  report.canonicalBefore = authoritySnapshot();
  const nativePaths = target.packaged
    ? resolvePackageNativePaths(target.coreExecutablePath || target.executablePath, resolveInstalledElectronMetadata().version)
    : resolveSourceNativePaths();
  report.nativeProbe = runNativeProbe(probeInputForMode('electron', nativePaths));
  const nativeBefore = { sqlite: digest(nativePaths.sqliteBindingPath), duckdb: digest(nativePaths.duckdbBindingPath) };
  report.bundleHashes = bundleHashes(target.bundleRoot);
  if (target.packaged) {
    report.expectedSourceBundleHashes = bundleHashes(path.join(DESKTOP, 'dist'));
    assert.deepEqual(report.bundleHashes, report.expectedSourceBundleHashes);
    report.checks.packageContentMatchesCurrentBuild = true;
  }
  let { app, page } = await launch('first');
  await page.getByRole('button', { name: '新增店铺', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新增美国站店铺' });
  await createDialog.getByRole('textbox', { name: '店铺名称' }).fill(STORE_NAME);
  await createDialog.getByRole('button', { name: '创建店铺', exact: true }).click();
  await createDialog.getByRole('button', { name: '切换到新店铺', exact: true }).click();
  await createDialog.waitFor({ state: 'hidden' });
  report.operationScope = { first: await confirmVisibleOperationScope({ page, capture }) };
  report.checks.operationScopeExplicitUiConfirmation = true;
  report.storeCollectionAutomation = { first: await verifyCollectionAutomationFirst(page, report.operationScope.first.after.context) };
  report.checks.collectionAutomationPublicIpcWriteReadback = true;
  await openSettings(page);
  await capture(page, 'settings-before');
  await verifyForms(page);
  report.savedConfiguration = await readConfiguration(page);
  await close(app);

  ({ app, page } = await launch('restart'));
  report.operationScope.restart = await verifyPersistedOperationScopeOnRestart({ page, capture, first: report.operationScope.first });
  report.checks.operationScopePersistedAcrossRestart = true;
  report.storeCollectionAutomation.restart = await verifyCollectionAutomationRestart(page, report.storeCollectionAutomation.first);
  report.checks.collectionAutomationPersistedAcrossMainRestart = true;
  await openSettings(page);
  const reloaded = await readConfiguration(page);
  assert.equal(reloaded.settings.aiPersona, `${PERSONA}：组合保存`);
  assert.equal(reloaded.rules.targetAcos, 0.29);
  await page.getByRole('button', { name: /^(填写并保存 AI 设置|编辑连接)$/ }).click();
  const displayed = await page.getByRole('textbox', { name: 'AI 人设与表达风格' }).inputValue();
  assert.equal(displayed, reloaded.settings.aiPersona);
  await capture(page, 'settings-restart');
  await verifyDeliveryPorts(page);
  if (workPackageReceipt) {
    await page.getByRole('dialog', { name: '编辑 AI 连接和输出参数' }).getByRole('button', { name: '关闭', exact: true }).click();
    report.v16WorkerFlow = await verifyIsolatedV16Delivery({ app, page, profile: PROFILE, target, capture,
      expectedWorkerHashes: report.expectedWorkerBundleHashes, nativeProbe: report.nativeProbe });
    report.checks.packagedWorkerViewRefreshFaithfulNonReadyExport = true;
  }
  report.checks.configurationRestartReadback = true;
  const stores = await page.evaluate(() => window.electronAPI.listStores());
  assert.equal(stores.length, 1);
  assert.equal(stores[0].displayName, STORE_NAME);
  report.syntheticStore = { storeId: stores[0].storeId, displayName: STORE_NAME, realAuthorization: false };
  await close(app);
  assert.deepEqual(report.rendererErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  verifyLogs();
  verifyIsolatedDatabase();
  report.nativeBindings = { before: nativeBefore,
    after: { sqlite: digest(nativePaths.sqliteBindingPath), duckdb: digest(nativePaths.duckdbBindingPath) } };
  assert.deepEqual(report.nativeBindings.after, report.nativeBindings.before);
  report.checks.nativeBindingsUnchanged = true;
  report.canonicalAfter = authoritySnapshot();
  assert.deepEqual(report.canonicalAfter, report.canonicalBefore);
  report.checks.canonicalUserDataUnchanged = true;
  assert.equal(digest(target.executablePath), report.target.executableSha256);
  report.checks.deliveryExecutableUnchanged = true;
  if (workPackageReceipt) report.checks.originalWorkPackageUnchanged = assertRuntimeWorkPackageUnchanged(workPackageReceipt);
  report.checks.visibleIsolatedWindowAndPreload = true;
  report.passed = true;
}

try {
  await main();
} catch (error) {
  report.failure = { message: error.message, stack: error.stack };
  if (activeApp) {
    try { await capture(await activeApp.firstWindow(), 'failure'); } catch (captureError) {
      report.captureError = captureError.message;
    }
  }
  process.exitCode = 1;
  process.stderr.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: 'error',
    event: 'desktop.isolated_verification_failed', context: { error: report.failure } })}\n`);
} finally {
  if (activeApp) {
    try { await close(activeApp); } catch (error) {
      report.cleanupError = error.message;
      process.exitCode = 1;
    }
  }
  report.passed = report.passed && !report.cleanupError;
  if (workPackageReceipt) {
    try { report.checks.originalWorkPackageUnchanged = assertRuntimeWorkPackageUnchanged(workPackageReceipt); }
    catch (error) {
      report.passed = false; process.exitCode = 1;
      report.workPackageIntegrityFailure = error.message;
      process.stderr.write(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', event: 'desktop.isolated_work_package_changed', context: { message: error.message } }) + '\n');
    }
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'desktop.isolated_verification_finished', passed: report.passed,
    reportPath: path.join(OUTPUT, 'report.json'), profile: PROFILE })}\n`);
}
