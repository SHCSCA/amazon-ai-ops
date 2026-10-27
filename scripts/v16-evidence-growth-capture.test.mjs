import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const artifacts = require('./v16-performance-artifacts.js');
const capture = require('./v16-evidence-growth-capture.js');
const contract = require('./v16-evidence-growth-window.js');
const cli = require('./capture-v16-evidence-window.js');
const nativeDaily = require('./v16-native-evidence-growth.js');
const nativeArtifacts = require('./v16-native-artifacts.js');

const roots = [];
function ownedTree() {
  const directory = path.join(path.parse(process.cwd()).root, 'Temp', 'amazon-ai-ops-window-test-' + randomUUID());
  expect(fs.existsSync(directory)).toBe(false); fs.mkdirSync(directory, { recursive: true }); roots.push(directory);
  const profile = path.join(directory, 'profile'), evidence = path.join(profile, 'evidence');
  fs.mkdirSync(evidence, { recursive: true });
  const ownerPath = path.join(directory, 'owner.json');
  fs.writeFileSync(ownerPath, JSON.stringify({ token: 'owner-test-token', classification: 'isolated-software-fixture' }));
  const plan = { kind: 'v16-evidence-window-plan', schemaVersion: 1, fixture: 'typical', fixtureContractSha256: '9'.repeat(64), classification: 'isolated-software-fixture',
    profile, evidenceRoot: evidence, ownerToken: 'owner-test-token', owner: artifacts.fileRecord(ownerPath), maximumFiles: 1000,
    packageHashes: Object.fromEntries(['installer', 'portable', 'zip', 'appContent', 'mainBundle'].map(key => [key, 'a'.repeat(64)])),
    binding: { runId: 'software-window-fs', sourceSha256: 'b'.repeat(64),
      packageIdentity: { executableSha256: 'c'.repeat(64), appContentSha256: 'd'.repeat(64), mainBundleSha256: 'e'.repeat(64) },
      storeContext: { storeId: 'store-a', browserProfileId: 'profile-a', marketplace: 'US', currency: 'USD',
        businessTimezone: 'America/Los_Angeles', businessDate: '2026-10-16', sessionGeneration: 0 } } };
  plan.packageHashes.appContent = plan.binding.packageIdentity.appContentSha256;
  plan.packageHashes.mainBundle = plan.binding.packageIdentity.mainBundleSha256;
  plan.actualMainContextObserved = false; plan.bindingRole = 'planned-fixture-window';
  const fixturePath = path.join(directory, 'fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify({ kind: 'v16-nfr-fixture', schemaVersion: 1, fixture: 'typical',
    classification: plan.classification, sourceSha256: plan.binding.sourceSha256, packageHashes: plan.packageHashes,
    userDataDir: profile, coldProfiles: [profile], storeIds: [plan.binding.storeContext.storeId], scope: { marketplaceCode: 'US' } }));
  plan.fixtureContract = artifacts.fileRecord(fixturePath); plan.fixtureContractSha256 = plan.fixtureContract.sha256;
  return { directory, profile, evidence, plan };
}
function clock(at) {
  return () => ({ observedAt: new Date(1700000000000 + at).toISOString(), uptimeMs: at + 1000,
    machineSha256: 'f'.repeat(64), source: 'system-monotonic-utc' });
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of roots.splice(0)) {
    const target = path.resolve(directory), allowed = path.join(path.parse(process.cwd()).root, 'Temp');
    expect(path.dirname(target).toLowerCase()).toBe(allowed.toLowerCase());
    expect(path.basename(target)).toMatch(/^amazon-ai-ops-window-test-[a-f0-9-]{36}$/);
    expect(fs.realpathSync.native(target).toLowerCase()).toBe(target.toLowerCase());
    fs.rmSync(target, { recursive: true, force: false });
  }
});
describe('evidence inventory filesystem software capture', () => {
  it('captures actual file hashes without changing source bytes or hiding signed growth', () => {
    const value = ownedTree(), a = path.join(value.evidence, 'a.png'), b = path.join(value.evidence, 'b.json');
    fs.writeFileSync(a, 'a'.repeat(100)); fs.writeFileSync(b, 'kept');
    const before = capture.captureEvidenceInventory(value.plan, { clock: clock(0) });
    expect(before.clock.source).toBe('synthetic-test-port');
    expect(before.totalBytes).toBe(104); expect(before.fileCount).toBe(2);
    expect(fs.readFileSync(b, 'utf8')).toBe('kept');
    fs.writeFileSync(a, 'a'.repeat(20)); fs.writeFileSync(path.join(value.evidence, 'new.png'), 'new');
    const after = capture.captureEvidenceInventory(value.plan, { clock: clock(1000) });
    const report = contract.buildEvidenceWindow(before, after);
    expect(report.changes.netDeltaBytes).toBe(-77); expect(report.changes.modifiedDecreaseBytes).toBe(80);
    expect(report.formalAcceptanceEvidence).toBe(false); expect(report.realTimeDayObserved).toBe(false);
  });
  it('cannot relabel an injected system-looking clock as actual observation', () => {
    const value = ownedTree();
    const before = capture.captureEvidenceInventory(value.plan, { clock: clock(0) });
    const after = capture.captureEvidenceInventory(value.plan, { clock: clock(2 * contract.DAY_MS) });
    expect(before.clock.source).toBe('synthetic-test-port');
    expect(() => contract.buildEvidenceWindow(before, after, { requireFullDay: true })).toThrow('ACTUAL_FULL_DAY_REQUIRED');
  });
  it('rejects foreign owners and an evidence root outside its admitted profile', () => {
    const value = ownedTree(), wrongOwner = structuredClone(value.plan);
    wrongOwner.ownerToken = 'foreign';
    expect(() => capture.captureEvidenceInventory(wrongOwner)).toThrow('OWNER_MISMATCH');
    const outside = path.join(value.directory, 'evidence'); fs.mkdirSync(outside);
    expect(() => capture.captureEvidenceInventory({ ...value.plan, evidenceRoot: outside })).toThrow('ROOT_OUTSIDE_PROFILE');
  });
  it('rejects a self-reported fixture label or an owned profile absent from the actual contract', () => {
    const value = ownedTree();
    expect(() => capture.captureEvidenceInventory({ ...value.plan, fixture: 'maximum' })).toThrow('ACTUAL_FIXTURE_CONTRACT_REQUIRED');
    const profile = path.join(value.directory, 'other-profile'), evidenceRoot = path.join(profile, 'evidence');
    fs.mkdirSync(evidenceRoot, { recursive: true });
    expect(() => capture.captureEvidenceInventory({ ...value.plan, profile, evidenceRoot })).toThrow('PROFILE_NOT_IN_FIXTURE_CONTRACT');
  });
  it('rejects hard-linked evidence rather than hashing a foreign shared file', () => {
    const value = ownedTree(), original = path.join(value.directory, 'outside.png');
    fs.writeFileSync(original, 'outside'); fs.linkSync(original, path.join(value.evidence, 'linked.png'));
    expect(() => capture.captureEvidenceInventory(value.plan)).toThrow('SPECIAL_FILE_REJECTED');
  });
  it('rejects a junction without traversing its target', () => {
    const value = ownedTree(), outside = path.join(value.directory, 'other'); fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'untouched'), 'safe');
    fs.symlinkSync(outside, path.join(value.evidence, 'linked'), 'junction');
    expect(() => capture.captureEvidenceInventory(value.plan)).toThrow('LINK_REJECTED');
    expect(fs.readFileSync(path.join(outside, 'untouched'), 'utf8')).toBe('safe');
  });
  it('detects a file changing while the descriptor is open and closes that descriptor', () => {
    const value = ownedTree(), file = path.join(value.evidence, 'race.json'); fs.writeFileSync(file, 'before');
    const identity = fs.statSync(file, { bigint: true }), original = fs.readSync, close = vi.spyOn(fs, 'closeSync');
    let changed = false, raceDescriptor;
    vi.spyOn(fs, 'readSync').mockImplementation((...args) => {
      const count = original(...args), actual = fs.fstatSync(args[0], { bigint: true });
      // 只在目标文件的已打开描述符上注入竞争，避免先改写元数据读取之前的文件。
      if (!changed && count > 0 && actual.dev === identity.dev && actual.ino === identity.ino) {
        changed = true; raceDescriptor = args[0]; fs.writeFileSync(file, 'after-different-size');
      }
      return count;
    });
    expect(() => capture.captureEvidenceInventory(value.plan)).toThrow(/FILE_CHANGED/);
    expect(close).toHaveBeenCalled();
    expect(changed).toBe(true);
    expect(close).toHaveBeenCalledWith(raceDescriptor);
    expect(() => fs.fstatSync(raceDescriptor)).toThrow();
  });
  it('rejects the inventory limit and rewrites neither owner nor evidence', () => {
    const value = ownedTree(); fs.writeFileSync(path.join(value.evidence, 'a'), 'a'); fs.writeFileSync(path.join(value.evidence, 'b'), 'b');
    const owner = fs.readFileSync(value.plan.owner.path);
    expect(() => capture.captureEvidenceInventory({ ...value.plan, maximumFiles: 1 })).toThrow('INVENTORY_LIMIT');
    expect(fs.readFileSync(value.plan.owner.path).equals(owner)).toBe(true);
    expect(fs.readFileSync(path.join(value.evidence, 'a'), 'utf8')).toBe('a');
  });
  it('revalidates bound snapshot JSON rather than trusting the report boolean', () => {
    const value = ownedTree(), before = capture.captureEvidenceInventory(value.plan, { clock: clock(0) });
    fs.writeFileSync(path.join(value.evidence, 'new'), 'value');
    const after = capture.captureEvidenceInventory(value.plan, { clock: clock(1000) });
    const startPath = path.join(value.directory, 'start.json'), endPath = path.join(value.directory, 'end.json');
    fs.writeFileSync(startPath, JSON.stringify(before)); fs.writeFileSync(endPath, JSON.stringify(after));
    const planPath = path.join(value.directory, 'plan.json'); fs.writeFileSync(planPath, JSON.stringify(value.plan));
    const container = { kind: 'v16-evidence-growth-window-artifacts', schemaVersion: 1, plan: artifacts.fileRecord(planPath), start: artifacts.fileRecord(startPath),
      end: artifacts.fileRecord(endPath), observation: contract.buildEvidenceWindow(before, after) };
    const reportPath = path.join(value.directory, 'report.json'); fs.writeFileSync(reportPath, JSON.stringify(container));
    const report = artifacts.fileRecord(reportPath);
    expect(contract.verifyEvidenceWindowArtifacts(report).observed).toBe(true);
    fs.appendFileSync(startPath, ' ');
    expect(() => contract.verifyEvidenceWindowArtifacts(report)).toThrow('ARTIFACT_CHANGED');
  });
});
function scopedOwnerFixture() {
  const value = ownedTree(), reportRoot = path.join(value.directory, 'report-root'); fs.mkdirSync(reportRoot);
  value.plan.classification = 'real-data-copy';
  fs.writeFileSync(value.plan.owner.path, JSON.stringify({ token: value.plan.ownerToken, classification: 'real-data-copy' }));
  value.plan.owner = artifacts.fileRecord(value.plan.owner.path);
  const fixture = artifacts.readBound(value.plan.fixtureContract).json(); fixture.classification = 'real-data-copy';
  const fixturePath = path.join(reportRoot, 'fixture.json'); fs.writeFileSync(fixturePath, JSON.stringify(fixture));
  value.plan.fixtureContract = artifacts.fileRecord(fixturePath); value.plan.fixtureContractSha256 = value.plan.fixtureContract.sha256;
  const context = { root: reportRoot, identity: { sourceSha256: value.plan.binding.sourceSha256 },
    current: { packageIdentity: value.plan.binding.packageIdentity } };
  const rows = [{ fixture: 'typical', classification: 'real-data-copy', storeIds: fixture.storeIds, contractSha256: value.plan.fixtureContractSha256 }];
  function container() {
    const planPath = path.join(reportRoot, 'plan.json'); fs.writeFileSync(planPath, JSON.stringify(value.plan));
    const file = path.join(reportRoot, 'window.json'); fs.writeFileSync(file, JSON.stringify({ kind: 'v16-evidence-growth-window-artifacts',
      schemaVersion: 1, plan: artifacts.fileRecord(planPath) }));
    return artifacts.fileRecord(file);
  }
  return { ...value, reportRoot, context, rows, container };
}
describe('formal owner original admission stays scoped to the verified profile parent', () => {
  it('records an external owned owner.json in the existing artifact ledger without granting other external inputs', () => {
    const value = scopedOwnerFixture(), ledger = new Map(), loader = nativeDaily.createScopedDailyArtifactLoader(value.context, value.rows);
    nativeArtifacts.withArtifactLedger(ledger, () => {
      loader(value.container()); expect(loader(value.plan.owner).json().token).toBe(value.plan.ownerToken);
      expect(ledger.has(value.plan.owner.path.toLowerCase())).toBe(true);
      for (const record of ledger.values()) nativeArtifacts.readArtifact(value.reportRoot, record, path.dirname(record.path));
      const other = path.join(value.directory, 'other.json'); fs.writeFileSync(other, '{}');
      expect(() => loader(artifacts.fileRecord(other))).toThrow('ARTIFACT_OUTSIDE_OWNER');
    });
  });
  it('rejects a different external filename before it can become an admitted owner input', () => {
    const value = scopedOwnerFixture(), other = path.join(value.directory, 'foreign.json');
    fs.writeFileSync(other, JSON.stringify({ token: value.plan.ownerToken, classification: 'real-data-copy' }));
    value.plan.owner = artifacts.fileRecord(other);
    const loader = nativeDaily.createScopedDailyArtifactLoader(value.context, value.rows);
    expect(() => loader(value.container())).toThrow('OWNER_PATH_NOT_SCOPED');
  });
});
describe('evidence window explicit CLI configuration', () => {
  it('accepts begin/end/verify with explicit owned outputs and strict booleans', () => {
    expect(cli.parseArguments(['--mode', 'begin', '--plan', 'plan.json', '--out-dir', 'new'])).toMatchObject({ mode: 'begin', requireFullDay: false });
    expect(cli.parseArguments(['--mode', 'end', '--plan', 'plan.json', '--start', 'start.json', '--out-dir', 'new', '--require-full-day', 'true']).requireFullDay).toBe(true);
    expect(cli.parseArguments(['--mode', 'verify', '--report', 'report.json', '--out-dir', 'new']).mode).toBe('verify');
  });
  it.each([
    [['--mode', 'begin', '--plan', 'p', '--out-dir', 'o', '--require-full-day', 'true']],
    [['--mode', 'end', '--plan', 'p', '--out-dir', 'o']],
    [['--mode', 'begin', '--plan', 'p', '--start', 's', '--out-dir', 'o']],
    [['--mode', 'verify', '--report', 'r', '--out-dir', 'o', '--out-dir', 'duplicate']],
    [['--mode', 'verify', '--report', 'r', '--out-dir', 'o', '--require-full-day', 'yes']],
    [['--mode', 'verify', '--report', 'https://remote/r', '--out-dir', 'o']],
  ])('rejects ambiguous or unaudited CLI arguments %j', args => {
    expect(() => cli.parseArguments(args)).toThrow();
  });
});

