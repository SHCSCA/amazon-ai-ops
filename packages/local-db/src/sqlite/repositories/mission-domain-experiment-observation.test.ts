import { describe, expect, it } from 'vitest';
import { NOW, seedExperimentObservationAuthority } from './mission-domain-repo.test-data';
import  {
  createHarness,
  seedActiveMission,
  seedVerifiedReadbackDecision,
  expectRepositoryError,
} from './mission-domain-repo.test-harness';
describe("MissionDomainRepository decisions, experiments, and causal ledger", () => {
it('captures the post-window batch and completes an Experiment with a machine-derived result', () => {
    let currentNow = new Date(NOW);
    const { database, repository, contextOne } = createHarness(() => currentNow);
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-machine-evaluation',
      missionId: verified.mission.id,
      name: 'Evaluate the measured keyword intervention',
      hypothesis: 'The verified bid reduction improves ACOS while preserving attributed orders.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start from the verified intervention.',
    });
    const resultBatchId = seedExperimentObservationAuthority(database, contextOne, {
      missionId: verified.mission.id,
      productId: verified.mission.productId!,
      adEntityId: verified.decision.adEntityId!,
      clicks: 10,
      cost: 15,
      orders: 2,
      sales: 50,
    });
    currentNow = new Date('2026-07-30T12:00:00.000Z');

    const completed = repository.evaluateExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      actorId: 'experiment-evaluator',
    });

    expect(completed.status).toBe('completed');
    expect(completed.conclusion).toContain('ACOS：0.4 → 0.3');
    expect(completed.conclusion).toContain('广告订单结果为基线的 100%');
    expect(repository.listExperimentMetricSnapshots(contextOne, running.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'ACOS', value: 0.3, dataBatchId: resultBatchId }),
      expect.objectContaining({ metric: '广告订单', value: 2, dataBatchId: resultBatchId }),
    ]));
    expect(repository.listCausalEvents(contextOne, { missionId: verified.mission.id })
      .filter((event) => event.entityId === running.id && event.eventType === 'experiment_completed'))
      .toHaveLength(1);
    expect(repository.getMission(contextOne, verified.mission.id)).toMatchObject({
      status: 'completed',
      phase: 'effect',
      revision: verified.mission.revision + 1,
    });
    expect(repository.listMissionCheckpoints(contextOne, verified.mission.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: 'EFFECT',
        title: '经营实验完成效果评估',
        status: 'completed',
        evidenceCount: 2,
        actorId: 'experiment-evaluator',
      }),
    ]));
    expect(repository.listAnalysisCausalMemory(contextOne, {
      productId: verified.mission.productId!,
      limit: 40,
    })).toEqual([expect.objectContaining({
      eventType: 'experiment_completed',
      entityId: running.id,
      observedEffect: completed.conclusion,
      proofs: [expect.objectContaining({
        evidenceType: 'experiment_result_snapshot',
        evidenceRef: expect.stringMatching(/^experiment-result:[a-f0-9]{64}$/),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })],
    })]);
    const archivedExperiment = repository.archiveExperiment(contextOne, {
      id: completed.id,
      expectedRevision: completed.revision,
      actorId: 'operator',
      reason: 'Hide the completed experiment from the default queue.',
    });
    const restoredExperiment = repository.restoreExperiment(contextOne, {
      id: archivedExperiment.id,
      expectedRevision: archivedExperiment.revision,
      actorId: 'operator',
      reason: 'Show the immutable completed experiment again.',
    });
    expect(restoredExperiment.status).toBe('completed');

    const completedMission = repository.getMission(contextOne, verified.mission.id)!;
    const archivedMission = repository.archiveMission(contextOne, {
      id: completedMission.id,
      expectedRevision: completedMission.revision,
      actorId: 'operator',
      reason: 'Hide the completed Mission from the default queue.',
    });
    const restoredMission = repository.restoreMission(contextOne, {
      id: archivedMission.id,
      expectedRevision: archivedMission.revision,
      actorId: 'operator',
      reason: 'Show the immutable completed Mission again.',
    });
    expect(restoredMission).toMatchObject({ status: 'completed', phase: 'effect' });
  });

it('keeps a Mission active and lets the next draft Experiment start after one Experiment completes', () => {
    let currentNow = new Date(NOW);
    const { database, repository, contextOne } = createHarness(() => currentNow);
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version);
    const firstDraft = repository.createExperiment(contextOne, {
      id: 'experiment-first-of-two',
      missionId: verified.mission.id,
      name: 'Evaluate the first measured intervention',
      hypothesis: 'The first verified bid reduction improves ACOS while preserving attributed orders.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const nextDraft = repository.createExperiment(contextOne, {
      id: 'experiment-second-of-two',
      missionId: verified.mission.id,
      name: 'Observe the next measured intervention',
      hypothesis: 'A second bounded observation remains runnable after the first result is recorded.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-31T12:00:00.000Z',
      observationEndsAt: '2026-08-07T12:00:00.000Z',
    });
    const firstRunning = repository.transitionExperiment(contextOne, {
      id: firstDraft.id,
      expectedRevision: firstDraft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start the first verified intervention.',
    });
    seedExperimentObservationAuthority(database, contextOne, {
      missionId: verified.mission.id,
      productId: verified.mission.productId!,
      adEntityId: verified.decision.adEntityId!,
      clicks: 10,
      cost: 15,
      orders: 2,
      sales: 50,
    });
    currentNow = new Date('2026-07-30T12:00:00.000Z');

    const firstCompleted = repository.evaluateExperiment(contextOne, {
      id: firstRunning.id,
      expectedRevision: firstRunning.revision,
      actorId: 'experiment-evaluator',
    });

    expect(firstCompleted.status).toBe('completed');
    expect(repository.getMission(contextOne, verified.mission.id)).toMatchObject({
      status: 'active',
      phase: 'effect',
      revision: verified.mission.revision + 1,
    });

    const nextRunning = repository.transitionExperiment(contextOne, {
      id: nextDraft.id,
      expectedRevision: nextDraft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start the next verified observation after recording the first effect.',
    });

    expect(nextRunning).toMatchObject({
      status: 'running',
      baseline: {
        source: 'verified_ads_readback',
        decisionId: verified.decision.id,
        adEntityId: verified.decision.adEntityId,
      },
    });
    expect(repository.getMission(contextOne, verified.mission.id)).toMatchObject({
      status: 'active',
      phase: 'effect',
    });
  });

it('pauses an Experiment and records one effect when a measured guardrail is breached', () => {
    let currentNow = new Date(NOW);
    const { database, repository, contextOne } = createHarness(() => currentNow);
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-guardrail-breach',
      missionId: verified.mission.id,
      name: 'Stop on attributed-order guardrail',
      hypothesis: 'The verified bid reduction must preserve at least 95 percent of attributed orders.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start from the verified intervention.',
    });
    seedExperimentObservationAuthority(database, contextOne, {
      missionId: verified.mission.id,
      productId: verified.mission.productId!,
      adEntityId: verified.decision.adEntityId!,
      clicks: 10,
      cost: 15,
      orders: 1,
      sales: 50,
    });
    currentNow = new Date('2026-07-30T12:00:00.000Z');

    const paused = repository.evaluateExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      actorId: 'experiment-evaluator',
    });

    expect(paused.status).toBe('paused');
    expect(paused.conclusion).toContain('守护栏触发，实验已停止继续观察');
    expect(paused.conclusion).toContain('广告订单结果为基线的 50%');
    const experimentEffects = repository.listCausalEvents(contextOne, { missionId: verified.mission.id })
      .filter((event) => event.entityId === running.id);
    expect(experimentEffects.filter((event) => event.eventType === 'experiment_guardrail_triggered'))
      .toHaveLength(1);
    expect(experimentEffects.filter((event) => event.eventType === 'experiment_completed'))
      .toHaveLength(0);
    expect(repository.getMission(contextOne, verified.mission.id)).toMatchObject({
      status: 'blocked',
      phase: 'effect',
      revision: verified.mission.revision + 1,
    });
    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: paused.id,
      expectedRevision: paused.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Ignore the measured guardrail and keep running.',
    }), 'STATE_CONFLICT');
    expect(repository.getExperiment(contextOne, paused.id)).toMatchObject({
      status: 'paused',
      revision: paused.revision,
      conclusion: paused.conclusion,
    });
  });

it('keeps an Experiment running when an operator tries to complete it before the observation window ends', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-early-completion',
      missionId: verified.mission.id,
      name: 'Observe one verified keyword intervention',
      hypothesis: 'The bounded keyword bid change improves ACOS without breaching the order guardrail.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { bidUsd: 1 },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start the evidence-bound observation window.',
    });

    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      status: 'completed',
      actorId: 'operator',
      reason: 'Looks good to me.',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, running.id)).toMatchObject({
      status: 'running',
      revision: running.revision,
      conclusion: undefined,
    });
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id })
      .filter((event) => event.entityId === running.id && event.eventType === 'experiment_completed'))
      .toEqual([]);
  });

it('freezes the Experiment causal contract after its first verified start', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-frozen-after-start',
      missionId: verified.mission.id,
      name: 'Freeze one verified intervention',
      hypothesis: 'The verified bid reduction improves ACOS without breaching the order guardrail.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { ignored: true },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start from the verified intervention.',
    });
    const paused = repository.transitionExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      status: 'paused',
      actorId: 'operator',
      reason: 'Pause without changing the causal contract.',
    });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: paused.id,
      expectedRevision: paused.revision,
      actorId: 'operator',
      patch: { variant: { bidUsd: 0.5, onlyVariable: 'keyword_bid' } },
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, paused.id)).toMatchObject({
      status: 'paused',
      revision: paused.revision,
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
    });
  });

it('keeps an Experiment running after the window when required metric snapshots are missing', () => {
    let currentNow = new Date(NOW);
    const { database, repository, contextOne } = createHarness(() => currentNow);
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-missing-evaluation-snapshots',
      missionId: verified.mission.id,
      name: 'Require measured experiment results',
      hypothesis: 'The keyword intervention improves ACOS while preserving attributed orders.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { bidUsd: 1 },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const running = repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start the evidence-bound observation window.',
    });
    currentNow = new Date('2026-07-30T12:00:00.000Z');

    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: running.id,
      expectedRevision: running.revision,
      status: 'completed',
      actorId: 'operator',
      reason: 'The operator believes the result is positive.',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, running.id)).toMatchObject({
      status: 'running',
      revision: running.revision,
      conclusion: undefined,
    });
  });

it.each(['latest-partial-import', 'before-intervention', 'ambiguous-guardrail'] as const)('rejects experiment %s without persisting a baseline or EFFECT', failure => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version);
    const input = { id: `experiment-${failure}`, missionId: mission.id, name: 'Reject unverifiable observation',
      hypothesis: 'Only verified full-window inputs may form an effect.', primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'], guardrailCriteria: [failure === 'ambiguous-guardrail' ? '广告订单变化 >= 95%' : '广告订单 >= 95%'],
      productId: mission.productId, adEntityId: verified.decision.adEntityId, baseline: {}, variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: failure === 'before-intervention' ? '2026-07-22T11:59:59.999Z' : NOW, observationEndsAt: '2026-07-29T12:00:00.000Z' };
    if (failure === 'ambiguous-guardrail') {
      expectRepositoryError(() => repository.createExperiment(contextOne, input), 'INVALID_INPUT');
    } else {
      const draft = repository.createExperiment(contextOne, input);
      if (failure === 'latest-partial-import') {
        database.prepare(`INSERT INTO report_import_runs(store_id,run_id,idempotency_key,input_fingerprint,batch_id,status,
          source_file_count,metric_row_count,reconciliation_count,started_at,completed_at,created_at)
          VALUES(?,'newer-incomplete','newer-incomplete',?,?,'completed',7,1,7,?,?,?)`).run(contextOne.storeId,'e'.repeat(64),mission.dataBatchId,
          '2026-07-22T12:00:01.000Z','2026-07-22T12:00:01.000Z','2026-07-22T12:00:01.000Z');
      }
      expectRepositoryError(() => repository.transitionExperiment(contextOne, { id: draft.id, expectedRevision: draft.revision, status: 'running', actorId: 'operator' }), 'STATE_CONFLICT');
      expect(repository.getExperiment(contextOne, draft.id)).toMatchObject({ status: 'draft', revision: draft.revision, baseline: {} });
    }
    expect(database.prepare('SELECT COUNT(*) AS count FROM experiment_metric_snapshots WHERE store_id=? AND experiment_id=?').get(contextOne.storeId,input.id)).toEqual({ count: 0 });
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id }).some(event => event.stage === 'EFFECT')).toBe(false);
  });
});
