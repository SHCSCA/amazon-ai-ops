/**
 * V1.6 Decision Service Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DecisionService, DecisionServiceError } from './v16-decision-service';
import type { CreateDecisionInput } from '@amazon-ai-ops/shared-types';

describe('DecisionService', () => {
  let db: Database.Database;
  let service: DecisionService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create schema_migrations table
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('started', 'applied', 'failed')),
        started_at TEXT NOT NULL,
        applied_at TEXT,
        error_message TEXT,
        manifest_json TEXT,
        result_json TEXT
      );
    `);

    // Create minimal stores table for FK constraint
    db.exec(`
      CREATE TABLE stores (
        store_id TEXT PRIMARY KEY,
        store_name TEXT NOT NULL,
        marketplace TEXT NOT NULL,
        currency TEXT NOT NULL
      );
      INSERT INTO stores (store_id, store_name, marketplace, currency)
      VALUES ('jf-us', 'JF-US', 'US', 'USD');
    `);

    // Directly create decisions_v16 and decision_history_v16 tables
    db.exec(`
      CREATE TABLE decisions_v16 (
        decision_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        marketplace TEXT NOT NULL DEFAULT 'US',
        currency TEXT NOT NULL DEFAULT 'USD',
        mission_id TEXT NOT NULL,
        mission_revision INTEGER NOT NULL,
        analysis_run_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        recommendation_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        current_value TEXT,
        target_value TEXT,
        change_reason TEXT,
        status TEXT NOT NULL DEFAULT 'proposed'
          CHECK (status IN ('proposed', 'needs_approval', 'approved', 'rejected', 'blocked', 'superseded', 'executed', 'verified')),
        issuer TEXT NOT NULL
          CHECK (issuer IN ('human_operator', 'policy_runtime')),
        revision INTEGER NOT NULL DEFAULT 1,
        approved_at TEXT,
        approved_by TEXT,
        rejection_reason TEXT,
        superseded_by TEXT,
        supersedes TEXT,
        executed_at TEXT,
        execution_evidence TEXT,
        verified_at TEXT,
        verification_result TEXT
          CHECK (verification_result IS NULL OR verification_result IN ('success', 'failure', 'unknown')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
      );

      CREATE INDEX idx_decisions_v16_store_status
        ON decisions_v16(store_id, status, updated_at DESC, decision_id);
      CREATE INDEX idx_decisions_v16_mission
        ON decisions_v16(store_id, mission_id, created_at DESC);
      CREATE INDEX idx_decisions_v16_analysis_run
        ON decisions_v16(store_id, analysis_run_id, created_at DESC);
      CREATE INDEX idx_decisions_v16_batch
        ON decisions_v16(store_id, batch_id, status);
      CREATE INDEX idx_decisions_v16_entity
        ON decisions_v16(store_id, entity_type, entity_id, created_at DESC);

      CREATE TABLE decision_history_v16 (
        entry_id TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        reason TEXT,
        triggered_by TEXT NOT NULL CHECK (triggered_by IN ('system', 'operator')),
        metadata TEXT
      );

      CREATE INDEX idx_decision_history_v16_decision
        ON decision_history_v16(decision_id, timestamp);
    `);

    service = new DecisionService(db);
  });

  afterEach(() => {
    db.close();
  });

  const minimalInput: CreateDecisionInput = {
    storeId: 'jf-us',
    marketplace: 'US',
    currency: 'USD',
    missionId: 'mission-001',
    missionRevision: 1,
    analysisRunId: 'run-001',
    batchId: 'batch-001',
    recommendationId: 'rec-001',
    actionType: 'adjust_keyword_bid',
    entityType: 'keyword',
    entityId: 'kw-001',
    currentValue: '1.50',
    targetValue: '1.20',
    changeReason: 'Lower ACOS',
  };

  describe('createDecision', () => {
    it('creates a new decision with proposed status', () => {
      const decision = service.createDecision(minimalInput);
      expect(decision.decisionId).toMatch(/^dec-/);
      expect(decision.status).toBe('proposed');
      expect(decision.issuer).toBe('human_operator');
      expect(decision.revision).toBe(1);
      expect(decision.storeId).toBe('jf-us');
      expect(decision.missionId).toBe('mission-001');
      expect(decision.analysisRunId).toBe('run-001');
      expect(decision.actionType).toBe('adjust_keyword_bid');
    });

    it('rejects invalid input', () => {
      expect(() => service.createDecision({ ...minimalInput, missionId: '' }))
        .toThrow(DecisionServiceError);
    });

    it('persists the decision to DB', () => {
      const decision = service.createDecision(minimalInput);
      const retrieved = service.getDecision(decision.decisionId);
      expect(retrieved).toBeTruthy();
      expect(retrieved?.decisionId).toBe(decision.decisionId);
      expect(retrieved?.status).toBe('proposed');
    });
  });

  describe('getDecision', () => {
    it('returns null for non-existent decision', () => {
      expect(service.getDecision('dec-nonexistent')).toBeNull();
    });

    it('returns the decision if it exists', () => {
      const created = service.createDecision(minimalInput);
      const retrieved = service.getDecision(created.decisionId);
      expect(retrieved?.decisionId).toBe(created.decisionId);
    });
  });

  describe('listDecisions', () => {
    it('returns empty array when no decisions exist', () => {
      expect(service.listDecisions('jf-us')).toEqual([]);
    });

    it('lists all decisions for a store', () => {
      service.createDecision(minimalInput);
      service.createDecision({ ...minimalInput, entityId: 'kw-002' });
      const list = service.listDecisions('jf-us');
      expect(list).toHaveLength(2);
    });

    it('respects limit parameter', () => {
      service.createDecision(minimalInput);
      service.createDecision({ ...minimalInput, entityId: 'kw-002' });
      service.createDecision({ ...minimalInput, entityId: 'kw-003' });
      const list = service.listDecisions('jf-us', 2);
      expect(list).toHaveLength(2);
    });
  });

  describe('listByStatus', () => {
    it('filters decisions by status', () => {
      const d1 = service.createDecision(minimalInput);
      service.createDecision({ ...minimalInput, entityId: 'kw-002' });
      
      // Transition one to needs_approval
      service.transitionStatus(d1.decisionId, 'needs_approval', 'system');

      const proposed = service.listByStatus('jf-us', 'proposed');
      const needsApproval = service.listByStatus('jf-us', 'needs_approval');

      expect(proposed).toHaveLength(1);
      expect(needsApproval).toHaveLength(1);
      expect(needsApproval[0].decisionId).toBe(d1.decisionId);
    });
  });

  describe('listByAnalysisRun', () => {
    it('filters decisions by analysis run', () => {
      service.createDecision({ ...minimalInput, analysisRunId: 'run-001' });
      service.createDecision({ ...minimalInput, analysisRunId: 'run-001', entityId: 'kw-002' });
      service.createDecision({ ...minimalInput, analysisRunId: 'run-002', entityId: 'kw-003' });

      const run1 = service.listByAnalysisRun('run-001');
      const run2 = service.listByAnalysisRun('run-002');

      expect(run1).toHaveLength(2);
      expect(run2).toHaveLength(1);
    });
  });

  describe('approveDecision', () => {
    it('approves a needs_approval decision', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');

      const approved = service.approveDecision(
        decision.decisionId,
        'operator-001',
        'Approved after review',
        2, // revision after transition
      );

      expect(approved.status).toBe('approved');
      expect(approved.approvedBy).toBe('operator-001');
      expect(approved.approvedAt).toBeTruthy();
    });

    it('rejects approval without reason', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');

      expect(() => service.approveDecision(decision.decisionId, 'op-001', '', 2))
        .toThrow('Approval reason is required');
    });

    it('rejects approval with wrong revision', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');

      expect(() => service.approveDecision(decision.decisionId, 'op-001', 'Good', 999))
        .toThrow('revision mismatch');
    });

    it('rejects approval of terminal decision', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');
      const approved = service.approveDecision(decision.decisionId, 'op-001', 'OK', 2);
      service.markExecuted(approved.decisionId, '/evidence/001');
      service.markVerified(approved.decisionId, 'success');

      const verified = service.getDecision(approved.decisionId);
      expect(verified?.status).toBe('verified');

      expect(() => service.approveDecision(verified!.decisionId, 'op-002', 'Again', verified!.revision))
        .toThrow('already in terminal state');
    });

    it('appends history entry', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');
      service.approveDecision(decision.decisionId, 'op-001', 'Approved', 2);

      const history = service.getHistory(decision.decisionId);
      expect(history).toHaveLength(2); // transition + approval
      expect(history[1].toStatus).toBe('approved');
      expect(history[1].reason).toBe('Approved');
    });
  });

  describe('rejectDecision', () => {
    it('rejects a needs_approval decision', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');

      const rejected = service.rejectDecision(
        decision.decisionId,
        'operator-001',
        'Insufficient evidence',
        2,
      );

      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReason).toBe('Insufficient evidence');
    });

    it('rejects rejection without reason', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');

      expect(() => service.rejectDecision(decision.decisionId, 'op-001', '', 2))
        .toThrow('Rejection reason is required');
    });

    it('rejects rejection with wrong revision', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');

      expect(() => service.rejectDecision(decision.decisionId, 'op-001', 'Bad', 999))
        .toThrow('revision mismatch');
    });
  });

  describe('supersedeDecision', () => {
    it('supersedes a proposed decision with a new one', () => {
      const old = service.createDecision(minimalInput);
      const newInput = { ...minimalInput, targetValue: '1.10' };

      const result = service.supersedeDecision(
        old.decisionId,
        newInput,
        'Updated target based on new data',
      );

      expect(result.old.status).toBe('superseded');
      expect(result.old.supersededBy).toBe(result.new.decisionId);
      expect(result.new.status).toBe('proposed');
      expect(result.new.supersedes).toBe(old.decisionId);
      expect(result.new.targetValue).toBe('1.10');
    });

    it('cannot supersede approved decision', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');
      service.approveDecision(decision.decisionId, 'op-001', 'OK', 2);

      expect(() => service.supersedeDecision(decision.decisionId, minimalInput, 'Try again'))
        .toThrow('Cannot supersede approved decision');
    });

    it('cannot supersede rejected decision', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');
      service.rejectDecision(decision.decisionId, 'op-001', 'Bad', 2);

      expect(() => service.supersedeDecision(decision.decisionId, minimalInput, 'Retry'))
        .toThrow('Cannot supersede rejected decision');
    });

    it('requires reason', () => {
      const decision = service.createDecision(minimalInput);

      expect(() => service.supersedeDecision(decision.decisionId, minimalInput, ''))
        .toThrow('Supersession reason is required');
    });

    it('is atomic (old marked + new created in transaction)', () => {
      const old = service.createDecision(minimalInput);
      const newInput = { ...minimalInput, targetValue: '1.05' };

      const result = service.supersedeDecision(old.decisionId, newInput, 'Reason');

      // Both should exist
      const oldRetrieved = service.getDecision(old.decisionId);
      const newRetrieved = service.getDecision(result.new.decisionId);

      expect(oldRetrieved?.status).toBe('superseded');
      expect(newRetrieved?.status).toBe('proposed');
      expect(oldRetrieved?.supersededBy).toBe(newRetrieved?.decisionId);
    });
  });

  describe('markExecuted', () => {
    it('marks approved decision as executed', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');
      service.approveDecision(decision.decisionId, 'op-001', 'Good', 2);

      const executed = service.markExecuted(decision.decisionId, '/evidence/exec-001');

      expect(executed.status).toBe('executed');
      expect(executed.executedAt).toBeTruthy();
      expect(executed.executionEvidence).toBe('/evidence/exec-001');
    });

    it('rejects execution of non-approved decision', () => {
      const decision = service.createDecision(minimalInput);

      expect(() => service.markExecuted(decision.decisionId, '/evidence/001'))
        .toThrow('Only approved decisions can be executed');
    });
  });

  describe('markVerified', () => {
    it('marks executed decision as verified', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');
      service.approveDecision(decision.decisionId, 'op-001', 'Good', 2);
      service.markExecuted(decision.decisionId, '/evidence/001');

      const verified = service.markVerified(decision.decisionId, 'success');

      expect(verified.status).toBe('verified');
      expect(verified.verifiedAt).toBeTruthy();
      expect(verified.verificationResult).toBe('success');
    });

    it('rejects verification of non-executed decision', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system');
      service.approveDecision(decision.decisionId, 'op-001', 'OK', 2);

      expect(() => service.markVerified(decision.decisionId, 'success'))
        .toThrow('Only executed decisions can be verified');
    });

    it('accepts all verification results', () => {
      const createAndExecute = () => {
        const d = service.createDecision({ ...minimalInput, entityId: `kw-${Date.now()}` });
        service.transitionStatus(d.decisionId, 'needs_approval', 'system');
        service.approveDecision(d.decisionId, 'op', 'OK', 2);
        service.markExecuted(d.decisionId, '/evidence');
        return d.decisionId;
      };

      const d1 = createAndExecute();
      const d2 = createAndExecute();
      const d3 = createAndExecute();

      expect(service.markVerified(d1, 'success').verificationResult).toBe('success');
      expect(service.markVerified(d2, 'failure').verificationResult).toBe('failure');
      expect(service.markVerified(d3, 'unknown').verificationResult).toBe('unknown');
    });
  });

  describe('getHistory', () => {
    it('returns empty array for new decision', () => {
      const decision = service.createDecision(minimalInput);
      const history = service.getHistory(decision.decisionId);
      expect(history).toEqual([]);
    });

    it('tracks all status transitions', () => {
      const decision = service.createDecision(minimalInput);
      service.transitionStatus(decision.decisionId, 'needs_approval', 'system', 'Auto-flagged');
      service.approveDecision(decision.decisionId, 'op-001', 'Approved', 2);
      service.markExecuted(decision.decisionId, '/evidence/001');
      service.markVerified(decision.decisionId, 'success');

      const history = service.getHistory(decision.decisionId);
      expect(history).toHaveLength(4);
      expect(history[0].fromStatus).toBe('proposed');
      expect(history[0].toStatus).toBe('needs_approval');
      expect(history[1].fromStatus).toBe('needs_approval');
      expect(history[1].toStatus).toBe('approved');
      expect(history[2].toStatus).toBe('executed');
      expect(history[3].toStatus).toBe('verified');
    });
  });

  describe('getProjection', () => {
    it('returns empty projection for store with no decisions', () => {
      const proj = service.getProjection('jf-us');
      expect(proj.totalCount).toBe(0);
      expect(proj.proposedCount).toBe(0);
      expect(proj.recentDecisions).toEqual([]);
    });

    it('aggregates status counts', () => {
      service.createDecision(minimalInput);
      service.createDecision({ ...minimalInput, entityId: 'kw-002' });
      const d3 = service.createDecision({ ...minimalInput, entityId: 'kw-003' });
      service.transitionStatus(d3.decisionId, 'needs_approval', 'system');

      const proj = service.getProjection('jf-us');
      expect(proj.totalCount).toBe(3);
      expect(proj.proposedCount).toBe(2);
      expect(proj.needsApprovalCount).toBe(1);
    });

    it('groups by entity type and action type', () => {
      service.createDecision({ ...minimalInput, entityType: 'keyword', actionType: 'lower_bid' });
      service.createDecision({ ...minimalInput, entityType: 'keyword', actionType: 'raise_bid', entityId: 'kw-002' });
      service.createDecision({ ...minimalInput, entityType: 'campaign', actionType: 'adjust_budget', entityId: 'cmp-001' });

      const proj = service.getProjection('jf-us');
      expect(proj.byEntityType.keyword).toBe(2);
      expect(proj.byEntityType.campaign).toBe(1);
      expect(proj.byActionType.lower_bid).toBe(1);
      expect(proj.byActionType.raise_bid).toBe(1);
      expect(proj.byActionType.adjust_budget).toBe(1);
    });

    it('limits recent decisions', () => {
      for (let i = 0; i < 30; i++) {
        service.createDecision({ ...minimalInput, entityId: `kw-${i}` });
      }

      const proj = service.getProjection('jf-us', 10);
      expect(proj.totalCount).toBe(30);
      expect(proj.recentDecisions).toHaveLength(10);
    });
  });
});
