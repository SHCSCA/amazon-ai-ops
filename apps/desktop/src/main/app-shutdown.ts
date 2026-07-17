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

export async function cleanupAppResources(
  resources: AppResources,
  reportError: AppResourceCleanupErrorReporter,
): Promise<void> {
  const browserController = resources.browserController;
  const scheduler = resources.scheduler;
  const db = resources.db;

  resources.browserController = null;
  resources.scheduler = null;
  resources.db = null;

  const cleanupSteps: Array<[AppResourceName, (() => unknown) | null]> = [
    ['browserController', browserController ? () => browserController.close() : null],
    ['scheduler', scheduler ? () => scheduler.stop() : null],
    ['db', db ? () => db.close() : null],
  ];

  for (const [resource, cleanup] of cleanupSteps) {
    if (!cleanup) {
      continue;
    }

    try {
      await cleanup();
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
