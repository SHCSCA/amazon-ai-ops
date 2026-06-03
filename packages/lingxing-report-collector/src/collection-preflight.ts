import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import {
  evaluateDownloadCenterDiagnosticEvidenceReadiness,
  type DownloadCenterDiagnosticEvidenceReadiness,
  type EvaluateDownloadCenterDiagnosticEvidenceOptions,
} from './diagnostic-evidence-gate';
import { getDownloadCenterAutomationReadiness } from './page-model-diagnostic';

export type DownloadCenterCollectionPreflightStatus = 'passed' | 'blocked';

export interface DownloadCenterCollectionPreflightCheck {
  name: 'page_model_ready' | 'diagnostic_evidence_ready' | 'browser_session_ready';
  status: DownloadCenterCollectionPreflightStatus;
  detail: string;
  missing: string[];
}

export interface DownloadCenterCollectionPreflightResult {
  ready: boolean;
  generatedAt: string;
  dateRange: { start: string; end: string };
  pageModel: string;
  requiresManualVerification: boolean;
  automationReadiness: ReturnType<typeof getDownloadCenterAutomationReadiness>;
  diagnosticEvidenceReadiness: DownloadCenterDiagnosticEvidenceReadiness;
  checks: DownloadCenterCollectionPreflightCheck[];
}

export interface BuildDownloadCenterCollectionPreflightOptions extends EvaluateDownloadCenterDiagnosticEvidenceOptions {
  diagnosticEvidenceReadiness?: DownloadCenterDiagnosticEvidenceReadiness;
  browserSessionReady?: boolean;
  browserSessionReason?: string;
}

export function buildDownloadCenterCollectionPreflight(
  model: DownloadCenterPageModel,
  dateRange: { start: string; end: string },
  diagnostic?: DownloadCenterDiagnosticResult,
  options: BuildDownloadCenterCollectionPreflightOptions = {},
): DownloadCenterCollectionPreflightResult {
  const automationReadiness = getDownloadCenterAutomationReadiness(model);
  const diagnosticEvidenceReadiness = options.diagnosticEvidenceReadiness
    ?? evaluateDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, diagnostic, options);
  const checks: DownloadCenterCollectionPreflightCheck[] = [
    {
      name: 'page_model_ready',
      status: automationReadiness.ready ? 'passed' : 'blocked',
      detail: automationReadiness.reason || 'download center page model can run selector-driven automation',
      missing: automationReadiness.missing,
    },
    {
      name: 'diagnostic_evidence_ready',
      status: diagnosticEvidenceReadiness.ready ? 'passed' : 'blocked',
      detail: diagnosticEvidenceReadiness.reason || `diagnostic ${diagnosticEvidenceReadiness.diagnosticId ?? 'unknown'} is fresh and matches the active page model/date range`,
      missing: diagnosticEvidenceReadiness.missing,
    },
  ];
  if (typeof options.browserSessionReady === 'boolean') {
    checks.push({
      name: 'browser_session_ready',
      status: options.browserSessionReady ? 'passed' : 'blocked',
      detail: options.browserSessionReady ? 'Lingxing browser session is ready' : (options.browserSessionReason || 'Lingxing browser session is not ready'),
      missing: options.browserSessionReady ? [] : ['browserSession'],
    });
  }

  return {
    ready: checks.every((check) => check.status === 'passed'),
    generatedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    dateRange,
    pageModel: model.name,
    requiresManualVerification: model.requiresManualVerification,
    automationReadiness,
    diagnosticEvidenceReadiness,
    checks,
  };
}

export function downloadCenterCollectionPreflightToMarkdown(result: DownloadCenterCollectionPreflightResult): string {
  return [
    '# Lingxing Collection Preflight',
    '',
    `Ready: ${result.ready ? 'yes' : 'no'}`,
    `Generated at: ${result.generatedAt}`,
    `Date range: ${result.dateRange.start} to ${result.dateRange.end}`,
    `Page model: ${result.pageModel}`,
    `Requires manual verification: ${result.requiresManualVerification ? 'yes' : 'no'}`,
    '',
    '| Check | Status | Missing | Detail |',
    '| --- | --- | --- | --- |',
    ...result.checks.map((check) => `| ${check.name} | ${check.status} | ${check.missing.join(', ') || 'none'} | ${check.detail || 'none'} |`),
    '',
  ].join('\n');
}

export function summarizeDownloadCenterCollectionPreflightBlockers(
  result: DownloadCenterCollectionPreflightResult,
): string {
  const blockers = result.checks.filter((check) => check.status !== 'passed');
  if (blockers.length === 0) {
    return 'collection preflight passed';
  }
  return blockers
    .map((check) => {
      const missing = check.missing.length > 0 ? ` missing: ${check.missing.join(', ')}` : '';
      return `${check.name}: ${check.detail}${missing}`;
    })
    .join('; ');
}

export function assertDownloadCenterCollectionPreflightReady(
  result: DownloadCenterCollectionPreflightResult,
): void {
  if (result.ready) return;
  throw new Error(`领星采集预检未通过，未创建采集批次：${summarizeDownloadCenterCollectionPreflightBlockers(result)}`);
}
