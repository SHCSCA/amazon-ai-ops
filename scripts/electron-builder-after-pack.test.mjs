import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const afterPack = require('./electron-builder-after-pack.js');
const { sha256File } = require('./prepare-native-runtime.js');

const tempDirectories = [];
const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('electron-builder isolated native injection', () => {
  it('breaks a builder hardlink, injects the isolated binding, and writes a hash marker', async () => {
    const fixture = hookFixture();
    applyContractEnvironment(fixture);
    await afterPack({
      electronPlatformName: 'win32',
      appOutDir: fixture.appOutDir,
    });

    expect(fs.readFileSync(fixture.targetSqlitePath, 'utf8')).toBe('isolated-electron-sqlite');
    expect(fs.readFileSync(fixture.externalSentinelPath, 'utf8')).toBe('builder-node-sqlite');
    fs.writeFileSync(fixture.targetSqlitePath, 'independent-package-write');
    expect(fs.readFileSync(fixture.externalSentinelPath, 'utf8')).toBe('builder-node-sqlite');
    const marker = JSON.parse(fs.readFileSync(fixture.markerPath, 'utf8'));
    expect(marker).toMatchObject({
      kind: 'amazon-ai-ops-isolated-native-package',
      schemaVersion: 1,
      electronVersion: '28.3.3',
      modulesAbi: '119',
      betterSqlite3Sha256: fixture.stagedSqliteSha256.toUpperCase(),
      duckDbSha256: fixture.duckdbSha256.toUpperCase(),
    });
  });

  it('fails before injection when the DuckDB package copy differs from source baseline', async () => {
    const fixture = hookFixture();
    applyContractEnvironment(fixture);
    process.env.AAO_SOURCE_DUCKDB_SHA256 = 'F'.repeat(64);
    await expect(afterPack({
      electronPlatformName: 'win32',
      appOutDir: fixture.appOutDir,
    })).rejects.toThrow(/DuckDB.*baseline/i);
    expect(fs.readFileSync(fixture.targetSqlitePath, 'utf8')).toBe('builder-node-sqlite');
    expect(fs.existsSync(fixture.markerPath)).toBe(false);
  });

  it('requires the complete isolated package contract and ABI 119', async () => {
    const fixture = hookFixture();
    applyContractEnvironment(fixture);
    delete process.env.AAO_STAGED_SQLITE_BINDING;
    await expect(afterPack({
      electronPlatformName: 'win32',
      appOutDir: fixture.appOutDir,
    })).rejects.toThrow(/AAO_STAGED_SQLITE_BINDING/i);
    applyContractEnvironment(fixture);
    process.env.AAO_ELECTRON_MODULES_ABI = '118';
    await expect(afterPack({
      electronPlatformName: 'win32',
      appOutDir: fixture.appOutDir,
    })).rejects.toThrow(/must be 119/i);
  });
});

function hookFixture() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'amazon-ai-ops-after-pack-test-'),
  );
  tempDirectories.push(directory);
  const appOutDir = path.join(directory, 'win-unpacked');
  const appRoot = path.join(appOutDir, 'resources', 'app');
  const targetSqlitePath = path.join(
    appRoot,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  );
  const duckdbPath = path.join(
    appRoot,
    'node_modules',
    'duckdb',
    'lib',
    'binding',
    'duckdb.node',
  );
  const stagedSqlitePath = path.join(directory, 'isolated', 'better_sqlite3.node');
  const externalSentinelPath = path.join(directory, 'builder-source-sentinel.node');
  fs.mkdirSync(path.dirname(targetSqlitePath), { recursive: true });
  fs.mkdirSync(path.dirname(duckdbPath), { recursive: true });
  fs.mkdirSync(path.dirname(stagedSqlitePath), { recursive: true });
  fs.writeFileSync(stagedSqlitePath, 'isolated-electron-sqlite');
  fs.writeFileSync(externalSentinelPath, 'builder-node-sqlite');
  fs.linkSync(externalSentinelPath, targetSqlitePath);
  fs.writeFileSync(duckdbPath, 'source-duck');
  return {
    appOutDir,
    targetSqlitePath,
    stagedSqlitePath,
    externalSentinelPath,
    markerPath: path.join(appRoot, afterPack.MARKER_NAME),
    stagedSqliteSha256: sha256File(stagedSqlitePath),
    duckdbSha256: sha256File(duckdbPath),
  };
}

function applyContractEnvironment(fixture) {
  process.env.AAO_STAGED_SQLITE_BINDING = fixture.stagedSqlitePath;
  process.env.AAO_STAGED_SQLITE_SHA256 = fixture.stagedSqliteSha256;
  process.env.AAO_SOURCE_DUCKDB_SHA256 = fixture.duckdbSha256;
  process.env.AAO_ELECTRON_VERSION = '28.3.3';
  process.env.AAO_ELECTRON_MODULES_ABI = '119';
}
