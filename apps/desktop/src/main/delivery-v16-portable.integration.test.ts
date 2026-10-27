import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import Database from 'better-sqlite3';
import { deliveryAuthoritySha256 } from './delivery-v16-authority';
import type { DeliveryV16Request } from './delivery-v16-contracts';

const require = createRequire(import.meta.url);
const { collectFrozenBuild } = require('../../scripts/v16-frozen-build');
const { EXTERNALS } = require('../../scripts/build-main');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
let root: string, appRoot: string, frozen: any, receipts: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-v16-portable-'));
  receipts = path.join(repo, 'output/development-completion-2026-10-16/main-composition/v16-portable-run-receipts', randomUUID());
  fs.mkdirSync(receipts, { recursive: true });
  appRoot = path.join(root, 'installed/resources/app');
  fs.mkdirSync(path.join(appRoot, 'dist/main'), { recursive: true });
  frozen = collectFrozenBuild(repo);
  const before = JSON.stringify(frozen);
  const embedded = { ...frozen, sourceRoot: path.join(root, 'BUILD_MACHINE_SOURCE_UNAVAILABLE') };
  for (const [entry, name] of [['delivery-v16-worker.ts', 'delivery-v16-worker.cjs'], ['delivery-v16-backup-child.ts', 'delivery-v16-backup-child.cjs']]) buildSync({
    absWorkingDir: path.join(repo, 'apps/desktop'), entryPoints: ['src/main/' + entry],
    outfile: path.join(appRoot, 'dist/main', name), bundle: true, platform: 'node', target: 'node18', format: 'cjs',
    external: EXTERNALS, logLevel: 'warning', define: { __V16_FROZEN_BUILD_JSON__: JSON.stringify(JSON.stringify(embedded)) },
  });
  if (JSON.stringify(collectFrozenBuild(repo)) !== before) throw new Error('V16_TEST_SOURCE_CHANGED_DURING_BUNDLE');
  fs.writeFileSync(path.join(receipts, 'frozen-build.json'), JSON.stringify(embedded, null, 2));
  fs.writeFileSync(path.join(receipts, 'bundled-files.json'), JSON.stringify(['delivery-v16-worker.cjs', 'delivery-v16-backup-child.cjs'].map(name => {
    const bytes = fs.readFileSync(path.join(appRoot, 'dist/main', name));
    return { name, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }), null, 2));
  const desktopRequire = createRequire(path.join(repo, 'apps/desktop/package.json'));
  for (const name of ['better-sqlite3', 'bindings', 'file-uri-to-path', 'playwright', 'playwright-core']) {
    const source = path.dirname(desktopRequire.resolve(name + '/package.json'));
    fs.cpSync(source, path.join(appRoot, 'node_modules', name), { recursive: true, dereference: true });
  }
  fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify(frozen.desktopPackage));
  fs.writeFileSync(path.join(appRoot, 'dist/main/index.js'), '// 隔离测试包标记，不是生产验收原件。\n');
  fs.writeFileSync(path.join(root, 'installed/AmazonAIOpsAgent.exe'), 'isolated-native-verifier-test-executable');
  fs.writeFileSync(path.join(root, 'launch-worker.cjs'), `const {Worker}=require('node:worker_threads');const fs=require('node:fs');const request=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const worker=new Worker(request.paths.workerPath,{workerData:request});worker.once('message',value=>process.stdout.write(JSON.stringify(value)));worker.once('error',error=>{process.stderr.write(error.stack);process.exitCode=1});worker.once('exit',code=>{if(code)process.exitCode=code});`);
}, 120_000);
afterAll(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

function request(operation: DeliveryV16Request['operation'] = 'view'): DeliveryV16Request {
  const workPackageRoot = path.join(root, 'acceptance-work-package');
  fs.mkdirSync(workPackageRoot, { recursive: true });
  const authority = { storeContext: null, scope: null, scopeRevision: 'none', mode: { value: null, revision: null }, configurationRevision: 1, workPackageRoot };
  const paths = {
    appRoot, executablePath: path.join(root, 'installed/AmazonAIOpsAgent.exe'), mainBundlePath: path.join(appRoot, 'dist/main/index.js'),
    workerPath: path.join(appRoot, 'dist/main/delivery-v16-worker.cjs'), backupHelperPath: path.join(appRoot, 'dist/main/delivery-v16-backup-child.cjs'),
    workPackageRoot, cacheRoot: path.join(root, 'private/cache'), outputRoot: path.join(root, 'private/output'),
    authorityDbPath: path.join(root, 'canonical/db.sqlite'), authoritySnapshotRoot: path.join(workPackageRoot, 'authority-snapshots'), tempRoot: path.join(root, 'private/temp'),
  };
  return { schemaVersion: 'v16.delivery-request/1', operation, authority, paths, appVersion: frozen.identity.packageVersion, nativeAbi: process.versions.modules, binding: { nonce: randomUUID(), epoch: 1, authoritySha256: deliveryAuthoritySha256({ authority, paths }) } };
}
function run(input: DeliveryV16Request) {
  const file = path.join(root, input.binding.nonce + '.json'); fs.writeFileSync(file, JSON.stringify(input));
  const child = spawnSync(process.execPath, [path.join(root, 'launch-worker.cjs'), file], { cwd: root, env: { ...process.env, PATH: path.dirname(process.execPath) }, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  fs.writeFileSync(path.join(receipts, `${input.operation}-${input.binding.nonce}-request.json`), JSON.stringify(input, null, 2));
  fs.writeFileSync(path.join(receipts, `${input.operation}-${input.binding.nonce}-stdout.txt`), child.stdout ?? '');
  fs.writeFileSync(path.join(receipts, `${input.operation}-${input.binding.nonce}-stderr.txt`), child.stderr ?? '');
  expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(0);
  return JSON.parse(child.stdout);
}

describe('V16 verifier in an installed directory without Git or source', () => {
  it('runs the actual bundled worker and reports missing real L6 and L7 originals without blocking application startup', () => {
    const input = request(), message = run(input);
    expect(message.error).toBeUndefined();
    expect(message.nativeAbi).toBe(process.versions.modules);
    expect(message.result.binding).toEqual(input.binding);
    expect(message.result.readiness).toMatchObject({ appReady: false, status: 'APP_NEEDS_WORK', gatesSummary: { total: 8, passed: 0, failed: 8 } });
    expect(message.result.readiness.verificationProtocol).toBeUndefined();
    expect(message.result.readiness.gates.filter((gate: any) => ['L6', 'L7'].includes(gate.id)).every((gate: any) => !gate.ok && /真实|两|两个|模式/.test(gate.message))).toBe(true);
    expect(JSON.stringify(message.result.readiness.missing)).not.toMatch(/ENOENT|MISSING_|ARTIFACT_|[A-Z]:\\/);
    expect(fs.existsSync(path.join(root, 'BUILD_MACHINE_SOURCE_UNAVAILABLE'))).toBe(false);
  }, 90_000);
  it('exports a faithful NON_READY bundle and never grants credit to packet APP_READY booleans', () => {
    const input = request('export');
    fs.writeFileSync(path.join(input.paths.workPackageRoot, 'manifest.json'), JSON.stringify({ ...frozen.requiredManifestDefinition, identity: frozen.identity, status: 'APP_READY', appReady: true, passed: true }));
    const message = run(input);
    expect(message.error).toBeUndefined();
    expect(message.result.exported).toMatchObject({ success: true, status: 'APP_NEEDS_WORK' });
    expect(message.result.readiness.appReady).toBe(false);
    expect(message.result.readiness.verificationProtocol).toBe('v16.current-publication/1');
    const bundle = JSON.parse(fs.readFileSync(message.result.exported.manifestPath, 'utf8'));
    expect(bundle).toMatchObject({ status: 'NON_READY', phase: 'PUBLISHED', requiresCurrentPublicationClosure: true });
    expect(fs.readFileSync(path.join(message.result.exported.bundleDir, 'README.snapshot.md'), 'utf8')).toContain('INTERNAL NON_READY');
  }, 90_000);
  it('rejects a modified request binding before reading any acceptance originals', () => {
    const input = request();
    expect(run({ ...input, binding: { ...input.binding, authoritySha256: '0'.repeat(64) } }).error).toMatchObject({ message: 'V16_WORKER_REQUEST_BINDING_INVALID' });
  });
  it('runs the fixed bundled online backup child with the current native ABI and preserves the source DB', () => {
    const input = request(), owned = path.join(root, 'backup-owned'); fs.mkdirSync(owned);
    const source = path.join(root, 'source.sqlite'), destination = path.join(owned, 'snapshot.sqlite');
    const db = new Database(source); db.exec('CREATE TABLE source_evidence(value TEXT); INSERT INTO source_evidence VALUES (\'preserved\')'); db.close();
    const original = fs.readFileSync(source);
    const child = spawnSync(process.execPath, [input.paths.backupHelperPath, '--readonly-online-backup-child', source, destination, owned], { cwd: root, encoding: 'utf8', timeout: 30_000, windowsHide: true });
    fs.writeFileSync(path.join(receipts, 'readonly-backup-child.json'), JSON.stringify({ fixtureKind: 'isolated-test-database-not-formal-data', nativeAbi: process.versions.modules, status: child.status, stdout: child.stdout, stderr: child.stderr, sourceBeforeSha256: createHash('sha256').update(original).digest('hex'), sourceAfterSha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') }, null, 2));
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({ method: 'readonly-sqlite-online-backup', openedReadOnly: true, queryOnly: true });
    const snapshot = new Database(destination, { readonly: true, fileMustExist: true });
    try { expect(snapshot.prepare('SELECT value FROM source_evidence').get()).toEqual({ value: 'preserved' }); } finally { snapshot.close(); }
    expect(fs.readFileSync(source)).toEqual(original);
  });
});
