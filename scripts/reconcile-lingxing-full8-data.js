const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..');
const XLSX = createRequire(path.join(repoRoot, 'packages', 'report-parser', 'package.json'))('xlsx');

const REPORT_GROUPS = {
  accountSummaryDuplicate: new Set(['campaign', 'ad_group', 'placement', 'advertised_product']),
  optimizationExecutable: new Set(['keyword', 'product_targeting', 'auto_targeting', 'user_search_term', 'search_term']),
  targetingBreakdown: new Set(['keyword', 'product_targeting', 'auto_targeting']),
  canonicalTotal: 'user_search_term',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function findManifestPath(evidence) {
  return firstDefined(
    evidence.manifestPath,
    evidence.batch?.manifestPath,
    evidence.result?.batch?.manifestPath,
    evidence.collectionResult?.batch?.manifestPath,
  );
}

function toNumber(value) {
  if (value === undefined || value === null) return 0;
  const normalized = String(value).replace(/[$,%\s,]/g, '').replace(/^--$/, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function findColumn(header, candidates) {
  return candidates.map((candidate) => header.indexOf(candidate)).find((index) => index >= 0) ?? -1;
}

function summarizeFile(file) {
  const workbook = XLSX.readFile(file.filePath, { cellDates: false });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
  const header = rows[0] || [];
  const indexes = {
    spend: findColumn(header, ['花费-本币', '花费', 'Spend', 'Cost']),
    orders: findColumn(header, ['广告订单', '订单', 'Orders']),
    sales: findColumn(header, ['广告销售额-本币', '广告销售额', '销售额', 'Sales']),
    clicks: findColumn(header, ['点击', '点击量', 'Clicks']),
    impressions: findColumn(header, ['曝光量', '展现量', 'Impressions']),
  };

  const totals = { spend: 0, orders: 0, sales: 0, clicks: 0, impressions: 0 };
  for (const row of rows.slice(1)) {
    totals.spend += toNumber(row[indexes.spend]);
    totals.orders += toNumber(row[indexes.orders]);
    totals.sales += toNumber(row[indexes.sales]);
    totals.clicks += toNumber(row[indexes.clicks]);
    totals.impressions += toNumber(row[indexes.impressions]);
  }

  return {
    reportType: file.reportType,
    rows: Math.max(0, rows.length - 1),
    filePath: file.filePath,
    fileSizeBytes: file.fileSizeBytes,
    columns: Object.fromEntries(Object.entries(indexes).map(([key, index]) => [key, index >= 0 ? header[index] : null])),
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value.toFixed(2))])),
  };
}

function addTotals(items) {
  const totals = { spend: 0, orders: 0, sales: 0, clicks: 0, impressions: 0 };
  for (const item of items) {
    for (const key of Object.keys(totals)) totals[key] += item.totals[key] || 0;
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value.toFixed(2))]));
}

function reconcile(evidencePath) {
  const evidence = readJson(evidencePath);
  const manifestPath = findManifestPath(evidence);
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found from evidence: ${manifestPath || '-'}`);
  }

  const manifest = readJson(manifestPath);
  const files = manifest.files || [];
  const summaries = files.map(summarizeFile);
  const byType = new Map(summaries.map((summary) => [summary.reportType, summary]));
  const canonical = byType.get(REPORT_GROUPS.canonicalTotal);
  const duplicateSummaryRows = summaries.filter((summary) => REPORT_GROUPS.accountSummaryDuplicate.has(summary.reportType));
  const executableRows = summaries.filter((summary) => REPORT_GROUPS.optimizationExecutable.has(summary.reportType));
  const targetingBreakdownRows = summaries.filter((summary) => REPORT_GROUPS.targetingBreakdown.has(summary.reportType));

  return {
    evidencePath: path.resolve(evidencePath),
    manifestPath,
    batch: manifest.batch || evidence.batch || evidence.result?.batch,
    scope: {
      dateStart: firstDefined(evidence.request?.start, evidence.batch?.dateStart, manifest.batch?.dateStart),
      dateEnd: firstDefined(evidence.request?.end, evidence.batch?.dateEnd, manifest.batch?.dateEnd),
      storeName: firstDefined(evidence.request?.storeName, evidence.batch?.storeName, manifest.batch?.storeName),
      marketplaceCode: firstDefined(evidence.request?.marketplaceCode, evidence.batch?.marketplaceCode, manifest.batch?.marketplaceCode),
    },
    summaries,
    totals: {
      canonicalTotal: canonical?.totals || null,
      accountSummaryDuplicateReports: Object.fromEntries(duplicateSummaryRows.map((summary) => [summary.reportType, summary.totals])),
      targetingBreakdownTotal: addTotals(targetingBreakdownRows),
      executableRowsNaiveSum: addTotals(executableRows),
    },
    interpretation: {
      canonicalTotalReport: REPORT_GROUPS.canonicalTotal,
      nonAdditiveReports: [...REPORT_GROUPS.accountSummaryDuplicate],
      executableReports: [...REPORT_GROUPS.optimizationExecutable],
      targetingBreakdownReports: [...REPORT_GROUPS.targetingBreakdown],
      warning: 'Do not add campaign/ad_group/placement/advertised_product together with keyword/search_term/targeting reports; they repeat the same spend/orders at different grains.',
    },
  };
}

if (require.main === module) {
  const evidencePath = process.argv[2];
  if (!evidencePath) {
    console.error('Usage: node scripts/reconcile-lingxing-full8-data.js <desktop-live-full-8-e2e.json> [--out output.json]');
    process.exit(1);
  }

  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';
  const result = reconcile(path.resolve(evidencePath));

  console.log(JSON.stringify({
    scope: result.scope,
    batchId: result.batch?.id,
    canonicalTotal: result.totals.canonicalTotal,
    targetingBreakdownTotal: result.totals.targetingBreakdownTotal,
    executableRowsNaiveSum: result.totals.executableRowsNaiveSum,
    nonAdditiveReports: result.interpretation.nonAdditiveReports,
    warning: result.interpretation.warning,
  }, null, 2));

  if (outPath) {
    const resolvedOut = path.resolve(outPath);
    fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
    fs.writeFileSync(resolvedOut, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`Reconciliation written: ${resolvedOut}`);
  }
}

module.exports = {
  REPORT_GROUPS,
  reconcile,
};
