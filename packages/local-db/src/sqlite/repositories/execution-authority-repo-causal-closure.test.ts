import { describe, expect, it } from 'vitest';
import { initSqlite } from '../db';
import { ExecutionAuthorityRepository } from './execution-authority-repo';
import { seedSecondStoreAuthority } from './execution-authority-repo.test-authority';
import { driveSingleJobToSuccess, registerIdentity } from './execution-authority-repo.test-jobs';
import  {
  NOW,
  PAGE_HASH,
  databases,
  createHarness,
} from './execution-authority-repo.test-harness';
describe("ExecutionAuthorityRepository", () => {
it('atomically backfills causal evidence and durably suppresses completed startup reconciliation', () => {
    const harness = createHarness();
    const succeeded = driveSingleJobToSuccess(harness);

    expect(harness.repository.recoverInterruptedExecutions().domainReconciliations)
      .toEqual([expect.objectContaining({ batchId: succeeded.batch.id, status: 'succeeded' })]);

    const completed = harness.repository.completeDomainReconciliation(
      harness.context,
      succeeded.batch.id,
    );
    expect(completed).toMatchObject({
      created: true,
      reconciliation: {
        storeId: 'store-one',
        batchId: succeeded.batch.id,
        batchStatus: 'succeeded',
        evidenceRefCount: 3,
        completedSessionGeneration: 4,
      },
    });
    expect(harness.database.prepare(`
      SELECT evidence_type AS evidenceType, evidence_ref AS evidenceRef, sha256
      FROM evidence_refs
      WHERE store_id = 'store-one' AND event_id = 'causal:grant:grant-1:consumed'
      ORDER BY evidence_type
    `).all()).toEqual([
      { evidenceType: 'ad_execution_after', evidenceRef: 'after-proof', sha256: '9'.repeat(64) },
      { evidenceType: 'ad_execution_before', evidenceRef: 'before-proof', sha256: '9'.repeat(64) },
      { evidenceType: 'ad_execution_reload', evidenceRef: 'reload-proof', sha256: '9'.repeat(64) },
    ]);
    expect(harness.repository.completeDomainReconciliation(harness.context, succeeded.batch.id))
      .toEqual({ ...completed, created: false });
    expect(harness.repository.recoverInterruptedExecutions()).toMatchObject({
      domainReconciliations: [],
      missionsRequiringStop: [],
    });

    harness.database.close();
    const reopened = initSqlite(harness.databasePath);
    databases.push(reopened);
    const reopenedRepository = new ExecutionAuthorityRepository(reopened, { now: () => new Date(NOW) });
    expect(reopenedRepository.recoverInterruptedExecutions()).toMatchObject({
      domainReconciliations: [],
      missionsRequiringStop: [],
    });
  });

it('rolls back partial evidence backfill when an existing causal reference conflicts', () => {
    const harness = createHarness();
    const succeeded = driveSingleJobToSuccess(harness);
    harness.database.prepare(`
      INSERT INTO evidence_refs (
        id, store_id, event_id, evidence_type, evidence_ref, sha256, created_at
      ) VALUES (
        'conflicting-after-ref', 'store-one', 'causal:grant:grant-1:consumed',
        'ad_execution_after', 'after-proof', ?, ?
      )
    `).run('7'.repeat(64), NOW);

    expect(() => harness.repository.completeDomainReconciliation(
      harness.context,
      succeeded.batch.id,
    )).toThrow(/conflict/i);
    expect(harness.database.prepare(`
      SELECT evidence_type AS evidenceType FROM evidence_refs
      WHERE store_id = 'store-one' AND event_id = 'causal:grant:grant-1:consumed'
      ORDER BY evidence_type
    `).all()).toEqual([{ evidenceType: 'ad_execution_after' }]);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(succeeded.batch.id)).toEqual({ count: 0 });
    expect(harness.repository.recoverInterruptedExecutions().domainReconciliations)
      .toEqual([expect.objectContaining({ batchId: succeeded.batch.id })]);
  });

it('keeps durable reconciliation completion isolated between two stores in one database', () => {
    const harness = createHarness();
    const secondContext = seedSecondStoreAuthority(harness.database);
    registerIdentity(harness);
    harness.repository.registerCanonicalKeywordIdentity(secondContext, {
      adEntityId: 'opaque-keyword-1',
      entityRevision: 1,
      adsAccountId: 'ads-account-2',
      campaignId: 'campaign-2',
      adGroupId: 'ad-group-2',
      keywordId: 'keyword-2',
      observedBidCents: 149,
      pageIdentityHash: PAGE_HASH,
      resolutionProofSha256: '8'.repeat(64),
      resolvedAt: NOW,
      resolvedBy: 'operator',
    });
    const first = harness.repository.createExactExecutionBatch(harness.context, 'grant-1').projection;
    const second = harness.repository.createExactExecutionBatch(secondContext, 'grant-2').projection;
    harness.repository.cancelJob(harness.context, {
      jobId: first.jobs[0]!.id,
      expectedRevision: first.jobs[0]!.revision,
      reasonCode: 'two_store_test_cancel',
    });
    harness.repository.cancelJob(secondContext, {
      jobId: second.jobs[0]!.id,
      expectedRevision: second.jobs[0]!.revision,
      reasonCode: 'two_store_test_cancel',
    });

    harness.repository.completeDomainReconciliation(secondContext, second.batch.id);
    expect(harness.repository.recoverInterruptedExecutions().domainReconciliations).toEqual([
      expect.objectContaining({
        storeId: harness.context.storeId,
        batchId: first.batch.id,
        status: 'cancelled',
      }),
    ]);
    harness.repository.completeDomainReconciliation(harness.context, first.batch.id);
    expect(harness.repository.recoverInterruptedExecutions().domainReconciliations).toEqual([]);
    expect(harness.database.prepare(`
      SELECT store_id AS storeId, batch_id AS batchId
      FROM ad_execution_domain_reconciliations ORDER BY store_id
    `).all()).toEqual([
      { storeId: 'store-one', batchId: first.batch.id },
      { storeId: 'store-two', batchId: second.batch.id },
    ]);
  });
});
