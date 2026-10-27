import { describe, expect, it } from 'vitest';
import { createHarness, seedActiveMission, expectRepositoryError } from './mission-domain-repo.test-harness';
describe("MissionDomainRepository decisions, experiments, and causal ledger", () => {
it('rejects an Experiment before persistence when guardrail metrics and criteria are not one-to-one', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-invalid-guardrail-cardinality';

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject an incomplete guardrail contract',
      hypothesis: 'Every guardrail metric must have exactly one machine-readable criterion.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单', 'CVR'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
    expect(repository.getMissionLineage(contextOne, mission.id).experiments)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: experimentId })]));
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id }))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ entityId: experimentId })]));
  });

it('rejects an Experiment before persistence when a guardrail criterion cannot be safely parsed', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-invalid-guardrail-criterion';

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject an ambiguous guardrail criterion',
      hypothesis: 'A machine stop condition must have an explicit comparator and finite threshold.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 ~= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
    expect(repository.getMissionLineage(contextOne, mission.id).experiments)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: experimentId })]));
  });

it('rejects an Experiment before persistence when a guardrail threshold is negative', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-negative-guardrail-threshold';

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject a negative guardrail threshold',
      hypothesis: 'A result-to-baseline ratio threshold cannot be negative.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= -5%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
  });

it('rejects an Experiment before persistence when a metric lacks an authoritative data source', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-unsupported-tacos';

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject TACOS without total product sales authority',
      hypothesis: 'Advertising sales must not be substituted for total product sales.',
      primaryMetric: 'TACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
  });

it('keeps a draft Experiment unchanged when an edit makes its guardrail contract invalid', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-invalid-draft-edit',
      missionId: mission.id,
      name: 'Keep a valid draft contract',
      hypothesis: 'Draft edits must remain machine-evaluable before they are saved.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      patch: { guardrailMetrics: ['广告订单', 'CVR'] },
      actorId: 'operator',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, draft.id)).toEqual(draft);
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id })
      .filter((event) => event.entityId === draft.id && event.eventType === 'experiment_updated'))
      .toEqual([]);
  });

it('keeps a draft Experiment unchanged when an edit adds an ambiguous guardrail criterion', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-invalid-criterion-edit',
      missionId: mission.id,
      name: 'Keep a parseable draft criterion',
      hypothesis: 'Draft stop conditions must remain machine-readable after every edit.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      patch: { guardrailCriteria: ['广告订单 ~= 95%'] },
      actorId: 'operator',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, draft.id)).toEqual(draft);
  });

it('keeps a draft Experiment unchanged when an edit selects a metric without authoritative data', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-unsupported-metric-edit',
      missionId: mission.id,
      name: 'Keep an authoritative draft metric',
      hypothesis: 'Editing cannot replace an observable metric with one lacking source authority.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      patch: { primaryMetric: 'TACOS' },
      actorId: 'operator',
    }), 'INVALID_INPUT');

    expect(repository.getExperiment(contextOne, draft.id)).toEqual(draft);
  });
});
