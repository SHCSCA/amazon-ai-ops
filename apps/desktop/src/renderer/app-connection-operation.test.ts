import { describe, expect, it } from 'vitest';
import { createConnectionOperationGuard } from './app-connection-operation';

describe('connection operation completion authority', () => {
  const storeA = { authorityKey: 'store-a|profile-a|1', contextEpoch: 1, phase: 'ready' };

  it('retains a result only while the same authority and lifecycle remain current', () => {
    const guard = createConnectionOperationGuard();
    guard.update(storeA);
    const result = guard.capture();
    guard.update({ ...storeA });
    expect(result()).toBe(true);
    guard.invalidate();
    expect(result()).toBe(false);
    expect(guard.capture()()).toBe(true);
  });

  it('rejects old completion across A to B to A even if the final key is the same', () => {
    const guard = createConnectionOperationGuard();
    guard.update(storeA);
    const result = guard.capture();
    guard.update({ ...storeA, authorityKey: 'store-b|profile-b|1' });
    guard.update(storeA);
    expect(result()).toBe(false);
  });

  it('admits only one synchronous action and releases only its own ticket', () => {
    const guard = createConnectionOperationGuard();
    guard.update(storeA);
    const first = guard.begin()!;
    expect(first.isCurrent()).toBe(true);
    expect(guard.isBusy()).toBe(true);
    expect(guard.begin()).toBeNull();
    first.finish();
    const next = guard.begin()!;
    first.finish();
    expect(next.isCurrent()).toBe(true);
    expect(guard.begin()).toBeNull();
    next.finish();
    expect(guard.isBusy()).toBe(false);
  });

  it('retires an old action across A to B to A without letting old finally unlock the new action', () => {
    const guard = createConnectionOperationGuard();
    guard.update(storeA);
    const old = guard.begin()!;
    guard.update({ ...storeA, authorityKey: 'store-b|profile-b|1', contextEpoch: 2 });
    guard.update({ ...storeA, contextEpoch: 3 });
    const current = guard.begin()!;
    old.finish();
    expect(old.isCurrent()).toBe(false);
    expect(current.isCurrent()).toBe(true);
    expect(guard.begin()).toBeNull();
    guard.invalidate();
    expect(current.isCurrent()).toBe(false);
    expect(guard.isBusy()).toBe(false);
  });

  it('rejects action admission without ready current store authority', () => {
    const guard = createConnectionOperationGuard();
    expect(guard.begin()).toBeNull();
    guard.update({ ...storeA, phase: 'switching' });
    expect(guard.begin()).toBeNull();
    guard.update({ ...storeA, authorityKey: null });
    expect(guard.begin()).toBeNull();
  });

  it.each([
    { ...storeA, phase: 'switching' },
    { ...storeA, contextEpoch: 2 },
    { ...storeA, authorityKey: null },
  ])('rejects completion after an authority transition: %j', next => {
    const guard = createConnectionOperationGuard();
    guard.update(storeA);
    const result = guard.capture();
    guard.update(next);
    expect(result()).toBe(false);
  });
});
