import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import React from 'react';
import { type LingxingCollectionJobSnapshot, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { Panel, StatusPill } from '../components/ui';
import { buildCollectionJobWorkspaceRow, buildCollectionJobLineagePresentation } from './collection-jobs';
import { formatUpdatedAt } from './collection-presentation';

export function CollectionJobWorkspace({
  jobs,
  currentContext,
  loading,
  error,
  previewOnly = false,
  actionBusyKey,
  onRefresh,
  onResume,
  onResumeSafeRemainder,
  onReconcile,
  onCancel,
}: {
  jobs: readonly LingxingCollectionJobSnapshot[];
  currentContext?: StoreContextEnvelope | null;
  loading: boolean;
  error: string | null;
  previewOnly?: boolean;
  actionBusyKey: string | null;
  onRefresh: () => void;
  onResume: (job: LingxingCollectionJobSnapshot) => void;
  onResumeSafeRemainder?: (job: LingxingCollectionJobSnapshot) => void;
  onReconcile?: (job: LingxingCollectionJobSnapshot) => void;
  onCancel: (job: LingxingCollectionJobSnapshot) => void;
}) {
  const visibleJobs = jobs.slice(0, 12);
  const rows = visibleJobs.map((job) => buildCollectionJobWorkspaceRow(job, currentContext));
  return (
    <Panel
      title="当前店铺采集任务历史"
      titleAccessory={<StatusPill tone={error ? 'blocked' : loading ? 'pending' : previewOnly ? 'warning' : 'ready'}>{loading ? '读取中' : previewOnly ? 'DEV 空任务预览' : `${jobs.length} 个任务`}</StatusPill>}
      tone={error ? 'blocked' : rows.some((row) => row.manualReconciliation || row.import.state === 'failed') ? 'blocked' : undefined}
    >
      <div className="business-split">
        <div>
          <div className="business-scope-line">仅显示当前美国站店铺最近任务</div>
          <p className="muted-line">新建、读取、恢复和取消都绑定当前店铺会话；终态历史作为审计记录保留，不提供物理删除。切店后重新读取，不复用旧店响应。</p>
        </div>
        <WorkspaceActionButton disabledReason={loading ? '正在读取当前店铺任务，请等待返回。' : '当前采集任务动作尚未结束，请等待返回后刷新。'}
          aria-busy={loading}
          className={loading ? 'secondary-button compact-button button-loading' : 'secondary-button compact-button'}
          disabled={loading || Boolean(actionBusyKey)}
          onClick={onRefresh}
          type="button"
        >
          {loading && <span aria-hidden="true" className="button-spinner" />}
          <span>{loading ? '读取中...' : '刷新任务'}</span>
        </WorkspaceActionButton>
      </div>
      {previewOnly && (
        <p className="warning-line" role="status">开发预览不会注入伪造采集任务或生产成功；Windows 桌面端会从当前店铺数据库读取真实任务。</p>
      )}
      {error && <><p className="blocked-line" role="alert">任务读取失败。请确认当前店铺连接后点击“刷新任务”；若仍失败，请展开诊断详情。</p><details><summary>诊断详情</summary><code>任务读取失败：{error}</code></details></>}
      <div className="table-wrap">
        <table className="business-table data-table--compact data-table--striped" aria-label="当前店铺领星采集任务">
          <thead>
            <tr>
              <th>日期</th>
              <th>8 类报表进度</th>
              <th>任务血缘</th>
              <th>状态</th>
              <th>生产入库</th>
              <th>阻断 / 需人工核对</th>
              <th>最近更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const lineage = buildCollectionJobLineagePresentation(row.job);
              const resumeKey = `resume:${row.job.jobId}`;
              const cancelKey = `cancel:${row.job.jobId}`;
              const resumeBusy = actionBusyKey === resumeKey;
              const cancelBusy = actionBusyKey === cancelKey;
              return (
                <tr key={row.job.jobId}>
                  <td>
                    <strong>{row.job.request.dateStart} → {row.job.request.dateEnd}</strong>
                    <div className="table-subtext">采集记录 {index + 1}</div>
                    <details><summary>诊断详情</summary><code>{row.job.jobId}</code></details>
                    {row.canary && <StatusPill tone="warning">Canary（不入生产）</StatusPill>}
                  </td>
                  <td>
                    <strong>{row.progressLabel}</strong>
                    <div className="table-subtext">{row.progressDetail}</div>
                  </td>
                  <td>
                    <StatusPill tone={lineage.tone}>{lineage.label}</StatusPill>
                    <div className="table-subtext">{lineage.tone === 'blocked' ? '来源关系需人工核对' : '来源关系已记录'}</div>
                    <details><summary>诊断详情</summary><code>{lineage.detail}</code></details>
                  </td>
                  <td><StatusPill tone={row.statusTone}>{row.statusLabel}</StatusPill></td>
                  <td>
                    <StatusPill tone={row.import.tone}>{row.import.label}</StatusPill>
                    <div className="table-subtext">{row.import.detail}</div>
                  </td>
                  <td>
                    <span className={row.manualReconciliation ? 'blocked-line' : undefined}>{row.blockerText}</span>
                  </td>
                  <td>{formatUpdatedAt(row.job.updatedAt)}</td>
                  <td>
                    <div className="table-action-row">
                      {row.action === 'cancel' && (
                        <WorkspaceActionButton disabledReason="当前已有采集任务动作在处理，请等待其完成后重试。"
                          aria-busy={cancelBusy}
                          className={cancelBusy ? 'secondary-button compact-button button-loading' : 'secondary-button compact-button'}
                          disabled={Boolean(actionBusyKey)}
                          onClick={() => onCancel(row.job)}
                          type="button"
                        >
                          {cancelBusy && <span aria-hidden="true" className="button-spinner" />}
                          <span>{cancelBusy ? '提交取消...' : '取消任务'}</span>
                        </WorkspaceActionButton>
                      )}
                      {row.action === 'resume' && row.safeRemainderAvailable && onResumeSafeRemainder && (
                        <>
                          <WorkspaceActionButton disabledReason="当前已有采集任务动作在处理，请等待其完成后重试。"
                            aria-busy={resumeBusy}
                            className={resumeBusy ? 'primary-button compact-button button-loading' : 'primary-button compact-button'}
                            disabled={Boolean(actionBusyKey)}
                            onClick={() => onResumeSafeRemainder(row.job)}
                            type="button"
                          >
                            {resumeBusy && <span aria-hidden="true" className="button-spinner" />}
                            <span>{resumeBusy ? '处理中...' : '先完成其余报表'}</span>
                          </WorkspaceActionButton>
                          <WorkspaceActionButton disabledReason="当前已有采集任务动作在处理，请等待其完成后重试。"
                            className="secondary-button compact-button"
                            disabled={Boolean(actionBusyKey)}
                            onClick={() => onResume(row.job)}
                            type="button"
                          >
                            重新创建缺失报表
                          </WorkspaceActionButton>
                        </>
                      )}
                      {row.action === 'resume' && (!row.safeRemainderAvailable || !onResumeSafeRemainder) && (
                        <WorkspaceActionButton disabledReason="当前已有采集任务动作在处理，请等待其完成后重试。"
                          aria-busy={resumeBusy}
                          className={resumeBusy ? 'primary-button compact-button button-loading' : 'primary-button compact-button'}
                          disabled={Boolean(actionBusyKey)}
                          onClick={() => onResume(row.job)}
                          type="button"
                        >
                          {resumeBusy && <span aria-hidden="true" className="button-spinner" />}
                          <span>{resumeBusy ? '恢复中...' : '继续采集'}</span>
                        </WorkspaceActionButton>
                      )}
                      {row.action === 'supplement-import' && (
                        <WorkspaceActionButton disabledReason="当前已有采集任务动作在处理，请等待其完成后重试。"
                          aria-busy={resumeBusy}
                          className={resumeBusy ? 'primary-button compact-button button-loading' : 'primary-button compact-button'}
                          disabled={Boolean(actionBusyKey)}
                          onClick={() => onResume(row.job)}
                          type="button"
                        >
                          {resumeBusy && <span aria-hidden="true" className="button-spinner" />}
                          <span>{resumeBusy ? '补导中...' : '补导数据'}</span>
                        </WorkspaceActionButton>
                      )}
                      {row.action === 'manual-reconciliation' && (
                        onReconcile ? (
                          <WorkspaceActionButton disabledReason="当前已有采集任务动作在处理，请等待其完成后重试。"
                            aria-busy={resumeBusy}
                            className={resumeBusy ? 'primary-button compact-button button-loading' : 'primary-button compact-button'}
                            disabled={Boolean(actionBusyKey)}
                            onClick={() => onReconcile(row.job)}
                            type="button"
                          >
                            {resumeBusy && <span aria-hidden="true" className="button-spinner" />}
                            <span>{resumeBusy ? '核对中...' : '仅核对创建结果'}</span>
                          </WorkspaceActionButton>
                        ) : (
                          <WorkspaceActionButton disabledReason="创建结果未知，请先在领星下载中心核对当前店铺、日期与报表类型。"
                            aria-label="当前采集任务需人工核对，禁止继续采集"
                            className="secondary-button compact-button"
                            disabled
                            type="button"
                          >
                            人工核对（禁止恢复）
                          </WorkspaceActionButton>
                        )
                      )}
                      {row.action === 'none' && <span className="table-subtext">无需操作</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={8}>{loading ? '正在读取当前店铺最近任务...' : error ? '读取失败，请点击“刷新任务”重试。' : previewOnly ? '开发预览任务列表为空；未伪造真实采集、入库或生产成功记录。' : '当前店铺还没有采集任务。完成首次真实采集后会在这里保留进度与恢复入口。'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {jobs.length > visibleJobs.length && (
        <p className="muted-line">当前先显示最近 {visibleJobs.length} 个任务；其余 {jobs.length - visibleJobs.length} 个历史任务已读取并用于生产 lineage 核对。</p>
      )}
    </Panel>
  );
}
