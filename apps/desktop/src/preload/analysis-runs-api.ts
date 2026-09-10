import type { AnalysisRunsApi } from '@amazon-ai-ops/shared-types';
export function createAnalysisRunsPreloadApi(ipc: { invoke(channel: string, request: unknown): Promise<unknown> }): AnalysisRunsApi {
  return Object.freeze({
    create: (request: Parameters<AnalysisRunsApi['create']>[0]) => ipc.invoke('analysis-runs:create', request),
    query: (request: Parameters<AnalysisRunsApi['query']>[0]) => ipc.invoke('analysis-runs:query', request),
    list: (request: Parameters<AnalysisRunsApi['list']>[0]) => ipc.invoke('analysis-runs:list', request),
  }) as AnalysisRunsApi;
}
export type AnalysisRunsPreloadApi = AnalysisRunsApi;
export type CreateRunResponse = Awaited<ReturnType<AnalysisRunsApi['create']>>;
export type QueryRunResponse = Awaited<ReturnType<AnalysisRunsApi['query']>>;
export type ListRunsResponse = Awaited<ReturnType<AnalysisRunsApi['list']>>;
