import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
} from '@amazon-ai-ops/browser-worker';
import { saveLingxingReportDownload } from './lingxing-download-save';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function capsule() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingxing-download-save-'));
  temporaryRoots.push(root);
  return ensureStoreCapsulePaths(deriveStoreCapsulePaths(root, 'store-one', 'browser-one'));
}

describe('saveLingxingReportDownload', () => {
  it('recovers a Chromium-canceled cloud-object download through the authenticated request context', async () => {
    const storeCapsule = capsule();
    const downloadDir = path.join(storeCapsule.downloadsDir, 'batch-one');
    fs.mkdirSync(downloadDir, { recursive: true });
    const body = Buffer.from('PK\u0003\u0004real-xlsx');
    const requestGet = vi.fn(async () => ({
      ok: () => true,
      status: () => 200,
      headers: () => ({
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      body: async () => body,
    }));

    const result = await saveLingxingReportDownload({
      download: {
        suggestedFilename: () => 'AAO_campaign.xlsx',
        url: () => 'https://download-cent-prod-1254213275.cos.accelerate.myqcloud.com/report/AAO_campaign.xlsx',
        saveAs: vi.fn(async () => {
          throw new Error('download.saveAs: canceled');
        }),
        failure: async () => 'canceled',
      },
      request: { get: requestGet },
      storeCapsule,
      downloadDir,
    });

    expect(requestGet).toHaveBeenCalledTimes(1);
    expect(result).toBe(path.join(downloadDir, 'AAO_campaign.xlsx'));
    expect(fs.readFileSync(result)).toEqual(body);
  });
});
