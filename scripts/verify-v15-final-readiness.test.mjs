import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import packageReadinessEvaluator from '../apps/desktop/src/main/final-readiness-package-evaluator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const { collectPackageIndex, evaluatePackageReadinessFromFiles } = packageReadinessEvaluator;

function runNode(script, args = []) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256Text(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}

function writePackageLaunchSmoke(filePath, releaseDir, portablePath, portableContent, overrides = {}) {
  const unpackedContent = 'unpacked app fixture\n';
  const unpackedPath = path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
  fs.writeFileSync(unpackedPath, unpackedContent, 'utf8');
  const smoke = {
    kind: 'package-launch-smoke',
    generatedAt: '2026-06-18T00:00:00.000Z',
    passed: true,
    artifacts: {
      unpacked: {
        path: unpackedPath,
        sizeBytes: Buffer.byteLength(unpackedContent, 'utf8'),
        sha256: sha256Text(unpackedContent),
      },
      portable: {
        path: portablePath,
        sizeBytes: Buffer.byteLength(portableContent, 'utf8'),
        sha256: sha256Text(portableContent),
      },
    },
    checks: [
      { kind: 'win-unpacked', ok: true, marker: '[App] ipc-ready' },
      { kind: 'portable', ok: true, appChildCount: 1 },
    ],
    ...overrides,
  };
  writeJson(filePath, smoke);
}

describe('verify v15 final readiness', () => {
  it('fails closed without scanning the working directory when releaseDir is omitted', () => {
    expect(() => collectPackageIndex(undefined)).not.toThrow();
    expect(collectPackageIndex(undefined)).toMatchObject({
      present: false,
      count: 0,
      existingCount: 0,
      missingCount: 0,
      releaseDir: null,
    });
  });

  it('returns a structured fail-closed package failure when releaseDir is a file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-final-readiness-release-file-'));
    const releaseFile = path.join(dir, 'release');
    fs.writeFileSync(releaseFile, 'not a directory', 'utf8');

    expect(() => evaluatePackageReadinessFromFiles({
      releaseDir: releaseFile,
      packageLaunchSmokePath: null,
    })).not.toThrow();

    const result = evaluatePackageReadinessFromFiles({
      releaseDir: releaseFile,
      packageLaunchSmokePath: null,
    });
    expect(result.packageIndex).toMatchObject({
      present: false,
      count: 0,
      releaseDir: releaseFile,
      error: {
        code: 'PACKAGE_RELEASE_DIR_NOT_DIRECTORY',
      },
    });
    expect(result.gates.find((gate) => gate.id === 'release-package-hash')).toMatchObject({
      ok: false,
      status: 'needs_work',
    });
    expect(result.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        gateId: 'release-package-hash',
        code: 'PACKAGE_RELEASE_DIR_NOT_DIRECTORY',
      }),
    ]));
  });

  it('does not pass AI live provider evidence that leaks an API key shaped secret', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-final-readiness-ai-live-secret-'));
    const manifestPath = path.join(dir, 'evidence-manifest.json');
    const aiLivePath = path.join(dir, 'deepseek-live-secret.json');
    const outPath = path.join(dir, 'final-readiness.json');

    writeJson(aiLivePath, {
      status: 'PASS',
      provider: 'openai-compatible',
      model: 'deepseek-v4-flash',
      keyPresent: true,
      success: true,
      usage: { totalTokens: 12 },
      responseSample: 'ok',
      debugHeaders: {
        authorization: 'Bearer sk-1234567890abcdef1234567890abcdef',
      },
    });
    writeJson(manifestPath, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        aiLive: { exists: true, absolutePath: aiLivePath },
      },
    });

    const result = runNode('scripts/verify-v15-final-readiness.js', [
      '--evidence-manifest', manifestPath,
      '--out', outPath,
    ]);

    expect(result.status).not.toBe(0);
    const summary = readJson(outPath);
    const aiGate = summary.gates.find((gate) => gate.name === 'AI live provider');
    expect(aiGate).toMatchObject({
      ok: false,
      status: 'needs_work',
    });
    expect(aiGate.message).toContain('possible secret');
  });

  it('fails the release package hash gate when final readiness has no installer evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-final-readiness-no-release-'));
    const manifestPath = path.join(dir, 'evidence-manifest.json');
    const outPath = path.join(dir, 'final-readiness.json');

    writeJson(manifestPath, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {},
    });

    const result = runNode('scripts/verify-v15-final-readiness.js', [
      '--evidence-manifest', manifestPath,
      '--release-dir', path.join(dir, 'missing-release'),
      '--out', outPath,
    ]);

    expect(result.status).not.toBe(0);
    const summary = readJson(outPath);
    const packageGate = summary.gates.find((gate) => gate.name === 'Release package hash');
    expect(packageGate).toMatchObject({
      ok: false,
      status: 'missing',
    });
    expect(packageGate.message).toContain('installer/package hash evidence is missing');
    expect(summary.packageIndex).toMatchObject({
      present: false,
      count: 0,
    });
  });

  it('passes the release package hash gate when installer and portable exe hashes are available', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-final-readiness-release-'));
    const manifestPath = path.join(dir, 'evidence-manifest.json');
    const releaseDir = path.join(dir, 'release');
    const outPath = path.join(dir, 'final-readiness.json');
    const installerContent = 'installer verifier fixture\n';
    const portableContent = 'portable verifier fixture\n';
    const installerPath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe');
    const portablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(installerPath, installerContent, 'utf8');
    fs.writeFileSync(portablePath, portableContent, 'utf8');

    writeJson(manifestPath, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {},
    });

    const result = runNode('scripts/verify-v15-final-readiness.js', [
      '--evidence-manifest', manifestPath,
      '--release-dir', releaseDir,
      '--out', outPath,
    ]);

    expect(result.status).not.toBe(0);
    const summary = readJson(outPath);
    const packageGate = summary.gates.find((gate) => gate.name === 'Release package hash');
    expect(packageGate).toMatchObject({
      ok: true,
      status: 'passed',
    });
    expect(summary.packageIndex).toMatchObject({
      present: true,
      count: 2,
      existingCount: 2,
      missingCount: 0,
    });
    expect(summary.packageIndex.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'installer',
        sourcePath: installerPath,
        sha256: sha256Text(installerContent),
      }),
      expect.objectContaining({
        kind: 'portable',
        sourcePath: portablePath,
        sha256: sha256Text(portableContent),
      }),
    ]));
  });

  it('fails the release package hash gate when the portable no-install exe is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-final-readiness-release-no-portable-'));
    const manifestPath = path.join(dir, 'evidence-manifest.json');
    const releaseDir = path.join(dir, 'release');
    const outPath = path.join(dir, 'final-readiness.json');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), 'installer only\n', 'utf8');

    writeJson(manifestPath, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {},
    });

    const result = runNode('scripts/verify-v15-final-readiness.js', [
      '--evidence-manifest', manifestPath,
      '--release-dir', releaseDir,
      '--out', outPath,
    ]);

    expect(result.status).not.toBe(0);
    const summary = readJson(outPath);
    const packageGate = summary.gates.find((gate) => gate.name === 'Release package hash');
    expect(packageGate).toMatchObject({
      ok: false,
      status: 'needs_work',
    });
    expect(packageGate.message).toContain('portable no-install package hash evidence is missing');
  });

  it('passes package launch smoke when it matches the current portable package hash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-final-readiness-package-launch-'));
    const manifestPath = path.join(dir, 'evidence-manifest.json');
    const releaseDir = path.join(dir, 'release');
    const outPath = path.join(dir, 'final-readiness.json');
    const smokePath = path.join(dir, 'package-launch-smoke.json');
    const installerContent = 'installer verifier fixture\n';
    const portableContent = 'portable verifier fixture\n';
    const installerPath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe');
    const portablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(installerPath, installerContent, 'utf8');
    fs.writeFileSync(portablePath, portableContent, 'utf8');
    writePackageLaunchSmoke(smokePath, releaseDir, portablePath, portableContent);
    writeJson(manifestPath, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {},
    });

    const result = runNode('scripts/verify-v15-final-readiness.js', [
      '--evidence-manifest', manifestPath,
      '--release-dir', releaseDir,
      '--package-launch-smoke', smokePath,
      '--out', outPath,
    ]);

    expect(result.status).not.toBe(0);
    const summary = readJson(outPath);
    const launchGate = summary.gates.find((gate) => gate.name === 'Package launch smoke');
    expect(launchGate).toMatchObject({
      id: 'package-launch-smoke',
      ok: true,
      status: 'passed',
    });
    expect(summary.packageLaunchSmoke).toMatchObject({
      present: true,
      passed: true,
      evidencePath: smokePath,
    });
  });

  it('fails package launch smoke when it does not match the current portable package hash', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-final-readiness-stale-package-launch-'));
    const manifestPath = path.join(dir, 'evidence-manifest.json');
    const releaseDir = path.join(dir, 'release');
    const outPath = path.join(dir, 'final-readiness.json');
    const smokePath = path.join(dir, 'package-launch-smoke.json');
    const installerContent = 'installer verifier fixture\n';
    const portableContent = 'portable verifier fixture\n';
    const installerPath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe');
    const portablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(installerPath, installerContent, 'utf8');
    fs.writeFileSync(portablePath, portableContent, 'utf8');
    writePackageLaunchSmoke(smokePath, releaseDir, portablePath, 'stale portable fixture\n');
    writeJson(manifestPath, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {},
    });

    const result = runNode('scripts/verify-v15-final-readiness.js', [
      '--evidence-manifest', manifestPath,
      '--release-dir', releaseDir,
      '--package-launch-smoke', smokePath,
      '--out', outPath,
    ]);

    expect(result.status).not.toBe(0);
    const summary = readJson(outPath);
    const launchGate = summary.gates.find((gate) => gate.name === 'Package launch smoke');
    expect(launchGate).toMatchObject({
      ok: false,
      status: 'needs_work',
    });
    expect(launchGate.message).toContain('stale');
  });
});
