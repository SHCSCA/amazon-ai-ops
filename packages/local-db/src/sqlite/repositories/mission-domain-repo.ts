import Database from 'better-sqlite3';
import {
  CAUSAL_LEDGER_STAGES,
  normalizeDomainIdentifier,
  normalizeOpaqueEvidenceRef,
  normalizeDomainRevision,
  normalizeDomainStringList,
  normalizeDomainText,
  normalizeDomainTimestamp,
  normalizeStoreContextEnvelope,
  validateMissionGrant,
  type AppendCausalEventInput,
  type AppendMissionCheckpointInput,
  type CausalEvidenceRefRecord,
  type CausalEventRecord,
  type CausalLedgerStage,
  type CausalLinkRecord,
  type CreateDecisionInput,
  type CreateExperimentInput,
  type CreateMissionGrantInput,
  type CreateMissionInput,
  type CreatePolicyInput,
  type CreatePolicyVersionInput,
  type DecisionHistoryEventType,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type DecisionStatus,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentObservationType,
  type ExperimentRecord,
  type ExperimentStatus,
  type MissionGrantEventRecord,
  type MissionGrantEventType,
  type MissionGrantRecord,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionLinkType,
  type MissionPhase,
  type MissionPriority,
  type MissionRecord,
  type MissionCheckpointRecord,
  type PolicyRecord,
  type PolicyRuntimeRecord,
  type PolicyStatus,
  type PolicyVersionRecord,
  type PolicyVersionRules,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
  type UpdateExperimentInput,
  type UpdateMissionInput,
  type UpdatePolicyRuntimeInput,
  type UsCurrency,
  type UsMarketplace,
} from '@amazon-ai-ops/shared-types';

export type MissionDomainRepositoryErrorCode =
  | 'INVALID_CONTEXT'
  | 'STALE_CONTEXT'
  | 'STORE_NOT_ACTIVE'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'STATE_CONFLICT'
  | 'REFERENCE_CONFLICT'
  | 'IMMUTABLE_RECORD'
  | 'DUPLICATE_IDENTITY';

export class MissionDomainRepositoryError extends Error {
  constructor(
    readonly code: MissionDomainRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MissionDomainRepositoryError';
  }
}

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
  eventType: Exclude<MissionGrantEventType, 'issued'>;
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
}

export interface MissionDomainRepositoryOptions {
  now?: () => Date;
  references?: MissionDomainReferenceValidator;
}

interface StoreAuthorityRow {
  store_id: string;
  browser_profile_id: string;
  marketplace: string;
  currency: string;
  business_timezone: string;
  status: string;
}

interface MissionRow {
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

interface PolicyRow {
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

interface PolicyVersionRow {
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

interface PolicyRuntimeRow {
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

interface DecisionRow {
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

interface ExperimentRow {
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

interface GrantRow {
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

interface CausalRow {
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

export class MissionDomainRepository {
  private readonly now: () => Date;
  private readonly references?: MissionDomainReferenceValidator;

  constructor(
    private readonly db: Database.Database,
    options: MissionDomainRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.references = options.references;
  }

  createPolicy(contextInput: StoreContextEnvelope, input: CreatePolicyInput): PolicyRecord {
    const context = this.assertContext(contextInput);
    const id = idOf(input.id, 'policyId');
    const now = this.timestamp();
    const create = this.db.transaction(() => {
      this.db.prepare(`
          INSERT INTO policies (
            id, store_id, name, scope, status, priority, active_version_id,
            revision, created_at, updated_at, archived_at
          ) VALUES (?, ?, ?, ?, 'draft', ?, NULL, 1, ?, ?, NULL)
        `).run(
          id,
          context.storeId,
          textOf(input.name, 'name', 200),
          textOf(input.scope, 'scope', 120),
          priorityOf(input.priority),
          now,
          now,
        );
      const policy = this.requirePolicy(context, id);
      this.appendPolicyAudit(context, {
        id: `causal:policy:${policy.id}:r${policy.revision}`,
        eventType: 'policy_created',
        entityType: 'policy',
        entityId: policy.id,
        title: policy.name,
        signal: policy.scope,
        status: policy.status,
        actorId: input.actorId,
      }, now);
      return policy;
    });
    try {
      return create.immediate();
    } catch (error) {
      this.rethrowConstraint(error, `Policy ${id} already exists.`);
    }
  }

  getPolicy(contextInput: StoreContextEnvelope, idInput: string): PolicyRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM policies WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'policyId')) as PolicyRow | undefined;
    return row ? mapPolicy(row) : undefined;
  }

  listPolicies(contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): PolicyRecord[] {
    const context = this.assertContext(contextInput);
    const rows = this.db.prepare(`
      SELECT * FROM policies
      WHERE store_id = ? AND (? = 1 OR status <> 'archived')
      ORDER BY priority, updated_at DESC, id
    `).all(context.storeId, input.includeArchived ? 1 : 0) as PolicyRow[];
    return rows.map(mapPolicy);
  }

  updatePolicy(contextInput: StoreContextEnvelope, input: UpdatePolicyInput): PolicyRecord {
    const context = this.assertContext(contextInput);
    const current = this.requirePolicy(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Policy');
    const patch = input.patch;
    if (!patch || Object.keys(patch).length === 0) {
      throw invalid('Policy patch cannot be empty.');
    }
    const name = patch.name === undefined ? current.name : textOf(patch.name, 'name', 200);
    const scope = patch.scope === undefined ? current.scope : textOf(patch.scope, 'scope', 120);
    const priority = patch.priority === undefined ? current.priority : priorityOf(patch.priority);
    const now = nextTimestamp(current.updatedAt, this.now());
    const update = this.db.transaction(() => {
      const updated = this.db.prepare(`
        UPDATE policies
        SET name = @name, scope = @scope, priority = @priority,
            revision = revision + 1, updated_at = @updatedAt
        WHERE store_id = @storeId AND id = @id AND revision = @expectedRevision
          AND status <> 'archived'
      `).run({
        storeId: context.storeId,
        id: current.id,
        name,
        scope,
        priority,
        updatedAt: now,
        expectedRevision: input.expectedRevision,
      });
      this.assertCas(updated.changes, 'Policy');
      const policy = this.requirePolicy(context, current.id);
      this.appendPolicyAudit(context, {
        id: `causal:policy:${policy.id}:r${policy.revision}`,
        eventType: 'policy_updated', entityType: 'policy', entityId: policy.id,
        title: policy.name, signal: policy.scope, status: policy.status,
        actorId: input.actorId,
      }, now);
      return policy;
    });
    return update.immediate();
  }

  disablePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord {
    const context = this.assertContext(contextInput);
    const disable = this.db.transaction(() => {
      const current = this.requirePolicy(context, input.id);
      this.assertRevision(current.revision, input.expectedRevision, 'Policy');
      if (current.status === 'archived') throw stateConflict('Archived policy must be restored before disable.');
      const now = nextTimestamp(current.updatedAt, this.now());
      if (current.activeVersionId) {
        this.db.prepare(`
          UPDATE policy_versions
          SET status = 'retired', retired_at = ?, updated_at = ?
          WHERE store_id = ? AND id = ? AND status = 'enabled'
        `).run(now, now, context.storeId, current.activeVersionId);
      }
      const result = this.db.prepare(`
        UPDATE policies
        SET status = 'disabled', active_version_id = NULL,
            revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ?
      `).run(now, context.storeId, current.id, input.expectedRevision);
      this.assertCas(result.changes, 'Policy');
      this.db.prepare(`
        UPDATE policy_runtime
        SET autonomy_mode = 'manual_approval', active_policy_version_id = NULL,
            reason = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND active_policy_version_id = ?
      `).run(optionalText(input.reason) ?? 'policy_disabled', now, context.storeId, current.activeVersionId ?? '');
      const policy = this.requirePolicy(context, current.id);
      this.appendPolicyAudit(context, {
        id: `causal:policy:${policy.id}:r${policy.revision}`,
        eventType: 'policy_disabled', entityType: 'policy', entityId: policy.id,
        title: policy.name, intervention: optionalText(input.reason) ?? undefined,
        status: policy.status, actorId: input.actorId,
      }, now);
      return policy;
    });
    return disable.immediate();
  }

  archivePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord {
    const context = this.assertContext(contextInput);
    const current = this.requirePolicy(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Policy');
    if (current.status === 'active' || current.activeVersionId) {
      throw stateConflict('Disable the policy before archival.');
    }
    if (current.status === 'archived') return current;
    const now = nextTimestamp(current.updatedAt, this.now());
    const archive = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE policies
        SET status = 'archived', archived_at = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ? AND active_version_id IS NULL
      `).run(now, now, context.storeId, current.id, input.expectedRevision);
      this.assertCas(result.changes, 'Policy');
      const policy = this.requirePolicy(context, current.id);
      this.appendPolicyAudit(context, {
        id: `causal:policy:${policy.id}:r${policy.revision}`,
        eventType: 'policy_archived', entityType: 'policy', entityId: policy.id,
        title: policy.name, intervention: optionalText(input.reason) ?? undefined,
        status: policy.status, actorId: input.actorId,
      }, now);
      return policy;
    });
    return archive.immediate();
  }

  restorePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord {
    const context = this.assertContext(contextInput);
    const current = this.requirePolicy(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Policy');
    if (current.status !== 'archived') throw stateConflict('Only archived policy can be restored.');
    const now = nextTimestamp(current.updatedAt, this.now());
    const restore = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE policies
        SET status = 'disabled', archived_at = NULL, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ? AND status = 'archived'
      `).run(now, context.storeId, current.id, input.expectedRevision);
      this.assertCas(result.changes, 'Policy');
      const policy = this.requirePolicy(context, current.id);
      this.appendPolicyAudit(context, {
        id: `causal:policy:${policy.id}:r${policy.revision}`,
        eventType: 'policy_restored', entityType: 'policy', entityId: policy.id,
        title: policy.name, intervention: optionalText(input.reason) ?? undefined,
        status: policy.status, actorId: input.actorId,
      }, now);
      return policy;
    });
    return restore.immediate();
  }

  createPolicyVersion(
    contextInput: StoreContextEnvelope,
    input: CreatePolicyVersionInput,
  ): PolicyVersionRecord {
    const context = this.assertContext(contextInput);
    const id = idOf(input.id, 'policyVersionId');
    const policy = this.requirePolicy(context, input.policyId);
    if (policy.status === 'archived') throw stateConflict('Archived policy cannot accept a new version.');
    const rules = rulesOf(input.rules);
    this.assertAdEntities(context, rules.allowedAdEntityIds);
    const validFrom = optionalTimestamp(input.validFrom, 'validFrom');
    const validUntil = optionalTimestamp(input.validUntil, 'validUntil');
    assertTimeRange(validFrom, validUntil, 'Policy validity window');
    const now = this.timestamp();
    const create = this.db.transaction(() => {
      this.db.prepare(`
          INSERT INTO policy_versions (
            id, store_id, policy_id, version, status, rules_json,
            valid_from, valid_until, revision, created_at, updated_at,
            enabled_at, retired_at
          ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, 1, ?, ?, NULL, NULL)
        `).run(
          id,
          context.storeId,
          policy.id,
          revisionOf(input.version, 'version'),
          json(rules),
          validFrom,
          validUntil,
          now,
          now,
        );
      const version = this.requirePolicyVersion(context, id);
      this.appendPolicyAudit(context, {
        id: `causal:policy-version:${version.id}:r${version.revision}`,
        eventType: 'policy_version_created', entityType: 'policy_version', entityId: version.id,
        title: `${policy.name} v${version.version}`, signal: version.policyId,
        status: version.status, actorId: input.actorId,
      }, now);
      return version;
    });
    try {
      return create.immediate();
    } catch (error) {
      this.rethrowConstraint(error, `Policy version ${id} or version number already exists.`);
    }
  }

  getPolicyVersion(
    contextInput: StoreContextEnvelope,
    idInput: string,
  ): PolicyVersionRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM policy_versions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'policyVersionId')) as PolicyVersionRow | undefined;
    return row ? mapPolicyVersion(row) : undefined;
  }

  listPolicyVersions(contextInput: StoreContextEnvelope, policyIdInput: string): PolicyVersionRecord[] {
    const context = this.assertContext(contextInput);
    const policyId = idOf(policyIdInput, 'policyId');
    this.requirePolicy(context, policyId);
    return (this.db.prepare(`
      SELECT * FROM policy_versions
      WHERE store_id = ? AND policy_id = ?
      ORDER BY version DESC, id
    `).all(context.storeId, policyId) as PolicyVersionRow[]).map(mapPolicyVersion);
  }

  updateDraftPolicyVersion(
    contextInput: StoreContextEnvelope,
    input: UpdateDraftPolicyVersionInput,
  ): PolicyVersionRecord {
    const context = this.assertContext(contextInput);
    const current = this.requirePolicyVersion(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Policy version');
    if (current.status !== 'draft') {
      throw new MissionDomainRepositoryError(
        'IMMUTABLE_RECORD',
        'Enabled or retired policy versions are immutable; create a new version.',
      );
    }
    const rules = input.rules === undefined ? current.rules : rulesOf(input.rules);
    this.assertAdEntities(context, rules.allowedAdEntityIds);
    const validFrom = input.validFrom === undefined
      ? current.validFrom ?? null
      : optionalTimestamp(input.validFrom, 'validFrom');
    const validUntil = input.validUntil === undefined
      ? current.validUntil ?? null
      : optionalTimestamp(input.validUntil, 'validUntil');
    assertTimeRange(validFrom, validUntil, 'Policy validity window');
    const updatedAt = nextTimestamp(current.updatedAt, this.now());
    const update = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE policy_versions
        SET rules_json = @rulesJson, valid_from = @validFrom, valid_until = @validUntil,
            revision = revision + 1, updated_at = @updatedAt
        WHERE store_id = @storeId AND id = @id AND revision = @expectedRevision AND status = 'draft'
      `).run({
        storeId: context.storeId,
        id: current.id,
        expectedRevision: input.expectedRevision,
        rulesJson: json(rules),
        validFrom,
        validUntil,
        updatedAt,
      });
      this.assertCas(result.changes, 'Policy version');
      const version = this.requirePolicyVersion(context, current.id);
      this.appendPolicyAudit(context, {
        id: `causal:policy-version:${version.id}:r${version.revision}`,
        eventType: 'policy_version_updated', entityType: 'policy_version', entityId: version.id,
        title: `Policy version ${version.version}`, signal: version.policyId,
        status: version.status, actorId: input.actorId,
      }, updatedAt);
      return version;
    });
    return update.immediate();
  }

  enablePolicyVersion(
    contextInput: StoreContextEnvelope,
    input: EnablePolicyVersionInput,
  ): PolicyVersionRecord {
    const context = this.assertContext(contextInput);
    const enable = this.db.transaction(() => {
      const policy = this.requirePolicy(context, input.policyId);
      const version = this.requirePolicyVersion(context, input.versionId);
      this.assertRevision(policy.revision, input.expectedPolicyRevision, 'Policy');
      this.assertRevision(version.revision, input.expectedVersionRevision, 'Policy version');
      if (version.policyId !== policy.id) throw referenceConflict('Policy version does not belong to policy.');
      if (policy.status === 'archived') throw stateConflict('Archived policy cannot be enabled.');
      if (version.status !== 'draft') throw stateConflict('Only a draft policy version can be enabled.');
      const now = this.timestamp();
      if (version.validUntil && Date.parse(version.validUntil) <= Date.parse(now)) {
        throw stateConflict('Expired policy version cannot be enabled.');
      }
      this.db.prepare(`
        UPDATE policy_versions
        SET status = 'retired', retired_at = ?, updated_at = ?
        WHERE store_id = ? AND policy_id = ? AND status = 'enabled'
      `).run(now, now, context.storeId, policy.id);
      const enabled = this.db.prepare(`
        UPDATE policy_versions
        SET status = 'enabled', enabled_at = ?, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ? AND status = 'draft'
      `).run(now, now, context.storeId, version.id, input.expectedVersionRevision);
      this.assertCas(enabled.changes, 'Policy version');
      const policyUpdated = this.db.prepare(`
        UPDATE policies
        SET status = 'active', active_version_id = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ?
      `).run(version.id, now, context.storeId, policy.id, input.expectedPolicyRevision);
      this.assertCas(policyUpdated.changes, 'Policy');
      this.db.prepare(`
        UPDATE policy_runtime
        SET active_policy_version_id = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ?
      `).run(version.id, now, context.storeId);
      const enabledVersion = this.requirePolicyVersion(context, version.id);
      this.appendPolicyAudit(context, {
        id: `causal:policy-version:${enabledVersion.id}:enabled`,
        eventType: 'policy_version_enabled', entityType: 'policy_version', entityId: enabledVersion.id,
        title: `${policy.name} v${enabledVersion.version}`, signal: policy.id,
        status: enabledVersion.status, actorId: input.actorId,
      }, now);
      return enabledVersion;
    });
    return enable.immediate();
  }

  getPolicyRuntime(contextInput: StoreContextEnvelope): PolicyRuntimeRecord {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM policy_runtime WHERE store_id = ?`)
      .get(context.storeId) as PolicyRuntimeRow | undefined;
    if (!row) {
      throw new MissionDomainRepositoryError(
        'REFERENCE_CONFLICT',
        `Policy runtime authority is missing for store ${context.storeId}.`,
      );
    }
    return mapPolicyRuntime(row);
  }

  updatePolicyRuntime(
    contextInput: StoreContextEnvelope,
    input: UpdatePolicyRuntimeInput,
  ): PolicyRuntimeRecord {
    const context = this.assertContext(contextInput);
    const current = this.getPolicyRuntime(context);
    this.assertRevision(current.revision, input.expectedRevision, 'Policy runtime');
    if (!input.patch || Object.keys(input.patch).length === 0) {
      throw invalid('Policy runtime patch cannot be empty.');
    }
    const autonomyMode = input.patch.autonomyMode ?? current.autonomyMode;
    const killSwitch = input.patch.killSwitch ?? current.killSwitch;
    const circuitBreakerState = input.patch.circuitBreakerState ?? current.circuitBreakerState;
    const activePolicyVersionId = input.patch.activePolicyVersionId === undefined
      ? current.activePolicyVersionId ?? null
      : optionalId(input.patch.activePolicyVersionId, 'activePolicyVersionId');
    if (!['manual_approval', 'policy_auto'].includes(autonomyMode)) throw invalid('Unsupported autonomy mode.');
    if (typeof killSwitch !== 'boolean') throw invalid('Policy runtime killSwitch must be boolean.');
    if (!['closed', 'open', 'half_open'].includes(circuitBreakerState)) {
      throw invalid('Unsupported circuit-breaker state.');
    }
    if (activePolicyVersionId) {
      const version = this.requirePolicyVersion(context, activePolicyVersionId);
      if (version.status !== 'enabled') {
        throw stateConflict('Policy runtime can bind only an enabled immutable policy version.');
      }
    }
    if (autonomyMode === 'policy_auto'
      && (!activePolicyVersionId || killSwitch || circuitBreakerState !== 'closed')) {
      throw stateConflict(
        'Policy-auto requires an enabled policy version, kill switch off, and a closed circuit breaker.',
      );
    }
    const updatedAt = nextTimestamp(current.updatedAt, this.now());
    const update = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE policy_runtime
        SET autonomy_mode = @autonomyMode,
            kill_switch = @killSwitch,
            circuit_breaker_state = @circuitBreakerState,
            active_policy_version_id = @activePolicyVersionId,
            reason = @reason,
            revision = revision + 1,
            updated_at = @updatedAt
        WHERE store_id = @storeId AND revision = @expectedRevision
      `).run({
        storeId: context.storeId,
        expectedRevision: input.expectedRevision,
        autonomyMode,
        killSwitch: killSwitch ? 1 : 0,
        circuitBreakerState,
        activePolicyVersionId,
        reason: input.patch.reason === undefined ? current.reason ?? null : optionalText(input.patch.reason),
        updatedAt,
      });
      this.assertCas(result.changes, 'Policy runtime');
      const runtime = this.getPolicyRuntime(context);
      this.appendPolicyAudit(context, {
        id: `causal:policy-runtime:${context.storeId}:r${runtime.revision}`,
        eventType: 'policy_runtime_updated', entityType: 'policy_runtime',
        entityId: context.storeId, title: 'Policy runtime authority',
        signal: `${runtime.autonomyMode}:${runtime.circuitBreakerState}`,
        intervention: runtime.reason, status: runtime.killSwitch ? 'kill_switch_on' : 'ready',
        actorId: input.actorId,
      }, updatedAt);
      return runtime;
    });
    return update.immediate();
  }

  createMission(contextInput: StoreContextEnvelope, input: CreateMissionInput): MissionRecord {
    const context = this.assertContext(contextInput);
    const id = idOf(input.id, 'missionId');
    const dataBatchId = idOf(input.dataBatchId, 'dataBatchId');
    const policyVersionId = idOf(input.policyVersionId, 'policyVersionId');
    this.requireCompletedDataBatch(context, dataBatchId);
    const policyVersion = this.requirePolicyVersion(context, policyVersionId);
    if (policyVersion.status !== 'enabled') {
      throw stateConflict('Mission must bind the currently enabled policy version.');
    }
    const policy = this.requirePolicy(context, policyVersion.policyId);
    if (policy.activeVersionId !== policyVersion.id || policy.status !== 'active') {
      throw stateConflict('Mission policy version is not the active store policy authority.');
    }
    const observationStartsAt = timestampOf(input.observationStartsAt, 'observationStartsAt');
    const observationEndsAt = timestampOf(input.observationEndsAt, 'observationEndsAt');
    assertTimeRange(observationStartsAt, observationEndsAt, 'Mission observation window');
    const successCriteria = listOf(input.successCriteria, 'successCriteria', true);
    const guardrails = listOf(input.guardrails, 'guardrails', true);
    const actorId = idOf(input.actorId, 'actorId');
    const now = this.timestamp();
    if (input.productId) this.assertProduct(context, input.productId);
    const priority = missionPriorityOf(input.priority ?? 'P2');
    const create = this.db.transaction(() => {
      try {
        this.db.prepare(`
          INSERT INTO missions (
            id, store_id, marketplace, currency, business_date,
            created_session_generation, data_batch_id, policy_version_id,
            title, objective, status, phase, priority, product_id,
            observation_starts_at, observation_ends_at,
            success_criteria_json, guardrails_json, revision,
            created_at, updated_at, archived_at
          ) VALUES (
            @id, @storeId, 'US', 'USD', @businessDate,
            @sessionGeneration, @dataBatchId, @policyVersionId,
            @title, @objective, 'draft', 'fact', @priority, @productId,
            @observationStartsAt, @observationEndsAt,
            @successCriteriaJson, @guardrailsJson, 1,
            @createdAt, @updatedAt, NULL
          )
        `).run({
          id,
          storeId: context.storeId,
          businessDate: context.businessDate,
          sessionGeneration: context.sessionGeneration,
          dataBatchId,
          policyVersionId,
          title: textOf(input.title, 'title', 300),
          objective: textOf(input.objective, 'objective', 2_000),
          priority,
          productId: optionalId(input.productId, 'productId'),
          observationStartsAt,
          observationEndsAt,
          successCriteriaJson: json(successCriteria),
          guardrailsJson: json(guardrails),
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        this.rethrowConstraint(error, `Mission ${id} already exists or references invalid authority.`);
      }
      const mission = this.requireMission(context, id);
      this.insertMissionEvent(context, mission, 'created', actorId, undefined, now);
      this.insertMissionLink(context, {
        id: `link:${id}:data-batch`, missionId: id, linkType: 'data_batch',
        targetId: dataBatchId, relation: 'source', actorId,
      }, now);
      this.insertMissionLink(context, {
        id: `link:${id}:policy-version`, missionId: id, linkType: 'policy_version',
        targetId: policyVersionId, relation: 'governed_by', actorId,
      }, now);
      this.appendCausalInternal(context, {
        id: `causal:mission:${id}:created`,
        stage: 'FACT',
        eventType: 'mission_created',
        entityType: 'mission',
        entityId: id,
        missionId: id,
        title: mission.title,
        signal: `Source data batch ${dataBatchId}`,
        status: 'recorded',
        source: 'mission-domain',
        actorId,
      }, now);
      return mission;
    });
    return create.immediate();
  }

  getMission(contextInput: StoreContextEnvelope, idInput: string): MissionRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM missions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'missionId')) as MissionRow | undefined;
    return row ? mapMission(row) : undefined;
  }

  listMissions(contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): MissionRecord[] {
    const context = this.assertContext(contextInput);
    return (this.db.prepare(`
      SELECT * FROM missions
      WHERE store_id = ? AND (? = 1 OR status <> 'archived')
      ORDER BY updated_at DESC, id
    `).all(context.storeId, input.includeArchived ? 1 : 0) as MissionRow[]).map(mapMission);
  }

  updateMission(contextInput: StoreContextEnvelope, input: UpdateMissionInput): MissionRecord {
    const context = this.assertContext(contextInput);
    const current = this.requireMission(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Mission');
    if (['completed', 'archived'].includes(current.status)) {
      throw stateConflict('Completed or archived Mission cannot be edited.');
    }
    const patch = input.patch;
    if (!patch || Object.keys(patch).length === 0) throw invalid('Mission patch cannot be empty.');
    const actorId = idOf(input.actorId, 'actorId');
    if (patch.productId) this.assertProduct(context, patch.productId);
    const startsAt = patch.observationStartsAt === undefined
      ? current.observationStartsAt
      : timestampOf(patch.observationStartsAt, 'observationStartsAt');
    const endsAt = patch.observationEndsAt === undefined
      ? current.observationEndsAt
      : timestampOf(patch.observationEndsAt, 'observationEndsAt');
    assertTimeRange(startsAt, endsAt, 'Mission observation window');
    const updatedAt = nextTimestamp(current.updatedAt, this.now());
    const update = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE missions
        SET title = @title, objective = @objective, priority = @priority,
            product_id = @productId,
            observation_starts_at = @observationStartsAt,
            observation_ends_at = @observationEndsAt,
            success_criteria_json = @successCriteriaJson,
            guardrails_json = @guardrailsJson,
            revision = revision + 1, updated_at = @updatedAt
        WHERE store_id = @storeId AND id = @id AND revision = @expectedRevision
      `).run({
        storeId: context.storeId,
        id: current.id,
        expectedRevision: input.expectedRevision,
        title: patch.title === undefined ? current.title : textOf(patch.title, 'title', 300),
        objective: patch.objective === undefined ? current.objective : textOf(patch.objective, 'objective', 2_000),
        priority: missionPriorityOf(patch.priority ?? current.priority),
        productId: patch.productId === undefined ? current.productId ?? null : optionalId(patch.productId, 'productId'),
        observationStartsAt: startsAt,
        observationEndsAt: endsAt,
        successCriteriaJson: json(patch.successCriteria === undefined
          ? current.successCriteria
          : listOf(patch.successCriteria, 'successCriteria', true)),
        guardrailsJson: json(patch.guardrails === undefined
          ? current.guardrails
          : listOf(patch.guardrails, 'guardrails', true)),
        updatedAt,
      });
      this.assertCas(result.changes, 'Mission');
      const mission = this.requireMission(context, current.id);
      this.insertMissionEvent(context, mission, 'updated', actorId, undefined, updatedAt);
      return mission;
    });
    return update.immediate();
  }

  transitionMission(
    contextInput: StoreContextEnvelope,
    input: {
      id: string;
      expectedRevision: number;
      status: Exclude<MissionLifecycleStatus, 'archived'>;
      phase?: MissionPhase;
      reason?: string;
      actorId: string;
    },
  ): MissionRecord {
    const context = this.assertContext(contextInput);
    const current = this.requireMission(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Mission');
    assertMissionTransition(current.status, input.status);
    const actorId = idOf(input.actorId, 'actorId');
    const phase = input.phase ?? current.phase;
    if (!['fact', 'analysis', 'decision', 'action', 'readback', 'effect'].includes(phase)) {
      throw invalid('Unsupported Mission phase.');
    }
    const updatedAt = nextTimestamp(current.updatedAt, this.now());
    const transition = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE missions
        SET status = ?, phase = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ? AND status <> 'archived'
      `).run(input.status, phase, updatedAt, context.storeId, current.id, input.expectedRevision);
      this.assertCas(result.changes, 'Mission');
      const mission = this.requireMission(context, current.id);
      this.insertMissionEvent(context, mission, `status_${input.status}`, actorId, optionalText(input.reason), updatedAt);
      return mission;
    });
    return transition.immediate();
  }

  archiveMission(context: StoreContextEnvelope, input: ArchiveRestoreInput): MissionRecord {
    return this.setMissionArchive(context, input, true);
  }

  restoreMission(context: StoreContextEnvelope, input: ArchiveRestoreInput): MissionRecord {
    return this.setMissionArchive(context, input, false);
  }

  appendMissionCheckpoint(
    contextInput: StoreContextEnvelope,
    input: AppendMissionCheckpointInput,
  ): MissionCheckpointRecord {
    const context = this.assertContext(contextInput);
    this.requireMission(context, input.missionId);
    if (!CAUSAL_LEDGER_STAGES.includes(input.stage)) throw invalid('Unknown Mission checkpoint stage.');
    if (!Number.isSafeInteger(input.evidenceCount) || input.evidenceCount < 0) {
      throw invalid('Mission checkpoint evidenceCount must be a non-negative integer.');
    }
    const id = idOf(input.id, 'missionCheckpointId');
    const createdAt = this.timestamp();
    try {
      this.db.prepare(`
        INSERT INTO mission_checkpoints (
          id, store_id, mission_id, stage, title, status,
          evidence_count, actor_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, context.storeId, idOf(input.missionId, 'missionId'), input.stage,
        textOf(input.title, 'title', 300), textOf(input.status, 'status', 120),
        input.evidenceCount, idOf(input.actorId, 'actorId'), createdAt,
      );
    } catch (error) {
      this.rethrowConstraint(error, `Mission checkpoint ${id} already exists or has invalid lineage.`);
    }
    return this.requireMissionCheckpoint(context, id);
  }

  listMissionCheckpoints(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): MissionCheckpointRecord[] {
    const context = this.assertContext(contextInput);
    const missionId = idOf(missionIdInput, 'missionId');
    this.requireMission(context, missionId);
    return (this.db.prepare(`
      SELECT * FROM mission_checkpoints
      WHERE store_id = ? AND mission_id = ?
      ORDER BY created_at, id
    `).all(context.storeId, missionId) as Array<Record<string, unknown>>)
      .map(mapMissionCheckpoint);
  }

  appendMissionLink(contextInput: StoreContextEnvelope, input: AppendMissionLinkInput): MissionLinkRecord {
    const context = this.assertContext(contextInput);
    this.requireMission(context, input.missionId);
    this.assertMissionLinkTarget(context, input.linkType, input.targetId);
    const now = this.timestamp();
    try {
      this.insertMissionLink(context, input, now);
    } catch (error) {
      this.rethrowConstraint(error, 'Mission lineage link already exists or is invalid.');
    }
    return this.requireMissionLink(context, input.id);
  }

  getMissionLineage(contextInput: StoreContextEnvelope, missionIdInput: string): MissionLineageProjection {
    const context = this.assertContext(contextInput);
    const mission = this.requireMission(context, missionIdInput);
    const checkpoints = this.listMissionCheckpoints(context, mission.id);
    const links = (this.db.prepare(`
      SELECT * FROM mission_links WHERE store_id = ? AND mission_id = ? ORDER BY created_at, id
    `).all(context.storeId, mission.id) as Array<Record<string, unknown>>).map(mapMissionLink);
    const decisions = this.listDecisions(context, { missionId: mission.id, includeArchived: true });
    const experiments = this.listExperiments(context, { missionId: mission.id, includeArchived: true });
    const grants = this.listMissionGrants(context, mission.id);
    const causalEvents = this.listCausalEvents(context, { missionId: mission.id });
    return { mission, checkpoints, links, decisions, experiments, grants, causalEvents };
  }

  issueMissionGrant(
    contextInput: StoreContextEnvelope,
    input: CreateMissionGrantInput,
  ): MissionGrantRecord {
    const context = normalizeStoreContextEnvelope(contextInput);
    validateMissionGrant(input);
    const grantId = idOf(input.id, 'grantId');
    const issue = this.db.transaction(() => {
      // The IMMEDIATE transaction starts before every authority read below.
      // This prevents another SQLite connection from pausing the Mission,
      // changing runtime authority, or resolving a Decision between validation
      // and the immutable grant insert.
      this.assertContext(context);
      const mission = this.requireMission(context, input.missionId);
      this.assertRevision(mission.revision, input.missionRevision, 'Mission');
      if (mission.status !== 'active') {
        throw stateConflict('MissionGrant issuance requires an active Mission.');
      }
      const policyVersion = this.requirePolicyVersion(context, input.policyVersionId);
      if (mission.policyVersionId !== policyVersion.id) {
        throw referenceConflict('MissionGrant policy version must exactly match the Mission policy snapshot.');
      }
      this.assertRevision(policyVersion.revision, input.policyRevision, 'Policy version');
      const issuedAt = this.timestamp();
      const approvedDecisions = this.requireApprovedDecisionsForGrant(context, mission, input, issuedAt);
      if (input.issuer.type === 'policy' && policyVersion.status !== 'enabled') {
        throw stateConflict('Policy-issued MissionGrant requires the Mission policy version to remain enabled.');
      }
      if (input.issuer.type === 'human' && !['enabled', 'retired'].includes(policyVersion.status)) {
        throw stateConflict('Human MissionGrant must bind an enabled or retired immutable Mission policy snapshot.');
      }
      if (input.issuer.type === 'policy') {
        const runtime = this.getPolicyRuntime(context);
        if (runtime.autonomyMode !== 'policy_auto'
          || runtime.killSwitch
          || runtime.circuitBreakerState !== 'closed'
          || runtime.activePolicyVersionId !== policyVersion.id) {
          throw stateConflict(
            'Policy issuer is blocked by autonomy mode, kill switch, circuit breaker, or active policy mismatch.',
          );
        }
      }
      this.assertGrantWithinPolicy(input, policyVersion, issuedAt);
      this.assertAdEntities(context, input.allowedAdEntityIds);
      if (Date.parse(input.expiresAt) <= Date.parse(issuedAt)) {
        throw invalid('MissionGrant expiresAt must be in the future.');
      }
      try {
        this.db.prepare(`
          INSERT INTO mission_grants (
            id, store_id, marketplace, currency, mission_id, mission_revision, decision_ids_json,
            action_revision, allowed_action_types_json, allowed_ad_entity_ids_json,
            max_change_pct, total_impact_budget, expires_at,
            policy_version_id, policy_revision, required_evidence_json,
            stop_conditions_json, issuer_type, issuer_actor_id,
            issued_at, created_session_generation
          ) VALUES (
            @id, @storeId, 'US', 'USD', @missionId, @missionRevision, @decisionIdsJson,
            @actionRevision, @allowedActionTypesJson, @allowedAdEntityIdsJson,
            @maxChangePct, @totalImpactBudget, @expiresAt,
            @policyVersionId, @policyRevision, @requiredEvidenceJson,
            @stopConditionsJson, @issuerType, @issuerActorId,
            @issuedAt, @createdSessionGeneration
          )
        `).run({
          id: grantId,
          storeId: context.storeId,
          missionId: mission.id,
          missionRevision: input.missionRevision,
          decisionIdsJson: json(input.decisionIds.map((id) => idOf(id, 'decisionId'))),
          actionRevision: input.actionRevision,
          allowedActionTypesJson: json(input.allowedActionTypes),
          allowedAdEntityIdsJson: json(input.allowedAdEntityIds.map((id) => idOf(id, 'adEntityId'))),
          maxChangePct: input.maxChangePct,
          totalImpactBudget: input.totalImpactBudget,
          expiresAt: timestampOf(input.expiresAt, 'expiresAt'),
          policyVersionId: policyVersion.id,
          policyRevision: input.policyRevision,
          requiredEvidenceJson: json(input.requiredEvidence),
          stopConditionsJson: json(input.stopConditions),
          issuerType: input.issuer.type,
          issuerActorId: idOf(input.issuer.actorId, 'issuer.actorId'),
          issuedAt,
          createdSessionGeneration: context.sessionGeneration,
        });
      } catch (error) {
        this.rethrowConstraint(error, 'MissionGrant identity or action revision already exists.');
      }
      this.db.prepare(`
        INSERT INTO mission_grant_events (
          id, store_id, grant_id, event_type, actor_id, reason, created_at
        ) VALUES (?, ?, ?, 'issued', ?, NULL, ?)
      `).run(
        `grant-event:${grantId}:issued`, context.storeId, grantId,
        input.issuer.actorId, issuedAt,
      );
      this.appendCausalInternal(context, {
        id: `causal:grant:${grantId}:issued`,
        stage: 'DECISION',
        eventType: 'mission_grant_issued',
        entityType: 'mission_grant',
        entityId: grantId,
        missionId: mission.id,
        title: `MissionGrant ${grantId} issued`,
        signal: `${approvedDecisions.length} approved decisions authorized as one batch`,
        status: 'issued',
        source: input.issuer.type === 'policy' ? 'policy-engine' : 'operator',
        actorId: input.issuer.actorId,
      }, issuedAt);
      return this.requireMissionGrant(context, grantId);
    });
    return issue.immediate();
  }

  getMissionGrant(contextInput: StoreContextEnvelope, idInput: string): MissionGrantRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM mission_grants WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'grantId')) as GrantRow | undefined;
    return row ? mapGrant(row) : undefined;
  }

  listMissionGrants(contextInput: StoreContextEnvelope, missionIdInput: string): MissionGrantRecord[] {
    const context = this.assertContext(contextInput);
    const missionId = idOf(missionIdInput, 'missionId');
    this.requireMission(context, missionId);
    return (this.db.prepare(`
      SELECT * FROM mission_grants WHERE store_id = ? AND mission_id = ?
      ORDER BY action_revision DESC, issued_at DESC, id
    `).all(context.storeId, missionId) as GrantRow[]).map(mapGrant);
  }

  listMissionGrantEvents(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): MissionGrantEventRecord[] {
    const context = this.assertContext(contextInput);
    const missionId = idOf(missionIdInput, 'missionId');
    this.requireMission(context, missionId);
    return (this.db.prepare(`
      SELECT events.*
      FROM mission_grant_events AS events
      INNER JOIN mission_grants AS grants
        ON grants.store_id = events.store_id
        AND grants.id = events.grant_id
      WHERE events.store_id = ? AND grants.mission_id = ?
      ORDER BY events.created_at DESC,
        CASE events.event_type WHEN 'issued' THEN 0 ELSE 1 END DESC,
        events.id DESC
    `).all(context.storeId, missionId) as Record<string, unknown>[]).map(mapGrantEvent);
  }

  getMissionGrantTerminalEvent(
    contextInput: StoreContextEnvelope,
    grantIdInput: string,
  ): MissionGrantEventRecord | undefined {
    const context = this.assertContext(contextInput);
    const grant = this.requireMissionGrant(context, grantIdInput);
    const row = this.db.prepare(`
      SELECT * FROM mission_grant_events
      WHERE store_id = ? AND grant_id = ?
        AND event_type IN ('revoked', 'consumed', 'expired')
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(context.storeId, grant.id) as Record<string, unknown> | undefined;
    return row ? mapGrantEvent(row) : undefined;
  }

  appendMissionGrantEvent(
    contextInput: StoreContextEnvelope,
    input: AppendMissionGrantEventInput,
  ): MissionGrantEventRecord {
    const context = this.assertContext(contextInput);
    const id = idOf(input.id, 'grantEventId');
    const append = this.db.transaction(() => {
      const grant = this.requireMissionGrant(context, input.grantId);
      const existingTerminal = this.db.prepare(`
        SELECT event_type FROM mission_grant_events
        WHERE store_id = ? AND grant_id = ? AND event_type IN ('revoked', 'consumed', 'expired')
        ORDER BY created_at DESC, id LIMIT 1
      `).get(context.storeId, grant.id) as { event_type: string } | undefined;
      if (existingTerminal) throw stateConflict(`MissionGrant is already ${existingTerminal.event_type}.`);
      const at = this.timestamp();
      try {
        this.db.prepare(`
          INSERT INTO mission_grant_events (
            id, store_id, grant_id, event_type, actor_id, reason, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, context.storeId, grant.id, input.eventType,
          idOf(input.actorId, 'actorId'), optionalText(input.reason), at,
        );
      } catch (error) {
        this.rethrowConstraint(error, `MissionGrant event ${id} already exists.`);
      }
      this.appendCausalInternal(context, {
        id: `causal:grant:${grant.id}:${input.eventType}`,
        stage: input.eventType === 'consumed' ? 'ACTION' : 'DECISION',
        eventType: `mission_grant_${input.eventType}`,
        entityType: 'mission_grant',
        entityId: grant.id,
        missionId: grant.missionId,
        title: `MissionGrant ${input.eventType}`,
        intervention: optionalText(input.reason) ?? undefined,
        status: input.eventType,
        source: 'mission-domain',
        actorId: input.actorId,
      }, at);
      const row = this.db.prepare(`SELECT * FROM mission_grant_events WHERE store_id = ? AND id = ?`)
        .get(context.storeId, id) as Record<string, unknown>;
      return mapGrantEvent(row);
    });
    return append.immediate();
  }

  createDecision(contextInput: StoreContextEnvelope, input: CreateDecisionInput): DecisionRecord {
    const context = this.assertContext(contextInput);
    const mission = this.requireMission(context, input.missionId);
    if (['completed', 'archived'].includes(mission.status)) throw stateConflict('Mission is closed to new decisions.');
    if (mission.dataBatchId !== idOf(input.dataBatchId, 'dataBatchId')) {
      throw referenceConflict('Decision data batch must match its Mission lineage.');
    }
    if (mission.policyVersionId !== idOf(input.policyVersionId, 'policyVersionId')) {
      throw referenceConflict('Decision policy version must match its Mission lineage.');
    }
    const policyVersion = this.requirePolicyVersion(context, input.policyVersionId);
    this.assertRevision(policyVersion.revision, input.policyRevision, 'Policy version');
    const id = idOf(input.id, 'decisionId');
    if (input.productId) this.assertProduct(context, input.productId);
    if (input.adEntityId) this.assertAdEntity(context, input.adEntityId);
    const now = this.timestamp();
    const create = this.db.transaction(() => {
      try {
        this.db.prepare(`
          INSERT INTO decisions (
            id, store_id, mission_id, data_batch_id, policy_version_id,
            policy_revision, action_revision, title, rationale, recommendation,
            facts_json, alternatives_json, expected_effect, valid_until,
            action_type, ad_entity_id, product_id, current_value_json,
            recommended_value_json, confidence, status, revision, created_at, updated_at
          ) VALUES (
            @id, @storeId, @missionId, @dataBatchId, @policyVersionId,
            @policyRevision, @actionRevision, @title, @rationale, @recommendation,
            @factsJson, @alternativesJson, @expectedEffect, @validUntil,
            @actionType, @adEntityId, @productId, @currentValueJson,
            @recommendedValueJson, @confidence, @status, 1, @createdAt, @updatedAt
          )
        `).run({
          id,
          storeId: context.storeId,
          missionId: mission.id,
          dataBatchId: mission.dataBatchId,
          policyVersionId: policyVersion.id,
          policyRevision: input.policyRevision,
          actionRevision: revisionOf(input.actionRevision, 'actionRevision'),
          title: textOf(input.title, 'title', 300),
          rationale: textOf(input.rationale, 'rationale', 4_000),
          recommendation: textOf(input.recommendation, 'recommendation', 2_000),
          factsJson: json(listOf(input.facts, 'facts', true)),
          alternativesJson: json(listOf(input.alternatives, 'alternatives', true)),
          expectedEffect: input.expectedEffect === undefined
            ? null
            : textOf(input.expectedEffect, 'expectedEffect', 2_000),
          validUntil: optionalTimestamp(input.validUntil, 'validUntil'),
          actionType: textOf(input.actionType, 'actionType', 120),
          adEntityId: optionalId(input.adEntityId, 'adEntityId'),
          productId: optionalId(input.productId, 'productId'),
          currentValueJson: jsonNullable(input.currentValue),
          recommendedValueJson: jsonNullable(input.recommendedValue),
          confidence: confidenceOf(input.confidence),
          status: input.status ?? 'proposed',
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        this.rethrowConstraint(error, `Decision ${id} already exists or has invalid lineage.`);
      }
      const decision = this.requireDecision(context, id);
      this.insertDecisionHistory(context, decision, 'created', input.actorId, undefined, now);
      this.insertMissionLink(context, {
        id: `link:${mission.id}:decision:${id}`,
        missionId: mission.id,
        linkType: 'decision',
        targetId: id,
        relation: 'contains',
        actorId: input.actorId,
      }, now);
      this.appendCausalInternal(context, {
        id: `causal:decision:${id}:r1`,
        stage: 'DECISION',
        eventType: 'decision_created',
        entityType: 'decision',
        entityId: id,
        missionId: mission.id,
        title: decision.title,
        signal: decision.rationale,
        intervention: decision.recommendation,
        confidence: decision.confidence,
        status: decision.status,
        source: 'mission-domain',
        actorId: input.actorId,
      }, now);
      return decision;
    });
    return create.immediate();
  }

  getDecision(contextInput: StoreContextEnvelope, idInput: string): DecisionRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM decisions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'decisionId')) as DecisionRow | undefined;
    return row ? mapDecision(row) : undefined;
  }

  listDecisions(contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): DecisionRecord[] {
    const context = this.assertContext(contextInput);
    const missionId = input.missionId ? idOf(input.missionId, 'missionId') : null;
    return (this.db.prepare(`
      SELECT * FROM decisions
      WHERE store_id = ? AND (? IS NULL OR mission_id = ?)
      ORDER BY updated_at DESC, id
    `).all(context.storeId, missionId, missionId) as DecisionRow[]).map(mapDecision);
  }

  reviseDecision(contextInput: StoreContextEnvelope, input: ReviseDecisionInput): DecisionRecord {
    const context = this.assertContext(contextInput);
    const current = this.requireDecision(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Decision');
    if (!['proposed', 'needs_approval', 'blocked'].includes(current.status)) {
      throw stateConflict('Approved, rejected, or executed Decision cannot be edited; create a new Decision.');
    }
    const now = nextTimestamp(current.updatedAt, this.now());
    const revise = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE decisions
        SET title = @title, rationale = @rationale, recommendation = @recommendation,
            facts_json = @factsJson, alternatives_json = @alternativesJson,
            expected_effect = @expectedEffect, valid_until = @validUntil,
            current_value_json = @currentValueJson,
            recommended_value_json = @recommendedValueJson,
            confidence = @confidence, status = @status,
            revision = revision + 1, action_revision = action_revision + 1,
            updated_at = @updatedAt
        WHERE store_id = @storeId AND id = @id AND revision = @expectedRevision
      `).run({
        storeId: context.storeId,
        id: current.id,
        expectedRevision: input.expectedRevision,
        title: input.title === undefined ? current.title : textOf(input.title, 'title', 300),
        rationale: input.rationale === undefined ? current.rationale : textOf(input.rationale, 'rationale', 4_000),
        recommendation: input.recommendation === undefined
          ? current.recommendation
          : textOf(input.recommendation, 'recommendation', 2_000),
        factsJson: json(input.facts === undefined ? current.facts : listOf(input.facts, 'facts', true)),
        alternativesJson: json(input.alternatives === undefined
          ? current.alternatives
          : listOf(input.alternatives, 'alternatives', true)),
        expectedEffect: input.expectedEffect === undefined
          ? current.expectedEffect ?? null
          : input.expectedEffect === null ? null : textOf(input.expectedEffect, 'expectedEffect', 2_000),
        validUntil: input.validUntil === undefined
          ? current.validUntil ?? null
          : optionalTimestamp(input.validUntil, 'validUntil'),
        currentValueJson: input.currentValue === undefined ? jsonNullable(current.currentValue) : jsonNullable(input.currentValue),
        recommendedValueJson: input.recommendedValue === undefined
          ? jsonNullable(current.recommendedValue)
          : jsonNullable(input.recommendedValue),
        confidence: input.confidence === undefined ? current.confidence : confidenceOf(input.confidence),
        status: input.status ?? current.status,
        updatedAt: now,
      });
      this.assertCas(result.changes, 'Decision');
      const decision = this.requireDecision(context, current.id);
      this.insertDecisionHistory(context, decision, 'revised', input.actorId, undefined, now);
      this.appendCausalInternal(context, {
        id: `causal:decision:${decision.id}:r${decision.revision}`,
        stage: 'DECISION', eventType: 'decision_revised', entityType: 'decision',
        entityId: decision.id, missionId: decision.missionId, title: decision.title,
        intervention: decision.recommendation, confidence: decision.confidence,
        status: decision.status, source: 'mission-domain', actorId: input.actorId,
      }, now);
      return decision;
    });
    return revise.immediate();
  }

  resolveDecision(contextInput: StoreContextEnvelope, input: ResolveDecisionInput): DecisionRecord {
    const context = this.assertContext(contextInput);
    const current = this.requireDecision(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Decision');
    const allowed = input.status === 'executed'
      ? current.status === 'approved'
      : input.status === 'verified'
        ? current.status === 'executed'
        : ['proposed', 'needs_approval', 'blocked'].includes(current.status);
    if (!allowed) throw stateConflict(`Decision cannot transition from ${current.status} to ${input.status}.`);
    const actorId = idOf(input.actorId, 'actorId');
    const reason = textOf(input.reason, 'reason', 2_000);
    const now = nextTimestamp(current.updatedAt, this.now());
    const resolve = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE decisions
        SET status = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ?
      `).run(input.status, now, context.storeId, current.id, input.expectedRevision);
      this.assertCas(result.changes, 'Decision');
      const decision = this.requireDecision(context, current.id);
      this.insertDecisionHistory(context, decision, input.status, actorId, reason, now);
      this.appendCausalInternal(context, {
        id: `causal:decision:${decision.id}:r${decision.revision}`,
        stage: input.status === 'executed' ? 'ACTION' : input.status === 'verified' ? 'READBACK' : 'DECISION',
        eventType: `decision_${input.status}`, entityType: 'decision',
        entityId: decision.id, missionId: decision.missionId, title: decision.title,
        intervention: reason, confidence: decision.confidence, status: decision.status,
        source: input.status === 'approved' ? 'approval' : 'operator', actorId,
      }, now);
      return decision;
    });
    return resolve.immediate();
  }

  listDecisionHistory(
    contextInput: StoreContextEnvelope,
    decisionIdInput: string,
  ): DecisionHistoryRecord[] {
    const context = this.assertContext(contextInput);
    const decisionId = idOf(decisionIdInput, 'decisionId');
    this.requireDecision(context, decisionId);
    return (this.db.prepare(`
      SELECT * FROM decision_history
      WHERE store_id = ? AND decision_id = ?
      ORDER BY decision_revision, created_at, id
    `).all(context.storeId, decisionId) as Array<Record<string, unknown>>).map(mapDecisionHistory);
  }

  createExperiment(contextInput: StoreContextEnvelope, input: CreateExperimentInput): ExperimentRecord {
    const context = this.assertContext(contextInput);
    const mission = this.requireMission(context, input.missionId);
    if (['completed', 'archived'].includes(mission.status)) throw stateConflict('Mission is closed to new Experiments.');
    const id = idOf(input.id, 'experimentId');
    if (input.productId) this.assertProduct(context, input.productId);
    if (input.adEntityId) this.assertAdEntity(context, input.adEntityId);
    const startsAt = timestampOf(input.observationStartsAt, 'observationStartsAt');
    const endsAt = timestampOf(input.observationEndsAt, 'observationEndsAt');
    assertTimeRange(startsAt, endsAt, 'Experiment observation window');
    const now = this.timestamp();
    const create = this.db.transaction(() => {
      try {
        this.db.prepare(`
          INSERT INTO experiments (
            id, store_id, mission_id, name, hypothesis, primary_metric,
            guardrail_metrics_json, guardrail_criteria_json, product_id, ad_entity_id,
            baseline_json, variant_json, observation_starts_at, observation_ends_at,
            status, conclusion, revision, created_at, updated_at, archived_at
          ) VALUES (
            @id, @storeId, @missionId, @name, @hypothesis, @primaryMetric,
            @guardrailMetricsJson, @guardrailCriteriaJson, @productId, @adEntityId,
            @baselineJson, @variantJson, @observationStartsAt, @observationEndsAt,
            'draft', NULL, 1, @createdAt, @updatedAt, NULL
          )
        `).run({
          id,
          storeId: context.storeId,
          missionId: mission.id,
          name: textOf(input.name, 'name', 300),
          hypothesis: textOf(input.hypothesis, 'hypothesis', 4_000),
          primaryMetric: textOf(input.primaryMetric, 'primaryMetric', 160),
          guardrailMetricsJson: json(listOf(input.guardrailMetrics, 'guardrailMetrics', true)),
          guardrailCriteriaJson: json(listOf(input.guardrailCriteria, 'guardrailCriteria', true)),
          productId: optionalId(input.productId, 'productId'),
          adEntityId: optionalId(input.adEntityId, 'adEntityId'),
          baselineJson: json(input.baseline),
          variantJson: json(input.variant),
          observationStartsAt: startsAt,
          observationEndsAt: endsAt,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        this.rethrowConstraint(error, `Experiment ${id} already exists or has invalid lineage.`);
      }
      const experiment = this.requireExperiment(context, id);
      this.insertMissionLink(context, {
        id: `link:${mission.id}:experiment:${id}`, missionId: mission.id,
        linkType: 'experiment', targetId: id, relation: 'contains', actorId: 'system',
      }, now);
      this.appendCausalInternal(context, {
        id: `causal:experiment:${id}:created`, stage: 'ANALYSIS',
        eventType: 'experiment_created', entityType: 'experiment', entityId: id,
        missionId: mission.id, title: experiment.name, signal: experiment.hypothesis,
        expectedEffect: `Observe ${experiment.primaryMetric} from ${startsAt} to ${endsAt}`,
        status: experiment.status, source: 'mission-domain', actorId: 'system',
      }, now);
      return experiment;
    });
    return create.immediate();
  }

  getExperiment(contextInput: StoreContextEnvelope, idInput: string): ExperimentRecord | undefined {
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM experiments WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'experimentId')) as ExperimentRow | undefined;
    return row ? mapExperiment(row) : undefined;
  }

  listExperiments(contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): ExperimentRecord[] {
    const context = this.assertContext(contextInput);
    const missionId = input.missionId ? idOf(input.missionId, 'missionId') : null;
    return (this.db.prepare(`
      SELECT * FROM experiments
      WHERE store_id = ? AND (? IS NULL OR mission_id = ?)
        AND (? = 1 OR status <> 'archived')
      ORDER BY updated_at DESC, id
    `).all(context.storeId, missionId, missionId, input.includeArchived ? 1 : 0) as ExperimentRow[])
      .map(mapExperiment);
  }

  updateExperiment(contextInput: StoreContextEnvelope, input: UpdateExperimentInput): ExperimentRecord {
    const context = this.assertContext(contextInput);
    const current = this.requireExperiment(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Experiment');
    if (!['draft', 'paused'].includes(current.status)) {
      throw stateConflict('Only draft or paused Experiment can be edited.');
    }
    const patch = input.patch;
    if (!patch || Object.keys(patch).length === 0) throw invalid('Experiment patch cannot be empty.');
    const startsAt = patch.observationStartsAt === undefined
      ? current.observationStartsAt
      : timestampOf(patch.observationStartsAt, 'observationStartsAt');
    const endsAt = patch.observationEndsAt === undefined
      ? current.observationEndsAt
      : timestampOf(patch.observationEndsAt, 'observationEndsAt');
    assertTimeRange(startsAt, endsAt, 'Experiment observation window');
    const nextProductId = patch.productId === undefined ? current.productId : patch.productId ?? undefined;
    const nextAdEntityId = patch.adEntityId === undefined ? current.adEntityId : patch.adEntityId ?? undefined;
    if (nextProductId) this.assertProduct(context, nextProductId);
    if (nextAdEntityId) this.assertAdEntity(context, nextAdEntityId);
    const now = nextTimestamp(current.updatedAt, this.now());
    const update = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE experiments
      SET name = @name, hypothesis = @hypothesis, primary_metric = @primaryMetric,
          guardrail_metrics_json = @guardrailMetricsJson,
          guardrail_criteria_json = @guardrailCriteriaJson,
          product_id = @productId, ad_entity_id = @adEntityId,
          baseline_json = @baselineJson, variant_json = @variantJson,
          observation_starts_at = @startsAt, observation_ends_at = @endsAt,
          conclusion = @conclusion,
          revision = revision + 1, updated_at = @updatedAt
      WHERE store_id = @storeId AND id = @id AND revision = @expectedRevision
        AND status IN ('draft', 'paused')
      `).run({
      storeId: context.storeId,
      id: current.id,
      expectedRevision: input.expectedRevision,
      name: patch.name === undefined ? current.name : textOf(patch.name, 'name', 300),
      hypothesis: patch.hypothesis === undefined ? current.hypothesis : textOf(patch.hypothesis, 'hypothesis', 4_000),
      primaryMetric: patch.primaryMetric === undefined
        ? current.primaryMetric
        : textOf(patch.primaryMetric, 'primaryMetric', 160),
      guardrailMetricsJson: json(patch.guardrailMetrics === undefined
        ? current.guardrailMetrics
        : listOf(patch.guardrailMetrics, 'guardrailMetrics', true)),
      guardrailCriteriaJson: json(patch.guardrailCriteria === undefined
        ? current.guardrailCriteria
        : listOf(patch.guardrailCriteria, 'guardrailCriteria', true)),
      productId: patch.productId === undefined ? current.productId ?? null : optionalId(patch.productId, 'productId'),
      adEntityId: patch.adEntityId === undefined ? current.adEntityId ?? null : optionalId(patch.adEntityId, 'adEntityId'),
      baselineJson: patch.baseline === undefined ? json(current.baseline) : json(patch.baseline),
      variantJson: patch.variant === undefined ? json(current.variant) : json(patch.variant),
      startsAt,
      endsAt,
      conclusion: patch.conclusion === undefined ? current.conclusion ?? null : optionalText(patch.conclusion),
      updatedAt: now,
      });
      this.assertCas(result.changes, 'Experiment');
      const experiment = this.requireExperiment(context, current.id);
      this.appendCausalInternal(context, {
        id: `causal:experiment:${experiment.id}:r${experiment.revision}`,
        stage: 'ANALYSIS', eventType: 'experiment_updated',
        entityType: 'experiment', entityId: experiment.id, missionId: experiment.missionId,
        title: experiment.name, signal: experiment.hypothesis,
        expectedEffect: `Observe ${experiment.primaryMetric} within configured guardrails`,
        status: experiment.status, source: 'mission-domain', actorId: input.actorId,
      }, now);
      return experiment;
    });
    return update.immediate();
  }

  transitionExperiment(
    contextInput: StoreContextEnvelope,
    input: TransitionExperimentInput,
  ): ExperimentRecord {
    const context = this.assertContext(contextInput);
    const current = this.requireExperiment(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Experiment');
    assertExperimentTransition(current.status, input.status);
    const now = nextTimestamp(current.updatedAt, this.now());
    const transition = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE experiments
        SET status = ?, conclusion = CASE WHEN ? = 'completed' THEN COALESCE(?, conclusion) ELSE conclusion END,
            revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ? AND status <> 'archived'
      `).run(
        input.status, input.status, optionalText(input.reason), now,
        context.storeId, current.id, input.expectedRevision,
      );
      this.assertCas(result.changes, 'Experiment');
      const experiment = this.requireExperiment(context, current.id);
      this.appendCausalInternal(context, {
        id: `causal:experiment:${experiment.id}:r${experiment.revision}`,
        stage: input.status === 'completed' ? 'EFFECT' : 'ANALYSIS',
        eventType: `experiment_${input.status}`, entityType: 'experiment',
        entityId: experiment.id, missionId: experiment.missionId,
        title: experiment.name, observedEffect: input.status === 'completed' ? experiment.conclusion : undefined,
        status: input.status, source: 'mission-domain', actorId: input.actorId,
      }, now);
      return experiment;
    });
    return transition.immediate();
  }

  archiveExperiment(context: StoreContextEnvelope, input: ArchiveRestoreInput): ExperimentRecord {
    return this.setExperimentArchive(context, input, true);
  }

  restoreExperiment(context: StoreContextEnvelope, input: ArchiveRestoreInput): ExperimentRecord {
    return this.setExperimentArchive(context, input, false);
  }

  listExperimentObservations(
    contextInput: StoreContextEnvelope,
    experimentIdInput: string,
  ): ExperimentObservationRecord[] {
    const context = this.assertContext(contextInput);
    const experiment = this.requireExperiment(context, experimentIdInput);
    return (this.db.prepare(`
      SELECT * FROM experiment_records
      WHERE store_id = ? AND experiment_id = ?
      ORDER BY observed_at DESC, created_at DESC, id
    `).all(context.storeId, experiment.id) as Array<Record<string, unknown>>)
      .map(mapExperimentObservation);
  }

  listExperimentMetricSnapshots(
    contextInput: StoreContextEnvelope,
    experimentIdInput: string,
  ): ExperimentMetricSnapshotRecord[] {
    const context = this.assertContext(contextInput);
    const experiment = this.requireExperiment(context, experimentIdInput);
    return (this.db.prepare(`
      SELECT * FROM experiment_metric_snapshots
      WHERE store_id = ? AND experiment_id = ?
      ORDER BY observed_at DESC, created_at DESC, id
    `).all(context.storeId, experiment.id) as Array<Record<string, unknown>>)
      .map(mapMetricSnapshot);
  }

  appendExperimentObservation(
    contextInput: StoreContextEnvelope,
    input: AppendExperimentObservationInput,
  ): ExperimentObservationRecord {
    const context = this.assertContext(contextInput);
    const experiment = this.requireExperiment(context, input.experimentId);
    if (experiment.status === 'archived') throw stateConflict('Archived Experiment cannot accept observations.');
    const id = idOf(input.id, 'experimentRecordId');
    const corrects = optionalId(input.correctsRecordId, 'correctsRecordId');
    if (input.observationType === 'correction' && !corrects) {
      throw invalid('Correction observation must reference the record it corrects.');
    }
    if (input.observationType !== 'correction' && corrects) {
      throw invalid('Only a correction observation may reference correctsRecordId.');
    }
    if (corrects) this.requireExperimentObservation(context, experiment.id, corrects);
    const createdAt = this.timestamp();
    const append = this.db.transaction(() => {
      try {
        this.db.prepare(`
          INSERT INTO experiment_records (
            id, store_id, experiment_id, observation_type, title, observation,
            observed_at, actor_id, corrects_record_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, context.storeId, experiment.id, input.observationType,
          textOf(input.title, 'title', 300), textOf(input.observation, 'observation', 8_000),
          timestampOf(input.observedAt, 'observedAt'), idOf(input.actorId, 'actorId'),
          corrects, createdAt,
        );
      } catch (error) {
        this.rethrowConstraint(error, `Experiment observation ${id} already exists or has invalid correction lineage.`);
      }
      const record = this.requireExperimentObservation(context, experiment.id, id);
      this.appendCausalInternal(context, {
        id: `causal:experiment-record:${id}`,
        stage: input.observationType === 'result' ? 'EFFECT' : 'FACT',
        eventType: `experiment_${input.observationType}`,
        entityType: 'experiment_record', entityId: id, missionId: experiment.missionId,
        title: record.title, signal: record.observation,
        observedEffect: input.observationType === 'result' ? record.observation : undefined,
        status: 'recorded', source: 'experiment', actorId: input.actorId,
      }, createdAt);
      return record;
    });
    return append.immediate();
  }

  appendExperimentMetricSnapshot(
    contextInput: StoreContextEnvelope,
    input: AppendExperimentMetricSnapshotInput,
  ): ExperimentMetricSnapshotRecord {
    const context = this.assertContext(contextInput);
    const experiment = this.requireExperiment(context, input.experimentId);
    this.requireCompletedDataBatch(context, input.dataBatchId);
    if (!Number.isFinite(input.value)) throw invalid('Experiment metric value must be finite.');
    if (input.currency !== undefined && input.currency !== 'USD') throw invalid('V1 metric currency must be USD.');
    const id = idOf(input.id, 'metricSnapshotId');
    const createdAt = this.timestamp();
    const append = this.db.transaction(() => {
      try {
        this.db.prepare(`
          INSERT INTO experiment_metric_snapshots (
            id, store_id, experiment_id, metric, value, currency,
            observed_at, data_batch_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, context.storeId, experiment.id, textOf(input.metric, 'metric', 160),
          input.value, input.currency ?? null, timestampOf(input.observedAt, 'observedAt'),
          input.dataBatchId, createdAt,
        );
      } catch (error) {
        this.rethrowConstraint(error, `Experiment metric snapshot ${id} already exists or has invalid lineage.`);
      }
      this.appendCausalInternal(context, {
        id: `causal:experiment-metric:${id}`,
        stage: experiment.status === 'completed' ? 'EFFECT' : 'FACT',
        eventType: 'experiment_metric_snapshot',
        entityType: 'experiment_metric_snapshot',
        entityId: id,
        missionId: experiment.missionId,
        title: `${input.metric} metric snapshot`,
        signal: `${input.metric}=${input.value}`,
        observedEffect: experiment.status === 'completed' ? `${input.metric}=${input.value}` : undefined,
        status: 'recorded',
        source: input.dataBatchId,
        actorId: 'system',
      }, createdAt);
      const row = this.db.prepare(`
        SELECT * FROM experiment_metric_snapshots WHERE store_id = ? AND id = ?
      `).get(context.storeId, id) as Record<string, unknown>;
      return mapMetricSnapshot(row);
    });
    return append.immediate();
  }

  appendCausalEvent(contextInput: StoreContextEnvelope, input: AppendCausalEventInput): CausalEventRecord {
    const context = this.assertContext(contextInput);
    if (input.missionId) this.requireMission(context, input.missionId);
    const append = this.db.transaction(() => {
      const createdAt = this.timestamp();
      try {
        this.appendCausalInternal(context, input, createdAt);
      } catch (error) {
        this.rethrowConstraint(error, `Causal event ${input.id} already exists or has invalid lineage.`);
      }
      return this.requireCausalEvent(context, input.id);
    });
    return append.immediate();
  }

  listCausalEvents(
    contextInput: StoreContextEnvelope,
    input: { missionId?: string; stages?: readonly CausalLedgerStage[] } = {},
  ): CausalEventRecord[] {
    const context = this.assertContext(contextInput);
    const missionId = input.missionId ? idOf(input.missionId, 'missionId') : null;
    const stages = input.stages?.length ? input.stages : CAUSAL_LEDGER_STAGES;
    if (stages.some((stage) => !CAUSAL_LEDGER_STAGES.includes(stage))) throw invalid('Unknown causal stage.');
    const placeholders = stages.map(() => '?').join(', ');
    return (this.db.prepare(`
      SELECT * FROM causal_events
      WHERE store_id = ? AND (? IS NULL OR mission_id = ?)
        AND stage IN (${placeholders})
      ORDER BY sequence DESC, id
    `).all(context.storeId, missionId, missionId, ...stages) as CausalRow[]).map(mapCausalEvent);
  }

  appendCausalLink(contextInput: StoreContextEnvelope, input: AppendCausalLinkInput): CausalLinkRecord {
    const context = this.assertContext(contextInput);
    this.requireCausalEvent(context, input.sourceEventId);
    this.assertCausalTarget(context, input.targetType, input.targetId);
    const id = idOf(input.id, 'causalLinkId');
    const createdAt = this.timestamp();
    try {
      this.db.prepare(`
        INSERT INTO causal_links (
          id, store_id, source_event_id, target_type, target_id, relation, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, context.storeId, input.sourceEventId, input.targetType,
        idOf(input.targetId, 'targetId'), textOf(input.relation, 'relation', 160), createdAt,
      );
    } catch (error) {
      this.rethrowConstraint(error, `Causal link ${id} already exists or has invalid lineage.`);
    }
    const row = this.db.prepare(`SELECT * FROM causal_links WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as Record<string, unknown>;
    return mapCausalLink(row);
  }

  appendEvidenceRef(contextInput: StoreContextEnvelope, input: AppendEvidenceRefInput): CausalEvidenceRefRecord {
    const context = this.assertContext(contextInput);
    this.requireCausalEvent(context, input.eventId);
    const id = idOf(input.id, 'evidenceRefId');
    let evidenceRef: string;
    try {
      evidenceRef = normalizeOpaqueEvidenceRef(input.evidenceRef);
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : 'evidenceRef must be opaque.');
    }
    const sha256 = optionalSha256(input.sha256);
    const createdAt = this.timestamp();
    try {
      this.db.prepare(`
        INSERT INTO evidence_refs (
          id, store_id, event_id, evidence_type, evidence_ref, sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, context.storeId, input.eventId,
        textOf(input.evidenceType, 'evidenceType', 160), evidenceRef, sha256, createdAt,
      );
    } catch (error) {
      this.rethrowConstraint(error, `Evidence reference ${id} already exists or has invalid lineage.`);
    }
    const row = this.db.prepare(`SELECT * FROM evidence_refs WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as Record<string, unknown>;
    return mapEvidenceRef(row);
  }

  private assertContext(contextInput: StoreContextEnvelope): StoreContextEnvelope {
    let context: StoreContextEnvelope;
    try {
      context = normalizeStoreContextEnvelope(contextInput);
    } catch (error) {
      throw new MissionDomainRepositoryError(
        'INVALID_CONTEXT',
        error instanceof Error ? error.message : 'StoreContextEnvelope is invalid.',
      );
    }
    const store = this.db.prepare(`
      SELECT store_id, browser_profile_id, marketplace, currency,
             business_timezone, status
      FROM stores WHERE store_id = ?
    `).get(context.storeId) as StoreAuthorityRow | undefined;
    if (!store
      || store.browser_profile_id !== context.browserProfileId
      || store.marketplace !== context.marketplace
      || store.currency !== context.currency
      || store.business_timezone !== context.businessTimezone) {
      throw new MissionDomainRepositoryError(
        'INVALID_CONTEXT',
        'StoreContextEnvelope does not match SQLite store authority.',
      );
    }
    if (store.status !== 'active') {
      throw new MissionDomainRepositoryError(
        'STORE_NOT_ACTIVE',
        `Store ${context.storeId} is ${store.status}; Mission domain access is blocked.`,
      );
    }
    const setting = this.db.prepare(`
      SELECT value FROM app_settings WHERE key = ?
    `).get(`store_session_generation:${context.storeId}`) as { value: string | null } | undefined;
    const durable = setting?.value === undefined || setting.value === null
      ? Number((this.db.prepare(`
          SELECT COALESCE(MAX(session_generation), 0) AS generation
          FROM store_session_metadata WHERE store_id = ?
        `).get(context.storeId) as { generation: number }).generation)
      : Number(setting.value);
    if (!Number.isSafeInteger(durable) || durable < 0 || context.sessionGeneration !== durable) {
      throw new MissionDomainRepositoryError(
        'STALE_CONTEXT',
        `Store session generation is stale; expected ${durable}, received ${context.sessionGeneration}.`,
      );
    }
    return context;
  }

  private assertProduct(context: StoreContextEnvelope, productIdInput: string): void {
    const productId = idOf(productIdInput, 'productId');
    if (!this.references?.productBelongsToStore(context, productId)) {
      throw referenceConflict(
        `Product ${productId} has no proven store-scoped authority for ${context.storeId}.`,
      );
    }
  }

  private assertAdEntity(context: StoreContextEnvelope, adEntityIdInput: string): void {
    const adEntityId = idOf(adEntityIdInput, 'adEntityId');
    if (!this.references?.adEntityBelongsToStore(context, adEntityId)) {
      throw referenceConflict(
        `Ad entity ${adEntityId} has no proven store-scoped authority for ${context.storeId}.`,
      );
    }
  }

  private assertAdEntities(context: StoreContextEnvelope, entityIds: readonly string[]): void {
    for (const entityId of entityIds) this.assertAdEntity(context, entityId);
  }

  private assertGrantWithinPolicy(
    input: CreateMissionGrantInput,
    policyVersion: PolicyVersionRecord,
    issuedAt: string,
  ): void {
    const rules = policyVersion.rules;
    if (rules.killSwitch) throw stateConflict('Policy version kill switch blocks MissionGrant issuance.');
    if (rules.allowedAdEntityIds.length === 0) {
      throw stateConflict('Policy version has no authorized ad entities; MissionGrant issuance is blocked.');
    }
    if (input.allowedActionTypes.some((action) => !rules.allowedActionTypes.includes(action))) {
      throw stateConflict('MissionGrant action type exceeds the immutable policy allowlist.');
    }
    if (input.allowedAdEntityIds.some((entityId) => !rules.allowedAdEntityIds.includes(entityId))) {
      throw stateConflict('MissionGrant ad entity exceeds the immutable policy allowlist.');
    }
    if (input.maxChangePct > rules.maxChangePct) {
      throw stateConflict('MissionGrant change limit exceeds the immutable policy limit.');
    }
    if (input.totalImpactBudget > rules.totalImpactBudget) {
      throw stateConflict('MissionGrant impact budget exceeds the immutable policy limit.');
    }
    if (rules.requiredEvidence.some((evidence) => !input.requiredEvidence.includes(evidence))) {
      throw stateConflict('MissionGrant weakens immutable policy evidence requirements.');
    }
    const stopCodes = new Set(input.stopConditions.map((condition) => condition.code));
    if (rules.stopConditions.some((condition) => !stopCodes.has(condition.code))) {
      throw stateConflict('MissionGrant weakens immutable policy stop conditions.');
    }
    if (policyVersion.validFrom && Date.parse(issuedAt) < Date.parse(policyVersion.validFrom)) {
      throw stateConflict('Policy version is not valid yet; MissionGrant issuance is blocked.');
    }
    if (policyVersion.validUntil && Date.parse(input.expiresAt) > Date.parse(policyVersion.validUntil)) {
      throw stateConflict('MissionGrant expiry exceeds the immutable policy validity window.');
    }
  }

  private setMissionArchive(
    contextInput: StoreContextEnvelope,
    input: ArchiveRestoreInput,
    archive: boolean,
  ): MissionRecord {
    const context = this.assertContext(contextInput);
    const current = this.requireMission(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Mission');
    if (archive && current.status === 'archived') return current;
    if (!archive && current.status !== 'archived') throw stateConflict('Only archived Mission can be restored.');
    const now = nextTimestamp(current.updatedAt, this.now());
    const action = this.db.transaction(() => {
      const status = archive ? 'archived' : 'paused';
      const result = this.db.prepare(`
        UPDATE missions
        SET status = ?, archived_at = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ?
      `).run(status, archive ? now : null, now, context.storeId, current.id, input.expectedRevision);
      this.assertCas(result.changes, 'Mission');
      const mission = this.requireMission(context, current.id);
      this.insertMissionEvent(
        context, mission, archive ? 'archived' : 'restored',
        input.actorId, optionalText(input.reason), now,
      );
      return mission;
    });
    return action.immediate();
  }

  private setExperimentArchive(
    contextInput: StoreContextEnvelope,
    input: ArchiveRestoreInput,
    archive: boolean,
  ): ExperimentRecord {
    const context = this.assertContext(contextInput);
    const current = this.requireExperiment(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Experiment');
    if (archive && current.status === 'running') throw stateConflict('Pause a running Experiment before archival.');
    if (archive && current.status === 'archived') return current;
    if (!archive && current.status !== 'archived') throw stateConflict('Only archived Experiment can be restored.');
    const now = nextTimestamp(current.updatedAt, this.now());
    const operation = this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE experiments
        SET status = ?, archived_at = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ?
      `).run(
        archive ? 'archived' : 'paused', archive ? now : null,
        now, context.storeId, current.id, input.expectedRevision,
      );
      this.assertCas(result.changes, 'Experiment');
      const experiment = this.requireExperiment(context, current.id);
      this.appendCausalInternal(context, {
        id: `causal:experiment:${experiment.id}:r${experiment.revision}`,
        stage: 'ANALYSIS', eventType: archive ? 'experiment_archived' : 'experiment_restored',
        entityType: 'experiment', entityId: experiment.id, missionId: experiment.missionId,
        title: experiment.name, intervention: optionalText(input.reason) ?? undefined,
        status: experiment.status, source: 'mission-domain', actorId: input.actorId,
      }, now);
      return experiment;
    });
    return operation.immediate();
  }

  private requirePolicy(context: StoreContextEnvelope, idInput: string): PolicyRecord {
    const id = idOf(idInput, 'policyId');
    const row = this.db.prepare(`SELECT * FROM policies WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as PolicyRow | undefined;
    if (!row) throw notFound(`Policy ${id} was not found in store ${context.storeId}.`);
    return mapPolicy(row);
  }

  private requirePolicyVersion(context: StoreContextEnvelope, idInput: string): PolicyVersionRecord {
    const id = idOf(idInput, 'policyVersionId');
    const row = this.db.prepare(`SELECT * FROM policy_versions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as PolicyVersionRow | undefined;
    if (!row) throw notFound(`Policy version ${id} was not found in store ${context.storeId}.`);
    return mapPolicyVersion(row);
  }

  private requireMission(context: StoreContextEnvelope, idInput: string): MissionRecord {
    const id = idOf(idInput, 'missionId');
    const row = this.db.prepare(`SELECT * FROM missions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as MissionRow | undefined;
    if (!row) throw notFound(`Mission ${id} was not found in store ${context.storeId}.`);
    return mapMission(row);
  }

  private requireMissionLink(context: StoreContextEnvelope, idInput: string): MissionLinkRecord {
    const id = idOf(idInput, 'missionLinkId');
    const row = this.db.prepare(`SELECT * FROM mission_links WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as Record<string, unknown> | undefined;
    if (!row) throw notFound(`Mission link ${id} was not found.`);
    return mapMissionLink(row);
  }

  private requireMissionCheckpoint(
    context: StoreContextEnvelope,
    idInput: string,
  ): MissionCheckpointRecord {
    const id = idOf(idInput, 'missionCheckpointId');
    const row = this.db.prepare(`
      SELECT * FROM mission_checkpoints WHERE store_id = ? AND id = ?
    `).get(context.storeId, id) as Record<string, unknown> | undefined;
    if (!row) throw notFound(`Mission checkpoint ${id} was not found.`);
    return mapMissionCheckpoint(row);
  }

  private requireMissionGrant(context: StoreContextEnvelope, idInput: string): MissionGrantRecord {
    const id = idOf(idInput, 'grantId');
    const row = this.db.prepare(`SELECT * FROM mission_grants WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as GrantRow | undefined;
    if (!row) throw notFound(`MissionGrant ${id} was not found in store ${context.storeId}.`);
    return mapGrant(row);
  }

  private requireDecision(context: StoreContextEnvelope, idInput: string): DecisionRecord {
    const id = idOf(idInput, 'decisionId');
    const row = this.db.prepare(`SELECT * FROM decisions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as DecisionRow | undefined;
    if (!row) throw notFound(`Decision ${id} was not found in store ${context.storeId}.`);
    return mapDecision(row);
  }

  private requireApprovedDecisionsForGrant(
    context: StoreContextEnvelope,
    mission: MissionRecord,
    input: CreateMissionGrantInput,
    issuedAt: string,
  ): DecisionRecord[] {
    const decisions = input.decisionIds.map((decisionId) => this.requireDecision(context, decisionId));
    for (const decision of decisions) {
      if (decision.missionId !== mission.id || decision.dataBatchId !== mission.dataBatchId) {
        throw referenceConflict('Every MissionGrant Decision must match the Mission and data-batch lineage.');
      }
      if (decision.actionRevision !== input.actionRevision) {
        throw referenceConflict('Every MissionGrant Decision must match the batch action revision.');
      }
      if (decision.status !== 'approved') {
        throw stateConflict(`MissionGrant requires approved Decisions; ${decision.id} is ${decision.status}.`);
      }
      if (decision.policyVersionId !== input.policyVersionId
        || decision.policyRevision !== input.policyRevision) {
        throw referenceConflict('MissionGrant policy snapshot does not match every approved Decision.');
      }
      if (!decision.adEntityId) {
        throw referenceConflict(`MissionGrant Decision ${decision.id} has no stable advertising entity.`);
      }
      if (decision.validUntil) {
        const validUntil = Date.parse(decision.validUntil);
        if (Date.parse(issuedAt) >= validUntil) {
          throw stateConflict(`Approved Decision ${decision.id} is no longer valid for MissionGrant issuance.`);
        }
        if (Date.parse(input.expiresAt) > validUntil) {
          throw stateConflict('MissionGrant expiry exceeds an approved Decision validity window.');
        }
      }
    }
    const approvedActionTypes = [...new Set(decisions.map((decision) => decision.actionType))];
    const approvedEntityIds = decisions.map((decision) => decision.adEntityId!);
    if (!sameStringSet(input.allowedActionTypes, approvedActionTypes)) {
      throw referenceConflict('MissionGrant action allowlist must exactly match the approved Decision batch.');
    }
    if (!sameStringSet(input.allowedAdEntityIds, approvedEntityIds)) {
      throw referenceConflict('MissionGrant entity allowlist must exactly match the approved Decision batch.');
    }
    return decisions;
  }

  private requireExperiment(context: StoreContextEnvelope, idInput: string): ExperimentRecord {
    const id = idOf(idInput, 'experimentId');
    const row = this.db.prepare(`SELECT * FROM experiments WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as ExperimentRow | undefined;
    if (!row) throw notFound(`Experiment ${id} was not found in store ${context.storeId}.`);
    return mapExperiment(row);
  }

  private requireExperimentObservation(
    context: StoreContextEnvelope,
    experimentId: string,
    idInput: string,
  ): ExperimentObservationRecord {
    const id = idOf(idInput, 'experimentRecordId');
    const row = this.db.prepare(`
      SELECT * FROM experiment_records WHERE store_id = ? AND experiment_id = ? AND id = ?
    `).get(context.storeId, experimentId, id) as Record<string, unknown> | undefined;
    if (!row) throw notFound(`Experiment observation ${id} was not found.`);
    return mapExperimentObservation(row);
  }

  private requireCausalEvent(context: StoreContextEnvelope, idInput: string): CausalEventRecord {
    const id = idOf(idInput, 'causalEventId');
    const row = this.db.prepare(`SELECT * FROM causal_events WHERE store_id = ? AND id = ?`)
      .get(context.storeId, id) as CausalRow | undefined;
    if (!row) throw notFound(`Causal event ${id} was not found in store ${context.storeId}.`);
    return mapCausalEvent(row);
  }

  private requireCompletedDataBatch(context: StoreContextEnvelope, idInput: string): void {
    const id = idOf(idInput, 'dataBatchId');
    const row = this.db.prepare(`
      SELECT status FROM lingxing_report_batches WHERE store_id = ? AND id = ?
    `).get(context.storeId, id) as { status: string } | undefined;
    if (!row) throw referenceConflict(`Data batch ${id} does not belong to store ${context.storeId}.`);
    if (row.status !== 'completed') throw stateConflict(`Data batch ${id} is ${row.status}; Mission authority requires completed data.`);
  }

  private insertMissionEvent(
    context: StoreContextEnvelope,
    mission: MissionRecord,
    eventType: string,
    actorIdInput: string,
    reason: string | null | undefined,
    createdAt: string,
  ): void {
    const actorId = idOf(actorIdInput, 'actorId');
    this.db.prepare(`
      INSERT INTO mission_events (
        id, store_id, mission_id, mission_revision, event_type,
        actor_id, reason, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `mission-event:${mission.id}:r${mission.revision}:${eventType}`,
      context.storeId,
      mission.id,
      mission.revision,
      textOf(eventType, 'eventType', 120),
      actorId,
      reason ?? null,
      json(mission),
      createdAt,
    );
  }

  private insertMissionLink(
    context: StoreContextEnvelope,
    input: AppendMissionLinkInput,
    createdAt: string,
  ): void {
    this.db.prepare(`
      INSERT INTO mission_links (
        id, store_id, mission_id, link_type, target_id, relation, actor_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      idOf(input.id, 'missionLinkId'), context.storeId,
      idOf(input.missionId, 'missionId'), input.linkType,
      idOf(input.targetId, 'targetId'), textOf(input.relation, 'relation', 160),
      idOf(input.actorId, 'actorId'), createdAt,
    );
  }

  private insertDecisionHistory(
    context: StoreContextEnvelope,
    decision: DecisionRecord,
    eventType: DecisionHistoryEventType,
    actorIdInput: string,
    reason: string | undefined,
    createdAt: string,
  ): void {
    const actorId = idOf(actorIdInput, 'actorId');
    this.db.prepare(`
      INSERT INTO decision_history (
        id, store_id, decision_id, decision_revision, event_type,
        actor_id, reason, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `decision-history:${decision.id}:r${decision.revision}:${eventType}`,
      context.storeId,
      decision.id,
      decision.revision,
      eventType,
      actorId,
      reason ?? null,
      json(decision),
      createdAt,
    );
  }

  private appendPolicyAudit(
    context: StoreContextEnvelope,
    input: {
      id: string;
      eventType: string;
      entityType: 'policy' | 'policy_version' | 'policy_runtime';
      entityId: string;
      title: string;
      signal?: string;
      intervention?: string;
      status: string;
      actorId: string;
    },
    createdAt: string,
  ): void {
    this.appendCausalInternal(context, {
      id: input.id,
      stage: 'DECISION',
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      signal: input.signal,
      intervention: input.intervention,
      status: input.status,
      source: 'policy-authority',
      actorId: input.actorId,
    }, createdAt);
  }

  private appendCausalInternal(
    context: StoreContextEnvelope,
    input: AppendCausalEventInput,
    createdAt: string,
  ): void {
    const stage = input.stage;
    if (!CAUSAL_LEDGER_STAGES.includes(stage)) throw invalid('Unknown causal stage.');
    if (input.correctsEventId) {
      const corrected = this.requireCausalEvent(context, input.correctsEventId);
      const missionId = input.missionId ? idOf(input.missionId, 'missionId') : undefined;
      const entityType = textOf(input.entityType, 'entityType', 160);
      const entityId = idOf(input.entityId, 'entityId');
      if (corrected.stage !== stage
        || (corrected.missionId ?? undefined) !== missionId
        || corrected.entityType !== entityType
        || corrected.entityId !== entityId) {
        throw referenceConflict(
          'Causal correction must preserve the corrected event mission, entity, and ledger stage.',
        );
      }
    }
    const sequence = Number((this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM causal_events WHERE store_id = ?
    `).get(context.storeId) as { nextSequence: number }).nextSequence);
    this.db.prepare(`
      INSERT INTO causal_events (
        id, store_id, stage, event_type, entity_type, entity_id,
        mission_id, title, signal, intervention, expected_effect, observed_effect,
        confidence, status, source, actor_id, business_date,
        session_generation, corrects_event_id, sequence, created_at
      ) VALUES (
        @id, @storeId, @stage, @eventType, @entityType, @entityId,
        @missionId, @title, @signal, @intervention, @expectedEffect, @observedEffect,
        @confidence, @status, @source, @actorId, @businessDate,
        @sessionGeneration, @correctsEventId, @sequence, @createdAt
      )
    `).run({
      id: idOf(input.id, 'causalEventId'),
      storeId: context.storeId,
      stage,
      eventType: textOf(input.eventType, 'eventType', 160),
      entityType: textOf(input.entityType, 'entityType', 160),
      entityId: idOf(input.entityId, 'entityId'),
      missionId: optionalId(input.missionId, 'missionId'),
      title: textOf(input.title, 'title', 500),
      signal: optionalText(input.signal),
      intervention: optionalText(input.intervention),
      expectedEffect: optionalText(input.expectedEffect),
      observedEffect: optionalText(input.observedEffect),
      confidence: input.confidence === undefined ? null : confidenceOf(input.confidence),
      status: textOf(input.status, 'status', 120),
      source: textOf(input.source, 'source', 160),
      actorId: idOf(input.actorId, 'actorId'),
      businessDate: context.businessDate,
      sessionGeneration: context.sessionGeneration,
      correctsEventId: optionalId(input.correctsEventId, 'correctsEventId'),
      sequence,
      createdAt,
    });
  }

  private assertMissionLinkTarget(
    context: StoreContextEnvelope,
    type: MissionLinkType,
    targetId: string,
  ): void {
    if (type === 'data_batch') return this.requireCompletedDataBatch(context, targetId);
    if (type === 'policy_version') { this.requirePolicyVersion(context, targetId); return; }
    if (type === 'decision') { this.requireDecision(context, targetId); return; }
    if (type === 'experiment') { this.requireExperiment(context, targetId); return; }
    // Execution/result/product/ad-entity authority is installed in adjacent
    // stages. The logical id is still validated here and the Main service must
    // resolve the corresponding store-scoped authority before calling append.
    idOf(targetId, 'targetId');
  }

  private assertCausalTarget(
    context: StoreContextEnvelope,
    type: AppendCausalLinkInput['targetType'],
    targetId: string,
  ): void {
    if (type === 'mission') { this.requireMission(context, targetId); return; }
    if (type === 'decision') { this.requireDecision(context, targetId); return; }
    if (type === 'experiment') { this.requireExperiment(context, targetId); return; }
    if (type === 'policy_version') { this.requirePolicyVersion(context, targetId); return; }
    if (type === 'mission_grant') { this.requireMissionGrant(context, targetId); return; }
    if (type === 'data_batch') { this.requireCompletedDataBatch(context, targetId); return; }
    this.requireCausalEvent(context, targetId);
  }

  private assertRevision(current: number, expectedInput: number, label: string): void {
    const expected = revisionOf(expectedInput, 'expectedRevision');
    if (current !== expected) {
      throw new MissionDomainRepositoryError(
        'REVISION_CONFLICT',
        `${label} revision changed from ${expected} to ${current}; reload before retrying.`,
      );
    }
  }

  private assertCas(changes: number, label: string): void {
    if (changes !== 1) {
      throw new MissionDomainRepositoryError(
        'REVISION_CONFLICT',
        `${label} changed concurrently; reload before retrying.`,
      );
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private rethrowConstraint(error: unknown, message: string): never {
    if (isConstraint(error)) {
      throw new MissionDomainRepositoryError('DUPLICATE_IDENTITY', message);
    }
    throw error;
  }
}

function mapPolicy(row: PolicyRow): PolicyRecord {
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

function mapPolicyVersion(row: PolicyVersionRow): PolicyVersionRecord {
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

function mapPolicyRuntime(row: PolicyRuntimeRow): PolicyRuntimeRecord {
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

function mapMission(row: MissionRow): MissionRecord {
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

function mapMissionLink(row: Record<string, unknown>): MissionLinkRecord {
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

function mapMissionCheckpoint(row: Record<string, unknown>): MissionCheckpointRecord {
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

function mapGrant(row: GrantRow): MissionGrantRecord {
  return {
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

function mapGrantEvent(row: Record<string, unknown>): MissionGrantEventRecord {
  return {
    id: String(row.id),
    storeId: String(row.store_id) as MissionGrantEventRecord['storeId'],
    grantId: String(row.grant_id),
    eventType: row.event_type as MissionGrantEventType,
    actorId: String(row.actor_id),
    reason: nullable(row.reason),
    createdAt: String(row.created_at),
  };
}

function mapDecision(row: DecisionRow): DecisionRecord {
  return {
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

function mapDecisionHistory(row: Record<string, unknown>): DecisionHistoryRecord {
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

function mapExperiment(row: ExperimentRow): ExperimentRecord {
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

function mapExperimentObservation(row: Record<string, unknown>): ExperimentObservationRecord {
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

function mapMetricSnapshot(row: Record<string, unknown>): ExperimentMetricSnapshotRecord {
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

function mapCausalEvent(row: CausalRow): CausalEventRecord {
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

function mapCausalLink(row: Record<string, unknown>): CausalLinkRecord {
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

function mapEvidenceRef(row: Record<string, unknown>): CausalEvidenceRefRecord {
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

function rulesOf(value: PolicyVersionRules): PolicyVersionRules {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Policy rules must be an object.');
  const allowedActionTypes = listOf(value.allowedActionTypes, 'allowedActionTypes', true) as PolicyVersionRules['allowedActionTypes'];
  if (allowedActionTypes.some((action) => action !== 'set_keyword_bid')) {
    throw invalid('V1 policy supports set_keyword_bid only.');
  }
  // An empty ad-entity allowlist is a valid pre-S6 policy state. It authorizes
  // no object and therefore cannot issue a MissionGrant until stable entity
  // authority has been selected.
  const allowedAdEntityIds = listOf(value.allowedAdEntityIds, 'allowedAdEntityIds', false)
    .map((id) => idOf(id, 'adEntityId'));
  const requiredEvidence = listOf(value.requiredEvidence, 'requiredEvidence', true) as PolicyVersionRules['requiredEvidence'];
  const supportedEvidence = [
    'before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value',
  ] as const;
  if (requiredEvidence.some((evidence) => !supportedEvidence.includes(evidence))) {
    throw invalid('Policy requiredEvidence contains an unsupported evidence type.');
  }
  if (supportedEvidence.some((evidence) => !requiredEvidence.includes(evidence))) {
    throw invalid('Policy requiredEvidence must retain every mandatory V1 readback proof.');
  }
  if (!Array.isArray(value.stopConditions) || value.stopConditions.length === 0) {
    throw invalid('Policy stopConditions cannot be empty.');
  }
  for (const condition of value.stopConditions) {
    if (!condition || typeof condition !== 'object') throw invalid('Policy stop condition is invalid.');
    idOf(condition.code, 'stopCondition.code');
    if (![
      'identity_drift', 'expected_before_mismatch', 'unknown_result',
      'data_stale', 'impact_budget_exhausted', 'kill_switch',
    ].includes(condition.code)) {
      throw invalid('Policy stopConditions contains an unsupported stop condition code.');
    }
    textOf(condition.detail, 'stopCondition.detail', 500);
  }
  const mandatoryStopCodes = [
    'identity_drift', 'expected_before_mismatch', 'unknown_result',
    'data_stale', 'impact_budget_exhausted', 'kill_switch',
  ] as const;
  const configuredStopCodes = value.stopConditions.map((condition) => condition.code);
  if (new Set(configuredStopCodes).size !== configuredStopCodes.length) {
    throw invalid('Policy stopConditions cannot contain duplicate codes.');
  }
  if (mandatoryStopCodes.some((code) => !configuredStopCodes.includes(code))) {
    throw invalid('Policy stopConditions must retain every mandatory V1 fail-closed condition.');
  }
  if (!Number.isFinite(value.maxChangePct) || value.maxChangePct <= 0 || value.maxChangePct > 100) {
    throw invalid('Policy maxChangePct must be greater than 0 and at most 100.');
  }
  if (!Number.isFinite(value.totalImpactBudget) || value.totalImpactBudget < 0) {
    throw invalid('Policy totalImpactBudget must be non-negative.');
  }
  if (typeof value.killSwitch !== 'boolean') throw invalid('Policy killSwitch must be boolean.');
  return {
    ...value,
    allowedActionTypes,
    allowedAdEntityIds,
    maxChangePct: value.maxChangePct,
    totalImpactBudget: value.totalImpactBudget,
    requiredEvidence,
    stopConditions: value.stopConditions.map((condition) => ({
      code: condition.code,
      detail: textOf(condition.detail, 'stopCondition.detail', 500),
    })),
    killSwitch: value.killSwitch,
  };
}

function assertMissionTransition(from: MissionLifecycleStatus, to: MissionLifecycleStatus): void {
  if (from === to) return;
  const allowed: Record<MissionLifecycleStatus, readonly MissionLifecycleStatus[]> = {
    draft: ['active', 'blocked'],
    active: ['paused', 'blocked', 'completed'],
    paused: ['active', 'blocked', 'completed'],
    blocked: ['active', 'paused', 'completed'],
    completed: [],
    archived: [],
  };
  if (!allowed[from].includes(to)) throw stateConflict(`Mission cannot transition from ${from} to ${to}.`);
}

function assertExperimentTransition(from: ExperimentStatus, to: ExperimentStatus): void {
  if (from === to) return;
  const allowed: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
    draft: ['running', 'paused'],
    running: ['paused', 'completed'],
    paused: ['running', 'completed'],
    completed: [],
    archived: [],
  };
  if (!allowed[from].includes(to)) throw stateConflict(`Experiment cannot transition from ${from} to ${to}.`);
}

function assertTimeRange(start: string | null | undefined, end: string | null | undefined, label: string): void {
  if (start && end && Date.parse(start) >= Date.parse(end)) throw invalid(`${label} end must be after start.`);
}

function idOf(value: unknown, label: string): string {
  try {
    return normalizeDomainIdentifier(value, label);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function optionalId(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return idOf(value, label);
}

function textOf(value: unknown, label: string, maxLength: number): string {
  try {
    return normalizeDomainText(value, label, maxLength);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function listOf(value: unknown, label: string, required: boolean): string[] {
  try {
    return normalizeDomainStringList(value, label, { required, maxItems: 100, maxLength: 500 });
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function revisionOf(value: unknown, label: string): number {
  try {
    return normalizeDomainRevision(value, label);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function timestampOf(value: unknown, label: string): string {
  try {
    return normalizeDomainTimestamp(value, label);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function optionalTimestamp(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return timestampOf(value, label);
}

function priorityOf(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10_000) {
    throw invalid('Policy priority must be an integer from 0 to 10000.');
  }
  return Number(value);
}

function missionPriorityOf(value: unknown): MissionPriority {
  if (value !== 'P0' && value !== 'P1' && value !== 'P2' && value !== 'P3') {
    throw invalid('Mission priority must be P0, P1, P2, or P3.');
  }
  return value;
}

function confidenceOf(value: unknown): number {
  if (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 1) {
    throw invalid('Confidence must be a finite number from 0 to 1.');
  }
  return Number(value);
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw invalid('Value must be JSON serializable.');
  return serialized;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((value) => rightSet.has(value));
}

function jsonNullable(value: unknown): string | null {
  return value === undefined ? null : json(value);
}

function parseJson<T = unknown>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new MissionDomainRepositoryError('REFERENCE_CONFLICT', 'Persisted Mission JSON is unreadable.');
  }
}

function parseNullableJson(value: string | null): unknown {
  return value === null ? undefined : parseJson(value);
}

function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function nullable(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function optionalSha256(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw invalid('sha256 must be 64 lowercase hexadecimal characters.');
  return normalized;
}

function nextTimestamp(previous: string, now: Date): string {
  const previousMillis = Date.parse(previous);
  const currentMillis = now.getTime();
  return new Date(Number.isFinite(previousMillis) ? Math.max(currentMillis, previousMillis + 1) : currentMillis)
    .toISOString();
}

function invalid(message: string): MissionDomainRepositoryError {
  return new MissionDomainRepositoryError('INVALID_INPUT', message);
}

function notFound(message: string): MissionDomainRepositoryError {
  return new MissionDomainRepositoryError('NOT_FOUND', message);
}

function stateConflict(message: string): MissionDomainRepositoryError {
  return new MissionDomainRepositoryError('STATE_CONFLICT', message);
}

function referenceConflict(message: string): MissionDomainRepositoryError {
  return new MissionDomainRepositoryError('REFERENCE_CONFLICT', message);
}

function isConstraint(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT'),
  );
}
