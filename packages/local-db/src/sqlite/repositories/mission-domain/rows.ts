import  {
  type CausalEvidenceRefRecord,
  type CausalEventRecord,
  type CausalLedgerStage,
  type CausalLinkRecord,
  type DecisionHistoryEventType,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentObservationType,
  type ExperimentRecord,
  type MissionGrantEventRecord,
  type MissionGrantEventType,
  type MissionGrantRecord,
  type MissionLinkRecord,
  type MissionLinkType,
  type MissionRecord,
  type MissionCheckpointRecord,
  type PolicyRecord,
  type PolicyRuntimeRecord,
  type PolicyVersionRecord,
  type PolicyVersionRules,
  type UsCurrency,
} from '@amazon-ai-ops/shared-types';
import  {
  MissionRow,
  PolicyRow,
  PolicyVersionRow,
  PolicyRuntimeRow,
  DecisionRow,
  ExperimentRow,
  GrantRow,
  CausalRow,
} from './contracts';
import { parseJson, parseNullableJson, nullable } from './values';
export function mapPolicy(row: PolicyRow): PolicyRecord {
  return {
    id: row.id,
    storeId: row.store_id as PolicyRecord['storeId'],
    name: row.name,
    scope: row.scope,
    status: row.status,
    priority: row.priority,
    activeVersionId: nullable(row.active_version_id),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: nullable(row.archived_at),
  };
}

export function mapPolicyVersion(row: PolicyVersionRow): PolicyVersionRecord {
  return {
    id: row.id,
    storeId: row.store_id as PolicyVersionRecord['storeId'],
    policyId: row.policy_id,
    version: row.version,
    status: row.status,
    rules: parseJson<PolicyVersionRules>(row.rules_json),
    validFrom: nullable(row.valid_from),
    validUntil: nullable(row.valid_until),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    enabledAt: nullable(row.enabled_at),
    retiredAt: nullable(row.retired_at),
  };
}

export function mapPolicyRuntime(row: PolicyRuntimeRow): PolicyRuntimeRecord {
  return {
    storeId: row.store_id as PolicyRuntimeRecord['storeId'],
    autonomyMode: row.autonomy_mode,
    killSwitch: row.kill_switch === 1,
    circuitBreakerState: row.circuit_breaker_state,
    activePolicyVersionId: nullable(row.active_policy_version_id),
    reason: nullable(row.reason),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMission(row: MissionRow): MissionRecord {
  return {
    id: row.id,
    storeId: row.store_id as MissionRecord['storeId'],
    marketplace: row.marketplace,
    currency: row.currency,
    businessDate: row.business_date,
    createdSessionGeneration: row.created_session_generation,
    dataBatchId: row.data_batch_id,
    policyVersionId: row.policy_version_id,
    title: row.title,
    objective: row.objective,
    status: row.status,
    phase: row.phase,
    priority: row.priority,
    productId: nullable(row.product_id),
    observationStartsAt: row.observation_starts_at,
    observationEndsAt: row.observation_ends_at,
    successCriteria: parseJson<string[]>(row.success_criteria_json),
    guardrails: parseJson<string[]>(row.guardrails_json),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: nullable(row.archived_at),
  };
}

export function mapMissionLink(row: Record<string, unknown>): MissionLinkRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as MissionLinkRecord['storeId'],
    missionId: String(row.mission_id),
    linkType: row.link_type as MissionLinkType,
    targetId: String(row.target_id),
    relation: String(row.relation),
    actorId: String(row.actor_id),
    createdAt: String(row.created_at),
  };
}

export function mapMissionCheckpoint(row: Record<string, unknown>): MissionCheckpointRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as MissionCheckpointRecord['storeId'],
    missionId: String(row.mission_id),
    stage: row.stage as CausalLedgerStage,
    title: String(row.title),
    status: String(row.status),
    evidenceCount: Number(row.evidence_count),
    actorId: String(row.actor_id),
    createdAt: String(row.created_at),
  };
}

export function mapGrant(row: GrantRow): MissionGrantRecord {
  return {
    authority: row.authority_json ? parseJson(row.authority_json) : undefined,
    id: row.id,
    storeId: row.store_id as MissionGrantRecord['storeId'],
    marketplace: row.marketplace,
    currency: row.currency,
    missionId: row.mission_id,
    missionRevision: row.mission_revision,
    decisionIds: parseJson(row.decision_ids_json),
    actionRevision: row.action_revision,
    allowedActionTypes: parseJson(row.allowed_action_types_json),
    allowedAdEntityIds: parseJson(row.allowed_ad_entity_ids_json),
    maxChangePct: row.max_change_pct,
    totalImpactBudget: row.total_impact_budget,
    expiresAt: row.expires_at,
    policyVersionId: row.policy_version_id,
    policyRevision: row.policy_revision,
    requiredEvidence: parseJson(row.required_evidence_json),
    stopConditions: parseJson(row.stop_conditions_json),
    issuer: { type: row.issuer_type, actorId: row.issuer_actor_id },
    issuedAt: row.issued_at,
    createdSessionGeneration: row.created_session_generation,
  };
}

export function mapGrantEvent(row: Record<string, unknown>): MissionGrantEventRecord {
  return {
    ...(row.job_id ? { slot: { jobId: String(row.job_id), submitIntentId: String(row.submit_intent_id), impactCents: Number(row.impact_cents) } } : {}),
    id: String(row.id),
    storeId: String(row.store_id) as MissionGrantEventRecord['storeId'],
    grantId: String(row.grant_id),
    eventType: row.event_type as MissionGrantEventType,
    actorId: String(row.actor_id),
    reason: nullable(row.reason),
    createdAt: String(row.created_at),
  };
}

export function mapDecision(row: DecisionRow): DecisionRecord {
  return {
    authority: row.authority_json ? parseJson(row.authority_json) : undefined,
    id: row.id,
    storeId: row.store_id as DecisionRecord['storeId'],
    missionId: row.mission_id,
    dataBatchId: row.data_batch_id,
    policyVersionId: row.policy_version_id,
    policyRevision: row.policy_revision,
    actionRevision: row.action_revision,
    title: row.title,
    rationale: row.rationale,
    recommendation: row.recommendation,
    facts: parseJson(row.facts_json),
    alternatives: parseJson(row.alternatives_json),
    expectedEffect: nullable(row.expected_effect),
    validUntil: nullable(row.valid_until),
    actionType: row.action_type,
    adEntityId: nullable(row.ad_entity_id),
    productId: nullable(row.product_id),
    currentValue: parseNullableJson(row.current_value_json),
    recommendedValue: parseNullableJson(row.recommended_value_json),
    confidence: row.confidence,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDecisionHistory(row: Record<string, unknown>): DecisionHistoryRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as DecisionHistoryRecord['storeId'],
    decisionId: String(row.decision_id),
    decisionRevision: Number(row.decision_revision),
    eventType: row.event_type as DecisionHistoryEventType,
    actorId: String(row.actor_id),
    reason: nullable(row.reason),
    snapshot: parseJson<DecisionRecord>(String(row.snapshot_json)),
    createdAt: String(row.created_at),
  };
}

export function mapExperiment(row: ExperimentRow): ExperimentRecord {
  return {
    id: row.id,
    storeId: row.store_id as ExperimentRecord['storeId'],
    missionId: row.mission_id,
    name: row.name,
    hypothesis: row.hypothesis,
    primaryMetric: row.primary_metric,
    guardrailMetrics: parseJson(row.guardrail_metrics_json),
    guardrailCriteria: parseJson(row.guardrail_criteria_json),
    productId: nullable(row.product_id),
    adEntityId: nullable(row.ad_entity_id),
    baseline: parseJson(row.baseline_json),
    variant: parseJson(row.variant_json),
    observationStartsAt: row.observation_starts_at,
    observationEndsAt: row.observation_ends_at,
    status: row.status,
    conclusion: nullable(row.conclusion),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: nullable(row.archived_at),
  };
}

export function mapExperimentObservation(row: Record<string, unknown>): ExperimentObservationRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as ExperimentObservationRecord['storeId'],
    experimentId: String(row.experiment_id),
    observationType: row.observation_type as ExperimentObservationType,
    title: String(row.title),
    observation: String(row.observation),
    observedAt: String(row.observed_at),
    actorId: String(row.actor_id),
    correctsRecordId: nullable(row.corrects_record_id),
    createdAt: String(row.created_at),
  };
}

export function mapMetricSnapshot(row: Record<string, unknown>): ExperimentMetricSnapshotRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as ExperimentMetricSnapshotRecord['storeId'],
    experimentId: String(row.experiment_id),
    metric: String(row.metric),
    value: Number(row.value),
    currency: nullable(row.currency) as UsCurrency | undefined,
    observedAt: String(row.observed_at),
    dataBatchId: String(row.data_batch_id),
    createdAt: String(row.created_at),
  };
}

export function mapCausalEvent(row: CausalRow): CausalEventRecord {
  return {
    id: row.id,
    storeId: row.store_id as CausalEventRecord['storeId'],
    stage: row.stage,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    missionId: nullable(row.mission_id),
    title: row.title,
    signal: nullable(row.signal),
    intervention: nullable(row.intervention),
    expectedEffect: nullable(row.expected_effect),
    observedEffect: nullable(row.observed_effect),
    confidence: row.confidence ?? undefined,
    status: row.status,
    source: row.source,
    actorId: row.actor_id,
    businessDate: row.business_date,
    sessionGeneration: row.session_generation,
    correctsEventId: nullable(row.corrects_event_id),
    sequence: row.sequence,
    createdAt: row.created_at,
  };
}

export function mapCausalLink(row: Record<string, unknown>): CausalLinkRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as CausalLinkRecord['storeId'],
    sourceEventId: String(row.source_event_id),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    relation: String(row.relation),
    createdAt: String(row.created_at),
  };
}

export function mapEvidenceRef(row: Record<string, unknown>): CausalEvidenceRefRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as CausalEvidenceRefRecord['storeId'],
    eventId: String(row.event_id),
    evidenceType: String(row.evidence_type),
    evidenceRef: String(row.evidence_ref),
    sha256: nullable(row.sha256),
    createdAt: String(row.created_at),
  };
}
