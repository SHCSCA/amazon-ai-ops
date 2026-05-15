import type { Database } from 'better-sqlite3';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';

export class AdMetricsRepository {
  constructor(private db: Database) {}

  insertBatch(metrics: AdDailyMetrics[]): number {
    const stmt = this.db.prepare(`
      INSERT INTO ad_daily_metrics (
        date, store_name, marketplace_code, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        impressions, clicks, cost, orders, sales, acos, cpc, cvr, source_file
      ) VALUES (
        @date, @storeName, @marketplaceCode, @asin, @msku,
        @campaignName, @adGroupName, @targeting, @searchTerm, @matchType,
        @impressions, @clicks, @cost, @orders, @sales, @acos, @cpc, @cvr, @sourceFile
      )
    `);

    const insertMany = this.db.transaction((items: AdDailyMetrics[]) => {
      let count = 0;
      for (const m of items) {
        stmt.run({
          date: m.date,
          storeName: m.storeName,
          marketplaceCode: m.marketplaceCode,
          asin: m.asin,
          msku: m.msku,
          campaignName: m.campaignName,
          adGroupName: m.adGroupName,
          targeting: m.targeting,
          searchTerm: m.searchTerm,
          matchType: m.matchType,
          impressions: m.impressions,
          clicks: m.clicks,
          cost: m.cost,
          orders: m.orders,
          sales: m.sales,
          acos: m.acos,
          cpc: m.cpc,
          cvr: m.cvr,
          sourceFile: m.sourceFile,
        });
        count++;
      }
      return count;
    });

    return insertMany(metrics);
  }

  insert(metric: AdDailyMetrics): number {
    const stmt = this.db.prepare(`
      INSERT INTO ad_daily_metrics (
        date, store_name, marketplace_code, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        impressions, clicks, cost, orders, sales, acos, cpc, cvr, source_file
      ) VALUES (
        @date, @storeName, @marketplaceCode, @asin, @msku,
        @campaignName, @adGroupName, @targeting, @searchTerm, @matchType,
        @impressions, @clicks, @cost, @orders, @sales, @acos, @cpc, @cvr, @sourceFile
      )
    `);
    const result = stmt.run({
      date: metric.date,
      storeName: metric.storeName,
      marketplaceCode: metric.marketplaceCode,
      asin: metric.asin,
      msku: metric.msku,
      campaignName: metric.campaignName,
      adGroupName: metric.adGroupName,
      targeting: metric.targeting,
      searchTerm: metric.searchTerm,
      matchType: metric.matchType,
      impressions: metric.impressions,
      clicks: metric.clicks,
      cost: metric.cost,
      orders: metric.orders,
      sales: metric.sales,
      acos: metric.acos,
      cpc: metric.cpc,
      cvr: metric.cvr,
      sourceFile: metric.sourceFile,
    });
    return result.lastInsertRowid as number;
  }

  findByDateRange(
    dateFrom: string,
    dateTo: string,
    storeName?: string,
    asin?: string
  ): AdDailyMetrics[] {
    let sql = 'SELECT * FROM ad_daily_metrics WHERE date >= ? AND date <= ?';
    const params: (string | undefined)[] = [dateFrom, dateTo];

    if (storeName) {
      sql += ' AND store_name = ?';
      params.push(storeName);
    }
    if (asin) {
      sql += ' AND asin = ?';
      params.push(asin);
    }

    sql += ' ORDER BY date DESC, store_name, asin';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.mapRow);
  }

  getSummary(dateFrom: string, dateTo: string, storeName?: string): {
    totalImpressions: number;
    totalClicks: number;
    totalCost: number;
    totalOrders: number;
    totalSales: number;
    avgAcos: number;
    avgCpc: number;
  } {
    let sql = `
      SELECT
        COALESCE(SUM(impressions), 0) as total_impressions,
        COALESCE(SUM(clicks), 0) as total_clicks,
        COALESCE(SUM(cost), 0) as total_cost,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(sales), 0) as total_sales,
        CASE WHEN SUM(sales) > 0 THEN SUM(cost) / SUM(sales) ELSE 0 END as avg_acos,
        CASE WHEN SUM(clicks) > 0 THEN SUM(cost) / SUM(clicks) ELSE 0 END as avg_cpc
      FROM ad_daily_metrics
      WHERE date >= ? AND date <= ?
    `;
    const params: string[] = [dateFrom, dateTo];

    if (storeName) {
      sql += ' AND store_name = ?';
      params.push(storeName);
    }

    const row = this.db.prepare(sql).get(...params) as any;
    return {
      totalImpressions: row.total_impressions,
      totalClicks: row.total_clicks,
      totalCost: row.total_cost,
      totalOrders: row.total_orders,
      totalSales: row.total_sales,
      avgAcos: row.avg_acos,
      avgCpc: row.avg_cpc,
    };
  }

  getRecent(limit: number, storeName?: string): AdDailyMetrics[] {
    let sql = 'SELECT * FROM ad_daily_metrics';
    const params: (string | number)[] = [];
    if (storeName) {
      sql += ' WHERE store_name = ?';
      params.push(storeName);
    }
    sql += ' ORDER BY date DESC, created_at DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.mapRow);
  }

  getTotalSales(date: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(sales), 0) as total FROM ad_daily_metrics WHERE date = ?').get(date) as any;
    return row?.total ?? 0;
  }

  getTotalCost(date: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(cost), 0) as total FROM ad_daily_metrics WHERE date = ?').get(date) as any;
    return row?.total ?? 0;
  }

  getTotalClicks(date: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(clicks), 0) as total FROM ad_daily_metrics WHERE date = ?').get(date) as any;
    return row?.total ?? 0;
  }

  getTotalOrders(date: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(orders), 0) as total FROM ad_daily_metrics WHERE date = ?').get(date) as any;
    return row?.total ?? 0;
  }

  private mapRow(row: any): AdDailyMetrics {
    return {
      id: row.id,
      date: row.date,
      storeName: row.store_name,
      marketplaceCode: row.marketplace_code,
      asin: row.asin,
      msku: row.msku,
      campaignName: row.campaign_name,
      adGroupName: row.ad_group_name,
      targeting: row.targeting,
      searchTerm: row.search_term,
      matchType: row.match_type,
      impressions: row.impressions,
      clicks: row.clicks,
      cost: row.cost,
      orders: row.orders,
      sales: row.sales,
      acos: row.acos,
      cpc: row.cpc,
      cvr: row.cvr,
      sourceFile: row.source_file,
      createdAt: row.created_at,
    };
  }
}
