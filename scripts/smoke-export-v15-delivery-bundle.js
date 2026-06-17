const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function fail(message, details) {
  console.error(`[FAIL] ${message}`);
  if (details) console.error(details);
  process.exit(1);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return filePath;
}

function writeReport(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fake xlsx bytes for bundle readback verifier\n', 'utf8');
  return filePath;
}

function validReadbackEvidence(dir, reportPath) {
  const now = '2026-06-12T10:00:00.000Z';
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
      screenshotPath: writePng(path.join(dir, 'readback-before.png')),
      liveBidSourceNote: 'Read from Ads UI editable target bid cell before manual change.',
    },
    after: {
      value: '2.16',
      capturedAt: now,
      screenshotPath: writePng(path.join(dir, 'readback-after.png')),
    },
    readback: {
      verified: true,
      method: 'Ads UI reload target row',
      readAt: now,
      actualValue: '2.16',
      evidencePath: writePng(path.join(dir, 'readback-reload.png')),
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
      sourceFiles: [reportPath],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'search_term',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function expect(condition, message, details) {
  if (!condition) fail(message, details);
}

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const evidenceManifestPath = path.join(evidenceDir, `v15-final-readiness-evidence-manifest-export-bundle-smoke-${runId}.json`);
  const finalReadinessPath = path.join(evidenceDir, `final-readiness-export-bundle-smoke-${runId}.json`);
  const reconciliationPath = path.join(evidenceDir, `data-reconciliation-export-bundle-smoke-${runId}.json`);
  const reconciliationMarkdownPath = path.join(evidenceDir, `data-reconciliation-export-bundle-smoke-${runId}.md`);
  const reportTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-report-index-smoke-'));
  const reportPath = path.join(reportTempDir, `source-user-search-term-${runId}.xlsx`);
  const readbackPath = path.join(evidenceDir, `real-ad-execution-readback-export-bundle-smoke-${runId}.json`);
  const outDir = path.join(evidenceDir, `export-v15-delivery-bundle-smoke-${runId}`);

  fs.writeFileSync(reportPath, 'fake xlsx bytes for bundle index smoke\n', 'utf8');
  writeJson(readbackPath, validReadbackEvidence(evidenceDir, writeReport(reportPath)));
  writeJson(evidenceManifestPath, {
    kind: 'v15-final-readiness-evidence-manifest',
    evidence: {
      adReadback: {
        exists: true,
        absolutePath: readbackPath,
      },
    },
  });
  writeJson(finalReadinessPath, {
    status: 'APP_READY',
    appReady: true,
    reportCollectionReady: true,
    listingReadReady: true,
    evidenceSelection: {
      mode: 'manifest',
      manifestPath: evidenceManifestPath,
    },
    gates: [
      { name: 'Real ad execution readback', ok: true, evidencePath: readbackPath },
    ],
  });
  writeJson(reconciliationPath, {
    scope: {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      currency: 'USD',
    },
    canonicalSource: 'canonical_user_search_term',
    canonical: {
      rows: 18,
      spend: 170.25,
      orders: 3,
      sales: 240.5,
      clicks: 120,
      impressions: 8000,
      currency: 'USD',
    },
    blockers: [],
    reportFiles: [
      {
        reportType: 'user_search_term',
        filePath: reportPath,
      },
    ],
  });
  fs.writeFileSync(
    reconciliationMarkdownPath,
    '# Data Reconciliation Smoke\n\nCanonical: canonical_user_search_term\nSpend: 170.25 USD\nOrders: 3\n',
    'utf8',
  );

  const result = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'export-v15-delivery-bundle.js'),
    '--final-readiness',
    finalReadinessPath,
    '--data-reconciliation',
    reconciliationPath,
    '--data-reconciliation-md',
    reconciliationMarkdownPath,
    '--skip-latest-extras',
    'true',
    '--out',
    outDir,
  ], { cwd: root, encoding: 'utf8' });

  if (result.status !== 0) {
    fail('export-v15-delivery-bundle smoke command failed', `${result.stdout}\n${result.stderr}`);
  }

  const manifestPath = path.join(outDir, 'delivery-bundle-manifest.json');
  expect(fs.existsSync(manifestPath), 'delivery bundle manifest was not written');
  const manifest = readJson(manifestPath);
  expect(manifest.status === 'APP_READY', 'bundle manifest did not keep final readiness status', JSON.stringify(manifest, null, 2));
  expect(manifest.dataReconciliation?.present === true, 'bundle manifest did not mark data reconciliation present', JSON.stringify(manifest.dataReconciliation, null, 2));
  expect(manifest.dataReconciliation?.canonicalSource === 'canonical_user_search_term', 'bundle manifest did not preserve canonical source', JSON.stringify(manifest.dataReconciliation, null, 2));
  expect(manifest.dataReconciliation?.canonical?.spend === 170.25, 'bundle manifest did not preserve canonical spend', JSON.stringify(manifest.dataReconciliation, null, 2));
  expect(manifest.dataReconciliation?.canonical?.orders === 3, 'bundle manifest did not preserve canonical orders', JSON.stringify(manifest.dataReconciliation, null, 2));
  expect(manifest.dataReconciliation?.bundleJson, 'bundle manifest did not record data reconciliation JSON bundle path', JSON.stringify(manifest.dataReconciliation, null, 2));
  expect(manifest.dataReconciliation?.bundleMarkdown, 'bundle manifest did not record data reconciliation Markdown bundle path', JSON.stringify(manifest.dataReconciliation, null, 2));
  expect(fs.existsSync(path.join(outDir, manifest.dataReconciliation.bundleJson)), 'copied data reconciliation JSON is missing');
  expect(fs.existsSync(path.join(outDir, manifest.dataReconciliation.bundleMarkdown)), 'copied data reconciliation Markdown is missing');
  expect(
    manifest.files.some((file) => file.label === 'data-reconciliation:json')
      && manifest.files.some((file) => file.label === 'data-reconciliation:markdown'),
    'bundle file list does not include data reconciliation labels',
    JSON.stringify(manifest.files, null, 2),
  );
  expect(manifest.realReportIndex?.present === true, 'bundle manifest did not mark real report index present', JSON.stringify(manifest.realReportIndex, null, 2));
  expect(manifest.realReportIndex?.count === 1, 'bundle manifest did not count indexed real reports', JSON.stringify(manifest.realReportIndex, null, 2));
  expect(manifest.realReportIndex?.bundleJson, 'bundle manifest did not record real report index JSON bundle path', JSON.stringify(manifest.realReportIndex, null, 2));
  const reportIndex = readJson(path.join(outDir, manifest.realReportIndex.bundleJson));
  expect(reportIndex.reports?.[0]?.sourcePath === reportPath, 'real report index did not keep source report path', JSON.stringify(reportIndex, null, 2));
  expect(reportIndex.reports?.[0]?.exists === true, 'real report index did not mark source report as existing', JSON.stringify(reportIndex, null, 2));
  expect(Boolean(reportIndex.reports?.[0]?.sha256), 'real report index did not hash source report', JSON.stringify(reportIndex, null, 2));
  expect(!manifest.files.some((file) => /\.xlsx$/i.test(file.bundlePath || '')), 'delivery bundle copied raw xlsx report instead of indexing it', JSON.stringify(manifest.files, null, 2));
  expect(manifest.packageIndex?.present === true, 'bundle manifest did not mark release package index present', JSON.stringify(manifest.packageIndex, null, 2));
  expect(manifest.packageIndex?.count >= 1, 'bundle manifest did not count indexed release packages', JSON.stringify(manifest.packageIndex, null, 2));
  expect(manifest.packageIndex?.bundleJson, 'bundle manifest did not record release package index JSON bundle path', JSON.stringify(manifest.packageIndex, null, 2));
  const packageIndex = readJson(path.join(outDir, manifest.packageIndex.bundleJson));
  expect(packageIndex.packages?.some((item) => item.kind === 'portable' && item.sha256), 'release package index did not hash portable exe', JSON.stringify(packageIndex, null, 2));
  expect(!manifest.files.some((file) => /\.exe$/i.test(file.bundlePath || '')), 'delivery bundle copied installer exe instead of indexing it', JSON.stringify(manifest.files, null, 2));

  const evidencePath = path.join(evidenceDir, `export-v15-delivery-bundle-smoke-${runId}.json`);
  writeJson(evidencePath, {
    generatedAt: new Date().toISOString(),
    finalReadinessPath,
    reconciliationPath,
    reconciliationMarkdownPath,
    bundleDir: outDir,
    manifestPath,
    dataReconciliation: manifest.dataReconciliation,
    realReportIndex: manifest.realReportIndex,
    packageIndex: manifest.packageIndex,
  });
  console.log(`[PASS] export v15 delivery bundle smoke evidence: ${evidencePath}`);
}

main();
