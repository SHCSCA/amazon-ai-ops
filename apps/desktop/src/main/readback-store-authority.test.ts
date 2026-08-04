import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { describe, expect, it } from 'vitest';
import { saveReadbackCaptureFile, type ReadbackCaptureSlot } from './ad-readback-capture';
import {
  fillAdReadbackSession,
  prepareAdReadbackSession,
  verifyAdReadbackSession,
} from './ad-readback-session';
import {
  assertPathInsideStoreCapsule,
  assertReadbackStoreBinding,
  assertStoreScopedReadbackEvidenceData,
  createStoreScopedReadbackAccess,
  ensureStoreScopedReadbackDirectories,
  resolveStoreScopedReadbackReference,
} from './readback-store-authority';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'readback-store-authority-'));
}

function context(storeId: string, profileId: string, sessionGeneration = 1): StoreContextEnvelope {
  return {
    storeId,
    browserProfileId: profileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-08-04',
    sessionGeneration,
  } as StoreContextEnvelope;
}

function setupAccess(root: string, storeId: string, profileId: string, generation = 1) {
  const capsule = ensureStoreCapsulePaths(deriveStoreCapsulePaths(root, storeId, profileId));
  const access = createStoreScopedReadbackAccess(context(storeId, profileId, generation), capsule);
  ensureStoreScopedReadbackDirectories(access);
  return access;
}

function writeCandidate(access: ReturnType<typeof setupAccess>): string {
  const reportPath = path.join(access.capsule.reportsDir, 'source-user-search-term.xlsx');
  const identityProofPath = path.join(access.capsule.evidenceDir, 'target-identity-proof.json');
  fs.writeFileSync(reportPath, 'store-scoped report');
  fs.writeFileSync(identityProofPath, '{"verified":true}\n', 'utf8');
  const candidatePath = path.join(access.candidatesDir, 'candidate.json');
  fs.writeFileSync(candidatePath, `${JSON.stringify({
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'NEEDS_WORK',
    storeBinding: { ...access.binding },
    authority: {
      recommendationId: 4,
      recommendationRevision: 3,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-08-04',
      dateTo: '2026-08-04',
      storeName: 'Store A',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'batch_1',
      checkedAt: '2026-08-04T09:59:00.000Z',
    },
    target: {
      storeName: 'Store A',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      campaignName: 'D6 campaign',
      adGroupName: 'D6 ad group',
      entityType: 'keyword',
      entityId: 'target-id-4',
      entityName: 'door lock',
      identityProofPath,
      actionType: 'lower_bid',
    },
    source: {
      recommendationId: '4',
      recommendationRevision: 3,
      batchId: 'batch_1',
      metricDate: '2026-08-04',
      currentValue: '1.20',
      recommendedValue: '1.08',
      sourceRow: 12,
      sourceFiles: [reportPath],
    },
    risk: { rationale: 'A bounded bid reduction.' },
  }, null, 2)}\n`, 'utf8');
  return candidatePath;
}

function imageDataUrl(label: string): string {
  return `data:image/png;base64,${Buffer.from(`image-${label}`).toString('base64')}`;
}

describe('store-scoped ad readback authority', () => {
  it('accepts current-store references but rejects traversal and cross-store absolute paths', () => {
    const root = tempDir();
    const accessA = setupAccess(root, 'store-a', 'profile-a');
    const accessB = setupAccess(root, 'store-b', 'profile-b');
    const candidateA = writeCandidate(accessA);

    expect(resolveStoreScopedReadbackReference(accessA, candidateA, 'candidates')).toBe(candidateA);
    expect(resolveStoreScopedReadbackReference(accessA, 'candidate.json', 'candidates')).toBe(candidateA);
    expect(() => resolveStoreScopedReadbackReference(accessA, '..\\store-b\\candidate.json', 'candidates'))
      .toThrow(/TRAVERSAL|OUTSIDE/);
    expect(() => resolveStoreScopedReadbackReference(accessB, candidateA, 'candidates'))
      .toThrow(/TRAVERSAL|OUTSIDE/);
  });

  it('rejects stale generation and another store before session verification can inspect their artifacts', () => {
    const root = tempDir();
    const accessA = setupAccess(root, 'store-a', 'profile-a', 1);
    const accessB = setupAccess(root, 'store-b', 'profile-b', 1);
    const staleA = createStoreScopedReadbackAccess(
      context('store-a', 'profile-a', 2),
      accessA.capsule,
    );
    const candidateA = writeCandidate(accessA);
    const session = prepareAdReadbackSession({ sourcePath: candidateA, storeAccess: accessA });

    expect(verifyAdReadbackSession(session.sessionDir, accessA).ready).toBe(true);
    expect(() => verifyAdReadbackSession(session.sessionDir, staleA)).toThrow(/BINDING_MISMATCH/);
    expect(() => verifyAdReadbackSession(session.sessionDir, accessB)).toThrow(/TRAVERSAL|OUTSIDE/);
    expect(() => assertReadbackStoreBinding(accessA.binding, staleA)).toThrow(/BINDING_MISMATCH/);
  });

  it('returns structured not-ready results for a missing or corrupt current-store session', () => {
    const root = tempDir();
    const accessA = setupAccess(root, 'store-a', 'profile-a');

    const missing = verifyAdReadbackSession('missing-session', accessA);
    expect(missing).toMatchObject({ ready: false, captureReady: false });
    expect(missing.issues.join('\n')).toContain('session folder exists');

    const candidateA = writeCandidate(accessA);
    const session = prepareAdReadbackSession({ sourcePath: candidateA, storeAccess: accessA });
    fs.writeFileSync(path.join(session.sessionDir, 'session-paths.json'), '{not-json', 'utf8');
    const corrupt = verifyAdReadbackSession(session.sessionDir, accessA);
    expect(corrupt).toMatchObject({ ready: false, captureReady: false });
    expect(corrupt.issues.join('\n')).toContain('session-paths.json is readable JSON');

    fs.writeFileSync(path.join(session.sessionDir, 'session-paths.json'), '{}\n', 'utf8');
    const incompleteManifest = verifyAdReadbackSession(session.sessionDir, accessA);
    expect(incompleteManifest.ready).toBe(false);
    expect(incompleteManifest.issues.join('\n')).toContain('READBACK_SESSION_MANIFEST_INVALID');
  });

  it('returns structured not-ready results when the current session input is corrupt', () => {
    const root = tempDir();
    const accessA = setupAccess(root, 'store-a', 'profile-a');
    const candidateA = writeCandidate(accessA);
    const session = prepareAdReadbackSession({ sourcePath: candidateA, storeAccess: accessA });
    fs.writeFileSync(session.sessionInputPath, '{not-json', 'utf8');

    const verification = verifyAdReadbackSession(session.sessionDir, accessA);
    expect(verification).toMatchObject({ ready: false, captureReady: false });
    expect(verification.issues.join('\n')).toContain('session-input.json 不是可读取 JSON');

    const filled = fillAdReadbackSession(session.sessionDir, accessA);
    expect(filled).toMatchObject({ status: 'NEEDS_WORK', readyForVerifier: false });
    expect(filled.issues.join('\n')).toContain('session-input.json 不是可读取 JSON');
  });

  it('rejects verifier-consumed trace and legacy readback screenshot paths outside the capsule', () => {
    const root = tempDir();
    const accessA = setupAccess(root, 'store-a', 'profile-a');
    const outsideTrace = path.join(root, 'outside-trace.zip');
    const outsideScreenshot = path.join(root, 'outside-readback.png');
    fs.writeFileSync(outsideTrace, 'trace');
    fs.writeFileSync(outsideScreenshot, 'screenshot');
    const baseEvidence = { storeBinding: { ...accessA.binding } };

    expect(() => assertStoreScopedReadbackEvidenceData(
      { ...baseEvidence, tracePath: outsideTrace },
      accessA,
      { requireBinding: true },
    )).toThrow(/STORE_ARTIFACT_PATH_MISMATCH|OUTSIDE/);
    expect(() => assertStoreScopedReadbackEvidenceData(
      { ...baseEvidence, readback: { screenshotPath: outsideScreenshot } },
      accessA,
      { requireBinding: true },
    )).toThrow(/TRAVERSAL|OUTSIDE/);
  });

  it('keeps capture and fill writes inside the current store session', () => {
    const root = tempDir();
    const accessA = setupAccess(root, 'store-a', 'profile-a');
    const accessB = setupAccess(root, 'store-b', 'profile-b');
    const candidateA = writeCandidate(accessA);
    const session = prepareAdReadbackSession({ sourcePath: candidateA, storeAccess: accessA });
    const capturedAt: Record<ReadbackCaptureSlot, string> = {
      approval: '2026-08-04T10:00:00.000Z',
      before: '2026-08-04T10:01:00.000Z',
      after: '2026-08-04T10:03:00.000Z',
      readback: '2026-08-04T10:05:00.000Z',
    };

    for (const slot of Object.keys(capturedAt) as ReadbackCaptureSlot[]) {
      const saved = saveReadbackCaptureFile({
        slot,
        dataUrl: imageDataUrl(slot),
        sessionDir: session.sessionDir,
        fallbackRootDir: path.join(root, 'renderer-controlled-fallback'),
        storeAccess: accessA,
        now: new Date(capturedAt[slot]),
      });
      expect(saved.filePath.startsWith(session.sessionDir)).toBe(true);
    }

    expect(() => saveReadbackCaptureFile({
      slot: 'before',
      dataUrl: imageDataUrl('cross-store'),
      sessionDir: session.sessionDir,
      fallbackRootDir: root,
      storeAccess: accessB,
    })).toThrow(/TRAVERSAL|OUTSIDE/);

    const input = JSON.parse(fs.readFileSync(session.sessionInputPath, 'utf8'));
    Object.assign(input, {
      approverName: 'Ops Lead',
      beforeValue: '1.20',
      liveBidSourceNote: 'Read from the visible Ads UI row.',
      afterValue: '1.08',
      executedAt: '2026-08-04T10:02:00.000Z',
      executedBy: 'Operator A',
      executionId: 'manual-action-001',
      readbackActualValue: '1.08',
      riskRationale: 'Lowering one target bid is bounded and reversible.',
    });
    fs.writeFileSync(session.sessionInputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');

    const filled = fillAdReadbackSession(session.sessionDir, accessA);
    expect(filled.readyForVerifier).toBe(true);
    expect(filled.jsonPath.startsWith(session.sessionDir)).toBe(true);
    const evidence = JSON.parse(fs.readFileSync(filled.jsonPath, 'utf8'));
    expect(evidence.storeBinding).toEqual(accessA.binding);
  });

  it('rejects capsule artifacts and session directories that traverse junctions', () => {
    const root = tempDir();
    const accessA = setupAccess(root, 'store-a', 'profile-a');
    const outside = path.join(root, 'outside-artifacts');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'proof.json'), '{"external":true}\n', 'utf8');
    const linkedProofDir = path.join(accessA.capsule.evidenceDir, 'linked-proof');
    fs.symlinkSync(outside, linkedProofDir, 'junction');

    expect(() => assertPathInsideStoreCapsule(accessA, path.join(linkedProofDir, 'proof.json')))
      .toThrow(/REAL_PATH_OUTSIDE_STORE_CAPSULE|symbolic links|junctions/);

    fs.unlinkSync(linkedProofDir);
    const candidateA = writeCandidate(accessA);
    const session = prepareAdReadbackSession({ sourcePath: candidateA, storeAccess: accessA });
    const outsideScreenshots = path.join(outside, 'screenshots');
    fs.mkdirSync(outsideScreenshots, { recursive: true });
    fs.rmSync(session.beforeScreenshotsDir, { recursive: true, force: true });
    fs.symlinkSync(outsideScreenshots, session.beforeScreenshotsDir, 'junction');

    expect(() => verifyAdReadbackSession(session.sessionDir, accessA))
      .toThrow(/REAL_PATH_OUTSIDE_STORE_CAPSULE|symbolic links|junctions/);
  });

  it('rejects a junction used as the store capsule root', () => {
    const root = tempDir();
    const trustedStoresRoot = path.join(root, 'stores');
    const outsideStore = path.join(root, 'outside-store');
    fs.mkdirSync(trustedStoresRoot, { recursive: true });
    fs.mkdirSync(outsideStore, { recursive: true });
    fs.symlinkSync(outsideStore, path.join(trustedStoresRoot, 'store-a'), 'junction');
    const capsule = deriveStoreCapsulePaths(trustedStoresRoot, 'store-a', 'profile-a');

    expect(() => createStoreScopedReadbackAccess(context('store-a', 'profile-a'), capsule))
      .toThrow(/REAL_PATH_OUTSIDE_STORE_CAPSULE|symbolic links|junctions/);
  });
});
