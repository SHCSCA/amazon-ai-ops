import * as path from 'path';
import { type LingxingBatchFilesResult } from './lingxing-report-import';
import type { LingxingReportFile } from '@amazon-ai-ops/shared-types';
import type { LingxingCollectionJobSnapshot } from '@amazon-ai-ops/shared-types';
import { optionalTrimmedString } from './main-download-automation-runtime';
import { issueRendererArtifact, rendererPayload, rendererSafeDetail } from './main-artifacts-runtime';
import { projectBusinessBatchForRenderer, projectBusinessPipelineForRenderer } from './main-business-pipeline-runtime';
import type { RendererArtifactReference } from './main-runtime-contracts';

export function sanitizeLingxingImportSummaryForRenderer(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const summary = value as Record<string, unknown>;
  const finiteCount = (input: unknown) => {
    const count = Number(input);
    return Number.isFinite(count) && count >= 0 ? Math.trunc(count) : 0;
  };
  const errors = Array.isArray(summary.errors)
    ? summary.errors.map((error) => {
        const item = error && typeof error === 'object' ? error as Record<string, unknown> : {};
        return {
          reportType: optionalTrimmedString(item.reportType) || 'unknown',
          message: '导入未完成，请在当前店铺的数据采集诊断中查看详情。',
        };
      })
    : [];
  return {
    inserted: finiteCount(summary.inserted),
    parsedFiles: finiteCount(summary.parsedFiles),
    skippedFiles: finiteCount(summary.skippedFiles),
    deletedExisting: finiteCount(summary.deletedExisting),
    deduplicated: summary.deduplicated === true,
    ...(optionalTrimmedString(summary.importRunId)
      ? { importRunId: optionalTrimmedString(summary.importRunId) }
      : {}),
    ...(Array.isArray(summary.importRunIds)
      ? { importRunIds: summary.importRunIds.map(optionalTrimmedString).filter(Boolean) }
      : {}),
    errors,
  };
}

export function minimalLingxingCollectionJobForRenderer(job: LingxingCollectionJobSnapshot) {
  return {
    jobId: job.jobId,
    request: {
      requestId: job.request.requestId,
      storeContext: job.request.storeContext,
      dateStart: job.request.dateStart,
      dateEnd: job.request.dateEnd,
      mode: job.request.mode,
      reportTypes: [...job.request.reportTypes],
    },
    state: job.state,
    importState: job.importState,
    updatedAt: job.updatedAt,
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
  };
}

export function projectLingxingReportFileForRenderer(storeId: string, file: LingxingReportFile) {
  const fileArtifact = issueRendererArtifact(
    storeId,
    file.filePath,
    'report-file',
    file.filePath ? path.basename(file.filePath) : file.displayName,
  );
  const folderArtifact = issueRendererArtifact(
    storeId,
    file.filePath ? path.dirname(file.filePath) : undefined,
    'report-folder',
    '原始报表目录',
  );
  const failureArtifacts = [
    issueRendererArtifact(storeId, file.failureScreenshotPath, 'diagnostic-file', '失败截图'),
    issueRendererArtifact(storeId, file.failureDomSnapshotPath, 'diagnostic-file', '失败页面快照'),
    issueRendererArtifact(storeId, file.failureTracePath, 'diagnostic-file', '失败 Trace'),
  ].filter((item): item is RendererArtifactReference => Boolean(item));
  return {
    id: file.id,
    ...(file.batchId ? { batchId: file.batchId } : {}),
    reportType: file.reportType,
    displayName: file.displayName,
    status: file.status,
    maxAutoRetries: Number(file.maxAutoRetries || 0),
    autoRetryCount: Number(file.autoRetryCount || 0),
    fileName: file.filePath ? path.basename(file.filePath) : '',
    fileExtension: file.filePath ? path.extname(file.filePath).toLowerCase() : '',
    fileSizeBytes: Number(file.fileSizeBytes || 0),
    ...(file.errorMessage ? { errorMessage: rendererSafeDetail(file.errorMessage) } : {}),
    ...(file.traceUnavailableReason ? { traceUnavailableReason: String(file.traceUnavailableReason) } : {}),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    ...(fileArtifact ? {
      artifactId: fileArtifact.artifactId,
      artifactDisplayName: fileArtifact.displayName,
    } : {}),
    ...(folderArtifact ? {
      folderArtifactId: folderArtifact.artifactId,
      folderDisplayName: folderArtifact.displayName,
    } : {}),
    ...(failureArtifacts.length > 0 ? { failureArtifacts } : {}),
  };
}

export function projectLingxingCollectionResultForRenderer(result: LingxingBatchFilesResult & { job?: LingxingCollectionJobSnapshot }, importSummary?: unknown) {
  const storeId = String(result.batch.storeId || result.job?.request.storeContext.storeId || '');
  if (!storeId) throw new Error('领星采集结果缺少当前店铺权威。');
  return rendererPayload({
    batch: projectBusinessBatchForRenderer(storeId, result.batch),
    files: result.files.map((file) => projectLingxingReportFileForRenderer(storeId, file)),
    ...(result.job ? { job: result.job } : {}),
    ...(importSummary === undefined ? {} : { metricsImport: sanitizeLingxingImportSummaryForRenderer(importSummary) }),
  });
}

export function projectBusinessImportResultForRenderer(result: any) {
  const pipeline = projectBusinessPipelineForRenderer(result.pipeline);
  const storeId = String(pipeline?.scope?.storeId || pipeline?.scope?.storeContext?.storeId || '');
  return rendererPayload({
    cancelled: result.cancelled === true,
    ...(result.batch ? { batch: projectBusinessBatchForRenderer(storeId, result.batch) } : {}),
    files: Array.isArray(result.files)
      ? result.files.map((file: LingxingReportFile) => projectLingxingReportFileForRenderer(storeId, file))
      : [],
    metricsImport: sanitizeLingxingImportSummaryForRenderer(result.metricsImport),
    pipeline,
  });
}
