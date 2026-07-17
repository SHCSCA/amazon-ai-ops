import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';
import {
  createValidAdReadbackEvidence,
  writeAdReadbackAuthorityDb,
} from './ad-readback-authority-db.test-fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

const cleanupPaths = [];

function runNode(script, args = []) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  cleanupPaths.push(filePath);
}

function writeValidReadbackWithDb(runDir, evidencePath) {
  const evidence = createValidAdReadbackEvidence(runDir);
  writeJson(evidencePath, evidence);
  return writeAdReadbackAuthorityDb(path.join(runDir, 'authority-db'), evidence);
}

function writeAuthorityDbForInvalidReadback(runDir) {
  const fixtureDir = path.join(runDir, 'authority-fixture');
  const evidence = createValidAdReadbackEvidence(fixtureDir);
  return writeAdReadbackAuthorityDb(path.join(fixtureDir, 'authority-db'), evidence);
}

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(path.basename(filePath), 'utf8'),
  ]));
  cleanupPaths.push(filePath);
  return filePath;
}

function writeReport(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'placeholder report file for delivery bundle verifier\n', 'utf8');
  cleanupPaths.push(filePath);
  return filePath;
}

function writeReleaseFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  cleanupPaths.push(filePath);
  return filePath;
}

function writeReadme(filePath, status = 'APP_READY') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    [
      '# Amazon AI Ops',
      '',
      `**DELIVERY: ${status}.** Test delivery status line.`,
      '',
    ].join('\n'),
    'utf8',
  );
  cleanupPaths.push(filePath);
  return filePath;
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
  cleanupPaths.push(filePath);
  return filePath;
}

function writeNonReadyFinalReadiness(runDir) {
  const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
  const finalReadiness = path.join(runDir, 'final-readiness.json');
  writeJson(evidenceManifest, {
    kind: 'v15-final-readiness-evidence-manifest',
    evidence: {},
  });
  writeJson(finalReadiness, {
    status: 'APP_NEEDS_WORK',
    appReady: false,
    evidenceSelection: {
      mode: 'manifest',
      manifestPath: evidenceManifest,
    },
    gates: [],
  });
  return { evidenceManifest, finalReadiness };
}

function sha256Text(content) {
  return crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex').toUpperCase();
}

function packageIndexFromArtifacts(artifacts) {
  return {
    present: artifacts.length > 0,
    count: artifacts.length,
    existingCount: artifacts.length,
    missingCount: 0,
    packages: artifacts.map((artifact) => ({
      kind: artifact.kind,
      sourcePath: artifact.filePath,
      fileName: path.basename(artifact.filePath),
      exists: true,
      sizeBytes: Buffer.byteLength(artifact.content, 'utf8'),
      sha256: sha256Text(artifact.content),
    })),
  };
}

function validReadbackEvidence(runDir) {
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
      entityType: 'keyword',
      entityId: 'keyword-123',
      entityName: 'close match',
      identityProofPath: writePng(path.join(runDir, 'target-identity.png')),
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
      screenshotPath: writePng(path.join(runDir, 'before.png')),
      liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
    },
    after: {
      value: '2.16',
      capturedAt: now,
      screenshotPath: writePng(path.join(runDir, 'after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: now,
      actualValue: '2.16',
      evidencePath: writePng(path.join(runDir, 'readback.png')),
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
      sourceFiles: [writeReport(path.join(runDir, 'user-search-term.xlsx'))],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'search_term',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
  };
}

describe('export v15 delivery bundle', () => {
  afterEach(() => {
    for (const cleanupPath of cleanupPaths.splice(0).reverse()) {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
  });

  it('refuses APP_READY bundle export when manifest-selected readback evidence fails verify:ad-readback', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-readback-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const badReadback = path.join(runDir, 'real-ad-execution-readback-bad.json');
    const outDir = path.join(runDir, 'bundle');
    const dbPath = writeAuthorityDbForInvalidReadback(runDir);

    writeJson(badReadback, {
      kind: 'real-ad-execution-readback',
      status: 'PASS',
      readback: { verified: true },
    });
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: badReadback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: badReadback },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('verify:ad-readback');
  });

  it('refuses APP_READY bundle export when data reconciliation references missing real report files', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-missing-report-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const installerContent = 'installer artifact for missing report test\n';
    const portableContent = 'portable artifact for missing report test\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const packageUiScreenshot = path.join(runDir, 'package-ui.png');
    const workspaceUiScreenshot = path.join(runDir, 'workspace-ui.png');
    const workspaceTargetJson = path.join(runDir, 'workspace-target.json');
    fs.writeFileSync(packageUiScreenshot, 'package ui screenshot');
    fs.writeFileSync(workspaceUiScreenshot, 'workspace ui screenshot');
    writeJson(workspaceTargetJson, { passed: true });
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    writeJson(packageUiManifest, {
      passed: true,
      runs: [{
        screenshots: [{ path: packageUiScreenshot }],
        overlayChecks: [{ screenshot: { path: packageUiScreenshot } }],
      }],
    });
    writeJson(workspaceUiManifest, {
      passed: true,
      targets: [{
        screenshot: { path: workspaceUiScreenshot },
        jsonPath: workspaceTargetJson,
      }],
    });
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Release package hash', ok: true, status: 'passed' },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [
        {
          reportType: 'user_search_term',
          filePath: path.join(runDir, 'missing-user-search-term.xlsx'),
        },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--package-ui-manifest', packageUiManifest,
      '--workspace-ui-manifest', workspaceUiManifest,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('real report index has missing source reports');
  });

  it('refuses APP_READY bundle export when data reconciliation reports blockers', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-data-blocker-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
      ],
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: ['user_search_term report is missing required metric columns: spend, orders, sales.'],
      reportFiles: [
        {
          reportType: 'user_search_term',
          filePath: reportPath,
        },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('data reconciliation has blockers');
  });

  it('refuses APP_READY bundle export when data reconciliation has no positive canonical ad spend', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-zero-spend-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
      ],
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 0, orders: 0, sales: 0 },
      blockers: [],
      reportFiles: [
        {
          reportType: 'user_search_term',
          filePath: reportPath,
        },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('positive canonical ad spend');
  });

  it('records installer and portable exe hashes in APP_READY delivery bundle without copying binaries', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-package-index-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for package index\n';
    const portableContent = 'portable artifact for package index\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const packageUiScreenshot = path.join(runDir, 'package-ui.png');
    const workspaceUiScreenshot = path.join(runDir, 'workspace-ui.png');
    const workspaceTargetJson = path.join(runDir, 'workspace-target.json');
    fs.writeFileSync(packageUiScreenshot, 'package ui screenshot');
    fs.writeFileSync(workspaceUiScreenshot, 'workspace ui screenshot');
    writeJson(workspaceTargetJson, { passed: true });
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    writeJson(packageUiManifest, {
      passed: true,
      runs: [{
        screenshots: [{ path: packageUiScreenshot }],
        overlayChecks: [{ screenshot: { path: packageUiScreenshot } }],
      }],
    });
    writeJson(workspaceUiManifest, {
      passed: true,
      targets: [{
        screenshot: { path: workspaceUiScreenshot },
        jsonPath: workspaceTargetJson,
      }],
    });
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Release package hash', ok: true, status: 'passed', evidencePath: releaseDir },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--package-ui-manifest', packageUiManifest,
      '--workspace-ui-manifest', workspaceUiManifest,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.packageIndex).toMatchObject({
      present: true,
      count: 2,
      existingCount: 2,
      missingCount: 0,
      copyPolicy: expect.stringContaining('not copied'),
    });
    expect(manifest.missing).not.toContainEqual({
      label: 'evidence:release',
      sourcePath: releaseDir,
    });
    expect(manifest.packageIndex.bundleJson).toBeTruthy();
    expect(manifest.authorityDatabase).toMatchObject({
      sourcePath: fs.realpathSync.native(dbPath),
      existsAtExport: true,
      copied: false,
    });
    const packageIndex = JSON.parse(fs.readFileSync(path.join(outDir, manifest.packageIndex.bundleJson), 'utf8'));
    expect(packageIndex.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'installer',
        sourcePath: installerPath,
        sha256: sha256Text(installerContent),
      }),
      expect.objectContaining({
        kind: 'portable',
        sourcePath: portablePath,
        sha256: sha256Text(portableContent),
      }),
    ]));
    for (const file of manifest.files) {
      expect(file.bundlePath).not.toMatch(/\.exe$/i);
      expect(file.bundlePath).not.toMatch(/\.db$/i);
    }
    const bundledReadme = fs.readFileSync(path.join(outDir, 'docs', 'README.md'), 'utf8');
    expect(bundledReadme).toContain('**DELIVERY: APP_READY.');
    expect(manifest.files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'AGENTS.md' }),
    ]));
    expect(fs.existsSync(path.join(outDir, 'docs', 'AGENTS.md'))).toBe(false);
    expect(manifest.uiEvidence).toMatchObject({
      packageUiManifest: { sourcePath: packageUiManifest, present: true },
      workspaceUiManifest: { sourcePath: workspaceUiManifest, present: true },
    });
    expect(manifest.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: packageUiManifest }),
      expect.objectContaining({ sourcePath: packageUiScreenshot }),
      expect.objectContaining({ sourcePath: workspaceUiManifest }),
      expect.objectContaining({ sourcePath: workspaceUiScreenshot }),
      expect.objectContaining({ sourcePath: workspaceTargetJson }),
    ]));

    const otherDbPath = writeAdReadbackAuthorityDb(
      path.join(runDir, 'other-authority-db'),
      JSON.parse(fs.readFileSync(readback, 'utf8')),
    );
    const mismatch = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--db', otherDbPath,
      '--skip-latest-extras', 'true',
      '--out', path.join(runDir, 'mismatch-bundle'),
    ]);
    expect(mismatch.status).not.toBe(0);
    expect(`${mismatch.stdout}${mismatch.stderr}`).toContain('SQLite authority database mismatch');
  });

  it('does not treat basename text or UI smoke mock source files as real report index entries', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-report-index-noise-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const uiSmoke = path.join(runDir, `business-ui-ad-execution-smoke-${runId}.json`);
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for report-index noise test\n';
    const portableContent = 'portable artifact for report-index noise test\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(uiSmoke, {
      kind: 'business-ui-ad-execution-smoke',
      actionLog: [
        {
          input: {
            decision: {
              sourceFiles: ['C:/reports/mock-user-search-term.xlsx'],
              sourceRow: 12,
            },
          },
        },
      ],
    });
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Business UI smoke', ok: true, evidencePath: uiSmoke },
        { name: 'Release package hash', ok: true, status: 'passed' },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
      filenameDateRangeAnalyses: [
        {
          basename: 'AAO_20260601_20260612_search_term.xlsx',
          analysis: { filename: 'AAO_20260601_20260612_search_term.xlsx' },
        },
      ],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.realReportIndex).toMatchObject({
      present: true,
      count: 2,
      existingCount: 2,
      missingCount: 0,
    });
    const realReportIndex = JSON.parse(fs.readFileSync(path.join(outDir, manifest.realReportIndex.bundleJson), 'utf8'));
    const sourcePaths = realReportIndex.reports.map((item) => item.sourcePath);
    expect(sourcePaths).toContain(reportPath);
    expect(sourcePaths).toContain(path.join(runDir, 'keyword.xlsx'));
    expect(sourcePaths).not.toContain(path.resolve('C:/reports/mock-user-search-term.xlsx'));
    expect(sourcePaths).not.toContain(path.resolve('AAO_20260601_20260612_search_term.xlsx'));
  });

  it('refuses APP_READY bundle export when README delivery line is not APP_READY', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-non-ready-readme-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const nonReadyReadme = writeReadme(path.join(runDir, 'README.md'), 'IN_PROGRESS');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact for readme gate\n';
    const portableContent = 'portable artifact for readme gate\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const portablePath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), portableContent);
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Release package hash', ok: true, status: 'passed' },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', nonReadyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('README delivery line is not APP_READY');
  });

  it('refuses APP_READY bundle export when final readiness lacks package hash gate evidence', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-stale-final-package-gate-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), 'installer artifact\n');
    writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0-portable.exe'), 'portable artifact\n');

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
      ],
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('final readiness package hash gate evidence is missing');
  });

  it('refuses APP_READY bundle export when portable no-install exe hash evidence is missing', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-missing-portable-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const readback = path.join(runDir, 'real-ad-execution-readback.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const releaseDir = path.join(runDir, 'release');
    const outDir = path.join(runDir, 'bundle');
    const readyReadme = writeReadme(path.join(runDir, 'README.md'), 'APP_READY');
    const reportPath = writeReport(path.join(runDir, 'user-search-term.xlsx'));
    const installerContent = 'installer artifact only\n';
    const installerPath = writeReleaseFile(path.join(releaseDir, 'AmazonAIOpsAgent-1.5.0.exe'), installerContent);
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
    ]);

    const dbPath = writeValidReadbackWithDb(runDir, readback);
    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {
        adReadback: {
          exists: true,
          absolutePath: readback,
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
        { name: 'Real ad execution readback', ok: true, evidencePath: readback },
        { name: 'Release package hash', ok: true, status: 'passed' },
      ],
      packageIndex: releasePackageIndex,
    });
    writeJson(dataReconciliation, {
      canonicalSource: 'user_search_term',
      canonical: { spend: 617.87, orders: 3, sales: 1182.34 },
      blockers: [],
      reportFiles: [{ reportType: 'user_search_term', filePath: reportPath }],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--release-dir', releaseDir,
      '--readme', readyReadme,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('portable no-install package hash evidence is missing');
  });

  it('excludes smoke and test fixture reconciliation files from default discovery', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-reconciliation-discovery-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');
    const releaseDir = path.join(runDir, 'release');
    const productionJson = path.join(evidenceDir, `data-reconciliation-live-${runId}.json`);
    const productionMarkdown = path.join(evidenceDir, `data-reconciliation-live-${runId}.md`);
    const smokeJson = path.join(evidenceDir, `data-reconciliation-export-bundle-smoke-${runId}.json`);
    const smokeMarkdown = path.join(evidenceDir, `data-reconciliation-export-bundle-smoke-${runId}.md`);
    const fixtureJson = path.join(evidenceDir, `data-reconciliation-test-fixture-${runId}.json`);
    const fixtureMarkdown = path.join(evidenceDir, `data-reconciliation-test-fixture-${runId}.md`);

    writeJson(productionJson, {
      canonicalSource: 'current-live-scope',
      canonical: { spend: 125.5 },
      blockers: [],
    });
    writeText(productionMarkdown, '# Current live reconciliation\n');
    writeJson(smokeJson, {
      canonicalSource: 'smoke-fixture',
      canonical: { spend: 999 },
      blockers: [],
    });
    writeText(smokeMarkdown, '# Smoke fixture\n');
    writeJson(fixtureJson, {
      canonicalSource: 'test-fixture',
      canonical: { spend: 888 },
      blockers: [],
    });
    writeText(fixtureMarkdown, '# Test fixture\n');

    const productionTime = new Date('2099-01-01T00:00:00.000Z');
    const smokeTime = new Date('2099-01-02T00:00:00.000Z');
    const fixtureTime = new Date('2099-01-03T00:00:00.000Z');
    for (const filePath of [productionJson, productionMarkdown]) fs.utimesSync(filePath, productionTime, productionTime);
    for (const filePath of [smokeJson, smokeMarkdown]) fs.utimesSync(filePath, smokeTime, smokeTime);
    for (const filePath of [fixtureJson, fixtureMarkdown]) fs.utimesSync(filePath, fixtureTime, fixtureTime);

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--release-dir', releaseDir,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.dataReconciliation).toMatchObject({
      sourceJsonPath: productionJson,
      sourceMarkdownPath: productionMarkdown,
      canonicalSource: 'current-live-scope',
    });
  });

  it('does not pair an explicit reconciliation JSON with an unrelated latest Markdown', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-explicit-reconciliation-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');
    const releaseDir = path.join(runDir, 'release');
    const explicitJson = path.join(runDir, 'selected-reconciliation.json');
    const unrelatedMarkdown = path.join(evidenceDir, `data-reconciliation-unrelated-${runId}.md`);

    writeJson(explicitJson, {
      canonicalSource: 'explicit-current-scope',
      canonical: { spend: 321.5 },
      blockers: [],
    });
    writeText(unrelatedMarkdown, '# Unrelated latest reconciliation\n');
    const futureTime = new Date('2099-01-04T00:00:00.000Z');
    fs.utimesSync(unrelatedMarkdown, futureTime, futureTime);

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', explicitJson,
      '--release-dir', releaseDir,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.dataReconciliation).toMatchObject({
      sourceJsonPath: explicitJson,
      sourceMarkdownPath: null,
      canonicalSource: 'explicit-current-scope',
      bundleMarkdown: null,
    });
    expect(manifest.files).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: unrelatedMarkdown }),
    ]));
  });

  it('preserves final-readiness blockers in APP_NEEDS_WORK bundle manifest', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-blocker-summary-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');
    const dbPath = path.join(runDir, 'amazon-ai-ops.db');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(dbPath, 'non-ready-authority-identity-only');

    writeJson(evidenceManifest, {
      kind: 'v15-final-readiness-evidence-manifest',
      evidence: {},
    });
    writeJson(finalReadiness, {
      status: 'APP_NEEDS_WORK',
      appReady: false,
      evidenceSelection: {
        mode: 'manifest',
        manifestPath: evidenceManifest,
        authorityDbPath: dbPath,
      },
      missing: [
        'AI 阶段判断引用的指标证据缺少产品 ASIN。',
      ],
      actionItems: [
        '补齐真实广告报表 sourceFile/sourceRow 后重新生成建议。',
      ],
      recommendationReviewReasons: [
        'AI 候选动作无法绑定当前范围内的真实广告对象。',
      ],
      gates: [
        {
          name: 'Recommendations review blockers',
          ok: false,
          status: 'needs_work',
          message: '当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。',
        },
      ],
    });
    writeJson(dataReconciliation, {
      canonicalSource: null,
      canonical: null,
      blockers: ['数据对账尚未完成。'],
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--data-reconciliation', dataReconciliation,
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.appReady).toBe(false);
    expect(manifest.authorityDatabase).toMatchObject({
      sourcePath: fs.realpathSync.native(dbPath),
      existsAtExport: true,
      copied: false,
    });
    expect(manifest.finalReadinessBlockers).toEqual(expect.arrayContaining([
      'AI 阶段判断引用的指标证据缺少产品 ASIN。',
      '补齐真实广告报表 sourceFile/sourceRow 后重新生成建议。',
      'AI 候选动作无法绑定当前范围内的真实广告对象。',
      'Recommendations review blockers: 当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。',
    ]));
  });

  it('always bundles the manifest selected by final readiness when latest extras are skipped', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-selected-manifest-${runId}`);
    cleanupPaths.push(runDir);
    const { evidenceManifest, finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const outDir = path.join(runDir, 'bundle');

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    const selectedManifestFile = manifest.files.find((file) => file.sourcePath === evidenceManifest);
    expect(selectedManifestFile).toBeTruthy();
    expect(JSON.parse(fs.readFileSync(path.join(outDir, selectedManifestFile.bundlePath), 'utf8'))).toMatchObject({
      kind: 'v15-final-readiness-evidence-manifest',
    });
  });

  it('bundles explicitly selected workspace, business smoke, and full-test evidence when latest extras are skipped', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-explicit-source-evidence-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const workspaceUiManifest = path.join(runDir, 'workspace-ui-manifest.json');
    const businessUiSmoke = path.join(runDir, 'current-business-ui-smoke.json');
    const fullTestEvidence = path.join(runDir, 'full-vitest.json');
    const outDir = path.join(runDir, 'bundle');
    writeJson(workspaceUiManifest, { kind: 'workspace-ui-evidence', passed: true, targets: [] });
    writeJson(businessUiSmoke, { kind: 'current-business-ui-smoke-summary', passed: true, scripts: [] });
    writeJson(fullTestEvidence, { kind: 'vitest-json-report', success: true, numPassedTests: 1882 });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--workspace-ui-manifest', workspaceUiManifest,
      '--business-ui-smoke', businessUiSmoke,
      '--full-test-evidence', fullTestEvidence,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.uiEvidence.workspaceUiManifest).toMatchObject({ sourcePath: workspaceUiManifest, present: true });
    expect(manifest.sourceEvidence).toMatchObject({
      businessUiSmoke: { sourcePath: businessUiSmoke, present: true },
      fullTestEvidence: { sourcePath: fullTestEvidence, present: true },
    });
    for (const sourcePath of [workspaceUiManifest, businessUiSmoke, fullTestEvidence]) {
      const copied = manifest.files.find((file) => file.sourcePath === sourcePath);
      expect(copied).toBeTruthy();
      expect(fs.existsSync(path.join(outDir, copied.bundlePath))).toBe(true);
    }
  });

  it('bundles regular and wide object-inspector screenshots referenced by explicit package UI evidence', () => {
    const runId = `${Date.now()}-${process.pid}`;
    const runDir = path.join(evidenceDir, `export-bundle-package-ui-wide-${runId}`);
    cleanupPaths.push(runDir);
    const { finalReadiness } = writeNonReadyFinalReadiness(runDir);
    const packageUiManifest = path.join(runDir, 'package-ui-manifest.json');
    const regularInspector = writePng(path.join(runDir, 'regular-product-inspector.png'));
    const wideWorkspace = writePng(path.join(runDir, 'wide-diagnosis.png'));
    const wideInspector = writePng(path.join(runDir, 'wide-diagnosis-inspector.png'));
    const outDir = path.join(runDir, 'bundle');
    writeJson(packageUiManifest, {
      kind: 'package-ui-evidence',
      runs: [{ workspaceChecks: [{ inspectorEvidence: { screenshot: { path: regularInspector } } }] }],
      wideProfile: {
        screenshots: [{ path: wideWorkspace }],
        workspaceChecks: [{ inspectorEvidence: { screenshot: { path: wideInspector } } }],
      },
    });

    const result = runNode('scripts/export-v15-delivery-bundle.js', [
      '--final-readiness', finalReadiness,
      '--package-ui-manifest', packageUiManifest,
      '--release-dir', path.join(runDir, 'release'),
      '--skip-latest-extras', 'true',
      '--out', outDir,
    ]);

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    for (const sourcePath of [regularInspector, wideWorkspace, wideInspector]) {
      expect(manifest.files).toEqual(expect.arrayContaining([expect.objectContaining({ sourcePath })]));
    }
  });
});
