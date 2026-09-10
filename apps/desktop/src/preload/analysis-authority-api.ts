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
  on?(channel: 'analysis-authority:analysis-completed', listener: (...args: unknown[]) => void): void;
}

export interface AnalysisAuthorityPreloadApi {
  runMissionAnalysis(input: RunMissionAnalysisRequest): Promise<RunMissionAnalysisResult>;
  getMissionProjection(context: StoreContextEnvelope, missionId: string): Promise<MissionAnalysisProjection>;
  authorizeProposalBatch(input: AuthorizeAnalysisProposalBatchRequest): Promise<AuthorizeAnalysisProposalBatchResult>;
  onAnalysisCompleted(listener: (payload: unknown) => void): void;
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
    onAnalysisCompleted: (listener) => {
      ipc.on?.('analysis-authority:analysis-completed', (...args: unknown[]) => {
        listener(args.length > 1 ? args[1] : args[0]);
      });
    },
  });
}
