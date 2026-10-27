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
