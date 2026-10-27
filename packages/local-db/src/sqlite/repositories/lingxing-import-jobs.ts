import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { requiredText, canonicalUtcInstant, requiredSha256, parseRequiredJson, boundedPositiveInteger } from './lingxing-import-values';
import { normalizeCollectionJobSnapshot, cancelledCollectionJobSnapshot } from './lingxing-import-validation';
import { type CollectionImportRecoveryCasToken, type CompleteRecoveredCollectionImportInput, type LingxingCollectionAuthorityProof, type CancelCollectionJobOptions, type RecoverInterruptedCollectionJobsOptions, type ListRecoverableCollectionImportsOptions, type CollectionImportRecoveryPage } from './lingxing-import-contracts';
import { fingerprintLingxingCollectionAuthorityProof } from './lingxing-import-fingerprints';
import { mapCollectionCheckpoint } from './lingxing-import-records';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function upsertCollectionProgressForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, event: LingxingCollectionProgressEvent): LingxingCollectionJobSnapshot {
    requiredText(event.eventId, 'eventId');
    requiredText(event.emittedAt, 'emittedAt');
    return repositoryContext.methods.upsertCollectionJobSnapshotForStore(storeId, event.job, {
        eventId: event.eventId,
        emittedAt: event.emittedAt,
    });
}

export function upsertCollectionJobSnapshotForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, snapshot: LingxingCollectionJobSnapshot, event?: {
    eventId: string;
    emittedAt: string;
}): LingxingCollectionJobSnapshot {
    snapshot = normalizeCollectionJobSnapshot(snapshot);
    const persist = repositoryContext.db.transaction(() => (repositoryContext.methods.persistCollectionJobSnapshotRows(storeId, snapshot, event)));
    return persist.immediate();
}

export function completeRecoveredCollectionImportForStore(repositoryContext: LingxingImportRepositoryContext, token: CollectionImportRecoveryCasToken, input: CompleteRecoveredCollectionImportInput): LingxingCollectionJobSnapshot {
    const storeId = requiredText(token.storeId, 'recovery token.storeId') as StoreId;
    const jobId = requiredText(token.jobId, 'recovery token.jobId');
    const requestId = requiredText(token.requestId, 'recovery token.requestId');
    const expectedJobUpdatedAt = canonicalUtcInstant(token.expectedJobUpdatedAt, 'recovery token.expectedJobUpdatedAt');
    const expectedRunId = requiredText(token.expectedRunId, 'recovery token.expectedRunId');
    const expectedAuthorityProofSha256 = requiredSha256(token.expectedAuthorityProofSha256, 'recovery token.expectedAuthorityProofSha256');
    if (token.expectedImportState !== 'pending' && token.expectedImportState !== 'failed') {
        throw new Error('COLLECTION_IMPORT_RECOVERY_CAS_INVALID: expectedImportState 必须是 pending/failed。');
    }
    const attemptedAt = canonicalUtcInstant(input.attemptedAt, 'recovery attemptedAt');
    const completedAt = canonicalUtcInstant(input.completedAt, 'recovery completedAt');
    const complete = repositoryContext.db.transaction(() => {
        let proof: LingxingCollectionAuthorityProof | undefined;
        try {
            proof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, requestId);
        }
        catch (error) {
            throw new Error(`COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT: authority proof 无法唯一重读：${error instanceof Error ? error.message : String(error)}`);
        }
        const uniqueRun = proof?.importRunCount === 1 && proof.importRuns.length === 1
            ? proof.importRuns[0]
            : undefined;
        if (!proof
            || proof.job.jobId !== jobId
            || proof.job.updatedAt !== expectedJobUpdatedAt
            || proof.job.state !== 'completed'
            || proof.job.importState !== token.expectedImportState
            || uniqueRun?.runId !== expectedRunId
            || fingerprintLingxingCollectionAuthorityProof(proof) !== expectedAuthorityProofSha256) {
            throw new Error('COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT: job 或 immutable import authority proof 已漂移。');
        }
        if (!proof.job.completedAt
            || !proof.job.importAttemptedAt
            || proof.job.importAttemptedAt !== attemptedAt
            || Date.parse(proof.job.completedAt) > Date.parse(attemptedAt)
            || Date.parse(uniqueRun.startedAt) < Date.parse(attemptedAt)
            || Date.parse(uniqueRun.completedAt) > Date.parse(completedAt)
            || Date.parse(uniqueRun.createdAt) > Date.parse(completedAt)
            || Date.parse(proof.job.updatedAt) >= Date.parse(completedAt)) {
            throw new Error('COLLECTION_IMPORT_RECOVERY_CAS_INVALID: recovery succeeded 时间线无效。');
        }
        const { importState: _importState, importAttemptedAt: _importAttemptedAt, importCompletedAt: _importCompletedAt, importError: _importError, ...base } = proof.job;
        const next: LingxingCollectionJobSnapshot = {
            ...base,
            importState: 'succeeded',
            importAttemptedAt: attemptedAt,
            importCompletedAt: completedAt,
            updatedAt: completedAt,
        };
        const saved = repositoryContext.methods.persistCollectionJobSnapshotRows(storeId, next, {
            eventId: `${jobId}:import-recovery:succeeded`,
            emittedAt: completedAt,
        });
        const finalProof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, requestId);
        if (!finalProof || finalProof.job.jobId !== jobId) {
            throw new Error('COLLECTION_IMPORT_RECOVERY_CAS_CONFLICT: succeeded proof 无法回读。');
        }
        repositoryContext.methods.appendRecoveredSucceededResumeReceiptIfNeeded(storeId, finalProof, completedAt, expectedJobUpdatedAt);
        return saved;
    });
    return complete.immediate();
}

export function cancelCollectionJobForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, jobId: string, options: CancelCollectionJobOptions): LingxingCollectionJobSnapshot {
    const expectedRequestId = requiredText(options.requestId, 'requestId');
    const cancel = repositoryContext.db.transaction(() => {
        const current = repositoryContext.methods.getCollectionJobForStore(storeId, jobId);
        if (!current || current.request.requestId !== expectedRequestId) {
            throw new Error('取消采集的 jobId 与 requestId 未绑定到当前店铺同一任务。');
        }
        if (current.state === 'cancelled')
            return current;
        if (current.state !== 'queued' && current.state !== 'running') {
            throw new Error(`任务 ${jobId} 已进入 ${current.state}，不能再取消。`);
        }
        return repositoryContext.methods.persistCollectionJobSnapshotRows(storeId, cancelledCollectionJobSnapshot(current, {
            completedAt: options.completedAt,
            blockerCode: options.blockerCode ?? 'LINGXING_COLLECTION_CANCELLED_BY_OPERATOR',
            detail: options.detail ?? '运营者已取消本次领星采集。',
        }));
    });
    return cancel.immediate();
}

export function recoverInterruptedCollectionJobsForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, options: RecoverInterruptedCollectionJobsOptions = {}): LingxingCollectionJobSnapshot[] {
    const recover = repositoryContext.db.transaction(() => {
        const rows = repositoryContext.db.prepare(`
        SELECT job_id AS jobId
        FROM lingxing_collection_jobs AS jobs
        WHERE jobs.store_id = ? AND jobs.state IN ('queued', 'running')
          AND NOT EXISTS (
            SELECT 1
            FROM lingxing_collection_resume_active_claims AS claims
            WHERE claims.store_id = jobs.store_id
              AND claims.job_id = jobs.job_id
          )
        ORDER BY jobs.updated_at ASC, jobs.job_id ASC
      `).all(storeId) as Array<{
            jobId: string;
        }>;
        return rows.map(({ jobId }) => {
            const current = repositoryContext.methods.getCollectionJobForStore(storeId, jobId);
            if (!current || (current.state !== 'queued' && current.state !== 'running')) {
                throw new Error(`重启恢复时无法读取非终态采集任务 ${jobId}。`);
            }
            return repositoryContext.methods.persistCollectionJobSnapshotRows(storeId, cancelledCollectionJobSnapshot(current, {
                completedAt: options.completedAt,
                blockerCode: options.blockerCode ?? 'LINGXING_COLLECTION_INTERRUPTED_BY_RESTART',
                detail: options.detail ?? '应用重启前采集未形成终态，已安全收口为取消；可由运营者重新发起。',
            }));
        });
    });
    return recover.immediate();
}

export function getCollectionJobForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, jobId: string): LingxingCollectionJobSnapshot | undefined {
    const row = repositoryContext.db.prepare(`
      SELECT snapshot_json AS snapshotJson
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, jobId) as {
        snapshotJson: string;
    } | undefined;
    if (!row)
        return undefined;
    const snapshot = parseRequiredJson<LingxingCollectionJobSnapshot>(row.snapshotJson, '采集 job 快照');
    const reports = repositoryContext.db.prepare(`
      SELECT * FROM lingxing_collection_report_checkpoints
      WHERE store_id = ? AND job_id = ?
      ORDER BY report_type
    `).all(storeId, jobId).map(mapCollectionCheckpoint);
    return { ...snapshot, reports };
}

export function listCollectionJobsForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, limit = 100): LingxingCollectionJobSnapshot[] {
    const boundedLimit = boundedPositiveInteger(limit, 100, 1000);
    const rows = repositoryContext.db.prepare(`
      SELECT job_id AS jobId
      FROM lingxing_collection_jobs
      WHERE store_id = ?
      ORDER BY updated_at DESC, job_id DESC
      LIMIT ?
    `).all(storeId, boundedLimit) as Array<{
        jobId: string;
    }>;
    return rows
        .map((row) => repositoryContext.methods.getCollectionJobForStore(storeId, row.jobId))
        .filter((job): job is LingxingCollectionJobSnapshot => Boolean(job));
}

export function findUniqueCollectionJobForStoreByRequestId(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, requestId: string): LingxingCollectionJobSnapshot | undefined {
    return repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, requestId)?.job;
}

export function listRecoverableCollectionImportsForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, options: ListRecoverableCollectionImportsOptions = {}): CollectionImportRecoveryPage {
    const limit = boundedPositiveInteger(options.limit ?? 50, 50, 200);
    const importStates = [...new Set(options.importStates ?? ['pending', 'failed'])];
    if (importStates.length === 0
        || importStates.some((state) => state !== 'pending' && state !== 'failed')) {
        throw new Error('恢复查询仅接受 pending/failed 导入状态。');
    }
    const cursor = options.cursor
        ? {
            updatedAt: requiredText(options.cursor.updatedAt, 'recovery cursor.updatedAt'),
            jobId: requiredText(options.cursor.jobId, 'recovery cursor.jobId'),
        }
        : undefined;
    const statePlaceholders = importStates.map(() => '?').join(', ');
    const cursorClause = cursor
        ? `AND (jobs.updated_at < ? OR (jobs.updated_at = ? AND jobs.job_id < ?))`
        : '';
    const params: unknown[] = [storeId, ...importStates];
    if (cursor)
        params.push(cursor.updatedAt, cursor.updatedAt, cursor.jobId);
    params.push(limit + 1);
    const rows = repositoryContext.db.prepare(`
      SELECT jobs.job_id AS jobId, jobs.updated_at AS updatedAt
      FROM lingxing_collection_jobs jobs
      WHERE jobs.store_id = ?
        AND jobs.state IN ('completed', 'completed_with_errors')
        AND jobs.request_id NOT LIKE 'canary:%'
        AND json_extract(jobs.snapshot_json, '$.importState') IN (${statePlaceholders})
        AND EXISTS (
          SELECT 1
          FROM lingxing_collection_report_checkpoints checkpoints
          INNER JOIN lingxing_report_files files
            ON files.store_id = checkpoints.store_id
           AND files.batch_id = checkpoints.job_id
           AND files.report_type = checkpoints.report_type
          WHERE checkpoints.store_id = jobs.store_id
            AND checkpoints.job_id = jobs.job_id
            AND checkpoints.state = 'downloaded'
            AND files.status = 'downloaded'
            AND files.file_path IS NOT NULL
            AND TRIM(files.file_path) <> ''
            AND COALESCE(files.file_size_bytes, 0) > 0
        )
        ${cursorClause}
      ORDER BY jobs.updated_at DESC, jobs.job_id DESC
      LIMIT ?
    `).all(...params) as Array<{
        jobId: string;
        updatedAt: string;
    }>;
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const jobs = pageRows.map((row) => {
        const job = repositoryContext.methods.getCollectionJobForStore(storeId, row.jobId);
        if (!job)
            throw new Error(`恢复候选任务 ${row.jobId} 无法按店铺回读。`);
        return job;
    });
    const last = pageRows.at(-1);
    return {
        jobs,
        ...(hasMore && last ? {
            nextCursor: { updatedAt: last.updatedAt, jobId: last.jobId },
        } : {}),
    };
}
