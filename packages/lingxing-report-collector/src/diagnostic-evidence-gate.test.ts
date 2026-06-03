import { describe, expect, it } from 'vitest';
import type { DownloadCenterActionSelectorCheck, DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { evaluateDownloadCenterDiagnosticEvidenceReadiness } from './diagnostic-evidence-gate';

const checkedAt = '2026-06-01T05:00:00.000Z';
const nowMs = new Date(checkedAt).getTime() + 60_000;

function model(overrides: Partial<DownloadCenterPageModel> = {}): DownloadCenterPageModel {
  return {
    name: 'lingxing-download-center',
    description: 'download center',
    candidateUrls: ['https://erp.lingxing.com/download-center'],
    entryHints: ['下载中心'],
    reportNames: ['关键词报告'],
    verifySelectors: [{ name: 'body', selector: 'body', required: true }],
    requiresManualVerification: false,
    actionSelectors: {
      dateStartInput: '#start',
      dateEndInput: '#end',
      createReportButton: '#create',
      readyReportSelector: 'tr:has-text("{reportName}"):has-text("{dateRange}")',
      downloadButton: 'tr:has-text("{reportName}"):has-text("{dateRange}") .download',
      confirmCreateButton: '.modal .confirm',
    },
    ...overrides,
  };
}

function check(name: string, usable = true): DownloadCenterActionSelectorCheck {
  return {
    name,
    selector: name === 'dateStartInput' ? '#start' : name === 'dateEndInput' ? '#end' : name === 'createReportButton' ? '#create' : `#${name}`,
    renderedSelector: name === 'dateStartInput' ? '#start' : name === 'dateEndInput' ? '#end' : name === 'createReportButton' ? '#create' : `#${name}`,
    required: true,
    kind: name.includes('Input') ? 'input' : 'click',
    matchCount: usable ? 1 : 0,
    found: usable,
    usable,
    ambiguous: false,
  };
}

function diagnostic(pageModel: DownloadCenterPageModel, overrides: Partial<DownloadCenterDiagnosticResult> = {}): DownloadCenterDiagnosticResult {
  return {
    id: 42,
    pageModel: pageModel.name,
    pageModelSnapshot: pageModel,
    dateStart: '2026-05-01',
    dateEnd: '2026-05-31',
    url: pageModel.candidateUrls[0],
    title: '下载中心',
    ready: true,
    requiresManualVerification: false,
    matchedEntryHints: ['下载中心'],
    matchedReportNames: ['关键词报告'],
    selectorChecks: [{ name: 'body', selector: 'body', required: true, found: true }],
    missingRequiredSelectors: [],
    actionSelectorChecks: [
      check('dateStartInput'),
      check('dateEndInput'),
      check('createReportButton'),
    ],
    checkedAt,
    ...overrides,
  };
}

describe('evaluateDownloadCenterDiagnosticEvidenceReadiness', () => {
  it('fails closed when diagnostic evidence is missing or not ready', () => {
    const activeModel = model();

    expect(evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      undefined,
      { nowMs },
    ).missing).toEqual(['diagnosticEvidence']);

    expect(evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel, { ready: false }),
      { nowMs },
    ).missing).toEqual(['diagnosticReady']);
  });

  it('allows setup evidence without pre-existing ready/download rows', () => {
    const activeModel = model();
    const result = evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel),
      { nowMs },
    );

    expect(result).toMatchObject({ ready: true, missing: [] });
  });

  it('does not require confirmCreateButton evidence before the create click opens a dialog', () => {
    const activeModel = model();
    const result = evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel),
      { nowMs },
    );

    expect(result.missing).not.toContain('confirmCreateButton:evidence');
  });

  it('requires reportSearchInput evidence when configured because it is visible before create', () => {
    const activeModel = model({
      actionSelectors: {
        ...model().actionSelectors!,
        reportSearchInput: '#report-search',
      },
    });
    const result = evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel),
      { nowMs },
    );

    expect(result).toMatchObject({
      ready: false,
      missing: ['reportSearchInput:evidence'],
    });
  });

  it('rejects stale diagnostics', () => {
    const activeModel = model();
    const result = evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel),
      { nowMs: nowMs + 31 * 60 * 1000 },
    );

    expect(result).toMatchObject({
      ready: false,
      missing: ['diagnosticFreshness'],
    });
  });

  it('rejects invalid or future diagnostic timestamps', () => {
    const activeModel = model();

    expect(evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel, { checkedAt: 'not-a-date' }),
      { nowMs },
    ).missing).toEqual(['diagnosticFreshness']);

    expect(evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel, { checkedAt: new Date(nowMs + 120_000).toISOString() }),
      { nowMs },
    ).missing).toEqual(['diagnosticFreshness']);
  });

  it('rejects diagnostics from another model snapshot or date range', () => {
    const activeModel = model();
    const changedModel = model({ description: 'changed' });

    expect(evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(changedModel),
      { nowMs },
    ).missing).toEqual(['diagnosticModelSnapshot']);

    expect(evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-06-01', end: '2026-06-30' },
      diagnostic(activeModel),
      { nowMs },
    ).missing).toEqual(['diagnosticDateRange']);
  });

  it('fails closed when setup selector checks are malformed even if usable is true', () => {
    const activeModel = model();
    const result = evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel, {
        actionSelectorChecks: [
          { name: 'dateStartInput', usable: true } as any,
          { name: 'dateEndInput', usable: true } as any,
          { name: 'createReportButton', usable: true } as any,
        ],
      }),
      { nowMs },
    );

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual([
      'dateStartInput:global:selectorMismatch',
      'dateEndInput:global:selectorMismatch',
      'createReportButton:global:selectorMismatch',
    ]);
  });

  it('fails closed when setup selector checks are not usable or ambiguous', () => {
    const activeModel = model();
    const result = evaluateDownloadCenterDiagnosticEvidenceReadiness(
      activeModel,
      { start: '2026-05-01', end: '2026-05-31' },
      diagnostic(activeModel, {
        actionSelectorChecks: [
          check('dateStartInput'),
          check('dateEndInput'),
          { ...check('createReportButton'), ambiguous: true, matchCount: 2 },
        ],
      }),
      { nowMs },
    );

    expect(result.ready).toBe(false);
    expect(result.missing).toEqual(['createReportButton:global:ambiguous']);
  });
});
