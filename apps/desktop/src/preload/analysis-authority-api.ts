import type {
  AuthorizeAnalysisProposalBatchRequest,
  AuthorizeAnalysisProposalBatchResult,
  MissionAnalysisProjection,
  RunMissionAnalysisRequest,
  RunMissionAnalysisResult,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

type AnalysisAuthorityChannel =
  | 'analysis-authority:run-mission-analysis'
  | 'analysis-authority:get-mission-projection'
  | 'analysis-authority:authorize-proposal-batch';

export interface AnalysisAuthorityIpcInvoker {
  invoke(channel: AnalysisAuthorityChannel, input: unknown): Promise<unknown>;
}

export interface AnalysisAuthorityPreloadApi {
  runMissionAnalysis(input: RunMissionAnalysisRequest): Promise<RunMissionAnalysisResult>;
  getMissionProjection(context: StoreContextEnvelope, missionId: string): Promise<MissionAnalysisProjection>;
  authorizeProposalBatch(input: AuthorizeAnalysisProposalBatchRequest): Promise<AuthorizeAnalysisProposalBatchResult>;
}

/** Closed bridge; Renderer callers cannot choose a channel or provide grant fields. */
export function createAnalysisAuthorityPreloadApi(
  ipc: AnalysisAuthorityIpcInvoker,
): AnalysisAuthorityPreloadApi {
  return Object.freeze({
    runMissionAnalysis: (input: RunMissionAnalysisRequest) => ipc.invoke(
      'analysis-authority:run-mission-analysis',
      input,
    ) as Promise<RunMissionAnalysisResult>,
    getMissionProjection: (context: StoreContextEnvelope, missionId: string) => ipc.invoke(
      'analysis-authority:get-mission-projection',
      { context, missionId },
    ) as Promise<MissionAnalysisProjection>,
    authorizeProposalBatch: (input: AuthorizeAnalysisProposalBatchRequest) => ipc.invoke(
      'analysis-authority:authorize-proposal-batch',
      input,
    ) as Promise<AuthorizeAnalysisProposalBatchResult>,
  });
}
