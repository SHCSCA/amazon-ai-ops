import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);

describe('production Collection action feedback', () => {
  it('locks the real collection page before awaiting its schedule and explains peer controls without marking them busy', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      const start = page.getByRole('button', { name: '重新获取完整 8 类报表', exact: true }).first();
      await start.waitFor(); await page.waitForFunction(() => (window as any).collectionFixture.ready());
      await invokeActualReactActionTwice(page, '重新获取完整 8 类报表');
      const busy = page.getByRole('button', { name: '正在重新获取完整 8 类报表...', exact: true }).first(); await busy.waitFor();
      expect(await busy.getAttribute('aria-busy')).toBe('true');
      expect(await page.evaluate(() => (window as any).collectionFixture.schedules.length)).toBe(1);
      const refresh = page.getByRole('button', { name: '刷新任务', exact: true, includeHidden: true });
      expect(await refresh.isDisabled()).toBe(true); expect(await refresh.getAttribute('aria-busy')).toBeNull();
      const reason = await refresh.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待返回后刷新');
      await page.evaluate(() => (window as any).collectionFixture.schedule(0));
      await page.waitForFunction(() => (window as any).collectionFixture.collects.length === 1);
      await page.evaluate(() => (window as any).collectionFixture.complete(0));
      await start.waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('drops a delayed schedule failure after A to B to A and does not clear the current collection lock', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).collectionFixture.ready());
      await page.getByRole('button', { name: '重新获取完整 8 类报表', exact: true }).first().click();
      await page.evaluate(() => (window as any).collectionFixture.select('B'));
      await page.locator('#fixture-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.evaluate(() => (window as any).collectionFixture.select('A'));
      await page.locator('#fixture-authority').filter({ hasText: 'A/1' }).waitFor();
      await page.getByRole('button', { name: '重新获取完整 8 类报表', exact: true }).first().click();
      await page.evaluate(() => (window as any).collectionFixture.schedule(0));
      await page.waitForFunction(() => (window as any).collectionFixture.schedules[0].settled);
      expect(await page.getByRole('button', { name: '正在重新获取完整 8 类报表...', exact: true }).first().isDisabled()).toBe(true);
      expect(await page.getByText('采集动作未开始。', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).collectionFixture.collects.length)).toBe(0);
      await page.evaluate(() => (window as any).collectionFixture.schedule(1));
      await page.waitForFunction(() => (window as any).collectionFixture.collects.length === 1);
      await page.evaluate(() => (window as any).collectionFixture.complete(0));
      await page.getByRole('button', { name: '重新获取完整 8 类报表', exact: true }).first().waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('re-reads the current ledger after a forward generation without turning the old response into verified facts', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).collectionFixture.ready());
      await page.getByRole('button', { name: '重新获取完整 8 类报表', exact: true }).first().click();
      await page.evaluate(() => (window as any).collectionFixture.schedule(0));
      await page.waitForFunction(() => (window as any).collectionFixture.collects.length === 1);
      await page.evaluate(() => (window as any).collectionFixture.select('A', 2));
      await page.locator('#fixture-authority').filter({ hasText: 'A/2' }).waitFor();
      await page.evaluate(() => (window as any).collectionFixture.complete(0));
      await page.getByText('采集动作已返回；已请求刷新当前店铺账本，请按最新任务状态确认结果。', { exact: true }).first().waitFor();
      expect(await page.evaluate(() => (window as any).collectionFixture.jobReads.at(-1).sessionGeneration)).toBe(2);
      expect(await page.evaluate(() => (window as any).collectionFixture.collects.length)).toBe(1);
      expect(await page.locator('.collection-action-feedback-ready').count()).toBe(0);
      expect(await page.locator('.collection-action-feedback [data-status-tone="ready"]').count()).toBe(0);
      expect(await page.getByText('生产数据已闭合', { exact: true }).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('drops a delayed schedule failure after the actual page unmounts', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).collectionFixture.ready());
      await page.getByRole('button', { name: '重新获取完整 8 类报表', exact: true }).first().click();
      await page.evaluate(() => (window as any).collectionFixture.unmount());
      await page.getByText('已离开采集页面', { exact: true }).waitFor();
      await page.evaluate(() => (window as any).collectionFixture.schedule(0));
      await page.waitForFunction(() => (window as any).collectionFixture.schedules[0].settled);
      expect(await page.getByText('采集动作未开始。', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).collectionFixture.collects.length)).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React from 'react'; import { createRoot } from 'react-dom/client';
import { DataCollectionPage } from '../../pages/data-collection-page';
import { DEFAULT_BUSINESS_REPORT_OPTIONS } from '../../components/business-data';
import { MissionControlStoreContextProvider, useMissionControlStoreContext } from '../store-context';
import { useScopeStore } from '../../scope-store';
let current='A', generation=1; const schedules=[], collects=[], jobReads=[], listeners=[];
const context=()=>({storeId:current,browserProfileId:'profile-'+current,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:generation});
const record=id=>({storeId:id,displayName:'店铺'+id,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',browserProfileId:'profile-'+id,status:'active',revision:1,createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z'});
const view=()=>({store:record(current),context:context(),connections:[],sessions:[]});
const api={listStores:async()=>[record('A'),record('B')],listStoreDailyStatuses:async()=>({stores:[],generatedAt:'2026-10-16T12:00:00.000Z'}),getActiveStoreWorkspaceView:async()=>view(),onStoreContextChanged:fn=>{listeners.push(fn);return()=>listeners.splice(listeners.indexOf(fn),1);},onStoresChanged:()=>()=>{}};
const pipeline=scope=>({scope,generatedAt:'2026-10-16T12:00:00.000Z',collection:{status:'blocked',latestBatch:null,sourceBatchIds:[],availableBatches:[],reportOptions:DEFAULT_BUSINESS_REPORT_OPTIONS,realReportFiles:[],evidenceArtifacts:[],fileAudit:{realReportFileCount:0,importedRowCount:0,rejectedEvidenceFileCount:0},audit:{databaseReady:true,acceptedExtensions:['.xlsx'],rejectedEvidenceExtensions:['.png'],notes:[]},blockers:[]},quant:{importedRows:0},operations:{events:[],notes:[]}});
window.electronAPI={getBusinessUiDataPipeline:async scope=>pipeline(scope),listLingxingCollectionJobs:async input=>{jobReads.push(input.storeContext);return[];},getStoreCollectionSchedule:ctx=>new Promise(resolve=>schedules.push({ctx,resolve,settled:false})),collectLingxingReports:range=>new Promise(resolve=>collects.push({range,resolve})),reportRuntimeLog:async()=>{}};
useScopeStore.getState().setScope({dateFrom:'2026-10-01',dateTo:'2026-10-15',storeName:'店铺A',marketplaceCode:'US',currency:'USD'});
function Authority(){const value=useMissionControlStoreContext();return <output id="fixture-authority">{value.authoritativeContext?.storeId}/{value.authoritativeContext?.sessionGeneration}</output>;}
const root=createRoot(document.getElementById('root'));root.render(<MissionControlStoreContextProvider api={api}><Authority/><DataCollectionPage/></MissionControlStoreContextProvider>);
window.collectionFixture={schedules,collects,jobReads,ready(){return jobReads.length>0;},select(id,nextGeneration=1){current=id;generation=nextGeneration;listeners.forEach(fn=>fn(view()));},schedule(index){const call=schedules[index];call.resolve({storeId:call.ctx.storeId,businessDate:call.ctx.businessDate,enabled:true,state:'due',dateStart:'2026-10-01',dateEnd:'2026-10-15'});queueMicrotask(()=>call.settled=true);},complete(index){collects[index].resolve({files:[],metricsImport:{inserted:0,parsedFiles:0,errors:[]}});},unmount(){root.render(<p>已离开采集页面</p>);}};
`;
