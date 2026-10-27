import  {
  isTerminalAdExecutionStatus,
  type AdExecutionBatchProjection,
  type AdExecutionBatchRecord,
  type AdExecutionEventType,
  type AdExecutionJobTransitionRequest,
  type AdExecutionStatus,
  type AdExecutionTransitionResult,
  type MarkAdExecutionTerminalRequest,
  type RecordAdExecutionEvidenceRequest,
  type RecordAdExecutionPreflightRequest,
  type RecordAdExecutionSubmitIntentRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { BatchRow, JobRow, EvidenceRow } from './contracts';
import { ExecutionAuthorityRepositoryError } from './errors';
import { mapBatch } from './rows';
import  {
  normalizeContext,
  idOf,
  safeProjectionText,
  positiveInt,
  sha256Of,
  notFound,
  stateConflict,
  revisionConflict,
  terminalState,
} from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function startJob(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<AdExecutionJobTransitionRequest, 'context'>): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    this.missionRepository.expireMissionGrants(context);
    return this.immediate(() => {
        this.assertContext(context);
        const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['queued']);
        this.requireGrant(context, job.grant_id);
        return this.applyTransition(context, job, 'preflight', 'started', 'executor');
    });
}
export function recordPreflight(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionPreflightRequest, 'context'>): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    this.missionRepository.expireMissionGrants(context);
    return this.immediate(() => {
        this.assertContext(context);
        const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['preflight']);
        this.requireGrant(context, job.grant_id);
        this.assertExactReadback(job, input);
        if (positiveInt(input.observedBidCents, 'observedBidCents') !== job.expected_bid_cents) {
            throw stateConflict('Preflight observed bid does not match the immutable expected-before value.');
        }
        return this.applyTransition(context, job, 'preflight', 'preflight_verified', 'executor');
    });
}
export function recordSubmitIntent(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionSubmitIntentRequest, 'context'>): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    this.missionRepository.expireMissionGrants(context);
    return this.immediate(() => {
        this.assertContext(context);
        const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['preflight']);
        const grant = this.requireGrant(context, job.grant_id);
        this.missionRepository.assertPolicyUsage(context, grant.policy_version_id, [job.ad_entity_id]);
        this.assertEvidenceMatchesJob(job, input.before);
        const submitIntentId = idOf(input.submitIntentId, 'submitIntentId');
        const commandFingerprint = sha256Of(input.commandFingerprint, 'commandFingerprint');
        if (input.before.observedBidCents !== job.expected_bid_cents) {
            throw stateConflict('Before evidence must prove the immutable expected-before bid before click.');
        }
        this.insertEvidence(context, job, 'before', input.before);
        return this.applyTransition(context, job, 'intent_written', 'submit_intent_recorded', 'executor', undefined, undefined, {
            intentWrittenAt: this.timestamp(),
            submitIntentId,
            commandFingerprint,
        });
    });
}
export function recordSubmitted(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<AdExecutionJobTransitionRequest, 'context'>): AdExecutionTransitionResult {
    return this.transition(contextInput, input, ['intent_written'], 'submitted', 'submitted', 'executor', undefined, undefined, { submittedAt: this.timestamp() });
}
export function recordAfterEvidence(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionEvidenceRequest, 'context'>): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        this.assertContext(context);
        const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['submitted']);
        this.assertEvidenceMatchesJob(job, input.evidence);
        this.insertEvidence(context, job, 'after', input.evidence);
        return this.applyTransition(context, job, 'verifying', 'after_recorded', 'executor');
    });
}
export function recordReloadVerified(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<RecordAdExecutionEvidenceRequest, 'context'>): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        this.assertContext(context);
        const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['verifying']);
        this.assertEvidenceMatchesJob(job, input.evidence);
        const after = this.db.prepare(`
        SELECT * FROM ad_execution_evidence WHERE store_id = ? AND job_id = ? AND slot = 'after'
      `).get(context.storeId, job.id) as EvidenceRow | undefined;
        if (!after
            || after.observed_bid_cents !== job.target_bid_cents
            || input.evidence.observedBidCents !== job.target_bid_cents
            || after.page_identity_hash !== input.evidence.pageIdentityHash
            || after.canonical_keyword_id !== input.evidence.canonicalKeywordId
            || after.object_revision !== input.evidence.objectRevision) {
            throw stateConflict('After and reload evidence must independently prove the exact target on the same page identity.');
        }
        this.insertEvidence(context, job, 'reload', input.evidence);
        return this.applyTransition(context, job, 'succeeded', 'reload_verified', 'executor', undefined, undefined, { terminalAt: this.timestamp() });
    });
}
export function markBlocked(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
    return this.transition(contextInput, input, ['queued', 'preflight'], 'blocked', 'blocked', 'executor', input.reasonCode, input.detail, { terminalAt: this.timestamp() }, true);
}
export function markNotSubmittedAfterIntent(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
    return this.transition(contextInput, input, ['intent_written'], 'blocked', 'blocked', 'executor', input.reasonCode, input.detail, { terminalAt: this.timestamp() });
}
export function markUnknown(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        this.assertContext(context);
        return this.markUnknownInternal(context, input);
    });
}
export function terminalizePostIntentUnknownAfterAuthorityLoss(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionBatchProjection {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        try {
            this.assertStoreContext(context);
        } catch (error) {
            const original = this.db.prepare('SELECT created_session_generation FROM ad_execution_jobs WHERE store_id=? AND id=?')
                .get(context.storeId, input.jobId) as { created_session_generation: number } | undefined;
            // 旧会话只可收口自身已经进入提交边界的事实，不能形成新的执行权限。
            if (!(error instanceof ExecutionAuthorityRepositoryError) || error.code !== 'STALE_CONTEXT'
                || original?.created_session_generation !== context.sessionGeneration) throw error;
        }
        const result = this.markUnknownInternal(context, input);
        return this.requireProjection(context.storeId, result.batch.id);
    });
}
export function cancelJob(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
    return this.transition(contextInput, input, ['queued', 'preflight'], 'cancelled', 'cancelled', 'executor', input.reasonCode, input.detail, { terminalAt: this.timestamp() }, true);
}
export function markUnknownInternal(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, input: Omit<MarkAdExecutionTerminalRequest, 'context'>): AdExecutionTransitionResult {
    const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, ['intent_written', 'submitted', 'verifying'], true);
    const reasonCode = idOf(input.reasonCode, 'reasonCode');
    const detail = input.detail === undefined
        ? undefined
        : safeProjectionText(input.detail, 'detail');
    const updatedAt = this.timestamp();
    const changed = this.db.prepare(`
      UPDATE ad_execution_jobs SET status = 'unknown', revision = revision + 1,
        updated_at = ?, terminal_at = COALESCE(terminal_at, ?)
      WHERE store_id = ? AND id = ? AND revision = ?
        AND status IN ('intent_written', 'submitted', 'verifying')
    `).run(updatedAt, updatedAt, context.storeId, job.id, job.revision);
    if (changed.changes !== 1)
        throw revisionConflict(`Execution job ${job.id} lost its UNKNOWN CAS transition.`);
    this.recordGrantSlot(job, 'spent', updatedAt);
    this.insertEvent({
        storeId: context.storeId,
        batchId: job.batch_id,
        jobId: job.id,
        sequence: this.nextEventSequence(context.storeId, job.id),
        eventType: 'unknown',
        fromStatus: job.status,
        toStatus: 'unknown',
        actorId: 'executor',
        reasonCode,
        detail,
        sessionGeneration: context.sessionGeneration,
        createdAt: updatedAt,
    });
    const siblings = this.db.prepare(`
      SELECT * FROM ad_execution_jobs
      WHERE store_id = ? AND batch_id = ? AND id <> ?
        AND status IN ('queued', 'preflight')
      ORDER BY ordinal
    `).all(context.storeId, job.batch_id, job.id) as JobRow[];
    for (const sibling of siblings) {
        const cancelled = this.db.prepare(`
        UPDATE ad_execution_jobs SET status = 'cancelled', revision = revision + 1,
          updated_at = ?, terminal_at = COALESCE(terminal_at, ?)
        WHERE store_id = ? AND id = ? AND revision = ?
          AND status IN ('queued', 'preflight')
      `).run(updatedAt, updatedAt, context.storeId, sibling.id, sibling.revision);
        if (cancelled.changes !== 1) {
            throw revisionConflict(`Execution sibling ${sibling.id} lost its UNKNOWN-stop CAS transition.`);
        }
        this.insertEvent({
            storeId: context.storeId,
            batchId: sibling.batch_id,
            jobId: sibling.id,
            sequence: this.nextEventSequence(context.storeId, sibling.id),
            eventType: 'cancelled',
            fromStatus: sibling.status,
            toStatus: 'cancelled',
            actorId: 'executor',
            reasonCode: 'batch_stopped_after_unknown',
            detail: 'Mission batch stopped before this action entered submit intent.',
            sessionGeneration: sibling.created_session_generation,
            createdAt: updatedAt,
        });
    }
    const batch = this.refreshBatchStatus(context.storeId, job.batch_id, updatedAt);
    if (isTerminalAdExecutionStatus(batch.status)) {
        this.ensureExecutionGrantTerminal(context.storeId, job.grant_id, job.batch_id, batch.status, updatedAt);
    }
    const projection = this.requireProjection(context.storeId, job.batch_id);
    const current = projection.jobs.find((candidate) => candidate.id === job.id);
    if (!current)
        throw notFound(`Execution job ${job.id} disappeared after UNKNOWN transition.`);
    return { job: current, batch, missionId: job.mission_id, grantId: job.grant_id };
}
export function transition(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: Omit<AdExecutionJobTransitionRequest, 'context'>, allowedFrom: readonly AdExecutionStatus[], toStatus: AdExecutionStatus, eventType: AdExecutionEventType, actorId: string, reasonCode?: string, detail?: string, times: {
    intentWrittenAt?: string;
    submittedAt?: string;
    terminalAt?: string;
    submitIntentId?: string;
    commandFingerprint?: string;
} = {}, allowStaleJobSession = false): AdExecutionTransitionResult {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        this.assertContext(context);
        const job = this.requireMutableJob(context, input.jobId, input.expectedRevision, allowedFrom, allowStaleJobSession);
        return this.applyTransition(context, job, toStatus, eventType, actorId, reasonCode, detail, times);
    });
}
export function applyTransition(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, job: JobRow, toStatus: AdExecutionStatus, eventType: AdExecutionEventType, actorId: string, reasonCode?: string, detail?: string, times: {
    intentWrittenAt?: string;
    submittedAt?: string;
    terminalAt?: string;
    submitIntentId?: string;
    commandFingerprint?: string;
} = {}): AdExecutionTransitionResult {
    if (isTerminalAdExecutionStatus(job.status)) {
        throw terminalState(`Execution job ${job.id} is terminal (${job.status}) and cannot transition.`);
    }
    const safeReasonCode = reasonCode === undefined ? undefined : idOf(reasonCode, 'reasonCode');
    const safeDetail = detail === undefined ? undefined : safeProjectionText(detail, 'detail');
    const updatedAt = this.timestamp();
    const changed = this.db.prepare(`
      UPDATE ad_execution_jobs SET status = ?, revision = revision + 1, updated_at = ?,
        submit_intent_id = COALESCE(?, submit_intent_id),
        command_fingerprint = COALESCE(?, command_fingerprint),
        intent_written_at = COALESCE(?, intent_written_at),
        submitted_at = COALESCE(?, submitted_at),
        terminal_at = COALESCE(?, terminal_at)
      WHERE store_id = ? AND id = ? AND revision = ? AND status = ?
    `).run(toStatus, updatedAt, times.submitIntentId ?? null, times.commandFingerprint ?? null, times.intentWrittenAt ?? null, times.submittedAt ?? null, times.terminalAt ?? null, context.storeId, job.id, job.revision, job.status);
    if (changed.changes !== 1)
        throw revisionConflict(`Execution job ${job.id} lost its CAS transition.`);
    if (toStatus === 'intent_written') {
        this.recordGrantSlot({ ...job, submit_intent_id: times.submitIntentId! }, 'reserved', updatedAt);
    }
    else if (toStatus === 'submitted') {
        this.recordGrantSlot(job, 'spent', updatedAt);
    }
    this.insertEvent({
        storeId: context.storeId,
        batchId: job.batch_id,
        jobId: job.id,
        sequence: this.nextEventSequence(context.storeId, job.id),
        eventType,
        fromStatus: job.status,
        toStatus,
        actorId,
        reasonCode: safeReasonCode,
        detail: safeDetail,
        sessionGeneration: context.sessionGeneration,
        createdAt: updatedAt,
    });
    const batch = this.refreshBatchStatus(context.storeId, job.batch_id, updatedAt);
    if (isTerminalAdExecutionStatus(batch.status)) {
        this.ensureExecutionGrantTerminal(context.storeId, job.grant_id, job.batch_id, batch.status, updatedAt);
    }
    const projection = this.requireProjection(context.storeId, job.batch_id);
    const projectedJob = projection.jobs.find((item) => item.id === job.id);
    if (!projectedJob)
        throw notFound(`Execution job ${job.id} disappeared after transition.`);
    return {
        job: projectedJob,
        batch,
        missionId: job.mission_id,
        grantId: job.grant_id,
    };
}
export function requireMutableJob(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, jobIdInput: string, expectedRevisionInput: number, allowedFrom: readonly AdExecutionStatus[], allowStaleJobSession = false): JobRow {
    const jobId = idOf(jobIdInput, 'jobId');
    const expectedRevision = positiveInt(expectedRevisionInput, 'expectedRevision');
    const row = this.db.prepare(`
      SELECT * FROM ad_execution_jobs WHERE store_id = ? AND id = ?
    `).get(context.storeId, jobId) as JobRow | undefined;
    if (!row)
        throw notFound(`Execution job ${jobId} was not found.`);
    if (row.revision !== expectedRevision) {
        throw revisionConflict(`Execution job revision is stale; expected ${row.revision}, received ${expectedRevision}.`);
    }
    if (!allowStaleJobSession && row.created_session_generation !== context.sessionGeneration) {
        throw new ExecutionAuthorityRepositoryError('STALE_CONTEXT', 'Execution job belongs to an earlier Amazon Ads session generation and must become UNKNOWN or terminal.');
    }
    if (isTerminalAdExecutionStatus(row.status)) {
        throw terminalState(`Execution job ${jobId} is terminal (${row.status}) and cannot be retried.`);
    }
    const batch = this.db.prepare(`
      SELECT status FROM ad_execution_batches WHERE store_id = ? AND id = ?
    `).get(context.storeId, row.batch_id) as {
        status: AdExecutionStatus;
    } | undefined;
    if (!batch)
        throw notFound(`Execution batch ${row.batch_id} was not found.`);
    if (isTerminalAdExecutionStatus(batch.status)) {
        throw terminalState(`Execution batch ${row.batch_id} is terminal (${batch.status}); remaining jobs cannot be retried.`);
    }
    if (!allowedFrom.includes(row.status)) {
        throw stateConflict(`Execution job ${jobId} cannot transition from ${row.status}.`);
    }
    return row;
}
export function refreshBatchStatus(this: ExecutionAuthorityRepositoryContext, storeId: string, batchId: string, updatedAt: string): AdExecutionBatchRecord {
    const rows = this.db.prepare(`
      SELECT status FROM ad_execution_jobs WHERE store_id = ? AND batch_id = ? ORDER BY ordinal
    `).all(storeId, batchId) as Array<{
        status: AdExecutionStatus;
    }>;
    if (rows.length === 0)
        throw stateConflict('Execution batch has no jobs.');
    const statuses = rows.map((row) => row.status);
    let status: AdExecutionStatus;
    if (statuses.includes('unknown'))
        status = 'unknown';
    else if (statuses.every((value) => value === 'succeeded'))
        status = 'succeeded';
    else if (statuses.every(isTerminalAdExecutionStatus)) {
        status = statuses.includes('blocked') ? 'blocked' : statuses.includes('cancelled') ? 'cancelled' : 'succeeded';
    }
    else if (statuses.includes('verifying'))
        status = 'verifying';
    else if (statuses.includes('submitted'))
        status = 'submitted';
    else if (statuses.includes('intent_written'))
        status = 'intent_written';
    else if (statuses.includes('preflight'))
        status = 'preflight';
    else
        status = 'queued';
    const terminalAt = isTerminalAdExecutionStatus(status) ? updatedAt : null;
    this.db.prepare(`
      UPDATE ad_execution_batches SET status = ?, revision = revision + 1,
        updated_at = ?, terminal_at = COALESCE(?, terminal_at)
      WHERE store_id = ? AND id = ?
    `).run(status, updatedAt, terminalAt, storeId, batchId);
    const row = this.db.prepare(`
      SELECT * FROM ad_execution_batches WHERE store_id = ? AND id = ?
    `).get(storeId, batchId) as BatchRow;
    return mapBatch(row);
}
