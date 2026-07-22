import Database from 'better-sqlite3';
import * as path from 'path';
import {
  prepareStoreAuthorityMigrationBackup,
  runStoreAuthorityMigrations,
} from './migrations';

// 获取用户数据目录
function getUserDataPath(): string {
  return process.env.AMAZON_AI_OPS_USER_DATA
    || (process.env.APPDATA
      ? path.join(process.env.APPDATA, 'AmazonAIOps')
      : path.join(process.env.HOME || '', 'AmazonAIOps'));
}

let db: Database.Database | null = null;

export function initSqlite(dbPath?: string): Database.Database {
  const finalPath = dbPath || path.join(getUserDataPath(), 'app-data', 'app.db');
  
  db = new Database(finalPath);
  
  // 启用 WAL 模式，提升并发性能
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Bind and verify the Stage 1 recovery snapshot before any legacy startup
  // migration can normalize, deduplicate, or otherwise mutate user rows.
  prepareStoreAuthorityMigrationBackup(db);
  
  // 创建表
  runMigrations(db);
  
  return db;
}

export function getSqliteDb(): Database.Database {
  if (!db) {
    throw new Error('SQLite not initialized. Call initSqlite() first.');
  }
  return db;
}

function runMigrations(database: Database.Database): void {
  // app_settings
  database.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // products
  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace_code TEXT,
      store_name TEXT,
      asin TEXT,
      parent_asin TEXT,
      msku TEXT,
      sku TEXT,
      title TEXT,
      product_stage TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // product_costs
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      purchase_cost REAL DEFAULT 0,
      first_leg_cost REAL DEFAULT 0,
      fba_fee REAL DEFAULT 0,
      referral_fee_rate REAL DEFAULT 0.15,
      storage_fee REAL DEFAULT 0,
      other_cost REAL DEFAULT 0,
      current_price REAL DEFAULT 0,
      min_price REAL DEFAULT 0,
      target_net_margin REAL DEFAULT 0,
      target_acos REAL DEFAULT 0,
      target_tacos REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);
  ensureColumn(database, 'product_costs', 'current_price', 'REAL DEFAULT 0');

  // ad_daily_metrics
  database.exec(`
    CREATE TABLE IF NOT EXISTS ad_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT,
      report_type TEXT,
      portfolio_name TEXT,
      date TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      asin TEXT,
      msku TEXT,
      campaign_name TEXT,
      ad_group_name TEXT,
      targeting TEXT,
      search_term TEXT,
      match_type TEXT,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      orders INTEGER DEFAULT 0,
      sales REAL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      acos REAL DEFAULT 0,
      cpc REAL DEFAULT 0,
      cvr REAL DEFAULT 0,
      source_file TEXT,
      source_row INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // inventory_daily_metrics
  database.exec(`
    CREATE TABLE IF NOT EXISTS inventory_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      asin TEXT,
      msku TEXT,
      fn_sku TEXT,
      available_qty INTEGER DEFAULT 0,
      reserved_qty INTEGER DEFAULT 0,
      inbound_qty INTEGER DEFAULT 0,
      sales_7d REAL DEFAULT 0,
      sales_14d REAL DEFAULT 0,
      sales_30d REAL DEFAULT 0,
      inventory_days REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // action_recommendations
  database.exec(`
    CREATE TABLE IF NOT EXISTS action_recommendations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      asin TEXT,
      msku TEXT,
      entity_type TEXT,
      entity_id TEXT,
      entity_name TEXT,
      action_type TEXT,
      current_value TEXT,
      recommended_value TEXT,
      reason TEXT,
      evidence_json TEXT,
      confidence REAL DEFAULT 0,
      risk_level TEXT DEFAULT 'APPROVAL',
      status TEXT DEFAULT 'pending',
      revision INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureColumn(database, 'action_recommendations', 'revision', 'INTEGER NOT NULL DEFAULT 0');

  // action_logs
  database.exec(`
    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_id INTEGER,
      task_id TEXT,
      action_type TEXT,
      entity_type TEXT,
      entity_id TEXT,
      entity_name TEXT,
      before_value TEXT,
      after_value TEXT,
      execution_status TEXT DEFAULT 'pending',
      failure_reason TEXT,
      screenshot_before TEXT,
      screenshot_after TEXT,
      trace_path TEXT,
      page_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // approval_tasks
  database.exec(`
    CREATE TABLE IF NOT EXISTS approval_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recommendation_id INTEGER,
      title TEXT,
      summary TEXT,
      risk_level TEXT DEFAULT 'APPROVAL',
      status TEXT DEFAULT 'pending',
      approved_by TEXT,
      approved_at TEXT,
      rejected_reason TEXT,
      modified_value TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (recommendation_id) REFERENCES action_recommendations(id)
    )
  `);

  // prompt_templates
  database.exec(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_key TEXT UNIQUE,
      version TEXT,
      content TEXT,
      input_schema TEXT,
      output_schema TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ai_call_logs
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_key TEXT,
      prompt_version TEXT,
      model TEXT,
      input_hash TEXT,
      output_json TEXT,
      schema_version TEXT,
      evidence_pack_summary_json TEXT,
      success INTEGER DEFAULT 1,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureColumn(database, 'ai_call_logs', 'schema_version', 'TEXT');
  ensureColumn(database, 'ai_call_logs', 'evidence_pack_summary_json', 'TEXT');

  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_diagnosis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_key TEXT,
      prompt_version TEXT,
      model TEXT,
      scope_json TEXT,
      evidence_pack_summary_json TEXT,
      evidence_pack_preview_json TEXT,
      diagnosis_json TEXT,
      insights_json TEXT,
      formal_recommendation_count INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureColumn(database, 'ai_diagnosis_runs', 'evidence_pack_preview_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'ai_diagnosis_runs', 'success', 'INTEGER DEFAULT 1');
  ensureColumn(database, 'ai_diagnosis_runs', 'error_message', 'TEXT');

  // v1.5 lingxing_report_batches
  database.exec(`
    CREATE TABLE IF NOT EXISTS lingxing_report_batches (
      id TEXT PRIMARY KEY,
      app_version TEXT,
      date_start TEXT NOT NULL,
      date_end TEXT NOT NULL,
      store_name TEXT,
      marketplace_code TEXT,
      status TEXT NOT NULL,
      download_dir TEXT NOT NULL,
      manifest_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);

  // operation_events
  database.exec(`
    CREATE TABLE IF NOT EXISTS operation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_date TEXT NOT NULL,
      store_name TEXT NOT NULL,
      marketplace_code TEXT NOT NULL,
      asin TEXT,
      campaign_name TEXT,
      ad_group_name TEXT,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      impact_expectation TEXT,
      notes TEXT,
      evidence_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureColumn(database, 'ad_daily_metrics', 'batch_id', 'TEXT');
  ensureColumn(database, 'ad_daily_metrics', 'report_type', 'TEXT');
  ensureColumn(database, 'ad_daily_metrics', 'portfolio_name', 'TEXT');
  ensureColumn(database, 'ad_daily_metrics', 'currency', "TEXT DEFAULT 'USD'");
  ensureColumn(database, 'ad_daily_metrics', 'source_row', 'INTEGER');
  ensureColumn(database, 'lingxing_report_batches', 'app_version', 'TEXT');
  ensureColumn(database, 'lingxing_report_batches', 'store_name', 'TEXT');
  ensureColumn(database, 'lingxing_report_batches', 'marketplace_code', 'TEXT');
  ensureColumn(database, 'operation_events', 'campaign_name', 'TEXT');
  ensureColumn(database, 'operation_events', 'ad_group_name', 'TEXT');

  // v1.5 lingxing_report_files
  database.exec(`
    CREATE TABLE IF NOT EXISTS lingxing_report_files (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL,
      max_auto_retries INTEGER DEFAULT 2,
      auto_retry_count INTEGER DEFAULT 0,
      file_path TEXT,
      file_size_bytes INTEGER DEFAULT 0,
      error_message TEXT,
      attempt_errors_json TEXT DEFAULT '[]',
      failure_screenshot_path TEXT,
      failure_dom_snapshot_path TEXT,
      failure_trace_path TEXT,
      trace_unavailable_reason TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (batch_id) REFERENCES lingxing_report_batches(id)
    )
  `);
  ensureColumn(database, 'lingxing_report_files', 'max_auto_retries', 'INTEGER DEFAULT 2');
  ensureColumn(database, 'lingxing_report_files', 'auto_retry_count', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'lingxing_report_files', 'attempt_errors_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'lingxing_report_files', 'failure_screenshot_path', 'TEXT');
  ensureColumn(database, 'lingxing_report_files', 'failure_dom_snapshot_path', 'TEXT');
  ensureColumn(database, 'lingxing_report_files', 'failure_trace_path', 'TEXT');
  ensureColumn(database, 'lingxing_report_files', 'trace_unavailable_reason', 'TEXT');

  // v1.5 business report file index
  database.exec(`
    CREATE TABLE IF NOT EXISTS report_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      imported_rows INTEGER DEFAULT 0,
      file_hash TEXT,
      import_error TEXT,
      last_imported_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(batch_id, report_type, file_path)
    )
  `);
  ensureColumn(database, 'report_files', 'file_hash', 'TEXT');
  ensureColumn(database, 'report_files', 'import_error', 'TEXT');
  ensureColumn(database, 'report_files', 'last_imported_at', 'TEXT');

  // v1.5 keyword_metrics
  database.exec(`
    CREATE TABLE IF NOT EXISTS keyword_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_keyword TEXT NOT NULL,
      raw_keyword TEXT NOT NULL,
      source TEXT NOT NULL,
      asin TEXT,
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      orders INTEGER DEFAULT 0,
      sales REAL DEFAULT 0,
      acos REAL DEFAULT 0,
      cvr REAL DEFAULT 0,
      source_file TEXT,
      source_row INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureColumn(database, 'keyword_metrics', 'report_type', 'TEXT');
  ensureColumn(database, 'keyword_metrics', 'source_type', 'TEXT');
  ensureColumn(database, 'keyword_metrics', 'raw_keyword', 'TEXT');
  ensureColumn(database, 'keyword_metrics', 'source', 'TEXT');
  ensureColumn(database, 'keyword_metrics', 'source_file', 'TEXT');
  ensureColumn(database, 'keyword_metrics', 'source_row', 'INTEGER');
  backfillKeywordMetricCompatibilityColumns(database);

  // v1.5 listing_content
  database.exec(`
    CREATE TABLE IF NOT EXISTS listing_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      store_name TEXT,
      marketplace_code TEXT,
      title TEXT DEFAULT '',
      bullets_json TEXT DEFAULT '[]',
      a_plus TEXT,
      image_copy TEXT,
      backend_terms TEXT,
      description TEXT,
      source TEXT DEFAULT 'manual',
      source_url TEXT,
      screenshot_path TEXT,
      version_label TEXT,
      change_summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS listing_content_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_content_id INTEGER,
      asin TEXT NOT NULL,
      store_name TEXT,
      marketplace_code TEXT,
      title TEXT DEFAULT '',
      bullets_json TEXT DEFAULT '[]',
      description TEXT,
      a_plus TEXT,
      image_copy TEXT,
      backend_terms TEXT,
      source TEXT DEFAULT 'manual',
      source_url TEXT,
      screenshot_path TEXT,
      version_label TEXT,
      change_summary TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // v1.5 keyword_coverage
  database.exec(`
    CREATE TABLE IF NOT EXISTS keyword_coverage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      normalized_keyword TEXT NOT NULL,
      covered INTEGER DEFAULT 0,
      sections_json TEXT DEFAULT '[]',
      strength REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // v1.5 keyword_opportunities
  database.exec(`
    CREATE TABLE IF NOT EXISTS keyword_opportunities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT,
      normalized_keyword TEXT NOT NULL,
      opportunity_level TEXT NOT NULL,
      score REAL DEFAULT 0,
      evidence TEXT,
      risk_flags_json TEXT DEFAULT '[]',
      recommended_sections_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureColumn(database, 'keyword_opportunities', 'asin', 'TEXT');

  // v1.5 listing_suggestions
  database.exec(`
    CREATE TABLE IF NOT EXISTS listing_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      keyword TEXT NOT NULL,
      section TEXT NOT NULL,
      current_text TEXT,
      suggested_text TEXT NOT NULL,
      evidence TEXT,
      risk_warnings_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // v1.5 listing_drafts
  database.exec(`
    CREATE TABLE IF NOT EXISTS listing_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asin TEXT NOT NULL,
      store_name TEXT,
      marketplace_code TEXT,
      section TEXT NOT NULL,
      current_text TEXT,
      drafted_text TEXT NOT NULL,
      keywords_json TEXT DEFAULT '[]',
      evidence TEXT,
      risk_warnings_json TEXT DEFAULT '[]',
      source TEXT DEFAULT 'rule',
      ai_fallback_reason TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureColumn(database, 'listing_suggestions', 'keyword', 'TEXT');
  ensureColumn(database, 'listing_suggestions', 'current_text', 'TEXT');
  ensureColumn(database, 'listing_suggestions', 'suggested_text', "TEXT DEFAULT ''");
  ensureColumn(database, 'listing_suggestions', 'evidence', 'TEXT');
  ensureColumn(database, 'listing_suggestions', 'risk_warnings_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'listing_suggestions', 'status', "TEXT DEFAULT 'pending'");
  ensureColumn(database, 'listing_suggestions', 'updated_at', "TEXT DEFAULT (datetime('now'))");
  ensureColumn(database, 'listing_content', 'title', "TEXT DEFAULT ''");
  ensureColumn(database, 'listing_content', 'bullets_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'listing_content', 'a_plus', 'TEXT');
  ensureColumn(database, 'listing_content', 'image_copy', 'TEXT');
  ensureColumn(database, 'listing_content', 'backend_terms', 'TEXT');
  ensureColumn(database, 'listing_content', 'description', 'TEXT');
  ensureColumn(database, 'listing_content', 'source', "TEXT DEFAULT 'manual'");
  ensureColumn(database, 'listing_content', 'store_name', 'TEXT');
  ensureColumn(database, 'listing_content', 'marketplace_code', 'TEXT');
  ensureColumn(database, 'listing_content', 'source_url', 'TEXT');
  ensureColumn(database, 'listing_content', 'screenshot_path', 'TEXT');
  ensureColumn(database, 'listing_content', 'version_label', 'TEXT');
  ensureColumn(database, 'listing_content', 'change_summary', 'TEXT');
  ensureColumn(database, 'listing_content', 'created_at', "TEXT DEFAULT (datetime('now'))");
  ensureColumn(database, 'listing_content', 'updated_at', "TEXT DEFAULT (datetime('now'))");
  ensureColumn(database, 'listing_drafts', 'store_name', 'TEXT');
  ensureColumn(database, 'listing_drafts', 'marketplace_code', 'TEXT');
  ensureColumn(database, 'listing_drafts', 'current_text', 'TEXT');
  ensureColumn(database, 'listing_drafts', 'drafted_text', "TEXT DEFAULT ''");
  ensureColumn(database, 'listing_drafts', 'keywords_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'listing_drafts', 'evidence', 'TEXT');
  ensureColumn(database, 'listing_drafts', 'risk_warnings_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'listing_drafts', 'source', "TEXT DEFAULT 'rule'");
  ensureColumn(database, 'listing_drafts', 'status', "TEXT DEFAULT 'pending'");
  ensureColumn(database, 'listing_drafts', 'updated_at', "TEXT DEFAULT (datetime('now'))");
  ensureColumn(database, 'listing_drafts', 'ai_fallback_reason', 'TEXT');

  // v1.5 download_center_diagnostics
  database.exec(`
    CREATE TABLE IF NOT EXISTS download_center_diagnostics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_version TEXT,
      page_model TEXT NOT NULL,
      page_model_source TEXT,
      page_model_snapshot_json TEXT,
      date_start TEXT,
      date_end TEXT,
      store_name TEXT,
      marketplace_code TEXT,
      url TEXT,
      title TEXT,
      ready INTEGER DEFAULT 0,
      requires_manual_verification INTEGER DEFAULT 1,
      matched_entry_hints_json TEXT DEFAULT '[]',
      matched_report_names_json TEXT DEFAULT '[]',
      selector_checks_json TEXT DEFAULT '[]',
      missing_required_selectors_json TEXT DEFAULT '[]',
      selector_candidates_json TEXT DEFAULT '[]',
      action_selector_checks_json TEXT DEFAULT '[]',
      screenshot_path TEXT,
      dom_snapshot_path TEXT,
      error_message TEXT,
      checked_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  ensureColumn(database, 'download_center_diagnostics', 'selector_candidates_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'download_center_diagnostics', 'action_selector_checks_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'download_center_diagnostics', 'dom_snapshot_path', 'TEXT');
  ensureColumn(database, 'download_center_diagnostics', 'page_model_source', 'TEXT');
  ensureColumn(database, 'download_center_diagnostics', 'page_model_snapshot_json', 'TEXT');
  ensureColumn(database, 'download_center_diagnostics', 'date_start', 'TEXT');
  ensureColumn(database, 'download_center_diagnostics', 'date_end', 'TEXT');
  ensureColumn(database, 'download_center_diagnostics', 'store_name', 'TEXT');
  ensureColumn(database, 'download_center_diagnostics', 'marketplace_code', 'TEXT');

  // v1.5 duplicate-import safeguards. Keep one row per imported ad metric,
  // one row per imported keyword source row, and one current opportunity per
  // ASIN/keyword pair before adding unique indexes.
  database.exec(`
    DELETE FROM ad_daily_metrics
    WHERE id NOT IN (
      SELECT keep_id
      FROM (
        SELECT MAX(id) AS keep_id
        FROM ad_daily_metrics
        GROUP BY
          COALESCE(batch_id, ''),
          COALESCE(report_type, ''),
          COALESCE(date, ''),
          COALESCE(store_name, ''),
          COALESCE(marketplace_code, ''),
          COALESCE(asin, ''),
          COALESCE(msku, ''),
          COALESCE(campaign_name, ''),
          COALESCE(ad_group_name, ''),
          COALESCE(targeting, ''),
          COALESCE(search_term, ''),
          COALESCE(match_type, ''),
          COALESCE(source_file, ''),
          COALESCE(source_row, -1)
      )
    );

    DELETE FROM keyword_metrics
    WHERE source_file IS NOT NULL
      AND source_row IS NOT NULL
      AND id NOT IN (
        SELECT keep_id
        FROM (
          SELECT MIN(id) AS keep_id
          FROM keyword_metrics
          WHERE source_file IS NOT NULL
            AND source_row IS NOT NULL
          GROUP BY source, source_file, source_row
        )
      );

    UPDATE keyword_opportunities
    SET status = CASE
      WHEN EXISTS (
        SELECT 1 FROM keyword_opportunities duplicate
        WHERE COALESCE(duplicate.asin, '') = COALESCE(keyword_opportunities.asin, '')
          AND duplicate.normalized_keyword = keyword_opportunities.normalized_keyword
          AND duplicate.status = 'accepted'
      ) THEN 'accepted'
      WHEN EXISTS (
        SELECT 1 FROM keyword_opportunities duplicate
        WHERE COALESCE(duplicate.asin, '') = COALESCE(keyword_opportunities.asin, '')
          AND duplicate.normalized_keyword = keyword_opportunities.normalized_keyword
          AND duplicate.status = 'ignored'
      ) THEN 'ignored'
      ELSE status
    END
    WHERE id IN (
      SELECT keep_id
      FROM (
        SELECT MIN(id) AS keep_id
        FROM keyword_opportunities
        GROUP BY COALESCE(asin, ''), normalized_keyword
      )
    );

    DELETE FROM keyword_opportunities
    WHERE id NOT IN (
      SELECT keep_id
      FROM (
        SELECT MIN(id) AS keep_id
        FROM keyword_opportunities
        GROUP BY COALESCE(asin, ''), normalized_keyword
      )
    );

    DELETE FROM products
    WHERE id NOT IN (
      SELECT keep_id
      FROM (
        SELECT MAX(id) AS keep_id
        FROM products
        GROUP BY COALESCE(asin, ''), COALESCE(store_name, ''), COALESCE(marketplace_code, '')
      )
    );

    DELETE FROM product_costs
    WHERE id NOT IN (
      SELECT keep_id
      FROM (
        SELECT MAX(id) AS keep_id
        FROM product_costs
        GROUP BY product_id
      )
    );
  `);

  // 创建索引
  database.exec(`
    DROP INDEX IF EXISTS idx_ad_metrics_unique_daily_report_identity;

    CREATE INDEX IF NOT EXISTS idx_ad_metrics_date ON ad_daily_metrics(date);
    CREATE INDEX IF NOT EXISTS idx_ad_metrics_store ON ad_daily_metrics(store_name, marketplace_code);
    CREATE INDEX IF NOT EXISTS idx_ad_metrics_asin ON ad_daily_metrics(asin);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_unique_scope_asin ON products(asin, store_name, marketplace_code);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_costs_unique_product ON product_costs(product_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_metrics_unique_daily_report_identity ON ad_daily_metrics(
      COALESCE(batch_id, ''),
      COALESCE(report_type, ''),
      COALESCE(date, ''),
      COALESCE(store_name, ''),
      COALESCE(marketplace_code, ''),
      COALESCE(asin, ''),
      COALESCE(msku, ''),
      COALESCE(campaign_name, ''),
      COALESCE(ad_group_name, ''),
      COALESCE(targeting, ''),
      COALESCE(search_term, ''),
      COALESCE(match_type, ''),
      COALESCE(source_file, ''),
      COALESCE(source_row, -1)
    );
    CREATE INDEX IF NOT EXISTS idx_recommendations_status ON action_recommendations(status);
    CREATE INDEX IF NOT EXISTS idx_recommendations_risk ON action_recommendations(risk_level);
    CREATE INDEX IF NOT EXISTS idx_operation_events_scope ON operation_events(event_date, store_name, marketplace_code, asin);
    CREATE INDEX IF NOT EXISTS idx_operation_events_ad_context ON operation_events(campaign_name, ad_group_name);
    CREATE INDEX IF NOT EXISTS idx_operation_events_type ON operation_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_action_logs_created ON action_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_lingxing_report_files_batch ON lingxing_report_files(batch_id);
    CREATE INDEX IF NOT EXISTS idx_report_files_batch ON report_files(batch_id);
    CREATE INDEX IF NOT EXISTS idx_report_files_type_status ON report_files(report_type, status);
    CREATE INDEX IF NOT EXISTS idx_keyword_metrics_keyword ON keyword_metrics(normalized_keyword);
    CREATE INDEX IF NOT EXISTS idx_keyword_metrics_source_file ON keyword_metrics(source, source_file);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_metrics_unique_source_file_row ON keyword_metrics(source, source_file, source_row)
      WHERE source_file IS NOT NULL AND source_row IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_keyword_opportunities_status ON keyword_opportunities(status);
    CREATE INDEX IF NOT EXISTS idx_keyword_opportunities_asin_keyword ON keyword_opportunities(asin, normalized_keyword);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_keyword_opportunities_unique_asin_keyword ON keyword_opportunities(COALESCE(asin, ''), normalized_keyword);
    CREATE INDEX IF NOT EXISTS idx_listing_suggestions_status ON listing_suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_listing_drafts_status ON listing_drafts(status);
    CREATE INDEX IF NOT EXISTS idx_download_center_diagnostics_checked ON download_center_diagnostics(checked_at);
    CREATE INDEX IF NOT EXISTS idx_download_center_diagnostics_model_date ON download_center_diagnostics(page_model, date_start, date_end, checked_at);
    CREATE INDEX IF NOT EXISTS idx_download_center_diagnostics_scope ON download_center_diagnostics(page_model, date_start, date_end, store_name, marketplace_code, checked_at);
  `);

  // Stage 1 starts the durable, versioned migration chain. Legacy tables keep
  // nullable store_id columns until every row has a proven owner or an
  // explicit quarantine record; the migration never guesses or drops rows.
  runStoreAuthorityMigrations(database);
}

function ensureColumn(database: Database.Database, tableName: string, columnName: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function hasColumn(database: Database.Database, tableName: string, columnName: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return columns.some((column) => column.name === columnName);
}

function backfillKeywordMetricCompatibilityColumns(database: Database.Database): void {
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

export function closeSqlite(): void {
  if (db) {
    db.close();
    db = null;
  }
}
