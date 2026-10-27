import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './workspaces/production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);
async function confirmAuto(page: Page) {
  await page.getByRole('button', { name: 'AI 策略内自动', exact: true }).click();
  await page.getByRole('textbox', { name: '切换原因', exact: true }).fill('策略已经复核');
  await invokeActualReactActionTwice(page, '确认切换为AI 策略内自动');
}

describe('production Shell mode and navigation action feedback', () => {
  it('admits one mode command before rendering and keeps the peer plain with an explicit waiting reason', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await confirmAuto(page);
      const active = page.getByRole('button', { name: 'AI 策略内自动', exact: true });
      await page.waitForFunction(() => (window as any).shellFixture.calls.length === 1);
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await active.locator('.button-spinner').count()).toBe(1);
      const peer = page.getByRole('button', { name: '人工审批', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      const reason = await peer.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('等待确认结果');
      await page.evaluate(() => (window as any).shellFixture.finish(0, '请求已核验'));
      await page.getByText('请求已核验', { exact: true }).waitFor();
      expect(await active.getAttribute('aria-pressed')).toBe('false');
      expect(await peer.getAttribute('aria-pressed')).toBe('true');
    } finally { await browser.close(); }
  }, 30_000);

  it('drops old A to B to A mode receipts without releasing the current mode command', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await confirmAuto(page);
      await page.evaluate(() => (window as any).shellFixture.select('B', 1, 2));
      await page.locator('#shell-authority').filter({ hasText: 'B/1/2' }).waitFor();
      await page.evaluate(() => (window as any).shellFixture.select('A', 1, 3));
      await page.locator('#shell-authority').filter({ hasText: 'A/1/3' }).waitFor();
      await confirmAuto(page);
      await page.evaluate(() => (window as any).shellFixture.finish(0, '旧模式回执'));
      const active = page.getByRole('button', { name: 'AI 策略内自动', exact: true });
      expect(await active.isDisabled()).toBe(true); expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await page.getByText('旧模式回执', { exact: true }).count()).toBe(0);
      await page.evaluate(() => (window as any).shellFixture.reject(1));
      await page.getByText('模式暂不可用，请重试。', { exact: true }).waitFor();
      expect(await active.isEnabled()).toBe(true);
      expect(await page.evaluate(() => (window as any).shellFixture.logs.some((x: { event: string }) => x.event === 'mission_control.mode_change_failed'))).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps policy availability authoritative and sends no command when the current policy gate is unavailable', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.evaluate(() => (window as any).shellFixture.block());
      await page.getByText('请先发布当前店铺策略。', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'AI 策略内自动', exact: true }).dispatchEvent('click');
      await page.getByRole('textbox', { name: '切换原因', exact: true }).fill('策略已经复核');
      await invokeActualReactActionTwice(page, '确认切换为AI 策略内自动');
      expect(await page.evaluate(() => (window as any).shellFixture.calls.length)).toBe(0);
      await page.getByRole('button', { name: '去策略配置', exact: true }).click();
      expect(await page.evaluate(() => (window as any).shellFixture.visited)).toEqual([{ workspace: 'policy', subview: 'rules' }]);
    } finally { await browser.close(); }
  }, 30_000);

  it('describes the pending navigation to every locked sidebar button while only its actual target is busy', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.evaluate(() => (window as any).shellFixture.navigate());
      const active = page.locator('[data-operator-module="operations-assets"]');
      await page.waitForFunction(() => document.querySelector('[data-operator-module="operations-assets"]')?.getAttribute('aria-busy') === 'true');
      expect(await active.isDisabled()).toBe(true);
      const peer = page.locator('[data-operator-module="today"]');
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      const reason = await peer.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('请等待完成后再选择其他入口');
      expect(await peer.locator('.button-spinner').count()).toBe(0);
      const secondary = page.locator('[data-operator-entry="today/overview"]');
      expect(await secondary.getAttribute('aria-describedby')).toBe(reason);
      await page.evaluate(() => (window as any).shellFixture.finishNavigation());
      await page.waitForFunction(() => !document.querySelector('[data-operator-module="today"]')?.hasAttribute('disabled'));
      expect(await page.locator('#operator-navigation-pending-reason').count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{MissionControlShell}from'../mission-control-shell';
const store=id=>({storeId:id,browserProfileId:'profile-'+id,displayName:'同名店铺',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',status:'active',createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z'});
const context=(id,generation)=>({...store(id),businessDate:'2026-10-16',sessionGeneration:generation});
const calls=[],logs=[],visited=[];let select,block,pending;window.electronAPI={reportRuntimeLog:async record=>logs.push(record)};
function App(){const[v,setValue]=useState({ctx:context('A',1),epoch:1});const[available,setAvailable]=useState(true);const[navigation,setNavigation]=useState(null);select=(id,g,e)=>setValue({ctx:context(id,g),epoch:e});block=()=>setAvailable(false);pending=setNavigation;return <><output id="shell-authority">{v.ctx.storeId}/{v.ctx.sessionGeneration}/{v.epoch}</output><MissionControlShell authoritativeContext={v.ctx} contextEpoch={v.epoch} activeStore={store(v.ctx.storeId)} activeIntent={{workspace:'today',subview:'overview'}} pendingIntent={navigation} stores={['A','B'].map(store)} autonomy={{currentMode:'manual_approval',manualApprovalAvailable:true,policyAutoAvailable:available,policyAutoBlockerDetail:'请先发布当前店铺策略。'}} onSetAutonomyMode={mode=>new Promise((resolve,reject)=>calls.push({mode,resolve,reject}))} onNavigate={intent=>visited.push(intent)} onSwitchStore={()=>{}} onLogout={()=>{}}><p>实际工作区</p></MissionControlShell></>;}
createRoot(document.getElementById('root')).render(<App/>);window.shellFixture={calls,logs,visited,select:(...a)=>select(...a),block:()=>block(),finish(i,detail){calls[i].resolve({status:'ok',detail});},reject(i){calls[i].reject(new Error('模式暂不可用，请重试。'));},navigate(){pending({workspace:'objects',subview:'products'});},finishNavigation(){pending(null);}};
`;
