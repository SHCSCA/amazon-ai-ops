import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './production-action-browser.test-support';

const surfaces = ['targets', 'keywords'] as const;
const bundles: Record<string, string> = {};
beforeAll(async () => {
  for (const surface of surfaces) bundles[surface] = await bundleProductionActionFixture(fixture(surface));
}, 30_000);

describe('production native Objects facts action feedback', () => {
  it.each(['targets', 'keywords'] as const)('admits one %s readonly refresh before rendering and explains disabled filters with an active spinner', async surface => {
    const { browser, page } = await openProductionActionFixture(bundles[surface]);
    try {
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
      await page.evaluate(() => (window as any).factsFixture.hold());
      await invokeActualReactActionTwice(page, '刷新');
      const active = page.getByRole('button', { name: '读取中…', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await active.locator('.button-spinner').count()).toBe(1);
      expect(await page.evaluate(() => (window as any).factsFixture.calls.length)).toBe(1);
      const filter = page.getByLabel(surface === 'targets' ? '查询广告对象' : '查询关键词', { exact: true });
      expect(await filter.isDisabled()).toBe(true); expect(await filter.getAttribute('aria-busy')).toBeNull();
      const reason = await filter.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('完成后可修改');
      const buttonReason = await active.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${buttonReason}"]`).textContent()).toContain('当前店铺');
      await page.evaluate(() => (window as any).factsFixture.finish(0, 82));
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
      expect(await filter.isEnabled()).toBe(true);
      expect(await page.locator('.store-fact-metric strong').filter({ hasText: surface === 'targets' ? '82 点击' : '82 / 0' }).count()).toBe(1);
    } finally { await browser.close(); }
  }, 30_000);

  it.each(['targets', 'keywords'] as const)('drops an old same-name %s A to B to A response without clearing the current refresh lock', async surface => {
    const { browser, page } = await openProductionActionFixture(bundles[surface]);
    try {
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
      await page.evaluate(() => (window as any).factsFixture.hold());
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await page.evaluate(() => (window as any).factsFixture.select('B', 1));
      await page.locator('#facts-authority').filter({ hasText: 'B/1' }).waitFor();
      await page.evaluate(() => (window as any).factsFixture.select('A', 1));
      await page.locator('#facts-authority').filter({ hasText: 'A/1' }).waitFor();
      await page.waitForFunction(() => (window as any).factsFixture.calls.length === 3);
      await page.evaluate(() => (window as any).factsFixture.finish(2, 82));
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await page.evaluate(() => (window as any).factsFixture.finish(0, 31));
      expect(await page.getByRole('button', { name: '读取中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('.store-fact-metric strong').filter({ hasText: surface === 'targets' ? '31 点击' : '31 / 0' }).count()).toBe(0);
      await page.evaluate(() => (window as any).factsFixture.finish(3, 90));
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
      expect(await page.locator('.store-fact-metric strong').filter({ hasText: surface === 'targets' ? '90 点击' : '90 / 0' }).count()).toBe(1);
    } finally { await browser.close(); }
  }, 30_000);

  it.each(['targets', 'keywords'] as const)('does not treat same-store same-name %s data from the previous session generation as current facts', async surface => {
    const { browser, page } = await openProductionActionFixture(bundles[surface]);
    try {
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
      await page.evaluate(() => (window as any).factsFixture.hold());
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await page.evaluate(() => (window as any).factsFixture.select('A', 2));
      await page.locator('#facts-authority').filter({ hasText: 'A/2' }).waitFor();
      await page.waitForFunction(() => (window as any).factsFixture.calls.length === 2);
      await page.evaluate(() => (window as any).factsFixture.finish(0, 31));
      expect(await page.getByRole('button', { name: '读取中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('.store-fact-metric strong').filter({ hasText: surface === 'targets' ? '31 点击' : '31 / 0' }).count()).toBe(0);
      await page.evaluate(() => (window as any).factsFixture.finish(1, 82));
      await page.getByRole('button', { name: '刷新', exact: true }).waitFor();
      expect(await page.locator('.store-fact-metric strong').filter({ hasText: surface === 'targets' ? '82 点击' : '82 / 0' }).count()).toBe(1);
    } finally { await browser.close(); }
  }, 30_000);
});

function fixture(surface: typeof surfaces[number]) {
  return String.raw`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{StoreScopedAdObjectsPanel}from'./store-scoped-ad-objects-panel';
import{StoreScopedKeywordFactsPanel}from'./store-scoped-keyword-facts-panel';
let change,held=false;const calls=[];
const context=(storeId='A',sessionGeneration=1)=>({storeId,browserProfileId:'profile-'+storeId,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration});
function rows(ctx,clicks){return [{storeId:ctx.storeId,marketplace:'US',currency:'USD',kind:'campaign',objectKey:'campaign-'+ctx.storeId,entityId:'entity-'+ctx.storeId,name:'同名广告活动',campaignName:'同名广告活动',keyword:'同名关键词',asin:'B000000001',impressions:100,clicks,spend:0,orders:0,sales:0,acos:0,cpc:0,cvr:0,sourceRowCount:1,sourceFileCount:1,reportTypeCount:1,riskFlags:[],recommendedSections:[]}];}
function read(ctx,input){if(!held)return Promise.resolve(rows(ctx,7));return new Promise(resolve=>calls.push({ctx:{...ctx},input,resolve}));}
const api={listStoreAdObjects:read,listStoreKeywordFacts:read};
window.electronAPI={reportRuntimeLog:async()=>{}};
function App(){const[ctx,setContext]=useState(context());change=setContext;return <><output id="facts-authority">{ctx.storeId}/{ctx.sessionGeneration}</output>{${JSON.stringify(surface)}==='targets'?<StoreScopedAdObjectsPanel storeContext={ctx} api={api}/>:<StoreScopedKeywordFactsPanel storeContext={ctx} api={api}/>}</>;}
createRoot(document.getElementById('root')).render(<App/>);
window.factsFixture={calls,hold(){held=true;},select(id,generation){change(context(id,generation));},finish(index,clicks){const call=calls[index];call.resolve(rows(call.ctx,clicks));}};
`;
}
