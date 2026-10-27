import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const identity = require('./v16-evidence-growth-identity.js');
const capture = require('./v16-evidence-growth-capture.js');
const windowContract = require('./v16-evidence-growth-window.js');
const daily = require('./v16-performance-daily-evidence.js');
const artifacts = require('./v16-performance-artifacts.js');
const roots = [], descriptors = [];
const high = 9007199254740993n;
const binding = { runId: 'identity-software-window', sourceSha256: 'a'.repeat(64),
  packageIdentity: { executableSha256: '1'.repeat(64), appContentSha256: '2'.repeat(64), mainBundleSha256: '3'.repeat(64) },
  storeContext: { storeId: 'unit-store', browserProfileId: 'unit-profile', marketplace: 'US', currency: 'USD',
    businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 0 } };
const packageHashes = { installer: '7'.repeat(64), portable: '8'.repeat(64), zip: '9'.repeat(64),
  appContent: binding.packageIdentity.appContentSha256, mainBundle: binding.packageIdentity.mainBundleSha256 };
const initial = Date.now() - 10 * windowContract.DAY_MS;
function snapshot(files = [], ids = { dev: 1, ino: 10 }, at = 0) {
  const profile = path.join(path.parse(process.cwd()).root, 'software-identity-only', 'typical', 'profile');
  const clock = { observedAt: new Date(initial + at).toISOString(), uptimeMs: at + 10000,
    machineSha256: 'b'.repeat(64), source: 'synthetic-test-port' };
  return { kind: 'v16-evidence-growth-snapshot', schemaVersion: 1, classification: 'isolated-software-fixture',
    formalAcceptanceEvidence: false, binding: structuredClone(binding), ownerToken: 'identity-unit-owner', fixture: 'typical',
    fixtureContract: { path: path.join(path.dirname(profile), 'fixture.json'), sha256: '9'.repeat(64) }, fixtureContractSha256: '9'.repeat(64),
    profile, owner: { path: path.join(path.dirname(profile), 'owner.json'), sha256: '8'.repeat(64) }, packageHashes,
    actualMainContextObserved: false, bindingRole: 'planned-fixture-window', root: { path: path.join(profile, 'evidence'), ...ids },
    clock, captureStartedClock: { ...clock }, files, fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0) };
}
function file(ids = { dev: 1, ino: 2 }, bytes = 10, hash = '4') {
  return { relativePath: 'same.png', sizeBytes: bytes, sha256: hash.repeat(64), mtimeMs: 1000, ...ids };
}
function ownedFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v16-evidence-identity-unit-')); roots.push({ directory, parent: os.tmpdir(), prefix: 'v16-evidence-identity-unit-' });
  const target = path.join(directory, 'one.json'); fs.writeFileSync(target, 'unchanged'); return target;
}
function actualFixture() {
  const parent = path.join(path.parse(process.cwd()).root, 'Temp'), directory = path.join(parent, 'amazon-ai-ops-window-test-' + randomUUID());
  expect(fs.existsSync(directory)).toBe(false); fs.mkdirSync(directory); roots.push({ directory, parent, prefix: 'amazon-ai-ops-window-test-' });
  const profile = path.join(directory, 'profile'), evidenceRoot = path.join(profile, 'evidence'); fs.mkdirSync(evidenceRoot, { recursive: true });
  const ownerPath = path.join(directory, 'owner.json'); fs.writeFileSync(ownerPath, JSON.stringify({ token: 'identity-unit-owner', classification: 'isolated-software-fixture' }));
  const fixturePath = path.join(directory, 'fixture.json'); fs.writeFileSync(fixturePath, JSON.stringify({ kind: 'v16-nfr-fixture', schemaVersion: 1,
    fixture: 'typical', classification: 'isolated-software-fixture', sourceSha256: binding.sourceSha256, packageHashes,
    userDataDir: profile, coldProfiles: [profile], storeIds: [binding.storeContext.storeId], scope: { marketplaceCode: 'US' } }));
  const fixtureContract = artifacts.fileRecord(fixturePath);
  return { evidenceRoot, kind: 'v16-evidence-window-plan', schemaVersion: 1, classification: 'isolated-software-fixture',
    fixture: 'typical', profile, ownerToken: 'identity-unit-owner', owner: artifacts.fileRecord(ownerPath), fixtureContract,
    fixtureContractSha256: fixtureContract.sha256, maximumFiles: 1000, packageHashes, binding,
    actualMainContextObserved: false, bindingRole: 'planned-fixture-window' };
}
function mockRootIdentity(root, ino, changeNs = false) {
  const original = fs.lstatSync; let nativeReads = 0;
  vi.spyOn(fs, 'lstatSync').mockImplementation((file, options) => {
    const stat = original(file, options); if (path.resolve(String(file)).toLowerCase() !== path.resolve(root).toLowerCase()) return stat;
    const values = options?.bigint ? { dev: 1n, ino, mtimeNs: stat.mtimeNs + (changeNs && ++nativeReads >= 3 ? 1n : 0n) } : { dev: 1, ino: Number(ino) };
    return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, values);
  });
}
function dailyFixture(mixedReuse) {
  // 仅内存协议反例；不产生真实日观察、批准或可交付证据。
  const originals = new Map(), scopes = new Map();
  const put = (name, value) => { const bytes = Buffer.from(JSON.stringify(value)), reference = { path: name, sha256: artifacts.digest(bytes), sizeBytes: bytes.length };
    originals.set(name, { bytes, reference }); return reference; };
  function metadata(kind) {
    if (scopes.has(kind)) return scopes.get(kind);
    const profile = path.join(path.parse(process.cwd()).root, 'software-identity-only', kind, 'profile');
    const owner = put(path.join(path.dirname(profile), 'owner.json'), { token: 'identity-unit-owner', classification: 'real-data-copy' });
    const fixtureContract = put(path.join(path.dirname(profile), 'fixture.json'), { kind: 'v16-nfr-fixture', schemaVersion: 1, fixture: kind,
      classification: 'real-data-copy', sourceSha256: binding.sourceSha256, packageHashes, userDataDir: profile, coldProfiles: [profile],
      storeIds: [binding.storeContext.storeId], scope: { marketplaceCode: 'US' } });
    const row = { fixture: kind, fixtureContract, fixtureContractSha256: fixtureContract.sha256, profile, owner,
      ownerToken: 'identity-unit-owner', packageHashes, actualMainContextObserved: false, bindingRole: 'planned-fixture-window' };
    scopes.set(kind, row); return row;
  }
  const references = ['typical', 'maximum'].map(kind => ({ fixture: kind, windows: [0, 1, 2].map(index => {
    const scope = metadata(kind), ids = mixedReuse ? kind === 'typical' ? { dev: 1, ino: 10 } : { dev: '1', ino: '10' }
      : { dev: '1', ino: String(kind === 'typical' ? high - 1n : high) };
    function item(ending) {
      const at = index * 2 * windowContract.DAY_MS + (ending ? windowContract.DAY_MS + 10 : 0);
      const value = snapshot([], ids, at); Object.assign(value, scope, { classification: 'real-data-copy' });
      value.root.path = path.join(scope.profile, 'evidence'); value.clock.source = 'system-monotonic-utc'; value.captureStartedClock.source = 'system-monotonic-utc'; return value;
    }
    const start = item(false), end = item(true), prefix = kind + '-' + index;
    const plan = put(prefix + '-plan', { kind: 'v16-evidence-window-plan', schemaVersion: 1, classification: 'real-data-copy', ...scope, binding, evidenceRoot: start.root.path });
    return put(prefix + '-window', { kind: 'v16-evidence-growth-window-artifacts', schemaVersion: 1, plan,
      start: put(prefix + '-start', start), end: put(prefix + '-end', end), observation: windowContract.buildEvidenceWindow(start, end) });
  }) }));
  return { references, context: { root: process.cwd(), identity: { sourceSha256: binding.sourceSha256 }, current: { packageIdentity: binding.packageIdentity },
    fixtureContracts: ['typical', 'maximum'].map(kind => ({ fixture: kind, classification: 'real-data-copy', storeIds: [binding.storeContext.storeId], contractSha256: metadata(kind).fixtureContractSha256 })),
    load: reference => { const value = originals.get(reference.path); if (!value || value.reference.sha256 !== reference.sha256) throw new Error('UNIT_IDENTITY_ORIGINAL_CHANGED');
      return { bytes: value.bytes, json: () => JSON.parse(value.bytes) }; } } };
}
afterEach(() => {
  vi.restoreAllMocks(); for (const fd of descriptors.splice(0)) fs.closeSync(fd);
  for (const item of roots.splice(0)) { const target = path.resolve(item.directory); expect(path.dirname(target).toLowerCase()).toBe(path.resolve(item.parent).toLowerCase());
    expect(path.basename(target).startsWith(item.prefix)).toBe(true); expect(fs.realpathSync.native(target).toLowerCase()).toBe(target.toLowerCase()); fs.rmSync(target, { recursive: true, force: false }); }
});
describe('lossless evidence filesystem identity software contract', () => {
  it('serializes native high inode without converting it through Number', () => { expect(identity.nativeIdentity({ dev: 1n, ino: high })).toEqual({ dev: '1', ino: '9007199254740993' }); });
  it('keeps adjacent native inodes above the safe integer boundary distinct', () => { expect(identity.nativeIdentity({ dev: 1n, ino: high - 1n }).ino).not.toBe(identity.nativeIdentity({ dev: 1n, ino: high }).ino); });
  it('accepts the complete unsigned native identity range', () => { expect(identity.identityToken('18446744073709551615')).toBe('18446744073709551615'); });
  it('rejects an integer beyond the unsigned native identity range', () => { expect(identity.identityToken('18446744073709551616')).toBeNull(); });
  it('normalizes exact legacy safe numbers to canonical decimal strings', () => { expect(identity.identityToken(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991'); expect(identity.identityToken(0)).toBe('0'); });
  it('rejects unsafe Numbers even when their rounded decimal text looks integral', () => { expect(identity.identityToken(Number(high))).toBeNull(); });
  it('rejects negative and fractional identity numbers', () => { expect(identity.identityToken(-1)).toBeNull(); expect(identity.identityToken(1.5)).toBeNull(); });
  it('rejects leading zero identity strings', () => { expect(identity.identityToken('01')).toBeNull(); expect(identity.identityToken('00')).toBeNull(); });
  it('rejects signs exponents decimals and surrounding whitespace', () => { for (const value of ['+1', '-1', '1e2', '1.0', ' 1', '1 ']) expect(identity.identityToken(value)).toBeNull(); });
  it('rejects nondecimal and nonserialized identity inputs', () => { for (const value of ['0xff', '', '１', 1n, null, true, undefined]) expect(identity.identityToken(value)).toBeNull(); });
  it('requires native serialization inputs to remain BigInt values', () => { expect(() => identity.nativeIdentity({ dev: 1, ino: Number(high) })).toThrow('NATIVE_IDENTITY_REQUIRED'); });
  it('compares exact legacy and decimal identities as the same physical object', () => { expect(identity.sameIdentity({ dev: 1, ino: 10 }, { dev: '1', ino: '10' })).toBe(true); });
  it('does not merge adjacent high decimal physical identities', () => { expect(identity.sameIdentity({ dev: '1', ino: String(high - 1n) }, { dev: '1', ino: String(high) })).toBe(false); });
  it('validates a high decimal root identity without admitting unsafe numbers', () => { const value = snapshot([], { dev: '1', ino: String(high) }); expect(windowContract.validateSnapshot(value)).toBe(value); });
  it('rejects an unsafe Number in the snapshot root identity', () => { expect(() => windowContract.validateSnapshot(snapshot([], { dev: 1, ino: Number(high) }))).toThrow('ROOT_IDENTITY_INVALID'); });
  it('validates high decimal file identities and exact nanosecond metadata', () => { const value = snapshot([{ ...file({ dev: '1', ino: String(high) }), mtimeNs: '1000000001' }]); expect(windowContract.validateSnapshot(value)).toBe(value); });
  it('rejects unsafe file identities and noncanonical nanosecond metadata', () => { expect(() => windowContract.validateSnapshot(snapshot([file({ dev: 1, ino: Number(high) })]))).toThrow('FILE_METADATA_INVALID'); expect(() => windowContract.validateSnapshot(snapshot([{ ...file(), mtimeNs: '01' }]))).toThrow('FILE_METADATA_INVALID'); });
  it('preserves signed growth across equivalent legacy and decimal identities', () => { const before = snapshot([file()], { dev: 1, ino: 10 }), after = snapshot([file({ dev: '1', ino: '2' }, 3, '5')], { dev: '1', ino: '10' }, 1000); expect(windowContract.compareEvidenceInventories(before, after).netDeltaBytes).toBe(-7); });
  it('counts adjacent high file identity replacement as removal and creation', () => { const changes = windowContract.compareEvidenceInventories(snapshot([file({ dev: '1', ino: String(high - 1n) })]), snapshot([file({ dev: '1', ino: String(high) })], undefined, 1000)); expect(changes.created).toHaveLength(1); expect(changes.removed).toHaveLength(1); expect(changes.modified).toHaveLength(0); });
  it('rejects cross-fixture physical tree reuse hidden behind mixed identity representations', () => { const value = dailyFixture(true); expect(() => daily.collectDailyEvidenceWindows(value.references, value.context)).toThrow('CROSS_FIXTURE_TREE_REUSE'); });
  it('keeps different high physical trees independent across both fixtures', () => { const value = dailyFixture(false); expect(daily.collectDailyEvidenceWindows(value.references, value.context).fixtures).toHaveLength(2); });
  it('reads actual owned path and descriptor identities with nanosecond race precision', () => { const target = ownedFile(), value = identity.nativePath(target), fd = fs.openSync(target, 'r'); descriptors.push(fd); const opened = identity.nativeDescriptor(fd); expect(typeof value.stat.ino).toBe('bigint'); expect(identity.sameNativeFile(value.stat, opened)).toBe(true); expect(capture.sameFileIdentity(opened, { ...opened, mtimeNs: opened.mtimeNs + 1n })).toBe(false); expect(identity.nativeIdentity(value.stat).ino).toBe(fs.lstatSync(target, { bigint: true }).ino.toString()); });
  it('captures an explicitly mocked high native root without rounding it', () => { const plan = actualFixture(); mockRootIdentity(plan.evidenceRoot, high); const value = capture.captureEvidenceInventory(plan); expect(value.root.ino).toBe(String(high)); expect(value.root.dev).toBe('1'); expect(value.formalAcceptanceEvidence).toBe(false); });
  it('rejects a directory change smaller than one millisecond during capture', () => { const plan = actualFixture(); mockRootIdentity(plan.evidenceRoot, 1n, true); expect(() => capture.captureEvidenceInventory(plan)).toThrow(/DIRECTORY_CHANGED_DURING_CAPTURE|ROOT_CHANGED_DURING_CAPTURE/); });
});
