import { describe, expect, it } from 'vitest';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { seedSecondStoreAuthority } from './execution-authority-repo.test-authority';
import { driveFirstJobToSuccessInBatch, registerIdentity } from './execution-authority-repo.test-jobs';
import { NOW, createHarness } from './execution-authority-repo.test-harness';
describe("ExecutionAuthorityRepository", () => {
it('recovers the policy callback crash window and an interrupted pre-batch attempt exactly once', () => {
    const harness = createHarness(10, 10, 1, 'policy');

    const first = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(first.discoveredPending).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(harness.context)).toEqual([
      expect.objectContaining({
        grantId: 'grant-1',
        status: 'pending',
        attemptCount: 0,
        batchJobCount: 0,
        code: 'DISPATCH_PENDING',
      }),
    ]);
    expect(harness.repository.recoverPolicyGrantDispatchesOnStartup().discoveredPending).toEqual([]);

    harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'attempting',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'browser failed at C:\\private\\profile Bearer secret-value '
        + 'cookie=user@example.test account=private-account profile_id=private-profile '
        + 'https://example.test/path?q=1',
    });
    const interrupted = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(interrupted.interruptedToWaiting).toEqual(['grant-1']);
    const recovered = harness.repository.listPolicyGrantDispatches(harness.context)[0]!;
    expect(recovered).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'STARTUP_ATTEMPT_INTERRUPTED',
    });
    const signals = harness.database.prepare(`
      SELECT signal FROM causal_events
      WHERE store_id = 'store-one'
        AND entity_type = 'policy_grant_dispatch_v1'
        AND source = 'policy-grant-dispatch-v1'
    `).all() as Array<{ signal: string }>;
    expect(signals.every((item) => (
      !item.signal.includes('C:\\private')
      && !item.signal.includes('secret-value')
      && !item.signal.includes('user@example.test')
      && !item.signal.includes('private-account')
      && !item.signal.includes('private-profile')
      && !item.signal.includes('example.test')
    ))).toBe(true);
    expect(harness.repository.recoverPolicyGrantDispatchesOnStartup().interruptedToWaiting).toEqual([]);
  });

it('enforces monotonic policy dispatch attempts, terminality, and code/status pairs', () => {
    const harness = createHarness(10, 10, 1, 'policy');
    harness.repository.recoverPolicyGrantDispatchesOnStartup();

    expect(() => harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'attempting',
      trigger: 'grant_issued',
      attempt: 2,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'attempt jump',
    })).toThrow(/exactly one|attempt/i);

    harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'attempting',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'DISPATCH_ATTEMPT_STARTED',
      detail: 'first attempt',
    });
    expect(() => harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'waiting_runtime',
      trigger: 'timer_retry',
      attempt: 0,
      code: 'RUNTIME_UNAVAILABLE',
      detail: 'attempt regression',
    })).toThrow(/cannot move backward|attempt/i);
    expect(() => harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'completed',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'RUNTIME_UNAVAILABLE',
      detail: 'status code mismatch',
    })).toThrow(/code.*status/i);

    harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'attention_required',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'UNSAFE_DISPATCH_FAILURE',
      detail: 'terminal',
    });
    expect(() => harness.repository.appendPolicyGrantDispatchEvent(harness.context, {
      grantId: 'grant-1',
      status: 'pending',
      trigger: 'grant_issued',
      attempt: 1,
      code: 'DISPATCH_PENDING',
      detail: 'terminal regression',
    })).toThrow(/terminal/i);
  });

it('keeps policy dispatch discovery and journal reads isolated by store', () => {
    const harness = createHarness(10, 10, 1, 'policy');
    const secondContext = seedSecondStoreAuthority(harness.database);

    const recovery = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(recovery.discoveredPending).toEqual(expect.arrayContaining(['grant-1', 'grant-2']));
    expect(harness.repository.listPolicyGrantDispatches(harness.context)
      .map((dispatch) => dispatch.grantId)).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(secondContext)
      .map((dispatch) => dispatch.grantId)).toEqual(['grant-2']);
    expect(() => harness.repository.appendPolicyGrantDispatchEvent(secondContext, {
      grantId: 'grant-1',
      status: 'pending',
      trigger: 'grant_issued',
      attempt: 0,
      code: 'DISPATCH_PENDING',
      detail: 'cross-store attempt',
    })).toThrow(/grant|store|not found/i);
  });

it('queues an existing pre-intent batch for durable serial execution without duplicate creation', () => {
    const harness = createHarness(10, 10, 1, 'policy');
    registerIdentity(harness);
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');

    const first = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(first.queuedExistingBatch).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'queued_for_execution',
      batchId: created.projection.batch.id,
      batchStatus: 'queued',
      batchJobCount: 1,
      code: 'BATCH_QUEUED_FOR_EXECUTION',
    });
    expect(harness.repository.recoverPolicyGrantDispatchesOnStartup().queuedExistingBatch).toEqual([]);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM causal_events
      WHERE store_id = 'store-one'
        AND event_type = 'policy_grant_dispatch_queued_for_execution_v1'
        AND entity_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
  });

it('queues a partially succeeded batch when only the untouched suffix remains pre-intent', () => {
    const harness = createHarness(10, 10, 2, 'policy');
    registerIdentity(harness);
    registerIdentity(harness, {
      adEntityId: 'opaque-keyword-2',
      campaignId: 'campaign-2',
      adGroupId: 'ad-group-2',
      keywordId: 'keyword-2',
      observedBidCents: 200,
      pageIdentityHash: '4'.repeat(64),
      resolutionProofSha256: '5'.repeat(64),
    });
    const created = harness.repository.createExactExecutionBatch(harness.context, 'grant-1');
    driveFirstJobToSuccessInBatch(harness, created.projection.batch.id);
    expect(harness.repository.getExecutionBatch(harness.context, created.projection.batch.id)?.jobs
      .map((job) => job.status)).toEqual(['succeeded', 'queued']);

    const recovery = harness.repository.recoverPolicyGrantDispatchesOnStartup();

    expect(recovery.queuedExistingBatch).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'queued_for_execution',
      batchId: created.projection.batch.id,
      batchStatus: 'queued',
      batchJobStatuses: ['succeeded', 'queued'],
      batchHasPersistedIntent: true,
      code: 'BATCH_QUEUED_FOR_EXECUTION',
    });
    expect(harness.repository.recoverPolicyGrantDispatchesOnStartup().queuedExistingBatch)
      .toEqual([]);
    expect(harness.database.prepare(`
      SELECT event_type AS eventType FROM mission_grant_events
      WHERE store_id = 'store-one' AND grant_id = 'grant-1' AND event_type NOT IN ('reserved','spent')
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get()).toEqual({ eventType: 'issued' });
  });

it('marks a prior-session policy grant attention-required instead of rebinding it', () => {
    const harness = createHarness(10, 10, 1, 'policy');
    harness.database.prepare(`
      UPDATE app_settings SET value = '5', updated_at = ?
      WHERE key = 'store_session_generation:store-one'
    `).run(NOW);
    harness.database.prepare(`
      UPDATE store_session_metadata SET session_generation = 5, updated_at = ?
      WHERE store_id = 'store-one' AND provider = 'amazon_ads'
    `).run(NOW);
    const currentContext = normalizeStoreContextEnvelope({
      ...harness.context,
      sessionGeneration: 5,
    });

    const recovery = harness.repository.recoverPolicyGrantDispatchesOnStartup();
    expect(recovery.attentionRequired).toEqual(['grant-1']);
    expect(harness.repository.listPolicyGrantDispatches(currentContext)[0]).toMatchObject({
      status: 'attention_required',
      code: 'SESSION_REAUTHORIZATION_REQUIRED',
      batchJobCount: 0,
    });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 0 });
  });
});
