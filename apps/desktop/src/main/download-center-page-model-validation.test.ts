import { describe, expect, it } from 'vitest';
import type { DownloadCenterActionSelectors, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import {
  selectorUsesDateScope,
  selectorUsesReportScope,
  validateDownloadCenterPageModel,
} from './download-center-page-model-validation';

function model(overrides: Partial<DownloadCenterPageModel> = {}): DownloadCenterPageModel {
  return {
    name: 'lingxing-download-center',
    description: 'test model',
    candidateUrls: ['https://erp.lingxing.com/download-center'],
    entryHints: ['下载中心'],
    reportNames: ['关键词报告'],
    verifySelectors: [{ name: 'table', selector: '.ant-table', required: false }],
    actionSelectors: {
      reportSearchInput: '',
      dateStartInput: '',
      dateEndInput: '',
      createReportButton: '',
      confirmCreateButton: '',
      readyReportSelector: '',
      statusTextSelector: '',
      downloadButton: '',
      readyTimeoutMs: 300000,
      downloadTimeoutMs: 120000,
    },
    requiresManualVerification: true,
    ...overrides,
  };
}

function verifiedSelectors(): DownloadCenterActionSelectors {
  return {
    reportSearchInput: '[data-testid="report-search"]',
    dateStartInput: '[data-testid="start"]',
    dateEndInput: '[data-testid="end"]',
    createReportButton: '[data-testid="create"]',
    confirmCreateButton: '[data-testid="confirm"]',
    readyReportSelector: 'tr[data-report="{reportName}"][data-date="{dateRange}"]',
    statusTextSelector: 'tr[data-report="{reportType}"][data-date="{dateStart}-{dateEnd}"] .status',
    downloadButton: 'tr[data-keyword="{expectedFilenameKeyword}"][data-date="{dateRange}"] button.download',
    readyTimeoutMs: 300000,
    downloadTimeoutMs: 120000,
  };
}

describe('validateDownloadCenterPageModel', () => {
  it('accepts the bundled-style model while manual verification remains enabled', () => {
    expect(() => validateDownloadCenterPageModel(model())).not.toThrow();
  });

  it('accepts a fully scoped selector model when manual verification is disabled', () => {
    expect(() => validateDownloadCenterPageModel(model({
      requiresManualVerification: false,
      actionSelectors: verifiedSelectors(),
    }))).not.toThrow();
  });

  it('rejects unverified models that do not include complete action selectors', () => {
    expect(() => validateDownloadCenterPageModel(model({
      requiresManualVerification: false,
      actionSelectors: { ...verifiedSelectors(), readyReportSelector: '' },
    }))).toThrow(/readyReportSelector/);
  });

  it('rejects report-row selectors that are not scoped by report and date placeholders', () => {
    expect(() => validateDownloadCenterPageModel(model({
      requiresManualVerification: false,
      actionSelectors: {
        ...verifiedSelectors(),
        downloadButton: 'tr.latest button.download',
      },
    }))).toThrow(/downloadButton.*占位符/);

    expect(() => validateDownloadCenterPageModel(model({
      requiresManualVerification: false,
      actionSelectors: {
        ...verifiedSelectors(),
        downloadButton: 'tr[data-report="{reportName}"] button.download',
      },
    }))).toThrow(/downloadButton.*dateStart/);
  });

  it('rejects non-HTTPS or non-allowlisted download-center URLs', () => {
    expect(() => validateDownloadCenterPageModel(model({
      candidateUrls: ['http://erp.lingxing.com/download-center'],
    }))).toThrow(/HTTPS/);

    expect(() => validateDownloadCenterPageModel(model({
      candidateUrls: ['https://evil.lingxing.com/download-center'],
    }))).toThrow(/领星域名/);
  });

  it('accepts the real Lingxing Ads download center host', () => {
    expect(() => validateDownloadCenterPageModel(model({
      candidateUrls: ['https://ads.lingxing.com/ak_download/download_center/download_report_log/index'],
    }))).not.toThrow();
  });

  it('rejects unsafe action selector timeouts', () => {
    expect(() => validateDownloadCenterPageModel(model({
      actionSelectors: { ...verifiedSelectors(), readyTimeoutMs: 999 },
    }))).toThrow(/readyTimeoutMs/);

    expect(() => validateDownloadCenterPageModel(model({
      actionSelectors: { ...verifiedSelectors(), readyTimeoutMs: 1800001 },
    }))).toThrow(/readyTimeoutMs/);

    expect(() => validateDownloadCenterPageModel(model({
      actionSelectors: { ...verifiedSelectors(), downloadTimeoutMs: 1500.5 },
    }))).toThrow(/downloadTimeoutMs/);

    expect(() => validateDownloadCenterPageModel(model({
      actionSelectors: { ...verifiedSelectors(), downloadTimeoutMs: 1800001 },
    }))).toThrow(/downloadTimeoutMs/);
  });

  it('exposes the same report/date placeholder helpers used by diagnostics', () => {
    expect(selectorUsesReportScope('[data-report="{reportName}"]')).toBe(true);
    expect(selectorUsesReportScope('[data-report="latest"]')).toBe(false);
    expect(selectorUsesDateScope('[data-date="{dateRange}"]')).toBe(true);
    expect(selectorUsesDateScope('[data-date="today"]')).toBe(false);
  });
});
