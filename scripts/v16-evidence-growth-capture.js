const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { insist, digest, directPath, within, readBound } = require('./v16-performance-artifacts');
const { validateEvidenceUserDataPath } = require('./evidence-user-data');
const { validateWindowBinding, validateSnapshot, canonical, validateFixtureWindowMetadata } = require('./v16-evidence-growth-window');
const identity = require('./v16-evidence-growth-identity');

function validateWindowPlan(value) {
  insist(value?.kind === 'v16-evidence-window-plan' && value.schemaVersion === 1
    && ['isolated-software-fixture', 'real-data-copy'].includes(value.classification)
    && typeof value.ownerToken === 'string' && value.ownerToken
    && ['typical', 'maximum'].includes(value.fixture) && /^[a-f0-9]{64}$/i.test(value.fixtureContractSha256 ?? '')
    && Number.isSafeInteger(value.maximumFiles) && value.maximumFiles >= 1 && value.maximumFiles <= 100000,
  'EVIDENCE_WINDOW_PLAN_INVALID');
  validateWindowBinding(value.binding);
  for (const key of ['installer', 'portable', 'zip', 'appContent', 'mainBundle']) {
    insist(/^[a-f0-9]{64}$/i.test(value.packageHashes?.[key] ?? ''), 'EVIDENCE_WINDOW_CONTAINER_HASHES_REQUIRED');
  }
  const profile = validateEvidenceUserDataPath(value.profile), evidence = directPath(value.evidenceRoot, true).path;
  insist(within(profile, evidence) && path.resolve(profile) !== evidence && path.basename(evidence).toLowerCase() === 'evidence',
    'EVIDENCE_WINDOW_ROOT_OUTSIDE_PROFILE');
  const owner = readBound(value.owner), document = owner.json();
  insist(path.dirname(owner.path).toLowerCase() === path.dirname(profile).toLowerCase()
    && path.basename(owner.path) === 'owner.json' && document.token === value.ownerToken
    && document.classification === value.classification, 'EVIDENCE_WINDOW_OWNER_MISMATCH');
  const fixture = readBound(value.fixtureContract).json();
  validateFixtureWindowMetadata({ ...value, profile, evidenceRoot: evidence }, fixture, document);
  return { ...value, profile, evidenceRoot: evidence };
}
function systemWindowClock() {
  return { source: 'system-monotonic-utc', observedAt: new Date().toISOString(), uptimeMs: os.uptime() * 1000,
    machineSha256: digest(Buffer.from([os.hostname(), os.platform(), os.arch()].join('|'))) };
}
function sameFileIdentity(first, second) {
  return identity.sameNativeFile(first, second);
}
function readFileSnapshot(file) {
  const admitted = identity.nativePath(file), initial = admitted.stat;
  const descriptor = fs.openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    insist(sameFileIdentity(initial, identity.nativeDescriptor(descriptor)), 'EVIDENCE_WINDOW_OPEN_FILE_CHANGED');
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
    insist(sameFileIdentity(initial, identity.nativeDescriptor(descriptor)), 'EVIDENCE_WINDOW_FILE_CHANGED_DURING_READ');
  } finally { fs.closeSync(descriptor); }
  insist(sameFileIdentity(initial, identity.nativePath(file).stat), 'EVIDENCE_WINDOW_FILE_REPLACED_DURING_READ');
  return { ...identity.fileMetadata(initial), sha256: hash.digest('hex') };
}
function captureEvidenceInventory(input, ports = {}) {
  const plan = validateWindowPlan(input), root = identity.nativePath(plan.evidenceRoot, true);
  const files = [], directories = [], pending = [root.path];
  const clock = ports.clock ? { ...ports.clock(), source: 'synthetic-test-port' } : systemWindowClock();
  const ownerBefore = readBound(plan.owner).bytes, fixtureBefore = readBound(plan.fixtureContract).bytes;
  while (pending.length) {
    const directory = pending.pop(), current = identity.nativePath(directory, true), names = fs.readdirSync(directory).sort();
    insist(within(root.path, current.path), 'EVIDENCE_WINDOW_DIRECTORY_ESCAPE');
    directories.push({ path: directory, stat: current.stat, names });
    for (const name of names) {
      const file = path.join(directory, name), stat = fs.lstatSync(file, { bigint: true });
      insist(!stat.isSymbolicLink(), 'EVIDENCE_WINDOW_LINK_REJECTED');
      if (stat.isDirectory()) pending.push(file);
      else {
        insist(stat.isFile() && stat.nlink === 1n && within(root.path, fs.realpathSync.native(file)), 'EVIDENCE_WINDOW_SPECIAL_FILE_REJECTED');
        files.push({ relativePath: path.relative(root.path, file).split(path.sep).join('/'), ...readFileSnapshot(file) });
      }
      insist(files.length + pending.length + directories.length <= plan.maximumFiles, 'EVIDENCE_WINDOW_INVENTORY_LIMIT_EXCEEDED');
    }
  }
  for (const file of files) {
    const actual = readFileSnapshot(path.join(root.path, file.relativePath));
    insist(canonical(actual) === canonical(Object.fromEntries(Object.entries(file).filter(([key]) => key !== 'relativePath'))),
      'EVIDENCE_WINDOW_FILE_CHANGED_AFTER_CAPTURE');
  }
  for (const directory of directories) {
    const after = identity.nativePath(directory.path, true).stat;
    insist(after.ino === directory.stat.ino && after.dev === directory.stat.dev && after.mtimeNs === directory.stat.mtimeNs
      && canonical(fs.readdirSync(directory.path).sort()) === canonical(directory.names), 'EVIDENCE_WINDOW_DIRECTORY_CHANGED_DURING_CAPTURE');
  }
  insist(readBound(plan.fixtureContract).bytes.equals(fixtureBefore), 'EVIDENCE_WINDOW_FIXTURE_CHANGED_DURING_CAPTURE');
  insist(readBound(plan.owner).bytes.equals(ownerBefore), 'EVIDENCE_WINDOW_OWNER_CHANGED_DURING_CAPTURE');
  const rootAfter = identity.nativePath(root.path, true);
  insist(rootAfter.stat.ino === root.stat.ino && rootAfter.stat.dev === root.stat.dev
    && rootAfter.stat.mtimeNs === root.stat.mtimeNs, 'EVIDENCE_WINDOW_ROOT_CHANGED_DURING_CAPTURE');
  const endClock = ports.clock ? { ...ports.clock(), source: 'synthetic-test-port' } : systemWindowClock();
  insist(Date.parse(endClock.observedAt) >= Date.parse(clock.observedAt)
    && endClock.uptimeMs >= clock.uptimeMs && endClock.machineSha256 === clock.machineSha256, 'EVIDENCE_WINDOW_CAPTURE_CLOCK_CHANGED');
  const value = { kind: 'v16-evidence-growth-snapshot', schemaVersion: 1, classification: plan.classification,
    formalAcceptanceEvidence: false, binding: plan.binding, ownerToken: plan.ownerToken,
    fixture: plan.fixture, fixtureContract: plan.fixtureContract, fixtureContractSha256: plan.fixtureContractSha256,
    profile: plan.profile, owner: plan.owner, packageHashes: plan.packageHashes, actualMainContextObserved: false, bindingRole: 'planned-fixture-window',
    root: { path: root.path, ...identity.nativeIdentity(root.stat) }, clock: endClock,
    captureStartedClock: clock, files: files.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0),
    fileCount: files.length, totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    method: 'bounded-double-read-file-inventory-not-filesystem-snapshot' };
  return validateSnapshot(value);
}
module.exports = { validateWindowPlan, systemWindowClock, sameFileIdentity, readFileSnapshot, captureEvidenceInventory };

