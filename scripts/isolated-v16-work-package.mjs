import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
const samePath = (left, right) => comparable(path.resolve(left)) === comparable(path.resolve(right));

export function assertDirectRuntimePath(input, kind) {
  const resolved = path.resolve(input);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())
    || (kind === 'file' && stat.nlink !== 1) || !samePath(fs.realpathSync.native(resolved), resolved)) {
    throw new Error(`隔离验收只接受无链接的直接${kind === 'directory' ? '目录' : '文件'}：${resolved}`);
  }
  return resolved;
}

export function hashRuntimeFile(file) {
  const target = assertDirectRuntimePath(file, 'file');
  const before = fs.lstatSync(target);
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(target, 'r');
  try {
    const block = Buffer.allocUnsafe(1024 * 1024);
    let count;
    while ((count = fs.readSync(descriptor, block, 0, block.length, null))) hash.update(block.subarray(0, count));
    const after = fs.fstatSync(descriptor);
    assert.deepEqual([after.dev, after.ino, after.size, after.mtimeMs, after.nlink],
      [before.dev, before.ino, before.size, before.mtimeMs, before.nlink], '读取期间原件发生变化。');
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}

export function snapshotRuntimeWorkPackage(input) {
  const root = assertDirectRuntimePath(input, 'directory');
  const entries = [];
  function visit(directory) {
    assertDirectRuntimePath(directory, 'directory');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const target = path.join(directory, entry.name);
      const relativePath = path.relative(root, target).split(path.sep).join('/');
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) {
        assertDirectRuntimePath(target, 'directory'); entries.push({ relativePath, kind: 'directory' }); visit(target);
      } else {
        assertDirectRuntimePath(target, 'file');
        entries.push({ relativePath, kind: 'file', sizeBytes: stat.size, sha256: hashRuntimeFile(target),
          identity: { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, mtimeMs: stat.mtimeMs } });
      }
    }
  }
  visit(root);
  return { root, entries };
}

const contentOf = snapshot => snapshot.entries.map(({ identity, ...entry }) => entry);
function overlaps(left, right) {
  const relative = path.relative(left, right);
  return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export function copyIsolatedWorkPackage(input, profile) {
  const source = assertDirectRuntimePath(input, 'directory');
  const isolatedProfile = assertDirectRuntimePath(profile, 'directory');
  const destination = path.join(isolatedProfile, 'v16-acceptance-work-package');
  if (overlaps(source, destination) || overlaps(destination, source)) throw new Error('工作包原件与本次复制目标不得重叠。');
  assertDirectRuntimePath(path.join(source, 'manifest.json'), 'file');
  const original = snapshotRuntimeWorkPackage(source);
  // 全部原件通过检查后才新建目标，拒绝覆盖任何预存工作包。
  fs.mkdirSync(destination);
  for (const entry of original.entries) {
    const target = path.join(destination, entry.relativePath);
    if (entry.kind === 'directory') fs.mkdirSync(target);
    else fs.copyFileSync(path.join(source, entry.relativePath), target, fs.constants.COPYFILE_EXCL);
  }
  assert.deepEqual(snapshotRuntimeWorkPackage(source), original, '复制期间工作包原件发生变化。');
  const copied = snapshotRuntimeWorkPackage(destination);
  assert.deepEqual(contentOf(copied), contentOf(original), '复制的工作包必须逐原件保持一致。');
  return { source, destination, original, copied, formalAcceptanceCredit: false };
}

export function assertRuntimeWorkPackageUnchanged(receipt) {
  assert.deepEqual(snapshotRuntimeWorkPackage(receipt.source), receipt.original, '验收不得修改预存工作包原件。');
  return true;
}

export function createMinimalIsolatedWorkPackage(output, frozen) {
  if (frozen?.schemaVersion !== 'v16.frozen-build/1'
    || frozen.requiredManifestDefinition?.schemaVersion !== 'v16.manifest/1'
    || !Array.isArray(frozen.requiredManifestDefinition.requiredTests)
    || !/^[a-f0-9]{64}$/i.test(frozen.identity?.sourceSha256 ?? '')
    || !frozen.identity?.sourceRevision || !frozen.identity?.packageVersion) throw new Error('隔离工作包必须使用当前冻结构建定义和身份。');
  const destination = path.resolve(output);
  assertDirectRuntimePath(path.dirname(destination), 'directory');
  const manifest = { ...structuredClone(frozen.requiredManifestDefinition), identity: structuredClone(frozen.identity),
    status: 'APP_NEEDS_WORK', deliveryStatus: 'INTERNAL NON_READY', appReady: false, realStoreEvidence: false };
  // 只保存测试定义与冻结身份，不生成通过报告、真实店铺或授权原件。
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(destination, 'README.md'), '**DELIVERY: APP_NEEDS_WORK — INTERNAL NON_READY.**\n\n此目录仅验证包内读取、刷新与诚实导出；缺少原件的门继续失败。\n', { flag: 'wx' });
  return { directory: destination, manifestPath: path.join(destination, 'manifest.json'), formalAppReadiness: false, realStoreEvidence: false };
}
