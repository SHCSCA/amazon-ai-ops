import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import registry from './package-ui-module-registry.js';
import evidence from './package-ui-evidence.js';
import sourceIdentity from './package-ui-source-identity.js';

const require = createRequire(import.meta.url);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
const artifact = (filePath) => {
  const bytes = fs.readFileSync(filePath);
  return { sha256: sha256(bytes), sizeBytes: bytes.length };
};

describe('package UI composed runner source contract', () => {
  it('keeps the public schema and compatibility exports while registering unique bounded responsibilities', () => {
    expect(evidence.PACKAGE_UI_EVIDENCE_SCHEMA_VERSION).toBe(9);
    expect(Object.keys(evidence)).toHaveLength(134);
    expect(new Set(registry.moduleNames).size).toBe(registry.moduleNames.length);
    expect(Object.isFrozen(registry.moduleNames)).toBe(true);
    expect(Object.isFrozen(registry.runnerSourcePaths)).toBe(true);
    for (const sourcePath of registry.runnerSourcePaths) {
      expect(fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/).length).toBeLessThanOrEqual(999);
      expect(path.basename(sourcePath)).not.toMatch(/(?:part|chunk)[-_]?\d/i);
    }
    expect(registry.runnerSourcePaths).toContain(require.resolve('./package-ui-evidence.js'));
    expect(registry.runnerSourcePaths).toContain(require.resolve('./package-ui-module-registry.js'));
    expect(registry.runnerSourcePaths).toContain(require.resolve('./package-ui-source-identity.js'));
    expect(registry.runnerSourcePaths).toContain(require.resolve('./package-ui-contracts.js'));
    expect(registry.runnerSourcePaths).toContain(require.resolve('./package-ui-profile-lock-probe.js'));
    for (const moduleName of registry.moduleNames) {
      expect(registry.runnerSourcePaths).toContain(require.resolve(moduleName));
    }
  });

  it('exposes workspace navigation through the actual public runner barrel', () => {
    expect(typeof evidence.navigateToWorkspace).toBe('function');
  });

  it('exposes workspace tab keyboard exercise through the actual public runner barrel', () => {
    expect(typeof evidence.exerciseWorkspaceTabKeyboard).toBe('function');
  });

  it('exposes every original responsibility function through exactly one injected module', () => {
    const names = new Set();
    const placeholder = new Proxy({}, { get: () => () => undefined });
    for (const moduleName of registry.moduleNames) {
      const factory = require(moduleName);
      expect(typeof factory).toBe('function');
      const module = factory(placeholder);
      for (const [name, value] of Object.entries(module)) {
        expect(typeof value).toBe('function');
        expect(names.has(name)).toBe(false);
        names.add(name);
      }
    }
    expect(names.size).toBe(222);
  });

  it('binds the current bytes and sizes of all runner sources to the existing evidenceScript record', () => {
    const records = registry.runnerSourcePaths.map((filePath) => ({
      name: path.basename(filePath),
      ...artifact(filePath),
    })).sort((left, right) => left.name.localeCompare(right.name));
    const expected = {
      sha256: sha256(Buffer.from(JSON.stringify(records))),
      sizeBytes: records.reduce((total, record) => total + record.sizeBytes, 0),
    };
    expect(sourceIdentity.collectPackageUiRunnerSourceBinding(artifact)).toEqual(expected);
    expect(evidence.buildPackageUiRunnerContract().evidenceScript).toEqual(expected);
    expect(expected.sha256).not.toBe(artifact(require.resolve('./package-ui-evidence.js')).sha256);
  });

  it('changes runner identity when any responsibility changes, while remaining independent of input enumeration order', () => {
    const paths = ['/owned/package-ui-identity.js', '/owned/package-ui-cleanup.js'];
    const baseline = new Map(paths.map((filePath, index) => [filePath, {
      sha256: (index === 0 ? 'A' : 'B').repeat(64), sizeBytes: 100 + index,
    }]));
    const read = (filePath) => baseline.get(filePath);
    const before = sourceIdentity.collectPackageUiRunnerSourceBinding(read, paths);
    expect(sourceIdentity.collectPackageUiRunnerSourceBinding(read, [...paths].reverse())).toEqual(before);
    for (const filePath of paths) {
      const original = baseline.get(filePath);
      baseline.set(filePath, { ...original, sha256: 'C'.repeat(64) });
      expect(sourceIdentity.collectPackageUiRunnerSourceBinding(read, paths).sha256).not.toBe(before.sha256);
      baseline.set(filePath, { ...original, sizeBytes: original.sizeBytes + 1 });
      expect(sourceIdentity.collectPackageUiRunnerSourceBinding(read, paths).sha256).not.toBe(before.sha256);
      baseline.set(filePath, original);
    }
  });

  it.each([
    ['empty sources', [], () => ({ sha256: 'A'.repeat(64), sizeBytes: 1 })],
    ['duplicate source name', ['/a/module.js', '/b/module.js'], () => ({ sha256: 'A'.repeat(64), sizeBytes: 1 })],
    ['invalid hash', ['/owned/module.js'], () => ({ sha256: 'bad', sizeBytes: 1 })],
    ['invalid size', ['/owned/module.js'], () => ({ sha256: 'A'.repeat(64), sizeBytes: 0 })],
  ])('fails closed for %s', (_label, paths, readArtifact) => {
    expect(() => sourceIdentity.collectPackageUiRunnerSourceBinding(readArtifact, paths)).toThrow(/源码身份记录无效/);
  });
});


it('binds the real same-attempt native, reader, PowerShell and plugin sources without adding factory or public exports', () => {
  const basenames = registry.runnerSourcePaths.map(source => path.basename(source).toLowerCase());
  expect(new Set(basenames).size).toBe(basenames.length);
  for (const name of ['package-ui-native-launch.js', 'package-ui-native-reader.js', 'package-ui-native-evidence.js',
    'v16-performance-process-binding.js', 'v16-performance-main-exit.js', 'v16-performance-main-exit.ps1',
    'v16-ui-software-screen-reader.js', 'v16-nvda-provider-binding.js', 'v16-nvda-speech-observer.py']) {
    expect(basenames).toContain(name);
  }
  expect(evidence.buildPackageUiRunnerContract().semanticContractSha256).toMatch(/^[A-F0-9]{64}$/);
  expect(Object.keys(evidence)).toHaveLength(134);
});

it('binds every actual owned-caption source without extending the public factory surface', () => {
  for (const name of ["v16-ui-owned-caption-contract.js","v16-ui-owned-caption-artifacts.js","v16-ui-owned-caption-window.js","v16-ui-owned-caption-native.cs","v16-ui-owned-caption.ps1","v16-ui-owned-caption-child.js","v16-ui-owned-caption.js"]) {
    expect(registry.runnerSourcePaths.map(file => path.basename(file))).toContain(name);
  }
  expect(Object.keys(evidence)).toHaveLength(134);
});


it('binds the actually imported native focus metadata helper while preserving the original 97 runner sources', () => {
  const reader = fs.readFileSync(require.resolve('./v16-ui-software-screen-reader.js'), 'utf8');
  const focus = require.resolve('./v16-ui-nvda-focus-phase.js');
  expect(reader).toContain("require('./v16-ui-nvda-focus-phase')");
  expect(registry.runnerSourcePaths.filter(file => file === focus)).toHaveLength(1);
  expect(registry.runnerSourcePaths).toHaveLength(113);
  expect(registry.runnerSourcePaths.filter(file => file === require.resolve('./v16-nvda-native-keys-contract.js'))).toHaveLength(1);
  expect(registry.runnerSourcePaths.filter(file => file === require.resolve('./v16-ui-nvda-native-keys.js'))).toHaveLength(1);
  expect(reader).toContain("require('./v16-ui-nvda-native-keys')");
  expect(registry.runnerSourcePaths.filter(file => file === require.resolve('./v16-ui-nvda-dom-focus.js'))).toHaveLength(1);
  for (const helper of ['v16-ui-ax-identity.js', 'v16-ui-accessible-node.js', 'v16-ui-reader-target-setup.js']) {
    expect(registry.runnerSourcePaths.filter(file => file === require.resolve('./' + helper))).toHaveLength(1);
  }
  expect(Object.keys(evidence)).toHaveLength(134);
});

it.each(['v16-ui-owned-accessibility.js', 'v16-ui-nvda-speech-bracket.js'])(
  'binds current bytes and sizes of %s into evidenceScript independently of test ports', (helper) => {
    const helperPath = require.resolve('./' + helper);
    const bytes = new Map([...new Set([...registry.runnerSourcePaths, helperPath])]
      .map(file => [file, fs.readFileSync(file)]));
    const read = file => ({ sha256: sha256(bytes.get(file)), sizeBytes: bytes.get(file).length });
    const before = sourceIdentity.collectPackageUiRunnerSourceBinding(read);
    expect(evidence.buildPackageUiRunnerContract().evidenceScript).toEqual(before);
    const original = bytes.get(helperPath), changed = Buffer.from(original);
    changed[0] ^= 1; bytes.set(helperPath, changed);
    const changedBytes = sourceIdentity.collectPackageUiRunnerSourceBinding(read);
    expect(changedBytes.sha256).not.toBe(before.sha256);
    expect(changedBytes.sizeBytes).toBe(before.sizeBytes);
    bytes.set(helperPath, Buffer.concat([original, Buffer.from('\n')]));
    const changedSize = sourceIdentity.collectPackageUiRunnerSourceBinding(read);
    expect(changedSize.sha256).not.toBe(before.sha256);
    expect(changedSize.sizeBytes).toBe(before.sizeBytes + 1);
    bytes.set(helperPath, original);
    expect(sourceIdentity.collectPackageUiRunnerSourceBinding(read)).toEqual(before);
    expect(registry.runnerSourcePaths.filter(file => file === helperPath)).toHaveLength(1);
    expect(registry.runnerSourcePaths.some(file => /(?:test[-_]port|\.test\.|\.spec\.)/i.test(path.basename(file)))).toBe(false);
  });
