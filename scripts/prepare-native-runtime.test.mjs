import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  EXPECTED_ELECTRON_MODULES_ABI,
  LOCK_BASENAME,
  NATIVE_STATE_ROOT,
  acquireNativeRuntimeLock,
  buildElectronPrebuildCommand,
  parseNativeRuntimeArgs,
  prepareNativeRuntime,
  privateCanonicalBinding,
  probeInputForMode,
  releaseNativeRuntimeLock,
  sanitizedNativeEnvironment,
  sha256File,
  validateNativeProbeObserved,
  withPreparedIsolatedElectronRuntime,
} = require('./prepare-native-runtime.js');

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('read-only source and isolated Electron native runtime', () => {
  it('supports only read-only Node and packaged verification modes', () => {
    expect(parseNativeRuntimeArgs(['node', 'script', '--mode=node']))
      .toEqual({ mode: 'node', packageExe: '' });
    expect(parseNativeRuntimeArgs([
      'node',
      'script',
      '--mode',
      'package',
      '--package-exe',
      'D:\\package\\AmazonAIOpsAgent.exe',
    ])).toEqual({
      mode: 'package',
      packageExe: 'D:\\package\\AmazonAIOpsAgent.exe',
    });
    expect(() => parseNativeRuntimeArgs(['node', 'script', '--mode=electron']))
      .toThrow(/node, package/i);
    expect(() => parseNativeRuntimeArgs(['node', 'script'])).toThrow(/--mode/i);
  });

  it('uses direct prebuild-install only inside the supplied isolated package root', () => {
    const fixture = sourceFixture();
    const stagedRoot = path.join(fixture.directory, 'isolated', 'better-sqlite3');
    fs.mkdirSync(stagedRoot, { recursive: true });
    const command = buildElectronPrebuildCommand({
      ...fixture.sourcePaths,
      betterSqliteRoot: stagedRoot,
    });
    expect(command.executablePath).toBe(process.execPath);
    expect(command.cwd).toBe(stagedRoot);
    expect(command.args).toEqual([
      fixture.sourcePaths.prebuildInstallPath,
      '--runtime=electron',
      '--target=44.2.0',
      '--arch=x64',
      '--platform=win32',
    ]);
    expect(command.args.slice(1).join(' '))
      .not.toMatch(/install-app-deps|node-gyp|duckdb|pnpm|rebuild/i);
  });

  it('removes inherited native-target overrides before spawning child tools', () => {
    expect(sanitizedNativeEnvironment({
      PATH: 'safe-path',
      npm_config_runtime: 'electron',
      NPM_CONFIG_TARGET: '44.2.0',
      npm_config_build_from_source: 'true',
      npm_config_target_arch: 'arm64',
      npm_execpath: 'unsafe-cli',
      NPM_CLI_JS: 'unsafe-npm-cli',
    })).toEqual({ PATH: 'safe-path' });
  });

  it('pins isolated Electron and packaged probes to ABI 149', () => {
    expect(probeInputForMode('electron', {
      executablePath: 'D:\\electron.exe',
      betterSqliteRoot: 'D:\\better-sqlite3',
      duckdbRoot: 'D:\\duckdb',
      electronVersion: '44.2.0',
    })).toMatchObject({
      expectedElectronVersion: '44.2.0',
      expectedModulesAbi: EXPECTED_ELECTRON_MODULES_ABI,
    });
    expect(() => validateNativeProbeObserved(
      {
        sqliteValue: 1,
        duckdbValue: 1,
        electronVersion: '44.2.0',
        modulesAbi: '118',
      },
      {
        expectedElectronVersion: '44.2.0',
        expectedModulesAbi: EXPECTED_ELECTRON_MODULES_ABI,
      },
    )).toThrow(/ABI mismatch.*149.*118/i);
  });

  it('verifies Node source bindings read-only and refuses an in-place repair', () => {
    const fixture = sourceFixture();
    const before = fixture.sourceHashes();
    const result = prepareNativeRuntime(
      { mode: 'node', packageExe: '' },
      {
        electronMetadata: { version: '44.2.0' },
        sourcePaths: fixture.sourcePaths,
        withLock: (callback) => callback(),
        runProbe: () => observedRuntime(process.versions.modules, null),
      },
    );
    expect(result).toMatchObject({
      mode: 'node',
      action: 'verified-only',
      probes: { sqliteValue: 1, duckdbValue: 1 },
    });
    expect(fixture.sourceHashes()).toEqual(before);

    expect(() => prepareNativeRuntime(
      { mode: 'node', packageExe: '' },
      {
        electronMetadata: { version: '44.2.0' },
        sourcePaths: fixture.sourcePaths,
        withLock: (callback) => callback(),
        runProbe: () => {
          throw new Error('wrong ABI');
        },
      },
    )).toThrow(/refuses to rebuild or rewrite.*wrong ABI/i);
    expect(fixture.sourceHashes()).toEqual(before);
  });

  it('verifies an injected package directly without resolving source build tools', () => {
    const fixture = packageFixture();
    let probeInput;
    const result = prepareNativeRuntime(
      { mode: 'package', packageExe: fixture.executablePath },
      {
        electronMetadata: { version: '44.2.0' },
        packagePaths: fixture.packagePaths,
        withLock: (callback) => callback(),
        runProbe: (input) => {
          probeInput = input;
          return observedRuntime(EXPECTED_ELECTRON_MODULES_ABI, '44.2.0');
        },
      },
    );
    expect(probeInput).toMatchObject({
      executablePath: fixture.executablePath,
      expectedElectronVersion: '44.2.0',
      expectedModulesAbi: EXPECTED_ELECTRON_MODULES_ABI,
    });
    expect(result).toMatchObject({
      mode: 'package',
      action: 'verified-only',
    });
  });

  it('prepares Electron in an isolated copy and leaves both source bindings byte-identical', () => {
    const fixture = sourceFixture();
    const before = fixture.sourceHashes();
    let stagedBindingPath;
    const result = withPreparedIsolatedElectronRuntime(
      fixture.sourcePaths,
      { version: '44.2.0' },
      (preparation) => {
        stagedBindingPath = preparation.bindings.sqlite.path;
        expect(fs.readFileSync(stagedBindingPath, 'utf8')).toBe('isolated-electron-sqlite');
        expect(fixture.sourceHashes()).toEqual(before);
        return preparation;
      },
      {
        withLock: (callback) => callback(),
        executeCommand: (command) => {
          expect(command.cwd).not.toBe(fixture.sourcePaths.betterSqliteRoot);
          expect(fs.existsSync(path.join(
            path.dirname(command.cwd),
            'node_modules',
            'bindings',
            'index.js',
          ))).toBe(true);
          expect(fs.existsSync(path.join(
            path.dirname(command.cwd),
            'node_modules',
            'file-uri-to-path',
            'index.js',
          ))).toBe(true);
          fs.writeFileSync(
            path.join(command.cwd, 'build', 'Release', 'better_sqlite3.node'),
            'isolated-electron-sqlite',
          );
        },
        runProbe: (input) => {
          expect(input.betterSqliteRoot).not.toBe(fixture.sourcePaths.betterSqliteRoot);
          expect(input.duckdbRoot).toBe(fixture.sourcePaths.duckdbRoot);
          return observedRuntime(EXPECTED_ELECTRON_MODULES_ABI, '44.2.0');
        },
      },
    );
    expect(result.target.modulesAbi).toBe(EXPECTED_ELECTRON_MODULES_ABI);
    expect(fixture.sourceHashes()).toEqual(before);
    expect(fs.existsSync(path.dirname(path.dirname(path.dirname(stagedBindingPath))))).toBe(false);
  });

  it('loads shipped N-API prebuilds without invoking an ABI-specific installer', () => {
    const fixture = sourceFixture();
    const sqliteBindingPath = path.join(fixture.sourcePaths.betterSqliteRoot, 'prebuilds', 'win32-x64.node');
    fs.mkdirSync(path.dirname(sqliteBindingPath));
    fs.writeFileSync(sqliteBindingPath, 'shipped-napi-prebuild');
    const before = sha256File(sqliteBindingPath);
    const result = withPreparedIsolatedElectronRuntime({ ...fixture.sourcePaths, sqliteBindingPath, sqliteNapi: true, runtimeDependencyRoots: [] },
      { version: '44.2.0' }, p => p, {
        withLock: work => work(),
        executeCommand: () => { throw new Error('N-API must not download or rebuild'); },
        runProbe: input => {
          expect(fs.readFileSync(path.join(input.betterSqliteRoot, 'prebuilds', 'win32-x64.node'), 'utf8')).toBe('shipped-napi-prebuild');
          return observedRuntime(EXPECTED_ELECTRON_MODULES_ABI, '44.2.0');
        },
      });
    expect(result.bindings.sqlite.sha256).toBe(before);
    expect(sha256File(sqliteBindingPath)).toBe(before);
    expect(fs.existsSync(result.bindings.sqlite.path)).toBe(false);
  });

  it('actually enters the CLI on Windows and rejects invalid modes with a nonzero exit', () => {
    const run = spawnSync(process.execPath, [path.resolve('scripts/prepare-native-runtime.js'), '--mode=invalid'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/--mode must be one of/);
  });

  it('cleans isolated staging and preserves source hashes when downstream packaging fails', () => {
    const fixture = sourceFixture();
    const before = fixture.sourceHashes();
    let stagedRoot;
    expect(() => withPreparedIsolatedElectronRuntime(
      fixture.sourcePaths,
      { version: '44.2.0' },
      (preparation) => {
        stagedRoot = preparation.bindings.sqlite.path;
        throw new Error('builder failed');
      },
      {
        withLock: (callback) => callback(),
        executeCommand: (command) => {
          fs.writeFileSync(
            path.join(command.cwd, 'build', 'Release', 'better_sqlite3.node'),
            'isolated-electron-sqlite',
          );
        },
        runProbe: () => observedRuntime(EXPECTED_ELECTRON_MODULES_ABI, '44.2.0'),
      },
    )).toThrow(/builder failed/i);
    expect(fixture.sourceHashes()).toEqual(before);
    expect(fs.existsSync(stagedRoot)).toBe(false);
  });

  it('rejects multi-link mutable source bindings before production use', () => {
    const directory = tempDirectory();
    const root = path.join(directory, 'package');
    fs.mkdirSync(root);
    const bindingPath = path.join(root, 'binding.node');
    const linkedPath = path.join(root, 'linked.node');
    fs.writeFileSync(bindingPath, 'shared');
    fs.linkSync(bindingPath, linkedPath);
    expect(() => privateCanonicalBinding(root, bindingPath, 'test binding'))
      .toThrow(/private single-link.*nlink=2/i);
  });

  it('anchors the default lock in the repository state root and fails closed on foreign owners', () => {
    expect(path.dirname(path.join(NATIVE_STATE_ROOT, LOCK_BASENAME))).toBe(NATIVE_STATE_ROOT);
    const directory = tempDirectory();
    const owner = acquireNativeRuntimeLock({
      tempRoot: directory,
      token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(() => acquireNativeRuntimeLock({
      tempRoot: directory,
      isProcessAliveFn: () => true,
    })).toThrow(/already active/i);
    fs.writeFileSync(owner.lockPath, `${JSON.stringify({
      pid: owner.pid,
      token: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      createdAt: new Date().toISOString(),
    })}\n`);
    expect(() => releaseNativeRuntimeLock(owner)).toThrow(/ownership changed/i);
    fs.rmSync(owner.lockPath);

    const stalePayload = `${JSON.stringify({
      pid: 99999999,
      token: 'cccccccccccccccccccccccccccccccc',
      createdAt: new Date().toISOString(),
    })}\n`;
    const lockPath = path.join(directory, LOCK_BASENAME);
    fs.writeFileSync(lockPath, stalePayload);
    expect(() => acquireNativeRuntimeLock({
      tempRoot: directory,
      isProcessAliveFn: () => false,
    })).toThrow(/stale.*source bindings were never rewritten/i);
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(stalePayload);
    fs.writeFileSync(lockPath, '');
    expect(() => acquireNativeRuntimeLock({ tempRoot: directory }))
      .toThrow(/malformed.*left untouched/i);
  });
});

function sourceFixture() {
  const directory = tempDirectory();
  const betterSqliteRoot = path.join(directory, 'better-sqlite3');
  const duckdbRoot = path.join(directory, 'duckdb');
  const sqliteBindingPath = path.join(
    betterSqliteRoot,
    'build',
    'Release',
    'better_sqlite3.node',
  );
  const duckdbBindingPath = path.join(duckdbRoot, 'lib', 'binding', 'duckdb.node');
  const betterSqlitePackageJson = path.join(betterSqliteRoot, 'package.json');
  const duckdbPackageJson = path.join(duckdbRoot, 'package.json');
  const prebuildInstallPath = path.join(directory, 'prebuild-install.js');
  const executablePath = path.join(directory, 'electron.exe');
  const bindingsRoot = path.join(directory, 'dependencies', 'bindings');
  const fileUriRoot = path.join(directory, 'dependencies', 'file-uri-to-path');
  fs.mkdirSync(path.dirname(sqliteBindingPath), { recursive: true });
  fs.mkdirSync(path.dirname(duckdbBindingPath), { recursive: true });
  fs.writeFileSync(sqliteBindingPath, 'source-node-sqlite');
  fs.writeFileSync(duckdbBindingPath, 'source-duck');
  fs.writeFileSync(betterSqlitePackageJson, '{"name":"better-sqlite3"}');
  fs.writeFileSync(duckdbPackageJson, '{"name":"duckdb"}');
  fs.writeFileSync(prebuildInstallPath, 'prebuild');
  fs.writeFileSync(executablePath, 'electron');
  fs.mkdirSync(bindingsRoot, { recursive: true });
  fs.mkdirSync(fileUriRoot, { recursive: true });
  fs.writeFileSync(path.join(bindingsRoot, 'index.js'), 'bindings');
  fs.writeFileSync(path.join(fileUriRoot, 'index.js'), 'file-uri');
  const sourcePaths = {
    kind: 'source-native-runtime',
    electronVersion: '44.2.0',
    executablePath,
    betterSqliteRoot,
    betterSqlitePackageJson,
    sqliteBindingPath,
    prebuildInstallPath,
    runtimeDependencyRoots: [
      { name: 'bindings', root: bindingsRoot },
      { name: 'file-uri-to-path', root: fileUriRoot },
    ],
    duckdbRoot,
    duckdbPackageJson,
    duckdbBindingPath,
  };
  return {
    directory,
    sourcePaths,
    sourceHashes: () => ({
      sqliteSha256: sha256File(sqliteBindingPath),
      duckdbSha256: sha256File(duckdbBindingPath),
    }),
  };
}

function packageFixture() {
  const directory = tempDirectory();
  const executablePath = path.join(directory, 'AmazonAIOpsAgent.exe');
  const sqliteBindingPath = path.join(directory, 'better_sqlite3.node');
  const duckdbBindingPath = path.join(directory, 'duckdb.node');
  fs.writeFileSync(executablePath, 'package-exe');
  fs.writeFileSync(sqliteBindingPath, 'package-sqlite');
  fs.writeFileSync(duckdbBindingPath, 'package-duck');
  return {
    executablePath,
    packagePaths: {
      electronVersion: '44.2.0',
      executablePath,
      betterSqliteRoot: directory,
      duckdbRoot: directory,
      sqliteBindingPath,
      duckdbBindingPath,
    },
  };
}

function observedRuntime(modulesAbi, electronVersion) {
  return {
    nodeVersion: '18.0.0',
    electronVersion,
    modulesAbi: String(modulesAbi),
    platform: 'win32',
    arch: 'x64',
    sqliteValue: 1,
    duckdbValue: 1,
  };
}

function tempDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'amazon-ai-ops-native-test-'),
  );
  tempDirectories.push(directory);
  return directory;
}
