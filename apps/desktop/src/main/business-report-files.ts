import * as fs from 'fs';
import * as path from 'path';

export const BUSINESS_REAL_REPORT_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
export const BUSINESS_REJECTED_EVIDENCE_EXTENSIONS = ['.json', '.png', '.html', '.md', '.txt'];
export const BUSINESS_REJECTED_EVIDENCE_NAME_PATTERN = /(manifest|audit|diagnostic|screenshot|dom|trace|evidence|acceptance|batch-result|downloaded-report-files|failure)/i;

export interface BusinessRawReportFileLike {
  id?: string | null;
  reportType?: string | null;
  status?: string | null;
  filePath?: string | null;
  fileSizeBytes?: number | null;
}

export interface BusinessRawReportBatchLike {
  downloadDir?: string | null;
}

export interface BusinessRawReportBatchResultLike<TFile extends BusinessRawReportFileLike> {
  batch: BusinessRawReportBatchLike;
  files: TFile[];
}

export interface BusinessReportImportStateInput {
  fileStatus?: string | null;
  indexedStatus?: string | null;
  countedMetricRows?: number | null;
}

export function resolveBusinessReportImportState(input: BusinessReportImportStateInput): {
  importedRows: number;
  status: string;
} {
  const importedRows = Math.max(0, Number(input.countedMetricRows || 0));
  // The indexed report-file record is the durable per-file import receipt.
  // A schema-valid report may legitimately contain zero business rows, so a
  // successful indexed import must not be downgraded back to "downloaded".
  if (input.indexedStatus === 'import_failed') {
    return { importedRows: 0, status: 'import_failed' };
  }
  if (input.indexedStatus === 'imported') {
    return { importedRows, status: 'imported' };
  }
  if (importedRows > 0) {
    return { importedRows, status: 'imported' };
  }
  const unverifiedFileStatus = String(input.fileStatus || input.indexedStatus || 'downloaded');
  return {
    importedRows: 0,
    status: unverifiedFileStatus === 'imported' ? 'downloaded' : unverifiedFileStatus,
  };
}

export function isRejectedEvidenceLikePath(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  return BUSINESS_REJECTED_EVIDENCE_EXTENSIONS.includes(extension)
    || BUSINESS_REJECTED_EVIDENCE_NAME_PATTERN.test(fileName);
}

export function isExistingRawBusinessReportPath(filePath?: string | null, downloadDir?: string | null): boolean {
  if (!filePath) return false;
  if (!BUSINESS_REAL_REPORT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return false;
  if (isRejectedEvidenceLikePath(filePath)) return false;
  try {
    const resolved = path.resolve(filePath);
    if (downloadDir && !isPathWithinRealDirectory(resolved, downloadDir)) return false;
    const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : undefined;
    return Boolean(stat?.isFile() && stat.size > 0);
  } catch {
    return false;
  }
}

function isPathWithinRealDirectory(candidatePath: string, parentDir: string): boolean {
  try {
    const realCandidate = fs.realpathSync(candidatePath);
    const realParent = fs.realpathSync(parentDir);
    const relative = path.relative(path.resolve(realParent), realCandidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

export function isExistingRawBusinessReportFile<T extends BusinessRawReportFileLike>(
  file: T,
  batch?: BusinessRawReportBatchLike,
): file is T & { filePath: string } {
  if (!['downloaded', 'imported', 'import_failed'].includes(String(file.status || ''))) return false;
  return isExistingRawBusinessReportPath(file.filePath, batch?.downloadDir);
}

export function selectLatestRawBusinessReportsByType<TFile extends BusinessRawReportFileLike>(
  batchResults: Array<BusinessRawReportBatchResultLike<TFile>>,
): { files: TFile[]; fileDownloadDirs: Record<string, string> } {
  const filesByReportType = new Map<string, TFile>();
  const fileDownloadDirs: Record<string, string> = {};

  for (const batchResult of batchResults) {
    for (const file of batchResult.files) {
      const reportType = file.reportType || '';
      if (!reportType || filesByReportType.has(reportType)) continue;
      if (!isExistingRawBusinessReportFile(file, batchResult.batch)) continue;
      filesByReportType.set(reportType, file);
      if (file.id && batchResult.batch.downloadDir) fileDownloadDirs[file.id] = batchResult.batch.downloadDir;
    }
  }

  return { files: Array.from(filesByReportType.values()), fileDownloadDirs };
}
