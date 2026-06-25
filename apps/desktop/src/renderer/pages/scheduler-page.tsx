import React, { useEffect, useState } from 'react';
import { OperatorTaskPanel } from '../components/operator-task-panel';
import { PageHeader, Panel, StateLightGrid, StatusPill } from '../components/ui';
import type { AppRoute } from '../types';
import { toUserFacingError } from '../user-facing-error';

interface ScheduledTaskView {
  name: string;
  cron?: string;
  enabled?: boolean;
  nextRun?: string;
  lastRun?: string;
  lastResult?: string;
}

function taskLabel(name: string): string {
  const labels: Record<string, string> = {
    daily_report_download: '每日广告报表下载',
    daily_recommendation_generate: '每日优化建议生成',
    daily_report_generate: '每日运营报告生成',
    data_cleanup: '本地数据清理',
  };
  return labels[name] || name;
}

export function taskPurpose(name: string): string {
  const labels: Record<string, string> = {
    daily_report_download: '从领星下载当前计划范围的广告报表，不负责审批或执行广告动作。',
    daily_recommendation_generate: '基于已导入真实指标生成待处理建议池；需复核建议不会自动审批，也不会写入 Amazon Ads。',
    daily_report_generate: '生成本地运营汇总和证据材料，不改变业务数据。',
    data_cleanup: '清理本地临时文件和过期缓存，不删除交付证据包。',
  };
  return labels[name] || '本地计划任务。执行结果必须继续满足真实数据、审批和回读门槛。';
}

export function formatCronForOperator(cron?: string): string {
  const value = String(cron || '').trim();
  if (!value) return '-';
  const parts = value.split(/\s+/);
  if (parts.length === 5 && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
    const minute = Number(parts[0]);
    const hour = Number(parts[1]);
    if (Number.isInteger(minute) && minute >= 0 && minute <= 59 && Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      return `每天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }
  return `高级计划：${value}`;
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

type SchedulerTaskPanelTone = 'ready' | 'pending' | 'warning' | 'blocked';

export function buildSchedulerTaskPanelState(input: {
  tasks: ScheduledTaskView[];
  loading: boolean;
  message?: string;
  pendingRunTask?: ScheduledTaskView | null;
  runningTaskName?: string;
}) {
  const enabledTaskCount = input.tasks.filter((task) => task.enabled).length;
  const nextTask = [...input.tasks]
    .filter((task) => task.nextRun)
    .sort((left, right) => Date.parse(left.nextRun || '') - Date.parse(right.nextRun || ''))[0];
  const pending = input.pendingRunTask || null;
  const running = Boolean(input.runningTaskName);
  const failed = Boolean(input.message && input.message.includes('失败'));

  let title = enabledTaskCount ? '本地调度已开启' : '先检查本地调度状态';
  let detail = enabledTaskCount
    ? `当前有 ${enabledTaskCount} 个本地任务启用；自动化只负责下载、导入、生成本地材料，不会批准或写入 Amazon Ads。`
    : '定时任务默认不代表广告执行权限；先刷新状态，再按任务职责决定是否启用或手动触发。';
  let primaryActionLabel = '刷新调度状态';
  let primaryBusyLabel = '正在刷新...';
  let primaryActionBusy = input.loading;
  let primaryActionDisabled = false;
  let mode: 'refresh' | 'confirm-run' = 'refresh';
  let feedbackLabel = enabledTaskCount ? '等待下一次本地唤起' : '全部任务可控';
  let feedbackDetail = nextTask
    ? `${taskLabel(nextTask.name)} / ${formatDate(nextTask.nextRun)}`
    : '暂无可见下次运行时间；可按需启用任务。';
  let feedbackTone: SchedulerTaskPanelTone = enabledTaskCount ? 'ready' : 'pending';
  const secondaryActions: Array<{ label: string; route?: AppRoute; kind?: 'cancel-run'; disabled?: boolean }> = [
    { label: '查看交付验收', route: 'delivery' },
    { label: 'AI 设置', route: 'settings' },
  ];

  if (input.loading) {
    title = '正在读取本地调度状态';
    detail = '正在从主进程读取本地任务、下次运行时间和最近结果，按钮已锁定防止重复刷新。';
    feedbackLabel = '刷新中';
    feedbackDetail = '读取完成后会更新任务表和安全边界摘要。';
    feedbackTone = 'pending';
  }

  if (pending) {
    title = `确认触发：${taskLabel(pending.name)}`;
    detail = `${taskPurpose(pending.name)} 本次只触发本地任务，仍不能绕过真实报表、人工审批和执行回读。`;
    primaryActionLabel = '执行本地任务';
    primaryBusyLabel = '正在执行...';
    primaryActionBusy = running;
    primaryActionDisabled = running;
    mode = 'confirm-run';
    feedbackLabel = running ? '正在执行本地任务' : '等待人工确认';
    feedbackDetail = running
      ? `${taskLabel(pending.name)} 已进入主进程执行。`
      : '第一次点击只打开确认，不会立即运行；确认后也不会批准建议或写入广告账户。';
    feedbackTone = running ? 'pending' : 'warning';
    secondaryActions.splice(0, secondaryActions.length, { label: '返回任务列表', kind: 'cancel-run', disabled: running });
  }

  if (failed) {
    feedbackLabel = '调度动作失败';
    feedbackDetail = input.message || '请检查主进程任务状态。';
    feedbackTone = 'blocked';
  } else if (input.message && !pending) {
    feedbackLabel = '调度动作已记录';
    feedbackDetail = input.message;
    feedbackTone = 'ready';
  }

  return {
    title,
    detail,
    primaryActionLabel,
    primaryBusyLabel,
    primaryActionBusy,
    primaryActionDisabled,
    mode,
    feedbackLabel,
    feedbackDetail,
    feedbackTone,
    secondaryActions,
  };
}

function navigate(route: AppRoute) {
  window.dispatchEvent(new CustomEvent<AppRoute>('amazon-ai-ops:navigate', { detail: route }));
}

export function SchedulerPage() {
  const [tasks, setTasks] = useState<ScheduledTaskView[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [pendingRunTask, setPendingRunTask] = useState<ScheduledTaskView | null>(null);
  const [runningTaskName, setRunningTaskName] = useState('');

  async function loadTasks(options: { clearMessage?: boolean } = {}) {
    setLoading(true);
    if (options.clearMessage !== false) setMessage('');
    try {
      const rows = await (window as any).electronAPI?.getScheduledTasks?.();
      setTasks(Array.isArray(rows) ? rows : []);
    } catch (caught) {
      setMessage(toUserFacingError(caught, '读取定时任务失败。'));
    } finally {
      setLoading(false);
    }
  }

  async function toggleTask(task: ScheduledTaskView) {
    try {
      setPendingRunTask(null);
      await (window as any).electronAPI?.setTaskEnabled?.(task.name, !task.enabled);
      setMessage(`${taskLabel(task.name)} 已${task.enabled ? '停用' : '启用'}。`);
      await loadTasks({ clearMessage: false });
    } catch (caught) {
      setMessage(`更新任务失败：${toUserFacingError(caught, '更新任务失败。')}`);
    }
  }

  function requestRunNow(task: ScheduledTaskView) {
    setMessage('');
    setPendingRunTask(task);
  }

  async function confirmRunNow() {
    if (!pendingRunTask) return;
    const task = pendingRunTask;
    setRunningTaskName(task.name);
    try {
      await (window as any).electronAPI?.runTaskNow?.(task.name);
      setMessage(`${taskLabel(task.name)} 已触发。真实报表、审批和回读门槛仍然生效。`);
      setPendingRunTask(null);
      await loadTasks({ clearMessage: false });
    } catch (caught) {
      setMessage(`立即执行失败：${toUserFacingError(caught, '立即执行失败。')}`);
    } finally {
      setRunningTaskName('');
    }
  }

  useEffect(() => {
    loadTasks();
    const interval = window.setInterval(loadTasks, 30000);
    return () => window.clearInterval(interval);
  }, []);

  const enabledTaskCount = tasks.filter((task) => task.enabled).length;
  const nextTask = [...tasks]
    .filter((task) => task.nextRun)
    .sort((left, right) => Date.parse(left.nextRun || '') - Date.parse(right.nextRun || ''))[0];
  const lastTask = [...tasks]
    .filter((task) => task.lastRun)
    .sort((left, right) => Date.parse(right.lastRun || '') - Date.parse(left.lastRun || ''))[0];
  const taskPanelState = buildSchedulerTaskPanelState({
    tasks,
    loading,
    message,
    pendingRunTask,
    runningTaskName,
  });

  return (
    <div>
      <PageHeader
        eyebrow="系统与交付"
        title="定时任务"
        description="查看和控制本地自动化任务。定时任务不能绕过真实报表、人工审批和执行回读门槛。"
        primaryTask="管理自动化节奏"
        nextAction={tasks.some((task) => task.enabled) ? '关注下一次运行结果' : '按需启用任务'}
      />

      <div className="business-stack">
        <OperatorTaskPanel
          eyebrow="本地调度"
          title={taskPanelState.title}
          detail={taskPanelState.detail}
          primaryAction={{
            label: taskPanelState.primaryActionLabel,
            busy: taskPanelState.primaryActionBusy,
            busyLabel: taskPanelState.primaryBusyLabel,
            disabled: taskPanelState.primaryActionDisabled,
            onClick: taskPanelState.mode === 'confirm-run' ? confirmRunNow : () => loadTasks(),
          }}
          secondaryActions={taskPanelState.secondaryActions.map((action) => ({
            label: action.label,
            disabled: action.disabled,
            onClick: action.kind === 'cancel-run'
              ? () => setPendingRunTask(null)
              : () => action.route && navigate(action.route),
          }))}
        >
          <div className="dashboard-task-metrics" aria-label="定时任务摘要">
            <StatusPill tone={enabledTaskCount ? 'ready' : 'pending'}>
              启用 {enabledTaskCount}/{tasks.length}
            </StatusPill>
            <span>{nextTask ? `下次 ${taskLabel(nextTask.name)}` : '暂无下次运行'}</span>
            <span>{lastTask ? `最近 ${taskLabel(lastTask.name)}` : '尚无执行记录'}</span>
            <span>禁止自动写广告</span>
          </div>
          <div
            aria-live="polite"
            className={`scheduler-task-feedback scheduler-task-feedback-${taskPanelState.feedbackTone}`}
            role="status"
          >
            <span>{taskPanelState.feedbackLabel}</span>
            <strong>{taskPanelState.feedbackDetail}</strong>
          </div>
        </OperatorTaskPanel>

        <Panel title="本地调度控制器" tone={enabledTaskCount ? 'success' : 'warning'}>
          <StateLightGrid
            items={[
              {
                label: '启用任务',
                value: `${enabledTaskCount}/${tasks.length}`,
                detail: enabledTaskCount ? '按本地计划排队' : '全部停用',
                tone: enabledTaskCount ? 'ready' : 'warning',
              },
              {
                label: '下次唤起',
                value: nextTask ? formatDate(nextTask.nextRun) : '-',
                detail: nextTask ? taskLabel(nextTask.name) : '暂无可见计划',
                tone: nextTask ? 'ready' : 'pending',
              },
              {
                label: '最近执行',
                value: lastTask ? taskLabel(lastTask.name) : '-',
                detail: lastTask ? formatDate(lastTask.lastRun) : '尚无执行记录',
                tone: lastTask?.lastResult?.includes('失败') ? 'blocked' : lastTask ? 'ready' : 'pending',
              },
              {
                label: '当前动作',
                value: pendingRunTask ? taskLabel(pendingRunTask.name) : '等待操作',
                detail: pendingRunTask ? '需要确认后才会触发' : '表格中控制开关或立即执行',
                tone: pendingRunTask ? 'warning' : 'pending',
              },
            ]}
          />
          <div className="action-row">
            <button className="primary-button" disabled={loading} onClick={() => loadTasks()} type="button">
              {loading ? '正在刷新' : '刷新调度状态'}
            </button>
          </div>
        </Panel>

        <Panel title="自动化安全边界" tone="warning">
          <div className="context-summary-grid">
            <div>
              <span>允许自动做</span>
              <strong>下载、导入、生成本地建议</strong>
              <p>任务只能处理真实报表、量化指标、本地报告和待处理建议池；需复核项不会自动批准。</p>
            </div>
            <div>
              <span>禁止自动做</span>
              <strong>批准或写入广告账户</strong>
              <p>定时任务不会自动改 bid、否词、暂停投放或批量操作 Amazon Ads。</p>
            </div>
            <div>
              <span>真实执行要求</span>
              <strong>审批 + 截图 + 回读</strong>
              <p>任何广告动作仍需绑定目标、人工审批、执行前/执行后和回读证据。</p>
            </div>
            <div>
              <span>失败处理</span>
              <strong>看最近结果</strong>
              <p>失败不会静默通过；先处理登录、真实报表或导入指标缺口。</p>
            </div>
          </div>
        </Panel>

        <Panel title="任务职责">
          <div className="context-summary-grid">
            {tasks.map((task) => (
              <div key={task.name}>
                <span>{task.enabled ? '已启用' : '已停用'}</span>
                <strong>{taskLabel(task.name)}</strong>
                <p>{taskPurpose(task.name)}</p>
              </div>
            ))}
            {!tasks.length && (
              <div>
                <span>暂无任务</span>
                <strong>{loading ? '正在读取' : '未配置'}</strong>
                <p>{loading ? '正在读取本地计划任务。' : '当前没有可显示的定时任务。'}</p>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="任务列表">
          {pendingRunTask && (
            <div className="inline-confirmation">
              <div>
                <span>确认立即执行</span>
                <strong>{taskLabel(pendingRunTask.name)}</strong>
                <p>{taskPurpose(pendingRunTask.name)}</p>
                <p>本次只触发该本地任务；不会批准建议、不会改 bid、不会写入 Amazon Ads。执行结果会回到最近结果和对应业务页面。</p>
              </div>
              <div className="table-action-row">
                <button
                  className="secondary-button compact-button"
                  disabled={Boolean(runningTaskName)}
                  onClick={() => setPendingRunTask(null)}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="primary-button compact-button"
                  disabled={Boolean(runningTaskName)}
                  onClick={confirmRunNow}
                  type="button"
                >
                  {runningTaskName ? '正在执行' : '确认触发'}
                </button>
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table className="business-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>计划</th>
                  <th>状态</th>
                  <th>下次执行</th>
                  <th>上次执行</th>
                  <th>最近结果</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.name}>
                    <td>
                      <strong>{taskLabel(task.name)}</strong>
                      <div className="muted-cell">{taskPurpose(task.name)}</div>
                    </td>
                    <td>
                      <strong>{formatCronForOperator(task.cron)}</strong>
                      {task.cron && <div className="muted-cell">Cron：{task.cron}</div>}
                    </td>
                    <td><StatusPill tone={task.enabled ? 'ready' : 'pending'}>{task.enabled ? '已启用' : '已停用'}</StatusPill></td>
                    <td>{formatDate(task.nextRun)}</td>
                    <td>{formatDate(task.lastRun)}</td>
                    <td>{task.lastResult || '-'}</td>
                    <td>
                      <div className="table-action-row">
                        <button className="secondary-button compact-button" onClick={() => toggleTask(task)} type="button">
                          {task.enabled ? '停用' : '启用'}
                        </button>
                        <button className="secondary-button compact-button" onClick={() => requestRunNow(task)} type="button">
                          立即执行
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!tasks.length && (
                  <tr>
                    <td colSpan={7}>{loading ? '正在读取任务...' : '当前没有可显示的定时任务。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {message && <p className={message.includes('失败') ? 'blocked-line' : 'muted-line'}>{message}</p>}
        </Panel>
      </div>
    </div>
  );
}
