const { performance } = require('node:perf_hooks');
const { insist } = require('./v16-performance-artifacts');
const { same, validateAuthorization } = require('./v16-performance-contract');
const { fixedIpc, currentStore, contextKey } = require('./v16-performance-observe');

function v16(context, input = {}) { return { apiVersion: 'v16/1', storeContext: context, input }; }
function unwrap(response) {
  insist(response?.success === true, `NFR_DOMAIN_OPERATION_REJECTED:${response?.code ?? 'NO_RESULT'}`);
  return response.data;
}
function localPermission(fixture, current, action) {
  if (fixture.classification === 'isolated-software-fixture' && ['import', 'analysis'].includes(action)) return;
  validateAuthorization(fixture.operationAuthorization, fixture, current, action);
}
async function measureImport(runtime, fixture, current, index) {
  localPermission(fixture, current, 'import');
  const batchId = fixture.importBatchIds?.[index];
  insist(batchId && new Set(fixture.importBatchIds).size === fixture.importBatchIds.length, 'NFR_DISTINCT_UNIMPORTED_EIGHT_REPORT_BATCHES_REQUIRED');
  const view = await currentStore(runtime.page, fixture);
  const scope = { ...fixture.scope, batchId, storeContext: view.context, storeName: view.store.displayName, marketplaceCode: 'US' };
  const startedAt = new Date().toISOString(), start = performance.now();
  const result = await fixedIpc(runtime.page, 'import', scope);
  insist(result?.cancelled !== true && result.metricsImport?.errors?.length === 0
    && result.metricsImport.parsedFiles === 8 && result.metricsImport.deduplicated !== true
    && result.batch?.id === batchId && Array.isArray(result.files)
    && new Set(result.files.map(file => file.reportType)).size === 8,
  'NFR_ACTUAL_EXACT_EIGHT_IMPORT_NOT_OBSERVED');
  let importSettlement;
  const prepared = fixture.softwareImportJobs?.[index];
  if (prepared) {
    insist(fixture.classification === 'isolated-software-fixture' && prepared.jobId === batchId, 'NFR_SOFTWARE_IMPORT_JOB_MISMATCH');
    const response = await fixedIpc(runtime.page, 'resume', { jobId: prepared.jobId, requestId: prepared.requestId, storeContext: view.context });
    const settled = (await fixedIpc(runtime.page, 'jobs', { storeContext: view.context, limit: 100 }))
      .find(job => job.jobId === batchId && job.request.requestId === prepared.requestId);
    insist(response?.importRecovered === true && settled?.state === 'completed' && settled.importState === 'succeeded', 'NFR_SOFTWARE_IMPORT_DURABLE_SETTLEMENT_MISSING');
    importSettlement = { jobId: prepared.jobId, requestId: prepared.requestId, importState: settled.importState, importCompletedAt: settled.importCompletedAt };
  }
  const elapsedMs = performance.now() - start;
  insist(contextKey((await currentStore(runtime.page, fixture)).context) === contextKey(view.context), 'NFR_IMPORT_STORE_CHANGED');
  return { elapsedMs, startedAt, finishedAt: new Date().toISOString(), storeContext: view.context,
    receipt: { batchId, importSettlement, parsedFiles: result.metricsImport.parsedFiles, inserted: result.metricsImport.inserted,
      importRunIds: result.metricsImport.importRunIds, reportTypes: result.files.map(file => file.reportType) } };
}
function approveAi(fixture, current, projection, counters, context) {
  const { approval } = validateAuthorization(fixture.aiAuthorization, fixture, current, 'paid-ai');
  const policy = projection.policy;
  insist(policy?.enabled === true && approval.policyRevision === policy.revision
    && policy.storeId === approval.aiStoreId && policy.storeId === context?.storeId && fixture.storeIds.includes(policy.storeId)
    && Date.parse(policy.windowStartsAt) <= Date.now() && Date.parse(policy.windowEndsAt) > Date.now(), 'NFR_CURRENT_AI_POLICY_NOT_APPROVED');
  insist(projection.unknownCount === 0 && Number.isSafeInteger(approval.maximumCostMicrousd) && approval.maximumCostMicrousd > 0
    && Number.isSafeInteger(counters.calls) && counters.calls >= 0, 'NFR_AI_COST_UNKNOWN_OR_CAP_EXHAUSTED');
  insist(approval.maximumCalls === undefined, 'NFR_CALL_LIMIT_NEEDS_MAIN_ENFORCED_CONTRACT');
  const maximumCall = Math.ceil((policy.contextTokenLimit * policy.inputMicrousdPerMillion
    + policy.outputTokenLimit * policy.outputMicrousdPerMillion) / 1000000);
  insist(Number.isSafeInteger(maximumCall) && maximumCall > 0 && counters.costMicrousd + maximumCall <= approval.maximumCostMicrousd
    && Number.isSafeInteger(projection.remainingMicrousd) && projection.remainingMicrousd >= maximumCall
    && projection.remainingMicrousd <= approval.maximumCostMicrousd - counters.costMicrousd,
  'NFR_AI_PRECALL_COST_CAP_NOT_COVERED');
  return { approval, policyRevision: policy.revision };
}
function aiValues(records, context) {
  insist(records.length > 0 && records.every(record => record.storeContext && contextKey(record.storeContext) === contextKey(context)
    && record.status !== 'blocked' && Number.isFinite(Date.parse(record.startedAt)) && Number.isFinite(Date.parse(record.endedAt))
    && Date.parse(record.endedAt) >= Date.parse(record.startedAt)), 'NFR_REAL_AI_COST_RECORDS_REQUIRED');
  const values = { latencyMs: Math.max(...records.map(record => Date.parse(record.endedAt) - Date.parse(record.startedAt))),
    calls: records.length };
  if (records.every(record => record.usage && [record.usage.promptTokens, record.usage.completionTokens, record.usage.totalTokens]
    .every(value => Number.isSafeInteger(value) && value >= 0) && record.usage.promptTokens + record.usage.completionTokens === record.usage.totalTokens)) {
    values.tokens = records.reduce((sum, record) => sum + record.usage.totalTokens, 0);
  }
  if (records.every(record => ['estimated', 'reported'].includes(record.costStatus)
    && Number.isSafeInteger(record.costMicrousd) && record.costMicrousd >= 0 && record.reasonCode !== 'AI_BILLING_BOUND_EXCEEDED')) {
    values.costMicrousd = records.reduce((sum, record) => sum + record.costMicrousd, 0);
    values.costUsd = values.costMicrousd / 1000000;
  }
  return values;
}
async function measureAnalysis(runtime, fixture, current, index, mode, counters) {
  localPermission(fixture, current, 'analysis');
  const missions = mode === 'analysis' ? fixture.analysisMissionIds : mode === 'ai' ? fixture.aiMissionIds
    : mode === 'timeout' ? fixture.aiTimeoutMissionIds : fixture.offlineMissionIds;
  insist(missions?.[index] && new Set(missions).size === missions.length, 'NFR_DISTINCT_ANALYSIS_MISSIONS_REQUIRED:' + mode);
  const view = await currentStore(runtime.page, fixture);
  const autonomy = await fixedIpc(runtime.page, 'autonomy', view.context);
  insist(autonomy?.mode === 'manual_approval' && !autonomy.activePolicyVersionId, 'NFR_ANALYSIS_AUTOMATIC_AUTHORITY_MUST_BE_DISABLED');
  const beforeGrants = unwrap(await fixedIpc(runtime.page, 'grants', v16(view.context, { missionId: missions[index] })));
  const beforeBatches = unwrap(await fixedIpc(runtime.page, 'execution-batches', v16(view.context)));
  const settings = await fixedIpc(runtime.page, 'settings');
  const configured = settings?.aiKeyConfigured === true;
  insist(mode === 'analysis' || configured, 'NFR_CONFIGURED_AI_REQUIRED:' + mode);
  const before = unwrap(await fixedIpc(runtime.page, 'ai-spend', v16(view.context)));
  const approved = configured ? approveAi(fixture, current, before, counters, view.context) : null;
  const previousCounters = { ...counters };
  const beforeDiagnostics = configured ? await fixedIpc(runtime.page, 'ai-diagnostics') : [];
  if (configured) {
    // 一旦进入付费生产链，任何异常都保持锁定；完整账本核算后才能恢复额度。
    counters.calls = Infinity; counters.costMicrousd = Infinity;
  }
  const startedAt = new Date().toISOString(), start = performance.now();
  const result = unwrap(await fixedIpc(runtime.page, 'analysis', v16(view.context, { missionId: missions[index] })));
  const elapsedMs = performance.now() - start;
  insist(result?.analysisRun && result.evidencePackage?.storeId === view.context.storeId
    && result.evidencePackage.missionId === missions[index] && result.evidencePackage.reportTypes?.length === 8
    && result.evidencePackage.dateFrom === fixture.scope.dateFrom && result.evidencePackage.dateTo === fixture.scope.dateTo
    && result.evidencePackage.metricRowCount >= fixture.volume.minimumImportedRows, 'NFR_CURRENT_ANALYSIS_RESULT_REQUIRED');
  insist(contextKey((await currentStore(runtime.page, fixture)).context) === contextKey(view.context), 'NFR_ANALYSIS_STORE_CHANGED');
  const afterGrants = unwrap(await fixedIpc(runtime.page, 'grants', v16(view.context, { missionId: missions[index] })));
  const afterBatches = unwrap(await fixedIpc(runtime.page, 'execution-batches', v16(view.context)));
  insist(!result.automaticAuthorization && same(beforeGrants, afterGrants) && same(beforeBatches, afterBatches), 'NFR_ANALYSIS_AUTHORITY_OR_EXECUTION_SIDE_EFFECT');
  const after = unwrap(await fixedIpc(runtime.page, 'ai-spend', v16(view.context)));
  const previous = new Set(before.records.map(record => record.id));
  const records = after.records.filter(record => !previous.has(record.id));
  let ai;
  if (configured) {
    insist(result.ai?.invoked === true && records.length > 0 && records.every(record => record.policyRevision === approved.policyRevision
      && Date.parse(record.startedAt) >= Date.parse(startedAt)), 'NFR_AI_INVOKED_RECORD_NOT_BOUND');
    ai = aiValues(records, view.context);
    counters.calls = previousCounters.calls + ai.calls;
    // 未知计费立即锁住后续调用，不把未知值转为零。
    if (ai.costMicrousd === undefined || after.unknownCount > 0) counters.costMicrousd = Infinity;
    else counters.costMicrousd = previousCounters.costMicrousd + ai.costMicrousd;
    insist(ai.costMicrousd === undefined || counters.costMicrousd <= approved.approval.maximumCostMicrousd,
    'NFR_AI_POSTCALL_CAP_EXCEEDED');
  } else insist(records.length === 0 && result.ai?.invoked === false, 'NFR_UNAPPROVED_AI_CALL_OBSERVED');
  const previousDiagnosticIds = new Set(beforeDiagnostics.map(record => record.id));
  const diagnostics = configured ? (await fixedIpc(runtime.page, 'ai-diagnostics')).filter(record => !previousDiagnosticIds.has(record.id)
    && record.storeId === view.context.storeId && record.promptKey === 'ad_strategy_diagnosis').map(({ id, storeId, promptKey, createdAt, success, errorMessage }) => ({ id, storeId, promptKey, createdAt, success, errorMessage })) : [];
  if (mode === 'timeout') insist(result.ai?.source === 'rule_fallback' && diagnostics.some(record => record.success === false
    && /超时|timeout|timed out|AbortError/i.test(record.errorMessage))
    && records.some(record => ['failed', 'interrupted'].includes(record.status)), 'NFR_ACTUAL_AI_TIMEOUT_FALLBACK_NOT_OBSERVED');
  if (mode === 'offline') insist(result.ai?.source === 'rule_fallback' && diagnostics.some(record => record.success === false
    && /离线|network|fetch failed|ENOTFOUND|ECONNREFUSED|无法连接/i.test(record.errorMessage))
    && records.some(record => ['failed', 'interrupted'].includes(record.status)), 'NFR_ACTUAL_OFFLINE_FALLBACK_NOT_OBSERVED');
  return { elapsedMs, startedAt, finishedAt: new Date().toISOString(), storeContext: view.context, ai,
    receipt: { analysisRun: result.analysisRun, evidencePackage: result.evidencePackage, ai: result.ai,
      policyRevision: approved?.policyRevision, diagnostics, costRecords: records.map(({ providerBaseUrl, model, ...record }) => record) } };
}
async function measureCollectionControl(runtime, fixture, current, index, action) {
  const descriptor = fixture.collectionJobs?.[index];
  const request = descriptor?.[action] ?? descriptor;
  insist(request?.jobId && request.requestId && !request.reconcileOnly && !request.reconcileCreateUnknown,
    'NFR_EXISTING_COLLECTION_JOB_REQUIRED');
  const view = await currentStore(runtime.page, fixture);
  const beforeJobs = await fixedIpc(runtime.page, 'jobs', { storeContext: view.context, limit: 100 });
  const before = beforeJobs.find(job => job.jobId === request.jobId && job.request.requestId === request.requestId);
  insist(before && contextKey(before.request.storeContext) === contextKey(view.context)
    && (action === 'cancel' ? ['queued', 'running', 'retrying', 'partial', 'interrupted'].includes(before.state)
      : ['completed', 'completed_with_errors', 'cancelled', 'partial', 'interrupted'].includes(before.state)), 'NFR_COLLECTION_CONTROL_SOURCE_STATE_INVALID');
  const localOnly = fixture.classification === 'isolated-software-fixture' && request.downloadedOnly === true;
  if (localOnly) {
    // 只测既有八份下载原件的本地恢复，不允许缺报表时转入外部浏览器采集。
    insist(request.syntheticProviderMetadata === true && request.formalAcceptance === false
      && before.request.mode === 'create-and-download' && before.request.reportTypes?.length === 8
      && new Set(before.request.reportTypes).size === 8 && before.reports?.length === 8
      && before.reports.every(report => report.state === 'downloaded' && before.request.reportTypes.includes(report.reportType))
      && new Set(before.reports.map(report => report.reportType)).size === 8
      && (action === 'cancel' ? before.state === 'queued' : before.state === 'completed' && before.importState === 'pending'),
    'NFR_LOCAL_RECOVERY_REQUIRES_ALL_EIGHT_DOWNLOADED_REPORTS');
  } else validateAuthorization(fixture.collectionAuthorization, fixture, current, action);
  const beforeAuthority = await fixedIpc(runtime.page, 'authority', view.context);
  const startedAt = new Date().toISOString(), start = performance.now();
  const response = await fixedIpc(runtime.page, action, { jobId: request.jobId, requestId: request.requestId, storeContext: view.context });
  const afterJobs = await fixedIpc(runtime.page, 'jobs', { storeContext: view.context, limit: 100 });
  const after = afterJobs.find(job => job.jobId === request.jobId && job.request.requestId === request.requestId);
  insist(after && contextKey(after.request.storeContext) === contextKey(view.context)
    && (action === 'cancel' ? response?.cancelled === true && after.state === 'cancelled'
      : after.state === 'completed' && (after.importState?.status ?? after.importState) === 'succeeded'
        && (!localOnly || response?.importRecovered === true)), 'NFR_DURABLE_COLLECTION_CONTROL_NOT_OBSERVED');
  insist(contextKey((await currentStore(runtime.page, fixture)).context) === contextKey(view.context), 'NFR_COLLECTION_CONTROL_STORE_CHANGED');
  const afterAuthority = await fixedIpc(runtime.page, 'authority', view.context);
  insist(same(beforeAuthority, afterAuthority), 'NFR_COLLECTION_CONTROL_AUTHORITY_SIDE_EFFECT');
  return { elapsedMs: performance.now() - start, startedAt, finishedAt: new Date().toISOString(), storeContext: view.context,
    definition: localOnly ? 'local-durable-download-recovery' : 'authorized-external-collection-control',
    receipt: { jobId: request.jobId, requestId: request.requestId, beforeState: before.state, afterState: after.state,
      updatedAt: after.updatedAt, importState: after.importState } };
}
module.exports = { v16, unwrap, localPermission, aiValues, approveAi, measureImport, measureAnalysis, measureCollectionControl };
