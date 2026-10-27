import { describe, expect, it } from 'vitest';
import { createHarness, runRequest } from './analysis-authority.test-support';

describe('AI provider offline history preservation', () => {
  it('records a safe blocked retry while keeping the previous local analysis, Decisions and memory intact', async () => {
    let unavailable = false;
    const h = createHarness({ generationAuthorityFactory: captured => ({ ...captured,
      generateRecommendations: scope => {
        if (unavailable) throw new Error('AI provider unavailable with internal-token=must-not-project');
        return captured.generateRecommendations(scope);
      },
    }) });
    await runRequest(h);
    const original = h.service.getMissionAnalysisProjection(h.context, h.missionId);
    const decisions = h.missionRepository.listDecisions(h.context, { missionId: h.missionId });
    const memory = h.missionRepository.listCausalEvents(h.context);
    unavailable = true;
    h.modelRevision.value = 'current-provider-offline-model-revision';
    await expect(runRequest(h)).rejects.toThrow(/provider unavailable/);
    const after = h.service.getMissionAnalysisProjection(h.context, h.missionId);
    expect(after.actionBatches).toEqual(original.actionBatches);
    expect(after.proposals).toEqual(original.proposals);
    for (const item of original.evidencePackages) expect(after.evidencePackages).toContainEqual(item);
    expect(h.missionRepository.listDecisions(h.context, { missionId: h.missionId })).toEqual(decisions);
    const afterMemory = h.missionRepository.listCausalEvents(h.context);
    for (const event of memory) expect(afterMemory).toContainEqual(event);
    const failed = afterMemory.filter(event => event.eventType === 'analysis_run_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ status: 'failed', title: '分析未完成' });
    expect(failed[0].signal).toMatch(/检查 AI 与策略配置后重试/);
    expect(JSON.stringify(after)).not.toContain('must-not-project');
    expect(JSON.stringify(afterMemory)).not.toContain('must-not-project');
    expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toEqual([]);
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_batches').get()).toEqual({ count: 0 });
  });
});
