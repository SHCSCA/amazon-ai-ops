import { describe, expect, it, vi } from 'vitest';
import { cleanupAppResources, createBeforeQuitCoordinator } from './app-shutdown';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('before-quit coordinator', () => {
  it('holds the first quit until cleanup finishes, then requests a controlled quit', async () => {
    const cleanup = deferred();
    const preventDefault = vi.fn();
    const requestQuit = vi.fn();
    const handleBeforeQuit = createBeforeQuitCoordinator({
      cleanup: vi.fn(() => cleanup.promise),
      requestQuit,
      reportError: vi.fn(),
    });

    const completion = handleBeforeQuit({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(requestQuit).not.toHaveBeenCalled();

    cleanup.resolve();
    await completion;

    expect(requestQuit).toHaveBeenCalledOnce();
  });

  it('prevents repeated quit attempts while the same cleanup is still running', async () => {
    const cleanup = deferred();
    const cleanupAction = vi.fn(() => cleanup.promise);
    const requestQuit = vi.fn();
    const firstPreventDefault = vi.fn();
    const repeatedPreventDefault = vi.fn();
    const handleBeforeQuit = createBeforeQuitCoordinator({
      cleanup: cleanupAction,
      requestQuit,
      reportError: vi.fn(),
    });

    const firstCompletion = handleBeforeQuit({ preventDefault: firstPreventDefault });
    const repeatedCompletion = handleBeforeQuit({ preventDefault: repeatedPreventDefault });

    expect(firstPreventDefault).toHaveBeenCalledOnce();
    expect(repeatedPreventDefault).toHaveBeenCalledOnce();
    expect(cleanupAction).toHaveBeenCalledOnce();
    expect(repeatedCompletion).toBe(firstCompletion);

    cleanup.resolve();
    await firstCompletion;

    expect(requestQuit).toHaveBeenCalledOnce();
  });

  it('lets the controlled second before-quit event proceed without restarting cleanup', async () => {
    const cleanup = vi.fn();
    const requestQuit = vi.fn();
    const firstPreventDefault = vi.fn();
    const secondPreventDefault = vi.fn();
    const handleBeforeQuit = createBeforeQuitCoordinator({
      cleanup,
      requestQuit,
      reportError: vi.fn(),
    });

    await handleBeforeQuit({ preventDefault: firstPreventDefault });
    const secondCompletion = handleBeforeQuit({ preventDefault: secondPreventDefault });

    expect(firstPreventDefault).toHaveBeenCalledOnce();
    expect(requestQuit).toHaveBeenCalledOnce();
    expect(secondPreventDefault).not.toHaveBeenCalled();
    expect(secondCompletion).toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('reports a cleanup failure and still requests the controlled quit', async () => {
    const cleanupError = new Error('cleanup failed');
    const reportError = vi.fn();
    const requestQuit = vi.fn();
    const handleBeforeQuit = createBeforeQuitCoordinator({
      cleanup: vi.fn(async () => {
        throw cleanupError;
      }),
      requestQuit,
      reportError,
    });

    await handleBeforeQuit({ preventDefault: vi.fn() });

    expect(reportError).toHaveBeenCalledWith(cleanupError);
    expect(requestQuit).toHaveBeenCalledOnce();
  });
});

describe('app resource cleanup', () => {
  it('stops the scheduler before closing the browser and database, then continues after a failure', async () => {
    const browserError = new Error('browser close failed');
    const cleanupOrder: string[] = [];
    const browserController = {
      close: vi.fn(async () => {
        cleanupOrder.push('browserController');
        throw browserError;
      }),
    };
    const scheduler = { stop: vi.fn(() => { cleanupOrder.push('scheduler'); }) };
    const db = { close: vi.fn(() => { cleanupOrder.push('db'); }) };
    const resources = { browserController, scheduler, db };
    const reportError = vi.fn();

    const completion = cleanupAppResources(resources, reportError);

    expect(resources).toEqual({
      browserController: null,
      scheduler: null,
      db: null,
    });

    await completion;

    expect(browserController.close).toHaveBeenCalledOnce();
    expect(scheduler.stop).toHaveBeenCalledOnce();
    expect(db.close).toHaveBeenCalledOnce();
    expect(cleanupOrder).toEqual(['scheduler', 'browserController', 'db']);
    expect(reportError).toHaveBeenCalledWith('browserController', browserError);
  });

  it('reports a resource timeout and continues to the database without waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const browserClose = deferred();
      const cleanupOrder: string[] = [];
      const browserController = {
        close: vi.fn(() => {
          cleanupOrder.push('browserController');
          return browserClose.promise;
        }),
      };
      const scheduler = { stop: vi.fn(() => { cleanupOrder.push('scheduler'); }) };
      const db = { close: vi.fn(() => { cleanupOrder.push('db'); }) };
      const reportError = vi.fn();
      const completion = cleanupAppResources(
        { browserController, scheduler, db },
        reportError,
        { timeoutMs: 100 },
      );

      await vi.advanceTimersByTimeAsync(100);

      const databaseClosedBeforeBrowserResolved = db.close.mock.calls.length === 1;
      const timeoutReportBeforeBrowserResolved = reportError.mock.calls[0];
      browserClose.resolve();
      await completion;

      expect(databaseClosedBeforeBrowserResolved).toBe(true);
      expect(cleanupOrder).toEqual(['scheduler', 'browserController', 'db']);
      expect(timeoutReportBeforeBrowserResolved?.[0]).toBe('browserController');
      expect(timeoutReportBeforeBrowserResolved?.[1]).toMatchObject({
        name: 'AppResourceCleanupTimeoutError',
        resource: 'browserController',
        timeoutMs: 100,
      });
      expect(reportError).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
