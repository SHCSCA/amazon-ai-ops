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

function verifyFixture(fixture, manifestPath, readinessRunner = fixture.readinessRunner) {
  return verifyS7Bundle({
    manifestPath,
    readinessPath: fixture.readinessPath,
    mode: 'ready',
    rootDir: fixture.rootDir,
    releaseRoot: fixture.releaseRoot,
    readinessRunner,
    nowMs: Date.parse('2026-07-28T00:32:00.000Z'),
  });
}

describe('S7 READY safety', () => {
  it('accepts a closed 8/8 bundle after current formal revalidation', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const exported = exportFixture(fixture);
      const result = verifyFixture(fixture, exported.manifestPath);
      expect(result.failures).toEqual([]);
      expect(result.passed).toBe(true);
      expect(result.manifest.gateArtifacts.every((gate) => gate.ok)).toBe(true);
      expect(result.manifest.currentRevalidation.readyCredit).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects any 0-7/8 bundle in READY mode', () => {
    const fixture = createS7BundleFixture(7);
    try {
      const exported = exportFixture(fixture);
      const result = verifyFixture(fixture, exported.manifestPath);
      expect(result.passed).toBe(false);
      expect(result.failures.join('\n')).toMatch(/READY safety requires a genuine 8\/8/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects package identity drift after export', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const exported = exportFixture(fixture);
      fs.appendFileSync(fixture.canonicalPackage.paths.executablePath, 'changed-package');
      const result = verifyFixture(fixture, exported.manifestPath);
      expect(result.passed).toBe(false);
      expect(result.failures.join('\n')).toMatch(/package identity/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects hash-only external artifact drift', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const exported = exportFixture(fixture);
      const rawReport = exported.manifest.closure.externalArtifacts.find((item) => (
        path.extname(item.sourcePath).toLowerCase() === '.csv'
      ));
      expect(rawReport).toBeTruthy();
      fs.appendFileSync(rawReport.sourcePath, 'changed-report');
      const result = verifyFixture(fixture, exported.manifestPath);
      expect(result.passed).toBe(false);
      expect(result.failures.join('\n')).toMatch(/external artifact (size|SHA-256) changed/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a manifest that omits a current passed-gate artifact from closure', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const exported = exportFixture(fixture);
      const manifest = JSON.parse(fs.readFileSync(exported.manifestPath, 'utf8'));
      const rawReportIndex = manifest.closure.externalArtifacts.findIndex((item) => (
        path.extname(item.sourcePath).toLowerCase() === '.csv'
      ));
      expect(rawReportIndex).toBeGreaterThanOrEqual(0);
      manifest.closure.externalArtifacts.splice(rawReportIndex, 1);
      manifest.closure.externalHashOnlyArtifactCount -= 1;
      fs.writeFileSync(exported.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const result = verifyFixture(fixture, exported.manifestPath);
      expect(result.passed).toBe(false);
      expect(result.failures.join('\n')).toMatch(/closure does not exactly match/i);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects replayed READY when current formal readiness is no longer 8/8', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const exported = exportFixture(fixture);
      const refreshed = structuredClone(fixture.readiness);
      refreshed.gates[7].ok = false;
      refreshed.gates[7].status = 'needs_work';
      refreshed.status = 'APP_NEEDS_WORK';
      refreshed.appReady = false;
      refreshed.allGatesPass = false;
      refreshed.summary = { total: 8, passed: 7, failed: 1 };
      refreshed.failures = [{
        gateId: refreshed.gates[7].id,
        evidencePath: refreshed.gates[7].evidencePath,
        reason: 'Current policy-auto canary is stale.',
      }];
      const result = verifyFixture(fixture, exported.manifestPath, () => ({
        exitCode: 1,
        report: refreshed,
        stdout: '',
        stderr: '',
      }));
      expect(result.passed).toBe(false);
      expect(result.failures.join('\n')).toMatch(/current ready revalidation failed/i);
    } finally {
      fixture.cleanup();
    }
  });
});
