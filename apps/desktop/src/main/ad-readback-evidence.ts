import * as fs from 'fs';
import * as path from 'path';

export type AdReadbackEvidenceInput = {
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

function timestampMs(value: unknown): number {
  if (!hasOperatorText(value)) return Number.NaN;
  const ms = Date.parse(String(value));
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function timestampsAreOrdered(...values: unknown[]): boolean {
  const stamps = values.map(timestampMs);
  return stamps.every(Number.isFinite) && stamps.every((stamp, index) => index === 0 || stamp >= stamps[index - 1]);
}

export function buildAdReadbackEvidence(input: AdReadbackEvidenceInput): Record<string, any> {
  const now = new Date().toISOString();
  const target = input.target || {};
  const before = input.before || {};
  const after = input.after || {};
  const readback = input.readback || {};
  const execution = input.execution || {};
  const approval = input.approval || {};
  const risk = input.risk || {};
  const beforeValue = String(before.value ?? '');
  const afterValue = String(after.value ?? '');
  const actualValue = String(readback.actualValue ?? '');
  const complete = Boolean(
    approval.operatorConfirmed === true
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
      && hasOperatorText(target.campaignName)
      && hasOperatorText(target.adGroupName)
      && hasOperatorText(target.entityType)
      && hasOperatorText(target.entityName)
      && hasOperatorText(target.actionType)
      && hasOperatorText(beforeValue)
      && hasOperatorText(afterValue)
      && beforeValue !== afterValue
      && actualValue === afterValue
      && isEvidenceImagePath(before.screenshotPath)
      && isEvidenceImagePath(after.screenshotPath)
      && isEvidenceImagePath(readback.evidencePath || readback.screenshotPath)
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
    kind: 'real-ad-execution-readback',
    status: complete ? 'PASS' : 'NEEDS_WORK',
    createdAt: now,
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
      recommendationId: String(input.source?.recommendationId || ''),
      evidencePath: String(input.source?.evidencePath || ''),
      entityType: String(input.source?.entityType || ''),
      currentValue: String(input.source?.currentValue || ''),
      recommendedValue: String(input.source?.recommendedValue || ''),
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
    '## Scope',
    '',
    `- Store: ${evidence.target.storeName}`,
    `- Marketplace: ${evidence.target.marketplaceCode}`,
    `- Campaign: ${evidence.target.campaignName}`,
    `- Ad group: ${evidence.target.adGroupName}`,
    `- Entity: ${evidence.target.entityType} / ${evidence.target.entityName}`,
    `- Action: ${evidence.target.actionType}`,
    `- Approval: ${evidence.approval.approverName || 'NEEDS_WORK'} / ${evidence.approval.approvalArtifactPath || 'NEEDS_WORK'}`,
    `- Execution channel: ${evidence.execution.channel}; appExecutorUsed=${evidence.execution.appExecutorUsed}`,
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
