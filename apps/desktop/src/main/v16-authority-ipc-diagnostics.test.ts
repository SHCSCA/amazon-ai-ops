import { describe, expect, it, vi } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { authorityGateProjection } from '@amazon-ai-ops/shared-types/src/authority-gates';
import { V16_API_VERSION } from '@amazon-ai-ops/shared-types/src/v16-api';
import { ExecutionAuthorityGateError, MissionAuthorityGateError } from '@amazon-ai-ops/local-db';
import { createV16ServicesPreloadApi } from '../preload/v16-services-preload';
import { registerV16ServicesIpc, type V16Services } from './v16-services-ipc';
import { workflow, approveHumanBatch, success } from './v16-production.test-support';
import { runtimeLogger } from './runtime-logger';

function setup() {
  const context = normalizeStoreContextEnvelope({ storeId: 'gate-store', browserProfileId: 'gate-profile', marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 3 });
  const services: V16Services = {
    domain: { executeOperation: vi.fn(() => []) },
    analysis: { runMissionAnalysis: vi.fn(), getMissionAnalysisProjection: vi.fn(), authorizeProposalBatch: vi.fn() },
    execution: { listBatches: vi.fn(), resolveIdentity: vi.fn(), createBatch: vi.fn(), startBatch: vi.fn(), cancelBatch: vi.fn(), reconcileUnknownBatch: vi.fn(), takeOverVisibleBrowser: vi.fn() },
    storeCoordinator: { assertActiveStoreContext: () => context },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const handlers = new Map<string, (event: unknown, request?: unknown) => unknown>();
  registerV16ServicesIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, services, logger);
  const api = createV16ServicesPreloadApi({ invoke: async (channel, request) => handlers.get(channel)!(undefined, request) });
  return { services, logger, api, request: <T,>(input: T) => ({ apiVersion: V16_API_VERSION, storeContext: context, input }) };
}

describe('V16 canonical authority gate IPC diagnostics', () => {
  it('keeps a real incomplete batch blocker code Chinese recovery receipt and structured log aligned without creating authority', async () => {
    const h = workflow('manual_approval', 2);
    const run = success(await h.api.analysisRun(h.request({ missionId: h.missionId })));
    await approveHumanBatch(h);
    const warning = vi.spyOn(runtimeLogger, 'warn');
    try {
      const result = success(await h.api.grantIssue(h.request({ missionId: h.missionId, proposalIds: [run.proposals[0].id] })));
      expect(result).toMatchObject({ authorized: false, blockers: [{ code: 'INCOMPLETE_BATCH', message: '必须整批授权，不能只批准动作批次的一部分。' }] });
      expect(warning).toHaveBeenCalledWith('analysis.authorization_blocked', { mode: 'manual_approval', blockerCodes: ['INCOMPLETE_BATCH'] });
      const receipts = h.missionRepository.listCausalEvents(h.context, { missionId: h.missionId })
        .filter(event => event.entityType === 'analysis_run');
      expect(receipts.map(event => event.eventType)).toContain('analysis_run_completed');
      expect(receipts.find(event => event.eventType === 'analysis_run_completed')!.signal).toContain('条可复核建议');
      expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toEqual([]);
      expect(h.execution.listBatches(h.context)).toEqual([]);
      expect(JSON.stringify(warning.mock.calls)).not.toMatch(/\.xlsx|password|token=|private|prompt/i);
    } finally { warning.mockRestore(); }
  });
  it('projects Mission gate priority and every blocker through Preload without raw error material', async () => {
    const h = setup();
    vi.mocked(h.services.analysis.authorizeProposalBatch).mockImplementation(() => { throw new MissionAuthorityGateError([
      { priority: 'P0', error: new Error('C:/private/session cookie=secret') },
      { priority: 'P5', error: new Error('https://account.invalid/?token=secret') },
    ]); });
    const result = await h.api.grantIssue(h.request({ missionId: 'mission', proposalIds: ['proposal'] }));
    expect(result).toMatchObject({ success: false, authorityGate: { primaryBlocker: { priority: 'P0', recoveryIntent: 'policy/rules' }, blockers: [{ priority: 'P0' }, { priority: 'P5' }] } });
    expect(h.logger.error).toHaveBeenCalledWith('v16.operation_failed', { method: 'grantIssue', code: 'STATE_CONFLICT', blockedPriorities: ['P0', 'P5'] });
    expect(JSON.stringify([result, h.logger.error.mock.calls])).not.toMatch(/private|secret|account\.invalid/);
  });

  it('projects Execution gate diagnostics and records one fixed safe event', async () => {
    const h = setup();
    const gate = authorityGateProjection(['P6', 'P4'])!;
    vi.mocked(h.services.execution.createBatch).mockImplementation(() => { throw new ExecutionAuthorityGateError('STATE_CONFLICT', 'password=secret C:/private/session', gate); });
    const result = await h.api.executionCreateBatch(h.request({ grantId: 'grant' }));
    expect(result).toMatchObject({ success: false, error: gate.primaryBlocker.message, authorityGate: gate });
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(h.logger.error).toHaveBeenCalledWith('v16.operation_failed', { method: 'executionCreateBatch', code: 'STATE_CONFLICT', blockedPriorities: ['P4', 'P6'] });
    expect(JSON.stringify([result, h.logger.error.mock.calls])).not.toMatch(/password|private|secret/);
  });

  it('records safe generic failures without copying the request or exception into logs', async () => {
    const h = setup();
    vi.mocked(h.services.domain.executeOperation).mockImplementation(() => { throw new Error('secret:token C:/private/profile'); });
    const result = await h.api.memoryExport(h.request({ missionId: 'mission' }));
    expect(result).toMatchObject({ success: false, code: 'V16_OPERATION_FAILED' });
    expect(h.logger.error).toHaveBeenCalledWith('v16.operation_failed', { method: 'memoryExport', code: 'V16_OPERATION_FAILED' });
    expect(JSON.stringify([result, h.logger.error.mock.calls])).not.toMatch(/token|private|profile|secret/);
  });
});
