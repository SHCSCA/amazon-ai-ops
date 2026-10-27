import { BusinessDataConfigurationGuard, BusinessDataConfigurationNotice } from '../components/business-data-configuration';
import { ScopeText } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { PageHeader,Panel,StatusPill } from '../components/ui';
import { formatPercent,formatUsd } from '../formatters';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import {
generateAiStatus,
generateAiTone,
generateDecisionDiagnosticLine,
generateFilterReasonLine,
generateStrategyThresholdLine,
optionalMoney,
optionalPercent,
productStageLabel,
} from './recommendation-ai-status';
import type { useRecommendationsPage } from './recommendation-controller';
import { RecommendationDecisionEvidence } from './recommendation-decision-evidence';
import {
recommendationHasEvidenceBlocker
} from './recommendation-evidence';
import {
lifecycleLabel,
recommendationFormalApprovalExplanationText,
recommendationMergeExplanationText,
recommendationMergeSummaryText,
recommendationObject,
recommendationReviewExplanationText,
recommendationSendStatusText,
recommendationType,
riskTone,
thresholdSummary
} from './recommendation-labels';

export function RecommendationsPageView({
  configurationRequired,
  formalApprovalCount,
  recommendations,
  visibleRecommendations,
  manualReviewCount,
  evidenceBlockedCount,
  primaryTaskAction,
  primaryGenerateButton,
  runPrimaryTaskAction,
  directGenerateButton,
  generateRecommendations,
  refreshRecommendationsButton,
  refreshRecommendations,
  navigate,
  bucketItems,
  bucketFilter,
  applyBucketFilter,
  activeBucketLabel,
  visibleFormalApprovalRecommendations,
  batchSelectionState,
  toggleAllFormalSelection,
  selectedVisibleFormalRecommendations,
  submitSelectedToApproval,
  showApprovalSelection,
  visibleFormalApprovalIdSet,
  selectedRecommendationIds,
  toggleRecommendationSelection,
  currentBatchId,
  currentRealReportSourceFiles,
  setSelected,
  compactRecommendationTableColSpan,
  quantReady,
  message,
  data,
  scope,
  realReportCount,
  importedRowCount,
  aiReadiness,
  actionableMetricRows,
  diagnosticCount,
  timelineCount,
  operationEvents,
  productContextCount,
  productWithTargetCount,
  primaryProductContext,
  ruleConfig,
  recommendationGateIssues,
  lastGenerateResult,
  workflowGenerateButton,
  workflowActionState,
  insightOnlyCount,
  insightOnlyReasons,
  aiStrategyCount,
  aiTextCount,
  ruleOnlyCount,
  alignedCount,
  conflictCount,
  aiOnlyCount,
  wasteCount,
  operatorResolutionCount,
  latestOperationEvent,
  totalPendingSpend,
  highRiskCount,
  emptyReason,
  noFormalAiDiagnosis,
  topRecommendation,
  aiParticipatedCount,
  selected,
  selectedDecisionSummary,
  selectedOperationEvents,
}: ReturnType<typeof useRecommendationsPage>) {
  return (
    <div>
      <PageHeader
        eyebrow="广告"
        title={PAGE_HEADER_TITLES.recommendations}
        description="直接查看待处理广告动作，勾选证据完整的建议送审；生成口径、AI 状态和证据细节放在下方辅助区。"
      />
      {configurationRequired && <BusinessDataConfigurationNotice />}

      <div className="business-stack">
        <Panel
          className="recommendation-primary-panel"
          title="待处理建议"
          titleAccessory={(
            <div className="recommendation-title-pills" aria-label="建议池摘要">
              <StatusPill tone={formalApprovalCount > 0 ? 'ready' : recommendations.length ? 'warning' : 'pending'}>
                {visibleRecommendations.length}/{recommendations.length} 条
              </StatusPill>
              <StatusPill tone={formalApprovalCount > 0 ? 'ready' : 'pending'}>可送审 {formalApprovalCount}</StatusPill>
              <StatusPill tone={manualReviewCount > 0 ? 'warning' : 'pending'}>复核 {manualReviewCount}</StatusPill>
              <StatusPill tone={evidenceBlockedCount > 0 ? 'blocked' : 'ready'}>阻断 {evidenceBlockedCount}</StatusPill>
            </div>
          )}
          tone={formalApprovalCount > 0 ? 'success' : recommendations.length ? 'warning' : 'default'}
        >
          <div className="recommendation-primary-head">
            <div>
              <div className="business-scope-line">{configurationRequired ? '当前业务数据尚未读取' : primaryTaskAction.title}</div>
              <p className="muted-line">{configurationRequired ? '新建议生成保持锁定；仍可刷新和查看当前已有建议。' : primaryTaskAction.detail}</p>
            </div>
            <div className="recommendation-primary-actions">
              <button
                aria-busy={primaryTaskAction.action === 'generate' ? primaryGenerateButton.ariaBusy : undefined}
                className={primaryTaskAction.action === 'generate' ? primaryGenerateButton.className : 'primary-button compact-button'}
                disabled={primaryTaskAction.action === 'generate' ? primaryGenerateButton.disabled : primaryTaskAction.disabled}
                onClick={runPrimaryTaskAction}
                type="button"
              >
                {primaryTaskAction.action === 'generate' && primaryGenerateButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                <span>{primaryTaskAction.action === 'generate' ? primaryGenerateButton.label : primaryTaskAction.label}</span>
              </button>
              <details className="product-config-action-menu recommendation-action-menu">
                <summary>更多操作</summary>
                <div className="product-config-list-actions">
                  <button
                    aria-busy={directGenerateButton.ariaBusy}
                    className={directGenerateButton.className}
                    disabled={directGenerateButton.disabled}
                    onClick={generateRecommendations}
                    type="button"
                  >
                    {directGenerateButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{directGenerateButton.label}</span>
                  </button>
                  <button
                    aria-busy={refreshRecommendationsButton.ariaBusy}
                    className={refreshRecommendationsButton.className}
                    disabled={refreshRecommendationsButton.disabled}
                    onClick={refreshRecommendations}
                    type="button"
                  >
                    {refreshRecommendationsButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                    <span>{refreshRecommendationsButton.label}</span>
                  </button>
                  <button className="secondary-button compact-button" onClick={() => navigate('ad-quant')} type="button">
                    回广告表现
                  </button>
                </div>
              </details>
            </div>
          </div>
          <div className="recommendation-workbench-filter" role="group" aria-label="建议池快速筛选">
            {bucketItems.map((item) => (
              <button
                aria-pressed={bucketFilter === item.filter}
                className={`recommendation-filter-chip recommendation-filter-${item.tone}${bucketFilter === item.filter ? ' recommendation-filter-active' : ''}`}
                key={item.filter}
                onClick={() => applyBucketFilter(item.filter)}
                type="button"
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </button>
            ))}
          </div>
          <p className="recommendation-filter-line" aria-live="polite">
            当前视图：{activeBucketLabel[bucketFilter]}，显示 {visibleRecommendations.length}/{recommendations.length} 条；切换视图会清空当前勾选。
          </p>
          {visibleFormalApprovalRecommendations.length > 0 ? (
            <div className={`recommendation-selection-toolbar recommendation-selection-toolbar-${batchSelectionState.tone}`}>
              <div>
                <span>送审准备</span>
                <strong key={batchSelectionState.countLabel} className={batchSelectionState.countClassName}>
                  {batchSelectionState.countLabel}
                </strong>
                <span className="recommendation-selection-live" aria-live="polite">
                  {batchSelectionState.ariaStatus}
                </span>
              </div>
              <div className="action-row">
                <button
                  className="secondary-button compact-button"
                  onClick={toggleAllFormalSelection}
                  type="button"
                >
                  {selectedVisibleFormalRecommendations.length === visibleFormalApprovalRecommendations.length ? '取消全选' : `全选 ${visibleFormalApprovalRecommendations.length}`}
                </button>
                <button
                  className={batchSelectionState.disabled ? 'secondary-button compact-button' : 'primary-button compact-button'}
                  disabled={batchSelectionState.disabled}
                  onClick={submitSelectedToApproval}
                  type="button"
                >
                  {batchSelectionState.actionLabel}
                </button>
              </div>
            </div>
          ) : (
            <div className="recommendation-selection-empty recommendation-selection-strip" role="status" aria-live="polite">
              <span>送审准备</span>
              <strong>暂无可送审动作</strong>
              <p>当前建议需要先补齐证据或人工复核；表格仍可查看每条建议的阻断原因。</p>
            </div>
          )}
          <div className="table-wrap recommendation-workbench-table-wrap">
            <table className="business-table recommendation-table recommendation-workbench-table">
              <thead>
                <tr>
                  {showApprovalSelection && (
                    <th>
                      <input
                        aria-label="全选可审批建议"
                        checked={selectedVisibleFormalRecommendations.length === visibleFormalApprovalRecommendations.length}
                        onChange={toggleAllFormalSelection}
                        type="checkbox"
                      />
                    </th>
                  )}
                  <th>动作</th>
                  <th>广告活动 / 广告组</th>
                  <th>对象</th>
                  <th>当前 {'->'} 建议</th>
                  <th>指标依据</th>
                  <th>证据状态</th>
                  <th>风险</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleRecommendations.map((rec) => {
                  const isFormalApproval = visibleFormalApprovalIdSet.has(String(rec.id));
                  const isSelectedForApproval = showApprovalSelection && selectedRecommendationIds.has(String(rec.id));
                  return (
                    <tr className={isSelectedForApproval ? 'recommendation-row-selected' : ''} key={rec.id}>
                      {showApprovalSelection && (
                        <td className="table-checkbox-cell">
                          {isFormalApproval ? (
                            <input
                              aria-label={`选择建议 ${rec.id}`}
                              checked={isSelectedForApproval}
                              onChange={() => toggleRecommendationSelection(rec)}
                              type="checkbox"
                            />
                          ) : (
                            <span className="table-checkbox-placeholder" aria-hidden="true" />
                          )}
                        </td>
                      )}
                      <td>
                        <strong>{rec.actionType}</strong>
                        <div className="muted-cell">{rec.evidence?.asin || '-'}</div>
                      </td>
                      <td>
                        {rec.evidence?.campaignName || '-'}
                        <div className="muted-cell">{rec.evidence?.adGroupName || '-'}</div>
                      </td>
                      <td>
                        <strong>{recommendationObject(rec)}</strong>
                        <div className="muted-cell">{recommendationType(rec)}</div>
                      </td>
                      <td>{rec.currentValue || '-'} {'->'} {rec.recommendedValue || '-'}</td>
                      <td>
                        <strong>{formatUsd(rec.evidence?.cost ?? rec.cost)}</strong>
                        <div className="muted-cell">
                          ACOS {formatPercent((rec.evidence?.acos ?? rec.acos ?? 0) * 100)} / {rec.evidence?.orders ?? '-'} 单 / {rec.evidence?.clicks ?? rec.clicks} 点击
                        </div>
                      </td>
                      <td>
                        <StatusPill tone={isFormalApproval ? 'ready' : recommendationHasEvidenceBlocker(rec, currentBatchId, currentRealReportSourceFiles) ? 'blocked' : 'warning'}>{isFormalApproval ? '可送审' : recommendationHasEvidenceBlocker(rec, currentBatchId, currentRealReportSourceFiles) ? '缺证据' : '需复核'}</StatusPill>
                        <div className="muted-cell">{recommendationSendStatusText(rec, currentBatchId, currentRealReportSourceFiles)}</div>
                      </td>
                      <td><StatusPill tone={riskTone(rec.riskLevel)}>{rec.riskLevel}</StatusPill></td>
                      <td>
                        <button className="secondary-button compact-button" onClick={() => setSelected(rec)} type="button">
                          详情
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!visibleRecommendations.length && (
                  <tr>
                    <td colSpan={compactRecommendationTableColSpan}>{configurationRequired ? '当前店铺运行配置待创建，当前业务数据尚未读取。' : recommendations.length ? `当前视图“${activeBucketLabel[bucketFilter]}”没有建议。` : quantReady ? '当前范围还没有待审批或需复核建议。' : '缺少真实数据，本页不生成建议。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {message && <p className={message.includes('失败') || message.includes('不能') ? 'blocked-line' : 'muted-line'}>{message}</p>}

        <ProgressiveDetails title="辅助生成口径、AI 状态和证据详情">
        <BusinessDataConfigurationGuard configurationRequired={configurationRequired}>
<Panel title="建议生成范围" tone={quantReady ? 'success' : 'blocked'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">
                真实报表 {realReportCount}/8 类，导入指标 {importedRowCount} 行。
              </p>
            </div>
            <StatusPill tone={quantReady ? 'ready' : 'blocked'}>
              {quantReady ? '可以生成建议' : '缺真实数据，建议生成锁定'}
            </StatusPill>
          </div>
          <div className="business-pill-row">
            <StatusPill tone={aiReadiness.tone}>{aiReadiness.label}</StatusPill>
            <StatusPill tone="pending">{aiReadiness.model || '模型未读取'}</StatusPill>
            <StatusPill tone="pending">{aiReadiness.baseUrl || 'Base URL 未读取'}</StatusPill>
          </div>
          <p className={aiReadiness.status === 'available' ? 'muted-line' : aiReadiness.status === 'failed' ? 'blocked-line' : 'warning-line'}>
            {aiReadiness.message}
          </p>
          <div className="context-summary-grid">
            <div>
              <span>真实广告事实</span>
              <strong>{realReportCount}/8 类真实报表 / {importedRowCount} 行 DB 指标</strong>
              <p>只使用当前范围真实 xlsx/xls/csv 导入后的每日广告事实。</p>
            </div>
            <div>
              <span>可执行口径</span>
              <strong>{actionableMetricRows} 行 / {diagnosticCount} 个诊断对象</strong>
              <p>建议只绑定 keyword、search term、target 等能落到广告对象的行。</p>
            </div>
            <div>
              <span>阶段与运营上下文</span>
              <strong>{timelineCount} 条时间线 / {operationEvents.length} 条运营事件</strong>
              <p>AI 会结合对象生命周期、Coupon、BD、调价、库存和 Listing 变更解释波动。</p>
            </div>
            <div>
              <span>产品配置</span>
              <strong>{productContextCount} 个产品 / {productWithTargetCount} 个有目标阈值</strong>
              <p>
                {primaryProductContext
                  ? `${primaryProductContext.asin} / ${productStageLabel(primaryProductContext.productStage)} / 目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)} / TACOS ${optionalPercent(primaryProductContext.cost?.targetTacos)}`
                  : '未配置产品成本、阶段和目标阈值时，AI 只能按广告表现估算。'}
              </p>
            </div>
            <div>
              <span>规则阈值</span>
              <strong>{thresholdSummary(ruleConfig)}</strong>
              <p>规则先给出可复现候选，AI 再参与阶段判断、动态阈值和异常解释。</p>
            </div>
            <div>
              <span>本次 AI 输入</span>
              <strong>广告事实 + 产品配置 + 运营事件 + 规则阈值 + 广告表现</strong>
              <p>AI 不直接读取审计包，也不会在缺真实数据时用 0 值生成建议。</p>
            </div>
            <div>
              <span>安全边界</span>
              <strong>生成建议池</strong>
              <p>本页不审批、不执行广告、不写入 Amazon；后续必须逐条审批和回读。</p>
            </div>
          </div>
          {!quantReady && recommendationGateIssues.length > 0 && (
            <div className="inline-blocker-list">
              <strong>当前不能生成建议的原因</strong>
              <ul>
                {recommendationGateIssues.slice(0, 6).map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="action-row">
            <button
              aria-busy={refreshRecommendationsButton.ariaBusy}
              className={refreshRecommendationsButton.className}
              disabled={refreshRecommendationsButton.disabled}
              onClick={refreshRecommendations}
              type="button"
            >
              {refreshRecommendationsButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
              <span>{refreshRecommendationsButton.label}</span>
            </button>
          </div>
        </Panel>
</BusinessDataConfigurationGuard>
        </ProgressiveDetails>

        {lastGenerateResult && (
          <ProgressiveDetails title="本次生成 AI 参与状态">
          <Panel title="本次生成 AI 参与状态" tone={generateAiTone(lastGenerateResult)}>
            <div className="context-summary-grid">
              <div>
                <span>AI 状态</span>
                <strong>{generateAiStatus(lastGenerateResult)}</strong>
                <p>{lastGenerateResult.reason}</p>
              </div>
              <div>
                <span>模型</span>
                <strong>{lastGenerateResult.model || '-'}</strong>
                <p>{lastGenerateResult.configured ? '来自当前保存的 DeepSeek/OpenAI Compatible 设置。' : '未配置 Key 时不会伪装成 AI 策略。'}</p>
              </div>
              <div>
                <span>生成结果</span>
                <strong>{lastGenerateResult.generated} 新建议 / {lastGenerateResult.finalActionCount} 可审批动作</strong>
                <p>规则候选 {lastGenerateResult.candidates} 条，AI 候选 {lastGenerateResult.aiCandidateCount} 条，刷新 {lastGenerateResult.refreshed} 条旧建议，跳过 {lastGenerateResult.skipped} 条重复建议。</p>
              </div>
              <div>
                <span>解释来源</span>
                <strong>{lastGenerateResult.aiCount} AI 建议解释 / {lastGenerateResult.ruleCount} 规则解释</strong>
                <p>
                  {lastGenerateResult.strategy?.source === 'ai'
                    ? 'AI 已参与产品阶段诊断和动态阈值；AI 独立洞察和冲突建议只进入人工复核。'
                    : '这里统计建议文本解释来源；AI 不可用时回落到规则解释。'}
                </p>
              </div>
              <div>
                <span>事件上下文</span>
                <strong>{operationEvents.length} 条运营事件</strong>
                <p>{operationEvents.length ? '已进入广告阶段诊断和动态阈值判断。' : '本次生成没有运营事件背景，AI 只看广告数据。'}</p>
              </div>
              <div>
                <span>产品上下文</span>
                <strong>{lastGenerateResult.strategy?.productContextCount ?? productContextCount} 个产品配置</strong>
                <p>
                  {primaryProductContext
                    ? `${primaryProductContext.asin} / ${productStageLabel(primaryProductContext.productStage)} / 目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)}`
                    : '本次没有产品成本和目标阈值，AI 阈值建议缺少利润空间约束。'}
                </p>
              </div>
              <div>
                <span>广告阶段诊断</span>
                <strong>{lifecycleLabel(lastGenerateResult.strategy?.lifecycleStage)} / {lastGenerateResult.strategy?.source === 'ai' ? 'AI' : '规则兜底'}</strong>
                <p>{lastGenerateResult.strategy?.summary || '本次没有返回阶段诊断摘要。'}</p>
              </div>
              <div>
                <span>动态阈值建议</span>
                <strong>{generateStrategyThresholdLine(lastGenerateResult)}</strong>
                <p>
                  AI 候选 {lastGenerateResult.aiCandidateCount} 条，
                  运营事件 {lastGenerateResult.strategy?.operationEventCount ?? 0} 条，
                  产品配置 {lastGenerateResult.strategy?.productContextCount ?? productContextCount} 个进入诊断上下文。
                </p>
              </div>
              <div>
                <span>AI/规则合并诊断</span>
                <strong>{generateDecisionDiagnosticLine(lastGenerateResult)}</strong>
                <p>{generateFilterReasonLine(lastGenerateResult)}</p>
              </div>
            </div>
          </Panel>
          </ProgressiveDetails>
        )}

        <ProgressiveDetails title="完整处理路径与安全边界">
        <Panel title="建议处理路径">
          <div className="workflow-strip">
            <button
              aria-busy={workflowGenerateButton.ariaBusy}
              className={workflowGenerateButton.className}
              onClick={() => generateRecommendations()}
              disabled={workflowGenerateButton.disabled}
              type="button"
            >
              <span>1. 生成解释</span>
              <strong>
                {workflowGenerateButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                <span>{workflowGenerateButton.label}</span>
              </strong>
              <StatusPill tone={quantReady ? 'pending' : 'blocked'}>{configurationRequired ? '业务数据未读取' : quantReady ? '本页完成' : '缺真实数据'}</StatusPill>
            </button>
            <button className="workflow-step" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'approval' }))} disabled={workflowActionState.approvalDisabled} type="button">
              <span>2. 审批决策</span>
              <strong>人工批准或拒绝</strong>
              <StatusPill tone={workflowActionState.approvalDisabled ? 'blocked' : 'pending'}>{workflowActionState.approvalLabel}</StatusPill>
            </button>
            <button className="workflow-step" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'readback' }))} disabled={workflowActionState.readbackDisabled} type="button">
              <span>3. 结果核对</span>
              <strong>记录执行前/执行后/回读</strong>
              <StatusPill tone={workflowActionState.readbackDisabled ? 'blocked' : 'warning'}>{workflowActionState.readbackLabel}</StatusPill>
            </button>
          </div>
          <p className="blocked-line">本页不审批、不执行广告、不写入 Amazon；真实动作必须在审批后逐条记录截图和回读证据。</p>
        </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="建议池分类解释">
        <Panel title="建议决策总览" tone={evidenceBlockedCount > 0 ? 'warning' : 'default'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line">只把证据完整、可绑定当前广告对象的动作送入审批中心。</div>
              <p className="muted-line">
                AI 洞察、证据缺失、对象无法绑定、规则与 AI 冲突的动作不会混进普通审批列表；需要先补数据或人工复核。
              </p>
            </div>
            <StatusPill tone={formalApprovalCount > 0 ? 'ready' : recommendations.length ? 'warning' : 'pending'}>
              {formalApprovalCount > 0 ? '有正式建议' : recommendations.length ? '需复核' : '暂无建议'}
            </StatusPill>
          </div>
          <div className="recommendation-decision-list" role="list" aria-label="建议分类解释">
            <div role="listitem">
              <StatusPill tone={formalApprovalCount > 0 ? 'ready' : 'pending'}>可送审 {formalApprovalCount}</StatusPill>
              <span>{recommendationFormalApprovalExplanationText()}</span>
            </div>
            <div role="listitem">
              <StatusPill tone={manualReviewCount > 0 ? 'warning' : 'pending'}>人工复核 {manualReviewCount}</StatusPill>
              <span>{recommendationReviewExplanationText()}</span>
            </div>
            <div role="listitem">
              <StatusPill tone={insightOnlyCount > 0 ? 'warning' : 'ready'}>AI 洞察未采纳 {insightOnlyCount}</StatusPill>
              <span>缺证据、无法绑定对象或被合并层过滤。</span>
            </div>
            <div role="listitem">
              <StatusPill tone={evidenceBlockedCount > 0 ? 'blocked' : 'ready'}>证据阻断 {evidenceBlockedCount}</StatusPill>
              <span>缺批次、来源文件、当前/建议值或 AI 证据。</span>
            </div>
          </div>
          {insightOnlyReasons.length > 0 && (
            <p className="warning-line">未进入建议池原因：{Array.from(new Set(insightOnlyReasons)).slice(0, 3).join('；')}</p>
          )}
        </Panel>
        </ProgressiveDetails>

        <ProgressiveDetails title="建议上下文检查">
        <BusinessDataConfigurationGuard configurationRequired={configurationRequired}>
<Panel title="建议上下文检查">
          <div className="context-summary-grid">
            <div>
              <span>当前批次</span>
              <strong>{currentBatchId || '-'}</strong>
              <p>建议必须绑定当前真实报表批次；审批时会重新校验。</p>
            </div>
            <div>
              <span>待处理建议</span>
              <strong>{recommendations.length}</strong>
              <p>{aiStrategyCount} 条 AI 策略诊断，{aiTextCount} 条 AI 文本解释，{ruleOnlyCount} 条纯规则兜底。</p>
            </div>
            <div>
              <span>AI/规则合并</span>
              <strong>{recommendationMergeSummaryText({ aligned: alignedCount, conflict: conflictCount, aiOnly: aiOnlyCount })}</strong>
              <p>{recommendationMergeExplanationText()}</p>
            </div>
            <div>
              <span>规则量化</span>
              <strong>{wasteCount} 浪费 / {operatorResolutionCount} 需处理</strong>
              <p>需处理包括人工复核 {manualReviewCount} 条和证据阻断 {evidenceBlockedCount} 条；证据不闭合时不会进入普通审批。</p>
            </div>
            <div>
              <span>运营事件</span>
              <strong>{operationEvents.length} 条进入 AI 上下文</strong>
              <p>{latestOperationEvent ? `${latestOperationEvent.eventDate} / ${latestOperationEvent.title}` : '无事件时 AI 只能参考广告报表。'}</p>
            </div>
            <div>
              <span>产品目标</span>
              <strong>{productContextCount} 个产品配置</strong>
              <p>
                {primaryProductContext
                  ? `${primaryProductContext.asin}：${productStageLabel(primaryProductContext.productStage)}，目标 ACOS ${optionalPercent(primaryProductContext.cost?.targetAcos)}，TACOS ${optionalPercent(primaryProductContext.cost?.targetTacos)}。`
                  : '建议到“产品配置”填写阶段、成本、最低价和目标 ACOS/TACOS。'}
              </p>
            </div>
            <div>
              <span>涉及花费</span>
              <strong>{formatUsd(totalPendingSpend)}</strong>
              <p>金额口径为 USD，仅来自当前范围导入指标。</p>
            </div>
            <div>
              <span>执行边界</span>
              <strong>{highRiskCount} 条需重点复核</strong>
              <p>本页只生成解释，不执行广告动作。</p>
            </div>
          </div>
        </Panel>
</BusinessDataConfigurationGuard>
        </ProgressiveDetails>

        {!recommendations.length && (
          <BusinessDataConfigurationGuard configurationRequired={configurationRequired}>
<Panel title="为什么现在没有建议" tone={emptyReason.tone}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">{emptyReason.title}</div>
                <p className="muted-line">{emptyReason.detail}</p>
                <p className="muted-line">{emptyReason.nextStep}</p>
              </div>
              <div className="business-pill-row business-pill-row-right">
                <StatusPill tone={quantReady ? 'ready' : 'blocked'}>{quantReady ? '真实数据可用' : '缺真实数据'}</StatusPill>
                <StatusPill tone={aiReadiness.tone}>{aiReadiness.label}</StatusPill>
                {lastGenerateResult && (
                  <>
                    <StatusPill tone={lastGenerateResult.candidates > 0 ? 'pending' : 'warning'}>规则候选 {lastGenerateResult.candidates}</StatusPill>
                    <StatusPill tone={lastGenerateResult.aiCandidateCount > 0 ? 'pending' : 'warning'}>AI候选 {lastGenerateResult.aiCandidateCount}</StatusPill>
                    <StatusPill tone={lastGenerateResult.finalActionCount > 0 ? 'ready' : 'warning'}>可审批 {lastGenerateResult.finalActionCount}</StatusPill>
                    <StatusPill tone={lastGenerateResult.refreshed > 0 ? 'ready' : 'pending'}>刷新 {lastGenerateResult.refreshed}</StatusPill>
                    <StatusPill tone={lastGenerateResult.skipped > 0 ? 'warning' : 'pending'}>跳过 {lastGenerateResult.skipped}</StatusPill>
                  </>
                )}
              </div>
            </div>
            {noFormalAiDiagnosis && (
              <div className="evidence-check-panel">
                <h3>AI 诊断已完成，但未形成正式建议</h3>
                <div className="business-scope-line">0 建议原因分布</div>
                <div className="context-summary-grid compact-summary">
                  <div>
                    <span>规则候选</span>
                    <strong>规则候选 {lastGenerateResult?.candidates ?? 0}</strong>
                    <p>{(lastGenerateResult?.candidates ?? 0) > 0 ? '规则产生了候选，但后续合并或去重未形成新增建议。' : '规则阈值没有产生可执行广告动作。'}</p>
                  </div>
                  <div>
                    <span>AI 候选</span>
                    <strong>AI 候选 {lastGenerateResult?.aiCandidateCount ?? 0}</strong>
                    <p>{(lastGenerateResult?.aiCandidateCount ?? 0) > 0 ? 'AI 返回了候选，但需要确认能绑定当前真实广告对象。' : 'AI 没有返回可审批动作候选。'}</p>
                  </div>
                  <div>
                    <span>洞察未采纳</span>
                    <strong>洞察未采纳 {insightOnlyCount}</strong>
                    <p>AI 判断缺少可回查证据或对象绑定时，只作为洞察展示。</p>
                  </div>
                  <div>
                    <span>最终可审批</span>
                    <strong>最终可审批 {lastGenerateResult?.finalActionCount ?? 0}</strong>
                    <p>只有证据完整、可绑定当前广告活动/广告组/对象的动作进入审批。</p>
                  </div>
                </div>
                <div className="business-scope-line">下一步处理顺序</div>
                <ul className="business-list">
                  <li>先回广告表现页查看风险对象和样本量</li>
                  <li>补充运营事件或产品配置后重新生成</li>
                  <li>确认广告活动、广告组、关键词/搜索词/投放对象能绑定真实报表行</li>
                </ul>
                <div className="context-summary-grid">
                  <div>
                    <span>AI 诊断摘要</span>
                    <strong>{lifecycleLabel(lastGenerateResult?.strategy?.lifecycleStage)} / {lastGenerateResult?.strategy?.source === 'ai' ? 'AI' : '规则'}</strong>
                    <p>{noFormalAiDiagnosis.summary}</p>
                  </div>
                  <div>
                    <span>未进入建议池的原因</span>
                    <strong>{noFormalAiDiagnosis.reasons.length} 条阻断说明</strong>
                    {noFormalAiDiagnosis.reasons.slice(0, 3).map((reason) => (
                      <p key={reason}>{reason}</p>
                    ))}
                  </div>
                  <div>
                    <span>下一步补证据</span>
                    <strong>复核量化输入</strong>
                    <p>{noFormalAiDiagnosis.nextStep}</p>
                  </div>
                </div>
                {noFormalAiDiagnosis.insights.length > 0 && (
                  <>
                    <div className="business-scope-line">AI 洞察但未采纳</div>
                    <div className="context-summary-grid compact-summary">
                      {noFormalAiDiagnosis.insights.slice(0, 4).map((insight, index) => (
                        <div key={`${insight.entityName || 'insight'}-${index}`}>
                          <span>{insight.entityType || '对象'} / {insight.actionType || '观察'}</span>
                          <strong>{insight.entityName || '未绑定对象'}</strong>
                          <p>{insight.reason || 'AI 返回了洞察，但没有形成可审批动作。'}</p>
                          {(insight.invalidReasons || []).map((reason) => (
                            <p key={reason}>未采纳：{reason}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="action-row">
              <button
                aria-busy={directGenerateButton.ariaBusy}
                className={directGenerateButton.className}
                disabled={directGenerateButton.disabled}
                onClick={generateRecommendations}
                type="button"
              >
                {directGenerateButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                <span>{directGenerateButton.label}</span>
              </button>
              <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: quantReady ? 'ad-quant' : 'data-collection' }))} type="button">
                {quantReady ? '查看广告表现' : '去数据采集'}
              </button>
            </div>
          </Panel>
</BusinessDataConfigurationGuard>
        )}

        <ProgressiveDetails title="AI + 规则并行决策模型">
        <BusinessDataConfigurationGuard configurationRequired={configurationRequired}>
<Panel title="AI + 规则并行决策模型" tone={quantReady ? 'default' : 'blocked'}>
          <div className="context-summary-grid">
            <div>
              <span>规则引擎</span>
              <strong>硬阈值与安全边界</strong>
              <p>使用目标 ACOS、高风险 ACOS、无订单点击、最低花费和白名单，先产生可解释的规则候选。</p>
            </div>
            <div>
              <span>DeepSeek / AI</span>
              <strong>{aiReadiness.label}</strong>
              <p>{aiReadiness.status === 'available' ? '结合每日广告数据、产品推广阶段和运营事件，判断冷启动、测词、放量、稳定或异常修复。' : aiReadiness.message}</p>
            </div>
            <div>
              <span>合并层</span>
              <strong>{recommendationMergeSummaryText({ aligned: alignedCount, conflict: conflictCount, aiOnly: aiOnlyCount })}</strong>
              <p>规则和 AI 一致才进入普通审批；冲突、AI 独立洞察和样本不足进入人工复核。</p>
            </div>
            <div>
              <span>量化输入</span>
              <strong>{importedRowCount} 行 / {operationEvents.length} 条事件 / {productContextCount} 个产品</strong>
              <p>建议只基于当前范围真实报表、产品配置和运营事件；没有导入指标时不调用 AI 生成建议。</p>
            </div>
            <div>
              <span>利润约束</span>
              <strong>目标 ACOS {optionalPercent(primaryProductContext?.cost?.targetAcos)} / 净利率 {optionalPercent(primaryProductContext?.cost?.targetNetMargin)}</strong>
              <p>{primaryProductContext ? `最低价 ${optionalMoney(primaryProductContext.cost?.minPrice)}，用于约束 AI 动态阈值建议。` : '未维护成本和目标时，建议先到产品配置页补齐。'}</p>
            </div>
          </div>
        </Panel>
</BusinessDataConfigurationGuard>
        </ProgressiveDetails>

        <ProgressiveDetails title="判断标准、阈值和优先级">
        <Panel title="建议优先级与判断标准" tone={recommendations.length ? 'warning' : 'default'}>
          <div className="business-split">
            <div>
              <div className="business-scope-line">
                {topRecommendation ? `${topRecommendation.actionType} / ${recommendationObject(topRecommendation)}` : '当前范围暂无待处理建议'}
              </div>
              <p className="muted-line">
                {topRecommendation
                  ? `优先按风险等级和涉及花费排序：${formatUsd(topRecommendation.evidence?.cost ?? topRecommendation.cost)} / ACOS ${formatPercent((topRecommendation.evidence?.acos ?? topRecommendation.acos ?? 0) * 100)}。`
                  : '生成建议前先确认真实报表、导入指标和量化口径。'}
              </p>
              <p className="muted-line">规则阈值：{thresholdSummary(ruleConfig)}</p>
            </div>
            <div className="business-pill-row business-pill-row-right">
              <StatusPill tone={highRiskCount > 0 ? 'warning' : 'pending'}>高风险 {highRiskCount}</StatusPill>
              <StatusPill tone={conflictCount > 0 ? 'blocked' : alignedCount > 0 ? 'ready' : 'pending'}>AI/规则一致 {alignedCount}</StatusPill>
              <StatusPill tone={operatorResolutionCount > 0 ? 'warning' : 'pending'}>需处理 {operatorResolutionCount}</StatusPill>
              <StatusPill tone={aiParticipatedCount > 0 ? 'ready' : 'pending'}>AI参与 {aiParticipatedCount}</StatusPill>
              <StatusPill tone={aiTextCount > 0 ? 'ready' : 'pending'}>AI解释 {aiTextCount}</StatusPill>
              <StatusPill tone={recommendations.length > 0 ? 'ready' : 'pending'}>待处理 {recommendations.length}</StatusPill>
            </div>
          </div>
          <div className="action-row">
            <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'settings' }))} type="button">
              调整规则阈值
            </button>
            <button className="secondary-button" onClick={() => window.dispatchEvent(new CustomEvent('amazon-ai-ops:navigate', { detail: 'approval' }))} disabled={workflowActionState.approvalDisabled} type="button">
              {workflowActionState.approvalLabel}
            </button>
          </div>
        </Panel>
        </ProgressiveDetails>

        {selected && (
          <RecommendationDecisionEvidence selected={selected} currentBatchId={currentBatchId} currentRealReportSourceFiles={currentRealReportSourceFiles} selectedDecisionSummary={selectedDecisionSummary} data={data} scope={scope} ruleConfig={ruleConfig} selectedOperationEvents={selectedOperationEvents} />
        )}
      </div>
    </div>
  );
}
