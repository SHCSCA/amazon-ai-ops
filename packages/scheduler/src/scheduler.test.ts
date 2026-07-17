import { describe, expect, it, vi } from 'vitest';

import { LocalScheduler } from './scheduler';

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
});
