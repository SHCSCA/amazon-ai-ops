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

function writeFile(filePath: string, content = 'evidence'): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function writePassingReadbackEvidence(evidenceDir: string): string {
  const evidencePath = path.join(evidenceDir, 'real-ad-execution-readback-authorized.json');
  return writeJson(evidencePath, {
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    authority: {
      recommendationId: 4,
      recommendationRevision: 3,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-18',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'batch_1',
      checkedAt: '2026-06-18T09:59:00.000Z',
    },
    realWriteApproved: true,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    },
    approval: {
      operatorConfirmed: true,
      scope: 'FT-US-US / US / B0TESTASIN / 2026-06-01~2026-06-18 / batch_1',
      confirmedAt: '2026-06-18T10:00:00.000Z',
      approverName: 'Ops Lead',
      approvalArtifactPath: writeFile(path.join(evidenceDir, 'approval.png')),
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'target',
      entityId: 'amzn-target-opaque-4',
      entityName: 'door lock',
      identityProofPath: writeFile(path.join(evidenceDir, 'target-identity.json'), '{"verified":true}'),
      actionType: 'lower_bid',
    },
    risk: {
      level: 'low',
      allowedByPolicy: true,
      rationale: 'One reversible bid decrease.',
    },
    before: {
      value: '1.20',
      capturedAt: '2026-06-18T10:01:00.000Z',
      screenshotPath: writeFile(path.join(evidenceDir, 'before.png'), 'before screenshot'),
      liveBidSourceNote: 'Read from Ads UI editable bid row.',
    },
    after: {
      value: '1.08',
      capturedAt: '2026-06-18T10:03:00.000Z',
      screenshotPath: writeFile(path.join(evidenceDir, 'after.png'), 'after screenshot'),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: '2026-06-18T10:05:00.000Z',
      actualValue: '1.08',
      evidencePath: writeFile(path.join(evidenceDir, 'readback.png'), 'readback screenshot'),
    },
    execution: {
      success: true,
      verified: true,
      executionId: 'manual-ads-ui-001',
      executedAt: '2026-06-18T10:02:00.000Z',
      channel: 'manual_ads_ui',
      performedBy: 'Operator A',
      appExecutorUsed: false,
    },
    source: {
      recommendationId: '4',
      recommendationRevision: 3,
      batchId: 'batch_1',
      sourceFiles: [writeFile(path.join(evidenceDir, 'user-search-term.xlsx'))],
      sourceRow: 410,
      currentValue: '1.20',
      recommendedValue: '1.08',
    },
  });
}

const acceptCurrentReadbackAuthority = () => ({ ok: true as const });

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
      validateAdReadbackAuthority: acceptCurrentReadbackAuthority,
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
      validateAdReadbackAuthority: acceptCurrentReadbackAuthority,
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
      validateAdReadbackAuthority: acceptCurrentReadbackAuthority,
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
      validateAdReadbackAuthority: acceptCurrentReadbackAuthority,
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
      validateAdReadbackAuthority: acceptCurrentReadbackAuthority,
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

  it('fails the readback and APP_READY gates when database authority is no longer current', () => {
    const root = tempDir();
    const evidenceDir = path.join(root, 'output', 'codex-evidence');
    const releaseDir = path.join(root, 'apps', 'desktop', 'release');
    const { portablePath, portableContent } = writeReleasePackages(releaseDir);
    writeEvidenceSet(evidenceDir);
    writePackageLaunchSmoke(evidenceDir, releaseDir, portablePath, portableContent);
    const readbackPath = writePassingReadbackEvidence(evidenceDir);
    const validated: string[] = [];

    const result = refreshFinalReadiness({
      repoRootDir: root,
      evidenceDir,
      releaseDir,
      appVersion: '1.5.0',
      adReadbackPath: readbackPath,
      validateAdReadbackAuthority: (filePath) => {
        validated.push(filePath);
        return {
          ok: false,
          message: '数据库中的已批准建议或当前范围已变化，请刷新后重新导出并校验。',
        };
      },
    });
    const finalReadiness = JSON.parse(fs.readFileSync(result.finalReadinessPath, 'utf8'));
    const readbackGate = finalReadiness.gates.find((gate: any) => gate.name === 'Real ad execution readback');

    expect(validated).toEqual([path.resolve(readbackPath)]);
    expect(readbackGate).toMatchObject({
      ok: false,
      status: 'needs_work',
      safetyFailClosed: true,
    });
    expect(readbackGate.message).toContain('数据库中的已批准建议');
    expect(finalReadiness.appReady).toBe(false);
    expect(result.appReady).toBe(false);
  });
});
