import React, { type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
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

function rendererCss(): string {
  return readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
}

function cssRuleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('industrial UI atoms', () => {
  it('keeps the global button micro-response contract in the stylesheet', () => {
    const stylesheet = rendererCss();
    const activeButtonRule = cssRuleBody(stylesheet, 'button:active:not(:disabled)');
    const disabledButtonRule = cssRuleBody(stylesheet, 'button:disabled');

    expect(activeButtonRule).toMatch(/transform\s*:\s*scale\(0\.98\)\s*;/);
    expect(disabledButtonRule).toMatch(/cursor\s*:\s*not-allowed\s*;/);
    expect(stylesheet).not.toContain('translateY(1px)');
  });

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

  it('keeps state light hover lift feedback in the stylesheet', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.state-light-card\s*\{[\s\S]*transition:\s*transform 120ms/);
    expect(stylesheet).toMatch(/\.state-light-card:hover\s*\{[\s\S]*box-shadow\s*:[^;]+;/);
    expect(stylesheet).toMatch(/\.state-light-card:hover\s*\{[\s\S]*transform\s*:\s*translateY\(-2px\)\s*;/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.state-light-card:hover[\s\S]*transform:\s*none/);
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
    expect(collectElements(tree, (element) => element.props.className === 'micro-step-indicator' && element.props['aria-hidden'] === 'true')).toHaveLength(2);
  });

  it('keeps micro stepper pending spinner feedback in the stylesheet', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.micro-step\s*\{[\s\S]*grid-template-columns:\s*18px minmax\(150px, 0\.3fr\)/);
    expect(stylesheet).toMatch(/\.micro-step-pending \.micro-step-indicator\s*\{[\s\S]*animation:\s*micro-step-spin 900ms linear infinite/);
    expect(stylesheet).toContain('@keyframes micro-step-spin');
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.micro-step-pending \.micro-step-indicator[\s\S]*animation:\s*none/);
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

  it('renders reserved field feedback without replacing the row hint', () => {
    const tree = FormTableRow({
      label: '目标 ACOS',
      required: true,
      hint: '0 到 1 的小数格式。',
      feedback: { tone: 'blocked', children: '目标 ACOS 必须大于 0' },
      children: <input value="0" readOnly />,
    }) as ReactElement;

    expect(tree.props.className).toBe('form-table-row form-table-row-blocked');
    expect(collectText(tree)).toContain('0 到 1 的小数格式。');
    expect(collectText(tree)).toContain('目标 ACOS 必须大于 0');
    expect(collectElements(tree, (element) => element.props.className === 'form-table-feedback form-table-feedback-blocked')).toHaveLength(1);
    expect(collectElements(tree, (element) => element.props.role === 'status' && element.props['aria-live'] === 'polite')).toHaveLength(1);
  });

  it('keeps form table feedback styles reserved and non-jumpy', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.form-table-row[\s\S]*grid-template-columns:\s*160px minmax\(0, 1fr\)/);
    expect(stylesheet).toMatch(/\.form-table-row[\s\S]*transition:\s*[\s\S]*background var\(--motion-fast\)[\s\S]*box-shadow var\(--motion-fast\)/);
    expect(stylesheet).toMatch(/\.form-table-row:focus-within\s*\{[\s\S]*box-shadow:\s*[\s\S]*inset 3px 0 0 var\(--primary\)[\s\S]*0 0 0 2px rgb\(37 99 235 \/ 0\.10\)/);
    expect(stylesheet).toMatch(/\.form-table-row:focus-within \.form-table-label\s*\{[\s\S]*color:\s*var\(--primary\)/);
    expect(stylesheet).toMatch(/\.form-table-feedback[\s\S]*min-height:\s*16px/);
    expect(stylesheet).toContain('.form-table-feedback-blocked');
    expect(stylesheet).toContain('@keyframes form-table-feedback-in');
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.form-table-row[\s\S]*transition:\s*none/);
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
    expect(tree.props.role).toBe('group');
    expect(tree.props['aria-label']).toBe('审批三态决策动作');
    expect(tree.props['data-hover-fade']).toBe('true');
    expect(collectElements(tree, (element) => element.props.className === 'decision-action decision-action-blocked')).toHaveLength(1);
    expect(collectElements(tree, (element) => element.props['data-decision-action'] === 'true')).toHaveLength(3);
  });

  it('keeps the decision strip hover contract in the stylesheet', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toContain('.decision-action-strip:hover .decision-action:not(:hover):not(:focus-visible):not(:disabled)');
    expect(stylesheet).toContain('.decision-action-strip:focus-within .decision-action:not(:focus-visible):not(:disabled)');
    expect(stylesheet).toContain('opacity: 0.4;');
  });

  it('keeps direct details disclosures from becoming dead click targets', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toContain('--radius-sm: 6px;');
    expect(stylesheet).toMatch(/\.dashboard-details summary,[\s\S]*\.details-panel summary,[\s\S]*\.evidence-disclosure summary\s*\{[\s\S]*transition:\s*[\s\S]*background var\(--motion-fast\)[\s\S]*box-shadow var\(--motion-fast\)[\s\S]*transform var\(--motion-fast\)/);
    expect(stylesheet).toMatch(/\.dashboard-details summary:hover,[\s\S]*\.details-panel summary:hover,[\s\S]*\.evidence-disclosure summary:hover\s*\{[\s\S]*box-shadow:\s*inset 3px 0 0 var\(--primary\)/);
    expect(stylesheet).toMatch(/\.dashboard-details summary:focus-visible,[\s\S]*\.details-panel summary:focus-visible,[\s\S]*\.evidence-disclosure summary:focus-visible\s*\{[\s\S]*outline:\s*2px solid rgba\(37,\s*99,\s*235,\s*0\.34\)/);
    expect(stylesheet).toMatch(/\.dashboard-details summary:active,[\s\S]*\.details-panel summary:active,[\s\S]*\.evidence-disclosure summary:active\s*\{[\s\S]*transform:\s*scale\(0\.98\)/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.dashboard-details summary,[\s\S]*\.details-panel summary,[\s\S]*\.evidence-disclosure summary[\s\S]*transition:\s*none/);
  });
});
