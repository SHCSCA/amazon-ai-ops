import type { StoreContextEnvelope } from './store';
import type { AiSpendPolicy, AiSpendPolicyInput, AiSpendProjection } from './ai-spend';
import type { MissionRecord, CreateMissionInput, UpdateMissionInput, TransitionMissionInput, DecisionRecord, DecisionHistoryRecord, MissionGrantRecord, MissionGrantEventRecord, ExperimentRecord, CreateExperimentInput, UpdateExperimentInput, ExperimentObservationRecord, ExperimentMetricSnapshotRecord, CausalEventRecord, AppendCausalEventInput } from './mission-domain';
import type { RunMissionAnalysisRequest, RunMissionAnalysisResult, MissionAnalysisProjection, AuthorizeAnalysisProposalBatchRequest, AuthorizeAnalysisProposalBatchResult } from './analysis-authority';
import type { AdExecutionBatchProjection, CreateAdExecutionBatchResult, AdExecutionUnknownReconciliationResult, AdKeywordIdentityVersionRecord } from './execution-authority';

export const V16_API_VERSION = 'v16/1' as const;
export type V16Result<T> = { success: true; data: T } | { success: false; code: string; error: string };
export interface V16Request<T> { apiVersion: typeof V16_API_VERSION; storeContext: StoreContextEnvelope; input: T; }
type Contract<I, O> = { input: I; output: O };
type Id = { id: string };
type Revision = Id & { expectedRevision: number; reason?: string };
type Batch = { batchId: string };

/** V1.6 uses the durable production records and authority operations. */
export interface V16Contracts {
  aiSpendGet: Contract<Record<string, never>, AiSpendProjection>;
  aiSpendSave: Contract<AiSpendPolicyInput, AiSpendPolicy>;
  missionCreate: Contract<CreateMissionInput, MissionRecord>;
  missionGet: Contract<Id, MissionRecord | undefined>;
  missionList: Contract<{ includeArchived?: boolean }, MissionRecord[]>;
  missionUpdate: Contract<UpdateMissionInput, MissionRecord>;
  missionTransition: Contract<Omit<TransitionMissionInput, 'phase' | 'status'> & { status: 'active' | 'paused' }, MissionRecord>;
  missionArchive: Contract<Revision, MissionRecord>;
  missionRestore: Contract<Revision, MissionRecord>;
  decisionGet: Contract<Id, DecisionRecord | undefined>;
  decisionList: Contract<{ missionId?: string }, DecisionRecord[]>;
  decisionResolve: Contract<Revision & { status: 'approved' | 'rejected' | 'blocked' | 'superseded'; reason: string }, DecisionRecord>;
  decisionHistory: Contract<{ decisionId: string }, DecisionHistoryRecord[]>;
  grantIssue: Contract<Omit<AuthorizeAnalysisProposalBatchRequest, 'context'>, AuthorizeAnalysisProposalBatchResult>;
  grantGet: Contract<Id, MissionGrantRecord | undefined>;
  grantList: Contract<{ missionId: string }, MissionGrantRecord[]>;
  grantEvents: Contract<{ missionId: string }, MissionGrantEventRecord[]>;
  grantRevoke: Contract<{ id: string; grantId: string; reason?: string }, MissionGrantEventRecord>;
  executionResolveIdentity: Contract<{ grantId: string; adEntityId: string }, AdKeywordIdentityVersionRecord>;
  executionCreateBatch: Contract<{ grantId: string }, CreateAdExecutionBatchResult>;
  executionListBatches: Contract<Record<string, never>, AdExecutionBatchProjection[]>;
  executionStart: Contract<Batch, AdExecutionBatchProjection>;
  executionCancel: Contract<Batch & { reason?: string }, AdExecutionBatchProjection>;
  executionReconcile: Contract<Batch, AdExecutionUnknownReconciliationResult>;
  executionTakeover: Contract<Batch, { status: 'VISIBLE'; batchId: string }>;
  experimentCreate: Contract<CreateExperimentInput, ExperimentRecord>;
  experimentGet: Contract<Id, ExperimentRecord | undefined>;
  experimentList: Contract<{ includeArchived?: boolean; missionId?: string }, ExperimentRecord[]>;
  experimentUpdate: Contract<UpdateExperimentInput, ExperimentRecord>;
  experimentTransition: Contract<Revision & { status: 'draft' | 'running' | 'paused' | 'blocked' }, ExperimentRecord>;
  experimentEvaluate: Contract<Revision, ExperimentRecord>;
  experimentArchive: Contract<Revision, ExperimentRecord>;
  experimentRestore: Contract<Revision, ExperimentRecord>;
  experimentObservations: Contract<{ experimentId: string }, ExperimentObservationRecord[]>;
  experimentSnapshots: Contract<{ experimentId: string }, ExperimentMetricSnapshotRecord[]>;
  memoryList: Contract<{ missionId?: string }, CausalEventRecord[]>;
  memoryAppend: Contract<AppendCausalEventInput & { stage: 'FACT' | 'ANALYSIS' }, CausalEventRecord>;
  analysisRun: Contract<Omit<RunMissionAnalysisRequest, 'context'>, RunMissionAnalysisResult>;
  analysisProjection: Contract<{ missionId: string }, MissionAnalysisProjection>;
}
export type V16ServicesApi = { [K in keyof V16Contracts]: (request: V16Request<V16Contracts[K]['input']>) => Promise<V16Result<V16Contracts[K]['output']>> };

// Existing IPC handlers validate arguments and use the production transactions.
export const V16_SERVICE_ROUTES = {
  aiSpendGet: 'mission-domain:ai-spend:get', aiSpendSave: 'mission-domain:ai-spend:save',
  missionCreate: 'mission-domain:missions:create', missionGet: 'mission-domain:missions:get', missionList: 'mission-domain:missions:list',
  missionUpdate: 'mission-domain:missions:update', missionTransition: 'mission-domain:missions:transition', missionArchive: 'mission-domain:missions:archive', missionRestore: 'mission-domain:missions:restore',
  decisionGet: 'mission-domain:decisions:get', decisionList: 'mission-domain:decisions:list', decisionResolve: 'mission-domain:decisions:resolve-human', decisionHistory: 'mission-domain:decisions:history',
  grantIssue: 'analysis-authority:authorize-proposal-batch', grantGet: 'mission-domain:grants:get', grantList: 'mission-domain:grants:list', grantEvents: 'mission-domain:grants:list-events', grantRevoke: 'mission-domain:grants:revoke-human',
  executionResolveIdentity: 'execution-authority:resolve-identity', executionCreateBatch: 'execution-authority:create-batch', executionListBatches: 'execution-authority:list-batches', executionStart: 'execution-authority:start-batch', executionCancel: 'execution-authority:cancel-batch', executionReconcile: 'execution-authority:reconcile-unknown', executionTakeover: 'execution-authority:take-over-browser',
  experimentCreate: 'mission-domain:experiments:create', experimentGet: 'mission-domain:experiments:get', experimentList: 'mission-domain:experiments:list', experimentUpdate: 'mission-domain:experiments:update', experimentTransition: 'mission-domain:experiments:transition', experimentEvaluate: 'mission-domain:experiments:evaluate', experimentArchive: 'mission-domain:experiments:archive', experimentRestore: 'mission-domain:experiments:restore', experimentObservations: 'mission-domain:experiments:list-observations', experimentSnapshots: 'mission-domain:experiments:list-metric-snapshots',
  memoryList: 'mission-domain:causal:list-events', memoryAppend: 'mission-domain:causal:append-event',
  analysisRun: 'analysis-authority:run-mission-analysis', analysisProjection: 'analysis-authority:get-mission-projection',
} as const satisfies Record<keyof V16Contracts, string>;
export const V16_SERVICE_CHANNELS = Object.freeze(Object.fromEntries(Object.keys(V16_SERVICE_ROUTES).map(key => [key, `v16svc:${key}`]))) as Readonly<{ [K in keyof V16Contracts]: `v16svc:${K}` }>;
