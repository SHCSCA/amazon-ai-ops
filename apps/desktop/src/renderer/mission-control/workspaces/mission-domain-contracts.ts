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




export type MissionArchiveInput = {
  id: string;
  expectedRevision: number;
  actorId: string;
};



export type MissionTransitionInput = {
  id: string;
  expectedRevision: number;
  status: Exclude<MissionLifecycleStatus, 'archived'>;
  phase?: MissionPhase;
  reason?: string;
  actorId: string;
};



export type MissionLineageProjection = {
  mission: MissionRecord;
  checkpoints: MissionCheckpointRecord[];
  links: MissionLinkRecord[];
  causalEvents: CausalEventRecord[];
};



export interface MissionDomainRendererApi {
  listMissions(
    context: StoreContextEnvelope,
    input?: { includeArchived?: boolean },
  ): Promise<MissionRecord[]>;
  createMission(context: StoreContextEnvelope, input: CreateMissionInput): Promise<MissionRecord>;
  getMission(context: StoreContextEnvelope, missionId: string): Promise<MissionRecord | undefined>;
  updateMission(context: StoreContextEnvelope, input: UpdateMissionInput): Promise<MissionRecord>;
  transitionMission(context: StoreContextEnvelope, input: MissionTransitionInput): Promise<MissionRecord>;
  archiveMission(context: StoreContextEnvelope, input: MissionArchiveInput): Promise<MissionRecord>;
  restoreMission(context: StoreContextEnvelope, input: MissionArchiveInput): Promise<MissionRecord>;
  appendMissionCheckpoint(
    context: StoreContextEnvelope,
    input: AppendMissionCheckpointInput,
  ): Promise<MissionCheckpointRecord>;
  getMissionLineage(context: StoreContextEnvelope, missionId: string): Promise<MissionLineageProjection>;
}



export type HumanDecisionResolutionInput = {
  id: string;
  expectedRevision: number;
  status: Extract<DecisionStatus, 'approved' | 'rejected' | 'blocked' | 'superseded'>;
  reason: string;
  actorId: string;
};



export type HumanGrantRevokeInput = {
  id: string;
  grantId: string;
  reason?: string;
  actorId: string;
};



export interface DecisionDomainRendererApi {
  listDecisions(context: StoreContextEnvelope, input?: { missionId?: string }): Promise<DecisionRecord[]>;
  createDecision(context: StoreContextEnvelope, input: CreateDecisionInput): Promise<DecisionRecord>;
  reviseDecision(context: StoreContextEnvelope, input: ReviseDecisionInput): Promise<DecisionRecord>;
  resolveDecisionHuman(context: StoreContextEnvelope, input: HumanDecisionResolutionInput): Promise<DecisionRecord>;
  getDecisionHistory(context: StoreContextEnvelope, decisionId: string): Promise<DecisionHistoryRecord[]>;
  listHumanGrants(context: StoreContextEnvelope, missionId: string): Promise<MissionGrantRecord[]>;
  listHumanGrantEvents(context: StoreContextEnvelope, missionId: string): Promise<MissionGrantEventRecord[]>;
  revokeHumanGrant(context: StoreContextEnvelope, input: HumanGrantRevokeInput): Promise<MissionGrantEventRecord>;
}



export type UpdatePolicyInput = {
  id: string;
  expectedRevision: number;
  actorId: string;
  patch: { name?: string; scope?: string; priority?: number };
};



export type PolicyArchiveInput = {
  id: string;
  expectedRevision: number;
  actorId: string;
  reason?: string;
};



export type UpdateDraftPolicyVersionInput = {
  id: string;
  expectedRevision: number;
  actorId: string;
  rules?: PolicyVersionRules;
  validFrom?: string | null;
  validUntil?: string | null;
};



export type EnablePolicyVersionInput = {
  policyId: string;
  versionId: string;
  expectedPolicyRevision: number;
  expectedVersionRevision: number;
  actorId: string;
};



export type AutonomyProjection = Pick<PolicyRuntimeRecord,
  'killSwitch' | 'circuitBreakerState' | 'activePolicyVersionId' | 'revision'
> & {
  mode: PolicyAutonomyMode;
  canAutoExecute: boolean;
  status: 'APPLIED';
};



export type SetAutonomyModeInput = { expectedRevision: number; mode: PolicyAutonomyMode; reason?: string };


export type SetKillSwitchInput = { expectedRevision: number; enabled: boolean; reason?: string };



export interface PolicyDomainRendererApi {
  listPolicies(context: StoreContextEnvelope, input?: { includeArchived?: boolean }): Promise<PolicyRecord[]>;
  createPolicy(context: StoreContextEnvelope, input: CreatePolicyInput): Promise<PolicyRecord>;
  updatePolicy(context: StoreContextEnvelope, input: UpdatePolicyInput): Promise<PolicyRecord>;
  disablePolicy(context: StoreContextEnvelope, input: PolicyArchiveInput): Promise<PolicyRecord>;
  archivePolicy(context: StoreContextEnvelope, input: PolicyArchiveInput): Promise<PolicyRecord>;
  restorePolicy(context: StoreContextEnvelope, input: PolicyArchiveInput): Promise<PolicyRecord>;
  listPolicyVersions(context: StoreContextEnvelope, policyId: string): Promise<PolicyVersionRecord[]>;
  createPolicyVersion(context: StoreContextEnvelope, input: CreatePolicyVersionInput): Promise<PolicyVersionRecord>;
  updateDraftPolicyVersion(context: StoreContextEnvelope, input: UpdateDraftPolicyVersionInput): Promise<PolicyVersionRecord>;
  enablePolicyVersion(context: StoreContextEnvelope, input: EnablePolicyVersionInput): Promise<PolicyVersionRecord>;
  getPolicyRuntime(context: StoreContextEnvelope): Promise<AutonomyProjection>;
  setAutonomyMode(context: StoreContextEnvelope, input: SetAutonomyModeInput): Promise<AutonomyProjection>;
  setKillSwitch(context: StoreContextEnvelope, input: SetKillSwitchInput): Promise<AutonomyProjection>;
}



export type TransitionExperimentInput = {
  id: string;
  expectedRevision: number;
  status: Exclude<ExperimentStatus, 'archived'>;
  actorId: string;
  reason?: string;
};



export type EvaluateExperimentInput = {
  id: string;
  expectedRevision: number;
};



export type ExperimentArchiveInput = {
  id: string;
  expectedRevision: number;
  actorId: string;
  reason?: string;
};



export type AppendExperimentObservationInput = {
  id: string;
  experimentId: string;
  observationType: ExperimentObservationType;
  title: string;
  observation: string;
  observedAt: string;
  actorId: string;
  correctsRecordId?: string;
};



export type CausalEventListInput = {
  missionId?: string;
  stages?: readonly CausalLedgerStage[];
};



export interface ExperimentDomainRendererApi {
  listExperiments(
    context: StoreContextEnvelope,
    input?: { includeArchived?: boolean; missionId?: string },
  ): Promise<ExperimentRecord[]>;
  createExperiment(context: StoreContextEnvelope, input: CreateExperimentInput): Promise<ExperimentRecord>;
  updateExperiment(context: StoreContextEnvelope, input: UpdateExperimentInput): Promise<ExperimentRecord>;
  transitionExperiment(context: StoreContextEnvelope, input: TransitionExperimentInput): Promise<ExperimentRecord>;
  evaluateExperiment(context: StoreContextEnvelope, input: EvaluateExperimentInput): Promise<ExperimentRecord>;
  archiveExperiment(context: StoreContextEnvelope, input: ExperimentArchiveInput): Promise<ExperimentRecord>;
  restoreExperiment(context: StoreContextEnvelope, input: ExperimentArchiveInput): Promise<ExperimentRecord>;
  appendExperimentObservation(
    context: StoreContextEnvelope,
    input: AppendExperimentObservationInput,
  ): Promise<ExperimentObservationRecord>;
  listExperimentObservations(
    context: StoreContextEnvelope,
    experimentId: string,
  ): Promise<ExperimentObservationRecord[]>;
  listExperimentMetricSnapshots(
    context: StoreContextEnvelope,
    experimentId: string,
  ): Promise<ExperimentMetricSnapshotRecord[]>;
  listCausalEvents(context: StoreContextEnvelope, input?: CausalEventListInput): Promise<CausalEventRecord[]>;
}



export interface MemoryDomainRendererApi {
  listCausalEvents(context: StoreContextEnvelope, input?: CausalEventListInput): Promise<CausalEventRecord[]>;
  appendManualCausalEvent(context: StoreContextEnvelope, input: AppendCausalEventInput): Promise<CausalEventRecord>;
  exportCausalTimeline(context: StoreContextEnvelope, input?: CausalEventListInput): Promise<CausalTimelineExport>;
}



export type MissionScopedCall = (
  context: StoreContextEnvelope,
  input?: Record<string, unknown>,
) => Promise<unknown>;



export interface MissionDomainWindowSurface {
  missions: Readonly<Record<
    'create' | 'get' | 'list' | 'update' | 'transition' | 'archive' | 'restore' | 'appendCheckpoint' | 'getLineage',
    MissionScopedCall
  >>;
  decisions?: Readonly<Record<'create' | 'list' | 'revise' | 'resolveHuman' | 'history', MissionScopedCall>>;
  grants?: Readonly<Record<'list' | 'listEvents' | 'revokeHuman', MissionScopedCall>>;
  policies?: Readonly<Record<'create' | 'list' | 'update' | 'disable' | 'archive' | 'restore', MissionScopedCall>>;
  policyVersions?: Readonly<Record<'create' | 'list' | 'updateDraft' | 'enable', MissionScopedCall>>;
  policyRuntime?: Readonly<Record<'get' | 'setAutonomyMode' | 'setKillSwitch', MissionScopedCall>>;
  experiments?: Readonly<Record<'create' | 'list' | 'update' | 'transition' | 'evaluate' | 'archive' | 'restore' | 'listObservations' | 'listMetricSnapshots' | 'appendObservation', MissionScopedCall>>;
  causal?: Readonly<Record<'listEvents' | 'appendEvent' | 'exportTimeline', MissionScopedCall>>;
}



export type PreviewStoreState = {
  authorityKey: string;
  missions: MissionRecord[];
  checkpoints: MissionCheckpointRecord[];
  links: MissionLinkRecord[];
};



export type PreviewDecisionState = {
  authorityKey: string;
  decisions: DecisionRecord[];
  history: DecisionHistoryRecord[];
  grants: MissionGrantRecord[];
  grantEvents: MissionGrantEventRecord[];
  revokedGrantIds: Set<string>;
};



export type PreviewPolicyState = {
  authorityKey: string;
  policies: PolicyRecord[];
  versions: PolicyVersionRecord[];
  runtime: AutonomyProjection;
};



export type PreviewExperimentMemoryState = {
  authorityKey: string;
  experiments: ExperimentRecord[];
  observations: ExperimentObservationRecord[];
  metricSnapshots: ExperimentMetricSnapshotRecord[];
  causalEvents: CausalEventRecord[];
  nextSequence: number;
};
