import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalScheduler } from '@amazon-ai-ops/scheduler';
import { RuntimeLogger } from './runtime-logger';
import { createScheduledTaskErrorHandler, notifyScheduledTask } from './scheduled-task-error-handler';

afterEach(() => { vi.useRealTimers(); });

function recordedLogger() {
  const records: Array<Record<string, any>> = [];
  const logger = new RuntimeLogger({
    append: (_directory, _date, line) => records.push(JSON.parse(line)),
    write: () => undefined,
  });
  logger.setOutputDirectory('isolated-log-port');
  return { logger, records };
}

describe('production scheduled failure logging', () => {
  it('binds the production scheduler callback to the shared failure logger', () => {
    const source = readFileSync(new URL('./main-application-initialization-runtime.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { createScheduledTaskErrorHandler, notifyScheduledTask } from './scheduled-task-error-handler'");
    expect(source).toContain('onTaskError: createScheduledTaskErrorHandler(');
    expect(source).toContain("webContents.send('scheduler:task-error'");
    expect(source).toContain("notifyScheduledTask('start', taskName");
    expect(source).toContain("notifyScheduledTask('complete', taskName");
  });

  it('persists an automatic task failure without a Renderer and keeps the original failed outcome', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 8, 0, 0));
    const { logger, records } = recordedLogger();
    const original = new Error('active store authority unavailable');
    const callback = vi.fn(async () => { throw original; });
    const scheduler = new LocalScheduler({ onTaskError: createScheduledTaskErrorHandler(undefined, logger) });
    scheduler.register({ name: 'health_check', cron: '1 0 8 * * *', enabled: true, callback });
    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(scheduler.getTasks()[0]).toMatchObject({ lastStatus: 'failed', lastResult: '失败：active store authority unavailable' });
      expect(records).toContainEqual(expect.objectContaining({
        level: 'error', event: 'scheduler.task_failed',
        context: expect.objectContaining({ taskName: 'health_check', error: expect.objectContaining({ message: original.message }) }),
      }));
    } finally {
      scheduler.stop();
    }
  });

  it('logs window delivery failure separately without replacing the original manual rejection', async () => {
    const { logger, records } = recordedLogger();
    const original = new Error('report generation failed');
    const notification = new Error('window destroyed');
    const scheduler = new LocalScheduler({
      onTaskError: createScheduledTaskErrorHandler(() => { throw notification; }, logger),
    });
    scheduler.register({ name: 'health_check', cron: '0 8 * * *', enabled: false, callback: async () => { throw original; } });
    await expect(scheduler.runNow('health_check')).rejects.toBe(original);
    expect(records.map(record => record.event)).toEqual(['scheduler.task_failed', 'scheduler.task_notification_failed']);
    expect(records[0].context.error.message).toBe(original.message);
    expect(records[1].context.error.message).toBe(notification.message);
  });

  it.each(['start', 'complete'] as const)('logs a %s notification failure while preserving the actual task success', async phase => {
    const { logger, records } = recordedLogger();
    const notification = new Error('window destroyed');
    const report = () => notifyScheduledTask(phase, 'health_check', () => { throw notification; }, logger);
    const callback = vi.fn(async () => undefined);
    const scheduler = new LocalScheduler({
      onTaskStart: phase === 'start' ? report : undefined,
      onTaskComplete: phase === 'complete' ? report : undefined,
      onTaskError: createScheduledTaskErrorHandler(undefined, logger),
    });
    scheduler.register({ name: 'health_check', cron: '0 8 * * *', enabled: false, callback });
    await expect(scheduler.runNow('health_check')).resolves.toBeUndefined();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(scheduler.getTasks()[0].lastStatus).toBe('success');
    expect(records).toContainEqual(expect.objectContaining({
      event: 'scheduler.task_notification_failed',
      context: expect.objectContaining({ phase, taskName: 'health_check', error: expect.objectContaining({ message: notification.message }) }),
    }));
  });
});
