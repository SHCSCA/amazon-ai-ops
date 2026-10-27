import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';
import { beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const viteRequire = createRequire(createRequire(require.resolve('vitest/package.json')).resolve('vite/package.json'));
let bundle: string;

beforeAll(async () => {
  const esbuild = viteRequire('esbuild');
  const result = await esbuild.build({
    stdin: { contents: fixtureSource, loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)) },
    bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.css': 'empty' },
    nodePaths: [path.resolve('apps/desktop/node_modules')],
    alias: { '@amazon-ai-ops/shared-types': path.resolve('packages/shared-types/src/index.ts') },
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  bundle = result.outputFiles[0].text;
}, 30_000);

async function open(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5_000);
  await page.setContent('<main id="root"></main>');
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: '启动实验', exact: true }).waitFor();
  return { browser, page };
}

describe('production Experiment action feedback', () => {
  it('admits only one actual transition before React renders and exposes active busy plus each peer reason', async () => {
    const { browser, page } = await open();
    try {
      await page.evaluate(() => (window as any).experimentFixture.startTwice());
      await page.getByRole('button', { name: '启动中…', exact: true }).waitFor();
      const active = page.getByRole('button', { name: '启动中…', exact: true });
      expect(await active.getAttribute('aria-busy')).toBe('true');
      expect(await active.isDisabled()).toBe(true);
      const edit = page.getByRole('button', { name: '编辑', exact: true });
      expect(await edit.isDisabled()).toBe(true);
      expect(await edit.getAttribute('aria-busy')).toBeNull();
      const reason = await edit.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('当前操作尚未结束');
      expect(await page.evaluate(() => (window as any).experimentFixture.calls.length)).toBe(1);
      await page.evaluate(() => (window as any).experimentFixture.complete(0));
      await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
      expect(await page.getByText('经营实验已进入观察窗。', { exact: true }).isVisible()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('ignores a previous A completion after A to B to A without releasing the current A operation', async () => {
    const { browser, page } = await open();
    try {
      await page.getByRole('button', { name: '启动实验', exact: true }).click();
      await page.evaluate(() => (window as any).experimentFixture.select('B'));
      await page.getByRole('heading', { name: '当前实验B', exact: true }).first().waitFor();
      await page.getByRole('button', { name: '启动实验', exact: true }).waitFor();
      await page.evaluate(() => (window as any).experimentFixture.select('A'));
      await page.getByRole('heading', { name: '当前实验A', exact: true }).first().waitFor();
      await page.getByRole('button', { name: '启动实验', exact: true }).waitFor();
      await page.getByRole('button', { name: '启动实验', exact: true }).click();
      await page.evaluate(() => (window as any).experimentFixture.complete(0));
      expect(await page.getByRole('button', { name: '启动中…', exact: true }).isDisabled()).toBe(true);
      expect(await page.getByText('经营实验已进入观察窗。', { exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => (window as any).experimentFixture.calls.length)).toBe(2);
      await page.evaluate(() => (window as any).experimentFixture.complete(1));
      await page.getByRole('button', { name: '暂停', exact: true }).waitFor();
      expect(await page.getByText('经营实验已进入观察窗。', { exact: true }).isVisible()).toBe(true);
    } finally { await browser.close(); }
  }, 30_000);

  it('describes the actual guardrail restriction with a concrete recovery instead of a title-only hint', async () => {
    const { browser, page } = await open();
    try {
      await page.evaluate(() => (window as any).experimentFixture.setRecord({ status: 'paused', conclusion: '守护栏触发' }));
      const resume = page.getByRole('button', { name: '恢复', exact: true });
      await resume.waitFor();
      expect(await resume.isDisabled()).toBe(true);
      const reason = await resume.getAttribute('aria-describedby');
      expect(await page.locator(`[id="${reason}"]`).textContent()).toContain('复核原因并新建实验');
      expect(await page.getByRole('button', { name: '新建经营实验', exact: true }).isEnabled()).toBe(true);
      expect(await page.evaluate(() => (window as any).experimentFixture.calls.length)).toBe(0);
    } finally { await browser.close(); }
  }, 30_000);
});

const fixtureSource = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ExperimentsWorkspace } from './experiments-workspace';
let store = 'A';
let override = {};
const records = new Map();
const calls = [];
const record = (id) => ({ id: 'EXP-' + id, storeId: id, missionId: 'MISSION-' + id, name: '当前实验' + id,
  hypothesis: '降低竞价会改善广告成本', primaryMetric: 'ACOS', guardrailMetrics: [], guardrailCriteria: [],
  productId: 'PRODUCT-' + id, adEntityId: 'ENTITY-' + id, baseline: { bidUsd: 1 }, variant: { bidUsd: 0.9 },
  observationStartsAt: '2026-10-01T07:00:00.000Z', observationEndsAt: '2026-10-08T07:00:00.000Z',
  status: 'draft', revision: 1, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', ...override });
const api = {
 listExperiments: async context => [records.get(context.storeId) ?? record(context.storeId)],
 listCausalEvents: async () => [], listExperimentObservations: async () => [], listExperimentMetricSnapshots: async () => [],
 transitionExperiment: (context, input) => new Promise(resolve => calls.push({ context, input, resolve })),
};
const capabilities = ['view','create','update','start','pause','resume','complete','archive','restore'].map(action => ({
 capabilityId: 'experiments.experiment.' + action, workspace: 'experiments', view: 'experiments/ledger', action,
 state: 'PRODUCTION_NATIVE', detail: '当前店铺已接入' }));
capabilities.push({ capabilityId: 'experiments.observation.create', workspace: 'experiments', view: 'experiments/ledger', action: 'create', state: 'PRODUCTION_NATIVE', detail: '当前店铺已接入' });
const root = createRoot(document.getElementById('root'));
const render = () => root.render(<ExperimentsWorkspace apiOverride={api} blockedReason="当前实验服务不可用，请重试。" capabilities={capabilities}
 previewMode={false} storeContext={{ storeId: store, browserProfileId: 'profile-' + store, marketplace: 'US', currency: 'USD',
 businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 1 }} />);
window.experimentFixture = { calls, select(id) { store = id; render(); }, setRecord(value) { override = value; store = store === 'A' ? 'B' : 'A'; render(); },
 startTwice() { const button = [...document.querySelectorAll('button')].find(x => x.textContent === '启动实验');
 const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))]; props.onClick(); props.onClick(); },
 complete(index) { const call = calls[index]; const saved = { ...record(call.context.storeId), status: call.input.status, revision: 2 };
 records.set(call.context.storeId, saved); call.resolve(saved); },
};
render();
`;
