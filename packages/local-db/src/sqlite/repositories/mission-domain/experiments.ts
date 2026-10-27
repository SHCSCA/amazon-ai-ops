import { createHash } from 'node:crypto';
import  {
  type CreateExperimentInput,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentRecord,
  type ExperimentStatus,
  type MissionLifecycleStatus,
  type StoreContextEnvelope,
  type UpdateExperimentInput,
} from '@amazon-ai-ops/shared-types';
import  {
  ListDomainRecordsInput,
  ArchiveRestoreInput,
  TransitionExperimentInput,
  AppendExperimentObservationInput,
  AppendExperimentMetricSnapshotInput,
  EvaluateExperimentInput,
  ExperimentRow,
} from './contracts';
import  {
  assertMissionTransition,
  assertExperimentTransition,
  assertTimeRange,
  idOf,
  optionalId,
  textOf,
  listOf,
  timestampOf,
  validateExperimentMeasurementContract,
  json,
  optionalText,
  nextTimestamp,
  invalid,
  stateConflict,
  referenceConflict,
} from './values';
import { mapExperiment, mapExperimentObservation, mapMetricSnapshot } from './rows';
import type { MissionDomainRepositoryContext } from './context';
export function createExperiment(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: CreateExperimentInput): ExperimentRecord{
    const context = this.assertContext(contextInput);
    const id = idOf(input.id, 'experimentId');
    const missionId = idOf(input.missionId, 'missionId');
    const productId = optionalId(input.productId, 'productId');
    const adEntityId = optionalId(input.adEntityId, 'adEntityId');
    const startsAt = timestampOf(input.observationStartsAt, 'observationStartsAt');
    const endsAt = timestampOf(input.observationEndsAt, 'observationEndsAt');
    assertTimeRange(startsAt, endsAt, 'Experiment observation window');
    const primaryMetric = textOf(input.primaryMetric, 'primaryMetric', 160);
    const guardrailMetrics = listOf(input.guardrailMetrics, 'guardrailMetrics', true);
    const guardrailCriteria = listOf(input.guardrailCriteria, 'guardrailCriteria', true);
    validateExperimentMeasurementContract(primaryMetric, guardrailMetrics, guardrailCriteria);
    const now = this.timestamp();
    const create = this.db.transaction(() => {
      const mission = this.requireMission(context, missionId);
      if (['completed', 'archived'].includes(mission.status)) {
        throw stateConflict('Mission is closed to new Experiments.');
      }
      if (!mission.productId || !productId || mission.productId !== productId) {
        throw referenceConflict('经营实验产品必须与所选运营任务的产品完全一致；请重新选择当前任务产品。');
      }
      if (productId) this.assertProduct(context, productId);
      if (adEntityId) this.assertAdEntity(context, adEntityId);
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
          primaryMetric,
          guardrailMetricsJson: json(guardrailMetrics),
          guardrailCriteriaJson: json(guardrailCriteria),
          productId,
          adEntityId,
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

export function getExperiment(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, idInput: string): ExperimentRecord | undefined{
    const context = this.assertContext(contextInput);
    const row = this.db.prepare(`SELECT * FROM experiments WHERE store_id = ? AND id = ?`)
      .get(context.storeId, idOf(idInput, 'experimentId')) as ExperimentRow | undefined;
    return row ? mapExperiment(row) : undefined;
  }

export function listExperiments(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): ExperimentRecord[]{
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

export function updateExperiment(this: MissionDomainRepositoryContext, contextInput: StoreContextEnvelope, input: UpdateExperimentInput): ExperimentRecord{
    const context = this.assertContext(contextInput);
    const current = this.requireExperiment(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Experiment');
    if (current.status !== 'draft') {
      throw stateConflict('经营实验首次启动后，产品、广告对象、指标、变量与观察窗口已冻结；如需改变实验合同，请归档当前实验并新建实验。');
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
    const nextPrimaryMetric = patch.primaryMetric === undefined
      ? current.primaryMetric
      : textOf(patch.primaryMetric, 'primaryMetric', 160);
    const nextGuardrailMetrics = patch.guardrailMetrics === undefined
      ? current.guardrailMetrics
      : listOf(patch.guardrailMetrics, 'guardrailMetrics', true);
    const nextGuardrailCriteria = patch.guardrailCriteria === undefined
      ? current.guardrailCriteria
      : listOf(patch.guardrailCriteria, 'guardrailCriteria', true);
    validateExperimentMeasurementContract(
      nextPrimaryMetric,
      nextGuardrailMetrics,
      nextGuardrailCriteria,
    );
    const now = nextTimestamp(current.updatedAt, this.now());
    const update = this.db.transaction(() => {
      const mission = this.requireMission(context, current.missionId);
      if (!mission.productId || !nextProductId || mission.productId !== nextProductId) {
        throw referenceConflict('经营实验产品必须与所选运营任务的产品完全一致；请重新选择当前任务产品。');
      }
      if (nextAdEntityId && !this.adEntityBelongsToPolicyScope(
        context,
        `product:${encodeURIComponent(nextProductId)}`,
        nextAdEntityId,
      )) {
        throw referenceConflict('所选广告对象不属于当前运营任务产品；请从该产品的已核验广告对象中重新选择。');
      }
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
        AND status = 'draft'
      `).run({
      storeId: context.storeId,
      id: current.id,
      expectedRevision: input.expectedRevision,
      name: patch.name === undefined ? current.name : textOf(patch.name, 'name', 300),
      hypothesis: patch.hypothesis === undefined ? current.hypothesis : textOf(patch.hypothesis, 'hypothesis', 4_000),
      primaryMetric: nextPrimaryMetric,
      guardrailMetricsJson: json(nextGuardrailMetrics),
      guardrailCriteriaJson: json(nextGuardrailCriteria),
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

export function transitionExperiment(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: TransitionExperimentInput,
  ): ExperimentRecord{
    const context = this.assertContext(contextInput);
    const current = this.requireExperiment(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Experiment');
    assertExperimentTransition(current.status, input.status);
    if (input.status === 'completed') {
      throw stateConflict('经营实验只能由系统根据观察窗与指标快照完成判定，人工文字不能直接形成实验结论。');
    }
    const now = nextTimestamp(current.updatedAt, this.now());
    const transition = this.db.transaction(() => {
      if (current.status === 'paused' && input.status === 'running') {
        const guardrailStop = this.db.prepare(`
          SELECT 1
          FROM causal_events
          WHERE store_id = ? AND mission_id = ?
            AND entity_type = 'experiment' AND entity_id = ?
            AND event_type = 'experiment_guardrail_triggered'
          LIMIT 1
        `).get(context.storeId, current.missionId, current.id);
        if (guardrailStop) {
          throw stateConflict('经营实验已由系统指标触发守护栏，不能恢复原实验；请复核原因并新建实验。');
        }
      }
      const hasPriorRunningEvent = current.status === 'paused' && input.status === 'running'
        ? Boolean(this.db.prepare(`
            SELECT 1
            FROM causal_events
            WHERE store_id = ? AND mission_id = ?
              AND entity_type = 'experiment' AND entity_id = ?
              AND event_type = 'experiment_running'
            LIMIT 1
          `).get(context.storeId, current.missionId, current.id))
        : false;

      const trustedBaseline = input.status === 'running'
        && (current.status === 'draft' || !hasPriorRunningEvent)
        ? this.requireVerifiedExperimentBaseline(context, current)
        : undefined;
      if (trustedBaseline) {
        const mission = this.requireMission(context, current.missionId);
        this.captureExperimentMetrics(context, current, mission.dataBatchId, 'baseline', now, String(trustedBaseline.adEntityAuthorityId));
      }
      const result = this.db.prepare(`
        UPDATE experiments
        SET status = ?, conclusion = CASE WHEN ? = 'completed' THEN COALESCE(?, conclusion) ELSE conclusion END,
            baseline_json = COALESCE(?, baseline_json),
            revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ? AND status <> 'archived'
      `).run(
        input.status, input.status, optionalText(input.reason),
        trustedBaseline === undefined ? null : json(trustedBaseline),
        now,
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

export function evaluateExperiment(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: EvaluateExperimentInput,
  ): ExperimentRecord{
    const context = this.assertContext(contextInput);
    const current = this.requireExperiment(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Experiment');
    if (!['running', 'paused'].includes(current.status)) {
      throw stateConflict('只有观察中或已暂停的经营实验可以由系统判定。');
    }
    if (this.now().getTime() < Date.parse(current.observationEndsAt)) {
      throw stateConflict('观察窗口尚未结束，暂不能判定经营实验。请等待结束时间后导入新报表。');
    }
    const actorId = idOf(input.actorId, 'actorId');
    const now = nextTimestamp(current.updatedAt, this.now());
    const evaluate = this.db.transaction(() => {
      const resultBatchId = this.requireLatestExperimentResultBatch(context, current);
      this.captureExperimentMetrics(context, current, resultBatchId, 'result', now);
      this.assertExperimentMetricCoverage(context, current);
      const outcome = this.buildExperimentEvaluation(context, current);
      const result = this.db.prepare(`
        UPDATE experiments
        SET status = ?, conclusion = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ?
          AND status IN ('running', 'paused')
      `).run(
        outcome.status,
        outcome.conclusion,
        now,
        context.storeId,
        current.id,
        input.expectedRevision,
      );
      this.assertCas(result.changes, 'Experiment');
      const experiment = this.requireExperiment(context, current.id);
      const effectEventId = `causal:experiment:${experiment.id}:r${experiment.revision}`;
      this.appendCausalInternal(context, {
        id: effectEventId,
        stage: 'EFFECT',
        eventType: outcome.eventType,
        entityType: 'experiment',
        entityId: experiment.id,
        missionId: experiment.missionId,
        title: experiment.name,
        observedEffect: outcome.conclusion,
        status: experiment.status,
        source: resultBatchId,
        actorId,
      }, now);
      const resultSnapshots = this.listExperimentMetricSnapshots(context, experiment.id)
        .filter((snapshot) => snapshot.dataBatchId === resultBatchId
          && Date.parse(snapshot.observedAt) >= Date.parse(experiment.observationEndsAt))
        .sort((left, right) => left.metric.localeCompare(right.metric, 'en-US') || left.id.localeCompare(right.id, 'en-US'));
      const resultProofSha256 = createHash('sha256').update(json({
        schemaVersion: 1,
        storeId: context.storeId,
        missionId: experiment.missionId,
        experimentId: experiment.id,
        experimentRevision: experiment.revision,
        resultBatchId,
        outcome: {
          eventType: outcome.eventType,
          status: experiment.status,
          conclusion: outcome.conclusion,
        },
        snapshots: resultSnapshots.map((snapshot) => ({
          id: snapshot.id,
          metric: snapshot.metric,
          value: snapshot.value,
          currency: snapshot.currency ?? null,
          observedAt: snapshot.observedAt,
          dataBatchId: snapshot.dataBatchId,
        })),
      })).digest('hex');
      const evidenceIdentity = createHash('sha256').update(effectEventId).digest('hex').slice(0, 40);
      this.appendEvidenceRef(context, {
        id: `evidence:experiment:${evidenceIdentity}`,
        eventId: effectEventId,
        evidenceType: 'experiment_result_snapshot',
        evidenceRef: `experiment-result:${resultProofSha256}`,
        sha256: resultProofSha256,
      });
      const mission = this.requireMission(context, experiment.missionId);
      if (mission.status !== 'active' || !['readback', 'effect'].includes(mission.phase)) {
        throw stateConflict('关联运营任务不是可评估状态；请先恢复任务并确认执行回读，再重新判定经营实验。');
      }
      const remainingExperiments = this.db.prepare(`
        SELECT count(*) AS count
        FROM experiments
        WHERE store_id = ? AND mission_id = ? AND id <> ?
          AND status IN ('draft', 'running', 'paused')
      `).get(context.storeId, mission.id, experiment.id) as { count: number };
      const missionStatus: MissionLifecycleStatus = outcome.status === 'paused'
        ? 'blocked'
        : remainingExperiments.count === 0 ? 'completed' : 'active';
      assertMissionTransition(mission.status, missionStatus);
      const missionUpdatedAt = nextTimestamp(mission.updatedAt, new Date(now));
      const missionResult = this.db.prepare(`
        UPDATE missions
        SET status = ?, phase = 'effect', revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ?
          AND status = 'active' AND phase IN ('readback', 'effect')
      `).run(
        missionStatus,
        missionUpdatedAt,
        context.storeId,
        mission.id,
        mission.revision,
      );
      this.assertCas(missionResult.changes, 'Mission');
      const evaluatedMission = this.requireMission(context, mission.id);
      this.insertMissionEvent(
        context,
        evaluatedMission,
        outcome.status === 'paused' ? 'experiment_guardrail_blocked' : 'experiment_effect_evaluated',
        actorId,
        outcome.conclusion,
        missionUpdatedAt,
      );
      const evidenceCount = new Set([
        experiment.primaryMetric,
        ...experiment.guardrailMetrics,
      ].map((metric) => metric.trim().toLocaleUpperCase('en-US'))).size;
      this.db.prepare(`
        INSERT INTO mission_checkpoints (
          id, store_id, mission_id, stage, title, status,
          evidence_count, actor_id, created_at
        ) VALUES (?, ?, ?, 'EFFECT', ?, ?, ?, ?, ?)
      `).run(
        `checkpoint:experiment:${experiment.id}:r${experiment.revision}:effect`,
        context.storeId,
        mission.id,
        outcome.status === 'paused' ? '经营实验触发守护栏' : '经营实验完成效果评估',
        outcome.status === 'paused' ? 'blocked' : 'completed',
        evidenceCount,
        actorId,
        missionUpdatedAt,
      );
      return experiment;
    });
    return evaluate.immediate();
  }

export function archiveExperiment(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, input: ArchiveRestoreInput): ExperimentRecord{
    return this.setExperimentArchive(context, input, true);
  }

export function restoreExperiment(this: MissionDomainRepositoryContext, context: StoreContextEnvelope, input: ArchiveRestoreInput): ExperimentRecord{
    return this.setExperimentArchive(context, input, false);
  }

export function listExperimentObservations(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    experimentIdInput: string,
  ): ExperimentObservationRecord[]{
    const context = this.assertContext(contextInput);
    const experiment = this.requireExperiment(context, experimentIdInput);
    return (this.db.prepare(`
      SELECT * FROM experiment_records
      WHERE store_id = ? AND experiment_id = ?
      ORDER BY observed_at DESC, created_at DESC, id
    `).all(context.storeId, experiment.id) as Array<Record<string, unknown>>)
      .map(mapExperimentObservation);
  }

export function listExperimentMetricSnapshots(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    experimentIdInput: string,
  ): ExperimentMetricSnapshotRecord[]{
    const context = this.assertContext(contextInput);
    const experiment = this.requireExperiment(context, experimentIdInput);
    return (this.db.prepare(`
      SELECT * FROM experiment_metric_snapshots
      WHERE store_id = ? AND experiment_id = ?
      ORDER BY observed_at DESC, created_at DESC, id
    `).all(context.storeId, experiment.id) as Array<Record<string, unknown>>)
      .map(mapMetricSnapshot);
  }

export function appendExperimentObservation(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: AppendExperimentObservationInput,
  ): ExperimentObservationRecord{
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

export function appendExperimentMetricSnapshot(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: AppendExperimentMetricSnapshotInput,
  ): ExperimentMetricSnapshotRecord{
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

export function setExperimentArchive(this: MissionDomainRepositoryContext, 
    contextInput: StoreContextEnvelope,
    input: ArchiveRestoreInput,
    archive: boolean,
  ): ExperimentRecord{
    const context = this.assertContext(contextInput);
    const current = this.requireExperiment(context, input.id);
    this.assertRevision(current.revision, input.expectedRevision, 'Experiment');
    if (archive && current.status === 'running') throw stateConflict('Pause a running Experiment before archival.');
    if (archive && current.status === 'archived') return current;
    if (!archive && current.status !== 'archived') throw stateConflict('Only archived Experiment can be restored.');
    const now = nextTimestamp(current.updatedAt, this.now());
    const operation = this.db.transaction(() => {
      const completedBeforeArchive = !archive && Boolean(this.db.prepare(`
        SELECT 1
        FROM causal_events
        WHERE store_id = ? AND entity_type = 'experiment' AND entity_id = ?
          AND event_type = 'experiment_completed'
        LIMIT 1
      `).get(context.storeId, current.id));
      const status: ExperimentStatus = archive
        ? 'archived'
        : completedBeforeArchive ? 'completed' : 'paused';
      const result = this.db.prepare(`
        UPDATE experiments
        SET status = ?, archived_at = ?, revision = revision + 1, updated_at = ?
        WHERE store_id = ? AND id = ? AND revision = ?
      `).run(
        status, archive ? now : null,
        now, context.storeId, current.id, input.expectedRevision,
      );
      this.assertCas(result.changes, 'Experiment');
      const experiment = this.requireExperiment(context, current.id);
      this.appendCausalInternal(context, {
        id: `causal:experiment:${experiment.id}:r${experiment.revision}`,
        stage: experiment.status === 'completed' ? 'EFFECT' : 'ANALYSIS',
        eventType: archive ? 'experiment_archived' : 'experiment_restored',
        entityType: 'experiment', entityId: experiment.id, missionId: experiment.missionId,
        title: experiment.name, intervention: optionalText(input.reason) ?? undefined,
        observedEffect: experiment.status === 'completed' ? experiment.conclusion : undefined,
        status: experiment.status, source: 'mission-domain', actorId: input.actorId,
      }, now);
      return experiment;
    });
    return operation.immediate();
  }
