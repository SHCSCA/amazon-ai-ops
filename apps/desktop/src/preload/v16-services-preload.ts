import type { IpcRenderer } from 'electron';
import { V16_SERVICE_CHANNELS, type V16ServicesApi } from '@amazon-ai-ops/shared-types/src/v16-api';

export type V16ServicesPreloadApi = V16ServicesApi;
export function createV16ServicesPreloadApi(ipcRenderer: Pick<IpcRenderer, 'invoke'>): V16ServicesApi {
  return Object.freeze(Object.fromEntries(Object.entries(V16_SERVICE_CHANNELS).map(([method, channel]) => [method, (request: unknown) => ipcRenderer.invoke(channel, request)]))) as V16ServicesApi;
}
