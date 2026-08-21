import fs from 'node:fs';
import path from 'node:path';
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
  it('supports both verified Lingxing report-name search controls behind the unique-visible selector gate', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const defaults = mainSource.slice(
      mainSource.indexOf('const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS'),
      mainSource.indexOf('const DOWNLOAD_CENTER_LIST_RECOVERY_INTERVAL_MS'),
    );

    expect(defaults).toContain([
      'input[placeholder="报告名称"].el-input__inner',
      'input#report_name[name="keyword"][placeholder="报告名称"].form-control',
    ].join(', '));
    expect(mainSource).toContain('matchCount = await countVisibleLocatorMatches(page, renderedSelector);');
    expect(mainSource).toContain('if (matchCount > 1)');

    const reader = mainSource.slice(
      mainSource.indexOf('function readDownloadCenterPageModel()'),
      mainSource.indexOf('function getBundledDownloadCenterPageModelPath()'),
    );
    expect(mainSource).toContain('function withTrustedDownloadCenterReportSearchSelector(');
    expect(reader).toContain('withTrustedDownloadCenterReportSearchSelector(');
    const rendererModelRead = mainSource.slice(
      mainSource.indexOf('function handleGetDownloadCenterPageModel()'),
      mainSource.indexOf('function handleSaveDownloadCenterPageModel('),
    );
    expect(rendererModelRead).toContain('withTrustedDownloadCenterReportSearchSelector(');
  });

  it('binds post-create verification to the exact generated name instead of the current list page', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const createReportSource = mainSource.slice(
      mainSource.indexOf('async createReport(report, dateRange)'),
      mainSource.indexOf('async waitForReportReady(report, dateRange, createdReportIdentity)'),
    );

    expect(mainSource).toContain('async function waitForCreatedReportRowByExactSearch(');
    expect(createReportSource).toContain('waitForCreatedReportRowByExactSearch(');
    expect(mainSource).toContain("await searchInput.fill(expectedReportName);");
    expect(mainSource).toContain("if ((await searchInput.inputValue()).trim() !== expectedReportName)");
  });

  it('explicitly submits the exact report-name query after filling the download-center search input', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');

    expect(mainSource).toContain('async function submitExactDownloadCenterReportSearch(');
    expect(mainSource).toContain("await searchInput.fill(expectedReportName);");
    expect(mainSource).toContain('button:has-text("查询")');
    expect(mainSource).toContain('await submitExactDownloadCenterReportSearch(');
    expect(mainSource).not.toContain("await searchInput.press('Enter').catch(() => undefined);");
  });

  it('clicks the unique visible create confirmation instead of the first stale hidden dialog button', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const createReportSource = mainSource.slice(
      mainSource.indexOf('async createReport(report, dateRange)'),
      mainSource.indexOf('async waitForReportReady(report, dateRange, createdReportIdentity)'),
    );

    expect(mainSource).toContain('async function clickUniqueVisibleLingxingCreateConfirmation(');
    expect(createReportSource).toContain('clickUniqueVisibleLingxingCreateConfirmation(page)');
    expect(createReportSource).not.toContain("page.locator('.layui-layer-btn0, button:has-text(\"确定\"), a:has-text(\"确定\")').first()");
    const confirmationHelper = mainSource.slice(
      mainSource.indexOf('async function clickUniqueVisibleLingxingCreateConfirmation('),
      mainSource.indexOf('async function readLingxingCreateSubmissionFeedback('),
    );
    expect(confirmationHelper).toContain('button:has-text("确定")');
    expect(confirmationHelper).toContain('button:has-text("确认")');
    expect(confirmationHelper).toContain('[role="dialog"]:visible');
  });

  it('preserves visible create-form rejection evidence before returning to the list', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const createReportSource = mainSource.slice(
      mainSource.indexOf('async createReport(report, dateRange)'),
      mainSource.indexOf('async waitForReportReady(report, dateRange, createdReportIdentity)'),
    );

    expect(mainSource).toContain('async function readLingxingCreateSubmissionFeedback(');
    expect(createReportSource).toContain('readLingxingCreateSubmissionFeedback(page, confirmationClicked)');
    expect(createReportSource).toContain('领星创建表单未提交：');
    expect(createReportSource).toContain('提交确认：');
  });

  it('reads back the selected report type and captures sanitized create responses', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const createReportSource = mainSource.slice(
      mainSource.indexOf('async createReport(report, dateRange)'),
      mainSource.indexOf('async waitForReportReady(report, dateRange, createdReportIdentity)'),
    );

    expect(mainSource).toContain('async function captureLingxingCreateSubmissionResponses(');
    expect(createReportSource).toContain("const selectedReportType = (await page.locator(reportTypeSelect).inputValue()).trim();");
    expect(createReportSource).toContain('selectedReportType !== report.displayName');
    expect(createReportSource).toContain('captureLingxingCreateSubmissionResponses(page, async () =>');
    expect(createReportSource).toContain('提交响应：');
  });

  it('verifies the configured store reached the selected transfer panel before creating', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const createReportSource = mainSource.slice(
      mainSource.indexOf('async createReport(report, dateRange)'),
      mainSource.indexOf('async waitForReportReady(report, dateRange, createdReportIdentity)'),
    );

    expect(mainSource).toContain('async function assertLingxingCreateStoreSelected(');
    expect(mainSource).toContain("const normalizedStoreName = normalizeLingxingCollectionStoreName(storeName);");
    expect(mainSource).toContain("const normalizedMarketplaceCode = normalizeLingxingCollectionStoreName(marketplaceCode);");
    expect(mainSource).toContain('`${normalizedStoreName}-${normalizedMarketplaceCode}`');
    expect(mainSource).toContain('expectedStoreNames.has(normalizedItemText)');
    expect(mainSource).not.toContain('jf-us-us');
    expect(mainSource).toContain("'.el-transfer-panel:visible'");
    expect(mainSource).toContain("items.nth(index).locator('.el-checkbox__label').first()");
    expect(mainSource).toContain('normalizedItemText === normalizedStoreName');
    expect(mainSource).toContain('const selectionDeadline = Date.now() + 5_000;');
    expect(mainSource).toContain('await page.waitForTimeout(200);');
    expect(createReportSource).toContain('await assertLingxingCreateStoreSelected(page, context.storeName, context.marketplaceCode);');
    expect(createReportSource.indexOf('await assertLingxingCreateStoreSelected(page, context.storeName, context.marketplaceCode);')).toBeLessThan(
      createReportSource.indexOf('captureLingxingCreateSubmissionResponses(page, async () =>'),
    );
    expect(createReportSource).toContain("status: 'not_created'");
    expect(createReportSource).toContain("blockerCode: 'LINGXING_CREATE_STORE_NOT_SELECTED'");
  });

  it('repairs only the trusted historical pre-submit store-selection failure without external reconciliation', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const reconcileSource = mainSource.slice(
      mainSource.indexOf('async function reconcileLingxingCreateUnknownCheckpoint('),
      mainSource.indexOf('async function handleResumeLingxingCollection(input: unknown)'),
    );

    expect(reconcileSource).toContain('const confirmedNeverSubmitted = Boolean(');
    expect(reconcileSource).toContain("checkpoint.errorCode === 'LINGXING_CREATE_CALL_INTERRUPTED'");
    expect(reconcileSource).toContain("checkpoint.detail?.includes('未提交创建。')");
    expect(reconcileSource).toContain("!checkpoint.detail?.includes('提交响应：')");
    expect(reconcileSource).toContain("confirmedNeverSubmitted ? { outcome: 'confirmed_absent' }");
  });

  it('keeps create-unknown reconciliation read-only until a separate continue action', () => {
    const mainSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
    const resumeHandler = mainSource.slice(
      mainSource.indexOf('async function handleResumeLingxingCollection(input: unknown)'),
      mainSource.indexOf('const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS'),
    );

    expect(resumeHandler).toContain('if (value.reconcileOnly === true)');
    expect(resumeHandler).toContain('alreadyComplete: false');
    expect(resumeHandler).toContain('reconciliationOnly: true');
  });

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
