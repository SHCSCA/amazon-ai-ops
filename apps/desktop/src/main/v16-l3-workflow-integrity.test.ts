import { describe, it, expect } from 'vitest';
import { workflow, success, approveHumanBatch } from './v16-production.test-support';
describe('Production execution and history invariants', () => {
  it('persists submission before an ambiguous click outcome and never retries it', async () => {
    const h = workflow(); const analysis = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    await approveHumanBatch(h);
    const grant = success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: analysis.proposals.map(proposal => proposal.id) }))).grant!;
    for (const adEntityId of grant.allowedAdEntityIds) success(await h.api.executionResolveIdentity(h.request({ grantId: grant.id, adEntityId })));
    const batch = success(await h.api.executionCreateBatch(h.request({ grantId: grant.id })));
    h.page.clickError = new Error('Connection lost after submit');
    const result = success(await h.api.executionStart(h.request({ batchId: batch.projection.batch.id })));
    expect(result.batch.status).toBe('unknown'); expect(h.page.clickCount).toBe(1);
    await h.api.executionStart(h.request({ batchId: batch.projection.batch.id })); expect(h.page.clickCount).toBe(1);
    const memory = success(await h.api.memoryList(h.request({ missionId: h.missionId })));
    expect(memory.some(event => event.stage === 'EFFECT')).toBe(false);
  });
  it('cannot let renderer mark an experiment completed or manufacture an effect memory', async () => {
    const h = workflow();
    expect(await h.api.memoryAppend(h.request({ id: 'fake-effect', stage: 'EFFECT', eventType: 'verified_effect', entityType: 'experiment', entityId: 'fake', missionId: h.missionId, title: 'Not observed', actorId: 'operator' }) as never)).toMatchObject({ success: false });
    expect(await h.api.experimentTransition(h.request({ id: 'fake-experiment', expectedRevision: 1, status: 'completed' }) as never)).toMatchObject({ success: false });
    expect(h.missionRepository.listCausalEvents(h.context, { missionId: h.missionId }).some(event => event.stage === 'EFFECT')).toBe(false);
  });
});
