import React, { useEffect, useState } from 'react';
import { PageHeader, Panel, StatusPill } from '../components/ui';
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

function taskPurpose(name: string): string {
  const labels: Record<string, string> = {
    daily_report_download: '从领星下载当前计划范围的广告报表，不负责审批或执行广告动作。',
    daily_recommendation_generate: '基于已导入真实指标生成待审批建议，不会写入 Amazon Ads。',
    daily_report_generate: '生成本地运营汇总和证据材料，不改变业务数据。',
    data_cleanup: '清理本地临时文件和过期缓存，不删除交付证据包。',
  };
  return labels[name] || '本地计划任务。执行结果必须继续满足真实数据、审批和回读门槛。';
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
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
        <Panel title="自动化安全边界" tone="warning">
          <div className="context-summary-grid">
            <div>
              <span>允许自动做</span>
              <strong>下载、导入、生成本地建议</strong>
              <p>任务只能处理真实报表、量化指标、本地报告和待审批建议。</p>
            </div>
            <div>
              <span>禁止自动做</span>
              <strong>批准或写入广告账户</strong>
              <p>定时任务不会自动改 bid、否词、暂停投放或批量操作 Amazon Ads。</p>
            </div>
            <div>
              <span>真实执行要求</span>
              <strong>审批 + 截图 + readback</strong>
              <p>任何广告动作仍需绑定目标、人工审批、before/after 和回读证据。</p>
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
                  <th>Cron</th>
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
                    <td>{task.cron || '-'}</td>
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
