import  {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ExecutionAuthorityService } from './execution-authority-service';
import { seedSecondSameStorePolicyGrant, registerSecondIdentity } from './execution-authority-service.test-authority';
import { createHarness, FakePolicyDispatchTimer } from './execution-authority-service.test-harness';
describe("ExecutionAuthorityService safety orchestration", () => {
it('marks a thrown save result UNKNOWN after durable intent and never retries the click', async () => {
    const harness = createHarness();
    harness.page.clickError = new Error('browser disconnected during save');

    const projection = await harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });

    expect(projection.batch.status).toBe('unknown');
    expect(projection.jobs).toEqual([expect.objectContaining({
      status: 'unknown',
      submitIntentId: expect.any(String),
      events: expect.arrayContaining([
        expect.objectContaining({ eventType: 'unknown', reasonCode: 'SUBMIT_OUTCOME_UNKNOWN' }),
      ]),
    })]);
    expect(harness.page.clickCount).toBe(1);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toEqual(expect.objectContaining({ eventType: 'invalidated' }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-1'))
      .toEqual(expect.objectContaining({ status: 'approved' }));
    expect(harness.database.prepare(`
      SELECT evidence_type AS evidenceType, evidence_ref AS evidenceRef
      FROM evidence_refs
      WHERE store_id = 'store-one' AND event_id = 'causal:grant:grant-1:invalidated'
    `).all()).toEqual([
      { evidenceType: 'ad_execution_before', evidenceRef: expect.any(String) },
    ]);
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'unknown', evidenceRefCount: 1 });
  });

it('keeps startup alive when one recovered domain projection fails and retries it later', () => {
    const harness = createHarness();
    const job = harness.executionRepository.getExecutionBatch(harness.context, harness.batchId)!.jobs[0]!;
    harness.executionRepository.markBlocked(harness.context, {
      jobId: job.id,
      expectedRevision: job.revision,
      reasonCode: 'test_recovery_block',
      detail: 'Test recovery projection isolation',
    });
    const completion = vi.spyOn(harness.executionRepository, 'completeDomainReconciliation')
      .mockImplementationOnce(() => { throw new Error('injected domain projection failure'); });

    let recovery: ReturnType<ExecutionAuthorityService['recoverStartup']> | undefined;
    expect(() => { recovery = harness.service.recoverStartup(); }).not.toThrow();
    expect(recovery?.domainReconciliations).toEqual([
      expect.objectContaining({ batchId: harness.batchId, status: 'blocked' }),
    ]);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ count: 0 });

    completion.mockRestore();
    expect(() => harness.service.reconcileActiveStore(harness.context)).not.toThrow();
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'blocked' });
  });

it('retries a start failure only while the existing policy batch is still pre-intent', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
    });
    harness.setBringToFrontError(new Error(
      'browser unavailable Bearer secret-token cookie=session@example.test profile_id=private-profile',
    ));
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    const waiting = harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]!;
    expect(waiting).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      code: 'EXECUTION_RETRY_SCHEDULED',
      batchStatus: 'queued',
      batchJobStatuses: ['queued'],
      batchHasPersistedIntent: false,
    });
    expect(waiting.nextRetryAt).toBe('2026-07-23T02:00:01.000Z');
    expect(timer.activeCount()).toBe(1);
    const persistedSignals = harness.database.prepare(`
      SELECT signal FROM causal_events
      WHERE store_id = 'store-one'
        AND entity_type = 'policy_grant_dispatch_v1'
        AND entity_id = 'grant-1'
    `).all() as Array<{ signal: string }>;
    expect(persistedSignals.every(({ signal }) => (
      !signal.includes('secret-token')
      && !signal.includes('session@example.test')
      && !signal.includes('private-profile')
    ))).toBe(true);

    harness.setBringToFrontError(undefined);
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');

    expect(harness.page.clickCount).toBe(1);
    expect(timer.activeCount()).toBe(0);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      code: 'EXECUTION_TERMINAL',
      batchStatus: 'succeeded',
    });
  });

it('waits and retries when adapter preflight loses the visible browser before intent', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
    });
    harness.page.inputValueError = new Error('browser disconnected during preflight');
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);

    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      code: 'EXECUTION_RETRY_SCHEDULED',
      batchStatus: 'preflight',
      batchJobStatuses: ['preflight'],
      batchHasPersistedIntent: false,
    });
    expect(harness.page.clickCount).toBe(0);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toBeUndefined();

    harness.page.inputValueError = undefined;
    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      batchStatus: 'succeeded',
    });
  });

it('waits when the final lease permit expires before intent and succeeds after reacquiring it', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      policyDispatchRetryMs: 1_000,
      policyDispatchTimer: timer.timer,
    });
    harness.page.pauseBeforePermit = true;
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    const dispatching = harness.service.enqueuePolicyGrant(harness.context, grant);
    await harness.page.prepareSaveReady;
    harness.setNow('2026-07-23T03:01:00.000Z');
    harness.page.allowPermitCheck();

    await dispatching;
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      code: 'EXECUTION_RETRY_SCHEDULED',
      batchStatus: 'preflight',
      batchJobStatuses: ['preflight'],
      batchHasPersistedIntent: false,
      nextRetryAt: '2026-07-23T03:01:01.000Z',
    });
    expect(harness.page.clickCount).toBe(0);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toBeUndefined();

    harness.page.allowAfterScreenshot();
    await harness.service.resumePolicyGrantDispatches(harness.context, 'session_ready');

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      batchStatus: 'succeeded',
    });
  });

it('serializes two policy grants for the same store through one durable lane', async () => {
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
    });
    seedSecondSameStorePolicyGrant(harness.database);
    registerSecondIdentity(harness);
    const firstGrant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;
    const secondGrant = harness.missionRepository.getMissionGrant(harness.context, 'grant-2')!;

    const first = harness.service.enqueuePolicyGrant(harness.context, firstGrant);
    await harness.page.afterScreenshotStarted;
    const second = harness.service.enqueuePolicyGrant(harness.context, secondGrant);
    await Promise.resolve();

    expect(harness.page.clickCount).toBe(1);
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM ad_execution_batches
      WHERE store_id = 'store-one' AND grant_id = 'grant-2'
    `).get()).toEqual({ count: 0 });

    harness.page.allowAfterScreenshot();
    await Promise.all([first, second]);

    expect(harness.page.clickCount).toBe(2);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          grantId: 'grant-1',
          status: 'completed',
          batchStatus: 'succeeded',
        }),
        expect.objectContaining({
          grantId: 'grant-2',
          status: 'completed',
          batchStatus: 'succeeded',
        }),
      ]));
  });

it('retries a closed policy window from its persisted timer without another user event', async () => {
    const timer = new FakePolicyDispatchTimer();
    const harness = createHarness(1, {
      policyGrant: true,
      createBatch: false,
      executionWindow: {
        timeZone: 'America/Los_Angeles',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        start: '00:00',
        end: '00:30',
      },
      policyDispatchRetryMs: 5 * 60 * 60 * 1_000,
      policyDispatchTimer: timer.timer,
    });
    const grant = harness.missionRepository.getMissionGrant(harness.context, 'grant-1')!;

    await harness.service.enqueuePolicyGrant(harness.context, grant);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'waiting_runtime',
      attemptCount: 1,
      nextRetryAt: '2026-07-23T07:00:00.000Z',
    });
    expect(timer.setCalls[timer.setCalls.length - 1]?.delayMs)
      .toBe(5 * 60 * 60 * 1_000);

    harness.setNow('2026-07-23T07:00:00.000Z');
    harness.page.allowAfterScreenshot();
    timer.runLatest();
    await vi.waitFor(() => {
      expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]?.status)
        .toBe('completed');
    });

    expect(harness.page.clickCount).toBe(1);
    expect(harness.executionRepository.listPolicyGrantDispatches(harness.context)[0]).toMatchObject({
      status: 'completed',
      attemptCount: 2,
      code: 'EXECUTION_TERMINAL',
    });
  });
});
