import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { ensureSchemaMigrationsTable } from './0001-store-authority';

export const LISTING_STORE_AUTHORITY_MIGRATION_VERSION = 4;
export const LISTING_STORE_AUTHORITY_MIGRATION_NAME = 'listing-store-authority-v4';
export const LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM = 'listing-store-authority-v4-20260722-03';
export const LISTING_STORE_UNIQUE_INDEX = 'idx_listing_content_unique_store_asin';
const PREVIOUS_LISTING_STORE_AUTHORITY_CHECKSUM = 'listing-store-authority-v4-20260722-02';

const LISTING_STORE_AUTHORITY_TRIGGERS = [
  'trg_listing_content_require_store_authority_insert',
  'trg_listing_content_require_store_authority_update',
  'trg_listing_content_versions_require_store_authority_insert',
  'trg_listing_content_versions_require_store_authority_update',
] as const;

type MigrationStatus = 'started' | 'applied' | 'failed';

interface MigrationBackupManifest {
  status: 'pending' | 'created' | 'reused' | 'not_applicable';
  databasePath?: string;
  backupPath?: string;
  integrityCheck: string;
  sha256?: string;
  sizeBytes?: number;
}

interface ListingStoreMigrationManifest {
  version: number;
  name: string;
  checksum: string;
  startedAt: string;
  listingRowCount: number;
  listingVersionRowCount: number;
  backup: MigrationBackupManifest;
}

export interface ListingStoreAuthorityMigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
  startedAt: string;
  finishedAt?: string;
  mergedDuplicateRows: number;
  isolatedUnownedRows: number;
  errorMessage?: string;
}

interface MigrationRow {
  checksum: string;
  status: MigrationStatus;
  manifest_json: string;
  result_json: string | null;
}

interface ListingRow extends Record<string, unknown> {
  id: number;
  store_id: string | null;
  asin: string;
  store_name: string | null;
  marketplace_code: string | null;
  title: string | null;
  bullets_json: string | null;
  description: string | null;
  a_plus: string | null;
  image_copy: string | null;
  backend_terms: string | null;
  source: string | null;
  source_url: string | null;
  screenshot_path: string | null;
  version_label: string | null;
  change_summary: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ListingVersionRow extends Record<string, unknown> {
  id: number;
  listing_content_id: number | null;
  store_id: string | null;
  asin: string;
  store_name: string | null;
  marketplace_code: string | null;
  title: string | null;
  version_label: string | null;
}

export class ListingStoreAuthorityMigrationError extends Error {
  readonly version = LISTING_STORE_AUTHORITY_MIGRATION_VERSION;

  constructor(message: string) {
    super(message);
    this.name = 'ListingStoreAuthorityMigrationError';
  }
}

/**
 * Installs the durable `(store_id, upper(trim(asin)))` Listing identity.
 * Proven same-store duplicates are merged deterministically into the newest
 * row while every loser is preserved as version history and quarantine
 * evidence. Pending-quarantined content and versions are never merge
 * candidates; they remain untouched and are excluded from active identity.
 * Unowned duplicates remain untouched and are explicitly isolated.
 */
export function runListingStoreAuthorityMigration(
  database: Database.Database,
): ListingStoreAuthorityMigrationResult {
  ensureSchemaMigrationsTable(database);
  assertProductStoreAuthorityApplied(database);
  const existing = readMigration(database);
  if (existing
    && existing.checksum !== LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM
    && existing.checksum !== PREVIOUS_LISTING_STORE_AUTHORITY_CHECKSUM) {
    throw new ListingStoreAuthorityMigrationError(
      'Migration 4 checksum does not match the recorded migration.',
    );
  }
  if (existing?.status === 'applied') {
    if (existing.checksum === PREVIOUS_LISTING_STORE_AUTHORITY_CHECKSUM) {
      return hardenPreviouslyAppliedMigration(database, existing);
    }
    database.transaction(() => {
      ensureListingQuarantineMarker(database, 'listing_content');
      ensureListingQuarantineMarker(database, 'listing_content_versions');
      synchronizeListingQuarantineMarkers(database);
      verifyListingStoreAuthoritySchema(database);
    }).immediate();
    return parseJson(existing.result_json, defaultResult('applied', ''));
  }

  const manifest = prepareBoundBackup(database, existing);
  const started = defaultResult('started', manifest.startedAt);
  writeStartedState(database, manifest, started);

  try {
    verifyBoundBackup(database, manifest.backup);
    return database.transaction(() => {
      const applied = applyListingStoreAuthoritySchema(database);
      verifyListingStoreAuthoritySchema(database);
      const result: ListingStoreAuthorityMigrationResult = {
        ...started,
        ...applied,
        status: 'applied',
        finishedAt: new Date().toISOString(),
      };
      database.prepare(`
        UPDATE schema_migrations
        SET status = 'applied', applied_at = @appliedAt,
            error_message = NULL, result_json = @resultJson
        WHERE version = @version
      `).run({
        version: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
        appliedAt: result.finishedAt,
        resultJson: JSON.stringify(result),
      });
      return result;
    }).immediate();
  } catch (error) {
    const failed: ListingStoreAuthorityMigrationResult = {
      ...started,
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
      version: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
      errorMessage: failed.errorMessage,
      resultJson: JSON.stringify(failed),
    });
    if (error instanceof ListingStoreAuthorityMigrationError) throw error;
    throw new ListingStoreAuthorityMigrationError(
      failed.errorMessage ?? 'Migration 4 failed.',
    );
  }
}

function hardenPreviouslyAppliedMigration(
  database: Database.Database,
  existing: MigrationRow,
): ListingStoreAuthorityMigrationResult {
  return database.transaction(() => {
    const previous = parseJson(
      existing.result_json,
      defaultResult('applied', new Date().toISOString()),
    );
    const previousManifest = parseJson<Record<string, unknown>>(existing.manifest_json, {});
    const hardened = applyListingStoreAuthoritySchema(database);
    verifyListingStoreAuthoritySchema(database);
    const result: ListingStoreAuthorityMigrationResult = {
      ...previous,
      status: 'applied',
      finishedAt: new Date().toISOString(),
      mergedDuplicateRows: previous.mergedDuplicateRows + hardened.mergedDuplicateRows,
      isolatedUnownedRows: previous.isolatedUnownedRows + hardened.isolatedUnownedRows,
    };
    database.prepare(`
      UPDATE schema_migrations
      SET name = @name, checksum = @checksum, applied_at = @appliedAt,
          error_message = NULL, manifest_json = @manifestJson,
          result_json = @resultJson
      WHERE version = @version
    `).run({
      version: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
      name: LISTING_STORE_AUTHORITY_MIGRATION_NAME,
      checksum: LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
      appliedAt: result.finishedAt,
      manifestJson: JSON.stringify({
        ...previousManifest,
        checksum: LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
      }),
      resultJson: JSON.stringify(result),
    });
    return result;
  }).immediate();
}

function applyListingStoreAuthoritySchema(database: Database.Database): {
  mergedDuplicateRows: number;
  isolatedUnownedRows: number;
} {
  for (const table of [
    'listing_content',
    'listing_content_versions',
    'stores',
    'store_migration_quarantine',
  ]) {
    if (!tableExists(database, table)) {
      throw new ListingStoreAuthorityMigrationError(`Required table is missing: ${table}.`);
    }
  }
  for (const table of ['listing_content', 'listing_content_versions']) {
    if (!hasColumn(database, table, 'store_id')) {
      throw new ListingStoreAuthorityMigrationError(`${table}.store_id is missing.`);
    }
  }
  for (const triggerName of LISTING_STORE_AUTHORITY_TRIGGERS) {
    database.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  }
  ensureListingQuarantineMarker(database, 'listing_content');
  ensureListingQuarantineMarker(database, 'listing_content_versions');
  synchronizeListingQuarantineMarkers(database);

  const invalidOwner = database.prepare(`
    SELECT listing.id, listing.store_id
    FROM listing_content listing
    LEFT JOIN stores authority ON authority.store_id = listing.store_id
    WHERE listing.store_id IS NOT NULL
      AND listing.store_authority_quarantined = 0
      AND authority.store_id IS NULL
    ORDER BY listing.id
    LIMIT 1
  `).get() as { id: number; store_id: string } | undefined;
  if (invalidOwner) {
    throw new ListingStoreAuthorityMigrationError(
      `Listing ${invalidOwner.id} references unknown store_id ${invalidOwner.store_id}.`,
    );
  }

  const mergedDuplicateRows = mergeOwnedDuplicates(database);
  const isolatedUnownedRows = isolateUnownedRows(database);
  synchronizeListingQuarantineMarkers(database);
  database.exec(`
    UPDATE listing_content
    SET asin = upper(trim(asin))
    WHERE store_id IS NOT NULL AND store_authority_quarantined = 0;
    UPDATE listing_content_versions
    SET asin = upper(trim(asin))
    WHERE store_id IS NOT NULL AND store_authority_quarantined = 0;

    DROP INDEX IF EXISTS ${LISTING_STORE_UNIQUE_INDEX};
    CREATE UNIQUE INDEX ${LISTING_STORE_UNIQUE_INDEX}
      ON listing_content(store_id, upper(trim(asin)))
      WHERE store_id IS NOT NULL
        AND trim(asin) <> ''
        AND store_authority_quarantined = 0;

    DROP TRIGGER IF EXISTS trg_listing_content_require_store_authority_insert;
    CREATE TRIGGER trg_listing_content_require_store_authority_insert
    BEFORE INSERT ON listing_content
    WHEN NEW.store_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'listing content store_id is required');
    END;

    DROP TRIGGER IF EXISTS trg_listing_content_require_store_authority_update;
    CREATE TRIGGER trg_listing_content_require_store_authority_update
    BEFORE UPDATE ON listing_content
    WHEN NEW.store_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'listing content store_id is required');
    END;

    DROP TRIGGER IF EXISTS trg_listing_content_versions_require_store_authority_insert;
    CREATE TRIGGER trg_listing_content_versions_require_store_authority_insert
    BEFORE INSERT ON listing_content_versions
    WHEN NEW.store_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'listing content version store_id is required');
    END;

    DROP TRIGGER IF EXISTS trg_listing_content_versions_require_store_authority_update;
    CREATE TRIGGER trg_listing_content_versions_require_store_authority_update
    BEFORE UPDATE ON listing_content_versions
    WHEN NEW.store_id IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'listing content version store_id is required');
    END;
  `);
  return { mergedDuplicateRows, isolatedUnownedRows };
}

function ensureListingQuarantineMarker(
  database: Database.Database,
  table: 'listing_content' | 'listing_content_versions',
): void {
  if (hasColumn(database, table, 'store_authority_quarantined')) return;
  database.exec(`
    ALTER TABLE ${table}
    ADD COLUMN store_authority_quarantined INTEGER NOT NULL DEFAULT 0
      CHECK (store_authority_quarantined IN (0, 1))
  `);
}

function synchronizeListingQuarantineMarkers(database: Database.Database): void {
  for (const table of ['listing_content', 'listing_content_versions'] as const) {
    database.exec(`
      UPDATE ${table}
      SET store_authority_quarantined = CASE WHEN EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = '${table}'
          AND quarantine.source_row_id = CAST(${table}.id AS TEXT)
          AND quarantine.status = 'pending'
      ) THEN 1 ELSE 0 END
      WHERE store_authority_quarantined <> CASE WHEN EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = '${table}'
          AND quarantine.source_row_id = CAST(${table}.id AS TEXT)
          AND quarantine.status = 'pending'
      ) THEN 1 ELSE 0 END
    `);
  }
}

function mergeOwnedDuplicates(database: Database.Database): number {
  const duplicates = database.prepare(`
    SELECT store_id, upper(trim(asin)) AS normalized_asin
    FROM listing_content
    WHERE store_id IS NOT NULL
      AND trim(asin) <> ''
      AND store_authority_quarantined = 0
    GROUP BY store_id, upper(trim(asin))
    HAVING COUNT(*) > 1
    ORDER BY store_id, normalized_asin
  `).all() as Array<{ store_id: string; normalized_asin: string }>;
  let merged = 0;
  for (const duplicate of duplicates) {
    const rows = database.prepare(`
      SELECT *
      FROM listing_content
      WHERE store_id = ?
        AND upper(trim(asin)) = ?
        AND store_authority_quarantined = 0
      ORDER BY julianday(updated_at) DESC, COALESCE(updated_at, '') DESC, id DESC
    `).all(duplicate.store_id, duplicate.normalized_asin) as ListingRow[];
    const [keeper, ...losers] = rows;
    if (!keeper) continue;

    for (const loser of losers) {
      const crossStoreVersion = database.prepare(`
        SELECT id, store_id
        FROM listing_content_versions
        WHERE listing_content_id = ?
          AND store_authority_quarantined = 0
          AND store_id IS NOT NULL
          AND store_id <> ?
          AND NOT EXISTS (
            SELECT 1
            FROM store_migration_quarantine quarantine
            WHERE quarantine.source_table = 'listing_content_versions'
              AND quarantine.source_row_id = CAST(listing_content_versions.id AS TEXT)
              AND quarantine.status = 'pending'
          )
        ORDER BY id
        LIMIT 1
      `).get(loser.id, duplicate.store_id) as { id: number; store_id: string } | undefined;
      if (crossStoreVersion) {
        throw new ListingStoreAuthorityMigrationError(
          `Listing ${loser.id} has version ${crossStoreVersion.id} owned by another store.`,
        );
      }

      database.prepare(`
        UPDATE listing_content_versions
        SET listing_content_id = ?, store_id = ?
        WHERE listing_content_id = ?
          AND store_authority_quarantined = 0
          AND NOT EXISTS (
            SELECT 1
            FROM store_migration_quarantine quarantine
            WHERE quarantine.source_table = 'listing_content_versions'
              AND quarantine.source_row_id = CAST(listing_content_versions.id AS TEXT)
              AND quarantine.status = 'pending'
          )
      `).run(keeper.id, duplicate.store_id, loser.id);
      insertLoserSnapshot(database, duplicate.store_id, keeper.id, loser);
      recordMergedLoser(database, duplicate.store_id, duplicate.normalized_asin, keeper.id, loser);
      const removed = database.prepare(`
        DELETE FROM listing_content
        WHERE id = ? AND store_id = ? AND store_authority_quarantined = 0
      `).run(loser.id, duplicate.store_id);
      if (removed.changes !== 1) {
        throw new ListingStoreAuthorityMigrationError(`Listing ${loser.id} could not be merged.`);
      }
      merged += 1;
    }
  }
  return merged;
}

function insertLoserSnapshot(
  database: Database.Database,
  storeId: string,
  keeperId: number,
  loser: ListingRow,
): void {
  database.prepare(`
    INSERT INTO listing_content_versions (
      store_id, listing_content_id, asin, store_name, marketplace_code,
      title, bullets_json, description, a_plus, image_copy, backend_terms,
      source, source_url, screenshot_path, version_label, change_summary,
      created_at
    ) VALUES (
      @storeId, @listingContentId, @asin, @storeName, @marketplaceCode,
      @title, @bulletsJson, @description, @aPlus, @imageCopy, @backendTerms,
      @source, @sourceUrl, @screenshotPath, @versionLabel, @changeSummary,
      @createdAt
    )
  `).run({
    storeId,
    listingContentId: keeperId,
    asin: String(loser.asin ?? '').trim().toUpperCase(),
    storeName: loser.store_name,
    marketplaceCode: loser.marketplace_code,
    title: loser.title,
    bulletsJson: loser.bullets_json ?? '[]',
    description: loser.description,
    aPlus: loser.a_plus,
    imageCopy: loser.image_copy,
    backendTerms: loser.backend_terms,
    source: loser.source,
    sourceUrl: loser.source_url,
    screenshotPath: loser.screenshot_path,
    versionLabel: loser.version_label,
    changeSummary: loser.change_summary,
    createdAt: loser.updated_at ?? loser.created_at ?? new Date().toISOString(),
  });
}

function recordMergedLoser(
  database: Database.Database,
  storeId: string,
  normalizedAsin: string,
  keeperId: number,
  loser: ListingRow,
): void {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      normalized_store_name, normalized_marketplace_code,
      candidate_store_ids_json, source_identity_json,
      status, resolved_store_id, resolution_note,
      created_at, updated_at, resolved_at
    ) VALUES (
      @migrationVersion, 'listing_content', @sourceRowId,
      'duplicate_normalized_asin_merged',
      @normalizedStoreName, @normalizedMarketplaceCode,
      @candidateStoreIdsJson, @sourceIdentityJson,
      'resolved', @resolvedStoreId, @resolutionNote,
      @createdAt, @updatedAt, @resolvedAt
    )
    ON CONFLICT(migration_version, source_table, source_row_id) DO NOTHING
  `).run({
    migrationVersion: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
    sourceRowId: String(loser.id),
    normalizedStoreName: normalizeStoreName(loser.store_name) || null,
    normalizedMarketplaceCode: normalizeMarketplace(loser.marketplace_code) || null,
    candidateStoreIdsJson: JSON.stringify([storeId]),
    sourceIdentityJson: JSON.stringify({
      asin: optionalText(loser.asin),
      title: optionalText(loser.title),
      versionLabel: optionalText(loser.version_label),
    }),
    resolvedStoreId: storeId,
    resolutionNote: `Merged into listing ${keeperId} by normalized ASIN ${normalizedAsin}.`,
    createdAt: now,
    updatedAt: now,
    resolvedAt: now,
  });
}

function isolateUnownedRows(database: Database.Database): number {
  const duplicateAsins = new Set((database.prepare(`
    SELECT upper(trim(asin)) AS normalized_asin
    FROM listing_content
    WHERE store_id IS NULL AND trim(asin) <> ''
    GROUP BY upper(trim(asin))
    HAVING COUNT(*) > 1
  `).all() as Array<{ normalized_asin: string }>).map((row) => row.normalized_asin));
  const contentRows = database.prepare(`
    SELECT *
    FROM listing_content
    WHERE store_id IS NULL
    ORDER BY id
  `).all() as ListingRow[];
  let isolated = 0;
  for (const row of contentRows) {
    const normalizedAsin = String(row.asin ?? '').trim().toUpperCase();
    isolated += quarantineUnownedRow(database, {
      sourceTable: 'listing_content',
      sourceRowId: row.id,
      reason: duplicateAsins.has(normalizedAsin)
        ? 'unowned_listing_duplicate_isolated'
        : 'unowned_listing_owner_isolated',
      storeName: row.store_name,
      marketplaceCode: row.marketplace_code,
      sourceIdentity: {
        asin: optionalText(row.asin),
        title: optionalText(row.title),
        versionLabel: optionalText(row.version_label),
      },
    });
  }

  const versionRows = database.prepare(`
    SELECT id, listing_content_id, store_id, asin, store_name,
           marketplace_code, title, version_label
    FROM listing_content_versions
    WHERE store_id IS NULL
    ORDER BY id
  `).all() as ListingVersionRow[];
  for (const row of versionRows) {
    isolated += quarantineUnownedRow(database, {
      sourceTable: 'listing_content_versions',
      sourceRowId: row.id,
      reason: 'unowned_listing_version_owner_isolated',
      storeName: row.store_name,
      marketplaceCode: row.marketplace_code,
      sourceIdentity: {
        listingContentId: row.listing_content_id,
        asin: optionalText(row.asin),
        title: optionalText(row.title),
        versionLabel: optionalText(row.version_label),
      },
    });
  }
  return isolated;
}

function quarantineUnownedRow(
  database: Database.Database,
  input: {
    sourceTable: 'listing_content' | 'listing_content_versions';
    sourceRowId: number;
    reason: string;
    storeName: string | null;
    marketplaceCode: string | null;
    sourceIdentity: Record<string, unknown>;
  },
): number {
  const alreadyPending = database.prepare(`
    SELECT 1
    FROM store_migration_quarantine
    WHERE source_table = ?
      AND source_row_id = ?
      AND status = 'pending'
    LIMIT 1
  `).get(input.sourceTable, String(input.sourceRowId));
  if (alreadyPending) return 0;

  const now = new Date().toISOString();
  const result = database.prepare(`
    INSERT INTO store_migration_quarantine (
      migration_version, source_table, source_row_id, reason,
      normalized_store_name, normalized_marketplace_code,
      candidate_store_ids_json, source_identity_json,
      status, created_at, updated_at
    ) VALUES (
      @migrationVersion, @sourceTable, @sourceRowId, @reason,
      @normalizedStoreName, @normalizedMarketplaceCode,
      '[]', @sourceIdentityJson,
      'pending', @createdAt, @updatedAt
    )
    ON CONFLICT(migration_version, source_table, source_row_id) DO UPDATE SET
      reason = excluded.reason,
      normalized_store_name = excluded.normalized_store_name,
      normalized_marketplace_code = excluded.normalized_marketplace_code,
      candidate_store_ids_json = excluded.candidate_store_ids_json,
      source_identity_json = excluded.source_identity_json,
      status = 'pending',
      resolved_store_id = NULL,
      resolution_note = NULL,
      updated_at = excluded.updated_at,
      resolved_at = NULL
  `).run({
    migrationVersion: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
    sourceTable: input.sourceTable,
    sourceRowId: String(input.sourceRowId),
    reason: input.reason,
    normalizedStoreName: normalizeStoreName(input.storeName) || null,
    normalizedMarketplaceCode: normalizeMarketplace(input.marketplaceCode) || null,
    sourceIdentityJson: JSON.stringify(input.sourceIdentity),
    createdAt: now,
    updatedAt: now,
  });
  return Number(result.changes);
}

export function verifyListingStoreAuthoritySchema(database: Database.Database): void {
  const index = database.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?
  `).get(LISTING_STORE_UNIQUE_INDEX) as { sql: string } | undefined;
  if (!index
    || !/store_id\s*,\s*upper\s*\(\s*trim\s*\(\s*asin\s*\)\s*\)/i.test(index.sql)
    || !/store_authority_quarantined\s*=\s*0/i.test(index.sql)) {
    throw new ListingStoreAuthorityMigrationError(
      `Required Listing identity index is missing or malformed: ${LISTING_STORE_UNIQUE_INDEX}.`,
    );
  }
  for (const table of ['listing_content', 'listing_content_versions'] as const) {
    if (!hasColumn(database, table, 'store_authority_quarantined')) {
      throw new ListingStoreAuthorityMigrationError(
        `Required Listing quarantine marker is missing: ${table}.store_authority_quarantined.`,
      );
    }
    const markerMismatch = database.prepare(`
      SELECT listing.id
      FROM ${table} listing
      WHERE listing.store_authority_quarantined <> CASE WHEN EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = ?
          AND quarantine.source_row_id = CAST(listing.id AS TEXT)
          AND quarantine.status = 'pending'
      ) THEN 1 ELSE 0 END
      ORDER BY listing.id
      LIMIT 1
    `).get(table) as { id: number } | undefined;
    if (markerMismatch) {
      throw new ListingStoreAuthorityMigrationError(
        `Listing quarantine marker is stale: ${table} row ${markerMismatch.id}.`,
      );
    }
  }
  for (const triggerName of LISTING_STORE_AUTHORITY_TRIGGERS) {
    const trigger = database.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'trigger' AND name = ?
    `).get(triggerName) as { sql: string } | undefined;
    if (!trigger
      || !/NEW\.store_id\s+IS\s+NULL/i.test(trigger.sql)
      || !/RAISE\s*\(\s*ABORT/i.test(trigger.sql)) {
      throw new ListingStoreAuthorityMigrationError(
        `Required Listing authority trigger is missing or malformed: ${triggerName}.`,
      );
    }
  }
  const duplicate = database.prepare(`
    SELECT store_id, upper(trim(asin)) AS asin
    FROM listing_content
    WHERE store_id IS NOT NULL
      AND trim(asin) <> ''
      AND store_authority_quarantined = 0
    GROUP BY store_id, upper(trim(asin))
    HAVING COUNT(*) > 1
    LIMIT 1
  `).get();
  if (duplicate) {
    throw new ListingStoreAuthorityMigrationError('Owned normalized Listing duplicates remain after migration.');
  }

  for (const table of ['listing_content', 'listing_content_versions'] as const) {
    const unquarantined = database.prepare(`
      SELECT listing.id
      FROM ${table} listing
      WHERE listing.store_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM store_migration_quarantine quarantine
          WHERE quarantine.source_table = ?
            AND quarantine.source_row_id = CAST(listing.id AS TEXT)
            AND quarantine.status = 'pending'
        )
      ORDER BY listing.id
      LIMIT 1
    `).get(table) as { id: number } | undefined;
    if (unquarantined) {
      throw new ListingStoreAuthorityMigrationError(
        `Unowned ${table} row ${unquarantined.id} is not quarantined.`,
      );
    }
  }
}

function prepareBoundBackup(
  database: Database.Database,
  existing: MigrationRow | undefined,
): ListingStoreMigrationManifest {
  const previous = parseJson<ListingStoreMigrationManifest | undefined>(
    existing?.manifest_json,
    undefined,
  );
  if (previous?.backup && isBoundBackup(database, previous.backup)) {
    verifyBoundBackup(database, previous.backup);
    return {
      ...previous,
      version: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
      name: LISTING_STORE_AUTHORITY_MIGRATION_NAME,
      checksum: LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
      backup: previous.backup.status === 'created'
        ? { ...previous.backup, status: 'reused' }
        : previous.backup,
    };
  }

  const integrityCheck = database.pragma('integrity_check', { simple: true }) as string;
  if (integrityCheck !== 'ok') {
    throw new ListingStoreAuthorityMigrationError(
      `Source database integrity_check returned: ${integrityCheck}`,
    );
  }
  const databasePath = fileBackedDatabasePath(database);
  const backupPath = databasePath ? `${databasePath}.pre-listing-store-authority-v4.bak` : undefined;
  const pendingBackup: MigrationBackupManifest = databasePath && backupPath
    ? { status: 'pending', databasePath, backupPath, integrityCheck }
    : { status: 'not_applicable', integrityCheck };
  const manifest: ListingStoreMigrationManifest = {
    version: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
    name: LISTING_STORE_AUTHORITY_MIGRATION_NAME,
    checksum: LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
    startedAt: new Date().toISOString(),
    listingRowCount: countRows(database, 'listing_content'),
    listingVersionRowCount: countRows(database, 'listing_content_versions'),
    backup: pendingBackup,
  };
  const matchingPending = previous?.backup.status === 'pending'
    && previous.backup.databasePath === databasePath
    && previous.backup.backupPath === backupPath;
  if (backupPath && fs.existsSync(backupPath) && !matchingPending) {
    throw new ListingStoreAuthorityMigrationError(
      'An unbound Listing migration backup already exists; refusing to replace it.',
    );
  }
  writeStartedState(database, manifest, defaultResult('started', manifest.startedAt));
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
    throw new ListingStoreAuthorityMigrationError(
      `Backup integrity_check returned: ${boundBackup.integrityCheck}`,
    );
  }
  const boundManifest = { ...manifest, backup: boundBackup };
  database.prepare(`
    UPDATE schema_migrations SET manifest_json = ? WHERE version = ?
  `).run(JSON.stringify(boundManifest), LISTING_STORE_AUTHORITY_MIGRATION_VERSION);
  return boundManifest;
}

function writeStartedState(
  database: Database.Database,
  manifest: ListingStoreMigrationManifest,
  result: ListingStoreAuthorityMigrationResult,
): void {
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
    version: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
    name: LISTING_STORE_AUTHORITY_MIGRATION_NAME,
    checksum: LISTING_STORE_AUTHORITY_MIGRATION_CHECKSUM,
    startedAt: manifest.startedAt,
    manifestJson: JSON.stringify(manifest),
    resultJson: JSON.stringify(result),
  });
}

function verifyBoundBackup(database: Database.Database, backup: MigrationBackupManifest): void {
  if (backup.status === 'not_applicable') return;
  if (!isBoundBackup(database, backup) || !backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new ListingStoreAuthorityMigrationError('Migration 4 does not have a valid bound backup.');
  }
  if (checkDatabaseFileIntegrity(backup.backupPath) !== 'ok' || hashFile(backup.backupPath) !== backup.sha256) {
    throw new ListingStoreAuthorityMigrationError(
      'Migration 4 backup integrity or SHA-256 binding failed.',
    );
  }
}

function isBoundBackup(database: Database.Database, backup: MigrationBackupManifest): boolean {
  const databasePath = fileBackedDatabasePath(database);
  if (!databasePath) return backup.status === 'not_applicable';
  return (backup.status === 'created' || backup.status === 'reused')
    && backup.databasePath === databasePath
    && backup.backupPath === `${databasePath}.pre-listing-store-authority-v4.bak`
    && Boolean(backup.sha256);
}

function assertProductStoreAuthorityApplied(database: Database.Database): void {
  const migration = database.prepare(`
    SELECT status FROM schema_migrations WHERE version = 3
  `).get() as { status: string } | undefined;
  if (migration?.status !== 'applied') {
    throw new ListingStoreAuthorityMigrationError(
      'Product Store Authority migration v3 must be applied before migration v4.',
    );
  }
}

function readMigration(database: Database.Database): MigrationRow | undefined {
  return database.prepare(`
    SELECT checksum, status, manifest_json, result_json
    FROM schema_migrations WHERE version = ?
  `).get(LISTING_STORE_AUTHORITY_MIGRATION_VERSION) as MigrationRow | undefined;
}

function defaultResult(
  status: MigrationStatus,
  startedAt: string,
): ListingStoreAuthorityMigrationResult {
  return {
    version: LISTING_STORE_AUTHORITY_MIGRATION_VERSION,
    name: LISTING_STORE_AUTHORITY_MIGRATION_NAME,
    status,
    startedAt,
    mergedDuplicateRows: 0,
    isolatedUnownedRows: 0,
  };
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
