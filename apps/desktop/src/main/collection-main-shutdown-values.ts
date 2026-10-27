import {
  VisibleBrowserRuntimeRegistryError,
} from './visible-browser-runtime-registry';
import {
  StoreCollectionMainRuntimeError,
} from "./collection-main-contracts";

export function isDrainTimeoutFailure(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'DRAIN_TIMEOUT';
}

export function isRetryableRegistryCloseFailure(error: unknown): boolean {
  return isDrainTimeoutFailure(error)
    || (error instanceof VisibleBrowserRuntimeRegistryError
      && (error.code === 'RUNTIME_CLOSE_FAILED' || error.code === 'RUNTIME_RESIDUE'))
    || (error instanceof StoreCollectionMainRuntimeError
      && error.code === 'REGISTRY_CLOSE_FAILED'
      && isRetryableRegistryCloseFailure(error.cause));
}

export function remainingTimeout(timeoutMs: number, startedAt: number): number {
  return Math.max(0, timeoutMs - Math.max(0, Date.now() - startedAt));
}

export async function waitForSettledOperations(
  operations: readonly Promise<unknown>[],
  timeoutMs: number,
): Promise<void> {
  if (operations.length === 0) return;
  if (timeoutMs === 0) {
    throw new StoreCollectionMainRuntimeError(
      'DRAIN_TIMEOUT',
      'shared Store mutation lane did not settle before the shutdown deadline',
    );
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race([
      Promise.allSettled(operations).then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!settled) {
      throw new StoreCollectionMainRuntimeError(
        'DRAIN_TIMEOUT',
        'shared Store mutation lane did not settle before the shutdown deadline',
      );
    }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function waitForOperation<Result>(
  operation: Promise<Result>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Result> {
  if (timeoutMs === 0) {
    // 即使预算耗尽，也须接收已创建操作的后续拒绝，避免退出时出现未处理异常。
    void operation.catch(() => undefined);
    throw new StoreCollectionMainRuntimeError('DRAIN_TIMEOUT', timeoutMessage);
  }
  const timeoutResult = Object.freeze({});
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const settled = await Promise.race<Result | Readonly<object>>([
      operation,
      new Promise<Readonly<object>>((resolve) => {
        timeout = setTimeout(() => resolve(timeoutResult), timeoutMs);
      }),
    ]);
    if (settled === timeoutResult) {
      throw new StoreCollectionMainRuntimeError('DRAIN_TIMEOUT', timeoutMessage);
    }
    return settled as Result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
