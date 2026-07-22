import type { Database } from 'better-sqlite3';
import type { AdDailyMetrics, StoreId } from '@amazon-ai-ops/shared-types';
import {
  adMetricCanonicalWhere,
  adMetricGrainWhere,
  inferAdMetricReportType,
} from '../ad-metric-grain';

export type StoreScopedAdDailyMetrics = AdDailyMetrics & { storeId: StoreId };

export class AdMetricsRepository {
  constructor(private db: Database) {}

  /** @deprecated Legacy unscoped delete. Stage 2 must use deleteByBatchForStore. */
  deleteByBatch(batchId: string): number {
    const result = this.db.prepare('DELETE FROM ad_daily_metrics WHERE batch_id = ?').run(batchId);
    return result.changes;
  }

  deleteByBatchForStore(storeId: StoreId, batchId: string): number {
    this.getWritableStoreAuthority(storeId);
    const result = this.db.prepare(`
      DELETE FROM ad_daily_metrics WHERE batch_id = ? AND store_id = ?
    `).run(batchId, storeId);
    return result.changes;
  }

  /** @deprecated Legacy unscoped delete. Stage 2 must use deleteByBatchAndSourceFilesForStore. */
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

  deleteByBatchAndSourceFilesForStore(
    storeId: StoreId,
    batchId: string,
    sourceFiles: string[],
  ): number {
    this.getWritableStoreAuthority(storeId);
    const uniqueSourceFiles = Array.from(new Set(sourceFiles.filter(Boolean)));
    if (!batchId || uniqueSourceFiles.length === 0) return 0;
    const result = this.db.prepare(`
      DELETE FROM ad_daily_metrics
      WHERE batch_id = ?
        AND store_id = ?
        AND source_file IN (${uniqueSourceFiles.map(() => '?').join(', ')})
    `).run(batchId, storeId, ...uniqueSourceFiles);
    return result.changes;
  }

  /** @deprecated Legacy unscoped write. Stage 2 must use insertBatchForStore. */
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

  insertBatchForStore(storeId: StoreId, metrics: AdDailyMetrics[]): number {
    const authority = this.getWritableStoreAuthority(storeId);
    for (const batchId of new Set(metrics.map((metric) => metric.batchId).filter(Boolean))) {
      this.assertBatchOwnershipIfKnown(storeId, batchId!);
    }
    const deleteExisting = this.db.prepare(`
      DELETE FROM ad_daily_metrics
      WHERE store_id = @storeId
        AND COALESCE(batch_id, '') = COALESCE(@batchId, '')
        AND COALESCE(report_type, '') = COALESCE(@reportType, '')
        AND COALESCE(date, '') = COALESCE(@date, '')
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
    const insert = this.db.prepare(`
      INSERT INTO ad_daily_metrics (
        store_id, batch_id, report_type, portfolio_name,
        date, store_name, marketplace_code, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        impressions, clicks, cost, orders, sales, currency, acos, cpc, cvr, source_file, source_row
      ) VALUES (
        @storeId, @batchId, @reportType, @portfolioName,
        @date, @storeName, @marketplaceCode, @asin, @msku,
        @campaignName, @adGroupName, @targeting, @searchTerm, @matchType,
        @impressions, @clicks, @cost, @orders, @sales, @currency, @acos, @cpc, @cvr, @sourceFile, @sourceRow
      )
    `);
    const insertMany = this.db.transaction((items: AdDailyMetrics[]) => {
      let count = 0;
      for (const metric of items) {
        this.assertLegacyStoreIdentity(
          authority,
          metric.storeName,
          metric.marketplaceCode,
          metric.currency,
        );
        const params = { storeId, ...this.toSqlParams({ ...metric, currency: 'USD' }) };
        deleteExisting.run(params);
        insert.run(params);
        count += 1;
      }
      return count;
    });
    return insertMany.immediate(metrics);
  }

  /** @deprecated Legacy unscoped write. Stage 2 must use insertForStore. */
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

  insertForStore(storeId: StoreId, metric: AdDailyMetrics): number {
    const authority = this.getWritableStoreAuthority(storeId);
    this.assertLegacyStoreIdentity(
      authority,
      metric.storeName,
      metric.marketplaceCode,
      metric.currency,
    );
    if (metric.batchId) this.assertBatchOwnershipIfKnown(storeId, metric.batchId);
    const deleteExisting = this.db.prepare(`
      DELETE FROM ad_daily_metrics
      WHERE store_id = @storeId
        AND COALESCE(batch_id, '') = COALESCE(@batchId, '')
        AND COALESCE(report_type, '') = COALESCE(@reportType, '')
        AND COALESCE(date, '') = COALESCE(@date, '')
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
    const insert = this.db.prepare(`
      INSERT INTO ad_daily_metrics (
        store_id, batch_id, report_type, portfolio_name,
        date, store_name, marketplace_code, asin, msku,
        campaign_name, ad_group_name, targeting, search_term, match_type,
        impressions, clicks, cost, orders, sales, currency, acos, cpc, cvr, source_file, source_row
      ) VALUES (
        @storeId, @batchId, @reportType, @portfolioName,
        @date, @storeName, @marketplaceCode, @asin, @msku,
        @campaignName, @adGroupName, @targeting, @searchTerm, @matchType,
        @impressions, @clicks, @cost, @orders, @sales, @currency, @acos, @cpc, @cvr, @sourceFile, @sourceRow
      )
    `);
    const write = this.db.transaction(() => {
      const params = { storeId, ...this.toSqlParams({ ...metric, currency: 'USD' }) };
      deleteExisting.run(params);
      return Number(insert.run(params).lastInsertRowid);
    });
    return write.immediate();
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

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use findByDateRangeForStore. */
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

  findByDateRangeForStore(
    storeId: StoreId,
    dateFrom: string,
    dateTo: string,
    asin?: string,
  ): StoreScopedAdDailyMetrics[] {
    let sql = 'SELECT * FROM ad_daily_metrics WHERE store_id = ? AND date >= ? AND date <= ?';
    const params: string[] = [storeId, dateFrom, dateTo];
    if (asin) {
      sql += ' AND upper(asin) = upper(?)';
      params.push(asin);
    }
    sql += ' ORDER BY date DESC, asin';
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((row) => this.mapStoreScopedRow(row));
  }

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use getSummaryForStore. */
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

  getSummaryForStore(storeId: StoreId, dateFrom: string, dateTo: string): {
    totalImpressions: number;
    totalClicks: number;
    totalCost: number;
    totalOrders: number;
    totalSales: number;
    avgAcos: number;
    avgCpc: number;
  } {
    const baseWhere = ['store_id = ?', 'date >= ?', 'date <= ?'];
    const params: string[] = [storeId, dateFrom, dateTo];
    const available = this.findAvailableReportTypes(baseWhere.join(' AND '), params);
    const { whereSql, selection } = adMetricCanonicalWhere(available);
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
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(impressions), 0) as total_impressions,
        COALESCE(SUM(clicks), 0) as total_clicks,
        COALESCE(SUM(cost), 0) as total_cost,
        COALESCE(SUM(orders), 0) as total_orders,
        COALESCE(SUM(sales), 0) as total_sales,
        CASE WHEN SUM(sales) > 0 THEN SUM(cost) / SUM(sales) ELSE 0 END as avg_acos,
        CASE WHEN SUM(clicks) > 0 THEN SUM(cost) / SUM(clicks) ELSE 0 END as avg_cpc
      FROM ad_daily_metrics
      WHERE ${baseWhere.join(' AND ')} AND ${whereSql}
    `).get(...params) as any;
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

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use getRecentForStore. */
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

  getRecentForStore(storeId: StoreId, limit: number): StoreScopedAdDailyMetrics[] {
    const rows = this.db.prepare(`
      SELECT * FROM ad_daily_metrics
      WHERE store_id = ? AND ${adMetricGrainWhere('actionable')}
      ORDER BY date DESC, created_at DESC
      LIMIT ?
    `).all(storeId, limit) as any[];
    return rows.map((row) => this.mapStoreScopedRow(row));
  }

  /** @deprecated Legacy optionally unscoped read. Stage 2 must use findForRecommendationsForStore. */
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

  findForRecommendationsForStore(
    storeId: StoreId,
    filter: {
      dateFrom?: string;
      dateTo?: string;
      marketplaceCode?: string;
      asin?: string;
      limit?: number;
    },
  ): StoreScopedAdDailyMetrics[] {
    let sql = `SELECT * FROM ad_daily_metrics WHERE store_id = ? AND ${adMetricGrainWhere('actionable')}`;
    const params: (string | number)[] = [storeId];
    if (filter.dateFrom) {
      sql += ' AND date >= ?';
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      sql += ' AND date <= ?';
      params.push(filter.dateTo);
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
    return rows.map((row) => this.mapStoreScopedRow(row));
  }

  /** @deprecated Legacy unscoped aggregate. Stage 2 must use getTotalSalesForStore. */
  getTotalSales(date: string): number {
    return this.getCanonicalDailyTotal(date, 'sales');
  }

  getTotalSalesForStore(storeId: StoreId, date: string): number {
    return this.getCanonicalDailyTotalForStore(storeId, date, 'sales');
  }

  /** @deprecated Legacy unscoped aggregate. Stage 2 must use getTotalCostForStore. */
  getTotalCost(date: string): number {
    return this.getCanonicalDailyTotal(date, 'cost');
  }

  getTotalCostForStore(storeId: StoreId, date: string): number {
    return this.getCanonicalDailyTotalForStore(storeId, date, 'cost');
  }

  /** @deprecated Legacy unscoped aggregate. Stage 2 must use getTotalClicksForStore. */
  getTotalClicks(date: string): number {
    return this.getCanonicalDailyTotal(date, 'clicks');
  }

  getTotalClicksForStore(storeId: StoreId, date: string): number {
    return this.getCanonicalDailyTotalForStore(storeId, date, 'clicks');
  }

  /** @deprecated Legacy unscoped aggregate. Stage 2 must use getTotalOrdersForStore. */
  getTotalOrders(date: string): number {
    return this.getCanonicalDailyTotal(date, 'orders');
  }

  getTotalOrdersForStore(storeId: StoreId, date: string): number {
    return this.getCanonicalDailyTotalForStore(storeId, date, 'orders');
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

  private getCanonicalDailyTotalForStore(
    storeId: StoreId,
    date: string,
    column: 'sales' | 'cost' | 'clicks' | 'orders',
  ): number {
    const whereSql = 'store_id = ? AND date = ?';
    const params = [storeId, date];
    const canonical = adMetricCanonicalWhere(this.findAvailableReportTypes(whereSql, params));
    if (canonical.selection.reportTypes.length === 0) return 0;
    const row = this.db.prepare(`
      SELECT COALESCE(SUM(${column}), 0) as total
      FROM ad_daily_metrics
      WHERE ${whereSql} AND ${canonical.whereSql}
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

  private mapStoreScopedRow(row: any): StoreScopedAdDailyMetrics {
    return {
      ...this.mapRow(row),
      storeId: row.store_id as StoreId,
    };
  }

  private getStoreAuthority(storeId: StoreId): {
    displayName: string;
    marketplace: string;
    currency: string;
    status: string;
  } {
    const row = this.db.prepare(`
      SELECT display_name AS displayName, marketplace, currency, status
      FROM stores
      WHERE store_id = ?
    `).get(storeId) as {
      displayName: string;
      marketplace: string;
      currency: string;
      status: string;
    } | undefined;
    if (!row) throw new Error(`未知店铺 ${storeId}。`);
    return row;
  }

  private getWritableStoreAuthority(storeId: StoreId): {
    displayName: string;
    marketplace: string;
    currency: string;
    status: string;
  } {
    const row = this.getStoreAuthority(storeId);
    if (row.status !== 'active') throw new Error(`店铺 ${storeId} 当前状态为 ${row.status}，禁止写入。`);
    return row;
  }

  private assertLegacyStoreIdentity(
    authority: { displayName: string; marketplace: string; currency: string },
    storeName: string,
    marketplaceCode: string,
    currency?: string,
  ): void {
    const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (
      normalize(storeName) !== normalize(authority.displayName)
      || String(marketplaceCode ?? '').trim().toUpperCase() !== authority.marketplace
      || String(currency ?? 'USD').trim().toUpperCase() !== authority.currency
    ) throw new Error('指标店铺标识与 store_id 的权威记录不一致。');
  }

  private assertBatchOwnershipIfKnown(storeId: StoreId, batchId: string): void {
    const rows = this.db.prepare(`
      SELECT store_id AS storeId
      FROM lingxing_report_batches
      WHERE id = ?
    `).all(batchId) as Array<{ storeId?: string | null }>;
    if (rows.length > 0 && !rows.some((row) => row.storeId === storeId)) {
      throw new Error(`报表批次 ${batchId} 不属于店铺 ${storeId}。`);
    }
  }
}
