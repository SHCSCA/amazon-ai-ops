export interface BeforeQuitEvent {
  preventDefault(): void;
}

export interface BeforeQuitCoordinatorOptions {
  cleanup(): Promise<void> | void;
  requestQuit(): void;
  reportError(error: unknown): void;
}

export type BeforeQuitHandler = (event: BeforeQuitEvent) => Promise<void> | undefined;

interface ClosableBrowserController {
  close(): Promise<void> | void;
}

interface StoppableScheduler {
  stop(): Promise<void> | void;
}

interface ClosableDatabase {
  close(): Promise<unknown> | unknown;
}

export interface AppResources {
  browserController: ClosableBrowserController | null;
  scheduler: StoppableScheduler | null;
  db: ClosableDatabase | null;
}

export type AppResourceName = keyof AppResources;
export type AppResourceCleanupErrorReporter = (resource: AppResourceName, error: unknown) => void;

export const DEFAULT_RESOURCE_CLEANUP_TIMEOUT_MS = 5_000;

export interface AppResourceCleanupOptions {
  timeoutMs?: number;
}

export class AppResourceCleanupTimeoutError extends Error {
  readonly resource: AppResourceName;
  readonly timeoutMs: number;

  constructor(resource: AppResourceName, timeoutMs: number) {
    super(`Timed out cleaning up ${resource} after ${timeoutMs}ms.`);
    this.name = 'AppResourceCleanupTimeoutError';
    this.resource = resource;
    this.timeoutMs = timeoutMs;
  }
}

function cleanupTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_RESOURCE_CLEANUP_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('App resource cleanup timeout must be a positive finite number.');
  }
  return timeoutMs;
}

async function runResourceCleanup(
  resource: AppResourceName,
  cleanup: () => unknown,
  timeoutMs: number,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new AppResourceCleanupTimeoutError(resource, timeoutMs));
    }, timeoutMs);
  });

  try {
    await Promise.race([
      Promise.resolve().then(cleanup),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function cleanupAppResources(
  resources: AppResources,
  reportError: AppResourceCleanupErrorReporter,
  options: AppResourceCleanupOptions = {},
): Promise<void> {
  const timeoutMs = cleanupTimeoutMs(options.timeoutMs);
  const browserController = resources.browserController;
  const scheduler = resources.scheduler;
  const db = resources.db;

  resources.browserController = null;
  resources.scheduler = null;
  resources.db = null;

  const cleanupSteps: Array<[AppResourceName, (() => unknown) | null]> = [
    ['scheduler', scheduler ? () => scheduler.stop() : null],
    ['browserController', browserController ? () => browserController.close() : null],
    ['db', db ? () => db.close() : null],
  ];

  for (const [resource, cleanup] of cleanupSteps) {
    if (!cleanup) {
      continue;
    }

    try {
      await runResourceCleanup(resource, cleanup, timeoutMs);
    } catch (error) {
      reportError(resource, error);
    }
  }
}

export function createBeforeQuitCoordinator({
  cleanup,
  requestQuit,
  reportError,
}: BeforeQuitCoordinatorOptions): BeforeQuitHandler {
  let quitRequested = false;
  let cleanupPromise: Promise<void> | null = null;

  return (event) => {
    if (quitRequested) {
      return undefined;
    }

    event.preventDefault();

    if (!cleanupPromise) {
      let cleanupResult: Promise<void> | void;
      try {
        cleanupResult = cleanup();
      } catch (error) {
        cleanupResult = Promise.reject(error);
      }

      cleanupPromise = Promise.resolve(cleanupResult)
        .catch(reportError)
        .finally(() => {
          quitRequested = true;
          requestQuit();
        });
    }

    return cleanupPromise;
  };
}
