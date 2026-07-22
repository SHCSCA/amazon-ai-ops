import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionProgressEvent,
  type LingxingCreateReportOutcome,
  type LingxingReportDefinition,
} from '@amazon-ai-ops/shared-types';
import { runLingxingReportBatch } from './batch-runner';
import type { DownloadCenterAutomationPort } from './download-center-page';

class SimulatedDownloadCenter implements DownloadCenterAutomationPort {
  readonly events: string[] = [];
  private readonly reports = new Map<string, 'created' | 'ready' | 'downloaded'>();

  async navigateToDownloadCenter(): Promise<void> {
    this.events.push('navigate');
  }

  async createReport(
    report: LingxingReportDefinition,
    dateRange: { start: string; end: string },
  ): Promise<LingxingCreateReportOutcome> {
    this.events.push(`create:${report.type}:${dateRange.start}:${dateRange.end}`);
    this.reports.set(report.type, 'created');
    return {
      status: 'created',
      identity: {
        provider: 'lingxing',
        reportType: report.type,
        externalReportName: `${report.type}-${dateRange.start}-${dateRange.end}`,
        externalReportId: `simulated-${report.type}`,
        dateStart: dateRange.start,
        dateEnd: dateRange.end,
        createdAt: '2026-05-31T12:00:00.000Z',
      },
    };
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
    const dimensions: Record<LingxingReportDefinition['type'], string> = {
      campaign: '广告活动',
      ad_group: '广告组',
      placement: '广告位',
      advertised_product: '推广的商品',
      auto_targeting: '自动投放',
      keyword: '关键词',
      product_targeting: '商品投放',
      user_search_term: '用户搜索词',
    };
    const headers = ['日期', '广告活动'];
    if (report.type !== 'campaign') headers.push('广告组');
    if (!['campaign', 'ad_group'].includes(report.type)) headers.push(dimensions[report.type]);
    headers.push('展现量', '点击量', '花费', '订单', '销售额');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), 'Report');
    XLSX.writeFile(workbook, filePath);
    return filePath;
  }
}

describe('simulated Lingxing download center E2E', () => {
  it('creates, waits, downloads, verifies, and manifests all 8 reports in order', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-sim-e2e-'));
    const automation = new SimulatedDownloadCenter();
    const progressEvents: LingxingCollectionProgressEvent[] = [];
    const guardedSteps: string[] = [];
    const storeContext = normalizeStoreContextEnvelope({
      storeId: 'shc001',
      browserProfileId: 'profile-shc001',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: '2026-05-31',
      sessionGeneration: 9,
    });
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
        requestId: 'simulated-e2e-request',
        storeContext,
        storeDisplayName: 'SHC001 · 美国站',
        dateStart: '2026-05-01',
        dateEnd: '2026-05-31',
        rootDownloadDir,
        appVersion: '1.5.0-simulated-e2e',
        maxRetries: 0,
        automation,
        progressSink(event) {
          progressEvents.push(event);
        },
        authorityGuard(context) {
          guardedSteps.push(`authority:${context.step}`);
          return { allowed: true };
        },
        cancellationGuard(context) {
          guardedSteps.push(`cancellation:${context.step}`);
          return { allowed: true };
        },
      });

      expect(result.batch.status).toBe('completed');
      expect(result.batch.storeName).toBe('SHC001 · 美国站');
      expect(result.files).toHaveLength(8);
      expect(result.files.map((file) => file.reportType)).toEqual(expectedReportTypes);
      expect(result.files.every((file) => file.status === 'downloaded')).toBe(true);
      expect(result.files.every((file) => file.fileSizeBytes && file.fileSizeBytes >= 128)).toBe(true);
      expect(result.job.state).toBe('completed');
      expect(result.job.request.storeContext).toEqual(storeContext);
      expect(result.job.reports.every((report) => report.state === 'downloaded')).toBe(true);
      expect(progressEvents.at(-1)?.job.state).toBe('running');
      expect(progressEvents.some((event) => event.job.state === 'completed')).toBe(false);
      const progressTimestamps = progressEvents.map((event) => Date.parse(event.job.updatedAt));
      expect(progressTimestamps.every((timestamp, index) => (
        index === 0 || timestamp > progressTimestamps[index - 1]
      ))).toBe(true);
      expect(JSON.stringify(progressEvents)).not.toContain(rootDownloadDir);
      expect(guardedSteps.filter((step) => step === 'authority:create')).toHaveLength(8);
      expect(guardedSteps.filter((step) => step === 'cancellation:create')).toHaveLength(8);

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
      expect(manifest.job.request.requestId).toBe('simulated-e2e-request');
      expect(manifest.job.reports.every((report: { state: string }) => report.state === 'downloaded')).toBe(true);
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
