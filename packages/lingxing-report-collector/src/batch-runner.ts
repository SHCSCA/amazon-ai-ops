import * as path from 'path';
import type { LingxingReportBatch, LingxingReportFile, LingxingReportType } from '@amazon-ai-ops/shared-types';
import { LINGXING_AD_REPORTS } from './report-types';
import { DownloadCenterPage, type DownloadCenterAutomationPort } from './download-center-page';
import { verifyDownloadedFile } from './file-verifier';
import { writeManifest } from './manifest';

export interface RunBatchOptions {
  dateStart: string;
  dateEnd: string;
  rootDownloadDir: string;
  appVersion?: string;
  reportTypes?: LingxingReportType[];
  maxRetries?: number;
  automation: DownloadCenterAutomationPort;
}

export interface RunBatchResult {
  batch: LingxingReportBatch;
  files: LingxingReportFile[];
}

function stamp(): string {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function runLingxingReportBatch(options: RunBatchOptions): Promise<RunBatchResult> {
  if (options.reportTypes && options.reportTypes.length === 0) {
    throw new Error('reportTypes must be omitted for a full batch or contain at least one report type');
  }
  const maxRetries = options.maxRetries ?? 2;
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 10) {
    throw new Error('maxRetries must be an integer between 0 and 10');
  }

  const batchId = `batch_${stamp()}`;
  const downloadDir = path.join(
    options.rootDownloadDir,
    'lingxing-ad-reports',
    `${options.dateStart}_${options.dateEnd}`,
    batchId,
  );
  const batch: LingxingReportBatch = {
    id: batchId,
    appVersion: options.appVersion,
    dateStart: options.dateStart,
    dateEnd: options.dateEnd,
    status: 'running',
    downloadDir,
    createdAt: new Date().toISOString(),
  };
  const page = new DownloadCenterPage(options.automation);
  const files: LingxingReportFile[] = [];
  const selectedReports = options.reportTypes?.length
    ? LINGXING_AD_REPORTS.filter((report) => options.reportTypes!.includes(report.type))
    : LINGXING_AD_REPORTS;
  if (options.reportTypes?.length && selectedReports.length !== new Set(options.reportTypes).size) {
    throw new Error(`Unknown Lingxing report type in retry batch: ${options.reportTypes.join(', ')}`);
  }

  for (const report of selectedReports) {
    const file: LingxingReportFile = {
      id: `${batchId}_${report.type}`,
      batchId,
      reportType: report.type,
      displayName: report.displayName,
      status: 'creating',
      maxAutoRetries: maxRetries,
      autoRetryCount: 0,
      attemptErrors: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      file.autoRetryCount = attempt;
      file.status = 'creating';
      const isFinalAttempt = attempt === maxRetries;
      let tracePath: string | undefined;

      if (isFinalAttempt) {
        await options.automation.startAttemptTrace?.(
          report,
          { start: options.dateStart, end: options.dateEnd },
          attempt,
        );
      }

      try {
        const filePath = await page.createAndDownload(report, { start: options.dateStart, end: options.dateEnd }, downloadDir);
        const verification = verifyDownloadedFile(filePath, {
          minBytes: 128,
          expectedFilenameKeyword: report.expectedFilenameKeyword,
          expectedDateRange: { start: options.dateStart, end: options.dateEnd },
        });
        file.filePath = filePath;
        file.fileSizeBytes = verification.fileSizeBytes;
        if (!verification.valid) {
          throw new Error(verification.errorMessage || 'Downloaded file verification failed');
        }
        if (isFinalAttempt) {
          await options.automation.stopAttemptTrace?.(
            report,
            { start: options.dateStart, end: options.dateEnd },
            attempt,
            false,
          );
        }
        file.status = 'downloaded';
        file.errorMessage = undefined;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        file.status = 'failed';
        file.errorMessage = message;
        file.attemptErrors!.push(message);

        if (isFinalAttempt) {
          tracePath = await options.automation.stopAttemptTrace?.(
            report,
            { start: options.dateStart, end: options.dateEnd },
            attempt,
            true,
          );
          const evidence = await options.automation.captureFailureEvidence?.(
            report,
            { start: options.dateStart, end: options.dateEnd },
            file.attemptErrors!,
          );
          file.failureScreenshotPath = evidence?.screenshotPath;
          file.failureDomSnapshotPath = evidence?.domSnapshotPath;
          file.failureTracePath = tracePath ?? evidence?.tracePath;
          file.traceUnavailableReason = evidence?.traceUnavailableReason;
        }
      }
    }

    file.updatedAt = new Date().toISOString();
    files.push(file);
  }

  const failedCount = files.filter((file) => file.status === 'failed').length;
  batch.status = failedCount === 0 ? 'completed' : failedCount === files.length ? 'failed' : 'completed_with_errors';
  batch.completedAt = new Date().toISOString();
  batch.manifestPath = writeManifest(batch, files);

  return { batch, files };
}
