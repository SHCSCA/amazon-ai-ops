import  {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { enableLowerNumberMatchingPolicy, driveFirstJobToSuccess } from './execution-authority-service.test-authority';
import { NOW, createHarness } from './execution-authority-service.test-harness';
describe("ExecutionAuthorityService safety orchestration", () => {
it('rejects batch creation when a lower-number matching policy supersedes the grant policy', () => {
    const harness = createHarness(1, { createBatch: false });
    enableLowerNumberMatchingPolicy(harness.database);

    expect(() => harness.service.createBatch({
      context: harness.context,
      grantId: 'grant-1',
    })).toThrow(/highest priority|优先级|策略/i);
    expect(harness.executionRepository.listExecutionBatches(harness.context)).toEqual([]);
  });

it('marks automatic dispatch attention-required when a lower-number policy supersedes its grant', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    enableLowerNumberMatchingPolicy(harness.database);
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'attention_required',
      code: 'POLICY_AUTHORITY_CHANGED',
      batchJobCount: 0,
    });
    expect(harness.executionRepository.listExecutionBatches(harness.context)).toEqual([]);
    expect(harness.page.clickCount).toBe(0);
  });

it('persists a missing runtime and resumes the same policy grant once after session readiness', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      runtimeReady: false,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'RUNTIME_UNAVAILABLE',
      batchJobCount: 0,
    });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 0 });

    harness.setRuntimeReady(true);
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    const completed = harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]!;
    expect(completed).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      code: 'EXECUTION_TERMINAL',
      batchJobCount: 1,
      batchStatus: 'succeeded',
    });
    expect(harness.page.clickCount).toBe(1);

    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');
    expect(harness.page.clickCount).toBe(1);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
  });

it('journals a policy grant while Amazon Ads is offline before any browser side effect', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
      adsReady: false,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'RUNTIME_UNAVAILABLE',
      batchJobCount: 0,
    });
    expect(harness.page.clickCount).toBe(0);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM causal_events
      WHERE store_id = 'store-one'
        AND entity_type = 'policy_grant_dispatch_v1'
        AND entity_id = 'grant-1'
    `).get()).toEqual({ count: 3 });
  });

it('resumes the same created-but-not-started policy batch after startup recovery', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    const created = harness.executionRepository.createExactExecutionBatch(
      harness.context,
      'grant-1',
    ).projection;
    expect(harness.missionRepository.getMissionLineage(harness.context, 'mission-1').links
      .filter((link) => (
        link.linkType === 'execution'
        && link.targetId === created.batch.id
        && link.relation === 'authorized_execution_batch'
      ))).toEqual([]);
    harness.page.allowAfterScreenshot();

    harness.service.recoverStartup();
    await vi.waitFor(() => {
      expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]?.status)
        .toBe('completed');
    });

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 1,
      batchId: created.batch.id,
      batchStatus: 'succeeded',
      code: 'EXECUTION_TERMINAL',
    });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
    expect(harness.missionRepository.getMissionLineage(harness.context, 'mission-1').links
      .filter((link) => (
        link.linkType === 'execution'
        && link.targetId === created.batch.id
        && link.relation === 'authorized_execution_batch'
      ))).toHaveLength(1);
  });

it('repairs a missing execution link for a terminal grant without starting its batch', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    const created = harness.executionRepository.createExactExecutionBatch(
      harness.context,
      'grant-1',
    ).projection;
    harness.database.prepare(`
      INSERT INTO mission_grant_events (
        id, store_id, grant_id, event_type, actor_id, reason, created_at
      ) VALUES (
        'grant-terminal-before-link-recovery', 'store-one', 'grant-1', 'revoked',
        'policy-engine', 'grant closed before lineage recovery', ?
      )
    `).run(NOW);

    harness.service.recoverStartup();
    await Promise.resolve();

    const matchingLinks = () => harness.missionRepository
      .getMissionLineage(harness.context, 'mission-1').links
      .filter((link) => (
        link.linkType === 'execution'
        && link.targetId === created.batch.id
        && link.relation === 'authorized_execution_batch'
      ));
    expect(matchingLinks()).toHaveLength(1);
    expect(harness.page.clickCount).toBe(0);
    expect(harness.executionRepository.getExecutionBatch(harness.context, created.batch.id)?.batch.status)
      .toBe('queued');
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'attention_required',
      code: 'GRANT_TERMINAL',
      batchId: created.batch.id,
    });

    harness.service.reconcileActiveStore(harness.context);
    expect(matchingLinks()).toHaveLength(1);
    expect(harness.page.clickCount).toBe(0);
  });

it('resumes a partially succeeded policy batch and runs only its untouched action', async () => {
    const harness = createHarness(2, {
      policyGrant: true,
      createBatch: false,
    });
    const created = harness.executionRepository.createExactExecutionBatch(
      harness.context,
      'grant-1',
    ).projection;
    driveFirstJobToSuccess(harness, created.batch.id);
    expect(harness.executionRepository.getExecutionBatch(harness.context, created.batch.id)?.jobs
      .map((job) => job.status)).toEqual(['succeeded', 'queued']);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toBeUndefined();
    harness.page.allowAfterScreenshot();

    harness.service.recoverStartup();
    await vi.waitFor(() => {
      expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]?.status)
        .toBe('completed');
    });

    const completed = harness.executionRepository.getExecutionBatch(
      harness.context,
      created.batch.id,
    )!;
    expect(completed.batch.status).toBe('succeeded');
    expect(completed.jobs.map((job) => job.status)).toEqual(['succeeded', 'succeeded']);
    expect(harness.page.clickCount).toBe(1);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toEqual(expect.objectContaining({ eventType: 'consumed' }));
  });

it('surfaces a terminal pre-batch policy grant as attention-required without identity work', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      registerIdentity: false,
    });
    harness.database.prepare(`
      INSERT INTO mission_grant_events (
        id, store_id, grant_id, event_type, actor_id, reason, created_at
      ) VALUES (
        'grant-revoked-before-dispatch', 'store-one', 'grant-1', 'revoked',
        'policy-engine', 'authority changed before dispatch', ?
      )
    `).run(NOW);
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'attention_required',
      code: 'GRANT_TERMINAL',
      batchJobCount: 0,
    });
    expect(harness.executionRepository.listCanonicalKeywordIdentities(harness.context)).toEqual([]);
    expect(harness.page.clickCount).toBe(0);
  });

it('never restarts an existing UNKNOWN policy batch during startup or session recovery', async () => {
    const harness = createHarness(1, { policyGrant: true });
    harness.page.clickError = new Error('browser disconnected during save');
    const unknown = await harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    expect(unknown.batch.status).toBe('unknown');
    expect(harness.page.clickCount).toBe(1);

    harness.page.clickError = undefined;
    harness.service.recoverStartup();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      batchId: harness.batchId,
      batchStatus: 'unknown',
      code: 'EXECUTION_STATE_REQUIRES_RECONCILIATION',
    });
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-1'
    `).get()).toEqual({ count: 1 });
  });
});
