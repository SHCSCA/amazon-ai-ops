import { BusinessDataConfigurationGuard, BusinessDataConfigurationNotice } from '../components/business-data-configuration';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import React from 'react';
import { ProgressiveDetails } from '../components/progressive-details';
import { KpiCard, MicroStepper, PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import { type ProductionCollectionReportBinding } from '../lingxing-collection-lineage';
import { navigate, actionModeLabel, reportStatusLabel, getFileExtension, formatFileSize, formatUpdatedAt, readinessStageClass, readinessStageTone, readinessStageLabel, productionReportFileHasImportReceipt } from './collection-presentation';
import { CollectionMonitorDrawer } from './collection-monitor';
import { CollectionJobWorkspace } from './collection-queue';
import type { useDataCollectionPage } from './collection-controller';
import { CollectionReportSelectorDialog } from './collection-selector-dialog';
import { CollectionReportFileDialog } from './collection-file-dialog';

export function DataCollectionPageView({
  actionPending,
  configurationRequired,
  taskState,
  realReportCount,
  selectedCount,
  reportOptions,
  importedRowCount,
  primaryTaskBusy,
  collectionJobsLoading,
  runningAction,
  manualReconciliationRequired,
  dataLedger,
  importCurrentReports,
  runDownloadAction,
  openingArtifactKey,
  primaryReportFolderArtifactId,
  openArtifact,
  importLocalReports,
  setReportSelectorOpen,
  productionDataReady,
  productionLineageReadiness,
  collectionMonitorOpen,
  collectionMonitorState,
  collectionMonitorEvidenceAvailable,
  setCollectionMonitorOpen,
  actionProgressSteps,
  actionNotice,
  actionError,
  reportStatusLoading,
  reportSelectionState,
  downloadExistingButton,
  recreateSelectedButton,
  importButton,
  renderOpenArtifactButton,
  aggregateRealReportCount,
  aggregateImportedRowCount,
  scope,
  collectionJobsPreviewOnly,
  collectionJobsError,
  collectionJobActionBusyKey,
  storeAuthority,
  collectionJobs,
  cancelCollectionJob,
  loadRecentCollectionJobs,
  resumeCollectionJob,
  reportSelectorOpen,
  reportSelectorDialogFocus,
  setSelectedTypes,
  missingReportTypes,
  unimportedReportTypes,
  productionReportOptions,
  selectedTypes,
  toggleReport,
  selectedReportFile,
  reportFileDialogFocus,
  setSelectedReportFile,
  selectedReportFileImported,
  selectedReportFileBinding,
  lastDiagnostic,
  importedReadinessStage,
  importedReportCount,
  liveProgressPresentation,
  fileAudit,
  rejectedEvidenceCount,
  hasOnlyDiagnosticFiles,
  recreateFullButton,
  loading,
  error,
  shouldShowVerifyAction,
  feedbackActionGroup,
  verifyFeedbackButton,
  setFeedbackActionGroup,
  runVerifyDownloadCenter,
  retryFullFeedbackButton,
  refreshFullFeedbackButton,
  availableBatchCount,
  collection,
  latestBatchStatus,
  primaryAuditArtifactId,
  realFiles,
  visibleRealFiles,
  renderOpenArtifactChip,
  hiddenRealFileCount,
  lastActionResult,
  lastActionSummary,
  productionBindingByType,
}: ReturnType<typeof useDataCollectionPage>) {
  return (
    <div>
      <PageHeader
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.dataCollection}
        description="直接选择 8 类真实广告报表并执行下载、重建或本地导入；流程账本和技术细节放在下方辅助区。"
      />
      {configurationRequired && <BusinessDataConfigurationNotice />}

      <TaskBanner
        description={configurationRequired ? '当前业务数据尚未读取；可继续选择报表、启动采集及管理独立采集任务。' : taskState.detail}
        meta={configurationRequired ? `${selectedCount}/${reportOptions.length} 类已选 · 文件覆盖和入库指标未读取` : `生产血缘 ${realReportCount}/8 类 · ${selectedCount}/${reportOptions.length} 类已选 · ${importedRowCount} 行已入库`}
        primaryAction={{
          label: taskState.primaryActionLabel,
          busy: primaryTaskBusy || collectionJobsLoading,
          busyLabel: collectionJobsLoading ? '核对任务中...' : taskState.primaryActionLabel,
          disabled: Boolean(actionPending || collectionJobsLoading || runningAction || (manualReconciliationRequired && dataLedger.nextStep !== 'import' && !taskState.isComplete)),
          disabledReason: collectionJobsLoading ? '正在核对当前店铺任务，请等待完成。' : manualReconciliationRequired ? '创建结果未知，请先在下载中心核对，再下载已创建报表。' : '当前采集动作处理中，请等待完成。',
          onClick: taskState.isComplete
            ? () => navigate('ad-quant')
            : dataLedger.nextStep === 'import'
              ? () => { void importCurrentReports(); }
              : () => { void runDownloadAction('recreate-full'); },
        }}
        secondaryActions={[
          {
            label: taskState.secondaryActionLabel,
            disabled: Boolean(actionPending || runningAction || openingArtifactKey),
            disabledReason: '当前正在采集或打开目录，请等待完成后重试。',
            onClick: primaryReportFolderArtifactId
              ? () => { void openArtifact(primaryReportFolderArtifactId, '打开报表目录'); }
              : () => { void importLocalReports(); },
          },
          { label: '调整报表范围', onClick: () => setReportSelectorOpen(true), disabled: Boolean(actionPending || runningAction), disabledReason: '采集过程中暂不能调整报表选择，请等待安全结束。' },
        ]}
        status={configurationRequired ? '当前业务数据未读取' : collectionJobsLoading ? '核对任务中' : productionDataReady ? '生产数据已闭合' : productionLineageReadiness.latestJobId ? '生产血缘未闭合' : '缺生产任务'}
        title={configurationRequired ? '选择报表并启动采集' : taskState.title}
        tone={productionDataReady ? 'confirmed' : productionLineageReadiness.state === 'partial' ? 'attention' : 'blocked'}
      />

      <div className="business-stack">
        {collectionMonitorOpen && collectionMonitorState && (
          <CollectionMonitorDrawer
            evidenceAvailable={collectionMonitorEvidenceAvailable}
            onClose={() => setCollectionMonitorOpen(false)}
            state={collectionMonitorState}
            steps={actionProgressSteps}
          />
        )}

        {(runningAction || actionNotice || actionError) && (
          <div
            className={`collection-action-feedback ${actionError ? 'collection-action-feedback-blocked' : runningAction ? 'collection-action-feedback-running' : 'collection-action-feedback-returned'}`}
            aria-live="polite"
          >
            <div>
              <span>{runningAction ? '动作已触发' : actionError ? '动作未完成' : '最近动作'}</span>
              <strong>{runningAction ? actionModeLabel(runningAction) : actionNotice || '采集动作已返回'}</strong>
              {runningAction && <p>系统正在处理当前范围，请不要切换日期、店铺、站点或批次。</p>}
              {!runningAction && actionError && <p>{actionError}</p>}
            </div>
            <div className="collection-action-feedback-side">
              {runningAction && <StatusPill tone="pending">处理中</StatusPill>}
              {!runningAction && actionError && <StatusPill tone="blocked">需处理</StatusPill>}
              {!runningAction && !actionError && <span className="muted-line" role="note">已返回</span>}
            </div>
          </div>
        )}

        <Panel
          className="data-collection-primary-panel"
          title="生产 8 类报表工作台"
          titleAccessory={
            configurationRequired
              ? <StatusPill tone="pending">未读取</StatusPill> : reportStatusLoading
              ? <StatusPill tone="pending">读取中</StatusPill>
              : <StatusPill tone={realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked'}>{realReportCount}/8 类</StatusPill>
          }
          tone={reportStatusLoading ? undefined : realReportCount >= 8 ? 'success' : realReportCount > 0 ? 'warning' : 'blocked'}
        >
          <div className="data-collection-summary-strip" aria-label="当前报表采集摘要">
            <div>
              <span>报表结构</span>
              <strong>8 类</strong>
              <small>活动、广告组、广告位、商品、关键词和搜索词</small>
            </div>
            <div>
              <span>真实报表</span>
              <strong>{configurationRequired ? '未读取' : reportStatusLoading ? '读取中' : `${realReportCount}/8`}</strong>
              <small>{configurationRequired ? '创建运行配置后核对文件覆盖' : reportStatusLoading ? '正在读取当前范围目录' : realReportCount >= 8 ? '当前范围已覆盖完整报表' : '缺失项在选择弹窗内处理'}</small>
            </div>
            <div>
              <span>入库指标</span>
              <strong>{configurationRequired ? '未读取' : reportStatusLoading ? '读取中' : `${importedRowCount} 行`}</strong>
              <small>广告量化只读取真实表格入库数据</small>
            </div>
            <div className="data-collection-summary-action data-collection-summary-selection">
              <div>
                <span>下载范围</span>
                <strong>{reportStatusLoading ? '读取中' : `${selectedCount}/${reportOptions.length}`}</strong>
                <small>本次下载/重建范围</small>
              </div>
              <button className="secondary-button compact-button" onClick={() => setReportSelectorOpen(true)} type="button">
                调整
              </button>
            </div>
          </div>
          <p className="collection-selection-live" aria-live="polite">{reportSelectionState.ariaStatus}</p>
          <details className="data-collection-secondary-actions">
            <summary>
              <span>更多报表操作</span>
              <StatusPill tone="pending">{selectedCount}/{reportOptions.length} 已选</StatusPill>
            </summary>
            <div className="data-collection-secondary-action-row">
              <WorkspaceActionButton disabledReason={runningAction || actionPending ? '当前采集动作处理中，请等待完成。' : '请先选择需要下载的已创建报表。'}
                aria-busy={downloadExistingButton.ariaBusy}
                className={downloadExistingButton.className}
                disabled={(downloadExistingButton.disabled) || actionPending}
                onClick={() => runDownloadAction('download-existing')}
                type="button"
              >
                <span className={downloadExistingButton.ariaBusy ? 'button-content' : undefined}>
                  {downloadExistingButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {downloadExistingButton.label}
                </span>
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={manualReconciliationRequired ? '创建结果未知，请先在下载中心核对，再使用下载已创建报表。' : runningAction || actionPending ? '当前采集动作处理中，请等待完成。' : '请先选择本次需要创建的报表类型。'}
                aria-busy={recreateSelectedButton.ariaBusy}
                className={recreateSelectedButton.className}
                disabled={(recreateSelectedButton.disabled || manualReconciliationRequired) || actionPending}
                onClick={() => runDownloadAction('recreate-selected')}
                type="button"
              >
                <span className={recreateSelectedButton.ariaBusy ? 'button-content' : undefined}>
                  {recreateSelectedButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {recreateSelectedButton.label}
                </span>
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason="当前采集动作处理中，请等待完成后导入。"
                aria-busy={importButton.ariaBusy}
                className={importButton.className}
                disabled={(importButton.disabled) || actionPending}
                onClick={importLocalReports}
                type="button"
              >
                <span className={importButton.ariaBusy ? 'button-content' : undefined}>
                  {importButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                  {importButton.label}
                </span>
              </WorkspaceActionButton>
            </div>
          </details>
          {primaryReportFolderArtifactId && (
            <div className="data-collection-folder-line">
              <span>当前范围原始报表目录</span>
              <strong>已创建，可打开</strong>
              {renderOpenArtifactButton({ className: 'secondary-button compact-button', idleLabel: '打开目录', artifactId: primaryReportFolderArtifactId })}
            </div>
          )}
          {!configurationRequired && (aggregateRealReportCount !== realReportCount || aggregateImportedRowCount !== importedRowCount) && (
            <p className="warning-line">
              当前日期窗聚合检测到 {aggregateRealReportCount}/8 类文件、{aggregateImportedRowCount} 行指标；其中只有 {realReportCount}/8 类、{importedRowCount} 行绑定最新生产授权链，其余批次不参与放行。
            </p>
          )}
        </Panel>

        <BusinessDataConfigurationGuard configurationRequired={configurationRequired}>
<Panel
          title="当前日期窗生产血缘"
          titleAccessory={(
            <StatusPill tone={collectionJobsLoading ? 'pending' : productionDataReady ? 'ready' : productionLineageReadiness.state === 'partial' ? 'warning' : 'blocked'}>
              {collectionJobsLoading ? '核对中' : productionDataReady ? '已闭合' : productionLineageReadiness.state === 'missing' ? '缺任务' : '未闭合'}
            </StatusPill>
          )}
          tone={productionDataReady ? 'success' : productionLineageReadiness.state === 'partial' ? 'warning' : 'blocked'}
        >
          <div className="context-summary-grid">
            <div>
              <span>生产 root</span>
              <strong>{productionLineageReadiness.rootJobId || '未建立'}</strong>
              <p>{productionLineageReadiness.lineageId ? `lineage ${productionLineageReadiness.lineageId}` : '独立部分任务不能拼接成生产 8/8。'}</p>
            </div>
            <div>
              <span>授权链任务</span>
              <strong>{productionLineageReadiness.lineageJobIds.length} 个</strong>
              <p>{productionLineageReadiness.latestJobId ? `最近任务 ${productionLineageReadiness.latestJobId}` : `${scope.dateFrom} 至 ${scope.dateTo}`}</p>
            </div>
            <div>
              <span>文件批次匹配</span>
              <strong>{productionLineageReadiness.sourceMatchedReportCount}/8 类</strong>
              <p>只计入与最终 downloaded 检查点同 batchId 的真实表格。</p>
            </div>
            <div>
              <span>生产入库</span>
              <strong>{productionLineageReadiness.importedReportCount}/8 类 · {productionLineageReadiness.importedRows} 行</strong>
              <p>每类任务都必须持久化 importState=succeeded。</p>
            </div>
          </div>
          {collectionJobsPreviewOnly && (
            <p className="warning-line" role="status">DEV 预览不会注入伪造任务、lineage、下载或入库成功，不提供生产就绪证明。</p>
          )}
          {collectionJobsError && <p className="blocked-line" role="alert">生产任务读取失败：{collectionJobsError}</p>}
          {!collectionJobsLoading && !collectionJobsError && !productionDataReady && (
            <p className="warning-line">{productionLineageReadiness.detail}</p>
          )}
        </Panel>
</BusinessDataConfigurationGuard>

        <CollectionJobWorkspace
          actionBusyKey={collectionJobActionBusyKey}
          currentContext={storeAuthority.authoritativeContext}
          error={collectionJobsError}
          jobs={collectionJobs}
          loading={collectionJobsLoading}
          previewOnly={collectionJobsPreviewOnly}
          onCancel={(job) => { void cancelCollectionJob(job); }}
          onRefresh={() => {
            const context = storeAuthority.authoritativeContext;
            const authorityKey = storeAuthority.authorityKey;
            if (context && authorityKey) void loadRecentCollectionJobs(context, authorityKey);
          }}
          onReconcile={(job) => { void resumeCollectionJob(job, { reconcileCreateUnknown: true }); }}
          onResume={(job) => { void resumeCollectionJob(job); }}
          onResumeSafeRemainder={(job) => {
            void resumeCollectionJob(job, { deferReconciledCreateFailures: true });
          }}
        />

        <CollectionReportSelectorDialog configurationRequired={configurationRequired} reportSelectorOpen={reportSelectorOpen} reportSelectorDialogFocus={reportSelectorDialogFocus} setReportSelectorOpen={setReportSelectorOpen} reportSelectionState={reportSelectionState} setSelectedTypes={setSelectedTypes} reportOptions={reportOptions} reportStatusLoading={reportStatusLoading} missingReportTypes={missingReportTypes} unimportedReportTypes={unimportedReportTypes} selectedCount={selectedCount} productionReportOptions={productionReportOptions} selectedTypes={selectedTypes} toggleReport={toggleReport} />

        <CollectionReportFileDialog selectedReportFile={selectedReportFile} reportFileDialogFocus={reportFileDialogFocus} setSelectedReportFile={setSelectedReportFile} selectedReportFileImported={selectedReportFileImported} selectedReportFileBinding={selectedReportFileBinding} renderOpenArtifactButton={renderOpenArtifactButton} />

        <BusinessDataConfigurationGuard configurationRequired={configurationRequired}>
<div className="kpi-row data-collection-prototype-status-grid" aria-label="数据采集状态">
          <KpiCard
            label="浏览器状态"
            value={lastDiagnostic?.ready ? '就绪' : '待验证'}
            detail={lastDiagnostic?.ready ? 'Lingxing 会话有效' : '需要验证下载中心页面'}
            tone={lastDiagnostic?.ready ? 'ready' : 'warning'}
          />
          <KpiCard
            label="下载中心"
            value={realReportCount >= 8 ? '已完成' : realReportCount > 0 ? '部分完成' : '待采集'}
            detail={`${realReportCount}/8 类真实报表`}
            tone={realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked'}
          />
          <KpiCard
            label="报表目录"
            value={primaryReportFolderArtifactId ? '可打开' : '待创建'}
            detail={primaryReportFolderArtifactId ? '当前范围原始报表目录已创建' : '等待首次真实报表落盘'}
            tone={primaryReportFolderArtifactId ? 'ready' : 'pending'}
          />
          <KpiCard
            label="入库指标"
            value={`${importedRowCount} 行`}
            detail={importedReadinessStage?.status === 'complete' ? '8 类已逐类写入本地 DB' : importedReportCount > 0 ? `${importedReportCount}/8 类已有入库回执` : '等待导入'}
            tone={importedReadinessStage?.status === 'complete' ? 'ready' : importedReportCount > 0 ? 'warning' : 'blocked'}
          />
        </div>

        <Panel title="采集进度" tone={realReportCount >= 8 ? 'success' : realReportCount > 0 ? 'warning' : 'blocked'}>
          {liveProgressPresentation && (
            <div
              aria-atomic="true"
              aria-live="polite"
              className={`collection-action-feedback ${liveProgressPresentation.tone === 'blocked' ? 'collection-action-feedback-blocked' : liveProgressPresentation.tone === 'ready' ? 'collection-action-feedback-ready' : 'collection-action-feedback-running'}`}
              role="status"
            >
              <div>
                <span>领星实时任务</span>
                <strong>{liveProgressPresentation.title}</strong>
                <p>{liveProgressPresentation.detail}</p>
              </div>
              <div className="collection-action-feedback-side">
                <StatusPill tone={liveProgressPresentation.tone}>{liveProgressPresentation.statusLabel}</StatusPill>
                <small>{liveProgressPresentation.completedCount}/{liveProgressPresentation.totalCount} 类已下载</small>
              </div>
            </div>
          )}
          <MicroStepper
            items={[
              {
                label: '下载',
                meta: liveProgressPresentation
                  ? `${liveProgressPresentation.completedCount}/${liveProgressPresentation.totalCount}`
                  : `${realReportCount}/8`,
                detail: liveProgressPresentation?.detail
                  || (realReportCount >= 8 ? '8 类真实报表已留存。' : '等待领星下载中心生成并下载。'),
                tone: liveProgressPresentation?.tone
                  || (realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'blocked'),
              },
              {
                label: '校验',
                meta: fileAudit?.missingReportLabels?.length ? `${fileAudit.missingReportLabels.length} 类缺失` : '待执行',
                detail: '只接受 xlsx/xls/csv 原始广告报表。',
                tone: realReportCount >= 8 ? 'ready' : realReportCount > 0 ? 'warning' : 'pending',
              },
              {
                label: '排除证据文件',
                meta: rejectedEvidenceCount ? `${rejectedEvidenceCount} 个证据文件` : '无阻断',
                detail: '截图、DOM、审计包只做证据，不参与广告表现计算。',
                tone: hasOnlyDiagnosticFiles ? 'blocked' : 'ready',
              },
              {
                label: '入库',
                meta: `${importedRowCount} 行`,
                detail: importedReadinessStage?.status === 'complete' ? '8 类指标已逐类写入本地数据库。' : importedReportCount > 0 ? `${importedReportCount}/8 类已有入库回执，仍需补齐。` : '下载完成后进入导入校验。',
                tone: importedReadinessStage?.status === 'complete' ? 'ready' : 'pending',
              },
            ]}
          />
          <div className="action-row">
            <WorkspaceActionButton disabledReason={manualReconciliationRequired ? '创建结果未知，请先在下载中心核对，再使用下载已创建报表。' : runningAction || actionPending ? '当前采集动作处理中，请等待完成。' : '请先选择本次需要创建的报表类型。'}
              aria-busy={recreateFullButton.ariaBusy}
              className={recreateFullButton.className}
              disabled={(recreateFullButton.disabled || manualReconciliationRequired) || actionPending}
              onClick={() => runDownloadAction('recreate-full')}
              type="button"
            >
              <span className={recreateFullButton.ariaBusy ? 'button-content' : undefined}>
                {recreateFullButton.ariaBusy && <span className="button-spinner" aria-hidden="true" />}
                {recreateFullButton.label}
              </span>
            </WorkspaceActionButton>
            <WorkspaceActionButton disabledReason="正在采集或打开报表目录，请等待完成后重试。"
              className="secondary-button"
              disabled={(Boolean(runningAction || openingArtifactKey)) || actionPending}
              onClick={primaryReportFolderArtifactId ? () => openArtifact(primaryReportFolderArtifactId, '打开报表目录') : importLocalReports}
              type="button"
            >
              {primaryReportFolderArtifactId ? '打开报表目录' : '导入本地报表'}
            </WorkspaceActionButton>
          </div>
          {loading && <p className="muted-line">正在读取采集状态...</p>}
          {error && <p className="blocked-line">读取接口异常：{error}</p>}
        </Panel>

        {(runningAction || actionNotice || actionError) && (
          <div
            className={`collection-action-feedback ${actionError ? 'collection-action-feedback-blocked' : runningAction ? 'collection-action-feedback-running' : 'collection-action-feedback-returned'}`}
            aria-live="polite"
          >
            <div>
              <span>{runningAction ? '动作已触发' : actionError ? '动作未完成' : '最近动作'}</span>
              <strong>{runningAction ? actionModeLabel(runningAction) : actionNotice || '采集动作已返回'}</strong>
              {runningAction && <p>系统正在处理当前范围，请不要切换日期、店铺、站点或批次。</p>}
              {!runningAction && actionError && <p>{actionError}</p>}
            </div>
            <div className="collection-action-feedback-side">
              {runningAction && <StatusPill tone="pending">处理中</StatusPill>}
              {!runningAction && actionError && <StatusPill tone="blocked">需处理</StatusPill>}
              {!runningAction && !actionError && <span className="muted-line" role="note">已返回</span>}
              {((!runningAction && shouldShowVerifyAction) || feedbackActionGroup === 'repair') && (
                <div className="collection-action-feedback-actions">
                  <WorkspaceActionButton disabledReason="当前采集或页面核对动作处理中，请等待返回后重试。"
                    aria-busy={verifyFeedbackButton.ariaBusy}
                    className={verifyFeedbackButton.className}
                    disabled={(verifyFeedbackButton.disabled) || actionPending}
                    onClick={() => {
                      setFeedbackActionGroup('repair');
                      void runVerifyDownloadCenter();
                    }}
                    type="button"
                  >
                    {verifyFeedbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{verifyFeedbackButton.label}</span>
                  </WorkspaceActionButton>
                  <WorkspaceActionButton disabledReason={manualReconciliationRequired ? '创建结果未知，请先在下载中心核对，再使用下载已创建报表。' : runningAction || actionPending ? '当前采集动作处理中，请等待完成。' : '请先选择本次需要创建的报表类型。'}
                    aria-busy={retryFullFeedbackButton.ariaBusy}
                    className={retryFullFeedbackButton.className}
                    disabled={(retryFullFeedbackButton.disabled || manualReconciliationRequired) || actionPending}
                    onClick={() => {
                      setFeedbackActionGroup('repair');
                      void runDownloadAction('recreate-full');
                    }}
                    type="button"
                  >
                    {retryFullFeedbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{retryFullFeedbackButton.label}</span>
                  </WorkspaceActionButton>
                </div>
              )}
              {((!runningAction && !actionError && lastDiagnostic?.ready) || feedbackActionGroup === 'refresh-ready') && (
                <div className="collection-action-feedback-actions">
                  <WorkspaceActionButton disabledReason={manualReconciliationRequired ? '创建结果未知，请先在下载中心核对，再使用下载已创建报表。' : runningAction || actionPending ? '当前采集动作处理中，请等待完成。' : '请先选择本次需要创建的报表类型。'}
                    aria-busy={refreshFullFeedbackButton.ariaBusy}
                    className={refreshFullFeedbackButton.className}
                    disabled={(refreshFullFeedbackButton.disabled || manualReconciliationRequired) || actionPending}
                    onClick={() => {
                      setFeedbackActionGroup('refresh-ready');
                      void runDownloadAction('recreate-full');
                    }}
                    type="button"
                  >
                    {refreshFullFeedbackButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{refreshFullFeedbackButton.label}</span>
                  </WorkspaceActionButton>
                </div>
              )}
            </div>
          </div>
        )}

        {primaryReportFolderArtifactId && (
          <Panel title="真实报表目录" tone="success">
            <div className="business-split">
              <div>
                <div className="business-scope-line">当前范围原始报表目录已创建，可直接打开</div>
                <p className="muted-line">这里只放当前范围可用于后续广告表现的 Lingxing xlsx/xls/csv 原始报表。</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={productionDataReady ? 'ready' : 'warning'}>{productionDataReady ? '生产血缘已闭合' : '生产血缘待闭合'}</StatusPill>
                {renderOpenArtifactButton({ idleLabel: '打开报表目录', artifactId: primaryReportFolderArtifactId })}
              </div>
            </div>
          </Panel>
        )}

        <ProgressiveDetails title="当前范围数据账本">
          <Panel title="当前范围数据账本" tone={dataLedger.status === 'ready' ? 'success' : dataLedger.status === 'partial' ? 'warning' : 'blocked'}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">{dataLedger.headline}</div>
                <p className="muted-line">{dataLedger.detail}</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={dataLedger.status === 'ready' ? 'ready' : 'blocked'}>{dataLedger.nextAction}</StatusPill>
              </div>
            </div>
            {dataLedger.gaps.length > 0 && (
              <div className="evidence-card-grid">
                {dataLedger.gaps.slice(0, 4).map((gap) => (
                  <div className="evidence-card" key={gap}>
                    <span>待处理缺口</span>
                    <strong>{gap}</strong>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="数据流程四段闭环">
          <Panel title="数据流程四段闭环" tone={dataLedger.status === 'ready' ? 'success' : dataLedger.status === 'partial' ? 'warning' : 'blocked'}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">系统只在四段都闭合后放行广告表现、AI 证据包和优化建议。</div>
                <p className="muted-line">批次号和审计文件只用于追溯；运营判断看这四段是否完成。</p>
              </div>
              <StatusPill tone={dataLedger.status === 'ready' ? 'ready' : dataLedger.status === 'partial' ? 'pending' : 'blocked'}>
                {dataLedger.status === 'ready' ? '可进入建议' : '未放行建议'}
              </StatusPill>
            </div>
            <div className="collection-progress-grid">
              {dataLedger.stages.map((stage, index) => (
                <div className={readinessStageClass(stage.status)} key={stage.key}>
                  <span>第 {index + 1} 步</span>
                  <strong>{stage.title}</strong>
                  <p>{stage.value}</p>
                  <p>{stage.detail}</p>
                  <StatusPill tone={readinessStageTone(stage.status)}>{readinessStageLabel(stage.status)}</StatusPill>
                </div>
              ))}
            </div>
            <p className="warning-line">审计文件、截图、DOM/HTML 和采集清单只证明流程，不是广告数据，不能参与花费、订单或 ACOS 计算。</p>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="真实报表文件检查">
          <Panel title="真实报表文件检查" tone={realReportCount ? 'default' : 'blocked'}>
            <div className="business-grid business-grid-four">
              <div className="metric-tile">
                <span>数据批次</span>
                <strong>{availableBatchCount > 0 ? `${availableBatchCount} 个匹配批次` : collection?.latestBatch ? '已匹配批次' : '未匹配'}</strong>
                <small>{collection?.latestBatch ? reportStatusLabel(latestBatchStatus) : '按当前范围自动匹配'}</small>
              </div>
              <div className="metric-tile">
                <span>本地真实报表已下载</span>
                <strong>{realReportCount}/8</strong>
                <small>仅 .xlsx/.xls/.csv</small>
              </div>
              <div className="metric-tile">
                <span>已导入广告指标</span>
                <strong>{importedRowCount}</strong>
                <small>行</small>
              </div>
              <div className="metric-tile">
                <span>审计/诊断文件</span>
                <strong>{rejectedEvidenceCount}</strong>
                <small>不计入报表</small>
              </div>
            </div>
            {hasOnlyDiagnosticFiles && (
              <p className="blocked-line">当前文件夹只有诊断/审计文件，没有真实广告报表。系统不能用于广告表现计算。</p>
            )}
            <p className="warning-line">审计文件、截图、DOM/HTML 和采集清单只用于证明流程，不是广告数据，不能参与广告表现计算。</p>
            {(fileAudit?.missingReportLabels?.length || 0) > 0 && (
              <p className="muted-line">
                缺少真实报表：{fileAudit?.missingReportLabels.slice(0, 8).join('、')}
              </p>
            )}
            <div className="action-row">
              {fileAudit?.downloadArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开真实报表目录', artifactId: fileAudit.downloadArtifactId })
              )}
              {fileAudit?.manifestArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开采集清单', artifactId: fileAudit.manifestArtifactId })
              )}
              <WorkspaceActionButton disabledReason={runningAction || actionPending ? '当前采集动作处理中，请等待完成。' : '当前范围没有已下载原始报表，请先采集或导入本地报表。'}
                className="primary-button"
                disabled={(realReportCount === 0 || Boolean(runningAction)) || actionPending}
                onClick={importCurrentReports}
                type="button"
              >
                {runningAction === 'import' ? '正在导入...' : '导入已下载表格'}
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason="当前采集或页面核对动作处理中，请等待返回后重试。"
                className="secondary-button"
                disabled={(Boolean(runningAction)) || actionPending}
                onClick={importLocalReports}
                type="button"
              >
                导入本地报表
              </WorkspaceActionButton>
            </div>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="文件位置与用途">
          <Panel title="文件位置与用途" tone={realReportCount ? 'success' : 'warning'}>
            <div className="context-summary-grid">
              <div>
                <span>真实广告表格</span>
                <strong>{primaryReportFolderArtifactId ? '已登记当前店铺报表目录' : '暂无目录'}</strong>
                <p>这里应能看到 Lingxing 下载的 xlsx/xls/csv，后续广告表现只读取这些文件。</p>
              </div>
              <div>
                <span>采集清单</span>
                <strong>{fileAudit?.manifestArtifactId ? fileAudit.manifestDisplayName || '采集清单已登记' : '暂无采集清单'}</strong>
                <p>记录批次、文件名、状态和下载结果，用来追溯，不是广告数据表。</p>
              </div>
              <div>
                <span>验收/诊断证据</span>
                <strong>{primaryAuditArtifactId ? '审计证据已登记' : `${rejectedEvidenceCount} 个证据文件`}</strong>
                <p>这里只放审计文件、截图、HTML 等证据；找广告数据请打开“真实广告表格”目录。</p>
              </div>
              <div>
                <span>广告表现入口</span>
                <strong>{productionDataReady ? `${importedRowCount} 行 · 8/8 类已入库` : importedReportCount > 0 ? `${importedReportCount}/8 类已有入库回执` : '未导入'}</strong>
                <p>{productionDataReady ? '完整生产血缘已闭合；0 行时会展示真实零数据状态。' : realReportCount > 0 ? '先确认表格存在；部分报表只保留文件，请继续原完整 8 类任务或重新获取完整 8 类。' : '先重新获取完整 8 类报表，或导入本地报表；单类/部分下载不会单独写入生产指标。'}</p>
              </div>
            </div>
            <div className="action-row">
              {primaryReportFolderArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开真实报表目录', artifactId: primaryReportFolderArtifactId })
              )}
              {fileAudit?.manifestArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开采集清单', artifactId: fileAudit.manifestArtifactId })
              )}
              {primaryAuditArtifactId && (
                renderOpenArtifactButton({ idleLabel: '打开审计证据', artifactId: primaryAuditArtifactId })
              )}
            </div>
            <div className="real-file-summary">
              <div className="real-file-summary-header">
                <strong>当前真实报表清单</strong>
                <span>{realFiles.length ? `${realReportCount}/8 类，${importedRowCount} 行已导入` : '暂无 xlsx/xls/csv 文件'}</span>
              </div>
              {realFiles.length ? (
                <div className="real-file-chip-grid">
                  {visibleRealFiles.filter((file) => Boolean(file.artifactId)).map((file) => renderOpenArtifactChip({
                    ...file,
                    artifactId: file.artifactId || '',
                  }))}
                  {hiddenRealFileCount > 0 && (
                    <div className="real-file-chip real-file-chip-muted">
                      <span>更多文件</span>
                      <strong>+{hiddenRealFileCount}</strong>
                      <small>底部完整表格可查看全部文件元数据</small>
                    </div>
                  )}
                </div>
              ) : (
                <p className="blocked-line">当前没有真实广告报表。请先重新获取完整 8 类报表，或导入当前范围的本地真实报表；单类/部分下载不会单独写入生产指标，只有审计包时系统不能量化广告。</p>
              )}
            </div>
          </Panel>
        </ProgressiveDetails>

        {lastActionResult && (
          <Panel title="本次动作结果" tone={lastActionResult.tone}>
            {lastActionSummary && (
              <div className="evidence-check-panel">
                <div className="business-split">
                  <div>
                    <h3>动作结果摘要</h3>
                    <p className={lastActionSummary.tone === 'blocked' ? 'blocked-line' : 'muted-line'}>
                      {lastActionSummary.headline}
                    </p>
                  </div>
                  <StatusPill tone={lastActionSummary.tone}>{lastActionSummary.statusLabel}</StatusPill>
                </div>
                <div className="context-summary-grid">
                  <div>
                    <span>真实数据状态</span>
                    <strong>{lastActionSummary.facts.slice(0, 2).join(' / ')}</strong>
                    <p>{lastActionSummary.blockers.length ? lastActionSummary.blockers.join('；') : '动作已返回；以当前范围数据账本的逐类入库状态作为最终放行依据。'}</p>
                  </div>
                  <div>
                    <span>导入状态</span>
                    <strong>{lastActionSummary.facts.slice(2).join(' / ')}</strong>
                    <p>{lastActionSummary.nextAction}</p>
                  </div>
                  <div>
                    <span>受控证据</span>
                    <strong>{lastActionSummary.primaryArtifactLabel}</strong>
                    <p>{lastActionSummary.primaryArtifactId ? '已绑定当前店铺工件，可受控打开。' : '暂无可打开工件，请查看失败原因。'}</p>
                  </div>
                </div>
                {lastActionSummary.primaryArtifactId && (
                  <div className="action-row">
                    {renderOpenArtifactButton({ idleLabel: '打开动作证据', artifactId: lastActionSummary.primaryArtifactId })}
                  </div>
                )}
              </div>
            )}
            <div className="business-split">
              <div>
                <div className="business-scope-line">{lastActionResult.title}</div>
                <p className="muted-line">
                  批次：{lastActionResult.batchIds.length ? lastActionResult.batchIds.join('、') : '本地导入'}
                </p>
                <p className={lastActionResult.tone === 'blocked' ? 'blocked-line' : 'muted-line'}>
                  {lastActionResult.nextStep}
                </p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={lastActionResult.downloadedCount > 0 ? 'ready' : 'blocked'}>当前范围覆盖 {lastActionResult.downloadedCount}/8 类</StatusPill>
                <StatusPill tone={lastActionResult.actionDownloadedFiles.length > 0 ? 'ready' : 'pending'}>
                  {lastActionResult.mode === 'import' ? '本次真实导入表格' : '本次新增真实下载'} {lastActionResult.actionDownloadedFiles.length}
                </StatusPill>
                <StatusPill tone={lastActionResult.parsedFiles > 0 ? 'ready' : 'pending'}>本次解析 {lastActionResult.parsedFiles} 表</StatusPill>
                <StatusPill tone={lastActionResult.insertedRows > 0 ? 'ready' : 'pending'}>本次写入 {lastActionResult.insertedRows} 行</StatusPill>
                <StatusPill tone={lastActionResult.failedCount > 0 ? 'blocked' : 'ready'}>失败 {lastActionResult.failedCount}</StatusPill>
                <StatusPill tone={lastActionResult.currentImportedRows > 0 ? 'ready' : 'pending'}>当前指标 {lastActionResult.currentImportedRows} 行</StatusPill>
              </div>
            </div>
            {(lastActionResult.downloadArtifactId || lastActionResult.manifestArtifactId || primaryReportFolderArtifactId) && (
              <div className="action-row">
                {lastActionResult.downloadArtifactId && (
                  renderOpenArtifactButton({
                    idleLabel: lastActionResult.mode === 'import' ? '打开本次导入目录' : '打开本次下载目录',
                    artifactId: lastActionResult.downloadArtifactId,
                  })
                )}
                {lastActionResult.manifestArtifactId && (
                  renderOpenArtifactButton({ idleLabel: '打开本次采集清单', artifactId: lastActionResult.manifestArtifactId })
                )}
                {primaryReportFolderArtifactId && (
                  renderOpenArtifactButton({ idleLabel: '打开当前真实报表目录', artifactId: primaryReportFolderArtifactId })
                )}
              </div>
            )}
            {lastActionResult.actionDownloadedFiles.length > 0 && (
              <div className="result-file-list">
                <div className="real-file-summary-header">
                  <strong>{lastActionResult.mode === 'import' ? '本次真实导入表格' : '本次真实下载表格'}</strong>
                  <span>{lastActionResult.actionDownloadedFiles.length} 个 xlsx/xls/csv</span>
                </div>
                <div className="real-file-chip-grid">
                  {lastActionResult.actionDownloadedFiles.map((file) => (
                    renderOpenArtifactChip({
                      displayName: file.label,
                      fileName: file.fileName,
                      fileExtension: file.fileExtension,
                      artifactId: file.artifactId,
                      smallText: `${formatFileSize(file.fileSizeBytes)} / 点击打开表格`,
                    })
                  ))}
                </div>
              </div>
            )}
            {lastActionResult.actionDownloadedFiles.length === 0 && lastActionResult.failedFiles.length === 0 && (
              <p className={lastActionResult.downloadedCount > 0 ? 'warning-line' : 'blocked-line'}>
                {lastActionResult.downloadedCount > 0
                  ? '当前范围已有真实报表，但本次动作没有新增真实下载文件。请点击“打开当前真实报表目录”确认文件，或直接导入已下载报表。'
                  : lastActionResult.mode === 'import'
                    ? '本次导入没有返回已登记的真实报表工件。请重新选择领星 xlsx/xls/csv 原始报表，不要选择审计包。'
                    : '本次动作没有返回已登记的真实报表工件。请打开本次采集清单核对文件，只有 xlsx/xls/csv 才能进入量化。'}
              </p>
            )}
            {lastActionResult.failedFiles.length > 0 && (
              <ul className="business-list">
                {lastActionResult.failedFiles.map((file) => (
                  <li key={`${file.label}-${file.reason}`}>{file.label}：{file.reason}</li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        <ProgressiveDetails title="真实原始报表文件">
          <Panel title="真实原始报表文件" tone={realFiles.length ? 'default' : 'blocked'}>
            <div className="table-wrap">
              <table className="business-table">
                <thead>
                  <tr>
                    <th>报表类型</th>
                    <th>文件</th>
                    <th>文件大小</th>
                    <th>入库状态</th>
                    <th>DB 指标行数</th>
                    <th>最近入库</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {realFiles.map((file) => {
                    const binding = productionBindingByType.get(file.reportType as ProductionCollectionReportBinding['reportType']);
                    const hasImportReceipt = productionReportFileHasImportReceipt(file, binding);
                    return (
                    <tr key={file.id}>
                      <td>{file.displayName}</td>
                      <td>
                        <strong>{file.fileName || file.artifactDisplayName || '已登记报表'}</strong>
                        <div className="table-subtext">{getFileExtension(file.fileName, file.fileExtension)}</div>
                      </td>
                      <td>{formatFileSize(file.fileSizeBytes)}</td>
                      <td>
                        <span>{hasImportReceipt ? '已入库' : file.importError ? '导入失败' : '未入库'}</span>
                        {file.importError && <div className="blocked-line table-subtext">{file.importError}</div>}
                      </td>
                      <td>{file.importedRows}</td>
                      <td>{formatUpdatedAt(file.lastImportedAt || file.updatedAt)}</td>
                      <td>{reportStatusLabel(binding?.state || file.status)}</td>
                      <td>
                        <div className="table-action-row">
                          <button
                            aria-label={`查看${file.displayName}文件详情`}
                            className="secondary-button compact-button"
                            onClick={() => setSelectedReportFile(file)}
                            type="button"
                          >
                            查看
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {!realFiles.length && (
                    <tr>
                      <td colSpan={8}>{hasOnlyDiagnosticFiles ? '当前文件夹只有诊断/审计文件，没有真实广告报表。系统不能用于广告表现计算。' : '当前范围还没有可量化的真实广告数据'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="验收审计/技术细节">
          <div>
            <p>数据库可读：{collection?.audit.databaseReady ? '是' : '否'}</p>
            <p>计为真实报表：{collection?.audit.acceptedExtensions.join(', ') || '.xlsx, .xls, .csv'}</p>
            <p>不计为真实报表：{collection?.audit.rejectedEvidenceExtensions.join(', ') || '.json, .png, .html'}</p>
            <ul className="business-list">
              {(collection?.audit.notes || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {(collection?.blockers || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </ProgressiveDetails>
      
</BusinessDataConfigurationGuard>
</div>
    </div>
  );
}
