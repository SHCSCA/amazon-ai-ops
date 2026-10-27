import { createHash, randomBytes } from 'crypto';
import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type CommitCollectionResumeProgressInput, type CollectionResumeClaim, type CommitCollectionResumeRunnerResultInput, type CommitCollectionResumeRunnerResultOutput, type AdvanceCollectionResumeClaimAfterImportInput, COMPLETE_LINGXING_REPORT_TYPES } from './lingxing-import-contracts';
import { fingerprintLingxingCollectionAuthorityProof } from './lingxing-import-fingerprints';
import { canonicalUtcInstant, hashOpaqueClaimToken } from './lingxing-import-values';
import { normalizeCollectionJobSnapshot, validateCollectionTerminalIdentity } from './lingxing-import-validation';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function commitCollectionResumeProgressForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: CommitCollectionResumeProgressInput): CollectionResumeClaim {
    const commit = repositoryContext.db.transaction(() => {
        const active = repositoryContext.methods.assertActiveResumeClaim(storeId, input.claim);
        const proof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, active.requestId);
        if (!proof || proof.job.jobId !== active.jobId) {
            throw new Error('COLLECTION_RESUME_CAS_CONFLICT: active claim 无法回读原任务。');
        }
        const currentProofSha256 = fingerprintLingxingCollectionAuthorityProof(proof);
        if (proof.job.updatedAt !== active.expectedJobUpdatedAt
            || currentProofSha256 !== active.expectedAuthorityProofSha256) {
            throw new Error('COLLECTION_RESUME_CAS_CONFLICT: progress 前 authority proof 已变化。');
        }
        if (input.event.job.jobId !== active.jobId
            || input.event.job.request.requestId !== active.requestId) {
            throw new Error('续跑 progress 不属于 active claim 的原 job/request。');
        }
        const emittedAt = canonicalUtcInstant(input.event.emittedAt, 'resume progress.emittedAt');
        if (input.event.job.updatedAt !== emittedAt
            || Date.parse(emittedAt) <= Date.parse(active.expectedJobUpdatedAt)
            || Date.parse(emittedAt) < Date.parse(active.claimedAt)) {
            throw new Error('续跑 progress 必须以严格递增的 canonical updatedAt 提交。');
        }
        const savedJob = repositoryContext.methods.persistCollectionJobSnapshotRows(storeId, input.event.job, {
            eventId: input.event.eventId,
            emittedAt,
        });
        const nextProof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, active.requestId);
        if (!nextProof || nextProof.job.jobId !== active.jobId) {
            throw new Error('续跑 progress 写入后无法回读 authority proof。');
        }
        const nextAuthorityProofSha256 = fingerprintLingxingCollectionAuthorityProof(nextProof);
        const nextRawToken = randomBytes(32).toString('base64url');
        const nextTokenSha256 = hashOpaqueClaimToken(nextRawToken);
        const changed = repositoryContext.db.prepare(`
        UPDATE lingxing_collection_resume_active_claims
        SET claim_token_sha256 = ?, expected_job_updated_at = ?,
            expected_authority_proof_sha256 = ?, version = version + 1,
            updated_at = ?
        WHERE store_id = ? AND job_id = ? AND attempt_id = ?
          AND claim_token_sha256 = ? AND version = ?
          AND expected_job_updated_at = ?
          AND expected_authority_proof_sha256 = ?
      `).run(nextTokenSha256, savedJob.updatedAt, nextAuthorityProofSha256, emittedAt, storeId, active.jobId, active.attemptId, active.claimTokenSha256, active.version, active.expectedJobUpdatedAt, active.expectedAuthorityProofSha256);
        if (changed.changes !== 1) {
            throw new Error('COLLECTION_RESUME_CAS_CONFLICT: progress claim token 已被消费。');
        }
        repositoryContext.db.prepare(`
        INSERT INTO lingxing_collection_resume_events (
          store_id, event_id, attempt_id, job_id, request_id, event_kind,
          consumed_claim_token_sha256, next_claim_token_sha256,
          base_job_updated_at, final_job_updated_at,
          base_authority_proof_sha256, final_authority_proof_sha256,
          detail, created_at
        ) VALUES (?, ?, ?, ?, ?, 'progress', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(storeId, `${active.attemptId}:progress:${active.version}`, active.attemptId, active.jobId, active.requestId, active.claimTokenSha256, nextTokenSha256, active.baseJobUpdatedAt, savedJob.updatedAt, active.baseAuthorityProofSha256, nextAuthorityProofSha256, input.event.changedReportType ?? null, emittedAt);
        return {
            ...input.claim,
            claimToken: nextRawToken,
            expectedJobUpdatedAt: savedJob.updatedAt,
            expectedAuthorityProofSha256: nextAuthorityProofSha256,
            version: active.version + 1,
        };
    });
    return commit.immediate();
}

export function commitCollectionResumeRunnerResultForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: CommitCollectionResumeRunnerResultInput): CommitCollectionResumeRunnerResultOutput {
    const job = normalizeCollectionJobSnapshot(input.job);
    const commit = repositoryContext.db.transaction(() => {
        const active = repositoryContext.methods.assertActiveResumeClaim(storeId, input.claim);
        repositoryContext.methods.assertResumeClaimAuthorityCurrent(storeId, active);
        if (job.jobId !== active.jobId || job.request.requestId !== active.requestId) {
            throw new Error('续跑 runner result 不属于 active claim 的原 job/request。');
        }
        if (Date.parse(job.updatedAt) <= Date.parse(active.expectedJobUpdatedAt)
            || Date.parse(job.updatedAt) < Date.parse(active.claimedAt)) {
            throw new Error('续跑 runner result 必须晚于当前 proof 且不早于 claimedAt。');
        }
        const authority = repositoryContext.methods.getStoreAuthority(storeId);
        validateCollectionTerminalIdentity(storeId, authority, job, input.batch, input.files);
        const savedJob = repositoryContext.methods.persistCollectionJobSnapshotRows(storeId, job);
        const savedCollection = repositoryContext.methods.persistCollectionSnapshotRows(storeId, authority, {
            batch: input.batch,
            files: input.files,
        });
        const nextProof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, active.requestId);
        if (!nextProof || nextProof.job.jobId !== active.jobId) {
            throw new Error('续跑 runner result 写入后无法回读 authority proof。');
        }
        const finalProofSha256 = fingerprintLingxingCollectionAuthorityProof(nextProof);
        const nextClaim = repositoryContext.methods.rotateActiveResumeClaim(active, savedJob.updatedAt, finalProofSha256, savedJob.updatedAt, 'runner-result');
        return {
            claim: nextClaim,
            result: {
                job: savedJob,
                batch: savedCollection.batch,
                files: savedCollection.files,
            },
        };
    });
    return commit.immediate();
}

export function advanceCollectionResumeClaimAfterImportForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: AdvanceCollectionResumeClaimAfterImportInput): CollectionResumeClaim {
    const advance = repositoryContext.db.transaction(() => {
        const active = repositoryContext.methods.assertActiveResumeClaim(storeId, input.claim);
        const proof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, active.requestId);
        if (!proof
            || proof.job.jobId !== active.jobId
            || proof.job.updatedAt !== active.expectedJobUpdatedAt
            || proof.job.importState !== 'pending'
            || proof.importRunCount !== 1
            || proof.importRuns.length !== 1
            || proof.metricEvidenceCount !== 1
            || proof.metricEvidence.length !== 1
            || proof.job.state !== 'completed'
            || proof.job.reports.length !== COMPLETE_LINGXING_REPORT_TYPES.size
            || proof.job.reports.some((checkpoint) => checkpoint.state !== 'downloaded')) {
            throw new Error('COLLECTION_RESUME_IMPORT_SUCCESSOR_INVALID: import 后继不是唯一完整权威证据。');
        }
        const currentProofSha256 = fingerprintLingxingCollectionAuthorityProof(proof);
        if (currentProofSha256 === active.expectedAuthorityProofSha256) {
            throw new Error('COLLECTION_RESUME_IMPORT_SUCCESSOR_INVALID: authority proof 未产生导入后继。');
        }
        const advancedAt = canonicalUtcInstant(input.advancedAt ?? proof.importRuns[0].createdAt, 'resume import advancedAt');
        if (Date.parse(advancedAt) < Date.parse(active.expectedJobUpdatedAt)) {
            throw new Error('resume import advancedAt 不能早于当前 job.updatedAt。');
        }
        return repositoryContext.methods.rotateActiveResumeClaim(active, proof.job.updatedAt, currentProofSha256, advancedAt, 'import-authority-successor');
    });
    return advance.immediate();
}
