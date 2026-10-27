import {
  type LingxingCollectionJobSnapshot,
  type LingxingReportType,
} from '@amazon-ai-ops/shared-types';
import {
  type LingxingCollectionAuthorityProof,
} from '@amazon-ai-ops/local-db';
import {
  FULL_REPORT_TYPES,
  SHA256,
  FULL_REPORT_TYPE_SET,
} from "./collection-scheduler-constants";
import {
  type StoreCollectionDurableProofScope,
} from "./collection-scheduler-contracts";
import {
  orderedIsoInstants,
} from "./collection-scheduler-durable-proof";
import {
  sameFullReportSet,
  requiredNonBlank,
  isIsoInstant,
} from "./collection-scheduler-values";

export function downloadProofExact(
  proof: LingxingCollectionAuthorityProof,
  authorized: StoreCollectionDurableProofScope,
): boolean {
  if (!proof.batch
    || !batchIdentityExact(proof.batch, proof.job, authorized, 'completed')
    || proof.checkpointCount !== FULL_REPORT_TYPES.length
    || proof.job.reports.length !== FULL_REPORT_TYPES.length
    || proof.lingxingFileCount !== FULL_REPORT_TYPES.length
    || proof.lingxingFiles.length !== FULL_REPORT_TYPES.length
    || !sameFullReportSet(proof.job.reports.map((checkpoint) => checkpoint.reportType))
    || !sameFullReportSet(proof.lingxingFiles.map((file) => file.reportType))) {
    return false;
  }
  const filesByType = new Map(proof.lingxingFiles.map((file) => [file.reportType, file]));
  return proof.job.reports.every((checkpoint) => {
    const identity = checkpoint.createdReportIdentity;
    const file = filesByType.get(checkpoint.reportType);
    return checkpoint.state === 'downloaded'
      && Number.isFinite(checkpoint.fileSizeBytes)
      && checkpoint.fileSizeBytes! > 0
      && Boolean(identity)
      && identity!.provider === 'lingxing'
      && identity!.reportType === checkpoint.reportType
      && identity!.dateStart === authorized.dateStart
      && identity!.dateEnd === authorized.dateEnd
      && requiredNonBlank(identity!.externalReportName)
      && isIsoInstant(identity!.createdAt)
      && Boolean(file)
      && file!.storeId === authorized.context.storeId
      && file!.batchId === proof.job.jobId
      && file!.status === 'downloaded'
      && requiredNonBlank(file!.filePath)
      && Number.isFinite(file!.fileSizeBytes)
      && file!.fileSizeBytes! > 0
      && file!.fileSizeBytes === checkpoint.fileSizeBytes;
  });
}

export function succeededImportProofExact(
  proof: LingxingCollectionAuthorityProof,
  authorized: StoreCollectionDurableProofScope,
): boolean {
  if (!downloadProofExact(proof, authorized)
    || proof.importRunCount !== 1
    || proof.importRuns.length !== 1
    || proof.metricEvidenceCount !== 1
    || proof.metricEvidence.length !== 1
    || proof.importFileSnapshotCount !== FULL_REPORT_TYPES.length
    || proof.importFileSnapshots.length !== FULL_REPORT_TYPES.length
    || proof.importedReportFileCount !== FULL_REPORT_TYPES.length
    || proof.importedReportFiles.length !== FULL_REPORT_TYPES.length
    || proof.reconciliationRowCount !== FULL_REPORT_TYPES.length
    || proof.reconciliations.length !== FULL_REPORT_TYPES.length
    || !sameFullReportSet(proof.importFileSnapshots.map((row) => row.reportType as LingxingReportType))
    || !sameFullReportSet(proof.importedReportFiles.map((row) => row.reportType as LingxingReportType))
    || !sameFullReportSet(proof.reconciliations.map((row) => row.reportType as LingxingReportType))) {
    return false;
  }
  const run = proof.importRuns[0]!;
  const metricEvidence = proof.metricEvidence[0]!;
  const importedMetricRowCount = proof.importFileSnapshots.reduce(
    (total, snapshot) => total + snapshot.importedRows,
    0,
  );
  if (run.storeId !== authorized.context.storeId
    || run.batchId !== proof.job.jobId
    || run.status !== 'completed'
    || run.sourceFileCount !== FULL_REPORT_TYPES.length
    || run.reconciliationCount !== FULL_REPORT_TYPES.length
    || !Number.isSafeInteger(run.metricRowCount)
    || run.metricRowCount < 0
    || !Number.isSafeInteger(importedMetricRowCount)
    || run.metricRowCount !== importedMetricRowCount
    || metricEvidence.storeId !== authorized.context.storeId
    || metricEvidence.runId !== run.runId
    || metricEvidence.batchId !== proof.job.jobId
    || metricEvidence.rowCount !== run.metricRowCount
    || !SHA256.test(metricEvidence.payloadSha256)
    || !isIsoInstant(metricEvidence.createdAt)
    || !orderedIsoInstants(run.startedAt, metricEvidence.createdAt)
    // 新提交绑定完成时间，旧回填绑定创建时间，两者均不得晚于真实提交边界。
    || !orderedIsoInstants(metricEvidence.createdAt, run.createdAt)
    || !requiredNonBlank(run.runId)
    || !requiredNonBlank(run.idempotencyKey)
    || !SHA256.test(run.inputFingerprint)
    || !isIsoInstant(run.startedAt)
    || !isIsoInstant(run.completedAt)
    || !isIsoInstant(run.createdAt)) {
    return false;
  }
  const liveByType = new Map(proof.lingxingFiles.map((row) => [row.reportType, row]));
  const importedByType = new Map(
    proof.importedReportFiles.map((row) => [row.reportType, row]),
  );
  const reconciliationByType = new Map(
    proof.reconciliations.map((row) => [row.reportType, row]),
  );
  return proof.importFileSnapshots.every((snapshot) => {
    const reportType = snapshot.reportType as LingxingReportType;
    const live = liveByType.get(reportType);
    const imported = importedByType.get(reportType);
    const reconciliation = reconciliationByType.get(reportType);
    const reconciliationDelta = reconciliation
      ? Math.abs(reconciliation.expectedCost - reconciliation.actualCost)
      : Number.NaN;
    return snapshot.storeId === authorized.context.storeId
      && snapshot.runId === run.runId
      && snapshot.batchId === proof.job.jobId
      && requiredNonBlank(snapshot.snapshotId)
      && requiredNonBlank(snapshot.filePath)
      && requiredNonBlank(snapshot.fileName)
      && Number.isInteger(snapshot.fileSizeBytes)
      && snapshot.fileSizeBytes > 0
      && SHA256.test(snapshot.fileHash)
      && Number.isSafeInteger(snapshot.importedRows)
      && snapshot.importedRows >= 0
      && isIsoInstant(snapshot.capturedAt)
      && Boolean(live)
      && snapshot.lingxingFileId === live!.id
      && snapshot.filePath === live!.filePath
      && snapshot.fileName === portablePathBasename(live!.filePath!)
      && snapshot.fileSizeBytes === live!.fileSizeBytes
      && Boolean(imported)
      && snapshot.reportFileId === imported!.id
      && imported!.storeId === authorized.context.storeId
      && imported!.batchId === proof.job.jobId
      && imported!.status === 'imported'
      && requiredNonBlank(imported!.filePath)
      && requiredNonBlank(imported!.fileName)
      && Number.isInteger(imported!.fileSizeBytes)
      && imported!.fileSizeBytes > 0
      && imported!.fileHash !== undefined
      && SHA256.test(imported!.fileHash)
      && imported!.fileHash === snapshot.fileHash
      && imported!.filePath === snapshot.filePath
      && imported!.fileName === snapshot.fileName
      && imported!.fileSizeBytes === snapshot.fileSizeBytes
      && imported!.importedRows === snapshot.importedRows
      && isIsoInstant(imported!.lastImportedAt)
      && !imported!.importError
      && Boolean(reconciliation)
      && reconciliation!.storeId === authorized.context.storeId
      && reconciliation!.runId === run.runId
      && reconciliation!.batchId === proof.job.jobId
      && requiredNonBlank(reconciliation!.reconciliationId)
      && reconciliation!.currency === 'USD'
      && reconciliation!.dateStart === authorized.dateStart
      && reconciliation!.dateEnd === authorized.dateEnd
      && reconciliation!.metricDate === authorized.dateEnd
      && Number.isSafeInteger(reconciliation!.expectedRows)
      && reconciliation!.expectedRows >= 0
      && reconciliation!.expectedRows === reconciliation!.actualRows
      && reconciliation!.expectedRows === snapshot.importedRows
      && reconciliation!.actualRows === snapshot.importedRows
      && Number.isFinite(reconciliation!.expectedCost)
      && reconciliation!.expectedCost >= 0
      && Number.isFinite(reconciliation!.actualCost)
      && reconciliation!.actualCost >= 0
      && Number.isFinite(reconciliation!.absoluteCostDelta)
      && reconciliation!.absoluteCostDelta >= 0
      && Number.isFinite(reconciliation!.tolerance)
      && reconciliation!.tolerance >= 0
      && reconciliation!.withinTolerance
      && reconciliation!.status === 'matched'
      && Math.abs(reconciliation!.absoluteCostDelta - reconciliationDelta) <= 1e-9
      && reconciliationDelta <= reconciliation!.tolerance + 1e-9
      && isIsoInstant(reconciliation!.reconciledAt);
  });
}

export function portablePathBasename(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function noCompletedImportProof(proof: LingxingCollectionAuthorityProof): boolean {
  return proof.importRunCount === 0
    && proof.importRuns.length === 0
    && proof.importFileSnapshotCount === 0
    && proof.importFileSnapshots.length === 0
    && proof.importedReportFileCount === 0
    && proof.importedReportFiles.length === 0
    && proof.reconciliationRowCount === 0
    && proof.reconciliations.length === 0
    && proof.metricEvidenceCount === 0
    && proof.metricEvidence.length === 0;
}

export function batchIdentityExact(
  batch: NonNullable<LingxingCollectionAuthorityProof['batch']>,
  job: LingxingCollectionJobSnapshot,
  authorized: StoreCollectionDurableProofScope,
  expectedStatus: NonNullable<LingxingCollectionAuthorityProof['batch']>['status'],
): boolean {
  return batch.id === job.jobId
    && batch.storeId === authorized.context.storeId
    && batch.requestId === authorized.requestId
    && batch.browserProfileId === authorized.context.browserProfileId
    && batch.businessDate === authorized.context.businessDate
    && batch.sessionGeneration === authorized.context.sessionGeneration
    && batch.marketplaceCode === 'US'
    && batch.dateStart === authorized.dateStart
    && batch.dateEnd === authorized.dateEnd
    && batch.status === expectedStatus
    && requiredNonBlank(batch.downloadDir)
    && isIsoInstant(batch.createdAt)
    && (expectedStatus === 'pending'
      || expectedStatus === 'running'
      ? batch.completedAt === undefined
      : isIsoInstant(batch.completedAt));
}

export function uniqueReportSubset(values: readonly LingxingReportType[]): boolean {
  return values.length <= FULL_REPORT_TYPES.length
    && new Set(values).size === values.length
    && values.every((value) => FULL_REPORT_TYPE_SET.has(value));
}
