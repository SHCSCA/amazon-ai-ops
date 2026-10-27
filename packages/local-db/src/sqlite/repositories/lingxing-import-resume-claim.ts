import { createHash, randomBytes } from 'crypto';
import type { AdDailyMetrics, LingxingCollectionJobSnapshot, LingxingCollectionProgressEvent, LingxingCollectionReportCheckpoint, LingxingCollectionResumeState, LingxingReportBatch, LingxingReportFile, LingxingReportType, StoreId, StoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { LINGXING_COLLECTION_IMPORT_STATES, normalizeLingxingCollectionStoreName, normalizeStoreContextEnvelope, } from '@amazon-ai-ops/shared-types';
import { type AcquireCollectionResumeClaimInput, type CollectionResumeClaim, type ActiveCollectionResumeClaimRow, type LingxingCollectionAuthorityProof } from './lingxing-import-contracts';
import { safeResumeIdentifier, requiredText, canonicalUtcInstant, sha256Text, canonicalMonotonicAfter, hashOpaqueClaimToken, errorMessage } from './lingxing-import-values';
import { assertExecutionContextCanResume } from './lingxing-import-resume-validation';
import { fingerprintCollectionResumeExecutionContext, fingerprintLingxingCollectionAuthorityProof } from './lingxing-import-fingerprints';
import type { LingxingImportRepositoryContext } from './lingxing-import-context';

export function acquireCollectionResumeClaimForStore(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, input: AcquireCollectionResumeClaimInput): CollectionResumeClaim {
    const executionContext = normalizeStoreContextEnvelope(input.executionStoreContext);
    const attemptId = safeResumeIdentifier(input.attemptId ?? `resume_${randomBytes(16).toString('hex')}`, 'attemptId');
    const jobId = safeResumeIdentifier(input.jobId, 'jobId');
    const requestId = requiredText(input.requestId, 'requestId');
    const expectedJobUpdatedAt = canonicalUtcInstant(input.expectedJobUpdatedAt, 'expectedJobUpdatedAt');
    const expectedAuthorityProofSha256 = sha256Text(input.expectedAuthorityProofSha256, 'expectedAuthorityProofSha256');
    const claimedAt = input.claimedAt === undefined
        ? canonicalMonotonicAfter(new Date().toISOString(), expectedJobUpdatedAt, 'claimedAt')
        : canonicalUtcInstant(input.claimedAt, 'claimedAt');
    if (Date.parse(claimedAt) < Date.parse(expectedJobUpdatedAt)) {
        throw new Error('claimedAt 不能早于 base job.updatedAt。');
    }
    const claim = repositoryContext.db.transaction(() => {
        const packet = repositoryContext.methods.getCollectionInPlaceResumeStateForStore(storeId, jobId);
        if (!packet)
            throw new Error('续跑任务不存在。');
        if (packet.request.requestId !== requestId
            || packet.expectedJobUpdatedAt !== expectedJobUpdatedAt
            || packet.authorityProofSha256 !== expectedAuthorityProofSha256) {
            throw new Error('COLLECTION_RESUME_CAS_CONFLICT: durable authority proof 已变化。');
        }
        assertExecutionContextCanResume(packet.request.storeContext, executionContext);
        const rawToken = randomBytes(32).toString('base64url');
        const tokenSha256 = hashOpaqueClaimToken(rawToken);
        const executionContextSha256 = fingerprintCollectionResumeExecutionContext(executionContext);
        repositoryContext.db.prepare(`
        INSERT INTO lingxing_collection_resume_attempts (
          store_id, attempt_id, job_id, request_id,
          base_job_updated_at, base_authority_proof_sha256,
          durable_session_generation, execution_session_generation,
          execution_context_sha256, claimed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(storeId, attemptId, jobId, requestId, expectedJobUpdatedAt, expectedAuthorityProofSha256, packet.request.storeContext.sessionGeneration, executionContext.sessionGeneration, executionContextSha256, claimedAt);
        repositoryContext.db.prepare(`
        INSERT INTO lingxing_collection_resume_active_claims (
          store_id, job_id, request_id, attempt_id, claim_token_sha256,
          expected_job_updated_at, expected_authority_proof_sha256,
          version, claimed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(storeId, jobId, requestId, attemptId, tokenSha256, expectedJobUpdatedAt, expectedAuthorityProofSha256, claimedAt, claimedAt);
        repositoryContext.db.prepare(`
        INSERT INTO lingxing_collection_resume_events (
          store_id, event_id, attempt_id, job_id, request_id, event_kind,
          consumed_claim_token_sha256, next_claim_token_sha256,
          base_job_updated_at, final_job_updated_at,
          base_authority_proof_sha256, final_authority_proof_sha256,
          detail, created_at
        ) VALUES (?, ?, ?, ?, ?, 'claimed', NULL, ?, ?, ?, ?, ?, NULL, ?)
      `).run(storeId, `${attemptId}:claimed`, attemptId, jobId, requestId, tokenSha256, expectedJobUpdatedAt, expectedJobUpdatedAt, expectedAuthorityProofSha256, expectedAuthorityProofSha256, claimedAt);
        return {
            storeId,
            attemptId,
            jobId,
            requestId,
            claimToken: rawToken,
            expectedJobUpdatedAt,
            expectedAuthorityProofSha256,
            version: 1,
            claimedAt,
        } satisfies CollectionResumeClaim;
    });
    try {
        return claim.immediate();
    }
    catch (error) {
        if (/UNIQUE constraint failed|active resume claim/i.test(errorMessage(error))) {
            throw new Error('COLLECTION_RESUME_CLAIM_CONFLICT: 该任务已有续跑声明。');
        }
        throw error;
    }
}

export function readActiveResumeClaimByAttempt(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, attemptId: string): ActiveCollectionResumeClaimRow | undefined {
    return repositoryContext.db.prepare(`
      SELECT claims.store_id AS storeId,
             claims.job_id AS jobId,
             claims.request_id AS requestId,
             claims.attempt_id AS attemptId,
             claims.claim_token_sha256 AS claimTokenSha256,
             claims.expected_job_updated_at AS expectedJobUpdatedAt,
             claims.expected_authority_proof_sha256 AS expectedAuthorityProofSha256,
             claims.version,
             claims.claimed_at AS claimedAt,
             attempts.base_job_updated_at AS baseJobUpdatedAt,
             attempts.base_authority_proof_sha256 AS baseAuthorityProofSha256,
             attempts.durable_session_generation AS durableSessionGeneration,
             attempts.execution_session_generation AS executionSessionGeneration,
             attempts.execution_context_sha256 AS executionContextSha256
      FROM lingxing_collection_resume_active_claims AS claims
      INNER JOIN lingxing_collection_resume_attempts AS attempts
        ON attempts.store_id = claims.store_id
       AND attempts.attempt_id = claims.attempt_id
       AND attempts.job_id = claims.job_id
       AND attempts.request_id = claims.request_id
      WHERE claims.store_id = ? AND claims.attempt_id = ?
    `).get(storeId, attemptId) as ActiveCollectionResumeClaimRow | undefined;
}

export function assertActiveResumeClaim(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, claim: CollectionResumeClaim): ActiveCollectionResumeClaimRow {
    if (claim.storeId !== storeId) {
        throw new Error('resume claim storeId 与调用边界不一致。');
    }
    const active = repositoryContext.methods.readActiveResumeClaimByAttempt(storeId, safeResumeIdentifier(claim.attemptId, 'claim.attemptId'));
    if (!active
        || active.jobId !== claim.jobId
        || active.requestId !== claim.requestId
        || active.version !== claim.version
        || active.expectedJobUpdatedAt !== claim.expectedJobUpdatedAt
        || active.expectedAuthorityProofSha256 !== claim.expectedAuthorityProofSha256
        || active.claimedAt !== claim.claimedAt
        || active.claimTokenSha256 !== hashOpaqueClaimToken(claim.claimToken)) {
        throw new Error('COLLECTION_RESUME_CAS_CONFLICT: claim token 已失效或被消费。');
    }
    return active;
}

export function assertResumeClaimAuthorityCurrent(repositoryContext: LingxingImportRepositoryContext, storeId: StoreId, active: ActiveCollectionResumeClaimRow): LingxingCollectionAuthorityProof {
    const proof = repositoryContext.methods.readUniqueCollectionAuthorityProofForStoreByRequestId(storeId, active.requestId);
    if (!proof
        || proof.job.jobId !== active.jobId
        || proof.job.updatedAt !== active.expectedJobUpdatedAt
        || fingerprintLingxingCollectionAuthorityProof(proof)
            !== active.expectedAuthorityProofSha256) {
        throw new Error('COLLECTION_RESUME_CAS_CONFLICT: active authority proof 已漂移。');
    }
    return proof;
}

export function rotateActiveResumeClaim(repositoryContext: LingxingImportRepositoryContext, active: ActiveCollectionResumeClaimRow, finalJobUpdatedAt: string, finalAuthorityProofSha256: string, createdAt: string, detail: string): CollectionResumeClaim {
    const nextRawToken = randomBytes(32).toString('base64url');
    const nextTokenSha256 = hashOpaqueClaimToken(nextRawToken);
    const exactProofSha256 = sha256Text(finalAuthorityProofSha256, 'finalAuthorityProofSha256');
    const changed = repositoryContext.db.prepare(`
      UPDATE lingxing_collection_resume_active_claims
      SET claim_token_sha256 = ?, expected_job_updated_at = ?,
          expected_authority_proof_sha256 = ?, version = version + 1,
          updated_at = ?
      WHERE store_id = ? AND job_id = ? AND attempt_id = ?
        AND claim_token_sha256 = ? AND version = ?
        AND expected_job_updated_at = ?
        AND expected_authority_proof_sha256 = ?
    `).run(nextTokenSha256, finalJobUpdatedAt, exactProofSha256, createdAt, active.storeId, active.jobId, active.attemptId, active.claimTokenSha256, active.version, active.expectedJobUpdatedAt, active.expectedAuthorityProofSha256);
    if (changed.changes !== 1) {
        throw new Error('COLLECTION_RESUME_CAS_CONFLICT: claim rotation failed。');
    }
    repositoryContext.db.prepare(`
      INSERT INTO lingxing_collection_resume_events (
        store_id, event_id, attempt_id, job_id, request_id, event_kind,
        consumed_claim_token_sha256, next_claim_token_sha256,
        base_job_updated_at, final_job_updated_at,
        base_authority_proof_sha256, final_authority_proof_sha256,
        detail, created_at
      ) VALUES (?, ?, ?, ?, ?, 'progress', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(active.storeId, `${active.attemptId}:progress:${active.version}`, active.attemptId, active.jobId, active.requestId, active.claimTokenSha256, nextTokenSha256, active.baseJobUpdatedAt, finalJobUpdatedAt, active.baseAuthorityProofSha256, exactProofSha256, detail, createdAt);
    return {
        storeId: active.storeId,
        attemptId: active.attemptId,
        jobId: active.jobId,
        requestId: active.requestId,
        claimToken: nextRawToken,
        expectedJobUpdatedAt: finalJobUpdatedAt,
        expectedAuthorityProofSha256: exactProofSha256,
        version: active.version + 1,
        claimedAt: active.claimedAt,
    };
}

export function consumeActiveResumeClaim(repositoryContext: LingxingImportRepositoryContext, active: ActiveCollectionResumeClaimRow): void {
    const removed = repositoryContext.db.prepare(`
      DELETE FROM lingxing_collection_resume_active_claims
      WHERE store_id = ? AND job_id = ? AND attempt_id = ?
        AND claim_token_sha256 = ? AND version = ?
    `).run(active.storeId, active.jobId, active.attemptId, active.claimTokenSha256, active.version);
    if (removed.changes !== 1) {
        throw new Error('COLLECTION_RESUME_CAS_CONFLICT: terminal claim token 已被消费。');
    }
}
