import type { AppLifecycleRecoveryController } from './app-lifecycle-recovery';
import { runtimeLog } from './runtime-log-adapter';

interface StartupAppPort {
  whenReady(): Promise<unknown>;
  on(event: 'second-instance' | 'activate', listener: () => void): unknown;
}

interface StartupWindowPort {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

interface DesktopStartupOptions {
  app: StartupAppPort;
  lifecycleRecovery: Pick<AppLifecycleRecoveryController, 'runStartupBootstrap'>;
  getMainWindow(): StartupWindowPort | null;
  countWindows(): number;
  initialize(): Promise<void>;
  registerIpcHandlers(): void;
  createWindow(): unknown;
  startBusinessDateMonitor(): void;
}

export function startDesktopApplication(options: DesktopStartupOptions): Promise<void> {
  const { app } = options;
  app.on('second-instance', () => {
    const window = options.getMainWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  return options.lifecycleRecovery.runStartupBootstrap(async () => {
    await app.whenReady();
    runtimeLog.log('[App] ready');
    await options.initialize();
    options.registerIpcHandlers();
    runtimeLog.log('[App] ipc-ready');
    options.createWindow();
    options.startBusinessDateMonitor();
    runtimeLog.log('[App] window-created');

    app.on('activate', () => {
      if (options.countWindows() === 0) options.createWindow();
    });
  });
}
