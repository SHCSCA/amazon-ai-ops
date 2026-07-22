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

  it('preserves decided as a first-class canonical subview while keeping the legacy approval route alias', () => {
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
    expect(VISIBLE_WORKSPACES.map((item) => item.label)).toEqual([
      '今日任务',
      '产品工作台',
      '数据准备',
      '广告诊断',
      '建议与审批',
      '结果核对',
      '关键词与 Listing',
      '系统与交付',
    ]);
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

  it('publishes operator-facing subview tabs for every remaining workspace migration', () => {
    expect(WORKSPACE_SUBVIEW_TABS.product.map((item) => [item.id, item.label])).toEqual([
      ['products', '产品'],
      ['targets', '目标与成本'],
      ['events', '运营事件'],
    ]);
    expect(WORKSPACE_SUBVIEW_TABS['data-preparation'].map((item) => [item.id, item.label])).toEqual([
      ['scope', '工作范围'],
      ['reports', '报表采集'],
      ['import-check', '导入检查'],
    ]);
    expect(WORKSPACE_SUBVIEW_TABS.diagnosis.map((item) => item.id)).toEqual(['analysis']);
    expect(WORKSPACE_SUBVIEW_TABS.growth.map((item) => [item.id, item.label])).toEqual([
      ['keywords', '关键词机会'],
      ['listing', 'Listing 草案'],
    ]);
    expect(WORKSPACE_SUBVIEW_TABS.system.map((item) => [item.id, item.label])).toEqual([
      ['settings', 'AI 与规则'],
      ['scheduler', '定时任务'],
      ['delivery', '交付验收'],
    ]);
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

  it('reserves the global route handoff for cross-workspace navigation', () => {
    expect(navigationNeedsGlobalHandoff(
      { workspace: 'decisions', subview: 'recommendations' },
      { workspace: 'decisions', subview: 'decided' },
    )).toBe(false);
    expect(navigationNeedsGlobalHandoff(
      { workspace: 'decisions', subview: 'decided' },
      { workspace: 'readback', subview: 'evidence' },
    )).toBe(true);
    expect(navigationNeedsGlobalHandoff(null, { workspace: 'today', subview: 'overview' })).toBe(false);
  });
});
