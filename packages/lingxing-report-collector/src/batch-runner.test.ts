import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type LingxingCreateReportOutcome,
  type LingxingReportDefinition,
} from '@amazon-ai-ops/shared-types';
import {
  downloadExistingLingxingReportBatch,
  runLingxingReportBatch,
  type LingxingInPlaceResumeState,
  type RunBatchOptions,
} from './batch-runner';

const TEST_STORE_CONTEXT = normalizeStoreContextEnvelope({
  storeId: 'shc001',
  browserProfileId: 'profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-05-25',
  sessionGeneration: 7,
});

let requestSequence = 0;

const REPORT_DIMENSION_HEADER: Record<LingxingReportDefinition['type'], string> = {
  campaign: '广告活动',
  ad_group: '广告组',
  placement: '广告位',
  advertised_product: '推广的商品',
  auto_targeting: '自动投放',
  keyword: '关键词',
  product_targeting: '商品投放',
  user_search_term: '用户搜索词',
};

function writeSemanticReportFixture(filePath: string, report: LingxingReportDefinition): void {
  const headers = ['日期', '广告活动'];
  if (report.type !== 'campaign') headers.push('广告组');
  if (!['campaign', 'ad_group'].includes(report.type)) {
    headers.push(REPORT_DIMENSION_HEADER[report.type]);
  }
  headers.push('展现量', '点击量', '花费', '订单', '销售额');
  const worksheet = XLSX.utils.aoa_to_sheet([headers]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
  XLSX.writeFile(workbook, filePath);
}

function createdOutcome(
  report: LingxingReportDefinition,
  dateRange: { start: string; end: string },
): LingxingCreateReportOutcome {
  return {
    status: 'created',
    identity: {
      provider: 'lingxing',
      reportType: report.type,
      externalReportName: `${report.type}-${dateRange.start}-${dateRange.end}`,
      externalReportId: `external-${report.type}`,
      dateStart: dateRange.start,
      dateEnd: dateRange.end,
      createdAt: '2026-05-25T12:00:00.000Z',
    },
  };
}

function testAuthority() {
  requestSequence += 1;
  return {
    requestId: `collector-test-${requestSequence}`,
    storeContext: TEST_STORE_CONTEXT,
    storeDisplayName: 'SHC001 · 美国站',
    async progressSink() {
      return;
    },
    authorityGuard() {
      return { allowed: true } as const;
    },
    cancellationGuard() {
      return { allowed: true } as const;
    },
  };
}

type LegacyTestOptions = Omit<RunBatchOptions,
  | 'requestId'
  | 'storeContext'
  | 'storeDisplayName'
  | 'progressSink'
  | 'authorityGuard'
  | 'cancellationGuard'
  | 'automation'
> & {
  automation: Omit<RunBatchOptions['automation'], 'createReport'> & {
    createReport: (...args: Parameters<RunBatchOptions['automation']['createReport']>) => Promise<unknown>;
  };
  storeName?: string;
  marketplaceCode?: string;
};

function normalizeLegacyTestOptions(options: LegacyTestOptions): RunBatchOptions {
  const automation = options.automation;
  return {
    ...testAuthority(),
    ...options,
    automation: {
      ...automation,
      async createReport(report, dateRange) {
        const outcome = await automation.createReport(report, dateRange);
        return (outcome ?? createdOutcome(report, dateRange)) as LingxingCreateReportOutcome;
      },
    },
  };
}

function runTestBatch(options: LegacyTestOptions) {
  return runLingxingReportBatch(normalizeLegacyTestOptions(options));
}

function downloadExistingTestBatch(options: LegacyTestOptions) {
  return downloadExistingLingxingReportBatch(normalizeLegacyTestOptions(options));
}

async function createThreeOfEightResumeFixture() {
  const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-in-place-source-'));
  const source = await runTestBatch({
    dateStart: '2026-05-01',
    dateEnd: '2026-05-25',
    rootDownloadDir,
    automation: {
      async navigateToDownloadCenter() {},
      async createReport() {},
      async waitForReportReady() {},
      async downloadReport(report, downloadDir) {
        fs.mkdirSync(downloadDir, { recursive: true });
        const filePath = path.join(
          downloadDir,
          `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_report.xlsx`,
        );
        writeSemanticReportFixture(filePath, report);
        return filePath;
      },
    },
  });
  const failedAt = new Date(Date.parse(source.job.updatedAt) + 1).toISOString();
  const reports = source.job.reports.map((checkpoint, index) => index < 3
    ? checkpoint
    : {
        reportType: checkpoint.reportType,
        state: 'failed' as const,
        attemptIndex: 0,
        autoRetryCount: 0,
        errorCode: 'LINGXING_COLLECTION_STEP_FAILED',
        detail: 'safe pre-create failure',
        updatedAt: failedAt,
      });
  const job = {
    ...source.job,
    state: 'failed' as const,
    reports,
    blockerCode: 'LINGXING_COLLECTION_STEP_FAILED',
    detail: 'resume fixture',
    completedAt: failedAt,
    updatedAt: failedAt,
  };
  const batch = {
    ...source.batch,
    status: 'failed' as const,
    completedAt: failedAt,
  };
  const resumeFrom: LingxingInPlaceResumeState = {
    jobId: job.jobId,
    request: job.request,
    reports,
    job,
    batch,
    files: source.files.slice(0, 3),
  };
  return { rootDownloadDir, source, resumeFrom };
}

describe('runLingxingReportBatch', () => {
  it('records all report files and writes a manifest', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-'));
    const calls: string[] = [];

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      rootDownloadDir,
      appVersion: '1.5.0-test',
      automation: {
        async navigateToDownloadCenter() {
          calls.push('navigate');
        },
        async createReport(report: LingxingReportDefinition) {
          calls.push(`create:${report.type}`);
        },
        async waitForReportReady(report: LingxingReportDefinition) {
          calls.push(`ready:${report.type}`);
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_report.xlsx`);
          writeSemanticReportFixture(filePath, report);
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('completed');
    expect(result.batch.manifestPath).toBeTruthy();
    expect(fs.existsSync(result.batch.manifestPath!)).toBe(true);
    expect(result.files).toHaveLength(8);
    expect(result.files.every((file) => file.status === 'downloaded')).toBe(true);
    expect(result.files.every((file) => file.filePath && fs.existsSync(file.filePath))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(result.batch.manifestPath!, 'utf8'));
    expect(manifest.appVersion).toBe('1.5.0-test');
    expect(manifest.batch.id).toBe(result.batch.id);
    expect(manifest.batch.storeId).toBe('shc001');
    expect(manifest.batch.storeName).toBe('SHC001 · 美国站');
    expect(manifest.batch.browserProfileId).toBe('profile-shc001');
    expect(manifest.batch.businessDate).toBe('2026-05-25');
    expect(manifest.batch.sessionGeneration).toBe(7);
    expect(manifest.batch.marketplaceCode).toBe('US');
    expect(manifest.job.request.storeContext.currency).toBe('USD');
    expect(manifest.files).toHaveLength(8);
    expect(calls.filter((call) => call === 'navigate')).toHaveLength(8);
  });

  it('can run a single selected report type for retry batches', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-retry-'));
    const createdReports: string[] = [];

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      appVersion: '1.5.0-test',
      reportTypes: ['keyword'],
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport(report: LingxingReportDefinition) {
          createdReports.push(report.type);
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_retry.xlsx`);
          writeSemanticReportFixture(filePath, report);
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('completed');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].reportType).toBe('keyword');
    expect(result.files[0].status).toBe('downloaded');
    expect(createdReports).toEqual(['keyword']);

    const manifest = JSON.parse(fs.readFileSync(result.batch.manifestPath!, 'utf8'));
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].reportType).toBe('keyword');
  });

  it('downloads already-created report rows without creating new reports', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-existing-'));
    const calls: string[] = [];

    const result = await downloadExistingTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      storeName: 'FT-US-US',
      marketplaceCode: 'US',
      rootDownloadDir,
      appVersion: '1.5.0-test',
      reportTypes: ['keyword'],
      automation: {
        async navigateToDownloadCenter() {
          calls.push('navigate');
        },
        async createReport(report: LingxingReportDefinition) {
          calls.push(`create:${report.type}`);
          throw new Error('download existing must not create reports');
        },
        async waitForReportReady(report: LingxingReportDefinition) {
          calls.push(`ready:${report.type}`);
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          calls.push(`download:${report.type}`);
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_existing.xlsx`);
          writeSemanticReportFixture(filePath, report);
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('completed');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      reportType: 'keyword',
      status: 'downloaded',
    });
    expect(calls).toEqual(['navigate', 'ready:keyword', 'download:keyword']);
  });

  it('records a failed single-report retry batch with the file error', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-retry-failed-'));

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return {
            status: 'not_created' as const,
            retryable: true,
            detail: 'download center model is not verified',
          };
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport() {
          throw new Error('should not download after create failure');
        },
      },
    });

    expect(result.batch.status).toBe('failed');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].reportType).toBe('keyword');
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].errorMessage).toBe('download center model is not verified');
    expect(result.files[0].autoRetryCount).toBe(2);
    expect(result.files[0].maxAutoRetries).toBe(2);
    expect(result.files[0].attemptErrors).toHaveLength(3);
  });

  it('automatically retries a failed report before marking it downloaded', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-auto-retry-'));
    let createAttempts = 0;

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          createAttempts += 1;
          if (createAttempts < 3) {
            return {
              status: 'not_created' as const,
              retryable: true,
              detail: `temporary create failure ${createAttempts}`,
            };
          }
          return undefined;
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_after_retry.xlsx`);
          writeSemanticReportFixture(filePath, report);
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('completed');
    expect(createAttempts).toBe(3);
    expect(result.files[0].status).toBe('downloaded');
    expect(result.files[0].autoRetryCount).toBe(2);
    expect(result.files[0].maxAutoRetries).toBe(2);
    expect(result.files[0].attemptErrors).toEqual(['temporary create failure 1', 'temporary create failure 2']);
  });

  it('marks a multi-report batch completed_with_errors when only some reports fail', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-partial-failure-'));

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['campaign', 'keyword'],
      maxRetries: 0,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport(report: LingxingReportDefinition) {
          if (report.type === 'keyword') {
            return {
              status: 'not_created' as const,
              retryable: false,
              detail: 'keyword report create failed',
            };
          }
          return undefined;
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_partial.xlsx`);
          writeSemanticReportFixture(filePath, report);
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('completed_with_errors');
    expect(result.files.map((file) => file.status)).toEqual(['downloaded', 'failed']);
    expect(result.files[1].errorMessage).toBe('keyword report create failed');

    const manifest = JSON.parse(fs.readFileSync(result.batch.manifestPath!, 'utf8'));
    expect(manifest.batch.status).toBe('completed_with_errors');
    expect(manifest.files.map((file: { status: string }) => file.status)).toEqual(['downloaded', 'failed']);
  });

  it('fails a downloaded report whose filename does not contain the requested date range', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-wrong-date-'));

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      maxRetries: 0,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return;
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-04-01_2026-04-25.xlsx`);
          fs.writeFileSync(filePath, 'x'.repeat(256), 'utf8');
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('failed');
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].fileSizeBytes).toBe(256);
    expect(result.files[0].errorMessage).toContain('文件名未包含采集日期范围');
  });

  it('accepts a localized filename when the workbook headers identify the requested report type', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-localized-name-'));

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      maxRetries: 0,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return;
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(_report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, '领星广告数据_2026-05-01_2026-05-25.csv');
          fs.writeFileSync(
            filePath,
            [
              '日期,广告活动,广告组,关键词,匹配方式,展现量,点击量,花费,订单,销售额',
              '2026-05-01,Campaign,Ad Group,smart lock,exact,100,10,12.5,1,30',
              '2026-05-02,Campaign,Ad Group,keyless entry,phrase,100,10,12.5,1,30',
              '2026-05-03,Campaign,Ad Group,keypad lock,broad,100,10,12.5,1,30',
            ].join('\n'),
            'utf8',
          );
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('completed');
    expect(result.files[0].status).toBe('downloaded');
    expect(path.basename(result.files[0].filePath!)).toBe('领星广告数据_2026-05-01_2026-05-25.csv');
  });

  it('rejects a localized filename when headers identify a different report type', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-wrong-localized-name-'));

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      maxRetries: 0,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return;
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(_report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, '领星广告数据_2026-05-01_2026-05-25.csv');
          fs.writeFileSync(
            filePath,
            [
              '日期,广告活动,广告组,用户搜索词,展现量,点击量,花费,订单,销售额',
              '2026-05-01,Campaign,Ad Group,smart lock,100,10,12.5,1,30',
              '2026-05-02,Campaign,Ad Group,keyless entry,100,10,12.5,1,30',
              '2026-05-03,Campaign,Ad Group,keypad lock,100,10,12.5,1,30',
            ].join('\n'),
            'utf8',
          );
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('failed');
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].errorMessage).toContain('文件内容表头也无法识别为对应报表');
  });

  it('fails a downloaded report when the returned file is only audit evidence', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-evidence-like-file-'));

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      maxRetries: 0,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return;
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `audit_${report.expectedFilenameKeyword}_2026-05-01_2026-05-25.xlsx`);
          fs.writeFileSync(filePath, 'x'.repeat(256), 'utf8');
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('failed');
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].fileSizeBytes).toBe(256);
    expect(result.files[0].errorMessage).toContain('不是领星广告数据表格');
  });

  it('fails a downloaded report when the returned file is outside the batch download directory', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-outside-file-'));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-outside-download-'));

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      maxRetries: 0,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return;
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition) {
          const filePath = path.join(outsideDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25.xlsx`);
          fs.writeFileSync(filePath, 'x'.repeat(256), 'utf8');
          return filePath;
        },
      },
    });

    expect(result.batch.status).toBe('failed');
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].fileSizeBytes).toBe(256);
    expect(result.files[0].errorMessage).toContain('不在当前批次下载目录内');
  });

  it('rejects invalid collection dates before accepting a filename date match', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-invalid-date-'));

    await expect(runTestBatch({
      dateStart: '',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      maxRetries: 0,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return;
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-25.xlsx`);
          fs.writeFileSync(filePath, 'x'.repeat(256), 'utf8');
          return filePath;
        },
      },
    })).rejects.toThrow('dateStart and dateEnd');
  });

  it('captures failure evidence when automatic retries are exhausted', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-evidence-'));
    const screenshotPath = path.join(rootDownloadDir, 'failure.png');
    const domSnapshotPath = path.join(rootDownloadDir, 'failure.html');
    const tracePath = path.join(rootDownloadDir, 'failure-trace.json');

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      maxRetries: 1,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return {
            status: 'not_created' as const,
            retryable: true,
            detail: 'persistent create failure',
          };
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport() {
          throw new Error('should not download after create failure');
        },
        async captureFailureEvidence(_report, _dateRange, attemptErrors) {
          expect(attemptErrors).toEqual(['persistent create failure', 'persistent create failure']);
          return { screenshotPath, domSnapshotPath, tracePath };
        },
      },
    });

    expect(result.batch.status).toBe('failed');
    expect(result.files[0].autoRetryCount).toBe(1);
    expect(result.files[0].maxAutoRetries).toBe(1);
    expect(result.files[0].failureScreenshotPath).toBe(screenshotPath);
    expect(result.files[0].failureDomSnapshotPath).toBe(domSnapshotPath);
    expect(result.files[0].failureTracePath).toBe(tracePath);

    const manifest = JSON.parse(fs.readFileSync(result.batch.manifestPath!, 'utf8'));
    expect(manifest.files[0].failureScreenshotPath).toBe(screenshotPath);
    expect(manifest.files[0].failureDomSnapshotPath).toBe(domSnapshotPath);
    expect(manifest.files[0].failureTracePath).toBe(tracePath);
  });

  it('starts and retains a trace for the final failed attempt only', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-trace-'));
    const tracePath = path.join(rootDownloadDir, 'final-attempt.zip');
    const traceEvents: string[] = [];

    const result = await runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      maxRetries: 2,
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          return {
            status: 'not_created' as const,
            retryable: true,
            detail: 'still failing',
          };
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport() {
          throw new Error('should not download after create failure');
        },
        async startAttemptTrace(_report, _dateRange, attemptIndex) {
          traceEvents.push(`start:${attemptIndex}`);
        },
        async stopAttemptTrace(_report, _dateRange, attemptIndex, retain) {
          traceEvents.push(`stop:${attemptIndex}:${retain}`);
          return retain ? tracePath : undefined;
        },
        async captureFailureEvidence() {
          return {};
        },
      },
    });

    expect(traceEvents).toEqual(['start:2', 'stop:2:true']);
    expect(result.files[0].failureTracePath).toBe(tracePath);
  });

  it('rejects empty or unknown selected report types', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-invalid-'));
    const automation = {
      async navigateToDownloadCenter() {
        return;
      },
      async createReport() {
        return;
      },
      async waitForReportReady() {
        return;
      },
      async downloadReport() {
        return path.join(rootDownloadDir, 'unused.xlsx');
      },
    };

    await expect(runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: [],
      automation,
    })).rejects.toThrow('reportTypes must be omitted');

    await expect(runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['unknown' as any],
      automation,
    })).rejects.toThrow('Unknown Lingxing report type');

    await expect(runTestBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      maxRetries: -1,
      automation,
    })).rejects.toThrow('maxRetries');
  });

  it('resumes the same full-eight job in place and performs zero browser work for three verified files', async () => {
    const { rootDownloadDir, resumeFrom } = await createThreeOfEightResumeFixture();
    const calls: string[] = [];
    const guardGenerations: number[] = [];
    const progressIds: string[] = [];
    const executionStoreContext = normalizeStoreContextEnvelope({
      ...resumeFrom.request.storeContext,
      sessionGeneration: resumeFrom.request.storeContext.sessionGeneration + 1,
    });
    const result = await runLingxingReportBatch({
      requestId: resumeFrom.request.requestId,
      storeContext: resumeFrom.request.storeContext,
      executionStoreContext,
      progressEventNamespace: 'attempt-in-place-1',
      storeDisplayName: resumeFrom.batch.storeName ?? 'SHC001 · 美国站',
      dateStart: resumeFrom.request.dateStart,
      dateEnd: resumeFrom.request.dateEnd,
      rootDownloadDir,
      reportTypes: resumeFrom.request.reportTypes,
      resumeFrom,
      async progressSink(event) {
        progressIds.push(event.eventId);
      },
      authorityGuard(context) {
        guardGenerations.push(context.storeContext.sessionGeneration);
        return { allowed: true } as const;
      },
      cancellationGuard() {
        return { allowed: true } as const;
      },
      automation: {
        async navigateToDownloadCenter() {
          calls.push('navigate');
        },
        async createReport(report, dateRange) {
          calls.push(`create:${report.type}`);
          return createdOutcome(report, dateRange);
        },
        async waitForReportReady(report) {
          calls.push(`ready:${report.type}`);
        },
        async downloadReport(report, downloadDir) {
          calls.push(`download:${report.type}`);
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(
            downloadDir,
            `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_resumed.xlsx`,
          );
          writeSemanticReportFixture(filePath, report);
          return filePath;
        },
      },
    });

    expect(result.job.jobId).toBe(resumeFrom.jobId);
    expect(result.job.request.requestId).toBe(resumeFrom.request.requestId);
    expect(result.job.request.storeContext.sessionGeneration)
      .toBe(resumeFrom.request.storeContext.sessionGeneration);
    expect(result.batch.id).toBe(resumeFrom.batch.id);
    expect(result.batch.createdAt).toBe(resumeFrom.batch.createdAt);
    expect(result.batch.downloadDir).toBe(resumeFrom.batch.downloadDir);
    expect(result.files).toHaveLength(8);
    expect(result.files.every((file) => file.status === 'downloaded')).toBe(true);
    expect(result.files.slice(0, 3).map((file) => file.id))
      .toEqual(resumeFrom.files.map((file) => file.id));
    expect(calls.filter((call) => call === 'navigate')).toHaveLength(5);
    expect(calls.filter((call) => call.startsWith('create:'))).toHaveLength(5);
    expect(calls.filter((call) => call.startsWith('download:'))).toHaveLength(5);
    expect(guardGenerations.length).toBeGreaterThan(0);
    expect(new Set(guardGenerations)).toEqual(new Set([executionStoreContext.sessionGeneration]));
    expect(progressIds.every((eventId) => eventId.startsWith('attempt-in-place-1:'))).toBe(true);
  });

  it('honors a durable attemptIndex 3 without a retry downgrade and preserves prior failure evidence', async () => {
    const { rootDownloadDir, resumeFrom } = await createThreeOfEightResumeFixture();
    const target = resumeFrom.reports[3];
    const priorEvidence = {
      failureScreenshotPath: path.join(resumeFrom.batch.downloadDir, 'prior-failure.png'),
      failureDomSnapshotPath: path.join(resumeFrom.batch.downloadDir, 'prior-failure.html'),
      failureTracePath: path.join(resumeFrom.batch.downloadDir, 'prior-failure.zip'),
      traceUnavailableReason: 'prior trace note',
    };
    const resumeWithAttemptThree: LingxingInPlaceResumeState = {
      ...resumeFrom,
      reports: resumeFrom.reports.map((checkpoint, index) => index === 3
        ? { ...checkpoint, attemptIndex: 3, autoRetryCount: 3 }
        : checkpoint),
      files: [
        ...resumeFrom.files,
        {
          id: `${resumeFrom.jobId}-${target.reportType}-durable`,
          batchId: resumeFrom.jobId,
          reportType: target.reportType,
          displayName: `${target.reportType}.xlsx`,
          status: 'failed',
          maxAutoRetries: 5,
          autoRetryCount: 3,
          attemptErrors: ['prior durable failure'],
          ...priorEvidence,
          createdAt: resumeFrom.batch.createdAt,
          updatedAt: target.updatedAt,
        },
      ],
    };
    const calls: string[] = [];
    const result = await runLingxingReportBatch({
      requestId: resumeWithAttemptThree.request.requestId,
      storeContext: resumeWithAttemptThree.request.storeContext,
      executionStoreContext: resumeWithAttemptThree.request.storeContext,
      progressEventNamespace: 'attempt-index-three',
      storeDisplayName: resumeWithAttemptThree.batch.storeName ?? 'SHC001 · 美国站',
      dateStart: resumeWithAttemptThree.request.dateStart,
      dateEnd: resumeWithAttemptThree.request.dateEnd,
      rootDownloadDir,
      reportTypes: resumeWithAttemptThree.request.reportTypes,
      resumeFrom: resumeWithAttemptThree,
      async progressSink() {},
      authorityGuard() { return { allowed: true } as const; },
      cancellationGuard() { return { allowed: true } as const; },
      automation: {
        async navigateToDownloadCenter() { calls.push('navigate'); },
        async createReport(report, dateRange) {
          calls.push(`create:${report.type}`);
          return createdOutcome(report, dateRange);
        },
        async waitForReportReady() {},
        async downloadReport(report, downloadDir) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(
            downloadDir,
            `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_attempt3.xlsx`,
          );
          writeSemanticReportFixture(filePath, report);
          return filePath;
        },
      },
    });

    const resumedFile = result.files.find((file) => file.reportType === target.reportType)!;
    expect(result.job.jobId).toBe(resumeFrom.jobId);
    expect(result.batch.id).toBe(resumeFrom.batch.id);
    expect(calls.filter((call) => call.startsWith('create:'))).toHaveLength(5);
    expect(resumedFile).toEqual(expect.objectContaining({
      id: `${resumeFrom.jobId}-${target.reportType}-durable`,
      status: 'downloaded',
      maxAutoRetries: 3,
      ...priorEvidence,
    }));
    expect(resumedFile.attemptErrors).toEqual(expect.arrayContaining(['prior durable failure']));
  });

  it('finishes untouched queued reports without recreating a reconciled-absent report', async () => {
    const { rootDownloadDir, source } = await createThreeOfEightResumeFixture();
    const updatedAt = new Date(Date.parse(source.job.updatedAt) + 1).toISOString();
    const reports = source.job.reports.map((checkpoint) => {
      if (checkpoint.reportType === 'product_targeting') {
        return {
          reportType: checkpoint.reportType,
          state: 'failed' as const,
          attemptIndex: 0,
          autoRetryCount: 0,
          errorCode: 'LINGXING_CREATE_CONFIRMED_ABSENT',
          detail: '已确认原创建记录不存在，等待单独授权重新创建。',
          updatedAt,
        };
      }
      if (checkpoint.reportType === 'user_search_term') {
        return {
          reportType: checkpoint.reportType,
          state: 'queued' as const,
          attemptIndex: 0,
          autoRetryCount: 0,
          updatedAt,
        };
      }
      return checkpoint;
    });
    const job = {
      ...source.job,
      state: 'failed' as const,
      blockerCode: 'LINGXING_CREATE_CONFIRMED_ABSENT',
      detail: '商品投放等待单独授权重新创建。',
      reports,
      completedAt: updatedAt,
      updatedAt,
    };
    const resumeFrom: LingxingInPlaceResumeState = {
      jobId: job.jobId,
      request: job.request,
      reports,
      job,
      batch: {
        ...source.batch,
        status: 'failed',
        completedAt: updatedAt,
      },
      files: source.files.filter((file) => (
        !['product_targeting', 'user_search_term'].includes(file.reportType)
      )),
    };
    const createdTypes: string[] = [];
    const options = {
      requestId: resumeFrom.request.requestId,
      storeContext: resumeFrom.request.storeContext,
      executionStoreContext: resumeFrom.request.storeContext,
      progressEventNamespace: 'attempt-defer-reconciled-absent',
      storeDisplayName: resumeFrom.batch.storeName ?? 'SHC001 · 美国站',
      dateStart: resumeFrom.request.dateStart,
      dateEnd: resumeFrom.request.dateEnd,
      rootDownloadDir,
      reportTypes: resumeFrom.request.reportTypes,
      maxRetries: 0,
      resumeFrom,
      deferReconciledCreateFailures: true,
      async progressSink() {},
      authorityGuard() { return { allowed: true } as const; },
      cancellationGuard() { return { allowed: true } as const; },
      automation: {
        async navigateToDownloadCenter() {},
        async createReport(report: LingxingReportDefinition, dateRange: { start: string; end: string }) {
          createdTypes.push(report.type);
          return createdOutcome(report, dateRange);
        },
        async waitForReportReady() {},
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(
            downloadDir,
            `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_deferred.xlsx`,
          );
          writeSemanticReportFixture(filePath, report);
          return filePath;
        },
      },
    } as RunBatchOptions & { deferReconciledCreateFailures: boolean };

    const result = await runLingxingReportBatch(options);

    expect(createdTypes).toEqual(['user_search_term']);
    expect(result.job.state).toBe('completed_with_errors');
    expect(result.job.reports.find((report) => report.reportType === 'product_targeting'))
      .toEqual(expect.objectContaining({
        state: 'failed',
        errorCode: 'LINGXING_CREATE_CONFIRMED_ABSENT',
      }));
    expect(result.job.reports.find((report) => report.reportType === 'user_search_term')?.state)
      .toBe('downloaded');
  });

  it('rejects a tampered downloaded resume file before the first browser action', async () => {
    const { rootDownloadDir, resumeFrom } = await createThreeOfEightResumeFixture();
    fs.appendFileSync(resumeFrom.files[0].filePath!, 'tampered');
    let browserCalls = 0;
    const never = async () => {
      browserCalls += 1;
      throw new Error('browser must not run');
    };
    await expect(runLingxingReportBatch({
      requestId: resumeFrom.request.requestId,
      storeContext: resumeFrom.request.storeContext,
      executionStoreContext: resumeFrom.request.storeContext,
      progressEventNamespace: 'attempt-tampered',
      storeDisplayName: resumeFrom.batch.storeName ?? 'SHC001 · 美国站',
      dateStart: resumeFrom.request.dateStart,
      dateEnd: resumeFrom.request.dateEnd,
      rootDownloadDir,
      reportTypes: resumeFrom.request.reportTypes,
      resumeFrom,
      async progressSink() {},
      authorityGuard() { return { allowed: true } as const; },
      cancellationGuard() { return { allowed: true } as const; },
      automation: {
        navigateToDownloadCenter: never,
        createReport: never,
        waitForReportReady: never,
        downloadReport: never,
      },
    })).rejects.toThrow(/durable verification metadata|file size|verification/i);
    expect(browserCalls).toBe(0);
  });
});
