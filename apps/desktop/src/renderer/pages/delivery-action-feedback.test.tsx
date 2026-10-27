import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);

describe('production Delivery page action feedback', () => {
  it('admits refresh once before rendering, explains peer locks, logs failure and permits retry', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await invokeActualReactActionTwice(page, '刷新最终验收');
      const refreshing = page.getByRole('button', { name: '刷新中...', exact: true }); await refreshing.waitFor();
      expect(await refreshing.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => (window as any).deliveryFixture.refreshes.length)).toBe(1);
      const copy = page.getByRole('button', { name: '复制摘要', exact: true });
      expect(await copy.isDisabled()).toBe(true); expect(await copy.getAttribute('aria-busy')).toBeNull();
      const reason = await copy.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待完成');
      expect(await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('button:disabled')]
        .filter(button => button.getClientRects().length > 0)
        .filter(button => !(button.getAttribute('aria-describedby') || '').split(/\s+/)
          .some(id => document.getElementById(id)?.textContent?.trim()))
        .map(button => button.textContent?.trim()))).toEqual([]);
      await page.evaluate(() => (window as any).deliveryFixture.rejectRefresh(0));
      await page.getByRole('button', { name: '刷新最终验收', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).deliveryFixture.logs.some((row: { event: string }) => row.event === 'delivery.operation_failed'))).toBe(true);
      await page.getByRole('button', { name: '刷新最终验收', exact: true }).click();
      await page.evaluate(() => (window as any).deliveryFixture.completeRefresh(1));
      await page.getByRole('region', { name: '交付消息', exact: true }).filter({ hasText: '最终验收已刷新，仍未就绪。' }).waitFor();
      expect(await page.getByText('可以交付', { exact: true }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('rejects an A to B to A refresh and its workflow broadcast without releasing the current action', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.getByRole('button', { name: '刷新最终验收', exact: true }).click();
      await page.evaluate(() => (window as any).deliveryFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.evaluate(() => (window as any).deliveryFixture.select('A'));
      await page.locator('#fixture-authority').filter({ hasText: 'A/1' }).waitFor();
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.getByRole('button', { name: '刷新最终验收', exact: true }).click();
      await page.evaluate(() => (window as any).deliveryFixture.completeRefresh(0));
      expect(await page.getByRole('button', { name: '刷新中...', exact: true }).isDisabled()).toBe(true);
      expect(await page.evaluate(() => (window as any).deliveryFixture.events.length)).toBe(0);
      await page.evaluate(() => (window as any).deliveryFixture.completeRefresh(1));
      await page.getByRole('region', { name: '交付消息', exact: true }).filter({ hasText: '最终验收已刷新，仍未就绪。' }).waitFor();
      expect(await page.evaluate(() => (window as any).deliveryFixture.events)).toEqual(['delivery-refreshed']);
    } finally { await browser.close(); }
  }, 30_000);

  it('does not present an incomplete refresh response as completed or broadcast it into the workbench', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.getByRole('button', { name: '刷新最终验收', exact: true }).click();
      await page.evaluate(() => (window as any).deliveryFixture.refreshes[0].resolve({ success: false }));
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      expect(await page.getByRole('region', { name: '交付消息', exact: true }).textContent()).not.toContain('已刷新');
      expect(await page.evaluate(() => (window as any).deliveryFixture.events)).toEqual([]);
      expect(await page.evaluate(() => (window as any).deliveryFixture.logs.some((row: { event: string }) => row.event === 'delivery.operation_failed'))).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('shares synchronous admission between actual file, clipboard and refresh entries with one busy origin', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.locator('summary').filter({ hasText: '文件位置与支持入口' }).click();
      const missing = page.getByRole('button', { name: '打开证据目录', exact: true });
      const reason = await missing.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('完成采集并导入');
      await invokeActualReactActionTwice(page, '打开最终验收汇总');
      await page.getByRole('button', { name: '打开中...', exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '刷新最终验收');
      expect(await page.evaluate(() => (window as any).deliveryFixture.paths.length)).toBe(1);
      expect(await page.evaluate(() => (window as any).deliveryFixture.refreshes.length)).toBe(0);
      expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
      await page.evaluate(() => (window as any).deliveryFixture.completePath(0));
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await invokeActualReactActionTwice(page, '复制摘要');
      await page.getByRole('button', { name: '复制中...', exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '刷新最终验收');
      expect(await page.evaluate(() => (window as any).deliveryFixture.copies.length)).toBe(1);
      expect(await page.evaluate(() => (window as any).deliveryFixture.refreshes.length)).toBe(0);
      expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
      await page.evaluate(() => (window as any).deliveryFixture.completeCopy(0));
      await page.getByRole('region', { name: '交付消息', exact: true }).filter({ hasText: '交付摘要已复制。' }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('exports only faithful NON_READY materials and rejects old-session export completion', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await invokeActualReactActionTwice(page, '导出未完成验收材料');
      await page.getByRole('button', { name: '导出中...', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).deliveryFixture.exports.length)).toBe(1);
      await page.evaluate(() => (window as any).deliveryFixture.select('A', 2));
      await page.locator('#fixture-authority').filter({ hasText: 'A/2' }).waitFor();
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.getByRole('button', { name: '导出未完成验收材料', exact: true }).click();
      await page.evaluate(() => (window as any).deliveryFixture.completeExport(0, 'OLD-EXPORT'));
      expect(await page.getByRole('button', { name: '导出中...', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('OLD-EXPORT', { exact: false }).count()).toBe(0);
      await page.evaluate(() => (window as any).deliveryFixture.completeExport(1, 'CURRENT-NON-READY'));
      await page.getByRole('region', { name: '交付消息', exact: true }).filter({ hasText: '未完成验收材料已导出，包含当前缺口，不能作为生产就绪证明。' }).waitFor();
      expect(await page.getByText('可以交付', { exact: true }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('stops an old passive read before the next IPC and binds the new request to the complete store context', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.evaluate(() => { (window as any).deliveryFixture.deferPipeline(); (window as any).deliveryFixture.select('A', 2); });
      await page.waitForFunction(() => (window as any).deliveryFixture.pipelines.length === 1);
      await page.evaluate(() => (window as any).deliveryFixture.select('B'));
      await page.waitForFunction(() => (window as any).deliveryFixture.pipelines.length === 2);
      const count = await page.evaluate(() => (window as any).deliveryFixture.readinessReads);
      await page.evaluate(() => (window as any).deliveryFixture.completePipeline(0));
      expect(await page.evaluate(() => (window as any).deliveryFixture.readinessReads)).toBe(count);
      expect(await page.evaluate(() => (window as any).deliveryFixture.pipelines[1].scope.storeContext.storeId)).toBe('B');
      await page.evaluate(() => (window as any).deliveryFixture.completePipeline(1));
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      expect(await page.evaluate(() => (window as any).deliveryFixture.readinessReads)).toBe(count + 1);
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps an unconfigured store unknown after refresh and exports only faithful missing materials', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      const counts = await page.evaluate(() => ({ reads: (window as any).deliveryFixture.readinessReads,
        pipelines: (window as any).deliveryFixture.pipelineReads.length }));
      await page.evaluate(() => { (window as any).deliveryFixture.missingConfig(); (window as any).deliveryFixture.select('B'); });
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.getByRole('region', { name: '交付消息', exact: true }).filter({ hasText: '业务数据状态未知' }).waitFor();
      await page.getByText('未知（当前业务数据尚未读取）', { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).deliveryFixture.pipelineReads.length)).toBe(counts.pipelines);
      expect(await page.evaluate(() => (window as any).deliveryFixture.readinessReads)).toBe(counts.reads + 1);
      expect(await page.getByRole('button', { name: '导出未完成验收材料', exact: true }).isEnabled()).toBe(true);
      expect(await page.getByText('可以交付', { exact: true }).count()).toBe(0);
      await page.getByRole('button', { name: '刷新最终验收', exact: true }).click();
      await page.evaluate(() => (window as any).deliveryFixture.completeRefresh(0));
      await page.getByRole('region', { name: '交付消息', exact: true }).filter({ hasText: '最终验收已刷新，仍未就绪。' }).waitFor();
      await page.getByText('未知（当前业务数据尚未读取）', { exact: true }).waitFor();
      await page.locator('summary').filter({ hasText: '业务闭环矩阵' }).click();
      const matrixData = page.locator('.context-action-card').filter({ hasText: '真实数据闭环' });
      expect(await matrixData.textContent()).toContain('未知'); expect(await matrixData.textContent()).toContain('去系统设置');
      expect(await matrixData.textContent()).not.toMatch(/0\/8|0 行/);
      await page.getByRole('button', { name: '复制摘要', exact: true }).click();
      expect(await page.evaluate(() => (window as any).deliveryFixture.copies[0].text)).toContain('真实报表文件：未知');
      expect(await page.evaluate(() => (window as any).deliveryFixture.copies[0].text)).toContain('导入指标行数：未知');
      await page.evaluate(() => (window as any).deliveryFixture.completeCopy(0));
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.getByRole('button', { name: '导出未完成验收材料', exact: true }).click();
      expect(await page.evaluate(() => (window as any).deliveryFixture.exports.length)).toBe(1);
      await page.evaluate(() => (window as any).deliveryFixture.completeExport(0, 'CURRENT-NON-READY'));
      await page.getByRole('region', { name: '交付消息', exact: true }).filter({ hasText: '不能作为生产就绪证明' }).waitFor();
      expect(await page.getByText('可以交付', { exact: true }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('stops a stale canonical projection before analysis and the current readiness chain', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      const pipelines = await page.evaluate(() => (window as any).deliveryFixture.pipelineReads.length);
      await page.evaluate(() => { (window as any).deliveryFixture.deferConfig(); (window as any).deliveryFixture.select('A', 2); });
      await page.waitForFunction(() => (window as any).deliveryFixture.configReads.length === 1);
      await page.evaluate(() => (window as any).deliveryFixture.select('B'));
      await page.waitForFunction(() => (window as any).deliveryFixture.configReads.length === 2);
      const reads = await page.evaluate(() => (window as any).deliveryFixture.readinessReads);
      await page.evaluate(() => (window as any).deliveryFixture.completeConfig(0, true));
      expect(await page.evaluate(() => (window as any).deliveryFixture.readinessReads)).toBe(reads);
      expect(await page.evaluate(() => (window as any).deliveryFixture.pipelineReads.length)).toBe(pipelines);
      await page.evaluate(() => (window as any).deliveryFixture.completeConfig(1));
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      expect(await page.evaluate(() => (window as any).deliveryFixture.readinessReads)).toBe(reads + 1);
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps inconsistent readback success flags blocked and explains prerequisite locks in the actual view', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.locator('summary').filter({ hasText: '广告回读补证' }).click();
      await page.getByRole('button', { name: '创建回读工作包', exact: true }).click();
      await page.getByRole('button', { name: '校验回读证据', exact: true }).click();
      const blocked = page.locator('.readback-session-check-blocked').filter({ hasText: '回读证据校验：未通过' }); await blocked.waitFor();
      expect(await page.locator('.readback-session-check-ready').filter({ hasText: '回读证据校验' }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).deliveryFixture.events)).not.toContain('readback-verified');
    } finally { await browser.close(); }
  }, 30_000);
});

// 隔离软件端口不执行外部写入，也不构造真实审批、费用或生产就绪证明。
const fixture = String.raw`
import React from 'react';import{createRoot}from'react-dom/client';
import{DeliveryPage}from'../../pages/delivery-page';import{DEFAULT_BUSINESS_REPORT_OPTIONS}from'../../components/business-data';
import{MissionControlStoreContextProvider,useMissionControlStoreContext}from'../store-context';import{useScopeStore}from'../../scope-store';
let current='A',generation=1,deferredPipeline=false,readinessReads=0,missingRuntimeConfig=false,deferredRuntimeConfig=false;
const listeners=[],refreshes=[],paths=[],copies=[],exports=[],pipelines=[],logs=[],events=[],configReads=[],pipelineReads=[];
const context=()=>({storeId:current,browserProfileId:'profile-'+current,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:generation});
const record=id=>({storeId:id,displayName:'隔离软件店铺',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',browserProfileId:'profile-'+id,status:'active',revision:1,createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z'});
const view=()=>({store:record(current),context:context(),connections:[],sessions:[]});
const authorityApi={listStores:async()=>[record('A'),record('B')],listStoreDailyStatuses:async()=>({stores:[],generatedAt:'2026-10-16T12:00:00.000Z'}),getActiveStoreWorkspaceView:async()=>view(),onStoreContextChanged:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},onStoresChanged:()=>()=>{}};
const pipeline=scope=>({scope,generatedAt:'2026-10-16T12:00:00.000Z',collection:{status:'blocked',latestBatch:null,sourceBatchIds:[],availableBatches:[],reportOptions:DEFAULT_BUSINESS_REPORT_OPTIONS,realReportFiles:[],evidenceArtifacts:[],fileAudit:{realReportFileCount:0,importedRowCount:0,rejectedEvidenceFileCount:0},audit:{databaseReady:true,acceptedExtensions:['.xlsx'],rejectedEvidenceExtensions:['.png'],notes:[]},blockers:[]},quant:{hasImportedMetrics:false,importedRows:0,totalSpend:0,totalSales:0,totalOrders:0},operations:{events:[],notes:[]}});
const readiness=()=>({available:true,exists:true,path:'ISOLATED-NON-READY.json',verificationProtocol:'v16.current-publication/1',manifestDriven:true,status:'APP_NEEDS_WORK',appReady:false,gates:[{name:'real-ad-execution-readback',ok:false,message:'尚无真实回读证明',evidencePath:'ISOLATED-CANDIDATE.json'}],gatesSummary:{total:1,passed:0,failed:1},missing:['尚无真实回读证明'],actionItems:[]});
const runtimeProjection=context=>{const current={configId:'SOFTWARE-ONLY-CONFIG-'+context.storeId,storeId:context.storeId,marketplace:'US',currency:'USD',businessTimezone:context.businessTimezone,status:'active',revision:1,values:{aiRecommendationsEnabled:false,collectionScheduleLocalTime:'06:00',collectionLookbackDays:7,analysisWindowDays:30,defaultTargetAcosPercent:30,minimumRecommendationConfidencePercent:70,evidenceRetentionDays:30},createdAt:'2026-10-16T00:00:00.000Z',updatedAt:'2026-10-16T00:00:00.000Z'};return{current,versions:[{revision:1,action:'create',occurredAt:current.createdAt,snapshot:{...current}}]};};
window.electronAPI={getStoreRuntimeConfig:context=>deferredRuntimeConfig?new Promise(resolve=>configReads.push({context,resolve})):Promise.resolve(missingRuntimeConfig?{current:null,versions:[]}:runtimeProjection(context)),getBusinessUiDataPipeline:scope=>{pipelineReads.push(scope);if(missingRuntimeConfig)return Promise.reject(new Error('缺配置不应调用业务分析'));return deferredPipeline?new Promise(resolve=>pipelines.push({scope,resolve})):Promise.resolve(pipeline(scope));},getDeliveryReadiness:async()=>{readinessReads+=1;return readiness();},getSettings:async()=>({}),listAiDiagnosisRuns:async()=>[],getRecommendations:async()=>[],getDeliveryEvidenceStatus:async()=>null,
refreshFinalReadiness:()=>new Promise((resolve,reject)=>refreshes.push({resolve,reject})),openReportPath:path=>new Promise(resolve=>paths.push({path,resolve})),openReportArtifact:async()=>{},exportDeliveryBundle:scope=>new Promise(resolve=>exports.push({scope,resolve})),exportDataReconciliation:async()=>({jsonPath:'ISOLATED.json'}),
prepareAdReadbackSession:async()=>({sessionDir:'ISOLATED',passEvidencePath:'ISOLATED-PASS.json'}),verifyAdReadbackSession:async()=>({ready:false}),fillAdReadbackSession:async()=>({readyForVerifier:false}),verifyAdReadbackEvidence:async()=>({ready:true,ok:true,verified:true,status:'NEEDS_WORK',issues:['现场证明仍不完整']}),reportRuntimeLog:async row=>logs.push(row)};
Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:text=>new Promise(resolve=>copies.push({text,resolve}))}});
window.addEventListener('amazon-ai-ops:workflow-invalidated',event=>events.push(event.detail.source));
useScopeStore.getState().setScope({dateFrom:'2026-10-01',dateTo:'2026-10-15',storeName:'隔离软件店铺',marketplaceCode:'US',currency:'USD',asin:'B000000001'});
function Authority(){const value=useMissionControlStoreContext();return <output id="fixture-authority">{value.authoritativeContext?.storeId}/{value.authoritativeContext?.sessionGeneration}</output>;}
const root=createRoot(document.getElementById('root'));root.render(<MissionControlStoreContextProvider api={authorityApi}><Authority/><DeliveryPage/></MissionControlStoreContextProvider>);
window.deliveryFixture={refreshes,paths,copies,exports,pipelines,logs,events,configReads,pipelineReads,get readinessReads(){return readinessReads;},ready:()=>[...document.querySelectorAll('button')].some(button=>button.textContent?.trim()==='刷新最终验收'&&!button.disabled),select(id,next=1){current=id;generation=next;listeners.forEach(fn=>fn(view()));},deferPipeline(){deferredPipeline=true;},missingConfig(){missingRuntimeConfig=true;},deferConfig(){deferredRuntimeConfig=true;},completeConfig(index,empty=false){const call=configReads[index];call.resolve(empty?{current:null,versions:[]}:runtimeProjection(call.context));},completePipeline(index){const call=pipelines[index];call.resolve(pipeline(call.scope));},completeRefresh(index){refreshes[index].resolve({success:true,readiness:readiness()});},rejectRefresh(index){refreshes[index].reject(new Error('隔离读取失败'));},completePath(index){paths[index].resolve(true);},completeCopy(index){copies[index].resolve();},completeExport(index,path){exports[index].resolve({success:true,status:'APP_NEEDS_WORK',bundleDir:path});}};
`;


describe('production Delivery passive-read accessibility state', () => {
  it('keeps the real page busy across a superseded passive read and clears it for the current NON_READY result', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      const canvas = page.locator('.delivery-prototype-stack').locator('..');
      expect(await canvas.getAttribute('aria-busy')).toBeNull();
      await page.evaluate(() => { (window as any).deliveryFixture.deferPipeline(); (window as any).deliveryFixture.select('A', 2); });
      await page.waitForFunction(() => (window as any).deliveryFixture.pipelines.length === 1);
      expect(await canvas.getAttribute('aria-busy')).toBe('true');
      expect(await page.getByRole('button', { name: '复制摘要', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: '复制摘要', exact: true }).getAttribute('aria-busy')).toBeNull();
      await page.evaluate(() => (window as any).deliveryFixture.select('B'));
      await page.waitForFunction(() => (window as any).deliveryFixture.pipelines.length === 2);
      await page.evaluate(() => (window as any).deliveryFixture.completePipeline(0));
      expect(await canvas.getAttribute('aria-busy')).toBe('true');
      await page.evaluate(() => (window as any).deliveryFixture.completePipeline(1));
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      expect(await canvas.getAttribute('aria-busy')).toBeNull();
      expect(await page.getByText('可以交付', { exact: true }).count()).toBe(0);
      await page.evaluate(() => { (window as any).deliveryFixture.missingConfig(); (window as any).deliveryFixture.select('A', 3); });
      await page.waitForFunction(() => (window as any).deliveryFixture.ready());
      await page.getByText('未知（当前业务数据尚未读取）', { exact: true }).waitFor();
      expect(await canvas.getAttribute('aria-busy')).toBeNull();
      expect(await page.getByText('可以交付', { exact: true }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});
