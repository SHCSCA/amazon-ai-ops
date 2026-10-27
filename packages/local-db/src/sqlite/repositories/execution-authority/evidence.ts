import  {
  assertOpaqueExecutionArtifactRef,
  type AdExecutionEvidenceInput,
  type AdExecutionEvidenceSlot,
  type AdExecutionEventType,
  type AdExecutionStatus,
  type RecordAdExecutionPreflightRequest,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { JobRow } from './contracts';
import  {
  idOf,
  optionalText,
  positiveInt,
  sha256Of,
  timestampOf,
  hashObject,
  referenceConflict,
  stateConflict,
} from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function assertExactReadback(this: ExecutionAuthorityRepositoryContext, job: JobRow, input: Pick<RecordAdExecutionPreflightRequest, 'pageIdentityHash' | 'canonicalKeywordId' | 'objectRevision'>): void {
    const pageIdentityHash = sha256Of(input.pageIdentityHash, 'pageIdentityHash');
    if (pageIdentityHash !== job.page_identity_hash
        || idOf(input.canonicalKeywordId, 'canonicalKeywordId') !== job.canonical_keyword_id
        || positiveInt(input.objectRevision, 'objectRevision') !== job.object_revision) {
        throw referenceConflict('Observed page identity or canonical object revision drifted from the job authority.');
    }
}
export function assertEvidenceMatchesJob(this: ExecutionAuthorityRepositoryContext, job: JobRow, evidence: AdExecutionEvidenceInput): void {
    assertOpaqueExecutionArtifactRef(evidence.artifactRef);
    sha256Of(evidence.contentSha256, 'contentSha256');
    const capturedAt = timestampOf(evidence.capturedAt, 'capturedAt');
    if (Date.parse(capturedAt) > this.now().getTime()) {
        throw referenceConflict('Execution evidence cannot be captured in the future.');
    }
    positiveInt(evidence.observedBidCents, 'observedBidCents');
    this.assertExactReadback(job, evidence);
}
export function insertEvidence(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, job: JobRow, slot: AdExecutionEvidenceSlot, evidence: AdExecutionEvidenceInput): void {
    const artifactRef = assertOpaqueExecutionArtifactRef(evidence.artifactRef);
    const createdAt = this.timestamp();
    const id = `exec-evidence-${hashObject([context.storeId, job.id, slot]).slice(0, 40)}`;
    try {
        this.db.prepare(`
        INSERT INTO ad_execution_evidence (
          id, store_id, batch_id, job_id, slot, artifact_ref, content_sha256,
          page_identity_hash, canonical_keyword_id, object_revision, observed_bid_cents,
          captured_session_generation, captured_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, context.storeId, job.batch_id, job.id, slot, artifactRef, sha256Of(evidence.contentSha256, 'contentSha256'), sha256Of(evidence.pageIdentityHash, 'pageIdentityHash'), idOf(evidence.canonicalKeywordId, 'canonicalKeywordId'), positiveInt(evidence.objectRevision, 'objectRevision'), positiveInt(evidence.observedBidCents, 'observedBidCents'), context.sessionGeneration, timestampOf(evidence.capturedAt, 'capturedAt'), createdAt);
    }
    catch (error) {
        if (String(error).includes('UNIQUE constraint failed')) {
            throw stateConflict(`Execution evidence slot ${slot} is already sealed.`);
        }
        throw error;
    }
}
export function insertEvent(this: ExecutionAuthorityRepositoryContext, input: {
    storeId: string;
    batchId: string;
    jobId: string;
    sequence: number;
    eventType: AdExecutionEventType;
    fromStatus: AdExecutionStatus;
    toStatus: AdExecutionStatus;
    actorId: string;
    reasonCode?: string;
    detail?: string;
    sessionGeneration: number;
    createdAt: string;
}): void {
    const eventId = `exec-event-${hashObject([input.storeId, input.jobId, input.sequence, input.eventType]).slice(0, 40)}`;
    this.db.prepare(`
      INSERT INTO ad_execution_events (
        id, store_id, batch_id, job_id, sequence, event_type, from_status, to_status,
        actor_id, reason_code, detail, session_generation, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(eventId, input.storeId, input.batchId, input.jobId, input.sequence, input.eventType, input.fromStatus, input.toStatus, idOf(input.actorId, 'actorId'), optionalText(input.reasonCode), optionalText(input.detail), input.sessionGeneration, input.createdAt);
}
export function nextEventSequence(this: ExecutionAuthorityRepositoryContext, storeId: string, jobId: string): number {
    return Number((this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
      FROM ad_execution_events WHERE store_id = ? AND job_id = ?
    `).get(storeId, jobId) as {
        sequence: number;
    }).sequence);
}
export function recordGrantSlot(this: ExecutionAuthorityRepositoryContext, job: JobRow, eventType: 'reserved' | 'spent', createdAt: string): void {
    if (!job.submit_intent_id)
        throw referenceConflict('Grant slot has no durable submit intent.');
    const existing = this.db.prepare(`SELECT submit_intent_id AS intent FROM mission_grant_events
      WHERE store_id=? AND grant_id=? AND job_id=? AND event_type=?`).get(job.store_id, job.grant_id, job.id, eventType) as {
        intent: string;
    } | undefined;
    if (existing) {
        if (existing.intent !== job.submit_intent_id)
            throw referenceConflict('Grant slot intent changed.');
        return;
    }
    if (eventType === 'spent' && !this.db.prepare(`SELECT 1 FROM mission_grant_events
      WHERE store_id=? AND grant_id=? AND job_id=? AND event_type='reserved'`).get(job.store_id, job.grant_id, job.id)) {
        return;
    }
    this.db.prepare(`INSERT INTO mission_grant_events(id,store_id,grant_id,event_type,actor_id,reason,created_at,job_id,submit_intent_id,impact_cents)
      VALUES(?,?,?,?,'execution-ledger',?,?,?,?,?)`).run(`grant-slot:${job.id}:${eventType}`, job.store_id, job.grant_id, eventType, eventType === 'reserved' ? '提交意图已持久化，单次提交额度已占用。' : '已提交或无法证明未提交，单次提交额度永久花费；不代表执行成功。', createdAt, job.id, job.submit_intent_id, job.expected_bid_cents - job.target_bid_cents);
    if (eventType === 'spent') {
        const usage = this.db.prepare(`SELECT json_array_length(grant.allowed_ad_entity_ids_json) AS total,
        (SELECT COUNT(*) FROM mission_grant_events event WHERE event.store_id=grant.store_id AND event.grant_id=grant.id AND event.event_type='spent') AS spent
        FROM mission_grants grant WHERE store_id=? AND id=?`).get(job.store_id, job.grant_id) as {
            total: number;
            spent: number;
        };
        if (usage.spent === usage.total && !this.db.prepare(`SELECT 1 FROM mission_grant_events WHERE store_id=? AND grant_id=? AND event_type='consumed'`).get(job.store_id, job.grant_id)) {
            const reason = '全部单次提交额度已花费；执行是否成功由独立回读确定。';
            this.db.prepare(`INSERT INTO mission_grant_events(id,store_id,grant_id,event_type,actor_id,reason,created_at)
          VALUES(?,?,?,'consumed','execution-ledger',?,?)`).run(`grant-slots-consumed:${job.grant_id}`, job.store_id, job.grant_id, reason, createdAt);
            this.ensureExecutionGrantCausalEvent(job.store_id, job.grant_id, job.batch_id, 'consumed', 'execution-ledger', reason, createdAt);
        }
    }
}
