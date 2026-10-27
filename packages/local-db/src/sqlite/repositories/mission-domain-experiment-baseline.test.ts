import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MissionDomainRepository } from './mission-domain-repo';
import { NOW } from './mission-domain-repo.test-data';
import  {
  databases,
  createHarness,
  seedActiveMission,
  seedVerifiedReadbackDecision,
  expectRepositoryError,
} from './mission-domain-repo.test-harness';
describe("MissionDomainRepository decisions, experiments, and causal ledger", () => {
it('rejects an Experiment when its product differs from the selected Mission product without leaving lineage writes', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const experimentId = 'experiment-cross-product-mission';
    const before = repository.getMissionLineage(contextOne, mission.id);
    const causalBefore = repository.listCausalEvents(contextOne, { missionId: mission.id });

    expectRepositoryError(() => repository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject a cross-product experiment',
      hypothesis: 'A product B experiment must not reuse product A Mission evidence.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-2`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'REFERENCE_CONFLICT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
    const after = repository.getMissionLineage(contextOne, mission.id);
    expect(after.experiments).toEqual(before.experiments);
    expect(after.links).toEqual(before.links);
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id }))
      .toEqual(causalBefore);
  });

it('keeps a draft Experiment unchanged when an edit moves it to another same-store product and matching Ads object', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-cross-product-draft-edit',
      missionId: mission.id,
      name: 'Keep the Mission product boundary',
      hypothesis: 'A draft edit must not reuse product A Mission evidence for product B.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const causalBefore = repository.listCausalEvents(contextOne, { missionId: mission.id });

    expectRepositoryError(() => repository.updateExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      actorId: 'operator',
      patch: {
        productId: `${contextOne.storeId}-product-2`,
        adEntityId: `${contextOne.storeId}-keyword-2`,
      },
    }), 'REFERENCE_CONFLICT');

    expect(repository.getExperiment(contextOne, draft.id)).toEqual(draft);
    expect(repository.getExperiment(contextOne, draft.id)?.revision).toBe(draft.revision);
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id }))
      .toEqual(causalBefore);
  });

it('revalidates Experiment lineage after a concurrent Mission archive before the create commit', () => {
    const { database, databasePath, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const competing = new Database(databasePath);
    databases.push(competing);
    let archiveBeforeCommit = true;
    const raceRepository = new MissionDomainRepository(database, {
      now: () => {
        if (archiveBeforeCommit) {
          archiveBeforeCommit = false;
          competing.prepare(`
            UPDATE missions
            SET status = 'archived', archived_at = ?, revision = revision + 1, updated_at = ?
            WHERE store_id = ? AND id = ?
          `).run(
            '2026-07-22T12:00:00.001Z',
            '2026-07-22T12:00:00.001Z',
            contextOne.storeId,
            mission.id,
          );
        }
        return new Date(NOW);
      },
      references: {
        productBelongsToStore: (context, productId) => productId.startsWith(`${context.storeId}-product-`),
        adEntityBelongsToStore: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
        adEntitySupportsKeywordBid: (context, adEntityId) => adEntityId.startsWith(`${context.storeId}-keyword-`),
      },
    });
    const experimentId = 'experiment-concurrent-mission-archive';

    expectRepositoryError(() => raceRepository.createExperiment(contextOne, {
      id: experimentId,
      missionId: mission.id,
      name: 'Reject stale Experiment lineage',
      hypothesis: 'An archived Mission cannot receive a new Experiment.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: mission.productId,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: {},
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, experimentId)).toBeUndefined();
  });

it('keeps an Experiment in draft when the exact Ads object has no verified execution readback', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-without-verified-readback',
      missionId: mission.id,
      name: 'Reject an unverified experiment baseline',
      hypothesis: 'A planned bid change must not be mistaken for an applied intervention.',
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

    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start without a real intervention.',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, draft.id)).toMatchObject({
      status: 'draft',
      revision: draft.revision,
      baseline: { bidUsd: 1 },
    });
  });

it('does not let archive and restore bypass the verified execution baseline for a draft Experiment', () => {
    const { database, repository, contextOne } = createHarness();
    const { mission } = seedActiveMission(repository, contextOne);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-restored-without-verified-readback',
      missionId: mission.id,
      name: 'Reject an archive restore baseline bypass',
      hypothesis: 'Archiving a draft must not turn an unverified intervention into a trusted baseline.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: `${contextOne.storeId}-product-1`,
      adEntityId: `${contextOne.storeId}-keyword-1`,
      baseline: { untrustedRendererValue: true, bidUsd: 1 },
      variant: { bidUsd: 0.94, onlyVariable: 'keyword_bid' },
      observationStartsAt: '2026-07-22T12:00:00.000Z',
      observationEndsAt: '2026-07-29T12:00:00.000Z',
    });
    const archived = repository.archiveExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      actorId: 'operator',
      reason: 'Temporarily hide the draft.',
    });
    const restored = repository.restoreExperiment(contextOne, {
      id: archived.id,
      expectedRevision: archived.revision,
      actorId: 'operator',
      reason: 'Restore the same unverified draft.',
    });
    const eventsBeforeStart = repository.listCausalEvents(contextOne, { missionId: mission.id });

    expect(restored).toMatchObject({
      status: 'paused',
      baseline: { untrustedRendererValue: true, bidUsd: 1 },
    });
    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: restored.id,
      expectedRevision: restored.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Attempt to start without verified execution readback.',
    }), 'STATE_CONFLICT');

    expect(repository.getExperiment(contextOne, restored.id)).toEqual(restored);
    expect(repository.listCausalEvents(contextOne, { missionId: mission.id })).toEqual(eventsBeforeStart);
    expect(eventsBeforeStart.filter((event) => (
      event.entityId === restored.id && event.eventType === 'experiment_running'
    ))).toHaveLength(0);
  });

it('keeps an Experiment in draft when verified status has no durable readback evidence checkpoint', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version, {
      withEvidenceCheckpoint: false,
    });
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-without-readback-evidence',
      missionId: verified.mission.id,
      name: 'Require durable readback evidence',
      hypothesis: 'A status label without evidence must not become an experiment baseline.',
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

    expectRepositoryError(() => repository.transitionExperiment(contextOne, {
      id: draft.id,
      expectedRevision: draft.revision,
      status: 'running',
      actorId: 'operator',
      reason: 'Start from a status label without durable evidence.',
    }), 'STATE_CONFLICT');
    expect(repository.getExperiment(contextOne, draft.id)).toMatchObject({
      status: 'draft',
      revision: draft.revision,
    });
  });

it('starts an Experiment from the exact verified Decision and replaces the renderer baseline', () => {
    const { database, repository, contextOne } = createHarness();
    const { version, mission } = seedActiveMission(repository, contextOne);
    database.prepare(`
      UPDATE ad_daily_metrics
      SET asin = ?, clicks = 10, cost = 20, orders = 2, sales = 50,
          acos = 0.4, cvr = 0.2, currency = 'USD'
      WHERE store_id = ? AND batch_id = ? AND targeting = 'baseline keyword 1'
    `).run(mission.productId, contextOne.storeId, mission.dataBatchId);
    
    
    database.prepare(`
      INSERT INTO ad_daily_metrics (
        store_id, batch_id, report_type, date, store_name, marketplace_code, asin,
        campaign_name, ad_group_name, targeting, match_type, source_file, source_row,
        clicks, cost, orders, sales, currency, store_authority_quarantined
      ) SELECT store_id, batch_id, report_type, date(date, '-1 day'), store_name, marketplace_code, asin,
        campaign_name, ad_group_name, targeting, match_type, source_file, source_row + 1000,
        clicks, cost, orders, sales, currency, store_authority_quarantined
      FROM ad_daily_metrics WHERE store_id = ? AND batch_id = ? AND targeting = 'baseline keyword 1'
    `).run(contextOne.storeId, mission.dataBatchId);
    database.prepare(`UPDATE ad_daily_metrics SET clicks = 0, cost = 0, orders = 0, sales = 0
      WHERE store_id = ? AND batch_id = ? AND targeting = 'baseline keyword 1' AND source_row < 1000
    `).run(contextOne.storeId, mission.dataBatchId);
    const verified = seedVerifiedReadbackDecision(database, repository, contextOne, mission, version);
    const draft = repository.createExperiment(contextOne, {
      id: 'experiment-with-verified-readback',
      missionId: verified.mission.id,
      name: 'Bind the verified keyword intervention',
      hypothesis: 'The verified bid reduction improves ACOS without breaching the order guardrail.',
      primaryMetric: 'ACOS',
      guardrailMetrics: ['广告订单'],
      guardrailCriteria: ['广告订单 >= 95%'],
      productId: verified.mission.productId,
      adEntityId: verified.decision.adEntityId,
      baseline: { untrustedRendererValue: true, bidUsd: 99 },
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

    expect(running).toMatchObject({
      status: 'running',
      baseline: {
        source: 'verified_ads_readback',
        decisionId: verified.decision.id,
        decisionRevision: verified.decision.revision,
        actionRevision: verified.decision.actionRevision,
        dataBatchId: verified.mission.dataBatchId,
        productId: verified.mission.productId,
        adEntityId: verified.decision.adEntityId,
        currentBidUsd: 1,
        appliedBidUsd: 0.94,
      },
    });
    expect(running.baseline).not.toHaveProperty('untrustedRendererValue');
    expect(repository.listExperimentMetricSnapshots(contextOne, running.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metric: 'ACOS',
        value: 0.4,
        dataBatchId: mission.dataBatchId,
      }),
      expect.objectContaining({
        metric: '广告订单',
        value: 2,
        dataBatchId: mission.dataBatchId,
      }),
    ]));
  });
});
