import { describe, expect, it } from 'vitest';
import { createAppNavigationEventHandler, subscribeAppWorkflowInvalidation } from './App';
import type { NavigationIntent } from './navigation';
import { notifyWorkflowInvalidated } from './workflow-invalidation';

function navigationEvent(detail: unknown): Event {
  return { detail } as unknown as Event;
}

describe('App runtime navigation event compatibility', () => {
  it('handles a legacy AppRoute event through the runtime handler', () => {
    const visited: NavigationIntent[] = [];
    const handler = createAppNavigationEventHandler((intent) => visited.push(intent));

    expect(handler(navigationEvent('approval'))).toBe(true);
    expect(visited).toEqual([{ workspace: 'decisions', subview: 'approval' }]);
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
