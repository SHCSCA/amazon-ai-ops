import { describe, expect, it, vi } from 'vitest';
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
  const assertActiveStoreContext = vi.fn((input: unknown) => input as StoreContextEnvelope);
  const getStore = vi.fn((storeId: StoreId) => {
    const record = records.get(String(storeId));
    if (!record) throw new Error('missing store');
    return record;
  });
  const settingsSet = vi.fn((key: string, value: string) => values.set(key, value));
  const service = new StoreRuntimeConfigService({
    storeCoordinator: {
      assertActiveStoreContext,
      getStore,
    },
    settings: {
      get: (key) => values.get(key) ?? null,
      set: settingsSet,
      transaction: (work) => work(),
    },
    now: () => `2026-07-22T00:00:0${++tick}.000Z`,
  });
  return {
    assertActiveStoreContext,
    getStore,
    records,
    service,
    settingsSet,
    values,
  };
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

  it('fails closed instead of projecting a cross-store version snapshot', () => {
    const { records, service, values } = harness();
    const storeA = records.get('store-a')!;
    service.create(context(storeA), { values: { ...VALUES } });
    const key = storeRuntimeConfigSettingKey(storeA.storeId);
    const envelope = JSON.parse(values.get(key)!);
    envelope.versions[0].snapshot.storeId = 'store-b';
    values.set(key, JSON.stringify(envelope));

    expect(() => service.get(context(storeA))).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_STORAGE' }),
    );
  });

  it.each([
    {
      name: 'duplicate revision',
      mutate: (envelope: any) => {
        envelope.versions[1].revision = 1;
        envelope.versions[1].snapshot.revision = 1;
      },
    },
    {
      name: 'unsupported action',
      mutate: (envelope: any) => {
        envelope.versions[1].action = 'publish';
      },
    },
    {
      name: 'invalid occurrence time',
      mutate: (envelope: any) => {
        envelope.versions[1].occurredAt = 'not-a-time';
        envelope.versions[1].snapshot.updatedAt = 'not-a-time';
      },
    },
    {
      name: 'invalid snapshot status',
      mutate: (envelope: any) => {
        envelope.versions[1].snapshot.status = 'paused';
      },
    },
    {
      name: 'invalid snapshot values',
      mutate: (envelope: any) => {
        envelope.versions[1].snapshot.values.evidenceRetentionDays = 0;
      },
    },
    {
      name: 'wrong snapshot marketplace',
      mutate: (envelope: any) => {
        envelope.versions[1].snapshot.marketplace = 'CA';
      },
    },
    {
      name: 'wrong snapshot currency',
      mutate: (envelope: any) => {
        envelope.versions[1].snapshot.currency = 'CAD';
      },
    },
    {
      name: 'wrong snapshot timezone',
      mutate: (envelope: any) => {
        envelope.versions[1].snapshot.businessTimezone = 'UTC';
      },
    },
    {
      name: 'wrong snapshot config id',
      mutate: (envelope: any) => {
        envelope.versions[1].snapshot.configId = 'store-config-store-b';
      },
    },
    {
      name: 'reason on non-archive action',
      mutate: (envelope: any) => {
        envelope.versions[1].reason = 'not allowed';
      },
    },
    {
      name: 'unknown version field',
      mutate: (envelope: any) => {
        envelope.versions[1].unsafeExecutionMode = true;
      },
    },
  ])('fails closed on malformed version history: $name', ({ mutate }) => {
    const { records, service, values } = harness();
    const storeA = records.get('store-a')!;
    const contextA = context(storeA);
    service.create(contextA, { values: { ...VALUES } });
    service.update(contextA, {
      expectedRevision: 1,
      patch: { analysisWindowDays: 45 },
    });
    const key = storeRuntimeConfigSettingKey(storeA.storeId);
    const envelope = JSON.parse(values.get(key)!);
    mutate(envelope);
    values.set(key, JSON.stringify(envelope));

    expect(() => service.get(contextA)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_STORAGE' }),
    );
  });

  it.each([
    {
      name: 'current values differ from the latest snapshot',
      mutate: (envelope: any) => {
        envelope.current.values.analysisWindowDays = 60;
      },
    },
    {
      name: 'latest version is missing',
      mutate: (envelope: any) => {
        envelope.versions.pop();
      },
    },
    {
      name: 'restore follows an active snapshot',
      mutate: (envelope: any) => {
        envelope.versions[1].action = 'restore';
      },
    },
    {
      name: 'version snapshot revision differs from its version',
      mutate: (envelope: any) => {
        envelope.versions[1].snapshot.revision = 3;
      },
    },
  ])('fails closed when current and versions are inconsistent: $name', ({ mutate }) => {
    const { records, service, values } = harness();
    const storeA = records.get('store-a')!;
    const contextA = context(storeA);
    service.create(contextA, { values: { ...VALUES } });
    service.update(contextA, {
      expectedRevision: 1,
      patch: { analysisWindowDays: 45 },
    });
    const key = storeRuntimeConfigSettingKey(storeA.storeId);
    const envelope = JSON.parse(values.get(key)!);
    mutate(envelope);
    values.set(key, JSON.stringify(envelope));

    expect(() => service.get(contextA)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_STORAGE' }),
    );
  });

  it('fails closed when restore rewrites values even if current mirrors the forged snapshot', () => {
    const { records, service, values } = harness();
    const storeA = records.get('store-a')!;
    const contextA = context(storeA);
    service.create(contextA, { values: { ...VALUES } });
    service.archive(contextA, { expectedRevision: 1 });
    service.restore(contextA, { expectedRevision: 2 });
    const key = storeRuntimeConfigSettingKey(storeA.storeId);
    const envelope = JSON.parse(values.get(key)!);
    envelope.versions[2].snapshot.values.analysisWindowDays = 60;
    envelope.current.values.analysisWindowDays = 60;
    values.set(key, JSON.stringify(envelope));

    expect(() => service.get(contextA)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_STORAGE' }),
    );
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

  it('reads independent inactive store configs by Main StoreRecord or id without active-context or write side effects', () => {
    const {
      assertActiveStoreContext,
      records,
      service,
      settingsSet,
    } = harness();
    const storeA = records.get('store-a')!;
    const storeB = records.get('store-b')!;
    service.create(context(storeA), { values: { ...VALUES, collectionLookbackDays: 7 } });
    service.create(context(storeB), { values: { ...VALUES, collectionLookbackDays: 30 } });
    records.set('store-b', { ...storeB, status: 'inactive' });
    assertActiveStoreContext.mockClear();
    settingsSet.mockClear();

    expect(service.getForStoreRecord(storeA).current).toMatchObject({
      storeId: storeA.storeId,
      values: { collectionLookbackDays: 7 },
    });
    expect(service.getForStoreRecord(records.get('store-b')!).current).toMatchObject({
      storeId: storeB.storeId,
      values: { collectionLookbackDays: 30 },
    });
    expect(service.getForStoreId(storeB.storeId).current).toMatchObject({
      storeId: storeB.storeId,
      values: { collectionLookbackDays: 30 },
    });
    expect(assertActiveStoreContext).not.toHaveBeenCalled();
    expect(settingsSet).not.toHaveBeenCalled();
    expect(JSON.stringify(service.getForStoreRecord(storeA)))
      .not.toMatch(/password|cookie|credential|profilePath/i);
  });

  it('rejects forged Profile and non-LA StoreRecord authority for Main reads', () => {
    const { records, service } = harness();
    const storeA = records.get('store-a')!;
    expect(() => service.getForStoreRecord({
      ...storeA,
      browserProfileId: 'profile-forged' as BrowserProfileId,
    })).toThrowError(/exact US\/USD/);
    expect(() => service.getForStoreRecord({
      ...storeA,
      businessTimezone: 'UTC',
    })).toThrowError(/America\/Los_Angeles/);
  });
});
