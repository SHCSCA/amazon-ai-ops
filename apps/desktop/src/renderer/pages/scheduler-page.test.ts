import { describe, expect, it } from 'vitest';
import { formatCronForOperator, taskPurpose } from './scheduler-page';

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
