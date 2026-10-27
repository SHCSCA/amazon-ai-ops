import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import native from './v16-native-memory-search.js';
import contract from './v16-performance-memory-search-contract.js';
import artifacts from './v16-performance-artifacts.js';
const pngBytes = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRoYAAAAASUVORK5CYII=', 'base64');

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    const target = path.resolve(directory), parent = path.resolve(os.tmpdir());
    expect(path.dirname(target).toLowerCase()).toBe(parent.toLowerCase());
    expect(path.basename(target)).toMatch(/^v16-memory-search-native-unit-/);
    expect(fs.realpathSync.native(target).toLowerCase()).toBe(target.toLowerCase());
    fs.rmSync(target, { recursive: true, force: false });
  }
});
function packet() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v16-memory-search-native-unit-')); directories.push(root);
  const write = (name, bytes) => { const file = path.join(root, name); fs.writeFileSync(file, bytes); return artifacts.fileRecord(file); };
  const json = (name, value) => write(name, Buffer.from(JSON.stringify(value)));
  const sourceSha256 = 'a'.repeat(64), packageIdentity = { executableSha256: '1'.repeat(64), appContentSha256: '2'.repeat(64), mainBundleSha256: '3'.repeat(64) };
  const storeContext = { storeId: 'software-shaped-store', browserProfileId: 'software-shaped-profile', marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 0 };
  const events = [{ id: 'unit-memory-record', storeId: storeContext.storeId, title: '软件分支造型', stage: 'FACT',
    sequence: 1, createdAt: new Date(Date.now() - 10000).toISOString(), eventType: 'operator_fact', entityType: 'unit-note', entityId: 'unit-object' }];
  events.push({ ...events[0], id: 'unit-memory-second', title: '另一条软件分支造型', sequence: 2 });
  const identity = { packaged: true, pid: 123, rendererPid: 456, mainCreationTime: 1000, rendererCreationTime: 1001,
    userDataDir: 'unit-profile', executablePath: 'unit.exe', visible: true, windowCount: 1 };
  const startedAt = new Date(Date.now() - 5000).toISOString(), finishedAt = new Date(Date.parse(startedAt) + 100).toISOString();
  const visibleProjection = events.map((event, index) => ({ id: event.id, sequence: event.sequence, stage: event.stage,
    title: event.title, createdAt: event.createdAt, displayCreatedAt: event.createdAt.slice(0, 16).replace('T', ' '),
    selectionProof: { sequence: event.sequence, title: event.title, selectedIndex: index, selected: true, diagnosticWasOpen: false, diagnosticOpenedByObserver: true, diagnosticOpen: true, sequenceVisible: true,
      authorityKey: contract.contextIdentity(storeContext).join('|') } }));
  const baseline = { query: '', expected: contract.projectedRows(events, visibleProjection) };
  const dom = test => ({ ...contract.expectedDom(test), ready: true, authorityKey: contract.contextIdentity(storeContext).join('|'),
    emptyVisible: test.expected.length === 0 });
  let previous = baseline;
  const cases = contract.createSearchCases(events, storeContext, 'software-native-unit', visibleProjection).map((test, index) => {
    const value = { ...test, before: dom(previous), after: dom(test),
      ...(test.id === 'unique-hit' ? { selectedResult: { ...visibleProjection[0].selectionProof, selectedIndex: 0 } } : {}),
      timer: { source: 'node:perf_hooks.performance', unit: 'ms', processId: 777, timeOriginMs: 1700000000000, startedAtMs: 100 + index * 1000, finishedAtMs: 200 + index * 1000 }, elapsedMs: 100, unit: 'ms', window: 'input-to-filtered-render-two-frames',
      startedAt: new Date(Date.parse(startedAt) + index * 1000).toISOString(),
      finishedAt: new Date(Date.parse(finishedAt) + index * 1000).toISOString(), screenshot: write('case-' + index + '.png', pngBytes()) };
    previous = test; return value;
  });
  const ledgerHash = artifacts.digest(Buffer.from(JSON.stringify(events)));
  const observation = { kind: 'v16-nfr-memory-search-observation', schemaVersion: 1, classification: 'real-data-copy',
    appReady: false, sourceSha256, fixture: 'typical', packageIdentity, storeContext, finalStoreContext: storeContext,
    nativeBefore: identity, nativeAfter: structuredClone(identity), ledgerBeforeSha256: ledgerHash, ledgerAfterSha256: ledgerHash,
    reference: { events }, baselineDom: dom(baseline), visibleProjection, cases };
  const outer = { kind: 'v16-nfr-operation-observation', metric: 'memory-search', fixture: 'typical', pid: 123,
    elapsedMs: 100, startedAt, finishedAt, storeContext, packageIdentity, receipt: {},
    metricDefinition: 'one-preselected-unique-hit-query', comparisonCasesExcluded: ['zero-hit', 'restore-all'], preparationExcluded: true };
  const refresh = () => {
    outer.receipt.memorySearch = json('memory-search.json', observation);
    return { value: 100, pid: outer.pid, receipt: json('operation.json', outer), observedAt: finishedAt };
  };
  const context = { root, identity: { sourceSha256 }, current: { packageIdentity },
    execution: { startedAt: new Date(Date.now() - 20000).toISOString(), finishedAt: new Date().toISOString() } };
  return { root, observation, outer, refresh, context, sample: refresh() };
}
describe('formal memory-search native adapter software branch tests', () => {
  it('recomputes operation value from the bound input-to-render observation', () => {
    const value = packet();
    expect(native.verifyMemorySearchSample(value.sample, 'typical', value.context)).toBe(true);
  });
  it('requires three distinct native launch identities in the sample-set validator', () => {
    const values = [0, 1, 2].map(index => {
      const value = packet();
      value.outer.pid += index; value.observation.nativeBefore.pid += index; value.observation.nativeAfter.pid += index;
      value.observation.nativeBefore.mainCreationTime += index; value.observation.nativeAfter.mainCreationTime += index;
      value.sample = value.refresh(); return value;
    });
    const context = { ...values[0].context, root: os.tmpdir() };
    expect(native.verifyMemorySearchSamples(values.map(value => value.sample), 'typical', context)).toBe(true);
    expect(() => native.verifyMemorySearchSamples([values[0].sample], 'typical', context)).toThrow('THREE_SAMPLES_REQUIRED');
    expect(() => native.verifyMemorySearchSamples([values[0].sample, values[0].sample, values[0].sample], 'typical', context))
      .toThrow('INDEPENDENT_LAUNCHES_REQUIRED');
  });
  it('rejects coordinated scalar lowering when the same-run monotonic endpoints were not changed', () => {
    const value = packet();
    value.observation.cases[0].elapsedMs = 1; value.outer.elapsedMs = 1;
    value.sample = value.refresh(); value.sample.value = 1;
    expect(() => native.verifyMemorySearchSample(value.sample, 'typical', value.context)).toThrow('ELAPSED_NOT_DERIVED_FROM_TIMER');
  });
  it('rejects timer endpoints labelled with the wrong unit', () => {
    const value = packet(); value.observation.cases[0].timer.unit = 'microseconds'; value.sample = value.refresh();
    expect(() => native.verifyMemorySearchSample(value.sample, 'typical', value.context)).toThrow('MONOTONIC_TIMER_REQUIRED');
  });
  it('allows the software reviewer to check the same original chain without formal classification credit', () => {
    const value = packet();
    value.observation.classification = 'isolated-software-fixture'; value.observation.formalAcceptanceEvidence = false;
    value.sample = value.refresh();
    expect(native.verifySoftwareMemorySearchSample(value.sample, 'typical', value.context)).toBe(true);
    expect(() => native.verifyMemorySearchSample(value.sample, 'typical', value.context)).toThrow();
    const real = packet();
    expect(() => native.verifySoftwareMemorySearchSample(real.sample, 'typical', real.context)).toThrow();
  });
  it.each(['software', 'old-source', 'wrong-pid', 'changed-value', 'changed-renderer', 'forged-expected', 'metric-definition', 'missing-reference'])(
    'rejects %s without treating a passed flag as native evidence', mode => {
      const value = packet();
      if (mode === 'software') { value.observation.classification = 'isolated-software-fixture'; value.observation.formalAcceptanceEvidence = false; }
      if (mode === 'old-source') value.observation.sourceSha256 = 'f'.repeat(64);
      if (mode === 'wrong-pid') value.outer.pid++;
      if (mode === 'changed-value') value.observation.cases[0].elapsedMs++;
      if (mode === 'changed-renderer') value.observation.nativeAfter.rendererCreationTime++;
      if (mode === 'forged-expected') value.observation.cases[0].expected = [];
      if (mode === 'metric-definition') value.outer.metricDefinition = 'fastest-of-three-queries';
      value.sample = value.refresh();
      if (mode === 'missing-reference') { value.outer.receipt = {}; const file = path.join(value.root, 'operation.json'); fs.writeFileSync(file, JSON.stringify(value.outer)); value.sample.receipt = artifacts.fileRecord(file); }
      expect(() => native.verifyMemorySearchSample(value.sample, 'typical', value.context)).toThrow();
    });
  it('rejects observation timestamps outside the current envelope and changed PNG bytes', () => {
    const value = packet();
    value.context.execution.startedAt = new Date().toISOString();
    expect(() => native.verifyMemorySearchSample(value.sample, 'typical', value.context)).toThrow();
    const second = packet(); fs.appendFileSync(second.observation.cases[0].screenshot.path, 'changed');
    expect(() => native.verifyMemorySearchSample(second.sample, 'typical', second.context)).toThrow();
  });
});

