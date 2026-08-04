import * as path from 'path';
import { Database, type DuckDbDatabase } from './runtime';

function getUserDataPath(): string {
  return process.env.AMAZON_AI_OPS_USER_DATA
    || (process.env.APPDATA
      ? path.join(process.env.APPDATA, 'AmazonAIOps')
      : path.join(process.env.HOME || '', 'AmazonAIOps'));
}

let _db: DuckDbDatabase | null = null;

export function initDuckDb(dbPath?: string): DuckDbDatabase {
  const finalPath = dbPath || path.join(getUserDataPath(), 'app-data', 'analytics.duckdb');

  _db = new Database(finalPath);

  // 创建广告分析表
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ad_daily_metrics (
      date VARCHAR,
      store_name VARCHAR,
      marketplace_code VARCHAR,
      asin VARCHAR,
      msku VARCHAR,
      campaign_name VARCHAR,
      ad_group_name VARCHAR,
      targeting VARCHAR,
      search_term VARCHAR,
      match_type VARCHAR,
      impressions BIGINT,
      clicks BIGINT,
      cost DOUBLE,
      orders BIGINT,
      sales DOUBLE,
      acos DOUBLE,
      cpc DOUBLE,
      cvr DOUBLE
    )
  `);

  // 创建搜索词分析表
  _db.exec(`
    CREATE TABLE IF NOT EXISTS search_term_metrics (
      date VARCHAR,
      store_name VARCHAR,
      marketplace_code VARCHAR,
      asin VARCHAR,
      campaign_name VARCHAR,
      ad_group_name VARCHAR,
      search_term VARCHAR,
      match_type VARCHAR,
      impressions BIGINT,
      clicks BIGINT,
      cost DOUBLE,
      orders BIGINT,
      sales DOUBLE,
      acos DOUBLE,
      cpc DOUBLE
    )
  `);

  // 物化视图：按 ASIN 聚合
  _db.exec(`
    CREATE MATERIALIZED VIEW IF NOT EXISTS mv_asin_daily AS
    SELECT
      date,
      store_name,
      marketplace_code,
      asin,
      SUM(impressions) as total_impressions,
      SUM(clicks) as total_clicks,
      SUM(cost) as total_cost,
      SUM(orders) as total_orders,
      SUM(sales) as total_sales,
      CASE WHEN SUM(sales) > 0 THEN SUM(cost) / SUM(sales) ELSE 0 END as acos,
      CASE WHEN SUM(clicks) > 0 THEN SUM(cost) / SUM(clicks) ELSE 0 END as cpc
    FROM ad_daily_metrics
    GROUP BY date, store_name, marketplace_code, asin
  `);

  return _db;
}

export function getDuckDb(): DuckDbDatabase {
  if (!_db) {
    throw new Error('DuckDB not initialized. Call initDuckDb() first.');
  }
  return _db;
}

export function closeDuckDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
