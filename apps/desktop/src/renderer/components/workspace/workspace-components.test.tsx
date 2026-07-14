import React, { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  PageFrame,
  TaskBanner,
  SummaryStrip,
  WorkbenchPanel,
  PriorityDataTable,
  WorkspaceState,
  type PriorityDataTableColumn,
} from './index';

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

function hasClass(element: ReactElement, className: string): boolean {
  return typeof element.props.className === 'string'
    && element.props.className.split(/\s+/).includes(className);
}

describe('PageFrame', () => {
  it('owns one page heading without creating a nested main landmark', () => {
    const tree = PageFrame({
      title: '今日任务',
      description: '先处理当前阻塞，再继续分析。',
      task: <div>运营作战单</div>,
      summary: <div>关键摘要</div>,
      children: <div>对象队列</div>,
    }) as ReactElement;

    const headings = collectElements(tree, (element) => element.type === 'h1');
    const mains = collectElements(tree, (element) => element.type === 'main');
    const page = collectElements(tree, (element) => hasClass(element, 'workspace-page-frame'))[0];

    expect(headings).toHaveLength(1);
    expect(textContent(headings[0])).toBe('今日任务');
    expect(mains).toHaveLength(0);
    expect(page.props['aria-labelledby']).toBe(headings[0].props.id);
    expect(textContent(tree)).toContain('运营作战单关键摘要对象队列');
  });
});

describe('TaskBanner', () => {
  it('renders exactly one primary action and limits secondary actions to two', () => {
    const tree = TaskBanner({
      eyebrow: '下一安全动作',
      title: '补齐真实报表',
      description: '当前范围缺少广告活动报告。',
      primaryAction: { label: '前往数据准备', onClick: vi.fn() },
      secondaryActions: [
        { label: '查看缺失项', onClick: vi.fn() },
        { label: '打开说明', onClick: vi.fn() },
        { label: '不应出现', onClick: vi.fn() },
      ],
    }) as ReactElement;

    const primary = collectElements(tree, (element) => element.props['data-action-priority'] === 'primary');
    const secondary = collectElements(tree, (element) => element.props['data-action-priority'] === 'secondary');

    expect(primary).toHaveLength(1);
    expect(primary[0].props.type).toBe('button');
    expect(textContent(primary[0])).toBe('前往数据准备');
    expect(secondary).toHaveLength(2);
    expect(textContent(tree)).not.toContain('不应出现');
  });

  it('locks peer actions while preserving busy ownership and disabled reason', () => {
    const tree = TaskBanner({
      title: '导入当前范围报表',
      description: '导入时不能重复提交。',
      primaryAction: {
        label: '开始导入',
        onClick: vi.fn(),
        busy: true,
        busyLabel: '正在导入...',
      },
      secondaryActions: [{
        label: '重新选择文件',
        onClick: vi.fn(),
        disabledReason: '等待当前导入完成',
      }],
    }) as ReactElement;

    const buttons = collectElements(tree, (element) => element.type === 'button');
    const primary = buttons[0];
    const peer = buttons[1];
    const peerReason = collectElements(tree, (element) => element.props.id === peer.props['aria-describedby'])[0];

    expect(primary.props.disabled).toBe(true);
    expect(primary.props['aria-busy']).toBe(true);
    expect(textContent(primary)).toContain('正在导入...');
    expect(peer.props.disabled).toBe(true);
    expect(peer.props['aria-busy']).toBeUndefined();
    expect(textContent(peer)).toBe('重新选择文件');
    expect(textContent(peerReason)).toBe('等待当前导入完成');
  });
});

describe('SummaryStrip', () => {
  it('renders at most four decision metrics as a labelled definition list', () => {
    const tree = SummaryStrip({
      ariaLabel: '当前决策摘要',
      items: [
        { id: 'blockers', label: '阻塞项', value: '2', tone: 'blocked' },
        { id: 'products', label: '当前产品', value: '1' },
        { id: 'reports', label: '报表', value: '7/8', tone: 'attention' },
        { id: 'approval', label: '待审批', value: '3' },
        { id: 'extra', label: '不应出现', value: '99' },
      ],
    }) as ReactElement;

    const list = collectElements(tree, (element) => element.type === 'dl')[0];
    const items = collectElements(tree, (element) => element.props['data-summary-item'] === 'true');

    expect(list.props['aria-label']).toBe('当前决策摘要');
    expect(items).toHaveLength(4);
    expect(items[0].props['data-tone']).toBe('blocked');
    expect(textContent(tree)).not.toContain('不应出现');
  });
});

describe('WorkbenchPanel', () => {
  it('names the primary work area and keeps toolbar and status outside its content body', () => {
    const tree = WorkbenchPanel({
      title: '风险对象队列',
      description: '按风险优先级处理。',
      toolbar: <button type="button">筛选</button>,
      status: <span>共 6 项</span>,
      children: <div>队列内容</div>,
      footer: <div>最近更新</div>,
    }) as ReactElement;

    const section = collectElements(tree, (element) => hasClass(element, 'workbench-panel'))[0];
    const heading = collectElements(tree, (element) => element.type === 'h2')[0];
    const toolbar = collectElements(tree, (element) => element.props.role === 'toolbar')[0];
    const body = collectElements(tree, (element) => hasClass(element, 'workbench-panel__body'))[0];

    expect(section.props['aria-labelledby']).toBe(heading.props.id);
    expect(toolbar.props['aria-label']).toContain('风险对象队列');
    expect(textContent(body)).toBe('队列内容');
    expect(section.props['data-scroll-owner']).toBeUndefined();
  });
});

type RiskRow = { id: string; object: string; risk: string };

const riskColumns: Array<PriorityDataTableColumn<RiskRow>> = [
  { key: 'object', header: '对象', priority: 'anchor', cell: (row) => row.object },
  { key: 'risk', header: '风险', priority: 'primary', cell: (row) => row.risk },
  { key: 'detail', header: '详情', priority: 'supporting', cell: () => '来源与理由' },
  { key: 'action', header: '动作', priority: 'action', align: 'right', cell: () => <button type="button">查看</button> },
];

describe('PriorityDataTable', () => {
  it('marks column priority, selection, and horizontal-only overflow ownership', () => {
    const onSelect = vi.fn();
    const rows: RiskRow[] = [{ id: 'r1', object: '广告活动 A', risk: '高 ACOS' }];
    const tree = PriorityDataTable({
      caption: '风险对象队列',
      rows,
      columns: riskColumns,
      getRowKey: (row) => row.id,
      selectedRowKey: 'r1',
      onRowSelect: onSelect,
      rowAriaLabel: (row) => `${row.object}，${row.risk}`,
    }) as ReactElement;

    const wrapper = collectElements(tree, (element) => hasClass(element, 'priority-table-scroll'))[0];
    const headers = collectElements(tree, (element) => element.type === 'th');
    const row = collectElements(tree, (element) => element.type === 'tr' && element.props['aria-selected'] === true)[0];

    expect(wrapper.props['data-scroll-exception']).toBe('horizontal-only');
    expect(headers.map((header) => header.props['data-column-priority'])).toEqual([
      'anchor', 'primary', 'supporting', 'action',
    ]);
    expect(hasClass(headers[3], 'priority-table__cell--end')).toBe(true);
    expect(row.props.tabIndex).toBe(0);

    row.props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() });
    row.props.onKeyDown({ key: ' ', preventDefault: vi.fn() });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('keeps the table caption and renders a neutral empty row', () => {
    const tree = PriorityDataTable<RiskRow>({
      caption: '风险对象队列',
      rows: [],
      columns: riskColumns,
      getRowKey: (row) => row.id,
      emptyState: '当前没有待处理对象',
    }) as ReactElement;

    const caption = collectElements(tree, (element) => element.type === 'caption')[0];
    const empty = collectElements(tree, (element) => hasClass(element, 'priority-table__empty'))[0];

    expect(textContent(caption)).toBe('风险对象队列');
    expect(empty.props.colSpan).toBe(4);
    expect(textContent(empty)).toBe('当前没有待处理对象');
  });
});

describe('WorkspaceState', () => {
  it.each([
    ['loading', '正在载入'],
    ['empty', '暂无内容'],
    ['blocked', '当前被阻塞'],
    ['error', '加载失败'],
    ['busy', '正在处理'],
    ['disabled', '当前不可用'],
  ] as const)('provides a Chinese default title for %s', (kind, title) => {
    const tree = WorkspaceState({ kind, description: '状态说明' }) as ReactElement;
    expect(textContent(tree)).toContain(title);
  });

  it('exposes long-task progress and a visible recovery action without claiming page priority', () => {
    const retry = vi.fn();
    const tree = WorkspaceState({
      kind: 'busy',
      description: '正在解析真实报表，请保持应用打开。',
      progress: { value: 3, max: 8, label: '已完成 3/8 份报表' },
      action: { label: '取消任务', onClick: retry },
    }) as ReactElement;

    const status = collectElements(tree, (element) => element.props.role === 'status')[0];
    const progress = collectElements(tree, (element) => element.type === 'progress')[0];
    const button = collectElements(tree, (element) => element.type === 'button')[0];

    expect(status.props['aria-live']).toBe('polite');
    expect(progress.props.value).toBe(3);
    expect(progress.props.max).toBe(8);
    expect(button.props['data-action-priority']).toBeUndefined();
    expect(textContent(button)).toBe('取消任务');
  });
});
