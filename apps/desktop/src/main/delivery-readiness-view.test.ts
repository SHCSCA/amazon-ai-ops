import { describe, expect, it } from 'vitest';
import {
  deliveryReadinessAllowsExport,
  normalizeDeliveryReadiness,
} from './delivery-readiness-view';

const CURRENT_PORTABLE_HASH = 'B'.repeat(64);
const STALE_PORTABLE_HASH = 'A'.repeat(64);

function readyManifest(overrides: Record<string, unknown> = {}) {
  return {
    status: 'APP_READY',
    appReady: true,
    manifestDriven: true,
    gates: [
      { id: 'release-package-hash', name: 'Release package hash', ok: true },
      { id: 'package-launch-smoke', name: 'Package launch smoke', ok: true },
    ],
    currentPortablePackage: {
      sourcePath: 'D:/release/AmazonAIOpsAgent-current-portable.exe',
      sha256: CURRENT_PORTABLE_HASH,
    },
    packageIndex: {
      packages: [{
        kind: 'portable',
        sourcePath: 'D:/release/AmazonAIOpsAgent-current-portable.exe',
        sha256: CURRENT_PORTABLE_HASH,
      }],
    },
    packageLaunchSmoke: {
      artifacts: {
        portable: {
          path: 'D:/release/AmazonAIOpsAgent-current-portable.exe',
          sha256: CURRENT_PORTABLE_HASH,
        },
      },
    },
    ...overrides,
  };
}

const currentPortableAuthority = {
  currentPackage: {
    installerAvailable: true,
    installerPath: 'D:/release/AmazonAIOpsAgent-1.5.0.exe',
    portablePath: 'D:/release/AmazonAIOpsAgent-1.5.0-portable.exe',
    sha256: CURRENT_PORTABLE_HASH,
  },
};

describe('normalizeDeliveryReadiness', () => {
  it('preserves shared evaluator gate ids, structured failures, and preview provenance additively', () => {
    const normalized = normalizeDeliveryReadiness({
      status: 'APP_NEEDS_WORK',
      appReady: false,
      manifestDriven: true,
      previewOnly: true,
      gates: [
        {
          id: 'release-package-hash',
          name: 'Release package hash',
          status: 'passed',
          ok: true,
          evidencePath: 'D:/release/package-index.json',
          message: 'package hashes indexed',
        },
        {
          id: 'package-launch-smoke',
          name: 'Package launch smoke',
          status: 'needs_work',
          ok: false,
          evidencePath: 'D:/evidence/package-launch-smoke.json',
          message: 'package smoke is stale',
        },
      ],
      failures: [
        {
          gateId: 'package-launch-smoke',
          code: 'PACKAGE_SMOKE_STALE',
          message: 'package launch smoke is stale',
          evidencePath: 'D:/evidence/package-launch-smoke.json',
        },
      ],
    }, 'D:/evidence/final-readiness.json');

    expect(normalized.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'release-package-hash', ok: true }),
      expect.objectContaining({ id: 'package-launch-smoke', ok: false }),
    ]));
    expect(normalized.failures).toEqual(expect.arrayContaining([
      {
        gateId: 'package-launch-smoke',
        code: 'PACKAGE_SMOKE_STALE',
        message: 'package launch smoke is stale',
        evidencePath: 'D:/evidence/package-launch-smoke.json',
      },
      expect.objectContaining({
        gateId: 'final-readiness',
        code: 'PREVIEW_ONLY_FINAL_READINESS',
      }),
    ]));
    expect(normalized.previewOnly).toBe(true);
    expect(normalized.appReady).toBe(false);
  });

  it('does not change gate semantics while preserving provenance', () => {
    const normalized = normalizeDeliveryReadiness({
      status: 'APP_READY',
      appReady: true,
      manifestDriven: true,
      gates: [
        { id: 'release-package-hash', name: 'Release package hash', ok: true },
        { id: 'package-launch-smoke', name: 'Package launch smoke', ok: false },
      ],
      failures: [{
        gateId: 'package-launch-smoke',
        code: 'PACKAGE_SMOKE_PORTABLE_HASH_MISMATCH',
        message: 'portable package hash does not match',
        evidencePath: 'D:/evidence/package-launch-smoke.json',
      }],
    }, 'D:/evidence/final-readiness.json');

    expect(normalized.appReady).toBe(false);
    expect(normalized.status).toBe('APP_READY');
    expect(normalized.gatesSummary).toEqual({ total: 2, passed: 1, failed: 1 });
  });

  it('rejects preview-only APP_READY at normalization and export boundaries', () => {
    const normalized = normalizeDeliveryReadiness(
      readyManifest({ previewOnly: true }),
      'D:/evidence/final-readiness-preview.json',
      currentPortableAuthority,
    );

    expect(normalized.status).toBe('APP_NEEDS_WORK');
    expect(normalized.appReady).toBe(false);
    expect(normalized.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'PREVIEW_ONLY_FINAL_READINESS' }),
    ]));
    expect(deliveryReadinessAllowsExport(normalized)).toBe(false);
  });

  it('blocks export when portable hashes match but the installer is missing', () => {
    const normalized = normalizeDeliveryReadiness(
      readyManifest(),
      'D:/evidence/final-readiness.json',
      {
        currentPackage: {
          installerAvailable: false,
          portablePath: 'D:/release/AmazonAIOpsAgent-current-portable.exe',
          sha256: CURRENT_PORTABLE_HASH,
        },
      },
    );

    expect(normalized.status).toBe('APP_NEEDS_WORK');
    expect(normalized.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CURRENT_INSTALLER_PACKAGE_MISSING' }),
    ]));
    expect(deliveryReadinessAllowsExport(normalized)).toBe(false);
  });

  it('blocks export when installer and portable versions do not match', () => {
    const normalized = normalizeDeliveryReadiness(
      readyManifest(),
      'D:/evidence/final-readiness.json',
      {
        currentPackage: {
          installerAvailable: true,
          installerPath: 'D:/release/AmazonAIOpsAgent-1.4.9.exe',
          portablePath: 'D:/release/AmazonAIOpsAgent-1.5.0-portable.exe',
          sha256: CURRENT_PORTABLE_HASH,
        },
      },
    );

    expect(normalized.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'CURRENT_PACKAGE_VERSION_MISMATCH' }),
    ]));
    expect(deliveryReadinessAllowsExport(normalized)).toBe(false);
  });

  it.each([
    {
      source: 'final-readiness current portable',
      manifest: readyManifest({
        currentPortablePackage: {
          sourcePath: 'D:/release/AmazonAIOpsAgent-old-portable.exe',
          sha256: STALE_PORTABLE_HASH,
        },
      }),
      failureCode: 'FINAL_READINESS_PORTABLE_HASH_MISMATCH',
      failedGate: 'release-package-hash',
    },
    {
      source: 'package index portable',
      manifest: readyManifest({
        packageIndex: {
          packages: [{
            kind: 'portable',
            sourcePath: 'D:/release/AmazonAIOpsAgent-old-portable.exe',
            sha256: STALE_PORTABLE_HASH,
          }],
        },
      }),
      failureCode: 'PACKAGE_INDEX_PORTABLE_HASH_MISMATCH',
      failedGate: 'release-package-hash',
    },
    {
      source: 'package launch smoke portable',
      manifest: readyManifest({
        packageLaunchSmoke: {
          artifacts: {
            portable: {
              path: 'D:/release/AmazonAIOpsAgent-old-portable.exe',
              sha256: STALE_PORTABLE_HASH,
            },
          },
        },
      }),
      failureCode: 'PACKAGE_SMOKE_PORTABLE_HASH_MISMATCH',
      failedGate: 'package-launch-smoke',
    },
  ])('fails closed and forbids export when $source hash is stale', ({ manifest, failureCode, failedGate }) => {
    const normalized = normalizeDeliveryReadiness(
      manifest,
      'D:/evidence/final-readiness.json',
      currentPortableAuthority,
    );

    expect(normalized.status).toBe('APP_NEEDS_WORK');
    expect(normalized.appReady).toBe(false);
    expect(normalized.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: failedGate, ok: false }),
    ]));
    expect(normalized.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: failedGate, code: failureCode }),
    ]));
    expect(deliveryReadinessAllowsExport(normalized)).toBe(false);
  });

  it('keeps export authority only when final-readiness, package index, launch smoke and live portable hashes agree', () => {
    const normalized = normalizeDeliveryReadiness(
      readyManifest(),
      'D:/evidence/final-readiness.json',
      currentPortableAuthority,
    );

    expect(normalized.status).toBe('APP_READY');
    expect(normalized.appReady).toBe(true);
    expect(deliveryReadinessAllowsExport(normalized)).toBe(true);
  });
});
