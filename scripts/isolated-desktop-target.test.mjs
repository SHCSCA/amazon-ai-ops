import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveIsolatedDesktopTarget } from './isolated-desktop-target.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!path.basename(root).startsWith('amazon-ai-ops-target-test-')) throw new Error('测试目录不匹配。');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-target-test-'));
  roots.push(root);
  for (const name of ['AmazonAIOpsAgent.exe', 'resources/app/dist/main/index.js',
    'resources/app/dist/preload/index.cjs', 'resources/app/dist/renderer/index.html']) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'test-only');
  }
  return { root, executable: path.join(root, 'AmazonAIOpsAgent.exe') };
}

describe('isolated desktop target', () => {
  it.each(['directory', 'installed', 'folder-zip'])('binds %s to its actual executable and bundled application', (kind) => {
    const input = fixture();
    const result = resolveIsolatedDesktopTarget(['--app-executable', input.executable, '--delivery-kind', kind], input.root);
    expect(result).toEqual({ deliveryKind: kind, packaged: true, executablePath: input.executable,
      launchArguments: [], bundleRoot: path.join(input.root, 'resources/app/dist') });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.launchArguments)).toBe(true);
  });

  it.each([
    ['--unknown'], ['--app-executable'], ['--delivery-kind', 'installed'],
    ['--app-executable', 'app.exe', '--delivery-kind', 'portable'],
    ['--delivery-kind', 'directory', '--delivery-kind', 'installed'],
    ['--app-executable', '  app.exe'],
  ])('rejects malformed target arguments %j', (...args) => {
    expect(() => resolveIsolatedDesktopTarget(args, process.cwd())).toThrow();
  });

  it('rejects an executable without the actual runtime preload', () => {
    const input = fixture();
    fs.unlinkSync(path.join(input.root, 'resources/app/dist/preload/index.cjs'));
    expect(() => resolveIsolatedDesktopTarget(['--app-executable', input.executable], input.root)).toThrow();
  });

  it('accepts an explicit direct work package only when bound to a real packaged target', () => {
    const input = fixture(); const work = path.join(input.root, 'work'); fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, 'manifest.json'), '{}');
    const args = ['--app-executable', input.executable, '--acceptance-work-package', work];
    expect(resolveIsolatedDesktopTarget(args, input.root).acceptanceWorkPackagePath).toBe(work);
    expect(() => resolveIsolatedDesktopTarget(['--acceptance-work-package', work], input.root)).toThrow('EXE');
    fs.unlinkSync(path.join(work, 'manifest.json')); expect(() => resolveIsolatedDesktopTarget(args, input.root)).toThrow();
  });

  it('rejects a linked work package without weakening the existing executable contract', () => {
    const input = fixture(); const work = path.join(input.root, 'work'); fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, 'manifest.json'), '{}');
    const linked = path.join(input.root, 'linked'); fs.symlinkSync(work, linked, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => resolveIsolatedDesktopTarget(['--app-executable', input.executable, '--acceptance-work-package', linked], input.root)).toThrow();
  });

  it('rejects hard-linked executable or runtime source bytes', () => {
    const first = fixture(); fs.linkSync(first.executable, path.join(first.root, 'alias.exe'));
    expect(() => resolveIsolatedDesktopTarget(['--app-executable', first.executable], first.root)).toThrow();
    const second = fixture(); fs.linkSync(path.join(second.root, 'resources/app/dist/main/index.js'), path.join(second.root, 'index-alias.js'));
    expect(() => resolveIsolatedDesktopTarget(['--app-executable', second.executable], second.root)).toThrow();
  });

  it('separates the portable launcher from the current directory runtime baseline', () => {
    const input = fixture();
    const desktop = path.join(input.root, 'apps/desktop');
    const release = path.join(desktop, 'release/win-unpacked');
    fs.mkdirSync(release, { recursive: true });
    fs.writeFileSync(path.join(desktop, 'package.json'), JSON.stringify({ version: '1.6.0' }));
    fs.cpSync(path.join(input.root, 'resources'), path.join(release, 'resources'), { recursive: true });
    fs.copyFileSync(input.executable, path.join(release, 'AmazonAIOpsAgent.exe'));
    const launcher = path.join(input.root, 'AmazonAIOpsAgent-1.6.0-portable.exe');
    fs.writeFileSync(launcher, 'test-only-launcher');
    const target = resolveIsolatedDesktopTarget(['--app-executable', launcher, '--delivery-kind', 'portable'], input.root);
    expect(target.executablePath).toBe(launcher);
    expect(target.coreExecutablePath).toBe(path.join(release, 'AmazonAIOpsAgent.exe'));
    expect(target.bundleRoot).toBe(path.join(release, 'resources/app/dist'));
    fs.unlinkSync(target.coreExecutablePath);
    expect(() => resolveIsolatedDesktopTarget(['--app-executable', launcher, '--delivery-kind', 'portable'], input.root)).toThrow();
  });
});

import { createIsolatedRuntimeStorage, normalizeRuntimeDrive } from './isolated-desktop-target.mjs';

const storageRunId = '2026-10-22T10-00-00-000Z';

describe('isolated runtime storage configuration', () => {
  it('keeps the repository drive by default and freezes shared-policy owned paths', () => {
    const storage = createIsolatedRuntimeStorage({}, 'G:\\AI\\repo', storageRunId);
    expect(storage).toEqual({ driveRoot: 'G:\\', evidenceRoot: 'G:\\Temp', runId: storageRunId,
      profile: `G:\\Temp\\amazon-ai-ops-runtime-validation\\${storageRunId}`,
      portableRoot: `G:\\Temp\\amazon-ai-ops-portable-runtime\\${storageRunId}` });
    expect(Object.isFrozen(storage)).toBe(true);
    expect(() => { storage.driveRoot = 'F:\\'; }).toThrow();
  });

  it('honors the explicit normalized CLI drive in the real storage consumer', () => {
    const input = fixture();
    const target = resolveIsolatedDesktopTarget(['--app-executable', input.executable,
      '--delivery-kind', 'directory', '--runtime-drive', 'f:\\'], input.root);
    expect(target.runtimeDrive).toBe('F:\\');
    const storage = createIsolatedRuntimeStorage(target, 'G:\\AI\\repo', storageRunId);
    expect(storage.driveRoot).toBe('F:\\');
    expect(storage.profile).toBe(`F:\\Temp\\amazon-ai-ops-runtime-validation\\${storageRunId}`);
    expect(storage.portableRoot).toBe(`F:\\Temp\\amazon-ai-ops-portable-runtime\\${storageRunId}`);
    expect(Object.isFrozen(storage)).toBe(true);
  });

  it('rejects nonlocal or nonroot drive values instead of normalizing unsafe input', () => {
    expect(normalizeRuntimeDrive('f:\\')).toBe('F:\\');
    for (const value of ['', 'F:', 'F:/', 'F:\\Temp', 'F:\\..\\', 'F:\\:stream', '\\\\server\\share\\',
      '\\\\?\\F:\\', 'relative', ' F:\\', 'F:\\ ', null, 7]) {
      expect(() => normalizeRuntimeDrive(value), String(value)).toThrow();
    }
  });

  it('keeps exact argument validation for duplicate missing unknown and invalid drive options', () => {
    const input = fixture(), base = ['--app-executable', input.executable];
    for (const tail of [['--runtime-drive'], ['--runtime-drive', 'F:\\', '--runtime-drive', 'G:\\'],
      ['--runtime-driver', 'F:\\'], ['--runtime-drive', '\\\\server\\share\\'], ['--runtime-drive', 'F:\\Temp']]) {
      expect(() => resolveIsolatedDesktopTarget([...base, ...tail], input.root), JSON.stringify(tail)).toThrow();
    }
    expect(resolveIsolatedDesktopTarget(base, input.root)).not.toHaveProperty('runtimeDrive');
  });

  it('rejects traversal ADS or empty run identities through the shared evidence path policy', () => {
    for (const runId of ['', '.', '..', '../foreign', '..\\foreign', 'F:\\foreign', 'bad:stream', 'bad\0name', ' spaced ']) {
      expect(() => createIsolatedRuntimeStorage({}, 'G:\\AI\\repo', runId), JSON.stringify(runId)).toThrow();
    }
  });

  it('does not take storage selection from TEMP TMP or the ambient userData override', () => {
    const names = ['TEMP', 'TMP', 'AMAZON_AI_OPS_USER_DATA_DIR'];
    const saved = names.map(name => [name, process.env[name]]);
    try {
      for (const name of names) process.env[name] = 'Z:\\outside-trusted-runtime';
      const storage = createIsolatedRuntimeStorage({}, 'G:\\AI\\repo', storageRunId);
      expect(storage.driveRoot).toBe('G:\\');
      expect(storage.profile).toBe(`G:\\Temp\\amazon-ai-ops-runtime-validation\\${storageRunId}`);
    } finally {
      for (const [name, value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  });
});
