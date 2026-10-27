import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);

describe('production Store action feedback', () => {
  it('admits one actual store save before React renders and explains the locked peer and fixed fields', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.locator('[data-capability-id="objects.store.update"]').first().click();
      await page.getByLabel('店铺名称', { exact: true }).fill('当前店铺已编辑');
      const currency = page.getByLabel('币种', { exact: true });
      expect(await currency.getAttribute('readonly')).not.toBeNull();
      const fixedReason = await currency.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${fixedReason}"]`).textContent()).toContain('固定使用美元');
      await invokeActualReactActionTwice(page, '保存变更');
      const busy = page.getByRole('button', { name: '保存中…', exact: true }); await busy.waitFor();
      expect(await busy.getAttribute('aria-busy')).toBe('true');
      expect(await busy.getAttribute('class')).toContain('button-loading');
      const cancel = page.getByRole('dialog').getByRole('button', { name: '取消', exact: true });
      expect(await cancel.isDisabled()).toBe(true);
      expect(await cancel.getAttribute('aria-busy')).toBeNull();
      const reason = await cancel.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待完成');
      expect(await page.evaluate(() => (window as any).storeFixture.calls.length)).toBe(1);
      await page.evaluate(() => (window as any).storeFixture.complete(0));
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    } finally { await browser.close(); }
  }, 30_000);

  it('preserves the current runtime save lock after an old A to B to A response', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.evaluate(() => (window as any).storeFixture.panel('runtime'));
      await page.getByRole('button', { name: '编辑配置', exact: true }).click();
      await page.getByLabel('每日采集时间', { exact: true }).fill('09:00');
      await invokeActualReactActionTwice(page, '保存变更');
      await page.getByRole('button', { name: '保存中…', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).storeFixture.calls.length)).toBe(1);
      await page.evaluate(() => (window as any).storeFixture.select('B'));
      await page.getByRole('button', { name: '编辑配置', exact: true }).waitFor();
      await page.evaluate(() => (window as any).storeFixture.select('A'));
      await page.getByRole('button', { name: '编辑配置', exact: true }).click();
      await page.getByLabel('每日采集时间', { exact: true }).fill('10:00');
      await page.getByRole('button', { name: '保存变更', exact: true }).click();
      await page.evaluate(() => (window as any).storeFixture.complete(0));
      expect(await page.getByRole('button', { name: '保存中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByLabel('每日采集时间', { exact: true }).inputValue()).toBe('10:00');
      expect(await page.evaluate(() => (window as any).storeFixture.calls.length)).toBe(2);
      await page.evaluate(() => (window as any).storeFixture.complete(1));
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps a failed runtime draft recoverable and rejects a returned configuration for another store', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.evaluate(() => (window as any).storeFixture.panel('runtime'));
      await page.getByRole('button', { name: '编辑配置', exact: true }).click();
      await page.getByLabel('每日采集时间', { exact: true }).fill('09:00');
      await page.getByRole('button', { name: '保存变更', exact: true }).click();
      await page.evaluate(() => (window as any).storeFixture.complete(0, 'B'));
      await page.getByRole('button', { name: '保存变更', exact: true }).waitFor();
      expect(await page.getByText('配置返回了其他店铺或业务范围的数据，请重新读取当前店铺。', { exact: true }).isVisible()).toBe(true);
      expect(await page.getByLabel('每日采集时间', { exact: true }).inputValue()).toBe('09:00');
      await page.getByRole('button', { name: '保存变更', exact: true }).click();
      expect(await page.evaluate(() => (window as any).storeFixture.calls.length)).toBe(2);
      await page.evaluate(() => (window as any).storeFixture.complete(1));
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React from 'react'; import { createRoot } from 'react-dom/client';
import { StoreManagementPanel } from '../components/store-management-panel';
import { StoreRuntimeConfigPanel, DEFAULT_STORE_RUNTIME_CONFIG_VALUES } from '../components/store-runtime-config-panel';
let store='A', mode='management'; const calls=[]; const root=createRoot(document.getElementById('root'));
const record=id=>({storeId:id,displayName:'店铺'+id,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',status:'active',revision:1,createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z'});
const config=id=>({configId:'config-'+id,storeId:id,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',status:'active',revision:1,values:{...DEFAULT_STORE_RUNTIME_CONFIG_VALUES},createdAt:'2026-10-16T12:00:00.000Z',updatedAt:'2026-10-16T12:00:00.000Z'});
const projection=id=>({current:config(id),versions:[]});
const defer=(kind,context,input)=>new Promise(resolve=>calls.push({kind,context,input,resolve}));
const api={getStoreRuntimeConfig:async context=>projection(context.storeId),createStoreRuntimeConfig:(c,i)=>defer('create',c,i),updateStoreRuntimeConfig:(c,i)=>defer('runtime',c,i),archiveStoreRuntimeConfig:(c,i)=>defer('archive',c,i),restoreStoreRuntimeConfig:(c,i)=>defer('restore',c,i)};
const render=()=>root.render(mode==='management'?<StoreManagementPanel activeStoreId={store} stores={[record('A'),record('B')]} onUpdate={i=>defer('store',{storeId:store},i)} onArchive={i=>defer('store-archive',{storeId:store},i)} onRestore={i=>defer('store-restore',{storeId:store},i)} />:<StoreRuntimeConfigPanel api={api} storeContext={{storeId:store,browserProfileId:'profile-'+store,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1}} />);
window.storeFixture={calls,panel(value){mode=value;render();},select(id){store=id;render();},complete(index,override){const call=calls[index];const value=projection(override??call.context.storeId);if(call.kind==='runtime'){value.current.revision=2;value.current.values={...value.current.values,...call.input.patch};}call.resolve(value);}};
render();
`;
