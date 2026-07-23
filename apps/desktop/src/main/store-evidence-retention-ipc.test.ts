import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import type {
  BusinessDate,
  StoreContextEnvelope,
  StoreRuntimeConfigProjection,
} from '@amazon-ai-ops/shared-types';
import { MainArtifactRegistry } from './main-artifact-registry';
import type {
  StoreEvidenceDatabaseReferenceProjection,
} from './store-evidence-reference-projection';
import {
  registerStoreEvidenceRetentionIpcHandlers,
  projectStoreEvidenceRetentionPreviewSummary,
  STORE_EVIDENCE_RETENTION_PREVIEW_CHANNEL,
  StoreEvidenceRetentionPreviewService,
} from './store-evidence-retention-ipc';

const NOW = new Date('2026-07-23T12:00:00.000Z');
const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

function context(storeId = 'store-a', profileId = `profile-${storeId}`): StoreContextEnvelope {
  return {
    storeId,
    browserProfileId: profileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-23' as BusinessDate,
    sessionGeneration: 4,
  } as StoreContextEnvelope;
}

function configProjection(storeContext: StoreContextEnvelope): StoreRuntimeConfigProjection {
  return {
    current: {
      configId: `store-runtime-config:${storeContext.storeId}`,
      storeId: storeContext.storeId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: storeContext.businessTimezone,
      status: 'active',
      revision: 1,
      values: {
        aiRecommendationsEnabled: true,
        collectionScheduleLocalTime: '08:00',
        collectionLookbackDays: 14,
        analysisWindowDays: 30,
        defaultTargetAcosPercent: 28,
        minimumRecommendationConfidencePercent: 72,
        evidenceRetentionDays: 30,
      },
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    },
    versions: [],
  };
}

function harness(activeContext = context()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-retention-ipc-'));
  temporaryRoots.push(root);
  const authority = {
    assertActiveStoreContext: vi.fn((value: unknown) => {
      const submitted = value as StoreContextEnvelope;
      if (
        submitted.storeId !== activeContext.storeId
        || submitted.browserProfileId !== activeContext.browserProfileId
        || submitted.sessionGeneration !== activeContext.sessionGeneration
      ) {
        throw new Error('STALE_OR_CROSS_STORE_CONTEXT');
      }
      return activeContext;
    }),
    getActiveStoreContext: vi.fn(() => activeContext as StoreContextEnvelope | null),
  };
  const runtimeConfig = { get: vi.fn(() => configProjection(activeContext)) };
  const capsule = ensureStoreCapsulePaths(
    deriveStoreCapsulePaths(root, activeContext.storeId, activeContext.browserProfileId),
  );
  const deriveCapsuleFor = vi.fn((authorized: StoreContextEnvelope) => (
    deriveStoreCapsulePaths(root, authorized.storeId, authorized.browserProfileId)
  ));
  const referencesFor = vi.fn(() => ({}));
  const service = new StoreEvidenceRetentionPreviewService({
    authority,
    runtimeConfig,
    deriveCapsuleFor,
    referencesFor,
    now: () => NOW,
  });
  return {
    authority,
    capsule,
    deriveCapsuleFor,
    referencesFor,
    root,
    runtimeConfig,
    service,
  };
}

function databaseReferences(
  databaseReferencedPaths: readonly string[] = [],
  artifactReferences: StoreEvidenceDatabaseReferenceProjection['artifactReferences'] = [],
): StoreEvidenceDatabaseReferenceProjection {
  return {
    databaseReferencedPaths,
    artifactReferences,
    blockers: [],
  };
}

function writeOldFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'old evidence');
  const modifiedAt = new Date(NOW.getTime() - (90 * 24 * 60 * 60 * 1_000));
  fs.utimesSync(filePath, modifiedAt, modifiedAt);
}

describe('store evidence retention preview IPC', () => {
  it('registers one preview-only channel and derives policy/path inputs in Main', () => {
    const { authority, deriveCapsuleFor, referencesFor, runtimeConfig, service } = harness();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    registerStoreEvidenceRetentionIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service,
    );

    expect([...handlers.keys()]).toEqual([STORE_EVIDENCE_RETENTION_PREVIEW_CHANNEL]);
    const submitted = context();
    const result = handlers.get(STORE_EVIDENCE_RETENTION_PREVIEW_CHANNEL)?.(
      {},
      { storeContext: submitted },
    );
    expect(result).toMatchObject({
      mode: 'dry-run',
      deletionSupported: false,
      applyable: false,
      scanSafe: true,
      storeId: 'store-a',
      profileId: 'profile-store-a',
      retentionDays: 30,
      protectedScopeCount: 5,
      protectedFileCount: 0,
    });
    expect(result).not.toHaveProperty('candidates');
    expect(result).not.toHaveProperty('protectedFiles');
    expect(result).not.toHaveProperty('protectedScopes');
    expect(authority.assertActiveStoreContext).toHaveBeenCalledWith(submitted);
    expect(runtimeConfig.get).toHaveBeenCalledWith(context());
    expect(deriveCapsuleFor).toHaveBeenCalledWith(context());
    expect(referencesFor).toHaveBeenCalledWith(
      context(),
      expect.objectContaining({
        storeId: 'store-a',
        browserProfileId: 'profile-store-a',
      }),
    );
  });

  it('projects only aggregate, path-free retention data across IPC', () => {
    const current = harness();
    const sensitiveName = 'customer-secret-old-evidence.png';
    writeOldFile(path.join(current.capsule.screenshotsDir, sensitiveName));

    const manifest = current.service.buildManifestForMain(context());
    expect(manifest.candidates).toContainEqual(expect.objectContaining({
      relativePath: `screenshots/${sensitiveName}`,
    }));

    const summary = projectStoreEvidenceRetentionPreviewSummary(manifest);
    const serialized = JSON.stringify(summary);
    expect(summary).toMatchObject({
      candidateCount: 1,
      protectedScopeCount: 5,
      protectedFileCount: 0,
    });
    expect(summary).not.toHaveProperty('candidates');
    expect(summary).not.toHaveProperty('protectedFiles');
    expect(summary).not.toHaveProperty('protectedScopes');
    expect(serialized).not.toContain(sensitiveName);
    expect(serialized).not.toContain('relativePath');
    expect(serialized).not.toContain(current.capsule.storeRoot);
  });

  it('uses read-only capsule derivation and fails closed without creating missing paths', () => {
    const trustedParent = fs.mkdtempSync(path.join(os.tmpdir(), 'store-retention-readonly-'));
    temporaryRoots.push(trustedParent);
    const missingTrustedRoot = path.join(trustedParent, 'stores-not-created');
    const activeContext = context();
    const derived = deriveStoreCapsulePaths(
      missingTrustedRoot,
      activeContext.storeId,
      activeContext.browserProfileId,
    );
    const authority = {
      assertActiveStoreContext: vi.fn(() => activeContext),
      getActiveStoreContext: vi.fn(() => activeContext),
    };
    const deriveCapsuleFor = vi.fn(() => derived);
    const service = new StoreEvidenceRetentionPreviewService({
      authority,
      runtimeConfig: { get: vi.fn(() => configProjection(activeContext)) },
      deriveCapsuleFor,
      now: () => NOW,
    });

    expect(fs.existsSync(derived.trustedStoresRoot)).toBe(false);
    expect(fs.existsSync(derived.storeRoot)).toBe(false);

    const summary = service.preview(activeContext);

    expect(deriveCapsuleFor).toHaveBeenCalledWith(activeContext);
    expect(summary.scanSafe).toBe(false);
    expect(summary.blockers).toContainEqual(expect.objectContaining({
      code: 'MISSING_CAPSULE_PATH',
    }));
    expect(fs.existsSync(derived.trustedStoresRoot)).toBe(false);
    expect(fs.existsSync(derived.storeRoot)).toBe(false);
    expect(fs.existsSync(derived.screenshotsDir)).toBe(false);
  });

  it('rejects renderer-controlled retention or path fields before preview', () => {
    const { authority, service } = harness();
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    registerStoreEvidenceRetentionIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service,
    );
    const handler = handlers.get(STORE_EVIDENCE_RETENTION_PREVIEW_CHANNEL)!;

    expect(() => handler({}, {
      storeContext: context(),
      evidenceRetentionDays: 1,
      referencedPaths: ['D:\\other-store\\evidence.png'],
      artifactResolver: { resolve: () => 'D:\\forged\\evidence.png' },
    })).toThrow(/accepts storeContext only/);
    expect(authority.assertActiveStoreContext).not.toHaveBeenCalled();
  });

  it('fails closed for cross-store and expired StoreContext before config or filesystem access', () => {
    const { deriveCapsuleFor, runtimeConfig, service } = harness();

    expect(() => service.preview(context('store-b'))).toThrow(/STALE_OR_CROSS_STORE_CONTEXT/);
    expect(() => service.preview({ ...context(), sessionGeneration: 3 })).toThrow(/STALE_OR_CROSS_STORE_CONTEXT/);
    expect(runtimeConfig.get).not.toHaveBeenCalled();
    expect(deriveCapsuleFor).not.toHaveBeenCalled();
  });

  it('fails closed when Main returns a cross-store config or capsule', () => {
    const first = harness();
    first.runtimeConfig.get.mockReturnValue(configProjection(context('store-b')));
    expect(() => first.service.preview(context())).toThrow(/STORE_RETENTION_CONFIG_MISMATCH/);
    expect(first.deriveCapsuleFor).not.toHaveBeenCalled();

    const second = harness();
    second.deriveCapsuleFor.mockImplementation(() => (
      deriveStoreCapsulePaths(second.root, 'store-b', 'profile-store-b')
    ));
    expect(() => second.service.preview(context())).toThrow(/STORE_RETENTION_CAPSULE_MISMATCH/);
    expect(second.referencesFor).not.toHaveBeenCalled();
  });

  it('returns null without touching config or disk when no store is active', () => {
    const current = context();
    const { authority, deriveCapsuleFor, runtimeConfig, service } = harness(current);
    authority.getActiveStoreContext.mockReturnValue(null);

    expect(service.previewActiveStore()).toBeNull();
    expect(authority.assertActiveStoreContext).not.toHaveBeenCalled();
    expect(runtimeConfig.get).not.toHaveBeenCalled();
    expect(deriveCapsuleFor).not.toHaveBeenCalled();
  });

  it('resolves artifact:v1 references only through the injected Main registry', () => {
    const current = harness();
    const artifactPath = path.join(current.capsule.screenshotsDir, 'artifact-evidence.png');
    writeOldFile(artifactPath);
    const registry = new MainArtifactRegistry({
      createId: () => '00000000-0000-4000-8000-000000000001',
    });
    const descriptor = registry.issue({
      storeId: String(context().storeId),
      absolutePath: artifactPath,
      allowedRoots: [current.capsule.storeRoot],
      kind: 'diagnostic-file',
    });
    current.referencesFor.mockReturnValue({
      databaseReferences: databaseReferences([], [{
        artifactId: descriptor.artifactId,
        source: 'operation_events.evidence_path',
        referencedStoreId: 'store-a',
        ownership: 'current-store',
      }]),
    });
    const service = new StoreEvidenceRetentionPreviewService({
      authority: current.authority,
      runtimeConfig: current.runtimeConfig,
      deriveCapsuleFor: current.deriveCapsuleFor,
      referencesFor: current.referencesFor,
      artifactResolver: registry,
      now: () => NOW,
    });

    const manifest = service.buildManifestForMain(context());

    expect(manifest).toMatchObject({
      applyable: false,
      scanSafe: true,
      candidateCount: 0,
    });
    expect(manifest.protectedFiles).toContainEqual(expect.objectContaining({
      relativePath: 'screenshots/artifact-evidence.png',
      reasons: ['database-reference'],
    }));
    expect(JSON.stringify(manifest)).not.toContain(artifactPath);
  });

  it('reconciles foreign-store artifact references instead of dropping them', () => {
    const current = harness();
    const foreignCapsule = ensureStoreCapsulePaths(
      deriveStoreCapsulePaths(current.root, 'store-b', 'profile-store-b'),
    );
    const foreignPath = path.join(foreignCapsule.screenshotsDir, 'foreign-owned.png');
    const mismatchedPath = path.join(current.capsule.screenshotsDir, 'current-owned-from-foreign-row.png');
    writeOldFile(foreignPath);
    writeOldFile(mismatchedPath);
    const registry = new MainArtifactRegistry({
      createId: (() => {
        const ids = [
          '00000000-0000-4000-8000-000000000003',
          '00000000-0000-4000-8000-000000000004',
        ];
        return () => ids.shift() ?? '00000000-0000-4000-8000-000000000005';
      })(),
    });
    const legitimateForeign = registry.issue({
      storeId: 'store-b',
      absolutePath: foreignPath,
      allowedRoots: [foreignCapsule.storeRoot],
      kind: 'diagnostic-file',
    });
    const mismatchedForeign = registry.issue({
      storeId: 'store-a',
      absolutePath: mismatchedPath,
      allowedRoots: [current.capsule.storeRoot],
      kind: 'diagnostic-file',
    });
    current.referencesFor.mockReturnValue({
      databaseReferences: databaseReferences([], [
        {
          artifactId: legitimateForeign.artifactId,
          source: 'operation_events.evidence_path',
          referencedStoreId: 'store-b',
          ownership: 'foreign-store',
        },
        {
          artifactId: mismatchedForeign.artifactId,
          source: 'operation_events.evidence_path',
          referencedStoreId: 'store-b',
          ownership: 'foreign-store',
        },
      ]),
    });
    const service = new StoreEvidenceRetentionPreviewService({
      authority: current.authority,
      runtimeConfig: current.runtimeConfig,
      deriveCapsuleFor: current.deriveCapsuleFor,
      referencesFor: current.referencesFor,
      artifactResolver: registry,
      now: () => NOW,
    });

    const manifest = service.buildManifestForMain(context());

    expect(manifest.scanSafe).toBe(false);
    expect(manifest.blockers).toContainEqual(expect.objectContaining({
      code: 'CROSS_STORE_REFERENCE',
      relativePath: '[artifact-reference]',
    }));
    expect(manifest.protectedFiles).toContainEqual(expect.objectContaining({
      relativePath: 'screenshots/current-owned-from-foreign-row.png',
      reasons: ['database-reference'],
    }));
    expect(JSON.stringify(manifest)).not.toContain(foreignPath);
    expect(JSON.stringify(manifest.blockers)).not.toContain(mismatchedPath);
  });

  it('fails the scan closed when an artifact registry is empty after restart', () => {
    const current = harness();
    const artifactPath = path.join(current.capsule.screenshotsDir, 'restart-evidence.png');
    writeOldFile(artifactPath);
    const beforeRestart = new MainArtifactRegistry({
      createId: () => '00000000-0000-4000-8000-000000000002',
    });
    const descriptor = beforeRestart.issue({
      storeId: String(context().storeId),
      absolutePath: artifactPath,
      allowedRoots: [current.capsule.storeRoot],
      kind: 'diagnostic-file',
    });
    current.referencesFor.mockReturnValue({
      databaseReferences: databaseReferences([], [{
        artifactId: descriptor.artifactId,
        source: 'operation_events.evidence_path',
        referencedStoreId: 'store-a',
        ownership: 'current-store',
      }]),
    });
    const afterRestart = new MainArtifactRegistry();
    const service = new StoreEvidenceRetentionPreviewService({
      authority: current.authority,
      runtimeConfig: current.runtimeConfig,
      deriveCapsuleFor: current.deriveCapsuleFor,
      referencesFor: current.referencesFor,
      artifactResolver: afterRestart,
      now: () => NOW,
    });

    const manifest = service.buildManifestForMain(context());

    expect(manifest).toMatchObject({
      applyable: false,
      scanSafe: false,
      candidateCount: 1,
    });
    expect(manifest.blockers).toContainEqual(expect.objectContaining({
      code: 'UNRESOLVED_ARTIFACT_REFERENCE',
      relativePath: '[artifact-reference]',
    }));
    expect(JSON.stringify(manifest.blockers)).not.toContain(artifactPath);
    expect(JSON.stringify(manifest.blockers)).not.toContain(current.capsule.storeRoot);
  });

  it('keeps a legacy absolute operation-event path protected without a resolver', () => {
    const current = harness();
    const legacyPath = path.join(current.capsule.screenshotsDir, 'legacy-event-evidence.png');
    writeOldFile(legacyPath);
    current.referencesFor.mockReturnValue({
      databaseReferences: databaseReferences([legacyPath]),
    });
    const service = new StoreEvidenceRetentionPreviewService({
      authority: current.authority,
      runtimeConfig: current.runtimeConfig,
      deriveCapsuleFor: current.deriveCapsuleFor,
      referencesFor: current.referencesFor,
      now: () => NOW,
    });

    const manifest = service.buildManifestForMain(context());

    expect(manifest).toMatchObject({
      applyable: false,
      scanSafe: true,
      candidateCount: 0,
    });
    expect(manifest.protectedFiles).toContainEqual(expect.objectContaining({
      relativePath: 'screenshots/legacy-event-evidence.png',
      reasons: ['database-reference'],
    }));
  });
});
