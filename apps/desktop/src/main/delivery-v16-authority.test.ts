import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createDeliveryV16Authority } from './delivery-v16-authority';
import { missingReadinessView } from './delivery-readiness-view';
import type { DeliveryV16Authority, DeliveryV16Paths, DeliveryV16Request, DeliveryV16Result } from './delivery-v16-contracts';

function harness() {
  const context = normalizeStoreContextEnvelope({ storeId: 'store-a', browserProfileId: 'profile-a', sessionGeneration: 1, marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-15' });
  let authority: DeliveryV16Authority = { storeContext: context, scope: { dateFrom: '2026-10-01', dateTo: '2026-10-15' }, scopeRevision: 'scope-1', mode: { value: 'manual_approval', revision: 1 }, configurationRevision: 1, workPackageRoot: 'F:\\acceptance' };
  const paths = Object.fromEntries(['appRoot', 'executablePath', 'mainBundlePath', 'workerPath', 'backupHelperPath', 'workPackageRoot', 'cacheRoot', 'outputRoot', 'authorityDbPath', 'authoritySnapshotRoot', 'tempRoot'].map(key => [key, `F:\\${key}`])) as unknown as DeliveryV16Paths;
  const pending: Array<{ request: DeliveryV16Request; signal: AbortSignal; resolve: (result: DeliveryV16Result) => void; reject: (error: unknown) => void }> = [];
  const worker = { execute: vi.fn((request: DeliveryV16Request, signal: AbortSignal) => new Promise<DeliveryV16Result>((resolve, reject) => pending.push({ request, signal, resolve, reject }))), stopAndDrain: vi.fn(async () => undefined) };
  const invalidateOutputs = vi.fn(async () => undefined);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const runtime = createDeliveryV16Authority({ appVersion: '1.6.0', readAuthority: () => authority, readPaths: () => paths, worker, invalidateOutputs, logger });
  const response = (index = 0): DeliveryV16Result => ({ schemaVersion: 'v16.delivery-result/1', binding: pending[index].request.binding, readiness: missingReadinessView('缺少真实原件', null) });
  return { runtime, pending, worker, logger, invalidateOutputs, response, get authority() { return authority; }, set authority(value: DeliveryV16Authority) { authority = value; } };
}

describe('V16 delivery authority', () => {
  it('binds every request to one unique nonce and the complete current authority', async () => {
    const input = harness();
    const first = input.runtime.run('view'), second = input.runtime.run('refresh');
    expect(input.pending[0].request.binding.nonce).not.toBe(input.pending[1].request.binding.nonce);
    expect(input.pending[0].request.authority).toEqual(input.authority);
    expect(input.pending[0].request.authority).not.toBe(input.authority);
    input.pending[0].resolve(input.response(0)); input.pending[1].resolve(input.response(1));
    await expect(first).resolves.toMatchObject({ readiness: { appReady: false } });
    await expect(second).resolves.toMatchObject({ readiness: { appReady: false } });
    expect(input.runtime.inspect().activeCount).toBe(0);
  });

  it('rejects A to B to A results even when the final authority bytes match', async () => {
    const input = harness();
    const result = input.runtime.run('view');
    input.runtime.invalidate('store-b'); input.runtime.invalidate('store-a');
    expect(input.pending[0].signal.aborted).toBe(true);
    input.pending[0].resolve(input.response());
    await expect(result).rejects.toMatchObject({ code: 'DELIVERY_AUTHORITY_CHANGED' });
    expect(input.invalidateOutputs).toHaveBeenCalledTimes(1);
  });

  it.each(['store', 'session', 'scope', 'scope-revision', 'mode', 'mode-revision', 'configuration', 'work-package'])('rejects a changed %s without publishing its old result', async (change) => {
    const input = harness();
    const result = input.runtime.run('export');
    const previous = input.authority;
    const replacements: Record<string, Partial<DeliveryV16Authority>> = {
      store: { storeContext: normalizeStoreContextEnvelope({ ...previous.storeContext!, storeId: 'store-b' }) },
      session: { storeContext: normalizeStoreContextEnvelope({ ...previous.storeContext!, sessionGeneration: 2 }) },
      scope: { scope: { dateFrom: '2026-10-02', dateTo: '2026-10-15' } },
      'scope-revision': { scopeRevision: 'scope-2' }, mode: { mode: { value: 'policy_auto', revision: 1 } },
      'mode-revision': { mode: { value: 'manual_approval', revision: 2 } }, configuration: { configurationRevision: 2 },
      'work-package': { workPackageRoot: 'F:\\other' },
    };
    input.authority = { ...previous, ...replacements[change] };
    input.pending[0].resolve(input.response());
    await expect(result).rejects.toMatchObject({ code: 'DELIVERY_AUTHORITY_CHANGED' });
    expect(input.invalidateOutputs).toHaveBeenCalledTimes(1);
  });

  it('rejects a worker response carrying another request nonce', async () => {
    const input = harness();
    const result = input.runtime.run('view');
    input.pending[0].resolve({ ...input.response(), binding: { ...input.response().binding, nonce: 'other' } });
    await expect(result).rejects.toMatchObject({ code: 'DELIVERY_WORKER_BINDING_INVALID' });
  });

  it('cancels workers and closes IPC admission synchronously before awaiting shutdown', async () => {
    const input = harness();
    const operation = input.runtime.run('view');
    const ipcDrain = vi.fn(async () => undefined);
    const stopping = input.runtime.stopAndDrain(ipcDrain);
    expect(input.pending[0].signal.aborted).toBe(true);
    expect(input.worker.stopAndDrain).toHaveBeenCalledTimes(1);
    expect(ipcDrain).toHaveBeenCalledTimes(1);
    await expect(input.runtime.run('view')).rejects.toMatchObject({ code: 'DELIVERY_STOPPING' });
    input.pending[0].reject(new Error('cancelled'));
    await expect(operation).rejects.toMatchObject({ code: 'DELIVERY_AUTHORITY_CHANGED' });
    await expect(stopping).resolves.toBeUndefined();
  });

  it('propagates worker shutdown failure to the existing authority close barrier', async () => {
    const input = harness();
    const active = input.runtime.run('view');
    input.worker.stopAndDrain.mockRejectedValueOnce(new Error('THREAD_STILL_ALIVE'));
    await expect(input.runtime.stopAndDrain()).rejects.toThrow('DELIVERY_WORKER_DRAIN_FAILED');
    input.pending[0].reject(new Error('THREAD_FINALLY_CANCELLED'));
    await expect(active).rejects.toMatchObject({ code: 'DELIVERY_AUTHORITY_CHANGED' });
  });

  it('retains both verification and invalidation errors in a reported aggregate', async () => {
    const input = harness();
    input.invalidateOutputs.mockRejectedValueOnce(new Error('INVALIDATION_FAILED'));
    const result = input.runtime.run('export');
    input.pending[0].reject(new Error('VERIFICATION_FAILED'));
    await expect(result).rejects.toMatchObject({ message: 'DELIVERY_RESULT_AND_INVALIDATION_FAILED', errors: [expect.any(Error), expect.any(Error)] });
    expect(input.logger.error).toHaveBeenCalledWith('delivery.v16_invalidation_failed', expect.any(Object));
    input.invalidateOutputs.mockRejectedValueOnce(new Error('INVALIDATION_STILL_FAILED'));
    await expect(input.runtime.stopAndDrain()).rejects.toThrow('DELIVERY_WORKER_DRAIN_FAILED');
    await expect(input.runtime.stopAndDrain()).resolves.toBeUndefined();
  });
});
