import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import evidence from './evidence-user-data.js';
import { assertDirectRuntimePath } from './isolated-v16-work-package.mjs';

const DELIVERY_KINDS = new Set(['directory', 'installed', 'folder-zip', 'portable']);

export function resolveIsolatedDesktopTarget(argumentsList, repositoryRoot) {
  let executable;
  let deliveryKind;
  let acceptanceWorkPackagePath;
  let runtimeDrive;
  const seen = new Set();
  for (let index = 0; index < argumentsList.length; index += 1) {
    const name = argumentsList[index];
    if (!['--app-executable', '--delivery-kind', '--acceptance-work-package', '--runtime-drive'].includes(name) || seen.has(name)) {
      throw new Error(`不支持或重复的验收参数：${name}`);
    }
    seen.add(name);
    const value = argumentsList[++index];
    if (!value || value !== value.trim() || value.startsWith('--') || value.includes('\0')) {
      throw new Error(`验收参数缺少有效值：${name}`);
    }
    if (name === '--app-executable') executable = value;
    else if (name === '--delivery-kind') deliveryKind = value;
    else if (name === '--acceptance-work-package') acceptanceWorkPackagePath = value;
    else runtimeDrive = normalizeRuntimeDrive(value);
  }
  const desktopRoot = path.join(repositoryRoot, 'apps/desktop');
  if (!executable) {
    if (acceptanceWorkPackagePath) throw new Error('工作包运行收据必须绑定实际 Windows 应用 EXE。');
    if (deliveryKind) throw new Error('交付形态必须同时指定应用 EXE。');
    const require = createRequire(path.join(desktopRoot, 'package.json'));
    return Object.freeze({
      deliveryKind: 'source', packaged: false, executablePath: require('electron'),
      ...(runtimeDrive ? { runtimeDrive } : {}),
      launchArguments: Object.freeze([desktopRoot]), bundleRoot: path.join(desktopRoot, 'dist'),
    });
  }
  deliveryKind ??= 'directory';
  if (!DELIVERY_KINDS.has(deliveryKind)) throw new Error(`不支持的交付形态：${deliveryKind}`);
  const executablePath = path.resolve(repositoryRoot, executable);
  const version = deliveryKind === 'portable'
    ? JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).version : null;
  const expectedName = deliveryKind === 'portable' ? `AmazonAIOpsAgent-${version}-portable.exe` : 'AmazonAIOpsAgent.exe';
  if (path.basename(executablePath).toLowerCase() !== expectedName.toLowerCase()) throw new Error('必须指定实际目录中的 AmazonAIOpsAgent.exe。');
  assertDirectRuntimePath(executablePath, 'file');
  const realPath = fs.realpathSync.native(executablePath);
  if (realPath.toLowerCase() !== executablePath.toLowerCase()) throw new Error('应用 EXE 不允许经过链接。');
  const coreExecutablePath = deliveryKind === 'portable'
    ? path.join(desktopRoot, 'release/win-unpacked/AmazonAIOpsAgent.exe') : realPath;
  assertDirectRuntimePath(coreExecutablePath, 'file');
  if (deliveryKind === 'portable' && (!fs.statSync(coreExecutablePath).isFile()
    || fs.realpathSync.native(coreExecutablePath).toLowerCase() !== coreExecutablePath.toLowerCase())) {
    throw new Error('便携验收缺少当前目录包基准。');
  }
  const bundleRoot = path.join(path.dirname(coreExecutablePath), 'resources/app/dist');
  assertDirectRuntimePath(bundleRoot, 'directory');
  for (const name of ['main/index.js', 'preload/index.cjs', 'renderer/index.html']) {
    assertDirectRuntimePath(path.join(bundleRoot, name), 'file');
  }
  if (acceptanceWorkPackagePath) {
    acceptanceWorkPackagePath = assertDirectRuntimePath(path.resolve(repositoryRoot, acceptanceWorkPackagePath), 'directory');
    assertDirectRuntimePath(path.join(acceptanceWorkPackagePath, 'manifest.json'), 'file');
  }
  return Object.freeze({
    deliveryKind, packaged: true, executablePath: realPath,
    ...(runtimeDrive ? { runtimeDrive } : {}),
    ...(deliveryKind === 'portable' ? { coreExecutablePath } : {}),
    ...(acceptanceWorkPackagePath ? { acceptanceWorkPackagePath } : {}),
    launchArguments: Object.freeze([]), bundleRoot,
  });
}

export function normalizeRuntimeDrive(value) {
  if (typeof value !== 'string' || !/^[a-z]:\\$/i.test(value)) throw new Error('运行盘必须是本地绝对盘根，例如 F:\\。');
  return value.toUpperCase();
}

export function createIsolatedRuntimeStorage(target, repositoryRoot, runId) {
  const driveRoot = normalizeRuntimeDrive(target.runtimeDrive ?? path.win32.parse(repositoryRoot).root);
  if (typeof runId !== 'string' || !runId || runId !== runId.trim() || runId.includes('\0')
    || path.win32.basename(runId) !== runId || ['.', '..'].includes(runId)) throw new Error('运行批次必须是单一自有目录名。');
  const evidenceRoot = evidence.resolveEvidenceUserDataRoot(driveRoot);
  const profile = evidence.validateEvidenceUserDataPath(path.win32.join(evidenceRoot, 'amazon-ai-ops-runtime-validation', runId), { requireExisting: false });
  const portableRoot = evidence.validateEvidenceUserDataPath(path.win32.join(evidenceRoot, 'amazon-ai-ops-portable-runtime', runId), { requireExisting: false });
  return Object.freeze({ driveRoot, evidenceRoot, runId, profile, portableRoot });
}
