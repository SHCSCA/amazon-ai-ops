import React, { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { DecisionActionStrip, FormTable, FormTableRow, MicroStepper, SafetyGateLine, StateLightGrid } from './ui';

function collectText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (!React.isValidElement(node)) return '';
  return collectText(node.props.children);
}

function collectElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap((child) => collectElements(child, predicate));
  if (!React.isValidElement(node)) return [];
  const matches = predicate(node) ? [node] : [];
  return matches.concat(collectElements(node.props.children, predicate));
}

describe('industrial UI atoms', () => {
  it('renders state light cards for first-viewport operational status', () => {
    const tree = StateLightGrid({
      items: [
        { label: '数据就绪', value: '8/8 报表全', tone: 'ready' },
        { label: '广告核验', value: '3 词待复核', tone: 'warning' },
      ],
    }) as ReactElement;

    expect(collectText(tree)).toContain('数据就绪');
    expect(collectText(tree)).toContain('3 词待复核');
    expect(collectElements(tree, (element) => element.props.className === 'state-light-card state-light-ready')).toHaveLength(1);
  });

  it('renders micro stepper rows without exposing raw technical labels by default', () => {
    const tree = MicroStepper({
      items: [
        { label: '广告活动报告', meta: '1.2 MB', detail: '原始 XLSX 校验通过，本地已留存', tone: 'ready' },
        { label: '用户搜索词报告', meta: '轮询中', detail: '等待领星下载中心异步生成', tone: 'pending' },
      ],
    }) as ReactElement;

    expect(collectText(tree)).toContain('广告活动报告');
    expect(collectText(tree)).toContain('等待领星下载中心异步生成');
  });

  it('renders left-label structured form rows with required markers and hints', () => {
    const tree = FormTable({
      children: FormTableRow({
        label: '单词最大超支限额',
        required: true,
        hint: '单位 USD',
        children: <input value="30.00" readOnly />,
      }),
    }) as ReactElement;

    expect(collectText(tree)).toContain('单词最大超支限额');
    expect(collectText(tree)).toContain('单位 USD');
    expect(collectElements(tree, (element) => element.props.className === 'form-table-row')).toHaveLength(1);
  });

  it('renders safety gate language as a dedicated first-class line', () => {
    const tree = SafetyGateLine({ children: '审批时间 <= 执行前时间 <= 线下动作执行时间 <= 真实回读时间' }) as ReactElement;

    expect(collectText(tree)).toContain('审批时间');
    expect(tree.props.className).toBe('safety-gate-line safety-gate-blocked');
  });

  it('renders a three-state decision action strip for approval flows', () => {
    const tree = DecisionActionStrip({
      items: [
        { label: '可以批准', detail: '进入待执行', tone: 'ready' },
        { label: '无法常规批准', detail: '缺证据', tone: 'warning' },
        { label: '强行拦截', detail: '拒绝', tone: 'blocked' },
      ],
    }) as ReactElement;

    expect(collectText(tree)).toContain('无法常规批准');
    expect(collectElements(tree, (element) => element.props.className === 'decision-action decision-action-blocked')).toHaveLength(1);
  });
});
