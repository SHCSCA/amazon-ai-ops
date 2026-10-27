import { describe, expect, it, vi } from 'vitest';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { assertStoreCollectionAutomationProjection, readStoreCollectionAutomationApi } from './store-collection-automation-model';

const context = { storeId: 'store-a', browserProfileId: 'profile-a', marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-21', sessionGeneration: 1 } as StoreContextEnvelope;
const legacy = { storeId: context.storeId, browserProfileId: context.browserProfileId, automaticCollectionEnabled: true,
  source: 'legacy-default', revision: 0, updatedAt: null };
const explicit = { ...legacy, source: 'explicit-override', automaticCollectionEnabled: false, revision: 1, updatedAt: '2026-10-22T06:00:00.000Z' };

describe('store collection automation renderer projection', () => {
  it('requires both closed preload methods before exposing the control', () => {
    const complete = { getStoreCollectionAutomation: vi.fn(), setStoreCollectionAutomation: vi.fn() };
    expect(readStoreCollectionAutomationApi({ electronAPI: complete })).toBe(complete);
    expect(readStoreCollectionAutomationApi({ electronAPI: { getStoreCollectionAutomation: vi.fn() } })).toBeNull();
    expect(readStoreCollectionAutomationApi({})).toBeNull();
  });
  it('accepts only the formal legacy true projection and explicit persisted false projection', () => {
    expect(() => assertStoreCollectionAutomationProjection(legacy, context)).not.toThrow();
    expect(() => assertStoreCollectionAutomationProjection(explicit, context)).not.toThrow();
  });
  it.each([
    ['other store', { ...explicit, storeId: 'store-b' }], ['other profile', { ...explicit, browserProfileId: 'profile-b' }],
    ['invented legacy false', { ...legacy, automaticCollectionEnabled: false }],
    ['invented legacy revision', { ...legacy, revision: 1 }], ['invented legacy timestamp', { ...legacy, updatedAt: explicit.updatedAt }],
    ['missing revision', { ...explicit, revision: undefined }], ['zero explicit revision', { ...explicit, revision: 0 }],
    ['unsafe explicit revision', { ...explicit, revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['noncanonical UTC', { ...explicit, updatedAt: '2026-10-22T14:00:00+08:00' }],
    ['bad timestamp', { ...explicit, updatedAt: 'not-a-time' }], ['extra authority', { ...explicit, approved: true }],
  ])('fails closed for %s without interpreting it as an enabled default', (_name, value) => {
    expect(() => assertStoreCollectionAutomationProjection(value, context)).toThrow();
  });
});
