const fs = require('node:fs');
const path = require('node:path');
const { insist, within, readBound, fileRecord, createArtifactWriter, treeBytes, databaseBytes } = require('./v16-performance-artifacts');
const { CATALOG, FIXTURES, same, validatePlan, validateFixture, environmentFor, validateBudget, checkFixtureStorage } = require('./v16-performance-contract');
const { PERFORMANCE_METRICS } = require('./v16-native-scenario-adapters');
const { currentPackage } = require('./v16-native-artifacts');
const { sourceIdentity } = require('./verify-v16-required-test-manifest');
const { openNativeRuntime, readNativeMemory } = require('./v16-performance-runtime');
const { fixedIpc, currentStore, contextKey, measureNavigation, measureStoreSwitch, measureLongTable } = require('./v16-performance-observe');
const { measureImport, measureAnalysis, measureCollectionControl } = require('./v16-performance-business');
const { captureStatus } = require('./v16-performance-status');
const { measureMemorySearch } = require('./v16-performance-memory-search');
const { collectDailyEvidenceWindows } = require('./v16-performance-daily-evidence');
const { MEMORY_METRICS, PEAK_MEMORY_WINDOW, PEAK_MEMORY_BASIS, createMemoryPeakSample } = require('./v16-performance-memory');

function percentile(values, percent) {
  const sorted = values.map(sample => sample.value).sort((a,b) => a-b);
  return sorted[Math.ceil(sorted.length * percent / 100) - 1];
}
function captureExecution(startedAt, finishedAt = new Date().toISOString()) {
  return { finishedAt, execution: { startedAt, finishedAt } };
}
function captureVerification(targets, measurements, issues, phase, fixtures) {
  const verification = captureStatus(targets, measurements, issues);
  if (phase !== 'software' && fixtures.length === 2 && fixtures.every(fixture => fixture.classification === 'real-data-copy')) {
    // 正式通路由严格适配器决定是否接受；此处不把真实数据副本误标成软件报告。
    delete verification.formalAcceptanceEvidence;
  }
  return verification;
}
function captureProfileLogical(profile, label) {
  treeBytes(profile);
  return require('./package-ui-evidence').captureSqliteLogicalArtifact(path.join(profile, 'amazon-ai-ops.db'), label);
}
function canonicalEntries() {
  const ui = require('./package-ui-evidence');
  return ui.EXPECTED_PACKAGE_UI_ENTRIES.map(entry => ({ ...entry,
    module: ui.EXPECTED_PACKAGE_UI_MODULES.find(module => module.workspaces.includes(entry.workspace))?.id }));
}
async function collectPerformance({ root = process.cwd(), plan: inputPlan, output, phase = 'software' }) {
  const plan = validatePlan(inputPlan);
  insist(['software', 'baseline', 'measure'].includes(phase), 'NFR_CAPTURE_PHASE_INVALID');
  const source = sourceIdentity(root);
  insist(source.sourceSha256 === plan.identity.sourceSha256 && source.sourceRevision === plan.identity.sourceRevision
    && source.packageVersion === plan.identity.packageVersion, 'NFR_CAPTURE_SOURCE_IS_NOT_CURRENT');
  const current = currentPackage(root, plan.identity), entries = canonicalEntries();
  const statePath = path.join(current.appRoot, 'dist/main/v16-build-state.json');
  const state = readBound(fileRecord(statePath)).json();
  insist(state.schemaVersion === 'v16.build-state/1' && state.status === 'CURRENT'
    && same(state.identity, source), 'NFR_PACKAGE_BUILD_IS_NOT_CURRENT_SOURCE');
  if (phase !== 'software') insist(within(root, path.resolve(output)), 'NFR_FORMAL_OUTPUT_MUST_BE_INSIDE_EVIDENCE_ROOT');
  const writer = createArtifactWriter(output), samples = new Map(), issues = [], counters = new Map();
  const nativeCollectorStartedAt = new Date().toISOString();
  let executionStartedAt = nativeCollectorStartedAt;
  writer.json('inputs/capture-plan.json', plan);
  const fixtures = plan.fixtures.map(reference => {
    const artifact = readBound(reference, root), value = validateFixture(artifact.json(), reference.fixture, plan.identity);
    writer.copy(`inputs/${reference.fixture}-fixture.json`, { ...reference, path: artifact.path });
    writer.copy(`inputs/${reference.fixture}-logical-database.db`, value.logicalDatabase);
    for (const key of ['aiAuthorization','collectionAuthorization','operationAuthorization']) {
      if (value[key]) writer.copy(`inputs/${reference.fixture}-${key}.json`, value[key]);
    }
    const originals = [...(value.originals ?? []), ...(value.softwareInputs ?? []).map(input => input.report).filter(Boolean)];
    for (let index=0;index<originals.length;index++) writer.copy(`inputs/${reference.fixture}-original-${index}`, originals[index]);
    counters.set(reference.fixture, { calls: 0, costMicrousd: 0 });
    return { ...value, sha256: reference.sha256 };
  });
  insist(fixtures.find(f => f.fixture === 'maximum').volume.minimumImportedRows
    > fixtures.find(f => f.fixture === 'typical').volume.minimumImportedRows, 'NFR_MAXIMUM_VOLUME_MUST_EXCEED_TYPICAL');
  const dailyEvidenceGrowth = phase === 'software'
    ? { kind: 'v16-daily-evidence-observation-set', schemaVersion: 1, status: 'PENDING_REAL_OBSERVATION',
      reason: '单轮 after-sample 仍为诊断；正式日增长需要每档至少三份真实完整日窗口及独立批准预算。' }
    : collectDailyEvidenceWindows(plan.dailyEvidenceWindows, { root, identity: plan.identity, current, fixtureContracts: fixtures,
      load: reference => { const original = readBound(reference, root); writer.track({ ...reference, path: original.path }); return original; } });
  if (dailyEvidenceGrowth.status === 'OBSERVED') executionStartedAt = new Date(Math.min(Date.parse(nativeCollectorStartedAt),
    ...dailyEvidenceGrowth.fixtures.flatMap(group => group.samples.map(sample => Date.parse(sample.startedAt))))).toISOString();
  let environment, budget, baseline, budgetRef, baselineRef;
  if (phase === 'measure') {
    budget = readBound(plan.budget, root).json(); baseline = readBound(plan.baseline, root).json();
    insist(same(budget.metrics.map(({ threshold, ...target }) => target), plan.metrics), 'NFR_PLAN_NOT_EXACT_APPROVED_METRIC_CONTRACT');
    insist(dailyEvidenceGrowth.fixtures.every(group => group.samples.every(sample => Date.parse(sample.startedAt) >= Date.parse(budget.approval?.approvedAt))),
      'NFR_DAILY_EVIDENCE_MEASUREMENT_MUST_FOLLOW_BUDGET_APPROVAL');
  }
  function add(metric, fixture, value, runtime, receipt, metadata = {}) {
    insist(Number.isFinite(value) && value >= 0 && Number.isSafeInteger(runtime.identity.pid) && runtime.identity.pid > 0, 'NFR_ACTUAL_SAMPLE_INVALID');
    const key = metric + '/' + fixture, values = samples.get(key) ?? [];
    values.push({ value, pid: metric === 'renderer-memory' ? runtime.identity.windows[0].rendererPid : runtime.identity.pid,
      observedAt: new Date().toISOString(), receipt, ...metadata }); samples.set(key, values);
  }
  async function recordMemory(runtime, capturePhase, fixture, sampleIndex) {
    const memory = await readNativeMemory(runtime);
    return writer.json(`${fixture.fixture}/${sampleIndex}/${capturePhase}/memory.json`, {
      kind: 'v16-nfr-memory-observation', schemaVersion: 2, runId: plan.runId, fixture: fixture.fixture, sampleIndex,
      capturePhase, classification: fixture.classification, sourceSha256: source.sourceSha256,
      packageIdentity: current.packageIdentity, measurementBasis: PEAK_MEMORY_BASIS, window: PEAK_MEMORY_WINDOW,
      observedAt: new Date().toISOString(), launch: runtime.launch.receipt, ...memory });
  }
  async function attempt(metric, fixture, index, runtime, operation) {
    try {
      const result = await operation();
      const receipt = writer.json(`${fixture.fixture}/${index}/${metric}.json`, { kind: 'v16-nfr-operation-observation',
        schemaVersion: 1, metric, fixture: fixture.fixture, classification: fixture.classification,
        packageIdentity: current.packageIdentity, pid: runtime.identity.pid, ...result });
      add(metric, fixture.fixture, result.elapsedMs, runtime, receipt);
      return { result, receipt };
    } catch (error) {
      writer.log('v16.nfr_operation_failed', error, { metric, fixture: fixture.fixture, sample: index });
      issues.push({ metric, fixture: fixture.fixture, sample: index, code: error.message });
      if (error.fatal) throw error;
      return null;
    }
  }
  try {
    for (const fixture of fixtures) {
      const count = Math.max(...plan.metrics.filter(row => row.fixture === fixture.fixture).map(row => row.sampleCount));
      insist(Array.isArray(fixture.coldProfiles) && fixture.coldProfiles.length >= count
        && new Set(fixture.coldProfiles).size === fixture.coldProfiles.length, 'NFR_INDEPENDENT_COLD_PROFILES_REQUIRED');
      for (let index = 0; index < count; index++) {
        const profile = require('./evidence-user-data').validateEvidenceUserDataPath(fixture.coldProfiles[index]);
        const selected = { ...fixture, userDataDir: profile };
        const logical = captureProfileLogical(profile, `nfr-${fixture.fixture}-${index}`);
        insist(logical.sha256.toLowerCase() === fixture.logicalDatabase.sha256.toLowerCase(), 'NFR_COLD_PROFILE_LOGICAL_DATABASE_CHANGED');
        let runtime;
        try {
          runtime = await openNativeRuntime({ current, fixture, profile, writer, label: `${fixture.fixture}/${index}/cold`, timeoutMs: plan.operationTimeoutMs });
          environment ??= environmentFor(current, fixtures, runtime.identity.electronVersion);
          if (phase === 'measure' && !budgetRef) {
            validateBudget(budget, plan.baseline, baseline, environment, plan.identity, current);
            budgetRef = writer.copy('inputs/approved-budget.json', plan.budget);
            baselineRef = writer.copy('inputs/measured-baseline.json', plan.baseline);
          }
          insist(same(environment, environmentFor(current, fixtures, runtime.identity.electronVersion)), 'NFR_MACHINE_ENVIRONMENT_CHANGED');
          add('cold-startup', fixture.fixture, runtime.launch.elapsedMs, runtime, runtime.launch.receipt,
            { definition: '首次启动独立且预先绑定的 profile；未清除或宣称已清除操作系统文件缓存。' });
          const coldMemory = await recordMemory(runtime, 'cold', fixture, index);
          await runtime.close(); runtime = null;
          runtime = await openNativeRuntime({ current, fixture, profile, writer, label: `${fixture.fixture}/${index}/warm`, timeoutMs: plan.operationTimeoutMs });
          add('warm-startup', fixture.fixture, runtime.launch.elapsedMs, runtime, runtime.launch.receipt,
            { definition: '同一 profile 的紧接重启。' });
          const storage = await fixedIpc(runtime.page, 'storage');
          checkFixtureStorage(selected, logical, storage);
          const active = await currentStore(runtime.page, fixture);
          const pipeline = await fixedIpc(runtime.page, 'pipeline', { ...fixture.scope, storeName: active.store.displayName, marketplaceCode: 'US' });
          const importedRows = Number(pipeline?.quant?.importedRows ?? pipeline?.collection?.fileAudit?.importedRowCount);
          insist((pipeline?.scope?.storeId ?? pipeline?.scope?.storeContext?.storeId) === active.context.storeId
            && Number.isSafeInteger(importedRows) && importedRows >= fixture.volume.minimumImportedRows, 'NFR_ACTUAL_DATABASE_VOLUME_BELOW_CONTRACT');
          writer.json(`${fixture.fixture}/${index}/volume.json`, { kind: 'v16-nfr-volume-observation', importedRows,
            minimumImportedRows: fixture.volume.minimumImportedRows, classification: fixture.classification, logicalDatabase: logical,
            storeContext: active.context, pid: runtime.identity.pid, packageIdentity: current.packageIdentity });
          const beforeGrowth = treeBytes(storage.evidenceDir);
          const switched = await attempt('store-switch', fixture, index, runtime, () => measureStoreSwitch(runtime.page, fixture, plan.operationTimeoutMs));
          if (switched) {
            const original = switched.result.before;
            const restored = await fixedIpc(runtime.page, 'switch', { storeId: original.storeId, marketplace: 'US' });
            insist(restored?.context?.storeId === original.storeId, 'NFR_ORIGINAL_STORE_RESTORE_FAILED');
            await runtime.page.waitForFunction(key => document.querySelector('[data-authority-key]')?.getAttribute('data-authority-key') === key,
              contextKey(restored.context), { timeout: plan.operationTimeoutMs });
          }
          const home = entries.find(entry => entry.workspace === 'today') ?? entries[0];
          const away = entries.find(entry => entry.workspace !== home.workspace);
          try { await measureNavigation(runtime.page, away, plan.operationTimeoutMs); }
          catch (error) { if (error.message !== 'NFR_NAVIGATION_SAME_ENTRY_NOOP') throw error; }
          await attempt('home-projection', fixture, index, runtime, () => measureNavigation(runtime.page, home, plan.operationTimeoutMs));
          for (const entry of entries.filter(entry => entry !== home).concat([home])) {
            await attempt('module-projection', fixture, `${index}-${entry.workspace}-${entry.subview}`, runtime,
              () => measureNavigation(runtime.page, entry, plan.operationTimeoutMs));
          }
          if (fixture.table) {
            const entry = entries.find(entry => `${entry.workspace}/${entry.subview}` === fixture.table.entry);
            insist(entry, 'NFR_CANONICAL_TABLE_ENTRY_REQUIRED');
            try { await measureNavigation(runtime.page, entry, plan.operationTimeoutMs); }
            catch (error) { if (error.message !== 'NFR_NAVIGATION_SAME_ENTRY_NOOP') throw error; }
            await attempt('long-table-interaction', fixture, index, runtime,
              () => measureLongTable(runtime.page, fixture.table.selector, fixture.volume.minimumTableRows, fixture.table.tableSelector));
          }
          const memoryEntry = entries.find(entry => entry.workspace === 'memory');
          insist(memoryEntry, 'NFR_CANONICAL_MEMORY_SEARCH_ENTRY_REQUIRED');
          try { await measureNavigation(runtime.page, memoryEntry, plan.operationTimeoutMs); }
          catch (error) { if (error.message !== 'NFR_NAVIGATION_SAME_ENTRY_NOOP') throw error; }
          await attempt('memory-search', fixture, index, runtime, () => measureMemorySearch({ runtime, fixture,
            sourceSha256: source.sourceSha256, packageIdentity: current.packageIdentity, writer,
            prefix: fixture.fixture + '/' + index + '/memory-search-observation', timeoutMs: plan.operationTimeoutMs }));
          let controls = fixture;
          if (fixture.classification === 'isolated-software-fixture') {
            try {
              const prepared = await require('./v16-performance-software-controls').prepareSoftwareCollectionControls({ root, runtime, fixture,
                current, storage, writer, index });
              controls = { ...fixture, importBatchIds: [...fixture.importBatchIds], analysisMissionIds: [...fixture.analysisMissionIds],
                collectionJobs: { [index]: prepared }, softwareImportJobs: { [index]: prepared.import } };
              controls.importBatchIds[index] = prepared.import.jobId; controls.analysisMissionIds[index] = prepared.import.analysisMissionId;
            } catch (error) {
              writer.log('v16.nfr_collection_preparation_failed', error, { fixture: fixture.fixture, sample: index });
              for (const metric of ['cancel', 'resume', 'exact-eight-import']) issues.push({ metric, fixture: fixture.fixture, sample: index, code: error.message });
              controls = null;
            }
          }
          if (controls) await attempt('exact-eight-import', fixture, index, runtime, () => measureImport(runtime, controls, current, index));
          if (controls) await attempt('analysis', fixture, index, runtime, () => measureAnalysis(runtime, controls, current, index, 'analysis', counters.get(fixture.fixture)));
          const aiObservation = await attempt('ai-latency', fixture, index, runtime,
            () => measureAnalysis(runtime, fixture, current, index, 'ai', counters.get(fixture.fixture)));
          if (aiObservation?.result.ai) {
            const ai = aiObservation.result.ai;
            // AI 延迟使用 Main 账本起止时间；其他业务耗时使用采集器单调时钟。
            samples.get('ai-latency/' + fixture.fixture).at(-1).value = ai.latencyMs;
            add('ai-call-count', fixture.fixture, ai.calls, runtime, aiObservation.receipt);
            if (ai.tokens !== undefined) add('ai-token-count', fixture.fixture, ai.tokens, runtime, aiObservation.receipt);
            if (ai.costUsd !== undefined) add('ai-cost', fixture.fixture, ai.costUsd, runtime, aiObservation.receipt,
              { costBasis: 'Main 账本 reported/estimated 原值；不是外部账单支付确认。' });
          }
          await attempt('ai-timeout', fixture, index, runtime,
            () => measureAnalysis(runtime, fixture, current, index, 'timeout', counters.get(fixture.fixture)));
          await attempt('offline-fallback', fixture, index, runtime,
            () => measureAnalysis(runtime, fixture, current, index, 'offline', counters.get(fixture.fixture)));
          if (controls) {
            await attempt('cancel', fixture, index, runtime, () => measureCollectionControl(runtime, controls, current, index, 'cancel'));
            await attempt('resume', fixture, index, runtime, () => measureCollectionControl(runtime, controls, current, index, 'resume'));
          }
          const warmMemory = await recordMemory(runtime, 'warm', fixture, index);
          for (const metric of MEMORY_METRICS) {
            const memory = createMemoryPeakSample(metric, [{ phase: 'cold', receipt: coldMemory },
              { phase: 'warm', receipt: warmMemory }], { runId: plan.runId, fixture: fixture.fixture,
              sourceSha256: source.sourceSha256, packageIdentity: current.packageIdentity,
              execution: { startedAt: executionStartedAt, finishedAt: new Date().toISOString() } },
            reference => readBound(reference).json());
            const receipt = writer.json(`${fixture.fixture}/${index}/${metric}-peak.json`, memory);
            add(metric, fixture.fixture, memory.selected.value, runtime, receipt, memory.selected);
          }
          const afterGrowth = treeBytes(storage.evidenceDir), dbSize = databaseBytes(storage.localDbPath);
          const disk = writer.json(`${fixture.fixture}/${index}/disk.json`, { kind: 'v16-nfr-disk-observation',
            observedAt: new Date().toISOString(), pid: runtime.identity.pid, packageIdentity: current.packageIdentity,
            databaseBytes: dbSize, evidenceBefore: beforeGrowth, evidenceAfter: afterGrowth, deltaBytes: afterGrowth.bytes - beforeGrowth.bytes });
          add('database-size', fixture.fixture, dbSize, runtime, disk);
          add('evidence-growth', fixture.fixture, Math.max(0, afterGrowth.bytes - beforeGrowth.bytes), runtime, disk);
        } catch (error) {
          writer.log('v16.nfr_fixture_sample_failed', error, { fixture: fixture.fixture, sample: index });
          issues.push({ fixture: fixture.fixture, sample: index, code: error.message });
        } finally {
          if (runtime?.rendererErrors.length) issues.push({ fixture: fixture.fixture, sample: index, code: 'NFR_RENDERER_RUNTIME_ERRORS', errors: [...runtime.rendererErrors] });
          if (runtime) await runtime.close();
        }
      }
    }
  } finally {
    writer.log('v16.nfr_capture_finished', null, { runId: plan.runId, issueCount: issues.length });
  }
  const after = sourceIdentity(root);
  insist(same(source, after) && same(currentPackage(root, plan.identity).packageIdentity, current.packageIdentity), 'NFR_SOURCE_OR_PACKAGE_CHANGED_DURING_CAPTURE');
  const measurements = [];
  for (const fixture of FIXTURES) for (const metric of PERFORMANCE_METRICS) {
    const rows = samples.get(metric + '/' + fixture) ?? [];
    const sampleFile = writer.json(`samples/${fixture}-${metric}.json`, { kind: 'v16-nfr-samples', runId: plan.runId,
      metric, fixture, environment, packageIdentity: current.packageIdentity, sourceSha256: source.sourceSha256, samples: rows });
    for (const target of plan.metrics.filter(target => target.fixture === fixture && target.metric === metric)) {
      if (rows.length < target.sampleCount) { issues.push({ fixture, metric, code: 'NFR_REQUIRED_SAMPLE_COUNT_NOT_REACHED', actual: rows.length, required: target.sampleCount }); continue; }
      measurements.push({ ...target, observed: percentile(rows, target.percentile), samples: sampleFile });
    }
  }
  const complete = measurements.length === plan.metrics.length && issues.length === 0;
  const verification = captureVerification(plan.metrics, measurements, issues, phase, fixtures);
  const report = phase === 'baseline'
    ? { kind: 'v16-nfr-baseline', schemaVersion: 1, status: complete ? 'measured' : 'incomplete' }
    : phase === 'measure' ? { kind: 'v16-performance-budget', schemaVersion: 1, budget: budgetRef, baseline: baselineRef }
      : { kind: 'v16-nfr-software-capture', schemaVersion: 1, formalAcceptanceEvidence: false };
  Object.assign(report, { runId: plan.runId, sourceSha256: source.sourceSha256, packageIdentity: current.packageIdentity,
    ...captureExecution(executionStartedAt), inputArtifacts: writer.artifacts(),
    environment, measurements, issues, verification, dailyEvidenceGrowth, nativeCollectorStartedAt,
    executionDefinition: phase === 'software' ? 'single-native-collector' : 'aggregate-including-bound-real-daily-window-captures',
    softwareMeasurementsComplete: verification.software.status === 'MEASURED',
    externalAiMeasurementsComplete: verification.externalAi.status === 'MEASURED', collectionComplete: complete, appReady: false, realStoreEvidence: false,
    fixtureClassifications: fixtures.map(fixture => ({ fixture: fixture.fixture, classification: fixture.classification,
      minimumImportedRows: fixture.volume.minimumImportedRows, contractSha256: fixture.sha256, storeIds: fixture.storeIds })) });
  const reportArtifact = writer.json('performance.json', report);
  return { report, reportArtifact, output: writer.root };
}
module.exports = { percentile, captureExecution, captureVerification, captureProfileLogical, canonicalEntries, collectPerformance };
