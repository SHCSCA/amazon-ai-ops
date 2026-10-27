const { performance } = require('node:perf_hooks');
const { randomUUID } = require('node:crypto');
const { insist, digest } = require('./v16-performance-artifacts');
const { currentStore, contextKey } = require('./v16-performance-observe');
const contract = require('./v16-performance-memory-search-contract');

const ROOT = '[data-workspace-evidence-root][data-workspace="memory"]';
function logFailure(writer, event, error, context) {
  try { writer.log(event, error, context); }
  catch (logError) {
    try {
      const { createRuntimeLogRecord } = require('../packages/shared-types/src/runtime-log-format.cjs');
      process.stderr.write(JSON.stringify(createRuntimeLogRecord('error', event, { ...context, error, logError })) + '\n');
    } catch { /* 最后日志出口失效时仍保留原观察或恢复异常。 */ }
  }
}
async function readNativeSearchIdentity(runtime) {
  const identity = await runtime.app.evaluate(({ app, BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
    const window = windows[0], rendererPid = window?.webContents.getOSProcessId();
    const metrics = app.getAppMetrics(), main = metrics.find(row => row.pid === process.pid);
    const renderer = metrics.find(row => row.pid === rendererPid);
    return { pid: process.pid, rendererPid, packaged: app.isPackaged, executablePath: process.execPath,
      userDataDir: app.getPath('userData'), windowCount: windows.length, visible: window?.isVisible() === true,
      mainCreationTime: main?.creationTime, rendererCreationTime: renderer?.creationTime };
  });
  contract.assertNativeSearchIdentity(identity);
  insist(identity.pid === runtime.identity.pid && identity.rendererPid === runtime.identity.windows[0].rendererPid
    && identity.userDataDir === runtime.identity.userDataDir && identity.executablePath === runtime.identity.executablePath,
  'NFR_MEMORY_SEARCH_RUNTIME_MISMATCH');
  return identity;
}
async function readLedger(page, context, timeoutMs) {
  let timer;
  const invocation = page.evaluate(async context => {
    const api = window.electronAPI?.missionDomain?.causal;
    if (typeof api?.listEvents !== 'function') throw new Error('NFR_MEMORY_SEARCH_MAIN_QUERY_REQUIRED');
    const rows = await api.listEvents(context, {});
    if (!Array.isArray(rows)) throw new Error('NFR_MEMORY_SEARCH_MAIN_QUERY_INVALID');
    return rows;
  }, context);
  try { return await Promise.race([invocation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('NFR_MEMORY_SEARCH_MAIN_QUERY_TIMEOUT'), { fatal: true })), timeoutMs);
  })]); } finally { clearTimeout(timer); }
}
async function readSearchDom(page) {
  return page.evaluate(selector => {
    const root = document.querySelector(selector), visible = node => Boolean(node && node.checkVisibility());
    if (!root || !visible(root)) return null;
    const panel = root.querySelector('.memory-timeline'), input = panel?.querySelector('input[aria-label="搜索因果记忆"]');
    const buttons = [...(panel?.querySelectorAll('.memory-event-list > li > button') ?? [])];
    const footer = panel?.querySelector('.workbench-panel__footer')?.textContent?.trim() ?? '';
    const total = footer.match(/·\s*(\d+)\s*条匹配记录/);
    const zero = footer === '当前筛选没有记录。';
    const empty = [...panel?.querySelectorAll('[data-workspace-state="empty"]') ?? []].some(visible);
    return { ready: visible(input) && !root.querySelector('[data-workspace-state="loading"],[data-workspace-state="error"],[data-workspace-state="blocked"]')
        && ![...root.querySelectorAll('[aria-busy="true"]')].some(visible),
      authorityKey: document.querySelector('[data-authority-key]')?.getAttribute('data-authority-key'),
      query: input?.value, total: total ? Number(total[1]) : zero ? 0 : null,
      page: panel?.querySelector('.memory-pagination > span')?.textContent?.trim(),
      titles: buttons.map(button => button.querySelector('strong')?.textContent?.trim()),
      stages: buttons.map(button => button.getAttribute('data-stage')),
      displayedTimes: buttons.map(button => button.querySelector('.memory-event-meta')?.textContent?.trim()), emptyVisible: empty,
      footer, controlBounds: input?.getBoundingClientRect().toJSON() };
  }, ROOT);
}
async function waitSearchDom(page, test, context, timeoutMs) {
  const expected = contract.expectedDom(test);
  await page.waitForFunction(({ selector, expected, authority }) => {
    const root = document.querySelector(selector), panel = root?.querySelector('.memory-timeline');
    const input = panel?.querySelector('input[aria-label="搜索因果记忆"]');
    if (!root?.checkVisibility() || !input?.checkVisibility() || input.value !== expected.query
      || document.querySelector('[data-authority-key]')?.getAttribute('data-authority-key') !== authority) return false;
    if ([...root.querySelectorAll('[aria-busy="true"],[data-workspace-state="loading"],[data-workspace-state="error"],[data-workspace-state="blocked"]')]
      .some(node => node.checkVisibility())) return false;
    const buttons = [...panel.querySelectorAll('.memory-event-list > li > button')];
    const footer = panel.querySelector('.workbench-panel__footer')?.textContent?.trim() ?? '';
    const match = footer.match(/·\s*(\d+)\s*条匹配记录/);
    const total = match ? Number(match[1]) : footer === '当前筛选没有记录。' ? 0 : null;
    const empty = [...panel.querySelectorAll('[data-workspace-state="empty"]')].some(node => node.checkVisibility());
    return total === expected.total && empty === (expected.total === 0)
      && panel.querySelector('.memory-pagination > span')?.textContent?.trim() === expected.page
      && JSON.stringify(buttons.map(button => button.querySelector('strong')?.textContent?.trim())) === JSON.stringify(expected.titles)
      && JSON.stringify(buttons.map(button => button.getAttribute('data-stage'))) === JSON.stringify(expected.stages)
      && JSON.stringify(buttons.map(button => button.querySelector('.memory-event-meta')?.textContent?.trim())) === JSON.stringify(expected.displayedTimes);
  }, { selector: ROOT, expected, authority: contextKey(context) }, { timeout: timeoutMs });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return contract.assertSearchDom(await readSearchDom(page), test, context);
}
async function selectAndReadVisibleResult(page, event, title, index, context, timeoutMs) {
  const authorityKey = contextKey(context);
  await page.locator(ROOT + ' .memory-event-list > li > button').nth(index).click();
  const diagnostics = page.locator(ROOT + ' .memory-inspector details');
  insist(await diagnostics.count() === 1, 'NFR_MEMORY_SEARCH_DIAGNOSTIC_DETAILS_REQUIRED');
  const diagnosticWasOpen = await diagnostics.evaluate(node => node.open === true);
  if (!diagnosticWasOpen) await diagnostics.locator(':scope > summary').click();
    // 点击只读记录，以详情中的原始顺序号核对第一页映射，复用生产本地化后的标题。
    await page.waitForFunction(({ selector, sequence, title, index, authorityKey }) => {
      const root = document.querySelector(selector), inspector = root?.querySelector('.memory-inspector');
      const sequenceTerm = [...inspector?.querySelectorAll('dt') ?? []].find(node => node.textContent?.trim() === 'sequence');
      const visible = node => {
        if (!node || !node.checkVisibility()) return false;
        const bounds = node.getBoundingClientRect(); if (!bounds.width || !bounds.height) return false;
        for (let current = node; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return false;
        }
        return true;
      };

      return document.querySelector('[data-authority-key]')?.getAttribute('data-authority-key') === authorityKey
        && sequenceTerm?.closest('details')?.open === true && visible(sequenceTerm)
        && visible(sequenceTerm?.nextElementSibling)
        && sequenceTerm?.nextElementSibling?.textContent?.trim() === String(sequence)
        && inspector?.querySelector('h2')?.textContent?.trim() === title
        && root?.querySelectorAll('.memory-event-list > li > button')[index]?.getAttribute('aria-pressed') === 'true';
    }, { selector: ROOT, sequence: event.sequence, title, index, authorityKey }, { timeout: timeoutMs });
  return page.evaluate(({ selector, index, diagnosticWasOpen }) => {
      const root = document.querySelector(selector), inspector = root.querySelector('.memory-inspector');
      const term = [...inspector.querySelectorAll('dt')].find(node => node.textContent?.trim() === 'sequence');
      const visible = node => {
        if (!node || !node.checkVisibility()) return false;
        const bounds = node.getBoundingClientRect(); if (!bounds.width || !bounds.height) return false;
        for (let current = node; current; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return false;
        }
        return true;
      };

      const button = root.querySelectorAll('.memory-event-list > li > button')[index];
      return { sequence: Number(term?.nextElementSibling?.textContent?.trim()), title: inspector.querySelector('h2')?.textContent?.trim(),
        selectedIndex: index, selected: button.getAttribute('aria-pressed') === 'true',
        diagnosticWasOpen, diagnosticOpenedByObserver: !diagnosticWasOpen, diagnosticOpen: term?.closest('details')?.open === true,
        sequenceVisible: visible(term) && visible(term?.nextElementSibling),
        authorityKey: document.querySelector('[data-authority-key]')?.getAttribute('data-authority-key') };
    }, { selector: ROOT, index, diagnosticWasOpen });
}
async function bindInitialVisibleProjection(page, events, context, timeoutMs) {
  const firstPage = events.slice(0, contract.PAGE_SIZE), authorityKey = contextKey(context);
  await page.waitForFunction(({ selector, events, total, authorityKey }) => {
    const root = document.querySelector(selector), panel = root?.querySelector('.memory-timeline');
    const buttons = [...panel?.querySelectorAll('.memory-event-list > li > button') ?? []];
    const input = panel?.querySelector('input[aria-label="搜索因果记忆"]');
    return root?.checkVisibility() && input?.value === '' && buttons.length === events.length
      && document.querySelector('[data-authority-key]')?.getAttribute('data-authority-key') === authorityKey
      && panel.querySelector('.workbench-panel__footer')?.textContent?.trim() === '第 1/' + Math.ceil(total / 10) + ' 页 · ' + total + ' 条匹配记录'
      && panel.querySelector('.memory-pagination > span')?.textContent?.trim() === '1 / ' + Math.ceil(total / 10)
      && buttons.every((button, index) => button.getAttribute('data-stage') === events[index].stage
        && button.querySelector('.memory-event-meta')?.textContent?.trim() === events[index].createdAt.slice(0, 16).replace('T', ' '));
  }, { selector: ROOT, events: firstPage, total: events.length, authorityKey }, { timeout: timeoutMs });
  const baselineDom = await readSearchDom(page), projection = [];
  for (let index = 0; index < firstPage.length; index++) {
    const event = firstPage[index], title = baselineDom.titles[index];
    const selectionProof = await selectAndReadVisibleResult(page, event, title, index, context, timeoutMs);
    projection.push({ id: event.id, sequence: event.sequence, stage: event.stage, createdAt: event.createdAt,
      displayCreatedAt: baselineDom.displayedTimes[index], title, selectionProof });
  }
  contract.validateVisibleProjection(events, projection, context);
  return { baselineDom, projection };
}
async function observeMemorySearch({ runtime, fixture, sourceSha256, packageIdentity, writer, prefix, timeoutMs }) {
  insist(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 900000, 'NFR_MEMORY_SEARCH_TIMEOUT_INVALID');
  insist(typeof prefix === 'string' && /^[A-Za-z0-9/_-]+$/.test(prefix)
    && !prefix.split('/').includes('..'), 'NFR_MEMORY_SEARCH_OUTPUT_PREFIX_INVALID');
  const { page } = runtime;
  let originalQuery, originalStage, originalContext, originalDiagnosticOpen, primaryError;
  const cases = [];
  try {
    const nativeBefore = await readNativeSearchIdentity(runtime);
    const view = await currentStore(page, fixture); originalContext = view.context;
    const root = page.locator(ROOT); await root.waitFor({ state: 'visible', timeout: timeoutMs });
    // 只操作真实搜索和筛选控件，不追加事实、不重建索引，也不调用写入接口。
    const all = root.getByRole('button', { name: '全部阶段', exact: true });
    insist(await all.count() === 1, 'NFR_MEMORY_SEARCH_ALL_STAGE_CONTROL_REQUIRED');
    const input = root.getByRole('textbox', { name: '搜索因果记忆', exact: true });
    originalQuery = await input.inputValue();
    const originalDiagnostics = root.locator('.memory-inspector details');
    if (await originalDiagnostics.count() === 1) originalDiagnosticOpen = await originalDiagnostics.evaluate(node => node.open === true);
    const selectedStage = root.locator('.memory-stage-rail button[aria-pressed="true"]');
    insist(await selectedStage.count() <= 1, 'NFR_MEMORY_SEARCH_STAGE_AMBIGUOUS');
    originalStage = await selectedStage.count() === 1 ? await selectedStage.getAttribute('data-stage') : null;
    insist(originalStage === null || ['FACT', 'ANALYSIS', 'DECISION', 'ACTION', 'READBACK', 'EFFECT'].includes(originalStage),
      'NFR_MEMORY_SEARCH_STAGE_INVALID');
    await all.click();
    const ledgerBefore = contract.assertEvents(await readLedger(page, view.context, timeoutMs), view.context);
    const { baselineDom, projection } = await bindInitialVisibleProjection(page, ledgerBefore, view.context, timeoutMs);
    const tests = contract.createSearchCases(ledgerBefore, view.context, randomUUID(), projection);
    const baseline = { id: 'baseline', query: '', expected: contract.projectedRows(ledgerBefore, projection) };
    await waitSearchDom(page, baseline, view.context, timeoutMs);
    for (const test of tests) {
      const before = await readSearchDom(page);
      insist(before?.query !== test.query, 'NFR_MEMORY_SEARCH_SAME_QUERY_NOOP');
      insist(contextKey((await currentStore(page, fixture)).context) === contextKey(view.context), 'NFR_MEMORY_SEARCH_CONTEXT_CHANGED');
      contract.assertNativeSearchIdentity(await readNativeSearchIdentity(runtime), nativeBefore);
      const startedAt = new Date().toISOString(), started = performance.now();
      await input.fill(test.query);
      const after = await waitSearchDom(page, test, view.context, timeoutMs);
      const finishedMonotonicMs = performance.now(), elapsedMs = finishedMonotonicMs - started;
      const finishedAt = new Date().toISOString();
      const timer = { source: 'node:perf_hooks.performance', unit: 'ms', processId: process.pid, timeOriginMs: performance.timeOrigin,
        startedAtMs: started, finishedAtMs: finishedMonotonicMs };
      const selectedResult = test.id === 'unique-hit'
        ? await selectAndReadVisibleResult(page, ledgerBefore.find(event => event.id === test.expected[0].id), test.expected[0].title, 0, view.context, timeoutMs)
        : undefined;
      contract.assertNativeSearchIdentity(await readNativeSearchIdentity(runtime), nativeBefore);
      insist(contextKey((await currentStore(page, fixture)).context) === contextKey(view.context), 'NFR_MEMORY_SEARCH_CONTEXT_CHANGED');
      const screenshot = writer.write(prefix + '/' + test.id + '.png', await page.screenshot());
      cases.push({ ...test, before, after, ...(selectedResult ? { selectedResult } : {}), timer, elapsedMs, startedAt, finishedAt, unit: 'ms',
        window: 'input-to-filtered-render-two-frames', screenshot, screenshotKind: 'actual-renderer-viewport' });
    }
    const finalStoreContext = (await currentStore(page, fixture)).context;
    const ledgerAfter = contract.assertEvents(await readLedger(page, finalStoreContext, timeoutMs), finalStoreContext);
    const observation = { kind: 'v16-nfr-memory-search-observation', schemaVersion: 1,
      classification: fixture.classification,
      ...(fixture.classification === 'isolated-software-fixture' ? { formalAcceptanceEvidence: false } : {}),
      appReady: false,
      sourceSha256, packageIdentity, fixture: fixture.fixture, profile: runtime.userDataDir,
      storeContext: view.context, finalStoreContext, nativeBefore, nativeAfter: await readNativeSearchIdentity(runtime),
      ledgerBeforeSha256: digest(Buffer.from(JSON.stringify(ledgerBefore))), ledgerAfterSha256: digest(Buffer.from(JSON.stringify(ledgerAfter))),
      reference: { kind: 'independent-readonly-main-ledger', eventCount: ledgerBefore.length, events: ledgerBefore },
      baselineDom, visibleProjection: projection, cases };
    contract.validateSearchObservation(observation);
    const receipt = writer.json(prefix + '/memory-search.json', observation);
    return { observation, receipt };
  } catch (error) {
    primaryError = error;
    logFailure(writer, 'v16.memory_search_observation_failed', error, { fixture: fixture.fixture });
    if (error && typeof error === 'object') error.fatal = true;
    throw error;
  } finally {
    // 只在原上下文仍有效时恢复搜索文本，切店后不得改动新页面。
    if (originalQuery !== undefined && originalContext) {
      try {
        if (contextKey((await currentStore(page, fixture)).context) === contextKey(originalContext)) {
          const input = page.locator(ROOT).getByRole('textbox', { name: '搜索因果记忆', exact: true });
          await input.fill(originalQuery);
          if (originalStage) await page.locator(ROOT).locator('.memory-stage-rail button[data-stage="' + originalStage + '"]').click();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const diagnostics = page.locator(ROOT + ' .memory-inspector details');
          if (typeof originalDiagnosticOpen === 'boolean' && await diagnostics.count() === 1
            && await diagnostics.evaluate(node => node.open === true) !== originalDiagnosticOpen) await diagnostics.locator(':scope > summary').click();
        }
      } catch (cleanupError) {
        logFailure(writer, 'v16.memory_search_restore_failed', cleanupError, { fixture: fixture.fixture });
        if (primaryError) throw Object.assign(new AggregateError([primaryError, cleanupError], 'NFR_MEMORY_SEARCH_AND_RESTORE_FAILED'), { fatal: true });
        throw Object.assign(cleanupError, { fatal: true });
      }
    }
  }
}
async function measureMemorySearch(options) {
  const result = await observeMemorySearch(options);
  const test = result.observation.cases.find(row => row.id === 'unique-hit');
  return { elapsedMs: test.elapsedMs, startedAt: test.startedAt, finishedAt: test.finishedAt,
    storeContext: result.observation.storeContext, method: 'real-input-to-filtered-render-two-frames',
    metricDefinition: 'one-preselected-unique-hit-query', comparisonCasesExcluded: ['zero-hit', 'restore-all'], preparationExcluded: true,
    receipt: { memorySearch: result.receipt } };
}
module.exports = { ROOT, logFailure, readNativeSearchIdentity, readLedger, readSearchDom, waitSearchDom, bindInitialVisibleProjection, observeMemorySearch, measureMemorySearch };

