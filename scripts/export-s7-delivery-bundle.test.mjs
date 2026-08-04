import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createS7BundleFixture } from './s7-delivery-bundle.test-fixture.mjs';

const require = createRequire(import.meta.url);
const {
  BUNDLE_SCHEMA_VERSION,
  GATE_IDS,
  exportBundle,
} = require('./export-s7-delivery-bundle.js');

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

describe('S7 Mission delivery bundle exporter', () => {
  it('exports every genuine APP_NEEDS_WORK combination from 0/8 through 7/8', () => {
    for (let passedCount = 0; passedCount <= 7; passedCount += 1) {
      const fixture = createS7BundleFixture(passedCount);
      try {
        const result = exportFixture(fixture);
        expect(result.manifest).toEqual(expect.objectContaining({
          schemaVersion: BUNDLE_SCHEMA_VERSION,
          status: 'APP_NEEDS_WORK',
          appReady: false,
          gateSummary: {
            total: 8,
            passed: passedCount,
            failed: 8 - passedCount,
          },
        }));
        expect(result.manifest.gateArtifacts).toHaveLength(8);
        expect(result.manifest.gateArtifacts.map((gate) => gate.gateId)).toEqual(GATE_IDS);
        expect(result.manifest.currentRevalidation).toEqual(expect.objectContaining({
          passed: true,
          readyCredit: false,
          status: 'APP_NEEDS_WORK',
        }));
        expect(result.manifest.closure.complete).toBe(true);
        expect(result.manifest.closure.externalArtifacts.some((item) => (
          item.sourcePath === fixture.snapshotDbPath
        ))).toBe(true);
        expect(fs.existsSync(result.manifestPath)).toBe(true);
      } finally {
        fixture.cleanup();
      }
    }
  });

  it('exports APP_READY only after an exact current 8/8 revalidation', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const result = exportFixture(fixture);
      expect(result.manifest).toEqual(expect.objectContaining({
        status: 'APP_READY',
        appReady: true,
        gateSummary: { total: 8, passed: 8, failed: 0 },
      }));
      expect(result.manifest.currentRevalidation).toEqual(expect.objectContaining({
        passed: true,
        readyCredit: true,
        status: 'APP_READY',
      }));
      expect(result.manifest.closure.copiedArtifacts.length).toBeGreaterThanOrEqual(3);
      expect(result.manifest.closure.externalArtifacts.some((item) => (
        path.extname(item.sourcePath).toLowerCase() === '.csv'
      ))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it('preserves genuinely missing explicit evidence without inventing bundle files', () => {
    const fixture = createS7BundleFixture(4);
    try {
      for (const id of ['s7-continuous-operation', 'manual-canary', 'policy-auto-canary']) {
        fixture.readiness.evidenceSelection.selectedPaths[id] = null;
        const gate = fixture.readiness.gates.find((candidate) => candidate.id === id);
        gate.evidencePath = null;
        gate.status = 'missing';
        const failure = fixture.readiness.failures.find((candidate) => candidate.gateId === id);
        failure.evidencePath = null;
      }
      fs.writeFileSync(
        fixture.readinessPath,
        `${JSON.stringify(fixture.readiness, null, 2)}\n`,
        'utf8',
      );
      const result = exportFixture(fixture);
      const missing = result.manifest.gateArtifacts.filter((gate) => (
        ['s7-continuous-operation', 'manual-canary', 'policy-auto-canary'].includes(gate.gateId)
      ));
      expect(missing).toHaveLength(3);
      expect(missing.every((gate) => (
        gate.status === 'missing'
          && gate.sourcePath === null
          && gate.sourceExists === false
          && gate.bundlePath === null
          && gate.sha256 === null
      ))).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it('rejects a forged READY when formal revalidation does not return current 8/8', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const stale = structuredClone(fixture.readiness);
      stale.gates[7].ok = false;
      stale.gates[7].status = 'needs_work';
      stale.status = 'APP_NEEDS_WORK';
      stale.appReady = false;
      stale.allGatesPass = false;
      stale.summary = { total: 8, passed: 7, failed: 1 };
      stale.failures = [{
        gateId: stale.gates[7].id,
        evidencePath: stale.gates[7].evidencePath,
        reason: 'Current formal verifier rejected this gate.',
      }];
      expect(() => exportBundle({
        readinessPath: fixture.readinessPath,
        outDir: fixture.outDir,
        readmePath: fixture.readmePath,
        rootDir: fixture.rootDir,
        releaseRoot: fixture.releaseRoot,
        evidenceRoot: fixture.evidenceRoot,
        readinessRunner: () => ({
          exitCode: 1,
          report: stale,
          stdout: '',
          stderr: '',
        }),
        now: new Date('2026-07-28T00:31:00.000Z'),
      })).toThrow(/revalidation rejected ready/i);
      expect(fs.existsSync(fixture.outDir)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });

  it('fails closed when a hash-bound passed-gate artifact changed', () => {
    const fixture = createS7BundleFixture(8);
    try {
      const packageUi = JSON.parse(
        fs.readFileSync(fixture.readiness.evidenceSelection.selectedPaths['package-ui'], 'utf8'),
      );
      fs.appendFileSync(packageUi.screenshot.path, 'tampered');
      expect(() => exportFixture(fixture)).toThrow(/referenced artifact changed/i);
      expect(fs.existsSync(fixture.outDir)).toBe(false);
    } finally {
      fixture.cleanup();
    }
  });
});
