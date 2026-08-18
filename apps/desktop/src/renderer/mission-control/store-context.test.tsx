import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  normalizeStoreContextEnvelope,
  normalizeStoreId,
  type StoreRecord,
  type StoreWorkspaceView,
} from '@amazon-ai-ops/shared-types';
import {
  INITIAL_MISSION_CONTROL_STORE_STATE,
  requestStoreWorkspaceSwitch,
  reduceMissionControlStoreState,
  type MissionControlStoreState,
} from './store-context';
import type { MissionControlWindowApi } from './bridge/window-api';

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

  it('invalidates keyed state on archive and on a Main profile/context-key change', () => {
    const ready = reduceMissionControlStoreState(INITIAL_MISSION_CONTROL_STORE_STATE, {
      type: 'authority', view: view(),
    });
    const archived = reduceMissionControlStoreState(ready, {
      type: 'clear-authority', phase: 'needs-selection',
    });
    expect(archived.authorityKey).toBeNull();
    expect(archived.activeView).toBeNull();
    expect(archived.contextEpoch).toBe(2);

    const profileChanged = reduceMissionControlStoreState(ready, {
      type: 'authority',
      view: view({
        browserProfileId: 'profile-two',
        store: { browserProfileId: 'profile-two' },
      }),
    });
    expect(profileChanged.authorityKey).not.toBe(ready.authorityKey);
    expect(profileChanged.contextEpoch).toBe(2);
  });

  it('clears authority into a retryable error and rejects a mismatched Main switch response', async () => {
    const ready = reduceMissionControlStoreState(INITIAL_MISSION_CONTROL_STORE_STATE, {
      type: 'authority', view: view(),
    });
    const failed = reduceMissionControlStoreState(ready, {
      type: 'clear-authority',
      phase: 'error',
      error: 'Main 返回的店铺或站点与请求不匹配',
    });
    expect(failed).toMatchObject({
      activeStore: null,
      activeView: null,
      authoritativeContext: null,
      authorityKey: null,
      phase: 'error',
      error: 'Main 返回的店铺或站点与请求不匹配',
    });
    expect(failed.contextEpoch).toBe(2);

    const otherStoreId = normalizeStoreId('store-other');
    await expect(requestStoreWorkspaceSwitch({
      switchStore: async () => view({
        store: { ...store, storeId: otherStoreId },
      }),
    }, {
      storeId: store.storeId,
      marketplace: 'US',
    })).rejects.toThrow(/Main.*店铺或站点.*不匹配/);

    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const switchBlock = source.slice(
      source.indexOf('const switchStore ='),
      source.indexOf('const retryBootstrap ='),
    );
    expect(switchBlock).toContain('requestStoreWorkspaceSwitch(api, scope)');
    expect(switchBlock).toContain('error instanceof StoreSwitchAuthorityMismatchError');
    expect(switchBlock).toContain("type: 'clear-authority'");
    expect(switchBlock).toContain("phase: 'error'");
    expect(switchBlock).not.toContain('post-commit-sync-warning');
  });

  it('adopts committed connection results locally while keeping sync warnings non-fatal', () => {
    const ready = reduceMissionControlStoreState(INITIAL_MISSION_CONTROL_STORE_STATE, {
      type: 'authority',
      view: {
        ...view(),
        sessions: [{
          storeId: store.storeId,
          browserProfileId: store.browserProfileId,
          provider: 'lingxing',
          status: 'ready',
          sessionGeneration: 1 as any,
          observedAt: '2026-07-22T00:00:00.000Z',
        }],
      },
    });
    const connection = {
      id: 'capability-one',
      storeId: store.storeId,
      provider: 'lingxing',
      status: 'not_configured',
      accountLabel: 'operator',
      collectionStoreName: 'Download Store',
      normalizedCollectionStoreName: 'download store',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:01:00.000Z',
    } as const;
    const committed = reduceMissionControlStoreState(ready, {
      type: 'connection-committed', connection: connection as any,
    });
    const warned = reduceMissionControlStoreState(committed, {
      type: 'post-commit-sync-warning', warning: '写入成功，刷新失败/需重新同步',
    });
    const removed = reduceMissionControlStoreState(warned, {
      type: 'connection-removed', connection: connection as any,
    });

    expect(committed.activeView?.connections).toEqual([connection]);
    expect(committed.activeView?.sessions).toEqual([]);
    expect(warned.phase).toBe('ready');
    expect(warned.postCommitSyncWarning).toContain('写入成功');
    expect(removed.activeView?.connections).toEqual([]);
  });

  it('subscribes to both authority events and retries both store list and authority bootstrap', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    expect(source).toContain('api.onStoreContextChanged');
    expect(source).toContain('api.onStoresChanged');
    expect(source).toMatch(/const retryBootstrap[\s\S]*await refreshStores\(\);[\s\S]*await resyncAuthority/);
    expect(source).toContain("dispatch({ type: 'clear-authority', phase: 'needs-selection' })");
  });

  it('adopts Main event payloads directly and ignores superseded switch responses', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const listenerBlock = source.slice(
      source.indexOf('const removeContextListener'),
      source.indexOf('const removeStoresListener'),
    );
    expect(listenerBlock).toContain("dispatch({ type: 'authority', view })");
    expect(listenerBlock).not.toContain("resyncAuthority('needs-selection')");
    expect(source).toContain('const switchSequence = ++switchSequenceRef.current');
    expect(source).toContain('switchSequence !== switchSequenceRef.current');
    expect(source).toMatch(/const switchStore[\s\S]*dispatch\(\{ type: 'authority', view \}\)[\s\S]*runBestEffortPostCommitSync/);
  });

  it('invalidates any older Authority read before adopting a newer Main event', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const listenerBlock = source.slice(
      source.indexOf('const removeContextListener'),
      source.indexOf('const removeStoresListener'),
    );
    const invalidationIndex = listenerBlock.indexOf('++resyncSequenceRef.current');
    const authorityDispatchIndex = listenerBlock.indexOf("dispatch({ type: 'authority', view })");

    expect(invalidationIndex).toBeGreaterThanOrEqual(0);
    expect(invalidationIndex).toBeLessThan(authorityDispatchIndex);
  });

  it('keeps newer Main authority when an older active-view read resolves null', async () => {
    let latestState: MissionControlStoreState | undefined;
    let contextListener: ((next: StoreWorkspaceView | null) => void) | undefined;
    const cleanups: Array<() => void> = [];

    vi.resetModules();
    vi.doMock('react', async () => {
      const actual = await vi.importActual<typeof import('react')>('react');
      return {
        ...actual,
        useMemo: (factory: () => unknown) => factory(),
        useCallback: <T,>(callback: T) => callback,
        useRef: <T,>(initial: T) => ({ current: initial }),
        useState: <T,>(initial: T) => {
          latestState = initial as unknown as MissionControlStoreState;
          const setState = (next: T | ((current: T) => T)) => {
            const current = latestState as unknown as T;
            latestState = (
              typeof next === 'function'
                ? (next as (value: T) => T)(current)
                : next
            ) as unknown as MissionControlStoreState;
          };
          return [initial, setState];
        },
        useEffect: (effect: () => void | (() => void)) => {
          const cleanup = effect();
          if (cleanup) cleanups.push(cleanup);
        },
      };
    });

    try {
      const { MissionControlStoreContextProvider } = await import('./store-context');
      let resolveActiveView!: (value: StoreWorkspaceView | null) => void;
      const delayedActiveView = new Promise<StoreWorkspaceView | null>((resolve) => {
        resolveActiveView = resolve;
      });
      const getActiveStoreWorkspaceView = vi.fn(() => delayedActiveView);
      const api = {
        listStores: vi.fn(async () => [store]),
        listStoreDailyStatuses: vi.fn(async () => ({
          schemaVersion: 1,
          marketplace: 'US',
          generatedAt: '2026-07-22T00:00:00.000Z',
          stores: [],
        })),
        getActiveStoreWorkspaceView,
        onStoreContextChanged: vi.fn((listener: (next: StoreWorkspaceView | null) => void) => {
          contextListener = listener;
          return () => undefined;
        }),
        onStoresChanged: vi.fn(() => () => undefined),
      } as unknown as MissionControlWindowApi;

      MissionControlStoreContextProvider({ api, children: null });
      await vi.waitFor(() => {
        expect(getActiveStoreWorkspaceView).toHaveBeenCalledTimes(1);
      });

      contextListener?.(view());
      expect(latestState).toMatchObject({
        phase: 'ready',
        activeStore: { storeId: store.storeId },
        authorityKey: expect.any(String),
      });

      resolveActiveView(null);
      await Promise.resolve();
      await Promise.resolve();
      expect(latestState).toMatchObject({
        phase: 'ready',
        activeStore: { storeId: store.storeId },
        authorityKey: expect.any(String),
      });
    } finally {
      cleanups.reverse().forEach((cleanup) => cleanup());
      vi.doUnmock('react');
      vi.resetModules();
    }
  });

  it('reserves bootstrap and retry Authority reads before their earlier async refresh work', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const bootstrapBlock = source.slice(
      source.indexOf('const bootstrap = async'),
      source.indexOf('void bootstrap()'),
    );
    const retryBlock = source.slice(
      source.indexOf('const retryBootstrap ='),
      source.indexOf('const createStore ='),
    );

    for (const block of [bootstrapBlock, retryBlock]) {
      const reservationIndex = block.indexOf('const authoritySequence = ++resyncSequenceRef.current');
      const refreshIndex = block.indexOf('await refreshStores()');
      expect(reservationIndex).toBeGreaterThanOrEqual(0);
      expect(reservationIndex).toBeLessThan(refreshIndex);
      expect(block).toContain("resyncAuthority('needs-selection', authoritySequence)");
    }
  });

  it('resyncs the complete Main workspace view without fabricating empty connections', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const readActiveView = source.slice(
      source.indexOf('const readActiveView'),
      source.indexOf('const resyncAuthority'),
    );

    expect(readActiveView).toContain('api.getActiveStoreWorkspaceView()');
    expect(readActiveView).not.toContain('connections: []');
    expect(readActiveView).not.toContain('sessions: []');
  });

  it('upserts only operator-editable Lingxing selector fields and treats stable id as Main-only', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const bindBlock = source.slice(
      source.indexOf('const bindLingxingConnection'),
      source.indexOf('const value ='),
    );

    expect(bindBlock).toContain("connection.provider === 'lingxing'");
    expect(bindBlock).toContain("provider: 'lingxing'");
    expect(bindBlock).toContain('api.updateStoreConnection');
    expect(bindBlock).toContain('accountLabel');
    expect(bindBlock).toContain('collectionStoreName: collectionStoreName.trim()');
    expect(bindBlock).toContain('expectedUpdatedAt: existing.updatedAt');
    expect(bindBlock).toContain('candidate.normalizedCollectionStoreName === normalizedCollectionStoreName');
    expect(bindBlock).not.toContain('externalAccountId: collectionStoreName');
    expect(bindBlock).toContain('readActiveView()');
    expect(bindBlock).toContain('sameStoreAuthorityIdentity');
    expect(bindBlock).toContain('candidate.storeId === confirmedView.store.storeId');
    expect(bindBlock).toContain('candidate.id === changed.id');
    expect(bindBlock).toContain("candidate.status === 'not_configured'");
    expect(bindBlock).toContain('hasExpectedIdentityResetFailure(candidate, existing)');
    expect(bindBlock).toContain('isResetConnectionSession(candidate, existing)');
    expect(bindBlock).toContain("dispatch({ type: 'connection-committed', connection: changed })");
    expect(bindBlock).toContain('runBestEffortPostCommitSync');
    expect(bindBlock).not.toMatch(/password|cookie|token/i);
  });

  it('does not expose a Renderer path for supplying an Amazon Ads identity', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('bindAmazonAdsConnection');
    expect(source).not.toContain('normalizeAmazonAdsProfileId');
    expect(source).not.toContain("provider: 'amazon_ads'");
    expect(source).not.toContain('externalAccountId: normalizedExternalAccountId');
  });

  it('accepts only the exact identity-change tombstone and never an old ready session', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const resetFailure = source.slice(
      source.indexOf('function hasExpectedIdentityResetFailure'),
      source.indexOf('function errorMessage'),
    );
    expect(resetFailure).toContain("candidate.lastFailureCode === 'connection_identity_changed'");
    expect(resetFailure).toContain(': !candidate.lastFailureCode');
    expect(source).toContain("session.status !== 'signed_out'");
    expect(source).toContain('Number(session.sessionGeneration) > previousGeneration');
  });

  it('switches only an explicit Store + Marketplace scope and ignores stale daily status reads', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    expect(source).toContain('switchStore(scope: StoreScopeRef)');
    expect(source).toContain('api.switchStore(scope)');
    expect(source).toContain('view.context.marketplace !== scope.marketplace');
    expect(source).toMatch(/dispatch\(\{ type: 'authority', view \}\);[\s\S]*runBestEffortPostCommitSync\('切换店铺'/);
    expect(source).toContain('const sequence = ++dailyStatusSequenceRef.current');
    expect(source).toContain('sequence !== dailyStatusSequenceRef.current');
  });

  it('exposes real typed Store CRUD and never auto-switches after creation', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    expect(source).toContain('createStore(input: CreateStoreInput)');
    expect(source).toContain('updateStore(input: UpdateStoreInput)');
    expect(source).toContain('archiveStore(input: ArchiveStoreInput)');
    expect(source).toContain('restoreStore(input: RestoreStoreInput)');
    const createBlock = source.slice(source.indexOf('const createStore ='), source.indexOf('const updateStore ='));
    expect(createBlock).toContain('api.createStore(input)');
    expect(createBlock).toMatch(/dispatch\(\{ type: 'stores'[\s\S]*runBestEffortPostCommitSync/);
    expect(createBlock).not.toContain('switchStore');
  });

  it('passes the exact connection revision to unbind and never rejects a committed write for refresh failure', () => {
    const source = fs.readFileSync(new URL('./store-context.tsx', import.meta.url), 'utf8');
    const unbindBlock = source.slice(
      source.indexOf('const unbindStoreConnection'),
      source.indexOf('const value ='),
    );
    expect(unbindBlock).toContain('expectedUpdatedAt: connection.updatedAt');
    expect(unbindBlock).toMatch(/await api\.removeStoreConnection[\s\S]*dispatch\(\{ type: 'connection-removed'/);
    expect(unbindBlock).toContain("runBestEffortPostCommitSync('解绑连接映射'");
    expect(source).toContain('写入成功，刷新失败/需重新同步');
    expect(source).toContain('Promise.allSettled');
  });
});
