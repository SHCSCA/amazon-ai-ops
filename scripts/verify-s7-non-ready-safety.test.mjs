import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createS7BundleFixture } from './s7-delivery-bundle.test-fixture.mjs';

const require = createRequire(import.meta.url);
const { exportBundle } = require('./export-s7-delivery-bundle.js');
const { verifyS7Bundle } = require('./verify-s7-ready-safety.js');

function exportFixture(fixture) {
  return exportBundle({
    readinessPath: fixture.readinessPath,
    outDir: fixture.outDir,
    readmePath: fixture.readmePath,
    rootDir: fixture.rootDir,
    releaseRoot: fixture.releaseRoot,
    evidenceRoot: fixture.evidenceRoot,
    readinessRunner: fixture.readinessRunner,
    now: new Date('2026-07-28T00:31:00.000Z'),
  });
}

function verifyFixture(fixture, manifestPath, mode = 'non-ready') {
  return verifyS7Bundle({
    manifestPath,
    readinessPath: fixture.readinessPath,
    mode,
    rootDir: fixture.rootDir,
    releaseRoot: fixture.releaseRoot,
    readinessRunner: fixture.readinessRunner,
    nowMs: Date.parse('2026-07-28T00:32:00.000Z'),
  });
}

describe('S7 NON_READY safety', () => {
  it('accepts faithful current 0/8 through 7/8 Mission bundles', () => {
    for (let passedCount = 0; passedCount <= 7; passedCount += 1) {
      const fixture = createS7BundleFixture(passedCount);
      try {
        const exported = exportFixture(fixture);
        const result = verifyFixture(fixture, exported.manifestPath);
        expect(result.failures, `${passedCount}/8 failures`).toEqual([]);
        expect(result.passed).toBe(true);
      } finally {
        fixture.cleanup();
      }
    }
  });

  it('rejects APP_READY instead of treating it as NON_READY', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const exported = exportFixture(fixture);
      const result = verifyFixture(fixture, exported.manifestPath, 'non-ready');
      expect(result.passed).toBe(false);
      expect(result.failures.join('\n')).toMatch(/NON_READY safety requires a genuine 0-7\/8/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects bundled evidence byte tampering and unlisted files', () => {
    const fixture = createS7BundleFixture(4);
    try {
      const exported = exportFixture(fixture);
      const gate = exported.manifest.gateArtifacts[0];
      fs.appendFileSync(path.join(fixture.outDir, gate.bundlePath), 'tampered');
      fs.writeFileSync(path.join(fixture.outDir, 'unlisted-secret.txt'), 'not allowed');
      const result = verifyFixture(fixture, exported.manifestPath);
      expect(result.passed).toBe(false);
      expect(result.failures.join('\n')).toMatch(/bundled size changed|bundled SHA-256 changed/i);
      expect(result.failures.join('\n')).toMatch(/unlisted files/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a NON_READY report whose current formal gate vector drifted', () => {
    const fixture = createS7BundleFixture(4);
    try {
      const exported = exportFixture(fixture);
      const refreshed = structuredClone(fixture.readiness);
      refreshed.gates[4].ok = true;
      refreshed.gates[4].status = 'passed';
      refreshed.summary = { total: 8, passed: 5, failed: 3 };
      refreshed.failures = refreshed.failures.filter((failure) => (
        failure.gateId !== refreshed.gates[4].id
      ));
      const result = verifyS7Bundle({
        manifestPath: exported.manifestPath,
        readinessPath: fixture.readinessPath,
        mode: 'non-ready',
        rootDir: fixture.rootDir,
        releaseRoot: fixture.releaseRoot,
        readinessRunner: () => ({
          exitCode: 1,
          report: refreshed,
          stdout: '',
          stderr: '',
        }),
        nowMs: Date.parse('2026-07-28T00:32:00.000Z'),
      });
      expect(result.passed).toBe(false);
      expect(result.failures.join('\n')).toMatch(/revalidation rejected non-ready/i);
    } finally {
      fixture.cleanup();
    }
  });
});
