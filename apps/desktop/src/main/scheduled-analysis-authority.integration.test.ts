import { describe, expect, it } from 'vitest';
import { LocalScheduler } from '@amazon-ai-ops/scheduler';
import { type CreateMissionGrantInput } from '@amazon-ai-ops/shared-types';
import { registerScheduledAnalysisTask } from './scheduled-analysis-task';
import { approveHumanDecisions, createHarness, runRequest } from './analysis-authority.test-support';

describe('production scheduled analysis authority boundary', () => {
  it.each(['manual_approval', 'policy_auto'] as const)(
    'completes scheduled %s analysis without execution when its current-mode authority is absent', async mode => {
      const h = createHarness({ autonomyMode: mode, fallback: mode === 'policy_auto' });
      const scheduler = new LocalScheduler();
      registerScheduledAnalysisTask(scheduler, { readScope: () => h.context, runAnalysis: async scope => {
        expect(scope).toEqual(h.context);
        await runRequest(h);
      } });
      expect(scheduler.getTasks()[0]).toMatchObject({ name: 'daily_recommendation_generate', enabled: false });
      await scheduler.runNow('daily_recommendation_generate');
      expect(scheduler.getTasks()[0].lastStatus).toBe('success');
      const projection = h.service.getMissionAnalysisProjection(h.context, h.missionId);
      expect(projection.actionBatches).toHaveLength(1);
      expect(projection.proposals.length).toBeGreaterThan(0);
      const decisions = h.missionRepository.listDecisions(h.context, { missionId: h.missionId });
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions.every(item => item.status === (mode === 'policy_auto' ? 'blocked' : 'needs_approval'))).toBe(true);
      expect(h.missionRepository.listMissionGrants(h.context, h.missionId)).toEqual([]);
      expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_batches').get()).toEqual({ count: 0 });
      expect(h.database.prepare("SELECT COUNT(*) AS count FROM mission_grant_events WHERE event_type IN ('reserved','spent')").get()).toEqual({ count: 0 });
      await scheduler.stopAndDrain();
    },
  );

  it.each(['scheduler', 'human', 'policy'] as const)('rejects scheduler actor using issuer %s even after current manual Decisions are approved', async type => {
    const h = createHarness();
    await runRequest(h);
    approveHumanDecisions(h);
    const mission = h.missionRepository.getMission(h.context, h.missionId)!;
    const policy = h.missionRepository.getPolicyVersion(h.context, h.policyVersionId)!;
    const decisions = h.missionRepository.listDecisions(h.context, { missionId: h.missionId });
    const input = { id: `forged-scheduler-${type}`, missionId: mission.id, missionRevision: mission.revision,
      decisionIds: decisions.map(item => item.id), actionRevision: h.analysisRepository.getLatestActionBatch(h.context, h.missionId)!.actionRevision,
      allowedActionTypes: ['set_keyword_bid'], allowedAdEntityIds: decisions.map(item => item.adEntityId!),
      maxChangePct: 10, totalImpactBudget: 10, expiresAt: '2026-07-22T13:00:00.000Z',
      policyVersionId: policy.id, policyRevision: policy.revision, requiredEvidence: policy.rules.requiredEvidence,
      stopConditions: policy.rules.stopConditions, issuer: { type, actorId: 'scheduler' } } as CreateMissionGrantInput;
    const before = h.database.prepare('SELECT total_changes() AS count').get();
    expect(() => h.missionRepository.issueMissionGrant(h.context, input)).toThrow();
    expect(h.missionRepository.listMissionGrants(h.context, mission.id)).toEqual([]);
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
  });
});
