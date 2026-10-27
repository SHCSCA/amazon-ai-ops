import  {
  type AdExecutionReconciliationCase,
  type AdExecutionBatchRecord,
  type AdExecutionDomainReconciliationRecord,
  type AdExecutionEvidenceRecord,
  type AdExecutionEventRecord,
  type AdExecutionJobRecord,
  type AdKeywordAliasResolutionRecord,
  type AdKeywordIdentityVersionRecord,
} from '@amazon-ai-ops/shared-types';
import  {
  IdentityRow,
  ReconciliationRow,
  AliasRow,
  BatchRow,
  JobRow,
  EventRow,
  EvidenceRow,
  DomainReconciliationRow,
} from './contracts';
import { normalizeContext } from './values';
export function mapReconciliation(row: ReconciliationRow): AdExecutionReconciliationCase {
    return { caseId: row.case_id, context: normalizeContext(JSON.parse(row.context_json)), batchId: row.batch_id, jobId: row.job_id,
        submitIntentId: row.submit_intent_id, startedAt: row.started_at, first: row.first_json ? JSON.parse(row.first_json) : null,
        reload: row.reload_json ? JSON.parse(row.reload_json) : null, outcome: row.outcome, completedAt: row.completed_at };
}
export function mapIdentity(row: IdentityRow): AdKeywordIdentityVersionRecord {
    return {
        identityVersionId: row.identity_version_id,
        storeId: row.store_id as AdKeywordIdentityVersionRecord['storeId'],
        marketplace: row.marketplace,
        currency: row.currency,
        canonicalKeywordId: row.canonical_keyword_id,
        adEntityId: row.ad_entity_id,
        entityRevision: row.entity_revision,
        adsAccountId: row.ads_account_id,
        campaignId: row.campaign_id,
        adGroupId: row.ad_group_id,
        keywordId: row.keyword_id,
        objectRevision: row.object_revision,
        observedBidCents: row.observed_bid_cents,
        pageIdentityHash: row.page_identity_hash,
        sourceAuthorityId: row.source_authority_id,
        sourceAuthorityProofSha256: row.source_authority_proof_sha256,
        resolutionProofSha256: row.resolution_proof_sha256,
        resolvedSessionGeneration: row.resolved_session_generation,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        createdAt: row.created_at,
    };
}
export function mapAlias(row: AliasRow): AdKeywordAliasResolutionRecord {
    return {
        id: row.id,
        storeId: row.store_id as AdKeywordAliasResolutionRecord['storeId'],
        aliasType: row.alias_type,
        aliasHash: row.alias_hash,
        canonicalKeywordId: row.canonical_keyword_id,
        objectRevision: row.object_revision,
        resolutionRevision: row.resolution_revision,
        status: row.status,
        reason: row.reason ?? undefined,
        resolvedSessionGeneration: row.resolved_session_generation,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
    };
}
export function mapBatch(row: BatchRow): AdExecutionBatchRecord {
    return {
        id: row.id,
        storeId: row.store_id as AdExecutionBatchRecord['storeId'],
        marketplace: row.marketplace,
        currency: row.currency,
        missionId: row.mission_id,
        missionRevision: row.mission_revision,
        grantId: row.grant_id,
        actionRevision: row.action_revision,
        status: row.status,
        revision: row.revision,
        createdSessionGeneration: row.created_session_generation,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        terminalAt: row.terminal_at ?? undefined,
    };
}
export function mapJob(row: JobRow): AdExecutionJobRecord {
    return {
        id: row.id,
        storeId: row.store_id as AdExecutionJobRecord['storeId'],
        batchId: row.batch_id,
        ordinal: row.ordinal,
        missionId: row.mission_id,
        grantId: row.grant_id,
        proposalId: row.proposal_id,
        decisionId: row.decision_id,
        decisionRevision: row.decision_revision,
        actionRevision: row.action_revision,
        actionType: row.action_type,
        canonicalKeywordId: row.canonical_keyword_id,
        adEntityId: row.ad_entity_id,
        entityRevision: row.entity_revision,
        identity: {
            storeId: row.store_id as AdExecutionJobRecord['storeId'],
            marketplace: 'US',
            currency: 'USD',
            adsAccountId: row.ads_account_id,
            campaignId: row.campaign_id,
            adGroupId: row.ad_group_id,
            keywordId: row.keyword_id,
            objectRevision: row.object_revision,
        },
        pageIdentityHash: row.page_identity_hash,
        expectedBidCents: row.expected_bid_cents,
        targetBidCents: row.target_bid_cents,
        changePct: row.change_pct,
        idempotencyKey: row.idempotency_key,
        status: row.status,
        revision: row.revision,
        createdSessionGeneration: row.created_session_generation,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        submitIntentId: row.submit_intent_id ?? undefined,
        commandFingerprint: row.command_fingerprint ?? undefined,
        intentWrittenAt: row.intent_written_at ?? undefined,
        submittedAt: row.submitted_at ?? undefined,
        terminalAt: row.terminal_at ?? undefined,
    };
}
export function mapEvent(row: EventRow): AdExecutionEventRecord {
    return {
        id: row.id,
        storeId: row.store_id as AdExecutionEventRecord['storeId'],
        batchId: row.batch_id,
        jobId: row.job_id,
        sequence: row.sequence,
        eventType: row.event_type,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        actorId: row.actor_id,
        reasonCode: row.reason_code ?? undefined,
        detail: row.detail ?? undefined,
        sessionGeneration: row.session_generation,
        createdAt: row.created_at,
    };
}
export function mapEvidence(row: EvidenceRow): AdExecutionEvidenceRecord {
    return {
        id: row.id,
        storeId: row.store_id as AdExecutionEvidenceRecord['storeId'],
        batchId: row.batch_id,
        jobId: row.job_id,
        slot: row.slot,
        artifactRef: row.artifact_ref,
        contentSha256: row.content_sha256,
        pageIdentityHash: row.page_identity_hash,
        canonicalKeywordId: row.canonical_keyword_id,
        objectRevision: row.object_revision,
        observedBidCents: row.observed_bid_cents,
        capturedSessionGeneration: row.captured_session_generation,
        capturedAt: row.captured_at,
        createdAt: row.created_at,
    };
}
export function mapDomainReconciliation(row: DomainReconciliationRow): AdExecutionDomainReconciliationRecord {
    return {
        id: row.id,
        storeId: row.store_id as AdExecutionDomainReconciliationRecord['storeId'],
        batchId: row.batch_id,
        batchStatus: row.batch_status,
        evidenceRefCount: row.evidence_ref_count,
        completedSessionGeneration: row.completed_session_generation,
        completedAt: row.completed_at,
    };
}
