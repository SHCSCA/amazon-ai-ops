import { ScopeText } from '../components/business-data';
import { ProgressiveDetails } from '../components/progressive-details';
import { Panel,StatusPill } from '../components/ui';
import { formatEvidenceRefSummary } from '../evidence-display';
import { formatPercent,formatUsd } from '../formatters';
import type { RecommendationView } from '../types';
import {
optionalMoney,
optionalPercent,
productStageLabel,
} from './recommendation-ai-status';
import type { useRecommendationsPage } from './recommendation-controller';
import {
evidenceAdObjectLine,
evidenceBatch,
evidenceContextLine,
evidenceEventLine,
evidenceMetricLine,
evidenceProductLine,
evidenceSourceFiles,
evidenceSufficiencyLabel,
evidenceSufficiencyTone,
evidenceTimelineDailyLine,
evidenceTimelineLine,
evidenceTypeLabel,
recommendationEvidenceIssues,
} from './recommendation-evidence';
import {
decisionLabel,
lifecycleLabel,
operationEventTypeLabel,
quantLabel,
recommendationObject,
recommendationSendStatusText,
recommendationType,
ruleQuantThresholdSummary,
sourceLabel,
strategyLabel,
thresholdSuggestionSummary,
thresholdSummary,
} from './recommendation-labels';

type RecommendationDecisionEvidenceProps = Pick<ReturnType<typeof useRecommendationsPage>, 'selected' | 'currentBatchId' | 'currentRealReportSourceFiles' | 'selectedDecisionSummary' | 'data' | 'scope' | 'ruleConfig' | 'selectedOperationEvents'> & { selected: RecommendationView };

export function RecommendationDecisionEvidence({ selected, currentBatchId, currentRealReportSourceFiles, selectedDecisionSummary, data, scope, ruleConfig, selectedOperationEvents }: RecommendationDecisionEvidenceProps) {
  return <Panel title="送审判断">
            {(() => {
              const issues = recommendationEvidenceIssues(selected, currentBatchId, currentRealReportSourceFiles);
              const sourceBatchId = selected.evidence?.batchId || '-';
              const batchMatched = Boolean(selected.evidence?.batchId && currentBatchId && selected.evidence.batchId === currentBatchId);
              return (
                <div className="evidence-check-panel">
                  <div className="business-split">
                    <div>
                      <h3>{issues.length ? '暂不能送审' : '可以送到审批中心'}</h3>
                      <p className={issues.length ? 'blocked-line' : 'muted-line'}>
                        {issues.length
                          ? `送审前需要补齐：${issues.join('、')}。`
                          : `动作、对象、当前值、建议值和真实报表来源已绑定；审批中心仍会逐条重新校验。`}
                      </p>
                    </div>
                    <StatusPill tone={issues.length ? 'blocked' : 'ready'}>
                      {issues.length ? `缺 ${issues.length} 项` : '证据完整'}
                    </StatusPill>
                  </div>
                  <div className="context-summary-grid compact-summary">
                    <div>
                      <span>建议动作</span>
                      <strong>{selected.actionType}</strong>
                      <p>{selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</p>
                    </div>
                    <div>
                      <span>广告对象</span>
                      <strong>{recommendationObject(selected)}</strong>
                      <p>{selected.evidence?.campaignName || '-'} / {selected.evidence?.adGroupName || '-'} / {selected.evidence?.asin || '-'}</p>
                    </div>
                    <div>
                      <span>为什么建议</span>
                      <strong>{formatUsd(selected.evidence?.cost ?? selected.cost)} / ACOS {formatPercent((selected.evidence?.acos ?? selected.acos ?? 0) * 100)}</strong>
                      <p>{selected.evidence?.orders ?? '-'} 单 / {selected.evidence?.clicks ?? selected.clicks} 点击 / {recommendationSendStatusText(selected, currentBatchId, currentRealReportSourceFiles)}</p>
                    </div>
                    <div>
                      <span>风险和证据</span>
                      <strong>{selected.riskLevel || '待判断'}</strong>
                      <p>来源批次 {sourceBatchId}；{batchMatched ? '匹配当前范围' : '需核对当前范围'}；来源文件 {evidenceSourceFiles(selected).length} 个。</p>
                    </div>
                  </div>
                </div>
              );
            })()}
            <ProgressiveDetails title="AI/规则、阈值、来源行和引用证据">
            <div className="evidence-check-panel">
              <div className="business-split">
                <div>
                  <h3>AI/规则决策摘要</h3>
                  <p className="muted-line">{selectedDecisionSummary.headline}</p>
                </div>
                <StatusPill tone={selectedDecisionSummary.tone}>{selectedDecisionSummary.statusLabel}</StatusPill>
              </div>
              {selectedDecisionSummary.reasons.length > 0 && (
                <ul className="business-list">
                  {selectedDecisionSummary.reasons.slice(0, 3).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
              <div className="context-summary-grid">
                <div>
                  <span>引用证据</span>
                  <strong>{selected.evidence?.aiEvidenceRefs?.length || 0} 条</strong>
                  <p>{selectedDecisionSummary.evidenceSummary}</p>
                </div>
                <div>
                  <span>下一步</span>
                  <strong>{selectedDecisionSummary.nextAction}</strong>
                  <p>正式动作仍需要人工审批、真实广告后台操作和结果核对。</p>
                </div>
              </div>
              {selectedDecisionSummary.riskWarnings.length > 0 && (
                <p className="blocked-line">风险：{selectedDecisionSummary.riskWarnings.join('；')}</p>
              )}
            </div>
            <div className="detail-grid">
              <div><span>数据范围</span><strong><ScopeText scope={data?.scope || scope} /></strong></div>
              <div><span>数据批次</span><strong>{evidenceBatch(selected, currentBatchId)}</strong></div>
              <div><span>当前值</span><strong>{selected.currentValue || '-'}</strong></div>
              <div><span>建议值</span><strong>{selected.recommendedValue || '-'}</strong></div>
              <div><span>广告组合</span><strong>{selected.evidence?.portfolioName || '-'}</strong></div>
              <div><span>广告活动</span><strong>{selected.evidence?.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{selected.evidence?.adGroupName || '-'}</strong></div>
              <div><span>产品/ASIN</span><strong>{selected.evidence?.asin || '-'}</strong></div>
              <div><span>对象类型</span><strong>{recommendationType(selected)}</strong></div>
              <div><span>对象</span><strong>{recommendationObject(selected)}</strong></div>
              <div><span>指标日期</span><strong>{selected.evidence?.date || '-'}</strong></div>
              <div><span>来源行号</span><strong>{selected.evidence?.sourceRow ?? '-'}</strong></div>
              <div><span>当前指标</span><strong>{formatUsd(selected.evidence?.cost ?? selected.cost)} / {selected.evidence?.clicks ?? selected.clicks} clicks / {selected.evidence?.orders ?? '-'} orders</strong></div>
              <div><span>销售额</span><strong>{formatUsd(selected.evidence?.sales ?? 0)} / ACOS {formatPercent((selected.evidence?.acos ?? selected.acos ?? 0) * 100)}</strong></div>
              <div><span>推荐动作</span><strong>{selected.actionType} {selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</strong></div>
              <div><span>解释来源</span><strong>{sourceLabel(selected)}{selected.evidence?.aiModel ? ` / ${selected.evidence.aiModel}` : ''}</strong></div>
              <div><span>策略诊断</span><strong>{strategyLabel(selected)} / {lifecycleLabel(selected.evidence?.aiLifecycleStage)}</strong></div>
              <div><span>AI 证据充分性</span><strong>{evidenceSufficiencyLabel(selected.evidence?.aiEvidenceSufficiency?.level)}</strong></div>
              <div><span>AI 动态阈值</span><strong>{thresholdSuggestionSummary(selected)}</strong></div>
              <div><span>规则量化</span><strong>{quantLabel(selected.evidence?.quantStatus)} / {lifecycleLabel(selected.evidence?.quantLifecycleStage)}</strong></div>
              <div><span>规则阈值</span><strong>{ruleQuantThresholdSummary(selected)}</strong></div>
              <div><span>复核原因</span><strong>{recommendationSendStatusText(selected, currentBatchId, currentRealReportSourceFiles)}</strong></div>
              <div><span>AI/规则合并</span><strong>{decisionLabel(selected)}{selected.evidence?.decisionRequiresReview ? ' / 需人工复核' : ''}</strong></div>
              <div><span>运营事件</span><strong>{selected.evidence?.operationEventCount ?? 0} 条进入诊断上下文</strong></div>
              <div><span>产品配置</span><strong>{selected.evidence?.productContextCount ?? 0} 个进入诊断上下文</strong></div>
              <div><span>产品阶段</span><strong>{productStageLabel(selected.evidence?.productStage)}</strong></div>
              <div><span>产品目标 ACOS / TACOS</span><strong>{optionalPercent(selected.evidence?.productTargetAcos)} / {optionalPercent(selected.evidence?.productTargetTacos)}</strong></div>
              <div><span>目标净利率 / 最低价</span><strong>{optionalPercent(selected.evidence?.productTargetNetMargin)} / {optionalMoney(selected.evidence?.productMinPrice)}</strong></div>
              <div><span>规则阈值</span><strong>{thresholdSummary(ruleConfig)}</strong></div>
              <div><span>执行边界</span><strong>只解释和送审，不执行广告动作</strong></div>
            </div>
            {selected.evidence?.aiStrategySummary && (
              <div className="evidence-check-panel">
                <h3>AI 策略诊断</h3>
                <p className="muted-line">{selected.evidence.aiStrategySummary}</p>
                {selected.evidence.aiStrategyFallbackReason && (
                  <p className="blocked-line">策略诊断兜底：{selected.evidence.aiStrategyFallbackReason}</p>
                )}
                {selected.evidence.aiLifecycleStageReason && (
                  <p className="muted-line">
                    阶段判断：{lifecycleLabel(selected.evidence.aiLifecycleStage)}。{selected.evidence.aiLifecycleStageReason}
                  </p>
                )}
                <p className="muted-line">动态阈值：{thresholdSuggestionSummary(selected)}</p>
                {selected.evidence.aiEvidenceSufficiency && (
                  <div className="business-pill-row">
                    <StatusPill tone={evidenceSufficiencyTone(selected.evidence.aiEvidenceSufficiency.level)}>{evidenceSufficiencyLabel(selected.evidence.aiEvidenceSufficiency.level)}</StatusPill>
                    <StatusPill tone={selected.evidence.aiEvidenceSufficiency.canUseForFormalActions ? 'ready' : 'blocked'}>{selected.evidence.aiEvidenceSufficiency.canUseForFormalActions ? '允许正式建议' : '仅洞察'}</StatusPill>
                    <StatusPill tone="pending">{selected.evidence.aiEvidenceSufficiency.sampleDays} 天</StatusPill>
                    <StatusPill tone="pending">{selected.evidence.aiEvidenceSufficiency.totalClicks} 点击</StatusPill>
                    <StatusPill tone="pending">{formatUsd(selected.evidence.aiEvidenceSufficiency.totalCost)}</StatusPill>
                  </div>
                )}
                {Boolean(selected.evidence.aiEvidenceSufficiency?.blockers?.length) && (
                  <p className="blocked-line">{selected.evidence.aiEvidenceSufficiency?.blockers.join('；')}</p>
                )}
                {Boolean(selected.evidence.aiMainProblems?.length) && (
                  <div className="business-pill-row">
                    {selected.evidence.aiMainProblems?.map((problem) => (
                      <StatusPill key={problem} tone="pending">{problem}</StatusPill>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(selected.evidence?.aiReasoningSteps?.length || selected.evidence?.aiEvidenceRefs?.length || selected.evidence?.aiLifecycleStageEvidenceRefs?.length) ? (
              <div className="evidence-check-panel">
                <h3>AI 判断依据</h3>
                {Boolean(selected.evidence?.aiReasoningSteps?.length) && (
                  <ul className="business-list">
                    {selected.evidence?.aiReasoningSteps?.slice(0, 5).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                )}
                <div className="context-summary-grid">
                  <div>
                    <span>动作引用证据</span>
                    <strong>{selected.evidence?.aiEvidenceRefs?.length || 0} 条</strong>
                    <p>{formatEvidenceRefSummary(selected.evidence?.aiEvidenceRefs, selected.evidence?.aiEvidenceDetails)}</p>
                  </div>
                  <div>
                    <span>阶段引用证据</span>
                    <strong>{selected.evidence?.aiLifecycleStageEvidenceRefs?.length || 0} 条</strong>
                    <p>{formatEvidenceRefSummary(selected.evidence?.aiLifecycleStageEvidenceRefs, selected.evidence?.aiLifecycleStageEvidenceDetails)}</p>
                  </div>
                  <div>
                    <span>证据来源</span>
                    <strong>报表 + 运营事件 + 产品配置</strong>
                    <p>报表文件、来源行、广告活动、广告组和对象指标见上方明细；运营事件和产品目标见下方关联区。</p>
                  </div>
                </div>
                {Boolean(selected.evidence?.aiEvidenceDetails?.length || selected.evidence?.aiLifecycleStageEvidenceDetails?.length) && (
                  <div className="evidence-check-panel">
                    <h3>引用证据详情</h3>
                    <div className="context-summary-grid">
                      {[
                        ...(selected.evidence?.aiEvidenceDetails || []),
                        ...(selected.evidence?.aiLifecycleStageEvidenceDetails || []),
                      ].filter((item, index, all) => all.findIndex((other) => other.evidenceId === item.evidenceId) === index).slice(0, 6).map((item) => (
                        <div key={item.evidenceId}>
                          <span>{evidenceTypeLabel(item.type)}</span>
                          <strong>{item.label}</strong>
                          <p>{evidenceContextLine(item)}</p>
                          <p>{evidenceAdObjectLine(item)}</p>
                          {item.metrics && <p>{evidenceMetricLine(item)}</p>}
                          {item.event && <p>{evidenceEventLine(item)}</p>}
                          {item.product && <p>{evidenceProductLine(item)}</p>}
                          {item.timeline && <p>{evidenceTimelineLine(item)}</p>}
                          {item.timeline?.recentDaily?.length ? <p className="muted-line">最近日级：{evidenceTimelineDailyLine(item)}</p> : null}
                          {item.sourceFile && <code title={item.sourceFile}>{item.sourceFile}</code>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <div className="evidence-check-panel">
              <h3>关联运营事件</h3>
              {selectedOperationEvents.length > 0 ? (
                <div className="context-summary-grid">
                  {selectedOperationEvents.map((event) => (
                    <div key={event.id}>
                      <span>{event.eventDate} / {operationEventTypeLabel(event.eventType)}</span>
                      <strong>{event.title}</strong>
                      <p>{event.impactExpectation || '影响待观察'} / {event.asin || event.campaignName || '当前范围'}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-line">
                  {selected.evidence?.operationEventCount
                    ? `${selected.evidence.operationEventCount} 条运营事件进入了整体诊断，但没有精确绑定到当前建议对象。`
                    : '当前建议没有关联运营事件，AI 和规则只参考广告数据。'}
                </p>
              )}
            </div>
            {Boolean(selected.evidence?.quantReasons?.length) && (
              <div className="evidence-check-panel">
                <h3>规则量化依据</h3>
                <p className="muted-line">{ruleQuantThresholdSummary(selected)}</p>
                <ul className="business-list">
                  {selected.evidence?.quantReasons?.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}
            <p className="muted-line">{selected.evidence?.aiExplanation || selected.reason}</p>
            {selected.evidence?.aiActionFallbackReason && <p className="blocked-line">单条解释兜底：{selected.evidence.aiActionFallbackReason}</p>}
            {Boolean(selected.evidence?.decisionReasons?.length) && (
              <ul className="business-list">
                {selected.evidence?.decisionReasons?.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
            {Boolean(selected.evidence?.decisionRiskWarnings?.length) && (
              <ul className="business-list">
                {selected.evidence?.decisionRiskWarnings?.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            {Boolean(evidenceSourceFiles(selected).length) && (
              <div className="source-file-list">
                <span>来源文件</span>
                {evidenceSourceFiles(selected).map((file) => (
                  <code key={file} title={file}>{file}</code>
                ))}
              </div>
            )}
            {Boolean(selected.evidence?.aiRiskWarnings?.length) && (
              <ul className="business-list">
                {selected.evidence?.aiRiskWarnings?.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            </ProgressiveDetails>
          </Panel>;
}
