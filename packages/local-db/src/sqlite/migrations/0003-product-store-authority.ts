import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

export const PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION = 3;
export const PRODUCT_STORE_AUTHORITY_MIGRATION_NAME = 'product-store-authority-v3';
export const PRODUCT_STORE_AUTHORITY_MIGRATION_CHECKSUM = 'product-store-authority-v3-20260722-01';

const PRODUCT_STORE_UNIQUE_INDEX = 'idx_products_unique_store_asin';
const PRODUCT_LEGACY_UNIQUE_INDEX = 'idx_products_unique_legacy_scope_asin';

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MigrationBackupManifest {
  status: 'pending' | 'created' | 'reused' | 'not_applicable';
  databasePath?: string;
  backupPath?: string;
  integrityCheck: string;
  sha256?: string;
  sizeBytes?: number;
}

interface ProductStoreMigrationManifest {
  version: number;
  name: string;
  checksum: string;
  startedAt: string;
  schemaFingerprint: string;
  integrityCheck: string;
  productRowCount: number;
  backup: MigrationBackupManifest;
}

export interface ProductStoreAuthorityMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  quarantinedLegacyRows: number;
  mergedDuplicateRows: number;
  errorMessage?: string;
}

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  manifest_json: string;
  result_json: string | null;
}

export class ProductStoreAuthorityMigrationError extends Error {
  readonly version = PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'ProductStoreAuthorityMigrationError';
  }
}

/**
 * Replaces the display-name product identity with the durable store authority
 * identity. Unowned legacy rows remain queryable and quarantined; normalized
 * duplicates are merged only under one proven store, with a bound backup and
 * a durable resolved quarantine record for every removed duplicate.
 */
export function runProductStoreAuthorityMigration(
  database: Database.Database,
): ProductStoreAuthorityMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertReportImportAuthorityApplied(database);

  const existing = readMigration(database);
  if (existing && existing.checksum !== PRODUCT_STORE_AUTHORITY_MIGRATION_CHECKSUM) {
    throw new ProductStoreAuthorityMigrationError(
      'Migration 3 checksum does not match the recorded migration.',
    );
  }
  if (existing?.status === 'applied') {
    verifyProductStoreAuthoritySchema(database);
    return parseJson(existing.result_json, {
      version: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
      name: PRODUCT_STORE_AUTHORITY_MIGRATION_NAME,
      status: 'applied',
      startedAt: '',
      quarantinedLegacyRows: 0,
      mergedDuplicateRows: 0,
    });
  }

  const manifest = prepareBoundBackup(database, existing);
  const startedResult: ProductStoreAuthorityMigrationResult = {
    version: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
    name: PRODUCT_STORE_AUTHORITY_MIGRATION_NAME,
    status: 'started',
    startedAt: manifest.startedAt,
    quarantinedLegacyRows: 0,
    mergedDuplicateRows: 0,
  };
  writeMigrationState(database, manifest, startedResult, 'started');

  try {
    verifyBoundBackup(database, manifest.backup);
    const apply = database.transaction(() => {
      const { mergedDuplicateRows, quarantinedLegacyRows } = applyProductStoreAuthoritySchema(database);
      verifyProductStoreAuthoritySchema(database);
      const result: ProductStoreAuthorityMigrationResult = {
        ...startedResult,
        status: 'applied',
        finishedAt: new Date().toISOString(),
        quarantinedLegacyRows,
        mergedDuplicateRows,
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    });
    return apply();
  } catch (error) {
    const failed: ProductStoreAuthorityMigrationResult = {
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
      version: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof ProductStoreAuthorityMigrationError) throw error;
    throw new ProductStoreAuthorityMigrationError(
      failed.errorMessage ?? 'Migration 3 failed.',
    );
  }
}

function applyProductStoreAuthoritySchema(database: Database.Database): {
  mergedDuplicateRows: number;
  quarantinedLegacyRows: number;
} {
  for (const table of ['products', 'stores', 'store_migration_quarantine']) {
    if (!tableExists(database, table)) {
      throw new ProductStoreAuthorityMigrationError(`Required table is missing: ${table}.`);
    }
  }
  if (!hasColumn(database, 'products', 'store_id')) {
    throw new ProductStoreAuthorityMigrationError('products.store_id is missing.');
  }

  const invalidOwner = database.prepare(`
    SELECT product.id, product.store_id
    FROM products product
    LEFT JOIN stores authority ON authority.store_id = product.store_id
    WHERE product.store_id IS NOT NULL AND authority.store_id IS NULL
    ORDER BY product.id
    LIMIT 1
  `).get() as { id: number; store_id: string } | undefined;
  if (invalidOwner) {
    throw new ProductStoreAuthorityMigrationError(
      `Product ${invalidOwner.id} references unknown store_id ${invalidOwner.store_id}.`,
    );
  }

  const invalidAsin = database.prepare(`
    SELECT id, store_id
    FROM products
    WHERE store_id IS NOT NULL AND trim(COALESCE(asin, '')) = ''
    ORDER BY id
    LIMIT 1
  `).get() as { id: number; store_id: string } | undefined;
  if (invalidAsin) {
    throw new ProductStoreAuthorityMigrationError(
      `Product ${invalidAsin.id} in store ${invalidAsin.store_id} has no normalized ASIN.`,
    );
  }

  const mergedDuplicateRows = mergeSameStoreProductDuplicates(database);

  let quarantinedLegacyRows = 0;
  const legacyRows = database.prepare(`
    SELECT id, store_name, marketplace_code, asin
    FROM products
    WHERE store_id IS NULL
    ORDER BY id
  `).all() as Array<{
    id: number;
    store_name: string | null;
    marketplace_code: string | null;
    asin: string | null;
  }>;
  const quarantine = database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      normalized_store_name, normalized_marketplace_code,
      candidate_store_ids_json, source_identity_json,
      status, created_at, updated_at
    ) VALUES (
      @migrationVersion, 'products', @sourceRowId, 'unresolved_product_owner',
      @normalizedStoreName, @normalizedMarketplaceCode,
      @candidateStoreIdsJson, @sourceIdentityJson,
      'pending', @createdAt, @updatedAt
    )
    ON CONFLICT(migration_version, source_table, source_row_id) DO NOTHING
  `);
  for (const row of legacyRows) {
    const existingPending = database.prepare(`
      SELECT 1
      FROM store_migration_quarantine
      WHERE source_table = 'products'
        AND source_row_id = ?
        AND status = 'pending'
      LIMIT 1
    `).get(String(row.id));
    if (existingPending) continue;
    const candidateStoreIds = findCandidateStoreIds(
      database,
      normalizeStoreName(row.store_name),
      normalizeMarketplace(row.marketplace_code),
    );
    const now = new Date().toISOString();
    const result = quarantine.run({
      migrationVersion: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
      sourceRowId: String(row.id),
      normalizedStoreName: normalizeStoreName(row.store_name) || null,
      normalizedMarketplaceCode: normalizeMarketplace(row.marketplace_code) || null,
      candidateStoreIdsJson: JSON.stringify(candidateStoreIds),
      sourceIdentityJson: JSON.stringify({
        storeName: optionalText(row.store_name),
        marketplaceCode: optionalText(row.marketplace_code),
        asin: optionalText(row.asin),
      }),
      createdAt: now,
      updatedAt: now,
    });
    quarantinedLegacyRows += Number(result.changes);
  }

  database.exec(`
    DROP INDEX IF EXISTS idx_products_unique_scope_asin;
    DROP INDEX IF EXISTS ${PRODUCT_STORE_UNIQUE_INDEX};
    DROP INDEX IF EXISTS ${PRODUCT_LEGACY_UNIQUE_INDEX};

    CREATE UNIQUE INDEX ${PRODUCT_STORE_UNIQUE_INDEX}
      ON products(store_id, upper(trim(asin)))
      WHERE store_id IS NOT NULL;
    CREATE UNIQUE INDEX ${PRODUCT_LEGACY_UNIQUE_INDEX}
      ON products(
        upper(trim(asin)),
        lower(trim(store_name)),
        upper(trim(marketplace_code))
      )
      WHERE store_id IS NULL;

    CREATE TRIGGER IF NOT EXISTS trg_products_require_store_authority_insert
    BEFORE INSERT ON products
    WHEN NEW.store_id IS NULL AND EXISTS (SELECT 1 FROM stores)
    BEGIN
      SELECT RAISE(ABORT, 'product store_id is required when store authority exists');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_products_require_store_authority_update
    BEFORE UPDATE ON products
    WHEN NEW.store_id IS NULL AND EXISTS (SELECT 1 FROM stores)
    BEGIN
      SELECT RAISE(ABORT, 'product store_id is required when store authority exists');
    END;
  `);
  database.exec(`
    UPDATE products
    SET asin = upper(trim(asin))
    WHERE store_id IS NOT NULL;
  `);
  return { mergedDuplicateRows, quarantinedLegacyRows };
}

function mergeSameStoreProductDuplicates(database: Database.Database): number {
  const duplicates = database.prepare(`
    SELECT store_id, upper(trim(asin)) AS normalized_asin
    FROM products
    WHERE store_id IS NOT NULL
    GROUP BY store_id, upper(trim(asin))
    HAVING COUNT(*) > 1
    ORDER BY store_id, normalized_asin
  `).all() as Array<{ store_id: string; normalized_asin: string }>;
  let merged = 0;
  for (const duplicate of duplicates) {
    const products = database.prepare(`
      SELECT *
      FROM products
      WHERE store_id = ? AND upper(trim(asin)) = ?
      ORDER BY id DESC
    `).all(duplicate.store_id, duplicate.normalized_asin) as Array<Record<string, unknown> & { id: number }>;
    const [keeper, ...losers] = products;
    if (!keeper) continue;
    for (const loser of losers) {
      const keeperCost = database.prepare(`
        SELECT id FROM product_costs WHERE product_id = ? LIMIT 1
      `).get(keeper.id) as { id: number } | undefined;
      const loserCost = database.prepare(`
        SELECT id FROM product_costs WHERE product_id = ? LIMIT 1
      `).get(loser.id) as { id: number } | undefined;
      if (keeperCost && loserCost) {
        throw new ProductStoreAuthorityMigrationError(
          `Store ${duplicate.store_id} has conflicting cost records for normalized ASIN ${duplicate.normalized_asin}; manual reconciliation is required.`,
        );
      }
      if (loserCost) {
        database.prepare(`
          UPDATE product_costs
          SET product_id = ?, store_id = ?
          WHERE id = ? AND product_id = ?
        `).run(keeper.id, duplicate.store_id, loserCost.id, loser.id);
      }
      const now = new Date().toISOString();
      database.prepare(`
        INSERT INTO store_migration_quarantine (
          migration_version, source_table, source_row_id, reason,
          normalized_store_name, normalized_marketplace_code,
          candidate_store_ids_json, source_identity_json,
          status, resolved_store_id, resolution_note,
          created_at, updated_at, resolved_at
        ) VALUES (
          @migrationVersion, 'products', @sourceRowId, 'duplicate_normalized_asin_merged',
          @normalizedStoreName, @normalizedMarketplaceCode,
          @candidateStoreIdsJson, @sourceIdentityJson,
          'resolved', @resolvedStoreId, @resolutionNote,
          @createdAt, @updatedAt, @resolvedAt
        )
        ON CONFLICT(migration_version, source_table, source_row_id) DO NOTHING
      `).run({
        migrationVersion: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
        sourceRowId: String(loser.id),
        normalizedStoreName: normalizeStoreName(loser.store_name) || null,
        normalizedMarketplaceCode: normalizeMarketplace(loser.marketplace_code) || null,
        candidateStoreIdsJson: JSON.stringify([duplicate.store_id]),
        sourceIdentityJson: JSON.stringify({
          storeName: optionalText(loser.store_name),
          marketplaceCode: optionalText(loser.marketplace_code),
          asin: optionalText(loser.asin),
          title: optionalText(loser.title),
        }),
        resolvedStoreId: duplicate.store_id,
        resolutionNote: `Merged into product ${keeper.id} by normalized ASIN ${duplicate.normalized_asin}.`,
        createdAt: now,
        updatedAt: now,
        resolvedAt: now,
      });
      database.prepare('DELETE FROM products WHERE id = ? AND store_id = ?')
        .run(loser.id, duplicate.store_id);
      merged += 1;
    }
  }
  return merged;
}

export function verifyProductStoreAuthoritySchema(database: Database.Database): void {
  for (const index of [PRODUCT_STORE_UNIQUE_INDEX, PRODUCT_LEGACY_UNIQUE_INDEX]) {
    if (!database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?
    `).get(index)) {
      throw new ProductStoreAuthorityMigrationError(`Required product index is missing: ${index}.`);
    }
  }
  if (database.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'index' AND name = 'idx_products_unique_scope_asin'
  `).get()) {
    throw new ProductStoreAuthorityMigrationError('Legacy display-name product identity index is still active.');
  }
  for (const trigger of [
    'trg_products_require_store_authority_insert',
    'trg_products_require_store_authority_update',
  ]) {
    if (!database.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?
    `).get(trigger)) {
      throw new ProductStoreAuthorityMigrationError(`Required product authority trigger is missing: ${trigger}.`);
    }
  }

  const unquarantined = database.prepare(`
    SELECT product.id
    FROM products product
    LEFT JOIN store_migration_quarantine quarantine
      ON quarantine.source_table = 'products'
      AND quarantine.source_row_id = CAST(product.id AS TEXT)
      AND quarantine.status = 'pending'
    WHERE product.store_id IS NULL AND quarantine.id IS NULL
    ORDER BY product.id
    LIMIT 1
  `).get() as { id: number } | undefined;
  if (unquarantined) {
    throw new ProductStoreAuthorityMigrationError(
      `Unowned product ${unquarantined.id} is not quarantined.`,
    );
  }
}

function prepareBoundBackup(
  database: Database.Database,
  existing: MigrationRow | undefined,
): ProductStoreMigrationManifest {
  const previous = parseJson<ProductStoreMigrationManifest | undefined>(
    existing?.manifest_json,
    undefined,
  );
  if (previous?.backup && isBoundBackup(database, previous.backup)) {
    verifyBoundBackup(database, previous.backup);
    return {
      ...previous,
      backup: previous.backup.status === 'created'
        ? { ...previous.backup, status: 'reused' }
        : previous.backup,
    };
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new ProductStoreAuthorityMigrationError(
      `Source database integrity_check returned: ${integrityCheck}`,
    );
  }
  const databasePath = fileBackedDatabasePath(database);
  const backupPath = databasePath
    ? `${databasePath}.pre-product-store-authority-v3.bak`
    : undefined;
  const pendingBackup: MigrationBackupManifest = databasePath && backupPath
    ? { status: 'pending', databasePath, backupPath, integrityCheck }
    : { status: 'not_applicable', integrityCheck };
  const manifest: ProductStoreMigrationManifest = {
    version: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
    name: PRODUCT_STORE_AUTHORITY_MIGRATION_NAME,
    checksum: PRODUCT_STORE_AUTHORITY_MIGRATION_CHECKSUM,
    startedAt: new Date().toISOString(),
    schemaFingerprint: schemaFingerprint(database),
    integrityCheck,
    productRowCount: countRows(database, 'products'),
    backup: pendingBackup,
  };

  const previousWasMatchingPending = previous?.backup.status === 'pending'
    && previous.backup.backupPath === pendingBackup.backupPath
    && previous.backup.databasePath === pendingBackup.databasePath;
  if (backupPath && fs.existsSync(backupPath) && !previousWasMatchingPending) {
    throw new ProductStoreAuthorityMigrationError(
      'An unbound product-store migration backup already exists; refusing to replace it.',
    );
  }
  writeMigrationState(database, manifest, {
    version: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
    name: PRODUCT_STORE_AUTHORITY_MIGRATION_NAME,
    status: 'started',
    startedAt: manifest.startedAt,
    quarantinedLegacyRows: 0,
    mergedDuplicateRows: 0,
  }, 'started');

  if (!databasePath || !backupPath) return manifest;
  if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  database.pragma('wal_checkpoint(FULL)');
  database.exec(`VACUUM INTO ${sqlStringLiteral(backupPath)}`);
  const boundBackup: MigrationBackupManifest = {
    status: 'created',
    databasePath,
    backupPath,
    integrityCheck: checkDatabaseFileIntegrity(backupPath),
    sha256: hashFile(backupPath),
    sizeBytes: fs.statSync(backupPath).size,
  };
  if (boundBackup.integrityCheck !== 'ok') {
    throw new ProductStoreAuthorityMigrationError(
      `Backup integrity_check returned: ${boundBackup.integrityCheck}`,
    );
  }
  const boundManifest = { ...manifest, backup: boundBackup };
  database.prepare(`
    UPDATE schema_migrations SET manifest_json = ? WHERE version = ?
  `).run(JSON.stringify(boundManifest), PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION);
  return boundManifest;
}

function ensureSchemaMigrationsTable(database: Database.Database): void {
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

function assertReportImportAuthorityApplied(database: Database.Database): void {
  const migration = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 2
  `).get() as { status: string } | undefined;
  if (migration?.status !== 'applied') {
    throw new ProductStoreAuthorityMigrationError(
      'Report Import Authority migration v2 must be applied before migration v3.',
    );
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations WHERE version = ?
  `).get(PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION) as MigrationRow | undefined;
}

function writeMigrationState(
  database: Database.Database,
  manifest: ProductStoreMigrationManifest,
  result: ProductStoreAuthorityMigrationResult,
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
    version: PRODUCT_STORE_AUTHORITY_MIGRATION_VERSION,
    name: PRODUCT_STORE_AUTHORITY_MIGRATION_NAME,
    checksum: PRODUCT_STORE_AUTHORITY_MIGRATION_CHECKSUM,
    status,
    startedAt: manifest.startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(result),
  });
}

function verifyBoundBackup(database: Database.Database, backup: MigrationBackupManifest): void {
  if (backup.status === 'not_applicable') return;
  if (!isBoundBackup(database, backup) || !backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new ProductStoreAuthorityMigrationError(
      'Migration 3 does not have a valid bound pre-migration backup.',
    );
  }
  if (checkDatabaseFileIntegrity(backup.backupPath) !== 'ok' || hashFile(backup.backupPath) !== backup.sha256) {
    throw new ProductStoreAuthorityMigrationError(
      'Migration 3 backup integrity or SHA-256 binding failed.',
    );
  }
}

function isBoundBackup(database: Database.Database, backup: MigrationBackupManifest): boolean {
  const databasePath = fileBackedDatabasePath(database);
  if (!databasePath) return backup.status === 'not_applicable';
  return (backup.status === 'created' || backup.status === 'reused')
    && backup.databasePath === databasePath
    && backup.backupPath === `${databasePath}.pre-product-store-authority-v3.bak`
    && Boolean(backup.sha256);
}

function findCandidateStoreIds(
  database: Database.Database,
  normalizedStoreName: string,
  marketplace: string,
): string[] {
  if (!normalizedStoreName || !marketplace) return [];
  const rows = database.prepare(`
    SELECT store_id, display_name, legacy_store_name_normalized,
           legacy_marketplace_code_normalized
    FROM stores
    WHERE marketplace = ?
    ORDER BY store_id
  `).all(marketplace) as Array<{
    store_id: string;
    display_name: string;
    legacy_store_name_normalized: string | null;
    legacy_marketplace_code_normalized: string | null;
  }>;
  return rows.filter((row) => (
    row.legacy_store_name_normalized === normalizedStoreName
      && row.legacy_marketplace_code_normalized === marketplace
  ) || (
    row.legacy_store_name_normalized === null
      && normalizeStoreName(row.display_name) === normalizedStoreName
  )).map((row) => row.store_id);
}

function fileBackedDatabasePath(database: Database.Database): string | undefined {
  const name = database.name;
  if (!name || name === ':memory:' || name.startsWith('file::memory:')) return undefined;
  return path.resolve(name);
}

function checkDatabaseFileIntegrity(filePath: string): string {
  const backup = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    return backup.pragma('integrity_check', { simple: true }) as string;
  } finally {
    backup.close();
  }
}

function hashFile(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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

function tableExists(database: Database.Database, table: string): boolean {
  return Boolean(database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
}

function hasColumn(database: Database.Database, table: string, column: string): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((candidate) => candidate.name === column);
}

function countRows(database: Database.Database, table: string): number {
  return Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function normalizeStoreName(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
    : '';
}

function normalizeMarketplace(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function optionalText(value: unknown): string | undefined {
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

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
