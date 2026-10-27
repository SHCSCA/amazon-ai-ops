import { describe, expect, it, vi } from 'vitest';
import {
  readStoreCollectionAutomation, storeCollectionAutomationSettingKey, StoreCollectionAutomationError,
  type StoreContextEnvelope, type StoreId, type StoreRecord,
} from '@amazon-ai-ops/shared-types';
import { StoreCollectionAutomationService } from './store-collection-automation-service';
import { createHarness, databases } from '@amazon-ai-ops/local-db/src/sqlite/repositories/mission-domain-repo.test-harness';
import { StoreRepository } from '@amazon-ai-ops/local-db/src/sqlite/repositories/store-repo';
import { initSqlite } from '@amazon-ai-ops/local-db/src/sqlite/db';
import { ConfigurationBus, type ConfigurationChange } from './configuration-bus';
import { DurableStoreSessionGenerationAuthority, StoreCoordinator } from './store-coordinator';
import { StoreRuntimeConfigService } from './store-runtime-config-service';

const TIME = '2026-10-22T00:00:00.000Z';
function store(id: string): StoreRecord {
  return { storeId: id as StoreId, browserProfileId: `profile-${id}` as StoreRecord['browserProfileId'],
    displayName: id, marketplace: 'US', currency: 'USD', status: 'active',
    businessTimezone: 'America/Los_Angeles', createdAt: TIME, updatedAt: TIME };
}
function context(record: StoreRecord): StoreContextEnvelope {
  return { storeId: record.storeId, browserProfileId: record.browserProfileId, marketplace: 'US', currency: 'USD',
    businessTimezone: record.businessTimezone, businessDate: '2026-10-21' as StoreContextEnvelope['businessDate'], sessionGeneration: 1 };
}
function harness() {
  const a = store('store-a'), b = store('store-b'), rows = new Map<string, string>();
  const logger = { error: vi.fn() }, writes = vi.fn((key: string, value: string) => rows.set(key, value));
  const assertActiveStoreContext = vi.fn((input: StoreContextEnvelope) => {
    if (input.sessionGeneration !== 1) throw new Error('stale session');
    return input;
  });
  const getStore = vi.fn((id: StoreId) => {
    const current = [a, b].find(value => value.storeId === id);
    if (!current) throw new Error('missing store');
    return current;
  });
  const settings = { get: (key: string) => rows.get(key) ?? null, set: writes,
    transaction<T>(work: () => T): T {
      const before = new Map(rows);
      try { return work(); }
      catch (error) { rows.clear(); for (const row of before) rows.set(...row); throw error; }
    } };
  const options = { storeCoordinator: { assertActiveStoreContext, getStore }, settings, now: () => TIME, logger };
  const service = new StoreCollectionAutomationService(options);
  return { a, b, rows, logger, writes, assertActiveStoreContext, service, options };
}
function record(patch: Record<string, unknown> = {}) {
  return { schemaVersion: 1, storeId: 'store-a', browserProfileId: 'profile-store-a', revision: 1,
    automaticCollectionEnabled: false, updatedAt: TIME, ...patch };
}

describe('store collection automation control shared codec', () => {
  it('keeps legacy defaults read-only and path-free when no override exists', () => {
    const identity = { storeId: 'store-a', browserProfileId: 'profile-store-a' };
    expect(readStoreCollectionAutomation(null, identity)).toEqual({ ...identity,
      automaticCollectionEnabled: true, source: 'legacy-default', revision: 0, updatedAt: null });
    expect(readStoreCollectionAutomation(undefined, identity)).toEqual(readStoreCollectionAutomation(null, identity));
    expect(storeCollectionAutomationSettingKey(identity.storeId)).toBe('store_collection_automation:v1:store-a');
  });
  it('reads exact explicit false and true without conflating boolean and string', () => {
    for (const automaticCollectionEnabled of [false, true]) {
      expect(readStoreCollectionAutomation(JSON.stringify(record({ automaticCollectionEnabled })), store('store-a')))
        .toEqual({ storeId: 'store-a', browserProfileId: 'profile-store-a', automaticCollectionEnabled,
          source: 'explicit-override', revision: 1, updatedAt: TIME });
    }
  });
  it.each([
    '', ' ', '{', 'null', '[]', JSON.stringify(record({ schemaVersion: 2 })),
    JSON.stringify(record({ revision: 0 })), JSON.stringify(record({ revision: 1.5 })),
    JSON.stringify(record({ revision: Number.MAX_SAFE_INTEGER + 1 })),
    JSON.stringify(record({ automaticCollectionEnabled: 'false' })),
    JSON.stringify(record({ updatedAt: '2026-10-22T08:00:00+08:00' })),
    JSON.stringify(record({ updatedAt: '2026-02-30T00:00:00.000Z' })),
    JSON.stringify(record({ extra: false })), JSON.stringify({ ...record(), browserProfileId: undefined }),
  ])('rejects malformed persisted override %j', raw => {
    expect(() => readStoreCollectionAutomation(raw, store('store-a'))).toThrow(StoreCollectionAutomationError);
  });
  it.each([{ storeId: 'store-b' }, { browserProfileId: 'profile-other' }])('rejects foreign persisted binding %j', patch => {
    expect(() => readStoreCollectionAutomation(JSON.stringify(record(patch)), store('store-a')))
      .toThrow(expect.objectContaining({ code: 'STORE_IDENTITY_MISMATCH' }));
  });
  it.each(['', '../store-a', 'Store-A', 'store/a'])('rejects a noncanonical logical store key %j', value => {
    expect(() => storeCollectionAutomationSettingKey(value)).toThrow(StoreCollectionAutomationError);
  });
});

describe('StoreCollectionAutomationService', () => {
  it('does not persist, advance revision or synthesize configuration while reading legacy defaults', () => {
    const test = harness();
    expect(test.service.get(context(test.a))).toEqual({ storeId: test.a.storeId, browserProfileId: test.a.browserProfileId,
      automaticCollectionEnabled: true, source: 'legacy-default', revision: 0, updatedAt: null });
    expect(test.rows.size).toBe(0); expect(test.writes).not.toHaveBeenCalled();
    expect(test.service.getForStoreRecord(test.b).revision).toBe(0);
    expect(test.assertActiveStoreContext).toHaveBeenCalledTimes(1);
  });
  it('persists one exact store override through the settings transaction with CAS and immediate readback', () => {
    const test = harness(), active = context(test.a);
    const disabled = test.service.set(active, { expectedRevision: 0, automaticCollectionEnabled: false });
    expect(disabled).toEqual({ storeId: test.a.storeId, browserProfileId: test.a.browserProfileId,
      automaticCollectionEnabled: false, source: 'explicit-override', revision: 1, updatedAt: TIME });
    expect(test.service.get(active)).toEqual(disabled);
    expect(JSON.parse(test.rows.get(storeCollectionAutomationSettingKey(test.a.storeId))!)).toEqual(record());
    expect(test.service.get(context(test.b)).source).toBe('legacy-default');
    expect(test.service.getForStoreRecord(test.b).automaticCollectionEnabled).toBe(true);
    const enabled = test.service.set(active, { expectedRevision: 1, automaticCollectionEnabled: true });
    expect(enabled.revision).toBe(2); expect(enabled.automaticCollectionEnabled).toBe(true);
  });
  it('retains the explicit override across service reconstruction and isolates the other store', () => {
    const test = harness();
    test.service.set(context(test.a), { expectedRevision: 0, automaticCollectionEnabled: false });
    const restored = new StoreCollectionAutomationService(test.options);
    expect(restored.getForStoreRecord(test.a).automaticCollectionEnabled).toBe(false);
    expect(restored.getForStoreRecord(test.b).automaticCollectionEnabled).toBe(true);
    expect(test.rows.size).toBe(1);
  });
  it('rejects stale CAS without changing persisted bytes and logs the original code', () => {
    const test = harness(); test.service.set(context(test.a), { expectedRevision: 0, automaticCollectionEnabled: false });
    const before = new Map(test.rows);
    expect(() => test.service.set(context(test.a), { expectedRevision: 0, automaticCollectionEnabled: true }))
      .toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(test.rows).toEqual(before);
    expect(test.logger.error).toHaveBeenLastCalledWith('store.collection_automation_failed',
      expect.objectContaining({ operation: 'set', error: expect.objectContaining({ code: 'REVISION_CONFLICT' }) }));
  });
  it.each([
    {}, { expectedRevision: -1, automaticCollectionEnabled: false },
    { expectedRevision: 0.5, automaticCollectionEnabled: false },
    { expectedRevision: 0, automaticCollectionEnabled: 'false' },
    { expectedRevision: 0, automaticCollectionEnabled: false, extra: true },
  ])('rejects malformed set input %j without a settings write', input => {
    const test = harness();
    expect(() => test.service.set(context(test.a), input as never)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(test.writes).not.toHaveBeenCalled(); expect(test.rows.size).toBe(0);
  });
  it('rechecks full active authority and rejects stale session or foreign Profile', () => {
    const test = harness(), active = context(test.a);
    expect(() => test.service.set({ ...active, sessionGeneration: 0 }, { expectedRevision: 0, automaticCollectionEnabled: false })).toThrow('stale session');
    expect(() => test.service.get({ ...active, browserProfileId: test.b.browserProfileId }))
      .toThrow(expect.objectContaining({ code: 'STORE_IDENTITY_MISMATCH' }));
    expect(() => test.service.getForStoreRecord({ ...test.a, browserProfileId: test.b.browserProfileId }))
      .toThrow(expect.objectContaining({ code: 'STORE_IDENTITY_MISMATCH' }));
    expect(test.rows.size).toBe(0);
  });
  it('never replaces a corrupt persisted override with the legacy default or a new write', () => {
    const test = harness(); test.rows.set(storeCollectionAutomationSettingKey(test.a.storeId), '{');
    expect(() => test.service.get(context(test.a))).toThrow(expect.objectContaining({ code: 'CORRUPT_STORAGE' }));
    expect(() => test.service.set(context(test.a), { expectedRevision: 0, automaticCollectionEnabled: false }))
      .toThrow(expect.objectContaining({ code: 'CORRUPT_STORAGE' }));
    expect(test.writes).not.toHaveBeenCalled();
  });
  it('rolls back a readback mismatch through the same transaction', () => {
    const test = harness(); test.writes.mockImplementation(() => new Map());
    expect(() => test.service.set(context(test.a), { expectedRevision: 0, automaticCollectionEnabled: false }))
      .toThrow(expect.objectContaining({ code: 'CORRUPT_STORAGE' }));
    expect(test.rows.size).toBe(0);
  });
  it('retains both the original failure and logging failure instead of swallowing either', () => {
    const test = harness(), original = new Error('original persistence failure'), logFailure = new Error('log failure');
    test.writes.mockImplementation(() => { throw original; });
    test.logger.error.mockImplementation(() => { throw logFailure; });
    try { test.service.set(context(test.a), { expectedRevision: 0, automaticCollectionEnabled: false }); }
    catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([original, logFailure]); return; }
    throw new Error('expected an aggregate failure');
  });
});

describe('StoreCollectionAutomationService real ConfigurationBus and SQLite', () => {
  it('commits the namespaced override through the real bus, rolls back atomically and survives a physical database reopen', () => {
    const h = createHarness(), logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    let database = h.database;
    const connect = () => {
      const bus = new ConfigurationBus(database, logger), stores = new StoreRepository(database);
      const sessions = new DurableStoreSessionGenerationAuthority({
        transaction: work => bus.transaction(work),
        read: storeId => { const value = bus.get(`store_session_generation:${storeId}`); return value === null ? undefined : Number(value); },
        write: (storeId, value) => bus.set(`store_session_generation:${storeId}`, String(value)),
      });
      for (const current of stores.listStores()) sessions.seed(current.storeId, 4);
      const coordinator = new StoreCoordinator({ repository: stores, sessions, now: () => new Date(TIME) });
      return { bus, stores, coordinator,
        configs: new StoreRuntimeConfigService({ storeCoordinator: coordinator, settings: bus, now: () => TIME }),
        service: new StoreCollectionAutomationService({ storeCoordinator: coordinator, settings: bus, now: () => TIME, logger }) };
    };
    let current = connect();
    let active = current.coordinator.switchStore(h.contextOne.storeId).context;
    current.configs.create(active, { values: { aiRecommendationsEnabled: false, collectionScheduleLocalTime: '08:00',
      collectionLookbackDays: 7, analysisWindowDays: 30, defaultTargetAcosPercent: 28,
      minimumRecommendationConfidencePercent: 75, evidenceRetentionDays: 90 } });
    const configKey = `store_runtime_config:v1:${active.storeId}`, configBytes = current.bus.get(configKey);
    const changes: ConfigurationChange[] = [];
    current.bus.subscribe(change => { changes.push(change); });
    const disabled = current.service.set(active, { expectedRevision: 0, automaticCollectionEnabled: false });
    const key = storeCollectionAutomationSettingKey(active.storeId), persisted = current.bus.get(key);
    expect(database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)).toEqual({ value: persisted });
    expect(JSON.parse(persisted!)).toEqual({ schemaVersion: 1, storeId: active.storeId, browserProfileId: active.browserProfileId,
      revision: 1, automaticCollectionEnabled: false, updatedAt: TIME });
    expect(changes.map(change => [change.key, change.operation])).toEqual([[key, 'set']]);
    expect(changes[0]).not.toHaveProperty('value');
    expect(current.bus.get(configKey)).toBe(configBytes);
    expect(current.configs.get(active).current?.revision).toBe(1);
    const rollback = new Error('rollback outer real SQLite transaction');
    expect(() => current.bus.transaction(() => {
      current.service.set(active, { expectedRevision: 1, automaticCollectionEnabled: true });
      throw rollback;
    })).toThrow(rollback);
    expect(current.bus.get(key)).toBe(persisted);
    expect(changes).toHaveLength(1);
    database.close();
    database = initSqlite(h.databasePath); databases.push(database);
    current = connect(); active = current.coordinator.switchStore(h.contextOne.storeId).context;
    expect(current.service.get(active)).toEqual(disabled);
    expect(current.bus.get(configKey)).toBe(configBytes);
    expect(current.configs.get(active).current?.status).toBe('active');
    expect(current.configs.get(active).versions).toHaveLength(1);
    expect(current.service.getForStoreRecord(current.stores.getStore(h.contextTwo.storeId)!)).toEqual({
      storeId: h.contextTwo.storeId, browserProfileId: h.contextTwo.browserProfileId,
      automaticCollectionEnabled: true, source: 'legacy-default', revision: 0, updatedAt: null });
    expect(database.prepare("SELECT COUNT(*) AS count FROM app_settings WHERE key LIKE 'store_collection_automation:v1:%'").get())
      .toEqual({ count: 1 });
  });
});
