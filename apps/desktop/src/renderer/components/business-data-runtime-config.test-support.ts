import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const viteRequire = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'));
const sourceRoot = path.join(root, 'apps/desktop/src/renderer');
const old = path.join(sourceRoot, 'components/business-data.tsx');
const selected = process.env.V16_BUSINESS_PIPELINE_IMPLEMENTATION ?? old;
const stagedComponents = path.dirname(fileURLToPath(import.meta.url));
const stagedRenderer = path.dirname(stagedComponents);
const sharedProjection = process.env.V16_STORE_RUNTIME_PROJECTION_MODULE ?? path.join(sourceRoot, 'store-runtime-config-projection.ts');

export function normalizedConfigurationWarningContext(context: Record<string, unknown>) {
  return require(path.join(root, 'packages/shared-types/src/runtime-log-format.cjs'))
    .createRuntimeLogRecord('warn', 'business_data_unavailable', context).context;
}

function receipt(file: string, role: string, contents: string) {
  if (!process.env.V16_BUSINESS_PIPELINE_RESOLUTION_LOG) return;
  fs.appendFileSync(process.env.V16_BUSINESS_PIPELINE_RESOLUTION_LOG, JSON.stringify({
    timestamp: new Date().toISOString(), role, path: file,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    transformInputSha256: crypto.createHash('sha256').update(contents).digest('hex'),
  }) + '\n');
}

export async function openBusinessPipelineFixture(options: Record<string, unknown> = {}) {
  const result = await viteRequire('esbuild').build({
    stdin: { contents: fixture, loader: 'tsx', resolveDir: sourceRoot }, bundle: true, write: false,
    platform: 'browser', format: 'iife', loader: { '.css': 'empty' }, jsx: 'automatic',
    nodePaths: [path.join(root, 'apps/desktop/node_modules')],
    alias: { '@amazon-ai-ops/shared-types/src/v16-api': path.join(root, 'packages/shared-types/src/v16-api.ts'),
      '@amazon-ai-ops/shared-types': path.join(root, 'packages/shared-types/src/index.ts') },
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'business-pipeline-exact-owned-overlay', setup(build: any) {
      build.onResolve({ filter: /^\./ }, (args: any) => {
        const resolved = path.resolve(args.resolveDir, args.path);
        if (resolved === old.slice(0, -4)) return { path: selected };
        if (resolved.endsWith(path.join('components', 'business-data-configuration'))) return { path: path.join(stagedComponents, 'business-data-configuration.tsx') };
        if (resolved === path.join(stagedRenderer, 'store-runtime-config-projection')) return { path: sharedProjection };
        if (args.importer.startsWith(stagedRenderer + path.sep)) {
          const target = path.join(sourceRoot, path.relative(stagedRenderer, resolved));
          const file = [target, target + '.ts', target + '.tsx', path.join(target, 'index.ts'), path.join(target, 'index.tsx')].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
          if (!file) throw new Error('OWNED_OVERLAY_IMPORT_NOT_FOUND:' + target);
          return { path: file };
        }
        return undefined;
      });
      build.onLoad({ filter: /business-data\.tsx$/ }, (args: any) => {
        if (path.resolve(args.path) !== path.resolve(selected)) throw new Error('UNSELECTED_BUSINESS_PIPELINE_MODULE_LOADED');
        const contents = fs.readFileSync(args.path, 'utf8');
        receipt(args.path, 'actual-esbuild-hook-load', contents);
        return { contents, loader: 'tsx' };
      });
      build.onLoad({ filter: /store-runtime-config-projection\.ts$/ }, (args: any) => {
        const contents = fs.readFileSync(args.path, 'utf8');
        receipt(args.path, 'actual-esbuild-projection-load', contents);
        return { contents, loader: 'ts' };
      });
    } }],
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5_000);
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: 'window.businessPipelineFixtureOptions=' + JSON.stringify(options) + ';\n' + result.outputFiles[0].text });
    return { browser, page };
  } catch (error) { await browser.close(); throw error; }
}

export async function withBusinessPipelineFixture(options: Record<string, unknown>, run: (page: Page) => Promise<void>) {
  let browser: Browser | undefined;
  try {
    const opened = await openBusinessPipelineFixture(options);
    browser = opened.browser;
    if (!options.noAuthority) await opened.page.locator('#authority').filter({ hasText: 'software-only-A/1' }).waitFor();
    await run(opened.page);
  } finally { await browser?.close(); }
}

const fixture = String.raw`
import React from 'react';import{createRoot}from'react-dom/client';
import{useBusinessDataPipeline}from'./components/business-data';
import{BusinessDataConfigurationGuard}from'./components/business-data-configuration';
import{MissionControlStoreContextProvider,useMissionControlStoreContext}from'./mission-control/store-context';
import{useScopeStore}from'./scope-store';
const options=window.businessPipelineFixtureOptions||{};
let store='software-only-A',generation=1,configMode=options.configMode||'empty',pipelineMode=options.pipelineMode||'ready',renderCount=0;
const listeners=[],configReads=[],pipelineReads=[],eventReads=[],logs=[],navigations=[];
const context=()=>({storeId:store,browserProfileId:'software-only-profile-'+store,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-17',sessionGeneration:generation});
const record=id=>({storeId:id,displayName:'隔离软件夹具（无真实授权）',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',browserProfileId:'software-only-profile-'+id,status:'active',revision:1,createdAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:00:00.000Z'});
const view=()=>({store:record(store),context:context(),connections:[],sessions:[]});
const authorityApi={listStores:async()=>[record('software-only-A'),record('software-only-B')],listStoreDailyStatuses:async()=>({stores:[],generatedAt:'2026-10-17T00:00:00.000Z'}),getActiveStoreWorkspaceView:async()=>options.noAuthority?null:view(),onStoreContextChanged:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},onStoresChanged:()=>()=>{}};
function projection(ctx,mode){
 if(mode==='empty')return{current:null,versions:[]};
 if(mode==='malformed')return{versions:[]};
 const current={configId:'software-only-config',...ctx,status:mode==='archived'?'archived':'active',revision:1,values:{aiRecommendationsEnabled:false,collectionScheduleLocalTime:'06:00',collectionLookbackDays:7,analysisWindowDays:30,defaultTargetAcosPercent:30,minimumRecommendationConfidencePercent:70,evidenceRetentionDays:30},createdAt:'2026-10-17T00:00:00.000Z',updatedAt:'2026-10-17T00:00:00.000Z'};
 if(mode==='cross-store')current.storeId='software-only-other';
 const result={current,versions:[{revision:1,action:'create',occurredAt:'2026-10-17T00:00:00.000Z',snapshot:{...current}}]};
 if(mode==='empty-history')result.current=null;
 return result;
}
const pipeline=scope=>({scope,generatedAt:'2026-10-17T00:00:00.000Z',collection:{status:'blocked',latestBatch:null,sourceBatchIds:[],availableBatches:[],reportOptions:[],realReportFiles:[],fileAudit:{importedRowCount:7}},quant:{hasImportedMetrics:false,importedRows:7,totalSpend:12},operations:{events:[],eventCount:0,notes:['software-only-real-hook-result']},productContext:{products:[],productCount:0,notes:[]}});
window.electronAPI={
 getStoreRuntimeConfig:ctx=>new Promise((resolve,reject)=>{const call={context:ctx,resolve,reject};configReads.push(call);if(configMode==='deferred')return;if(configMode==='reject'){reject(new Error('CONFIG_GET_REJECTED'));return;}resolve(projection(ctx,configMode));}),
 getBusinessUiDataPipeline:scope=>new Promise((resolve,reject)=>{pipelineReads.push({scope,resolve,reject});if(pipelineMode==='deferred')return;if(pipelineMode==='reject'){reject(Object.assign(new Error('PIPELINE_MISSING_AFTER_VALID_CONFIG'),{code:'MISSING'}));return;}resolve(pipeline(scope));}),
 listOperationEvents:async scope=>{eventReads.push(scope);return[{id:1,title:'隔离事件'}];},
 reportRuntimeLog:async row=>{logs.push(row);}
};
if(options.missingGetter)delete window.electronAPI.getStoreRuntimeConfig;
const scope={dateFrom:'2026-10-04',dateTo:'2026-10-17',storeName:'隔离软件夹具（无真实授权）',marketplaceCode:'US',currency:'USD',asin:options.asin||undefined,batchId:'software-only-batch'};
useScopeStore.getState().setScope(scope);
window.addEventListener('amazon-ai-ops:navigate',event=>navigations.push(event.detail));
function Probe(){const authority=useMissionControlStoreContext();const value=useBusinessDataPipeline({mode:options.mode||'scope'});renderCount++;window.businessPipelineFixture.latest={data:value.data,error:value.error,loading:value.loading,configurationRequired:value.configurationRequired};return <><output id="authority">{authority.authoritativeContext?.storeId}/{authority.authoritativeContext?.sessionGeneration}</output><output id="state">{JSON.stringify(window.businessPipelineFixture.latest)}</output><button onClick={value.reload}>刷新业务范围</button><BusinessDataConfigurationGuard configurationRequired={value.configurationRequired}><output id="pipeline-data">{value.data?'业务已读':'业务未读'}</output></BusinessDataConfigurationGuard></>;}
window.businessPipelineFixture={latest:null,configReads,pipelineReads,eventReads,logs,navigations,scope,context,projection,pipeline,counts:()=>({config:configReads.length,pipeline:pipelineReads.length,events:eventReads.length,renders:renderCount}),setConfigMode:mode=>{configMode=mode;},broadcast:()=>window.dispatchEvent(new CustomEvent('business-ui:data-updated')),select:(id,nextGeneration)=>{store=id;generation=nextGeneration;listeners.forEach(fn=>fn(view()));},completeConfig:(index,mode)=>configReads[index].resolve(projection(configReads[index].context,mode)),completePipeline:index=>pipelineReads[index].resolve(pipeline(pipelineReads[index].scope))};
createRoot(document.getElementById('root')).render(<MissionControlStoreContextProvider api={authorityApi}><Probe/></MissionControlStoreContextProvider>);
`;
