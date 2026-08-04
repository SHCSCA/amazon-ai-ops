import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { StoreId } from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { OperationEventRepository } from './operation-event-repo';

function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-operation-events-'));
  const db = initSqlite(path.join(dir, 'test.db'));
  return { db, dir, repo: new OperationEventRepository(db) };
}

describe('OperationEventRepository', () => {
  it('creates and lists operator events by store, marketplace, date range, and ASIN', () => {
    const { db, dir, repo } = createRepo();

    try {
      const id = repo.create({
        eventDate: '2026-06-10',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        eventType: 'coupon',
        title: '10% coupon started',
        impactExpectation: 'conversion_up',
        notes: 'Coupon opened for launch push',
        evidencePath: 'C:/evidence/coupon.png',
      });

      repo.create({
        eventDate: '2026-06-11',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B002',
        eventType: 'bd',
        title: 'BD submitted',
      });

      repo.create({
        eventDate: '2026-06-10',
        storeName: 'OTHER',
        marketplaceCode: 'US',
        asin: 'B001',
        eventType: 'price_change',
        title: 'Other store price change',
      });

      const rows = repo.findByScope({
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'b001',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(expect.objectContaining({
        id,
        eventDate: '2026-06-10',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        eventType: 'coupon',
        title: '10% coupon started',
        impactExpectation: 'conversion_up',
        notes: 'Coupon opened for launch push',
        evidencePath: 'C:/evidence/coupon.png',
      }));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('preserves campaign and ad group context for advertising events', () => {
    const { db, dir, repo } = createRepo();

    try {
      repo.create({
        eventDate: '2026-06-10',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        campaignName: 'SP exact launch',
        adGroupName: 'Main ad group',
        eventType: 'promotion',
        title: 'Coupon attached to exact campaign',
      });

      const rows = repo.findByScope({
        dateFrom: '2026-06-01',
        dateTo: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        campaignName: 'SP exact launch',
        adGroupName: 'Main ad group',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        campaignName: 'SP exact launch',
        adGroupName: 'Main ad group',
      });
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('updates and archives events without destroying historical rows', () => {
    const { db, dir, repo } = createRepo();

    try {
      const targetId = repo.create({
        eventDate: '2026-06-10',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        eventType: 'promotion',
        title: 'Prime promotion',
      });
      const otherId = repo.create({
        eventDate: '2026-06-10',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B002',
        eventType: 'coupon',
        title: 'Coupon for another ASIN',
      });

      expect(repo.update(targetId, {
        title: 'Prime promotion updated',
        notes: 'Discount increased',
      })).toBe(true);

      expect(repo.getById(targetId)).toEqual(expect.objectContaining({
        title: 'Prime promotion updated',
        notes: 'Discount increased',
      }));

      expect(repo.delete(targetId)).toBe(true);
      expect(repo.getById(targetId)).toEqual(expect.objectContaining({
        id: targetId,
        title: 'Prime promotion updated',
      }));
      expect(repo.findByScope({ storeName: 'FT-US-US' }))
        .toEqual([expect.objectContaining({ id: otherId })]);
      expect(repo.findByScope(
        { storeName: 'FT-US-US' },
        { includeArchived: true },
      )).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: targetId }),
        expect.objectContaining({ id: otherId }),
      ]));
      expect(repo.getById(otherId)).toEqual(expect.objectContaining({
        title: 'Coupon for another ASIN',
      }));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses archive columns installed by the numbered migration', () => {
    const { db, dir } = createRepo();

    try {
      const columns = db.prepare('PRAGMA table_info(operation_events)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        'archived_at',
        'archive_revision',
      ]));
      expect(db.prepare(`
        SELECT status FROM schema_migrations WHERE version = 5
      `).get()).toEqual({ status: 'applied' });
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not mutate schema when constructed against an unmigrated fixture', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE operation_events (
          id INTEGER PRIMARY KEY,
          event_date TEXT NOT NULL,
          store_id TEXT,
          updated_at TEXT
        )
      `);
      new OperationEventRepository(db);
      const columns = db.prepare('PRAGMA table_info(operation_events)').all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual([
        'id',
        'event_date',
        'store_id',
        'updated_at',
      ]);
      expect(db.prepare(`
        SELECT 1 FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_operation_events_store_archive_date'
      `).get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('archives and restores a store-owned event while default reads hide history', () => {
    const { db, dir, repo } = createRepo();
    const storeId = 'event-history-store' as StoreId;

    try {
      db.prepare(`
        INSERT INTO stores (
          store_id, browser_profile_id, marketplace, currency, display_name, status,
          business_timezone, created_at, updated_at
        ) VALUES (?, ?, 'US', 'USD', 'History Store', 'active',
          'America/Los_Angeles', datetime('now'), datetime('now'))
      `).run(storeId, 'event-history-profile');
      const id = repo.createForStore(storeId, {
        eventDate: '2026-07-22',
        storeName: 'History Store',
        marketplaceCode: 'US',
        eventType: 'manual_note',
        title: 'Durable operator fact',
      });

      expect(repo.findByScopeForStore(storeId)).toHaveLength(1);
      expect(repo.archiveForStore(storeId, id)).toBe(true);
      expect(repo.archiveForStore(storeId, id)).toBe(false);
      expect(repo.findByScopeForStore(storeId)).toEqual([]);
      expect(repo.findByScopeForStore(storeId, {}, { includeArchived: true })).toEqual([
        expect.objectContaining({
          id,
          archivedAt: expect.any(String),
          archiveRevision: 1,
        }),
      ]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM operation_events WHERE id = ?').get(id))
        .toEqual({ count: 1 });

      expect(repo.restoreForStore(storeId, id)).toBe(true);
      expect(repo.restoreForStore(storeId, id)).toBe(false);
      expect(repo.findByScopeForStore(storeId)).toEqual([
        expect.objectContaining({ id, archivedAt: undefined, archiveRevision: 2 }),
      ]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
