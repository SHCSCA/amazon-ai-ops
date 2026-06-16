const fs = require('fs');
const path = require('path');

const EXPECTED_REPORT_TYPES = [
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
];

const REAL_REPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const EXECUTABLE_REPORT_TYPES = new Set(['keyword', 'user_search_term', 'search_term', 'product_targeting', 'auto_targeting']);

function parseArgs(argv) {
  const args = { json: false, write: true, db: '', batch: '', dateFrom: '', dateTo: '', storeName: '', marketplaceCode: '' };
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json') args.json = true;
    else if (item === '--no-write') args.write = false;
    else if (item === '--db') args.db = argv[++index] || '';
    else if (item === '--batch') args.batch = argv[++index] || '';
    else if (item === '--date-from') args.dateFrom = argv[++index] || '';
    else if (item === '--date-to') args.dateTo = argv[++index] || '';
    else if (item === '--store') args.storeName = argv[++index] || '';
    else if (item === '--site') args.marketplaceCode = argv[++index] || '';
  }
  return args;
}

function requireSqlite() {
  const candidates = [
    'better-sqlite3',
    path.join(__dirname, '..', 'apps', 'desktop', 'node_modules', 'better-sqlite3'),
    path.join(__dirname, '..', 'packages', 'local-db', 'node_modules', 'better-sqlite3'),
    path.join(__dirname, '..', 'node_modules', '.pnpm', 'node_modules', 'better-sqlite3'),
  ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`Missing dependency better-sqlite3. Tried ${errors.join(' | ')}`);
}

function appDataDbCandidates() {
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, '@amazon-ai-ops', 'desktop', 'amazon-ai-ops.db'));
  }
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'AmazonAIOps', 'app-data', 'amazon-ai-ops.db'));
  }
  return candidates;
}

function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
  return Boolean(row);
}

function getColumns(db, tableName) {
  if (!tableExists(db, tableName)) return [];
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function pickColumn(columns, names) {
  return names.find((name) => columns.includes(name)) || '';
}

function isRealReportFile(filePath) {
  if (!filePath) return false;
  const extension = path.extname(filePath).toLowerCase();
  if (!REAL_REPORT_EXTENSIONS.has(extension)) return false;
  return !/(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i.test(filePath);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function openDatabase(dbPath) {
  const Database = requireSqlite();
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function chooseDbPath(args) {
  if (args.db) {
    if (!fs.existsSync(args.db)) throw new Error(`DB does not exist: ${args.db}`);
    return args.db;
  }
  const candidates = appDataDbCandidates();
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) throw new Error(`No app database found. Checked: ${candidates.join(', ')}`);
  return existing;
}

function buildBatchSelectSql(batchColumns, filters) {
  const idColumn = pickColumn(batchColumns, ['batch_id', 'id']);
  const startColumn = pickColumn(batchColumns, ['date_start', 'start_date']);
  const endColumn = pickColumn(batchColumns, ['date_end', 'end_date']);
  const storeColumn = pickColumn(batchColumns, ['store_name']);
  const siteColumn = pickColumn(batchColumns, ['marketplace_code']);
  const folderColumn = pickColumn(batchColumns, ['download_dir', 'folder_path']);
  const manifestColumn = pickColumn(batchColumns, ['manifest_path']);
  const completedColumn = pickColumn(batchColumns, ['completed_at', 'finished_at', 'updated_at', 'created_at']);
  const statusColumn = pickColumn(batchColumns, ['status']);
  const createdColumn = pickColumn(batchColumns, ['created_at', 'started_at']);
  const where = [];
  const params = {};

  if (filters.batch) {
    where.push(`${idColumn} = @batch`);
    params.batch = filters.batch;
  }
  if (filters.dateFrom && startColumn) {
    where.push(`${startColumn} = @dateFrom`);
    params.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo && endColumn) {
    where.push(`${endColumn} = @dateTo`);
    params.dateTo = filters.dateTo;
  }
  if (filters.storeName && storeColumn) {
    where.push(`${storeColumn} = @storeName`);
    params.storeName = filters.storeName;
  }
  if (filters.marketplaceCode && siteColumn) {
    where.push(`${siteColumn} = @marketplaceCode`);
    params.marketplaceCode = filters.marketplaceCode;
  }
  if (statusColumn) {
    where.push(`${statusColumn} IN ('completed', 'downloaded', 'ready')`);
  }

  return {
    sql: `
      SELECT
        ${idColumn} AS id,
        ${startColumn ? `${startColumn}` : "''"} AS dateFrom,
        ${endColumn ? `${endColumn}` : "''"} AS dateTo,
        ${storeColumn ? `${storeColumn}` : "''"} AS storeName,
        ${siteColumn ? `${siteColumn}` : "''"} AS marketplaceCode,
        ${folderColumn ? `${folderColumn}` : "''"} AS downloadDir,
        ${manifestColumn ? `${manifestColumn}` : "''"} AS manifestPath,
        ${statusColumn ? `${statusColumn}` : "''"} AS status,
        ${createdColumn ? `${createdColumn}` : "''"} AS createdAt,
        ${completedColumn ? `${completedColumn}` : "''"} AS completedAt
      FROM lingxing_report_batches
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(${completedColumn || createdColumn || idColumn}, '') DESC, ${idColumn} DESC
      LIMIT 1
    `,
    params,
  };
}

function findLatestBatch(db, args) {
  const batchColumns = getColumns(db, 'lingxing_report_batches');
  if (!batchColumns.length) return { batch: null, warnings: ['missing lingxing_report_batches table'] };
  const idColumn = pickColumn(batchColumns, ['batch_id', 'id']);
  if (!idColumn) return { batch: null, warnings: ['lingxing_report_batches has no id/batch_id column'] };
  const query = buildBatchSelectSql(batchColumns, args);
  const batch = db.prepare(query.sql).get(query.params) || null;
  return { batch, warnings: [] };
}

function summarizeReportFiles(db, batchId) {
  const tableName = tableExists(db, 'lingxing_report_files') ? 'lingxing_report_files' : tableExists(db, 'report_files') ? 'report_files' : '';
  if (!tableName) {
    return {
      tableName: '',
      rows: [],
      rawReportFileCount: 0,
      downloadedReportTypes: [],
      missingReportTypes: EXPECTED_REPORT_TYPES,
      warnings: ['missing lingxing_report_files/report_files table'],
    };
  }
  const columns = getColumns(db, tableName);
  const filePathColumn = pickColumn(columns, ['file_path', 'path']);
  const fileNameColumn = pickColumn(columns, ['file_name']);
  const typeColumn = pickColumn(columns, ['report_type', 'type']);
  const statusColumn = pickColumn(columns, ['status', 'parse_status']);
  const sizeColumn = pickColumn(columns, ['file_size_bytes', 'size_bytes']);
  const parsedRowsColumn = pickColumn(columns, ['parsed_rows', 'imported_rows']);
  const where = columns.includes('batch_id') && batchId ? 'WHERE batch_id = @batchId' : '';
  const select = `
    SELECT
      ${typeColumn ? `${typeColumn}` : "''"} AS reportType,
      ${filePathColumn ? `${filePathColumn}` : "''"} AS filePath,
      ${fileNameColumn ? `${fileNameColumn}` : "''"} AS fileName,
      ${statusColumn ? `${statusColumn}` : "''"} AS status,
      ${sizeColumn ? `${sizeColumn}` : '0'} AS fileSizeBytes,
      ${parsedRowsColumn ? `${parsedRowsColumn}` : '0'} AS parsedRows
    FROM ${tableName}
    ${where}
  `;
  const rows = db.prepare(select).all({ batchId }).map((row) => {
    const filePath = row.filePath || row.fileName || '';
    const exists = filePath ? fs.existsSync(filePath) : false;
    const realReport = isRealReportFile(filePath);
    return {
      reportType: row.reportType || 'unknown',
      filePath,
      status: row.status || '',
      fileSizeBytes: safeNumber(row.fileSizeBytes),
      parsedRows: safeNumber(row.parsedRows),
      exists,
      realReport,
    };
  });
  const realRows = rows.filter((row) => row.realReport);
  const downloadedReportTypes = Array.from(new Set(realRows.map((row) => row.reportType))).sort();
  const missingReportTypes = EXPECTED_REPORT_TYPES.filter((type) => !downloadedReportTypes.includes(type));
  return {
    tableName,
    rows,
    rawReportFileCount: realRows.length,
    downloadedReportTypes,
    missingReportTypes,
    warnings: realRows.some((row) => !row.exists) ? ['some report file paths do not exist on disk'] : [],
  };
}

function summarizeMetrics(db, batchId, args) {
  if (!tableExists(db, 'ad_daily_metrics')) {
    return { importedMetricRows: 0, byReportType: [], canonical: null, warnings: ['missing ad_daily_metrics table'] };
  }
  const columns = getColumns(db, 'ad_daily_metrics');
  const where = [];
  const params = {};
  if (batchId && columns.includes('batch_id')) {
    where.push('batch_id = @batchId');
    params.batchId = batchId;
  }
  if (args.dateFrom && columns.includes('date')) {
    where.push('date >= @dateFrom');
    params.dateFrom = args.dateFrom;
  }
  if (args.dateTo && columns.includes('date')) {
    where.push('date <= @dateTo');
    params.dateTo = args.dateTo;
  }
  if (args.storeName && columns.includes('store_name')) {
    where.push('store_name = @storeName');
    params.storeName = args.storeName;
  }
  if (args.marketplaceCode && columns.includes('marketplace_code')) {
    where.push('marketplace_code = @marketplaceCode');
    params.marketplaceCode = args.marketplaceCode;
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const reportTypeExpr = columns.includes('report_type') ? "COALESCE(report_type, 'unknown')" : "'unknown'";
  const byReportType = db.prepare(`
    SELECT
      ${reportTypeExpr} AS reportType,
      COUNT(*) AS rows,
      MIN(${columns.includes('date') ? 'date' : 'NULL'}) AS firstDate,
      MAX(${columns.includes('date') ? 'date' : 'NULL'}) AS lastDate,
      SUM(${columns.includes('cost') ? 'cost' : '0'}) AS spendUsd,
      SUM(${columns.includes('sales') ? 'sales' : '0'}) AS salesUsd,
      SUM(${columns.includes('orders') ? 'orders' : '0'}) AS orders,
      SUM(${columns.includes('clicks') ? 'clicks' : '0'}) AS clicks
    FROM ad_daily_metrics
    ${whereSql}
    GROUP BY ${reportTypeExpr}
    ORDER BY rows DESC
  `).all(params).map((row) => ({
    reportType: row.reportType,
    rows: safeNumber(row.rows),
    firstDate: row.firstDate || '',
    lastDate: row.lastDate || '',
    spendUsd: safeNumber(row.spendUsd),
    salesUsd: safeNumber(row.salesUsd),
    orders: safeNumber(row.orders),
    clicks: safeNumber(row.clicks),
  }));
  const importedMetricRows = byReportType.reduce((sum, row) => sum + row.rows, 0);
  const canonical = byReportType.find((row) => row.reportType === 'user_search_term')
    || byReportType.find((row) => row.reportType === 'search_term')
    || byReportType.find((row) => row.reportType === 'keyword')
    || byReportType.find((row) => EXECUTABLE_REPORT_TYPES.has(row.reportType))
    || null;
  return {
    importedMetricRows,
    byReportType,
    canonical,
    warnings: importedMetricRows > 0 && !canonical ? ['no executable/canonical report type found for recommendations'] : [],
  };
}

function diagnose(args) {
  const dbPath = chooseDbPath(args);
  const db = openDatabase(dbPath);
  try {
    const warnings = [];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
    if (!tables.includes('operation_events')) warnings.push('operation_events table is missing; AI context may lack promotion/discount/event notes');
    const { batch, warnings: batchWarnings } = findLatestBatch(db, args);
    warnings.push(...batchWarnings);
    const batchId = batch?.id || args.batch || '';
    const reportFiles = summarizeReportFiles(db, batchId);
    const metrics = summarizeMetrics(db, batchId, {
      ...args,
      dateFrom: args.dateFrom || batch?.dateFrom || '',
      dateTo: args.dateTo || batch?.dateTo || '',
      storeName: args.storeName || batch?.storeName || '',
      marketplaceCode: args.marketplaceCode || batch?.marketplaceCode || '',
    });
    warnings.push(...reportFiles.warnings, ...metrics.warnings);
    let status = 'READY_FOR_ANALYSIS';
    if (!batch) status = 'NO_BATCH';
    else if (reportFiles.rawReportFileCount <= 0) status = 'MISSING_REAL_REPORT_FILES';
    else if (metrics.importedMetricRows <= 0) status = 'NO_IMPORTED_METRICS';
    else if (reportFiles.missingReportTypes.length > 0) status = 'PARTIAL_REPORT_FILES';

    return {
      generatedAt: new Date().toISOString(),
      status,
      dbPath,
      batch,
      scope: {
        dateFrom: args.dateFrom || batch?.dateFrom || '',
        dateTo: args.dateTo || batch?.dateTo || '',
        storeName: args.storeName || batch?.storeName || '',
        marketplaceCode: args.marketplaceCode || batch?.marketplaceCode || '',
        currency: 'USD',
      },
      tables: {
        hasLingxingReportBatches: tables.includes('lingxing_report_batches'),
        reportFileTable: reportFiles.tableName,
        hasAdDailyMetrics: tables.includes('ad_daily_metrics'),
        hasOperationEvents: tables.includes('operation_events'),
      },
      rawReportFileCount: reportFiles.rawReportFileCount,
      downloadedReportTypes: reportFiles.downloadedReportTypes,
      missingReportTypes: reportFiles.missingReportTypes,
      reportFiles: reportFiles.rows,
      importedMetricRows: metrics.importedMetricRows,
      canonicalReportTypes: metrics.canonical ? [metrics.canonical.reportType] : [],
      canonicalSummary: metrics.canonical,
      metricsByReportType: metrics.byReportType,
      warnings,
    };
  } finally {
    db.close();
  }
}

function writeEvidence(result) {
  const evidenceDir = path.join(__dirname, '..', 'output', 'codex-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const outputPath = path.join(evidenceDir, `business-data-real-evidence-${Date.now()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return outputPath;
}

function main() {
  const args = parseArgs(process.argv);
  const result = diagnose(args);
  const evidencePath = args.write ? writeEvidence(result) : '';
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ...result, evidencePath }, null, 2)}\n`);
    return;
  }
  console.log(`[${result.status}] ${result.rawReportFileCount}/8 real report files, ${result.importedMetricRows} imported metric rows`);
  console.log(`DB: ${result.dbPath}`);
  console.log(`Batch: ${result.batch?.id || '-'}`);
  if (result.canonicalSummary) {
    console.log(`Canonical: ${result.canonicalSummary.reportType}, spend USD ${result.canonicalSummary.spendUsd.toFixed(2)}, orders ${result.canonicalSummary.orders}`);
  }
  if (result.warnings.length) {
    console.log(`Warnings: ${result.warnings.join('; ')}`);
  }
  if (evidencePath) console.log(`Evidence: ${evidencePath}`);
}

main();
