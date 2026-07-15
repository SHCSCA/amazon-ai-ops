const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function text(value) {
  return String(value ?? '').trim();
}

function normalizedText(value) {
  return text(value).toLowerCase();
}

function normalizedAsin(value) {
  return text(value).toUpperCase();
}

function normalizedPath(value) {
  return path.resolve(text(value)).replace(/\\/g, '/').toLowerCase();
}

function timestampMs(value) {
  const input = text(value);
  if (!input) return Number.NaN;
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(input)
    ? `${input.replace(' ', 'T')}Z`
    : input;
  return Date.parse(sqliteUtc);
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function samePathSet(left, right) {
  const normalizedLeft = [...new Set(stringArray(left).map(normalizedPath))].sort();
  const normalizedRight = [...new Set(stringArray(right).map(normalizedPath))].sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function defaultDbCandidates(env = process.env) {
  const candidates = [];
  if (env.APPDATA) {
    candidates.push(path.join(env.APPDATA, '@amazon-ai-ops', 'desktop', 'amazon-ai-ops.db'));
    candidates.push(path.join(env.APPDATA, 'Amazon AI Ops Agent', 'amazon-ai-ops.db'));
    candidates.push(path.join(env.APPDATA, 'AmazonAIOpsAgent', 'amazon-ai-ops.db'));
    candidates.push(path.join(env.APPDATA, 'Amazon AI Ops', 'amazon-ai-ops.db'));
  }
  if (env.USERPROFILE) {
    candidates.push(path.join(env.USERPROFILE, 'AmazonAIOps', 'app-data', 'amazon-ai-ops.db'));
  }
  return [...new Set(candidates.map((item) => path.resolve(item)))];
}

function resolveAdReadbackAuthorityDbPath(explicitPath, env = process.env) {
  const selectedOverride = explicitPath || env.AMAZON_AI_OPS_DB_PATH;
  if (selectedOverride) {
    const resolved = path.resolve(selectedOverride);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`SQLite authority database does not exist: ${resolved}`);
    }
    return fs.realpathSync.native(resolved);
  }

  const candidates = defaultDbCandidates(env);
  const existing = candidates.filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (existing.length === 0) {
    throw new Error(
      `SQLite authority database was not found. Pass --db <amazon-ai-ops.db>. Checked: ${candidates.join(', ') || '<none>'}`,
    );
  }
  const uniqueExisting = [...new Set(existing.map((candidate) => fs.realpathSync.native(candidate).toLowerCase()))];
  if (uniqueExisting.length > 1) {
    throw new Error(
      `Default discovery found multiple SQLite authority databases. Pass --db <amazon-ai-ops.db>. Found: ${existing.join(', ')}`,
    );
  }
  return fs.realpathSync.native(existing[0]);
}

function sameAuthorityDbPath(left, right) {
  if (!left || !right) return false;
  return normalizedPath(fs.realpathSync.native(path.resolve(left)))
    === normalizedPath(fs.realpathSync.native(path.resolve(right)));
}

function resolveBoundAdReadbackAuthorityDbPath(recordedPath, explicitPath) {
  if (!recordedPath) {
    throw new Error('Final readiness does not record a SQLite authority database path. Rerun verify:v15-final-readiness.');
  }
  const recorded = resolveAdReadbackAuthorityDbPath(recordedPath, {});
  if (!explicitPath) return recorded;

  const explicit = resolveAdReadbackAuthorityDbPath(explicitPath, {});
  if (!sameAuthorityDbPath(recorded, explicit)) {
    throw new Error(
      `SQLite authority database mismatch: final readiness recorded ${recorded}, but --db selected ${explicit}.`,
    );
  }
  return recorded;
}

function requireSqlite() {
  try {
    return require('better-sqlite3');
  } catch (rootError) {
    const localDbPackage = path.join(root, 'packages', 'local-db', 'package.json');
    try {
      return createRequire(localDbPackage)('better-sqlite3');
    } catch (localError) {
      const error = new Error(`better-sqlite3 unavailable: ${localError.message || rootError.message}`);
      error.cause = localError;
      throw error;
    }
  }
}

function querySqliteWithPython(dbPath, sql, params = []) {
  const python = String.raw`
import json
import sqlite3
import sys

request = json.load(sys.stdin)
connection = sqlite3.connect(f"file:{request['dbPath']}?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
try:
    rows = connection.execute(request["sql"], request.get("params", [])).fetchall()
    print(json.dumps([dict(row) for row in rows], ensure_ascii=False))
finally:
    connection.close()
`;
  const result = spawnSync('python', ['-X', 'utf8', '-c', python], {
    input: JSON.stringify({ dbPath, sql, params }),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (result.status !== 0) {
    throw new Error(`SQLite read-only query failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return JSON.parse(result.stdout || '[]');
}

function openReadonlyDb(dbPath) {
  try {
    const Database = requireSqlite();
    return new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    return {
      prepare(sql) {
        return {
          get(...params) {
            return querySqliteWithPython(dbPath, sql, params)[0];
          },
          all(...params) {
            return querySqliteWithPython(dbPath, sql, params);
          },
        };
      },
      close() {},
      fallbackReason: String(error?.message || error),
    };
  }
}

function parseRecommendationEvidence(row) {
  try {
    const parsed = JSON.parse(row?.evidence_json || '{}');
    return objectOrEmpty(parsed);
  } catch {
    throw new Error('SQLite recommendation evidence_json is invalid JSON.');
  }
}

function assertEqual(actual, expected, label, normalize = text) {
  if (normalize(actual) !== normalize(expected)) {
    throw new Error(`SQLite authority mismatch: ${label}.`);
  }
}

function recommendationObjectName(row, recommendationEvidence) {
  return text(recommendationEvidence.searchTerm)
    || text(recommendationEvidence.targeting)
    || text(row.entity_name);
}

function assertTargetMatches(evidence, row, recommendationEvidence) {
  const target = objectOrEmpty(evidence.target);
  assertEqual(target.storeName, row.store_name, 'target.storeName', normalizedText);
  assertEqual(target.marketplaceCode, row.marketplace_code, 'target.marketplaceCode', normalizedText);
  assertEqual(target.asin, row.asin || recommendationEvidence.asin, 'target.asin', normalizedAsin);
  assertEqual(target.portfolioName, recommendationEvidence.portfolioName, 'target.portfolioName');
  assertEqual(target.metricDate, recommendationEvidence.date, 'target.metricDate');
  assertEqual(target.campaignName, recommendationEvidence.campaignName, 'target.campaignName');
  assertEqual(target.adGroupName, recommendationEvidence.adGroupName, 'target.adGroupName');
  assertEqual(target.entityType, row.entity_type, 'target.entityType');
  assertEqual(target.entityName, recommendationObjectName(row, recommendationEvidence), 'target.entityName');
  assertEqual(target.actionType, row.action_type, 'target.actionType');
}

function assertSourceMatches(evidence, row, recommendationEvidence, authority) {
  const source = objectOrEmpty(evidence.source);
  assertEqual(source.recommendationId, authority.recommendationId, 'source.recommendationId');
  if (Number(source.recommendationRevision) !== Number(row.revision)) {
    throw new Error('SQLite authority mismatch: source.recommendationRevision.');
  }
  assertEqual(source.batchId, recommendationEvidence.batchId, 'source.batchId');
  assertEqual(source.metricDate, recommendationEvidence.date, 'source.metricDate');
  if (Number(source.sourceRow) !== Number(recommendationEvidence.sourceRow)) {
    throw new Error('SQLite authority mismatch: source.sourceRow.');
  }
  if (!samePathSet(source.sourceFiles, recommendationEvidence.sourceFiles)) {
    throw new Error('SQLite authority mismatch: source.sourceFiles.');
  }
  assertEqual(source.entityType, row.entity_type, 'source.entityType');
  assertEqual(source.currentValue, row.current_value, 'source.currentValue');
  assertEqual(source.recommendedValue, row.recommended_value, 'source.recommendedValue');
}

function approvalScopeText(authority) {
  return [
    authority.storeName,
    authority.marketplaceCode,
    authority.asin,
    `${authority.dateFrom}~${authority.dateTo}`,
    authority.batchId,
  ].map(text).filter(Boolean).join(' / ');
}

function assertApprovalMatches(evidence, recommendationEvidence, authority) {
  const approval = objectOrEmpty(evidence.approval);
  const decision = objectOrEmpty(recommendationEvidence.approvalDecision);
  const scope = objectOrEmpty(decision.scope);
  assertEqual(decision.decision, 'approved', 'approvalDecision.decision');
  assertEqual(decision.batchId, authority.batchId, 'approvalDecision.batchId');
  assertEqual(decision.sourceBatchId, authority.batchId, 'approvalDecision.sourceBatchId');
  assertEqual(decision.metricDate, recommendationEvidence.date, 'approvalDecision.metricDate');
  if (Number(decision.sourceRow) !== Number(recommendationEvidence.sourceRow)) {
    throw new Error('SQLite authority mismatch: approvalDecision.sourceRow.');
  }
  if (!samePathSet(decision.sourceFiles, recommendationEvidence.sourceFiles)) {
    throw new Error('SQLite authority mismatch: approvalDecision.sourceFiles.');
  }
  assertEqual(scope.dateFrom, authority.dateFrom, 'authority.dateFrom');
  assertEqual(scope.dateTo, authority.dateTo, 'authority.dateTo');
  assertEqual(scope.storeName, authority.storeName, 'approval scope storeName', normalizedText);
  assertEqual(scope.marketplaceCode, authority.marketplaceCode, 'approval scope marketplaceCode', normalizedText);
  assertEqual(scope.asin, authority.asin, 'approval scope asin', normalizedAsin);
  assertEqual(approval.approverName, decision.approvedBy, 'approval.approverName');
  assertEqual(approval.confirmedAt, decision.decidedAt, 'approval.confirmedAt');
  assertEqual(approval.note, decision.note, 'approval.note');
  assertEqual(approval.scope, approvalScopeText(authority), 'approval.scope');
}

const REAL_REPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const REJECTED_EVIDENCE_NAME = /(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i;
const ACTIONABLE_REPORT_TYPES = ['keyword', 'product_targeting', 'auto_targeting', 'user_search_term', 'search_term'];

function isPathWithinDirectory(candidatePath, parentDir) {
  try {
    const realCandidate = fs.realpathSync(candidatePath);
    const realParent = fs.realpathSync(parentDir);
    const relative = path.relative(path.resolve(realParent), realCandidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function isCurrentRealReportFile(file, batch) {
  if (!['downloaded', 'imported', 'import_failed'].includes(text(file.status))) return false;
  const filePath = text(file.file_path);
  if (!REAL_REPORT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return false;
  if (REJECTED_EVIDENCE_NAME.test(path.basename(filePath))) return false;
  try {
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    return Boolean(stat?.isFile() && stat.size > 0 && isPathWithinDirectory(filePath, batch.download_dir));
  } catch {
    return false;
  }
}

function metricSourceCandidates(filePaths) {
  const candidates = [];
  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath);
    candidates.push(filePath, resolved);
    try {
      candidates.push(fs.realpathSync.native(resolved));
    } catch {
      // Existing-file validation reports the useful error before metrics are queried.
    }
  }
  return [...new Set(candidates.map(text).filter(Boolean))];
}

function assertCurrentPipelineAuthority(db, evidence, authority) {
  const batch = db.prepare('SELECT * FROM lingxing_report_batches WHERE id = ?').get(text(authority.batchId));
  if (!batch) {
    throw new Error(`SQLite current report batch does not exist: ${text(authority.batchId) || '<missing>'}.`);
  }
  if (!['completed', 'completed_with_errors'].includes(text(batch.status))) {
    throw new Error(`SQLite current report batch is not completed: ${text(batch.status) || '<missing>'}.`);
  }
  assertEqual(batch.date_start, authority.dateFrom, 'current batch dateFrom');
  assertEqual(batch.date_end, authority.dateTo, 'current batch dateTo');
  assertEqual(batch.store_name, authority.storeName, 'current batch storeName', normalizedText);
  assertEqual(batch.marketplace_code, authority.marketplaceCode, 'current batch marketplaceCode', normalizedText);

  const reportRows = db.prepare('SELECT * FROM lingxing_report_files WHERE batch_id = ?').all(text(authority.batchId));
  const realReportFiles = reportRows.filter((file) => isCurrentRealReportFile(file, batch));
  if (realReportFiles.length === 0) {
    throw new Error('SQLite current real report files are missing or ineligible for this batch.');
  }
  const allowedSourceFiles = metricSourceCandidates(realReportFiles.map((file) => file.file_path));
  const allowed = new Set(allowedSourceFiles.map(normalizedPath));
  const evidenceSourceFiles = stringArray(evidence.source?.sourceFiles);
  if (!evidenceSourceFiles.length || evidenceSourceFiles.some((filePath) => !allowed.has(normalizedPath(filePath)))) {
    throw new Error('SQLite authority mismatch: source files are not current real report files.');
  }

  const sourcePlaceholders = allowedSourceFiles.map(() => '?').join(', ');
  const reportPlaceholders = ACTIONABLE_REPORT_TYPES.map(() => '?').join(', ');
  const nullTypePatterns = [
    "lower(COALESCE(source_file, '')) LIKE '%keyword%'",
    "lower(COALESCE(source_file, '')) LIKE '%product%target%'",
    "lower(COALESCE(source_file, '')) LIKE '%asin%target%'",
    "lower(COALESCE(source_file, '')) LIKE '%auto%target%'",
    "lower(COALESCE(source_file, '')) LIKE '%search%term%'",
  ].join(' OR ');
  const params = [
    text(authority.dateFrom),
    text(authority.dateTo),
    text(authority.storeName),
    text(authority.marketplaceCode),
    ...allowedSourceFiles,
    text(authority.batchId),
    ...ACTIONABLE_REPORT_TYPES,
  ];
  let asinSql = '';
  if (text(authority.asin)) {
    asinSql = " AND upper(COALESCE(asin, '')) = upper(?)";
    params.push(text(authority.asin));
  }
  const metric = db.prepare(`
    SELECT COUNT(*) AS count
    FROM ad_daily_metrics
    WHERE date >= ?
      AND date <= ?
      AND COALESCE(store_name, '') = COALESCE(?, '')
      AND COALESCE(marketplace_code, '') = COALESCE(?, '')
      AND source_file IN (${sourcePlaceholders})
      AND batch_id = ?
      AND (
        report_type IN (${reportPlaceholders})
        OR (report_type IS NULL AND source_file IS NOT NULL AND (${nullTypePatterns}))
      )
      ${asinSql}
  `).get(...params);
  if (Number(metric?.count || 0) <= 0) {
    throw new Error('SQLite current batch has no imported actionable metrics for this authority scope.');
  }
}

function assertCurrentAdReadbackDbAuthority(evidence, options = {}) {
  const authority = objectOrEmpty(evidence?.authority);
  const recommendationId = Number(authority.recommendationId);
  const expectedRevision = Number(authority.recommendationRevision);
  if (!Number.isInteger(recommendationId) || recommendationId <= 0) {
    throw new Error('SQLite authority check requires a positive recommendationId.');
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('SQLite authority check requires a non-negative recommendationRevision.');
  }

  const dbPath = resolveAdReadbackAuthorityDbPath(options.dbPath, options.env);
  const db = openReadonlyDb(dbPath);
  try {
    const row = db.prepare('SELECT * FROM action_recommendations WHERE id = ?').get(recommendationId);
    if (!row) {
      throw new Error(`SQLite recommendation #${recommendationId} does not exist.`);
    }
    if (text(row.status) !== 'approved') {
      throw new Error(`SQLite recommendation #${recommendationId} is ${text(row.status) || '<missing>'}, not approved.`);
    }
    if (Number(row.revision) !== expectedRevision) {
      throw new Error(
        `SQLite recommendation #${recommendationId} revision is ${Number(row.revision)}, evidence expects ${expectedRevision}.`,
      );
    }
    const checkedAtMs = timestampMs(authority.checkedAt);
    const updatedAtMs = timestampMs(row.updated_at);
    if (!Number.isFinite(checkedAtMs) || !Number.isFinite(updatedAtMs) || checkedAtMs !== updatedAtMs) {
      throw new Error('SQLite authority mismatch: authority.checkedAt.');
    }

    assertEqual(row.store_name, authority.storeName, 'authority.storeName', normalizedText);
    assertEqual(row.marketplace_code, authority.marketplaceCode, 'authority.marketplaceCode', normalizedText);
    assertEqual(row.asin, authority.asin, 'authority.asin', normalizedAsin);

    const recommendationEvidence = parseRecommendationEvidence(row);
    assertEqual(recommendationEvidence.batchId, authority.batchId, 'authority.batchId');
    assertTargetMatches(evidence, row, recommendationEvidence);
    assertSourceMatches(evidence, row, recommendationEvidence, authority);
    assertApprovalMatches(evidence, recommendationEvidence, authority);
    assertEqual(evidence.risk?.rationale, row.reason, 'risk.rationale');
    const riskLevel = normalizedText(row.risk_level);
    if (riskLevel === 'high' || riskLevel === 'forbidden' || riskLevel.includes('forbidden')) {
      throw new Error(`SQLite recommendation #${recommendationId} risk level is not eligible: ${text(row.risk_level)}.`);
    }
    assertCurrentPipelineAuthority(db, evidence, authority);

    return {
      dbPath,
      recommendationId,
      recommendationRevision: expectedRevision,
      sqliteFallback: db.fallbackReason || null,
    };
  } finally {
    db.close();
  }
}

module.exports = {
  assertCurrentAdReadbackDbAuthority,
  defaultDbCandidates,
  resolveBoundAdReadbackAuthorityDbPath,
  resolveAdReadbackAuthorityDbPath,
  sameAuthorityDbPath,
};
