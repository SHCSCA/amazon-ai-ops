const path = require('node:path');
const { insist, digest, readBound } = require('./v16-performance-artifacts');
const { contextIdentity } = require('./v16-performance-memory-search-contract');
const identity = require('./v16-evidence-growth-identity');

const DAY_MS = 86400000;
const MAXIMUM_CLOCK_SKEW_MS = 5000;
function normalize(value) {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : normalize(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, normalize(value[key])]));
  return value;
}
const canonical = value => JSON.stringify(normalize(value));
const same = (left, right) => canonical(left) === canonical(right);
function validateWindowBinding(binding) {
  insist(binding && /^[a-f0-9]{64}$/i.test(binding.sourceSha256 ?? '')
    && typeof binding.runId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{5,100}$/.test(binding.runId),
  'EVIDENCE_WINDOW_BINDING_INVALID');
  contextIdentity(binding.storeContext);
  for (const key of ['executableSha256', 'appContentSha256', 'mainBundleSha256']) {
    insist(/^[a-f0-9]{64}$/i.test(binding.packageIdentity?.[key] ?? ''), 'EVIDENCE_WINDOW_PACKAGE_IDENTITY_INVALID');
  }
  return binding;
}
function canonicalProfilePath(value) {
  insist(typeof value === 'string' && path.isAbsolute(value) && !value.includes('\\0'), 'EVIDENCE_WINDOW_ABSOLUTE_PROFILE_REQUIRED');
  return path.resolve(value).toLowerCase();
}
function artifactReference(value) {
  insist(typeof value?.path === 'string' && value.path && /^[a-f0-9]{64}$/i.test(value.sha256 ?? ''),
    'EVIDENCE_WINDOW_BOUND_ORIGINAL_REFERENCE_REQUIRED');
  return value;
}
function validateFixtureWindowMetadata(value, fixture, owner) {
  artifactReference(value.fixtureContract); artifactReference(value.owner);
  insist(['typical', 'maximum'].includes(value.fixture) && value.fixtureContractSha256 === value.fixtureContract.sha256
    && fixture?.kind === 'v16-nfr-fixture' && fixture.schemaVersion === 1 && fixture.fixture === value.fixture
    && fixture.classification === value.classification && fixture.sourceSha256 === value.binding.sourceSha256
    && same(fixture.packageHashes, value.packageHashes), 'EVIDENCE_WINDOW_ACTUAL_FIXTURE_CONTRACT_REQUIRED');
  for (const [core, container] of [['appContentSha256', 'appContent'], ['mainBundleSha256', 'mainBundle']]) insist(
    value.binding.packageIdentity[core].toLowerCase() === String(fixture.packageHashes?.[container]).toLowerCase(),
    'EVIDENCE_WINDOW_FIXTURE_PACKAGE_IDENTITY_MISMATCH');
  insist(Array.isArray(fixture.storeIds) && fixture.storeIds.includes(value.binding.storeContext.storeId)
    && fixture.scope?.marketplaceCode === value.binding.storeContext.marketplace,
  'EVIDENCE_WINDOW_FIXTURE_STORE_OR_MARKETPLACE_MISMATCH');
  const profile = canonicalProfilePath(value.profile), profiles = [fixture.userDataDir, ...(fixture.coldProfiles ?? [])];
  insist(profiles.some(member => canonicalProfilePath(member) === profile)
    && canonicalProfilePath(value.evidenceRoot ?? value.root?.path) === canonicalProfilePath(path.join(value.profile, 'evidence')),
  'EVIDENCE_WINDOW_PROFILE_NOT_IN_FIXTURE_CONTRACT');
  insist(owner?.token === value.ownerToken && owner.classification === value.classification
    && path.basename(value.owner.path).toLowerCase() === 'owner.json'
    && canonicalProfilePath(path.dirname(value.owner.path)) === canonicalProfilePath(path.dirname(value.profile)),
  'EVIDENCE_WINDOW_BOUND_OWNER_MISMATCH');
  insist(value.actualMainContextObserved === false && value.bindingRole === 'planned-fixture-window',
    'EVIDENCE_WINDOW_PLANNED_CONTEXT_ROLE_REQUIRED');
  return value;
}
function validateSnapshotScope(value) {
  artifactReference(value.fixtureContract); artifactReference(value.owner);
  insist(['typical', 'maximum'].includes(value.fixture) && value.fixtureContract.sha256 === value.fixtureContractSha256
    && canonicalProfilePath(value.profile) && canonicalProfilePath(value.root?.path)
    && value.actualMainContextObserved === false && value.bindingRole === 'planned-fixture-window',
  'EVIDENCE_WINDOW_SNAPSHOT_FIXTURE_SCOPE_REQUIRED');
  for (const key of ['installer', 'portable', 'zip', 'appContent', 'mainBundle']) insist(
    /^[a-f0-9]{64}$/i.test(value.packageHashes?.[key] ?? ''), 'EVIDENCE_WINDOW_SNAPSHOT_CONTAINER_HASHES_REQUIRED');
}
function verifyWindowOriginalBindings(container, start, end, load) {
  const plan = load(container.plan).json(), fixture = load(start.fixtureContract).json(), owner = load(start.owner).json();
  insist(plan.kind === 'v16-evidence-window-plan' && plan.schemaVersion === 1, 'EVIDENCE_WINDOW_BOUND_PLAN_MISMATCH');
  validateFixtureWindowMetadata(plan, fixture, owner);
  validateFixtureWindowMetadata(start, fixture, owner); validateFixtureWindowMetadata(end, fixture, owner);
  for (const value of [start, end]) insist(same(plan.binding, value.binding) && plan.fixture === value.fixture
    && same(plan.fixtureContract, value.fixtureContract) && plan.fixtureContractSha256 === value.fixtureContractSha256
    && same(plan.owner, value.owner) && plan.ownerToken === value.ownerToken
    && canonicalProfilePath(plan.profile) === canonicalProfilePath(value.profile)
    && canonicalProfilePath(plan.evidenceRoot) === canonicalProfilePath(value.root.path), 'EVIDENCE_WINDOW_BOUND_PLAN_MISMATCH');
  load(container.plan); load(start.fixtureContract); load(start.owner);
  return { plan, fixture, owner };
}
function validateSnapshot(value) {
  insist(value?.kind === 'v16-evidence-growth-snapshot' && value.schemaVersion === 1
    && ['isolated-software-fixture', 'real-data-copy'].includes(value.classification)
    && value.formalAcceptanceEvidence === false, 'EVIDENCE_WINDOW_SNAPSHOT_SCHEMA_INVALID');
  validateWindowBinding(value.binding); validateSnapshotScope(value);
  insist(typeof value.ownerToken === 'string' && value.ownerToken
    && typeof value.root?.path === 'string' && value.root.path
    && identity.validIdentity(value.root),
  'EVIDENCE_WINDOW_ROOT_IDENTITY_INVALID');
  const clock = value.clock;
  insist(clock && ['system-monotonic-utc', 'synthetic-test-port'].includes(clock.source)
    && Number.isFinite(Date.parse(clock.observedAt)) && Number.isFinite(clock.uptimeMs) && clock.uptimeMs >= 0
    && /^[a-f0-9]{64}$/i.test(clock.machineSha256 ?? ''), 'EVIDENCE_WINDOW_CLOCK_INVALID');
  const captureStart = value.captureStartedClock;
  insist(captureStart && captureStart.source === clock.source && captureStart.machineSha256 === clock.machineSha256
    && Number.isFinite(Date.parse(captureStart.observedAt)) && Number.isFinite(captureStart.uptimeMs)
    && captureStart.uptimeMs >= 0 && captureStart.uptimeMs <= clock.uptimeMs
    && Date.parse(captureStart.observedAt) <= Date.parse(clock.observedAt), 'EVIDENCE_WINDOW_CAPTURE_CLOCK_INVALID');
  if (clock.source === 'system-monotonic-utc') insist(Date.parse(clock.observedAt) <= Date.now() + 1000,
    'EVIDENCE_WINDOW_FUTURE_CLOCK_REJECTED');
  insist(Array.isArray(value.files) && value.files.length <= 100000, 'EVIDENCE_WINDOW_FILES_INVALID');
  const seen = new Set();
  let total = 0;
  for (const file of value.files) {
    insist(typeof file.relativePath === 'string' && file.relativePath && !file.relativePath.includes('\\')
      && !file.relativePath.includes(':') && !file.relativePath.includes('\0')
      && file.relativePath.split('/').every(part => part && part !== '.' && part !== '..')
      && !seen.has(file.relativePath.toLowerCase()), 'EVIDENCE_WINDOW_RELATIVE_PATH_INVALID');
    seen.add(file.relativePath.toLowerCase());
    insist(Number.isSafeInteger(file.sizeBytes) && file.sizeBytes >= 0 && /^[a-f0-9]{64}$/i.test(file.sha256 ?? '')
      && identity.validIdentity(file)
      && Number.isFinite(file.mtimeMs) && (file.mtimeNs === undefined || identity.validTimestampNs(file.mtimeNs)), 'EVIDENCE_WINDOW_FILE_METADATA_INVALID');
    total += file.sizeBytes;
    insist(Number.isSafeInteger(total), 'EVIDENCE_WINDOW_BYTES_OVERFLOW');
  }
  insist(total === value.totalBytes && value.fileCount === value.files.length, 'EVIDENCE_WINDOW_SNAPSHOT_TOTAL_CHANGED');
  insist(same(value.files.map(file => file.relativePath), [...value.files.map(file => file.relativePath)].sort()),
    'EVIDENCE_WINDOW_FILES_NOT_SORTED');
  return value;
}
function compareEvidenceInventories(start, end) {
  validateSnapshot(start); validateSnapshot(end);
  insist(same(start.binding, end.binding) && same(identity.normalizedIdentity(start.root), identity.normalizedIdentity(end.root))
    && start.ownerToken === end.ownerToken && start.classification === end.classification
    && start.fixture === end.fixture && same(start.fixtureContract, end.fixtureContract)
    && start.fixtureContractSha256 === end.fixtureContractSha256 && same(start.owner, end.owner)
    && canonicalProfilePath(start.profile) === canonicalProfilePath(end.profile) && same(start.packageHashes, end.packageHashes),
  'EVIDENCE_WINDOW_SOURCE_PACKAGE_CONTEXT_OR_OWNER_CHANGED');
  const before = new Map(start.files.map(file => [file.relativePath.toLowerCase(), file]));
  const after = new Map(end.files.map(file => [file.relativePath.toLowerCase(), file]));
  const created = [], removed = [], modified = [];
  for (const [key, file] of before) {
    const next = after.get(key);
    if (!next || !identity.sameIdentity(next, file)) removed.push(file);
    if (next && identity.sameIdentity(next, file)
      && (next.sha256 !== file.sha256 || next.sizeBytes !== file.sizeBytes)) {
      modified.push({ relativePath: file.relativePath, before: file, after: next,
        deltaBytes: next.sizeBytes - file.sizeBytes });
    }
  }
  for (const [key, file] of after) {
    const previous = before.get(key);
    if (!previous || !identity.sameIdentity(previous, file)) created.push(file);
  }
  const createdBytes = created.reduce((sum, file) => sum + file.sizeBytes, 0);
  const removedBytes = removed.reduce((sum, file) => sum + file.sizeBytes, 0);
  const modifiedIncreaseBytes = modified.reduce((sum, file) => sum + Math.max(0, file.deltaBytes), 0);
  const modifiedDecreaseBytes = modified.reduce((sum, file) => sum + Math.max(0, -file.deltaBytes), 0);
  const netDeltaBytes = end.totalBytes - start.totalBytes;
  insist(netDeltaBytes === createdBytes - removedBytes + modifiedIncreaseBytes - modifiedDecreaseBytes,
    'EVIDENCE_WINDOW_DELTA_LEDGER_MISMATCH');
  return { created, removed, modified, createdBytes, removedBytes, modifiedIncreaseBytes,
    modifiedDecreaseBytes, netDeltaBytes, beforeBytes: start.totalBytes, afterBytes: end.totalBytes };
}
function buildEvidenceWindow(start, end, options = {}) {
  const changes = compareEvidenceInventories(start, end);
  // 完整窗口采用首次清点结束至末次清点开始，避免把扫描耗时冒充观察时间。
  const endBoundary = end.captureStartedClock;
  const wallElapsedMs = Date.parse(endBoundary.observedAt) - Date.parse(start.clock.observedAt);
  const monotonicElapsedMs = endBoundary.uptimeMs - start.clock.uptimeMs;
  insist(wallElapsedMs > 0 && monotonicElapsedMs > 0, 'EVIDENCE_WINDOW_TIME_NOT_INCREASING');
  insist(start.clock.machineSha256 === end.clock.machineSha256, 'EVIDENCE_WINDOW_MACHINE_CHANGED');
  insist(Math.abs(wallElapsedMs - monotonicElapsedMs) <= MAXIMUM_CLOCK_SKEW_MS, 'EVIDENCE_WINDOW_CLOCK_JUMP_OR_REBOOT');
  const syntheticClock = start.clock.source !== 'system-monotonic-utc' || end.clock.source !== 'system-monotonic-utc';
  const fullDayElapsed = wallElapsedMs >= DAY_MS && monotonicElapsedMs >= DAY_MS;
  const realTimeDayObserved = fullDayElapsed && !syntheticClock;
  if (options.requireFullDay) insist(realTimeDayObserved && start.classification === 'real-data-copy',
    'EVIDENCE_WINDOW_ACTUAL_FULL_DAY_REQUIRED');
  return { kind: 'v16-evidence-growth-window', schemaVersion: 1, classification: start.classification,
    formalAcceptanceEvidence: false, appReady: false, binding: start.binding, root: start.root, ownerToken: start.ownerToken,
    fixture: start.fixture, fixtureContract: start.fixtureContract, fixtureContractSha256: start.fixtureContractSha256,
    profile: start.profile, owner: start.owner, packageHashes: start.packageHashes, actualMainContextObserved: false, bindingRole: 'planned-fixture-window',
    startedAt: start.clock.observedAt, finishedAt: endBoundary.observedAt, inventoryFinishedAt: end.clock.observedAt,
    wallElapsedMs, monotonicElapsedMs,
    status: syntheticClock ? 'SYNTHETIC_SOFTWARE_WINDOW' : fullDayElapsed ? 'FULL_REAL_TIME_WINDOW' : 'SHORT_WINDOW_DIAGNOSTIC',
    fullDayElapsed, syntheticClock, realTimeDayObserved,
    unit: 'bytes', window: 'actual-observation-interval', normalizedRate: null, calendarDaySequenceClaim: false,
    endpointInventoryOnly: true, intermediateChangesObserved: false,
    changes, snapshotDigests: { start: digest(Buffer.from(canonical(start))), end: digest(Buffer.from(canonical(end))) },
    requirement: '完整日窗口仍需真实时间、当前数据及独立批准预算；短窗口和合成时钟不提供正式日增长信用。' };
}
function verifyEvidenceWindow(value, start, end, options = {}) {
  const recomputed = buildEvidenceWindow(start, end, options);
  insist(same(value, recomputed), 'EVIDENCE_WINDOW_REPORT_OR_WINDOW_CHANGED');
  return { observed: true, realTimeDayObserved: value.realTimeDayObserved, formalAcceptanceEvidence: false,
    appReady: false, unit: value.unit, window: value.window, status: value.status,
    actualMainContextObserved: false, bindingRole: 'planned-fixture-window' };
}
function verifyEvidenceWindowArtifacts(report, options = {}) {
  const value = readBound(report).json();
  insist(value.kind === 'v16-evidence-growth-window-artifacts' && value.schemaVersion === 1, 'EVIDENCE_WINDOW_ARTIFACT_SCHEMA_INVALID');
  insist(value.start?.path !== value.end?.path && value.start?.sha256 !== value.end?.sha256, 'EVIDENCE_WINDOW_DUPLICATE_SNAPSHOT');
  const start = readBound(value.start).json(), end = readBound(value.end).json();
  verifyWindowOriginalBindings(value, start, end, record => readBound(record));
  const result = verifyEvidenceWindow(value.observation, start, end, options);
  readBound(value.start); readBound(value.end); readBound(value.plan); readBound(report);
  return result;
}
module.exports = { canonicalProfilePath, validateFixtureWindowMetadata, verifyWindowOriginalBindings, DAY_MS, MAXIMUM_CLOCK_SKEW_MS, canonical, same, validateWindowBinding, validateSnapshot,
  compareEvidenceInventories, buildEvidenceWindow, verifyEvidenceWindow, verifyEvidenceWindowArtifacts };

