export function currentWorkspaceActionFixture(surface: 'missions' | 'today') {
  return String.raw`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{MissionControlStoreContextProvider,useMissionControlStoreContext}from'../store-context';
import{MissionsWorkspace}from'./missions-workspace';import{MissionControlWorkspaceView}from'./mission-control-workspace-view';
import{missionControlContextKey}from'@amazon-ai-ops/shared-types';
import{useMissionControlBridge}from'../bridge/use-mission-control-bridge';
import{MissionControlShell}from'../mission-control-shell';
let current='A',generation=1,selectedView='missions/overview',notify,holdFailure=false;
const listeners=[],logs=[],routes=[],calls={transition:[],analysis:[],checkpoint:[],refresh:[],mode:[],failure:[],list:[],lineage:[],projection:[]};
const errors=[];window.addEventListener('error',event=>errors.push(event.error?.stack||event.message));
window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
const context=()=>({storeId:current,browserProfileId:'profile-'+current,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:generation});
const store=id=>({storeId:id,browserProfileId:'profile-'+id,displayName:'同名店铺',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',status:'active',createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z'});
const workspace=()=>({store:store(current),context:context(),connections:[],sessions:[]});
const provider={listStores:async()=>[store('A'),store('B')],listStoreDailyStatuses:async()=>({stores:[],generatedAt:'2026-10-16T12:00:00Z'}),getActiveStoreWorkspaceView:async()=>workspace(),onStoreContextChanged:callback=>{listeners.push(callback);return()=>listeners.splice(listeners.indexOf(callback),1);},onStoresChanged:()=>()=>{}};
const records=new Map(),checkpoints=new Map();
const mission=ctx=>records.get(ctx.storeId)||{id:'mission-'+ctx.storeId,storeId:ctx.storeId,marketplace:'US',currency:'USD',title:'当前任务 '+ctx.storeId,objective:'降低浪费并保持订单',priority:'P2',status:'active',phase:'fact',dataBatchId:'batch-'+ctx.storeId,policyVersionId:'policy-'+ctx.storeId,productId:'B000000001',observationStartsAt:'2026-10-01T07:00:00Z',observationEndsAt:'2026-10-08T07:00:00Z',successCriteria:['成本改善'],guardrails:['结果未知即停止'],revision:1,createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z'};
const scopedMission=(ctx,id)=>id==='mission-second-'+ctx.storeId?{...mission(ctx),id,title:'另一个任务'}:mission(ctx);
const lineage=(ctx,id)=>({mission:scopedMission(ctx,id),checkpoints:checkpoints.get(ctx.storeId)||[],links:[],causalEvents:[]});
const projection=()=>({evidencePackages:[],actionBatches:[],proposals:[],decisionLinks:[]});
function defer(kind,ctx,input){return new Promise((resolve,reject)=>calls[kind].push({ctx:{...ctx},input,resolve,reject}));}
const api={listMissions:async ctx=>{calls.list.push({...ctx});return[mission(ctx),scopedMission(ctx,'mission-second-'+ctx.storeId)];},getMissionLineage:(ctx,id)=>{calls.lineage.push({...ctx});return holdFailure?defer('failure',ctx,{id}):Promise.resolve(lineage(ctx,id));},transitionMission:(ctx,input)=>defer('transition',ctx,input),appendMissionCheckpoint:(ctx,input)=>defer('checkpoint',ctx,input)};
const analysis={getMissionProjection:async ctx=>{calls.projection.push({...ctx});return projection();},runMissionAnalysis:input=>defer('analysis',input.context,input)};
const caps=['view','create','update','pause','resume','archive','restore'].map(action=>({capabilityId:'missions.mission.'+action,workspace:'missions',view:'missions/overview',action,state:'PRODUCTION_NATIVE',detail:'当前店铺已接入。'}));
caps.push({capabilityId:'missions.mission.facts.view',workspace:'missions',view:'missions/facts',action:'view',state:'PRODUCTION_NATIVE',detail:'当前店铺已接入。'},{capabilityId:'missions.checkpoint.create',workspace:'missions',view:'missions/facts',action:'create',state:'PRODUCTION_NATIVE',detail:'当前店铺已接入。'},
{capabilityId:'today.overview.view',workspace:'today',view:'today/overview',action:'view',state:'PRODUCTION_NATIVE',detail:'当前店铺已接入。'});
let lastQuery='';const bootstrap=input=>({requestId:input.requestId,contextEpoch:input.contextEpoch,authoritativeContext:input.context,data:{capabilities:caps,autonomy:{currentMode:'manual_approval',manualApprovalAvailable:true,policyAutoAvailable:true},today:null}});
window.electronAPI={...provider,getStore:async id=>store(id),createStore:async()=>store('new'),updateStore:async()=>store(current),archiveStore:async()=>store(current),restoreStore:async()=>store(current),createStoreConnection:async()=>({}),updateStoreConnection:async()=>({}),removeStoreConnection:async()=>({success:true}),switchStore:async()=>workspace(),getActiveStoreContext:async()=>context(),
missionControl:{query:input=>{const key=missionControlContextKey(input.context)+'|'+input.contextEpoch;if(lastQuery!==key){lastQuery=key;return Promise.resolve(bootstrap(input));}return defer('refresh',input.context,input);},command:input=>defer('mode',input.context,input)},
reportRuntimeLog:async record=>logs.push(record),getOperationScope:async()=>({dateFrom:'2026-10-01',dateTo:'2026-10-15'}),getBusinessBatchOptions:async()=>[],listStoreProducts:async()=>[],analysisRuns:{list:async()=>({success:true,data:[]})}};
window.addEventListener('amazon-ai-ops:navigate',event=>routes.push(event.detail));
function TodayContent({ctx}){const bridge=useMissionControlBridge();return <MissionControlShell activeIntent={{workspace:'today',subview:'overview'}} activeStore={store(ctx.storeId)} authoritativeContext={ctx} stores={['A','B'].map(store)} autonomy={bridge.autonomy} capabilities={bridge.capabilities} onSetAutonomyMode={bridge.setAutonomyMode} onNavigate={intent=>routes.push(intent)} onSwitchStore={()=>{}} onLogout={()=>{}}><MissionControlWorkspaceView intent={{workspace:'today',subview:'overview'}} capabilities={bridge.capabilities} previewMode={false} storeContext={ctx} today={bridge.today} bridgePhase={bridge.phase} bridgeError={bridge.error} onRefreshAuthority={bridge.refreshBootstrap} onNavigate={intent=>routes.push(intent)}/></MissionControlShell>;}
function Content(){const value=useMissionControlStoreContext();const[version,setVersion]=useState(0);notify=()=>setVersion(x=>x+1);const ctx=value.authoritativeContext;return <><output id="current-authority">{ctx?.storeId}/{ctx?.sessionGeneration}/{value.contextEpoch}/{version}</output>{ctx&&(${JSON.stringify(surface)}==='missions'?<MissionsWorkspace apiOverride={api} analysisApiOverride={analysis} blockedReason="请检查当前店铺连接后重试。" capabilities={caps} previewMode={false} storeContext={ctx} view={selectedView}/>:<TodayContent ctx={ctx}/>)}</>;}
const root=createRoot(document.getElementById('root'));root.render(<MissionControlStoreContextProvider api={provider}><Content/></MissionControlStoreContextProvider>);
window.currentWorkspaceFixture={calls,logs,routes,errors,select(id,g=1){current=id;generation=g;listeners.forEach(callback=>callback(workspace()));},facts(){selectedView='missions/facts';notify();},holdFailure(){holdFailure=true;},
finish(kind,index,failed=false){const call=calls[kind][index];if(failed){call.reject(new Error(kind==='analysis'?'当前分析失败，请重试。':'当前操作失败，请重试。'));return;}
if(kind==='transition'){const saved={...scopedMission(call.ctx,call.input.id),status:call.input.status,revision:2};records.set(call.ctx.storeId,saved);call.resolve(saved);}
else if(kind==='checkpoint'){const saved={...call.input,storeId:call.ctx.storeId,createdAt:'2026-10-16T12:00:00Z'};checkpoints.set(call.ctx.storeId,[saved]);call.resolve(saved);}
else if(kind==='failure')call.resolve(lineage(call.ctx,call.input?.id));else if(kind==='analysis')call.resolve({proposals:[],recommendationSummary:{candidates:0,created:0,refreshed:0,reused:0}});else call.resolve(bootstrap(call.input));},
unmount(){root.unmount();}};
`;
}
