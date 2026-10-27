import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { type StoreRecord } from '@amazon-ai-ops/shared-types';
import {
  store,
  harness,
} from "./collection-orchestrator.test-fixtures";

describe('StoreCollectionOrchestrator', () => {
it('uses cloned Store DTOs and deterministic codepoint sorting for preflight', async () => {
    const a = store('store-10', 'profile-a') as StoreRecord & { injected?: string };
    a.injected = 'must-not-cross-port';
    const z = store('store-2', 'profile-z');
    const seen: StoreRecord[] = [];
    const test = harness({
      stores: [z, a],
      inspection: (item) => {
        seen.push(item);
        return { state: 'not_due' };
      },
    });
    await test.orchestrator.runCycle();
    expect(seen.map((item) => item.storeId)).toEqual(['store-10', 'store-2']);
    expect(seen[0]).not.toBe(a);
    expect(seen[0]).not.toHaveProperty('injected');
  });

it('makes start idempotent and isolates a throwing onError observer', async () => {
    let observed!: () => void;
    const observation = new Promise<void>(resolve => { observed = resolve; });
    const onError = vi.fn(() => { observed(); throw new Error('observer'); });
    const setInterval = vi.fn(() => ({ unref: vi.fn() }) as never);
    const clearInterval = vi.fn();
    const test = harness({
      inspection: () => { throw new Error('precheck'); },
      onError,
      setInterval,
      clearInterval,
    });
    test.orchestrator.start();
    test.orchestrator.start();
    await observation;
    expect(onError).toHaveBeenCalledOnce();
    expect(setInterval).toHaveBeenCalledOnce();
    test.orchestrator.stop();
    expect(clearInterval).toHaveBeenCalledOnce();
  });

it('does not let an existing timer hide sticky SAFETY_STATE_UNKNOWN from a later start call', async () => {
    const onError = vi.fn();
    const test = harness({
      stores: [store('store-a', 'profile-a')],
      close: async () => { throw new Error('close failed'); },
      onError,
      setInterval: () => ({ unref: vi.fn() }) as never,
      clearInterval: vi.fn(),
    });
    test.orchestrator.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(() => test.orchestrator.start()).toThrow(/安全状态未知/);
    test.orchestrator.stop();
  });

it('rejects duplicate store/profile and unsupported locale before lease acquisition', async () => {
    const invalid = [
      [store('store-a', 'profile-a'), store('store-a', 'profile-b')],
      [store('store-a', 'profile-a'), store('store-b', 'profile-a')],
      [store('store-a', 'profile-a', { businessTimezone: 'America/New_York' })],
    ];
    for (const stores of invalid) {
      const test = harness({ stores });
      await expect(test.orchestrator.runCycle()).rejects.toMatchObject({ code: 'UNSUPPORTED_STORE' });
      expect(test.acquireAutomationLease).not.toHaveBeenCalled();
    }
  });

it('exposes no credential, challenge, execution-controller, or policy-dispatch dependency', () => {
    const test = harness();
    const keys = Object.keys((test.orchestrator as any).dependencies);
    expect(keys).not.toContain('credentialFill');
    expect(keys).not.toContain('mfaHandler');
    expect(keys).not.toContain('executionController');
    expect(keys).not.toContain('policyDispatch');
  });
});
