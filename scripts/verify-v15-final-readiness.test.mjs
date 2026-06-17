import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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

describe('verify v15 final readiness', () => {
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
});
