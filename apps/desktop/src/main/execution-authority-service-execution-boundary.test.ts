import  {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { NOW, createHarness } from './execution-authority-service.test-harness';
describe("ExecutionAuthorityService safety orchestration", () => {
it('cancels before submit intent without clicking save', () => {
    const harness = createHarness();

    const projection = harness.service.cancelBatch({
      context: harness.context,
      batchId: harness.batchId,
      reason: 'operator stopped before execution',
    });

    expect(projection.batch.status).toBe('cancelled');
    expect(projection.jobs).toEqual([expect.objectContaining({ status: 'cancelled', submitIntentId: undefined })]);
    expect(harness.page.clickCount).toBe(0);
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'cancelled', evidenceRefCount: 0 });
  });

it('terminalizes the batch UNKNOWN when Ads liveness drops after the single save click', async () => {
    const harness = createHarness(2);
    const running = harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });

    await harness.page.afterScreenshotStarted;
    harness.database.transaction(() => {
      harness.database.prepare(`
        UPDATE store_connections
        SET status = 'attention_required', last_failure_code = 'VISIBLE_BROWSER_CLOSED', updated_at = ?
        WHERE store_id = 'store-one' AND provider = 'amazon_ads'
      `).run(NOW);
      harness.database.prepare(`
        UPDATE store_session_metadata
        SET status = 'blocked', failure_code = 'VISIBLE_BROWSER_CLOSED', updated_at = ?
        WHERE store_id = 'store-one' AND provider = 'amazon_ads'
      `).run(NOW);
    })();
    harness.page.allowAfterScreenshot();

    const projection = await running;
    expect(projection.batch.status).toBe('unknown');
    expect(projection.jobs.map((job) => job.status)).toEqual(['unknown', 'cancelled']);
    expect(projection.jobs[0]?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: 'unknown',
        reasonCode: 'ADS_AUTHORITY_LOST_AFTER_INTENT',
        detail: 'Ads 会话在保存后失去可信状态，提交结果必须人工核对。',
      }),
    ]));
    expect(harness.page.clickCount).toBe(1);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toEqual(expect.objectContaining({ eventType: 'invalidated' }));
    expect(harness.missionRepository.getMission(harness.context, 'mission-1'))
      .toEqual(expect.objectContaining({ status: 'blocked', phase: 'action' }));
    const changesBeforeHistory = harness.database.prepare('SELECT total_changes() AS total').get();
    expect(harness.service.listBatches(harness.context)).toEqual([projection]);
    expect(harness.database.prepare('SELECT total_changes() AS total').get()).toEqual(changesBeforeHistory);
    expect(harness.page.clickCount).toBe(1);
  });

it.each([
    ['target_stably_observed', 'target', false],
    ['original_stably_observed', 'original', false],
    ['other_value_stably_observed', 'other', false],
    ['inconclusive_permanent', 'original', true],
  ] as const)('persists %s once without restoring the invalidated Grant', async (outcome, value, drift) => {
    const h = createHarness();
    h.page.clickError = new Error('disconnected after submit intent');
    const unknown = await h.service.startBatch({ context: h.context, batchId: h.batchId });
    const job = unknown.jobs[0];
    const before = h.database.prepare("SELECT * FROM mission_grant_events WHERE grant_id='grant-1' ORDER BY id").all();
    h.page.allowAfterScreenshot();
    const bid = value === 'target' ? job.targetBidCents : value === 'original' ? job.expectedBidCents : 170;
    vi.spyOn(h.page, 'selectCampaign').mockImplementation(() => { h.page.bidValue = (bid / 100).toFixed(2); });
    const reload = vi.spyOn(h.page, 'reload').mockImplementation(async () => { if (drift) h.page.bidValue = '1.71'; });
    
    h.database.prepare("UPDATE policy_runtime SET kill_switch=1 WHERE store_id='store-one'").run();
    const result = await h.service.reconcileUnknownBatch({ context: h.context, batchId: h.batchId });
    expect(result.status).toBe(outcome);
    expect(reload).toHaveBeenCalledOnce();
    expect(await h.service.reconcileUnknownBatch({ context: h.context, batchId: h.batchId })).toEqual(result);
    expect(reload).toHaveBeenCalledOnce();
    expect(h.page.clickCount).toBe(1);
    expect(h.database.prepare("SELECT * FROM mission_grant_events WHERE grant_id='grant-1' ORDER BY id").all()).toEqual(before);
    const projection = h.executionRepository.getExecutionBatch(h.context, h.batchId)!;
    expect(projection.batch).toEqual(unknown.batch);
    expect(projection.jobs).toEqual(unknown.jobs);
    expect(projection.reconciliation).toMatchObject({ outcome, context: h.context, first: { observedBidCents: bid }, reload: { observedBidCents: drift ? 171 : bid } });
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM ad_execution_reconciliation_cases').get()).toEqual({ count: 1 });
    expect(() => h.database.prepare("UPDATE ad_execution_reconciliation_cases SET outcome='target_stably_observed'").run()).toThrow(/immutable/);
    expect(() => h.database.prepare('DELETE FROM ad_execution_reconciliation_cases').run()).toThrow(/cannot be deleted/);
  });

it('revalidates the kill switch after the final save control is resolved and before click', async () => {
    const harness = createHarness();
    harness.page.pauseBeforePermit = true;
    const running = harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    await harness.page.prepareSaveReady;
    harness.database.prepare(`
      UPDATE policy_runtime SET kill_switch = 1, revision = revision + 1, updated_at = ?
      WHERE store_id = 'store-one'
    `).run(NOW);
    harness.page.allowPermitCheck();

    const projection = await running;

    expect(harness.page.clickCount).toBe(0);
    expect(projection.batch.status).toBe('blocked');
    expect(projection.jobs[0]).toMatchObject({
      status: 'blocked',
      submitIntentId: undefined,
    });
  });

it('serializes a two-action batch and stops the untouched sibling after the first UNKNOWN', async () => {
    const harness = createHarness(2);
    harness.page.clickError = new Error('first save result became ambiguous');

    const projection = await harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });

    expect(harness.page.clickCount).toBe(1);
    expect(projection.batch.status).toBe('unknown');
    expect(projection.jobs.map((job) => job.status)).toEqual(['unknown', 'cancelled']);
    expect(projection.jobs[0]).toEqual(expect.objectContaining({
      submitIntentId: expect.any(String),
    }));
    expect(projection.jobs[1]).toEqual(expect.objectContaining({ submitIntentId: undefined }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-1'))
      .toEqual(expect.objectContaining({ status: 'approved' }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-2'))
      .toEqual(expect.objectContaining({ status: 'approved' }));
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'unknown', evidenceRefCount: 1 });
  });

it('consumes submitted authority before readback and records execution success independently', async () => {
    const harness = createHarness();
    const running = harness.service.startBatch({ context: harness.context, batchId: harness.batchId });
    await harness.page.afterScreenshotStarted;

    expect(harness.page.clickCount).toBe(1);
    expect(harness.missionRepository.getMissionGrant(harness.context, 'grant-1')?.usage)
      .toMatchObject({ status: 'consumed', spentSlots: 1, residualSlots: 0 });
    expect(harness.executionRepository.getExecutionBatch(harness.context, harness.batchId)?.jobs[0].status).toBe('submitted');

    harness.page.allowAfterScreenshot();
    const projection = await running;
    expect(projection.batch.status).toBe('succeeded');
    expect(projection.jobs).toEqual([expect.objectContaining({ status: 'succeeded' })]);
    expect(projection.jobs[0].evidence.map((evidence) => evidence.slot)).toEqual(['before', 'after', 'reload']);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toEqual(expect.objectContaining({ eventType: 'consumed' }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-1'))
      .toEqual(expect.objectContaining({ status: 'verified' }));
    expect(harness.database.prepare(`
      SELECT COUNT(*) AS count FROM evidence_refs
      WHERE store_id = 'store-one' AND event_id = 'causal:grant:grant-1:consumed'
    `).get()).toEqual({ count: 3 });
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(harness.batchId)).toEqual({ batchStatus: 'succeeded', evidenceRefCount: 3 });
  });

it('keeps identity resolution and verified execution complete when UI progress notification throws', async () => {
    let failNotifications = false;
    const attemptedPhases: string[] = [];
    const harness = createHarness(1, {
      registerIdentity: false,
      createBatch: false,
      emitProgress: (event) => {
        attemptedPhases.push(event.phase);
        if (failNotifications) throw new Error('renderer progress channel unavailable');
      },
    });
    failNotifications = true;

    await expect(harness.service.resolveIdentity({
      context: harness.context,
      grantId: 'grant-1',
      adEntityId: 'opaque-keyword-1',
    })).resolves.toMatchObject({ adEntityId: 'opaque-keyword-1' });
    expect(harness.leases.current(harness.context.storeId)).toBeUndefined();

    const created = harness.service.createBatch({
      context: harness.context,
      grantId: 'grant-1',
    });
    harness.page.allowAfterScreenshot();
    const projection = await harness.service.startBatch({
      context: harness.context,
      batchId: created.projection.batch.id,
    });

    expect(attemptedPhases).toEqual(expect.arrayContaining(['identity', 'readback', 'terminal']));
    expect(projection.batch.status).toBe('succeeded');
    expect(projection.jobs).toEqual([expect.objectContaining({
      status: 'succeeded',
      evidence: expect.arrayContaining([
        expect.objectContaining({ slot: 'before' }),
        expect.objectContaining({ slot: 'after' }),
        expect.objectContaining({ slot: 'reload' }),
      ]),
    })]);
    expect(harness.missionRepository.getMissionGrantTerminalEvent(harness.context, 'grant-1'))
      .toEqual(expect.objectContaining({ eventType: 'consumed' }));
    expect(harness.missionRepository.getDecision(harness.context, 'decision-1'))
      .toEqual(expect.objectContaining({ status: 'verified' }));
    expect(harness.missionRepository.getMission(harness.context, 'mission-1'))
      .toEqual(expect.objectContaining({ status: 'active', phase: 'readback' }));
    expect(harness.database.prepare(`
      SELECT batch_status AS batchStatus, evidence_ref_count AS evidenceRefCount
      FROM ad_execution_domain_reconciliations
      WHERE store_id = 'store-one' AND batch_id = ?
    `).get(created.projection.batch.id)).toEqual({ batchStatus: 'succeeded', evidenceRefCount: 3 });
    expect(harness.leases.current(harness.context.storeId)).toBeUndefined();
  });
});
