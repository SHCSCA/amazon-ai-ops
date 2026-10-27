import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
} from './visible-browser-runtime-registry';
import { StoreCollectionMainRuntime } from './store-collection-main-runtime';
import {
  context,
  orchestrator,
  deferred,
  visibleController,
  candidateForMainRuntime,
} from "./collection-main.test-fixtures";

describe('StoreCollectionMainRuntime', () => {
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
