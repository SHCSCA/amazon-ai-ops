import { describe, expect, it } from 'vitest';
import {
  notifyWorkflowInvalidated,
  runWorkflowInvalidatingMutation,
  subscribeWorkflowInvalidation,
} from './workflow-invalidation';

describe('workflow runtime invalidation', () => {
  it('delivers typed invalidation events to runtime subscribers and supports cleanup', () => {
    const target = new EventTarget();
    const observed: string[] = [];
    const unsubscribe = subscribeWorkflowInvalidation((detail) => observed.push(detail.source), target);

    notifyWorkflowInvalidated('approval-approved', target);
    unsubscribe();
    notifyWorkflowInvalidated('approval-rejected', target);

    expect(observed).toEqual(['approval-approved']);
  });

  it('invalidates only after a successful mutation resolves', async () => {
    const target = new EventTarget();
    const order: string[] = [];
    const unsubscribe = subscribeWorkflowInvalidation((detail) => order.push(`event:${detail.source}`), target);

    const result = await runWorkflowInvalidatingMutation('ad-quant-diagnosis', async () => {
      order.push('mutation');
      return 42;
    }, target);

    expect(result).toBe(42);
    expect(order).toEqual(['mutation', 'event:ad-quant-diagnosis']);
    unsubscribe();
  });

  it('does not invalidate after a failed mutation', async () => {
    const target = new EventTarget();
    const observed: string[] = [];
    const unsubscribe = subscribeWorkflowInvalidation((detail) => observed.push(detail.source), target);

    await expect(runWorkflowInvalidatingMutation('readback-verified', async () => {
      throw new Error('verify failed');
    }, target)).rejects.toThrow('verify failed');

    expect(observed).toEqual([]);
    unsubscribe();
  });

  it('does not invalidate the new workspace when an earlier mutation resolves late', async () => {
    const target = new EventTarget();
    const observed: string[] = [];
    const unsubscribe = subscribeWorkflowInvalidation(detail => observed.push(detail.source), target);
    let current = true;
    let resolve!: (value: number) => void;
    const result = runWorkflowInvalidatingMutation('approval-approved',
      () => new Promise<number>(done => { resolve = done; }), target, () => current);

    current = false;
    resolve(42);
    await expect(result).resolves.toBe(42);
    expect(observed).toEqual([]);
    unsubscribe();
  });
});
