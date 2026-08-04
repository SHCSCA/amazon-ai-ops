import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadListener } from './download-listener';
import {
  StoreCapsuleDownloadPathError,
  resolveStoreCapsuleDownloadTarget,
  sanitizeSuggestedDownloadFilename,
} from './store-download';
import {
  assertPathContained,
  deriveStoreCapsulePaths,
  ensureStoreCapsulePaths,
} from './store-profile';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function capsule() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-download-'));
  temporaryRoots.push(root);
  return ensureStoreCapsulePaths(deriveStoreCapsulePaths(root, 'store-one', 'browser-one'));
}

describe('store capsule download targets', () => {
  it('sanitizes a filename component and resolves it only inside this store downloads directory', () => {
    const paths = capsule();
    const target = resolveStoreCapsuleDownloadTarget(paths, ' Weekly:US? report.xlsx. ');

    expect(target.filename).toBe('Weekly_US_ report.xlsx');
    expect(target.path).toBe(path.join(paths.downloadsDir, target.filename));
    expect(Object.isFrozen(target)).toBe(true);
    expect(() => assertPathContained(paths.downloadsDir, target.path)).not.toThrow();
    expect(sanitizeSuggestedDownloadFilename('CON.xlsx')).toBe('_CON.xlsx');
  });

  it('preserves a contained Lingxing date and batch directory layout', () => {
    const paths = capsule();
    const batchDirectory = path.join(
      paths.downloadsDir,
      'lingxing-ad-reports',
      '2026-07-22',
      'batch-001',
    );
    fs.mkdirSync(batchDirectory, { recursive: true });

    const target = resolveStoreCapsuleDownloadTarget(paths, 'report.xlsx', batchDirectory);
    expect(target.path).toBe(path.join(batchDirectory, 'report.xlsx'));
    expect(() => assertPathContained(paths.downloadsDir, target.path)).not.toThrow();
  });

  it('rejects a target directory outside the store downloads capsule', () => {
    const paths = capsule();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-download-outside-'));
    temporaryRoots.push(outside);

    expect(() => resolveStoreCapsuleDownloadTarget(paths, 'report.xlsx', outside)).toThrowError(
      expect.objectContaining<Partial<StoreCapsuleDownloadPathError>>({
        code: 'DOWNLOAD_TARGET_DIRECTORY_OUTSIDE_CAPSULE',
      }),
    );
  });

  it.each([
    '../escape.xlsx',
    '..\\escape.xlsx',
    'nested/report.xlsx',
    'C:\\outside.xlsx',
    'C:drive-relative.xlsx',
    '/tmp/outside.xlsx',
    '..／outside.xlsx',
  ])('rejects path-shaped suggestedFilename %s', (filename) => {
    const paths = capsule();
    expect(() => resolveStoreCapsuleDownloadTarget(paths, filename)).toThrowError(
      expect.objectContaining<Partial<StoreCapsuleDownloadPathError>>({
        code: 'DOWNLOAD_FILENAME_PATH_ESCAPE',
      }),
    );
  });

  it('rejects invalid and overlong suggested filenames', () => {
    expect(() => sanitizeSuggestedDownloadFilename('..')).toThrowError(
      expect.objectContaining<Partial<StoreCapsuleDownloadPathError>>({
        code: 'DOWNLOAD_FILENAME_INVALID',
      }),
    );
    expect(() => sanitizeSuggestedDownloadFilename('x'.repeat(201))).toThrowError(
      expect.objectContaining<Partial<StoreCapsuleDownloadPathError>>({
        code: 'DOWNLOAD_FILENAME_TOO_LONG',
      }),
    );
  });
});

describe('DownloadListener store capsule containment', () => {
  it('rejects traversal before saveAs and records only the contained sanitized target', async () => {
    const paths = capsule();
    const batchDirectory = path.join(paths.downloadsDir, 'lingxing-ad-reports', '2026-07-22', 'batch-001');
    fs.mkdirSync(batchDirectory, { recursive: true });
    const listener = new DownloadListener(paths, batchDirectory);
    type DownloadHandler = (download: {
      saveAs(targetPath: string): Promise<void>;
      suggestedFilename(): string;
    }) => Promise<void>;
    let handler: DownloadHandler | undefined;
    const page = {
      on(event: string, callback: DownloadHandler) {
        expect(event).toBe('download');
        handler = callback;
        return this;
      },
    } as unknown as Page;
    await listener.startListening(page);
    expect(handler).toBeTypeOf('function');

    const rejectedSave = vi.fn(async () => undefined);
    await expect(handler!({
      suggestedFilename: () => '../outside.xlsx',
      saveAs: rejectedSave,
    })).rejects.toMatchObject({ code: 'DOWNLOAD_FILENAME_PATH_ESCAPE' });
    expect(rejectedSave).not.toHaveBeenCalled();
    expect(listener.getDownloads()).toEqual([]);

    await handler!({
      suggestedFilename: () => 'report:US?.xlsx',
      saveAs: async (targetPath) => { fs.writeFileSync(targetPath, 'safe-report'); },
    });
    const [download] = listener.getDownloads();
    expect(download.filename).toBe('report_US_.xlsx');
    expect(download.path).toBe(path.join(batchDirectory, 'report_US_.xlsx'));
    expect(fs.readFileSync(download.path, 'utf8')).toBe('safe-report');
    expect(() => assertPathContained(paths.downloadsDir, download.path)).not.toThrow();
  });
});
