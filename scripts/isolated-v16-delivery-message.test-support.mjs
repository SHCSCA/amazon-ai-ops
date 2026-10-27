import path from 'node:path';
import { createRequire } from 'node:module';
import { BROWSER_LIFECYCLE_BUDGET, ownBrowserServer } from './v16-performance-observe.test-support.mjs';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'));
const { chromium } = require('./playwright-loader.js');
const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');

async function bounded(operation, timeoutMs, code) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

export async function openProductionPanelBrowser() {
  const result = await viteRequire('esbuild').build({
    stdin: { contents: fixture, loader: 'tsx', resolveDir: path.resolve('apps/desktop/src/renderer/components') },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    nodePaths: [path.resolve('apps/desktop/node_modules')], define: { 'process.env.NODE_ENV': '"test"' },
  });
  const server = await chromium.launchServer({ headless: true, timeout: BROWSER_LIFECYCLE_BUDGET.launchMs });
  const owned = ownBrowserServer(server);
  try {
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: BROWSER_LIFECYCLE_BUDGET.connectMs });
    return { browser, owned, bundle: result.outputFiles[0].text };
  } catch (error) {
    try { await owned.close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'DELIVERY_PANEL_SETUP_AND_CLEANUP_FAILED'); }
    throw error;
  }
}

export async function withProductionPanel(runtime, action) {
  const page = await runtime.browser.newPage();
  let primaryError;
  try {
    await page.setContent('<main id="root"></main>');
    await page.addScriptTag({ content: runtime.bundle });
    await page.getByRole('button', { name: '刷新最终验收', exact: true }).waitFor({ timeout: 2000 });
    await action(page);
  } catch (error) { primaryError = error; throw error; }
  finally {
    try { await bounded(() => page.close(), 3000, 'DELIVERY_PANEL_PAGE_CLOSE_TIMEOUT'); }
    catch (cleanupError) {
      process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', 'software.delivery_panel_page_close_failed', { error: cleanupError })) + '\n');
      if (primaryError) throw new AggregateError([primaryError, cleanupError], 'DELIVERY_PANEL_ASSERTION_AND_CLEANUP_FAILED');
      throw cleanupError;
    }
  }
}

// 使用真实生产 Panel；仅隔离控制消息和按钮状态，不构造业务批准或执行。
const fixture = String.raw`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Panel}from'./ui';
function Fixture(){
  const[state,setState]=useState({message:'',title:'交付消息',hidden:false,busy:false,decoy:'',extra:''});
  window.deliveryPanelFixture={set:patch=>setState(previous=>({...previous,...patch}))};
  return <><button disabled={state.busy} aria-busy={state.busy||undefined}>
    {state.busy&&<span className="button-spinner" aria-hidden="true"/>}{state.busy?'刷新中...':'刷新最终验收'}
  </button><div hidden={state.hidden}><Panel title={state.title}>{state.message}{state.extra}</Panel></div>
  <Panel title="其他消息">{state.decoy}</Panel></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`;
