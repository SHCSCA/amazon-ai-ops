import React, { type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NextSafeActionHandoff, Sidebar } from './app-shell';
import { VISIBLE_WORKSPACES } from '../navigation';
import type { NavigationIntent } from '../navigation';

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

describe('Sidebar workspace navigation runtime', () => {
  it('renders exactly eight Chinese operator workspaces in the running component tree', () => {
    const markup = renderToStaticMarkup(<Sidebar activeRoute="dashboard" onNavigate={() => undefined} />);
    const tree = Sidebar({ activeRoute: 'dashboard', onNavigate: () => undefined }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const labels = collectElements(tree, (element) => element.props.className === 'nav-item-label').map(collectText);

    expect(buttons).toHaveLength(8);
    for (const workspace of VISIBLE_WORKSPACES) {
      expect(markup).toContain(workspace.label);
    }
    expect(labels).not.toContain('数据采集');
    expect(labels).not.toContain('审批中心');
    expect(labels).not.toContain('自动任务');
  });

  it('keeps seven daily entries together and visually separates the system entry', () => {
    const tree = Sidebar({ activeRoute: 'dashboard', onNavigate: () => undefined }) as ReactElement;
    const groups = collectElements(tree, (element) => element.type === 'section' && element.props.className?.includes?.('nav-group'));
    const dailyGroup = groups.find((group) => group.props['data-navigation-section'] === 'daily');
    const systemGroup = groups.find((group) => group.props['data-navigation-section'] === 'system');

    expect(collectElements(dailyGroup, (element) => element.type === 'button')).toHaveLength(7);
    expect(collectElements(systemGroup, (element) => element.type === 'button')).toHaveLength(1);
    expect(systemGroup?.props.className).toContain('nav-group-system');
  });

  it('marks active and pending state at workspace level while legacy routes stay distinct', () => {
    const tree = Sidebar({
      activeRoute: 'product-config',
      pendingRoute: 'operation-events',
      onNavigate: () => undefined,
    }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const product = buttons.find((button) => collectText(button).includes('产品/商品工作台'));
    const today = buttons.find((button) => collectText(button).includes('今日任务'));

    expect(product?.props['aria-current']).toBe('page');
    expect(product?.props['aria-busy']).toBe(true);
    expect(product?.props['data-pending']).toBe('true');
    expect(collectText(product)).toContain('转跳中...');
    expect(today?.props['aria-current']).toBeUndefined();
  });

  it('dispatches the workspace default structured intent from keyboard-capable buttons', () => {
    const visited: NavigationIntent[] = [];
    const tree = Sidebar({
      activeRoute: 'dashboard',
      onNavigate: (intent) => visited.push(intent),
    }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const product = buttons.find((button) => collectText(button).includes('产品/商品工作台'));

    expect(product?.props.type).toBe('button');
    product?.props.onClick();
    expect(visited).toEqual([{ workspace: 'product', subview: 'products' }]);
  });

  it('preserves labelled navigation/list semantics, pending lock, and aria-current', () => {
    const tree = Sidebar({
      activeRoute: 'recommendations',
      pendingRoute: 'settings',
      onNavigate: () => undefined,
    }) as ReactElement;
    const groups = collectElements(tree, (element) => element.type === 'section' && element.props.className?.includes?.('nav-group'));
    const lists = collectElements(tree, (element) => element.props.role === 'list');
    const listItems = collectElements(tree, (element) => element.props.role === 'listitem');
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const decisions = buttons.find((button) => collectText(button).includes('建议与审批'));
    const system = buttons.find((button) => collectText(button).includes('系统与交付'));

    expect(tree.type).toBe('nav');
    expect(tree.props['aria-label']).toBe('主业务导航');
    expect(groups).toHaveLength(2);
    expect(lists).toHaveLength(2);
    expect(listItems).toHaveLength(8);
    expect(decisions?.props['aria-current']).toBe('page');
    expect(system?.props['aria-busy']).toBe(true);
    expect(buttons.every((button) => button.props.disabled)).toBe(true);
  });

  it('keeps the active glow and separated system workspace styling contracts', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.nav-item::before');
    expect(css).toContain('.nav-item[aria-current="page"]::before');
    expect(css).toContain('.nav-group-system');
    expect(css).toMatch(/\.nav-group-system[\s\S]*border-top:/);
    expect(css).toMatch(/\.nav-item\[data-pending="true"\][\s\S]*box-shadow:/);
  });
});

describe('NextSafeActionHandoff runtime', () => {
  it('renders one compact primary handoff action and dispatches its canonical intent', () => {
    const visited: NavigationIntent[] = [];
    const action = {
      stage: 'report-collection' as const,
      blocked: true,
      reason: '当前范围缺少真实领星广告报表，不能继续量化。',
      label: '采集真实报表',
      intent: { workspace: 'data-preparation', subview: 'reports' } as const,
    };
    const tree = NextSafeActionHandoff({ action, onNavigate: (intent) => visited.push(intent) }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');

    expect(tree.props['aria-label']).toBe('下一安全动作');
    expect(tree.props['data-workflow-stage']).toBe('report-collection');
    expect(collectText(tree)).toContain(action.reason);
    expect(buttons).toHaveLength(1);
    expect(collectText(buttons[0])).toBe('采集真实报表');
    buttons[0].props.onClick();
    expect(visited).toEqual([action.intent]);
  });
});
