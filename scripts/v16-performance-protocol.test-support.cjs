const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const artifacts = require('./v16-performance-artifacts');
const memory = require('./v16-performance-memory');
const search = require('./v16-performance-memory-search-contract');
const windowContract = require('./v16-evidence-growth-window');
const daily = require('./v16-performance-daily-evidence');

// 只构造校验器测试协议；不启动应用，不产生真实批准、实际日观察或验收结果。
function createProtocolFactory(options) {
  const root = artifacts.directPath(path.resolve(options.root), true).path;
  const temporary = path.resolve(os.tmpdir()).toLowerCase(), parent = path.dirname(root);
  const directOwnedRoot = /^(v16-native-fixture-|v16-memory-peak-unit-)/.test(path.basename(root))
    && path.resolve(parent).toLowerCase() === temporary;
  const approvalOwnedRoot = path.basename(root) === 'run' && path.basename(parent).startsWith('nfr-approval-')
    && path.resolve(path.dirname(parent)).toLowerCase() === temporary;
  artifacts.insist(directOwnedRoot || approvalOwnedRoot, 'UNIT_PROTOCOL_OWNED_ROOT_REQUIRED');
  const directory = path.join(root, 'unit-protocol-' + randomUUID());
  fs.mkdirSync(directory, { recursive: false });
  const sourceSha256 = options.sourceSha256, packageIdentity = options.packageIdentity;
  const packageHashes = options.packageHashes ?? { installer: '7'.repeat(64), portable: '8'.repeat(64), zip: '9'.repeat(64),
    appContent: packageIdentity.appContentSha256.toLowerCase(), mainBundle: packageIdentity.mainBundleSha256.toLowerCase() };
  const runId = options.runId ?? 'fixture-run';
  let serial = 0;
  function write(label, bytes) {
    artifacts.insist(/^[A-Za-z0-9._-]+$/.test(label), 'UNIT_PROTOCOL_FILE_LABEL_REQUIRED');
    const file = path.join(directory, String(serial++) + '-' + label);
    fs.writeFileSync(file, bytes, { flag: 'wx' }); return artifacts.fileRecord(file);
  }
  const json = (label, value) => write(label + '.json', Buffer.from(JSON.stringify(value)));
  const load = record => artifacts.readBound(record).json();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRoYAAAAASUVORK5CYII=', 'base64');
  function storeContext(fixture) {
    return { storeId: 'unit-store-' + fixture, browserProfileId: 'unit-browser-' + fixture, marketplace: 'US', currency: 'USD',
      businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 0, ...(options.storeContext ?? {}) };
  }
  function slot(execution, index) {
    const begin = Date.parse(execution.startedAt), finish = Date.parse(execution.finishedAt);
    if (!(finish - begin >= 1000)) throw new Error('UNIT_PROTOCOL_EXECUTION_TOO_SHORT');
    return Math.floor(begin + (finish - begin) / 10 + index * (finish - begin) / 8);
  }
  function peakSamples(metric, fixture, values, execution) {
    return values.map((value, sampleIndex) => {
      const time = slot(execution, sampleIndex), offset = fixture === 'typical' ? 0 : 5000;
      const observations = ['cold', 'warm'].map((phase, phaseIndex) => {
        const at = time + phaseIndex * 30, mainPid = 20000 + offset + sampleIndex * 10 + phaseIndex * 2;
        const rendererPid = mainPid + 1;
        const identity = { pid: mainPid, creationTime: at + 1, packaged: true,
          windows: [{ rendererPid, creationTime: at + 2, visible: true }] };
        const launch = json('memory-launch', { kind: 'v16-nfr-native-launch', schemaVersion: 1, unitOnly: true,
          fixture, classification: 'real-data-copy', label: fixture + '/' + sampleIndex + '/' + phase, packageIdentity, identity,
          startedAt: new Date(at).toISOString(), finishedAt: new Date(at + 10).toISOString() });
        const peak = (phaseIndex ? value / 2 : value) * 1024;
        const raw = { pid: mainPid, rendererPid, metrics: [
          { pid: mainPid, type: 'Browser', creationTime: at + 1, memory: { workingSetSize: 1, peakWorkingSetSize: peak } },
          { pid: rendererPid, type: 'Tab', creationTime: at + 2, memory: { workingSetSize: 1, peakWorkingSetSize: peak } },
        ] };
        const reading = memory.selectNativeMemoryPeaks(raw, identity);
        return { phase, receipt: json('memory-observation', { kind: 'v16-nfr-memory-observation', schemaVersion: 2,
          unitOnly: true, runId, fixture, sampleIndex, capturePhase: phase, classification: 'real-data-copy', sourceSha256, packageIdentity,
          measurementBasis: memory.PEAK_MEMORY_BASIS, window: memory.PEAK_MEMORY_WINDOW,
          observedAt: new Date(at + 20).toISOString(), launch, ...reading }) };
      });
      const aggregate = memory.createMemoryPeakSample(metric, observations, { runId, fixture, sourceSha256, packageIdentity, execution }, load);
      return { ...aggregate.selected, receipt: json('memory-peak', aggregate) };
    });
  }
  function searchSamples(fixture, values, execution) {
    return values.map((value, sampleIndex) => {
      const context = storeContext(fixture), at = slot(execution, sampleIndex);
      const events = [0, 1].map(index => ({ id: 'unit-event-' + fixture + '-' + sampleIndex + '-' + index,
        storeId: context.storeId, title: '软件协议记录 ' + index, stage: 'FACT', sequence: index + 1,
        createdAt: new Date(at - 1000 + index * 100).toISOString(), eventType: 'operator_fact', entityType: 'unit-note',
        entityId: 'unit-object-' + index, signal: '仅为测试协议', status: 'recorded' }));
      const authorityKey = search.contextIdentity(context).join('|');
      const visibleProjection = events.map((event, index) => ({ id: event.id, sequence: event.sequence, title: event.title,
        stage: event.stage, createdAt: event.createdAt, displayCreatedAt: event.createdAt.slice(0, 16).replace('T', ' '),
        selectionProof: { sequence: event.sequence, title: event.title, selectedIndex: index, selected: true, authorityKey,
          diagnosticWasOpen: false, diagnosticOpenedByObserver: true, diagnosticOpen: true, sequenceVisible: true } }));
      const baseline = { query: '', expected: search.projectedRows(events, visibleProjection) };
      const dom = test => ({ ...search.expectedDom(test), ready: true, authorityKey, emptyVisible: test.expected.length === 0 });
      let previous = baseline;
      const cases = search.createSearchCases(events, context, 'unit-protocol-' + sampleIndex, visibleProjection).map((test, index) => {
        const startedAt = new Date(at + index * 100).toISOString(), finishedAt = new Date(at + index * 100 + value).toISOString();
        const timerStart = 1000 + index * 100;
        const row = { ...test, before: dom(previous), after: dom(test), elapsedMs: value, startedAt, finishedAt,
          timer: { source: 'node:perf_hooks.performance', unit: 'ms', processId: 9999, timeOriginMs: at - 1000,
            startedAtMs: timerStart, finishedAtMs: timerStart + value },
          unit: 'ms', window: 'input-to-filtered-render-two-frames', screenshot: write('memory-case.png', png),
          ...(test.id === 'unique-hit' ? { selectedResult: { ...visibleProjection[0].selectionProof, selectedIndex: 0,
            diagnosticWasOpen: true, diagnosticOpenedByObserver: false } } : {}) };
        previous = test; return row;
      });
      const identity = { packaged: true, pid: 40000 + (fixture === 'maximum' ? 5000 : 0) + sampleIndex * 10,
        rendererPid: 40001 + (fixture === 'maximum' ? 5000 : 0) + sampleIndex * 10,
        mainCreationTime: at - 100, rendererCreationTime: at - 90, executablePath: 'unit-only.exe',
        userDataDir: path.join(directory, fixture, 'search-' + sampleIndex), visible: true, windowCount: 1 };
      const ledgerHash = artifacts.digest(Buffer.from(JSON.stringify(events)));
      const observation = { kind: 'v16-nfr-memory-search-observation', schemaVersion: 1, unitOnly: true, classification: 'real-data-copy',
        appReady: false, sourceSha256, packageIdentity, fixture, storeContext: context, finalStoreContext: context,
        nativeBefore: identity, nativeAfter: { ...identity }, ledgerBeforeSha256: ledgerHash, ledgerAfterSha256: ledgerHash,
        reference: { events }, baselineDom: dom(baseline), visibleProjection, cases };
      const hit = cases[0], outer = { kind: 'v16-nfr-operation-observation', schemaVersion: 1, unitOnly: true,
        metric: 'memory-search', fixture, pid: identity.pid, elapsedMs: value, startedAt: hit.startedAt, finishedAt: hit.finishedAt,
        storeContext: context, packageIdentity, metricDefinition: 'one-preselected-unique-hit-query',
        comparisonCasesExcluded: ['zero-hit', 'restore-all'], preparationExcluded: true,
        receipt: { memorySearch: json('memory-search', observation) } };
      return { value, pid: identity.pid, observedAt: hit.finishedAt, receipt: json('memory-operation', outer) };
    });
  }
  const fixtureRecords = new Map();
  function fixtureRecord(fixture) {
    if (fixtureRecords.has(fixture)) return fixtureRecords.get(fixture);
    const parent = path.join(directory, fixture), profiles = Array.from({ length: 6 }, (_, index) => path.join(parent, 'profile-' + index));
    fs.mkdirSync(parent);
    const ownerPath = path.join(parent, 'owner.json');
    fs.writeFileSync(ownerPath, JSON.stringify({ token: 'unit-owner-' + fixture, classification: 'real-data-copy', unitOnly: true }), { flag: 'wx' });
    const owner = artifacts.fileRecord(ownerPath), context = storeContext(fixture);
    const contract = json('fixture-' + fixture, { kind: 'v16-nfr-fixture', schemaVersion: 1, unitOnly: true, fixture,
      classification: 'real-data-copy', sourceSha256, packageHashes, userDataDir: profiles[0], coldProfiles: profiles,
      storeIds: [context.storeId], scope: { marketplaceCode: 'US', dateFrom: '2026-10-01', dateTo: '2026-10-16' },
      volume: { minimumImportedRows: fixture === 'maximum' ? 100 : 10, description: '仅为校验器分支测试协议' } });
    const row = { fixture, classification: 'real-data-copy', storeIds: [context.storeId], contractSha256: contract.sha256 };
    const value = { contract, profiles, owner, ownerToken: 'unit-owner-' + fixture, row };
    fixtureRecords.set(fixture, value); return value;
  }
  function dailySet(execution, phase = 'baseline') {
    const refs = ['typical', 'maximum'].map(fixture => {
      const record = fixtureRecord(fixture), phaseOffset = phase === 'baseline' ? 0 : 3;
      const begin = Date.parse(execution.startedAt) + 1000, finish = begin + windowContract.DAY_MS + 10;
      if (!(finish <= Date.parse(execution.finishedAt))) throw new Error('UNIT_DAILY_EXECUTION_TOO_SHORT');
      return { fixture, windows: [0, 1, 2].map(index => {
        const profile = record.profiles[phaseOffset + index], evidenceRoot = path.join(profile, 'evidence');
        const binding = { sourceSha256, runId, packageIdentity, storeContext: storeContext(fixture) };
        const metadata = { fixture, fixtureContract: record.contract, fixtureContractSha256: record.contract.sha256,
          profile, owner: record.owner, ownerToken: record.ownerToken, packageHashes,
          actualMainContextObserved: false, bindingRole: 'planned-fixture-window' };
        const plan = json('window-plan', { kind: 'v16-evidence-window-plan', schemaVersion: 1, unitOnly: true,
          classification: 'real-data-copy', ...metadata, binding, evidenceRoot, maximumFiles: 1000 });
        function snapshot(ending) {
          const elapsed = ending ? windowContract.DAY_MS + 10 : 0;
          const clock = { observedAt: new Date(begin + elapsed).toISOString(), uptimeMs: 10000 + elapsed,
            machineSha256: '6'.repeat(64), source: 'system-monotonic-utc' };
          const files = ending ? [{ relativePath: 'unit.png', sizeBytes: 3, sha256: '5'.repeat(64), dev: 1,
            ino: 500000 + (fixture === 'maximum' ? 100 : 0) + phaseOffset + index, mtimeMs: 1 }] : [];
          return { kind: 'v16-evidence-growth-snapshot', schemaVersion: 1, unitOnly: true, classification: 'real-data-copy',
            formalAcceptanceEvidence: false, ...metadata, binding,
            root: { path: evidenceRoot, dev: 1, ino: 600000 + (fixture === 'maximum' ? 100 : 0) + phaseOffset + index },
            clock, captureStartedClock: { ...clock }, files, fileCount: files.length, totalBytes: ending ? 3 : 0 };
        }
        const start = snapshot(false), end = snapshot(true);
        return json('window', { kind: 'v16-evidence-growth-window-artifacts', schemaVersion: 1, unitOnly: true, plan,
          start: json('snapshot-start', start), end: json('snapshot-end', end), observation: windowContract.buildEvidenceWindow(start, end) });
      }) };
    });
    const fixtureClassifications = ['typical', 'maximum'].map(name => fixtureRecord(name).row);
    const observation = daily.collectDailyEvidenceWindows(refs, { root, identity: { sourceSha256 }, current: { packageIdentity },
      fixtureContracts: fixtureClassifications, execution });
    const budgets = ['typical', 'maximum'].map(fixture => ({ fixture, metric: 'evidence-daily-growth', unit: 'bytes',
      window: daily.DAILY_WINDOW, percentile: 95, sampleCount: 3, threshold: 10 }));
    return { observation, fixtureClassifications, budgets };
  }
  function sampleValues(row) {
    const original = load(row.samples);
    return original.samples.map(sample => sample.value);
  }
  function completeRows(rows, execution, replacePeaks) {
    for (const row of rows) {
      const values = sampleValues(row);
      if (memory.MEMORY_METRICS.has(row.metric) && replacePeaks) {
        row.unit = 'MiB'; row.window = memory.PEAK_MEMORY_WINDOW;
        row.samples = json('peak-samples', { kind: 'v16-nfr-samples', runId, metric: row.metric, fixture: row.fixture,
          environment: row.unitEnvironment, packageIdentity, samples: peakSamples(row.metric, row.fixture, values, execution) });
      } else if (row.metric === 'memory-search') {
        row.unit = 'ms'; row.window = 'per-operation';
        row.samples = json('search-samples', { kind: 'v16-nfr-samples', runId, metric: row.metric, fixture: row.fixture,
          environment: row.unitEnvironment, packageIdentity, samples: searchSamples(row.fixture, values, execution) });
      }
      else {
        const original = load(row.samples);
        row.samples = json('ordinary-samples', { ...original, samples: original.samples.map((sample, index) => ({ ...sample,
          observedAt: new Date(slot(execution, index)).toISOString() })) });
      }
      delete row.unitEnvironment;
    }
  }
  return { root, directory, json, write, load, peakSamples, searchSamples, dailySet, completeRows };
}
function completeLegacyPerformanceFixture({ root, raw, baseline, budget, context, json, packageHashes, baselineOnly = false }) {
  const originalExecution = { ...(context?.execution ?? baseline.execution) };
  const originalStart = Date.parse(originalExecution.startedAt);
  const baselineExecution = { ...originalExecution, startedAt: new Date(originalStart - 4 * windowContract.DAY_MS).toISOString(),
    finishedAt: baselineOnly ? originalExecution.finishedAt : new Date(originalStart - 2 * windowContract.DAY_MS - 1000).toISOString() };
  const measurementExecution = { ...originalExecution, startedAt: new Date(originalStart - 2 * windowContract.DAY_MS + 1).toISOString() };
  const factory = createProtocolFactory({ root, sourceSha256: baseline.sourceSha256, packageIdentity: baseline.packageIdentity,
    packageHashes, runId: baseline.runId ?? 'fixture-run' });
  baseline.unitOnly = true; budget.unitOnly = true; if (raw) raw.unitOnly = true;
  baseline.measurements = structuredClone(baseline.measurements);
  baseline.schemaVersion = 1; baseline.runId ??= 'fixture-run'; baseline.execution = baselineExecution;
  const day = factory.dailySet(baselineExecution);
  baseline.dailyEvidenceGrowth = day.observation; baseline.fixtureClassifications = day.fixtureClassifications;
  budget.dailyEvidenceGrowth = day.budgets;
  for (const target of budget.metrics) {
    if (memory.MEMORY_METRICS.has(target.metric)) { target.unit = 'MiB'; target.window = memory.PEAK_MEMORY_WINDOW; }
    if (target.metric === 'memory-search') { target.unit = 'ms'; target.window = 'per-operation'; }
  }
  for (const row of baseline.measurements) row.unitEnvironment = baseline.environment;
  factory.completeRows(baseline.measurements, baselineExecution, true);
  if (raw) {
    raw.sourceSha256 = baseline.sourceSha256;
    for (const row of raw.measurements) row.unitEnvironment = raw.environment;
    factory.completeRows(raw.measurements, measurementExecution, true);
    const measuredDay = factory.dailySet(measurementExecution, 'measure');
    raw.dailyEvidenceGrowth = measuredDay.observation; raw.fixtureClassifications = measuredDay.fixtureClassifications;
    raw.execution = measurementExecution;
    if (context) Object.assign(context.execution, measurementExecution);
    budget.approval.approvedAt = new Date(originalStart - 2 * windowContract.DAY_MS).toISOString();
  }
  if (raw) {
    raw.baseline = json('protocol-baseline', baseline); budget.baselineSha256 = raw.baseline.sha256;
    raw.budget = json('protocol-budget', budget);
  }
  return factory;
}
module.exports = { createProtocolFactory, completeLegacyPerformanceFixture };

