import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import type { RecommendationView } from '../types';
import { toUserFacingError } from '../user-facing-error';

interface ReadbackFormState {
  recommendationId: string;
  storeName: string;
  marketplaceCode: string;
  portfolioName: string;
  asin: string;
  campaignName: string;
  adGroupName: string;
  entityType: string;
  entityName: string;
  actionType: string;
  currentValue: string;
  recommendedValue: string;
  sourceBatchId: string;
  sourceMetricDate: string;
  sourceFiles: string;
  sourceExplanationSource: string;
  sourceAiModel: string;
  decisionAgreement: string;
  decisionSource: string;
  decisionReasons: string[];
  decisionRiskWarnings: string[];
  aiStrategySource: string;
  aiLifecycleStage: string;
  aiStrategySummary: string;
  aiMainProblems: string[];
  aiThresholdSuggestions: Record<string, { value: number; reason: string }>;
  aiStrategyRiskWarnings: string[];
  quantStatus: string;
  quantLifecycleStage: string;
  quantReasons: string[];
  quantThresholds: Record<string, number>;
  quantReviewRequired: boolean;
  operationEventCount: number;
  productContextCount: number;
  productStage: string;
  productTargetAcos: string;
  productTargetTacos: string;
  productTargetNetMargin: string;
  productMinPrice: string;
  approverName: string;
  approvalNote: string;
  approvalArtifactPath: string;
  approvalConfirmedAt: string;
  executedBy: string;
  executionId: string;
  executionExecutedAt: string;
  beforeValue: string;
  beforeCapturedAt: string;
  beforeScreenshotPath: string;
  afterValue: string;
  afterCapturedAt: string;
  afterScreenshotPath: string;
  readbackActualValue: string;
  readbackReadAt: string;
  readbackEvidencePath: string;
  liveBidSourceNote: string;
  riskRationale: string;
  operatorConfirmed: boolean;
  realWriteApproved: boolean;
  allowedByPolicy: boolean;
  executionSuccess: boolean;
  executionVerified: boolean;
  readbackVerified: boolean;
}

const EMPTY_FORM: ReadbackFormState = {
  recommendationId: '',
  storeName: '',
  marketplaceCode: '',
  portfolioName: '',
  asin: '',
  campaignName: '',
  adGroupName: '',
  entityType: 'target',
  entityName: '',
  actionType: 'lower_bid',
  currentValue: '',
  recommendedValue: '',
  sourceBatchId: '',
  sourceMetricDate: '',
  sourceFiles: '',
  sourceExplanationSource: '',
  sourceAiModel: '',
  decisionAgreement: '',
  decisionSource: '',
  decisionReasons: [],
  decisionRiskWarnings: [],
  aiStrategySource: '',
  aiLifecycleStage: '',
  aiStrategySummary: '',
  aiMainProblems: [],
  aiThresholdSuggestions: {},
  aiStrategyRiskWarnings: [],
  quantStatus: '',
  quantLifecycleStage: '',
  quantReasons: [],
  quantThresholds: {},
  quantReviewRequired: false,
  operationEventCount: 0,
  productContextCount: 0,
  productStage: '',
  productTargetAcos: '',
  productTargetTacos: '',
  productTargetNetMargin: '',
  productMinPrice: '',
  approverName: '',
  approvalNote: '',
  approvalArtifactPath: '',
  approvalConfirmedAt: '',
  executedBy: '',
  executionId: '',
  executionExecutedAt: '',
  beforeValue: '',
  beforeCapturedAt: '',
  beforeScreenshotPath: '',
  afterValue: '',
  afterCapturedAt: '',
  afterScreenshotPath: '',
  readbackActualValue: '',
  readbackReadAt: '',
  readbackEvidencePath: '',
  liveBidSourceNote: '',
  riskRationale: '低风险动作；不增加预算、不提高出价、不创建活动、不扩大流量。',
  operatorConfirmed: false,
  realWriteApproved: false,
  allowedByPolicy: false,
  executionSuccess: false,
  executionVerified: false,
  readbackVerified: false,
};

function errorMessage(caught: unknown, fallback: string): string {
  return `${fallback}: ${toUserFacingError(caught, fallback)}`;
}

function objectName(rec: RecommendationView): string {
  return rec.evidence?.searchTerm || rec.evidence?.targeting || rec.entityName || '';
}

function formFromRecommendation(rec: RecommendationView, scope: { storeName: string; marketplaceCode: string }, batchId?: string): ReadbackFormState {
  const evidence = rec.evidence || {};
  return {
    ...EMPTY_FORM,
    recommendationId: String(rec.id),
    storeName: scope.storeName,
    marketplaceCode: scope.marketplaceCode,
    portfolioName: evidence.portfolioName || '',
    asin: evidence.asin || '',
    campaignName: evidence.campaignName || '',
    adGroupName: evidence.adGroupName || '',
    entityType: rec.entityType || evidence.matchType || '',
    entityName: objectName(rec),
    actionType: rec.actionType,
    currentValue: rec.currentValue || '',
    recommendedValue: rec.recommendedValue || '',
    sourceBatchId: evidence.approvalDecision?.sourceBatchId || evidence.approvalDecision?.batchId || evidence.batchId || batchId || '',
    sourceMetricDate: evidence.date || '',
    sourceFiles: (evidence.sourceFiles || []).join('\n'),
    sourceExplanationSource: evidence.explanationSource || '',
    sourceAiModel: evidence.aiModel || '',
    decisionAgreement: evidence.decisionAgreement || '',
    decisionSource: evidence.decisionSource || '',
    decisionReasons: evidence.decisionReasons || [],
    decisionRiskWarnings: evidence.decisionRiskWarnings || [],
    aiStrategySource: evidence.aiStrategySource || '',
    aiLifecycleStage: evidence.aiLifecycleStage || '',
    aiStrategySummary: evidence.aiStrategySummary || '',
    aiMainProblems: evidence.aiMainProblems || [],
    aiThresholdSuggestions: evidence.aiThresholdSuggestions || {},
    aiStrategyRiskWarnings: evidence.aiStrategyRiskWarnings || [],
    quantStatus: evidence.quantStatus || '',
    quantLifecycleStage: evidence.quantLifecycleStage || '',
    quantReasons: evidence.quantReasons || [],
    quantThresholds: evidence.quantThresholds || {},
    quantReviewRequired: evidence.quantReviewRequired === true,
    operationEventCount: evidence.operationEventCount || 0,
    productContextCount: evidence.productContextCount || 0,
    productStage: evidence.productStage || '',
    productTargetAcos: evidence.productTargetAcos != null ? String(evidence.productTargetAcos) : '',
    productTargetTacos: evidence.productTargetTacos != null ? String(evidence.productTargetTacos) : '',
    productTargetNetMargin: evidence.productTargetNetMargin != null ? String(evidence.productTargetNetMargin) : '',
    productMinPrice: evidence.productMinPrice != null ? String(evidence.productMinPrice) : '',
    approverName: evidence.approvalDecision?.approvedBy || '',
    approvalNote: evidence.approvalDecision?.note || '',
    approvalConfirmedAt: evidence.approvalDecision?.decidedAt || '',
  };
}

function maybeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredMissing(form: ReadbackFormState, currentBatchId?: string): string[] {
  const missing: string[] = [];
  const requireText = (value: string, label: string) => {
    if (!value.trim()) missing.push(label);
  };
  const requireFlag = (ok: boolean, label: string) => {
    if (!ok) missing.push(label);
  };
  requireText(form.storeName, '店铺');
  requireText(form.marketplaceCode, '站点');
  requireText(form.campaignName, '广告活动');
  requireText(form.adGroupName, '广告组');
  requireText(form.entityType, '对象类型');
  requireText(form.entityName, '对象名称');
  requireText(form.actionType, '动作类型');
  requireText(form.currentValue, '来源当前值');
  requireText(form.recommendedValue, '来源建议值');
  requireText(form.sourceBatchId, '来源批次');
  requireText(form.sourceMetricDate, '指标日期');
  requireText(form.sourceFiles, '推荐来源文件');
  requireText(form.approverName, '审批人');
  requireText(form.approvalArtifactPath, '审批凭证');
  requireText(form.approvalConfirmedAt, '审批时间');
  requireText(form.executedBy, '执行人');
  requireText(form.executionId, '执行编号');
  requireText(form.executionExecutedAt, '执行时间');
  requireText(form.beforeValue, 'before 值');
  requireText(form.beforeCapturedAt, 'before 时间');
  requireText(form.afterValue, 'after 值');
  requireText(form.afterCapturedAt, 'after 时间');
  requireText(form.readbackActualValue, '回读值');
  requireText(form.readbackReadAt, '回读时间');
  requireText(form.beforeScreenshotPath, 'before 截图');
  requireText(form.afterScreenshotPath, 'after 截图');
  requireText(form.readbackEvidencePath, '回读证据');
  requireText(form.liveBidSourceNote, '现场行证明');
  requireFlag(form.operatorConfirmed, '审批人确认范围');
  requireFlag(form.realWriteApproved, '外部审批允许');
  requireFlag(form.allowedByPolicy, '低风险策略允许');
  requireFlag(form.executionSuccess, '执行成功确认');
  requireFlag(form.executionVerified, '执行核验');
  requireFlag(form.readbackVerified, '回读核验');
  if (form.beforeValue && form.afterValue && form.beforeValue === form.afterValue) missing.push('before/after 值不能相同');
  if (form.afterValue && form.readbackActualValue && form.afterValue !== form.readbackActualValue) missing.push('回读值必须等于 after 值');
  const timestamps = [
    ['审批时间', form.approvalConfirmedAt],
    ['before 时间', form.beforeCapturedAt],
    ['执行时间', form.executionExecutedAt],
    ['after 时间', form.afterCapturedAt],
    ['回读时间', form.readbackReadAt],
  ] as const;
  const parsedTimestamps = timestamps.map(([label, value]) => ({ label, value, ms: Date.parse(value) }));
  for (const item of parsedTimestamps) {
    if (item.value.trim() && Number.isNaN(item.ms)) missing.push(`${item.label}不是可解析时间`);
  }
  if (parsedTimestamps.every((item) => item.value.trim() && Number.isFinite(item.ms))) {
    for (let index = 1; index < parsedTimestamps.length; index += 1) {
      if (parsedTimestamps[index].ms < parsedTimestamps[index - 1].ms) {
        missing.push('时间顺序必须为审批≤before≤执行≤after≤回读');
        break;
      }
    }
  }
  if (currentBatchId && form.sourceBatchId.trim() && form.sourceBatchId.trim() !== currentBatchId) {
    missing.push('来源批次必须等于当前批次');
  }
  return missing;
}

function groupMissing(items: string[]) {
  const target = ['店铺', '站点', '广告活动', '广告组', '对象类型', '对象名称', '动作类型'];
  const source = ['来源当前值', '来源建议值', '来源批次', '指标日期', '推荐来源文件', '来源批次必须等于当前批次'];
  const proof = ['审批人', '审批凭证', '审批时间', '执行人', '执行编号', '执行时间', 'before 值', 'before 时间', 'after 值', 'after 时间', '回读值', '回读时间', 'before 截图', 'after 截图', '回读证据', '现场行证明'];
  const confirmation = ['审批人确认范围', '外部审批允许', '低风险策略允许', '执行成功确认', '执行核验', '回读核验', 'before/after 值不能相同', '回读值必须等于 after 值', '审批时间不是可解析时间', 'before 时间不是可解析时间', '执行时间不是可解析时间', 'after 时间不是可解析时间', '回读时间不是可解析时间', '时间顺序必须为审批≤before≤执行≤after≤回读'];
  return [
    { title: '执行对象', items: items.filter((item) => target.includes(item)) },
    { title: '建议来源', items: items.filter((item) => source.includes(item)) },
    { title: '证据文件和值', items: items.filter((item) => proof.includes(item)) },
    { title: '审批与核验', items: items.filter((item) => confirmation.includes(item)) },
  ].filter((group) => group.items.length > 0);
}

function checklistStatus(missing: string[], labels: string[]): 'ready' | 'blocked' {
  return labels.some((label) => missing.includes(label)) ? 'blocked' : 'ready';
}

function checklistText(missing: string[], labels: string[]): string {
  const count = labels.filter((label) => missing.includes(label)).length;
  return count ? `缺 ${count} 项` : '已满足';
}

export function ReadbackPage() {
  const { data, scope } = useBusinessDataPipeline();
  const [approvedRows, setApprovedRows] = useState<RecommendationView[]>([]);
  const [form, setForm] = useState<ReadbackFormState>(EMPTY_FORM);
  const [exportResult, setExportResult] = useState<{ jsonPath?: string; markdownPath?: string; status?: string; readyForVerifier?: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const currentBatchId = scope.batchId || data?.collection.latestBatch?.id;
  const missing = useMemo(() => requiredMissing(form, currentBatchId), [currentBatchId, form]);
  const sourceBatchMatches = Boolean(form.sourceBatchId && currentBatchId && form.sourceBatchId === currentBatchId);
  const missingGroups = useMemo(() => groupMissing(missing), [missing]);
  const readbackSteps = useMemo(() => [
    {
      title: '对象绑定',
      status: checklistStatus(missing, ['店铺', '站点', '广告活动', '广告组', '对象类型', '对象名称', '动作类型']),
      detail: checklistText(missing, ['店铺', '站点', '广告活动', '广告组', '对象类型', '对象名称', '动作类型']),
    },
    {
      title: '审批允许',
      status: checklistStatus(missing, ['审批人', '审批凭证', '审批时间', '审批时间不是可解析时间', '审批人确认范围', '外部审批允许', '低风险策略允许']),
      detail: checklistText(missing, ['审批人', '审批凭证', '审批时间', '审批时间不是可解析时间', '审批人确认范围', '外部审批允许', '低风险策略允许']),
    },
    {
      title: '执行前后',
      status: checklistStatus(missing, ['执行人', '执行编号', '执行时间', 'before 值', 'before 时间', 'after 值', 'after 时间', 'before 截图', 'after 截图', 'before/after 值不能相同', 'before 时间不是可解析时间', '执行时间不是可解析时间', 'after 时间不是可解析时间', '时间顺序必须为审批≤before≤执行≤after≤回读']),
      detail: checklistText(missing, ['执行人', '执行编号', '执行时间', 'before 值', 'before 时间', 'after 值', 'after 时间', 'before 截图', 'after 截图', 'before/after 值不能相同', 'before 时间不是可解析时间', '执行时间不是可解析时间', 'after 时间不是可解析时间', '时间顺序必须为审批≤before≤执行≤after≤回读']),
    },
    {
      title: '回读确认',
      status: checklistStatus(missing, ['回读值', '回读时间', '回读证据', '现场行证明', '执行成功确认', '执行核验', '回读核验', '回读值必须等于 after 值', '回读时间不是可解析时间', '时间顺序必须为审批≤before≤执行≤after≤回读']),
      detail: checklistText(missing, ['回读值', '回读时间', '回读证据', '现场行证明', '执行成功确认', '执行核验', '回读核验', '回读值必须等于 after 值', '回读时间不是可解析时间', '时间顺序必须为审批≤before≤执行≤after≤回读']),
    },
  ], [missing]);

  function update(patch: Partial<ReadbackFormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setExportResult(null);
  }

  async function loadApprovedRows() {
    setLoading(true);
    setMessage(null);
    try {
      const rows = await (window as any).electronAPI?.getRecommendations?.({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
        batchId: currentBatchId,
        status: 'approved',
        limit: 100,
      });
      setApprovedRows(Array.isArray(rows) ? rows : []);
    } catch (caught) {
      setMessage(errorMessage(caught, '加载已批准动作失败'));
    } finally {
      setLoading(false);
    }
  }

  async function exportEvidence() {
    setMessage(null);
    try {
      const scopeText = [
        form.storeName,
        form.marketplaceCode,
        form.asin,
        form.campaignName,
        form.adGroupName,
        `${form.entityType}=${form.entityName}`,
        form.actionType,
      ].filter(Boolean).join(' / ');
      const result = await (window as any).electronAPI?.exportAdReadbackEvidence?.({
        target: {
          storeName: form.storeName,
          marketplaceCode: form.marketplaceCode,
          portfolioName: form.portfolioName,
          asin: form.asin,
          metricDate: form.sourceMetricDate,
          campaignName: form.campaignName,
          adGroupName: form.adGroupName,
          entityType: form.entityType,
          entityName: form.entityName,
          actionType: form.actionType,
        },
        source: {
          recommendationId: form.recommendationId,
          batchId: form.sourceBatchId,
          metricDate: form.sourceMetricDate,
          sourceFiles: form.sourceFiles.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
          explanationSource: form.sourceExplanationSource,
          aiModel: form.sourceAiModel,
          entityType: form.entityType,
          currentValue: form.currentValue,
          recommendedValue: form.recommendedValue,
          decisionAgreement: form.decisionAgreement,
          decisionSource: form.decisionSource,
          decisionReasons: form.decisionReasons,
          decisionRiskWarnings: form.decisionRiskWarnings,
          aiStrategySource: form.aiStrategySource,
          aiLifecycleStage: form.aiLifecycleStage,
          aiStrategySummary: form.aiStrategySummary,
          aiMainProblems: form.aiMainProblems,
          aiThresholdSuggestions: form.aiThresholdSuggestions,
          aiStrategyRiskWarnings: form.aiStrategyRiskWarnings,
          quantStatus: form.quantStatus,
          quantLifecycleStage: form.quantLifecycleStage,
          quantReasons: form.quantReasons,
          quantThresholds: form.quantThresholds,
          quantReviewRequired: form.quantReviewRequired,
          operationEventCount: form.operationEventCount,
          productContextCount: form.productContextCount,
          productStage: form.productStage,
          productTargetAcos: maybeNumber(form.productTargetAcos),
          productTargetTacos: maybeNumber(form.productTargetTacos),
          productTargetNetMargin: maybeNumber(form.productTargetNetMargin),
          productMinPrice: maybeNumber(form.productMinPrice),
        },
        approval: {
          operatorConfirmed: form.operatorConfirmed,
          realWriteApproved: form.realWriteApproved,
          scope: scopeText,
          confirmedAt: form.approvalConfirmedAt,
          approverName: form.approverName,
          note: form.approvalNote,
          approvalArtifactPath: form.approvalArtifactPath,
        },
        risk: {
          allowedByPolicy: form.allowedByPolicy,
          rationale: form.riskRationale,
        },
        before: {
          value: form.beforeValue,
          capturedAt: form.beforeCapturedAt,
          screenshotPath: form.beforeScreenshotPath,
          liveBidSourceNote: form.liveBidSourceNote,
        },
        after: {
          value: form.afterValue,
          capturedAt: form.afterCapturedAt,
          screenshotPath: form.afterScreenshotPath,
        },
        readback: {
          verified: form.readbackVerified,
          method: 'Ads UI reload',
          readAt: form.readbackReadAt,
          actualValue: form.readbackActualValue,
          evidencePath: form.readbackEvidencePath,
        },
        execution: {
          success: form.executionSuccess,
          verified: form.executionVerified,
          executionId: form.executionId,
          executedAt: form.executionExecutedAt,
          channel: 'manual_ads_ui',
          executedBy: form.executedBy,
          appExecutorUsed: false,
        },
      });
      setExportResult(result || null);
      setMessage(result?.readyForVerifier ? '读回证据已导出，字段完整，等待最终验收。' : '读回证据已导出，但仍存在缺失项，不能作为最终就绪证据。');
    } catch (caught) {
      setMessage(errorMessage(caught, '导出读回证据失败'));
    }
  }

  async function openExport() {
    const targetPath = exportResult?.jsonPath || exportResult?.markdownPath;
    if (!targetPath) return;
    await (window as any).electronAPI?.openReportPath?.(targetPath);
  }

  useEffect(() => {
    if (!currentBatchId) {
      setApprovedRows([]);
      setForm(EMPTY_FORM);
      setExportResult(null);
      return;
    }
    loadApprovedRows();
  }, [currentBatchId, scope.asin, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  useEffect(() => {
    if (!form.recommendationId) return;
    const stillApproved = approvedRows.some((row) => String(row.id) === form.recommendationId);
    if (!stillApproved) {
      setForm(EMPTY_FORM);
      setExportResult(null);
      setMessage('已清空执行回读表单：当前范围不再包含该已批准动作。');
    }
  }, [approvedRows, form.recommendationId]);

  return (
    <div>
      <PageHeader
        eyebrow="广告执行"
        title="执行回读"
        description="记录已批准动作的人工执行结果、before/after 和回读证据。本页不做批量自动写入，也不把技术命令作为主流程。"
        primaryTask="证明执行结果可回读"
        nextAction={form.recommendationId ? '补齐证据并导出' : '选择已批准动作'}
      />

      <div className="business-stack">
        <Panel title="当前回读范围" tone="warning">
          <div className="business-split">
            <div>
              <div className="business-scope-line"><ScopeText scope={data?.scope || scope} /></div>
              <p className="muted-line">每个广告动作都必须重新绑定自己的店铺、站点、campaign、ad group、对象、动作和现场值。</p>
            </div>
            <StatusPill tone="pending">人工执行证据，不批量写入</StatusPill>
          </div>
        </Panel>

        <Panel title="回读进度概览" tone={missing.length ? 'blocked' : 'success'}>
          <div className="readback-step-grid">
            {readbackSteps.map((step, index) => (
              <div className={`readback-step readback-step-${step.status}`} key={step.title}>
                <span>{index + 1}</span>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </div>
            ))}
          </div>
          <p className="muted-line">先看这里判断能否导出最终证据；下方表单只用于补齐对应缺口。</p>
        </Panel>

        <Panel title="1. 选择已批准动作">
          <div className="table-wrap">
            <table className="business-table approval-table">
              <thead>
                <tr>
                  <th>动作</th>
                  <th>广告组合</th>
                  <th>广告活动</th>
                  <th>广告组</th>
                  <th>ASIN</th>
                  <th>对象类型</th>
                  <th>对象</th>
                  <th>当前/建议</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {approvedRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.actionType}</td>
                    <td>{row.evidence?.portfolioName || '-'}</td>
                    <td>{row.evidence?.campaignName || '-'}</td>
                    <td>{row.evidence?.adGroupName || '-'}</td>
                    <td>{row.evidence?.asin || '-'}</td>
                    <td>{row.entityType || row.evidence?.matchType || '-'}</td>
                    <td>{objectName(row) || '-'}</td>
                    <td>{row.currentValue || '-'} {'→'} {row.recommendedValue || '-'}</td>
                    <td>
                      <button
                        className="secondary-button compact-button"
                        onClick={() => {
                          setForm(formFromRecommendation(row, scope, currentBatchId));
                          setExportResult(null);
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
                    <td colSpan={9}>{loading ? '加载中...' : '当前范围没有已批准待执行动作。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="2. 执行目标与来源">
          <div className="business-split">
            <div>
              <div className="business-scope-line">当前有效批次：{currentBatchId || '暂无'}</div>
              <p className="muted-line">来源批次、指标日期、来源文件、来源当前值和建议值是回读证据的一部分；缺失或串批次时只能导出缺口草稿。</p>
            </div>
            <StatusPill tone={sourceBatchMatches ? 'ready' : form.sourceBatchId ? 'blocked' : 'pending'}>
              {sourceBatchMatches ? '来源批次匹配' : form.sourceBatchId ? '来源批次不一致' : '待载入来源'}
            </StatusPill>
          </div>
          <div className="form-grid">
            <label>店铺<input value={form.storeName} onChange={(event) => update({ storeName: event.target.value })} /></label>
            <label>站点<input value={form.marketplaceCode} onChange={(event) => update({ marketplaceCode: event.target.value })} /></label>
            <label>广告组合<input value={form.portfolioName} onChange={(event) => update({ portfolioName: event.target.value })} /></label>
            <label>ASIN<input value={form.asin} onChange={(event) => update({ asin: event.target.value })} /></label>
            <label>广告活动<input value={form.campaignName} onChange={(event) => update({ campaignName: event.target.value })} /></label>
            <label>广告组<input value={form.adGroupName} onChange={(event) => update({ adGroupName: event.target.value })} /></label>
            <label>对象类型<input value={form.entityType} onChange={(event) => update({ entityType: event.target.value })} /></label>
            <label>对象名称<input value={form.entityName} onChange={(event) => update({ entityName: event.target.value })} /></label>
            <label>动作类型<input value={form.actionType} onChange={(event) => update({ actionType: event.target.value })} /></label>
            <label>来源当前值<input value={form.currentValue} onChange={(event) => update({ currentValue: event.target.value })} /></label>
            <label>来源建议值<input value={form.recommendedValue} onChange={(event) => update({ recommendedValue: event.target.value })} /></label>
            <label>来源批次<input value={form.sourceBatchId} onChange={(event) => update({ sourceBatchId: event.target.value })} /></label>
            <label>指标日期<input value={form.sourceMetricDate} onChange={(event) => update({ sourceMetricDate: event.target.value })} /></label>
            <label>解释来源<input value={form.sourceExplanationSource} onChange={(event) => update({ sourceExplanationSource: event.target.value })} /></label>
            <label>AI 模型<input value={form.sourceAiModel} onChange={(event) => update({ sourceAiModel: event.target.value })} /></label>
            <label className="form-grid-wide">推荐来源文件<textarea value={form.sourceFiles} onChange={(event) => update({ sourceFiles: event.target.value })} /></label>
          </div>
          <p className="muted-line">来源批次、指标日期、来源文件、来源当前值和建议值会写入 readback 证据，用于证明本次执行来自当前范围的哪条推荐。</p>
          {(form.productStage || form.decisionAgreement || form.aiLifecycleStage || form.quantLifecycleStage) && (
            <div className="readback-context-grid">
              <div>
                <span>产品阶段</span>
                <strong>{form.productStage || form.aiLifecycleStage || form.quantLifecycleStage || '-'}</strong>
                <small>
                  目标 ACOS {form.productTargetAcos || '-'} / TACOS {form.productTargetTacos || '-'} / 净利率 {form.productTargetNetMargin || '-'} / 最低价 ${form.productMinPrice || '-'}
                </small>
              </div>
              <div>
                <span>AI 与规则关系</span>
                <strong>{form.decisionAgreement || '-'} / {form.decisionSource || '-'}</strong>
                <small>{form.decisionReasons.slice(0, 2).join('；') || form.aiStrategySummary || '无来源说明'}</small>
              </div>
              <div>
                <span>量化阈值</span>
                <strong>
                  ACOS {form.quantThresholds.targetAcos != null ? `${(form.quantThresholds.targetAcos * 100).toFixed(1)}%` : '-'}
                  {' / '}
                  高 ACOS {form.quantThresholds.highAcosThreshold != null ? `${(form.quantThresholds.highAcosThreshold * 100).toFixed(1)}%` : '-'}
                </strong>
                <small>{form.quantReasons.slice(0, 2).join('；') || '无规则量化说明'}</small>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="3. 审批、执行与回读证据">
          <div className="form-grid">
            <label>审批人<input value={form.approverName} onChange={(event) => update({ approverName: event.target.value })} /></label>
            <label>审批备注<input value={form.approvalNote} onChange={(event) => update({ approvalNote: event.target.value })} /></label>
            <label>审批凭证<input value={form.approvalArtifactPath} onChange={(event) => update({ approvalArtifactPath: event.target.value })} /></label>
            <label>审批时间<input value={form.approvalConfirmedAt} onChange={(event) => update({ approvalConfirmedAt: event.target.value })} placeholder="ISO 时间" /></label>
            <label>执行人<input value={form.executedBy} onChange={(event) => update({ executedBy: event.target.value })} /></label>
            <label>执行编号<input value={form.executionId} onChange={(event) => update({ executionId: event.target.value })} /></label>
            <label>执行时间<input value={form.executionExecutedAt} onChange={(event) => update({ executionExecutedAt: event.target.value })} placeholder="ISO 时间" /></label>
            <label>Before 值<input value={form.beforeValue} onChange={(event) => update({ beforeValue: event.target.value })} /></label>
            <label>Before 截图<input value={form.beforeScreenshotPath} onChange={(event) => update({ beforeScreenshotPath: event.target.value })} /></label>
            <label>Before 时间<input value={form.beforeCapturedAt} onChange={(event) => update({ beforeCapturedAt: event.target.value })} placeholder="ISO 时间" /></label>
            <label>After 值<input value={form.afterValue} onChange={(event) => update({ afterValue: event.target.value })} /></label>
            <label>After 截图<input value={form.afterScreenshotPath} onChange={(event) => update({ afterScreenshotPath: event.target.value })} /></label>
            <label>After 时间<input value={form.afterCapturedAt} onChange={(event) => update({ afterCapturedAt: event.target.value })} placeholder="ISO 时间" /></label>
            <label>回读值<input value={form.readbackActualValue} onChange={(event) => update({ readbackActualValue: event.target.value })} /></label>
            <label>回读证据<input value={form.readbackEvidencePath} onChange={(event) => update({ readbackEvidencePath: event.target.value })} /></label>
            <label>回读时间<input value={form.readbackReadAt} onChange={(event) => update({ readbackReadAt: event.target.value })} placeholder="ISO 时间" /></label>
            <label className="form-grid-wide">现场行证明<textarea value={form.liveBidSourceNote} onChange={(event) => update({ liveBidSourceNote: event.target.value })} /></label>
          </div>
          <div className="checkbox-grid">
            <label><input checked={form.operatorConfirmed} onChange={(event) => update({ operatorConfirmed: event.target.checked })} type="checkbox" /> 审批人确认范围</label>
            <label><input checked={form.realWriteApproved} onChange={(event) => update({ realWriteApproved: event.target.checked })} type="checkbox" /> 外部审批允许</label>
            <label><input checked={form.allowedByPolicy} onChange={(event) => update({ allowedByPolicy: event.target.checked })} type="checkbox" /> 低风险策略允许</label>
            <label><input checked={form.executionSuccess} onChange={(event) => update({ executionSuccess: event.target.checked })} type="checkbox" /> 执行成功确认</label>
            <label><input checked={form.executionVerified} onChange={(event) => update({ executionVerified: event.target.checked })} type="checkbox" /> 执行已核验</label>
            <label><input checked={form.readbackVerified} onChange={(event) => update({ readbackVerified: event.target.checked })} type="checkbox" /> 回读已核验</label>
          </div>
        </Panel>

        <Panel title="4. 回读预检与导出" tone={missing.length ? 'blocked' : 'success'}>
          <div className="business-split">
            <div>
              <StatusPill tone={missing.length ? 'blocked' : 'ready'}>
                {missing.length ? `未满足 ${missing.length} 项` : '字段完整'}
              </StatusPill>
              {missing.length ? (
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
                  <span className="chip chip-ready">before/after/readback 值一致，字段完整。</span>
                </div>
              )}
            </div>
            <div className="action-row">
              <button className="primary-button" onClick={exportEvidence} type="button">
                {missing.length ? '导出缺口草稿' : '导出读回证据'}
              </button>
              <button className="secondary-button" disabled={!exportResult} onClick={openExport} type="button">打开导出文件</button>
            </div>
          </div>
          <p className="muted-line">
            {missing.length
              ? '缺项状态下只能导出本地草稿，方便定位缺口；不能作为最终执行完成证据。'
              : '字段完整时导出的 JSON/Markdown 可交给最终验收 verifier 复核。'}
          </p>
          {exportResult && (
            <div className="export-result-card">
              <div>
                <span>导出状态</span>
                <strong>{exportResult.readyForVerifier ? '可进入最终验收' : '已导出但仍需补证据'}</strong>
              </div>
              <div>
                <span>执行范围</span>
                <strong>{[form.storeName, form.marketplaceCode, form.campaignName, form.adGroupName, form.entityName].filter(Boolean).join(' / ') || '未完整填写'}</strong>
              </div>
              <div>
                <span>JSON</span>
                <code>{exportResult.jsonPath || '-'}</code>
              </div>
              <div>
                <span>Markdown</span>
                <code>{exportResult.markdownPath || '-'}</code>
              </div>
              <p>该导出只写入本地证据文件，不会提交 Amazon。下一步：补齐缺失项后重新导出，或到“交付验收”查看最终缺口。</p>
            </div>
          )}
          {message && <p className={message.includes('失败') ? 'blocked-line' : 'muted-line'}>{message}</p>}
        </Panel>

        <details className="details-panel">
          <summary>技术验收说明</summary>
          <div className="details-content">
            <p>最终验收仍以本地证据文件、截图路径、时间顺序和 manifest 聚合为准；业务页不展示长命令块。</p>
            <p>真实执行路径保持 fail-closed：没有审批、before、after、回读证据时不能声称执行完成。</p>
          </div>
        </details>
      </div>
    </div>
  );
}
