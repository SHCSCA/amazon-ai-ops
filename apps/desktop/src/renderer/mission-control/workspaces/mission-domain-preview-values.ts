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




export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}



export function nowAfter(previous?: string): string {
  const current = Date.now();
  const floor = previous ? Date.parse(previous) + 1 : 0;
  return new Date(Math.max(current, Number.isFinite(floor) ? floor : 0)).toISOString();
}



export function stableSuffix(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-7);
}



export function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`Mission 版本冲突：当前 revision=${actual}，提交 revision=${expected}；请刷新后重试。`);
  }
}



export function previewIdentity(context: StoreContextEnvelope): { suffix: string; asin: string; subject: string } {
  const identity = `${context.storeId} ${context.browserProfileId}`.toLowerCase();
  const second = identity.includes('shc002');
  const known = second || identity.includes('shc001') || identity.includes('store-one');
  const suffix = second ? 'SHC002' : known ? 'SHC001' : stableSuffix(String(context.storeId));
  return {
    suffix,
    asin: second ? 'B0SHC00201' : known ? 'B0GTTJFQTM' : `B0${suffix.padStart(8, '0').slice(-8)}`,
    subject: second ? '车库门开关' : '智能门锁',
  };
}
