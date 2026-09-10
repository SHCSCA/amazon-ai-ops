import { V16_API_VERSION, V16_SERVICE_CHANNELS, V16_SERVICE_ROUTES, type V16Result } from '@amazon-ai-ops/shared-types/src/v16-api';
import type { StoreCoordinator } from './store-coordinator';
import { registerMissionDomainIpcHandlers } from './mission-domain-ipc';
import { registerAnalysisAuthorityIpcHandlers } from './analysis-authority-ipc';
import { registerExecutionAuthorityIpcHandlers } from './execution-authority-ipc';
import { assertRendererPayloadIsPathFree } from './main-artifact-registry';
import { assertValidStoreContext } from './v16-store-context-guard';

export { V16_SERVICE_CHANNELS };
export interface V16ServicesIpcRegistrar {
  handle(channel: string, listener: (event: unknown, request?: unknown) => unknown): void;
}
export interface V16Services {
  domain: Parameters<typeof registerMissionDomainIpcHandlers>[1];
  analysis: Parameters<typeof registerAnalysisAuthorityIpcHandlers>[1];
  execution: Parameters<typeof registerExecutionAuthorityIpcHandlers>[1];
  storeCoordinator: Pick<StoreCoordinator, 'assertActiveStoreContext'>;
}

export function registerV16ServicesIpc(registrar: V16ServicesIpcRegistrar, services: V16Services): void {
  const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
  const collect: V16ServicesIpcRegistrar = { handle: (channel, handler) => { handlers.set(channel, handler); } };
  registerMissionDomainIpcHandlers(collect, services.domain);
  registerAnalysisAuthorityIpcHandlers(collect, services.analysis);
  registerExecutionAuthorityIpcHandlers(collect, services.execution);
  for (const method of Object.keys(V16_SERVICE_ROUTES) as Array<keyof typeof V16_SERVICE_ROUTES>) {
    const route = V16_SERVICE_ROUTES[method];
    const handler = handlers.get(route);
    if (!handler) throw new Error(`V16_HANDLER_MISSING: ${route}`);
    registrar.handle(V16_SERVICE_CHANNELS[method], async (event, raw): Promise<V16Result<unknown>> => {
      try {
        const request = object(raw);
        if (request.apiVersion !== V16_API_VERSION) return { success: false, code: 'API_VERSION_MISMATCH', error: '应用接口版本不兼容，请更新并重新打开应用。' };
        if (Object.keys(request).some(key => !['apiVersion', 'storeContext', 'input'].includes(key))) throw new TypeError('Unexpected request field');
        const context = assertValidStoreContext(request.storeContext);
        const input = object(request.input);
        if (['context', 'storeContext', 'storeId', 'browserProfileId'].some(key => key in input)) throw new TypeError('Input cannot override store authority');
        services.storeCoordinator.assertActiveStoreContext(context);
        const nativeRequest = route.startsWith('mission-domain:') ? { storeContext: context, input } : { ...input, context };
        const data = await handler(event, nativeRequest);
        services.storeCoordinator.assertActiveStoreContext(context);
        assertRendererPayloadIsPathFree(data);
        return { success: true, data };
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code) ? error.code : 'V16_OPERATION_FAILED';
        return { success: false, code, error: '操作未完成。请检查当前店铺、数据批次和授权状态，刷新后重试；结果不确定的执行只能只读对账。' };
      }
    });
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Request and input must be objects');
  return value as Record<string, unknown>;
}
