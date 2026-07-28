import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildWindowsPackage,
  resolveWindowsBuildSteps,
} = require('./build-windows-package.js');
const {
  EXPECTED_ELECTRON_MODULES_ABI,
  sha256File,
} = require('./prepare-native-runtime.js');

const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('single-lock isolated Windows package orchestration', () => {
  it('uses direct entrypoints and passes the isolated binding contract only to builder', () => {
    const builderEnvironment = {
      AAO_STAGED_SQLITE_BINDING: 'D:\\isolated\\better_sqlite3.node',
      AAO_STAGED_SQLITE_SHA256: 'A'.repeat(64),
      AAO_SOURCE_DUCKDB_SHA256: 'B'.repeat(64),
      AAO_ELECTRON_VERSION: '28.3.3',
      AAO_ELECTRON_MODULES_ABI: '119',
    };
    const steps = resolveWindowsBuildSteps(builderEnvironment);
    expect(steps.map((step) => step.name)).toEqual([
      'build-main',
      'publish-main-entry',
      'build-preload',
      'publish-preload-entry',
      'build-renderer',
      'stage-playwright-chromium',
      'electron-builder-windows',
    ]);
    const commandSteps = steps.filter((step) => step.kind === 'command');
    const commandText = commandSteps
      .flatMap((step) => [step.executablePath, ...step.args])
      .join(' ');
    expect(commandSteps.some((step) => (
      /^(?:npm|pnpm)(?:\.cmd)?$/i.test(path.basename(step.executablePath))
      || step.args.some((arg) => /^(?:npm|pnpm)(?:\.cmd)?$/i.test(arg))
    ))).toBe(false);
    expect(commandText).toMatch(/stage-playwright-chromium\.js/i);
    expect(commandText).toMatch(/electron-builder[\\/]+cli\.js/i);
    expect(steps.at(-1).env).toMatchObject(builderEnvironment);
    expect(steps.at(-1).env.NO_UPDATE_NOTIFIER).toBe('1');
    expect(steps.at(-2).env.AAO_STAGED_SQLITE_BINDING).toBeUndefined();
  });

  it('holds one outer scope across isolated prep, build, package probe, and cleanup', () => {
    const fixture = nativeFixture();
    const sequence = [];
    let observedBuilderEnvironment;
    const result = buildWindowsPackage({
      ...fixture.injections,
      withLock: (callback) => {
        sequence.push('lock-enter');
        try {
          return callback();
        } finally {
          sequence.push('lock-exit');
        }
      },
      withPreparedElectron: (_paths, _metadata, callback) => {
        sequence.push('isolated-enter');
        try {
          return callback(fixture.electronPreparation);
        } finally {
          sequence.push('isolated-exit');
        }
      },
      prepareNativeRuntime: (args) => {
        sequence.push(`prepare-${args.mode}`);
        return fixture.preparePackage();
      },
      runBuildSteps: (_steps, builderEnvironment) => {
        sequence.push('build');
        observedBuilderEnvironment = builderEnvironment;
        fixture.writePackage();
        return [{ name: 'fake-package', kind: 'command', status: 0 }];
      },
    });

    expect(sequence).toEqual([
      'lock-enter',
      'isolated-enter',
      'build',
      'prepare-package',
      'isolated-exit',
      'lock-exit',
    ]);
    expect(observedBuilderEnvironment).toMatchObject({
      AAO_STAGED_SQLITE_BINDING: fixture.stagedSqliteBindingPath,
      AAO_STAGED_SQLITE_SHA256: fixture.electronPreparation.bindings.sqlite.sha256,
      AAO_SOURCE_DUCKDB_SHA256: fixture.sourceBefore.duckdbSha256,
      AAO_ELECTRON_MODULES_ABI: EXPECTED_ELECTRON_MODULES_ABI,
    });
    expect(result.sourceBindings).toMatchObject({
      before: fixture.sourceBefore,
      after: fixture.sourceBefore,
      unchangedExact: true,
      sourceReadOnly: true,
    });
    expect(result.package.freshCurrentRun).toBe(true);
    expect(sha256File(fixture.sourcePaths.sqliteBindingPath))
      .toBe(fixture.sourceBefore.sqliteSha256);
    expect(sha256File(fixture.sourcePaths.duckdbBindingPath))
      .toBe(fixture.sourceBefore.duckdbSha256);
  });

  it.each([
    ['build failure', 'build'],
    ['package probe failure', 'package'],
  ])('leaves source bindings unchanged after %s', (_label, failurePoint) => {
    const fixture = nativeFixture();
    expect(() => buildWindowsPackage({
      ...fixture.injections,
      withLock: (callback) => callback(),
      prepareNativeRuntime: () => {
        if (failurePoint === 'package') throw new Error('package probe failed');
        return fixture.preparePackage();
      },
      runBuildSteps: () => {
        if (failurePoint === 'build') throw new Error('builder failed');
        fixture.writePackage();
        return [];
      },
    })).toThrow(failurePoint === 'build' ? /builder failed/i : /package probe failed/i);
    expect(sha256File(fixture.sourcePaths.sqliteBindingPath))
      .toBe(fixture.sourceBefore.sqliteSha256);
    expect(sha256File(fixture.sourcePaths.duckdbBindingPath))
      .toBe(fixture.sourceBefore.duckdbSha256);
  });

  it('rejects a package whose DuckDB binding differs from the source baseline', () => {
    const fixture = nativeFixture();
    expect(() => buildWindowsPackage({
      ...fixture.injections,
      withLock: (callback) => callback(),
      prepareNativeRuntime: fixture.preparePackage,
      runBuildSteps: () => {
        fixture.writePackage();
        fs.writeFileSync(fixture.packagePaths.duckdbBindingPath, 'mutated-package-duck');
        return [];
      },
    })).toThrow(/packaged DuckDB.*baseline/i);
    expect(sha256File(fixture.sourcePaths.duckdbBindingPath))
      .toBe(fixture.sourceBefore.duckdbSha256);
  });

  it('cannot accept stale release outputs when builder reports success without replacements', () => {
    const fixture = nativeFixture();
    const staleExecutableSha256 = sha256File(fixture.packageExe);
    expect(() => buildWindowsPackage({
      ...fixture.injections,
      withLock: (callback) => callback(),
      prepareNativeRuntime: fixture.preparePackage,
      runBuildSteps: () => [],
    })).toThrow(/fresh win-unpacked|does not exist/i);
    expect(sha256File(fixture.packageExe)).toBe(staleExecutableSha256);
    expect(fs.readFileSync(fixture.packageExe, 'utf8')).toBe('stale-package-exe');
  });
});

function nativeFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'amazon-ai-ops-package-build-test-'),
  );
  tempDirectories.push(directory);
  const sourceDirectory = path.join(directory, 'source');
  const isolatedDirectory = path.join(directory, 'isolated');
  const releaseRoot = path.join(directory, 'release');
  const packageDirectory = path.join(releaseRoot, 'win-unpacked');
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.mkdirSync(isolatedDirectory, { recursive: true });
  fs.mkdirSync(packageDirectory, { recursive: true });
  const sourcePaths = {
    sqliteBindingPath: path.join(sourceDirectory, 'better_sqlite3.node'),
    duckdbBindingPath: path.join(sourceDirectory, 'duckdb.node'),
  };
  const stagedSqliteBindingPath = path.join(isolatedDirectory, 'better_sqlite3.node');
  const packagedNativeRoot = path.join(packageDirectory, 'resources', 'app', 'node_modules');
  const packagePaths = {
    sqliteBindingPath: path.join(
      packagedNativeRoot,
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    ),
    duckdbBindingPath: path.join(
      packagedNativeRoot,
      'duckdb',
      'lib',
      'binding',
      'duckdb.node',
    ),
  };
  const packageExe = path.join(packageDirectory, 'AmazonAIOpsAgent.exe');
  const packageOutputs = {
    releaseRoot,
    winUnpackedRoot: packageDirectory,
    executablePath: packageExe,
    installerPath: path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0.exe'),
    portablePath: path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0-portable.exe'),
    blockmapPath: path.join(releaseRoot, 'AmazonAIOpsAgent-1.5.0.exe.blockmap'),
  };
  fs.writeFileSync(sourcePaths.sqliteBindingPath, 'source-node-sqlite');
  fs.writeFileSync(sourcePaths.duckdbBindingPath, 'source-duck');
  fs.writeFileSync(stagedSqliteBindingPath, 'isolated-electron-sqlite');
  fs.mkdirSync(path.dirname(packagePaths.sqliteBindingPath), { recursive: true });
  fs.mkdirSync(path.dirname(packagePaths.duckdbBindingPath), { recursive: true });
  fs.writeFileSync(packageExe, 'stale-package-exe');
  fs.writeFileSync(packagePaths.sqliteBindingPath, 'stale-package-sqlite');
  fs.writeFileSync(packagePaths.duckdbBindingPath, 'stale-package-duck');
  fs.writeFileSync(packageOutputs.installerPath, 'stale-installer');
  fs.writeFileSync(packageOutputs.portablePath, 'stale-portable');
  fs.writeFileSync(packageOutputs.blockmapPath, 'stale-blockmap');
  const sourceBefore = {
    sqliteSha256: sha256File(sourcePaths.sqliteBindingPath),
    duckdbSha256: sha256File(sourcePaths.duckdbBindingPath),
  };
  const runtimeResult = (mode, sqliteBindingPath, duckdbBindingPath) => ({
    mode,
    action: mode === 'isolated-electron'
      ? 'staged-and-verified'
      : 'verified-only',
    target: {
      modulesAbi: EXPECTED_ELECTRON_MODULES_ABI,
    },
    bindings: {
      sqlite: {
        path: sqliteBindingPath,
        sha256: sha256File(sqliteBindingPath),
      },
      duckdb: {
        path: duckdbBindingPath,
        sha256: sha256File(duckdbBindingPath),
      },
    },
  });
  const electronPreparation = runtimeResult(
    'isolated-electron',
    stagedSqliteBindingPath,
    sourcePaths.duckdbBindingPath,
  );
  const preparePackage = () => runtimeResult(
    'package',
    packagePaths.sqliteBindingPath,
    packagePaths.duckdbBindingPath,
  );
  const writePackage = () => {
    fs.mkdirSync(path.dirname(packagePaths.sqliteBindingPath), { recursive: true });
    fs.mkdirSync(path.dirname(packagePaths.duckdbBindingPath), { recursive: true });
    fs.writeFileSync(packageExe, 'fresh-package-exe');
    fs.copyFileSync(stagedSqliteBindingPath, packagePaths.sqliteBindingPath);
    fs.copyFileSync(sourcePaths.duckdbBindingPath, packagePaths.duckdbBindingPath);
    fs.writeFileSync(packageOutputs.installerPath, 'fresh-installer');
    fs.writeFileSync(packageOutputs.portablePath, 'fresh-portable');
    fs.writeFileSync(packageOutputs.blockmapPath, 'fresh-blockmap');
  };
  return {
    sourcePaths,
    packagePaths,
    packageOutputs,
    packageExe,
    stagedSqliteBindingPath,
    sourceBefore,
    electronPreparation,
    preparePackage,
    writePackage,
    injections: {
      electronMetadata: { version: '28.3.3' },
      sourcePaths,
      packagePaths,
      packageOutputs,
      packageExe,
      withPreparedElectron: (_paths, _metadata, callback) => (
        callback(electronPreparation)
      ),
    },
  };
}
