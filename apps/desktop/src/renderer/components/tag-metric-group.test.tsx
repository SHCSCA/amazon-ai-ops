import React, { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { TagMetricGroup } from './tag-metric-group';

function collectText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (!React.isValidElement(node)) return '';
  return collectText(node.props.children);
}

function collectElements(node: ReactNode, type: string): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElements(child, type));
  if (!React.isValidElement(node)) return [];
  return (node.type === type ? [node] : []).concat(collectElements(node.props.children, type));
}

describe('TagMetricGroup', () => {
  it('renders compact chips for dense summary facts', () => {
    const tree = TagMetricGroup({
      items: [
        { label: '真实报表', value: '8/8', tone: 'ready' },
        { label: '指标', value: '2416 行', tone: 'ready' },
      ],
    }) as ReactElement;

    expect(collectText(tree)).toContain('真实报表');
    expect(collectText(tree)).toContain('2416 行');
    expect(collectElements(tree, 'strong')).toHaveLength(2);
  });
});
