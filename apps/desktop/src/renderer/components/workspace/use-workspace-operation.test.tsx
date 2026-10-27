import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../../mission-control/workspaces/production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);

describe('shared workspace operation lifecycle', () => {
  it('admits one callback before React renders and keeps peer controls plain disabled in StrictMode', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '保存', exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '保存');
      const busy = page.getByRole('button', { name: '保存中…', exact: true }); await busy.waitFor();
      expect(await busy.getAttribute('aria-busy')).toBe('true');
      const peer = page.getByRole('button', { name: '其他操作', exact: true });
      expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      expect(await page.evaluate(() => (window as any).operationFixture.calls.length)).toBe(1);
      await page.evaluate(() => (window as any).operationFixture.complete(0));
      await page.getByRole('button', { name: '保存', exact: true }).waitFor();
      expect(await page.locator('#operation-result').textContent()).toBe('A:0');
    } finally { await browser.close(); }
  }, 30_000);

  it('does not apply an old A to B to A result or let its finish clear the current busy ticket', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.evaluate(() => (window as any).operationFixture.select('B'));
      await page.locator('#operation-context').filter({ hasText: 'B' }).waitFor();
      await page.evaluate(() => (window as any).operationFixture.select('A'));
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.evaluate(() => (window as any).operationFixture.complete(0));
      expect(await page.getByRole('button', { name: '保存中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.locator('#operation-result').textContent()).toBe('');
      await page.evaluate(() => (window as any).operationFixture.complete(1));
      await page.getByRole('button', { name: '保存', exact: true }).waitFor();
      expect(await page.locator('#operation-result').textContent()).toBe('A:1');
    } finally { await browser.close(); }
  }, 30_000);

  it('retires mounted lifecycle tickets without blocking a fresh StrictMode mount', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.evaluate(() => (window as any).operationFixture.hide());
      await page.getByText('已卸载', { exact: true }).waitFor();
      await page.evaluate(() => (window as any).operationFixture.show());
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await page.evaluate(() => (window as any).operationFixture.complete(0));
      expect(await page.locator('#operation-result').textContent()).toBe('');
      expect(await page.getByRole('button', { name: '保存中…', exact: true }).isDisabled()).toBe(true);
      await page.evaluate(() => (window as any).operationFixture.complete(1));
      await page.getByRole('button', { name: '保存', exact: true }).waitFor();
      expect(await page.locator('#operation-result').textContent()).toBe('A:1');
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React,{StrictMode,useState} from 'react'; import {createRoot} from 'react-dom/client';
import {useWorkspaceOperation} from '../../components/workspace/use-workspace-operation';
import {WorkspaceActionButton} from '../../components/workspace/action-feedback';
const calls=[];let context='A',visible=true;const root=createRoot(document.getElementById('root'));
function Probe({id}){const operation=useWorkspaceOperation(id);const[result,setResult]=useState('');
async function save(){const ticket=operation.begin();if(!ticket)return;try{const value=await new Promise(resolve=>calls.push({id,resolve}));if(ticket.isCurrent())setResult(value);}finally{ticket.finish();}}
return <><output id="operation-context">{id}</output><output id="operation-result">{result}</output><WorkspaceActionButton busy={operation.busy} busyLabel="保存中…" disabledReason="当前保存正在处理，请等待完成。" onClick={save}>保存</WorkspaceActionButton><WorkspaceActionButton disabled={operation.busy} disabledReason="当前保存正在处理，请等待完成。">其他操作</WorkspaceActionButton></>;}
function render(){root.render(<StrictMode>{visible?<Probe id={context}/>:<p>已卸载</p>}</StrictMode>);}
window.operationFixture={calls,select(id){context=id;render();},complete(index){calls[index].resolve(calls[index].id+':'+index);},hide(){visible=false;render();},show(){visible=true;render();}};render();
`;
