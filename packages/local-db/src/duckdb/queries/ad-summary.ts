import { Database, Connection } from 'duckdb';

export function createAdSummaryQueries(db: Database) {
  // DuckDB 1.x: Database.all(sql, callback) or Connection.all(sql)
  const getAll = (sql: string): Array<Record<string, unknown>> => {
    const conn = new Connection(db);
    const results: Array<Record<string, unknown>> = [];
    let err: Error | null = null;
    conn.all(sql, (e, rows) => {
      if (e) { err = e as Error; return; }
      if (Array.isArray(rows)) results.push(...rows as Array<Record<string, unknown>>);
    });
    conn.close();
    if (err) throw err;
    return results;
  };

  return {
    // 获取 ASIN 级别汇总
    getAsinSummary(dateFrom: string, dateTo: string, storeName?: string) {
      const sql = `
        SELECT
          date,
          store_name,
          asin,
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost,
          SUM(orders) as orders,
          SUM(sales) as sales,
          CASE WHEN SUM(sales) > 0 THEN SUM(cost) / SUM(sales) ELSE 0 END as acos,
          CASE WHEN SUM(clicks) > 0 THEN SUM(cost) / SUM(clicks) ELSE 0 END as cpc,
          CASE WHEN SUM(clicks) > 0 THEN SUM(orders) * 100.0 / SUM(clicks) ELSE 0 END as cvr
        FROM ad_daily_metrics
        WHERE date >= '${dateFrom}' AND date <= '${dateTo}'
        ${storeName ? `AND store_name = '${storeName}'` : ''}
        GROUP BY date, store_name, asin
        ORDER BY cost DESC
      `;
      return getAll(sql);
    },

    // 获取搜索词表现
    getSearchTermPerformance(dateFrom: string, dateTo: string, asin?: string) {
      const sql = `
        SELECT
          search_term,
          match_type,
          SUM(impressions) as impressions,
          SUM(clicks) as clicks,
          SUM(cost) as cost,
          SUM(orders) as orders,
          SUM(sales) as sales,
          CASE WHEN SUM(sales) > 0 THEN SUM(cost) / SUM(sales) ELSE 0 END as acos
        FROM ad_daily_metrics
        WHERE date >= '${dateFrom}' AND date <= '${dateTo}'
        ${asin ? `AND asin = '${asin}'` : ''}
        GROUP BY search_term, match_type
        ORDER BY cost DESC
        LIMIT 200
      `;
      return getAll(sql);
    },

    // 获取周期对比
    getPeriodComparison(currentFrom: string, currentTo: string, previousFrom: string, previousTo: string) {
      const currentSql = `
        SELECT
          SUM(cost) as cost,
          SUM(sales) as sales,
          SUM(orders) as orders,
          CASE WHEN SUM(sales) > 0 THEN SUM(cost) / SUM(sales) ELSE 0 END as acos
        FROM ad_daily_metrics
        WHERE date >= '${currentFrom}' AND date <= '${currentTo}'
      `;
      const previousSql = `
        SELECT
          SUM(cost) as cost,
          SUM(sales) as sales,
          SUM(orders) as orders,
          CASE WHEN SUM(sales) > 0 THEN SUM(cost) / SUM(sales) ELSE 0 END as acos
        FROM ad_daily_metrics
        WHERE date >= '${previousFrom}' AND date <= '${previousTo}'
      `;

      const currentResults = getAll(currentSql);
      const previousResults = getAll(previousSql);

      return {
        current: currentResults[0] ?? {},
        previous: previousResults[0] ?? {},
      };
    }
  };
}
