import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { LingxingReportDefinition } from '@amazon-ai-ops/shared-types';
import { runLingxingReportBatch } from './batch-runner';

describe('runLingxingReportBatch', () => {
  it('records all report files and writes a manifest', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-'));
    const calls: string[] = [];

    const result = await runLingxingReportBatch({
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
          fs.writeFileSync(filePath, 'x'.repeat(256), 'utf8');
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
    expect(manifest.batch.storeName).toBe('FT-US-US');
    expect(manifest.batch.marketplaceCode).toBe('US');
    expect(manifest.files).toHaveLength(8);
    expect(calls.filter((call) => call === 'navigate')).toHaveLength(8);
  });

  it('can run a single selected report type for retry batches', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-retry-'));
    const createdReports: string[] = [];

    const result = await runLingxingReportBatch({
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
          fs.writeFileSync(filePath, 'x'.repeat(256), 'utf8');
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

  it('records a failed single-report retry batch with the file error', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-retry-failed-'));

    const result = await runLingxingReportBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['keyword'],
      automation: {
        async navigateToDownloadCenter() {
          return;
        },
        async createReport() {
          throw new Error('download center model is not verified');
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

    const result = await runLingxingReportBatch({
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
            throw new Error(`temporary create failure ${createAttempts}`);
          }
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_after_retry.xlsx`);
          fs.writeFileSync(filePath, 'x'.repeat(256), 'utf8');
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

    const result = await runLingxingReportBatch({
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
            throw new Error('keyword report create failed');
          }
        },
        async waitForReportReady() {
          return;
        },
        async downloadReport(report: LingxingReportDefinition, downloadDir: string) {
          fs.mkdirSync(downloadDir, { recursive: true });
          const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_2026-05-01_2026-05-25_partial.xlsx`);
          fs.writeFileSync(filePath, 'x'.repeat(256), 'utf8');
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

    const result = await runLingxingReportBatch({
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

  it('rejects invalid collection dates before accepting a filename date match', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-invalid-date-'));

    const result = await runLingxingReportBatch({
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
    });

    expect(result.batch.status).toBe('failed');
    expect(result.files[0].status).toBe('failed');
    expect(result.files[0].fileSizeBytes).toBe(256);
    expect(result.files[0].errorMessage).toContain('采集日期格式无效');
  });

  it('captures failure evidence when automatic retries are exhausted', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-batch-evidence-'));
    const screenshotPath = path.join(rootDownloadDir, 'failure.png');
    const domSnapshotPath = path.join(rootDownloadDir, 'failure.html');
    const tracePath = path.join(rootDownloadDir, 'failure-trace.json');

    const result = await runLingxingReportBatch({
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
          throw new Error('persistent create failure');
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

    const result = await runLingxingReportBatch({
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
          throw new Error('still failing');
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

    await expect(runLingxingReportBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: [],
      automation,
    })).rejects.toThrow('reportTypes must be omitted');

    await expect(runLingxingReportBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      reportTypes: ['unknown' as any],
      automation,
    })).rejects.toThrow('Unknown Lingxing report type');

    await expect(runLingxingReportBatch({
      dateStart: '2026-05-01',
      dateEnd: '2026-05-25',
      rootDownloadDir,
      maxRetries: -1,
      automation,
    })).rejects.toThrow('maxRetries');
  });
});
