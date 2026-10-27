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
import { type PreviewPolicyState, type PolicyDomainRendererApi } from './mission-domain-contracts';
import { assertMissionAuthorityContext } from './mission-domain-context';
import { previewIdentity, clone, nowAfter, assertRevision } from './mission-domain-preview-values';



export function defaultPreviewRules(entityId: string, maxChangePct = 10): PolicyVersionRules {
  return {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: [entityId],
    maxChangePct,
    totalImpactBudget: 50,
    maxDailyActionCount: 100,
    cooldownMinutes: 0,
    executionWindow: {
      timeZone: 'America/Los_Angeles',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      start: '00:00',
      end: '23:59',
    },
    requiredEvidence: ['before_screenshot', 'after_screenshot', 'reload_screenshot', 'page_identity', 'readback_value'],
    stopConditions: [
      { code: 'identity_drift', detail: '店铺或对象身份漂移立即停止。' },
      { code: 'expected_before_mismatch', detail: 'Before 值不一致时拒绝写入。' },
      { code: 'unknown_result', detail: 'UNKNOWN 不自动重试。' },
      { code: 'data_stale', detail: '数据过期时转人工复核。' },
      { code: 'impact_budget_exhausted', detail: '影响额度耗尽时停止。' },
      { code: 'kill_switch', detail: '紧急停止开启时拒绝执行。' },
    ],
    killSwitch: false,
  };
}



export function seedPreviewPolicies(context: StoreContextEnvelope): PreviewPolicyState {
  assertMissionAuthorityContext(context);
  const { suffix } = previewIdentity(context);
  const createdAt = '2026-07-22T00:30:00.000Z';
  const activeVersionId = `POL-${suffix}-US-V${suffix === 'SHC002' ? 2 : 3}`;
  const policyIds = [`POLICY-${suffix}-BID`, `POLICY-${suffix}-DATA`, `POLICY-${suffix}-TEST`];
  const policies: PolicyRecord[] = [
    { id: policyIds[0], storeId: context.storeId, name: '关键词竞价安全边界', scope: 'store', status: 'active', priority: 10, activeVersionId, revision: 2, createdAt, updatedAt: createdAt },
    { id: policyIds[1], storeId: context.storeId, name: '领星数据新鲜度门', scope: 'data', status: 'disabled', priority: 20, revision: 1, createdAt, updatedAt: createdAt },
    { id: policyIds[2], storeId: context.storeId, name: '核心词小步验证边界', scope: 'product', status: 'draft', priority: 30, revision: 1, createdAt, updatedAt: createdAt },
  ];
  const versions: PolicyVersionRecord[] = [
    { id: activeVersionId, storeId: context.storeId, policyId: policyIds[0], version: suffix === 'SHC002' ? 2 : 3, status: 'enabled', rules: defaultPreviewRules(`KW-${suffix}-001`), revision: 1, createdAt, updatedAt: createdAt, enabledAt: createdAt },
    { id: `POL-${suffix}-US-V1`, storeId: context.storeId, policyId: policyIds[0], version: 1, status: 'retired', rules: defaultPreviewRules(`KW-${suffix}-001`, 10), revision: 1, createdAt, updatedAt: createdAt, retiredAt: createdAt },
    { id: `POL-${suffix}-DATA-V1`, storeId: context.storeId, policyId: policyIds[1], version: 1, status: 'draft', rules: defaultPreviewRules(`KW-${suffix}-001`, 5), revision: 1, createdAt, updatedAt: createdAt },
  ];
  return {
    authorityKey: missionControlContextKey(context), policies, versions,
    runtime: { mode: 'manual_approval', killSwitch: false, circuitBreakerState: 'closed', activePolicyVersionId: activeVersionId, revision: 1, canAutoExecute: true, status: 'APPLIED' },
  };
}



export function createPreviewPolicyDomainApi(): PolicyDomainRendererApi {
  const stores = new Map<string, PreviewPolicyState>();
  const stateFor = (context: StoreContextEnvelope): PreviewPolicyState => {
    assertMissionAuthorityContext(context);
    const key = String(context.storeId);
    const current = stores.get(key);
    const authorityKey = missionControlContextKey(context);
    if (current?.authorityKey === authorityKey) return current;
    const seeded = seedPreviewPolicies(context);
    stores.set(key, seeded);
    return seeded;
  };
  const policyFor = (state: PreviewPolicyState, id: string): PolicyRecord => {
    const policy = state.policies.find((item) => item.id === id);
    if (!policy) throw new Error('Policy 不存在或不属于当前店铺。');
    return policy;
  };
  const versionFor = (state: PreviewPolicyState, id: string): PolicyVersionRecord => {
    const version = state.versions.find((item) => item.id === id);
    if (!version) throw new Error('Policy 版本不存在或不属于当前店铺。');
    return version;
  };
  const replacePolicy = (state: PreviewPolicyState, policy: PolicyRecord) => {
    state.policies = state.policies.map((item) => item.id === policy.id ? policy : item);
    return clone(policy);
  };
  const replaceVersion = (state: PreviewPolicyState, version: PolicyVersionRecord) => {
    state.versions = state.versions.map((item) => item.id === version.id ? version : item);
    return clone(version);
  };
  return {
    async listPolicies(context, input = {}) {
      return clone(stateFor(context).policies
        .filter((policy) => input.includeArchived || policy.status !== 'archived')
        .sort((left, right) => left.priority - right.priority));
    },
    async createPolicy(context, input) {
      const state = stateFor(context);
      if (state.policies.some((item) => item.id === input.id)) throw new Error('Policy ID 已存在。');
      if (!input.name.trim() || !input.scope.trim()) throw new Error('Policy 名称和作用范围不能为空。');
      const timestamp = nowAfter();
      const policy: PolicyRecord = { id: input.id, storeId: context.storeId, name: input.name.trim(), scope: input.scope.trim(), status: 'draft', priority: input.priority, revision: 1, createdAt: timestamp, updatedAt: timestamp };
      state.policies.push(policy);
      return clone(policy);
    },
    async updatePolicy(context, input) {
      const state = stateFor(context);
      const current = policyFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status === 'archived') throw new Error('已归档 Policy 不能编辑。');
      return replacePolicy(state, { ...current, ...input.patch, revision: current.revision + 1, updatedAt: nowAfter(current.updatedAt) });
    },
    async disablePolicy(context, input) {
      const state = stateFor(context);
      const current = policyFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status === 'archived') throw new Error('已归档 Policy 必须先恢复。');
      if (current.activeVersionId) {
        state.versions = state.versions.map((version) => version.id === current.activeVersionId ? { ...version, status: 'retired', retiredAt: nowAfter(version.updatedAt), updatedAt: nowAfter(version.updatedAt) } : version);
        if (state.runtime.activePolicyVersionId === current.activeVersionId) {
          state.runtime = { ...state.runtime, mode: 'manual_approval', activePolicyVersionId: undefined, revision: state.runtime.revision + 1, canAutoExecute: false };
        }
      }
      return replacePolicy(state, { ...current, status: 'disabled', activeVersionId: undefined, revision: current.revision + 1, updatedAt: nowAfter(current.updatedAt) });
    },
    async archivePolicy(context, input) {
      const state = stateFor(context);
      const current = policyFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status === 'active' || current.activeVersionId) throw new Error('Policy 必须先停用再归档。');
      const updatedAt = nowAfter(current.updatedAt);
      return replacePolicy(state, { ...current, status: 'archived', archivedAt: updatedAt, revision: current.revision + 1, updatedAt });
    },
    async restorePolicy(context, input) {
      const state = stateFor(context);
      const current = policyFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status !== 'archived') throw new Error('只有已归档 Policy 可以恢复。');
      return replacePolicy(state, { ...current, status: 'disabled', archivedAt: undefined, revision: current.revision + 1, updatedAt: nowAfter(current.updatedAt) });
    },
    async listPolicyVersions(context, policyId) {
      const state = stateFor(context);
      policyFor(state, policyId);
      return clone(state.versions.filter((version) => version.policyId === policyId).sort((left, right) => right.version - left.version));
    },
    async createPolicyVersion(context, input) {
      const state = stateFor(context);
      const policy = policyFor(state, input.policyId);
      if (policy.status === 'archived') throw new Error('已归档 Policy 不能新建版本。');
      if (state.versions.some((item) => item.id === input.id || (item.policyId === input.policyId && item.version === input.version))) throw new Error('Policy 版本已存在。');
      const timestamp = nowAfter();
      const version: PolicyVersionRecord = { id: input.id, storeId: context.storeId, policyId: input.policyId, version: input.version, status: 'draft', rules: clone(input.rules), ...(input.validFrom ? { validFrom: input.validFrom } : {}), ...(input.validUntil ? { validUntil: input.validUntil } : {}), revision: 1, createdAt: timestamp, updatedAt: timestamp };
      state.versions.push(version);
      return clone(version);
    },
    async updateDraftPolicyVersion(context, input) {
      const state = stateFor(context);
      const current = versionFor(state, input.id);
      assertRevision(current.revision, input.expectedRevision);
      if (current.status !== 'draft') throw new Error('启用或退役版本不可变；请新建草稿版本。');
      return replaceVersion(state, { ...current, rules: input.rules ? clone(input.rules) : current.rules, validFrom: input.validFrom === undefined ? current.validFrom : input.validFrom ?? undefined, validUntil: input.validUntil === undefined ? current.validUntil : input.validUntil ?? undefined, revision: current.revision + 1, updatedAt: nowAfter(current.updatedAt) });
    },
    async enablePolicyVersion(context, input) {
      const state = stateFor(context);
      const policy = policyFor(state, input.policyId);
      const version = versionFor(state, input.versionId);
      assertRevision(policy.revision, input.expectedPolicyRevision);
      assertRevision(version.revision, input.expectedVersionRevision);
      if (version.policyId !== policy.id || version.status !== 'draft') throw new Error('只能启用当前 Policy 的草稿版本。');
      const timestamp = nowAfter(version.updatedAt);
      state.versions = state.versions.map((item) => item.policyId === policy.id && item.status === 'enabled' ? { ...item, status: 'retired', retiredAt: timestamp, updatedAt: timestamp } : item);
      const enabled = { ...version, status: 'enabled' as const, enabledAt: timestamp, updatedAt: timestamp };
      replaceVersion(state, enabled);
      replacePolicy(state, { ...policy, status: 'active', activeVersionId: enabled.id, revision: policy.revision + 1, updatedAt: timestamp });
      state.runtime = { ...state.runtime, activePolicyVersionId: enabled.id, revision: state.runtime.revision + 1, canAutoExecute: !state.runtime.killSwitch && state.runtime.circuitBreakerState === 'closed' };
      return clone(enabled);
    },
    async getPolicyRuntime(context) {
      return clone(stateFor(context).runtime);
    },
    async setAutonomyMode(context, input) {
      const state = stateFor(context);
      assertRevision(state.runtime.revision, input.expectedRevision);
      if (input.mode === 'policy_auto' && (!state.runtime.activePolicyVersionId || state.runtime.killSwitch || state.runtime.circuitBreakerState !== 'closed')) {
        throw new Error('策略内自动要求已启用版本、紧急停止关闭且熔断器闭合。');
      }
      state.runtime = { ...state.runtime, mode: input.mode, revision: state.runtime.revision + 1, canAutoExecute: !state.runtime.killSwitch && state.runtime.circuitBreakerState === 'closed' && Boolean(state.runtime.activePolicyVersionId) };
      return clone(state.runtime);
    },
    async setKillSwitch(context, input) {
      const state = stateFor(context);
      assertRevision(state.runtime.revision, input.expectedRevision);
      if (!input.enabled && !input.reason?.trim()) {
        throw new Error('解除紧急停止必须填写明确的人工复核原因。');
      }
      state.runtime = { ...state.runtime, killSwitch: input.enabled, mode: input.enabled ? 'manual_approval' : state.runtime.mode, revision: state.runtime.revision + 1, canAutoExecute: !input.enabled && state.runtime.circuitBreakerState === 'closed' && Boolean(state.runtime.activePolicyVersionId) };
      return clone(state.runtime);
    },
  };
}
