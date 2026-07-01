import React, { type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { navGroups, navItemOrdinal, Sidebar } from './app-shell';
import type { AppRoute } from '../types';

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

describe('Sidebar navigation', () => {
  it('uses group-local absolute numbering instead of global accumulated numbers', () => {
    expect(navItemOrdinal(0)).toBe('01');
    expect(navGroups.map((group) => group.items.map((_, index) => navItemOrdinal(index)))).toEqual([
      ['01', '02'],
      ['01', '02', '03', '04', '05', '06'],
      ['01', '02', '03'],
      ['01', '02'],
      ['01', '02', '03'],
    ]);
  });

  it('renders product management and product ACOS config as distinct operator entries', () => {
    const tree = Sidebar({ activeRoute: 'product-management', onNavigate: () => undefined }) as ReactElement;
    const navText = collectText(tree);

    expect(navText).toContain('今日看板');
    expect(navText).toContain('产品管理');
    expect(navText).toContain('产品 ACOS 配置');
    expect(navGroups[0].items.map((item) => item.id)).toEqual(['dashboard', 'product-management']);
    expect(navGroups[1].items.map((item) => item.id)).toEqual([
      'operation-scope',
      'data-collection',
      'data-import-validation',
      'operation-events',
      'product-config',
      'ad-quant',
    ]);
  });

  it('renders the v1.5 high-fidelity business-domain labels', () => {
    const tree = Sidebar({ activeRoute: 'dashboard', onNavigate: () => undefined }) as ReactElement;
    const navText = collectText(tree);
    const indexes = collectElements(tree, (element) => element.props.className === 'nav-item-index')
      .map((element) => collectText(element));

    expect(navText).toContain('今日看板');
    expect(navText).toContain('批量数据采集');
    expect(navText).toContain('指标核验入库');
    expect(navText).toContain('运营事件标记');
    expect(navText).toContain('渐进执行回读');
    expect(navText).toContain('最终验收就绪门');
    expect(indexes.filter((value) => value === '01')).toHaveLength(5);
  });

  it('exposes the desktop business navigation as labelled groups and group-local lists', () => {
    const tree = Sidebar({ activeRoute: 'dashboard', onNavigate: () => undefined }) as ReactElement;
    const groups = collectElements(tree, (element) => element.props.className === 'nav-group');

    expect(tree.type).toBe('nav');
    expect(tree.props['aria-label']).toBe('主业务导航');
    expect(groups).toHaveLength(navGroups.length);

    groups.forEach((groupElement, groupIndex) => {
      const labels = collectElements(groupElement, (element) => element.props.className === 'nav-group-label');
      const lists = collectElements(groupElement, (element) => element.props.className === 'nav-item-list');
      const itemShells = collectElements(groupElement, (element) => element.props.className === 'nav-item-shell');
      const buttons = collectElements(groupElement, (element) => element.type === 'button');
      const groupLabelId = `app-nav-group-${groupIndex + 1}-label`;

      expect(groupElement.props.role).toBe('group');
      expect(groupElement.props['aria-labelledby']).toBe(groupLabelId);
      expect(labels[0]?.props.id).toBe(groupLabelId);
      expect(lists[0]?.props.role).toBe('list');
      expect(itemShells).toHaveLength(navGroups[groupIndex].items.length);
      expect(buttons).toHaveLength(navGroups[groupIndex].items.length);

      itemShells.forEach((itemShell, itemIndex) => {
        expect(itemShell.props.role).toBe('listitem');
        expect(itemShell.props['aria-posinset']).toBe(itemIndex + 1);
        expect(itemShell.props['aria-setsize']).toBe(navGroups[groupIndex].items.length);
        expect(buttons[itemIndex].props['aria-describedby']).toBe(groupLabelId);
      });
    });
  });

  it('marks the pending navigation target and locks sibling nav actions during route handoff', () => {
    const clicked: AppRoute[] = [];
    const tree = Sidebar({
      activeRoute: 'dashboard',
      pendingRoute: 'data-collection',
      onNavigate: (route) => clicked.push(route),
    }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const pendingButton = buttons.find((button) => collectText(button).includes('批量数据采集'));
    const siblingButton = buttons.find((button) => collectText(button).includes('指标核验入库'));

    expect(pendingButton?.props['aria-busy']).toBe(true);
    expect(pendingButton?.props['data-pending']).toBe('true');
    expect(collectText(pendingButton)).toContain('转跳中...');
    expect(pendingButton?.props.disabled).toBe(true);
    expect(siblingButton?.props.disabled).toBe(true);

    pendingButton?.props.onClick();
    siblingButton?.props.onClick();

    expect(clicked).toEqual([]);
  });

  it('marks product ACOS config as the active item for the product-config route', () => {
    const tree = Sidebar({ activeRoute: 'product-config', onNavigate: () => undefined }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const productManagementButton = buttons.find((button) => collectText(button).includes('产品管理'));
    const productAcosButton = buttons.find((button) => collectText(button).includes('产品 ACOS 配置'));

    expect(productManagementButton?.props['aria-current']).toBeUndefined();
    expect(productAcosButton?.props['aria-current']).toBe('page');
  });

  it('shows product ACOS config as pending when a product-config handoff is running', () => {
    const tree = Sidebar({
      activeRoute: 'dashboard',
      pendingRoute: 'product-config',
      onNavigate: () => undefined,
    }) as ReactElement;
    const buttons = collectElements(tree, (element) => element.type === 'button');
    const productManagementButton = buttons.find((button) => collectText(button).includes('产品管理'));
    const productAcosButton = buttons.find((button) => collectText(button).includes('产品 ACOS 配置'));

    expect(productManagementButton?.props['aria-busy']).toBeUndefined();
    expect(productAcosButton?.props['aria-busy']).toBe(true);
    expect(productAcosButton?.props['data-pending']).toBe('true');
    expect(collectText(productAcosButton)).toContain('转跳中...');
  });

  it('keeps the aria-current active glow bar contract in CSS', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.nav-item::before');
    expect(css).toContain('.nav-item[aria-current="page"]::before');
    expect(css).toMatch(/\.nav-item::before[\s\S]*transform:\s*translateX\(-7px\)/);
    expect(css).toMatch(/\.nav-item\[aria-current="page"\]::before[\s\S]*transform:\s*translateX\(0\)/);
    expect(css).toMatch(/\.nav-item::before[\s\S]*will-change:\s*transform,\s*opacity/);
  });

  it('defines a non-layout-shifting global route handoff feedback layer', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.route-handoff-feedback');
    expect(css).toMatch(/\.route-handoff-feedback[\s\S]*position:\s*absolute/);
    expect(css).toMatch(/\.route-handoff-feedback[\s\S]*pointer-events:\s*none/);
    expect(css).toMatch(/\.route-handoff-feedback[\s\S]*transform:\s*translateY\(-4px\)/);
    expect(css).toMatch(/\.nav-item\[data-pending="true"\][\s\S]*box-shadow:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.route-handoff-feedback[\s\S]*animation:\s*none/);
  });
});
