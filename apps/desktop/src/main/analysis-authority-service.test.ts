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
  it.each(['manual_approval', 'policy_auto'] as const)('caps %s grant expiry at the temporary policy deadline', async (autonomyMode) => {
    const policyValidUntil = '2026-07-22T13:00:00.000Z';
    const h = createHarness({ autonomyMode, policyValidUntil });
    const analysis = await runRequest(h);
    if (autonomyMode === 'manual_approval') approveHumanDecisions(h);
    const result = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) });
    expect(result.authorized).toBe(true);
    expect(result.grant?.expiresAt).toBe(policyValidUntil);
    expect(h.missionRepository.getMissionGrant(h.context, result.grant!.id)?.expiresAt).toBe(policyValidUntil);
  });
  it('upgrades legacy judgments without backfilling authority and retains readable approval history', async () => {
    const h = createHarness();
    seedTrustedCausalMemory(h, 1);
    expect(h.missionRepository.listAnalysisCausalMemory(h.context, { productId: 'B0TEST' })).toHaveLength(1);
    const analysis = await runRequest(h); approveHumanDecisions(h);
    const original = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) }).grant!;
    const history = h.missionRepository.listDecisionHistory(h.context, original.decisionIds[0]);
    const legacyPath = path.join(h.directory, 'legacy-no-authority.db');
    await h.database.backup(legacyPath);
    const legacy = new Database(legacyPath);
    legacy.exec(`DROP TABLE ai_cost_records; DROP TABLE ai_spend_policies; DROP TABLE legacy_record_classifications;
      DROP TRIGGER trg_decision_write_authority_immutable;
      ALTER TABLE analysis_action_batches DROP COLUMN authority_json;
      ALTER TABLE decisions DROP COLUMN authority_json;
      ALTER TABLE mission_grants DROP COLUMN authority_json;
      DELETE FROM schema_migrations WHERE version>=17;`);
    legacy.close();
    const upgraded = initSqlite(legacyPath); databases.push(upgraded);
    const repository = new MissionDomainRepository(upgraded, { now: () => new Date(NOW) });
    const historical = repository.getMissionGrant(h.context, original.id)!;
    expect(historical.authority).toBeUndefined();
    expect(repository.getDecision(h.context, original.decisionIds[0])?.authority).toBeUndefined();
    expect(upgraded.prepare("SELECT classification,source_schema,reason FROM legacy_record_classifications WHERE source_table='mission_grants' AND record_id=?").get(original.id))
      .toMatchObject({ classification: 'historical-read-only', source_schema: 16, reason: expect.any(String) });
    expect(repository.listDecisionHistory(h.context, original.decisionIds[0])).toEqual(history);
    expect(repository.listCausalEvents(h.context, { missionId: h.missionId }).some(event => event.id === 'trusted-analysis-memory-1')).toBe(true);
    expect(repository.listAnalysisCausalMemory(h.context, { productId: 'B0TEST' })).toEqual([]);
    expect(() => repository.assertWriteAuthority(h.context, historical.authority)).toThrow(/历史/);
    expect(() => repository.issueMissionGrant(h.context, { ...original, id: 'cannot-reissue-legacy' })).toThrow(/历史/);
    const before = upgraded.prepare('SELECT manifest_json FROM schema_migrations WHERE version=17').get();
    upgraded.close();
    const reopened = initSqlite(legacyPath); databases.push(reopened);
    expect(reopened.prepare('SELECT manifest_json FROM schema_migrations WHERE version=17').get()).toEqual(before);
    expect(reopened.pragma('foreign_key_check')).toEqual([]);
  });
  it('preserves prior human Decisions but refuses them after mode A-to-B-to-A before any grant exists', async () => {
    const h = createHarness();
    const analysis = await runRequest(h);
    approveHumanDecisions(h);
    const decisions = h.missionRepository.listDecisions(h.context, { missionId: h.missionId });
    const history = h.missionRepository.listDecisionHistory(h.context, decisions[0].id);
    for (const autonomyMode of ['policy_auto', 'manual_approval'] as const) {
      const runtime = h.missionRepository.getPolicyRuntime(h.context);
      h.missionRepository.updatePolicyRuntime(h.context, { expectedRevision: runtime.revision, actorId: 'operator',
        patch: { autonomyMode, reason: '隔离模式变更样本：调整后重新核验授权。' } });
      const result = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) });
      expect(result.authorized).toBe(false);
      expect(result.blockers.join(' ')).toMatch(/授权模式版本/);
    }
    expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toHaveLength(0);
    expect(h.missionRepository.listDecisionHistory(h.context, decisions[0].id)).toEqual(history);
  });

  it('binds complete context and issuer to immutable batch, Decision and Grant records', async () => {
    const h = createHarness();
    const analysis = await runRequest(h);
    const batch = h.analysisRepository.getLatestActionBatch(h.context, h.missionId)!;
    const decision = h.missionRepository.listDecisions(h.context, { missionId: h.missionId })[0];
    expect(batch.authority).toMatchObject({ context: h.context, authorityMode: 'manual_approval',
      authorizationPath: 'human', issuerType: 'human_operator', issuerRef: 'operator' });
    expect(decision.authority).toEqual(batch.authority);
    expect(() => h.missionRepository.resolveDecision(h.context, { id: decision.id, expectedRevision: decision.revision,
      status: 'approved', actorId: 'policy-engine', reason: '策略不能替代人工判断。' })).toThrow(/判断来源/);
    expect(() => h.missionRepository.resolveDecision(h.context, { id: decision.id, expectedRevision: decision.revision,
      status: 'approved', actorId: 'operator', reason: '   ' })).toThrow();
    expect(() => h.database.prepare("UPDATE decisions SET authority_json='{}' WHERE id=?").run(decision.id)).toThrow(/immutable/);
    approveHumanDecisions(h);
    const result = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) });
    expect(result.grant?.authority).toEqual(batch.authority);
    expect(() => h.missionRepository.assertWriteAuthority({ ...h.context, businessDate: '2026-07-23' as never }, result.grant!.authority)).toThrow(/店铺、会话或授权模式版本/);
    expect(() => h.missionRepository.assertWriteAuthority(h.context, undefined)).toThrow(/历史/);
  });

  it('will not issue a partial grant through the canonical repository after all human Decisions exist', async () => {
    const h = createHarness({ recommendationCount: 2 });
    const analysis = await runRequest(h); approveHumanDecisions(h);
    const result = h.service.authorizeProposalBatch({ context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) });
    const grant = result.grant!;
    expect(() => h.missionRepository.issueMissionGrant(h.context, { ...grant, id: 'partial-direct-grant',
      decisionIds: [grant.decisionIds[0]], allowedAdEntityIds: [grant.allowedAdEntityIds[0]] })).toThrow(/全部判断/);
    expect(() => h.missionRepository.issueMissionGrant(h.context, { ...grant, id: 'mixed-issuer-grant',
      issuer: { type: 'policy', actorId: 'policy-engine' } })).toThrow(/禁止混合/);
    expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toHaveLength(1);
  });
  it('requires each human Decision and its reason before the explicit complete-batch grant', async () => {
    const h = createHarness({ recommendationCount: 2 });
    const analysis = await runRequest(h);
    const request = { context: h.context, missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) };
    const links = h.service.getMissionAnalysisProjection(h.context, h.missionId).decisionLinks;
    expect(h.service.authorizeProposalBatch(request).authorized).toBe(false);
    expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toHaveLength(0);
    for (const [index, link] of links.entries()) {
      const decision = h.missionRepository.getDecision(h.context, link.decisionId)!;
      expect(decision.status).toBe('needs_approval');
      h.missionRepository.resolveDecision(h.context, {
        id: decision.id, expectedRevision: decision.revision, status: 'approved',
        reason: `人工样本判断 ${index + 1}：当前花费超限，核对证据后接受本条降价。`, actorId: 'operator',
      });
      if (index === 0) expect(h.service.authorizeProposalBatch(request).authorized).toBe(false);
    }
    const history = links.map(link => h.missionRepository.listDecisionHistory(h.context, link.decisionId));
    expect(h.service.authorizeProposalBatch(request)).toMatchObject({ authorized: true, mode: 'manual_approval' });
    expect(links.map(link => h.missionRepository.listDecisionHistory(h.context, link.decisionId))).toEqual(history);
    expect(history.every(events => events.some(event => event.eventType === 'approved' && event.reason?.includes('核对证据后')))).toBe(true);
  });
  it('times out a stalled analysis without advancing the Mission and can retry with a new run', async () => {
    let attempts = 0;
    let stalledSignal: AbortSignal | undefined;
    const harness = createHarness({
      generationTimeoutMs: 40,
      generationAuthorityFactory: (captured) => ({
        ...captured,
        generateRecommendations: async (scope) => {
          attempts += 1;
          if (attempts === 1) {
            stalledSignal = scope.signal;
            return new Promise<never>(() => undefined);
          }
          return captured.generateRecommendations(scope);
        },
      }),
    });
    const missionBefore = harness.missionRepository.getMission(harness.context, harness.missionId)!;

    await expect(Promise.race([
      runRequest(harness),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error('test guard: stalled analysis did not stop')),
        750,
      )),
    ])).rejects.toThrow(/AI 分析.*未完成.*请检查.*重试/);

    expect(stalledSignal?.aborted).toBe(true);
    expect(harness.missionRepository.getMission(harness.context, harness.missionId)).toEqual(missionBefore);
    expect(harness.service.getMissionAnalysisProjection(harness.context, harness.missionId)).toMatchObject({
      actionBatches: [],
      proposals: [],
      decisionLinks: [],
    });
    expect(harness.recommendationRepository.findByFilterForStore(
      harness.context.storeId,
      {},
    )).toMatchObject({ items: [], total: 0 });
    const failedEvents = harness.missionRepository
      .getMissionLineage(harness.context, harness.missionId)
      .causalEvents
      .filter((event) => event.entityType === 'analysis_run')
      .sort((left, right) => left.sequence - right.sequence);
    expect(failedEvents).toHaveLength(2);
    expect(failedEvents.map((event) => event.eventType)).toEqual([
      'analysis_run_started',
      'analysis_run_failed',
    ]);
    expect(failedEvents[1]).toMatchObject({
      entityId: failedEvents[0].entityId,
      status: 'failed',
      title: '分析未完成',
    });
    expect(failedEvents[1].signal).toMatch(/超时.*安全停止.*重新运行分析/);

    await expect(runRequest(harness)).resolves.toMatchObject({ generatedRecommendations: 1 });
    const allRunEvents = harness.missionRepository
      .getMissionLineage(harness.context, harness.missionId)
      .causalEvents
      .filter((event) => event.entityType === 'analysis_run')
      .sort((left, right) => left.sequence - right.sequence);
    expect(allRunEvents.filter((event) => event.eventType === 'analysis_run_started')).toHaveLength(2);
    expect(allRunEvents.filter((event) => event.eventType === 'analysis_run_failed')).toHaveLength(1);
    expect(allRunEvents.filter((event) => event.eventType === 'analysis_run_completed')).toHaveLength(1);
    expect(new Set(allRunEvents.map((event) => event.entityId)).size).toBe(2);
  });

  it('keeps a late generator result from persisting recommendations after its deadline', async () => {
    const harness = createHarness({
      generationTimeoutMs: 20,
      generationAuthorityFactory: (captured) => ({
        ...captured,
        generateRecommendations: async (scope) => {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return captured.generateRecommendations(scope);
        },
      }),
    });

    await expect(runRequest(harness)).rejects.toThrow(/AI 分析.*未完成/);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(harness.recommendationRepository.findByFilterForStore(
      harness.context.storeId,
      {},
    )).toMatchObject({ items: [], total: 0 });
    expect(harness.service.getMissionAnalysisProjection(harness.context, harness.missionId)).toMatchObject({
      actionBatches: [],
      proposals: [],
      decisionLinks: [],
    });
    const events = harness.missionRepository
      .getMissionLineage(harness.context, harness.missionId)
      .causalEvents
      .filter((event) => event.entityType === 'analysis_run');
    expect(events.filter((event) => event.eventType === 'analysis_run_failed')).toHaveLength(1);
    expect(events.some((event) => event.eventType === 'analysis_run_completed')).toBe(false);
  });

  it('uses a bounded production default and rejects invalid analysis deadlines', () => {
    expect(DEFAULT_ANALYSIS_GENERATION_TIMEOUT_MS).toBe(120_000);
    expect(() => createHarness({ generationTimeoutMs: 0 })).toThrow(
      /generationTimeoutMs must be an integer between 1 and 900000/,
    );
    expect(() => createHarness({ generationTimeoutMs: 900_001 })).toThrow(
      /generationTimeoutMs must be an integer between 1 and 900000/,
    );
  });

  it('uses the logical Store display name when the Lingxing selector snapshot has a different name', async () => {
    const harness = createHarness({ batchStoreName: 'Lingxing External Selector Name' });

    await expect(runRequest(harness)).resolves.toMatchObject({
      generatedRecommendations: 1,
    });
  });

  it('runs real recommendation generation into a path-free evidence/proposal/Decision projection', async () => {
    const harness = createHarness();
    const result = await runRequest(harness);
    expect(result.evidencePackage.metricRowCount).toBe(9);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({
      adEntityId: 'opaque-keyword-1',
      source: 'rule_ai',
      authorization: { human: { eligible: true } },
    });
    expect(result.recommendationSummary).toEqual({
      candidates: 1,
      created: 1,
      refreshed: 0,
      reused: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(/\.xlsx|\.png|analysis-service-/i);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(projection.actionBatches).toEqual([
      expect.objectContaining({ id: result.proposals[0].actionBatchId, actionRevision: 1 }),
    ]);
    expect(projection.decisionLinks).toHaveLength(1);
    expect(projection.proposals).toHaveLength(1);
    const decision = harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    );
    expect(decision?.status).toBe('needs_approval');
    expect(decision).toMatchObject({ currentValue: 1.49, recommendedValue: 1.35 });
  });

  it('advances the Mission and records automatic fact and analysis checkpoints after a successful run', async () => {
    const harness = createHarness();

    const result = await runRequest(harness);
    const mission = harness.missionRepository.getMission(harness.context, harness.missionId);
    const lineage = harness.missionRepository.getMissionLineage(harness.context, harness.missionId);
    const actionBatch = harness.analysisRepository.getLatestActionBatch(harness.context, harness.missionId);

    expect(mission).toMatchObject({ status: 'active', phase: 'decision' });
    expect(actionBatch?.missionRevision).toBe(mission?.revision);
    expect(lineage.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'FACT',
        title: '8 类领星事实已封存',
        status: 'completed',
        evidenceCount: result.evidencePackage.reportTypes.length,
        actorId: 'analysis-agent',
      }),
      expect.objectContaining({
        stage: 'ANALYSIS',
        title: `分析完成，形成 ${result.proposals.length} 条可复核建议`,
        status: 'completed',
        evidenceCount: result.proposals.length,
        actorId: 'analysis-agent',
      }),
    ]));
  });

  it('persists one started-to-completed receipt for every successful analysis run', async () => {
    const harness = createHarness();

    const result = await runRequest(harness);
    const events = harness.missionRepository
      .getMissionLineage(harness.context, harness.missionId)
      .causalEvents
      .filter((event) => event.entityType === 'analysis_run')
      .sort((left, right) => left.sequence - right.sequence);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      stage: 'ANALYSIS',
      eventType: 'analysis_run_started',
      title: '分析已开始',
      status: 'running',
      source: 'analysis-authority',
      actorId: 'analysis-agent',
    });
    expect(events[1]).toMatchObject({
      stage: 'ANALYSIS',
      eventType: 'analysis_run_completed',
      entityId: events[0].entityId,
      title: '分析已完成',
      status: 'completed',
      source: 'analysis-authority',
      actorId: 'analysis-agent',
    });
    expect(events[1].signal).toContain(`形成 ${result.proposals.length} 条可复核建议`);
    expect(events[1].signal).toContain('规则与 AI 一致');
    expect(JSON.stringify(events)).not.toMatch(/\.xlsx|\.png|analysis-service-|packageHash|actionBatchId/i);
  });

  it('persists an actionable failed receipt without exposing the raw generation error', async () => {
    const harness = createHarness({
      generationAuthorityFactory: (captured) => ({
        ...captured,
        generateRecommendations: async () => {
          throw new Error('AI provider unavailable at secret-internal-endpoint');
        },
      }),
    });

    await expect(runRequest(harness)).rejects.toThrow('AI provider unavailable at secret-internal-endpoint');
    const events = harness.missionRepository
      .getMissionLineage(harness.context, harness.missionId)
      .causalEvents
      .filter((event) => event.entityType === 'analysis_run')
      .sort((left, right) => left.sequence - right.sequence);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventType: 'analysis_run_started',
      status: 'running',
    });
    expect(events[1]).toMatchObject({
      eventType: 'analysis_run_failed',
      entityId: events[0].entityId,
      title: '分析未完成',
      status: 'failed',
    });
    expect(events[1].signal).toContain('检查 AI 与策略配置后重试');
    expect(JSON.stringify(events)).not.toContain('secret-internal-endpoint');
    expect(events.some((event) => event.eventType === 'analysis_run_completed')).toBe(false);
  });

  it('reuses the same persisted analysis result when identical evidence is analyzed again', async () => {
    const harness = createHarness({ deduplicateRecommendations: true });

    await runRequest(harness);
    const firstMission = harness.missionRepository.getMission(harness.context, harness.missionId)!;
    const firstProjection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    const repeated = await runRequest(harness);
    const repeatedMission = harness.missionRepository.getMission(harness.context, harness.missionId)!;
    const repeatedProjection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    const checkpoints = harness.missionRepository.getMissionLineage(
      harness.context,
      harness.missionId,
    ).checkpoints;
    const runEvents = harness.missionRepository.getMissionLineage(
      harness.context,
      harness.missionId,
    ).causalEvents.filter((event) => event.entityType === 'analysis_run');

    expect(repeated.recommendationSummary).toEqual({
      candidates: 1,
      created: 0,
      refreshed: 0,
      reused: 1,
    });
    expect(repeatedMission.revision).toBe(firstMission.revision);
    expect(repeatedProjection).toEqual(firstProjection);
    expect(checkpoints.filter((checkpoint) => (
      checkpoint.stage === 'FACT' || checkpoint.stage === 'ANALYSIS'
    ))).toHaveLength(2);
    expect(runEvents.filter((event) => event.eventType === 'analysis_run_started')).toHaveLength(2);
    expect(runEvents.filter((event) => event.eventType === 'analysis_run_completed')).toHaveLength(2);
    expect(new Set(runEvents.map((event) => event.entityId)).size).toBe(2);
  });

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
        observedEffect: '关键词竞价降低后 ACOS 改善，广告订单保持稳定。',
        proofs: [expect.objectContaining({ sha256: '1'.repeat(64) })],
      }),
    ]);
    expect(harness.generationScopes[0].memoryDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(harness.generationScopes[0].memoryDigest).not.toBe('0'.repeat(64));
    expect(JSON.stringify(harness.generationScopes[0].causalMemory))
      .not.toMatch(/Renderer fabricated|createdAt|sequence|sessionGeneration/);
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
      blockers: expect.arrayContaining(['当前 AI 模型 revision 已变化；必须重新分析。']),
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

  it('issues one exact grant after explicit individual human Decisions', async () => {
    const harness = createHarness({ recommendationCount: 2 });
    const result = await runRequest(harness);
    expect(result.proposals).toHaveLength(2);
    approveHumanDecisions(harness);
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(authorized).toMatchObject({
      authorized: true,
      mode: 'manual_approval',
      proposalIds: expect.arrayContaining(result.proposals.map((proposal) => proposal.id)),
    });
    expect(authorized.grant?.issuer.type).toBe('human');
    expect(authorized.grant?.decisionIds).toHaveLength(2);
    for (const decisionId of authorized.decisionIds) {
      expect(harness.missionRepository.getDecision(harness.context, decisionId)?.status).toBe('approved');
    }
    expect(harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: [result.proposals[0].id],
    }).blockers).toContain('必须整批授权，不能只批准动作批次的一部分。');
    expect(harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    })).toMatchObject({ authorized: true, mode: 'manual_approval', grant: { id: authorized.grant?.id } });
  });

  it('policy-auto approves aligned Decisions and issues the same durable MissionGrant model', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const result = await runRequest(harness);
    expect(result.proposals[0].authorization.policy.eligible).toBe(true);
    expect(result.automaticAuthorization).toMatchObject({ authorized: true, mode: 'policy_auto' });
    expect(result.automaticAuthorization?.grant?.issuer.type).toBe('policy');
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(authorized).toMatchObject({ authorized: true, mode: 'policy_auto' });
    expect(authorized.grant?.issuer.type).toBe('policy');
    expect(authorized.grant?.id).toBe(result.automaticAuthorization?.grant?.id);
    const decision = harness.missionRepository.getDecision(harness.context, authorized.decisionIds[0]);
    expect(decision?.status).toBe('approved');
  });

  it('uses the lowest numeric matching policy instead of the most recently enabled policy', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const missionPolicy = harness.missionRepository.getPolicyVersion(
      harness.context,
      harness.policyVersionId,
    )!;
    const laterPolicy = harness.missionRepository.createPolicy(harness.context, {
      id: 'policy-later-high-priority-number',
      name: 'Later broad fallback policy',
      scope: 'store',
      priority: 100,
      actorId: 'operator',
    });
    const laterDraft = harness.missionRepository.createPolicyVersion(harness.context, {
      id: 'policy-later-high-priority-number-v1',
      policyId: laterPolicy.id,
      version: 1,
      rules: missionPolicy.rules,
      actorId: 'operator',
    });
    const laterVersion = harness.missionRepository.enablePolicyVersion(harness.context, {
      policyId: laterPolicy.id,
      versionId: laterDraft.id,
      expectedPolicyRevision: laterPolicy.revision,
      expectedVersionRevision: laterDraft.revision,
      actorId: 'operator',
    });
    const runtime = harness.missionRepository.getPolicyRuntime(harness.context);
    harness.missionRepository.updatePolicyRuntime(harness.context, {
      expectedRevision: runtime.revision,
      actorId: 'operator',
      patch: {
        autonomyMode: 'policy_auto',
        activePolicyVersionId: laterVersion.id,
      },
    });

    const result = await runRequest(harness);

    expect(result.proposals[0].authorization.policy).toEqual({ eligible: true, blockers: [] });
    expect(result.automaticAuthorization).toMatchObject({
      authorized: true,
      mode: 'policy_auto',
      grant: { policyVersionId: harness.policyVersionId },
    });
  });

  it('blocks a Mission policy when a newly enabled lower-number policy now matches the same Ads object', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const missionPolicy = harness.missionRepository.getPolicyVersion(
      harness.context,
      harness.policyVersionId,
    )!;
    const lowerPolicy = harness.missionRepository.createPolicy(harness.context, {
      id: 'policy-new-lower-number',
      name: 'New first-match policy',
      scope: 'store',
      priority: 0,
      actorId: 'operator',
    });
    const lowerDraft = harness.missionRepository.createPolicyVersion(harness.context, {
      id: 'policy-new-lower-number-v1',
      policyId: lowerPolicy.id,
      version: 1,
      rules: missionPolicy.rules,
      actorId: 'operator',
    });
    harness.missionRepository.enablePolicyVersion(harness.context, {
      policyId: lowerPolicy.id,
      versionId: lowerDraft.id,
      expectedPolicyRevision: lowerPolicy.revision,
      expectedVersionRevision: lowerDraft.revision,
      actorId: 'operator',
    });

    const result = await runRequest(harness);

    expect(result.proposals[0].authorization.policy.blockers).toContain('POLICY_PRIORITY_MISMATCH');
    expect(result.automaticAuthorization).toMatchObject({
      authorized: false,
      mode: 'policy_auto',
    });
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
  });

  it('does not issue or dispatch a policy grant for legacy metadata without an explicit aligned rule-AI decision', async () => {
    const onAutomaticGrantIssued = vi.fn();
    const harness = createHarness({
      autonomyMode: 'policy_auto',
      onAutomaticGrantIssued,
      recommendationEvidencePatch: {
        decisionSource: undefined,
        decisionAgreement: undefined,
        decisionRequiresReview: undefined,
        aiStrategySource: 'ai',
        explanationSource: 'ai',
      },
    });

    const result = await runRequest(harness);
    expect(result.proposals[0]).toMatchObject({
      source: 'rule',
      authorization: {
        policy: {
          eligible: false,
          blockers: expect.arrayContaining(['POLICY_REQUIRES_RULE_AI_ALIGNMENT']),
        },
      },
    });
    expect(result.automaticAuthorization).toMatchObject({
      authorized: false,
      mode: 'policy_auto',
    });
    expect(onAutomaticGrantIssued).not.toHaveBeenCalled();
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
  });

  it('notifies execution exactly once for a policy-auto grant and never for manual authorization', async () => {
    const onAutomaticGrantIssued = vi.fn();
    const automaticHarness = createHarness({
      autonomyMode: 'policy_auto',
      onAutomaticGrantIssued,
    });

    const automatic = await runRequest(automaticHarness);
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);
    expect(onAutomaticGrantIssued).toHaveBeenCalledWith(
      automaticHarness.context,
      automatic.automaticAuthorization?.grant,
    );
    automaticHarness.service.authorizeProposalBatch({
      context: automaticHarness.context,
      missionId: automaticHarness.missionId,
      proposalIds: automatic.proposals.map((proposal) => proposal.id),
    });
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);

    const manualHarness = createHarness({ onAutomaticGrantIssued });
    const manual = await runRequest(manualHarness);
    manualHarness.service.authorizeProposalBatch({
      context: manualHarness.context,
      missionId: manualHarness.missionId,
      proposalIds: manual.proposals.map((proposal) => proposal.id),
    });
    expect(onAutomaticGrantIssued).toHaveBeenCalledTimes(1);
  });

  it('never downgrades an automatic authorization attempt into a human grant when mode changes', async () => {
    const harness = createHarness({ autonomyMode: 'policy_auto' });
    const readRuntime = harness.missionRepository.getPolicyRuntime.bind(harness.missionRepository);
    let reads = 0;
    vi.spyOn(harness.missionRepository, 'getPolicyRuntime').mockImplementation((context) => {
      const runtime = readRuntime(context);
      reads += 1;
      return reads === 1 ? runtime : { ...runtime, autonomyMode: 'manual_approval' };
    });
    const result = await runRequest(harness);
    expect(result.automaticAuthorization).toMatchObject({
      authorized: false,
      mode: 'policy_auto',
      blockers: [expect.stringMatching(/未降级为人工授权/)],
    });
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('needs_approval');
  });

  it('keeps rule fallback and missing opaque Ads identity visible but non-authorizable', async () => {
    const harness = createHarness({ withWritableTarget: false, fallback: true });
    const result = await runRequest(harness);
    expect(result.proposals[0]).toMatchObject({
      source: 'rule_fallback',
      authorization: {
        human: { eligible: false },
        policy: { eligible: false },
      },
    });
    expect(result.proposals[0].authorization.human.blockers).toEqual(expect.arrayContaining([
      'MISSING_STABLE_AD_ENTITY',
      'RULE_FALLBACK_NOT_AUTHORIZABLE',
    ]));
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('blocked');
  });

  it('derives product scope and proof authority in Main instead of trusting Renderer fields or arbitrary files', async () => {
    const harness = createHarness({ proofAllowed: false });
    const result = await runRequest(harness);
    expect(result.evidencePackage.asin).toBe('B0TEST');
    expect(result.proposals[0].adEntityId).toBeUndefined();
    expect(result.proposals[0].authorization.human.blockers).toContain('MISSING_STABLE_AD_ENTITY');
    expect(result.ai.detail).not.toMatch(/provider unavailable|AI and rules aligned/i);
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
    expect(authorization.blockers).not.toContain('当前规则 revision 已变化；必须重新分析。');
    expect(authorization.blockers).not.toContain('当前 AI 模型 revision 已变化；必须重新分析。');
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
    expect(missionBlocked.blockers).toContain('Mission 已修订；旧分析建议必须重新运行后才能授权。');

    const ruleHarness = createHarness();
    const ruleResult = await runRequest(ruleHarness);
    ruleHarness.ruleRevision.value = 'b'.repeat(64);
    expect(ruleHarness.service.authorizeProposalBatch({
      context: ruleHarness.context,
      missionId: ruleHarness.missionId,
      proposalIds: ruleResult.proposals.map((proposal) => proposal.id),
    }).blockers).toContain('当前规则 revision 已变化；必须重新分析。');

    const modelHarness = createHarness();
    const modelResult = await runRequest(modelHarness);
    modelHarness.modelRevision.value = 'changed-ai-runtime-revision';
    expect(modelHarness.service.authorizeProposalBatch({
      context: modelHarness.context,
      missionId: modelHarness.missionId,
      proposalIds: modelResult.proposals.map((proposal) => proposal.id),
    }).blockers).toContain('当前 AI 模型 revision 已变化；必须重新分析。');

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
    }).blockers).toContain('只能授权当前 Mission 的最新分析动作批次。');
  });

  it('rolls back batch Decision approvals when immutable grant issuance fails', async () => {
    const harness = createHarness({ recommendationCount: 2, autonomyMode: 'policy_auto' });
    vi.spyOn(harness.missionRepository, 'issueMissionGrant').mockImplementation(() => {
      throw new Error('simulated grant insert failure');
    });
    await expect(runRequest(harness)).rejects.toThrow(/simulated grant insert failure/);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    expect(projection.decisionLinks.map((link) => (
      harness.missionRepository.getDecision(harness.context, link.decisionId)?.status
    ))).toEqual(['needs_approval', 'needs_approval']);
    expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toEqual([]);
  });

  it('does not resurrect a revoked grant for the same action revision', async () => {
    const harness = createHarness();
    const result = await runRequest(harness);
    approveHumanDecisions(harness);
    const authorized = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    harness.missionRepository.appendMissionGrantEvent(harness.context, {
      id: 'grant-event-revoked-test',
      grantId: authorized.grant!.id,
      eventType: 'revoked',
      actorId: 'operator',
      reason: 'facts changed',
    });
    const repeated = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(repeated).toMatchObject({ authorized: false, mode: 'manual_approval' });
    expect(repeated.blockers.join(' ')).toMatch(/revoked/);
  });

  it('fails closed outside the immutable policy execution window', async () => {
    const harness = createHarness({
      executionWindow: {
        timeZone: 'America/Los_Angeles',
        daysOfWeek: [3],
        start: '06:00',
        end: '07:00',
      },
    });
    const result = await runRequest(harness);
    approveHumanDecisions(harness);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked).toMatchObject({ authorized: false });
    expect(blocked.blockers.join(' ')).toMatch(/执行窗口/);
  });

  it('does not charge daily action capacity for a previously issued but unused grant', async () => {
    const harness = createHarness({ maxDailyActionCount: 1 });
    const result = await runRequest(harness);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    seedPriorGrant(harness, projection.decisionLinks[0].decisionId, result.proposals[0].adEntityId!);
    approveHumanDecisions(harness);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked).toMatchObject({ authorized: true, blockers: [] });
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('approved');
  });

  it('does not start entity cooldown from grant issuance without a submit intent', async () => {
    const harness = createHarness({ cooldownMinutes: 90 });
    const result = await runRequest(harness);
    const projection = harness.service.getMissionAnalysisProjection(harness.context, harness.missionId);
    seedPriorGrant(harness, projection.decisionLinks[0].decisionId, result.proposals[0].adEntityId!);
    approveHumanDecisions(harness);
    const blocked = harness.service.authorizeProposalBatch({
      context: harness.context,
      missionId: harness.missionId,
      proposalIds: result.proposals.map((proposal) => proposal.id),
    });
    expect(blocked).toMatchObject({ authorized: true, blockers: [] });
    expect(harness.missionRepository.getDecision(
      harness.context,
      projection.decisionLinks[0].decisionId,
    )?.status).toBe('approved');
  });

  it('persists a fresh receipt while reusing the same legal result without a second generator call', async () => {
    const harness = createHarness();
    const first = await runRequest(harness);
    const firstRuns = harness.service.listAnalysisRuns(harness.context, { missionId: harness.missionId });
    expect(firstRuns).toHaveLength(1);
    expect(firstRuns[0]).toMatchObject({ status: 'completed', reportSnapshotId: 'run-1', metadata: {
      storeContext: harness.context, provenance: 'analysis-authority/v16', historicalOnly: false,
      evidencePackageId: first.evidencePackage.id, actionBatchId: first.proposals[0].actionBatchId,
    } });
    const repeated = await runRequest(harness);
    const runs = harness.service.listAnalysisRuns(harness.context, { missionId: harness.missionId });
    expect(runs).toHaveLength(2);
    expect(new Set(runs.map(run => run.runId)).size).toBe(2);
    expect(runs.some(run => run.metadata?.reusedFromRunId === firstRuns[0].runId)).toBe(true);
    expect(harness.generationScopes).toHaveLength(1);
    expect(repeated.proposals).toEqual(first.proposals);
    expect(harness.service.getMissionAnalysisProjection(harness.context, harness.missionId).actionBatches).toHaveLength(1);
    expect(JSON.stringify(runs)).not.toMatch(/recommendationFingerprint|generation|proofPath|signal|stack/);
    const row = harness.database.prepare('SELECT * FROM analysis_runs WHERE run_id = ?').get(firstRuns[0].runId) as Record<string, unknown>;
    expect(row.status).toBe('completed');
  });

  it('filters persisted analysis history before applying the requested limit and keeps interrupted runs visible', async () => {
    const h = createHarness(); await runRequest(h);
    const completed = h.service.listAnalysisRuns(h.context)[0];
    h.database.prepare(`INSERT INTO analysis_runs (run_id,store_id,mission_id,report_snapshot_id,status,recommendations_count,metadata,created_at,updated_at)
      SELECT 'newer-interrupted',store_id,mission_id,report_snapshot_id,'analyzing',0,metadata,'2099-01-01','2099-01-01' FROM analysis_runs WHERE run_id=?`).run(completed.runId);
    expect(h.service.listAnalysisRuns(h.context, { status: 'completed', limit: 1 }).map(r => r.runId)).toEqual([completed.runId]);
    expect(h.service.listAnalysisRuns(h.context, { status: 'blocked', limit: 1 })).toMatchObject([{ runId: 'newer-interrupted', status: 'blocked' }]);
    h.database.prepare('UPDATE analysis_runs SET blocked_reason=?, metadata=? WHERE run_id=?').run(
      'provider failed at C:/private/keys.json', JSON.stringify({ ...completed.metadata, aiSummary: { configured: true, invoked: true, source: 'ai', detail: 'C:/private/keys.json' }, rawCredential: 'legacy-secret' }), 'newer-interrupted');
    const projected = h.service.getAnalysisRun(h.context, 'newer-interrupted');
    expect(JSON.stringify(projected)).not.toMatch(/private|keys.json|legacy-secret/);
    expect(h.database.prepare('SELECT metadata FROM analysis_runs WHERE run_id=?').get('newer-interrupted')).toMatchObject({ metadata: expect.stringContaining('legacy-secret') });
  });
  it('blocks duplicate clicks before generation and projects a crashed pending receipt as interrupted', async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const harness = createHarness({ generationAuthorityFactory: captured => ({ ...captured, generateRecommendations: async scope => {
      entered(); await hold; return captured.generateRecommendations(scope);
    } }) });
    const running = runRequest(harness);
    await waiting;
    await expect(runRequest(harness)).rejects.toThrow(/正在分析/);
    const active = harness.service.listAnalysisRuns(harness.context, { missionId: harness.missionId });
    expect(active).toHaveLength(1);
    expect(active[0].status).toBe('analyzing');
    release(); await running;
    harness.database.prepare("UPDATE analysis_runs SET status = 'analyzing', completed_at = NULL WHERE run_id = ?").run(active[0].runId);
    expect(harness.service.getAnalysisRun(harness.context, active[0].runId)).toMatchObject({ status: 'blocked', blockedReason: expect.stringMatching(/已中断/) });
    expect(harness.database.prepare('SELECT status FROM analysis_runs WHERE run_id = ?').get(active[0].runId)).toEqual({ status: 'analyzing' });
  });
});


it('rejects analysis finalization after a durable authority mode round trip', async () => {
  let harness: Harness;
  harness = createHarness({ generationAuthorityFactory: captured => ({ ...captured, generateRecommendations: async scope => {
    const generated = await captured.generateRecommendations(scope);
    for (const autonomyMode of ['policy_auto', 'manual_approval'] as const) {
      const runtime = harness.missionRepository.getPolicyRuntime(harness.context);
      harness.missionRepository.updatePolicyRuntime(harness.context, { expectedRevision: runtime.revision, actorId: 'operator', patch: { autonomyMode, reason: 'mode drift regression' } });
    }
    return generated;
  } }) });
  await expect(runRequest(harness)).rejects.toThrow(/模式或策略在分析期间已变化/);
  expect(harness.service.getMissionAnalysisProjection(harness.context, harness.missionId).actionBatches).toHaveLength(0);
  expect(harness.missionRepository.listMissionGrants(harness.context, harness.missionId)).toHaveLength(0);
});
