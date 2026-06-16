const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const desktopDir = path.join(root, 'apps', 'desktop');
const evidenceDir = path.join(root, 'output', 'codex-evidence');
const esbuild = require(require.resolve('esbuild', { paths: [desktopDir] }));

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function writeFile(filePath, content = 'test') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function loadFilterModule(runId) {
  const bundledPath = path.join(evidenceDir, `business-report-files-smoke-helper-${runId}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(root, 'apps', 'desktop', 'src', 'main', 'business-report-files.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: bundledPath,
    external: [
      '@amazon-ai-ops/*',
      'electron',
      'better-sqlite3',
      'playwright',
      'playwright-core',
    ],
  });
  return { mod: require(bundledPath), bundledPath };
}

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const fixtureDir = path.join(evidenceDir, `business-report-file-filter-fixture-${runId}`);
  const downloadDir = path.join(fixtureDir, 'downloads');
  const outsideDir = path.join(fixtureDir, 'outside');
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  const files = {
    xlsx: path.join(downloadDir, 'campaign.xlsx'),
    xls: path.join(downloadDir, 'keyword.xls'),
    csv: path.join(downloadDir, 'search_term.csv'),
    json: path.join(downloadDir, 'manifest.json'),
    png: path.join(downloadDir, 'diagnostic-screenshot.png'),
    html: path.join(downloadDir, 'diagnostic-dom.html'),
    md: path.join(downloadDir, 'acceptance-audit.md'),
    txt: path.join(downloadDir, 'failure-evidence.txt'),
    auditXlsx: path.join(downloadDir, 'acceptance-audit.xlsx'),
    evidenceCsv: path.join(downloadDir, 'downloaded-report-files.csv'),
    batchResultXlsx: path.join(downloadDir, 'batch-result.xlsx'),
    failureXls: path.join(downloadDir, 'report-failure-evidence.xls'),
    traceCsv: path.join(downloadDir, 'trace-export.csv'),
    emptyXlsx: path.join(downloadDir, 'empty.xlsx'),
    missingXlsx: path.join(downloadDir, 'missing.xlsx'),
    outsideXlsx: path.join(outsideDir, 'outside.xlsx'),
  };

  for (const [key, filePath] of Object.entries(files)) {
    if (key !== 'missingXlsx') writeFile(filePath, `${key}\n`);
  }
  fs.writeFileSync(files.emptyXlsx, '');

  const { mod, bundledPath } = loadFilterModule(runId);
  const cases = [
    { name: 'xlsx inside download dir', filePath: files.xlsx, expected: true },
    { name: 'xls inside download dir', filePath: files.xls, expected: true },
    { name: 'csv inside download dir', filePath: files.csv, expected: true },
    { name: 'manifest json rejected', filePath: files.json, expected: false },
    { name: 'diagnostic screenshot rejected', filePath: files.png, expected: false },
    { name: 'diagnostic dom html rejected', filePath: files.html, expected: false },
    { name: 'acceptance md rejected', filePath: files.md, expected: false },
    { name: 'failure txt rejected', filePath: files.txt, expected: false },
    { name: 'audit-named xlsx rejected', filePath: files.auditXlsx, expected: false },
    { name: 'downloaded report files csv evidence rejected', filePath: files.evidenceCsv, expected: false },
    { name: 'batch result xlsx evidence rejected', filePath: files.batchResultXlsx, expected: false },
    { name: 'failure evidence xls rejected', filePath: files.failureXls, expected: false },
    { name: 'trace-named csv rejected', filePath: files.traceCsv, expected: false },
    { name: 'zero byte xlsx rejected', filePath: files.emptyXlsx, expected: false },
    { name: 'missing xlsx rejected', filePath: files.missingXlsx, expected: false },
    { name: 'xlsx outside download dir rejected', filePath: files.outsideXlsx, expected: false },
  ];

  const results = cases.map((item) => {
    const actual = mod.isExistingRawBusinessReportPath(item.filePath, downloadDir);
    const evidenceLike = mod.isRejectedEvidenceLikePath(item.filePath);
    if (actual !== item.expected) {
      fail(`File filter case failed: ${item.name}`, `expected ${item.expected}, got ${actual}`);
    }
    return {
      name: item.name,
      filePath: item.filePath,
      expected: item.expected,
      actual,
      evidenceLike,
      extension: path.extname(item.filePath),
    };
  });

  const downloadedFileRecords = results.filter((item) => item.actual).length;
  if (downloadedFileRecords !== 3) {
    fail('Downloaded real report count should include only xlsx/xls/csv inside download dir', String(downloadedFileRecords));
  }

  const rejectedEvidenceFileCount = results.filter((item) => item.evidenceLike).length;
  if (rejectedEvidenceFileCount !== 10) {
    fail('Rejected evidence-like count mismatch', String(rejectedEvidenceFileCount));
  }

  const latestPartialDir = path.join(fixtureDir, 'latest-partial');
  const olderCompleteDir = path.join(fixtureDir, 'older-complete');
  const latestKeyword = path.join(latestPartialDir, 'keyword-latest.xlsx');
  const latestCampaignAudit = path.join(latestPartialDir, 'campaign-diagnostic.xlsx');
  const olderCampaign = path.join(olderCompleteDir, 'campaign-older.xlsx');
  const olderAdGroup = path.join(olderCompleteDir, 'ad-group-older.xlsx');
  const olderKeyword = path.join(olderCompleteDir, 'keyword-older.xlsx');
  [latestKeyword, latestCampaignAudit, olderCampaign, olderAdGroup, olderKeyword].forEach((filePath) => writeFile(filePath, 'report\n'));

  const selection = mod.selectLatestRawBusinessReportsByType([
    {
      batch: { downloadDir: latestPartialDir },
      files: [
        { id: 'latest-keyword', reportType: 'keyword', status: 'downloaded', filePath: latestKeyword },
        { id: 'latest-campaign-audit', reportType: 'campaign', status: 'downloaded', filePath: latestCampaignAudit },
      ],
    },
    {
      batch: { downloadDir: olderCompleteDir },
      files: [
        { id: 'older-campaign', reportType: 'campaign', status: 'downloaded', filePath: olderCampaign },
        { id: 'older-ad-group', reportType: 'ad_group', status: 'downloaded', filePath: olderAdGroup },
        { id: 'older-keyword', reportType: 'keyword', status: 'failed', filePath: olderKeyword },
      ],
    },
  ]);
  const selectedIds = selection.files.map((file) => file.id).sort();
  const expectedSelectedIds = ['latest-keyword', 'older-ad-group', 'older-campaign'];
  if (JSON.stringify(selectedIds) !== JSON.stringify(expectedSelectedIds)) {
    fail('Latest raw report selection should preserve older complete files while taking latest valid retry file and rejecting invalid statuses', JSON.stringify(selectedIds));
  }
  if (selection.fileDownloadDirs['latest-keyword'] !== latestPartialDir || selection.fileDownloadDirs['older-campaign'] !== olderCompleteDir) {
    fail('Selected file downloadDir map should keep each file bound to its original batch folder');
  }

  const staleIndexedImport = mod.resolveBusinessReportImportState({
    fileStatus: 'downloaded',
    indexedStatus: 'imported',
    countedMetricRows: 0,
  });
  if (staleIndexedImport.status === 'imported' || staleIndexedImport.importedRows !== 0) {
    fail('Import state must use ad_daily_metrics row count as the source of truth, not stale report_files importedRows', JSON.stringify(staleIndexedImport));
  }
  const countedImport = mod.resolveBusinessReportImportState({
    fileStatus: 'downloaded',
    indexedStatus: 'downloaded',
    countedMetricRows: 42,
  });
  if (countedImport.status !== 'imported' || countedImport.importedRows !== 42) {
    fail('Import state should mark imported only when current DB metrics exist for the raw report file', JSON.stringify(countedImport));
  }

  const evidencePath = path.join(evidenceDir, `business-report-file-filter-smoke-${runId}.json`);
  fs.writeFileSync(evidencePath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    helperSource: 'apps/desktop/src/main/business-report-files.ts',
    bundledHelper: bundledPath,
    fixtureDir,
    downloadDir,
    downloadedFileRecords,
    rejectedEvidenceFileCount,
    acceptedExtensions: Array.from(mod.BUSINESS_REAL_REPORT_EXTENSIONS),
    rejectedEvidenceExtensions: mod.BUSINESS_REJECTED_EVIDENCE_EXTENSIONS,
    latestSelection: {
      selectedIds,
      expectedSelectedIds,
      fileDownloadDirs: selection.fileDownloadDirs,
    },
    importStateSourceOfTruth: {
      staleIndexedImport,
      countedImport,
    },
    results,
  }, null, 2)}\n`);
  console.log(`[PASS] business report file filter smoke evidence: ${evidencePath}`);
}

main();
