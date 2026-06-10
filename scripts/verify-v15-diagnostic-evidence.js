const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

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

function latestDiagnosticEvidence() {
  if (!fs.existsSync(evidenceDir)) return null;
  return fs.readdirSync(evidenceDir)
    .filter((name) => /^installed-live-diagnostic-.*\.json$/i.test(name))
    .map((name) => {
      const filePath = path.join(evidenceDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function appDataRoot() {
  return process.env.APPDATA ? path.join(process.env.APPDATA, '@amazon-ai-ops', 'desktop') : null;
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

function normalizePath(value) {
  return path.resolve(String(value || ''));
}

function inside(child, parent) {
  if (!child || !parent) return false;
  const relative = path.relative(normalizePath(parent), normalizePath(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function hasStep(data, label) {
  return Array.isArray(data.steps) && data.steps.some((step) => step.label === label);
}

function scopeFromEvidence(data) {
  return {
    dateStart: data.request?.start || data.request?.dateStart,
    dateEnd: data.request?.end || data.request?.dateEnd,
    storeName: data.request?.storeName,
    marketplaceCode: data.request?.marketplaceCode,
  };
}

function msBetween(left, right) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return null;
  return Math.abs(leftMs - rightMs);
}

function requiredBundleFiles(bundlePath) {
  return [
    'diagnostic.json',
    'active-page-model.json',
    'readiness.json',
    'selector-candidates.json',
    'action-selector-checks.json',
    'manual-verification-checklist.md',
  ].map((name) => path.join(bundlePath, name));
}

function verifyDiagnosticEvidence(evidencePath) {
  const checks = [];
  if (!evidencePath) return [fail('未找到 installed-live-diagnostic-*.json 证据文件')];
  if (!fs.existsSync(evidencePath)) return [fail(`证据文件不存在：${evidencePath}`)];

  const data = readJson(evidencePath);
  checks.push(pass(`证据文件：${evidencePath}`));

  checks.push(data.kind === 'installed-live-diagnostic'
    ? pass('kind = installed-live-diagnostic')
    : fail(`kind 不正确：${data.kind || '-'}`));

  if (Array.isArray(data.errors) && data.errors.length > 0) {
    checks.push(fail(`diagnostic runner 记录了错误：${data.errors[0]}`));
  } else {
    checks.push(pass('diagnostic runner 未记录 errors'));
  }

  checks.push(data.safety?.full8Started === false ? pass('未启动 full-8 采集') : fail('证据未证明 full-8 未启动'));
  checks.push(data.safety?.adWriteActionsPerformed === false ? pass('未执行广告写操作') : fail('证据未证明未执行广告写操作'));
  checks.push(Array.isArray(data.safety?.reportTypesRequested) && data.safety.reportTypesRequested.length === 0
    ? pass('诊断未请求报表生成')
    : fail(`诊断不应请求报表生成：${JSON.stringify(data.safety?.reportTypesRequested || [])}`));

  checks.push(data.exePath && fs.existsSync(data.exePath)
    ? pass(`安装版 exe 存在：${data.exePath}`)
    : fail(`安装版 exe 不存在：${data.exePath || '-'}`));
  checks.push(hasStep(data, 'window-ready') ? pass('窗口已启动') : fail('缺少 window-ready 步骤'));
  checks.push(data.browserReadyBefore === true || hasStep(data, 'browser-login')
    ? pass('浏览器会话已显式确认或登录')
    : fail('缺少可用浏览器会话或 browser-login 步骤'));

  const scope = scopeFromEvidence(data);
  for (const [key, value] of Object.entries(scope)) {
    checks.push(value ? pass(`scope.${key} = ${value}`) : fail(`缺少 scope.${key}`));
  }

  const diagnosticId = data.diagnostic?.id;
  if (!diagnosticId) {
    checks.push(fail('缺少 diagnostic.id'));
    return checks;
  }
  checks.push(pass(`diagnostic.id = ${diagnosticId}`));
  checks.push(data.diagnostic?.ready === true ? pass('diagnostic.ready = true') : fail(`diagnostic.ready 不是 true：${data.diagnostic?.ready}`));

  const root = appDataRoot();
  const dbPath = appDataDbPath();
  if (!root || !dbPath || !fs.existsSync(dbPath)) {
    checks.push(fail(`AppData DB 不存在：${dbPath || '-'}`));
    return checks;
  }
  checks.push(pass(`AppData DB 存在：${dbPath}`));

  const Database = requireSqlite();
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('select * from download_center_diagnostics where id = ?').get(diagnosticId);
    if (!row) {
      checks.push(fail(`DB 缺少 download_center_diagnostics：${diagnosticId}`));
      return checks;
    }

    checks.push(row.app_version === '1.5.0' ? pass('diagnostic.app_version = 1.5.0') : fail(`diagnostic.app_version 不匹配：${row.app_version}`));
    checks.push(row.ready === 1 ? pass('DB diagnostic.ready = 1') : fail(`DB diagnostic.ready 不是 1：${row.ready}`));
    checks.push(!row.error_message ? pass('DB diagnostic.error_message 为空') : fail(`DB diagnostic.error_message：${row.error_message}`));
    checks.push(row.date_start === scope.dateStart ? pass('diagnostic.date_start 匹配') : fail(`diagnostic.date_start 不匹配：${row.date_start}`));
    checks.push(row.date_end === scope.dateEnd ? pass('diagnostic.date_end 匹配') : fail(`diagnostic.date_end 不匹配：${row.date_end}`));
    checks.push(row.store_name === scope.storeName ? pass('diagnostic.store_name 匹配') : fail(`diagnostic.store_name 不匹配：${row.store_name}`));
    checks.push(row.marketplace_code === scope.marketplaceCode ? pass('diagnostic.marketplace_code 匹配') : fail(`diagnostic.marketplace_code 不匹配：${row.marketplace_code}`));

    const evidenceGapMs = msBetween(data.createdAt, row.checked_at);
    checks.push(evidenceGapMs !== null && evidenceGapMs <= 30 * 60 * 1000
      ? pass('diagnostic.checked_at 与 evidence.createdAt 在 30 分钟内')
      : fail(`diagnostic.checked_at 与 evidence.createdAt 不匹配：createdAt=${data.createdAt || '-'}, checked_at=${row.checked_at || '-'}`));

    for (const field of ['screenshot_path', 'dom_snapshot_path']) {
      const artifact = row[field];
      checks.push(artifact && fs.existsSync(artifact)
        ? pass(`${field} 存在`)
        : fail(`${field} 不存在：${artifact || '-'}`));
      checks.push(artifact && inside(artifact, root)
        ? pass(`${field} 位于 AppData 证据目录`)
        : fail(`${field} 不在 AppData 目录：${artifact || '-'}`));
    }
  } finally {
    db.close();
  }

  const bundlePath = data.diagnosticBundlePath;
  if (!bundlePath || !fs.existsSync(bundlePath)) {
    checks.push(fail(`缺少 diagnosticBundlePath：${bundlePath || '-'}`));
  } else {
    checks.push(pass(`diagnostic bundle 存在：${bundlePath}`));
    checks.push(inside(bundlePath, root) ? pass('diagnostic bundle 位于 AppData exports') : fail('diagnostic bundle 不在 AppData exports'));
    for (const filePath of requiredBundleFiles(bundlePath)) {
      checks.push(fs.existsSync(filePath)
        ? pass(`bundle 文件存在：${path.basename(filePath)}`)
        : fail(`bundle 缺少文件：${path.basename(filePath)}`));
    }
  }

  return checks;
}

const evidencePath = process.argv[2] ? path.resolve(process.argv[2]) : latestDiagnosticEvidence();
const checks = verifyDiagnosticEvidence(evidencePath);
const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? '[PASS]' : '[FAIL]'} ${check.message}`);
}
if (failed.length > 0) {
  console.error(`\nNEEDS_WORK: ${failed.length} diagnostic evidence check(s) failed.`);
  process.exit(1);
}
console.log('\nDIAGNOSTIC_READY evidence verified.');
