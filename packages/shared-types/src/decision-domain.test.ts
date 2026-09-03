/**
 * Decision Domain Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  isValidStatusTransition,
  STATUS_LABELS,
  ACTION_TYPE_LABELS,
  ENTITY_TYPE_LABELS,
  VALID_STATUS_TRANSITIONS,
  validateDecisionRecord,
  validateCreateDecisionInput,
  decisionRowToRecord,
  decisionRecordToRow,
  buildDecisionRecord,
  buildHistoryEntry,
  isDecisionTerminal,
  getDecisionProvenanceChain,
  type DecisionStatus,
} from './decision-domain';

const NOW = '2026-09-03T12:00:00.000Z';

const MINIMAL_RECORD = {
  decisionId: 'dec-001',
  storeId: 'jf-us',
  marketplace: 'US' as const,
  currency: 'USD' as const,
  missionId: 'mission-001',
  missionRevision: 1,
  analysisRunId: 'run-001',
  batchId: 'batch-001',
  recommendationId: 'rec-001',
  actionType: 'adjust_keyword_bid',
  entityType: 'keyword',
  entityId: 'kw-001',
  status: 'proposed' as DecisionStatus,
  issuer: 'human_operator' as const,
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

describe('DecisionDomain', () => {
  describe('isValidStatusTransition', () => {
    it('allows proposed to needs_approval, blocked, superseded', () => {
      expect(isValidStatusTransition('proposed', 'needs_approval')).toBe(true);
      expect(isValidStatusTransition('proposed', 'blocked')).toBe(true);
      expect(isValidStatusTransition('proposed', 'superseded')).toBe(true);
    });

    it('allows needs_approval to approved, rejected, blocked', () => {
      expect(isValidStatusTransition('needs_approval', 'approved')).toBe(true);
      expect(isValidStatusTransition('needs_approval', 'rejected')).toBe(true);
      expect(isValidStatusTransition('needs_approval', 'blocked')).toBe(true);
    });

    it('allows approved to executed', () => {
      expect(isValidStatusTransition('approved', 'executed')).toBe(true);
    });

    it('allows executed to verified', () => {
      expect(isValidStatusTransition('executed', 'verified')).toBe(true);
    });

    it('disallows backward transitions', () => {
      expect(isValidStatusTransition('approved', 'proposed')).toBe(false);
      expect(isValidStatusTransition('rejected', 'proposed')).toBe(false);
    });

    it('verified is terminal', () => {
      expect(VALID_STATUS_TRANSITIONS.verified).toEqual([]);
    });

    it('superseded is terminal', () => {
      expect(VALID_STATUS_TRANSITIONS.superseded).toEqual([]);
    });

    it('disallows skipping states', () => {
      expect(isValidStatusTransition('proposed', 'executed')).toBe(false);
      expect(isValidStatusTransition('proposed', 'verified')).toBe(false);
    });
  });

  describe('STATUS_LABELS', () => {
    it('provides Chinese label for each status', () => {
      expect(STATUS_LABELS.proposed).toBe('已提议');
      expect(STATUS_LABELS.needs_approval).toBe('待审批');
      expect(STATUS_LABELS.approved).toBe('已批准');
      expect(STATUS_LABELS.rejected).toBe('已拒绝');
      expect(STATUS_LABELS.blocked).toBe('已阻断');
      expect(STATUS_LABELS.superseded).toBe('已替代');
      expect(STATUS_LABELS.executed).toBe('已执行');
      expect(STATUS_LABELS.verified).toBe('已验证');
    });
  });

  describe('ACTION_TYPE_LABELS', () => {
    it('provides Chinese label for known action types', () => {
      expect(ACTION_TYPE_LABELS.adjust_keyword_bid).toBe('调整关键词竞价');
      expect(ACTION_TYPE_LABELS.pause_keyword).toBe('暂停关键词');
      expect(ACTION_TYPE_LABELS.adjust_campaign_budget).toBe('调整活动预算');
    });
  });

  describe('ENTITY_TYPE_LABELS', () => {
    it('provides Chinese label for known entity types', () => {
      expect(ENTITY_TYPE_LABELS.keyword).toBe('关键词');
      expect(ENTITY_TYPE_LABELS.campaign).toBe('活动');
      expect(ENTITY_TYPE_LABELS.ad_group).toBe('广告组');
    });
  });

  describe('VALID_STATUS_TRANSITIONS coverage', () => {
    it('has transitions defined for all non-terminal statuses', () => {
      const allStatuses: DecisionStatus[] = [
        'proposed', 'needs_approval', 'approved', 'rejected',
        'blocked', 'superseded', 'executed', 'verified'
      ];
      // All statuses should be present in the map
      for (const status of allStatuses) {
        expect(VALID_STATUS_TRANSITIONS[status]).toBeDefined();
      }
    });
  });

  // ─── Validation tests ───────────────────────────────────────────────

  describe('validateDecisionRecord', () => {
    it('accepts a valid minimal record', () => {
      expect(() => validateDecisionRecord(MINIMAL_RECORD)).not.toThrow();
    });

    it('rejects missing decisionId', () => {
      expect(() => validateDecisionRecord({ ...MINIMAL_RECORD, decisionId: '' }))
        .toThrow('decision.decisionId is required');
    });

    it('rejects non-US marketplace', () => {
      expect(() => validateDecisionRecord({ ...MINIMAL_RECORD, marketplace: 'UK' as 'US' }))
        .toThrow('Decision is limited to US marketplace');
    });

    it('rejects non-USD currency', () => {
      expect(() => validateDecisionRecord({ ...MINIMAL_RECORD, currency: 'CNY' as 'USD' }))
        .toThrow('Decision is limited to USD currency');
    });

    it('rejects missing analysisRunId', () => {
      expect(() => validateDecisionRecord({ ...MINIMAL_RECORD, analysisRunId: '' }))
        .toThrow('decision.analysisRunId is required');
    });

    it('rejects invalid status', () => {
      expect(() => validateDecisionRecord({ ...MINIMAL_RECORD, status: 'invalid' as DecisionStatus }))
        .toThrow('Unsupported decision status');
    });

    it('rejects invalid issuer', () => {
      expect(() => validateDecisionRecord({ ...MINIMAL_RECORD, issuer: 'invalid' as 'human_operator' }))
        .toThrow('Unsupported decision issuer');
    });

    it('rejects invalid verification result', () => {
      expect(() => validateDecisionRecord({ ...MINIMAL_RECORD, verificationResult: 'maybe' as 'success' }))
        .toThrow('Unsupported verification result');
    });

    it('rejects createdAt after updatedAt', () => {
      expect(() => validateDecisionRecord({
        ...MINIMAL_RECORD,
        createdAt: '2026-09-04T12:00:00.000Z',
        updatedAt: '2026-09-03T12:00:00.000Z',
      })).toThrow('decision.createdAt must not be after decision.updatedAt');
    });

    it('accepts optional approval fields', () => {
      expect(() => validateDecisionRecord({
        ...MINIMAL_RECORD,
        status: 'approved',
        approvedAt: NOW,
        approvedBy: 'operator-001',
      })).not.toThrow();
    });

    it('accepts optional execution/verification fields', () => {
      expect(() => validateDecisionRecord({
        ...MINIMAL_RECORD,
        status: 'verified',
        executedAt: NOW,
        verifiedAt: NOW,
        verificationResult: 'success',
      })).not.toThrow();
    });
  });

  describe('validateCreateDecisionInput', () => {
    const minimalInput = {
      storeId: 'jf-us',
      marketplace: 'US' as const,
      currency: 'USD' as const,
      missionId: 'mission-001',
      missionRevision: 1,
      analysisRunId: 'run-001',
      batchId: 'batch-001',
      recommendationId: 'rec-001',
      actionType: 'adjust_keyword_bid',
      entityType: 'keyword',
      entityId: 'kw-001',
    };

    it('accepts a valid minimal input', () => {
      expect(() => validateCreateDecisionInput(minimalInput)).not.toThrow();
    });

    it('rejects non-US marketplace', () => {
      expect(() => validateCreateDecisionInput({ ...minimalInput, marketplace: 'UK' as 'US' }))
        .toThrow('Decision is limited to US marketplace');
    });

    it('rejects missing missionId', () => {
      expect(() => validateCreateDecisionInput({ ...minimalInput, missionId: '' }))
        .toThrow('createDecision.missionId is required');
    });

    it('accepts optional fields', () => {
      expect(() => validateCreateDecisionInput({
        ...minimalInput,
        currentValue: '1.50',
        targetValue: '1.20',
        changeReason: 'Lower ACOS',
      })).not.toThrow();
    });
  });

  // ─── Mapper tests ───────────────────────────────────────────────────

  describe('decisionRowToRecord', () => {
    it('converts a full row to a domain record', () => {
      const row = {
        decision_id: 'dec-001',
        store_id: 'jf-us',
        marketplace: 'US',
        currency: 'USD',
        mission_id: 'mission-001',
        mission_revision: 3,
        analysis_run_id: 'run-001',
        batch_id: 'batch-001',
        recommendation_id: 'rec-001',
        action_type: 'lower_bid',
        entity_type: 'keyword',
        entity_id: 'kw-001',
        current_value: '1.50',
        target_value: '1.20',
        change_reason: 'Reduce ACOS',
        status: 'needs_approval',
        issuer: 'policy_runtime',
        revision: 2,
        approved_at: null,
        approved_by: null,
        rejection_reason: null,
        superseded_by: null,
        supersedes: null,
        executed_at: null,
        execution_evidence: null,
        verified_at: null,
        verification_result: null,
        created_at: NOW,
        updated_at: NOW,
        metadata: null,
      };
      const record = decisionRowToRecord(row);
      expect(record.decisionId).toBe('dec-001');
      expect(record.missionRevision).toBe(3);
      expect(record.status).toBe('needs_approval');
      expect(record.issuer).toBe('policy_runtime');
      expect(record.currentValue).toBe('1.50');
      expect(record.targetValue).toBe('1.20');
      expect(record.metadata).toBeUndefined();
    });

    it('defaults marketplace and currency to US/USD', () => {
      const row = {
        decision_id: 'dec-001', store_id: 'jf-us',
        mission_id: 'mission-001', mission_revision: 1,
        analysis_run_id: 'run-001', batch_id: 'batch-001', recommendation_id: 'rec-001',
        action_type: 'lower_bid', entity_type: 'keyword', entity_id: 'kw-001',
        current_value: null, target_value: null, change_reason: null,
        status: 'proposed', issuer: 'human_operator', revision: 1,
        approved_at: null, approved_by: null, rejection_reason: null,
        superseded_by: null, supersedes: null,
        executed_at: null, execution_evidence: null,
        verified_at: null, verification_result: null,
        created_at: NOW, updated_at: NOW, metadata: null,
      };
      const record = decisionRowToRecord(row);
      expect(record.marketplace).toBe('US');
      expect(record.currency).toBe('USD');
    });

    it('parses metadata JSON', () => {
      const row = {
        decision_id: 'dec-001', store_id: 'jf-us',
        marketplace: 'US', currency: 'USD',
        mission_id: 'mission-001', mission_revision: 1,
        analysis_run_id: 'run-001', batch_id: 'batch-001', recommendation_id: 'rec-001',
        action_type: 'lower_bid', entity_type: 'keyword', entity_id: 'kw-001',
        current_value: null, target_value: null, change_reason: null,
        status: 'proposed', issuer: 'human_operator', revision: 1,
        approved_at: null, approved_by: null, rejection_reason: null,
        superseded_by: null, supersedes: null,
        executed_at: null, execution_evidence: null,
        verified_at: null, verification_result: null,
        created_at: NOW, updated_at: NOW,
        metadata: '{"aiModel":"gpt-4o","confidence":0.95}',
      };
      const record = decisionRowToRecord(row);
      expect(record.metadata).toEqual({ aiModel: 'gpt-4o', confidence: 0.95 });
    });
  });

  describe('decisionRecordToRow', () => {
    it('converts a domain record to a row', () => {
      const record = {
        ...MINIMAL_RECORD,
        status: 'approved' as const,
        approvedAt: NOW,
        approvedBy: 'op-001',
        currentValue: '2.00',
        targetValue: '1.80',
      };
      const row = decisionRecordToRow(record);
      expect(row.status).toBe('approved');
      expect(row.approved_at).toBe(NOW);
      expect(row.approved_by).toBe('op-001');
      expect(row.current_value).toBe('2.00');
      expect(row.target_value).toBe('1.80');
      expect(row.metadata).toBeNull();
    });

    it('round-trips through row and back', () => {
      const record = {
        ...MINIMAL_RECORD,
        status: 'executed' as const,
        executedAt: NOW,
        executionEvidence: '/evidence/run-001',
      };
      const row = decisionRecordToRow(record);
      const roundTrip = decisionRowToRecord(row);
      expect(roundTrip.decisionId).toBe(record.decisionId);
      expect(roundTrip.status).toBe(record.status);
      expect(roundTrip.executedAt).toBe(record.executedAt);
      expect(roundTrip.executionEvidence).toBe(record.executionEvidence);
    });
  });

  // ─── Builder tests ──────────────────────────────────────────────────

  describe('buildDecisionRecord', () => {
    it('creates a proposed decision with revision 1', () => {
      const input = {
        storeId: 'jf-us',
        marketplace: 'US' as const,
        currency: 'USD' as const,
        missionId: 'mission-001',
        missionRevision: 2,
        analysisRunId: 'run-001',
        batchId: 'batch-001',
        recommendationId: 'rec-001',
        actionType: 'raise_bid',
        entityType: 'keyword',
        entityId: 'kw-002',
        currentValue: '0.50',
        targetValue: '0.75',
        changeReason: 'Scale high performer',
      };
      const record = buildDecisionRecord(input, 'dec-new', NOW);
      expect(record.decisionId).toBe('dec-new');
      expect(record.status).toBe('proposed');
      expect(record.issuer).toBe('human_operator');
      expect(record.revision).toBe(1);
      expect(record.currentValue).toBe('0.50');
      expect(record.targetValue).toBe('0.75');
      expect(record.createdAt).toBe(NOW);
      expect(record.updatedAt).toBe(NOW);
    });
  });

  describe('buildHistoryEntry', () => {
    it('creates a history entry with correct fields', () => {
      const entry = buildHistoryEntry(
        'dec-001', 'entry-001', 'proposed', 'needs_approval', 'system',
        'AI confidence threshold met',
      );
      expect(entry.entryId).toBe('entry-001');
      expect(entry.decisionId).toBe('dec-001');
      expect(entry.fromStatus).toBe('proposed');
      expect(entry.toStatus).toBe('needs_approval');
      expect(entry.triggeredBy).toBe('system');
      expect(entry.reason).toBe('AI confidence threshold met');
      expect(entry.timestamp).toBeTruthy();
    });
  });

  // ─── Helper function tests ─────────────────────────────────────────

  describe('isDecisionTerminal', () => {
    it('returns true for verified', () => {
      expect(isDecisionTerminal({ ...MINIMAL_RECORD, status: 'verified' })).toBe(true);
    });

    it('returns true for superseded', () => {
      expect(isDecisionTerminal({ ...MINIMAL_RECORD, status: 'superseded' })).toBe(true);
    });

    it('returns false for proposed', () => {
      expect(isDecisionTerminal(MINIMAL_RECORD)).toBe(false);
    });

    it('returns false for approved', () => {
      expect(isDecisionTerminal({ ...MINIMAL_RECORD, status: 'approved' })).toBe(false);
    });
  });

  describe('getDecisionProvenanceChain', () => {
    it('formats provenance chain', () => {
      const chain = getDecisionProvenanceChain({
        ...MINIMAL_RECORD,
        missionId: 'mission-abc',
        missionRevision: 5,
        analysisRunId: 'run-xyz',
        decisionId: 'dec-123',
      });
      expect(chain).toBe('mission-abc@r5 → run-xyz → dec-123');
    });
  });
});
