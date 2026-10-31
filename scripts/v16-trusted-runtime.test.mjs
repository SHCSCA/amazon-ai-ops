import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import native from './v16-native-evidence.js';
import artifacts from './v16-native-artifacts.js';
import verifier from './verify-v16-required-test-manifest.js';
import trace from './verify-v16-trace-closure.js';
import trusted from './v16-trusted-runtime.js';
import business from './v16-native-business-adapters.js';
import migration from './verify-s7-migration-backup-restore.js';
import packageUi from './package-ui-evidence.js';
import version from './current-app-version.js';
import { nativeFixture } from './v16-native-test-fixture.mjs';

const fixtures = [];
afterEach(() => fixtures.splice(0).forEach(fixture => fixture.cleanup()));
function setup() {
  const f = nativeFixture(); fixtures.push(f);
  const settings = f.write('frozen/settings-repo.ts', "this.set('login_credentials_encrypted', value)");
  const database = f.write('frozen/db.ts', 'new Database(finalPath)');
  f.environment = { currentPackage: () => f.current, packageUiContract: () => packageUi, artifactRoots: [f.root], securitySources: { settingsRepository: settings, sqliteDatabase: database } };
  f.verify = () => native.verifyNativeEvidence(f.raw, f.test, f.identity, f.root, f.execution, f.environment);
  return f;
}
function frozenBuild(f) {
  const identity = { sourceRevision: f.identity.sourceRevision, sourceSha256: f.identity.sourceSha256, packageVersion: f.identity.packageVersion };
  const test = { ...f.test, requirementIds: ['V16-TEST'] };
  const requirement = { id: 'V16-TEST', title: '冻结开发义务', priority: 'MUST', section: '测试', line: 1, acceptanceIds: ['AC-TEST-001'] };
  const requirementsIndex = { requirements: [{ ...requirement, implementation: ['packages/example.ts'], testIds: [test.testId], acceptanceCases: [{ acceptanceId: 'AC-TEST-001', testId: test.testId, caseId: 'package-hashes' }] }] };
  const frozen = { schemaVersion: 'v16.frozen-build/1', identity, sourceRoot: f.root, prdMust: [requirement], requirementsIndex,
    requiredManifestDefinition: { requiredTests: [test] }, testInventory: ['scripts/example.test.mjs'], implementationInventory: [{ path: 'packages/example.ts', sha256: 'a'.repeat(64), sizeBytes: 5 }] };
  return { frozen, test, manifest: { schemaVersion: 'v16.manifest/1', identity: f.identity, requiredTests: [test] }, runtime: { frozenBuild: frozen, nativeEnvironment: f.environment } };
}
function envelope(f) {
  const raw = f.json('native.json', f.raw);
  f.json('evidence.json', { schemaVersion: 'v16.evidence/1', testId: f.test.testId, layer: 'L5', identity: f.identity, execution: f.execution,
    artifact: { ...raw, format: 'checks-json' }, result: { success: true, total: 7, passed: 7, failed: 0, skipped: 0 } });
}
describe('打包应用可信证据环境', () => {
  it('当前版本正例统一绑定包元数据、产物路径和冻结身份', () => {
    const f = setup(), packageVersion = version.currentAppVersion();
    const metadata = JSON.parse(fs.readFileSync(path.join(f.current.appRoot, 'package.json'), 'utf8'));
    const desktop = JSON.parse(fs.readFileSync(path.join(f.root, 'apps/desktop/package.json'), 'utf8'));
    expect(metadata.version).toBe(packageVersion);
    expect(desktop.version).toBe(packageVersion);
    expect(f.identity.packageVersion).toBe(packageVersion);
    expect(path.basename(f.current.paths.installer)).toBe(`AmazonAIOpsAgent-${packageVersion}.exe`);
    expect(path.basename(f.current.paths.portable)).toBe(`AmazonAIOpsAgent-${packageVersion}-portable.exe`);
    expect(path.basename(f.current.paths.zip)).toBe(`AmazonAIOpsAgent-${packageVersion}.zip`);
    expect(f.verify().success).toBe(true);
  });
  it('历史版本包元数据不能冒充当前可信构建', () => {
    const f = setup(), metadataPath = path.join(f.current.appRoot, 'package.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    expect(metadata.version).not.toBe('1.6.0');
    fs.writeFileSync(metadataPath, JSON.stringify({ ...metadata, version: '1.6.0' }));
    const result = f.verify();
    expect(result).toMatchObject({ success: false, caseIds: [], inputArtifacts: [] });
    expect(result.issues.join('|')).toContain('Packaged app package.json metadata does not match the expected desktop package');
  });
  it('原生验证导入不读取开发机desktop源码metadata', () => {
    const script = [
      "const fs=require('node:fs');const read=fs.readFileSync;",
      "fs.readFileSync=function(file,...args){if(typeof file==='string'&&file.replaceAll('\\\\','/').endsWith('/apps/desktop/package.json'))throw new Error('SOURCE_TREE_READ_FORBIDDEN');return read.call(this,file,...args)};",
      `require(${JSON.stringify(path.resolve('scripts/v16-native-evidence.js'))});`,
      `require(${JSON.stringify(path.resolve('scripts/verify-mission-control-production-readiness.js'))});`,
      `require(${JSON.stringify(path.resolve('scripts/smoke-package-launch.js'))});`,
    ].join('');
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', windowsHide: true });
    expect(result.stderr).not.toContain('SOURCE_TREE_READ_FORBIDDEN'); expect(result.status).toBe(0);
  });
  it('缺少源码仓库与Git时以嵌入合同、真实包和原件完成严格验证', () => {
    const f = setup(), p = frozenBuild(f); envelope(f);
    fs.rmSync(path.join(f.root, 'packages'), { recursive: true });
    const verification = verifier.verifyManifest(p.manifest, f.root, undefined, p.runtime);
    expect(verification).toMatchObject({ success: true, issues: [] });
    expect(trace.verifyTraceClosure(p.frozen.requirementsIndex, p.manifest, f.root, verification, p.runtime).success).toBe(true);
    expect(verification.details[0].inputArtifacts.map(record => record.path)).toContain(path.join(f.root, 'frozen/settings-repo.ts'));
  });
  it('普通CLI环境仍要求现场源码且不信任packet提供的环境', () => {
    const f = setup(); f.raw.trustedNativeEnvironment = f.environment;
    fs.rmSync(path.join(f.root, 'packages'), { recursive: true });
    expect(native.verifyNativeEvidence(f.raw, f.test, f.identity, f.root, f.execution).success).toBe(false);
    expect(f.verify().success).toBe(true);
  });
  it.each([
    ['当前实际EXE改变', f => fs.appendFileSync(f.current.executablePath, 'tampered'), 'ARTIFACT_BYTES_CHANGED'],
    ['当前实际Main改变', f => fs.appendFileSync(f.current.paths.mainBundle, 'tampered'), 'ARTIFACT_BYTES_CHANGED'],
    ['当前实际Renderer改变', f => fs.appendFileSync(path.join(f.current.appRoot, 'dist/renderer/index.html'), 'tampered'), 'TRUSTED_CURRENT_PACKAGE_HASH_MISMATCH'],
    ['冻结安全源改变', f => fs.appendFileSync(f.environment.securitySources.sqliteDatabase.path, 'tampered'), 'ARTIFACT_BYTES_CHANGED'],
    ['冻结安全源缺失', f => { delete f.environment.securitySources; }, 'TRUSTED_SECURITY_SOURCES_REQUIRED'],
    ['没有可信包函数', f => { f.environment.currentPackage = f.current; }, 'TRUSTED_NATIVE_ENVIRONMENT_INVALID'],
    ['没有可信UI合同函数', f => { delete f.environment.packageUiContract; }, 'TRUSTED_PACKAGE_UI_CONTRACT_REQUIRED'],
    ['以错误AppContent身份替换', f => { f.current.packageIdentity.appContentSha256 = 'c'.repeat(64); }, 'TRUSTED_CURRENT_PACKAGE_HASH_MISMATCH'],
  ])('拒绝%s', (_title, change, expected) => {
    const f = setup(); change(f); const result = f.verify();
    expect(result).toMatchObject({ success: false, caseIds: [], inputArtifacts: [] });
    expect(result.issues.join('|')).toContain(expected);
    expect(result.diagnostics[0]).toMatchObject({ level: 'error', context: { error: { message: expect.any(String) } } });
  });
  it('显式批准额外原件根，但不放宽截图所属capsule边界', () => {
    const f = setup(), extra = setup();
    const record = extra.write('outside.json', 'outside');
    expect(() => artifacts.withArtifactLedger(new Map(), () => artifacts.readArtifact(f.root, record), [extra.root])).not.toThrow();
    expect(() => artifacts.withArtifactLedger(new Map(), () => artifacts.readArtifact(f.root, record, path.join(f.root, 'output/run')), [extra.root])).toThrow(/OUTSIDE_OWNER/);
    f.environment.securitySources.sqliteDatabase = record;
    expect(f.verify().success).toBe(false);
    f.environment.artifactRoots.push(extra.root);
    expect(f.verify().success).toBe(true);
  });
  it('安全源码组逐件验证，实际实现不能藏在干净facade之后', () => {
    const f = setup(), second = f.write('frozen/db-implementation.ts', 'new Database(path, { verbose: console.log })');
    f.environment.securitySources.sqliteDatabase = { files: [f.environment.securitySources.sqliteDatabase, second] };
    expect(f.verify().issues.join('|')).toContain('PACKAGE_SECURITY_SOURCE_RECHECK_FAILED');
    fs.writeFileSync(second.path, 'new Database(path)'); second.sha256 = artifacts.digest(fs.readFileSync(second.path));
    expect(f.verify().success).toBe(true);
    expect(f.verify().inputArtifacts.map(record => record.path)).toContain(second.path);
  });
  it('空或重复安全源码组不能忽略应扫描的实现', () => {
    const f = setup(), record = f.environment.securitySources.sqliteDatabase;
    f.environment.securitySources.sqliteDatabase = { files: [] };
    expect(f.verify().issues.join('|')).toContain('TRUSTED_SECURITY_SOURCE_GROUP_INVALID');
    f.environment.securitySources.sqliteDatabase = { files: [record, record] };
    expect(f.verify().issues.join('|')).toContain('TRUSTED_SECURITY_SOURCE_GROUP_INVALID');
  });
  it.each([
    ['schema', frozen => { frozen.schemaVersion = 'v0'; }, 'FROZEN_BUILD_SCHEMA_INVALID'],
    ['实现路径穿越', frozen => { frozen.implementationInventory[0].path = '../elsewhere'; }, 'FROZEN_IMPLEMENTATION_INVENTORY_INVALID'],
    ['重复测试清单', frozen => { frozen.testInventory.push(frozen.testInventory[0]); }, 'FROZEN_TEST_INVENTORY_INVALID'],
    ['实现hash无效', frozen => { frozen.implementationInventory[0].sha256 = 'invalid'; }, 'FROZEN_IMPLEMENTATION_INVENTORY_INVALID'],
  ])('冻结合同错误%s不回退Git或接受外部声明', (_title, change, expected) => {
    const f = setup(), p = frozenBuild(f); change(p.frozen);
    expect(verifier.verifyManifest(p.manifest, f.root, undefined, p.runtime).issues.join('|')).toContain(expected);
  });
  it('必须与嵌入清单和已冻结源码身份一致', () => {
    const f = setup(), p = frozenBuild(f); envelope(f);
    expect(() => trusted.validateFrozenBuild(p.frozen, { ...p.frozen.identity, sourceSha256: 'd'.repeat(64) })).toThrow(/IDENTITY_MISMATCH/);
    p.manifest.requiredTests[0].requiredChecks = ['package-hashes'];
    expect(verifier.verifyManifest(p.manifest, f.root, undefined, p.runtime).success).toBe(false);
  });
  it('requirements外部映射不能替换嵌入实现清单', () => {
    const f = setup(), p = frozenBuild(f); envelope(f);
    const verification = verifier.verifyManifest(p.manifest, f.root, undefined, p.runtime);
    const requirements = structuredClone(p.frozen.requirementsIndex);
    requirements.requirements[0].implementation = ['packages/missing.ts'];
    const result = trace.verifyTraceClosure(requirements, p.manifest, f.root, verification, p.runtime);
    expect(result.success).toBe(false); expect(result.issues).toContain('FROZEN_REQUIREMENTS_INDEX_MISMATCH');
    expect(result.details[0].issues.join('|')).toContain('INVALID_IMPLEMENTATION_LINK');
  });
  it('只按可信构建根转换Vitest绝对文件名', () => {
    const report = { success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0,
      testResults: [{ name: 'F:/original-build/scripts/example.test.mjs', status: 'passed', assertionResults: [{ fullName: 'case', status: 'passed' }] }] };
    expect(verifier.summarizeVitest(report, ['scripts/example.test.mjs'], 'G:/installed-workpackage', 'F:/original-build').success).toBe(true);
    expect(verifier.summarizeVitest(report, ['scripts/example.test.mjs'], 'G:/installed-workpackage').success).toBe(false);
  });
  it('无工作区依赖路径时仍用明确注入的实际SQLite重读独立快照', () => {
    const f = setup(), Database = createRequire(path.resolve('packages/local-db/package.json'))('better-sqlite3');
    fs.rmSync(path.join(f.root, 'packages'), { recursive: true });
    const databasePath = path.join(f.root, 'authority.db');
    const database = new Database(databasePath); database.exec('CREATE TABLE proof(value INTEGER); INSERT INTO proof VALUES(7)'); database.close();
    const record = { path: databasePath, sha256: artifacts.digest(fs.readFileSync(databasePath)) };
    const authority = { source: { absolutePath: path.join(f.root, 'amazon-ai-ops.db') }, snapshot: { absolutePath: databasePath, sha256: record.sha256 } };
    let opened = 0;
    const context = { root: f.root, current: f.current, trustedNativeEnvironment: { Database: function (...args) { opened += 1; return new Database(...args); } },
      descriptors: new Map([['authority', { sha256: 'a'.repeat(64) }]]), load: () => authority };
    expect(business.withAuthorityDatabase({ authorityArtifactId: 'authority' }, context, db => db.prepare('SELECT value FROM proof').get().value)).toBe(7);
    expect(opened).toBe(1);
    expect(fs.existsSync(path.join(f.root, 'packages/local-db'))).toBe(false);
  });
  it('打包环境缺少固定在线backup子进程时明确拒绝currentness', () => {
    expect(() => business.verifyAuthorityCurrentness({}, 'fixture', { trustedNativeEnvironment: {} })).toThrow(/TRUSTED_CURRENTNESS_CHILD_REQUIRED/);
  });
  it('迁移运行依赖不完整时拒绝转回源树动态编译', () => {
    const f = setup(), source = f.write('source.db', 'source'), working = f.write('working.db', 'working'), restore = f.write('restore.db', 'restore');
    const manifest = f.json('migration.json', { source, workingDatabase: { path: working.path, upgradedSha256: working.sha256 }, restore: { destinationPath: restore.path, sha256: restore.sha256 } });
    expect(() => migration.verifyS7MigrationBackupRestore(manifest.path, {})).toThrow(/TRUSTED_MIGRATION_RUNTIME_INVALID/);
  });
});
