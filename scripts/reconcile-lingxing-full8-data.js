const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const repoRoot = path.resolve(__dirname, '..');
const XLSX = createRequire(path.join(repoRoot, 'packages', 'report-parser', 'package.json'))('xlsx');
const LOCAL_DB_PACKAGE = path.join(repoRoot, 'packages', 'local-db', 'package.json');

const REPORT_GROUPS = {
  accountSummaryDuplicate: new Set(['campaign', 'ad_group', 'placement', 'advertised_product']),
  optimizationExecutable: new Set(['keyword', 'product_targeting', 'auto_targeting', 'user_search_term', 'search_term']),
  targetingBreakdown: new Set(['keyword', 'product_targeting', 'auto_targeting']),
  canonicalTotal: 'user_search_term',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireSqlite() {
  try {
    return require('better-sqlite3');
  } catch (error) {
    if (fs.existsSync(LOCAL_DB_PACKAGE)) {
      return createRequire(LOCAL_DB_PACKAGE)('better-sqlite3');
    }
    throw error;
  }
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

function isRealReportFile(file) {
  const filePath = String(file?.filePath || '');
  const ext = path.extname(filePath).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) return false;
  if (/(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i.test(path.basename(filePath))) return false;
  return fs.existsSync(filePath);
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
  const requiredMetricColumns = ['spend', 'orders', 'sales'];
  const missingRequiredMetricColumns = requiredMetricColumns.filter((key) => indexes[key] < 0);

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
    missingRequiredMetricColumns,
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

function chooseCanonicalSummary(summaries) {
  const byType = new Map(summaries.map((summary) => [summary.reportType, summary]));
  return byType.get('user_search_term') || byType.get('search_term') || null;
}

function chooseDbCanonicalReportTypes(reportTypes) {
  const available = new Set(reportTypes.filter(Boolean));
  if (available.has('user_search_term')) return { reportTypes: ['user_search_term'], summarySource: 'canonical_user_search_term', approximate: false };
  if (available.has('search_term')) return { reportTypes: ['search_term'], summarySource: 'canonical_search_term', approximate: false };
  const fallback = ['keyword', 'product_targeting', 'auto_targeting'].filter((type) => available.has(type));
  if (fallback.length) return { reportTypes: fallback, summarySource: 'actionable_fallback', approximate: true };
  return { reportTypes: [], summarySource: 'none', approximate: false };
}

function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
}

function sqlInList(values) {
  return values.map(() => '?').join(', ');
}

function dbScopeWhere(batch, scope) {
  const where = [];
  const params = [];
  if (batch?.id) {
    where.push('batch_id = ?');
    params.push(batch.id);
  }
  if (scope.dateStart) {
    where.push('date >= ?');
    params.push(scope.dateStart);
  }
  if (scope.dateEnd) {
    where.push('date <= ?');
    params.push(scope.dateEnd);
  }
  if (scope.storeName) {
    where.push('store_name = ?');
    params.push(scope.storeName);
  }
  if (scope.marketplaceCode) {
    where.push('marketplace_code = ?');
    params.push(scope.marketplaceCode);
  }
  return { whereSql: where.length ? where.join(' AND ') : '1 = 1', params };
}

function queryDbTotals(db, whereSql, params, reportTypes) {
  if (!reportTypes.length) {
    return { rows: 0, spend: 0, orders: 0, sales: 0, clicks: 0, impressions: 0, currency: null };
  }
  const row = db.prepare(`
    SELECT
      COUNT(*) AS rows,
      ROUND(COALESCE(SUM(cost), 0), 2) AS spend,
      COALESCE(SUM(orders), 0) AS orders,
      ROUND(COALESCE(SUM(sales), 0), 2) AS sales,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(impressions), 0) AS impressions,
      MAX(currency) AS currency
    FROM ad_daily_metrics
    WHERE ${whereSql}
      AND report_type IN (${sqlInList(reportTypes)})
  `).get(...params, ...reportTypes);
  return {
    rows: Number(row?.rows || 0),
    spend: Number(row?.spend || 0),
    orders: Number(row?.orders || 0),
    sales: Number(row?.sales || 0),
    clicks: Number(row?.clicks || 0),
    impressions: Number(row?.impressions || 0),
    currency: row?.currency || null,
  };
}

function reconcileDb(dbPath, batch, scope, rawCanonical) {
  if (!dbPath) return null;
  const resolvedDbPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDbPath)) {
    throw new Error(`DB not found: ${resolvedDbPath}`);
  }
  const Database = requireSqlite();
  const db = new Database(resolvedDbPath, { readonly: true });
  try {
    if (!tableExists(db, 'ad_daily_metrics')) {
      throw new Error(`DB missing ad_daily_metrics table: ${resolvedDbPath}`);
    }
    const { whereSql, params } = dbScopeWhere(batch, scope);
    const reportTypes = db.prepare(`
      SELECT DISTINCT report_type AS reportType
      FROM ad_daily_metrics
      WHERE ${whereSql}
    `).all(...params).map((row) => String(row.reportType || '')).filter(Boolean);
    const canonical = chooseDbCanonicalReportTypes(reportTypes);
    const canonicalTotals = queryDbTotals(db, whereSql, params, canonical.reportTypes);
    const actionableTotals = queryDbTotals(db, whereSql, params, [...REPORT_GROUPS.optimizationExecutable]);
    const breakdownTotals = queryDbTotals(db, whereSql, params, [...REPORT_GROUPS.accountSummaryDuplicate]);
    const reportFiles = tableExists(db, 'report_files')
      ? db.prepare(`
          SELECT report_type AS reportType, file_path AS filePath, file_size AS fileSize,
                 status, imported_rows AS importedRows, file_hash AS fileHash,
                 import_error AS importError, last_imported_at AS lastImportedAt
          FROM report_files
          WHERE ${batch?.id ? 'batch_id = ?' : '1 = 1'}
          ORDER BY report_type, file_path
        `).all(...(batch?.id ? [batch.id] : []))
      : [];
    const rawCanonicalTotals = rawCanonical?.totals || null;
    const canonicalDelta = rawCanonicalTotals
      ? {
          spend: Number((canonicalTotals.spend - rawCanonicalTotals.spend).toFixed(2)),
          orders: Number((canonicalTotals.orders - rawCanonicalTotals.orders).toFixed(2)),
          sales: Number((canonicalTotals.sales - rawCanonicalTotals.sales).toFixed(2)),
          clicks: Number((canonicalTotals.clicks - rawCanonicalTotals.clicks).toFixed(2)),
          impressions: Number((canonicalTotals.impressions - rawCanonicalTotals.impressions).toFixed(2)),
        }
      : null;
    const blockers = [];
    if (canonical.summarySource === 'none') blockers.push('DB 中没有 user_search_term/search_term 或可行动 fallback 报表行，无法形成广告总盘口径。');
    if (canonicalTotals.rows === 0) blockers.push('DB 当前范围 canonical 汇总行数为 0。');
    if (reportFiles.length === 0) blockers.push('DB report_files 没有当前批次真实文件索引。');
    if (rawCanonicalTotals && canonicalDelta && Object.values(canonicalDelta).some((value) => Math.abs(Number(value)) > 0.01)) {
      blockers.push('DB canonical 汇总与原始 canonical 表格存在差异，需要核对导入行、日期和报表类型。');
    }

    return {
      dbPath: resolvedDbPath,
      availableReportTypes: reportTypes,
      canonical,
      totals: {
        canonical: canonicalTotals,
        actionableNaiveSum: actionableTotals,
        breakdownNaiveSum: breakdownTotals,
      },
      canonicalDelta,
      reportFiles,
      blockers,
    };
  } finally {
    db.close();
  }
}

function reconcile(evidencePath, options = {}) {
  const evidence = readJson(evidencePath);
  const manifestPath = findManifestPath(evidence);
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found from evidence: ${manifestPath || '-'}`);
  }

  const manifest = readJson(manifestPath);
  const files = (manifest.files || []).filter(isRealReportFile);
  const summaries = files.map(summarizeFile);
  const byType = new Map(summaries.map((summary) => [summary.reportType, summary]));
  const canonical = chooseCanonicalSummary(summaries);
  const duplicateSummaryRows = summaries.filter((summary) => REPORT_GROUPS.accountSummaryDuplicate.has(summary.reportType));
  const executableRows = summaries.filter((summary) => REPORT_GROUPS.optimizationExecutable.has(summary.reportType));
  const targetingBreakdownRows = summaries.filter((summary) => REPORT_GROUPS.targetingBreakdown.has(summary.reportType));
  const scope = {
    dateStart: firstDefined(evidence.request?.start, evidence.batch?.dateStart, manifest.batch?.dateStart),
    dateEnd: firstDefined(evidence.request?.end, evidence.batch?.dateEnd, manifest.batch?.dateEnd),
    storeName: firstDefined(evidence.request?.storeName, evidence.batch?.storeName, manifest.batch?.storeName),
    marketplaceCode: firstDefined(evidence.request?.marketplaceCode, evidence.batch?.marketplaceCode, manifest.batch?.marketplaceCode),
  };
  const result = {
    evidencePath: path.resolve(evidencePath),
    manifestPath,
    batch: manifest.batch || evidence.batch || evidence.result?.batch,
    scope,
    manifestFileCount: (manifest.files || []).length,
    realReportFileCount: files.length,
    summaries,
    blockers: summaries
      .filter((summary) => summary.missingRequiredMetricColumns.length > 0)
      .map((summary) => `${summary.reportType} report is missing required metric columns: ${summary.missingRequiredMetricColumns.join(', ')}.`),
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
  result.db = reconcileDb(options.dbPath, result.batch, scope, canonical);
  return result;
}

if (require.main === module) {
  const evidencePath = process.argv[2];
  if (!evidencePath) {
    console.error('Usage: node scripts/reconcile-lingxing-full8-data.js <desktop-live-full-8-e2e.json> [--out output.json]');
    process.exit(1);
  }

  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';
  const dbIndex = process.argv.indexOf('--db');
  const dbPath = dbIndex >= 0 ? process.argv[dbIndex + 1] : '';
  const result = reconcile(path.resolve(evidencePath), { dbPath });

  console.log(JSON.stringify({
    scope: result.scope,
    batchId: result.batch?.id,
    realReportFileCount: result.realReportFileCount,
    canonicalTotal: result.totals.canonicalTotal,
    dbCanonicalTotal: result.db?.totals?.canonical,
    dbCanonicalDelta: result.db?.canonicalDelta,
    dbBlockers: result.db?.blockers,
    blockers: result.blockers,
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
