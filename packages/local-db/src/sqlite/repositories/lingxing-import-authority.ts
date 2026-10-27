import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { hashCanonicalMetrics, readCanonicalMetrics, } from '../migrations/0010-collection-resume-authority';
import { type LingxingCollectionAuthorityProof, type LingxingCollectionSemanticScope, type LingxingCollectionAuthorityJobRow, type ReportImportMetricEvidenceRecord } from './lingxing-import-contracts';
import { requiredText, parseRequiredJson, sameCompleteLingxingReportTypeSet } from './lingxing-import-values';
import { normalizeCollectionSemanticScope, assertCollectionAuthorityProofSemanticScope } from './lingxing-import-semantic';
import { mapCollectionCheckpoint, mapBatch, mapLingxingFile, mapRun, mapFileSnapshot, mapImportedReportFile, mapReconciliation } from './lingxing-import-records';
import { assertCollectionAuthorityJobRow, assertCollectionAuthorityProofTimestamps } from './lingxing-import-validation';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function readUniqueCollectionAuthorityProofForStoreByRequestId(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, requestId: string): LingxingCollectionAuthorityProof | undefined {
    const exactRequestId = requiredText(requestId, 'requestId');
    const read = repositoryContext.db.transaction(() => {
        const rows = repositoryContext.db.prepare(`
        SELECT
          store_id AS storeId,
          job_id AS jobId,
          request_id AS requestId,
          browser_profile_id AS browserProfileId,
          marketplace,
          currency,
          business_timezone AS businessTimezone,
          business_date AS businessDate,
          session_generation AS sessionGeneration,
          date_start AS dateStart,
          date_end AS dateEnd,
          mode,
          report_types_json AS reportTypesJson,
          state,
          snapshot_json AS snapshotJson,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt,
          blocker_code AS blockerCode,
          detail
        FROM lingxing_collection_jobs
        WHERE store_id = ? AND request_id = ?
        ORDER BY updated_at DESC, job_id DESC
        LIMIT 2
      `).all(storeId, exactRequestId) as Array<{
            storeId: StoreId;
            jobId: string;
            requestId: string;
            browserProfileId: string;
            marketplace: string;
            currency: string;
            businessTimezone: string;
            businessDate: string;
            sessionGeneration: number;
            dateStart: string;
            dateEnd: string;
            mode: string;
            reportTypesJson: string;
            state: string;
            snapshotJson: string;
            createdAt: string;
            updatedAt: string;
            completedAt: string | null;
            blockerCode: string | null;
            detail: string | null;
        }>;
        if (rows.length > 1) {
            throw new Error('同一店铺 requestId 对应多个 durable 采集任务，拒绝歧义回读。');
        }
        const row = rows[0];
        if (!row)
            return undefined;
        return repositoryContext.methods.readCollectionAuthorityProofForSelectedRow(storeId, exactRequestId, row);
    });
    return read.deferred();
}

export function inspectUniqueCollectionJobForSemanticScope(repositoryContext: LingxingImportRepositoryContext, input: LingxingCollectionSemanticScope): LingxingCollectionAuthorityProof | undefined {
    const scope = normalizeCollectionSemanticScope(input);
    const read = repositoryContext.db.transaction(() => {
        const malformedReportSet = repositoryContext.db.prepare(`
        SELECT job_id AS jobId
        FROM lingxing_collection_jobs
        WHERE store_id = ?
          AND browser_profile_id = ?
          AND marketplace = 'US'
          AND currency = 'USD'
          AND business_timezone = 'America/Los_Angeles'
          AND business_date = ?
          AND date_start = ?
          AND date_end = ?
          AND mode = ?
          AND CASE
            WHEN COALESCE(json_valid(report_types_json), 0) <> 1 THEN 1
            WHEN COALESCE(json_type(report_types_json), '') <> 'array' THEN 1
            ELSE 0
          END = 1
        ORDER BY updated_at DESC, job_id DESC
        LIMIT 1
      `).get(scope.storeId, scope.browserProfileId, scope.businessDate, scope.dateStart, scope.dateEnd, scope.mode) as {
            jobId: string;
        } | undefined;
        if (malformedReportSet) {
            throw new Error('exact semantic scope 包含损坏的 durable report-set，拒绝继续采集。');
        }
        const rows = repositoryContext.db.prepare(`
        SELECT
          store_id AS storeId,
          job_id AS jobId,
          request_id AS requestId,
          browser_profile_id AS browserProfileId,
          marketplace,
          currency,
          business_timezone AS businessTimezone,
          business_date AS businessDate,
          session_generation AS sessionGeneration,
          date_start AS dateStart,
          date_end AS dateEnd,
          mode,
          report_types_json AS reportTypesJson,
          state,
          snapshot_json AS snapshotJson,
          created_at AS createdAt,
          updated_at AS updatedAt,
          completed_at AS completedAt,
          blocker_code AS blockerCode,
          detail
        FROM lingxing_collection_jobs
        WHERE store_id = ?
          AND browser_profile_id = ?
          AND marketplace = 'US'
          AND currency = 'USD'
          AND business_timezone = 'America/Los_Angeles'
          AND business_date = ?
          AND date_start = ?
          AND date_end = ?
          AND mode = ?
        ORDER BY updated_at DESC, job_id DESC
      `).all(scope.storeId, scope.browserProfileId, scope.businessDate, scope.dateStart, scope.dateEnd, scope.mode) as LingxingCollectionAuthorityJobRow[];
        let exactProof: LingxingCollectionAuthorityProof | undefined;
        for (const row of rows) {
            const proof = repositoryContext.methods.readCollectionAuthorityProofForSelectedRow(scope.storeId, row.requestId, row);
            const rowReportTypes = parseRequiredJson<unknown>(proof.jobRow.reportTypesJson, '采集 job SQL report_types_json');
            if (!sameCompleteLingxingReportTypeSet(rowReportTypes)
                && !sameCompleteLingxingReportTypeSet(proof.job.request.reportTypes)) {
                continue;
            }
            assertCollectionAuthorityProofSemanticScope(scope, proof);
            if (exactProof) {
                throw new Error('同一 Store/Profile/businessDate/window/report-set 对应多个 durable 采集任务，拒绝歧义回读。');
            }
            exactProof = proof;
        }
        return exactProof;
    });
    return read.deferred();
}

export function readCollectionAuthorityProofForSelectedRow(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, exactRequestId: string, row: LingxingCollectionAuthorityJobRow): LingxingCollectionAuthorityProof {
    const snapshot = parseRequiredJson<LingxingCollectionJobSnapshot>(row.snapshotJson, '采集 job 快照');
    const checkpointCount = Number((repositoryContext.db.prepare(`
      SELECT COUNT(*) AS count
      FROM lingxing_collection_report_checkpoints
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, row.jobId) as {
        count: number;
    }).count);
    const checkpointRows = repositoryContext.db.prepare(`
      SELECT *
      FROM lingxing_collection_report_checkpoints
      WHERE store_id = ? AND job_id = ?
      ORDER BY report_type
      LIMIT 10
    `).all(storeId, row.jobId);
    const checkpoints = checkpointRows.map(mapCollectionCheckpoint);
    assertCollectionAuthorityJobRow(storeId, exactRequestId, row, snapshot, checkpointCount, checkpoints);
    const job: LingxingCollectionJobSnapshot = { ...snapshot, reports: checkpoints };
    const batchRow = repositoryContext.db.prepare(`
      SELECT *
      FROM lingxing_report_batches
      WHERE store_id = ? AND id = ?
    `).get(storeId, row.jobId);
    const batch = batchRow ? mapBatch(batchRow, storeId) : undefined;
    const lingxingFileCount = Number((repositoryContext.db.prepare(`
      SELECT COUNT(*) AS count
      FROM lingxing_report_files
      WHERE store_id = ? AND batch_id = ?
    `).get(storeId, row.jobId) as {
        count: number;
    }).count);
    const lingxingFiles = repositoryContext.db.prepare(`
      SELECT *
      FROM lingxing_report_files
      WHERE store_id = ? AND batch_id = ?
      ORDER BY report_type, id
      LIMIT 10
    `).all(storeId, row.jobId).map((fileRow) => mapLingxingFile(fileRow, storeId));
    const importRunCount = Number((repositoryContext.db.prepare(`
      SELECT COUNT(*) AS count
      FROM report_import_runs
      WHERE store_id = ? AND batch_id = ? AND status = 'completed'
    `).get(storeId, row.jobId) as {
        count: number;
    }).count);
    const importRuns = repositoryContext.db.prepare(`
      SELECT *
      FROM report_import_runs
      WHERE store_id = ? AND batch_id = ? AND status = 'completed'
      ORDER BY completed_at DESC, run_id DESC
      LIMIT 2
    `).all(storeId, row.jobId).map((runRow) => mapRun(runRow, storeId));
    const uniqueRun = importRunCount === 1 ? importRuns[0] : undefined;
    const importFileSnapshotCount = uniqueRun
        ? Number((repositoryContext.db.prepare(`
          SELECT COUNT(*) AS count
          FROM report_import_file_snapshots
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
        `).get(storeId, uniqueRun.runId, row.jobId) as {
            count: number;
        }).count)
        : 0;
    const importFileSnapshots = uniqueRun
        ? repositoryContext.db.prepare(`
          SELECT *
          FROM report_import_file_snapshots
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
          ORDER BY report_type, file_path, snapshot_id
          LIMIT 10
        `).all(storeId, uniqueRun.runId, row.jobId)
            .map((snapshotRow) => mapFileSnapshot(snapshotRow, storeId))
        : [];
    const importedReportFileCount = Number((repositoryContext.db.prepare(`
      SELECT COUNT(*) AS count
      FROM report_files
      WHERE store_id = ? AND batch_id = ?
    `).get(storeId, row.jobId) as {
        count: number;
    }).count);
    const importedReportFiles = repositoryContext.db.prepare(`
      SELECT *
      FROM report_files
      WHERE store_id = ? AND batch_id = ?
      ORDER BY report_type, file_path, id
      LIMIT 10
    `).all(storeId, row.jobId).map((reportFileRow) => (mapImportedReportFile(reportFileRow, storeId)));
    const reconciliationRowCount = uniqueRun
        ? Number((repositoryContext.db.prepare(`
          SELECT COUNT(*) AS count
          FROM report_import_reconciliations
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
        `).get(storeId, uniqueRun.runId, row.jobId) as {
            count: number;
        }).count)
        : 0;
    const reconciliations = uniqueRun
        ? repositoryContext.db.prepare(`
          SELECT reconciliation.*,
                 batch.date_start AS reconciliation_date_start,
                 batch.date_end AS reconciliation_date_end
          FROM report_import_reconciliations AS reconciliation
          INNER JOIN lingxing_report_batches AS batch
            ON batch.store_id = reconciliation.store_id
           AND batch.id = reconciliation.batch_id
          WHERE reconciliation.store_id = ?
            AND reconciliation.run_id = ?
            AND reconciliation.batch_id = ?
          ORDER BY reconciliation.metric_date,
                   reconciliation.report_type,
                   reconciliation.reconciliation_id
          LIMIT 10
        `).all(storeId, uniqueRun.runId, row.jobId)
            .map((reconciliationRow) => mapReconciliation(reconciliationRow, storeId))
        : [];
    const metricEvidenceCount = uniqueRun
        ? Number((repositoryContext.db.prepare(`
          SELECT COUNT(*) AS count
          FROM report_import_metric_evidence
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
        `).get(storeId, uniqueRun.runId, row.jobId) as {
            count: number;
        }).count)
        : 0;
    const metricEvidence = uniqueRun
        ? repositoryContext.db.prepare(`
          SELECT store_id AS storeId, run_id AS runId, batch_id AS batchId,
                 row_count AS rowCount, payload_sha256 AS payloadSha256,
                 created_at AS createdAt
          FROM report_import_metric_evidence
          WHERE store_id = ? AND run_id = ? AND batch_id = ?
          ORDER BY run_id
          LIMIT 2
        `).all(storeId, uniqueRun.runId, row.jobId) as ReportImportMetricEvidenceRecord[]
        : [];
    if (uniqueRun) {
        if (metricEvidenceCount !== 1 || metricEvidence.length !== 1) {
            throw new Error('唯一导入运行缺少唯一不可变指标证据，拒绝权威回读。');
        }
        const currentMetrics = readCanonicalMetrics(repositoryContext.db, storeId, row.jobId);
        const currentPayloadSha256 = hashCanonicalMetrics(currentMetrics);
        if (currentMetrics.length !== metricEvidence[0].rowCount
            || currentMetrics.length !== uniqueRun.metricRowCount
            || currentPayloadSha256 !== metricEvidence[0].payloadSha256) {
            throw new Error('当前广告指标与不可变导入证据不一致，拒绝权威回读。');
        }
    }
    const proof: LingxingCollectionAuthorityProof = {
        job,
        jobRow: {
            storeId: row.storeId,
            jobId: row.jobId,
            requestId: row.requestId,
            browserProfileId: row.browserProfileId,
            marketplace: row.marketplace,
            currency: row.currency,
            businessTimezone: row.businessTimezone,
            businessDate: row.businessDate,
            sessionGeneration: row.sessionGeneration,
            dateStart: row.dateStart,
            dateEnd: row.dateEnd,
            mode: row.mode,
            reportTypesJson: row.reportTypesJson,
            state: row.state,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            completedAt: row.completedAt,
            blockerCode: row.blockerCode,
            detail: row.detail,
        },
        checkpointCount,
        ...(batch ? { batch } : {}),
        lingxingFileCount,
        lingxingFiles,
        importRunCount,
        importRuns,
        importFileSnapshotCount,
        importFileSnapshots,
        importedReportFileCount,
        importedReportFiles,
        reconciliationRowCount,
        reconciliations,
        metricEvidenceCount,
        metricEvidence,
    };
    assertCollectionAuthorityProofTimestamps(proof);
    return proof;
}
