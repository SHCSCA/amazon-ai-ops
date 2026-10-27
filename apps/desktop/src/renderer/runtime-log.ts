import { createRuntimeLogRecord, type RuntimeLogLevel, type RuntimeLogPort, type RuntimeLogRecord } from '@amazon-ai-ops/shared-types';
import type { RendererRuntimeLogReport } from '../shared/runtime-log-contract';

interface RuntimeLogBridge {
  reportRuntimeLog(report: RendererRuntimeLogReport): Promise<unknown>;
}

interface RendererLogOptions {
  getBridge(): RuntimeLogBridge | undefined;
  fallback(record: RuntimeLogRecord): void;
  now?(): Date;
}

export function createRendererRuntimeLog(options: RendererLogOptions): RuntimeLogPort {
  const fallback = (record: RuntimeLogRecord): void => {
    try { options.fallback(record); } catch { /* 剩余出口不可用时不覆盖页面原始错误。 */ }
  };
  const write = (level: RuntimeLogLevel, event: string, context?: Record<string, unknown>): void => {
    let record: RuntimeLogRecord;
    try {
      record = createRuntimeLogRecord(level, event, context, options.now?.());
    } catch (error) {
      fallback(createRuntimeLogRecord('error', 'renderer.log_encoding_failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      }));
      return;
    }
    const failed = (error: unknown): void => {
      fallback(record);
      fallback(createRuntimeLogRecord('error', 'renderer.log_delivery_failed', {
        originalEvent: event, errorName: error instanceof Error ? error.name : 'UnknownError',
      }));
    };
    try {
      const bridge = options.getBridge();
      if (!bridge) { fallback(record); return; }
      void Promise.resolve(bridge.reportRuntimeLog({ level, event, context: record.context })).catch(failed);
    } catch (error) { failed(error); }
  };
  return Object.freeze({
    info: (event: string, context?: Record<string, unknown>) => write('info', event, context),
    warn: (event: string, context?: Record<string, unknown>) => write('warn', event, context),
    error: (event: string, context?: Record<string, unknown>) => write('error', event, context),
  });
}

export const rendererRuntimeLog = createRendererRuntimeLog({
  getBridge: () => {
    if (typeof window === 'undefined') return undefined;
    const bridge = (window as unknown as { electronAPI?: Partial<RuntimeLogBridge> }).electronAPI;
    return typeof bridge?.reportRuntimeLog === 'function' ? bridge as RuntimeLogBridge : undefined;
  },
  fallback: (record) => console[record.level](JSON.stringify(record)),
});

const installedTargets = new WeakSet<object>();

export function installRendererRuntimeErrorHandlers(
  target: Pick<Window, 'addEventListener'> | undefined = typeof window === 'undefined' ? undefined : window,
  logger: RuntimeLogPort = rendererRuntimeLog,
): void {
  if (!target || installedTargets.has(target)) return;
  installedTargets.add(target);
  target.addEventListener('error', (event) => {
    const error = event as ErrorEvent;
    logger.error('renderer.uncaught_error', { error: error.error ?? error.message });
  });
  target.addEventListener('unhandledrejection', (event) => {
    logger.error('renderer.unhandled_rejection', { error: (event as PromiseRejectionEvent).reason });
  });
}
