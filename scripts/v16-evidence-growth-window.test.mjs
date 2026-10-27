import { describe, expect, it } from 'vitest';
import windowContract from './v16-evidence-growth-window.js';

const { DAY_MS, buildEvidenceWindow, verifyEvidenceWindow, compareEvidenceInventories, validateSnapshot } = windowContract;
const hash = value => value.repeat(64);
const binding = { runId: 'software-evidence-window', sourceSha256: hash('a'),
  packageIdentity: { executableSha256: hash('1'), appContentSha256: hash('2'), mainBundleSha256: hash('3') },
  storeContext: { storeId: 'isolated-a', browserProfileId: 'profile-a', marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 1 } };
const initial = Date.now() - 4 * DAY_MS;
function file(name, bytes, id, content = '4') {
  return { relativePath: name, sizeBytes: bytes, dev: 1, ino: id, mtimeMs: 1000, sha256: hash(content) };
}
function snapshot(at, files = [file('first.png', 20, 2)], options = {}) {
  const clock = { observedAt: new Date(initial + at).toISOString(), uptimeMs: at + 100000,
    machineSha256: hash('b'), source: options.source ?? 'synthetic-test-port' };
  return { kind: 'v16-evidence-growth-snapshot', schemaVersion: 1, classification: options.classification ?? 'isolated-software-fixture',
    formalAcceptanceEvidence: false, binding: structuredClone(binding), ownerToken: 'software-owner',
    fixture: 'typical', fixtureContract: { path: 'G:\\Temp\\fixture.json', sha256: hash('9') }, fixtureContractSha256: hash('9'),
    profile: 'G:\\Temp\\amazon-ai-ops-window-fixture\\profile', owner: { path: 'G:\\Temp\\owner.json', sha256: hash('8') },
    packageHashes: { installer: hash('7'), portable: hash('8'), zip: hash('9'), appContent: hash('2'), mainBundle: hash('3') },
    actualMainContextObserved: false, bindingRole: 'planned-fixture-window',
    root: { path: 'G:\\Temp\\amazon-ai-ops-window-fixture\\profile\\evidence', dev: 1, ino: 10 },
    clock, captureStartedClock: { ...clock }, files, totalBytes: files.reduce((sum, row) => sum + row.sizeBytes, 0),
    fileCount: files.length, method: 'bounded-double-read-file-inventory-not-filesystem-snapshot' };
}
describe('evidence growth window pure software contract', () => {
  it('keeps a short real-clock interval diagnostic without daily or formal credit', () => {
    const before = snapshot(0, undefined, { source: 'system-monotonic-utc' });
    const after = snapshot(10000, [file('first.png', 25, 2, '5')], { source: 'system-monotonic-utc' });
    const report = buildEvidenceWindow(before, after);
    expect(report.status).toBe('SHORT_WINDOW_DIAGNOSTIC'); expect(report.realTimeDayObserved).toBe(false);
    expect(report.formalAcceptanceEvidence).toBe(false); expect(report.normalizedRate).toBeNull();
    expect(report.actualMainContextObserved).toBe(false); expect(report.bindingRole).toBe('planned-fixture-window');
    expect(report.unit).toBe('bytes'); expect(report.window).toBe('actual-observation-interval');
    expect(verifyEvidenceWindow(report, before, after).observed).toBe(true);
    expect(() => buildEvidenceWindow(before, after, { requireFullDay: true })).toThrow('ACTUAL_FULL_DAY_REQUIRED');
  });
  it('never upgrades a synthetic 48-hour clock to actual daily observation', () => {
    const report = buildEvidenceWindow(snapshot(0), snapshot(2 * DAY_MS));
    expect(report.fullDayElapsed).toBe(true); expect(report.syntheticClock).toBe(true);
    expect(report.realTimeDayObserved).toBe(false); expect(report.status).toBe('SYNTHETIC_SOFTWARE_WINDOW');
    expect(() => buildEvidenceWindow(snapshot(0), snapshot(2 * DAY_MS), { requireFullDay: true })).toThrow();
  });
  it('requires both actual UTC and same-boot monotonic time to cross 24h', () => {
    const options = { classification: 'real-data-copy', source: 'system-monotonic-utc' };
    const before = snapshot(0, undefined, options), after = snapshot(DAY_MS + 1, undefined, options);
    const report = buildEvidenceWindow(before, after, { requireFullDay: true });
    expect(report.realTimeDayObserved).toBe(true); expect(report.calendarDaySequenceClaim).toBe(false);
    expect(report.formalAcceptanceEvidence).toBe(false); expect(report.appReady).toBe(false);
    const tooShort = snapshot(DAY_MS - 1, undefined, options);
    expect(() => buildEvidenceWindow(before, tooShort, { requireFullDay: true })).toThrow('ACTUAL_FULL_DAY_REQUIRED');
  });
  it('excludes the last inventory scan duration from the complete observation interval', () => {
    const options = { classification: 'real-data-copy', source: 'system-monotonic-utc' };
    const before = snapshot(0, undefined, options), after = snapshot(DAY_MS + 1000, undefined, options);
    after.captureStartedClock = { ...after.clock, observedAt: new Date(initial + DAY_MS - 1).toISOString(), uptimeMs: DAY_MS - 1 + 100000 };
    expect(() => buildEvidenceWindow(before, after, { requireFullDay: true })).toThrow('ACTUAL_FULL_DAY_REQUIRED');
  });
  it('preserves creation, removal and signed modification ledgers even when net growth is negative', () => {
    const before = snapshot(0, [file('a.png', 100, 1), file('b.png', 30, 2), file('d.png', 20, 4)]);
    const after = snapshot(1000, [file('a.png', 60, 1, '5'), file('c.png', 15, 3), file('d.png', 30, 4, '6')]);
    const changes = compareEvidenceInventories(before, after);
    expect(changes).toMatchObject({ createdBytes: 15, removedBytes: 30, modifiedIncreaseBytes: 10,
      modifiedDecreaseBytes: 40, netDeltaBytes: -45 });
    expect(changes.created).toHaveLength(1); expect(changes.removed).toHaveLength(1); expect(changes.modified).toHaveLength(2);
  });
  it('keeps balanced creation and deletion instead of treating zero net as no activity', () => {
    const changes = compareEvidenceInventories(snapshot(0, [file('a.png', 25, 1)]), snapshot(1000, [file('b.png', 25, 2)]));
    expect(changes.netDeltaBytes).toBe(0); expect(changes.createdBytes).toBe(25); expect(changes.removedBytes).toBe(25);
  });
  it('treats a replaced path with a different file identity as removed plus created', () => {
    const changes = compareEvidenceInventories(snapshot(0), snapshot(1000, [file('first.png', 20, 99, '5')]));
    expect(changes.created).toHaveLength(1); expect(changes.removed).toHaveLength(1); expect(changes.modified).toHaveLength(0);
  });
  it.each(['source', 'package', 'context', 'owner', 'root', 'classification', 'fixture', 'contract', 'profile', 'owner-reference'])('rejects changed %s lineage', kind => {
    const before = snapshot(0), after = snapshot(1000);
    if (kind === 'source') after.binding.sourceSha256 = hash('c');
    if (kind === 'package') after.binding.packageIdentity.mainBundleSha256 = hash('d');
    if (kind === 'context') after.binding.storeContext.sessionGeneration++;
    if (kind === 'owner') after.ownerToken = 'another';
    if (kind === 'root') after.root.ino++;
    if (kind === 'classification') after.classification = 'real-data-copy';
    if (kind === 'fixture') after.fixture = 'maximum';
    if (kind === 'contract') { after.fixtureContract.sha256 = hash('6'); after.fixtureContractSha256 = hash('6'); }
    if (kind === 'profile') after.profile += '-other';
    if (kind === 'owner-reference') after.owner.sha256 = hash('6');
    expect(() => buildEvidenceWindow(before, after)).toThrow('SOURCE_PACKAGE_CONTEXT_OR_OWNER_CHANGED');
  });
  it.each(['same-time', 'backwards', 'reboot', 'clock-jump', 'machine'])('rejects %s time evidence', kind => {
    const before = snapshot(1000), after = snapshot(2000);
    if (kind === 'same-time') Object.assign(after, { clock: before.clock, captureStartedClock: before.clock });
    if (kind === 'backwards') Object.assign(after, snapshot(0));
    if (kind === 'reboot') { after.clock.uptimeMs = 1; after.captureStartedClock.uptimeMs = 1; }
    if (kind === 'clock-jump') { after.clock.observedAt = new Date(initial + DAY_MS).toISOString(); after.captureStartedClock = { ...after.clock }; }
    if (kind === 'machine') { after.clock.machineSha256 = hash('c'); after.captureStartedClock.machineSha256 = hash('c'); }
    expect(() => buildEvidenceWindow(before, after)).toThrow();
  });
  it.each(['../escape', '/absolute', 'a//b', 'a\\b', 'c:stream'])('rejects unsafe relative path %s', name => {
    expect(() => validateSnapshot(snapshot(0, [file(name, 20, 1)]))).toThrow('RELATIVE_PATH_INVALID');
  });
  it('rejects case-insensitive duplicate paths, changed totals and altered report values', () => {
    expect(() => validateSnapshot(snapshot(0, [file('A.png', 1, 1), file('a.png', 2, 2)]))).toThrow();
    const before = snapshot(0), after = snapshot(1000);
    const wrong = structuredClone(before); wrong.totalBytes++;
    expect(() => validateSnapshot(wrong)).toThrow('SNAPSHOT_TOTAL_CHANGED');
    const report = buildEvidenceWindow(before, after); report.changes.netDeltaBytes++;
    expect(() => verifyEvidenceWindow(report, before, after)).toThrow('REPORT_OR_WINDOW_CHANGED');
  });
});

