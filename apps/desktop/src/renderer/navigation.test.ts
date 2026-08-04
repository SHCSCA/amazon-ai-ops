import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_INTENTS,
  LEGACY_ROUTE_INTENTS,
  VISIBLE_WORKSPACES,
  WORKSPACE_SUBVIEW_TABS,
  navigationIntentForRoute,
  navigationNeedsGlobalHandoff,
  normalizeNavigationTarget,
  resolveNavigationTarget,
} from './navigation';
import type { AppRoute } from './types';

const expectedMappings = [
  ['dashboard', { workspace: 'today', subview: 'overview' }],
  ['product-management', { workspace: 'objects', subview: 'products' }],
  ['product-config', { workspace: 'objects', subview: 'targets' }],
  ['operation-events', { workspace: 'today', subview: 'events' }],
  ['operation-scope', { workspace: 'collection', subview: 'scope' }],
  ['data-collection', { workspace: 'collection', subview: 'reports' }],
  ['data-import-validation', { workspace: 'collection', subview: 'import-check' }],
  ['ad-quant', { workspace: 'missions', subview: 'facts' }],
  ['recommendations', { workspace: 'decisions', subview: 'recommendations' }],
  ['approval', { workspace: 'decisions', subview: 'approval' }],
  ['readback', { workspace: 'execution', subview: 'evidence' }],
  ['keyword-opportunities', { workspace: 'objects', subview: 'keywords' }],
  ['listing-optimization', { workspace: 'objects', subview: 'listing' }],
  ['settings', { workspace: 'settings', subview: 'ai-and-local' }],
  ['scheduler', { workspace: 'settings', subview: 'scheduler' }],
  ['delivery', { workspace: 'settings', subview: 'delivery' }],
] as const satisfies ReadonlyArray<readonly [AppRoute, ReturnType<typeof navigationIntentForRoute>]>;

describe('legacy route navigation compatibility', () => {
  it('maps all 16 legacy routes into canonical Mission Control intents', () => {
    expect(Object.entries(LEGACY_ROUTE_INTENTS)).toEqual(expectedMappings);
    for (const [route, intent] of expectedMappings) {
      expect(navigationIntentForRoute(route)).toEqual(intent);
      expect(resolveNavigationTarget(intent)).toBe(route);
      expect(resolveNavigationTarget(route)).toBe(route);
    }
  });

  it('keeps decided canonical while reusing the read-only approval page adapter', () => {
    const decided = { workspace: 'decisions', subview: 'decided' } as const;
    expect(normalizeNavigationTarget(decided)).toEqual(decided);
    expect(resolveNavigationTarget(decided)).toBe('approval');
  });

  it('does not invent legacy routes for canonical-only workspaces', () => {
    const canonicalOnly = [
      { workspace: 'missions', subview: 'overview' },
      { workspace: 'experiments', subview: 'ledger' },
      { workspace: 'execution', subview: 'live' },
      { workspace: 'memory', subview: 'timeline' },
      { workspace: 'policy', subview: 'rules' },
    ] as const;
    canonicalOnly.forEach((intent) => {
      expect(normalizeNavigationTarget(intent)).toEqual(intent);
      expect(resolveNavigationTarget(intent)).toBeNull();
    });
  });
});

describe('ten-workspace information architecture', () => {
  it('publishes exactly ten workspaces in four operator groups', () => {
    expect(VISIBLE_WORKSPACES.map((item) => item.id)).toEqual([
      'today',
      'missions',
      'decisions',
      'experiments',
      'execution',
      'memory',
      'objects',
      'collection',
      'policy',
      'settings',
    ]);
    expect(VISIBLE_WORKSPACES.map((item) => item.label)).toEqual([
      '今日任务',
      '任务中心',
      '决策与审批',
      '经营实验',
      '实时执行',
      '因果记忆',
      '店铺与广告对象',
      '数据采集',
      '策略与风控',
      '系统设置',
    ]);
    expect(Object.fromEntries(['mission', 'learning', 'foundation', 'governance'].map((section) => [
      section,
      VISIBLE_WORKSPACES.filter((item) => item.section === section).length,
    ]))).toEqual({ mission: 3, learning: 3, foundation: 2, governance: 2 });
  });

  it('defines a valid canonical default for every workspace, including route-less workspaces', () => {
    for (const workspace of VISIBLE_WORKSPACES) {
      const intent = DEFAULT_WORKSPACE_INTENTS[workspace.id];
      expect(intent.workspace).toBe(workspace.id);
      expect(normalizeNavigationTarget(intent)).toEqual(intent);
    }
    expect(resolveNavigationTarget(DEFAULT_WORKSPACE_INTENTS.experiments)).toBeNull();
  });

  it('opens data collection at scope while preserving the legacy reports deep link', () => {
    const collectionWorkspace = VISIBLE_WORKSPACES.find((workspace) => workspace.id === 'collection');
    const scopeIntent = { workspace: 'collection', subview: 'scope' } as const;
    const reportsIntent = { workspace: 'collection', subview: 'reports' } as const;

    expect(DEFAULT_WORKSPACE_INTENTS.collection).toEqual(scopeIntent);
    expect(collectionWorkspace?.defaultIntent).toEqual(scopeIntent);
    expect(normalizeNavigationTarget(collectionWorkspace?.defaultIntent)).toEqual(scopeIntent);
    expect(resolveNavigationTarget(collectionWorkspace?.defaultIntent)).toBe('operation-scope');

    expect(normalizeNavigationTarget('data-collection')).toEqual(reportsIntent);
    expect(resolveNavigationTarget(reportsIntent)).toBe('data-collection');
  });

  it('publishes the complete operator-facing tab contract', () => {
    expect(Object.keys(WORKSPACE_SUBVIEW_TABS)).toEqual([
      'today', 'missions', 'decisions', 'execution', 'objects', 'collection', 'settings',
    ]);
    expect(WORKSPACE_SUBVIEW_TABS.decisions.map((tab) => tab.id)).toEqual([
      'recommendations', 'approval', 'decided',
    ]);
    expect(WORKSPACE_SUBVIEW_TABS.objects.map((tab) => tab.id)).toEqual([
      'products', 'targets', 'keywords', 'listing',
    ]);
  });

  it('fails closed for invalid structured targets', () => {
    const invalidTargets: unknown[] = [
      null,
      undefined,
      '',
      'not-a-route',
      {},
      [],
      { workspace: 'missions' },
      { workspace: 'missions', subview: 'approval' },
      { workspace: 'unknown', subview: 'overview' },
      { workspace: 'today', subview: 'overview', unsafe: true },
    ];
    invalidTargets.forEach((target) => {
      expect(normalizeNavigationTarget(target)).toBeNull();
      expect(resolveNavigationTarget(target)).toBeNull();
    });
  });

  it('reserves global handoff for cross-workspace navigation', () => {
    expect(navigationNeedsGlobalHandoff(
      { workspace: 'decisions', subview: 'recommendations' },
      { workspace: 'decisions', subview: 'decided' },
    )).toBe(false);
    expect(navigationNeedsGlobalHandoff(
      { workspace: 'decisions', subview: 'decided' },
      { workspace: 'execution', subview: 'evidence' },
    )).toBe(true);
    expect(navigationNeedsGlobalHandoff(null, { workspace: 'today', subview: 'overview' })).toBe(false);
  });
});
