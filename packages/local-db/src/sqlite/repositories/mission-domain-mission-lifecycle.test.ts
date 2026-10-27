import { describe, expect, it } from 'vitest';
import  {
  createHarness,
  seedActiveMission,
  createApprovedDecision,
  expectRepositoryError,
} from './mission-domain-repo.test-harness';
describe("MissionDomainRepository mission lineage and grants", () => {
it('rejects unknown Mission patch keys without incrementing the revision', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);

    expectRepositoryError(() => repository.updateMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      actorId: 'operator',
      patch: { unsupportedAuthorityField: 'must-not-be-ignored' } as never,
    }), 'INVALID_INPUT');

    expect(repository.getMission(contextOne, mission.id)).toMatchObject({
      revision: mission.revision,
      title: mission.title,
      phase: mission.phase,
    });
  });

it('freezes the complete Mission definition when the Mission reaches decision', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const decisionPhase = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'active',
      phase: 'decision',
      actorId: 'operator',
      reason: 'Analysis is complete and the Mission definition is now evidence-bound.',
    });

    expectRepositoryError(() => repository.updateMission(contextOne, {
      id: decisionPhase.id,
      expectedRevision: decisionPhase.revision,
      actorId: 'operator',
      patch: {
        title: 'Must remain immutable',
        objective: 'Must remain immutable',
        priority: 'P0',
        productId: `${contextOne.storeId}-product-2`,
        observationStartsAt: '2026-07-23T00:00:00.000Z',
        observationEndsAt: '2026-07-30T00:00:00.000Z',
        successCriteria: ['Must remain immutable'],
        guardrails: ['Must remain immutable'],
      },
    }), 'STATE_CONFLICT');

    expect(repository.getMission(contextOne, decisionPhase.id)).toEqual(decisionPhase);
  });

it('allows a title-only rename after decision while preserving every authority field', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const decisionPhase = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'active',
      phase: 'decision',
      actorId: 'operator',
    });

    const renamed = repository.updateMission(contextOne, {
      id: decisionPhase.id,
      expectedRevision: decisionPhase.revision,
      actorId: 'operator',
      patch: { title: '新的任务显示名称' },
    });

    expect(renamed).toMatchObject({
      title: '新的任务显示名称',
      revision: decisionPhase.revision + 1,
      dataBatchId: decisionPhase.dataBatchId,
      policyVersionId: decisionPhase.policyVersionId,
      productId: decisionPhase.productId,
      objective: decisionPhase.objective,
      observationStartsAt: decisionPhase.observationStartsAt,
      observationEndsAt: decisionPhase.observationEndsAt,
      successCriteria: decisionPhase.successCriteria,
      guardrails: decisionPhase.guardrails,
    });
  });

it('does not allow a Mission phase to move backward and reopen its frozen definition', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const decisionPhase = repository.transitionMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      status: 'active',
      phase: 'decision',
      actorId: 'operator',
    });

    expectRepositoryError(() => repository.transitionMission(contextOne, {
      id: decisionPhase.id,
      expectedRevision: decisionPhase.revision,
      status: 'active',
      phase: 'analysis',
      actorId: 'operator',
      reason: 'Must not reopen the editable definition.',
    }), 'STATE_CONFLICT');
    expect(repository.getMission(contextOne, decisionPhase.id)).toEqual(decisionPhase);
  });

it('freezes Mission authority fields as soon as a Decision exists even if a legacy phase flag is stale', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    createApprovedDecision(database, repository, contextOne, mission, version, 72);
    expect(mission.phase).toBe('analysis');

    expectRepositoryError(() => repository.updateMission(contextOne, {
      id: mission.id,
      expectedRevision: mission.revision,
      actorId: 'operator',
      patch: { objective: 'Must not rewrite the definition behind an existing Decision.' },
    }), 'STATE_CONFLICT');
    expect(repository.getMission(contextOne, mission.id)).toEqual(mission);
  });

it('rejects a Decision whose product differs from its Mission product', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);

    expectRepositoryError(() => repository.createDecision(contextOne, {
      id: 'decision-product-lineage-mismatch',
      missionId: mission.id,
      dataBatchId: mission.dataBatchId,
      policyVersionId: version.id,
      policyRevision: version.revision,
      actionRevision: 1,
      title: 'Mismatched product decision',
      rationale: 'This proposal must not escape the Mission product scope.',
      recommendation: 'Do not persist this proposal.',
      facts: ['The submitted product differs from the Mission product.'],
      alternatives: ['Regenerate the analysis for the Mission product.'],
      actionType: 'set_keyword_bid',
      adEntityId: `${contextOne.storeId}-keyword-1`,
      productId: `${contextOne.storeId}-product-2`,
      currentValue: 1,
      recommendedValue: 0.95,
      confidence: 0.8,
      status: 'needs_approval',
      actorId: 'ai-analyst',
    }), 'REFERENCE_CONFLICT');

    expect(repository.listDecisions(contextOne, { missionId: mission.id })).toEqual([]);
  });
});
