import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { refreshFinalReadiness } from './final-readiness-refresh';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'final-readiness-refresh-'));
}

function writeJson(filePath: string, value: unknown): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return filePath;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function writeReleasePackages(releaseDir: string, portableContent = 'portable'): { portablePath: string; portableContent: string } {
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), 'installer');
  const portablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  fs.writeFileSync(portablePath, portableContent);
  return { portablePath, portableContent };
}

function writePackageLaunchSmoke(
  evidenceDir: string,
  releaseDir: string,
  portablePath: string,
  portableContent: string,
): string {
  const unpackedContent = 'unpacked';
  const unpackedPath = path.join(releaseDir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
  fs.writeFileSync(unpackedPath, unpackedContent);
  return writeJson(path.join(evidenceDir, `package-launch-smoke-${Date.now()}.json`), {
    kind: 'package-launch-smoke',
    generatedAt: new Date().toISOString(),
    passed: true,
    artifacts: {
      unpacked: {
        path: unpackedPath,
        sizeBytes: Buffer.byteLength(unpackedContent),
        sha256: sha256(unpackedContent),
      },
      portable: {
        path: portablePath,
        sizeBytes: Buffer.byteLength(portableContent),
        sha256: sha256(portableContent),
      },
    },
    checks: [
      { kind: 'win-unpacked', ok: true, marker: '[App] ipc-ready' },
      { kind: 'portable', ok: true, appChildCount: 1 },
    ],
  });
}

function writeEvidenceSet(evidenceDir: string): void {
  writeJson(path.join(evidenceDir, 'desktop-live-full-8-e2e-test.json'), {
    kind: 'desktop-live-full-8-e2e',
    safety: { full8Started: true, adWriteActionsPerformed: false },
    steps: [{ label: 'full8', downloaded: 8, failed: 0 }],
    errors: [],
  });
  writeJson(path.join(evidenceDir, 'source-listing-read-detail-probe-test.json'), {
    kind: 'installed-listing-read',
    safety: { listingReadOnly: true, adWriteActionsPerformed: false },
    errors: [],
    listingRead: {
      ready: true,
      fullContentReady: true,
      listing: {
        asin: 'B0TESTASIN',
        title: 'Test listing title',
        bullets: ['bullet'],
        backendTerms: 'term',
      },
      evidence: {
        completeness: { asin: true, title: true, bullets: true, backendTerms: true },
      },
    },
  });
  writeJson(path.join(evidenceDir, 'deepseek-live-test.json'), {
    kind: 'deepseek-live',
    status: 'PASS',
    keyPresent: true,
    success: true,
    model: 'deepseek-v4-flash',
  });
  writeJson(path.join(evidenceDir, 'installed-ad-ai-explanation-test.json'), {
    kind: 'installed-ad-ai-explanation',
    status: 'PASS',
    runtimeMode: 'packaged-app',
    safety: { adWriteActionsPerformed: false, adAiExplanationOnly: true },
    ai: { keyPresent: true, status: 'PASS' },
    generation: { validAiExplainedRecommendations: 1 },
  });
  writeJson(path.join(evidenceDir, 'installed-listing-ai-draft-test.json'), {
    kind: 'installed-listing-ai-draft',
    safety: { adWriteActionsPerformed: false, full8Started: false, listingAiDraftOnly: true },
    errors: [],
    ai: { keyPresent: true, testSuccess: true, status: 'PASS' },
    listingAiDraft: {
      drafts: [{ source: 'ai', hasFallback: false, evidenceHasAiReason: true }],
    },
  });
}

describe('refreshFinalReadiness', () => {
  it('writes manifest-driven APP_NEEDS_WORK final readiness and prefers the current readback candidate', () => {
    const root = tempDir();
    const evidenceDir = path.join(root, 'output', 'codex-evidence');
    const releaseDir = path.join(root, 'apps', 'desktop', 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), 'installer');
    fs.writeFileSync(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), 'portable');
    writeEvidenceSet(evidenceDir);
    writeJson(path.join(evidenceDir, 'real-ad-execution-readback-old-pass.json'), {
      kind: 'real-ad-execution-readback',
      status: 'PASS',
    });
    writeJson(path.join(evidenceDir, 'real-ad-execution-readback-candidate-rec-4-current.json'), {
      kind: 'real-ad-execution-readback',
      status: 'NEEDS_WORK',
    });

    const result = refreshFinalReadiness({
      repoRootDir: root,
      evidenceDir,
      releaseDir,
      appVersion: '1.5.0',
    });

    expect(fs.existsSync(result.evidenceManifestPath)).toBe(true);
    expect(fs.existsSync(result.finalReadinessPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(result.evidenceManifestPath, 'utf8'));
    const finalReadiness = JSON.parse(fs.readFileSync(result.finalReadinessPath, 'utf8'));

    expect(manifest.evidence.adReadback.selectedBy).toBe('current-candidate');
    expect(manifest.evidence.adReadback.path).toContain('real-ad-execution-readback-candidate-rec-4-current.json');
    expect(finalReadiness.evidenceSelection.mode).toBe('manifest');
    expect(finalReadiness.status).toBe('APP_NEEDS_WORK');
    expect(finalReadiness.appReady).toBe(false);
    expect(finalReadiness.gates.find((gate: any) => gate.name === 'Real ad execution readback')?.ok).toBe(false);
    expect(finalReadiness.gates.find((gate: any) => gate.name === 'Release package hash')?.ok).toBe(true);
  });

  it('fails closed when package launch smoke evidence is missing', () => {
    const root = tempDir();
    const evidenceDir = path.join(root, 'output', 'codex-evidence');
    const releaseDir = path.join(root, 'apps', 'desktop', 'release');
    writeReleasePackages(releaseDir);
    writeEvidenceSet(evidenceDir);

    const result = refreshFinalReadiness({
      repoRootDir: root,
      evidenceDir,
      releaseDir,
      appVersion: '1.5.0',
    });
    const finalReadiness = JSON.parse(fs.readFileSync(result.finalReadinessPath, 'utf8'));

    expect(finalReadiness.gates.find((gate: any) => gate.id === 'package-launch-smoke')).toMatchObject({
      name: 'Package launch smoke',
      status: 'missing',
      ok: false,
    });
    expect(finalReadiness.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: 'package-launch-smoke', code: 'PACKAGE_SMOKE_MISSING' }),
    ]));
    expect(finalReadiness.packageLaunchSmoke).toMatchObject({ present: false, passed: false });
    expect(finalReadiness.appReady).toBe(false);
  });

  it('fails closed when selected package launch smoke is stale', () => {
    const root = tempDir();
    const evidenceDir = path.join(root, 'output', 'codex-evidence');
    const releaseDir = path.join(root, 'apps', 'desktop', 'release');
    const { portablePath, portableContent } = writeReleasePackages(releaseDir, 'portable-before-smoke');
    writeEvidenceSet(evidenceDir);
    const smokePath = writePackageLaunchSmoke(evidenceDir, releaseDir, portablePath, portableContent);
    fs.writeFileSync(portablePath, 'portable-changed-after-smoke');

    const result = refreshFinalReadiness({
      repoRootDir: root,
      evidenceDir,
      releaseDir,
      appVersion: '1.5.0',
    });
    const finalReadiness = JSON.parse(fs.readFileSync(result.finalReadinessPath, 'utf8'));

    expect(finalReadiness.packageLaunchSmoke).toMatchObject({
      present: true,
      evidencePath: smokePath,
      selectedBy: 'latest-evidence',
    });
    expect(finalReadiness.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: 'package-launch-smoke', code: 'PACKAGE_SMOKE_STALE' }),
    ]));
    expect(finalReadiness.gates.find((gate: any) => gate.id === 'package-launch-smoke')?.ok).toBe(false);
  });

  it('fails closed instead of throwing when package launch smoke is structurally incomplete', () => {
    const root = tempDir();
    const evidenceDir = path.join(root, 'output', 'codex-evidence');
    const releaseDir = path.join(root, 'apps', 'desktop', 'release');
    const { portablePath, portableContent } = writeReleasePackages(releaseDir);
    writeEvidenceSet(evidenceDir);
    const smokePath = writePackageLaunchSmoke(evidenceDir, releaseDir, portablePath, portableContent);
    const smoke = JSON.parse(fs.readFileSync(smokePath, 'utf8'));
    delete smoke.artifacts.portable.path;
    writeJson(smokePath, smoke);

    expect(() => refreshFinalReadiness({
      repoRootDir: root,
      evidenceDir,
      releaseDir,
      appVersion: '1.5.0',
    })).not.toThrow();

    const finalReadinessPath = fs.readdirSync(evidenceDir)
      .filter((name) => /^final-readiness-.*\.json$/i.test(name))
      .map((name) => path.join(evidenceDir, name))[0];
    const finalReadiness = JSON.parse(fs.readFileSync(finalReadinessPath, 'utf8'));
    expect(finalReadiness.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: 'package-launch-smoke', code: 'PACKAGE_SMOKE_STALE' }),
    ]));
    expect(finalReadiness.appReady).toBe(false);
  });

  it('fails closed when selected smoke portable SHA-256 differs from the current portable package', () => {
    const root = tempDir();
    const evidenceDir = path.join(root, 'output', 'codex-evidence');
    const releaseDir = path.join(root, 'apps', 'desktop', 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), 'installer');
    const smokedPortableContent = 'previous portable';
    const smokedPortablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.4.9-portable.exe');
    fs.writeFileSync(smokedPortablePath, smokedPortableContent);
    writeEvidenceSet(evidenceDir);
    writePackageLaunchSmoke(evidenceDir, releaseDir, smokedPortablePath, smokedPortableContent);
    const currentPortablePath = path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
    fs.writeFileSync(currentPortablePath, 'current portable');
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(currentPortablePath, future, future);

    const result = refreshFinalReadiness({
      repoRootDir: root,
      evidenceDir,
      releaseDir,
      appVersion: '1.5.0',
    });
    const finalReadiness = JSON.parse(fs.readFileSync(result.finalReadinessPath, 'utf8'));

    expect(finalReadiness.currentPortablePackage).toMatchObject({
      sourcePath: currentPortablePath,
      sha256: sha256('current portable'),
    });
    expect(finalReadiness.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: 'package-launch-smoke', code: 'PACKAGE_SMOKE_PORTABLE_HASH_MISMATCH' }),
    ]));
    expect(finalReadiness.gates.find((gate: any) => gate.id === 'package-launch-smoke')?.ok).toBe(false);
  });
});
