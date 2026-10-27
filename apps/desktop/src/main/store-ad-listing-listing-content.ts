import { inspectAmazonAsin, type StoreContextEnvelope, type StoreId, type StoreRecord } from '@amazon-ai-ops/shared-types';
import {
  type StoreListingContentListInput,
  type VersionedStoreListingContent,
  type ListingRow,
  type StoreListingContentLookupInput,
  type StoreListingContentCreateInput,
  StoreScopedAdListingError,
  type StoreListingContentUpdateInput,
  type StoreListingContentDeleteInput,
  type StoreListingVersionListInput,
  type StoreListingContentVersion,
} from "./store-ad-listing-contracts";
import {
  LISTING_LIST_KEYS,
  LISTING_LOOKUP_KEYS,
  LISTING_CREATE_KEYS,
  SQL_NOW,
  LISTING_UPDATE_KEYS,
  LISTING_PATCH_KEYS,
  IDENTITY_HINT_KEYS,
  LISTING_DELETE_KEYS,
  LISTING_VERSION_LIST_KEYS,
} from "./store-ad-listing-constants";
import {
  requireObject,
  rejectUnknownKeys,
  optionalAsin,
  optionalText,
  positiveLimit,
  escapeLike,
  invalid,
  positiveInteger,
  normalizeAsin,
  notFound,
  writeFailed,
  isSqliteConstraint,
  normalizeAsinForWrite,
  nonNegativeInteger,
  parseStringArray,
  nonEmptyString,
} from "./store-ad-listing-input-values";
import { normalizeListingCreate, assertExpectedRevision, mergeListingPatch, listingRevision } from "./store-ad-listing-listing-values";
import { authorize, assertIdentityHints } from "./store-ad-listing-store-access";
import type { StoreAdListingRuntime } from './store-ad-listing-runtime';

export function listListingContent(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope,
  input: StoreListingContentListInput = {}): VersionedStoreListingContent[] {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content list input');
    rejectUnknownKeys(value, LISTING_LIST_KEYS, 'listing content list input');
    this.assertIdentityHints(store, value);
    const asin = optionalAsin(value.asin);
    const query = optionalText(value.query, 'query', 120);
    const limit = positiveLimit(value.limit, 250, 1_000);
    const clauses = [
      'listing.store_id = ?',
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'listing_content'
          AND quarantine.source_row_id = CAST(listing.id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
    ];
    const parameters: unknown[] = [store.storeId];
    if (asin) {
      clauses.push('upper(trim(listing.asin)) = ?');
      parameters.push(asin);
    }
    if (query) {
      const like = `%${escapeLike(query)}%`;
      clauses.push("(listing.asin LIKE ? ESCAPE '\\' OR listing.title LIKE ? ESCAPE '\\')");
      parameters.push(like, like);
    }
    const rows = this.db.prepare(`
      SELECT listing.* FROM listing_content listing
      WHERE ${clauses.join(' AND ')}
      ORDER BY listing.updated_at DESC, listing.id DESC
      LIMIT ?
    `).all(...parameters, limit) as ListingRow[];
    return rows.map((row) => this.projectListing(store, row));
  }

export function getListingContent(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope,
  input: StoreListingContentLookupInput): VersionedStoreListingContent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content lookup input');
    rejectUnknownKeys(value, LISTING_LOOKUP_KEYS, 'listing content lookup input');
    this.assertIdentityHints(store, value);
    const hasId = value.id !== undefined;
    const hasAsin = value.asin !== undefined;
    if (hasId === hasAsin) throw invalid('listing lookup requires exactly one of id or asin');
    const row = hasId
      ? this.findListingById(store.storeId, positiveInteger(value.id, 'listing content id'))
      : this.findListingByAsin(store.storeId, normalizeAsin(value.asin));
    if (!row) throw notFound('listing content');
    return this.projectListing(store, row);
  }

export function createListingContent(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope,
  input: StoreListingContentCreateInput): VersionedStoreListingContent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content create input');
    rejectUnknownKeys(value, LISTING_CREATE_KEYS, 'listing content create input');
    this.assertIdentityHints(store, value);
    const normalized = normalizeListingCreate(value);
    const create = this.db.transaction(() => {
      if (this.findListingByAsin(store.storeId, normalized.asin)) {
        throw new StoreScopedAdListingError(
          'OBJECT_ALREADY_EXISTS',
          `listing content for ${normalized.asin} already exists in the active store`,
        );
      }
      const result = this.db.prepare(`
        INSERT INTO listing_content (
          store_id, store_name, marketplace_code, asin, title, bullets_json,
          description, a_plus, image_copy, backend_terms, source,
          version_label, change_summary, created_at, updated_at
        ) VALUES (?, ?, 'US', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW}, ${SQL_NOW})
      `).run(
        store.storeId,
        store.displayName,
        normalized.asin,
        normalized.title,
        JSON.stringify(normalized.bullets),
        normalized.description,
        normalized.aPlus,
        normalized.imageCopy,
        normalized.backendTerms,
        normalized.source,
        normalized.versionLabel,
        normalized.changeSummary,
      );
      const row = this.findListingById(store.storeId, Number(result.lastInsertRowid));
      if (!row) throw writeFailed('created listing content cannot be read back');
      this.insertListingVersion(store, row);
      return this.projectListing(store, row);
    });
    try {
      return create.immediate();
    } catch (error) {
      if (isSqliteConstraint(error)) {
        throw new StoreScopedAdListingError(
          'OBJECT_ALREADY_EXISTS',
          `listing content for ${normalized.asin} conflicts with the store ASIN authority`,
        );
      }
      throw error;
    }
  }

export function updateListingContent(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope,
  input: StoreListingContentUpdateInput): VersionedStoreListingContent {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content update input');
    rejectUnknownKeys(value, LISTING_UPDATE_KEYS, 'listing content update input');
    const id = positiveInteger(value.id, 'listing content id');
    const patch = requireObject(value.patch, 'listing content patch');
    rejectUnknownKeys(patch, LISTING_PATCH_KEYS, 'listing content patch');
    this.assertIdentityHints(store, patch);
    if (Object.keys(patch).every((key) => IDENTITY_HINT_KEYS.has(key))) {
      throw invalid('listing content update requires at least one editable field');
    }

    return this.db.transaction(() => {
      const current = this.findListingById(store.storeId, id);
      if (!current) throw notFound('listing content');
      const projected = this.projectListing(store, current);
      assertExpectedRevision(value.expectedRevision, projected.revision);
      if (!projected.asinValid) {
        throw invalid('historical Listing has an invalid ASIN and is read-only until reconciled');
      }
      if (patch.asin !== undefined && normalizeAsinForWrite(patch.asin) !== projected.asin) {
        throw invalid('changing a Listing ASIN is not supported; create a new object instead');
      }
      const next = mergeListingPatch(projected, patch);
      const result = this.db.prepare(`
        UPDATE listing_content
        SET title = ?, bullets_json = ?, description = ?, a_plus = ?,
            image_copy = ?, backend_terms = ?, source = ?, version_label = ?,
            change_summary = ?, store_name = ?, marketplace_code = 'US',
            updated_at = ${SQL_NOW}
        WHERE id = ? AND store_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM store_migration_quarantine quarantine
            WHERE quarantine.source_table = 'listing_content'
              AND quarantine.source_row_id = CAST(listing_content.id AS TEXT)
              AND quarantine.status = 'pending'
          )
      `).run(
        next.title,
        JSON.stringify(next.bullets),
        next.description,
        next.aPlus,
        next.imageCopy,
        next.backendTerms,
        next.source,
        next.versionLabel,
        next.changeSummary,
        store.displayName,
        id,
        store.storeId,
      );
      if (result.changes !== 1) throw writeFailed('listing content update was not applied');
      const updated = this.findListingById(store.storeId, id);
      if (!updated) throw writeFailed('updated listing content cannot be read back');
      this.insertListingVersion(store, updated);
      return this.projectListing(store, updated);
    }).immediate();
  }

export function deleteListingContent(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope,
  input: StoreListingContentDeleteInput): { id: number; deleted: true } {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing content delete input');
    rejectUnknownKeys(value, LISTING_DELETE_KEYS, 'listing content delete input');
    const id = positiveInteger(value.id, 'listing content id');
    return this.db.transaction(() => {
      const current = this.findListingById(store.storeId, id);
      if (!current) throw notFound('listing content');
      const projected = this.projectListing(store, current);
      assertExpectedRevision(value.expectedRevision, projected.revision);
      if (!projected.asinValid) {
        throw invalid('historical Listing has an invalid ASIN and cannot be deleted until reconciled');
      }
      const result = this.db.prepare(`
        DELETE FROM listing_content
        WHERE id = ? AND store_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM store_migration_quarantine quarantine
            WHERE quarantine.source_table = 'listing_content'
              AND quarantine.source_row_id = CAST(listing_content.id AS TEXT)
              AND quarantine.status = 'pending'
          )
      `).run(id, store.storeId);
      if (result.changes !== 1) throw writeFailed('listing content delete was not applied');
      return { id, deleted: true as const };
    }).immediate();
  }

export function listListingVersions(this: StoreAdListingRuntime,
  contextInput: StoreContextEnvelope,
  input: StoreListingVersionListInput = {}): StoreListingContentVersion[] {
    const store = this.authorize(contextInput);
    const value = requireObject(input, 'listing version list input');
    rejectUnknownKeys(value, LISTING_VERSION_LIST_KEYS, 'listing version list input');
    this.assertIdentityHints(store, value);
    const clauses = [
      'version.store_id = ?',
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'listing_content_versions'
          AND quarantine.source_row_id = CAST(version.id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
      `NOT EXISTS (
        SELECT 1
        FROM store_migration_quarantine quarantine
        WHERE quarantine.source_table = 'listing_content'
          AND quarantine.source_row_id = CAST(version.listing_content_id AS TEXT)
          AND quarantine.status = 'pending'
      )`,
    ];
    const parameters: unknown[] = [store.storeId];
    const hasListingContentId = value.listingContentId !== undefined;
    if (hasListingContentId) {
      clauses.push('version.listing_content_id = ?');
      parameters.push(positiveInteger(value.listingContentId, 'listing content id'));
    }
    // An id is the durable historical identity. In particular, migrated rows
    // may intentionally retain a legacy ASIN that no longer passes the write
    // validator. Never normalize that display value when the caller already
    // supplied the authoritative listing_content_id.
    if (!hasListingContentId && value.asin !== undefined) {
      clauses.push('upper(trim(version.asin)) = ?');
      parameters.push(normalizeAsin(value.asin));
    }
    const limit = positiveLimit(value.limit, 100, 500);
    const offset = nonNegativeInteger(value.offset, 'offset');
    const rows = this.db.prepare(`
      SELECT version.* FROM listing_content_versions version
      WHERE ${clauses.join(' AND ')}
      ORDER BY version.created_at DESC, version.id DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: positiveInteger(row.id, 'listing version id'),
      listingContentId: row.listing_content_id === null || row.listing_content_id === undefined
        ? undefined
        : positiveInteger(row.listing_content_id, 'listing content id'),
      storeId: store.storeId,
      asin: inspectAmazonAsin(row.asin).canonical,
      asinValid: inspectAmazonAsin(row.asin).valid,
      title: optionalText(row.title, 'title', 500) ?? '',
      bullets: parseStringArray(row.bullets_json, 20, 2_000),
      description: optionalText(row.description, 'description', 20_000) ?? '',
      aPlus: optionalText(row.a_plus, 'aPlus', 20_000) ?? '',
      imageCopy: optionalText(row.image_copy, 'imageCopy', 20_000) ?? '',
      backendTerms: optionalText(row.backend_terms, 'backendTerms', 5_000) ?? '',
      source: optionalText(row.source, 'source', 80) ?? 'manual',
      versionLabel: optionalText(row.version_label, 'versionLabel', 160) ?? '',
      changeSummary: optionalText(row.change_summary, 'changeSummary', 1_000) ?? '',
      createdAt: nonEmptyString(row.created_at) ?? '',
    }));
  }

export function findListingById(this: StoreAdListingRuntime,
  storeId: StoreId,
  id: number): ListingRow | undefined {
    return this.db.prepare(`
      SELECT listing.*
      FROM listing_content listing
      WHERE listing.store_id = ? AND listing.id = ?
        AND NOT EXISTS (
          SELECT 1
          FROM store_migration_quarantine quarantine
          WHERE quarantine.source_table = 'listing_content'
            AND quarantine.source_row_id = CAST(listing.id AS TEXT)
            AND quarantine.status = 'pending'
        )
    `)
      .get(storeId, id) as ListingRow | undefined;
  }

export function findListingByAsin(this: StoreAdListingRuntime,
  storeId: StoreId,
  asin: string): ListingRow | undefined {
    return this.db.prepare(`
      SELECT listing.*
      FROM listing_content listing
      WHERE listing.store_id = ? AND upper(trim(listing.asin)) = ?
        AND NOT EXISTS (
          SELECT 1
          FROM store_migration_quarantine quarantine
          WHERE quarantine.source_table = 'listing_content'
            AND quarantine.source_row_id = CAST(listing.id AS TEXT)
            AND quarantine.status = 'pending'
        )
      ORDER BY listing.updated_at DESC, listing.id DESC
      LIMIT 1
    `).get(storeId, asin) as ListingRow | undefined;
  }

export function projectListing(this: StoreAdListingRuntime,
  store: StoreRecord,
  row: ListingRow): VersionedStoreListingContent {
    const asin = inspectAmazonAsin(row.asin);
    const listing = {
      id: Number(row.id),
      storeId: store.storeId,
      storeName: store.displayName,
      marketplace: 'US' as const,
      currency: 'USD' as const,
      asin: asin.canonical,
      asinValid: asin.valid,
      title: row.title ?? '',
      bullets: parseStringArray(row.bullets_json, 20, 2_000),
      description: row.description ?? '',
      aPlus: row.a_plus ?? '',
      imageCopy: row.image_copy ?? '',
      backendTerms: row.backend_terms ?? '',
      source: row.source ?? 'manual',
      versionLabel: row.version_label ?? '',
      changeSummary: row.change_summary ?? '',
      createdAt: row.created_at ?? '',
      updatedAt: row.updated_at ?? '',
    };
    return { ...listing, revision: listingRevision(listing) };
  }

export function insertListingVersion(this: StoreAdListingRuntime,
  store: StoreRecord,
  row: ListingRow): void {
    const result = this.db.prepare(`
      INSERT INTO listing_content_versions (
        store_id, listing_content_id, asin, store_name, marketplace_code,
        title, bullets_json, description, a_plus, image_copy, backend_terms,
        source, version_label, change_summary, created_at
      ) VALUES (?, ?, ?, ?, 'US', ?, ?, ?, ?, ?, ?, ?, ?, ?, ${SQL_NOW})
    `).run(
      store.storeId,
      row.id,
      inspectAmazonAsin(row.asin).canonical,
      store.displayName,
      row.title ?? '',
      row.bullets_json ?? '[]',
      row.description ?? '',
      row.a_plus ?? '',
      row.image_copy ?? '',
      row.backend_terms ?? '',
      row.source ?? 'manual',
      row.version_label ?? '',
      row.change_summary ?? '',
    );
    if (result.changes !== 1) throw writeFailed('listing content version was not persisted');
  }
