import {
type AnalysisProposalAuthorization,
type AnalysisProposalMatchType,
type AnalysisProposalSource,
type VerifiedAdEntityType
} from '@amazon-ai-ops/shared-types';

export type AnalysisAuthorityErrorCode =
  | 'INVALID_CONTEXT'
  | 'STORE_NOT_ACTIVE'
  | 'STALE_CONTEXT'
  | 'NOT_FOUND'
  | 'REFERENCE_CONFLICT'
  | 'STATE_CONFLICT'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_ACTION';

export class AnalysisAuthorityRepositoryError extends Error {
  constructor(
    readonly code: AnalysisAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AnalysisAuthorityRepositoryError';
  }
}

export interface AnalysisAuthorityRepositoryOptions {
  now?: () => Date;
}

export interface MissionRow {
  id: string;
  store_id: string;
  data_batch_id: string;
  policy_version_id: string;
  status: string;
  revision: number;
}

export interface EvidenceRow {
  id: string;
  store_id: string;
  marketplace: 'US';
  currency: 'USD';
  mission_id: string;
  data_batch_id: string;
  import_run_id: string;
  date_from: string;
  date_to: string;
  asin: string | null;
  report_types_json: string;
  sources_json: string;
  metric_row_count: number;
  reconciliation_hash: string;
  rule_revision: string;
  model_revision: string;
  package_hash: string;
  imported_at: string;
  fresh_until: string;
  sealed_at: string;
  created_session_generation: number;
}

export interface AuthorityRow {
  authority_id: string;
  store_id: string;
  ad_entity_id: string;
  entity_revision: number;
  entity_type: VerifiedAdEntityType;
  entity_name: string;
  campaign_name: string;
  ad_group_name: string;
  evidence_package_id: string;
  source_report_type: VerifiedAdEntityType;
  source_file_hash: string;
  source_row: number;
  identity_source: 'ads_ui' | 'ads_api';
  proof_sha256: string;
  verified_by: string;
  verified_at: string;
  created_at: string;
}

export interface ProposalRow {
  id: string;
  store_id: string;
  marketplace: 'US';
  currency: 'USD';
  mission_id: string;
  mission_revision: number;
  evidence_package_id: string;
  evidence_package_hash: string;
  data_batch_id: string;
  policy_version_id: string;
  policy_revision: number;
  rule_revision: string;
  model_revision: string;
  action_batch_id: string;
  action_revision: number;
  legacy_recommendation_id: number;
  action_type: 'set_keyword_bid';
  entity_type: 'keyword';
  entity_name: string;
  campaign_name: string;
  ad_group_name: string;
  ad_entity_authority_id: string | null;
  ad_entity_id: string | null;
  ad_entity_revision: number | null;
  current_bid_cents: number;
  proposed_bid_cents: number;
  change_pct: number;
  confidence: number;
  source: AnalysisProposalSource;
  explanation: string;
  authorization_json: string;
  valid_until: string;
  created_at: string;
  created_session_generation: number;
}

export type ProposalSnapshotJson = AnalysisProposalAuthorization & {
  matchType?: AnalysisProposalMatchType;
};

export interface ActionBatchRow {
  authority_json: string | null;
  id: string;
  store_id: string;
  mission_id: string;
  mission_revision: number;
  evidence_package_id: string;
  rule_revision: string;
  model_revision: string;
  action_revision: number;
  created_at: string;
  created_session_generation: number;
}
