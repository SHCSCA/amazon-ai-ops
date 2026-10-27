import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { bundleProductionActionFixture, invokeActualReactActionTwice, openProductionActionFixture } from './mission-control/workspaces/production-action-browser.test-support';

const bundles: Record<string, string> = {};
beforeAll(async () => {
  await Promise.all(['missing', 'missing-absent', 'sync', 'normal', 'actual-reload'].map(async mode => {
    bundles[mode] = await bundleProductionActionFixture(fixture(mode));
  }));
  bundles.main = await bundleActualMain();
}, 60_000);

async function expectNoBusinessCalls(page: import('playwright').Page) {
  expect(await page.evaluate(() => (window as any).startupFixture.businessCalls)).toEqual([]);
}

describe('production Renderer startup recovery boundary', () => {
  it('contains the actual main entry Provider failure with Chinese recovery and zero business calls', async () => {
    const { browser, page } = await openProductionActionFixture(bundles.main);
    try {
      await page.getByRole('main', { name: '应用启动恢复', exact: true }).waitFor();
      await page.getByRole('alert').getByText('应用未能完成启动', { exact: true }).waitFor();
      expect(await page.getByRole('button', { name: '重新加载应用', exact: true }).isEnabled()).toBe(true);
      expect(await page.evaluate(() => (window as any).startupMainFixture.calls)).toEqual([]);
      const records = await page.evaluate(() => (window as any).startupMainFixture.records);
      expect(records.find((record: any) => record.event === 'renderer.startup_render_failed').context.error.message)
        .toBe('MISSION_CONTROL_PRELOAD_API_UNAVAILABLE');
      expect(await page.locator('body').innerText()).not.toContain('MISSION_CONTROL_PRELOAD_API_UNAVAILABLE');
      expect((await page.locator('body').innerText()).length).toBeGreaterThan(30);
    } finally { await browser.close(); }
  }, 30_000);

  it('shows a real missing-bridge Provider error and falls back to the unified console log only', async () => {
    const { browser, page } = await openProductionActionFixture(bundles['missing-absent']);
    try {
      await page.getByRole('alert').getByText('应用未能完成启动', { exact: true }).waitFor();
      await page.getByText(/请手动重新加载/).waitFor();
      expect(await page.evaluate(() => (window as any).electronAPI)).toBeUndefined();
      const records = await page.evaluate(() => (window as any).startupFixture.consoleRecords);
      const failure = records.find((record: any) => record.event === 'renderer.startup_render_failed');
      expect(failure.level).toBe('error');
      expect(Number.isFinite(Date.parse(failure.timestamp))).toBe(true);
      expect(failure.context.error.message).toBe('MISSION_CONTROL_PRELOAD_API_UNAVAILABLE');
      expect(await page.evaluate(() => (window as any).startupFixture.logs)).toEqual([]);
      await expectNoBusinessCalls(page);
    } finally { await browser.close(); }
  }, 30_000);

  it('contains a synchronous startup render error without displaying technical details or calling business ports', async () => {
    const { browser, page } = await openProductionActionFixture(bundles.sync);
    try {
      await page.getByRole('alert').getByText('应用未能完成启动', { exact: true }).waitFor();
      expect(await page.getByRole('button', { name: '重新加载应用', exact: true }).isEnabled()).toBe(true);
      expect(await page.locator('body').innerText()).not.toContain('PRIVATE_STARTUP_FAILURE');
      const logs = await page.evaluate(() => (window as any).startupFixture.logs);
      const failure = logs.find((record: any) => record.event === 'renderer.startup_render_failed');
      expect(failure.level).toBe('error');
      expect(failure.context.error.message).toBe('PRIVATE_STARTUP_FAILURE');
      expect(failure.context.componentStack).toContain('BrokenStartup');
      await expectNoBusinessCalls(page);
    } finally { await browser.close(); }
  }, 30_000);

  it('reloads the document only after an explicit retry and preserves a visible error if the bridge remains absent', async () => {
    const bundle = bundles['actual-reload'];
    const { browser, page } = await openProductionActionFixture(bundle);
    try {
      let requests = 0;
      await page.route('http://startup-boundary.fixture/**', async route => {
        requests++;
        await route.fulfill({ contentType: 'text/html', body: `<main id="root"></main><script>${bundle.replaceAll('</script', '<\\/script')}</script>` });
      });
      await page.goto('http://startup-boundary.fixture/actual-reload');
      await page.getByRole('alert').waitFor();
      await page.waitForTimeout(100);
      expect(requests).toBe(1);
      expect(await page.evaluate(() => (window as any).startupFixture.bootCount)).toBe(1);
      await expectNoBusinessCalls(page);
      await Promise.all([
        page.waitForEvent('load'),
        page.getByRole('button', { name: '重新加载应用', exact: true }).click(),
      ]);
      await page.getByRole('alert').getByText('应用未能完成启动', { exact: true }).waitFor();
      expect(requests).toBe(2);
      expect(await page.evaluate(() => (window as any).startupFixture.bootCount)).toBe(2);
      expect(await page.getByRole('button', { name: '重新加载应用', exact: true }).isEnabled()).toBe(true);
      await expectNoBusinessCalls(page);
    } finally { await browser.close(); }
  }, 30_000);

  it('admits one reload synchronously and exposes the shared active busy state', async () => {
    const { browser, page } = await openProductionActionFixture(bundles.missing);
    try {
      await page.getByRole('button', { name: '重新加载应用', exact: true }).waitFor();
      await invokeActualReactActionTwice(page, '重新加载应用');
      const busy = page.getByRole('button', { name: '正在重新加载…', exact: true });
      await busy.waitFor();
      expect(await busy.isDisabled()).toBe(true);
      expect(await busy.getAttribute('aria-busy')).toBe('true');
      expect(await busy.getAttribute('aria-description')).toBe('正在重新加载应用，请等待新界面出现。');
      expect(await page.evaluate(() => (window as any).startupFixture.reloadCalls)).toBe(1);
      await expectNoBusinessCalls(page);
    } finally { await browser.close(); }
  }, 30_000);

  it('logs a rejected reload and restores a usable manual retry without business calls', async () => {
    const { browser, page } = await openProductionActionFixture(bundles.sync);
    try {
      const retry = page.getByRole('button', { name: '重新加载应用', exact: true });
      await retry.waitFor();
      await page.evaluate(() => (window as any).startupFixture.failReload());
      await retry.click();
      await page.getByText('重新加载未能启动。请关闭并重新打开应用，并保留日志供排查。', { exact: true }).waitFor();
      expect(await retry.isEnabled()).toBe(true);
      expect(await retry.getAttribute('aria-busy')).toBeNull();
      await retry.click();
      expect(await page.evaluate(() => (window as any).startupFixture.reloadCalls)).toBe(2);
      const failures = await page.evaluate(() => (window as any).startupFixture.logs.filter((row: any) => row.event === 'renderer.startup_reload_failed'));
      expect(failures).toHaveLength(2);
      expect(failures[0].context.error.message).toBe('RELOAD_REFUSED');
      await expectNoBusinessCalls(page);
    } finally { await browser.close(); }
  }, 30_000);

  it('preserves the normal child tree and its local React state without fallback UI or business calls', async () => {
    const { browser, page } = await openProductionActionFixture(bundles.normal);
    try {
      await page.getByRole('heading', { name: '正常应用子树', exact: true }).waitFor();
      await page.getByRole('button', { name: '本地计数', exact: true }).click();
      expect(await page.getByLabel('本地状态', { exact: true }).textContent()).toBe('1');
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(await page.getByRole('button', { name: '重新加载应用', exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).startupFixture.logs)).toEqual([]);
      await expectNoBusinessCalls(page);
    } finally { await browser.close(); }
  }, 30_000);
});

async function bundleActualMain(): Promise<string> {
  const require = createRequire(import.meta.url);
  const viteRequire = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'));
  const result = await viteRequire('esbuild').build({
    stdin: { loader: 'tsx', resolveDir: path.resolve('apps/desktop/src/renderer'), contents: String.raw`
      import './main';
      const calls=[],records=[],previousError=console.error.bind(console);
      console.error=(...args)=>{if(typeof args[0]==='string'&&args[0].startsWith('{"timestamp":'))records.push(JSON.parse(args[0]));previousError(...args);};
      window.electronAPI=new Proxy({}, {get:(_,key)=>key==='missionControl'||key==='reportRuntimeLog'?undefined:()=>{calls.push(String(key));throw new Error('UNEXPECTED_BUSINESS_CALL');}});
      window.startupMainFixture={calls,records};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' },
    nodePaths: [path.resolve('apps/desktop/node_modules')],
    alias: { '@amazon-ai-ops/shared-types/src/v16-api': path.resolve('packages/shared-types/src/v16-api.ts'),
      '@amazon-ai-ops/shared-types': path.resolve('packages/shared-types/src/index.ts') },
    define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'false' },
  });
  return result.outputFiles[0].text;
}

function fixture(mode: string): string {
  return String.raw`
    import React,{useState}from'react';import{createRoot}from'react-dom/client';
    import{StartupErrorBoundary}from'../../startup-error-boundary';
    import{MissionControlStoreContextProvider}from'../store-context';
    const mode=${JSON.stringify(mode)},businessCalls=[],logs=[],consoleRecords=[];
    const previousError=console.error.bind(console);
    console.error=(...args)=>{if(typeof args[0]==='string'&&args[0].startsWith('{"timestamp":'))consoleRecords.push(JSON.parse(args[0]));previousError(...args);};
    const business={listStores:async()=>{businessCalls.push('listStores');return[];},createStore:async()=>{businessCalls.push('createStore');},missionControl:undefined};
    if(mode==='missing-absent')delete window.electronAPI;else window.electronAPI=mode==='sync'?{...business,reportRuntimeLog:async record=>logs.push(record)}:business;
    let reloadCalls=0,reloadFails=false,bootCount=0;
    if(location.hostname==='startup-boundary.fixture'){bootCount=Number(sessionStorage.getItem('startup-boots')||0)+1;sessionStorage.setItem('startup-boots',String(bootCount));}
    function Healthy(){const[count,setCount]=useState(0);return <section><h1>正常应用子树</h1><button onClick={()=>setCount(value=>value+1)}>本地计数</button><output aria-label="本地状态">{count}</output></section>;}
    function BrokenStartup(){throw new Error('PRIVATE_STARTUP_FAILURE');}
    const reload=mode==='actual-reload'?undefined:()=>{reloadCalls++;if(reloadFails)throw new Error('RELOAD_REFUSED');};
    const child=mode==='sync'?<BrokenStartup/>:mode==='normal'?<Healthy/>:<MissionControlStoreContextProvider><Healthy/></MissionControlStoreContextProvider>;
    window.startupFixture={businessCalls,logs,consoleRecords,bootCount,get reloadCalls(){return reloadCalls;},failReload(){reloadFails=true;}};
    createRoot(document.getElementById('root')).render(<React.StrictMode><StartupErrorBoundary reload={reload}>{child}</StartupErrorBoundary></React.StrictMode>);
  `;
}
