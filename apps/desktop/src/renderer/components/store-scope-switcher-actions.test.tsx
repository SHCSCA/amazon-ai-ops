import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);

async function openCreate(page: Page) {
  if (!await page.getByRole('button', { name: '新增店铺', exact: true }).isVisible()) await page.locator('.store-scope-switcher__trigger').click();
  await page.getByRole('button', { name: '新增店铺', exact: true }).click();
  await page.getByRole('textbox', { name: '店铺名称', exact: true }).fill('同名店铺');
}

describe('production store switcher action boundaries', () => {
  it('admits one create before rendering and retains a failed draft with only the submit action busy', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await openCreate(page); await invokeActualReactActionTwice(page, '创建店铺');
      const active = page.getByRole('button', { name: '创建中…', exact: true }); await active.waitFor();
      expect(await active.locator('.button-spinner').count()).toBe(1);
      expect(await page.evaluate(() => (window as any).switchFixture.creates.length)).toBe(1);
      const cancel = page.getByRole('button', { name: '取消', exact: true });
      expect(await cancel.isDisabled()).toBe(true); expect(await cancel.getAttribute('aria-busy')).toBeNull();
      const input = page.getByRole('textbox', { name: '店铺名称', exact: true });
      const reason = await input.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('完成或失败后可继续编辑并重试');
      expect(await page.getByLabel('固定美国站配置').textContent()).toContain('America/Los_Angeles');
      await page.evaluate(() => (window as any).switchFixture.rejectCreate(0));
      await page.getByRole('button', { name: '创建店铺', exact: true }).waitFor();
      expect(await input.inputValue()).toBe('同名店铺');
      expect(await page.evaluate(() => (window as any).switchFixture.logs.some((x: { event: string }) => x.event === 'store_scope.create_failed'))).toBe(true);
      await page.getByRole('button', { name: '创建店铺', exact: true }).click();
      await page.evaluate(() => (window as any).switchFixture.finishCreate(1, '新建回执'));
      await page.getByText('新建回执 已创建', { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).switchFixture.switches.length)).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one switch before rendering and releases the local lock when provider authority commits before its promise', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.locator('[data-store-scope-id="B"]').waitFor();
      await page.evaluate(() => {
        const button = document.querySelector('[data-store-scope-id="B"]') as any;
        const props = button[Object.keys(button).find(x => x.startsWith('__reactProps$'))!]; props.onClick(); props.onClick();
      });
      const active = page.getByRole('option', { name: '同名店铺 切换中…', exact: true }); await active.waitFor();
      expect(await active.locator('.button-spinner').count()).toBe(1);
      expect(await page.evaluate(() => (window as any).switchFixture.switches.length)).toBe(1);
      const peer = page.locator('[data-store-scope-id="A"]');
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      const reason = await peer.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待核验完成');
      await page.evaluate(() => (window as any).switchFixture.select('B', 1, 2));
      await page.locator('#switch-authority').filter({ hasText: 'B/1/2' }).waitFor();
      await page.evaluate(() => (window as any).switchFixture.finishSwitch(0));
      expect(await page.locator('.store-scope-switcher__trigger').isEnabled()).toBe(true);
      await page.locator('.store-scope-switcher__trigger').click();
      const archived = page.locator('[data-store-scope-id="C"]');
      const archivedReason = await archived.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${archivedReason}"]`).textContent()).toContain('管理店铺”恢复');
    } finally { await browser.close(); }
  }, 30_000);

  it('ignores an old same-name A to B to A create receipt without releasing the new create lock', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await openCreate(page); await page.getByRole('button', { name: '创建店铺', exact: true }).click();
      await page.evaluate(() => (window as any).switchFixture.select('B', 1, 2));
      await page.locator('#switch-authority').filter({ hasText: 'B/1/2' }).waitFor();
      await page.evaluate(() => (window as any).switchFixture.select('A', 1, 3));
      await page.locator('#switch-authority').filter({ hasText: 'A/1/3' }).waitFor();
      await openCreate(page); await page.getByRole('button', { name: '创建店铺', exact: true }).click();
      await page.evaluate(() => (window as any).switchFixture.finishCreate(0, '旧回执'));
      expect(await page.getByRole('button', { name: '创建中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('旧回执 已创建', { exact: true }).count()).toBe(0);
      await page.evaluate(() => (window as any).switchFixture.finishCreate(1, '当前回执'));
      await page.getByText('当前回执 已创建', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it.each(['generation', 'epoch'] as const)('invalidates old create results when only the current store %s changes', async dimension => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await openCreate(page); await page.getByRole('button', { name: '创建店铺', exact: true }).click();
      await page.evaluate(kind => (window as any).switchFixture.select('A', kind === 'generation' ? 2 : 1, 2), dimension);
      await page.locator('#switch-authority').filter({ hasText: dimension === 'generation' ? 'A/2/2' : 'A/1/2' }).waitFor();
      await openCreate(page); await page.getByRole('button', { name: '创建店铺', exact: true }).click();
      await page.evaluate(() => (window as any).switchFixture.finishCreate(0, '旧世代'));
      expect(await page.getByRole('button', { name: '创建中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('旧世代 已创建', { exact: true }).count()).toBe(0);
      await page.evaluate(() => (window as any).switchFixture.finishCreate(1, '当前世代'));
      await page.getByText('当前世代 已创建', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one retry before rendering and logs a late failure after unmount without rendering success', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.evaluate(() => (window as any).switchFixture.failPhase());
      await page.getByRole('button', { name: '重试', exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '重试');
      await page.getByRole('button', { name: '读取中…', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).switchFixture.retries.length)).toBe(1);
      await page.evaluate(() => (window as any).switchFixture.unmount());
      await page.evaluate(() => (window as any).switchFixture.rejectRetry(0));
      await page.waitForFunction(() => (window as any).switchFixture.logs.some((x: { event: string }) => x.event === 'store_scope.retry_failed'));
      expect(await page.locator('.store-scope-switcher').count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{StoreScopeSwitcher}from'../../components/store-scope-switcher';
const base={marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',displayName:'同名店铺',status:'active',createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z'};
const store=id=>({...base,storeId:id,browserProfileId:'profile-'+id,status:id==='C'?'archived':'active'});
const context=(id,generation)=>({...store(id),businessDate:'2026-10-16',sessionGeneration:generation});
const creates=[],switches=[],retries=[],logs=[];let select,phase;
window.electronAPI={reportRuntimeLog:async record=>logs.push(record)};
const deferred=(calls,input)=>new Promise((resolve,reject)=>calls.push({input,resolve,reject}));
const root=createRoot(document.getElementById('root'));
function App(){const[value,setValue]=useState({ctx:context('A',1),epoch:1});const[status,setStatus]=useState('ready');select=(id,g,e)=>setValue({ctx:context(id,g),epoch:e});phase=setStatus;return <><output id="switch-authority">{value.ctx.storeId}/{value.ctx.sessionGeneration}/{value.epoch}</output><StoreScopeSwitcher stores={['A','B','C'].map(store)} activeStore={store(value.ctx.storeId)} authoritativeContext={value.ctx} contextEpoch={value.epoch} initiallyExpanded phase={status} error={status==='error'?'读取失败':null} onSwitch={input=>deferred(switches,input)} onCreate={input=>deferred(creates,input)} onRetry={()=>deferred(retries)} onManage={()=>{}}/></>;}
root.render(<App/>);window.switchFixture={creates,switches,retries,logs,select:(...a)=>select(...a),failPhase:()=>phase('error'),finishCreate(i,name){creates[i].resolve({...store('new-'+i),displayName:name});},rejectCreate(i){creates[i].reject(new Error('名称暂不可用，请重试。'));},finishSwitch(i){switches[i].resolve({});},rejectRetry(i){retries[i].reject(new Error('读取失败'));},unmount(){root.unmount();}};
`;
