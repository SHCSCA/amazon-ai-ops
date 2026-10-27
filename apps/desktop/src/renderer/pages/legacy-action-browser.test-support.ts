export function legacyActionFixture(page: 'product' | 'scope' | 'events' | 'scheduler', withAsin = true): string {
  return String.raw`
import React from 'react'; import { createRoot } from 'react-dom/client';
import { ProductManagementPage } from '../../pages/product-management-page';
import { OperationScopePage } from '../../pages/operation-scope-page';
import { OperationEventsPage } from '../../pages/operation-events-page';
import { SchedulerPage, STORE_AUTOMATION_CAPABILITY_IDS } from '../../pages/scheduler-page';
import { MissionControlStoreContextProvider, useMissionControlStoreContext } from '../store-context';
import { DEFAULT_BUSINESS_REPORT_OPTIONS } from '../../components/business-data';
import { useScopeStore } from '../../scope-store';
let current='A', generation=1, retentionHeld=false, eventsHeld=false, planHeld=false;
const calls={product:[],scope:[],event:[],archive:[],run:[],retention:[],eventRead:[],planRead:[]},listeners=[],routes=[];
const ctx=()=>({storeId:current,browserProfileId:'profile-'+current,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:generation});
const record=id=>({storeId:id,displayName:'店铺'+id,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',browserProfileId:'profile-'+id,status:'active',revision:1,createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z'});
const view=()=>({store:record(current),context:ctx(),connections:[],sessions:[]});
const provider={listStores:async()=>[record('A'),record('B')],listStoreDailyStatuses:async()=>({stores:[],generatedAt:'2026-10-16T12:00:00.000Z'}),getActiveStoreWorkspaceView:async()=>view(),onStoreContextChanged:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},onStoresChanged:()=>()=>{}};
const product=()=>({asin:'B000000001',title:'产品'+current,msku:'sku-'+current,sku:'sku-'+current,storeName:'店铺'+current,marketplaceCode:'US',productStage:'cold_start',status:'active'});
const event=()=>({id:1,eventDate:'2026-10-16',title:'记录'+current,eventType:'manual_note',storeName:'店铺'+current,marketplaceCode:'US',asin:'B000000001',impactExpectation:'unknown',notes:'实际本地观察',revision:1});
const plan=(context,state='waiting')=>({storeId:context.storeId,businessDate:context.businessDate,state,enabled:true,detail:'当前店铺计划已读取。',scheduleLocalTime:'08:00',configRevision:1,dateStart:'2026-10-01',dateEnd:'2026-10-15'});
const retention=context=>({schemaVersion:1,mode:'dry-run',deletionSupported:false,generatedAt:'2026-10-16T12:00:00.000Z',cutoffAt:'2026-09-01T12:00:00.000Z',storeId:context.storeId,profileId:context.browserProfileId,marketplace:'US',currency:'USD',retentionDays:30,expiryBasis:'mtime-before-cutoff',applyable:false,scanSafe:true,candidateCount:0,candidateBytes:0,protectedScopeCount:1,protectedFileCount:1,blockerCount:0,blockers:[]});
function defer(kind,input){const context={...ctx()};return new Promise((resolve,reject)=>calls[kind].push({input,context,resolve,reject}));}
function pipeline(scope){return {scope,generatedAt:'2026-10-16T12:00:00.000Z',collection:{status:'blocked',latestBatch:null,availableBatches:[],sourceBatchIds:[],reportOptions:DEFAULT_BUSINESS_REPORT_OPTIONS,realReportFiles:[],evidenceArtifacts:[],fileAudit:{realReportFileCount:0,importedRowCount:0,rejectedEvidenceFileCount:0},audit:{databaseReady:true,acceptedExtensions:['.xlsx'],rejectedEvidenceExtensions:['.png'],notes:[]},blockers:[]},productContext:{products:[product()]},productHistory:{ledgers:[]},quant:{hasImportedMetrics:false,importedRows:0,totalSpend:0,totalSales:0,totalOrders:0,totalClicks:0,diagnostics:[]},operations:{events:[event()],notes:[]}};}
window.electronAPI={
  getBusinessUiDataPipeline:async scope=>pipeline(scope),getProducts:async()=>[product()],
  saveProductConfig:input=>defer('product',input),saveOperationScope:(context,input)=>defer('scope',{context,input}),
  listLingxingCollectionJobs:async()=>[],listOperationEvents:input=>eventsHeld?defer('eventRead',input):Promise.resolve([event()]),
  createOperationEvent:input=>defer('event',input),deleteOperationEvent:id=>defer('archive',id),
  getStoreCollectionSchedule:context=>planHeld?defer('planRead',context):Promise.resolve(plan(context)),
  runStoreCollectionScheduleNow:context=>defer('run',context),
  previewStoreEvidenceRetention:context=>retentionHeld?defer('retention',context):Promise.resolve(retention(context)),reportRuntimeLog:async()=>{},
};
window.addEventListener('amazon-ai-ops:navigate',e=>routes.push(e.detail));
const nextScope=()=>({dateFrom:'2026-10-01',dateTo:'2026-10-15',storeName:'店铺'+current,marketplaceCode:'US',currency:'USD',asin:${withAsin ? "'B000000001'" : 'undefined'}});
useScopeStore.getState().setScope(nextScope());
const capabilities=Object.entries(STORE_AUTOMATION_CAPABILITY_IDS).map(([kind,capabilityId])=>({capabilityId,workspace:'settings',view:'settings/scheduler',action:kind==='runNow'?'start':'view',state:'PRODUCTION_NATIVE',detail:'当前店铺服务已接入。'}));
function Content(){const value=useMissionControlStoreContext();return <><output id="fixture-authority">{value.authoritativeContext?.storeId}/{value.authoritativeContext?.sessionGeneration}</output>{value.authoritativeContext&&(${JSON.stringify(page)}==='product'?<ProductManagementPage/>:${JSON.stringify(page)}==='scope'?<OperationScopePage storeContext={value.authoritativeContext}/>:${JSON.stringify(page)}==='events'?<OperationEventsPage/>:<SchedulerPage storeContext={value.authoritativeContext} capabilities={capabilities}/>)}</>;}
const root=createRoot(document.getElementById('root'));root.render(<MissionControlStoreContextProvider api={provider}><Content/></MissionControlStoreContextProvider>);
window.legacyFixture={calls,routes,
  select(id,nextGeneration=1){current=id;generation=nextGeneration;useScopeStore.getState().setScope(nextScope());listeners.forEach(fn=>fn(view()));},
  holdRetention(){retentionHeld=true;},holdEvents(){eventsHeld=true;},holdSchedule(){planHeld=true;},
  finish(kind,index,failed=false){const call=calls[kind][index];if(failed){call.reject(new Error('本地操作失败，请重试。'));return;}
    call.resolve(kind==='product'?{success:true}:kind==='scope'?undefined:kind==='event'?{...event(),id:10}:kind==='archive'?{deleted:true}:kind==='run'?{projection:plan(call.context,'claimed'),duplicate:false}:kind==='planRead'?plan(call.context):kind==='eventRead'?[event()]:retention(call.context));},
  unmount(){root.render(<p>已离开业务页面</p>);},
};
`;
}
