import { LINGXING_AD_REPORTS, parseExpectedLingxingGeneratedReportName, reconcileLingxingCreatedReportRows } from '@amazon-ai-ops/lingxing-report-collector';
import type { StoreContextEnvelope, LingxingCollectionJobSnapshot, LingxingCollectionReportCheckpoint } from '@amazon-ai-ops/shared-types';
import { assertLegacyLingxingResumeMayCreateJob, isExactLingxingFull8ReportSet } from './lingxing-full8-remediation-policy';
import { authorizedLingxingCollectionTarget } from './main-business-pipeline-runtime';
import { browserControllerFromVisibleRuntime, sameExactStoreContext } from './main-browser-session-runtime';
import { assertVisibleLingxingCollectionSession } from './main-mission-today-runtime';
import { readDownloadCenterPageModel } from './main-download-page-model-runtime';
import { navigateToLingxingDownloadCenter, refreshDownloadCenterReportList, submitExactDownloadCenterReportSearch } from './main-download-navigation-runtime';
import { assertUsableDownloadCenterActionSelector, getControllerPageOrThrow, optionalTrimmedString } from './main-download-automation-runtime';
import { persistCollectionOnlyDownloadCenterDiagnostic } from './main-download-diagnostics-runtime';
import { storeCapsuleFor } from './main-store-access-runtime';
import { nextLingxingCollectionSnapshotTimestamp, persistLingxingCollectionImportState, rebindLingxingResumeState, recoverCompletedLingxingCollectionImport, validatedDownloadedResumeReportTypes } from './main-collection-import-recovery-runtime';
import { asLingxingCanaryRequestId, assertLingxingResumePreflightBeforeMainRuntime, requireCurrentCollectionStoreContext, runAuthorizedLingxingCollection } from './main-collection-commands-runtime';
import { minimalLingxingCollectionJobForRenderer, sanitizeLingxingImportSummaryForRenderer } from './main-collection-projection-runtime';
import type { DownloadCenterReportSelectorContext } from './main-runtime-contracts';
import { getMainRuntimeContext } from './main-runtime-access';

export async function reconcileLingxingCreateUnknownCheckpoint(
  job: LingxingCollectionJobSnapshot,
  context: StoreContextEnvelope,
  ownerRequestId: string,
): Promise<LingxingCollectionJobSnapshot> {
  const mainRuntimeContext = getMainRuntimeContext();
  if (mainRuntimeContext.packageUiReadOnlyRuntime) {
    throw new Error('PACKAGE_UI_EVIDENCE_READ_ONLY: package UI evidence cannot reconcile collection.');
  }
  if (!mainRuntimeContext.state.lingxingImportRepo || !mainRuntimeContext.state.lingxingCollectionOperations) {
    throw new Error('店铺级领星采集核对依赖尚未就绪。');
  }
  if (!mainRuntimeContext.state.executionAuthorityService) {
    throw new Error('浏览器任务准入屏障尚未就绪。');
  }
  const unknownCheckpoints = job.reports.filter((checkpoint) => checkpoint.state === 'create_unknown');
  const alreadyReconciled = job.blockerCode === 'LINGXING_CREATE_CONFIRMED_ABSENT'
    || job.blockerCode === 'LINGXING_CREATE_CONFIRMED_FAILED';
  if (!alreadyReconciled && unknownCheckpoints.length !== 1) {
    throw new Error('创建结果核对要求任务中恰好有一类待核对报表。');
  }
  const checkpoint = unknownCheckpoints[0];
  const report = checkpoint
    ? LINGXING_AD_REPORTS.find((candidate) => candidate.type === checkpoint.reportType)
    : undefined;
  const expectedReportName = checkpoint && report
    ? parseExpectedLingxingGeneratedReportName(checkpoint.detail || '', {
        dateStart: job.request.dateStart,
        dateEnd: job.request.dateEnd,
        reportToken: report.expectedFilenameKeyword,
      })
    : undefined;
  const confirmedNeverSubmitted = Boolean(
    checkpoint
    && checkpoint.errorCode === 'LINGXING_CREATE_CALL_INTERRUPTED'
    && checkpoint.detail?.includes('未提交创建。')
    && !checkpoint.detail?.includes('提交响应：'),
  );
  if (!alreadyReconciled && (!checkpoint || !report || (!expectedReportName && !confirmedNeverSubmitted))) {
    throw new Error('创建记录中没有唯一、可核对的领星报表名称；为避免重复创建，任务继续阻断。');
  }

  const authorized = authorizedLingxingCollectionTarget(context);
  return mainRuntimeContext.state.executionAuthorityService.withAdmittedBrowserOperation(
    'legacy:lingxing-create-reconciliation',
    () => mainRuntimeContext.state.lingxingCollectionOperations!.run({
      context: authorized.context,
      owner: `lingxing-create-reconciliation:${ownerRequestId}`,
      ttlMs: 2 * 60 * 1_000,
    }, async (operation) => {
      operation.assertStepCurrent();
      const browserRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
      if (!browserRuntime
        || !mainRuntimeContext.state.isLoggedIn
        || browserRuntime.providerIdentityStatus.lingxing !== 'verified'
        || !sameExactStoreContext(browserRuntime.context, authorized.context)) {
        throw new Error('请先连接当前店铺领星会话，再核对创建结果。');
      }
      assertVisibleLingxingCollectionSession(authorized.context);
      const controller = browserControllerFromVisibleRuntime(browserRuntime, 'lingxing');
      if (!controller) throw new Error('当前领星可见浏览器类型不受 Main 支持。');
      const model = readDownloadCenterPageModel();
      await navigateToLingxingDownloadCenter(controller, model, authorized.target.storeName);
      const page = getControllerPageOrThrow(controller);
      const selectors = model.actionSelectors!;
      if (alreadyReconciled) {
        const diagnostic = await persistCollectionOnlyDownloadCenterDiagnostic(
          controller,
          storeCapsuleFor(authorized.store),
          authorized.target,
          { start: job.request.dateStart, end: job.request.dateEnd },
        );
        operation.assertStepCurrent();
        if (!diagnostic.ready) {
          throw new Error('当前店铺下载中心预检证据尚未闭合；任务继续阻断，未重复创建。');
        }
        return job;
      }
      let reconciliation: ReturnType<typeof reconcileLingxingCreatedReportRows> = confirmedNeverSubmitted ? { outcome: 'confirmed_absent' } : { outcome: 'ambiguous' };
      let confirmedAbsentObservations = 0;
      const dateRange = { start: job.request.dateStart, end: job.request.dateEnd };
      if (!confirmedNeverSubmitted) {
        const selectorContext: DownloadCenterReportSelectorContext = {
          ...report!,
          generatedReportName: expectedReportName!,
          storeName: authorized.target.storeName,
          marketplaceCode: authorized.target.marketplaceCode,
        };
        const reportSearchInput = await assertUsableDownloadCenterActionSelector(
          page,
          'reportSearchInput',
          selectors.reportSearchInput || mainRuntimeContext.DEFAULT_DOWNLOAD_CENTER_ACTION_SELECTORS.reportSearchInput,
          selectorContext,
          dateRange,
        );
        for (let attempt = 0; attempt < 3; attempt += 1) {
          operation.assertStepCurrent();
          await refreshDownloadCenterReportList(page, selectors);
          const searchInput = page.locator(reportSearchInput).first();
          await submitExactDownloadCenterReportSearch(page, searchInput, expectedReportName!);
          const rowTexts = await page.locator('tr').allInnerTexts();
          const observed = reconcileLingxingCreatedReportRows(rowTexts, {
            expectedReportName: expectedReportName!,
            dateStart: job.request.dateStart,
            dateEnd: job.request.dateEnd,
            exactSearchApplied: true,
          });
          if (observed.outcome === 'found') {
            reconciliation = observed;
            break;
          }
          if (observed.outcome === 'confirmed_absent') {
            confirmedAbsentObservations += 1;
            if (confirmedAbsentObservations === 3) reconciliation = observed;
          } else {
            confirmedAbsentObservations = 0;
          }
        }
      }
      operation.assertStepCurrent();
      if (reconciliation.outcome === 'ambiguous') {
        throw new Error('下载中心没有形成唯一的当前日期核对证据；任务继续阻断，未重复创建。');
      }

      const diagnostic = await persistCollectionOnlyDownloadCenterDiagnostic(
        controller,
        storeCapsuleFor(authorized.store),
        authorized.target,
        { start: job.request.dateStart, end: job.request.dateEnd },
      );
      operation.assertStepCurrent();
      if (!diagnostic.ready) {
        throw new Error('当前店铺下载中心核对完成，但采集预检证据尚未闭合；任务继续阻断，未重复创建。');
      }

      const updatedAt = nextLingxingCollectionSnapshotTimestamp(job.updatedAt);
      const foundReusable = reconciliation.outcome === 'found'
        && ['pending', 'created', 'generating', 'ready'].includes(reconciliation.status);
      const reconciledCheckpoint: LingxingCollectionReportCheckpoint = {
        ...checkpoint,
        state: foundReusable
          ? reconciliation.outcome === 'found' && reconciliation.status === 'ready' ? 'ready' : 'created'
          : 'failed',
        updatedAt,
        ...(foundReusable ? {
          createdReportIdentity: {
            provider: 'lingxing',
            reportType: checkpoint!.reportType,
            externalReportName: expectedReportName!,
            dateStart: job.request.dateStart,
            dateEnd: job.request.dateEnd,
            createdAt: checkpoint.updatedAt,
          },
          detail: '已在当前店铺下载中心唯一核对到原创建记录；将复用该记录继续采集。',
          errorCode: undefined,
        } : {
          createdReportIdentity: undefined,
          detail: reconciliation.outcome === 'confirmed_absent'
            ? '已在当前店铺同日期报表列表中确认原创建记录不存在；允许安全重新创建。'
            : '已唯一核对到原创建记录处于失败终态；允许安全重新创建。',
          errorCode: reconciliation.outcome === 'confirmed_absent'
            ? 'LINGXING_CREATE_CONFIRMED_ABSENT'
            : 'LINGXING_CREATE_CONFIRMED_FAILED',
        }),
      };
      const next: LingxingCollectionJobSnapshot = {
        ...job,
        state: 'failed',
        blockerCode: reconciledCheckpoint.errorCode,
        detail: reconciledCheckpoint.detail,
        updatedAt,
        reports: job.reports.map((candidate) => (
          candidate.reportType === checkpoint!.reportType ? reconciledCheckpoint : candidate
        )),
      };
      return mainRuntimeContext.state.lingxingImportRepo!.upsertCollectionProgressForStore(context.storeId, {
        eventId: `${job.jobId}:create-reconciliation:${updatedAt}`,
        emittedAt: updatedAt,
        job: next,
      });
    }),
  );
}

export async function handleResumeLingxingCollection(input: unknown) {
  const mainRuntimeContext = getMainRuntimeContext();
  if (!mainRuntimeContext.state.lingxingImportRepo) throw new Error('店铺级领星采集仓库尚未就绪。');
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const context = requireCurrentCollectionStoreContext(value.storeContext);
  const requestId = optionalTrimmedString(value.requestId);
  const jobId = optionalTrimmedString(value.jobId);
  if (!requestId || !jobId) throw new Error('恢复采集需要有效的 requestId 与 jobId。');
  let job = mainRuntimeContext.state.lingxingImportRepo.getCollectionJobForStore(context.storeId, jobId);
  if (!job) throw new Error(`当前店铺未找到采集任务：${jobId}`);
  const isCanary = job.request.requestId.startsWith('canary:');
  const reconciliationRuntime = !isCanary
    && isExactLingxingFull8ReportSet(job.request.reportTypes)
      ? mainRuntimeContext.visibleBrowserRuntimeRegistry.read()
      : null;
  const expectedReconciliationRuntimeCloseId = reconciliationRuntime
    && reconciliationRuntime.purpose === 'operator_full'
    && sameExactStoreContext(reconciliationRuntime.context, context)
      ? reconciliationRuntime.runtimeId
      : undefined;
  if (expectedReconciliationRuntimeCloseId) {
    mainRuntimeContext.expectedVisibleRuntimeCloseIds.add(expectedReconciliationRuntimeCloseId);
  }
  try {
    if (value.reconcileCreateUnknown === true
      || value.reconcileOnly === true
      || job.blockerCode === 'LINGXING_CREATE_CONFIRMED_ABSENT'
      || job.blockerCode === 'LINGXING_CREATE_CONFIRMED_FAILED') {
      job = await reconcileLingxingCreateUnknownCheckpoint(job, context, requestId);
    }
  } finally {
    if (expectedReconciliationRuntimeCloseId) {
      mainRuntimeContext.expectedVisibleRuntimeCloseIds.delete(expectedReconciliationRuntimeCloseId);
    }
  }
  if (value.reconcileOnly === true) {
    mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
    return {
      alreadyComplete: false,
      reconciliationOnly: true,
      job: minimalLingxingCollectionJobForRenderer(job),
      importState: job.importState,
      resumedFromJobId: jobId,
      reusedDownloadedReportTypes: await validatedDownloadedResumeReportTypes(job),
    };
  }
  const reboundRequestId = isCanary ? asLingxingCanaryRequestId(requestId) : requestId;
  const rebound = await rebindLingxingResumeState(job, reboundRequestId, context);
  if (!rebound.resumeFrom || rebound.reportTypes.length === 0) {
    if (isCanary) {
      const canaryJob = job.importState === 'not_applicable'
        ? job
        : persistLingxingCollectionImportState(job, 'not_applicable');
      return {
        alreadyComplete: true,
        job: minimalLingxingCollectionJobForRenderer(canaryJob),
        importRecovered: false,
        resumedFromJobId: jobId,
        reusedDownloadedReportTypes: rebound.reused,
      };
    }
    const recovery = await recoverCompletedLingxingCollectionImport(job, context);
    return {
      alreadyComplete: true,
      job: minimalLingxingCollectionJobForRenderer(recovery.job),
      importRecovered: recovery.importRecovered,
      metricsImport: sanitizeLingxingImportSummaryForRenderer(recovery.metricsImport),
      resumedFromJobId: jobId,
      reusedDownloadedReportTypes: rebound.reused,
    };
  }
  if (!isCanary && isExactLingxingFull8ReportSet(job.request.reportTypes)) {
    if (!mainRuntimeContext.state.storeCollectionSchedulerReadModel) {
      throw new Error('完整八报表原任务恢复需要 MainRuntime 权威回读，当前尚未就绪。');
    }
    assertLingxingResumePreflightBeforeMainRuntime(job, context);
    
    
    
    const currentRuntime = mainRuntimeContext.visibleBrowserRuntimeRegistry.read();
    const expectedClosedRuntimeId = currentRuntime
      && currentRuntime.purpose === 'operator_full'
      && sameExactStoreContext(currentRuntime.context, context)
        ? currentRuntime.runtimeId
        : undefined;
    if (expectedClosedRuntimeId) {
      mainRuntimeContext.expectedVisibleRuntimeCloseIds.add(expectedClosedRuntimeId);
    }
    let schedule: Awaited<ReturnType<
      NonNullable<typeof mainRuntimeContext.state.storeCollectionSchedulerReadModel>['resumeJob']
    >>;
    try {
      schedule = await mainRuntimeContext.state.storeCollectionSchedulerReadModel.resumeJob(
        context,
        job.jobId,
        {
          deferReconciledCreateFailures: value.deferReconciledCreateFailures === true,
        },
      );
    } finally {
      if (expectedClosedRuntimeId) {
        mainRuntimeContext.expectedVisibleRuntimeCloseIds.delete(expectedClosedRuntimeId);
      }
    }
    if (!schedule.job || schedule.job.jobId !== job.jobId) {
      throw new Error('完整八报表恢复未回读到同一 durable job，拒绝把结果绑定到其他任务。');
    }
    mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
    return {
      alreadyComplete: schedule.projection.state === 'succeeded',
      job: minimalLingxingCollectionJobForRenderer(schedule.job),
      importState: schedule.job.importState,
      resumedFromJobId: jobId,
      reusedDownloadedReportTypes: rebound.reused,
    };
  }
  assertLegacyLingxingResumeMayCreateJob(job);
  const output = await runAuthorizedLingxingCollection({
    requestId: reboundRequestId,
    storeContext: context,
    start: job.request.dateStart,
    end: job.request.dateEnd,
  }, {
    ...(isCanary ? { canary: true } : {}),
    mode: job.request.mode,
    reportTypes: rebound.reportTypes,
    resumeFrom: rebound.resumeFrom,
    ...(rebound.lineage ? { lineage: rebound.lineage } : {}),
  });
  mainRuntimeContext.mainWindow?.webContents.send('business-ui:data-updated');
  return {
    alreadyComplete: false,
    job: minimalLingxingCollectionJobForRenderer(output.result.job),
    importState: output.result.job.importState,
    metricsImport: sanitizeLingxingImportSummaryForRenderer(output.importSummary),
    resumedFromJobId: jobId,
    reusedDownloadedReportTypes: rebound.reused,
  };
}
