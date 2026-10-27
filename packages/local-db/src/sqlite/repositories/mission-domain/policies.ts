import  {
  normalizeStoreContextEnvelope,
  type CreatePolicyInput,
  type CreatePolicyVersionInput,
  type PolicyRecord,
  type PolicyRuntimeRecord,
  type PolicyVersionRecord,
  type PolicyVersionRules,
  type StoreContextEnvelope,
  type UpdatePolicyRuntimeInput,
} from '@amazon-ai-ops/shared-types';
import  {
  ListDomainRecordsInput,
  UpdatePolicyInput,
  UpdateDraftPolicyVersionInput,
  EnablePolicyVersionInput,
  ArchiveRestoreInput,
  ResolveEffectivePolicyVersionInput,
  PolicyRow,
  PolicyVersionRow,
  PolicyRuntimeRow,
} from './contracts';
import  {
  rulesOf,
  assertTimeRange,
  idOf,
  optionalId,
  textOf,
  revisionOf,
  timestampOf,
  optionalTimestamp,
  priorityOf,
  json,
  optionalText,
  nextTimestamp,
  invalid,
  stateConflict,
  referenceConflict,
} from './values';
import { mapPolicy, mapPolicyVersion, mapPolicyRuntime } from './rows';
import { MissionDomainRepositoryError } from './errors';
import type { MissionDomainRepositoryContext } from './context';
export function createPolicy(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: CreatePolicyInput): PolicyRecord{
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

export function getPolicy(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, idInput: string): PolicyRecord | undefined{
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM policies WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'policyId')) as PolicyRow | undefined;
    return row ? mapPolicy(row) : undefined;
  }

export function listPolicies(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): PolicyRecord[]{
    const context = this.assertContext(contextInput);
    const rows = this.db.prepare(`
      SELECT * FROM policies
      WHERE store_id = ? AND (? = 1 OR status <> 'archived')
      ORDER BY priority, updated_at DESC, id
    `).all(context.storeId, input.includeArchived ? 1 : 0) as PolicyRow[];
    return rows.map(mapPolicy);
  }

export function resolveEffectivePolicyVersion(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: ResolveEffectivePolicyVersionInput,
  ): PolicyVersionRecord{
    const context = this.assertContext(contextInput);
    const actionTypes = [...new Set(input.allowedActionTypes.map((action) => (
      textOf(action, 'allowedActionType', 80)
    )))];
    const entityIds = [...new Set(input.allowedAdEntityIds.map((entityId) => (
      idOf(entityId, 'adEntityId')
    )))];
    if (actionTypes.length === 0 || entityIds.length === 0) {
      throw invalid('Effective policy resolution requires at least one action and one advertising entity.');
    }
    const at = input.at === undefined
      ? this.timestamp()
      : timestampOf(input.at, 'policyResolutionAt');
    const atMs = Date.parse(at);
    const candidates = this.listPolicies(context)
      .filter((policy) => policy.status === 'active' && Boolean(policy.activeVersionId))
      .map((policy) => ({
        policy,
        version: this.requirePolicyVersion(context, policy.activeVersionId!),
      }))
      .filter(({ version }) => version.status === 'enabled'
        && (!version.validFrom || Date.parse(version.validFrom) <= atMs)
        && (!version.validUntil || Date.parse(version.validUntil) > atMs))
      .map(({ policy, version }) => ({ policy, version, rules: rulesOf(version.rules) }));

    const winners = entityIds.map((entityId) => {
      const declared = candidates.filter(({ rules }) => (
        rules.allowedAdEntityIds.includes(entityId)
        && actionTypes.every((action) => new Set<string>(rules.allowedActionTypes).has(action))
      ));
      if (declared.length === 0) {
        throw stateConflict('当前广告对象没有命中任何已启用且有效的策略；请先检查对象范围与允许动作。');
      }
      const firstPriority = declared[0]!.policy.priority;
      const firstMatches = declared.filter(({ policy }) => policy.priority === firstPriority);
      for (const candidate of firstMatches) {
        this.assertPolicyRules(context, candidate.policy, candidate.rules);
      }
      if (firstMatches.length !== 1) {
        throw stateConflict('多个策略以相同优先级命中同一广告对象；请调整优先级后重试。');
      }
      return firstMatches[0]!.version;
    });
    const winnerIds = new Set(winners.map((version) => version.id));
    if (winnerIds.size !== 1) {
      throw stateConflict('同一动作批次命中了不同策略；请按策略拆分批次后重试。');
    }
    return winners[0]!;
  }

export function updatePolicy(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: UpdatePolicyInput): PolicyRecord{
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
      if (scope !== current.scope) {
        const existingVersion = this.db.prepare(`
          SELECT 1 AS present
          FROM policy_versions
          WHERE store_id = ? AND policy_id = ?
          LIMIT 1
        `).get(context.storeId, current.id) as { present: number } | undefined;
        if (existingVersion) {
          throw stateConflict('策略已有版本，对象范围已冻结；如需其他范围，请新建策略。');
        }
      }
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

export function disablePolicy(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord{
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

export function archivePolicy(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord{
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

export function restorePolicy(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord{
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

export function createPolicyVersion(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: CreatePolicyVersionInput,
  ): PolicyVersionRecord{
    const context = this.assertContext(contextInput);
    const id = idOf(input.id, 'policyVersionId');
    const rules = rulesOf(input.rules);
    const validFrom = optionalTimestamp(input.validFrom, 'validFrom');
    const validUntil = optionalTimestamp(input.validUntil, 'validUntil');
    assertTimeRange(validFrom, validUntil, 'Policy validity window');
    const now = this.timestamp();
    const create = this.db.transaction(() => {
      const policy = this.requirePolicy(context, input.policyId);
      if (policy.status === 'archived') throw stateConflict('Archived policy cannot accept a new version.');

      this.assertPolicyRules(context, policy, rules);
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

export function getPolicyVersion(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    idInput: string,
  ): PolicyVersionRecord | undefined{
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM policy_versions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'policyVersionId')) as PolicyVersionRow | undefined;
    return row ? mapPolicyVersion(row) : undefined;
  }

export function listPolicyVersions(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, policyIdInput: string): PolicyVersionRecord[]{
    const context = this.assertContext(contextInput);
    const policyId = idOf(policyIdInput, 'policyId');
    this.requirePolicy(context, policyId);
    return (this.db.prepare(`
      SELECT * FROM policy_versions
      WHERE store_id = ? AND policy_id = ?
      ORDER BY version DESC, id
    `).all(context.storeId, policyId) as PolicyVersionRow[]).map(mapPolicyVersion);
  }

export function updateDraftPolicyVersion(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: UpdateDraftPolicyVersionInput,
  ): PolicyVersionRecord{
    const context = this.assertContext(contextInput);
    const versionId = idOf(input.id, 'policyVersionId');
    const update = this.db.transaction(() => {
      const current = this.requirePolicyVersion(context, versionId);
      this.assertRevision(current.revision, input.expectedRevision, 'Policy version');
      if (current.status !== 'draft') {
        throw new MissionDomainRepositoryError(
          'IMMUTABLE_RECORD',
          'Enabled or retired policy versions are immutable; create a new version.',
        );
      }
      const rules = input.rules === undefined ? current.rules : rulesOf(input.rules);
      const policy = this.requirePolicy(context, current.policyId);
      this.assertPolicyRules(context, policy, rules);
      const validFrom = input.validFrom === undefined
        ? current.validFrom ?? null
        : optionalTimestamp(input.validFrom, 'validFrom');
      const validUntil = input.validUntil === undefined
        ? current.validUntil ?? null
        : optionalTimestamp(input.validUntil, 'validUntil');
      assertTimeRange(validFrom, validUntil, 'Policy validity window');
      const updatedAt = nextTimestamp(current.updatedAt, this.now());
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

export function enablePolicyVersion(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: EnablePolicyVersionInput,
  ): PolicyVersionRecord{
    const context = this.assertContext(contextInput);
    const enable = this.db.transaction(() => {
      const policy = this.requirePolicy(context, input.policyId);
      const version = this.requirePolicyVersion(context, input.versionId);
      this.assertRevision(policy.revision, input.expectedPolicyRevision, 'Policy');
      this.assertRevision(version.revision, input.expectedVersionRevision, 'Policy version');
      if (version.policyId !== policy.id) throw referenceConflict('Policy version does not belong to policy.');
      if (policy.status === 'archived') throw stateConflict('Archived policy cannot be enabled.');
      if (version.status !== 'draft') throw stateConflict('Only a draft policy version can be enabled.');

      const rules = rulesOf(version.rules);
      this.assertPolicyRules(context, policy, rules);
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

export function getPolicyRuntime(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope): PolicyRuntimeRecord{
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM policy_runtime WHERE store_id = ?`)
      .get(context.storeId) as PolicyRuntimeRow | undefined;
    if (!row) {
      throw new MissionDomainRepositoryError(
        'REFERENCE_CONFLICT',
        `Policy runtime authority is missing for store ${context.storeId}.`,
      );
    }
    if (!['manual_approval', 'policy_auto'].includes(row.autonomy_mode)
      || (row.kill_switch !== 0 && row.kill_switch !== 1)
      || !['closed', 'open', 'half_open'].includes(row.circuit_breaker_state)
      || !Number.isSafeInteger(row.revision) || row.revision < 1) {
      throw referenceConflict('当前策略运行时结构无法验证，请修复后重新确认权限。');
    }
    return mapPolicyRuntime(row);
  }

export function updatePolicyRuntime(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: UpdatePolicyRuntimeInput,
  ): PolicyRuntimeRecord{
    const context = normalizeStoreContextEnvelope(contextInput);
    const update = this.db.transaction(() => {
      this.assertContext(context);
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
      
      const pendingGrants = this.db.prepare(`
        SELECT id FROM mission_grants AS grants WHERE store_id = ?
          AND NOT EXISTS (SELECT 1 FROM mission_grant_events AS events
            WHERE events.store_id = grants.store_id AND events.grant_id = grants.id
              AND events.event_type IN ('revoked', 'consumed', 'expired', 'invalidated'))
      `).all(context.storeId) as Array<{ id: string }>;
      for (const grant of pendingGrants) {
        this.appendMissionGrantEvent(context, {
          id: `grant-runtime-invalidated:${grant.id}:r${runtime.revision}`,
          grantId: grant.id, eventType: 'invalidated', actorId: input.actorId,
          reason: '执行模式或策略运行时已变化；请基于当前状态重新分析并签发授权。',
        });
      }
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

export function assertPolicyRules(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    policy: PolicyRecord,
    rules: PolicyVersionRules,
  ): void{
    this.assertAdEntities(context, rules.allowedAdEntityIds);
    for (const entityId of rules.allowedAdEntityIds) {
      if (!this.adEntitySupportsKeywordBid(context, entityId)) {
        throw referenceConflict(
          '所选广告对象不是经当前店铺核验的关键词；V1 仅允许调整关键词竞价，请重新选择关键词。',
        );
      }
      if (!this.adEntityBelongsToPolicyScope(context, policy.scope, entityId)) {
        throw referenceConflict(
          '所选广告对象不属于此策略的冻结范围；请重新选择当前店铺真实对象或新建策略。',
        );
      }
    }
  }

export function appendPolicyAudit(this: MissionDomainRepositoryContext, 
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
  ): void{
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
