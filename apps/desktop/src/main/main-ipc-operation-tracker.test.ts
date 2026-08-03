import { describe, expect, it, vi } from 'vitest';
import { MainIpcOperationTracker } from './main-ipc-operation-tracker';

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('MainIpcOperationTracker', () => {
  it('registers work synchronously and drains it before completing shutdown', async () => {
    const tracker = new MainIpcOperationTracker();
    const gate = deferred<string>();
    const events: string[] = [];
    const operation = tracker.run('deferred-dialog-import', () => {
      events.push('work-started');
      return gate.promise;
    });

    expect(events).toEqual(['work-started']);
    expect(tracker.inspect()).toEqual({ stopping: false, activeCount: 1 });
    const drain = tracker.stopAndDrain(1_000);
    expect(tracker.inspect()).toEqual({ stopping: true, activeCount: 1 });
    await expect(tracker.run('late-ai-write', () => 'unsafe')).rejects.toMatchObject({
      code: 'IPC_ADMISSION_CLOSED',
    });

    gate.resolve('imported');
    await expect(operation).resolves.toBe('imported');
    await expect(drain).resolves.toBeUndefined();
    expect(tracker.inspect()).toEqual({ stopping: true, activeCount: 0 });
  });

  it('allows a fresh drain proof after a timeout while admission stays closed', async () => {
    vi.useFakeTimers();
    try {
      const tracker = new MainIpcOperationTracker();
      const gate = deferred<void>();
      const operation = tracker.run('deferred-ai-diagnosis', () => gate.promise);
      const firstDrain = tracker.stopAndDrain(100);
      const firstDrainRejection = expect(firstDrain).rejects.toMatchObject({
        code: 'IPC_DRAIN_TIMEOUT',
      });

      await vi.advanceTimersByTimeAsync(100);
      await firstDrainRejection;
      expect(tracker.inspect()).toEqual({ stopping: true, activeCount: 1 });

      gate.resolve();
      await operation;
      await expect(tracker.stopAndDrain(100)).resolves.toBeUndefined();
      expect(tracker.inspect()).toEqual({ stopping: true, activeCount: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles synchronous handler failure without poisoning the drain proof', async () => {
    const tracker = new MainIpcOperationTracker();
    const failure = new Error('synchronous handler failure');
    const operation = tracker.run('sync-failure', () => {
      throw failure;
    });

    await expect(operation).rejects.toBe(failure);
    await expect(tracker.stopAndDrain()).resolves.toBeUndefined();
    expect(tracker.inspect()).toEqual({ stopping: true, activeCount: 0 });
  });
});
