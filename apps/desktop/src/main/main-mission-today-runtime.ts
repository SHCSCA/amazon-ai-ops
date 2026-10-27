import type { LingxingReportType } from '@amazon-ai-ops/shared-types';
import type { StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { buildMissionControlTodayProjection, selectLatestMissionControlCollectionWindow } from './mission-control-today-projection';
import { browserControllerFromVisibleRuntime, isProviderBrowserSessionReady, reconcileBrowserLoginProjectionWithVisibleRuntime, sameExactStoreContext } from './main-browser-session-runtime';
import { getMainRuntimeContext } from './main-runtime-access';
import { buildOperatorFlowProjection } from './operator-flow-projection';

export function assertVisibleLingxingCollectionSession(context: StoreContextEnvelope): void {
  const mainRuntimeContext = getMainRuntimeContext();
  reconcileBrowserLoginProjectionWithVisibleRuntime();
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.storeRepo) {
    throw new Error('VISIBLE_SESSION_REQUIRED: 店铺会话协调器尚未就绪。');
  }
  const authorized = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(context);
  const runtime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
  const controller = runtime
    ? browserControllerFromVisibleRuntime(runtime, 'lingxing')
    : null;
  const session = mainRuntimeContext.state.storeRepo.getSessionMetadata(authorized.storeId, 'lingxing');
  if (
    !runtime
    || runtime.providerIdentityStatus.lingxing !== 'verified'
    || !sameExactStoreContext(runtime.context, authorized)
    || !controller?.getPage()
    || !session
    || session.status !== 'ready'
    || session.browserProfileId !== authorized.browserProfileId
    || session.sessionGeneration !== authorized.sessionGeneration
  ) {
    throw new Error('VISIBLE_SESSION_REQUIRED: 当前激活店铺的领星可见会话/Profile 与 StoreContext generation 不一致。');
  }
}

export function buildAuthoritativeMissionControlTodayProjection(contextInput: StoreContextEnvelope) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.storeCoordinator || !mainRuntimeContext.state.productRepo || !mainRuntimeContext.state.lingxingImportRepo || !mainRuntimeContext.state.executionAuthorityRepo || !mainRuntimeContext.state.db) {
    throw new Error('MISSION_CONTROL_TODAY_DEPENDENCIES_UNAVAILABLE');
  }
  const context = mainRuntimeContext.state.storeCoordinator.assertActiveStoreContext(contextInput);
  const collectionJobs = mainRuntimeContext.state.lingxingImportRepo.listCollectionJobsForStore(context.storeId, 100);
  const latestCollectionWindow = selectLatestMissionControlCollectionWindow(collectionJobs, context);
  const lineageBatchIds = latestCollectionWindow?.jobs.map((job) => job.jobId) ?? [];
  const metricFacts = latestCollectionWindow && lineageBatchIds.length > 0
    ? mainRuntimeContext.state.db.prepare(`
      SELECT COUNT(*) AS rowCount, MAX(date) AS latestMetricDate
      FROM ad_daily_metrics
      WHERE store_id = ?
        AND batch_id IN (${lineageBatchIds.map(() => '?').join(', ')})
        AND date >= ? AND date <= ?
        AND upper(trim(marketplace_code)) = 'US'
        AND upper(trim(currency)) = 'USD'
    `).get(
      context.storeId,
      ...lineageBatchIds,
      latestCollectionWindow.dateStart,
      latestCollectionWindow.dateEnd,
    ) as { rowCount: number; latestMetricDate: string | null }
    : { rowCount: 0, latestMetricDate: null };
  const reportImportProofs = latestCollectionWindow && lineageBatchIds.length > 0
    ? mainRuntimeContext.state.db.prepare(`
      SELECT
        snapshots.batch_id AS batchId,
        snapshots.report_type AS reportType,
        snapshots.imported_rows AS importedRows,
        snapshots.file_hash AS fileHash,
        snapshots.run_id AS runId
      FROM report_import_file_snapshots snapshots
      INNER JOIN report_import_runs runs
        ON runs.store_id = snapshots.store_id
       AND runs.run_id = snapshots.run_id
       AND runs.batch_id = snapshots.batch_id
      WHERE snapshots.store_id = ?
        AND snapshots.batch_id IN (${lineageBatchIds.map(() => '?').join(', ')})
        AND runs.status = 'completed'
        AND snapshots.report_file_id IS NOT NULL
      ORDER BY snapshots.captured_at DESC, snapshots.snapshot_id DESC
    `).all(context.storeId, ...lineageBatchIds) as Array<{
      batchId: string;
      reportType: LingxingReportType;
      importedRows: number;
      fileHash: string;
      runId: string;
    }>
    : [];
  const eventFacts = mainRuntimeContext.state.db.prepare(`
    SELECT COUNT(*) AS rowCount
    FROM operation_events
    WHERE store_id = ? AND event_date = ? AND archived_at IS NULL
  `).get(context.storeId, context.businessDate) as { rowCount: number };
  const browserSessionReady = isProviderBrowserSessionReady(context, 'amazon_ads');
  const executionProjections = mainRuntimeContext.state.executionAuthorityRepo.listExecutionBatchesForStoreReconciliation(context);
  const projection = buildMissionControlTodayProjection({
    context,
    products: mainRuntimeContext.state.productRepo.findAllWithCostsForStore(context.storeId),
    collectionJobs,
    reportImportProofs,
    importedMetricRows: Number(metricFacts.rowCount) || 0,
    ...(metricFacts.latestMetricDate ? { latestMetricDate: metricFacts.latestMetricDate } : {}),
    operationEventsToday: Number(eventFacts.rowCount) || 0,
    executionBatches: executionProjections.map(item => item.batch),
    browserSessionReady,
  });
  const activeMission = mainRuntimeContext.state.missionDomainRepo?.listMissions(context, { includeArchived: false })
    .find((mission) => mission.status === 'active');
  const analysis = activeMission && mainRuntimeContext.state.analysisAuthorityService
    ? mainRuntimeContext.state.analysisAuthorityService.getMissionAnalysisProjection(context, activeMission.id)
    : null;
  const latestActionBatchId = analysis?.actionBatches[0]?.id;
  const latestProposals = latestActionBatchId
    ? analysis!.proposals.filter((proposal) => proposal.actionBatchId === latestActionBatchId)
    : [];
  return {
    ...projection,
    operatorFlow: buildOperatorFlowProjection({ context, today: projection, domain: mainRuntimeContext.state.missionDomainRepo,
      analysis, execution: executionProjections }),
    analysis: {
      ...(activeMission ? { activeMissionId: activeMission.id } : {}),
      evidencePackageCount: analysis?.evidencePackages.length ?? 0,
      proposalCount: latestProposals.length,
      humanEligibleCount: latestProposals.filter((proposal) => proposal.authorization.human.eligible).length,
      policyEligibleCount: latestProposals.filter((proposal) => proposal.authorization.policy.eligible).length,
      ...(analysis?.evidencePackages[0]?.freshUntil
        ? { latestFreshUntil: analysis.evidencePackages[0].freshUntil }
        : {}),
    },
  };
}
