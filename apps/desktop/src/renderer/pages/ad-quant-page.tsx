import React, { useEffect, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { formatPercent, formatUsd } from '../formatters';
import type { AdStrategyDiagnosisView, AppRoute, BusinessQuantDiagnostic, BusinessQuantTimeline, SettingsRuleConfig } from '../types';

const DEFAULT_QUANT_RULE_CONFIG: Pick<SettingsRuleConfig, 'targetAcos' | 'highAcosThreshold' | 'noOrderClickThreshold' | 'minSpend'> = {
  targetAcos: 0.25,
  highAcosThreshold: 0.4,
  noOrderClickThreshold: 30,
  minSpend: 10,
};

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeRuleConfig(config: Partial<SettingsRuleConfig> | null | undefined) {
  return {
    targetAcos: readNumber(config?.targetAcos, DEFAULT_QUANT_RULE_CONFIG.targetAcos),
    highAcosThreshold: readNumber(config?.highAcosThreshold, DEFAULT_QUANT_RULE_CONFIG.highAcosThreshold),
    noOrderClickThreshold: readNumber(config?.noOrderClickThreshold, DEFAULT_QUANT_RULE_CONFIG.noOrderClickThreshold),
    minSpend: readNumber(config?.minSpend, DEFAULT_QUANT_RULE_CONFIG.minSpend),
  };
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function quantSourceLabel(source?: string): string {
  if (source === 'canonical_user_search_term') return '用户搜索词权威口径';
  if (source === 'canonical_search_term') return '搜索词总盘口径';
  if (source === 'actionable_fallback') return '可行动报表近似口径';
  return '未形成量化口径';
}

function quantSourceDescription(source?: string): string {
  if (source === 'canonical_user_search_term') return '总盘使用用户搜索词报表汇总，避免 campaign/ad group/placement 等报表重复累加。';
  if (source === 'canonical_search_term') return '总盘使用搜索词报表汇总，避免 campaign/ad group/placement 等报表重复累加。';
  if (source === 'actionable_fallback') return '未找到搜索词权威总表，暂用关键词、商品投放和自动投放等可行动报表近似汇总。';
  return '当前范围缺少真实原始报表或导入指标，不能计算广告表现。';
}

function lifecycleLabel(stage?: string): string {
  const labels: Record<string, string> = {
    cold_start: '冷启动',
    keyword_exploration: '测词',
    stable_conversion: '稳定转化',
    scaling: '放量',
    profit_harvesting: '利润收割',
    declining_repair: '异常修复',
    unknown: '阶段待判定',
  };
  return labels[stage || 'unknown'] || stage || '阶段待判定';
}

function quantStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    healthy: '健康',
    watch: '观察',
    waste: '浪费风险',
    scale: '可扩量',
    blocked: '样本不足',
  };
  return labels[status || 'blocked'] || status || '样本不足';
}

function trendLabel(value?: string): string {
  const labels: Record<string, string> = {
    up: '上升',
    down: '下降',
    flat: '平稳',
    insufficient: '样本不足',
  };
  return labels[value || 'insufficient'] || '样本不足';
}

function timelineTone(timeline: BusinessQuantTimeline): 'ready' | 'warning' | 'blocked' | 'pending' {
  if (timeline.quantStatus === 'waste') return 'blocked';
  if (timeline.quantStatus === 'scale') return 'ready';
  if (timeline.reviewRequired || timeline.quantStatus === 'watch') return 'warning';
  return 'pending';
}

function thresholdLine(timeline: BusinessQuantTimeline): string {
  return [
    `目标 ACOS ${formatPercent(Number(timeline.thresholds.targetAcos || 0) * 100)}`,
    `高风险 ${formatPercent(Number(timeline.thresholds.highAcosThreshold || 0) * 100)}`,
    `无订单 ${Number(timeline.thresholds.noOrderClickThreshold || 0)} 点击`,
    `止损 ${formatUsd(timeline.thresholds.minSpend)}`,
  ].join(' / ');
}

function thresholdSourceLine(): string {
  return '来源：当前规则配置；AI 动态阈值在“优化建议”生成时结合运营事件、产品阶段和每日趋势复核。';
}

function recommendationReadinessLabel(canDiagnose: boolean, diagnosticCount: number): string {
  if (!canDiagnose) return '缺真实数据，AI 不会被调用';
  if (diagnosticCount === 0) return '缺少可执行对象，先复核报表口径';
  return '可以进入 AI+规则建议';
}

function recommendationReadinessDetail(canDiagnose: boolean, diagnosticCount: number): string {
  if (!canDiagnose) return '先回到数据采集页确认真实 xlsx/xls/csv 和 DB 指标行。';
  if (diagnosticCount === 0) return '已有指标但没有 keyword/search term/target 等可执行诊断对象，建议先检查报表类型和粒度。';
  return '下一步进入优化建议页生成 AI+规则建议；审批和执行仍在后续页面。';
}

function ruleThresholdSummary(config: ReturnType<typeof normalizeRuleConfig>): string {
  return [
    `目标 ACOS ${formatPercent(config.targetAcos * 100)}`,
    `高风险 ${formatPercent(config.highAcosThreshold * 100)}`,
    `无订单 ${config.noOrderClickThreshold} 点击`,
    `最低花费 ${formatUsd(config.minSpend)}`,
  ].join(' / ');
}

function priorityReason(row: BusinessQuantDiagnostic, config: ReturnType<typeof normalizeRuleConfig>): string {
  if (row.orders === 0 && row.spend >= config.minSpend) return `花费达到 ${formatUsd(config.minSpend)} 仍无订单`;
  if (row.orders === 0 && row.clicks >= config.noOrderClickThreshold) return `点击达到 ${config.noOrderClickThreshold} 仍无订单`;
  if (row.acos >= config.highAcosThreshold && row.spend >= config.minSpend) return `ACOS 高于 ${formatPercent(config.highAcosThreshold * 100)}`;
  if (row.orders > 0 && row.acos <= config.targetAcos) return `ACOS 低于目标 ${formatPercent(config.targetAcos * 100)}`;
  if (row.clicks > 0 && row.sales === 0) return '有点击无销售';
  return '需人工复核相关性';
}

function priorityScore(row: BusinessQuantDiagnostic, config: ReturnType<typeof normalizeRuleConfig>): number {
  const noOrderPenalty = row.orders === 0 && (row.spend >= config.minSpend || row.clicks >= config.noOrderClickThreshold) ? 10000 : 0;
  const highAcosPenalty = row.acos >= config.highAcosThreshold && row.spend >= config.minSpend ? 5000 : 0;
  return noOrderPenalty + highAcosPenalty + row.spend + row.clicks * 0.1;
}

function aiThresholdValueLabel(key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'], value: number): string {
  if (key === 'targetAcos' || key === 'highAcosThreshold') return formatPercent(value * 100);
  if (key === 'minSpend') return formatUsd(value);
  return `${Math.round(value)} 点击`;
}

function aiThresholdLabel(key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']): string {
  const labels: Record<keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'], string> = {
    targetAcos: '目标 ACOS',
    highAcosThreshold: '高风险 ACOS',
    noOrderClickThreshold: '无订单点击',
    minSpend: '最低花费',
  };
  return labels[key];
}

function ruleThresholdValue(config: ReturnType<typeof normalizeRuleConfig>, key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']): number {
  if (key === 'targetAcos') return config.targetAcos;
  if (key === 'highAcosThreshold') return config.highAcosThreshold;
  if (key === 'noOrderClickThreshold') return config.noOrderClickThreshold;
  return config.minSpend;
}

function thresholdDeltaLabel(
  key: keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions'],
  ruleValue: number,
  aiValue: number,
): string {
  const delta = aiValue - ruleValue;
  if (Math.abs(delta) < 0.0001) return '与规则一致';
  const prefix = delta > 0 ? 'AI 更宽松' : 'AI 更严格';
  if (key === 'targetAcos' || key === 'highAcosThreshold') return `${prefix} ${formatPercent(Math.abs(delta) * 100)}`;
  if (key === 'minSpend') return `${prefix} ${formatUsd(Math.abs(delta))}`;
  return `${prefix} ${Math.round(Math.abs(delta))} 点击`;
}

function aiFallbackMessage(diagnosis: AdStrategyDiagnosisView | null): string {
  if (!diagnosis || diagnosis.summary.source === 'ai') return '';
  if (diagnosis.summary.fallbackReason?.includes('未配置 AI Key')) {
    return 'AI 未连接：当前只使用规则量化。可在设置页测试 DeepSeek 后重新分析。';
  }
  if (diagnosis.summary.fallbackReason) {
    return `AI 未参与：${diagnosis.summary.fallbackReason}。当前只使用规则量化。`;
  }
  return 'AI 未参与：当前只使用规则量化。';
}

export function AdQuantPage() {
  const { data, error, loading, scope } = useBusinessDataPipeline();
  const [ruleConfig, setRuleConfig] = useState(() => normalizeRuleConfig(null));
  const [strategyDiagnosis, setStrategyDiagnosis] = useState<AdStrategyDiagnosisView | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);
  const [strategyError, setStrategyError] = useState('');
  const quant = data?.quant;
  const collection = data?.collection;
  const operationEvents = data?.operations?.events || [];
  const canDiagnose = Boolean(collection?.realReportFiles.length && quant?.hasImportedMetrics);
  const visibleQuant = canDiagnose ? quant : undefined;
  const visibleDiagnostics = canDiagnose ? quant?.diagnostics || [] : [];
  const visibleTimelines = canDiagnose ? quant?.adObjectTimelines || [] : [];
  const sourceBatchIds = collection?.sourceBatchIds || (collection?.latestBatch?.id ? [collection.latestBatch.id] : []);
  const productContextCount = data?.productContext?.productCount ?? data?.productContext?.products?.length ?? 0;
  const productWithTargets = (data?.productContext?.products || []).filter((product) =>
    product.cost?.targetAcos || product.cost?.targetTacos || product.cost?.targetNetMargin || product.cost?.minPrice
  ).length;
  const realReportCount = collection?.fileAudit?.realReportFileCount ?? collection?.realReportFiles.length ?? 0;
  const importedRowCount = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const canonicalRows = quant?.canonicalRows ?? 0;
  const actionableRows = quant?.actionableRows ?? 0;
  const breakdownRows = quant?.breakdownRows ?? 0;
  const diagnosticCount = visibleDiagnostics.length;
  const highAcosRows = visibleDiagnostics.filter((row) => row.acos >= ruleConfig.highAcosThreshold && row.spend >= ruleConfig.minSpend);
  const noOrderSpend = visibleDiagnostics
    .filter((row) => row.orders === 0 && (row.spend >= ruleConfig.minSpend || row.clicks >= ruleConfig.noOrderClickThreshold))
    .reduce((sum, row) => sum + row.spend, 0);
  const topRisk = [...visibleDiagnostics].sort((a, b) => b.spend - a.spend)[0];
  const reviewQueue = [...visibleDiagnostics]
    .sort((a, b) => priorityScore(b, ruleConfig) - priorityScore(a, ruleConfig))
    .slice(0, 3);

  useEffect(() => {
    let cancelled = false;
    async function loadRuleConfig() {
      try {
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled) setRuleConfig(normalizeRuleConfig(config));
      } catch {
        if (!cancelled) setRuleConfig(normalizeRuleConfig(null));
      }
    }

    loadRuleConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runStrategyDiagnosis() {
    const api = (window as any).electronAPI;
    setStrategyLoading(true);
    setStrategyError('');
    try {
      if (!api?.runAdStrategyDiagnosis) {
        throw new Error('AI 阶段诊断接口未暴露。');
      }
      const result = await api.runAdStrategyDiagnosis({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        asin: scope.asin,
        batchId: scope.batchId || collection?.latestBatch?.id,
        limit: 300,
      });
      setStrategyDiagnosis(result);
    } catch (caught) {
      setStrategyError(caught instanceof Error ? caught.message : String(caught || 'AI 阶段诊断失败。'));
    } finally {
      setStrategyLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据与量化"
        title="广告量化"
        description="基于真实导入的广告指标展示总盘、效率和实体诊断。没有真实文件和导入指标时，本页只呈现阻断，不生成建议。"
        primaryTask="量化广告表现"
        nextAction={canDiagnose ? '复核高风险实体' : '返回数据采集'}
      />

      <div className="business-stack">
        <Panel title="当前范围" tone={canDiagnose ? 'success' : 'blocked'}>
          <div className="business-split">
            <div className="business-scope-line">
              <ScopeText scope={data?.scope || scope} />
            </div>
            <StatusPill tone={canDiagnose ? 'ready' : 'blocked'}>
              {canDiagnose ? '已接入真实导入指标' : '没有真实报表文件和导入指标，本页不生成建议。'}
            </StatusPill>
          </div>
          {canDiagnose && (
            <p className="muted-line">
              总盘口径：{quantSourceDescription(quant?.summarySource)}
            </p>
          )}
          {quant?.summaryWarning && <p className="warning-line">{quant.summaryWarning}</p>}
          {loading && <p className="muted-line">正在读取量化数据...</p>}
          {error && <p className="blocked-line">读取接口异常：{error}</p>}
        </Panel>

        <Panel title="数据来源与量化口径" tone={canDiagnose ? 'success' : 'blocked'}>
          <div className="business-grid business-grid-four">
            <div className="metric-tile">
              <span>真实原始报表</span>
              <strong>{realReportCount}/8</strong>
              <small>仅 .xlsx/.xls/.csv</small>
            </div>
            <div className="metric-tile">
              <span>导入指标行</span>
              <strong>{importedRowCount}</strong>
              <small>全部报表</small>
            </div>
            <div className="metric-tile">
              <span>量化口径</span>
              <strong>{quantSourceLabel(quant?.summarySource)}</strong>
              <small>{canonicalRows} 行可加总</small>
            </div>
            <div className="metric-tile">
              <span>实体诊断</span>
              <strong>{diagnosticCount}</strong>
              <small>{actionableRows} 行可生成建议</small>
            </div>
            <div className="metric-tile">
              <span>对象时间线</span>
              <strong>{visibleTimelines.length}</strong>
              <small>按广告对象聚合每日表现</small>
            </div>
            <div className="metric-tile">
              <span>分解报表行</span>
              <strong>{breakdownRows}</strong>
              <small>只用于 drilldown</small>
            </div>
          </div>
          <div className="business-split">
            <div>
              <p className="muted-line">批次：{sourceBatchIds.length ? sourceBatchIds.join('、') : '暂无匹配批次'}</p>
              <p className="muted-line">{quantSourceDescription(quant?.summarySource)}</p>
              {quant?.summaryWarning && <p className="warning-line">{quant.summaryWarning}</p>}
            </div>
            <div className="business-pill-row business-pill-row-right">
              <StatusPill tone={realReportCount > 0 ? 'ready' : 'blocked'}>真实文件 {realReportCount}</StatusPill>
              <StatusPill tone={importedRowCount > 0 ? 'ready' : 'blocked'}>全部指标 {importedRowCount}</StatusPill>
              <StatusPill tone={canonicalRows > 0 ? 'ready' : 'blocked'}>可加总 {canonicalRows}</StatusPill>
              <StatusPill tone={actionableRows > 0 ? 'ready' : 'blocked'}>可建议 {actionableRows}</StatusPill>
              <StatusPill tone={diagnosticCount > 0 ? 'ready' : 'pending'}>诊断 {diagnosticCount}</StatusPill>
            </div>
          </div>
          <div className="business-pill-row">
            <StatusPill tone="pending">目标 ACOS {formatPercent(ruleConfig.targetAcos * 100)}</StatusPill>
            <StatusPill tone="warning">风险 ACOS {formatPercent(ruleConfig.highAcosThreshold * 100)}</StatusPill>
            <StatusPill tone="pending">无订单 {ruleConfig.noOrderClickThreshold} 点击</StatusPill>
            <StatusPill tone="pending">最低花费 {formatUsd(ruleConfig.minSpend)}</StatusPill>
          </div>
        </Panel>

        <Panel title="阈值与策略来源" tone={canDiagnose ? 'success' : 'warning'}>
          <div className="context-summary-grid">
            <div>
              <span>规则量化</span>
              <strong>当前页先用确定性规则打底</strong>
              <p>目标 ACOS、风险 ACOS、无订单点击、最低花费和 bid 调整比例来自设置页，结果可复现。</p>
            </div>
            <div>
              <span>AI 阶段诊断</span>
              <strong>{strategyDiagnosis ? `${strategyDiagnosis.summary.source === 'ai' ? 'AI 已分析' : '规则 fallback'} / ${lifecycleLabel(strategyDiagnosis.summary.lifecycleStage)}` : '可在本页运行'}</strong>
              <p>DeepSeek 会结合每日广告事实、运营事件、产品配置和规则结果，给出动态阈值和解释，不写入广告账户。</p>
            </div>
            <div>
              <span>人工覆盖</span>
              <strong>审批前保留人工判断</strong>
              <p>折扣、BD、大促、调价、库存或 Listing 变更会改变阈值解释，必须先在运营事件中记录。</p>
            </div>
            <div>
              <span>执行边界</span>
              <strong>量化不直接改广告</strong>
              <p>本页只排序风险和机会；真实广告动作仍需优化建议、审批、截图和 readback。</p>
            </div>
          </div>
          <p className="muted-line">{thresholdSourceLine()}</p>
          <div className="action-row">
            <button className="secondary-button" onClick={() => navigate('settings')} type="button">
              调整规则阈值
            </button>
            <button className="secondary-button" onClick={() => navigate('operation-events')} type="button">
              记录运营事件
            </button>
            <button className="secondary-button" disabled={!canDiagnose || strategyLoading} onClick={runStrategyDiagnosis} type="button">
              {strategyLoading ? 'AI 分析中...' : '运行 AI 阶段分析'}
            </button>
            <button className="primary-button" disabled={!canDiagnose || diagnosticCount === 0} onClick={() => navigate('recommendations')} type="button">
              进入 AI+规则建议
            </button>
          </div>
          {strategyError && <p className="blocked-line">AI 阶段分析失败：{strategyError}</p>}
          {strategyDiagnosis && (
            <div className="strategy-diagnosis-panel">
              <div className="business-split">
                <div>
                  <div className="business-scope-line">
                    {strategyDiagnosis.summary.source === 'ai' ? 'AI 动态阈值建议' : '规则 fallback 阈值建议'}
                  </div>
                  <p className="muted-line">
                    模型：{strategyDiagnosis.model}；输入 {strategyDiagnosis.metrics} 行广告指标、{strategyDiagnosis.ruleCandidateCount} 条规则候选、{strategyDiagnosis.summary.operationEventCount} 条运营事件、{strategyDiagnosis.summary.productContextCount} 个产品配置。
                  </p>
                  <p>{strategyDiagnosis.summary.summary}</p>
                  {strategyDiagnosis.summary.fallbackReason && <p className="warning-line">{strategyDiagnosis.summary.fallbackReason}</p>}
                  {aiFallbackMessage(strategyDiagnosis) && <p className="blocked-line">{aiFallbackMessage(strategyDiagnosis)}</p>}
                </div>
                <div className="business-pill-row business-pill-row-right">
                  <StatusPill tone={strategyDiagnosis.summary.source === 'ai' ? 'ready' : 'warning'}>{strategyDiagnosis.summary.source === 'ai' ? 'AI 已参与' : '规则兜底'}</StatusPill>
                  <StatusPill tone="pending">{lifecycleLabel(strategyDiagnosis.summary.lifecycleStage)}</StatusPill>
                  <StatusPill tone={strategyDiagnosis.summary.aiCandidateCount > 0 ? 'ready' : 'pending'}>AI 候选 {strategyDiagnosis.summary.aiCandidateCount}</StatusPill>
                  <StatusPill tone={strategyDiagnosis.summary.productContextCount > 0 ? 'ready' : 'warning'}>产品配置 {strategyDiagnosis.summary.productContextCount}</StatusPill>
                </div>
              </div>
              <div className="context-summary-grid">
                {(Object.keys(strategyDiagnosis.summary.thresholdSuggestions) as Array<keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']>).map((key) => {
                  const aiItem = strategyDiagnosis.summary.thresholdSuggestions[key];
                  const ruleValue = ruleThresholdValue(ruleConfig, key);
                  return (
                    <div key={`compare-${key}`}>
                      <span>{aiThresholdLabel(key)} 对比</span>
                      <strong>规则 {aiThresholdValueLabel(key, ruleValue)} / AI {aiThresholdValueLabel(key, aiItem.value)}</strong>
                      <p>{thresholdDeltaLabel(key, ruleValue, aiItem.value)}。AI 理由：{aiItem.reason}</p>
                    </div>
                  );
                })}
              </div>
              <div className="strategy-acceptance-note">
                <strong>最终采用方式</strong>
                <p>
                  规则阈值继续作为确定性安全边界；AI 阈值只作为当前范围的阶段诊断建议。
                  运营确认后可到设置页调整规则阈值，或进入优化建议页生成可审批动作。
                </p>
              </div>
              <div className="context-summary-grid">
                {(Object.keys(strategyDiagnosis.summary.thresholdSuggestions) as Array<keyof AdStrategyDiagnosisView['summary']['thresholdSuggestions']>).map((key) => {
                  const item = strategyDiagnosis.summary.thresholdSuggestions[key];
                  return (
                    <div key={key}>
                      <span>{aiThresholdLabel(key)}</span>
                      <strong>{aiThresholdValueLabel(key, item.value)}</strong>
                      <p>{item.reason}</p>
                    </div>
                  );
                })}
              </div>
              {(strategyDiagnosis.summary.mainProblems.length > 0 || strategyDiagnosis.summary.riskWarnings.length > 0) && (
                <ul className="business-list">
                  {strategyDiagnosis.summary.mainProblems.map((item) => <li key={`problem-${item}`}>问题：{item}</li>)}
                  {strategyDiagnosis.summary.riskWarnings.map((item) => <li key={`risk-${item}`}>风险：{item}</li>)}
                </ul>
              )}
            </div>
          )}
        </Panel>

        <Panel title="AI+规则建议输入检查" tone={canDiagnose && diagnosticCount > 0 ? 'success' : 'warning'}>
          <div className="context-summary-grid">
            <div>
              <span>真实数据输入</span>
              <strong>{realReportCount} 个表格 / {importedRowCount} 行指标</strong>
              <p>只读取当前范围真实 xlsx/xls/csv 和 DB 指标，不使用审计 JSON 代替广告数据。</p>
            </div>
            <div>
              <span>可行动对象</span>
              <strong>{diagnosticCount} 个诊断 / {actionableRows} 行可建议</strong>
              <p>只有 keyword、search term、target 等可执行口径会进入建议生成。</p>
            </div>
            <div>
              <span>产品阶段线索</span>
              <strong>{visibleTimelines.length} 条对象时间线 / {productContextCount} 个产品配置</strong>
              <p>AI 会结合对象生命周期、产品阶段、成本目标和趋势判断当前推广阶段。</p>
            </div>
            <div>
              <span>运营事件</span>
              <strong>{operationEvents.length} 条事件</strong>
              <p>Coupon、BD、调价、库存和 Listing 事件会进入 AI 上下文。</p>
            </div>
            <div>
              <span>规则阈值</span>
              <strong>{ruleThresholdSummary(ruleConfig)}</strong>
              <p>规则先给出可复现候选，AI 再复核阶段、动态阈值和异常解释。</p>
            </div>
            <div>
              <span>产品目标</span>
              <strong>{productWithTargets} 个产品有目标阈值</strong>
              <p>{productWithTargets ? '目标 ACOS、TACOS、净利率和最低价会约束 AI 阈值建议。' : '未维护产品目标时，AI 只能按广告表现估算阈值。'}</p>
            </div>
            <div>
              <span>建议入口</span>
              <strong>{recommendationReadinessLabel(canDiagnose, diagnosticCount)}</strong>
              <p>{recommendationReadinessDetail(canDiagnose, diagnosticCount)}</p>
            </div>
          </div>
          <div className="business-split">
            <div className="business-pill-row">
              <StatusPill tone={sourceBatchIds.length ? 'ready' : 'blocked'}>批次 {sourceBatchIds.length || 0}</StatusPill>
              <StatusPill tone={realReportCount > 0 ? 'ready' : 'blocked'}>真实文件 {realReportCount}/8</StatusPill>
              <StatusPill tone={importedRowCount > 0 ? 'ready' : 'blocked'}>DB 指标 {importedRowCount}</StatusPill>
              <StatusPill tone={operationEvents.length ? 'ready' : 'warning'}>运营事件 {operationEvents.length}</StatusPill>
              <StatusPill tone={actionableRows > 0 ? 'ready' : 'blocked'}>可建议对象 {actionableRows}</StatusPill>
            </div>
            <div className="action-row">
              <button className="secondary-button" onClick={() => navigate('operation-events')} type="button">
                补充运营事件
              </button>
              <button className="secondary-button" onClick={() => navigate('data-collection')} type="button">
                返回数据采集
              </button>
              <button className="primary-button" disabled={!canDiagnose || diagnosticCount === 0} onClick={() => navigate('recommendations')} type="button">
                去生成 AI+规则建议
              </button>
            </div>
          </div>
        </Panel>

        {canDiagnose && (
          <Panel title="运营事件上下文" tone={operationEvents.length ? 'success' : 'warning'}>
            <div className="business-split">
              <div>
                <div className="business-scope-line">
                  当前范围记录了 {operationEvents.length} 条运营事件
                </div>
                <p className="muted-line">
                  AI 阶段判断和动态阈值建议会参考这些事件，避免把 Coupon、BD、价格、Listing 或库存造成的波动误判成广告本身问题。
                </p>
              </div>
              <div className="action-row">
                <button className="secondary-button" onClick={() => navigate('operation-events')} type="button">
                  维护运营事件
                </button>
              </div>
            </div>
            {operationEvents.length > 0 && (
              <div className="context-summary-grid">
                {operationEvents.slice(0, 3).map((event) => (
                  <div key={event.id}>
                    <span>{event.eventDate} / {event.eventType}</span>
                    <strong>{event.title}</strong>
                    <p>{event.asin || '全范围'} / {event.impactExpectation || '影响待观察'}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}

        {canDiagnose && (
          <Panel title="产品/广告对象阶段时间线" tone={visibleTimelines.length ? 'success' : 'warning'}>
            {visibleTimelines.length ? (
              <div className="business-card-list">
                {visibleTimelines.slice(0, 8).map((timeline) => (
                  <div className="timeline-card" key={timeline.objectKey}>
                    <div className="timeline-card-header">
                      <div>
                        <span>{timeline.objectType} / {timeline.dateFrom} 至 {timeline.dateTo}</span>
                        <strong>{timeline.objectName}</strong>
                        <p>{timeline.campaignName || '-'} / {timeline.adGroupName || '-'} / {timeline.asin || '-'}</p>
                      </div>
                      <div className="business-pill-row business-pill-row-right">
                        <StatusPill tone={timelineTone(timeline)}>{lifecycleLabel(timeline.lifecycleStage)}</StatusPill>
                        <StatusPill tone={timelineTone(timeline)}>{quantStatusLabel(timeline.quantStatus)}</StatusPill>
                      </div>
                    </div>
                    <div className="timeline-metrics">
                      <div><span>花费</span><strong>{formatUsd(timeline.totals.cost)}</strong></div>
                      <div><span>销售</span><strong>{formatUsd(timeline.totals.sales)}</strong></div>
                      <div><span>订单</span><strong>{timeline.totals.orders}</strong></div>
                      <div><span>ACOS</span><strong>{formatPercent(timeline.totals.acos * 100)}</strong></div>
                      <div><span>CVR</span><strong>{formatPercent(timeline.totals.cvr * 100)}</strong></div>
                      <div><span>活跃天数</span><strong>{timeline.daysActive}</strong></div>
                    </div>
                    <div className="timeline-footer">
                      <p className="muted-line">
                        趋势：花费{trendLabel(timeline.trend.spend)} / 销售{trendLabel(timeline.trend.sales)}。阈值：{thresholdLine(timeline)}
                      </p>
                      <p className="muted-line">{thresholdSourceLine()}</p>
                      <p className={timeline.quantStatus === 'waste' ? 'blocked-line' : 'muted-line'}>
                        {timeline.recommendedAction
                          ? `建议方向：${timeline.recommendedAction}${timeline.recommendedValue ? ` -> ${timeline.recommendedValue}` : ''}`
                          : timeline.reasons[0] || '当前对象暂无明确动作，继续观察。'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-line">当前范围已有指标，但没有形成可展示的广告对象时间线。</p>
            )}
          </Panel>
        )}

        {canDiagnose && (
          <Panel title="主要问题摘要" tone="warning">
            <div className="issue-summary-grid">
              <div className="issue-card">
                <span>总盘结论</span>
                <strong>{(visibleQuant?.acos ?? 0) >= ruleConfig.highAcosThreshold ? 'ACOS 偏高' : '效率待复核'}</strong>
                <p>{formatUsd(visibleQuant?.totalSpend)} 花费 / {visibleQuant?.totalOrders ?? 0} 单 / ACOS {formatPercent((visibleQuant?.acos ?? 0) * 100)}</p>
              </div>
              <div className="issue-card">
                <span>高 ACOS 实体</span>
                <strong>{highAcosRows.length}</strong>
                <p>优先看花费达到 {formatUsd(ruleConfig.minSpend)} 且 ACOS 超过 {formatPercent(ruleConfig.highAcosThreshold * 100)} 的对象。</p>
              </div>
              <div className="issue-card">
                <span>无订单花费</span>
                <strong>{formatUsd(noOrderSpend)}</strong>
                <p>有点击/花费但无订单的对象，先人工确认是否降价或否定。</p>
              </div>
              <div className="issue-card">
                <span>优先复核对象</span>
                <strong>{topRisk?.objectName || '暂无'}</strong>
                <p>{topRisk ? `${topRisk.campaignName || '-'} / ${topRisk.adGroupName || '-'} / ${formatUsd(topRisk.spend)}` : '没有可复核明细。'}</p>
              </div>
            </div>
          </Panel>
        )}

        {canDiagnose && (
          <Panel title="复核队列" tone={reviewQueue.length ? 'warning' : 'default'}>
            {reviewQueue.length ? (
              <div className="context-summary-grid">
                {reviewQueue.map((row, index) => (
                  <div key={`${row.campaignName || '-'}-${row.adGroupName || '-'}-${row.objectName || '-'}-${index}`}>
                    <span>#{index + 1} {priorityReason(row, ruleConfig)}</span>
                    <strong>{row.objectName || row.campaignName || '-'}</strong>
                    <p>{row.campaignName || '-'} / {row.adGroupName || '-'} / {formatUsd(row.spend)} 花费 / {row.orders} 单 / ACOS {formatPercent(row.acos * 100)}</p>
                  </div>
                ))}
                {reviewQueue.length < 3 && (
                  <div>
                    <span>队列说明</span>
                    <strong>已展示全部对象</strong>
                    <p>复核队列按无订单花费、高 ACOS、花费和点击排序。</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="muted-line">当前范围暂无需要排序的诊断对象。</p>
            )}
            <p className="muted-line">复核队列只用于决定先看哪几行；真正的广告动作仍需进入优化建议、审批和执行回读。</p>
          </Panel>
        )}

        {canDiagnose && (
          <Panel title="量化后动作">
            <div className="business-split">
              <div>
                <div className="business-scope-line">
                  {diagnosticCount > 0 ? '可以进入优化建议，但仍需人工审批和回读。' : '已有指标，但暂无可复核实体诊断。'}
                </div>
                <p className="muted-line">
                  优化建议会继续绑定当前范围、真实批次和来源文件；广告调整不会自动批量写入，必须经过审批、截图和 readback。
                </p>
              </div>
              <div className="action-row">
                <button className="secondary-button" onClick={() => navigate('data-collection')} type="button">
                  回到数据采集
                </button>
                <button className="primary-button" disabled={diagnosticCount === 0} onClick={() => navigate('recommendations')} type="button">
                  去生成优化建议
                </button>
              </div>
            </div>
          </Panel>
        )}

        {canDiagnose && (
          <div className="business-grid business-grid-four">
            <div className="metric-tile">
              <span>总花费</span>
              <strong>{formatUsd(visibleQuant?.totalSpend)}</strong>
            </div>
            <div className="metric-tile">
              <span>总销售</span>
              <strong>{formatUsd(visibleQuant?.totalSales)}</strong>
            </div>
            <div className="metric-tile">
              <span>总订单</span>
              <strong>{visibleQuant?.totalOrders ?? 0}</strong>
            </div>
            <div className="metric-tile">
              <span>ACOS</span>
              <strong>{formatPercent((visibleQuant?.acos ?? 0) * 100)}</strong>
            </div>
            <div className="metric-tile">
              <span>CVR</span>
              <strong>{formatPercent((visibleQuant?.cvr ?? 0) * 100)}</strong>
            </div>
            <div className="metric-tile">
              <span>CPC</span>
              <strong>{formatUsd(visibleQuant?.cpc)}</strong>
            </div>
            <div className="metric-tile">
              <span>浪费/高风险占位</span>
              <strong>{visibleQuant?.wastedSpend === null || visibleQuant?.wastedSpend === undefined ? '待真实数据' : formatUsd(visibleQuant.wastedSpend)}</strong>
            </div>
            <div className="metric-tile">
              <span>高风险实体</span>
              <strong>{visibleQuant?.highRiskCount ?? 0}</strong>
            </div>
          </div>
        )}

        {!canDiagnose && (
          <Panel title="量化阻断" tone="blocked">
            <ul className="business-list">
              {(quant?.blockers.length ? quant.blockers : ['没有真实报表文件和导入指标，本页不生成建议。']).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {!collection?.realReportFiles.length && <li>当前范围还没有可量化的真实广告数据</li>}
            </ul>
            <div className="action-row">
              <button className="primary-button" onClick={() => navigate('data-collection')} type="button">
                去数据采集
              </button>
            </div>
          </Panel>
        )}

        <Panel title="实体诊断">
          <div className="table-wrap">
            <table className="business-table diagnostic-table">
              <thead>
                <tr>
                  <th>广告组合</th>
                  <th>广告活动</th>
                  <th>广告组</th>
                  <th>产品/ASIN</th>
                  <th>对象类型</th>
                  <th>关键词/搜索词/投放对象</th>
                  <th>花费</th>
                  <th>销售</th>
                  <th>订单</th>
                  <th>点击</th>
                  <th>ACOS</th>
                  <th>CVR</th>
                  <th>CPC</th>
                  <th>诊断</th>
                  <th>建议方向</th>
                </tr>
              </thead>
              <tbody>
                {visibleDiagnostics.map((row, index) => (
                  <tr key={`${row.campaignName || '-'}-${row.objectName || '-'}-${index}`}>
                    <td>{row.portfolioName || '-'}</td>
                    <td>{row.campaignName || '-'}</td>
                    <td>{row.adGroupName || '-'}</td>
                    <td>{row.asin || '-'}</td>
                    <td>{row.objectType || '-'}</td>
                    <td>{row.objectName || '-'}</td>
                    <td>{formatUsd(row.spend)}</td>
                    <td>{formatUsd(row.sales)}</td>
                    <td>{row.orders}</td>
                    <td>{row.clicks}</td>
                    <td>{formatPercent(row.acos * 100)}</td>
                    <td>{formatPercent(row.cvr * 100)}</td>
                    <td>{formatUsd(row.cpc)}</td>
                    <td>{row.diagnosis}</td>
                    <td>{row.suggestedDirection}</td>
                  </tr>
                ))}
                {!visibleDiagnostics.length && (
                  <tr>
                    <td colSpan={15}>没有真实报表文件和导入指标，本页不生成建议。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
