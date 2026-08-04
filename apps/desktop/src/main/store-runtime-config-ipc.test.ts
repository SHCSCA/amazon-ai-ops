import { describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import {
  registerStoreRuntimeConfigIpcHandlers,
  STORE_RUNTIME_CONFIG_IPC_CHANNELS,
} from './store-runtime-config-ipc';

describe('registerStoreRuntimeConfigIpcHandlers', () => {
  it('registers the closed surface and forwards complete authorized envelopes', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const changed = vi.fn();
    const projection = { current: null, versions: [] };
    const service = {
      get: vi.fn(() => projection),
      create: vi.fn(() => projection),
      update: vi.fn(() => projection),
      archive: vi.fn(() => projection),
      restore: vi.fn(() => projection),
    };
    registerStoreRuntimeConfigIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service as never,
      changed,
    );
    expect([...handlers.keys()]).toEqual(STORE_RUNTIME_CONFIG_IPC_CHANNELS);

    const storeContext = { storeId: 'store-a', marketplace: 'US', currency: 'USD' } as StoreContextEnvelope;
    const input = { expectedRevision: 1, patch: { analysisWindowDays: 45 } };
    expect(handlers.get('store-runtime-config:update')?.({}, { storeContext, input })).toEqual(projection);
    expect(service.update).toHaveBeenCalledWith(storeContext, input);
    expect(changed).toHaveBeenCalledWith(storeContext);
  });

  it('rejects malformed requests before any service handler runs', () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const service = {
      get: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn(), restore: vi.fn(),
    };
    registerStoreRuntimeConfigIpcHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      service as never,
    );
    expect(() => handlers.get('store-runtime-config:create')?.({}, { storeContext: null, input: {} }))
      .toThrow(/storeContext must be an object/);
    expect(service.create).not.toHaveBeenCalled();
  });
});
