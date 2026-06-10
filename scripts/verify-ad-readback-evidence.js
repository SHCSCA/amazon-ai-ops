const fs = require('fs');
const path = require('path');

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

const { path: evidencePath, data: evidence } = readEvidence(process.argv[2]);
const serialized = JSON.stringify(evidence);

if (evidence.kind === 'real-ad-execution-readback') {
  pass('evidence kind is real-ad-execution-readback');
} else {
  fail(`unexpected evidence kind: ${evidence.kind}`);
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
  && String(before.value) !== String(after.value)
  && hasRealText(before.liveBidSourceNote)
) {
  pass('before/after values are present, live-sourced, and changed');
} else {
  fail('before/after values do not prove a live Ads UI change');
}

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
  && String(readback.actualValue) === String(after.value)
) {
  pass('readback verified the after value');
} else {
  fail('readback verification is incomplete');
}
checkOwnedEvidenceFile(readback.evidencePath || readback.screenshotPath, 'readback evidence');

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

if (process.exitCode) {
  console.error('\nNEEDS_WORK: Real ad execution readback evidence is incomplete.');
  process.exit(process.exitCode);
}

console.log(`\nAD_READBACK_EVIDENCE verified: ${evidencePath}`);
