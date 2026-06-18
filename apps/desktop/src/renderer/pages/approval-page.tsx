import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { buildDecisionEvidenceSummary, formatEvidenceRefSummary } from '../evidence-display';
import { formatPercent, formatUsd } from '../formatters';
import type { AiEvidenceDisplayItemView, RecommendationView } from '../types';
import { toUserFacingError } from '../user-facing-error';

type ApprovalTab = 'pending' | 'needs_review' | 'approved' | 'rejected';

const TAB_LABELS: Record<ApprovalTab, string> = {
  pending: '待审批',
  needs_review: '复核队列',
  approved: '已批准待执行',
  rejected: '已拒绝',
};

function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

function objectName(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '-';
}

function sourceFiles(rec: RecommendationView): string {
  return rec.evidence?.sourceFiles?.length ? rec.evidence.sourceFiles.join(', ') : '-';
}

function isRealReportSourceFile(filePath: unknown): boolean {
  return /\.(xlsx|xls|csv)$/i.test(String(filePath || '').trim().split(/[?#]/)[0]);
}

function normalizeSourceFile(filePath: unknown): string {
  return String(filePath || '').trim().replace(/\\/g, '/').toLowerCase();
}

function parseExecutableNumber(value: unknown): number | undefined {
  const text = String(value || '').trim();
  if (!text || /[%％]/.test(text)) return undefined;
  const parsed = Number(text.replace(/^\$/, '').replace(/\s*usd$/i, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function approvalMissing(
  rec: RecommendationView | null,
  scope: { storeName: string; marketplaceCode: string },
  currentBatchId?: string,
  allowedSourceFiles?: string[],
): string[] {
  if (!rec) return [];
  const missing: string[] = [];
  const requireValue = (value: unknown, label: string) => {
    const text = String(value || '').trim();
    if (!text || text === '-') missing.push(label);
  };
  const requirePositiveNumber = (value: unknown, label: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) missing.push(label);
  };
  requireValue(scope.storeName, '店铺');
  requireValue(scope.marketplaceCode, '站点');
  requireValue(currentBatchId, '当前批次');
  requireValue(rec.evidence?.asin, 'ASIN');
  requireValue(rec.evidence?.batchId, '来源批次');
  if (rec.evidence?.batchId && currentBatchId && rec.evidence.batchId !== currentBatchId) missing.push('来源批次不一致');
  requireValue(rec.evidence?.date, '指标日期');
  const recommendationSourceFiles = rec.evidence?.sourceFiles || [];
  if (!recommendationSourceFiles.length) missing.push('来源文件');
  if (recommendationSourceFiles.length && !recommendationSourceFiles.every(isRealReportSourceFile)) missing.push('真实来源报表');
  if (recommendationSourceFiles.length && Array.isArray(allowedSourceFiles) && allowedSourceFiles.length === 0) {
    missing.push('当前批次真实报表文件未加载');
  }
  if (recommendationSourceFiles.length && Array.isArray(allowedSourceFiles) && allowedSourceFiles.length > 0) {
    const allowed = new Set(allowedSourceFiles.map(normalizeSourceFile));
    const allSourcesCurrent = recommendationSourceFiles.every((file) => allowed.has(normalizeSourceFile(file)));
    if (!allSourcesCurrent) missing.push('来源文件不属于当前数据批次真实报表');
  }
  requirePositiveNumber(rec.evidence?.sourceRow, '来源行号');
  requireValue(rec.evidence?.campaignName, '广告活动');
  requireValue(rec.evidence?.adGroupName, '广告组');
  requireValue(rec.entityType || rec.evidence?.matchType, '对象类型');
  requireValue(objectName(rec), '对象');
  requireValue(rec.actionType, '动作');
  requireValue(rec.currentValue, '当前值');
  requireValue(rec.recommendedValue, '建议值');
  return missing;
}

function riskRequiresDedicatedReview(riskLevel?: string): boolean {
  const normalized = String(riskLevel || '').trim().toLowerCase();
  return normalized === 'forbidden' || normalized === 'high' || normalized.includes('forbidden');
}

export function approvalBlockers(rec: RecommendationView | null): string[] {
  if (!rec) return [];
  const blockers: string[] = [];
  const agreement = rec.evidence?.decisionAgreement;
  const aiActionParticipated = agreement === 'aligned' || agreement === 'ai_only';
  blockers.push(...approvalValueBlockers(rec));
  if (rec.status === 'needs_review') blockers.push('建议已进入复核队列');
  if (agreement === 'ai_only') blockers.push('AI 独立洞察不能直接批准');
  if (agreement === 'conflict') blockers.push('AI 与规则冲突');
  if (rec.evidence?.aiInsightOnly === true) blockers.push('该建议缺少 AI 可回查证据，仅作为洞察展示，不能审批');
  if (rec.evidence?.aiStrategySource === 'ai' && aiActionParticipated && !rec.evidence?.aiEvidenceRefs?.length) blockers.push('AI 建议缺少可回查证据引用');
  if (rec.evidence?.aiStrategySource === 'ai' && aiActionParticipated && rec.evidence?.aiEvidenceRefs?.length) {
    const details = Array.isArray(rec.evidence.aiEvidenceDetails) ? rec.evidence.aiEvidenceDetails : [];
    const detailIds = new Set(details.map((detail) => String(detail?.evidenceId || '').trim()).filter(Boolean));
    const allRefsResolved = rec.evidence.aiEvidenceRefs.every((ref) => detailIds.has(String(ref || '').trim()));
    if (!details.length || !allRefsResolved) blockers.push('AI 建议缺少可展示的证据详情');
  }
  if (rec.evidence?.decisionRequiresReview === true) blockers.push('AI/规则合并标记需复核');
  if (aiActionParticipated && rec.evidence?.aiLifecycleStageRequiresReview === true) {
    blockers.push('AI 阶段判断需要人工复核');
    blockers.push(...(rec.evidence.aiLifecycleStageInvalidReasons || []).filter(Boolean));
  }
  if (rec.evidence?.quantReviewRequired === true) blockers.push('规则量化要求人工复核');
  if (riskRequiresDedicatedReview(rec.riskLevel)) blockers.push('高风险或禁止执行风险等级');
  return blockers;
}

export function approvalSubmitBlockers(
  rec: RecommendationView | null,
  scope: { storeName: string; marketplaceCode: string },
  currentBatchId?: string,
  allowedSourceFiles?: string[],
): string[] {
  if (!rec) return ['未选择建议'];
  return Array.from(new Set([
    ...approvalMissing(rec, scope, currentBatchId, allowedSourceFiles),
    ...approvalBlockers(rec),
  ]));
}

export function buildApprovalDecisionPayload(input: {
  decision: 'approved' | 'rejected';
  approverName: string;
  approvalNote: string;
  currentBatchId?: string;
  selected: RecommendationView | null;
  scope: {
    dateFrom?: string;
    dateTo?: string;
    storeName?: string;
    marketplaceCode?: string;
    asin?: string;
  };
}) {
  const { decision, selected, scope } = input;
  return {
    decision,
    approvedBy: decision === 'approved' ? input.approverName.trim() : undefined,
    rejectedBy: decision === 'rejected' ? input.approverName.trim() || undefined : undefined,
    decidedAt: new Date().toISOString(),
    note: input.approvalNote.trim(),
    batchId: input.currentBatchId,
    recommendationId: selected?.id,
    actionType: selected?.actionType,
    portfolioName: selected?.evidence?.portfolioName,
    campaignName: selected?.evidence?.campaignName,
    adGroupName: selected?.evidence?.adGroupName,
    asin: selected?.evidence?.asin,
    entityType: selected?.entityType || selected?.evidence?.matchType,
    entityName: selected ? objectName(selected) : '',
    currentValue: selected?.currentValue,
    recommendedValue: selected?.recommendedValue,
    sourceBatchId: selected?.evidence?.batchId,
    metricDate: selected?.evidence?.date,
    sourceRow: selected?.evidence?.sourceRow,
    sourceFiles: selected?.evidence?.sourceFiles || [],
    explanationSource: selected?.evidence?.explanationSource,
    aiModel: selected?.evidence?.aiModel,
    aiStrategySource: selected?.evidence?.aiStrategySource,
    aiLifecycleStage: selected?.evidence?.aiLifecycleStage,
    aiStrategySummary: selected?.evidence?.aiStrategySummary,
    aiStrategyFallbackReason: selected?.evidence?.aiStrategyFallbackReason,
    aiActionFallbackReason: selected?.evidence?.aiActionFallbackReason,
    aiThresholdSuggestions: selected?.evidence?.aiThresholdSuggestions,
    productContextCount: selected?.evidence?.productContextCount,
    productStage: selected?.evidence?.productStage,
    productTargetAcos: selected?.evidence?.productTargetAcos,
    productTargetTacos: selected?.evidence?.productTargetTacos,
    productTargetNetMargin: selected?.evidence?.productTargetNetMargin,
    productMinPrice: selected?.evidence?.productMinPrice,
    decisionAgreement: selected?.evidence?.decisionAgreement,
    decisionSource: selected?.evidence?.decisionSource,
    decisionReasons: selected?.evidence?.decisionReasons || [],
    decisionRiskWarnings: selected?.evidence?.decisionRiskWarnings || [],
    quantReasons: selected?.evidence?.quantReasons || [],
    quantThresholds: selected?.evidence?.quantThresholds,
    scope: {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      storeName: scope.storeName,
      marketplaceCode: scope.marketplaceCode,
      asin: scope.asin,
    },
  };
}

function approvalValueBlockers(rec: RecommendationView): string[] {
  const action = String(rec.actionType || '').trim();
  const currentValue = parseExecutableNumber(rec.currentValue);
  const recommendedValue = parseExecutableNumber(rec.recommendedValue);

  if (action === 'lower_bid' || action === 'raise_bid') {
    if (recommendedValue === undefined) return ['出价建议值必须是可执行的正数金额'];
    if (currentValue === undefined) return ['当前出价必须是可回查的正数金额'];
    if (action === 'lower_bid' && recommendedValue >= currentValue) return ['降价动作的建议出价必须低于当前出价'];
    if (action === 'raise_bid' && recommendedValue <= currentValue) return ['提价动作的建议出价必须高于当前出价'];
  }

  if (action === 'adjust_campaign_budget' && recommendedValue === undefined) {
    return ['预算建议值必须是可执行的正数金额'];
  }

  return [];
}

function quantSummary(rec: RecommendationView): string {
  const status = rec.evidence?.quantStatus || '未量化';
  const stage = rec.evidence?.quantLifecycleStage || '未知阶段';
  const severity = rec.evidence?.quantSeverity || '未知风险';
  return `${status} / ${stage} / ${severity}`;
}

function decisionLabel(rec: RecommendationView): string {
  const labels: Record<string, string> = {
    aligned: '规则+AI 一致',
    conflict: '规则/AI 冲突',
    ai_only: 'AI 独立洞察',
    rule_only: '规则独立建议',
  };
  return labels[String(rec.evidence?.decisionAgreement || 'rule_only')] || String(rec.evidence?.decisionAgreement || '规则独立建议');
}

export function strategyLabel(rec: RecommendationView): string {
  if (rec.evidence?.aiStrategySource === 'ai') return 'AI 阶段诊断';
  if (rec.evidence?.aiStrategySource === 'rule') return '规则策略兜底';
  return '未诊断';
}

function thresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.quantThresholds;
  if (!thresholds) return '暂无规则量化阈值';
  return [
    `目标 ACOS ${formatPercent(Number(thresholds.targetAcos || 0) * 100)}`,
    `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(thresholds.minSpend)}`,
  ].join(' / ');
}

function aiThresholdReviewSuffix(thresholds: NonNullable<RecommendationView['evidence']>['aiThresholdSuggestions']): string {
  const reviewReasons = Object.values(thresholds || {})
    .filter((item) => item?.requiresReview)
    .flatMap((item) => item.reviewReasons?.length ? item.reviewReasons : ['AI 动态阈值需要人工复核。']);
  return reviewReasons.length ? ` / 需复核：${Array.from(new Set(reviewReasons)).slice(0, 2).join('；')}` : '';
}

export function aiThresholdSummary(rec: RecommendationView): string {
  const thresholds = rec.evidence?.aiThresholdSuggestions;
  if (!thresholds) return '暂无 AI 动态阈值';
  const parts = [
    thresholds.targetAcos ? `目标 ACOS ${formatPercent(Number(thresholds.targetAcos.value) * 100)}` : '',
    thresholds.highAcosThreshold ? `高 ACOS ${formatPercent(Number(thresholds.highAcosThreshold.value) * 100)}` : '',
    thresholds.noOrderClickThreshold ? `无订单 ${Number(thresholds.noOrderClickThreshold.value)} 点击` : '',
    thresholds.minSpend ? `最低花费 ${formatUsd(Number(thresholds.minSpend.value))}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' / ')}${aiThresholdReviewSuffix(thresholds)}` : '暂无 AI 动态阈值';
}

function compactList(values?: string[]): string {
  return values?.length ? values.join('；') : '无';
}

function optionalPercent(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? formatPercent(numeric * 100) : '-';
}

function optionalMoney(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? formatUsd(numeric) : '-';
}

function evidenceTypeLabel(type?: string): string {
  const labels: Record<string, string> = {
    metric: '报表指标',
    timeline: '时间线',
    operation_event: '运营事件',
    product_context: '产品配置',
    rule_candidate: '规则候选',
  };
  return labels[String(type || '')] || String(type || '未知证据');
}

function evidenceMetricLine(item: AiEvidenceDisplayItemView): string {
  if (!item.metrics) return '无指标值';
  return [
    `${formatUsd(item.metrics.cost || 0)} / ${formatUsd(item.metrics.sales || 0)}`,
    `${Number(item.metrics.orders || 0)} 单`,
    `${Number(item.metrics.clicks || 0)} 点击`,
    `ACOS ${formatPercent(Number(item.metrics.acos || 0) * 100)}`,
  ].join(' / ');
}

function evidenceContextLine(item: AiEvidenceDisplayItemView): string {
  return [
    item.batchId ? `批次 ${item.batchId}` : '',
    item.reportType ? `报表 ${item.reportType}` : '',
    item.dateRange ? `日期 ${item.dateRange}` : '',
    item.sourceRow ? `行 ${item.sourceRow}` : '',
  ].filter(Boolean).join(' / ') || '无来源上下文';
}

function productStageLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '关键词探索',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    clearance: '清货',
    declining_repair: '衰退修复',
    launch: '新品启动',
    growth: '增长期',
    stabilize: '稳定期',
    harvest: '利润收割',
  };
  return labels[String(stage || '')] || String(stage || '未配置');
}

export function ApprovalPage() {
  const { data, scope } = useBusinessDataPipeline();
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [rows, setRows] = useState<RecommendationView[]>([]);
  const [selected, setSelected] = useState<RecommendationView | null>(null);
  const [approverName, setApproverName] = useState('');
  const [approvalNote, setApprovalNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const currentRealReportSourceFiles = useMemo(
    () => (data?.collection.realReportFiles || []).map((file) => file.filePath).filter(Boolean),
    [data?.collection.realReportFiles],
  );
  const selectedMissing = useMemo(
    () => approvalMissing(selected, scope, currentBatchId, currentRealReportSourceFiles),
    [currentBatchId, currentRealReportSourceFiles, scope.marketplaceCode, scope.storeName, selected],
  );
  const selectedBlockers = useMemo(() => approvalBlockers(selected), [selected]);
  const selectedSubmitBlockers = useMemo(
    () => approvalSubmitBlockers(selected, scope, currentBatchId, currentRealReportSourceFiles),
    [currentBatchId, currentRealReportSourceFiles, scope.marketplaceCode, scope.storeName, selected],
  );
  const selectedDecisionSummary = useMemo(
    () => buildDecisionEvidenceSummary(selected?.evidence),
    [selected],
  );

  function decisionPayload(decision: 'approved' | 'rejected') {
    return buildApprovalDecisionPayload({
      decision,
      approverName,
      approvalNote,
      currentBatchId,
      selected,
      scope: {
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
      },
    });
  }

  const filter = useMemo(() => ({
    dateFrom: scope.dateFrom,
    dateTo: scope.dateTo,
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    asin: scope.asin,
    batchId: currentBatchId,
    status: tab,
    limit: 100,
  }), [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName, tab]);

  async function loadRows(options: { clearMessage?: boolean } = {}) {
    setLoading(true);
    if (options.clearMessage !== false) setMessage(null);
    try {
      const nextRows = await (window as any).electronAPI?.getRecommendations?.(filter);
      const normalizedRows = Array.isArray(nextRows) ? nextRows : [];
      setRows(normalizedRows);
      setSelected((current) => (current && normalizedRows.some((row) => row.id === current.id) ? current : null));
    } catch (caught) {
      setMessage(errorMessage(caught, '加载审批队列失败'));
    } finally {
      setLoading(false);
    }
  }

  async function approveSelected() {
    if (!selected) return;
    if (selectedMissing.length > 0) {
      setMessage(`审批阻断：建议缺少 ${selectedMissing.join('、')}，不能推进到执行回读。`);
      return;
    }
    if (selectedBlockers.length > 0) {
      setMessage(`审批阻断：${selectedBlockers.join('、')}，不能走普通批准；需要先完成专门复核或重新生成规则确认后的建议。`);
      return;
    }
    if (!approverName.trim()) {
      setMessage('批准前必须填写审批人。');
      return;
    }
    try {
      await (window as any).electronAPI?.approveRecommendation?.({ id: selected.id, decision: decisionPayload('approved') });
      setMessage(`已批准建议 #${selected.id}，审批人和备注已写入建议证据。审批范围：${scope.storeName} / ${scope.marketplaceCode} / ${selected.evidence?.campaignName || '-'} / ${selected.evidence?.adGroupName || '-'} / ${objectName(selected)}。`);
      setSelected(null);
      setApproverName('');
      setApprovalNote('');
      await loadRows({ clearMessage: false });
    } catch (caught) {
      setMessage(errorMessage(caught, '批准建议失败'));
    }
  }

  async function rejectSelected() {
    if (!selected) return;
    if (!approverName.trim()) {
      setMessage('拒绝前必须填写处理人。');
      return;
    }
    if (!approvalNote.trim()) {
      setMessage('拒绝前必须填写拒绝原因。');
      return;
    }
    try {
      await (window as any).electronAPI?.rejectRecommendation?.({ id: selected.id, decision: decisionPayload('rejected') });
      setMessage(`已拒绝建议 #${selected.id}，拒绝原因已写入建议证据${approvalNote ? `：${approvalNote}` : ''}`);
      setSelected(null);
      setApproverName('');
      setApprovalNote('');
      await loadRows({ clearMessage: false });
    } catch (caught) {
      setMessage(errorMessage(caught, '拒绝建议失败'));
    }
  }

  useEffect(() => {
    if (!currentBatchId) {
      setRows([]);
      setSelected(null);
      return;
    }
    loadRows();
  }, [currentBatchId, filter]);

  return (
    <div>
      <PageHeader
        eyebrow="广告执行"
        title="审批中心"
        description="这里只处理人工审批决策。真实执行和回读证据在“执行回读”页面独立完成。"
        primaryTask="确认哪些动作允许执行"
        nextAction={selected ? '填写审批人后批准或拒绝' : '选择一条建议'}
      />

      <div className="business-stack">
        <Panel title="审批安全边界" tone="warning">
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">不会批量自动写入。每个动作必须绑定店铺、站点、campaign、ad group、对象和动作，并保留审批与回读证据。</p>
            </div>
            <StatusPill tone="pending">仅审批，不执行</StatusPill>
          </div>
        </Panel>

        <Panel title="审批处理要求">
          <div className="context-summary-grid">
            <div>
              <span>本页职责</span>
              <strong>只做人工决策</strong>
              <p>批准或拒绝规则确认后的建议；AI 独立洞察和冲突建议先进入复核队列。</p>
            </div>
            <div>
              <span>批准前确认</span>
              <strong>范围和动作</strong>
              <p>核对店铺、站点、广告活动、广告组、对象、当前值和建议值。</p>
            </div>
            <div>
              <span>批准后下一步</span>
              <strong>进入执行回读</strong>
              <p>在执行回读页补录审批凭证、before/after 截图、回读值和现场行证明。</p>
            </div>
            <div>
              <span>当前队列</span>
              <strong>{rows.length} 条</strong>
              <p>{TAB_LABELS[tab]}；切换标签只查看状态，不会执行动作。</p>
            </div>
          </div>
        </Panel>

        <Panel title="审批队列">
          <div className="tab-row">
            {(Object.keys(TAB_LABELS) as ApprovalTab[]).map((item) => (
              <button
                aria-pressed={tab === item}
                className={tab === item ? 'tab-button tab-button-active' : 'tab-button'}
                key={item}
                onClick={() => {
                  setTab(item);
                  setSelected(null);
                }}
                type="button"
              >
                {TAB_LABELS[item]}
              </button>
            ))}
          </div>
          <details className="evidence-disclosure">
            <summary>展开审批队列（{rows.length} 条）</summary>
            <div className="table-wrap">
              <table className="business-table approval-table">
              <thead>
                <tr>
                  <th>动作</th>
                  <th>广告组合</th>
                  <th>广告活动</th>
                  <th>广告组</th>
                  <th>ASIN</th>
                  <th>对象</th>
                  <th>当前/建议</th>
                  <th>花费</th>
                  <th>风险</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.actionType}</td>
                    <td>{row.evidence?.portfolioName || '-'}</td>
                    <td>{row.evidence?.campaignName || '-'}</td>
                    <td>{row.evidence?.adGroupName || '-'}</td>
                    <td>{row.evidence?.asin || '-'}</td>
                    <td>{objectName(row)}</td>
                    <td>{row.currentValue || '-'} {'→'} {row.recommendedValue || '-'}</td>
                    <td>{formatUsd(row.evidence?.cost ?? row.cost)}</td>
                    <td>
                      <div>{row.riskLevel}</div>
                      <div className="table-subtext">{approvalBlockers(row).length ? approvalBlockers(row).join(' / ') : '普通审批可处理'}</div>
                    </td>
                    <td>
                      <button
                        className="secondary-button compact-button"
                        onClick={() => {
                          setSelected(row);
                          setApproverName('');
                          setApprovalNote('');
                        }}
                        type="button"
                      >
                        处理
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td colSpan={10}>{loading ? '加载中...' : `${TAB_LABELS[tab]}队列为空。`}</td>
                  </tr>
                )}
              </tbody>
              </table>
            </div>
          </details>
        </Panel>

        {selected && (
          <Panel title="审批决策">
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
                  <span>审批动作</span>
                  <strong>{selectedDecisionSummary.nextAction}</strong>
                  <p>缺证据、AI 独立洞察或规则冲突时不能走普通批准。</p>
                </div>
              </div>
              {selectedDecisionSummary.riskWarnings.length > 0 && (
                <p className="blocked-line">风险：{selectedDecisionSummary.riskWarnings.join('；')}</p>
              )}
            </div>
            <div className="detail-grid">
              <div><span>建议 ID</span><strong>{selected.id}</strong></div>
              <div><span>审批范围</span><strong>{scope.storeName} / {scope.marketplaceCode}</strong></div>
              <div><span>当前批次</span><strong>{currentBatchId || '-'}</strong></div>
              <div><span>来源批次</span><strong>{selected.evidence?.batchId || '-'}</strong></div>
              <div><span>批次校验</span><strong>{selected.evidence?.batchId && currentBatchId && selected.evidence.batchId === currentBatchId ? '来源批次匹配' : '来源批次需核对'}</strong></div>
              <div><span>指标日期</span><strong>{selected.evidence?.date || '-'}</strong></div>
              <div><span>广告组合</span><strong>{selected.evidence?.portfolioName || '-'}</strong></div>
              <div><span>广告活动</span><strong>{selected.evidence?.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{selected.evidence?.adGroupName || '-'}</strong></div>
              <div><span>ASIN</span><strong>{selected.evidence?.asin || '-'}</strong></div>
              <div><span>对象类型</span><strong>{selected.entityType || selected.evidence?.matchType || '-'}</strong></div>
              <div><span>对象</span><strong>{objectName(selected)}</strong></div>
              <div><span>允许动作</span><strong>{selected.actionType}</strong></div>
              <div><span>当前值/建议值</span><strong>{selected.currentValue || '-'} {'→'} {selected.recommendedValue || '-'}</strong></div>
              <div><span>来源文件</span><strong>{sourceFiles(selected)}</strong></div>
              <div><span>审批预检</span><strong>{selectedMissing.length ? `阻断：缺 ${selectedMissing.join('、')}` : '通过'}</strong></div>
              <div><span>AI/规则决策关系</span><strong>{decisionLabel(selected)}</strong></div>
              <div><span>AI 策略诊断</span><strong>{strategyLabel(selected)} / {selected.evidence?.aiLifecycleStage || '阶段待判定'}</strong></div>
              <div><span>AI 动态阈值</span><strong>{aiThresholdSummary(selected)}</strong></div>
              <div><span>产品阶段</span><strong>{productStageLabel(selected.evidence?.productStage)}</strong></div>
              <div><span>产品目标 ACOS / TACOS</span><strong>{optionalPercent(selected.evidence?.productTargetAcos)} / {optionalPercent(selected.evidence?.productTargetTacos)}</strong></div>
              <div><span>目标净利率 / 最低价</span><strong>{optionalPercent(selected.evidence?.productTargetNetMargin)} / {optionalMoney(selected.evidence?.productMinPrice)}</strong></div>
              <div><span>规则量化</span><strong>{quantSummary(selected)}</strong></div>
              <div><span>量化阈值</span><strong>{thresholdSummary(selected)}</strong></div>
              <div><span>来源行号</span><strong>{selected.evidence?.sourceRow || '-'}</strong></div>
              <div><span>普通批准</span><strong>{selectedBlockers.length ? `阻断：${selectedBlockers.join('、')}` : '允许'}</strong></div>
            </div>
            {selected.evidence?.quantReasons?.length ? (
              <p className={selected.evidence.quantReviewRequired ? 'blocked-line' : 'muted-line'}>
                规则量化依据：{selected.evidence.quantReasons.join('；')}
              </p>
            ) : null}
            {selected.evidence?.aiStrategySummary && (
              <div className="evidence-check-panel">
                <h3>AI 策略诊断</h3>
                <p className="muted-line">{selected.evidence.aiStrategySummary}</p>
                {selected.evidence.aiLifecycleStageReason && (
                  <p className={selected.evidence.aiLifecycleStageRequiresReview ? 'warning-line' : 'muted-line'}>
                    阶段判断依据：{selected.evidence.aiLifecycleStageReason}
                  </p>
                )}
                {Boolean(selected.evidence.aiLifecycleStageEvidenceRefs?.length) && (
                  <p className="muted-line">阶段引用证据：{formatEvidenceRefSummary(selected.evidence.aiLifecycleStageEvidenceRefs, selected.evidence.aiLifecycleStageEvidenceDetails)}</p>
                )}
                {selected.evidence.aiLifecycleStageRequiresReview && (
                  <p className="blocked-line">
                    阶段判断需复核：{selected.evidence.aiLifecycleStageInvalidReasons?.join('；') || 'AI 阶段判断缺少有效可回查证据。'}
                  </p>
                )}
                <p className="muted-line">AI 动态阈值：{aiThresholdSummary(selected)}</p>
                <p className="muted-line">AI 主要问题：{compactList(selected.evidence.aiMainProblems)}</p>
                <p className={selected.evidence.aiStrategyRiskWarnings?.length ? 'blocked-line' : 'muted-line'}>
                  AI 风险提示：{compactList(selected.evidence.aiStrategyRiskWarnings)}
                </p>
              </div>
            )}
            {(selected.evidence?.aiReasoningSteps?.length || selected.evidence?.aiEvidenceRefs?.length || selected.evidence?.aiInsightInvalidReasons?.length) ? (
              <div className="evidence-check-panel">
                <h3>AI 判断依据</h3>
                {selected.evidence?.aiInsightOnly && (
                  <p className="blocked-line">该建议缺少 AI 可回查证据，仅作为洞察展示，不能审批。</p>
                )}
                {Boolean(selected.evidence?.aiReasoningSteps?.length) && (
                  <ul className="business-list">
                    {selected.evidence?.aiReasoningSteps?.slice(0, 5).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                )}
                <p className="muted-line">引用证据：{formatEvidenceRefSummary(selected.evidence?.aiEvidenceRefs, selected.evidence?.aiEvidenceDetails)}</p>
                {Boolean(selected.evidence?.aiInsightInvalidReasons?.length) && (
                  <p className="blocked-line">{selected.evidence.aiInsightInvalidReasons?.join('；')}</p>
                )}
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
                          <p>{[item.campaignName || '-', item.adGroupName || '-', item.asin || '-', item.entityName || '-'].join(' / ')}</p>
                          {item.metrics && <p>{evidenceMetricLine(item)}</p>}
                          {item.event && <p>{[item.event.eventDate || '-', item.event.eventType || '-', item.event.impactExpectation || '-'].join(' / ')}</p>}
                          {item.sourceFile && <code title={item.sourceFile}>{item.sourceFile}</code>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {(selected.evidence?.decisionReasons?.length || selected.evidence?.decisionRiskWarnings?.length) ? (
              <div className="evidence-check-panel">
                <h3>AI/规则合并依据</h3>
                <p className="muted-line">决策关系：{decisionLabel(selected)} / 来源：{selected.evidence?.decisionSource || 'rule'}</p>
                <ul className="business-list">
                  {(selected.evidence?.decisionReasons || []).map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {Boolean(selected.evidence?.decisionRiskWarnings?.length) && (
                  <p className="blocked-line">合并风险：{selected.evidence?.decisionRiskWarnings?.join('；')}</p>
                )}
              </div>
            ) : null}
            {selectedBlockers.length > 0 && (
              <p className="blocked-line">这条建议不能走普通批准：{selectedBlockers.join('、')}。请在复核队列处理，或重新生成规则确认后的建议。</p>
            )}
            {selectedMissing.length > 0 && (
              <p className="blocked-line">审批证据不完整：缺 {selectedMissing.join('、')}。补齐当前批次真实报表来源后才能批准。</p>
            )}
            <div className="form-grid">
              <label>
                审批/处理人
                <input value={approverName} onChange={(event) => setApproverName(event.target.value)} placeholder="负责人姓名" />
              </label>
              <label>
                审批时间
                <input readOnly value={new Date().toISOString()} />
              </label>
              <label className="form-grid-wide">
                审批备注/拒绝原因
                <textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder="记录审批范围、外部审批凭证或拒绝原因" />
              </label>
            </div>
            <p className="muted-line">审批人、备注、范围和数据批次会写入建议证据；真实 Ads UI 操作和审批凭证路径仍必须在“执行回读”页逐条补齐。</p>
            <div className="action-row">
              <button className="primary-button" disabled={selectedSubmitBlockers.length > 0} onClick={approveSelected} type="button">批准并进入待执行</button>
              <button className="secondary-button danger-button" onClick={rejectSelected} type="button">拒绝</button>
            </div>
          </Panel>
        )}

        {message && <p className={message.includes('失败') || message.includes('必须') ? 'blocked-line' : 'muted-line'}>{message}</p>}
      </div>
    </div>
  );
}
