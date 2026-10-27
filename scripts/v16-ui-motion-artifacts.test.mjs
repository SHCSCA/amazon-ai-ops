import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildOwnedMotionV2Model } from './owned-motion-geometry-v2.test-support.mjs';

const require = createRequire(import.meta.url);
const repoRequire = createRequire(path.resolve(process.cwd(), 'scripts/motion-artifacts-unit-loader.cjs'));
const artifacts = repoRequire('./v16-performance-artifacts');
const native = repoRequire('./v16-native-artifacts');
const { validateOwnedMotionV2Frame } = require('./owned-motion-geometry-v2.cjs');
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-motion-raw-unit-')), packet = path.join(root, 'packet');
  fs.mkdirSync(packet);
  const tool = path.join(root, 'v16-ui-native-geometry.ps1'); fs.writeFileSync(tool, '# 隔离文件绑定模型，不执行。\n');
  const source = fs.readFileSync(fileURLToPath(new URL('./v16-ui-motion-artifacts.js', import.meta.url)), 'utf8');
  const module = { exports: {} };
  const local = name => {
    if (name === 'node:path' || name === 'node:util') return require(name);
    if (name === './v16-native-artifacts') return native;
    if (name === './v16-performance-artifacts') return artifacts;
    throw new Error('UNIT_ARTIFACT_UNEXPECTED_REQUIRE:' + name);
  };
  local.resolve = name => { if (name === './v16-ui-native-geometry.ps1') return tool; throw new Error('UNIT_ARTIFACT_UNEXPECTED_RESOLVE'); };
  new Function('require', 'module', 'exports', source)(local, module, module.exports);
  const shell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const launch = { identity: { executablePath: 'G:\\isolated\\AmazonAIOpsAgent.exe' },
    verification: { mainExitObserver: { kind: 'v16-main-exit-ready', handleAcquired: true, pid: 11,
      creationPrecision: 'cim-microsecond+handle-100ns', executablePath: 'G:\\isolated\\AmazonAIOpsAgent.exe',
      handleCreationTimeUtc: '2026-10-26T04:00:00.0000007Z' } },
    processBinding: { query: { powershell: { realPath: shell, sha256: 'a'.repeat(64), signature: { status: 'Valid' } } } } };
  function observation(label) {
    const value = { fixtureOnly: true, formalCredit: false, label };
    const stdout = path.join(packet, label + '.stdout'), stderr = path.join(packet, label + '.stderr');
    fs.writeFileSync(stdout, JSON.stringify(value)); fs.writeFileSync(stderr, '');
    return { native: value, invocation: { command: { executable: shell, shell: false, windowsHide: true,
      args: ['-NoProfile', '-NonInteractive', '-File', tool] }, tool: { ...artifacts.fileRecord(tool),
        stat: Object.fromEntries(['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink'].map(key => [key, fs.lstatSync(tool)[key]])) },
      stdout: artifacts.fileRecord(stdout), stderr: artifacts.fileRecord(stderr) } };
  }
  const witness = { nativeBefore: observation('before'), nativeAfter: observation('after') };
  const verify = () => module.exports.verifyMotionNativeArtifacts(witness, { root }, packet, launch);
  return { root, packet, tool, launch, witness, verify, subject: module.exports };
}
describe('motion原生原件文件绑定', () => {
  it('仅证明隔离raw文件与inline相同，五个原件全部进入ledger', () => {
    const m = setup(), ledger = new Map(); expect(native.withArtifactLedger(ledger, m.verify)).toBeUndefined();
    expect(ledger.size).toBe(5);
  });
  it('inline字段不能覆盖原始stdout', () => {
    const m = setup(); m.witness.nativeBefore.native.label = 'changed'; expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_RAW_MISMATCH');
  });
  it('非空stderr不能宣称成功', () => {
    const m = setup(), call = m.witness.nativeAfter.invocation;
    fs.writeFileSync(call.stderr.path, 'fixture error'); call.stderr = artifacts.fileRecord(call.stderr.path);
    expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_RAW_MISMATCH');
  });
  it.each(['sha256', 'path', 'sizeBytes'])('待验tool的%s不能选择别的可信锚', field => {
    const m = setup(), tool = m.witness.nativeBefore.invocation.tool;
    tool[field] = field === 'sha256' ? 'b'.repeat(64) : field === 'path' ? path.join(m.root, 'other.ps1') : tool.sizeBytes + 1;
    expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
  });
  it('实际tool字节改变会拒绝旧调用记录', () => {
    const m = setup(); fs.appendFileSync(m.tool, '# changed\n'); expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
  });
  it('调用执行器必须与已绑定原生启动的PowerShell一致', () => {
    const m = setup(); m.witness.nativeBefore.invocation.command.executable = 'C:\\isolated\\other.exe';
    expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
  });
  it('调用参数不能改指另一个File', () => {
    const m = setup(); m.witness.nativeBefore.invocation.command.args[3] = path.join(m.root, 'other.ps1');
    expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
  });
  it('缺原启动的已验证PowerShell时不采用witness自声明', () => {
    const m = setup(); delete m.launch.processBinding.query; expect(m.verify).toThrow('ACCESSIBILITY_MOTION_TRUSTED_POWERSHELL_REQUIRED');
  });
  it('raw路径不得越出本观察packet', () => {
    const m = setup(), file = path.join(m.root, 'outside.json'); fs.writeFileSync(file, '{}');
    m.witness.nativeBefore.invocation.stdout = artifacts.fileRecord(file); expect(m.verify).toThrow('ARTIFACT_OUTSIDE_OWNER');
  });
  it('可信Main出生锚完整保留第七位，不能改从witness取值', () => {
    const m = setup(); expect(m.subject.trustedMotionMain(m.launch, { mainPid: 11 })).toEqual({
      birthUtc: '2026-10-26T04:00:00.0000007Z', executablePath: 'G:\\isolated\\AmazonAIOpsAgent.exe' });
  });
  it.each(['handleAcquired', 'pid', 'creationPrecision', 'handleCreationTimeUtc'])('可信Main的%s缺失即拒绝', field => {
    const m = setup(); delete m.launch.verification.mainExitObserver[field];
    expect(() => m.subject.trustedMotionMain(m.launch, { mainPid: 11 })).toThrow('ACCESSIBILITY_MOTION_NATIVE_BIRTH_REQUIRED');
  });
});


describe('生产工具四字段与七项 stat 合同回归', () => {
  it('完整工具四字段沿用实际文件元数据通过，流记录仍仅三字段', () => {
    const m = setup(), call = m.witness.nativeBefore.invocation;
    expect(Object.keys(call.tool).sort()).toEqual(['path', 'sha256', 'sizeBytes', 'stat'].sort());
    expect(Object.keys(call.tool.stat).sort()).toEqual(['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink'].sort());
    expect(Object.keys(call.stdout).sort()).toEqual(['path', 'sha256', 'sizeBytes'].sort());
    expect(m.verify()).toBeUndefined();
    const model = buildOwnedMotionV2Model();
    expect(validateOwnedMotionV2Frame(model.witness, model.expected).pixels).toEqual(model.witness.nativeSize);
  });
  it('缺失工具 stat 不能当作旧三字段记录接受', () => {
    const m = setup(); delete m.witness.nativeBefore.invocation.tool.stat;
    expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
    const model = buildOwnedMotionV2Model(); delete model.witness.nativeBefore.invocation.tool.stat;
    expect(() => validateOwnedMotionV2Frame(model.witness, model.expected)).toThrow('UI_MOTION_V2_GEOMETRY_INVALID');
  });
  it.each(['ino', 'size', 'mtimeMs', 'ctimeMs', 'birthtimeMs', 'mode', 'nlink'])('同形但错误的%s不能代替独立当前文件元数据', field => {
    const m = setup(), metadata = m.witness.nativeBefore.invocation.tool.stat, previous = metadata[field];
    metadata[field] = field === 'ino' ? (previous === 1 ? 2 : 1) : previous + 1;
    expect(metadata[field]).not.toBe(previous);
    expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
  });
  it('额外工具键及额外 stat 键均拒绝', () => {
    const m = setup(); m.witness.nativeBefore.invocation.tool.extra = true;
    expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
    delete m.witness.nativeBefore.invocation.tool.extra; m.witness.nativeBefore.invocation.tool.stat.extra = true;
    expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
  });
  it('字段同形但文件字节不变、mtime改变时仍拒绝旧 stat', () => {
    const m = setup(), before = fs.statSync(m.tool), bytes = fs.readFileSync(m.tool);
    fs.utimesSync(m.tool, before.atime, new Date(before.mtimeMs + 1000));
    expect(fs.readFileSync(m.tool)).toEqual(bytes); expect(m.verify).toThrow('ACCESSIBILITY_MOTION_NATIVE_TOOL_MISMATCH');
  });
  it.each([
    ['空值', tool => { tool.stat = null; }],
    ['缺少成员', tool => { delete tool.stat.ino; }],
    ['额外成员', tool => { tool.stat.extra = 1; }],
    ['inode 字符串', tool => { tool.stat.ino = '1'; }],
    ['inode 零', tool => { tool.stat.ino = 0; }],
    ['大小不一致', tool => { tool.stat.size++; }],
    ['大小小数', tool => { tool.stat.size += 0.5; }],
    ['时间字符串', tool => { tool.stat.mtimeMs = '1'; }],
    ['时间 NaN', tool => { tool.stat.ctimeMs = NaN; }],
    ['时间无穷', tool => { tool.stat.birthtimeMs = Infinity; }],
    ['非普通文件', tool => { tool.stat.mode = 0o040755; }],
    ['多链接', tool => { tool.stat.nlink = 2; }],
  ])('%s不能通过纯工具记录合同', (_label, mutate) => {
    const model = buildOwnedMotionV2Model(); mutate(model.witness.nativeBefore.invocation.tool);
    expect(() => validateOwnedMotionV2Frame(model.witness, model.expected)).toThrow('UI_MOTION_V2_GEOMETRY_INVALID');
  });
  it.each(['stdout', 'stderr'])('流记录%s仍拒绝额外 stat，不借工具合同放宽', field => {
    const model = buildOwnedMotionV2Model(); model.witness.nativeBefore.invocation[field].stat = {};
    expect(() => validateOwnedMotionV2Frame(model.witness, model.expected)).toThrow('UI_MOTION_V2_GEOMETRY_INVALID');
  });
});
