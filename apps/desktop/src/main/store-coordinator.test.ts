import { describe, expect, it } from 'vitest';
import type {
  ArchiveStoreInput,
  BrowserProfileId,
  CreateStoreConnectionInput,
  ListStoresInput,
  RestoreStoreInput,
  RemoveStoreConnectionInput,
  StoreCapabilityId,
  StoreConnection,
  StoreId,
  StoreRecord,
  StoreSessionMetadata,
  UpdateStoreConnectionInput,
  UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';
import {
  DurableStoreSessionGenerationAuthority,
  StoreCoordinator,
  type StoreAuthorityRepository,
  type StoreSessionGenerationStorage,
} from './store-coordinator';

class MemoryStoreRepository implements StoreAuthorityRepository {
  readonly rows = new Map<StoreId, StoreRecord>();
  readonly connections = new Map<StoreCapabilityId, StoreConnection>();
  lastCreatedConnectionInput: (CreateStoreConnectionInput & { id: StoreCapabilityId }) | null = null;
  lastUpdatedConnectionInput: UpdateStoreConnectionInput | null = null;

  transaction<T>(work: () => T): T {
    const rowSnapshot = new Map([...this.rows].map(([key, value]) => [key, { ...value }]));
    const connectionSnapshot = new Map([...this.connections].map(([key, value]) => [key, { ...value }]));
    const createdInputSnapshot = this.lastCreatedConnectionInput;
    const updatedInputSnapshot = this.lastUpdatedConnectionInput;
    try {
      return work();
    } catch (error) {
      this.rows.clear();
      for (const [key, value] of rowSnapshot) this.rows.set(key, value);
      this.connections.clear();
      for (const [key, value] of connectionSnapshot) this.connections.set(key, value);
      this.lastCreatedConnectionInput = createdInputSnapshot;
      this.lastUpdatedConnectionInput = updatedInputSnapshot;
      throw error;
    }
  }

  listStores(input?: ListStoresInput): StoreRecord[] {
    return [...this.rows.values()].filter((store) => input?.includeArchived || store.status !== 'archived');
  }

  getStore(storeId: StoreId): StoreRecord | undefined {
    return this.rows.get(storeId);
  }

  createStore(input: Omit<StoreRecord, 'status' | 'createdAt' | 'updatedAt' | 'archivedAt'>): StoreRecord {
    const row: StoreRecord = {
      ...input,
      status: 'active',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    };
    this.rows.set(row.storeId, row);
    return row;
  }

  updateStore(input: UpdateStoreInput): StoreRecord {
    const row = { ...this.rows.get(input.storeId)!, ...input.patch, updatedAt: '2026-07-22T00:01:00.000Z' };
    this.rows.set(row.storeId, row);
    return row;
  }

  archiveStore(input: ArchiveStoreInput): StoreRecord {
    const row = { ...this.rows.get(input.storeId)!, status: 'archived' as const, archivedAt: '2026-07-22T00:02:00.000Z' };
    this.rows.set(row.storeId, row);
    return row;
  }

  restoreStore(input: RestoreStoreInput): StoreRecord {
    const current = this.rows.get(input.storeId)!;
    const { archivedAt: _archivedAt, ...rest } = current;
    const row = { ...rest, status: 'inactive' as const };
    this.rows.set(row.storeId, row);
    return row;
  }

  createConnection(input: CreateStoreConnectionInput & { id: StoreCapabilityId }): StoreConnection {
    this.lastCreatedConnectionInput = input;
    const connection: StoreConnection = {
      ...input,
      status: 'not_configured',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    };
    this.connections.set(connection.id, connection);
    return connection;
  }

  updateConnection(input: UpdateStoreConnectionInput): StoreConnection {
    this.lastUpdatedConnectionInput = input;
    const existing = this.connections.get(input.id)!;
    const submittedAccountLabel = input.accountLabel === undefined
      ? existing.accountLabel
      : input.accountLabel.trim() || undefined;
    const submittedExternalAccountId = input.externalAccountId === undefined
      ? existing.externalAccountId
      : input.externalAccountId.trim() || undefined;
    const identityChanged = (
      input.accountLabel !== undefined
      && submittedAccountLabel !== existing.accountLabel
    ) || (
      input.externalAccountId !== undefined
      && submittedExternalAccountId !== existing.externalAccountId
    );
    const connection: StoreConnection = {
      ...existing,
      ...input,
      ...(identityChanged ? {
        externalAccountId: undefined,
        status: 'not_configured' as const,
        lastVerifiedAt: undefined,
        lastFailureCode: undefined,
        session: undefined,
      } : {}),
      updatedAt: '2026-07-22T00:01:00.000Z',
    };
    this.connections.set(connection.id, connection);
    return connection;
  }

  removeConnection(input: RemoveStoreConnectionInput): void {
    this.connections.delete(input.id);
  }

  listConnections(storeId: StoreId): StoreConnection[] {
    return [...this.connections.values()].filter((connection) => connection.storeId === storeId);
  }

  listSessionMetadata(_storeId: StoreId): StoreSessionMetadata[] {
    return [];
  }
}

class MemoryGenerationStorage implements StoreSessionGenerationStorage {
  readonly values = new Map<StoreId, number>();
  readonly transactionWrites: StoreId[][] = [];
  private currentWrites: StoreId[] | null = null;

  transaction<T>(work: () => T): T {
    const snapshot = new Map(this.values);
    const previousWrites = this.currentWrites;
    const writes: StoreId[] = [];
    this.currentWrites = writes;
    try {
      const result = work();
      this.transactionWrites.push(writes);
      return result;
    } catch (error) {
      this.values.clear();
      for (const [storeId, generation] of snapshot) this.values.set(storeId, generation);
      throw error;
    } finally {
      this.currentWrites = previousWrites;
    }
  }

  read(storeId: StoreId): number | undefined {
    return this.values.get(storeId);
  }

  write(storeId: StoreId, sessionGeneration: number): void {
    this.currentWrites?.push(storeId);
    this.values.set(storeId, sessionGeneration);
  }
}

class MemorySessions {
  private readonly generations = new Map<StoreId, number>();
  failNextAdvance = false;

  current(storeId: StoreId): number {
    return this.generations.get(storeId) ?? 0;
  }

  advance(storeId: StoreId): number {
    if (this.failNextAdvance) {
      this.failNextAdvance = false;
      throw new Error('injected generation write failure');
    }
    const next = this.current(storeId) + 1;
    this.generations.set(storeId, next);
    return next;
  }

  advanceMany(storeIds: readonly StoreId[]): ReadonlyMap<StoreId, number> {
    return new Map(storeIds.map((storeId) => [storeId, this.advance(storeId)]));
  }

  assertCurrent(context: { storeId: StoreId; sessionGeneration: number }): void {
    if (this.current(context.storeId) !== context.sessionGeneration) throw new Error('stale generation');
  }
}

const asStoreId = (value: string) => value as StoreId;
const asProfileId = (value: string) => value as BrowserProfileId;

function createHarness() {
  const repository = new MemoryStoreRepository();
  const sessions = new MemorySessions();
  let id = 0;
  let now = new Date('2026-07-22T06:00:00.000Z');
  const coordinator = new StoreCoordinator({
    repository,
    sessions,
    now: () => now,
    createStoreId: () => asStoreId(`store-${++id}`),
    createBrowserProfileId: (storeId) => asProfileId(`browser-${storeId}`),
    createStoreCapabilityId: () => 'capability-1' as StoreCapabilityId,
  });
  return {
    coordinator,
    repository,
    sessions,
    setNow(value: string) { now = new Date(value); },
  };
}

describe('StoreCoordinator', () => {
  it('allocates Main-owned logical ids and fixes V1 identity to US/USD', () => {
    const { coordinator } = createHarness();
    const row = coordinator.createStore({ displayName: '  SHC 001  ' });
    expect(row).toMatchObject({
      storeId: 'store-1',
      browserProfileId: 'browser-store-1',
      displayName: 'SHC 001',
      marketplace: 'US',
      currency: 'USD',
      businessTimezone: 'America/Los_Angeles',
    });
    expect(row).not.toHaveProperty('profilePath');
  });

  it('invalidates stale Renderer contexts when switching stores', () => {
    const { coordinator } = createHarness();
    const first = coordinator.createStore({ displayName: 'One' });
    const second = coordinator.createStore({ displayName: 'Two' });
    const firstView = coordinator.switchStore(first.storeId);
    coordinator.switchStore(second.storeId);

    expect(() => coordinator.assertStoreContext(firstView.context)).toThrow(/stale generation/);
  });

  it('invalidates a captured context when the US business date rolls over', () => {
    const { coordinator, setNow } = createHarness();
    const store = coordinator.createStore({ displayName: 'One' });
    const beforeMidnight = coordinator.switchStore(store.storeId).context;

    setNow('2026-07-22T08:00:00.000Z');

    expect(() => coordinator.assertActiveStoreContext(beforeMidnight))
      .toThrow(/store context no longer matches Main-process store authority/);
    expect(coordinator.getActiveStoreContext()?.businessDate).toBe('2026-07-22');
  });

  it('does not silently rebind a captured context to the current UI store', () => {
    const { coordinator } = createHarness();
    const first = coordinator.createStore({ displayName: 'One' });
    const second = coordinator.createStore({ displayName: 'Two' });
    coordinator.switchStore(first.storeId);
    const secondView = coordinator.switchStore(second.storeId);

    expect(coordinator.assertStoreContext(secondView.context).storeId).toBe(second.storeId);
    expect(() => coordinator.assertActiveStoreContext({
      ...secondView.context,
      storeId: first.storeId,
      browserProfileId: first.browserProfileId,
    })).toThrow();
  });

  it('rejects archive, non-US creation, and empty updates through explicit contracts', () => {
    const { coordinator } = createHarness();
    const row = coordinator.createStore({ displayName: 'One' });
    expect(() => coordinator.createStore({ displayName: 'DE', marketplace: 'DE' as never })).toThrow(/US only/);
    expect(() => coordinator.updateStore({ storeId: row.storeId, patch: {} })).toThrow(/at least one field/);
    coordinator.switchStore(row.storeId);
    const archived = coordinator.archiveStore({ storeId: row.storeId });
    expect(archived.status).toBe('archived');
    expect(coordinator.getActiveStoreContext()).toBeNull();
  });

  it('allocates connection ids in Main and refuses connection writes for inactive stores', () => {
    const { coordinator } = createHarness();
    const row = coordinator.createStore({ displayName: 'One' });
    const connection = coordinator.createConnection({ storeId: row.storeId, provider: 'lingxing' });
    expect(connection.id).toBe('capability-1');
    coordinator.updateStore({ storeId: row.storeId, patch: { status: 'inactive' } });
    expect(() => coordinator.createConnection({ storeId: row.storeId, provider: 'amazon_ads' })).toThrow(/not active/);
  });

  it('invalidates the active StoreContext whenever a connection mapping changes', () => {
    const { coordinator } = createHarness();
    const row = coordinator.createStore({ displayName: 'One' });
    const initial = coordinator.switchStore(row.storeId).context;

    const connection = coordinator.createConnection({
      storeId: row.storeId,
      provider: 'amazon_ads',
      accountLabel: 'old-account',
      externalAccountId: 'profile-old',
    });
    expect(() => coordinator.assertActiveStoreContext(initial)).toThrow(/stale generation/);

    const afterCreate = coordinator.getActiveStoreContext()!;
    const rebound = coordinator.updateConnection({
      id: connection.id,
      storeId: row.storeId,
      accountLabel: 'old-account',
      externalAccountId: 'profile-new',
    });
    expect(rebound).toEqual(expect.objectContaining({
      accountLabel: 'old-account',
      status: 'not_configured',
    }));
    expect(rebound.externalAccountId).toBeUndefined();
    expect(() => coordinator.assertActiveStoreContext(afterCreate)).toThrow(/stale generation/);

    const afterUpdate = coordinator.getActiveStoreContext()!;
    coordinator.removeConnection({ id: connection.id, storeId: row.storeId });
    expect(() => coordinator.assertActiveStoreContext(afterUpdate)).toThrow(/stale generation/);
  });

  it('rolls back store and connection writes when durable generation advancement fails', () => {
    const { coordinator, repository, sessions } = createHarness();
    const store = coordinator.createStore({ displayName: 'One' });
    const initialStore = repository.getStore(store.storeId)!;

    sessions.failNextAdvance = true;
    expect(() => coordinator.updateStore({
      storeId: store.storeId,
      patch: { displayName: 'Should Roll Back' },
    })).toThrow(/injected generation write failure/);
    expect(repository.getStore(store.storeId)).toEqual(initialStore);

    sessions.failNextAdvance = true;
    expect(() => coordinator.createConnection({
      storeId: store.storeId,
      provider: 'lingxing',
      accountLabel: 'should-not-persist',
    })).toThrow(/injected generation write failure/);
    expect(repository.listConnections(store.storeId)).toEqual([]);
    expect(sessions.current(store.storeId)).toBe(0);
  });

  it('strips Renderer-only connection state before calling the repository', () => {
    const { coordinator, repository } = createHarness();
    const row = coordinator.createStore({ displayName: 'One' });

    coordinator.createConnection({
      storeId: row.storeId,
      provider: 'lingxing',
      accountLabel: 'operator@example.com',
      status: 'ready',
      lastVerifiedAt: 'forged',
      lastFailureCode: 'forged',
    } as never);
    coordinator.updateConnection({
      id: 'capability-1',
      storeId: row.storeId,
      accountLabel: 'updated@example.com',
      status: 'ready',
      lastVerifiedAt: 'forged',
      lastFailureCode: 'forged',
    } as never);

    expect(repository.lastCreatedConnectionInput).toEqual({
      id: 'capability-1',
      storeId: row.storeId,
      provider: 'lingxing',
      accountLabel: 'operator@example.com',
      externalAccountId: undefined,
    });
    expect(repository.lastUpdatedConnectionInput).toEqual({
      id: 'capability-1',
      storeId: row.storeId,
      accountLabel: 'updated@example.com',
      externalAccountId: undefined,
    });
  });

  it('does not inherit verified readiness or external identity when rebinding an account label', () => {
    const { coordinator, repository } = createHarness();
    const store = coordinator.createStore({ displayName: 'One' });
    const connection = coordinator.createConnection({
      storeId: store.storeId,
      provider: 'lingxing',
      accountLabel: 'identity-a',
      externalAccountId: 'external-a',
    });
    repository.connections.set(connection.id, {
      ...connection,
      status: 'ready',
      lastVerifiedAt: '2026-07-22T02:00:00.000Z',
      session: {
        storeId: store.storeId,
        browserProfileId: store.browserProfileId,
        provider: 'lingxing',
        status: 'ready',
        sessionGeneration: 2,
        observedAt: '2026-07-22T02:00:00.000Z',
        accountLabel: 'identity-a',
        externalAccountId: 'external-a',
      },
    });

    const rebound = coordinator.updateConnection({
      id: connection.id,
      storeId: store.storeId,
      accountLabel: 'identity-b',
      externalAccountId: 'external-a',
    });

    expect(rebound).toEqual(expect.objectContaining({
      accountLabel: 'identity-b',
      status: 'not_configured',
    }));
    expect(rebound.externalAccountId).toBeUndefined();
    expect(rebound.lastVerifiedAt).toBeUndefined();
    expect(rebound.session).toBeUndefined();
  });

  it('persists generation watermarks across authority reconstruction', () => {
    const storage = new MemoryGenerationStorage();
    const storeId = asStoreId('store-one');
    const first = new DurableStoreSessionGenerationAuthority(storage);

    first.seed(storeId, 7);
    expect(first.advance(storeId)).toBe(8);

    const reconstructed = new DurableStoreSessionGenerationAuthority(storage);
    expect(reconstructed.current(storeId)).toBe(8);
  });

  it('advances old and new stores in one transaction during a switch', () => {
    const repository = new MemoryStoreRepository();
    const storage = new MemoryGenerationStorage();
    const sessions = new DurableStoreSessionGenerationAuthority(storage);
    let id = 0;
    const coordinator = new StoreCoordinator({
      repository,
      sessions,
      createStoreId: () => asStoreId(`store-${++id}`),
      createBrowserProfileId: (storeId) => asProfileId(`browser-${storeId}`),
    });
    const first = coordinator.createStore({ displayName: 'One' });
    const second = coordinator.createStore({ displayName: 'Two' });

    coordinator.switchStore(first.storeId);
    coordinator.switchStore(second.storeId);

    expect(storage.transactionWrites.at(-1)).toEqual([first.storeId, second.storeId]);
    expect(sessions.current(first.storeId)).toBe(2);
    expect(sessions.current(second.storeId)).toBe(1);
  });
});
