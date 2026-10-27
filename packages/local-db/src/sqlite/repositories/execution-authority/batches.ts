import  {
  AD_EXECUTION_ACTION_TYPE,
  MAX_AD_EXECUTION_ACTIONS_PER_BATCH,
  type AdExecutionBatchProjection,
  type AdExecutionJobProjection,
  type CreateAdExecutionBatchResult,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import  {
  ReconciliationRow,
  BatchRow,
  JobRow,
  EventRow,
  EvidenceRow,
} from './contracts';
import  {
  mapReconciliation,
  mapBatch,
  mapJob,
  mapEvent,
  mapEvidence,
} from './rows';
import  {
  normalizeContext,
  idOf,
  positiveInt,
  finite,
  parseJson,
  uniqueStringArray,
  sameStringSet,
  hashObject,
  invalid,
  notFound,
  referenceConflict,
  stateConflict,
} from './values';
import type { ExecutionAuthorityRepositoryContext } from './context';
export function createExactExecutionBatch(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, grantIdInput: string): CreateAdExecutionBatchResult {
    const context = normalizeContext(contextInput);
    this.missionRepository.expireMissionGrants(context);
    const grantId = idOf(grantIdInput, 'grantId');
    return this.immediate(() => {
        this.assertContext(context);
        const existing = this.db.prepare(`
        SELECT id FROM ad_execution_batches WHERE store_id = ? AND grant_id = ?
      `).get(context.storeId, grantId) as {
            id: string;
        } | undefined;
        if (existing)
            return { created: false, projection: this.requireProjection(context.storeId, existing.id) };
        const grant = this.requireGrant(context, grantId);
        const decisionIds = uniqueStringArray(parseJson(grant.decision_ids_json, 'grant decision ids'));
        const actionTypes = uniqueStringArray(parseJson(grant.allowed_action_types_json, 'grant action types'));
        const entityIds = uniqueStringArray(parseJson(grant.allowed_ad_entity_ids_json, 'grant entity ids'));
        if (decisionIds.length === 0 || entityIds.length === 0)
            throw invalid('Execution grant scope is empty.');
        if (decisionIds.length > MAX_AD_EXECUTION_ACTIONS_PER_BATCH
            || entityIds.length > MAX_AD_EXECUTION_ACTIONS_PER_BATCH) {
            throw stateConflict(`Execution V1 allows at most ${MAX_AD_EXECUTION_ACTIONS_PER_BATCH} actions per batch.`);
        }
        if (actionTypes.length !== 1 || actionTypes[0] !== AD_EXECUTION_ACTION_TYPE) {
            throw stateConflict('Execution V1 grant must allow only set_keyword_bid.');
        }
        const rows = decisionIds.map((decisionId) => this.requireProposalDecision(context, decisionId));
        const linkedEntityIds = rows.map((row) => idOf(row.ad_entity_id, 'proposal adEntityId'));
        if (!sameStringSet(entityIds, linkedEntityIds)) {
            throw referenceConflict('Grant entity scope must exactly match its linked immutable proposals.');
        }
        const cap = Math.min(10, finite(grant.max_change_pct, 'grant maxChangePct'));
        let cumulativeImpactUsd = 0;
        const planned = rows.map((row, index) => {
            this.validateProposalDecision(context, grant, row);
            const identity = this.requireLatestIdentityForEntity(context, idOf(row.ad_entity_id, 'proposal adEntityId'), positiveInt(row.ad_entity_revision, 'proposal adEntityRevision'));
            this.assertContext(context, identity.adsAccountId);
            const expectedBidCents = positiveInt(row.current_bid_cents, 'currentBidCents');
            const targetBidCents = positiveInt(row.proposed_bid_cents, 'proposedBidCents');
            if (targetBidCents >= expectedBidCents)
                throw stateConflict('Execution V1 is downbid-only.');
            const changePct = ((targetBidCents - expectedBidCents) / expectedBidCents) * 100;
            if (changePct >= 0 || Math.abs(changePct) > cap + 1e-9 || Math.abs(changePct - row.change_pct) > 1e-6) {
                throw stateConflict(`Proposal change must be a downbid within ${cap}%.`);
            }
            cumulativeImpactUsd += Math.abs(expectedBidCents - targetBidCents) / 100;
            const idempotencyKey = hashObject([
                grant.id, row.decision_id, row.decision_revision, row.proposal_id,
                grant.action_revision, identity.canonicalKeywordId, identity.objectRevision,
                expectedBidCents, targetBidCents,
            ]);
            return { row, identity, expectedBidCents, targetBidCents, changePct, idempotencyKey, ordinal: index + 1 };
        });
        if (cumulativeImpactUsd > finite(grant.total_impact_budget, 'grant totalImpactBudget') + 1e-9) {
            throw stateConflict('Execution batch exceeds the grant total impact budget.');
        }
        const batchId = `exec-batch-${hashObject([
            context.storeId, grant.id, grant.mission_id, grant.mission_revision, grant.action_revision,
        ]).slice(0, 40)}`;
        const createdAt = this.timestamp();
        this.db.prepare(`
        INSERT INTO ad_execution_batches (
          id, store_id, marketplace, currency, mission_id, mission_revision, grant_id,
          action_revision, status, revision, created_session_generation, created_at, updated_at
        ) VALUES (?, ?, 'US', 'USD', ?, ?, ?, ?, 'queued', 1, ?, ?, ?)
      `).run(batchId, context.storeId, grant.mission_id, grant.mission_revision, grant.id, grant.action_revision, context.sessionGeneration, createdAt, createdAt);
        for (const item of planned) {
            const jobId = `exec-job-${hashObject([batchId, item.row.proposal_id]).slice(0, 40)}`;
            this.db.prepare(`
          INSERT INTO ad_execution_jobs (
            id, store_id, batch_id, ordinal, mission_id, grant_id, proposal_id,
            decision_id, decision_revision, action_revision, action_type,
            canonical_keyword_id, ad_entity_id, entity_revision, ads_account_id,
            campaign_id, ad_group_id, keyword_id, object_revision, page_identity_hash,
            expected_bid_cents, target_bid_cents, change_pct, idempotency_key,
            status, revision, created_session_generation, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'set_keyword_bid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'queued', 1, ?, ?, ?)
        `).run(jobId, context.storeId, batchId, item.ordinal, grant.mission_id, grant.id, item.row.proposal_id, item.row.decision_id, item.row.decision_revision, grant.action_revision, item.identity.canonicalKeywordId, item.identity.adEntityId, item.identity.entityRevision, item.identity.adsAccountId, item.identity.campaignId, item.identity.adGroupId, item.identity.keywordId, item.identity.objectRevision, item.identity.pageIdentityHash, item.expectedBidCents, item.targetBidCents, item.changePct, item.idempotencyKey, context.sessionGeneration, createdAt, createdAt);
            this.insertEvent({
                storeId: context.storeId,
                batchId,
                jobId,
                sequence: 1,
                eventType: 'queued',
                fromStatus: 'queued',
                toStatus: 'queued',
                actorId: 'execution-authority',
                sessionGeneration: context.sessionGeneration,
                createdAt,
            });
        }
        return { created: true, projection: this.requireProjection(context.storeId, batchId) };
    });
}
export function getExecutionBatch(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope, batchIdInput: string): AdExecutionBatchProjection | undefined {
    const context = normalizeContext(contextInput);
    this.assertStoreContext(context);
    const batchId = idOf(batchIdInput, 'batchId');
    const row = this.db.prepare(`
      SELECT id FROM ad_execution_batches WHERE store_id = ? AND id = ?
    `).get(context.storeId, batchId);
    return row ? this.requireProjection(context.storeId, batchId) : undefined;
}
export function listExecutionBatches(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
    const context = normalizeContext(contextInput);
    this.assertStoreContext(context);
    return (this.db.prepare(`
      SELECT id FROM ad_execution_batches WHERE store_id = ? ORDER BY created_at DESC, id DESC
    `).all(context.storeId) as Array<{
        id: string;
    }>).map((row) => this.requireProjection(context.storeId, row.id));
}
export function listExecutionBatchesForStoreReconciliation(this: ExecutionAuthorityRepositoryContext, contextInput: StoreContextEnvelope): readonly AdExecutionBatchProjection[] {
    const context = normalizeContext(contextInput);
    this.assertStoreContext(context);
    return (this.db.prepare(`
      SELECT id FROM ad_execution_batches WHERE store_id = ? ORDER BY created_at, id
    `).all(context.storeId) as Array<{
        id: string;
    }>)
        .map((row) => this.requireProjection(context.storeId, row.id));
}
export function requireProjection(this: ExecutionAuthorityRepositoryContext, storeId: string, batchId: string): AdExecutionBatchProjection {
    const batchRow = this.db.prepare(`
      SELECT * FROM ad_execution_batches WHERE store_id = ? AND id = ?
    `).get(storeId, batchId) as BatchRow | undefined;
    if (!batchRow)
        throw notFound(`Execution batch ${batchId} was not found.`);
    const jobs = (this.db.prepare(`
      SELECT * FROM ad_execution_jobs WHERE store_id = ? AND batch_id = ? ORDER BY ordinal
    `).all(storeId, batchId) as JobRow[]).map((row): AdExecutionJobProjection => ({
        ...mapJob(row),
        evidence: (this.db.prepare(`
        SELECT * FROM ad_execution_evidence WHERE store_id = ? AND job_id = ?
        ORDER BY CASE slot WHEN 'before' THEN 1 WHEN 'after' THEN 2 WHEN 'reload' THEN 3 END
      `).all(storeId, row.id) as EvidenceRow[]).map(mapEvidence),
        events: (this.db.prepare(`
        SELECT * FROM ad_execution_events WHERE store_id = ? AND job_id = ? ORDER BY sequence
      `).all(storeId, row.id) as EventRow[]).map(mapEvent),
    }));
    const row = this.db.prepare('SELECT * FROM ad_execution_reconciliation_cases WHERE store_id=? AND batch_id=?').get(storeId, batchId) as ReconciliationRow | undefined;
    return { batch: mapBatch(batchRow), jobs, ...(row ? { reconciliation: mapReconciliation(row) } : {}) };
}
