import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { StatusPill } from '../components/ui';
import {
  PageFrame,
  ResponsiveInspector,
  TaskBanner,
  WorkbenchPanel,
} from '../components/workspace';
import {
  readbackRepairIntentMessage,
  readbackRepairPanelClass,
} from '../readback-repair-intent';
import { firstIncompleteReadbackStep } from '../readback-wizard';
import {
  ReadbackFieldCell,
  readbackActionButtonContent,
  readbackVerifierPassed,
} from "./readback-feedback";
import {
  readbackStepPanelId,
  readbackStepTabId,
  readbackStepFromKeyboard,
  readbackStepTabTitle,
  readbackStepPanelProps,
} from "./readback-tabs";
import {
  ReadbackCaptureTarget,
} from "./readback-capture";
import {
  readbackSessionSummary,
  sessionCheckCopy,
} from "./readback-commands";
import {
  objectName,
  formFromRecommendation,
} from "./readback-form";
import {
  requiredMissing,
  ReadbackContractStrip,
} from "./readback-contract-gates";
import {
  type ReadbackPageViewModel,
} from "./readback-ports";

export function renderReadbackPageView(model: ReadbackPageViewModel) {
  const {
    authority,
    authorityUnavailableReason,
    previewScenarioId,
    primaryTaskCopy,
    finalVerificationPassed,
    missing,
    precheckCopy,
    form,
    capturedEvidenceCount,
    passedTaskAction,
    taskBannerAction,
    primaryRepairAction,
    selectApprovedActionTaskAction,
    secondaryRepairActions,
    repairIntent,
    activeStepIndex,
    activeStepSummary,
    activeStepDetail,
    readbackStepRailStyle,
    readbackStepSummaries,
    activeStep,
    repairIntentStep,
    activateReadbackStep,
    stepTabRefs,
    activeMissingCount,
    technicalInspectorLocked,
    setTechnicalInspectorOpen,
    activeAction,
    currentBatchId,
    sourceBatchMatches,
    approvedRows,
    scope,
    formEpochRef,
    activeExportRequestRef,
    exportRequestIdRef,
    queryKey,
    activeCaptureRequestRef,
    captureRequestIdRef,
    activeFinalRequestRef,
    finalRequestIdRef,
    activeVerifyRequestRef,
    verifyRequestIdRef,
    activeSessionRequestRef,
    sessionRequestIdRef,
    setForm,
    setExportResult,
    setSessionResult,
    setSessionCheck,
    setSessionFillResult,
    setSessionVerifyResult,
    setCapturePreviews,
    setMessage,
    setCopyNotice,
    setActiveStep,
    loading,
    sourceFieldCount,
    sourceFilesCount,
    captureEvidence,
    firstScreenshotRepairSlot,
    capturePreviews,
    captureSavingSlot,
    update,
    repairPulse,
    contractChecks,
    repairFieldClass,
    missingGroups,
    message,
    technicalInspectorOpen,
    exportResult,
    completedViaWorkPackage,
    exportEvidenceButton,
    exportEvidence,
    openExportButton,
    openExport,
    prepareSessionButton,
    prepareSessionPacket,
    verifySessionButton,
    verifySessionPacket,
    fillSessionButton,
    fillSessionPacket,
    verifyEvidenceButton,
    verifyReadbackEvidence,
    sessionWorkflow,
    sessionResult,
    openSessionPacketButton,
    openSessionPacket,
    openSessionInputFileButton,
    openSessionInputFile,
    openSessionInputGuideButton,
    openSessionInputGuide,
    sessionCheck,
    sessionFillResult,
    sessionVerifyResult,
    copyNotice,
    prepareCopyCommandButton,
    copySessionCommand,
    verifyCopyCommandButton,
    fillCopyCommandButton,
    longFillCopyCommandButton,
    copyFillCommand,
  } = model;
const fieldLockReason = authorityUnavailableReason || (authority.previewOnly
  ? '开发预览只读，请在真实应用中选择当前店铺后处理回读证据。'
  : activeAction ? '正在处理回读证据，请等待本次操作完成后继续填写或上传截图。' : '');
const actionLockReason = authorityUnavailableReason || (authority.previewOnly
  ? '开发预览只读，请返回真实应用处理回读证据。'
  : activeAction ? '正在处理回读证据，请等待本次操作完成后重试。' : '');
return (
    <div
      className={authority.previewOnly ? 'readback-page readback-page-preview-readonly' : 'readback-page'}
      data-readback-mode={authority.mode}
      data-preview-scenario={authority.previewOnly ? previewScenarioId : undefined}
      data-workspace="readback"
      data-workspace-evidence-root="true"
      data-workspace-subview="evidence"
      onBeforeInputCapture={(event) => {
        if (!authority.previewOnly) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onChangeCapture={(event) => {
        if (!authority.previewOnly) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClickCapture={(event) => {
        if (!authority.previewOnly) return;
        const target = event.target as HTMLElement;
        if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <PageFrame
        pageId="readback"
        title="结果核对"
        description="选择已批准动作，保存审批凭证、执行前后截图和刷新后的回读值；最终校验会重新核对后台批准记录与当前报表批次。"
        task={(
          <div data-action={primaryTaskCopy.dataAction} id="readback-verify-evidence" tabIndex={-1}>
            <TaskBanner
              eyebrow="当前主任务"
              title={primaryTaskCopy.title}
              description={primaryTaskCopy.description}
              tone={finalVerificationPassed ? 'confirmed' : missing.length ? 'attention' : 'neutral'}
              status={(
                <StatusPill tone={finalVerificationPassed ? 'ready' : missing.length ? 'blocked' : 'pending'}>
                  {primaryTaskCopy.statusLabel || precheckCopy.statusLabel}
                </StatusPill>
              )}
              meta={<span>{form.recommendationId ? `已选择建议 #${form.recommendationId} · 建议版本 ${form.recommendationRevision}` : '尚未选择已批准动作'} · {finalVerificationPassed ? '最终证据已收齐' : `截图 ${capturedEvidenceCount}/4`}</span>}
              primaryAction={finalVerificationPassed
                ? passedTaskAction
                : form.recommendationId ? taskBannerAction(primaryRepairAction) : selectApprovedActionTaskAction}
              secondaryActions={finalVerificationPassed || !form.recommendationId ? [] : secondaryRepairActions.map(taskBannerAction)}
            />
          </div>
        )}
      >
      {authority.previewOnly && (
        <div className="readback-preview-only-banner" role="status" aria-live="polite">
          <strong>仅开发预览，不代表正式交付就绪</strong>
          <span>{previewScenarioId ? `场景：${previewScenarioId}。` : ''} 当前仅展示只读结果核对布局，所有证据写入与真实校验均已锁定。</span>
        </div>
      )}
      <div className="business-stack">
        {repairIntent && (
          <div className="readback-repair-banner" role="status" aria-live="polite">
            <strong>交付验收直达修复</strong>
            <span>{readbackRepairIntentMessage(repairIntent)}</span>
          </div>
        )}

        <div className="readback-repair-actions" role="status" aria-live="polite">
          <strong>当前步骤 {activeStepIndex + 1}/4 · {activeStepSummary.title}</strong>
          <span>{activeStepDetail}</span>
        </div>

        <div className="readback-step-grid readback-step-tabs" role="tablist" aria-label="结果核对步骤" style={readbackStepRailStyle}>
          {readbackStepSummaries.map((step, index) => (
            <button
              aria-controls={readbackStepPanelId(step.id)}
              aria-selected={activeStep === step.id}
              className={`readback-step readback-step-${step.status}${activeStep === step.id ? ' readback-step-active' : ''}${repairIntent && repairIntentStep === step.id ? ' readback-step-repair-pulse' : ''}`}
              id={readbackStepTabId(step.id)}
              key={step.id}
              onClick={() => activateReadbackStep(step.id)}
              onKeyDown={(event) => {
                const nextStep = readbackStepFromKeyboard(step.id, event.key);
                if (!nextStep) return;
                event.preventDefault();
                activateReadbackStep(nextStep, true);
              }}
              ref={(node) => {
                stepTabRefs.current[step.id] = node;
              }}
              role="tab"
              tabIndex={activeStep === step.id ? 0 : -1}
              type="button"
            >
              <span>{index + 1}</span>
              <strong>{readbackStepTabTitle(step.title)}</strong>
              <small>{step.detail}</small>
            </button>
          ))}
        </div>

        <WorkbenchPanel
          className="readback-workbench"
          title={activeStepSummary.title}
          description={activeStepDetail}
          status={<StatusPill tone={activeMissingCount ? 'blocked' : 'ready'}>{activeMissingCount ? `缺 ${activeMissingCount} 项` : '本步骤已满足'}</StatusPill>}
          toolbar={(
            <WorkspaceActionButton disabledReason={actionLockReason || '正在处理回读证据，请等待本次操作完成后查看详情。'}
              aria-label="查看技术与证据详情"
              className="workspace-button workspace-button--secondary"
              data-action="open-technical-inspector"
              disabled={technicalInspectorLocked}
              onClick={() => setTechnicalInspectorOpen(true)}
              type="button"
            >
              查看技术与证据详情
            </WorkspaceActionButton>
          )}
        >
        {fieldLockReason && <p id="readback-fields-lock-reason" role="status">{fieldLockReason}</p>}
        <fieldset
          aria-describedby={fieldLockReason ? "readback-fields-lock-reason" : undefined}
          aria-disabled={Boolean(authorityUnavailableReason) || authority.previewOnly || Boolean(activeAction)}
          className="readback-workbench-fieldset"
          disabled={authority.previewOnly || Boolean(activeAction)}
        >
        <div hidden={activeStep !== 'target-source'}>
          <div {...readbackStepPanelProps('target-source')}>
            <section aria-label="已批准动作与来源" className="readback-workbench-section" data-readback-authority-source="main-derived" id="readback-approved-actions" tabIndex={-1}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">当前有效批次：{currentBatchId || '暂无'}</div>
                <p className="muted-line">来源批次、指标日期、来源行号、来源文件、来源当前值和建议值是回读证据的一部分；缺失或串批次时只能导出缺口草稿。</p>
              </div>
              <StatusPill tone={sourceBatchMatches ? 'ready' : form.sourceBatchId ? 'blocked' : 'pending'}>
                {sourceBatchMatches ? '来源批次匹配' : form.sourceBatchId ? '来源批次不一致' : '待载入来源'}
              </StatusPill>
            </div>
            <div className="table-wrap">
              <table className="business-table approval-table">
                <thead>
                  <tr>
                    <th>对象</th>
                    <th>位置</th>
                    <th>动作与值</th>
                    <th>审批版本</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedRows.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{objectName(row) || row.evidence?.asin || '-'}</strong><small>{row.evidence?.asin || '-'} · {row.entityType || row.evidence?.matchType || '-'}</small></td>
                      <td><strong>{row.evidence?.campaignName || '-'}</strong><small>{row.evidence?.portfolioName || '-'} / {row.evidence?.adGroupName || '-'}</small></td>
                      <td><strong>{row.actionType}</strong><small>{row.currentValue || '-'} {'→'} {row.recommendedValue || '-'}</small></td>
                      <td><strong>#{row.id}</strong><small>版本 {row.revision}</small></td>
                      <td>
                        <button
                          className="secondary-button compact-button"
                          onClick={() => {
                            const nextForm = formFromRecommendation(row, scope, currentBatchId);
                            formEpochRef.current += 1;
                            activeExportRequestRef.current = {
                              kind: 'export',
                              requestId: ++exportRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            activeCaptureRequestRef.current = {
                              kind: 'capture',
                              requestId: ++captureRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            activeFinalRequestRef.current = {
                              kind: 'final',
                              requestId: ++finalRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            activeVerifyRequestRef.current = {
                              kind: 'verify',
                              requestId: ++verifyRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            activeSessionRequestRef.current = {
                              kind: 'session',
                              requestId: ++sessionRequestIdRef.current,
                              queryKey,
                              formEpoch: formEpochRef.current,
                            };
                            setForm(nextForm);
                            setExportResult(null);
                            setSessionResult(null);
                            setSessionCheck(null);
                            setSessionFillResult(null);
                            setSessionVerifyResult(null);
                            setCapturePreviews({});
                            setMessage(null);
                            setCopyNotice(null);
                            setActiveStep(firstIncompleteReadbackStep(requiredMissing(nextForm, currentBatchId)));
                          }}
                          type="button"
                        >
                          载入
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!approvedRows.length && (
                    <tr>
                      <td colSpan={5}>{loading ? '加载中...' : '当前范围没有已批准待执行动作。'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="readback-source-summary" aria-label="载入来源字段摘要">
              <div className="readback-source-summary-main">
                <span>来源字段</span>
                <strong>{form.entityName || form.asin || '尚未载入动作'}</strong>
                <p>
                  {form.actionType || '待选择动作'}
                  {' / '}
                  来源行 {form.sourceRow || '-'}
                  {' / '}
                  指标日 {form.sourceMetricDate || '-'}
                </p>
              </div>
              <div className="readback-source-summary-grid">
                <div>
                  <span>字段完整度</span>
                  <strong>{sourceFieldCount}/14</strong>
                </div>
                <div>
                  <span>来源文件</span>
                  <strong>{sourceFilesCount || 0} 个</strong>
                </div>
                <div>
                  <span>批次状态</span>
                  <strong>{sourceBatchMatches ? '匹配' : form.sourceBatchId ? '不一致' : '待载入'}</strong>
                </div>
              </div>
              <span className="readback-authority-lock">由后台按已批准建议、版本、范围与报表批次重新读取；页面不可修改。</span>
            </div>
            </section>
          </div>
        </div>

        <div hidden={activeStep !== 'approval'}>
          <div {...readbackStepPanelProps('approval')}>
            <section aria-label="审批凭证内容" className="readback-workbench-section">
            <dl className="readback-authority-grid" data-readback-approval-authority="main-derived">
              <div><dt>审批人</dt><dd>{form.approverName || '-'}</dd></div>
              <div><dt>审批时间</dt><dd>{form.approvalConfirmedAt || '-'}</dd></div>
              <div><dt>审批备注</dt><dd>{form.approvalNote || '无补充备注'}</dd></div>
            </dl>
            <div className="readback-capture-grid readback-capture-grid-single">
              <ReadbackCaptureTarget
                disabledReason={fieldLockReason}
                onCapture={(slot, files) => { void captureEvidence(slot, files); }}
                disabled={authority.previewOnly || Boolean(activeAction)}
                id={firstScreenshotRepairSlot === 'approval' ? 'readback-first-missing-screenshot' : undefined}
                previewUrl={capturePreviews.approval}
                saving={captureSavingSlot === 'approval'}
                slot="approval"
                value={form.approvalArtifactPath}
              />
            </div>
            <div className="checkbox-grid">
              <label><input checked={form.operatorConfirmed} onChange={(event) => update({ operatorConfirmed: event.target.checked })} type="checkbox" /> 审批人确认范围</label>
              <label><input checked={form.realWriteApproved} onChange={(event) => update({ realWriteApproved: event.target.checked })} type="checkbox" /> 外部审批允许</label>
              <label><input checked={form.allowedByPolicy} onChange={(event) => update({ allowedByPolicy: event.target.checked })} type="checkbox" /> 低风险策略允许</label>
            </div>
            <p className="muted-line">审批允许只开放人工已批准的低风险动作；没有审批凭证、审批时间和明确允许时不能声称执行完成。</p>
            </section>
          </div>
        </div>

        <div hidden={activeStep !== 'evidence'}>
          <div
            {...readbackStepPanelProps('evidence')}
            className={`readback-step-panel ${readbackRepairPanelClass(Boolean(repairIntent), repairPulse)}`}
          >
            <section aria-label="执行与回读内容" className="readback-workbench-section">
              <p className="muted-line">先记录执行前值和截图，再记录执行后值和截图，最后刷新广告后台填写回读值和回读截图；三类截图不能复用。</p>
              <ReadbackContractStrip checks={contractChecks} />
              <div className="form-grid">
                <ReadbackFieldCell className={repairFieldClass('执行人')} label="执行人"><input value={form.executedBy} onChange={(event) => update({ executedBy: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行编号')} label="执行编号"><input value={form.executionId} onChange={(event) => update({ executionId: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行时间')} label="执行时间"><input value={form.executionExecutedAt} onChange={(event) => update({ executionExecutedAt: event.target.value })} placeholder="ISO 时间" /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行前值')} label="执行前值"><input value={form.beforeValue} onChange={(event) => update({ beforeValue: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行前时间')} label="执行前时间"><input value={form.beforeCapturedAt} onChange={(event) => update({ beforeCapturedAt: event.target.value })} placeholder="ISO 时间" /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行后值')} label="执行后值"><input value={form.afterValue} onChange={(event) => update({ afterValue: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('执行后时间')} label="执行后时间"><input value={form.afterCapturedAt} onChange={(event) => update({ afterCapturedAt: event.target.value })} placeholder="ISO 时间" /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('回读值')} label="回读值"><input id="readback-actual-value" value={form.readbackActualValue} onChange={(event) => update({ readbackActualValue: event.target.value })} /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('回读时间')} label="回读时间"><input value={form.readbackReadAt} onChange={(event) => update({ readbackReadAt: event.target.value })} placeholder="ISO 时间" /></ReadbackFieldCell>
                <ReadbackFieldCell className={repairFieldClass('现场行证明', 'form-grid-wide')} label="现场行证明"><textarea value={form.liveBidSourceNote} onChange={(event) => update({ liveBidSourceNote: event.target.value })} /></ReadbackFieldCell>
              </div>
              <div className="readback-capture-grid">
                <ReadbackCaptureTarget
                  disabled={authority.previewOnly || Boolean(activeAction)}
                  id={firstScreenshotRepairSlot === 'before' ? 'readback-first-missing-screenshot' : undefined}
                  onCapture={(slot, files) => { void captureEvidence(slot, files); }}
                  previewUrl={capturePreviews.before}
                  repairClassName={repairFieldClass('执行前截图')}
                  saving={captureSavingSlot === 'before'}
                  slot="before"
                  value={form.beforeScreenshotPath}
                />
                <ReadbackCaptureTarget
                  disabled={authority.previewOnly || Boolean(activeAction)}
                  id={firstScreenshotRepairSlot === 'after' ? 'readback-first-missing-screenshot' : undefined}
                  onCapture={(slot, files) => { void captureEvidence(slot, files); }}
                  previewUrl={capturePreviews.after}
                  repairClassName={repairFieldClass('执行后截图')}
                  saving={captureSavingSlot === 'after'}
                  slot="after"
                  value={form.afterScreenshotPath}
                />
                <ReadbackCaptureTarget
                  disabled={authority.previewOnly || Boolean(activeAction)}
                  id={firstScreenshotRepairSlot === 'readback' ? 'readback-first-missing-screenshot' : undefined}
                  onCapture={(slot, files) => { void captureEvidence(slot, files); }}
                  previewUrl={capturePreviews.readback}
                  repairClassName={repairFieldClass('回读证据')}
                  saving={captureSavingSlot === 'readback'}
                  slot="readback"
                  value={form.readbackEvidencePath}
                />
              </div>
            </section>
          </div>
        </div>

        <div hidden={activeStep !== 'verify-export'}>
          <div {...readbackStepPanelProps('verify-export')}>
            <section aria-label="最终校验内容" className="readback-workbench-section">
              <div className="checkbox-grid">
                <label><input checked={form.executionSuccess} onChange={(event) => update({ executionSuccess: event.target.checked })} type="checkbox" /> 执行成功确认</label>
                <label><input checked={form.executionVerified} onChange={(event) => update({ executionVerified: event.target.checked })} type="checkbox" /> 执行已核验</label>
                <label><input checked={form.readbackVerified} onChange={(event) => update({ readbackVerified: event.target.checked })} type="checkbox" /> 回读已核验</label>
              </div>
              <div className="business-split">
                <div>
                  <StatusPill tone={finalVerificationPassed || !missing.length ? 'ready' : 'blocked'}>
                    {finalVerificationPassed ? '最终校验通过' : precheckCopy.statusLabel}
                  </StatusPill>
                  {finalVerificationPassed ? (
                    <div className="chip-row">
                      <span className="chip chip-ready">最终证据已核对</span>
                    </div>
                  ) : missing.length ? (
                    <div className="missing-group-grid">
                      {missingGroups.map((group) => (
                        <div className="missing-group" key={group.title}>
                          <strong>{group.title}</strong>
                          <span>{group.items.join('、')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="chip-row">
                      <span className="chip chip-ready">{precheckCopy.chipLabel}</span>
                    </div>
                  )}
                </div>
              </div>
              <p className="muted-line">
                {finalVerificationPassed
                  ? '最终证据已通过后台批准记录、当前报表批次与现场证据核对。'
                  : precheckCopy.helperText}
              </p>
              {message && <p className={message.includes('失败') ? 'blocked-line' : 'muted-line'}>{message}</p>}
            </section>
          </div>
        </div>
        </fieldset>
        </WorkbenchPanel>

        <ResponsiveInspector
          open={technicalInspectorOpen}
          title="技术与证据详情"
          description="只在需要追踪本地证据、verifier 或 NEEDS_WORK 工作包时查看；此处不会自动执行广告或代填证据。"
          busy={technicalInspectorLocked}
          dismissDisabled={technicalInspectorLocked}
          onClose={() => setTechnicalInspectorOpen(false)}
        >
          <div className="readback-technical-drawer">
            <section className="readback-technical-section" aria-labelledby="readback-technical-export-title">
              <h3 id="readback-technical-export-title">导出结果与权威路径</h3>
              {message && <p role="status">{message}</p>}
              <WorkspaceActionButton disabledReason={actionLockReason || '请先在来源步骤载入一条已批准动作，再导出当前缺口草稿。'}
                aria-busy={exportEvidenceButton.ariaBusy} className={exportEvidenceButton.className}
                disabled={exportEvidenceButton.disabled} onClick={() => { void exportEvidence(); }}>
                {readbackActionButtonContent(exportEvidenceButton)}
              </WorkspaceActionButton>
              <p>导出会保留当前缺口，供本地工作包补齐；只有独立校验通过后才代表证据完整。</p>
              {exportResult ? (
                <div className="export-result-card">
                  <div>
                    <span>导出状态</span>
                    <strong>{completedViaWorkPackage
                      ? '初始缺口已由工作包补齐并通过校验'
                      : exportResult.readyForVerifier ? '可进入最终验收' : '已导出但仍需补证据'}</strong>
                  </div>
                  <div>
                    <span>执行范围</span>
                    <strong>{[form.storeName, form.marketplaceCode, form.campaignName, form.adGroupName, form.entityName].filter(Boolean).join(' / ') || '未完整填写'}</strong>
                  </div>
                  <div>
                    <span>证据文件</span>
                    <code>{exportResult.jsonPath || '-'}</code>
                  </div>
                  <div>
                    <span>说明文件</span>
                    <code>{exportResult.markdownPath || '-'}</code>
                  </div>
                  <div>
                    <span>SHA-256</span>
                    <code>{exportResult.sha256 || '-'}</code>
                  </div>
                  <p>{completedViaWorkPackage
                    ? '初始缺口已通过工作包补齐；该流程只写入本地证据文件，不会提交 Amazon。'
                    : '该导出只写入本地证据文件，不会提交 Amazon。下一步：补齐缺失项后重新导出，或到“交付验收”查看最终缺口。'}</p>
                  <WorkspaceActionButton disabledReason={actionLockReason || '请先导出回读证据，再打开已登记的导出文件。'} aria-busy={openExportButton.ariaBusy} className={openExportButton.className} disabled={openExportButton.disabled} onClick={openExport} type="button">
                    {readbackActionButtonContent(openExportButton)}
                  </WorkspaceActionButton>
                </div>
              ) : (
                <p className="muted-line">导出后这里显示本地证据文件和说明文件路径。</p>
              )}
            </section>

            <section className="readback-technical-section" aria-labelledby="readback-technical-session-title">
              <h3 id="readback-technical-session-title">NEEDS_WORK 工作包</h3>
              <div className="business-split">
                <div>
                  <div className="business-scope-line">工作包状态：{completedViaWorkPackage ? '已补齐并通过最终校验' : readbackSessionSummary(exportResult?.jsonPath)}</div>
                  <p className="muted-line">真实广告动作只按单个已批准建议处理；工作包用于把审批、执行前、执行后和刷新回读证据分目录收齐。</p>
                </div>
                <StatusPill tone={completedViaWorkPackage ? 'ready' : exportResult?.jsonPath ? 'pending' : 'blocked'}>
                  {completedViaWorkPackage ? '补证完成' : exportResult?.jsonPath ? '可创建工作包' : '先导出回读证据'}
                </StatusPill>
              </div>
              <div className="action-row">
                <WorkspaceActionButton disabledReason={actionLockReason || '请先选择已批准动作并导出缺口草稿，再创建工作包。'} aria-busy={prepareSessionButton.ariaBusy} className={prepareSessionButton.className} disabled={prepareSessionButton.disabled} onClick={prepareSessionPacket} type="button">
                  {readbackActionButtonContent(prepareSessionButton)}
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={actionLockReason || '请先创建回读工作包；生成证据前按填写说明补齐真实截图和值。'} aria-busy={verifySessionButton.ariaBusy} className={verifySessionButton.className} disabled={verifySessionButton.disabled} onClick={verifySessionPacket} type="button">
                  {readbackActionButtonContent(verifySessionButton)}
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={actionLockReason || '请先创建回读工作包；生成证据前按填写说明补齐真实截图和值。'} aria-busy={fillSessionButton.ariaBusy} className={fillSessionButton.className} disabled={fillSessionButton.disabled} onClick={fillSessionPacket} type="button">
                  {readbackActionButtonContent(fillSessionButton)}
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={actionLockReason || '请先导出可核验证据，或在工作包内生成回读证据文件。'} aria-busy={verifyEvidenceButton.ariaBusy} className={verifyEvidenceButton.className} disabled={verifyEvidenceButton.disabled} onClick={() => { void verifyReadbackEvidence(); }} type="button">
                  {readbackActionButtonContent(verifyEvidenceButton)}
                </WorkspaceActionButton>
              </div>
              <section className="readback-technical-subsection" aria-labelledby="readback-session-steps-title">
                <h4 id="readback-session-steps-title">工作包内要做什么</h4>
                <div className="business-scope-line">工作包目录：{sessionWorkflow.sessionDir}</div>
                <ol className="readback-session-list">
                  {sessionWorkflow.steps.map((step, index) => (
                    <li key={step}>
                      <span>{index + 1}</span>
                      <p>{step}</p>
                    </li>
                  ))}
                </ol>
                <p className="muted-line">{sessionWorkflow.warning}</p>
              </section>
              {sessionResult && (
                <section className="readback-technical-subsection" aria-labelledby="readback-session-paths-title">
                  <h4 id="readback-session-paths-title">工作包路径</h4>
                  <div className="readback-session-result">
                    <div>
                      <span>工作包目录</span>
                      <code>{sessionResult.sessionDir || '-'}</code>
                    </div>
                    <div>
                      <span>填写文件</span>
                      <code>{sessionResult.sessionInputPath || '-'}</code>
                    </div>
                    <div>
                      <span>填写说明</span>
                      <code>{sessionResult.sessionInputGuidePath || '-'}</code>
                    </div>
                    <div>
                      <span>操作清单</span>
                      <code>{sessionResult.checklistPath || '-'}</code>
                    </div>
                    <div>
                      <span>最终证据输出</span>
                      <code>{sessionResult.passEvidencePath || '-'}</code>
                    </div>
                  </div>
                  <div className="action-row">
                    <WorkspaceActionButton disabledReason={actionLockReason || '请先创建工作包，再打开对应文件或填写说明。'} aria-busy={openSessionPacketButton.ariaBusy} className={openSessionPacketButton.className} disabled={openSessionPacketButton.disabled} onClick={openSessionPacket} type="button">
                      {readbackActionButtonContent(openSessionPacketButton)}
                    </WorkspaceActionButton>
                    <WorkspaceActionButton disabledReason={actionLockReason || '请先创建工作包，再打开对应文件或填写说明。'} aria-busy={openSessionInputFileButton.ariaBusy} className={openSessionInputFileButton.className} disabled={openSessionInputFileButton.disabled} onClick={openSessionInputFile} type="button">
                      {readbackActionButtonContent(openSessionInputFileButton)}
                    </WorkspaceActionButton>
                    <WorkspaceActionButton disabledReason={actionLockReason || '请先创建工作包，再打开对应文件或填写说明。'} aria-busy={openSessionInputGuideButton.ariaBusy} className={openSessionInputGuideButton.className} disabled={openSessionInputGuideButton.disabled} onClick={openSessionInputGuide} type="button">
                      {readbackActionButtonContent(openSessionInputGuideButton)}
                    </WorkspaceActionButton>
                  </div>
                </section>
              )}
              {sessionCheck && (
                <div className={`readback-session-check ${sessionCheckCopy(sessionCheck).className}`}>
                  <strong>{sessionCheckCopy(sessionCheck).title}</strong>
                  <span>{sessionCheckCopy(sessionCheck).detail}</span>
                  {sessionCheck.ready && !sessionCheck.captureReady && (
                    <p className="muted-line">检查工作包只证明目录和文件结构安全；还必须填写现场信息并生成最终证据后，才可能进入最终验收。</p>
                  )}
                  {!sessionCheck.ready && Array.isArray(sessionCheck.issues) && (
                    <ul>
                      {sessionCheck.issues.map((issue: string) => <li key={issue}>{issue}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {sessionFillResult && (
                <div className={`readback-session-check ${sessionFillResult.readyForVerifier ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                  <strong>{completedViaWorkPackage ? '回读证据已生成并通过校验' : sessionFillResult.readyForVerifier ? '回读证据已生成，待最终校验' : '回读证据仍未就绪'}</strong>
                  <span>{completedViaWorkPackage
                    ? '已根据填写文件生成证据，并通过最终校验；最终交付状态仍由最终验收汇总决定。'
                    : sessionFillResult.readyForVerifier ? '已根据填写文件生成证据文件；最终可交付仍必须通过本地回读证据校验和最终验收汇总。' : '填写文件或证据文件仍有缺口，不能进入最终验收。'}</span>
                  <div className="readback-session-result readback-session-result-embedded">
                    <div>
                      <span>证据文件</span>
                      <code>{sessionFillResult.jsonPath || '-'}</code>
                    </div>
                    <div>
                      <span>说明文件</span>
                      <code>{sessionFillResult.markdownPath || '-'}</code>
                    </div>
                  </div>
                  {Array.isArray(sessionFillResult.issues) && sessionFillResult.issues.length > 0 && (
                    <ul>
                      {sessionFillResult.issues.map((issue: string) => <li key={issue}>{issue}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {sessionVerifyResult && (
                <div className={`readback-session-check ${readbackVerifierPassed(sessionVerifyResult) ? 'readback-session-check-ready' : 'readback-session-check-blocked'}`}>
                  <strong>{readbackVerifierPassed(sessionVerifyResult) ? '回读证据校验已通过' : '回读证据校验未通过'}</strong>
                  <span>{readbackVerifierPassed(sessionVerifyResult) ? '这份证据已通过本地回读证据校验；最终可交付仍需进入最终验收汇总。' : '这份证据还不能进入最终验收汇总，请按下列缺口补证据后重新生成或重新校验。'}</span>
                  <div className="readback-session-result readback-session-result-embedded">
                    <div>
                      <span>校验文件</span>
                      <code>{sessionVerifyResult.evidencePath || '-'}</code>
                    </div>
                    <div>
                      <span>状态</span>
                      <strong>{readbackVerifierPassed(sessionVerifyResult) ? '通过' : '需补证据'}</strong>
                    </div>
                  </div>
                  {!readbackVerifierPassed(sessionVerifyResult) && Array.isArray(sessionVerifyResult.issues) && sessionVerifyResult.issues.length > 0 && (
                    <ul>
                      {sessionVerifyResult.issues.map((issue: string) => <li key={issue}>{issue}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {copyNotice && <p className="muted-line">{copyNotice}</p>}
            </section>

            <section className="readback-technical-section" aria-labelledby="readback-technical-verifier-title">
              <h3 id="readback-technical-verifier-title">Verifier、哈希与备用命令</h3>
              <ul className="readback-safety-gates" aria-label="最终校验安全门" tabIndex={0}>
                <li>仅 Main 可从 approved recommendation、revision、scope 与 batch 派生权威身份。</li>
                <li>审批、执行前、执行后与回读截图必须独立，时间顺序必须可追溯。</li>
                <li>只有 verifier 返回 ready=true 且 status=PASS 才广播回读已验证。</li>
              </ul>
              <p>最终验收仍以本地证据文件、截图路径、时间顺序和最终验收汇总为准；业务页不展示长命令块。</p>
              <p>真实执行路径保持 fail-closed：没有审批、执行前、执行后、回读证据时不能声称执行完成。</p>
              <div className="action-row">
                <WorkspaceActionButton disabledReason={actionLockReason || '请先导出缺口草稿，再复制对应的本地工作包命令。'} aria-busy={prepareCopyCommandButton.ariaBusy} className={prepareCopyCommandButton.className} disabled={prepareCopyCommandButton.disabled} onClick={() => copySessionCommand('prepare')} type="button">
                  {readbackActionButtonContent(prepareCopyCommandButton)}
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={actionLockReason || '请先导出缺口草稿，再复制对应的本地工作包命令。'} aria-busy={verifyCopyCommandButton.ariaBusy} className={verifyCopyCommandButton.className} disabled={verifyCopyCommandButton.disabled} onClick={() => copySessionCommand('verify')} type="button">
                  {readbackActionButtonContent(verifyCopyCommandButton)}
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={actionLockReason || '请先导出缺口草稿，再复制对应的本地工作包命令。'} aria-busy={fillCopyCommandButton.ariaBusy} className={fillCopyCommandButton.className} disabled={fillCopyCommandButton.disabled} onClick={() => copySessionCommand('fill')} type="button">
                  {readbackActionButtonContent(fillCopyCommandButton)}
                </WorkspaceActionButton>
                <WorkspaceActionButton disabledReason={actionLockReason || '请先导出缺口草稿，再复制对应的本地工作包命令。'} aria-busy={longFillCopyCommandButton.ariaBusy} className={longFillCopyCommandButton.className} disabled={longFillCopyCommandButton.disabled} onClick={copyFillCommand} type="button">
                  {readbackActionButtonContent(longFillCopyCommandButton)}
                </WorkspaceActionButton>
              </div>
              {copyNotice && <p className="muted-line">{copyNotice}</p>}
            </section>
          </div>
        </ResponsiveInspector>
      </div>

      </PageFrame>
    </div>
  );
}
