import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
const preload = readFileSync(new URL('../preload/index.ts', import.meta.url), 'utf8');

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing end marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('legacy IPC store authority contract', () => {
  it('retires legacy operation-event IPC instead of resolving store authority after invocation', () => {
    for (const channel of [
      'operation-events:list',
      'operation-events:create',
      'operation-events:update',
      'operation-events:delete',
    ]) {
      expect(source).not.toContain(`registerTrackedIpcHandler('${channel}'`);
      expect(preload).not.toContain(`ipcRenderer.invoke('${channel}'`);
    }
    expect(source).toContain('registerStoreScopedObjectsIpcHandlers(');
  });

  it('retires legacy product IPC in favor of StoreContext plus revision CAS', () => {
    for (const channel of [
      'products:get',
      'products:add',
      'products:save-config',
      'products:bulk-update-target-acos',
    ]) {
      expect(source).not.toContain(`registerTrackedIpcHandler('${channel}'`);
      expect(preload).not.toContain(`ipcRenderer.invoke('${channel}'`);
    }
    expect(preload).toContain("ipcRenderer.invoke('store-objects:products:update', { storeContext, input })");
  });

  it('retires the path-bearing legacy keyword opportunity bridge', () => {
    expect(source).not.toContain("registerTrackedIpcHandler('v1_5:business-ui:keyword-opportunities'");
    expect(preload).not.toContain("ipcRenderer.invoke('v1_5:business-ui:keyword-opportunities'");
    expect(preload).toContain("ipcRenderer.invoke('store-ad-listing:keyword-facts:list', { storeContext, input })");
  });

  it('routes internal Listing persistence through the active store CAS service', () => {
    const persistence = between(
      'function persistListingContent',
      'function readCurrentOperationScopeValue',
    );

    expect(persistence).toContain('resolveBusinessStoreAuthority');
    expect(persistence).toContain('canonicalizeAmazonAsin(listing.asin)');
    expect(persistence).toContain('storeScopedAdListingService.listListingContent(activeContext');
    expect(persistence).toContain('storeScopedAdListingService.updateListingContent(activeContext');
    expect(persistence).toContain('expectedRevision: existing.revision');
    expect(persistence).toContain('storeScopedAdListingService.createListingContent(activeContext');
    expect(persistence).not.toContain('UPDATE listing_content');
    expect(persistence).not.toContain('INSERT INTO listing_content');
  });
});

describe('collection Renderer boundary contract', () => {
  it('closes orphan resume claims before generic startup import and job recovery', () => {
    const resumeRecovery = source.indexOf(
      '.interruptOrphanedCollectionResumeClaimsForStartup();',
    );
    const importRecovery = source.indexOf(
      'const importRecovery = recoverPendingLingxingCollectionImportsOnStartup();',
    );
    const importAuthorityGate = source.indexOf(
      'assertLingxingImportStartupRecoverySafe(importRecovery)',
    );
    const genericJobRecovery = source.indexOf(
      'const collectionRecovery = recoverInterruptedLingxingCollectionJobsOnStartup();',
    );
    const runtimeRecovery = source.indexOf(
      'await state.storeCollectionMainRuntime!.recoverStartupThenConfirm();',
    );

    expect(resumeRecovery).toBeGreaterThanOrEqual(0);
    expect(resumeRecovery).toBeLessThan(importRecovery);
    expect(importRecovery).toBeLessThan(importAuthorityGate);
    expect(importAuthorityGate).toBeLessThan(genericJobRecovery);
    expect(genericJobRecovery).toBeLessThan(runtimeRecovery);
  });

  it('binds the durable pending timestamp to the production import run start', () => {
    const wiring = between(
      'function initializeLingxingCollectionCoordinator',
      'function initializeStoreCollectionProductionRuntime',
    );

    expect(wiring).toContain('importResult: (result, options)');
    expect(wiring).toContain('importStoreScopedLingxingDownloadedReportMetrics(result, options)');
  });

  it('routes the legacy full-eight collection action through MainRuntime semantic admission', () => {
    const handler = between(
      'async function handleCollectLingxingReports',
      'function handleImportCurrentBusinessReports',
    );

    expect(handler).toContain('state.storeCollectionSchedulerReadModel.runNow(context)');
    expect(handler).toContain('state.storeCollectionSchedulerReadModel.get(context)');
    expect(handler).toContain('readUniqueCollectionAuthorityProofForStoreByRequestId(');
    expect(handler).toContain('before.dateStart !== request.start');
    expect(handler).toContain('before.dateEnd !== request.end');
    expect(handler).not.toContain('runAuthorizedLingxingCollection(');
    expect(handler).not.toContain('state.lingxingCollectionCoordinator.start(');
    expect(handler).not.toContain('requestId: request.requestId');
  });

  it('routes cancellation through MainRuntime cooperative settlement instead of an out-of-lane tombstone', () => {
    const cancellation = between(
      'async function handleCancelLingxingCollection',
      'function validatedDownloadedResumeReportTypes',
    );
    const runtimeAdmission = cancellation.indexOf(
      'await state.storeCollectionMainRuntime.cancelCollection({',
    );
    const idleTombstone = cancellation.indexOf(
      'repository.cancelCollectionJobForStore(context.storeId, jobId',
    );

    expect(runtimeAdmission).toBeGreaterThanOrEqual(0);
    expect(idleTombstone).toBeGreaterThan(runtimeAdmission);
    expect(cancellation).toContain('signalActiveCancellation: () =>');
    expect(cancellation).toContain('clearCancellationSignal: clearCancellation');
    expect(cancellation).toContain("current.state !== 'queued' && current.state !== 'running'");
    expect(cancellation).toContain('Treat that as a safe late-cancel race');
    expect(cancellation).toContain('readDurableSettlement: ({ requireNewResumeReceipt }) =>');
    expect(cancellation).toContain('readLatestCollectionResumeAttemptReceiptForStore');
    expect(cancellation).toContain("latestResumeReceipt.outcome === 'failed'");
    expect(cancellation).toContain('latestResumeReceipt.finalAuthorityProofSha256');
    expect(cancellation).toContain('fingerprintLingxingCollectionAuthorityProof(proof)');
    expect(cancellation).toContain('if (requireNewResumeReceipt && !receiptIsNew)');
  });

  it('uses one exact Store/request/job composite cancellation key', () => {
    const key = between(
      'function lingxingCollectionCancellationKey',
      'function authorizedLingxingCollectionTarget',
    );

    expect(key).toContain('if (!input.requestId || !input.jobId) return []');
    expect(key).toContain(
      'JSON.stringify([input.storeId, input.requestId, input.jobId])',
    );
    expect(key).not.toContain('request:${input.storeId}');
    expect(key).not.toContain('job:${input.storeId}');
  });

  it('returns a path-free minimal DTO from resume instead of spreading the runner result', () => {
    const handler = between(
      'async function handleResumeLingxingCollection',
      'const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS',
    );

    expect(handler).not.toContain('...output.result');
    expect(handler).toContain('job: minimalLingxingCollectionJobForRenderer(output.result.job)');
    expect(handler).toContain('sanitizeLingxingImportSummaryForRenderer');
    expect(handler).not.toContain('output.result.batch');
    expect(handler).not.toContain('output.result.files');
  });

  it('routes full8 resume to MainRuntime and forbids legacy creation of a second durable job', () => {
    const downloadExisting = between(
      'async function handleDownloadExistingLingxingReports',
      'async function handleRunLingxingCanaryReport',
    );
    const resume = between(
      'async function handleResumeLingxingCollection',
      'const DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS',
    );

    expect(downloadExisting).toContain('isExactLingxingFull8ReportSet(selectedReportTypes)');
    expect(downloadExisting.indexOf('FULL8_REMEDIATION_MAIN_RUNTIME_REQUIRED'))
      .toBeLessThan(downloadExisting.indexOf('runAuthorizedLingxingCollection('));
    expect(resume).toContain('isExactLingxingFull8ReportSet(job.request.reportTypes)');
    expect(resume).toContain('state.storeCollectionSchedulerReadModel.resumeJob(');
    expect(resume).toContain('job.jobId');
    expect(resume.indexOf('state.storeCollectionSchedulerReadModel.resumeJob('))
      .toBeLessThan(resume.indexOf('assertLegacyLingxingResumeMayCreateJob(job)'));
    expect(resume).toContain('assertLegacyLingxingResumeMayCreateJob(job)');
    expect(resume.indexOf('assertLegacyLingxingResumeMayCreateJob(job)'))
      .toBeLessThan(resume.indexOf('runAuthorizedLingxingCollection({'));
    expect(resume).not.toContain("job.request.mode === 'create-and-download'");
  });

  it('fails closed before commit when the collector has no independent per-report control totals', () => {
    const controlTotalGuard = between(
      'function assertExactIndependentLingxingReportControlTotals',
      'function importStoreScopedLingxingDownloadedReportMetrics',
    );
    const importer = between(
      'function importStoreScopedLingxingDownloadedReportMetrics',
      'function loadLatestImportableLingxingBatchForScope',
    );

    const evidenceRead = importer.indexOf('readIndependentLingxingReportControlTotals');
    const missingGuard = importer.indexOf('LINGXING_IMPORT_RECONCILIATION_EVIDENCE_MISSING');
    const exactCoverage = importer.indexOf('assertExactIndependentLingxingReportControlTotals');
    const commit = importer.indexOf('commitImportForStore');
    expect(evidenceRead).toBeGreaterThanOrEqual(0);
    expect(missingGuard).toBeGreaterThan(evidenceRead);
    expect(exactCoverage).toBeGreaterThan(missingGuard);
    expect(commit).toBeGreaterThan(exactCoverage);
    expect(importer).toContain('未写入 completed import run');
    expect(importer).not.toContain('reconciliations: []');
    expect(importer).not.toContain('expectedRows: 0');
    expect(importer).not.toContain('expectedCost: 0');
    expect(controlTotalGuard).toContain('reconciliation.dateStart !== result.batch.dateStart');
    expect(controlTotalGuard).toContain('reconciliation.dateEnd !== result.batch.dateEnd');
    expect(controlTotalGuard).toContain('reconciliation.metricDate !== result.batch.dateEnd');
  });

  it('never upgrades a recovered completed run without exact full-eight reconciliation proof', () => {
    const proof = between(
      'function assertPersistedFullLingxingReconciliationProof',
      'function recoverCompletedLingxingCollectionImport',
    );
    const recovery = between(
      'function recoverCompletedLingxingCollectionImport',
      'function recoverPendingLingxingCollectionImportsOnStartup',
    );

    expect(proof).toContain('readUniqueCollectionAuthorityProofForStoreByRequestId');
    expect(proof).toContain('assertStoreCollectionCommittedImportProofForRecovery(proof');
    expect(proof).toContain('context: job.request.storeContext');
    expect(proof).toContain('requestId: job.request.requestId');
    expect(proof).toContain('dateStart: job.request.dateStart');
    expect(proof).toContain('dateEnd: job.request.dateEnd');
    expect(proof).toContain('expectedJob: job');
    expect(proof).toContain('expectedRun: run');
    expect(proof).not.toContain('classifyStoreCollectionDurableProof(proof');
    expect(recovery.indexOf('assertPersistedFullLingxingReconciliationProof')).toBeLessThan(
      recovery.indexOf("job.importState === 'succeeded'"),
    );
    expect(recovery).toContain('completeRecoveredCollectionImportForStore(');
    expect(recovery).toContain('receipt.casToken');
    expect(recovery).not.toContain("persistLingxingCollectionImportState(job, 'failed'");
    expect(recovery).toContain(
      'importStoreScopedLingxingDownloadedReportMetrics(snapshot, { startedAt: attemptedAt })',
    );
    expect(recovery).toContain('assertPersistedFullLingxingReconciliationProof(pending, committedRun)');
    expect(recovery).toContain('currentJob.updatedAt !== pending.updatedAt');
    expect(recovery).not.toContain("persistLingxingCollectionImportState(pending, 'succeeded'");
  });

  it('walks the complete pending and failed import recovery queue by cursor', () => {
    const recovery = between(
      'function recoverPendingLingxingCollectionImportsOnStartup',
      'function sanitizeLingxingImportSummaryForRenderer',
    );

    expect(recovery).toContain('listRecoverableCollectionImportsForStore');
    expect(recovery).toContain("importStates: ['pending', 'failed']");
    expect(recovery).toContain('cursor = page.nextCursor');
    expect(recovery).not.toContain('listCollectionJobsForStore');
    expect(recovery).not.toContain("checkpoint.state !== 'downloaded'");
    expect(recovery).toContain('isKnownLingxingImportRecoveryFailure(error)');
    expect(recovery).toContain('authorityFailed += 1');
    expect(recovery).toContain('knownFailed += 1');
  });

  it('delegates startup recovery classification to the unit-tested fail-closed gate', () => {
    const recovery = between(
      'function recoverCompletedLingxingCollectionImport',
      'function recoverPendingLingxingCollectionImportsOnStartup',
    );

    expect(recovery).toContain('const discoveredRun = committedRun ??');
    expect(recovery).toContain('throw classifyLingxingImportRecoveryFailure({');
    expect(recovery).toContain('immutableImportRunPresent: Boolean(discoveredRun)');
    expect(source).toContain('assertLingxingImportStartupRecoverySafe(importRecovery)');
  });

  it('builds Today facts from US/USD metrics and per-report immutable import proofs', () => {
    const today = between(
      'function buildAuthoritativeMissionControlTodayProjection',
      'function normalizeLingxingCollectionRequest',
    );

    expect(today).toContain("upper(trim(marketplace_code)) = 'US'");
    expect(today).toContain("upper(trim(currency)) = 'USD'");
    expect(today).toContain('report_import_file_snapshots');
    expect(today).toContain('report_import_runs');
    expect(today).toContain('runs.store_id = snapshots.store_id');
    expect(today).toContain('runs.run_id = snapshots.run_id');
    expect(today).toContain('runs.batch_id = snapshots.batch_id');
    expect(today).toContain("runs.status = 'completed'");
    expect(today).toContain('snapshots.report_file_id IS NOT NULL');
    expect(today).toContain('reportImportProofs');
    expect(today).toContain('archived_at IS NULL');
  });
});

describe('US business-date rollover authority contract', () => {
  it('uses the shared user lane, strictly closes runtime authority and never rebinds context', () => {
    const rollover = between(
      'function refreshActiveStoreBusinessDateAuthority',
      'function stopStoreBusinessDateAuthorityMonitor',
    );

    expect(rollover).toContain('previous.businessDate === next.businessDate');
    expect(rollover).toContain('runtime.withUserStoreMutation({');
    expect(rollover).toContain("operation: 'business-date-rollover'");
    expect(rollover).toContain('runUserVisibleBrowserTransition({');
    expect(rollover).toContain('closeRuntime: closeUserVisibleBrowserRuntimeForTransition');
    expect(rollover).toContain('assertRuntimeClosed: assertUserVisibleBrowserRuntimeClosed');
    expect(rollover).toContain('getActiveStoreWorkspaceView()');
    expect(rollover).toContain('publishStoreContextChanged(freshView)');
    expect(rollover).toContain("code === 'USER_OPERATION_BLOCKED'");
    expect(rollover).toContain("code === 'LANE_HELD'");
    expect(rollover).toContain("code === 'VISIBLE_BROWSER_TRANSITION_BUSY'");
    expect(rollover).not.toContain('state.browserRuntime');
    expect(rollover).not.toContain('context: Object.freeze({ ...fresh })');
    expect(rollover).toContain('setInterval(');
    expect(rollover).toContain('storeBusinessDateAuthorityTimer.unref?.()');
  });
});

describe('policy grant dispatch lifecycle contract', () => {
  it('fails closed before browser setup when packaged proof is not fresh typed and remembered', () => {
    const packageLogin = between(
      'async function handleBrowserLogin',
      'async function performBrowserLoginInUserLane',
    );
    const login = between(
      'async function performBrowserLoginInUserLane',
      'async function handleBrowserLogout',
    );

    expect(packageLogin).toContain('withPackageUiSetupMutation');
    expect(packageLogin).not.toContain('package UI evidence cannot start a real account login');
    expect(login).toContain('if (packageUiFreshTypedProofRequired');
    expect(login).toContain("request.credentialSource !== 'typed'");
    expect(login).toContain('request.rememberPassword !== true');
    expect(login).toContain("typeof request.password !== 'string'");
    expect(login).toContain('request.password.length === 0');
    expect(login).toContain('正式 Package UI 首轮登录必须手动输入凭证并勾选记住密码。');
    expect(login.indexOf('if (packageUiFreshTypedProofRequired'))
      .toBeLessThan(login.indexOf('state.storeCoordinator.assertActiveStoreContext'));
    expect(source).not.toContain('detachBrowserRuntimeForStore');
  });

  it('resumes durable pre-batch dispatches only after a verified Ads session is ready', () => {
    const login = between(
      'async function handleBrowserLogin',
      'async function handleBrowserLogout',
    );

    expect(login).toContain('if (outcome.value.adsSessionReady');
    expect(login).toContain('resumePolicyGrantDispatches(');
    expect(login).toContain("runtime.context,\n      'session_ready'");
    expect(login.indexOf('if (!outcome.ok) throw outcome.error'))
      .toBeLessThan(login.indexOf('resumePolicyGrantDispatches('));
  });

  it('checks persisted pre-batch dispatches when an active store context is published', () => {
    const handlers = between(
      'function registerIpcHandlers',
      'const lifecycleRecovery = createAppLifecycleRecoveryController',
    );

    expect(handlers).toContain('onStoreChanged: async (view) => {');
    expect(handlers).toContain('reconcileActiveStore(freshView.context)');
    expect(handlers).toContain('resumePolicyGrantDispatches(');
    expect(handlers).toContain("fresh,\n          'store_activated'");
    const wrapperEnd = handlers.indexOf('beforeActiveStoreMutation:');
    const storeChangedStart = handlers.indexOf('onStoreChanged:');
    const storeChangedEnd = handlers.indexOf('onStoreRecordChanged:', storeChangedStart);
    expect(handlers.indexOf('resumePolicyGrantDispatches(')).toBeLessThan(wrapperEnd);
    expect(handlers.slice(storeChangedStart, storeChangedEnd)).not.toContain('resumePolicyGrantDispatches(');
  });

  it('binds every Store IPC mutation to MainRuntime and closes browser authority in-lane', () => {
    const handlers = between(
      'function registerIpcHandlers',
      'registerMissionControlIpcHandlers',
    );

    expect(handlers).toContain('withUserStoreMutation: async (scope, work) => {');
    expect(handlers).toContain('assertStoreMutationAllowed(active)');
    expect(handlers).toContain('state.storeCollectionMainRuntime!.withUserStoreMutation(');
    expect(handlers).toContain('const laneActive = state.storeCoordinator!.getActiveStoreContext()');
    expect(handlers).toContain('storeMutationRequiresVisibleBrowserTransition(');
    expect(handlers).toContain('if (!requiresTransition) return work()');
    expect(handlers).toContain('runUserVisibleBrowserTransition({');
    expect(handlers).toContain('closeRuntime: closeUserVisibleBrowserRuntimeForTransition');
    expect(handlers).toContain('assertRuntimeClosed: assertUserVisibleBrowserRuntimeClosed');
    expect(handlers).toContain('readFinalState: readEmptyUserVisibleBrowserTransitionState');
    expect(handlers).toContain('beforeActiveStoreMutation: async (context) => {');
    expect(handlers).toContain('assertStoreMutationAllowed(context)');
    expect(handlers).not.toContain('beforeActiveStoreMutation: async (context) => {\n      const pendingControllers');
    expect(handlers).not.toContain('void closeBrowserControllers');
    expect(handlers).not.toContain('void Promise.all');
  });

  it('keeps collection_only runtime out of every legacy operator action and leases nested Listing work once', () => {
    const controller = between(
      'function browserRuntimeController',
      'function browserControllerFromVisibleRuntime',
    );
    const listing = between(
      'function handleExtractListingFromLingxing',
      'function persistListingContent',
    );

    expect(controller).toContain("runtime.purpose !== 'operator_full'");
    expect(controller).toContain('clearBrowserLoginState()');
    expect(source).toContain('function withLegacyOperatorBrowserLease<Result>');
    expect(source).toContain('state.executionAuthorityService.withAdmittedBrowserOperation(');
    expect(source.indexOf('state.executionAuthorityService.withAdmittedBrowserOperation('))
      .toBeLessThan(source.indexOf('const lease = browserOperationLeases.acquire({'));
    expect(source).toContain("purpose: 'external_write'");
    expect(listing).toContain("'legacy-listing-extract'");
    expect(listing).toContain('extractListingFromLingxingCore(controller, options)');
    expect(listing).not.toContain("browserOperationLeases.acquire({");
  });

  it('tracks direct legacy collection and download-center diagnostics before browser work starts', () => {
    const collection = between(
      'async function runAuthorizedLingxingCollection',
      'async function handleCollectLingxingReports',
    );
    const diagnostic = between(
      'async function handleDiagnoseLingxingDownloadCenter',
      'function appendDiagnosticError',
    );

    const collectionAdmission = collection.indexOf(
      'state.executionAuthorityService.withAdmittedBrowserOperation(',
    );
    const collectionStart = collection.indexOf('state.lingxingCollectionCoordinator!.start(');
    expect(collectionAdmission).toBeGreaterThan(0);
    expect(collectionStart).toBeGreaterThan(collectionAdmission);
    expect(collection).toContain("'legacy:lingxing-collection'");

    const diagnosticAdmission = diagnostic.indexOf(
      'state.executionAuthorityService.withAdmittedBrowserOperation(',
    );
    const diagnosticStart = diagnostic.indexOf('state.lingxingCollectionOperations!.run(');
    expect(diagnosticAdmission).toBeGreaterThan(0);
    expect(diagnosticStart).toBeGreaterThan(diagnosticAdmission);
    expect(diagnostic).toContain("'legacy:lingxing-download-center-diagnostic'");
  });
});
