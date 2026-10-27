import { describe, expect, it } from 'vitest';
import { createHarness, NOW, PAGE_HASH, COMMAND_HASH } from './execution-authority-repo.test-harness';
import { evidence, registerIdentity } from './execution-authority-repo.test-jobs';

describe('execution observation time authority', () => {
  it.each(['2026-02-30T02:00:00.000Z', '2026-07-23T02:00:00', '2026-07-23T02:00:00.001Z'])(
    'rejects invalid or future canonical resolution %s without an identity write', resolvedAt => {
      const h = createHarness();
      const before = h.database.prepare('SELECT total_changes() AS count').get();
      expect(() => registerIdentity(h, { resolvedAt })).toThrow();
      expect(h.repository.listCanonicalKeywordIdentities(h.context)).toEqual([]);
      expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    },
  );

  it.each(['2026-02-30T02:00:00.000Z', '2026-07-23T02:00:00', '2026-07-23T02:00:00.001Z'])(
    'rejects invalid or future before proof %s without reserving a submission', capturedAt => {
      const h = createHarness();
      const identity = registerIdentity(h);
      const created = h.repository.createExactExecutionBatch(h.context, 'grant-1');
      const job = created.projection.jobs[0]!;
      const started = h.repository.startJob(h.context, { jobId: job.id, expectedRevision: job.revision });
      const preflight = h.repository.recordPreflight(h.context, { jobId: job.id, expectedRevision: started.job.revision,
        observedBidCents: 149, pageIdentityHash: PAGE_HASH, canonicalKeywordId: identity.canonicalKeywordId, objectRevision: 1 });
      const before = h.database.prepare('SELECT total_changes() AS count').get();
      expect(() => h.repository.recordSubmitIntent(h.context, { jobId: job.id, expectedRevision: preflight.job.revision,
        submitIntentId: 'bad-time-intent', commandFingerprint: COMMAND_HASH,
        before: { ...evidence(identity.canonicalKeywordId, 149, 'before-proof'), capturedAt } })).toThrow();
      const current = h.repository.getExecutionBatch(h.context, created.projection.batch.id)!;
      expect(current.jobs[0]!.status).toBe('preflight');
      expect(current.jobs[0]!.submitIntentId).toBeUndefined();
      expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_evidence').get()).toEqual({ count: 0 });
      expect(h.database.prepare("SELECT COUNT(*) AS count FROM mission_grant_events WHERE event_type IN ('reserved','spent')").get()).toEqual({ count: 0 });
      expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    },
  );

  it('accepts a verified offset instant at the current clock while keeping the future Grant expiry', () => {
    const h = createHarness();
    expect(registerIdentity(h, { resolvedAt: '2026-07-22T19:00:00-07:00' }).resolvedAt).toBe(NOW);
    expect(h.repository.createExactExecutionBatch(h.context, 'grant-1').projection.batch.status).toBe('queued');
  });
});
