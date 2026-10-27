const { insist, readArtifact, timeWithin, same, hashEqual } = require('./v16-native-artifacts');
const { MEMORY_METRICS, PEAK_MEMORY_WINDOW, verifyMemoryPeakSamples } = require('./v16-performance-memory');

const MIGRATION_CASES = [
  'refuses a newer ledger without changing any database bytes',
  'rolls back interrupted classification DDL and retries from the same snapshot',
  'reuses the same bound snapshot after a recorded interrupted v20 attempt',
];
function verifyMigrationScenarios(raw, descriptor, context) {
  insist(raw.kind === 'v16-migration-scenarios' && raw.schemaVersion === 1, 'MIGRATION_SCENARIO_SCHEMA_MISMATCH');
  context.load(descriptor.liveMigrationArtifactId, 'live-migration');
  const runner = readArtifact(context.root, raw.runner).json();
  const { summarizeVitest } = require('./verify-v16-required-test-manifest');
  insist(summarizeVitest(runner, raw.testFiles, context.root, context.trustedNativeEnvironment?.recordedSourceRoot ?? context.root).success, 'MIGRATION_SCENARIO_RUNNER_FAILED');
  insist(Number.isFinite(runner.startTime) && runner.startTime >= Date.parse(context.execution.startedAt) && runner.startTime <= Date.parse(context.execution.finishedAt), 'MIGRATION_SCENARIO_STALE_RUNNER');
  const assertions = runner.testResults.flatMap(file => file.assertionResults.map(test => ({ ...test, file: file.name })));
  for (const name of MIGRATION_CASES) {
    const rows = assertions.filter(test => test.fullName.endsWith(name));
    insist(rows.length === 1 && rows[0].status === 'passed', 'MIGRATION_REQUIRED_SCENARIO_MISSING:' + name);
    const source = readArtifact(context.root, raw.sources.find(x => require('node:path').resolve(context.root, x.path) === require('node:path').resolve(rows[0].file)));
    insist(source.bytes.toString('utf8').includes(name), 'MIGRATION_SCENARIO_SOURCE_MISMATCH');
  }
  insist(raw.command?.exitCode === 0 && raw.command.executable && raw.command.args?.length > 0, 'MIGRATION_COMMAND_RECEIPT_MISSING');
  readArtifact(context.root, raw.command.log);
  timeWithin(raw.command.startedAt, context.execution, 'migration-command-start');
  timeWithin(raw.command.finishedAt, context.execution, 'migration-command-end');
  return true;
}
const PERFORMANCE_METRICS = ['cold-startup', 'warm-startup', 'store-switch', 'home-projection', 'module-projection', 'exact-eight-import', 'analysis', 'main-memory', 'renderer-memory', 'long-table-interaction', 'database-size', 'evidence-growth', 'ai-latency', 'ai-timeout', 'ai-call-count', 'ai-token-count', 'ai-cost', 'cancel', 'resume', 'offline-fallback', 'memory-search'];
function assertFormalPerformanceArtifact(value) {
  insist(value?.formalAcceptanceEvidence !== false && value?.verification?.formalAcceptanceEvidence !== false
    && value?.classification !== 'isolated-software-fixture', 'PERFORMANCE_SOFTWARE_EVIDENCE_NOT_FORMAL');
  insist((value?.issues === undefined || (Array.isArray(value.issues) && value.issues.length === 0))
    && value?.collectionComplete !== false && value?.verification?.software?.status !== 'INCOMPLETE'
    && value?.verification?.externalAi?.status !== 'INCOMPLETE', 'PERFORMANCE_CAPTURE_INCOMPLETE');
  for (const rows of [value?.fixtureClassifications, value?.fixtures, value?.environment?.fixtureContracts]) {
    if (Array.isArray(rows)) for (const row of rows) if (row && typeof row === 'object') assertFormalPerformanceArtifact(row);
  }
}
function verifyPerformance(raw, descriptor, context) {
  insist(raw.kind === 'v16-performance-budget' && raw.schemaVersion === 1, 'PERFORMANCE_SCHEMA_MISMATCH');
  assertFormalPerformanceArtifact(raw);
  const budget = readArtifact(context.root, raw.budget).json(), baseline = readArtifact(context.root, raw.baseline).json();
  assertFormalPerformanceArtifact(budget); assertFormalPerformanceArtifact(baseline);
  insist(budget.kind === 'v16-nfr-budget' && budget.schemaVersion === 1 && budget.status === 'approved' && Number.isSafeInteger(budget.revision) && budget.revision > 0 && budget.owner && budget.approval?.approver && budget.approval.approvedAt, 'PERFORMANCE_BUDGET_NOT_APPROVED');
  readArtifact(context.root, budget.approval.artifact);
  insist(baseline.kind === 'v16-nfr-baseline' && baseline.schemaVersion === 1 && same(baseline.environment, raw.environment) && same(budget.environment, raw.environment) && hashEqual(baseline.sourceSha256, context.identity.sourceSha256), 'PERFORMANCE_BASELINE_OR_ENVIRONMENT_MISMATCH');
  insist(baseline.status === 'measured' && hashEqual(budget.baselineSha256, raw.baseline.sha256), 'PERFORMANCE_BUDGET_BASELINE_NOT_BOUND');
  insist(same(raw.packageIdentity, context.current.packageIdentity) && same(baseline.packageIdentity, context.current.packageIdentity), 'PERFORMANCE_PACKAGE_MISMATCH');
  const values = raw.measurements ?? [];
  for (const metric of PERFORMANCE_METRICS) {
    for (const fixture of ['typical', 'maximum']) {
      const budgets = (budget.metrics ?? []).filter(x => x.metric === metric && x.fixture === fixture);
      const measurements = values.filter(x => x.metric === metric && x.fixture === fixture);
      insist(budgets.length > 0 && measurements.length === budgets.length, 'PERFORMANCE_REQUIRED_METRIC_MISSING:' + metric + '/' + fixture);
      const baselineRows = (baseline.measurements ?? []).filter(x => x.metric === metric && x.fixture === fixture);
      if (MEMORY_METRICS.has(metric)) insist(baselineRows.length === budgets.length && budgets.every(target =>
        baselineRows.filter(row => row.percentile === target.percentile && row.unit === target.unit && row.window === target.window).length === 1),
      'PERFORMANCE_MEMORY_BASELINE_TARGETS_REQUIRED');
      insist(baselineRows.length > 0 && baselineRows.every(x => {
        const sample = readArtifact(context.root, x.samples).json(); assertFormalPerformanceArtifact(sample);
        for (const value of sample.samples ?? []) {
          assertFormalPerformanceArtifact(value);
        }
        if (metric === 'memory-search') {
          insist(baselineRows.length === budgets.length, 'PERFORMANCE_MEMORY_SEARCH_BASELINE_TARGETS_REQUIRED');
          const target = budgets.find(target => target.percentile === x.percentile);
          insist(target && x.unit === 'ms' && x.window === 'per-operation' && target.sampleCount >= 3
            && sample.kind === 'v16-nfr-samples' && sample.runId === baseline.runId && sample.metric === metric
            && sample.fixture === fixture && same(sample.environment, raw.environment)
            && same(sample.packageIdentity, context.current.packageIdentity) && sample.samples?.length >= target.sampleCount,
          'PERFORMANCE_MEMORY_SEARCH_BASELINE_CONTRACT_REQUIRED');
          require('./v16-native-memory-search').verifyMemorySearchSamples(sample.samples, fixture, {
            ...context, execution: baseline.execution });
          const ordered = sample.samples.map(value => value.value).sort((a, b) => a - b);
          insist(x.observed === ordered[Math.ceil(ordered.length * x.percentile / 100) - 1], 'PERFORMANCE_MEMORY_SEARCH_BASELINE_PERCENTILE_CHANGED');
        }
        if (MEMORY_METRICS.has(metric)) {
          const target = budgets.find(target => target.percentile === x.percentile);
          insist(x.unit === 'MiB' && x.window === PEAK_MEMORY_WINDOW, 'PERFORMANCE_MEMORY_PEAK_WINDOW_REQUIRED');
          insist(sample.kind === 'v16-nfr-samples' && sample.runId === baseline.runId && sample.metric === metric
            && sample.fixture === fixture && same(sample.environment, raw.environment)
            && same(sample.packageIdentity, context.current.packageIdentity)
            && Array.isArray(sample.samples) && sample.samples.length >= target.sampleCount,
          'PERFORMANCE_MEMORY_BASELINE_SAMPLES_REQUIRED');
          verifyMemoryPeakSamples(sample.samples, metric, { runId: baseline.runId, fixture, sourceSha256: context.identity.sourceSha256,
            packageIdentity: context.current.packageIdentity, execution: baseline.execution, formal: true },
          reference => readArtifact(context.root, reference).json());
          const sorted = sample.samples.map(value => value.value).sort((a, b) => a - b);
          insist(x.observed === sorted[Math.ceil(sorted.length * x.percentile / 100) - 1], 'PERFORMANCE_MEMORY_BASELINE_PERCENTILE_CHANGED');
        }
        return true;
      }), 'PERFORMANCE_BASELINE_SAMPLES_MISSING:' + metric);
      if (['store-switch', 'home-projection', 'module-projection'].includes(metric)) insist([50, 95].every(p => budgets.some(x => x.percentile === p)), 'PERFORMANCE_PERCENTILES_MISSING:' + metric);
      for (const target of budgets) {
        if (MEMORY_METRICS.has(metric)) insist(target.unit === 'MiB' && target.window === PEAK_MEMORY_WINDOW,
          'PERFORMANCE_MEMORY_PEAK_WINDOW_REQUIRED');
        const candidates = measurements.filter(x => x.percentile === target.percentile && x.unit === target.unit && x.window === target.window);
        insist(candidates.length === 1 && Number.isFinite(target.threshold) && target.threshold > 0 && target.sampleCount >= 3, 'PERFORMANCE_BUDGET_CONTRACT:' + metric);
        const sample = readArtifact(context.root, candidates[0].samples).json();
        assertFormalPerformanceArtifact(sample);
        insist(sample.kind === 'v16-nfr-samples' && sample.runId === descriptor.runId && sample.metric === metric && sample.fixture === fixture && same(sample.environment, raw.environment) && same(sample.packageIdentity, context.current.packageIdentity), 'PERFORMANCE_SAMPLE_IDENTITY:' + metric);
        insist(Array.isArray(sample.samples) && sample.samples.length >= target.sampleCount && [50, 95, 100].includes(target.percentile), 'PERFORMANCE_SAMPLE_SIZE:' + metric);
        for (const value of sample.samples) {
          assertFormalPerformanceArtifact(value);
          insist(Number.isFinite(value.value) && value.value >= 0 && Number.isSafeInteger(value.pid) && value.pid > 0, 'PERFORMANCE_SAMPLE_INVALID');
          timeWithin(value.observedAt, context.execution, 'performance-sample');
        }
        if (metric === 'memory-search') {
          insist(target.unit === 'ms' && target.window === 'per-operation', 'PERFORMANCE_MEMORY_SEARCH_WINDOW_REQUIRED');
          require('./v16-native-memory-search').verifyMemorySearchSamples(sample.samples, fixture, context);
        }
        if (MEMORY_METRICS.has(metric)) verifyMemoryPeakSamples(sample.samples, metric, {
          runId: descriptor.runId, fixture, sourceSha256: context.identity.sourceSha256,
          packageIdentity: context.current.packageIdentity, execution: context.execution, formal: true },
        reference => readArtifact(context.root, reference).json());
        const sorted = sample.samples.map(x => x.value).sort((a, b) => a - b);
        const observed = sorted[Math.ceil(sorted.length * target.percentile / 100) - 1];
        insist(observed <= target.threshold && observed === candidates[0].observed, 'PERFORMANCE_APPROVED_BUDGET_EXCEEDED:' + metric);
      }
    }
  }
  require('./v16-native-evidence-growth').verifyFormalDailyEvidenceGrowth(baseline, budget, { ...context, execution: baseline.execution });
  require('./v16-native-evidence-growth').verifyFormalDailyEvidenceGrowth(raw, budget, context);
  return true;
}
module.exports = { MIGRATION_CASES, PERFORMANCE_METRICS, verifyMigrationScenarios, verifyPerformance };
