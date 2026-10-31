import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import native from './v16-native-artifacts.js';
import ui from './package-ui-evidence.js';
import security from './smoke-package-security-boundaries.js';
import version from './current-app-version.js';

// 仅供校验器测试，不能生成正式验收证据。
export function nativeFixture() {
  const packageVersion = version.currentAppVersion();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v16-native-fixture-'));
  const now = Date.now() - 10000, generatedAt = new Date(now + 1000).toISOString();
  const execution = { startedAt: new Date(now).toISOString(), finishedAt: new Date(now + 9000).toISOString(), exitCode: 0 };
  const write = (name, bytes) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); return { path: file, sha256: native.digest(fs.readFileSync(file)) }; };
  const json = (name, value) => write(name, JSON.stringify(value));
  const app = 'apps/desktop/release/win-unpacked/resources/app';
  const main = [
    "const a = 'amazon-ai-ops:navigation-security/v1';", "const b = 'amazon-ai-ops:legacy-login-migration/v1';",
    "const development = !app.isPackaged && process.env.NODE_ENV === 'development';",
    "mainWindow.webContents.on('will-navigate', createMainWindowNavigationHandler({}));",
    "mainWindow.webContents.on('will-redirect', createMainWindowNavigationHandler({}));",
    'mainWindow.webContents.setWindowOpenHandler(createSecureWindowOpenHandler({}));',
    "ipcMain.handle('browser:get-saved-credential-status', () => status);",
    'function openApprovedExternalTarget(safeUrl) { return shell.openExternal(safeUrl); }',
  ].join('\n');
  const bundle = Object.fromEntries(Object.entries({ 'main/index.js': main, 'preload/index.js': 'preload', 'preload/index.cjs': 'preload', 'renderer/index.html': '<main>fixture</main>' }).map(([name, content]) => [name, write(`${app}/dist/${name}`, content).sha256]));
  const sqlite = write(`${app}/node_modules/better-sqlite3/build/Release/better_sqlite3.node`, 'fixture-sqlite');
  const duckdb = write(`${app}/node_modules/duckdb/lib/binding/duckdb.node`, 'fixture-duckdb');
  write(`${app}/package.json`, JSON.stringify({ name: '@amazon-ai-ops/desktop', version: packageVersion, main: 'dist/main/index.js' }));
  write('apps/desktop/package.json', JSON.stringify({ name: '@amazon-ai-ops/desktop', version: packageVersion, main: 'dist/main/index.js' }));
  write(`${app}/playwright-browsers/chrome-win64/chrome.exe`, 'fixture-browser');
  write('packages/local-db/src/sqlite/repositories/settings-repo.ts', "this.set('login_credentials_encrypted', value)");
  write('packages/local-db/src/sqlite/db.ts', 'new Database(finalPath)');
  for (const name of ['db-migration-contract', 'db-migration-runner', 'db-metric-identity', 'db-columns']) write(`packages/local-db/src/sqlite/${name}.ts`, 'export {}');
  const exe = write('apps/desktop/release/win-unpacked/AmazonAIOpsAgent.exe', 'fixture-current-exe');
  const artifacts = Object.fromEntries(['installer', 'portable', 'zip'].map((key, i) => [key, write(`apps/desktop/release/AmazonAIOpsAgent-${packageVersion}${i === 1 ? '-portable' : ''}.${i === 2 ? 'zip' : 'exe'}`, `fixture-${key}`)]));
  const identity = { sourceRevision: 'a'.repeat(40), sourceSha256: 'b'.repeat(64), packageVersion, packageHashes: { ...Object.fromEntries(Object.entries(artifacts).map(([key, record]) => [key, record.sha256])), mainBundle: bundle['main/index.js'], appContent: ui.buildAppContentManifest(path.join(root, app)).sha256 } };
  const current = native.currentPackage(root, identity);
  const profile = path.join(root, 'amazon-ai-ops-runtime-validation/fixture-run');
  const runtime = kind => ({
    kind: 'isolated-packaged-desktop-runtime', schemaVersion: 1, generatedAt, passed: true,
    rendererErrors: [], consoleErrors: [], profile, canonicalBefore: { protected: 'unchanged' }, canonicalAfter: { protected: 'unchanged' },
    target: { packaged: true, deliveryKind: kind, executablePath: kind === 'portable' ? artifacts.portable.path : path.join(root, `${kind}/AmazonAIOpsAgent.exe`), executableSha256: kind === 'portable' ? artifacts.portable.sha256 : exe.sha256 },
    nativeProbe: { platform: 'win32', sqliteValue: 1, duckdbValue: 1 }, nativeBindings: { before: { sqlite: sqlite.sha256, duckdb: duckdb.sha256 }, after: { sqlite: sqlite.sha256, duckdb: duckdb.sha256 } },
    bundleHashes: bundle, expectedSourceBundleHashes: bundle, logs: { recordCount: 3 },
    launches: ['first', 'restart'].map((label, i) => {
      const url = pathToFileURL(path.join(root, `${kind}/resources/app/dist/renderer/index.html`)).href;
      return { label, pid: 100 + i, packaged: true, userDataDir: profile, windows: [{ id: 1, visible: true, destroyed: false, url, preferences: { contextIsolation: true, nodeIntegration: false } }], ready: { kind: 'package-launch-window-ready', schemaVersion: 1, evidenceMode: 'package-launch-smoke', pid: 100 + i, browserWindowId: 1, generatedAt, userDataDir: profile, rendererUrl: url } };
    }),
    ...(kind === 'portable' ? { portableRuns: ['first', 'restart'].map((label, i) => ({ label, identity: { processId: 100 + i, launcherSha256: artifacts.portable.sha256, executableSha256: exe.sha256 }, extractionRemoved: true })) } : {}),
  });
  const originals = [];
  for (const role of ['first-initial', 'restart-initial', 'settings-saved', 'rules-saved', 'settings-restart']) originals.push({ ...write(`output/run/${role}.png`, pngBytes()), role });
  originals.push({ ...write('output/run/runtime.jsonl', [
    { timestamp: generatedAt, level: 'error', event: 'ipc.handler_failed', context: { channel: 'settings:save-rule-config' } },
    ...[1, 2].map(() => ({ timestamp: generatedAt, level: 'info', event: 'runtime.message', context: { message: '[StoreContextTracker] cleared during shutdown' } })),
  ].map(x => JSON.stringify(x)).join('\n')), role: 'runtime-log' });
  const descriptors = [], reports = new Map();
  const artifact = (id, adapter, report, extra = {}) => { const descriptor = { id, adapter, runId: 'fixture-run', ...json(`output/run/${id}.json`, report), ...extra }; descriptors.push(descriptor); reports.set(id, report); return descriptor; };
  artifact('installed-runtime', 'desktop-runtime', runtime('installed'), { originals });
  artifact('portable-runtime', 'desktop-runtime', runtime('portable'), { originals });
  artifact('zip-runtime', 'desktop-runtime', runtime('folder-zip'), { originals });
  artifact('installed', 'installed-package', {
    kind: 'installed-package-smoke', schemaVersion: 1, generatedAt, runId: 'fixture-run', failures: [], installer: artifacts.installer,
    currentExe: { sha256: exe.sha256 }, canonicalBefore: {}, canonicalAfter: {}, paths: { installRoot: path.join(root, 'installed') },
    events: ['install', 'uninstall'].flatMap(stage => [
      { timestamp: generatedAt, event: `package.${stage}.started`, context: { pid: 123 } },
      { timestamp: generatedAt, event: `package.${stage}.finished`, context: { pid: 123, exitCode: 0 } },
    ]), restoration: { finalSnapshot: { installationExists: false, registry: Array.from({ length: 8 }, () => ({ exists: false })), shortcuts: Array.from({ length: 4 }, () => ({ exists: false })), processes: [] } },
  }, { runtimeArtifactId: 'installed-runtime' });
  artifact('zip', 'folder-zip', { kind: 'folder-zip-launch-smoke', schemaVersion: 1, generatedAt, temporaryFilesRemoved: true, zip: artifacts.zip,
    extractedExecutable: { path: path.join(root, 'folder-zip/AmazonAIOpsAgent.exe'), sha256: exe.sha256 }, runtime: { processId: 21, mainWindowHandle: 123, windowReadyGeneratedAt: generatedAt }, stoppedProcessIds: [21],
  }, { runtimeArtifactId: 'zip-runtime' });
  artifact('security', 'package-security', security.collectPackageSecurityBoundaries({ generatedAt, packageHashes: { exeSha256: exe.sha256, appContentSha256: identity.packageHashes.appContent }, expectedExeSha256: exe.sha256, expectedAppContentSha256: identity.packageHashes.appContent, mainBundlePath: current.paths.mainBundle, settingsRepositoryPath: path.join(root, 'packages/local-db/src/sqlite/repositories/settings-repo.ts'), sqliteDbPath: path.join(root, 'packages/local-db/src/sqlite/db.ts') }));
  artifact('hashes', 'package-hashes', { kind: 'v16-current-package', schemaVersion: 1, generatedAt, packageIdentity: current.packageIdentity });
  const refs = { 'installer-launch': ['installed'], 'portable-launch': ['portable-runtime'], 'zip-launch': ['zip'], 'native-dependencies': ['portable-runtime'], 'navigation-external-open': ['security'], 'shutdown-cleanup': ['installed', 'portable-runtime', 'zip'], 'package-hashes': ['hashes'] };
  const test = { testId: 'V16-T-L5-ARTIFACTS', layer: 'L5', format: 'checks-json', requiredChecks: Object.keys(refs), evidencePath: 'evidence.json' };
  const raw = { schemaVersion: 'v16.native-checks/1', runId: 'fixture-run', testId: test.testId, sourceSha256: identity.sourceSha256, success: true, nativeArtifacts: descriptors, checks: Object.entries(refs).map(([id, nativeArtifactIds]) => ({ id, passed: true, nativeArtifactIds })) };
  const refresh = id => { const descriptor = descriptors.find(x => x.id === id); Object.assign(descriptor, json(`output/run/${id}.json`, reports.get(id))); };
  return { root, execution, identity, current, test, raw, reports, descriptors, write, json, refresh, originals, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
export function pngBytes(gray = 0, width = 1200, height = 700) {
  const chunk = (type, data) => {
    const name = Buffer.from(type), bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); name.copy(bytes, 4); data.copy(bytes, 8);
    let crc = 0xffffffff; for (const byte of Buffer.concat([name, data])) { crc ^= byte; for (let n = 0; n < 8; n += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return bytes;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8;
  const pixels = Buffer.alloc((width + 1) * height, gray);
  for (let row = 0; row < height; row += 1) pixels[row * (width + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
