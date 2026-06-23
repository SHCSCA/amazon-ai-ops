import React, { type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgressiveDetails } from './progressive-details';

function classNames(element: ReactElement): string[] {
  const className = element.props.className;
  return typeof className === 'string' ? className.split(/\s+/).filter(Boolean) : [];
}

function hasClass(element: ReactElement, className: string): boolean {
  return classNames(element).includes(className);
}

function elementChildren(element: ReactElement): ReactElement[] {
  return React.Children.toArray(element.props.children).filter(React.isValidElement);
}

function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!React.isValidElement(node)) return '';
  return textContent(node.props.children);
}

function bodyElement(details: ReactElement): ReactElement {
  const body = elementChildren(details).find((child) => hasClass(child, 'progressive-details-body'));
  expect(body).toBeDefined();
  return body!;
}

function openedDetailsElement(details: ReactElement): ReactElement {
  const summary = elementChildren(details).find((child) => child.type === 'summary');
  expect(summary).toBeDefined();
  return React.cloneElement(details, { open: true });
}

describe('ProgressiveDetails', () => {
  it('is collapsed by default', () => {
    const tree = ProgressiveDetails({
      title: 'Technical evidence',
      children: <code>output/codex-evidence/readback.json</code>,
    }) as ReactElement;

    expect(tree.type).toBe('details');
    expect(hasClass(tree, 'progressive-details')).toBe(true);
    expect(tree.props.open).toBeUndefined();
    expect(renderToStaticMarkup(tree)).not.toContain(' open');
  });

  it('exposes the body content when represented in an open details state', () => {
    const tree = ProgressiveDetails({
      title: 'Verifier command',
      children: <code>pnpm run verify:ad-readback</code>,
    }) as ReactElement;

    const opened = openedDetailsElement(tree);

    expect(opened.props.open).toBe(true);
    expect(textContent(bodyElement(opened))).toContain('pnpm run verify:ad-readback');
  });

  it('is initially expanded when defaultOpen is true', () => {
    const tree = ProgressiveDetails({
      title: 'Expanded details',
      defaultOpen: true,
      children: <span>Ready bundle manifest</span>,
    }) as ReactElement;

    expect(tree.props.open).toBe(true);
    expect(textContent(bodyElement(tree))).toContain('Ready bundle manifest');
  });
});
