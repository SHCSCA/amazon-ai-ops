import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadSoftwareDatabaseRuntime } from './v16-native-software-fixture-runtime.js';
import reports from './v16-native-software-fixture-reports.js';
import controls from './v16-performance-software-controls.js';
import admission from './v16-performance-admission.js';
import automationControls from '../packages/shared-types/src/store-collection-automation-control.cjs';
let root,runtime,database,store,repository,stores;
beforeAll(async()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'amazon-ai-ops-nfr-reports-'));
  runtime=await loadSoftwareDatabaseRuntime(process.cwd(),root); database=runtime.initSqlite(path.join(root,'actual-software.db'));
  stores=new runtime.StoreRepository(database); store=stores.createStore({storeId:'software-report-store',browserProfileId:'software-report-profile',
    displayName:'隔离软件报表店铺',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles'});
  repository=new runtime.LingxingImportRepository(database);
},30_000);
afterAll(()=>{ if(database?.open) runtime.closeSqlite(); });


function prepareAutomationAdmission(label) {
  runtime.closeSqlite(); database=runtime.initSqlite(path.join(root,label+'.db'));
  const storeRepository=new runtime.StoreRepository(database), records=['a','b'].map(suffix=>storeRepository.createStore({
    storeId:label+'-'+suffix,browserProfileId:label+'-profile-'+suffix,displayName:'隔离调度准入店铺 '+suffix,
    marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles'}));
  const bus=new runtime.ConfigurationBus(database), generationKey=storeId=>'store_session_generation:'+storeId;
  const sessions=new runtime.DurableStoreSessionGenerationAuthority({transaction:work=>bus.transaction(work),
    read:storeId=>{const value=bus.get(generationKey(storeId));return value===null?undefined:Number(value);},
    write:(storeId,generation)=>bus.set(generationKey(storeId),String(generation))});
  const coordinator=new runtime.StoreCoordinator({repository:storeRepository,sessions});
  const configs=new runtime.StoreRuntimeConfigService({storeCoordinator:coordinator,settings:bus});
  const automation=new runtime.StoreCollectionAutomationService({storeCoordinator:coordinator,settings:bus});
  const values={aiRecommendationsEnabled:false,collectionScheduleLocalTime:'08:00',collectionLookbackDays:14,
    analysisWindowDays:30,defaultTargetAcosPercent:28,minimumRecommendationConfidencePercent:72,evidenceRetentionDays:365};
  for(const store of records){const {context}=coordinator.switchStore({storeId:store.storeId,marketplace:'US'});configs.create(context,{values});}
  return {records,bus,coordinator,configs,automation,values};
}

describe('NFR genuine eight-template report and durable recovery preparation software mechanism',()=>{
  it('passes each real registered template, raw independent control scanner and production eight-file import',()=>{
    const result=reports.createReportBatch(runtime,root,store,'2026-10-15',{id:'eight-source',rowsPerReport:3});
    repository.saveCollectionSnapshotForStore(store.storeId,result);
    expect(result.files).toHaveLength(8); expect(result.originals).toHaveLength(9);
    for(const file of result.files) expect(runtime.ReportParser.readLingxingRawReportControlTotals(file.filePath,
      {dateStart:'2026-10-15',dateEnd:'2026-10-15'})).toMatchObject({expectedRows:3,expectedCost:3});
    const imported=runtime.importLingxingDownloadedReportMetrics(result,{repository,stores});
    expect(imported).toMatchObject({parsedFiles:8,inserted:24,deduplicated:false,errors:[]});
    expect(repository.getImportRunForStore(store.storeId,imported.importRunId)).toMatchObject({sourceFileCount:8,metricRowCount:24});
    for(const table of ['mission_grants','ad_execution_batches','ad_execution_jobs']) expect(database.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count).toBe(0);
  });
  it('prepares three distinct unimported batches and never imports them or creates jobs during pre-start seeding',()=>{
    const seeded=reports.seedSoftwareRecoveryInputs(runtime,database,root,store,'2026-10-15',3,{rowsPerReport:2});
    expect(new Set(seeded.importBatchIds).size).toBe(3); expect(seeded.collectionJobs).toEqual([]); expect(seeded.originals).toHaveLength(27);
    for(const id of seeded.importBatchIds) {
      expect(repository.getCollectionSnapshotForStore(store.storeId,id).files).toHaveLength(8);
      expect(repository.getImportRunForStore(store.storeId,'import_'+id)).toBeUndefined();
      expect(repository.getCollectionJobForStore(store.storeId,id)).toBeUndefined();
    }
  });
  it('installs separate queued cancel and completed pending recovery states in real immediate repository transactions',()=>{
    const context={storeId:store.storeId,browserProfileId:store.browserProfileId,marketplace:'US',currency:'USD',businessTimezone:store.businessTimezone,businessDate:'2026-10-16',sessionGeneration:1};
    const result=controls.installSoftwareCollectionControlInputs(runtime,database,root,store,context,
      {fixture:'typical',classification:'isolated-software-fixture',scope:{dateFrom:'2026-10-15',dateTo:'2026-10-15'}},0);
    expect(result.jobs.cancel.jobId).not.toBe(result.jobs.resume.jobId);
    expect(repository.getCollectionJobForStore(store.storeId,result.jobs.cancel.jobId)).toMatchObject({state:'queued'});
    expect(repository.getCollectionJobForStore(store.storeId,result.jobs.resume.jobId)).toMatchObject({state:'completed',importState:'pending'});
    const cancelled=repository.cancelCollectionJobForStore(store.storeId,result.jobs.cancel.jobId,{requestId:result.jobs.cancel.requestId,completedAt:new Date().toISOString()});
    expect(cancelled.state).toBe('cancelled');
    const snapshot=repository.getCollectionSnapshotForStore(store.storeId,result.jobs.resume.jobId);
    expect(runtime.importLingxingDownloadedReportMetrics(snapshot,{repository,stores})).toMatchObject({parsedFiles:8,errors:[]});
    expect(repository.getCollectionJobForStore(store.storeId,result.jobs.resume.jobId).state).toBe('completed');
  });
  it('uses the genuine production full-root verifier and CAS only for explicitly labelled software metadata',()=>{
    const fixture={fixture:'typical',classification:'isolated-software-fixture',importBatchIds:['software-import-'+store.storeId+'-1'],scope:{dateFrom:'2026-10-15',dateTo:'2026-10-15'}};
    const original=repository.getCollectionSnapshotForStore(store.storeId,fixture.importBatchIds[0]);
    const context={storeId:store.storeId,browserProfileId:store.browserProfileId,marketplace:'US',currency:'USD',businessTimezone:store.businessTimezone,
      businessDate:original.batch.businessDate,sessionGeneration:original.batch.sessionGeneration};
    const prepared=controls.installSoftwareImportAuthority(runtime,database,context,fixture,0);
    const source=repository.getCollectionSnapshotForStore(store.storeId,prepared.jobId);
    const imported=runtime.importLingxingDownloadedReportMetrics(source,{repository,stores},{startedAt:prepared.preparedState.importAttemptedAt});
    expect(imported.errors).toEqual([]);
    expect(controls.completeSoftwareImportRoot(runtime,database,prepared,context,fixture,imported)).toMatchObject({state:'completed',importState:'succeeded'});
    expect(prepared).toMatchObject({syntheticProviderMetadata:true,formalAcceptance:false});
    expect(prepared.preparedState.reports.every(report=>report.createdReportIdentity.externalReportName.startsWith('SOFTWARE_ONLY_') && !report.createdReportIdentity.externalReportId)).toBe(true);
    expect(()=>controls.installSoftwareImportAuthority(runtime,database,context,{...fixture,classification:'real-data-copy'},0)).toThrow('NFR_SYNTHETIC_METADATA_FORBIDDEN_FOR_REAL_DATA');
    expect(()=>controls.completeSoftwareImportRoot(runtime,database,prepared,context,{...fixture,classification:'real-data-copy'},imported)).toThrow('NFR_SYNTHETIC_METADATA_FORBIDDEN_FOR_REAL_DATA');
  });
  it('rejects a changed registered header through production import instead of accepting a supplied passed flag',()=>{
    const result=reports.createReportBatch(runtime,root,store,'2026-10-15',{id:'changed-source'});
    repository.saveCollectionSnapshotForStore(store.storeId,result);
    fs.writeFileSync(result.files[0].filePath,'日期,未知字段\n2026-10-15,错误数据\n');
    const actual=runtime.importLingxingDownloadedReportMetrics(result,{repository,stores});
    expect(actual.errors.length).toBeGreaterThan(0); expect(actual.inserted).toBe(0);
    expect(repository.getImportRunForStore(store.storeId,'import_'+result.batch.id)).toBeUndefined();
  });
  it('requires a quiescent actual migrated database before any packaged runtime is launched',()=>{
    runtime.closeSqlite(); database=runtime.initSqlite(path.join(root,'quiescent.db'));
    const stores=new runtime.StoreRepository(database), local=stores.createStore({storeId:'quiescent-store',browserProfileId:'quiescent-profile',
      displayName:'隔离启动门店铺',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles'});
    expect(admission.inspectQuiescentDatabase(database,'isolated-software-fixture').counts.ad_execution_jobs).toBe(0);
    const context={storeId:local.storeId,browserProfileId:local.browserProfileId,marketplace:'US',currency:'USD',businessTimezone:local.businessTimezone,businessDate:'2026-10-16',sessionGeneration:0};
    new runtime.MissionDomainRepository(database).getPolicyRuntime(context);
    database.prepare("UPDATE policy_runtime SET autonomy_mode='policy_auto' WHERE store_id=?").run(local.storeId);
    expect(()=>admission.inspectQuiescentDatabase(database,'real-data-copy')).toThrow('NFR_PRELAUNCH_AUTOMATIC_POLICY_PRESENT');
    database.prepare("UPDATE policy_runtime SET autonomy_mode='manual_approval' WHERE store_id=?").run(local.storeId);
    database.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('store_runtime_config:v1:'+local.storeId,JSON.stringify({current:{status:'active'}}));
    expect(()=>admission.inspectQuiescentDatabase(database,'real-data-copy')).toThrow('NFR_PRELAUNCH_ENABLED_COLLECTION_SCHEDULE');
    expect(admission.inspectQuiescentDatabase(database,'isolated-software-fixture').counts.store_connections).toBe(0);
    database.prepare("UPDATE app_settings SET value='bad-json' WHERE key LIKE 'store_runtime_config:%'").run();
    expect(()=>admission.inspectQuiescentDatabase(database,'isolated-software-fixture')).toThrow();
    database.prepare("DELETE FROM app_settings WHERE key LIKE 'store_runtime_config:%'").run();
    const other=stores.createStore({storeId:'other-quiescent',browserProfileId:'other-profile',displayName:'另一个非当前店铺',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles'});
    new runtime.MissionDomainRepository(database).getPolicyRuntime({...context,storeId:other.storeId,browserProfileId:other.browserProfileId});
    database.prepare("UPDATE policy_runtime SET autonomy_mode='policy_auto' WHERE store_id=?").run(other.storeId);
    expect(()=>admission.inspectQuiescentDatabase(database,'real-data-copy')).toThrow('NFR_PRELAUNCH_AUTOMATIC_POLICY_PRESENT');
    database.prepare("UPDATE policy_runtime SET autonomy_mode='manual_approval'").run();
    database.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('store_collection_orchestrator_history_v5','encrypted-unverified-history');
    expect(()=>admission.inspectQuiescentDatabase(database,'real-data-copy')).toThrow('NFR_PRELAUNCH_UNAUDITED_ORCHESTRATOR_HISTORY');
    database.prepare('DELETE FROM app_settings WHERE key=?').run('store_collection_orchestrator_history_v5');
    database.exec('CREATE TABLE scheduled_tasks(id TEXT, enabled INTEGER)');
    expect(()=>admission.inspectQuiescentDatabase(database,'real-data-copy')).toThrow('NFR_PRELAUNCH_UNAUDITED_LEGACY_SCHEDULER');
  });
  it('keeps both active collection schedules enabled by legacy default without writing an override',()=>{
    const state=prepareAutomationAdmission('admission-legacy');
    const before=database.prepare('SELECT key,value FROM app_settings ORDER BY key').all();
    const observed=admission.inspectQuiescentDatabase(database,'isolated-software-fixture');
    const configuredKeys=state.records.map(store=>'store_runtime_config:v1:'+store.storeId);
    expect(observed.activeSchedules).toEqual(configuredKeys);
    expect(database.prepare('SELECT key,value FROM app_settings ORDER BY key').all()).toEqual(before);
    for(const store of state.records){
      const {context}=state.coordinator.switchStore({storeId:store.storeId,marketplace:'US'});
      expect(state.automation.get(context)).toMatchObject({storeId:store.storeId,browserProfileId:store.browserProfileId,
        automaticCollectionEnabled:true,source:'legacy-default',revision:0,updatedAt:null});
      expect(state.bus.get(automationControls.storeCollectionAutomationSettingKey(store.storeId))).toBeNull();
    }
    expect(()=>admission.inspectQuiescentDatabase(database,'real-data-copy')).toThrow('NFR_PRELAUNCH_ENABLED_COLLECTION_SCHEDULE');
  });
  it('admits zero effective schedules only after both real store controls explicitly disable collection while analysis stays active',()=>{
    const state=prepareAutomationAdmission('admission-disabled');
    for(const [index,store] of state.records.entries()){
      const {context}=state.coordinator.switchStore({storeId:store.storeId,marketplace:'US'});
      const written=state.automation.set(context,{expectedRevision:0,automaticCollectionEnabled:false});
      expect(state.automation.get(context)).toEqual(written);
      expect(written).toMatchObject({storeId:store.storeId,browserProfileId:store.browserProfileId,
        automaticCollectionEnabled:false,source:'explicit-override',revision:1});
      expect(state.configs.get(context).current).toMatchObject({status:'active',revision:1,values:state.values});
      expect(runtime.requireStoreRuntimeAnalysisConfig(runtime.DEFAULT_RULE_CONFIG,state.configs.get(context)))
        .toMatchObject({storeId:store.storeId,configRevision:1,values:state.values});
      expect(admission.inspectQuiescentDatabase(database,'isolated-software-fixture').activeSchedules).toHaveLength(1-index);
    }
    const observed=admission.inspectQuiescentDatabase(database,'real-data-copy');
    expect(observed.configuredActiveKeys).toHaveLength(2); expect(observed.activeSchedules).toEqual([]);
    expect(database.prepare('SELECT COUNT(*) count FROM store_connections').get().count).toBe(0);
  });
  it('rejects corrupt or other-store and other-profile collection overrides before native admission',()=>{
    const state=prepareAutomationAdmission('admission-corrupt');
    for(const store of state.records){const {context}=state.coordinator.switchStore({storeId:store.storeId,marketplace:'US'});
      state.automation.set(context,{expectedRevision:0,automaticCollectionEnabled:false});}
    const store=state.records[0],key=automationControls.storeCollectionAutomationSettingKey(store.storeId);
    const original=state.bus.get(key),record=JSON.parse(original);
    const damaged=['','bad-json',JSON.stringify({...record,storeId:state.records[1].storeId}),
      JSON.stringify({...record,browserProfileId:state.records[1].browserProfileId}),JSON.stringify({...record,revision:0}),
      JSON.stringify({...record,automaticCollectionEnabled:'false'}),JSON.stringify({...record,extra:true})];
    // 故意损坏持久原件验证准入拒绝，正常配置写入始终经正式服务。
    try{for(const raw of damaged){database.prepare('UPDATE app_settings SET value=? WHERE key=?').run(raw,key);
      expect(()=>admission.inspectQuiescentDatabase(database,'isolated-software-fixture')).toThrow();
      expect(()=>admission.inspectQuiescentDatabase(database,'real-data-copy')).toThrow();}}
    finally{database.prepare('UPDATE app_settings SET value=? WHERE key=?').run(original,key);}
    expect(admission.inspectQuiescentDatabase(database,'isolated-software-fixture').activeSchedules).toEqual([]);
  });

  it('refuses enabled or unknown AI config when explicit collection controls otherwise remove every active schedule',()=>{
    const state=prepareAutomationAdmission('admission-ai-disabled');
    for(const store of state.records){const {context}=state.coordinator.switchStore({storeId:store.storeId,marketplace:'US'});
      state.automation.set(context,{expectedRevision:0,automaticCollectionEnabled:false});}
    expect(state.records.map(store=>state.automation.getForStoreRecord(store).automaticCollectionEnabled)).toEqual([false,false]);
    const store=state.records[0],{context}=state.coordinator.switchStore({storeId:store.storeId,marketplace:'US'});
    const updated=state.configs.update(context,{expectedRevision:1,patch:{aiRecommendationsEnabled:true}});
    expect(updated.current).toMatchObject({status:'active',revision:2,values:{aiRecommendationsEnabled:true}});
    const config=database.prepare("SELECT key,value FROM app_settings WHERE key LIKE 'store_runtime_config:v1:%'").all()
      .find(row=>JSON.parse(row.value).current.storeId===store.storeId);
    const classifications=['real-data-copy','isolated-software-fixture'];
    // 仅放入明确无效的非秘密标记；测试不启动应用，也不批准或调用 AI。
    database.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('ai_api_key','INVALID_NON_SECRET_TEST_MARKER');
    try{
      for(const classification of classifications) expect(()=>admission.inspectQuiescentDatabase(database,classification))
        .toThrow('NFR_PRELAUNCH_DISABLED_COLLECTION_REQUIRES_AI_DISABLED');
      for(const unknown of [undefined,null,'false']){
        const damaged=JSON.parse(config.value);damaged.current.values.aiRecommendationsEnabled=unknown;
        database.prepare('UPDATE app_settings SET value=? WHERE key=?').run(JSON.stringify(damaged),config.key);
        for(const classification of classifications) expect(()=>admission.inspectQuiescentDatabase(database,classification))
          .toThrow('NFR_PRELAUNCH_DISABLED_COLLECTION_REQUIRES_AI_DISABLED');
      }
    }finally{database.prepare('UPDATE app_settings SET value=? WHERE key=?').run(config.value,config.key);
      database.prepare('DELETE FROM app_settings WHERE key=?').run('ai_api_key');}
  });

});
