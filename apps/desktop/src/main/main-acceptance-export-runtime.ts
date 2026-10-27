import { validateDateRange } from './main-input-contract';
import * as path from 'path';
import * as fs from 'fs';
import { auditDownloadCenterPageModelEnablement, auditLingxingAcceptanceEvidence, buildDownloadCenterPageModelDraft, downloadCenterPageModelDraftToMarkdown, evaluateDownloadCenterCanaryEvidenceReadiness, evaluateDownloadCenterDiagnosticEvidenceReadiness, getDownloadCenterAutomationReadiness, lingxingAcceptanceAuditToMarkdown } from '@amazon-ai-ops/lingxing-report-collector';
import type { DownloadCenterDiagnosticResult, DownloadCenterPageModel } from '@amazon-ai-ops/shared-types';
import { buildDownloadedReportEvidenceIndex, isPathWithinRealDirectory, isSafeManifestPath, readLingxingManifestForAudit, safeFileSegment } from './acceptance-audit-export';
import { copyDiagnosticEvidenceFileToBundle, copyReportFailureEvidenceFilesToBundle, evaluateDownloadCenterDiagnosticEvidenceFiles } from './download-center-diagnostic-evidence-files';
import { writeDownloadCenterPageModelEnablementAuditBundle } from './page-model-enablement-audit-export';
import { loadLatestPersistedDownloadCenterDiagnosticForModel, loadPersistedDownloadCenterDiagnostic, loadPersistedLingxingBatch, loadSuccessfulCanaryReportTypesForScope } from './main-report-diagnostic-read-model-runtime';
import { authorizedLingxingCollectionTarget } from './main-business-pipeline-runtime';
import { storeCapsuleFor } from './main-store-access-runtime';
import { readDownloadCenterPageModel } from './main-download-page-model-runtime';
import { normalizeLingxingCollectionRequest } from './main-download-automation-runtime';
import { getMainRuntimeContext } from './main-runtime-access';

export function downloadCenterDiagnosticChecklist(diagnostic: DownloadCenterDiagnosticResult, readiness: ReturnType<typeof getDownloadCenterAutomationReadiness>): string {
  const mainRuntimeContext = getMainRuntimeContext();
  const missing = readiness.missing.length > 0 ? readiness.missing.join(', ') : 'none';
  return [
    '# Lingxing Download Center Diagnostic Bundle',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `App version: ${mainRuntimeContext.APP_VERSION}`,
    `Checked URL: ${diagnostic.url || 'unknown'}`,
    `Diagnostic ready: ${diagnostic.ready ? 'yes' : 'no'}`,
    `Automation ready: ${readiness.ready ? 'yes' : 'no'}`,
    `Readiness reason: ${readiness.reason || 'none'}`,
    `Missing readiness items: ${missing}`,
    '',
    '## Manual Verification Checklist',
    '',
    '- Confirm the URL is the real Lingxing download center.',
    '- Confirm all 8 report names match the live page.',
    '- Confirm start and end date fields apply the selected range before report creation.',
    '- Confirm create, status, ready-row, and download selectors each match one visible target.',
    '- Confirm ready-row, status, and download selectors are scoped by both report identity and date range.',
    '- Confirm downloaded filenames include the selected start and end date tokens.',
    '- Keep `requiresManualVerification: true` until every item above is proven from screenshot/DOM evidence.',
    '',
    '## Files',
    '',
    '- `diagnostic.json`: persisted diagnostic result.',
    '- `active-page-model.json`: page model active when the bundle was exported.',
    '- `readiness.json`: structural automation readiness result.',
    '- `selector-candidates.json`: candidate selectors found on the live page.',
    '- `action-selector-checks.json`: locator counts and usability checks for configured action selectors.',
    '- `screenshot.*`: copied diagnostic screenshot when available.',
    '- `dom-snapshot.*`: copied sanitized DOM evidence when available.',
    '',
  ].join('\n');
}

export function handleExportDownloadCenterDiagnosticBundle(diagnosticId: number): string {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!Number.isInteger(diagnosticId) || diagnosticId <= 0) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const diagnostic = loadPersistedDownloadCenterDiagnostic(diagnosticId, '', '');
  if (!diagnostic) {
    throw new Error(`未找到下载中心诊断记录：${diagnosticId}`);
  }
  const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext) throw new Error('请先选择店铺，再导出下载中心诊断。');
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  if (
    diagnostic.storeName !== authorized.target.storeName
    || diagnostic.marketplaceCode !== authorized.target.marketplaceCode
  ) {
    throw new Error('诊断记录不属于当前店铺，拒绝导出。');
  }
  const capsule = storeCapsuleFor(authorized.store);
  const model = diagnostic.pageModelSnapshot ?? readDownloadCenterPageModel();
  const readiness = getDownloadCenterAutomationReadiness(model);
  const bundleDir = path.join(capsule.evidenceDir, `download_center_diagnostic_${diagnosticId}_${Date.now()}`);
  fs.mkdirSync(bundleDir, { recursive: true });

  const screenshotCopyPath = copyDiagnosticEvidenceFileToBundle(diagnostic.screenshotPath, bundleDir, 'screenshot', capsule.screenshotsDir, new Set(['.png', '.jpg', '.jpeg']));
  const domSnapshotCopyPath = copyDiagnosticEvidenceFileToBundle(diagnostic.domSnapshotPath, bundleDir, 'dom-snapshot', capsule.evidenceDir, new Set(['.html', '.htm']));
  const bundleDiagnostic = {
    ...diagnostic,
    copiedScreenshotPath: screenshotCopyPath,
    copiedDomSnapshotPath: domSnapshotCopyPath,
  };

  fs.writeFileSync(path.join(bundleDir, 'diagnostic.json'), `${JSON.stringify(bundleDiagnostic, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'active-page-model.json'), `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'readiness.json'), `${JSON.stringify(readiness, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'selector-candidates.json'), `${JSON.stringify(diagnostic.selectorCandidates ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'action-selector-checks.json'), `${JSON.stringify(diagnostic.actionSelectorChecks ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(bundleDir, 'manual-verification-checklist.md'), downloadCenterDiagnosticChecklist(diagnostic, readiness), 'utf8');
  return bundleDir;
}

export function handleExportDownloadCenterPageModelDraft(diagnosticId: number): { exportPath: string; draft: DownloadCenterPageModel; notes: string[] } {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!Number.isInteger(diagnosticId) || diagnosticId <= 0) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const diagnostic = loadPersistedDownloadCenterDiagnostic(diagnosticId, '', '');
  if (!diagnostic) {
    throw new Error(`未找到下载中心诊断记录：${diagnosticId}`);
  }
  const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext) throw new Error('请先选择店铺，再导出页面模型草稿。');
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  if (
    diagnostic.storeName !== authorized.target.storeName
    || diagnostic.marketplaceCode !== authorized.target.marketplaceCode
  ) {
    throw new Error('诊断记录不属于当前店铺，拒绝生成页面模型草稿。');
  }
  const capsule = storeCapsuleFor(authorized.store);
  const baseModel = diagnostic.pageModelSnapshot ?? readDownloadCenterPageModel();
  const draftResult = buildDownloadCenterPageModelDraft(baseModel, diagnostic);
  const draftDir = path.join(capsule.evidenceDir, `download_center_page_model_draft_${diagnosticId}_${Date.now()}`);
  fs.mkdirSync(draftDir, { recursive: true });
  fs.writeFileSync(path.join(draftDir, 'page-model-draft.json'), `${JSON.stringify(draftResult.draft, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(draftDir, 'solidification-notes.md'), downloadCenterPageModelDraftToMarkdown(draftResult, diagnostic), 'utf8');
  fs.writeFileSync(path.join(draftDir, 'selector-candidates.json'), `${JSON.stringify(diagnostic.selectorCandidates ?? [], null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(draftDir, 'action-selector-checks.json'), `${JSON.stringify(diagnostic.actionSelectorChecks ?? [], null, 2)}\n`, 'utf8');
  return { exportPath: draftDir, draft: draftResult.draft, notes: draftResult.notes };
}

export function handleExportDownloadCenterPageModelEnablementAudit(
  input: unknown,
  diagnosticId?: number,
): { exportPath: string; canDisableManualVerification: boolean; missing: string[] } {
  const mainRuntimeContext = getMainRuntimeContext();
  const request = normalizeLingxingCollectionRequest(input);
  const dateRange = { start: request.start, end: request.end };
  const submittedContext = request.storeContext ?? mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!submittedContext) throw new Error('请先选择店铺，再导出页面模型放行审计。');
  const authorized = authorizedLingxingCollectionTarget(submittedContext);
  const target = authorized.target;
  const capsule = storeCapsuleFor(authorized.store);
  validateDateRange(dateRange);
  if (diagnosticId !== undefined && (!Number.isInteger(diagnosticId) || diagnosticId <= 0)) {
    throw new Error('下载中心诊断 ID 无效');
  }
  const model = readDownloadCenterPageModel();
  const diagnostic = diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(diagnosticId, dateRange.start, dateRange.end)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(model, dateRange.start, dateRange.end, target);
  const selectorEvidenceReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceReadiness(model, dateRange, diagnostic, { target })
    : undefined;
  const diagnosticFileReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceFiles(diagnostic, {
      screenshotsDir: capsule.screenshotsDir,
      domSnapshotsDir: capsule.evidenceDir,
    })
    : undefined;
  const diagnosticEvidenceReadiness = selectorEvidenceReadiness && diagnosticFileReadiness
    ? {
      ...selectorEvidenceReadiness,
      ready: selectorEvidenceReadiness.ready && diagnosticFileReadiness.ready,
      missing: Array.from(new Set([...selectorEvidenceReadiness.missing, ...diagnosticFileReadiness.missing])),
      reason: selectorEvidenceReadiness.ready ? diagnosticFileReadiness.reason : selectorEvidenceReadiness.reason,
    }
    : selectorEvidenceReadiness;
  const canaryReportTypes = loadSuccessfulCanaryReportTypesForScope(dateRange, target);
  const canaryEvidenceReadiness = evaluateDownloadCenterCanaryEvidenceReadiness(canaryReportTypes);
  const audit = auditDownloadCenterPageModelEnablement(model, dateRange, diagnostic, {
    target,
    diagnosticEvidenceReadiness,
    canaryEvidenceReadiness,
  });
  const auditDir = path.join(
    capsule.evidenceDir,
    `download_center_page_model_enablement_${safeFileSegment(dateRange.start)}_${safeFileSegment(dateRange.end)}_${Date.now()}`,
  );
  writeDownloadCenterPageModelEnablementAuditBundle({
    auditDir,
    audit,
    model,
    diagnostic,
    directories: {
      screenshotsDir: capsule.screenshotsDir,
      domSnapshotsDir: capsule.evidenceDir,
    },
  });
  return {
    exportPath: auditDir,
    canDisableManualVerification: audit.canDisableManualVerification,
    missing: audit.checks.flatMap((check) => check.missing),
  };
}

export function handleExportLingxingAcceptanceAudit(batchId: string, diagnosticId?: number): string {
  const mainRuntimeContext = getMainRuntimeContext();
  if (typeof batchId !== 'string' || !batchId.trim()) {
    throw new Error('领星验收审计需要有效批次 ID');
  }
  const persisted = loadPersistedLingxingBatch(batchId);
  const { batch, files } = persisted;
  const activeContext = mainRuntimeContext.state.storeCoordinator?.getActiveStoreContext();
  if (!activeContext || batch.storeId !== activeContext.storeId) {
    throw new Error('领星批次不属于当前店铺，拒绝导出验收审计。');
  }
  const authorized = authorizedLingxingCollectionTarget(activeContext);
  const target = authorized.target;
  const capsule = storeCapsuleFor(authorized.store);
  const activeModel = readDownloadCenterPageModel();
  const diagnostic = diagnosticId
    ? loadPersistedDownloadCenterDiagnostic(diagnosticId, batch.dateStart, batch.dateEnd)
    : loadLatestPersistedDownloadCenterDiagnosticForModel(activeModel, batch.dateStart, batch.dateEnd, target);
  const selectorEvidenceReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceReadiness(activeModel, { start: batch.dateStart, end: batch.dateEnd }, diagnostic, { target })
    : undefined;
  const diagnosticFileReadiness = diagnostic
    ? evaluateDownloadCenterDiagnosticEvidenceFiles(diagnostic, {
      screenshotsDir: capsule.screenshotsDir,
      domSnapshotsDir: capsule.evidenceDir,
    })
    : undefined;
  const diagnosticEvidenceReadiness = selectorEvidenceReadiness && diagnosticFileReadiness
    ? {
      ...selectorEvidenceReadiness,
      ready: selectorEvidenceReadiness.ready && diagnosticFileReadiness.ready,
      missing: Array.from(new Set([...selectorEvidenceReadiness.missing, ...diagnosticFileReadiness.missing])),
      reason: selectorEvidenceReadiness.ready ? diagnosticFileReadiness.reason : selectorEvidenceReadiness.reason,
    }
    : selectorEvidenceReadiness;
  const manifest = readLingxingManifestForAudit(batch);
  const audit = auditLingxingAcceptanceEvidence({
    batch,
    files,
    diagnostic,
    diagnosticTarget: target,
    diagnosticEvidenceReadiness,
    manifest,
    fileExists: (filePath) => {
      try {
        return isPathWithinRealDirectory(filePath, batch.downloadDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      } catch {
        return false;
      }
    },
    getFileSizeBytes: (filePath) => {
      try {
        if (!isPathWithinRealDirectory(filePath, batch.downloadDir)) return undefined;
        const stat = fs.statSync(filePath);
        return stat.isFile() ? stat.size : undefined;
      } catch {
        return undefined;
      }
    },
  });
  const auditDir = path.join(capsule.evidenceDir, `lingxing_acceptance_audit_${safeFileSegment(batch.id)}_${Date.now()}`);
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'acceptance-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'acceptance-audit.md'), lingxingAcceptanceAuditToMarkdown(audit), 'utf8');
  fs.writeFileSync(path.join(auditDir, 'filename-date-range-analysis.json'), `${JSON.stringify(audit.filenameDateRangeAnalyses, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'batch-result.json'), `${JSON.stringify({ batch, files }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(auditDir, 'downloaded-report-files.json'), `${JSON.stringify(buildDownloadedReportEvidenceIndex(batch, files), null, 2)}\n`, 'utf8');
  const failureEvidenceFiles = copyReportFailureEvidenceFilesToBundle(files, auditDir, {
    screenshotsDir: capsule.screenshotsDir,
    domSnapshotsDir: capsule.evidenceDir,
    tracesDir: capsule.tracesDir,
  });
  fs.writeFileSync(path.join(auditDir, 'report-failure-evidence-files.json'), `${JSON.stringify(failureEvidenceFiles, null, 2)}\n`, 'utf8');
  if (diagnostic) {
    const copiedScreenshotPath = copyDiagnosticEvidenceFileToBundle(diagnostic.screenshotPath, auditDir, 'diagnostic-screenshot', capsule.screenshotsDir, new Set(['.png', '.jpg', '.jpeg']));
    const copiedDomSnapshotPath = copyDiagnosticEvidenceFileToBundle(diagnostic.domSnapshotPath, auditDir, 'diagnostic-dom-snapshot', capsule.evidenceDir, new Set(['.html', '.htm']));
    fs.writeFileSync(path.join(auditDir, 'diagnostic.json'), `${JSON.stringify({
      ...diagnostic,
      copiedScreenshotPath,
      copiedDomSnapshotPath,
    }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(auditDir, 'diagnostic-evidence-files.json'), `${JSON.stringify({
      sourceScreenshotPath: diagnostic.screenshotPath,
      sourceDomSnapshotPath: diagnostic.domSnapshotPath,
      copiedScreenshotPath,
      copiedDomSnapshotPath,
      readiness: diagnosticFileReadiness,
    }, null, 2)}\n`, 'utf8');
  }
  if (batch.manifestPath && isSafeManifestPath(batch.manifestPath, batch.downloadDir)) {
    fs.copyFileSync(fs.realpathSync(batch.manifestPath), path.join(auditDir, 'manifest.json'));
  }
  return auditDir;
}
