import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppLifecycleRecoveryController } from './app-lifecycle-recovery';
import { startDesktopApplication } from './desktop-startup';
import { runtimeLogger } from './runtime-logger';

function harness() {
  const calls: string[] = [];
  const events = new Map<string, () => void>();
  const diagnostics = vi.fn();
  const quit = vi.fn();
  const recovery = createAppLifecycleRecoveryController({
    requestStrictQuit: quit,
    ensureVisibleWindow: vi.fn(),
    showCleanupFailureDialog: async () => 'keep-app-open',
    showSynchronousError: vi.fn(),
    reportDiagnostic: diagnostics,
  });
  const window = {
    isDestroyed: vi.fn(() => false), isMinimized: vi.fn(() => true),
    restore: vi.fn(), show: vi.fn(), focus: vi.fn(),
  };
  const options = {
    app: {
      whenReady: vi.fn(async () => { calls.push('ready'); }),
      on: vi.fn((event: 'second-instance' | 'activate', handler: () => void) => {
        calls.push(`register-${event}`); events.set(event, handler);
      }),
    },
    lifecycleRecovery: recovery,
    getMainWindow: vi.fn((): typeof window | null => window),
    countWindows: vi.fn(() => 0),
    initialize: vi.fn(async () => { calls.push('initialize'); }),
    registerIpcHandlers: vi.fn(() => { calls.push('ipc'); }),
    createWindow: vi.fn(() => { calls.push('window'); }),
    startBusinessDateMonitor: vi.fn(() => { calls.push('monitor'); }),
  };
  return { options, calls, events, window, diagnostics, quit };
}

beforeEach(() => { vi.spyOn(runtimeLogger, 'info').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('desktop startup assembly', () => {
  it('waits for readiness and preserves initialization, IPC, window and monitor order', async () => {
    const input = harness();
    await startDesktopApplication(input.options);
    expect(input.calls).toEqual([
      'register-second-instance', 'ready', 'initialize', 'ipc', 'window', 'monitor', 'register-activate',
    ]);
    expect(runtimeLogger.info).toHaveBeenCalledWith('main.message', { message: '[App] ready' });
    expect(runtimeLogger.info).toHaveBeenCalledWith('main.message', { message: '[App] ipc-ready' });
    expect(runtimeLogger.info).toHaveBeenCalledWith('main.message', { message: '[App] window-created' });
  });

  it('does not initialize before Electron readiness settles', async () => {
    const input = harness();
    let ready!: () => void;
    input.options.app.whenReady.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const pending = startDesktopApplication(input.options);
    expect(input.options.initialize).not.toHaveBeenCalled();
    expect(input.options.createWindow).not.toHaveBeenCalled();
    ready();
    await pending;
    expect(input.options.initialize).toHaveBeenCalledOnce();
  });

  it.each(['ready', 'initialize', 'ipc', 'window', 'monitor'] as const)(
    'contains a %s failure through the existing strict lifecycle boundary', async (phase) => {
      const input = harness();
      const error = new Error(`STARTUP_${phase.toUpperCase()}_FAILED`);
      if (phase === 'ready') input.options.app.whenReady.mockRejectedValue(error);
      if (phase === 'initialize') input.options.initialize.mockRejectedValue(error);
      if (phase === 'ipc') input.options.registerIpcHandlers.mockImplementation(() => { throw error; });
      if (phase === 'window') input.options.createWindow.mockImplementation(() => { throw error; });
      if (phase === 'monitor') input.options.startBusinessDateMonitor.mockImplementation(() => { throw error; });
      await expect(startDesktopApplication(input.options)).resolves.toBeUndefined();
      expect(input.diagnostics).toHaveBeenCalledWith('startup-bootstrap', error);
      expect(input.quit).toHaveBeenCalledOnce();
      expect(input.events.has('activate')).toBe(false);
      if (phase === 'ready' || phase === 'initialize') expect(input.options.registerIpcHandlers).not.toHaveBeenCalled();
      if (phase === 'ready' || phase === 'initialize' || phase === 'ipc') expect(input.options.createWindow).not.toHaveBeenCalled();
      if (phase !== 'monitor') expect(input.options.startBusinessDateMonitor).not.toHaveBeenCalled();
    },
  );

  it('restores and focuses the existing window on a second instance', async () => {
    const input = harness();
    await startDesktopApplication(input.options);
    input.events.get('second-instance')!();
    expect(input.window.restore).toHaveBeenCalledOnce();
    expect(input.window.show).toHaveBeenCalledOnce();
    expect(input.window.focus).toHaveBeenCalledOnce();
    input.options.getMainWindow.mockReturnValue(null);
    input.events.get('second-instance')!();
    input.options.getMainWindow.mockReturnValue(input.window);
    input.window.isDestroyed.mockReturnValue(true);
    input.events.get('second-instance')!();
    expect(input.window.show).toHaveBeenCalledOnce();
  });

  it('creates an activation window only when no windows remain', async () => {
    const input = harness();
    await startDesktopApplication(input.options);
    input.options.countWindows.mockReturnValue(1);
    input.events.get('activate')!();
    expect(input.options.createWindow).toHaveBeenCalledOnce();
    input.options.countWindows.mockReturnValue(0);
    input.events.get('activate')!();
    expect(input.options.createWindow).toHaveBeenCalledTimes(2);
  });
});
