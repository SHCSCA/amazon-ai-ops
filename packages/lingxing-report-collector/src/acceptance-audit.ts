import * as path from 'path';
import type { DownloadCenterDiagnosticResult, LingxingReportBatch, LingxingReportFile, LingxingReportType } from '@amazon-ai-ops/shared-types';
import type { DownloadCenterDiagnosticEvidenceReadiness } from './diagnostic-evidence-gate';
import { analyzeFilenameDateRange, filenameContainsDateRange, filenameDateRangeAnalysisSummary, type FilenameDateRangeAnalysis } from './filename-date-range';
import { LINGXING_AD_REPORTS } from './report-types';

export type AcceptanceCheckStatus = 'passed' | 'failed' | 'incomplete';

export interface AcceptanceCheck {
  name: string;
  status: AcceptanceCheckStatus;
  detail: string;
}

interface DirectoryLayoutProblem {
  status: Exclude<AcceptanceCheckStatus, 'passed'>;
  detail: string;
}

export interface LingxingAcceptanceAuditInput {
  batch: LingxingReportBatch;
  files: LingxingReportFile[];
  diagnostic?: DownloadCenterDiagnosticResult;
  diagnosticEvidenceReadiness?: DownloadCenterDiagnosticEvidenceReadiness;
  manifest?: { appVersion?: string; generatedAt?: string; batch?: Partial<LingxingReportBatch>; files?: Array<Partial<LingxingReportFile>> };
  fileExists?: (filePath: string) => boolean;
  getFileSizeBytes?: (filePath: string) => number | undefined;
  nowMs?: number;
}

export interface LingxingAcceptanceAuditResult {
  status: AcceptanceCheckStatus;
  generatedAt: string;
  expectedReportTypes: LingxingReportType[];
  downloadedCount: number;
  failedCount: number;
  filenameDateRangeAnalyses: LingxingFilenameDateRangeAudit[];
  checks: AcceptanceCheck[];
}

export interface LingxingFilenameDateRangeAudit {
  reportType: LingxingReportType;
  filePath?: string;
  basename?: string;
  analysis?: FilenameDateRangeAnalysis;
  summary: string;
}

const EXPECTED_REPORT_TYPES = LINGXING_AD_REPORTS.map((report) => report.type);

export function auditLingxingAcceptanceEvidence(input: LingxingAcceptanceAuditInput): LingxingAcceptanceAuditResult {
  const auditNowMs = input.nowMs !== undefined && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const actualReportTypes = input.files.map((file) => file.reportType);
  const missingReportTypes = EXPECTED_REPORT_TYPES.filter((type) => !actualReportTypes.includes(type));
  const extraReportTypes = actualReportTypes.filter((type) => !EXPECTED_REPORT_TYPES.includes(type));
  const failedFiles = input.files.filter((file) => file.status === 'failed');
  const notDownloaded = input.files.filter((file) => file.status !== 'downloaded');
  const missingFilePaths = input.files.filter((file) => file.status === 'downloaded' && (!file.filePath || (input.fileExists ? !input.fileExists(file.filePath) : false)));
  const fileSizeProblems = downloadedFileSizeProblems(input.files, input.getFileSizeBytes);
  const wrongDateFiles = input.files.filter((file) => {
    if (!file.filePath) return false;
    const basename = path.basename(file.filePath);
    return !filenameContainsDateRange(basename, input.batch.dateStart, input.batch.dateEnd);
  });
  const wrongReportKeywordFiles = reportKeywordFilenameProblems(input.files);
  const directoryLayoutProblems = downloadDirectoryLayoutProblems(input.batch, input.files);
  const filenameDateRangeAnalyses = buildFilenameDateRangeAudits(input.files, input.batch);
  const manifestProblems = manifestConsistencyProblems(input.batch, input.files, input.manifest, auditNowMs);
  const hasFailedManifestProblem = manifestProblems.some((problem) => problem.status === 'failed');

  const checks: AcceptanceCheck[] = [
    {
      name: 'batch_completed',
      status: input.batch.status === 'completed' ? 'passed' : input.batch.status === 'completed_with_errors' || input.batch.status === 'failed' ? 'failed' : 'incomplete',
      detail: `batch status is ${input.batch.status}`,
    },
    {
      name: 'all_8_report_types',
      status: missingReportTypes.length === 0 && extraReportTypes.length === 0 && input.files.length === EXPECTED_REPORT_TYPES.length ? 'passed' : 'incomplete',
      detail: missingReportTypes.length || extraReportTypes.length
        ? `missing=${missingReportTypes.join(',') || 'none'}; extra=${extraReportTypes.join(',') || 'none'}`
        : `report types=${actualReportTypes.join(',')}`,
    },
    {
      name: 'all_files_downloaded',
      status: notDownloaded.length === 0 ? 'passed' : failedFiles.length > 0 ? 'failed' : 'incomplete',
      detail: `downloaded=${input.files.length - notDownloaded.length}; failed=${failedFiles.length}; total=${input.files.length}`,
    },
    {
      name: 'downloaded_files_exist',
      status: !input.fileExists ? 'incomplete' : missingFilePaths.length === 0 ? 'passed' : 'failed',
      detail: !input.fileExists
        ? 'file existence checker is missing'
        : missingFilePaths.length === 0 ? 'all downloaded file paths exist' : `missing paths for ${missingFilePaths.map((file) => file.reportType).join(',')}`,
    },
    {
      name: 'downloaded_file_sizes_match_record',
      status: fileSizeProblems.some((problem) => problem.status === 'failed')
        ? 'failed'
        : fileSizeProblems.length > 0 ? 'incomplete' : 'passed',
      detail: fileSizeProblems.length === 0
        ? 'all downloaded file sizes match recorded sizes'
        : fileSizeProblems.map((problem) => problem.detail).join('; '),
    },
    {
      name: 'downloaded_filenames_match_date_range',
      status: wrongDateFiles.length === 0 ? 'passed' : 'failed',
      detail: wrongDateFiles.length === 0
        ? `all filenames include ${input.batch.dateStart} and ${input.batch.dateEnd}`
        : wrongDateFiles.map((file) => {
          const basename = path.basename(file.filePath || '');
          const analysis = analyzeFilenameDateRange(basename, input.batch.dateStart, input.batch.dateEnd);
          return `${file.reportType}: ${filenameDateRangeAnalysisSummary(analysis)}`;
        }).join('; '),
    },
    {
      name: 'downloaded_filenames_match_report_type',
      status: wrongReportKeywordFiles.length === 0 ? 'passed' : 'failed',
      detail: wrongReportKeywordFiles.length === 0
        ? 'all downloaded filenames include their expected report keywords'
        : wrongReportKeywordFiles.join('; '),
    },
    {
      name: 'download_directory_layout',
      status: directoryLayoutProblems.some((problem) => problem.status === 'failed')
        ? 'failed'
        : directoryLayoutProblems.length > 0 ? 'incomplete' : 'passed',
      detail: directoryLayoutProblems.length === 0
        ? 'manifest and downloaded files are inside the batch downloadDir'
        : directoryLayoutProblems.map((problem) => problem.detail).join('; '),
    },
    {
      name: 'manifest_consistent',
      status: manifestProblems.length === 0
        ? 'passed'
        : hasFailedManifestProblem ? 'failed' : 'incomplete',
      detail: manifestProblems.length === 0 ? 'manifest matches batch and files' : manifestProblems.map((problem) => problem.detail).join('; '),
    },
    diagnosticCheck(input.batch, input.diagnostic, input.diagnosticEvidenceReadiness),
  ];

  return {
    status: summarizeStatus(checks),
    generatedAt: new Date(auditNowMs).toISOString(),
    expectedReportTypes: [...EXPECTED_REPORT_TYPES],
    downloadedCount: input.files.filter((file) => file.status === 'downloaded').length,
    failedCount: failedFiles.length,
    filenameDateRangeAnalyses,
    checks,
  };
}

function buildFilenameDateRangeAudits(
  files: LingxingReportFile[],
  batch: LingxingReportBatch,
): LingxingFilenameDateRangeAudit[] {
  return files.map((file) => {
    if (!file.filePath) {
      return {
        reportType: file.reportType,
        summary: 'file path is missing',
      };
    }
    const basename = path.basename(file.filePath);
    const analysis = analyzeFilenameDateRange(basename, batch.dateStart, batch.dateEnd);
    return {
      reportType: file.reportType,
      filePath: file.filePath,
      basename,
      analysis,
      summary: filenameDateRangeAnalysisSummary(analysis),
    };
  });
}

function diagnosticCheck(
  batch: LingxingReportBatch,
  diagnostic?: DownloadCenterDiagnosticResult,
  diagnosticEvidenceReadiness?: DownloadCenterDiagnosticEvidenceReadiness,
): AcceptanceCheck {
  if (!diagnostic) {
    return {
      name: 'download_center_diagnostic',
      status: 'incomplete',
      detail: 'diagnostic evidence is missing',
    };
  }
  if (!diagnostic.ready) {
    return {
      name: 'download_center_diagnostic',
      status: 'failed',
      detail: diagnostic.errorMessage || 'diagnostic did not pass',
    };
  }
  if (diagnostic.dateStart !== batch.dateStart || diagnostic.dateEnd !== batch.dateEnd) {
    return {
      name: 'download_center_diagnostic',
      status: 'incomplete',
      detail: `diagnostic date range ${diagnostic.dateStart || 'unknown'} to ${diagnostic.dateEnd || 'unknown'} does not match batch`,
    };
  }
  if (
    normalizeOptionalScope(diagnostic.storeName) !== normalizeOptionalScope(batch.storeName)
    || normalizeOptionalScope(diagnostic.marketplaceCode) !== normalizeOptionalScope(batch.marketplaceCode)
  ) {
    return {
      name: 'download_center_diagnostic',
      status: 'incomplete',
      detail: `diagnostic store/site scope ${diagnostic.storeName || 'not specified'}/${diagnostic.marketplaceCode || 'not specified'} does not match batch ${batch.storeName || 'not specified'}/${batch.marketplaceCode || 'not specified'}`,
    };
  }
  if (!diagnosticEvidenceReadiness?.ready) {
    return {
      name: 'download_center_diagnostic',
      status: 'incomplete',
      detail: diagnosticEvidenceReadiness?.reason || `diagnostic evidence readiness missing: ${diagnosticEvidenceReadiness?.missing.join(', ') || 'unknown'}`,
    };
  }
  const provenanceProblem = diagnosticReadinessProvenanceProblem(diagnostic, diagnosticEvidenceReadiness);
  if (provenanceProblem) {
    return {
      name: 'download_center_diagnostic',
      status: 'incomplete',
      detail: provenanceProblem,
    };
  }
  return {
    name: 'download_center_diagnostic',
    status: 'passed',
    detail: `diagnostic ${diagnostic.id ?? 'unknown'} ready for ${diagnostic.dateStart} to ${diagnostic.dateEnd}`,
  };
}

function diagnosticReadinessProvenanceProblem(
  diagnostic: DownloadCenterDiagnosticResult,
  readiness: DownloadCenterDiagnosticEvidenceReadiness,
): string | undefined {
  if (typeof readiness.diagnosticId !== 'number' || !readiness.checkedAt) {
    return 'diagnostic evidence readiness is missing persisted diagnostic provenance';
  }
  if (diagnostic.id !== undefined && readiness.diagnosticId !== diagnostic.id) {
    return 'diagnostic evidence readiness does not match the diagnostic id';
  }
  if (!Number.isFinite(Date.parse(readiness.checkedAt))) {
    return 'diagnostic evidence readiness checkedAt is not a valid timestamp';
  }
  if (diagnostic.checkedAt && readiness.checkedAt !== diagnostic.checkedAt) {
    return 'diagnostic evidence readiness checkedAt does not match the diagnostic';
  }
  return undefined;
}

function normalizeOptionalScope(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function downloadedFileSizeProblems(
  files: LingxingReportFile[],
  getFileSizeBytes?: (filePath: string) => number | undefined,
): DirectoryLayoutProblem[] {
  if (!getFileSizeBytes) return [{ status: 'incomplete', detail: 'file size checker is missing' }];
  const problems: DirectoryLayoutProblem[] = [];
  for (const file of files) {
    if (file.status !== 'downloaded' || !file.filePath) continue;
    const actualSize = getFileSizeBytes(file.filePath);
    if (!Number.isFinite(actualSize)) {
      problems.push({ status: 'incomplete', detail: `${file.reportType} actual file size is unavailable` });
      continue;
    }
    if (file.fileSizeBytes !== actualSize) {
      problems.push({
        status: 'failed',
        detail: `${file.reportType} size mismatch recorded=${file.fileSizeBytes ?? 'unknown'} actual=${actualSize}`,
      });
    }
  }
  return problems;
}

function reportKeywordFilenameProblems(files: LingxingReportFile[]): string[] {
  const definitions = new Map(LINGXING_AD_REPORTS.map((report) => [report.type, report]));
  return files.flatMap((file) => {
    if (file.status !== 'downloaded' || !file.filePath) return [];
    const expectedKeyword = definitions.get(file.reportType)?.expectedFilenameKeyword;
    if (!expectedKeyword) return [`${file.reportType} has no expected filename keyword definition`];
    const basename = path.basename(file.filePath).toLowerCase();
    return basename.includes(expectedKeyword.toLowerCase())
      ? []
      : [`${file.reportType} filename missing expected keyword ${expectedKeyword}`];
  });
}

function downloadDirectoryLayoutProblems(batch: LingxingReportBatch, files: LingxingReportFile[]): DirectoryLayoutProblem[] {
  const problems: DirectoryLayoutProblem[] = [];
  if (!batch.downloadDir) {
    return [{ status: 'incomplete', detail: 'downloadDir is missing' }];
  }
  if (!batch.manifestPath) {
    problems.push({ status: 'incomplete', detail: 'manifestPath is missing' });
  } else if (!isPathInsideDirectory(batch.manifestPath, batch.downloadDir)) {
    problems.push({ status: 'failed', detail: 'manifestPath is outside batch downloadDir' });
  }

  for (const file of files) {
    if (file.status !== 'downloaded') continue;
    if (!file.filePath) {
      problems.push({ status: 'incomplete', detail: `${file.reportType} filePath is missing` });
      continue;
    }
    if (!isPathInsideDirectory(file.filePath, batch.downloadDir)) {
      problems.push({ status: 'failed', detail: `${file.reportType} filePath is outside batch downloadDir` });
    }
  }
  return problems;
}

function isPathInsideDirectory(candidatePath: string, parentDir: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function manifestConsistencyProblems(
  batch: LingxingReportBatch,
  files: LingxingReportFile[],
  manifest?: { appVersion?: string; generatedAt?: string; batch?: Partial<LingxingReportBatch>; files?: Array<Partial<LingxingReportFile>> },
  auditNowMs = Date.now(),
): DirectoryLayoutProblem[] {
  if (!batch.manifestPath) return [{ status: 'incomplete', detail: 'manifest path is missing' }];
  if (!manifest) return [{ status: 'incomplete', detail: 'manifest content is missing or unreadable' }];
  const problems: DirectoryLayoutProblem[] = [];
  if (!batch.appVersion || !manifest.appVersion) problems.push({ status: 'incomplete', detail: 'manifest appVersion is missing' });
  else if (batch.appVersion !== manifest.appVersion) problems.push({ status: 'failed', detail: 'manifest appVersion does not match' });
  if (!manifest.generatedAt) {
    problems.push({ status: 'incomplete', detail: 'manifest generatedAt is missing' });
  } else {
    problems.push(...manifestGeneratedAtProblems(manifest.generatedAt, batch, auditNowMs));
  }
  if (manifest.batch?.id !== batch.id) problems.push({ status: 'failed', detail: 'manifest batch id does not match' });
  if (manifest.batch?.appVersion !== batch.appVersion) problems.push({ status: 'failed', detail: 'manifest batch appVersion does not match' });
  if (manifest.batch?.createdAt !== batch.createdAt) problems.push({ status: 'failed', detail: 'manifest batch createdAt does not match' });
  if (manifest.batch?.completedAt !== batch.completedAt) problems.push({ status: 'failed', detail: 'manifest batch completedAt does not match' });
  if (manifest.batch?.downloadDir !== batch.downloadDir) problems.push({ status: 'failed', detail: 'manifest batch downloadDir does not match' });
  if (manifest.batch?.manifestPath !== batch.manifestPath) problems.push({ status: 'failed', detail: 'manifest batch manifestPath does not match' });
  if (manifest.batch?.dateStart !== batch.dateStart || manifest.batch?.dateEnd !== batch.dateEnd) problems.push({ status: 'failed', detail: 'manifest date range does not match' });
  if (manifest.batch?.storeName !== batch.storeName) problems.push({ status: 'failed', detail: 'manifest batch storeName does not match' });
  if (manifest.batch?.marketplaceCode !== batch.marketplaceCode) problems.push({ status: 'failed', detail: 'manifest batch marketplaceCode does not match' });
  if (manifest.batch?.status !== batch.status) problems.push({ status: 'failed', detail: 'manifest batch status does not match' });
  if (!Array.isArray(manifest.files) || manifest.files.length !== files.length) {
    problems.push({ status: 'failed', detail: 'manifest file count does not match' });
    return problems;
  }
  for (const file of files) {
    const manifestFile = manifest.files.find((item) => item.id === file.id || item.reportType === file.reportType);
    if (!manifestFile) {
      problems.push({ status: 'failed', detail: `manifest missing file ${file.reportType}` });
      continue;
    }
    if (manifestFile.id !== file.id) problems.push({ status: 'failed', detail: `manifest id mismatch for ${file.reportType}` });
    if (manifestFile.batchId !== file.batchId) problems.push({ status: 'failed', detail: `manifest batchId mismatch for ${file.reportType}` });
    if (manifestFile.reportType !== file.reportType) problems.push({ status: 'failed', detail: `manifest report type mismatch for ${file.reportType}` });
    if (manifestFile.displayName !== file.displayName) problems.push({ status: 'failed', detail: `manifest displayName mismatch for ${file.reportType}` });
    if (manifestFile.status !== file.status) problems.push({ status: 'failed', detail: `manifest status mismatch for ${file.reportType}` });
    if (manifestFile.maxAutoRetries !== file.maxAutoRetries) problems.push({ status: 'failed', detail: `manifest maxAutoRetries mismatch for ${file.reportType}` });
    if (manifestFile.autoRetryCount !== file.autoRetryCount) problems.push({ status: 'failed', detail: `manifest autoRetryCount mismatch for ${file.reportType}` });
    if (manifestFile.filePath !== file.filePath) problems.push({ status: 'failed', detail: `manifest filePath mismatch for ${file.reportType}` });
    if (manifestFile.fileSizeBytes !== file.fileSizeBytes) problems.push({ status: 'failed', detail: `manifest fileSizeBytes mismatch for ${file.reportType}` });
    if (manifestFile.errorMessage !== file.errorMessage) problems.push({ status: 'failed', detail: `manifest errorMessage mismatch for ${file.reportType}` });
    if (!sameStringArray(manifestFile.attemptErrors, file.attemptErrors)) problems.push({ status: 'failed', detail: `manifest attemptErrors mismatch for ${file.reportType}` });
    if (manifestFile.failureScreenshotPath !== file.failureScreenshotPath) problems.push({ status: 'failed', detail: `manifest failureScreenshotPath mismatch for ${file.reportType}` });
    if (manifestFile.failureDomSnapshotPath !== file.failureDomSnapshotPath) problems.push({ status: 'failed', detail: `manifest failureDomSnapshotPath mismatch for ${file.reportType}` });
    if (manifestFile.failureTracePath !== file.failureTracePath) problems.push({ status: 'failed', detail: `manifest failureTracePath mismatch for ${file.reportType}` });
    if (manifestFile.traceUnavailableReason !== file.traceUnavailableReason) problems.push({ status: 'failed', detail: `manifest traceUnavailableReason mismatch for ${file.reportType}` });
    if (manifestFile.createdAt !== file.createdAt) problems.push({ status: 'failed', detail: `manifest createdAt mismatch for ${file.reportType}` });
    if (manifestFile.updatedAt !== file.updatedAt) problems.push({ status: 'failed', detail: `manifest updatedAt mismatch for ${file.reportType}` });
  }
  return problems;
}

function sameStringArray(left?: string[], right?: string[]): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function manifestGeneratedAtProblems(generatedAt: string, batch: LingxingReportBatch, auditNowMs: number): DirectoryLayoutProblem[] {
  const generatedAtMs = Date.parse(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return [{ status: 'failed', detail: 'manifest generatedAt is not a valid timestamp' }];
  }

  const problems: DirectoryLayoutProblem[] = [];
  if (generatedAtMs > auditNowMs) {
    problems.push({ status: 'failed', detail: 'manifest generatedAt is after audit time' });
  }

  const createdAtMs = parseOptionalTimestamp(batch.createdAt);
  if (createdAtMs !== undefined && generatedAtMs < createdAtMs) {
    problems.push({ status: 'failed', detail: 'manifest generatedAt predates batch createdAt' });
  }

  const completedAtMs = parseOptionalTimestamp(batch.completedAt);
  if (completedAtMs !== undefined && generatedAtMs < completedAtMs) {
    problems.push({ status: 'failed', detail: 'manifest generatedAt predates batch completedAt' });
  }
  return problems;
}

function parseOptionalTimestamp(value?: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function summarizeStatus(checks: AcceptanceCheck[]): AcceptanceCheckStatus {
  if (checks.some((check) => check.status === 'failed')) return 'failed';
  if (checks.some((check) => check.status === 'incomplete')) return 'incomplete';
  return 'passed';
}

export function lingxingAcceptanceAuditToMarkdown(result: LingxingAcceptanceAuditResult): string {
  return [
    '# Lingxing E2E Acceptance Audit',
    '',
    `Generated at: ${result.generatedAt}`,
    `Status: ${result.status}`,
    `Downloaded reports: ${result.downloadedCount}/${result.expectedReportTypes.length}`,
    `Failed reports: ${result.failedCount}`,
    '',
    '| Check | Status | Detail |',
    '|---|---|---|',
    ...result.checks.map((check) => `| ${check.name} | ${check.status} | ${check.detail.replace(/\|/g, '/')} |`),
    '',
  ].join('\n');
}
