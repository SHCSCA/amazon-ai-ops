/**
 * Execution Domain Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  isSlotStatusTerminal,
  isBatchTerminal,
  verifyReadbackMatch,
  validateExecutionSlot,
  validateExecutionBatch,
  validateReconciliationCase,
  validateExecutionRecord,
  buildExecutionSlot,
  buildExecutionBatch,
  buildReconciliationCase,
  checkPreflightGates,
  SLOT_STATUS_LABELS,
  BATCH_STATUS_LABELS,
  RECONCILIATION_OUTCOME_LABELS,
  PREFLIGHT_GATE_LABELS,
  type ExecutionSlot,
  type ExecutionBatch,
  type ReconciliationCase,
  type ExecutionRecord,
  type ExecutionIntent,
} from './execution-domain';

const NOW = '2026-09-03T17:00:00.000Z';

const minimalIntent: ExecutionIntent = {
  grantId: 'grant-001',
  decisionId: 'dec-001',
  actionType: 'adjust_keyword_bid',
  entityId: 'kw-001',
  targetValue: '1.20',
  idempotencyKey: 'idem-001',
};

const minimalSlot: ExecutionSlot = {
  slotId: 'slot-001',
  grantId: 'grant-001',
  decisionId: 'dec-001',
  batchId: 'batch-001',
  intent: minimalIntent,
  status: 'pending',
  expectedBefore: '1.50',
  expectedAfter: '1.20',
  createdAt: NOW,
  updatedAt: NOW,
};

const minimalBatch: ExecutionBatch = {
  batchId: 'batch-001',
  grantId: 'grant-001',
  missionId: 'mission-001',
  storeId: 'jf-us',
  slotIds: ['slot-001', 'slot-002'],
  status: 'running',
  pendingCount: 2,
  submittedCount: 0,
  verifiedCount: 0,
  failedCount: 0,
  unknownCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

const minimalCase: ReconciliationCase = {
  caseId: 'case-001',
  slotId: 'slot-001',
  batchId: 'batch-001',
  createdAt: NOW,
};

const minimalExecution: ExecutionRecord = {
  executionId: 'exec-001',
  storeId: 'jf-us',
  grantId: 'grant-001',
  slotIndex: 0,
  entityId: 'kw-001',
  entityType: 'keyword',
  actionType: 'adjust_bid',
  actionPayload: { newBid: 1.20 },
  sessionGeneration: 1,
  adsAccountId: 'ads-123',
  status: 'reserved',
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

describe('ExecutionDomain', () => {
  describe('isSlotStatusTerminal', () => {
    it('returns true for terminal statuses', () => {
      expect(isSlotStatusTerminal('verified')).toBe(true);
      expect(isSlotStatusTerminal('failed')).toBe(true);
      expect(isSlotStatusTerminal('unknown')).toBe(true);
    });

    it('returns false for non-terminal statuses', () => {
      expect(isSlotStatusTerminal('pending')).toBe(false);
      expect(isSlotStatusTerminal('preflight_blocked')).toBe(false);
      expect(isSlotStatusTerminal('submit_intent_recorded')).toBe(false);
      expect(isSlotStatusTerminal('submitted')).toBe(false);
    });
  });

  describe('isBatchTerminal', () => {
    it('returns true for terminal statuses', () => {
      expect(isBatchTerminal('completed')).toBe(true);
      expect(isBatchTerminal('stopped_invalidated')).toBe(true);
      expect(isBatchTerminal('stopped_unknown')).toBe(true);
    });

    it('returns false for running', () => {
      expect(isBatchTerminal('running')).toBe(false);
    });
  });

  describe('verifyReadbackMatch', () => {
    it('matches numeric values exactly by default', () => {
      expect(verifyReadbackMatch('1.50', '1.50')).toBe(true);
      expect(verifyReadbackMatch('1.50', '1.51')).toBe(false);
    });

    it('allows tolerance for numeric values', () => {
      expect(verifyReadbackMatch('1.50', '1.55', 5)).toBe(true); // 5% tolerance
      expect(verifyReadbackMatch('1.50', '1.60', 5)).toBe(false); // > 5%
    });

    it('falls back to string comparison for non-numeric', () => {
      expect(verifyReadbackMatch('enabled', 'enabled')).toBe(true);
      expect(verifyReadbackMatch('enabled', 'disabled')).toBe(false);
    });

    it('handles mixed numeric/string gracefully', () => {
      expect(verifyReadbackMatch('1.5', '1.50')).toBe(true); // Parsed as numbers
      expect(verifyReadbackMatch('abc', '1.5')).toBe(false);
    });
  });

  describe('validateExecutionSlot', () => {
    it('accepts valid minimal slot', () => {
      expect(() => validateExecutionSlot(minimalSlot)).not.toThrow();
    });

    it('rejects missing slotId', () => {
      expect(() => validateExecutionSlot({ ...minimalSlot, slotId: '' }))
        .toThrow('Slot ID is required');
    });

    it('rejects missing grantId', () => {
      expect(() => validateExecutionSlot({ ...minimalSlot, grantId: '' }))
        .toThrow('Grant ID is required');
    });

    it('rejects missing intent', () => {
      expect(() => validateExecutionSlot({ ...minimalSlot, intent: null as any }))
        .toThrow('Intent is required');
    });

    it('rejects invalid timestamps', () => {
      expect(() => validateExecutionSlot({ ...minimalSlot, createdAt: 'invalid' }))
        .toThrow('Invalid timestamp format');
    });

    it('rejects updatedAt before createdAt', () => {
      expect(() => validateExecutionSlot({
        ...minimalSlot,
        createdAt: '2026-09-03T18:00:00.000Z',
        updatedAt: '2026-09-03T17:00:00.000Z',
      })).toThrow('Updated timestamp cannot be before created timestamp');
    });

    it('accepts all optional fields', () => {
      const fullSlot: ExecutionSlot = {
        ...minimalSlot,
        expectedChangePercent: 20,
        beforeEvidencePath: '/evidence/before.png',
        afterEvidencePath: '/evidence/after.png',
        reloadEvidencePath: '/evidence/reload.png',
        readbackBeforeValue: '1.50',
        readbackAfterValue: '1.20',
        readbackReloadValue: '1.20',
        verifiedAt: NOW,
        verificationResult: 'success',
        reconciliationCaseId: 'case-001',
        reconciliationOutcome: 'target_stably_observed',
        submittedAt: NOW,
      };
      expect(() => validateExecutionSlot(fullSlot)).not.toThrow();
    });
  });

  describe('validateExecutionBatch', () => {
    it('accepts valid minimal batch', () => {
      expect(() => validateExecutionBatch(minimalBatch)).not.toThrow();
    });

    it('rejects missing batchId', () => {
      expect(() => validateExecutionBatch({ ...minimalBatch, batchId: '' }))
        .toThrow('Batch ID is required');
    });

    it('rejects non-array slotIds', () => {
      expect(() => validateExecutionBatch({ ...minimalBatch, slotIds: null as any }))
        .toThrow('Slot IDs must be an array');
    });

    it('rejects mismatched slot counts', () => {
      expect(() => validateExecutionBatch({
        ...minimalBatch,
        slotIds: ['slot-001', 'slot-002', 'slot-003'],
        pendingCount: 2, // Should be 3
      })).toThrow('Slot counts do not match slot IDs array length');
    });

    it('accepts matching slot counts', () => {
      const batch: ExecutionBatch = {
        ...minimalBatch,
        slotIds: ['s1', 's2', 's3'],
        pendingCount: 1,
        submittedCount: 1,
        verifiedCount: 1,
        failedCount: 0,
        unknownCount: 0,
      };
      expect(() => validateExecutionBatch(batch)).not.toThrow();
    });
  });

  describe('validateReconciliationCase', () => {
    it('accepts valid minimal case', () => {
      expect(() => validateReconciliationCase(minimalCase)).not.toThrow();
    });

    it('rejects missing caseId', () => {
      expect(() => validateReconciliationCase({ ...minimalCase, caseId: '' }))
        .toThrow('Case ID is required');
    });

    it('rejects invalid createdAt', () => {
      expect(() => validateReconciliationCase({ ...minimalCase, createdAt: 'bad' }))
        .toThrow('Invalid created timestamp format');
    });

    it('accepts full case with observations', () => {
      const fullCase: ReconciliationCase = {
        ...minimalCase,
        observation1Timestamp: NOW,
        observation1Value: '1.50',
        observation2Timestamp: NOW,
        observation2Value: '1.50',
        outcome: 'original_stably_observed',
        resolvedAt: NOW,
        resolutionNotes: 'Value did not change',
      };
      expect(() => validateReconciliationCase(fullCase)).not.toThrow();
    });
  });

  describe('validateExecutionRecord', () => {
    it('accepts valid minimal execution', () => {
      expect(() => validateExecutionRecord(minimalExecution)).not.toThrow();
    });

    it('rejects missing executionId', () => {
      expect(() => validateExecutionRecord({ ...minimalExecution, executionId: '' }))
        .toThrow('Execution ID is required');
    });

    it('rejects invalid entityType', () => {
      expect(() => validateExecutionRecord({ ...minimalExecution, entityType: 'invalid' as any }))
        .toThrow('Invalid entity type');
    });

    it('rejects negative slotIndex', () => {
      expect(() => validateExecutionRecord({ ...minimalExecution, slotIndex: -1 }))
        .toThrow('Slot index must be non-negative number');
    });

    it('rejects invalid status', () => {
      expect(() => validateExecutionRecord({ ...minimalExecution, status: 'invalid' as any }))
        .toThrow('Invalid execution status');
    });

    it('requires submittedBy/At for submitted status', () => {
      expect(() => validateExecutionRecord({ ...minimalExecution, status: 'submitted' }))
        .toThrow('Submitted executions must have submittedBy and submittedAt');
    });

    it('requires verifiedBy/At for verified status', () => {
      const submitted = {
        ...minimalExecution,
        status: 'verified' as const,
        submittedBy: 'op-001',
        submittedAt: NOW,
      };
      expect(() => validateExecutionRecord(submitted))
        .toThrow('Verified executions must have verifiedBy and verifiedAt');
    });

    it('accepts full verified execution', () => {
      const verified: ExecutionRecord = {
        ...minimalExecution,
        status: 'verified',
        submittedBy: 'op-001',
        submittedAt: NOW,
        beforeEvidence: { screenshotPaths: ['/before.png'] },
        verifiedBy: 'op-002',
        verifiedAt: NOW,
        afterEvidence: { screenshotPaths: ['/after.png'] },
      };
      expect(() => validateExecutionRecord(verified)).not.toThrow();
    });

    it('rejects createdAt after updatedAt', () => {
      expect(() => validateExecutionRecord({
        ...minimalExecution,
        createdAt: '2026-09-03T18:00:00.000Z',
        updatedAt: '2026-09-03T17:00:00.000Z',
      })).toThrow('createdAt cannot be after updatedAt');
    });
  });

  describe('buildExecutionSlot', () => {
    it('builds a pending slot', () => {
      const slot = buildExecutionSlot({
        slotId: 'slot-new',
        grantId: 'grant-001',
        decisionId: 'dec-001',
        batchId: 'batch-001',
        intent: minimalIntent,
        expectedBefore: '2.00',
        expectedAfter: '1.80',
        expectedChangePercent: 10,
      });

      expect(slot.slotId).toBe('slot-new');
      expect(slot.status).toBe('pending');
      expect(slot.expectedBefore).toBe('2.00');
      expect(slot.expectedAfter).toBe('1.80');
      expect(slot.expectedChangePercent).toBe(10);
      expect(slot.createdAt).toBeTruthy();
      expect(slot.updatedAt).toBeTruthy();
    });
  });

  describe('buildExecutionBatch', () => {
    it('builds a running batch', () => {
      const batch = buildExecutionBatch({
        batchId: 'batch-new',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slotIds: ['s1', 's2', 's3'],
      });

      expect(batch.batchId).toBe('batch-new');
      expect(batch.status).toBe('running');
      expect(batch.slotIds).toEqual(['s1', 's2', 's3']);
      expect(batch.pendingCount).toBe(3);
      expect(batch.submittedCount).toBe(0);
      expect(batch.createdAt).toBeTruthy();
    });
  });

  describe('buildReconciliationCase', () => {
    it('builds a new case', () => {
      const rc = buildReconciliationCase({
        caseId: 'case-new',
        slotId: 'slot-001',
        batchId: 'batch-001',
      });

      expect(rc.caseId).toBe('case-new');
      expect(rc.slotId).toBe('slot-001');
      expect(rc.createdAt).toBeTruthy();
      expect(rc.outcome).toBeUndefined();
    });
  });

  describe('checkPreflightGates', () => {
    it('passes when all gates pass', () => {
      const result = checkPreflightGates({
        killSwitch: false,
        circuitBreakerTriggered: false,
        contextMatches: true,
        revisionMatches: true,
        grantValid: true,
        scopeMatches: true,
        evidencePresent: true,
      });

      expect(result.passed).toBe(true);
      expect(result.blockedGates).toEqual([]);
      expect(result.message).toContain('所有预检门禁通过');
    });

    it('blocks on kill switch', () => {
      const result = checkPreflightGates({
        killSwitch: true,
        circuitBreakerTriggered: false,
        contextMatches: true,
        revisionMatches: true,
        grantValid: true,
        scopeMatches: true,
        evidencePresent: true,
      });

      expect(result.passed).toBe(false);
      expect(result.blockedGates).toContain('P0_KILL_SWITCH');
      expect(result.message).toContain('总开关已关闭');
    });

    it('blocks on multiple gates', () => {
      const result = checkPreflightGates({
        killSwitch: false,
        circuitBreakerTriggered: true,
        contextMatches: false,
        revisionMatches: true,
        grantValid: false,
        scopeMatches: true,
        evidencePresent: true,
      });

      expect(result.passed).toBe(false);
      expect(result.blockedGates).toHaveLength(3);
      expect(result.blockedGates).toContain('P1_CIRCUIT_BREAKER');
      expect(result.blockedGates).toContain('P2_CONTEXT_MISMATCH');
      expect(result.blockedGates).toContain('P4_GRANT_INVALID');
    });

    it('checks all seven gates', () => {
      const result = checkPreflightGates({
        killSwitch: true,
        circuitBreakerTriggered: true,
        contextMatches: false,
        revisionMatches: false,
        grantValid: false,
        scopeMatches: false,
        evidencePresent: false,
      });

      expect(result.blockedGates).toHaveLength(7);
      expect(result.blockedGates).toContain('P0_KILL_SWITCH');
      expect(result.blockedGates).toContain('P1_CIRCUIT_BREAKER');
      expect(result.blockedGates).toContain('P2_CONTEXT_MISMATCH');
      expect(result.blockedGates).toContain('P3_REVISION_MISMATCH');
      expect(result.blockedGates).toContain('P4_GRANT_INVALID');
      expect(result.blockedGates).toContain('P5_SCOPE_MISMATCH');
      expect(result.blockedGates).toContain('P6_EVIDENCE_REQUIRED');
    });
  });

  describe('Labels', () => {
    it('provides Chinese labels for slot statuses', () => {
      expect(SLOT_STATUS_LABELS.pending).toBe('等待提交');
      expect(SLOT_STATUS_LABELS.preflight_blocked).toBe('预检阻断');
      expect(SLOT_STATUS_LABELS.submitted).toBe('已提交');
      expect(SLOT_STATUS_LABELS.verified).toBe('已验证');
      expect(SLOT_STATUS_LABELS.unknown).toBe('结果未知');
    });

    it('provides Chinese labels for batch statuses', () => {
      expect(BATCH_STATUS_LABELS.running).toBe('执行中');
      expect(BATCH_STATUS_LABELS.completed).toBe('已完成');
      expect(BATCH_STATUS_LABELS.stopped_unknown).toBe('已停止(未知)');
    });

    it('provides Chinese labels for reconciliation outcomes', () => {
      expect(RECONCILIATION_OUTCOME_LABELS.target_stably_observed).toBe('目标值已稳定');
      expect(RECONCILIATION_OUTCOME_LABELS.original_stably_observed).toBe('原值仍有效');
      expect(RECONCILIATION_OUTCOME_LABELS.other_value).toBe('观察到其他值');
      expect(RECONCILIATION_OUTCOME_LABELS.inconclusive_permanent).toBe('无法确定(永久未知)');
    });

    it('provides Chinese labels for preflight gates', () => {
      expect(PREFLIGHT_GATE_LABELS.P0_KILL_SWITCH).toBe('总开关已关闭');
      expect(PREFLIGHT_GATE_LABELS.P1_CIRCUIT_BREAKER).toBe('熔断器已触发');
      expect(PREFLIGHT_GATE_LABELS.P6_EVIDENCE_REQUIRED).toBe('缺少必要证据');
    });
  });
});
