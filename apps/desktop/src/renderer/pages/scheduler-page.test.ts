import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSchedulerTaskPanelState, formatCronForOperator, schedulerActionButtonView, taskPurpose } from './scheduler-page';

describe('taskPurpose', () => {
  it('describes recommendation generation as a review queue rather than only pending approval', () => {
    const purpose = taskPurpose('daily_recommendation_generate');

    expect(purpose).toContain('待处理建议池');
    expect(purpose).toContain('需复核');
    expect(purpose).not.toContain('生成待审批建议');
  });
});

describe('formatCronForOperator', () => {
  it('formats daily cron expressions as readable local schedules', () => {
    expect(formatCronForOperator('30 8 * * *')).toBe('每天 08:30');
    expect(formatCronForOperator('0 9 * * *')).toBe('每天 09:00');
  });

  it('keeps uncommon cron expressions visible as advanced details', () => {
    expect(formatCronForOperator('*/15 * * * *')).toBe('高级计划：*/15 * * * *');
    expect(formatCronForOperator('')).toBe('-');
  });
});

describe('buildSchedulerTaskPanelState', () => {
  it('uses refresh as the default first-screen task', () => {
    const state = buildSchedulerTaskPanelState({
      tasks: [task({ enabled: true, nextRun: '2026-06-25T08:30:00.000Z' })],
      loading: false,
    });

    expect(state).toMatchObject({
      title: '本地调度已开启',
      primaryActionLabel: '刷新调度状态',
      mode: 'refresh',
      feedbackLabel: '等待下一次本地唤起',
      feedbackTone: 'ready',
    });
    expect(state.detail).toContain('不会批准或写入 Amazon Ads');
    expect(state.feedbackDetail).toContain('每日广告报表下载');
  });

  it('turns a pending run-now task into the primary confirmation action', () => {
    const pending = task({ name: 'daily_recommendation_generate', enabled: true });
    const state = buildSchedulerTaskPanelState({
      tasks: [pending],
      loading: false,
      pendingRunTask: pending,
    });

    expect(state).toMatchObject({
      title: '确认触发：每日优化建议生成',
      primaryActionLabel: '执行本地任务',
      mode: 'confirm-run',
      feedbackLabel: '等待人工确认',
      feedbackTone: 'warning',
    });
    expect(state.detail).toContain('待处理建议池');
    expect(state.feedbackDetail).toContain('不会立即运行');
    expect(state.secondaryActions).toEqual([expect.objectContaining({ label: '返回任务列表', kind: 'cancel-run' })]);
  });

  it('keeps task failures visible in the first-screen feedback line', () => {
    const state = buildSchedulerTaskPanelState({
      tasks: [task({ enabled: true })],
      loading: false,
      message: '立即执行失败：浏览器未登录。',
    });

    expect(state).toMatchObject({
      feedbackLabel: '调度动作失败',
      feedbackDetail: '立即执行失败：浏览器未登录。',
      feedbackTone: 'blocked',
    });
  });
});

describe('scheduler first-screen task surface', () => {
  it('renders one state-driven task banner without a duplicate confirmation surface', () => {
    const source = readFileSync(new URL('./scheduler-page.tsx', import.meta.url), 'utf8');

    expect(source.match(/<TaskBanner\b/g)).toHaveLength(1);
    expect(source).not.toContain('scheduler-prototype-feedback');
    expect(source).not.toContain('className="inline-confirmation"');
    expect(source.match(/<ProgressiveDetails\b/g)).toHaveLength(1);
    expect(source).not.toContain('<details');
    const pageHeader = source.match(/<PageHeader[\s\S]*?\/>/)?.[0] || '';
    expect(pageHeader).not.toContain('primaryAction=');
  });
});

describe('schedulerActionButtonView', () => {
  it('marks the active scheduler control as busy with spinner and aria state', () => {
    const running = schedulerActionButtonView({
      active: true,
      baseClassName: 'secondary-button compact-button',
      busyLabel: '停用中...',
      label: '停用',
    });

    expect(running.label).toBe('停用中...');
    expect(running.className).toContain('secondary-button compact-button');
    expect(running.className).toContain('button-loading');
    expect(running.disabled).toBe(true);
    expect(running.ariaBusy).toBe(true);
    expect(running.showSpinner).toBe(true);
  });

  it('locks peer scheduler controls without making them look like the running action', () => {
    const locked = schedulerActionButtonView({
      active: false,
      baseClassName: 'secondary-button compact-button',
      busyLabel: '启用中...',
      groupBusy: true,
      label: '启用',
    });

    expect(locked.label).toBe('启用');
    expect(locked.disabled).toBe(true);
    expect(locked.ariaBusy).toBeUndefined();
    expect(locked.className).not.toContain('button-loading');
    expect(locked.showSpinner).toBe(false);
  });
});

function task(patch: Partial<{
  name: string;
  cron: string;
  enabled: boolean;
  nextRun: string;
  lastRun: string;
  lastResult: string;
}> = {}) {
  return {
    name: patch.name || 'daily_report_download',
    cron: patch.cron || '30 8 * * *',
    enabled: patch.enabled ?? false,
    nextRun: patch.nextRun,
    lastRun: patch.lastRun,
    lastResult: patch.lastResult,
  };
}
