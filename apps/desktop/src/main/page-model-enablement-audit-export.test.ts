import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DownloadCenterPageModelEnablementAuditResult } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { writeDownloadCenterPageModelEnablementAuditBundle } from './page-model-enablement-audit-export';

let rootDir = '';
let screenshotsDir = '';
let domSnapshotsDir = '';

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-enable-audit-'));
  screenshotsDir = path.join(rootDir, 'screenshots');
  domSnapshotsDir = path.join(rootDir, 'dom-snapshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  fs.mkdirSync(domSnapshotsDir, { recursive: true });
});

afterEach(() => {
  if (rootDir) fs.rmSync(rootDir, { recursive: true, force: true });
});

describe('writeDownloadCenterPageModelEnablementAuditBundle', () => {
  it('writes enablement audit files, diagnostic evidence copies, and a bundle index', () => {
    const screenshotPath = path.join(screenshotsDir, 'diagnostic.png');
    const domSnapshotPath = path.join(domSnapshotsDir, 'diagnostic.html');
    fs.writeFileSync(screenshotPath, 'png');
    fs.writeFileSync(domSnapshotPath, '<html></html>');
    const auditDir = path.join(rootDir, 'enablement-audit');

    writeDownloadCenterPageModelEnablementAuditBundle({
      auditDir,
      audit: enablementAudit(),
      model: pageModel(),
      diagnostic: diagnostic({ screenshotPath, domSnapshotPath }),
      directories: { screenshotsDir, domSnapshotsDir },
    });

    expect(fs.readdirSync(auditDir).sort()).toEqual([
      'active-page-model.json',
      'diagnostic-dom-snapshot.html',
      'diagnostic-evidence-files.json',
      'diagnostic-screenshot.png',
      'diagnostic.json',
      'enablement-audit.json',
      'enablement-audit.md',
      'enablement-bundle-index.json',
    ]);
    expect(JSON.parse(fs.readFileSync(path.join(auditDir, 'diagnostic.json'), 'utf8'))).toMatchObject({
      id: 7,
      copiedScreenshotPath: path.join(auditDir, 'diagnostic-screenshot.png'),
      copiedDomSnapshotPath: path.join(auditDir, 'diagnostic-dom-snapshot.html'),
    });
    expect(JSON.parse(fs.readFileSync(path.join(auditDir, 'enablement-bundle-index.json'), 'utf8'))).toMatchObject({
      canDisableManualVerification: true,
      pageModel: 'lingxing-download-center',
      diagnosticId: 7,
      diagnosticEvidenceReady: true,
      blockedChecks: [],
      files: expect.arrayContaining([
        expect.objectContaining({ file: 'enablement-audit.json', required: true, present: true }),
        expect.objectContaining({ file: 'diagnostic.json', required: true, present: true }),
        expect.objectContaining({ file: 'diagnostic-screenshot.png', required: true, present: true }),
        expect.objectContaining({ file: 'diagnostic-dom-snapshot.html', required: true, present: true }),
      ]),
    });
  });

  it('writes a blocked bundle index when no matching diagnostic exists', () => {
    const auditDir = path.join(rootDir, 'enablement-audit-no-diagnostic');

    writeDownloadCenterPageModelEnablementAuditBundle({
      auditDir,
      audit: enablementAudit({
        canDisableManualVerification: false,
        diagnosticEvidenceReadiness: {
          ready: false,
          missing: ['diagnosticEvidence'],
          reason: 'no matching download-center diagnostic exists for this page model, date range, store, and marketplace',
        },
        checks: [
          {
            name: 'automation_structure_ready',
            status: 'passed',
            detail: 'page model has complete scoped action selectors for unattended automation',
            missing: [],
          },
          {
            name: 'diagnostic_evidence_ready',
            status: 'blocked',
            detail: 'no matching download-center diagnostic exists for this page model, date range, store, and marketplace',
            missing: ['diagnosticEvidence'],
          },
        ],
      }),
      model: pageModel(),
      directories: { screenshotsDir, domSnapshotsDir },
    });

    expect(fs.readdirSync(auditDir).sort()).toEqual([
      'active-page-model.json',
      'diagnostic-evidence-files.json',
      'enablement-audit.json',
      'enablement-audit.md',
      'enablement-bundle-index.json',
    ]);
    expect(fs.existsSync(path.join(auditDir, 'diagnostic.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(auditDir, 'diagnostic-evidence-files.json'), 'utf8'))).toEqual({
      readiness: {
        ready: false,
        missing: ['diagnosticEvidence'],
        reason: 'no matching download-center diagnostic exists for this page model, date range, store, and marketplace',
      },
    });
    expect(JSON.parse(fs.readFileSync(path.join(auditDir, 'enablement-bundle-index.json'), 'utf8'))).toMatchObject({
      canDisableManualVerification: false,
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
      ]),
    });
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
    requiresManualVerification: true,
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
    id: 7,
    pageModel: 'lingxing-download-center',
    pageModelSnapshot: pageModel(),
    dateStart: '2026-06-01',
    dateEnd: '2026-06-02',
    url: 'https://erp.lingxing.com/download-center',
    title: 'Download Center',
    ready: true,
    requiresManualVerification: true,
    matchedEntryHints: ['下载中心'],
    matchedReportNames: ['关键词报告'],
    selectorChecks: [],
    missingRequiredSelectors: [],
    actionSelectorChecks: [],
    checkedAt: '2026-06-03T00:00:00.000Z',
    ...overrides,
  };
}

function enablementAudit(overrides: Partial<DownloadCenterPageModelEnablementAuditResult> = {}): DownloadCenterPageModelEnablementAuditResult {
  return {
    canDisableManualVerification: true,
    generatedAt: '2026-06-03T00:01:00.000Z',
    dateRange: { start: '2026-06-01', end: '2026-06-02' },
    pageModel: 'lingxing-download-center',
    currentlyRequiresManualVerification: true,
    automationReadiness: {
      ready: true,
      missing: [],
    },
    diagnosticEvidenceReadiness: {
      ready: true,
      missing: [],
      diagnosticId: 7,
      checkedAt: '2026-06-03T00:00:00.000Z',
    },
    checks: [
      {
        name: 'automation_structure_ready',
        status: 'passed',
        detail: 'page model has complete scoped action selectors for unattended automation',
        missing: [],
      },
      {
        name: 'diagnostic_evidence_ready',
        status: 'passed',
        detail: 'diagnostic 7 proves the saved page model/date/store/site setup selectors',
        missing: [],
      },
    ],
    ...overrides,
  };
}
