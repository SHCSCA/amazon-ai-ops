import { beforeAll, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { RuntimeLogger } from '../../../main/runtime-logger';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './production-action-browser.test-support';
const bundlePhaseLogger = new RuntimeLogger();
let bundle: string;
let eventBundle: string;
beforeAll(async () => {
  const hookStartedAt = performance.now();
  const traceBundlePhase = async (phase: 'products' | 'events', build: () => Promise<string>): Promise<string> => {
    const startedAt = performance.now();
    const context = { phase, processId: process.pid, clock: 'node:perf_hooks.performance.now', unit: 'ms' };
    bundlePhaseLogger.info('software.objects_bundle_started', { ...context, hookElapsedMs: startedAt - hookStartedAt });
    try {
      const result = await build();
      const finishedAt = performance.now();
      bundlePhaseLogger.info('software.objects_bundle_finished', {
        ...context, phaseElapsedMs: finishedAt - startedAt, hookElapsedMs: finishedAt - hookStartedAt,
      });
      return result;
    } catch (error) {
      const failedAt = performance.now();
      try {
        bundlePhaseLogger.error('software.objects_bundle_failed', {
          ...context, phaseElapsedMs: failedAt - startedAt, hookElapsedMs: failedAt - hookStartedAt, error,
        });
      } finally {
        throw error;
      }
    }
  };
  bundle = await traceBundlePhase('products', () => bundleProductionActionFixture(fixture));
  eventBundle = await traceBundlePhase('events', () => bundleProductionActionFixture(eventFixture));
}, 30_000);

describe('production store object action feedback', () => {
  it('explains an invalid historical product as read-only without disguising it as a missing permission', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      const edit = page.getByRole('button', { name: '编辑 INVALID', exact: true }); await edit.waitFor();
      expect(await edit.isDisabled()).toBe(true);
      const reason = await edit.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('历史产品标识无效，当前只读');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('核对真实 ASIN');
      expect(await page.evaluate(() => (window as any).objectsFixture.calls.length)).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one actual restore before React rendering and marks only the selected row busy', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('checkbox', { name: '包含已归档', exact: true }).check();
      const active = page.getByRole('button', { name: '恢复 B0TEST1234', exact: true }); await active.waitFor();
      await invokeActualReactActionTwice(page, '恢复');
      await page.waitForFunction(() => document.querySelector('[aria-label="恢复 B0TEST1234"]')?.getAttribute('aria-busy') === 'true');
      expect(await active.isDisabled()).toBe(true);
      expect(await active.getAttribute('class')).toContain('button-loading');
      const peer = page.getByRole('button', { name: '恢复 B0TEST1235', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      expect(await peer.getAttribute('class')).not.toContain('button-loading');
      expect(await page.evaluate(() => (window as any).objectsFixture.calls.length)).toBe(1);
      await page.evaluate(() => (window as any).objectsFixture.complete(0));
      await page.getByText('B0TEST1234 已恢复为运行中。', { exact: true }).waitFor();
      expect(await peer.isEnabled()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('discards an old A restore completion across A to B to A while retaining the new A lock', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('checkbox', { name: '包含已归档', exact: true }).check();
      await page.getByRole('button', { name: '恢复 B0TEST1234', exact: true }).click();
      await page.evaluate(() => (window as any).objectsFixture.select('B'));
      await page.getByText('店铺B归档甲', { exact: true }).waitFor();
      await page.evaluate(() => (window as any).objectsFixture.select('A'));
      await page.getByText('店铺A归档甲', { exact: true }).waitFor();
      await page.getByRole('button', { name: '恢复 B0TEST1234', exact: true }).click();
      await page.evaluate(() => (window as any).objectsFixture.complete(0));
      expect(await page.getByRole('button', { name: '恢复 B0TEST1234', exact: true }).getAttribute('aria-busy')).toBe('true');
      expect(await page.getByText('B0TEST1234 已恢复为运行中。', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).objectsFixture.calls.length)).toBe(2);
      await page.evaluate(() => (window as any).objectsFixture.complete(1));
      await page.getByText('B0TEST1234 已恢复为运行中。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('validates and admits one current today events save before rendering with explained plain peers', async () => {
    const { browser, page } = await openProductionActionFixture(eventBundle);
    try {
      await page.getByRole('button', { name: '记录事件', exact: true }).click();
      await page.getByRole('button', { name: '保存事件', exact: true }).click();
      expect(await page.getByText('事件标题不能为空。', { exact: true }).first().isVisible()).toBe(true);
      expect(await page.evaluate(() => (window as any).objectsEventFixture.calls.length)).toBe(0);
      await page.getByLabel('事件标题 *', { exact: true }).fill('当前事件草稿');
      await invokeActualReactActionTwice(page, '保存事件');
      const active = page.getByRole('button', { name: '保存中…', exact: true }); await active.waitFor();
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await active.locator('.button-spinner').count()).toBe(1);
      expect(await page.evaluate(() => (window as any).objectsEventFixture.calls.length)).toBe(1);
      const peer = page.getByRole('button', { name: '刷新', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      const reason = await peer.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待完成');
      await page.evaluate(() => (window as any).objectsEventFixture.complete(0));
      await page.getByText('运营事件“当前事件草稿”已写入当前店铺上下文。', { exact: true }).waitFor();
      expect(await page.getByRole('button', { name: '记录事件', exact: true }).isEnabled()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('does not insert an old today events A to B to A receipt or release the current save', async () => {
    const { browser, page } = await openProductionActionFixture(eventBundle);
    try {
      await page.getByRole('button', { name: '记录事件', exact: true }).click();
      await page.getByLabel('事件标题 *', { exact: true }).fill('旧事件草稿');
      await page.getByRole('button', { name: '保存事件', exact: true }).click();
      await page.evaluate(() => (window as any).objectsEventFixture.select('B'));
      await page.locator('#event-authority').filter({ hasText: 'B' }).waitFor();
      await page.evaluate(() => (window as any).objectsEventFixture.select('A'));
      await page.locator('#event-authority').filter({ hasText: 'A' }).waitFor();
      await page.getByRole('button', { name: '记录事件', exact: true }).click();
      await page.getByLabel('事件标题 *', { exact: true }).fill('当前事件草稿');
      await page.getByRole('button', { name: '保存事件', exact: true }).click();
      await page.evaluate(() => (window as any).objectsEventFixture.complete(0));
      expect(await page.getByRole('button', { name: '保存中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('运营事件“旧事件草稿”已写入当前店铺上下文。', { exact: true }).count()).toBe(0);
      await page.evaluate(() => (window as any).objectsEventFixture.complete(1));
      await page.getByText('运营事件“当前事件草稿”已写入当前店铺上下文。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React from 'react'; import { createRoot } from 'react-dom/client'; import { StoreScopedObjectsPanel } from './store-scoped-objects-panel';
let store='A'; const calls=[];
const products=id=>[1,2,3].map((n)=>({id:n,storeId:id,marketplace_code:'US',store_name:'当前店铺',asin:n===3?'INVALID':n===1?'B0TEST1234':'B0TEST1235',
 asinValid:n!==3,parent_asin:'',msku:'',sku:'',title:n===3?'历史无效产品':'店铺'+id+(n===1?'归档甲':'归档乙'),product_stage:'mature',status:n===3?'active':'archived',
 created_at:'2026-10-16T12:00:00.000Z',updated_at:'2026-10-16T12:00:00.000Z',revision:'revision-'+n}));
window.electronAPI={listStoreProducts:async(c,input)=>products(c.storeId).filter(p=>input.includeArchived||p.status!=='archived'),listStoreOperationEvents:async()=>[],
 updateStoreProduct:(context,input)=>new Promise(resolve=>calls.push({context,input,resolve})),createStoreProduct:async()=>{throw Error('unexpected create');},
 archiveStoreProduct:async()=>{throw Error('unexpected archive');},createStoreOperationEvent:async()=>{},updateStoreOperationEvent:async()=>{},deleteStoreOperationEvent:async()=>{}};
const root=createRoot(document.getElementById('root'));const render=()=>root.render(<StoreScopedObjectsPanel fixedSubview="products" storeContext={{storeId:store,browserProfileId:'profile-'+store,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1}} />);
window.objectsFixture={calls,select(id){store=id;render();},complete(index){const call=calls[index];call.resolve({...products(call.context.storeId).find(p=>p.id===call.input.id),status:'active',revision:'revision-next'});}};
render();
`;

const eventFixture = String.raw`
import React from 'react';import{createRoot}from'react-dom/client';import{StoreScopedObjectsPanel}from'./store-scoped-objects-panel';
let store='A';const calls=[];
const api={listStoreProducts:async()=>[],listStoreOperationEvents:async()=>[],createStoreOperationEvent:(context,input)=>new Promise(resolve=>calls.push({context,input,resolve})),
createStoreProduct:async()=>{throw Error('unexpected product create');},updateStoreProduct:async()=>{throw Error('unexpected product update');},archiveStoreProduct:async()=>{throw Error('unexpected product archive');},
updateStoreOperationEvent:async()=>{throw Error('unexpected event update');},deleteStoreOperationEvent:async()=>{throw Error('unexpected event archive');},reportRuntimeLog:async()=>{}};
window.electronAPI=api;const root=createRoot(document.getElementById('root'));
const render=()=>root.render(<><output id="event-authority">{store}</output><StoreScopedObjectsPanel fixedSubview="events" storeContext={{storeId:store,browserProfileId:'profile-'+store,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1}}/></>);
window.objectsEventFixture={calls,select(id){store=id;render();},complete(index){const call=calls[index];call.resolve({...call.input,id:10+index,storeId:call.context.storeId,storeName:'店铺'+call.context.storeId,marketplaceCode:'US',asinValid:true,evidenceRefValid:true,createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z',archiveRevision:0,revision:'event-revision-'+index});}};
render();
`;
