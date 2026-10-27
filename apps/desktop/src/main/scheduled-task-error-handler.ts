import type { TaskName } from '@amazon-ai-ops/scheduler';
import { runtimeLogger, type RuntimeLogPort } from './runtime-logger';

export function notifyScheduledTask(
  phase: 'start' | 'complete' | 'error',
  taskName: TaskName,
  notify: () => void,
  logger: RuntimeLogPort = runtimeLogger,
): void {
  try {
    notify();
  } catch (error) {
    logger.error('scheduler.task_notification_failed', { phase, taskName, error });
  }
}

export function createScheduledTaskErrorHandler(
  notify?: (taskName: TaskName, error: Error) => void,
  logger: RuntimeLogPort = runtimeLogger,
): (taskName: TaskName, error: Error) => void {
  return (taskName, error) => {
    // 定时器没有 IPC 调用者；先记录原错，窗口通知失败也不能覆盖任务失败。
    logger.error('scheduler.task_failed', { taskName, error });
    notifyScheduledTask('error', taskName, () => notify?.(taskName, error), logger);
  };
}
