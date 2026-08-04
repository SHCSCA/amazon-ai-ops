import type {
  LingxingCreateReportOutcome,
  LingxingCreatedReportIdentity,
  LingxingReportDefinition,
} from '@amazon-ai-ops/shared-types';

export interface DownloadCenterFailureEvidence {
  screenshotPath?: string;
  domSnapshotPath?: string;
  tracePath?: string;
  traceUnavailableReason?: string;
}

export interface DownloadCenterAutomationPort {
  navigateToDownloadCenter(): Promise<void>;
  createReport(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
  ): Promise<LingxingCreateReportOutcome>;
  waitForReportReady(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
    createdReportIdentity?: LingxingCreatedReportIdentity,
  ): Promise<void>;
  downloadReport(
    report: LingxingReportDefinition,
    downloadDir: string,
    dateRange: { start: string; end: string },
    createdReportIdentity?: LingxingCreatedReportIdentity,
  ): Promise<string>;
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

  async navigate(): Promise<void> {
    await this.port.navigateToDownloadCenter();
  }

  async create(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
  ): Promise<LingxingCreateReportOutcome> {
    return this.port.createReport(report, dateRange);
  }

  async waitUntilReady(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
    createdReportIdentity?: LingxingCreatedReportIdentity,
  ): Promise<void> {
    await this.port.waitForReportReady(report, dateRange, createdReportIdentity);
  }

  async download(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
    downloadDir: string,
    createdReportIdentity?: LingxingCreatedReportIdentity,
  ): Promise<string> {
    return this.port.downloadReport(report, downloadDir, dateRange, createdReportIdentity);
  }
}
