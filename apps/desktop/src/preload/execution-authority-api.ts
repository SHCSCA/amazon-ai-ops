import type {
  AdExecutionBatchProjection,
  AdExecutionProgressEvent,
  AdExecutionTakeoverResult,
  AdKeywordIdentityVersionRecord,
  CancelAdExecutionBatchRequest,
  CreateAdExecutionBatchRequest,
  CreateAdExecutionBatchResult,
  ResolveAdExecutionIdentityRequest,
  StartAdExecutionBatchRequest,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';

type ExecutionAuthorityChannel =
  | 'execution-authority:list-batches'
  | 'execution-authority:resolve-identity'
  | 'execution-authority:create-batch'
  | 'execution-authority:start-batch'
  | 'execution-authority:cancel-batch'
  | 'execution-authority:take-over-browser';

type ProgressHandler = (event: unknown, payload: AdExecutionProgressEvent) => void;

export interface ExecutionAuthorityIpcBridge {
  invoke(channel: ExecutionAuthorityChannel, input: unknown): Promise<unknown>;
  on(channel: 'execution-authority:progress', listener: ProgressHandler): unknown;
  removeListener(channel: 'execution-authority:progress', listener: ProgressHandler): unknown;
}

export interface ExecutionAuthorityPreloadApi {
  listBatches(context: StoreContextEnvelope): Promise<readonly AdExecutionBatchProjection[]>;
  resolveIdentity(input: ResolveAdExecutionIdentityRequest): Promise<AdKeywordIdentityVersionRecord>;
  createBatch(input: CreateAdExecutionBatchRequest): Promise<CreateAdExecutionBatchResult>;
  startBatch(input: StartAdExecutionBatchRequest): Promise<AdExecutionBatchProjection>;
  cancelBatch(input: CancelAdExecutionBatchRequest): Promise<AdExecutionBatchProjection>;
  takeOverVisibleBrowser(input: StartAdExecutionBatchRequest): Promise<AdExecutionTakeoverResult>;
  onProgress(callback: (event: AdExecutionProgressEvent) => void): () => void;
}

/** Closed bridge: Renderer cannot choose channels, bid values, Ads ids or paths. */
export function createExecutionAuthorityPreloadApi(
  ipc: ExecutionAuthorityIpcBridge,
): ExecutionAuthorityPreloadApi {
  return Object.freeze({
    listBatches: (context: StoreContextEnvelope) => ipc.invoke(
      'execution-authority:list-batches',
      { context },
    ) as Promise<readonly AdExecutionBatchProjection[]>,
    resolveIdentity: (input: ResolveAdExecutionIdentityRequest) => ipc.invoke(
      'execution-authority:resolve-identity',
      input,
    ) as Promise<AdKeywordIdentityVersionRecord>,
    createBatch: (input: CreateAdExecutionBatchRequest) => ipc.invoke(
      'execution-authority:create-batch',
      input,
    ) as Promise<CreateAdExecutionBatchResult>,
    startBatch: (input: StartAdExecutionBatchRequest) => ipc.invoke(
      'execution-authority:start-batch',
      input,
    ) as Promise<AdExecutionBatchProjection>,
    cancelBatch: (input: CancelAdExecutionBatchRequest) => ipc.invoke(
      'execution-authority:cancel-batch',
      input,
    ) as Promise<AdExecutionBatchProjection>,
    takeOverVisibleBrowser: (input: StartAdExecutionBatchRequest) => ipc.invoke(
      'execution-authority:take-over-browser',
      input,
    ) as Promise<AdExecutionTakeoverResult>,
    onProgress: (callback: (event: AdExecutionProgressEvent) => void) => {
      if (typeof callback !== 'function') throw new TypeError('Execution progress callback is required.');
      const handler: ProgressHandler = (_event, payload) => callback(payload);
      ipc.on('execution-authority:progress', handler);
      return () => ipc.removeListener('execution-authority:progress', handler);
    },
  });
}
