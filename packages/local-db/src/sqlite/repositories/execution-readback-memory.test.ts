import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { MissionDomainRepository } from './mission-domain-repo';
import { createHarness, NOW } from './execution-authority-repo.test-harness';
import { driveSingleJobToSuccess, registerIdentity } from './execution-authority-repo.test-jobs';

function readbackRows(h: ReturnType<typeof createHarness>) {
  return h.database.prepare("SELECT * FROM causal_events WHERE event_type='execution_readback_verified'").all();
}

describe('verified execution READBACK memory ledger', () => {
  it('preserves original date and session on recovery and appends event and real proofs only once', () => {
    const h = createHarness();
    const succeeded = driveSingleJobToSuccess(h);
    h.database.prepare("UPDATE app_settings SET value='5' WHERE key='store_session_generation:store-one'").run();
    h.database.prepare("UPDATE store_session_metadata SET session_generation=5 WHERE store_id='store-one'").run();
    const current = normalizeStoreContextEnvelope({ ...h.context, sessionGeneration: 5, businessDate: '2026-07-23' });
    h.repository.completeDomainReconciliation(current, succeeded.batch.id);
    const rows = readbackRows(h);
    expect(rows).toEqual([expect.objectContaining({ stage: 'READBACK', entity_type: 'ad_execution_batch',
      entity_id: succeeded.batch.id, mission_id: 'mission-1', business_date: '2026-07-22', session_generation: 4,
      status: 'verified', created_at: succeeded.batch.terminalAt })]);
    const proofs = h.database.prepare('SELECT * FROM evidence_refs WHERE event_id=? ORDER BY evidence_type').all((rows[0] as { id: string }).id);
    expect(proofs).toHaveLength(3);
    expect(proofs.every(proof => /^[a-f0-9]{64}$/i.test((proof as { sha256: string }).sha256))).toBe(true);
    h.repository.completeDomainReconciliation(current, succeeded.batch.id);
    expect(readbackRows(h)).toEqual(rows);
    expect(h.database.prepare('SELECT * FROM evidence_refs WHERE event_id=? ORDER BY evidence_type').all((rows[0] as { id: string }).id)).toEqual(proofs);
  });

  it('rejects premature closure and forged success without producing READBACK authority', () => {
    const h = createHarness();
    registerIdentity(h);
    const batch = h.repository.createExactExecutionBatch(h.context, 'grant-1').projection.batch;
    expect(() => h.database.prepare("UPDATE ad_execution_jobs SET status='succeeded',terminal_at=? WHERE batch_id=?").run(NOW, batch.id)).toThrow(/transition/);
    expect(() => h.repository.completeDomainReconciliation(h.context, batch.id)).toThrow(/not terminal/i);
    expect(readbackRows(h)).toEqual([]);
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_domain_reconciliations').get()).toEqual({ count: 0 });
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM evidence_refs').get()).toEqual({ count: 0 });
    expect(h.database.prepare("SELECT event_type AS type FROM mission_grant_events WHERE grant_id='grant-1'").all()).toEqual([{ type: 'issued' }]);
  });

  it('rejects conflicting existing READBACK history and leaves its fact and proof set unchanged', () => {
    const h = createHarness();
    const succeeded = driveSingleJobToSuccess(h);
    const domain = new MissionDomainRepository(h.database, { now: () => new Date(NOW) });
    const id = `causal:execution:${succeeded.batch.id}:verified-readback`;
    domain.appendCausalEvent(h.context, { id, stage: 'READBACK', eventType: 'execution_readback_verified',
      entityType: 'ad_execution_batch', entityId: 'another-batch', missionId: 'mission-1', title: '待核对历史',
      observedEffect: '历史记录并非本次执行。', status: 'verified', source: 'execution-ledger', actorId: 'execution-authority' });
    const original = readbackRows(h);
    expect(() => h.repository.completeDomainReconciliation(h.context, succeeded.batch.id)).toThrow(/conflict/i);
    expect(readbackRows(h)).toEqual(original);
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM evidence_refs WHERE event_id=?').get(id)).toEqual({ count: 0 });
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_domain_reconciliations').get()).toEqual({ count: 0 });
  });
});
