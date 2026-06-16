import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import { initSqlite } from '../db';
import { AdMetricsRepository } from './ad-metrics-repo';

function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-ad-metrics-'));
  const db = initSqlite(path.join(dir, 'test.db'));
  return { db, dir, repo: new AdMetricsRepository(db) };
}

describe('AdMetricsRepository data grain safeguards', () => {
  it('keeps repeated imports of the same daily report row idempotent', () => {
    const { db, dir, repo } = createRepo();

    try {
      const metric: AdDailyMetrics = {
        batchId: 'batch-20260612',
        reportType: 'user_search_term',
        date: '2026-06-12',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'B001',
        msku: '',
        campaignName: 'Campaign',
        adGroupName: 'Ad group',
        targeting: '',
        searchTerm: 'smart lock outdoor',
        matchType: 'exact',
        impressions: 1000,
        clicks: 32,
        cost: 41.5,
        orders: 0,
        sales: 0,
        acos: 0,
        cpc: 1.3,
        cvr: 0,
        sourceFile: 'C:/reports/user-search-term.xlsx',
        sourceRow: 2,
        currency: 'USD',
      };

      expect(repo.insertBatch([metric])).toBe(1);
      expect(repo.insertBatch([{ ...metric, clicks: 33, cost: 42.25, cpc: 1.28 }])).toBe(1);
      expect(repo.insertBatch([{ ...metric, sourceRow: 3, searchTerm: 'smart lock outdoor alt' }])).toBe(1);

      const rows = db.prepare(`
        SELECT COUNT(*) AS rowCount, SUM(cost) AS totalCost, SUM(clicks) AS totalClicks
        FROM ad_daily_metrics
        WHERE batch_id = 'batch-20260612'
          AND source_file = 'C:/reports/user-search-term.xlsx'
      `).get() as { rowCount: number; totalCost: number; totalClicks: number };

      expect(rows.rowCount).toBe(2);
      expect(rows.totalCost).toBe(83.75);
      expect(rows.totalClicks).toBe(65);
      expect(db.prepare(`
        SELECT currency, source_row AS sourceRow
        FROM ad_daily_metrics
        WHERE search_term = 'smart lock outdoor'
      `).get()).toEqual(expect.objectContaining({ currency: 'USD', sourceRow: 2 }));
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deletes imported rows by batch and source file without touching other batch provenance', () => {
    const { db, dir, repo } = createRepo();

    try {
      repo.insertBatch([
        {
          batchId: 'batch-latest',
          reportType: 'keyword',
          date: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B001',
          msku: '',
          campaignName: 'Campaign',
          adGroupName: 'Ad group',
          targeting: 'target one',
          searchTerm: 'target one',
          matchType: 'exact',
          impressions: 100,
          clicks: 10,
          cost: 10,
          orders: 1,
          sales: 20,
          acos: 0.5,
          cpc: 1,
          cvr: 0.1,
          sourceFile: 'C:/reports/latest-keyword.xlsx',
        },
        {
          batchId: 'batch-older',
          reportType: 'campaign',
          date: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B001',
          msku: '',
          campaignName: 'Campaign',
          adGroupName: '',
          targeting: '',
          searchTerm: '',
          matchType: 'exact',
          impressions: 100,
          clicks: 10,
          cost: 30,
          orders: 1,
          sales: 60,
          acos: 0.5,
          cpc: 3,
          cvr: 0.1,
          sourceFile: 'C:/reports/older-campaign.xlsx',
        },
        {
          batchId: 'batch-other',
          reportType: 'campaign',
          date: '2026-06-12',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B001',
          msku: '',
          campaignName: 'Campaign',
          adGroupName: '',
          targeting: '',
          searchTerm: '',
          matchType: 'exact',
          impressions: 100,
          clicks: 10,
          cost: 40,
          orders: 1,
          sales: 80,
          acos: 0.5,
          cpc: 4,
          cvr: 0.1,
          sourceFile: 'C:/reports/older-campaign.xlsx',
        },
      ]);

      expect(repo.deleteByBatchAndSourceFiles('batch-older', ['C:/reports/older-campaign.xlsx'])).toBe(1);

      const rows = db.prepare(`
        SELECT batch_id AS batchId, source_file AS sourceFile
        FROM ad_daily_metrics
        ORDER BY batch_id, source_file
      `).all() as Array<{ batchId: string; sourceFile: string }>;
      expect(rows).toEqual([
        { batchId: 'batch-latest', sourceFile: 'C:/reports/latest-keyword.xlsx' },
        { batchId: 'batch-other', sourceFile: 'C:/reports/older-campaign.xlsx' },
      ]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes duplicate summary grains from default summaries and recent metrics', () => {
    const { db, dir, repo } = createRepo();

    try {
      repo.insertBatch([
        {
          date: '2026-05-25',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B001',
          msku: '',
          campaignName: 'Campaign',
          adGroupName: '',
          targeting: '',
          searchTerm: '',
          matchType: 'exact',
          impressions: 100,
          clicks: 10,
          cost: 50,
          orders: 2,
          sales: 100,
          acos: 0.5,
          cpc: 5,
          cvr: 0.2,
          sourceFile: 'campaign.xlsx',
          reportType: 'campaign',
        },
        {
          date: '2026-05-25',
          storeName: 'FT-US-US',
          marketplaceCode: 'US',
          asin: 'B001',
          msku: '',
          campaignName: 'Campaign',
          adGroupName: 'Ad group',
          targeting: 'keyless lock',
          searchTerm: 'keyless lock',
          matchType: 'exact',
          impressions: 20,
          clicks: 4,
          cost: 12,
          orders: 1,
          sales: 49.99,
          acos: 0.24,
          cpc: 3,
          cvr: 0.25,
          sourceFile: 'keyword.xlsx',
          reportType: 'keyword',
        },
      ]);

      const summary = repo.getSummary('2026-05-01', '2026-05-31', 'FT-US-US');
      expect(summary.totalCost).toBe(12);
      expect(summary.totalOrders).toBe(1);
      expect(summary.totalSales).toBe(49.99);
      expect(repo.getTotalCost('2026-05-25')).toBe(12);
      expect(repo.getTotalOrders('2026-05-25')).toBe(1);
      expect(repo.getRecent(10).map((row) => row.reportType)).toEqual(['keyword']);
      expect(repo.findForRecommendations({
        dateFrom: '2026-05-01',
        dateTo: '2026-05-31',
        storeName: 'FT-US-US',
        marketplaceCode: 'US',
        asin: 'b001',
        limit: 10,
      }).map((row) => row.reportType)).toEqual(['keyword']);
      expect(repo.findForRecommendations({
        dateFrom: '2026-05-01',
        dateTo: '2026-05-31',
        storeName: 'OTHER',
        marketplaceCode: 'US',
        limit: 10,
      })).toEqual([]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
