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

  it('labels the first-screen task region and action group for scanability', () => {
    const tree = OperatorTaskPanel({
      eyebrow: '数据',
      title: '确认当前范围并导入真实报表',
      detail: '先保存范围，再把下载完成的 Lingxing 表格写入 SQLite。',
      primaryAction: { label: '导入已下载表格', onClick: vi.fn() },
      secondaryActions: [
        { label: '打开目录', onClick: vi.fn() },
      ],
    }) as ReactElement;

    const section = collectElements(tree, (element) => element.type === 'section' && hasClass(element, 'operator-task-panel'))[0];
    const heading = collectElements(tree, (element) => element.type === 'h2')[0];
    const detail = collectElements(tree, (element) => element.type === 'p' && element.props.id === section.props['aria-describedby'])[0];
    const actionGroup = collectElements(tree, (element) => element.props.className === 'operator-task-actions')[0];

    expect(section.props['aria-labelledby']).toBe(heading.props.id);
    expect(section.props['aria-describedby']).toBe(detail.props.id);
    expect(heading.props.id).toContain('operator-task-');
    expect(textContent(heading)).toBe('确认当前范围并导入真实报表');
    expect(textContent(detail)).toContain('SQLite');
    expect(actionGroup.props.role).toBe('group');
    expect(actionGroup.props['aria-label']).toBe('首屏任务动作');
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

  it('locks sibling actions while one task action is busy without making peers look active', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    const tree = OperatorTaskPanel({
      title: 'Run current-scope import',
      primaryAction: { label: 'Import now', onClick: primary, busy: true, busyLabel: '入库中...' },
      secondaryActions: [
        { label: 'Open folder', onClick: secondary },
      ],
    }) as ReactElement;

    const primaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'primary-button'))[0];
    const secondaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'secondary-button'))[0];

    clickButton(primaryButton);
    clickButton(secondaryButton);

    expect(primaryButton.props.disabled).toBe(true);
    expect(primaryButton.props['aria-busy']).toBe(true);
    expect(hasClass(primaryButton, 'button-loading')).toBe(true);
    expect(textContent(primaryButton.props.children)).toContain('入库中...');
    expect(secondaryButton.props.disabled).toBe(true);
    expect(secondaryButton.props['aria-busy']).toBeUndefined();
    expect(hasClass(secondaryButton, 'button-loading')).toBe(false);
    expect(textContent(secondaryButton.props.children)).toBe('Open folder');
    expect(primary).not.toHaveBeenCalled();
    expect(secondary).not.toHaveBeenCalled();
  });

  it('locks the primary action while a secondary task action is busy', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    const tree = OperatorTaskPanel({
      title: 'Refresh AI settings',
      primaryAction: { label: 'Test connection', onClick: primary },
      secondaryActions: [
        { label: 'Save settings', onClick: secondary, busy: true, busyLabel: '保存中...' },
      ],
    }) as ReactElement;

    const primaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'primary-button'))[0];
    const secondaryButton = collectElements(tree, (element) => element.type === 'button' && hasClass(element, 'secondary-button'))[0];

    clickButton(primaryButton);
    clickButton(secondaryButton);

    expect(primaryButton.props.disabled).toBe(true);
    expect(primaryButton.props['aria-busy']).toBeUndefined();
    expect(hasClass(primaryButton, 'button-loading')).toBe(false);
    expect(secondaryButton.props.disabled).toBe(true);
    expect(secondaryButton.props['aria-busy']).toBe(true);
    expect(hasClass(secondaryButton, 'button-loading')).toBe(true);
    expect(textContent(secondaryButton.props.children)).toContain('保存中...');
    expect(primary).not.toHaveBeenCalled();
    expect(secondary).not.toHaveBeenCalled();
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
    expect(css).toMatch(/\.operator-task-main h2\s*\{[\s\S]*font-size:\s*17px/);
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
