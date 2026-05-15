import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';

// 获取用户数据目录
function getUserDataPath(): string {
  try {
    return app.getPath('userData');
  } catch {
    // Electron 外部使用
    return process.env.APPDATA 
      ? path.join(process.env.APPDATA, 'AmazonAIOps')
      : path.join(process.env.HOME || '', 'AmazonAIOps');
  }
}

let db: Database.Database | null = null;

export function initSqlite(dbPath?: string): Database.Database {
  const finalPath = dbPath || path.join(getUserDataPath(), 'app-data', 'app.db');
  
  db = new Database(finalPath, { verbose: console.log });
  
  // 启用 WAL 模式，提升并发性能
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  
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
      min_price REAL DEFAULT 0,
      target_net_margin REAL DEFAULT 0,
      target_acos REAL DEFAULT 0,
      target_tacos REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // ad_daily_metrics
  database.exec(`
    CREATE TABLE IF NOT EXISTS ad_daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      acos REAL DEFAULT 0,
      cpc REAL DEFAULT 0,
      cvr REAL DEFAULT 0,
      source_file TEXT,
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

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
      success INTEGER DEFAULT 1,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 创建索引
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_ad_metrics_date ON ad_daily_metrics(date);
    CREATE INDEX IF NOT EXISTS idx_ad_metrics_store ON ad_daily_metrics(store_name, marketplace_code);
    CREATE INDEX IF NOT EXISTS idx_ad_metrics_asin ON ad_daily_metrics(asin);
    CREATE INDEX IF NOT EXISTS idx_recommendations_status ON action_recommendations(status);
    CREATE INDEX IF NOT EXISTS idx_recommendations_risk ON action_recommendations(risk_level);
    CREATE INDEX IF NOT EXISTS idx_action_logs_created ON action_logs(created_at);
  `);
}

export function closeSqlite(): void {
  if (db) {
    db.close();
    db = null;
  }
}
