import { RENDERER_RUNTIME_LOG_CHANNEL, type RendererRuntimeLogReport } from '../shared/runtime-log-contract';

export function createRuntimeLogPreloadApi(ipc: { invoke(channel: string, input: unknown): Promise<unknown> }) {
  return Object.freeze({
    reportRuntimeLog: (report: RendererRuntimeLogReport) => ipc.invoke(RENDERER_RUNTIME_LOG_CHANNEL, report),
  });
}
