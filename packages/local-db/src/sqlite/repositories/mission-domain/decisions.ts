import  {
  normalizeStoreContextEnvelope,
  type CreateDecisionInput,
  type DecisionHistoryEventType,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { ListDomainRecordsInput, ResolveDecisionInput, DecisionRow } from './contracts';
import  {
  idOf,
  optionalId,
  textOf,
  listOf,
  revisionOf,
  optionalTimestamp,
  confidenceOf,
  json,
  jsonNullable,
  nextTimestamp,
  stateConflict,
  referenceConflict,
} from './values';
import { mapDecision, mapDecisionHistory } from './rows';
import type { MissionDomainRepositoryContext } from './context';
export function createDecision(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: CreateDecisionInput): DecisionRecord{
    const context = normalizeStoreContextEnvelope(contextInput);
    const create = this.db.transaction(() => {
      this.assertContext(context);
      const mission = this.requireMission(context, input.missionId);
      this.assertMissionMayCreateAuthority(context, mission.id);
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
      const decisionProductId = input.productId === undefined
        ? mission.productId
        : optionalId(input.productId, 'productId');
      if (decisionProductId !== mission.productId) {
        throw referenceConflict('Decision product must match its Mission product lineage.');
      }
      if (decisionProductId) this.assertProduct(context, decisionProductId);
      if (input.adEntityId) this.assertAdEntity(context, input.adEntityId);
      const now = this.timestamp();
      const authority = this.captureWriteAuthority(context);
      try {
        this.db.prepare(`
          INSERT INTO decisions (
            id, store_id, mission_id, data_batch_id, policy_version_id,
            policy_revision, action_revision, title, rationale, recommendation,
            facts_json, alternatives_json, expected_effect, valid_until,
            action_type, ad_entity_id, product_id, current_value_json,
            recommended_value_json, confidence, status, revision, created_at, updated_at, authority_json
          ) VALUES (
            @id, @storeId, @missionId, @dataBatchId, @policyVersionId,
            @policyRevision, @actionRevision, @title, @rationale, @recommendation,
            @factsJson, @alternativesJson, @expectedEffect, @validUntil,
            @actionType, @adEntityId, @productId, @currentValueJson,
            @recommendedValueJson, @confidence, @status, 1, @createdAt, @updatedAt, @authorityJson
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
          authorityJson: json(authority),
          factsJson: json(listOf(input.facts, 'facts', true)),
          alternativesJson: json(listOf(input.alternatives, 'alternatives', true)),
          expectedEffect: input.expectedEffect === undefined
            ? null
            : textOf(input.expectedEffect, 'expectedEffect', 2_000),
          validUntil: optionalTimestamp(input.validUntil, 'validUntil'),
          actionType: textOf(input.actionType, 'actionType', 120),
          adEntityId: optionalId(input.adEntityId, 'adEntityId'),
          productId: decisionProductId ?? null,
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

export function getDecision(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, idInput: string): DecisionRecord | undefined{
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM decisions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'decisionId')) as DecisionRow | undefined;
    return row ? mapDecision(row) : undefined;
  }

export function listDecisions(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): DecisionRecord[]{
    const context = this.assertContext(contextInput);
    const missionId = input.missionId ? idOf(input.missionId, 'missionId') : null;
    return (this.db.prepare(`
      SELECT * FROM decisions
      WHERE store_id = ? AND (? IS NULL OR mission_id = ?)
      ORDER BY updated_at DESC, id
    `).all(context.storeId, missionId, missionId) as DecisionRow[]).map(mapDecision);
  }

export function reviseDecision(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ReviseDecisionInput): DecisionRecord{
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

export function resolveDecision(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ResolveDecisionInput): DecisionRecord{
    const context = normalizeStoreContextEnvelope(contextInput);
    const resolve = this.db.transaction(() => {
      this.assertContext(context);
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
      if (input.status === 'approved' || input.status === 'rejected') {
        this.assertWriteAuthority(context, current.authority);
        const expectedActor = current.authority!.authorizationPath === 'human' ? 'operator' : 'policy-engine';
        if (actorId !== expectedActor) throw stateConflict('判断来源与当前授权模式不一致；请刷新并使用对应的人工或策略流程。');
      }
      const now = nextTimestamp(current.updatedAt, this.now());
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

export function listDecisionHistory(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    decisionIdInput: string,
  ): DecisionHistoryRecord[]{
    const context = this.assertContext(contextInput);
    const decisionId = idOf(decisionIdInput, 'decisionId');
    this.requireDecision(context, decisionId);
    return (this.db.prepare(`
      SELECT * FROM decision_history
      WHERE store_id = ? AND decision_id = ?
      ORDER BY decision_revision, created_at, id
    `).all(context.storeId, decisionId) as Array<Record<string, unknown>>).map(mapDecisionHistory);
  }

export function insertDecisionHistory(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    decision: DecisionRecord,
    eventType: DecisionHistoryEventType,
    actorIdInput: string,
    reason: string | undefined,
    createdAt: string,
  ): void{
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
