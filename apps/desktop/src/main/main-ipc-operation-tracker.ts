export type MainIpcOperationTrackerErrorCode = 'IPC_ADMISSION_CLOSED' | 'IPC_DRAIN_TIMEOUT';

export class MainIpcOperationTrackerError extends Error {
  constructor(
    readonly code: MainIpcOperationTrackerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MainIpcOperationTrackerError';
  }
}

/**
 * Process-wide Main IPC admission boundary. Every ipcMain.handle callback is
 * registered before its body runs, so strict shutdown can close admission in
 * the same call stack and prove that no dialog, AI request, browser task or DB
 * write remains before authority resources are closed.
 */
export class MainIpcOperationTracker {
  private stopping = false;
  private readonly active = new Set<Promise<unknown>>();

  run<Result>(
    label: string,
    work: () => Promise<Result> | Result,
  ): Promise<Result> {
    if (this.stopping) {
      return Promise.reject(new MainIpcOperationTrackerError(
        'IPC_ADMISSION_CLOSED',
        `Main IPC admission is closed during shutdown: ${label}`,
      ));
    }
    if (typeof work !== 'function') {
      return Promise.reject(new TypeError('Main IPC operation callback is required.'));
    }

    let resolveOperation!: (result: Result | PromiseLike<Result>) => void;
    let rejectOperation!: (error: unknown) => void;
    const operation = new Promise<Result>((resolve, reject) => {
      resolveOperation = resolve;
      rejectOperation = reject;
    });
    this.active.add(operation);
    try {
      resolveOperation(work());
    } catch (error) {
      rejectOperation(error);
    }
    void operation.then(
      () => { this.active.delete(operation); },
      () => { this.active.delete(operation); },
    );
    return operation;
  }

  async stopAndDrain(timeoutMs = 5_000): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
      throw new MainIpcOperationTrackerError(
        'IPC_DRAIN_TIMEOUT',
        'Main IPC drain timeout must be a non-negative integer.',
      );
    }
    // This assignment is intentionally synchronous and terminal.
    this.stopping = true;
    const admitted = [...this.active];
    if (admitted.length === 0) return;

    const settled = await settleWithin(admitted, timeoutMs);
    if (!settled || this.active.size !== 0) {
      throw new MainIpcOperationTrackerError(
        'IPC_DRAIN_TIMEOUT',
        'Main IPC operations did not settle before the shutdown deadline.',
      );
    }
  }

  inspect(): Readonly<{ stopping: boolean; activeCount: number }> {
    return Object.freeze({ stopping: this.stopping, activeCount: this.active.size });
  }
}

async function settleWithin(
  operations: readonly Promise<unknown>[],
  timeoutMs: number,
): Promise<boolean> {
  if (timeoutMs === 0) return false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(operations).then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
