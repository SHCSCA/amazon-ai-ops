import React, { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { navGroups, navItemOrdinal, Sidebar } from './app-shell';

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
      ['01'],
      ['01', '02', '03', '04', '05', '06'],
      ['01', '02', '03'],
      ['01', '02'],
      ['01', '02', '03'],
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
    expect(navText).toContain('渐进执行回读');
    expect(navText).toContain('最终验收就绪门');
    expect(indexes.filter((value) => value === '01')).toHaveLength(5);
  });
});
