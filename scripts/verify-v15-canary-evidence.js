const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');
const { currentAppVersion } = require('./current-app-version');

const VALID_REPORT_TYPES = new Set([
  'campaign',
  'ad_group',
  'placement',
  'advertised_product',
  'auto_targeting',
  'keyword',
  'product_targeting',
  'user_search_term',
]);

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
const EVIDENCE_FILE_NAME_PATTERN = /(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i;

const repoRoot = path.resolve(__dirname, '..');
const evidenceDir = path.join(repoRoot, 'output', 'codex-evidence');
const APP_VERSION = currentAppVersion();

function fail(message) {
  return { ok: false, message };
}

function pass(message) {
  return { ok: true, message };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestCanaryEvidence() {
  if (!fs.existsSync(evidenceDir)) return null;
  const files = fs.readdirSync(evidenceDir)
    .filter((name) => /^installed-canary-.*\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
}

function appDataDbPath() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, '@amazon-ai-ops', 'desktop', 'amazon-ai-ops.db');
}

function requireSqlite() {
  try {
    return require('better-sqlite3');
  } catch (error) {
    const localDbPackage = path.join(repoRoot, 'packages', 'local-db', 'package.json');
    if (fs.existsSync(localDbPackage)) {
      try {
        return createRequire(localDbPackage)('better-sqlite3');
      } catch (localError) {
        throw new Error(`better-sqlite3 is required for DB verification: ${localError.message}`);
      }
    }
    throw new Error(`better-sqlite3 is required for DB verification: ${error.message}`);
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

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
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
  const relative = path.relative(normalizePath(parent), normalizePath(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function getManifestBatchField(manifest, field) {
  return manifest?.batch?.[field] ?? manifest?.[field];
}

function getScope(data) {
  return {
    dateStart: data.scope?.dateStart || data.request?.start || data.request?.dateStart || data.batch?.date_start,
    dateEnd: data.scope?.dateEnd || data.request?.end || data.request?.dateEnd || data.batch?.date_end,
    storeName: data.scope?.storeName || data.request?.storeName || data.batch?.store_name,
    marketplaceCode: data.scope?.marketplaceCode || data.request?.marketplaceCode || data.batch?.marketplace_code,
  };
}

function isoMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function verifyCanaryEvidence(evidencePath, options = {}) {
  const checks = [];
  if (!evidencePath) return [fail('未找到 installed-canary-*.json 证据文件')];
  if (!fs.existsSync(evidencePath)) return [fail(`证据文件不存在：${evidencePath}`)];

  const data = readJson(evidencePath);
  checks.push(pass(`证据文件：${evidencePath}`));

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    checks.push(fail(`canary 记录了 errors：${data.errors[0]}`));
  } else {
    checks.push(pass('canary 未记录顶层 errors'));
  }

  if (data.safety?.full8Started === false) {
    checks.push(pass('未启动 full-8 采集'));
  } else {
    checks.push(fail('证据未证明 full-8 未启动'));
  }

  if (data.safety?.adWriteActionsPerformed === false) {
    checks.push(pass('未执行广告写操作'));
  } else {
    checks.push(fail('证据未证明未执行广告写操作'));
  }

  const requestedTypes = data.safety?.reportTypesRequested || data.request?.reportTypes || data.reportTypes;
  if (!Array.isArray(requestedTypes) || requestedTypes.length !== 1) {
    checks.push(fail(`单报表 canary 必须且只能请求 1 个报表类型：${JSON.stringify(requestedTypes)}`));
  } else if (!VALID_REPORT_TYPES.has(requestedTypes[0])) {
    checks.push(fail(`未知 reportType：${requestedTypes[0]}`));
  } else {
    checks.push(pass(`请求报表类型有效：${requestedTypes[0]}`));
  }

  const scope = getScope(data);
  for (const [key, value] of Object.entries(scope)) {
    checks.push(value ? pass(`scope.${key} = ${value}`) : fail(`缺少 scope.${key}`));
  }

  const dbPath = options.dbPath || data.dbPath || appDataDbPath();
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
    const diagnosticId = data.latestDiagnostic?.id || data.diagnostic?.id || data.diagnosticId;
    const diagnostic = diagnosticId
      ? db.prepare('select * from download_center_diagnostics where id = ?').get(diagnosticId)
      : db.prepare('select * from download_center_diagnostics order by id desc limit 1').get();

    if (!diagnostic) {
      checks.push(fail(`DB 缺少 download_center_diagnostics：${diagnosticId || 'latest'}`));
    } else {
      checks.push(pass(`diagnostic 存在：${diagnostic.id}`));
      checks.push(diagnostic.ready === 1 ? pass('diagnostic.ready = 1') : fail(`diagnostic.ready 不是 1：${diagnostic.ready}`));
      checks.push(!diagnostic.error_message ? pass('diagnostic.error_message 为空') : fail(`diagnostic.error_message：${diagnostic.error_message}`));
      checks.push(diagnostic.date_start === scope.dateStart ? pass('diagnostic.date_start 匹配') : fail(`diagnostic.date_start 不匹配：${diagnostic.date_start}`));
      checks.push(diagnostic.date_end === scope.dateEnd ? pass('diagnostic.date_end 匹配') : fail(`diagnostic.date_end 不匹配：${diagnostic.date_end}`));
      checks.push(diagnostic.store_name === scope.storeName ? pass('diagnostic.store_name 匹配') : fail(`diagnostic.store_name 不匹配：${diagnostic.store_name}`));
      checks.push(diagnostic.marketplace_code === scope.marketplaceCode ? pass('diagnostic.marketplace_code 匹配') : fail(`diagnostic.marketplace_code 不匹配：${diagnostic.marketplace_code}`));

      const freshnessReferenceMs = isoMs(data.batch?.createdAt || data.batch?.created_at || data.createdAt) || Date.now();
      const checkedMs = isoMs(diagnostic.checked_at);
      if (!checkedMs) {
        checks.push(fail(`diagnostic.checked_at 无法解析：${diagnostic.checked_at}`));
      } else {
        const ageMs = freshnessReferenceMs - checkedMs;
        checks.push(ageMs >= 0 && ageMs <= 30 * 60 * 1000
          ? pass('diagnostic.checked_at 在 canary freshness TTL 内')
          : fail(`diagnostic.checked_at 超出 30 分钟 TTL：${diagnostic.checked_at}`));
      }

      for (const evidencePathField of ['screenshot_path', 'dom_snapshot_path']) {
        const artifactPath = diagnostic[evidencePathField];
        if (!artifactPath || !fs.existsSync(artifactPath)) {
          checks.push(fail(`diagnostic ${evidencePathField} 不存在：${artifactPath || '-'}`));
        } else if (!insidePath(artifactPath, path.dirname(dbPath))) {
          checks.push(fail(`diagnostic ${evidencePathField} 不在 app-owned evidence 目录：${artifactPath}`));
        } else {
          checks.push(pass(`diagnostic ${evidencePathField} 存在且归属 AppData`));
        }
      }

      const actionChecks = parseMaybeJson(diagnostic.action_selector_checks_json, []);
      const requiredSetupNames = new Set(['createReportButton', 'dateStartInput', 'dateEndInput']);
      const missingSetup = [...requiredSetupNames].filter((name) => !actionChecks.some((item) => item.name === name && item.usable));
      checks.push(missingSetup.length === 0
        ? pass('diagnostic setup action selectors 可用')
        : fail(`diagnostic setup action selectors 不可用：${missingSetup.join(', ')}`));
    }

    const batchId = data.batch?.id || data.batch?.batch_id || data.manifest?.batch?.id;
    const batch = batchId ? db.prepare('select * from lingxing_report_batches where id = ?').get(batchId) : null;
    if (!batch) {
      checks.push(fail(`DB 缺少 lingxing_report_batches：${batchId || '-'}`));
      return checks;
    }

    checks.push(pass(`batch 存在：${batch.id}`));
    checks.push(batch.status === 'completed' ? pass('batch.status = completed') : fail(`batch.status 不是 completed：${batch.status}`));
    checks.push(batch.app_version === APP_VERSION ? pass(`batch.app_version = ${APP_VERSION}`) : fail(`batch.app_version 不匹配：${batch.app_version}`));
    checks.push(batch.date_start === scope.dateStart ? pass('batch.date_start 匹配') : fail(`batch.date_start 不匹配：${batch.date_start}`));
    checks.push(batch.date_end === scope.dateEnd ? pass('batch.date_end 匹配') : fail(`batch.date_end 不匹配：${batch.date_end}`));
    checks.push(batch.store_name === scope.storeName ? pass('batch.store_name 匹配') : fail(`batch.store_name 不匹配：${batch.store_name}`));
    checks.push(batch.marketplace_code === scope.marketplaceCode ? pass('batch.marketplace_code 匹配') : fail(`batch.marketplace_code 不匹配：${batch.marketplace_code}`));

    const manifestPath = data.manifestPath || batch.manifest_path;
    if (!manifestPath || !fs.existsSync(manifestPath)) {
      checks.push(fail(`manifest 不存在：${manifestPath || '-'}`));
      return checks;
    }

    checks.push(pass(`manifest 存在：${manifestPath}`));
    checks.push(insidePath(manifestPath, batch.download_dir) ? pass('manifest 位于 batch.download_dir 内') : fail('manifest 不在 batch.download_dir 内'));
    const manifest = readJson(manifestPath);
    checks.push(getManifestBatchField(manifest, 'id') === batch.id ? pass('manifest.batch.id 匹配') : fail('manifest.batch.id 不匹配'));
    checks.push(getManifestBatchField(manifest, 'dateStart') === batch.date_start ? pass('manifest dateStart 匹配') : fail('manifest dateStart 不匹配'));
    checks.push(getManifestBatchField(manifest, 'dateEnd') === batch.date_end ? pass('manifest dateEnd 匹配') : fail('manifest dateEnd 不匹配'));
    checks.push(getManifestBatchField(manifest, 'storeName') === batch.store_name ? pass('manifest storeName 匹配') : fail('manifest storeName 不匹配'));
    checks.push(getManifestBatchField(manifest, 'marketplaceCode') === batch.marketplace_code ? pass('manifest marketplaceCode 匹配') : fail('manifest marketplaceCode 不匹配'));

    const dbFiles = db.prepare('select * from lingxing_report_files where batch_id = ? order by report_type').all(batch.id);
    const manifestFiles = manifest.files || [];
    if (dbFiles.length !== 1 || manifestFiles.length !== 1) {
      checks.push(fail(`单报表 canary 文件数量不为 1：db=${dbFiles.length}, manifest=${manifestFiles.length}`));
      return checks;
    }
    checks.push(pass('DB 与 manifest 均只有 1 个文件记录'));

    const dbFile = dbFiles[0];
    const manifestFile = manifestFiles[0];
    checks.push(dbFile.id === manifestFile.id ? pass('file.id 匹配') : fail('file.id 不匹配'));
    checks.push(dbFile.batch_id === manifestFile.batchId ? pass('file.batchId 匹配') : fail('file.batchId 不匹配'));
    checks.push(dbFile.report_type === manifestFile.reportType ? pass('file.reportType 匹配') : fail('file.reportType 不匹配'));
    checks.push(dbFile.status === 'downloaded' && manifestFile.status === 'downloaded'
      ? pass('file.status = downloaded')
      : fail(`file.status 不匹配：db=${dbFile.status}, manifest=${manifestFile.status}`));
    checks.push(!dbFile.error_message ? pass('file.error_message 为空') : fail(`file.error_message：${dbFile.error_message}`));
    checks.push(dbFile.attempt_errors_json === '[]' && Array.isArray(manifestFile.attemptErrors) && manifestFile.attemptErrors.length === 0
      ? pass('file attempt errors 为空')
      : fail('file attempt errors 不为空'));
    checks.push(samePath(dbFile.file_path, manifestFile.filePath) ? pass('file.path 匹配') : fail('file.path 不匹配'));

    if (!fs.existsSync(dbFile.file_path)) {
      checks.push(fail(`下载文件不存在：${dbFile.file_path}`));
      return checks;
    }

    const actualSize = fs.statSync(dbFile.file_path).size;
    const ext = path.extname(dbFile.file_path).toLowerCase();
    checks.push(insidePath(dbFile.file_path, batch.download_dir) ? pass('下载文件位于 batch.download_dir 内') : fail('下载文件不在 batch.download_dir 内'));
    checks.push(['.csv', '.xls', '.xlsx'].includes(ext) ? pass(`下载文件扩展名有效：${ext}`) : fail(`下载文件扩展名无效：${ext}`));
    checks.push(actualSize >= 128 ? pass(`下载文件大小有效：${actualSize}`) : fail(`下载文件小于 128 字节：${actualSize}`));
    checks.push(dbFile.file_size_bytes === actualSize && manifestFile.fileSizeBytes === actualSize
      ? pass('文件大小 DB/manifest/文件系统一致')
      : fail(`文件大小不一致：db=${dbFile.file_size_bytes}, manifest=${manifestFile.fileSizeBytes}, actual=${actualSize}`));

    const baseName = path.basename(dbFile.file_path).toLowerCase();
    checks.push(!EVIDENCE_FILE_NAME_PATTERN.test(baseName)
      ? pass('下载文件名不像审计/诊断证据')
      : fail(`下载文件名像审计/诊断证据：${baseName}`));
    const reportKeyword = REPORT_KEYWORDS[dbFile.report_type];
    checks.push(reportKeyword && baseName.includes(reportKeyword)
      ? pass(`文件名包含 report keyword：${reportKeyword}`)
      : fail(`文件名缺少 report keyword：${reportKeyword || dbFile.report_type}`));
    const startToken = normalizeDateToken(scope.dateStart);
    const endToken = normalizeDateToken(scope.dateEnd);
    checks.push(baseName.includes(startToken) && baseName.includes(endToken)
      ? pass('文件名包含 start/end 日期 token')
      : fail(`文件名缺少日期 token：${startToken}, ${endToken}`));
  } finally {
    db.close();
  }

  return checks;
}

const explicitPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const evidencePath = explicitPath || latestCanaryEvidence();
const checks = verifyCanaryEvidence(evidencePath);
const failed = checks.filter((check) => !check.ok);

for (const check of checks) {
  console.log(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.message}`);
}

if (failed.length > 0) {
  console.error(`\nNEEDS_WORK: ${failed.length} canary evidence check(s) failed.`);
  process.exit(1);
}

console.log('\nCANARY_READY evidence verified. Full-8 remains gated separately.');
