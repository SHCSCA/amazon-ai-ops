import React, { useEffect, useMemo, useState } from 'react';
import { useBusinessDataPipeline, ScopeText } from '../components/business-data';
import { PageHeader, Panel, StatusPill } from '../components/ui';
import { compactPath, formatPercent, formatUsd } from '../formatters';
import type { AppRoute, RecommendationView, SettingsRuleConfig } from '../types';
import { toUserFacingError } from '../user-facing-error';

const DEFAULT_DASHBOARD_RULE_CONFIG = {
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
    targetAcos: readNumber(config?.targetAcos, DEFAULT_DASHBOARD_RULE_CONFIG.targetAcos),
    highAcosThreshold: readNumber(config?.highAcosThreshold, DEFAULT_DASHBOARD_RULE_CONFIG.highAcosThreshold),
    noOrderClickThreshold: readNumber(config?.noOrderClickThreshold, DEFAULT_DASHBOARD_RULE_CONFIG.noOrderClickThreshold),
    minSpend: readNumber(config?.minSpend, DEFAULT_DASHBOARD_RULE_CONFIG.minSpend),
  };
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

function collectionStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    ready: '真实报表可用',
    partial: '部分报表可用',
    blocked: '缺少真实报表',
  };
  return labels[status || 'blocked'] || '缺少真实报表';
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : false;
}

function normalizeBaseUrl(value: unknown): string {
  return readString(value).replace(/\/+$/, '');
}

function dashboardAiStatus(settings: Record<string, unknown> | null | undefined): {
  label: string;
  detail: string;
  tone: 'ready' | 'pending' | 'blocked' | 'warning';
} {
  if (!settings) {
    return {
      label: 'AI 状态未读取',
      detail: '设置接口不可用时，建议仍可使用规则 fallback，但不会标记 AI 已参与。',
      tone: 'pending',
    };
  }
  const keyConfigured = readBoolean(settings.aiKeyConfigured ?? settings.ai_key_configured)
    || Boolean(readString(settings.aiApiKey ?? settings.ai_api_key));
  const baseUrl = readString(settings.aiBaseUrl ?? settings.ai_base_url) || 'https://api.deepseek.com';
  const model = readString(settings.aiModel ?? settings.ai_model) || 'deepseek-v4-flash';
  const testedBase = normalizeBaseUrl(settings.aiLastTestBaseUrl ?? settings.ai_last_test_base_url);
  const testedModel = readString(settings.aiLastTestModel ?? settings.ai_last_test_model);
  const testStatus = readString(settings.aiLastTestStatus ?? settings.ai_last_test_status);
  if (!keyConfigured) {
    return {
      label: 'AI 未配置',
      detail: '未配置 DeepSeek/OpenAI Compatible Key，优化建议会回落到规则解释。',
      tone: 'warning',
    };
  }
  if (testedBase === normalizeBaseUrl(baseUrl) && testedModel === model && testStatus === 'available') {
    return {
      label: 'AI 可用',
      detail: `${model} 已测试通过；生成建议时参与阶段诊断和动态阈值。`,
      tone: 'ready',
    };
  }
  if (testedBase === normalizeBaseUrl(baseUrl) && testedModel === model && testStatus === 'failed') {
    return {
      label: 'AI 测试失败',
      detail: readString(settings.aiLastTestMessage ?? settings.ai_last_test_message) || '最近一次连接测试失败，需要到 AI 设置复测。',
      tone: 'blocked',
    };
  }
  return {
    label: 'AI 待测试',
    detail: `${model} 已配置但当前 Base URL/模型未完成可用性测试。`,
    tone: 'pending',
  };
}

export function DashboardPage() {
  const { data, error, loading, scope } = useBusinessDataPipeline();
  const [pathNotice, setPathNotice] = useState<string | null>(null);
  const [ruleConfig, setRuleConfig] = useState(() => normalizeRuleConfig(null));
  const [aiStatus, setAiStatus] = useState(() => dashboardAiStatus(null));
  const [pendingRecommendations, setPendingRecommendations] = useState<RecommendationView[]>([]);
  const collection = data?.collection;
  const quant = data?.quant;
  const hasRealFiles = Boolean(collection?.realReportFiles.length);
  const hasMetrics = Boolean(quant?.hasImportedMetrics);
  const isQuantifiable = hasRealFiles && hasMetrics;
  const acosPercent = (quant?.acos ?? 0) * 100;
  const operatingJudgment = isQuantifiable
    ? (quant?.acos ?? 0) >= ruleConfig.highAcosThreshold
      ? 'ACOS 偏高，先复核高花费/低转化对象'
      : quant?.totalOrders
        ? '已有订单，优先复核可降本与可扩量对象'
        : '已有花费但缺订单，先定位浪费对象'
    : '当前范围缺少真实报表或导入指标';
  const operatingNextRoute: AppRoute = isQuantifiable ? 'ad-quant' : hasRealFiles ? 'data-import-validation' : 'data-collection';
  const realReportCount = collection?.realReportFiles.length ?? 0;
  const importedRows = collection?.fileAudit?.importedRowCount ?? quant?.importedRows ?? 0;
  const canonicalRows = quant?.canonicalRows ?? 0;
  const actionableRows = quant?.actionableRows ?? 0;
  const breakdownRows = quant?.breakdownRows ?? 0;
  const operationEventCount = data?.operations?.eventCount ?? data?.operations?.events?.length ?? 0;
  const topDiagnostic = quant?.diagnostics?.[0];
  const highAcosDiagnostics = (quant?.diagnostics || []).filter((item) => item.acos >= ruleConfig.highAcosThreshold && item.spend >= ruleConfig.minSpend);
  const noOrderDiagnostics = (quant?.diagnostics || []).filter((item) => item.orders === 0 && (item.spend >= ruleConfig.minSpend || item.clicks >= ruleConfig.noOrderClickThreshold));
  const actionQueue = useMemo(() => {
    if (!hasRealFiles) {
      return [
        { title: '补齐真实报表', detail: '先下载或重新创建当前范围 8 类 Lingxing 广告报表。', route: 'data-collection' as AppRoute, tone: 'blocked' as const },
      ];
    }
    if (!hasMetrics) {
      return [
        { title: '导入广告指标', detail: '当前已有表格，但还没有入库指标，先进入数据导入与校验页写入 SQLite。', route: 'data-import-validation' as AppRoute, tone: 'warning' as const },
      ];
    }
    return [
      {
        title: highAcosDiagnostics.length ? '先复核高 ACOS' : '复核量化明细',
        detail: highAcosDiagnostics.length
          ? `${highAcosDiagnostics.length} 个对象超过 ${formatPercent(ruleConfig.highAcosThreshold * 100)} 且花费达到 ${formatUsd(ruleConfig.minSpend)}。`
          : '暂无超过风险线的对象，仍需检查高花费和相关性。',
        route: 'ad-quant' as AppRoute,
        tone: highAcosDiagnostics.length ? 'warning' as const : 'pending' as const,
      },
      {
        title: noOrderDiagnostics.length ? '处理无订单花费' : '检查无订单风险',
        detail: noOrderDiagnostics.length
          ? `${noOrderDiagnostics.length} 个对象达到无订单阈值，先判断是否降价、否词或暂停。`
          : `无订单对象未达到 ${ruleConfig.noOrderClickThreshold} 点击或 ${formatUsd(ruleConfig.minSpend)} 门槛。`,
        route: 'ad-quant' as AppRoute,
        tone: noOrderDiagnostics.length ? 'warning' as const : 'pending' as const,
      },
      {
        title: '生成优化建议',
        detail: '量化复核后进入建议页生成 AI/规则解释，再走审批和回读。',
        route: 'recommendations' as AppRoute,
        tone: 'pending' as const,
      },
    ];
  }, [hasMetrics, hasRealFiles, highAcosDiagnostics.length, noOrderDiagnostics.length, ruleConfig.highAcosThreshold, ruleConfig.minSpend, ruleConfig.noOrderClickThreshold]);
  const dataGateLabel = isQuantifiable
    ? '已具备量化条件'
    : hasRealFiles
      ? '已有表格，待导入指标'
      : '缺真实广告表格';
  const dataGateDetail = isQuantifiable
    ? `${realReportCount} 个真实表格，${importedRows} 行广告指标，其中 ${actionableRows} 行可生成建议。`
    : hasRealFiles
      ? `${realReportCount} 个真实表格尚未导入量化指标。`
      : '还没有 xlsx/xls/csv 原始广告表格，不能计算 ACOS 或生成建议。';
  const workflowSteps = [
    {
      route: 'data-collection' as AppRoute,
      title: '1. 获取真实报表',
      status: hasRealFiles ? '已拿到原始文件' : '缺原始文件',
      tone: hasRealFiles ? 'ready' : 'blocked',
      next: hasRealFiles ? '查看文件与导入结果' : '去数据采集',
    },
    {
      route: hasMetrics ? 'ad-quant' as AppRoute : hasRealFiles ? 'data-import-validation' as AppRoute : 'data-collection' as AppRoute,
      title: '2. 广告量化',
      status: hasMetrics ? `${actionableRows} 行可生成建议` : '缺可行动指标',
      tone: isQuantifiable ? 'ready' : 'blocked',
      next: isQuantifiable ? '复核量化诊断' : hasRealFiles ? '去导入校验' : '先下载报表',
    },
    {
      route: 'recommendations' as AppRoute,
      title: '3. 生成建议',
      status: isQuantifiable ? '可生成建议' : '等待真实数据',
      tone: isQuantifiable ? 'pending' : 'blocked',
      next: isQuantifiable ? '生成优化建议' : '先完成量化',
    },
    {
      route: isQuantifiable ? 'approval' as AppRoute : 'data-collection' as AppRoute,
      title: '4. 审批与执行回读',
      status: isQuantifiable ? '建议生成后进入审批' : '等待真实数据',
      tone: isQuantifiable ? 'pending' : 'blocked',
      next: isQuantifiable ? '去审批中心' : '先完成量化',
    },
  ] as const;

  useEffect(() => {
    let cancelled = false;
    async function loadDashboardContext() {
      try {
        const config = await (window as any).electronAPI?.getRuleConfig?.();
        if (!cancelled) setRuleConfig(normalizeRuleConfig(config));
      } catch {
        if (!cancelled) setRuleConfig(normalizeRuleConfig(null));
      }
      try {
        const settings = await (window as any).electronAPI?.getSettings?.();
        if (!cancelled) setAiStatus(dashboardAiStatus(settings));
      } catch {
        if (!cancelled) setAiStatus(dashboardAiStatus(null));
      }
      try {
        const rows = await (window as any).electronAPI?.getRecommendations?.({
          dateFrom: scope.dateFrom,
          dateTo: scope.dateTo,
          storeName: scope.storeName,
          marketplaceCode: scope.marketplaceCode,
          asin: scope.asin,
          batchId: scope.batchId || data?.collection.latestBatch?.id,
          status: 'pending',
          limit: 20,
        });
        if (!cancelled) setPendingRecommendations(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setPendingRecommendations([]);
      }
    }

    loadDashboardContext();
    return () => {
      cancelled = true;
    };
  }, [data?.collection.latestBatch?.id, scope.asin, scope.batchId, scope.dateFrom, scope.dateTo, scope.marketplaceCode, scope.storeName]);

  async function openPath(targetPath: string) {
    try {
      await (window as any).electronAPI?.openReportPath?.(targetPath);
      setPathNotice(`已请求打开：${compactPath(targetPath)}`);
    } catch (caught) {
      setPathNotice(`打开失败：${toUserFacingError(caught, '打开路径失败。')}`);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="运营总览"
        title="仪表盘"
        description="从当前运营范围判断真实广告数据是否已经可量化，并把风险、下一步和证据路径放在同一屏。"
        primaryTask="确认是否可量化"
        nextAction={isQuantifiable ? '进入广告量化复核' : '先完成真实报表采集和导入'}
      />

      <div className="business-stack">
        <Panel title="数据健康" tone={isQuantifiable ? 'success' : 'blocked'}>
          <div className="context-summary-grid">
            <div>
              <span>当前范围</span>
              <strong>{scope.dateFrom} 至 {scope.dateTo}</strong>
              <p>{scope.storeName || '-'} / {scope.marketplaceCode || '-'} / USD{scope.batchId ? ` / ${scope.batchId}` : ''}</p>
            </div>
            <div>
              <span>真实报表</span>
              <strong>{realReportCount}/8</strong>
              <p>{hasRealFiles ? '已找到当前范围真实表格。' : '缺少当前范围原始广告表格。'}</p>
            </div>
            <div>
              <span>已导入指标</span>
              <strong>{importedRows} 行</strong>
              <p>{hasMetrics ? `${actionableRows} 行可生成建议。` : '需要先导入 SQLite 后才能量化。'}</p>
            </div>
            <div>
              <span>AI</span>
              <strong>{aiStatus.label}</strong>
              <p>{aiStatus.detail}</p>
            </div>
            <div>
              <span>待审批建议</span>
              <strong>{pendingRecommendations.length}</strong>
              <p>{pendingRecommendations.length ? '先审批，再执行和回读。' : '暂无待审批建议。'}</p>
            </div>
            <div>
              <span>广告花费</span>
              <strong>{isQuantifiable ? formatUsd(quant?.totalSpend) : '-'}</strong>
              <p>{isQuantifiable ? `点击 ${quant?.totalClicks ?? 0}，CPC ${formatUsd(quant?.cpc)}。` : '等待真实指标导入。'}</p>
            </div>
            <div>
              <span>广告销售 / 订单</span>
              <strong>{isQuantifiable ? `${formatUsd(quant?.totalSales)} / ${quant?.totalOrders ?? 0}` : '-'}</strong>
              <p>{isQuantifiable ? `CVR ${formatPercent((quant?.cvr ?? 0) * 100)}。` : '等待真实指标导入。'}</p>
            </div>
            <div>
              <span>ACOS</span>
              <strong>{isQuantifiable ? formatPercent(acosPercent) : '-'}</strong>
              <p>{isQuantifiable ? `风险线 ${formatPercent(ruleConfig.highAcosThreshold * 100)}。` : '未量化前不下结论。'}</p>
            </div>
          </div>
        </Panel>

        <Panel title="今天先做什么">
          <div className="workflow-strip">
            {workflowSteps.map((step) => (
              <button className="workflow-step" key={step.route} onClick={() => navigate(step.route)} type="button">
                <span>{step.title}</span>
                <strong>{step.status}</strong>
                <StatusPill tone={step.tone}>{step.next}</StatusPill>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="运营摘要" tone={isQuantifiable ? 'success' : 'blocked'}>
          <div className="context-summary-grid">
            <div>
              <span>数据门槛</span>
              <strong>{dataGateLabel}</strong>
              <p>{dataGateDetail}</p>
            </div>
            <div>
              <span>本期花费</span>
              <strong>{isQuantifiable ? formatUsd(quant?.totalSpend) : '待导入指标'}</strong>
              <p>{isQuantifiable ? `销售 ${formatUsd(quant?.totalSales)}，订单 ${quant?.totalOrders ?? 0}。` : '未导入指标前不展示业务结论。'}</p>
            </div>
            <div>
              <span>效率</span>
              <strong>{isQuantifiable ? formatPercent(acosPercent) : '待量化'}</strong>
              <p>{isQuantifiable ? `CVR ${formatPercent((quant?.cvr ?? 0) * 100)}，CPC ${formatUsd(quant?.cpc)}。` : '等待真实表格导入后计算。'}</p>
            </div>
            <div>
              <span>优先对象</span>
              <strong>{topDiagnostic?.objectName || topDiagnostic?.campaignName || '-'}</strong>
              <p>{topDiagnostic ? `${topDiagnostic.campaignName || '-'} / ${topDiagnostic.adGroupName || '-'}` : '暂无可量化对象。'}</p>
            </div>
          </div>
        </Panel>

        <Panel title="运营后台状态">
          <div className="context-summary-grid">
            <button className="context-action-card" onClick={() => navigate(isQuantifiable || hasRealFiles ? 'data-import-validation' : 'data-collection')} type="button">
              <span>数据</span>
              <strong>{isQuantifiable ? '可量化' : hasRealFiles ? '待导入' : '缺真实表格'}</strong>
              <p>{isQuantifiable ? `${importedRows} 行广告指标已入库。` : dataGateDetail}</p>
              <StatusPill tone={isQuantifiable ? 'ready' : hasRealFiles ? 'warning' : 'blocked'}>{isQuantifiable ? '查看数据' : hasRealFiles ? '去导入' : '去采集'}</StatusPill>
            </button>
            <button className="context-action-card" onClick={() => navigate('settings')} type="button">
              <span>AI</span>
              <strong>{aiStatus.label}</strong>
              <p>{aiStatus.detail}</p>
              <StatusPill tone={aiStatus.tone}>AI 设置</StatusPill>
            </button>
            <button className="context-action-card" onClick={() => navigate('operation-events')} type="button">
              <span>运营事件</span>
              <strong>{operationEventCount} 条</strong>
              <p>{operationEventCount ? '已进入广告量化和 AI 诊断上下文。' : '没有活动、折扣、调价或库存背景时，AI 只能看广告数据。'}</p>
              <StatusPill tone={operationEventCount ? 'ready' : 'pending'}>维护事件</StatusPill>
            </button>
            <button className="context-action-card" onClick={() => navigate(pendingRecommendations.length ? 'approval' : 'recommendations')} type="button">
              <span>建议/执行</span>
              <strong>{pendingRecommendations.length ? `${pendingRecommendations.length} 条待审批` : '等待建议'}</strong>
              <p>{pendingRecommendations.length ? '先审批，再进入执行回读；仪表盘不直接执行广告。' : '生成建议后再进入审批和 readback。'}</p>
              <StatusPill tone={pendingRecommendations.length ? 'warning' : 'pending'}>{pendingRecommendations.length ? '去审批' : '去建议'}</StatusPill>
            </button>
          </div>
        </Panel>

        <Panel title="今日运营判断" tone={isQuantifiable ? 'warning' : 'blocked'}>
          <div className="judgment-panel">
            <div>
              <span>当前判断</span>
              <strong>{operatingJudgment}</strong>
              <p>
                {isQuantifiable
                  ? `总盘口径使用 ${quant?.summarySource === 'canonical_user_search_term' ? '用户搜索词权威口径' : quant?.summarySource === 'canonical_search_term' ? '搜索词权威口径' : '可行动报表近似口径'}；当前花费 ${formatUsd(quant?.totalSpend)}，订单 ${quant?.totalOrders ?? 0}，ACOS ${formatPercent(acosPercent)}；风险线 ${formatPercent(ruleConfig.highAcosThreshold * 100)}。`
                  : '先在数据采集页确认 8 类真实报表文件和导入行数，再进入广告量化。'}
              </p>
              {quant?.summaryWarning && <p className="warning-line">{quant.summaryWarning}</p>}
            </div>
            <button className="primary-button" onClick={() => navigate(operatingNextRoute)} type="button">
              {isQuantifiable ? '查看广告量化' : hasRealFiles ? '去导入校验' : '去数据采集'}
            </button>
          </div>
        </Panel>

        <Panel title="行动队列" tone={isQuantifiable ? 'warning' : 'blocked'}>
          <div className="context-summary-grid">
            {actionQueue.map((item, index) => (
              <button className="context-action-card" key={`${item.title}-${index}`} onClick={() => navigate(item.route)} type="button">
                <span>#{index + 1}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <StatusPill tone={item.tone}>{item.route === 'recommendations' ? '去建议页' : item.route === 'ad-quant' ? '去量化页' : item.route === 'data-import-validation' ? '去导入页' : '去采集页'}</StatusPill>
              </button>
            ))}
          </div>
          <p className="muted-line">
            当前规则：目标 ACOS {formatPercent(ruleConfig.targetAcos * 100)} / 风险 ACOS {formatPercent(ruleConfig.highAcosThreshold * 100)} / 无订单 {ruleConfig.noOrderClickThreshold} 点击 / 最低花费 {formatUsd(ruleConfig.minSpend)}。
          </p>
        </Panel>

        <Panel title="首要风险对象" tone={topDiagnostic ? 'warning' : isQuantifiable ? 'default' : 'blocked'}>
          {topDiagnostic ? (
            <div className="detail-grid">
              <div><span>广告组合/活动</span><strong>{topDiagnostic.portfolioName || '-'} / {topDiagnostic.campaignName || '-'}</strong></div>
              <div><span>广告组</span><strong>{topDiagnostic.adGroupName || '-'}</strong></div>
              <div><span>产品/ASIN</span><strong>{topDiagnostic.asin || '-'}</strong></div>
              <div><span>对象</span><strong>{topDiagnostic.objectType || '-'} / {topDiagnostic.objectName || '-'}</strong></div>
              <div><span>花费/销售/订单</span><strong>{formatUsd(topDiagnostic.spend)} / {formatUsd(topDiagnostic.sales)} / {topDiagnostic.orders}</strong></div>
              <div><span>诊断</span><strong>{topDiagnostic.diagnosis}</strong></div>
            </div>
          ) : (
            <p className={isQuantifiable ? 'muted-line' : 'blocked-line'}>
              {isQuantifiable ? '当前范围暂无诊断对象。' : '缺少真实广告表格和导入指标，无法给出风险对象。'}
            </p>
          )}
          <div className="action-row">
            <button className="secondary-button" disabled={!isQuantifiable} onClick={() => navigate('ad-quant')} type="button">查看量化明细</button>
            <button className="secondary-button" disabled={!isQuantifiable} onClick={() => navigate('recommendations')} type="button">生成优化建议</button>
          </div>
        </Panel>

        <Panel title="当前范围">
          <div className="business-scope-line">
            <ScopeText scope={data?.scope || scope} />
          </div>
          <div className="business-pill-row">
            <StatusPill tone={isQuantifiable ? 'ready' : 'blocked'}>
              {isQuantifiable ? '真实数据可量化' : '当前范围还没有可量化的真实广告数据'}
            </StatusPill>
            <StatusPill tone="pending">币种 USD</StatusPill>
          </div>
        </Panel>

        {isQuantifiable && (
          <div className="business-grid business-grid-four">
            <div className="metric-tile">
              <span>总花费</span>
              <strong>{formatUsd(quant?.totalSpend)}</strong>
            </div>
            <div className="metric-tile">
              <span>总销售</span>
              <strong>{formatUsd(quant?.totalSales)}</strong>
            </div>
            <div className="metric-tile">
              <span>订单</span>
              <strong>{quant?.totalOrders ?? 0}</strong>
            </div>
            <div className="metric-tile">
              <span>ACOS</span>
              <strong>{formatPercent((quant?.acos ?? 0) * 100)}</strong>
            </div>
          </div>
        )}

        <div className="business-grid">
          <Panel title="真实数据可用性" tone={isQuantifiable ? 'success' : 'blocked'}>
            <dl className="business-definition-list">
              <div>
                <dt>真实原始报表文件</dt>
                <dd>{collection?.realReportFiles.length ?? 0} 个 .xlsx/.xls/.csv 文件</dd>
              </div>
              <div>
                <dt>导入广告指标行</dt>
                <dd>{importedRows} 行全部指标</dd>
              </div>
              <div>
                <dt>可加总指标行</dt>
                <dd>{canonicalRows} 行</dd>
              </div>
              <div>
                <dt>可生成建议行</dt>
                <dd>{actionableRows} 行</dd>
              </div>
              <div>
                <dt>分解报表行</dt>
                <dd>{breakdownRows} 行</dd>
              </div>
              <div>
                <dt>采集状态</dt>
                <dd>{collectionStatusLabel(collection?.status)}</dd>
              </div>
            </dl>
            {loading && <p className="muted-line">正在读取只读数据状态...</p>}
            {error && <p className="blocked-line">读取接口异常：{error}</p>}
          </Panel>

          <Panel title="风险与下一步" tone={isQuantifiable ? 'warning' : 'blocked'}>
            <ul className="business-list">
              {(collection?.blockers.length
                ? collection.blockers
                : isQuantifiable
                  ? ['当前范围已有真实报表和导入指标。', '先进入广告量化页复核高 ACOS、无订单花费和高花费对象。']
                  : ['当前范围还没有可量化的真实广告数据']
              ).map((item) => (
                <li key={item}>{item}</li>
              ))}
              {(quant?.blockers || []).map((item) => (
                <li key={item}>{item}</li>
              ))}
              <li>{isQuantifiable ? '可进入广告量化页复核诊断，不直接生成执行建议。' : '先完成真实报表下载、解析导入，再进入量化。'}</li>
            </ul>
          </Panel>
        </div>

        <Panel title="最近证据/文件路径入口">
          {collection?.evidencePaths.length ? (
            <div className="path-list">
              {collection.evidencePaths.map((item) => (
                <div className="path-row" key={`${item.kind}-${item.path}`}>
                  <span>{item.label}</span>
                  <code title={item.path}>{compactPath(item.path)}</code>
                  <button
                    className="secondary-button compact-button"
                    onClick={() => openPath(item.path)}
                    type="button"
                  >
                    打开
                  </button>
                </div>
              ))}
              {pathNotice && <p className={pathNotice.startsWith('打开失败') ? 'blocked-line' : 'muted-line'}>{pathNotice}</p>}
            </div>
          ) : (
            <p className="blocked-line">还没有可打开的真实报表或证据路径。</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
