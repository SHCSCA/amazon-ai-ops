import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'url';

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

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
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
    kind: 'real-ad-execution-readback',
    status: 'PASS',
    createdAt: now,
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
      recommendationId: 'rec-1',
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
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    writeJson(readback, validReadbackEvidence(runDir));
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

    writeJson(readback, validReadbackEvidence(runDir));
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

    writeJson(readback, validReadbackEvidence(runDir));
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
    const releasePackageIndex = packageIndexFromArtifacts([
      { kind: 'installer', filePath: installerPath, content: installerContent },
      { kind: 'portable', filePath: portablePath, content: portableContent },
    ]);

    writeJson(readback, validReadbackEvidence(runDir));
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

    expect(result.status).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'delivery-bundle-manifest.json'), 'utf8'));
    expect(manifest.packageIndex).toMatchObject({
      present: true,
      count: 2,
      existingCount: 2,
      missingCount: 0,
      copyPolicy: expect.stringContaining('not copied'),
    });
    expect(manifest.packageIndex.bundleJson).toBeTruthy();
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
    }
    const bundledReadme = fs.readFileSync(path.join(outDir, 'docs', 'README.md'), 'utf8');
    expect(bundledReadme).toContain('**DELIVERY: APP_READY.');
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

    writeJson(readback, validReadbackEvidence(runDir));
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
      count: 1,
      existingCount: 1,
      missingCount: 0,
    });
    const realReportIndex = JSON.parse(fs.readFileSync(path.join(outDir, manifest.realReportIndex.bundleJson), 'utf8'));
    const sourcePaths = realReportIndex.reports.map((item) => item.sourcePath);
    expect(sourcePaths).toContain(reportPath);
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

    writeJson(readback, validReadbackEvidence(runDir));
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

    writeJson(readback, validReadbackEvidence(runDir));
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

    writeJson(readback, validReadbackEvidence(runDir));
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

  it('preserves final-readiness blockers in APP_NEEDS_WORK bundle manifest', () => {
    const runId = Date.now();
    const runDir = path.join(evidenceDir, `export-bundle-blocker-summary-test-${runId}`);
    cleanupPaths.push(runDir);
    const finalReadiness = path.join(runDir, 'final-readiness.json');
    const evidenceManifest = path.join(runDir, 'evidence-manifest.json');
    const dataReconciliation = path.join(runDir, 'data-reconciliation.json');
    const outDir = path.join(runDir, 'bundle');

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
    expect(manifest.finalReadinessBlockers).toEqual(expect.arrayContaining([
      'AI 阶段判断引用的指标证据缺少产品 ASIN。',
      '补齐真实广告报表 sourceFile/sourceRow 后重新生成建议。',
      'AI 候选动作无法绑定当前范围内的真实广告对象。',
      'Recommendations review blockers: 当前范围指标证据缺少真实广告报表 sourceFile/sourceRow，不能用于正式 AI 动作。',
    ]));
  });
});
