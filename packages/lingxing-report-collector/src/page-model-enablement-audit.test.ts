import { describe, expect, it } from 'vitest';
import type { DownloadCenterActionSelectorCheck, DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { auditDownloadCenterPageModelEnablement, downloadCenterPageModelEnablementAuditToMarkdown } from './page-model-enablement-audit';

const dateRange = { start: '2026-05-01', end: '2026-05-31' };
const checkedAt = '2026-06-01T00:00:00.000Z';
const nowMs = Date.parse(checkedAt) + 60_000;

function model(overrides: Partial<DownloadCenterPageModel> = {}): DownloadCenterPageModel {
  return {
    name: 'lingxing-download-center',
    description: 'verified model candidate',
    candidateUrls: ['https://erp.lingxing.com/download-center'],
    entryHints: ['下载中心'],
    reportNames: ['关键词报告'],
    verifySelectors: [{ name: 'body', selector: 'body', required: true }],
    requiresManualVerification: true,
    actionSelectors: {
      reportSearchInput: '#report-search',
      dateStartInput: '#start',
      dateEndInput: '#end',
      createReportButton: '#create',
      readyReportSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}")',
      statusTextSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}") .status',
      downloadButton: 'tr:has-text("{reportName}"):has-text("{dateRange}") button.download',
    },
    ...overrides,
  };
}

function check(name: DownloadCenterActionSelectorCheck['name'], selector: string, kind: DownloadCenterActionSelectorCheck['kind']): DownloadCenterActionSelectorCheck {
  return {
    name,
    selector,
    renderedSelector: selector,
    required: true,
    kind,
    matchCount: 1,
    found: true,
    usable: true,
    ambiguous: false,
  };
}

function diagnostic(pageModel = model(), overrides: Partial<DownloadCenterDiagnosticResult> = {}): DownloadCenterDiagnosticResult {
  const selectors = pageModel.actionSelectors!;
  return {
    id: 77,
    pageModel: pageModel.name,
    pageModelSnapshot: pageModel,
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    url: pageModel.candidateUrls[0],
    title: '下载中心',
    ready: true,
    requiresManualVerification: pageModel.requiresManualVerification,
    matchedEntryHints: ['下载中心'],
    matchedReportNames: ['关键词报告'],
    selectorChecks: [{ name: 'body', selector: 'body', required: true, found: true }],
    missingRequiredSelectors: [],
    actionSelectorChecks: [
      check('reportSearchInput', selectors.reportSearchInput!, 'input'),
      check('dateStartInput', selectors.dateStartInput!, 'input'),
      check('dateEndInput', selectors.dateEndInput!, 'input'),
      check('createReportButton', selectors.createReportButton, 'click'),
    ],
    checkedAt,
    ...overrides,
  };
}

describe('auditDownloadCenterPageModelEnablement', () => {
  it('passes for a manual-gated model candidate with complete scoped selectors and fresh matching diagnostic evidence', () => {
    const candidate = model();
    const result = auditDownloadCenterPageModelEnablement(candidate, dateRange, diagnostic(candidate), { nowMs });

    expect(result.canDisableManualVerification).toBe(true);
    expect(result.currentlyRequiresManualVerification).toBe(true);
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true);
  });

  it('blocks when scoped automation selectors are incomplete even if basic diagnostic evidence exists', () => {
    const candidate = model({
      actionSelectors: {
        ...model().actionSelectors!,
        readyReportSelector: 'tr:has-text("{reportName}")',
      },
    });
    const result = auditDownloadCenterPageModelEnablement(candidate, dateRange, diagnostic(candidate), { nowMs });

    expect(result.canDisableManualVerification).toBe(false);
    expect(result.automationReadiness.missing).toEqual(['readyReportSelector:dateScope']);
  });

  it('blocks when diagnostic evidence is missing, stale, or from a different model snapshot', () => {
    const candidate = model();
    const missing = auditDownloadCenterPageModelEnablement(candidate, dateRange, undefined, { nowMs });
    const stale = auditDownloadCenterPageModelEnablement(candidate, dateRange, diagnostic(candidate, {
      checkedAt: '2026-05-31T23:00:00.000Z',
    }), { nowMs });
    const different = auditDownloadCenterPageModelEnablement(candidate, dateRange, diagnostic(model({ description: 'old' })), { nowMs });

    expect(missing.diagnosticEvidenceReadiness.missing).toEqual(['diagnosticEvidence']);
    expect(stale.diagnosticEvidenceReadiness.missing).toEqual(['diagnosticFreshness']);
    expect(different.diagnosticEvidenceReadiness.missing).toEqual(['diagnosticModelSnapshot']);
  });

  it('blocks when provided diagnostic evidence readiness includes missing local evidence files', () => {
    const candidate = model();
    const result = auditDownloadCenterPageModelEnablement(candidate, dateRange, diagnostic(candidate), {
      nowMs,
      diagnosticEvidenceReadiness: {
        ready: false,
        missing: ['diagnosticScreenshotEvidence', 'diagnosticDomSnapshotEvidence:missingFile'],
        reason: 'matching diagnostic evidence files are missing or outside the app evidence directories',
      },
    });

    expect(result.canDisableManualVerification).toBe(false);
    expect(result.diagnosticEvidenceReadiness.missing).toEqual([
      'diagnosticScreenshotEvidence',
      'diagnosticDomSnapshotEvidence:missingFile',
    ]);
    expect(result.checks.find((check) => check.name === 'diagnostic_evidence_ready')).toMatchObject({
      status: 'blocked',
      detail: 'matching diagnostic evidence files are missing or outside the app evidence directories',
    });
  });

  it('requires a fresh diagnostic for the enabled model after manual verification is turned off', () => {
    const manualModel = model({ requiresManualVerification: true });
    const enabledModel = model({ requiresManualVerification: false });
    const result = auditDownloadCenterPageModelEnablement(
      enabledModel,
      dateRange,
      diagnostic(manualModel),
      { nowMs },
    );

    expect(result.canDisableManualVerification).toBe(false);
    expect(result.currentlyRequiresManualVerification).toBe(false);
    expect(result.diagnosticEvidenceReadiness.missing).toEqual(['diagnosticModelSnapshot']);
  });

  it('renders a markdown audit summary with the operator rule', () => {
    const result = auditDownloadCenterPageModelEnablement(model(), dateRange, diagnostic(), { nowMs });
    const markdown = downloadCenterPageModelEnablementAuditToMarkdown(result);

    expect(markdown).toContain('# Lingxing Download Center Page Model Enablement Audit');
    expect(markdown).toContain('Can disable manual verification: yes');
    expect(markdown).toContain('Only set `requiresManualVerification` to `false` after this audit says `yes`');
  });
});
