import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const { build } = require('../apps/desktop/node_modules/esbuild');
const { chromium } = require('./playwright-loader.js');

test('production policy adapter loads versions once across ordinary React renders', async () => {
  const bundle = await build({
    stdin: { sourcefile: 'policy-version-stability.tsx', resolveDir: path.resolve('apps/desktop/src/renderer'), loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { PolicyWorkspace } from './mission-control/workspaces/policy-workspace';
      const context = { storeId:'store-test',browserProfileId:'profile-test',marketplace:'US',currency:'USD',businessTimezone:'America/Los_Angeles',businessDate:'2026-09-08',sessionGeneration:1 };
      const now = '2026-09-08T07:00:00.000Z';
      const policies = ['First policy','Second policy'].map((name,i)=>({id:'policy-'+i,storeId:context.storeId,name,scope:'store',status:'active',priority:i+1,revision:1,createdAt:now,updatedAt:now}));
      const forbidden = () => { throw new Error('No mutations are allowed in this check'); };
      window.versionReads = [];
      window.electronAPI = { missionDomain: {
        policies: {list:async()=>policies,create:forbidden,update:forbidden,disable:forbidden,archive:forbidden,restore:forbidden},
        policyVersions: {list:async(_c,input)=>{ window.versionReads.push(input.policyId); return []; },create:forbidden,updateDraft:forbidden,enable:forbidden},
        policyRuntime: {get:async()=>({mode:'manual_approval',killSwitch:false,circuitBreakerState:'closed',revision:1,canAutoExecute:false,status:'APPLIED'}),setAutonomyMode:forbidden,setKillSwitch:forbidden}
      } };
      createRoot(document.getElementById('root')).render(<PolicyWorkspace storeContext={context} previewMode={false} capabilities={[{capabilityId:'policy.version.view',workspace:'policy',view:'policy/rules',action:'view',state:'PRODUCTION_NATIVE'}]} />);
    ` },
    bundle: true, write: false, format: 'iife', platform: 'browser', loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('button', { name: /First policy/ }).waitFor();
    await page.waitForFunction(() => window.versionReads.length > 0);
    await page.getByRole('textbox', { name: '搜索策略' }).fill('policy');
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.versionReads), ['policy-0']);
    await page.getByRole('button', { name: /Second policy/ }).click();
    await page.waitForFunction(() => window.versionReads.includes('policy-1'));
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.versionReads), ['policy-0', 'policy-1']);
  } finally { await browser.close(); }
}, 20000);
