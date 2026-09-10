import { V16_API_VERSION } from '@amazon-ai-ops/shared-types/src/v16-api';
import type { AnalysisRunsApi } from '@amazon-ai-ops/shared-types';
/**
 * Analysis Run Detail View
 *
 * Displays detailed information about a single analysis run,
 * including input parameters, stages, result timing, and reuse info.
 */

import React from 'react';
import type { AnalysisRunRecord, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type { QueryRunResponse } from '../../../preload/analysis-runs-api';
import { RunStatusIndicator } from './analysis-runs-list-view';
import './analysis-runs-list-view.css';

export interface AnalysisRunDetailViewProps {
  runId: string;
  storeContext: StoreContextEnvelope;
  onBack?: () => void;
  onStartAnalysis?: (runId: string) => void;
  onViewRecommendations?: (runId: string) => void;
}

interface DetailState {
  run: AnalysisRunRecord | null;
  loading: boolean;
  error: string | null;
}

function getAnalysisRunsApi(): AnalysisRunsApi | undefined {
  return (window as unknown as { electronAPI?: { analysisRuns?: AnalysisRunsApi } }).electronAPI?.analysisRuns;
}

/**
 * Format duration between two timestamps
 */
function formatDuration(startIso: string, endIso?: string): string {
  try {
    const start = new Date(startIso).getTime();
    const end = endIso ? new Date(endIso).getTime() : Date.now();
    const diffMs = end - start;
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return `${diffSec} 秒`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} 分 ${diffSec % 60} 秒`;
    const diffHour = Math.floor(diffMin / 60);
    return `${diffHour} 小时 ${diffMin % 60} 分`;
  } catch {
    return '-';
  }
}

/**
 * Get stage label for display
 */
function getStageLabel(status: AnalysisRunRecord['status']): string {
  switch (status) {
    case 'pending': return '等待开始';
    case 'analyzing': return '分析中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
    case 'blocked': return '已阻断';
    default: return status;
  }
}

export function AnalysisRunDetailView({
  runId,
  storeContext,
  onBack,
  onStartAnalysis,
  onViewRecommendations,
}: AnalysisRunDetailViewProps): JSX.Element {
  const [state, setState] = React.useState<DetailState>({
    run: null,
    loading: true,
    error: null,
  });

  React.useEffect(() => {
    let cancelled = false;

    async function loadRun() {
      setState(prev => ({ ...prev, loading: true, error: null }));

      const api = getAnalysisRunsApi();
      if (!api) {
        if (!cancelled) {
          setState({ run: null, loading: false, error: '分析服务不可用，请重新启动当前版本应用。' });
        }
        return;
      }

      try {
        const raw = await api.query({ apiVersion: V16_API_VERSION, storeContext, input: { runId } });
        if (cancelled) return;

        const response = raw as QueryRunResponse;
        if (!response.success) {
          setState({
            run: null,
            loading: false,
            error: response.error ?? '无法加载分析详情，请刷新后重试。',
          });
          return;
        }

        setState({ run: response.data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          run: null,
          loading: false,
          error: err instanceof Error ? err.message : '分析请求失败，请重试。',
        });
      }
    }

    loadRun();

    return () => {
      cancelled = true;
    };
  }, [runId, storeContext]);

  if (state.loading) {
    return (
      <div className="analysis-run-detail-view">
        <div className="analysis-runs-loading" aria-busy="true">
          <div className="spinner" />
          <p>加载分析详情...</p>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="analysis-run-detail-view">
        <div className="analysis-runs-error" role="alert">
          <p className="error-message">{state.error}</p>
          {onBack && (
            <button type="button" onClick={onBack} className="back-button">
              返回列表
            </button>
          )}
        </div>
      </div>
    );
  }

  const run = state.run;
  if (!run) {
    return (
      <div className="analysis-run-detail-view">
        <div className="analysis-runs-empty">
          <p>未找到该分析记录</p>
          {onBack && (
            <button type="button" onClick={onBack} className="back-button">
              返回列表
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-run-detail-view">
      <div className="detail-header">
        {onBack && (
          <button type="button" onClick={onBack} className="back-button" aria-label="返回列表">
            ← 返回
          </button>
        )}
        <h2 className="detail-title">分析详情</h2>
        <RunStatusIndicator status={run.status} />
      </div>

      <div className="detail-content">
        <section className="detail-section" aria-labelledby="basic-info">
          <h3 id="basic-info" className="section-title">基本信息</h3>
          <dl className="detail-grid">
            <dt>本次结果</dt>
            <dd>{run.metadata?.reusedFromRunId ? '复用已封存结果' : '独立分析回执'}</dd>

            <dt>范围</dt>
            <dd>{run.metadata?.productId ?? '当前店铺'}</dd>

            <dt>市场</dt>
            <dd>{run.marketplace} / {run.currency}</dd>

            <dt>数据期间</dt>
            <dd>{run.metadata?.dateFrom ?? '未记录'} 至 {run.metadata?.dateTo ?? '未记录'}</dd>
          </dl>
        </section>

        <section className="detail-section" aria-labelledby="timing-info">
          <h3 id="timing-info" className="section-title">时间信息</h3>
          <dl className="detail-grid">
            <dt>创建时间</dt>
            <dd>{new Date(run.createdAt).toLocaleString('zh-CN')}</dd>

            <dt>开始时间</dt>
            <dd>{run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN') : '-'}</dd>

            <dt>完成时间</dt>
            <dd>{run.completedAt ? new Date(run.completedAt).toLocaleString('zh-CN') : '-'}</dd>

            <dt>耗时</dt>
            <dd>{run.startedAt ? formatDuration(run.startedAt, run.completedAt) : '-'}</dd>
          </dl>
        </section>

        <section className="detail-section" aria-labelledby="result-info">
          <h3 id="result-info" className="section-title">分析结果</h3>
          <dl className="detail-grid">
            <dt>当前阶段</dt>
            <dd>{getStageLabel(run.status)}</dd>

            <dt>建议数量</dt>
            <dd className="recommendations-count">{run.recommendationsCount}</dd>
          </dl>

          {run.blockedReason && (
            <div className="blocked-reason" role="alert">
              <span className="blocked-label">阻断原因:</span>
              <p className="blocked-text">{run.blockedReason}</p>
            </div>
          )}
        </section>

        {run.metadata && (
          <section className="detail-section" aria-labelledby="metadata-info">
            <h3 id="metadata-info" className="section-title">分析输入</h3>
            <dl className="detail-grid">
              {run.metadata.fingerprint && (
                <>
                  <dt>输入核验</dt>
                  <dd><details><summary>查看输入指纹</summary><code>{run.metadata.fingerprint}</code></details></dd>
                </>
              )}
              {run.metadata.productId && (
                <>
                  <dt>产品</dt>
                  <dd>{run.metadata.productId}</dd>
                </>
              )}
              {run.metadata.policyRevision && (
                <>
                  <dt>策略版本</dt>
                  <dd className="detail-id">{run.metadata.policyRevision}</dd>
                </>
              )}
              {run.metadata.modelRevision && (
                <>
                  <dt>模型版本</dt>
                  <dd className="detail-id">{run.metadata.modelRevision}</dd>
                </>
              )}
            </dl>
          </section>
        )}

        <section className="detail-actions">
          {['pending', 'failed', 'blocked'].includes(run.status) && onStartAnalysis && (
            <button
              type="button"
              className="action-button primary"
              onClick={() => onStartAnalysis(run.runId)}
            >
              重新运行分析
            </button>
          )}
          {run.status === 'completed' && run.recommendationsCount > 0 && onViewRecommendations && (
            <button
              type="button"
              className="action-button primary"
              onClick={() => onViewRecommendations(run.runId)}
            >
              查看建议 ({run.recommendationsCount})
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
