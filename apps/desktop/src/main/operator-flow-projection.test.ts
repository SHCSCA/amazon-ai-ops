import { describe, expect, it } from 'vitest';
import { missionControlContextKey, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { workflow, approveHumanBatch, success } from './v16-production.test-support';
import { buildMissionControlTodayProjection } from './mission-control-today-projection';
import { buildOperatorFlowProjection } from './operator-flow-projection';

function today(context: StoreContextEnvelope) {
  return buildMissionControlTodayProjection({ context, products: [], collectionJobs: [], reportImportProofs: [],
    importedMetricRows: 0, operationEventsToday: 0, browserSessionReady: false, executionBatches: [] });
}

async function complete(mode: 'manual_approval' | 'policy_auto') {
  const h = workflow(mode);
  const generated = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
  if (mode === 'manual_approval') await approveHumanBatch(h);
  const authority = mode === 'manual_approval'
    ? success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: generated.proposals.map(row => row.id) })))
    : generated.automaticAuthorization!;
  const grant = authority.grant!;
  for (const adEntityId of grant.allowedAdEntityIds) success(await h.api.executionResolveIdentity(h.request({ grantId: grant.id, adEntityId })));
  const batch = success(await h.api.executionCreateBatch(h.request({ grantId: grant.id })));
  success(await h.api.executionStart(h.request({ batchId: batch.projection.batch.id })));
  return h;
}

describe('canonical thirteen-stage operator projection', () => {
  it.each(['manual_approval', 'policy_auto'] as const)('projects all thirteen %s stages from actual persisted production services without writing or granting delivery credit', async mode => {
    const h = await complete(mode);
    const analysis = h.service.getMissionAnalysisProjection(h.context, h.missionId);
    h.database.pragma('query_only = ON');
    const before = h.database.prepare('SELECT total_changes() AS count').get();
    const stages = buildOperatorFlowProjection({ context: h.context, today: today(h.context), domain: h.missionRepository,
      analysis, execution: h.execution.listBatches(h.context) });
    expect(stages.map(row => row.id)).toEqual(['store-context', 'products', 'reports', 'import', 'mission', 'analysis',
      'decision', 'grant', 'execution', 'readback', 'experiment', 'memory', 'delivery']);
    expect(stages.every(row => row.statusLabel && row.latestResult && row.blocker && row.nextAction && row.targetView)).toBe(true);
    expect(stages.find(row => row.id === 'analysis')).toMatchObject({ state: 'recorded' });
    expect(stages.find(row => row.id === 'execution')).toMatchObject({ state: 'recorded' });
    expect(stages.find(row => row.id === 'readback')).toMatchObject({ state: 'verified', targetView: 'execution/evidence' });
    expect(stages.find(row => row.id === 'memory')!.latestResult).not.toMatch(/\.png|\.xlsx|[A-Z]:\\/);
    expect(stages.find(row => row.id === 'delivery')).toMatchObject({ state: 'unknown', targetView: 'settings/delivery' });
    expect(stages.find(row => row.id === 'delivery')!.blocker).toContain('历史状态不能替代本次核验');
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(h.page.clickCount).toBe(1);
  });

  it('retains UNKNOWN despite all three attached proofs and never promotes missing or inconsistent jobs to verified', async () => {
    const h = await complete('manual_approval');
    const analysis = h.service.getMissionAnalysisProjection(h.context, h.missionId);
    const completed = h.execution.listBatches(h.context)[0];
    expect(completed.jobs[0].evidence.map(row => row.slot).sort()).toEqual(['after', 'before', 'reload']);
    for (const execution of [
      { ...completed, batch: { ...completed.batch, status: 'unknown' as const } },
      { ...completed, jobs: completed.jobs.map(job => ({ ...job, status: 'unknown' as const })) },
      { ...completed, jobs: [] },
      { ...completed, jobs: completed.jobs.map(job => ({ ...job, evidence: [...job.evidence, job.evidence[0]] })) },
    ]) {
      const stages = buildOperatorFlowProjection({ context: h.context, today: today(h.context), domain: h.missionRepository, analysis, execution: [execution] });
      expect(stages.find(row => row.id === 'readback')!.state).not.toBe('verified');
    }
  });

  it('requires the exact current store generation and refuses foreign canonical records instead of summarizing them', () => {
    const h = workflow();
    const base = today(h.context);
    expect(() => buildOperatorFlowProjection({ context: { ...h.context, sessionGeneration: 2 }, today: base,
      domain: h.missionRepository, analysis: null, execution: [] })).toThrow('OPERATOR_FLOW_CONTEXT_MISMATCH');
    const mission = h.missionRepository.listMissions(h.context)[0];
    expect(() => buildOperatorFlowProjection({ context: h.context, today: { ...base, authorityKey: missionControlContextKey(h.context) },
      domain: { ...h.missionRepository, listMissions: () => [{ ...mission, storeId: 'other-store' }] } as any,
      analysis: null, execution: [] })).toThrow('OPERATOR_FLOW_STORE_MISMATCH');
    const empty = buildOperatorFlowProjection({ context: h.context, today: base, analysis: null, execution: [] });
    expect(empty.find(row => row.id === 'mission')!.state).toBe('unknown');
    expect(empty.some(row => row.state === 'verified')).toBe(false);
  });

  it.each(['blocked', 'cancelled'] as const)('shows the persisted %s execution cause and a safe recovery instead of claiming no blocker exists', async status => {
    const h = await complete('manual_approval');
    const completed = h.execution.listBatches(h.context)[0];
    h.database.pragma('query_only = ON');
    const before = h.database.prepare('SELECT total_changes() AS count').get();
    const stages = buildOperatorFlowProjection({ context: h.context, today: today(h.context), domain: h.missionRepository,
      analysis: h.service.getMissionAnalysisProjection(h.context, h.missionId),
      execution: [{ ...completed, batch: { ...completed.batch, status } }] });
    const execution = stages.find(row => row.id === 'execution')!;
    expect(execution).toMatchObject({ state: 'blocked', targetView: 'execution/live' });
    expect(execution.latestResult).toContain(status === 'blocked' ? '执行阻断记录' : '执行取消记录');
    expect(execution.blocker).toContain(status === 'blocked' ? '核对已提交意图' : '未知结果应先只读对账');
    expect(execution.blocker).not.toContain('没有持久化的阻断记录');
    expect(stages.find(row => row.id === 'readback')!.state).not.toBe('verified');
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(h.page.clickCount).toBe(1);
  });
});
