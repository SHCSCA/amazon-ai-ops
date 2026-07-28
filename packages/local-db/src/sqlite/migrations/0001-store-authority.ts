import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import type {
  StoreMigrationBackupManifest,
  StoreMigrationManifest,
  StoreMigrationQuarantineReason,
  StoreMigrationRecoveryPreflight,
  StoreMigrationRestoreResult,
  StoreMigrationResult,
  StoreMigrationTableResult,
} from './types';

export const STORE_AUTHORITY_MIGRATION_VERSION = 1;
export const STORE_AUTHORITY_MIGRATION_NAME = 'store-authority-v1';
export const LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM = 'store-authority-v1-20260722-02';
export const STORE_AUTHORITY_MIGRATION_CHECKSUM = 'store-authority-v1-20260727-03';

export const STORE_SCOPED_LEGACY_TABLES = [
  'products',
  'product_costs',
  'ad_daily_metrics',
  'inventory_daily_metrics',
  'action_recommendations',
  'action_logs',
  'approval_tasks',
  'lingxing_report_batches',
  'lingxing_report_files',
  'report_files',
  'operation_events',
  'download_center_diagnostics',
  'listing_content',
  'listing_content_versions',
  'listing_drafts',
  'ai_call_logs',
  'ai_diagnosis_runs',
  'keyword_metrics',
  'keyword_coverage',
  'keyword_opportunities',
  'listing_suggestions',
] as const;

type StoreScopedLegacyTable = typeof STORE_SCOPED_LEGACY_TABLES[number];
type SqlRow = Record<string, unknown>;

interface LegacyIdentity {
  storeName?: string;
  marketplaceCode?: string;
}

interface CandidateResolution {
  storeIds: string[];
  reasonWhenEmpty: StoreMigrationQuarantineReason;
  source: string;
  forcedReason?: StoreMigrationQuarantineReason;
}

interface StoreAuthorityMigrationDefinition {
  version: number;
  name: string;
  checksum: string;
  targetTables: readonly StoreScopedLegacyTable[];
  up(database: Database.Database, manifest: StoreMigrationManifest): StoreMigrationResult;
}

export interface StoreAuthorityQuarantineRepairResult {
  examinedRows: number;
  repairedRows: number;
  remainingPendingRows: number;
  passes: number;
}

interface MigrationStateRow {
  checksum: string;
  status: string;
  manifest_json: string | null;
  result_json: string | null;
}

interface StoreAuthorityLegacyChecksumProvenance {
  legacyChecksum: typeof LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM;
  promotedToChecksum: typeof STORE_AUTHORITY_MIGRATION_CHECKSUM;
  previousStatus: 'started' | 'failed';
  previousStartedAt: string;
  promotedAt: string;
}

type StoreAuthorityMigrationManifest = StoreMigrationManifest & {
  legacyChecksumProvenance?: StoreAuthorityLegacyChecksumProvenance;
};

type PendingQuarantineScope = 'v1' | 'all_versions';

const DIRECT_IDENTITY_TABLES = new Set<StoreScopedLegacyTable>([
  'products',
  'ad_daily_metrics',
  'inventory_daily_metrics',
  'action_recommendations',
  'lingxing_report_batches',
  'operation_events',
  'download_center_diagnostics',
  'listing_content',
  'listing_content_versions',
  'listing_drafts',
]);

const ASIN_SCOPE_AUTHORITY_TABLES = [
  'products',
  'listing_content',
  'listing_drafts',
] as const satisfies readonly StoreScopedLegacyTable[];

export class StoreAuthorityMigrationError extends Error {
  readonly version: number;

  constructor(version: number, message: string) {
    super(message);
    this.name = 'StoreAuthorityMigrationError';
    this.version = version;
  }
}

export function ensureSchemaMigrationsTable(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started', 'applied', 'failed')),
      started_at TEXT NOT NULL,
      applied_at TEXT,
      error_message TEXT,
      manifest_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT
    )
  `);
}

export function runStoreAuthorityMigrations(database: Database.Database): StoreMigrationResult[] {
  prepareStoreAuthorityMigrationBackup(database);
  return [runMigration(database, STORE_AUTHORITY_MIGRATION)];
}

/**
 * Persist a recoverable backup binding before legacy startup migrations run.
 * A pending manifest is written first so a crash after VACUUM INTO can be
 * retried without trusting or reusing an unbound file.
 */
export function prepareStoreAuthorityMigrationBackup(database: Database.Database): void {
  ensureSchemaMigrationsTable(database);
  const migration = STORE_AUTHORITY_MIGRATION;
  const existing = readMigrationState(database, migration.version);
  assertMigrationChecksumCompatibility(existing, migration);
  if (existing?.status === 'applied') return;

  const previousManifest = parseJson<StoreAuthorityMigrationManifest | undefined>(
    existing?.manifest_json,
    undefined,
  );
  if (existing?.checksum === LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM) {
    promoteLegacyPendingMigration(database, migration, existing, previousManifest);
    return;
  }
  if (previousManifest && isBoundBackupManifest(database, previousManifest.backup)) {
    const verifiedBackup = createOrReuseBackup(
      database,
      migration.version,
      previousManifest.integrityCheck,
      previousManifest.backup,
    );
    if (verifiedBackup.integrityCheck !== 'ok') {
      throw new StoreAuthorityMigrationError(
        migration.version,
        `Backup integrity_check returned: ${verifiedBackup.integrityCheck}`,
      );
    }
    return;
  }

  const integrityCheck = checkDatabaseIntegrity(database);
  const pendingManifest = createPendingMigrationManifest(database, migration, integrityCheck);
  const priorPendingProof = matchingPendingBackup(previousManifest?.backup, pendingManifest.backup);
  assertPreparationBackupPathIsOwned(
    migration.version,
    pendingManifest.backup,
    priorPendingProof,
  );
  const startedResult = createStartedResult(migration, pendingManifest.startedAt);
  upsertMigrationState(database, migration, pendingManifest, startedResult, 'started');

  try {
    if (integrityCheck !== 'ok') {
      throw new StoreAuthorityMigrationError(
        migration.version,
        `Source database integrity_check returned: ${integrityCheck}`,
      );
    }
    const backup = createOrReuseBackup(
      database,
      migration.version,
      integrityCheck,
      previousManifest?.backup ?? pendingManifest.backup,
      priorPendingProof,
    );
    if (backup.integrityCheck !== 'ok') {
      throw new StoreAuthorityMigrationError(
        migration.version,
        `Backup integrity_check returned: ${backup.integrityCheck}`,
      );
    }
    const boundManifest = { ...pendingManifest, backup };
    database.prepare(`
      UPDATE schema_migrations
      SET manifest_json = @manifestJson
      WHERE version = @version AND status = 'started'
    `).run({
      version: migration.version,
      manifestJson: JSON.stringify(boundManifest),
    });
  } catch (error) {
    const failedResult: StoreMigrationResult = {
      ...startedResult,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: errorMessage(error),
    };
    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed', applied_at = NULL,
          error_message = @errorMessage, result_json = @resultJson
      WHERE version = @version
    `).run({
      version: migration.version,
      errorMessage: failedResult.errorMessage,
      resultJson: JSON.stringify(failedResult),
    });
    if (error instanceof StoreAuthorityMigrationError) throw error;
    throw new StoreAuthorityMigrationError(migration.version, failedResult.errorMessage || 'Backup preparation failed.');
  }
}

function promoteLegacyPendingMigration(
  database: Database.Database,
  migration: StoreAuthorityMigrationDefinition,
  existing: MigrationStateRow,
  previousManifest: StoreAuthorityMigrationManifest | undefined,
): void {
  if ((existing.status !== 'started' && existing.status !== 'failed')
    || !previousManifest
    || previousManifest.checksum !== LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM
    || !isBoundBackupManifest(database, previousManifest.backup)) {
    throw new StoreAuthorityMigrationError(
      migration.version,
      'Legacy migration 1 can be promoted only from a started/failed state with its original bound backup.',
    );
  }
  const verifiedBackup = createOrReuseBackup(
    database,
    migration.version,
    previousManifest.integrityCheck,
    previousManifest.backup,
  );
  if (verifiedBackup.integrityCheck !== 'ok') {
    throw new StoreAuthorityMigrationError(
      migration.version,
      `Backup integrity_check returned: ${verifiedBackup.integrityCheck}`,
    );
  }
  const promotedAt = new Date().toISOString();
  const promotedManifest: StoreAuthorityMigrationManifest = {
    ...previousManifest,
    checksum: migration.checksum,
    startedAt: promotedAt,
    backup: verifiedBackup,
    legacyChecksumProvenance: {
      legacyChecksum: LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM,
      promotedToChecksum: STORE_AUTHORITY_MIGRATION_CHECKSUM,
      previousStatus: existing.status,
      previousStartedAt: previousManifest.startedAt,
      promotedAt,
    },
  };
  const startedResult = createStartedResult(migration, promotedAt);
  upsertMigrationState(database, migration, promotedManifest, startedResult, 'started');
}

export function getStoreMigrationRecoveryPreflight(
  manifest: StoreMigrationManifest,
): StoreMigrationRecoveryPreflight {
  const blockers: string[] = [];
  const backupPath = manifest.backup.backupPath;
  let backupIntegrityCheck: string | undefined;
  let backupSha256: string | undefined;

  if (!backupPath) {
    blockers.push('No file-backed pre-migration backup is available.');
  } else if (!fs.existsSync(backupPath)) {
    blockers.push(`Pre-migration backup is missing: ${backupPath}`);
  } else {
    try {
      backupIntegrityCheck = checkDatabaseFileIntegrity(backupPath);
      if (backupIntegrityCheck !== 'ok') {
        blockers.push(`Pre-migration backup integrity_check returned: ${backupIntegrityCheck}`);
      }
      backupSha256 = hashFile(backupPath);
      if (!manifest.backup.sha256) {
        blockers.push('Pre-migration backup manifest does not contain a SHA-256 binding.');
      } else if (backupSha256 !== manifest.backup.sha256) {
        blockers.push('Pre-migration backup SHA-256 does not match its manifest.');
      }
    } catch (error) {
      blockers.push(`Pre-migration backup cannot be opened: ${errorMessage(error)}`);
    }
  }

  return {
    version: manifest.version,
    canRestore: blockers.length === 0,
    backupPath,
    backupIntegrityCheck,
    backupSha256,
    blockers,
  };
}

export function restoreStoreMigrationBackupTo(
  manifest: StoreMigrationManifest,
  destinationPath: string,
): StoreMigrationRestoreResult {
  const preflight = getStoreMigrationRecoveryPreflight(manifest);
  if (!preflight.canRestore || !preflight.backupPath || !manifest.backup.sha256) {
    throw new StoreAuthorityMigrationError(
      manifest.version,
      `Migration backup is not recoverable: ${preflight.blockers.join(' ')}`,
    );
  }
  if (typeof destinationPath !== 'string' || destinationPath.trim() === '') {
    throw new StoreAuthorityMigrationError(manifest.version, 'Restore destination path is required.');
  }
  const sourcePath = path.resolve(preflight.backupPath);
  const resolvedDestination = path.resolve(destinationPath);
  if (resolvedDestination === sourcePath
    || (manifest.backup.databasePath && resolvedDestination === path.resolve(manifest.backup.databasePath))) {
    throw new StoreAuthorityMigrationError(
      manifest.version,
      'Restore destination must be a new file, never the source database or backup.',
    );
  }
  if (fs.existsSync(resolvedDestination)) {
    throw new StoreAuthorityMigrationError(
      manifest.version,
      `Restore destination already exists: ${resolvedDestination}`,
    );
  }

  const restoreTempDirectory = fs.mkdtempSync(path.join(
    path.dirname(resolvedDestination),
    `${path.basename(resolvedDestination)}.restore-`,
  ));
  const restoreTempPath = path.join(restoreTempDirectory, 'backup.db');
  try {
    // Copy and verify inside a directory created exclusively by this attempt.
    // Publishing uses link(2), whose create-if-absent behavior cannot overwrite
    // a destination won by another actor between the precheck and publication.
    fs.copyFileSync(sourcePath, restoreTempPath, fs.constants.COPYFILE_EXCL);
    const integrityCheck = checkDatabaseFileIntegrity(restoreTempPath);
    const sha256 = hashFile(restoreTempPath);
    if (integrityCheck !== 'ok' || sha256 !== manifest.backup.sha256) {
      throw new StoreAuthorityMigrationError(
        manifest.version,
        `Restored copy verification failed (integrity=${integrityCheck}, sha256=${sha256}).`,
      );
    }
    const sizeBytes = fs.statSync(restoreTempPath).size;
    fs.linkSync(restoreTempPath, resolvedDestination);
    return {
      version: manifest.version,
      sourceBackupPath: sourcePath,
      destinationPath: resolvedDestination,
      integrityCheck,
      sha256,
      sizeBytes,
    };
  } finally {
    // The directory is owned by this invocation, so even a partial copy can be
    // removed without making claims about the caller-selected destination.
    fs.rmSync(restoreTempDirectory, { recursive: true, force: true });
  }
}

function readMigrationState(
  database: Database.Database,
  version: number,
): MigrationStateRow | undefined {
  return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations
    WHERE version = ?
  `).get(version) as MigrationStateRow | undefined;
}

function assertMigrationChecksumCompatibility(
  existing: MigrationStateRow | undefined,
  migration: StoreAuthorityMigrationDefinition,
): void {
  if (existing
    && existing.checksum !== migration.checksum
    && existing.checksum !== LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new StoreAuthorityMigrationError(
      migration.version,
      `Migration ${migration.version} checksum does not match the recorded migration.`,
    );
  }
}

function createStartedResult(
  migration: StoreAuthorityMigrationDefinition,
  startedAt: string,
): StoreMigrationResult {
  return {
    version: migration.version,
    name: migration.name,
    status: 'started',
    startedAt,
    tableResults: [],
    mappedRows: 0,
    quarantinedRows: 0,
    createdStores: 0,
  };
}

function upsertMigrationState(
  database: Database.Database,
  migration: StoreAuthorityMigrationDefinition,
  manifest: StoreMigrationManifest,
  result: StoreMigrationResult,
  status: 'started',
): void {
  database.prepare(`
    INSERT INTO schema_migrations (
      version, name, checksum, status, started_at, applied_at,
      error_message, manifest_json, result_json
    ) VALUES (
      @version, @name, @checksum, @status, @startedAt, NULL,
      NULL, @manifestJson, @resultJson
    )
    ON CONFLICT(version) DO UPDATE SET
      name = excluded.name,
      checksum = excluded.checksum,
      status = excluded.status,
      started_at = excluded.started_at,
      applied_at = NULL,
      error_message = NULL,
      manifest_json = excluded.manifest_json,
      result_json = excluded.result_json
  `).run({
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum,
    status,
    startedAt: manifest.startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(result),
  });
}

function isBoundBackupManifest(
  database: Database.Database,
  backup: StoreMigrationBackupManifest,
): boolean {
  const databasePath = database.name;
  if (!databasePath || databasePath === ':memory:' || databasePath.startsWith('file::memory:')) {
    return backup.status === 'not_applicable';
  }
  const absoluteDatabasePath = path.resolve(databasePath);
  const expectedBackupPath = `${absoluteDatabasePath}.pre-store-authority-v${STORE_AUTHORITY_MIGRATION_VERSION}.bak`;
  return (backup.status === 'created' || backup.status === 'reused')
    && Boolean(backup.sha256)
    && sameResolvedPath(backup.databasePath, absoluteDatabasePath)
    && sameResolvedPath(backup.backupPath, expectedBackupPath);
}

function runMigration(
  database: Database.Database,
  migration: StoreAuthorityMigrationDefinition,
): StoreMigrationResult {
  const existing = readMigrationState(database, migration.version);
  assertMigrationChecksumCompatibility(existing, migration);
  if (existing?.status === 'applied') {
    const appliedManifest = parseJson<StoreAuthorityMigrationManifest | undefined>(
      existing.manifest_json,
      undefined,
    );
    if (!appliedManifest || appliedManifest.checksum !== existing.checksum) {
      throw new StoreAuthorityMigrationError(
        migration.version,
        `Migration ${migration.version} applied manifest checksum does not match recorded history.`,
      );
    }
    verifyStoreAuthoritySchema(database, migration.targetTables);
    return parseJson<StoreMigrationResult>(existing.result_json, {
      version: migration.version,
      name: migration.name,
      status: 'applied',
      startedAt: '',
      tableResults: [],
      mappedRows: 0,
      quarantinedRows: 0,
      createdStores: 0,
    });
  }
  if (existing?.checksum === LEGACY_STORE_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new StoreAuthorityMigrationError(
      migration.version,
      'Legacy migration 1 must be promoted with its bound backup before execution.',
    );
  }

  const manifest = parseJson<StoreAuthorityMigrationManifest | undefined>(existing?.manifest_json, undefined);
  if (!manifest
    || manifest.checksum !== migration.checksum
    || !isBoundBackupManifest(database, manifest.backup)) {
    throw new StoreAuthorityMigrationError(
      migration.version,
      `Migration ${migration.version} does not have a bound pre-migration backup.`,
    );
  }
  const startedResult = createStartedResult(migration, manifest.startedAt);
  upsertMigrationState(database, migration, manifest, startedResult, 'started');

  try {
    if (manifest.integrityCheck !== 'ok') {
      throw new StoreAuthorityMigrationError(
        migration.version,
        `Source database integrity_check returned: ${manifest.integrityCheck}`,
      );
    }
    if (manifest.backup.backupPath && manifest.backup.integrityCheck !== 'ok') {
      throw new StoreAuthorityMigrationError(
        migration.version,
        `Backup integrity_check returned: ${manifest.backup.integrityCheck}`,
      );
    }

    const apply = database.transaction(() => {
      const result = migration.up(database, manifest);
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: migration.version,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    });
    return apply();
  } catch (error) {
    const failedResult: StoreMigrationResult = {
      ...startedResult,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorMessage: errorMessage(error),
    };
    database.prepare(`
      UPDATE schema_migrations
      SET status = 'failed', applied_at = NULL,
          error_message = @errorMessage, result_json = @resultJson
      WHERE version = @version
    `).run({
      version: migration.version,
      errorMessage: failedResult.errorMessage,
      resultJson: JSON.stringify(failedResult),
    });
    if (error instanceof StoreAuthorityMigrationError) throw error;
    throw new StoreAuthorityMigrationError(migration.version, failedResult.errorMessage || 'Migration failed.');
  }
}

function createPendingMigrationManifest(
  database: Database.Database,
  migration: StoreAuthorityMigrationDefinition,
  integrityCheck: string,
): StoreMigrationManifest {
  const tableRowCounts = Object.fromEntries(
    migration.targetTables.map((table) => [table, tableExists(database, table) ? countRows(database, table) : 0]),
  );

  return {
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum,
    startedAt: new Date().toISOString(),
    schemaFingerprint: schemaFingerprint(database),
    integrityCheck,
    tableRowCounts,
    targetTables: [...migration.targetTables],
    backup: pendingBackupManifest(database, migration.version, integrityCheck),
  };
}

function pendingBackupManifest(
  database: Database.Database,
  version: number,
  sourceIntegrityCheck: string,
): StoreMigrationBackupManifest {
  const databasePath = database.name;
  if (!databasePath || databasePath === ':memory:' || databasePath.startsWith('file::memory:')) {
    return { status: 'not_applicable', integrityCheck: sourceIntegrityCheck };
  }
  const absoluteDatabasePath = path.resolve(databasePath);
  return {
    status: 'pending',
    databasePath: absoluteDatabasePath,
    backupPath: `${absoluteDatabasePath}.pre-store-authority-v${version}.bak`,
    integrityCheck: sourceIntegrityCheck,
  };
}

function matchingPendingBackup(
  previousBackup: StoreMigrationBackupManifest | undefined,
  pendingBackup: StoreMigrationBackupManifest,
): boolean {
  return previousBackup?.status === 'pending'
    && pendingBackup.status === 'pending'
    && Boolean(previousBackup.databasePath && pendingBackup.databasePath)
    && Boolean(previousBackup.backupPath && pendingBackup.backupPath)
    && sameResolvedPath(previousBackup.databasePath, pendingBackup.databasePath!)
    && sameResolvedPath(previousBackup.backupPath, pendingBackup.backupPath!);
}

function assertPreparationBackupPathIsOwned(
  version: number,
  pendingBackup: StoreMigrationBackupManifest,
  priorPendingProof: boolean,
): void {
  if (pendingBackup.status !== 'pending' || !pendingBackup.backupPath) return;
  if (fs.existsSync(pendingBackup.backupPath) && !priorPendingProof) {
    throw new StoreAuthorityMigrationError(
      version,
      'An unbound pre-migration backup already exists; refusing to replace or reuse it.',
    );
  }
}

function createOrReuseBackup(
  database: Database.Database,
  version: number,
  sourceIntegrityCheck: string,
  previousBackup?: StoreMigrationBackupManifest,
  allowPendingCleanup = false,
): StoreMigrationBackupManifest {
  const databasePath = database.name;
  if (!databasePath || databasePath === ':memory:' || databasePath.startsWith('file::memory:')) {
    return { status: 'not_applicable', integrityCheck: sourceIntegrityCheck };
  }

  const absoluteDatabasePath = path.resolve(databasePath);
  const backupPath = `${absoluteDatabasePath}.pre-store-authority-v${version}.bak`;
  if (fs.existsSync(backupPath)) {
    if (previousBackup?.sha256) {
      const sha256 = hashFile(backupPath);
      if (previousBackup.sha256 !== sha256) {
        throw new StoreAuthorityMigrationError(
          version,
          'The bound pre-migration backup changed; refusing to reuse it.',
        );
      }
      return {
        status: 'reused',
        databasePath: absoluteDatabasePath,
        backupPath,
        integrityCheck: checkDatabaseFileIntegrity(backupPath),
        sha256,
        sizeBytes: fs.statSync(backupPath).size,
      };
    }
    const pendingPathMatches = previousBackup?.status === 'pending'
      && sameResolvedPath(previousBackup.databasePath, absoluteDatabasePath)
      && sameResolvedPath(previousBackup.backupPath, backupPath);
    if (!pendingPathMatches || !allowPendingCleanup) {
      throw new StoreAuthorityMigrationError(
        version,
        'An unbound pre-migration backup already exists; refusing to reuse it.',
      );
    }
    // The pending database row was committed before VACUUM INTO. A file with
    // that exact binding is an interrupted attempt, never trusted as a backup.
    fs.unlinkSync(backupPath);
  } else if (previousBackup?.sha256) {
    throw new StoreAuthorityMigrationError(
      version,
      `The bound pre-migration backup is missing: ${backupPath}`,
    );
  }

  if (sourceIntegrityCheck !== 'ok') {
    throw new StoreAuthorityMigrationError(
      version,
      `Source database integrity_check returned: ${sourceIntegrityCheck}`,
    );
  }

  database.pragma('wal_checkpoint(FULL)');
  database.exec(`VACUUM INTO ${sqlStringLiteral(backupPath)}`);
  const backup: StoreMigrationBackupManifest = {
    status: 'created',
    databasePath: absoluteDatabasePath,
    backupPath,
    integrityCheck: checkDatabaseFileIntegrity(backupPath),
    sha256: hashFile(backupPath),
    sizeBytes: fs.statSync(backupPath).size,
  };
  if (backup.integrityCheck !== 'ok') {
    throw new StoreAuthorityMigrationError(
      version,
      `Backup integrity_check returned: ${backup.integrityCheck}`,
    );
  }
  return backup;
}

function createStoreAuthorityTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      store_id TEXT PRIMARY KEY NOT NULL,
      browser_profile_id TEXT NOT NULL,
      marketplace TEXT NOT NULL DEFAULT 'US' CHECK (marketplace = 'US'),
      currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
      business_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      legacy_store_name_normalized TEXT,
      legacy_marketplace_code_normalized TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_store_id_nocase
      ON stores(lower(store_id));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_browser_profile_id_nocase
      ON stores(lower(browser_profile_id));
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_legacy_identity
      ON stores(legacy_store_name_normalized, legacy_marketplace_code_normalized)
      WHERE legacy_store_name_normalized IS NOT NULL
        AND legacy_marketplace_code_normalized IS NOT NULL;

    CREATE TABLE IF NOT EXISTS store_connections (
      id TEXT PRIMARY KEY NOT NULL,
      store_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('lingxing', 'amazon_ads')),
      status TEXT NOT NULL DEFAULT 'not_configured'
        CHECK (status IN ('not_configured', 'checking', 'ready', 'attention_required', 'blocked')),
      account_label TEXT,
      external_account_id TEXT,
      last_verified_at TEXT,
      last_failure_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (store_id) REFERENCES stores(store_id),
      UNIQUE (store_id, provider)
    );
    CREATE INDEX IF NOT EXISTS idx_store_connections_store_id
      ON store_connections(store_id);

    CREATE TABLE IF NOT EXISTS store_session_metadata (
      store_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('lingxing', 'amazon_ads')),
      browser_profile_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (status IN ('unknown', 'signed_out', 'checking', 'ready', 'expired', 'blocked')),
      session_generation INTEGER NOT NULL DEFAULT 0 CHECK (session_generation >= 0),
      observed_at TEXT NOT NULL,
      account_label TEXT,
      external_account_id TEXT,
      verified_at TEXT,
      expires_at TEXT,
      failure_code TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (store_id, provider),
      FOREIGN KEY (store_id) REFERENCES stores(store_id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_session_metadata_store_generation
      ON store_session_metadata(store_id, session_generation);

    CREATE TABLE IF NOT EXISTS store_migration_quarantine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_version INTEGER NOT NULL,
      source_table TEXT NOT NULL,
      source_row_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      normalized_store_name TEXT,
      normalized_marketplace_code TEXT,
      candidate_store_ids_json TEXT NOT NULL DEFAULT '[]',
      source_identity_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
      resolved_store_id TEXT,
      resolution_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      UNIQUE (migration_version, source_table, source_row_id),
      FOREIGN KEY (resolved_store_id) REFERENCES stores(store_id)
    );
    CREATE INDEX IF NOT EXISTS idx_store_migration_quarantine_status
      ON store_migration_quarantine(migration_version, status, source_table);
  `);
}

function applyStoreAuthorityMigration(
  database: Database.Database,
  manifest: StoreMigrationManifest,
): StoreMigrationResult {
  createStoreAuthorityTables(database);
  const storeIdColumnAdditions = addLegacyStoreIdColumns(database);
  const createdStores = seedLegacyStores(database);
  primeDirectStoreOwnership(database);
  const tableResults = STORE_SCOPED_LEGACY_TABLES.map((table) => migrateLegacyTable(
    database,
    table,
    storeIdColumnAdditions.get(table) ?? false,
  ));
  verifyStoreAuthoritySchema(database, STORE_SCOPED_LEGACY_TABLES);

  return {
    version: STORE_AUTHORITY_MIGRATION_VERSION,
    name: STORE_AUTHORITY_MIGRATION_NAME,
    status: 'applied',
    startedAt: manifest.startedAt,
    finishedAt: new Date().toISOString(),
    tableResults,
    mappedRows: tableResults.reduce((total, result) => total + result.mappedRows, 0),
    quarantinedRows: tableResults.reduce((total, result) => total + result.quarantinedRows, 0),
    createdStores,
  };
}

/**
 * Revisit only the fail-closed v1 rows whose original blocker was missing
 * ownership evidence. This is intentionally exported for the forward v9
 * repair migration: already-applied legacy v1 history remains read-only while
 * newly executed or explicitly promoted v1 work records the current checksum.
 *
 * Ambiguous, conflicting, unsupported, duplicate, and invalid-id quarantines
 * remain operator-owned. A row is repaired only when current authority data
 * proves exactly one store, or when the row already carries that same valid
 * store id. Multiple passes allow a newly repaired parent to unlock a child.
 */
export function repairPendingStoreAuthorityQuarantines(
  database: Database.Database,
): StoreAuthorityQuarantineRepairResult {
  const eligibleReasons = new Set<StoreMigrationQuarantineReason>([
    'missing_store_identity',
    'missing_parent_store',
  ]);
  const pending = database.prepare(`
    SELECT id, source_table, source_row_id, reason
    FROM store_migration_quarantine
    WHERE migration_version = ?
      AND status = 'pending'
    ORDER BY id
  `).all(STORE_AUTHORITY_MIGRATION_VERSION) as Array<{
    id: number;
    source_table: string;
    source_row_id: string;
    reason: StoreMigrationQuarantineReason;
  }>;
  const eligible = pending.filter((item) => (
    (STORE_SCOPED_LEGACY_TABLES as readonly string[]).includes(item.source_table)
    && eligibleReasons.has(item.reason)
  ));
  const repaired = new Set<number>();
  let passes = 0;
  let changed = true;
  const maximumPasses = Math.max(1, eligible.length + 1);

  while (changed && passes < maximumPasses) {
    changed = false;
    passes += 1;
    for (const quarantine of eligible) {
      if (repaired.has(quarantine.id)) continue;
      const table = quarantine.source_table as StoreScopedLegacyTable;
      if (!tableExists(database, table) || !hasColumn(database, table, 'store_id')) continue;
      const identityColumn = hasColumn(database, table, 'id') ? 'id' : 'rowid';
      const row = database.prepare(`
        SELECT rowid AS __migration_rowid, *
        FROM ${quoteIdentifier(table)}
        WHERE CAST(${quoteIdentifier(identityColumn)} AS TEXT) = ?
        LIMIT 1
      `).get(quarantine.source_row_id) as SqlRow | undefined;
      if (!row) continue;
      const otherPendingQuarantine = database.prepare(`
        SELECT 1
        FROM store_migration_quarantine
        WHERE source_table = ?
          AND source_row_id = ?
          AND status = 'pending'
          AND id <> ?
        LIMIT 1
      `).get(table, quarantine.source_row_id, quarantine.id);
      if (otherPendingQuarantine) continue;

      const identity = identityFromRow(table, row);
      const resolution = resolveRowStore(database, table, row, identity, 'all_versions');
      if (resolution.forcedReason) continue;

      const existingStoreId = nonEmptyString(row.store_id);
      const existingIsValid = existingStoreId ? storeExists(database, existingStoreId) : false;
      const uniqueCandidates = [...new Set(resolution.storeIds)];
      let resolvedStoreId: string | undefined;
      if (existingStoreId && existingIsValid) {
        if (uniqueCandidates.length > 0 && uniqueCandidates.some((candidate) => candidate !== existingStoreId)) {
          continue;
        }
        resolvedStoreId = existingStoreId;
      } else if (!existingStoreId && uniqueCandidates.length === 1) {
        resolvedStoreId = uniqueCandidates[0];
      }
      if (!resolvedStoreId) continue;

      const hasQuarantineMarker = hasColumn(database, table, 'store_authority_quarantined');
      const quarantineMarkerSet = hasQuarantineMarker
        && Number(row.store_authority_quarantined ?? 0) !== 0;
      if (!existingStoreId || quarantineMarkerSet) {
        try {
          const write = database.prepare(`
            UPDATE ${quoteIdentifier(table)}
            SET store_id = @resolvedStoreId
              ${hasQuarantineMarker ? ', store_authority_quarantined = 0' : ''}
            WHERE rowid = @rowId
              AND (store_id IS NULL OR store_id = @resolvedStoreId)
          `).run({
            resolvedStoreId,
            rowId: row.__migration_rowid,
          });
          if (write.changes !== 1) continue;
        } catch (error) {
          if (isSqliteConstraintError(error)) continue;
          throw error;
        }
      }
      const resolvedAt = new Date().toISOString();
      const quarantineResolution = database.prepare(`
        UPDATE store_migration_quarantine
        SET status = 'resolved',
            resolved_store_id = @resolvedStoreId,
            resolution_note = @resolutionNote,
            resolved_at = @resolvedAt,
            updated_at = @resolvedAt
        WHERE id = @id
          AND migration_version = @migrationVersion
          AND status = 'pending'
      `).run({
        id: quarantine.id,
        migrationVersion: STORE_AUTHORITY_MIGRATION_VERSION,
        resolvedAt,
        resolvedStoreId,
        resolutionNote: 'Automatically repaired by store-authority quarantine repair v9 from current unique authority evidence.',
      });
      if (quarantineResolution.changes !== 1) {
        throw new StoreAuthorityMigrationError(
          STORE_AUTHORITY_MIGRATION_VERSION,
          `Store authority quarantine ${quarantine.id} changed concurrently during v9 repair.`,
        );
      }
      repaired.add(quarantine.id);
      changed = true;
    }
  }

  const remainingPendingRows = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM store_migration_quarantine
    WHERE migration_version = ? AND status = 'pending'
  `).get(STORE_AUTHORITY_MIGRATION_VERSION) as { count: number }).count);
  return {
    examinedRows: eligible.length,
    repairedRows: repaired.size,
    remainingPendingRows,
    passes,
  };
}

function isSqliteConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return code === 'SQLITE_CONSTRAINT' || code.startsWith('SQLITE_CONSTRAINT_');
}

function addLegacyStoreIdColumns(
  database: Database.Database,
): ReadonlyMap<StoreScopedLegacyTable, boolean> {
  const additions = new Map<StoreScopedLegacyTable, boolean>();
  for (const table of STORE_SCOPED_LEGACY_TABLES) {
    if (!tableExists(database, table)) {
      additions.set(table, false);
      continue;
    }
    const added = !hasColumn(database, table, 'store_id');
    if (added) {
      database.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN store_id TEXT`);
    }
    additions.set(table, added);
  }
  return additions;
}

function primeDirectStoreOwnership(database: Database.Database): void {
  for (const table of ASIN_SCOPE_AUTHORITY_TABLES) {
    if (!tableExists(database, table)
      || !hasColumn(database, table, 'store_id')
      || !hasColumn(database, table, 'store_name')
      || !hasColumn(database, table, 'marketplace_code')) {
      continue;
    }
    const rows = database.prepare(`
      SELECT rowid AS __migration_rowid, store_id, store_name, marketplace_code
      FROM ${quoteIdentifier(table)}
      WHERE store_id IS NULL
        AND store_name IS NOT NULL AND trim(store_name) <> ''
        AND marketplace_code IS NOT NULL AND trim(marketplace_code) <> ''
    `).all() as SqlRow[];
    for (const row of rows) {
      const storeName = normalizeStoreName(row.store_name);
      const marketplaceCode = normalizeMarketplaceCode(row.marketplace_code);
      if (!storeName || marketplaceCode !== 'US') continue;
      const candidates = findStoresForIdentity(database, storeName, marketplaceCode);
      if (candidates.length !== 1) continue;
      database.prepare(`
        UPDATE ${quoteIdentifier(table)}
        SET store_id = ?
        WHERE rowid = ? AND store_id IS NULL
      `).run(candidates[0], row.__migration_rowid);
    }
  }
}

function seedLegacyStores(database: Database.Database): number {
  const identities = new Map<string, { storeName: string; marketplaceCode: string }>();
  for (const table of DIRECT_IDENTITY_TABLES) {
    if (!tableExists(database, table)
      || !hasColumn(database, table, 'store_name')
      || !hasColumn(database, table, 'marketplace_code')) {
      continue;
    }
    const rows = database.prepare(`
      SELECT DISTINCT store_name, marketplace_code
      FROM ${quoteIdentifier(table)}
      WHERE store_name IS NOT NULL AND trim(store_name) <> ''
        AND marketplace_code IS NOT NULL AND trim(marketplace_code) <> ''
    `).all() as Array<{ store_name: unknown; marketplace_code: unknown }>;
    for (const row of rows) {
      const storeName = normalizeStoreName(row.store_name);
      const marketplaceCode = normalizeMarketplaceCode(row.marketplace_code);
      if (!storeName || marketplaceCode !== 'US') continue;
      const key = identityKey(storeName, marketplaceCode);
      const displayName = String(row.store_name).trim().replace(/\s+/g, ' ');
      const previous = identities.get(key);
      if (!previous || displayName.localeCompare(previous.storeName) < 0) {
        identities.set(key, { storeName: displayName, marketplaceCode });
      }
    }
  }

  let created = 0;
  const now = new Date().toISOString();
  for (const [key, identity] of [...identities.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const normalizedStoreName = normalizeStoreName(identity.storeName);
    const candidates = findStoresForIdentity(database, normalizedStoreName, identity.marketplaceCode);
    if (candidates.length === 1) {
      database.prepare(`
        UPDATE stores
        SET legacy_store_name_normalized = COALESCE(legacy_store_name_normalized, @storeName),
            legacy_marketplace_code_normalized = COALESCE(legacy_marketplace_code_normalized, @marketplaceCode)
        WHERE store_id = @storeId
      `).run({
        storeId: candidates[0],
        storeName: normalizedStoreName,
        marketplaceCode: identity.marketplaceCode,
      });
      continue;
    }
    if (candidates.length > 1) continue;

    const hash = createHash('sha256').update(key).digest('hex').slice(0, 16);
    const storeId = `legacy-${hash}`;
    database.prepare(`
      INSERT INTO stores (
        store_id, browser_profile_id, marketplace, currency, display_name,
        status, business_timezone, legacy_store_name_normalized,
        legacy_marketplace_code_normalized, created_at, updated_at
      ) VALUES (
        @storeId, @browserProfileId, 'US', 'USD', @displayName,
        'active', 'America/Los_Angeles', @normalizedStoreName,
        @marketplaceCode, @createdAt, @updatedAt
      )
      ON CONFLICT(store_id) DO NOTHING
    `).run({
      storeId,
      browserProfileId: `${storeId}-profile`,
      displayName: identity.storeName,
      normalizedStoreName,
      marketplaceCode: identity.marketplaceCode,
      createdAt: now,
      updatedAt: now,
    });
    if (findStoresForIdentity(database, normalizedStoreName, identity.marketplaceCode).length === 1) {
      created += 1;
    }
  }
  return created;
}

function migrateLegacyTable(
  database: Database.Database,
  table: StoreScopedLegacyTable,
  storeIdColumnAdded: boolean,
): StoreMigrationTableResult {
  const indexName = `idx_${table}_store_id`;
  if (!tableExists(database, table)) {
    return {
      table,
      totalRows: 0,
      mappedRows: 0,
      quarantinedRows: 0,
      storeIdColumnAdded: false,
      indexName,
      skipped: true,
    };
  }

  database.exec(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)} ON ${quoteIdentifier(table)}(store_id)`);

  const rows = database.prepare(`SELECT rowid AS __migration_rowid, * FROM ${quoteIdentifier(table)}`).all() as SqlRow[];
  for (const row of rows) migrateLegacyRow(database, table, row);

  const totalRows = rows.length;
  const identityColumn = hasColumn(database, table, 'id') ? 'id' : 'rowid';
  const mappedRows = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM ${quoteIdentifier(table)} legacy
    JOIN stores authority ON authority.store_id = legacy.store_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM store_migration_quarantine quarantine
      WHERE quarantine.migration_version = ${STORE_AUTHORITY_MIGRATION_VERSION}
        AND quarantine.source_table = ${sqlStringLiteral(table)}
        AND quarantine.source_row_id = CAST(legacy.${quoteIdentifier(identityColumn)} AS TEXT)
        AND quarantine.status = 'pending'
    )
  `).get() as { count: number }).count);
  const quarantinedRows = Number((database.prepare(`
    SELECT COUNT(*) AS count
    FROM store_migration_quarantine
    WHERE migration_version = ? AND source_table = ? AND status = 'pending'
  `).get(STORE_AUTHORITY_MIGRATION_VERSION, table) as { count: number }).count);

  if (totalRows !== mappedRows + quarantinedRows) {
    throw new StoreAuthorityMigrationError(
      STORE_AUTHORITY_MIGRATION_VERSION,
      `Store migration accounting failed for ${table}: ${totalRows} != ${mappedRows} + ${quarantinedRows}.`,
    );
  }

  return {
    table,
    totalRows,
    mappedRows,
    quarantinedRows,
    storeIdColumnAdded,
    indexName,
    skipped: false,
  };
}

function migrateLegacyRow(
  database: Database.Database,
  table: StoreScopedLegacyTable,
  row: SqlRow,
): void {
  const rowId = String(row.id ?? row.__migration_rowid);
  const identity = identityFromRow(table, row);
  const existingStoreId = nonEmptyString(row.store_id);
  const existingIsValid = existingStoreId ? storeExists(database, existingStoreId) : false;
  const resolution = resolveRowStore(database, table, row, identity, 'v1');

  if (existingStoreId && !existingIsValid) {
    quarantineRow(database, table, rowId, 'invalid_existing_store_id', identity, [], row);
    return;
  }
  if (existingStoreId && existingIsValid && resolution.forcedReason) {
    quarantineRow(
      database,
      table,
      rowId,
      resolution.forcedReason,
      identity,
      [...new Set([existingStoreId, ...resolution.storeIds])],
      row,
    );
    return;
  }
  if (existingStoreId && resolution.storeIds.length === 1 && resolution.storeIds[0] !== existingStoreId) {
    quarantineRow(
      database,
      table,
      rowId,
      'cross_store_conflict',
      identity,
      [...new Set([existingStoreId, ...resolution.storeIds])],
      row,
    );
    return;
  }
  if (existingStoreId && existingIsValid) return;

  if (resolution.forcedReason) {
    quarantineRow(
      database,
      table,
      rowId,
      resolution.forcedReason,
      identity,
      resolution.storeIds,
      row,
    );
    return;
  }
  if (resolution.storeIds.length === 1) {
    database.prepare(`
      UPDATE ${quoteIdentifier(table)}
      SET store_id = ?
      WHERE rowid = ? AND store_id IS NULL
    `).run(resolution.storeIds[0], row.__migration_rowid);
    return;
  }

  const reason = resolution.forcedReason ?? (resolution.storeIds.length > 1
    ? (resolution.source === 'direct' ? 'ambiguous_store_identity' : 'ambiguous_parent_store')
    : resolution.reasonWhenEmpty);
  quarantineRow(database, table, rowId, reason, identity, resolution.storeIds, row);
}

function resolveRowStore(
  database: Database.Database,
  table: StoreScopedLegacyTable,
  row: SqlRow,
  identity: LegacyIdentity,
  pendingQuarantineScope: PendingQuarantineScope,
): CandidateResolution {
  const explicitParent = explicitParentCandidates(database, table, row, pendingQuarantineScope);
  const normalizedStoreName = normalizeStoreName(identity.storeName);
  const marketplaceCode = normalizeMarketplaceCode(identity.marketplaceCode);
  const hasPartialDirectIdentity = Boolean(identity.storeName || identity.marketplaceCode);
  const hasCompleteDirectIdentity = Boolean(normalizedStoreName && marketplaceCode);
  let direct: CandidateResolution | undefined;

  if (hasPartialDirectIdentity) {
    if (marketplaceCode && marketplaceCode !== 'US') {
      return {
        storeIds: explicitParent?.storeIds ?? [],
        reasonWhenEmpty: 'unsupported_marketplace',
        source: 'direct',
        forcedReason: 'unsupported_marketplace',
      };
    }
    direct = {
      storeIds: hasCompleteDirectIdentity
        ? findStoresForIdentity(database, normalizedStoreName, marketplaceCode)
        : [],
      reasonWhenEmpty: 'missing_store_identity',
      source: 'direct',
    };
  }

  if (direct && explicitParent) {
    if (direct.storeIds.length > 1) return direct;
    if (explicitParent.storeIds.length > 1) return explicitParent;
    if (direct.storeIds.length === 1 && explicitParent.storeIds.length === 1) {
      if (direct.storeIds[0] !== explicitParent.storeIds[0]) {
        return {
          storeIds: [...new Set([...direct.storeIds, ...explicitParent.storeIds])],
          reasonWhenEmpty: 'cross_store_conflict',
          source: 'parent',
          forcedReason: 'cross_store_conflict',
        };
      }
      return direct;
    }
    if (direct.storeIds.length === 1 && explicitParent.storeIds.length === 0) {
      return {
        ...direct,
        forcedReason: 'missing_parent_store',
      };
    }
    if (direct.storeIds.length === 0 && explicitParent.storeIds.length === 1) {
      if (hasCompleteDirectIdentity) {
        return {
          storeIds: explicitParent.storeIds,
          reasonWhenEmpty: 'missing_store_identity',
          source: 'direct',
          forcedReason: 'cross_store_conflict',
        };
      }
      return explicitParent;
    }
    return hasCompleteDirectIdentity ? direct : explicitParent;
  }
  if (direct) return direct;
  if (explicitParent) return explicitParent;

  const fileCandidates = fileScopeCandidates(database, table, row, pendingQuarantineScope);
  if (fileCandidates) return fileCandidates;

  const scopeIdentities = scopeJsonIdentities(table, row);
  if (scopeIdentities.length > 1) {
    const storeIds = scopeIdentities.flatMap((scopeIdentity) => {
      const marketplaceCode = normalizeMarketplaceCode(scopeIdentity.marketplaceCode);
      const storeName = normalizeStoreName(scopeIdentity.storeName);
      return storeName && marketplaceCode === 'US'
        ? findStoresForIdentity(database, storeName, marketplaceCode)
        : [];
    });
    return {
      storeIds: [...new Set(storeIds)],
      reasonWhenEmpty: 'ambiguous_store_identity',
      source: 'scope_json',
      forcedReason: 'ambiguous_store_identity',
    };
  }
  const scopeIdentity = scopeIdentities[0];
  if (scopeIdentity) {
    const marketplaceCode = normalizeMarketplaceCode(scopeIdentity.marketplaceCode);
    const storeName = normalizeStoreName(scopeIdentity.storeName);
    if (marketplaceCode && marketplaceCode !== 'US') {
      return { storeIds: [], reasonWhenEmpty: 'unsupported_marketplace', source: 'scope_json' };
    }
    if (!storeName || !marketplaceCode) {
      return { storeIds: [], reasonWhenEmpty: 'missing_store_identity', source: 'scope_json' };
    }
    return {
      storeIds: findStoresForIdentity(database, storeName, marketplaceCode),
      reasonWhenEmpty: 'missing_store_identity',
      source: 'scope_json',
    };
  }

  const asinCandidates = asinScopeCandidates(database, row, pendingQuarantineScope);
  if (asinCandidates) return asinCandidates;

  return { storeIds: [], reasonWhenEmpty: 'missing_store_identity', source: 'none' };
}

function explicitParentCandidates(
  database: Database.Database,
  table: StoreScopedLegacyTable,
  row: SqlRow,
  pendingQuarantineScope: PendingQuarantineScope,
): CandidateResolution | undefined {
  const relationship: Partial<Record<StoreScopedLegacyTable, {
    parentTable: StoreScopedLegacyTable;
    localColumn: string;
    parentColumn: string;
  }>> = {
    product_costs: { parentTable: 'products', localColumn: 'product_id', parentColumn: 'id' },
    action_logs: { parentTable: 'action_recommendations', localColumn: 'recommendation_id', parentColumn: 'id' },
    approval_tasks: { parentTable: 'action_recommendations', localColumn: 'recommendation_id', parentColumn: 'id' },
    lingxing_report_files: { parentTable: 'lingxing_report_batches', localColumn: 'batch_id', parentColumn: 'id' },
    report_files: { parentTable: 'lingxing_report_batches', localColumn: 'batch_id', parentColumn: 'id' },
    listing_content_versions: { parentTable: 'listing_content', localColumn: 'listing_content_id', parentColumn: 'id' },
  };
  const link = relationship[table];
  if (!link || row[link.localColumn] === null || row[link.localColumn] === undefined) return undefined;
  if (!tableExists(database, link.parentTable) || !hasColumn(database, link.parentTable, 'store_id')) {
    return { storeIds: [], reasonWhenEmpty: 'missing_parent_store', source: 'parent' };
  }
  const candidates = database.prepare(`
    SELECT DISTINCT parent.store_id AS store_id
    FROM ${quoteIdentifier(link.parentTable)} parent
    JOIN stores authority ON authority.store_id = parent.store_id
    WHERE parent.${quoteIdentifier(link.parentColumn)} = ?
      AND NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE ${pendingQuarantineVersionPredicate(pendingQuarantineScope)}
          quarantine.source_table = ${sqlStringLiteral(link.parentTable)}
          AND quarantine.source_row_id = CAST(parent.id AS TEXT)
          AND quarantine.status = 'pending'
      )
  `).all(row[link.localColumn]) as Array<{ store_id: string }>;
  return {
    storeIds: candidates.map((candidate) => candidate.store_id),
    reasonWhenEmpty: 'missing_parent_store',
    source: 'parent',
  };
}

function fileScopeCandidates(
  database: Database.Database,
  table: StoreScopedLegacyTable,
  row: SqlRow,
  pendingQuarantineScope: PendingQuarantineScope,
): CandidateResolution | undefined {
  if (table !== 'keyword_metrics') return undefined;
  const sourceFile = nonEmptyString(row.source_file);
  if (!sourceFile) return undefined;
  const candidates = database.prepare(`
    SELECT DISTINCT scoped.store_id AS store_id
    FROM (
      SELECT store_id, file_path, CAST(id AS TEXT) AS source_row_id, 'report_files' AS source_table
      FROM report_files
      UNION ALL
      SELECT store_id, file_path, CAST(id AS TEXT) AS source_row_id, 'lingxing_report_files' AS source_table
      FROM lingxing_report_files
    ) scoped
    JOIN stores authority ON authority.store_id = scoped.store_id
    WHERE scoped.file_path = ?
      AND NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE ${pendingQuarantineVersionPredicate(pendingQuarantineScope)}
          quarantine.source_table = scoped.source_table
          AND quarantine.source_row_id = scoped.source_row_id
          AND quarantine.status = 'pending'
      )
  `).all(sourceFile) as Array<{ store_id: string }>;
  return {
    storeIds: candidates.map((candidate) => candidate.store_id),
    reasonWhenEmpty: 'missing_parent_store',
    source: 'source_file',
  };
}

function asinScopeCandidates(
  database: Database.Database,
  row: SqlRow,
  pendingQuarantineScope: PendingQuarantineScope,
): CandidateResolution | undefined {
  const asin = nonEmptyString(row.asin);
  if (!asin) return undefined;
  const candidates = database.prepare(`
    SELECT DISTINCT scoped.store_id AS store_id
    FROM (
      SELECT store_id, asin, CAST(id AS TEXT) AS source_row_id, 'products' AS source_table
      FROM products
      UNION ALL
      SELECT store_id, asin, CAST(id AS TEXT) AS source_row_id, 'listing_content' AS source_table
      FROM listing_content
      UNION ALL
      SELECT store_id, asin, CAST(id AS TEXT) AS source_row_id, 'listing_drafts' AS source_table
      FROM listing_drafts
    ) scoped
    JOIN stores authority ON authority.store_id = scoped.store_id
    WHERE scoped.asin = ?
      AND NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE ${pendingQuarantineVersionPredicate(pendingQuarantineScope)}
          quarantine.source_table = scoped.source_table
          AND quarantine.source_row_id = scoped.source_row_id
          AND quarantine.status = 'pending'
      )
  `).all(asin) as Array<{ store_id: string }>;
  return {
    storeIds: candidates.map((candidate) => candidate.store_id),
    reasonWhenEmpty: 'missing_parent_store',
    source: 'asin',
  };
}

function pendingQuarantineVersionPredicate(scope: PendingQuarantineScope): string {
  return scope === 'v1'
    ? `quarantine.migration_version = ${STORE_AUTHORITY_MIGRATION_VERSION} AND`
    : '';
}

function scopeJsonIdentities(table: StoreScopedLegacyTable, row: SqlRow): LegacyIdentity[] {
  if (table !== 'ai_diagnosis_runs') return [];
  const rawScope = nonEmptyString(row.scope_json);
  if (!rawScope) return [];
  try {
    const parsed = JSON.parse(rawScope) as unknown;
    const identities: LegacyIdentity[] = [];
    collectIdentitiesInObject(parsed, identities);
    const unique = new Map<string, LegacyIdentity>();
    for (const identity of identities) {
      const storeName = normalizeStoreName(identity.storeName);
      const marketplaceCode = normalizeMarketplaceCode(identity.marketplaceCode);
      unique.set(`${marketplaceCode}\u0000${storeName}`, identity);
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

function collectIdentitiesInObject(
  value: unknown,
  identities: LegacyIdentity[],
  depth = 0,
): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 3) return;
  const record = value as Record<string, unknown>;
  const storeName = nonEmptyString(record.storeName ?? record.store_name);
  const marketplaceCode = nonEmptyString(record.marketplaceCode ?? record.marketplace_code ?? record.marketplace);
  if (storeName || marketplaceCode) identities.push({ storeName, marketplaceCode });
  for (const child of Object.values(record)) {
    collectIdentitiesInObject(child, identities, depth + 1);
  }
}

function identityFromRow(table: StoreScopedLegacyTable, row: SqlRow): LegacyIdentity {
  if (!DIRECT_IDENTITY_TABLES.has(table)) return {};
  return {
    storeName: nonEmptyString(row.store_name),
    marketplaceCode: nonEmptyString(row.marketplace_code),
  };
}

function quarantineRow(
  database: Database.Database,
  table: StoreScopedLegacyTable,
  sourceRowId: string,
  reason: StoreMigrationQuarantineReason,
  identity: LegacyIdentity,
  candidateStoreIds: string[],
  row: SqlRow,
): void {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      normalized_store_name, normalized_marketplace_code,
      candidate_store_ids_json, source_identity_json,
      status, created_at, updated_at
    ) VALUES (
      @migrationVersion, @sourceTable, @sourceRowId, @reason,
      @normalizedStoreName, @normalizedMarketplaceCode,
      @candidateStoreIdsJson, @sourceIdentityJson,
      'pending', @createdAt, @updatedAt
    )
    ON CONFLICT(migration_version, source_table, source_row_id) DO NOTHING
  `).run({
    migrationVersion: STORE_AUTHORITY_MIGRATION_VERSION,
    sourceTable: table,
    sourceRowId,
    reason,
    normalizedStoreName: normalizeStoreName(identity.storeName) || null,
    normalizedMarketplaceCode: normalizeMarketplaceCode(identity.marketplaceCode) || null,
    candidateStoreIdsJson: JSON.stringify([...new Set(candidateStoreIds)].sort()),
    sourceIdentityJson: JSON.stringify(sourceIdentitySnapshot(table, row, identity)),
    createdAt: now,
    updatedAt: now,
  });
}

function sourceIdentitySnapshot(
  table: StoreScopedLegacyTable,
  row: SqlRow,
  identity: LegacyIdentity,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    storeName: identity.storeName,
    marketplaceCode: identity.marketplaceCode,
  };
  for (const column of [
    'product_id', 'recommendation_id', 'batch_id', 'listing_content_id',
    'asin', 'source_file',
  ]) {
    if (row[column] !== null && row[column] !== undefined && row[column] !== '') {
      snapshot[column] = row[column];
    }
  }
  if (table === 'ai_diagnosis_runs' && nonEmptyString(row.scope_json)) {
    snapshot.scopeIdentities = scopeJsonIdentities(table, row);
  }
  return snapshot;
}

function findStoresForIdentity(
  database: Database.Database,
  normalizedStoreName: string,
  normalizedMarketplaceCode: string,
): string[] {
  if (!normalizedStoreName || !normalizedMarketplaceCode) return [];
  const rows = database.prepare(`
    SELECT store_id, display_name, legacy_store_name_normalized,
           legacy_marketplace_code_normalized
    FROM stores
    WHERE marketplace = @marketplaceCode
    ORDER BY store_id
  `).all({
    marketplaceCode: normalizedMarketplaceCode,
  }) as Array<{
    store_id: string;
    display_name: string;
    legacy_store_name_normalized: string | null;
    legacy_marketplace_code_normalized: string | null;
  }>;
  return [...new Set(rows.filter((row) => (
    row.legacy_store_name_normalized === normalizedStoreName
      && row.legacy_marketplace_code_normalized === normalizedMarketplaceCode
  ) || (
    row.legacy_store_name_normalized === null
      && normalizeStoreName(row.display_name) === normalizedStoreName
  )).map((row) => row.store_id))];
}

function verifyStoreAuthoritySchema(
  database: Database.Database,
  targetTables: readonly StoreScopedLegacyTable[],
): void {
  for (const table of [
    'schema_migrations',
    'stores',
    'store_connections',
    'store_session_metadata',
    'store_migration_quarantine',
  ]) {
    if (!tableExists(database, table)) {
      throw new StoreAuthorityMigrationError(
        STORE_AUTHORITY_MIGRATION_VERSION,
        `Required store authority table is missing: ${table}.`,
      );
    }
  }
  for (const table of targetTables) {
    if (tableExists(database, table) && !hasColumn(database, table, 'store_id')) {
      throw new StoreAuthorityMigrationError(
        STORE_AUTHORITY_MIGRATION_VERSION,
        `Required nullable store_id column is missing from ${table}.`,
      );
    }
  }
}

function tableExists(database: Database.Database, table: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  const rows = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function countRows(database: Database.Database, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get() as { count: number }).count);
}

function storeExists(database: Database.Database, storeId: string): boolean {
  return Boolean(database.prepare('SELECT 1 FROM stores WHERE store_id = ?').get(storeId));
}

function checkDatabaseIntegrity(database: Database.Database): string {
  const rows = database.pragma('integrity_check') as Array<Record<string, unknown>>;
  return rows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? '')).join('; ');
}

function checkDatabaseFileIntegrity(filePath: string): string {
  const backup = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return checkDatabaseIntegrity(backup);
  } finally {
    backup.close();
  }
}

function hashFile(filePath: string): string {
  const hash = createHash('sha256');
  const handle = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest('hex');
}

function schemaFingerprint(database: Database.Database): string {
  const schema = database.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}

function identityKey(normalizedStoreName: string, marketplaceCode: string): string {
  return `${marketplaceCode}\u0000${normalizedStoreName}`;
}

function normalizeStoreName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') : '';
}

function normalizeMarketplaceCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sameResolvedPath(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLocaleLowerCase('en-US') === resolvedRight.toLocaleLowerCase('en-US')
    : resolvedLeft === resolvedRight;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const STORE_AUTHORITY_MIGRATION: StoreAuthorityMigrationDefinition = {
  version: STORE_AUTHORITY_MIGRATION_VERSION,
  name: STORE_AUTHORITY_MIGRATION_NAME,
  checksum: STORE_AUTHORITY_MIGRATION_CHECKSUM,
  targetTables: STORE_SCOPED_LEGACY_TABLES,
  up: applyStoreAuthorityMigration,
};
