import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type LingxingCollectionProgressEvent,
} from '@amazon-ai-ops/shared-types';

const writeManifestMock = vi.hoisted(() => vi.fn());

vi.mock('./manifest', () => ({
  writeManifest: writeManifestMock,
}));

import { runLingxingReportBatch, type RunBatchOptions } from './batch-runner';

const STORE_CONTEXT = normalizeStoreContextEnvelope({
  storeId: 'shc001',
  browserProfileId: 'profile-shc001',
  marketplace: 'US',
  currency: 'USD',
  businessTimezone: 'America/Los_Angeles',
  businessDate: '2026-07-22',
  sessionGeneration: 21,
});

function options(
  rootDownloadDir: string,
  progressSink: RunBatchOptions['progressSink'],
): RunBatchOptions {
  return {
    requestId: 'manifest-order-test',
    storeContext: STORE_CONTEXT,
    storeDisplayName: 'SHC001 · 美国站',
    dateStart: '2026-07-01',
    dateEnd: '2026-07-22',
    rootDownloadDir,
    reportTypes: ['keyword'],
    maxRetries: 0,
    progressSink,
    authorityGuard() {
      return { allowed: true };
    },
    cancellationGuard() {
      return { allowed: true };
    },
    automation: {
      async navigateToDownloadCenter() {
        return;
      },
      async createReport(report, dateRange) {
        return {
          status: 'created',
          identity: {
            provider: 'lingxing',
            reportType: report.type,
            externalReportName: `keyword-${dateRange.start}-${dateRange.end}`,
            externalReportId: 'manifest-order-keyword',
            dateStart: dateRange.start,
            dateEnd: dateRange.end,
            createdAt: '2026-07-22T12:00:00.000Z',
          },
        };
      },
      async waitForReportReady() {
        return;
      },
      async downloadReport(report, downloadDir, dateRange) {
        fs.mkdirSync(downloadDir, { recursive: true });
        const filePath = path.join(
          downloadDir,
          `${report.expectedFilenameKeyword}_${dateRange.start}_${dateRange.end}_terminal.xlsx`,
        );
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[
          '日期', '广告活动', '广告组', '关键词', '展现量', '点击量', '花费', '订单', '销售额',
        ]]), 'Report');
        XLSX.writeFile(workbook, filePath);
        return filePath;
      },
    },
  };
}

describe('Lingxing manifest terminal truth ordering', () => {
  beforeEach(() => {
    writeManifestMock.mockReset();
  });

  it('writes the manifest and returns completed for Main without a split-brain completed progress event', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-manifest-order-'));
    const timeline: string[] = [];
    const progress: LingxingCollectionProgressEvent[] = [];
    const manifestPath = path.join(rootDownloadDir, 'manifest.json');
    writeManifestMock.mockImplementation(() => {
      timeline.push('manifest-written');
      return manifestPath;
    });

    const result = await runLingxingReportBatch(options(rootDownloadDir, (event) => {
      progress.push(event);
      if (event.job.state === 'completed') {
        timeline.push('progress-completed');
        throw new Error('completed must be committed by Main persistResult, not progressSink');
      }
    }));

    expect(result.job.state).toBe('completed');
    expect(result.batch.storeName).toBe('SHC001 · 美国站');
    expect(result.batch.manifestPath).toBe(manifestPath);
    expect(timeline).toEqual(['manifest-written']);
    expect(progress.at(-1)?.job.state).toBe('running');
    expect(progress.some((event) => event.job.state === 'completed')).toBe(false);
  });

  it('converts a manifest write exception into a durable failed terminal state', async () => {
    const rootDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-manifest-failure-'));
    const progress: LingxingCollectionProgressEvent[] = [];
    writeManifestMock.mockImplementation(() => {
      throw new Error('disk full at C:\\private\\manifest.json');
    });

    const result = await runLingxingReportBatch(options(rootDownloadDir, (event) => {
      progress.push(event);
    }));

    expect(result.batch.status).toBe('failed');
    expect(result.batch.manifestPath).toBeUndefined();
    expect(result.job).toMatchObject({
      state: 'failed',
      blockerCode: 'LINGXING_COLLECTION_MANIFEST_WRITE_FAILED',
    });
    expect(result.job.detail).toContain('[local-path-redacted]');
    expect(JSON.stringify(result.job)).not.toContain('C:\\private');
    expect(progress.some((event) => event.job.state === 'completed')).toBe(false);
    expect(progress.at(-1)?.job).toMatchObject({
      state: 'failed',
      blockerCode: 'LINGXING_COLLECTION_MANIFEST_WRITE_FAILED',
    });
  });
});
