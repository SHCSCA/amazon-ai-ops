import { describe, expect, it } from 'vitest';
import type {
  BrowserProfileId,
  BusinessDate,
  StoreContextEnvelope,
  StoreId,
  StoreRecord,
} from '@amazon-ai-ops/shared-types';
import {
  StoreRuntimeConfigError,
  StoreRuntimeConfigService,
  storeRuntimeConfigSettingKey,
} from './store-runtime-config-service';

const VALUES = {
  aiRecommendationsEnabled: true,
  collectionScheduleLocalTime: '08:00',
  collectionLookbackDays: 14,
  analysisWindowDays: 30,
  defaultTargetAcosPercent: 28,
  minimumRecommendationConfidencePercent: 72,
  evidenceRetentionDays: 365,
} as const;

function identity(value: string): StoreId {
  return value as StoreId;
}

function store(value: string): StoreRecord {
  return {
    storeId: identity(value),
    browserProfileId: `profile-${value}` as BrowserProfileId,
    displayName: value.toUpperCase(),
    marketplace: 'US',
    currency: 'USD',
    status: 'active',
    businessTimezone: 'America/Los_Angeles',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

function context(record: StoreRecord): StoreContextEnvelope {
  return {
    storeId: record.storeId,
    browserProfileId: record.browserProfileId,
    marketplace: 'US',
    currency: 'USD',
    businessTimezone: record.businessTimezone,
    businessDate: '2026-07-22' as BusinessDate,
    sessionGeneration: 1,
  };
}

function harness() {
  const records = new Map([['store-a', store('store-a')], ['store-b', store('store-b')]]);
  const values = new Map<string, string>();
  let tick = 0;
  const service = new StoreRuntimeConfigService({
    storeCoordinator: {
      assertActiveStoreContext: (input: unknown) => input as StoreContextEnvelope,
      getStore: (storeId) => {
        const record = records.get(String(storeId));
        if (!record) throw new Error('missing store');
        return record;
      },
    },
    settings: {
      get: (key) => values.get(key) ?? null,
      set: (key, value) => values.set(key, value),
      transaction: (work) => work(),
    },
    now: () => `2026-07-22T00:00:0${++tick}.000Z`,
  });
  return { records, service, values };
}

describe('StoreRuntimeConfigService', () => {
  it('persists independent store configurations with revision history and recoverable archive', () => {
    const { records, service } = harness();
    const contextA = context(records.get('store-a')!);
    const contextB = context(records.get('store-b')!);

    const createdA = service.create(contextA, { values: { ...VALUES } });
    const createdB = service.create(contextB, {
      values: { ...VALUES, collectionScheduleLocalTime: '09:30', defaultTargetAcosPercent: 35 },
    });
    expect(createdA.current).toMatchObject({ storeId: 'store-a', revision: 1, status: 'active' });
    expect(createdB.current).toMatchObject({ storeId: 'store-b', revision: 1, status: 'active' });
    expect(service.get(contextA).current?.values.collectionScheduleLocalTime).toBe('08:00');
    expect(service.get(contextB).current?.values.collectionScheduleLocalTime).toBe('09:30');

    const updated = service.update(contextA, {
      expectedRevision: 1,
      patch: { defaultTargetAcosPercent: 31.5 },
    });
    expect(updated.current).toMatchObject({ revision: 2, values: { defaultTargetAcosPercent: 31.5 } });
    expect(updated.versions.map((version) => version.action)).toEqual(['create', 'update']);

    const archived = service.archive(contextA, { expectedRevision: 2, reason: 'operator test' });
    expect(archived.current).toMatchObject({ revision: 3, status: 'archived' });
    expect(() => service.update(contextA, {
      expectedRevision: 3,
      patch: { analysisWindowDays: 45 },
    })).toThrowError(StoreRuntimeConfigError);

    const restored = service.restore(contextA, { expectedRevision: 3 });
    expect(restored.current).toMatchObject({ revision: 4, status: 'active' });
    expect(restored.current).not.toHaveProperty('archivedAt');
    expect(restored.versions.map((version) => version.action)).toEqual(['create', 'update', 'archive', 'restore']);
  });

  it('fails closed on stale revisions, unknown fields and corrupt cross-store storage', () => {
    const { records, service, values } = harness();
    const contextA = context(records.get('store-a')!);
    service.create(contextA, { values: { ...VALUES } });

    expect(() => service.update(contextA, {
      expectedRevision: 99,
      patch: { analysisWindowDays: 45 },
    })).toThrowError(/版本已变化/);
    expect(() => service.update(contextA, {
      expectedRevision: 1,
      patch: { analysisWindowDays: 45, unsafeBidCap: 100 } as never,
    })).toThrowError(/不支持字段/);

    const key = storeRuntimeConfigSettingKey(records.get('store-a')!.storeId);
    const envelope = JSON.parse(values.get(key)!);
    envelope.current.storeId = 'store-b';
    values.set(key, JSON.stringify(envelope));
    expect(() => service.get(contextA)).toThrowError(/身份与当前数据域不一致/);
  });

  it('rejects invalid operational ranges without accepting execution safety controls', () => {
    const { records, service } = harness();
    const contextA = context(records.get('store-a')!);
    expect(() => service.create(contextA, {
      values: { ...VALUES, collectionScheduleLocalTime: '25:00' },
    })).toThrowError(/HH:mm/);
    expect(() => service.create(contextA, {
      values: { ...VALUES, minimumRecommendationConfidencePercent: 20 },
    })).toThrowError(/50–99/);
    expect(() => service.create(contextA, {
      values: { ...VALUES, maxBidChangePercent: 100 } as never,
    })).toThrowError(/不支持字段/);
  });
});
