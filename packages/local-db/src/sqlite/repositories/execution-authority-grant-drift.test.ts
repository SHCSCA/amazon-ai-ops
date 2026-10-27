import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { MissionDomainRepository } from './mission-domain-repo';
import { seedSecondStoreAuthority } from './execution-authority-repo.test-authority';
import { registerIdentity } from './execution-authority-repo.test-jobs';
import { createHarness, NOW } from './execution-authority-repo.test-harness';

describe('canonical Grant drift rejection', () => {
  it.each(['mission', 'runtime', 'session', 'store'] as const)('rejects %s mismatch through real execution creation without altering the immutable grant', mismatch => {
    const h = createHarness();
    registerIdentity(h);
    const original = h.database.prepare("SELECT * FROM mission_grants WHERE id='grant-1'").get();
    let context = h.context;
    const domain = new MissionDomainRepository(h.database, { now: () => new Date(NOW) });
    if (mismatch === 'mission') {
      const mission = domain.getMission(context, 'mission-1')!;
      domain.updateMission(context, { id: mission.id, expectedRevision: mission.revision, actorId: 'operator', patch: { title: '已修订任务标题' } });
    } else if (mismatch === 'runtime') {
      const runtime = domain.getPolicyRuntime(context);
      domain.updatePolicyRuntime(context, { expectedRevision: runtime.revision, actorId: 'operator', patch: { autonomyMode: 'policy_auto', reason: '当前权限改为策略自动。' } });
    } else if (mismatch === 'session') {
      h.database.prepare("UPDATE app_settings SET value='5' WHERE key='store_session_generation:store-one'").run();
      h.database.prepare("UPDATE store_session_metadata SET session_generation=5 WHERE store_id='store-one'").run();
      context = normalizeStoreContextEnvelope({ ...context, sessionGeneration: 5 });
    } else {
      context = seedSecondStoreAuthority(h.database);
    }
    expect(() => h.repository.createExactExecutionBatch(context, 'grant-1')).toThrow();
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_jobs').get()).toEqual({ count: 0 });
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_batches').get()).toEqual({ count: 0 });
    expect(h.database.prepare("SELECT * FROM mission_grants WHERE id='grant-1'").get()).toEqual(original);
  });
});
