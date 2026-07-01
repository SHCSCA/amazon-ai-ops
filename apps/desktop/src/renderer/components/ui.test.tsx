import React, { type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DecisionActionStrip, FormTable, FormTableRow, MicroStepper, PageHeader, Panel, SafetyGateLine, StateLightGrid, StatusPill } from './ui';

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
  it('renders page headers as first-level desktop landmarks with a readable task rail', () => {
    const tree = PageHeader({
      eyebrow: '数据与量化',
      title: '广告全口径量化诊断中心',
      description: '展示当前产品的真实广告指标、风险对象和 AI 阶段诊断。',
      primaryTask: '运行 AI 阶段分析',
      nextAction: '生成优化建议',
    }) as ReactElement;
    const headings = collectElements(tree, (element) => element.type === 'h1');
    const description = collectElements(tree, (element) => element.type === 'p' && element.props.id === tree.props['aria-describedby']);
    const taskRail = collectElements(tree, (element) => element.props.className === 'page-header-rail');
    const taskCards = collectElements(tree, (element) => element.props.className === 'page-header-rail-card');

    expect(tree.type).toBe('header');
    expect(tree.props.className).toBe('page-header');
    expect(headings).toHaveLength(1);
    expect(headings[0].props.id).toBe(tree.props['aria-labelledby']);
    expect(description).toHaveLength(1);
    expect(taskRail[0].props.role).toBe('list');
    expect(taskRail[0].props['aria-label']).toBe('首屏主任务和建议下一步');
    expect(taskCards).toHaveLength(2);
    expect(taskCards.every((card) => card.props.role === 'listitem' && card.props.tabIndex === 0)).toBe(true);
  });

  it('keeps the global typography contract aligned with dense desktop tables', () => {
    const stylesheet = rendererCss();
    const bodyRule = cssRuleBody(stylesheet, 'body');
    const businessTableCellRule = cssRuleBody(stylesheet, '.business-table td');
    const virtualTableCellRule = cssRuleBody(stylesheet, '.virtual-table-cell');

    expect(bodyRule).toContain('font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;');
    expect(bodyRule).toMatch(/line-height\s*:\s*1\.25\s*;/);
    expect(businessTableCellRule).toMatch(/line-height\s*:\s*1\.25\s*;/);
    expect(virtualTableCellRule).toMatch(/line-height\s*:\s*1\.25\s*;/);
  });

  it('keeps the global button micro-response contract in the stylesheet', () => {
    const stylesheet = rendererCss();
    const activeButtonRule = cssRuleBody(stylesheet, 'button:active:not(:disabled)');
    const disabledButtonRule = cssRuleBody(stylesheet, 'button:disabled');

    expect(activeButtonRule).toMatch(/transform\s*:\s*scale\(0\.98\)\s*;/);
    expect(disabledButtonRule).toMatch(/cursor\s*:\s*not-allowed\s*;/);
    expect(stylesheet).not.toContain('translateY(1px)');
  });

  it('keeps page header title and rail cards aligned with the first-screen contract', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.page-header h1\s*\{[\s\S]*font-size:\s*26px/);
    expect(stylesheet).toMatch(/\.page-header-rail-card\s*\{[\s\S]*transition:\s*[\s\S]*border-color var\(--motion-fast\)[\s\S]*box-shadow var\(--motion-fast\)[\s\S]*transform var\(--motion-fast\)/);
    expect(stylesheet).toMatch(/\.page-header-rail-card:hover\s*\{[\s\S]*transform:\s*translateY\(-2px\)/);
    expect(stylesheet).toMatch(/\.page-header-rail-card:focus-visible\s*\{[\s\S]*outline:\s*2px solid rgba\(37,\s*99,\s*235,\s*0\.34\)/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.page-header-rail-card[\s\S]*transition:\s*none/);
  });

  it('names titled panels as scannable page sections', () => {
    const tree = Panel({
      title: '数据健康',
      tone: 'success',
      children: <p>8/8 真实报表已导入。</p>,
    }) as ReactElement;
    const headings = collectElements(tree, (element) => element.type === 'h3');

    expect(tree.type).toBe('section');
    expect(tree.props.className).toBe('ui-panel ui-panel-success');
    expect(tree.props['aria-labelledby']).toBe(headings[0].props.id);
    expect(headings[0].props.id).toMatch(/^ui-panel-[a-z0-9]+-title$/);
    expect(collectText(tree)).toContain('数据健康');
  });

  it('renders status pills as semantic dense status tags without polluting tab order', () => {
    const tree = StatusPill({
      tone: 'warning',
      children: '需复核 3',
    }) as ReactElement;

    expect(tree.type).toBe('span');
    expect(tree.props.className).toBe('status-pill status-warning');
    expect(tree.props.role).toBe('note');
    expect(tree.props['aria-roledescription']).toBe('状态标签');
    expect(tree.props['data-status-tone']).toBe('warning');
    expect(tree.props.tabIndex).toBeUndefined();
    expect(collectText(tree)).toContain('需复核 3');
  });

  it('allows status pills to opt into keyboard focus or live readback only when needed', () => {
    const focusable = StatusPill({
      tone: 'blocked',
      focusable: true,
      children: '强阻断',
    }) as ReactElement;
    const live = StatusPill({
      tone: 'ready',
      live: true,
      children: '已保存',
    }) as ReactElement;

    expect(focusable.props.tabIndex).toBe(0);
    expect(focusable.props.role).toBe('note');
    expect(live.props.role).toBe('status');
    expect(live.props['aria-live']).toBe('polite');
    expect(live.props['aria-atomic']).toBe(true);
  });

  it('keeps status pill hover and optional focus feedback in the stylesheet', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.status-pill\s*\{[\s\S]*transition:\s*background 120ms/);
    expect(stylesheet).toMatch(/\.status-pill:hover\s*\{[\s\S]*transform:\s*translateY\(-1px\)/);
    expect(stylesheet).toMatch(/\.status-pill:focus-visible\s*\{[\s\S]*outline:\s*2px solid rgba\(37,\s*99,\s*235,\s*0\.34\)/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.status-pill[\s\S]*transition:\s*none/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.status-pill:hover[\s\S]*transform:\s*none/);
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

  it('exposes state light cards as a keyboard-scannable status list', () => {
    const tree = StateLightGrid({
      items: [
        { label: '数据就绪', value: '8/8 报表全', detail: '当前范围真实报表完整', tone: 'ready' },
        { label: '审批就绪', value: '无挂起任务', tone: 'pending' },
      ],
    }) as ReactElement;
    const cards = collectElements(tree, (element) => String(element.props.className || '').startsWith('state-light-card'));

    expect(tree.props.role).toBe('list');
    expect(tree.props['aria-label']).toBe('首屏状态红绿灯');
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.props.role === 'listitem' && card.props.tabIndex === 0)).toBe(true);
  });

  it('can pulse state lights during a first-screen action refresh', () => {
    const tree = StateLightGrid({
      refreshing: true,
      items: [
        { label: '数据就绪', value: '8/8 报表全', tone: 'ready' },
      ],
    }) as ReactElement;

    expect(tree.props.className).toContain('state-light-grid-refreshing');
    expect(tree.props['data-refreshing']).toBe(true);
  });

  it('keeps state light hover lift feedback in the stylesheet', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.state-light-card\s*\{[\s\S]*transition:\s*transform 120ms/);
    expect(stylesheet).toMatch(/\.state-light-card:hover\s*\{[\s\S]*box-shadow\s*:[^;]+;/);
    expect(stylesheet).toMatch(/\.state-light-card:hover\s*\{[\s\S]*transform\s*:\s*translateY\(-2px\)\s*;/);
    expect(stylesheet).toMatch(/\.state-light-card:focus-visible\s*\{[\s\S]*outline:\s*2px solid rgba\(37,\s*99,\s*235,\s*0\.34\)/);
    expect(stylesheet).toMatch(/\.state-light-card:focus-visible\s*\{[\s\S]*transform:\s*translateY\(-2px\)/);
    expect(stylesheet).toMatch(/\.state-light-grid-refreshing \.state-light-card\s*\{[\s\S]*animation:\s*state-light-refresh-pulse 180ms/);
    expect(stylesheet).toMatch(/\.state-light-grid-refreshing \.state-light-card::after\s*\{[\s\S]*animation:\s*state-light-refresh-sweep 180ms/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.state-light-card:hover[\s\S]*transform:\s*none/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.state-light-card:focus-visible[\s\S]*transform:\s*none/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.state-light-grid-refreshing \.state-light-card,[\s\S]*\.state-light-grid-refreshing \.state-light-card::after[\s\S]*animation:\s*none/);
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

  it('exposes micro stepper rows as keyboard-scannable process steps', () => {
    const tree = MicroStepper({
      items: [
        { label: '创建报表', meta: '已完成', tone: 'ready' },
        { label: '下载中心轮询', meta: '进行中', tone: 'pending' },
      ],
    }) as ReactElement;
    const rows = collectElements(tree, (element) => String(element.props.className ?? '').includes('micro-step '));

    expect(tree.props.role).toBe('list');
    expect(tree.props['aria-label']).toBe('流程步骤状态');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.props.role === 'listitem' && row.props.tabIndex === 0)).toBe(true);
  });

  it('keeps micro stepper pending spinner feedback in the stylesheet', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.micro-step\s*\{[\s\S]*grid-template-columns:\s*18px minmax\(150px, 0\.3fr\)/);
    expect(stylesheet).toMatch(/\.micro-step-pending \.micro-step-indicator\s*\{[\s\S]*animation:\s*micro-step-spin 900ms linear infinite/);
    expect(stylesheet).toContain('@keyframes micro-step-spin');
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.micro-step-pending \.micro-step-indicator[\s\S]*animation:\s*none/);
  });

  it('keeps micro stepper keyboard focus feedback in the stylesheet', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.micro-step\s*\{[\s\S]*transition:\s*border-color 120ms/);
    expect(stylesheet).toMatch(/\.micro-step:focus-visible\s*\{[\s\S]*outline:\s*2px solid rgba\(37,\s*99,\s*235,\s*0\.34\)/);
    expect(stylesheet).toMatch(/\.micro-step:focus-visible\s*\{[\s\S]*transform:\s*translateY\(-1px\)/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.micro-step:focus-visible[\s\S]*transform:\s*none/);
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
    expect(collectElements(tree, (element) => element.props.className === 'form-table-feedback-slot')).toHaveLength(1);
    expect(collectElements(tree, (element) => element.props.className === 'form-table-feedback form-table-feedback-blocked')).toHaveLength(1);
    expect(collectElements(tree, (element) => element.props.role === 'status' && element.props['aria-live'] === 'polite')).toHaveLength(1);
  });

  it('keeps a blank feedback slot on quiet form rows so later validation cannot push layout', () => {
    const tree = FormTableRow({
      label: '最低花费',
      hint: '单位 USD',
      children: <input value="10.00" readOnly />,
    }) as ReactElement;

    expect(collectElements(tree, (element) => element.props.className === 'form-table-feedback-slot')).toHaveLength(1);
    expect(collectElements(tree, (element) => element.props.className === 'form-table-feedback form-table-feedback-placeholder')).toHaveLength(1);
    expect(collectElements(tree, (element) => element.props['aria-hidden'] === 'true')).toHaveLength(1);
  });

  it('keeps form table feedback styles reserved and non-jumpy', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.form-table-row[\s\S]*grid-template-columns:\s*160px minmax\(0, 1fr\)/);
    expect(stylesheet).toMatch(/\.form-table-row[\s\S]*transition:\s*[\s\S]*background var\(--motion-fast\)[\s\S]*box-shadow var\(--motion-fast\)/);
    expect(stylesheet).toMatch(/\.form-table-row:focus-within\s*\{[\s\S]*box-shadow:\s*[\s\S]*inset 3px 0 0 var\(--primary\)[\s\S]*0 0 0 2px rgb\(37 99 235 \/ 0\.10\)/);
    expect(stylesheet).toMatch(/\.form-table-row:focus-within \.form-table-label\s*\{[\s\S]*color:\s*var\(--primary\)/);
    expect(stylesheet).toMatch(/\.form-table-feedback-slot[\s\S]*min-height:\s*18px/);
    expect(stylesheet).toMatch(/\.form-table-feedback[\s\S]*min-height:\s*16px/);
    expect(stylesheet).toMatch(/\.form-table-feedback-placeholder[\s\S]*visibility:\s*hidden/);
    expect(stylesheet).toContain('.form-table-feedback-blocked');
    expect(stylesheet).toContain('@keyframes form-table-feedback-in');
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.form-table-row[\s\S]*transition:\s*none/);
  });

  it('renders safety gate language as a dedicated first-class line', () => {
    const tree = SafetyGateLine({ children: '审批时间 <= 执行前时间 <= 线下动作执行时间 <= 真实回读时间' }) as ReactElement;

    expect(collectText(tree)).toContain('审批时间');
    expect(tree.props.className).toBe('safety-gate-line safety-gate-blocked');
    expect(tree.props.role).toBe('status');
    expect(tree.props['aria-live']).toBe('polite');
    expect(tree.props['aria-atomic']).toBe(true);
    expect(tree.props['aria-roledescription']).toBe('安全门状态');
    expect(tree.props['data-safety-tone']).toBe('blocked');
    expect(tree.props.tabIndex).toBe(0);
  });

  it('keeps the safety gate line keyboard-visible without adding layout shift', () => {
    const stylesheet = rendererCss();

    expect(stylesheet).toMatch(/\.safety-gate-line[\s\S]*transition:\s*[\s\S]*border-color var\(--motion-fast\)[\s\S]*box-shadow var\(--motion-fast\)[\s\S]*transform var\(--motion-fast\)/);
    expect(stylesheet).toMatch(/\.safety-gate-line:hover[\s\S]*transform:\s*translateY\(-1px\)/);
    expect(stylesheet).toMatch(/\.safety-gate-line:focus-visible[\s\S]*outline:\s*2px solid rgb\(37 99 235 \/ 0\.34\)/);
    expect(stylesheet).toMatch(/\.safety-gate-line:focus-visible[\s\S]*box-shadow:\s*0 0 0 4px rgb\(37 99 235 \/ 0\.10\)/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.safety-gate-line[\s\S]*transition:\s*none/);
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
