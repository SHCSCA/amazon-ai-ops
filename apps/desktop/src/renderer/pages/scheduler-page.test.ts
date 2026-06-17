import { describe, expect, it } from 'vitest';
import { taskPurpose } from './scheduler-page';

describe('taskPurpose', () => {
  it('describes recommendation generation as a review queue rather than only pending approval', () => {
    const purpose = taskPurpose('daily_recommendation_generate');

    expect(purpose).toContain('待处理建议池');
    expect(purpose).toContain('需复核');
    expect(purpose).not.toContain('生成待审批建议');
  });
});
