import { type AdExecutionStatus, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import  {
  AppendPolicyGrantDispatchEventInput,
  PolicyGrantDispatchRecord,
  PolicyGrantDispatchEventRow,
  PolicyGrantDispatchPayload,
} from './contracts';
import  {
  POLICY_GRANT_DISPATCH_ENTITY_TYPE,
  POLICY_GRANT_DISPATCH_SOURCE,
  POLICY_GRANT_DISPATCH_STATUSES,
  POLICY_GRANT_DISPATCH_TRIGGERS,
  POLICY_GRANT_DISPATCH_CODES,
  assertPolicyGrantDispatchTransition,
  parsePolicyGrantDispatchPayload,
} from './dispatch-values';
import  {
  policyGrantDispatchEventType,
  policyGrantDispatchTitle,
  policyGrantDispatchCodeSupportsStatus,
  policyGrantDispatchDetail,
  normalizeContext,
  idOf,
  timestampOf,
  hashObject,
  invalid,
  notFound,
  referenceConflict,
  stateConflict,
} from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function appendPolicyGrantDispatchEvent(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, input: AppendPolicyGrantDispatchEventInput): PolicyGrantDispatchRecord {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        this.assertStoreContext(context);
        this.appendPolicyGrantDispatchEventInternal(context, input, this.timestamp());
        const record = this.listPolicyGrantDispatchesInternal(context)
            .find((candidate) => candidate.grantId === idOf(input.grantId, 'grantId'));
        if (!record)
            throw notFound(`Policy grant dispatch ${input.grantId} was not found.`);
        return record;
    });
}
export function listPolicyGrantDispatches(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope): readonly PolicyGrantDispatchRecord[] {
    const context = normalizeContext(contextInput);
    this.assertStoreContext(context);
    return this.listPolicyGrantDispatchesInternal(context);
}
export function listPolicyGrantDispatchesInternal(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope): PolicyGrantDispatchRecord[] {
    const grants = this.db.prepare(`
      SELECT id, mission_id AS missionId, expires_at AS expiresAt,
             created_session_generation AS grantSessionGeneration
      FROM mission_grants
      WHERE store_id = ? AND issuer_type = 'policy'
        AND EXISTS (
          SELECT 1 FROM mission_grant_events issued
          WHERE issued.store_id = mission_grants.store_id
            AND issued.grant_id = mission_grants.id
            AND issued.event_type = 'issued'
        )
      ORDER BY issued_at, id
    `).all(context.storeId) as Array<{
        id: string;
        missionId: string;
        expiresAt: string;
        grantSessionGeneration: number;
    }>;
    return grants.map((grant): PolicyGrantDispatchRecord => {
        const event = this.db.prepare(`
        SELECT id, event_type, signal, status, created_at
        FROM causal_events
        WHERE store_id = ? AND entity_type = ? AND entity_id = ? AND source = ?
        ORDER BY sequence DESC, id DESC LIMIT 1
      `).get(context.storeId, POLICY_GRANT_DISPATCH_ENTITY_TYPE, grant.id, POLICY_GRANT_DISPATCH_SOURCE) as PolicyGrantDispatchEventRow | undefined;
        const payload = event ? parsePolicyGrantDispatchPayload(event) : undefined;
        const batch = this.db.prepare(`
        SELECT id, status FROM ad_execution_batches
        WHERE store_id = ? AND grant_id = ?
        ORDER BY created_at, id LIMIT 1
      `).get(context.storeId, grant.id) as {
            id: string;
            status: AdExecutionStatus;
        } | undefined;
        const batchJobs = this.db.prepare(`
        SELECT status, submit_intent_id AS submitIntentId,
               intent_written_at AS intentWrittenAt, submitted_at AS submittedAt
        FROM ad_execution_jobs
        WHERE store_id = ? AND grant_id = ?
        ORDER BY ordinal, id
      `).all(context.storeId, grant.id) as Array<{
            status: AdExecutionStatus;
            submitIntentId: string | null;
            intentWrittenAt: string | null;
            submittedAt: string | null;
        }>;
        const batchJobStatuses = batchJobs.map((job) => job.status);
        const batchHasPersistedIntent = batchJobs.some((job) => (job.submitIntentId !== null
            || job.intentWrittenAt !== null
            || job.submittedAt !== null
            || ['intent_written', 'submitted', 'verifying', 'unknown'].includes(job.status)));
        const terminal = this.db.prepare(`
        SELECT event_type AS eventType FROM mission_grant_events
        WHERE store_id = ? AND grant_id = ?
          AND event_type IN ('revoked', 'consumed', 'expired', 'invalidated')
        ORDER BY created_at DESC, id DESC LIMIT 1
      `).get(context.storeId, grant.id) as {
            eventType: 'revoked' | 'consumed' | 'expired' | 'invalidated';
        } | undefined;
        const attemptCount = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM causal_events
        WHERE store_id = ? AND entity_type = ? AND entity_id = ? AND source = ?
          AND event_type = 'policy_grant_dispatch_attempt_started_v1'
      `).get(context.storeId, POLICY_GRANT_DISPATCH_ENTITY_TYPE, grant.id, POLICY_GRANT_DISPATCH_SOURCE) as {
            count: number;
        }).count);
        const corrupted = Boolean(event && !payload);
        return {
            storeId: context.storeId,
            grantId: grant.id,
            missionId: grant.missionId,
            status: corrupted ? 'attention_required' : (payload?.status ?? 'pending'),
            attemptCount,
            ...(event ? { eventId: event.id, updatedAt: event.created_at } : {}),
            ...(payload ? {
                trigger: payload.trigger,
                code: payload.code,
                detail: payload.detail,
                ...(payload.nextRetryAt ? { nextRetryAt: payload.nextRetryAt } : {}),
            } : corrupted ? {
                code: 'UNSAFE_DISPATCH_FAILURE' as const,
                detail: 'The durable policy dispatch journal is invalid and requires repair.',
            } : {}),
            ...(batch ? { batchId: batch.id, batchStatus: batch.status } : {}),
            batchJobCount: batchJobs.length,
            batchJobStatuses,
            batchHasPersistedIntent,
            grantExpiresAt: grant.expiresAt,
            grantSessionGeneration: grant.grantSessionGeneration,
            ...(terminal ? { terminalGrantEventType: terminal.eventType } : {}),
        };
    });
}
export function appendPolicyGrantDispatchEventInternal(this: ExecutionAuthorityRepositoryContext, context: StoreContextEnvelope, input: AppendPolicyGrantDispatchEventInput, createdAt: string): void {
    const grantId = idOf(input.grantId, 'grantId');
    if (!POLICY_GRANT_DISPATCH_STATUSES.includes(input.status)) {
        throw invalid('Unknown policy grant dispatch status.');
    }
    if (!POLICY_GRANT_DISPATCH_TRIGGERS.includes(input.trigger)) {
        throw invalid('Unknown policy grant dispatch trigger.');
    }
    if (!POLICY_GRANT_DISPATCH_CODES.includes(input.code)) {
        throw invalid('Unknown policy grant dispatch code.');
    }
    if (!policyGrantDispatchCodeSupportsStatus(input.code, input.status)) {
        throw invalid(`Policy grant dispatch code ${input.code} does not match status ${input.status}.`);
    }
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) {
        throw invalid('Policy grant dispatch attempt must be a non-negative integer.');
    }
    const grant = this.db.prepare(`
      SELECT mission_id AS missionId, issuer_type AS issuerType
      FROM mission_grants WHERE store_id = ? AND id = ?
    `).get(context.storeId, grantId) as {
        missionId: string;
        issuerType: 'human' | 'policy';
    } | undefined;
    if (!grant)
        throw notFound(`Mission grant ${grantId} was not found.`);
    if (grant.issuerType !== 'policy') {
        throw stateConflict('Only a policy-issued MissionGrant may enter the policy dispatch journal.');
    }
    const batchId = input.batchId ? idOf(input.batchId, 'batchId') : undefined;
    const nextRetryAt = input.nextRetryAt
        ? timestampOf(input.nextRetryAt, 'nextRetryAt')
        : undefined;
    if (batchId) {
        const batch = this.db.prepare(`
        SELECT 1 FROM ad_execution_batches
        WHERE store_id = ? AND id = ? AND grant_id = ?
      `).get(context.storeId, batchId, grantId);
        if (!batch)
            throw referenceConflict('Policy dispatch batch does not match the grant lineage.');
    }
    if ((input.status === 'completed' || input.status === 'queued_for_execution') && !batchId) {
        throw invalid(`${input.status} policy dispatch events must reference a durable execution batch.`);
    }
    if (input.status !== 'waiting_runtime' && nextRetryAt) {
        throw invalid('Only waiting_runtime dispatch events may carry nextRetryAt.');
    }
    const payload: PolicyGrantDispatchPayload = {
        schemaVersion: 1,
        trigger: input.trigger,
        status: input.status,
        attempt: input.attempt,
        code: input.code,
        detail: policyGrantDispatchDetail(input.code),
        ...(batchId ? { batchId } : {}),
        ...(nextRetryAt ? { nextRetryAt } : {}),
    };
    const signal = JSON.stringify(payload);
    const eventType = policyGrantDispatchEventType(input.status);
    const eventId = `causal:policy-dispatch:${hashObject([
        context.storeId,
        grantId,
        eventType,
        payload.attempt,
        payload.code,
        payload.batchId ?? null,
    ]).slice(0, 40)}`;
    const existing = this.db.prepare(`
      SELECT event_type AS eventType, entity_type AS entityType, entity_id AS entityId,
             mission_id AS missionId, signal, status, source
      FROM causal_events WHERE store_id = ? AND id = ?
    `).get(context.storeId, eventId) as {
        eventType: string;
        entityType: string;
        entityId: string;
        missionId: string | null;
        signal: string | null;
        status: string;
        source: string;
    } | undefined;
    if (existing) {
        if (existing.eventType !== eventType
            || existing.entityType !== POLICY_GRANT_DISPATCH_ENTITY_TYPE
            || existing.entityId !== grantId
            || existing.missionId !== grant.missionId
            || existing.signal !== signal
            || existing.status !== input.status
            || existing.source !== POLICY_GRANT_DISPATCH_SOURCE) {
            throw referenceConflict(`Policy grant dispatch event ${eventId} conflicts with existing lineage.`);
        }
        return;
    }
    const latest = this.db.prepare(`
      SELECT id, event_type, signal, status, created_at
      FROM causal_events
      WHERE store_id = ? AND entity_type = ? AND entity_id = ? AND source = ?
      ORDER BY sequence DESC, id DESC LIMIT 1
    `).get(context.storeId, POLICY_GRANT_DISPATCH_ENTITY_TYPE, grantId, POLICY_GRANT_DISPATCH_SOURCE) as PolicyGrantDispatchEventRow | undefined;
    const latestPayload = latest ? parsePolicyGrantDispatchPayload(latest) : undefined;
    if (latest && !latestPayload) {
        throw stateConflict('The existing policy grant dispatch journal is invalid and cannot transition.');
    }
    assertPolicyGrantDispatchTransition(latestPayload, payload);
    const sequence = Number((this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM causal_events WHERE store_id = ?
    `).get(context.storeId) as {
        nextSequence: number;
    }).nextSequence);
    this.db.prepare(`
      INSERT INTO causal_events (
        id, store_id, stage, event_type, entity_type, entity_id,
        mission_id, title, signal, intervention, expected_effect, observed_effect,
        confidence, status, source, actor_id, business_date,
        session_generation, corrects_event_id, sequence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL,
        NULL, ?, ?, 'policy-grant-dispatcher', ?, ?, NULL, ?, ?)
    `).run(eventId, context.storeId, input.status === 'attempting' || input.status === 'completed' ? 'ACTION' : 'DECISION', eventType, POLICY_GRANT_DISPATCH_ENTITY_TYPE, grantId, grant.missionId, policyGrantDispatchTitle(input.status), signal, input.status, POLICY_GRANT_DISPATCH_SOURCE, context.businessDate, context.sessionGeneration, sequence, createdAt);
}
