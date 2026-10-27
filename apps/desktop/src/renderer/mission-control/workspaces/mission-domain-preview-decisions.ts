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
import { type PreviewDecisionState, type DecisionDomainRendererApi } from './mission-domain-contracts';
import { assertMissionAuthorityContext } from './mission-domain-context';
import { previewIdentity, clone, nowAfter, assertRevision } from './mission-domain-preview-values';



export function seedPreviewDecisions(context: StoreContextEnvelope): PreviewDecisionState {
  assertMissionAuthorityContext(context);
  const { suffix, asin, subject } = previewIdentity(context);
  const createdAt = '2026-07-22T02:00:00.000Z';
  const statuses: DecisionStatus[] = [
    'needs_approval', 'proposed', 'approved', 'approved', 'rejected', 'blocked', 'verified',
  ];
  const decisions = statuses.map((status, index): DecisionRecord => ({
    id: `DECISION-${suffix}-${String(index + 1).padStart(3, '0')}`,
    storeId: context.storeId,
    missionId: `MISSION-${suffix}-${String(index === 2 || index === 3 ? 1 : Math.min(index + 1, 7)).padStart(3, '0')}`,
    dataBatchId: `BATCH-${suffix}-0722`,
    policyVersionId: `POL-${suffix}-US-V${suffix === 'SHC002' ? 2 : 3}`,
    policyRevision: 1,
    actionRevision: index === 2 || index === 3 ? 3 : index + 1,
    title: index === 0 ? `${subject}高花费词降价 12%` : `${subject}经营决策 ${index + 1}`,
    rationale: `基于当前店铺已确认的领星广告事实与 ${subject} 转化表现。`,
    recommendation: index === 0 ? '把目标关键词竞价从 $1.20 调整到 $1.06。' : `保留 ${subject} 第 ${index + 1} 条受控建议。`,
    facts: [`过去 7 天花费 $${48 + index * 7}`, `当前 ACOS ${34 + index}%`],
    alternatives: ['保持当前竞价继续观察', '降价 8% 并缩短观察窗'],
    expectedEffect: '预计 7 天内降低无效花费，同时守住订单。',
    validUntil: '2026-07-29T07:00:00.000Z',
    actionType: 'set_keyword_bid',
    adEntityId: `KW-${suffix}-${String(index + 1).padStart(3, '0')}`,
    productId: asin,
    currentValue: Number((1.2 + index * 0.05).toFixed(2)),
    recommendedValue: Number((1.06 + index * 0.04).toFixed(2)),
    confidence: Math.max(0.61, 0.88 - index * 0.04),
    status,
    revision: 1,
    createdAt,
    updatedAt: new Date(Date.parse(createdAt) + index * 1_000).toISOString(),
  }));
  const history = decisions.map((decision): DecisionHistoryRecord => ({
    id: `HISTORY-${decision.id}-CREATED`,
    storeId: context.storeId,
    decisionId: decision.id,
    decisionRevision: decision.revision,
    eventType: 'created',
    actorId: 'preview-agent',
    snapshot: clone(decision),
    createdAt: decision.createdAt,
  }));
  const approvedBatch = decisions.filter((decision) => decision.status === 'approved');
  const approved = approvedBatch[0];
  const grants: MissionGrantRecord[] = [{
    id: `GRANT-${suffix}-HUMAN-001`,
    storeId: context.storeId,
    marketplace: 'US',
    currency: 'USD',
    missionId: approved.missionId,
    missionRevision: 1,
    decisionIds: approvedBatch.map((decision) => decision.id),
    actionRevision: approved.actionRevision,
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: approvedBatch.map((decision) => decision.adEntityId!),
    maxChangePct: 10,
    totalImpactBudget: 50,
    expiresAt: '2026-07-29T07:00:00.000Z',
    policyVersionId: approved.policyVersionId,
    policyRevision: approved.policyRevision,
    requiredEvidence: ['before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value'],
    stopConditions: [
      { code: 'identity_drift', detail: '店铺或广告对象身份漂移立即停止。' },
      { code: 'unknown_result', detail: 'UNKNOWN 不自动重试，转人工对账。' },
      { code: 'kill_switch', detail: '紧急停止开启时拒绝执行。' },
    ],
    issuer: { type: 'human', actorId: 'desktop-operator' },
    issuedAt: '2026-07-22T03:00:00.000Z',
    createdSessionGeneration: context.sessionGeneration,
  }];
  const grantEvents: MissionGrantEventRecord[] = grants.map((grant) => ({
    id: `GRANT-EVENT-${grant.id}-ISSUED`, storeId: context.storeId, grantId: grant.id,
    eventType: 'issued', actorId: grant.issuer.actorId, createdAt: grant.issuedAt,
  }));
  return {
    authorityKey: missionControlContextKey(context), decisions, history, grants, grantEvents, revokedGrantIds: new Set(),
  };
}



export function createPreviewDecisionDomainApi(): DecisionDomainRendererApi {
  const stores = new Map<string, PreviewDecisionState>();
  const stateFor = (context: StoreContextEnvelope): PreviewDecisionState => {
    assertMissionAuthorityContext(context);
    const key = String(context.storeId);
    const current = stores.get(key);
    const authorityKey = missionControlContextKey(context);
    if (current?.authorityKey === authorityKey) return current;
    const seeded = seedPreviewDecisions(context);
    stores.set(key, seeded);
    return seeded;
  };
  const decisionFor = (state: PreviewDecisionState, id: string): DecisionRecord => {
    const decision = state.decisions.find((candidate) => candidate.id === id);
    if (!decision) throw new Error('Decision 不存在或不属于当前店铺。');
    return decision;
  };
  const replace = (state: PreviewDecisionState, decision: DecisionRecord): DecisionRecord => {
    state.decisions = state.decisions.map((current) => current.id === decision.id ? decision : current);
    return clone(decision);
  };
  const appendHistory = (
    state: PreviewDecisionState,
    decision: DecisionRecord,
    eventType: DecisionHistoryRecord['eventType'],
    actorId: string,
    reason?: string,
  ) => {
    state.history.push({
      id: `HISTORY-${decision.id}-R${decision.revision}-${eventType}`,
      storeId: decision.storeId,
      decisionId: decision.id,
      decisionRevision: decision.revision,
      eventType,
      actorId,
      ...(reason ? { reason } : {}),
      snapshot: clone(decision),
      createdAt: decision.updatedAt,
    });
  };
  return {
    async listDecisions(context, input = {}) {
      const rows = stateFor(context).decisions.filter((item) => !input.missionId || item.missionId === input.missionId);
      return clone(rows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    },
    async createDecision(context, input) {
      const state = stateFor(context);
      if (state.decisions.some((item) => item.id === input.id)) throw new Error('Decision ID 已存在。');
      if (!input.id.trim() || !input.missionId.trim() || !input.dataBatchId.trim() || !input.policyVersionId.trim()) {
        throw new Error('Decision 必须绑定 Mission、数据批次和策略版本。');
      }
      if (!input.title.trim() || !input.rationale.trim() || !input.recommendation.trim() || !input.facts.length) {
        throw new Error('Decision 标题、理由、建议和事实不能为空。');
      }
      if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new Error('Decision 置信度必须在 0–1 之间。');
      }
      const timestamp = nowAfter();
      const decision: DecisionRecord = {
        ...input,
        storeId: context.storeId,
        status: input.status ?? 'proposed',
        facts: [...input.facts],
        alternatives: [...input.alternatives],
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.decisions.unshift(decision);
      appendHistory(state, decision, 'created', input.actorId);
      return clone(decision);
    },
    async reviseDecision(context, input) {
      const state = stateFor(context);
      const current = decisionFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (!['proposed', 'needs_approval', 'blocked'].includes(current.status)) {
        throw new Error('已决策记录不可覆盖；请新建 Decision。');
      }
      const updated: DecisionRecord = {
        ...current,
        ...input,
        facts: input.facts ? [...input.facts] : current.facts,
        alternatives: input.alternatives ? [...input.alternatives] : current.alternatives,
        expectedEffect: input.expectedEffect === undefined ? current.expectedEffect : input.expectedEffect ?? undefined,
        validUntil: input.validUntil === undefined ? current.validUntil : input.validUntil ?? undefined,
        actionRevision: current.actionRevision + 1,
        revision: current.revision + 1,
        updatedAt: nowAfter(current.updatedAt),
      };
      const saved = replace(state, updated);
      appendHistory(state, updated, 'revised', input.actorId);
      return saved;
    },
    async resolveDecisionHuman(context, input) {
      const state = stateFor(context);
      const current = decisionFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (!['approved', 'rejected', 'blocked', 'superseded'].includes(input.status)) {
        throw new Error('Renderer 只能人工批准、拒绝、阻断或标记被替代。');
      }
      if (!input.reason.trim()) throw new Error('人工决策必须记录原因。');
      const updated = {
        ...current,
        status: input.status,
        revision: current.revision + 1,
        updatedAt: nowAfter(current.updatedAt),
      };
      const saved = replace(state, updated);
      appendHistory(state, updated, input.status, input.actorId, input.reason);
      return saved;
    },
    async getDecisionHistory(context, decisionId) {
      const state = stateFor(context);
      decisionFor(state, decisionId);
      return clone(state.history.filter((item) => item.decisionId === decisionId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    },
    async listHumanGrants(context, missionId) {
      const state = stateFor(context);
      return clone(state.grants.filter((grant) => grant.missionId === missionId
        && grant.issuer.type === 'human'));
    },
    async listHumanGrantEvents(context, missionId) {
      const state = stateFor(context);
      const grantIds = new Set(state.grants.filter((grant) => grant.missionId === missionId).map((grant) => grant.id));
      return clone(state.grantEvents.filter((event) => grantIds.has(event.grantId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    },
    async revokeHumanGrant(context, input) {
      const state = stateFor(context);
      const grant = state.grants.find((item) => item.id === input.grantId);
      if (!grant || grant.issuer.type !== 'human') throw new Error('只能撤销当前店铺的人工授权。');
      if (state.revokedGrantIds.has(grant.id)) throw new Error('人工授权已经撤销。');
      state.revokedGrantIds.add(grant.id);
      const event: MissionGrantEventRecord = {
        id: input.id,
        storeId: context.storeId,
        grantId: grant.id,
        eventType: 'revoked',
        actorId: 'desktop-operator',
        ...(input.reason ? { reason: input.reason } : {}),
        createdAt: nowAfter(),
      };
      state.grantEvents.unshift(event);
      return clone(event);
    },
  };
}
