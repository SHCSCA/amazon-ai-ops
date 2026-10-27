import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';
import { productionPageFeedbackFixture, type PageFeedbackFixture } from './production-page-feedback.test-support';
const bundles = new Map<PageFeedbackFixture, string>();
beforeAll(async () => { for (const panel of ['diagnosis', 'keyword', 'dashboard', 'decisions', 'approval', 'readback'] as const) bundles.set(panel, await bundleProductionActionFixture(productionPageFeedbackFixture(panel) + (panel === 'readback' ? readbackPipelineBoundaryFixture : ''))); }, 60_000);
async function open(panel: PageFeedbackFixture) { const fixture = await openProductionActionFixture(bundles.get(panel)!); await fixture.page.locator('#fixture-authority').filter({ hasText: 'A/1' }).waitFor(); return fixture; }
async function calls(page: Page, kind: string) { return page.evaluate(kind => (window as any).pageFeedback.calls[kind].length, kind); }
async function reason(page: Page, button: ReturnType<Page['getByRole']>) { const id = await button.getAttribute('aria-describedby'); expect(id).toBeTruthy(); return page.locator(`[id="${id}"]`).textContent(); }
async function select(page: Page, id: string, generation = 1) { await page.evaluate(({ id, generation }) => (window as any).pageFeedback.select(id, generation), { id, generation }); await page.locator('#fixture-authority').filter({ hasText: `${id}/${generation}` }).waitFor(); }
async function complete(page: Page, kind: string, index: number, value = '', failed = false) { await page.evaluate(input => (window as any).pageFeedback.complete(input.kind, input.index, input.value, input.failed), { kind, index, value, failed }); }


const readbackPipelineBoundaryFixture = String.raw`
// 只延迟隔离夹具的管线返回，并记录真实页面提交，不替换生产页面与操作门。
const readbackPipelineGates=[];
const readbackBasePipeline=api.getBusinessUiDataPipeline;
api.getBusinessUiDataPipeline=input=>{
 const gate=readbackPipelineGates.find(item=>item.phase==='armed'&&item.generation===input.storeContext.sessionGeneration&&item.batchId===(input.batchId||''));
 if(!gate)return readbackBasePipeline(input);
 gate.input=input;gate.phase='waiting';return new Promise(resolve=>{gate.resolve=resolve;});
};
function committedReadbackCollection(collection){
 const container=document.getElementById('root'),internal=root._internalRoot;
 if(!container||internal?.containerInfo!==container||!container.querySelector('[data-workspace="readback"]')?.isConnected)return null;
 const stack=[internal.current],seen=new Set();let component=null;
 for(let count=0;stack.length&&count<1000;count++){
  const fiber=stack.pop();if(!fiber||seen.has(fiber))continue;seen.add(fiber);
  if(fiber.type===ReadbackPage){component=fiber;break;}
  if(fiber.sibling)stack.push(fiber.sibling);if(fiber.child)stack.push(fiber.child);
 }
 if(!component)return null;
 let hook=component.memoizedState,match=null,matches=0;
 for(let index=0;hook&&index<256;index++,hook=hook.next){if(hook.memoizedState?.collection===collection){match={hookIndex:index,mounted:true,collectionMatched:true};matches++;}}
 return matches===1?match:null;
}
function recordReadbackCommit(id,phase,actualDuration,baseDuration,startTime,commitTime){
 for(const gate of readbackPipelineGates){
  if(gate.phase!=='released'||startTime<gate.releasedAt)continue;
  const observation=committedReadbackCollection(gate.result.collection);if(!observation)continue;
  gate.phase='committed';gate.commit={id,phase,startTime,commitTime,releasedAt:gate.releasedAt,storeContext:{...gate.input.storeContext},batchId:gate.result.collection.latestBatch.id,...observation};
 }
}
Object.assign(window.pageFeedback,{
 readbackPipelineGates,
 armReadbackPipeline(generation,batchId){const id=readbackPipelineGates.length;readbackPipelineGates.push({id,generation,batchId,phase:'armed'});return id;},
 releaseReadbackPipeline(id,batchId){const gate=readbackPipelineGates[id];if(gate?.phase!=='waiting')throw new Error('READBACK_PIPELINE_GATE_NOT_WAITING');const result=pipeline(gate.input);result.collection.latestBatch.id=batchId;result.collection.sourceBatchIds=[batchId];gate.result=result;gate.releasedAt=performance.now();gate.phase='released';gate.resolve(result);},
 setReadbackScopeBatch(batchId){useScopeStore.getState().setScope({batchId});},
 reloadReadbackPipeline(){window.dispatchEvent(new Event('business-ui:data-updated'));}
});
root.render(<MissionControlStoreContextProvider api={provider}><React.Profiler id="actual-readback" onRender={recordReadbackCommit}><Content/></React.Profiler></MissionControlStoreContextProvider>);
`;

async function waitForReadbackPipelineCommit(page: Page, id: number) {
  await page.waitForFunction(id => (window as any).pageFeedback.readbackPipelineGates[id]?.phase === 'committed', id);
  const commit = await page.evaluate(id => (window as any).pageFeedback.readbackPipelineGates[id].commit, id);
  expect(commit.id).toBe('actual-readback');
  expect(commit.mounted).toBe(true); expect(commit.collectionMatched).toBe(true);
  expect(commit.startTime).toBeGreaterThanOrEqual(commit.releasedAt);
  expect(commit.commitTime).toBeGreaterThanOrEqual(commit.startTime);
  return commit;
}


async function recordControlInventory(page: Page, label: string) {
  const controls = await page.evaluate(() => [...document.querySelectorAll('button,input,select,textarea,[role="button"]')].map((node, index) => {
    const element = node as HTMLButtonElement;
    const fieldset = element.closest('fieldset:disabled');
    const visible = element.checkVisibility() && !element.closest('[hidden],[inert]');
    const disabled = element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true';
    const describe = (element.getAttribute('aria-describedby') || fieldset?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const reason = describe.map(id => document.getElementById(id)?.textContent || '').join(' ') || element.getAttribute('aria-description') || '';
    return { index, tag: element.tagName, label: element.getAttribute('aria-label') || element.textContent?.trim() || element.getAttribute('placeholder') || element.getAttribute('name') || '', visible, disabled, reason,
      busy: element.getAttribute('aria-busy') === 'true', spinnerCount: element.querySelectorAll('.button-spinner,.workspace-spinner').length };
  }));
  const folder = path.resolve('output/development-completion-2026-10-16/renderer-pages/control-inventory'); mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, label + '.json'), JSON.stringify({ schema: 'production-page-control-inventory/1', label, controls }, null, 2));
  expect(controls.filter(control => control.visible && control.disabled && !control.reason)).toEqual([]);
}

describe('legacy production page action feedback', () => {
  it('admits one actual AdQuant AI request before React renders and shows active spinner with plain peers', async () => {
    const { browser, page } = await open('diagnosis');
    try {
      await page.getByRole('button', { name: '运行 AI 阶段分析', exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '运行 AI 阶段分析');
      const active = page.getByRole('button', { name: 'AI 分析中...', exact: true }); await active.waitFor();
      await recordControlInventory(page, 'diagnosis-active');
      expect(await calls(page, 'diagnosis')).toBe(1); expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await active.locator('.button-spinner, .workspace-spinner').count()).toBe(1);
      const peer = page.getByRole('button', { name: '补充运营事件', exact: true }); expect(await peer.isDisabled()).toBe(true);
      expect(await peer.getAttribute('aria-busy')).toBeNull(); expect(await reason(page, peer)).toContain('等待完成');
      await complete(page, 'diagnosis', 0, '故障信息', true); await page.getByRole('button', { name: '重新运行 AI', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps the current AdQuant operation locked after an old same-label A to B to A result', async () => {
    const { browser, page } = await open('diagnosis');
    try {
      await page.getByRole('button', { name: '运行 AI 阶段分析', exact: true }).click();
      await select(page, 'B'); await page.getByRole('button', { name: '运行 AI 阶段分析', exact: true }).waitFor();
      await select(page, 'A'); await page.getByRole('button', { name: '运行 AI 阶段分析', exact: true }).click();
      await complete(page, 'diagnosis', 0, '旧店铺结果');
      const active = page.getByRole('button', { name: 'AI 分析中...', exact: true }); expect(await active.isDisabled()).toBe(true);
      expect(await page.getByText('旧店铺结果', { exact: true }).count()).toBe(0); expect(await calls(page, 'diagnosis')).toBe(2);
      await complete(page, 'diagnosis', 1, '当前错误', true); await page.getByRole('button', { name: '重新运行 AI', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one actual keyword refresh and explains disabled filter and peer actions', async () => {
    const { browser, page } = await open('keyword');
    try {
      const refresh = page.getByRole('button', { name: '刷新机会', exact: true }).last(); await refresh.waitFor();
      const clear = page.getByRole('button', { name: '清空筛选', exact: true }).first(); expect(await clear.isDisabled()).toBe(true);
      expect(await reason(page, clear)).toContain('当前没有筛选条件');
      await page.evaluate(() => (window as any).pageFeedback.holdKeyword()); await invokeActualReactActionTwice(page, '刷新机会');
      const active = page.getByRole('button', { name: '刷新中...', exact: true }).last(); await active.waitFor();
      await recordControlInventory(page, 'keyword-active');
      expect(await calls(page, 'keyword')).toBe(1); expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await active.locator('.button-spinner').count()).toBe(1);
      await complete(page, 'keyword', 0, '读取失败', true); await refresh.waitFor(); expect(await refresh.isEnabled()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('rejects old keyword results across canonical session generation change with unchanged display scope', async () => {
    const { browser, page } = await open('keyword');
    try {
      await page.getByRole('button', { name: '刷新机会', exact: true }).last().waitFor();
      await page.evaluate(() => (window as any).pageFeedback.holdKeyword()); await page.getByRole('button', { name: '刷新机会', exact: true }).last().click();
      await select(page, 'A', 2); await page.waitForFunction(() => (window as any).pageFeedback.calls.keyword.length === 2);
      await complete(page, 'keyword', 0, '旧会话关键词'); expect(await page.getByRole('button', { name: '刷新中...', exact: true }).last().isDisabled()).toBe(true);
      expect(await page.getByText('旧会话关键词', { exact: true }).count()).toBe(0);
      await complete(page, 'keyword', 1, '当前会话关键词'); await page.getByText('当前会话关键词', { exact: true }).first().waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one actual Dashboard artifact open and reports bridge absence without false success', async () => {
    const { browser, page } = await open('dashboard');
    try {
      await page.getByText('数据、产品历史与交付明细', { exact: true }).click();
      await page.getByRole('button', { name: '打开', exact: true }).first().waitFor();
      await invokeActualReactActionTwice(page, '打开'); expect(await calls(page, 'open')).toBe(1);
      const active = page.getByRole('button', { name: '打开中...', exact: true }); await active.waitFor();
      await recordControlInventory(page, 'dashboard-active');
      expect(await active.getAttribute('aria-busy')).toBe('true'); expect(await active.locator('.button-spinner').count()).toBe(1);
      await complete(page, 'open', 0); await page.getByText(/已请求打开/).waitFor();
      await page.evaluate(() => (window as any).pageFeedback.missingOpen()); await page.getByRole('button', { name: '打开', exact: true }).first().click();
      await page.getByText(/打开失败/).waitFor(); expect(await page.getByText(/已请求打开/).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one actual Decisions rejection and keeps fields and peer buttons truthfully locked', async () => {
    const { browser, page } = await open('decisions');
    try {
      await page.getByRole('button', { name: /打开首条待审批建议/ }).waitFor(); await page.getByRole('button', { name: /打开首条待审批建议/ }).click();
      await page.getByPlaceholder('填写姓名', { exact: true }).fill('组件测试处理人'); await page.getByPlaceholder(/拒绝时必须填写具体原因/).fill('组件测试拒绝原因');
      await invokeActualReactActionTwice(page, '拒绝建议'); const active = page.getByRole('button', { name: '正在拒绝…', exact: true }); await active.waitFor();
      await recordControlInventory(page, 'decisions-active');
      expect(await calls(page, 'decision')).toBe(1); expect(await active.locator('.button-spinner').count()).toBe(1);
      const peer = page.getByRole('button', { name: '批准建议（不执行 Ads）', exact: true }); expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      expect(await reason(page, peer)).toContain('等待本次操作完成'); expect(await page.getByPlaceholder('填写姓名', { exact: true }).isDisabled()).toBe(true);
      await complete(page, 'decision', 0, '操作失败', true); await page.getByRole('button', { name: '刷新权威队列', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('does not publish old Decisions failure or clear current busy after canonical A to B to A', async () => {
    const { browser, page } = await open('decisions');
    try {
      async function reject() { await page.getByRole('button', { name: /打开首条待审批建议/ }).click(); await page.getByPlaceholder('填写姓名', { exact: true }).fill('组件测试处理人'); await page.getByPlaceholder(/拒绝时必须填写具体原因/).fill('组件测试拒绝原因'); await page.getByRole('button', { name: '拒绝建议', exact: true }).click(); }
      await reject(); await select(page, 'B'); await page.getByRole('button', { name: /打开首条待审批建议/ }).waitFor(); await select(page, 'A'); await reject();
      await complete(page, 'decision', 0, '旧决定错误', true); expect(await page.getByRole('button', { name: '正在拒绝…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText(/旧决定错误/).count()).toBe(0); expect(await calls(page, 'decision')).toBe(2);
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one actual legacy Approval rejection with active spinner and plain approval peer', async () => {
    const { browser, page } = await open('approval');
    try {
      await page.getByRole('button', { name: '处理', exact: true }).click(); await page.getByPlaceholder('负责人姓名').fill('组件测试处理人'); await page.getByPlaceholder(/记录审批范围/).fill('组件测试拒绝原因');
      await invokeActualReactActionTwice(page, '拒绝'); const active = page.getByRole('button', { name: '处理中...', exact: true }); await active.waitFor();
      await recordControlInventory(page, 'approval-active');
      expect(await calls(page, 'decision')).toBe(1); expect(await active.getAttribute('aria-busy')).toBe('true'); expect(await active.locator('.button-spinner').count()).toBe(1);
      const peer = page.getByRole('button', { name: '批准，进入结果核对', exact: true }); expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull(); expect(await reason(page, peer)).toContain('等待本次处理完成');
      expect(await page.getByPlaceholder('负责人姓名').isDisabled()).toBe(true); await complete(page, 'decision', 0, '本地审批失败', true); await page.getByRole('button', { name: '拒绝', exact: true }).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('explains actual Readback prerequisites and admits one evidence export before React renders', async () => {
    const { browser, page } = await open('readback');
    try {
      await page.getByRole('button', { name: '载入', exact: true }).click(); await page.getByRole('button', { name: '查看技术与证据详情', exact: true }).click();
      const prepare = page.getByRole('button', { name: '创建回读工作包', exact: true }); expect(await prepare.isDisabled()).toBe(true); expect(await reason(page, prepare)).toContain('导出缺口草稿');
      await invokeActualReactActionTwice(page, '导出回读证据'); const active = page.getByRole('button', { name: '导出中...', exact: true }); await active.waitFor();
      await recordControlInventory(page, 'readback-active');
      expect(await calls(page, 'export')).toBe(1); expect(await active.getAttribute('aria-busy')).toBe('true'); expect(await active.locator('.button-spinner').count()).toBe(1);
      expect(await prepare.getAttribute('aria-busy')).toBeNull(); await complete(page, 'export', 0); await prepare.waitFor(); expect(await prepare.isEnabled()).toBe(true);
      await invokeActualReactActionTwice(page, '复制创建工作包命令'); expect(await calls(page, 'copy')).toBe(1); await complete(page, 'copy', 0, '剪贴板拒绝', true);
      await page.getByText(/复制工作包命令失败/).first().waitFor(); expect(await page.evaluate(() => (window as any).pageFeedback.logs.length)).toBeGreaterThan(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('isolates actual Readback old evidence export and old finish across session generation changes', async () => {
    const { browser, page } = await open('readback');
    try {
      async function exportEvidence() { await page.getByRole('button', { name: '载入', exact: true }).click(); await page.getByRole('button', { name: '查看技术与证据详情', exact: true }).click(); await page.getByRole('button', { name: '导出回读证据', exact: true }).click(); }
      await exportEvidence();
      const gate = await page.evaluate(() => (window as any).pageFeedback.armReadbackPipeline(2, 'batch-20260714'));
      await select(page, 'A', 2); await exportEvidence();
      await page.getByRole('button', { name: '导出中...', exact: true }).waitFor();
      await page.waitForFunction(id => (window as any).pageFeedback.readbackPipelineGates[id]?.phase === 'waiting', gate);
      await page.evaluate(id => (window as any).pageFeedback.releaseReadbackPipeline(id, 'batch-20260714'), gate);
      const commit = await waitForReadbackPipelineCommit(page, gate);
      expect(commit.storeContext.sessionGeneration).toBe(2); expect(commit.batchId).toBe('batch-20260714');
      await complete(page, 'export', 0, 'F:/isolated/old-result.json');
      expect(await page.getByText('F:/isolated/old-result.json', { exact: true }).count()).toBe(0); expect(await page.getByRole('button', { name: '导出中...', exact: true }).isDisabled()).toBe(true); expect(await calls(page, 'export')).toBe(2);
    } finally { await browser.close(); }
  }, 30_000);


  it('retires actual Readback pending evidence when the effective fallback batch changes', async () => {
    const { browser, page } = await open('readback');
    try {
      const initial = await page.evaluate(() => { const id = (window as any).pageFeedback.armReadbackPipeline(1, ''); (window as any).pageFeedback.setReadbackScopeBatch(''); return id; });
      await page.getByText('当前有效批次：暂无', { exact: true }).waitFor();
      await page.waitForFunction(id => (window as any).pageFeedback.readbackPipelineGates[id]?.phase === 'waiting', initial);
      await page.evaluate(id => (window as any).pageFeedback.releaseReadbackPipeline(id, 'batch-20260714'), initial);
      await waitForReadbackPipelineCommit(page, initial);
      await page.getByText('当前有效批次：batch-20260714', { exact: true }).waitFor();
      await page.getByRole('button', { name: '载入', exact: true }).click();
      await page.getByRole('button', { name: '查看技术与证据详情', exact: true }).click();
      await page.getByRole('button', { name: '导出回读证据', exact: true }).click();
      await page.getByRole('button', { name: '导出中...', exact: true }).waitFor();
      const next = await page.evaluate(() => { const id = (window as any).pageFeedback.armReadbackPipeline(1, ''); (window as any).pageFeedback.reloadReadbackPipeline(); return id; });
      await page.waitForFunction(id => (window as any).pageFeedback.readbackPipelineGates[id]?.phase === 'waiting', next);
      await page.evaluate(id => (window as any).pageFeedback.releaseReadbackPipeline(id, 'batch-20260715'), next);
      const commit = await waitForReadbackPipelineCommit(page, next);
      expect(commit.batchId).toBe('batch-20260715');
      await page.getByText('当前有效批次：batch-20260715', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看技术与证据详情', exact: true }).waitFor();
      await complete(page, 'export', 0, 'F:/isolated/old-batch-result.json');
      expect(await page.getByText('F:/isolated/old-batch-result.json', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: '导出中...', exact: true }).count()).toBe(0);
      expect(await calls(page, 'export')).toBe(1);
    } finally { await browser.close(); }
  }, 30_000);

  it('does not publish a stale Dashboard open completion or unlock a newer artifact operation', async () => {
    const { browser, page } = await open('dashboard');
    try {
      await page.getByText('数据、产品历史与交付明细', { exact: true }).click();
      await page.getByRole('button', { name: '打开', exact: true }).first().click();
      await select(page, 'B'); await page.getByRole('button', { name: '打开', exact: true }).first().waitFor();
      await select(page, 'A'); await page.getByRole('button', { name: '打开', exact: true }).first().click();
      await complete(page, 'open', 0); const active = page.getByRole('button', { name: '打开中...', exact: true });
      expect(await active.isDisabled()).toBe(true); expect(await page.getByText(/已请求打开/).count()).toBe(0);
      const peer = page.getByRole('button', { name: '打开', exact: true }).first(); expect(await peer.isDisabled()).toBe(true);
      expect(await peer.getAttribute('aria-busy')).toBeNull(); expect(await reason(page, peer)).toContain('等待本次操作完成');
      await complete(page, 'open', 1, '组件测试打开失败', true); await page.getByText(/打开失败/).waitFor();
    } finally { await browser.close(); }
  }, 30_000);

  it('stops the actual Decisions discovery chain after its first awaited context becomes stale', async () => {
    const { browser, page } = await open('decisions');
    try {
      await page.getByRole('button', { name: '打开首条待审批建议', exact: true }).waitFor();
      await page.evaluate(() => (window as any).pageFeedback.unbound()); await page.locator('#fixture-authority').filter({ hasText: 'A/2' }).waitFor();
      await page.getByRole('button', { name: '核验首条 Ads 对象', exact: true }).click();
      await page.evaluate(() => (window as any).pageFeedback.holdContext());
      await invokeActualReactActionTwice(page, '从当前 Ads 页面识别（只读）');
      expect(await calls(page, 'active')).toBe(1); expect(await calls(page, 'discovery')).toBe(0); expect(await calls(page, 'decision')).toBe(0);
      const busy = page.getByRole('button', { name: '正在发现对象…', exact: true }); expect(await busy.getAttribute('aria-busy')).toBe('true');
      expect(await busy.locator('.button-spinner').count()).toBe(1);
      const peer = page.getByRole('button', { name: '确认对象绑定（仍待审批）', exact: true }); expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull();
      expect(await reason(page, peer)).toContain('等待本次操作完成');
      await recordControlInventory(page, 'decisions-target-discovery-active');
      await select(page, 'B'); await complete(page, 'active', 0); expect(await calls(page, 'discovery')).toBe(0);
      expect(await page.getByText(/已从当前店铺 Ads 页面识别/).count()).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps a new legacy Approval action busy after an old rejected promise from A to B to A', async () => {
    const { browser, page } = await open('approval');
    try {
      async function reject() { await page.getByRole('button', { name: '处理', exact: true }).click(); await page.getByPlaceholder('负责人姓名').fill('组件测试处理人'); await page.getByPlaceholder(/记录审批范围/).fill('组件测试拒绝原因'); await page.getByRole('button', { name: '拒绝', exact: true }).click(); }
      await reject(); await select(page, 'B'); await page.getByRole('button', { name: '处理', exact: true }).waitFor(); await select(page, 'A'); await reject();
      await complete(page, 'decision', 0, '旧人工决定错误', true);
      expect(await page.getByRole('button', { name: '处理中...', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText(/旧人工决定错误/).count()).toBe(0); expect(await calls(page, 'decision')).toBe(2);
      expect(await page.getByPlaceholder('负责人姓名').inputValue()).toBe('组件测试处理人');
    } finally { await browser.close(); }
  }, 30_000);

  it('locks actual Readback fields with a readable top-store recovery when canonical authority disappears', async () => {
    const { browser, page } = await open('readback');
    try {
      await page.getByRole('button', { name: '载入', exact: true }).waitFor(); await page.evaluate(() => (window as any).pageFeedback.clearAuthority());
      await page.getByText('当前店铺权威尚未就绪，请在顶部选择店铺并重新连接后重试。', { exact: true }).first().waitFor();
      const fields = page.locator('.readback-workbench-fieldset'); expect(await fields.isDisabled()).toBe(true);
      const id = await fields.getAttribute('aria-describedby'); expect(await page.locator(`[id="${id}"]`).textContent()).toContain('顶部选择店铺并重新连接');
      expect(await calls(page, 'export')).toBe(0); expect(await calls(page, 'decision')).toBe(0);
      const choose = page.getByRole('button', { name: '选择已批准动作', exact: true }); expect(await choose.isDisabled()).toBe(true); expect(await reason(page, choose)).toContain('顶部选择店铺并重新连接');
    } finally { await browser.close(); }
  }, 30_000);

  it('shows an actual Readback export bridge failure beside the initiating control and releases the ticket', async () => {
    const { browser, page } = await open('readback');
    try {
      await page.getByRole('button', { name: '载入', exact: true }).click(); await page.getByRole('button', { name: '查看技术与证据详情', exact: true }).click();
      await page.evaluate(() => (window as any).pageFeedback.missingExport()); await page.getByRole('button', { name: '导出回读证据', exact: true }).click();
      await page.locator('.readback-technical-drawer').getByText(/功能入口尚未连接到桌面端接口/).first().waitFor(); expect(await page.getByRole('button', { name: '导出回读证据', exact: true }).isEnabled()).toBe(true);
      expect(await calls(page, 'export')).toBe(0); expect(await page.evaluate(() => (window as any).pageFeedback.logs.length)).toBeGreaterThan(0);
    } finally { await browser.close(); }
  }, 30_000);


  it('shows busy only on the actual Approval strip initiator while the same-action form button stays a plain peer', async () => {
    const { browser, page } = await open('approval');
    try {
      await page.getByRole('button', { name: '处理', exact: true }).click(); await page.getByPlaceholder('负责人姓名').fill('组件测试处理人'); await page.getByPlaceholder(/记录审批范围/).fill('组件测试拒绝原因');
      const initiator = page.locator('[data-decision-action="true"]').filter({ hasText: '拒绝，不进入结果核对' });
      const text = await initiator.textContent(); await invokeActualReactActionTwice(page, text!.trim());
      const active = page.locator('[data-decision-action="true"][aria-busy="true"]'); await active.waitFor();
      expect(await active.locator('.button-spinner').count()).toBe(1); expect(await calls(page, 'decision')).toBe(1);
      const formPeer = page.getByRole('button', { name: '拒绝', exact: true }); expect(await formPeer.isDisabled()).toBe(true); expect(await formPeer.getAttribute('aria-busy')).toBeNull(); expect(await formPeer.locator('.button-spinner').count()).toBe(0);
      await recordControlInventory(page, 'approval-strip-active'); await complete(page, 'decision', 0, '组件测试失败', true); await formPeer.waitFor(); expect(await formPeer.isEnabled()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('keeps the Keyword task alias plain while a toolbar refresh is running', async () => {
    const { browser, page } = await open('keyword');
    try {
      await page.getByRole('button', { name: '刷新机会', exact: true }).last().waitFor(); await page.evaluate(() => (window as any).pageFeedback.holdKeyword());
      await page.getByRole('button', { name: '刷新机会', exact: true }).last().click();
      const active = page.getByRole('button', { name: '刷新中...', exact: true }); await active.waitFor(); expect(await active.count()).toBe(1);
      const peer = page.getByRole('button', { name: '重新识别机会', exact: true }); expect(await peer.isDisabled()).toBe(true); expect(await peer.getAttribute('aria-busy')).toBeNull(); expect(await peer.locator('.workspace-spinner').count()).toBe(0);
      expect(await reason(page, peer)).toContain('等待刷新完成'); await recordControlInventory(page, 'keyword-toolbar-active');
    } finally { await browser.close(); }
  }, 30_000);


  it('explains each actual controlled-review prerequisite and never treats incomplete review as approval', async () => {
    const { browser, page } = await open('decisions');
    try {
      await page.getByRole('button', { name: '打开首条待审批建议', exact: true }).waitFor(); await page.evaluate(() => (window as any).pageFeedback.reviewMode());
      await page.locator('#fixture-authority').filter({ hasText: 'A/2' }).waitFor(); await page.getByRole('tab', { name: /待判断/ }).click();
      await page.getByRole('button', { name: '复核首条建议与 Ads 对象', exact: true }).click();
      const confirm = page.getByRole('button', { name: '确认复核，回到待审批', exact: true }); expect(await confirm.isDisabled()).toBe(true);
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '确认复核，回到待审批' && document.getElementById(button.getAttribute('aria-describedby') || '')?.textContent?.includes('请补齐上方复核字段后重试')));
      expect(await reason(page, confirm)).toContain('请补齐上方复核字段后重试'); expect(await page.getByPlaceholder('填写姓名', { exact: true }).isEnabled()).toBe(true);
      await invokeActualReactActionTwice(page, '确认复核，回到待审批'); expect(await calls(page, 'decision')).toBe(0); expect(await calls(page, 'discovery')).toBe(0);
      await recordControlInventory(page, 'decisions-controlled-review-blocked');
    } finally { await browser.close(); }
  }, 30_000);

});
