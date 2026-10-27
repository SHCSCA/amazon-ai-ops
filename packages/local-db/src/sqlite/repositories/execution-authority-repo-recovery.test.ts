import { describe, expect, it } from 'vitest';
import { MissionDomainRepository } from './mission-domain-repo';
import { registerIdentity, evidence } from './execution-authority-repo.test-jobs';
import  {
  NOW,
  PAGE_HASH,
  COMMAND_HASH,
  createHarness,
} from './execution-authority-repo.test-harness';
describe("ExecutionAuthorityRepository", () => {
it('recovers any post-intent interruption to terminal UNKNOWN without requeue', () => {
    const harness = createHarness();
    const identity = registerIdentity(harness);
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    const jobId = created.projection.jobs[0]!.id;
    const started = harness.repository.startJob(harness.context, { jobId, expectedRevision: 1 });
    const preflight = harness.repository.recordPreflight(harness.context, {
      jobId,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    harness.repository.recordSubmitIntent(harness.context, {
      jobId,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-recovery',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-recovery'),
    });

    const recovery = harness.repository.recoverInterruptedExecutions();
    expect(recovery.markedUnknown).toEqual([expect.objectContaining({
      jobId,
      missionId: 'mission-1',
      grantId: 'grant-1',
      previousStatus: 'intent_written',
      status: 'unknown',
    })]);
    expect(recovery.revokedGrantIds).toEqual(['grant-1']);
    expect(recovery.missionsRequiringStop).toEqual(['mission-1']);
    expect(new MissionDomainRepository(harness.database).getMissionGrantTerminalEvent(harness.context, 'grant-1')?.eventType).toBe('invalidated');
    expect(harness.repository.getExecutionBatch(harness.context, created.projection.batch.id))
      .toMatchObject({ batch: { status: 'unknown' }, jobs: [{ status: 'unknown' }] });
    expect(() => harness.database.prepare(`
      UPDATE ad_execution_jobs SET status = 'queued' WHERE store_id = 'store-one' AND id = ?
    `).run(jobId)).toThrow(/terminal|invalid/i);
    const repeatedRecovery = harness.repository.recoverInterruptedExecutions();
    expect(repeatedRecovery.markedUnknown).toEqual([]);
    expect(repeatedRecovery.domainReconciliations).toEqual([
      expect.objectContaining({
        batchId: created.projection.batch.id,
        missionId: 'mission-1',
        grantId: 'grant-1',
        status: 'unknown',
      }),
    ]);
    expect(repeatedRecovery.missionsRequiringStop).toEqual(['mission-1']);
    const mission = new MissionDomainRepository(harness.database, { now: () => new Date(NOW) });
    expect(mission.getMissionGrant(harness.context, 'grant-1')?.usage).toMatchObject({
      status: 'invalidated', spentSlots: 1, spentImpactCents: 10, residualSlots: 0, residualImpactCents: 0,
    });
    expect(mission.listMissionGrantEvents(harness.context, 'mission-1').map(event => event.eventType).sort())
      .toEqual(['consumed','invalidated','issued','reserved','spent']);
    expect(() => harness.database.prepare("UPDATE mission_grant_events SET impact_cents=0 WHERE event_type='spent'").run()).toThrow(/append-only/);
    expect(() => harness.database.prepare("DELETE FROM mission_grant_events WHERE event_type='spent'").run()).toThrow(/append-only/);
  });

it('atomically marks the submitted action UNKNOWN and cancels untouched siblings', () => {
    const harness = createHarness(10, 10, 2);
    const identity = registerIdentity(harness);
    registerIdentity(harness, {
      adEntityId: 'opaque-keyword-2',
      adsAccountId: 'ads-account-1',
      campaignId: 'campaign-1',
      adGroupId: 'ad-group-2',
      keywordId: 'keyword-2',
      observedBidCents: 200,
      pageIdentityHash: '4'.repeat(64),
      resolutionProofSha256: '5'.repeat(64),
    });
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    expect(created.projection.jobs).toHaveLength(2);
    const [first, second] = created.projection.jobs;
    const started = harness.repository.startJob(harness.context, {
      jobId: first!.id,
      expectedRevision: first!.revision,
    });
    const preflight = harness.repository.recordPreflight(harness.context, {
      jobId: first!.id,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    const intent = harness.repository.recordSubmitIntent(harness.context, {
      jobId: first!.id,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-multi-unknown',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-multi-unknown'),
    });

    const unknown = harness.repository.markUnknown(harness.context, {
      jobId: first!.id,
      expectedRevision: intent.job.revision,
      reasonCode: 'submit_result_ambiguous',
      detail: 'Submission result requires operator reconciliation',
    });

    expect(unknown.batch.status).toBe('unknown');
    expect(harness.repository.getExecutionBatch(harness.context, created.projection.batch.id)?.jobs)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first!.id, status: 'unknown' }),
        expect.objectContaining({ id: second!.id, status: 'cancelled' }),
      ]));
    expect(new MissionDomainRepository(harness.database).getMissionGrantTerminalEvent(harness.context, 'grant-1')?.eventType).toBe('invalidated');
  });
});
