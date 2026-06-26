import { describe, expect, it } from 'vitest';
import {
  parseReadbackRepairIntent,
  readbackRepairIntentMessage,
  readbackRepairIntentStep,
  readbackRepairPanelClass,
} from './readback-repair-intent';

describe('readback repair intent', () => {
  it('routes delivery readback proof gaps directly to the evidence repair step', () => {
    const intent = parseReadbackRepairIntent(JSON.stringify({
      source: 'delivery',
      candidatePath: 'C:/evidence/readback-candidate.json',
      missingFields: ['执行前截图', '执行后截图', '回读证据'],
      summary: '当前候选动作缺少执行前、执行后和刷新回读证明。',
    }));

    expect(intent?.source).toBe('delivery');
    expect(readbackRepairIntentStep(intent)).toBe('evidence');
    expect(readbackRepairIntentMessage(intent)).toContain('从交付验收直达修复');
    expect(readbackRepairIntentMessage(intent)).toContain('readback-candidate.json');
  });

  it('rejects malformed or non-delivery repair intents', () => {
    expect(parseReadbackRepairIntent('{')).toBeNull();
    expect(parseReadbackRepairIntent(JSON.stringify({ source: 'settings' }))).toBeNull();
  });

  it('returns stable highlight classes without changing layout dimensions', () => {
    expect(readbackRepairPanelClass(false, false)).toBe('readback-repair-target');
    expect(readbackRepairPanelClass(true, false)).toBe('readback-repair-target readback-repair-target-active');
    expect(readbackRepairPanelClass(true, true)).toContain('readback-repair-target-pulse');
  });
});
