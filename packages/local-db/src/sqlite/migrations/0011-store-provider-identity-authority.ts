import Database from 'better-sqlite3';
import {
  DEFAULT_US_BUSINESS_TIMEZONE,
  US_MARKETPLACE,
  USD_CURRENCY,
  normalizeLingxingCollectionStoreName,
  normalizeProviderExternalAccountId,
  type StoreConnectionProvider,
} from '@amazon-ai-ops/shared-types';
import {
  COLLECTION_RESUME_AUTHORITY_MIGRATION_CHECKSUM,
  COLLECTION_RESUME_AUTHORITY_MIGRATION_NAME,
  COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
} from './0010-collection-resume-authority';
import { ensureSchemaMigrationsTable } from './0001-store-authority';
import { prepareUpgradeBackup } from './upgrade-backup';
import type { UpgradeBackupManifest } from './types';

export const STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION = 11;
export const STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_NAME =
  'store-provider-identity-authority-v11';
export const STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_CHECKSUM =
  'store-provider-identity-authority-v11-20260804-03';
export const STORE_PROVIDER_IDENTITY_UNIQUE_INDEX =
  'idx_store_connections_provider_external_identity_unique';
export const STORE_PROVIDER_IDENTITY_SQL_FUNCTION =
  'normalize_store_provider_external_identity';
export const LINGXING_COLLECTION_STORE_NAME_SQL_FUNCTION =
  'normalize_lingxing_collection_store_name';

const STORE_AUTHORITY_TRIGGER_SQL = {
  trg_stores_v1_authority_insert: `
    CREATE TRIGGER trg_stores_v1_authority_insert
    BEFORE INSERT ON stores
    WHEN NEW.marketplace <> 'US'
      OR NEW.currency <> 'USD'
      OR NEW.business_timezone <> 'America/Los_Angeles'
    BEGIN
      SELECT RAISE(ABORT, 'store authority must remain US/USD/America/Los_Angeles');
    END
  `,
  trg_stores_v1_authority_update: `
    CREATE TRIGGER trg_stores_v1_authority_update
    BEFORE UPDATE OF marketplace, currency, business_timezone ON stores
    WHEN NEW.marketplace <> 'US'
      OR NEW.currency <> 'USD'
      OR NEW.business_timezone <> 'America/Los_Angeles'
    BEGIN
      SELECT RAISE(ABORT, 'store authority must remain US/USD/America/Los_Angeles');
    END
  `,
} as const;

const CONNECTION_IDENTITY_TRIGGER_SQL = {
  trg_store_connections_external_identity_insert: `
    CREATE TRIGGER trg_store_connections_external_identity_insert
    BEFORE INSERT ON store_connections
    WHEN (NEW.external_account_id IS NULL AND NEW.normalized_external_account_id IS NOT NULL)
      OR (NEW.external_account_id IS NOT NULL AND NEW.normalized_external_account_id IS NULL)
      OR (NEW.external_account_id IS NOT NULL
        AND (
          normalize_store_provider_external_identity(NEW.provider, NEW.external_account_id) IS NULL
          OR NEW.normalized_external_account_id <>
            normalize_store_provider_external_identity(NEW.provider, NEW.external_account_id)))
    BEGIN
      SELECT RAISE(ABORT, 'provider external identity raw/normalized mismatch');
    END
  `,
  trg_store_connections_external_identity_update: `
    CREATE TRIGGER trg_store_connections_external_identity_update
    BEFORE UPDATE OF provider, external_account_id, normalized_external_account_id
    ON store_connections
    WHEN (NEW.external_account_id IS NULL AND NEW.normalized_external_account_id IS NOT NULL)
      OR (NEW.external_account_id IS NOT NULL AND NEW.normalized_external_account_id IS NULL)
      OR (NEW.external_account_id IS NOT NULL
        AND (
          normalize_store_provider_external_identity(NEW.provider, NEW.external_account_id) IS NULL
          OR NEW.normalized_external_account_id <>
            normalize_store_provider_external_identity(NEW.provider, NEW.external_account_id)))
    BEGIN
      SELECT RAISE(ABORT, 'provider external identity raw/normalized mismatch');
    END
  `,
  trg_store_connections_collection_store_name_insert: `
    CREATE TRIGGER trg_store_connections_collection_store_name_insert
    BEFORE INSERT ON store_connections
    WHEN (NEW.provider = 'amazon_ads'
        AND (NEW.collection_store_name IS NOT NULL
          OR NEW.normalized_collection_store_name IS NOT NULL))
      OR (NEW.provider = 'lingxing' AND (
        (NEW.collection_store_name IS NULL
          AND NEW.normalized_collection_store_name IS NOT NULL)
        OR (NEW.collection_store_name IS NOT NULL
          AND NEW.normalized_collection_store_name IS NULL)
        OR (NEW.collection_store_name IS NOT NULL
          AND (
            normalize_lingxing_collection_store_name(NEW.collection_store_name) IS NULL
            OR NEW.normalized_collection_store_name <>
              normalize_lingxing_collection_store_name(NEW.collection_store_name)))))
    BEGIN
      SELECT RAISE(ABORT, 'Lingxing collection store selector raw/normalized/provider mismatch');
    END
  `,
  trg_store_connections_collection_store_name_update: `
    CREATE TRIGGER trg_store_connections_collection_store_name_update
    BEFORE UPDATE OF provider, collection_store_name, normalized_collection_store_name
    ON store_connections
    WHEN (NEW.provider = 'amazon_ads'
        AND (NEW.collection_store_name IS NOT NULL
          OR NEW.normalized_collection_store_name IS NOT NULL))
      OR (NEW.provider = 'lingxing' AND (
        (NEW.collection_store_name IS NULL
          AND NEW.normalized_collection_store_name IS NOT NULL)
        OR (NEW.collection_store_name IS NOT NULL
          AND NEW.normalized_collection_store_name IS NULL)
        OR (NEW.collection_store_name IS NOT NULL
          AND (
            normalize_lingxing_collection_store_name(NEW.collection_store_name) IS NULL
            OR NEW.normalized_collection_store_name <>
              normalize_lingxing_collection_store_name(NEW.collection_store_name)))))
    BEGIN
      SELECT RAISE(ABORT, 'Lingxing collection store selector raw/normalized/provider mismatch');
    END
  `,
} as const;

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  result_json: string | null;
}

interface ConnectionIdentityRow {
  id: string;
  store_id: string;
  provider: StoreConnectionProvider;
  external_account_id: string | null;
  normalized_external_account_id?: string | null;
  collection_store_name?: string | null;
  normalized_collection_store_name?: string | null;
}

export interface StoreProviderIdentityAuthorityMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  backfilledConnections: number;
  migratedLingxingSelectors: number;
  backfilledStableExternalIdentities: number;
  errorMessage?: string;
}

export class StoreProviderIdentityAuthorityMigrationError extends Error {
  readonly version = STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'StoreProviderIdentityAuthorityMigrationError';
  }
}

/** Register the deterministic function used by persistent identity triggers. */
export function installStoreProviderIdentitySqlFunction(database: Database.Database): void {
  database.function(
    STORE_PROVIDER_IDENTITY_SQL_FUNCTION,
    { deterministic: true },
    (provider: unknown, externalAccountId: unknown) => {
      if (provider !== 'lingxing' && provider !== 'amazon_ads') {
        throw new StoreProviderIdentityAuthorityMigrationError(
          'Unsupported provider passed to provider identity normalization.',
        );
      }
      return normalizeProviderExternalAccountId(provider, externalAccountId) ?? null;
    },
  );
  database.function(
    LINGXING_COLLECTION_STORE_NAME_SQL_FUNCTION,
    { deterministic: true },
    (collectionStoreName: unknown) => (
      normalizeLingxingCollectionStoreName(collectionStoreName) ?? null
    ),
  );
}

export function runStoreProviderIdentityAuthorityMigration(
  database: Database.Database,
  preparedUpgradeBackup?: UpgradeBackupManifest,
): StoreProviderIdentityAuthorityMigrationResult {
  installStoreProviderIdentitySqlFunction(database);
  ensureSchemaMigrationsTable(database);
  assertPrerequisite(database);
  const existing = database.prepare(`
    SELECT checksum, status, result_json
    FROM schema_migrations WHERE version = ?
  `).get(STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION) as MigrationRow | undefined;
  if (existing && existing.checksum !== STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new StoreProviderIdentityAuthorityMigrationError(
      'Migration 11 checksum does not match recorded history.',
    );
  }
  if (existing?.status === 'applied') {
    verifyStoreProviderIdentityAuthoritySchema(database);
    return parseResult(existing.result_json);
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new StoreProviderIdentityAuthorityMigrationError(
      `Source database integrity_check returned: ${integrityCheck}`,
    );
  }
  const startedAt = new Date().toISOString();
  const started = defaultResult('started', startedAt);
  const upgradeBackup = preparedUpgradeBackup ?? prepareUpgradeBackup(database, {
    targetVersion: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION,
    targetName: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_NAME,
    targetChecksum: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_CHECKSUM,
  });
  database.prepare(`
    INSERT INTO schema_migrations (
      version, name, checksum, status, started_at, applied_at,
      error_message, manifest_json, result_json
    ) VALUES (
      @version, @name, @checksum, 'started', @startedAt, NULL,
      NULL, @manifestJson, @resultJson
    )
    ON CONFLICT(version) DO UPDATE SET
      name = excluded.name,
      checksum = excluded.checksum,
      status = 'started',
      started_at = excluded.started_at,
      applied_at = NULL,
      error_message = NULL,
      manifest_json = excluded.manifest_json,
      result_json = excluded.result_json
  `).run({
    version: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION,
    name: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_NAME,
    checksum: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_CHECKSUM,
    startedAt,
    manifestJson: JSON.stringify({
      version: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION,
      name: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_NAME,
      checksum: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_CHECKSUM,
      prerequisiteVersion: COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION,
      fixedAuthority: {
        marketplace: US_MARKETPLACE,
        currency: USD_CURRENCY,
        businessTimezone: DEFAULT_US_BUSINESS_TIMEZONE,
      },
      uniqueIndex: STORE_PROVIDER_IDENTITY_UNIQUE_INDEX,
      legacyLingxingExternalAccountIdMeaning: 'download_center_collection_store_name',
      stableExternalAccountIdRequiresReconfiguration: true,
      upgradeBackup,
      integrityCheck,
      startedAt,
    }),
    resultJson: JSON.stringify(started),
  });

  try {
    return database.transaction(() => {
      assertV1StoreRows(database);
      const identities = readAndValidateConnectionIdentities(database);
      if (!hasColumn(database, 'store_connections', 'normalized_external_account_id')) {
        database.exec(`
          ALTER TABLE store_connections
          ADD COLUMN normalized_external_account_id TEXT
        `);
      }
      if (!hasColumn(database, 'store_connections', 'collection_store_name')) {
        database.exec(`
          ALTER TABLE store_connections
          ADD COLUMN collection_store_name TEXT
        `);
      }
      if (!hasColumn(database, 'store_connections', 'normalized_collection_store_name')) {
        database.exec(`
          ALTER TABLE store_connections
          ADD COLUMN normalized_collection_store_name TEXT
        `);
      }
      const update = database.prepare(`
        UPDATE store_connections
        SET external_account_id = @externalAccountId,
            normalized_external_account_id = @normalizedExternalAccountId,
            collection_store_name = @collectionStoreName,
            normalized_collection_store_name = @normalizedCollectionStoreName
        WHERE id = @id
      `);
      let backfilledConnections = 0;
      let migratedLingxingSelectors = 0;
      let backfilledStableExternalIdentities = 0;
      for (const identity of identities) {
        update.run({
          id: identity.id,
          externalAccountId: identity.externalAccountId,
          normalizedExternalAccountId: identity.normalizedExternalAccountId,
          collectionStoreName: identity.collectionStoreName,
          normalizedCollectionStoreName: identity.normalizedCollectionStoreName,
        });
        if (identity.normalizedExternalAccountId !== null) {
          backfilledConnections += 1;
          backfilledStableExternalIdentities += 1;
        }
        if (identity.normalizedCollectionStoreName !== null) {
          backfilledConnections += 1;
          migratedLingxingSelectors += 1;
        }
      }
      createAuthoritySchema(database);
      verifyStoreProviderIdentityAuthoritySchema(database);
      const result: StoreProviderIdentityAuthorityMigrationResult = {
        ...started,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        backfilledConnections,
        migratedLingxingSelectors,
        backfilledStableExternalIdentities,
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed: StoreProviderIdentityAuthorityMigrationResult = {
      ...started,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: message,
    };
    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed', applied_at = NULL,
          error_message = @errorMessage, result_json = @resultJson
      WHERE version = @version
    `).run({
      version: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION,
      errorMessage: message,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof StoreProviderIdentityAuthorityMigrationError) throw error;
    throw new StoreProviderIdentityAuthorityMigrationError(message);
  }
}

export function verifyStoreProviderIdentityAuthoritySchema(database: Database.Database): void {
  installStoreProviderIdentitySqlFunction(database);
  const columns = database.pragma("table_info('store_connections')") as Array<{
    name: string;
    type: string;
    notnull: number;
  }>;
  for (const columnName of [
    'normalized_external_account_id',
    'collection_store_name',
    'normalized_collection_store_name',
  ]) {
    const column = columns.find((candidate) => candidate.name === columnName);
    if (!column || String(column.type).toUpperCase() !== 'TEXT' || column.notnull !== 0) {
      throw new StoreProviderIdentityAuthorityMigrationError(
        `Migration 11 connection authority column ${columnName} has an invalid contract.`,
      );
    }
  }

  const index = (database.pragma("index_list('store_connections')") as Array<{
    name: string;
    unique: number;
    partial: number;
  }>).find((candidate) => candidate.name === STORE_PROVIDER_IDENTITY_UNIQUE_INDEX);
  const indexColumns = (database.pragma(
    `index_xinfo('${STORE_PROVIDER_IDENTITY_UNIQUE_INDEX}')`,
  ) as Array<{ name: string | null; key: number; seqno: number }>).filter((candidate) => candidate.key === 1)
    .sort((left, right) => left.seqno - right.seqno)
    .map((candidate) => candidate.name);
  const indexSql = database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?
  `).get(STORE_PROVIDER_IDENTITY_UNIQUE_INDEX) as { sql: string | null } | undefined;
  const expectedIndexSql = `
    CREATE UNIQUE INDEX ${STORE_PROVIDER_IDENTITY_UNIQUE_INDEX}
    ON store_connections(provider, normalized_external_account_id)
    WHERE normalized_external_account_id IS NOT NULL
  `;
  if (!index || index.unique !== 1 || index.partial !== 1
    || JSON.stringify(indexColumns) !== JSON.stringify(['provider', 'normalized_external_account_id'])
    || canonicalSql(indexSql?.sql ?? '') !== canonicalSql(expectedIndexSql)) {
    throw new StoreProviderIdentityAuthorityMigrationError(
      'Migration 11 provider identity unique index has an invalid exact contract.',
    );
  }

  for (const [name, expectedSql] of Object.entries({
    ...STORE_AUTHORITY_TRIGGER_SQL,
    ...CONNECTION_IDENTITY_TRIGGER_SQL,
  })) {
    const trigger = database.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
    `).get(name) as { sql: string | null } | undefined;
    if (canonicalSql(trigger?.sql ?? '') !== canonicalSql(expectedSql)) {
      throw new StoreProviderIdentityAuthorityMigrationError(
        `Migration 11 authority trigger ${name} is missing or invalid.`,
      );
    }
  }

  assertV1StoreRows(database);
  readAndValidateConnectionIdentities(database, true);
}

function createAuthoritySchema(database: Database.Database): void {
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${STORE_PROVIDER_IDENTITY_UNIQUE_INDEX}
      ON store_connections(provider, normalized_external_account_id)
      WHERE normalized_external_account_id IS NOT NULL;
  `);
  for (const sql of Object.values({
    ...STORE_AUTHORITY_TRIGGER_SQL,
    ...CONNECTION_IDENTITY_TRIGGER_SQL,
  })) {
    database.exec(sql.replace(/CREATE TRIGGER/, 'CREATE TRIGGER IF NOT EXISTS'));
  }
}

function assertV1StoreRows(database: Database.Database): void {
  const invalid = database.prepare(`
    SELECT store_id, marketplace, currency, business_timezone
    FROM stores
    WHERE marketplace <> 'US'
       OR currency <> 'USD'
       OR business_timezone <> 'America/Los_Angeles'
    ORDER BY store_id
    LIMIT 1
  `).get() as {
    store_id: string;
    marketplace: string;
    currency: string;
    business_timezone: string;
  } | undefined;
  if (invalid) {
    throw new StoreProviderIdentityAuthorityMigrationError(
      `Store ${invalid.store_id} has unsupported authority ${invalid.marketplace}/${invalid.currency}/${invalid.business_timezone}.`,
    );
  }
}

function readAndValidateConnectionIdentities(
  database: Database.Database,
  requirePersistedNormalized = false,
): Array<{
  id: string;
  externalAccountId: string | null;
  normalizedExternalAccountId: string | null;
  collectionStoreName: string | null;
  normalizedCollectionStoreName: string | null;
}> {
  const hasNormalizedColumn = hasColumn(database, 'store_connections', 'normalized_external_account_id');
  const hasCollectionStoreName = hasColumn(database, 'store_connections', 'collection_store_name');
  const hasNormalizedCollectionStoreName = hasColumn(
    database,
    'store_connections',
    'normalized_collection_store_name',
  );
  const rows = database.prepare(`
    SELECT id, store_id, provider, external_account_id,
      ${hasNormalizedColumn ? 'normalized_external_account_id' : 'NULL'}
        AS normalized_external_account_id,
      ${hasCollectionStoreName ? 'collection_store_name' : 'NULL'}
        AS collection_store_name,
      ${hasNormalizedCollectionStoreName ? 'normalized_collection_store_name' : 'NULL'}
        AS normalized_collection_store_name
    FROM store_connections
    ORDER BY provider, id
  `).all() as ConnectionIdentityRow[];
  const owners = new Map<string, ConnectionIdentityRow>();
  const identities: Array<{
    id: string;
    externalAccountId: string | null;
    normalizedExternalAccountId: string | null;
    collectionStoreName: string | null;
    normalizedCollectionStoreName: string | null;
  }> = [];
  for (const row of rows) {
    const legacyRaw = canonicalRawIdentity(row.external_account_id);
    const externalAccountId = requirePersistedNormalized || row.provider === 'amazon_ads'
      ? legacyRaw
      : null;
    const collectionStoreName = requirePersistedNormalized
      ? canonicalRawIdentity(row.collection_store_name ?? null)
      : (row.provider === 'lingxing' ? legacyRaw : null);
    const normalizedExternalAccountId = normalizeProviderExternalAccountId(
      row.provider,
      externalAccountId,
    ) ?? null;
    const normalizedCollectionStoreName = normalizeLingxingCollectionStoreName(
      collectionStoreName,
    ) ?? null;
    if (requirePersistedNormalized) {
      const persistedExternal = row.normalized_external_account_id ?? null;
      if ((row.external_account_id === null) !== (persistedExternal === null)
        || persistedExternal !== normalizedExternalAccountId) {
        throw new StoreProviderIdentityAuthorityMigrationError(
          `Connection ${row.id} has inconsistent raw and normalized provider identity.`,
        );
      }
      const persistedCollection = row.normalized_collection_store_name ?? null;
      if (row.provider === 'amazon_ads'
        && (row.collection_store_name !== null || persistedCollection !== null)) {
        throw new StoreProviderIdentityAuthorityMigrationError(
          `Amazon Ads connection ${row.id} cannot carry a Lingxing collection store selector.`,
        );
      }
      if ((row.collection_store_name === null) !== (persistedCollection === null)
        || persistedCollection !== normalizedCollectionStoreName) {
        throw new StoreProviderIdentityAuthorityMigrationError(
          `Connection ${row.id} has inconsistent Lingxing selector raw and normalized values.`,
        );
      }
    }
    if (normalizedExternalAccountId !== null) {
      const key = `${row.provider}\u0000${normalizedExternalAccountId}`;
      const owner = owners.get(key);
      if (owner) {
        throw new StoreProviderIdentityAuthorityMigrationError(
          `Provider identity ${row.provider}/${normalizedExternalAccountId} is already bound by connections ${owner.id} (${owner.store_id}) and ${row.id} (${row.store_id}).`,
        );
      }
      owners.set(key, row);
    }
    identities.push({
      id: row.id,
      externalAccountId,
      normalizedExternalAccountId,
      collectionStoreName,
      normalizedCollectionStoreName,
    });
  }
  return identities;
}

function canonicalRawIdentity(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function assertPrerequisite(database: Database.Database): void {
  const prerequisite = database.prepare(`
    SELECT name, checksum, status
    FROM schema_migrations WHERE version = ?
  `).get(COLLECTION_RESUME_AUTHORITY_MIGRATION_VERSION) as {
    name: string;
    checksum: string;
    status: string;
  } | undefined;
  if (prerequisite?.status !== 'applied'
    || prerequisite.name !== COLLECTION_RESUME_AUTHORITY_MIGRATION_NAME
    || prerequisite.checksum !== COLLECTION_RESUME_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new StoreProviderIdentityAuthorityMigrationError(
      'Exact migration 10 collection resume authority prerequisite must be applied before migration 11.',
    );
  }
}

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  return (database.pragma(`table_info('${table}')`) as Array<{ name: string }>)
    .some((candidate) => candidate.name === column);
}

function canonicalSql(value: string): string {
  let output = '';
  let quoted = false;
  let pendingSpace = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      output += character;
      if (character === "'" && value[index + 1] === "'") {
        output += value[index + 1];
        index += 1;
      } else if (character === "'") {
        quoted = false;
      }
      continue;
    }
    if (character === "'") {
      if (pendingSpace && output.length > 0) output += ' ';
      pendingSpace = false;
      quoted = true;
      output += character;
    } else if (/\s/.test(character)) {
      pendingSpace = output.length > 0;
    } else {
      if (pendingSpace && output.length > 0) output += ' ';
      pendingSpace = false;
      output += character;
    }
  }
  return output.trim().replace(/;$/, '').trimEnd();
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
): StoreProviderIdentityAuthorityMigrationResult {
  return {
    version: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_VERSION,
    name: STORE_PROVIDER_IDENTITY_AUTHORITY_MIGRATION_NAME,
    status,
    startedAt,
    backfilledConnections: 0,
    migratedLingxingSelectors: 0,
    backfilledStableExternalIdentities: 0,
  };
}

function parseResult(value: string | null): StoreProviderIdentityAuthorityMigrationResult {
  if (!value) return defaultResult('applied', '');
  try {
    return JSON.parse(value) as StoreProviderIdentityAuthorityMigrationResult;
  } catch {
    return defaultResult('applied', '');
  }
}
