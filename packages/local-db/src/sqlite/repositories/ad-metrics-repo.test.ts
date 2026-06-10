import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { initSqlite } from '../db';
import { AdMetricsRepository } from './ad-metrics-repo';

function createRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-ai-ops-ad-metrics-'));
  const db = initSqlite(path.join(dir, 'test.db'));
  return { db, dir, repo: new AdMetricsRepository(db) };
}

describe('AdMetricsRepository data grain safeguards', () => {
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
