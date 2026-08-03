import { describe, expect, it, vi } from 'vitest';
import { createBeforeQuitCoordinator, type BeforeQuitHandler } from './app-shutdown';
import {
  createAppLifecycleRecoveryController,
  type AppLifecycleRecoveryOptions,
  type CleanupFailureDecision,
} from './app-lifecycle-recovery';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createOptions(
  overrides: Partial<AppLifecycleRecoveryOptions> = {},
): AppLifecycleRecoveryOptions {
  return {
    requestStrictQuit: vi.fn(),
    ensureVisibleWindow: vi.fn(),
    showCleanupFailureDialog: vi.fn(async () => 'keep-app-open'),
    showSynchronousError: vi.fn(),
    reportDiagnostic: vi.fn(),
    ...overrides,
  };
}

function createSimulatedStrictQuitLifecycle(input: {
  cleanup: () => Promise<void> | void;
  showCleanupFailureDialog: AppLifecycleRecoveryOptions['showCleanupFailureDialog'];
  ensureVisibleWindow?: () => void;
}) {
  let beforeQuit!: BeforeQuitHandler;
  const preventedEvents: Array<ReturnType<typeof vi.fn>> = [];
  const appQuit = vi.fn(() => {
    const preventDefault = vi.fn();
    preventedEvents.push(preventDefault);
    return beforeQuit({ preventDefault });
  });
  const cleanup = vi.fn(input.cleanup);
  const controller = createAppLifecycleRecoveryController(createOptions({
    requestStrictQuit: appQuit,
    ensureVisibleWindow: input.ensureVisibleWindow ?? vi.fn(),
    showCleanupFailureDialog: input.showCleanupFailureDialog,
  }));
  beforeQuit = createBeforeQuitCoordinator({
    cleanup,
    requestQuit: appQuit,
    reportError: (error) => {
      void controller.handleCleanupFailure(error);
    },
    cleanupFailurePolicy: 'fail-closed',
  });
  return { appQuit, cleanup, controller, preventedEvents };
}

describe('app lifecycle recovery', () => {
  it('consumes a startup rejection and requests the same strict quit path', async () => {
    const startupError = new Error('partial startup failed');
    const options = createOptions();
    const controller = createAppLifecycleRecoveryController(options);

    await expect(controller.runStartupBootstrap(async () => {
      throw startupError;
    })).resolves.toBeUndefined();

    expect(options.reportDiagnostic).toHaveBeenCalledWith('startup-bootstrap', startupError);
    expect(options.showSynchronousError).toHaveBeenCalledWith(
      '应用启动失败',
      expect.stringContaining('partial startup failed'),
    );
    expect(options.requestStrictQuit).toHaveBeenCalledOnce();
  });

  it('routes a partial startup failure through before-quit cleanup instead of direct exit', async () => {
    const lifecycle = createSimulatedStrictQuitLifecycle({
      cleanup: vi.fn(),
      showCleanupFailureDialog: vi.fn(async () => 'keep-app-open'),
    });

    await lifecycle.controller.runStartupBootstrap(async () => {
      throw new Error('startup failed after opening resources');
    });
    await vi.waitFor(() => {
      expect(lifecycle.cleanup).toHaveBeenCalledOnce();
      expect(lifecycle.appQuit).toHaveBeenCalledTimes(2);
    });

    expect(lifecycle.preventedEvents[0]).toHaveBeenCalledOnce();
    expect(lifecycle.preventedEvents[1]).not.toHaveBeenCalled();
  });

  it('keeps a window-all-closed cleanup rejection fail-closed and restores a visible window', async () => {
    const ensureVisibleWindow = vi.fn();
    const lifecycle = createSimulatedStrictQuitLifecycle({
      cleanup: vi.fn(async () => {
        throw new Error('drain timed out');
      }),
      showCleanupFailureDialog: vi.fn(async () => 'keep-app-open'),
      ensureVisibleWindow,
    });

    lifecycle.appQuit();
    await vi.waitFor(() => {
      expect(ensureVisibleWindow).toHaveBeenCalledOnce();
    });
    await lifecycle.controller.waitForIdle();

    expect(lifecycle.preventedEvents[0]).toHaveBeenCalledOnce();
    expect(lifecycle.appQuit).toHaveBeenCalledOnce();
  });

  it('retries strict cleanup after the native retry decision and only then permits exit', async () => {
    const cleanupError = new Error('first drain failed');
    const lifecycle = createSimulatedStrictQuitLifecycle({
      cleanup: vi.fn()
        .mockRejectedValueOnce(cleanupError)
        .mockResolvedValueOnce(undefined),
      showCleanupFailureDialog: vi.fn(async () => 'retry-safe-quit'),
    });

    lifecycle.appQuit();
    await lifecycle.controller.waitForIdle();
    await vi.waitFor(() => {
      expect(lifecycle.cleanup).toHaveBeenCalledTimes(2);
      expect(lifecycle.appQuit).toHaveBeenCalledTimes(3);
    });

    expect(lifecycle.preventedEvents[0]).toHaveBeenCalledOnce();
    expect(lifecycle.preventedEvents[1]).toHaveBeenCalledOnce();
    expect(lifecycle.preventedEvents[2]).not.toHaveBeenCalled();
  });

  it('falls back to a synchronous native error and visible window when the dialog rejects', async () => {
    const dialogError = new Error('native async dialog failed');
    const options = createOptions({
      showCleanupFailureDialog: vi.fn(async () => {
        throw dialogError;
      }),
    });
    const controller = createAppLifecycleRecoveryController(options);

    await controller.handleCleanupFailure(new Error('cleanup failed'));

    expect(options.requestStrictQuit).not.toHaveBeenCalled();
    expect(options.showSynchronousError).toHaveBeenCalledOnce();
    expect(options.ensureVisibleWindow).toHaveBeenCalledOnce();
    expect(options.reportDiagnostic).toHaveBeenCalledWith('shutdown-recovery-dialog', dialogError);
  });

  it('still attempts a visible window when the synchronous fallback dialog also fails', async () => {
    const syncDialogError = new Error('sync native dialog failed');
    const options = createOptions({
      showCleanupFailureDialog: vi.fn(async () => {
        throw new Error('async native dialog failed');
      }),
      showSynchronousError: vi.fn(() => {
        throw syncDialogError;
      }),
    });
    const controller = createAppLifecycleRecoveryController(options);

    await expect(controller.handleCleanupFailure(new Error('cleanup failed'))).resolves.toBeUndefined();

    expect(options.ensureVisibleWindow).toHaveBeenCalledOnce();
    expect(options.reportDiagnostic).toHaveBeenCalledWith(
      'shutdown-recovery-sync-dialog',
      syncDialogError,
    );
  });

  it('stays fail-closed and restores a visible surface when retry cannot request app.quit', async () => {
    const quitError = new Error('app.quit failed');
    const options = createOptions({
      requestStrictQuit: vi.fn(() => {
        throw quitError;
      }),
      showCleanupFailureDialog: vi.fn(async () => 'retry-safe-quit'),
    });
    const controller = createAppLifecycleRecoveryController(options);

    await expect(controller.handleCleanupFailure(new Error('cleanup failed'))).resolves.toBeUndefined();

    expect(options.showSynchronousError).toHaveBeenCalledOnce();
    expect(options.ensureVisibleWindow).toHaveBeenCalledOnce();
    expect(options.reportDiagnostic).toHaveBeenCalledWith(
      'shutdown-recovery-strict-quit-request',
      quitError,
    );
  });

  it('serializes cleanup failure dialogs, including an immediate retry failure', async () => {
    const firstDecision = deferred<CleanupFailureDecision>();
    const secondDecision = deferred<CleanupFailureDecision>();
    let concurrentDialogs = 0;
    let maximumConcurrentDialogs = 0;
    const showCleanupFailureDialog = vi.fn()
      .mockImplementationOnce(async () => {
        concurrentDialogs += 1;
        maximumConcurrentDialogs = Math.max(maximumConcurrentDialogs, concurrentDialogs);
        const decision = await firstDecision.promise;
        concurrentDialogs -= 1;
        return decision;
      })
      .mockImplementationOnce(async () => {
        concurrentDialogs += 1;
        maximumConcurrentDialogs = Math.max(maximumConcurrentDialogs, concurrentDialogs);
        const decision = await secondDecision.promise;
        concurrentDialogs -= 1;
        return decision;
      });
    const controller = createAppLifecycleRecoveryController(createOptions({
      showCleanupFailureDialog,
    }));

    const firstRecovery = controller.handleCleanupFailure(new Error('first cleanup failure'));
    await vi.waitFor(() => expect(showCleanupFailureDialog).toHaveBeenCalledOnce());
    const coalescedRecovery = controller.handleCleanupFailure(new Error('retry cleanup failure'));

    expect(coalescedRecovery).toBe(firstRecovery);
    expect(showCleanupFailureDialog).toHaveBeenCalledOnce();

    firstDecision.resolve('keep-app-open');
    await vi.waitFor(() => expect(showCleanupFailureDialog).toHaveBeenCalledTimes(2));
    expect(maximumConcurrentDialogs).toBe(1);

    secondDecision.resolve('keep-app-open');
    await controller.waitForIdle();
    expect(maximumConcurrentDialogs).toBe(1);
  });
});
