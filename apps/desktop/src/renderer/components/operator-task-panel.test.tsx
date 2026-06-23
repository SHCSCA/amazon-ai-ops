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
});
