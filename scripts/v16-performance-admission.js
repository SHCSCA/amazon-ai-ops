const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { insist, directPath, fileRecord, treeBytes } = require('./v16-performance-artifacts');
const { storeCollectionAutomationSettingKey, readStoreCollectionAutomation } = require('../packages/shared-types/src/store-collection-automation-control.cjs');

function inspectQuiescentDatabase(database, classification) {
  const required = ['stores', 'app_settings', 'policy_runtime', 'mission_grants', 'mission_grants_v16',
    'ad_execution_batches', 'ad_execution_jobs', 'lingxing_collection_jobs'];
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  insist(!['scheduled_tasks', 'task_queue', 'scheduler_tasks'].some(table => tables.has(table)), 'NFR_PRELAUNCH_UNAUDITED_LEGACY_SCHEDULER');
  insist(required.every(table => tables.has(table)), 'NFR_PRELAUNCH_CURRENT_SCHEMA_REQUIRED');
  const history = database.prepare('SELECT value FROM app_settings WHERE key=?').get('store_collection_orchestrator_history_v5');
  insist(!history?.value?.trim(), 'NFR_PRELAUNCH_UNAUDITED_ORCHESTRATOR_HISTORY');
  const counts = {};
  for (const table of ['mission_grants', 'mission_grants_v16', 'ad_execution_batches', 'ad_execution_jobs']) {
    counts[table] = database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
    insist(counts[table] === 0, 'NFR_PRELAUNCH_WRITE_AUTHORITY_PRESENT:' + table);
  }
  const runtimes = database.prepare('SELECT store_id,autonomy_mode,active_policy_version_id FROM policy_runtime').all();
  insist(runtimes.every(row => row.autonomy_mode === 'manual_approval' && !row.active_policy_version_id), 'NFR_PRELAUNCH_AUTOMATIC_POLICY_PRESENT');
  const jobs = database.prepare('SELECT job_id,state,snapshot_json FROM lingxing_collection_jobs').all();
  insist(jobs.every(row => {
    const job = JSON.parse(row.snapshot_json);
    return !['queued', 'running', 'retrying', 'partial', 'interrupted'].includes(row.state)
      && !['pending', 'failed'].includes(job.importState);
  }), 'NFR_PRELAUNCH_RECOVERABLE_COLLECTION_PRESENT');
  const settings = database.prepare("SELECT key,value FROM app_settings WHERE key LIKE 'store_runtime_config:v1:%'").all();
  const configuredActiveKeys = settings.filter(row => JSON.parse(row.value)?.current?.status === 'active').map(row => row.key);
  const stores = new Map(database.prepare('SELECT store_id storeId,browser_profile_id browserProfileId FROM stores').all()
    .map(store => [store.storeId, store]));
  const activeSchedules = configuredActiveKeys.filter(key => {
    const storeId = key.slice('store_runtime_config:v1:'.length), store = stores.get(storeId);
    insist(store && typeof store.browserProfileId === 'string' && store.browserProfileId.length > 0, 'NFR_PRELAUNCH_COLLECTION_CONFIG_STORE_REQUIRED');
    const raw = database.prepare('SELECT value FROM app_settings WHERE key=?').get(storeCollectionAutomationSettingKey(storeId))?.value;
    const automation = readStoreCollectionAutomation(raw, store);
    if (automation.automaticCollectionEnabled === false) {
      const configured = settings.find(row => row.key === key);
      insist(JSON.parse(configured.value)?.current?.values?.aiRecommendationsEnabled === false,
        'NFR_PRELAUNCH_DISABLED_COLLECTION_REQUIRES_AI_DISABLED');
    }
    return automation.automaticCollectionEnabled;
  });
  // 真实库副本不得启动活动采集调度；隔离软件库还必须证明不存在任何店铺连接。
  if (classification === 'real-data-copy') insist(activeSchedules.length === 0, 'NFR_PRELAUNCH_ENABLED_COLLECTION_SCHEDULE');
  if (classification === 'isolated-software-fixture') {
    insist(tables.has('store_connections'), 'NFR_PRELAUNCH_STORE_CONNECTION_SCHEMA_REQUIRED');
    counts.store_connections = database.prepare('SELECT COUNT(*) count FROM store_connections').get().count;
    insist(counts.store_connections === 0, 'NFR_PRELAUNCH_SOFTWARE_FIXTURE_HAS_CONNECTIONS');
  }
  return { counts, policyRuntimes: runtimes, collectionJobs: jobs.map(({ job_id, state }) => ({ jobId: job_id, state })), configuredActiveKeys, activeSchedules };
}
async function admitNativeProfile({ root, profile, fixture, writer, label }) {
  const profileTree = treeBytes(profile);
  const file = path.join(profile, 'amazon-ai-ops.db'); directPath(file);
  if (fixture.classification === 'isolated-software-fixture') {
    const owner = JSON.parse(fs.readFileSync(directPath(path.join(path.dirname(profile), 'owner.json')).path, 'utf8'));
    insist(owner.token === fixture.ownerToken && owner.classification === fixture.classification, 'NFR_PRELAUNCH_FIXTURE_OWNER_MISMATCH');
  }
  const Database = createRequire(path.join(root, 'packages/local-db/package.json'))('better-sqlite3');
  const database = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const inspect = database.transaction(() => inspectQuiescentDatabase(database, fixture.classification));
    const observation = inspect();
    const backupPath = path.join(writer.root, label, 'prelaunch-logical-database.db');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    await database.backup(backupPath);
    const backup = writer.track(fileRecord(backupPath));
    return writer.json(`${label}/prelaunch-admission.json`, { kind: 'v16-nfr-native-prelaunch-admission',
      classification: fixture.classification, userDataDir: profile, observedAt: new Date().toISOString(),
      method: 'readonly-sqlite-transaction-and-online-backup', profileTree, backup, ...observation,
      modifiesConfiguration: false, grantsAuthority: false });
  } finally { database.close(); }
}
module.exports = { inspectQuiescentDatabase, admitNativeProfile };
