import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import observe from './v16-performance-observe.js';
import business from './v16-performance-business.js';
import artifacts from './v16-performance-artifacts.js';
import { BROWSER_LIFECYCLE_BUDGET, ownBrowserServer } from './v16-performance-observe.test-support.mjs';

const require=createRequire(import.meta.url), {chromium}=require('./playwright-loader.js');
let browser,ownedBrowser,pages=[],directories=[];
beforeAll(async()=>{
  const server=await chromium.launchServer({headless:true,timeout:BROWSER_LIFECYCLE_BUDGET.launchMs});
  ownedBrowser=ownBrowserServer(server);
  browser=await chromium.connect(server.wsEndpoint(),{timeout:BROWSER_LIFECYCLE_BUDGET.connectMs});
},BROWSER_LIFECYCLE_BUDGET.setupHookMs);
afterEach(async()=>{ await Promise.all(pages.splice(0).map(page=>page.close())); for(const directory of directories.splice(0)) fs.rmSync(directory,{recursive:true,force:true}); });
afterAll(async()=>{ await ownedBrowser?.close(); },BROWSER_LIFECYCLE_BUDGET.teardownHookMs);
const context={storeId:'A',browserProfileId:'profile-A',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1};
const fixture={fixture:'typical',classification:'isolated-software-fixture',storeIds:['A','B'],scope:{dateFrom:'2026-10-01',dateTo:'2026-10-07',marketplaceCode:'US'},volume:{minimumImportedRows:8},analysisMissionIds:['mission-a'],aiMissionIds:['mission-ai'],importBatchIds:['batch-a']};
async function pageForDriver() {
  const page=await browser.newPage(); pages.push(page); page.nfrOperationTimeoutMs=2000;
  await page.setContent('<nav class="app-sidebar"><button data-operator-module="tasks">任务</button><button data-operator-entry="today/overview">今日</button><button data-operator-entry="objects/keywords">关键词</button></nav><div data-authority-key="A|profile-A|US|USD|America/Los_Angeles|2026-10-16|1"></div><main data-workspace-evidence-root data-workspace="today" data-workspace-subview="overview">当前真实浏览器夹具</main>');
  await page.evaluate(({context})=>{
    window.context=context; window.analysisCalls=0; window.importCalls=0;
    window.electronAPI={
      getActiveStoreWorkspaceView:async()=>({context:window.context,store:{storeId:window.context.storeId,displayName:'测试店铺'}}),
      switchStore:async({storeId})=>{
        await new Promise(resolve=>setTimeout(resolve,20)); window.context={...window.context,storeId,browserProfileId:'profile-'+storeId};
        document.querySelector('[data-authority-key]').setAttribute('data-authority-key',[window.context.storeId,window.context.browserProfileId,'US','USD','America/Los_Angeles','2026-10-16',1].join('|'));
        return {context:window.context,store:{storeId}};
      },
      getSettings:async()=>({aiKeyConfigured:Boolean(window.aiConfigured)}),
      missionDomain:{policyRuntime:{get:async()=>({mode:window.autonomyMode??'manual_approval',activePolicyVersionId:window.activePolicy})}},
      importCurrentBusinessReports:async input=>{
        window.importCalls++; await new Promise(resolve=>setTimeout(resolve,20));
        return {batch:{id:input.batchId},files:Array.from({length:8},(_,i)=>({reportType:'type-'+i})),metricsImport:{errors:[],parsedFiles:8,deduplicated:Boolean(window.deduplicated),inserted:8,importRunIds:['import-a']}};
      },
      v16:{
        missionList:async()=>({success:true,data:[{id:'mission-a'}]}),
        grantList:async()=>({success:true,data:[]}), executionListBatches:async()=>({success:true,data:[]}),
        aiSpendGet:async()=>({success:true,data:{records:[],unknownCount:0}}),
        analysisRun:async request=>{
          window.analysisCalls++; await new Promise(resolve=>setTimeout(resolve,20));
          return {success:true,data:{analysisRun:{runId:'actual-driver-fixture-run'},evidencePackage:{storeId:'A',missionId:request.input.missionId,reportTypes:Array.from({length:8},(_,i)=>'type-'+i),metricRowCount:8,dateFrom:'2026-10-01',dateTo:'2026-10-07'},ai:{configured:false,invoked:false,source:'rule_fallback',detail:'隔离软件规则链'}}};
        },
      },
    };
    for(const button of document.querySelectorAll('[data-operator-entry]')) button.onclick=()=>{
      const [workspace,subview]=button.getAttribute('data-operator-entry').split('/');
      const root=document.querySelector('main'); root.setAttribute('aria-busy','true');
      setTimeout(()=>{root.dataset.workspace=workspace;root.dataset.workspaceSubview=subview;root.textContent=workspace+' 的可读投影';root.removeAttribute('aria-busy');},20);
    };
  },{context});
  return page;
}

describe('NFR observation driver isolated Chromium software tests',()=>{
  it('measures real elapsed UI navigation and rejects a same-entry noop',async()=>{
    const page=await pageForDriver();
    const result=await observe.measureNavigation(page,{workspace:'objects',subview:'keywords',module:'tasks'},2000);
    expect(result.elapsedMs).toBeGreaterThan(0); expect(Date.parse(result.finishedAt)).toBeGreaterThanOrEqual(Date.parse(result.startedAt));
    await expect(observe.measureNavigation(page,{workspace:'objects',subview:'keywords',module:'tasks'},2000)).rejects.toThrow('NFR_NAVIGATION_SAME_ENTRY_NOOP');
  });
  it('starts timing before a real module button begins its default-entry navigation',async()=>{
    const page=await pageForDriver();
    await page.evaluate(()=>{
      const entry=document.querySelector('[data-operator-entry="objects/keywords"]'); entry.style.display='none';
      document.querySelector('[data-operator-module]').onclick=()=>{
        entry.style.display=''; entry.disabled=true;
        const root=document.querySelector('main'); root.setAttribute('aria-busy','true');
        setTimeout(()=>{root.dataset.workspace='objects';root.dataset.workspaceSubview='keywords';root.removeAttribute('aria-busy');entry.disabled=false;},100);
      };
    });
    const result=await observe.measureNavigation(page,{workspace:'objects',subview:'keywords',module:'tasks'},2000);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(80);
  });
  it('measures the actual Main bridge completion plus current authority projection',async()=>{
    const page=await pageForDriver();
    const result=await observe.measureStoreSwitch(page,fixture,2000);
    expect(result.before.storeId).toBe('A'); expect(result.after.storeId).toBe('B'); expect(result.elapsedMs).toBeGreaterThan(0);
    await expect(observe.currentStore(page,{storeIds:['A']})).rejects.toThrow('NFR_CURRENT_FIXTURE_STORE_REQUIRED');
  });
  it('measures an actual scrollable table interaction rather than receiving a virtualizer timing number',async()=>{
    const page=await pageForDriver();
    await page.locator('main').evaluate(root=>{root.innerHTML='<div id="table" aria-rowcount="100" style="height:200px;overflow:auto">'+Array.from({length:100},(_,i)=>'<div role="row" style="height:40px">row '+i+'</div>').join('')+'</div>';});
    const result=await observe.measureLongTable(page,'#table',100);
    expect(result.elapsedMs).toBeGreaterThan(0); expect(result.after.scrollTop).toBeGreaterThan(result.before.scrollTop);
    await expect(observe.measureLongTable(page,'#table',101)).rejects.toThrow('NFR_ACTUAL_LONG_TABLE_VOLUME_NOT_OBSERVED');
  });
  it('uses fixed IPC names and preserves a genuine bridge rejection',async()=>{
    const page=await pageForDriver();
    await expect(observe.fixedIpc(page,'execute-ad',{})).rejects.toThrow('NFR_FIXED_IPC_OPERATION_REQUIRED');
    await page.evaluate(()=>{window.electronAPI.getSettings=async()=>{throw new Error('ORIGINAL_MAIN_FAILURE');};});
    await expect(observe.fixedIpc(page,'settings')).rejects.toThrow('ORIGINAL_MAIN_FAILURE');
  });
  it('marks a hung IPC as fatal so the collector closes the owning runtime before proceeding',async()=>{
    const page=await pageForDriver(); page.nfrOperationTimeoutMs=25;
    await page.evaluate(()=>{window.electronAPI.getSettings=()=>new Promise(()=>{});});
    await expect(observe.fixedIpc(page,'settings')).rejects.toMatchObject({message:'NFR_OPERATION_TIMEOUT:settings',fatal:true});
  });
  it('measures the complete eight-file import and refuses a cached deduplicated result',async()=>{
    const page=await pageForDriver(), runtime={page};
    const result=await business.measureImport(runtime,fixture,{},0);
    expect(result.elapsedMs).toBeGreaterThan(0); expect(result.receipt.parsedFiles).toBe(8);
    await page.evaluate(()=>{window.deduplicated=true;});
    await expect(business.measureImport(runtime,fixture,{},0)).rejects.toThrow('NFR_ACTUAL_EXACT_EIGHT_IMPORT_NOT_OBSERVED');
  });
  it('measures a rules-only analysis through the fixed production bridge without an AI spend',async()=>{
    const page=await pageForDriver();
    const result=await business.measureAnalysis({page},fixture,{},0,'analysis',{calls:0,costMicrousd:0});
    expect(result.elapsedMs).toBeGreaterThan(0); expect(result.ai).toBeUndefined(); expect(await page.evaluate(()=>window.analysisCalls)).toBe(1);
  });
  it('fails before a configured AI call if its specific original approval is missing',async()=>{
    const page=await pageForDriver(); await page.evaluate(()=>{window.aiConfigured=true;});
    await expect(business.measureAnalysis({page},fixture,{},0,'ai',{calls:0,costMicrousd:0})).rejects.toThrow('NFR_ARTIFACT_DIGEST_REQUIRED');
    expect(await page.evaluate(()=>window.analysisCalls)).toBe(0);
  });
  it('refuses policy-auto analysis before invocation and detects unexpected grant side effects',async()=>{
    const page=await pageForDriver(); await page.evaluate(()=>{window.autonomyMode='policy_auto';});
    await expect(business.measureAnalysis({page},fixture,{},0,'analysis',{calls:0,costMicrousd:0})).rejects.toThrow('NFR_ANALYSIS_AUTOMATIC_AUTHORITY_MUST_BE_DISABLED');
    expect(await page.evaluate(()=>window.analysisCalls)).toBe(0);
    await page.evaluate(()=>{window.autonomyMode='manual_approval';window.electronAPI.v16.grantList=async()=>({success:true,data:window.analysisCalls?[{id:'unexpected'}]:[]});});
    await expect(business.measureAnalysis({page},fixture,{},0,'analysis',{calls:0,costMicrousd:0})).rejects.toThrow('NFR_ANALYSIS_AUTHORITY_OR_EXECUTION_SIDE_EFFECT');
  });
  it('times independent real bridge cancel and local import recovery states rather than pretending they are one job',async()=>{
    const page=await pageForDriver();
    await page.evaluate(()=>{
      const types=Array.from({length:8},(_,i)=>'report-'+i), request=(id)=>({requestId:id+'-request',storeContext:window.context,mode:'create-and-download',reportTypes:types});
      window.jobs=[{jobId:'cancel-job',request:request('cancel-job'),state:'queued',reports:types.map(reportType=>({reportType,state:'downloaded'}))},
        {jobId:'resume-job',request:request('resume-job'),state:'completed',importState:'pending',reports:types.map(reportType=>({reportType,state:'downloaded'}))}];
      window.electronAPI.listLingxingCollectionJobs=async()=>window.jobs;
      window.electronAPI.cancelLingxingCollection=async input=>{await new Promise(resolve=>setTimeout(resolve,20));window.jobs.find(job=>job.jobId===input.jobId).state='cancelled';return{cancelled:true};};
      window.electronAPI.resumeLingxingCollection=async input=>{await new Promise(resolve=>setTimeout(resolve,20));window.jobs.find(job=>job.jobId===input.jobId).importState='succeeded';return{importRecovered:true};};
    });
    const markers={downloadedOnly:true,syntheticProviderMetadata:true,formalAcceptance:false};
    const value={...fixture,collectionJobs:[{cancel:{jobId:'cancel-job',requestId:'cancel-job-request',...markers},resume:{jobId:'resume-job',requestId:'resume-job-request',...markers}}]};
    const cancelled=await business.measureCollectionControl({page},value,{},0,'cancel');
    const resumed=await business.measureCollectionControl({page},value,{},0,'resume');
    expect(cancelled.elapsedMs).toBeGreaterThan(0); expect(resumed.elapsedMs).toBeGreaterThan(0);
    expect(cancelled.receipt.jobId).not.toBe(resumed.receipt.jobId); expect(resumed.definition).toBe('local-durable-download-recovery');
    expect(resumed.receipt.importState).toBe('succeeded');
    await expect(business.measureCollectionControl({page},value,{},0,'cancel')).rejects.toThrow('NFR_COLLECTION_CONTROL_SOURCE_STATE_INVALID');
  });
  it('refuses incomplete downloaded-only inputs before external resume can be reached',async()=>{
    const page=await pageForDriver();
    await page.evaluate(()=>{window.controlCalls=0;window.electronAPI.listLingxingCollectionJobs=async()=>[{jobId:'job',request:{requestId:'request',storeContext:window.context,mode:'download-existing',reportTypes:['keyword']},state:'completed',importState:'pending',reports:[{reportType:'keyword',state:'downloaded'}]}];
      window.electronAPI.resumeLingxingCollection=async()=>{window.controlCalls++;};});
    await expect(business.measureCollectionControl({page},{...fixture,collectionJobs:[{jobId:'job',requestId:'request',downloadedOnly:true}]},{},0,'resume')).rejects.toThrow('NFR_LOCAL_RECOVERY_REQUIRES_ALL_EIGHT_DOWNLOADED_REPORTS');
    expect(await page.evaluate(()=>window.controlCalls)).toBe(0);
  });
  it('locks the paid chain before awaiting analysis so an IPC failure cannot erase already charged work',async()=>{
    const page=await pageForDriver(), directory=fs.mkdtempSync(path.join(os.tmpdir(),'nfr-paid-lock-')); directories.push(directory);
    const writer=artifacts.createArtifactWriter(path.join(directory,'originals'));
    const value={...fixture,sourceSha256:'a'.repeat(64),aiAuthorization:writer.json('approval.json',{
      kind:'v16-nfr-operation-authorization',schemaVersion:1,status:'approved',approver:'software-test-only',
      approvedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),
      sourceSha256:'a'.repeat(64),packageIdentity:{},fixture:'typical',storeIds:['A','B'],actions:['paid-ai'],
      prohibitsAdsWrites:true,prohibitsAuthorityIssuance:true,aiStoreId:'A',policyRevision:1,maximumCostMicrousd:100})};
    await page.evaluate(()=>{
      window.aiConfigured=true;
      window.electronAPI.listAiCallLogs=async()=>[];
      window.electronAPI.v16.aiSpendGet=async()=>({success:true,data:{records:[],unknownCount:0,remainingMicrousd:100,
        policy:{enabled:true,revision:1,storeId:'A',contextTokenLimit:1000,outputTokenLimit:1000,inputMicrousdPerMillion:1000,outputMicrousdPerMillion:1000,
          windowStartsAt:new Date(Date.now()-60000).toISOString(),windowEndsAt:new Date(Date.now()+60000).toISOString()}}});
      window.electronAPI.v16.analysisRun=async()=>{window.analysisCalls++;throw new Error('ORIGINAL_AFTER_SUBMISSION_FAILURE');};
    });
    const counters={calls:0,costMicrousd:0};
    await expect(business.measureAnalysis({page},value,{packageIdentity:{}},0,'ai',counters)).rejects.toThrow('ORIGINAL_AFTER_SUBMISSION_FAILURE');
    expect(counters).toEqual({calls:Infinity,costMicrousd:Infinity});
    await expect(business.measureAnalysis({page},value,{packageIdentity:{}},0,'ai',counters)).rejects.toThrow('NFR_AI_COST_UNKNOWN_OR_CAP_EXHAUSTED');
    expect(await page.evaluate(()=>window.analysisCalls)).toBe(1);
    await page.evaluate(()=>{
      window.analysisCalls=0;
      const originalSpend=window.electronAPI.v16.aiSpendGet;
      window.electronAPI.v16.aiSpendGet=async()=>{
        const result=await originalSpend();
        if(window.analysisCalls) result.data.records=[{id:'software-driver-cost',storeContext:window.context,status:'succeeded',policyRevision:1,
          startedAt:window.paidStartedAt,endedAt:window.paidEndedAt,usage:{promptTokens:4,completionTokens:6,totalTokens:10},costStatus:'reported',costMicrousd:10}];
        return result;
      };
      window.electronAPI.v16.analysisRun=async request=>{window.paidStartedAt=new Date().toISOString();window.analysisCalls++;await new Promise(resolve=>setTimeout(resolve,20));window.paidEndedAt=new Date().toISOString();return {success:true,data:{analysisRun:{status:'done'},evidencePackage:{storeId:'A',missionId:request.input.missionId,reportTypes:Array.from({length:8},(_,i)=>'type-'+i),metricRowCount:8,dateFrom:'2026-10-01',dateTo:'2026-10-07'},ai:{configured:true,invoked:true,source:'ai'}}};};
    });
    const successfulCounters={calls:0,costMicrousd:0};
    const measured=await business.measureAnalysis({page},value,{packageIdentity:{}},0,'ai',successfulCounters);
    expect(measured.ai).toMatchObject({calls:1,tokens:10,costMicrousd:10});
    expect(successfulCounters).toEqual({calls:1,costMicrousd:10});
  });
});

describe('NFR observation browser ownership cleanup',()=>{
  function controlledServer({close,kill,log}={}) {
    const child=new EventEmitter(); child.pid=12345;
    const finish=()=>{child.emit('exit',0,null);child.emit('close',0,null);};
    let closeCalls=0,killCalls=0;
    const server={process:()=>child,
      close:async()=>{closeCalls++;return close?close(finish):finish();},
      kill:async()=>{killCalls++;return kill?kill(finish):finish();}};
    const events=[],owned=ownBrowserServer(server,{log:log??((event,context)=>events.push({event,context}))});
    return {child,finish,events,owned,calls:()=>({closeCalls,killCalls})};
  }
  it('waits for the owned child close event after the graceful method resolves',async()=>{
    const value=controlledServer({close:finish=>{setTimeout(finish,25);}});
    let settled=false;
    const closing=value.owned.close({gracefulMs:200,forcedMs:50}).then(()=>{settled=true;});
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(settled).toBe(false); expect(value.owned.receipt.closeObserved).toBe(false);
    await closing;
    expect(value.owned.receipt).toMatchObject({exitObserved:true,closeObserved:true,exitCode:0,closeCode:0});
    expect(value.calls()).toEqual({closeCalls:1,killCalls:0});
    expect(value.child.listenerCount('close')).toBe(0); expect(value.child.listenerCount('exit')).toBe(0);
  });
  it('fails a hung graceful close even after its owned forced cleanup succeeds',async()=>{
    const value=controlledServer({close:()=>new Promise(()=>{})});
    await expect(value.owned.close({gracefulMs:10,forcedMs:50})).rejects.toThrow('NFR_TEST_BROWSER_GRACEFUL_CLOSE_TIMEOUT');
    expect(value.calls()).toEqual({closeCalls:1,killCalls:1});
    expect(value.owned.receipt.closeObserved).toBe(true);
    expect(value.events.map(item=>item.event)).toContain('software.browser_forced_cleanup_completed');
  });
  it('preserves the original close rejection and a separate cleanup failure',async()=>{
    const primary=new Error('ORIGINAL_CLOSE_FAILURE'),secondary=new Error('ORIGINAL_KILL_FAILURE');
    const value=controlledServer({close:()=>{throw primary;},kill:()=>{throw secondary;}});
    const error=await value.owned.close({gracefulMs:50,forcedMs:50}).catch(error=>error);
    expect(error).toBeInstanceOf(AggregateError); expect(error.errors).toEqual([primary,secondary]);
    expect(value.calls()).toEqual({closeCalls:1,killCalls:1});
  });
  it('refuses successful cleanup when the owning child has not closed',async()=>{
    const value=controlledServer({close:()=>{},kill:()=>{}});
    const error=await value.owned.close({gracefulMs:10,forcedMs:10}).catch(error=>error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map(item=>item.message)).toEqual(['NFR_TEST_BROWSER_GRACEFUL_CLOSE_TIMEOUT','NFR_TEST_BROWSER_FORCED_CLOSE_TIMEOUT']);
    expect(value.owned.receipt.closeObserved).toBe(false);
  });
  it('does not swallow a graceful rejection when cleanup really closes the child',async()=>{
    const primary=new Error('ORIGINAL_GRACEFUL_FAILURE');
    const value=controlledServer({close:()=>{throw primary;}});
    await expect(value.owned.close({gracefulMs:50,forcedMs:50})).rejects.toBe(primary);
    expect(value.owned.receipt.closeObserved).toBe(true);
  });
  it('shares one cleanup attempt when teardown is invoked twice',async()=>{
    const value=controlledServer();
    const first=value.owned.close(),second=value.owned.close();
    expect(second).toBe(first); await first;
    expect(value.calls()).toEqual({closeCalls:1,killCalls:0});
  });
  it('reaps its actual Chromium child after an injected graceful-close stall while preserving the failure',async()=>{
    const server=await chromium.launchServer({headless:true,timeout:BROWSER_LIFECYCLE_BUDGET.launchMs});
    const owned=ownBrowserServer({process:()=>server.process(),close:()=>new Promise(()=>{}),kill:()=>server.kill()});
    await expect(owned.close({gracefulMs:20,forcedMs:BROWSER_LIFECYCLE_BUDGET.forcedMs})).rejects.toThrow('NFR_TEST_BROWSER_GRACEFUL_CLOSE_TIMEOUT');
    expect(owned.receipt).toMatchObject({exitObserved:true,closeObserved:true});
    expect(server.process().exitCode!==null || server.process().signalCode!==null).toBe(true);
  },BROWSER_LIFECYCLE_BUDGET.launchMs+BROWSER_LIFECYCLE_BUDGET.forcedMs+5_000);
  it('preserves cleanup and its original failure when both lifecycle logging and stderr throw',async()=>{
    const originalWrite=process.stderr.write,primary=new Error('ORIGINAL_CLEANUP_FAILURE_WITHOUT_LOG_OUTPUT');
    try {
      process.stderr.write=()=>{throw new Error('STDERR_UNAVAILABLE');};
      const value=controlledServer({close:()=>{throw primary;},log:()=>{throw new Error('LIFECYCLE_LOG_UNAVAILABLE');}});
      await expect(value.owned.close({gracefulMs:50,forcedMs:50})).rejects.toBe(primary);
      expect(value.calls()).toEqual({closeCalls:1,killCalls:1});
      expect(value.owned.receipt).toMatchObject({exitObserved:true,closeObserved:true});
      expect(value.child.listenerCount('close')).toBe(0); expect(value.child.listenerCount('exit')).toBe(0);
    } finally {
      process.stderr.write=originalWrite;
    }
    expect(process.stderr.write).toBe(originalWrite);
  });
});
