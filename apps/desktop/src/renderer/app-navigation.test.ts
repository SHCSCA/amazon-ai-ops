import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAppNavigationEventHandler, subscribeAppWorkflowInvalidation } from './App';
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

describe('App unified Decisions workspace routing', () => {
  it('passes the full active navigation intent into BusinessRoutePage', () => {
    const source = appSource();

    expect(source).toContain('function BusinessRoutePage({ navigation, nextSafeAction }');
    expect(source).toContain('navigation: NavigationIntent');
    expect(source).toContain('<BusinessRoutePage navigation={activeNavigation} nextSafeAction={nextSafeAction} />');
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
});
