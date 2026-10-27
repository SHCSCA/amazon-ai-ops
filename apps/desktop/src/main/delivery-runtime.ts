import { createLegacyDeliveryRuntime, type DeliveryRuntimeOptions } from './delivery-legacy-runtime';
import { createV16DeliveryRuntime, type DeliveryV16Host } from './delivery-v16-runtime';
export type { DeliveryRuntimeOptions, DeliveryRuntimePaths } from './delivery-legacy-runtime';

export function createDeliveryRuntime(options: DeliveryRuntimeOptions & { readonly v16Host?: DeliveryV16Host }) {
  const version = /^(\d+)\.(\d+)\./.exec(options.appVersion);
  if (!version || Number(version[1]) > 1 || Number(version[1]) === 1 && Number(version[2]) >= 6) {
    return createV16DeliveryRuntime(options, options.v16Host);
  }
  const legacy = createLegacyDeliveryRuntime(options);
  return {
    getReadiness: async () => legacy.getReadiness(),
    getEvidenceStatus: async (input?: unknown) => legacy.getEvidenceStatus(input),
    refreshFinalReadiness: async (input?: { adReadbackPath?: string }) => legacy.refreshFinalReadiness(input),
    getStoragePaths: legacy.getStoragePaths,
    exportBundle: undefined,
    invalidateAuthority: (_reason: string) => undefined,
    stopAndDrain: async (ipcDrain?: () => Promise<void>) => { await ipcDrain?.(); },
  };
}
