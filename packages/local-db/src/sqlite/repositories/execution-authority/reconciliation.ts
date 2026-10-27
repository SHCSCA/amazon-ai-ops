import  {
  AD_EXECUTION_RECONCILIATION_COPY,
  assertOpaqueExecutionArtifactRef,
  type AdExecutionReconciliationCase,
  type AdExecutionReconciliationObservation,
  type AdExecutionUnknownReconciliationStatus,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { ReconciliationRow, JobRow } from './contracts';
import { mapReconciliation } from './rows';
import  {
  normalizeContext,
  idOf,
  positiveInt,
  sha256Of,
  timestampOf,
  hashObject,
  invalid,
  notFound,
  referenceConflict,
  stateConflict,
} from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function beginUnknownReconciliation(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, jobId: string): {
    created: boolean;
    record: AdExecutionReconciliationCase;
} {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        this.assertContext(context);
        const job = this.db.prepare('SELECT * FROM ad_execution_jobs WHERE store_id=? AND id=?').get(context.storeId, idOf(jobId, 'jobId')) as JobRow | undefined;
        if (!job || job.status !== 'unknown' || !job.submit_intent_id)
            throw stateConflict('只允许对账原 UNKNOWN 提交意图。');
        const existing = this.db.prepare('SELECT * FROM ad_execution_reconciliation_cases WHERE store_id=? AND submit_intent_id=?').get(context.storeId, job.submit_intent_id) as ReconciliationRow | undefined;
        if (existing)
            return { created: false, record: mapReconciliation(existing) };
        const caseId = `reconciliation:${hashObject([context.storeId, job.submit_intent_id]).slice(0, 48)}`;
        this.db.prepare(`INSERT INTO ad_execution_reconciliation_cases(case_id,store_id,batch_id,job_id,submit_intent_id,context_json,started_at)
        VALUES(?,?,?,?,?,?,?)`).run(caseId, context.storeId, job.batch_id, job.id, job.submit_intent_id, JSON.stringify(context), this.timestamp());
        return { created: true, record: mapReconciliation(this.reconciliationRow(caseId)) };
    });
}
export function recordUnknownObservation(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, caseId: string, slot: 'first' | 'reload', input: AdExecutionReconciliationObservation): void {
    const context = normalizeContext(contextInput);
    if (slot !== 'first' && slot !== 'reload')
        throw invalid('对账只有首次和刷新后两个观察位置。');
    this.immediate(() => {
        this.assertContext(context);
        const row = this.reconciliationRow(caseId);
        if (row.context_json !== JSON.stringify(context) || row.outcome)
            throw stateConflict('对账上下文已变化或已永久结束。');
        const job = this.db.prepare('SELECT * FROM ad_execution_jobs WHERE store_id=? AND id=?').get(context.storeId, row.job_id) as JobRow;
        const observation: AdExecutionReconciliationObservation = {
            artifactRef: assertOpaqueExecutionArtifactRef(input.artifactRef),
            contentSha256: sha256Of(input.contentSha256, 'contentSha256'),
            pageIdentityHash: sha256Of(input.pageIdentityHash, 'pageIdentityHash'),
            capturedAt: timestampOf(input.capturedAt, 'capturedAt'),
            canonicalKeywordId: idOf(input.canonicalKeywordId, 'canonicalKeywordId'),
            objectRevision: positiveInt(input.objectRevision, 'objectRevision'),
            adsAccountId: idOf(input.adsAccountId, 'adsAccountId'),
            campaignId: idOf(input.campaignId, 'campaignId'),
            adGroupId: idOf(input.adGroupId, 'adGroupId'),
            keywordId: idOf(input.keywordId, 'keywordId'),
            observedBidCents: positiveInt(input.observedBidCents, 'observedBidCents'),
        };
        if (observation.canonicalKeywordId !== job.canonical_keyword_id || observation.objectRevision !== job.object_revision
            || observation.adsAccountId !== job.ads_account_id || observation.campaignId !== job.campaign_id
            || observation.adGroupId !== job.ad_group_id || observation.keywordId !== job.keyword_id
            || Date.parse(observation.capturedAt) < Date.parse(row.started_at)
            || Date.parse(observation.capturedAt) > this.now().getTime())
            throw referenceConflict('对账观察对象或时间不符合原 case。');
        const first = row.first_json ? JSON.parse(row.first_json) as AdExecutionReconciliationObservation : null;
        if (slot === 'reload' && (!first || Date.parse(observation.capturedAt) < Date.parse(first.capturedAt)
            || observation.artifactRef === first.artifactRef))
            throw referenceConflict('刷新后观察必须有独立证据，且晚于首次观察。');
        const column = slot === 'first' ? 'first_json' : 'reload_json';
        if (this.db.prepare(`UPDATE ad_execution_reconciliation_cases SET ${column}=? WHERE case_id=? AND ${column} IS NULL AND outcome IS NULL`)
            .run(JSON.stringify(observation), caseId).changes !== 1)
            throw stateConflict('对账观察位置已使用，不允许再次观察。');
    });
}
export function finishUnknownReconciliation(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, caseId: string, interrupted = false): AdExecutionReconciliationCase {
    const context = normalizeContext(contextInput);
    return this.immediate(() => {
        const row = this.reconciliationRow(caseId);
        if (row.context_json !== JSON.stringify(context))
            throw referenceConflict('对账 case 不属于该完整上下文。');
        if (row.outcome)
            return mapReconciliation(row);
        if (!interrupted)
            this.assertContext(context);
        const first = row.first_json ? JSON.parse(row.first_json) as AdExecutionReconciliationObservation : null;
        const reload = row.reload_json ? JSON.parse(row.reload_json) as AdExecutionReconciliationObservation : null;
        const job = this.db.prepare('SELECT * FROM ad_execution_jobs WHERE store_id=? AND id=?').get(row.store_id, row.job_id) as JobRow;
        const outcome: AdExecutionUnknownReconciliationStatus = interrupted || !first || !reload
            || first.pageIdentityHash !== reload.pageIdentityHash || first.observedBidCents !== reload.observedBidCents
            ? 'inconclusive_permanent'
            : reload.observedBidCents === job.target_bid_cents ? 'target_stably_observed'
                : reload.observedBidCents === job.expected_bid_cents ? 'original_stably_observed' : 'other_value_stably_observed';
        return this.finishReconciliationInternal(row, outcome);
    });
}
export function reconciliationRow(this: ExecutionAuthorityRepositoryContext, caseId: string): ReconciliationRow {
    const row = this.db.prepare('SELECT * FROM ad_execution_reconciliation_cases WHERE case_id=?').get(idOf(caseId, 'caseId')) as ReconciliationRow | undefined;
    if (!row)
        throw notFound('对账 case 不存在。');
    return row;
}
export function finishReconciliationInternal(this: ExecutionAuthorityRepositoryContext, row: ReconciliationRow, outcome: AdExecutionUnknownReconciliationStatus): AdExecutionReconciliationCase {
    const completedAt = this.timestamp();
    this.db.prepare('UPDATE ad_execution_reconciliation_cases SET outcome=?,completed_at=? WHERE case_id=? AND outcome IS NULL').run(outcome, completedAt, row.case_id);
    const record = mapReconciliation(this.reconciliationRow(row.case_id));
    const eventId = `causal:execution-reconciliation:${hashObject([row.store_id, row.submit_intent_id]).slice(0, 40)}`;
    this.db.prepare(`INSERT INTO causal_events(id,store_id,stage,event_type,entity_type,entity_id,mission_id,title,signal,observed_effect,
      confidence,status,source,actor_id,business_date,session_generation,sequence,created_at)
      SELECT ?,?,'READBACK','execution_unknown_reconciled','ad_execution_batch',?,mission_id,'结果不确定批次只读对账',?,?,0,?,
        'execution-authority','execution-authority',?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM causal_events WHERE store_id=?),?
      FROM ad_execution_jobs WHERE store_id=? AND id=?`).run(eventId, row.store_id, row.batch_id, `首次 ${record.first?.observedBidCents ?? '缺失'}；刷新后 ${record.reload?.observedBidCents ?? '缺失'}。`, AD_EXECUTION_RECONCILIATION_COPY[outcome], outcome, record.context.businessDate, record.context.sessionGeneration, row.store_id, completedAt, row.store_id, row.job_id);
    for (const slot of ['first', 'reload'] as const) {
        const observation = record[slot];
        if (observation)
            this.db.prepare('INSERT INTO evidence_refs(id,store_id,event_id,evidence_type,evidence_ref,sha256,created_at) VALUES(?,?,?,?,?,?,?)')
                .run(`${eventId}:${slot}`, row.store_id, eventId, `ad_execution_reconciliation_${slot}`, observation.artifactRef, observation.contentSha256, observation.capturedAt);
    }
    return record;
}
