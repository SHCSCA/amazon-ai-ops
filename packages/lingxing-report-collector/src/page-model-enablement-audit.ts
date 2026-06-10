import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel, LingxingReportType } from '@amazon-ai-ops/shared-types';
import {
  evaluateDownloadCenterDiagnosticEvidenceReadiness,
  type DownloadCenterDiagnosticEvidenceReadiness,
  type EvaluateDownloadCenterDiagnosticEvidenceOptions,
} from './diagnostic-evidence-gate';
import { getDownloadCenterAutomationReadiness } from './page-model-diagnostic';
import { LINGXING_AD_REPORTS } from './report-types';

export type DownloadCenterPageModelEnablementAuditStatus = 'passed' | 'blocked';

export interface DownloadCenterPageModelEnablementAuditCheck {
  name: 'automation_structure_ready' | 'diagnostic_evidence_ready' | 'canary_evidence_ready';
  status: DownloadCenterPageModelEnablementAuditStatus;
  missing: string[];
  detail: string;
}

export interface DownloadCenterCanaryEvidenceReadiness {
  ready: boolean;
  requiredReportTypes: LingxingReportType[];
  coveredReportTypes: LingxingReportType[];
  missingReportTypes: LingxingReportType[];
  reason?: string;
}

export interface DownloadCenterPageModelEnablementAuditResult {
  canDisableManualVerification: boolean;
  generatedAt: string;
  dateRange: { start: string; end: string };
  target?: {
    storeName?: string;
    marketplaceCode?: string;
  };
  pageModel: string;
  currentlyRequiresManualVerification: boolean;
  automationReadiness: ReturnType<typeof getDownloadCenterAutomationReadiness>;
  diagnosticEvidenceReadiness: DownloadCenterDiagnosticEvidenceReadiness;
  canaryEvidenceReadiness: DownloadCenterCanaryEvidenceReadiness;
  checks: DownloadCenterPageModelEnablementAuditCheck[];
}

export interface AuditDownloadCenterPageModelEnablementOptions extends EvaluateDownloadCenterDiagnosticEvidenceOptions {
  diagnosticEvidenceReadiness?: DownloadCenterDiagnosticEvidenceReadiness;
  canaryEvidenceReadiness?: DownloadCenterCanaryEvidenceReadiness;
  canaryReportTypes?: LingxingReportType[];
  requiredCanaryReportTypes?: LingxingReportType[];
}

export function evaluateDownloadCenterCanaryEvidenceReadiness(
  coveredReportTypes: LingxingReportType[] = [],
  requiredReportTypes: LingxingReportType[] = LINGXING_AD_REPORTS.map((report) => report.type),
): DownloadCenterCanaryEvidenceReadiness {
  const uniqueCovered = Array.from(new Set(coveredReportTypes));
  const missingReportTypes = requiredReportTypes.filter((type) => !uniqueCovered.includes(type));
  return {
    ready: missingReportTypes.length === 0,
    requiredReportTypes: [...requiredReportTypes],
    coveredReportTypes: uniqueCovered,
    missingReportTypes,
    reason: missingReportTypes.length > 0
      ? `successful same-scope canary evidence is missing for ${missingReportTypes.join(',')}`
      : undefined,
  };
}

export function auditDownloadCenterPageModelEnablement(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  diagnostic?: DownloadCenterDiagnosticResult,
  options: AuditDownloadCenterPageModelEnablementOptions = {},
): DownloadCenterPageModelEnablementAuditResult {
  const automationCandidate: DownloadCenterPageModel = {
    ...model,
    requiresManualVerification: false,
  };
  const automationReadiness = getDownloadCenterAutomationReadiness(automationCandidate);
  const diagnosticEvidenceReadiness = options.diagnosticEvidenceReadiness ?? evaluateDownloadCenterDiagnosticEvidenceReadiness(
    model,
    dateRange,
    diagnostic,
    options,
  );
  const canaryEvidenceReadiness = options.canaryEvidenceReadiness ?? evaluateDownloadCenterCanaryEvidenceReadiness(
    options.canaryReportTypes,
    options.requiredCanaryReportTypes,
  );
  const checks: DownloadCenterPageModelEnablementAuditCheck[] = [
    {
      name: 'automation_structure_ready',
      status: automationReadiness.ready ? 'passed' : 'blocked',
      missing: automationReadiness.missing,
      detail: automationReadiness.reason || 'page model has complete scoped action selectors for unattended automation',
    },
    {
      name: 'diagnostic_evidence_ready',
      status: diagnosticEvidenceReadiness.ready ? 'passed' : 'blocked',
      missing: diagnosticEvidenceReadiness.missing,
      detail: diagnosticEvidenceReadiness.reason || `diagnostic ${diagnosticEvidenceReadiness.diagnosticId ?? 'unknown'} proves the saved page model/date/store/site setup selectors`,
    },
    {
      name: 'canary_evidence_ready',
      status: canaryEvidenceReadiness.ready ? 'passed' : 'blocked',
      missing: canaryEvidenceReadiness.missingReportTypes,
      detail: canaryEvidenceReadiness.reason || 'successful same-scope canary evidence covers every Lingxing report type',
    },
  ];

  return {
    canDisableManualVerification: checks.every((check) => check.status === 'passed'),
    generatedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    dateRange,
    target: options.target,
    pageModel: model.name,
    currentlyRequiresManualVerification: model.requiresManualVerification,
    automationReadiness,
    diagnosticEvidenceReadiness,
    canaryEvidenceReadiness,
    checks,
  };
}

export function downloadCenterPageModelEnablementAuditToMarkdown(
  result: DownloadCenterPageModelEnablementAuditResult,
): string {
  return [
    '# Lingxing Download Center Page Model Enablement Audit',
    '',
    `Can disable manual verification: ${result.canDisableManualVerification ? 'yes' : 'no'}`,
    `Generated at: ${result.generatedAt}`,
    `Date range: ${result.dateRange.start} to ${result.dateRange.end}`,
    `Store: ${result.target?.storeName || 'not specified'}`,
    `Marketplace: ${result.target?.marketplaceCode || 'not specified'}`,
    `Page model: ${result.pageModel}`,
    `Currently requires manual verification: ${result.currentlyRequiresManualVerification ? 'yes' : 'no'}`,
    `Canary coverage: ${result.canaryEvidenceReadiness.coveredReportTypes.join(', ') || 'none'} / ${result.canaryEvidenceReadiness.requiredReportTypes.join(', ')}`,
    '',
    '| Check | Status | Missing | Detail |',
    '| --- | --- | --- | --- |',
    ...result.checks.map((check) => `| ${check.name} | ${check.status} | ${check.missing.join(', ') || 'none'} | ${check.detail || 'none'} |`),
    '',
    '## Operator Rule',
    '',
    '- Only set `requiresManualVerification` to `false` after this audit says `yes` and the screenshot/DOM evidence has been manually reviewed.',
    '- The audit requires successful same-scope canary evidence for every report type before full unattended collection is enabled.',
    '- After saving the enabled override, run the read-only diagnostic again for the same date range, store, and marketplace before starting collection.',
    '',
  ].join('\n');
}
