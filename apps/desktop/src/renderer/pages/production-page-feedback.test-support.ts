import { recommendation } from './decisions-page.test-fixtures';

export type PageFeedbackFixture = 'diagnosis' | 'keyword' | 'dashboard' | 'decisions' | 'approval' | 'readback';

export function productionPageFeedbackFixture(panel: PageFeedbackFixture): string {
  const row = recommendation();
  return String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';
import {AdQuantPage} from '../../pages/ad-quant-page';import {KeywordOpportunitiesPage} from '../../pages/keyword-opportunities-page';
import {DashboardPage} from '../../pages/dashboard-page';import {DecisionsPage} from '../../pages/decisions-page';
import {ApprovalPage} from '../../pages/approval-page';import {ReadbackPage} from '../../pages/readback-page';
import {MissionControlStoreContextProvider,useMissionControlStoreContext} from '../store-context';
import {DEFAULT_BUSINESS_REPORT_OPTIONS} from '../../components/business-data';import {useScopeStore} from '../../scope-store';
let current='A',generation=1,holdKeyword=false,holdContext=false,missingOpen=false,unbound=false,reviewOnly=false;const calls={active:[],diagnosis:[],keyword:[],open:[],decision:[],discovery:[],export:[],copy:[]},listeners=[],logs=[],events=[];
const context=()=>({storeId:current,browserProfileId:'profile-'+current,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-07-13',sessionGeneration:generation});
const record=id=>({storeId:id,displayName:'US Store',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',browserProfileId:'profile-'+id,status:'active',revision:1,createdAt:'2026-07-14T12:00:00.000Z',updatedAt:'2026-07-14T12:00:00.000Z'});
const view=()=>({store:record(current),context:context(),connections:[],sessions:[]});
const provider={listStores:async()=>[record('A'),record('B')],listStoreDailyStatuses:async()=>({stores:[],generatedAt:'2026-07-14T12:00:00.000Z'}),getActiveStoreWorkspaceView:async()=>view(),onStoreContextChanged:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},onStoresChanged:()=>()=>{}};
const row=${JSON.stringify(row)};
function rows(status){if(reviewOnly)return status==='needs_review'?[{...row,id:301,status:'needs_review'}]:[];if(status==='needs_review'||status==='rejected')return[];const value={...row,status:status||'pending',evidence:{...row.evidence}};if(status==='approved')value.id=201;if(unbound)delete value.evidence.writableTarget;return[value];}
function defer(kind,input){return new Promise((resolve,reject)=>calls[kind].push({input,context:{...context()},resolve,reject}));}
const keyword=marker=>({asin:'B0TEST101',keyword:marker||'fixture-keyword',entityType:'keyword',campaignName:'SP - Charger',adGroupName:'Exact',coverageStatus:'not_covered',opportunityLevel:'high',clicks:38,orders:1,spend:10,sales:20,acos:0.5,sourceFile:'D:/reports/keyword.xlsx',sourceRow:18});
function pipeline(scope){return {scope,generatedAt:'2026-07-14T12:00:00.000Z',collection:{status:'ready',latestBatch:{id:'batch-20260714',status:'completed'},sourceBatchIds:['batch-20260714'],availableBatches:[],reportOptions:DEFAULT_BUSINESS_REPORT_OPTIONS.map(r=>({...r,status:'completed',realFileAvailable:true,importedRows:10})),realReportFiles:[{artifactId:'artifact-1',fileName:'keyword.xlsx',artifactDisplayName:'D:/reports/keyword.xlsx',importedRows:10}],evidenceArtifacts:[{kind:'report',artifactId:'artifact-1',label:'报表目录',displayName:'组件测试报表'},{kind:'report',artifactId:'artifact-2',label:'核验材料',displayName:'组件测试材料'}],fileAudit:{realReportFileCount:8,importedRowCount:80,rejectedEvidenceFileCount:0},audit:{databaseReady:true,acceptedExtensions:['.xlsx'],rejectedEvidenceExtensions:['.png'],notes:[]},blockers:[]},quant:{hasImportedMetrics:true,importedRows:80,canonicalRows:10,actionableRows:10,breakdownRows:0,totalSpend:10,totalSales:20,totalOrders:1,totalClicks:5,totalImpressions:10,acos:0.5,cvr:0.2,cpc:2,wastedSpend:0,highRiskCount:0,adObjectTimelines:[],diagnostics:[],blockers:[]},productContext:{products:[],productCount:0,notes:[]},productHistory:{ledgers:[]},operations:{events:[],notes:[],eventCount:0}};}
const api={
 getStoreRuntimeConfig:async capturedContext=>{
  const current={configId:'software-only-config-'+capturedContext.storeId,storeId:capturedContext.storeId,marketplace:capturedContext.marketplace,currency:capturedContext.currency,businessTimezone:capturedContext.businessTimezone,status:'active',revision:1,
   values:{aiRecommendationsEnabled:false,collectionScheduleLocalTime:'06:00',collectionLookbackDays:7,analysisWindowDays:30,defaultTargetAcosPercent:30,minimumRecommendationConfidencePercent:70,evidenceRetentionDays:30},createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z'};
  return{current,versions:[{revision:1,action:'create',occurredAt:'2026-10-16T12:00:00.000Z',snapshot:{...current,values:{...current.values}}}]};
 },
getBusinessUiDataPipeline:async scope=>pipeline(scope),listLingxingCollectionJobs:async()=>[],getRuleConfig:async()=>({}),getAiConnectionStatus:async()=>({available:false}),getAiStatus:async()=>({available:false}),listAiDiagnosisRuns:async()=>[],getRecommendations:async input=>rows(input.status),getDeliveryReadiness:async()=>null,getDeliveryEvidenceStatus:async()=>null,
runAdStrategyDiagnosis:input=>defer('diagnosis',input),getBusinessKeywordOpportunities:input=>holdKeyword?defer('keyword',input):Promise.resolve([keyword()]),openReportArtifact:(...input)=>defer('open',input),
approveRecommendation:input=>defer('decision',input),rejectRecommendation:input=>defer('decision',input),getActiveStoreContext:()=>holdContext?defer('active',{}):Promise.resolve(context()),executionAuthority:{discoverRecommendationTarget:input=>defer('discovery',input)},exportAdReadbackEvidence:input=>defer('export',input),reportRuntimeLog:async item=>logs.push(item)};
window.electronAPI=api;window.addEventListener('business-ui:data-updated',e=>events.push(e.detail));
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>defer('copy',text)}});
useScopeStore.getState().setScope({dateFrom:'2026-07-01',dateTo:'2026-07-13',storeName:'US Store',marketplaceCode:'US',currency:'USD',asin:'B0TEST101',batchId:'batch-20260714'});
function Content(){const auth=useMissionControlStoreContext();return <><output id="fixture-authority">{auth.authoritativeContext?.storeId}/{auth.authoritativeContext?.sessionGeneration}</output>{${JSON.stringify(panel)}==='diagnosis'?<AdQuantPage/>:${JSON.stringify(panel)}==='keyword'?<KeywordOpportunitiesPage/>:${JSON.stringify(panel)}==='dashboard'?<DashboardPage nextSafeAction={{label:'复核数据',reason:'隔离组件测试',intent:'data-collection',blocked:false}}/>:${JSON.stringify(panel)}==='decisions'?<DecisionsPage activeSubview="approval"/>:${JSON.stringify(panel)}==='approval'?<ApprovalPage/>:<ReadbackPage/>}</>}
const root=createRoot(document.getElementById('root'));root.render(<MissionControlStoreContextProvider api={provider}><Content/></MissionControlStoreContextProvider>);
window.pageFeedback={calls,logs,events,select(id,next=1){current=id;generation=next;listeners.forEach(fn=>fn(view()));},reviewMode(){reviewOnly=true;generation++;listeners.forEach(fn=>fn(view()));},holdKeyword(){holdKeyword=true;},holdContext(){holdContext=true;},clearAuthority(){listeners.forEach(fn=>fn(null));},missingExport(){delete api.exportAdReadbackEvidence;},unbound(){unbound=true;generation++;listeners.forEach(fn=>fn(view()));window.dispatchEvent(new Event('business-ui:data-updated'));},missingOpen(){delete api.openReportArtifact;},
complete(kind,index,value,failed=false){const call=calls[kind][index];if(failed){call.reject(new Error(value||'隔离测试故障'));return;}call.resolve(kind==='active'?call.context:kind==='keyword'?[keyword(value)]:kind==='export'?{jsonPath:value||'F:/isolated/readback.json',status:'NEEDS_WORK',readyForVerifier:false,nextAction:'prepare'}:kind==='diagnosis'?{summary:{summary:value||'当前诊断',evidenceRefs:[],insights:[],riskWarnings:[],reasoningSteps:[]}}:value);},unmount(){root.render(<p>已离开</p>);}};
`;
}
