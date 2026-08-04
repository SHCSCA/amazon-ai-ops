import { BrowserLeaseError, BrowserLeaseManager } from '@amazon-ai-ops/browser-worker';
import { normalizeStoreId } from '@amazon-ai-ops/shared-types';
import { describe, expect, it, vi } from 'vitest';
import {
  isUserVisibleBrowserTransitionPreMutationError,
  runUserVisibleBrowserTransition,
  storeMutationRequiresVisibleBrowserTransition,
} from './user-visible-browser-transition';

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('runUserVisibleBrowserTransition', () => {
  const storeId = normalizeStoreId('store-a');
  it('holds the global barrier through deferred controller close and final identity readback', async () => {
    const leases = new BrowserLeaseManager();
    const closeStarted = vi.fn();
    const closeGate = deferred<void>();
    let runtimeClosed = false;
    let mutationStarted = false;

    const operation = runUserVisibleBrowserTransition({
      leases,
      owner: 'store-login',
      async closeRuntime() {
        closeStarted();
        await closeGate.promise;
        runtimeClosed = true;
      },
      assertRuntimeClosed() {
        expect(runtimeClosed).toBe(true);
      },
      work() {
        mutationStarted = true;
        return 'logged-in';
      },
      readFinalState() {
        return { state: 'runtime_started', runtimeId: 'runtime-1', epoch: 1 };
      },
    });

    expect(closeStarted).toHaveBeenCalledOnce();
    expect(mutationStarted).toBe(false);
    expect(() => leases.acquire({
      storeId,
      purpose: 'external_write',
      owner: 'direct-execution',
    })).toThrowError(expect.objectContaining<Partial<BrowserLeaseError>>({
      code: 'TRANSITION_BARRIER_HELD',
    }));

    closeGate.resolve();
    await expect(operation).resolves.toBe('logged-in');
    expect(leases.activeLeases()).toEqual([]);

    const lease = leases.acquire({
      storeId,
      purpose: 'external_write',
      owner: 'after-transition',
    });
    leases.release(lease);
  });

  it('rejects an existing lease synchronously before close or mutation without holding a barrier', () => {
    const leases = new BrowserLeaseManager();
    const held = leases.acquire({
      storeId,
      purpose: 'external_write',
      owner: 'execution-first',
    });
    const closeRuntime = vi.fn(async () => undefined);
    const work = vi.fn(() => 'mutated');

    let rejection: unknown;
    try {
      runUserVisibleBrowserTransition({
        leases,
        owner: 'store-transition',
        closeRuntime,
        assertRuntimeClosed: () => undefined,
        work,
        readFinalState: () => ({ state: 'empty' }),
      });
    } catch (error) {
      rejection = error;
    }

    expect(isUserVisibleBrowserTransitionPreMutationError(rejection)).toBe(true);
    expect(closeRuntime).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
    expect(leases.assertCurrent(held)).toBe(held);
    leases.release(held);

    const next = leases.acquire({
      storeId,
      purpose: 'external_write',
      owner: 'barrier-was-not-left-held',
    });
    leases.release(next);
  });

  it('classifies an already-held transition barrier as a safe synchronous admission rejection', () => {
    const leases = new BrowserLeaseManager();
    leases.enterTransitionBarrier('automation-transition');
    const closeRuntime = vi.fn(async () => undefined);

    expect(() => runUserVisibleBrowserTransition({
      leases,
      owner: 'user-transition',
      closeRuntime,
      assertRuntimeClosed: () => undefined,
      work: () => 'never',
      readFinalState: () => ({ state: 'empty' }),
    })).toThrowError(expect.objectContaining({
      code: 'VISIBLE_BROWSER_TRANSITION_BUSY',
      mutationStarted: false,
    }));
    expect(closeRuntime).not.toHaveBeenCalled();
  });

  it('keeps a sticky unknown barrier after admitted close proof fails', async () => {
    const leases = new BrowserLeaseManager();

    await expect(runUserVisibleBrowserTransition({
      leases,
      owner: 'store-transition',
      closeRuntime: async () => undefined,
      assertRuntimeClosed: () => { throw new Error('controller residue'); },
      work: () => 'never',
      readFinalState: () => ({ state: 'empty' }),
    })).rejects.toThrow('controller residue');

    expect(() => leases.acquire({
      storeId,
      purpose: 'external_write',
      owner: 'blocked-after-unknown',
    })).toThrowError(expect.objectContaining<Partial<BrowserLeaseError>>({
      code: 'TRANSITION_BARRIER_HELD',
    }));
  });
});

describe('storeMutationRequiresVisibleBrowserTransition', () => {
  it('preserves the current browser for create, restore and non-current CRUD', () => {
    expect(storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:create' },
      'store-active',
    )).toBe(false);
    expect(storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:restore', targetStoreId: 'store-archived' },
      'store-active',
    )).toBe(false);
    expect(storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:update', targetStoreId: 'store-other' },
      'store-active',
    )).toBe(false);
    expect(storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:connections:update', targetStoreId: 'store-other' },
      'store-active',
    )).toBe(false);
  });

  it('requires a transition for switch, reconnect and active Store/session mutations', () => {
    expect(storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:switch', targetStoreId: 'store-other' },
      'store-active',
    )).toBe(true);
    expect(storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:reconnect', targetStoreId: 'store-active' },
      'store-active',
    )).toBe(true);
    expect(storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:update', targetStoreId: 'store-active' },
      'store-active',
    )).toBe(true);
    expect(storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:connections:remove', targetStoreId: 'store-active' },
      'store-active',
    )).toBe(true);
  });

  it('fails closed when a future mutation has no explicit transition classification', () => {
    expect(() => storeMutationRequiresVisibleBrowserTransition(
      { operation: 'stores:future-mutation', targetStoreId: 'store-active' },
      'store-active',
    )).toThrow(/unsupported Store mutation transition operation/);
  });
});
