import { readFileSync } from 'node:fs';
import React, { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OperatorTaskPanel, type OperatorTaskAction } from './operator-task-panel';

function classNames(element: ReactElement): string[] {
  const className = element.props.className;
  return typeof className === 'string' ? className.split(/\s+/).filter(Boolean) : [];
}

function hasClass(element: ReactElement, className: string): boolean {
  return classNames(element).includes(className);
}

function collectElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectElements(child, predicate));
  }
  if (!React.isValidElement(node)) return [];
  const matches = predicate(node) ? [node] : [];
  return matches.concat(collectElements(node.props.children, predicate));
}

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((child) => textContent(child)).join('');
  if (!React.isValidElement(node)) return '';
  return textContent(node.props.children);
}

function clickButton(button: ReactElement) {
  if (!button.props.disabled) {
    button.props.onClick();
  }
}

function rendererCss(): string {
  return readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
}

function cssRuleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('OperatorTaskPanel', () => {
  it('renders exactly one primary action', () => {
    const primary = vi.fn();
    const primaryAction: OperatorTaskAction = { label: 'Approve', onClick: primary };
    const tree = OperatorTaskPanel({
      eyebrow: 'Current task',
      title: 'Review advertising recommendations',
      detail: 'Approve the next operator action.',
      primaryAction,
      secondaryActions: [
        { label: 'Open evidence', onClick: vi.fn() },
        { label: 'Copy summary', onClick: vi.fn() },
      ],
      children: <p>Readable summary</p>,
    }) as ReactElement;

    const sections = collectElements(tree, (element) => element.type === 'section' && hasClass(element, 'operator-task-panel'));
    const primaryButtons = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'primary-button'));

    expect(sections).toHaveLength(1);
    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0].props.type).toBe('button');
    expect(primaryButtons[0].props.children).toBe('Approve');
  });

  it('renders secondary actions and calls primary and secondary handlers', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    const tree = OperatorTaskPanel({
      title: 'Generate delivery packet',
      primaryAction: { label: 'Generate', onClick: primary },
      secondaryActions: [
        { label: 'Open folder', onClick: secondary },
      ],
    }) as ReactElement;

    const primaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'primary-button'))[0];
    const secondaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'secondary-button'))[0];

    clickButton(primaryButton);
    clickButton(secondaryButton);

    expect(primaryButton.props.type).toBe('button');
    expect(secondaryButton.props.type).toBe('button');
    expect(secondaryButton.props.children).toBe('Open folder');
    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondary).toHaveBeenCalledTimes(1);
  });

  it('does not trigger a disabled primary action', () => {
    const primary = vi.fn();
    const tree = OperatorTaskPanel({
      title: 'Blocked audit action',
      primaryAction: { label: 'Run action', onClick: primary, disabled: true },
    }) as ReactElement;

    const primaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'primary-button'))[0];
    clickButton(primaryButton);

    expect(primaryButton.props.disabled).toBe(true);
    expect(primary).not.toHaveBeenCalled();
  });

  it('locks busy actions with a spinner and immediate processing copy', () => {
    const primary = vi.fn();
    const tree = OperatorTaskPanel({
      title: 'Run long report import',
      primaryAction: { label: 'Start import', onClick: primary, busy: true },
      secondaryActions: [
        { label: 'Refresh', onClick: vi.fn(), busy: true },
      ],
    }) as ReactElement;

    const primaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'primary-button'))[0];
    const secondaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'secondary-button'))[0];
    const spinners = collectElements(tree, (element) => hasClass(element, 'button-spinner'));

    clickButton(primaryButton);

    expect(primaryButton.props.disabled).toBe(true);
    expect(primaryButton.props['aria-busy']).toBe(true);
    expect(hasClass(primaryButton, 'button-loading')).toBe(true);
    expect(textContent(primaryButton.props.children)).toContain('处理中...');
    expect(secondaryButton.props.disabled).toBe(true);
    expect(secondaryButton.props['aria-busy']).toBe(true);
    expect(spinners).toHaveLength(2);
    expect(primary).not.toHaveBeenCalled();
  });

  it('keeps the actions column width controlled for narrow desktop panels', () => {
    const css = rendererCss();
    const panelRule = cssRuleBody(css, '.operator-task-panel');
    const actionsRule = cssRuleBody(css, '.operator-task-actions');
    const actionButtonRule = cssRuleBody(css, '.operator-task-actions button');

    expect(panelRule).not.toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto\s*;/);
    expect(panelRule).toMatch(/grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+minmax\(/);
    expect(actionsRule).toMatch(/min-width\s*:\s*0\s*;/);
    expect(actionsRule).toMatch(/max-width\s*:/);
    expect(actionButtonRule).toMatch(/white-space\s*:\s*normal\s*;/);
  });

  it('keeps the panel shimmer layer non-blocking and motion-safe', () => {
    const css = rendererCss();
    const panelRule = cssRuleBody(css, '.operator-task-panel');
    const shimmerRule = cssRuleBody(css, '.operator-task-panel::before');
    const mainRule = cssRuleBody(css, '.operator-task-main');
    const actionsRule = cssRuleBody(css, '.operator-task-actions');

    expect(panelRule).toMatch(/position\s*:\s*relative\s*;/);
    expect(panelRule).toMatch(/overflow\s*:\s*hidden\s*;/);
    expect(shimmerRule).toMatch(/pointer-events\s*:\s*none\s*;/);
    expect(shimmerRule).toMatch(/animation\s*:\s*operator-task-shimmer 4200ms ease-in-out infinite\s*;/);
    expect(mainRule).toMatch(/z-index\s*:\s*1\s*;/);
    expect(actionsRule).toMatch(/z-index\s*:\s*1\s*;/);
    expect(css).toMatch(/@keyframes\s+operator-task-shimmer/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.operator-task-panel::before[\s\S]*animation:\s*none/);
  });

  it('defines the shared loading button micro-interaction styles', () => {
    const css = rendererCss();
    const loadingRule = cssRuleBody(css, '.button-loading');
    const contentRule = cssRuleBody(css, '.button-content');
    const spinnerRule = cssRuleBody(css, '.button-spinner');

    expect(loadingRule).toMatch(/cursor\s*:\s*not-allowed\s*;/);
    expect(contentRule).toMatch(/inline-flex/);
    expect(spinnerRule).toMatch(/border-right-color\s*:\s*transparent\s*;/);
    expect(css).toMatch(/@keyframes\s+button-spin/);
  });
});
