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
    const firstPreventDefault = vi.fn();
    const repeatedPreventDefault = vi.fn();
    const handleBeforeQuit = createBeforeQuitCoordinator({
      cleanup: cleanupAction,
      requestQuit: vi.fn(),
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
  it('releases each resource reference and continues closing after an earlier failure', async () => {
    const browserError = new Error('browser close failed');
    const browserController = {
      close: vi.fn(async () => {
        throw browserError;
      }),
    };
    const scheduler = { stop: vi.fn() };
    const db = { close: vi.fn() };
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
    expect(reportError).toHaveBeenCalledWith('browserController', browserError);
  });
});
