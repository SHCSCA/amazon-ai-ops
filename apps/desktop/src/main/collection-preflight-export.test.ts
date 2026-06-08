import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DownloadCenterCollectionPreflightResult } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { writeLingxingCollectionPreflightEvidenceBundle } from './collection-preflight-export';

let rootDir = '';
let screenshotsDir = '';
let domSnapshotsDir = '';

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-preflight-export-'));
  screenshotsDir = path.join(rootDir, 'screenshots');
  domSnapshotsDir = path.join(rootDir, 'dom-snapshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(domSnapshotsDir, { recursive: true });
});

afterEach(() => {
  if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('writeLingxingCollectionPreflightEvidenceBundle', () => {
  it('writes preflight, active model, diagnostic, and copied diagnostic evidence files', () => {
    const screenshotPath = path.join(screenshotsDir, 'diagnostic.png');
    const domSnapshotPath = path.join(domSnapshotsDir, 'diagnostic.html');
    fs.writeFileSync(screenshotPath, 'png');
    fs.writeFileSync(domSnapshotPath, '<html></html>');
    const exportDir = path.join(rootDir, 'export');

    const result = writeLingxingCollectionPreflightEvidenceBundle({
      exportDir,
      preflight: preflight({ diagnosticEvidenceReadiness: { ready: true, missing: [], diagnosticId: 12, checkedAt: '2026-06-03T00:00:00.000Z' } }),
      model: pageModel(),
      diagnostic: diagnostic({ screenshotPath, domSnapshotPath }),
      directories: { screenshotsDir, domSnapshotsDir },
    });

    expect(result.exportDir).toBe(exportDir);
    expect(fs.readdirSync(exportDir).sort()).toEqual([
      'active-page-model.json',
      'collection-preflight.json',
      'collection-preflight.md',
      'diagnostic-evidence-files.json',
      'diagnostic.json',
      'preflight-bundle-index.json',
      'preflight-diagnostic-dom-snapshot.html',
      'preflight-diagnostic-screenshot.png',
      'preflight-review-checklist.md',
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(exportDir, 'collection-preflight.json'), 'utf8'))).toMatchObject({
      ready: true,
      pageModel: 'lingxing-download-center',
    });
    expect(JSON.parse(fs.readFileSync(path.join(exportDir, 'active-page-model.json'), 'utf8'))).toMatchObject({
      name: 'lingxing-download-center',
    });
    expect(JSON.parse(fs.readFileSync(path.join(exportDir, 'diagnostic.json'), 'utf8'))).toMatchObject({
      id: 12,
      copiedScreenshotPath: path.join(exportDir, 'preflight-diagnostic-screenshot.png'),
      copiedDomSnapshotPath: path.join(exportDir, 'preflight-diagnostic-dom-snapshot.html'),
    });
    expect(JSON.parse(fs.readFileSync(path.join(exportDir, 'diagnostic-evidence-files.json'), 'utf8'))).toMatchObject({
      readiness: { ready: true, missing: [] },
    });
    expect(JSON.parse(fs.readFileSync(path.join(exportDir, 'preflight-bundle-index.json'), 'utf8'))).toMatchObject({
      ready: true,
      dateRange: { start: '2026-06-01', end: '2026-06-02' },
      pageModel: 'lingxing-download-center',
      requiresManualVerification: false,
      diagnosticId: 12,
      diagnosticEvidenceReady: true,
      blockedChecks: [],
      files: expect.arrayContaining([
        expect.objectContaining({ file: 'collection-preflight.json', required: true, present: true }),
        expect.objectContaining({ file: 'diagnostic.json', required: true, present: true }),
        expect.objectContaining({ file: 'preflight-diagnostic-screenshot.png', required: true, present: true }),
        expect.objectContaining({ file: 'preflight-diagnostic-dom-snapshot.html', required: true, present: true }),
        expect.objectContaining({ file: 'preflight-review-checklist.md', required: true, present: true }),
      ]),
    });
    expect(fs.readFileSync(path.join(exportDir, 'collection-preflight.md'), 'utf8')).toContain('# Lingxing Collection Preflight');
    const checklist = fs.readFileSync(path.join(exportDir, 'preflight-review-checklist.md'), 'utf8');
    expect(checklist).toContain('# Lingxing Collection Preflight Review Checklist');
    expect(checklist).toContain('Matching diagnostic: 12');
    expect(checklist).toContain('Diagnostic evidence files ready: yes');
    expect(checklist).toContain('- none');
  });

  it('writes a missing diagnostic evidence index without creating a diagnostic file', () => {
    const exportDir = path.join(rootDir, 'export-no-diagnostic');

    writeLingxingCollectionPreflightEvidenceBundle({
      exportDir,
      preflight: preflight({
        ready: false,
        diagnosticEvidenceReadiness: {
          ready: false,
          missing: ['diagnosticEvidence'],
          reason: 'no matching download-center diagnostic exists for this page model, date range, store, and marketplace',
        },
      }),
      model: pageModel(),
      directories: { screenshotsDir, domSnapshotsDir },
    });

    expect(fs.readdirSync(exportDir).sort()).toEqual([
      'active-page-model.json',
      'collection-preflight.json',
      'collection-preflight.md',
      'diagnostic-evidence-files.json',
      'preflight-bundle-index.json',
      'preflight-review-checklist.md',
    ]);
    expect(fs.existsSync(path.join(exportDir, 'diagnostic.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(exportDir, 'diagnostic-evidence-files.json'), 'utf8'))).toEqual({
      readiness: {
        ready: false,
        missing: ['diagnosticEvidence'],
        reason: 'no matching download-center diagnostic exists for this page model, date range, store, and marketplace',
      },
    });
    expect(JSON.parse(fs.readFileSync(path.join(exportDir, 'preflight-bundle-index.json'), 'utf8'))).toMatchObject({
      ready: false,
      diagnosticEvidenceReady: false,
      blockedChecks: [
        {
          name: 'diagnostic_evidence_ready',
          detail: 'no matching download-center diagnostic exists for this page model, date range, store, and marketplace',
          missing: ['diagnosticEvidence'],
        },
      ],
      files: expect.arrayContaining([
        expect.objectContaining({ file: 'diagnostic.json', required: false, present: false }),
        expect.objectContaining({ file: 'diagnostic-evidence-files.json', required: true, present: true }),
        expect.objectContaining({ file: 'preflight-review-checklist.md', required: true, present: true }),
      ]),
    });
    const checklist = fs.readFileSync(path.join(exportDir, 'preflight-review-checklist.md'), 'utf8');
    expect(checklist).toContain('Matching diagnostic: none');
    expect(checklist).toContain('- If no diagnostic is present, run `验证页面` for this exact model, date range, store, and marketplace before collection.');
    expect(checklist).toContain('diagnostic_evidence_ready: no matching download-center diagnostic exists for this page model, date range, store, and marketplace');
  });
});

function pageModel(): DownloadCenterPageModel {
  return {
    name: 'lingxing-download-center',
    description: 'test model',
    candidateUrls: ['https://erp.lingxing.com/download-center'],
    entryHints: ['下载中心'],
    reportNames: ['关键词报告'],
    verifySelectors: [],
    requiresManualVerification: false,
    actionSelectors: {
      dateStartInput: '#date-start',
      dateEndInput: '#date-end',
      createReportButton: '#create',
      readyReportSelector: '[data-report="{reportName}"][data-start="{dateStart}"][data-end="{dateEnd}"]',
      downloadButton: '[data-download="{reportName}"][data-start="{dateStart}"][data-end="{dateEnd}"]',
    },
  };
}

function diagnostic(overrides: Partial<DownloadCenterDiagnosticResult> = {}): DownloadCenterDiagnosticResult {
  return {
    id: 12,
    pageModel: 'lingxing-download-center',
    pageModelSnapshot: pageModel(),
    dateStart: '2026-06-01',
    dateEnd: '2026-06-02',
    url: 'https://erp.lingxing.com/download-center',
    title: 'Download Center',
    ready: true,
    requiresManualVerification: false,
    matchedEntryHints: ['下载中心'],
    matchedReportNames: ['关键词报告'],
    selectorChecks: [],
    missingRequiredSelectors: [],
    actionSelectorChecks: [],
    checkedAt: '2026-06-03T00:00:00.000Z',
    ...overrides,
  };
}

function preflight(overrides: Partial<DownloadCenterCollectionPreflightResult> = {}): DownloadCenterCollectionPreflightResult {
  const diagnosticEvidenceReadiness = overrides.diagnosticEvidenceReadiness ?? {
    ready: true,
    missing: [],
    diagnosticId: 12,
    checkedAt: '2026-06-03T00:00:00.000Z',
  };
  return {
    ready: true,
    generatedAt: '2026-06-03T00:01:00.000Z',
    dateRange: { start: '2026-06-01', end: '2026-06-02' },
    pageModel: 'lingxing-download-center',
    requiresManualVerification: false,
    automationReadiness: {
      ready: true,
      missing: [],
    },
    diagnosticEvidenceReadiness,
    checks: [
      {
        name: 'page_model_ready',
        status: 'passed',
        detail: 'download center page model can run selector-driven automation',
        missing: [],
      },
      {
        name: 'diagnostic_evidence_ready',
        status: diagnosticEvidenceReadiness.ready ? 'passed' : 'blocked',
        detail: diagnosticEvidenceReadiness.reason || 'diagnostic 12 is fresh and matches the active page model/date range/store/site scope',
        missing: diagnosticEvidenceReadiness.missing,
      },
    ],
    ...overrides,
  };
}
