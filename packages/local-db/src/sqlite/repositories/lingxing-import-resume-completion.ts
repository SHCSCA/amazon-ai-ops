import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type FinalizeCollectionResumeAttemptInput, type CollectionResumeAttemptReceipt, COMPLETE_LINGXING_REPORT_TYPES, type InterruptCollectionResumeClaimInput, type ActiveCollectionResumeClaimRow } from './lingxing-import-contracts';
import { canonicalMonotonicAfter, latestCanonicalInstant, canonicalUtcInstant, sha256Text } from './lingxing-import-values';
import { fingerprintLingxingCollectionAuthorityProof } from './lingxing-import-fingerprints';
import { isFinalSucceededResumeProof, normalizeInterruptedResumeReports } from './lingxing-import-resume-validation';
import { normalizeCollectionJobSnapshot } from './lingxing-import-validation';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function finalizeCollectionResumeAttemptForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: FinalizeCollectionResumeAttemptInput): CollectionResumeAttemptReceipt {
    const finalize = repositoryContext.db.transaction(() => {
        const active = repositoryContext.methods.assertActiveResumeClaim(storeId, input.claim);
        const proof = repositoryContext.methods.assertResumeClaimAuthorityCurrent(storeId, active);
        if (input.outcome === 'succeeded') {
            if (proof.job.state !== 'completed'
                || proof.job.importState !== 'succeeded'
                || proof.job.reports.length !== COMPLETE_LINGXING_REPORT_TYPES.size
                || proof.job.reports.some((checkpoint) => checkpoint.state !== 'downloaded')
                || proof.lingxingFileCount !== COMPLETE_LINGXING_REPORT_TYPES.size
                || proof.lingxingFiles.length !== COMPLETE_LINGXING_REPORT_TYPES.size
                || proof.batch?.status !== 'completed'
                || proof.importRunCount !== 1
                || proof.metricEvidenceCount !== 1) {
                throw new Error('续跑 succeeded receipt 必须绑定最终导入成功的完整八报表 proof。');
            }
        }
        else if (proof.job.state === 'completed'
            && proof.job.importState !== 'failed') {
            throw new Error('续跑 failed receipt 必须绑定 collector 或 import 失败终态。');
        }
        const completedAt = canonicalMonotonicAfter(input.completedAt ?? new Date().toISOString(), latestCanonicalInstant([proof.job.updatedAt, active.claimedAt], 'resume finalize floor'), 'resume finalize.completedAt');
        repositoryContext.methods.appendResumeTerminalEvent(active, input.outcome, proof.job.updatedAt, fingerprintLingxingCollectionAuthorityProof(proof), completedAt, input.detail);
        repositoryContext.methods.consumeActiveResumeClaim(active);
        return repositoryContext.methods.requireResumeReceipt(storeId, active.attemptId);
    });
    return finalize.immediate();
}

export function interruptCollectionResumeClaimForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: InterruptCollectionResumeClaimInput): CollectionResumeAttemptReceipt {
    const interrupt = repositoryContext.db.transaction(() => {
        const active = repositoryContext.methods.assertActiveResumeClaim(storeId, input.claim);
        let proof = repositoryContext.methods.assertResumeClaimAuthorityCurrent(storeId, active);
        if (Date.parse(proof.job.updatedAt) < Date.parse(active.claimedAt)) {
            const advancedJobAt = canonicalMonotonicAfter(input.interruptedAt ?? new Date().toISOString(), latestCanonicalInstant([proof.job.updatedAt, active.claimedAt], 'interrupted job floor'), 'interrupted job.updatedAt');
            repositoryContext.methods.persistCollectionJobSnapshotRows(storeId, {
                ...proof.job,
                updatedAt: advancedJobAt,
            });
            proof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, active.requestId)!;
        }
        const resumeSucceeded = isFinalSucceededResumeProof(proof);
        const interruptedAt = canonicalMonotonicAfter(input.interruptedAt ?? new Date().toISOString(), latestCanonicalInstant([proof.job.updatedAt, active.claimedAt], 'interruptedAt floor'), 'interruptedAt');
        repositoryContext.methods.appendResumeTerminalEvent(active, resumeSucceeded ? 'succeeded' : 'interrupted', proof.job.updatedAt, fingerprintLingxingCollectionAuthorityProof(proof), interruptedAt, resumeSucceeded
            ? input.detail ?? 'manual interruption reconciled an already durable succeeded resume'
            : input.detail);
        repositoryContext.methods.consumeActiveResumeClaim(active);
        return repositoryContext.methods.requireResumeReceipt(storeId, active.attemptId);
    });
    return interrupt.immediate();
}

export function interruptOrphanedCollectionResumeClaimsForStartup(repositoryContext: LingxingImportRepositoryContext, interruptedAt = new Date().toISOString()): CollectionResumeAttemptReceipt[] {
    const requestedInterruptedAt = canonicalUtcInstant(interruptedAt, 'startup interruptedAt');
    const recover = repositoryContext.db.transaction(() => {
        const rows = repositoryContext.db.prepare(`
        SELECT store_id AS storeId, job_id AS jobId, attempt_id AS attemptId
        FROM lingxing_collection_resume_active_claims
        ORDER BY store_id, job_id
      `).all() as Array<{
            storeId: StoreId;
            jobId: string;
            attemptId: string;
        }>;
        const receipts: CollectionResumeAttemptReceipt[] = [];
        for (const row of rows) {
            const active = repositoryContext.methods.readActiveResumeClaimByAttempt(row.storeId, row.attemptId);
            if (!active)
                throw new Error('startup resume claim disappeared inside immediate transaction。');
            const job = repositoryContext.methods.getCollectionJobForStore(row.storeId, row.jobId);
            if (!job)
                throw new Error('startup resume claim 原任务不存在。');
            const finalJobAt = canonicalMonotonicAfter(requestedInterruptedAt, latestCanonicalInstant([job.updatedAt, active.claimedAt], 'startup final job floor'), 'startup final job.updatedAt');
            let finalJob = job;
            if (job.state === 'running' || job.state === 'queued') {
                const reports = normalizeInterruptedResumeReports(job.reports, finalJobAt);
                const hasUnknownCreate = reports.some((checkpoint) => checkpoint.state === 'create_unknown');
                finalJob = normalizeCollectionJobSnapshot({
                    ...job,
                    state: 'failed',
                    reports,
                    blockerCode: hasUnknownCreate
                        ? 'LINGXING_CREATE_OUTCOME_UNKNOWN_AFTER_RESTART'
                        : 'LINGXING_RESUME_INTERRUPTED_ON_RESTART',
                    detail: hasUnknownCreate
                        ? '应用重启时存在未确认的报表创建调用，必须人工核对下载中心。'
                        : '应用重启已安全中断原地续跑；需由操作员重新发起。',
                    completedAt: finalJobAt,
                    updatedAt: finalJobAt,
                });
                repositoryContext.methods.persistCollectionJobSnapshotRows(row.storeId, finalJob);
            }
            else if (Date.parse(job.updatedAt) < Date.parse(active.claimedAt)) {
                finalJob = normalizeCollectionJobSnapshot({
                    ...job,
                    updatedAt: finalJobAt,
                });
                repositoryContext.methods.persistCollectionJobSnapshotRows(row.storeId, finalJob);
            }
            const proof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(row.storeId, active.requestId);
            if (!proof || proof.job.jobId !== row.jobId) {
                throw new Error('startup interruption 后无法回读 authority proof。');
            }
            const finalProofSha256 = fingerprintLingxingCollectionAuthorityProof(proof);
            const resumeSucceeded = isFinalSucceededResumeProof(proof);
            const terminalAt = canonicalMonotonicAfter(requestedInterruptedAt, latestCanonicalInstant([finalJob.updatedAt, active.claimedAt], 'startup terminal floor'), 'startup interruptedAt');
            repositoryContext.methods.appendResumeTerminalEvent(active, resumeSucceeded ? 'succeeded' : 'interrupted', finalJob.updatedAt, finalProofSha256, terminalAt, resumeSucceeded
                ? 'startup finalized an already durable succeeded resume without browser execution'
                : 'startup orphan resume claim interrupted without browser execution');
            repositoryContext.methods.consumeActiveResumeClaim(active);
            receipts.push(repositoryContext.methods.requireResumeReceipt(row.storeId, row.attemptId));
        }
        return receipts;
    });
    return recover.immediate();
}

export function appendResumeTerminalEvent(repositoryContext: LingxingImportRepositoryContext, active: ActiveCollectionResumeClaimRow, outcome: 'succeeded' | 'failed' | 'interrupted', finalJobUpdatedAt: string, finalAuthorityProofSha256: string, completedAt: string, detail?: string): void {
    repositoryContext.db.prepare(`
      INSERT INTO lingxing_collection_resume_events (
        store_id, event_id, attempt_id, job_id, request_id, event_kind,
        consumed_claim_token_sha256, next_claim_token_sha256,
        base_job_updated_at, final_job_updated_at,
        base_authority_proof_sha256, final_authority_proof_sha256,
        detail, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(active.storeId, `${active.attemptId}:${outcome}`, active.attemptId, active.jobId, active.requestId, outcome, active.claimTokenSha256, active.baseJobUpdatedAt, finalJobUpdatedAt, active.baseAuthorityProofSha256, sha256Text(finalAuthorityProofSha256, 'finalAuthorityProofSha256'), detail ? String(detail).slice(0, 2000) : null, completedAt);
}
