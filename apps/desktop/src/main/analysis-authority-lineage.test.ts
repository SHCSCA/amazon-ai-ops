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
  it('blocks re-analysis after execution starts without changing the Mission, Grant or Experiment', async () => {
    for (const phase of ['action', 'readback', 'effect'] as const) {
      const harness = createHarness({ deduplicateRecommendations: true });
      const first = await runRequest(harness);
      approveHumanDecisions(harness);
    const authorized = harness.service.authorizeProposalBatch({
        context: harness.context,
        missionId: harness.missionId,
        proposalIds: first.proposals.map((proposal) => proposal.id),
      });
      expect(authorized).toMatchObject({ authorized: true, grant: { id: expect.any(String) } });
      harness.missionRepository.createExperiment(harness.context, {
        id: `experiment-${phase}`,
        missionId: harness.missionId,
        name: `${phase} phase experiment`,
        hypothesis: 'The approved keyword bid change improves ACOS without reducing orders.',
        primaryMetric: 'ACOS',
        guardrailMetrics: ['广告订单'],
        guardrailCriteria: ['广告订单 >= 95%'],
        productId: 'B0TEST',
        baseline: { bidUsd: 1.49 },
        variant: { bidUsd: 1.35, onlyVariable: 'keyword_bid' },
        observationStartsAt: '2026-07-22T12:00:00.000Z',
        observationEndsAt: '2026-07-29T12:00:00.000Z',
      });
      const decisionMission = harness.missionRepository.getMission(
        harness.context,
        harness.missionId,
      )!;
      const progressedMission = harness.missionRepository.transitionMission(harness.context, {
        id: harness.missionId,
        expectedRevision: decisionMission.revision,
        status: 'active',
        phase,
        reason: `fixture_entered_${phase}`,
        actorId: 'execution-authority',
      });
      const grantsBefore = harness.missionRepository.listMissionGrants(
        harness.context,
        harness.missionId,
      );
      const experimentsBefore = harness.missionRepository.listExperiments(harness.context, {
        missionId: harness.missionId,
        includeArchived: true,
      });
      const generationCountBefore = harness.generationScopes.length;
      harness.recommendationMutation.count = 2;
    harness.ruleRevision.value = 'b'.repeat(64);

      await expect(runRequest(harness)).rejects.toThrow(/请新建运营任务/);

      expect(harness.generationScopes).toHaveLength(generationCountBefore);
      expect(harness.missionRepository.getMission(harness.context, harness.missionId))
        .toEqual(progressedMission);
      expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId))
        .toEqual(grantsBefore);
      expect(harness.missionRepository.listExperiments(harness.context, {
        missionId: harness.missionId,
        includeArchived: true,
      })).toEqual(experimentsBefore);
    }
  });

  it('supersedes the old open Decision for the same Ads object when a new action batch is published', async () => {
    const harness = createHarness({ deduplicateRecommendations: true });
    const first = await runRequest(harness);
    const firstProjection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    const firstDecisionId = firstProjection.decisionLinks.find(
      (link) => link.proposalId === first.proposals[0].id,
    )!.decisionId;

    expect(harness.missionRepository.getDecision(harness.context, firstDecisionId)?.status)
      .toBe('needs_approval');

    harness.recommendationMutation.count = 2;
    harness.ruleRevision.value = 'b'.repeat(64);
    const second = await runRequest(harness);
    const secondProjection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    const secondDecisionIds = second.proposals.map((proposal) => (
      secondProjection.decisionLinks.find((link) => link.proposalId === proposal.id)!.decisionId
    ));
    const decisions = harness.missionRepository.getMissionLineage(
      harness.context,
      harness.missionId,
    ).decisions;

    expect(decisions.find((decision) => decision.id === firstDecisionId)?.status).toBe('superseded');
    expect(decisions.filter((decision) => secondDecisionIds.includes(decision.id)).map((decision) => decision.status))
      .toEqual(['needs_approval', 'needs_approval']);
    expect(decisions).toHaveLength(3);
    expect(harness.missionRepository.listDecisionHistory(harness.context, firstDecisionId))
      .toMatchObject([
        { eventType: 'created' },
        { eventType: 'superseded', reason: expect.stringContaining('新分析') },
      ]);
  });

  it('supersedes prior analysis Decisions by immutable batch lineage when Ads identity is still unavailable', async () => {
    const harness = createHarness({
      deduplicateRecommendations: true,
      withWritableTarget: false,
    });
    const first = await runRequest(harness);
    const firstProjection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    const firstDecisionId = firstProjection.decisionLinks.find(
      (link) => link.proposalId === first.proposals[0].id,
    )!.decisionId;

    expect(harness.missionRepository.getDecision(harness.context, firstDecisionId)).toMatchObject({
      status: 'blocked',
      adEntityId: undefined,
    });

    harness.recommendationMutation.count = 2;
    harness.ruleRevision.value = 'b'.repeat(64);
    const second = await runRequest(harness);
    const secondProjection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    const currentDecisionIds = second.proposals.map((proposal) => (
      secondProjection.decisionLinks.find((link) => link.proposalId === proposal.id)!.decisionId
    ));
    const decisions = harness.missionRepository.getMissionLineage(
      harness.context,
      harness.missionId,
    ).decisions;

    expect(decisions.find((decision) => decision.id === firstDecisionId)?.status).toBe('superseded');
    expect(decisions.filter((decision) => currentDecisionIds.includes(decision.id)).map((decision) => decision.status))
      .toEqual(['blocked', 'blocked']);
    expect(decisions.filter((decision) => ['proposed', 'needs_approval', 'blocked'].includes(decision.status)))
      .toHaveLength(2);
  });

  it('invalidates an old grant by bumping the Mission revision when the action fingerprint changes', async () => {
    const harness = createHarness({ deduplicateRecommendations: true });
    const first = await runRequest(harness);
    approveHumanDecisions(harness);
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: first.proposals.map((proposal) => proposal.id),
    });
    expect(authorized).toMatchObject({ authorized: true, grant: { missionRevision: expect.any(Number) } });

    harness.recommendationMutation.count = 2;
    harness.ruleRevision.value = 'b'.repeat(64);
    const second = await runRequest(harness);
    const currentMission = harness.missionRepository.getMission(harness.context, harness.missionId)!;

    expect(second.proposals[0].actionBatchId).not.toBe(first.proposals[0].actionBatchId);
    expect(currentMission.revision).toBeGreaterThan(authorized.grant!.missionRevision);
    expect(second.proposals[0].missionRevision).toBe(currentMission.revision);
    expect(harness.missionRepository.getDecision(harness.context, authorized.decisionIds[0])?.status)
      .toBe('approved');
    expect(harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: first.proposals.map((proposal) => proposal.id),
    })).toMatchObject({ authorized: false });
  });

  it('rolls back Mission progress, action snapshots and checkpoints when finalization fails', async () => {
    const harness = createHarness({ recommendationCount: 2 });
    const before = harness.missionRepository.getMission(harness.context, harness.missionId)!;
    const createProposal = harness.analysisRepository.createProposalSnapshot.bind(harness.analysisRepository);
    let proposalCalls = 0;
    vi.spyOn(harness.analysisRepository, 'createProposalSnapshot').mockImplementation((...args) => {
      proposalCalls += 1;
      if (proposalCalls === 2) throw new Error('fixture finalization failure');
      return createProposal(...args);
    });

    await expect(runRequest(harness)).rejects.toThrow('fixture finalization failure');

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
  });

  it('fails closed when the Mission changes during asynchronous recommendation generation', async () => {
    const harness = createHarness({ mutateMissionDuringGeneration: true });

    await expect(runRequest(harness)).rejects.toThrow('Mission changed while its analysis was running');
    expect(harness.analysisRepository.getLatestActionBatch(
      harness.context,
      harness.missionId,
    )).toBeUndefined();
  });

  it('keeps one immutable generation authority when mutable settings change A to B to A during an AI await', async () => {
    let signalStarted!: () => void;
    let releaseGeneration!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    const authoritiesUsed: Array<{ ruleRevision: string; modelRevision: string }> = [];
    const harness = createHarness({
      generationAuthorityFactory: (captured) => Object.freeze({
        ...captured,
        generateRecommendations: async (
          scope: Parameters<CapturedAnalysisGenerationAuthority['generateRecommendations']>[0],
        ) => {
          authoritiesUsed.push({
            ruleRevision: captured.ruleRevision,
            modelRevision: captured.modelRevision,
          });
          signalStarted();
          await generationGate;
          return captured.generateRecommendations(scope);
        },
      }),
    });
    const originalModelRevision = harness.modelRevision.value;

    const pending = runRequest(harness);
    await started;
    harness.ruleRevision.value = 'b'.repeat(64);
    harness.modelRevision.value = 'changed-during-generation';
    harness.ruleRevision.value = RULE_REVISION;
    harness.modelRevision.value = originalModelRevision;
    releaseGeneration();

    const result = await pending;
    expect(authoritiesUsed).toEqual([{
      ruleRevision: RULE_REVISION,
      modelRevision: originalModelRevision,
    }]);
    expect(result.evidencePackage).toMatchObject({
      ruleRevision: RULE_REVISION,
      modelRevision: originalModelRevision,
    });
    const authorization = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(authorization.blockers).not.toContainEqual({ code: 'RULE_REVISION_MISMATCH', message: '当前规则 revision 已变化；必须重新分析。' });
    expect(authorization.blockers).not.toContainEqual({ code: 'MODEL_REVISION_MISMATCH', message: '当前 AI 模型 revision 已变化；必须重新分析。' });
  });

  it('blocks stale Mission, rule, AI runtime and non-latest action revisions before changing Decisions', async () => {
    const missionHarness = createHarness();
    const missionResult = await runRequest(missionHarness);
    const mission = missionHarness.missionRepository.getMission(missionHarness.context, missionHarness.missionId)!;
    missionHarness.missionRepository.updateMission(missionHarness.context, {
      id: mission.id,
      expectedRevision: mission.revision,
      actorId: 'operator',
      patch: { title: 'Mission changed after analysis' },
    });
    const missionBlocked = missionHarness.service.authorizeProposalBatch({
      context: missionHarness.context,
      missionId: missionHarness.missionId,
      proposalIds: missionResult.proposals.map((proposal) => proposal.id),
    });
    expect(missionBlocked.blockers).toContainEqual({ code: 'STALE_MISSION_REVISION', message: 'Mission 已修订；旧分析建议必须重新运行后才能授权。' });

    const ruleHarness = createHarness();
    const ruleResult = await runRequest(ruleHarness);
    ruleHarness.ruleRevision.value = 'b'.repeat(64);
    expect(ruleHarness.service.authorizeProposalBatch({
      context: ruleHarness.context,
      missionId: ruleHarness.missionId,
      proposalIds: ruleResult.proposals.map((proposal) => proposal.id),
    }).blockers).toContainEqual({ code: 'RULE_REVISION_MISMATCH', message: '当前规则 revision 已变化；必须重新分析。' });

    const modelHarness = createHarness();
    const modelResult = await runRequest(modelHarness);
    modelHarness.modelRevision.value = 'changed-ai-runtime-revision';
    expect(modelHarness.service.authorizeProposalBatch({
      context: modelHarness.context,
      missionId: modelHarness.missionId,
      proposalIds: modelResult.proposals.map((proposal) => proposal.id),
    }).blockers).toContainEqual({ code: 'MODEL_REVISION_MISMATCH', message: '当前 AI 模型 revision 已变化；必须重新分析。' });

    const latestHarness = createHarness();
    const latestResult = await runRequest(latestHarness);
    latestHarness.analysisRepository.createActionBatch(latestHarness.context, {
      id: 'newer-empty-analysis-batch',
      missionId: latestHarness.missionId,
      evidencePackageId: latestResult.evidencePackage.id,
      expectedMissionRevision: latestHarness.missionRepository.getMission(
        latestHarness.context,
        latestHarness.missionId,
      )!.revision,
    });
    expect(latestHarness.service.authorizeProposalBatch({
      context: latestHarness.context,
      missionId: latestHarness.missionId,
      proposalIds: latestResult.proposals.map((proposal) => proposal.id),
    }).blockers).toContainEqual({ code: 'STALE_ACTION_BATCH', message: '只能授权当前 Mission 的最新分析动作批次。' });
  });
});
