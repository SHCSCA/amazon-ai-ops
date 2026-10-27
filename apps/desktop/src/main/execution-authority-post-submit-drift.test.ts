import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { createHarness } from './execution-authority-service.test-harness';

describe('canonical post-submit write authority drift', () => {
  it.each(['queued', 'foreign-profile', 'wrong-original-generation'] as const)('refuses %s misuse of the stale-session terminal fact boundary with zero writes', mismatch => {
    const h = createHarness(2);
    const job = h.executionRepository.getExecutionBatch(h.context, h.batchId)!.jobs[0];
    h.database.prepare("INSERT INTO app_settings(key,value) VALUES('store_session_generation:store-one','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();
    const context = normalizeStoreContextEnvelope(mismatch === 'foreign-profile' ? { ...h.context, browserProfileId: 'foreign-profile' }
      : mismatch === 'wrong-original-generation' ? { ...h.context, sessionGeneration: h.context.sessionGeneration - 1 } : h.context);
    const snapshot = () => ({ jobs: h.database.prepare('SELECT id,status,revision,submit_intent_id FROM ad_execution_jobs ORDER BY id').all(),
      events: h.database.prepare('SELECT * FROM ad_execution_events ORDER BY id').all(),
      grants: h.database.prepare('SELECT * FROM mission_grant_events ORDER BY id').all() });
    const before = snapshot();
    const changes = h.database.prepare('SELECT total_changes() AS count').get();
    expect(() => h.executionRepository.terminalizePostIntentUnknownAfterAuthorityLoss(context, {
      jobId: job.id, expectedRevision: job.revision, reasonCode: 'session_changed', detail: '旧会话仅可记录自己已经提交的事实。',
    })).toThrow();
    expect(snapshot()).toEqual(before);
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(h.page.clickCount).toBe(0);
  });
  it.each(['mode', 'policy-version', 'mission-revision'] as const)('retains the submitted fact and finishes restricted readback after %s changes, then stops the remaining slot', async drift => {
    const h = createHarness(2);
    const running = h.service.startBatch({ context: h.context, batchId: h.batchId });
    await h.page.afterScreenshotStarted;
    const before = h.executionRepository.getExecutionBatch(h.context, h.batchId)!.jobs[0];
    expect(before.status).toBe('submitted');
    if (drift === 'mode') {
      const runtime = h.missionRepository.getPolicyRuntime(h.context);
      h.missionRepository.updatePolicyRuntime(h.context, { expectedRevision: runtime.revision, actorId: 'operator',
        patch: { autonomyMode: 'policy_auto', reason: '已有提交后切换后续写入权限。' } });
    } else if (drift === 'mission-revision') {
      const mission = h.missionRepository.getMission(h.context, 'mission-1')!;
      h.missionRepository.updateMission(h.context, { id: mission.id, expectedRevision: mission.revision, actorId: 'operator',
        patch: { title: '已提交后修改任务目标记录' } });
    } else {
      const current = h.missionRepository.getPolicyVersion(h.context, 'policy-version-1')!;
      const policy = h.missionRepository.getPolicy(h.context, current.policyId)!;
      const next = h.missionRepository.createPolicyVersion(h.context, { id: 'policy-version-after-submit', policyId: current.policyId,
        version: current.version + 1, rules: current.rules, actorId: 'operator' });
      h.missionRepository.enablePolicyVersion(h.context, { policyId: policy.id, versionId: next.id,
        expectedPolicyRevision: policy.revision, expectedVersionRevision: next.revision, actorId: 'operator' });
    }
    h.page.allowAfterScreenshot();
    const result = await running;
    expect(h.page.clickCount).toBe(1);
    expect(result.jobs.map(job => job.status)).toEqual(['succeeded', 'blocked']);
    expect(result.jobs[0]).toMatchObject({ submitIntentId: before.submitIntentId, intentWrittenAt: before.intentWrittenAt,
      submittedAt: before.submittedAt, actionRevision: before.actionRevision, grantId: before.grantId });
    expect(result.jobs[0].evidence.map(proof => proof.slot).sort()).toEqual(['after', 'before', 'reload']);
    expect(result.jobs[1].submitIntentId).toBeUndefined();
    const spent = h.database.prepare("SELECT job_id AS job FROM mission_grant_events WHERE event_type='spent'").all();
    expect(spent).toEqual([{ job: before.id }]);
  });

  it('preserves the original submission and terminalizes UNKNOWN after durable session advancement without accepting stale readback or another slot', async () => {
    const h = createHarness(2);
    const running = h.service.startBatch({ context: h.context, batchId: h.batchId });
    await h.page.afterScreenshotStarted;
    const before = h.executionRepository.getExecutionBatch(h.context, h.batchId)!.jobs[0];
    expect(before.status).toBe('submitted');
    h.database.prepare("INSERT INTO app_settings(key,value) VALUES('store_session_generation:store-one','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();
    h.page.allowAfterScreenshot();
    const result = await running;
    expect(result.batch.status).toBe('unknown');
    expect(result.jobs.map(job => job.status)).toEqual(['unknown', 'cancelled']);
    expect(result.jobs[0]).toMatchObject({ submitIntentId: before.submitIntentId, submittedAt: before.submittedAt,
      intentWrittenAt: before.intentWrittenAt, actionRevision: before.actionRevision, grantId: before.grantId });
    expect(result.jobs[0].evidence.map(proof => proof.slot)).toEqual(['before']);
    expect(result.jobs[1].submitIntentId).toBeUndefined();
    expect(h.page.clickCount).toBe(1);
    expect(h.database.prepare("SELECT job_id AS job FROM mission_grant_events WHERE event_type='spent'").all()).toEqual([{ job: before.id }]);
    expect(h.database.prepare("SELECT event_type AS type FROM mission_grant_events WHERE grant_id='grant-1' AND event_type IN ('invalidated','consumed')").all()).toEqual([{ type: 'invalidated' }]);
    expect(() => h.executionRepository.startJob(h.context, { jobId: result.jobs[1].id, expectedRevision: result.jobs[1].revision })).toThrow();
  });
});
