import {
validateAnalysisEvidencePackage,
validateAnalysisProposalSnapshot,
validateVerifiedAdEntityAuthority,
type AnalysisActionBatchRecord,
type AnalysisEvidencePackageRecord,
type AnalysisProposalDecisionLinkRecord,
type AnalysisProposalSnapshotRecord,
type VerifiedAdEntityAuthorityRecord
} from '@amazon-ai-ops/shared-types';
import {
type ActionBatchRow,type AuthorityRow,
type EvidenceRow,
type ProposalRow,type ProposalSnapshotJson,
} from './analysis-repository-contracts';
import {
canonicalProposalMatchType,
parseJson,
} from './analysis-repository-values';

export function mapEvidence(row: EvidenceRow): AnalysisEvidencePackageRecord {
  const record: AnalysisEvidencePackageRecord = {
    id: row.id,
    storeId: row.store_id as AnalysisEvidencePackageRecord['storeId'],
    marketplace: row.marketplace,
    currency: row.currency,
    missionId: row.mission_id,
    dataBatchId: row.data_batch_id,
    importRunId: row.import_run_id,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    asin: row.asin ?? undefined,
    reportTypes: parseJson(row.report_types_json),
    sources: parseJson(row.sources_json),
    metricRowCount: row.metric_row_count,
    reconciliationHash: row.reconciliation_hash,
    ruleRevision: row.rule_revision,
    modelRevision: row.model_revision,
    packageHash: row.package_hash,
    importedAt: row.imported_at,
    freshUntil: row.fresh_until,
    sealedAt: row.sealed_at,
    createdSessionGeneration: row.created_session_generation,
  };
  validateAnalysisEvidencePackage(record);
  return record;
}

export function mapActionBatch(row: ActionBatchRow): AnalysisActionBatchRecord {
  return {
    authority: row.authority_json ? parseJson(row.authority_json) : undefined,
    id: row.id,
    storeId: row.store_id as AnalysisActionBatchRecord['storeId'],
    missionId: row.mission_id,
    missionRevision: row.mission_revision,
    evidencePackageId: row.evidence_package_id,
    ruleRevision: row.rule_revision,
    modelRevision: row.model_revision,
    actionRevision: row.action_revision,
    createdAt: row.created_at,
    createdSessionGeneration: row.created_session_generation,
  };
}

export function mapAuthority(row: AuthorityRow): VerifiedAdEntityAuthorityRecord {
  const record: VerifiedAdEntityAuthorityRecord = {
    authorityId: row.authority_id,
    storeId: row.store_id as VerifiedAdEntityAuthorityRecord['storeId'],
    adEntityId: row.ad_entity_id,
    entityRevision: row.entity_revision,
    entityType: row.entity_type,
    entityName: row.entity_name,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    evidencePackageId: row.evidence_package_id,
    sourceReportType: row.source_report_type,
    sourceFileHash: row.source_file_hash,
    sourceRow: row.source_row,
    identitySource: row.identity_source,
    proofSha256: row.proof_sha256,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  };
  validateVerifiedAdEntityAuthority(record);
  return record;
}

export function mapProposal(row: ProposalRow): AnalysisProposalSnapshotRecord {
  const snapshotJson = parseJson<ProposalSnapshotJson>(row.authorization_json);
  const record: AnalysisProposalSnapshotRecord = {
    id: row.id,
    storeId: row.store_id as AnalysisProposalSnapshotRecord['storeId'],
    marketplace: row.marketplace,
    currency: row.currency,
    missionId: row.mission_id,
    missionRevision: row.mission_revision,
    evidencePackageId: row.evidence_package_id,
    evidencePackageHash: row.evidence_package_hash,
    dataBatchId: row.data_batch_id,
    policyVersionId: row.policy_version_id,
    policyRevision: row.policy_revision,
    ruleRevision: row.rule_revision,
    modelRevision: row.model_revision,
    actionBatchId: row.action_batch_id,
    actionRevision: row.action_revision,
    legacyRecommendationId: row.legacy_recommendation_id,
    actionType: row.action_type,
    entityType: row.entity_type,
    matchType: canonicalProposalMatchType(snapshotJson.matchType),
    entityName: row.entity_name,
    campaignName: row.campaign_name,
    adGroupName: row.ad_group_name,
    adEntityAuthorityId: row.ad_entity_authority_id ?? undefined,
    adEntityId: row.ad_entity_id ?? undefined,
    adEntityRevision: row.ad_entity_revision ?? undefined,
    currentBidCents: row.current_bid_cents,
    proposedBidCents: row.proposed_bid_cents,
    changePct: row.change_pct,
    confidence: row.confidence,
    source: row.source,
    explanation: row.explanation,
    authorization: {
      human: snapshotJson.human,
      policy: snapshotJson.policy,
    },
    validUntil: row.valid_until,
    createdAt: row.created_at,
    createdSessionGeneration: row.created_session_generation,
  };
  validateAnalysisProposalSnapshot(record);
  return record;
}

export function mapDecisionLink(row: Record<string, unknown>): AnalysisProposalDecisionLinkRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as AnalysisProposalDecisionLinkRecord['storeId'],
    proposalId: String(row.proposal_id),
    decisionId: String(row.decision_id),
    createdAt: String(row.created_at),
  };
}
