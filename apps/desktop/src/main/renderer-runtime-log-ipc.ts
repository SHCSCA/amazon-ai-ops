import type { RuntimeLogPort } from '@amazon-ai-ops/shared-types';
import type { IpcHandlerRegistrar } from './store-ipc';
import { normalizeRendererRuntimeLogReport, RENDERER_RUNTIME_LOG_CHANNEL } from '../shared/runtime-log-contract';

export function registerRendererRuntimeLogIpc(registrar: IpcHandlerRegistrar, logger: RuntimeLogPort): void {
  registrar.handle(RENDERER_RUNTIME_LOG_CHANNEL, (_event, input) => {
    const report = normalizeRendererRuntimeLogReport(input);
    // 页面报告只能进入固定事件，不能冒充主进程业务审计记录。
    logger[report.level]('renderer.reported', { reportedEvent: report.event, details: report.context });
  });
}
