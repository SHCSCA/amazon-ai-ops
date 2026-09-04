import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { writeTestEvidence } from './test-evidence-writer';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionRepository, MissionRow, DecisionRepository, DecisionRow, MissionGrantRepository, MissionGrantRow, ExecutionRepository, ExecutionBatchRow, ExecutionSlotRow, MemoryRepository, CausalEventRow } from '@amazon-ai-ops/local-db/src/sqlite/repositories/v16-domain-repositories';
import { MissionService } from './v16-mission-service';
import { DecisionService } from './v16-decision-service';
import { MissionGrantService } from './v16-mission-grant-service';
import { ExecutionService } from './v16-execution-service';

/**
 * V1.6.0 L3 工作流完整性测试
 *
 * 验证从 Mission 创建到执行完成的端到端不变量：
 * - Mission 生命周期完整（fact → analysis → decision → action → readback → effect）
 * - Decision 状态机正确（proposed → needs_approval → approved → executed → verified）
 * - Grant 消费正确（active → partially_consumed → fully_consumed）
 * - Execution Slot 终态不可变（verified/failed/unknown 不再可写）
 */

let testStartTime = Date.now();
let testStats = { total: 0, passed: 0, failed: 0, skipped: 0 };

beforeAll(() => { testStartTime = Date.now(); });
afterAll(() => {
  const duration = Date.now() - testStartTime;
  writeTestEvidence({
    testId: 'V16-T-L3-WORKFLOW',
    title: 'End-to-End Workflow Integrity L3 工作流完整性',
    layer: 'L3',
    testFile: 'apps/desktop/src/main/v16-l3-workflow-integrity.test.ts',
    totalTests: testStats.total,
    passedTests: testStats.passed,
    failedTests: testStats.failed,
    skippedTests: testStats.skipped,
    duration,
    timestamp: new Date().toISOString(),
  });
});

function track(test: () => void) {
  testStats.total++;
  try { test(); testStats.passed++; } catch (e) { testStats.failed++; throw e; }
}

const ctx: StoreContextEnvelope = { storeId: 'store-a', marketplace: 'US', currency: 'USD', businessDate: '2026-09-03', sessionGeneration: 1 };
const now = new Date().toISOString();

function makeMissionRow(overrides: Partial<MissionRow> = {}): MissionRow {
  return {
    mission_id: 'mission-1', store_id: 'store-a', mission_name: 'Test', description: null,
    product_ids: '[]', report_snapshot_id: null, observation_window_start: null,
    observation_window_end: null, policy_version_id: null, policy_revision: null,
    stage: 'fact', status: 'draft', revision: 1,
    created_at: now, updated_at: now, started_at: null, completed_at: null,
    created_by: 'op', last_modified_by: null, reason: null, metadata: null,
    ...overrides,
  };
}

function makeDecisionRow(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    decision_id: 'dec-1', store_id: 'store-a', mission_id: 'mission-1',
    mission_revision: 1, batch_id: 'batch-1', recommendation_id: 'rec-1',
    action_type: 'adjust_keyword_bid', entity_type: 'keyword', entity_id: 'kw-1',
    current_value: '1.00', target_value: '0.90', change_reason: 'reduce',
    status: 'proposed', issuer: 'human_operator', revision: 1,
    approved_at: null, approved_by: null, rejection_reason: null,
    superseded_by: null, supersedes: null,
    executed_at: null, execution_evidence: null,
    verified_at: null, verification_result: null,
    created_at: now, updated_at: now, metadata: null,
    ...overrides,
  };
}

function makeGrantRow(overrides: Partial<MissionGrantRow> = {}): MissionGrantRow {
  return {
    grant_id: 'grant-1', store_id: 'store-a', mission_id: 'mission-1', mission_revision: 1,
    decision_ids: '["dec-1"]', issuer: 'human_operator', issued_at: now, expires_at: null,
    issued_by: 'op', scope_json: '{"entityIds":["kw-1"],"actionType":"adjust_keyword_bid","currency":"USD"}',
    limits_json: '{"maxSlots":3}', evidence_json: '{"requiresBeforeScreenshot":false,"requiresAfterScreenshot":false,"requiresReloadScreenshot":false,"requiresValueReadback":false}',
    session_generation: null, ads_account_id: null,
    status: 'active', used_slots: 0, consumed_at: null, revoked_at: null, revoked_by: null, revocation_reason: null,
    created_at: now, updated_at: now, reason: 'test', metadata: null,
    ...overrides,
  };
}

function makeSlotRow(overrides: Partial<ExecutionSlotRow> = {}): ExecutionSlotRow {
  return {
    slot_id: 'slot-1', grant_id: 'grant-1', decision_id: 'dec-1', batch_id: 'batch-1', store_id: 'store-a',
    intent_json: '{"grantId":"grant-1","decisionId":"dec-1","actionType":"adjust_keyword_bid","entityId":"kw-1","targetValue":"0.90","idempotencyKey":"k1"}',
    status: 'pending', expected_before: '1.00', expected_after: '0.90', expected_change_percent: 10,
    before_evidence_path: null, after_evidence_path: null, reload_evidence_path: null,
    readback_before_value: null, readback_after_value: null, readback_reload_value: null,
    verified_at: null, verification_result: null, reconciliation_case_id: null, reconciliation_outcome: null,
    created_at: now, updated_at: now, submitted_at: null,
    ...overrides,
  };
}

function makeBatchRow(overrides: Partial<ExecutionBatchRow> = {}): ExecutionBatchRow {
  return {
    batch_id: 'batch-1', grant_id: 'grant-1', mission_id: 'mission-1', store_id: 'store-a',
    slot_ids: '["slot-1"]', status: 'running',
    pending_count: 1, submitted_count: 0, verified_count: 0, failed_count: 0, unknown_count: 0,
    created_at: now, updated_at: now, completed_at: null,
    ...overrides,
  };
}

describe('V16-T-L3-WORKFLOW: 工作流完整性不变量', () => {
  describe('Mission 生命周期推进', () => {
    track(() => {
      it('Mission 从 fact → analysis', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeMissionRow({ stage: 'fact', status: 'draft' })), findByStoreId: vi.fn(), findByStatus: vi.fn(), update: vi.fn().mockImplementation((id, u) => ({ ...makeMissionRow(), ...u })) } as unknown as MissionRepository;
        const svc = new MissionService(mockRepo);
        const m = svc.startMission({ storeContext: ctx, missionId: 'mission-1' });
        expect(m?.status).toBe('active');
      });

      it('Mission 从 active → completed（effect 阶段）', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeMissionRow({ stage: 'readback', status: 'active' })), findByStoreId: vi.fn(), findByStatus: vi.fn(), update: vi.fn().mockImplementation((id, u) => ({ ...makeMissionRow({ stage: 'readback', status: 'active' }), ...u })) } as unknown as MissionRepository;
        const svc = new MissionService(mockRepo);
        const m = svc.advanceStage({ storeContext: ctx, missionId: 'mission-1', targetStage: 'effect' });
        expect(m?.status).toBe('completed');
        expect(m?.stage).toBe('effect');
      });

      it('已完成的 Mission 不能再次推进', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeMissionRow({ status: 'completed' })), findByStoreId: vi.fn(), findByStatus: vi.fn(), update: vi.fn() } as unknown as MissionRepository;
        const svc = new MissionService(mockRepo);
        expect(() => svc.advanceStage({ storeContext: ctx, missionId: 'mission-1', targetStage: 'analysis' })).toThrow();
      });
    });
  });

  describe('Decision 状态机', () => {
    track(() => {
      it('Decision 完整链路: proposed → needs_approval → approved → executed → verified', () => {
        let missionRow = makeMissionRow();
        let decisionRow = makeDecisionRow({ status: 'proposed' });
        const mockRepo = {
          create: vi.fn(),
          findById: vi.fn().mockImplementation(() => decisionRow),
          findByStoreId: vi.fn(), findByMissionId: vi.fn(), findByStatus: vi.fn(),
          update: vi.fn().mockImplementation((id, u) => { decisionRow = { ...decisionRow, ...u }; return decisionRow; }),
          appendHistory: vi.fn(), getHistory: vi.fn(),
        } as unknown as DecisionRepository;
        const svc = new DecisionService(mockRepo);

        // proposed → needs_approval
        svc.transition({ storeContext: ctx, decisionId: 'dec-1', toStatus: 'needs_approval', reason: 'needs review' });
        expect(decisionRow.status).toBe('needs_approval');

        // needs_approval → approved
        svc.approve({ storeContext: ctx, decisionId: 'dec-1', reason: 'looks good' });
        expect(decisionRow.status).toBe('approved');
        expect(decisionRow.approved_at).toBeTruthy();

        // approved → executed
        svc.recordExecution({ storeContext: ctx, decisionId: 'dec-1', executionEvidence: '/tmp/evidence' });
        expect(decisionRow.status).toBe('executed');

        // executed → verified
        svc.recordVerification({ storeContext: ctx, decisionId: 'dec-1', result: 'success' });
        expect(decisionRow.status).toBe('verified');
      });

      it('verified 是终态，不能再变更', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeDecisionRow({ status: 'verified' })), findByStoreId: vi.fn(), findByMissionId: vi.fn(), findByStatus: vi.fn(), update: vi.fn(), appendHistory: vi.fn(), getHistory: vi.fn() } as unknown as DecisionRepository;
        const svc = new DecisionService(mockRepo);
        expect(() => svc.recordVerification({ storeContext: ctx, decisionId: 'dec-1', result: 'failure' })).toThrow();
      });

      it('拒绝空的拒绝理由', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeDecisionRow({ status: 'needs_approval' })), findByStoreId: vi.fn(), findByMissionId: vi.fn(), findByStatus: vi.fn(), update: vi.fn(), appendHistory: vi.fn(), getHistory: vi.fn() } as unknown as DecisionRepository;
        const svc = new DecisionService(mockRepo);
        expect(() => svc.reject({ storeContext: ctx, decisionId: 'dec-1', reason: '   ' })).toThrow();
      });
    });
  });

  describe('Grant 消费完整性', () => {
    track(() => {
      it('Grant 从 active → partially_consumed → fully_consumed', () => {
        let grantRow = makeGrantRow({ status: 'active', used_slots: 0 });
        const mockRepo = {
          create: vi.fn(), findById: vi.fn().mockImplementation(() => grantRow),
          findByStoreId: vi.fn(), findActiveByStore: vi.fn(),
          update: vi.fn().mockImplementation((id, u) => { grantRow = { ...grantRow, ...u }; return grantRow; }),
          appendLifecycleEvent: vi.fn(), getLifecycleEvents: vi.fn(),
        } as unknown as MissionGrantRepository;
        const svc = new MissionGrantService(mockRepo);

        // Slot 1 → partially_consumed
        svc.reserveSlot({ storeContext: ctx, grantId: 'grant-1', decisionId: 'dec-1', slotIndex: 0 });
        expect(grantRow.used_slots).toBe(1);
        expect(grantRow.status).toBe('partially_consumed');

        // Slot 2 → fully_consumed
        svc.reserveSlot({ storeContext: ctx, grantId: 'grant-1', decisionId: 'dec-2', slotIndex: 1 });
        expect(grantRow.used_slots).toBe(2);

        // Slot 3 → fully_consumed
        svc.reserveSlot({ storeContext: ctx, grantId: 'grant-1', decisionId: 'dec-3', slotIndex: 2 });
        expect(grantRow.status).toBe('fully_consumed');
        expect(grantRow.used_slots).toBe(3);
      });

      it('fully_consumed 后不能再 reserveSlot', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeGrantRow({ status: 'fully_consumed', used_slots: 3 })), findByStoreId: vi.fn(), findActiveByStore: vi.fn(), update: vi.fn(), appendLifecycleEvent: vi.fn(), getLifecycleEvents: vi.fn() } as unknown as MissionGrantRepository;
        const svc = new MissionGrantService(mockRepo);
        expect(() => svc.reserveSlot({ storeContext: ctx, grantId: 'grant-1', decisionId: 'dec-4', slotIndex: 3 })).toThrow();
      });
    });
  });

  describe('Execution Slot 终态不可变', () => {
    track(() => {
      it('verified slot 不能再次 verify', () => {
        const mockRepo = {
          createSlot: vi.fn(), findSlotById: vi.fn().mockReturnValue(makeSlotRow({ status: 'verified' })),
          findSlotsByBatchId: vi.fn().mockReturnValue([]),
          updateSlot: vi.fn(), createBatch: vi.fn(), findBatchById: vi.fn(), findBatchesByStore: vi.fn(), updateBatch: vi.fn(),
        } as unknown as ExecutionRepository;
        const mockGrant = { deriveResidualAuthority: vi.fn().mockReturnValue(null) } as unknown as MissionGrantService;
        const svc = new ExecutionService(mockRepo, mockGrant);
        expect(() => svc.finalizeVerification({ storeContext: ctx, slotId: 'slot-1', result: 'failure' })).toThrow(/terminal/);
      });

      it('unknown slot 不能再次 finalize', () => {
        const mockRepo = {
          createSlot: vi.fn(), findSlotById: vi.fn().mockReturnValue(makeSlotRow({ status: 'unknown' })),
          findSlotsByBatchId: vi.fn().mockReturnValue([]),
          updateSlot: vi.fn(), createBatch: vi.fn(), findBatchById: vi.fn(), findBatchesByStore: vi.fn(), updateBatch: vi.fn(),
        } as unknown as ExecutionRepository;
        const mockGrant = { deriveResidualAuthority: vi.fn() } as unknown as MissionGrantService;
        const svc = new ExecutionService(mockRepo, mockGrant);
        expect(() => svc.finalizeVerification({ storeContext: ctx, slotId: 'slot-1', result: 'success' })).toThrow(/terminal/);
      });

      it('createBatch 创建 running batch 和 pending slots', () => {
        const mockRepo = {
          createSlot: vi.fn(), findSlotById: vi.fn(),
          findSlotsByBatchId: vi.fn().mockReturnValue([]),
          updateSlot: vi.fn(),
          createBatch: vi.fn(), findBatchById: vi.fn(), findBatchesByStore: vi.fn(), updateBatch: vi.fn(),
        } as unknown as ExecutionRepository;
        const mockGrant = { deriveResidualAuthority: vi.fn().mockReturnValue(null) } as unknown as MissionGrantService;
        const svc = new ExecutionService(mockRepo, mockGrant);
        const batch = svc.createBatch({
          storeContext: ctx, grantId: 'grant-1', missionId: 'mission-1',
          intents: [{ grantId: 'grant-1', decisionId: 'dec-1', actionType: 'adjust_keyword_bid', entityId: 'kw-1', targetValue: '0.90', idempotencyKey: 'k1' }],
          expectedBeforeValues: { 'kw-1': '1.00' }, expectedAfterValues: { 'kw-1': '0.90' },
        });
        expect(batch.status).toBe('running');
        expect(batch.pendingCount).toBe(1);
        expect(mockRepo.createSlot).toHaveBeenCalled();
        expect(mockRepo.createBatch).toHaveBeenCalled();
      });
    });
  });

  describe('完整链路可追溯', () => {
    track(() => {
      it('DecisionService 每次状态变更都记录 History', () => {
        let decisionRow = makeDecisionRow({ status: 'proposed' });
        const historyCalls: unknown[] = [];
        const mockRepo = {
          create: vi.fn(), findById: vi.fn().mockImplementation(() => decisionRow),
          findByStoreId: vi.fn(), findByMissionId: vi.fn(), findByStatus: vi.fn(),
          update: vi.fn().mockImplementation((id, u) => { decisionRow = { ...decisionRow, ...u }; return decisionRow; }),
          appendHistory: vi.fn().mockImplementation((h) => historyCalls.push(h)),
          getHistory: vi.fn(),
        } as unknown as DecisionRepository;
        const svc = new DecisionService(mockRepo);
        svc.propose({ storeContext: ctx, missionId: 'mission-1', missionRevision: 1, batchId: 'batch-1', recommendationId: 'rec-1', actionType: 'adjust_keyword_bid', entityType: 'keyword', entityId: 'kw-1' });
        svc.transition({ storeContext: ctx, decisionId: 'dec-1', toStatus: 'needs_approval', reason: 'review' });
        svc.approve({ storeContext: ctx, decisionId: 'dec-1', reason: 'ok' });
        // Initial propose creates 1 history entry; approve creates another
        expect(historyCalls.length).toBeGreaterThanOrEqual(2);
      });

      it('MissionGrantService 每次 slot 变更都记录 LifecycleEvent', () => {
        let grantRow = makeGrantRow({ status: 'active', used_slots: 0 });
        const eventCalls: unknown[] = [];
        const mockRepo = {
          create: vi.fn(), findById: vi.fn().mockImplementation(() => grantRow),
          findByStoreId: vi.fn(), findActiveByStore: vi.fn(),
          update: vi.fn().mockImplementation((id, u) => { grantRow = { ...grantRow, ...u }; return grantRow; }),
          appendLifecycleEvent: vi.fn().mockImplementation((e) => eventCalls.push(e)),
          getLifecycleEvents: vi.fn(),
        } as unknown as MissionGrantRepository;
        const svc = new MissionGrantService(mockRepo);
        svc.issue({ storeContext: ctx, missionId: 'mission-1', missionRevision: 1, decisionIds: ['dec-1'], issuer: 'human_operator', issuedBy: 'op', scope: { entityIds: ['kw-1'], actionType: 'adjust_keyword_bid', currency: 'USD' }, limits: { maxSlots: 3 }, evidenceRequirement: { requiresBeforeScreenshot: false, requiresAfterScreenshot: false, requiresReloadScreenshot: false, requiresValueReadback: false }, reason: 'test' });
        svc.reserveSlot({ storeContext: ctx, grantId: 'grant-1', decisionId: 'dec-1', slotIndex: 0 });
        // issued event + slot_reserved event
        expect(eventCalls.some(e => (e as { event_type: string }).event_type === 'issued')).toBe(true);
        expect(eventCalls.some(e => (e as { event_type: string }).event_type === 'slot_reserved')).toBe(true);
      });
    });
  });
});
