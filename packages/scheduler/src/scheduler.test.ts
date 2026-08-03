import { describe, expect, it, vi } from 'vitest';

import { LocalScheduler } from './scheduler';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe('LocalScheduler public task contract', () => {
  it('returns task views that can cross an Electron structured-clone boundary', () => {
    const scheduler = new LocalScheduler();
    scheduler.register({
      name: 'health_check',
      cron: '0 8 * * *',
      enabled: false,
      callback: vi.fn(async () => {}),
    });

    const [task] = scheduler.getTasks();

    expect(() => structuredClone(task)).not.toThrow();
    expect(task).not.toHaveProperty('callback');
    expect(task).toMatchObject({
      name: 'health_check',
      cron: '0 8 * * *',
      enabled: false,
    });
  });

  it('rejects a failed manual run and records its observable outcome', async () => {
    const scheduler = new LocalScheduler();
    scheduler.register({
      name: 'health_check',
      cron: '0 8 * * *',
      enabled: false,
      callback: vi.fn(async () => {
        throw new Error('health endpoint unavailable');
      }),
    });

    await expect(scheduler.runNow('health_check')).rejects.toThrow('health endpoint unavailable');

    const [task] = scheduler.getTasks();
    expect(task).toMatchObject({
      lastStatus: 'failed',
      lastResult: expect.stringContaining('health endpoint unavailable'),
      duration: expect.any(Number),
    });
    expect(Number.isNaN(Date.parse(task.lastRun || ''))).toBe(false);
  });

  it('rejects enablement changes for an unknown task', () => {
    const scheduler = new LocalScheduler();

    expect(() => scheduler.setTaskEnabled('data_cleanup', true)).toThrow('Task data_cleanup not found');
    expect(() => scheduler.setTaskEnabled('data_cleanup', false)).toThrow('Task data_cleanup not found');
  });

  it('records the observable outcome of a successful manual run', async () => {
    const scheduler = new LocalScheduler();
    scheduler.register({
      name: 'health_check',
      cron: '0 8 * * *',
      enabled: false,
      callback: vi.fn(async () => {}),
    });

    await expect(scheduler.runNow('health_check')).resolves.toBeUndefined();

    const [task] = scheduler.getTasks();
    expect(task).toMatchObject({
      lastStatus: 'success',
      lastResult: expect.stringContaining('成功'),
      duration: expect.any(Number),
    });
    expect(Number.isNaN(Date.parse(task.lastRun || ''))).toBe(false);
  });

  it('keeps automatic scheduling alive after a task failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    const scheduler = new LocalScheduler();
    const taskError = vi.fn();
    scheduler.on('task:error', taskError);
    scheduler.register({
      name: 'health_check',
      cron: '1 0 8 * * *',
      enabled: true,
      callback: vi.fn(async () => {
        throw new Error('temporary failure');
      }),
    });

    try {
      scheduler.start();
      const firstNextRun = Date.parse(scheduler.getTasks()[0].nextRun || '');

      await vi.advanceTimersByTimeAsync(1_000);

      expect(taskError).toHaveBeenCalledWith('health_check', expect.any(Error));
      expect(Date.parse(scheduler.getTasks()[0].nextRun || '')).toBeGreaterThan(firstNextRun);
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }
  });

  it('does not report drained while an admitted scheduled callback is still running', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    const scheduler = new LocalScheduler();
    const callbackStarted = deferred();
    const releaseCallback = deferred();
    scheduler.register({
      name: 'health_check',
      cron: '1 0 8 * * *',
      enabled: true,
      callback: async () => {
        callbackStarted.resolve();
        await releaseCallback.promise;
      },
    });

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1_000);
      await callbackStarted.promise;

      let drained = false;
      const drain = scheduler.stopAndDrain(1_000).then(() => {
        drained = true;
      });
      await Promise.resolve();

      expect(drained).toBe(false);

      releaseCallback.resolve();
      await drain;
      expect(drained).toBe(true);
    } finally {
      releaseCallback.resolve();
      scheduler.stop();
      vi.useRealTimers();
    }
  });

  it('waits for an admitted runNow callback before proving drain', async () => {
    const scheduler = new LocalScheduler();
    const callbackStarted = deferred();
    const releaseCallback = deferred();
    scheduler.register({
      name: 'health_check',
      cron: '0 8 * * *',
      enabled: false,
      callback: async () => {
        callbackStarted.resolve();
        await releaseCallback.promise;
      },
    });

    const run = scheduler.runNow('health_check');
    await callbackStarted.promise;
    let drained = false;
    const drain = scheduler.stopAndDrain(1_000).then(() => {
      drained = true;
    });
    await Promise.resolve();

    expect(drained).toBe(false);

    releaseCallback.resolve();
    await expect(run).resolves.toBeUndefined();
    await expect(drain).resolves.toBeUndefined();
    expect(drained).toBe(true);
  });

  it('allows a fresh drain proof after a timed-out callback later settles while keeping admission closed', async () => {
    vi.useFakeTimers();
    const scheduler = new LocalScheduler();
    const callbackStarted = deferred();
    const releaseCallback = deferred();
    scheduler.register({
      name: 'health_check',
      cron: '0 8 * * *',
      enabled: false,
      callback: async () => {
        callbackStarted.resolve();
        await releaseCallback.promise;
      },
    });

    const run = scheduler.runNow('health_check');
    await callbackStarted.promise;
    const drainResult = scheduler.stopAndDrain(25).catch((error: unknown) => error);

    try {
      await vi.advanceTimersByTimeAsync(25);
      await expect(drainResult).resolves.toMatchObject({ code: 'DRAIN_TIMEOUT' });

      await expect(scheduler.runNow('health_check')).rejects.toMatchObject({ code: 'SCHEDULER_STOPPED' });
      releaseCallback.resolve();
      await expect(run).resolves.toBeUndefined();

      await expect(scheduler.stopAndDrain(25)).resolves.toBeUndefined();
      expect(() => scheduler.start()).toThrow(expect.objectContaining({ code: 'SCHEDULER_STOPPED' }));
    } finally {
      releaseCallback.resolve();
      await run;
      vi.useRealTimers();
    }
  });

  it('fails closed when an admitted callback rejects during drain', async () => {
    const scheduler = new LocalScheduler();
    const callbackStarted = deferred();
    const releaseCallback = deferred();
    const callbackFailure = new Error('scheduled work lost its authority lease');
    scheduler.register({
      name: 'health_check',
      cron: '0 8 * * *',
      enabled: false,
      callback: async () => {
        callbackStarted.resolve();
        await releaseCallback.promise;
      },
    });

    const runResult = scheduler.runNow('health_check').catch((error: unknown) => error);
    await callbackStarted.promise;
    const drainResult = scheduler.stopAndDrain(1_000).catch((error: unknown) => error);
    releaseCallback.reject(callbackFailure);

    await expect(runResult).resolves.toBe(callbackFailure);
    await expect(drainResult).resolves.toMatchObject({
      code: 'DRAIN_CALLBACK_FAILED',
      cause: callbackFailure,
    });
    await expect(scheduler.stopAndDrain(1_000)).resolves.toBeUndefined();
    await expect(scheduler.runNow('health_check')).rejects.toMatchObject({ code: 'SCHEDULER_STOPPED' });
  });

  it('synchronously clears timers and rejects every new execution admission after drain starts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    const scheduler = new LocalScheduler();
    const callback = vi.fn(async () => {});
    scheduler.register({
      name: 'health_check',
      cron: '1 0 8 * * *',
      enabled: true,
      callback,
    });
    scheduler.start();

    try {
      const drain = scheduler.stopAndDrain(1_000);
      const lateRun = scheduler.runNow('health_check').catch((error: unknown) => error);

      expect(() => scheduler.start()).toThrow(expect.objectContaining({ code: 'SCHEDULER_STOPPED' }));
      expect(() => scheduler.setTaskEnabled('health_check', true)).toThrow(
        expect.objectContaining({ code: 'SCHEDULER_STOPPED' }),
      );
      await expect(lateRun).resolves.toMatchObject({ code: 'SCHEDULER_STOPPED' });
      await expect(drain).resolves.toBeUndefined();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      scheduler.stop();
      vi.useRealTimers();
    }
  });

  it('joins repeated stopAndDrain calls to the first bounded drain outcome', async () => {
    vi.useFakeTimers();
    const scheduler = new LocalScheduler();
    const callbackStarted = deferred();
    const releaseCallback = deferred();
    scheduler.register({
      name: 'health_check',
      cron: '0 8 * * *',
      enabled: false,
      callback: async () => {
        callbackStarted.resolve();
        await releaseCallback.promise;
      },
    });

    const run = scheduler.runNow('health_check');
    await callbackStarted.promise;
    const firstDrain = scheduler.stopAndDrain(1_000);
    const joinedDrain = scheduler.stopAndDrain(0);
    expect(joinedDrain).toBe(firstDrain);
    let repeatedSettled = false;
    const repeatedDrain = joinedDrain.then(() => {
      repeatedSettled = true;
    });

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(repeatedSettled).toBe(false);

      releaseCallback.resolve();
      await expect(run).resolves.toBeUndefined();
      await expect(firstDrain).resolves.toBeUndefined();
      await expect(repeatedDrain).resolves.toBeUndefined();
      const successfulRetry = scheduler.stopAndDrain(0);
      expect(successfulRetry).toBe(firstDrain);
      await expect(successfulRetry).resolves.toBeUndefined();
    } finally {
      releaseCallback.resolve();
      scheduler.stop();
      vi.useRealTimers();
    }
  });
});
