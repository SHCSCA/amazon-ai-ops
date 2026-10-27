import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './production-action-browser.test-support';
let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);

describe('production Policy action feedback', () => {
  it('shows the actual automatic-mode prerequisite recovery and admits only one disable operation before React renders', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      const disable = page.getByRole('button', { name: '停用', exact: true }); await disable.waitFor();
      const auto = page.getByRole('button', { name: '策略内自动', exact: true });
      expect(await auto.isDisabled()).toBe(true);
      const reason = await auto.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('展开启用条件并逐项处理');
      expect(await page.getByText('查看启用条件', { exact: true }).isVisible()).toBe(true);
      await invokeActualReactActionTwice(page, '停用');
      const busy = page.getByRole('button', { name: '停用中…', exact: true }); await busy.waitFor();
      expect(await busy.getAttribute('aria-busy')).toBe('true');
      expect(await busy.getAttribute('class')).toContain('button-loading');
      expect(await page.evaluate(() => (window as any).policyFixture.calls.length)).toBe(1);
      const edit = page.getByRole('button', { name: '编辑', exact: true });
      expect(await edit.isDisabled()).toBe(true); expect(await edit.getAttribute('aria-busy')).toBeNull();
      await page.evaluate(() => (window as any).policyFixture.complete(0));
      await page.getByText('策略已停用；运行时已回到人工审批。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('does not apply an old A lifecycle result or unlock a current operation after A to B to A', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.getByRole('button', { name: '停用', exact: true }).click();
      await page.evaluate(() => (window as any).policyFixture.select('B'));
      await page.getByRole('heading', { name: '策略B', exact: true }).waitFor();
      await page.evaluate(() => (window as any).policyFixture.select('A'));
      await page.getByRole('heading', { name: '策略A', exact: true }).waitFor();
      await page.getByRole('button', { name: '停用', exact: true }).click();
      await page.evaluate(() => (window as any).policyFixture.complete(0));
      expect(await page.getByRole('button', { name: '停用中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('策略已停用；运行时已回到人工审批。', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).policyFixture.calls.length)).toBe(2);
      await page.evaluate(() => (window as any).policyFixture.complete(1));
      await page.getByText('策略已停用；运行时已回到人工审批。', { exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);
});

const fixture = String.raw`
import React from 'react'; import { createRoot } from 'react-dom/client'; import { PolicyWorkspace } from './policy-workspace';
let store='A'; const calls=[]; const saved=new Map();
const policy = id => ({ id:'POL-'+id, storeId:id, name:'策略'+id, scope:'store', priority:1, status:'active', revision:1,
 createdAt:'2026-10-16T12:00:00.000Z', updatedAt:'2026-10-16T12:00:00.000Z' });
const api={ listPolicies:async c=>[saved.get(c.storeId)??policy(c.storeId)], listPolicyVersions:async()=>[],
 getPolicyRuntime:async()=>({mode:'manual_approval',killSwitch:false,circuitBreakerState:'closed',canAutoExecute:false,revision:1}),
 disablePolicy:(context,input)=>new Promise(resolve=>calls.push({context,input,resolve})) };
window.electronAPI={listStoreProducts:async()=>[],listStoreAdObjects:async()=>[]};
const caps=['version.view','policy.create','policy.update','policy.archive','policy.restore','version.create','version.update','version.enable','version.disable','kill-switch.enable','kill-switch.clear','runtime.mode.set']
 .map(id=>({capabilityId:'policy.'+id,workspace:'policy',view:'policy/rules',action:id.endsWith('.view')?'view':'update',state:'PRODUCTION_NATIVE',detail:'已接入'}));
const root=createRoot(document.getElementById('root')); const render=()=>root.render(<PolicyWorkspace apiOverride={api} capabilities={caps}
 blockedReason="当前条件未满足，请检查策略。" previewMode={false} storeContext={{storeId:store,browserProfileId:'profile-'+store,marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-10-16',sessionGeneration:1}} />);
window.policyFixture={calls,select(id){store=id;render();},complete(index){const call=calls[index];const value={...policy(call.context.storeId),status:'disabled',revision:2};saved.set(call.context.storeId,value);call.resolve(value);}};
render();
`;
