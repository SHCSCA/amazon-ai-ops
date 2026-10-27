import  {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ExecutionAuthorityRepository } from '@amazon-ai-ops/local-db';
import { createHarness } from './execution-authority-service.test-harness';
describe("ExecutionAuthorityService safety orchestration", () => {
it('reconciles an UNKNOWN batch with two read-only page observations without retrying save', async () => {
    const harness = createHarness();
    harness.page.clickError = new Error('browser disconnected during save');
    const unknown = await harness.service.startBatch({
      context: harness.context,
      batchId: harness.batchId,
    });
    expect(unknown.batch.status).toBe('unknown');
    expect(harness.page.clickCount).toBe(1);

    harness.page.clickError = undefined;
    harness.page.allowAfterScreenshot();
    const result = await harness.service.reconcileUnknownBatch({
      context: harness.context,
      batchId: harness.batchId,
    });

    expect(result).toMatchObject({
      status: 'original_stably_observed',
      batchId: harness.batchId,
      observedBidCents: 149,
      originalStatus: 'unknown',
    });
    expect(harness.page.clickCount).toBe(1);
    const screenshots = vi.spyOn(harness.page, 'screenshot');
    expect(await harness.service.reconcileUnknownBatch({ context: harness.context, batchId: harness.batchId })).toEqual(result);
    expect(screenshots).not.toHaveBeenCalled();
    expect(harness.executionRepository.getExecutionBatch(harness.context, harness.batchId))
      .toEqual(expect.objectContaining({ batch: expect.objectContaining({ status: 'unknown' }) }));
    expect(harness.missionRepository.listCausalEvents(harness.context, { missionId: 'mission-1' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: 'READBACK',
          eventType: 'execution_unknown_reconciled',
          entityId: harness.batchId,
          status: 'original_stably_observed',
        }),
      ]));
    expect(harness.database.prepare(`
      SELECT evidence_type AS evidenceType
      FROM evidence_refs
      WHERE store_id = 'store-one'
        AND event_id LIKE 'causal:execution-reconciliation:%'
      ORDER BY evidence_type
    `).all()).toEqual([
      { evidenceType: 'ad_execution_reconciliation_first' },
      { evidenceType: 'ad_execution_reconciliation_reload' },
    ]);
  });

it.each(['first-proof', 'reload', 'process-restart'] as const)('permanently closes an interrupted %s without an additional observation', async failure => {
    const h = createHarness();
    h.page.clickError = new Error('disconnected');
    const unknown = await h.service.startBatch({ context: h.context, batchId: h.batchId });
    h.page.allowAfterScreenshot();
    const screenshot = vi.spyOn(h.page, 'screenshot');
    const reload = vi.spyOn(h.page, 'reload');
    if (failure === 'process-restart') {
      h.executionRepository.beginUnknownReconciliation(h.context, unknown.jobs[0].id);
      
      new ExecutionAuthorityRepository(h.database).recoverInterruptedExecutions();
    } else if (failure === 'first-proof') {
      screenshot.mockRejectedValue(new Error('screenshot missing'));
    } else reload.mockRejectedValue(new Error('reload disconnected'));
    const result = await h.service.reconcileUnknownBatch({ context: h.context, batchId: h.batchId });
    expect(result.status).toBe('inconclusive_permanent');
    const screenshots = screenshot.mock.calls.length;
    const reloads = reload.mock.calls.length;
    expect(await h.service.reconcileUnknownBatch({ context: h.context, batchId: h.batchId })).toEqual(result);
    expect(screenshot).toHaveBeenCalledTimes(screenshots);
    expect(reload).toHaveBeenCalledTimes(reloads);
    expect(h.page.clickCount).toBe(1);
    const record = h.executionRepository.getExecutionBatch(h.context, h.batchId)!.reconciliation!;
    expect(record.reload).toBeNull();
    if (failure !== 'reload') expect(record.first).toBeNull();
    expect(h.missionRepository.listCausalEvents(h.context).filter(e => e.eventType === 'execution_unknown_reconciled')).toHaveLength(1);
  });
});
