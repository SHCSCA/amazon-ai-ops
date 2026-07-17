import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAppNavigationEventHandler, createLatestWorkflowLoadGuard, resetWorkspaceScrollPosition, subscribeAppWorkflowInvalidation } from './App';
import type { NavigationIntent } from './navigation';
import { notifyWorkflowInvalidated } from './workflow-invalidation';

function navigationEvent(detail: unknown): Event {
  return { detail } as unknown as Event;
}

function appSource(): string {
  return readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
}

describe('App runtime navigation event compatibility', () => {
  it('handles a legacy AppRoute event through the runtime handler', () => {
    const visited: NavigationIntent[] = [];
    const handler = createAppNavigationEventHandler((intent) => visited.push(intent));

    expect(handler(navigationEvent('approval'))).toBe(true);
    expect(visited).toEqual([{ workspace: 'decisions', subview: 'approval' }]);
  });

  it.each([
    ['recommendations', { workspace: 'decisions', subview: 'recommendations' }],
    ['approval', { workspace: 'decisions', subview: 'approval' }],
  ] as const)('preserves the canonical decision intent for legacy %s events', (route, expected) => {
    const visited: NavigationIntent[] = [];
    const handler = createAppNavigationEventHandler((intent) => visited.push(intent));

    expect(handler(navigationEvent(route))).toBe(true);
    expect(visited).toEqual([expected]);
  });

  it('handles and preserves a structured NavigationIntent through the same runtime handler', () => {
    const visited: NavigationIntent[] = [];
    const handler = createAppNavigationEventHandler((intent) => visited.push(intent));

    expect(handler(navigationEvent({ workspace: 'decisions', subview: 'decided' }))).toBe(true);
    expect(visited).toEqual([{ workspace: 'decisions', subview: 'decided' }]);
  });

  it('fails safely without navigation for invalid structured event details', () => {
    const visited: NavigationIntent[] = [];
    const handler = createAppNavigationEventHandler((intent) => visited.push(intent));

    expect(handler(navigationEvent({ workspace: 'decisions', subview: 'targets' }))).toBe(false);
    expect(handler(navigationEvent('not-a-route'))).toBe(false);
    expect(visited).toEqual([]);
  });
});

describe('App workspace scroll restoration', () => {
  it('resets the shared workspace scroll owner to the top-left on navigation', () => {
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

  it('uses a layout-timed reset and one repaint guard for every workspace/subview change', () => {
    const source = appSource();

    expect(source).toContain('useLayoutEffect(() =>');
    expect(source).toContain('resetWorkspaceScrollPosition(content)');
    expect(source).toContain('window.requestAnimationFrame');
  });
});

describe('App unified Decisions workspace routing', () => {
  it('passes the full active navigation intent into BusinessRoutePage', () => {
    const source = appSource();

    expect(source).toContain('function BusinessRoutePage({');
    expect(source).toContain('navigation,');
    expect(source).toContain('nextSafeAction,');
    expect(source).toContain('readbackAuthority,');
    expect(source).toContain('navigation: NavigationIntent');
    expect(source).toContain('<BusinessRoutePage');
    expect(source).toContain('navigation={activeNavigation}');
    expect(source).toContain('nextSafeAction={nextSafeAction}');
    expect(source).toContain('readbackAuthority={readbackAuthority}');
  });

  it('renders every Decisions subview through one DecisionsPage and preserves legacy route sidebar state', () => {
    const source = appSource();

    expect(source).toContain("import { DecisionsPage } from './pages/decisions-page';");
    expect(source).not.toContain("import { RecommendationsPage } from './pages/recommendations-page';");
    expect(source).not.toContain("import { ApprovalPage } from './pages/approval-page';");
    expect(source).toContain("if (navigation.workspace === 'decisions') return <DecisionsPage activeSubview={navigation.subview} />;");
    expect(source).not.toContain("if (route === 'recommendations') return <RecommendationsPage />;");
    expect(source).not.toContain("if (route === 'approval') return <ApprovalPage />;");
    expect(source).toContain("const activeTab = resolveNavigationTarget(activeNavigation) || 'dashboard';");
    expect(source).toContain('<Sidebar activeRoute={activeTab}');
  });
});

describe('App remaining workspace shell routing', () => {
  it('uses the shared shell only for multi-subview workspaces and renders diagnosis directly', () => {
    const source = appSource();

    expect(source).toContain("import { WorkspaceSubviewShell } from './components/workspace';");
    expect(source).toContain('WORKSPACE_SUBVIEW_TABS,');
    expect(source).toContain('onNavigate: (intent: NavigationIntent) => void');
    expect(source).toContain('onNavigate={requestNavigate}');
    expect(source).toContain("navigation.workspace === 'product'");
    expect(source).toContain("navigation.workspace === 'data-preparation'");
    expect(source).toContain("navigation.workspace === 'diagnosis'");
    expect(source).toContain("navigation.workspace === 'growth'");
    expect(source).toContain("navigation.workspace === 'system'");
    expect(source).toContain("if (navigation.workspace === 'diagnosis') return <AdQuantPage />;");
    expect(source.match(/<WorkspaceSubviewShell/g)).toHaveLength(4);
    expect(source).toContain("ownsPageHeading={navigation.subview === 'products'}");
  });

  it('shows one workspace-level preview warning across every System subview', () => {
    const source = appSource();

    expect(source).toContain('previewMode: boolean');
    expect(source).toContain('previewMode={browserPreviewBootstrap.enabled}');
    expect(source).toContain('仅开发预览，不代表 APP_READY');
  });
});

describe('App workflow invalidation subscription', () => {
  it('reloads workflow state for runtime invalidations and cleans up without polling', () => {
    const target = new EventTarget();
    const sources: string[] = [];
    const unsubscribe = subscribeAppWorkflowInvalidation((detail) => sources.push(detail.source), target);

    notifyWorkflowInvalidated('approval-approved', target);
    expect(sources).toEqual(['approval-approved']);

    unsubscribe();
    notifyWorkflowInvalidated('readback-verified', target);
    expect(sources).toEqual(['approval-approved']);
  });

  it('keeps only the newest overlapping workflow reload authoritative', () => {
    const guard = createLatestWorkflowLoadGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);

    guard.invalidate();
    expect(guard.isCurrent(second)).toBe(false);
  });
});
