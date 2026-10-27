const fs = require('node:fs');
const path = require('node:path');

const { createReportBatch } = require('./v16-native-software-fixture-reports');
const { installSoftwareImportAuthority, completeSoftwareImportRoot } = require('./v16-performance-software-controls');

function seedSoftwareImport(runtime, database, directory, store, rowCount, date) {
  const repository = new runtime.LingxingImportRepository(database);
  const root = path.join(directory, 'reports', store.storeId); fs.mkdirSync(root, { recursive: true });
  const source = createReportBatch(runtime, root, store, date, { id: `software-base-${store.storeId}`, rowsPerReport: Math.ceil(rowCount / 8) });
  repository.saveCollectionSnapshotForStore(store.storeId, source);
  const context = { storeId: store.storeId, browserProfileId: store.browserProfileId, marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: date, sessionGeneration: 0 };
  const fixture = { classification: 'isolated-software-fixture', importBatchIds: [source.batch.id], scope: { dateFrom: date, dateTo: date } };
  const prepared = installSoftwareImportAuthority(runtime, database, context, fixture, 0);
  const result = runtime.importLingxingDownloadedReportMetrics(repository.getCollectionSnapshotForStore(store.storeId, source.batch.id),
    { repository, stores: new runtime.StoreRepository(database) }, { startedAt: prepared.preparedState.importAttemptedAt });
  if (result.errors.length || result.parsedFiles !== 8 || result.inserted < rowCount) {
    throw new Error('SOFTWARE_FIXTURE_PRODUCTION_IMPORT_FAILED:' + JSON.stringify(result));
  }
  const completed = completeSoftwareImportRoot(runtime, database, prepared, context, fixture, result);
  if (completed.importState !== 'succeeded') throw new Error('SOFTWARE_FIXTURE_BASE_IMPORT_ROOT_NOT_COMPLETED');
  return { batchId: source.batch.id, rowCount: result.inserted, importRunId: result.importRunId, originals: source.originals,
    syntheticProviderMetadata: true, formalAcceptance: false };
}

function seedSoftwareMemory(runtime, database, store, rowCount, date) {
  const repository = new runtime.MissionDomainRepository(database);
  const context = { storeId: store.storeId, browserProfileId: store.browserProfileId, marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: date, sessionGeneration: 0 };
  const create = database.transaction(() => {
    for (let index = 0; index < rowCount; index++) repository.appendCausalEvent(context, {
      id: `software-fact-${store.storeId}-${index}`, stage: 'FACT', eventType: 'operator_fact', entityType: 'software_note', entityId: `software-object-${index}`,
      title: `隔离软件事实 ${index}`, signal: '仅供软件界面与性能验收，不是店铺事实。', status: 'recorded', source: 'isolated-software-fixture', actorId: 'software-test-operator',
    });
  });
  create.immediate();
}
module.exports = { seedSoftwareImport, seedSoftwareMemory };
