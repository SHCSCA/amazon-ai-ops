import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import observer from './v16-performance-memory-search.js';
import contract from './v16-performance-memory-search-contract.js';
import artifacts from './v16-performance-artifacts.js';
import { BROWSER_LIFECYCLE_BUDGET, ownBrowserServer } from './v16-performance-observe.test-support.mjs';

const require = createRequire(import.meta.url), { chromium } = require('./playwright-loader.js');
const context = { storeId: 'software-store-a', browserProfileId: 'software-profile-a', marketplace: 'US', currency: 'USD',
  businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 1 };
const identity = { pid: 101, rendererPid: 202, packaged: true, executablePath: 'G:\\Temp\\AmazonAIOpsAgent.exe',
  userDataDir: 'G:\\Temp\\amazon-ai-ops-browser-driver\\profile', windowCount: 1, visible: true,
  mainCreationTime: 1000000, rendererCreationTime: 1000010 };
const packageIdentity = { executableSha256: '1'.repeat(64), appContentSha256: '2'.repeat(64), mainBundleSha256: '3'.repeat(64) };
const events = Array.from({ length: 12 }, (_, index) => ({ id: 'software-event-' + String(index).padStart(2, '0'),
  storeId: context.storeId, title: '隔离软件事实 ' + index, stage: 'FACT', sequence: index + 1,
  eventType: 'operator_fact', entityType: 'software_note', entityId: 'object-' + index, signal: '仅供隔离软件驱动验证',
  status: 'recorded', createdAt: '2026-10-16T00:00:00.000Z' }));
const clone = value => structuredClone(value);
function projectionFor(rows = events, ctx = context, localized = false) {
  return rows.slice(0, 10).map((event, index) => {
    const title = localized ? '生产本地化后的记录 ' + index : event.title;
    return { id: event.id, sequence: event.sequence, stage: event.stage, createdAt: event.createdAt,
      displayCreatedAt: event.createdAt.slice(0, 16).replace('T', ' '), title,
      selectionProof: { sequence: event.sequence, title, selectedIndex: index, selected: true, diagnosticWasOpen: false, diagnosticOpenedByObserver: true, diagnosticOpen: true, sequenceVisible: true, authorityKey: contract.contextIdentity(ctx).join('|') } };
  });
}
function dom(test, ctx = context) {
  return { ...contract.expectedDom(test), ready: true, authorityKey: contract.contextIdentity(ctx).join('|'), emptyVisible: test.expected.length === 0 };
}
function observation() {
  const visibleProjection = projectionFor(), baseline = { query: '', expected: contract.projectedRows(events, visibleProjection) };
  let previous = baseline;
  const cases = contract.createSearchCases(events, context, 'software-unit-nonce', visibleProjection).map((test, index) => {
    const value = { ...test, before: dom(previous), after: dom(test),
      ...(test.id === 'unique-hit' ? { selectedResult: { ...visibleProjection[0].selectionProof, selectedIndex: 0 } } : {}),
      timer: { source: 'node:perf_hooks.performance', unit: 'ms', processId: 777, timeOriginMs: 1700000000000, startedAtMs: 100 + index * 100, finishedAtMs: 125 + index * 100 }, elapsedMs: 25,
      startedAt: new Date(Date.parse('2026-10-16T00:00:00.000Z') + index * 100).toISOString(),
      finishedAt: new Date(Date.parse('2026-10-16T00:00:00.025Z') + index * 100).toISOString(),
      unit: 'ms', window: 'input-to-filtered-render-two-frames' };
    previous = test; return value;
  });
  const hash = artifacts.digest(Buffer.from(JSON.stringify(events)));
  return { kind: 'v16-nfr-memory-search-observation', schemaVersion: 1, classification: 'isolated-software-fixture',
    formalAcceptanceEvidence: false, appReady: false, sourceSha256: 'a'.repeat(64), packageIdentity,
    storeContext: clone(context), finalStoreContext: clone(context), nativeBefore: clone(identity), nativeAfter: clone(identity),
    ledgerBeforeSha256: hash, ledgerAfterSha256: hash, reference: { events: clone(events) }, baselineDom: dom(baseline), visibleProjection, cases };
}
describe('memory search independent pure reference contract', () => {
  it('derives unique, empty and restore cases from readonly Main ledger fields', () => {
    const cases = contract.createSearchCases(events, context, 'software-unit-nonce', projectionFor());
    expect(cases.map(row => row.expected.length)).toEqual([1, 0, 12]);
    expect(contract.searchReference(events, events[2].id)[0].id).toBe(events[2].id);
    expect(contract.validateSearchObservation(observation()).softwareObserved).toBe(true);
  });
  it.each(['foreign-store', 'duplicate-id', 'empty-ledger', 'bad-context'])('rejects %s before any input operation', kind => {
    const rows = clone(events), ctx = clone(context);
    if (kind === 'foreign-store') rows[0].storeId = 'foreign';
    if (kind === 'duplicate-id') rows[1].id = rows[0].id;
    if (kind === 'empty-ledger') rows.splice(0);
    if (kind === 'bad-context') delete ctx.businessDate;
    expect(() => contract.createSearchCases(rows, ctx, 'software-unit-nonce', projectionFor())).toThrow();
  });
  it.each(['pid', 'creation', 'context', 'ledger', 'query-noop', 'result', 'expected', 'hit-sequence', 'hidden-sequence', 'time', 'timer-unit', 'timer-scalar', 'software-credit'])('rejects altered %s proof', kind => {
    const value = observation();
    if (kind === 'pid') value.nativeAfter.rendererPid++;
    if (kind === 'creation') value.nativeAfter.mainCreationTime++;
    if (kind === 'context') value.finalStoreContext.sessionGeneration++;
    if (kind === 'ledger') value.ledgerAfterSha256 = 'f'.repeat(64);
    if (kind === 'query-noop') value.cases[0].before.query = value.cases[0].query;
    if (kind === 'result') value.cases[0].after.titles = ['别的记录'];
    if (kind === 'expected') value.cases[0].expected = [];
    if (kind === 'hit-sequence') value.cases[0].selectedResult.sequence = 999;
    if (kind === 'hidden-sequence') value.visibleProjection[0].selectionProof.sequenceVisible = false;
    if (kind === 'timer-unit') value.cases[0].timer.unit = 'microseconds';
    if (kind === 'timer-scalar') value.cases[0].elapsedMs = 1;
    if (kind === 'time') value.cases[0].elapsedMs = 0;
    if (kind === 'software-credit') value.formalAcceptanceEvidence = true;
    expect(() => contract.validateSearchObservation(value)).toThrow();
  });
  it('uses the whole raw multi-field ledger to reject an ID referenced by another record', () => {
    const rows = clone(events); rows[1].signal += ' mentions ' + rows[0].id;
    const cases = contract.createSearchCases(rows, context, 'software-unit-nonce', projectionFor(rows));
    expect(cases[0].query).not.toBe(rows[0].id);
    expect(contract.searchReference(rows, cases[0].query)).toHaveLength(1);
  });
  it('rejects duplicated visible projections and changed row-to-ledger sequence bindings', () => {
    const projection = projectionFor();
    for (const row of projection) { row.title = '同名'; row.selectionProof.title = '同名'; }
    expect(() => contract.createSearchCases(events, context, 'software-unit-nonce', projection)).toThrow('UNIQUE_VISIBLE_ORACLE_UNAVAILABLE');
    const changed = projectionFor(); changed[0].selectionProof.sequence = 999;
    expect(() => contract.createSearchCases(events, context, 'software-unit-nonce', changed)).toThrow('VISIBLE_ROW_ORDER_OR_IDENTITY_CHANGED');
    const one = events.slice(0, 1);
    expect(() => contract.createSearchCases(one, context, 'software-unit-nonce', projectionFor(one))).toThrow('UNIQUE_VISIBLE_ORACLE_UNAVAILABLE');
  });
  it('keeps three actual native launches per fixture mandatory in the supplementary summary', () => {
    const rows = ['typical', 'maximum'].flatMap((fixture, group) => [0, 1, 2].map(sampleIndex => {
      const value = observation(); value.nativeBefore.pid += sampleIndex + group * 10; value.nativeAfter = clone(value.nativeBefore);
      return { fixture, sampleIndex, observation: value, receipt: { path: 'software-' + fixture + sampleIndex, sha256: 'a'.repeat(64) } };
    }));
    expect(contract.summarizeSearchObservations(rows, 3).fixtures).toHaveLength(2);
    expect(() => contract.summarizeSearchObservations(rows.slice(1), 3)).toThrow();
    expect(() => contract.summarizeSearchObservations(rows, 2)).toThrow('THREE_NATIVE_SAMPLES');
    rows[1].observation.nativeBefore = clone(rows[0].observation.nativeBefore);
    rows[1].observation.nativeAfter = clone(rows[0].observation.nativeAfter);
    expect(() => contract.summarizeSearchObservations(rows, 3)).toThrow('INDEPENDENT_NATIVE_LAUNCHES');
  });
});
let browser, owned, pages = [];
beforeAll(async () => {
  const server = await chromium.launchServer({ headless: true, timeout: BROWSER_LIFECYCLE_BUDGET.launchMs });
  owned = ownBrowserServer(server);
  browser = await chromium.connect(server.wsEndpoint(), { timeout: BROWSER_LIFECYCLE_BUDGET.connectMs });
}, BROWSER_LIFECYCLE_BUDGET.setupHookMs);
afterEach(async () => { for (const page of pages.splice(0)) await page.close(); });
afterAll(async () => { await owned?.close(); }, BROWSER_LIFECYCLE_BUDGET.teardownHookMs);
async function driver() {
  const page = await browser.newPage(); pages.push(page); page.setDefaultTimeout(2000);
  await page.setContent('<div data-authority-key="' + contract.contextIdentity(context).join('|') + '"></div>'
    + '<main data-workspace-evidence-root data-workspace="memory"><section class="memory-stage-rail"></section>'
    + '<section class="memory-timeline"><button id="all">全部阶段</button><input aria-label="搜索因果记忆">'
    + '<ul class="memory-event-list"></ul><div id="empty" data-workspace-state="empty" hidden>当前筛选没有因果记录</div>'
    + '<nav class="memory-pagination"><span></span></nav><footer class="workbench-panel__footer"></footer></section>'
    + '<aside class="memory-inspector"><h2></h2><details><summary>诊断详情</summary><dl><dt>sequence</dt><dd></dd></dl></details></aside></main>');
  await page.evaluate(({ context, events, fields }) => {
    window.driverContext = context; window.driverEvents = events; window.driverDelay = 40; window.driverQueries = [];
    window.electronAPI = { getActiveStoreWorkspaceView: async () => ({ context: window.driverContext, store: { storeId: window.driverContext.storeId } }),
      missionDomain: { causal: { listEvents: async () => window.driverEvents } } };
    const input = document.querySelector('input');
    function render() {
      const needle = input.value.trim().toLowerCase(), rows = window.driverEvents.filter(row => !needle
        || fields.map(field => row[field]).filter(Boolean).join('\n').toLowerCase().includes(needle));
      document.querySelector('ul').innerHTML = rows.slice(0, 10).map(row => '<li><button data-stage="' + row.stage + '"><strong>' + (window.driverLocalized ? '生产本地化后的记录 ' + window.driverEvents.indexOf(row) : row.title) + '</strong><small class="memory-event-meta">' + row.createdAt.slice(0, 16).replace('T', ' ') + '</small></button></li>').join('');
      document.querySelector('footer').textContent = rows.length ? '第 1/' + Math.max(1, Math.ceil(rows.length / 10)) + ' 页 · ' + rows.length + ' 条匹配记录' : '当前筛选没有记录。';
      document.querySelector('nav span').textContent = '1 / ' + Math.max(1, Math.ceil(rows.length / 10));
      document.getElementById('empty').hidden = rows.length > 0;
      if (!rows.length) window.driverZeroDetail = document.querySelector('aside h2').textContent;
      for (const [index, button] of [...document.querySelectorAll('ul button')].entries()) button.onclick = () => {
        for (const other of document.querySelectorAll('ul button')) other.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-pressed', 'true');
        document.querySelector('aside h2').textContent = button.querySelector('strong').textContent;
        document.querySelector('aside dd').textContent = String(rows[index].sequence);
      };
      document.querySelector('main').removeAttribute('aria-busy');
    }
    input.oninput = () => { window.driverQueries.push(input.value); document.querySelector('main').setAttribute('aria-busy', 'true');
      if (!window.driverNeverSettles) setTimeout(render, window.driverDelay); };
    document.getElementById('all').onclick = () => { input.value = ''; render(); };
    render();
  }, { context, events, fields: contract.INDEX_FIELDS });
  const records = [], logs = [];
  const writer = { write: (name, bytes) => { const record = { path: '/software-driver/' + name,
    sha256: artifacts.digest(bytes), sizeBytes: bytes.length }; records.push(record); return record; },
  json: (name, value) => { const record = { path: '/software-driver/' + name,
    sha256: artifacts.digest(Buffer.from(JSON.stringify(value))) }; records.push({ ...record, value }); return record; },
  log: (event, error) => logs.push({ event, error }) };
  // Chromium只验证驱动语义；此注入端口不提供实际Electron或生产验收信用。
  const runtime = { page, identity: { pid: identity.pid, executablePath: identity.executablePath, userDataDir: identity.userDataDir,
    windows: [{ rendererPid: identity.rendererPid }] }, userDataDir: identity.userDataDir,
  app: { evaluate: async () => ({ ...identity }) } };
  return { page, runtime, writer, records, logs };
}
function options(value) {
  return { runtime: value.runtime, writer: value.writer, fixture: { fixture: 'typical', classification: 'isolated-software-fixture',
    storeIds: [context.storeId] }, sourceSha256: 'a'.repeat(64), packageIdentity, prefix: 'typical/0/search', timeoutMs: 1000 };
}
describe('memory search real Chromium driver with synthetic native port', () => {
  it('waits for actual delayed results and measures unique hit rather than page load', async () => {
    const value = await driver(), result = await observer.observeMemorySearch(options(value));
    expect(result.observation.cases.map(row => row.id)).toEqual(['unique-hit', 'zero-hit', 'restore-all']);
    expect(result.observation.cases[0].elapsedMs).toBeGreaterThanOrEqual(30);
    expect(result.observation.cases[0].after.total).toBe(1);
    expect(result.observation.cases[1].after.emptyVisible).toBe(true);
    expect(await value.page.evaluate(() => window.driverZeroDetail)).toBe(events[0].title);
    expect(result.observation.cases[2].after.total).toBe(12);
    expect(await value.page.getByRole('textbox', { name: '搜索因果记忆' }).inputValue()).toBe('');
    expect(value.records.filter(row => row.path.endsWith('.png'))).toHaveLength(3);
  });
  it('opens the initially closed production diagnostic disclosure before crediting visible sequence proof', async () => {
    const value = await driver();
    expect(await value.page.locator('aside details').evaluate(node => node.open)).toBe(false);
    const result = await observer.observeMemorySearch(options(value));
    expect(result.observation.visibleProjection[0].selectionProof).toMatchObject({
      diagnosticWasOpen: false, diagnosticOpenedByObserver: true, diagnosticOpen: true, sequenceVisible: true });
    expect(await value.page.locator('aside details').evaluate(node => node.open)).toBe(false);
  });
  it('rejects hidden sequence text when the real disclosure refuses to open', async () => {
    const value = await driver();
    await value.page.locator('aside summary').evaluate(node => node.addEventListener('click', event => event.preventDefault()));
    await expect(observer.observeMemorySearch(options(value))).rejects.toThrow();
  }, 15000);
  it('rejects a CSS-hidden sequence even when the diagnostic disclosure is open', async () => {
    const value = await driver(); await value.page.addStyleTag({ content: '.memory-inspector dt { visibility: hidden; }' });
    await expect(observer.observeMemorySearch(options(value))).rejects.toThrow();
  }, 15000);
  it('accepts entirely localized visible titles while raw IDs remain the independent search oracle', async () => {
    const value = await driver();
    await value.page.evaluate(() => { window.driverLocalized = true; document.getElementById('all').click(); });
    const result = await observer.observeMemorySearch(options(value));
    expect(result.observation.cases[0].after.titles).toEqual(['生产本地化后的记录 0']);
    expect(result.observation.visibleProjection[0].id).toBe(events[0].id);
    expect(result.observation.visibleProjection[0].selectionProof.sequence).toBe(events[0].sequence);
  });
  it('rejects a DOM row whose inspector sequence does not match the original ledger order', async () => {
    const value = await driver();
    await value.page.evaluate(() => {
      const original = document.getElementById('all').onclick;
      document.getElementById('all').onclick = () => { original();
        for (const button of document.querySelectorAll('ul button')) {
          const click = button.onclick; button.onclick = () => { click(); document.querySelector('aside dd').textContent = '9999'; };
        }
      };
    });
    await expect(observer.observeMemorySearch(options(value))).rejects.toThrow();
  }, 15000);
  it('rejects a visible input when filtered rendering never settles', async () => {
    const value = await driver(); await value.page.evaluate(() => { window.driverNeverSettles = true; });
    await expect(observer.observeMemorySearch(options(value))).rejects.toThrow();
    expect(value.logs.some(row => row.event === 'v16.memory_search_observation_failed')).toBe(true);
  }, 15000);
  it('rejects context drift even if the displayed titles still look correct', async () => {
    const value = await driver(); await value.page.evaluate(() => {
      window.driverEvents = window.driverEvents.slice(0, 2);
      document.getElementById('all').click();
      const input = document.querySelector('input'), original = input.oninput;
      input.oninput = event => { original(event); window.driverContext = { ...window.driverContext, sessionGeneration: 2 }; };
    });
    await expect(observer.observeMemorySearch(options(value))).rejects.toThrow('CONTEXT_CHANGED');
  });
  it('rejects changed readonly ledger facts across the observation', async () => {
    const value = await driver(); let calls = 0;
    await value.page.evaluate(() => {
      let calls = 0;
      window.electronAPI.missionDomain.causal.listEvents = async () => {
        calls++; return calls === 1 ? window.driverEvents : window.driverEvents.map((row, index) => index ? row : { ...row, title: 'changed' });
      };
    });
    await expect(observer.observeMemorySearch(options(value))).rejects.toThrow('AUTHORITY_OR_LEDGER_CHANGED');
  });
  it('rejects a replaced Renderer identity without accepting its matching DOM', async () => {
    const value = await driver(); let reads = 0;
    value.runtime.app.evaluate = async () => ({ ...identity, rendererCreationTime: ++reads > 2 ? 9999999 : identity.rendererCreationTime });
    await expect(observer.observeMemorySearch(options(value))).rejects.toThrow('NATIVE_IDENTITY_CHANGED');
  });
  it('rejects forged result count, and a log failure never replaces the real result failure', async () => {
    const value = await driver();
    await value.page.evaluate(() => {
      const input = document.querySelector('input'), original = input.oninput;
      input.oninput = event => { original(event); setTimeout(() => { document.querySelector('footer').textContent = '第 1/1 页 · 999 条匹配记录'; }, 60); };
      window.driverDelay = 80;
    });
    value.writer.log = () => { throw new Error('synthetic log sink failed'); };
    // 此反例通过未结束的busy状态保证真实失败，不把时序碰巧命中当通过。
    await value.page.evaluate(() => { window.driverNeverSettles = true; });
    await expect(observer.observeMemorySearch(options(value))).rejects.not.toThrow('synthetic log sink failed');
  }, 15000);
});

