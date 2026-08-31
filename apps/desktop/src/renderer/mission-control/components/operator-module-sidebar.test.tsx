import React, { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MissionControlCapabilityProjection } from '@amazon-ai-ops/shared-types';
import type { NavigationIntent } from '../../navigation';
import { OperatorModuleSidebar } from './operator-module-sidebar';

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

describe('OperatorModuleSidebar', () => {
  it('shows six primary modules and expands only the current module secondary entries', () => {
    const activeIntent = { workspace: 'today', subview: 'overview' } as const;
    const tree = OperatorModuleSidebar({ activeIntent, onNavigate: () => undefined }) as ReactElement;
    const markup = renderToStaticMarkup(tree);
    const primaryButtons = collectElements(tree, (element) => (
      element.type === 'button' && Boolean(element.props['data-operator-module'])
    ));
    const entryButtons = collectElements(tree, (element) => (
      element.type === 'button' && Boolean(element.props['data-operator-entry'])
    ));

    expect(primaryButtons).toHaveLength(6);
    expect(entryButtons).toHaveLength(7);
    expect(markup).toContain('今日与决策');
    expect(markup).toContain('运营任务队列');
    expect(markup).toContain('待审批');
    expect(markup).not.toContain('产品与目标');
    expect(markup).not.toMatch(/部分可用|PRODUCTION_NATIVE|LEGACY_ADAPTER|原型/);
  });

  it('navigates primary modules and exact secondary intents without changing the canonical routes', () => {
    const visited: NavigationIntent[] = [];
    const tree = OperatorModuleSidebar({
      activeIntent: { workspace: 'settings', subview: 'scheduler' },
      onNavigate: (intent) => visited.push(intent),
    }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const collection = buttons.find((button) => collectText(button).includes('数据采集'));
    const scheduler = buttons.find((button) => collectText(button).includes('定时任务'));

    collection?.props.onClick();
    scheduler?.props.onClick();
    expect(visited).toEqual([
      { workspace: 'collection', subview: 'scope' },
      { workspace: 'settings', subview: 'scheduler' },
    ]);
  });

  it('summarizes exact entry blockers with operator-facing copy only', () => {
    const capabilities = [
      {
        capabilityId: 'objects.products.view',
        workspace: 'objects',
        view: 'objects/products',
        action: 'view',
        state: 'LEGACY_ADAPTER',
        legacyRoute: 'product-management',
        detail: '已接入',
      },
      {
        capabilityId: 'objects.products.update',
        workspace: 'objects',
        view: 'objects/products',
        action: 'update',
        state: 'BLOCKED',
        blockerCode: 'TARGET_NOT_READY',
        detail: '请先选择产品。',
      },
      {
        capabilityId: 'objects.targets.view',
        workspace: 'objects',
        view: 'objects/targets',
        action: 'view',
        state: 'PROTOTYPE_ONLY',
        detail: '尚待接入',
      },
    ] satisfies MissionControlCapabilityProjection[];
    const markup = renderToStaticMarkup(
      <OperatorModuleSidebar
        activeIntent={{ workspace: 'objects', subview: 'products' }}
        capabilities={capabilities}
        onNavigate={() => undefined}
      />,
    );

    expect(markup).toContain('产品与目标</span><b data-attention="blocked">受阻</b>');
    expect(markup).toContain('广告对象</span><b data-attention="attention">需关注</b>');
    expect(markup).not.toMatch(/部分可用|PRODUCTION_NATIVE|LEGACY_ADAPTER|PROTOTYPE_ONLY|原型/);
  });
});
