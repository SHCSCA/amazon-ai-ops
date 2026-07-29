import type { Database } from 'better-sqlite3';
import {
  DEFAULT_US_BUSINESS_TIMEZONE,
  normalizeBrowserProfileId,
  normalizeBusinessTimezone,
  normalizeSessionGeneration,
  normalizeStoreCapabilityId,
  normalizeStoreId,
  normalizeUsdCurrency,
  normalizeUsMarketplace,
  type ArchiveStoreInput,
  type BrowserProfileId,
  type CreateStoreConnectionInput,
  type CreateStoreInput,
  type ListStoresInput,
  type RemoveStoreConnectionInput,
  type RestoreStoreInput,
  type StoreCapabilityId,
  type StoreConnection,
  type StoreConnectionProvider,
  type StoreConnectionStatus,
  type StoreId,
  type StoreRecord,
  type StoreSessionMetadata,
  type StoreSessionStatus,
  type StoreStatus,
  type UpdateStoreConnectionInput,
  type UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';
import {
  STORE_AUTHORITY_MIGRATION_VERSION,
  STORE_SCOPED_LEGACY_TABLES,
  getStoreMigrationRecoveryPreflight,
  getUpgradeBackupRecoveryPreflight,
  restoreStoreMigrationBackupTo,
  restoreUpgradeBackupTo,
  upgradeBackupFromMigrationManifest,
  type SchemaMigrationRecord,
  type SchemaMigrationManifest,
  type StoreMigrationManifest,
  type StoreMigrationQuarantineReason,
  type StoreMigrationQuarantineRecord,
  type StoreMigrationRecoveryPreflight,
  type StoreMigrationRestoreResult,
  type StoreMigrationResult,
} from '../migrations';

export interface CreateStoreRecordInput extends CreateStoreInput {
  storeId: StoreId;
  browserProfileId: BrowserProfileId;
  status?: Exclude<StoreStatus, 'archived'>;
}

export interface CreateStoreConnectionRecordInput extends CreateStoreConnectionInput {
  id: StoreCapabilityId;
  status?: StoreConnectionStatus;
  lastVerifiedAt?: string;
  lastFailureCode?: string;
}

export interface UpdateStoreConnectionRecordInput extends UpdateStoreConnectionInput {
  status?: StoreConnectionStatus;
  lastVerifiedAt?: string;
  lastFailureCode?: string;
}

export interface StoreArchivePreflight {
  storeId: StoreId;
  canArchive: boolean;
  alreadyArchived: boolean;
  scopedRowCounts: Record<string, number>;
  sessionProvidersToInvalidate: StoreConnectionProvider[];
  blockers: string[];
}

export interface StoreRestorePreflight {
  storeId: StoreId;
  canRestore: boolean;
  alreadyActive: boolean;
  blockers: string[];
}

export interface StoreMigrationQuarantineFilter {
  migrationVersion?: number;
  status?: 'pending' | 'resolved';
  sourceTable?: string;
}

export interface ResolveStoreMigrationQuarantineInput {
  quarantineId: number;
  storeId: StoreId;
  resolutionNote: string;
}

export type StoreRepositoryErrorCode =
  | 'STORE_NOT_FOUND'
  | 'STORE_ALREADY_EXISTS'
  | 'STORE_ARCHIVED'
  | 'STORE_NOT_ACTIVE'
  | 'STORE_CONFLICT'
  | 'INVALID_STORE_INPUT'
  | 'CONNECTION_NOT_FOUND'
  | 'SESSION_GENERATION_STALE'
  | 'SESSION_PROFILE_MISMATCH'
  | 'MIGRATION_NOT_FOUND'
  | 'QUARANTINE_NOT_FOUND'
  | 'QUARANTINE_ALREADY_RESOLVED'
  | 'QUARANTINE_TARGET_CONFLICT';

export class StoreRepositoryError extends Error {
  readonly code: StoreRepositoryErrorCode;

  constructor(code: StoreRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'StoreRepositoryError';
    this.code = code;
  }
}

export class StoreRepository {
  constructor(private readonly db: Database) {}

  transaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }

  createStore(input: CreateStoreRecordInput): StoreRecord {
    const storeId = normalizeStoreId(input.storeId);
    const browserProfileId = normalizeBrowserProfileId(input.browserProfileId);
    const displayName = normalizeDisplayName(input.displayName);
    const marketplace = normalizeUsMarketplace(input.marketplace);
    const currency = normalizeUsdCurrency(input.currency);
    const businessTimezone = normalizeBusinessTimezone(
      input.businessTimezone ?? DEFAULT_US_BUSINESS_TIMEZONE,
    );
    const status = input.status ?? 'active';
    if (status !== 'active' && status !== 'inactive') {
      throw new StoreRepositoryError('INVALID_STORE_INPUT', 'A new store must be active or inactive.');
    }
    const now = new Date().toISOString();

    try {
      this.db.prepare(`
        INSERT INTO stores (
          store_id, browser_profile_id, marketplace, currency, display_name,
          status, business_timezone, created_at, updated_at, archived_at
        ) VALUES (
          @storeId, @browserProfileId, @marketplace, @currency, @displayName,
          @status, @businessTimezone, @createdAt, @updatedAt, NULL
        )
      `).run({
        storeId,
        browserProfileId,
        marketplace,
        currency,
        displayName,
        status,
        businessTimezone,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isSqliteConstraint(error)) {
        throw new StoreRepositoryError(
          'STORE_ALREADY_EXISTS',
          'The store id or browser profile is already bound to another store.',
        );
      }
      throw error;
    }
    return this.requireStore(storeId);
  }

  getStore(storeIdInput: StoreId): StoreRecord | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    const row = this.db.prepare('SELECT * FROM stores WHERE store_id = ?').get(storeId) as StoreRow | undefined;
    return row ? mapStore(row) : undefined;
  }

  listStores(input: ListStoresInput = {}): StoreRecord[] {
    const requestedStatuses = input.statuses ? [...new Set(input.statuses)] : undefined;
    const statuses = requestedStatuses?.length
      ? requestedStatuses
      : (input.includeArchived ? undefined : ['active', 'inactive'] as StoreStatus[]);
    if (!statuses) {
      return (this.db.prepare(`
        SELECT * FROM stores
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,
                 lower(display_name), store_id
      `).all() as StoreRow[]).map(mapStore);
    }
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(', ');
    return (this.db.prepare(`
      SELECT * FROM stores
      WHERE status IN (${placeholders})
      ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,
               lower(display_name), store_id
    `).all(...statuses) as StoreRow[]).map(mapStore);
  }

  updateStore(input: UpdateStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input.storeId);
    const existing = this.requireStore(storeId);
    if (existing.status === 'archived') {
      throw new StoreRepositoryError('STORE_ARCHIVED', 'Restore an archived store before editing it.');
    }
    assertExpectedUpdatedAt(existing, input.expectedUpdatedAt);

    const fields: string[] = [];
    const params: Record<string, unknown> = {
      storeId,
      expectedRevision: existing.updatedAt,
      updatedAt: nextTimestamp(existing.updatedAt),
    };
    if (input.patch.displayName !== undefined) {
      fields.push('display_name = @displayName');
      params.displayName = normalizeDisplayName(input.patch.displayName);
    }
    if (input.patch.businessTimezone !== undefined) {
      fields.push('business_timezone = @businessTimezone');
      params.businessTimezone = normalizeBusinessTimezone(input.patch.businessTimezone);
    }
    if (input.patch.status !== undefined) {
      if (input.patch.status !== 'active' && input.patch.status !== 'inactive') {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Use archiveStore to archive a store.');
      }
      fields.push('status = @status');
      params.status = input.patch.status;
    }
    if (fields.length === 0) {
      throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Store update patch cannot be empty.');
    }
    fields.push('updated_at = @updatedAt');
    const updated = this.db.prepare(`
      UPDATE stores
      SET ${fields.join(', ')}
      WHERE store_id = @storeId
        AND updated_at = @expectedRevision
        AND status <> 'archived'
    `).run(params);
    if (updated.changes !== 1) {
      throw new StoreRepositoryError(
        'STORE_CONFLICT',
        `Store ${storeId} changed after it was read; reload before retrying.`,
      );
    }
    return this.requireStore(storeId);
  }

  getArchivePreflight(storeIdInput: StoreId): StoreArchivePreflight {
    const store = this.requireStore(normalizeStoreId(storeIdInput));
    const scopedRowCounts: Record<string, number> = {};
    for (const table of STORE_SCOPED_LEGACY_TABLES) {
      if (!this.tableHasColumn(table, 'store_id')) continue;
      scopedRowCounts[table] = Number((this.db.prepare(`
        SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)} WHERE store_id = ?
      `).get(store.storeId) as { count: number }).count);
    }
    const sessionProvidersToInvalidate = (this.db.prepare(`
      SELECT provider
      FROM store_session_metadata
      WHERE store_id = ? AND status IN ('checking', 'ready')
      ORDER BY provider
    `).all(store.storeId) as Array<{ provider: StoreConnectionProvider }>).map((row) => row.provider);
    return {
      storeId: store.storeId,
      canArchive: true,
      alreadyArchived: store.status === 'archived',
      scopedRowCounts,
      sessionProvidersToInvalidate,
      blockers: [],
    };
  }

  archiveStore(input: ArchiveStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input.storeId);
    const archive = this.db.transaction(() => {
      const existing = this.requireStore(storeId);
      assertExpectedUpdatedAt(existing, input.expectedUpdatedAt);
      if (existing.status === 'archived') return existing;
      const now = nextTimestamp(existing.updatedAt);
      this.db.prepare(`
        UPDATE stores
        SET status = 'archived', archived_at = @archivedAt, updated_at = @updatedAt
        WHERE store_id = @storeId
      `).run({ storeId, archivedAt: now, updatedAt: now });
      this.db.prepare(`
        UPDATE store_session_metadata
        SET status = 'signed_out',
            session_generation = session_generation + 1,
            observed_at = @observedAt,
            updated_at = @updatedAt
        WHERE store_id = @storeId
      `).run({ storeId, observedAt: now, updatedAt: now });
      this.db.prepare(`
        UPDATE store_connections
        SET status = CASE
              WHEN status = 'not_configured' THEN status
              ELSE 'attention_required'
            END,
            last_failure_code = CASE
              WHEN status = 'not_configured' THEN last_failure_code
              ELSE 'store_archived'
            END,
            updated_at = @updatedAt
        WHERE store_id = @storeId
      `).run({ storeId, updatedAt: now });
      return this.requireStore(storeId);
    });
    return archive();
  }

  /** V1 delete semantics are deliberately recoverable archival. */
  deleteStore(input: ArchiveStoreInput): StoreRecord {
    return this.archiveStore(input);
  }

  getRestorePreflight(storeIdInput: StoreId): StoreRestorePreflight {
    const store = this.requireStore(normalizeStoreId(storeIdInput));
    const blockers: string[] = [];
    const profileOwner = this.db.prepare(`
      SELECT store_id
      FROM stores
      WHERE lower(browser_profile_id) = lower(?)
        AND store_id <> ?
        AND status <> 'archived'
      LIMIT 1
    `).get(store.browserProfileId, store.storeId) as { store_id: string } | undefined;
    if (profileOwner) {
      blockers.push(`Browser profile is already active for store ${profileOwner.store_id}.`);
    }
    return {
      storeId: store.storeId,
      canRestore: blockers.length === 0,
      alreadyActive: store.status === 'active',
      blockers,
    };
  }

  restoreStore(input: RestoreStoreInput): StoreRecord {
    const storeId = normalizeStoreId(input.storeId);
    const restore = this.db.transaction(() => {
      const existing = this.requireStore(storeId);
      assertExpectedUpdatedAt(existing, input.expectedUpdatedAt);
      if (existing.status === 'active') return existing;
      if (existing.status !== 'archived') {
        throw new StoreRepositoryError(
          'STORE_CONFLICT',
          'Only an archived store can be restored; activate an inactive store through updateStore.',
        );
      }
      const preflight = this.getRestorePreflight(storeId);
      if (!preflight.canRestore) {
        throw new StoreRepositoryError('STORE_CONFLICT', preflight.blockers.join(' '));
      }
      this.db.prepare(`
        UPDATE stores
        SET status = 'active', archived_at = NULL, updated_at = @updatedAt
        WHERE store_id = @storeId
      `).run({ storeId, updatedAt: nextTimestamp(existing.updatedAt) });
      return this.requireStore(storeId);
    });
    return restore();
  }

  createConnection(input: CreateStoreConnectionRecordInput): StoreConnection {
    const id = normalizeStoreCapabilityId(input.id);
    const store = this.requireWritableStore(input.storeId);
    const provider = normalizeProvider(input.provider);
    const status = normalizeConnectionStatus(input.status ?? 'not_configured');
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO store_connections (
          id, store_id, provider, status, account_label, external_account_id,
          last_verified_at, last_failure_code, created_at, updated_at
        ) VALUES (
          @id, @storeId, @provider, @status, @accountLabel, @externalAccountId,
          @lastVerifiedAt, @lastFailureCode, @createdAt, @updatedAt
        )
      `).run({
        id,
        storeId: store.storeId,
        provider,
        status,
        accountLabel: nullableProviderIdentity(input.accountLabel, 'accountLabel'),
        externalAccountId: nullableProviderIdentity(input.externalAccountId, 'externalAccountId'),
        lastVerifiedAt: optionalTimestamp(input.lastVerifiedAt),
        lastFailureCode: nullableText(input.lastFailureCode),
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (isSqliteConstraint(error)) {
        throw new StoreRepositoryError(
          'STORE_CONFLICT',
          `Store ${store.storeId} already has a ${provider} connection or the capability id is in use.`,
        );
      }
      throw error;
    }
    return this.requireConnection(store.storeId, id);
  }

  updateConnection(input: UpdateStoreConnectionRecordInput): StoreConnection {
    const id = normalizeStoreCapabilityId(input.id);
    const store = this.requireWritableStore(input.storeId);
    const update = this.db.transaction(() => {
      const existing = this.requireConnection(store.storeId, id);
      const submittedAccountLabel = input.accountLabel === undefined
        ? existing.accountLabel ?? null
        : nullableProviderIdentity(input.accountLabel, 'accountLabel');
      const submittedExternalAccountId = input.externalAccountId === undefined
        ? existing.externalAccountId ?? null
        : nullableProviderIdentity(input.externalAccountId, 'externalAccountId');
      const accountLabelChanged = input.accountLabel !== undefined
        && submittedAccountLabel !== (existing.accountLabel ?? null);
      const externalAccountIdChanged = input.externalAccountId !== undefined
        && submittedExternalAccountId !== (existing.externalAccountId ?? null);
      const identityChanged = accountLabelChanged || externalAccountIdChanged;
      const fields: string[] = [];
      const params: Record<string, unknown> = {
        id,
        storeId: store.storeId,
        updatedAt: new Date().toISOString(),
      };
      if (input.accountLabel !== undefined) {
        fields.push('account_label = @accountLabel');
        params.accountLabel = submittedAccountLabel;
      }
      if (identityChanged) {
        if (!accountLabelChanged && externalAccountIdChanged) {
          fields.push('external_account_id = @externalAccountId');
          params.externalAccountId = submittedExternalAccountId;
        } else {
          fields.push('external_account_id = NULL');
        }
        fields.push(
          "status = 'not_configured'",
          'last_verified_at = NULL',
          'last_failure_code = NULL',
        );
      } else {
        for (const [inputKey, column] of [
          ['externalAccountId', 'external_account_id'],
          ['lastFailureCode', 'last_failure_code'],
        ] as const) {
          if (input[inputKey] !== undefined) {
            fields.push(`${column} = @${inputKey}`);
            params[inputKey] = inputKey === 'externalAccountId'
              ? nullableProviderIdentity(input[inputKey], 'externalAccountId')
              : nullableText(input[inputKey]);
          }
        }
        if (input.lastVerifiedAt !== undefined) {
          fields.push('last_verified_at = @lastVerifiedAt');
          params.lastVerifiedAt = optionalTimestamp(input.lastVerifiedAt);
        }
        if (input.status !== undefined) {
          fields.push('status = @status');
          params.status = normalizeConnectionStatus(input.status);
        }
      }
      if (fields.length === 0) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Connection update cannot be empty.');
      }
      fields.push('updated_at = @updatedAt');
      this.db.prepare(`
        UPDATE store_connections
        SET ${fields.join(', ')}
        WHERE id = @id AND store_id = @storeId
      `).run(params);
      if (identityChanged) {
        this.db.prepare(`
          DELETE FROM store_session_metadata
          WHERE store_id = ? AND provider = ?
        `).run(store.storeId, existing.provider);
      }
      return this.requireConnection(store.storeId, id);
    });
    return update();
  }

  getConnection(storeIdInput: StoreId, provider: StoreConnectionProvider): StoreConnection | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    const normalizedProvider = normalizeProvider(provider);
    const row = this.db.prepare(`
      SELECT * FROM store_connections WHERE store_id = ? AND provider = ?
    `).get(storeId, normalizedProvider) as ConnectionRow | undefined;
    return row ? this.mapConnection(row) : undefined;
  }

  listConnections(storeIdInput: StoreId): StoreConnection[] {
    const storeId = normalizeStoreId(storeIdInput);
    this.requireStore(storeId);
    return (this.db.prepare(`
      SELECT * FROM store_connections WHERE store_id = ? ORDER BY provider
    `).all(storeId) as ConnectionRow[]).map((row) => this.mapConnection(row));
  }

  removeConnection(input: RemoveStoreConnectionInput): void {
    const id = normalizeStoreCapabilityId(input.id);
    const storeId = normalizeStoreId(input.storeId);
    const store = this.requireWritableStore(storeId);
    const remove = this.db.transaction(() => {
      const connection = this.requireConnection(storeId, id);
      const now = new Date().toISOString();
      const tombstone = this.db.prepare(`
        INSERT INTO store_session_metadata (
          store_id, provider, browser_profile_id, status, session_generation,
          observed_at, account_label, external_account_id, verified_at,
          expires_at, failure_code, updated_at
        ) VALUES (
          @storeId, @provider, @browserProfileId, 'signed_out', 0,
          @observedAt, NULL, NULL, NULL,
          NULL, 'connection_removed', @updatedAt
        )
        ON CONFLICT(store_id, provider) DO UPDATE SET
          browser_profile_id = excluded.browser_profile_id,
          status = 'signed_out',
          session_generation = store_session_metadata.session_generation + 1,
          observed_at = excluded.observed_at,
          verified_at = NULL,
          expires_at = NULL,
          failure_code = 'connection_removed',
          updated_at = excluded.updated_at
        WHERE store_session_metadata.session_generation < @maxGeneration
        RETURNING session_generation
      `).get({
        storeId,
        provider: connection.provider,
        browserProfileId: store.browserProfileId,
        observedAt: now,
        updatedAt: now,
        maxGeneration: Number.MAX_SAFE_INTEGER,
      }) as { session_generation: number } | undefined;
      if (!tombstone) {
        throw new StoreRepositoryError(
          'SESSION_GENERATION_STALE',
          `Session generation for store ${storeId} cannot advance beyond ${Number.MAX_SAFE_INTEGER}.`,
        );
      }
      const result = this.db.prepare(`
        DELETE FROM store_connections WHERE id = ? AND store_id = ?
      `).run(id, storeId);
      if (result.changes !== 1) {
        throw new StoreRepositoryError('CONNECTION_NOT_FOUND', `Connection ${id} was not found.`);
      }
    });
    remove();
  }

  saveSessionMetadata(input: StoreSessionMetadata): StoreSessionMetadata {
    const store = this.requireWritableStore(input.storeId);
    const browserProfileId = normalizeBrowserProfileId(input.browserProfileId);
    if (browserProfileId !== store.browserProfileId) {
      throw new StoreRepositoryError(
        'SESSION_PROFILE_MISMATCH',
        'Session metadata browserProfileId does not match the store authority record.',
      );
    }
    const provider = normalizeProvider(input.provider);
    if (!this.getConnection(store.storeId, provider)) {
      throw new StoreRepositoryError(
        'CONNECTION_NOT_FOUND',
        `Store ${store.storeId} has no ${provider} connection binding.`,
      );
    }
    const status = normalizeSessionStatus(input.status);
    const sessionGeneration = normalizeSessionGeneration(input.sessionGeneration);
    const observedAt = requiredTimestamp(input.observedAt, 'observedAt');
    const previous = this.getSessionMetadata(store.storeId, provider);
    if (previous && sessionGeneration < previous.sessionGeneration) {
      throw new StoreRepositoryError(
        'SESSION_GENERATION_STALE',
        `Session generation ${sessionGeneration} is older than ${previous.sessionGeneration}.`,
      );
    }
    const now = new Date().toISOString();
    const saved = this.db.prepare(`
      INSERT INTO store_session_metadata (
        store_id, provider, browser_profile_id, status, session_generation,
        observed_at, account_label, external_account_id, verified_at,
        expires_at, failure_code, updated_at
      ) VALUES (
        @storeId, @provider, @browserProfileId, @status, @sessionGeneration,
        @observedAt, @accountLabel, @externalAccountId, @verifiedAt,
        @expiresAt, @failureCode, @updatedAt
      )
      ON CONFLICT(store_id, provider) DO UPDATE SET
        browser_profile_id = excluded.browser_profile_id,
        status = excluded.status,
        session_generation = excluded.session_generation,
        observed_at = excluded.observed_at,
        account_label = excluded.account_label,
        external_account_id = excluded.external_account_id,
        verified_at = excluded.verified_at,
        expires_at = excluded.expires_at,
        failure_code = excluded.failure_code,
        updated_at = excluded.updated_at
      WHERE excluded.session_generation >= store_session_metadata.session_generation
    `).run({
      storeId: store.storeId,
      provider,
      browserProfileId,
      status,
      sessionGeneration,
      observedAt,
      accountLabel: nullableProviderIdentity(input.accountLabel, 'accountLabel'),
      externalAccountId: nullableProviderIdentity(input.externalAccountId, 'externalAccountId'),
      verifiedAt: optionalTimestamp(input.verifiedAt),
      expiresAt: optionalTimestamp(input.expiresAt),
      failureCode: nullableText(input.failureCode),
      updatedAt: now,
    });
    if (saved.changes !== 1) {
      const current = this.getSessionMetadata(store.storeId, provider);
      throw new StoreRepositoryError(
        'SESSION_GENERATION_STALE',
        `Session generation ${sessionGeneration} is older than ${current?.sessionGeneration ?? 'the current value'}.`,
      );
    }
    return this.requireSessionMetadata(store.storeId, provider);
  }

  advanceSessionGeneration(
    storeIdInput: StoreId,
    providerInput: StoreConnectionProvider,
    statusInput: StoreSessionStatus = 'checking',
  ): StoreSessionMetadata {
    const store = this.requireWritableStore(storeIdInput);
    const provider = normalizeProvider(providerInput);
    if (!this.getConnection(store.storeId, provider)) {
      throw new StoreRepositoryError(
        'CONNECTION_NOT_FOUND',
        `Store ${store.storeId} has no ${provider} connection binding.`,
      );
    }
    const status = normalizeSessionStatus(statusInput);
    const now = new Date().toISOString();
    const row = this.db.prepare(`
      INSERT INTO store_session_metadata (
        store_id, provider, browser_profile_id, status, session_generation,
        observed_at, account_label, external_account_id, verified_at,
        expires_at, failure_code, updated_at
      ) VALUES (
        @storeId, @provider, @browserProfileId, @status, 0,
        @observedAt, NULL, NULL, NULL,
        NULL, NULL, @updatedAt
      )
      ON CONFLICT(store_id, provider) DO UPDATE SET
        browser_profile_id = excluded.browser_profile_id,
        status = excluded.status,
        session_generation = store_session_metadata.session_generation + 1,
        observed_at = excluded.observed_at,
        verified_at = NULL,
        expires_at = NULL,
        updated_at = excluded.updated_at
      WHERE store_session_metadata.session_generation < @maxGeneration
      RETURNING *
    `).get({
      storeId: store.storeId,
      browserProfileId: store.browserProfileId,
      provider,
      status,
      observedAt: now,
      updatedAt: now,
      maxGeneration: Number.MAX_SAFE_INTEGER,
    }) as SessionRow | undefined;
    if (!row) {
      throw new StoreRepositoryError(
        'SESSION_GENERATION_STALE',
        `Session generation for store ${store.storeId} cannot advance beyond ${Number.MAX_SAFE_INTEGER}.`,
      );
    }
    return mapSession(row);
  }

  getSessionMetadata(
    storeIdInput: StoreId,
    providerInput: StoreConnectionProvider,
  ): StoreSessionMetadata | undefined {
    const storeId = normalizeStoreId(storeIdInput);
    const provider = normalizeProvider(providerInput);
    const row = this.db.prepare(`
      SELECT * FROM store_session_metadata WHERE store_id = ? AND provider = ?
    `).get(storeId, provider) as SessionRow | undefined;
    return row ? mapSession(row) : undefined;
  }

  listSessionMetadata(storeIdInput: StoreId): StoreSessionMetadata[] {
    const storeId = normalizeStoreId(storeIdInput);
    this.requireStore(storeId);
    return (this.db.prepare(`
      SELECT * FROM store_session_metadata WHERE store_id = ? ORDER BY provider
    `).all(storeId) as SessionRow[]).map(mapSession);
  }

  listSchemaMigrations(): SchemaMigrationRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM schema_migrations ORDER BY version
    `).all() as SchemaMigrationRow[];
    return rows.map(mapSchemaMigration);
  }

  getSchemaMigration(version = STORE_AUTHORITY_MIGRATION_VERSION): SchemaMigrationRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM schema_migrations WHERE version = ?
    `).get(version) as SchemaMigrationRow | undefined;
    return row ? mapSchemaMigration(row) : undefined;
  }

  getMigrationManifest(version = STORE_AUTHORITY_MIGRATION_VERSION): SchemaMigrationManifest | undefined {
    return this.getSchemaMigration(version)?.manifest;
  }

  getMigrationResult(version = STORE_AUTHORITY_MIGRATION_VERSION): StoreMigrationResult | undefined {
    return this.getSchemaMigration(version)?.result;
  }

  getMigrationRecoveryPreflight(
    version = STORE_AUTHORITY_MIGRATION_VERSION,
  ): StoreMigrationRecoveryPreflight {
    const migration = this.getSchemaMigration(version);
    if (!migration) {
      throw new StoreRepositoryError('MIGRATION_NOT_FOUND', `Migration ${version} was not found.`);
    }
    if (version === STORE_AUTHORITY_MIGRATION_VERSION && isStoreMigrationManifest(migration.manifest)) {
      return getStoreMigrationRecoveryPreflight(migration.manifest);
    }
    const upgradeBackup = upgradeBackupFromMigrationManifest(migration.manifest);
    if (!upgradeBackup) {
      throw new StoreRepositoryError(
        'MIGRATION_NOT_FOUND',
        `Migration ${version} does not contain a recoverable upgrade backup.`,
      );
    }
    return getUpgradeBackupRecoveryPreflight(upgradeBackup);
  }

  restoreMigrationBackupTo(
    destinationPath: string,
    version = STORE_AUTHORITY_MIGRATION_VERSION,
  ): StoreMigrationRestoreResult {
    const migration = this.getSchemaMigration(version);
    if (!migration) {
      throw new StoreRepositoryError('MIGRATION_NOT_FOUND', `Migration ${version} was not found.`);
    }
    if (version === STORE_AUTHORITY_MIGRATION_VERSION && isStoreMigrationManifest(migration.manifest)) {
      return restoreStoreMigrationBackupTo(migration.manifest, destinationPath);
    }
    const upgradeBackup = upgradeBackupFromMigrationManifest(migration.manifest);
    if (!upgradeBackup) {
      throw new StoreRepositoryError(
        'MIGRATION_NOT_FOUND',
        `Migration ${version} does not contain a recoverable upgrade backup.`,
      );
    }
    return restoreUpgradeBackupTo(upgradeBackup, destinationPath);
  }

  listMigrationQuarantine(
    filter: StoreMigrationQuarantineFilter = {},
  ): StoreMigrationQuarantineRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.migrationVersion !== undefined) {
      clauses.push('migration_version = ?');
      params.push(filter.migrationVersion);
    }
    if (filter.status !== undefined) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.sourceTable !== undefined) {
      if (!(STORE_SCOPED_LEGACY_TABLES as readonly string[]).includes(filter.sourceTable)) {
        throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Unknown store migration source table.');
      }
      clauses.push('source_table = ?');
      params.push(filter.sourceTable);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM store_migration_quarantine
      ${where}
      ORDER BY migration_version, source_table, source_row_id, id
    `).all(...params) as QuarantineRow[];
    return rows.map(mapQuarantine);
  }

  resolveMigrationQuarantine(
    input: ResolveStoreMigrationQuarantineInput,
  ): StoreMigrationQuarantineRecord {
    if (!Number.isSafeInteger(input.quarantineId) || input.quarantineId <= 0) {
      throw new StoreRepositoryError('INVALID_STORE_INPUT', 'quarantineId must be a positive integer.');
    }
    const store = this.requireStore(input.storeId);
    const resolutionNote = normalizeDisplayName(input.resolutionNote);
    const resolve = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT * FROM store_migration_quarantine WHERE id = ?
      `).get(input.quarantineId) as QuarantineRow | undefined;
      if (!row) {
        throw new StoreRepositoryError('QUARANTINE_NOT_FOUND', 'Migration quarantine record was not found.');
      }
      if (row.status !== 'pending') {
        throw new StoreRepositoryError(
          'QUARANTINE_ALREADY_RESOLVED',
          'Migration quarantine record has already been resolved.',
        );
      }
      if (!(STORE_SCOPED_LEGACY_TABLES as readonly string[]).includes(row.source_table)) {
        throw new StoreRepositoryError('QUARANTINE_TARGET_CONFLICT', 'Quarantine source table is not allowlisted.');
      }
      const sourceTable = row.source_table as typeof STORE_SCOPED_LEGACY_TABLES[number];
      const identityColumn = this.tableHasColumn(sourceTable, 'id') ? 'id' : 'rowid';
      const source = this.db.prepare(`
        SELECT *
        FROM ${quoteIdentifier(sourceTable)}
        WHERE CAST(${quoteIdentifier(identityColumn)} AS TEXT) = ?
      `).get(row.source_row_id) as Record<string, unknown> | undefined;
      if (!source) {
        throw new StoreRepositoryError('QUARANTINE_TARGET_CONFLICT', 'Quarantined source row no longer exists.');
      }
      if (typeof source.store_id === 'string' && source.store_id && source.store_id !== store.storeId) {
        throw new StoreRepositoryError(
          'QUARANTINE_TARGET_CONFLICT',
          `Source row is already assigned to store ${source.store_id}.`,
        );
      }
      this.assertQuarantineParentAuthority(sourceTable, source, store.storeId);
      if (!source.store_id) {
        this.db.prepare(`
          UPDATE ${quoteIdentifier(sourceTable)}
          SET store_id = ?
          WHERE CAST(${quoteIdentifier(identityColumn)} AS TEXT) = ? AND store_id IS NULL
        `).run(store.storeId, row.source_row_id);
      }
      // Marker-backed partial indexes intentionally keep pending rows outside
      // authoritative identities. Clearing the marker inside this transaction
      // makes SQLite's unique indexes the final race-free preflight: any
      // collision aborts and rolls back both the owner assignment and the
      // quarantine resolution, so a restart can safely re-synchronise markers.
      if (this.tableHasColumn(sourceTable, 'store_authority_quarantined')) {
        this.db.prepare(`
          UPDATE ${quoteIdentifier(sourceTable)}
          SET store_authority_quarantined = 0
          WHERE CAST(${quoteIdentifier(identityColumn)} AS TEXT) = ?
            AND store_authority_quarantined = 1
        `).run(row.source_row_id);
      }
      const now = new Date().toISOString();
      const resolution = this.db.prepare(`
        UPDATE store_migration_quarantine
        SET status = 'resolved', resolved_store_id = @storeId,
            resolution_note = @resolutionNote, resolved_at = @resolvedAt,
            updated_at = @updatedAt
        WHERE id = @id AND status = 'pending'
      `).run({
        id: row.id,
        storeId: store.storeId,
        resolutionNote,
        resolvedAt: now,
        updatedAt: now,
      });
      if (resolution.changes !== 1) {
        throw new StoreRepositoryError(
          'QUARANTINE_ALREADY_RESOLVED',
          'Migration quarantine record was resolved concurrently.',
        );
      }
      return mapQuarantine(this.db.prepare(`
        SELECT * FROM store_migration_quarantine WHERE id = ?
      `).get(row.id) as QuarantineRow);
    });
    try {
      return resolve();
    } catch (error) {
      if (error instanceof StoreRepositoryError) throw error;
      if (isSqliteConstraint(error)) {
        throw new StoreRepositoryError(
          'QUARANTINE_TARGET_CONFLICT',
          'Resolving this row would conflict with existing store-scoped authority.',
        );
      }
      throw error;
    }
  }

  private assertQuarantineParentAuthority(
    sourceTable: typeof STORE_SCOPED_LEGACY_TABLES[number],
    source: Record<string, unknown>,
    storeId: StoreId,
  ): void {
    const link = QUARANTINE_PARENT_LINKS[sourceTable];
    if (link) {
      const parentId = source[link.localColumn];
      if (parentId !== null && parentId !== undefined && String(parentId).trim()) {
        const parents = this.db.prepare(`
          SELECT parent.store_id AS store_id,
                 CASE WHEN EXISTS (
                   SELECT 1
                   FROM store_migration_quarantine quarantine
                   WHERE quarantine.source_table = ?
                     AND quarantine.source_row_id = CAST(parent.${quoteIdentifier(link.parentIdentityColumn)} AS TEXT)
                     AND quarantine.status = 'pending'
                 ) THEN 1 ELSE 0 END AS pending
          FROM ${quoteIdentifier(link.parentTable)} parent
          WHERE parent.${quoteIdentifier(link.parentColumn)} = ?
        `).all(link.parentTable, parentId) as Array<{ store_id: string | null; pending: number }>;
        this.assertParentRowsMatchStore(sourceTable, link.parentTable, parents, storeId);
      }
    }

    if (sourceTable === 'keyword_metrics') {
      const sourceFile = typeof source.source_file === 'string' ? source.source_file.trim() : '';
      if (sourceFile) {
        const parents = this.db.prepare(`
          SELECT parent.store_id, parent.pending
          FROM (
            SELECT report.store_id AS store_id,
                   CASE WHEN EXISTS (
                     SELECT 1 FROM store_migration_quarantine quarantine
                     WHERE quarantine.source_table = 'report_files'
                       AND quarantine.source_row_id = CAST(report.id AS TEXT)
                       AND quarantine.status = 'pending'
                   ) THEN 1 ELSE 0 END AS pending
            FROM report_files report
            WHERE report.file_path = ?
            UNION ALL
            SELECT report.store_id AS store_id,
                   CASE WHEN EXISTS (
                     SELECT 1 FROM store_migration_quarantine quarantine
                     WHERE quarantine.source_table = 'lingxing_report_files'
                       AND quarantine.source_row_id = CAST(report.id AS TEXT)
                       AND quarantine.status = 'pending'
                   ) THEN 1 ELSE 0 END AS pending
            FROM lingxing_report_files report
            WHERE report.file_path = ?
          ) parent
        `).all(sourceFile, sourceFile) as Array<{ store_id: string | null; pending: number }>;
        this.assertParentRowsMatchStore(sourceTable, 'report_files', parents, storeId);
      }
    }
  }

  private assertParentRowsMatchStore(
    sourceTable: string,
    parentTable: string,
    parents: Array<{ store_id: string | null; pending: number }>,
    storeId: StoreId,
  ): void {
    if (parents.length === 0 || parents.some((parent) => parent.pending === 1 || !parent.store_id)) {
      throw new StoreRepositoryError(
        'QUARANTINE_TARGET_CONFLICT',
        `${sourceTable} cannot be resolved before its ${parentTable} parent has authoritative store ownership.`,
      );
    }
    const conflictingParent = parents.find((parent) => parent.store_id !== storeId);
    if (conflictingParent) {
      throw new StoreRepositoryError(
        'QUARANTINE_TARGET_CONFLICT',
        `${sourceTable} parent belongs to store ${conflictingParent.store_id}, not ${storeId}.`,
      );
    }
  }

  private requireStore(storeIdInput: StoreId): StoreRecord {
    const storeId = normalizeStoreId(storeIdInput);
    const store = this.getStore(storeId);
    if (!store) {
      throw new StoreRepositoryError('STORE_NOT_FOUND', `Store ${storeId} was not found.`);
    }
    return store;
  }

  private requireWritableStore(storeIdInput: StoreId): StoreRecord {
    const store = this.requireStore(storeIdInput);
    if (store.status !== 'active') {
      throw new StoreRepositoryError(
        'STORE_NOT_ACTIVE',
        `Store ${store.storeId} is ${store.status}; connection and session writes require an active store.`,
      );
    }
    return store;
  }

  private requireConnection(storeId: StoreId, id: StoreCapabilityId): StoreConnection {
    const row = this.db.prepare(`
      SELECT * FROM store_connections WHERE id = ? AND store_id = ?
    `).get(id, storeId) as ConnectionRow | undefined;
    if (!row) {
      throw new StoreRepositoryError('CONNECTION_NOT_FOUND', `Connection ${id} was not found for store ${storeId}.`);
    }
    return this.mapConnection(row);
  }

  private requireSessionMetadata(
    storeId: StoreId,
    provider: StoreConnectionProvider,
  ): StoreSessionMetadata {
    const session = this.getSessionMetadata(storeId, provider);
    if (!session) throw new StoreRepositoryError('CONNECTION_NOT_FOUND', 'Session metadata was not found.');
    return session;
  }

  private mapConnection(row: ConnectionRow): StoreConnection {
    const storeId = normalizeStoreId(row.store_id);
    const provider = normalizeProvider(row.provider);
    return {
      id: normalizeStoreCapabilityId(row.id),
      storeId,
      provider,
      status: normalizeConnectionStatus(row.status),
      accountLabel: optionalText(row.account_label),
      externalAccountId: optionalText(row.external_account_id),
      lastVerifiedAt: optionalText(row.last_verified_at),
      lastFailureCode: optionalText(row.last_failure_code),
      session: this.getSessionMetadata(storeId, provider),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private tableHasColumn(table: string, column: string): boolean {
    if (!(STORE_SCOPED_LEGACY_TABLES as readonly string[]).includes(table)) return false;
    const rows = this.db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  }
}

export { StoreRepository as StoreRepo };

interface StoreRow {
  store_id: string;
  browser_profile_id: string;
  marketplace: string;
  currency: string;
  display_name: string;
  status: StoreStatus;
  business_timezone: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface ConnectionRow {
  id: string;
  store_id: string;
  provider: string;
  status: string;
  account_label: string | null;
  external_account_id: string | null;
  last_verified_at: string | null;
  last_failure_code: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  store_id: string;
  provider: string;
  browser_profile_id: string;
  status: string;
  session_generation: number;
  observed_at: string;
  account_label: string | null;
  external_account_id: string | null;
  verified_at: string | null;
  expires_at: string | null;
  failure_code: string | null;
}

interface SchemaMigrationRow {
  version: number;
  name: string;
  checksum: string;
  status: 'started' | 'applied' | 'failed';
  started_at: string;
  applied_at: string | null;
  error_message: string | null;
  manifest_json: string;
  result_json: string | null;
}

interface QuarantineRow {
  id: number;
  migration_version: number;
  source_table: string;
  source_row_id: string;
  reason: string;
  normalized_store_name: string | null;
  normalized_marketplace_code: string | null;
  candidate_store_ids_json: string;
  source_identity_json: string;
  status: 'pending' | 'resolved';
  resolved_store_id: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface QuarantineParentLink {
  parentTable: typeof STORE_SCOPED_LEGACY_TABLES[number];
  localColumn: string;
  parentColumn: string;
  parentIdentityColumn: string;
}

const QUARANTINE_PARENT_LINKS: Partial<Record<
  typeof STORE_SCOPED_LEGACY_TABLES[number],
  QuarantineParentLink
>> = {
  product_costs: {
    parentTable: 'products',
    localColumn: 'product_id',
    parentColumn: 'id',
    parentIdentityColumn: 'id',
  },
  action_logs: {
    parentTable: 'action_recommendations',
    localColumn: 'recommendation_id',
    parentColumn: 'id',
    parentIdentityColumn: 'id',
  },
  approval_tasks: {
    parentTable: 'action_recommendations',
    localColumn: 'recommendation_id',
    parentColumn: 'id',
    parentIdentityColumn: 'id',
  },
  lingxing_report_files: {
    parentTable: 'lingxing_report_batches',
    localColumn: 'batch_id',
    parentColumn: 'id',
    parentIdentityColumn: 'id',
  },
  report_files: {
    parentTable: 'lingxing_report_batches',
    localColumn: 'batch_id',
    parentColumn: 'id',
    parentIdentityColumn: 'id',
  },
  ad_daily_metrics: {
    parentTable: 'lingxing_report_batches',
    localColumn: 'batch_id',
    parentColumn: 'id',
    parentIdentityColumn: 'id',
  },
  listing_content_versions: {
    parentTable: 'listing_content',
    localColumn: 'listing_content_id',
    parentColumn: 'id',
    parentIdentityColumn: 'id',
  },
};

function mapStore(row: StoreRow): StoreRecord {
  return {
    storeId: normalizeStoreId(row.store_id),
    browserProfileId: normalizeBrowserProfileId(row.browser_profile_id),
    marketplace: normalizeUsMarketplace(row.marketplace),
    currency: normalizeUsdCurrency(row.currency),
    displayName: row.display_name,
    status: row.status,
    businessTimezone: normalizeBusinessTimezone(row.business_timezone),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: optionalText(row.archived_at),
  };
}

function mapSession(row: SessionRow): StoreSessionMetadata {
  return {
    storeId: normalizeStoreId(row.store_id),
    browserProfileId: normalizeBrowserProfileId(row.browser_profile_id),
    provider: normalizeProvider(row.provider),
    status: normalizeSessionStatus(row.status),
    sessionGeneration: normalizeSessionGeneration(row.session_generation),
    observedAt: row.observed_at,
    accountLabel: optionalText(row.account_label),
    externalAccountId: optionalText(row.external_account_id),
    verifiedAt: optionalText(row.verified_at),
    expiresAt: optionalText(row.expires_at),
    failureCode: optionalText(row.failure_code),
  };
}

function mapSchemaMigration(row: SchemaMigrationRow): SchemaMigrationRecord {
  const manifest = parseJson<SchemaMigrationManifest>(row.manifest_json);
  if (!manifest) {
    throw new StoreRepositoryError(
      'MIGRATION_NOT_FOUND',
      `Migration ${row.version} has an unreadable manifest.`,
    );
  }
  return {
    version: row.version,
    name: row.name,
    checksum: row.checksum,
    status: row.status,
    startedAt: row.started_at,
    appliedAt: optionalText(row.applied_at),
    errorMessage: optionalText(row.error_message),
    manifest,
    result: parseJson<StoreMigrationResult>(row.result_json),
  };
}

function isStoreMigrationManifest(manifest: SchemaMigrationManifest): manifest is StoreMigrationManifest {
  return 'backup' in manifest
    && 'schemaFingerprint' in manifest
    && 'tableRowCounts' in manifest
    && 'targetTables' in manifest;
}

function mapQuarantine(row: QuarantineRow): StoreMigrationQuarantineRecord {
  return {
    id: row.id,
    migrationVersion: row.migration_version,
    sourceTable: row.source_table,
    sourceRowId: row.source_row_id,
    reason: row.reason as StoreMigrationQuarantineReason,
    normalizedStoreName: optionalText(row.normalized_store_name),
    normalizedMarketplaceCode: optionalText(row.normalized_marketplace_code),
    candidateStoreIds: parseJson<string[]>(row.candidate_store_ids_json) ?? [],
    sourceIdentity: parseJson<Record<string, unknown>>(row.source_identity_json) ?? {},
    status: row.status,
    resolvedStoreId: optionalText(row.resolved_store_id),
    resolutionNote: optionalText(row.resolution_note),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: optionalText(row.resolved_at),
  };
}

function assertExpectedUpdatedAt(store: StoreRecord, expectedUpdatedAt?: string): void {
  if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== store.updatedAt) {
    throw new StoreRepositoryError(
      'STORE_CONFLICT',
      `Store ${store.storeId} changed after it was read; reload before retrying.`,
    );
  }
}

function nextTimestamp(previous: string): string {
  const previousMillis = Date.parse(previous);
  const nextMillis = Number.isFinite(previousMillis)
    ? Math.max(Date.now(), previousMillis + 1)
    : Date.now();
  return new Date(nextMillis).toISOString();
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Display name must be a string.');
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Display name cannot be empty.');
  }
  if (normalized.length > 200) {
    throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Display name cannot exceed 200 characters.');
  }
  return normalized;
}

function normalizeProvider(value: unknown): StoreConnectionProvider {
  if (value !== 'lingxing' && value !== 'amazon_ads') {
    throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Unsupported store connection provider.');
  }
  return value;
}

function normalizeConnectionStatus(value: unknown): StoreConnectionStatus {
  if (!['not_configured', 'checking', 'ready', 'attention_required', 'blocked'].includes(String(value))) {
    throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Unsupported store connection status.');
  }
  return value as StoreConnectionStatus;
}

function normalizeSessionStatus(value: unknown): StoreSessionStatus {
  if (!['unknown', 'signed_out', 'checking', 'ready', 'expired', 'blocked'].includes(String(value))) {
    throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Unsupported store session status.');
  }
  return value as StoreSessionStatus;
}

function requiredTimestamp(value: unknown, label: string): string {
  const normalized = optionalTimestamp(value);
  if (!normalized) {
    throw new StoreRepositoryError('INVALID_STORE_INPUT', `${label} must be an ISO timestamp.`);
  }
  return normalized;
}

function optionalTimestamp(value: unknown): string | null {
  const normalized = optionalText(value);
  if (!normalized) return null;
  if (Number.isNaN(Date.parse(normalized))) {
    throw new StoreRepositoryError('INVALID_STORE_INPUT', 'Timestamp must be parseable ISO date-time text.');
  }
  return normalized;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function nullableText(value: unknown): string | null {
  return optionalText(value) ?? null;
}

const MAX_PROVIDER_IDENTITY_LENGTH = 256;
const PROVIDER_IDENTITY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function nullableProviderIdentity(value: unknown, label: string): string | null {
  const normalized = nullableText(value);
  if (normalized === null) return null;
  if (
    normalized.length > MAX_PROVIDER_IDENTITY_LENGTH
    || PROVIDER_IDENTITY_CONTROL_CHARACTERS.test(normalized)
  ) {
    throw new StoreRepositoryError(
      'INVALID_STORE_INPUT',
      `${label} must be at most ${MAX_PROVIDER_IDENTITY_LENGTH} characters without control characters.`,
    );
  }
  return normalized;
}

function parseJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function isSqliteConstraint(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && String((error as { code?: unknown }).code).startsWith('SQLITE_CONSTRAINT'),
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
