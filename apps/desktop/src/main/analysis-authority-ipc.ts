import type {
  AuthorizeAnalysisProposalBatchRequest,
  RunMissionAnalysisRequest,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { AnalysisAuthorityService } from './analysis-authority-service';
import { assertRendererPayloadIsPathFree } from './main-artifact-registry';

export const ANALYSIS_AUTHORITY_IPC_CHANNELS = Object.freeze([
  'analysis-authority:run-mission-analysis',
  'analysis-authority:get-mission-projection',
  'analysis-authority:authorize-proposal-batch',
] as const);

export const ANALYSIS_AUTHORITY_IPC_EVENTS = Object.freeze([
  'analysis-authority:analysis-completed',
] as const);

export interface AnalysisAuthorityIpcRegistrar {
  handle(channel: string, listener: (event: unknown, request?: unknown) => unknown): void;
}

type AnalysisAuthorityServicePort = Pick<AnalysisAuthorityService,
  'runMissionAnalysis' | 'getMissionAnalysisProjection' | 'authorizeProposalBatch'>;

export function registerAnalysisAuthorityIpcHandlers(
  ipc: AnalysisAuthorityIpcRegistrar,
  service: AnalysisAuthorityServicePort,
): void {
  ipc.handle(ANALYSIS_AUTHORITY_IPC_CHANNELS[0], async (_event, rawRequest) => {
    const request = readExactObject(rawRequest, [
      'context', 'missionId', 'dateFrom', 'dateTo',
    ], ['context', 'missionId']);
    const result = await service.runMissionAnalysis(request as unknown as RunMissionAnalysisRequest);
    assertRendererPayloadIsPathFree(result);
    return result;
  });
  ipc.handle(ANALYSIS_AUTHORITY_IPC_CHANNELS[1], (_event, rawRequest) => {
    const request = readExactObject(rawRequest, ['context', 'missionId'], ['context', 'missionId']);
    const result = service.getMissionAnalysisProjection(
      request.context as StoreContextEnvelope,
      String(request.missionId ?? ''),
    );
    assertRendererPayloadIsPathFree(result);
    return result;
  });
  ipc.handle(ANALYSIS_AUTHORITY_IPC_CHANNELS[2], (_event, rawRequest) => {
    const request = readExactObject(rawRequest, ['context', 'missionId', 'proposalIds'], [
      'context', 'missionId', 'proposalIds',
    ]);
    const result = service.authorizeProposalBatch(
      request as unknown as AuthorizeAnalysisProposalBatchRequest,
    );
    assertRendererPayloadIsPathFree(result);
    return result;
  });
}

function readExactObject(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Analysis authority IPC request must be an object.');
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => !allowedKeys.includes(key))) {
    throw new TypeError('Analysis authority IPC request contains an unsupported field.');
  }
  if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(request, key))) {
    throw new TypeError('Analysis authority IPC request is incomplete.');
  }
  if (!request.context || typeof request.context !== 'object' || Array.isArray(request.context)) {
    throw new TypeError('Analysis authority IPC context must be an object.');
  }
  return request;
}
