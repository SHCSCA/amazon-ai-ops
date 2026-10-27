const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { insist, directPath, fileRecord, within } = require('./v16-performance-artifacts');
const { same } = require('./v16-performance-contract');
const { fixedIpc, currentStore } = require('./v16-performance-observe');
const { createReportBatch } = require('./v16-native-software-fixture-reports');

function installSoftwareCollectionControlInputs(production, database, directory, store, context, fixture, index) {
  insist(fixture.classification === 'isolated-software-fixture', 'NFR_SYNTHETIC_METADATA_FORBIDDEN_FOR_REAL_DATA');
  const repository = new production.LingxingImportRepository(database), jobs = {}, originals = [];
  for (const action of ['cancel', 'resume']) {
    const jobId = `software-${action}-${fixture.fixture}-${index}-${randomUUID()}`, requestId = jobId + '-request';
    const snapshot = createReportBatch(production, directory, { ...store, browserProfileId: context.browserProfileId }, fixture.scope.dateFrom,
      { id: jobId, requestId, context });
    originals.push(...snapshot.originals);
    const now = new Date().toISOString();
    const job = { jobId, request: { requestId, storeContext: context, dateStart: fixture.scope.dateFrom,
      dateEnd: fixture.scope.dateTo, mode: 'create-and-download', reportTypes: snapshot.files.map(file => file.reportType) },
    state: action === 'cancel' ? 'queued' : 'completed',
    reports: snapshot.files.map(file => ({ reportType: file.reportType, state: 'downloaded', attemptIndex: 0,
      autoRetryCount: 0, fileSizeBytes: file.fileSizeBytes, updatedAt: snapshot.batch.completedAt,
      createdReportIdentity: { provider: 'lingxing', reportType: file.reportType, externalReportName: 'SOFTWARE_ONLY_' + jobId + '_' + file.reportType,
        dateStart: fixture.scope.dateFrom, dateEnd: fixture.scope.dateTo, createdAt: snapshot.batch.createdAt } })),
    lineage: { lineageId: jobId, rootJobId: jobId, expectedReportTypes: snapshot.files.map(file => file.reportType), purpose: 'production_full' },
    createdAt: snapshot.batch.createdAt, updatedAt: now, detail: 'SOFTWARE_ONLY: syntheticProviderMetadata=true; formalAcceptance=false',
    ...(action === 'resume' ? { completedAt: snapshot.batch.completedAt, importState: 'pending' } : {}) };
    const install = database.transaction(() => {
      repository.saveCollectionSnapshotForStore(context.storeId, snapshot);
      repository.upsertCollectionProgressForStore(context.storeId, { eventId: jobId + '-software-prepare', emittedAt: now, job });
      new production.ConfigurationBus(database).set('software_native_fixture_provider_metadata:v1:' + jobId,
        JSON.stringify({ syntheticProviderMetadata: true, formalAcceptance: false, classification: fixture.classification }));
    });
    install.immediate();
    const persisted = repository.getCollectionJobForStore(context.storeId, jobId);
    insist(persisted?.state === job.state && persisted.request.requestId === requestId, 'NFR_PREPARATION_DURABLE_JOB_MISMATCH');
    jobs[action] = { jobId, requestId, downloadedOnly: true, syntheticProviderMetadata: true, formalAcceptance: false, preparedState: persisted };
  }
  return { jobs, originals };
}
function installSoftwareImportAuthority(production, database, context, fixture, index) {
  insist(fixture.classification === 'isolated-software-fixture', 'NFR_SYNTHETIC_METADATA_FORBIDDEN_FOR_REAL_DATA');
  const repository = new production.LingxingImportRepository(database), batchId = fixture.importBatchIds?.[index];
  const snapshot = repository.getCollectionSnapshotForStore(context.storeId, batchId);
  insist(snapshot?.batch.status === 'completed' && snapshot.files.length === 8
    && new Set(snapshot.files.map(file => file.reportType)).size === 8
    && snapshot.files.every(file => file.status === 'downloaded')
    && !repository.getImportRunForStore(context.storeId, 'import_' + batchId), 'NFR_UNIMPORTED_SOFTWARE_BATCH_REQUIRED');
  const now = new Date().toISOString(), requestId = batchId + '-measured-import';
  const reportTypes = snapshot.files.map(file => file.reportType);
  const job = { jobId: batchId, request: { requestId, storeContext: context, dateStart: fixture.scope.dateFrom,
    dateEnd: fixture.scope.dateTo, mode: 'create-and-download', reportTypes }, state: 'completed',
    reports: snapshot.files.map(file => ({ reportType: file.reportType, state: 'downloaded', attemptIndex: 0,
      autoRetryCount: 0, fileSizeBytes: file.fileSizeBytes, updatedAt: now,
      createdReportIdentity: { provider: 'lingxing', reportType: file.reportType, externalReportName: 'SOFTWARE_ONLY_' + batchId + '_' + file.reportType,
        dateStart: fixture.scope.dateFrom, dateEnd: fixture.scope.dateTo, createdAt: snapshot.batch.createdAt } })),
    lineage: { lineageId: batchId, rootJobId: batchId, expectedReportTypes: reportTypes, purpose: 'production_full' },
    createdAt: snapshot.batch.createdAt, completedAt: now, updatedAt: now, importState: 'pending', importAttemptedAt: now,
    detail: 'SOFTWARE_ONLY: syntheticProviderMetadata=true; formalAcceptance=false' };
  const install = database.transaction(() => {
    repository.saveCollectionSnapshotForStore(context.storeId, { ...snapshot, batch: { ...snapshot.batch, requestId,
      browserProfileId: context.browserProfileId, sessionGeneration: context.sessionGeneration, businessDate: context.businessDate,
      completedAt: now } });
    repository.upsertCollectionProgressForStore(context.storeId, { eventId: batchId + '-measured-import-prepare', emittedAt: now, job });
    new production.ConfigurationBus(database).set('software_native_fixture_provider_metadata:v1:' + batchId,
      JSON.stringify({ syntheticProviderMetadata: true, formalAcceptance: false, classification: fixture.classification }));
  });
  install.immediate();
  return { jobId: batchId, requestId, syntheticProviderMetadata: true, formalAcceptance: false,
    preparedState: repository.getCollectionJobForStore(context.storeId, batchId),
    originals: snapshot.files.map(file => fileRecord(file.filePath)) };
}
function completeSoftwareImportRoot(production, database, prepared, context, fixture, imported) {
  insist(fixture.classification === 'isolated-software-fixture' && prepared.syntheticProviderMetadata === true
    && prepared.formalAcceptance === false, 'NFR_SYNTHETIC_METADATA_FORBIDDEN_FOR_REAL_DATA');
  const repository = new production.LingxingImportRepository(database);
  const job = repository.getCollectionJobForStore(context.storeId, prepared.jobId);
  const run = repository.getImportRunForStore(context.storeId, imported.importRunId);
  const proof = repository.readUniqueCollectionAuthorityProofForStoreByRequestId(context.storeId, prepared.requestId);
  const receipt = production.assertStoreCollectionCommittedImportProofForRecovery(proof, { context, requestId: prepared.requestId,
    dateStart: fixture.scope.dateFrom, dateEnd: fixture.scope.dateTo, expectedJob: job, expectedRun: run });
  insist(receipt.casToken && job.importAttemptedAt, 'NFR_SOFTWARE_IMPORT_CAS_REQUIRED');
  const completedAt = new Date(Math.max(Date.now(), ...[job.updatedAt, run.completedAt, run.createdAt].map(value => Date.parse(value) + 1))).toISOString();
  return repository.completeRecoveredCollectionImportForStore(receipt.casToken, { attemptedAt: job.importAttemptedAt, completedAt });
}
async function prepareSoftwareCollectionControls({ root, runtime, fixture, current, storage, writer, index }) {
  insist(fixture.classification === 'isolated-software-fixture' && fixture.ownerToken, 'NFR_OWNED_SOFTWARE_FIXTURE_REQUIRED');
  const profile = require('./evidence-user-data').validateEvidenceUserDataPath(runtime.userDataDir);
  insist(path.resolve(storage.localDbPath).toLowerCase() === path.join(profile, 'amazon-ai-ops.db').toLowerCase(), 'NFR_PREPARATION_DATABASE_OUTSIDE_PROFILE');
  const identity = await runtime.app.evaluate(({ app }) => ({ pid: process.pid, profile: app.getPath('userData'), packaged: app.isPackaged }));
  insist(identity.pid === runtime.identity.pid && identity.packaged === true
    && path.resolve(identity.profile).toLowerCase() === profile.toLowerCase()
    && fs.existsSync(path.join(profile, 'v16-nfr-collector.lock')), 'NFR_PREPARATION_RUNTIME_IDENTITY_MISMATCH');
  const ownerPath = path.join(path.dirname(profile), 'owner.json');
  const owner = JSON.parse(fs.readFileSync(directPath(ownerPath).path, 'utf8'));
  insist(owner.token === fixture.ownerToken && owner.classification === fixture.classification, 'NFR_FIXTURE_OWNER_CHANGED');
  const view = await currentStore(runtime.page, fixture), beforeAuthority = await fixedIpc(runtime.page, 'authority', view.context);
  const directory = path.join(profile, 'nfr-local-recovery-' + randomUUID());
  insist(within(profile, directory), 'NFR_PREPARATION_PATH_ESCAPES_PROFILE'); fs.mkdirSync(directory);
  const production = await require('./v16-native-software-fixture-runtime').loadSoftwareDatabaseRuntime(root, directory);
  let database;
  const startedAt = new Date().toISOString();
  let jobs, originals;
  try {
    database = production.initSqlite(storage.localDbPath);
    ({ jobs, originals } = installSoftwareCollectionControlInputs(production, database, directory, view.store, view.context, fixture, index));
    const imports = new production.LingxingImportRepository(database), domains = new production.MissionDomainRepository(database);
    const source = createReportBatch(production, directory, { ...view.store, browserProfileId: view.context.browserProfileId }, fixture.scope.dateFrom,
      { context: view.context, rowsPerReport: Math.ceil(fixture.volume.minimumImportedRows / 8) });
    imports.saveCollectionSnapshotForStore(view.context.storeId, source);
    originals.push(...source.originals);
    const sourceFixture = { ...fixture, importBatchIds: { [index]: source.batch.id } };
    jobs.import = installSoftwareImportAuthority(production, database, view.context, sourceFixture, index);
    const template = domains.getMission(view.context, fixture.analysisMissionIds?.[index]);
    insist(template?.policyVersionId, 'NFR_SOFTWARE_ANALYSIS_TEMPLATE_MISSION_REQUIRED');
    let mission = domains.createMission(view.context, { id: 'software-measured-analysis-' + randomUUID(), dataBatchId: source.batch.id,
      policyVersionId: template.policyVersionId, title: '隔离软件性能分析', objective: '仅测生产规则分析服务，不创建批准或执行。',
      priority: template.priority, productId: template.productId, observationStartsAt: template.observationStartsAt,
      observationEndsAt: template.observationEndsAt, successCriteria: template.successCriteria, guardrails: template.guardrails,
      actorId: 'software-test-operator' });
    mission = domains.transitionMission(view.context, { id: mission.id, expectedRevision: mission.revision, status: 'active', phase: 'analysis', actorId: 'software-test-operator' });
    jobs.import.analysisMissionId = mission.id;
    originals.push(...jobs.import.originals);
    const backup = path.join(directory, 'prepared-database.db'); await database.backup(backup); originals.push(fileRecord(backup));
  } catch (error) {
    writer.log('v16.nfr_local_recovery_preparation_failed', error, { fixture: fixture.fixture, sample: index, pid: runtime.identity.pid });
    throw error;
  } finally { if (database?.open) production.closeSqlite(); }
  const afterAuthority = await fixedIpc(runtime.page, 'authority', view.context);
  insist(same(beforeAuthority.grants, afterAuthority.grants) && same(beforeAuthority.batches, afterAuthority.batches), 'NFR_PREPARATION_AUTHORITY_SIDE_EFFECT');
  for (const original of originals) writer.track(original);
  const receipt = writer.json(`${fixture.fixture}/${index}/local-recovery-preparation.json`, { kind: 'v16-nfr-software-preparation',
    classification: fixture.classification, sourceSha256: fixture.sourceSha256, packageIdentity: current.packageIdentity,
    pid: runtime.identity.pid, userDataDir: profile, storeContext: view.context, startedAt, finishedAt: new Date().toISOString(),
    definition: '独立取消排队任务与独立下载终态补导任务；不是同一任务的连续取消恢复，也不代表真实 ERP 下载。',
    jobs, originals, transaction: 'production-repository-immediate', backup: 'sqlite-online-backup',
    beforeAuthority, afterAuthority, syntheticProviderMetadata: true, formalAcceptance: false, measurementExcludesPreparation: true });
  return { ...jobs, receipt, originals };
}
module.exports = { prepareSoftwareCollectionControls, installSoftwareCollectionControlInputs, installSoftwareImportAuthority, completeSoftwareImportRoot };
