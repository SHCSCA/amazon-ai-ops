import  {
  type CausalEvidenceRefRecord,
  type CausalEventRecord,
  type CausalLedgerStage,
  type CreateMissionGrantInput,
  type DecisionRecord,
  type DecisionStatus,
  type ExperimentObservationType,
  type ExperimentRecord,
  type ExperimentStatus,
  type MissionGrantTerminalEventType,
  type MissionGrantRecord,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionLinkType,
  type MissionPhase,
  type MissionPriority,
  type MissionRecord,
  type MissionCheckpointRecord,
  type PolicyRuntimeRecord,
  type PolicyStatus,
  type PolicyVersionRules,
  type StoreContextEnvelope,
  type UsCurrency,
  type UsMarketplace,
} from '@amazon-ai-ops/shared-types';
export interface ListDomainRecordsInput {
  includeArchived?: boolean;
  missionId?: string;
}

export interface UpdatePolicyInput {
  id: string;
  expectedRevision: number;
  actorId: string;
  patch: {
    name?: string;
    scope?: string;
    priority?: number;
  };
}

export interface UpdateDraftPolicyVersionInput {
  id: string;
  expectedRevision: number;
  actorId: string;
  rules?: PolicyVersionRules;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface EnablePolicyVersionInput {
  policyId: string;
  versionId: string;
  expectedPolicyRevision: number;
  expectedVersionRevision: number;
  actorId: string;
}

export interface ArchiveRestoreInput {
  id: string;
  expectedRevision: number;
  actorId: string;
  reason?: string;
}

export interface AppendMissionLinkInput {
  id: string;
  missionId: string;
  linkType: MissionLinkType;
  targetId: string;
  relation: string;
  actorId: string;
}

export interface AppendMissionGrantEventInput {
  id: string;
  grantId: string;
  eventType: MissionGrantTerminalEventType;
  actorId: string;
  reason?: string;
}

export interface ResolveDecisionInput {
  id: string;
  expectedRevision: number;
  status: Extract<DecisionStatus,
    'approved' | 'rejected' | 'blocked' | 'superseded' | 'executed' | 'verified'>;
  actorId: string;
  reason: string;
}

export interface TransitionExperimentInput {
  id: string;
  expectedRevision: number;
  status: Exclude<ExperimentStatus, 'archived'>;
  actorId: string;
  reason?: string;
}

export interface AppendExperimentObservationInput {
  id: string;
  experimentId: string;
  observationType: ExperimentObservationType;
  title: string;
  observation: string;
  observedAt: string;
  actorId: string;
  correctsRecordId?: string;
}

export interface AppendExperimentMetricSnapshotInput {
  id: string;
  experimentId: string;
  metric: string;
  value: number;
  currency?: UsCurrency;
  observedAt: string;
  dataBatchId: string;
}

export interface EvaluateExperimentInput {
  id: string;
  expectedRevision: number;
  actorId: string;
}

export interface AnalysisCausalMemoryProof {
  evidenceType: string;
  evidenceRef: string;
  sha256: string;
}

export interface AnalysisCausalMemoryItem {
  eventId: string;
  missionId: string;
  stage: Extract<CausalLedgerStage, 'READBACK' | 'EFFECT'>;
  eventType: string;
  entityType: string;
  entityId: string;
  title: string;
  observedEffect: string;
  status: string;
  source: string;
  businessDate: string;
  sessionGeneration: number;
  proofs: readonly AnalysisCausalMemoryProof[];
}

export interface ExperimentMetricSourceRow {
  entityRevision: number;
  clicks: number;
  cost: number;
  orders: number;
  sales: number;
  currency: string | null;
  dateStart: string;
  dateEnd: string;
}

export interface AppendCausalLinkInput {
  id: string;
  sourceEventId: string;
  targetType:
    | 'mission'
    | 'decision'
    | 'experiment'
    | 'policy_version'
    | 'mission_grant'
    | 'data_batch'
    | 'causal_event';
  targetId: string;
  relation: string;
}

export interface AppendEvidenceRefInput {
  id: string;
  eventId: string;
  evidenceType: string;
  evidenceRef: string;
  sha256?: string;
}

export interface AppendCausalEventWithEvidenceResult {
  event: CausalEventRecord;
  evidence: CausalEvidenceRefRecord[];
}

export interface ResolveEffectivePolicyVersionInput {
  allowedActionTypes: CreateMissionGrantInput['allowedActionTypes'];
  allowedAdEntityIds: readonly string[];
  at?: string;
}

export interface MissionLineageProjection {
  mission: MissionRecord;
  checkpoints: MissionCheckpointRecord[];
  links: MissionLinkRecord[];
  decisions: DecisionRecord[];
  experiments: ExperimentRecord[];
  grants: MissionGrantRecord[];
  causalEvents: CausalEventRecord[];
}

export interface MissionDomainReferenceValidator {
  productBelongsToStore(context: StoreContextEnvelope, productId: string): boolean;
  adEntityBelongsToStore(context: StoreContextEnvelope, adEntityId: string): boolean;
  
  adEntitySupportsKeywordBid?(context: StoreContextEnvelope, adEntityId: string): boolean;
}

export interface MissionDomainRepositoryOptions {
  now?: () => Date;
  references?: MissionDomainReferenceValidator;
}

export interface StoreAuthorityRow {
  store_id: string;
  browser_profile_id: string;
  marketplace: string;
  currency: string;
  business_timezone: string;
  status: string;
}

export interface MissionRow {
  id: string;
  store_id: string;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  business_date: string;
  created_session_generation: number;
  data_batch_id: string;
  policy_version_id: string;
  title: string;
  objective: string;
  status: MissionLifecycleStatus;
  phase: MissionPhase;
  priority: MissionPriority;
  product_id: string | null;
  observation_starts_at: string;
  observation_ends_at: string;
  success_criteria_json: string;
  guardrails_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PolicyRow {
  id: string;
  store_id: string;
  name: string;
  scope: string;
  status: PolicyStatus;
  priority: number;
  active_version_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface PolicyVersionRow {
  id: string;
  store_id: string;
  policy_id: string;
  version: number;
  status: 'draft' | 'enabled' | 'retired';
  rules_json: string;
  valid_from: string | null;
  valid_until: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  enabled_at: string | null;
  retired_at: string | null;
}

export interface PolicyRuntimeRow {
  store_id: string;
  autonomy_mode: PolicyRuntimeRecord['autonomyMode'];
  kill_switch: number;
  circuit_breaker_state: PolicyRuntimeRecord['circuitBreakerState'];
  active_policy_version_id: string | null;
  reason: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface DecisionRow {
  authority_json: string | null;
  id: string;
  store_id: string;
  mission_id: string;
  data_batch_id: string;
  policy_version_id: string;
  policy_revision: number;
  action_revision: number;
  title: string;
  rationale: string;
  recommendation: string;
  facts_json: string;
  alternatives_json: string;
  expected_effect: string | null;
  valid_until: string | null;
  action_type: string;
  ad_entity_id: string | null;
  product_id: string | null;
  current_value_json: string | null;
  recommended_value_json: string | null;
  confidence: number;
  status: DecisionStatus;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface ExperimentRow {
  id: string;
  store_id: string;
  mission_id: string;
  name: string;
  hypothesis: string;
  primary_metric: string;
  guardrail_metrics_json: string;
  guardrail_criteria_json: string;
  product_id: string | null;
  ad_entity_id: string | null;
  baseline_json: string;
  variant_json: string;
  observation_starts_at: string;
  observation_ends_at: string;
  status: ExperimentStatus;
  conclusion: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface GrantRow {
  authority_json: string | null;
  id: string;
  store_id: string;
  marketplace: UsMarketplace;
  currency: UsCurrency;
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
  required_evidence_json: string;
  stop_conditions_json: string;
  issuer_type: 'human' | 'policy';
  issuer_actor_id: string;
  issued_at: string;
  created_session_generation: number;
}

export interface CausalRow {
  id: string;
  store_id: string;
  stage: CausalLedgerStage;
  event_type: string;
  entity_type: string;
  entity_id: string;
  mission_id: string | null;
  title: string;
  signal: string | null;
  intervention: string | null;
  expected_effect: string | null;
  observed_effect: string | null;
  confidence: number | null;
  status: string;
  source: string;
  actor_id: string;
  business_date: string;
  session_generation: number;
  corrects_event_id: string | null;
  sequence: number;
  created_at: string;
}
