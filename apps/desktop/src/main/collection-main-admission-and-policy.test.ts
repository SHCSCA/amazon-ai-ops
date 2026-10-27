import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BrowserLeaseManager } from '@amazon-ai-ops/browser-worker';
import { type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { StoreCollectionPolicySuppressionController } from './store-collection-policy-suppression';
import {
  StoreMutationLane,
  VisibleBrowserRuntimeRegistry,
} from './visible-browser-runtime-registry';
import {
  StoreCollectionMainRuntime,
  type StoreCollectionManualCycleAdmission,
} from './store-collection-main-runtime';
import { runUserVisibleBrowserTransition } from './user-visible-browser-transition';
import {
  context,
  orchestrator,
  deferred,
  visibleController,
} from "./collection-main.test-fixtures";

describe('StoreCollectionMainRuntime', () => {
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
});
