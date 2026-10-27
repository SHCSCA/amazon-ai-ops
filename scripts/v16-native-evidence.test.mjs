import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import native from './v16-native-evidence.js';
import artifacts from './v16-native-artifacts.js';
import verifier from './verify-v16-required-test-manifest.js';
import { nativeFixture } from './v16-native-test-fixture.mjs';
const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(f => f.cleanup()));
function setup() { const f = nativeFixture(); fixtures.push(f); f.verify = () => native.verifyNativeEvidence(f.raw, f.test, f.identity, f.root, f.execution); return f; }
describe('原生验收桥接', () => {
  it('重验原件后接受全部L5检查并返回真实caseId', () => {
    const f = setup();
    expect(f.verify()).toMatchObject({ success: true, total: 7, passed: 7, failed: 0, caseIds: f.test.requiredChecks, issues: [] });
    const inputs = f.verify().inputArtifacts;
    expect(inputs).toEqual(expect.arrayContaining(f.originals.map(({ path, sha256 }) => expect.objectContaining({ path, sha256 }))));
    expect(inputs.some(x => x.path.endsWith('duckdb.node'))).toBe(true);
  });
  it('通过公共证据入口接受当前原生包型协议', () => {
    const f = setup(), raw = f.json('native.json', f.raw);
    f.json('evidence.json', { schemaVersion: 'v16.evidence/1', testId: f.test.testId, layer: 'L5', identity: f.identity, execution: f.execution, artifact: { ...raw, format: 'checks-json' }, result: { success: true, total: 7, passed: 7, failed: 0, skipped: 0 } });
    expect(verifier.verifyEvidence(f.test, f.identity, f.root).success).toBe(true);
  });
  it('外层源码身份不符时不泄漏已通过caseId', () => {
    const f = setup(), raw = f.json('native.json', f.raw);
    f.json('evidence.json', { schemaVersion: 'v16.evidence/1', testId: f.test.testId, layer: 'L5', identity: { ...f.identity, sourceRevision: 'c'.repeat(40) }, execution: f.execution, artifact: { ...raw, format: 'checks-json' }, result: { success: true, total: 7, passed: 7, failed: 0, skipped: 0 } });
    expect(verifier.verifyEvidence(f.test, f.identity, f.root)).toMatchObject({ success: false, caseIds: [], inputArtifacts: [] });
  });
  it.each([
    ['原件摘要变更', f => fs.appendFileSync(f.descriptors[0].path, ' '), 'ARTIFACT_BYTES_CHANGED'],
    ['截图缺失', f => fs.unlinkSync(f.originals[0].path), 'ENOENT'],
    ['截图不是可解码PNG', f => Object.assign(f.originals[0], f.write(path.relative(f.root, f.originals[0].path), 'not-png')), 'PNG'],
    ['当前源版本不符', f => { f.raw.sourceSha256 = 'c'.repeat(64); }, 'NATIVE_SOURCE_IDENTITY_MISMATCH'],
    ['当前安装器变更', f => fs.appendFileSync(f.current.paths.installer, 'changed'), 'ARTIFACT_BYTES_CHANGED'],
    ['旧窗口收据', f => { f.reports.get('portable-runtime').launches[0].ready.generatedAt = '2020-01-01T00:00:00.000Z'; f.refresh('portable-runtime'); }, 'NATIVE_TIME_OUTSIDE_EXECUTION'],
    ['其他进程窗口', f => { f.reports.get('portable-runtime').launches[0].ready.pid = 999; f.refresh('portable-runtime'); }, 'RUNTIME_READY_IDENTITY_MISMATCH'],
    ['错误店铺配置目录', f => { f.reports.get('portable-runtime').launches[0].userDataDir = 'other-profile'; f.refresh('portable-runtime'); }, 'RUNTIME_PROFILE_PID_MISMATCH'],
    ['便携包清理残留', f => { f.reports.get('portable-runtime').portableRuns[0].extractionRemoved = false; f.refresh('portable-runtime'); }, 'PORTABLE_EXTRACTION_NOT_REMOVED'],
    ['安装注册残留', f => { f.reports.get('installed').restoration.finalSnapshot.registry[0].exists = true; f.refresh('installed'); }, 'INSTALLED_RESTORATION_INCOMPLETE'],
    ['ZIP用目录版替换', f => { f.reports.get('zip-runtime').target.deliveryKind = 'directory'; f.refresh('zip-runtime'); }, 'ZIP_RUNTIME_OWNER_MISMATCH'],
    ['未执行原生探针', f => { f.reports.get('portable-runtime').nativeProbe.sqliteValue = 0; f.refresh('portable-runtime'); }, 'RUNTIME_NATIVE_PROBE_FAILED'],
    ['原生模块摘要不符', f => { f.reports.get('portable-runtime').nativeBindings.after.sqlite = 'c'.repeat(64); f.refresh('portable-runtime'); }, 'RUNTIME_NATIVE_BINDINGS_CHANGED'],
    ['仅有通过布尔值', f => { delete f.raw.checks[0].nativeArtifactIds; }, 'NATIVE_CHECK_REFERENCE_REQUIRED'],
    ['适配类型被替换', f => { f.descriptors.find(x => x.id === 'installed').adapter = 'package-hashes'; }, 'NATIVE_ADAPTER_OR_REFERENCE_MISMATCH'],
  ])('拒绝%s并保留结构日志', (_title, change, expected) => {
    const f = setup(); change(f); const result = f.verify();
    expect(result.success).toBe(false); expect(result.caseIds).toEqual([]);
    expect(result.issues.join('\n')).toContain(expected);
    expect(result.diagnostics[0]).toMatchObject({ level: 'error', event: expect.stringMatching(/^v16\./), context: { error: { message: expect.any(String) } } });
  });
  it('拒绝父目录穿越和硬链接原件', () => {
    const f = setup(); expect(() => artifacts.readArtifact(f.root, { path: '../outside', sha256: 'a'.repeat(64) })).toThrow(/OUTSIDE_OWNER/);
    const target = f.write('original', 'bytes'); fs.linkSync(target.path, path.join(f.root, 'hardlink'));
    expect(() => artifacts.readArtifact(f.root, target)).toThrow(/NOT_UNIQUE_REGULAR/);
  });
  it.each(['L4', 'L6', 'L7'])('缺少真实原生证据时%s不因汇总通过而被放行', layer => {
    const f = setup(), key = Object.keys(native.CHECK_ADAPTERS).find(key => key.startsWith('V16-T-' + layer));
    const test = { testId: key, layer, requiredChecks: Object.keys(native.CHECK_ADAPTERS[key]) };
    const result = native.verifyNativeEvidence({ ...f.raw, testId: key, nativeArtifacts: [] }, test, f.identity, f.root, f.execution);
    expect(result.success).toBe(false); expect(result.caseIds).toEqual([]);
  });
});
