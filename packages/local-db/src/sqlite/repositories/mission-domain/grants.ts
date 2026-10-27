import  {
  createMissionWriteAuthoritySnapshot,
  missionWriteAuthorityMatches,
  type MissionWriteAuthoritySnapshot,
  normalizeStoreContextEnvelope,
  validateMissionGrant,
  type CreateMissionGrantInput,
  type DecisionRecord,
  type MissionGrantEventRecord,
  type MissionGrantTerminalEventType,
  type MissionGrantRecord,
  type MissionRecord,
  type PolicyVersionRecord,
  type PolicyVersionRules,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { AppendMissionGrantEventInput, GrantRow } from './contracts';
import  {
  rulesOf,
  wallClockMinutes,
  localPolicyClock,
  idOf,
  timestampOf,
  json,
  sameStringSet,
  parseJson,
  optionalText,
  invalid,
  stateConflict,
  referenceConflict,
} from './values';
import { mapGrant, mapGrantEvent } from './rows';
import type { MissionDomainRepositoryContext } from './context';
import { verifyGrantIssuanceGates } from './grant-issuance-gates';
export function captureWriteAuthority(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope): MissionWriteAuthoritySnapshot{
    const context = this.assertContext(contextInput);
    return createMissionWriteAuthoritySnapshot(context, this.getPolicyRuntime(context));
  }

export function assertMissionMayCreateAuthority(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, missionId: string): void{
    const context = this.assertContext(contextInput);
    this.requireMission(context, missionId);
    if (this.db.prepare(`SELECT 1 FROM ad_execution_batches batch
      JOIN ad_execution_jobs job ON job.store_id=batch.store_id AND job.batch_id=batch.id
      WHERE batch.store_id=? AND batch.mission_id=? AND job.status='unknown' LIMIT 1`).get(context.storeId, missionId)) {
      throw stateConflict('本任务有执行结果未知的历史，仅可只读对账；后续操作请新建运营任务，重新分析、判断并取得执行授权。');
    }
  }

export function assertWriteAuthority(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, authority: MissionWriteAuthoritySnapshot | undefined): void {
  if (!missionWriteAuthorityMatches(authority, this.captureWriteAuthority(context))) {
    throw stateConflict('店铺、会话或授权模式版本已变化，或记录仅为历史；请重新分析并逐条判断当前建议。');
  }
}

export function issueMissionGrant(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: CreateMissionGrantInput,
  ): MissionGrantRecord{
    const context = normalizeStoreContextEnvelope(contextInput);
    validateMissionGrant(input);
    const grantId = idOf(input.id, 'grantId');
    const issue = this.db.transaction(() => {

      const { mission, policyVersion, approvedDecisions, authority, issuedAt } = verifyGrantIssuanceGates(this, context, input);
      try {
        this.db.prepare(`
          INSERT INTO mission_grants (
            id, store_id, marketplace, currency, mission_id, mission_revision, decision_ids_json,
            action_revision, allowed_action_types_json, allowed_ad_entity_ids_json,
            max_change_pct, total_impact_budget, expires_at,
            policy_version_id, policy_revision, required_evidence_json,
            stop_conditions_json, issuer_type, issuer_actor_id,
            issued_at, created_session_generation, authority_json
          ) VALUES (
            @id, @storeId, 'US', 'USD', @missionId, @missionRevision, @decisionIdsJson,
            @actionRevision, @allowedActionTypesJson, @allowedAdEntityIdsJson,
            @maxChangePct, @totalImpactBudget, @expiresAt,
            @policyVersionId, @policyRevision, @requiredEvidenceJson,
            @stopConditionsJson, @issuerType, @issuerActorId,
            @issuedAt, @createdSessionGeneration, @authorityJson
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
          authorityJson: json(authority),
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

export function getMissionGrant(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, idInput: string): MissionGrantRecord | undefined{
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM mission_grants WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'grantId')) as GrantRow | undefined;
    return row ? this.projectGrant(context, row) : undefined;
  }

export function assertPolicyUsage(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, policyVersionId: string, entityIds: readonly string[]): void{
    const context = this.assertContext(contextInput);
    const policy = this.requirePolicyVersion(context, policyVersionId);
    let rules: PolicyVersionRules;
    try { rules = rulesOf(policy.rules); }
    catch { throw stateConflict('当前策略版本缺少有效的每日动作数、冷却期或执行窗口；请新建并启用完整策略版本。'); }
    const window = rules.executionWindow;
    if (window.timeZone !== context.businessTimezone) {
      throw stateConflict('策略执行窗口时区与当前店铺业务时区不一致；请新建并启用正确的店铺策略版本。');
    }
    const now = this.now();
    const localNow = localPolicyClock(now, window.timeZone);
    if (!window.daysOfWeek.includes(localNow.dayOfWeek)
      || localNow.minuteOfDay < wallClockMinutes(window.start)
      || localNow.minuteOfDay >= wallClockMinutes(window.end)) {
      throw stateConflict(`当前不在策略执行窗口内（${window.timeZone} ${window.start}-${window.end}）。`);
    }
    const targets = new Set(entityIds.map(id => idOf(id, 'adEntityId')));
    if (!targets.size || targets.size !== entityIds.length) throw invalid('Policy usage requires unique action targets.');

    const slots = this.db.prepare(`
      SELECT events.created_at AS reservedAt, job.ad_entity_id AS entityId
      FROM mission_grant_events events
      JOIN ad_execution_jobs job ON job.store_id=events.store_id AND job.id=events.job_id
      WHERE events.store_id=? AND events.event_type='reserved'
        AND (job.status='intent_written' OR EXISTS (SELECT 1 FROM mission_grant_events spent
          WHERE spent.store_id=events.store_id AND spent.job_id=events.job_id AND spent.event_type='spent'))
    `).all(context.storeId) as Array<{ reservedAt: string; entityId: string }>;
    const usedToday = slots.filter(slot => localPolicyClock(new Date(slot.reservedAt), window.timeZone).businessDate === localNow.businessDate).length;
    if (usedToday + targets.size > rules.maxDailyActionCount) {
      throw stateConflict(`策略单日动作数将超限：已占用 ${usedToday}，本次 ${targets.size}，上限 ${rules.maxDailyActionCount}。`);
    }
    if (rules.cooldownMinutes > 0 && slots.some(slot => targets.has(slot.entityId)
      && Date.parse(slot.reservedAt) > now.getTime() - rules.cooldownMinutes * 60_000)) {
      throw stateConflict(`至少一个关键词仍在 ${rules.cooldownMinutes} 分钟冷却期内；请等待后重新分析。`);
    }
  }

export function listMissionGrants(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, missionIdInput: string): MissionGrantRecord[]{
    const context = this.assertContext(contextInput);
    const missionId = idOf(missionIdInput, 'missionId');
    this.requireMission(context, missionId);
    return (this.db.prepare(`
      SELECT * FROM mission_grants WHERE store_id = ? AND mission_id = ?
      ORDER BY action_revision DESC, issued_at DESC, id
    `).all(context.storeId, missionId) as GrantRow[]).map(row => this.projectGrant(context, row));
  }

export function projectGrant(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, row: GrantRow): MissionGrantRecord{
    const grant = mapGrant(row);
    const events = this.db.prepare(`SELECT events.*, job.status AS job_status FROM mission_grant_events events
      LEFT JOIN ad_execution_jobs job ON job.store_id=events.store_id AND job.id=events.job_id
      WHERE events.store_id=? AND events.grant_id=?
      ORDER BY CASE events.event_type WHEN 'invalidated' THEN 4 WHEN 'revoked' THEN 3 WHEN 'expired' THEN 2 WHEN 'consumed' THEN 1 ELSE 0 END DESC,
        events.created_at DESC, events.id DESC`).all(context.storeId, grant.id) as Array<Record<string, unknown>>;
    const terminal = events.find(event => ['invalidated','revoked','expired','consumed'].includes(String(event.event_type)));
    const reserved = events.filter(event => event.event_type === 'reserved' && event.job_status === 'intent_written');
    const spent = events.filter(event => event.event_type === 'spent');
    let status: NonNullable<MissionGrantRecord['usage']>['status'] = 'available';
    try { this.assertWriteAuthority(context, grant.authority); } catch { status = 'historical'; }
    if (terminal) status = terminal.event_type as MissionGrantTerminalEventType;
    else if (Date.parse(grant.expiresAt) <= this.now().getTime()) status = 'expired';
    const spentImpactCents = spent.reduce((sum, event) => sum + Number(event.impact_cents), 0);
    const reservedImpactCents = reserved.reduce((sum, event) => sum + Number(event.impact_cents), 0);
    return { ...grant, usage: {
      contractVersion: 'grant-usage/1', status, totalSlots: grant.allowedAdEntityIds.length,
      reservedSlots: reserved.length, spentSlots: spent.length, spentImpactCents,
      residualSlots: status === 'available' ? Math.max(0, grant.allowedAdEntityIds.length - reserved.length - spent.length) : 0,
      residualImpactCents: status === 'available' ? Math.max(0, Math.round(grant.totalImpactBudget * 100) - reservedImpactCents - spentImpactCents) : 0,
    } };
  }

export function listMissionGrantEvents(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): MissionGrantEventRecord[]{
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
        CASE events.event_type WHEN 'invalidated' THEN 6 WHEN 'revoked' THEN 5 WHEN 'expired' THEN 4 WHEN 'consumed' THEN 3 WHEN 'spent' THEN 2 WHEN 'reserved' THEN 1 ELSE 0 END DESC,
        events.id DESC
    `).all(context.storeId, missionId) as Record<string, unknown>[]).map(mapGrantEvent);
  }

export function getMissionGrantTerminalEvent(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    grantIdInput: string,
  ): MissionGrantEventRecord | undefined{
    const context = this.assertContext(contextInput);
    const grant = this.requireMissionGrant(context, grantIdInput);
    const row = this.db.prepare(`
      SELECT * FROM mission_grant_events
      WHERE store_id = ? AND grant_id = ?
        AND event_type IN ('revoked', 'consumed', 'expired', 'invalidated')
      ORDER BY CASE event_type WHEN 'invalidated' THEN 3 WHEN 'revoked' THEN 2 WHEN 'expired' THEN 1 ELSE 0 END DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(context.storeId, grant.id) as Record<string, unknown> | undefined;
    return row ? mapGrantEvent(row) : undefined;
  }

export function appendMissionGrantEvent(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: AppendMissionGrantEventInput,
  ): MissionGrantEventRecord{
    const context = this.assertContext(contextInput);
    const id = idOf(input.id, 'grantEventId');
    const append = this.db.transaction(() => {
      const grant = this.requireMissionGrant(context, input.grantId);
      const existingTerminal = this.db.prepare(`
        SELECT event_type FROM mission_grant_events
        WHERE store_id = ? AND grant_id = ? AND event_type IN ('revoked', 'consumed', 'expired', 'invalidated')
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

export function assertGrantWithinPolicy(this: MissionDomainRepositoryContext, 
    input: CreateMissionGrantInput,
    policyVersion: PolicyVersionRecord,
    rules: PolicyVersionRules,
    issuedAt: string,
  ): void{
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

export function requireApprovedDecisionsForGrant(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    mission: MissionRecord,
    input: CreateMissionGrantInput,
    issuedAt: string,
  ): DecisionRecord[]{
    const latestBatch = this.db.prepare(`SELECT id,action_revision,authority_json FROM analysis_action_batches
      WHERE store_id=? AND mission_id=? ORDER BY action_revision DESC LIMIT 1`)
      .get(context.storeId, mission.id) as { id: string; action_revision: number; authority_json: string | null } | undefined;
    if (!latestBatch || latestBatch.action_revision !== input.actionRevision) {
      throw referenceConflict('授权必须来自当前任务的最新完整分析批次，请重新分析。');
    }
    this.assertWriteAuthority(context, latestBatch.authority_json ? parseJson(latestBatch.authority_json) : undefined);
    const linkedDecisions = this.db.prepare(`SELECT links.decision_id AS id FROM analysis_proposal_snapshots proposal
      LEFT JOIN analysis_proposal_decision_links links ON links.store_id=proposal.store_id AND links.proposal_id=proposal.id
      WHERE proposal.store_id=? AND proposal.action_batch_id=?`).all(context.storeId, latestBatch.id) as Array<{ id: string | null }>;
    if (!linkedDecisions.length || linkedDecisions.some(row => !row.id)
      || !sameStringSet(input.decisionIds, linkedDecisions.map(row => row.id!))) {
      throw referenceConflict('授权必须覆盖最新分析批次的全部判断，禁止拆批或组合授权。');
    }
    const decisions = input.decisionIds.map((decisionId) => this.requireDecision(context, decisionId));
    for (const decision of decisions) {
      this.assertWriteAuthority(context, decision.authority);
      const approval = this.listDecisionHistory(context, decision.id)
        .find(event => event.eventType === 'approved' && event.decisionRevision === decision.revision);
      if (!approval?.reason?.trim() || approval.actorId !== input.issuer.actorId
        || decision.authority!.authorizationPath !== input.issuer.type) {
        throw stateConflict('每条判断必须具有同一授权路径的当前批准和业务原因，禁止混合人工与策略判断。');
      }
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
