import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LingxingReportBatch, LingxingReportFile } from '@amazon-ai-ops/shared-types';
import {
  buildDownloadedReportEvidenceIndex,
  isPathWithinRealDirectory,
  isSafeManifestPath,
  readLingxingManifestForAudit,
  safeFileSegment,
} from './acceptance-audit-export';

const tempDirs: string[] = [];
const supportsFileSymlink = canCreateFileSymlink();

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-audit-'));
  tempDirs.push(dir);
  return dir;
}

function batch(downloadDir: string, manifestPath?: string): LingxingReportBatch {
  return {
    id: 'batch:with/unsafe*chars',
    dateStart: '2026-05-01',
    dateEnd: '2026-05-31',
    status: 'completed',
    downloadDir,
    manifestPath,
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

function reportFile(overrides: Partial<LingxingReportFile> = {}): LingxingReportFile {
  return {
    id: 'file_keyword',
    batchId: 'batch:with/unsafe*chars',
    reportType: 'keyword',
    displayName: '关键词报告',
    status: 'downloaded',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:01:00.000Z',
    ...overrides,
  };
}

function canCreateFileSymlink(): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-symlink-check-'));
  try {
    const target = path.join(dir, 'target.json');
    const link = path.join(dir, 'link.json');
    fs.writeFileSync(target, '{}', 'utf8');
    fs.symlinkSync(target, link, 'file');
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('acceptance audit export path helpers', () => {
  it('sanitizes batch ids for export directory names', () => {
    expect(safeFileSegment('batch:with/unsafe*chars')).toBe('batch_with_unsafe_chars');
    expect(safeFileSegment('')).toBe('batch');
  });

  it('accepts manifest.json only when it is a file inside the real download directory', () => {
    const downloadDir = makeTempDir();
    const manifestPath = path.join(downloadDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ batch: { id: 'batch_1' }, files: [] }), 'utf8');

    expect(isSafeManifestPath(manifestPath, downloadDir)).toBe(true);
    expect(isPathWithinRealDirectory(manifestPath, downloadDir)).toBe(true);
    expect(readLingxingManifestForAudit(batch(downloadDir, manifestPath))).toMatchObject({
      batch: { id: 'batch_1' },
      files: [],
    });
  });

  it('rejects manifest paths outside the download directory even when the parent name shares a prefix', () => {
    const root = makeTempDir();
    const downloadDir = path.join(root, 'downloads');
    const siblingDir = path.join(root, 'downloads_evil');
    fs.mkdirSync(downloadDir);
    fs.mkdirSync(siblingDir);
    const outsideManifest = path.join(siblingDir, 'manifest.json');
    fs.writeFileSync(outsideManifest, JSON.stringify({}), 'utf8');

    expect(isSafeManifestPath(outsideManifest, downloadDir)).toBe(false);
    expect(isPathWithinRealDirectory(outsideManifest, downloadDir)).toBe(false);
    expect(readLingxingManifestForAudit(batch(downloadDir, outsideManifest))).toBeUndefined();
  });

  it('rejects non-manifest filenames and unreadable manifest content', () => {
    const downloadDir = makeTempDir();
    const wrongNamePath = path.join(downloadDir, 'batch-result.json');
    const badManifestPath = path.join(downloadDir, 'manifest.json');
    fs.writeFileSync(wrongNamePath, JSON.stringify({ batch: { id: 'batch_1' } }), 'utf8');
    fs.writeFileSync(badManifestPath, '{not-json', 'utf8');

    expect(isSafeManifestPath(wrongNamePath, downloadDir)).toBe(false);
    expect(readLingxingManifestForAudit(batch(downloadDir, wrongNamePath))).toBeUndefined();
    expect(isSafeManifestPath(badManifestPath, downloadDir)).toBe(true);
    expect(readLingxingManifestForAudit(batch(downloadDir, badManifestPath))).toBeUndefined();
  });

  it.skipIf(!supportsFileSymlink)('rejects a manifest symlink that resolves outside the download directory', () => {
    const root = makeTempDir();
    const downloadDir = path.join(root, 'downloads');
    const outsideDir = path.join(root, 'outside');
    fs.mkdirSync(downloadDir);
    fs.mkdirSync(outsideDir);
    const outsideManifest = path.join(outsideDir, 'manifest.json');
    const symlinkManifest = path.join(downloadDir, 'manifest.json');
    fs.writeFileSync(outsideManifest, JSON.stringify({ batch: { id: 'forged' }, files: [] }), 'utf8');
    fs.symlinkSync(outsideManifest, symlinkManifest, 'file');

    expect(isSafeManifestPath(symlinkManifest, downloadDir)).toBe(false);
    expect(readLingxingManifestForAudit(batch(downloadDir, symlinkManifest))).toBeUndefined();
  });

  it('builds a downloaded report evidence index with path safety and filename date analysis', () => {
    const root = makeTempDir();
    const downloadDir = path.join(root, 'downloads');
    const siblingDir = path.join(root, 'downloads_evil');
    fs.mkdirSync(downloadDir);
    fs.mkdirSync(siblingDir);
    const insideFile = path.join(downloadDir, 'keyword_20260501_20260531.xlsx');
    const outsideFile = path.join(siblingDir, 'keyword_20260501_20260531.xlsx');
    fs.writeFileSync(insideFile, Buffer.alloc(256));
    fs.writeFileSync(outsideFile, Buffer.alloc(256));

    const result = buildDownloadedReportEvidenceIndex(batch(downloadDir), [
      reportFile({ reportType: 'keyword', filePath: insideFile, fileSizeBytes: 256 }),
      reportFile({ id: 'file_campaign', reportType: 'campaign', filePath: outsideFile, fileSizeBytes: 256 }),
      reportFile({ id: 'file_failed', reportType: 'ad_group', status: 'failed', filePath: undefined }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      reportType: 'keyword',
      basename: 'keyword_20260501_20260531.xlsx',
      exists: true,
      isFile: true,
      withinDownloadDir: true,
      safeForAudit: true,
      actualSizeBytes: 256,
      declaredSizeBytes: 256,
      expectedFilenameKeyword: 'keyword',
      filenameMatchesReportType: true,
      readyForAcceptance: true,
      acceptanceBlockers: [],
      filenameDateRangeAnalysis: {
        hasStartToken: true,
        hasEndToken: true,
      },
    });
    expect(result[1]).toMatchObject({
      reportType: 'campaign',
      exists: true,
      isFile: true,
      withinDownloadDir: false,
      safeForAudit: false,
      unsafeReason: 'outside batch downloadDir',
      expectedFilenameKeyword: 'campaign',
      filenameMatchesReportType: false,
      readyForAcceptance: false,
    });
    expect(result[1].acceptanceBlockers).toEqual([
      'outside batch downloadDir',
      'filename missing expected report keyword campaign',
    ]);
  });

  it('marks a downloaded report index item blocked when recorded and actual file sizes differ', () => {
    const downloadDir = makeTempDir();
    const filePath = path.join(downloadDir, 'keyword_20260501_20260531.xlsx');
    fs.writeFileSync(filePath, Buffer.alloc(128));

    const result = buildDownloadedReportEvidenceIndex(batch(downloadDir), [
      reportFile({ reportType: 'keyword', filePath, fileSizeBytes: 256 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      reportType: 'keyword',
      actualSizeBytes: 128,
      declaredSizeBytes: 256,
      readyForAcceptance: false,
    });
    expect(result[0].acceptanceBlockers).toEqual([
      'recorded size 256 differs from actual size 128',
    ]);
  });
});
