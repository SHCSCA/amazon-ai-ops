import { beforeAll, describe, expect, it } from 'vitest';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from '../mission-control/workspaces/production-action-browser.test-support';

let bundle: string;
beforeAll(async () => { bundle = await bundleProductionActionFixture(fixture); }, 30_000);
async function selectAndPreview(page: any) {
  await page.getByRole('button', { name: '选择文件并观察' }).click();
  await page.getByLabel('产品族名称').fill('合成产品族');
  for (const name of ['campaign.xlsx', 'ad-group.xlsx', 'keyword.xlsx', 'auxiliary-a.xlsx', 'auxiliary-b.xlsx']) {
    await page.getByLabel(name, { exact: false }).check();
  }
  await page.getByRole('button', { name: '核对本次文件范围' }).click();
}
describe('family observation explicit renderer flow', () => {
  it('requires exact preview confirmation, shows observed daily values and bound-only auxiliaries without totals', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => Boolean((window as any).familyFixture));
      expect(await page.evaluate(() => (window as any).familyFixture.calls())).toEqual({ list: 0, prepare: 0, confirm: 0 });
      await selectAndPreview(page);
      expect(await page.getByRole('region', { name: '本次产品族确认范围' }).textContent()).toContain('仅以下 5 个文件版本');
      expect(await page.getByRole('region', { name: '本次产品族确认范围' }).textContent()).toContain('仅绑定，不参与每日计算');
      expect(await page.getByRole('region', { name: '产品族每日观察结果' }).count()).toBe(0);
      await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).click();
      const result = page.getByRole('region', { name: '产品族每日观察结果' });
      await result.waitFor();
      expect(await result.textContent()).toContain('1 天存在活动与广告组差异');
      expect(await result.textContent()).toContain('币种未知');
      expect(await page.getByRole('region', { name: '已确认的观察来源' }).textContent()).toContain('5 个指定版本');
      expect(await result.textContent()).not.toContain('$');
      expect(await result.getByRole('cell', { name: '10', exact: true }).count()).toBeGreaterThan(0);
      await page.getByText('查看广告组差值与关键词子集').click();
      expect(await result.textContent()).toContain('花费 2');
      expect(await result.textContent()).toContain('关键词子集');
      expect(await page.evaluate(() => (window as any).familyFixture.calls())).toEqual({ list: 1, prepare: 1, confirm: 1 });
    } finally { await browser.close(); }
  });
  it('invalidates preview on label or file selection edits and consumes confirmation once under double click', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => Boolean((window as any).familyFixture));
      await selectAndPreview(page);
      await page.getByLabel('产品族名称').fill('新的产品族');
      expect(await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).count()).toBe(0);
      await page.getByRole('button', { name: '核对本次文件范围' }).click();
      await page.getByLabel('auxiliary-b.xlsx', { exact: false }).uncheck();
      expect(await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).count()).toBe(0);
      await page.getByRole('button', { name: '核对本次文件范围' }).click();
      await page.evaluate(() => (window as any).familyFixture.defer('confirm'));
      await invokeActualReactActionTwice(page, '确认这些文件属于同一产品族并观察');
      expect(await page.evaluate(() => (window as any).familyFixture.calls().confirm)).toBe(1);
      await page.evaluate(() => (window as any).familyFixture.resolve());
      await page.getByRole('region', { name: '产品族每日观察结果' }).waitFor();
    } finally { await browser.close(); }
  });
  it('rejects stale prepare completion after A-B-A context changes', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => Boolean((window as any).familyFixture));
      await page.evaluate(() => (window as any).familyFixture.defer('prepare'));
      await selectAndPreview(page);
      await page.evaluate(() => (window as any).familyFixture.setContext('B'));
      await page.getByRole('button', { name: '选择文件并观察' }).waitFor();
      await page.evaluate(() => (window as any).familyFixture.setContext('A'));
      await page.evaluate(() => (window as any).familyFixture.resolve());
      expect(await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).count()).toBe(0);
      expect(await page.getByRole('region', { name: '产品族每日观察结果' }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).familyFixture.calls().confirm)).toBe(0);
    } finally { await browser.close(); }
  });
  it('keeps cancellation final when pending confirmation resolves and hides results after file revision change', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => Boolean((window as any).familyFixture));
      await selectAndPreview(page);
      await page.evaluate(() => (window as any).familyFixture.defer('confirm'));
      await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).click();
      await page.getByRole('button', { name: '关闭并取消确认' }).click();
      await page.evaluate(() => (window as any).familyFixture.resolve());
      expect(await page.getByRole('region', { name: '产品族每日观察结果' }).count()).toBe(0);
      await selectAndPreview(page);
      await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).click();
      await page.getByRole('region', { name: '产品族每日观察结果' }).waitFor();
      await page.evaluate(() => (window as any).familyFixture.setRevision('version-2'));
      await page.getByRole('button', { name: '选择文件并观察' }).waitFor();
      expect(await page.getByRole('region', { name: '产品族每日观察结果' }).count()).toBe(0);
    } finally { await browser.close(); }
  });
  it('ignores a pending old file list after closing and reopening', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => Boolean((window as any).familyFixture));
      await page.evaluate(() => (window as any).familyFixture.defer('list'));
      await page.getByRole('button', { name: '选择文件并观察' }).click();
      await page.getByRole('button', { name: '关闭并取消确认' }).click();
      await page.evaluate(() => (window as any).familyFixture.defer(''));
      await page.getByRole('button', { name: '选择文件并观察' }).click();
      await page.getByLabel('campaign.xlsx', { exact: false }).waitFor();
      await page.evaluate(() => (window as any).familyFixture.resolve([{ id: 999, fileName: 'stale.xlsx' }]));
      expect(await page.getByLabel('stale.xlsx', { exact: false }).count()).toBe(0);
      expect(await page.getByRole('checkbox').count()).toBe(5);
    } finally { await browser.close(); }
  });
  it('does not revive a pending result after unmount and navigation back', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => Boolean((window as any).familyFixture));
      await selectAndPreview(page);
      await page.evaluate(() => (window as any).familyFixture.defer('confirm'));
      await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).click();
      await page.evaluate(() => (window as any).familyFixture.setMounted(false));
      await page.waitForFunction(() => !document.querySelector('section'));
      await page.evaluate(() => (window as any).familyFixture.setMounted(true));
      await page.getByRole('button', { name: '选择文件并观察' }).waitFor();
      await page.evaluate(() => (window as any).familyFixture.resolve());
      expect(await page.getByRole('region', { name: '产品族每日观察结果' }).count()).toBe(0);
      expect(await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).count()).toBe(0);
    } finally { await browser.close(); }
  });
  it('shows a confirmation failure without reviving consumed preview', async () => {
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      await page.waitForFunction(() => Boolean((window as any).familyFixture));
      await selectAndPreview(page);
      await page.evaluate(() => (window as any).familyFixture.fail());
      await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('alert').textContent()).toContain('文件已变化');
      expect(await page.getByRole('button', { name: '确认这些文件属于同一产品族并观察' }).count()).toBe(0);
      expect(await page.getByRole('region', { name: '产品族每日观察结果' }).count()).toBe(0);
    } finally { await browser.close(); }
  });
});

export const fixture = String.raw`
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FamilyObservationPanel } from '../../pages/family-observation-panel';
const context = { storeId:'synthetic-store', marketplace:'US', currency:'USD', browserProfileId:'synthetic-profile', sessionGeneration:1 };
const files = ['campaign', 'ad_group', 'keyword', 'auxiliary', 'auxiliary'].map((reportType,index) => ({id:index+1,reportType,fileName:['campaign.xlsx','ad-group.xlsx','keyword.xlsx','auxiliary-a.xlsx','auxiliary-b.xlsx'][index],batchId:'synthetic-batch',sha256:String(index+1).repeat(64),dateFrom:'2026-01-01',dateTo:'2026-01-02'}));
const metrics = { impressions:100,clicks:10,cost:10,orders:1,sales:20 };
const level = {metrics,identityStatus:'labels-only',sourceRows:[]};
const result = {schemaVersion:1,provenanceLabel:'user_confirmed_scope',familyLabel:'合成产品族',confirmationReference:'synthetic-confirmation',bindings:[],consumedHashes:files.slice(0,3).map(file=>file.sha256),completeness:'partial-observation',authority:'campaign-only',nativeAsinAuthority:false,formalEligibility:false,currency:'unknown',attributionWindow:'unknown',keywordCoverage:'subset-unknown',days:[{date:'2026-01-01',campaign:level,adGroupCrosscheck:level,keywordSubset:level,campaignMinusAdGroup:{impressions:0,clicks:0,cost:2,orders:0,sales:0},reconciliation:'discrepancy'},{date:'2026-01-02',campaign:null,adGroupCrosscheck:null,keywordSubset:null,campaignMinusAdGroup:{impressions:null,clicks:null,cost:null,orders:null,sales:null},reconciliation:'unknown'}]};
const calls = {list:0,prepare:0,confirm:0};
let deferred = '', resolve, shouldFail = false;
const response = (name,value) => deferred === name ? new Promise(r=>{resolve=override=>{deferred='';r(override??value)}}) : Promise.resolve(value);
const api = {listFamilyObservationFiles:()=>{calls.list++;return response('list',files)},prepareFamilyObservation:input=>{calls.prepare++;return response('prepare',{...input,token:'synthetic-token',storeName:'隔离合成店铺',marketplaceCode:'US',files:files.filter(file=>input.fileIds.includes(file.id))})},confirmFamilyObservation:()=>{calls.confirm++;return shouldFail?Promise.reject(new Error('文件已变化，请重新确认')):response('confirm',result)},cancelFamilyObservation:()=>Promise.resolve()};
function App(){const [key,setContext]=useState('A');const [revision,setRevision]=useState('version-1');const [mounted,setMounted]=useState(true);window.familyFixture={calls:()=>calls,defer:name=>deferred=name,resolve:value=>resolve(value),setContext,setRevision,setMounted,fail:()=>shouldFail=true};return mounted ? <FamilyObservationPanel scope={{storeContext:context,dateFrom:'2026-01-01',dateTo:'2026-01-02'}} contextKey={key} fileRevision={revision} api={api}/> : null}
createRoot(document.getElementById('root')).render(<App/>);
`;
