import type { LingxingReportDefinition } from '@amazon-ai-ops/shared-types';

export interface DownloadCenterFailureEvidence {
  screenshotPath?: string;
  domSnapshotPath?: string;
  tracePath?: string;
  traceUnavailableReason?: string;
}

export interface DownloadCenterAutomationPort {
  navigateToDownloadCenter(): Promise<void>;
  createReport(report: LingxingReportDefinition, dateRange: { start: string; end: string }): Promise<void>;
  waitForReportReady(report: LingxingReportDefinition, dateRange: { start: string; end: string }): Promise<void>;
  downloadReport(report: LingxingReportDefinition, downloadDir: string, dateRange: { start: string; end: string }): Promise<string>;
  startAttemptTrace?(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
    attemptIndex: number,
  ): Promise<void>;
  stopAttemptTrace?(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
    attemptIndex: number,
    retain: boolean,
  ): Promise<string | undefined>;
  captureFailureEvidence?(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
    attemptErrors: string[],
  ): Promise<DownloadCenterFailureEvidence>;
}

export class DownloadCenterPage {
  constructor(private readonly port: DownloadCenterAutomationPort) {}

  async createAndDownload(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
    downloadDir: string,
  ): Promise<string> {
    await this.port.navigateToDownloadCenter();
    await this.port.createReport(report, dateRange);
    await this.port.waitForReportReady(report, dateRange);
    return this.port.downloadReport(report, downloadDir, dateRange);
  }

  async downloadExisting(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
    downloadDir: string,
  ): Promise<string> {
    await this.port.navigateToDownloadCenter();
    await this.port.waitForReportReady(report, dateRange);
    return this.port.downloadReport(report, downloadDir, dateRange);
  }
}
