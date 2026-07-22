import {
  missionControlContextKey,
  type AppendCausalEventInput,
  type AppendMissionCheckpointInput,
  type CausalEventRecord,
  type CausalLedgerStage,
  type CreateDecisionInput,
  type CreateExperimentInput,
  type CreateMissionGrantInput,
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

export type CreateHumanMissionGrantInput = Omit<CreateMissionGrantInput, 'issuer'> & {
  actorId?: string;
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
  issueHumanGrant(context: StoreContextEnvelope, input: CreateHumanMissionGrantInput): Promise<MissionGrantRecord>;
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
}

type MissionScopedCall = (
  context: StoreContextEnvelope,
  input?: Record<string, unknown>,
) => Promise<unknown>;

export interface MissionDomainWindowSurface {
  missions: Readonly<Record<
    'create' | 'get' | 'list' | 'update' | 'transition' | 'archive' | 'restore' | 'appendCheckpoint' | 'getLineage',
    MissionScopedCall
  >>;
  decisions?: Readonly<Record<'create' | 'list' | 'revise' | 'resolveHuman' | 'history', MissionScopedCall>>;
  grants?: Readonly<Record<'issueHuman' | 'list' | 'listEvents' | 'revokeHuman', MissionScopedCall>>;
  policies?: Readonly<Record<'create' | 'list' | 'update' | 'disable' | 'archive' | 'restore', MissionScopedCall>>;
  policyVersions?: Readonly<Record<'create' | 'list' | 'updateDraft' | 'enable', MissionScopedCall>>;
  policyRuntime?: Readonly<Record<'get' | 'setAutonomyMode' | 'setKillSwitch', MissionScopedCall>>;
  experiments?: Readonly<Record<'create' | 'list' | 'update' | 'transition' | 'archive' | 'restore' | 'listObservations' | 'listMetricSnapshots' | 'appendObservation', MissionScopedCall>>;
  causal?: Readonly<Record<'listEvents' | 'appendEvent', MissionScopedCall>>;
}

const REQUIRED_WINDOW_METHODS = [
  'create',
  'get',
  'list',
  'update',
  'transition',
  'archive',
  'restore',
  'appendCheckpoint',
  'getLineage',
] as const satisfies readonly (keyof MissionDomainWindowSurface['missions'])[];

export function createMissionDomainWindowSurface(
  api: MissionDomainRendererApi,
  decisionApi?: DecisionDomainRendererApi,
  policyApi?: PolicyDomainRendererApi,
  experimentApi?: ExperimentDomainRendererApi,
  memoryApi?: MemoryDomainRendererApi,
): MissionDomainWindowSurface {
  const surface: MissionDomainWindowSurface = {
    missions: Object.freeze({
      create: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.createMission(context, input as unknown as CreateMissionInput),
      get: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.getMission(context, String(input.id ?? '')),
      list: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.listMissions(context, input),
      update: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.updateMission(context, input as unknown as UpdateMissionInput),
      transition: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.transitionMission(context, input as unknown as MissionTransitionInput),
      archive: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.archiveMission(context, input as unknown as MissionArchiveInput),
      restore: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.restoreMission(context, input as unknown as MissionArchiveInput),
      appendCheckpoint: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.appendMissionCheckpoint(context, input as unknown as AppendMissionCheckpointInput),
      getLineage: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => api.getMissionLineage(context, String(input.missionId ?? '')),
    }),
  };
  if (decisionApi) {
    surface.decisions = Object.freeze({
      create: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.createDecision(context, input as unknown as CreateDecisionInput),
      list: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.listDecisions(context, input),
      revise: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.reviseDecision(context, input as unknown as ReviseDecisionInput),
      resolveHuman: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.resolveDecisionHuman(context, input as unknown as HumanDecisionResolutionInput),
      history: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.getDecisionHistory(context, String(input.decisionId ?? '')),
    });
    surface.grants = Object.freeze({
      issueHuman: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.issueHumanGrant(context, input as unknown as CreateHumanMissionGrantInput),
      list: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.listHumanGrants(context, String(input.missionId ?? '')),
      listEvents: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.listHumanGrantEvents(context, String(input.missionId ?? '')),
      revokeHuman: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => decisionApi.revokeHumanGrant(context, input as unknown as HumanGrantRevokeInput),
    });
  }
  if (policyApi) {
    surface.policies = Object.freeze({
      create: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.createPolicy(context, input as unknown as CreatePolicyInput),
      list: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.listPolicies(context, input),
      update: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.updatePolicy(context, input as unknown as UpdatePolicyInput),
      disable: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.disablePolicy(context, input as unknown as PolicyArchiveInput),
      archive: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.archivePolicy(context, input as unknown as PolicyArchiveInput),
      restore: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.restorePolicy(context, input as unknown as PolicyArchiveInput),
    });
    surface.policyVersions = Object.freeze({
      create: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.createPolicyVersion(context, input as unknown as CreatePolicyVersionInput),
      list: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.listPolicyVersions(context, String(input.policyId ?? '')),
      updateDraft: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.updateDraftPolicyVersion(context, input as unknown as UpdateDraftPolicyVersionInput),
      enable: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.enablePolicyVersion(context, input as unknown as EnablePolicyVersionInput),
    });
    surface.policyRuntime = Object.freeze({
      get: (context: StoreContextEnvelope) => policyApi.getPolicyRuntime(context),
      setAutonomyMode: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.setAutonomyMode(context, input as unknown as SetAutonomyModeInput),
      setKillSwitch: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => policyApi.setKillSwitch(context, input as unknown as SetKillSwitchInput),
    });
  }
  if (experimentApi) {
    surface.experiments = Object.freeze({
      create: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.createExperiment(context, input as unknown as CreateExperimentInput),
      list: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.listExperiments(context, input),
      update: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.updateExperiment(context, input as unknown as UpdateExperimentInput),
      transition: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.transitionExperiment(context, input as unknown as TransitionExperimentInput),
      archive: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.archiveExperiment(context, input as unknown as ExperimentArchiveInput),
      restore: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.restoreExperiment(context, input as unknown as ExperimentArchiveInput),
      listObservations: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.listExperimentObservations(context, String(input.experimentId ?? '')),
      listMetricSnapshots: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.listExperimentMetricSnapshots(context, String(input.experimentId ?? '')),
      appendObservation: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.appendExperimentObservation(context, input as unknown as AppendExperimentObservationInput),
    });
  }
  const causalApi = memoryApi ?? experimentApi;
  if (causalApi) {
    surface.causal = Object.freeze({
      listEvents: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => causalApi.listCausalEvents(context, input),
      appendEvent: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => {
        if (!memoryApi) return Promise.reject(new Error('Renderer 因果记忆写入桥未接入，已失败关闭。'));
        return memoryApi.appendManualCausalEvent(context, input as unknown as AppendCausalEventInput);
      },
    });
  }
  return Object.freeze(surface);
}

export function readMissionDomainWindowApi(
  target?: unknown,
): MissionDomainRendererApi | null {
  const resolvedTarget = target ?? (typeof window === 'undefined' ? undefined : window);
  const candidate = (resolvedTarget as {
    electronAPI?: { missionDomain?: Partial<MissionDomainWindowSurface> };
  } | null)?.electronAPI?.missionDomain;
  const missions = candidate?.missions;
  if (!missions || !REQUIRED_WINDOW_METHODS.every((method) => typeof missions[method] === 'function')) return null;
  return {
    listMissions: async (context, input = {}) => missions.list(context, input) as Promise<MissionRecord[]>,
    createMission: async (context, input) => missions.create(context, input as unknown as Record<string, unknown>) as Promise<MissionRecord>,
    getMission: async (context, missionId) => missions.get(context, { id: missionId }) as Promise<MissionRecord | undefined>,
    updateMission: async (context, input) => missions.update(context, input as unknown as Record<string, unknown>) as Promise<MissionRecord>,
    transitionMission: async (context, input) => missions.transition(context, input as unknown as Record<string, unknown>) as Promise<MissionRecord>,
    archiveMission: async (context, input) => missions.archive(context, input as unknown as Record<string, unknown>) as Promise<MissionRecord>,
    restoreMission: async (context, input) => missions.restore(context, input as unknown as Record<string, unknown>) as Promise<MissionRecord>,
    appendMissionCheckpoint: async (context, input) => missions.appendCheckpoint(context, input as unknown as Record<string, unknown>) as Promise<MissionCheckpointRecord>,
    getMissionLineage: async (context, missionId) => missions.getLineage(context, { missionId }) as Promise<MissionLineageProjection>,
  };
}

const DECISION_METHODS = ['create', 'list', 'revise', 'resolveHuman', 'history'] as const;
const GRANT_METHODS = ['issueHuman', 'list', 'listEvents', 'revokeHuman'] as const;

export function readDecisionDomainWindowApi(target?: unknown): DecisionDomainRendererApi | null {
  const resolvedTarget = target ?? (typeof window === 'undefined' ? undefined : window);
  const candidate = (resolvedTarget as {
    electronAPI?: { missionDomain?: Partial<MissionDomainWindowSurface> };
  } | null)?.electronAPI?.missionDomain;
  const decisions = candidate?.decisions;
  const grants = candidate?.grants;
  if (!decisions || !grants
    || !DECISION_METHODS.every((method) => typeof decisions[method] === 'function')
    || !GRANT_METHODS.every((method) => typeof grants[method] === 'function')) return null;
  return {
    listDecisions: async (context, input = {}) => decisions.list(context, input) as Promise<DecisionRecord[]>,
    createDecision: async (context, input) => decisions.create(context, input as unknown as Record<string, unknown>) as Promise<DecisionRecord>,
    reviseDecision: async (context, input) => decisions.revise(context, input as unknown as Record<string, unknown>) as Promise<DecisionRecord>,
    resolveDecisionHuman: async (context, input) => decisions.resolveHuman(context, input as unknown as Record<string, unknown>) as Promise<DecisionRecord>,
    getDecisionHistory: async (context, decisionId) => decisions.history(context, { decisionId }) as Promise<DecisionHistoryRecord[]>,
    listHumanGrants: async (context, missionId) => grants.list(context, { missionId }) as Promise<MissionGrantRecord[]>,
    listHumanGrantEvents: async (context, missionId) => grants.listEvents(context, { missionId }) as Promise<MissionGrantEventRecord[]>,
    issueHumanGrant: async (context, input) => grants.issueHuman(context, input as unknown as Record<string, unknown>) as Promise<MissionGrantRecord>,
    revokeHumanGrant: async (context, input) => grants.revokeHuman(context, input as unknown as Record<string, unknown>) as Promise<MissionGrantEventRecord>,
  };
}

const POLICY_METHODS = ['create', 'list', 'update', 'disable', 'archive', 'restore'] as const;
const POLICY_VERSION_METHODS = ['create', 'list', 'updateDraft', 'enable'] as const;
const POLICY_RUNTIME_METHODS = ['get', 'setAutonomyMode', 'setKillSwitch'] as const;

export function readPolicyDomainWindowApi(target?: unknown): PolicyDomainRendererApi | null {
  const resolvedTarget = target ?? (typeof window === 'undefined' ? undefined : window);
  const candidate = (resolvedTarget as {
    electronAPI?: { missionDomain?: Partial<MissionDomainWindowSurface> };
  } | null)?.electronAPI?.missionDomain;
  const policies = candidate?.policies;
  const policyVersions = candidate?.policyVersions;
  const policyRuntime = candidate?.policyRuntime;
  if (!policies || !policyVersions || !policyRuntime
    || !POLICY_METHODS.every((method) => typeof policies[method] === 'function')
    || !POLICY_VERSION_METHODS.every((method) => typeof policyVersions[method] === 'function')
    || !POLICY_RUNTIME_METHODS.every((method) => typeof policyRuntime[method] === 'function')) return null;
  return {
    listPolicies: async (context, input = {}) => policies.list(context, input) as Promise<PolicyRecord[]>,
    createPolicy: async (context, input) => policies.create(context, input as unknown as Record<string, unknown>) as Promise<PolicyRecord>,
    updatePolicy: async (context, input) => policies.update(context, input as unknown as Record<string, unknown>) as Promise<PolicyRecord>,
    disablePolicy: async (context, input) => policies.disable(context, input as unknown as Record<string, unknown>) as Promise<PolicyRecord>,
    archivePolicy: async (context, input) => policies.archive(context, input as unknown as Record<string, unknown>) as Promise<PolicyRecord>,
    restorePolicy: async (context, input) => policies.restore(context, input as unknown as Record<string, unknown>) as Promise<PolicyRecord>,
    listPolicyVersions: async (context, policyId) => policyVersions.list(context, { policyId }) as Promise<PolicyVersionRecord[]>,
    createPolicyVersion: async (context, input) => policyVersions.create(context, input as unknown as Record<string, unknown>) as Promise<PolicyVersionRecord>,
    updateDraftPolicyVersion: async (context, input) => policyVersions.updateDraft(context, input as unknown as Record<string, unknown>) as Promise<PolicyVersionRecord>,
    enablePolicyVersion: async (context, input) => policyVersions.enable(context, input as unknown as Record<string, unknown>) as Promise<PolicyVersionRecord>,
    getPolicyRuntime: async (context) => policyRuntime.get(context) as Promise<AutonomyProjection>,
    setAutonomyMode: async (context, input) => policyRuntime.setAutonomyMode(context, input as unknown as Record<string, unknown>) as Promise<AutonomyProjection>,
    setKillSwitch: async (context, input) => policyRuntime.setKillSwitch(context, input as unknown as Record<string, unknown>) as Promise<AutonomyProjection>,
  };
}

const EXPERIMENT_METHODS = [
  'create', 'list', 'update', 'transition', 'archive', 'restore',
  'listObservations', 'listMetricSnapshots', 'appendObservation',
] as const;
const CAUSAL_METHODS = ['listEvents', 'appendEvent'] as const;

export function readExperimentDomainWindowApi(target?: unknown): ExperimentDomainRendererApi | null {
  const resolvedTarget = target ?? (typeof window === 'undefined' ? undefined : window);
  const candidate = (resolvedTarget as {
    electronAPI?: { missionDomain?: Partial<MissionDomainWindowSurface> };
  } | null)?.electronAPI?.missionDomain;
  const experiments = candidate?.experiments;
  const causal = candidate?.causal;
  if (!experiments || !causal
    || !EXPERIMENT_METHODS.every((method) => typeof experiments[method] === 'function')
    || typeof causal.listEvents !== 'function') return null;
  return {
    listExperiments: async (context, input = {}) => experiments.list(context, input) as Promise<ExperimentRecord[]>,
    createExperiment: async (context, input) => experiments.create(context, input as unknown as Record<string, unknown>) as Promise<ExperimentRecord>,
    updateExperiment: async (context, input) => experiments.update(context, input as unknown as Record<string, unknown>) as Promise<ExperimentRecord>,
    transitionExperiment: async (context, input) => experiments.transition(context, input as unknown as Record<string, unknown>) as Promise<ExperimentRecord>,
    archiveExperiment: async (context, input) => experiments.archive(context, input as unknown as Record<string, unknown>) as Promise<ExperimentRecord>,
    restoreExperiment: async (context, input) => experiments.restore(context, input as unknown as Record<string, unknown>) as Promise<ExperimentRecord>,
    appendExperimentObservation: async (context, input) => experiments.appendObservation(context, input as unknown as Record<string, unknown>) as Promise<ExperimentObservationRecord>,
    listExperimentObservations: async (context, experimentId) => experiments.listObservations(context, { experimentId }) as Promise<ExperimentObservationRecord[]>,
    listExperimentMetricSnapshots: async (context, experimentId) => experiments.listMetricSnapshots(context, { experimentId }) as Promise<ExperimentMetricSnapshotRecord[]>,
    listCausalEvents: async (context, input = {}) => causal.listEvents(context, input as Record<string, unknown>) as Promise<CausalEventRecord[]>,
  };
}

export function readMemoryDomainWindowApi(target?: unknown): MemoryDomainRendererApi | null {
  const resolvedTarget = target ?? (typeof window === 'undefined' ? undefined : window);
  const candidate = (resolvedTarget as {
    electronAPI?: { missionDomain?: Partial<MissionDomainWindowSurface> };
  } | null)?.electronAPI?.missionDomain;
  const causal = candidate?.causal;
  if (!causal || !CAUSAL_METHODS.every((method) => typeof causal[method] === 'function')) return null;
  return {
    listCausalEvents: async (context, input = {}) => causal.listEvents(context, input as Record<string, unknown>) as Promise<CausalEventRecord[]>,
    appendManualCausalEvent: async (context, input) => causal.appendEvent(context, input as unknown as Record<string, unknown>) as Promise<CausalEventRecord>,
  };
}

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

type PreviewStoreState = {
  authorityKey: string;
  missions: MissionRecord[];
  checkpoints: MissionCheckpointRecord[];
  links: MissionLinkRecord[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowAfter(previous?: string): string {
  const current = Date.now();
  const floor = previous ? Date.parse(previous) + 1 : 0;
  return new Date(Math.max(current, Number.isFinite(floor) ? floor : 0)).toISOString();
}

function stableSuffix(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

function seedPreviewStore(context: StoreContextEnvelope): PreviewStoreState {
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

function assertRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`Mission 版本冲突：当前 revision=${actual}，提交 revision=${expected}；请刷新后重试。`);
  }
}

function validateMissionInput(input: CreateMissionInput): void {
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
      return replaceMission(state, {
        ...current,
        status: input.status,
        phase: input.phase ?? current.phase,
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
      });
    },
  };
}

type PreviewDecisionState = {
  authorityKey: string;
  decisions: DecisionRecord[];
  history: DecisionHistoryRecord[];
  grants: MissionGrantRecord[];
  grantEvents: MissionGrantEventRecord[];
  revokedGrantIds: Set<string>;
};

function previewIdentity(context: StoreContextEnvelope): { suffix: string; asin: string; subject: string } {
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

function seedPreviewDecisions(context: StoreContextEnvelope): PreviewDecisionState {
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
    maxChangePct: 15,
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
    async issueHumanGrant(context, input) {
      const state = stateFor(context);
      if (state.grants.some((grant) => grant.id === input.id)) throw new Error('MissionGrant ID 已存在。');
      if (!input.decisionIds.length || new Set(input.decisionIds).size !== input.decisionIds.length) {
        throw new Error('MissionGrant decisionIds 必须非空且不能重复。');
      }
      if (!input.allowedAdEntityIds.length || new Set(input.allowedAdEntityIds).size !== input.allowedAdEntityIds.length) {
        throw new Error('MissionGrant 广告实体 allowlist 必须非空且不能重复。');
      }
      if (!input.allowedActionTypes.length || new Set(input.allowedActionTypes).size !== input.allowedActionTypes.length
        || input.allowedActionTypes.some((action) => action !== 'set_keyword_bid')) {
        throw new Error('V1 人工授权必须限定关键词竞价对象。');
      }
      const decisions = input.decisionIds.map((id) => decisionFor(state, id));
      if (decisions.some((decision) => decision.status !== 'approved')) throw new Error('批次授权只接受已批准 Decision。');
      if (decisions.some((decision) => decision.missionId !== input.missionId
        || decision.dataBatchId !== decisions[0].dataBatchId
        || decision.policyVersionId !== input.policyVersionId
        || decision.policyRevision !== input.policyRevision
        || decision.actionRevision !== input.actionRevision)) {
        throw new Error('批次 Decision 必须匹配同一 Mission、数据批次、策略快照与 action revision。');
      }
      const expectedEntities = decisions.map((decision) => decision.adEntityId).filter((id): id is string => Boolean(id));
      const expectedActions = [...new Set(decisions.map((decision) => decision.actionType))];
      const exactEntitySet = expectedEntities.length === input.allowedAdEntityIds.length
        && expectedEntities.every((id) => input.allowedAdEntityIds.includes(id));
      if (!exactEntitySet) throw new Error('广告实体 allowlist 必须与批次 Decision 精确一致。');
      const exactActionSet = expectedActions.length === input.allowedActionTypes.length
        && expectedActions.every((action) => input.allowedActionTypes.includes(action as 'set_keyword_bid'));
      if (!exactActionSet) throw new Error('动作 allowlist 必须与批次 Decision 精确一致。');
      if (Date.parse(input.expiresAt) <= Date.now()) throw new Error('授权有效期必须晚于当前时间。');
      const grant: MissionGrantRecord = {
        ...input,
        storeId: context.storeId,
        marketplace: 'US',
        currency: 'USD',
        issuer: { type: 'human', actorId: 'desktop-operator' },
        issuedAt: nowAfter(),
        createdSessionGeneration: context.sessionGeneration,
      };
      state.grants.unshift(grant);
      state.grantEvents.unshift({
        id: `GRANT-EVENT-${grant.id}-ISSUED`, storeId: context.storeId, grantId: grant.id,
        eventType: 'issued', actorId: grant.issuer.actorId, createdAt: grant.issuedAt,
      });
      return clone(grant);
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

type PreviewPolicyState = {
  authorityKey: string;
  policies: PolicyRecord[];
  versions: PolicyVersionRecord[];
  runtime: AutonomyProjection;
};

function defaultPreviewRules(entityId: string, maxChangePct = 15): PolicyVersionRules {
  return {
    allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: [entityId],
    maxChangePct,
    totalImpactBudget: 50,
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

function seedPreviewPolicies(context: StoreContextEnvelope): PreviewPolicyState {
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

type PreviewExperimentMemoryState = {
  authorityKey: string;
  experiments: ExperimentRecord[];
  observations: ExperimentObservationRecord[];
  metricSnapshots: ExperimentMetricSnapshotRecord[];
  causalEvents: CausalEventRecord[];
  nextSequence: number;
};

function seedPreviewExperimentMemory(context: StoreContextEnvelope): PreviewExperimentMemoryState {
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

function assertExperimentRevision(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`Experiment 版本冲突：当前 revision=${actual}，提交 revision=${expected}；请刷新后重试。`);
  }
}

function assertExperimentWindow(startsAt: string, endsAt: string): void {
  if (!Number.isFinite(Date.parse(startsAt)) || !Number.isFinite(Date.parse(endsAt))
    || Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new Error('Experiment 观察窗口结束时间必须晚于开始时间。');
  }
}

function validateExperimentCreate(input: CreateExperimentInput): void {
  if (!input.id.trim() || !input.missionId.trim() || !input.name.trim() || !input.hypothesis.trim()) {
    throw new Error('Experiment ID、Mission、名称与假设不能为空。');
  }
  if (!input.primaryMetric.trim() || !input.guardrailMetrics.length || !input.guardrailCriteria.length) {
    throw new Error('Experiment 必须配置主指标、守护指标和判定标准。');
  }
  assertExperimentWindow(input.observationStartsAt, input.observationEndsAt);
}

function allowedExperimentTransition(from: ExperimentStatus, to: Exclude<ExperimentStatus, 'archived'>): boolean {
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
      if (!allowedExperimentTransition(current.status, input.status)) {
        throw new Error(`Experiment 不允许从 ${current.status} 转换到 ${input.status}。`);
      }
      const updated: ExperimentRecord = {
        ...current,
        status: input.status,
        ...(input.status === 'completed' && input.reason?.trim() ? { conclusion: input.reason.trim() } : {}),
        revision: current.revision + 1,
        updatedAt: nowAfter(current.updatedAt),
      };
      const saved = replaceExperiment(state, updated);
      appendCausal(context, state, {
        id: `causal:experiment:${updated.id}:r${updated.revision}`,
        stage: input.status === 'completed' ? 'EFFECT' : 'ANALYSIS',
        eventType: `experiment_${input.status}`, entityType: 'experiment', entityId: updated.id,
        missionId: updated.missionId, title: updated.name,
        ...(input.status === 'completed' ? { observedEffect: updated.conclusion } : {}),
        status: updated.status, source: 'mission-domain', actorId: input.actorId,
      }, updated.updatedAt);
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
