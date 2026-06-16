const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'output', 'codex-evidence');

function fail(message, details) {
  throw new Error(details ? `${message}: ${details}` : message);
}

function runPython(args, options = {}) {
  const python = process.env.PYTHON || 'python';
  const result = spawnSync(python, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    fail(`Python command failed: ${python} ${args.join(' ')}`, [
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const runId = Date.now();
  const fixtureDir = path.join(evidenceDir, `import-lingxing-batch-metrics-fixture-${runId}`);
  const downloadDir = path.join(fixtureDir, 'downloads');
  const dbPath = path.join(fixtureDir, 'amazon-ai-ops-smoke.db');
  const csvPath = path.join(downloadDir, 'user_search_term-real-report.csv');
  const outPath = path.join(evidenceDir, `import-lingxing-batch-metrics-smoke-${runId}.json`);
  const manifestPath = path.join(downloadDir, 'manifest.json');
  const reconcileEvidencePath = path.join(fixtureDir, 'reconcile-evidence.json');
  const reconcileOutPath = path.join(evidenceDir, `reconcile-lingxing-full8-data-smoke-${runId}.json`);
  fs.mkdirSync(downloadDir, { recursive: true });

  const setupCode = `
import csv
import json
import sqlite3
from pathlib import Path

fixture = json.loads(r'''${JSON.stringify({ dbPath, downloadDir, csvPath })}''')
Path(fixture["downloadDir"]).mkdir(parents=True, exist_ok=True)
with open(fixture["csvPath"], "w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.writer(handle)
    writer.writerow(["日期", "店铺名称", "国家", "广告组合", "广告活动", "广告组", "关键词", "匹配方式", "展现量", "点击量", "花费-本币", "广告订单", "广告销售额-本币"])
    writer.writerow(["2026-06-01", "FT-US-US", "US", "Portfolio A", "Campaign A", "Ad Group A", "smart lock", "exact", "100", "10", "12.50", "1", "30.00"])

conn = sqlite3.connect(fixture["dbPath"])
conn.executescript("""
CREATE TABLE lingxing_report_batches (
  id TEXT PRIMARY KEY,
  app_version TEXT,
  date_start TEXT NOT NULL,
  date_end TEXT NOT NULL,
  store_name TEXT,
  marketplace_code TEXT,
  status TEXT NOT NULL,
  download_dir TEXT NOT NULL,
  manifest_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE TABLE lingxing_report_files (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  max_auto_retries INTEGER DEFAULT 2,
  auto_retry_count INTEGER DEFAULT 0,
  file_path TEXT,
  file_size_bytes INTEGER DEFAULT 0,
  error_message TEXT,
  attempt_errors_json TEXT DEFAULT '[]',
  failure_screenshot_path TEXT,
  failure_dom_snapshot_path TEXT,
  failure_trace_path TEXT,
  trace_unavailable_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE report_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  report_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  imported_rows INTEGER DEFAULT 0,
  file_hash TEXT,
  import_error TEXT,
  last_imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(batch_id, report_type, file_path)
);
CREATE TABLE ad_daily_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT,
  report_type TEXT,
  portfolio_name TEXT,
  date TEXT,
  store_name TEXT,
  marketplace_code TEXT,
  asin TEXT,
  msku TEXT,
  campaign_name TEXT,
  ad_group_name TEXT,
  targeting TEXT,
  search_term TEXT,
  match_type TEXT,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  orders INTEGER DEFAULT 0,
  sales REAL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  acos REAL DEFAULT 0,
  cpc REAL DEFAULT 0,
  cvr REAL DEFAULT 0,
  source_file TEXT,
  source_row INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
""")
conn.execute(
    """
    INSERT INTO lingxing_report_batches (
      id, app_version, date_start, date_end, store_name, marketplace_code,
      status, download_dir, manifest_path, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    """,
    ("batch_partial_smoke", "1.5.0", "2026-06-01", "2026-06-12", "FT-US-US", "US", "completed_with_errors", fixture["downloadDir"], None),
)
conn.execute(
    """
    INSERT INTO lingxing_report_files (
      id, batch_id, report_type, display_name, status, file_path, file_size_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """,
    ("batch_partial_smoke_user_search_term", "batch_partial_smoke", "user_search_term", "用户搜索词报告", "downloaded", fixture["csvPath"], Path(fixture["csvPath"]).stat().st_size),
)
conn.commit()
conn.close()
`;

  runPython(['-c', setupCode]);
  const manifest = {
    batch: {
      id: 'batch_partial_smoke',
      dateStart: '2026-06-01',
      dateEnd: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      status: 'completed_with_errors',
      downloadDir,
      manifestPath,
    },
    files: [{
      id: 'batch_partial_smoke_user_search_term',
      batchId: 'batch_partial_smoke',
      reportType: 'user_search_term',
      displayName: '用户搜索词报告',
      status: 'downloaded',
      filePath: csvPath,
      fileSizeBytes: fs.statSync(csvPath).size,
    }],
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reconcileEvidencePath, `${JSON.stringify({
    manifestPath,
    request: {
      start: '2026-06-01',
      end: '2026-06-12',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
    },
  }, null, 2)}\n`, 'utf8');

  const importResult = runPython([
    path.join(root, 'scripts', 'import_lingxing_batch_metrics.py'),
    '--db',
    dbPath,
    '--batch',
    'batch_partial_smoke',
    '--out',
    outPath,
  ]);

  const queryCode = `
import json
import sqlite3
conn = sqlite3.connect(r'''${dbPath}''')
conn.row_factory = sqlite3.Row
summary = dict(conn.execute("""
  SELECT COUNT(*) AS rows, ROUND(SUM(cost), 2) AS spend, ROUND(SUM(sales), 2) AS sales,
         SUM(orders) AS orders, MAX(currency) AS currency, MAX(report_type) AS reportType
  FROM ad_daily_metrics
  WHERE batch_id = 'batch_partial_smoke'
""").fetchone())
file_index = [dict(row) for row in conn.execute("""
  SELECT report_type AS reportType, status, imported_rows AS importedRows, file_hash AS fileHash
  FROM report_files
  WHERE batch_id = 'batch_partial_smoke'
""").fetchall()]
conn.close()
print(json.dumps({"summary": summary, "fileIndex": file_index}, ensure_ascii=False))
`;
  const queryResult = runPython(['-c', queryCode]);
  const verification = JSON.parse(queryResult.stdout);

  if (verification.summary.rows !== 1) {
    fail('completed_with_errors batch should import real CSV metrics', JSON.stringify(verification));
  }
  if (verification.summary.currency !== 'USD') {
    fail('Imported metrics should use USD currency', JSON.stringify(verification));
  }
  if (!verification.fileIndex.some((item) => item.status === 'imported' && item.importedRows === 1 && item.fileHash)) {
    fail('report_files index should be marked imported with hash and row count', JSON.stringify(verification));
  }

  const reconcileResult = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'reconcile-lingxing-full8-data.js'),
    reconcileEvidencePath,
    '--db',
    dbPath,
    '--out',
    reconcileOutPath,
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  if (reconcileResult.status !== 0) {
    fail('Reconcile command failed', [reconcileResult.stdout, reconcileResult.stderr].filter(Boolean).join('\n'));
  }
  const reconciliation = JSON.parse(fs.readFileSync(reconcileOutPath, 'utf8'));
  if (reconciliation.realReportFileCount !== 1) {
    fail('Reconcile should count only real report files', JSON.stringify(reconciliation));
  }
  if (reconciliation.db?.canonical?.summarySource !== 'canonical_user_search_term') {
    fail('Reconcile should use user_search_term as canonical DB source', JSON.stringify(reconciliation.db));
  }
  if (reconciliation.db?.totals?.canonical?.spend !== 12.5 || reconciliation.db?.totals?.canonical?.orders !== 1 || reconciliation.db?.totals?.canonical?.sales !== 30) {
    fail('Reconcile DB canonical totals should match imported metrics', JSON.stringify(reconciliation.db?.totals?.canonical));
  }
  if (reconciliation.db?.blockers?.length) {
    fail('Reconcile DB should not report blockers for the smoke fixture', JSON.stringify(reconciliation.db.blockers));
  }

  const evidence = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  evidence.smokeVerification = verification;
  evidence.reconciliation = {
    outPath: reconcileOutPath,
    canonical: reconciliation.db?.totals?.canonical,
    rawCanonical: reconciliation.totals?.canonicalTotal,
  };
  evidence.importStdout = importResult.stdout;
  evidence.fixtureDir = fixtureDir;
  fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(`[PASS] import Lingxing batch metrics smoke evidence: ${outPath}`);
}

main();
