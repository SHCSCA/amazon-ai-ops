import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../../mission-control/workspaces/production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);

async function settleInitial(page: import('playwright').Page) {
  await page.waitForFunction(() => (window as any).sharedFixture.reads.length === 1);
  await page.evaluate(() => (window as any).sharedFixture.completeRead(0, 1));
  await page.waitForFunction(() => !(document.querySelector('button.secondary-button') as HTMLButtonElement)?.disabled);
}

async function submitTwice(page: import('playwright').Page) {
  await page.evaluate(() => {
    const form = document.querySelector('form') as any;
    const props = form[Object.keys(form).find(key => key.startsWith('__reactProps$'))!];
    props.onSubmit({ preventDefault() {} }); props.onSubmit({ preventDefault() {} });
  });
}

describe('shared production action feedback', () => {
  it('admits one budget save before rendering and keeps refresh plain during save and its readback', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await settleInitial(page);
      await page.getByText('配置或调整本店 AI 预算', { exact: true }).click();
      await submitTwice(page);
      await page.getByRole('button', { name: '正在保存…', exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).sharedFixture.saves.length)).toBe(1);
      const refresh = page.getByRole('button', { name: '刷新费用与预算', exact: true });
      expect(await refresh.isDisabled()).toBe(true);
      expect(await refresh.getAttribute('aria-busy')).toBeNull();
      expect(await page.getByRole('button', { name: '正在保存…', exact: true }).getAttribute('aria-busy')).toBe('true');
      expect(await page.getByLabel('模型名称', { exact: true }).isDisabled()).toBe(true);
      const reasonId = await refresh.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reasonId}"]`).textContent()).toContain('等待完成');
      await page.evaluate(() => (window as any).sharedFixture.completeSave(0));
      await page.waitForFunction(() => (window as any).sharedFixture.reads.length === 2);
      expect(await refresh.getAttribute('aria-busy')).toBeNull();
      expect(await page.getByRole('button', { name: '正在保存…', exact: true }).isDisabled()).toBe(true);
      await page.evaluate(() => (window as any).sharedFixture.completeRead(1, 2));
      await page.getByText('本店 AI 预算已保存并重新读取。报价用于估算，账单未确认时保留未知费用。', { exact: true }).waitFor();
      expect(await page.evaluate(() => (window as any).sharedFixture.saves[0].request.input.expectedRevision)).toBe(1);
    } finally { await browser.close(); }
  }, 30_000);

  it('rejects A to B to A save responses without releasing the current budget operation', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await settleInitial(page);
      await submitTwice(page);
      await page.evaluate(() => (window as any).sharedFixture.select('B'));
      await page.waitForFunction(() => (window as any).sharedFixture.reads.length === 2);
      await page.evaluate(() => (window as any).sharedFixture.completeRead(1, 2));
      await page.waitForFunction(() => !(document.querySelector('button.secondary-button') as HTMLButtonElement)?.disabled);
      await page.evaluate(() => (window as any).sharedFixture.select('A'));
      await page.waitForFunction(() => (window as any).sharedFixture.reads.length === 3);
      await page.evaluate(() => (window as any).sharedFixture.completeRead(2, 3));
      await page.waitForFunction(() => !(document.querySelector('button.secondary-button') as HTMLButtonElement)?.disabled);
      await page.getByText('配置或调整本店 AI 预算', { exact: true }).click();
      await submitTwice(page);
      await page.evaluate(() => (window as any).sharedFixture.completeSave(0));
      expect(await page.getByRole('button', { name: '正在保存…', exact: true }).isDisabled()).toBe(true);
      expect(await page.evaluate(() => (window as any).sharedFixture.reads.length)).toBe(3);
      expect(await page.evaluate(() => (window as any).sharedFixture.saves.length)).toBe(2);
      expect(await page.evaluate(() => (window as any).sharedFixture.saves[1].request.input.expectedRevision)).toBe(3);
      await page.evaluate(() => (window as any).sharedFixture.completeSave(1));
      await page.waitForFunction(() => (window as any).sharedFixture.reads.length === 4);
      await page.evaluate(() => (window as any).sharedFixture.completeRead(3, 4));
      await page.getByText('本店 AI 预算已保存并重新读取。报价用于估算，账单未确认时保留未知费用。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('records a read failure, admits one retry and releases the read lock after recovery', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => (window as any).sharedFixture.reads.length === 1);
      await page.evaluate(() => (window as any).sharedFixture.rejectRead(0));
      await page.getByText('读取 AI 费用失败，请刷新后核对当前预算状态。', { exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '刷新费用与预算');
      expect(await page.evaluate(() => (window as any).sharedFixture.reads.length)).toBe(2);
      await page.getByRole('button', { name: '读取费用中…', exact: true }).waitFor();
      await page.evaluate(() => (window as any).sharedFixture.completeRead(1, 1));
      await page.getByRole('button', { name: '刷新费用与预算', exact: true }).waitFor();
      expect(await page.getByRole('button', { name: '刷新费用与预算', exact: true }).isEnabled()).toBe(true);
      expect(await page.evaluate(() => (window as any).sharedFixture.logs.some((row: { event: string }) => row.event === 'ai_spend.read_failed'))).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('shows empty-reason recovery, traps focus and blocks dismissing a busy confirmation', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await settleInitial(page);
      await page.evaluate(() => (window as any).sharedFixture.panel('reason'));
      await page.getByRole('button', { name: '打开确认' }).click();
      const confirm = page.getByRole('button', { name: '确认决定', exact: true });
      expect(await confirm.isDisabled()).toBe(true);
      const reasonId = await confirm.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reasonId}"]`).textContent()).toBe('至少输入 2 个非空白字符后再确认。');
      await page.getByLabel('复核原因', { exact: true }).fill('已核对');
      await page.getByRole('button', { name: '确认决定', exact: true }).focus();
      await page.keyboard.press('Tab');
      expect(await page.getByLabel('复核原因', { exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
      await page.getByRole('button', { name: '确认决定', exact: true }).click();
      await page.getByRole('button', { name: '确认决定中…', exact: true }).waitFor();
      const busyReasonId = await page.getByLabel('复核原因', { exact: true }).getAttribute('aria-describedby');
      expect(await page.getByLabel('复核原因', { exact: true }).isDisabled()).toBe(true);
      expect(await page.locator(`[id="${busyReasonId}"]`).textContent()).toBe('当前操作正在提交，完成后可继续填写原因。');
      expect(await page.getByRole('button', { name: '取消', exact: true }).getAttribute('aria-busy')).toBeNull();
      await page.keyboard.press('Escape');
      expect(await page.getByRole('alertdialog').count()).toBe(1);
      await page.evaluate(() => (window as any).sharedFixture.completeReason());
      await page.getByRole('alertdialog').waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.activeElement?.textContent === '打开确认');
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps disabled state recovery and a locked inspector close reason visible', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await settleInitial(page);
      await page.evaluate(() => (window as any).sharedFixture.panel('state'));
      const button = page.getByRole('button', { name: '恢复读取', exact: true });
      expect(await button.isDisabled()).toBe(true);
      expect(await button.getAttribute('aria-description')).toBe('请先选择当前店铺，再恢复读取。');
      await page.getByText('请先选择当前店铺，再恢复读取。', { exact: true }).waitFor();
      const close = page.getByRole('button', { name: '关闭详情检查器' });
      expect(await close.isDisabled()).toBe(true);
      const reasonId = await close.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reasonId}"]`).textContent()).toContain('等待完成后关闭详情');
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{AiSpendPanel}from'../../components/workspace/ai-spend-panel';
import{ReasonRequiredDialog}from'../../components/workspace/reason-required-dialog';
import{WorkspaceState}from'../../components/workspace/workspace-state';
import{ResponsiveInspector}from'../../components/workspace/responsive-inspector';
let current='A',surface='budget';const reads=[],saves=[],logs=[];
const context=()=>({storeId:current,browserProfileId:'profile-'+current,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1});
const policy=(storeId,revision)=>({storeId,revision,enabled:true,providerBaseUrl:'https://provider.example/v1',model:'model',windowStartsAt:'2026-10-16T00:00:00.000Z',windowEndsAt:'2026-11-16T00:00:00.000Z',budgetMicrousd:1000000,contextTokenLimit:1000,outputTokenLimit:100,inputMicrousdPerMillion:1000000,outputMicrousdPerMillion:2000000,pricingReference:'https://provider.example/prices',reason:'预算已核对'});
window.electronAPI={v16:{aiSpendGet:request=>new Promise((resolve,reject)=>reads.push({request,resolve,reject})),aiSpendSave:request=>new Promise(resolve=>saves.push({request,resolve}))},reportRuntimeLog:async record=>logs.push(record)};
let completeReason;function Reason(){const[open,setOpen]=useState(false),[busy,setBusy]=useState(false);return <><button onClick={()=>setOpen(true)}>打开确认</button><ReasonRequiredDialog open={open} busy={busy} title="确认经营决定" description="填写业务依据后提交" confirmLabel="确认决定" reasonMinLength={2} onClose={()=>setOpen(false)} onConfirm={()=>{setBusy(true);completeReason=()=>{setBusy(false);setOpen(false);};}}/></>;}
const root=createRoot(document.getElementById('root'));function render(){root.render(surface==='budget'?<AiSpendPanel storeContext={context()}/>:surface==='reason'?<Reason/>:<><WorkspaceState kind="blocked" description="请选择店铺" action={{label:'恢复读取',disabled:true,disabledReason:'请先选择当前店铺，再恢复读取。',onClick(){}}}/><ResponsiveInspector open title="当前对象" busy onClose={()=>{}}><p>处理中</p></ResponsiveInspector></>);}
window.sharedFixture={reads,saves,logs,select(id){current=id;render();},panel(value){surface=value;render();},completeRead(index,revision){const call=reads[index];call.resolve({success:true,data:{policy:policy(call.request.storeContext.storeId,revision),records:[],committedMicrousd:0,reservedMicrousd:0,unknownCount:0,remainingMicrousd:1000000}});},rejectRead(index){reads[index].reject(new Error('fixture read unavailable'));},completeSave(index){const call=saves[index];call.resolve({success:true,data:policy(call.request.storeContext.storeId,2)});},completeReason(){completeReason();}};render();
`;
