import * as fs from 'fs';
import * as path from 'path';
import type { LingxingReportBatch, LingxingReportFile } from '@amazon-ai-ops/shared-types';
import { analyzeFilenameDateRange, LINGXING_AD_REPORTS, type FilenameDateRangeAnalysis } from '@amazon-ai-ops/lingxing-report-collector';

export type LingxingManifestForAudit = {
  appVersion?: string;
  generatedAt?: string;
  batch?: Partial<LingxingReportBatch>;
  files?: Array<Partial<LingxingReportFile>>;
};

export interface DownloadedReportEvidenceIndexItem {
  reportType: LingxingReportFile['reportType'];
  sourcePath?: string;
  basename?: string;
  exists: boolean;
  isFile: boolean;
  withinDownloadDir: boolean;
  safeForAudit: boolean;
  declaredSizeBytes?: number;
  actualSizeBytes?: number;
  unsafeReason?: string;
  expectedFilenameKeyword?: string;
  filenameMatchesReportType?: boolean;
  filenameDateRangeAnalysis?: FilenameDateRangeAnalysis;
  readyForAcceptance: boolean;
  acceptanceBlockers: string[];
}

export function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'batch';
}

export function readLingxingManifestForAudit(batch: LingxingReportBatch): LingxingManifestForAudit | undefined {
  if (!batch.manifestPath || !isSafeManifestPath(batch.manifestPath, batch.downloadDir)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(fs.realpathSync(batch.manifestPath), 'utf8'));
  } catch {
    return undefined;
  }
}

export function buildDownloadedReportEvidenceIndex(
  batch: LingxingReportBatch,
  files: LingxingReportFile[],
): DownloadedReportEvidenceIndexItem[] {
  return files
    .filter((file) => file.status === 'downloaded')
    .map((file) => {
      const sourcePath = file.filePath;
      const basename = sourcePath ? path.basename(sourcePath) : undefined;
      const filenameDateRangeAnalysis = basename
        ? analyzeFilenameDateRange(basename, batch.dateStart, batch.dateEnd)
        : undefined;
      const expectedFilenameKeyword = expectedFilenameKeywordForReport(file.reportType);
      const filenameMatchesReportType = Boolean(
        basename
          && expectedFilenameKeyword
          && basename.toLowerCase().includes(expectedFilenameKeyword.toLowerCase()),
      );
      if (!sourcePath) {
      const acceptanceBlockers = downloadedReportAcceptanceBlockers({
        safeForAudit: false,
        unsafeReason: 'filePath is missing',
        declaredSizeBytes: file.fileSizeBytes,
        filenameMatchesReportType,
        expectedFilenameKeyword,
        filenameDateRangeAnalysis,
      });
        return {
          reportType: file.reportType,
          exists: false,
          isFile: false,
          withinDownloadDir: false,
          safeForAudit: false,
          declaredSizeBytes: file.fileSizeBytes,
          unsafeReason: 'filePath is missing',
          expectedFilenameKeyword,
          filenameMatchesReportType,
          filenameDateRangeAnalysis,
          readyForAcceptance: acceptanceBlockers.length === 0,
          acceptanceBlockers,
        };
      }

      const withinDownloadDir = isPathWithinRealDirectory(sourcePath, batch.downloadDir);
      const stat = statFile(sourcePath);
      const exists = Boolean(stat);
      const isFile = Boolean(stat?.isFile());
      const safeForAudit = withinDownloadDir && exists && isFile;
      const unsafeReason = safeForAudit
        ? undefined
        : !withinDownloadDir ? 'outside batch downloadDir' : !exists ? 'file does not exist' : 'path is not a file';
      const acceptanceBlockers = downloadedReportAcceptanceBlockers({
        safeForAudit,
        unsafeReason,
        declaredSizeBytes: file.fileSizeBytes,
        actualSizeBytes: stat?.size,
        filenameMatchesReportType,
        expectedFilenameKeyword,
        filenameDateRangeAnalysis,
      });
      return {
        reportType: file.reportType,
        sourcePath,
        basename,
        exists,
        isFile,
        withinDownloadDir,
        safeForAudit,
        declaredSizeBytes: file.fileSizeBytes,
        actualSizeBytes: stat?.size,
        unsafeReason,
        expectedFilenameKeyword,
        filenameMatchesReportType,
        filenameDateRangeAnalysis,
        readyForAcceptance: acceptanceBlockers.length === 0,
        acceptanceBlockers,
      };
    });
}

function downloadedReportAcceptanceBlockers(input: {
  safeForAudit: boolean;
  unsafeReason?: string;
  declaredSizeBytes?: number;
  actualSizeBytes?: number;
  expectedFilenameKeyword?: string;
  filenameMatchesReportType: boolean;
  filenameDateRangeAnalysis?: FilenameDateRangeAnalysis;
}): string[] {
  const blockers: string[] = [];
  if (!input.safeForAudit) blockers.push(input.unsafeReason || 'file is not safe for audit');
  if (
    input.declaredSizeBytes !== undefined
    && input.actualSizeBytes !== undefined
    && input.declaredSizeBytes !== input.actualSizeBytes
  ) {
    blockers.push(`recorded size ${input.declaredSizeBytes} differs from actual size ${input.actualSizeBytes}`);
  }
  if (!input.filenameMatchesReportType) {
    blockers.push(input.expectedFilenameKeyword
      ? `filename missing expected report keyword ${input.expectedFilenameKeyword}`
      : 'missing expected report keyword definition');
  }
  if (!input.filenameDateRangeAnalysis?.hasStartToken) blockers.push('filename missing selected start date');
  if (!input.filenameDateRangeAnalysis?.hasEndToken) blockers.push('filename missing selected end date');
  return blockers;
}

function expectedFilenameKeywordForReport(reportType: LingxingReportFile['reportType']): string | undefined {
  return LINGXING_AD_REPORTS.find((report) => report.type === reportType)?.expectedFilenameKeyword;
}

export function isSafeManifestPath(manifestPath: string, downloadDir: string): boolean {
  try {
    const realManifestPath = fs.realpathSync(manifestPath);
    return path.basename(realManifestPath).toLowerCase() === 'manifest.json'
      && fs.statSync(realManifestPath).isFile()
      && isPathWithinRealDirectory(realManifestPath, downloadDir);
  } catch {
    return false;
  }
}

function statFile(filePath: string): fs.Stats | undefined {
  try {
    return fs.statSync(filePath);
  } catch {
    return undefined;
  }
}

export function isPathWithinRealDirectory(candidatePath: string, parentDir: string): boolean {
  try {
    const realCandidate = fs.realpathSync(candidatePath);
    const realParent = fs.realpathSync(parentDir);
    return isPathInsideDirectory(realCandidate, realParent);
  } catch {
    return false;
  }
}

export function isPathInsideDirectory(candidatePath: string, parentDir: string): boolean {
  const relative = path.relative(path.resolve(parentDir), candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
