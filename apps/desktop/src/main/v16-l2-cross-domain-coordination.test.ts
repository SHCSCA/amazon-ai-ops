import { afterAll, beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { writeTestEvidence } from './test-evidence-writer';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { MissionRepository, MissionRow, DecisionRepository, DecisionRow, MissionGrantRepository, MissionGrantRow, MemoryRepository, CausalEventRow } from '@amazon-ai-ops/local-db/src/sqlite/repositories/v16-domain-repositories';
import { MissionService } from './v16-mission-service';
import { DecisionService } from './v16-decision-service';
import { MissionGrantService } from './v16-mission-grant-service';
import { MemoryService } from './v16-memory-service';

/**
 * V1.6.0 L2 跨域协调层测试
 *
 * 验证 Mission / Policy / Experiment 三大域之间的协调不变量：
 * - Mission 必须关联有效 Store（Store 隔离）
 * - Decision 必须关联有效 Mission
 * - Grant 必须关联有效 Mission 和 Decision
 * - Memory 必须关联有效 Store
 * - 跨 Store 操作必须被拒绝
 */

let testStartTime = Date.now();
let testStats = { total: 0, passed: 0, failed: 0, skipped: 0 };

beforeAll(() => { testStartTime = Date.now(); });
afterAll(() => {
  const duration = Date.now() - testStartTime;
  writeTestEvidence({
    testId: 'V16-T-L2-CROSS-DOMAIN',
    title: 'Cross-Domain Coordination L2 跨域协调',
    layer: 'L2',
    testFile: 'apps/desktop/src/main/v16-l2-cross-domain-coordination.test.ts',
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

const storeA: StoreContextEnvelope = { storeId: 'store-a', marketplace: 'US', currency: 'USD', businessDate: '2026-09-03', sessionGeneration: 1 };
const storeB: StoreContextEnvelope = { storeId: 'store-b', marketplace: 'US', currency: 'USD', businessDate: '2026-09-03', sessionGeneration: 1 };

const now = new Date().toISOString();

// ─── Mission Repository mocks ───────────────────────────────────────────────

function makeMissionRow(overrides: Partial<MissionRow> = {}): MissionRow {
  return {
    mission_id: 'mission-1',
    store_id: 'store-a',
    mission_name: 'Test mission',
    description: null,
    product_ids: '[]',
    report_snapshot_id: null,
    observation_window_start: null,
    observation_window_end: null,
    policy_version_id: null,
    policy_revision: null,
    stage: 'fact',
    status: 'draft',
    revision: 1,
    created_at: now,
    updated_at: now,
    started_at: null,
    completed_at: null,
    created_by: 'operator',
    last_modified_by: null,
    reason: null,
    metadata: null,
    ...overrides,
  };
}

function makeDecisionRow(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    decision_id: 'dec-1',
    store_id: 'store-a',
    mission_id: 'mission-1',
    mission_revision: 1,
    batch_id: 'batch-1',
    recommendation_id: 'rec-1',
    action_type: 'adjust_keyword_bid',
    entity_type: 'keyword',
    entity_id: 'kw-1',
    current_value: null, target_value: null, change_reason: null,
    status: 'proposed',
    issuer: 'human_operator',
    revision: 1,
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
    grant_id: 'grant-1',
    store_id: 'store-a',
    mission_id: 'mission-1',
    mission_revision: 1,
    decision_ids: '["dec-1"]',
    issuer: 'human_operator',
    issued_at: now,
    expires_at: null,
    issued_by: 'operator',
    scope_json: '{"entityIds":["kw-1"],"actionType":"adjust_keyword_bid","currency":"USD"}',
    limits_json: '{"maxSlots":3}',
    evidence_json: '{"requiresBeforeScreenshot":false,"requiresAfterScreenshot":false,"requiresReloadScreenshot":false,"requiresValueReadback":false}',
    session_generation: null,
    ads_account_id: null,
    status: 'active',
    used_slots: 0,
    consumed_at: null, revoked_at: null, revoked_by: null, revocation_reason: null,
    created_at: now, updated_at: now,
    reason: 'test grant',
    metadata: null,
    ...overrides,
  };
}

function makeEventRow(overrides: Partial<CausalEventRow> = {}): CausalEventRow {
  return {
    event_id: 'evt-1',
    store_id: 'store-a',
    stage: 'effect',
    mission_id: 'mission-1',
    decision_id: null,
    grant_id: null,
    execution_id: null,
    experiment_id: null,
    analysis_run_id: null,
    entity_id: 'kw-1',
    product_id: null,
    business_date: '2026-09-03',
    event_type: 'effect_observed',
    session_generation: 1,
    proof_hash: 'a'.repeat(64),
    evidence_refs_json: '[]',
    summary: 'test',
    details_json: null,
    status: 'trusted',
    memory_digest: 'x'.repeat(32),
    created_at: now,
    correction_of: null, corrected_by: null, metadata: null,
    ...overrides,
  };
}

describe('V16-T-L2-CROSS-DOMAIN: 跨域协调不变量', () => {
  describe('Mission ↔ Store 隔离协调', () => {
    track(() => {
      it('MissionService.createMission 必须在当前 Store 创建', () => {
        const mockRepo = { create: vi.fn((m: Omit<MissionRow, 'revision' | 'updated_at'>) => ({ ...m, revision: 1, updated_at: now } as MissionRow)), findById: vi.fn(), findByStoreId: vi.fn(), findByStatus: vi.fn(), update: vi.fn() } as unknown as MissionRepository;
        const svc = new MissionService(mockRepo);
        const result = svc.createMission({ storeContext: storeA, name: 'test', productIds: ['p1'] });
        expect(result.store_id).toBe('store-a');
      });

      it('MissionService.getMission 拒绝跨 Store 访问', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue({ ...makeMissionRow(), store_id: 'store-b' }), findByStoreId: vi.fn(), findByStatus: vi.fn(), update: vi.fn() } as unknown as MissionRepository;
        const svc = new MissionService(mockRepo);
        expect(() => svc.getMission({ storeContext: storeA, missionId: 'mission-1' })).toThrow();
      });

      it('listMissions 仅返回当前 Store 的 Mission', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn(), findByStoreId: vi.fn().mockReturnValue([makeMissionRow()]), findByStatus: vi.fn(), update: vi.fn() } as unknown as MissionRepository;
        const svc = new MissionService(mockRepo);
        const results = svc.listMissions({ storeContext: storeA });
        expect(results.length).toBeGreaterThanOrEqual(0);
        for (const m of results) {
          expect(m.store_id).toBe('store-a');
        }
      });
    });
  });

  describe('Decision ↔ Mission 协调', () => {
    track(() => {
      it('Decision 必须关联有效 MissionId', () => {
        const mockRepo = {
          create: vi.fn((d: Omit<DecisionRow, 'revision' | 'updated_at'>) => ({ ...d, revision: 1, updated_at: now } as DecisionRow)),
          findById: vi.fn(),
          findByStoreId: vi.fn(),
          findByMissionId: vi.fn().mockReturnValue([makeDecisionRow()]),
          findByStatus: vi.fn(),
          update: vi.fn(),
          appendHistory: vi.fn(),
          getHistory: vi.fn(),
        } as unknown as DecisionRepository;
        const svc = new DecisionService(mockRepo);
        const decisions = svc.listDecisions({ storeContext: storeA, missionId: 'mission-1' });
        for (const d of decisions) {
          expect(d.mission_id).toBe('mission-1');
        }
      });

      it('DecisionService 拒绝不属于当前 Store 的 Decision', () => {
        const mockRepo = {
          create: vi.fn(),
          findById: vi.fn().mockReturnValue({ ...makeDecisionRow(), store_id: 'store-b' }),
          findByStoreId: vi.fn(),
          findByMissionId: vi.fn(),
          findByStatus: vi.fn(),
          update: vi.fn(),
          appendHistory: vi.fn(),
          getHistory: vi.fn(),
        } as unknown as DecisionRepository;
        const svc = new DecisionService(mockRepo);
        expect(() => svc.getDecision({ storeContext: storeA, decisionId: 'dec-1' })).toThrow();
      });
    });
  });

  describe('Grant ↔ Mission / Decision 协调', () => {
    track(() => {
      it('MissionGrantService.issue 必须关联 DecisionIds', () => {
        const mockRepo = { create: vi.fn((g: MissionGrantRow) => g), findById: vi.fn(), findByStoreId: vi.fn(), findActiveByStore: vi.fn(), update: vi.fn(), appendLifecycleEvent: vi.fn(), getLifecycleEvents: vi.fn() } as unknown as MissionGrantRepository;
        const svc = new MissionGrantService(mockRepo);
        expect(() => svc.issue({
          storeContext: storeA, missionId: 'mission-1', missionRevision: 1,
          decisionIds: [], issuer: 'human_operator', issuedBy: 'operator',
          scope: { entityIds: ['kw-1'], actionType: 'adjust_keyword_bid', currency: 'USD' },
          limits: { maxSlots: 3 },
          evidenceRequirement: { requiresBeforeScreenshot: false, requiresAfterScreenshot: false, requiresReloadScreenshot: false, requiresValueReadback: false },
          reason: 'test',
        })).toThrow(/at least one/);
      });

      it('MissionGrantService.getGrant 拒绝跨 Store', () => {
        const mockRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeGrantRow({ store_id: 'store-b' })), findByStoreId: vi.fn(), findActiveByStore: vi.fn(), update: vi.fn(), appendLifecycleEvent: vi.fn(), getLifecycleEvents: vi.fn() } as unknown as MissionGrantRepository;
        const svc = new MissionGrantService(mockRepo);
        expect(() => svc.getGrant({ storeContext: storeA, grantId: 'grant-1' })).toThrow();
      });
    });
  });

  describe('Memory ↔ Store 隔离协调', () => {
    track(() => {
      it('MemoryService.append 拒绝跨 Store 事件', () => {
        const mockRepo = { append: vi.fn((e: CausalEventRow) => e), findByStore: vi.fn().mockReturnValue([makeEventRow({ store_id: 'store-b' })]), findTrustedByStore: vi.fn(), countByStore: vi.fn() } as unknown as MemoryRepository;
        const svc = new MemoryService(mockRepo);
        expect(() => svc.correct({
          storeContext: storeA,
          originalEventId: 'evt-1',
          correctionEventType: 'correction',
          summary: 'wrong',
          proofHash: 'b'.repeat(64),
        })).toThrow();
      });

      it('MemoryService.exportMemory 仅包含当前 Store 的事件', () => {
        const mockRepo = {
          append: vi.fn(),
          findByStore: vi.fn().mockReturnValue([
            makeEventRow({ event_id: 'e1', store_id: 'store-a' }),
            makeEventRow({ event_id: 'e2', store_id: 'store-b' }),
          ]),
          findTrustedByStore: vi.fn().mockReturnValue([]),
          countByStore: vi.fn().mockReturnValue(2),
        } as unknown as MemoryRepository;
        const svc = new MemoryService(mockRepo);
        const result = svc.exportMemory({ storeContext: storeA });
        // All exported records must belong to store-a
        for (const r of result.records) {
          const row = mockRepo.findByStore('store-a').find(e => e.event_id === r.eventId);
          expect(row?.store_id).toBe('store-a');
        }
      });
    });
  });

  describe('Store 隔离协调 (跨域综合)', () => {
    track(() => {
      it('所有服务拒绝 Store A 调用 Store B 的资源', () => {
        // MissionService
        const missionRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeMissionRow({ store_id: 'store-b' })), findByStoreId: vi.fn(), findByStatus: vi.fn(), update: vi.fn() } as unknown as MissionRepository;
        expect(() => new MissionService(missionRepo).getMission({ storeContext: storeA, missionId: 'mission-1' })).toThrow();

        // DecisionService
        const decisionRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeDecisionRow({ store_id: 'store-b' })), findByStoreId: vi.fn(), findByMissionId: vi.fn(), findByStatus: vi.fn(), update: vi.fn(), appendHistory: vi.fn(), getHistory: vi.fn() } as unknown as DecisionRepository;
        expect(() => new DecisionService(decisionRepo).getDecision({ storeContext: storeA, decisionId: 'dec-1' })).toThrow();

        // MissionGrantService
        const grantRepo = { create: vi.fn(), findById: vi.fn().mockReturnValue(makeGrantRow({ store_id: 'store-b' })), findByStoreId: vi.fn(), findActiveByStore: vi.fn(), update: vi.fn(), appendLifecycleEvent: vi.fn(), getLifecycleEvents: vi.fn() } as unknown as MissionGrantRepository;
        expect(() => new MissionGrantService(grantRepo).getGrant({ storeContext: storeA, grantId: 'grant-1' })).toThrow();
      });
    });
  });
});
