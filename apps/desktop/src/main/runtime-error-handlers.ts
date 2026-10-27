import type { App, BrowserWindow } from 'electron';
import { runtimeLogger, type RuntimeLogPort } from './runtime-logger';
import { sanitizeRuntimeLogValue } from './runtime-log-sanitizer';

export function installGlobalRuntimeErrorHandlers(
  electronApp: App,
  logger: RuntimeLogPort = runtimeLogger,
): void {
  let shutdownRequested = false;
  const requestShutdown = (event: string, error: unknown): void => {
    logger.error(event, { error });
    if (shutdownRequested) return;
    shutdownRequested = true;
    process.exitCode = 1;
    try {
      electronApp.quit();
    } catch (shutdownError) {
      logger.error('runtime.fatal_shutdown_failed', { error: shutdownError });
      process.exit(1);
    }
  };

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logger.error('runtime.uncaught_exception', { error, origin });
  });
  process.on('unhandledRejection', (reason) => {
    requestShutdown('runtime.unhandled_rejection', reason);
  });
  electronApp.on('child-process-gone', (_event, details) => {
    logger.error('electron.child_process_gone', { details });
  });
}

export function installRendererProcessErrorHandler(
  window: BrowserWindow,
  logger: RuntimeLogPort = runtimeLogger,
  configuredPreloadPath = 'UNAVAILABLE',
): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('electron.renderer_process_gone', {
      windowId: window.id,
      details,
    });
  });
  const contents = window.webContents;
  const onPreloadError = (_event: unknown, reportedPreloadPath: string, error: Error): void => {
    // 只记录 Main 配置的路径别名；事件路径仅用于比对，原错先走统一脱敏。
    const context = sanitizeRuntimeLogValue({ windowId: window.id, configuredPreloadPath,
      reportedPreloadMatchesConfigured: configuredPreloadPath !== 'UNAVAILABLE' && reportedPreloadPath === configuredPreloadPath,
      error }) as Record<string, unknown>;
    try {
      logger.error('electron.preload_error', context);
    } catch (reportingError) {
      runtimeLogger.error('electron.preload_diagnostic_delivery_failed', sanitizeRuntimeLogValue({
        ...context, reportingError,
      }) as Record<string, unknown>);
    }
  };
  contents.on('preload-error', onPreloadError);
  contents.once('destroyed', () => contents.removeListener('preload-error', onPreloadError));
}
