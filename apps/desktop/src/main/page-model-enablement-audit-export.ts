import * as fs from 'fs';
import * as path from 'path';
import {
  downloadCenterPageModelEnablementAuditToMarkdown,
  type DownloadCenterPageModelEnablementAuditResult,
} from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import {
  copyDownloadCenterDiagnosticEvidenceFilesToBundle,
  type DownloadCenterDiagnosticEvidenceFileBundleIndex,
  type DownloadCenterDiagnosticEvidenceFileDirectories,
} from './download-center-diagnostic-evidence-files';

export interface DownloadCenterPageModelEnablementAuditBundleOptions {
  auditDir: string;
  audit: DownloadCenterPageModelEnablementAuditResult;
  model: DownloadCenterPageModel;
  diagnostic?: DownloadCenterDiagnosticResult;
  directories: DownloadCenterDiagnosticEvidenceFileDirectories;
}

export interface DownloadCenterPageModelEnablementAuditBundleResult {
  auditDir: string;
  diagnosticEvidenceFiles: DownloadCenterDiagnosticEvidenceFileBundleIndex;
}

export interface DownloadCenterPageModelEnablementBundleIndex {
  generatedAt: string;
  canDisableManualVerification: boolean;
  dateRange: { start: string; end: string };
  target?: {
    storeName?: string;
    marketplaceCode?: string;
  };
  pageModel: string;
  currentlyRequiresManualVerification: boolean;
  diagnosticId?: number;
  diagnosticEvidenceReady: boolean;
  blockedChecks: Array<{ name: string; detail: string; missing: string[] }>;
  files: Array<{ file: string; role: string; required: boolean; present: boolean }>;
}

export function writeDownloadCenterPageModelEnablementAuditBundle(
  options: DownloadCenterPageModelEnablementAuditBundleOptions,
): DownloadCenterPageModelEnablementAuditBundleResult {
  fs.mkdirSync(options.auditDir, { recursive: true });
  fs.writeFileSync(path.join(options.auditDir, 'enablement-audit.json'), `${JSON.stringify(options.audit, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(options.auditDir, 'enablement-audit.md'), downloadCenterPageModelEnablementAuditToMarkdown(options.audit), 'utf8');
  fs.writeFileSync(path.join(options.auditDir, 'active-page-model.json'), `${JSON.stringify(options.model, null, 2)}\n`, 'utf8');

  const diagnosticEvidenceFiles = options.diagnostic
    ? copyDownloadCenterDiagnosticEvidenceFilesToBundle(options.diagnostic, options.auditDir, options.directories, 'diagnostic')
    : {
      readiness: {
        ready: false,
        missing: ['diagnosticEvidence'],
        reason: options.audit.diagnosticEvidenceReadiness.reason || 'no matching diagnostic evidence was available for this enablement audit export',
      },
    };

  if (options.diagnostic) {
    fs.writeFileSync(path.join(options.auditDir, 'diagnostic.json'), `${JSON.stringify({
      ...options.diagnostic,
      copiedScreenshotPath: diagnosticEvidenceFiles.copiedScreenshotPath,
      copiedDomSnapshotPath: diagnosticEvidenceFiles.copiedDomSnapshotPath,
    }, null, 2)}\n`, 'utf8');
  }
  fs.writeFileSync(path.join(options.auditDir, 'diagnostic-evidence-files.json'), `${JSON.stringify(diagnosticEvidenceFiles, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(options.auditDir, 'enablement-bundle-index.json'),
    `${JSON.stringify(downloadCenterPageModelEnablementBundleIndex(options.audit, options.model, options.diagnostic, diagnosticEvidenceFiles, options.auditDir), null, 2)}\n`,
    'utf8',
  );

  return {
    auditDir: options.auditDir,
    diagnosticEvidenceFiles,
  };
}

export function downloadCenterPageModelEnablementBundleIndex(
  audit: DownloadCenterPageModelEnablementAuditResult,
  model: DownloadCenterPageModel,
  diagnostic: DownloadCenterDiagnosticResult | undefined,
  diagnosticEvidenceFiles: DownloadCenterDiagnosticEvidenceFileBundleIndex,
  auditDir: string,
): DownloadCenterPageModelEnablementBundleIndex {
  const files = [
    fileIndexItem(auditDir, 'enablement-audit.json', 'structured enablement audit result', true),
    fileIndexItem(auditDir, 'enablement-audit.md', 'human-readable enablement audit result', true),
    fileIndexItem(auditDir, 'active-page-model.json', 'active saved page model snapshot', true),
    fileIndexItem(auditDir, 'diagnostic-evidence-files.json', 'diagnostic evidence file readiness index', true),
    fileIndexItem(auditDir, 'diagnostic.json', 'matching persisted diagnostic snapshot', Boolean(diagnostic)),
  ];
  if (diagnosticEvidenceFiles.copiedScreenshotPath) {
    files.push(fileIndexItem(auditDir, path.basename(diagnosticEvidenceFiles.copiedScreenshotPath), 'copied diagnostic screenshot evidence', true));
  }
  if (diagnosticEvidenceFiles.copiedDomSnapshotPath) {
    files.push(fileIndexItem(auditDir, path.basename(diagnosticEvidenceFiles.copiedDomSnapshotPath), 'copied diagnostic DOM snapshot evidence', true));
  }

  return {
    generatedAt: new Date().toISOString(),
    canDisableManualVerification: audit.canDisableManualVerification,
    dateRange: audit.dateRange,
    target: audit.target,
    pageModel: model.name,
    currentlyRequiresManualVerification: model.requiresManualVerification,
    diagnosticId: diagnostic?.id,
    diagnosticEvidenceReady: diagnosticEvidenceFiles.readiness.ready,
    blockedChecks: audit.checks
      .filter((check) => check.status !== 'passed')
      .map((check) => ({
        name: check.name,
        detail: check.detail,
        missing: check.missing,
      })),
    files,
  };
}

function fileIndexItem(
  auditDir: string,
  file: string,
  role: string,
  required: boolean,
): { file: string; role: string; required: boolean; present: boolean } {
  return {
    file,
    role,
    required,
    present: fs.existsSync(path.join(auditDir, file)),
  };
}
