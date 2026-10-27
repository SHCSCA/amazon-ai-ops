import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { deriveStoreCapsulePaths, ensureStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLegacyDeliveryRuntime as createDeliveryRuntime, type DeliveryRuntimePaths } from './delivery-legacy-runtime';
import {
  createStoreScopedReadbackAccess,
  ensureStoreScopedReadbackDirectories,
  type StoreScopedReadbackAccess,
} from './readback-store-authority';

const services = vi.hoisted(() => ({ package: vi.fn(), status: vi.fn(), refresh: vi.fn() }));
vi.mock('./delivery-evidence-status', () => ({
  getPackageEvidenceStatus: services.package,
  getDeliveryEvidenceStatus: services.status,
}));
vi.mock('./final-readiness-refresh', () => ({ refreshFinalReadiness: services.refresh }));

const roots: string[] = [];
const currentHash = 'A'.repeat(64);
const oldHash = 'B'.repeat(64);

function writeJson(filePath: string, payload: unknown): string {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

function readyPayload(hash = currentHash) {
  return {
    status: 'APP_READY', appReady: true,
    evidenceSelection: { mode: 'manifest' },
    gates: [{ id: 'release-package-hash', name: 'Package', ok: true }],
    currentPortablePackage: { sha256: hash },
    packageIndex: { packages: [{ kind: 'portable', sha256: hash }] },
    packageLaunchSmoke: { artifacts: { portable: { sha256: hash } } },
  };
}

function harness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-runtime-'));
  roots.push(root);
  const paths: DeliveryRuntimePaths = {
    userDataDir: path.join(root, 'user'), codexEvidenceDir: path.join(root, 'evidence'),
    downloadsDir: path.join(root, 'downloads'), exportsDir: path.join(root, 'exports'),
    deliveryBundlesDir: path.join(root, 'bundles'), databasePath: path.join(root, 'db.sqlite'),
    repositoryRoot: root, finalReadinessPath: null,
  };
  const access = (storeId: string, generation = 1): StoreScopedReadbackAccess => {
    const browserProfileId = `profile-${storeId}`;
    const capsule = ensureStoreCapsulePaths(deriveStoreCapsulePaths(root, storeId, browserProfileId));
    const context = {
      storeId, browserProfileId, sessionGeneration: generation, marketplace: 'US', currency: 'USD',
      businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16',
    } as StoreContextEnvelope;
    const result = createStoreScopedReadbackAccess(context, capsule);
    ensureStoreScopedReadbackDirectories(result);
    return result;
  };
  const active = { access: access('store-a'), db: null, scope: { storeName: 'Store A' } as unknown };
  const logger = { error: vi.fn() };
  const options = {
    paths, appVersion: '1.6.0', logger,
    getDatabase: vi.fn(() => active.db),
    getOperationScope: vi.fn(() => active.scope),
    normalizeOperationScope: vi.fn((input: any) => input),
    getReadbackAccess: vi.fn(() => active.access),
    validateAdReadbackAuthority: vi.fn(() => ({ ok: true })),
  };
  const outputPath = path.join(paths.codexEvidenceDir, 'final-readiness-refreshed.json');
  services.refresh.mockImplementation((input) => {
    const authority = input.validateAdReadbackAuthority(input.adReadbackPath);
    writeJson(outputPath, authority.ok ? readyPayload() : { status: 'APP_NEEDS_WORK', appReady: false });
    return { evidenceManifestPath: path.join(root, 'manifest.json'), finalReadinessPath: outputPath };
  });
  return { root, paths, active, access, logger, options, runtime: createDeliveryRuntime(options), outputPath };
}

beforeEach(() => {
  vi.resetAllMocks();
  services.package.mockReturnValue({
    installerAvailable: true,
    installerPath: 'AmazonAIOpsAgent-1.6.0.exe',
    portablePath: 'AmazonAIOpsAgent-1.6.0-portable.exe', sha256: currentHash,
  });
  services.status.mockReturnValue({ marker: 'current-store-status' });
});
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('delivery runtime readiness and paths', () => {
  it('projects all storage paths from bootstrap configuration', () => {
    const input = harness();
    expect(input.runtime.getStoragePaths()).toEqual({
      settingsPath: path.join(input.paths.userDataDir, 'settings.json'),
      evidenceDir: input.paths.codexEvidenceDir, downloadsDir: input.paths.downloadsDir,
      exportsDir: input.paths.exportsDir, deliveryDir: input.paths.deliveryBundlesDir,
      localDbPath: input.paths.databasePath,
    });
  });

  it('returns the original missing contract when no matching evidence exists', () => {
    const input = harness();
    expect(input.runtime.getReadiness()).toMatchObject({
      available: false, exists: false, path: null, status: 'APP_NEEDS_WORK',
      missing: ['最终验收 manifest 尚未生成'],
    });
    expect(input.logger.error).not.toHaveBeenCalled();
  });

  it('chooses the newest matching legacy manifest but refuses current V16 readiness credit', () => {
    const input = harness();
    const older = writeJson(path.join(input.paths.codexEvidenceDir, 'final-readiness-old.json'), {});
    const newer = writeJson(path.join(input.paths.codexEvidenceDir, 'final-readiness-new.json'), readyPayload());
    fs.utimesSync(older, 1, 1); fs.utimesSync(newer, 2, 2);
    writeJson(path.join(input.paths.codexEvidenceDir, 'unrelated.json'), {});
    const readiness = input.runtime.getReadiness();
    expect(readiness).toMatchObject({ path: newer, status: 'APP_NEEDS_WORK', appReady: false });
    expect(readiness.failures.map(failure => failure.code)).toContain('V16_LEGACY_READINESS_REFUSED');
    expect(services.package).toHaveBeenCalledWith(path.join(input.root, 'apps', 'desktop', 'release'));
  });

  it('honors a configured missing path without falling back to another manifest', () => {
    const input = harness();
    writeJson(path.join(input.paths.codexEvidenceDir, 'final-readiness-ready.json'), readyPayload());
    const configured = path.join(input.root, 'configured.json');
    const runtime = createDeliveryRuntime({ ...input.options, paths: { ...input.paths, finalReadinessPath: configured } });
    expect(runtime.getReadiness()).toMatchObject({ available: false, path: configured, exists: false });
    expect(services.package).not.toHaveBeenCalled();
  });

  it('contains malformed readiness in the original failure view and records the error', () => {
    const input = harness();
    const filePath = writeJson(path.join(input.paths.codexEvidenceDir, 'final-readiness-bad.json'), {});
    fs.writeFileSync(filePath, '{broken');
    expect(input.runtime.getReadiness()).toMatchObject({
      available: false, path: filePath, exists: true, missing: ['最终验收 manifest 无法解析'],
    });
    expect(input.logger.error).toHaveBeenCalledWith('delivery.readiness_read_failed', {
      error: expect.any(SyntaxError), finalReadinessPath: filePath,
    });
  });

  it('invalidates a previously ready manifest when the current package hash changes', () => {
    const input = harness();
    writeJson(path.join(input.paths.codexEvidenceDir, 'final-readiness-old-package.json'), readyPayload(oldHash));
    const readiness = input.runtime.getReadiness();
    expect(readiness).toMatchObject({ available: true, status: 'APP_NEEDS_WORK', appReady: false });
    expect(readiness.failures.map((failure) => failure.code)).toContain('FINAL_READINESS_PORTABLE_HASH_MISMATCH');
  });
});

describe('delivery runtime current-store binding', () => {
  it('reads DB, scope and all readback authority fields on each status call', () => {
    const input = harness();
    const firstAccess = input.active.access;
    input.runtime.getEvidenceStatus();
    expect(services.status).toHaveBeenLastCalledWith({
      db: null, storeId: 'store-a', readbackDir: firstAccess.rootDir, readbackAccess: firstAccess,
      releaseDir: path.join(input.root, 'apps', 'desktop', 'release'), scope: { storeName: 'Store A' },
    });
    const currentDb = { marker: 'new-db' };
    input.options.getDatabase.mockReturnValueOnce(currentDb as any);
    input.active.access = input.access('store-b', 2);
    input.active.scope = { storeName: 'Store B' };
    input.runtime.getEvidenceStatus();
    expect(services.status).toHaveBeenLastCalledWith(expect.objectContaining({
      db: currentDb, storeId: 'store-b', readbackDir: input.active.access.rootDir,
      readbackAccess: input.active.access, scope: { storeName: 'Store B' },
    }));
    expect(input.options.getOperationScope).toHaveBeenCalledTimes(2);
  });

  it('uses an explicit status scope and preserves scope-validation failures', () => {
    const input = harness();
    const explicit = { storeName: 'Explicit' };
    input.runtime.getEvidenceStatus(explicit);
    expect(input.options.getOperationScope).not.toHaveBeenCalled();
    expect(services.status).toHaveBeenCalledWith(expect.objectContaining({ scope: explicit }));
    const failure = new Error('INVALID_SCOPE');
    input.options.normalizeOperationScope.mockImplementationOnce(() => { throw failure; });
    expect(() => input.runtime.getEvidenceStatus()).toThrow(failure);
  });

  it('uses a current-store missing candidate even when a global readback exists', () => {
    const input = harness();
    writeJson(path.join(input.paths.codexEvidenceDir, 'real-ad-execution-readback-global.json'), { status: 'PASS' });
    input.runtime.refreshFinalReadiness();
    expect(services.refresh).toHaveBeenCalledWith(expect.objectContaining({
      adReadbackPath: path.join(input.active.access.candidatesDir, 'real-ad-execution-readback-missing.json'),
      repoRootDir: input.root, evidenceDir: input.paths.codexEvidenceDir, appVersion: '1.6.0',
    }));
    expect(input.options.validateAdReadbackAuthority).toHaveBeenCalledWith(
      path.join(input.active.access.candidatesDir, 'real-ad-execution-readback-missing.json'), 'final-readiness',
    );
  });

  it('selects candidates from each newly active store without freezing the previous store', () => {
    const input = harness();
    const candidateA = writeJson(path.join(input.active.access.candidatesDir, 'real-ad-execution-readback-a.json'), {
      storeBinding: input.active.access.binding,
    });
    input.runtime.refreshFinalReadiness();
    expect(services.refresh).toHaveBeenLastCalledWith(expect.objectContaining({ adReadbackPath: candidateA }));
    input.active.access = input.access('store-b');
    const candidateB = writeJson(path.join(input.active.access.candidatesDir, 'real-ad-execution-readback-b.json'), {
      storeBinding: input.active.access.binding,
    });
    input.runtime.refreshFinalReadiness();
    expect(services.refresh).toHaveBeenLastCalledWith(expect.objectContaining({ adReadbackPath: candidateB }));
  });

  it('validates an explicit root-relative evidence file before forwarding it', () => {
    const input = harness();
    const evidencePath = writeJson(path.join(input.active.access.rootDir, 'explicit.json'), {
      storeBinding: input.active.access.binding,
    });
    const result = input.runtime.refreshFinalReadiness({ adReadbackPath: 'explicit.json' });
    expect(services.refresh).toHaveBeenCalledWith(expect.objectContaining({ adReadbackPath: evidencePath }));
    expect(result).toMatchObject({ success: true, finalReadinessPath: input.outputPath, readiness: { appReady: false, status: 'APP_NEEDS_WORK' } });
    expect(result.readiness.failures.map(failure => failure.code)).toContain('V16_LEGACY_READINESS_REFUSED');
  });

  it.each(['another-store', 'old-session', 'outside-root'] as const)('rejects %s explicit evidence', (kind) => {
    const input = harness();
    let evidencePath = path.join(input.active.access.rootDir, 'explicit.json');
    let binding = input.active.access.binding;
    if (kind === 'another-store') binding = { ...binding, storeId: 'store-b' };
    if (kind === 'old-session') binding = { ...binding, sessionGeneration: 0 };
    if (kind === 'outside-root') evidencePath = path.join(input.root, 'outside.json');
    writeJson(evidencePath, { storeBinding: binding });
    expect(() => input.runtime.refreshFinalReadiness({ adReadbackPath: evidencePath })).toThrow(/READBACK_/);
    expect(services.refresh).not.toHaveBeenCalled();
  });

  it('forwards the Main authority rejection and checks the refreshed current package', () => {
    const input = harness();
    input.options.validateAdReadbackAuthority.mockReturnValueOnce({ ok: false, message: 'CURRENT_AUTHORITY_CHANGED' } as any);
    expect(input.runtime.refreshFinalReadiness().readiness).toMatchObject({ appReady: false, status: 'APP_NEEDS_WORK' });
    expect(input.options.validateAdReadbackAuthority).toHaveBeenCalledOnce();
    expect(services.package).toHaveBeenCalledWith(path.join(input.root, 'apps', 'desktop', 'release'));
  });

  it('rejects stale refreshed evidence against the actual current package', () => {
    const input = harness();
    services.refresh.mockImplementationOnce(() => {
      writeJson(input.outputPath, readyPayload(oldHash));
      return { evidenceManifestPath: 'manifest.json', finalReadinessPath: input.outputPath };
    });
    expect(input.runtime.refreshFinalReadiness().readiness).toMatchObject({ status: 'APP_NEEDS_WORK', appReady: false });
  });

  it('propagates refresh exceptions for the tracked IPC boundary', () => {
    const input = harness();
    const error = new Error('REFRESH_FAILED');
    services.refresh.mockImplementationOnce(() => { throw error; });
    expect(() => input.runtime.refreshFinalReadiness()).toThrow(error);
  });
});
