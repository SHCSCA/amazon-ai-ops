import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalysisAuthorityRepository,
  MissionDomainRepository,
  RecommendationRepository,
  initSqlite,
} from '@amazon-ai-ops/local-db';
import {
  ANALYSIS_REQUIRED_REPORT_TYPES,
  normalizeStoreContextEnvelope,
  type ActionRecommendation,
  type PolicyVersionRules,
  type StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import {
  AnalysisAuthorityService,
  DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS,
  type AnalysisAuthorityServiceOptions,
  type AnalysisRecommendationGenerationScope,
  type CapturedAnalysisGenerationAuthority,
} from './analysis-authority-service';
import { approveHumanDecisions, NOW, RULE_REVISION, tempDirs, databases, Harness, createHarness, seedImportAuthority, seedBootstrapPolicyAuthorities, recommendation, runRequest, seedTrustedCausalMemory, seedPriorGrant } from './analysis-authority.test-support';

describe('AnalysisAuthorityService', () => {
  it('reuses stable causal memory but rotates the effective model and action authority when trusted memory changes', async () => {
    const harness = createHarness({ deduplicateRecommendations: true });
    seedTrustedCausalMemory(harness, 1);

    const first = await harness.service.runMissionAnalysis({
      context: harness.context,
      missionId: harness.missionId,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-22',
      causalMemory: [{ observedEffect: 'Renderer fabricated memory must be ignored.' }],
      memoryDigest: '0'.repeat(64),
    } as Parameters<AnalysisAuthorityService['runMissionAnalysis']>[0] & {
      causalMemory: Array<{ observedEffect: string }>;
      memoryDigest: string;
    });
    const firstMission = harness.missionRepository.getMission(harness.context, harness.missionId)!;
    const repeated = await runRequest(harness);
    const repeatedMission = harness.missionRepository.getMission(harness.context, harness.missionId)!;

    expect(harness.generationScopes).toHaveLength(1);
    expect(harness.generationScopes[0].causalMemory).toEqual([
      expect.objectContaining({
        stage: 'EFFECT',
        missionId: harness.missionId,
        sessionGeneration: harness.context.sessionGeneration,
        observedEffect: '关键词竞价降低后 ACOS 改善，广告订单保持稳定。',
        proofs: [expect.objectContaining({ sha256: '1'.repeat(64) })],
      }),
    ]);
    expect(harness.generationScopes[0].memoryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(harness.generationScopes[0].memoryDigest).not.toBe('0'.repeat(64));
    expect(JSON.stringify(harness.generationScopes[0].causalMemory))
      .not.toMatch(/Renderer fabricated|createdAt|sequence/);
    expect(first.ai.modelRevision).toBe(
      `${harness.modelRevision.value}|causal-memory:${harness.generationScopes[0].memoryDigest}`,
    );
    expect(repeated.recommendationSummary.reused).toBe(1);
    expect(repeated.ai.modelRevision).toBe(first.ai.modelRevision);
    expect(repeated.proposals[0].id).toBe(first.proposals[0].id);
    expect(repeatedMission.revision).toBe(firstMission.revision);

    seedTrustedCausalMemory(harness, 2, '关键词进一步降价后广告订单下降，需停止继续降价。');
    expect(harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: first.proposals.map((proposal) => proposal.id),
    })).toMatchObject({
      authorized: false,
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'MODEL_REVISION_MISMATCH', message: '当前 AI 模型 revision 已变化；必须重新分析。' })]),
    });
    const changed = await runRequest(harness);
    const changedMission = harness.missionRepository.getMission(harness.context, harness.missionId)!;

    expect(harness.generationScopes).toHaveLength(2);
    expect(harness.generationScopes[1].causalMemory).toHaveLength(2);
    expect(harness.generationScopes[1].causalMemory).toEqual(expect.arrayContaining([
      expect.objectContaining({ observedEffect: '关键词竞价降低后 ACOS 改善，广告订单保持稳定。' }),
      expect.objectContaining({ observedEffect: '关键词进一步降价后广告订单下降，需停止继续降价。' }),
    ]));
    expect(harness.generationScopes[1].memoryDigest).not.toBe(harness.generationScopes[0].memoryDigest);
    expect(changed.ai.modelRevision).not.toBe(first.ai.modelRevision);
    expect(changed.proposals[0].modelRevision).toBe(changed.ai.modelRevision);
    expect(changed.proposals[0].id).not.toBe(first.proposals[0].id);
    expect(changed.proposals[0].actionBatchId).not.toBe(first.proposals[0].actionBatchId);
    expect(changedMission.revision).toBeGreaterThan(repeatedMission.revision);
  });

  it('fails closed without action authority when trusted causal memory changes during generation', async () => {
    let harness!: Harness;
    harness = createHarness({
      generationAuthorityFactory: (captured) => Object.freeze({
        ...captured,
        generateRecommendations: async (scope: AnalysisRecommendationGenerationScope) => {
          const result = await captured.generateRecommendations(scope);
          seedTrustedCausalMemory(harness, 2, '执行回读显示订单下滑，旧建议必须重新分析。');
          return result;
        },
      }),
    });
    const before = harness.missionRepository.getMission(harness.context, harness.missionId)!;

    await expect(runRequest(harness)).rejects.toThrow(
      'Trusted causal memory changed while Mission analysis was running.',
    );

    expect(harness.missionRepository.getMission(harness.context, harness.missionId)).toMatchObject({
      revision: before.revision,
      phase: before.phase,
    });
    expect(harness.service.getMissionAnalysisProjection(harness.context, harness.missionId)).toMatchObject({
      actionBatches: [],
      proposals: [],
      decisionLinks: [],
    });
    expect(harness.missionRepository.getMissionLineage(
      harness.context,
      harness.missionId,
    ).checkpoints).toEqual([]);
    expect(harness.missionRepository.getMissionLineage(
      harness.context,
      harness.missionId,
    ).causalEvents.some((event) => event.eventType === 'analysis_run_completed')).toBe(false);
  });
});
