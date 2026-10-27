import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import {
  PageFrame,
  PriorityDataTable,
  TaskBanner,
  WorkbenchPanel,
  WorkspaceState,
} from '../components/workspace';
import { ResponsiveInspector } from '../components/workspace/responsive-inspector';
import {
  formatPercent,
  formatUsd,
} from '../formatters';
import {
  DECISIONS_WORKSPACE_SUBVIEWS,
  decisionsWorkspaceSubviewDefinition,
} from './decisions-workspace-model';
import {
  type DecisionsReviewFormState,
} from "./decisions-contracts";
import {
  decisionActionLabel,
  decisionObjectName,
  decisionStatusLabel,
  feedbackClass,
} from "./decisions-presentation";
import {
  DecisionsWritableTargetForm,
} from "./decisions-target-form";
import {
  type DecisionsPageViewModel,
} from "./decisions-ports";

export function renderDecisionsPageView(model: DecisionsPageViewModel) {
  const {
    selected,
    operationBlockedReason,
    subview,
    taskTitle,
    primaryQueueTask,
    subviewDefinition,
    taskTone,
    loadedStatus,
    primaryTaskAction,
    primaryQueueRow,
    generationAction,
    refreshAction,
    interactionLocked,
    requestSubview,
    handleTabKeyDown,
    tabRefs,
    counts,
    authorityQueryState,
    queue,
    pipelineError,
    pageMessage,
    selectedBatchRows,
    batchSelectableRows,
    batchHandoffAction,
    publishedRows,
    orderedRows,
    transactionLocked,
    loadRows,
    columns,
    selectedId,
    openDecisionInspector,
    selectedEligibility,
    closeInspector,
    focusReturnOverrideRef,
    selectedEvidenceSummary,
    scope,
    currentBatchId,
    mutationLocked,
    setReviewForm,
    reviewForm,
    currentRealReportSourceFiles,
    reviewBlockers,
    decisionFeedback,
    submittingReview,
    resolveSelectedReview,
    submittingDecision,
    submitDecision,
    discoveringTarget,
    discoverSelectedWritableTarget,
    targetBindingBlockers,
    submittingTargetBinding,
    bindSelectedWritableTarget,
    setApproverName,
    approverName,
    setApprovalNote,
    approvalNote,
  } = model;
return (
    <div
      className="decisions-workspace"
      data-inspector-open={selected ? 'true' : undefined}
      data-workspace="decisions"
      data-workspace-evidence-root="true"
      data-workspace-subview={subview}
    >
      <PageFrame
        pageId="decisions"
        title="建议与审批"
        description="在同一权威队列内判断、批准或拒绝建议。批准不等于执行；真实广告后台操作与结果回读始终是后续独立步骤。"
        task={(
          <TaskBanner
            eyebrow="当前主任务"
            title={taskTitle}
            description={primaryQueueTask?.description
              || `${subviewDefinition.description} 每个状态最多已载入 100 条。`}
            tone={taskTone}
            status={<span>{loadedStatus}</span>}
            primaryAction={primaryTaskAction}
            secondaryActions={selected ? [refreshAction] : subview === 'recommendations'
              ? primaryQueueRow
                ? [generationAction, refreshAction]
                : [refreshAction]
              : primaryQueueRow
                ? [refreshAction]
                : undefined}
          />
        )}
      >
        <div className="decisions-workbench-layout">
          {(interactionLocked || mutationLocked) && <p id="decisions-operation-lock-reason" role="status">{operationBlockedReason}</p>}
          <WorkbenchPanel
          title="建议对象队列"
          description="按风险与真实花费排序；选择一行，在右侧检查器内查看完整证据并做决定。"
          status={<span>{loadedStatus}</span>}
          toolbar={(
            <div aria-label="建议与审批视图" className="decisions-tabs" role="tablist">
              {DECISIONS_WORKSPACE_SUBVIEWS.map((candidate) => {
                const definition = decisionsWorkspaceSubviewDefinition(candidate);
                const selectedTab = candidate === subview;
                return (
                  <button
                    aria-controls={`decisions-panel-${candidate}`}
                    aria-selected={selectedTab}
                    aria-describedby={interactionLocked ? "decisions-operation-lock-reason" : undefined}
                    disabled={interactionLocked}
                    id={`decisions-tab-${candidate}`}
                    key={candidate}
                    onClick={() => requestSubview(candidate)}
                    onKeyDown={(event) => handleTabKeyDown(event, candidate)}
                    ref={(element) => { tabRefs.current[candidate] = element; }}
                    role="tab"
                    tabIndex={selectedTab ? 0 : -1}
                    type="button"
                  >
                    {definition.label}（已载入 {counts[candidate]}）
                  </button>
                );
              })}
            </div>
          )}
          footer={(
            <div className="decisions-workbench-footer">
              <span>每个权威状态最多已载入 100 条；数量不是全库总数。</span>
              {authorityQueryState.matchesCurrentQuery && queue.loadedAt && (
                <span>最近读取 {new Date(queue.loadedAt).toLocaleTimeString('zh-CN')}</span>
              )}
            </div>
          )}
        >
          {DECISIONS_WORKSPACE_SUBVIEWS.map((candidate) => {
            const activePanel = candidate === subview;
            return (
              <div
                aria-labelledby={`decisions-tab-${candidate}`}
                hidden={!activePanel}
                id={`decisions-panel-${candidate}`}
                key={candidate}
                role="tabpanel"
                tabIndex={activePanel ? 0 : -1}
              >
                {activePanel && (
                  <>
            {(queue.error || pipelineError || pageMessage) && (
              <div
                aria-live="polite"
                className={`decisions-page-message${authorityQueryState.stale ? ' decisions-page-message--stale' : ''}`}
                role="status"
              >
                {authorityQueryState.stale && <strong>数据已过期，所有决定已锁定。</strong>}
                <span>{pageMessage || queue.error || pipelineError}</span>
              </div>
            )}
            {subview === 'recommendations' && (
              <div
                aria-label="可审批建议选择与批量复核"
                className="decisions-selection-status"
                role="group"
              >
                <span aria-live="polite" role="status">
                  已选 {selectedBatchRows.length}/{batchSelectableRows.length} 条可审批建议
                </span>
                {selectedBatchRows.length > 0 && (
                  <WorkspaceActionButton disabledReason={batchHandoffAction.disabledReason || operationBlockedReason} busy={batchHandoffAction.busy} busyLabel={batchHandoffAction.busyLabel}
                    aria-busy={batchHandoffAction.busy || undefined}
                    className="secondary-button decisions-selection-action"
                    disabled={batchHandoffAction.disabled}
                    onClick={batchHandoffAction.onClick}
                    title={batchHandoffAction.disabledReason}
                    type="button"
                  >
                    {batchHandoffAction.busy ? batchHandoffAction.busyLabel : batchHandoffAction.label}
                  </WorkspaceActionButton>
                )}
              </div>
            )}
            {queue.loading && !publishedRows.length ? (
              <WorkspaceState kind="loading" description="正在同步待审批、需复核、已批准、已拒绝四类权威状态。" />
            ) : !orderedRows.length ? (
              <WorkspaceState
                kind={authorityQueryState.stale ? 'error' : 'empty'}
                description={authorityQueryState.stale
                  ? '权威队列读取失败，旧数据不可用于决定。'
                  : `当前范围没有${subviewDefinition.label}建议。`}
                action={authorityQueryState.stale ? {
                  label: '重新读取权威队列',
                  disabled: refreshAction.disabled,
                  disabledReason: refreshAction.disabledReason,
                  onClick: refreshAction.onClick,
                } : undefined}
              />
            ) : (
              <PriorityDataTable
                caption={`${subviewDefinition.label}建议对象，已载入 ${orderedRows.length} 条`}
                rows={orderedRows}
                columns={columns}
                getRowKey={(row) => row.id}
                selectedRowKey={selectedId}
                onRowSelect={openDecisionInspector}
                rowAriaLabel={(row) => `${decisionActionLabel(row.actionType)}，${decisionObjectName(row)}，${decisionStatusLabel(row.status)}；按 Enter 或空格查看详情`}
              />
            )}
                  </>
                )}
              </div>
            );
          })}
          </WorkbenchPanel>

          <ResponsiveInspector
        open={Boolean(selected)}
        title={selected ? `#${selected.id} · ${decisionObjectName(selected)}` : '建议详情'}
        description={selectedEligibility?.readOnly
          ? selectedEligibility.detail
          : '先核对动作、真实证据与阻断项，再形成决定。批准不等于执行。'}
        busy={interactionLocked}
        dismissDisabled={interactionLocked}
        onClose={closeInspector}
        resolveFocusReturnTarget={(trigger) => {
          const override = focusReturnOverrideRef.current;
          focusReturnOverrideRef.current = null;
          return override ?? trigger;
        }}
      >
        {selected && selectedEligibility && (
          <div className="decisions-inspector-content">
            <section aria-labelledby="decisions-inspector-summary-title">
              <h3 id="decisions-inspector-summary-title">核心判断</h3>
              <dl className="decisions-inspector-summary">
                <div><dt>动作</dt><dd>{decisionActionLabel(selected.actionType)}</dd></div>
                <div><dt>对象</dt><dd>{decisionObjectName(selected)}</dd></div>
                <div><dt>当前 → 建议</dt><dd>{selected.currentValue || '-'} → {selected.recommendedValue || '-'}</dd></div>
                <div><dt>花费 / ACOS</dt><dd>{formatUsd(selected.cost)} / {formatPercent(Number(selected.acos || 0) * 100)}</dd></div>
                <div><dt>决策资格</dt><dd>{selectedEligibility.label}</dd></div>
              </dl>
              <p>{selected.reason || '没有补充业务理由。'}</p>
            </section>

            <section aria-labelledby="decisions-inspector-evidence-title">
              <h3 id="decisions-inspector-evidence-title">证据与风险</h3>
              <p><strong>{selectedEvidenceSummary.statusLabel}：</strong>{selectedEvidenceSummary.headline}</p>
              <p>{selectedEvidenceSummary.evidenceSummary}</p>
              {selectedEvidenceSummary.reasons.length > 0 && (
                <ul>{selectedEvidenceSummary.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              )}
              {selectedEligibility.blockers.length > 0 && (
                <div className="decisions-blockers">
                  <strong>当前阻断</strong>
                  <ul>{selectedEligibility.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                </div>
              )}
            </section>

            {selectedEligibility.readOnly ? (
              <section aria-label="只读决定状态" className="decisions-readonly-decision">
                <strong>{selected.status === 'approved' ? '已批准，尚不代表已执行。' : '已拒绝，当前决定只读。'}</strong>
                <p>{selectedEligibility.detail}</p>
              </section>
            ) : selected.status === 'needs_review' ? (
              <section aria-labelledby="decisions-inspector-form-title">
                <h3 id="decisions-inspector-form-title">确认受控复核</h3>
                <p className="decisions-review-safety-note">
                  此操作只会把建议从“需复核”恢复为“待审批”，不会批准建议，也不会执行 Ads 动作。
                </p>
                <dl aria-label="当前锁定复核范围" className="decisions-review-scope">
                  <div><dt>日期</dt><dd>{scope.dateFrom} → {scope.dateTo}</dd></div>
                  <div><dt>店铺 / 站点</dt><dd>{scope.storeName} / {scope.marketplaceCode}</dd></div>
                  <div><dt>ASIN</dt><dd>{scope.asin || '未锁定'}</dd></div>
                  <div><dt>批次</dt><dd>{currentBatchId || '未锁定'}</dd></div>
                  <div><dt>建议版本</dt><dd>rev {selected.revision}</dd></div>
                </dl>
                <fieldset aria-describedby={mutationLocked ? "decisions-operation-lock-reason" : undefined} className="decisions-review-form"
                      disabled={mutationLocked}>
                  <legend>人工复核与 Ads 可写对象身份</legend>
                  <label>
                    <span>复核人</span>
                    <input
                      autoComplete="name"
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        reviewedBy: event.target.value,
                      }))}
                      placeholder="填写姓名"
                      value={reviewForm.reviewedBy}
                    />
                  </label>
                  <label>
                    <span>复核依据 / 拒绝原因</span>
                    <textarea
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        rationale: event.target.value,
                      }))}
                      placeholder="说明如何核对 Ads 对象；拒绝时写明具体原因"
                      rows={3}
                      value={reviewForm.rationale}
                    />
                  </label>
                  <label>
                    <span>可写对象类型</span>
                    <select
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        entityType: event.target.value as DecisionsReviewFormState['entityType'],
                      }))}
                      value={reviewForm.entityType}
                    >
                      <option value="">请选择唯一类型</option>
                      <option value="keyword">关键词</option>
                      <option value="auto_targeting">自动投放</option>
                      <option value="product_targeting">商品投放</option>
                    </select>
                  </label>
                  <label>
                    <span>Ads 对象 ID</span>
                    <input
                      autoComplete="off"
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        entityId: event.target.value,
                      }))}
                      placeholder="填写 Ads UI / API 中的真实对象 ID"
                      value={reviewForm.entityId}
                    />
                  </label>
                  <label>
                    <span>来源文件</span>
                    <select
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        sourceFile: event.target.value,
                      }))}
                      value={reviewForm.sourceFile}
                    >
                      <option value="">请选择当前批次报表</option>
                      {currentRealReportSourceFiles.map((sourceRef) => (
                        <option key={sourceRef} value={sourceRef}>{sourceRef}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>唯一来源行</span>
                    <input
                      inputMode="numeric"
                      min="1"
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        sourceRow: event.target.value,
                      }))}
                      placeholder="例如 611"
                      step="1"
                      type="number"
                      value={reviewForm.sourceRow}
                    />
                  </label>
                  <label>
                    <span>身份核验来源</span>
                    <select
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        identitySource: event.target.value as DecisionsReviewFormState['identitySource'],
                      }))}
                      value={reviewForm.identitySource}
                    >
                      <option value="ads_ui">Ads UI</option>
                      <option value="ads_api">Ads API</option>
                    </select>
                  </label>
                  <label className="decisions-review-form__wide">
                    <span>身份核验证据路径</span>
                    <input
                      autoComplete="off"
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        identityProofPath: event.target.value,
                      }))}
                      placeholder="填写本地截图或导出证据的完整路径"
                      value={reviewForm.identityProofPath}
                    />
                  </label>
                  <label className="decisions-review-form__wide">
                    <span>身份核验说明</span>
                    <textarea
                      onChange={(event) => setReviewForm((current) => ({
                        ...current,
                        verificationNote: event.target.value,
                      }))}
                      placeholder="说明活动、广告组、对象名称与 ID 的核对过程"
                      rows={3}
                      value={reviewForm.verificationNote}
                    />
                  </label>
                </fieldset>
                {reviewBlockers.length > 0 && (
                  <div className="decisions-review-blockers" role="status" aria-live="polite">
                    <strong>复核仍被锁定</strong>
                    <ul>{reviewBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                  </div>
                )}
                {decisionFeedback && (
                  <div className={feedbackClass(decisionFeedback.tone)} role="status" aria-live="polite">
                    <strong>{decisionFeedback.title}</strong>
                    <span>{decisionFeedback.detail}</span>
                  </div>
                )}
                <div aria-label="受控复核动作" className="decisions-decision-actions" role="group">
                  <WorkspaceActionButton disabledReason={mutationLocked ? operationBlockedReason : reviewBlockers.join('；') + '。请补齐上方复核字段后重试。'} busy={submittingReview} busyLabel={'正在提交复核…'}
                    aria-busy={submittingReview || undefined}
                    className="primary-button"
                    disabled={reviewBlockers.length > 0 || mutationLocked}
                    onClick={() => { void resolveSelectedReview(); }}
                    type="button"
                  >
                    {submittingReview ? '正在确认复核...' : '确认复核，回到待审批'}
                  </WorkspaceActionButton>
                  <WorkspaceActionButton disabledReason={mutationLocked ? operationBlockedReason : '当前建议已形成决定，请返回队列选择待处理建议。'} busy={submittingDecision === 'rejected'} busyLabel={'正在拒绝…'}
                    aria-busy={submittingDecision === 'rejected' || undefined}
                    className="secondary-button danger-button"
                    disabled={!selectedEligibility.canReject || mutationLocked}
                    onClick={() => { void submitDecision('rejected'); }}
                    type="button"
                  >
                    {submittingDecision === 'rejected' ? '处理中...' : '拒绝建议'}
                  </WorkspaceActionButton>
                </div>
              </section>
            ) : selected.status === 'pending' && !selected.evidence?.writableTarget ? (
              <section aria-labelledby="decisions-inspector-form-title">
                <h3 id="decisions-inspector-form-title">核验 Ads 对象，保持待审批</h3>
                <p className="decisions-review-safety-note">
                  此步骤只绑定当前建议对应的唯一 Ads 可写对象并生成不可覆盖的审计记录；不会批准建议，也不会执行 Ads 动作。
                </p>
                <div aria-label="Ads 页面只读识别" className="decisions-decision-actions" role="group">
                  <WorkspaceActionButton disabledReason={operationBlockedReason} busy={discoveringTarget} busyLabel={'正在发现对象…'}
                    aria-busy={discoveringTarget || undefined}
                    className="secondary-button"
                    disabled={mutationLocked}
                    onClick={() => { void discoverSelectedWritableTarget(); }}
                    type="button"
                  >
                    {discoveringTarget ? '正在读取当前 Ads 页面...' : '从当前 Ads 页面识别（只读）'}
                  </WorkspaceActionButton>
                  <span className="decisions-review-safety-note">只填充核验表单，不会自动绑定、批准或执行。</span>
                </div>
                <dl aria-label="当前锁定对象核验范围" className="decisions-review-scope">
                  <div><dt>日期</dt><dd>{scope.dateFrom} → {scope.dateTo}</dd></div>
                  <div><dt>店铺 / 站点</dt><dd>{scope.storeName} / {scope.marketplaceCode}</dd></div>
                  <div><dt>ASIN</dt><dd>{scope.asin || '未锁定'}</dd></div>
                  <div><dt>批次</dt><dd>{currentBatchId || '未锁定'}</dd></div>
                  <div><dt>当前版本</dt><dd>rev {selected.revision}</dd></div>
                </dl>
                <DecisionsWritableTargetForm
                  disabledReason={operationBlockedReason}
                  disabled={mutationLocked}
                  form={reviewForm}
                  mode="binding"
                  setForm={setReviewForm}
                  sourceFiles={currentRealReportSourceFiles}
                />
                {targetBindingBlockers.length > 0 && (
                  <div className="decisions-review-blockers" role="status" aria-live="polite">
                    <strong>对象核验仍被锁定</strong>
                    <ul>{targetBindingBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                  </div>
                )}
                {decisionFeedback && (
                  <div className={feedbackClass(decisionFeedback.tone)} role="status" aria-live="polite">
                    <strong>{decisionFeedback.title}</strong>
                    <span>{decisionFeedback.detail}</span>
                  </div>
                )}
                <div aria-label="Ads 对象核验动作" className="decisions-decision-actions" role="group">
                  <WorkspaceActionButton disabledReason={mutationLocked ? operationBlockedReason : targetBindingBlockers.join('；') + '。请完成对象身份核验后重试。'} busy={submittingTargetBinding} busyLabel={'正在确认身份…'}
                    aria-busy={submittingTargetBinding || undefined}
                    className="primary-button"
                    disabled={targetBindingBlockers.length > 0 || mutationLocked}
                    onClick={() => { void bindSelectedWritableTarget(); }}
                    type="button"
                  >
                    {submittingTargetBinding ? '正在核验 Ads 对象...' : '确认对象绑定（仍待审批）'}
                  </WorkspaceActionButton>
                  <WorkspaceActionButton disabledReason={mutationLocked ? operationBlockedReason : '当前建议已形成决定，请返回队列选择待处理建议。'} busy={submittingDecision === 'rejected'} busyLabel={'正在拒绝…'}
                    aria-busy={submittingDecision === 'rejected' || undefined}
                    className="secondary-button danger-button"
                    disabled={!selectedEligibility.canReject || mutationLocked}
                    onClick={() => { void submitDecision('rejected'); }}
                    type="button"
                  >
                    {submittingDecision === 'rejected' ? '处理中...' : '拒绝建议'}
                  </WorkspaceActionButton>
                </div>
              </section>
            ) : (
              <section aria-labelledby="decisions-inspector-form-title">
                <h3 id="decisions-inspector-form-title">人工决定</h3>
                <div className="decisions-decision-form">
                  <label>
                    <span>审批人 / 处理人</span>
                    <input
                      autoComplete="name"
                      aria-describedby={mutationLocked ? "decisions-operation-lock-reason" : undefined}
                      disabled={mutationLocked}
                      onChange={(event) => setApproverName(event.target.value)}
                      placeholder="填写姓名"
                      value={approverName}
                    />
                  </label>
                  <label>
                    <span>审批备注 / 拒绝原因</span>
                    <textarea
                      aria-describedby={mutationLocked ? "decisions-operation-lock-reason" : undefined}
                      disabled={mutationLocked}
                      onChange={(event) => setApprovalNote(event.target.value)}
                      placeholder="拒绝时必须填写具体原因"
                      rows={4}
                      value={approvalNote}
                    />
                  </label>
                </div>
                {decisionFeedback && (
                  <div className={feedbackClass(decisionFeedback.tone)} role="status" aria-live="polite">
                    <strong>{decisionFeedback.title}</strong>
                    <span>{decisionFeedback.detail}</span>
                  </div>
                )}
                <div aria-label="建议决定动作" className="decisions-decision-actions" role="group">
                  <WorkspaceActionButton disabledReason={mutationLocked ? operationBlockedReason : selectedEligibility?.blockers.join('；') + '。请按上方证据与风险提示补齐后重新读取。'} busy={submittingDecision === 'approved'} busyLabel={'正在批准…'}
                    aria-busy={submittingDecision === 'approved' || undefined}
                    className="primary-button"
                    disabled={!selectedEligibility.canApprove || mutationLocked}
                    onClick={() => { void submitDecision('approved'); }}
                    type="button"
                  >
                    {submittingDecision === 'approved' ? '处理中...' : '批准建议（不执行 Ads）'}
                  </WorkspaceActionButton>
                  <WorkspaceActionButton disabledReason={mutationLocked ? operationBlockedReason : '当前建议已形成决定，请返回队列选择待处理建议。'} busy={submittingDecision === 'rejected'} busyLabel={'正在拒绝…'}
                    aria-busy={submittingDecision === 'rejected' || undefined}
                    className="secondary-button danger-button"
                    disabled={!selectedEligibility.canReject || mutationLocked}
                    onClick={() => { void submitDecision('rejected'); }}
                    type="button"
                  >
                    {submittingDecision === 'rejected' ? '处理中...' : '拒绝建议'}
                  </WorkspaceActionButton>
                </div>
              </section>
            )}

            <details className="decisions-technical-disclosure">
              <summary>
                <span>来源与技术明细</span>
                <small>按需展开</small>
              </summary>
              <div className="decisions-technical-details-body">
                <dl className="decisions-technical-details">
                  <div><dt>广告活动</dt><dd>{selected.evidence?.campaignName || '-'}</dd></div>
                  <div><dt>广告组</dt><dd>{selected.evidence?.adGroupName || '-'}</dd></div>
                  <div><dt>来源批次</dt><dd>{selected.evidence?.batchId || '-'}</dd></div>
                  <div><dt>来源行</dt><dd>{selected.evidence?.sourceRow || '-'}</dd></div>
                  <div><dt>来源文件</dt><dd>{selected.evidence?.sourceFiles?.join('；') || '-'}</dd></div>
                  <div><dt>AI 来源</dt><dd>{selected.evidence?.aiModel || selected.evidence?.aiStrategySource || '-'}</dd></div>
                  <div><dt>规则 / AI 理由</dt><dd>{selected.evidence?.decisionReasons?.join('；') || selected.reason || '-'}</dd></div>
                </dl>
              </div>
            </details>
          </div>
        )}
          </ResponsiveInspector>
        </div>
      </PageFrame>
    </div>
  );
}
