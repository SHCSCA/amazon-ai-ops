const fs = require('fs');
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
  const outDir = path.join(evidenceDir, `export-v15-delivery-bundle-smoke-${runId}`);

  writeJson(evidenceManifestPath, {
    kind: 'v15-final-readiness-evidence-manifest',
    evidence: {},
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
    gates: [],
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

  const evidencePath = path.join(evidenceDir, `export-v15-delivery-bundle-smoke-${runId}.json`);
  writeJson(evidencePath, {
    generatedAt: new Date().toISOString(),
    finalReadinessPath,
    reconciliationPath,
    reconciliationMarkdownPath,
    bundleDir: outDir,
    manifestPath,
    dataReconciliation: manifest.dataReconciliation,
  });
  console.log(`[PASS] export v15 delivery bundle smoke evidence: ${evidencePath}`);
}

main();
