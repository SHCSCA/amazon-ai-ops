import  {
  CAUSAL_LEDGER_STAGES,
  type AppendMissionCheckpointInput,
  type CreateMissionInput,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionLinkType,
  type MissionPhase,
  type MissionRecord,
  type MissionCheckpointRecord,
  type StoreContextEnvelope,
  type UpdateMissionInput,
} from '@amazon-ai-ops/shared-types';
import  {
  ListDomainRecordsInput,
  ArchiveRestoreInput,
  AppendMissionLinkInput,
  MissionLineageProjection,
  MissionRow,
} from './contracts';
import  {
  assertMissionTransition,
  assertTimeRange,
  idOf,
  optionalId,
  textOf,
  listOf,
  timestampOf,
  missionPriorityOf,
  json,
  optionalText,
  nextTimestamp,
  invalid,
  stateConflict,
} from './values';
import { mapMission, mapMissionLink, mapMissionCheckpoint } from './rows';
import type { MissionDomainRepositoryContext } from './context';
export function createMission(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: CreateMissionInput): MissionRecord{
    const context = this.assertContext(contextInput);
    const id = idOf(input.id, 'missionId');
    const dataBatchId = idOf(input.dataBatchId, 'dataBatchId');
    const policyVersionId = idOf(input.policyVersionId, 'policyVersionId');
    const observationStartsAt = timestampOf(input.observationStartsAt, 'observationStartsAt');
    const observationEndsAt = timestampOf(input.observationEndsAt, 'observationEndsAt');
    assertTimeRange(observationStartsAt, observationEndsAt, 'Mission observation window');
    const successCriteria = listOf(input.successCriteria, 'successCriteria', true);
    const guardrails = listOf(input.guardrails, 'guardrails', true);
    const actorId = idOf(input.actorId, 'actorId');
    const now = this.timestamp();
    const priority = missionPriorityOf(input.priority ?? 'P2');
    const create = this.db.transaction(() => {
      this.requireCompletedDataBatch(context, dataBatchId);
      const policyVersion = this.requirePolicyVersion(context, policyVersionId);
      if (policyVersion.status !== 'enabled') {
        throw stateConflict('Mission must bind the currently enabled policy version.');
      }
      const policy = this.requirePolicy(context, policyVersion.policyId);
      if (policy.activeVersionId !== policyVersion.id || policy.status !== 'active') {
        throw stateConflict('Mission policy version is not the active store policy authority.');
      }
      if (input.productId) this.assertProduct(context, input.productId);
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

export function getMission(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, idInput: string): MissionRecord | undefined{
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM missions WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'missionId')) as MissionRow | undefined;
    return row ? mapMission(row) : undefined;
  }

export function listMissions(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): MissionRecord[]{
    const context = this.assertContext(contextInput);
    return (this.db.prepare(`
      SELECT * FROM missions
      WHERE store_id = ? AND (? = 1 OR status <> 'archived')
      ORDER BY updated_at DESC, id
    `).all(context.storeId, input.includeArchived ? 1 : 0) as MissionRow[]).map(mapMission);
  }

export function updateMission(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: UpdateMissionInput): MissionRecord{
    const context = this.assertContext(contextInput);
    const current = this.requireMission(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Mission');
    if (['completed', 'archived'].includes(current.status)) {
      throw stateConflict('Completed or archived Mission cannot be edited.');
    }
    const patch = input.patch;
    if (!patch || Object.keys(patch).length === 0) throw invalid('Mission patch cannot be empty.');
    const allowedPatchKeys = new Set([
      'title',
      'objective',
      'priority',
      'productId',
      'observationStartsAt',
      'observationEndsAt',
      'successCriteria',
      'guardrails',
    ]);
    const unknownPatchKeys = Object.keys(patch).filter((key) => !allowedPatchKeys.has(key));
    if (unknownPatchKeys.length > 0) {
      throw invalid(`Mission patch contains unsupported fields: ${unknownPatchKeys.join(', ')}.`);
    }
    const authorityPatchKeys = Object.keys(patch).filter((key) => key !== 'title');
    const hasBoundDecision = authorityPatchKeys.length > 0 && Boolean(this.db.prepare(`
      SELECT 1 FROM decisions WHERE store_id = ? AND mission_id = ? LIMIT 1
    `).get(context.storeId, current.id));
    if (authorityPatchKeys.length > 0
      && (hasBoundDecision || ['decision', 'action', 'readback', 'effect'].includes(current.phase))) {
      throw stateConflict('运营任务进入决策阶段后经营定义已锁定；只能重命名标题，如需改变范围或目标，请终止当前任务并重新创建。');
    }
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

export function transitionMission(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: {
      id: string;
      expectedRevision: number;
      status: Exclude<MissionLifecycleStatus, 'archived'>;
      phase?: MissionPhase;
      reason?: string;
      actorId: string;
    },
  ): MissionRecord{
    const context = this.assertContext(contextInput);
    const current = this.requireMission(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Mission');
    assertMissionTransition(current.status, input.status);
    const actorId = idOf(input.actorId, 'actorId');
    const phase = input.phase ?? current.phase;
    const phaseSequence: readonly MissionPhase[] = ['fact', 'analysis', 'decision', 'action', 'readback', 'effect'];
    if (!phaseSequence.includes(phase)) {
      throw invalid('Unsupported Mission phase.');
    }
    if (phaseSequence.indexOf(phase) < phaseSequence.indexOf(current.phase)) {
      throw stateConflict('Mission phase cannot move backward; create a new Mission if its evidence-bound definition must change.');
    }
    const updatedAt = nextTimestamp(current.updatedAt, this.now());
    const transition = this.db.transaction(() => {
      if (input.status === 'active') this.assertMissionMayCreateAuthority(context, current.id);
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

export function archiveMission(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, input: ArchiveRestoreInput): MissionRecord{
    return this.setMissionArchive(context, input, true);
  }

export function restoreMission(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, input: ArchiveRestoreInput): MissionRecord{
    return this.setMissionArchive(context, input, false);
  }

export function appendMissionCheckpoint(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: AppendMissionCheckpointInput,
  ): MissionCheckpointRecord{
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

export function listMissionCheckpoints(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): MissionCheckpointRecord[]{
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

export function appendMissionLink(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: AppendMissionLinkInput): MissionLinkRecord{
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

export function getMissionLineage(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, missionIdInput: string): MissionLineageProjection{
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

export function setMissionArchive(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: ArchiveRestoreInput,
    archive: boolean,
  ): MissionRecord{
    const context = this.assertContext(contextInput);
    const current = this.requireMission(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Mission');
    if (archive && current.status === 'archived') return current;
    if (!archive && current.status !== 'archived') throw stateConflict('Only archived Mission can be restored.');
    const now = nextTimestamp(current.updatedAt, this.now());
    const action = this.db.transaction(() => {
      const completedBeforeArchive = !archive && Boolean(this.db.prepare(`
        SELECT 1
        FROM mission_events
        WHERE store_id = ? AND mission_id = ?
          AND event_type IN ('status_completed', 'experiment_effect_evaluated')
        LIMIT 1
      `).get(context.storeId, current.id));
      const status: MissionLifecycleStatus = archive
        ? 'archived'
        : completedBeforeArchive ? 'completed' : 'paused';
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

export function insertMissionEvent(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    mission: MissionRecord,
    eventType: string,
    actorIdInput: string,
    reason: string | null | undefined,
    createdAt: string,
  ): void{
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

export function insertMissionLink(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    input: AppendMissionLinkInput,
    createdAt: string,
  ): void{
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

export function assertMissionLinkTarget(this: MissionDomainRepositoryContext, 
    context: StoreContextEnvelope,
    type: MissionLinkType,
    targetId: string,
  ): void{
    if (type === 'data_batch') { this.requireCompletedDataBatch(context, targetId); return; }
    if (type === 'policy_version') { this.requirePolicyVersion(context, targetId); return; }
    if (type === 'decision') { this.requireDecision(context, targetId); return; }
    if (type === 'experiment') { this.requireExperiment(context, targetId); return; }

    idOf(targetId, 'targetId');
  }
