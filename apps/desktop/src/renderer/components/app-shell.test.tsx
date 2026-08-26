import React, { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_SECTION_DEFINITIONS,
  NextSafeActionHandoff,
  Sidebar,
  workspaceCapabilityState,
} from './app-shell';
import { VISIBLE_WORKSPACES } from '../navigation';
import type { NavigationIntent } from '../navigation';
import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope, StoreRecord } from '@amazon-ai-ops/shared-types';
import {
  DEFAULT_BLOCKED_AUTONOMY,
  MissionControlShell,
} from '../mission-control/mission-control-shell';

function collectElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElements(child, predicate));
  if (!React.isValidElement(node)) return [];
  const matches = predicate(node) ? [node] : [];
  return matches.concat(collectElements(node.props.children, predicate));
}

function collectText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (!React.isValidElement(node)) return '';
  return collectText(node.props.children);
}

describe('Mission Control sidebar', () => {
  it('renders the exact ten canonical workspaces in four labelled groups', () => {
    const activeIntent = { workspace: 'today', subview: 'overview' } as const;
    const markup = renderToStaticMarkup(<Sidebar activeIntent={activeIntent} onNavigate={() => undefined} />);
    const tree = Sidebar({ activeIntent, onNavigate: () => undefined }) as ReactElement;
    const groups = collectElements(tree, (element) => element.type === 'section');
    const buttons = collectElements(tree, (element) => element.type === 'button');

    expect(buttons).toHaveLength(10);
    expect(groups.map((group) => group.props['data-navigation-section'])).toEqual([
      'mission', 'learning', 'foundation', 'governance',
    ]);
    expect(NAVIGATION_SECTION_DEFINITIONS.map((section) => [section.label, section.items.length])).toEqual([
      ['任务', 3], ['学习闭环', 3], ['运营底座', 2], ['治理', 2],
    ]);
    VISIBLE_WORKSPACES.forEach((workspace) => expect(markup).toContain(workspace.label));
  });

  it('marks canonical active/pending state without needing a legacy route', () => {
    const tree = Sidebar({
      activeIntent: { workspace: 'experiments', subview: 'ledger' },
      pendingIntent: { workspace: 'memory', subview: 'timeline' },
      onNavigate: () => undefined,
    }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const experiments = buttons.find((button) => collectText(button).includes('经营实验'));
    const memory = buttons.find((button) => collectText(button).includes('因果记忆'));

    expect(experiments?.props['aria-current']).toBe('page');
    expect(memory?.props['aria-busy']).toBe(true);
    expect(memory?.props['data-pending']).toBe('true');
    expect(buttons.every((button) => button.props.disabled)).toBe(true);
  });

  it('dispatches the canonical default intent from real buttons', () => {
    const visited: NavigationIntent[] = [];
    const tree = Sidebar({
      activeIntent: { workspace: 'today', subview: 'overview' },
      onNavigate: (intent) => visited.push(intent),
    }) as ReactElement;
    const policy = collectElements(tree, (element) => element.type === 'button')
      .find((button) => collectText(button).includes('策略与风控'));

    expect(policy?.props.type).toBe('button');
    policy?.props.onClick();
    expect(visited).toEqual([{ workspace: 'policy', subview: 'rules' }]);
  });

  it('summarizes view capabilities without treating a mixed workspace as authoritative', () => {
    const capabilities = [
      {
        capabilityId: 'objects.products.view',
        workspace: 'objects',
        view: 'objects/products',
        action: 'view',
        state: 'LEGACY_ADAPTER',
        legacyRoute: 'product-management',
        detail: '兼容页',
      },
      {
        capabilityId: 'objects.products.create',
        workspace: 'objects',
        view: 'objects/products',
        action: 'create',
        state: 'BLOCKED',
        blockerCode: 'NOT_SCOPED',
        detail: '待店铺隔离',
      },
    ] satisfies MissionControlCapabilityProjection[];

    expect(workspaceCapabilityState(capabilities, 'objects')).toBe('MIXED');
    expect(workspaceCapabilityState(capabilities, 'today')).toBeUndefined();
  });

  it('treats a workspace as ready only when every real action is native or a connected production adapter', () => {
    const capabilities = [
      {
        capabilityId: 'collection.reports.view', workspace: 'collection', view: 'collection/reports',
        action: 'view', state: 'LEGACY_ADAPTER', legacyRoute: 'data-collection', detail: '已接入生产采集页',
      },
      {
        capabilityId: 'collection.reports.start', workspace: 'collection', view: 'collection/reports',
        action: 'start', state: 'PRODUCTION_NATIVE', detail: 'Main 已接入真实启动动作',
      },
    ] satisfies MissionControlCapabilityProjection[];

    expect(workspaceCapabilityState(capabilities, 'collection')).toBe('PRODUCTION_NATIVE');
    expect(workspaceCapabilityState([
      ...capabilities,
      {
        capabilityId: 'collection.reports.import', workspace: 'collection', view: 'collection/reports',
        action: 'import', state: 'BLOCKED', blockerCode: 'IMPORT_NOT_READY', detail: '导入未接入',
      },
    ], 'collection')).toBe('MIXED');
  });
});

describe('NextSafeActionHandoff', () => {
  it('dispatches its canonical Mission Control intent', () => {
    const visited: NavigationIntent[] = [];
    const action = {
      stage: 'report-collection' as const,
      blocked: true,
      reason: '当前范围缺少真实领星广告报表，不能继续量化。',
      label: '采集真实报表',
      intent: { workspace: 'collection', subview: 'reports' } as const,
    };
    const tree = NextSafeActionHandoff({ action, onNavigate: (intent) => visited.push(intent) }) as ReactElement;
    const button = collectElements(tree, (element) => element.type === 'button')[0];

    expect(tree.props['data-workflow-stage']).toBe('report-collection');
    button.props.onClick();
    expect(visited).toEqual([action.intent]);
  });
});

describe('Mission Control top-level shell', () => {
  const store = {
    storeId: 'store-shc001',
    displayName: 'SHC001 · 美国站',
    browserProfileId: 'browser-store-shc001',
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: 'America/Los_Angeles',
    status: 'active',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  } as StoreRecord;
  const context = {
    storeId: store.storeId,
    browserProfileId: store.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: store.businessTimezone,
    businessDate: '2026-07-22',
    sessionGeneration: 3,
  } as StoreContextEnvelope;

  it('renders a read-only topbar authority summary and leaves switching to the sidebar control', () => {
    const markup = renderToStaticMarkup(
      <MissionControlShell
        activeIntent={{ workspace: 'today', subview: 'overview' }}
        activeStore={store}
        authoritativeContext={context}
        onLogout={() => undefined}
        onNavigate={() => undefined}
        onSwitchStore={() => undefined}
        stores={[store]}
      >
        <div>当前工作区</div>
      </MissionControlShell>,
    );

    expect(markup).toContain('aria-label="当前店铺权威摘要"');
    expect(markup).not.toContain('aria-label="切换店铺"');
    expect(markup).toContain('aria-label="店铺与站点"');
    expect(markup).toContain('SHC001 · 美国站');
    expect(markup).toContain('>US<');
    expect(markup).toContain('>USD<');
    expect(markup).toContain('2026-07-22');
  });

  it('keeps policy auto visible and explicitly blocked until Main grants authority', () => {
    const markup = renderToStaticMarkup(
      <MissionControlShell
        activeIntent={{ workspace: 'policy', subview: 'rules' }}
        activeStore={store}
        authoritativeContext={context}
        autonomy={DEFAULT_BLOCKED_AUTONOMY}
        onLogout={() => undefined}
        onNavigate={() => undefined}
        onSwitchStore={() => undefined}
        stores={[store]}
      >
        <div />
      </MissionControlShell>,
    );

    expect(markup).toContain('人工审批');
    expect(markup).toContain('AI 策略内自动');
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('data-authority-blocked="true"');
    expect(markup).toContain('尚未获得真实执行权限');
  });

});
