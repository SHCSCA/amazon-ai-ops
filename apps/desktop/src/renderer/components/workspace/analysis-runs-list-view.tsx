import { V16_API_VERSION } from '@amazon-ai-ops/shared-types/src/v16-api';
import type { AnalysisRunsApi } from '@amazon-ai-ops/shared-types';
/**
 * Analysis Runs List View
 *
 * Displays a list of analysis runs for the current store with status,
 * timing, and recommendation counts.
 */

import { useState, useEffect } from 'react';
import type { AnalysisRunRecord, StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import type {
  ListRunsResponse,
} from '../../../preload/analysis-runs-api';
import './analysis-runs-list-view.css';

export interface AnalysisRunsListViewProps {
  storeContext: StoreContextEnvelope;
  missionId?: string;
  refreshToken?: unknown;
  onRunSelect?: (runId: string) => void;
  selectedRunId?: string;
}

interface ListState {
  runs: AnalysisRunRecord[];
  loading: boolean;
  error: string | null;
}

function getAnalysisRunsApi(): AnalysisRunsApi | undefined {
  return (window as unknown as { electronAPI?: { analysisRuns?: AnalysisRunsApi } }).electronAPI?.analysisRuns;
}

export function AnalysisRunsListView({
  storeContext,
  missionId,
  refreshToken,
  onRunSelect,
  selectedRunId,
}: AnalysisRunsListViewProps): JSX.Element {
  const [state, setState] = useState<ListState>({
    runs: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      setState(prev => ({ ...prev, loading: true, error: null }));

      const api = getAnalysisRunsApi();
      if (!api) {
        if (!cancelled) {
          setState({ runs: [], loading: false, error: '分析服务不可用，请重新启动当前版本应用。' });
        }
        return;
      }

      try {
        const raw = await api.list({ apiVersion: V16_API_VERSION, storeContext, input: { missionId } });
        if (cancelled) return;

        const response = raw as ListRunsResponse;
        if (!response.success) {
          setState({
            runs: [],
            loading: false,
            error: response.error ?? '无法加载分析记录，请刷新后重试。',
          });
          return;
        }

        setState({ runs: response.data, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          runs: [],
          loading: false,
          error: err instanceof Error ? err.message : '分析请求失败，请重试。',
        });
      }
    }

    loadRuns();

    return () => {
      cancelled = true;
    };
  }, [storeContext, missionId, refreshToken]);

  if (state.loading) {
    return (
      <div className="analysis-runs-list-view">
        <div className="analysis-runs-loading" aria-busy="true">
          <div className="spinner" />
          <p>加载分析记录...</p>
        </div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="analysis-runs-list-view">
        <div className="analysis-runs-error" role="alert">
          <p className="error-message">{state.error}</p>
        </div>
      </div>
    );
  }

  if (state.runs.length === 0) {
    return (
      <div className="analysis-runs-list-view">
        <div className="analysis-runs-empty">
          <p>当前店铺暂无分析记录</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-runs-list-view">
      <div
        className="analysis-runs-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        共 {state.runs.length} 条分析记录
      </div>

      <div className="analysis-runs-list" role="list">
        {state.runs.map(run => (
          <button
            key={run.runId}
            type="button"
            className={`analysis-run-item ${selectedRunId === run.runId ? 'selected' : ''}`}
            onClick={() => onRunSelect?.(run.runId)}
            aria-pressed={selectedRunId === run.runId}
          >
            <div className="run-header">
              <span>{run.metadata?.reusedFromRunId ? '复用分析结果' : '分析记录'}</span>
              <RunStatusIndicator status={run.status} />
            </div>

            {run.missionId && (
              <div className="run-metadata">
                <span className="run-mission">{run.metadata?.productId ?? '当前运营任务'}</span>
              </div>
            )}

            <div className="run-stats">
              <span className="run-recommendations">
                {run.recommendationsCount} 条建议{run.metadata?.historicalOnly ? ' · 历史记录，仅供查看' : ''}
              </span>
              <span className="run-time">
                {formatRelativeTime(run.createdAt)}
              </span>
            </div>

            {run.blockedReason && (
              <div className="run-blocked-reason" role="alert">
                <span className="blocked-label">阻断原因:</span>
                <span className="blocked-text">{run.blockedReason}</span>
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── RunStatusIndicator ────────────────────────────────────────────────────────

interface RunStatusIndicatorProps {
  status: AnalysisRunRecord['status'];
}

export function RunStatusIndicator({ status }: RunStatusIndicatorProps): JSX.Element {
  const config: Record<string, { label: string; className: string }> = {
    pending: { label: '待处理', className: 'status-pending' },
    analyzing: { label: '分析中', className: 'status-analyzing' },
    completed: { label: '已完成', className: 'status-completed' },
    failed: { label: '失败', className: 'status-failed' },
    blocked: { label: '已阻断', className: 'status-blocked' },
  };

  const { label, className } = config[status] ?? { label: status, className: 'status-unknown' };

  return (
    <span
      className={`run-status-indicator ${className}`}
      role="note"
      aria-roledescription="状态标签"
      data-status-tone={status}
    >
      {label}
    </span>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins} 分钟前`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} 小时前`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} 天前`;

    return date.toLocaleDateString('zh-CN');
  } catch {
    return isoString;
  }
}
