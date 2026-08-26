import type {
  CancelAdExecutionBatchRequest,
  CreateAdExecutionBatchRequest,
  ResolveAdExecutionIdentityRequest,
  ReconcileUnknownAdExecutionBatchRequest,
  StartAdExecutionBatchRequest,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import type { ExecutionAuthorityService } from './execution-authority-service';
import { assertRendererPayloadIsPathFree } from './main-artifact-registry';

export const EXECUTION_AUTHORITY_IPC_CHANNELS = Object.freeze([
  'execution-authority:list-batches',
  'execution-authority:resolve-identity',
  'execution-authority:create-batch',
  'execution-authority:start-batch',
  'execution-authority:cancel-batch',
  'execution-authority:reconcile-unknown',
  'execution-authority:take-over-browser',
] as const);

export const EXECUTION_AUTHORITY_PROGRESS_CHANNEL = 'execution-authority:progress' as const;

export interface ExecutionAuthorityIpcRegistrar {
  handle(channel: string, listener: (event: unknown, request?: unknown) => unknown): void;
}

type ExecutionAuthorityServicePort = Pick<ExecutionAuthorityService,
  | 'listBatches'
  | 'resolveIdentity'
  | 'createBatch'
  | 'startBatch'
  | 'cancelBatch'
  | 'reconcileUnknownBatch'
  | 'takeOverVisibleBrowser'>;

export function registerExecutionAuthorityIpcHandlers(
  ipc: ExecutionAuthorityIpcRegistrar,
  service: ExecutionAuthorityServicePort,
): void {
  ipc.handle(EXECUTION_AUTHORITY_IPC_CHANNELS[0], (_event, rawRequest) => {
    const request = exactRequest(rawRequest, ['context'], ['context']);
    return rendererSafe(service.listBatches(request.context as StoreContextEnvelope));
  });
  ipc.handle(EXECUTION_AUTHORITY_IPC_CHANNELS[1], async (_event, rawRequest) => {
    const request = exactRequest(rawRequest, ['context', 'grantId', 'adEntityId'], [
      'context', 'grantId', 'adEntityId',
    ]);
    return rendererSafe(await service.resolveIdentity(
      request as unknown as ResolveAdExecutionIdentityRequest,
    ));
  });
  ipc.handle(EXECUTION_AUTHORITY_IPC_CHANNELS[2], (_event, rawRequest) => {
    const request = exactRequest(rawRequest, ['context', 'grantId'], ['context', 'grantId']);
    return rendererSafe(service.createBatch(request as unknown as CreateAdExecutionBatchRequest));
  });
  ipc.handle(EXECUTION_AUTHORITY_IPC_CHANNELS[3], async (_event, rawRequest) => {
    const request = exactRequest(rawRequest, ['context', 'batchId'], ['context', 'batchId']);
    return rendererSafe(await service.startBatch(request as unknown as StartAdExecutionBatchRequest));
  });
  ipc.handle(EXECUTION_AUTHORITY_IPC_CHANNELS[4], (_event, rawRequest) => {
    const request = exactRequest(rawRequest, ['context', 'batchId', 'reason'], ['context', 'batchId']);
    return rendererSafe(service.cancelBatch(request as unknown as CancelAdExecutionBatchRequest));
  });
  ipc.handle(EXECUTION_AUTHORITY_IPC_CHANNELS[5], async (_event, rawRequest) => {
    const request = exactRequest(rawRequest, ['context', 'batchId'], ['context', 'batchId']);
    return rendererSafe(await service.reconcileUnknownBatch(
      request as unknown as ReconcileUnknownAdExecutionBatchRequest,
    ));
  });
  ipc.handle(EXECUTION_AUTHORITY_IPC_CHANNELS[6], async (_event, rawRequest) => {
    const request = exactRequest(rawRequest, ['context', 'batchId'], ['context', 'batchId']);
    return rendererSafe(await service.takeOverVisibleBrowser(
      request as unknown as StartAdExecutionBatchRequest,
    ));
  });
}

function rendererSafe<T>(value: T): T {
  assertRendererPayloadIsPathFree(value);
  return value;
}

function exactRequest(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Execution authority IPC request must be an object.');
  }
  const request = value as Record<string, unknown>;
  if (Object.keys(request).some((key) => !allowedKeys.includes(key))) {
    throw new TypeError('Execution authority IPC request contains an unsupported field.');
  }
  if (requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(request, key))) {
    throw new TypeError('Execution authority IPC request is incomplete.');
  }
  if (!request.context || typeof request.context !== 'object' || Array.isArray(request.context)) {
    throw new TypeError('Execution authority IPC context must be an object.');
  }
  return request;
}
