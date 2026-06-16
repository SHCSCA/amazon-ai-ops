const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

const REPORTS = [
  ['campaign', 'campaign'],
  ['ad_group', 'ad_group'],
  ['placement', 'placement'],
  ['advertised_product', 'advertised_product'],
  ['auto_targeting', 'auto_targeting'],
  ['keyword', 'keyword'],
  ['product_targeting', 'product_targeting'],
  ['user_search_term', 'search_term'],
];
const EVIDENCE_FILE_NAME_PATTERN = /(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i;

const repoRoot = path.resolve(__dirname, '..');
const evidenceDir = path.join(repoRoot, 'output', 'codex-evidence');

function pass(message) {
  return { ok: true, message };
}

function fail(message) {
  return { ok: false, message };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function latestCanaryEvidence() {
  if (!fs.existsSync(evidenceDir)) return null;
  return fs.readdirSync(evidenceDir)
    .filter((name) => /^installed-canary-.*\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function appDataDbPath() {
  return process.env.APPDATA
    ? path.join(process.env.APPDATA, '@amazon-ai-ops', 'desktop', 'amazon-ai-ops.db')
    : null;
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

function compactDate(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function parseArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function inside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function getScope(data) {
  return {
    dateStart: data.scope?.dateStart || data.request?.start || data.request?.dateStart || data.batch?.dateStart || data.batch?.date_start,
    dateEnd: data.scope?.dateEnd || data.request?.end || data.request?.dateEnd || data.batch?.dateEnd || data.batch?.date_end,
    storeName: data.scope?.storeName || data.request?.storeName || data.batch?.storeName || data.batch?.store_name,
    marketplaceCode: data.scope?.marketplaceCode || data.request?.marketplaceCode || data.batch?.marketplaceCode || data.batch?.marketplace_code,
  };
}

function verifyEnablementEvidence(evidencePath) {
  const checks = [];
  if (!evidencePath) return [fail('未找到 installed-canary-*.json，无法推导启用审计范围')];
  if (!fs.existsSync(evidencePath)) return [fail(`证据文件不存在：${evidencePath}`)];

  const data = readJson(evidencePath);
  const scope = getScope(data);
  checks.push(pass(`范围来源：${evidencePath}`));
  for (const [key, value] of Object.entries(scope)) {
    checks.push(value ? pass(`scope.${key} = ${value}`) : fail(`缺少 scope.${key}`));
  }
  if (checks.some((check) => !check.ok)) return checks;

  const dbPath = appDataDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return [...checks, fail(`AppData DB 不存在：${dbPath || '-'}`)];
  checks.push(pass(`AppData DB 存在：${dbPath}`));

  const db = openReadonlyDb(dbPath);
  if (db.fallbackReason) {
    checks.push(pass(`better-sqlite3 不可用，已使用 Python sqlite3 只读 fallback：${db.fallbackReason.split('\n')[0]}`));
  }
  try {
    const diagnostic = db.prepare(`
      SELECT *
      FROM download_center_diagnostics
      WHERE date_start = ?
        AND date_end = ?
        AND COALESCE(store_name, '') = COALESCE(?, '')
        AND COALESCE(marketplace_code, '') = COALESCE(?, '')
      ORDER BY checked_at DESC, id DESC
      LIMIT 1
    `).get(scope.dateStart, scope.dateEnd, scope.storeName || '', scope.marketplaceCode || '');

    if (!diagnostic) {
      checks.push(fail('缺少同范围 download_center_diagnostics'));
      return checks;
    }

    checks.push(pass(`diagnostic 存在：${diagnostic.id}`));
    checks.push(diagnostic.ready === 1 ? pass('diagnostic.ready = 1') : fail(`diagnostic.ready 不是 1：${diagnostic.ready}`));
    checks.push(!diagnostic.error_message ? pass('diagnostic.error_message 为空') : fail(`diagnostic.error_message：${diagnostic.error_message}`));
    const checkedAtMs = Date.parse(diagnostic.checked_at);
    const ageMs = Date.now() - checkedAtMs;
    checks.push(Number.isFinite(checkedAtMs) && ageMs >= 0 && ageMs <= 30 * 60 * 1000
      ? pass('diagnostic 在 30 分钟 freshness TTL 内')
      : fail(`diagnostic 已过 freshness TTL：${diagnostic.checked_at}`));
    for (const field of ['screenshot_path', 'dom_snapshot_path']) {
      const artifact = diagnostic[field];
      checks.push(artifact && fs.existsSync(artifact)
        ? pass(`${field} 存在`)
        : fail(`${field} 不存在：${artifact || '-'}`));
    }

    const rows = db.prepare(`
      SELECT
        b.id AS batchId,
        b.created_at AS batchCreatedAt,
        b.download_dir AS downloadDir,
        f.report_type AS reportType,
        f.file_path AS filePath,
        f.file_size_bytes AS fileSizeBytes,
        f.error_message AS errorMessage,
        f.attempt_errors_json AS attemptErrorsJson
      FROM lingxing_report_batches b
      JOIN lingxing_report_files f ON f.batch_id = b.id
      WHERE b.app_version = '1.5.0'
        AND b.date_start = ?
        AND b.date_end = ?
        AND COALESCE(b.store_name, '') = COALESCE(?, '')
        AND COALESCE(b.marketplace_code, '') = COALESCE(?, '')
        AND b.status = 'completed'
        AND f.status = 'downloaded'
        AND (
          SELECT COUNT(*)
          FROM lingxing_report_files count_files
          WHERE count_files.batch_id = b.id
        ) = 1
      ORDER BY b.created_at DESC, b.id DESC
    `).all(scope.dateStart, scope.dateEnd, scope.storeName || '', scope.marketplaceCode || '');

    const covered = new Set();
    const startToken = compactDate(scope.dateStart);
    const endToken = compactDate(scope.dateEnd);
    for (const [reportType, keyword] of REPORTS) {
      const match = rows.find((row) => {
        if (row.reportType !== reportType) return false;
        if (row.errorMessage || parseArray(row.attemptErrorsJson).length > 0) return false;
        if (!row.filePath || !fs.existsSync(row.filePath)) return false;
        if (!inside(row.filePath, row.downloadDir)) return false;
        const actualSize = fs.statSync(row.filePath).size;
        if (actualSize < 128 || row.fileSizeBytes !== actualSize) return false;
        const basename = path.basename(row.filePath).toLowerCase();
        if (EVIDENCE_FILE_NAME_PATTERN.test(basename)) return false;
        return basename.includes(keyword) && basename.includes(startToken) && basename.includes(endToken);
      });
      if (match) covered.add(reportType);
    }

    const required = REPORTS.map(([reportType]) => reportType);
    const missing = required.filter((reportType) => !covered.has(reportType));
    checks.push(covered.size > 0
      ? pass(`成功 canary 覆盖：${[...covered].join(',')}`)
      : fail('没有可用于启用的成功 canary 覆盖'));
    checks.push(missing.length === 0
      ? pass('8 类报表 canary 覆盖完整')
      : fail(`缺少 8 类报表 canary 覆盖：${missing.join(',')}`));
  } finally {
    db.close();
  }

  return checks;
}

const evidencePath = process.argv[2] ? path.resolve(process.argv[2]) : latestCanaryEvidence();
const checks = verifyEnablementEvidence(evidencePath);
const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.message}`);
}
if (failed.length > 0) {
  console.error(`\nNEEDS_WORK: ${failed.length} enablement evidence check(s) failed.`);
  process.exit(1);
}
console.log('\nENABLEMENT_READY evidence verified.');
