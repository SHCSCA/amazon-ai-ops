import { randomUUID } from 'crypto';
import type {
  ArchiveStoreInput,
  BrowserProfileId,
  BusinessDate,
  CreateStoreConnectionInput,
  CreateStoreInput,
  ListStoresInput,
  RestoreStoreInput,
  RemoveStoreConnectionInput,
  StoreCapabilityId,
  StoreConnection,
  StoreContextEnvelope,
  StoreId,
  StoreRecord,
  StoreSessionMetadata,
  StoreWorkspaceView,
  UpdateStoreConnectionInput,
  UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';
import {
  DEFAULT_US_BUSINESS_TIMEZONE,
  normalizeBrowserProfileId,
  normalizeBusinessTimezone,
  normalizeSessionGeneration,
  normalizeStoreCapabilityId,
  normalizeStoreContextEnvelope,
  normalizeStoreId,
  normalizeUsdCurrency,
  normalizeUsMarketplace,
} from '@amazon-ai-ops/shared-types';

export interface StoreAuthorityRepository {
  /**
   * Runs store authority and durable generation writes on the same database
   * transaction boundary. Implementations must roll back every nested write
   * when `work` throws.
   */
  transaction<T>(work: () => T): T;
  listStores(input?: ListStoresInput): StoreRecord[];
  getStore(storeId: StoreId): StoreRecord | undefined;
  createStore(input: {
    storeId: StoreId;
    browserProfileId: BrowserProfileId;
    displayName: string;
    marketplace: 'US';
    currency: 'USD';
    businessTimezone: string;
  }): StoreRecord;
  updateStore(input: UpdateStoreInput): StoreRecord;
  archiveStore(input: ArchiveStoreInput): StoreRecord;
  restoreStore(input: RestoreStoreInput): StoreRecord;
  createConnection(input: CreateStoreConnectionInput & { id: StoreCapabilityId }): StoreConnection;
  updateConnection(input: UpdateStoreConnectionInput): StoreConnection;
  removeConnection(input: RemoveStoreConnectionInput): void;
  listConnections(storeId: StoreId): StoreConnection[];
  listSessionMetadata(storeId: StoreId): StoreSessionMetadata[];
}

export interface StoreSessionGenerationAuthority {
  current(storeId: StoreId): number;
  advance(storeId: StoreId): number;
  advanceMany(storeIds: readonly StoreId[]): ReadonlyMap<StoreId, number>;
  assertCurrent(context: StoreContextEnvelope): void;
}

export interface StoreSessionGenerationStorage {
  transaction<T>(work: () => T): T;
  read(storeId: StoreId): number | undefined;
  write(storeId: StoreId, sessionGeneration: number): void;
}

/**
 * Durable generation watermark used by Main. Every mutation is committed
 * before the coordinator publishes a new context, and multi-store switches
 * advance both sides in one storage transaction.
 */
export class DurableStoreSessionGenerationAuthority
implements StoreSessionGenerationAuthority {
  constructor(private readonly storage: StoreSessionGenerationStorage) {}

  current(storeIdInput: StoreId): number {
    const storeId = normalizeStoreId(storeIdInput);
    const stored = this.storage.read(storeId);
    return stored === undefined ? 0 : normalizeSessionGeneration(stored);
  }

  seed(storeIdInput: StoreId, generationInput: number): number {
    const storeId = normalizeStoreId(storeIdInput);
    const requested = normalizeSessionGeneration(generationInput);
    return this.storage.transaction(() => {
      const current = this.current(storeId);
      const next = Math.max(current, requested);
      if (next !== current || this.storage.read(storeId) === undefined) {
        this.storage.write(storeId, next);
      }
      return next;
    });
  }

  advance(storeId: StoreId): number {
    return this.advanceMany([storeId]).get(normalizeStoreId(storeId))!;
  }

  advanceMany(storeIdsInput: readonly StoreId[]): ReadonlyMap<StoreId, number> {
    const storeIds = [...new Set(storeIdsInput.map((storeId) => normalizeStoreId(storeId)))];
    return this.storage.transaction(() => {
      const advanced = new Map<StoreId, number>();
      for (const storeId of storeIds) {
        const current = this.current(storeId);
        if (current >= Number.MAX_SAFE_INTEGER) {
          throw new Error(`session generation exhausted for store ${storeId}`);
        }
        const next = current + 1;
        this.storage.write(storeId, next);
        advanced.set(storeId, next);
      }
      return advanced;
    });
  }

  assertCurrent(value: StoreContextEnvelope): void {
    const context = normalizeStoreContextEnvelope(value);
    const current = this.current(context.storeId);
    if (context.sessionGeneration !== current) {
      throw new Error(
        `stale session generation for store ${context.storeId}: expected ${current}, got ${context.sessionGeneration}`,
      );
    }
  }
}

export interface StoreCoordinatorOptions {
  repository: StoreAuthorityRepository;
  sessions: StoreSessionGenerationAuthority;
  now?: () => Date;
  createStoreId?: () => StoreId;
  createBrowserProfileId?: (storeId: StoreId) => BrowserProfileId;
  createStoreCapabilityId?: () => StoreCapabilityId;
}

export class StoreCoordinatorError extends Error {
  constructor(
    readonly code:
      | 'STORE_NOT_FOUND'
      | 'STORE_NOT_ACTIVE'
      | 'EMPTY_STORE_PATCH'
      | 'INVALID_DISPLAY_NAME'
      | 'INVALID_STORE_STATUS'
      | 'INVALID_STORE_LIST_FILTER'
      | 'STALE_STORE_CONTEXT'
      | 'STORE_CONTEXT_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'StoreCoordinatorError';
  }
}

/**
 * Main-process store authority. The Renderer can choose a logical store but
 * cannot allocate profile paths, choose marketplace/currency, or mint a
 * session generation.
 */
export class StoreCoordinator {
  private readonly repository: StoreAuthorityRepository;
  private readonly sessions: StoreSessionGenerationAuthority;
  private readonly now: () => Date;
  private readonly createStoreId: () => StoreId;
  private readonly createBrowserProfileId: (storeId: StoreId) => BrowserProfileId;
  private readonly createStoreCapabilityId: () => StoreCapabilityId;
  private activeStoreId: StoreId | null = null;

  constructor(options: StoreCoordinatorOptions) {
    this.repository = options.repository;
    this.sessions = options.sessions;
    this.now = options.now ?? (() => new Date());
    this.createStoreId = options.createStoreId
      ?? (() => normalizeStoreId(`store-${randomUUID()}`));
    this.createBrowserProfileId = options.createBrowserProfileId
      ?? ((storeId) => `browser-${storeId}` as BrowserProfileId);
    this.createStoreCapabilityId = options.createStoreCapabilityId
      ?? (() => `capability-${randomUUID()}` as StoreCapabilityId);
  }

  listStores(input?: ListStoresInput): StoreRecord[] {
    if (input === undefined) return this.repository.listStores();
    if (typeof input.includeArchived !== 'undefined' && typeof input.includeArchived !== 'boolean') {
      throw new StoreCoordinatorError(
        'INVALID_STORE_LIST_FILTER',
        'includeArchived must be a boolean',
      );
    }
    if (input.statuses !== undefined) {
      if (!Array.isArray(input.statuses)
        || input.statuses.some((status) => !['active', 'inactive', 'archived'].includes(status))) {
        throw new StoreCoordinatorError(
          'INVALID_STORE_LIST_FILTER',
          'statuses contains an unsupported store status',
        );
      }
    }
    return this.repository.listStores(input);
  }

  getStore(storeIdInput: unknown): StoreRecord {
    return this.requireStore(normalizeStoreId(storeIdInput));
  }

  createStore(input: CreateStoreInput): StoreRecord {
    const displayName = normalizeDisplayName(input?.displayName);
    const marketplace = normalizeUsMarketplace(input?.marketplace);
    const currency = normalizeUsdCurrency(input?.currency);
    const businessTimezone = normalizeBusinessTimezone(
      input?.businessTimezone ?? DEFAULT_US_BUSINESS_TIMEZONE,
    );
    const storeId = normalizeStoreId(this.createStoreId());
    const browserProfileId = normalizeBrowserProfileId(this.createBrowserProfileId(storeId));
    return this.repository.createStore({
      storeId,
      browserProfileId,
      displayName,
      marketplace,
      currency,
      businessTimezone,
    });
  }

  updateStore(input: UpdateStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input?.storeId);
    this.requireStore(storeId);
    const patch = input?.patch ?? {};
    const normalizedPatch: UpdateStoreInput['patch'] = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'displayName')) {
      normalizedPatch.displayName = normalizeDisplayName(patch.displayName);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'businessTimezone')) {
      normalizedPatch.businessTimezone = normalizeBusinessTimezone(patch.businessTimezone);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
      if (patch.status !== 'active' && patch.status !== 'inactive') {
        throw new StoreCoordinatorError('INVALID_STORE_STATUS', 'status must be active or inactive');
      }
      normalizedPatch.status = patch.status;
    }
    if (Object.keys(normalizedPatch).length === 0) {
      throw new StoreCoordinatorError('EMPTY_STORE_PATCH', 'store update requires at least one field');
    }
    const updated = this.repository.transaction(() => {
      const result = this.repository.updateStore({
        storeId,
        patch: normalizedPatch,
        expectedUpdatedAt: input.expectedUpdatedAt,
      });
      this.sessions.advance(storeId);
      return result;
    });
    if (this.activeStoreId === storeId && updated.status !== 'active') {
      this.activeStoreId = null;
    }
    return updated;
  }

  archiveStore(input: ArchiveStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input?.storeId);
    this.requireStore(storeId);
    const wasActive = this.activeStoreId === storeId;
    const archived = this.repository.transaction(() => {
      const result = this.repository.archiveStore({ ...input, storeId });
      if (wasActive) this.sessions.advance(storeId);
      return result;
    });
    if (wasActive) {
      this.activeStoreId = null;
    }
    return archived;
  }

  restoreStore(input: RestoreStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input?.storeId);
    this.requireStore(storeId);
    return this.repository.restoreStore({ ...input, storeId });
  }

  createConnection(input: CreateStoreConnectionInput): StoreConnection {
    const storeId = normalizeStoreId(input?.storeId);
    this.requireActiveStore(storeId);
    return this.repository.transaction(() => {
      const connection = this.repository.createConnection({
        storeId,
        id: normalizeStoreCapabilityId(this.createStoreCapabilityId()),
        provider: input?.provider,
        accountLabel: input?.accountLabel,
        externalAccountId: input?.externalAccountId,
      });
      this.sessions.advance(storeId);
      return connection;
    });
  }

  updateConnection(input: UpdateStoreConnectionInput): StoreConnection {
    const storeId = normalizeStoreId(input?.storeId);
    this.requireActiveStore(storeId);
    return this.repository.transaction(() => {
      const connection = this.repository.updateConnection({
        id: input?.id,
        storeId,
        accountLabel: input?.accountLabel,
        externalAccountId: input?.externalAccountId,
      });
      this.sessions.advance(storeId);
      return connection;
    });
  }

  removeConnection(input: RemoveStoreConnectionInput): void {
    const storeId = normalizeStoreId(input?.storeId);
    this.requireActiveStore(storeId);
    this.repository.transaction(() => {
      this.repository.removeConnection({ id: input?.id, storeId });
      this.sessions.advance(storeId);
    });
  }

  switchStore(storeIdInput: unknown): StoreWorkspaceView {
    const storeId = normalizeStoreId(storeIdInput);
    const store = this.requireActiveStore(storeId);
    const storesToAdvance = this.activeStoreId && this.activeStoreId !== storeId
      ? [this.activeStoreId, storeId]
      : [storeId];
    const advanced = this.sessions.advanceMany(storesToAdvance);
    const sessionGeneration = advanced.get(storeId)!;
    this.activeStoreId = storeId;
    return this.buildWorkspaceView(store, sessionGeneration);
  }

  reconnectStore(storeIdInput: unknown): StoreWorkspaceView {
    const storeId = normalizeStoreId(storeIdInput);
    const store = this.requireActiveStore(storeId);
    if (!this.activeStoreId || this.activeStoreId !== storeId) {
      throw new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'only the active store can reconnect its browser session',
      );
    }
    const sessionGeneration = this.sessions.advance(storeId);
    return this.buildWorkspaceView(store, sessionGeneration);
  }

  invalidateStoreSession(storeIdInput: unknown): StoreContextEnvelope {
    const storeId = normalizeStoreId(storeIdInput);
    const store = this.requireActiveStore(storeId);
    if (!this.activeStoreId || this.activeStoreId !== storeId) {
      throw new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'only the active store session can be invalidated',
      );
    }
    return this.buildContext(store, this.sessions.advance(storeId));
  }

  getActiveStoreContext(): StoreContextEnvelope | null {
    if (!this.activeStoreId) return null;
    const store = this.requireActiveStore(this.activeStoreId);
    return this.buildContext(store, this.sessions.current(store.storeId));
  }

  getActiveStoreWorkspaceView(): StoreWorkspaceView | null {
    if (!this.activeStoreId) return null;
    const store = this.requireActiveStore(this.activeStoreId);
    return this.buildWorkspaceView(store, this.sessions.current(store.storeId));
  }

  /** Validate a captured store context without rebinding it to the current UI. */
  assertStoreContext(value: unknown): StoreContextEnvelope {
    const context = normalizeStoreContextEnvelope(value);
    const store = this.requireActiveStore(context.storeId);
    if (
      context.browserProfileId !== store.browserProfileId
      || context.marketplace !== store.marketplace
      || context.currency !== store.currency
      || context.businessTimezone !== store.businessTimezone
      || context.businessDate !== businessDateFor(this.now(), store.businessTimezone)
    ) {
      throw new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'store context no longer matches Main-process store authority',
      );
    }
    try {
      this.sessions.assertCurrent(context);
    } catch (error) {
      throw new StoreCoordinatorError(
        'STALE_STORE_CONTEXT',
        error instanceof Error ? error.message : 'store context session generation is stale',
      );
    }
    return context;
  }

  /** Renderer commands must also match the currently selected store. */
  assertActiveStoreContext(value: unknown): StoreContextEnvelope {
    const context = this.assertStoreContext(value);
    if (!this.activeStoreId || context.storeId !== this.activeStoreId) {
      throw new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'renderer store context does not match the active store',
      );
    }
    return context;
  }

  private buildWorkspaceView(store: StoreRecord, sessionGeneration: number): StoreWorkspaceView {
    return {
      store,
      context: this.buildContext(store, sessionGeneration),
      connections: this.repository.listConnections(store.storeId),
      sessions: this.repository.listSessionMetadata(store.storeId),
    };
  }

  private buildContext(store: StoreRecord, sessionGeneration: number): StoreContextEnvelope {
    return normalizeStoreContextEnvelope({
      storeId: store.storeId,
      browserProfileId: store.browserProfileId,
      marketplace: store.marketplace,
      currency: store.currency,
      businessTimezone: store.businessTimezone,
      businessDate: businessDateFor(this.now(), store.businessTimezone),
      sessionGeneration,
    });
  }

  private requireStore(storeId: StoreId): StoreRecord {
    const store = this.repository.getStore(storeId);
    if (!store) {
      throw new StoreCoordinatorError('STORE_NOT_FOUND', `store ${storeId} was not found`);
    }
    return store;
  }

  private requireActiveStore(storeId: StoreId): StoreRecord {
    const store = this.requireStore(storeId);
    if (store.status !== 'active') {
      throw new StoreCoordinatorError('STORE_NOT_ACTIVE', `store ${storeId} is not active`);
    }
    return store;
  }
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new StoreCoordinatorError('INVALID_DISPLAY_NAME', 'displayName is required');
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < 1 || normalized.length > 120) {
    throw new StoreCoordinatorError(
      'INVALID_DISPLAY_NAME',
      'displayName must contain 1-120 characters',
    );
  }
  return normalized;
}

function businessDateFor(now: Date, timeZone: string): BusinessDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}` as BusinessDate;
}
