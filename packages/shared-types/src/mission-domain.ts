import {
  normalizeStoreContextEnvelope,
  normalizeStoreId,
  type StoreContextEnvelope,
  type StoreId,
  type UsCurrency,
  type UsMarketplace,
} from './store';

/**
 * Production Mission Control domain contracts.
 *
 * These contracts deliberately persist logical authority only. Browser paths,
 * cookies, passwords, raw evidence paths, and other Main-only material must
 * never be added to these records or command payloads.
 */

export type MissionLifecycleStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'archived';

export type MissionPhase =
  | 'fact'
  | 'analysis'
  | 'decision'
  | 'action'
  | 'readback'
  | 'effect';

export type MissionPriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface MissionRecord {
  id: string;
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  businessDate: string;
  createdSessionGeneration: number;
  dataBatchId: string;
  policyVersionId: string;
  title: string;
  objective: string;
  status: MissionLifecycleStatus;
  phase: MissionPhase;
  priority: MissionPriority;
  productId?: string;
  observationStartsAt: string;
  observationEndsAt: string;
  successCriteria: readonly string[];
  guardrails: readonly string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CreateMissionInput {
  id: string;
  dataBatchId: string;
  policyVersionId: string;
  title: string;
  objective: string;
  priority?: MissionPriority;
  productId?: string;
  observationStartsAt: string;
  observationEndsAt: string;
  successCriteria: readonly string[];
  guardrails: readonly string[];
  actorId: string;
}

export interface UpdateMissionInput {
  id: string;
  expectedRevision: number;
  actorId: string;
  patch: {
    title?: string;
    objective?: string;
    priority?: MissionPriority;
    productId?: string | null;
    observationStartsAt?: string;
    observationEndsAt?: string;
    successCriteria?: readonly string[];
    guardrails?: readonly string[];
  };
}

export interface TransitionMissionInput {
  id: string;
  expectedRevision: number;
  status: Exclude<MissionLifecycleStatus, 'archived'>;
  phase?: MissionPhase;
  reason?: string;
  actorId: string;
}

export type MissionLinkType =
  | 'data_batch'
  | 'policy_version'
  | 'decision'
  | 'experiment'
  | 'execution'
  | 'result'
  | 'product'
  | 'ad_entity';

export interface MissionLinkRecord {
  id: string;
  storeId: StoreId;
  missionId: string;
  linkType: MissionLinkType;
  targetId: string;
  relation: string;
  createdAt: string;
  actorId: string;
}

export interface MissionCheckpointRecord {
  id: string;
  storeId: StoreId;
  missionId: string;
  stage: CausalLedgerStage;
  title: string;
  status: string;
  evidenceCount: number;
  actorId: string;
  createdAt: string;
}

export interface AppendMissionCheckpointInput {
  id: string;
  missionId: string;
  stage: CausalLedgerStage;
  title: string;
  status: string;
  evidenceCount: number;
  actorId: string;
}

export type MissionGrantActionType = 'set_keyword_bid';

export type MissionGrantEvidenceType =
  | 'before_screenshot'
  | 'after_screenshot'
  | 'reload_screenshot'
  | 'page_identity'
  | 'readback_value';

export type MissionGrantStopConditionCode =
  | 'identity_drift'
  | 'expected_before_mismatch'
  | 'unknown_result'
  | 'data_stale'
  | 'impact_budget_exhausted'
  | 'kill_switch';

export interface MissionGrantStopCondition {
  code: MissionGrantStopConditionCode;
  detail: string;
}

export type MissionGrantIssuer =
  | { type: 'human'; actorId: string }
  | { type: 'policy'; actorId: string };

/** Immutable authorization package shared by manual and policy-auto modes. */
export interface MissionGrantRecord {
  id: string;
  storeId: StoreId;
  marketplace: UsMarketplace;
  currency: UsCurrency;
  missionId: string;
  missionRevision: number;
  /** Approved decisions covered by this one mission-level batch grant. */
  decisionIds: readonly string[];
  actionRevision: number;
  allowedActionTypes: readonly MissionGrantActionType[];
  allowedAdEntityIds: readonly string[];
  maxChangePct: number;
  totalImpactBudget: number;
  expiresAt: string;
  policyVersionId: string;
  policyRevision: number;
  requiredEvidence: readonly MissionGrantEvidenceType[];
  stopConditions: readonly MissionGrantStopCondition[];
  issuer: MissionGrantIssuer;
  issuedAt: string;
  createdSessionGeneration: number;
}

export interface CreateMissionGrantInput {
  id: string;
  missionId: string;
  missionRevision: number;
  decisionIds: readonly string[];
  actionRevision: number;
  allowedActionTypes: readonly MissionGrantActionType[];
  allowedAdEntityIds: readonly string[];
  maxChangePct: number;
  totalImpactBudget: number;
  expiresAt: string;
  policyVersionId: string;
  policyRevision: number;
  requiredEvidence: readonly MissionGrantEvidenceType[];
  stopConditions: readonly MissionGrantStopCondition[];
  issuer: MissionGrantIssuer;
}

export type MissionGrantEventType = 'issued' | 'revoked' | 'consumed' | 'expired';

export interface MissionGrantEventRecord {
  id: string;
  storeId: StoreId;
  grantId: string;
  eventType: MissionGrantEventType;
  actorId: string;
  reason?: string;
  createdAt: string;
}

export type MissionGrantDenialCode =
  | 'INVALID_GRANT'
  | 'GRANT_TERMINATED'
  | 'STORE_MISMATCH'
  | 'MISSION_MISMATCH'
  | 'MISSION_REVISION_MISMATCH'
  | 'ACTION_REVISION_MISMATCH'
  | 'POLICY_REVISION_MISMATCH'
  | 'POLICY_VERSION_MISMATCH'
  | 'SESSION_GENERATION_MISMATCH'
  | 'GRANT_EXPIRED'
  | 'ACTION_TYPE_NOT_ALLOWED'
  | 'ENTITY_NOT_ALLOWED'
  | 'CHANGE_LIMIT_EXCEEDED'
  | 'IMPACT_BUDGET_EXCEEDED'
  | 'REQUIRED_EVIDENCE_MISSING'
  | 'STOP_CONDITION_ACTIVE';

export type MissionGrantAuthorizationResult =
  | { authorized: true; grantId: string }
  | { authorized: false; code: MissionGrantDenialCode; detail: string };

/**
 * Main-derived execution state that must be captured from the durable grant
 * and action ledgers. It is intentionally one required object so callers
 * cannot accidentally omit terminal, budget, or stop-condition checks.
 */
export interface MissionGrantExecutionAuthority {
  terminalEventType: Exclude<MissionGrantEventType, 'issued'> | null;
  cumulativeImpact: number;
  activeStopConditions: readonly MissionGrantStopConditionCode[];
}

export interface MissionGrantAuthorizationRequest {
  phase: 'preflight' | 'completion';
  context: StoreContextEnvelope;
  grant: MissionGrantRecord;
  missionId: string;
  missionRevision: number;
  actionRevision: number;
  actionType: MissionGrantActionType;
  adEntityId: string;
  changePct: number;
  policyVersionId: string;
  policyRevision: number;
  availableEvidence: readonly MissionGrantEvidenceType[];
  authority: MissionGrantExecutionAuthority;
  now?: string;
}

export type DecisionStatus =
  | 'proposed'
  | 'needs_approval'
  | 'approved'
  | 'rejected'
  | 'blocked'
  | 'superseded'
  | 'executed'
  | 'verified';

export interface DecisionRecord {
  id: string;
  storeId: StoreId;
  missionId: string;
  dataBatchId: string;
  policyVersionId: string;
  policyRevision: number;
  actionRevision: number;
  title: string;
  rationale: string;
  recommendation: string;
  facts: readonly string[];
  alternatives: readonly string[];
  expectedEffect?: string;
  validUntil?: string;
  actionType: string;
  adEntityId?: string;
  productId?: string;
  currentValue?: unknown;
  recommendedValue?: unknown;
  confidence: number;
  status: DecisionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDecisionInput {
  id: string;
  missionId: string;
  dataBatchId: string;
  policyVersionId: string;
  policyRevision: number;
  actionRevision: number;
  title: string;
  rationale: string;
  recommendation: string;
  facts: readonly string[];
  alternatives: readonly string[];
  expectedEffect?: string;
  validUntil?: string;
  actionType: string;
  adEntityId?: string;
  productId?: string;
  currentValue?: unknown;
  recommendedValue?: unknown;
  confidence: number;
  status?: Extract<DecisionStatus, 'proposed' | 'needs_approval' | 'blocked'>;
  actorId: string;
}

export interface ReviseDecisionInput {
  id: string;
  expectedRevision: number;
  title?: string;
  rationale?: string;
  recommendation?: string;
  facts?: readonly string[];
  alternatives?: readonly string[];
  expectedEffect?: string | null;
  validUntil?: string | null;
  currentValue?: unknown;
  recommendedValue?: unknown;
  confidence?: number;
  status?: Extract<DecisionStatus, 'proposed' | 'needs_approval' | 'blocked'>;
  actorId: string;
}

export type DecisionHistoryEventType =
  | 'created'
  | 'revised'
  | 'approved'
  | 'rejected'
  | 'blocked'
  | 'superseded'
  | 'executed'
  | 'verified';

export interface DecisionHistoryRecord {
  id: string;
  storeId: StoreId;
  decisionId: string;
  decisionRevision: number;
  eventType: DecisionHistoryEventType;
  actorId: string;
  reason?: string;
  snapshot: DecisionRecord;
  createdAt: string;
}

export type PolicyStatus = 'draft' | 'active' | 'disabled' | 'archived';
export type PolicyVersionStatus = 'draft' | 'enabled' | 'retired';

export interface PolicyRecord {
  id: string;
  storeId: StoreId;
  name: string;
  scope: string;
  status: PolicyStatus;
  priority: number;
  activeVersionId?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface PolicyVersionRules {
  allowedActionTypes: readonly MissionGrantActionType[];
  allowedAdEntityIds: readonly string[];
  maxChangePct: number;
  totalImpactBudget: number;
  /** Maximum number of proposal actions that may be authorized per business day. */
  maxDailyActionCount: number;
  /** Minimum elapsed time before the same Ads entity can receive another grant. */
  cooldownMinutes: number;
  /** V1 uses one non-overnight window in an explicit IANA timezone. */
  executionWindow: PolicyExecutionWindow;
  requiredEvidence: readonly MissionGrantEvidenceType[];
  stopConditions: readonly MissionGrantStopCondition[];
  killSwitch: boolean;
  [key: string]: unknown;
}

export interface PolicyExecutionWindow {
  timeZone: string;
  /** 0 = Sunday, 6 = Saturday. */
  daysOfWeek: readonly number[];
  /** Inclusive local wall-clock start, HH:mm. */
  start: string;
  /** Exclusive local wall-clock end, HH:mm. V1 does not cross midnight. */
  end: string;
}

export interface PolicyVersionRecord {
  id: string;
  storeId: StoreId;
  policyId: string;
  version: number;
  status: PolicyVersionStatus;
  rules: PolicyVersionRules;
  validFrom?: string;
  validUntil?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  enabledAt?: string;
  retiredAt?: string;
}

export type PolicyAutonomyMode = 'manual_approval' | 'policy_auto';
export type PolicyCircuitBreakerState = 'closed' | 'open' | 'half_open';

/** Store-scoped runtime authority; Renderer state is never authoritative. */
export interface PolicyRuntimeRecord {
  storeId: StoreId;
  autonomyMode: PolicyAutonomyMode;
  killSwitch: boolean;
  circuitBreakerState: PolicyCircuitBreakerState;
  activePolicyVersionId?: string;
  reason?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePolicyRuntimeInput {
  expectedRevision: number;
  actorId: string;
  patch: {
    autonomyMode?: PolicyAutonomyMode;
    killSwitch?: boolean;
    circuitBreakerState?: PolicyCircuitBreakerState;
    activePolicyVersionId?: string | null;
    reason?: string | null;
  };
}

export interface CreatePolicyInput {
  id: string;
  name: string;
  scope: string;
  priority: number;
  actorId: string;
}

export interface CreatePolicyVersionInput {
  id: string;
  policyId: string;
  version: number;
  rules: PolicyVersionRules;
  validFrom?: string;
  validUntil?: string;
  actorId: string;
}

export type ExperimentStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'completed'
  | 'archived';

export interface ExperimentRecord {
  id: string;
  storeId: StoreId;
  missionId: string;
  name: string;
  hypothesis: string;
  primaryMetric: string;
  guardrailMetrics: readonly string[];
  guardrailCriteria: readonly string[];
  productId?: string;
  adEntityId?: string;
  baseline: unknown;
  variant: unknown;
  observationStartsAt: string;
  observationEndsAt: string;
  status: ExperimentStatus;
  conclusion?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CreateExperimentInput {
  id: string;
  missionId: string;
  name: string;
  hypothesis: string;
  primaryMetric: string;
  guardrailMetrics: readonly string[];
  guardrailCriteria: readonly string[];
  productId?: string;
  adEntityId?: string;
  baseline: unknown;
  variant: unknown;
  observationStartsAt: string;
  observationEndsAt: string;
}

export interface UpdateExperimentInput {
  id: string;
  expectedRevision: number;
  patch: {
    name?: string;
    hypothesis?: string;
    primaryMetric?: string;
    guardrailMetrics?: readonly string[];
    guardrailCriteria?: readonly string[];
    productId?: string | null;
    adEntityId?: string | null;
    baseline?: unknown;
    variant?: unknown;
    observationStartsAt?: string;
    observationEndsAt?: string;
    conclusion?: string | null;
  };
  actorId: string;
}

export type ExperimentObservationType = 'baseline' | 'observation' | 'result' | 'correction';

export interface ExperimentObservationRecord {
  id: string;
  storeId: StoreId;
  experimentId: string;
  observationType: ExperimentObservationType;
  title: string;
  observation: string;
  observedAt: string;
  actorId: string;
  correctsRecordId?: string;
  createdAt: string;
}

export interface ExperimentMetricSnapshotRecord {
  id: string;
  storeId: StoreId;
  experimentId: string;
  metric: string;
  value: number;
  currency?: UsCurrency;
  observedAt: string;
  dataBatchId: string;
  createdAt: string;
}

export const CAUSAL_LEDGER_STAGES = [
  'FACT',
  'ANALYSIS',
  'DECISION',
  'ACTION',
  'READBACK',
  'EFFECT',
] as const;

export type CausalLedgerStage = (typeof CAUSAL_LEDGER_STAGES)[number];

export interface CausalEventRecord {
  id: string;
  storeId: StoreId;
  stage: CausalLedgerStage;
  eventType: string;
  entityType: string;
  entityId: string;
  missionId?: string;
  title: string;
  signal?: string;
  intervention?: string;
  expectedEffect?: string;
  observedEffect?: string;
  confidence?: number;
  status: string;
  source: string;
  actorId: string;
  businessDate: string;
  sessionGeneration: number;
  correctsEventId?: string;
  sequence: number;
  createdAt: string;
}

export interface AppendCausalEventInput {
  id: string;
  stage: CausalLedgerStage;
  eventType: string;
  entityType: string;
  entityId: string;
  missionId?: string;
  title: string;
  signal?: string;
  intervention?: string;
  expectedEffect?: string;
  observedEffect?: string;
  confidence?: number;
  status: string;
  source: string;
  actorId: string;
  correctsEventId?: string;
}

export interface CausalLinkRecord {
  id: string;
  storeId: StoreId;
  sourceEventId: string;
  targetType: string;
  targetId: string;
  relation: string;
  createdAt: string;
}

export interface CausalEvidenceRefRecord {
  id: string;
  storeId: StoreId;
  eventId: string;
  evidenceType: string;
  evidenceRef: string;
  sha256?: string;
  createdAt: string;
}

export function normalizeOpaqueEvidenceRef(value: unknown): string {
  let normalized: string;
  try {
    normalized = normalizeIdentifier(value, 'evidenceRef');
  } catch {
    throw new TypeError('evidenceRef must be an opaque logical id, not a filesystem path or file URI');
  }
  if (/^[a-zA-Z]:/.test(normalized)
    || normalized.startsWith('\\\\')
    || /[\\/]/.test(normalized)
    || /^file:/i.test(normalized)) {
    throw new TypeError('evidenceRef must be an opaque logical id, not a filesystem path or file URI');
  }
  return normalized;
}

export function authorizeMissionGrant(
  input: MissionGrantAuthorizationRequest,
): MissionGrantAuthorizationResult {
  try {
    return authorizeMissionGrantChecked(input);
  } catch (error) {
    return denied('INVALID_GRANT', error instanceof Error ? error.message : 'MissionGrant is invalid.');
  }
}

function authorizeMissionGrantChecked(
  input: MissionGrantAuthorizationRequest,
): MissionGrantAuthorizationResult {
  const context = normalizeStoreContextEnvelope(input.context);
  validateMissionGrant(input.grant);
  if (input.phase !== 'preflight' && input.phase !== 'completion') {
    throw new TypeError('MissionGrant authorization phase must be preflight or completion');
  }

  const grant = input.grant;
  if (!input.authority || typeof input.authority !== 'object') {
    throw new TypeError('MissionGrant execution authority is required');
  }
  const terminalEventTypes: readonly MissionGrantExecutionAuthority['terminalEventType'][] = [
    null,
    'revoked',
    'consumed',
    'expired',
  ];
  if (!terminalEventTypes.includes(input.authority.terminalEventType)) {
    throw new TypeError('MissionGrant terminal event type is invalid');
  }
  if (input.authority.terminalEventType) {
    return denied(
      'GRANT_TERMINATED',
      `MissionGrant is already ${input.authority.terminalEventType}.`,
    );
  }
  if (!Array.isArray(input.authority.activeStopConditions)) {
    throw new TypeError('MissionGrant active stop conditions are required');
  }
  const supportedStopCodes: readonly MissionGrantStopConditionCode[] = [
    'identity_drift',
    'expected_before_mismatch',
    'unknown_result',
    'data_stale',
    'impact_budget_exhausted',
    'kill_switch',
  ];
  if (input.authority.activeStopConditions.some((code) => !supportedStopCodes.includes(code))) {
    throw new TypeError('MissionGrant active stop conditions contain an unsupported code');
  }
  if (normalizeStoreId(grant.storeId) !== context.storeId
    || grant.marketplace !== context.marketplace
    || grant.currency !== context.currency) {
    return denied('STORE_MISMATCH', 'MissionGrant does not belong to the authoritative store context.');
  }
  if (grant.missionId !== normalizeIdentifier(input.missionId, 'missionId')) {
    return denied('MISSION_MISMATCH', 'MissionGrant mission does not match the requested action.');
  }
  if (grant.missionRevision !== normalizeRevision(input.missionRevision, 'missionRevision')) {
    return denied('MISSION_REVISION_MISMATCH', 'Mission revision changed after the grant was issued.');
  }
  if (grant.actionRevision !== normalizeRevision(input.actionRevision, 'actionRevision')) {
    return denied('ACTION_REVISION_MISMATCH', 'Action revision changed after the grant was issued.');
  }
  if (grant.policyVersionId !== normalizeIdentifier(input.policyVersionId, 'policyVersionId')) {
    return denied('POLICY_VERSION_MISMATCH', 'Policy version does not match the immutable grant snapshot.');
  }
  if (grant.policyRevision !== normalizeRevision(input.policyRevision, 'policyRevision')) {
    return denied('POLICY_REVISION_MISMATCH', 'Policy revision changed after the grant was issued.');
  }
  if (grant.createdSessionGeneration !== context.sessionGeneration) {
    return denied(
      'SESSION_GENERATION_MISMATCH',
      'Store session generation changed after the MissionGrant was issued.',
    );
  }
  const now = parseTimestamp(input.now ?? new Date().toISOString(), 'now');
  if (now >= parseTimestamp(grant.expiresAt, 'expiresAt')) {
    return denied('GRANT_EXPIRED', 'MissionGrant has expired.');
  }
  if (!grant.allowedActionTypes.includes(input.actionType)) {
    return denied('ACTION_TYPE_NOT_ALLOWED', 'Action type is outside the MissionGrant allowlist.');
  }
  const entityId = normalizeIdentifier(input.adEntityId, 'adEntityId');
  if (!grant.allowedAdEntityIds.includes(entityId)) {
    return denied('ENTITY_NOT_ALLOWED', 'Ad entity is outside the MissionGrant allowlist.');
  }
  if (!Number.isFinite(input.changePct) || Math.abs(input.changePct) > grant.maxChangePct) {
    return denied('CHANGE_LIMIT_EXCEEDED', 'Requested change exceeds the MissionGrant percentage limit.');
  }
  if (!Number.isFinite(input.authority.cumulativeImpact)
    || input.authority.cumulativeImpact < 0
    || input.authority.cumulativeImpact > grant.totalImpactBudget) {
    return denied('IMPACT_BUDGET_EXCEEDED', 'Requested cumulative impact exceeds the MissionGrant budget.');
  }
  const evidence = new Set(input.availableEvidence);
  const requiredEvidence = input.phase === 'preflight'
    ? (['page_identity', 'before_screenshot'] as const)
    : grant.requiredEvidence;
  if (requiredEvidence.some((required) => !evidence.has(required))) {
    return denied('REQUIRED_EVIDENCE_MISSING', 'MissionGrant required evidence is incomplete.');
  }
  const activeStops = new Set(input.authority.activeStopConditions);
  if (grant.stopConditions.some((condition) => activeStops.has(condition.code))) {
    return denied('STOP_CONDITION_ACTIVE', 'A MissionGrant stop condition is active.');
  }
  return { authorized: true, grantId: grant.id };
}

export function validateMissionGrant(grant: MissionGrantRecord | CreateMissionGrantInput): void {
  normalizeIdentifier(grant.id, 'grantId');
  normalizeIdentifier(grant.missionId, 'missionId');
  normalizeRevision(grant.missionRevision, 'missionRevision');
  normalizeNonEmptyUniqueList(grant.decisionIds, 'decisionIds');
  normalizeRevision(grant.actionRevision, 'actionRevision');
  normalizeIdentifier(grant.policyVersionId, 'policyVersionId');
  normalizeRevision(grant.policyRevision, 'policyRevision');
  normalizeNonEmptyUniqueList(grant.allowedActionTypes, 'allowedActionTypes');
  if (grant.allowedActionTypes.some((value) => value !== 'set_keyword_bid')) {
    throw new TypeError('allowedActionTypes contains an unsupported V1 action');
  }
  normalizeNonEmptyUniqueList(grant.allowedAdEntityIds, 'allowedAdEntityIds');
  if (!Number.isFinite(grant.maxChangePct) || grant.maxChangePct <= 0 || grant.maxChangePct > 100) {
    throw new TypeError('maxChangePct must be greater than 0 and at most 100');
  }
  if (!Number.isFinite(grant.totalImpactBudget) || grant.totalImpactBudget < 0) {
    throw new TypeError('totalImpactBudget must be a non-negative finite number');
  }
  parseTimestamp(grant.expiresAt, 'expiresAt');
  normalizeNonEmptyUniqueList(grant.requiredEvidence, 'requiredEvidence');
  const evidenceTypes: readonly MissionGrantEvidenceType[] = [
    'before_screenshot',
    'after_screenshot',
    'reload_screenshot',
    'page_identity',
    'readback_value',
  ];
  if (grant.requiredEvidence.some((value) => !evidenceTypes.includes(value))) {
    throw new TypeError('requiredEvidence contains an unsupported evidence type');
  }
  if (evidenceTypes.some((value) => !grant.requiredEvidence.includes(value))) {
    throw new TypeError('requiredEvidence must retain every mandatory V1 readback proof');
  }
  if (!Array.isArray(grant.stopConditions) || grant.stopConditions.length === 0) {
    throw new TypeError('stopConditions must contain at least one fail-closed condition');
  }
  const stopCodes: readonly MissionGrantStopConditionCode[] = [
    'identity_drift',
    'expected_before_mismatch',
    'unknown_result',
    'data_stale',
    'impact_budget_exhausted',
    'kill_switch',
  ];
  for (const condition of grant.stopConditions) {
    if (!condition || typeof condition !== 'object') throw new TypeError('stopConditions contains an invalid condition');
    normalizeIdentifier(condition.code, 'stopCondition.code');
    if (!stopCodes.includes(condition.code)) {
      throw new TypeError('stopConditions contains an unsupported stop condition code');
    }
    normalizeText(condition.detail, 'stopCondition.detail', 500);
  }
  const configuredStopCodes = grant.stopConditions.map((condition) => condition.code);
  if (new Set(configuredStopCodes).size !== configuredStopCodes.length) {
    throw new TypeError('stopConditions must not contain duplicate codes');
  }
  if (stopCodes.some((code) => !configuredStopCodes.includes(code))) {
    throw new TypeError('stopConditions must retain every mandatory V1 fail-closed condition');
  }
  if (grant.issuer.type !== 'human' && grant.issuer.type !== 'policy') {
    throw new TypeError('issuer.type must be human or policy');
  }
  normalizeIdentifier(grant.issuer.actorId, 'issuer.actorId');
  if ('createdSessionGeneration' in grant) {
    if (!Number.isSafeInteger(grant.createdSessionGeneration) || grant.createdSessionGeneration < 0) {
      throw new TypeError('createdSessionGeneration must be a non-negative safe integer');
    }
    normalizeStoreId(grant.storeId);
    if (grant.marketplace !== 'US' || grant.currency !== 'USD') {
      throw new TypeError('MissionGrant V1 authority must use US marketplace and USD currency');
    }
    parseTimestamp(grant.issuedAt, 'issuedAt');
  }
}

export function normalizeDomainIdentifier(value: unknown, label = 'id'): string {
  return normalizeIdentifier(value, label);
}

export function normalizeDomainRevision(value: unknown, label = 'revision'): number {
  return normalizeRevision(value, label);
}

export function normalizeDomainText(value: unknown, label: string, maxLength = 2_000): string {
  return normalizeText(value, label, maxLength);
}

export function normalizeDomainTimestamp(value: unknown, label: string): string {
  parseTimestamp(value, label);
  return String(value).trim();
}

export function normalizeDomainStringList(
  value: unknown,
  label: string,
  options: { required?: boolean; maxItems?: number; maxLength?: number } = {},
): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const maxItems = options.maxItems ?? 100;
  if (value.length > maxItems) throw new TypeError(`${label} cannot contain more than ${maxItems} items`);
  const normalized = value.map((item, index) => normalizeText(
    item,
    `${label}[${index}]`,
    options.maxLength ?? 500,
  ));
  if ((options.required ?? false) && normalized.length === 0) {
    throw new TypeError(`${label} must contain at least one item`);
  }
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} cannot contain duplicates`);
  return normalized;
}

function denied(code: MissionGrantDenialCode, detail: string): MissionGrantAuthorizationResult {
  return { authorized: false, code, detail };
}

function normalizeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string identifier`);
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)) {
    throw new TypeError(`${label} must be a logical identifier and must not be a path`);
  }
  return normalized;
}

function normalizeRevision(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized.length > maxLength) throw new TypeError(`${label} cannot exceed ${maxLength} characters`);
  return normalized;
}

function normalizeNonEmptyUniqueList(values: readonly unknown[], label: string): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${label} must contain at least one item`);
  }
  const normalized = values.map((value, index) => normalizeIdentifier(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} cannot contain duplicates`);
}

function parseTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be an ISO timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be an ISO timestamp`);
  return parsed;
}
