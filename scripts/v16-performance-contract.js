const os = require('node:os');
const path = require('node:path');
const { insist, readBound, digest, directPath, within } = require('./v16-performance-artifacts');
const { PERFORMANCE_METRICS } = require('./v16-native-scenario-adapters');
const { MEMORY_METRICS, PEAK_MEMORY_WINDOW, verifyMemoryPeakSamples } = require('./v16-performance-memory');

const FIXTURES = Object.freeze(['typical', 'maximum']);
const PERCENTILES = new Set(['store-switch', 'home-projection', 'module-projection']);
const CATALOG = Object.freeze(Object.fromEntries(PERFORMANCE_METRICS.map(metric => [metric, {
  unit: ['main-memory', 'renderer-memory'].includes(metric) ? 'MiB'
    : ['database-size', 'evidence-growth'].includes(metric) ? 'bytes'
      : metric === 'ai-call-count' ? 'count' : metric === 'ai-token-count' ? 'tokens' : metric === 'ai-cost' ? 'USD' : 'ms',
  window: metric.includes('startup') ? 'per-launch' : metric.startsWith('ai-') || metric === 'offline-fallback'
    ? 'per-analysis' : MEMORY_METRICS.has(metric) ? PEAK_MEMORY_WINDOW
      : ['database-size', 'evidence-growth'].includes(metric) ? 'after-sample' : 'per-operation',
  percentiles: PERCENTILES.has(metric) ? [50, 95] : [95],
}])));
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function validateMetricTargets(targets) {
  insist(Array.isArray(targets), 'NFR_METRIC_TARGETS_REQUIRED');
  const wanted = PERFORMANCE_METRICS.flatMap(metric => FIXTURES.flatMap(fixture => CATALOG[metric].percentiles.map(percentile => `${metric}/${fixture}/${percentile}`)));
  const actual = targets.map(target => `${target.metric}/${target.fixture}/${target.percentile}`);
  insist(actual.length === wanted.length && new Set(actual).size === actual.length && wanted.every(id => actual.includes(id)), 'NFR_EXACT_20_BY_TWO_METRICS_REQUIRED');
  for (const target of targets) {
    const contract = CATALOG[target.metric];
    insist(target.unit === contract.unit && target.window === contract.window, 'NFR_MEASUREMENT_UNIT_OR_WINDOW_UNSUPPORTED');
    insist(Number.isSafeInteger(target.sampleCount) && target.sampleCount >= 3 && target.sampleCount <= 100, 'NFR_SAMPLE_COUNT_INVALID');
  }
  return targets;
}
function defaultMetricTargets(sampleCount = 3) {
  return PERFORMANCE_METRICS.flatMap(metric => FIXTURES.flatMap(fixture => CATALOG[metric].percentiles.map(percentile => ({
    metric, fixture, percentile, unit: CATALOG[metric].unit, window: CATALOG[metric].window, sampleCount,
  }))));
}
function validatePlan(plan) {
  insist(plan?.kind === 'v16-nfr-capture-plan' && plan.schemaVersion === 1, 'NFR_CAPTURE_PLAN_SCHEMA_INVALID');
  insist(typeof plan.runId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{5,100}$/.test(plan.runId), 'NFR_RUN_ID_INVALID');
  insist(plan.identity?.sourceRevision && /^[a-f0-9]{64}$/i.test(plan.identity.sourceSha256 ?? '') && plan.identity.packageHashes, 'NFR_CURRENT_IDENTITY_REQUIRED');
  validateMetricTargets(plan.metrics);
  insist(Array.isArray(plan.fixtures) && plan.fixtures.length === 2 && new Set(plan.fixtures.map(f => f.fixture)).size === 2
    && FIXTURES.every(fixture => plan.fixtures.some(f => f.fixture === fixture)), 'NFR_TYPICAL_MAXIMUM_CONTRACT_REQUIRED');
  insist(Number.isSafeInteger(plan.operationTimeoutMs) && plan.operationTimeoutMs >= 1000 && plan.operationTimeoutMs <= 900000, 'NFR_OPERATION_TIMEOUT_INVALID');
  insist(!('measurements' in plan) && !('samples' in plan) && !('observed' in plan), 'NFR_EXTERNAL_NUMERIC_SAMPLES_FORBIDDEN');
  return plan;
}
function validateFixture(value, name, identity, profilePolicy = require('./evidence-user-data').validateEvidenceUserDataPath) {
  insist(value?.kind === 'v16-nfr-fixture' && value.schemaVersion === 1 && value.fixture === name, 'NFR_FIXTURE_SCHEMA_INVALID');
  insist(['isolated-software-fixture', 'real-data-copy'].includes(value.classification), 'NFR_FIXTURE_CLASSIFICATION_REQUIRED');
  insist(value.sourceSha256 === identity.sourceSha256 && same(value.packageHashes, identity.packageHashes), 'NFR_FIXTURE_SOURCE_OR_PACKAGE_MISMATCH');
  const profile = profilePolicy(value.userDataDir);
  insist(directPath(profile, true).path.toLowerCase() === path.resolve(value.userDataDir).toLowerCase(), 'NFR_FIXTURE_PROFILE_CHANGED');
  insist(value.logicalDatabase && value.volume && Number.isSafeInteger(value.volume.minimumImportedRows)
    && value.volume.minimumImportedRows >= 0 && typeof value.volume.description === 'string' && value.volume.description.trim(), 'NFR_FIXTURE_VOLUME_CONTRACT_REQUIRED');
  insist(Array.isArray(value.storeIds) && value.storeIds.length >= 1 && new Set(value.storeIds).size === value.storeIds.length
    && value.storeIds.every(id => typeof id === 'string' && id.trim()), 'NFR_FIXTURE_STORE_INVENTORY_REQUIRED');
  insist(value.scope?.dateFrom && value.scope.dateTo && value.scope.marketplaceCode === 'US', 'NFR_FIXTURE_BUSINESS_SCOPE_REQUIRED');
  if (value.originals) for (const original of value.originals) readBound(original);
  return { ...value, userDataDir: profile };
}
function validateAuthorization(record, fixture, current, action) {
  const artifact = readBound(record), approval = artifact.json();
  insist(approval.kind === 'v16-nfr-operation-authorization' && approval.schemaVersion === 1 && approval.status === 'approved'
    && typeof approval.approver === 'string' && approval.approver.trim() && Date.parse(approval.approvedAt) <= Date.now()
    && Date.parse(approval.expiresAt) > Date.now(), 'NFR_OPERATION_AUTHORIZATION_REQUIRED');
  insist(approval.sourceSha256 === fixture.sourceSha256 && same(approval.packageIdentity, current.packageIdentity)
    && approval.fixture === fixture.fixture && same(approval.storeIds, fixture.storeIds)
    && approval.actions?.includes(action) && approval.prohibitsAdsWrites === true && approval.prohibitsAuthorityIssuance === true,
  'NFR_OPERATION_AUTHORIZATION_BINDING_MISMATCH');
  return { artifact, approval };
}
function environmentFor(current, fixtures, electronVersion) {
  return { platform: process.platform, release: os.release(), architecture: process.arch,
    cpu: os.cpus()[0]?.model ?? 'UNKNOWN', logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(),
    electronVersion, deliveryKind: 'directory', fixtureContracts: fixtures.map(f => ({ fixture: f.fixture, sha256: f.sha256 })),
    packageIdentity: current.packageIdentity };
}
function validateBudget(budget, baselineRecord, baseline, environment, identity, current) {
  insist(budget?.kind === 'v16-nfr-budget' && budget.schemaVersion === 1 && budget.status === 'approved'
    && budget.owner && budget.approval?.approver && Date.parse(budget.approval.approvedAt) <= Date.now()
    && Number.isSafeInteger(budget.revision) && budget.revision > 0, 'NFR_APPROVED_BUDGET_REQUIRED');
  readBound(budget.approval.artifact);
  validateMetricTargets(budget.metrics);
  const dailyEvidence = require('./v16-performance-daily-evidence');
  dailyEvidence.validateDailyEvidenceBudgets(budget.dailyEvidenceGrowth);
  insist(budget.metrics.every(metric => Number.isFinite(metric.threshold) && metric.threshold > 0), 'NFR_POSITIVE_BUDGET_THRESHOLD_REQUIRED');
  insist(budget.baselineSha256?.toLowerCase() === baselineRecord.sha256.toLowerCase() && baseline?.status === 'measured'
    && baseline.kind === 'v16-nfr-baseline' && baseline.sourceSha256 === identity.sourceSha256
    && same(baseline.packageIdentity, current.packageIdentity) && same(baseline.environment, environment)
    && same(budget.environment, environment), 'NFR_APPROVED_BASELINE_OR_ENVIRONMENT_CHANGED');
  insist(baseline.measurements?.length === budget.metrics.length && typeof baseline.runId === 'string'
    && Date.parse(baseline.execution?.startedAt) <= Date.parse(baseline.execution?.finishedAt)
    && Date.parse(baseline.execution.finishedAt) <= Date.parse(budget.approval.approvedAt), 'NFR_BASELINE_MUST_PRECEDE_REVIEW');
  insist(baseline.dailyEvidenceGrowth?.status === 'OBSERVED', 'NFR_BASELINE_DAILY_EVIDENCE_WINDOWS_REQUIRED');
  const dailyReferences = baseline.dailyEvidenceGrowth.fixtures.map(group => ({ fixture: group.fixture, windows: group.samples.map(sample => sample.reference) }));
  const dailyBaseline = dailyEvidence.collectDailyEvidenceWindows(dailyReferences, {
    identity, current, fixtureContracts: baseline.fixtureClassifications, execution: baseline.execution });
  insist(same(dailyBaseline, baseline.dailyEvidenceGrowth), 'NFR_BASELINE_DAILY_EVIDENCE_OBSERVATIONS_CHANGED');
  for (const target of budget.metrics) {
    const rows = baseline.measurements.filter(row => row.metric === target.metric && row.fixture === target.fixture
      && row.percentile === target.percentile && row.unit === target.unit && row.window === target.window);
    insist(rows.length === 1, 'NFR_BASELINE_METRIC_INVENTORY_MISMATCH');
    const row = rows[0], original = readBound(row.samples).json();
    insist(original.kind === 'v16-nfr-samples' && original.runId === baseline.runId && original.metric === target.metric
      && original.fixture === target.fixture && same(original.environment, environment) && same(original.packageIdentity, current.packageIdentity)
      && original.samples?.length >= target.sampleCount, 'NFR_BASELINE_ACTUAL_SAMPLES_REQUIRED');
    for (const sample of original.samples) {
      insist(Number.isFinite(sample.value) && sample.value >= 0 && Number.isSafeInteger(sample.pid)
        && sample.pid > 0 && Date.parse(sample.observedAt) >= Date.parse(baseline.execution.startedAt)
        && Date.parse(sample.observedAt) <= Date.parse(baseline.execution.finishedAt), 'NFR_BASELINE_SAMPLE_INVALID');
    }
    if (target.metric === 'memory-search') {
      require('./v16-native-memory-search').verifyMemorySearchSamples(original.samples, target.fixture, {
        root: process.cwd(), identity, current, execution: baseline.execution });
    }
    if (MEMORY_METRICS.has(target.metric)) verifyMemoryPeakSamples(original.samples, target.metric, {
      runId: baseline.runId, fixture: target.fixture, sourceSha256: identity.sourceSha256,
      packageIdentity: current.packageIdentity, execution: baseline.execution }, reference => readBound(reference).json());
    const values = original.samples.map(sample => sample.value).sort((a,b) => a-b);
    insist(row.observed === values[Math.ceil(values.length * target.percentile / 100) - 1], 'NFR_BASELINE_PERCENTILE_CHANGED');
  }
  return budget;
}
function checkFixtureStorage(fixture, currentLogical, storagePaths) {
  insist(currentLogical.sha256.toLowerCase() === fixture.logicalDatabase.sha256.toLowerCase(), 'NFR_LOGICAL_FIXTURE_SNAPSHOT_CHANGED');
  const expected = path.join(fixture.userDataDir, 'amazon-ai-ops.db');
  insist(path.resolve(storagePaths.localDbPath).toLowerCase() === expected.toLowerCase(), 'NFR_RUNTIME_DATABASE_OUTSIDE_ISOLATED_PROFILE');
  for (const key of ['evidenceDir', 'downloadsDir', 'exportsDir', 'deliveryDir']) {
    insist(typeof storagePaths[key] === 'string' && within(fixture.userDataDir, path.resolve(storagePaths[key])), 'NFR_RUNTIME_STORAGE_OUTSIDE_ISOLATED_PROFILE');
  }
}
module.exports = { CATALOG, FIXTURES, same, validatePlan, validateMetricTargets, defaultMetricTargets, validateFixture,
  validateAuthorization, environmentFor, validateBudget, checkFixtureStorage };
