import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { StoreMutationLane } from './visible-browser-runtime-registry';
import {
  StoreCollectionMainRuntime,
  type StoreCollectionCancellationCallbackInput,
} from './store-collection-main-runtime';
import {
  context,
  orchestrator,
  resumeRequest,
  deferred,
} from "./collection-main.test-fixtures";

describe('StoreCollectionMainRuntime', () => {
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
});
