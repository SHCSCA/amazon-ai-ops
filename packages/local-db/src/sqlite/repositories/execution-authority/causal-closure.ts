import  {
  assertOpaqueExecutionArtifactRef,
  isTerminalAdExecutionStatus,
  type AdExecutionStatus,
  type CompleteAdExecutionDomainReconciliationResult,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import  {
  BatchRow,
  EvidenceRow,
  DomainReconciliationRow,
  CausalEvidenceRefRow,
} from './contracts';
import { mapDomainReconciliation } from './rows';
import  {
  normalizeContext,
  idOf,
  hashObject,
  notFound,
  referenceConflict,
  stateConflict,
} from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function ensureCausalEvidenceRef(this: ExecutionAuthorityRepositoryContext, storeId: string, eventId: string, evidence: EvidenceRow, createdAt: string, identityScope?: string): void {
    const evidenceType = `ad_execution_${evidence.slot}`;
    const evidenceRef = assertOpaqueExecutionArtifactRef(evidence.artifact_ref);
    const id = `execution-evidence-ref:${hashObject(identityScope ? [identityScope, evidence.job_id, evidence.slot] : [evidence.job_id, evidence.slot]).slice(0, 48)}`;
    const exact = (row: CausalEvidenceRefRow): boolean => (row.store_id === storeId
        && row.event_id === eventId
        && row.evidence_type === evidenceType
        && row.evidence_ref === evidenceRef
        && row.sha256 === evidence.content_sha256);
    const byId = this.db.prepare(`
      SELECT * FROM evidence_refs WHERE id = ?
    `).get(id) as CausalEvidenceRefRow | undefined;
    if (byId && !exact(byId)) {
        throw referenceConflict(`Execution evidence reference ${id} conflicts with existing lineage.`);
    }
    const byLineage = this.db.prepare(`
      SELECT * FROM evidence_refs
      WHERE store_id = ? AND event_id = ? AND evidence_type = ? AND evidence_ref = ?
    `).get(storeId, eventId, evidenceType, evidenceRef) as CausalEvidenceRefRow | undefined;
    if (byLineage && !exact(byLineage)) {
        throw referenceConflict(`Execution evidence ${evidence.job_id}/${evidence.slot} conflicts with existing proof.`);
    }
    if (byId || byLineage)
        return;
    this.db.prepare(`
      INSERT INTO evidence_refs (
        id, store_id, event_id, evidence_type, evidence_ref, sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, storeId, eventId, evidenceType, evidenceRef, evidence.content_sha256, createdAt);
}
export function ensureExecutionGrantTerminal(this: ExecutionAuthorityRepositoryContext, storeId: string, grantId: string, batchId: string, batchStatus: Extract<AdExecutionStatus, 'succeeded' | 'blocked' | 'unknown' | 'cancelled'>, createdAt: string): boolean {
    const expectedEvent = batchStatus === 'succeeded' ? 'consumed' : 'invalidated';
    const existing = this.db.prepare(`
      SELECT event_type AS eventType, actor_id AS actorId, reason, created_at AS createdAt
      FROM mission_grant_events
      WHERE store_id = ? AND grant_id = ?
        AND event_type = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(storeId, grantId, expectedEvent) as {
        eventType: string;
        actorId: string;
        reason: string | null;
        createdAt: string;
    } | undefined;
    if (existing) {
        this.ensureExecutionGrantCausalEvent(storeId, grantId, batchId, expectedEvent, existing.actorId, existing.reason, existing.createdAt);
        return false;
    }
    this.db.prepare(`
      INSERT INTO mission_grant_events (
        id, store_id, grant_id, event_type, actor_id, reason, created_at
      ) VALUES (?, ?, ?, ?, 'execution-ledger', ?, ?)
    `).run(`grant-execution-terminal-${hashObject([storeId, grantId, batchId, expectedEvent]).slice(0, 36)}`, storeId, grantId, expectedEvent, batchStatus === 'succeeded'
        ? '授权额度已全部消费；执行效果以各动作的刷新回读为准。'
        : `执行批次已终止（${batchStatus}），剩余授权失效，已提交额度不返还。`, createdAt);
    this.ensureExecutionGrantCausalEvent(storeId, grantId, batchId, expectedEvent, 'execution-ledger', batchStatus === 'succeeded'
        ? '授权额度已全部消费；执行效果以各动作的刷新回读为准。'
        : `执行批次已终止（${batchStatus}），剩余授权失效，已提交额度不返还。`, createdAt);
    return true;
}
export function ensureExecutionGrantCausalEvent(this: ExecutionAuthorityRepositoryContext, storeId: string, grantId: string, batchId: string, eventType: 'consumed' | 'invalidated', actorId: string, reason: string | null, createdAt: string): void {
    const id = `causal:grant:${grantId}:${eventType}`;
    const existing = this.db.prepare(`
      SELECT 1 FROM causal_events WHERE store_id = ? AND id = ?
    `).get(storeId, id);
    if (existing)
        return;
    const authority = this.db.prepare(`
      SELECT grant.mission_id AS missionId, mission.business_date AS businessDate,
             batch.created_session_generation AS sessionGeneration
      FROM mission_grants grant
      JOIN missions mission ON mission.store_id = grant.store_id AND mission.id = grant.mission_id
      JOIN ad_execution_batches batch ON batch.store_id = grant.store_id
        AND batch.grant_id = grant.id AND batch.id = ?
      WHERE grant.store_id = ? AND grant.id = ?
    `).get(batchId, storeId, grantId) as {
        missionId: string;
        businessDate: string;
        sessionGeneration: number;
    } | undefined;
    if (!authority)
        throw referenceConflict('Execution grant causal authority is incomplete.');
    const sequence = Number((this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM causal_events WHERE store_id = ?
    `).get(storeId) as {
        nextSequence: number;
    }).nextSequence);
    this.db.prepare(`
      INSERT INTO causal_events (
        id, store_id, stage, event_type, entity_type, entity_id,
        mission_id, title, signal, intervention, expected_effect, observed_effect,
        confidence, status, source, actor_id, business_date,
        session_generation, corrects_event_id, sequence, created_at
      ) VALUES (?, ?, ?, ?, 'mission_grant', ?, ?, ?, NULL, ?, NULL, NULL,
        NULL, ?, 'execution-ledger', ?, ?, ?, NULL, ?, ?)
    `).run(id, storeId, eventType === 'consumed' ? 'ACTION' : 'DECISION', `mission_grant_${eventType}`, grantId, authority.missionId, `MissionGrant ${eventType}`, reason, eventType, idOf(actorId, 'actorId'), authority.businessDate, authority.sessionGeneration, sequence, createdAt);
}
export function completeDomainReconciliation(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, batchIdInput: string): CompleteAdExecutionDomainReconciliationResult {
    const context = normalizeContext(contextInput);
    const batchId = idOf(batchIdInput, 'batchId');
    return this.immediate(() => {
        this.assertContext(context);
        const batch = this.db.prepare(`
        SELECT * FROM ad_execution_batches WHERE store_id = ? AND id = ?
      `).get(context.storeId, batchId) as BatchRow | undefined;
        if (!batch)
            throw notFound(`Execution batch ${batchId} was not found.`);
        if (!isTerminalAdExecutionStatus(batch.status)) {
            throw stateConflict(`Execution batch ${batchId} is not terminal.`);
        }
        this.ensureExecutionGrantTerminal(context.storeId, batch.grant_id, batch.id, batch.status, batch.terminal_at ?? this.timestamp());
        const grantTerminal = batch.status === 'succeeded' ? 'consumed' : 'invalidated';
        const causalEventId = `causal:grant:${batch.grant_id}:${grantTerminal}`;
        if (!this.db.prepare(`
        SELECT 1 FROM causal_events WHERE store_id = ? AND id = ?
      `).get(context.storeId, causalEventId)) {
            throw referenceConflict(`Execution batch ${batchId} has no causal grant terminal event.`);
        }
        const evidenceRows = this.db.prepare(`
        SELECT evidence.*
        FROM ad_execution_evidence evidence
        JOIN ad_execution_jobs job
          ON job.store_id = evidence.store_id AND job.id = evidence.job_id
        WHERE evidence.store_id = ? AND evidence.batch_id = ?
        ORDER BY job.ordinal,
          CASE evidence.slot WHEN 'before' THEN 1 WHEN 'after' THEN 2 ELSE 3 END
      `).all(context.storeId, batchId) as EvidenceRow[];
        this.ensureVerifiedReadbackMemory(batch, evidenceRows);
        const completedAt = this.timestamp();
        for (const evidence of evidenceRows) {
            this.ensureCausalEvidenceRef(context.storeId, causalEventId, evidence, completedAt);
        }
        const existing = this.db.prepare(`
        SELECT * FROM ad_execution_domain_reconciliations
        WHERE store_id = ? AND batch_id = ?
      `).get(context.storeId, batchId) as DomainReconciliationRow | undefined;
        if (existing) {
            if (existing.batch_status !== batch.status
                || existing.evidence_ref_count !== evidenceRows.length) {
                throw referenceConflict(`Execution batch ${batchId} reconciliation conflicts with its terminal ledger.`);
            }
            return { created: false, reconciliation: mapDomainReconciliation(existing) };
        }
        const id = `execution-domain-reconciliation:${hashObject([
            context.storeId,
            batchId,
        ]).slice(0, 48)}`;
        this.db.prepare(`
        INSERT INTO ad_execution_domain_reconciliations (
          id, store_id, batch_id, batch_status, evidence_ref_count,
          completed_session_generation, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, context.storeId, batchId, batch.status, evidenceRows.length, context.sessionGeneration, completedAt);
        const reconciliation = this.db.prepare(`
        SELECT * FROM ad_execution_domain_reconciliations
        WHERE store_id = ? AND batch_id = ?
      `).get(context.storeId, batchId) as DomainReconciliationRow;
        return { created: true, reconciliation: mapDomainReconciliation(reconciliation) };
    });
}
