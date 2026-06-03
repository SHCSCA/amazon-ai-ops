import * as fs from 'fs';
import * as path from 'path';
import { downloadCenterCollectionPreflightToMarkdown, type DownloadCenterCollectionPreflightResult } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import {
  copyDownloadCenterDiagnosticEvidenceFilesToBundle,
  type DownloadCenterDiagnosticEvidenceFileBundleIndex,
  type DownloadCenterDiagnosticEvidenceFileDirectories,
} from './download-center-diagnostic-evidence-files';

export interface LingxingCollectionPreflightEvidenceBundleOptions {
  exportDir: string;
  preflight: DownloadCenterCollectionPreflightResult;
  model: DownloadCenterPageModel;
  diagnostic?: DownloadCenterDiagnosticResult;
  directories: DownloadCenterDiagnosticEvidenceFileDirectories;
}

export interface LingxingCollectionPreflightEvidenceBundleResult {
  exportDir: string;
  diagnosticEvidenceFiles: DownloadCenterDiagnosticEvidenceFileBundleIndex;
}

export interface LingxingCollectionPreflightBundleFileIndexItem {
  file: string;
  role: string;
  required: boolean;
  present: boolean;
}

export interface LingxingCollectionPreflightBundleIndex {
  generatedAt: string;
  ready: boolean;
  dateRange: { start: string; end: string };
  pageModel: string;
  requiresManualVerification: boolean;
  diagnosticId?: number;
  diagnosticEvidenceReady: boolean;
  blockedChecks: Array<{ name: string; detail: string; missing: string[] }>;
  files: LingxingCollectionPreflightBundleFileIndexItem[];
}

export function writeLingxingCollectionPreflightEvidenceBundle(
  options: LingxingCollectionPreflightEvidenceBundleOptions,
): LingxingCollectionPreflightEvidenceBundleResult {
  fs.mkdirSync(options.exportDir, { recursive: true });
  fs.writeFileSync(path.join(options.exportDir, 'collection-preflight.json'), `${JSON.stringify(options.preflight, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(options.exportDir, 'collection-preflight.md'), downloadCenterCollectionPreflightToMarkdown(options.preflight), 'utf8');
  fs.writeFileSync(path.join(options.exportDir, 'active-page-model.json'), `${JSON.stringify(options.model, null, 2)}\n`, 'utf8');

  const diagnosticEvidenceFiles = options.diagnostic
    ? copyDownloadCenterDiagnosticEvidenceFilesToBundle(options.diagnostic, options.exportDir, options.directories, 'preflight-diagnostic')
    : {
      readiness: {
        ready: false,
        missing: ['diagnosticEvidence'],
        reason: options.preflight.diagnosticEvidenceReadiness.reason || 'no matching diagnostic evidence was available for this preflight export',
      },
    };

  if (options.diagnostic) {
    fs.writeFileSync(path.join(options.exportDir, 'diagnostic.json'), `${JSON.stringify({
      ...options.diagnostic,
      copiedScreenshotPath: diagnosticEvidenceFiles.copiedScreenshotPath,
      copiedDomSnapshotPath: diagnosticEvidenceFiles.copiedDomSnapshotPath,
    }, null, 2)}\n`, 'utf8');
  }
  fs.writeFileSync(path.join(options.exportDir, 'diagnostic-evidence-files.json'), `${JSON.stringify(diagnosticEvidenceFiles, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(options.exportDir, 'preflight-review-checklist.md'),
    lingxingCollectionPreflightReviewChecklist(options.preflight, options.model, options.diagnostic, diagnosticEvidenceFiles),
    'utf8',
  );
  fs.writeFileSync(
    path.join(options.exportDir, 'preflight-bundle-index.json'),
    `${JSON.stringify(lingxingCollectionPreflightBundleIndex(options.preflight, options.model, options.diagnostic, diagnosticEvidenceFiles, options.exportDir), null, 2)}\n`,
    'utf8',
  );

  return {
    exportDir: options.exportDir,
    diagnosticEvidenceFiles,
  };
}

export function lingxingCollectionPreflightBundleIndex(
  preflight: DownloadCenterCollectionPreflightResult,
  model: DownloadCenterPageModel,
  diagnostic: DownloadCenterDiagnosticResult | undefined,
  diagnosticEvidenceFiles: DownloadCenterDiagnosticEvidenceFileBundleIndex,
  exportDir: string,
): LingxingCollectionPreflightBundleIndex {
  const files: LingxingCollectionPreflightBundleFileIndexItem[] = [
    fileIndexItem(exportDir, 'collection-preflight.json', 'structured preflight result', true),
    fileIndexItem(exportDir, 'collection-preflight.md', 'human-readable preflight result', true),
    fileIndexItem(exportDir, 'active-page-model.json', 'active page model snapshot', true),
    fileIndexItem(exportDir, 'diagnostic-evidence-files.json', 'diagnostic evidence file readiness index', true),
    fileIndexItem(exportDir, 'preflight-review-checklist.md', 'manual preflight review checklist', true),
    fileIndexItem(exportDir, 'diagnostic.json', 'matching persisted diagnostic snapshot', Boolean(diagnostic)),
  ];
  if (diagnosticEvidenceFiles.copiedScreenshotPath) {
    files.push(fileIndexItem(exportDir, path.basename(diagnosticEvidenceFiles.copiedScreenshotPath), 'copied diagnostic screenshot evidence', true));
  }
  if (diagnosticEvidenceFiles.copiedDomSnapshotPath) {
    files.push(fileIndexItem(exportDir, path.basename(diagnosticEvidenceFiles.copiedDomSnapshotPath), 'copied diagnostic DOM snapshot evidence', true));
  }

  return {
    generatedAt: new Date().toISOString(),
    ready: preflight.ready,
    dateRange: preflight.dateRange,
    pageModel: model.name,
    requiresManualVerification: model.requiresManualVerification,
    diagnosticId: diagnostic?.id,
    diagnosticEvidenceReady: diagnosticEvidenceFiles.readiness.ready,
    blockedChecks: preflight.checks
      .filter((check) => check.status !== 'passed')
      .map((check) => ({
        name: check.name,
        detail: check.detail,
        missing: check.missing,
      })),
    files,
  };
}

export function lingxingCollectionPreflightReviewChecklist(
  preflight: DownloadCenterCollectionPreflightResult,
  model: DownloadCenterPageModel,
  diagnostic: DownloadCenterDiagnosticResult | undefined,
  diagnosticEvidenceFiles: DownloadCenterDiagnosticEvidenceFileBundleIndex,
): string {
  const blockedChecks = preflight.checks.filter((check) => check.status !== 'passed');
  return [
    '# Lingxing Collection Preflight Review Checklist',
    '',
    `Ready: ${preflight.ready ? 'yes' : 'no'}`,
    `Date range: ${preflight.dateRange.start} to ${preflight.dateRange.end}`,
    `Page model: ${model.name}`,
    `Requires manual verification: ${model.requiresManualVerification ? 'yes' : 'no'}`,
    `Matching diagnostic: ${diagnostic?.id ?? 'none'}`,
    `Diagnostic evidence files ready: ${diagnosticEvidenceFiles.readiness.ready ? 'yes' : 'no'}`,
    '',
    '## Required Review',
    '',
    '- Confirm `collection-preflight.json` and `collection-preflight.md` describe the same readiness state.',
    '- Confirm `active-page-model.json` is the model intended for the next diagnostic or collection attempt.',
    '- Confirm the selected date range matches the intended live report window.',
    '- Confirm every blocked check below is resolved before running `启动采集` or row-level `重试`.',
    '- If a diagnostic is present, compare `diagnostic.json`, the copied screenshot, and the copied DOM snapshot before trusting selector evidence.',
    '- If no diagnostic is present, run `验证页面` for this exact model and date range before collection.',
    '- Keep `requiresManualVerification` enabled until the enablement audit passes for the saved model and a fresh enabled-snapshot diagnostic exists.',
    '',
    '## Blocked Checks',
    '',
    ...(blockedChecks.length > 0
      ? blockedChecks.map((check) => `- ${check.name}: ${check.detail}${check.missing.length ? ` (missing: ${check.missing.join(', ')})` : ''}`)
      : ['- none']),
    '',
    '## Files To Inspect',
    '',
    '- `collection-preflight.json`',
    '- `collection-preflight.md`',
    '- `active-page-model.json`',
    '- `diagnostic-evidence-files.json`',
    ...(diagnostic ? [
      '- `diagnostic.json`',
      '- `preflight-diagnostic-screenshot.*` when copied',
      '- `preflight-diagnostic-dom-snapshot.*` when copied',
    ] : []),
    '',
  ].join('\n');
}

function fileIndexItem(
  exportDir: string,
  file: string,
  role: string,
  required: boolean,
): LingxingCollectionPreflightBundleFileIndexItem {
  return {
    file,
    role,
    required,
    present: fs.existsSync(path.join(exportDir, file)),
  };
}
