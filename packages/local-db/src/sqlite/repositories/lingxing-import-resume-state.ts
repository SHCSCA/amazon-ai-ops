import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type CollectionInPlaceResumeState, type CollectionResumeAttemptReceipt, type LingxingCollectionAuthorityProof } from './lingxing-import-contracts';
import { requiredText, cloneCollectionCheckpoint } from './lingxing-import-values';
import { normalizeInPlaceResumeReports, isFinalSucceededResumeProof } from './lingxing-import-resume-validation';
import { fingerprintLingxingCollectionAuthorityProof } from './lingxing-import-fingerprints';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function getCollectionResumeStateForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, jobId: string): LingxingCollectionResumeState | undefined {
    const job = repositoryContext.methods.getCollectionJobForStore(storeId, jobId);
    if (!job)
        return undefined;
    return { jobId: job.jobId, request: job.request, reports: job.reports };
}

export function getCollectionInPlaceResumeStateForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, jobId: string): CollectionInPlaceResumeState | undefined {
    const exactJobId = requiredText(jobId, 'jobId');
    const selected = repositoryContext.db.prepare(`
      SELECT request_id AS requestId
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, exactJobId) as {
        requestId: string;
    } | undefined;
    if (!selected)
        return undefined;
    const proof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, selected.requestId);
    if (!proof || proof.job.jobId !== exactJobId) {
        throw new Error('续跑任务无法绑定唯一 store/job/request authority proof。');
    }
    const reports = normalizeInPlaceResumeReports(proof);
    if (!proof.batch)
        throw new Error('原地续跑缺少原始 durable batch。');
    const active = repositoryContext.db.prepare(`
      SELECT 1 FROM lingxing_collection_resume_active_claims
      WHERE store_id = ? AND job_id = ?
    `).get(storeId, exactJobId);
    if (active)
        throw new Error('该采集任务已有 active resume claim。');
    const job: LingxingCollectionJobSnapshot = {
        ...proof.job,
        request: {
            ...proof.job.request,
            storeContext: { ...proof.job.request.storeContext },
            reportTypes: [...proof.job.request.reportTypes],
        },
        reports: proof.job.reports.map(cloneCollectionCheckpoint),
    };
    return {
        jobId: job.jobId,
        request: job.request,
        reports,
        job,
        batch: { ...proof.batch },
        files: proof.lingxingFiles.map((file) => ({
            ...file,
            ...(file.attemptErrors ? { attemptErrors: [...file.attemptErrors] } : {}),
        })),
        expectedJobUpdatedAt: proof.job.updatedAt,
        authorityProofSha256: fingerprintLingxingCollectionAuthorityProof(proof),
    };
}

export function readLatestCollectionResumeAttemptReceiptForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, jobId: string, requestId: string): CollectionResumeAttemptReceipt | undefined {
    const rows = repositoryContext.methods.readResumeReceiptRows(storeId, requiredText(jobId, 'jobId'), requiredText(requestId, 'requestId'), 2);
    if (rows.length > 1
        && rows[0].completedAt === rows[1].completedAt
        && rows[0].attemptId === rows[1].attemptId) {
        throw new Error('续跑 terminal receipt 存在歧义重复。');
    }
    return rows[0];
}

export function readUniqueSucceededCollectionResumeReceiptForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, jobId: string, requestId: string): CollectionResumeAttemptReceipt | undefined {
    const rows = repositoryContext.methods.readResumeReceiptRows(storeId, requiredText(jobId, 'jobId'), requiredText(requestId, 'requestId'), 2, 'succeeded');
    if (rows.length > 1) {
        throw new Error('同一原任务存在多个 succeeded resume receipt，拒绝歧义回读。');
    }
    return rows[0];
}

export function findLatestCollectionResumeStateForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, requestId: string): LingxingCollectionResumeState | undefined {
    const row = repositoryContext.db.prepare(`
      SELECT job_id AS jobId
      FROM lingxing_collection_jobs
      WHERE store_id = ? AND request_id = ?
      ORDER BY updated_at DESC, job_id DESC
      LIMIT 1
    `).get(storeId, requestId) as {
        jobId: string;
    } | undefined;
    return row ? repositoryContext.methods.getCollectionResumeStateForStore(storeId, row.jobId) : undefined;
}

export function readResumeReceiptRows(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, jobId: string, requestId: string, limit: number, outcome?: 'succeeded'): CollectionResumeAttemptReceipt[] {
    const outcomeClause = outcome ? 'AND events.event_kind = ?' : `AND events.event_kind IN (
      'succeeded', 'failed', 'interrupted'
    )`;
    const params: unknown[] = [storeId, jobId, requestId];
    if (outcome)
        params.push(outcome);
    params.push(limit);
    return (repositoryContext.db.prepare(`
      SELECT events.store_id AS storeId,
             events.attempt_id AS attemptId,
             events.job_id AS jobId,
             events.request_id AS requestId,
             events.event_kind AS outcome,
             events.base_job_updated_at AS baseJobUpdatedAt,
             events.final_job_updated_at AS finalJobUpdatedAt,
             events.base_authority_proof_sha256 AS baseAuthorityProofSha256,
             events.final_authority_proof_sha256 AS finalAuthorityProofSha256,
             attempts.durable_session_generation AS durableSessionGeneration,
             attempts.execution_session_generation AS executionSessionGeneration,
             attempts.execution_context_sha256 AS executionContextSha256,
             attempts.claimed_at AS claimedAt,
             events.created_at AS completedAt,
             events.detail
      FROM lingxing_collection_resume_events AS events
      INNER JOIN lingxing_collection_resume_attempts AS attempts
        ON attempts.store_id = events.store_id
       AND attempts.attempt_id = events.attempt_id
       AND attempts.job_id = events.job_id
       AND attempts.request_id = events.request_id
       AND attempts.base_job_updated_at = events.base_job_updated_at
       AND attempts.base_authority_proof_sha256 = events.base_authority_proof_sha256
      WHERE events.store_id = ? AND events.job_id = ? AND events.request_id = ?
        ${outcomeClause}
      ORDER BY events.created_at DESC, events.event_id DESC
      LIMIT ?
    `).all(...params) as Array<CollectionResumeAttemptReceipt & {
        detail: string | null;
    }>)
        .map((row) => ({
        ...row,
        ...(row.detail ? { detail: row.detail } : {}),
    }));
}

export function requireResumeReceipt(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, attemptId: string): CollectionResumeAttemptReceipt {
    const row = repositoryContext.db.prepare(`
      SELECT job_id AS jobId, request_id AS requestId
      FROM lingxing_collection_resume_attempts
      WHERE store_id = ? AND attempt_id = ?
    `).get(storeId, attemptId) as {
        jobId: string;
        requestId: string;
    } | undefined;
    if (!row)
        throw new Error('resume receipt attempt 不存在。');
    const receipt = repositoryContext.methods.readResumeReceiptRows(storeId, row.jobId, row.requestId, 100).find((candidate) => candidate.attemptId === attemptId);
    if (!receipt)
        throw new Error('resume terminal receipt 写入后无法回读。');
    return receipt;
}

export function appendRecoveredSucceededResumeReceiptIfNeeded(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, proof: LingxingCollectionAuthorityProof, completedAt: string, predecessorJobUpdatedAt: string): void {
    if (!isFinalSucceededResumeProof(proof))
        return;
    const rows = repositoryContext.db.prepare(`
      SELECT attempts.attempt_id AS attemptId,
             attempts.job_id AS jobId,
             attempts.request_id AS requestId,
             attempts.base_job_updated_at AS baseJobUpdatedAt,
             attempts.base_authority_proof_sha256 AS baseAuthorityProofSha256
      FROM lingxing_collection_resume_attempts AS attempts
      INNER JOIN lingxing_collection_resume_events AS terminal
        ON terminal.store_id = attempts.store_id
       AND terminal.attempt_id = attempts.attempt_id
       AND terminal.job_id = attempts.job_id
       AND terminal.request_id = attempts.request_id
       AND terminal.event_kind IN ('interrupted', 'failed')
      WHERE attempts.store_id = ?
        AND attempts.job_id = ?
        AND attempts.request_id = ?
        AND terminal.final_job_updated_at IN (?, ?, ?)
        AND NOT EXISTS (
          SELECT 1 FROM lingxing_collection_resume_events AS succeeded
          WHERE succeeded.store_id = attempts.store_id
            AND succeeded.attempt_id = attempts.attempt_id
            AND succeeded.event_kind = 'succeeded'
        )
        AND NOT EXISTS (
          SELECT 1 FROM lingxing_collection_resume_active_claims AS active
          WHERE active.store_id = attempts.store_id
            AND active.attempt_id = attempts.attempt_id
        )
      ORDER BY attempts.claimed_at DESC, attempts.attempt_id DESC
      LIMIT 2
    `).all(storeId, proof.job.jobId, proof.job.request.requestId, proof.job.completedAt, proof.job.importAttemptedAt, predecessorJobUpdatedAt) as Array<{
        attemptId: string;
        jobId: string;
        requestId: string;
        baseJobUpdatedAt: string;
        baseAuthorityProofSha256: string;
    }>;
    if (rows.length > 1) {
        throw new Error('import recovery 对应多个 resume terminal predecessor，拒绝追加成功后继。');
    }
    const attempt = rows[0];
    if (!attempt)
        return;
    repositoryContext.db.prepare(`
      INSERT INTO lingxing_collection_resume_events (
        store_id, event_id, attempt_id, job_id, request_id, event_kind,
        consumed_claim_token_sha256, next_claim_token_sha256,
        base_job_updated_at, final_job_updated_at,
        base_authority_proof_sha256, final_authority_proof_sha256,
        detail, created_at
      ) VALUES (?, ?, ?, ?, ?, 'succeeded', NULL, NULL, ?, ?, ?, ?, ?, ?)
    `).run(storeId, `${attempt.attemptId}:recovered-succeeded`, attempt.attemptId, attempt.jobId, attempt.requestId, attempt.baseJobUpdatedAt, proof.job.updatedAt, attempt.baseAuthorityProofSha256, fingerprintLingxingCollectionAuthorityProof(proof), 'append-only successor: interrupted resume completed through exact import recovery CAS', completedAt);
}
