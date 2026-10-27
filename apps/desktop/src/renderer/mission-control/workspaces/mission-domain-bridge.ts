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
import { type MissionDomainWindowSurface, type MissionDomainRendererApi, type DecisionDomainRendererApi, type PolicyDomainRendererApi, type ExperimentDomainRendererApi, type MemoryDomainRendererApi, type MissionTransitionInput, type MissionArchiveInput, type HumanDecisionResolutionInput, type HumanGrantRevokeInput, type UpdatePolicyInput, type PolicyArchiveInput, type UpdateDraftPolicyVersionInput, type EnablePolicyVersionInput, type SetAutonomyModeInput, type SetKillSwitchInput, type TransitionExperimentInput, type EvaluateExperimentInput, type ExperimentArchiveInput, type AppendExperimentObservationInput, type CausalEventListInput, type MissionLineageProjection, type AutonomyProjection } from './mission-domain-contracts';



export const REQUIRED_WINDOW_METHODS = [
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
      evaluate: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => experimentApi.evaluateExperiment(context, input as unknown as EvaluateExperimentInput),
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
      exportTimeline: (context: StoreContextEnvelope, input: Record<string, unknown> = {}) => {
        if (!memoryApi) return Promise.reject(new Error('因果记忆导出桥未接入，已阻断。'));
        return memoryApi.exportCausalTimeline(context, input as CausalEventListInput);
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



export const DECISION_METHODS = ['create', 'list', 'revise', 'resolveHuman', 'history'] as const;


export const GRANT_METHODS = ['list', 'listEvents', 'revokeHuman'] as const;



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
    revokeHumanGrant: async (context, input) => grants.revokeHuman(context, input as unknown as Record<string, unknown>) as Promise<MissionGrantEventRecord>,
  };
}



export const POLICY_METHODS = ['create', 'list', 'update', 'disable', 'archive', 'restore'] as const;


export const POLICY_VERSION_METHODS = ['create', 'list', 'updateDraft', 'enable'] as const;


export const POLICY_RUNTIME_METHODS = ['get', 'setAutonomyMode', 'setKillSwitch'] as const;



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



export const EXPERIMENT_METHODS = [
  'create', 'list', 'update', 'transition', 'evaluate', 'archive', 'restore',
  'listObservations', 'listMetricSnapshots', 'appendObservation',
] as const;


export const CAUSAL_METHODS = ['listEvents', 'appendEvent', 'exportTimeline'] as const;



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
    evaluateExperiment: async (context, input) => experiments.evaluate(context, input as unknown as Record<string, unknown>) as Promise<ExperimentRecord>,
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
    exportCausalTimeline: async (context, input = {}) => causal.exportTimeline(context, input as Record<string, unknown>) as Promise<CausalTimelineExport>,
  };
}
