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




export function assertMissionAuthorityContext(context: StoreContextEnvelope): void {
  if (context.marketplace !== 'US' || context.currency !== 'USD') {
    throw new Error('Mission V1 仅支持 Amazon 美国站与 USD；当前上下文已失败关闭。');
  }
  if (!String(context.storeId).trim() || !String(context.browserProfileId).trim()) {
    throw new Error('Mission 缺少可验证的店铺或浏览器 Profile，已失败关闭。');
  }
}



export function assertMissionBelongsToContext(
  mission: MissionRecord,
  context: StoreContextEnvelope,
): void {
  assertMissionAuthorityContext(context);
  if (String(mission.storeId) !== String(context.storeId)
    || mission.marketplace !== 'US'
    || mission.currency !== 'USD') {
    throw new Error('Main 返回了不属于当前美国站店铺的数据，已拒绝显示。');
  }
}



export function assertDecisionBelongsToContext(
  decision: DecisionRecord,
  context: StoreContextEnvelope,
): void {
  assertMissionAuthorityContext(context);
  if (String(decision.storeId) !== String(context.storeId)) {
    throw new Error('Main 返回了不属于当前美国站店铺的 Decision，已拒绝显示。');
  }
}



export function assertPolicyBelongsToContext(
  policy: Pick<PolicyRecord | PolicyVersionRecord, 'storeId'>,
  context: StoreContextEnvelope,
): void {
  assertMissionAuthorityContext(context);
  if (String(policy.storeId) !== String(context.storeId)) {
    throw new Error('Main 返回了不属于当前美国站店铺的 Policy，已拒绝显示。');
  }
}



export function assertExperimentBelongsToContext(
  experiment: Pick<ExperimentRecord, 'storeId'>,
  context: StoreContextEnvelope,
): void {
  assertMissionAuthorityContext(context);
  if (String(experiment.storeId) !== String(context.storeId)) {
    throw new Error('Main 返回了不属于当前美国站店铺的 Experiment，已拒绝显示。');
  }
}



export function assertCausalEventBelongsToContext(
  event: Pick<CausalEventRecord, 'storeId'>,
  context: StoreContextEnvelope,
): void {
  assertMissionAuthorityContext(context);
  if (String(event.storeId) !== String(context.storeId)) {
    throw new Error('Main 返回了不属于当前美国站店铺的因果事件，已拒绝显示。');
  }
}
