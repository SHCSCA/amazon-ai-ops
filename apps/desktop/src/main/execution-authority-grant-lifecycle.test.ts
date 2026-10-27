import { describe, expect, it } from 'vitest';
import { ExecutionAuthorityGateError } from '@amazon-ai-ops/local-db';
import { createHarness } from './execution-authority-service.test-harness';
function expiredEvents(h: ReturnType<typeof createHarness>) {
  return h.missionRepository.listMissionGrantEvents(h.context, 'mission-1').filter(event => event.eventType === 'expired');
}

describe('canonical execution Grant lifecycle boundaries', () => {
  it('records expiration before rejecting create without materializing jobs or opening the browser', () => {
    const h = createHarness(1, { createBatch: false });
    const original = h.database.prepare("SELECT * FROM mission_grants WHERE id='grant-1'").get();
    h.setNow('2026-07-24T00:00:00.001Z');
    expect(() => h.service.createBatch({ context: h.context, grantId: 'grant-1' })).toThrow(ExecutionAuthorityGateError);
    expect(() => h.service.createBatch({ context: h.context, grantId: 'grant-1' })).toThrow(ExecutionAuthorityGateError);
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_batches').get()).toEqual({ count: 0 });
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_jobs').get()).toEqual({ count: 0 });
    expect(h.database.prepare("SELECT * FROM mission_grants WHERE id='grant-1'").get()).toEqual(original);
    expect(expiredEvents(h)).toHaveLength(1);
    expect(h.runtimeResolutionCount()).toBe(0);
    expect(h.page.clickCount).toBe(0);
  });

  it('records expiration before rejecting start and keeps the existing queue unchanged', async () => {
    const h = createHarness();
    const original = h.executionRepository.getExecutionBatch(h.context, h.batchId);
    h.setNow('2026-07-24T00:00:00.001Z');
    await expect(h.service.startBatch({ context: h.context, batchId: h.batchId })).rejects.toThrow(ExecutionAuthorityGateError);
    expect(h.executionRepository.getExecutionBatch(h.context, h.batchId)).toEqual(original);
    expect(expiredEvents(h)).toHaveLength(1);
    expect(h.runtimeResolutionCount()).toBe(0);
    expect(h.page.clickCount).toBe(0);
  });

  it('expires at the final save permit without intent, reservation, or click', async () => {
    const h = createHarness();
    h.page.pauseBeforePermit = true;
    const running = h.service.startBatch({ context: h.context, batchId: h.batchId });
    await h.page.prepareSaveReady;
    h.setNow('2026-07-24T00:00:00.001Z');
    h.page.allowPermitCheck();
    const projection = await running;
    expect(projection.batch.status).toBe('blocked');
    expect(projection.jobs[0]).toMatchObject({ status: 'blocked', submitIntentId: undefined });
    expect(h.database.prepare("SELECT COUNT(*) AS count FROM mission_grant_events WHERE event_type IN ('reserved','spent')").get()).toEqual({ count: 0 });
    expect(expiredEvents(h)).toHaveLength(1);
    expect(h.page.clickCount).toBe(0);
  });

  it('returns all actual execution blockers in P0-P6 order before creating a batch', () => {
    const h = createHarness(1, { createBatch: false });
    h.database.prepare("UPDATE policy_runtime SET kill_switch=1,circuit_breaker_state='open',revision=revision+1 WHERE store_id='store-one'").run();
    h.setNow('2026-07-24T00:00:00.001Z');
    let failure: unknown;
    try { h.service.createBatch({ context: h.context, grantId: 'grant-1' }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ExecutionAuthorityGateError);
    const gate = (failure as ExecutionAuthorityGateError).authorityGate;
    expect(gate.primaryBlocker.priority).toBe('P0');
    expect(gate.blockers.map(blocker => blocker.priority)).toEqual(expect.arrayContaining(['P0', 'P1', 'P3', 'P4', 'P6']));
    expect(gate.blockers.map(blocker => blocker.priority)).toEqual([...gate.blockers.map(blocker => blocker.priority)].sort());
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_jobs').get()).toEqual({ count: 0 });
    expect(h.page.clickCount).toBe(0);
  });
  it.each(['revoked', 'consumed', 'invalidated'] as const)('rejects %s terminal authority without creating jobs or rewriting its history', eventType => {
    const h = createHarness(1, { createBatch: false });
    h.missionRepository.appendMissionGrantEvent(h.context, { id: 'terminal-' + eventType, grantId: 'grant-1', eventType, actorId: 'operator', reason: '当前授权已结束。' });
    const before = h.missionRepository.listMissionGrantEvents(h.context, 'mission-1');
    expect(() => h.service.createBatch({ context: h.context, grantId: 'grant-1' })).toThrow(ExecutionAuthorityGateError);
    expect(h.missionRepository.listMissionGrantEvents(h.context, 'mission-1')).toEqual(before);
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_jobs').get()).toEqual({ count: 0 });
    expect(h.page.clickCount).toBe(0);
  });

  it('keeps the submitted slot and its independent readback after later policy drift while blocking the untouched slot', async () => {
    const h = createHarness(2);
    const running = h.service.startBatch({ context: h.context, batchId: h.batchId });
    await h.page.afterScreenshotStarted;
    const submitted = h.executionRepository.getExecutionBatch(h.context, h.batchId)!.jobs[0];
    expect(submitted.status).toBe('submitted');
    h.database.prepare("UPDATE policy_runtime SET kill_switch=1,revision=revision+1 WHERE store_id='store-one'").run();
    h.page.allowAfterScreenshot();
    const result = await running;
    expect(h.page.clickCount).toBe(1);
    expect(result.jobs.map(job => job.status)).toEqual(['succeeded', 'blocked']);
    expect(result.jobs[0]).toMatchObject({ submitIntentId: submitted.submitIntentId, intentWrittenAt: submitted.intentWrittenAt, submittedAt: submitted.submittedAt });
    expect(result.jobs[0].evidence.map(evidence => evidence.slot).sort()).toEqual(['after', 'before', 'reload']);
    expect(result.jobs[1].submitIntentId).toBeUndefined();
    expect(h.database.prepare("SELECT event_type AS type,COUNT(*) AS count FROM mission_grant_events WHERE event_type IN ('reserved','spent') GROUP BY event_type ORDER BY event_type").all()).toEqual([{ type: 'reserved', count: 1 }, { type: 'spent', count: 1 }]);
    expect(h.missionRepository.listMissionGrantEvents(h.context, 'mission-1').map(event => event.eventType)).toEqual(expect.arrayContaining(['issued', 'reserved', 'spent', 'invalidated']));
  });

});

