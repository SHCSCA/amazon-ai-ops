import React from 'react';
import {
  ArrowRight,
  Browser,
  CheckCircle,
  Circle,
  Database,
  Package,
  Warning,
} from '@phosphor-icons/react';
import type {
  MissionControlCapabilityProjection,
  MissionControlTodayProjection,
  StoreContextEnvelope,
} from '@amazon-ai-ops/shared-types';
import { missionControlContextKey } from '@amazon-ai-ops/shared-types';
import {
  PageFrame,
  SummaryStrip,
  TaskBanner,
  WorkspaceState,
} from '../../components/workspace';
import type { NavigationIntent } from '../../navigation';
import { navigationIntentForMissionControlView } from './registry';
import './canonical-workspace-surfaces.css';

export interface TodayWorkspaceProps {
  projection: MissionControlTodayProjection | null;
  storeContext: StoreContextEnvelope | null;
  loading: boolean;
  error?: string | null;
  capabilities?: readonly MissionControlCapabilityProjection[];
  previewMode?: boolean;
  onNavigate: (intent: NavigationIntent) => void;
}

const TODAY_INTERNAL_OPERATOR_COPY = /\b(?:Main|StoreContext|Authority|Renderer|Profile|Mission|Experiment|UNKNOWN|revision|draft|set_keyword_bid|manifest|fingerprint|dry-run|CRUD|PRODUCTION_NATIVE|PROTOTYPE_ONLY|LEGACY_ADAPTER|sequence|append-only|correction|DECISION|ACTION|READBACK|EFFECT)\b/i;

export function todayOperatorCopy(value: unknown, fallback: string): string {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  return !normalized || TODAY_INTERNAL_OPERATOR_COPY.test(normalized) ? fallback : normalized;
}

export function TodayWorkspace({
  projection,
  storeContext,
  loading,
  error,
  capabilities,
  previewMode = false,
  onNavigate,
}: TodayWorkspaceProps) {
  const authorityMatches = Boolean(
    projection
    && storeContext
    && projection.storeId === storeContext.storeId
    && projection.authorityKey === missionControlContextKey(storeContext)
    && projection.businessDate === storeContext.businessDate
    && projection.marketplace === 'US'
    && projection.currency === 'USD',
  );
  const safeProjection = authorityMatches ? projection : null;
  const safeNextActionLabel = todayOperatorCopy(safeProjection?.nextAction.label, '处理下一项准备工作');
  const safeNextActionDetail = todayOperatorCopy(
    safeProjection?.nextAction.detail,
    '请先完成当前店铺的准备步骤，再继续下一项。',
  );
  const safeReadiness = safeProjection?.readiness.map((item) => ({
    ...item,
    label: todayOperatorCopy(item.label, '准备步骤'),
    detail: todayOperatorCopy(item.detail, '当前步骤尚未完成，请进入对应页面处理。'),
  })) ?? [];
  const safeBlockers = safeProjection?.blockers.map((item) => todayOperatorCopy(
    item,
    '当前店铺准备条件未满足，请按上方步骤处理。',
  )) ?? [];
  const safeAttentionItems = safeProjection?.attentionItems.map((item) => todayOperatorCopy(
    item,
    '当前店铺还有待处理事项，请按上方步骤核对。',
  )) ?? [];
  const technicalDiagnostics = safeProjection ? [
    safeProjection.nextAction.label,
    safeProjection.nextAction.detail,
    ...safeProjection.readiness.flatMap((item) => [item.label, item.detail]),
    ...safeProjection.blockers,
    ...safeProjection.attentionItems,
  ].filter((item) => TODAY_INTERNAL_OPERATOR_COPY.test(item)) : [];
  const readyCount = safeProjection?.readiness.filter((item) => item.state === 'ready').length ?? 0;
  const importReady = safeProjection?.readiness.find((item) => item.id === 'import')?.state === 'ready';
  const progress = Math.round((readyCount / 4) * 100);
  const capabilityAllows = (
    view: MissionControlTodayProjection['nextAction']['targetView'],
    requiredCapabilityId?: string,
  ) => {
    const capability = capabilities?.find((candidate) => (
      candidate.view === view
      && candidate.action === 'view'
      && (!requiredCapabilityId || candidate.capabilityId === requiredCapabilityId)
    ));
    return capability?.state === 'PRODUCTION_NATIVE'
      || capability?.state === 'LEGACY_ADAPTER'
      || (previewMode && capability?.state === 'PROTOTYPE_ONLY');
  };
  const nextActionAvailable = Boolean(
    safeProjection
    && capabilityAllows(
      safeProjection.nextAction.targetView,
      safeProjection.nextAction.requiredCapabilityId,
    )
    && (previewMode || safeProjection.nextAction.available),
  );
  const navigateTo = (view: MissionControlTodayProjection['nextAction']['targetView']) => {
    if (!capabilityAllows(view)) return;
    onNavigate(navigationIntentForMissionControlView(view));
  };

  return (
    <div
      className="mission-control-workspace-root"
      data-canonical-surface="today"
      data-canonical-view="today/overview"
      data-workspace="today"
    >
      <PageFrame
        className="mission-control-canonical-page"
        description="只呈现当前店铺真实准备度、阻断原因和下一安全动作。"
        pageId="today-overview"
        summary={safeProjection ? (
          <SummaryStrip
            ariaLabel="今日任务真实店铺事实"
            items={[
              { id: 'store', label: '当前店铺', value: '已选择' },
              { id: 'market', label: '站点 / 币种', value: 'Amazon US / USD' },
              { id: 'metrics', label: '广告事实', value: `${safeProjection.facts.importedMetricRows} 行`, tone: importReady ? 'confirmed' : 'attention' },
              { id: 'events', label: '今日运营事件', value: `${safeProjection.facts.operationEventsToday} 条` },
              { id: 'analysis', label: '分析建议', value: `${safeProjection.analysis?.proposalCount ?? 0} 条`, tone: safeProjection.analysis?.proposalCount ? 'confirmed' : 'attention' },
            ]}
          />
        ) : undefined}
        task={safeProjection ? (
          <TaskBanner
            description={safeNextActionDetail}
            eyebrow="今日运营总览"
            primaryAction={{
              actionId: safeProjection.nextAction.id,
              label: safeNextActionLabel,
              onClick: () => navigateTo(safeProjection.nextAction.targetView),
              disabled: !nextActionAvailable,
              disabledReason: nextActionAvailable
                ? undefined
                : '目标能力尚未达到生产可用状态，已阻止跳转。',
            }}
            status={<span className="status-chip" data-tone={safeProjection.blockers.length ? 'warning' : safeProjection.attentionItems.length ? 'attention' : 'ready'}>{readyCount}/4 已就绪</span>}
            title={safeNextActionLabel}
            tone={safeProjection.blockers.length || safeProjection.attentionItems.length ? 'attention' : 'confirmed'}
          />
        ) : undefined}
        title="今日任务"
      >
        {!safeProjection ? (
          <WorkspaceState
            description={error
              ? todayOperatorCopy(error, '今日数据读取失败，请刷新当前店铺后重试。')
              : projection
                ? '今日数据与当前店铺范围不一致，已拒绝显示。'
                : '正在读取当前店铺的真实准备度。'}
            kind={loading ? 'loading' : 'blocked'}
            title={loading ? '正在同步今日事实' : '今日投影不可用'}
          />
        ) : (
          <div
            {...(previewMode
              ? { 'data-mutations-disabled': 'true', 'data-preview-today-projection': safeProjection.storeId }
              : { 'data-production-today-projection': safeProjection.storeId })}
          >
            {previewMode && (
              <div className="canonical-preview-notice" role="note">
                <span>仅开发预览示例</span>
                <strong>不读取生产数据库</strong>
                <small>布局和交互可体验，所有真实状态仍由本机安全进程确认。</small>
              </div>
            )}
            <div className="canonical-today-grid" data-canonical-surface="today">
              <section className="canonical-control-board">
                <header className="canonical-board-heading">
                  <div>
                    <span>当前店铺 · {safeProjection.businessDate}</span>
                    <strong>当前店铺运营准备链</strong>
                  </div>
                  <b>准备度 {progress}%</b>
                </header>
                <div
                  aria-label={`当前店铺准备度 ${progress}%`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progress}
                  className="canonical-progress"
                  role="progressbar"
                ><span style={{ width: `${progress}%` }} /></div>
                <div className="canonical-mission-chain" role="list" aria-label="今日真实准备链">
                  {safeReadiness.map((item, index) => {
                    const Icon = item.id === 'products'
                      ? Package
                      : item.id === 'browser' ? Browser : Database;
                    return (
                      <div className="canonical-chain-item" key={item.id} role="listitem">
                        <button
                          className="canonical-chain-step"
                          data-tone={item.state}
                          disabled={!capabilityAllows(item.targetView)}
                          onClick={() => navigateTo(item.targetView)}
                          title={capabilityAllows(item.targetView) ? undefined : '目标能力尚未接入生产'}
                          type="button"
                        >
                          <span><Icon aria-hidden="true" size={17} weight="duotone" /></span>
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                          {index < safeProjection.readiness.length - 1 && <ArrowRight aria-hidden="true" size={14} />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
              <aside className="canonical-health-rail">
                <h3>执行前检查</h3>
                <ul>
                  {safeReadiness.map((item) => (
                    <li key={item.id}>
                      <span>{item.state === 'ready'
                        ? <CheckCircle aria-hidden="true" size={16} weight="fill" />
                        : item.state === 'blocked'
                          ? <Warning aria-hidden="true" size={16} weight="fill" />
                          : <Circle aria-hidden="true" size={16} />}{item.label}</span>
                      <b data-tone={item.state}>{item.state === 'ready' ? '已就绪' : item.state === 'blocked' ? '阻断' : '待处理'}</b>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
            <section className="canonical-next-actions">
              <h3>下一推进动作</h3>
              {safeProjection.analysis && (
                <div className="canonical-analysis-status">
                  <div><span>运营分析 · 美国站 / USD</span><strong>{safeProjection.analysis.activeMissionId ? '运行中运营任务' : '尚无活动运营任务'}</strong><small>{safeProjection.analysis.evidencePackageCount ? `${safeProjection.analysis.evidencePackageCount} 个证据包 · ${safeProjection.analysis.proposalCount} 条不可变建议` : '先进入任务中心运行真实分析。'}</small></div>
                  <dl><div><dt>人工可授权</dt><dd>{safeProjection.analysis.humanEligibleCount}</dd></div><div><dt>策略可授权</dt><dd>{safeProjection.analysis.policyEligibleCount}</dd></div><div><dt>证据有效至</dt><dd>{safeProjection.analysis.latestFreshUntil?.slice(0, 16).replace('T', ' ') ?? '等待分析'}</dd></div></dl>
                  <button className="workspace-button workspace-button--primary" disabled={!capabilityAllows(safeProjection.analysis.proposalCount ? 'decisions/recommendations' : 'missions/overview')} onClick={() => navigateTo(safeProjection.analysis!.proposalCount ? 'decisions/recommendations' : 'missions/overview')} type="button">{safeProjection.analysis.proposalCount ? '查看建议' : '运行分析'}</button>
                </div>
              )}
              <ol>
                <li>
                  {safeProjection.blockers.length ? <Warning size={18} weight="fill" /> : <CheckCircle size={18} weight="fill" />}
                  <span>
                    <strong>{safeNextActionLabel}</strong>
                    <small>{safeNextActionDetail}</small>
                  </span>
                  <button
                    className="workspace-button workspace-button--secondary"
                    disabled={!nextActionAvailable}
                    onClick={() => navigateTo(safeProjection.nextAction.targetView)}
                    title={nextActionAvailable ? undefined : '目标能力尚未接入生产'}
                    type="button"
                  >{nextActionAvailable ? '去处理' : '能力未接入'}</button>
                </li>
              </ol>
              {safeProjection.blockers.length > 0 && (
                <div className="canonical-preview-notice" role="status">
                  <span>当前阻断</span>
                  <strong>{safeProjection.blockers.length} 项</strong>
                  <small>{safeBlockers.join('；')}</small>
                </div>
              )}
              {safeProjection.attentionItems.length > 0 && (
                <div className="canonical-preview-notice" data-tone="attention" role="status">
                  <span>待处理提醒</span>
                  <strong>{safeProjection.attentionItems.length} 项</strong>
                  <small>{safeAttentionItems.join('；')}</small>
                </div>
              )}
              {technicalDiagnostics.length > 0 && (
                <details className="mission-domain-diagnostics">
                  <summary>诊断详情</summary>
                  <ul>{technicalDiagnostics.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
                </details>
              )}
            </section>
          </div>
        )}
      </PageFrame>
    </div>
  );
}
