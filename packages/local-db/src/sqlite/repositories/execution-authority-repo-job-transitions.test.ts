import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { MissionDomainRepository } from './mission-domain-repo';
import { registerIdentity, evidence } from './execution-authority-repo.test-jobs';
import  {
  NOW,
  PAGE_HASH,
  COMMAND_HASH,
  createHarness,
} from './execution-authority-repo.test-harness';
describe("ExecutionAuthorityRepository", () => {
it('requires before evidence before intent and seals after/reload proof before success', () => {
    const harness = createHarness();
    const identity = registerIdentity(harness);
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    const jobId = created.projection.jobs[0]!.id;

    const started = harness.repository.startJob(harness.context, {
      jobId,
      expectedRevision: 1,
    });
    expect(started.job.status).toBe('preflight');
    const preflight = harness.repository.recordPreflight(harness.context, {
      jobId,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    const intent = harness.repository.recordSubmitIntent(harness.context, {
      jobId,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-1',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-proof'),
    });
    expect(intent.job.status).toBe('intent_written');
    expect(intent.job).toMatchObject({
      submitIntentId: 'submit-intent-1',
      commandFingerprint: COMMAND_HASH,
    });
    expect(intent.job.evidence.map((item) => item.slot)).toEqual(['before']);
    const submitted = harness.repository.recordSubmitted(harness.context, {
      jobId,
      expectedRevision: intent.job.revision,
    });
    const after = harness.repository.recordAfterEvidence(harness.context, {
      jobId,
      expectedRevision: submitted.job.revision,
      evidence: evidence(identity.canonicalKeywordId, 139, 'after-proof'),
    });
    const succeeded = harness.repository.recordReloadVerified(harness.context, {
      jobId,
      expectedRevision: after.job.revision,
      evidence: evidence(identity.canonicalKeywordId, 139, 'reload-proof'),
    });

    expect(succeeded.job.status).toBe('succeeded');
    expect(succeeded.batch.status).toBe('succeeded');
    expect(succeeded.job.evidence.map((item) => item.slot)).toEqual(['before', 'after', 'reload']);
    expect(succeeded.job.events.map((event) => event.eventType)).toEqual([
      'queued', 'started', 'preflight_verified', 'submit_intent_recorded',
      'submitted', 'after_recorded', 'reload_verified',
    ]);
    expect(() => harness.repository.startJob(harness.context, {
      jobId,
      expectedRevision: succeeded.job.revision,
    })).toThrow(/terminal/i);
  });

it.each([
    { maxDailyActionCount: 1, cooldownMinutes: 0, denied: /单日动作数/ },
    { maxDailyActionCount: 10, cooldownMinutes: 90, denied: /冷却期/ },
  ])('charges pending and UNKNOWN slots to current policy limits: $denied', ({ denied, ...limits }) => {
    const h = createHarness(10, 10, 1, 'human', limits);
    const identity = registerIdentity(h);
    const job = h.repository.createExactExecutionBatch(h.context, 'grant-1').projection.jobs[0];
    const domain = new MissionDomainRepository(h.database, { now: () => new Date(NOW) });
    const check = () => domain.assertPolicyUsage(h.context, 'policy-version-1', ['opaque-keyword-1']);
    expect(check).not.toThrow();
    const start = h.repository.startJob(h.context, { jobId: job.id, expectedRevision: job.revision });
    const preflight = h.repository.recordPreflight(h.context, { jobId: job.id, expectedRevision: start.job.revision,
      observedBidCents: 149, pageIdentityHash: PAGE_HASH, canonicalKeywordId: identity.canonicalKeywordId, objectRevision: identity.objectRevision });
    const intent = h.repository.recordSubmitIntent(h.context, { jobId: job.id, expectedRevision: preflight.job.revision,
      submitIntentId: 'policy-limit-intent', commandFingerprint: COMMAND_HASH, before: evidence(identity.canonicalKeywordId, 149, 'policy-limit-before') });
    expect(check).toThrow(denied);
    expect(domain.getMissionGrant(h.context, 'grant-1')?.usage).toMatchObject({ reservedSlots: 1, spentSlots: 0, residualSlots: 0 });
    h.repository.markUnknown(h.context, { jobId: job.id, expectedRevision: intent.job.revision, reasonCode: 'connection_lost' });
    expect(check).toThrow(denied);
    expect(domain.getMissionGrant(h.context, 'grant-1')?.usage).toMatchObject({ status: 'invalidated', reservedSlots: 0, spentSlots: 1, residualSlots: 0 });
    expect(() => h.repository.recordSubmitIntent(h.context, { jobId: job.id, expectedRevision: intent.job.revision,
      submitIntentId: 'cannot-retry', commandFingerprint: COMMAND_HASH, before: evidence(identity.canonicalKeywordId, 149, 'retry-before') })).toThrow();
  });

it('cancels queued or preflight work but never cancels after submit intent', () => {
    const queuedHarness = createHarness();
    registerIdentity(queuedHarness);
    const queued = queuedHarness.repository.createExactExecutionBatch(queuedHarness.context, 'grant-1')
      .projection.jobs[0]!;
    const cancelled = queuedHarness.repository.cancelJob(queuedHarness.context, {
      jobId: queued.id,
      expectedRevision: queued.revision,
      reasonCode: 'operator_cancelled',
      detail: 'Operator cancelled before submission',
    });
    expect(cancelled.job.status).toBe('cancelled');
    expect(cancelled.job.events.at(-1)?.eventType).toBe('cancelled');
    expect(() => queuedHarness.repository.startJob(queuedHarness.context, {
      jobId: queued.id,
      expectedRevision: cancelled.job.revision,
    })).toThrow(/terminal/i);

    const intentHarness = createHarness(10, 10, 1, 'human', { maxDailyActionCount: 1, cooldownMinutes: 90 });
    const identity = registerIdentity(intentHarness);
    const job = intentHarness.repository.createExactExecutionBatch(intentHarness.context, 'grant-1')
      .projection.jobs[0]!;
    const started = intentHarness.repository.startJob(intentHarness.context, {
      jobId: job.id,
      expectedRevision: job.revision,
    });
    const preflight = intentHarness.repository.recordPreflight(intentHarness.context, {
      jobId: job.id,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    const intent = intentHarness.repository.recordSubmitIntent(intentHarness.context, {
      jobId: job.id,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-no-cancel',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-no-cancel'),
    });
    expect(() => intentHarness.repository.cancelJob(intentHarness.context, {
      jobId: job.id,
      expectedRevision: intent.job.revision,
      reasonCode: 'too_late',
    })).toThrow(/cannot transition/i);
    expect(() => intentHarness.repository.markBlocked(intentHarness.context, {
      jobId: job.id,
      expectedRevision: intent.job.revision,
      reasonCode: 'generic_block_is_too_broad',
    })).toThrow(/cannot transition/i);
    const notSubmitted = intentHarness.repository.markNotSubmittedAfterIntent(intentHarness.context, {
      jobId: job.id,
      expectedRevision: intent.job.revision,
      reasonCode: 'save_control_not_resolved',
      detail: 'Adapter proved submit was not attempted',
    });
    expect(notSubmitted.job.status).toBe('blocked');
    expect(notSubmitted.job.events.at(-1)).toMatchObject({
      eventType: 'blocked',
      fromStatus: 'intent_written',
      toStatus: 'blocked',
    });
    const domain = new MissionDomainRepository(intentHarness.database, { now: () => new Date(NOW) });
    expect(domain.getMissionGrant(intentHarness.context, 'grant-1')?.usage).toMatchObject({
      status: 'invalidated', reservedSlots: 0, spentSlots: 0, residualSlots: 0,
    });
    expect(() => domain.assertPolicyUsage(intentHarness.context, 'policy-version-1', ['opaque-keyword-1'])).not.toThrow();
  });

it('allows BLOCKED only before intent and UNKNOWN only after intent', () => {
    const beforeHarness = createHarness();
    registerIdentity(beforeHarness);
    const beforeCreated = beforeHarness.repository.createExactExecutionBatch(beforeHarness.context, 'grant-1');
    const beforeJob = beforeCreated.projection.jobs[0]!;
    expect(() => beforeHarness.repository.markUnknown(beforeHarness.context, {
      jobId: beforeJob.id,
      expectedRevision: beforeJob.revision,
      reasonCode: 'not_submitted',
    })).toThrow(/cannot transition/i);
    expect(() => beforeHarness.repository.markBlocked(beforeHarness.context, {
      jobId: beforeJob.id,
      expectedRevision: beforeJob.revision,
      reasonCode: 'unsafe_detail',
      detail: 'C:\\secret\\before.png',
    })).toThrow(/must not contain paths/i);
    const blocked = beforeHarness.repository.markBlocked(beforeHarness.context, {
      jobId: beforeJob.id,
      expectedRevision: beforeJob.revision,
      reasonCode: 'preflight_mismatch',
      detail: 'Observed bid did not match expected value',
    });
    expect(blocked.job.status).toBe('blocked');

    const afterHarness = createHarness();
    const identity = registerIdentity(afterHarness);
    const afterCreated = afterHarness.repository.createExactExecutionBatch(afterHarness.context, 'grant-1');
    const afterJobId = afterCreated.projection.jobs[0]!.id;
    const started = afterHarness.repository.startJob(afterHarness.context, {
      jobId: afterJobId,
      expectedRevision: 1,
    });
    const preflight = afterHarness.repository.recordPreflight(afterHarness.context, {
      jobId: afterJobId,
      expectedRevision: started.job.revision,
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      canonicalKeywordId: identity.canonicalKeywordId,
      objectRevision: identity.objectRevision,
    });
    const intent = afterHarness.repository.recordSubmitIntent(afterHarness.context, {
      jobId: afterJobId,
      expectedRevision: preflight.job.revision,
      submitIntentId: 'submit-intent-unknown',
      commandFingerprint: COMMAND_HASH,
      before: evidence(identity.canonicalKeywordId, 149, 'before-unknown'),
    });
    afterHarness.database.prepare(`
      UPDATE app_settings SET value = '5', updated_at = ?
      WHERE key = 'store_session_generation:store-one'
    `).run(NOW);
    afterHarness.database.prepare(`
      UPDATE store_session_metadata SET session_generation = 5, updated_at = ?
      WHERE store_id = 'store-one' AND provider = 'amazon_ads'
    `).run(NOW);
    const reconnected = normalizeStoreContextEnvelope({
      ...afterHarness.context,
      sessionGeneration: 5,
    });
    expect(() => afterHarness.repository.recordSubmitted(reconnected, {
      jobId: afterJobId,
      expectedRevision: intent.job.revision,
    })).toThrow(/earlier Amazon Ads session/i);
    expect(() => afterHarness.repository.markBlocked(reconnected, {
      jobId: afterJobId,
      expectedRevision: intent.job.revision,
      reasonCode: 'too_late',
    })).toThrow(/cannot transition/i);
    const unknown = afterHarness.repository.markUnknown(reconnected, {
      jobId: afterJobId,
      expectedRevision: intent.job.revision,
      reasonCode: 'submit_result_ambiguous',
      detail: 'Submission result requires operator reconciliation',
    });
    expect(unknown).toMatchObject({
      missionId: 'mission-1',
      grantId: 'grant-1',
      batch: { status: 'unknown' },
      job: { status: 'unknown' },
    });
  });
});
