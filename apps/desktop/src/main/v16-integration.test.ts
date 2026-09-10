import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { BrowserLeaseManager, deriveStoreCapsulePaths, ensureStoreCapsulePaths } from '@amazon-ai-ops/browser-worker';
import { ExecutionAuthorityRepository } from '@amazon-ai-ops/local-db';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { V16_API_VERSION, type V16Result } from '@amazon-ai-ops/shared-types/src/v16-api';
import { createHarness, NOW } from './analysis-authority.test-support';
import { FakeExecutionPage } from './execution-browser.test-support';
import { MissionDomainService } from './mission-domain-service';
import { ExecutionAuthorityService } from './execution-authority-service';
import { registerV16ServicesIpc } from './v16-services-ipc';
import { createV16ServicesPreloadApi } from '../preload/v16-services-preload';
import { workflow, success, approveHumanBatch } from './v16-production.test-support';
import { createRequire } from 'node:module';
const { verifyExecutionCanaryLineage } = createRequire(import.meta.url)('../../../../scripts/verify-mission-control-production-readiness.js');
describe('V1.6 production services through Preload and IPC', () => {
  it('saves and reloads a store-scoped AI budget through the canonical typed IPC without granting Ads authority', async () => {
    const h = workflow();
    expect(success(await h.api.aiSpendGet(h.request({}))).policy).toBeUndefined();
    const policy = { expectedRevision: 0, enabled: true, providerBaseUrl: 'https://ai.example/v1', model: 'fixture-model',
      windowStartsAt: '2026-07-22T00:00:00.000Z', windowEndsAt: '2026-07-30T00:00:00.000Z', budgetMicrousd: 2000,
      contextTokenLimit: 1000, outputTokenLimit: 200, inputMicrousdPerMillion: 1000000, outputMicrousdPerMillion: 2000000,
      pricingReference: 'https://ai.example/pricing', reason: '隔离测试预算，不是生产批准。' };
    const saved = success(await h.api.aiSpendSave(h.request(policy)));
    expect(saved).toMatchObject({ revision: 1, owner: 'operator', currency: 'USD', storeId: h.context.storeId });
    expect(success(await h.api.aiSpendGet(h.request({}))).policy).toEqual(saved);
    expect(await h.api.aiSpendSave(h.request(policy))).toMatchObject({ success: false, code: 'AI_SPEND_STALE' });
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM mission_grants').get()).toEqual({ count: 0 });
    expect(h.page.clickCount).toBe(0);
  });
  it('keeps an UNKNOWN Mission closed to new authority after reconciliation and archive restore', async () => {
    const h = workflow();
    const analysis = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    await approveHumanBatch(h);
    const grant = success(await h.api.grantIssue(h.request({ missionId: h.missionId,
      proposalIds: analysis.proposals.map(proposal => proposal.id) }))).grant!;
    for (const adEntityId of grant.allowedAdEntityIds) success(await h.api.executionResolveIdentity(h.request({ grantId: grant.id, adEntityId })));
    const batch = success(await h.api.executionCreateBatch(h.request({ grantId: grant.id })));
    h.page.clickError = new Error('disconnected after submit');
    const original = success(await h.api.executionStart(h.request({ batchId: batch.projection.batch.id })));
    expect(original.batch.status).toBe('unknown');
    h.page.clickError = undefined;
    await h.execution.reconcileUnknownBatch({ context: h.context, batchId: original.batch.id });
    for (const restore of [false, true]) {
      let mission = h.missionRepository.getMission(h.context, h.missionId)!;
      if (restore) {
        mission = h.missionRepository.archiveMission(h.context, { id: mission.id, expectedRevision: mission.revision, actorId: 'operator' });
        mission = h.missionRepository.restoreMission(h.context, { id: mission.id, expectedRevision: mission.revision, actorId: 'operator' });
      }
      expect(await h.api.missionTransition(h.request({ id: mission.id, expectedRevision: mission.revision,
        status: 'active', actorId: 'operator', reason: '尝试恢复旧任务' }))).toMatchObject({ success: false });
      expect(h.missionRepository.getMission(h.context, mission.id)?.revision).toBe(mission.revision);
      expect(() => h.analysisRepository.createActionBatch(h.context, { id: 'cannot-reopen', missionId: mission.id,
        evidencePackageId: analysis.proposals[0].evidencePackageId, expectedMissionRevision: mission.revision })).toThrow('新建运营任务');
    }
    expect(h.page.clickCount).toBe(1);
    expect(success(await h.api.executionListBatches(h.request({}))).find(item => item.batch.id === original.batch.id)?.batch.status).toBe('unknown');
  });
  it('requires and preserves the operator reason when revoking a current human grant', async () => {
    const h = workflow();
    const analysis = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    await approveHumanBatch(h);
    const grant = success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) }))).grant!;
    expect(await h.api.grantRevoke(h.request({ id: 'empty-reason', grantId: grant.id, reason: '   ' }))).toMatchObject({ success: false });
    const reason = '执行前发现促销计划调整，撤销剩余降价授权并重新评估。';
    success(await h.api.grantRevoke(h.request({ id: 'business-reason', grantId: grant.id, reason })));
    const events = success(await h.api.grantEvents(h.request({ missionId: h.missionId })));
    expect(events.find(event => event.eventType === 'revoked')).toMatchObject({ reason, actorId: 'operator' });
    expect(await h.api.executionCreateBatch(h.request({ grantId: grant.id }))).toMatchObject({ success: false });
    expect(h.page.clickCount).toBe(0);
  });
  it.each(['manual_approval', 'policy_auto'] as const)('%s uses an independent durable Decision, Grant, batch and readback', async mode => {
    const h = workflow(mode);
    const analysis = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    if (mode === 'manual_approval') await approveHumanBatch(h);
    const authorization = mode === 'manual_approval'
      ? success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: analysis.proposals.map(proposal => proposal.id) })))
      : analysis.automaticAuthorization!;
    expect(authorization.authorized).toBe(true); const grant = authorization.grant!;
    expect(grant.issuer.type).toBe(mode === 'manual_approval' ? 'human' : 'policy');
    for (const adEntityId of grant.allowedAdEntityIds) success(await h.api.executionResolveIdentity(h.request({ grantId: grant.id, adEntityId })));
    const batch = success(await h.api.executionCreateBatch(h.request({ grantId: grant.id })));
    const completed = success(await h.api.executionStart(h.request({ batchId: batch.projection.batch.id })));
    expect(completed.batch.status).toBe('succeeded'); expect(h.page.clickCount).toBe(1);
    const lineage = verifyExecutionCanaryLineage(h.database, { storeId: h.context.storeId, missionGrantId: grant.id,
      batchId: completed.batch.id, jobId: completed.jobs[0].id, mode });
    expect(lineage.passed, JSON.stringify(lineage.reasons)).toBe(true);
    const again = await h.api.executionStart(h.request({ batchId: batch.projection.batch.id }));
    expect(h.page.clickCount).toBe(1);
    expect(again.success ? again.data.batch.status : 'blocked').not.toBe('running');
    const receipts = h.service.listAnalysisRuns(h.context, { missionId: h.missionId });
    expect(receipts[0].metadata?.actionBatchId).toBe(analysis.proposals[0].actionBatchId);
    const memory = success(await h.api.memoryList(h.request({ missionId: h.missionId })));
    expect(memory.some(event => event.stage === 'READBACK')).toBe(true);
    for (const table of ['v16_missions', 'decisions_v16', 'mission_grants_v16', 'execution_slots', 'execution_batches', 'causal_events_v16']) {
      expect((h.database.prepare('SELECT COUNT(*) AS count FROM ' + table).get() as { count: number }).count).toBe(0);
    }
  });
  it('does not authorize a partial selection of the current action batch', async () => {
    const h = workflow('manual_approval', 2); const result = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    const authorization = success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: [result.proposals[0].id] })));
    expect(authorization.authorized).toBe(false); expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toHaveLength(0);
  });
  it('rejects seven report types without manufacturing a completed analysis', async () => {
    const h = workflow();
    const original = h.database.prepare("SELECT * FROM report_import_runs WHERE run_id = 'run-1'").get() as Record<string, unknown>;
    const next = { ...original, run_id: 'run-seven', idempotency_key: 'incomplete-seven', completed_at: '2026-07-22T12:00:00.001Z' };
    const keys = Object.keys(next); h.database.prepare('INSERT INTO report_import_runs (' + keys.join(',') + ') VALUES (' + keys.map(() => '?').join(',') + ')').run(...Object.values(next));
    const sources = h.database.prepare("SELECT * FROM report_import_file_snapshots WHERE run_id = 'run-1' AND report_type <> 'placement'").all() as Record<string, unknown>[];
    for (const source of sources) { const copy = { ...source, run_id: 'run-seven', snapshot_id: 'seven-' + source.snapshot_id }; const fields = Object.keys(copy); h.database.prepare('INSERT INTO report_import_file_snapshots (' + fields.join(',') + ') VALUES (' + fields.map(() => '?').join(',') + ')').run(...Object.values(copy)); }
    expect(await h.api.analysisRun(h.request({ missionId: h.missionId }))).toMatchObject({ success: false });
    expect(h.service.getMissionAnalysisProjection(h.context, h.missionId).actionBatches).toHaveLength(0);
  });
  it('fails before business writes when any current authority field differs', async () => {
    const h = workflow(); const before = h.database.prepare('SELECT total_changes() AS changes').get();
    for (const patch of [{ storeId: 'store-b' }, { browserProfileId: 'profile-b' }, { businessDate: '2026-07-23' }, { sessionGeneration: 5 }, { businessTimezone: 'America/New_York' }]) {
      const storeContext = normalizeStoreContextEnvelope({ ...h.context, ...patch });
      expect(await h.api.analysisRun({ ...h.request({ missionId: h.missionId }), storeContext })).toMatchObject({ success: false });
    }
    expect(h.database.prepare('SELECT total_changes() AS changes').get()).toEqual(before); expect(h.generationScopes).toHaveLength(0);
  });
});


it('never revives an issued grant after a policy mode A-to-B-to-A change', async () => {
  const h = workflow();
  const analysis = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
  await approveHumanBatch(h);
  const authorization = success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: analysis.proposals.map(p => p.id) })));
  expect(authorization.authorized).toBe(true);
  const grant = authorization.grant!;
  for (const autonomyMode of ['policy_auto', 'manual_approval'] as const) {
    const runtime = h.missionRepository.getPolicyRuntime(h.context);
    h.missionRepository.updatePolicyRuntime(h.context, { expectedRevision: runtime.revision, actorId: 'test-operator', patch: { autonomyMode, reason: 'test mode change' } });
  }
  expect(h.missionRepository.getMissionGrantTerminalEvent(h.context, grant.id)?.eventType).toBe('invalidated');
  expect(await h.api.executionCreateBatch(h.request({ grantId: grant.id }))).toMatchObject({ success: false });
  expect(h.page.clickCount).toBe(0);
});
