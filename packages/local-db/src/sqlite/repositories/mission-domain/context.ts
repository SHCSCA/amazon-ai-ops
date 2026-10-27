import Database from 'better-sqlite3';
import type { CausalTimelineExport } from '@amazon-ai-ops/shared-types/src/causal-timeline-export';
import  {
  type MissionWriteAuthoritySnapshot,
  type AppendCausalEventInput,
  type AppendMissionCheckpointInput,
  type CausalEvidenceRefRecord,
  type CausalEventRecord,
  type CausalLedgerStage,
  type CausalLinkRecord,
  type CreateDecisionInput,
  type CreateExperimentInput,
  type CreateMissionGrantInput,
  type CreateMissionInput,
  type CreatePolicyInput,
  type CreatePolicyVersionInput,
  type DecisionHistoryEventType,
  type DecisionHistoryRecord,
  type DecisionRecord,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentRecord,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionLinkType,
  type MissionPhase,
  type MissionRecord,
  type MissionCheckpointRecord,
  type PolicyRecord,
  type PolicyRuntimeRecord,
  type PolicyVersionRecord,
  type PolicyVersionRules,
  type ReviseDecisionInput,
  type StoreContextEnvelope,
  type UpdateExperimentInput,
  type UpdateMissionInput,
  type UpdatePolicyRuntimeInput,
} from '@amazon-ai-ops/shared-types';
import  {
  ListDomainRecordsInput,
  UpdatePolicyInput,
  UpdateDraftPolicyVersionInput,
  EnablePolicyVersionInput,
  ArchiveRestoreInput,
  AppendMissionLinkInput,
  AppendMissionGrantEventInput,
  ResolveDecisionInput,
  TransitionExperimentInput,
  AppendExperimentObservationInput,
  AppendExperimentMetricSnapshotInput,
  EvaluateExperimentInput,
  AnalysisCausalMemoryItem,
  AppendCausalLinkInput,
  AppendEvidenceRefInput,
  AppendCausalEventWithEvidenceResult,
  ResolveEffectivePolicyVersionInput,
  MissionLineageProjection,
  MissionDomainReferenceValidator,
  GrantRow,
} from './contracts';
export interface MissionDomainRepositoryContext {
 exportCausalTimeline(contextInput: StoreContextEnvelope, input?: { missionId?: string; stages?: readonly CausalLedgerStage[] }): CausalTimelineExport;
 expireMissionGrants(context: StoreContextEnvelope): number;
 db: Database.Database;
 now: () => Date;
 references?: MissionDomainReferenceValidator;
createPolicy(contextInput: StoreContextEnvelope, input: CreatePolicyInput): PolicyRecord;
getPolicy(contextInput: StoreContextEnvelope, idInput: string): PolicyRecord | undefined;
listPolicies(contextInput: StoreContextEnvelope, input?: ListDomainRecordsInput): PolicyRecord[];
resolveEffectivePolicyVersion(contextInput: StoreContextEnvelope, input: ResolveEffectivePolicyVersionInput): PolicyVersionRecord;
updatePolicy(contextInput: StoreContextEnvelope, input: UpdatePolicyInput): PolicyRecord;
disablePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord;
archivePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord;
restorePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord;
createPolicyVersion(contextInput: StoreContextEnvelope, input: CreatePolicyVersionInput): PolicyVersionRecord;
getPolicyVersion(contextInput: StoreContextEnvelope, idInput: string): PolicyVersionRecord | undefined;
listPolicyVersions(contextInput: StoreContextEnvelope, policyIdInput: string): PolicyVersionRecord[];
updateDraftPolicyVersion(contextInput: StoreContextEnvelope, input: UpdateDraftPolicyVersionInput): PolicyVersionRecord;
enablePolicyVersion(contextInput: StoreContextEnvelope, input: EnablePolicyVersionInput): PolicyVersionRecord;
getPolicyRuntime(contextInput: StoreContextEnvelope): PolicyRuntimeRecord;
updatePolicyRuntime(contextInput: StoreContextEnvelope, input: UpdatePolicyRuntimeInput): PolicyRuntimeRecord;
createMission(contextInput: StoreContextEnvelope, input: CreateMissionInput): MissionRecord;
getMission(contextInput: StoreContextEnvelope, idInput: string): MissionRecord | undefined;
listMissions(contextInput: StoreContextEnvelope, input?: ListDomainRecordsInput): MissionRecord[];
updateMission(contextInput: StoreContextEnvelope, input: UpdateMissionInput): MissionRecord;
transitionMission(contextInput: StoreContextEnvelope, input: {
    id: string;
    expectedRevision: number;
    status: Exclude<MissionLifecycleStatus, 'archived'>;
    phase?: MissionPhase;
    reason?: string;
    actorId: string;
}): MissionRecord;
archiveMission(context: StoreContextEnvelope, input: ArchiveRestoreInput): MissionRecord;
restoreMission(context: StoreContextEnvelope, input: ArchiveRestoreInput): MissionRecord;
appendMissionCheckpoint(contextInput: StoreContextEnvelope, input: AppendMissionCheckpointInput): MissionCheckpointRecord;
listMissionCheckpoints(contextInput: StoreContextEnvelope, missionIdInput: string): MissionCheckpointRecord[];
appendMissionLink(contextInput: StoreContextEnvelope, input: AppendMissionLinkInput): MissionLinkRecord;
getMissionLineage(contextInput: StoreContextEnvelope, missionIdInput: string): MissionLineageProjection;
captureWriteAuthority(contextInput: StoreContextEnvelope): MissionWriteAuthoritySnapshot;
assertMissionMayCreateAuthority(contextInput: StoreContextEnvelope, missionId: string): void;
assertWriteAuthority(context: StoreContextEnvelope, authority: MissionWriteAuthoritySnapshot | undefined): void;
issueMissionGrant(contextInput: StoreContextEnvelope, input: CreateMissionGrantInput): MissionGrantRecord;
getMissionGrant(contextInput: StoreContextEnvelope, idInput: string): MissionGrantRecord | undefined;

assertPolicyUsage(contextInput: StoreContextEnvelope, policyVersionId: string, entityIds: readonly string[]): void;
listMissionGrants(contextInput: StoreContextEnvelope, missionIdInput: string): MissionGrantRecord[];
projectGrant(context: StoreContextEnvelope, row: GrantRow): MissionGrantRecord;
listMissionGrantEvents(contextInput: StoreContextEnvelope, missionIdInput: string): MissionGrantEventRecord[];
getMissionGrantTerminalEvent(contextInput: StoreContextEnvelope, grantIdInput: string): MissionGrantEventRecord | undefined;
appendMissionGrantEvent(contextInput: StoreContextEnvelope, input: AppendMissionGrantEventInput): MissionGrantEventRecord;
createDecision(contextInput: StoreContextEnvelope, input: CreateDecisionInput): DecisionRecord;
getDecision(contextInput: StoreContextEnvelope, idInput: string): DecisionRecord | undefined;
listDecisions(contextInput: StoreContextEnvelope, input?: ListDomainRecordsInput): DecisionRecord[];
reviseDecision(contextInput: StoreContextEnvelope, input: ReviseDecisionInput): DecisionRecord;
resolveDecision(contextInput: StoreContextEnvelope, input: ResolveDecisionInput): DecisionRecord;
listDecisionHistory(contextInput: StoreContextEnvelope, decisionIdInput: string): DecisionHistoryRecord[];
createExperiment(contextInput: StoreContextEnvelope, input: CreateExperimentInput): ExperimentRecord;
getExperiment(contextInput: StoreContextEnvelope, idInput: string): ExperimentRecord | undefined;
listExperiments(contextInput: StoreContextEnvelope, input?: ListDomainRecordsInput): ExperimentRecord[];
updateExperiment(contextInput: StoreContextEnvelope, input: UpdateExperimentInput): ExperimentRecord;
transitionExperiment(contextInput: StoreContextEnvelope, input: TransitionExperimentInput): ExperimentRecord;
evaluateExperiment(contextInput: StoreContextEnvelope, input: EvaluateExperimentInput): ExperimentRecord;
archiveExperiment(context: StoreContextEnvelope, input: ArchiveRestoreInput): ExperimentRecord;
restoreExperiment(context: StoreContextEnvelope, input: ArchiveRestoreInput): ExperimentRecord;
listExperimentObservations(contextInput: StoreContextEnvelope, experimentIdInput: string): ExperimentObservationRecord[];
listExperimentMetricSnapshots(contextInput: StoreContextEnvelope, experimentIdInput: string): ExperimentMetricSnapshotRecord[];
appendExperimentObservation(contextInput: StoreContextEnvelope, input: AppendExperimentObservationInput): ExperimentObservationRecord;
appendExperimentMetricSnapshot(contextInput: StoreContextEnvelope, input: AppendExperimentMetricSnapshotInput): ExperimentMetricSnapshotRecord;
appendCausalEvent(contextInput: StoreContextEnvelope, input: AppendCausalEventInput): CausalEventRecord;
appendCausalEventWithEvidence(contextInput: StoreContextEnvelope, input: AppendCausalEventInput, evidenceInputs: readonly AppendEvidenceRefInput[]): AppendCausalEventWithEvidenceResult;
listCausalEvents(contextInput: StoreContextEnvelope, input?: {
    missionId?: string;
    stages?: readonly CausalLedgerStage[];
}): CausalEventRecord[];
listAnalysisCausalMemory(contextInput: StoreContextEnvelope, input: {
    productId: string;
    limit?: number;
}): AnalysisCausalMemoryItem[];
appendCausalLink(contextInput: StoreContextEnvelope, input: AppendCausalLinkInput): CausalLinkRecord;
appendEvidenceRef(contextInput: StoreContextEnvelope, input: AppendEvidenceRefInput): CausalEvidenceRefRecord;
appendEvidenceRefInternal(context: StoreContextEnvelope, input: AppendEvidenceRefInput, createdAt: string): CausalEvidenceRefRecord;
assertContext(contextInput: StoreContextEnvelope): StoreContextEnvelope;
assertProduct(context: StoreContextEnvelope, productIdInput: string): void;
assertAdEntity(context: StoreContextEnvelope, adEntityIdInput: string): void;
assertAdEntities(context: StoreContextEnvelope, entityIds: readonly string[]): void;
assertPolicyRules(context: StoreContextEnvelope, policy: PolicyRecord, rules: PolicyVersionRules): void;
adEntitySupportsKeywordBid(context: StoreContextEnvelope, entityId: string): boolean;
adEntityBelongsToPolicyScope(context: StoreContextEnvelope, scope: string, entityId: string): boolean;
assertGrantWithinPolicy(input: CreateMissionGrantInput, policyVersion: PolicyVersionRecord, rules: PolicyVersionRules, issuedAt: string): void;
setMissionArchive(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput, archive: boolean): MissionRecord;
setExperimentArchive(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput, archive: boolean): ExperimentRecord;
requirePolicy(context: StoreContextEnvelope, idInput: string): PolicyRecord;
requirePolicyVersion(context: StoreContextEnvelope, idInput: string): PolicyVersionRecord;
requireMission(context: StoreContextEnvelope, idInput: string): MissionRecord;
requireMissionLink(context: StoreContextEnvelope, idInput: string): MissionLinkRecord;
requireMissionCheckpoint(context: StoreContextEnvelope, idInput: string): MissionCheckpointRecord;
requireMissionGrant(context: StoreContextEnvelope, idInput: string): MissionGrantRecord;
requireDecision(context: StoreContextEnvelope, idInput: string): DecisionRecord;
requireApprovedDecisionsForGrant(context: StoreContextEnvelope, mission: MissionRecord, input: CreateMissionGrantInput, issuedAt: string): DecisionRecord[];
requireExperiment(context: StoreContextEnvelope, idInput: string): ExperimentRecord;
requireVerifiedExperimentBaseline(context: StoreContextEnvelope, experiment: ExperimentRecord): Record<string, unknown>;
captureExperimentMetrics(context: StoreContextEnvelope, experiment: ExperimentRecord, dataBatchId: string, phase: 'baseline' | 'result', createdAt: string, baselineAuthorityId?: string): void;
assertExperimentMetricCoverage(context: StoreContextEnvelope, experiment: ExperimentRecord): void;
requireLatestExperimentResultBatch(context: StoreContextEnvelope, experiment: ExperimentRecord): string;
buildExperimentEvaluation(context: StoreContextEnvelope, experiment: ExperimentRecord): {
    status: 'completed' | 'paused';
    conclusion: string;
    eventType: 'experiment_completed' | 'experiment_guardrail_triggered';
};
requireExperimentObservation(context: StoreContextEnvelope, experimentId: string, idInput: string): ExperimentObservationRecord;
requireCausalEvent(context: StoreContextEnvelope, idInput: string): CausalEventRecord;
requireCompletedDataBatch(context: StoreContextEnvelope, idInput: string, requireFormal?: boolean): string | undefined;
insertMissionEvent(context: StoreContextEnvelope, mission: MissionRecord, eventType: string, actorIdInput: string, reason: string | null | undefined, createdAt: string): void;
insertMissionLink(context: StoreContextEnvelope, input: AppendMissionLinkInput, createdAt: string): void;
insertDecisionHistory(context: StoreContextEnvelope, decision: DecisionRecord, eventType: DecisionHistoryEventType, actorIdInput: string, reason: string | undefined, createdAt: string): void;
appendPolicyAudit(context: StoreContextEnvelope, input: {
    id: string;
    eventType: string;
    entityType: 'policy' | 'policy_version' | 'policy_runtime';
    entityId: string;
    title: string;
    signal?: string;
    intervention?: string;
    status: string;
    actorId: string;
}, createdAt: string): void;
appendCausalInternal(context: StoreContextEnvelope, input: AppendCausalEventInput, createdAt: string): void;
assertMissionLinkTarget(context: StoreContextEnvelope, type: MissionLinkType, targetId: string): void;
assertCausalTarget(context: StoreContextEnvelope, type: AppendCausalLinkInput['targetType'], targetId: string): void;
assertRevision(current: number, expectedInput: number, label: string): void;
assertCas(changes: number, label: string): void;
timestamp(): string;
rethrowConstraint(error: unknown, message: string): never;
}
