import { describe, expect, it, vi } from 'vitest';
import { BrowserLeaseManager } from '@amazon-ai-ops/browser-worker';
import {
  normalizeStoreContextEnvelope,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
  type VisibleBrowserControllerLike,
} from './visible-browser-runtime-registry';
import {
  StoreCollectionMainRuntime,
  type StoreCollectionCancellationCallbackInput,
  type StoreCollectionExistingResumeRequest,
  type StoreCollectionManualCycleAdmission,
  type StoreCollectionMainOrchestratorPort,
} from './store-collection-main-runtime';
import { runUserVisibleBrowserTransition } from './user-visible-browser-transition';

function context(
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

function orchestrator(
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

function resumeRequest(
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

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function visibleController(onClose: () => void): VisibleBrowserControllerLike {
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

describe('StoreCollectionMainRuntime', () => {
  it('routes exact same-job resume only through the explicit user entry point', async () => {
    const resumeExisting = vi.fn(async (_input: StoreCollectionExistingResumeRequest) => ({
      state: 'completed' as const,
    }));
    const port = orchestrator({ resumeExisting });
    const runtime = new StoreCollectionMainRuntime({ orchestrator: port });
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.resumeExisting(resumeRequest())).resolves.toEqual({ state: 'completed' });

    expect(resumeExisting).toHaveBeenCalledOnce();
    expect(resumeExisting).toHaveBeenCalledWith(expect.objectContaining(resumeRequest()));
    const [captured] = resumeExisting.mock.calls[0]!;
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.context)).toBe(true);
    expect(port.manualCycle).not.toHaveBeenCalled();
    expect(port.runScheduledCycle).not.toHaveBeenCalled();
    expect(port.recoverExistingTransitionsOnly).toHaveBeenCalledOnce();
  });

  it('admits only one same-job resume callback across a double click', async () => {
    const gate = deferred<{ state: 'completed' }>();
    const resumeExisting = vi.fn(() => gate.promise);
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ resumeExisting }),
    });
    await runtime.recoverStartupThenConfirm();

    const first = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(resumeExisting).toHaveBeenCalledOnce());
    await expect(runtime.resumeExisting(resumeRequest())).rejects.toThrow(/already held|blocked/i);
    expect(resumeExisting).toHaveBeenCalledOnce();

    gate.resolve({ state: 'completed' });
    await expect(first).resolves.toEqual({ state: 'completed' });
    expect(runtime.readStatus().mutationLane).toMatchObject({ held: false, stickyUnknown: false });
  });

  it('blocks explicit resume in Package UI, startup-unknown, stopping, and lane-held states', async () => {
    const readOnlyPort = orchestrator();
    const readOnly = new StoreCollectionMainRuntime({
      orchestrator: readOnlyPort,
      packageUiReadOnly: true,
    });
    await expect(readOnly.resumeExisting(resumeRequest())).rejects.toThrow(/read-only/i);
    expect(readOnlyPort.resumeExisting).not.toHaveBeenCalled();

    const startupPort = orchestrator();
    const startupUnknown = new StoreCollectionMainRuntime({ orchestrator: startupPort });
    await expect(startupUnknown.resumeExisting(resumeRequest())).rejects.toThrow(/startup recovery/i);
    expect(startupPort.resumeExisting).not.toHaveBeenCalled();

    const drainGate = deferred<void>();
    const stoppingPort = orchestrator({ stopAndDrain: vi.fn(() => drainGate.promise) });
    const stopping = new StoreCollectionMainRuntime({ orchestrator: stoppingPort });
    await stopping.recoverStartupThenConfirm();
    const drain = stopping.stopAndDrain();
    await expect(stopping.resumeExisting(resumeRequest())).rejects.toThrow(/stopping/i);
    expect(stoppingPort.resumeExisting).not.toHaveBeenCalled();
    drainGate.resolve();
    await drain;

    const lanePort = orchestrator();
    const laneHeld = new StoreCollectionMainRuntime({ orchestrator: lanePort });
    await laneHeld.recoverStartupThenConfirm();
    const userGate = deferred<void>();
    const userMutation = laneHeld.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      () => userGate.promise,
    );
    await vi.waitFor(() => expect(laneHeld.readStatus().mutationLane.held).toBe(true));
    await expect(laneHeld.resumeExisting(resumeRequest())).rejects.toThrow(/already held|blocked/i);
    expect(lanePort.resumeExisting).not.toHaveBeenCalled();
    userGate.resolve();
    await userMutation;
  });

  it('waits for an active explicit resume and its lane release before proving drain', async () => {
    const events: string[] = [];
    const gate = deferred<{ state: 'completed' }>();
    const lane = new StoreMutationLane();
    const port = orchestrator({
      resumeExisting: vi.fn(async () => {
        events.push('resume-start');
        return gate.promise;
      }),
      stopAndDrain: vi.fn(async () => {
        events.push('orchestrator-drain');
      }),
    });
    const runtime = new StoreCollectionMainRuntime({ orchestrator: port, mutationLane: lane });
    await runtime.recoverStartupThenConfirm();
    const originalRelease = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      events.push('lane-release');
      return originalRelease(claim);
    });

    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(port.resumeExisting).toHaveBeenCalledOnce());
    const drain = runtime.stopAndDrain();
    await Promise.resolve();
    expect(runtime.readStatus()).toMatchObject({ lifecycle: 'stopping', drainProven: false });

    gate.resolve({ state: 'completed' });
    await expect(resume).resolves.toEqual({ state: 'completed' });
    await expect(drain).resolves.toBeUndefined();
    expect(events).toEqual(['resume-start', 'orchestrator-drain', 'lane-release']);
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      mutationLane: { held: false, stickyUnknown: false },
    });
  });

  it('releases the lane after a durably failed resume attempt so the user may retry explicitly', async () => {
    const resumeExisting = vi.fn()
      .mockResolvedValueOnce({ state: 'completed' as const, outcome: 'failed' as const })
      .mockResolvedValueOnce({ state: 'completed' as const, outcome: 'succeeded' as const });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ resumeExisting }),
    });
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.resumeExisting(resumeRequest())).resolves.toMatchObject({
      state: 'completed',
      outcome: 'failed',
    });
    expect(runtime.readStatus().mutationLane).toMatchObject({ held: false, stickyUnknown: false });
    await expect(runtime.resumeExisting(resumeRequest({
      expectedJobUpdatedAt: '2026-07-30T15:06:00.000Z',
      expectedAuthorityProofSha256: 'b'.repeat(64),
    }))).resolves.toMatchObject({ state: 'completed', outcome: 'succeeded' });

    expect(resumeExisting).toHaveBeenCalledTimes(2);
  });

  it('cooperatively signals an active same-job resume and waits for its durable cancelled receipt', async () => {
    const events: string[] = [];
    const cancellationSignal = deferred<void>();
    const lane = new StoreMutationLane();
    const resumeExisting = vi.fn(async () => {
      events.push('resume-start');
      await cancellationSignal.promise;
      events.push('resume-durable-cancelled');
      return { state: 'completed' as const, outcome: 'failed' as const };
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ resumeExisting }),
      mutationLane: lane,
    });
    await runtime.recoverStartupThenConfirm();
    const release = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      events.push('lane-release');
      return release(claim);
    });
    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(resumeExisting).toHaveBeenCalledOnce());
    events.length = 0;
    const signalActiveCancellation = vi.fn(() => {
      events.push('cancel-signal');
      cancellationSignal.resolve();
    });
    const cancelIdle = vi.fn();
    const clearCancellationSignal = vi.fn(() => {
      events.push('signal-clear');
    });
    const readDurableSettlement = vi.fn(() => {
      events.push('settlement-read');
      expect(runtime.readStatus().mutationLane).toMatchObject({
        held: true,
        current: { kind: 'automation', owner: 'manual-collection-resume' },
      });
      return {
        durableCancelled: true as const,
        storeId: 'store-one',
        jobId: 'job-one',
        requestId: 'scheduler-request-one',
        newResumeReceipt: true,
      };
    });
    const cancellation = runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation,
      clearCancellationSignal,
      cancelIdle,
      readDurableSettlement,
    });
    expect(signalActiveCancellation).toHaveBeenCalledOnce();
    expect(events).toEqual(['cancel-signal']);

    await expect(resume).resolves.toMatchObject({ state: 'completed', outcome: 'failed' });
    await expect(cancellation).resolves.toMatchObject({
      cancelled: true,
      path: 'active',
      laneOwner: 'manual-collection-resume',
      newResumeReceipt: true,
    });
    expect(events).toEqual([
      'cancel-signal',
      'resume-durable-cancelled',
      'settlement-read',
      'signal-clear',
      'lane-release',
    ]);
    expect(cancelIdle).not.toHaveBeenCalled();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
  });

  it('reuses one cooperative resume cancellation operation across an exact-target double click', async () => {
    const cancellationSignal = deferred<void>();
    const signalActiveCancellation = vi.fn(() => cancellationSignal.resolve());
    const clearCancellationSignal = vi.fn();
    const readDurableSettlement = vi.fn(() => ({
      durableCancelled: true as const,
      storeId: 'store-one',
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      newResumeReceipt: true,
    }));
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        resumeExisting: vi.fn(async () => {
          await cancellationSignal.promise;
          return { state: 'completed' as const, outcome: 'failed' as const };
        }),
      }),
    });
    await runtime.recoverStartupThenConfirm();
    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(true));
    const first = runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation,
      clearCancellationSignal,
      cancelIdle: vi.fn(),
      readDurableSettlement,
    });
    const duplicateSignal = vi.fn();
    const duplicateClear = vi.fn();
    const duplicateIdle = vi.fn();
    const duplicateRead = vi.fn();
    const second = runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation: duplicateSignal,
      clearCancellationSignal: duplicateClear,
      cancelIdle: duplicateIdle,
      readDurableSettlement: duplicateRead,
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);
    await expect(resume).resolves.toMatchObject({ state: 'completed', outcome: 'failed' });
    expect(second).toBe(first);
    expect(secondResult).toBe(firstResult);
    expect(signalActiveCancellation).toHaveBeenCalledOnce();
    expect(clearCancellationSignal).toHaveBeenCalledOnce();
    expect(readDurableSettlement).toHaveBeenCalledOnce();
    expect(duplicateSignal).not.toHaveBeenCalled();
    expect(duplicateClear).not.toHaveBeenCalled();
    expect(duplicateIdle).not.toHaveBeenCalled();
    expect(duplicateRead).not.toHaveBeenCalled();
    expect(runtime.readStatus().mutationLane).toMatchObject({
      state: 'available',
      held: false,
      stickyUnknown: false,
    });
  });

  it('rejects a different active target while clearing only that target cancellation key', async () => {
    const cancellationSignal = deferred<void>();
    const liveSignals = new Set<string>();
    const key = (storeId: string, jobId: string, requestId: string) => (
      `${storeId}:${jobId}:${requestId}`
    );
    const firstKey = key('store-one', 'job-one', 'scheduler-request-one');
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        resumeExisting: vi.fn(async () => {
          await cancellationSignal.promise;
          return { state: 'completed' as const, outcome: 'failed' as const };
        }),
      }),
    });
    await runtime.recoverStartupThenConfirm();
    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(true));
    const first = runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation: (input) => {
        liveSignals.add(key(input.storeId, input.jobId, input.requestId));
        cancellationSignal.resolve();
      },
      clearCancellationSignal: (input) => {
        liveSignals.delete(key(input.storeId, input.jobId, input.requestId));
      },
      cancelIdle: vi.fn(),
      readDurableSettlement: () => ({
        durableCancelled: true,
        storeId: 'store-one',
        jobId: 'job-one',
        requestId: 'scheduler-request-one',
        newResumeReceipt: true,
      }),
    });
    const differentSignal = vi.fn();
    let firstSignalPresentDuringDifferentClear = false;
    const differentClear = vi.fn((input: StoreCollectionCancellationCallbackInput) => {
      liveSignals.delete(key(input.storeId, input.jobId, input.requestId));
      firstSignalPresentDuringDifferentClear = liveSignals.has(firstKey);
    });
    const different = runtime.cancelCollection({
      context: context(),
      jobId: 'job-two',
      requestId: 'scheduler-request-two',
      signalActiveCancellation: differentSignal,
      clearCancellationSignal: differentClear,
      cancelIdle: vi.fn(),
      readDurableSettlement: vi.fn(),
    });

    await expect(different).rejects.toMatchObject({
      code: 'COLLECTION_CANCELLATION_BLOCKED',
    });
    expect(differentSignal).not.toHaveBeenCalled();
    expect(differentClear).toHaveBeenCalledOnce();
    expect(firstSignalPresentDuringDifferentClear).toBe(true);
    await expect(first).resolves.toMatchObject({ cancelled: true, path: 'active' });
    await expect(resume).resolves.toMatchObject({ state: 'completed', outcome: 'failed' });
    expect(liveSignals.size).toBe(0);
  });

  it('requires an explicitly new receipt before accepting an active resume cancellation', async () => {
    const cancellationSignal = deferred<void>();
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        resumeExisting: vi.fn(async () => {
          await cancellationSignal.promise;
          return { state: 'completed' as const, outcome: 'failed' as const };
        }),
      }),
    });
    await runtime.recoverStartupThenConfirm();
    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane).toMatchObject({
      held: true,
      current: { owner: 'manual-collection-resume' },
    }));

    const clearCancellationSignal = vi.fn();
    const cancellation = runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation: () => cancellationSignal.resolve(),
      clearCancellationSignal,
      cancelIdle: vi.fn(),
      readDurableSettlement: () => ({
        durableCancelled: true,
        storeId: 'store-one',
        jobId: 'job-one',
        requestId: 'scheduler-request-one',
        newResumeReceipt: false,
      }),
    });
    const rejection = expect(cancellation).rejects.toMatchObject({
      code: 'CANCELLATION_SETTLEMENT_UNPROVEN',
    });

    await expect(resume).resolves.toMatchObject({ state: 'completed', outcome: 'failed' });
    await rejection;
    expect(clearCancellationSignal).toHaveBeenCalledOnce();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
  });

  it('releases the active lane and rejects an unproven cancellation without becoming sticky', async () => {
    const cancellationSignal = deferred<void>();
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        resumeExisting: vi.fn(async () => {
          await cancellationSignal.promise;
          return { state: 'completed' as const, outcome: 'failed' as const };
        }),
      }),
    });
    await runtime.recoverStartupThenConfirm();
    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(true));

    const clearCancellationSignal = vi.fn();
    const cancellation = runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation: () => cancellationSignal.resolve(),
      clearCancellationSignal,
      cancelIdle: vi.fn(),
      readDurableSettlement: () => ({ durableCancelled: false }),
    });
    const rejection = expect(cancellation).rejects.toMatchObject({
      code: 'CANCELLATION_SETTLEMENT_UNPROVEN',
    });

    await expect(resume).resolves.toMatchObject({ state: 'completed', outcome: 'failed' });
    await rejection;
    expect(clearCancellationSignal).toHaveBeenCalledOnce();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
  });

  it('fails closed when the active cancellation authority verifier throws', async () => {
    const cancellationSignal = deferred<void>();
    const verifierFailure = new Error('authority verifier failed');
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        resumeExisting: vi.fn(async () => {
          await cancellationSignal.promise;
          return { state: 'completed' as const, outcome: 'failed' as const };
        }),
      }),
    });
    await runtime.recoverStartupThenConfirm();
    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(true));

    const clearCancellationSignal = vi.fn();
    const cancellation = runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation: () => cancellationSignal.resolve(),
      clearCancellationSignal,
      cancelIdle: vi.fn(),
      readDurableSettlement: () => {
        throw verifierFailure;
      },
    });
    const resumeRejection = expect(resume).rejects.toBe(verifierFailure);
    const cancellationRejection = expect(cancellation).rejects.toBe(verifierFailure);

    await resumeRejection;
    await cancellationRejection;
    expect(clearCancellationSignal).toHaveBeenCalledOnce();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      mutationLane: { state: 'sticky_unknown', held: true, stickyUnknown: true },
    });
  });

  it('runs an idle durable cancellation and verifier inside one exclusive user lane', async () => {
    const events: string[] = [];
    const lane = new StoreMutationLane();
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      mutationLane: lane,
    });
    await runtime.recoverStartupThenConfirm();
    const release = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      events.push('lane-release');
      return release(claim);
    });
    const signalActiveCancellation = vi.fn();
    const clearCancellationSignal = vi.fn(() => {
      events.push('signal-clear');
    });
    const cancelIdle = vi.fn((input) => {
      events.push('idle-cancel');
      expect(Object.isFrozen(input)).toBe(true);
      expect(runtime.readStatus().mutationLane).toMatchObject({
        held: true,
        current: { kind: 'user', owner: 'manual-collection-cancel' },
      });
    });
    const readDurableSettlement = vi.fn((input) => {
      events.push('settlement-read');
      expect(input).toMatchObject({
        path: 'idle',
        laneOwner: 'manual-collection-cancel',
        requireNewResumeReceipt: false,
      });
      expect(runtime.readStatus().mutationLane.held).toBe(true);
      return {
        durableCancelled: true as const,
        storeId: 'store-one',
        jobId: 'job-one',
        requestId: 'scheduler-request-one',
        newResumeReceipt: false,
      };
    });

    await expect(runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation,
      clearCancellationSignal,
      cancelIdle,
      readDurableSettlement,
    })).resolves.toMatchObject({
      cancelled: true,
      path: 'idle',
      laneOwner: 'manual-collection-cancel',
      newResumeReceipt: false,
    });

    expect(events).toEqual([
      'idle-cancel',
      'settlement-read',
      'signal-clear',
      'lane-release',
    ]);
    expect(signalActiveCancellation).not.toHaveBeenCalled();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
  });

  it('safely rejects cancellation while a non-collection lane is held', async () => {
    const userGate = deferred<void>();
    const runtime = new StoreCollectionMainRuntime({ orchestrator: orchestrator() });
    await runtime.recoverStartupThenConfirm();
    const userMutation = runtime.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      () => userGate.promise,
    );
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane).toMatchObject({
      held: true,
      current: { kind: 'user', owner: 'renderer-store-ipc' },
    }));
    const signalActiveCancellation = vi.fn();
    const clearCancellationSignal = vi.fn();
    const cancelIdle = vi.fn();
    const readDurableSettlement = vi.fn();

    await expect(runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation,
      clearCancellationSignal,
      cancelIdle,
      readDurableSettlement,
    })).rejects.toMatchObject({ code: 'COLLECTION_CANCELLATION_BLOCKED' });
    expect(signalActiveCancellation).not.toHaveBeenCalled();
    expect(clearCancellationSignal).toHaveBeenCalledOnce();
    expect(cancelIdle).not.toHaveBeenCalled();
    expect(readDurableSettlement).not.toHaveBeenCalled();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      mutationLane: { state: 'held', held: true, stickyUnknown: false },
    });

    userGate.resolve();
    await userMutation;
    expect(runtime.readStatus().mutationLane).toMatchObject({
      state: 'available',
      held: false,
      stickyUnknown: false,
    });
  });

  it('queues a cross-target cancellation behind an active manual lane without signalling it', async () => {
    const events: string[] = [];
    const cycle = deferred<{ state: 'completed' }>();
    const lane = new StoreMutationLane();
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ manualCycle: vi.fn(() => cycle.promise) }),
      mutationLane: lane,
    });
    await runtime.recoverStartupThenConfirm();
    const release = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      events.push(`release:${claim.owner}`);
      return release(claim);
    });
    const activeCycle = runtime.runNow(context());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane).toMatchObject({
      held: true,
      current: { owner: 'manual-collection' },
    }));
    const signalActiveCancellation = vi.fn();
    const cancellation = runtime.cancelCollection({
      context: context(),
      jobId: 'queued-job',
      requestId: 'queued-request',
      signalActiveCancellation,
      clearCancellationSignal: vi.fn(() => {
        events.push('signal-clear');
      }),
      cancelIdle: vi.fn((input) => {
        events.push('idle-cancel');
        expect(input).toMatchObject({
          path: 'idle',
          laneOwner: 'manual-collection-cancel',
        });
      }),
      readDurableSettlement: vi.fn(() => {
        events.push('settlement-read');
        return {
          durableCancelled: true as const,
          storeId: 'store-one',
          jobId: 'queued-job',
          requestId: 'queued-request',
          newResumeReceipt: false,
        };
      }),
    });

    expect(signalActiveCancellation).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    cycle.resolve({ state: 'completed' });
    await expect(activeCycle).resolves.toEqual({ state: 'completed' });
    await expect(cancellation).resolves.toMatchObject({
      path: 'idle',
      jobId: 'queued-job',
    });
    expect(events).toEqual([
      'release:manual-collection',
      'idle-cancel',
      'settlement-read',
      'signal-clear',
      'release:manual-collection-cancel',
    ]);
    expect(runtime.readStatus().mutationLane).toMatchObject({
      state: 'available',
      held: false,
      stickyUnknown: false,
    });
  });

  it('reuses one queued post-manual idle cancellation across an exact-target double click', async () => {
    const cycle = deferred<{ state: 'completed' }>();
    const signalActiveCancellation = vi.fn();
    const clearCancellationSignal = vi.fn();
    const cancelIdle = vi.fn();
    const readDurableSettlement = vi.fn(() => ({
      durableCancelled: true as const,
      storeId: 'store-one',
      jobId: 'queued-job',
      requestId: 'queued-request',
      newResumeReceipt: false,
    }));
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ manualCycle: vi.fn(() => cycle.promise) }),
    });
    await runtime.recoverStartupThenConfirm();
    const activeCycle = runtime.runNow(context());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane).toMatchObject({
      held: true,
      current: { owner: 'manual-collection' },
    }));
    const first = runtime.cancelCollection({
      context: context(),
      jobId: 'queued-job',
      requestId: 'queued-request',
      signalActiveCancellation,
      clearCancellationSignal,
      cancelIdle,
      readDurableSettlement,
    });
    const duplicateSignal = vi.fn();
    const duplicateClear = vi.fn();
    const duplicateIdle = vi.fn();
    const duplicateRead = vi.fn();
    const second = runtime.cancelCollection({
      context: context(),
      jobId: 'queued-job',
      requestId: 'queued-request',
      signalActiveCancellation: duplicateSignal,
      clearCancellationSignal: duplicateClear,
      cancelIdle: duplicateIdle,
      readDurableSettlement: duplicateRead,
    });

    cycle.resolve({ state: 'completed' });
    await expect(activeCycle).resolves.toEqual({ state: 'completed' });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(second).toBe(first);
    expect(secondResult).toBe(firstResult);
    expect(signalActiveCancellation).not.toHaveBeenCalled();
    expect(clearCancellationSignal).toHaveBeenCalledOnce();
    expect(cancelIdle).toHaveBeenCalledOnce();
    expect(readDurableSettlement).toHaveBeenCalledOnce();
    expect(duplicateSignal).not.toHaveBeenCalled();
    expect(duplicateClear).not.toHaveBeenCalled();
    expect(duplicateIdle).not.toHaveBeenCalled();
    expect(duplicateRead).not.toHaveBeenCalled();
    expect(runtime.readStatus().mutationLane).toMatchObject({
      state: 'available',
      held: false,
      stickyUnknown: false,
    });
  });

  it('queues a cross-target cancellation behind an active scheduled lane without signalling it', async () => {
    const events: string[] = [];
    const cycle = deferred<{ state: 'completed' }>();
    const lane = new StoreMutationLane();
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ runScheduledCycle: vi.fn(() => cycle.promise) }),
      mutationLane: lane,
      timer: { set: vi.fn(() => Object.freeze({})), clear: vi.fn() },
    });
    await runtime.recoverStartupThenConfirm();
    const release = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      events.push(`release:${claim.owner}`);
      return release(claim);
    });
    runtime.start();
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane).toMatchObject({
      held: true,
      current: { owner: 'scheduled-collection' },
    }));
    const signalActiveCancellation = vi.fn();
    const cancellation = runtime.cancelCollection({
      context: context(),
      jobId: 'queued-job',
      requestId: 'queued-request',
      signalActiveCancellation,
      clearCancellationSignal: vi.fn(() => {
        events.push('signal-clear');
      }),
      cancelIdle: vi.fn(() => {
        events.push('idle-cancel');
      }),
      readDurableSettlement: vi.fn(() => {
        events.push('settlement-read');
        return {
          durableCancelled: true as const,
          storeId: 'store-one',
          jobId: 'queued-job',
          requestId: 'queued-request',
          newResumeReceipt: false,
        };
      }),
    });

    expect(signalActiveCancellation).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    cycle.resolve({ state: 'completed' });
    await expect(cancellation).resolves.toMatchObject({
      path: 'idle',
      jobId: 'queued-job',
    });
    expect(events).toEqual([
      'release:scheduled-collection',
      'idle-cancel',
      'settlement-read',
      'signal-clear',
      'release:manual-collection-cancel',
    ]);
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'running',
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
  });

  it('treats a post-manual idle settlement for an already-completed target as non-sticky unproven', async () => {
    const cycle = deferred<{ state: 'completed' }>();
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ manualCycle: vi.fn(() => cycle.promise) }),
    });
    await runtime.recoverStartupThenConfirm();
    const activeCycle = runtime.runNow(context());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane).toMatchObject({
      held: true,
      current: { owner: 'manual-collection' },
    }));
    const signalActiveCancellation = vi.fn();
    const clearCancellationSignal = vi.fn();
    const cancelIdle = vi.fn();
    const cancellation = runtime.cancelCollection({
      context: context(),
      jobId: 'completed-job',
      requestId: 'completed-request',
      signalActiveCancellation,
      clearCancellationSignal,
      cancelIdle,
      readDurableSettlement: () => ({ durableCancelled: false }),
    });
    const rejection = expect(cancellation).rejects.toMatchObject({
      code: 'CANCELLATION_SETTLEMENT_UNPROVEN',
    });

    cycle.resolve({ state: 'completed' });
    await expect(activeCycle).resolves.toEqual({ state: 'completed' });
    await rejection;
    expect(signalActiveCancellation).not.toHaveBeenCalled();
    expect(cancelIdle).toHaveBeenCalledOnce();
    expect(clearCancellationSignal).toHaveBeenCalledOnce();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
  });

  it('clears a failed cooperative signal and fails closed without calling idle cancellation', async () => {
    const signalFailure = new Error('signal write failed');
    const resumeGate = deferred<{ state: 'completed' }>();
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ resumeExisting: vi.fn(() => resumeGate.promise) }),
    });
    await runtime.recoverStartupThenConfirm();
    void runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(true));
    const clearCancellationSignal = vi.fn();
    const cancelIdle = vi.fn();

    await expect(runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation: () => {
        throw signalFailure;
      },
      clearCancellationSignal,
      cancelIdle,
      readDurableSettlement: vi.fn(),
    })).rejects.toBe(signalFailure);

    expect(clearCancellationSignal).toHaveBeenCalledOnce();
    expect(cancelIdle).not.toHaveBeenCalled();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      mutationLane: { state: 'sticky_unknown', held: true, stickyUnknown: true },
    });
  });

  it('fails closed when cancellation-signal cleanup fails', async () => {
    const cancellationSignal = deferred<void>();
    const cleanupFailure = new Error('signal cleanup failed');
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        resumeExisting: vi.fn(async () => {
          await cancellationSignal.promise;
          return { state: 'completed' as const, outcome: 'failed' as const };
        }),
      }),
    });
    await runtime.recoverStartupThenConfirm();
    const resume = runtime.resumeExisting(resumeRequest());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(true));
    const cancellation = runtime.cancelCollection({
      context: context(),
      jobId: 'job-one',
      requestId: 'scheduler-request-one',
      signalActiveCancellation: () => cancellationSignal.resolve(),
      clearCancellationSignal: () => {
        throw cleanupFailure;
      },
      cancelIdle: vi.fn(),
      readDurableSettlement: () => ({
        durableCancelled: true,
        storeId: 'store-one',
        jobId: 'job-one',
        requestId: 'scheduler-request-one',
        newResumeReceipt: true,
      }),
    });
    const resumeRejection = expect(resume).rejects.toBe(cleanupFailure);
    const cancellationRejection = expect(cancellation).rejects.toBe(cleanupFailure);

    await resumeRejection;
    await cancellationRejection;
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      mutationLane: { state: 'sticky_unknown', held: true, stickyUnknown: true },
    });
  });

  it('confirms startup policy dispatch only after recovery succeeds and releases the shared lane', async () => {
    const events: string[] = [];
    const policy = new StoreCollectionPolicySuppressionController({
      createStartupRecoveryCapability: () => {
        events.push('confirmation-capability');
        return Object.freeze({}) as never;
      },
    });
    const port = orchestrator({
      recoverExistingTransitionsOnly: vi.fn(async () => {
        events.push('recover');
        expect(policy.isPolicyDispatchSuppressed()).toBe(true);
        return { state: 'completed' as const };
      }),
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: port,
      policySuppression: policy,
    });

    await runtime.recoverStartupThenConfirm();

    expect(events).toEqual(['recover', 'confirmation-capability']);
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      startupRecoveryConfirmed: true,
      effectivePolicyDispatchSuppressed: false,
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
    expect(runtime.isPolicyDispatchSuppressed()).toBe(false);
    expect(port.runScheduledCycle).not.toHaveBeenCalled();
    expect(port.manualCycle).not.toHaveBeenCalled();
  });

  it('routes run-now only through the explicit manual cycle and mutually excludes user mutation', async () => {
    const gate = deferred<{ state: 'completed' }>();
    const manualCycle = vi.fn((
      _context: StoreContextEnvelope,
      _admission: StoreCollectionManualCycleAdmission,
    ) => gate.promise);
    const port = orchestrator({ manualCycle });
    const runtime = new StoreCollectionMainRuntime({ orchestrator: port });
    await runtime.recoverStartupThenConfirm();

    const running = runtime.runNow(context());
    await vi.waitFor(() => expect(manualCycle).toHaveBeenCalledOnce());

    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:switch', targetStoreId: 'store-two' },
      async () => 'mutated',
    )).rejects.toThrow(/already held|blocked/i);
    expect(port.runScheduledCycle).not.toHaveBeenCalled();
    expect(manualCycle).toHaveBeenCalledWith(
      context(),
      expect.objectContaining({
        capability: expect.any(Object),
        context: context(),
      }),
    );
    const [manualContext, admission] = manualCycle.mock.calls[0]!;
    expect(Object.isFrozen(manualContext)).toBe(true);
    expect(Object.isFrozen(admission)).toBe(true);
    expect(admission.context).toBe(manualContext);

    gate.resolve({ state: 'completed' });
    await expect(running).resolves.toEqual({ state: 'completed' });
    expect(runtime.readStatus().mutationLane).toMatchObject({
      state: 'available',
      held: false,
      stickyUnknown: false,
    });
  });

  it('starts a Main-owned scheduled pump without routing through the manual cycle', async () => {
    const callbacks: Array<() => void> = [];
    const timer = {
      set: vi.fn((callback: () => void) => {
        callbacks.push(callback);
        return Object.freeze({ timer: callbacks.length });
      }),
      clear: vi.fn(),
    };
    const port = orchestrator();
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: port,
      timer,
      pollIntervalMs: 1_000,
    });
    await runtime.recoverStartupThenConfirm();

    runtime.start();
    await vi.waitFor(() => expect(port.runScheduledCycle).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(false));
    callbacks[0]!();
    await vi.waitFor(() => expect(port.runScheduledCycle).toHaveBeenCalledTimes(2));

    expect(port.manualCycle).not.toHaveBeenCalled();
    expect(timer.set).toHaveBeenCalledWith(expect.any(Function), 1_000);
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'running',
      automationStarted: true,
    });
  });

  it('keeps a failed user callback permanently held under sticky-unknown suppression', async () => {
    const port = orchestrator();
    const runtime = new StoreCollectionMainRuntime({ orchestrator: port });
    await runtime.recoverStartupThenConfirm();
    const work = vi.fn(async () => {
      throw new Error('post-mutation callback failed');
    });

    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      work,
    )).rejects.toThrow('post-mutation callback failed');

    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      effectivePolicyDispatchSuppressed: true,
      mutationLane: {
        state: 'sticky_unknown',
        held: true,
        stickyUnknown: true,
        current: { kind: 'user', owner: 'renderer-store-ipc' },
      },
    });
    await expect(runtime.runNow(context())).rejects.toThrow(/safety state is unknown/i);
    expect(port.manualCycle).not.toHaveBeenCalled();
  });

  it('suppresses policy dispatch for the whole user lane and blocks new browser leases during close', async () => {
    const runtime = new StoreCollectionMainRuntime({ orchestrator: orchestrator() });
    const leases = new BrowserLeaseManager();
    const closeGate = deferred<void>();
    let runtimeClosed = false;
    await runtime.recoverStartupThenConfirm();

    const mutation = runtime.withUserStoreMutation(
      { operation: 'stores:switch', targetStoreId: 'store-two' },
      () => runUserVisibleBrowserTransition({
        leases,
        owner: 'stores:switch',
        async closeRuntime() {
          await closeGate.promise;
          runtimeClosed = true;
        },
        assertRuntimeClosed() {
          expect(runtimeClosed).toBe(true);
        },
        work: () => 'switched',
        readFinalState: () => ({ state: 'empty' }),
      }),
    );

    expect(runtime.isPolicyDispatchSuppressed()).toBe(true);
    expect(runtime.readStatus().mutationLane).toMatchObject({ held: true });
    expect(() => leases.acquire({
      storeId: context().storeId,
      purpose: 'external_write',
      owner: 'policy-or-direct-execution',
    })).toThrow(/transition barrier/i);

    closeGate.resolve();
    await expect(mutation).resolves.toBe('switched');
    expect(runtime.readStatus().mutationLane).toMatchObject({
      state: 'available',
      held: false,
      stickyUnknown: false,
    });
    expect(runtime.isPolicyDispatchSuppressed()).toBe(false);
  });

  it('releases the user lane before surfacing a transition admission rejection', async () => {
    const runtime = new StoreCollectionMainRuntime({ orchestrator: orchestrator() });
    const leases = new BrowserLeaseManager();
    await runtime.recoverStartupThenConfirm();
    const executionLease = leases.acquire({
      storeId: context().storeId,
      purpose: 'external_write',
      owner: 'execution-first',
    });

    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:switch', targetStoreId: 'store-two' },
      () => runUserVisibleBrowserTransition({
        leases,
        owner: 'stores:switch',
        closeRuntime: async () => undefined,
        assertRuntimeClosed: () => undefined,
        work: () => 'must-not-run',
        readFinalState: () => ({ state: 'empty' }),
      }),
    )).rejects.toMatchObject({
      code: 'VISIBLE_BROWSER_TRANSITION_BUSY',
      mutationStarted: false,
    });

    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      effectivePolicyDispatchSuppressed: false,
      mutationLane: {
        state: 'available',
        held: false,
        stickyUnknown: false,
      },
    });
    expect(leases.assertCurrent(executionLease)).toBe(executionLease);
    leases.release(executionLease);
  });

  it('keeps the lane sticky when an admitted transition asynchronously rethrows a nested admission error', async () => {
    const runtime = new StoreCollectionMainRuntime({ orchestrator: orchestrator() });
    const leases = new BrowserLeaseManager();
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:switch', targetStoreId: 'store-two' },
      () => runUserVisibleBrowserTransition({
        leases,
        owner: 'outer-transition',
        closeRuntime: async () => undefined,
        assertRuntimeClosed: () => undefined,
        work: () => runUserVisibleBrowserTransition({
          leases,
          owner: 'nested-transition',
          closeRuntime: async () => undefined,
          assertRuntimeClosed: () => undefined,
          work: () => 'never',
          readFinalState: () => ({ state: 'empty' }),
        }),
        readFinalState: () => ({ state: 'empty' }),
      }),
    )).rejects.toMatchObject({ code: 'VISIBLE_BROWSER_TRANSITION_BUSY' });

    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      effectivePolicyDispatchSuppressed: true,
      mutationLane: {
        state: 'sticky_unknown',
        held: true,
        stickyUnknown: true,
      },
    });
    expect(() => leases.acquire({
      storeId: context().storeId,
      purpose: 'external_write',
      owner: 'blocked-by-outer-sticky-barrier',
    })).toThrow(/transition barrier/i);
  });

  it('turns an exact lane release exception into sticky unknown instead of returning success', async () => {
    const lane = new StoreMutationLane();
    const originalRelease = lane.release.bind(lane);
    let releases = 0;
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      releases += 1;
      if (releases === 2) throw new Error('release exploded');
      return originalRelease(claim);
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      mutationLane: lane,
    });
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:create' },
      async () => 'must-not-return',
    )).rejects.toThrow('release exploded');

    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      effectivePolicyDispatchSuppressed: true,
      mutationLane: { state: 'sticky_unknown', held: true },
    });
  });

  it('allows only bounded pre-session Package UI setup mutations on the shared lane', async () => {
    const registry = new VisibleBrowserRuntimeRegistry(() => 'package-runtime');
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      registry,
      packageUiReadOnly: true,
    });

    for (const operation of [
      'stores:create',
      'stores:switch',
      'stores:connections:create',
      'stores:connections:update',
      'browser:login',
    ]) {
      await expect(runtime.withPackageUiSetupMutation(
        { operation },
        async () => operation,
      )).resolves.toBe(operation);
    }
    await expect(runtime.withPackageUiSetupMutation(
      { operation: 'stores:update' },
      async () => undefined,
    )).rejects.toThrow(/read-only mode forbids stores:update/i);

    registry.publishCandidate({
      purpose: 'collection_only',
      context: context(),
      controllers: { lingxing: visibleController(() => undefined) },
    });
    await expect(runtime.withPackageUiSetupMutation(
      { operation: 'stores:switch' },
      async () => undefined,
    )).rejects.toThrow(/before a visible browser session exists/i);
  });

  it('keeps Package UI read-only while still allowing ordered safe shutdown', async () => {
    const events: string[] = [];
    const registry = new VisibleBrowserRuntimeRegistry(() => 'package-runtime');
    registry.publishCandidate({
      purpose: 'collection_only',
      context: context(),
      controllers: { lingxing: visibleController(() => events.push('registry-close')) },
    });
    const originalConsume = registry.consumeEmptyProof.bind(registry);
    vi.spyOn(registry, 'consumeEmptyProof').mockImplementation((proof) => {
      events.push('consume-proof');
      originalConsume(proof);
    });
    const port = orchestrator({
      stopAndDrain: vi.fn(async () => {
        events.push('orchestrator-drain');
      }),
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: port,
      registry,
      packageUiReadOnly: true,
    });

    await expect(runtime.recoverStartupThenConfirm()).rejects.toThrow(/read-only/i);
    expect(() => runtime.start()).toThrow(/read-only/i);
    await expect(runtime.runNow(context())).rejects.toThrow(/read-only/i);
    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      async () => undefined,
    )).rejects.toThrow(/read-only/i);
    expect(runtime.readStatus()).toMatchObject({
      packageUiReadOnly: true,
      startupRecoveryConfirmed: false,
      effectivePolicyDispatchSuppressed: true,
    });

    await runtime.stopAndDrain();

    expect(events).toEqual(['orchestrator-drain']);
    expect(registry.read()).not.toBeNull();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      registryClosed: false,
    });

    events.push('local-scheduler-stop');
    await runtime.closeRegistry();

    expect(events).toEqual([
      'orchestrator-drain',
      'local-scheduler-stop',
      'registry-close',
      'consume-proof',
    ]);
    expect(registry.read()).toBeNull();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      registryClosed: true,
    });
    await expect(runtime.closeRegistry()).resolves.toBeUndefined();
  });

  it('never issues startup confirmation when recovery-only orchestration fails', async () => {
    const createStartupRecoveryCapability = vi.fn(() => Object.freeze({}) as never);
    const policy = new StoreCollectionPolicySuppressionController({
      createStartupRecoveryCapability,
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        recoverExistingTransitionsOnly: vi.fn(async () => {
          throw new Error('protected recovery failed');
        }),
      }),
      policySuppression: policy,
    });

    await expect(runtime.recoverStartupThenConfirm()).rejects.toThrow('protected recovery failed');

    expect(createStartupRecoveryCapability).not.toHaveBeenCalled();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      startupRecoveryConfirmed: false,
      effectivePolicyDispatchSuppressed: true,
      mutationLane: { state: 'sticky_unknown', held: true },
    });
    await expect(runtime.recoverStartupThenConfirm()).rejects.toThrow(/safety state is unknown/i);
  });

  it('rejects a replayed Main lane authority before a second callback can run', async () => {
    const recoveryCapability = Object.freeze({ recovery: true });
    const replayedCapability = Object.freeze({ replayed: true });
    const capabilities = [
      recoveryCapability,
      replayedCapability,
      replayedCapability,
    ];
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      createAuthorityCapability: () => capabilities.shift()!,
    });
    await runtime.recoverStartupThenConfirm();
    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:create' },
      async () => 'first',
    )).resolves.toBe('first');
    const replayedWork = vi.fn(async () => 'second');

    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:create' },
      replayedWork,
    )).rejects.toThrow(/one-shot/i);

    expect(replayedWork).not.toHaveBeenCalled();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      effectivePolicyDispatchSuppressed: true,
    });
  });

  it('releases the exact lane for a capability-bound stale-context rejection before mutation', async () => {
    const manualCycle = vi.fn(async (
      _context: StoreContextEnvelope,
      admission: StoreCollectionManualCycleAdmission,
    ) => Object.freeze({
      state: 'rejected' as const,
      mutationStarted: false as const,
      reason: 'STALE_CONTEXT' as const,
      admission,
    }));
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({ manualCycle }),
    });
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.runNow(context())).rejects.toMatchObject({
      code: 'MANUAL_CYCLE_PREMUTATION_REJECTED',
    });

    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'ready',
      effectivePolicyDispatchSuppressed: false,
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      async () => 'still-usable',
    )).resolves.toBe('still-usable');
  });

  it('keeps an unproven manual-cycle exception held as sticky unknown', async () => {
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        manualCycle: vi.fn(async () => {
          throw new Error('mutation boundary unknown');
        }),
      }),
    });
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.runNow(context())).rejects.toThrow('mutation boundary unknown');

    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      effectivePolicyDispatchSuppressed: true,
      mutationLane: {
        state: 'sticky_unknown',
        held: true,
        current: { kind: 'automation', owner: 'manual-collection' },
      },
    });
  });

  it('treats a stopped manual result outside shutdown as unknown and keeps the lane held', async () => {
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator({
        manualCycle: vi.fn(async () => ({ state: 'stopped' as const })),
      }),
    });
    await runtime.recoverStartupThenConfirm();

    await expect(runtime.runNow(context())).rejects.toMatchObject({
      code: 'SAFETY_STATE_UNKNOWN',
    });

    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      effectivePolicyDispatchSuppressed: true,
      mutationLane: { state: 'sticky_unknown', held: true },
    });
  });

  it('lets an active manual cycle stop gracefully and withholds drain proof until lane release', async () => {
    const events: string[] = [];
    const cycle = deferred<{ state: 'stopped' }>();
    const lane = new StoreMutationLane();
    const registry = new VisibleBrowserRuntimeRegistry(() => 'manual-shutdown-runtime');
    registry.publishCandidate({
      purpose: 'collection_only',
      context: context(),
      controllers: { lingxing: visibleController(() => events.push('registry-close')) },
    });
    const originalConsume = registry.consumeEmptyProof.bind(registry);
    vi.spyOn(registry, 'consumeEmptyProof').mockImplementation((proof) => {
      events.push('consume-proof');
      originalConsume(proof);
    });
    const port = orchestrator({
      manualCycle: vi.fn(() => cycle.promise),
      stopAndDrain: vi.fn(async () => {
        events.push('orchestrator-drain');
        await cycle.promise;
      }),
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: port,
      mutationLane: lane,
      registry,
    });
    await runtime.recoverStartupThenConfirm();
    const originalRelease = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      events.push('lane-release');
      return originalRelease(claim);
    });
    const manual = runtime.runNow(context());
    await vi.waitFor(() => expect(port.manualCycle).toHaveBeenCalledOnce());

    const shutdown = runtime.stopAndDrain();
    await expect(runtime.closeRegistry()).rejects.toMatchObject({ code: 'DRAIN_REQUIRED' });
    expect(registry.read()).not.toBeNull();
    cycle.resolve({ state: 'stopped' });

    await expect(manual).resolves.toEqual({ state: 'stopped' });
    await expect(shutdown).resolves.toBeUndefined();
    expect(events).toEqual([
      'orchestrator-drain',
      'lane-release',
    ]);
    expect(registry.read()).not.toBeNull();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      registryClosed: false,
      effectivePolicyDispatchSuppressed: true,
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });

    await runtime.closeRegistry();
    expect(events).toEqual([
      'orchestrator-drain',
      'lane-release',
      'registry-close',
      'consume-proof',
    ]);
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      registryClosed: true,
      effectivePolicyDispatchSuppressed: true,
      mutationLane: {
        state: 'held',
        held: true,
        stickyUnknown: false,
        current: { kind: 'automation', owner: 'shutdown-registry-close' },
      },
    });
  });

  it('lets an active scheduled cycle stop gracefully before registry close', async () => {
    const events: string[] = [];
    const cycle = deferred<{ state: 'stopped' }>();
    const lane = new StoreMutationLane();
    const registry = new VisibleBrowserRuntimeRegistry(() => 'scheduled-shutdown-runtime');
    registry.publishCandidate({
      purpose: 'collection_only',
      context: context(),
      controllers: { lingxing: visibleController(() => events.push('registry-close')) },
    });
    const originalConsume = registry.consumeEmptyProof.bind(registry);
    vi.spyOn(registry, 'consumeEmptyProof').mockImplementation((proof) => {
      events.push('consume-proof');
      originalConsume(proof);
    });
    const port = orchestrator({
      runScheduledCycle: vi.fn(() => cycle.promise),
      stopAndDrain: vi.fn(async () => {
        events.push('orchestrator-drain');
        await cycle.promise;
      }),
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: port,
      mutationLane: lane,
      registry,
      timer: { set: vi.fn(() => Object.freeze({})), clear: vi.fn() },
    });
    await runtime.recoverStartupThenConfirm();
    const originalRelease = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      events.push('lane-release');
      return originalRelease(claim);
    });
    runtime.start();
    await vi.waitFor(() => expect(port.runScheduledCycle).toHaveBeenCalledOnce());

    const shutdown = runtime.stopAndDrain();
    cycle.resolve({ state: 'stopped' });

    await expect(shutdown).resolves.toBeUndefined();
    expect(events).toEqual([
      'orchestrator-drain',
      'lane-release',
    ]);
    expect(registry.read()).not.toBeNull();

    await runtime.closeRegistry();
    expect(events).toEqual([
      'orchestrator-drain',
      'lane-release',
      'registry-close',
      'consume-proof',
    ]);
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      registryClosed: true,
      effectivePolicyDispatchSuppressed: true,
      mutationLane: {
        state: 'held',
        held: true,
        stickyUnknown: false,
        current: { kind: 'automation', owner: 'shutdown-registry-close' },
      },
    });
  });

  it('rejects shutdown and keeps the registry attached when an active callback fails', async () => {
    const callback = deferred<string>();
    const registry = new VisibleBrowserRuntimeRegistry(() => 'callback-failure-runtime');
    registry.publishCandidate(candidateForMainRuntime());
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      registry,
    });
    await runtime.recoverStartupThenConfirm();
    const mutation = runtime.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      () => callback.promise,
    );
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(true));

    const shutdown = runtime.stopAndDrain();
    callback.reject(new Error('callback failed during shutdown'));

    await expect(mutation).rejects.toThrow('callback failed during shutdown');
    await expect(shutdown).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(registry.read()).not.toBeNull();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      drainProven: false,
      registryClosed: false,
      mutationLane: { state: 'sticky_unknown', held: true },
    });
  });

  it('rejects shutdown after release changed state but failed before an exact receipt returned', async () => {
    const callback = deferred<string>();
    const lane = new StoreMutationLane();
    const registry = new VisibleBrowserRuntimeRegistry(() => 'release-failure-runtime');
    registry.publishCandidate(candidateForMainRuntime());
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      mutationLane: lane,
      registry,
    });
    await runtime.recoverStartupThenConfirm();
    const originalRelease = lane.release.bind(lane);
    vi.spyOn(lane, 'release').mockImplementation((claim) => {
      originalRelease(claim);
      throw new Error('release receipt lost');
    });
    const mutation = runtime.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      () => callback.promise,
    );
    await vi.waitFor(() => expect(runtime.readStatus().mutationLane.held).toBe(true));

    const shutdown = runtime.stopAndDrain();
    callback.resolve('mutated');

    await expect(mutation).rejects.toThrow('release receipt lost');
    await expect(shutdown).rejects.toMatchObject({ code: 'SAFETY_STATE_UNKNOWN' });
    expect(registry.read()).not.toBeNull();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'sticky_unknown',
      drainProven: false,
      registryClosed: false,
      mutationLane: { state: 'sticky_unknown', held: false },
    });
  });

  it.each(['held', 'released'] as const)(
    'rejects registry close before controller shutdown when an external lane claim was %s after drain',
    async (externalState) => {
      const closeObserved = vi.fn();
      const lane = new StoreMutationLane();
      const registry = new VisibleBrowserRuntimeRegistry(() => `drift-${externalState}-runtime`);
      registry.publishCandidate({
        ...candidateForMainRuntime(),
        controllers: { lingxing: visibleController(closeObserved) },
      });
      const runtime = new StoreCollectionMainRuntime({
        orchestrator: orchestrator(),
        mutationLane: lane,
        registry,
      });

      await runtime.stopAndDrain();
      const capability = Object.freeze({ externalState });
      lane.registerAuthority({
        kind: 'user',
        owner: `external-${externalState}`,
        capability,
      });
      const claim = lane.claim({
        kind: 'user',
        owner: `external-${externalState}`,
        capability,
      });
      if (externalState === 'released') lane.release(claim);

      await expect(runtime.closeRegistry()).rejects.toMatchObject({
        code: 'SAFETY_STATE_UNKNOWN',
      });

      expect(closeObserved).not.toHaveBeenCalled();
      expect(registry.read()).not.toBeNull();
      expect(runtime.readStatus()).toMatchObject({
        lifecycle: 'sticky_unknown',
        drainProven: true,
        registryClosed: false,
        mutationLane: {
          state: 'sticky_unknown',
          held: externalState === 'held',
          stickyUnknown: true,
        },
      });
    },
  );

  it('holds a terminal shutdown lane claim across close and rejects every new claim', async () => {
    const closeStarted = vi.fn();
    const closeGate = deferred<void>();
    let page: unknown | null = {};
    let browserContext: unknown | null = {};
    const lane = new StoreMutationLane();
    const registry = new VisibleBrowserRuntimeRegistry(() => 'terminal-lane-runtime');
    registry.publishCandidate({
      ...candidateForMainRuntime(),
      controllers: {
        lingxing: {
          async close() {
            closeStarted();
            await closeGate.promise;
            page = null;
            browserContext = null;
          },
          getPage: () => page,
          getContext: () => browserContext,
        },
      },
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      mutationLane: lane,
      registry,
    });
    await runtime.stopAndDrain();

    const closing = runtime.closeRegistry();
    expect(closeStarted).toHaveBeenCalledOnce();
    expect(runtime.readStatus().mutationLane).toMatchObject({
      state: 'held',
      held: true,
      current: { kind: 'automation', owner: 'shutdown-registry-close' },
    });
    const externalCapability = Object.freeze({ duringClose: true });
    lane.registerAuthority({
      kind: 'user',
      owner: 'external-during-close',
      capability: externalCapability,
    });
    expect(() => lane.claim({
      kind: 'user',
      owner: 'external-during-close',
      capability: externalCapability,
    })).toThrow(/already held/);

    closeGate.resolve();
    await expect(closing).resolves.toBeUndefined();

    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      registryClosed: true,
      mutationLane: {
        state: 'held',
        held: true,
        stickyUnknown: false,
        current: { kind: 'automation', owner: 'shutdown-registry-close' },
      },
    });
    expect(() => registry.publishCandidate(candidateForMainRuntime()))
      .toThrow(/terminally sealed/);
    expect(() => lane.claim({
      kind: 'user',
      owner: 'external-during-close',
      capability: externalCapability,
    })).toThrow(/already held/);
  });

  it('keeps admission closed but lets a timed-out drain retry after the operation settles', async () => {
    const drainGate = deferred<void>();
    const port = orchestrator({
      stopAndDrain: vi.fn(() => drainGate.promise),
    });
    const runtime = new StoreCollectionMainRuntime({ orchestrator: port });
    await runtime.recoverStartupThenConfirm();

    const firstAttempt = runtime.stopAndDrain(25);
    expect(runtime.stopAndDrain(250)).toBe(firstAttempt);
    await expect(firstAttempt).rejects.toMatchObject({ code: 'DRAIN_TIMEOUT' });

    expect(port.stopAndDrain).toHaveBeenCalledOnce();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopping',
      drainProven: false,
      registryClosed: false,
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
    await expect(runtime.runNow(context())).rejects.toMatchObject({ code: 'RUNTIME_STOPPING' });
    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      () => 'late mutation',
    )).rejects.toMatchObject({ code: 'RUNTIME_STOPPING' });
    expect(() => runtime.start()).toThrow(expect.objectContaining({ code: 'RUNTIME_STOPPING' }));

    drainGate.resolve();
    await expect(runtime.stopAndDrain(250)).resolves.toBeUndefined();

    expect(port.stopAndDrain).toHaveBeenCalledTimes(2);
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      registryClosed: false,
      mutationLane: { state: 'available', held: false, stickyUnknown: false },
    });
    await expect(runtime.stopAndDrain(1)).resolves.toBeUndefined();
    expect(port.stopAndDrain).toHaveBeenCalledTimes(2);
  });

  it('bounds a hung registry close without claiming registry closure', async () => {
    const never = new Promise<void>(() => undefined);
    const registry = new VisibleBrowserRuntimeRegistry(() => 'hung-close-runtime');
    registry.publishCandidate({
      ...candidateForMainRuntime(),
      controllers: {
        lingxing: {
          close: () => never,
          getPage: () => ({}),
          getContext: () => ({}),
        },
      },
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      registry,
    });

    await expect(runtime.stopAndDrain(25)).resolves.toBeUndefined();
    await expect(runtime.closeRegistry(25)).rejects.toMatchObject({ code: 'DRAIN_TIMEOUT' });

    expect(registry.read()).not.toBeNull();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      drainProven: true,
      registryClosed: false,
      mutationLane: {
        state: 'held',
        held: true,
        stickyUnknown: false,
        current: { kind: 'automation', owner: 'shutdown-registry-close' },
      },
    });
  });

  it('retries a failed terminal registry close without reopening Store admission', async () => {
    let closeAttempts = 0;
    let page: unknown | null = {};
    let browserContext: unknown | null = {};
    const registry = new VisibleBrowserRuntimeRegistry(() => 'retry-close-runtime');
    registry.publishCandidate({
      ...candidateForMainRuntime(),
      controllers: {
        lingxing: {
          async close() {
            closeAttempts += 1;
            if (closeAttempts === 1) throw new Error('transient controller close failure');
            page = null;
            browserContext = null;
          },
          getPage: () => page,
          getContext: () => browserContext,
        },
      },
    });
    const runtime = new StoreCollectionMainRuntime({
      orchestrator: orchestrator(),
      registry,
    });
    await runtime.recoverStartupThenConfirm();
    await runtime.stopAndDrain();

    await expect(runtime.closeRegistry()).rejects.toMatchObject({
      code: 'REGISTRY_CLOSE_FAILED',
    });
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      registryClosed: false,
      mutationLane: {
        state: 'held',
        held: true,
        stickyUnknown: false,
        current: { kind: 'automation', owner: 'shutdown-registry-close' },
      },
    });
    await expect(runtime.withUserStoreMutation(
      { operation: 'stores:update', targetStoreId: 'store-one' },
      () => 'late mutation',
    )).rejects.toMatchObject({ code: 'RUNTIME_STOPPING' });

    await expect(runtime.closeRegistry()).resolves.toBeUndefined();
    expect(closeAttempts).toBe(2);
    expect(registry.read()).toBeNull();
    expect(runtime.readStatus()).toMatchObject({
      lifecycle: 'stopped',
      registryClosed: true,
      mutationLane: {
        state: 'held',
        held: true,
        stickyUnknown: false,
      },
    });
  });
});

function candidateForMainRuntime() {
  return {
    purpose: 'collection_only' as const,
    context: context(),
    controllers: { lingxing: visibleController(() => undefined) },
    profileDirs: { lingxing: 'D:\\capsules\\store-one\\lingxing' },
  };
}
