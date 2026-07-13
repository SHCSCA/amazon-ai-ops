import { describe, expect, it } from 'vitest';
import { createAppNavigationEventHandler } from './App';
import type { NavigationIntent } from './navigation';

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
