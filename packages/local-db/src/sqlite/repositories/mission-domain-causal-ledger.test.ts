import { describe, expect, it } from 'vitest';
import  {
  createHarness,
  seedActiveMission,
  seedDecisionAnalysis,
  expectRepositoryError,
} from './mission-domain-repo.test-harness';
describe("MissionDomainRepository decisions, experiments, and causal ledger", () => {
it('returns only same-product proven non-UNKNOWN causal memory for Main analysis', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const otherProductMission = repository.createMission(contextOne, {
      id: 'mission-other-product-memory',
      dataBatchId: mission.dataBatchId,
      policyVersionId: version.id,
      title: 'Other product memory source',
      objective: 'Prove product-scoped memory isolation.',
      productId: `${contextOne.storeId}-product-2`,
      observationStartsAt: '2026-07-22T00:00:00.000Z',
      observationEndsAt: '2026-07-29T00:00:00.000Z',
      successCriteria: ['Keep products isolated'],
      guardrails: ['Never mix causal memory'],
      actorId: 'operator',
    });
    const appendEffect = (input: {
      id: string;
      missionId: string;
      status?: string;
      observedEffect?: string;
      correctsEventId?: string;
    }) => repository.appendCausalEvent(contextOne, {
      id: input.id,
      stage: 'EFFECT',
      eventType: input.correctsEventId ? 'experiment_effect_correction' : 'experiment_effect',
      entityType: 'experiment',
      entityId: input.correctsEventId ?? input.id,
      missionId: input.missionId,
      title: `Causal memory ${input.id}`,
      observedEffect: input.observedEffect ?? 'ACOS improved with stable orders.',
      status: input.status ?? 'verified',
      source: 'experiment-evaluator',
      actorId: 'experiment-evaluator',
      ...(input.correctsEventId ? { correctsEventId: input.correctsEventId } : {}),
    });
    const addProof = (eventId: string, ordinal: number) => repository.appendEvidenceRef(contextOne, {
      id: `memory-proof-${ordinal}`,
      eventId,
      evidenceType: 'experiment_result',
      evidenceRef: `artifact:experiment-result:${ordinal}`,
      sha256: ordinal.toString(16).repeat(64),
    });

    const valid = appendEffect({ id: 'memory-valid', missionId: mission.id });
    addProof(valid.id, 1);
    const unknown = appendEffect({ id: 'memory-unknown', missionId: mission.id, status: 'still_unknown' });
    addProof(unknown.id, 2);
    appendEffect({ id: 'memory-without-proof', missionId: mission.id });
    const otherProduct = appendEffect({ id: 'memory-other-product', missionId: otherProductMission.id });
    addProof(otherProduct.id, 3);
    const corrected = appendEffect({ id: 'memory-corrected', missionId: mission.id });
    addProof(corrected.id, 4);
    appendEffect({
      id: 'memory-correction',
      missionId: mission.id,
      observedEffect: 'Corrected measurement supersedes the old effect.',
      correctsEventId: corrected.id,
    });
    const reconciledUnknown = repository.appendCausalEvent(contextOne, {
      id: 'memory-unknown-reconciled-target',
      stage: 'READBACK',
      eventType: 'execution_unknown_reconciled',
      entityType: 'ad_execution_batch',
      entityId: 'unknown-execution-batch',
      missionId: mission.id,
      title: 'Unknown execution reconciliation',
      observedEffect: 'Two read-only observations found the target bid, but the original batch remains UNKNOWN.',
      status: 'confirmed_target',
      source: 'execution-authority',
      actorId: 'operator',
    });
    repository.appendEvidenceRef(contextOne, {
      id: 'memory-unknown-reconciled-proof-first',
      eventId: reconciledUnknown.id,
      evidenceType: 'ad_execution_reconciliation_first',
      evidenceRef: 'artifact:execution-reconciliation:first',
      sha256: '5'.repeat(64),
    });
    repository.appendEvidenceRef(contextOne, {
      id: 'memory-unknown-reconciled-proof-reload',
      eventId: reconciledUnknown.id,
      evidenceType: 'ad_execution_reconciliation_reload',
      evidenceRef: 'artifact:execution-reconciliation:reload',
      sha256: '6'.repeat(64),
    });

    const first = repository.listAnalysisCausalMemory(contextOne, {
      productId: mission.productId!,
      limit: 40,
    });
    const second = repository.listAnalysisCausalMemory(contextOne, {
      productId: mission.productId!,
      limit: 40,
    });

    expect(first).toEqual(second);
    expect(first).toEqual([expect.objectContaining({
      eventId: valid.id,
      missionId: mission.id,
      stage: 'EFFECT',
      entityType: 'experiment',
      entityId: valid.entityId,
      businessDate: contextOne.businessDate,
      sessionGeneration: contextOne.sessionGeneration,
      observedEffect: 'ACOS improved with stable orders.',
      proofs: [expect.objectContaining({
        evidenceType: 'experiment_result',
        evidenceRef: 'artifact:experiment-result:1',
        sha256: '1'.repeat(64),
      })],
    })]);
    expect(repository.listAnalysisCausalMemory(contextOne, { productId: '', limit: 40 }))
      .toEqual([]);
  });

it('rolls back a causal event when its complete evidence set cannot be appended atomically', () => {
    const { repository, database, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const eventId = 'causal-atomic-readback-event';

    expectRepositoryError(() => repository.appendCausalEventWithEvidence(contextOne, {
      id: eventId,
      stage: 'READBACK',
      eventType: 'execution_unknown_reconciled',
      entityType: 'ad_execution_batch',
      entityId: 'unknown-batch-atomic',
      missionId: mission.id,
      title: 'Atomic reconciliation evidence',
      observedEffect: 'Two read-only observations were attempted.',
      status: 'confirmed_target',
      source: 'execution-authority',
      actorId: 'operator',
    }, [{
      id: 'duplicate-atomic-evidence-id',
      eventId,
      evidenceType: 'ad_execution_reconciliation_first',
      evidenceRef: 'artifact:execution-reconciliation:atomic-first',
      sha256: '7'.repeat(64),
    }, {
      id: 'duplicate-atomic-evidence-id',
      eventId,
      evidenceType: 'ad_execution_reconciliation_reload',
      evidenceRef: 'artifact:execution-reconciliation:atomic-reload',
      sha256: '8'.repeat(64),
    }]), 'DUPLICATE_IDENTITY');

    expect(repository.listCausalEvents(contextOne, { missionId: mission.id })
      .some((event) => event.id === eventId)).toBe(false);
    expect(database.prepare(`
      SELECT COUNT(*) AS count
      FROM evidence_refs
      WHERE store_id = ? AND event_id = ?
    `).get(contextOne.storeId, eventId)).toEqual({ count: 0 });
  });

it('retains decision history, experiment observations, evidence, and causal corrections', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const decision = repository.createDecision(contextOne, {
      id: 'decision-one',
      missionId: mission.id,
      dataBatchId: mission.dataBatchId,
      policyVersionId: version.id,
      policyRevision: version.revision,
      actionRevision: 1,
      title: 'Lower one keyword bid',
      rationale: 'Spend rose while attributed sales stayed flat.',
      recommendation: 'Lower keyword bid from 1.00 to 0.92 USD.',
      facts: ['Seven-day spend increased 18%.'],
      alternatives: ['Keep bid unchanged and observe three more days.'],
      expectedEffect: 'Reduce inefficient spend with limited traffic loss.',
      validUntil: '2026-07-23T00:00:00.000Z',
      actionType: 'set_keyword_bid',
      adEntityId: `${contextOne.storeId}-keyword-1`,
      productId: `${contextOne.storeId}-product-1`,
      currentValue: 1,
      recommendedValue: 0.92,
      confidence: 0.82,
      status: 'needs_approval',
      actorId: 'ai-analyst',
    });
    const revised = repository.reviseDecision(contextOne, {
      id: decision.id,
      expectedRevision: decision.revision,
      recommendation: 'Lower keyword bid from 1.00 to 0.94 USD.',
      recommendedValue: 0.94,
      actorId: 'operator',
    });
    const approved = repository.resolveDecision(contextOne, {
      id: revised.id,
      expectedRevision: revised.revision,
      status: 'approved',
      actorId: 'operator',
      reason: 'Within the configured policy envelope.',
    });
    seedDecisionAnalysis(database, approved, mission);
    const executed = repository.resolveDecision(contextOne, {
      id: approved.id,
      expectedRevision: approved.revision,
      status: 'executed',
      actorId: 'executor-one',
      reason: 'Amazon Ads write submitted with verified identity.',
    });
    const verified = repository.resolveDecision(contextOne, {
      id: executed.id,
      expectedRevision: executed.revision,
      status: 'verified',
      actorId: 'executor-one',
      reason: 'Reload readback matched 0.94 USD.',
    });
    expect(verified.status).toBe('verified');
    const readbackMission = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'active',
      phase: 'readback',
      actorId: 'executor-one',
      reason: 'Execution completed with independent reload readback.',
    });
    repository.appendMissionCheckpoint(contextOne, {
      id: `readback-checkpoint-${mission.id}`,
      missionId: mission.id,
      stage: 'READBACK',
      title: '广告执行回读',
      status: 'verified',
      evidenceCount: 3,
      actorId: 'executor-one',
    });
    expect(repository.listDecisionHistory(contextOne, decision.id).map((item) => item.eventType))
      .toEqual(['created', 'revised', 'approved', 'executed', 'verified']);
    expect(() => database.prepare(`
      UPDATE decision_history SET reason = 'tampered' WHERE decision_id = ?
    `).run(decision.id)).toThrow(/append-only/i);

    const experiment = repository.createExperiment(contextOne, {
      id: 'experiment-one',
      missionId: readbackMission.id,
      name: 'Bid reduction observation',
      hypothesis: 'A six-percent bid reduction lowers ACOS without material sales loss.',
      primaryMetric: 'acos',
      guardrailMetrics: ['sales', 'orders'],
      guardrailCriteria: ['sales >= 95%', 'orders >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { bid: 1, acos: 0.41 },
      variant: { bid: 0.94, bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const updated = repository.updateExperiment(contextOne, {
      id: experiment.id,
      expectedRevision: experiment.revision,
      patch: { guardrailCriteria: ['sales >= 96%', 'orders >= 95%'] },
      actorId: 'operator',
    });
    repository.transitionExperiment(contextOne, {
      id: updated.id,
      expectedRevision: updated.revision,
      status: 'running',
      actorId: 'operator',
    });
    const observation = repository.appendExperimentObservation(contextOne, {
      id: 'experiment-observation-one',
      experimentId: experiment.id,
      observationType: 'observation',
      title: 'Day-one observation',
      observation: 'Sales are stable and ACOS is down one point.',
      observedAt: '2026-07-23T12:00:00.000Z',
      actorId: 'ai-analyst',
    });
    expectRepositoryError(
      () => repository.appendExperimentObservation(contextOne, {
        id: 'experiment-observation-invalid-reference',
        experimentId: experiment.id,
        observationType: 'observation',
        title: 'Invalid implicit correction',
        observation: 'A non-correction record cannot rewrite another observation.',
        observedAt: '2026-07-23T12:03:00.000Z',
        actorId: 'operator',
        correctsRecordId: observation.id,
      }),
      'INVALID_INPUT',
    );
    const correctedObservation = repository.appendExperimentObservation(contextOne, {
      id: 'experiment-observation-correction',
      experimentId: experiment.id,
      observationType: 'correction',
      title: 'Corrected day-one observation',
      observation: 'Sales are stable and ACOS is down 0.8 points.',
      observedAt: '2026-07-23T12:05:00.000Z',
      actorId: 'operator',
      correctsRecordId: observation.id,
    });
    expect(repository.listExperimentObservations(contextOne, experiment.id))
      .toEqual([correctedObservation, observation]);
    const metricSnapshot = repository.appendExperimentMetricSnapshot(contextOne, {
      id: 'metric-snapshot-one',
      experimentId: experiment.id,
      metric: 'acos',
      value: 0.402,
      currency: 'USD',
      observedAt: '2026-07-23T12:00:00.000Z',
      dataBatchId: mission.dataBatchId,
    });
    expect(repository.listExperimentMetricSnapshots(contextOne, experiment.id))
      .toEqual(expect.arrayContaining([metricSnapshot,
        expect.objectContaining({ metric: 'sales', value: 50 }),
        expect.objectContaining({ metric: 'orders', value: 2 })]));

    const fact = repository.appendCausalEvent(contextOne, {
      id: 'causal-manual-fact',
      stage: 'FACT',
      eventType: 'operator_fact',
      entityType: 'product',
      entityId: `${contextOne.storeId}-product-1`,
      missionId: mission.id,
      title: 'Prime Day promotion ended',
      signal: 'Promotion no longer affects the comparison window.',
      status: 'recorded',
      source: 'operator-event',
      actorId: 'operator',
    });
    const correction = repository.appendCausalEvent(contextOne, {
      id: 'causal-manual-fact-correction',
      stage: 'FACT',
      eventType: 'operator_fact_correction',
      entityType: 'product',
      entityId: `${contextOne.storeId}-product-1`,
      missionId: mission.id,
      title: 'Promotion end date corrected',
      signal: 'Promotion ended one day later than first recorded.',
      status: 'corrected',
      source: 'operator-event',
      actorId: 'operator',
      correctsEventId: fact.id,
    });
    const storeFact = repository.appendCausalEvent(contextOne, {
      id: 'causal-store-fact',
      stage: 'FACT',
      eventType: 'store_fact',
      entityType: 'store',
      entityId: contextOne.storeId,
      title: 'Store-level fact without a Mission',
      signal: 'A store-wide promotion was observed.',
      status: 'recorded',
      source: 'operator-event',
      actorId: 'operator',
    });
    const storeCorrection = repository.appendCausalEvent(contextOne, {
      id: 'causal-store-fact-correction',
      stage: 'FACT',
      eventType: 'store_fact_correction',
      entityType: 'store',
      entityId: contextOne.storeId,
      title: 'Store-level fact corrected',
      signal: 'The promotion applied one day later.',
      status: 'corrected',
      source: 'operator-event',
      actorId: 'operator',
      correctsEventId: storeFact.id,
    });
    expect(storeCorrection.correctsEventId).toBe(storeFact.id);
    expectRepositoryError(
      () => repository.appendCausalEvent(contextOne, {
        id: 'causal-invalid-cross-entity-correction',
        stage: 'FACT',
        eventType: 'operator_fact_correction',
        entityType: 'product',
        entityId: `${contextOne.storeId}-product-2`,
        missionId: mission.id,
        title: 'Invalid cross-entity correction',
        status: 'corrected',
        source: 'operator-event',
        actorId: 'operator',
        correctsEventId: fact.id,
      }),
      'REFERENCE_CONFLICT',
    );
    expectRepositoryError(
      () => repository.appendCausalEvent(contextOne, {
        id: 'causal-invalid-cross-stage-correction',
        stage: 'ANALYSIS',
        eventType: 'operator_analysis_correction',
        entityType: 'product',
        entityId: `${contextOne.storeId}-product-1`,
        missionId: mission.id,
        title: 'Invalid cross-stage correction',
        status: 'corrected',
        source: 'operator-event',
        actorId: 'operator',
        correctsEventId: fact.id,
      }),
      'REFERENCE_CONFLICT',
    );
    repository.appendEvidenceRef(contextOne, {
      id: 'evidence-one',
      eventId: correction.id,
      evidenceType: 'readback_bundle',
      evidenceRef: 'artifact:readback:sha256:abc123',
    });
    expectRepositoryError(
      () => repository.appendEvidenceRef(contextOne, {
        id: 'evidence-path',
        eventId: correction.id,
        evidenceType: 'screenshot',
        evidenceRef: 'C:\\evidence\\readback.png',
      }),
      'INVALID_INPUT',
    );

    const lineage = repository.getMissionLineage(contextOne, mission.id);
    expect(lineage.decisions).toHaveLength(1);
    expect(lineage.experiments).toHaveLength(1);
    expect(lineage.causalEvents.map((event) => event.stage)).toEqual(expect.arrayContaining([
      'FACT', 'ANALYSIS', 'DECISION', 'ACTION', 'READBACK',
    ]));
    expect(() => database.prepare(`
      DELETE FROM causal_events WHERE id = ?
    `).run(correction.id)).toThrow(/append-only/i);
    expect(() => database.prepare(`
      DELETE FROM missions WHERE id = ?
    `).run(mission.id)).toThrow(/FOREIGN KEY constraint/i);
  });
});
