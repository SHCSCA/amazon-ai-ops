import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const requireLocalDb = createRequire(path.join(root, 'packages', 'local-db', 'package.json'));
const Database = requireLocalDb('better-sqlite3');

function writePng(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return filePath;
}

function writeReport(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'temporary real SQLite authority report fixture\n', 'utf8');
  return filePath;
}

export function createValidAdReadbackEvidence(dir, overrides = {}) {
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
      scope: 'FT-US-US / US / B0TESTASIN / 2026-06-01~2026-06-10 / batch_1',
      confirmedAt: now,
      approverName: 'Ops Owner',
      approvalArtifactPath: writePng(path.join(dir, 'approval.png')),
      note: 'Approved one bounded manual Ads UI action.',
    },
    target: {
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      portfolioName: 'Portfolio A',
      asin: 'B0TESTASIN',
      metricDate: '2026-06-10',
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
      metricDate: '2026-06-10',
      sourceFiles: [writeReport(path.join(dir, 'user-search-term.xlsx'))],
      sourceRow: 12,
      evidencePath: 'output/codex-evidence/installed-ad-ai-explanation.json',
      entityType: 'target',
      currentValue: '2.40',
      recommendedValue: '2.16',
    },
    ...overrides,
  };
}

export function writeAdReadbackAuthorityDb(dir, evidence, overrides = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'amazon-ai-ops.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE action_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      asin TEXT,
      msku TEXT,
      entity_type TEXT,
      entity_id TEXT,
      entity_name TEXT,
      action_type TEXT,
      current_value TEXT,
      recommended_value TEXT,
      reason TEXT,
      evidence_json TEXT,
      confidence REAL DEFAULT 0,
      risk_level TEXT DEFAULT 'APPROVAL',
      status TEXT DEFAULT 'pending',
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
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
      file_path TEXT,
      file_size_bytes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ad_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT,
      report_type TEXT,
      date TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      asin TEXT,
      campaign_name TEXT,
      ad_group_name TEXT,
      targeting TEXT,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      orders INTEGER DEFAULT 0,
      sales REAL DEFAULT 0,
      source_file TEXT,
      source_row INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const {
    recommendationEvidence: recommendationEvidenceOverrides,
    omitBatch,
    omitReportFiles,
    omitMetrics,
    ...rowOverrides
  } = overrides;
  const approvalScope = {
    dateFrom: evidence.authority.dateFrom,
    dateTo: evidence.authority.dateTo,
    storeName: evidence.authority.storeName,
    marketplaceCode: evidence.authority.marketplaceCode,
    asin: evidence.authority.asin,
  };
  const row = {
    id: evidence.authority.recommendationId,
    storeName: evidence.target.storeName,
    marketplaceCode: evidence.target.marketplaceCode,
    asin: evidence.target.asin,
    entityType: evidence.target.entityType,
    entityId: 'target-1',
    entityName: evidence.target.entityName,
    actionType: evidence.target.actionType,
    currentValue: evidence.source.currentValue,
    recommendedValue: evidence.source.recommendedValue,
    reason: evidence.risk.rationale,
    status: 'approved',
    revision: evidence.authority.recommendationRevision,
    riskLevel: 'APPROVAL',
    updatedAt: String(evidence.authority.checkedAt).replace('T', ' ').replace(/\.\d{3}Z$/, ''),
    ...rowOverrides,
  };
  const recommendationEvidence = {
    date: evidence.source.metricDate,
    portfolioName: evidence.target.portfolioName || '',
    campaignName: evidence.target.campaignName,
    adGroupName: evidence.target.adGroupName,
    targeting: evidence.target.entityName,
    batchId: evidence.authority.batchId,
    sourceFiles: evidence.source.sourceFiles,
    sourceRow: evidence.source.sourceRow,
    approvalDecision: {
      decision: 'approved',
      approvedBy: evidence.approval.approverName,
      decidedAt: evidence.approval.confirmedAt,
      note: evidence.approval.note || '',
      batchId: evidence.authority.batchId,
      sourceBatchId: evidence.authority.batchId,
      metricDate: evidence.source.metricDate,
      sourceRow: evidence.source.sourceRow,
      sourceFiles: evidence.source.sourceFiles,
      scope: approvalScope,
    },
    ...(recommendationEvidenceOverrides || {}),
  };
  db.prepare(`
    INSERT INTO action_recommendations (
      id, task_id, store_name, marketplace_code, asin, msku,
      entity_type, entity_id, entity_name, action_type,
      current_value, recommended_value, reason, evidence_json,
      confidence, risk_level, status, revision, updated_at
    ) VALUES (
      @id, 'task-1', @storeName, @marketplaceCode, @asin, 'MSKU-1',
      @entityType, @entityId, @entityName, @actionType,
      @currentValue, @recommendedValue, @reason, @evidenceJson,
      0.8, @riskLevel, @status, @revision, datetime(@updatedAt)
    )
  `).run({ ...row, evidenceJson: JSON.stringify(recommendationEvidence) });
  const sourceFiles = Array.isArray(evidence.source?.sourceFiles) ? evidence.source.sourceFiles : [];
  const downloadDir = sourceFiles[0] ? path.dirname(path.resolve(sourceFiles[0])) : dir;
  if (!omitBatch) {
    db.prepare(`
      INSERT INTO lingxing_report_batches (
        id, app_version, date_start, date_end, store_name, marketplace_code,
        status, download_dir, completed_at
      ) VALUES (
        @id, '1.5.0', @dateFrom, @dateTo, @storeName, @marketplaceCode,
        'completed', @downloadDir, datetime(@completedAt)
      )
    `).run({
      id: evidence.authority.batchId,
      dateFrom: evidence.authority.dateFrom,
      dateTo: evidence.authority.dateTo,
      storeName: evidence.authority.storeName,
      marketplaceCode: evidence.authority.marketplaceCode,
      downloadDir,
      completedAt: evidence.authority.checkedAt,
    });
  }
  if (!omitReportFiles) {
    const insertFile = db.prepare(`
      INSERT INTO lingxing_report_files (
        id, batch_id, report_type, display_name, status, file_path, file_size_bytes
      ) VALUES (?, ?, 'user_search_term', '用户搜索词', 'imported', ?, ?)
    `);
    sourceFiles.forEach((filePath, index) => {
      const resolved = path.resolve(filePath);
      insertFile.run(
        `report-file-${index + 1}`,
        evidence.authority.batchId,
        resolved,
        fs.existsSync(resolved) ? fs.statSync(resolved).size : 0,
      );
    });
  }
  if (!omitMetrics) {
    const insertMetric = db.prepare(`
      INSERT INTO ad_daily_metrics (
        batch_id, report_type, date, store_name, marketplace_code, asin,
        campaign_name, ad_group_name, targeting,
        impressions, clicks, cost, orders, sales, source_file, source_row
      ) VALUES (
        @batchId, 'user_search_term', @metricDate, @storeName, @marketplaceCode, @asin,
        @campaignName, @adGroupName, @targeting,
        1000, 30, 40, 1, 60, @sourceFile, @sourceRow
      )
    `);
    sourceFiles.forEach((filePath) => insertMetric.run({
      batchId: evidence.authority.batchId,
      metricDate: evidence.source.metricDate,
      storeName: evidence.authority.storeName,
      marketplaceCode: evidence.authority.marketplaceCode,
      asin: evidence.authority.asin,
      campaignName: evidence.target.campaignName,
      adGroupName: evidence.target.adGroupName,
      targeting: evidence.target.entityName,
      sourceFile: path.resolve(filePath),
      sourceRow: evidence.source.sourceRow,
    }));
  }
  db.close();
  return dbPath;
}

export function executeAdReadbackAuthorityDb(dbPath, sql, params = []) {
  const db = new Database(dbPath);
  try {
    return db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}
