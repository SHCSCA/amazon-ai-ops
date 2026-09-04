/**
 * V16 Services Preload API
 *
 * Exposes V1.6 service-level IPC through the preload bridge.
 * Channels are prefixed `v16svc:` (service layer) and `v16:` (domain layer).
 *
 * @module v16-services-preload
 */

import type { IpcRenderer } from 'electron';
import { V16_SERVICE_CHANNELS } from '../main/v16-services-ipc';
import { V16_CHANNELS } from '../main/v16-domain-ipc';

export interface V16ServicesPreloadApi {
  // Decision service
  decisionPropose: (params: unknown) => Promise<unknown>;
  decisionGet: (params: unknown) => Promise<unknown>;
  decisionList: (params: unknown) => Promise<unknown>;
  decisionApprove: (params: unknown) => Promise<unknown>;
  decisionReject: (params: unknown) => Promise<unknown>;
  decisionSupersede: (params: unknown) => Promise<unknown>;
  decisionRecordExecution: (params: unknown) => Promise<unknown>;
  decisionRecordVerification: (params: unknown) => Promise<unknown>;
  decisionHistory: (params: unknown) => Promise<unknown>;

  // Grant service
  grantIssue: (params: unknown) => Promise<unknown>;
  grantGet: (params: unknown) => Promise<unknown>;
  grantList: (params: unknown) => Promise<unknown>;
  grantReserveSlot: (params: unknown) => Promise<unknown>;
  grantReleaseSlot: (params: unknown) => Promise<unknown>;
  grantRevoke: (params: unknown) => Promise<unknown>;
  grantInvalidate: (params: unknown) => Promise<unknown>;
  grantResidual: (params: unknown) => Promise<unknown>;
  grantEvents: (params: unknown) => Promise<unknown>;

  // Execution service
  executionPreflight: (params: unknown) => Promise<unknown>;
  executionCreateBatch: (params: unknown) => Promise<unknown>;
  executionRecordIntent: (params: unknown) => Promise<unknown>;
  executionRecordReadback: (params: unknown) => Promise<unknown>;
  executionFinalize: (params: unknown) => Promise<unknown>;
  executionGetSlot: (params: unknown) => Promise<unknown>;
  executionGetBatch: (params: unknown) => Promise<unknown>;
  executionListBatches: (params: unknown) => Promise<unknown>;
  executionListSlots: (params: unknown) => Promise<unknown>;

  // Experiment service
  experimentCreate: (params: unknown) => Promise<unknown>;
  experimentGet: (params: unknown) => Promise<unknown>;
  experimentList: (params: unknown) => Promise<unknown>;
  experimentStart: (params: unknown) => Promise<unknown>;
  experimentPause: (params: unknown) => Promise<unknown>;
  experimentBlock: (params: unknown) => Promise<unknown>;
  experimentRecordSnapshot: (params: unknown) => Promise<unknown>;
  experimentComplete: (params: unknown) => Promise<unknown>;
  experimentArchive: (params: unknown) => Promise<unknown>;

  // Memory service
  memoryAppend: (params: unknown) => Promise<unknown>;
  memoryCorrect: (params: unknown) => Promise<unknown>;
  memoryPromote: (params: unknown) => Promise<unknown>;
  memoryList: (params: unknown) => Promise<unknown>;
  memorySearchEntity: (params: unknown) => Promise<unknown>;
  memorySearchProduct: (params: unknown) => Promise<unknown>;
  memoryCountTrusted: (params: unknown) => Promise<unknown>;
  memoryExport: (params: unknown) => Promise<unknown>;
}

export function createV16ServicesPreloadApi(ipcRenderer: IpcRenderer): V16ServicesPreloadApi {
  return {
    // Decision
    decisionPropose: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_PROPOSE, params),
    decisionGet: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_GET, params),
    decisionList: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_LIST, params),
    decisionApprove: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_APPROVE, params),
    decisionReject: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_REJECT, params),
    decisionSupersede: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_SUPERSEDE, params),
    decisionRecordExecution: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_RECORD_EXECUTION, params),
    decisionRecordVerification: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_RECORD_VERIFICATION, params),
    decisionHistory: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.DECISION_HISTORY, params),

    // Grant
    grantIssue: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_ISSUE, params),
    grantGet: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_GET, params),
    grantList: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_LIST, params),
    grantReserveSlot: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_RESERVE_SLOT, params),
    grantReleaseSlot: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_RELEASE_SLOT, params),
    grantRevoke: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_REVOKE, params),
    grantInvalidate: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_INVALIDATE, params),
    grantResidual: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_RESIDUAL, params),
    grantEvents: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.GRANT_EVENTS, params),

    // Execution
    executionPreflight: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_PREFLIGHT, params),
    executionCreateBatch: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_CREATE_BATCH, params),
    executionRecordIntent: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_RECORD_INTENT, params),
    executionRecordReadback: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_RECORD_READBACK, params),
    executionFinalize: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_FINALIZE, params),
    executionGetSlot: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_GET_SLOT, params),
    executionGetBatch: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_GET_BATCH, params),
    executionListBatches: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_LIST_BATCHES, params),
    executionListSlots: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXECUTION_LIST_SLOTS, params),

    // Experiment
    experimentCreate: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_CREATE, params),
    experimentGet: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_GET, params),
    experimentList: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_LIST, params),
    experimentStart: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_START, params),
    experimentPause: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_PAUSE, params),
    experimentBlock: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_BLOCK, params),
    experimentRecordSnapshot: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_RECORD_SNAPSHOT, params),
    experimentComplete: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_COMPLETE, params),
    experimentArchive: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.EXPERIMENT_ARCHIVE, params),

    // Memory
    memoryAppend: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.MEMORY_APPEND, params),
    memoryCorrect: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.MEMORY_CORRECT, params),
    memoryPromote: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.MEMORY_PROMOTE, params),
    memoryList: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.MEMORY_LIST, params),
    memorySearchEntity: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.MEMORY_SEARCH_ENTITY, params),
    memorySearchProduct: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.MEMORY_SEARCH_PRODUCT, params),
    memoryCountTrusted: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.MEMORY_COUNT_TRUSTED, params),
    memoryExport: (params) => ipcRenderer.invoke(V16_SERVICE_CHANNELS.MEMORY_EXPORT, params),
  };
}
