import * as fs from 'fs';
import * as path from 'path';
import type { AdReadbackAuthorityRecord } from '@amazon-ai-ops/shared-types';

export type AdReadbackEvidenceInput = {
  authority?: AdReadbackAuthorityRecord;
  target?: Record<string, any>;
  source?: Record<string, any>;
  approval?: Record<string, any>;
  risk?: Record<string, any>;
  before?: Record<string, any>;
  after?: Record<string, any>;
  readback?: Record<string, any>;
  execution?: Record<string, any>;
};

function canonicalizeExistingPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
}

function hasOperatorText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !value.trim().startsWith('FILL:');
}

function normalizeReadbackPath(value: unknown): string {
  if (!hasOperatorText(value)) return String(value || '');
  return canonicalizeExistingPath(String(value));
}

function isEvidenceImagePath(value: unknown): boolean {
  if (!hasOperatorText(value)) return false;
  const resolved = path.resolve(String(value));
  const ext = path.extname(resolved).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
}

function evidenceImagePathsAreDistinct(...values: unknown[]): boolean {
  if (!values.every(isEvidenceImagePath)) return false;
  const resolved = values.map((value) => canonicalizeExistingPath(String(value)).toLowerCase());
  return new Set(resolved).size === resolved.length;
}

function timestampMs(value: unknown): number {
  if (!hasOperatorText(value)) return Number.NaN;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function timestampsAreOrdered(...values: unknown[]): boolean {
  const stamps = values.map(timestampMs);
  return stamps.every(Number.isFinite) && stamps.every((stamp, index) => index === 0 || stamp >= stamps[index - 1]);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function isRealReportPath(value: unknown): boolean {
  if (!hasOperatorText(value)) return false;
  const resolved = path.resolve(String(value));
  const ext = path.extname(resolved).toLowerCase();
  return ['.xlsx', '.xls', '.csv'].includes(ext) && fs.existsSync(resolved) && fs.statSync(resolved).isFile();
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

function actionDirectionIsValid(actionType: unknown, beforeValue: unknown, afterValue: unknown): boolean {
  if (String(actionType || '').trim() !== 'lower_bid') return true;
  const beforeNumber = parseExecutableNumber(beforeValue);
  const afterNumber = parseExecutableNumber(afterValue);
  return Number.isFinite(beforeNumber) && Number.isFinite(afterNumber) && afterNumber < beforeNumber;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function objectOrEmpty(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function buildAdReadbackEvidence(input: AdReadbackEvidenceInput): Record<string, any> {
  const now = new Date().toISOString();
  const authority = objectOrEmpty(input.authority);
  const target = input.target || {};
  const before = input.before || {};
  const after = input.after || {};
  const readback = input.readback || {};
  const execution = input.execution || {};
  const approval = input.approval || {};
  const risk = input.risk || {};
  const source = input.source || {};
  const beforeValue = String(before.value ?? '');
  const afterValue = String(after.value ?? '');
  const actualValue = String(readback.actualValue ?? '');
  const sourceRow = numberOrNull(source.sourceRow);
  const sourceFiles = stringArray(source.sourceFiles);
  const complete = Boolean(
    authority.recommendationStatusAtExport === 'approved'
      && Number.isInteger(authority.recommendationId)
      && authority.recommendationId > 0
      && Number.isInteger(authority.recommendationRevision)
      && authority.recommendationRevision >= 0
      && hasOperatorText(authority.dateFrom)
      && hasOperatorText(authority.dateTo)
      && hasOperatorText(authority.storeName)
      && hasOperatorText(authority.marketplaceCode)
      && hasOperatorText(authority.asin)
      && hasOperatorText(authority.batchId)
      && Number.isFinite(timestampMs(authority.checkedAt))
      && approval.operatorConfirmed === true
      && input.approval?.realWriteApproved === true
      && risk.allowedByPolicy === true
      && execution.success === true
      && execution.verified === true
      && readback.verified === true
      && hasOperatorText(approval.approverName)
      && hasOperatorText(approval.approvalArtifactPath)
      && hasOperatorText(execution.executedBy)
      && hasOperatorText(before.liveBidSourceNote)
      && hasOperatorText(target.storeName)
      && hasOperatorText(target.marketplaceCode)
      && hasOperatorText(target.asin)
      && hasOperatorText(target.campaignName)
      && hasOperatorText(target.adGroupName)
      && hasOperatorText(target.entityType)
      && hasOperatorText(target.entityName)
      && hasOperatorText(target.actionType)
      && hasOperatorText(source.batchId)
      && hasOperatorText(source.metricDate)
      && sourceFiles.length > 0
      && sourceFiles.every(isRealReportPath)
      && sourceRow !== null
      && hasOperatorText(source.currentValue)
      && hasOperatorText(source.recommendedValue)
      && hasOperatorText(beforeValue)
      && hasOperatorText(afterValue)
      && !valuesMatch(beforeValue, afterValue)
      && actionDirectionIsValid(target.actionType, beforeValue, afterValue)
      && valuesMatch(actualValue, afterValue)
      && isEvidenceImagePath(before.screenshotPath)
      && isEvidenceImagePath(after.screenshotPath)
      && isEvidenceImagePath(readback.evidencePath || readback.screenshotPath)
      && evidenceImagePathsAreDistinct(
        before.screenshotPath,
        after.screenshotPath,
        readback.evidencePath || readback.screenshotPath,
      )
      && hasOperatorText(execution.executionId)
      && timestampsAreOrdered(
        approval.confirmedAt,
        before.capturedAt,
        execution.executedAt,
        after.capturedAt,
        readback.readAt,
      )
  );

  return {
    schemaVersion: 2,
    kind: 'real-ad-execution-readback',
    status: complete ? 'PASS' : 'NEEDS_WORK',
    createdAt: now,
    authority: {
      recommendationId: numberOrNull(authority.recommendationId),
      recommendationRevision: typeof authority.recommendationRevision === 'number'
        && Number.isInteger(authority.recommendationRevision)
        && authority.recommendationRevision >= 0
        ? authority.recommendationRevision
        : null,
      recommendationStatusAtExport: String(authority.recommendationStatusAtExport || ''),
      dateFrom: String(authority.dateFrom || ''),
      dateTo: String(authority.dateTo || ''),
      storeName: String(authority.storeName || ''),
      marketplaceCode: String(authority.marketplaceCode || ''),
      asin: String(authority.asin || ''),
      batchId: String(authority.batchId || ''),
      checkedAt: String(authority.checkedAt || ''),
    },
    realWriteApproved: input.approval?.realWriteApproved === true,
    safety: {
      full8Started: false,
      listingAiDraftOnly: false,
      adWriteActionsPerformed: complete,
    },
    approval: {
      operatorConfirmed: approval.operatorConfirmed === true,
      scope: String(approval.scope || 'FILL: operator-approved low-risk scope, including store/site/campaign/ad group/entity/action'),
      confirmedAt: String(approval.confirmedAt || 'FILL: approval timestamp in ISO format'),
      approverName: String(approval.approverName || ''),
      approvalArtifactPath: String(approval.approvalArtifactPath || ''),
      note: String(approval.note || ''),
    },
    target: {
      storeName: String(target.storeName || ''),
      marketplaceCode: String(target.marketplaceCode || ''),
      portfolioName: String(target.portfolioName || ''),
      asin: String(target.asin || ''),
      metricDate: String(target.metricDate || ''),
      campaignName: String(target.campaignName || ''),
      adGroupName: String(target.adGroupName || ''),
      entityType: String(target.entityType || 'target'),
      entityName: String(target.entityName || ''),
      actionType: String(target.actionType || 'lower_bid'),
    },
    risk: {
      level: 'low',
      allowedByPolicy: risk.allowedByPolicy === true,
      rationale: String(risk.rationale || 'FILL: why this action is low risk and reversible or bounded'),
    },
    before: {
      value: beforeValue || 'FILL: value before write',
      capturedAt: String(before.capturedAt || 'FILL: before screenshot timestamp in ISO format'),
      screenshotPath: normalizeReadbackPath(before.screenshotPath || 'FILL: absolute path to before screenshot'),
      liveBidSourceNote: String(before.liveBidSourceNote || ''),
    },
    after: {
      value: afterValue || 'FILL: value after write',
      capturedAt: String(after.capturedAt || 'FILL: after screenshot timestamp in ISO format'),
      screenshotPath: normalizeReadbackPath(after.screenshotPath || 'FILL: absolute path to after screenshot'),
    },
    readback: {
      verified: readback.verified === true,
      method: String(readback.method || 'FILL: Ads UI reload/API/readback method'),
      readAt: String(readback.readAt || 'FILL: readback timestamp in ISO format'),
      actualValue: actualValue || 'FILL: must equal after.value',
      evidencePath: normalizeReadbackPath(readback.evidencePath || readback.screenshotPath || 'FILL: absolute path to readback screenshot/trace evidence'),
    },
    execution: {
      success: execution.success === true,
      verified: execution.verified === true,
      executionId: String(execution.executionId || 'FILL: local action log id or Ads operation id'),
      executedAt: String(execution.executedAt || 'FILL: manual execution timestamp in ISO format'),
      channel: 'manual_ads_ui',
      performedBy: String(execution.executedBy || ''),
      appExecutorUsed: false,
    },
    source: {
      recommendationId: String(source.recommendationId || ''),
      recommendationRevision: typeof source.recommendationRevision === 'number'
        && Number.isInteger(source.recommendationRevision)
        && source.recommendationRevision >= 0
        ? source.recommendationRevision
        : null,
      batchId: String(source.batchId || ''),
      metricDate: String(source.metricDate || ''),
      sourceFiles,
      sourceRow,
      explanationSource: String(source.explanationSource || ''),
      aiModel: String(source.aiModel || ''),
      evidencePath: String(source.evidencePath || ''),
      entityType: String(source.entityType || ''),
      currentValue: String(source.currentValue || ''),
      recommendedValue: String(source.recommendedValue || ''),
      decisionAgreement: String(source.decisionAgreement || ''),
      decisionSource: String(source.decisionSource || ''),
      decisionReasons: stringArray(source.decisionReasons),
      decisionRiskWarnings: stringArray(source.decisionRiskWarnings),
      aiStrategySource: String(source.aiStrategySource || ''),
      aiLifecycleStage: String(source.aiLifecycleStage || ''),
      aiStrategySummary: String(source.aiStrategySummary || ''),
      aiStrategyFallbackReason: String(source.aiStrategyFallbackReason || ''),
      aiActionFallbackReason: String(source.aiActionFallbackReason || ''),
      aiMainProblems: stringArray(source.aiMainProblems),
      aiThresholdSuggestions: objectOrEmpty(source.aiThresholdSuggestions),
      aiStrategyRiskWarnings: stringArray(source.aiStrategyRiskWarnings),
      quantStatus: String(source.quantStatus || ''),
      quantLifecycleStage: String(source.quantLifecycleStage || ''),
      quantReasons: stringArray(source.quantReasons),
      quantThresholds: objectOrEmpty(source.quantThresholds),
      quantReviewRequired: source.quantReviewRequired === true,
      operationEventCount: numberOrNull(source.operationEventCount),
      productContextCount: numberOrNull(source.productContextCount),
      productStage: String(source.productStage || ''),
      productTargetAcos: numberOrNull(source.productTargetAcos),
      productTargetTacos: numberOrNull(source.productTargetTacos),
      productTargetNetMargin: numberOrNull(source.productTargetNetMargin),
      productMinPrice: numberOrNull(source.productMinPrice),
    },
    notes: [
      'Generated by the desktop readback evidence form. verify:ad-readback remains the authoritative acceptance gate.',
      'Source current/recommended values are recommendation inputs, not live Ads before/after bid proof.',
      'No ad write is performed by this export action; execution.channel=manual_ads_ui means the operator performed any approved write outside this export action.',
    ],
  };
}

export function adReadbackEvidenceToMarkdown(evidence: Record<string, any>, jsonPath: string): string {
  return [
    '# Real Ad Execution Readback Evidence',
    '',
    `Status: ${evidence.status}`,
    '',
    `Evidence JSON: \`${jsonPath}\``,
    '',
    '## Authority',
    '',
    `- Schema: v${evidence.schemaVersion || ''}`,
    `- Recommendation: #${evidence.authority?.recommendationId || ''} / revision ${evidence.authority?.recommendationRevision ?? ''} / ${evidence.authority?.recommendationStatusAtExport || ''}`,
    `- Scope: ${evidence.authority?.storeName || ''} / ${evidence.authority?.marketplaceCode || ''} / ${evidence.authority?.asin || ''} / ${evidence.authority?.dateFrom || ''}~${evidence.authority?.dateTo || ''}`,
    `- Batch: ${evidence.authority?.batchId || ''}`,
    `- Checked at: ${evidence.authority?.checkedAt || ''}`,
    '',
    '## Scope',
    '',
    `- Store: ${evidence.target.storeName}`,
    `- Marketplace: ${evidence.target.marketplaceCode}`,
    `- Campaign: ${evidence.target.campaignName}`,
    `- Ad group: ${evidence.target.adGroupName}`,
    `- Entity: ${evidence.target.entityType} / ${evidence.target.entityName}`,
    `- Action: ${evidence.target.actionType}`,
    `- Approval: ${evidence.approval.approverName || 'NEEDS_WORK'} / ${evidence.approval.approvalArtifactPath || 'NEEDS_WORK'}`,
    `- Approval note: ${evidence.approval.note || ''}`,
    `- Source recommendation: ${evidence.source.recommendationId || ''}`,
    `- Source batch: ${evidence.source.batchId || ''}`,
    `- Source metric date: ${evidence.source.metricDate || ''}`,
    `- Source files: ${(evidence.source.sourceFiles || []).join(', ')}`,
    `- Source row: ${evidence.source.sourceRow ?? ''}`,
    `- Source explanation: ${evidence.source.explanationSource || ''}${evidence.source.aiModel ? ` / ${evidence.source.aiModel}` : ''}`,
    `- Execution channel: ${evidence.execution.channel}; appExecutorUsed=${evidence.execution.appExecutorUsed}`,
    '',
    '## Strategy Context',
    '',
    `- Product stage: ${evidence.source.productStage || evidence.source.aiLifecycleStage || evidence.source.quantLifecycleStage || ''}`,
    `- Product targets: ACOS=${evidence.source.productTargetAcos ?? ''}; TACOS=${evidence.source.productTargetTacos ?? ''}; netMargin=${evidence.source.productTargetNetMargin ?? ''}; minPrice=${evidence.source.productMinPrice ?? ''}`,
    `- Decision: ${evidence.source.decisionAgreement || ''} / ${evidence.source.decisionSource || ''}`,
    `- Decision reasons: ${(evidence.source.decisionReasons || []).join(' | ')}`,
    `- Decision risks: ${(evidence.source.decisionRiskWarnings || []).join(' | ')}`,
    `- AI strategy: ${evidence.source.aiStrategySource || ''} / ${evidence.source.aiLifecycleStage || ''}`,
    `- AI summary: ${evidence.source.aiStrategySummary || ''}`,
    `- AI strategy fallback: ${evidence.source.aiStrategyFallbackReason || ''}`,
    `- AI action explanation fallback: ${evidence.source.aiActionFallbackReason || ''}`,
    `- Quant status: ${evidence.source.quantStatus || ''} / ${evidence.source.quantLifecycleStage || ''}`,
    `- Quant reasons: ${(evidence.source.quantReasons || []).join(' | ')}`,
    `- Quant thresholds: ${JSON.stringify(evidence.source.quantThresholds || {})}`,
    '',
    '## Values',
    '',
    `- Before: ${evidence.before.value}`,
    `- After: ${evidence.after.value}`,
    `- Readback actual: ${evidence.readback.actualValue}`,
    `- Readback evidence: ${evidence.readback.evidencePath}`,
    '',
    '## Verification',
    '',
    '```powershell',
    `pnpm run verify:ad-readback -- ${jsonPath}`,
    '```',
    '',
    evidence.status === 'PASS'
      ? 'This file claims PASS based on form completeness, but final acceptance still requires the verifier command above to pass.'
      : 'This file is NEEDS_WORK. Complete real approval, screenshots, execution, and readback before using it for final readiness.',
    '',
  ].join('\n');
}
