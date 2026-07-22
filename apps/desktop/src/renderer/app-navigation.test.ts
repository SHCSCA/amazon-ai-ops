import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createAppNavigationEventHandler,
  createLatestWorkflowLoadGuard,
  defaultOperationScopeForAuthority,
  operationScopeBelongsToAuthority,
  resetWorkspaceScrollPosition,
  shouldInvalidateLoginForStoreAuthority,
  shouldRestoreLoginForStoreAuthority,
  shouldStartLoginRestoreForAuthority,
  subscribeAppWorkflowInvalidation,
} from './App';
import type { NavigationIntent } from './navigation';
import { notifyWorkflowInvalidated } from './workflow-invalidation';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';

function navigationEvent(detail: unknown): Event {
  return { detail } as unknown as Event;
}

function appSource(): string {
  return readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
}

function routerSource(): string {
  return readFileSync(new URL('./mission-control/router.tsx', import.meta.url), 'utf8');
}

function boundarySource(): string {
  return readFileSync(new URL('./mission-control/legacy-boundary.tsx', import.meta.url), 'utf8');
}

describe('App canonical navigation events', () => {
  it('normalizes every legacy event into the new workspace model', () => {
    const visited: NavigationIntent[] = [];
    const handler = createAppNavigationEventHandler((intent) => visited.push(intent));

    expect(handler(navigationEvent('approval'))).toBe(true);
    expect(handler(navigationEvent('readback'))).toBe(true);
    expect(visited).toEqual([
      { workspace: 'decisions', subview: 'approval' },
      { workspace: 'execution', subview: 'evidence' },
    ]);
  });

  it('accepts canonical-only workspaces without inventing a legacy route', () => {
    const visited: NavigationIntent[] = [];
    const handler = createAppNavigationEventHandler((intent) => visited.push(intent));
    const intents = [
      { workspace: 'missions', subview: 'overview' },
      { workspace: 'experiments', subview: 'ledger' },
      { workspace: 'execution', subview: 'live' },
      { workspace: 'memory', subview: 'timeline' },
      { workspace: 'policy', subview: 'rules' },
    ] as const;

    intents.forEach((intent) => expect(handler(navigationEvent(intent))).toBe(true));
    expect(visited).toEqual(intents);
  });

  it('fails closed for malformed navigation details', () => {
    const visited: NavigationIntent[] = [];
    const handler = createAppNavigationEventHandler((intent) => visited.push(intent));
    expect(handler(navigationEvent({ workspace: 'decisions', subview: 'targets' }))).toBe(false);
    expect(handler(navigationEvent('not-a-route'))).toBe(false);
    expect(visited).toEqual([]);
  });
});

describe('Mission Control runtime composition', () => {
  it('gates store selection before login and mounts the runtime only after both are ready', () => {
    const source = appSource();
    const providerIndex = source.indexOf('<MissionControlStoreContextProvider>');
    const sessionBoundaryIndex = source.indexOf('<MissionControlSessionAuthorityBoundary>');
    const gateIndex = source.indexOf('<MissionControlStoreGate>');
    const loginChoiceIndex = source.indexOf('{isLoggedIn ? (');

    expect(providerIndex).toBeGreaterThan(0);
    expect(sessionBoundaryIndex).toBeGreaterThan(providerIndex);
    expect(gateIndex).toBeGreaterThan(sessionBoundaryIndex);
    expect(loginChoiceIndex).toBeGreaterThan(gateIndex);
    expect(source).toContain(') : <LoginPage />}');
    expect(source).not.toContain("if (!isLoggedIn) return <LoginPage />");
  });

  it('uses the canonical workspace registry and remounts store-scoped state by authority key', () => {
    const source = appSource();
    expect(source).toContain('<MissionControlWorkspaceView');
    expect(source).toContain('key={store.authorityKey}');
    expect(source).toContain('data-authority-key={store.authorityKey}');
    expect(source).toContain('capabilities={missionControl.phase === \'loading\' ? undefined : missionControl.capabilities}');
    expect(source).not.toContain('function BusinessRoutePage(');
  });

  it('does not reject canonical-only navigation because resolveNavigationTarget returned null', () => {
    const source = appSource();
    const requestNavigateStart = source.indexOf('const requestNavigate = useCallback');
    const requestNavigateEnd = source.indexOf('useEffect(() => {', requestNavigateStart);
    const requestNavigate = source.slice(requestNavigateStart, requestNavigateEnd);
    expect(requestNavigate).toContain('normalizeNavigationTarget(target)');
    expect(requestNavigate).not.toContain('resolveNavigationTarget');
  });

  it('binds the real Store Authority CRUD panel instead of a decorative slot', () => {
    const source = appSource();
    expect(source).toContain('<StoreManagementPanel');
    expect(source).toContain('onCreate={store.createStore}');
    expect(source).toContain('onUpdate={store.updateStore}');
    expect(source).toContain('onArchive={store.archiveStore}');
    expect(source).toContain('onRestore={store.restoreStore}');
    expect(source).toContain('onSwitch={store.switchStore}');
  });
});

describe('Store authority login-session invalidation', () => {
  const cold = { authorityKey: null, contextEpoch: 0, phase: 'loading' } as const;
  const storeA = { authorityKey: 'store-a|profile-a|1', contextEpoch: 1, phase: 'ready' } as const;

  it('keeps bootstrap login state only for the first established authority', () => {
    expect(shouldInvalidateLoginForStoreAuthority(true, cold, storeA)).toBe(false);
    expect(shouldInvalidateLoginForStoreAuthority(false, storeA, {
      authorityKey: 'store-b|profile-b|2',
      contextEpoch: 2,
      phase: 'ready',
    })).toBe(false);
  });

  it('invalidates the old ERP/Ads session as soon as an established store starts switching', () => {
    expect(shouldInvalidateLoginForStoreAuthority(true, storeA, {
      ...storeA,
      phase: 'switching',
    })).toBe(true);
  });

  it('invalidates the old session when Main replaces the authority key directly', () => {
    expect(shouldInvalidateLoginForStoreAuthority(true, storeA, {
      authorityKey: 'store-b|profile-b|2',
      contextEpoch: 2,
      phase: 'ready',
    })).toBe(true);
  });

  it.each(['needs-selection', 'loading'] as const)(
    'invalidates the old session when an established authority is cleared into %s',
    (phase) => {
      expect(shouldInvalidateLoginForStoreAuthority(true, storeA, {
        authorityKey: null,
        contextEpoch: 2,
        phase,
      })).toBe(true);
    },
  );

  it('restores a persisted login only when Main returns the exact requested and current authority', () => {
    const valid = {
      responseIsLoggedIn: true,
      responseAuthorityKey: storeA.authorityKey,
      requestedAuthorityKey: storeA.authorityKey,
      currentAuthorityKey: storeA.authorityKey,
    };
    expect(shouldRestoreLoginForStoreAuthority(valid)).toBe(true);
    expect(shouldRestoreLoginForStoreAuthority({
      ...valid,
      currentAuthorityKey: 'store-b|profile-b|2',
    })).toBe(false);
    expect(shouldRestoreLoginForStoreAuthority({
      ...valid,
      responseAuthorityKey: null,
    })).toBe(false);
    expect(shouldRestoreLoginForStoreAuthority({
      ...valid,
      responseIsLoggedIn: false,
    })).toBe(false);
  });

  it('revalidates login once for every newly established store authority', () => {
    expect(shouldStartLoginRestoreForAuthority(null, storeA)).toBe(true);
    expect(shouldStartLoginRestoreForAuthority(storeA.authorityKey, storeA)).toBe(false);
    expect(shouldStartLoginRestoreForAuthority(storeA.authorityKey, {
      authorityKey: 'store-b|profile-b|2',
      contextEpoch: 2,
      phase: 'ready',
    })).toBe(true);
    expect(shouldStartLoginRestoreForAuthority(storeA.authorityKey, {
      ...storeA,
      phase: 'switching',
    })).toBe(false);
  });
});

describe('Legacy adapter isolation', () => {
  it('keeps all legacy page imports in the explicit adapter router', () => {
    const app = appSource();
    const router = routerSource();
    const legacyPages = [
      'DashboardPage', 'ProductManagementPage', 'ProductConfigPage', 'OperationEventsPage',
      'OperationScopePage', 'DataCollectionPage', 'DataImportValidationPage', 'AdQuantPage',
      'DecisionsPage', 'ReadbackPage', 'KeywordOpportunitiesPage', 'ListingOptimizationPage',
      'SettingsPage', 'SchedulerPage', 'DeliveryPage',
    ];
    legacyPages.forEach((page) => {
      expect(app).not.toMatch(new RegExp(`import \\{ ${page} \\}`));
      expect(router).toContain(page);
    });
    expect(router).toContain('<LegacyAdapterBoundary');
  });

  it('requires exact store-scoped view, action and route capability before mounting old content', () => {
    const boundary = boundarySource();
    expect(boundary).toContain('capability.workspace === intent.workspace');
    expect(boundary).toContain('capability.view === viewId');
    expect(boundary).toContain('capability.legacyRoute === route');
    expect(boundary).toContain("capability?.state === 'LEGACY_ADAPTER'");
    expect(boundary).toContain("capability?.state === 'PROTOTYPE_ONLY' && previewMode");
    expect(boundary).toContain('当前功能未放行');
  });
});

describe('App workspace lifecycle helpers', () => {
  it('resets operation scope to the exact US/USD store authority and rejects cross-store values', () => {
    const context: StoreContextEnvelope = {
      storeId: 'scope-store-a' as StoreContextEnvelope['storeId'],
      browserProfileId: 'scope-profile-a' as StoreContextEnvelope['browserProfileId'],
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
      businessDate: '2026-07-22' as StoreContextEnvelope['businessDate'],
      sessionGeneration: 4,
    };
    const scope = defaultOperationScopeForAuthority(context, 'SHC001-US');

    expect(scope).toEqual({
      dateFrom: '2026-07-09',
      dateTo: '2026-07-22',
      storeName: 'SHC001-US',
      marketplaceCode: 'US',
      currency: 'USD',
      asin: undefined,
      batchId: undefined,
    });
    expect(operationScopeBelongsToAuthority(scope, context, 'SHC001-US')).toBe(true);
    expect(operationScopeBelongsToAuthority({ ...scope, storeName: 'SHC002-US' }, context, 'SHC001-US')).toBe(false);
    expect(operationScopeBelongsToAuthority({ ...scope, currency: 'USDT' }, context, 'SHC001-US')).toBe(false);
  });

  it('resets the shared workspace scroll owner on navigation', () => {
    const calls: ScrollToOptions[] = [];
    const owner = {
      scrollLeft: 42,
      scrollTop: 680,
      scrollTo: (options: ScrollToOptions) => calls.push(options),
    };
    expect(resetWorkspaceScrollPosition(owner)).toBe(true);
    expect(owner.scrollTop).toBe(0);
    expect(owner.scrollLeft).toBe(0);
    expect(calls).toEqual([{ top: 0, left: 0, behavior: 'auto' }]);
    expect(resetWorkspaceScrollPosition(null)).toBe(false);
  });

  it('invalidates stale overlapping workflow loads', () => {
    const guard = createLatestWorkflowLoadGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(second)).toBe(false);
  });

  it('subscribes to workflow invalidation without polling', () => {
    const target = new EventTarget();
    const sources: string[] = [];
    const unsubscribe = subscribeAppWorkflowInvalidation((detail) => sources.push(detail.source), target);
    notifyWorkflowInvalidated('approval-approved', target);
    unsubscribe();
    notifyWorkflowInvalidated('readback-verified', target);
    expect(sources).toEqual(['approval-approved']);
  });
});
