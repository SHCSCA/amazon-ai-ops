import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  normalizeStoreId,
  type StoreRecord,
  type StoreWorkspaceView,
} from '@amazon-ai-ops/shared-types';
import {
  INITIAL_MISSION_CONTROL_STORE_STATE,
  reduceMissionControlStoreState,
} from './store-context';

const store: StoreRecord = {
  storeId: normalizeStoreId('store-one'),
  browserProfileId: 'profile-one' as StoreRecord['browserProfileId'],
  marketplace: 'US',
  currency: 'USD',
  displayName: 'SHC001',
  status: 'active',
  businessTimezone: 'America/Los_Angeles',
  createdAt: '2026-07-22T00:00:00.000Z',
  updatedAt: '2026-07-22T00:00:00.000Z',
};

function view(overrides: Record<string, unknown> = {}): StoreWorkspaceView {
  return {
    store: { ...store, ...(overrides.store as object || {}) },
    context: normalizeStoreContextEnvelope({
      storeId: store.storeId,
      browserProfileId: store.browserProfileId,
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: '2026-07-22',
      sessionGeneration: 1,
      ...overrides,
      store: undefined,
    }),
    connections: [],
    sessions: [],
  };
}

describe('Mission Control StoreContext state', () => {
  it('deduplicates the event plus promise result of the same switch', () => {
    const once = reduceMissionControlStoreState(INITIAL_MISSION_CONTROL_STORE_STATE, {
      type: 'authority', view: view(),
    });
    const twice = reduceMissionControlStoreState(once, { type: 'authority', view: view() });

    expect(once.contextEpoch).toBe(1);
    expect(twice.contextEpoch).toBe(1);
    expect(twice.phase).toBe('ready');
  });

  it('invalidates keyed state on archive and on a timezone/context-key change', () => {
    const ready = reduceMissionControlStoreState(INITIAL_MISSION_CONTROL_STORE_STATE, {
      type: 'authority', view: view(),
    });
    const archived = reduceMissionControlStoreState(ready, {
      type: 'clear-authority', phase: 'needs-selection',
    });
    expect(archived.authorityKey).toBeNull();
    expect(archived.activeView).toBeNull();
    expect(archived.contextEpoch).toBe(2);

    const timezoneChanged = reduceMissionControlStoreState(ready, {
      type: 'authority',
      view: view({
        businessTimezone: 'America/New_York',
        businessDate: '2026-07-22',
        store: { businessTimezone: 'America/New_York' },
      }),
    });
    expect(timezoneChanged.authorityKey).not.toBe(ready.authorityKey);
    expect(timezoneChanged.contextEpoch).toBe(2);
  });

  it('subscribes to both authority events and retries both store list and authority bootstrap', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    expect(source).toContain('api.onStoreContextChanged');
    expect(source).toContain('api.onStoresChanged');
    expect(source).toMatch(/const retryBootstrap[\s\S]*await refreshStores\(\);[\s\S]*await resyncAuthority/);
    expect(source).toContain("dispatch({ type: 'clear-authority', phase: 'needs-selection' })");
  });

  it('reconfirms Main authority for events and ignores superseded switch responses', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const listenerBlock = source.slice(
      source.indexOf('const removeContextListener'),
      source.indexOf('const removeStoresListener'),
    );
    expect(listenerBlock).toContain("resyncAuthority('needs-selection')");
    expect(listenerBlock).not.toContain("dispatch({ type: 'authority'");
    expect(source).toContain('const switchSequence = ++switchSequenceRef.current');
    expect(source).toContain('switchSequence !== switchSequenceRef.current');
    expect(source).toMatch(/const switchStore[\s\S]*await resyncAuthority\('needs-selection'\)/);
  });

  it('exposes real typed Store CRUD and never auto-switches after creation', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    expect(source).toContain('createStore(input: CreateStoreInput)');
    expect(source).toContain('updateStore(input: UpdateStoreInput)');
    expect(source).toContain('archiveStore(input: ArchiveStoreInput)');
    expect(source).toContain('restoreStore(input: RestoreStoreInput)');
    const createBlock = source.slice(source.indexOf('const createStore ='), source.indexOf('const updateStore ='));
    expect(createBlock).toContain('api.createStore(input)');
    expect(createBlock).not.toContain('switchStore');
  });
});
