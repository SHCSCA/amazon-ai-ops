import * as fs from 'fs';
import * as path from 'path';
import type { LingxingReportFile } from '@amazon-ai-ops/shared-types';
import { isPathWithinRealDirectory, safeFileSegment } from './acceptance-audit-export';

export interface DownloadCenterDiagnosticEvidenceFileInput {
  screenshotPath?: string | null;
  domSnapshotPath?: string | null;
}

export interface DownloadCenterDiagnosticEvidenceFileDirectories {
  screenshotsDir: string;
  domSnapshotsDir: string;
}

export interface DownloadCenterDiagnosticEvidenceFileReadiness {
  ready: boolean;
  missing: string[];
  reason?: string;
}

export interface DownloadCenterDiagnosticEvidenceFileBundleIndex {
  sourceScreenshotPath?: string | null;
  sourceDomSnapshotPath?: string | null;
  copiedScreenshotPath?: string;
  copiedDomSnapshotPath?: string;
  readiness: DownloadCenterDiagnosticEvidenceFileReadiness;
}

export interface ReportFailureEvidenceFileDirectories {
  screenshotsDir: string;
  domSnapshotsDir: string;
  tracesDir: string;
}

export interface ReportFailureEvidenceFileCopy {
  reportType: LingxingReportFile['reportType'];
  status: LingxingReportFile['status'];
  sourceScreenshotPath?: string;
  copiedScreenshotPath?: string;
  sourceDomSnapshotPath?: string;
  copiedDomSnapshotPath?: string;
  sourceTracePath?: string;
  copiedTracePath?: string;
  traceUnavailableReason?: string;
  missing: string[];
}

export function evaluateDownloadCenterDiagnosticEvidenceFiles(
  diagnostic: DownloadCenterDiagnosticEvidenceFileInput,
  directories: DownloadCenterDiagnosticEvidenceFileDirectories,
): DownloadCenterDiagnosticEvidenceFileReadiness {
  const missing = [
    ...validateEvidenceFile('diagnosticScreenshotEvidence', diagnostic.screenshotPath, directories.screenshotsDir, new Set(['.png', '.jpg', '.jpeg'])),
    ...validateEvidenceFile('diagnosticDomSnapshotEvidence', diagnostic.domSnapshotPath, directories.domSnapshotsDir, new Set(['.html', '.htm'])),
  ];

  return {
    ready: missing.length === 0,
    missing,
    reason: missing.length > 0 ? 'matching diagnostic evidence files are missing or outside the app evidence directories' : undefined,
  };
}

export function copyDiagnosticEvidenceFileToBundle(
  sourcePath: unknown,
  bundleDir: string,
  outputName: string,
  allowedDir: string,
  allowedExtensions: Set<string>,
): string | undefined {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) return undefined;
  const resolvedPath = path.resolve(sourcePath);
  let realPath: string;
  try {
    realPath = fs.realpathSync(resolvedPath);
  } catch {
    return undefined;
  }
  if (!isPathWithinRealDirectory(realPath, allowedDir)) {
    return undefined;
  }
  const extension = path.extname(realPath);
  if (!allowedExtensions.has(extension.toLowerCase())) {
    return undefined;
  }
  if (!fs.statSync(realPath).isFile()) {
    return undefined;
  }
  const destination = path.join(bundleDir, `${outputName}${extension || '.txt'}`);
  fs.copyFileSync(realPath, destination);
  return destination;
}

export function copyDownloadCenterDiagnosticEvidenceFilesToBundle(
  diagnostic: DownloadCenterDiagnosticEvidenceFileInput,
  bundleDir: string,
  directories: DownloadCenterDiagnosticEvidenceFileDirectories,
  outputPrefix = 'diagnostic',
): DownloadCenterDiagnosticEvidenceFileBundleIndex {
  const copiedScreenshotPath = copyDiagnosticEvidenceFileToBundle(
    diagnostic.screenshotPath,
    bundleDir,
    `${outputPrefix}-screenshot`,
    directories.screenshotsDir,
    new Set(['.png', '.jpg', '.jpeg']),
  );
  const copiedDomSnapshotPath = copyDiagnosticEvidenceFileToBundle(
    diagnostic.domSnapshotPath,
    bundleDir,
    `${outputPrefix}-dom-snapshot`,
    directories.domSnapshotsDir,
    new Set(['.html', '.htm']),
  );

  return {
    sourceScreenshotPath: diagnostic.screenshotPath,
    sourceDomSnapshotPath: diagnostic.domSnapshotPath,
    copiedScreenshotPath,
    copiedDomSnapshotPath,
    readiness: evaluateDownloadCenterDiagnosticEvidenceFiles(diagnostic, directories),
  };
}

export function copyReportFailureEvidenceFilesToBundle(
  files: LingxingReportFile[],
  bundleDir: string,
  directories: ReportFailureEvidenceFileDirectories,
): ReportFailureEvidenceFileCopy[] {
  const evidenceDir = path.join(bundleDir, 'report-failure-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });

  return files
    .filter((file) => file.status === 'failed' || file.failureScreenshotPath || file.failureDomSnapshotPath || file.failureTracePath || file.traceUnavailableReason)
    .map((file) => {
      const prefix = safeFileSegment(`${file.reportType}_${file.id}`);
      const copiedScreenshotPath = copyDiagnosticEvidenceFileToBundle(
        file.failureScreenshotPath,
        evidenceDir,
        `${prefix}_screenshot`,
        directories.screenshotsDir,
        new Set(['.png', '.jpg', '.jpeg']),
      );
      const copiedDomSnapshotPath = copyDiagnosticEvidenceFileToBundle(
        file.failureDomSnapshotPath,
        evidenceDir,
        `${prefix}_dom-snapshot`,
        directories.domSnapshotsDir,
        new Set(['.html', '.htm']),
      );
      const copiedTracePath = copyDiagnosticEvidenceFileToBundle(
        file.failureTracePath,
        evidenceDir,
        `${prefix}_trace`,
        directories.tracesDir,
        new Set(['.zip']),
      );
      const missing = [
        ...missingCopiedEvidence('failureScreenshotEvidence', file.failureScreenshotPath, copiedScreenshotPath),
        ...missingCopiedEvidence('failureDomSnapshotEvidence', file.failureDomSnapshotPath, copiedDomSnapshotPath),
        ...missingTraceEvidence(file.failureTracePath, copiedTracePath, file.traceUnavailableReason),
      ];

      return {
        reportType: file.reportType,
        status: file.status,
        sourceScreenshotPath: file.failureScreenshotPath,
        copiedScreenshotPath,
        sourceDomSnapshotPath: file.failureDomSnapshotPath,
        copiedDomSnapshotPath,
        sourceTracePath: file.failureTracePath,
        copiedTracePath,
        traceUnavailableReason: file.traceUnavailableReason,
        missing,
      };
    });
}

function missingCopiedEvidence(label: string, sourcePath: string | undefined, copiedPath: string | undefined): string[] {
  if (!sourcePath) return [label];
  return copiedPath ? [] : [`${label}:copyUnavailable`];
}

function missingTraceEvidence(
  sourcePath: string | undefined,
  copiedPath: string | undefined,
  unavailableReason: string | undefined,
): string[] {
  if (sourcePath) return copiedPath ? [] : ['failureTraceEvidence:copyUnavailable'];
  return unavailableReason ? [] : ['failureTraceEvidence'];
}

function validateEvidenceFile(
  label: string,
  filePath: string | null | undefined,
  parentDir: string,
  allowedExtensions: Set<string>,
): string[] {
  if (!filePath || !filePath.trim()) {
    return [label];
  }

  const resolved = path.resolve(filePath);
  const extension = path.extname(resolved).toLowerCase();
  const missing: string[] = [];

  if (!allowedExtensions.has(extension)) {
    missing.push(`${label}:extension`);
  }
  if (!fs.existsSync(resolved)) {
    missing.push(`${label}:missingFile`);
    return missing;
  }
  if (!fs.statSync(resolved).isFile()) {
    missing.push(`${label}:notFile`);
  }
  if (!isPathWithinRealDirectory(resolved, parentDir)) {
    missing.push(`${label}:outsideAppEvidenceDir`);
  }

  return missing;
}
