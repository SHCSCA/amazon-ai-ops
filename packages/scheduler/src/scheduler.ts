import { EventEmitter } from 'events';

export type TaskName = 
  | 'daily_recommendation_generate'
  | 'daily_report_generate'
  | 'data_cleanup'
  | 'health_check';

export interface ScheduledTask {
  name: TaskName;
  cron: string;         // cron 表达式
  enabled: boolean;
  lastRun?: string;
  lastStatus?: 'success' | 'failed';
  lastResult?: string;
  duration?: number;
  nextRun?: string;
  callback: () => Promise<void>;
}

export type ScheduledTaskView = Omit<ScheduledTask, 'callback'>;

export interface SchedulerConfig {
  timezone?: string;    // 默认 'Asia/Shanghai'
  onTaskStart?: (taskName: TaskName) => void;
  onTaskComplete?: (taskName: TaskName, duration: number) => void;
  onTaskError?: (taskName: TaskName, error: Error) => void;
}

interface CronParts {
  second?: string;
  minute: string;
  hour: string;
  dayOfMonth?: string;
  month?: string;
  dayOfWeek?: string;
}

type LocalSchedulerErrorCode =
  | 'DRAIN_TIMEOUT'
  | 'DRAIN_CALLBACK_FAILED'
  | 'SCHEDULER_STOPPED';

class LocalSchedulerError extends Error {
  readonly code: LocalSchedulerErrorCode;

  constructor(code: LocalSchedulerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalSchedulerError';
    this.code = code;
  }
}

export class LocalScheduler extends EventEmitter {
  private tasks: Map<TaskName, ScheduledTask> = new Map();
  private timers: Map<TaskName, NodeJS.Timeout> = new Map();
  private inFlight: Set<Promise<void>> = new Set();
  private config: Required<SchedulerConfig>;
  private running: boolean = false;
  private admissionClosed: boolean = false;
  private drainPromise: Promise<void> | null = null;

  constructor(config: SchedulerConfig = {}) {
    super();
    this.config = {
      timezone: config.timezone || 'Asia/Shanghai',
      onTaskStart: config.onTaskStart || (() => {}),
      onTaskComplete: config.onTaskComplete || (() => {}),
      onTaskError: config.onTaskError || (() => {}),
    };
  }

  /**
   * 注册任务
   */
  register(task: Omit<ScheduledTask, 'nextRun'>): void {
    if (this.tasks.has(task.name)) {
      throw new Error(`Task ${task.name} already registered`);
    }
    this.tasks.set(task.name, {
      ...task,
      nextRun: this.calculateNextRun(task.cron).toISOString(),
    });
  }

  /**
   * 启动调度器
   */
  start(): void {
    this.assertAdmissionOpen();
    if (this.running) return;
    this.running = true;

    for (const [name, task] of this.tasks) {
      if (task.enabled) {
        this.scheduleTask(name);
      }
    }
  }

  /**
   * 停止调度器
   */
  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * 终止新任务准入并等待已经进入执行阶段的任务全部结束。
   */
  stopAndDrain(timeoutMs = 5_000): Promise<void> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new RangeError('local scheduler drain timeout must be a non-negative integer'));
    }
    if (this.drainPromise) {
      return this.drainPromise;
    }

    this.admissionClosed = true;
    this.stop();
    const admitted = [...this.inFlight];
    const drainAttempt = this.awaitSettlement(admitted, timeoutMs);
    this.drainPromise = drainAttempt;
    void drainAttempt.catch(() => {
      if (this.drainPromise === drainAttempt) {
        this.drainPromise = null;
      }
    });
    return drainAttempt;
  }

  /**
   * 手动触发任务
   */
  async runNow(taskName: TaskName): Promise<void> {
    const task = this.tasks.get(taskName);
    if (!task) {
      throw new Error(`Task ${taskName} not found`);
    }
    await this.admitTask(taskName, task);
  }

  /**
   * 启用/禁用任务
   */
  setTaskEnabled(taskName: TaskName, enabled: boolean): void {
    const task = this.tasks.get(taskName);
    if (!task) {
      throw new Error(`Task ${taskName} not found`);
    }
    if (enabled) {
      this.assertAdmissionOpen();
    }

    task.enabled = enabled;
    if (!enabled) {
      const timer = this.timers.get(taskName);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(taskName);
      }
    } else {
      this.scheduleTask(taskName);
    }
  }

  /**
   * 获取所有任务状态
   */
  getTasks(): ScheduledTaskView[] {
    return Array.from(this.tasks.values(), ({ callback: _callback, ...task }) => ({ ...task }));
  }

  private scheduleTask(taskName: TaskName): void {
    const task = this.tasks.get(taskName);
    if (!task || !task.enabled) return;

    const nextRun = this.calculateNextRunFromNow(task.cron);
    task.nextRun = nextRun.toISOString();

    const delay = nextRun.getTime() - Date.now();
    
    const timer = setTimeout(() => {
      this.timers.delete(taskName);
      void this.admitTask(taskName, task).catch(() => {
        // Timed runs report failures through task:error/onTaskError; only manual callers receive the rejection.
      }).finally(() => {
        if (this.running && task.enabled) {
          this.scheduleTask(taskName);
        }
      });
    }, Math.max(0, delay));

    this.timers.set(taskName, timer);
  }

  private admitTask(taskName: TaskName, task: ScheduledTask): Promise<void> {
    if (this.admissionClosed) {
      return Promise.reject(new LocalSchedulerError(
        'SCHEDULER_STOPPED',
        'Local scheduler is stopping; new task admission is closed',
      ));
    }

    let resolveTracked!: () => void;
    let rejectTracked!: (error: unknown) => void;
    const tracked = new Promise<void>((resolve, reject) => {
      resolveTracked = resolve;
      rejectTracked = reject;
    });
    this.inFlight.add(tracked);
    void this.executeTask(taskName, task).then(resolveTracked, rejectTracked);
    void tracked.then(
      () => { this.inFlight.delete(tracked); },
      () => { this.inFlight.delete(tracked); },
    );
    return tracked;
  }

  private assertAdmissionOpen(): void {
    if (this.admissionClosed) {
      throw new LocalSchedulerError(
        'SCHEDULER_STOPPED',
        'Local scheduler is stopping; new task admission is closed',
      );
    }
  }

  private async awaitSettlement(admitted: Promise<void>[], timeoutMs: number): Promise<void> {
    if (admitted.length === 0) {
      return;
    }

    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new LocalSchedulerError(
          'DRAIN_TIMEOUT',
          'Local scheduler drain timed out before all admitted tasks settled',
        ));
      }, timeoutMs);
    });

    try {
      const results = await Promise.race([
        Promise.allSettled(admitted),
        timeoutPromise,
      ]);
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected?.status === 'rejected') {
        const callbackError = rejected.reason instanceof Error
          ? rejected.reason
          : new Error(String(rejected.reason));
        throw new LocalSchedulerError(
          'DRAIN_CALLBACK_FAILED',
          `Local scheduler drain observed a failed admitted callback: ${callbackError.message}`,
          { cause: callbackError },
        );
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private async executeTask(taskName: TaskName, task: ScheduledTask): Promise<void> {
    const startTime = Date.now();
    this.config.onTaskStart(taskName);
    this.emit('task:start', taskName);

    try {
      await task.callback();
      const duration = Date.now() - startTime;
      task.lastRun = new Date().toISOString();
      task.lastStatus = 'success';
      task.lastResult = '执行成功';
      task.duration = duration;
      this.config.onTaskComplete(taskName, duration);
      this.emit('task:complete', taskName, duration);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      const duration = Date.now() - startTime;
      task.lastRun = new Date().toISOString();
      task.lastStatus = 'failed';
      task.lastResult = `失败：${normalizedError.message}`;
      task.duration = duration;
      this.config.onTaskError(taskName, normalizedError);
      this.emit('task:error', taskName, normalizedError);
      throw normalizedError;
    }
  }

  /**
   * 解析 cron 表达式并计算下次执行时间
   * 支持格式: "30 8 * * *" = 每天 8:30
   */
  private calculateNextRun(cron: string): Date {
    return this.calculateNextRunFromNow(cron);
  }

  private calculateNextRunFromNow(cron: string): Date {
    const parts = this.parseCron(cron);
    const now = new Date();
    let next = new Date(now);
    next.setSeconds(parts.second ? parseInt(parts.second) : 0);
    next.setMinutes(parts.minute ? parseInt(parts.minute) : next.getMinutes() + 1);

    if (parts.hour) {
      next.setHours(parseInt(parts.hour));
    }

    // 如果已过时间，明天再执行
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  private parseCron(cron: string): CronParts {
    const parts = cron.trim().split(/\s+/);
    return {
      second: parts.length === 6 ? parts[0] : undefined,
      minute: parts.length === 6 ? parts[1] : parts[0],
      hour: parts.length === 6 ? parts[2] : parts[1],
      dayOfMonth: parts.length === 6 ? parts[3] : parts[2],
      month: parts.length === 6 ? parts[4] : parts[3],
      dayOfWeek: parts.length === 6 ? parts[5] : parts[4],
    };
  }
}
