import { randomUUID } from 'crypto';
import type {
  ArchiveStoreInput,
  BrowserProfileId,
  BusinessDate,
  CreateStoreConnectionInput,
  CreateStoreInput,
  ListStoresInput,
  OperatorWorkspaceSelection,
  RestoreStoreInput,
  RemoveStoreConnectionInput,
  StoreCapabilityId,
  StoreConnection,
  StoreContextEnvelope,
  StoreId,
  StoreRecord,
  StoreScopeRef,
  StoreSessionMetadata,
  StoreWorkspaceView,
  UpdateStoreConnectionInput,
  UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';
import {
  DEFAULT_US_BUSINESS_TIMEZONE,
  normalizeBrowserProfileId,
  normalizeBusinessTimezone,
  normalizeOperatorWorkspaceSelection,
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
  /** Account-label or external-account identity changes clear verified/session state atomically. */
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
 * Logical operator selection stored in the same authority database as stores
 * and generations. Production implementations must participate in the
 * StoreAuthorityRepository transaction that surrounds write/clear.
 */
export interface OperatorWorkspaceSelectionStorage {
  read(): unknown;
  write(selection: OperatorWorkspaceSelection): void;
  clear(): void;
}

declare const collectionTransitionCapabilityBrand: unique symbol;
export type StoreCoordinatorCollectionTransitionCapability = Readonly<object> & {
  readonly [collectionTransitionCapabilityBrand]: 'StoreCoordinatorCollectionTransitionCapability';
};

export interface StoreCoordinatorAuthorityReadback {
  activeStoreId: StoreId | null;
  context: StoreContextEnvelope | null;
}

export interface StoreCoordinatorCollectionTransitionTarget {
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  marketplace: 'US';
  currency: 'USD';
  businessTimezone: typeof DEFAULT_US_BUSINESS_TIMEZONE;
}

export interface StoreCoordinatorCollectionTransitionReceipt {
  capability: StoreCoordinatorCollectionTransitionCapability;
  reason: 'collection_automation';
  mode: 'collection_only';
  previous: StoreCoordinatorAuthorityReadback;
  current: StoreCoordinatorAuthorityReadback;
  targetGenerationBefore: number | null;
  targetGenerationAfter: number | null;
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
  selectionStorage?: OperatorWorkspaceSelectionStorage;
  /** Package-UI evidence may select in memory but must never write app_settings. */
  selectionPersistence?: 'read_write' | 'read_only' | 'memory_only';
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
      | 'STORE_CONTEXT_MISMATCH'
      | 'INVALID_COLLECTION_CAPABILITY'
      | 'INVALID_COLLECTION_TARGET'
      | 'DUPLICATE_BROWSER_PROFILE',
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
  private readonly selectionStorage: OperatorWorkspaceSelectionStorage;
  private readonly selectionPersistence: 'read_write' | 'read_only' | 'memory_only';
  private readonly collectionTransitionCapabilities = new WeakSet<object>();
  private activeStoreId: StoreId | null = null;
  private operatorSelection: OperatorWorkspaceSelection | null = null;

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
    let memorySelection: OperatorWorkspaceSelection | null = null;
    this.selectionStorage = options.selectionStorage ?? {
      read: () => memorySelection,
      write: (selection) => { memorySelection = selection; },
      clear: () => { memorySelection = null; },
    };
    this.selectionPersistence = options.selectionPersistence ?? 'read_write';
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

  /** Main-only lookup used for provider-aware mutation preflight. */
  getConnection(storeIdInput: unknown, connectionIdInput: unknown): StoreConnection | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    const connectionId = normalizeStoreCapabilityId(connectionIdInput);
    this.requireStore(storeId);
    return this.repository.listConnections(storeId)
      .find((connection) => connection.id === connectionId);
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
    const before = this.requireStore(storeId);
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
    const changesAuthority = (
      normalizedPatch.businessTimezone !== undefined
      && normalizedPatch.businessTimezone !== before.businessTimezone
    ) || (
      normalizedPatch.status !== undefined
      && normalizedPatch.status !== before.status
    );
    const clearsSelection = this.operatorSelection?.storeId === storeId
      && normalizedPatch.status === 'inactive';
    const updated = this.repository.transaction(() => {
      const result = this.repository.updateStore({
        storeId,
        patch: normalizedPatch,
        expectedUpdatedAt: input.expectedUpdatedAt,
      });
      if (changesAuthority) this.sessions.advance(storeId);
      if (clearsSelection) {
        this.clearPersistedSelection();
      }
      return result;
    });
    if (clearsSelection) this.operatorSelection = null;
    if (this.activeStoreId === storeId && updated.status !== 'active') {
      this.activeStoreId = null;
    }
    return updated;
  }

  archiveStore(input: ArchiveStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input?.storeId);
    const before = this.requireStore(storeId);
    const wasActive = this.activeStoreId === storeId;
    const wasSelected = this.operatorSelection?.storeId === storeId;
    const archived = this.repository.transaction(() => {
      const result = this.repository.archiveStore({ ...input, storeId });
      if (before.status !== 'archived') this.sessions.advance(storeId);
      if (wasSelected) {
        this.clearPersistedSelection();
      }
      return result;
    });
    if (wasSelected) this.operatorSelection = null;
    if (wasActive) {
      this.activeStoreId = null;
    }
    return archived;
  }

  restoreStore(input: RestoreStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input?.storeId);
    const before = this.requireStore(storeId);
    return this.repository.transaction(() => {
      const restored = this.repository.restoreStore({ ...input, storeId });
      if (before.status !== restored.status) this.sessions.advance(storeId);
      return restored;
    });
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
        collectionStoreName: input?.collectionStoreName,
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
        collectionStoreName: input?.collectionStoreName,
        expectedUpdatedAt: input?.expectedUpdatedAt,
      });
      this.sessions.advance(storeId);
      return connection;
    });
  }

  removeConnection(input: RemoveStoreConnectionInput): void {
    const storeId = normalizeStoreId(input?.storeId);
    this.requireActiveStore(storeId);
    this.repository.transaction(() => {
      this.repository.removeConnection({
        id: input?.id,
        storeId,
        expectedUpdatedAt: input?.expectedUpdatedAt,
      });
      this.sessions.advance(storeId);
    });
  }

  switchStore(scopeInput: StoreScopeRef | StoreId): StoreWorkspaceView {
    const scope = normalizeStoreScopeRefForCoordinator(scopeInput);
    const previousActiveStoreId = this.activeStoreId;
    const selectedAt = this.now().toISOString();
    const selection: OperatorWorkspaceSelection = Object.freeze({
      schemaVersion: 1,
      storeId: scope.storeId,
      marketplace: scope.marketplace,
      selectedAt,
    });
    const view = this.repository.transaction(() => {
      // Re-read inside the transaction immediately before any write. Renderer
      // scope is a selector, never authority.
      const store = this.requireActiveStore(scope.storeId);
      this.assertStoreMatchesScope(store, scope);
      const storesToAdvance = previousActiveStoreId && previousActiveStoreId !== scope.storeId
        ? [previousActiveStoreId, scope.storeId]
        : [scope.storeId];
      const advanced = this.sessions.advanceMany(storesToAdvance);
      const workspace = this.buildWorkspaceView(store, advanced.get(scope.storeId)!);
      this.persistSelection(selection);
      return workspace;
    });
    this.activeStoreId = scope.storeId;
    this.operatorSelection = selection;
    return view;
  }

  /** Durable logical choice; automation authority transitions never update it. */
  getOperatorWorkspaceSelection(): OperatorWorkspaceSelection | null {
    return this.operatorSelection ? Object.freeze({ ...this.operatorSelection }) : null;
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

  /**
   * Main-only collection transition capability. This method is intentionally
   * absent from the Renderer IPC surface. Capabilities are object-identity
   * bound, one-shot, and cannot be reconstructed from serialized input.
   */
  issueCollectionTransitionCapability(): StoreCoordinatorCollectionTransitionCapability {
    const capability = Object.freeze({}) as StoreCoordinatorCollectionTransitionCapability;
    this.collectionTransitionCapabilities.add(capability);
    return capability;
  }

  /** Read the exact Main authority without exposing workspace or connection data. */
  getCollectionAuthority(): StoreCoordinatorAuthorityReadback {
    const context = this.getActiveStoreContext();
    return {
      activeStoreId: context?.storeId ?? null,
      context: context ? normalizeStoreContextEnvelope(context) : null,
    };
  }

  /**
   * Collection-only Store/Profile authority transition. It advances the
   * durable generation of both the previous and target stores in one
   * `advanceMany` call; same-target transitions are deduplicated but still
   * advance once. The in-memory active authority changes only after that
   * atomic generation operation succeeds.
   */
  transitionForCollection(input: {
    capability: StoreCoordinatorCollectionTransitionCapability;
    reason: 'collection_automation';
    mode: 'collection_only';
    previous: StoreCoordinatorAuthorityReadback;
    target: StoreCoordinatorCollectionTransitionTarget | null;
  }): StoreCoordinatorCollectionTransitionReceipt {
    if (!input
      || input.reason !== 'collection_automation'
      || input.mode !== 'collection_only'
      || !input.capability
      || typeof input.capability !== 'object'
      || !this.collectionTransitionCapabilities.has(input.capability)) {
      throw new StoreCoordinatorError(
        'INVALID_COLLECTION_CAPABILITY',
        'collection-only transition requires a live Main capability',
      );
    }
    // Consume before validation so a failed or adversarial call cannot replay
    // the same authority token against a changed active context.
    this.collectionTransitionCapabilities.delete(input.capability);

    const previous = this.normalizeCollectionAuthority(input.previous);
    const actualPrevious = this.getCollectionAuthority();
    if (!sameCollectionAuthority(previous, actualPrevious)) {
      throw new StoreCoordinatorError(
        'STALE_STORE_CONTEXT',
        'collection-only previous authority is stale or does not match Main',
      );
    }
    const targetStore = input.target === null
      ? null
      : this.requireCollectionTarget(input.target);
    const targetGenerationBefore = targetStore
      ? this.sessions.current(targetStore.storeId)
      : null;
    const storesToAdvance = [...new Set([
      ...(actualPrevious.activeStoreId ? [actualPrevious.activeStoreId] : []),
      ...(targetStore ? [targetStore.storeId] : []),
    ])];
    const advanced = this.sessions.advanceMany(storesToAdvance);
    const targetGenerationAfter = targetStore
      ? advanced.get(targetStore.storeId)!
      : null;
    this.activeStoreId = targetStore?.storeId ?? null;
    const current = targetStore
      ? {
          activeStoreId: targetStore.storeId,
          context: this.buildContext(targetStore, targetGenerationAfter!),
        }
      : { activeStoreId: null, context: null };
    return {
      capability: input.capability,
      reason: 'collection_automation',
      mode: 'collection_only',
      previous: actualPrevious,
      current,
      targetGenerationBefore,
      targetGenerationAfter,
    };
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

  private assertStoreMatchesScope(store: StoreRecord, scope: StoreScopeRef): void {
    if (store.storeId !== scope.storeId || store.marketplace !== scope.marketplace) {
      throw new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'store scope marketplace does not match Main-process store authority',
      );
    }
  }

  private persistSelection(selection: OperatorWorkspaceSelection): void {
    if (this.selectionPersistence === 'read_only') {
      throw new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'operator workspace selection is read-only in this runtime',
      );
    }
    if (this.selectionPersistence === 'read_write') {
      this.selectionStorage.write(selection);
    }
  }

  private clearPersistedSelection(): void {
    if (this.selectionPersistence === 'read_only') {
      throw new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'operator workspace selection is read-only in this runtime',
      );
    }
    if (this.selectionPersistence === 'read_write') {
      this.selectionStorage.clear();
    }
  }

  /**
   * Startup-only restore point. Main calls this after durable collection and
   * execution recovery confirms, so an operator selection cannot pre-empt the
   * startup automation authority lane.
   */
  restoreOperatorWorkspaceSelectionAfterRecovery(): OperatorWorkspaceSelection | null {
    if (this.operatorSelection) return this.getOperatorWorkspaceSelection();
    let persisted: unknown;
    try {
      persisted = this.selectionStorage.read();
    } catch {
      // A storage read failure is an unknown authority state. Do not guess a
      // different store even if only one row currently looks active.
      return null;
    }
    if (persisted !== null && persisted !== undefined) {
      try {
        const selection = normalizeOperatorWorkspaceSelection(persisted);
        const store = this.repository.getStore(selection.storeId);
        if (!store || !isSelectableOperatorStore(store)) return null;
        this.assertStoreMatchesScope(store, selection);
        if (this.activeStoreId && this.activeStoreId !== store.storeId) return null;
        this.activeStoreId = store.storeId;
        this.operatorSelection = selection;
      } catch {
        // Corrupt, stale, inactive or cross-marketplace selections stay
        // unresolved. Startup must not silently choose another store.
      }
      return this.getOperatorWorkspaceSelection();
    }

    // No persisted operator choice means no operator authority, even when only
    // one active Store exists. Creation and startup recovery must never behave
    // like an implicit switch or advance that Store's session generation.
    return null;
  }

  private normalizeCollectionAuthority(value: unknown): StoreCoordinatorAuthorityReadback {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new StoreCoordinatorError('STORE_CONTEXT_MISMATCH', 'collection authority must be an object');
    }
    const candidate = value as Partial<StoreCoordinatorAuthorityReadback>;
    if (candidate.activeStoreId === null) {
      if (candidate.context !== null) {
        throw new StoreCoordinatorError(
          'STORE_CONTEXT_MISMATCH',
          'null collection authority cannot carry a StoreContext',
        );
      }
      return { activeStoreId: null, context: null };
    }
    const activeStoreId = normalizeStoreId(candidate.activeStoreId);
    const context = normalizeStoreContextEnvelope(candidate.context);
    const store = this.requireCollectionStore(activeStoreId);
    if (context.storeId !== store.storeId
      || context.browserProfileId !== store.browserProfileId
      || context.marketplace !== 'US'
      || context.currency !== 'USD'
      || context.businessTimezone !== DEFAULT_US_BUSINESS_TIMEZONE) {
      throw new StoreCoordinatorError(
        'STORE_CONTEXT_MISMATCH',
        'collection authority does not match the authoritative US/USD/LA Store/Profile',
      );
    }
    return { activeStoreId, context };
  }

  private requireCollectionTarget(
    targetInput: StoreCoordinatorCollectionTransitionTarget,
  ): StoreRecord {
    if (!targetInput || typeof targetInput !== 'object') {
      throw new StoreCoordinatorError('INVALID_COLLECTION_TARGET', 'collection target is required');
    }
    const storeId = normalizeStoreId(targetInput.storeId);
    const browserProfileId = normalizeBrowserProfileId(targetInput.browserProfileId);
    const store = this.requireCollectionStore(storeId);
    if (targetInput.marketplace !== 'US'
      || targetInput.currency !== 'USD'
      || targetInput.businessTimezone !== DEFAULT_US_BUSINESS_TIMEZONE
      || browserProfileId !== store.browserProfileId) {
      throw new StoreCoordinatorError(
        'INVALID_COLLECTION_TARGET',
        'collection target must exactly match its US/USD/LA Store/Profile authority',
      );
    }
    return store;
  }

  private requireCollectionStore(storeId: StoreId): StoreRecord {
    const store = this.requireActiveStore(storeId);
    if (store.marketplace !== 'US'
      || store.currency !== 'USD'
      || store.businessTimezone !== DEFAULT_US_BUSINESS_TIMEZONE
      || normalizeBrowserProfileId(store.browserProfileId) !== store.browserProfileId) {
      throw new StoreCoordinatorError(
        'INVALID_COLLECTION_TARGET',
        'collection-only authority supports exact US/USD/America/Los_Angeles stores only',
      );
    }
    const duplicateProfile = this.repository.listStores({ statuses: ['active'] })
      .some((candidate) => (
        candidate.status === 'active'
        && candidate.storeId !== store.storeId
        && candidate.browserProfileId === store.browserProfileId
      ));
    if (duplicateProfile) {
      throw new StoreCoordinatorError(
        'DUPLICATE_BROWSER_PROFILE',
        `browser profile ${store.browserProfileId} is bound to more than one active store`,
      );
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

function normalizeStoreScopeRefForCoordinator(
  value: StoreScopeRef | StoreId,
): StoreScopeRef {
  // Main-only callers from older internal tests may pass an already-canonical
  // StoreId. Renderer IPC never receives this compatibility branch: it parses
  // an explicit {storeId, marketplace} before calling the coordinator.
  if (typeof value === 'string') {
    return Object.freeze({
      storeId: normalizeStoreId(value),
      marketplace: normalizeUsMarketplace('US'),
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoreCoordinatorError('STORE_CONTEXT_MISMATCH', 'store scope must be an object');
  }
  if (value.marketplace === undefined) {
    throw new StoreCoordinatorError(
      'STORE_CONTEXT_MISMATCH',
      'store scope marketplace is required',
    );
  }
  return Object.freeze({
    storeId: normalizeStoreId(value.storeId),
    marketplace: normalizeUsMarketplace(value.marketplace),
  });
}

function isSelectableOperatorStore(store: StoreRecord): boolean {
  try {
    return store.status === 'active'
      && store.marketplace === 'US'
      && store.currency === 'USD'
      && store.businessTimezone === DEFAULT_US_BUSINESS_TIMEZONE
      && normalizeStoreId(store.storeId) === store.storeId
      && normalizeBrowserProfileId(store.browserProfileId) === store.browserProfileId;
  } catch {
    return false;
  }
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

function sameCollectionAuthority(
  left: StoreCoordinatorAuthorityReadback,
  right: StoreCoordinatorAuthorityReadback,
): boolean {
  if (left.activeStoreId !== right.activeStoreId) return false;
  if (left.context === null || right.context === null) return left.context === right.context;
  const leftContext = normalizeStoreContextEnvelope(left.context);
  const rightContext = normalizeStoreContextEnvelope(right.context);
  return leftContext.storeId === rightContext.storeId
    && leftContext.browserProfileId === rightContext.browserProfileId
    && leftContext.marketplace === rightContext.marketplace
    && leftContext.currency === rightContext.currency
    && leftContext.businessTimezone === rightContext.businessTimezone
    && leftContext.businessDate === rightContext.businessDate
    && leftContext.sessionGeneration === rightContext.sessionGeneration;
}
