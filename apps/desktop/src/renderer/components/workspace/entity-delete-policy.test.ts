import { describe, expect, it } from 'vitest';
import {
  isEntityDestructive,
  isEntityRemovable,
  selectEntityDeletePolicy,
  type SupportedEntityType,
} from './entity-delete-policy';

describe('selectEntityDeletePolicy', () => {
  it('forbids authority and audit entities', () => {
    const forbidden: SupportedEntityType[] = [
      'experiment',
      'experiment-observation',
      'mission',
      'mission-grant',
      'mission-decision',
      'policy',
      'policy-version',
      'execution-batch',
      'execution-job',
      'readback',
      'evidence',
      'audit-entry',
      'listing-version',
      'causal-event',
      'schedule-run',
    ];
    for (const type of forbidden) {
      const policy = selectEntityDeletePolicy(type);
      expect(policy.mode, `${type} should be forbidden`).toBe('forbidden');
      expect(isEntityRemovable(policy)).toBe(false);
      expect(isEntityDestructive(policy)).toBe(false);
    }
  });

  it('voids operation-event and listing-draft by default', () => {
    expect(selectEntityDeletePolicy('operation-event').mode).toBe('void');
    expect(selectEntityDeletePolicy('listing-draft').mode).toBe('void');
  });

  it('archives store-scoped entities by default', () => {
    for (const type of ['product', 'ad-object', 'store', 'store-runtime-config'] as const) {
      expect(selectEntityDeletePolicy(type).mode, type).toBe('archive');
    }
  });

  it('hard-deletes schedules only when no history exists', () => {
    expect(selectEntityDeletePolicy('schedule').mode).toBe('hard-delete');
    expect(selectEntityDeletePolicy('schedule', { hasRuns: true }).mode).toBe('archive');
    expect(selectEntityDeletePolicy('schedule', { hasRuns: true }).buttonLabel).toBe('归档当前任务');
    expect(isEntityDestructive(selectEntityDeletePolicy('schedule'))).toBe(true);
  });

  it('forces historical reconciliation snapshots to forbidden', () => {
    const policy = selectEntityDeletePolicy('product', { isHistorical: true });
    expect(policy.mode).toBe('forbidden');
    expect(policy.buttonLabel).toContain('不可删除');
  });

  it('demotes listing-draft to archive once versions exist', () => {
    const policy = selectEntityDeletePolicy('listing-draft', { hasVersions: true });
    expect(policy.mode).toBe('archive');
    expect(policy.reason).toContain('归档');
  });

  it('adds downstream-reference warning for entities that have references', () => {
    const policy = selectEntityDeletePolicy('product', { hasReferences: true });
    expect(policy.mode).toBe('archive');
    expect(policy.reason).toContain('已被下游业务引用');
  });

  it('honours caller-provided reason and button label overrides', () => {
    const policy = selectEntityDeletePolicy('product', {
      reasonOverride: '本店铺已停售该 ASIN',
      buttonLabelOverride: '停售并归档',
    });
    expect(policy.reason).toBe('本店铺已停售该 ASIN');
    expect(policy.buttonLabel).toBe('停售并归档');
  });

  it('falls back to archive for unknown entity types', () => {
    const policy = selectEntityDeletePolicy('something-new');
    expect(policy.mode).toBe('archive');
    expect(policy.buttonLabel).toBeTruthy();
  });

  it('keeps the full matrix defined for every supported entity type', () => {
    const supported: SupportedEntityType[] = [
      'experiment',
      'experiment-observation',
      'mission',
      'mission-grant',
      'mission-decision',
      'policy',
      'policy-version',
      'execution-batch',
      'execution-job',
      'readback',
      'evidence',
      'audit-entry',
      'listing-version',
      'listing-draft',
      'product',
      'ad-object',
      'operation-event',
      'causal-event',
      'schedule',
      'schedule-run',
      'store-runtime-config',
      'store',
    ];
    for (const type of supported) {
      const policy = selectEntityDeletePolicy(type);
      expect(policy.mode, `${type} must define a mode`).toBeTruthy();
      expect(policy.reason, `${type} must define a reason`).toBeTruthy();
      expect(policy.buttonLabel, `${type} must define a label`).toBeTruthy();
    }
  });
});
