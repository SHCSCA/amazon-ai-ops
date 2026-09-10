import { V16_API_VERSION } from '@amazon-ai-ops/shared-types/src/v16-api';
import type { AnalysisRunsApi, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { analysisRunFailureOperatorReason, type AnalysisAuthorityService } from './analysis-authority-service';
import type { StoreCoordinator } from './store-coordinator';
import { assertRendererPayloadIsPathFree } from './main-artifact-registry';
import { assertValidStoreContext } from './v16-store-context-guard';

export const ANALYSIS_RUNS_CHANNELS = { CREATE: 'analysis-runs:create', QUERY: 'analysis-runs:query', LIST: 'analysis-runs:list' } as const;
type Service = Pick<AnalysisAuthorityService, 'runMissionAnalysis' | 'getAnalysisRun' | 'listAnalysisRuns'>;
export function registerAnalysisRunsIpcHandlers(
  registrar: { handle(channel: string, listener: (event: unknown, request?: unknown) => unknown): void },
  service: Service,
  coordinator: Pick<StoreCoordinator, 'assertActiveStoreContext'>,
): void {
  for (const [operation, channel] of Object.entries(ANALYSIS_RUNS_CHANNELS)) {
    registrar.handle(channel, async (_event, raw) => {
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('分析请求格式无效。');
        const request = raw as Record<string, unknown>;
        if (request.apiVersion !== V16_API_VERSION) return { success: false, code: 'API_VERSION_MISMATCH', error: '分析接口版本不一致，请重新启动当前版本应用。' };
        if (Object.keys(request).some(key => !['apiVersion', 'storeContext', 'input'].includes(key))) throw new Error('分析请求包含未支持的字段。');
        const context: StoreContextEnvelope = assertValidStoreContext(request.storeContext);
        coordinator.assertActiveStoreContext(context);
        if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw new Error('分析请求缺少输入。');
        const input = request.input as Record<string, unknown>;
        const fields = operation === 'CREATE' ? ['missionId'] : operation === 'QUERY' ? ['runId'] : ['missionId', 'status', 'limit'];
        if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('分析请求包含未支持的字段。');
        const data = operation === 'CREATE' ? await service.runMissionAnalysis({ context, missionId: input.missionId as string })
          : operation === 'QUERY' ? service.getAnalysisRun(context, input.runId as string)
          : service.listAnalysisRuns(context, input as Parameters<Service['listAnalysisRuns']>[1]);
        coordinator.assertActiveStoreContext(context);
        assertRendererPayloadIsPathFree(data);
        return { success: true, data };
      } catch (error) {
        return { success: false, code: typeof (error as { code?: unknown })?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test((error as { code: string }).code) ? (error as { code: string }).code : 'ANALYSIS_RUN_BLOCKED', error: analysisRunFailureOperatorReason(error) };
      }
    });
  }
}
export type CreateRunResponse = Awaited<ReturnType<AnalysisRunsApi['create']>>;
export type QueryRunResponse = Awaited<ReturnType<AnalysisRunsApi['query']>>;
export type ListRunsResponse = Awaited<ReturnType<AnalysisRunsApi['list']>>;
