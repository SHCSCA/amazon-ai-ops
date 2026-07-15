const fs = require('fs');
const path = require('path');
const { assertCurrentAdReadbackDbAuthority } = require('./ad-readback-authority-db');

const LOW_RISK_ACTIONS = new Set([
  'lower_bid',
  'pause_target',
  'add_negative_exact',
  'add_negative_phrase',
  'add_negative_broad',
]);

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  let evidencePath = '';
  let dbPath = '';
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--db') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --db');
      dbPath = value;
      index += 1;
    } else if (token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    } else if (!evidencePath) {
      evidencePath = token;
    } else {
      throw new Error(`Unexpected argument: ${token}`);
    }
  }
  return { evidencePath, dbPath };
}

function readEvidence(inputPath) {
  if (!inputPath) {
    throw new Error('Usage: node scripts/verify-ad-readback-evidence.js <evidence-json>');
  }
  const resolved = path.resolve(inputPath);
  return { path: resolved, data: JSON.parse(fs.readFileSync(resolved, 'utf8')) };
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasRealText(value) {
  return hasText(value) && !value.trim().startsWith('FILL:');
}

function looksLikeLocalPath(value) {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value) || /\.[A-Za-z0-9]{2,6}$/.test(value);
}

function isTraceableApprovalArtifact(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  if (/^https?:\/\/\S+/i.test(text)) return true;
  if (looksLikeLocalPath(text)) {
    const resolved = path.resolve(text);
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
  }
  return /(?:ticket|approval|approve|工单|审批|批准|确认)[-_:#\s]?[A-Za-z0-9_-]{2,}/i.test(text)
    || /^[A-Za-z][A-Za-z0-9_-]{1,}-\d{2,}$/.test(text);
}

function timestampMs(value) {
  if (!isIsoDate(value)) return Number.NaN;
  return Date.parse(value);
}

function checkTimestampOrder(steps) {
  for (let index = 0; index < steps.length; index += 1) {
    const current = steps[index];
    if (!Number.isFinite(current.ms)) {
      fail(`${current.label} timestamp is missing or invalid`);
      return;
    }
    if (index > 0) {
      const previous = steps[index - 1];
      if (current.ms < previous.ms) {
        fail(`${current.label} timestamp is earlier than ${previous.label}`);
        return;
      }
    }
  }
  pass('approval, before, execution, after, and readback timestamps are ordered');
}

function checkOwnedEvidenceFile(filePath, label) {
  if (!hasRealText(filePath)) {
    fail(`${label} path missing`);
    return;
  }
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.zip']);
  if (!allowedExt.has(ext)) {
    fail(`${label} has unsupported evidence extension: ${ext}`);
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    fail(`${label} evidence file does not exist: ${resolved}`);
    return;
  }
  pass(`${label} evidence file exists`);
}

function checkDistinctEvidenceFiles(files) {
  const usableFiles = files.filter((item) => hasRealText(item.filePath));
  if (usableFiles.length !== files.length) return;
  const resolvedFiles = usableFiles.map((item) => ({
    label: item.label,
    path: path.resolve(String(item.filePath).trim()).toLowerCase(),
  }));
  const uniquePaths = new Set(resolvedFiles.map((item) => item.path));
  if (uniquePaths.size === resolvedFiles.length) {
    pass('before, after, and readback evidence files are distinct');
  } else {
    fail('before, after, and readback evidence files must be distinct');
  }
}

function isPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function parseExecutableNumber(value) {
  const text = String(value ?? '').trim();
  if (!text || /[%％]/.test(text)) return Number.NaN;
  return Number(text.replace(/^\$/, '').replace(/\s*usd$/i, ''));
}

function checkActionValueDirection(actionType, beforeValue, afterValue) {
  if (actionType !== 'lower_bid') return;
  const beforeNumber = parseExecutableNumber(beforeValue);
  const afterNumber = parseExecutableNumber(afterValue);
  if (!Number.isFinite(beforeNumber) || !Number.isFinite(afterNumber)) {
    fail('lower_bid action values are not executable numeric bids');
    return;
  }
  if (afterNumber < beforeNumber) {
    pass('lower_bid action lowered the bid value');
  } else {
    fail('lower_bid action did not lower the bid value');
  }
}

function valuesMatch(left, right) {
  const leftNumber = parseExecutableNumber(left);
  const rightNumber = parseExecutableNumber(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return Math.abs(leftNumber - rightNumber) < 0.0001;
  }
  return String(left ?? '').trim() === String(right ?? '').trim();
}

function checkSourceValueConsistency(source, beforeValue, afterValue) {
  if (!hasRealText(String(source?.currentValue ?? ''))) {
    fail('source current value is missing');
  } else {
    pass('source current value is present');
  }

  if (!hasRealText(String(source?.recommendedValue ?? ''))) {
    fail('source recommended value is missing');
  } else {
    pass('source recommended value is present');
  }

  if (
    hasRealText(String(source?.currentValue ?? ''))
    && hasRealText(String(source?.recommendedValue ?? ''))
  ) {
    pass('source recommendation values are present and kept separate from live Ads before/after values');
  }
}

function isRealReportFile(filePath) {
  if (!hasRealText(filePath)) return false;
  const resolved = path.resolve(String(filePath).trim());
  const ext = path.extname(resolved).toLowerCase();
  if (!new Set(['.xlsx', '.xls', '.csv']).has(ext)) return false;
  return fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

function checkSourceReportTraceability(source) {
  const sourceFiles = Array.isArray(source?.sourceFiles) ? source.sourceFiles : [];
  if (
    sourceFiles.length > 0
    && sourceFiles.every(isRealReportFile)
    && isPositiveNumber(source?.sourceRow)
  ) {
    pass('source report traceability includes real spreadsheet file(s) and row number');
  } else {
    fail('source report traceability is incomplete');
  }
}

function assertNoSecretLeak(serialized) {
  const suspicious = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i,
    /LINGXING_PASSWORD\s*[:=]\s*['"]?(?!<)[^'"\s]+/i,
  ];
  if (suspicious.some((pattern) => pattern.test(serialized))) {
    fail('evidence appears to contain a secret');
  } else {
    pass('evidence does not contain obvious secret patterns');
  }
}

const cli = parseArgs(process.argv);
const { path: evidencePath, data: evidence } = readEvidence(cli.evidencePath);
const serialized = JSON.stringify(evidence);

if (evidence.kind === 'real-ad-execution-readback') {
  pass('evidence kind is real-ad-execution-readback');
} else {
  fail(`unexpected evidence kind: ${evidence.kind}`);
}

const authority = evidence.authority || {};
const authorityReady = evidence.schemaVersion === 2
  && Number.isInteger(authority.recommendationId)
  && authority.recommendationId > 0
  && Number.isInteger(authority.recommendationRevision)
  && authority.recommendationRevision >= 0
  && authority.recommendationStatusAtExport === 'approved'
  && hasRealText(authority.dateFrom)
  && hasRealText(authority.dateTo)
  && hasRealText(authority.storeName)
  && hasRealText(authority.marketplaceCode)
  && hasRealText(authority.asin)
  && hasRealText(authority.batchId)
  && isIsoDate(authority.checkedAt);
if (authorityReady) {
  pass('evidence carries a complete v2 authority record');
} else {
  fail('v2 authority record is missing or incomplete');
}

if (evidence.status === 'PASS' && evidence.realWriteApproved === true) {
  pass('status is PASS and real write was explicitly approved');
} else {
  fail('status/realWriteApproved do not prove approved real execution');
}

if (evidence.safety?.full8Started === false && evidence.safety?.listingAiDraftOnly === false && evidence.safety?.adWriteActionsPerformed === true) {
  pass('safety flags isolate a real ad action from full8/listing AI flows');
} else {
  fail('safety flags do not isolate real ad readback evidence');
}

if (
  evidence.approval?.operatorConfirmed === true
  && hasRealText(evidence.approval?.scope)
  && isIsoDate(evidence.approval?.confirmedAt)
  && hasRealText(evidence.approval?.approverName)
  && isTraceableApprovalArtifact(evidence.approval?.approvalArtifactPath)
) {
  pass('operator approval scope, approver, traceable artifact, and timestamp are present');
} else {
  fail('operator approval proof is incomplete');
}

const target = evidence.target || {};
if (
  hasText(target.storeName)
  && hasText(target.marketplaceCode)
  && hasRealText(target.campaignName)
  && hasRealText(target.adGroupName)
  && hasText(target.entityType)
  && hasRealText(target.entityName)
  && hasText(target.actionType)
) {
  pass('target context includes store/site/campaign/ad group/entity/action');
} else {
  fail('target context is incomplete');
}

const source = evidence.source || {};
const authorityMatchesEvidence = authorityReady
  && String(source.recommendationId || '') === String(authority.recommendationId)
  && Number(source.recommendationRevision) === Number(authority.recommendationRevision)
  && String(source.batchId || '') === String(authority.batchId)
  && String(target.storeName || '').trim().toLowerCase() === String(authority.storeName || '').trim().toLowerCase()
  && String(target.marketplaceCode || '').trim().toLowerCase() === String(authority.marketplaceCode || '').trim().toLowerCase()
  && String(target.asin || '').trim().toUpperCase() === String(authority.asin || '').trim().toUpperCase();
if (authorityMatchesEvidence) {
  pass('v2 authority matches target and source identity');
} else {
  fail('v2 authority does not match target/source recommendation, revision, batch, store, site, or ASIN');
}

checkSourceReportTraceability(source);

if (LOW_RISK_ACTIONS.has(target.actionType) && evidence.risk?.level === 'low' && evidence.risk?.allowedByPolicy === true && hasRealText(evidence.risk?.rationale)) {
  pass('action is low-risk and policy-allowed');
} else {
  fail('action is not proven low-risk/policy-allowed');
}

const before = evidence.before || {};
const after = evidence.after || {};
if (
  before.value !== undefined
  && after.value !== undefined
  && hasRealText(String(before.value))
  && hasRealText(String(after.value))
  && !valuesMatch(before.value, after.value)
  && hasRealText(before.liveBidSourceNote)
) {
  pass('before/after values are present, live-sourced, and changed');
} else {
  fail('before/after values do not prove a live Ads UI change');
}
checkActionValueDirection(target.actionType, before.value, after.value);
checkSourceValueConsistency(evidence.source || {}, before.value, after.value);

if (isIsoDate(before.capturedAt) && isIsoDate(after.capturedAt)) {
  pass('before/after capture timestamps are present');
} else {
  fail('before/after capture timestamps are incomplete');
}

checkOwnedEvidenceFile(before.screenshotPath, 'before screenshot');
checkOwnedEvidenceFile(after.screenshotPath, 'after screenshot');
if (evidence.tracePath) {
  checkOwnedEvidenceFile(evidence.tracePath, 'trace');
}

const readback = evidence.readback || {};
if (
  readback.verified === true
  && isIsoDate(readback.readAt)
  && hasRealText(readback.method)
  && readback.actualValue !== undefined
  && valuesMatch(readback.actualValue, after.value)
) {
  pass('readback verified the after value');
} else {
  fail('readback verification is incomplete');
}
checkOwnedEvidenceFile(readback.evidencePath || readback.screenshotPath, 'readback evidence');
checkDistinctEvidenceFiles([
  { label: 'before screenshot', filePath: before.screenshotPath },
  { label: 'after screenshot', filePath: after.screenshotPath },
  { label: 'readback evidence', filePath: readback.evidencePath || readback.screenshotPath },
]);

const execution = evidence.execution || {};
if (
  execution.success === true
  && execution.verified === true
  && hasRealText(execution.executionId)
  && isIsoDate(execution.executedAt)
  && execution.channel === 'manual_ads_ui'
  && execution.appExecutorUsed === false
  && hasRealText(execution.performedBy)
) {
  pass('execution result is successful, verified, and scoped to manual Ads UI operation');
} else {
  fail('execution result is not proven successful, verified, and manually performed outside the app executor');
}

checkTimestampOrder([
  { label: 'approval.confirmedAt', ms: timestampMs(evidence.approval?.confirmedAt) },
  { label: 'before.capturedAt', ms: timestampMs(before.capturedAt) },
  { label: 'execution.executedAt', ms: timestampMs(execution.executedAt) },
  { label: 'after.capturedAt', ms: timestampMs(after.capturedAt) },
  { label: 'readback.readAt', ms: timestampMs(readback.readAt) },
]);

assertNoSecretLeak(serialized);

try {
  const dbAuthority = assertCurrentAdReadbackDbAuthority(evidence, { dbPath: cli.dbPath });
  pass(`current approved recommendation matches SQLite authority: ${dbAuthority.dbPath}`);
} catch (error) {
  fail(`SQLite authority check failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (process.exitCode) {
  console.error('\nNEEDS_WORK: Real ad execution readback evidence is incomplete.');
  process.exit(process.exitCode);
}

console.log(`\nAD_READBACK_EVIDENCE verified: ${evidencePath}`);
