import { describe, expect, it } from 'vitest';
import { workflow, approveHumanBatch, success } from './v16-production.test-support';

describe('verified execution READBACK trusted-memory production chain', () => {
  it.each(['manual_approval', 'policy_auto'] as const)('retains %s verified execution lineage and all three proofs in trusted memory', async mode => {
    const h = workflow(mode);
    const analysis = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    if (mode === 'manual_approval') await approveHumanBatch(h);
    const authority = mode === 'manual_approval'
      ? success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: analysis.proposals.map(proposal => proposal.id) })))
      : analysis.automaticAuthorization!;
    const grant = authority.grant!;
    for (const adEntityId of grant.allowedAdEntityIds) success(await h.api.executionResolveIdentity(h.request({ grantId: grant.id, adEntityId })));
    const batch = success(await h.api.executionCreateBatch(h.request({ grantId: grant.id })));
    const completed = success(await h.api.executionStart(h.request({ batchId: batch.projection.batch.id })));
    expect(completed.batch.status).toBe('succeeded');
    const memory = h.missionRepository.listAnalysisCausalMemory(h.context, { productId: 'B0TEST' });
    const verified = memory.find(item => item.eventType === 'execution_readback_verified');
    expect(verified).toMatchObject({ stage: 'READBACK', missionId: h.missionId, entityType: 'ad_execution_batch',
      entityId: completed.batch.id, businessDate: h.context.businessDate, sessionGeneration: h.context.sessionGeneration,
      status: 'verified', source: 'execution-ledger' });
    expect(verified!.proofs.map(proof => proof.evidenceType).sort()).toEqual(['ad_execution_after', 'ad_execution_before', 'ad_execution_reload']);
    expect(verified!.proofs.every(proof => /^[a-f0-9]{64}$/i.test(proof.sha256))).toBe(true);
    expect(verified!.observedEffect).toContain('不表示长期经营效果');
    const before = h.database.prepare('SELECT total_changes() AS count').get();
    expect(h.missionRepository.listAnalysisCausalMemory(h.context, { productId: 'B0TEST' })).toEqual(memory);
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(h.page.clickCount).toBe(1);
  });
});
