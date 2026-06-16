const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { db: '' };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--db') args.db = argv[++index] || '';
  }
  return args;
}

function requireSqlite() {
  const candidates = [
    'better-sqlite3',
    path.join(__dirname, '..', 'apps', 'desktop', 'node_modules', 'better-sqlite3'),
    path.join(__dirname, '..', 'packages', 'local-db', 'node_modules', 'better-sqlite3'),
    path.join(__dirname, '..', 'node_modules', '.pnpm', 'node_modules', 'better-sqlite3'),
  ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`Missing dependency better-sqlite3. Tried ${errors.join(' | ')}`);
}

function dbCandidates() {
  const candidates = [];
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, '@amazon-ai-ops', 'desktop', 'amazon-ai-ops.db'));
  }
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'AmazonAIOps', 'app-data', 'amazon-ai-ops.db'));
  }
  return candidates;
}

function chooseDbPath(args) {
  if (args.db) {
    if (!fs.existsSync(args.db)) throw new Error(`DB does not exist: ${args.db}`);
    return args.db;
  }
  const existing = dbCandidates().find((candidate) => fs.existsSync(candidate));
  if (!existing) throw new Error('No Amazon AI Ops user DB found.');
  return existing;
}

function migrate(db) {
  db.exec(`
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
    );
    CREATE INDEX IF NOT EXISTS idx_operation_events_scope ON operation_events(event_date, store_name, marketplace_code, asin);
    CREATE INDEX IF NOT EXISTS idx_operation_events_ad_context ON operation_events(campaign_name, ad_group_name);
    CREATE INDEX IF NOT EXISTS idx_operation_events_type ON operation_events(event_type);
  `);
}

function tableExists(db, tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(tableName));
}

function main() {
  const args = parseArgs(process.argv);
  const dbPath = chooseDbPath(args);
  const Database = requireSqlite();
  const db = new Database(dbPath);
  try {
    const existedBefore = tableExists(db, 'operation_events');
    migrate(db);
    const existedAfter = tableExists(db, 'operation_events');
    console.log(`[OK] operation_events ${existedBefore ? 'already existed' : existedAfter ? 'created' : 'not created'} in ${dbPath}`);
  } finally {
    db.close();
  }
}

main();
