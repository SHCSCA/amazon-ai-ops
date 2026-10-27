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
  type DecisionHistoryRecord,
  type DecisionRecord,
  type ExperimentMetricSnapshotRecord,
  type ExperimentObservationRecord,
  type ExperimentRecord,
  type MissionGrantEventRecord,
  type MissionGrantRecord,
  type MissionLifecycleStatus,
  type MissionLinkRecord,
  type MissionPhase,
  type MissionRecord,
  type MissionCheckpointRecord,
  type PolicyRecord,
  type PolicyRuntimeRecord,
  type PolicyVersionRecord,
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
  MissionDomainRepositoryOptions,
} from './mission-domain/contracts';
import type { MissionDomainRepositoryContext } from './mission-domain/context';
import { createMissionDomainRepositoryContext } from './mission-domain/composition';
export { MissionDomainRepositoryError } from './mission-domain/errors';
export { MissionAuthorityGateError } from './mission-domain/authority-gates';
export type { MissionDomainRepositoryErrorCode } from './mission-domain/errors';
export { businessDayEnd } from './mission-domain/values';
export type {
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
  AnalysisCausalMemoryProof,
  AnalysisCausalMemoryItem,
  AppendCausalLinkInput,
  AppendEvidenceRefInput,
  AppendCausalEventWithEvidenceResult,
  ResolveEffectivePolicyVersionInput,
  MissionLineageProjection,
  MissionDomainReferenceValidator,
  MissionDomainRepositoryOptions,
} from './mission-domain/contracts';

export class MissionDomainRepository {
  private readonly context: MissionDomainRepositoryContext;

  constructor(db: Database.Database, options: MissionDomainRepositoryOptions = {}) {
    this.context = createMissionDomainRepositoryContext(db, options);
  }

  expireMissionGrants(context: StoreContextEnvelope): number {
    return this.context.expireMissionGrants(context);
  }

  exportCausalTimeline(contextInput: StoreContextEnvelope, input: { missionId?: string; stages?: readonly CausalLedgerStage[] } = {}): CausalTimelineExport {
    return this.context.exportCausalTimeline(contextInput, input);
  }

createPolicy(contextInput: StoreContextEnvelope, input: CreatePolicyInput): PolicyRecord{
    return this.context.createPolicy(contextInput, input);
  }

getPolicy(contextInput: StoreContextEnvelope, idInput: string): PolicyRecord | undefined{
    return this.context.getPolicy(contextInput, idInput);
  }

listPolicies(contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): PolicyRecord[]{
    return this.context.listPolicies(contextInput, input);
  }

resolveEffectivePolicyVersion(
    contextInput: StoreContextEnvelope,
    input: ResolveEffectivePolicyVersionInput,
  ): PolicyVersionRecord{
    return this.context.resolveEffectivePolicyVersion(contextInput, input);
  }

updatePolicy(contextInput: StoreContextEnvelope, input: UpdatePolicyInput): PolicyRecord{
    return this.context.updatePolicy(contextInput, input);
  }

disablePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord{
    return this.context.disablePolicy(contextInput, input);
  }

archivePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord{
    return this.context.archivePolicy(contextInput, input);
  }

restorePolicy(contextInput: StoreContextEnvelope, input: ArchiveRestoreInput): PolicyRecord{
    return this.context.restorePolicy(contextInput, input);
  }

createPolicyVersion(
    contextInput: StoreContextEnvelope,
    input: CreatePolicyVersionInput,
  ): PolicyVersionRecord{
    return this.context.createPolicyVersion(contextInput, input);
  }

getPolicyVersion(
    contextInput: StoreContextEnvelope,
    idInput: string,
  ): PolicyVersionRecord | undefined{
    return this.context.getPolicyVersion(contextInput, idInput);
  }

listPolicyVersions(contextInput: StoreContextEnvelope, policyIdInput: string): PolicyVersionRecord[]{
    return this.context.listPolicyVersions(contextInput, policyIdInput);
  }

updateDraftPolicyVersion(
    contextInput: StoreContextEnvelope,
    input: UpdateDraftPolicyVersionInput,
  ): PolicyVersionRecord{
    return this.context.updateDraftPolicyVersion(contextInput, input);
  }

enablePolicyVersion(
    contextInput: StoreContextEnvelope,
    input: EnablePolicyVersionInput,
  ): PolicyVersionRecord{
    return this.context.enablePolicyVersion(contextInput, input);
  }

getPolicyRuntime(contextInput: StoreContextEnvelope): PolicyRuntimeRecord{
    return this.context.getPolicyRuntime(contextInput);
  }

updatePolicyRuntime(
    contextInput: StoreContextEnvelope,
    input: UpdatePolicyRuntimeInput,
  ): PolicyRuntimeRecord{
    return this.context.updatePolicyRuntime(contextInput, input);
  }

createMission(contextInput: StoreContextEnvelope, input: CreateMissionInput): MissionRecord{
    return this.context.createMission(contextInput, input);
  }

getMission(contextInput: StoreContextEnvelope, idInput: string): MissionRecord | undefined{
    return this.context.getMission(contextInput, idInput);
  }

listMissions(contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): MissionRecord[]{
    return this.context.listMissions(contextInput, input);
  }

updateMission(contextInput: StoreContextEnvelope, input: UpdateMissionInput): MissionRecord{
    return this.context.updateMission(contextInput, input);
  }

transitionMission(
    contextInput: StoreContextEnvelope,
    input: {
      id: string;
      expectedRevision: number;
      status: Exclude<MissionLifecycleStatus, 'archived'>;
      phase?: MissionPhase;
      reason?: string;
      actorId: string;
    },
  ): MissionRecord{
    return this.context.transitionMission(contextInput, input);
  }

archiveMission(context: StoreContextEnvelope, input: ArchiveRestoreInput): MissionRecord{
    return this.context.archiveMission(context, input);
  }

restoreMission(context: StoreContextEnvelope, input: ArchiveRestoreInput): MissionRecord{
    return this.context.restoreMission(context, input);
  }

appendMissionCheckpoint(
    contextInput: StoreContextEnvelope,
    input: AppendMissionCheckpointInput,
  ): MissionCheckpointRecord{
    return this.context.appendMissionCheckpoint(contextInput, input);
  }

listMissionCheckpoints(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): MissionCheckpointRecord[]{
    return this.context.listMissionCheckpoints(contextInput, missionIdInput);
  }

appendMissionLink(contextInput: StoreContextEnvelope, input: AppendMissionLinkInput): MissionLinkRecord{
    return this.context.appendMissionLink(contextInput, input);
  }

getMissionLineage(contextInput: StoreContextEnvelope, missionIdInput: string): MissionLineageProjection{
    return this.context.getMissionLineage(contextInput, missionIdInput);
  }

captureWriteAuthority(contextInput: StoreContextEnvelope): MissionWriteAuthoritySnapshot{
    return this.context.captureWriteAuthority(contextInput);
  }

assertMissionMayCreateAuthority(contextInput: StoreContextEnvelope, missionId: string): void{
    return this.context.assertMissionMayCreateAuthority(contextInput, missionId);
  }

assertWriteAuthority(context: StoreContextEnvelope, authority: MissionWriteAuthoritySnapshot | undefined): void{
    return this.context.assertWriteAuthority(context, authority);
  }

issueMissionGrant(
    contextInput: StoreContextEnvelope,
    input: CreateMissionGrantInput,
  ): MissionGrantRecord{
    return this.context.issueMissionGrant(contextInput, input);
  }

getMissionGrant(contextInput: StoreContextEnvelope, idInput: string): MissionGrantRecord | undefined{
    return this.context.getMissionGrant(contextInput, idInput);
  }

assertPolicyUsage(contextInput: StoreContextEnvelope, policyVersionId: string, entityIds: readonly string[]): void{
    return this.context.assertPolicyUsage(contextInput, policyVersionId, entityIds);
  }

listMissionGrants(contextInput: StoreContextEnvelope, missionIdInput: string): MissionGrantRecord[]{
    return this.context.listMissionGrants(contextInput, missionIdInput);
  }

listMissionGrantEvents(
    contextInput: StoreContextEnvelope,
    missionIdInput: string,
  ): MissionGrantEventRecord[]{
    return this.context.listMissionGrantEvents(contextInput, missionIdInput);
  }

getMissionGrantTerminalEvent(
    contextInput: StoreContextEnvelope,
    grantIdInput: string,
  ): MissionGrantEventRecord | undefined{
    return this.context.getMissionGrantTerminalEvent(contextInput, grantIdInput);
  }

appendMissionGrantEvent(
    contextInput: StoreContextEnvelope,
    input: AppendMissionGrantEventInput,
  ): MissionGrantEventRecord{
    return this.context.appendMissionGrantEvent(contextInput, input);
  }

createDecision(contextInput: StoreContextEnvelope, input: CreateDecisionInput): DecisionRecord{
    return this.context.createDecision(contextInput, input);
  }

getDecision(contextInput: StoreContextEnvelope, idInput: string): DecisionRecord | undefined{
    return this.context.getDecision(contextInput, idInput);
  }

listDecisions(contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): DecisionRecord[]{
    return this.context.listDecisions(contextInput, input);
  }

reviseDecision(contextInput: StoreContextEnvelope, input: ReviseDecisionInput): DecisionRecord{
    return this.context.reviseDecision(contextInput, input);
  }

resolveDecision(contextInput: StoreContextEnvelope, input: ResolveDecisionInput): DecisionRecord{
    return this.context.resolveDecision(contextInput, input);
  }

listDecisionHistory(
    contextInput: StoreContextEnvelope,
    decisionIdInput: string,
  ): DecisionHistoryRecord[]{
    return this.context.listDecisionHistory(contextInput, decisionIdInput);
  }

createExperiment(contextInput: StoreContextEnvelope, input: CreateExperimentInput): ExperimentRecord{
    return this.context.createExperiment(contextInput, input);
  }

getExperiment(contextInput: StoreContextEnvelope, idInput: string): ExperimentRecord | undefined{
    return this.context.getExperiment(contextInput, idInput);
  }

listExperiments(contextInput: StoreContextEnvelope, input: ListDomainRecordsInput = {}): ExperimentRecord[]{
    return this.context.listExperiments(contextInput, input);
  }

updateExperiment(contextInput: StoreContextEnvelope, input: UpdateExperimentInput): ExperimentRecord{
    return this.context.updateExperiment(contextInput, input);
  }

transitionExperiment(
    contextInput: StoreContextEnvelope,
    input: TransitionExperimentInput,
  ): ExperimentRecord{
    return this.context.transitionExperiment(contextInput, input);
  }

evaluateExperiment(
    contextInput: StoreContextEnvelope,
    input: EvaluateExperimentInput,
  ): ExperimentRecord{
    return this.context.evaluateExperiment(contextInput, input);
  }

archiveExperiment(context: StoreContextEnvelope, input: ArchiveRestoreInput): ExperimentRecord{
    return this.context.archiveExperiment(context, input);
  }

restoreExperiment(context: StoreContextEnvelope, input: ArchiveRestoreInput): ExperimentRecord{
    return this.context.restoreExperiment(context, input);
  }

listExperimentObservations(
    contextInput: StoreContextEnvelope,
    experimentIdInput: string,
  ): ExperimentObservationRecord[]{
    return this.context.listExperimentObservations(contextInput, experimentIdInput);
  }

listExperimentMetricSnapshots(
    contextInput: StoreContextEnvelope,
    experimentIdInput: string,
  ): ExperimentMetricSnapshotRecord[]{
    return this.context.listExperimentMetricSnapshots(contextInput, experimentIdInput);
  }

appendExperimentObservation(
    contextInput: StoreContextEnvelope,
    input: AppendExperimentObservationInput,
  ): ExperimentObservationRecord{
    return this.context.appendExperimentObservation(contextInput, input);
  }

appendExperimentMetricSnapshot(
    contextInput: StoreContextEnvelope,
    input: AppendExperimentMetricSnapshotInput,
  ): ExperimentMetricSnapshotRecord{
    return this.context.appendExperimentMetricSnapshot(contextInput, input);
  }

appendCausalEvent(contextInput: StoreContextEnvelope, input: AppendCausalEventInput): CausalEventRecord{
    return this.context.appendCausalEvent(contextInput, input);
  }

appendCausalEventWithEvidence(
    contextInput: StoreContextEnvelope,
    input: AppendCausalEventInput,
    evidenceInputs: readonly AppendEvidenceRefInput[],
  ): AppendCausalEventWithEvidenceResult{
    return this.context.appendCausalEventWithEvidence(contextInput, input, evidenceInputs);
  }

listCausalEvents(
    contextInput: StoreContextEnvelope,
    input: { missionId?: string; stages?: readonly CausalLedgerStage[] } = {},
  ): CausalEventRecord[]{
    return this.context.listCausalEvents(contextInput, input);
  }

listAnalysisCausalMemory(
    contextInput: StoreContextEnvelope,
    input: { productId: string; limit?: number },
  ): AnalysisCausalMemoryItem[]{
    return this.context.listAnalysisCausalMemory(contextInput, input);
  }

appendCausalLink(contextInput: StoreContextEnvelope, input: AppendCausalLinkInput): CausalLinkRecord{
    return this.context.appendCausalLink(contextInput, input);
  }

appendEvidenceRef(contextInput: StoreContextEnvelope, input: AppendEvidenceRefInput): CausalEvidenceRefRecord{
    return this.context.appendEvidenceRef(contextInput, input);
  }

assertContext(contextInput: StoreContextEnvelope): StoreContextEnvelope{
    return this.context.assertContext(contextInput);
  }
}
