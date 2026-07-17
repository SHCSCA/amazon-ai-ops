import React, { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  WorkspaceSubviewShell,
  workspaceSubviewIndexFromKey,
} from './workspace-subview-shell';

function collectElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElements(child, predicate));
  if (!React.isValidElement(node)) return [];
  const matches = predicate(node) ? [node] : [];
  return matches.concat(collectElements(node.props.children, predicate));
}

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!React.isValidElement(node)) return '';
  return textContent(node.props.children);
}

describe('workspaceSubviewIndexFromKey', () => {
  it('supports roving tab navigation with wrapping and Home/End', () => {
    expect(workspaceSubviewIndexFromKey('ArrowRight', 2, 3)).toBe(0);
    expect(workspaceSubviewIndexFromKey('ArrowLeft', 0, 3)).toBe(2);
    expect(workspaceSubviewIndexFromKey('Home', 2, 3)).toBe(0);
    expect(workspaceSubviewIndexFromKey('End', 0, 3)).toBe(2);
    expect(workspaceSubviewIndexFromKey('Enter', 1, 3)).toBeNull();
  });
});

describe('WorkspaceSubviewShell', () => {
  it('can own the canonical page heading when the active subview is the workspace home', () => {
    const tree = WorkspaceSubviewShell({
      workspace: 'product',
      workspaceLabel: '产品工作台',
      description: '维护产品、目标和运营事件。',
      ownsPageHeading: true,
      subview: 'products',
      tabs: [
        { id: 'products', label: '产品' },
        { id: 'targets', label: '目标' },
      ],
      onNavigate: vi.fn(),
      children: <section><h2>产品对象队列</h2></section>,
    }) as ReactElement;

    const headings = collectElements(tree, (element) => element.type === 'h1');
    expect(headings).toHaveLength(1);
    expect(textContent(headings[0])).toBe('产品工作台');
    expect(headings[0].props.id).toBe('product-workspace-title');
  });

  it('adds one canonical workspace identity and an accessible subview tab contract without adding another h1', () => {
    const onNavigate = vi.fn();
    const tree = WorkspaceSubviewShell({
      workspace: 'product',
      workspaceLabel: '产品工作台',
      description: '维护产品、目标和运营事件。',
      subview: 'targets',
      tabs: [
        { id: 'products', label: '产品' },
        { id: 'targets', label: '目标' },
        { id: 'events', label: '运营事件' },
      ],
      onNavigate,
      children: <section><h1>产品目标</h1><p>目标内容</p></section>,
    }) as ReactElement;

    const root = collectElements(tree, (element) => element.props['data-workspace-evidence-root'] === true)[0];
    const tabs = collectElements(tree, (element) => element.props.role === 'tab');
    const panel = collectElements(tree, (element) => element.props.role === 'tabpanel')[0];
    const headings = collectElements(tree, (element) => element.type === 'h1');

    expect(root.props['data-workspace']).toBe('product');
    expect(root.props['data-workspace-subview']).toBe('targets');
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tab) => tab.props['aria-selected'])).toEqual([false, true, false]);
    expect(tabs.map((tab) => tab.props.tabIndex)).toEqual([-1, 0, -1]);
    expect(panel.props['aria-labelledby']).toBe(tabs[1].props.id);
    expect(tabs[1].props['aria-controls']).toBe(panel.props.id);
    expect(headings).toHaveLength(1);
    expect(textContent(headings[0])).toBe('产品目标');

    tabs[0].props.onClick();
    expect(onNavigate).toHaveBeenCalledWith('products');
  });

  it('renders an explicit preview warning at workspace level', () => {
    const tree = WorkspaceSubviewShell({
      workspace: 'system',
      workspaceLabel: '系统与交付',
      description: '管理设置与交付。',
      subview: 'settings',
      tabs: [{ id: 'settings', label: 'AI 设置' }],
      onNavigate: vi.fn(),
      previewNotice: '仅开发预览，不代表正式交付就绪。',
      children: <h1>AI 设置</h1>,
    }) as ReactElement;

    const notice = collectElements(tree, (element) => element.props['data-workspace-preview-notice'] === true)[0];
    expect(notice.props.role).toBe('note');
    expect(textContent(notice)).toBe('仅开发预览，不代表正式交付就绪。');
  });
});
