import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { LingxingReportDefinition } from '@amazon-ai-ops/shared-types';
import { runLingxingReportBatch } from './batch-runner';
import type { DownloadCenterAutomationPort } from './download-center-page';

class SimulatedDownloadCenter implements DownloadCenterAutomationPort {
  readonly events: string[] = [];
  private readonly reports = new Map<string, 'created' | 'ready' | 'downloaded'>();

  async navigateToDownloadCenter(): Promise<void> {
    this.events.push('navigate');
  }

  async createReport(report: LingxingReportDefinition, dateRange: { start: string; end: string }): Promise<void> {
    this.events.push(`create:${report.type}:${dateRange.start}:${dateRange.end}`);
    this.reports.set(report.type, 'created');
  }

  async waitForReportReady(report: LingxingReportDefinition): Promise<void> {
    this.events.push(`wait:${report.type}`);
    if (this.reports.get(report.type) !== 'created') {
      throw new Error(`report was not created before waiting: ${report.type}`);
    }
    this.reports.set(report.type, 'ready');
  }

  async downloadReport(
    report: LingxingReportDefinition,
    downloadDir: string,
    dateRange: { start: string; end: string },
  ): Promise<string> {
    this.events.push(`download:${report.type}`);
    if (this.reports.get(report.type) !== 'ready') {
      throw new Error(`report was not ready before download: ${report.type}`);
    }
    this.reports.set(report.type, 'downloaded');
    fs.mkdirSync(downloadDir, { recursive: true });
    const filePath = path.join(downloadDir, `${report.expectedFilenameKeyword}_${dateRange.start}_${dateRange.end}_simulated.xlsx`);
    fs.writeFileSync(filePath, `${report.displayName}\n${'x'.repeat(256)}`, 'utf8');
    return filePath;
  }
}

describe('simulated Lingxing download center E2E', () => {
  it('creates, waits, downloads, verifies, and manifests all 8 reports in order', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-sim-e2e-'));
    const automation = new SimulatedDownloadCenter();
    const expectedReportTypes = [
      'campaign',
      'ad_group',
      'placement',
      'advertised_product',
      'auto_targeting',
      'keyword',
      'product_targeting',
      'user_search_term',
    ];

    try {
      const result = await runLingxingReportBatch({
        dateStart: '2026-05-01',
        dateEnd: '2026-05-31',
        rootDownloadDir,
        appVersion: '1.5.0-simulated-e2e',
        maxRetries: 0,
        automation,
      });

      expect(result.batch.status).toBe('completed');
      expect(result.files).toHaveLength(8);
      expect(result.files.map((file) => file.reportType)).toEqual(expectedReportTypes);
      expect(result.files.every((file) => file.status === 'downloaded')).toBe(true);
      expect(result.files.every((file) => file.fileSizeBytes && file.fileSizeBytes >= 128)).toBe(true);

      for (const file of result.files) {
        expect(file.filePath).toBeTruthy();
        expect(fs.existsSync(file.filePath!)).toBe(true);
        expect(path.basename(file.filePath!)).toContain('2026-05-01');
        expect(path.basename(file.filePath!)).toContain('2026-05-31');
      }

      const manifest = JSON.parse(fs.readFileSync(result.batch.manifestPath!, 'utf8'));
      expect(manifest.appVersion).toBe('1.5.0-simulated-e2e');
      expect(manifest.batch).toMatchObject({
        id: result.batch.id,
        status: 'completed',
        dateStart: '2026-05-01',
        dateEnd: '2026-05-31',
      });
      expect(manifest.files.map((file: { reportType: string }) => file.reportType)).toEqual(expectedReportTypes);
      expect(manifest.files.map((file: { status: string }) => file.status)).toEqual(Array(8).fill('downloaded'));
      for (let index = 0; index < result.files.length; index += 1) {
        expect(manifest.files[index]).toMatchObject({
          reportType: result.files[index].reportType,
          filePath: result.files[index].filePath,
          fileSizeBytes: result.files[index].fileSizeBytes,
          status: result.files[index].status,
        });
      }

      const nonNavigateEvents = automation.events.filter((event) => event !== 'navigate');
      for (let index = 0; index < nonNavigateEvents.length; index += 3) {
        const create = nonNavigateEvents[index];
        const wait = nonNavigateEvents[index + 1];
        const download = nonNavigateEvents[index + 2];
        const reportType = create.split(':')[1];
        expect(wait).toBe(`wait:${reportType}`);
        expect(download).toBe(`download:${reportType}`);
      }
    } finally {
      fs.rmSync(rootDownloadDir, { recursive: true, force: true });
    }
  });
});
