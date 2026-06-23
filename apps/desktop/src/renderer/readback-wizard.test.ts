import { describe, expect, it } from 'vitest';
import {
  firstIncompleteReadbackStep,
  readbackWizardSteps,
  type ReadbackWizardStepId,
} from './readback-wizard';

describe('readbackWizardSteps', () => {
  it('keeps the four execution readback steps in operator order', () => {
    expect(readbackWizardSteps.map((step) => step.id)).toEqual<ReadbackWizardStepId[]>([
      'target-source',
      'approval',
      'evidence',
      'verify-export',
    ]);
  });
});

describe('firstIncompleteReadbackStep', () => {
  it('routes missing store, ASIN, and source file blockers to target-source', () => {
    expect(firstIncompleteReadbackStep(['店铺'])).toBe('target-source');
    expect(firstIncompleteReadbackStep(['ASIN'])).toBe('target-source');
    expect(firstIncompleteReadbackStep(['推荐来源文件'])).toBe('target-source');
  });

  it('routes missing approver and approval artifact blockers to approval', () => {
    expect(firstIncompleteReadbackStep(['审批人'])).toBe('approval');
    expect(firstIncompleteReadbackStep(['审批凭证'])).toBe('approval');
  });

  it('routes missing before, after, and readback screenshot blockers to evidence', () => {
    expect(firstIncompleteReadbackStep(['执行前截图'])).toBe('evidence');
    expect(firstIncompleteReadbackStep(['执行后截图'])).toBe('evidence');
    expect(firstIncompleteReadbackStep(['回读证据'])).toBe('evidence');
  });

  it('routes execution confirmation and final readback equality blockers to verify-export', () => {
    expect(firstIncompleteReadbackStep(['执行成功确认'])).toBe('verify-export');
    expect(firstIncompleteReadbackStep(['回读值必须等于执行后值'])).toBe('verify-export');
  });

  it('defaults to verify-export when there are no missing blockers', () => {
    expect(firstIncompleteReadbackStep([])).toBe('verify-export');
  });
});
