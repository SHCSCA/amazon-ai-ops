import { describe, expect, it } from 'vitest';
import daily from './v16-performance-daily-evidence.js';
import windowContract from './v16-evidence-growth-window.js';
import artifacts from './v16-performance-artifacts.js';
import nativeDaily from './v16-native-evidence-growth.js';

// 全部对象是内存中的协议造型，只验证正反分支，不输出真实时间或批准证据。
function fixture() {
  const store = 'software-shaped-store-a', sourceSha256 = 'a'.repeat(64);
  const packageIdentity = { executableSha256: '1'.repeat(64), appContentSha256: '2'.repeat(64), mainBundleSha256: '3'.repeat(64) };
  const originals = new Map(), now = Date.now() - 10 * windowContract.DAY_MS;
  function put(name, value) {
    const bytes = Buffer.from(JSON.stringify(value)), record = { path: '/software-only/' + name, sha256: artifacts.digest(bytes), sizeBytes: bytes.length };
    originals.set(record.path, { record, bytes }); return record;
  }
  const binding = { sourceSha256, runId: 'software-protocol-window', packageIdentity,
    storeContext: { storeId: store, browserProfileId: 'profile-a', marketplace: 'US', currency: 'USD',
      businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 0 } };
  const scopes = new Map();
  function metadata(kind) {
    if (scopes.has(kind)) return scopes.get(kind);
    const profile = '/software-only/' + kind + '/profile';
    const packageHashes = { installer: '7'.repeat(64), portable: '8'.repeat(64), zip: '9'.repeat(64),
      appContent: packageIdentity.appContentSha256, mainBundle: packageIdentity.mainBundleSha256 };
    const owner = put(kind + '/owner.json', { token: 'software-owner', classification: 'real-data-copy' });
    const fixtureContract = put(kind + '-fixture.json', { kind: 'v16-nfr-fixture', schemaVersion: 1, fixture: kind,
      classification: 'real-data-copy', sourceSha256, packageHashes, userDataDir: profile, coldProfiles: [profile],
      storeIds: [store], scope: { marketplaceCode: 'US' } });
    const value = { fixture: kind, fixtureContract, fixtureContractSha256: fixtureContract.sha256, profile, owner,
      ownerToken: 'software-owner', packageHashes, actualMainContextObserved: false, bindingRole: 'planned-fixture-window' };
    scopes.set(kind, value); return value;
  }
  function snapshot(kind, index, ending) {
    const at = index * 2 * windowContract.DAY_MS + (ending ? windowContract.DAY_MS + 10 : 0);
    const clock = { observedAt: new Date(now + at).toISOString(), uptimeMs: at + 1000,
      machineSha256: 'b'.repeat(64), source: 'system-monotonic-utc' };
    const files = ending ? [{ relativePath: 'capture.png', sizeBytes: 50 + index, dev: 1, ino: index + 100,
      mtimeMs: 1, sha256: 'c'.repeat(64) }] : [];
    return { kind: 'v16-evidence-growth-snapshot', schemaVersion: 1, classification: 'real-data-copy',
      formalAcceptanceEvidence: false, ...metadata(kind), binding, clock, captureStartedClock: { ...clock },
      root: { path: '/software-only/' + kind + '/profile/evidence', dev: 1, ino: kind === 'typical' ? 10 : 11 },
      files, fileCount: files.length, totalBytes: files.reduce((sum, row) => sum + row.sizeBytes, 0) };
  }
  const references = ['typical', 'maximum'].map(kind => ({ fixture: kind, windows: [0, 1, 2].map(index => {
    const first = snapshot(kind, index, false), last = snapshot(kind, index, true);
    return put(kind + '-' + index + '-window.json', { kind: 'v16-evidence-growth-window-artifacts', schemaVersion: 1,
      plan: put(kind + '-' + index + '-plan.json', { kind: 'v16-evidence-window-plan', schemaVersion: 1,
        classification: 'real-data-copy', ...metadata(kind), binding, evidenceRoot: first.root.path }),
      start: put(kind + '-' + index + '-start.json', first), end: put(kind + '-' + index + '-end.json', last),
      observation: windowContract.buildEvidenceWindow(first, last) });
  }) }));
  const context = { root: '/', identity: { sourceSha256 }, current: { packageIdentity },
    fixtureContracts: ['typical', 'maximum'].map(kind => ({ fixture: kind, classification: 'real-data-copy', storeIds: [store], contractSha256: metadata(kind).fixtureContractSha256 })),
    load: reference => {
      const value = originals.get(reference.path);
      if (!value || value.record.sha256 !== reference.sha256) throw new Error('UNIT_ORIGINAL_HASH_CHANGED');
      return { bytes: value.bytes, json: () => JSON.parse(value.bytes) };
    } };
  const budgets = ['typical', 'maximum'].map(kind => ({ fixture: kind, metric: 'evidence-daily-growth', percentile: 95,
    unit: 'bytes', window: daily.DAILY_WINDOW, sampleCount: 3, threshold: 100 }));
  function replace(reference, change) {
    const value = context.load(reference).json(); change(value);
    const next = put(reference.path.replace('/software-only/', ''), value); Object.assign(reference, next);
  }
  return { references, context, budgets, originals, replace };
}
describe('additional real-time evidence window budget mechanism', () => {
  it('requires three distinct complete windows per fixture and recomputes endpoint net changes', () => {
    const value = fixture(), observed = daily.collectDailyEvidenceWindows(value.references, value.context);
    expect(observed.fixtures).toHaveLength(2);
    expect(observed.fixtures[0].samples.map(row => row.value)).toEqual([50, 51, 52]);
    expect(daily.verifyDailyEvidenceBudget(observed, value.budgets, value.context).map(row => row.observed)).toEqual([52, 52]);
    expect(observed).not.toHaveProperty('approved'); expect(observed).not.toHaveProperty('appReady', true);
    expect(observed.fixtures[0].samples[0].endpointInventoryOnly).toBe(true);
    expect(observed.fixtures[0].samples[0].intermediateChangesObserved).toBe(false);
  });
  it('preserves a negative endpoint net value without claiming unseen intermediate writes', () => {
    const value = fixture(), reference = value.references[0].windows[0];
    value.replace(reference, container => {
      value.replace(container.start, row => {
        row.files = [{ relativePath: 'removed.png', sizeBytes: 200, dev: 1, ino: 999, mtimeMs: 1, sha256: 'd'.repeat(64) }];
        row.totalBytes = 200; row.fileCount = 1;
      });
      container.observation = windowContract.buildEvidenceWindow(value.context.load(container.start).json(), value.context.load(container.end).json());
    });
    const sample = daily.collectDailyEvidenceWindows(value.references, value.context).fixtures[0].samples[0];
    expect(sample.value).toBe(-150); expect(sample.netDeltaBytes).toBe(-150);
    expect(sample.valueDefinition).toContain('no-clamping');
    expect(sample.intermediateChangesObserved).toBe(false);
  });
  it('rejects a changed bound plan or fixture contract digest', () => {
    for (const mode of ['plan-root', 'plan-owner', 'fixture-digest']) {
      const value = fixture();
      if (mode === 'fixture-digest') value.context.fixtureContracts[0].contractSha256 = '0'.repeat(64);
      else value.replace(value.references[0].windows[0], container => value.replace(container.plan, plan => {
        if (mode === 'plan-root') plan.evidenceRoot += '-other'; else plan.ownerToken += '-other';
      }));
      expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow();
    }
  });
  it('rejects repackaging a typical snapshot pair as maximum with a different plan label and contract', () => {
    const value = fixture(), source = value.references[0].windows[0], target = value.references[1].windows[0];
    const typical = value.context.load(source).json();
    value.replace(target, container => { container.start = typical.start; container.end = typical.end; container.observation = typical.observation; });
    expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow();
  });
  it('rejects cross-fixture physical tree reuse even when the canonical paths differ', () => {
    const value = fixture();
    value.replace(value.references[1].windows[0], container => {
      for (const key of ['start', 'end']) value.replace(container[key], row => { row.root.ino = 10; });
      container.observation = windowContract.buildEvidenceWindow(value.context.load(container.start).json(), value.context.load(container.end).json());
    });
    expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow('CROSS_FIXTURE_TREE_REUSE');
  });
  it('rejects repeated overlapping windows hidden behind root path casing and fresh report hashes', () => {
    const value = fixture(), first = value.context.load(value.references[0].windows[0]).json();
    value.replace(value.references[0].windows[1], container => {
      for (const key of ['start', 'end']) value.replace(container[key], row => {
        const original = value.context.load(first[key]).json(); row.clock = original.clock; row.captureStartedClock = original.captureStartedClock;
        row.root.path = row.root.path.toUpperCase();
      });
      container.observation = windowContract.buildEvidenceWindow(value.context.load(container.start).json(), value.context.load(container.end).json());
    });
    expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow('OVERLAPPING_SAMPLES');
  });
  it('rejects old budgets with only after-sample diagnostic targets', () => {
    expect(() => daily.validateDailyEvidenceBudgets(undefined)).toThrow('BUDGET_INVENTORY_REQUIRED');
    const value = fixture(); value.budgets[0].window = 'after-sample';
    expect(() => daily.validateDailyEvidenceBudgets(value.budgets)).toThrow('APPROVED_TARGET_INVALID');
  });
  it('rejects missing or repeated windows instead of reducing the sample requirement', () => {
    const value = fixture(); value.references[0].windows.pop();
    expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow('THREE_ACTUAL_WINDOWS_REQUIRED');
    const other = fixture(); other.references[0].windows[1] = other.references[0].windows[0];
    expect(() => daily.collectDailyEvidenceWindows(other.references, other.context)).toThrow('REUSED_WINDOW');
  });
  it('rejects a short real-clock window even when its report says full day', () => {
    const value = fixture(), reference = value.references[0].windows[0];
    value.replace(reference, container => {
      const start = value.context.load(container.start).json();
      value.replace(container.end, end => {
        end.clock = { ...start.clock, observedAt: new Date(Date.parse(start.clock.observedAt) + 1000).toISOString(), uptimeMs: start.clock.uptimeMs + 1000 };
        end.captureStartedClock = { ...end.clock };
      });
    });
    expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow('ACTUAL_FULL_DAY_REQUIRED');
  });
  it('rejects synthetic clocks, changed fixture stores and source/package drift', () => {
    for (const mode of ['synthetic', 'store', 'source', 'package']) {
      const value = fixture();
      if (mode === 'store') value.context.fixtureContracts[0].storeIds = ['other-store'];
      if (mode === 'source') value.context.identity.sourceSha256 = 'e'.repeat(64);
      if (mode === 'package') value.context.current.packageIdentity = { ...value.context.current.packageIdentity, mainBundleSha256: 'f'.repeat(64) };
      if (mode === 'synthetic') value.replace(value.references[0].windows[0], container => {
        value.replace(container.start, row => { row.clock.source = 'synthetic-test-port'; row.captureStartedClock.source = 'synthetic-test-port'; });
        value.replace(container.end, row => { row.clock.source = 'synthetic-test-port'; row.captureStartedClock.source = 'synthetic-test-port'; });
      });
      expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow();
    }
  });
  it('keeps a threshold excess as a blocker without changing the independently supplied budget', () => {
    const value = fixture(), before = JSON.stringify(value.budgets);
    value.budgets[0].threshold = 10; const low = JSON.stringify(value.budgets);
    const observed = daily.collectDailyEvidenceWindows(value.references, value.context);
    expect(() => daily.verifyDailyEvidenceBudget(observed, value.budgets, value.context)).toThrow('APPROVED_DAILY_EVIDENCE_BUDGET_EXCEEDED');
    expect(JSON.stringify(value.budgets)).toBe(low); expect(low).not.toBe(before);
  });
  it('rejects altered reported observations and a publication window shorter than the real observation', () => {
    const value = fixture(), observed = daily.collectDailyEvidenceWindows(value.references, value.context);
    observed.fixtures[0].samples[0].value = 0;
    expect(() => daily.verifyDailyEvidenceBudget(observed, value.budgets, value.context)).toThrow('OBSERVATION_SET_CHANGED');
    value.context.execution = { startedAt: new Date().toISOString(), finishedAt: new Date(Date.now() + 1000).toISOString() };
    expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow('OUTSIDE_EXECUTION_WINDOW');
  });
});


describe('formal native daily evidence gate', () => {
  it('rejects the old after-sample packet without upgrading a short delta to daily credit', () => {
    expect(() => nativeDaily.verifyFormalDailyEvidenceGrowth({ metrics: [{ metric: 'evidence-growth', window: 'after-sample', observed: 1 }] }, {}, {}))
      .toThrow('NATIVE_DAILY_EVIDENCE_REAL_WINDOWS_REQUIRED');
  });
  it('requires real-data fixture store contracts and the current package identity', () => {
    const raw = { dailyEvidenceGrowth: { status: 'OBSERVED' }, fixtureClassifications: [] };
    expect(() => nativeDaily.verifyFormalDailyEvidenceGrowth(raw, {}, {})).toThrow('REAL_FIXTURE_STORE_CONTRACT_REQUIRED');
    const value = fixture();
    Object.assign(raw, { sourceSha256: '0'.repeat(64), packageIdentity: value.context.current.packageIdentity,
      fixtureClassifications: value.context.fixtureContracts });
    expect(() => nativeDaily.verifyFormalDailyEvidenceGrowth(raw, {}, value.context)).toThrow('SOURCE_OR_PACKAGE_MISMATCH');
  });
});
