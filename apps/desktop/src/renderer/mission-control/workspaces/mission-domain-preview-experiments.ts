import {
  missionControlContextKey,
  createCausalTimelineExport,
  type CausalTimelineExport,
  type AppendCausalEventInput,
  type AppendMissionCheckpointInput,
  type CausalEventRecord,
  type CausalLedgerStage,
  type CreateDecisionInput,
  type CreateExperimentInput,
  type CreateMissionInput,
  type CreatePolicyInput,
  type CreatePolicyVersionInput,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type DecisionStatus,
  type ExperimentObservationRecord,
  type ExperimentObservationType,
  type ExperimentMetricSnapshotRecord,
  type ExperimentRecord,
  type ExperimentStatus,
  type MissionCheckpointRecord,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionPhase,
  type MissionRecord,
  type PolicyAutonomyMode,
  type PolicyRecord,
  type PolicyRuntimeRecord,
  type PolicyVersionRecord,
  type PolicyVersionRules,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
  type UpdateExperimentInput,
  type UpdateMissionInput,
} from '@amazon-ai-ops/shared-types';
import { type PreviewExperimentMemoryState, type ExperimentDomainRendererApi, type MemoryDomainRendererApi, type CausalEventListInput } from './mission-domain-contracts';
import { assertMissionAuthorityContext } from './mission-domain-context';
import { previewIdentity, clone, nowAfter } from './mission-domain-preview-values';



export function seedPreviewExperimentMemory(context: StoreContextEnvelope): PreviewExperimentMemoryState {
  assertMissionAuthorityContext(context);
  const { suffix, asin, subject } = previewIdentity(context);
  const createdAt = '2026-07-22T04:00:00.000Z';
  const experimentStatuses: ExperimentStatus[] = [
    'running', 'paused', 'draft', 'completed', 'running', 'draft', 'archived',
  ];
  const experiments = experimentStatuses.map((status, index): ExperimentRecord => ({
    id: `EXPERIMENT-${suffix}-${String(index + 1).padStart(3, '0')}`,
    storeId: context.storeId,
    missionId: `MISSION-${suffix}-${String(index === 1 ? 1 : Math.min(index + 1, 7)).padStart(3, '0')}`,
    name: index === 0 ? `${subject}核心词竞价 -12% 小步实验` : `${subject}经营实验 ${index + 1}`,
    hypothesis: index === 0
      ? '若仅下调高花费核心词竞价 12%，则 7 天 ACOS 会改善且广告订单下降不超过 15%。'
      : `在单一变量边界内验证 ${subject} 的第 ${index + 1} 个经营假设。`,
    primaryMetric: index % 2 === 0 ? 'ACOS' : '广告订单',
    guardrailMetrics: ['广告订单', 'CVR', '花费'],
    guardrailCriteria: ['广告订单下降 < 15%', 'CVR 不低于基线 90%', '单日花费变化 ≤ 20%'],
    productId: asin,
    ...(index < 5 ? { adEntityId: `KW-${suffix}-${String(index + 1).padStart(3, '0')}` } : {}),
    baseline: { bidUsd: Number((1.2 + index * 0.05).toFixed(2)), acosPct: 38 + index, windowDays: 7 },
    variant: { bidUsd: Number((1.06 + index * 0.04).toFixed(2)), changePct: -12, onlyVariable: 'keyword_bid' },
    observationStartsAt: '2026-07-22T07:00:00.000Z',
    observationEndsAt: '2026-07-29T07:00:00.000Z',
    status,
    ...(status === 'completed' ? { conclusion: 'ACOS 改善 11.8%，广告订单下降 4.2%，守护栏未触发。' } : {}),
    revision: 1,
    createdAt,
    updatedAt: new Date(Date.parse(createdAt) + index * 1_000).toISOString(),
    ...(status === 'archived' ? { archivedAt: '2026-07-22T05:00:00.000Z' } : {}),
  }));

  const causalSeeds: Omit<CausalEventRecord, 'storeId' | 'businessDate' | 'sessionGeneration'>[] = [
    {
      id: `CAUSAL-${suffix}-FACT-001`, stage: 'FACT', eventType: 'lingxing_report_imported',
      entityType: 'data_batch', entityId: `BATCH-${suffix}-0722`, missionId: experiments[0].missionId,
      title: '领星广告报表已完成店铺级采集', signal: '8/8 报表可读取，6,827 行已校验',
      status: 'recorded', source: 'lingxing-collector', actorId: 'main-agent', sequence: 1, createdAt,
    },
    {
      id: `CAUSAL-${suffix}-ANALYSIS-001`, stage: 'ANALYSIS', eventType: 'waste_cluster_identified',
      entityType: 'experiment', entityId: experiments[0].id, missionId: experiments[0].missionId,
      title: '识别核心词高花费低转化簇', signal: '过去 7 天 ACOS 38.4%，高于目标 28%', confidence: 0.86,
      status: 'recorded', source: 'analysis-agent', actorId: 'analysis-agent', sequence: 2,
      createdAt: new Date(Date.parse(createdAt) + 60_000).toISOString(),
    },
    {
      id: `CAUSAL-${suffix}-DECISION-001`, stage: 'DECISION', eventType: 'decision_approved',
      entityType: 'decision', entityId: `DECISION-${suffix}-003`, missionId: experiments[0].missionId,
      title: '人工批准核心词竞价 -12%', intervention: '将关键词竞价从 $1.20 调整到 $1.06',
      expectedEffect: '7 天 ACOS 改善且订单下降不超过 15%', status: 'approved',
      source: 'mission-domain', actorId: 'desktop-operator', sequence: 3,
      createdAt: new Date(Date.parse(createdAt) + 120_000).toISOString(),
    },
    {
      id: `CAUSAL-${suffix}-ACTION-001`, stage: 'ACTION', eventType: 'ad_write_confirmed',
      entityType: 'ad_execution', entityId: `EXEC-${suffix}-001`, missionId: experiments[0].missionId,
      title: '可见浏览器已完成单次关键词竞价写入', intervention: '$1.20 → $1.06',
      status: 'confirmed', source: 'visible-browser-executor', actorId: 'main-agent', sequence: 4,
      createdAt: new Date(Date.parse(createdAt) + 180_000).toISOString(),
    },
    {
      id: `CAUSAL-${suffix}-READBACK-001`, stage: 'READBACK', eventType: 'reload_readback_verified',
      entityType: 'execution_readback', entityId: `READBACK-${suffix}-001`, missionId: experiments[0].missionId,
      title: '页面刷新后目标竞价仍为 $1.06', observedEffect: 'Before / After / Reload 三份截图身份一致',
      status: 'verified', source: 'visible-browser-executor', actorId: 'main-agent', sequence: 5,
      createdAt: new Date(Date.parse(createdAt) + 240_000).toISOString(),
    },
    {
      id: `CAUSAL-${suffix}-EFFECT-001`, stage: 'EFFECT', eventType: 'experiment_result',
      entityType: 'experiment', entityId: experiments[3].id, missionId: experiments[3].missionId,
      title: '实验观察窗已完成', observedEffect: 'ACOS 改善 11.8%，广告订单下降 4.2%', confidence: 0.79,
      status: 'recorded', source: 'experiment', actorId: 'main-agent', sequence: 6,
      createdAt: new Date(Date.parse(createdAt) + 300_000).toISOString(),
    },
  ];
  const causalEvents = causalSeeds.map((event): CausalEventRecord => ({
    ...event,
    storeId: context.storeId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
  }));
  const observations: ExperimentObservationRecord[] = [
    {
      id: `OBS-${suffix}-001`, storeId: context.storeId, experimentId: experiments[0].id,
      observationType: 'baseline', title: '实验前基线已确认', observation: '7 天 ACOS 38.4%，广告订单 24。',
      observedAt: '2026-07-22T07:00:00.000Z', actorId: 'desktop-operator', createdAt,
    },
    {
      id: `OBS-${suffix}-002`, storeId: context.storeId, experimentId: experiments[1].id,
      observationType: 'observation', title: '同 Mission 的另一个实验记录', observation: '该记录不得出现在第一个实验的修正目标中。',
      observedAt: '2026-07-22T08:00:00.000Z', actorId: 'desktop-operator',
      createdAt: new Date(Date.parse(createdAt) + 1_000).toISOString(),
    },
  ];
  const metricSnapshots: ExperimentMetricSnapshotRecord[] = [
    {
      id: `METRIC-${suffix}-001`, storeId: context.storeId, experimentId: experiments[0].id,
      metric: 'ACOS', value: 38.4, observedAt: '2026-07-22T07:00:00.000Z',
      dataBatchId: `BATCH-${suffix}-0722`, createdAt,
    },
    {
      id: `METRIC-${suffix}-002`, storeId: context.storeId, experimentId: experiments[0].id,
      metric: '广告花费', value: 4862, currency: 'USD', observedAt: '2026-07-22T07:00:00.000Z',
      dataBatchId: `BATCH-${suffix}-0722`, createdAt,
    },
  ];
  causalEvents.push({
    id: `causal:experiment-record:${observations[0].id}`,
    storeId: context.storeId,
    stage: 'FACT',
    eventType: 'experiment_baseline',
    entityType: 'experiment_record',
    entityId: observations[0].id,
    missionId: experiments[0].missionId,
    title: observations[0].title,
    signal: observations[0].observation,
    status: 'recorded',
    source: 'experiment',
    actorId: observations[0].actorId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    sequence: 7,
    createdAt,
  });
  causalEvents.push({
    id: `causal:experiment-record:${observations[1].id}`,
    storeId: context.storeId,
    stage: 'FACT',
    eventType: 'experiment_observation',
    entityType: 'experiment_record',
    entityId: observations[1].id,
    missionId: experiments[1].missionId,
    title: observations[1].title,
    signal: observations[1].observation,
    status: 'recorded',
    source: 'experiment',
    actorId: observations[1].actorId,
    businessDate: context.businessDate,
    sessionGeneration: context.sessionGeneration,
    sequence: 8,
    createdAt: observations[1].createdAt,
  });
  return {
    authorityKey: missionControlContextKey(context),
    experiments,
    observations,
    metricSnapshots,
    causalEvents,
    nextSequence: 9,
  };
}



export function assertExperimentRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`Experiment 版本冲突：当前 revision=${actual}，提交 revision=${expected}；请刷新后重试。`);
  }
}



export function assertExperimentWindow(startsAt: string, endsAt: string): void {
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt))
    || Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new Error('Experiment 观察窗口结束时间必须晚于开始时间。');
  }
}



export function validateExperimentCreate(input: CreateExperimentInput): void {
  if (!input.id.trim() || !input.missionId.trim() || !input.name.trim() || !input.hypothesis.trim()) {
    throw new Error('Experiment ID、Mission、名称与假设不能为空。');
  }
  if (!input.primaryMetric.trim() || !input.guardrailMetrics.length || !input.guardrailCriteria.length) {
    throw new Error('Experiment 必须配置主指标、守护指标和判定标准。');
  }
  assertExperimentWindow(input.observationStartsAt, input.observationEndsAt);
}



export function allowedExperimentTransition(from: ExperimentStatus, to: Exclude<ExperimentStatus, 'archived'>): boolean {
  if (from === 'draft') return to === 'running' || to === 'paused';
  if (from === 'running') return to === 'paused' || to === 'completed';
  if (from === 'paused') return to === 'running' || to === 'completed';
  return false;
}



export function createPreviewExperimentMemoryDomainSuite(): {
  experiments: ExperimentDomainRendererApi;
  memory: MemoryDomainRendererApi;
} {
  const stores = new Map<string, PreviewExperimentMemoryState>();
  const stateFor = (context: StoreContextEnvelope): PreviewExperimentMemoryState => {
    assertMissionAuthorityContext(context);
    const key = String(context.storeId);
    const current = stores.get(key);
    const authorityKey = missionControlContextKey(context);
    if (current?.authorityKey === authorityKey) return current;
    const seeded = seedPreviewExperimentMemory(context);
    stores.set(key, seeded);
    return seeded;
  };
  const experimentFor = (state: PreviewExperimentMemoryState, id: string): ExperimentRecord => {
    const experiment = state.experiments.find((item) => item.id === id);
    if (!experiment) throw new Error('Experiment 不存在或不属于当前店铺。');
    return experiment;
  };
  const replaceExperiment = (state: PreviewExperimentMemoryState, experiment: ExperimentRecord): ExperimentRecord => {
    state.experiments = state.experiments.map((item) => item.id === experiment.id ? experiment : item);
    return clone(experiment);
  };
  const appendCausal = (
    context: StoreContextEnvelope,
    state: PreviewExperimentMemoryState,
    input: Omit<AppendCausalEventInput, 'id'> & { id: string },
    createdAt = nowAfter(),
  ): CausalEventRecord => {
    if (state.causalEvents.some((item) => item.id === input.id)) throw new Error('因果事件 ID 已存在。');
    if (input.correctsEventId && !state.causalEvents.some((item) => item.id === input.correctsEventId)) {
      throw new Error('修正事件必须引用当前店铺中存在的原事件。');
    }
    const event: CausalEventRecord = {
      ...input,
      storeId: context.storeId,
      businessDate: context.businessDate,
      sessionGeneration: context.sessionGeneration,
      sequence: state.nextSequence++,
      createdAt,
    };
    state.causalEvents.push(event);
    return clone(event);
  };
  const listEvents = async (context: StoreContextEnvelope, input: CausalEventListInput = {}) => {
    const state = stateFor(context);
    const stages = input.stages?.length ? new Set(input.stages) : null;
    return clone(state.causalEvents
      .filter((item) => (!input.missionId || item.missionId === input.missionId)
        && (!stages || stages.has(item.stage)))
      .sort((left, right) => right.sequence - left.sequence));
  };

  const experiments: ExperimentDomainRendererApi = {
    async listExperiments(context, input = {}) {
      return clone(stateFor(context).experiments
        .filter((item) => (input.includeArchived || item.status !== 'archived')
          && (!input.missionId || item.missionId === input.missionId))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    },
    async createExperiment(context, input) {
      validateExperimentCreate(input);
      const state = stateFor(context);
      if (state.experiments.some((item) => item.id === input.id)) throw new Error('Experiment ID 已存在。');
      const createdAt = nowAfter();
      const experiment: ExperimentRecord = {
        ...input,
        storeId: context.storeId,
        guardrailMetrics: [...input.guardrailMetrics],
        guardrailCriteria: [...input.guardrailCriteria],
        baseline: clone(input.baseline),
        variant: clone(input.variant),
        status: 'draft',
        revision: 1,
        createdAt,
        updatedAt: createdAt,
      };
      state.experiments.unshift(experiment);
      appendCausal(context, state, {
        id: `causal:experiment:${experiment.id}:r1`, stage: 'ANALYSIS', eventType: 'experiment_created',
        entityType: 'experiment', entityId: experiment.id, missionId: experiment.missionId,
        title: experiment.name, signal: experiment.hypothesis,
        expectedEffect: `观察 ${experiment.primaryMetric} 并满足守护栏`, status: experiment.status,
        source: 'mission-domain', actorId: 'desktop-operator',
      }, createdAt);
      return clone(experiment);
    },
    async updateExperiment(context, input) {
      const state = stateFor(context);
      const current = experimentFor(state, input.id);
      assertExperimentRevision(current.revision, input.expectedRevision);
      if (!['draft', 'paused'].includes(current.status)) throw new Error('只有草稿或已暂停 Experiment 可以编辑。');
      const updated: ExperimentRecord = {
        ...current,
        ...input.patch,
        productId: input.patch.productId === undefined ? current.productId : input.patch.productId ?? undefined,
        adEntityId: input.patch.adEntityId === undefined ? current.adEntityId : input.patch.adEntityId ?? undefined,
        guardrailMetrics: input.patch.guardrailMetrics ? [...input.patch.guardrailMetrics] : current.guardrailMetrics,
        guardrailCriteria: input.patch.guardrailCriteria ? [...input.patch.guardrailCriteria] : current.guardrailCriteria,
        baseline: input.patch.baseline === undefined ? current.baseline : clone(input.patch.baseline),
        variant: input.patch.variant === undefined ? current.variant : clone(input.patch.variant),
        conclusion: input.patch.conclusion === undefined ? current.conclusion : input.patch.conclusion ?? undefined,
        revision: current.revision + 1,
        updatedAt: nowAfter(current.updatedAt),
      };
      assertExperimentWindow(updated.observationStartsAt, updated.observationEndsAt);
      const saved = replaceExperiment(state, updated);
      appendCausal(context, state, {
        id: `causal:experiment:${updated.id}:r${updated.revision}`, stage: 'ANALYSIS', eventType: 'experiment_updated',
        entityType: 'experiment', entityId: updated.id, missionId: updated.missionId, title: updated.name,
        signal: updated.hypothesis, expectedEffect: `观察 ${updated.primaryMetric} 并满足守护栏`,
        status: updated.status, source: 'mission-domain', actorId: input.actorId,
      }, updated.updatedAt);
      return saved;
    },
    async transitionExperiment(context, input) {
      const state = stateFor(context);
      const current = experimentFor(state, input.id);
      assertExperimentRevision(current.revision, input.expectedRevision);
      if (input.status === 'completed') {
        throw new Error('经营实验只能由系统根据指标判定；人工文字不能直接完成实验。');
      }
      if (!allowedExperimentTransition(current.status, input.status)) {
        throw new Error(`Experiment 不允许从 ${current.status} 转换到 ${input.status}。`);
      }
      const updated: ExperimentRecord = {
        ...current,
        status: input.status,
        revision: current.revision + 1,
        updatedAt: nowAfter(current.updatedAt),
      };
      const saved = replaceExperiment(state, updated);
      appendCausal(context, state, {
        id: `causal:experiment:${updated.id}:r${updated.revision}`,
        stage: 'ANALYSIS',
        eventType: `experiment_${input.status}`, entityType: 'experiment', entityId: updated.id,
        missionId: updated.missionId, title: updated.name,
        status: updated.status, source: 'mission-domain', actorId: input.actorId,
      }, updated.updatedAt);
      return saved;
    },
    async evaluateExperiment(context, input) {
      const state = stateFor(context);
      const current = experimentFor(state, input.id);
      assertExperimentRevision(current.revision, input.expectedRevision);
      if (!['running', 'paused'].includes(current.status)) {
        throw new Error('只有观察中或已暂停的经营实验可以由系统判定。');
      }
      const updatedAt = nowAfter(current.updatedAt);
      const updated: ExperimentRecord = {
        ...current,
        status: 'completed',
        conclusion: `系统已根据指标快照完成判定：${current.primaryMetric} 达到预期，守护栏未触发。`,
        revision: current.revision + 1,
        updatedAt,
      };
      const saved = replaceExperiment(state, updated);
      appendCausal(context, state, {
        id: `causal:experiment:${updated.id}:r${updated.revision}`,
        stage: 'EFFECT', eventType: 'experiment_completed', entityType: 'experiment', entityId: updated.id,
        missionId: updated.missionId, title: updated.name, observedEffect: updated.conclusion,
        status: updated.status, source: 'preview-metric-evaluator', actorId: 'experiment-evaluator',
      }, updatedAt);
      return saved;
    },
    async archiveExperiment(context, input) {
      const state = stateFor(context);
      const current = experimentFor(state, input.id);
      assertExperimentRevision(current.revision, input.expectedRevision);
      if (current.status === 'running') throw new Error('运行中的 Experiment 必须先暂停后归档。');
      if (current.status === 'archived') throw new Error('Experiment 已归档。');
      const updatedAt = nowAfter(current.updatedAt);
      return replaceExperiment(state, {
        ...current, status: 'archived', archivedAt: updatedAt,
        revision: current.revision + 1, updatedAt,
      });
    },
    async restoreExperiment(context, input) {
      const state = stateFor(context);
      const current = experimentFor(state, input.id);
      assertExperimentRevision(current.revision, input.expectedRevision);
      if (current.status !== 'archived') throw new Error('只有已归档 Experiment 可以恢复。');
      return replaceExperiment(state, {
        ...current, status: 'paused', archivedAt: undefined,
        revision: current.revision + 1, updatedAt: nowAfter(current.updatedAt),
      });
    },
    async appendExperimentObservation(context, input) {
      const state = stateFor(context);
      const experiment = experimentFor(state, input.experimentId);
      if (experiment.status === 'archived') throw new Error('已归档 Experiment 不能追加观察。');
      if (!input.id.trim() || !input.title.trim() || !input.observation.trim()) {
        throw new Error('观察记录 ID、标题和内容不能为空。');
      }
      if (state.observations.some((item) => item.id === input.id)) throw new Error('观察记录 ID 已存在。');
      if (input.observationType === 'correction' && !input.correctsRecordId) {
        throw new Error('修正记录必须引用被修正的观察记录。');
      }
      if (input.observationType !== 'correction' && input.correctsRecordId) {
        throw new Error('只有修正记录可以引用 correctsRecordId。');
      }
      if (input.correctsRecordId && !state.observations.some((item) => item.id === input.correctsRecordId
        && item.experimentId === experiment.id)) {
        throw new Error('被修正记录不存在或不属于当前 Experiment。');
      }
      const createdAt = nowAfter();
      const record: ExperimentObservationRecord = {
        ...input,
        storeId: context.storeId,
        actorId: 'desktop-operator',
        createdAt,
      };
      state.observations.push(record);
      appendCausal(context, state, {
        id: `causal:experiment-record:${record.id}`,
        stage: record.observationType === 'result' ? 'EFFECT' : 'FACT',
        eventType: `experiment_${record.observationType}`,
        entityType: 'experiment_record', entityId: record.id, missionId: experiment.missionId,
        title: record.title, signal: record.observation,
        ...(record.observationType === 'result' ? { observedEffect: record.observation } : {}),
        status: 'recorded', source: 'experiment', actorId: record.actorId,
      }, createdAt);
      return clone(record);
    },
    async listExperimentObservations(context, experimentId) {
      const state = stateFor(context);
      experimentFor(state, experimentId);
      return clone(state.observations
        .filter((item) => item.experimentId === experimentId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    },
    async listExperimentMetricSnapshots(context, experimentId) {
      const state = stateFor(context);
      experimentFor(state, experimentId);
      return clone(state.metricSnapshots
        .filter((item) => item.experimentId === experimentId)
        .sort((left, right) => right.observedAt.localeCompare(left.observedAt)));
    },
    listCausalEvents: listEvents,
  };

  const memory: MemoryDomainRendererApi = {
    listCausalEvents: listEvents,
    async exportCausalTimeline(context, input = {}) {
      return createCausalTimelineExport(context, await listEvents(context, input), []);
    },
    async appendManualCausalEvent(context, input) {
      const state = stateFor(context);
      if (!['FACT', 'ANALYSIS'].includes(input.stage)) {
        throw new Error('Renderer 只能追加 FACT 或 ANALYSIS；DECISION/ACTION/READBACK/EFFECT 保持 Main-only。');
      }
      if (!input.id.trim() || !input.title.trim() || !input.entityType.trim() || !input.entityId.trim()) {
        throw new Error('因果事件 ID、标题与对象不能为空。');
      }
      return appendCausal(context, state, {
        ...input,
        source: 'mission-domain-ui',
        actorId: 'desktop-operator',
      });
    },
  };
  return { experiments, memory };
}



export function createPreviewExperimentDomainApi(): ExperimentDomainRendererApi {
  return createPreviewExperimentMemoryDomainSuite().experiments;
}



export function createPreviewMemoryDomainApi(): MemoryDomainRendererApi {
  return createPreviewExperimentMemoryDomainSuite().memory;
}
