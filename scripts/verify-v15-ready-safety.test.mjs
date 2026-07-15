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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writePng(filePath) {
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return filePath;
}

function writeReport(filePath) {
  fs.writeFileSync(filePath, 'placeholder report file for READY safety verifier\n', 'utf8');
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
    releaseDir: dir,
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

function bundlePackageIndex(bundleManifestPath, finalIndex) {
  const bundleJson = 'evidence/release-package-index.json';
  writeJson(path.join(path.dirname(bundleManifestPath), bundleJson), {
    generatedAt: '2026-06-10T00:00:00.000Z',
    releaseDir: finalIndex.releaseDir,
    copyPolicy: 'Installer and portable EXE binaries are not copied into the delivery bundle.',
    packages: finalIndex.packages,
  });
  return {
    present: true,
    count: finalIndex.packages.length,
    existingCount: finalIndex.packages.filter((item) => item.exists).length,
    missingCount: 0,
    bundleJson,
  };
}

function packageLaunchSmokeFromIndex(dir, finalIndex) {
  const unpackedContent = 'unpacked app fixture\n';
  const unpackedPath = path.join(dir, 'win-unpacked', 'AmazonAIOpsAgent.exe');
  const evidencePath = path.join(dir, 'package-launch-smoke.json');
  fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
  fs.writeFileSync(unpackedPath, unpackedContent, 'utf8');
  const portable = finalIndex.packages.find((item) => item.kind === 'portable');
  const smoke = {
    present: true,
    evidencePath,
    passed: true,
    artifacts: {
      unpacked: {
        path: unpackedPath,
        sizeBytes: Buffer.byteLength(unpackedContent, 'utf8'),
        sha256: sha256Text(unpackedContent),
      },
      portable: portable ? {
        path: portable.sourcePath,
        sizeBytes: portable.sizeBytes,
        sha256: portable.sha256,
      } : null,
    },
    checks: [
      { kind: 'win-unpacked', ok: true, marker: '[App] ipc-ready' },
      { kind: 'portable', ok: true, appChildCount: 1 },
    ],
  };
  writeJson(evidencePath, { kind: 'package-launch-smoke', ...smoke });
  return smoke;
}

function writeBundleReadme(bundleManifestPath, status = 'APP_READY') {
  const readmePath = path.join(path.dirname(bundleManifestPath), 'docs', 'README.md');
  fs.mkdirSync(path.dirname(readmePath), { recursive: true });
  fs.writeFileSync(readmePath, `**DELIVERY: ${status}.** bundle README fixture.\n`, 'utf8');
  return readmePath;
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

function writeValidReadbackWithDb(dir, evidencePath) {
  const evidence = createValidAdReadbackEvidence(dir);
  writeJson(evidencePath, evidence);
  return writeAdReadbackAuthorityDb(path.join(dir, 'authority-db'), evidence);
}

describe('verify v15 ready safety', () => {
  it('accepts current business UI smoke summaries without requiring raw APP_READY in operator UI evidence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);

    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Report collection', ok: true },
        { name: 'AI live provider', ok: true },
        { name: 'Real ad execution readback', ok: true },
        { name: 'Release package hash', ok: true, status: 'passed' },
        { name: 'Package launch smoke', ok: true, status: 'passed' },
      ],
      packageIndex,
      packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
      kind: 'current-business-ui-smoke-summary',
      passed: true,
      scripts: [
        { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
        { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
        { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
        { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
        { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
      ],
    });
    writeJson(bundleManifest, {
      status: 'APP_READY',
      appReady: true,
      authorityDatabase: {
        sourcePath: dbPath,
        copied: false,
      },
      files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
      dataReconciliation: {
        present: true,
        bundleJson: 'evidence/data.json',
        bundleMarkdown: 'evidence/data.md',
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87 },
        blockers: [],
      },
      realReportIndex: {
        present: true,
        count: 1,
        existingCount: 1,
        missingCount: 0,
        bundleJson: 'evidence/real-report-file-index.json',
      },
      packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');

    const result = runNode('scripts/verify-v15-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--ui-smoke', smoke,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('current business UI smoke summary passed');
    expect(result.stdout).toContain('V15_READY_SAFETY verified');
    expect(result.stderr).not.toContain('UI smoke contains APP_READY state');

    const otherDbPath = writeAdReadbackAuthorityDb(
      path.join(dir, 'other-authority-db'),
      readJson(adReadback),
    );
    const mismatch = runNode('scripts/verify-v15-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--ui-smoke', smoke,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
      '--db', otherDbPath,
    ]);
    expect(mismatch.status).not.toBe(0);
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
  });

  it('rejects APP_READY evidence when the delivery bundle README still says IN_PROGRESS', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-bundle-readme-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);

    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
      },
      gates: [
        { name: 'Report collection', ok: true },
        { name: 'AI live provider', ok: true },
        { name: 'Real ad execution readback', ok: true },
        { name: 'Release package hash', ok: true, status: 'passed' },
        { name: 'Package launch smoke', ok: true, status: 'passed' },
      ],
      packageIndex,
      packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
      kind: 'current-business-ui-smoke-summary',
      passed: true,
      scripts: [
        { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
        { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
        { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
        { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
        { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
      ],
    });
    writeJson(bundleManifest, {
      status: 'APP_READY',
      appReady: true,
      files: [{ label: 'scripts/verify-v15-ready-safety.js' }, { label: 'README.md', bundlePath: 'docs/README.md' }],
      dataReconciliation: {
        present: true,
        bundleJson: 'evidence/data.json',
        bundleMarkdown: 'evidence/data.md',
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87 },
        blockers: [],
      },
      realReportIndex: {
        present: true,
        count: 1,
        existingCount: 1,
        missingCount: 0,
        bundleJson: 'evidence/real-report-file-index.json',
      },
      packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
    });
    writeBundleReadme(bundleManifest, 'IN_PROGRESS');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');

    const result = runNode('scripts/verify-v15-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--ui-smoke', smoke,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
      '--db', dbPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('delivery bundle README states APP_READY');
  });

  it('rejects APP_READY evidence when the selected readback file does not pass the readback verifier', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-bad-readback-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);

    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      gates: [
        { name: 'Report collection', ok: true },
        { name: 'AI live provider', ok: true },
        { name: 'Real ad execution readback', ok: true },
        { name: 'Release package hash', ok: true, status: 'passed' },
        { name: 'Package launch smoke', ok: true, status: 'passed' },
      ],
      packageIndex,
      packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
      kind: 'current-business-ui-smoke-summary',
      passed: true,
      scripts: [
        { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
        { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
        { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
        { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
        { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
      ],
    });
    writeJson(bundleManifest, {
      status: 'APP_READY',
      appReady: true,
      files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
      dataReconciliation: {
        present: true,
        bundleJson: 'evidence/data.json',
        bundleMarkdown: 'evidence/data.md',
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87 },
        blockers: [],
      },
      realReportIndex: {
        present: true,
        count: 1,
        existingCount: 1,
        missingCount: 0,
        bundleJson: 'evidence/real-report-file-index.json',
      },
      packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');

    const result = runNode('scripts/verify-v15-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--ui-smoke', smoke,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
      '--db', dbPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('selected ad readback evidence passes verify:ad-readback');
  });

  it('rejects APP_READY evidence when the delivery bundle real report index has missing source files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-missing-report-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);

    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
      },
      gates: [
        { name: 'Report collection', ok: true },
        { name: 'AI live provider', ok: true },
        { name: 'Real ad execution readback', ok: true },
        { name: 'Release package hash', ok: true, status: 'passed' },
        { name: 'Package launch smoke', ok: true, status: 'passed' },
      ],
      packageIndex,
      packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
      kind: 'current-business-ui-smoke-summary',
      passed: true,
      scripts: [
        { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
        { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
        { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
        { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
        { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
      ],
    });
    writeJson(bundleManifest, {
      status: 'APP_READY',
      appReady: true,
      files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
      dataReconciliation: {
        present: true,
        bundleJson: 'evidence/data.json',
        bundleMarkdown: 'evidence/data.md',
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87 },
        blockers: [],
      },
      realReportIndex: {
        present: true,
        count: 2,
        existingCount: 1,
        missingCount: 1,
        bundleJson: 'evidence/real-report-file-index.json',
      },
      packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');

    const result = runNode('scripts/verify-v15-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--ui-smoke', smoke,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
      '--db', dbPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('delivery bundle real report index has no missing source reports');
  });

  it('rejects APP_READY evidence when package hash evidence is missing from readiness and bundle manifests', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-missing-package-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');

    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
      },
      gates: [
        { name: 'Report collection', ok: true },
        { name: 'AI live provider', ok: true },
        { name: 'Real ad execution readback', ok: true },
        { name: 'Release package hash', ok: true, status: 'passed' },
        { name: 'Package launch smoke', ok: true, status: 'passed' },
      ],
    });
    writeJson(smoke, {
      kind: 'current-business-ui-smoke-summary',
      passed: true,
      scripts: [
        { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
        { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
        { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
        { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
        { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
      ],
    });
    writeJson(bundleManifest, {
      status: 'APP_READY',
      appReady: true,
      files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
      dataReconciliation: {
        present: true,
        bundleJson: 'evidence/data.json',
        bundleMarkdown: 'evidence/data.md',
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87 },
        blockers: [],
      },
      realReportIndex: {
        present: true,
        count: 1,
        existingCount: 1,
        missingCount: 0,
        bundleJson: 'evidence/real-report-file-index.json',
      },
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');

    const result = runNode('scripts/verify-v15-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--ui-smoke', smoke,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
      '--db', dbPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness records package hash evidence');
    expect(`${result.stdout}${result.stderr}`).toContain('delivery bundle includes package hash index');
  });

  it('rejects APP_READY evidence when the delivery bundle package index file is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-missing-package-file-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);

    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
      },
      gates: [
        { name: 'Report collection', ok: true },
        { name: 'AI live provider', ok: true },
        { name: 'Real ad execution readback', ok: true },
        { name: 'Release package hash', ok: true, status: 'passed' },
        { name: 'Package launch smoke', ok: true, status: 'passed' },
      ],
      packageIndex,
      packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
      kind: 'current-business-ui-smoke-summary',
      passed: true,
      scripts: [
        { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
        { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
        { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
        { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
        { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
      ],
    });
    writeJson(bundleManifest, {
      status: 'APP_READY',
      appReady: true,
      files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
      dataReconciliation: {
        present: true,
        bundleJson: 'evidence/data.json',
        bundleMarkdown: 'evidence/data.md',
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87 },
        blockers: [],
      },
      realReportIndex: {
        present: true,
        count: 1,
        existingCount: 1,
        missingCount: 0,
        bundleJson: 'evidence/real-report-file-index.json',
      },
      packageIndex: {
        present: true,
        count: 2,
        existingCount: 2,
        missingCount: 0,
        bundleJson: 'evidence/release-package-index.json',
      },
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');

    const result = runNode('scripts/verify-v15-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--ui-smoke', smoke,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
      '--db', dbPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('delivery bundle package index file is valid');
  });

  it('rejects APP_READY evidence when final readiness package hashes do not match local files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v15-ready-safety-package-hash-mismatch-'));
    const evidenceManifest = path.join(dir, 'evidence-manifest.json');
    const adReadback = path.join(dir, 'ad-readback.json');
    const finalReadiness = path.join(dir, 'final-readiness-2099-01-01.json');
    const smoke = path.join(dir, 'current-business-ui-smoke.json');
    const bundleManifest = path.join(dir, 'delivery-bundle-manifest.json');
    const readme = path.join(dir, 'README.md');
    const packageIndex = finalPackageIndex(dir);
    packageIndex.packages[0].sha256 = 'C'.repeat(64);

    const dbPath = writeValidReadbackWithDb(dir, adReadback);
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
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
      },
      gates: [
        { name: 'Report collection', ok: true },
        { name: 'AI live provider', ok: true },
        { name: 'Real ad execution readback', ok: true },
        { name: 'Release package hash', ok: true, status: 'passed' },
        { name: 'Package launch smoke', ok: true, status: 'passed' },
      ],
      packageIndex,
      packageLaunchSmoke: packageLaunchSmokeFromIndex(dir, packageIndex),
    });
    writeJson(smoke, {
      kind: 'current-business-ui-smoke-summary',
      passed: true,
      scripts: [
        { script: 'scripts/smoke-business-ui-shell.js', status: 0 },
        { script: 'scripts/smoke-business-ui-data-pipeline.js', status: 0 },
        { script: 'scripts/smoke-business-ui-ad-execution.js', status: 0 },
        { script: 'scripts/smoke-business-ui-keyword-listing.js', status: 0 },
        { script: 'scripts/smoke-business-ui-settings-delivery.js', status: 0 },
      ],
    });
    writeJson(bundleManifest, {
      status: 'APP_READY',
      appReady: true,
      files: [{ label: 'scripts/verify-v15-ready-safety.js' }],
      dataReconciliation: {
        present: true,
        bundleJson: 'evidence/data.json',
        bundleMarkdown: 'evidence/data.md',
        canonicalSource: 'user_search_term',
        canonical: { spend: 617.87 },
        blockers: [],
      },
      realReportIndex: {
        present: true,
        count: 1,
        existingCount: 1,
        missingCount: 0,
        bundleJson: 'evidence/real-report-file-index.json',
      },
      packageIndex: bundlePackageIndex(bundleManifest, packageIndex),
    });
    writeBundleReadme(bundleManifest, 'APP_READY');
    fs.writeFileSync(readme, '**DELIVERY: APP_READY.** refreshed current evidence.\n', 'utf8');

    const result = runNode('scripts/verify-v15-ready-safety.js', [
      '--final-readiness', finalReadiness,
      '--ui-smoke', smoke,
      '--bundle-manifest', bundleManifest,
      '--readme', readme,
      '--db', dbPath,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness records package hash evidence');
  });
});
