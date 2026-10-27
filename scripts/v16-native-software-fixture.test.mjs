import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import fixtureModule from './v16-native-software-fixture.js';
import { loadSoftwareDatabaseRuntime } from './v16-native-software-fixture-runtime.js';
import contract from './v16-performance-contract.js';
import fixtureCli from './create-v16-native-software-fixture.js';
import automationControls from '../packages/shared-types/src/store-collection-automation-control.cjs';

const require = createRequire(import.meta.url);
const Database = createRequire(path.resolve('packages/local-db/package.json'))('better-sqlite3');
const identity = { sourceSha256: 'a'.repeat(64), packageHashes: { installer: 'b'.repeat(64), portable: 'c'.repeat(64), zip: 'd'.repeat(64), main: 'e'.repeat(64) } };
function directory(name) { return path.join(os.tmpdir(), `amazon-ai-ops-software-fixture-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`); }

describe('isolated production software fixture', () => {
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
});
