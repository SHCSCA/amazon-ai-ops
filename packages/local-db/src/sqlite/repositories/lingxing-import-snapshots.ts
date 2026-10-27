import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type LingxingCollectionSnapshotInput, type StoreScopedLingxingReportBatch, type StoreScopedLingxingReportFile, type CommitCollectionTerminalInput, type CollectionTerminalCommitResult, type StoreAuthority } from './lingxing-import-contracts';
import { normalizeCollectionJobSnapshot, validateCollectionTerminalIdentity, validateCollectionJobSnapshot, validateCollectionLineage } from './lingxing-import-validation';
import { mapBatch, mapLingxingFile } from './lingxing-import-records';
import { parseRequiredJson, stableJson } from './lingxing-import-values';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function saveCollectionSnapshotForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: LingxingCollectionSnapshotInput): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
} {
    const save = repositoryContext.db.transaction(() => {
        const authority = repositoryContext.methods.getWritableStoreAuthority(storeId);
        return repositoryContext.methods.persistCollectionSnapshotRows(storeId, authority, input);
    });
    return save.immediate();
}

export function commitCollectionTerminalForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: CommitCollectionTerminalInput): CollectionTerminalCommitResult {
    const job = normalizeCollectionJobSnapshot(input.job);
    const commit = repositoryContext.db.transaction(() => {
        const authority = repositoryContext.methods.getStoreAuthority(storeId);
        const existing = repositoryContext.methods.getCollectionJobForStore(storeId, job.jobId);
        if (existing?.state === 'cancelled' && job.state !== 'cancelled') {
            throw new Error(`采集 job ${job.jobId} 已持久化取消终态，拒绝覆盖为 ${job.state}。`);
        }
        validateCollectionTerminalIdentity(storeId, authority, job, input.batch, input.files);
        const savedJob = repositoryContext.methods.persistCollectionJobSnapshotRows(storeId, job);
        const savedCollection = repositoryContext.methods.persistCollectionSnapshotRows(storeId, authority, {
            batch: input.batch,
            files: input.files,
        });
        return {
            job: savedJob,
            batch: savedCollection.batch,
            files: savedCollection.files,
        };
    });
    return commit.immediate();
}

export function getCollectionSnapshotForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, batchId: string): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
} | undefined {
    const batch = repositoryContext.db.prepare(`
      SELECT * FROM lingxing_report_batches
      WHERE store_id = ? AND id = ?
    `).get(storeId, batchId);
    if (!batch)
        return undefined;
    const files = repositoryContext.db.prepare(`
      SELECT * FROM lingxing_report_files
      WHERE store_id = ? AND batch_id = ?
      ORDER BY report_type, id
    `).all(storeId, batchId);
    return {
        batch: mapBatch(batch, storeId),
        files: files.map((row) => mapLingxingFile(row, storeId)),
    };
}

export function persistCollectionJobSnapshotRows(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, snapshot: LingxingCollectionJobSnapshot, event?: {
    eventId: string;
    emittedAt: string;
}): LingxingCollectionJobSnapshot {
    const authority = repositoryContext.methods.getStoreAuthority(storeId);
    validateCollectionJobSnapshot(storeId, authority, snapshot);
    validateCollectionLineage(repositoryContext.db, storeId, snapshot);
    const existing = repositoryContext.db.prepare(`
      SELECT request_id AS requestId, browser_profile_id AS browserProfileId,
             session_generation AS sessionGeneration, date_start AS dateStart,
             date_end AS dateEnd, mode, report_types_json AS reportTypesJson,
             snapshot_json AS snapshotJson, updated_at AS updatedAt
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, snapshot.jobId) as {
        requestId: string;
        browserProfileId: string;
        sessionGeneration: number;
        dateStart: string;
        dateEnd: string;
        mode: string;
        reportTypesJson: string;
        snapshotJson: string;
        updatedAt: string;
    } | undefined;
    const reportTypesJson = JSON.stringify(snapshot.request.reportTypes);
    const existingSnapshot = existing
        ? parseRequiredJson<LingxingCollectionJobSnapshot>(existing.snapshotJson, '既有采集 job 快照')
        : undefined;
    if (existing && (existing.requestId !== snapshot.request.requestId
        || existing.browserProfileId !== String(snapshot.request.storeContext.browserProfileId)
        || existing.sessionGeneration !== Number(snapshot.request.storeContext.sessionGeneration)
        || existing.dateStart !== snapshot.request.dateStart
        || existing.dateEnd !== snapshot.request.dateEnd
        || existing.mode !== snapshot.request.mode
        || existing.reportTypesJson !== reportTypesJson
        || (existingSnapshot?.lineage !== undefined
            && stableJson(existingSnapshot.lineage) !== stableJson(snapshot.lineage)))) {
        throw new Error('采集 jobId 已绑定不同的店铺权威请求，拒绝覆盖。');
    }
    if (existingSnapshot?.state === 'cancelled' && snapshot.state !== 'cancelled') {
        const durableCancelled = repositoryContext.methods.getCollectionJobForStore(storeId, snapshot.jobId);
        if (!durableCancelled)
            throw new Error('已取消采集任务无法按店铺回读。');
        return durableCancelled;
    }
    if (existing && existingSnapshot?.state === 'cancelled' && snapshot.state === 'cancelled'
        && existing.updatedAt >= snapshot.updatedAt) {
        const durableCancelled = repositoryContext.methods.getCollectionJobForStore(storeId, snapshot.jobId);
        if (!durableCancelled)
            throw new Error('已取消采集任务无法按店铺回读。');
        return durableCancelled;
    }
    const snapshotJson = stableJson(snapshot);
    if (existing && existing.updatedAt > snapshot.updatedAt) {
        throw new Error('采集进度快照早于已持久化状态，拒绝回退。');
    }
    if (existing && existing.updatedAt === snapshot.updatedAt && existing.snapshotJson !== snapshotJson) {
        throw new Error('相同 updatedAt 对应不同采集快照，拒绝非确定性覆盖。');
    }
    repositoryContext.db.prepare(`
      INSERT INTO lingxing_collection_jobs (
        store_id, job_id, request_id, browser_profile_id, marketplace,
        currency, business_timezone, business_date, session_generation,
        date_start, date_end, mode, report_types_json, state, snapshot_json,
        last_event_id, last_event_emitted_at, created_at, updated_at,
        completed_at, blocker_code, detail
      ) VALUES (
        @storeId, @jobId, @requestId, @browserProfileId, 'US',
        'USD', @businessTimezone, @businessDate, @sessionGeneration,
        @dateStart, @dateEnd, @mode, @reportTypesJson, @state, @snapshotJson,
        @lastEventId, @lastEventEmittedAt, @createdAt, @updatedAt,
        @completedAt, @blockerCode, @detail
      )
      ON CONFLICT(store_id, job_id) DO UPDATE SET
        state = excluded.state,
        snapshot_json = excluded.snapshot_json,
        last_event_id = COALESCE(excluded.last_event_id, lingxing_collection_jobs.last_event_id),
        last_event_emitted_at = COALESCE(
          excluded.last_event_emitted_at,
          lingxing_collection_jobs.last_event_emitted_at
        ),
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        blocker_code = excluded.blocker_code,
        detail = excluded.detail
    `).run({
        storeId,
        jobId: snapshot.jobId,
        requestId: snapshot.request.requestId,
        browserProfileId: String(snapshot.request.storeContext.browserProfileId),
        businessTimezone: snapshot.request.storeContext.businessTimezone,
        businessDate: String(snapshot.request.storeContext.businessDate),
        sessionGeneration: Number(snapshot.request.storeContext.sessionGeneration),
        dateStart: snapshot.request.dateStart,
        dateEnd: snapshot.request.dateEnd,
        mode: snapshot.request.mode,
        reportTypesJson,
        state: snapshot.state,
        snapshotJson,
        lastEventId: event?.eventId ?? null,
        lastEventEmittedAt: event?.emittedAt ?? null,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        completedAt: snapshot.completedAt ?? null,
        blockerCode: snapshot.blockerCode ?? null,
        detail: snapshot.detail ?? null,
    });
    if (snapshot.reports.length === 0) {
        repositoryContext.db.prepare(`
        DELETE FROM lingxing_collection_report_checkpoints
        WHERE store_id = ? AND job_id = ?
      `).run(storeId, snapshot.jobId);
    }
    else {
        const reportTypes = snapshot.reports.map((checkpoint) => checkpoint.reportType);
        repositoryContext.db.prepare(`
        DELETE FROM lingxing_collection_report_checkpoints
        WHERE store_id = ? AND job_id = ?
          AND report_type NOT IN (${reportTypes.map(() => '?').join(', ')})
      `).run(storeId, snapshot.jobId, ...reportTypes);
    }
    for (const checkpoint of snapshot.reports) {
        repositoryContext.methods.upsertCollectionCheckpoint(storeId, snapshot.jobId, checkpoint);
    }
    const saved = repositoryContext.methods.getCollectionJobForStore(storeId, snapshot.jobId);
    if (!saved)
        throw new Error('采集进度写入后无法按店铺回读。');
    return saved;
}

export function persistCollectionSnapshotRows(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, authority: StoreAuthority, input: LingxingCollectionSnapshotInput): {
    batch: StoreScopedLingxingReportBatch;
    files: StoreScopedLingxingReportFile[];
} {
    repositoryContext.methods.assertBatchInput(storeId, authority, input.batch);
    repositoryContext.methods.upsertBatchRow(storeId, input.batch);
    for (const file of input.files) {
        if (file.batchId !== input.batch.id) {
            throw new Error(`领星文件 ${file.id} 的 batchId 与批次 ${input.batch.id} 不一致。`);
        }
        repositoryContext.methods.upsertLingxingFileRow(storeId, file);
    }
    const saved = repositoryContext.methods.getCollectionSnapshotForStore(storeId, input.batch.id);
    if (!saved)
        throw new Error('领星采集快照写入后无法按店铺回读。');
    return saved;
}
