/**
 * V1.6 Execution Service Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ExecutionService, ExecutionServiceError } from './v16-execution-service';
import type { ExecutionIntent, PreflightGate } from '@amazon-ai-ops/shared-types';

const NOW = '2026-09-03T17:20:00.000Z';

describe('ExecutionService', () => {
  let db: Database.Database;
  let service: ExecutionService;

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

    // Create stores table
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

    // Create execution tables
    db.exec(`
      CREATE TABLE execution_slots (
        slot_id TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        expected_before TEXT NOT NULL,
        expected_after TEXT NOT NULL,
        expected_change_percent REAL,
        before_evidence_path TEXT,
        after_evidence_path TEXT,
        reload_evidence_path TEXT,
        readback_before_value TEXT,
        readback_after_value TEXT,
        readback_reload_value TEXT,
        verified_at TEXT,
        verification_result TEXT,
        reconciliation_case_id TEXT,
        reconciliation_outcome TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        submitted_at TEXT,
        FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
      );

      CREATE TABLE execution_batches (
        batch_id TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        slot_ids TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        pending_count INTEGER NOT NULL DEFAULT 0,
        submitted_count INTEGER NOT NULL DEFAULT 0,
        verified_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        unknown_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
      );

      CREATE TABLE reconciliation_cases (
        case_id TEXT PRIMARY KEY,
        slot_id TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        store_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        observation_1_timestamp TEXT,
        observation_1_value TEXT,
        observation_2_timestamp TEXT,
        observation_2_value TEXT,
        outcome TEXT,
        resolved_at TEXT,
        resolution_notes TEXT,
        FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE RESTRICT
      );
    `);

    service = new ExecutionService(db);
  });

  afterEach(() => {
    db.close();
  });

  const minimalIntent: ExecutionIntent = {
    grantId: 'grant-001',
    decisionId: 'dec-001',
    actionType: 'lower_bid',
    entityId: 'kw-001',
    targetValue: '1.20',
    idempotencyKey: 'idem-001',
  };

  // ─── Batch creation ────────────────────────────────────────────────────

  describe('createBatch', () => {
    it('creates a new batch with slots', () => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      const result = service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      expect(result.batch.batchId).toBe('batch-001');
      expect(result.batch.status).toBe('running');
      expect(result.batch.slotIds).toEqual(['slot-001']);
      expect(result.batch.pendingCount).toBe(1);
      expect(result.slots.length).toBe(1);
      expect(result.slots[0].slotId).toBe('slot-001');
      expect(result.slots[0].status).toBe('pending');
    });

    it('creates batch with multiple slots', () => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
        {
          slotId: 'slot-002',
          grantId: 'grant-001',
          decisionId: 'dec-002',
          intent: { ...minimalIntent, decisionId: 'dec-002', entityId: 'kw-002' },
          expectedBefore: '2.00',
          expectedAfter: '1.80',
        },
      ];

      const result = service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      expect(result.batch.slotIds).toEqual(['slot-001', 'slot-002']);
      expect(result.batch.pendingCount).toBe(2);
      expect(result.slots.length).toBe(2);
    });

    it('rejects empty slots array', () => {
      expect(() =>
        service.createBatch({
          batchId: 'batch-001',
          grantId: 'grant-001',
          missionId: 'mission-001',
          storeId: 'jf-us',
          slots: [],
        }),
      ).toThrow('At least one slot is required');
    });
  });

  // ─── Slot submission ───────────────────────────────────────────────────

  describe('submitSlot', () => {
    it('records submit intent before actual submission', () => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      const slot = service.submitSlot('slot-001', '/evidence/before.png');
      expect(slot.status).toBe('submit_intent_recorded');
      expect(slot.beforeEvidencePath).toBe('/evidence/before.png');
    });

    it('transitions to submitted after intent recorded', () => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      service.submitSlot('slot-001', '/evidence/before.png');
      const slot = service.markSubmitted('slot-001');

      expect(slot.status).toBe('submitted');
      expect(slot.submittedAt).toBeTruthy();
    });

    it('rejects submission of non-pending slot', () => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      service.submitSlot('slot-001', '/evidence/before.png');

      expect(() => service.submitSlot('slot-001', '/evidence/before2.png')).toThrow(
        'Only pending slots can be submitted',
      );
    });

    it('updates batch counts after submission', () => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      service.submitSlot('slot-001', '/evidence/before.png');
      service.markSubmitted('slot-001');

      const batch = service.getBatch('batch-001');
      expect(batch?.pendingCount).toBe(0);
      expect(batch?.submittedCount).toBe(1);
    });
  });

  // ─── Readback verification ────────────────────────────────────────────

  describe('verifySlot', () => {
    beforeEach(() => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      service.submitSlot('slot-001', '/evidence/before.png');
      service.markSubmitted('slot-001');
    });

    it('verifies successful execution when readback matches expected', () => {
      const result = service.verifySlot('slot-001', {
        readbackBeforeValue: '1.50',
        readbackAfterValue: '1.20',
        readbackReloadValue: '1.20',
        afterEvidencePath: '/evidence/after.png',
        reloadEvidencePath: '/evidence/reload.png',
      });

      expect(result.slot.status).toBe('verified');
      expect(result.slot.verificationResult).toBe('success');
      expect(result.slot.readbackAfterValue).toBe('1.20');
      expect(result.slot.readbackReloadValue).toBe('1.20');
      expect(result.reconciliationCase).toBeUndefined();
    });

    it('creates reconciliation case when readback mismatches', () => {
      const result = service.verifySlot('slot-001', {
        readbackBeforeValue: '1.50',
        readbackAfterValue: '1.30', // Mismatch
        readbackReloadValue: undefined,
        afterEvidencePath: '/evidence/after.png',
      });

      expect(result.slot.status).toBe('unknown');
      expect(result.slot.verificationResult).toBe('unknown');
      expect(result.reconciliationCase).toBeDefined();
      expect(result.reconciliationCase?.slotId).toBe('slot-001');
    });

    it('marks as failed when before readback does not match', () => {
      const result = service.verifySlot('slot-001', {
        readbackBeforeValue: '2.00', // Wrong before value
        readbackAfterValue: '1.20',
        readbackReloadValue: '1.20',
        afterEvidencePath: '/evidence/after.png',
        reloadEvidencePath: '/evidence/reload.png',
      });

      expect(result.slot.status).toBe('failed');
      expect(result.slot.verificationResult).toBe('failure');
    });

    it('accepts numeric tolerance for verification', () => {
      const result = service.verifySlot(
        'slot-001',
        {
          readbackBeforeValue: '1.50',
          readbackAfterValue: '1.22', // 1.67% difference
          readbackReloadValue: '1.21',
          afterEvidencePath: '/evidence/after.png',
          reloadEvidencePath: '/evidence/reload.png',
        },
        5, // 5% tolerance
      );

      expect(result.slot.status).toBe('verified');
      expect(result.slot.verificationResult).toBe('success');
    });

    it('rejects verification of non-submitted slot', () => {
      const slots = [
        {
          slotId: 'slot-002',
          grantId: 'grant-001',
          decisionId: 'dec-002',
          intent: { ...minimalIntent, decisionId: 'dec-002', entityId: 'kw-002' },
          expectedBefore: '2.00',
          expectedAfter: '1.80',
        },
      ];

      service.createBatch({
        batchId: 'batch-002',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      expect(() =>
        service.verifySlot('slot-002', {
          readbackBeforeValue: '2.00',
          readbackAfterValue: '1.80',
          readbackReloadValue: '1.80',
          afterEvidencePath: '/evidence/after.png',
          reloadEvidencePath: '/evidence/reload.png',
        }),
      ).toThrow('Only submitted slots can be verified');
    });
  });

  // ─── Reconciliation ────────────────────────────────────────────────────

  describe('reconciliation', () => {
    beforeEach(() => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      service.submitSlot('slot-001', '/evidence/before.png');
      service.markSubmitted('slot-001');

      // Create reconciliation case
      service.verifySlot('slot-001', {
        readbackBeforeValue: '1.50',
        readbackAfterValue: '1.30', // Mismatch
        readbackReloadValue: undefined,
        afterEvidencePath: '/evidence/after.png',
      });
    });

    it('records first observation', () => {
      const rc = service.recordReconciliationObservation('slot-001', '1.30');
      expect(rc.observation1Value).toBe('1.30');
      expect(rc.observation1Timestamp).toBeTruthy();
      expect(rc.observation2Value).toBeUndefined();
    });

    it('records second observation and resolves', () => {
      service.recordReconciliationObservation('slot-001', '1.30');
      const rc = service.recordReconciliationObservation('slot-001', '1.30');

      expect(rc.observation2Value).toBe('1.30');
      expect(rc.observation2Timestamp).toBeTruthy();
      expect(rc.outcome).toBe('other_value'); // Not target, not original
      expect(rc.resolvedAt).toBeTruthy();
    });

    it('resolves to target_stably_observed when both observations match target', () => {
      service.recordReconciliationObservation('slot-001', '1.20');
      const rc = service.recordReconciliationObservation('slot-001', '1.20');

      expect(rc.outcome).toBe('target_stably_observed');
    });

    it('resolves to original_stably_observed when both observations match original', () => {
      service.recordReconciliationObservation('slot-001', '1.50');
      const rc = service.recordReconciliationObservation('slot-001', '1.50');

      expect(rc.outcome).toBe('original_stably_observed');
    });

    it('resolves to other_value when observations do not match target or original', () => {
      service.recordReconciliationObservation('slot-001', '1.35');
      const rc = service.recordReconciliationObservation('slot-001', '1.35');

      expect(rc.outcome).toBe('other_value');
    });

    it('resolves to inconclusive_permanent when observations differ', () => {
      service.recordReconciliationObservation('slot-001', '1.25');
      const rc = service.recordReconciliationObservation('slot-001', '1.40');

      expect(rc.outcome).toBe('inconclusive_permanent');
    });

    it('rejects more than two observations', () => {
      service.recordReconciliationObservation('slot-001', '1.30');
      service.recordReconciliationObservation('slot-001', '1.30');

      expect(() => service.recordReconciliationObservation('slot-001', '1.30')).toThrow(
        'Reconciliation case already resolved',
      );
    });
  });

  // ─── Batch completion ───────────────────────────────────────────────────

  describe('batch completion', () => {
    it('marks batch as completed when all slots are verified', () => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      service.submitSlot('slot-001', '/evidence/before.png');
      service.markSubmitted('slot-001');
      service.verifySlot('slot-001', {
        readbackBeforeValue: '1.50',
        readbackAfterValue: '1.20',
        readbackReloadValue: '1.20',
        afterEvidencePath: '/evidence/after.png',
        reloadEvidencePath: '/evidence/reload.png',
      });

      const batch = service.getBatch('batch-001');
      expect(batch?.status).toBe('completed');
      expect(batch?.verifiedCount).toBe(1);
      expect(batch?.completedAt).toBeTruthy();
    });

    it('stops batch as stopped_unknown when UNKNOWN slot detected', () => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });

      service.submitSlot('slot-001', '/evidence/before.png');
      service.markSubmitted('slot-001');
      service.verifySlot('slot-001', {
        readbackBeforeValue: '1.50',
        readbackAfterValue: '1.30', // Mismatch → UNKNOWN
        readbackReloadValue: undefined,
        afterEvidencePath: '/evidence/after.png',
      });

      const batch = service.getBatch('batch-001');
      expect(batch?.status).toBe('stopped_unknown');
      expect(batch?.unknownCount).toBe(1);
    });
  });

  // ─── Query methods ─────────────────────────────────────────────────────

  describe('queries', () => {
    beforeEach(() => {
      const slots = [
        {
          slotId: 'slot-001',
          grantId: 'grant-001',
          decisionId: 'dec-001',
          intent: minimalIntent,
          expectedBefore: '1.50',
          expectedAfter: '1.20',
        },
        {
          slotId: 'slot-002',
          grantId: 'grant-001',
          decisionId: 'dec-002',
          intent: { ...minimalIntent, decisionId: 'dec-002', entityId: 'kw-002' },
          expectedBefore: '2.00',
          expectedAfter: '1.80',
        },
      ];

      service.createBatch({
        batchId: 'batch-001',
        grantId: 'grant-001',
        missionId: 'mission-001',
        storeId: 'jf-us',
        slots,
      });
    });

    it('gets slot by id', () => {
      const slot = service.getSlot('slot-001');
      expect(slot?.slotId).toBe('slot-001');
      expect(slot?.status).toBe('pending');
    });

    it('returns null for non-existent slot', () => {
      const slot = service.getSlot('slot-999');
      expect(slot).toBeNull();
    });

    it('gets batch by id', () => {
      const batch = service.getBatch('batch-001');
      expect(batch?.batchId).toBe('batch-001');
      expect(batch?.slotIds).toEqual(['slot-001', 'slot-002']);
    });

    it('lists slots by batch', () => {
      const slots = service.listSlotsByBatch('batch-001');
      expect(slots.length).toBe(2);
      expect(slots[0].slotId).toBe('slot-001');
      expect(slots[1].slotId).toBe('slot-002');
    });

    it('lists batches by store', () => {
      const batches = service.listBatchesByStore('jf-us');
      expect(batches.length).toBe(1);
      expect(batches[0].batchId).toBe('batch-001');
    });

    it('gets batch projection', () => {
      const projection = service.getBatchProjection('jf-us');
      expect(projection.totalBatches).toBe(1);
      expect(projection.runningCount).toBe(1);
      expect(projection.totalSlots).toBe(2);
      expect(projection.pendingSlots).toBe(2);
    });
  });
});
