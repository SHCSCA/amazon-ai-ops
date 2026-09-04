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
  onRunSelect?: (runId: string) => void;
  selectedRunId?: string;
}

interface ListState {
  runs: AnalysisRunRecord[];
  loading: boolean;
  error: string | null;
}

function getAnalysisRunsApi() {
  return (window as unknown as { electronAPI?: { analysisRuns?: {
    list: (storeContext: StoreContextEnvelope, input?: Record<string, unknown>) => Promise<unknown>;
  }}}).electronAPI?.analysisRuns;
}

export function AnalysisRunsListView({
  storeContext,
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
          setState({ runs: [], loading: false, error: 'Analysis runs API not available.' });
        }
        return;
      }

      try {
        const raw = await api.list(storeContext, {});
        if (cancelled) return;

        const response = raw as ListRunsResponse;
        if (!response.success) {
          setState({
            runs: [],
            loading: false,
            error: response.error?.message ?? 'Failed to load analysis runs.',
          });
          return;
        }

        setState({ runs: response.runs ?? [], loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          runs: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error.',
        });
      }
    }

    loadRuns();

    return () => {
      cancelled = true;
    };
  }, [storeContext]);

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
              <span className="run-id">{run.runId}</span>
              <RunStatusIndicator status={run.status} />
            </div>

            {run.missionId && (
              <div className="run-metadata">
                <span className="run-mission">任务: {run.missionId}</span>
              </div>
            )}

            <div className="run-stats">
              <span className="run-recommendations">
                {run.recommendationsCount} 条建议
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
