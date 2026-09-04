/**
 * Experiment Domain Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  isGuardrailTriggered,
  checkGuardrails,
  EXPERIMENT_STATUS_LABELS,
  CONCLUSION_LABELS,
  type Guardrail,
  type ExperimentMetrics,
} from './experiment-domain';

describe('ExperimentDomain', () => {
  const baseMetrics: ExperimentMetrics = {
    spend: 100,
    sales: 200,
    acos: 50,
    clicks: 10,
    impressions: 1000,
  };

  describe('isGuardrailTriggered', () => {
    it('triggers gt guardrail when value exceeds threshold', () => {
      const guardrail: Guardrail = {
        guardrailId: 'g1',
        name: 'high spend',
        metric: 'spend',
        operator: 'gt',
        threshold: 50,
        action: 'block',
      };
      expect(isGuardrailTriggered(guardrail, baseMetrics)).toBe(true);
    });

    it('does not trigger gt guardrail when value is below threshold', () => {
      const guardrail: Guardrail = {
        guardrailId: 'g1',
        name: 'high spend',
        metric: 'spend',
        operator: 'gt',
        threshold: 200,
        action: 'block',
      };
      expect(isGuardrailTriggered(guardrail, baseMetrics)).toBe(false);
    });

    it('triggers lt guardrail when value is below threshold', () => {
      const guardrail: Guardrail = {
        guardrailId: 'g1',
        name: 'low sales',
        metric: 'sales',
        operator: 'lt',
        threshold: 50,
        action: 'alert',
      };
      expect(isGuardrailTriggered(guardrail, baseMetrics)).toBe(false);
    });

    it('handles gte and lte correctly', () => {
      const gte: Guardrail = {
        guardrailId: 'g1', name: 'gte test', metric: 'spend',
        operator: 'gte', threshold: 100, action: 'alert',
      };
      const lte: Guardrail = {
        guardrailId: 'g2', name: 'lte test', metric: 'spend',
        operator: 'lte', threshold: 100, action: 'alert',
      };

      expect(isGuardrailTriggered(gte, baseMetrics)).toBe(true); // 100 >= 100
      expect(isGuardrailTriggered(lte, baseMetrics)).toBe(true); // 100 <= 100
    });

    it('returns false for missing metric', () => {
      const guardrail: Guardrail = {
        guardrailId: 'g1',
        name: 'missing',
        metric: 'unknownMetric',
        operator: 'gt',
        threshold: 0,
        action: 'alert',
      };
      expect(isGuardrailTriggered(guardrail, baseMetrics)).toBe(false);
    });
  });

  describe('checkGuardrails', () => {
    it('returns all triggered guardrails', () => {
      const guardrails: Guardrail[] = [
        { guardrailId: 'g1', name: 'high spend', metric: 'spend', operator: 'gt', threshold: 50, action: 'block' },
        { guardrailId: 'g2', name: 'low sales', metric: 'sales', operator: 'lt', threshold: 500, action: 'alert' },
        { guardrailId: 'g3', name: 'high acos', metric: 'acos', operator: 'gt', threshold: 100, action: 'alert' },
      ];

      const triggered = checkGuardrails(guardrails, baseMetrics);
      expect(triggered).toHaveLength(2);
      expect(triggered.map(g => g.guardrailId)).toContain('g1');
      expect(triggered.map(g => g.guardrailId)).toContain('g2');
    });

    it('returns empty array when no guardrails triggered', () => {
      const guardrails: Guardrail[] = [
        { guardrailId: 'g1', name: 'very high spend', metric: 'spend', operator: 'gt', threshold: 10000, action: 'block' },
      ];

      expect(checkGuardrails(guardrails, baseMetrics)).toEqual([]);
    });
  });

  describe('EXPERIMENT_STATUS_LABELS', () => {
    it('provides Chinese label for each status', () => {
      expect(EXPERIMENT_STATUS_LABELS.draft).toBe('草稿');
      expect(EXPERIMENT_STATUS_LABELS.running).toBe('观察中');
      expect(EXPERIMENT_STATUS_LABELS.paused).toBe('已暂停');
      expect(EXPERIMENT_STATUS_LABELS.completed).toBe('已完成');
    });
  });

  describe('CONCLUSION_LABELS', () => {
    it('provides Chinese label for each conclusion type', () => {
      expect(CONCLUSION_LABELS.success).toBe('实验成功');
      expect(CONCLUSION_LABELS.failure).toBe('实验失败');
      expect(CONCLUSION_LABELS.inconclusive).toBe('结果不明确');
    });
  });

  describe('validateExperimentRecord', () => {
    it('accepts valid experiment', async () => {
      const { validateExperimentRecord, buildExperimentRecord } = await import('./experiment-domain');

      const record = buildExperimentRecord({
        experimentId: 'exp-001',
        storeId: 'jf-us',
        name: 'Test Experiment',
        hypothesis: {
          statement: 'Lowering bid will reduce ACOS',
          expectedEffect: 'ACOS reduction',
          expectedChangePercent: -10,
        },
        productIds: ['prod-001'],
        entityIds: ['kw-001', 'kw-002'],
      });

      expect(() => validateExperimentRecord(record)).not.toThrow();
    });

    it('rejects missing required fields', async () => {
      const { validateExperimentRecord, buildExperimentRecord } = await import('./experiment-domain');

      const record = buildExperimentRecord({
        experimentId: '',
        storeId: 'jf-us',
        name: 'Test',
        hypothesis: { statement: 'Test', expectedEffect: 'Effect' },
        productIds: [],
        entityIds: [],
      });

      expect(() => validateExperimentRecord(record)).toThrow('Experiment ID is required');
    });

    it('rejects invalid timestamps', async () => {
      const { validateExperimentRecord, buildExperimentRecord } = await import('./experiment-domain');

      const record = buildExperimentRecord({
        experimentId: 'exp-001',
        storeId: 'jf-us',
        name: 'Test',
        hypothesis: { statement: 'Test', expectedEffect: 'Effect' },
        productIds: [],
        entityIds: [],
      });

      const invalidRecord = { ...record, updatedAt: 'invalid-date' };
      expect(() => validateExperimentRecord(invalidRecord)).toThrow('Invalid timestamp');
    });
  });

  describe('validateExperimentSnapshot', () => {
    it('accepts valid snapshot', async () => {
      const { validateExperimentSnapshot, buildExperimentSnapshot } = await import('./experiment-domain');

      const snapshot = buildExperimentSnapshot({
        snapshotId: 'snap-001',
        experimentId: 'exp-001',
        snapshotType: 'baseline',
        data: baseMetrics,
        dataSource: 'formal-business-data',
        proofHash: 'abc123',
      });

      expect(() => validateExperimentSnapshot(snapshot)).not.toThrow();
    });

    it('rejects missing required fields', async () => {
      const { validateExperimentSnapshot, buildExperimentSnapshot } = await import('./experiment-domain');

      const snapshot = buildExperimentSnapshot({
        snapshotId: '',
        experimentId: 'exp-001',
        snapshotType: 'baseline',
        data: baseMetrics,
        dataSource: 'test',
        proofHash: 'abc',
      });

      expect(() => validateExperimentSnapshot(snapshot)).toThrow('Snapshot ID is required');
    });
  });

  describe('buildExperimentRecord', () => {
    it('builds experiment with draft status', async () => {
      const { buildExperimentRecord } = await import('./experiment-domain');

      const record = buildExperimentRecord({
        experimentId: 'exp-001',
        storeId: 'jf-us',
        name: 'Bid Reduction Test',
        description: 'Testing bid optimization',
        hypothesis: {
          statement: 'Lower bids reduce ACOS',
          expectedEffect: 'ACOS -10%',
          expectedChangePercent: -10,
          confidenceLevel: 0.8,
        },
        productIds: ['prod-001'],
        entityIds: ['kw-001'],
        guardrails: [],
        missionId: 'mission-001',
      });

      expect(record.status).toBe('draft');
      expect(record.revision).toBe(1);
      expect(record.guardrailsTriggered).toEqual([]);
      expect(record.observationSnapshots).toEqual([]);
      expect(record.createdAt).toBeDefined();
    });
  });

  describe('buildExperimentSnapshot', () => {
    it('builds snapshot with current timestamp', async () => {
      const { buildExperimentSnapshot } = await import('./experiment-domain');

      const snapshot = buildExperimentSnapshot({
        snapshotId: 'snap-001',
        experimentId: 'exp-001',
        snapshotType: 'observation',
        data: baseMetrics,
        dataSource: 'formal-business-data',
        proofHash: 'sha256-abc123',
      });

      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.snapshotType).toBe('observation');
      expect(snapshot.data).toEqual(baseMetrics);
    });
  });

  describe('isExperimentTerminal', () => {
    it('identifies terminal statuses', async () => {
      const { isExperimentTerminal } = await import('./experiment-domain');

      expect(isExperimentTerminal('completed')).toBe(true);
      expect(isExperimentTerminal('archived')).toBe(true);
    });

    it('identifies non-terminal statuses', async () => {
      const { isExperimentTerminal } = await import('./experiment-domain');

      expect(isExperimentTerminal('draft')).toBe(false);
      expect(isExperimentTerminal('running')).toBe(false);
      expect(isExperimentTerminal('paused')).toBe(false);
      expect(isExperimentTerminal('blocked')).toBe(false);
    });
  });

  describe('calculatePercentChange', () => {
    it('calculates positive percent change', async () => {
      const { calculatePercentChange } = await import('./experiment-domain');

      expect(calculatePercentChange(100, 150)).toBe(50);
    });

    it('calculates negative percent change', async () => {
      const { calculatePercentChange } = await import('./experiment-domain');

      expect(calculatePercentChange(200, 100)).toBe(-50);
    });

    it('handles zero baseline', async () => {
      const { calculatePercentChange } = await import('./experiment-domain');

      expect(calculatePercentChange(0, 100)).toBe(0);
    });
  });
});
