import type { Database } from 'better-sqlite3';
import type { AdDailyMetrics } from '@amazon-ai-ops/shared-types';
import {
  adMetricCanonicalWhere,
  adMetricGrainWhere,
  inferAdMetricReportType,
} from '../ad-metric-grain';

export class AdMetricsRepository {
  constructor(private db: Database) {}

  deleteByBatch(batchId: string): number {
    const result = this.db.prepare('DELETE FROM ad_daily_metrics WHERE batch_id = ?').run(batchId);
    return result.changes;
  }

  deleteByBatchAndSourceFiles(batchId: string, sourceFiles: string[]): number {
    const uniqueSourceFiles = Array.from(new Set(sourceFiles.filter(Boolean)));
    if (!batchId || uniqueSourceFiles.length === 0) return 0;
    const stmt = this.db.prepare(`
      DELETE FROM ad_daily_metrics
      WHERE batch_id = ?
        AND source_file IN (${uniqueSourceFiles.map(() => '?').join(', ')})
    `);
    const result = stmt.run(batchId, ...uniqueSourceFiles);
    return result.changes;
  }

  insertBatch(metrics: AdDailyMetrics[]): number {
    const deleteExisting = this.db.prepare(`
      DELETE FROM ad_daily_metrics
      WHERE COALESCE(batch_id, '') = COALESCE(@batchId, '')
        AND COALESCE(report_type, '') = COALESCE(@reportType, '')
        AND COALESCE(date, '') = COALESCE(@date, '')
        AND COALESCE(store_name, '') = COALESCE(@storeName, '')
        AND COALESCE(marketplace_code, '') = COALESCE(@marketplaceCode, '')
        AND COALESCE(asin, '') = COALESCE(@asin, '')
        AND COALESCE(msku, '') = COALESCE(@msku, '')
        AND COALESCE(campaign_name, '') = COALESCE(@campaignName, '')
        AND COALESCE(ad_group_name, '') = COALESCE(@adGroupName, '')
        AND COALESCE(targeting, '') = COALESCE(@targeting, '')
        AND COALESCE(search_term, '') = COALESCE(@searchTerm, '')
        AND COALESCE(match_type, '') = COALESCE(@matchType, '')
        AND COALESCE(source_file, '') = COALESCE(@sourceFile, '')
        AND COALESCE(source_row, -1) = COALESCE(@sourceRow, -1)
    `);
    const stmt = this.db.prepare(`
      INSERT INTO ad_daily_metrics (
        batch_id, report_type, portfolio_name,
        date, store_name, marketplace_code, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        impressions, clicks, cost, orders, sales, currency, acos, cpc, cvr, source_file, source_row
      ) VALUES (
        @batchId, @reportType, @portfolioName,
        @date, @storeName, @marketplaceCode, @asin, @msku,
        @campaignName, @adGroupName, @targeting, @searchTerm, @matchType,
        @impressions, @clicks, @cost, @orders, @sales, @currency, @acos, @cpc, @cvr, @sourceFile, @sourceRow
      )
    `);

    const insertMany = this.db.transaction((items: AdDailyMetrics[]) => {
      let count = 0;
      for (const m of items) {
        const params = this.toSqlParams(m);
        deleteExisting.run(params);
        stmt.run(params);
        count++;
      }
      return count;
    });

    return insertMany(metrics);
  }

  insert(metric: AdDailyMetrics): number {
    const deleteExisting = this.db.prepare(`
      DELETE FROM ad_daily_metrics
      WHERE COALESCE(batch_id, '') = COALESCE(@batchId, '')
        AND COALESCE(report_type, '') = COALESCE(@reportType, '')
        AND COALESCE(date, '') = COALESCE(@date, '')
        AND COALESCE(store_name, '') = COALESCE(@storeName, '')
        AND COALESCE(marketplace_code, '') = COALESCE(@marketplaceCode, '')
        AND COALESCE(asin, '') = COALESCE(@asin, '')
        AND COALESCE(msku, '') = COALESCE(@msku, '')
        AND COALESCE(campaign_name, '') = COALESCE(@campaignName, '')
        AND COALESCE(ad_group_name, '') = COALESCE(@adGroupName, '')
        AND COALESCE(targeting, '') = COALESCE(@targeting, '')
        AND COALESCE(search_term, '') = COALESCE(@searchTerm, '')
        AND COALESCE(match_type, '') = COALESCE(@matchType, '')
        AND COALESCE(source_file, '') = COALESCE(@sourceFile, '')
        AND COALESCE(source_row, -1) = COALESCE(@sourceRow, -1)
    `);
    const stmt = this.db.prepare(`
      INSERT INTO ad_daily_metrics (
        batch_id, report_type, portfolio_name,
        date, store_name, marketplace_code, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        impressions, clicks, cost, orders, sales, currency, acos, cpc, cvr, source_file, source_row
      ) VALUES (
        @batchId, @reportType, @portfolioName,
        @date, @storeName, @marketplaceCode, @asin, @msku,
        @campaignName, @adGroupName, @targeting, @searchTerm, @matchType,
        @impressions, @clicks, @cost, @orders, @sales, @currency, @acos, @cpc, @cvr, @sourceFile, @sourceRow
      )
    `);
    const writeOne = this.db.transaction((m: AdDailyMetrics) => {
      const params = this.toSqlParams(m);
      deleteExisting.run(params);
      const result = stmt.run(params);
      return result.lastInsertRowid as number;
    });
    return writeOne(metric);
  }

  private toSqlParams(m: AdDailyMetrics) {
    return {
          batchId: m.batchId ?? null,
          reportType: m.reportType ?? null,
          portfolioName: m.portfolioName ?? null,
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
          currency: m.currency ?? 'USD',
          acos: m.acos,
          cpc: m.cpc,
          cvr: m.cvr,
          sourceFile: m.sourceFile,
          sourceRow: m.sourceRow ?? null,
    };
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
    const baseWhere = ['date >= ?', 'date <= ?'];
    const params: string[] = [dateFrom, dateTo];
    if (storeName) {
      baseWhere.push('store_name = ?');
      params.push(storeName);
    }
    const { whereSql, selection } = adMetricCanonicalWhere(this.findAvailableReportTypes(baseWhere.join(' AND '), params));
    if (selection.reportTypes.length === 0) {
      return {
        totalImpressions: 0,
        totalClicks: 0,
        totalCost: 0,
        totalOrders: 0,
        totalSales: 0,
        avgAcos: 0,
        avgCpc: 0,
      };
    }
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
      WHERE ${baseWhere.join(' AND ')}
        AND ${whereSql}
    `;

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
    let sql = `SELECT * FROM ad_daily_metrics WHERE ${adMetricGrainWhere('actionable')}`;
    const params: (string | number)[] = [];
    if (storeName) {
      sql += ' AND store_name = ?';
      params.push(storeName);
    }
    sql += ' ORDER BY date DESC, created_at DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.mapRow);
  }

  findForRecommendations(filter: {
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
    limit?: number;
  }): AdDailyMetrics[] {
    let sql = `SELECT * FROM ad_daily_metrics WHERE ${adMetricGrainWhere('actionable')}`;
    const params: (string | number)[] = [];

    if (filter.dateFrom) {
      sql += ' AND date >= ?';
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      sql += ' AND date <= ?';
      params.push(filter.dateTo);
    }
    if (filter.storeName) {
      sql += ' AND store_name = ?';
      params.push(filter.storeName);
    }
    if (filter.marketplaceCode) {
      sql += ' AND marketplace_code = ?';
      params.push(filter.marketplaceCode);
    }
    if (filter.asin) {
      sql += ' AND upper(asin) = upper(?)';
      params.push(filter.asin);
    }

    sql += ' ORDER BY date DESC, created_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(this.mapRow);
  }

  getTotalSales(date: string): number {
    return this.getCanonicalDailyTotal(date, 'sales');
  }

  getTotalCost(date: string): number {
    return this.getCanonicalDailyTotal(date, 'cost');
  }

  getTotalClicks(date: string): number {
    return this.getCanonicalDailyTotal(date, 'clicks');
  }

  getTotalOrders(date: string): number {
    return this.getCanonicalDailyTotal(date, 'orders');
  }

  private findAvailableReportTypes(whereSql: string, params: unknown[]): string[] {
    const rows = this.db.prepare(`
      SELECT report_type AS reportType, source_file AS sourceFile
      FROM ad_daily_metrics
      WHERE ${whereSql}
    `).all(...params) as Array<{ reportType?: string | null; sourceFile?: string | null }>;
    return Array.from(new Set(
      rows
        .map((row) => inferAdMetricReportType(row.reportType, row.sourceFile))
        .filter(Boolean),
    ));
  }

  private getCanonicalDailyTotal(date: string, column: 'sales' | 'cost' | 'clicks' | 'orders'): number {
    const whereSql = 'date = ?';
    const params = [date];
    const canonical = adMetricCanonicalWhere(this.findAvailableReportTypes(whereSql, params));
    const selection = canonical.selection;
    if (selection.reportTypes.length === 0) return 0;
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(${column}), 0) as total
      FROM ad_daily_metrics
      WHERE ${whereSql}
        AND ${canonical.whereSql}
    `).get(...params) as any;
    return row?.total ?? 0;
  }

  private mapRow(row: any): AdDailyMetrics {
    return {
      id: row.id,
      batchId: row.batch_id,
      reportType: row.report_type,
      portfolioName: row.portfolio_name,
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
      currency: row.currency ?? 'USD',
      acos: row.acos,
      cpc: row.cpc,
      cvr: row.cvr,
      sourceFile: row.source_file,
      sourceRow: row.source_row ?? undefined,
      createdAt: row.created_at,
    };
  }
}
