import { describe, expect, it } from 'vitest';
import { registerIdentity } from './execution-authority-repo.test-jobs';
import { createHarness } from './execution-authority-repo.test-harness';
describe("ExecutionAuthorityRepository", () => {
it('materializes one exact idempotent downbid batch from an unexpired approved grant', () => {
    const harness = createHarness();
    registerIdentity(harness);

    const first = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    expect(first.created).toBe(true);
    expect(first.projection.batch).toMatchObject({
      grantId: 'grant-1',
      missionId: 'mission-1',
      actionRevision: 1,
      status: 'queued',
    });
    expect(first.projection.jobs).toHaveLength(1);
    expect(first.projection.jobs[0]).toMatchObject({
      proposalId: 'proposal-1',
      decisionId: 'decision-1',
      actionType: 'set_keyword_bid',
      expectedBidCents: 149,
      targetBidCents: 139,
      status: 'queued',
      identity: {
        adsAccountId: 'ads-account-1',
        campaignId: 'campaign-1',
        adGroupId: 'ad-group-1',
        keywordId: 'keyword-1',
        objectRevision: 1,
      },
    });
    expect(first.projection.jobs[0]?.events.map((event) => event.eventType)).toEqual(['queued']);
    expect(() => harness.database.prepare(`
      UPDATE ad_execution_jobs SET campaign_id = 'cross-identity-campaign'
      WHERE store_id = 'store-one' AND id = ?
    `).run(first.projection.jobs[0]!.id)).toThrow(/foreign key/i);
    expect(harness.database.prepare(`
      SELECT event_type AS eventType FROM mission_grant_events
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get()).toEqual({ eventType: 'issued' });

    harness.database.prepare(`
      INSERT INTO mission_grant_events (
        id, store_id, grant_id, event_type, actor_id, reason, created_at
      ) VALUES ('grant-consumed-after-readback', 'store-one', 'grant-1', 'consumed',
        'main-test', 'full batch verified', '2026-07-23T02:00:01.000Z')
    `).run();

    const replay = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    expect(replay.created).toBe(false);
    expect(replay.projection).toEqual(first.projection);
    expect(() => harness.repository.startJob(harness.context, {
      jobId: replay.projection.jobs[0]!.id,
      expectedRevision: replay.projection.jobs[0]!.revision,
    })).toThrow(/terminal/i);
  });
});
