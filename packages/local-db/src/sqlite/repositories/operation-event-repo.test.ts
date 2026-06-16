import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
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

  it('updates and deletes events without affecting other scope events', () => {
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
      expect(repo.getById(targetId)).toBeNull();
      expect(repo.getById(otherId)).toEqual(expect.objectContaining({
        title: 'Coupon for another ASIN',
      }));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
