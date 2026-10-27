// 按数据库生命周期、迁移和身份保护职责拆分，事务边界保持一致。
import Database from 'better-sqlite3';

export function ensureColumn(database: Database.Database, tableName: string, columnName: string, definition: string): void {
    const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
    }>;
    if (!columns.some((column) => column.name === columnName)) {
        database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

export function hasColumn(database: Database.Database, tableName: string, columnName: string): boolean {
    const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
        name: string;
    }>;
    return columns.some((column) => column.name === columnName);
}

export function backfillKeywordMetricCompatibilityColumns(database: Database.Database): void {
    if (hasColumn(database, 'keyword_metrics', 'keyword')) {
        database.exec(`
      UPDATE keyword_metrics
      SET raw_keyword = COALESCE(raw_keyword, keyword, normalized_keyword, '')
      WHERE raw_keyword IS NULL OR raw_keyword = ''
    `);
    }
    if (hasColumn(database, 'keyword_metrics', 'source_type') || hasColumn(database, 'keyword_metrics', 'report_type')) {
        database.exec(`
      UPDATE keyword_metrics
      SET source = COALESCE(
        source,
        CASE
          WHEN report_type = 'search_term' THEN 'search_term'
          WHEN report_type = 'keyword' THEN 'keyword_report'
          WHEN source_type IN ('search_term', 'sqp', 'keyword_report', 'manual') THEN source_type
          ELSE 'keyword_report'
        END
      )
      WHERE source IS NULL OR source = ''
    `);
    }
    if (hasColumn(database, 'keyword_metrics', 'source_row_number')) {
        database.exec(`
      UPDATE keyword_metrics
      SET source_row = COALESCE(source_row, source_row_number)
      WHERE source_row IS NULL
    `);
    }
}
