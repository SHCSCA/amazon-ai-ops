import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_INTENTS,
  LEGACY_ROUTE_INTENTS,
  VISIBLE_WORKSPACES,
  navigationIntentForRoute,
  normalizeNavigationTarget,
  resolveNavigationTarget,
} from './navigation';
import type { AppRoute } from './types';

const expectedMappings = [
  ['dashboard', { workspace: 'today', subview: 'overview' }],
  ['product-management', { workspace: 'product', subview: 'products' }],
  ['product-config', { workspace: 'product', subview: 'targets' }],
  ['operation-events', { workspace: 'product', subview: 'events' }],
  ['operation-scope', { workspace: 'data-preparation', subview: 'scope' }],
  ['data-collection', { workspace: 'data-preparation', subview: 'reports' }],
  ['data-import-validation', { workspace: 'data-preparation', subview: 'import-check' }],
  ['ad-quant', { workspace: 'diagnosis', subview: 'analysis' }],
  ['recommendations', { workspace: 'decisions', subview: 'recommendations' }],
  ['approval', { workspace: 'decisions', subview: 'approval' }],
  ['readback', { workspace: 'readback', subview: 'evidence' }],
  ['keyword-opportunities', { workspace: 'growth', subview: 'keywords' }],
  ['listing-optimization', { workspace: 'growth', subview: 'listing' }],
  ['settings', { workspace: 'system', subview: 'settings' }],
  ['scheduler', { workspace: 'system', subview: 'scheduler' }],
  ['delivery', { workspace: 'system', subview: 'delivery' }],
] as const;

describe('legacy route navigation compatibility', () => {
  it('maps all 16 AppRoute values to typed workspace intents', () => {
    expect(Object.entries(LEGACY_ROUTE_INTENTS)).toEqual(expectedMappings);

    for (const [route, intent] of expectedMappings) {
      expect(navigationIntentForRoute(route)).toEqual(intent);
    }
  });

  it('round-trips every legacy route through its structured intent', () => {
    for (const [route] of expectedMappings) {
      expect(resolveNavigationTarget(navigationIntentForRoute(route))).toBe(route);
    }
  });

  it('preserves decided as a first-class canonical subview while using the approval page as its temporary renderer', () => {
    const decided = { workspace: 'decisions', subview: 'decided' } as const;

    expect(normalizeNavigationTarget(decided)).toEqual(decided);
    expect(resolveNavigationTarget(decided)).toBe('approval');
  });

  it('continues accepting every legacy route string directly', () => {
    for (const [route] of expectedMappings) {
      expect(resolveNavigationTarget(route)).toBe(route);
    }
  });
});

describe('visible workspace navigation', () => {
  it('publishes exactly seven daily workspaces and one separated system workspace', () => {
    expect(VISIBLE_WORKSPACES.map((item) => item.id)).toEqual([
      'today',
      'product',
      'data-preparation',
      'diagnosis',
      'decisions',
      'readback',
      'growth',
      'system',
    ]);
    expect(VISIBLE_WORKSPACES.filter((item) => item.section === 'daily')).toHaveLength(7);
    expect(VISIBLE_WORKSPACES.filter((item) => item.section === 'system')).toHaveLength(1);
  });

  it('defines one valid default intent for every visible workspace', () => {
    expect(DEFAULT_WORKSPACE_INTENTS).toEqual({
      today: { workspace: 'today', subview: 'overview' },
      product: { workspace: 'product', subview: 'products' },
      'data-preparation': { workspace: 'data-preparation', subview: 'scope' },
      diagnosis: { workspace: 'diagnosis', subview: 'analysis' },
      decisions: { workspace: 'decisions', subview: 'recommendations' },
      readback: { workspace: 'readback', subview: 'evidence' },
      growth: { workspace: 'growth', subview: 'keywords' },
      system: { workspace: 'system', subview: 'settings' },
    });

    for (const workspace of VISIBLE_WORKSPACES) {
      const intent = DEFAULT_WORKSPACE_INTENTS[workspace.id];
      expect(intent.workspace).toBe(workspace.id);
      expect(resolveNavigationTarget(intent)).toBeTruthy();
    }
  });

  it('fails safely for invalid structured navigation details', () => {
    const invalidTargets: unknown[] = [
      null,
      undefined,
      '',
      'not-a-route',
      {},
      [],
      { workspace: 'product' },
      { workspace: 'product', subview: 'approval' },
      { workspace: 'unknown', subview: 'overview' },
      { workspace: 'decisions', subview: 'targets' },
      { workspace: 'today', subview: 'overview', unsafe: true },
    ];

    invalidTargets.forEach((target) => expect(resolveNavigationTarget(target)).toBeNull());
  });

  it('normalizes legacy routes into canonical intents without losing structured subviews', () => {
    expect(normalizeNavigationTarget('operation-events')).toEqual({ workspace: 'product', subview: 'events' });
    expect(normalizeNavigationTarget({ workspace: 'decisions', subview: 'decided' })).toEqual({ workspace: 'decisions', subview: 'decided' });
  });

  it('keeps the legacy mapping exhaustive at the AppRoute type boundary', () => {
    const legacyRoutes = expectedMappings.map(([route]) => route) satisfies AppRoute[];
    expect(legacyRoutes).toHaveLength(16);
  });
});
