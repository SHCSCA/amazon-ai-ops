import * as path from 'path';
import type { Database } from 'better-sqlite3';
import type { StoreId } from '@amazon-ai-ops/shared-types';

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

export interface StoreScopedReportFileRecord extends ReportFileRecord {
  storeId: StoreId;
}

const BUSINESS_REPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const EVIDENCE_NAME_PATTERN = /(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i;

export class ReportFileRepository {
  constructor(private db: Database) {}

  /** @deprecated Legacy unscoped write. Stage 2 must use upsertForStore. */
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

  upsertForStore(
    storeId: StoreId,
    input: Omit<ReportFileRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): void {
    this.assertStoreWritable(storeId);
    this.assertBatchOwnershipIfKnown(storeId, input.batchId);
    const upsert = this.db.transaction(() => {
      const existing = this.db.prepare(`
        SELECT id
        FROM report_files
        WHERE store_id = @storeId
          AND batch_id = @batchId
          AND report_type = @reportType
          AND file_path = @filePath
        LIMIT 1
      `).get({ ...input, storeId }) as { id: number } | undefined;
      const params = {
        ...input,
        storeId,
        fileHash: input.fileHash ?? null,
        importError: input.importError ?? null,
        lastImportedAt: input.lastImportedAt ?? null,
      };

      if (existing) {
        this.db.prepare(`
          UPDATE report_files
          SET file_name = @fileName,
              file_size = @fileSize,
              status = @status,
              imported_rows = @importedRows,
              file_hash = @fileHash,
              import_error = @importError,
              last_imported_at = @lastImportedAt,
              updated_at = datetime('now')
          WHERE id = @id AND store_id = @storeId
        `).run({ id: existing.id, ...params });
        return;
      }

      this.db.prepare(`
        INSERT INTO report_files (
          store_id, batch_id, report_type, file_path, file_name, file_size,
          status, imported_rows, file_hash, import_error, last_imported_at, created_at, updated_at
        ) VALUES (
          @storeId, @batchId, @reportType, @filePath, @fileName, @fileSize,
          @status, @importedRows, @fileHash, @importError, @lastImportedAt, datetime('now'), datetime('now')
        )
      `).run(params);
    });
    upsert.immediate();
  }

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use findBusinessReportFilesForStore. */
  findBusinessReportFiles(filter: ReportFileFilter = {}): ReportFileRecord[] {
    return this.find(filter).filter((file) => isBusinessReportFileRecord(file));
  }

  findBusinessReportFilesForStore(
    storeId: StoreId,
    filter: ReportFileFilter = {},
  ): StoreScopedReportFileRecord[] {
    return this.findForStore(storeId, filter).filter((file) => isBusinessReportFileRecord(file));
  }

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use findForStore. */
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

  findForStore(
    storeId: StoreId,
    filter: ReportFileFilter = {},
  ): StoreScopedReportFileRecord[] {
    const where: string[] = ['store_id = ?'];
    const params: unknown[] = [storeId];

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
      SELECT * FROM report_files
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `).all(...params, limit) as unknown[];
    return rows.map((row) => this.mapStoreScopedRow(row));
  }

  getByIdForStore(storeId: StoreId, id: number): StoreScopedReportFileRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM report_files WHERE id = ? AND store_id = ?
    `).get(id, storeId);
    return row ? this.mapStoreScopedRow(row) : undefined;
  }

  deleteForStore(storeId: StoreId, id: number): boolean {
    this.assertStoreWritable(storeId);
    const result = this.db.prepare(`
      DELETE FROM report_files WHERE id = ? AND store_id = ?
    `).run(id, storeId);
    return result.changes > 0;
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

  private mapStoreScopedRow(row: any): StoreScopedReportFileRecord {
    return {
      ...this.mapRow(row),
      storeId: row.store_id as StoreId,
    };
  }

  private assertStoreWritable(storeId: StoreId): void {
    const row = this.db.prepare(`
      SELECT status FROM stores WHERE store_id = ?
    `).get(storeId) as { status: string } | undefined;
    if (!row) throw new Error(`未知店铺 ${storeId}。`);
    if (row.status !== 'active') throw new Error(`店铺 ${storeId} 当前状态为 ${row.status}，禁止写入。`);
  }

  private assertBatchOwnershipIfKnown(storeId: StoreId, batchId: string): void {
    const rows = this.db.prepare(`
      SELECT store_id AS storeId
      FROM lingxing_report_batches
      WHERE id = ?
    `).all(batchId) as Array<{ storeId?: string | null }>;
    if (rows.length > 0 && !rows.some((row) => row.storeId === storeId)) {
      throw new Error(`报表批次 ${batchId} 不属于店铺 ${storeId}。`);
    }
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
