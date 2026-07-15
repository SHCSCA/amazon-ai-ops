import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import {
  createValidAdReadbackEvidence,
  writeAdReadbackAuthorityDb,
} from './ad-readback-authority-db.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const bundleRoot = path.join(root, 'output', 'delivery-bundles');

function runNode(script, args = []) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeValidReadbackWithDb(fixtureDir, evidencePath) {
  const evidence = createValidAdReadbackEvidence(fixtureDir);
  writeJson(evidencePath, evidence);
  return writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), evidence);
}

function writeReadme(filePath, status = 'IN_PROGRESS') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `# Fixture\n\n**DELIVERY: ${status}.** Fixture README for non-ready safety tests.\n`, 'utf8');
  return filePath;
}

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return filePath;
}

function writeReport(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'placeholder report file for non-ready safety readback verifier\n', 'utf8');
  return filePath;
}

function sha256Text(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}

function finalPackageIndex(dir) {
  const installerContent = 'installer package fixture\n';
  const portableContent = 'portable package fixture\n';
  const installerPath = path.join(dir, 'AmazonAIOpsAgent-1.5.0.exe');
  const portablePath = path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  fs.writeFileSync(installerPath, installerContent, 'utf8');
  fs.writeFileSync(portablePath, portableContent, 'utf8');
  return {
    present: true,
    count: 2,
    existingCount: 2,
    missingCount: 0,
    packages: [
      {
        kind: 'installer',
        sourcePath: installerPath,
        fileName: 'AmazonAIOpsAgent-1.5.0.exe',
        exists: true,
        sizeBytes: Buffer.byteLength(installerContent, 'utf8'),
        sha256: sha256Text(installerContent),
      },
      {
        kind: 'portable',
        sourcePath: portablePath,
        fileName: 'AmazonAIOpsAgent-1.5.0-portable.exe',
        exists: true,
        sizeBytes: Buffer.byteLength(portableContent, 'utf8'),
        sha256: sha256Text(portableContent),
      },
    ],
  };
}

function validPackageLaunchSmoke(dir) {
  const unpackedContent = 'unpacked exe fixture\n';
  const portableContent = 'portable exe fixture\n';
  const unpackedPath = path.join(dir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const portablePath = path.join(dir, 'AmazonAIOpsAgent-1.5.0-portable.exe');
  fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
  fs.writeFileSync(unpackedPath, unpackedContent, 'utf8');
  fs.writeFileSync(portablePath, portableContent, 'utf8');
  return {
    kind: 'package-launch-smoke',
    passed: true,
    artifacts: {
      unpacked: {
        path: unpackedPath,
        sizeBytes: Buffer.byteLength(unpackedContent, 'utf8'),
        sha256: sha256Text(unpackedContent),
      },
      portable: {
        path: portablePath,
        sizeBytes: Buffer.byteLength(portableContent, 'utf8'),
        sha256: sha256Text(portableContent),
      },
    },
    checks: [
      { kind: 'win-unpacked', ok: true, marker: '[App] ipc-ready' },
      { kind: 'portable', ok: true, appChildCount: 1 },
    ],
  };
}

function validReadbackEvidence(dir) {
  const now = '2026-06-10T00:00:00.000Z';
  return {
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    createdAt: now,
    authority: {
      recommendationId: 1,
      recommendationRevision: 1,
      recommendationStatusAtExport: 'approved',
      dateFrom: '2026-06-01',
      dateTo: '2026-06-10',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      batchId: 'batch_1',
      checkedAt: now,
    },
    realWriteApproved: true,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: true,
    },
    approval: {
      operatorConfirmed: true,
      scope: 'FT-US-US / US / Campaign A / Ad Group A / close match / lower_bid',
      confirmedAt: now,
      approverName: 'Ops Owner',
      approvalArtifactPath: 'approval-ticket-123',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      asin: 'B0TESTASIN',
      campaignName: 'Campaign A',
      adGroupName: 'Ad Group A',
      entityType: 'target',
      entityName: 'close match',
      actionType: 'lower_bid',
    },
    risk: {
      level: 'low',
      allowedByPolicy: true,
      rationale: 'Small reversible bid decrease on one target.',
    },
    before: {
      value: '2.40',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'before.png')),
      liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
    },
    after: {
      value: '2.16',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: now,
      actualValue: '2.16',
      evidencePath: writePng(path.join(dir, 'readback.png')),
    },
    execution: {
      success: true,
      verified: true,
      executionId: 'manual-ads-ui-123',
      executedAt: now,
      channel: 'manual_ads_ui',
      performedBy: 'operator@example.com',
      appExecutorUsed: false,
    },
    source: {
      recommendationId: '1',
      recommendationRevision: 1,
      batchId: 'batch_1',
      sourceFiles: [writeReport(path.join(dir, 'user-search-term.xlsx'))],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'search_term',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
  };
}

describe('verify v15 non-ready safety', () => {
  it('accepts the current IN_PROGRESS README delivery state as non-ready', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-safety-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const finalReadiness = path.join(dir, 'final-readiness.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = writeReadme(path.join(dir, 'README.md'));

    writeJson(evidenceManifest, { kind: 'v15-final-readiness-evidence-manifest', evidence: {} });
    writeJson(finalReadiness, {
      status: 'APP_NEEDS_WORK',
      appReady: false,
      reportCollectionReady: true,
      listingReadReady: true,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
      },
      gates: [
        { name: 'AI live provider', ok: true, status: 'passed' },
        { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
        { name: 'Listing AI draft', ok: true, status: 'passed' },
        { name: 'Real ad execution readback', ok: false, status: 'needs_work' },
      ],
    });
    writeJson(bundleManifest, {
      status: 'APP_NEEDS_WORK',
      appReady: false,
      warning: 'Do not present this bundle as final READY until every gate passes.',
    });

    const result = runNode('scripts/verify-v15-non-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('README top-level delivery line is non-ready');
    expect(result.stdout).toContain('NON_READY_SAFETY verified');
  });

  it('ignores newer smoke final-readiness files when selecting default evidence', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-non-ready-smoke-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-01.json');
    const smokeReadiness = path.join(evidenceDir, `final-readiness-smoke-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-smoke-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');

    try {
      writeReadme(readme);
      writeJson(evidenceManifest, { kind: 'v15-final-readiness-evidence-manifest', evidence: {} });
      writeJson(finalReadiness, {
        status: 'APP_NEEDS_WORK',
        appReady: false,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: false, status: 'needs_work' },
        ],
      });
      writeJson(smokeReadiness, {
        status: 'APP_READY',
        appReady: true,
        evidenceSelection: { mode: 'smoke' },
        gates: [],
      });
      writeJson(bundleManifest, {
        status: 'APP_NEEDS_WORK',
        appReady: false,
        warning: 'Do not present this bundle as final READY until every gate passes.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, smokeReadiness]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
    }
  });

  it('selects timestamp-named final-readiness evidence by default without selecting smoke artifacts', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-timestamp-default-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, `final-readiness-${runId}.json`);
    const smokeReadiness = path.join(evidenceDir, `final-readiness-smoke-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-timestamp-default-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');

    try {
      writeReadme(readme);
      writeJson(evidenceManifest, { kind: 'v15-final-readiness-evidence-manifest', evidence: {} });
      writeJson(finalReadiness, {
        status: 'APP_NEEDS_WORK',
        appReady: false,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: false, status: 'needs_work' },
        ],
      });
      writeJson(smokeReadiness, {
        status: 'APP_READY',
        appReady: true,
        evidenceSelection: { mode: 'smoke' },
        gates: [],
      });
      writeJson(bundleManifest, {
        status: 'APP_NEEDS_WORK',
        appReady: false,
        warning: 'Do not present this bundle as final READY until every gate passes.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('final readiness status remains APP_NEEDS_WORK');
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, smokeReadiness]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
    }
  });

  it('treats default historical APP_READY evidence as baseline only when README is IN_PROGRESS', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-historical-ready-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-02.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-historical-ready-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-historical-ready-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-history-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('historical APP_READY final readiness is baseline only');
      expect(result.stdout).toContain('historical APP_READY delivery bundle is baseline only');
      expect(result.stdout).toContain('README top-level delivery line is non-ready');

      const otherDbPath = writeAdReadbackAuthorityDb(
        path.join(fixtureDir, 'other-authority-db'),
        JSON.parse(fs.readFileSync(adReadback, 'utf8')),
      );
      const mismatch = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--readme', readme,
        '--db', otherDbPath,
      ]);
      expect(mismatch.status).not.toBe(0);
      expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when package hash evidence is missing', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-historical-no-package-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-05.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-historical-no-package-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-historical-no-package-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-no-package-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
        ],
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--package-launch-smoke', path.join(path.dirname(finalReadiness), 'missing-package-launch-smoke.json'),
        '--readme', readme,
      ]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('historical APP_READY baseline has current package hash or launch smoke evidence');
      expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('accepts a historical APP_READY baseline when current package launch smoke supersedes stale package hashes', () => {
    const runId = Date.now();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-safety-package-smoke-'));
    const evidenceManifest = path.join(dir, `v15-final-readiness-evidence-manifest-package-smoke-${runId}.json`);
    const finalReadiness = path.join(dir, 'final-readiness.json');
    const packageSmoke = path.join(dir, 'package-launch-smoke.json');
    const adReadback = path.join(dir, `real-ad-execution-readback-package-smoke-${runId}.json`);
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = writeReadme(path.join(dir, 'README.md'));

    try {
      const dbPath = writeValidReadbackWithDb(dir, adReadback);
      writeJson(packageSmoke, validPackageLaunchSmoke(path.join(dir, 'release')));
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex: {
          present: true,
          count: 1,
          existingCount: 1,
          missingCount: 0,
          packages: [
            {
              kind: 'installer',
              sourcePath: path.join(dir, 'old-installer.exe'),
              fileName: 'old-installer.exe',
              exists: true,
              sizeBytes: 123,
              sha256: '0'.repeat(64),
            },
          ],
        },
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', [
        '--final-readiness', finalReadiness,
        '--bundle-manifest', bundleManifest,
        '--package-launch-smoke', packageSmoke,
        '--readme', readme,
      ]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('historical APP_READY baseline has current package hash or launch smoke evidence');
      expect(result.stdout).toContain('NON_READY_SAFETY verified');
    } finally {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when old readback evidence lacks current source report authority', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-legacy-readback-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-04.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-legacy-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-legacy-readback-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-legacy-authority-'));

    try {
      writeReadme(readme);
      const legacyReadback = createValidAdReadbackEvidence(fixtureDir);
      const dbPath = writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), legacyReadback);
      delete legacyReadback.source.sourceFiles;
      delete legacyReadback.source.sourceRow;
      writeJson(adReadback, legacyReadback);
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('NEEDS_WORK');
      expect(`${result.stdout}${result.stderr}`).toContain('historical real ad readback baseline fails current verify:ad-readback');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('rejects historical APP_READY baseline when selected readback evidence fails verify:ad-readback', () => {
    const runId = Date.now();
    const evidenceManifest = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-bad-historical-ready-${runId}.json`);
    const finalReadiness = path.join(evidenceDir, 'final-readiness-2099-01-03.json');
    const adReadback = path.join(evidenceDir, `real-ad-execution-readback-bad-historical-ready-${runId}.json`);
    const bundleDir = path.join(bundleRoot, `v15-non-ready-safety-bad-historical-ready-${runId}`);
    const bundleManifest = path.join(bundleDir, 'delivery-bundle-manifest.json');
    const readme = path.join(bundleDir, 'README.md');
    const packageIndex = finalPackageIndex(path.dirname(finalReadiness));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-non-ready-bad-authority-'));

    try {
      writeReadme(readme);
      const dbPath = writeValidReadbackWithDb(fixtureDir, adReadback);
      writeJson(adReadback, { kind: 'real-ad-execution-readback', status: 'PASS', readback: { verified: true } });
      writeJson(evidenceManifest, {
        kind: 'v15-final-readiness-evidence-manifest',
        evidence: {
          adReadback: {
            exists: true,
            absolutePath: adReadback,
          },
        },
      });
      writeJson(finalReadiness, {
        status: 'APP_READY',
        appReady: true,
        reportCollectionReady: true,
        listingReadReady: true,
        evidenceSelection: {
          mode: 'manifest',
          manifestPath: evidenceManifest,
          authorityDbPath: dbPath,
        },
        gates: [
          { name: 'AI live provider', ok: true, status: 'passed' },
          { name: 'Ad recommendation AI explanation', ok: true, status: 'passed' },
          { name: 'Listing AI draft', ok: true, status: 'passed' },
          { name: 'Real ad execution readback', ok: true, status: 'passed', evidencePath: adReadback },
          { name: 'Release package hash', ok: true, status: 'passed' },
        ],
        packageIndex,
      });
      writeJson(bundleManifest, {
        status: 'APP_READY',
        appReady: true,
        warning: 'APP_READY evidence bundle.',
      });

      const result = runNode('scripts/verify-v15-non-ready-safety.js', ['--readme', readme]);

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain('historical real ad readback baseline fails current verify:ad-readback');
    } finally {
      for (const filePath of [evidenceManifest, finalReadiness, adReadback]) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      }
      if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
