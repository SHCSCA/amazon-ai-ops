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
  lastCreatedConnectionInput: (CreateStoreConnectionInput & { id: StoreCapabilityId }) | null = null;
  lastUpdatedConnectionInput: UpdateStoreConnectionInput | null = null;

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
    return {
      ...input,
      status: 'not_configured',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    };
  }

  updateConnection(input: UpdateStoreConnectionInput): StoreConnection {
    this.lastUpdatedConnectionInput = input;
    return {
      ...input,
      provider: 'lingxing',
      status: 'ready',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:01:00.000Z',
    };
  }

  removeConnection(_input: RemoveStoreConnectionInput): void {}

  listConnections(_storeId: StoreId): StoreConnection[] {
    return [];
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

  current(storeId: StoreId): number {
    return this.generations.get(storeId) ?? 0;
  }

  advance(storeId: StoreId): number {
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
  const coordinator = new StoreCoordinator({
    repository,
    sessions,
    now: () => new Date('2026-07-22T06:00:00.000Z'),
    createStoreId: () => asStoreId(`store-${++id}`),
    createBrowserProfileId: (storeId) => asProfileId(`browser-${storeId}`),
    createStoreCapabilityId: () => 'capability-1' as StoreCapabilityId,
  });
  return { coordinator, repository, sessions };
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
