import { describe, expect, it } from 'vitest';
import { createHarness } from './store-ad-listing.test-fixtures';

describe('StoreScopedAdListingService', () => {
it('supports isolated Listing CRUD with revision CAS and durable store-owned versions', () => {
    const harness = createHarness();
    const firstContext = harness.switchFirst();
    const first = harness.service.createListingContent(firstContext, {
      asin: 'B0LIST0001',
      title: 'First store title',
      bullets: ['One', 'Two'],
      backendTerms: 'smart lock',
      versionLabel: 'v1',
      marketplace: 'US',
      currency: 'USD',
    });
    expect(first).toMatchObject({
      storeId: harness.firstStoreId,
      marketplace: 'US',
      currency: 'USD',
      asin: 'B0LIST0001',
      asinValid: true,
      title: 'First store title',
      bullets: ['One', 'Two'],
    });
    expect(first.revision).toMatch(/^listing-content-v1:[a-f0-9]{64}$/);

    const secondContext = harness.switchSecond();
    const second = harness.service.createListingContent(secondContext, {
      asin: 'B0LIST0001',
      title: 'Second store title',
    });
    expect(second.storeId).toBe(harness.secondStoreId);
    expect(() => harness.service.getListingContent(secondContext, { id: first.id }))
      .toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));

    const refreshedFirst = harness.switchFirst();
    const updated = harness.service.updateListingContent(refreshedFirst, {
      id: first.id,
      expectedRevision: first.revision,
      patch: {
        title: 'Updated first title',
        changeSummary: 'Operator reviewed title',
        marketplace: 'US',
        currency: 'USD',
      },
    });
    expect(updated.title).toBe('Updated first title');
    expect(updated.revision).not.toBe(first.revision);
    expect(() => harness.service.updateListingContent(refreshedFirst, {
      id: first.id,
      expectedRevision: first.revision,
      patch: { title: 'Stale overwrite' },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_CONFLICT' }));
    expect(harness.service.listListingVersions(refreshedFirst, { listingContentId: first.id }))
      .toHaveLength(2);

    expect(harness.service.deleteListingContent(refreshedFirst, {
      id: first.id,
      expectedRevision: updated.revision,
    })).toEqual({ id: first.id, deleted: true });
    expect(harness.service.listListingContent(refreshedFirst)).toEqual([]);
    expect(harness.service.listListingVersions(refreshedFirst, { listingContentId: first.id }))
      .toHaveLength(2);
    expect(harness.service.listListingVersions(refreshedFirst, { limit: 1, offset: 0 }))
      .toEqual([expect.objectContaining({
        listingContentId: first.id,
        storeId: harness.firstStoreId,
        title: 'Updated first title',
      })]);
    expect(harness.service.listListingVersions(refreshedFirst, { limit: 1, offset: 1 }))
      .toEqual([expect.objectContaining({
        listingContentId: first.id,
        storeId: harness.firstStoreId,
        title: 'First store title',
      })]);

    const backToSecond = harness.switchSecond();
    expect(harness.service.listListingContent(backToSecond)).toEqual([
      expect.objectContaining({ id: second.id, title: 'Second store title' }),
    ]);
    expect(harness.service.listListingVersions(backToSecond, { limit: 100, offset: 0 }))
      .toEqual([expect.objectContaining({
        listingContentId: second.id,
        storeId: harness.secondStoreId,
        title: 'Second store title',
      })]);
  });

it('uses IMMEDIATE transactions for every Listing mutation and rejects invalid ASIN writes', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const transactionModes: string[] = [];
    const originalTransaction = harness.db.transaction.bind(harness.db) as (...args: unknown[]) => any;
    (harness.db as any).transaction = (operation: (...args: unknown[]) => unknown) => {
      const transaction = originalTransaction(operation);
      const wrapped = (...args: unknown[]) => {
        transactionModes.push('deferred');
        return transaction(...args);
      };
      wrapped.deferred = (...args: unknown[]) => {
        transactionModes.push('deferred');
        return transaction.deferred(...args);
      };
      wrapped.immediate = (...args: unknown[]) => {
        transactionModes.push('immediate');
        return transaction.immediate(...args);
      };
      wrapped.exclusive = (...args: unknown[]) => {
        transactionModes.push('exclusive');
        return transaction.exclusive(...args);
      };
      return wrapped;
    };

    expect(() => harness.service.createListingContent(context, {
      asin: 'B0SHORT1',
      title: 'Invalid Listing',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    const created = harness.service.createListingContent(context, {
      asin: 'b0list0002',
      title: 'Transactional Listing',
    });
    const updated = harness.service.updateListingContent(context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: { title: 'Transactional Listing updated' },
    });
    harness.service.deleteListingContent(context, {
      id: updated.id,
      expectedRevision: updated.revision,
    });

    expect(transactionModes).toEqual(['immediate', 'immediate', 'immediate']);
  });

it('keeps legacy invalid Listing ASINs readable but read-only', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const result = harness.db.prepare(`
      INSERT INTO listing_content (
        store_id, asin, store_name, marketplace_code, title
      ) VALUES (?, 'B0-OLD_01', 'Same Display Name', 'US', 'Legacy invalid Listing')
    `).run(harness.firstStoreId);

    const legacy = harness.service.getListingContent(context, {
      id: Number(result.lastInsertRowid),
    });
    expect(legacy).toMatchObject({ asin: 'B0-OLD_01', asinValid: false });
    harness.db.prepare(`
      INSERT INTO listing_content_versions (
        store_id, listing_content_id, asin, store_name, marketplace_code,
        title, version_label, created_at
      ) VALUES (?, ?, 'B0-OLD_01', 'Same Display Name', 'US',
        'Legacy invalid Listing', 'legacy-v1', '2026-07-22 01:00:00.000')
    `).run(harness.firstStoreId, legacy.id);
    expect(harness.service.listListingVersions(context, {
      listingContentId: legacy.id,
      // The historical ASIN is deliberately invalid. listingContentId is the
      // durable authority and must prevent ASIN normalization from blocking
      // the operator's read-only history inspection.
      asin: legacy.asin,
      limit: 10,
    })).toEqual([expect.objectContaining({
      listingContentId: legacy.id,
      storeId: harness.firstStoreId,
      asin: 'B0-OLD_01',
      asinValid: false,
      versionLabel: 'legacy-v1',
    })]);
    expect(() => harness.service.updateListingContent(context, {
      id: legacy.id,
      expectedRevision: legacy.revision,
      patch: { title: 'Must remain read-only' },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => harness.service.deleteListingContent(context, {
      id: legacy.id,
      expectedRevision: legacy.revision,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(harness.db.prepare(`
      SELECT title FROM listing_content WHERE id = ?
    `).get(legacy.id)).toEqual({ title: 'Legacy invalid Listing' });
  });

it('keeps pending-quarantined Listing objects and versions invisible and immutable', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const listing = harness.service.createListingContent(context, {
      asin: 'B0PENDING1',
      title: 'Pending authority Listing',
    });
    const version = harness.db.prepare(`
      SELECT id
      FROM listing_content_versions
      WHERE listing_content_id = ?
      ORDER BY id
      LIMIT 1
    `).get(listing.id) as { id: number };
    const insertPending = harness.db.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        candidate_store_ids_json, source_identity_json, status,
        created_at, updated_at
      ) VALUES (1, ?, ?, 'ambiguous_store_identity', '[]', '{}',
        'pending', datetime('now'), datetime('now'))
    `);
    insertPending.run('listing_content', String(listing.id));
    insertPending.run('listing_content_versions', String(version.id));

    expect(harness.service.listListingContent(context)).toEqual([]);
    expect(() => harness.service.getListingContent(context, { id: listing.id }))
      .toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));
    expect(() => harness.service.updateListingContent(context, {
      id: listing.id,
      expectedRevision: listing.revision,
      patch: { title: 'Must not mutate pending authority' },
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));
    expect(() => harness.service.deleteListingContent(context, {
      id: listing.id,
      expectedRevision: listing.revision,
    })).toThrowError(expect.objectContaining({ code: 'OBJECT_NOT_FOUND' }));
    expect(harness.service.listListingVersions(context, {
      listingContentId: listing.id,
    })).toEqual([]);
    expect(harness.db.prepare(`
      SELECT title FROM listing_content WHERE id = ?
    `).get(listing.id)).toEqual({ title: 'Pending authority Listing' });

    expect(() => harness.service.createListingContent(context, {
      asin: 'B0FORGED01',
      currency: 'USDT',
    })).toThrowError(expect.objectContaining({ code: 'STORE_IDENTITY_MISMATCH' }));
    expect(() => harness.service.listAdObjects(context, {
      kind: 'campaign',
      unsupported: true,
    } as never)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

it('filters a pending version without hiding its reconciled Listing object', () => {
    const harness = createHarness();
    const context = harness.switchFirst();
    const created = harness.service.createListingContent(context, {
      asin: 'B0PENDING2',
      title: 'Reconciled Listing',
    });
    harness.service.updateListingContent(context, {
      id: created.id,
      expectedRevision: created.revision,
      patch: { title: 'Reconciled Listing v2' },
    });
    const versions = harness.db.prepare(`
      SELECT id
      FROM listing_content_versions
      WHERE listing_content_id = ?
      ORDER BY id
    `).all(created.id) as Array<{ id: number }>;
    expect(versions).toHaveLength(2);
    harness.db.prepare(`
      INSERT INTO store_migration_quarantine (
        migration_version, source_table, source_row_id, reason,
        candidate_store_ids_json, source_identity_json, status,
        created_at, updated_at
      ) VALUES (1, 'listing_content_versions', ?, 'ambiguous_parent_store',
        '[]', '{}', 'pending', datetime('now'), datetime('now'))
    `).run(String(versions[0].id));

    expect(harness.service.listListingContent(context)).toEqual([
      expect.objectContaining({ id: created.id, title: 'Reconciled Listing v2' }),
    ]);
    expect(harness.service.listListingVersions(context, {
      listingContentId: created.id,
    })).toEqual([
      expect.objectContaining({ id: versions[1].id, title: 'Reconciled Listing v2' }),
    ]);
  });
});
