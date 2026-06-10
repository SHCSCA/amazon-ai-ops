const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');
const { reconcile } = require('./reconcile-lingxing-full8-data');

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

const REPORT_KEYWORDS = {
  campaign: 'campaign',
  ad_group: 'ad_group',
  placement: 'placement',
  advertised_product: 'advertised_product',
  auto_targeting: 'auto_targeting',
  keyword: 'keyword',
  product_targeting: 'product_targeting',
  user_search_term: 'search_term',
};

const repoRoot = path.resolve(__dirname, '..');
const evidenceDir = path.join(repoRoot, 'output', 'codex-evidence');

function fail(message) {
  return { ok: false, message };
}

function pass(message) {
  return { ok: true, message };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestFull8Evidence() {
  if (!fs.existsSync(evidenceDir)) return null;
  const files = fs.readdirSync(evidenceDir)
    .filter((name) => /^desktop-live-full-8-e2e-.*\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function appDataRoot() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, '@amazon-ai-ops', 'desktop');
}

function appDataDbPath() {
  const root = appDataRoot();
  return root ? path.join(root, 'amazon-ai-ops.db') : null;
}

function requireSqlite() {
  try {
    return require('better-sqlite3');
  } catch (error) {
    const localDbPackage = path.join(repoRoot, 'packages', 'local-db', 'package.json');
    if (fs.existsSync(localDbPackage)) return createRequire(localDbPackage)('better-sqlite3');
    throw error;
  }
}

function querySqliteWithPython(dbPath, sql, params = []) {
  const python = String.raw`
import json
import sqlite3
import sys

request = json.load(sys.stdin)
conn = sqlite3.connect(f"file:{request['dbPath']}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row
try:
    rows = conn.execute(request["sql"], request.get("params", [])).fetchall()
    print(json.dumps([dict(row) for row in rows], ensure_ascii=False))
finally:
    conn.close()
`;
  const result = spawnSync('python', ['-X', 'utf8', '-c', python], {
    input: JSON.stringify({ dbPath, sql, params }),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  if (result.status !== 0) {
    throw new Error(`python sqlite fallback failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout || '[]');
}

function openReadonlyDb(dbPath) {
  try {
    const Database = requireSqlite();
    return new Database(dbPath, { readonly: true });
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
      fallbackReason: error.message,
    };
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function collectBatch(data) {
  return firstDefined(
    data.batch,
    data.result?.batch,
    data.batchResult?.batch,
    data.collectionResult?.batch,
    data.reportBatchResult?.batch,
  );
}

function collectFiles(data) {
  return firstDefined(
    data.files,
    data.result?.files,
    data.batchResult?.files,
    data.collectionResult?.files,
    data.reportBatchResult?.files,
    data.batch?.files,
  ) || [];
}

function collectScope(data, dbBatch) {
  return {
    dateStart: firstDefined(data.scope?.dateStart, data.request?.start, data.request?.dateStart, dbBatch?.date_start),
    dateEnd: firstDefined(data.scope?.dateEnd, data.request?.end, data.request?.dateEnd, dbBatch?.date_end),
    storeName: firstDefined(data.scope?.storeName, data.request?.storeName, dbBatch?.store_name),
    marketplaceCode: firstDefined(data.scope?.marketplaceCode, data.request?.marketplaceCode, dbBatch?.marketplace_code),
  };
}

function normalizeDateToken(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizePath(value) {
  return path.resolve(String(value || ''));
}

function samePath(left, right) {
  return normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase();
}

function insidePath(child, parent) {
  if (!child || !parent) return false;
  const relative = path.relative(normalizePath(parent), normalizePath(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getManifestBatch(manifest) {
  return manifest?.batch || manifest || {};
}

function sortedTypes(items) {
  return [...items].sort().join(',');
}

function closeNumber(left, right, epsilon = 0.01) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= epsilon;
}

function totalsMatch(left, right, keys = ['spend', 'orders', 'sales', 'clicks']) {
  return keys.every((key) => closeNumber(left?.[key], right?.[key]));
}

function findAcceptanceAuditJson(data, batchId) {
  const explicit = firstDefined(
    data.acceptanceAuditJsonPath,
    data.acceptanceAuditPath,
    data.acceptanceAudit?.jsonPath,
    data.audit?.jsonPath,
    data.result?.acceptanceAuditJsonPath,
  );
  if (explicit) {
    const stat = fs.existsSync(explicit) ? fs.statSync(explicit) : null;
    return stat?.isDirectory() ? path.join(explicit, 'acceptance-audit.json') : explicit;
  }

  const explicitDir = firstDefined(
    data.acceptanceAuditDir,
    data.acceptanceAuditExportDir,
    data.acceptanceAudit?.exportDir,
    data.audit?.exportDir,
    data.result?.acceptanceAuditDir,
  );
  if (explicitDir) return path.join(explicitDir, 'acceptance-audit.json');

  const root = appDataRoot();
  if (!root || !batchId) return null;
  const exportsDir = path.join(root, 'storage', 'exports');
  if (!fs.existsSync(exportsDir)) return null;
  const candidates = fs.readdirSync(exportsDir)
    .filter((name) => name.startsWith(`lingxing_acceptance_audit_${batchId}_`))
    .map((name) => {
      const auditPath = path.join(exportsDir, name, 'acceptance-audit.json');
      return fs.existsSync(auditPath) ? { auditPath, mtimeMs: fs.statSync(auditPath).mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.auditPath || null;
}

function verifyDeliveryEvidence(evidencePath) {
  const checks = [];
  if (!evidencePath) return [fail('未找到 desktop-live-full-8-e2e-*.json 证据文件')];
  if (!fs.existsSync(evidencePath)) return [fail(`证据文件不存在：${evidencePath}`)];

  const data = readJson(evidencePath);
  checks.push(pass(`证据文件：${evidencePath}`));

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    checks.push(fail(`full-8 E2E 记录了错误：${data.errors[0]}`));
  } else {
    checks.push(pass('full-8 E2E 未记录 errors'));
  }

  const evidenceBatch = collectBatch(data);
  const batchId = firstDefined(evidenceBatch?.id, evidenceBatch?.batch_id, data.batchId, data.result?.batchId);
  if (!batchId) {
    checks.push(fail('证据缺少 full-8 batch id'));
    return checks;
  }
  checks.push(pass(`证据 batch id：${batchId}`));

  const dbPath = firstDefined(data.dbPath, appDataDbPath());
  if (!dbPath || !fs.existsSync(dbPath)) {
    checks.push(fail(`AppData DB 不存在：${dbPath || '-'}`));
    return checks;
  }
  checks.push(pass(`AppData DB 存在：${dbPath}`));

  const db = openReadonlyDb(dbPath);
  if (db.fallbackReason) {
    checks.push(pass(`better-sqlite3 不可用，已使用 Python sqlite3 只读 fallback：${db.fallbackReason.split('\n')[0]}`));
  }

  try {
    const dbBatch = db.prepare('select * from lingxing_report_batches where id = ?').get(batchId);
    if (!dbBatch) {
      checks.push(fail(`DB 缺少 lingxing_report_batches：${batchId}`));
      return checks;
    }

    const scope = collectScope(data, dbBatch);
    checks.push(dbBatch.status === 'completed' ? pass('DB batch.status = completed') : fail(`DB batch.status 不是 completed：${dbBatch.status}`));
    checks.push(dbBatch.app_version === '1.5.0' ? pass('DB batch.app_version = 1.5.0') : fail(`DB batch.app_version 不匹配：${dbBatch.app_version}`));
    checks.push(dbBatch.date_start === scope.dateStart ? pass('DB batch.date_start 匹配') : fail(`DB batch.date_start 不匹配：${dbBatch.date_start} vs ${scope.dateStart || '-'}`));
    checks.push(dbBatch.date_end === scope.dateEnd ? pass('DB batch.date_end 匹配') : fail(`DB batch.date_end 不匹配：${dbBatch.date_end} vs ${scope.dateEnd || '-'}`));
    checks.push(dbBatch.store_name === scope.storeName ? pass('DB batch.store_name 匹配') : fail(`DB batch.store_name 不匹配：${dbBatch.store_name} vs ${scope.storeName || '-'}`));
    checks.push(dbBatch.marketplace_code === scope.marketplaceCode ? pass('DB batch.marketplace_code 匹配') : fail(`DB batch.marketplace_code 不匹配：${dbBatch.marketplace_code} vs ${scope.marketplaceCode || '-'}`));

    const dbFiles = db.prepare('select * from lingxing_report_files where batch_id = ? order by report_type').all(batchId);
    const dbTypes = dbFiles.map((file) => file.report_type);
    const missingDbTypes = EXPECTED_REPORT_TYPES.filter((type) => !dbTypes.includes(type));
    const extraDbTypes = dbTypes.filter((type) => !EXPECTED_REPORT_TYPES.includes(type));
    const duplicateDbTypes = dbTypes.filter((type, index) => dbTypes.indexOf(type) !== index);
    checks.push(dbFiles.length === 8 ? pass('DB 文件记录数量为 8') : fail(`DB 文件记录数量不是 8：${dbFiles.length}`));
    checks.push(missingDbTypes.length === 0 && extraDbTypes.length === 0 && duplicateDbTypes.length === 0
      ? pass('DB 覆盖 8 个唯一报表类型')
      : fail(`DB 报表类型不完整：missing=${missingDbTypes.join(',') || 'none'}; extra=${extraDbTypes.join(',') || 'none'}; duplicate=${duplicateDbTypes.join(',') || 'none'}`));

    const manifestPath = firstDefined(evidenceBatch?.manifestPath, data.manifestPath, dbBatch.manifest_path);
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      checks.push(fail(`manifest 不存在：${manifestPath || '-'}`));
      return checks;
    }
    checks.push(pass(`manifest 存在：${manifestPath}`));
    checks.push(insidePath(manifestPath, dbBatch.download_dir) ? pass('manifest 位于 batch.download_dir 内') : fail('manifest 不在 batch.download_dir 内'));

    const manifest = readJson(manifestPath);
    const manifestBatch = getManifestBatch(manifest);
    const manifestFiles = manifest.files || [];
    checks.push(manifestBatch.id === dbBatch.id ? pass('manifest.batch.id 匹配') : fail('manifest.batch.id 不匹配'));
    checks.push(manifestBatch.dateStart === dbBatch.date_start ? pass('manifest dateStart 匹配') : fail('manifest dateStart 不匹配'));
    checks.push(manifestBatch.dateEnd === dbBatch.date_end ? pass('manifest dateEnd 匹配') : fail('manifest dateEnd 不匹配'));
    checks.push(manifestBatch.storeName === dbBatch.store_name ? pass('manifest storeName 匹配') : fail('manifest storeName 不匹配'));
    checks.push(manifestBatch.marketplaceCode === dbBatch.marketplace_code ? pass('manifest marketplaceCode 匹配') : fail('manifest marketplaceCode 不匹配'));
    checks.push(manifestFiles.length === 8 ? pass('manifest 文件记录数量为 8') : fail(`manifest 文件记录数量不是 8：${manifestFiles.length}`));

    const evidenceFiles = collectFiles(data);
    if (evidenceFiles.length > 0) {
      const evidenceTypes = evidenceFiles.map((file) => firstDefined(file.reportType, file.report_type)).filter(Boolean);
      checks.push(evidenceFiles.length === 8 ? pass('evidence 文件记录数量为 8') : fail(`evidence 文件记录数量不是 8：${evidenceFiles.length}`));
      checks.push(sortedTypes(evidenceTypes) === sortedTypes(EXPECTED_REPORT_TYPES)
        ? pass('evidence 覆盖 8 个报表类型')
        : fail(`evidence 报表类型不完整：${evidenceTypes.join(',') || 'none'}`));
    } else {
      checks.push(fail('evidence JSON 缺少 files 记录，不能证明 full-8 UI 结果'));
    }

    const manifestByType = new Map(manifestFiles.map((file) => [file.reportType, file]));
    const startToken = normalizeDateToken(scope.dateStart);
    const endToken = normalizeDateToken(scope.dateEnd);

    for (const dbFile of dbFiles) {
      const label = dbFile.report_type || dbFile.display_name || dbFile.id;
      const manifestFile = manifestByType.get(dbFile.report_type);
      if (!manifestFile) {
        checks.push(fail(`${label} 缺少 manifest 文件记录`));
        continue;
      }

      checks.push(dbFile.status === 'downloaded' && manifestFile.status === 'downloaded'
        ? pass(`${label} status = downloaded`)
        : fail(`${label} status 不正确：db=${dbFile.status}, manifest=${manifestFile.status}`));
      checks.push(!dbFile.error_message ? pass(`${label} error_message 为空`) : fail(`${label} error_message：${dbFile.error_message}`));

      const attemptErrors = parseMaybeJson(dbFile.attempt_errors_json, []);
      checks.push(Array.isArray(attemptErrors) && attemptErrors.length === 0
        ? pass(`${label} attempt errors 为空`)
        : fail(`${label} attempt errors 不为空`));
      checks.push(samePath(dbFile.file_path, manifestFile.filePath) ? pass(`${label} DB/manifest filePath 匹配`) : fail(`${label} DB/manifest filePath 不匹配`));

      if (!dbFile.file_path || !fs.existsSync(dbFile.file_path)) {
        checks.push(fail(`${label} 下载文件不存在：${dbFile.file_path || '-'}`));
        continue;
      }

      const actualSize = fs.statSync(dbFile.file_path).size;
      const ext = path.extname(dbFile.file_path).toLowerCase();
      const baseName = path.basename(dbFile.file_path).toLowerCase();
      const reportKeyword = REPORT_KEYWORDS[dbFile.report_type];

      checks.push(insidePath(dbFile.file_path, dbBatch.download_dir) ? pass(`${label} 文件位于 batch.download_dir 内`) : fail(`${label} 文件不在 batch.download_dir 内`));
      checks.push(['.csv', '.xls', '.xlsx'].includes(ext) ? pass(`${label} 扩展名有效：${ext}`) : fail(`${label} 扩展名无效：${ext}`));
      checks.push(actualSize >= 128 ? pass(`${label} 文件大小有效：${actualSize}`) : fail(`${label} 文件小于 128 字节：${actualSize}`));
      checks.push(dbFile.file_size_bytes === actualSize && manifestFile.fileSizeBytes === actualSize
        ? pass(`${label} 文件大小 DB/manifest/文件系统一致`)
        : fail(`${label} 文件大小不一致：db=${dbFile.file_size_bytes}, manifest=${manifestFile.fileSizeBytes}, actual=${actualSize}`));
      checks.push(reportKeyword && baseName.includes(reportKeyword)
        ? pass(`${label} 文件名包含 report keyword`)
        : fail(`${label} 文件名缺少 report keyword：${reportKeyword || '-'}`));
      checks.push(baseName.includes(startToken) && baseName.includes(endToken)
        ? pass(`${label} 文件名包含 start/end 日期 token`)
        : fail(`${label} 文件名缺少日期 token：${startToken}, ${endToken}`));
    }

    const auditPath = findAcceptanceAuditJson(data, batchId);
    if (!auditPath || !fs.existsSync(auditPath)) {
      checks.push(fail(`缺少最终 acceptance-audit.json：${auditPath || '-'}`));
      return checks;
    }

    checks.push(pass(`acceptance audit 存在：${auditPath}`));
    const audit = readJson(auditPath);
    const auditStatus = String(audit.status || audit.overallStatus || audit.result || '').toLowerCase();
    checks.push(['pass', 'passed', 'ok'].includes(auditStatus)
      ? pass('acceptance audit status 通过')
      : fail(`acceptance audit status 未通过：${auditStatus || 'unknown'}`));
    checks.push(audit.downloadedCount === 8 ? pass('acceptance audit downloadedCount = 8') : fail(`acceptance audit downloadedCount 不是 8：${audit.downloadedCount}`));
    checks.push(audit.failedCount === 0 ? pass('acceptance audit failedCount = 0') : fail(`acceptance audit failedCount 不是 0：${audit.failedCount}`));

    const auditTypes = audit.expectedReportTypes || [];
    checks.push(sortedTypes(auditTypes) === sortedTypes(EXPECTED_REPORT_TYPES)
      ? pass('acceptance audit expectedReportTypes 覆盖 8 类')
      : fail('acceptance audit expectedReportTypes 不完整'));
    const failedAuditChecks = (audit.checks || []).filter((check) => check.status !== 'passed');
    checks.push(failedAuditChecks.length === 0
      ? pass('acceptance audit checks 全部 passed')
      : fail(`acceptance audit 存在未通过检查：${failedAuditChecks.map((check) => check.name).join(',')}`));

    try {
      const reconciliation = reconcile(evidencePath);
      checks.push(pass('full-8 xlsx 指标对账已生成'));
      checks.push(reconciliation.summaries.length === 8
        ? pass('指标对账覆盖 8 个 xlsx 报表')
        : fail(`指标对账报表数量不是 8：${reconciliation.summaries.length}`));

      const missingMetricColumns = reconciliation.summaries
        .filter((summary) => ['spend', 'orders', 'sales', 'clicks'].some((key) => !summary.columns?.[key]))
        .map((summary) => summary.reportType);
      checks.push(missingMetricColumns.length === 0
        ? pass('8 个报表均包含花费/订单/销售额/点击指标列')
        : fail(`指标列缺失：${missingMetricColumns.join(',')}`));

      const canonicalTotal = reconciliation.totals.canonicalTotal;
      checks.push(canonicalTotal
        ? pass(`权威搜索词总盘口径存在：spend=${canonicalTotal.spend}, orders=${canonicalTotal.orders}, sales=${canonicalTotal.sales}`)
        : fail('缺少 user_search_term 权威总盘口径'));

      if (canonicalTotal) {
        const duplicateMismatches = Object.entries(reconciliation.totals.accountSummaryDuplicateReports || {})
          .filter(([, totals]) => !totalsMatch(totals, canonicalTotal))
          .map(([reportType]) => reportType);
        checks.push(duplicateMismatches.length === 0
          ? pass('campaign/ad_group/placement/advertised_product 与权威总盘一致，证明这些是重复维度展开，不能相加')
          : fail(`重复维度报表与权威总盘不一致：${duplicateMismatches.join(',')}`));

        checks.push(totalsMatch(reconciliation.totals.targetingBreakdownTotal, canonicalTotal)
          ? pass('keyword + auto_targeting + product_targeting 可对回权威总盘')
          : fail(`投放拆分口径无法对回权威总盘：${JSON.stringify(reconciliation.totals.targetingBreakdownTotal)}`));

        checks.push(!totalsMatch(reconciliation.totals.executableRowsNaiveSum, canonicalTotal)
          ? pass('naive executable sum 与权威总盘不同，验证脚本已识别跨粒度重复相加风险')
          : fail('naive executable sum 等于权威总盘，未能暴露跨粒度重复相加风险'));
      }
    } catch (error) {
      checks.push(fail(`full-8 xlsx 指标对账失败：${error.message}`));
    }
  } finally {
    db.close();
  }

  return checks;
}

const explicitPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const evidencePath = explicitPath || latestFull8Evidence();
const checks = verifyDeliveryEvidence(evidencePath);
const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.message}`);
}

if (failed.length > 0) {
  console.error(`\nNEEDS_WORK: ${failed.length} delivery evidence check(s) failed.`);
  process.exit(1);
}

console.log('\nDELIVERY_READY evidence verified.');
