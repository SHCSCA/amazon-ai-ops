import { describe, expect, it } from 'vitest';
import { createCollectionOperationState } from './collection-operation';
import { storeContext } from './collection.test-fixtures';
import { normalizeStoreContextEnvelope } from '@amazon-ai-ops/shared-types';

describe('collection operation admission', () => {
  it('admits one operation synchronously before any render or awaited schedule result', () => {
    const state = createCollectionOperationState();
    state.bind(storeContext);
    const first = state.begin();
    expect(first).toBeDefined();
    expect(state.begin()).toBeUndefined();
    first!.finish();
    expect(state.begin()).toBeDefined();
  });

  it('rejects an old A to B to A result and prevents its completion from unlocking the current operation', () => {
    const state = createCollectionOperationState();
    const oldEpoch = state.bind(storeContext);
    const old = state.begin()!;
    state.bind({ ...storeContext, storeId: 'other-store', browserProfileId: 'other-profile' } as typeof storeContext);
    state.bind(storeContext);
    const current = state.begin()!;
    expect(state.isCurrent(oldEpoch)).toBe(false);
    expect(old.isCurrent()).toBe(false);
    old.finish();
    expect(current.isCurrent()).toBe(true);
    expect(state.begin()).toBeUndefined();
  });

  it('preserves a live collection operation across a forward generation in the same store lineage', () => {
    const state = createCollectionOperationState();
    const epoch = state.bind(storeContext);
    const current = state.begin()!;
    state.bind({ ...storeContext, sessionGeneration: storeContext.sessionGeneration + 1 });
    expect(state.isCurrent(epoch)).toBe(true);
    expect(current.isCurrent()).toBe(true);
    expect(state.begin()).toBeUndefined();
    current.finish();
    expect(state.begin()).toBeDefined();
  });

  it('invalidates a backward session or business-date transition and does not admit missing authority', () => {
    const state = createCollectionOperationState();
    expect(state.bind(null)).toBe(state.bind(null));
    expect(state.begin()).toBeUndefined();
    state.bind(storeContext);
    const old = state.begin()!;
    state.bind({ ...storeContext, sessionGeneration: storeContext.sessionGeneration - 1 });
    expect(old.isCurrent()).toBe(false);
    const next = state.begin()!;
    state.bind(normalizeStoreContextEnvelope({ ...storeContext, businessDate: '2026-07-23' }));
    expect(next.isCurrent()).toBe(false);
    state.dispose();
    expect(next.isCurrent()).toBe(false);
  });
});
