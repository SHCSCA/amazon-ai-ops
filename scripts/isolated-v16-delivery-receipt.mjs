import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { assertDirectRuntimePath, hashRuntimeFile } from './isolated-v16-work-package.mjs';

const require = createRequire(import.meta.url);
const { verifyPublicationBundle, readDeliveryStatus } = require('./v16-publication-bundle.js');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
const readJson = file => JSON.parse(fs.readFileSync(assertDirectRuntimePath(file, 'file'), 'utf8'));

export function requireInsideRuntimeProfile(profile, file) {
  const relative = path.relative(path.resolve(profile), path.resolve(file));
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) throw new Error('运行收据输出必须位于本次隔离 profile 内。');
  return path.resolve(file);
}

export function currentWorkerRuntimeHashes(bundleRoot) {
  return Object.fromEntries(['index.js', 'delivery-v16-worker.cjs', 'delivery-v16-backup-child.cjs', 'report-parser-worker.cjs']
    .map(name => [name, hashRuntimeFile(path.join(bundleRoot, 'main', name))]));
}

export function requireHonestRuntimeReadiness(result, published = false) {
  assert.equal(result.appReady, false); assert.equal(result.status, 'APP_NEEDS_WORK');
  assert.equal(result.previewOnly, false); assert.equal(result.manifestDriven, true); assert.equal(result.available, true);
  assert.equal(result.gates.length, 8);
  assert.deepEqual(result.gates.map(gate => gate.id).sort(), Array.from({ length: 8 }, (_, index) => `L${index + 1}`));
  for (const id of ['L6', 'L7']) assert.equal(result.gates.find(gate => gate.id === id).ok, false, '隔离运行不能声称完成真实双店或真实执行。');
  if (published) assert.equal(result.verificationProtocol, 'v16.current-publication/1');
  return result;
}

export function verifyRuntimeNonReadyBundle(profile, directory) {
  requireInsideRuntimeProfile(profile, directory); assertDirectRuntimePath(directory, 'directory');
  const manifest = readJson(path.join(directory, 'delivery-bundle-manifest.json'));
  const core = readJson(path.join(directory, 'release-core.json'));
  const inputs = readJson(path.join(directory, 'evidence-inputs.json'));
  const readmeFile = assertDirectRuntimePath(path.join(directory, 'README.snapshot.md'), 'file');
  const readme = fs.readFileSync(readmeFile, 'utf8');
  assert.equal(manifest.status, 'NON_READY'); assert.equal(manifest.phase, 'PUBLISHED'); assert.equal(core.eligible, false);
  for (const layer of ['L6', 'L7']) assert.equal(core.gates.find(gate => gate.layer === layer)?.passed, false);
  assert.equal(readDeliveryStatus(readme), 'APP_NEEDS_WORK');
  const safety = verifyPublicationBundle(directory, core, readme, inputs.inputs);
  assert.equal(safety.success, true, JSON.stringify(safety.issues));
  return { directory, manifestPath: path.join(directory, 'delivery-bundle-manifest.json'), manifestSha256: hashRuntimeFile(path.join(directory, 'delivery-bundle-manifest.json')),
    status: manifest.status, phase: manifest.phase, identity: manifest.identity, structuralSafety: safety,
    formalAppReadiness: false, realStoreEvidence: false };
}

export function classifyIsolatedRuntimeLogs(records) {
  const expectedFaults = [], missingWorkPackageWarnings = [], unexpectedErrors = [];
  for (const record of records) {
    // Main 以 warn 持久化 Worker 诊断，内部 error 仍是实际故障。
    if (record.event === 'delivery.worker_diagnostic' && record.context?.diagnostic?.level === 'error') {
      unexpectedErrors.push(record); continue;
    }
    if (record.event === 'delivery.worker_diagnostic' && record.context?.diagnostic?.event === 'delivery.v16_manifest_missing'
      && record.context.diagnostic.level === 'warn' && record.level === 'warn') missingWorkPackageWarnings.push(record);
    if (record.level !== 'error') continue;
    if (record.event === 'ipc.handler_failed' && record.context?.channel === 'settings:save-rule-config'
      && record.context?.error?.message === '规则配置必须是 JSON 对象。') expectedFaults.push(record);
    else unexpectedErrors.push(record);
  }
  assert.equal(expectedFaults.length, 1, '规则配置故障注入必须恰好产生一个已知错误。');
  assert.deepEqual(unexpectedErrors, [], '不允许用缺工作包或 NON_READY 为任意运行错误放行。');
  return { expectedFaults, missingWorkPackageWarnings, unexpectedErrors };
}

function outputDirectories(root) {
  if (!fs.existsSync(root)) return [];
  assertDirectRuntimePath(root, 'directory');
  return fs.readdirSync(root).filter(name => fs.lstatSync(path.join(root, name)).isDirectory());
}

async function observeAction(locator, page, key, finish) {
  await locator.evaluate((button, key) => {
    const states = [];
    const capture = () => states.push({ disabled: button.disabled, busy: button.getAttribute('aria-busy') === 'true',
      spinners: button.querySelectorAll('.button-spinner,.workspace-spinner').length });
    const observer = new MutationObserver(capture); observer.observe(button, { attributes: true, childList: true, subtree: true });
    capture(); window[key] = { states, stop() { capture(); observer.disconnect(); } };
  }, key);
  await locator.click(); await finish();
  const states = await page.evaluate(key => { const observed = window[key]; observed.stop(); delete window[key]; return observed.states; }, key);
  assert.ok(states.some(state => state.disabled && state.busy && state.spinners > 0), '真实交付按钮必须出现忙碌、禁用及 spinner。');
  return states;
}

export function waitDeliveryMessage(page, expected, timeout) {
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Panel 的标题与裸正文同属 section，必须同时校验命名区域、标题和完整正文。
  return page.getByRole('region', { name: '交付消息', exact: true })
    .filter({ has: page.getByRole('heading', { name: '交付消息', exact: true, level: 3 }) })
    .filter({ hasText: new RegExp(`^\\s*交付消息\\s*${escaped}\\s*$`) })
    .waitFor({ state: 'visible', timeout });
}

export async function verifyIsolatedV16Delivery({ app, page, profile, target, capture, expectedWorkerHashes, nativeProbe }) {
  assert.equal(target.packaged, true);
  const identity = await app.evaluate(({ app }) => ({ pid: process.pid, executablePath: process.execPath,
    appRoot: app.getAppPath(), electronVersion: process.versions.electron, modulesAbi: process.versions.modules }));
  assert.ok(identity.electronVersion && /^\d+$/.test(identity.modulesAbi));
  assert.equal(identity.electronVersion, nativeProbe.electronVersion); assert.equal(identity.modulesAbi, nativeProbe.modulesAbi);
  const hashes = currentWorkerRuntimeHashes(path.join(identity.appRoot, 'dist'));
  assert.deepEqual(hashes, expectedWorkerHashes, '实际包内 Worker 与当前构建不一致。');
  const executableSha256 = hashRuntimeFile(identity.executablePath);
  assert.equal(executableSha256, hashRuntimeFile(target.coreExecutablePath || target.executablePath));
  const storage = await page.evaluate(() => window.electronAPI.getStoragePaths());
  assert.equal(path.resolve(storage.evidenceDir), path.join(path.resolve(profile), 'v16-acceptance-work-package'));
  requireInsideRuntimeProfile(profile, storage.deliveryDir);
  const viewed = requireHonestRuntimeReadiness(await page.evaluate(() => window.electronAPI.getDeliveryReadiness()));
  await page.getByRole('button', { name: '系统设置', exact: true }).click();
  await page.locator('.route-handoff-feedback').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '交付验收', exact: true }).click();
  await page.locator('.route-handoff-feedback').waitFor({ state: 'hidden' });
  const panel = page.locator('.delivery-summary-workbench');
  const refresh = panel.getByRole('button', { name: '刷新最终验收', exact: true }).first();
  await refresh.waitFor({ timeout: 330000 });
  await capture(page, 'v16-delivery-view');
  const refreshStates = await observeAction(refresh, page, '__isolatedV16RefreshObservation', () =>
    waitDeliveryMessage(page, '最终验收已刷新，仍未就绪。', 330000));
  const refreshed = requireHonestRuntimeReadiness(await page.evaluate(() => window.electronAPI.getDeliveryReadiness()), true);
  await capture(page, 'v16-delivery-refreshed');
  const outputRoot = requireInsideRuntimeProfile(profile, path.join(storage.deliveryDir, 'v16-current-verification'));
  const previous = new Set(outputDirectories(outputRoot));
  const exportButton = panel.getByRole('button', { name: '导出未完成验收材料', exact: true });
  await exportButton.waitFor({ timeout: 330000 });
  const exportStates = await observeAction(exportButton, page, '__isolatedV16ExportObservation', () =>
    waitDeliveryMessage(page, '未完成验收材料已导出，包含当前缺口，不能作为生产就绪证明。', 330000));
  const created = outputDirectories(outputRoot).filter(name => !previous.has(name));
  assert.equal(created.length, 1, '一次可见导出必须只建立一个 Main nonce 输出。');
  assert.match(created[0], /^[a-f0-9-]{36}$/i);
  const exported = verifyRuntimeNonReadyBundle(profile, path.join(outputRoot, created[0], 'delivery-bundle'));
  const afterExport = requireHonestRuntimeReadiness(await page.evaluate(() => window.electronAPI.getDeliveryReadiness()), true);
  assert.deepEqual(currentWorkerRuntimeHashes(path.join(identity.appRoot, 'dist')), hashes);
  await capture(page, 'v16-delivery-non-ready-export');
  return { schemaVersion: 'v16.isolated-package-worker-receipt/1', kind: target.deliveryKind,
    actualElectron: { ...identity, executableSha256 }, workerBundleHashes: hashes, viewed, refreshed, afterExport, exported,
    actualUiOperations: ['view', 'refresh', 'NON_READY-export'], refreshStates, exportStates, exportNonce: created[0],
    formalAppReadiness: false, realStoreEvidence: false };
}

export function bindRuntimeWorkerLogReceipts(records, receipt) {
  assert.ok(typeof receipt?.exportNonce === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(receipt.exportNonce), '可见导出的 Main nonce 必须为有效 UUID。');
  // 持久日志已将 nonce 脱敏；复用同一出口投影，保持导出与 Worker 原件的精确关联。
  const expectedExportAlias = createRuntimeLogRecord('warn', 'delivery.worker_diagnostic', { nonce: receipt.exportNonce }).context.nonce;
  const workers = records.filter(record => record.event === 'delivery.worker_diagnostic'
    && record.context?.diagnostic?.event === 'delivery.v16_current_verification');
  const nonces = [...new Set(workers.map(record => record.context.nonce))];
  assert.ok(nonces.every(nonce => typeof nonce === 'string' && /^\[nonce:[a-f0-9]{20}\]$/.test(nonce)), 'Worker 收据必须来自规范的 Main nonce 日志别名。');
  assert.ok(nonces.length >= 3, '查看、刷新和导出必须实际进入包内 Worker。');
  assert.ok(nonces.includes(expectedExportAlias), '可见导出的 Main nonce 必须有实际 Worker 核验日志。');
  return { acceptedWorkerNonces: nonces, exportNonce: receipt.exportNonce, mainPid: receipt.actualElectron.pid,
    electronModulesAbi: receipt.actualElectron.modulesAbi, workerExecution: '同一 Electron Main 进程中的 Worker Thread',
    backupHelperExecution: '本收据绑定包内 helper 字节；缺真实正式库原件时不声称已启动正式库备份子进程。',
    abiEvidence: '当前 Main 在接受 Worker 返回值前执行精确 nativeAbi 比对。' };
}
