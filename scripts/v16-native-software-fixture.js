const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { validateEvidenceUserDataPath } = require('./evidence-user-data');
const { fileRecord, directPath, insist } = require('./v16-performance-artifacts');
const { loadSoftwareDatabaseRuntime } = require('./v16-native-software-fixture-runtime');
const { seedSoftwareImport, seedSoftwareMemory } = require('./v16-native-software-fixture-data');
const { seedSoftwareRecoveryInputs } = require('./v16-native-software-fixture-reports');
const { seedSoftwareAnalysis } = require('./v16-native-software-fixture-analysis');

function seedSoftwareRuntimeConfigs(runtime, coordinator, bus, stores) {
  const values = { aiRecommendationsEnabled: false, collectionScheduleLocalTime: '08:00', collectionLookbackDays: 14,
    analysisWindowDays: 30, defaultTargetAcosPercent: 28, minimumRecommendationConfidencePercent: 72, evidenceRetentionDays: 365 };
  const configs = new runtime.StoreRuntimeConfigService({ storeCoordinator: coordinator, settings: bus });
  const automation = new runtime.StoreCollectionAutomationService({ storeCoordinator: coordinator, settings: bus });
  // 由真实店铺上下文经服务和配置总线创建，快照必须包含可回读的独立配置。
  for (const store of stores) {
    const { context } = coordinator.switchStore({ storeId: store.storeId, marketplace: 'US' });
    insist(context?.storeId === store.storeId && context.browserProfileId === store.browserProfileId, 'SOFTWARE_FIXTURE_CONFIG_CONTEXT_MISMATCH');
    const created = configs.create(context, { values }), projection = configs.get(context), current = projection.current;
    insist(current?.storeId === store.storeId && current.revision === 1 && current.status === 'active'
      && isDeepStrictEqual(current.values, values) && isDeepStrictEqual(created, projection), 'SOFTWARE_FIXTURE_CONFIG_READBACK_MISMATCH');
    insist(projection.versions.length === 1 && projection.versions[0].action === 'create' && projection.versions[0].revision === 1
      && isDeepStrictEqual(projection.versions[0].snapshot, current), 'SOFTWARE_FIXTURE_CONFIG_HISTORY_MISMATCH');
    // 分析配置保持生效；隔离样本必须另经正式服务关闭自动采集并验证持久回读。
    const disabled = automation.set(context, { expectedRevision: 0, automaticCollectionEnabled: false });
    const control = automation.get(context);
    insist(control.storeId === store.storeId && control.browserProfileId === store.browserProfileId
      && control.automaticCollectionEnabled === false && control.source === 'explicit-override' && control.revision === 1
      && typeof control.updatedAt === 'string' && new Date(control.updatedAt).toISOString() === control.updatedAt
      && isDeepStrictEqual(disabled, control), 'SOFTWARE_FIXTURE_COLLECTION_AUTOMATION_READBACK_MISMATCH');
  }
}

async function createNativeSoftwareFixture({ repositoryRoot, directory, fixture, identity, metricRows, memoryRows = 100, date = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) }) {
  insist(['typical', 'maximum'].includes(fixture), 'SOFTWARE_FIXTURE_KIND_REQUIRED');
  insist(identity && /^[a-f0-9]{64}$/i.test(identity.sourceSha256) && identity.packageHashes, 'SOFTWARE_FIXTURE_CURRENT_IDENTITY_REQUIRED');
  metricRows ??= fixture === 'typical' ? 1000 : 50000;
  insist(Number.isSafeInteger(metricRows) && metricRows >= 1 && metricRows <= 100000
    && Number.isSafeInteger(memoryRows) && memoryRows >= 1 && memoryRows <= 50000, 'SOFTWARE_FIXTURE_VOLUME_INVALID');
  const root = path.resolve(directory); validateEvidenceUserDataPath(root, { requireExisting: false });
  insist(!fs.existsSync(root), 'SOFTWARE_FIXTURE_NEW_DIRECTORY_REQUIRED');
  fs.mkdirSync(root, { recursive: true }); directPath(root, true);
  const owner = { kind: 'v16-software-fixture-owner', token: randomUUID(), classification: 'isolated-software-fixture' };
  fs.writeFileSync(path.join(root, 'owner.json'), JSON.stringify(owner), { flag: 'wx' });
  const seedDatabase = path.join(root, 'seed.db'), snapshot = path.join(root, 'logical-database.db');
  let database, runtime;
  try {
    runtime = await loadSoftwareDatabaseRuntime(path.resolve(repositoryRoot), root);
    database = runtime.initSqlite(seedDatabase);
    const repository = new runtime.StoreRepository(database), stores = [], imports = [], recoveryInputs = [], analysisInputs = [];
    for (const suffix of ['a', 'b']) {
      const store = repository.createStore({ storeId: `software-${fixture}-store-${suffix}`, browserProfileId: `software-${fixture}-profile-${suffix}`,
        displayName: `隔离软件验收店铺 ${suffix.toUpperCase()}`, marketplace: 'US', currency: 'USD', businessTimezone: 'America/Los_Angeles' });
      stores.push(store);
      imports.push(seedSoftwareImport(runtime, database, root, store, metricRows, date));
      recoveryInputs.push(seedSoftwareRecoveryInputs(runtime, database, root, store, date, 3, { rowsPerReport: Math.ceil(metricRows / 8) }));
      analysisInputs.push(seedSoftwareAnalysis(runtime, database, store, date, recoveryInputs.at(-1).importBatchIds));
      seedSoftwareMemory(runtime, database, store, memoryRows, date);
    }
    for (const table of ['mission_grants', 'ad_execution_batches', 'ad_execution_jobs']) {
      insist(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count === 0, 'SOFTWARE_FIXTURE_WRITE_AUTHORITY_FORBIDDEN');
    }
    const bus = new runtime.ConfigurationBus(database);
    const generationKey = storeId => `store_session_generation:${storeId}`;
    const sessions = new runtime.DurableStoreSessionGenerationAuthority({ transaction: work => bus.transaction(work),
      read: storeId => { const value = bus.get(generationKey(storeId)); return value === null ? undefined : Number(value); },
      write: (storeId, generation) => bus.set(generationKey(storeId), String(generation)) });
    const selectionKey = 'operator_workspace_selection:v1';
    const coordinator = new runtime.StoreCoordinator({ repository, sessions, selectionStorage: {
      read: () => { const value = bus.get(selectionKey); return value === null ? null : JSON.parse(value); },
      write: value => bus.set(selectionKey, JSON.stringify(value)), clear: () => bus.delete(selectionKey),
    } });
    seedSoftwareRuntimeConfigs(runtime, coordinator, bus, stores);
    for (const table of ['mission_grants_v16', 'store_connections', 'ai_cost_records', 'ai_call_logs']) {
      insist(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count === 0, 'SOFTWARE_FIXTURE_AUTHORITY_OR_AI_COST_FORBIDDEN');
    }
    coordinator.switchStore({ storeId: stores[0].storeId, marketplace: 'US' });
    await database.backup(snapshot);
    runtime.closeSqlite(); database = undefined;
    const coldProfiles = Array.from({ length: 3 }, (_, index) => path.join(root, `cold-profile-${index + 1}`));
    for (const profile of coldProfiles) {
      fs.mkdirSync(profile); validateEvidenceUserDataPath(profile);
      fs.copyFileSync(snapshot, path.join(profile, 'amazon-ai-ops.db'), fs.constants.COPYFILE_EXCL);
    }
    const result = { kind: 'v16-nfr-fixture', schemaVersion: 1, fixture, classification: 'isolated-software-fixture',
      sourceSha256: identity.sourceSha256, packageHashes: identity.packageHashes, userDataDir: coldProfiles[0], coldProfiles,
      logicalDatabase: fileRecord(snapshot), volume: { minimumImportedRows: imports[0].rowCount, minimumTableRows: Math.min(Math.ceil(metricRows / 8), 500),
        description: `每个隔离店铺含 ${imports[0].rowCount} 条实际 SQLite 广告指标与 ${memoryRows} 条事实；无批准、执行授权或广告执行。` },
      storeIds: stores.map(store => store.storeId), scope: { dateFrom: date, dateTo: date, marketplaceCode: 'US', batchId: imports[0].batchId },
      importBatchIds: recoveryInputs[0].importBatchIds, analysisMissionIds: analysisInputs[0].missionIds, collectionJobs: [],
      table: { entry: 'objects/targets', selector: '.app-content', tableSelector: '.priority-table', classification: 'actual-production-table' },
      originals: [...imports.flatMap(input => input.originals), ...recoveryInputs.flatMap(input => input.originals)],
      softwareInputs: imports, analysisInputs, memoryRows, ownerToken: owner.token, formalCredit: false };
    fs.writeFileSync(path.join(root, 'fixture.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
    return result;
  } catch (error) {
    const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
    fs.appendFileSync(path.join(root, 'fixture-errors.jsonl'), JSON.stringify(createRuntimeLogRecord('error', 'v16.software_fixture_failed', { error })) + '\n');
    if (database?.open) runtime.closeSqlite();
    throw error;
  }
}
module.exports = { createNativeSoftwareFixture };
