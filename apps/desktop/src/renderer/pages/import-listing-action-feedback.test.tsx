import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);

describe('production Import and Listing operation feedback', () => {
  it('admits one local import before rendering and explains disabled export and peer navigation', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).pageFixture.ready());
      await page.locator('summary').filter({ hasText: '8 类报表入库明细' }).click();
      const missingFile = page.getByRole('button', { name: '打开表格', exact: true }).first();
      const missingReason = await missingFile.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${missingReason}"]`).textContent()).toContain('当前尚无此项文件');
      await page.getByRole('region', { name: '生产血缘导入状态', exact: true }).getByRole('button', { name: '导入本地报表', exact: true }).evaluate(button => {
        const target = button as any;
        const props = target[Object.keys(target).find(key => key.startsWith('__reactProps$'))!];
        props.onClick(); props.onClick();
      });
      const busy = page.getByRole('button', { name: '处理中...', exact: true }); await busy.waitFor();
      expect(await busy.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => (window as any).pageFixture.imports.length)).toBe(1);
      expect(await page.locator('.task-banner').getByRole('button', { name: '导入本地报表', exact: true }).getAttribute('aria-busy')).toBeNull();
      expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
      const peer = page.getByRole('button', { name: '回到数据采集', exact: true }).first();
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      const reason = await peer.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待完成');
      await page.evaluate(() => (window as any).pageFixture.completeImport(0, 2));
      await page.locator('.data-import-feedback-strip').getByText('本地导入完成：解析 1 个真实报表，写入 2 行广告指标。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('does not publish an old import result after A to B to A or clear the current import busy state', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).pageFixture.ready());
      await page.getByRole('region', { name: '生产血缘导入状态', exact: true }).getByRole('button', { name: '导入本地报表', exact: true }).click();
      await page.evaluate(() => (window as any).pageFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.evaluate(() => (window as any).pageFixture.select('A'));
      await page.locator('#fixture-authority').filter({ hasText: 'A/1' }).waitFor();
      await page.getByRole('region', { name: '生产血缘导入状态', exact: true }).getByRole('button', { name: '导入本地报表', exact: true }).click();
      await page.evaluate(() => (window as any).pageFixture.completeImport(0, 199));
      expect(await page.getByRole('button', { name: '处理中...', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText(/写入 199 行/).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).pageFixture.imports.length)).toBe(2);
      await page.evaluate(() => (window as any).pageFixture.completeImport(1, 3));
      await page.locator('.data-import-feedback-strip').getByText('本地导入完成：解析 1 个真实报表，写入 3 行广告指标。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('only marks the actual file or folder opener busy and keeps equal-artifact peers plain', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).pageFixture.ready());
      await page.evaluate(() => (window as any).pageFixture.enableArtifacts());
      const folder = page.getByRole('button', { name: '打开报表目录', exact: true }).first();
      await folder.waitFor();
      await page.locator('summary').filter({ hasText: '8 类报表入库明细' }).click();
      await invokeActualReactActionTwice(page, '打开表格');
      await page.getByRole('button', { name: '打开中...', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).pageFixture.opens.length)).toBe(1);
      expect(await folder.isDisabled()).toBe(true);
      expect(await folder.getAttribute('aria-busy')).toBeNull();
      expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
      await page.evaluate(() => (window as any).pageFixture.completeOpen(0));
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '打开报表目录' && !button.disabled));
      await folder.click();
      await page.getByRole('button', { name: '打开目录中…', exact: true }).waitFor();
      expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
      expect(await page.evaluate(() => (window as any).pageFixture.opens.length)).toBe(2);
      const sameArtifactPeers = page.locator('button').filter({ hasText: /^打开报表目录$/ });
      expect(await sameArtifactPeers.count()).toBeGreaterThan(0);
      for (const peer of await sameArtifactPeers.all()) {
        expect(await peer.isDisabled()).toBe(true);
        expect(await peer.getAttribute('aria-busy')).toBeNull();
      }
      await page.evaluate(() => (window as any).pageFixture.completeOpen(1));
    } finally { await browser.close(); }
  }, 30_000);

  it('preserves a successful local save when reading version history fails and offers a read retry', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).pageFixture.ready());
      await page.evaluate(() => { (window as any).pageFixture.historyMode('failed'); (window as any).pageFixture.panel('listing'); });
      await page.getByRole('button', { name: '打开 Listing 编辑', exact: true }).click();
      await page.getByLabel('标题', { exact: true }).fill('已成功保存的本地标题');
      await page.getByRole('button', { name: '保存为新版本', exact: true }).click();
      await page.evaluate(() => (window as any).pageFixture.completeSave(0));
      await page.getByText('当前 Listing 已保存在本地，但版本历史读取失败；请刷新本地版本历史核对，无需重复保存。', { exact: true }).waitFor();
      expect(await page.getByText(/保存手工 Listing 失败/).count()).toBe(0);
      expect(await page.getByLabel('标题', { exact: true }).inputValue()).toBe('已成功保存的本地标题');
      expect(await page.evaluate(() => (window as any).pageFixture.saves.length)).toBe(1);
      await page.evaluate(() => (window as any).pageFixture.historyMode('deferred'));
      await page.getByRole('button', { name: '刷新版本历史', exact: true }).click();
      await page.getByRole('button', { name: '刷新中...', exact: true }).waitFor();
      expect(await page.locator('button[aria-busy="true"]').count()).toBe(1);
      expect(await page.locator('.listing-editor-entry-panel button').filter({ hasText: '刷新版本历史' }).getAttribute('aria-busy')).toBeNull();
      await page.evaluate(() => (window as any).pageFixture.completeHistory(0));
      await page.getByText('已刷新 Listing 版本历史：0 个本地版本。', { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).pageFixture.saves.length)).toBe(1);
    } finally { await browser.close(); }
  }, 30_000);

  it('hides prior-store pipeline data immediately and rejects delayed reads for equal names and identical scopes', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).pageFixture.ready());
      await page.evaluate(() => (window as any).pageFixture.panel('pipeline'));
      await page.waitForFunction(() => (window as any).pageFixture.pipelineReads.length === 1);
      await page.evaluate(() => (window as any).pageFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.waitForFunction(() => (window as any).pageFixture.pipelineReads.length === 2);
      await page.evaluate(() => (window as any).pageFixture.completePipeline(0, '旧店铺数据'));
      expect(await page.locator('#pipeline-marker').textContent()).toBe('读取中');
      await page.evaluate(() => (window as any).pageFixture.completePipeline(1, '当前店铺数据'));
      await page.locator('#pipeline-marker').filter({ hasText: '当前店铺数据' }).waitFor();
      expect(await page.evaluate(() => (window as any).pageFixture.pipelineReads[1].scope.storeContext.storeId)).toBe('B');
      await page.evaluate(() => (window as any).pageFixture.select('A', 2));
      await page.locator('#fixture-authority').filter({ hasText: 'A/2' }).waitFor();
      expect(await page.locator('#pipeline-marker').textContent()).toBe('读取中');
      await page.waitForFunction(() => (window as any).pageFixture.pipelineReads.length === 3);
      expect(await page.evaluate(() => (window as any).pageFixture.pipelineReads[2].scope.storeContext.sessionGeneration)).toBe(2);
      await page.evaluate(() => (window as any).pageFixture.completePipeline(2, '新会话数据'));
      await page.locator('#pipeline-marker').filter({ hasText: '新会话数据' }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('locks the actual Listing save before rendering and ignores an old store response without closing the new editor', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    try {
      await page.waitForFunction(() => (window as any).pageFixture.ready());
      await page.evaluate(() => (window as any).pageFixture.panel('listing'));
      await page.locator('.listing-optimization-page-stack').waitFor();
      expect(pageErrors.join('\n')).toBe('');
      await page.getByRole('button', { name: '打开 Listing 编辑', exact: true }).first().click();
      await page.getByLabel('标题', { exact: true }).fill('第一店铺标题');
      await invokeActualReactActionTwice(page, '保存为新版本');
      const saving = page.getByRole('button', { name: '保存中...', exact: true }); await saving.waitFor();
      expect(await saving.getAttribute('aria-busy')).toBe('true');
      expect(await page.getByLabel('标题', { exact: true }).getAttribute('readonly')).not.toBeNull();
      expect(await page.evaluate(() => (window as any).pageFixture.saves.length)).toBe(1);
      await page.evaluate(() => (window as any).pageFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.getByRole('button', { name: '打开 Listing 编辑', exact: true }).first().click();
      await page.getByLabel('标题', { exact: true }).fill('第二店铺新标题');
      await page.getByRole('button', { name: '保存为新版本', exact: true }).click();
      await page.evaluate(() => (window as any).pageFixture.completeSave(0));
      expect(await page.getByLabel('标题', { exact: true }).inputValue()).toBe('第二店铺新标题');
      expect(await page.getByRole('button', { name: '保存中...', exact: true }).isDisabled()).toBe(true);
      expect(await page.evaluate(() => (window as any).pageFixture.saves[1].scope.storeContext.storeId)).toBe('B');
      await page.evaluate(() => (window as any).pageFixture.completeSave(1));
      await page.getByText('已保存当前 Listing 本地版本。草案只保存在本地，不会自动提交 Amazon。', { exact: true }).waitFor();
      expect(await page.getByText(/private-version-id|private-profile/).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React from 'react';import{createRoot}from'react-dom/client';
import{DataImportValidationPage}from'../../pages/data-import-validation-page';
import{ListingOptimizationPage}from'../../pages/listing-optimization-page';
import{collectionJob}from'../../pages/collection.test-fixtures';
import{useBusinessDataPipeline,DEFAULT_BUSINESS_REPORT_OPTIONS}from'../../components/business-data';
import{MissionControlStoreContextProvider,useMissionControlStoreContext}from'../store-context';import{useScopeStore}from'../../scope-store';
let current='A',generation=1,panel='import',artifacts=false,historyMode='ready';const listeners=[],imports=[],saves=[],pipelineReads=[],jobReads=[],opens=[],histories=[];
const context=()=>({storeId:current,browserProfileId:'profile-'+current,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:generation});
const record=id=>({storeId:id,displayName:'同名店铺',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',browserProfileId:'profile-'+id,status:'active',revision:1,createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z'});
const view=()=>({store:record(current),context:context(),connections:[],sessions:[]});
const authorityApi={listStores:async()=>[record('A'),record('B')],listStoreDailyStatuses:async()=>({stores:[],generatedAt:'2026-10-16T12:00:00.000Z'}),getActiveStoreWorkspaceView:async()=>view(),onStoreContextChanged:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},onStoresChanged:()=>()=>{}};
const pipeline=(scope,marker='')=>({scope,generatedAt:'2026-10-16T12:00:00.000Z',collection:{status:'blocked',latestBatch:null,sourceBatchIds:[],availableBatches:[],reportOptions:DEFAULT_BUSINESS_REPORT_OPTIONS,realReportFiles:[],evidenceArtifacts:[],fileAudit:{realReportFileCount:0,importedRowCount:0,rejectedEvidenceFileCount:0},audit:{databaseReady:true,acceptedExtensions:['.xlsx'],rejectedEvidenceExtensions:['.png'],notes:[]},blockers:[]},quant:{hasImportedMetrics:false,importedRows:0,totalSpend:0,totalSales:0,totalOrders:0},operations:{events:[],notes:marker?[marker]:[]}});
function currentPipeline(scope){const value=pipeline(scope);if(artifacts){value.collection.realReportFiles=DEFAULT_BUSINESS_REPORT_OPTIONS.map(row=>({reportType:row.type,batchId:'fixture-job',artifactId:'fixture-'+row.type,fileName:row.type+'.xlsx',folderArtifactId:'fixture-folder',importedRows:0,status:'downloaded'}));}return value;}
window.electronAPI={
 getStoreRuntimeConfig:async capturedContext=>{
  const current={configId:'software-only-config-'+capturedContext.storeId,storeId:capturedContext.storeId,marketplace:capturedContext.marketplace,currency:capturedContext.currency,businessTimezone:capturedContext.businessTimezone,status:'active',revision:1,
   values:{aiRecommendationsEnabled:false,collectionScheduleLocalTime:'06:00',collectionLookbackDays:7,analysisWindowDays:30,defaultTargetAcosPercent:30,minimumRecommendationConfidencePercent:70,evidenceRetentionDays:30},createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z'};
  return{current,versions:[{revision:1,action:'create',occurredAt:'2026-10-16T12:00:00.000Z',snapshot:{...current,values:{...current.values}}}]};
 },
 getBusinessUiDataPipeline:scope=>panel==='pipeline'?new Promise(resolve=>pipelineReads.push({scope,resolve})):Promise.resolve(currentPipeline(scope)),
 listLingxingCollectionJobs:async input=>{jobReads.push(input.storeContext);if(!artifacts)return[];const job=collectionJob({jobId:'fixture-job',context:input.storeContext,downloadedCount:8,jobState:'completed'});job.request.dateStart='2026-10-01';job.request.dateEnd='2026-10-15';return[job];},
 importLocalBusinessReportFiles:scope=>new Promise(resolve=>imports.push({scope,resolve})),
 openReportArtifact:(id,scope)=>new Promise(resolve=>opens.push({id,scope,resolve})),
 saveManualListingContent:(value,scope)=>new Promise(resolve=>saves.push({value,scope,resolve})),
 listListingContentVersions:async input=>{if(historyMode==='failed')throw new Error('history read unavailable');if(historyMode==='deferred')return new Promise(resolve=>histories.push({input,resolve}));return[];},
 getSettings:async()=>({}),reportRuntimeLog:async()=>{}};
useScopeStore.getState().setScope({dateFrom:'2026-10-01',dateTo:'2026-10-15',storeName:'同名店铺',marketplaceCode:'US',currency:'USD',asin:'B000000001'});
function Authority(){const value=useMissionControlStoreContext();return <output id="fixture-authority">{value.authoritativeContext?.storeId}/{value.authoritativeContext?.sessionGeneration}</output>;}
function Pipeline(){const{data,loading}=useBusinessDataPipeline();return <output id="pipeline-marker">{data?.operations.notes[0]||(loading?'读取中':'无数据')}</output>;}
const root=createRoot(document.getElementById('root'));function render(){root.render(<MissionControlStoreContextProvider api={authorityApi}><Authority/>{panel==='import'?<DataImportValidationPage/>:panel==='listing'?<ListingOptimizationPage/>:<Pipeline/>}</MissionControlStoreContextProvider>);}
window.pageFixture={imports,saves,pipelineReads,opens,ready:()=>jobReads.length>0,panel(value){panel=value;render();},select(id,next=1){current=id;generation=next;listeners.forEach(fn=>fn(view()));},enableArtifacts(){artifacts=true;generation+=1;listeners.forEach(fn=>fn(view()));},historyMode(value){historyMode=value;},completeOpen(index){opens[index].resolve(true);},completeHistory(index){histories[index].resolve([]);},completeImport(index,count){imports[index].resolve({metricsImport:{parsedFiles:1,inserted:count,errors:[]}});},completeSave(index){const call=saves[index];call.resolve({...call.value,versionId:'private-version-id',title:call.value.title});},completePipeline(index,marker){const call=pipelineReads[index];call.resolve(pipeline(call.scope,marker));}};render();
`;
