import { describe, expect, it } from 'vitest';
import { normalizeDeliveryReadiness } from './delivery-readiness-view';

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
    expect(normalized.failures).toEqual([
      {
        gateId: 'package-launch-smoke',
        code: 'PACKAGE_SMOKE_STALE',
        message: 'package launch smoke is stale',
        evidencePath: 'D:/evidence/package-launch-smoke.json',
      },
    ]);
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
});
