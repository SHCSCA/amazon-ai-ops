import * as path from 'path';
import type { Database } from 'better-sqlite3';

export interface ReportFileRecord {
  id?: number;
  batchId: string;
  reportType: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  status: string;
  importedRows: number;
  fileHash?: string | null;
  importError?: string | null;
  lastImportedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReportFileFilter {
  batchId?: string;
  reportType?: string;
  status?: string;
  limit?: number;
}

const BUSINESS_REPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const EVIDENCE_NAME_PATTERN = /(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i;

export class ReportFileRepository {
  constructor(private db: Database) {}

  upsert(input: Omit<ReportFileRecord, 'id' | 'createdAt' | 'updatedAt'>): void {
    this.db.prepare(`
      INSERT INTO report_files (
        batch_id, report_type, file_path, file_name, file_size,
        status, imported_rows, file_hash, import_error, last_imported_at, created_at, updated_at
      )
      VALUES (
        @batchId, @reportType, @filePath, @fileName, @fileSize,
        @status, @importedRows, @fileHash, @importError, @lastImportedAt, datetime('now'), datetime('now')
      )
      ON CONFLICT(batch_id, report_type, file_path) DO UPDATE SET
        file_name = excluded.file_name,
        file_size = excluded.file_size,
        status = excluded.status,
        imported_rows = excluded.imported_rows,
        file_hash = excluded.file_hash,
        import_error = excluded.import_error,
        last_imported_at = excluded.last_imported_at,
        updated_at = excluded.updated_at
    `).run({
      ...input,
      fileHash: input.fileHash ?? null,
      importError: input.importError ?? null,
      lastImportedAt: input.lastImportedAt ?? null,
    });
  }

  findBusinessReportFiles(filter: ReportFileFilter = {}): ReportFileRecord[] {
    return this.find(filter).filter((file) => isBusinessReportFileRecord(file));
  }

  find(filter: ReportFileFilter = {}): ReportFileRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filter.batchId) {
      where.push('batch_id = ?');
      params.push(filter.batchId);
    }
    if (filter.reportType) {
      where.push('report_type = ?');
      params.push(filter.reportType);
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }

    const limit = Math.max(1, Math.min(Number(filter.limit ?? 500), 5000));
    const rows = this.db.prepare(`
      SELECT *
      FROM report_files
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(...params, limit) as unknown[];

    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: any): ReportFileRecord {
    return {
      id: row.id,
      batchId: row.batch_id,
      reportType: row.report_type,
      filePath: row.file_path,
      fileName: row.file_name,
      fileSize: row.file_size,
      status: row.status,
      importedRows: row.imported_rows,
      fileHash: row.file_hash,
      importError: row.import_error,
      lastImportedAt: row.last_imported_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function isBusinessReportFileName(filePathOrName: string): boolean {
  const extension = path.extname(filePathOrName).toLowerCase();
  const fileName = path.basename(filePathOrName);
  return BUSINESS_REPORT_EXTENSIONS.has(extension) && !EVIDENCE_NAME_PATTERN.test(fileName);
}

function isBusinessReportFileRecord(file: ReportFileRecord): boolean {
  if (!['downloaded', 'imported', 'import_failed'].includes(file.status)) return false;
  if (!Number.isFinite(file.fileSize) || file.fileSize <= 0) return false;
  return isBusinessReportFileName(file.fileName || file.filePath);
}
