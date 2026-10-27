const { insist, readBound } = require('./v16-performance-artifacts');
const windowContract = require('./v16-evidence-growth-window');
const identity = require('./v16-evidence-growth-identity');

const DAILY_WINDOW = 'at-least-24h-endpoint-net-byte-change';
const FIXTURES = Object.freeze(['typical', 'maximum']);
function validateDailyEvidenceBudgets(rows) {
  insist(Array.isArray(rows) && rows.length === FIXTURES.length
    && new Set(rows.map(row => row.fixture)).size === rows.length, 'NFR_DAILY_EVIDENCE_BUDGET_INVENTORY_REQUIRED');
  for (const fixture of FIXTURES) {
    const row = rows.find(item => item.fixture === fixture);
    insist(row && row.metric === 'evidence-daily-growth' && row.unit === 'bytes' && row.window === DAILY_WINDOW
      && row.percentile === 95 && Number.isSafeInteger(row.sampleCount) && row.sampleCount >= 3 && row.sampleCount <= 100
      && Number.isFinite(row.threshold) && row.threshold > 0, 'NFR_DAILY_EVIDENCE_APPROVED_TARGET_INVALID:' + fixture);
  }
  return rows;
}
function verifyDailyWindowReference(reference, fixture, context) {
  const load = context.load ?? (record => readBound(record, context.root));
  const container = load(reference).json();
  insist(container.kind === 'v16-evidence-growth-window-artifacts' && container.schemaVersion === 1
    && container.start?.path !== container.end?.path && container.start?.sha256 !== container.end?.sha256,
  'NFR_DAILY_EVIDENCE_WINDOW_REFERENCE_INVALID');
  const start = load(container.start).json(), end = load(container.end).json();
  const { plan } = windowContract.verifyWindowOriginalBindings(container, start, end, load);
  insist(start.fixture === fixture && end.fixture === fixture, 'NFR_DAILY_EVIDENCE_SNAPSHOT_FIXTURE_MISMATCH');
  const recomputed = windowContract.buildEvidenceWindow(start, end, { requireFullDay: true });
  insist(windowContract.same(container.observation, recomputed)
    && start.classification === 'real-data-copy' && end.classification === 'real-data-copy'
    && start.binding.sourceSha256 === context.identity.sourceSha256
    && windowContract.same(start.binding.packageIdentity, context.current.packageIdentity),
  'NFR_DAILY_EVIDENCE_CURRENT_REAL_DATA_WINDOW_REQUIRED');
  const volume = context.fixtureContracts?.find(item => item.fixture === fixture);
  insist(volume && volume.classification === 'real-data-copy' && Array.isArray(volume.storeIds) && volume.storeIds.includes(start.binding.storeContext.storeId)
    && /^[a-f0-9]{64}$/i.test(plan.fixtureContractSha256 ?? '')
    && plan.fixtureContractSha256 === (volume.contractSha256 ?? volume.sha256),
    'NFR_DAILY_EVIDENCE_FIXTURE_STORE_BINDING_REQUIRED');
  if (context.execution) {
    const begin = Date.parse(context.execution.startedAt), finish = Date.parse(context.execution.finishedAt);
    insist(Date.parse(recomputed.startedAt) >= begin && Date.parse(recomputed.inventoryFinishedAt) <= finish,
      'NFR_DAILY_EVIDENCE_OUTSIDE_EXECUTION_WINDOW');
  }
  load(container.start); load(container.end); load(container.plan); load(reference);
  return { fixture, reference, snapshotDigests: recomputed.snapshotDigests, ownerToken: start.ownerToken,
    startedAt: recomputed.startedAt, finishedAt: recomputed.finishedAt, wallElapsedMs: recomputed.wallElapsedMs,
    monotonicElapsedMs: recomputed.monotonicElapsedMs, netDeltaBytes: recomputed.changes.netDeltaBytes,
    value: recomputed.changes.netDeltaBytes,
    valueDefinition: 'signed-endpoint-net-byte-change-no-clamping-no-intermediate-write-volume-claim',
    endpointInventoryOnly: true, intermediateChangesObserved: false, unit: 'bytes', window: DAILY_WINDOW,
    binding: start.binding, root: start.root, profile: start.profile, fixtureContract: start.fixtureContract,
    actualMainContextObserved: false, bindingRole: 'planned-fixture-window' };
}
function collectDailyEvidenceWindows(references, context) {
  insist(Array.isArray(references) && references.length === FIXTURES.length
    && new Set(references.map(row => row.fixture)).size === references.length, 'NFR_DAILY_EVIDENCE_TWO_FIXTURE_REFERENCES_REQUIRED');
  const rows = [], allSamples = [];
  for (const fixture of FIXTURES) {
    const group = references.find(row => row.fixture === fixture);
    insist(group && Array.isArray(group.windows) && group.windows.length >= 3 && group.windows.length <= 100,
      'NFR_DAILY_EVIDENCE_THREE_ACTUAL_WINDOWS_REQUIRED:' + fixture);
    const items = group.windows.map(reference => verifyDailyWindowReference(reference, fixture, context));
    insist(new Set(items.map(row => row.reference.sha256)).size === items.length
      && new Set(items.map(row => row.snapshotDigests.start + '|' + row.snapshotDigests.end)).size === items.length,
    'NFR_DAILY_EVIDENCE_REUSED_WINDOW_REJECTED');
    allSamples.push(...items);
    rows.push({ fixture, samples: items });
  }
  // 跨档也按物理树及规范路径检查，大小写变化或重包摘要不能制造独立样本。
  for (let first = 0; first < allSamples.length; first++) for (let second = first + 1; second < allSamples.length; second++) {
    const left = allSamples[first], right = allSamples[second];
    insist(left.snapshotDigests.start !== right.snapshotDigests.start || left.snapshotDigests.end !== right.snapshotDigests.end,
      'NFR_DAILY_EVIDENCE_GLOBAL_REUSED_SNAPSHOT_PAIR');
    const sameTree = identity.sameIdentity(left.root, right.root)
      || windowContract.canonicalProfilePath(left.root.path) === windowContract.canonicalProfilePath(right.root.path);
    if (sameTree) {
      insist(left.fixture === right.fixture, 'NFR_DAILY_EVIDENCE_CROSS_FIXTURE_TREE_REUSE');
      insist(Date.parse(left.finishedAt) <= Date.parse(right.startedAt) || Date.parse(right.finishedAt) <= Date.parse(left.startedAt),
        'NFR_DAILY_EVIDENCE_OVERLAPPING_SAMPLES');
    }
  }
  return { kind: 'v16-daily-evidence-observation-set', schemaVersion: 1, status: 'OBSERVED',
    metric: 'evidence-daily-growth', unit: 'bytes', window: DAILY_WINDOW, fixtures: rows };
}
function verifyDailyEvidenceBudget(observed, budgets, context) {
  validateDailyEvidenceBudgets(budgets);
  insist(observed?.kind === 'v16-daily-evidence-observation-set' && observed.schemaVersion === 1 && observed.status === 'OBSERVED',
    'NFR_DAILY_EVIDENCE_OBSERVATIONS_REQUIRED');
  insist(Array.isArray(observed.fixtures) && observed.fixtures.every(group => Array.isArray(group.samples)),
    'NFR_DAILY_EVIDENCE_OBSERVATION_FIXTURES_REQUIRED');
  const references = observed.fixtures.map(group => ({ fixture: group.fixture, windows: group.samples.map(sample => sample.reference) }));
  const fresh = collectDailyEvidenceWindows(references, context);
  insist(windowContract.same(observed, fresh), 'NFR_DAILY_EVIDENCE_OBSERVATION_SET_CHANGED');
  return budgets.map(target => {
    const rows = fresh.fixtures.find(group => group.fixture === target.fixture).samples;
    insist(rows.length >= target.sampleCount, 'NFR_DAILY_EVIDENCE_APPROVED_SAMPLE_COUNT_NOT_REACHED');
    const values = rows.map(row => row.value).sort((a, b) => a - b);
    const value = values[Math.ceil(values.length * target.percentile / 100) - 1];
    insist(value <= target.threshold, 'NFR_APPROVED_DAILY_EVIDENCE_BUDGET_EXCEEDED:' + target.fixture);
    return { fixture: target.fixture, observed: value, target, samples: rows.length };
  });
}
module.exports = { DAILY_WINDOW, FIXTURES, validateDailyEvidenceBudgets, verifyDailyWindowReference,
  collectDailyEvidenceWindows, verifyDailyEvidenceBudget };

