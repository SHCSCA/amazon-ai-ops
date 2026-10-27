import { vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { type VisibleBrowserControllerLike } from './visible-browser-runtime-registry';
import {
  type StoreCollectionExistingResumeRequest,
  type StoreCollectionMainOrchestratorPort,
} from './store-collection-main-runtime';

export function context(
  overrides: Partial<StoreContextEnvelope> = {},
): StoreContextEnvelope {
  return normalizeStoreContextEnvelope({
    storeId: 'store-one',
    browserProfileId: 'profile-one',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    businessDate: '2026-07-30',
    sessionGeneration: 7,
    ...overrides,
  });
}

export function orchestrator(
  overrides: Partial<StoreCollectionMainOrchestratorPort> = {},
): StoreCollectionMainOrchestratorPort {
  return {
    recoverExistingTransitionsOnly: vi.fn(async () => ({ state: 'completed' as const })),
    runScheduledCycle: vi.fn(async () => ({ state: 'completed' as const })),
    manualCycle: vi.fn(async () => ({ state: 'completed' as const })),
    resumeExisting: vi.fn(async () => ({ state: 'completed' as const })),
    stopAndDrain: vi.fn(async () => undefined),
    assertUserOperationAllowed: vi.fn(() => undefined),
    isTransitionLocked: vi.fn(() => false),
    ...overrides,
  };
}

export function resumeRequest(
  overrides: Partial<StoreCollectionExistingResumeRequest> = {},
): StoreCollectionExistingResumeRequest {
  return {
    context: context(),
    jobId: 'job-one',
    requestId: 'scheduler-request-one',
    dateStart: '2026-07-23',
    dateEnd: '2026-07-29',
    expectedJobUpdatedAt: '2026-07-30T15:05:00.000Z',
    expectedAuthorityProofSha256: 'a'.repeat(64),
    ...overrides,
  };
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

export function visibleController(onClose: () => void): VisibleBrowserControllerLike {
  let page: unknown | null = {};
  let browserContext: unknown | null = {};
  return {
    async close() {
      onClose();
      page = null;
      browserContext = null;
    },
    getPage: () => page,
    getContext: () => browserContext,
  };
}

export function candidateForMainRuntime() {
  return {
    purpose: 'collection_only' as const,
    context: context(),
    controllers: { lingxing: visibleController(() => undefined) },
    profileDirs: { lingxing: 'D:\\capsules\\store-one\\lingxing' },
  };
}
