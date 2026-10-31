import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import fixtureModule from './v16-native-software-fixture.js';
import { loadSoftwareDatabaseRuntime, createSoftwareReportImportRuntime } from './v16-native-software-fixture-runtime.js';
import reports from './v16-native-software-fixture-reports.js';
import controls from './v16-performance-software-controls.js';
import contract from './v16-performance-contract.js';
import fixtureCli from './create-v16-native-software-fixture.js';
import automationControls from '../packages/shared-types/src/store-collection-automation-control.cjs';

const require = createRequire(import.meta.url);
const Database = createRequire(path.resolve('packages/local-db/package.json'))('better-sqlite3');
const identity = { sourceSha256: 'a'.repeat(64), packageHashes: { installer: 'b'.repeat(64), portable: 'c'.repeat(64), zip: 'd'.repeat(64), main: 'e'.repeat(64) } };
function directory(name) { return path.join(os.tmpdir(), `amazon-ai-ops-software-fixture-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`); }

describe('isolated production software fixture', () => {
  it.each(['drain', 'close', 'log', 'drain-and-log'])('preserves primary and %s cleanup failures without closing an undrained database', async stage => {
    const first = new Error('original fixture failure'), drainError = new Error('drain did not observe exit');
    const closeError = new Error('database close failed'), logError = new Error('log destination failed');
    const calls = [], records = [];
    let failure;
    try {
      await fixtureModule.rejectSoftwareFixtureFailure(first, {
        drain: async () => { calls.push('drain'); if (stage.startsWith('drain')) throw drainError; },
        close: () => { calls.push('close'); if (stage === 'close') throw closeError; },
        writeLog: record => { calls.push('log'); records.push(record); if (stage.includes('log')) throw logError; },
      });
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([first, ...(stage.startsWith('drain') ? [drainError] : []),
      ...(stage === 'close' ? [closeError] : []), ...(stage.includes('log') ? [logError] : [])]);
    expect(calls).toEqual(stage.startsWith('drain') ? ['drain','log'] : ['drain','close','log']);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({level:'error',event:'v16.software_fixture_failed'});
  });

  it('accepts only the fixed software fixture kind and fresh output arguments through its CLI', () => {
    expect(fixtureCli.parseArguments(['--fixture', 'typical', '--out-dir', directory('cli')]).fixture).toBe('typical');
    for (const argv of [[], ['--fixture', 'real-store', '--out-dir', directory('bad')], ['--fixture', 'typical', '--out-dir', 'http://localhost'],
      ['--fixture', 'typical', '--fixture', 'maximum'], ['--app-executable', 'arbitrary.exe']]) expect(() => fixtureCli.parseArguments(argv)).toThrow();
  });
  it('uses real migrations, Store and import repositories, verifies cardinality, and prepares three WAL-safe native profiles without authority', async () => {
    const root = directory('real'), fixture = await fixtureModule.createNativeSoftwareFixture({ repositoryRoot: process.cwd(), directory: root,
      fixture: 'typical', identity, metricRows: 16, memoryRows: 3 });
    expect(contract.validateFixture(fixture, 'typical', identity).classification).toBe('isolated-software-fixture');
    expect(fixture.formalCredit).toBe(false); expect(fixture.coldProfiles).toHaveLength(3);
    const snapshot = new Database(fixture.logicalDatabase.path, { readonly: true, fileMustExist: true });
    try {
      expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(snapshot.prepare('SELECT COUNT(*) count FROM stores').get().count).toBe(2);
      expect(snapshot.prepare('SELECT COUNT(*) count FROM ad_daily_metrics').get().count).toBe(32);
      expect(snapshot.prepare('SELECT COUNT(*) count FROM report_import_metric_evidence').get().count).toBe(2);
      expect(snapshot.prepare("SELECT COUNT(*) count FROM causal_events WHERE event_type='operator_fact'").get().count).toBe(6);
      expect(fixture.analysisMissionIds).toHaveLength(3);
      expect(snapshot.prepare('SELECT id,data_batch_id AS batchId,status FROM missions WHERE store_id=? ORDER BY id').all(fixture.storeIds[0]))
        .toEqual(fixture.analysisMissionIds.map((id, index) => ({ id, batchId: fixture.importBatchIds[index], status: 'active' })));
      expect(snapshot.prepare('SELECT autonomy_mode AS mode,active_policy_version_id AS version,kill_switch AS kill FROM policy_runtime').all())
        .toEqual([{ mode: 'manual_approval', version: null, kill: 1 }, { mode: 'manual_approval', version: null, kill: 1 }]);
      for (const row of snapshot.prepare('SELECT rules_json AS rules FROM policy_versions').all()) expect(JSON.parse(row.rules).allowedAdEntityIds).toEqual([]);
      expect(snapshot.prepare('SELECT COUNT(*) count FROM verified_ad_entity_authority').get().count).toBe(0);
      for (const table of ['mission_grants', 'ad_execution_batches', 'ad_execution_jobs']) expect(snapshot.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count).toBe(0);
      for (const table of ['mission_grants_v16', 'store_connections', 'ai_cost_records', 'ai_call_logs']) expect(snapshot.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count).toBe(0);
      expect(snapshot.prepare('SELECT value FROM app_settings WHERE key=?').get('operator_workspace_selection:v1').value).toContain(fixture.storeIds[0]);
    } finally { snapshot.close(); }
    const { createHash } = require('node:crypto');
    for (const profile of fixture.coldProfiles) {
      const file = path.join(profile, 'amazon-ai-ops.db');
      expect(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(fixture.logicalDatabase.sha256);
      expect(fs.existsSync(file + '-wal')).toBe(false);
    }
    const runtime = await loadSoftwareDatabaseRuntime(process.cwd(), root);
    const live = runtime.initSqlite(path.join(fixture.coldProfiles[0], 'amazon-ai-ops.db'));
    try { expect(new runtime.StoreRepository(live).listStores()).toHaveLength(2); }
    finally { runtime.closeSqlite(); }
  }, 30_000);

  it('persists both store runtime configs through the production service and reads their analysis contract from all three cold profiles', async () => {
    const root = directory('runtime-configs'), fixture = await fixtureModule.createNativeSoftwareFixture({ repositoryRoot: process.cwd(), directory: root,
      fixture: 'typical', identity, metricRows: 3, memoryRows: 1 });
    const expectedValues = { aiRecommendationsEnabled: false, collectionScheduleLocalTime: '08:00', collectionLookbackDays: 14,
      analysisWindowDays: 30, defaultTargetAcosPercent: 28, minimumRecommendationConfidencePercent: 72, evidenceRetentionDays: 365 };
    const { createHash } = require('node:crypto');
    expect(createHash('sha256').update(fs.readFileSync(fixture.logicalDatabase.path)).digest('hex')).toBe(fixture.logicalDatabase.sha256);
    expect(fixture.coldProfiles).toHaveLength(3);
    for (const profile of fixture.coldProfiles) {
      const file = path.join(profile, 'amazon-ai-ops.db');
      expect(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(fixture.logicalDatabase.sha256);
      expect(fs.existsSync(file + '-wal')).toBe(false);
      const runtime = await loadSoftwareDatabaseRuntime(process.cwd(), profile), database = runtime.initSqlite(file);
      try {
        const repository = new runtime.StoreRepository(database), bus = new runtime.ConfigurationBus(database);
        const generationKey = storeId => `store_session_generation:${storeId}`;
        const sessions = new runtime.DurableStoreSessionGenerationAuthority({ transaction: work => bus.transaction(work),
          read: storeId => { const value = bus.get(generationKey(storeId)); return value === null ? undefined : Number(value); },
          write: (storeId, generation) => bus.set(generationKey(storeId), String(generation)) });
        const coordinator = new runtime.StoreCoordinator({ repository, sessions });
        const configs = new runtime.StoreRuntimeConfigService({ storeCoordinator: coordinator, settings: bus });
        const automation = new runtime.StoreCollectionAutomationService({ storeCoordinator: coordinator, settings: bus });
        const stores = repository.listStores();
        expect(stores.map(store => store.storeId)).toEqual(fixture.storeIds);
        for (const store of stores) {
          const { context } = coordinator.switchStore({ storeId: store.storeId, marketplace: 'US' });
          const projection = configs.get(context);
          expect(projection.current).not.toBeNull();
          expect(context).toMatchObject({ storeId: store.storeId, browserProfileId: store.browserProfileId });
          expect(projection.current).toMatchObject({ storeId: store.storeId, revision: 1, status: 'active', values: expectedValues });
          expect(projection.current.values).toEqual(expectedValues);
          const control = automation.get(context);
          expect(control).toMatchObject({ storeId: store.storeId, browserProfileId: store.browserProfileId,
            automaticCollectionEnabled: false, source: 'explicit-override', revision: 1 });
          expect(new Date(control.updatedAt).toISOString()).toBe(control.updatedAt);
          expect(automationControls.readStoreCollectionAutomation(bus.get(automationControls.storeCollectionAutomationSettingKey(store.storeId)), store)).toEqual(control);
          expect(projection.versions).toEqual([{ revision: 1, action: 'create', occurredAt: projection.current.createdAt, snapshot: projection.current }]);
          const analysis = runtime.requireStoreRuntimeAnalysisConfig(runtime.DEFAULT_RULE_CONFIG, projection);
          expect(analysis).toMatchObject({ storeId: store.storeId, configRevision: 1, values: expectedValues,
            ruleConfig: { ...runtime.DEFAULT_RULE_CONFIG, targetAcos: 0.28 }, minimumRecommendationConfidence: 0.72 });
        }
        expect(database.prepare("SELECT COUNT(*) count FROM app_settings WHERE key IN ('ai_api_key','aiApiKey','ai_api_key_encrypted','login_password','login_password_encrypted') OR key LIKE 'store_login_credentials:v1:%'").get().count).toBe(0);
        for (const table of ['mission_grants', 'mission_grants_v16', 'ad_execution_batches', 'ad_execution_jobs', 'store_connections', 'ai_cost_records', 'ai_call_logs']) {
          expect(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count).toBe(0);
        }
      } finally { runtime.closeSqlite(); }
    }
  }, 30_000);

  it('supports different real typical and maximum row counts without relabelling the same SQLite input', async () => {
    const results = [];
    for (const [fixture, rows] of [['typical', 3], ['maximum', 9]]) results.push(await fixtureModule.createNativeSoftwareFixture({
      repositoryRoot: process.cwd(), directory: directory(fixture), fixture, identity, metricRows: rows, memoryRows: 1 }));
    expect(results.map(value => value.volume.minimumImportedRows)).toEqual([8, 16]);
    expect(results[0].logicalDatabase.sha256).not.toBe(results[1].logicalDatabase.sha256);
  }, 30_000);

  it('rejects formal or existing output paths, invalid volumes and missing identity before touching a database', async () => {
    await expect(fixtureModule.createNativeSoftwareFixture({ repositoryRoot: process.cwd(), directory: directory('identity'), fixture: 'typical', identity: null })).rejects.toThrow('IDENTITY');
    await expect(fixtureModule.createNativeSoftwareFixture({ repositoryRoot: process.cwd(), directory: directory('rows'), fixture: 'typical', identity, metricRows: -1 })).rejects.toThrow('VOLUME');
    await expect(fixtureModule.createNativeSoftwareFixture({ repositoryRoot: process.cwd(), directory: path.resolve('storage'), fixture: 'typical', identity })).rejects.toThrow(/Temp/);
    const existing = directory('existing'); fs.mkdirSync(existing, { recursive: true }); fs.writeFileSync(path.join(existing, 'keep.txt'), '保留');
    await expect(fixtureModule.createNativeSoftwareFixture({ repositoryRoot: process.cwd(), directory: existing, fixture: 'typical', identity })).rejects.toThrow('NEW_DIRECTORY');
    expect(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8')).toBe('保留');
  });

  it('uses the real parser configuration bus, rejects excess bytes without a commit, and drains before closing SQLite', async () => {
    const root = directory('parser-bus'); fs.mkdirSync(root, { recursive: true });
    const runtime = await loadSoftwareDatabaseRuntime(process.cwd(), root), database = runtime.initSqlite(path.join(root, 'seed.db'));
    let importer;
    try {
      expect(() => createSoftwareReportImportRuntime(runtime, database, root, 'real-data-copy')).toThrow('SYNTHETIC_METADATA');
      importer = createSoftwareReportImportRuntime(runtime, database, root, 'isolated-software-fixture');
      const stores = new runtime.StoreRepository(database), repository = new runtime.LingxingImportRepository(database);
      const store = stores.createStore({storeId:'bus-store',browserProfileId:'bus-profile',displayName:'隔离预算店铺',
        marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles'});
      const source = reports.createReportBatch(runtime, root, store, '2026-10-15', { id:'bus-eight' });
      repository.saveCollectionSnapshotForStore(store.storeId, source);
      const context = {storeId:store.storeId,browserProfileId:store.browserProfileId,marketplace:'US',currency:'USD',
        businessTimezone:store.businessTimezone,businessDate:source.batch.businessDate,sessionGeneration:0};
      const bus = new runtime.ConfigurationBus(database);
      bus.set('report_parser_maxInputBytes:v1', '1');
      const rejected = await importer.importReports(source, {context});
      expect(rejected).toMatchObject({inserted:0,parsedFiles:0});
      expect(rejected.errors).toHaveLength(8);
      expect(repository.getImportRunForStore(store.storeId, 'import_' + source.batch.id)).toBeUndefined();
      expect(database.prepare('SELECT COUNT(*) n FROM ad_daily_metrics').get().n).toBe(0);
      bus.delete('report_parser_maxInputBytes:v1');
      expect(await importer.importReports(source, {context})).toMatchObject({inserted:8,parsedFiles:8,errors:[]});
      await importer.stopAndDrain();
      await expect(importer.importReports(source, {context})).rejects.toThrow('CONTEXT_REQUIRED');
    } finally { await importer?.stopAndDrain(); if (database.open) runtime.closeSqlite(); }
  }, 30_000);

  it.each(['session', 'job', 'source'])('rejects %s drift during a real Worker await before any import write', async kind => {
    const root = directory('await-' + kind); fs.mkdirSync(root, { recursive: true });
    const runtime = await loadSoftwareDatabaseRuntime(process.cwd(), root), database = runtime.initSqlite(path.join(root, 'seed.db'));
    const importer = createSoftwareReportImportRuntime(runtime, database, root, 'isolated-software-fixture');
    try {
      const store = new runtime.StoreRepository(database).createStore({storeId:'drift-store',browserProfileId:'drift-profile',displayName:'隔离等待核验店铺',
        marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles'});
      const repository = new runtime.LingxingImportRepository(database), source = reports.createReportBatch(runtime, root, store, '2026-10-15', {id:'drift-eight'});
      repository.saveCollectionSnapshotForStore(store.storeId, source);
      const context = {storeId:store.storeId,browserProfileId:store.browserProfileId,marketplace:'US',currency:'USD',
        businessTimezone:store.businessTimezone,businessDate:'2026-10-15',sessionGeneration:0};
      const prepared = controls.installSoftwareImportAuthority(runtime, database, context,
        {classification:'isolated-software-fixture',importBatchIds:[source.batch.id],scope:{dateFrom:'2026-10-15',dateTo:'2026-10-15'}}, 0);
      const persisted = repository.getCollectionSnapshotForStore(store.storeId, source.batch.id);
      const pending = importer.importReports(persisted, {context,expectedJob:prepared.preparedState,startedAt:prepared.preparedState.importAttemptedAt});
      // 正式客户端已经启动首个 Worker；此处在其实际返回前旋转持久权威或源文件。
      if (kind === 'session') new runtime.ConfigurationBus(database).set('store_session_generation:' + store.storeId, '1');
      if (kind === 'job') {
        const job = structuredClone(prepared.preparedState); job.updatedAt = new Date(Date.parse(job.updatedAt) + 1).toISOString();
        repository.upsertCollectionProgressForStore(store.storeId, {eventId:'drift-job',emittedAt:job.updatedAt,job});
      }
      if (kind === 'source') fs.appendFileSync(persisted.files[0].filePath, '\n');
      const result = await pending;
      expect(result.inserted).toBe(0);
      expect(result.errors.some(error => /CHANGED/.test(error.message))).toBe(true);
      expect(repository.getImportRunForStore(store.storeId, 'import_' + source.batch.id)).toBeUndefined();
      expect(database.prepare('SELECT COUNT(*) n FROM ad_daily_metrics').get().n).toBe(0);
      expect(database.prepare('SELECT COUNT(*) n FROM report_import_metric_evidence').get().n).toBe(0);
      expect(repository.getCollectionJobForStore(store.storeId, prepared.jobId).importState).toBe('pending');
      for (const table of ['mission_grants','mission_grants_v16','ad_execution_batches','ad_execution_jobs','ai_cost_records'])
        expect(database.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n).toBe(0);
    } finally { await importer.stopAndDrain(); if (database.open) runtime.closeSqlite(); }
  }, 30_000);
});
