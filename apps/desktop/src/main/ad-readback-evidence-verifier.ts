import * as fs from 'fs';
import * as path from 'path';

const LOW_RISK_ACTIONS = new Set([
  'lower_bid',
  'pause_target',
  'add_negative_exact',
  'add_negative_phrase',
  'add_negative_broad',
]);

export interface VerifiedAdReadbackEvidence {
  evidencePath: string;
  ready: boolean;
  status: string;
  checks: Array<{ label: string; passed: boolean; details?: string }>;
  issues: string[];
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasRealText(value: unknown): boolean {
  return hasText(value) && !String(value).trim().startsWith('FILL:');
}

function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function looksLikeLocalPath(value: string): boolean {
  return /[\\/]/.test(value) || /^[A-Za-z]:/.test(value) || /\.[A-Za-z0-9]{2,6}$/.test(value);
}

function isTraceableApprovalArtifact(value: unknown): boolean {
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

function timestampMs(value: unknown): number {
  if (!isIsoDate(value)) return Number.NaN;
  return Date.parse(String(value));
}

function isPositiveNumber(value: unknown): boolean {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function parseExecutableNumber(value: unknown): number {
  const text = String(value ?? '').trim();
  if (!text || /[%％]/.test(text)) return Number.NaN;
  return Number(text.replace(/^\$/, '').replace(/\s*usd$/i, ''));
}

function valuesMatch(left: unknown, right: unknown): boolean {
  const leftNumber = parseExecutableNumber(left);
  const rightNumber = parseExecutableNumber(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return Math.abs(leftNumber - rightNumber) < 0.0001;
  }
  return String(left ?? '').trim() === String(right ?? '').trim();
}

function checkActionValueDirection(actionType: unknown, beforeValue: unknown, afterValue: unknown): boolean {
  if (String(actionType || '') !== 'lower_bid') return true;
  const beforeNumber = parseExecutableNumber(beforeValue);
  const afterNumber = parseExecutableNumber(afterValue);
  return Number.isFinite(beforeNumber) && Number.isFinite(afterNumber) && afterNumber < beforeNumber;
}

function isRealReportFile(filePath: unknown): boolean {
  if (!hasRealText(filePath)) return false;
  const resolved = path.resolve(String(filePath).trim());
  const ext = path.extname(resolved).toLowerCase();
  return ['.xlsx', '.xls', '.csv'].includes(ext) && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

function checkOwnedEvidenceFile(filePath: unknown): { ok: boolean; details?: string } {
  if (!hasRealText(filePath)) return { ok: false, details: 'path missing' };
  const resolved = path.resolve(String(filePath));
  const ext = path.extname(resolved).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp', '.zip'].includes(ext)) {
    return { ok: false, details: `unsupported evidence extension: ${ext}` };
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return { ok: false, details: `evidence file does not exist: ${resolved}` };
  }
  return { ok: true, details: resolved };
}

function evidenceFilesAreDistinct(files: Array<{ label: string; filePath: unknown }>): boolean {
  if (!files.every((item) => hasRealText(item.filePath))) return false;
  const resolved = files.map((item) => path.resolve(String(item.filePath).trim()).toLowerCase());
  return new Set(resolved).size === resolved.length;
}

function containsSecret(serialized: string): boolean {
  return [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
    /deepseek[_-]?api[_-]?key["']?\s*[:=]\s*["'][^"']+/i,
    /LINGXING_PASSWORD\s*[:=]\s*['"]?(?!<)[^'"\s]+/i,
  ].some((pattern) => pattern.test(serialized));
}

export function verifyAdReadbackEvidenceFile(inputPath: string): VerifiedAdReadbackEvidence {
  const evidencePath = path.resolve(inputPath || '');
  const checks: VerifiedAdReadbackEvidence['checks'] = [];
  const addCheck = (label: string, passed: boolean, details?: string) => {
    checks.push({ label, passed, details });
  };

  if (!evidencePath || !fs.existsSync(evidencePath)) {
    addCheck('evidence JSON exists', false, evidencePath || '<missing>');
    return {
      evidencePath,
      ready: false,
      status: 'NEEDS_WORK',
      checks,
      issues: checks.map((check) => `${check.label}: ${check.details || ''}`.trim()),
    };
  }

  let evidence: Record<string, any>;
  try {
    evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    addCheck('evidence JSON is readable', true, evidencePath);
  } catch (error) {
    addCheck('evidence JSON is readable', false, error instanceof Error ? error.message : String(error));
    return {
      evidencePath,
      ready: false,
      status: 'NEEDS_WORK',
      checks,
      issues: checks.filter((check) => !check.passed).map((check) => `${check.label}: ${check.details || ''}`.trim()),
    };
  }

  addCheck('evidence kind is real-ad-execution-readback', evidence.kind === 'real-ad-execution-readback', String(evidence.kind || '<missing>'));
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
  addCheck(
    'evidence carries a complete v2 authority record',
    authorityReady,
    authorityReady ? undefined : 'schemaVersion=2 and approved recommendation id/revision/scope/batch are required',
  );
  addCheck('status is PASS and real write was explicitly approved', evidence.status === 'PASS' && evidence.realWriteApproved === true);
  addCheck(
    'safety flags isolate a real ad action from full8/listing AI flows',
    evidence.safety?.full8Started === false
      && evidence.safety?.listingAiDraftOnly === false
      && evidence.safety?.adWriteActionsPerformed === true,
  );

  addCheck(
    'operator approval scope, approver, traceable artifact, and timestamp are present',
    evidence.approval?.operatorConfirmed === true
      && hasRealText(evidence.approval?.scope)
      && isIsoDate(evidence.approval?.confirmedAt)
      && hasRealText(evidence.approval?.approverName)
      && isTraceableApprovalArtifact(evidence.approval?.approvalArtifactPath),
  );

  const target = evidence.target || {};
  addCheck(
    'target context includes store/site/campaign/ad group/entity/action',
    hasText(target.storeName)
      && hasText(target.marketplaceCode)
      && hasRealText(target.campaignName)
      && hasRealText(target.adGroupName)
      && hasText(target.entityType)
      && hasRealText(target.entityName)
      && hasText(target.actionType),
  );

  const source = evidence.source || {};
  const sourceFiles = Array.isArray(source.sourceFiles) ? source.sourceFiles : [];
  const authorityMatchesEvidence = authorityReady
    && String(source.recommendationId || '') === String(authority.recommendationId)
    && Number(source.recommendationRevision) === Number(authority.recommendationRevision)
    && String(source.batchId || '') === String(authority.batchId)
    && String(target.storeName || '').trim().toLowerCase() === String(authority.storeName || '').trim().toLowerCase()
    && String(target.marketplaceCode || '').trim().toLowerCase() === String(authority.marketplaceCode || '').trim().toLowerCase()
    && String(target.asin || '').trim().toUpperCase() === String(authority.asin || '').trim().toUpperCase();
  addCheck(
    'v2 authority matches target and source identity',
    authorityMatchesEvidence,
    authorityMatchesEvidence ? undefined : 'recommendation id/revision, batch, store, site, or ASIN mismatch',
  );
  addCheck(
    'source report traceability includes real spreadsheet file(s) and row number',
    sourceFiles.length > 0 && sourceFiles.every(isRealReportFile) && isPositiveNumber(source.sourceRow),
  );

  addCheck(
    'action is low-risk and policy-allowed',
    LOW_RISK_ACTIONS.has(String(target.actionType || ''))
      && evidence.risk?.level === 'low'
      && evidence.risk?.allowedByPolicy === true
      && hasRealText(evidence.risk?.rationale),
  );

  const before = evidence.before || {};
  const after = evidence.after || {};
  addCheck(
    'before/after values are present, live-sourced, and changed',
    before.value !== undefined
      && after.value !== undefined
      && hasRealText(String(before.value))
      && hasRealText(String(after.value))
      && !valuesMatch(before.value, after.value)
      && hasRealText(before.liveBidSourceNote),
  );
  addCheck('lower_bid action lowered the bid value', checkActionValueDirection(target.actionType, before.value, after.value));
  addCheck('source current value is present', hasRealText(String(source.currentValue ?? '')));
  addCheck('source recommended value is present', hasRealText(String(source.recommendedValue ?? '')));
  addCheck(
    'source recommendation values are present and kept separate from live Ads before/after values',
    hasRealText(String(source.currentValue ?? '')) && hasRealText(String(source.recommendedValue ?? '')),
  );
  addCheck('before/after capture timestamps are present', isIsoDate(before.capturedAt) && isIsoDate(after.capturedAt));

  const beforeFile = checkOwnedEvidenceFile(before.screenshotPath);
  addCheck('before screenshot evidence file exists', beforeFile.ok, beforeFile.details);
  const afterFile = checkOwnedEvidenceFile(after.screenshotPath);
  addCheck('after screenshot evidence file exists', afterFile.ok, afterFile.details);
  if (evidence.tracePath) {
    const traceFile = checkOwnedEvidenceFile(evidence.tracePath);
    addCheck('trace evidence file exists', traceFile.ok, traceFile.details);
  }

  const readback = evidence.readback || {};
  addCheck(
    'readback verified the after value',
    readback.verified === true
      && isIsoDate(readback.readAt)
      && hasRealText(readback.method)
      && readback.actualValue !== undefined
      && valuesMatch(readback.actualValue, after.value),
  );
  const readbackFile = checkOwnedEvidenceFile(readback.evidencePath || readback.screenshotPath);
  addCheck('readback evidence file exists', readbackFile.ok, readbackFile.details);
  addCheck('before, after, and readback evidence files are distinct', evidenceFilesAreDistinct([
    { label: 'before screenshot', filePath: before.screenshotPath },
    { label: 'after screenshot', filePath: after.screenshotPath },
    { label: 'readback evidence', filePath: readback.evidencePath || readback.screenshotPath },
  ]));

  const execution = evidence.execution || {};
  addCheck(
    'execution result is successful, verified, and scoped to manual Ads UI operation',
    execution.success === true
      && execution.verified === true
      && hasRealText(execution.executionId)
      && isIsoDate(execution.executedAt)
      && execution.channel === 'manual_ads_ui'
      && execution.appExecutorUsed === false
      && hasRealText(execution.performedBy),
  );

  const timestampSteps = [
    { label: 'approval.confirmedAt', ms: timestampMs(evidence.approval?.confirmedAt) },
    { label: 'before.capturedAt', ms: timestampMs(before.capturedAt) },
    { label: 'execution.executedAt', ms: timestampMs(execution.executedAt) },
    { label: 'after.capturedAt', ms: timestampMs(after.capturedAt) },
    { label: 'readback.readAt', ms: timestampMs(readback.readAt) },
  ];
  const timestampsPresent = timestampSteps.every((step) => Number.isFinite(step.ms));
  const timestampsOrdered = timestampsPresent && timestampSteps.every((step, index) => index === 0 || step.ms >= timestampSteps[index - 1].ms);
  addCheck('approval, before, execution, after, and readback timestamps are ordered', timestampsOrdered);
  addCheck('evidence does not contain obvious secret patterns', !containsSecret(JSON.stringify(evidence)));

  const issues = checks
    .filter((check) => !check.passed)
    .map((check) => (check.details ? `${check.label}: ${check.details}` : check.label));

  return {
    evidencePath,
    ready: issues.length === 0,
    status: issues.length === 0 ? 'PASS' : 'NEEDS_WORK',
    checks,
    issues,
  };
}
