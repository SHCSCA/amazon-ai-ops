import { describe, expect, it } from 'vitest';
import type { CreateMissionGrantInput } from '@amazon-ai-ops/shared-types';
import { MissionAuthorityGateError } from './mission-domain-repo';
import { ExecutionAuthorityRepository } from './execution-authority-repo';
import { createHarness, createApprovedDecision, seedActiveMission } from './mission-domain-repo.test-harness';
import { policyRules } from './mission-domain-repo.test-data';
function currentGrant() {
  let clock = new Date('2026-07-22T12:00:00.000Z');
  const harness = createHarness(() => clock);
  const { mission, version } = seedActiveMission(harness.repository, harness.contextOne);
  const decision = createApprovedDecision(harness.database, harness.repository, harness.contextOne, mission, version, 1);
  const rules = policyRules(harness.contextOne.storeId);
  const input: CreateMissionGrantInput = {
    id: 'current-grant', missionId: mission.id, missionRevision: mission.revision,
    decisionIds: [decision.id], actionRevision: 1, allowedActionTypes: ['set_keyword_bid'],
    allowedAdEntityIds: [decision.adEntityId!], maxChangePct: 10, totalImpactBudget: 10,
    expiresAt: '2026-07-22T12:01:00.000Z', policyVersionId: version.id,
    policyRevision: version.revision, requiredEvidence: rules.requiredEvidence,
    stopConditions: rules.stopConditions, issuer: { type: 'human', actorId: 'operator' },
  };
  return { ...harness, input, setClock: (value: string) => { clock = new Date(value); }, now: () => clock };
}

describe('canonical Mission authorization', () => {
  it.each(['semi_auto', 'automatic', '', 'human_operator'])('rejects noncanonical mode %s without changing current runtime or audit', mode => {
    const h = currentGrant();
    const before = h.repository.getPolicyRuntime(h.contextOne);
    const events = h.repository.listCausalEvents(h.contextOne);
    const changes = h.database.prepare('SELECT total_changes() AS count').get();
    expect(() => h.repository.updatePolicyRuntime(h.contextOne, {
      expectedRevision: before.revision, actorId: 'operator',
      patch: { autonomyMode: mode as never, reason: '核对非法模式不得写入。' },
    })).toThrow(/Unsupported autonomy mode/);
    expect(h.repository.getPolicyRuntime(h.contextOne)).toEqual(before);
    expect(h.repository.listCausalEvents(h.contextOne)).toEqual(events);
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
  });

  it('persists only the two canonical modes through the actual runtime and rejects stale CAS', () => {
    const h = currentGrant();
    const initial = h.repository.getPolicyRuntime(h.contextOne);
    expect(initial.autonomyMode).toBe('manual_approval');
    const automatic = h.repository.updatePolicyRuntime(h.contextOne, {
      expectedRevision: initial.revision, actorId: 'operator',
      patch: { autonomyMode: 'policy_auto', reason: '按当前策略启用自动权限。' },
    });
    expect(automatic.autonomyMode).toBe('policy_auto');
    expect(() => h.repository.updatePolicyRuntime(h.contextOne, {
      expectedRevision: initial.revision, actorId: 'operator', patch: { autonomyMode: 'manual_approval' },
    })).toThrow(/revision/);
    const manual = h.repository.updatePolicyRuntime(h.contextOne, {
      expectedRevision: automatic.revision, actorId: 'operator',
      patch: { autonomyMode: 'manual_approval', reason: '恢复人工审批权限。' },
    });
    expect(manual.autonomyMode).toBe('manual_approval');
    expect(manual.revision).toBeGreaterThan(automatic.revision);
  });

  it('rejects an expired canonical grant before creating any execution rows', () => {
    const h = currentGrant();
    h.repository.issueMissionGrant(h.contextOne, h.input);
    h.database.prepare(`INSERT INTO store_connections
      (id,store_id,provider,status,account_label,external_account_id,normalized_external_account_id,last_verified_at,created_at,updated_at)
      VALUES ('expiry-ads-connection',?,'amazon_ads','ready','隔离测试账号','expiry-ads','expiry-ads',?,?,?)`)
      .run(h.contextOne.storeId, h.now().toISOString(), h.now().toISOString(), h.now().toISOString());
    h.database.prepare("UPDATE store_session_metadata SET external_account_id='expiry-ads' WHERE store_id=? AND provider='amazon_ads'")
      .run(h.contextOne.storeId);
    h.setClock('2026-07-22T12:02:00.000Z');
    const execution = new ExecutionAuthorityRepository(h.database, { now: h.now });
    const immutableGrant = h.database.prepare('SELECT * FROM mission_grants WHERE id=?').get(h.input.id);
    expect(() => execution.createExactExecutionBatch(h.contextOne, h.input.id)).toThrow(/expired/);
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_batches').get()).toEqual({ count: 0 });
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_jobs').get()).toEqual({ count: 0 });
    expect(h.database.prepare('SELECT * FROM mission_grants WHERE id=?').get(h.input.id)).toEqual(immutableGrant);
    expect(h.repository.listMissionGrantEvents(h.contextOne, h.input.missionId).filter(event => event.eventType === 'expired')).toHaveLength(1);
  });

  it('keeps expiry projection read-only and appends expiration once through the explicit lifecycle command', () => {
    const h = currentGrant();
    const issued = h.repository.issueMissionGrant(h.contextOne, h.input);
    h.setClock('2026-07-22T12:02:00.000Z');
    const changes = h.database.prepare('SELECT total_changes() AS count').get();
    expect(h.repository.getMissionGrant(h.contextOne, issued.id)?.usage).toMatchObject({ status: 'expired', residualSlots: 0 });
    expect(h.repository.listMissionGrants(h.contextOne, issued.missionId)).toHaveLength(1);
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(changes);
    expect(h.repository.listMissionGrantEvents(h.contextOne, issued.missionId).filter(event => event.eventType === 'expired')).toEqual([]);
    expect(h.repository.expireMissionGrants(h.contextOne)).toBe(1);
    expect(h.repository.expireMissionGrants(h.contextOne)).toBe(0);
    expect(h.repository.listMissionGrantEvents(h.contextOne, issued.missionId).filter(event => event.eventType === 'expired'))
      .toEqual([expect.objectContaining({ grantId: issued.id, actorId: 'authority-maintenance' })]);
    h.setClock('2026-07-22T12:00:00.000Z');
    expect(h.repository.getMissionGrant(h.contextOne, issued.id)?.usage).toMatchObject({ status: 'expired', residualSlots: 0 });
    const { usage: _beforeUsage, ...before } = issued;
    const { usage: _afterUsage, ...after } = h.repository.getMissionGrant(h.contextOne, issued.id)!;
    expect(after).toEqual(before);
    expect(() => h.database.prepare("DELETE FROM mission_grant_events WHERE event_type='expired'").run()).toThrow(/append-only/);
  });

  it('evaluates every issuance gate and selects P0 ahead of lower-priority independent failures', () => {
    const h = currentGrant();
    h.database.prepare("UPDATE policy_runtime SET kill_switch=1,circuit_breaker_state='open' WHERE store_id=?").run(h.contextOne.storeId);
    let failure: unknown;
    try {
      h.repository.issueMissionGrant(h.contextOne, {
        ...h.input, missionRevision: h.input.missionRevision + 1,
        expiresAt: '2026-07-22T11:59:00.000Z', maxChangePct: 11,
        decisionIds: ['not-the-current-approved-decision'],
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MissionAuthorityGateError);
    const blocked = failure as MissionAuthorityGateError;
    expect(blocked.authorityGate.primaryBlocker.priority).toBe('P0');
    expect(blocked.authorityGate.blockers.map(blocker => blocker.priority)).toEqual(['P0', 'P1', 'P3', 'P4', 'P5', 'P6']);
    expect(blocked.authorityGate.blockers.every(blocker => blocker.message && blocker.recoveryIntent)).toBe(true);
    expect(h.repository.listMissionGrants(h.contextOne, h.input.missionId)).toEqual([]);
  });

  it('still blocks a lower-priority gate when P0 and P1 pass', () => {
    const h = currentGrant();
    let failure: unknown;
    try { h.repository.issueMissionGrant(h.contextOne, { ...h.input, totalImpactBudget: 99 }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MissionAuthorityGateError);
    expect((failure as MissionAuthorityGateError).authorityGate.blockers.map(blocker => blocker.priority)).toEqual(['P5']);
    expect(h.repository.listMissionGrants(h.contextOne, h.input.missionId)).toEqual([]);
  });
  it('refuses a corrupt persisted autonomy mode without repairing or rewriting the runtime on read', () => {
    const h = currentGrant();
    h.database.pragma('ignore_check_constraints=ON');
    h.database.prepare("UPDATE policy_runtime SET autonomy_mode='semi_auto' WHERE store_id=?").run(h.contextOne.storeId);
    h.database.pragma('ignore_check_constraints=OFF');
    const before = h.database.prepare('SELECT total_changes() AS count').get();
    expect(() => h.repository.getPolicyRuntime(h.contextOne)).toThrow(/运行时记录不完整|当前策略|模式|无效/);
    expect(h.database.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    expect(h.database.prepare('SELECT autonomy_mode AS mode FROM policy_runtime WHERE store_id=?').get(h.contextOne.storeId)).toEqual({ mode: 'semi_auto' });
  });

});
