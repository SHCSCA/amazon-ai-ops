import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { initSqlite } from '../db';
import { ReportFileRepository } from './report-file-repo';

function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-report-files-'));
  const db = initSqlite(path.join(dir, 'test.db'));
  return { db, dir, repo: new ReportFileRepository(db) };
}

describe('ReportFileRepository', () => {
  it('tracks only real ad report files as downloadable business files', () => {
    const { db, dir, repo } = createRepo();

    try {
      repo.upsert({
        batchId: 'batch_1',
        reportType: 'keyword',
        filePath: 'C:/reports/keyword.xlsx',
        fileName: 'keyword.xlsx',
        fileSize: 1200,
        status: 'downloaded',
        importedRows: 10,
      });

      repo.upsert({
        batchId: 'batch_1',
        reportType: 'diagnostic',
        filePath: 'C:/reports/diagnostic.json',
        fileName: 'diagnostic.json',
        fileSize: 200,
        status: 'downloaded',
        importedRows: 0,
      });

      repo.upsert({
        batchId: 'batch_1',
        reportType: 'acceptance',
        filePath: 'C:/reports/acceptance-audit.csv',
        fileName: 'acceptance-audit.csv',
        fileSize: 300,
        status: 'downloaded',
        importedRows: 0,
      });

      repo.upsert({
        batchId: 'batch_1',
        reportType: 'campaign',
        filePath: 'C:/reports/campaign.xlsx',
        fileName: 'campaign.xlsx',
        fileSize: 0,
        status: 'downloaded',
        importedRows: 0,
      });

      repo.upsert({
        batchId: 'batch_1',
        reportType: 'ad_group',
        filePath: 'C:/reports/ad-group.xlsx',
        fileName: 'ad-group.xlsx',
        fileSize: 1200,
        status: 'failed',
        importedRows: 0,
      });

      const files = repo.findBusinessReportFiles({ batchId: 'batch_1' });

      expect(files).toHaveLength(1);
      expect(files[0]).toEqual(expect.objectContaining({
        batchId: 'batch_1',
        reportType: 'keyword',
        fileName: 'keyword.xlsx',
        importedRows: 10,
      }));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('updates existing file identity instead of creating duplicate rows', () => {
    const { db, dir, repo } = createRepo();

    try {
      const input = {
        batchId: 'batch_1',
        reportType: 'user_search_term',
        filePath: 'C:/reports/search-term.csv',
        fileName: 'search-term.csv',
        fileSize: 1200,
        status: 'downloaded',
        importedRows: 10,
      };

      repo.upsert(input);
      repo.upsert({ ...input, fileSize: 2000, importedRows: 33 });

      const files = repo.findBusinessReportFiles({ batchId: 'batch_1' });

      expect(files).toHaveLength(1);
      expect(files[0]).toEqual(expect.objectContaining({
        fileSize: 2000,
        importedRows: 33,
      }));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores import evidence fields for real report files', () => {
    const { db, dir, repo } = createRepo();

    try {
      const input = {
        batchId: 'batch_2',
        reportType: 'keyword',
        filePath: 'C:/reports/keyword-localized.csv',
        fileName: 'keyword-localized.csv',
        fileSize: 1800,
        status: 'import_failed',
        importedRows: 0,
        fileHash: 'abc123',
        importError: 'Missing required header',
        lastImportedAt: '2026-06-15T10:00:00.000Z',
      };

      repo.upsert(input);
      repo.upsert({
        ...input,
        status: 'imported',
        importedRows: 42,
        fileHash: 'def456',
        importError: null,
        lastImportedAt: '2026-06-15T10:05:00.000Z',
      });

      const files = repo.findBusinessReportFiles({ batchId: 'batch_2' });

      expect(files).toHaveLength(1);
      expect(files[0]).toEqual(expect.objectContaining({
        status: 'imported',
        importedRows: 42,
        fileHash: 'def456',
        importError: null,
        lastImportedAt: '2026-06-15T10:05:00.000Z',
      }));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
