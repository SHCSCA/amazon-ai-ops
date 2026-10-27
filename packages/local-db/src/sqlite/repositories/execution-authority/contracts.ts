import  {
  AD_EXECUTION_ACTION_TYPE,
  type AdExecutionUnknownReconciliationStatus,
  type AdExecutionEvidenceSlot,
  type AdExecutionEventType,
  type AdExecutionStatus,
  type AdExecutionTerminalStatus,
  type AdKeywordAliasResolutionRecord,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
export type ExecutionAuthorityErrorCode = 'INVALID_CONTEXT' | 'STORE_NOT_ACTIVE' | 'STALE_CONTEXT' | 'INVALID_INPUT' | 'NOT_FOUND' | 'REFERENCE_CONFLICT' | 'STATE_CONFLICT' | 'REVISION_CONFLICT' | 'TERMINAL_STATE';
export interface ExecutionAuthorityRepositoryOptions {
    now?: () => Date;
}
export type PolicyGrantDispatchStatus = 'pending' | 'attempting' | 'queued_for_execution' | 'waiting_runtime' | 'completed' | 'attention_required';
export type PolicyGrantDispatchTrigger = 'grant_issued' | 'startup_recovery' | 'store_activated' | 'session_ready' | 'timer_retry';
export type PolicyGrantDispatchCode = 'DISPATCH_PENDING' | 'DISPATCH_ATTEMPT_STARTED' | 'BATCH_QUEUED_FOR_EXECUTION' | 'EXECUTION_START_ACQUIRED' | 'EXECUTION_RETRY_SCHEDULED' | 'EXECUTION_TERMINAL' | 'EXECUTION_STATE_REQUIRES_RECONCILIATION' | 'RUNTIME_UNAVAILABLE' | 'STARTUP_ATTEMPT_INTERRUPTED' | 'BATCH_CREATED' | 'EXISTING_BATCH_RECOVERED' | 'SESSION_REAUTHORIZATION_REQUIRED' | 'GRANT_EXPIRED' | 'GRANT_TERMINAL' | 'MISSION_REVISION_CHANGED' | 'POLICY_AUTHORITY_CHANGED' | 'ADS_IDENTITY_AUTHORITY_CHANGED' | 'UNSAFE_DISPATCH_FAILURE';
export interface AppendPolicyGrantDispatchEventInput {
    grantId: string;
    status: PolicyGrantDispatchStatus;
    trigger: PolicyGrantDispatchTrigger;
    attempt: number;
    code: PolicyGrantDispatchCode;
    detail: string;
    batchId?: string;
    nextRetryAt?: string;
}
export interface PolicyGrantDispatchRecord {
    storeId: StoreContextEnvelope['storeId'];
    grantId: string;
    missionId: string;
    status: PolicyGrantDispatchStatus;
    attemptCount: number;
    eventId?: string;
    trigger?: PolicyGrantDispatchTrigger;
    code?: PolicyGrantDispatchCode;
    detail?: string;
    nextRetryAt?: string;
    batchId?: string;
    batchStatus?: AdExecutionStatus;
    batchJobCount: number;
    batchJobStatuses: readonly AdExecutionStatus[];
    batchHasPersistedIntent: boolean;
    grantExpiresAt: string;
    grantSessionGeneration: number;
    terminalGrantEventType?: 'revoked' | 'consumed' | 'expired' | 'invalidated';
    updatedAt?: string;
}
export interface PolicyGrantDispatchStartupRecoveryResult {
    recoveredAt: string;
    discoveredPending: readonly string[];
    interruptedToWaiting: readonly string[];
    queuedExistingBatch: readonly string[];
    completedExistingBatch: readonly string[];
    attentionRequired: readonly string[];
}
export interface IdentityRow {
    identity_version_id: string;
    store_id: string;
    marketplace: 'US';
    currency: 'USD';
    canonical_keyword_id: string;
    ad_entity_id: string;
    entity_revision: number;
    ads_account_id: string;
    campaign_id: string;
    ad_group_id: string;
    keyword_id: string;
    object_revision: number;
    observed_bid_cents: number;
    page_identity_hash: string;
    source_authority_id: string;
    source_authority_proof_sha256: string;
    resolution_proof_sha256: string;
    resolved_session_generation: number;
    resolved_at: string;
    resolved_by: string;
    created_at: string;
}
export interface ReconciliationRow {
    case_id: string;
    store_id: string;
    batch_id: string;
    job_id: string;
    submit_intent_id: string;
    context_json: string;
    started_at: string;
    first_json: string | null;
    reload_json: string | null;
    outcome: AdExecutionUnknownReconciliationStatus | null;
    completed_at: string | null;
}
export interface AliasRow {
    id: string;
    store_id: string;
    alias_type: AdKeywordAliasResolutionRecord['aliasType'];
    alias_hash: string;
    canonical_keyword_id: string;
    object_revision: number;
    resolution_revision: number;
    status: AdKeywordAliasResolutionRecord['status'];
    reason: string | null;
    resolved_session_generation: number;
    resolved_at: string;
    resolved_by: string;
}
export interface BatchRow {
    id: string;
    store_id: string;
    marketplace: 'US';
    currency: 'USD';
    mission_id: string;
    mission_revision: number;
    grant_id: string;
    action_revision: number;
    status: AdExecutionStatus;
    revision: number;
    created_session_generation: number;
    created_at: string;
    updated_at: string;
    terminal_at: string | null;
}
export interface JobRow {
    id: string;
    store_id: string;
    batch_id: string;
    ordinal: number;
    mission_id: string;
    grant_id: string;
    proposal_id: string;
    decision_id: string;
    decision_revision: number;
    action_revision: number;
    action_type: typeof AD_EXECUTION_ACTION_TYPE;
    canonical_keyword_id: string;
    ad_entity_id: string;
    entity_revision: number;
    ads_account_id: string;
    campaign_id: string;
    ad_group_id: string;
    keyword_id: string;
    object_revision: number;
    page_identity_hash: string;
    expected_bid_cents: number;
    target_bid_cents: number;
    change_pct: number;
    idempotency_key: string;
    status: AdExecutionStatus;
    revision: number;
    created_session_generation: number;
    created_at: string;
    updated_at: string;
    submit_intent_id: string | null;
    command_fingerprint: string | null;
    intent_written_at: string | null;
    submitted_at: string | null;
    terminal_at: string | null;
}
export interface EventRow {
    id: string;
    store_id: string;
    batch_id: string;
    job_id: string;
    sequence: number;
    event_type: AdExecutionEventType;
    from_status: AdExecutionStatus;
    to_status: AdExecutionStatus;
    actor_id: string;
    reason_code: string | null;
    detail: string | null;
    session_generation: number;
    created_at: string;
}
export interface EvidenceRow {
    id: string;
    store_id: string;
    batch_id: string;
    job_id: string;
    slot: AdExecutionEvidenceSlot;
    artifact_ref: string;
    content_sha256: string;
    page_identity_hash: string;
    canonical_keyword_id: string;
    object_revision: number;
    observed_bid_cents: number;
    captured_session_generation: number;
    captured_at: string;
    created_at: string;
}
export interface DomainReconciliationRow {
    id: string;
    store_id: string;
    batch_id: string;
    batch_status: AdExecutionTerminalStatus;
    evidence_ref_count: number;
    completed_session_generation: number;
    completed_at: string;
}
export interface CausalEvidenceRefRow {
    id: string;
    store_id: string;
    event_id: string;
    evidence_type: string;
    evidence_ref: string;
    sha256: string | null;
    created_at: string;
}
export interface PolicyGrantDispatchEventRow {
    id: string;
    event_type: string;
    signal: string | null;
    status: string;
    created_at: string;
}
export interface PolicyGrantDispatchPayload {
    schemaVersion: 1;
    trigger: PolicyGrantDispatchTrigger;
    status: PolicyGrantDispatchStatus;
    attempt: number;
    code: PolicyGrantDispatchCode;
    detail: string;
    batchId?: string;
    nextRetryAt?: string;
}
export interface GrantRow {
    id: string;
    marketplace: string;
    currency: string;
    mission_id: string;
    mission_revision: number;
    decision_ids_json: string;
    action_revision: number;
    allowed_action_types_json: string;
    allowed_ad_entity_ids_json: string;
    max_change_pct: number;
    total_impact_budget: number;
    expires_at: string;
    policy_version_id: string;
    policy_revision: number;
    issuer_type: 'human' | 'policy';
    created_session_generation: number;
}
export interface ProposalDecisionRow {
    proposal_id: string;
    marketplace: string;
    currency: string;
    mission_id: string;
    mission_revision: number;
    policy_version_id: string;
    policy_revision: number;
    action_revision: number;
    action_type: string;
    entity_type: string;
    ad_entity_id: string | null;
    ad_entity_revision: number | null;
    current_bid_cents: number;
    proposed_bid_cents: number;
    change_pct: number;
    authorization_json: string;
    valid_until: string;
    created_session_generation: number;
    decision_id: string;
    decision_revision: number;
    decision_status: string;
    decision_action_type: string;
    decision_ad_entity_id: string | null;
    decision_action_revision: number;
    decision_policy_version_id: string;
    decision_policy_revision: number;
    decision_valid_until: string | null;
}
