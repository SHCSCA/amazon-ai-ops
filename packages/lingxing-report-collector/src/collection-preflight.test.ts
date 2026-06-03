import { describe, expect, it } from 'vitest';
import type { DownloadCenterActionSelectorCheck, DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { assertDownloadCenterCollectionPreflightReady, buildDownloadCenterCollectionPreflight, downloadCenterCollectionPreflightToMarkdown, summarizeDownloadCenterCollectionPreflightBlockers } from './collection-preflight';

const dateRange = { start: '2026-05-01', end: '2026-05-31' };
const nowMs = Date.parse('2026-06-01T00:00:00.000Z');

function model(overrides: Partial<DownloadCenterPageModel> = {}): DownloadCenterPageModel {
  return {
    name: 'lingxing-download-center',
    description: 'verified model',
    candidateUrls: ['https://erp.lingxing.com/download-center'],
    entryHints: ['下载中心'],
    reportNames: ['关键词报告'],
    verifySelectors: [{ name: 'table', selector: '.ant-table', required: false }],
    actionSelectors: {
      reportSearchInput: '[data-testid="search"]',
      dateStartInput: '[data-testid="start"]',
      dateEndInput: '[data-testid="end"]',
      createReportButton: '[data-testid="create"]',
      readyReportSelector: 'tr[data-report="{reportName}"][data-date="{dateRange}"]',
      downloadButton: 'tr[data-report="{reportName}"][data-date="{dateRange}"] button.download',
    },
    requiresManualVerification: false,
    ...overrides,
  };
}

function check(name: DownloadCenterActionSelectorCheck['name'], selector: string): DownloadCenterActionSelectorCheck {
  return {
    name,
    selector,
    renderedSelector: selector,
    required: true,
    kind: name === 'createReportButton' ? 'click' : 'input',
    found: true,
    usable: true,
    ambiguous: false,
    matchCount: 1,
  };
}

function diagnostic(pageModel = model(), overrides: Partial<DownloadCenterDiagnosticResult> = {}): DownloadCenterDiagnosticResult {
  const selectors = pageModel.actionSelectors!;
  return {
    id: 42,
    pageModel: pageModel.name,
    pageModelSnapshot: pageModel,
    url: pageModel.candidateUrls[0],
    title: 'Download center',
    ready: true,
    requiresManualVerification: pageModel.requiresManualVerification,
    matchedEntryHints: ['下载中心'],
    matchedReportNames: ['关键词报告'],
    selectorChecks: [],
    missingRequiredSelectors: [],
    actionSelectorChecks: [
      check('reportSearchInput', selectors.reportSearchInput!),
      check('dateStartInput', selectors.dateStartInput!),
      check('dateEndInput', selectors.dateEndInput!),
      check('createReportButton', selectors.createReportButton),
    ],
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
    checkedAt: new Date(nowMs).toISOString(),
    ...overrides,
  };
}

describe('buildDownloadCenterCollectionPreflight', () => {
  it('passes only when page model readiness and matching diagnostic evidence both pass', () => {
    const activeModel = model();
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, diagnostic(activeModel), { nowMs });

    expect(result.ready).toBe(true);
    expect(result.checks.every((item) => item.status === 'passed')).toBe(true);
    expect(result.diagnosticEvidenceReadiness.diagnosticId).toBe(42);
  });

  it('blocks when the page model still requires manual verification', () => {
    const activeModel = model({ requiresManualVerification: true });
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, diagnostic(activeModel), { nowMs });

    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.name === 'page_model_ready')).toMatchObject({
      status: 'blocked',
      detail: 'download center page model still requires manual verification',
    });
  });

  it('blocks when matching diagnostic evidence is absent or stale', () => {
    const activeModel = model();
    const missing = buildDownloadCenterCollectionPreflight(activeModel, dateRange, undefined, { nowMs });
    const stale = buildDownloadCenterCollectionPreflight(activeModel, dateRange, diagnostic(activeModel, {
      checkedAt: '2026-05-31T23:00:00.000Z',
    }), { nowMs });

    expect(missing.ready).toBe(false);
    expect(missing.diagnosticEvidenceReadiness.missing).toEqual(['diagnosticEvidence']);
    expect(stale.ready).toBe(false);
    expect(stale.diagnosticEvidenceReadiness.missing).toEqual(['diagnosticFreshness']);
  });

  it('blocks when diagnostic evidence was generated for a different page model snapshot', () => {
    const activeModel = model();
    const oldModel = model({
      actionSelectors: {
        ...activeModel.actionSelectors!,
        createReportButton: '[data-testid="old-create"]',
      },
    });
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, diagnostic(oldModel), { nowMs });

    expect(result.ready).toBe(false);
    expect(result.diagnosticEvidenceReadiness.missing).toEqual(['diagnosticModelSnapshot']);
  });

  it('can include browser session readiness as an explicit preflight gate', () => {
    const activeModel = model();
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, diagnostic(activeModel), {
      nowMs,
      browserSessionReady: false,
      browserSessionReason: 'not logged in',
    });

    expect(result.ready).toBe(false);
    expect(result.checks.find((item) => item.name === 'browser_session_ready')).toMatchObject({
      status: 'blocked',
      missing: ['browserSession'],
      detail: 'not logged in',
    });
  });

  it('renders a markdown evidence summary', () => {
    const activeModel = model();
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, diagnostic(activeModel), {
      nowMs,
      browserSessionReady: true,
    });
    const markdown = downloadCenterCollectionPreflightToMarkdown(result);

    expect(markdown).toContain('# Lingxing Collection Preflight');
    expect(markdown).toContain('Ready: yes');
    expect(markdown).toContain('| browser_session_ready | passed | none | Lingxing browser session is ready |');
  });

  it('summarizes blockers for collection start errors', () => {
    const activeModel = model({ requiresManualVerification: true });
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, undefined, {
      nowMs,
      browserSessionReady: false,
      browserSessionReason: 'not logged in',
    });

    expect(summarizeDownloadCenterCollectionPreflightBlockers(result)).toContain('page_model_ready: download center page model still requires manual verification');
    expect(summarizeDownloadCenterCollectionPreflightBlockers(result)).toContain('diagnostic_evidence_ready: no matching download-center diagnostic exists');
    expect(summarizeDownloadCenterCollectionPreflightBlockers(result)).toContain('browser_session_ready: not logged in missing: browserSession');
  });

  it('summarizes a passed preflight without blockers', () => {
    const activeModel = model();
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, diagnostic(activeModel), {
      nowMs,
      browserSessionReady: true,
    });

    expect(summarizeDownloadCenterCollectionPreflightBlockers(result)).toBe('collection preflight passed');
  });

  it('throws a batch-preserving error when collection start is blocked', () => {
    const activeModel = model({ requiresManualVerification: true });
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, undefined, {
      nowMs,
      browserSessionReady: false,
      browserSessionReason: 'not logged in',
    });

    expect(() => assertDownloadCenterCollectionPreflightReady(result)).toThrow(
      /领星采集预检未通过，未创建采集批次：page_model_ready:/,
    );
  });

  it('does not throw when collection preflight is ready', () => {
    const activeModel = model();
    const result = buildDownloadCenterCollectionPreflight(activeModel, dateRange, diagnostic(activeModel), {
      nowMs,
      browserSessionReady: true,
    });

    expect(() => assertDownloadCenterCollectionPreflightReady(result)).not.toThrow();
  });
});
