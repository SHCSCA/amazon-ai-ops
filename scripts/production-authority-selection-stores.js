// 按职责复用原有严格校验，公共入口继续保持兼容。



function storeInspection(database, tables) {
    if (!tables.has('stores')) {
        return {
            tablePresent: false,
            allStoreCount: 0,
            activeUsUsdCount: 0,
            distinctBrowserProfileCount: 0,
            configuredForTwoStoreProduction: false,
            state: 'NOT_AVAILABLE',
        };
    }
    const columns = database.prepare('PRAGMA table_info("stores")')
        .all()
        .map((row) => String(row.name));
    const required = [
        'store_id',
        'browser_profile_id',
        'marketplace',
        'currency',
        'status',
        'business_timezone',
    ];
    const missingColumns = required.filter((column) => !columns.includes(column));
    if (missingColumns.length > 0) {
        return {
            tablePresent: true,
            columns,
            missingColumns,
            allStoreCount: null,
            activeUsUsdCount: null,
            distinctBrowserProfileCount: null,
            configuredForTwoStoreProduction: false,
            state: 'MALFORMED',
        };
    }
    const counts = database.prepare(`
    SELECT
      COUNT(*) AS allStoreCount,
      SUM(
        CASE
          WHEN status = 'active' AND marketplace = 'US' AND currency = 'USD'
          THEN 1 ELSE 0
        END
      ) AS activeUsUsdCount,
      COUNT(
        DISTINCT CASE
          WHEN status = 'active' AND marketplace = 'US' AND currency = 'USD'
          THEN browser_profile_id ELSE NULL
        END
      ) AS distinctBrowserProfileCount,
      SUM(
        CASE
          WHEN status = 'active'
            AND marketplace = 'US'
            AND currency = 'USD'
            AND business_timezone = 'America/Los_Angeles'
          THEN 1 ELSE 0
        END
      ) AS losAngelesStoreCount
    FROM stores
  `).get();
    const allStoreCount = Number(counts.allStoreCount ?? 0);
    const activeUsUsdCount = Number(counts.activeUsUsdCount ?? 0);
    const distinctBrowserProfileCount = Number(counts.distinctBrowserProfileCount ?? 0);
    const losAngelesStoreCount = Number(counts.losAngelesStoreCount ?? 0);
    return {
        tablePresent: true,
        columns,
        missingColumns: [],
        allStoreCount,
        activeUsUsdCount,
        distinctBrowserProfileCount,
        configuredForTwoStoreProduction: activeUsUsdCount === 2
            && distinctBrowserProfileCount === 2
            && losAngelesStoreCount === 2,
        state: 'INSPECTED',
    };
}

module.exports = { storeInspection };
