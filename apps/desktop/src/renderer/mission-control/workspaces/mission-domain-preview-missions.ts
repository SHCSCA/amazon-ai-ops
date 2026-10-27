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
import { type PreviewStoreState, type MissionDomainRendererApi } from './mission-domain-contracts';
import { assertMissionAuthorityContext } from './mission-domain-context';
import { stableSuffix, clone, nowAfter, assertRevision } from './mission-domain-preview-values';



export function seedPreviewStore(context: StoreContextEnvelope): PreviewStoreState {
  assertMissionAuthorityContext(context);
  const contextKey = missionControlContextKey(context);
  const identity = `${context.storeId} ${context.browserProfileId}`.toLowerCase();
  const shc002 = identity.includes('shc002');
  const known = shc002 || identity.includes('shc001') || identity.includes('store-one');
  const suffix = shc002 ? 'SHC002' : known ? 'SHC001' : stableSuffix(String(context.storeId));
  const asin = shc002 ? 'B0SHC00201' : known ? 'B0GTTJFQTM' : `B0${suffix.padStart(8, '0').slice(-8)}`;
  const dataBatchId = `BATCH-${suffix}-0722`;
  const policyVersionId = `POL-${suffix}-US-V${shc002 ? 2 : 3}`;
  const titles = shc002
    ? [
        '压低车库门开关高花费并守住转化',
        '验证车库门开关宽泛词搜索质量',
        '稳定车库门开关品牌词预算',
        '复核车库门开关商品投放浪费',
        '建立车库门开关否定词基线',
        '观察车库门开关 Listing 转化',
        '控制车库门开关 CPC 波动',
      ]
    : [
        '稳定智能门锁核心搜索词花费并守住订单效率',
        '验证智能门锁高花费词降价空间',
        '保护智能门锁品牌词转化',
        '收敛智能门锁商品投放浪费',
        '建立智能门锁否定词基线',
        '观察智能门锁 Listing 转化',
        '控制智能门锁 CPC 波动',
      ];
  const createdAt = '2026-07-22T01:00:00.000Z';
  const missions = titles.map((title, index): MissionRecord => ({
    id: `MISSION-${suffix}-${String(index + 1).padStart(3, '0')}`,
    storeId: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    businessDate: context.businessDate,
    createdSessionGeneration: context.sessionGeneration,
    dataBatchId,
    policyVersionId,
    title,
    objective: index === 0
      ? `在 7 个业务日内改善 ${asin} 的广告效率，同时守住订单量。`
      : `验证 ${asin} 的独立经营假设并保留完整证据链。`,
    status: index === 0 ? 'active' : index === 1 ? 'paused' : index === 6 ? 'archived' : 'draft',
    phase: index === 0 ? 'decision' : index === 1 ? 'analysis' : 'fact',
    priority: index === 0 ? 'P1' : index < 3 ? 'P2' : 'P3',
    productId: asin,
    observationStartsAt: '2026-07-22T07:00:00.000Z',
    observationEndsAt: '2026-07-29T07:00:00.000Z',
    successCriteria: ['ACOS 改善 ≥ 10%', '广告订单下降 < 15%'],
    guardrails: ['单次竞价变化 ≤ 15%', 'UNKNOWN 立即停止并人工对账'],
    revision: 1,
    createdAt,
    updatedAt: new Date(Date.parse(createdAt) + index * 1_000).toISOString(),
    ...(index === 6 ? { archivedAt: '2026-07-22T02:00:00.000Z' } : {}),
  }));
  const first = missions[0];
  const stages = ['FACT', 'ANALYSIS', 'DECISION', 'ACTION', 'READBACK', 'EFFECT'] as const;
  const checkpointTitles = [
    '领星报表已采集',
    '数据口径已校验',
    '等待 Crux 决策',
    '执行与回读',
    'Reload 结果校验',
    '观察窗口效果',
  ];
  const checkpoints = stages.map((stage, index): MissionCheckpointRecord => ({
    id: `CHECKPOINT-${suffix}-${stage}`,
    storeId: context.storeId,
    missionId: first.id,
    stage,
    title: checkpointTitles[index],
    status: index < 2 ? 'completed' : index === 2 ? 'active' : 'pending',
    evidenceCount: index < 2 ? (index + 1) * 4 : 0,
    actorId: index < 2 ? 'preview-agent' : 'preview-system',
    createdAt: new Date(Date.parse(createdAt) + index * 60_000).toISOString(),
  }));
  const links: MissionLinkRecord[] = [
    {
      id: `LINK-${suffix}-DATA`, storeId: context.storeId, missionId: first.id,
      linkType: 'data_batch', targetId: dataBatchId, relation: 'source',
      createdAt, actorId: 'preview-agent',
    },
    {
      id: `LINK-${suffix}-POLICY`, storeId: context.storeId, missionId: first.id,
      linkType: 'policy_version', targetId: policyVersionId, relation: 'governed_by',
      createdAt, actorId: 'preview-agent',
    },
    {
      id: `LINK-${suffix}-PRODUCT`, storeId: context.storeId, missionId: first.id,
      linkType: 'product', targetId: asin, relation: 'scoped_to',
      createdAt, actorId: 'preview-agent',
    },
  ];
  return { authorityKey: contextKey, missions, checkpoints, links };
}



export function validateMissionInput(input: CreateMissionInput): void {
  if (!input.id.trim() || !input.title.trim() || !input.objective.trim()) {
    throw new Error('Mission ID、标题和经营目标不能为空。');
  }
  if (!input.dataBatchId.trim() || !input.policyVersionId.trim()) {
    throw new Error('Mission 必须绑定数据批次和策略版本。');
  }
  if (!input.successCriteria.length || !input.guardrails.length) {
    throw new Error('Mission 必须至少包含一条成功标准和一条守护栏。');
  }
  if (Date.parse(input.observationStartsAt) >= Date.parse(input.observationEndsAt)) {
    throw new Error('Mission 观察窗口结束时间必须晚于开始时间。');
  }
}



export function createPreviewMissionDomainApi(): MissionDomainRendererApi {
  const stores = new Map<string, PreviewStoreState>();

  const stateFor = (context: StoreContextEnvelope): PreviewStoreState => {
    assertMissionAuthorityContext(context);
    const key = String(context.storeId);
    const current = stores.get(key);
    const authorityKey = missionControlContextKey(context);
    if (current && current.authorityKey === authorityKey) return current;
    const seeded = seedPreviewStore(context);
    stores.set(key, seeded);
    return seeded;
  };

  const missionFor = (state: PreviewStoreState, id: string): MissionRecord => {
    const mission = state.missions.find((candidate) => candidate.id === id);
    if (!mission) throw new Error('Mission 不存在或不属于当前店铺。');
    return mission;
  };

  const replaceMission = (state: PreviewStoreState, mission: MissionRecord): MissionRecord => {
    state.missions = state.missions.map((current) => current.id === mission.id ? mission : current);
    return clone(mission);
  };

  return {
    async listMissions(context, input = {}) {
      const state = stateFor(context);
      return clone(state.missions
        .filter((mission) => input.includeArchived || mission.status !== 'archived')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    },
    async getMission(context, missionId) {
      const state = stateFor(context);
      const mission = state.missions.find((item) => item.id === missionId);
      return mission ? clone(mission) : undefined;
    },
    async createMission(context, input) {
      validateMissionInput(input);
      const state = stateFor(context);
      if (state.missions.some((mission) => mission.id === input.id)) {
        throw new Error('Mission ID 已存在，创建已阻断。');
      }
      const timestamp = nowAfter();
      const mission: MissionRecord = {
        id: input.id,
        storeId: context.storeId,
        marketplace: 'US',
        currency: 'USD',
        businessDate: context.businessDate,
        createdSessionGeneration: context.sessionGeneration,
        dataBatchId: input.dataBatchId,
        policyVersionId: input.policyVersionId,
        title: input.title.trim(),
        objective: input.objective.trim(),
        status: 'draft',
        phase: 'fact',
        priority: input.priority ?? 'P2',
        ...(input.productId ? { productId: input.productId } : {}),
        observationStartsAt: input.observationStartsAt,
        observationEndsAt: input.observationEndsAt,
        successCriteria: [...input.successCriteria],
        guardrails: [...input.guardrails],
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.missions.unshift(mission);
      state.links.push(
        { id: `${mission.id}:data`, storeId: context.storeId, missionId: mission.id, linkType: 'data_batch', targetId: mission.dataBatchId, relation: 'source', createdAt: timestamp, actorId: input.actorId },
        { id: `${mission.id}:policy`, storeId: context.storeId, missionId: mission.id, linkType: 'policy_version', targetId: mission.policyVersionId, relation: 'governed_by', createdAt: timestamp, actorId: input.actorId },
      );
      if (mission.productId) state.links.push({ id: `${mission.id}:product`, storeId: context.storeId, missionId: mission.id, linkType: 'product', targetId: mission.productId, relation: 'scoped_to', createdAt: timestamp, actorId: input.actorId });
      return clone(mission);
    },
    async updateMission(context, input) {
      const state = stateFor(context);
      const current = missionFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status === 'archived' || current.status === 'completed') {
        throw new Error('已归档或已完成 Mission 不能编辑。');
      }
      const patch = input.patch;
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
        throw new Error(`Mission 修改包含不支持的字段：${unknownPatchKeys.join('、')}。`);
      }
      const authorityPatchKeys = Object.keys(patch).filter((key) => key !== 'title');
      if (authorityPatchKeys.length > 0
        && ['decision', 'action', 'readback', 'effect'].includes(current.phase)) {
        throw new Error('运营任务进入决策阶段后经营定义已锁定；只能重命名标题，如需改变范围或目标，请重新创建任务。');
      }
      const updated: MissionRecord = {
        ...current,
        ...patch,
        productId: patch.productId === undefined ? current.productId : patch.productId ?? undefined,
        title: patch.title?.trim() || current.title,
        objective: patch.objective?.trim() || current.objective,
        successCriteria: patch.successCriteria ? [...patch.successCriteria] : current.successCriteria,
        guardrails: patch.guardrails ? [...patch.guardrails] : current.guardrails,
        revision: current.revision + 1,
        updatedAt: nowAfter(current.updatedAt),
      };
      if (Date.parse(updated.observationStartsAt) >= Date.parse(updated.observationEndsAt)) {
        throw new Error('Mission 观察窗口结束时间必须晚于开始时间。');
      }
      return replaceMission(state, updated);
    },
    async transitionMission(context, input) {
      const state = stateFor(context);
      const current = missionFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status === 'archived' || current.status === 'completed') {
        throw new Error('已归档或已完成 Mission 不能改变运行状态。');
      }
      const phase = input.phase ?? current.phase;
      const phaseSequence: readonly MissionPhase[] = ['fact', 'analysis', 'decision', 'action', 'readback', 'effect'];
      if (phaseSequence.indexOf(phase) < phaseSequence.indexOf(current.phase)) {
        throw new Error('运营任务阶段不能回退；如需改变已绑定的经营定义，请重新创建任务。');
      }
      return replaceMission(state, {
        ...current,
        status: input.status,
        phase,
        revision: current.revision + 1,
        updatedAt: nowAfter(current.updatedAt),
      });
    },
    async archiveMission(context, input) {
      const state = stateFor(context);
      const current = missionFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status === 'archived') throw new Error('Mission 已归档。');
      const updatedAt = nowAfter(current.updatedAt);
      return replaceMission(state, { ...current, status: 'archived', archivedAt: updatedAt, revision: current.revision + 1, updatedAt });
    },
    async restoreMission(context, input) {
      const state = stateFor(context);
      const current = missionFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status !== 'archived') throw new Error('只有已归档 Mission 可以恢复。');
      return replaceMission(state, { ...current, status: 'paused', archivedAt: undefined, revision: current.revision + 1, updatedAt: nowAfter(current.updatedAt) });
    },
    async appendMissionCheckpoint(context, input) {
      const state = stateFor(context);
      missionFor(state, input.missionId);
      if (state.checkpoints.some((checkpoint) => checkpoint.id === input.id)) {
        throw new Error('检查点 ID 已存在，写入已阻断。');
      }
      const checkpoint: MissionCheckpointRecord = {
        ...input,
        storeId: context.storeId,
        createdAt: nowAfter(),
      };
      state.checkpoints.push(checkpoint);
      return clone(checkpoint);
    },
    async getMissionLineage(context, missionId) {
      const state = stateFor(context);
      const mission = missionFor(state, missionId);
      return clone({
        mission,
        checkpoints: state.checkpoints.filter((checkpoint) => checkpoint.missionId === missionId),
        links: state.links.filter((link) => link.missionId === missionId),
        causalEvents: [],
      });
    },
  };
}
