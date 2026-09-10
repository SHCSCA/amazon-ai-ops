// Main authority integration; static type/build evidence is produced separately by L2 commands.
import { describe, it, expect } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { workflow, success } from './v16-production.test-support';
describe('Production context and batch coordination', () => {
  it('preserves the whole batch and refuses a renderer-supplied grant issuer', async () => {
    const h = workflow('manual_approval', 2); const result = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    expect(result.proposals).toHaveLength(2);
    expect(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: result.proposals.map(proposal => proposal.id), issuer: 'policy' }))).toMatchObject({ success: false });
    expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toHaveLength(0);
  });
  it('rejects stale revisions while preserving the current Mission', async () => {
    const h = workflow(); const mission = success(await h.api.missionGet(h.request({ id: h.missionId })))!;
    const updated = success(await h.api.missionUpdate(h.request({ id: mission.id, expectedRevision: mission.revision, actorId: 'operator', patch: { title: 'Updated from IPC' } })));
    expect(updated.revision).toBeGreaterThan(mission.revision);
    expect(await h.api.missionUpdate(h.request({ id: mission.id, expectedRevision: mission.revision, actorId: 'operator', patch: { title: 'Stale response' } }))).toMatchObject({ success: false });
    expect(success(await h.api.missionGet(h.request({ id: mission.id })))?.title).toBe('Updated from IPC');
  });
  it('blocks A to B to A old envelopes without changing the persisted Mission', async () => {
    const h = workflow(); const before = h.missionRepository.getMission(h.context, h.missionId)!;
    const stale = normalizeStoreContextEnvelope({ ...h.context, sessionGeneration: h.context.sessionGeneration - 1 });
    expect(await h.api.missionTransition({ ...h.request({ id: before.id, expectedRevision: before.revision, actorId: 'operator', status: 'paused' as const }), storeContext: stale })).toMatchObject({ success: false });
    expect(h.missionRepository.getMission(h.context, h.missionId)).toEqual(before);
  });
});
