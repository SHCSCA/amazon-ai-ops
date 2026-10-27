import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ArrowsClockwise, CalendarBlank, CheckCircle, Clock, Database, Play, ShieldCheck, WarningCircle, X } from '@phosphor-icons/react';
import { missionControlContextKey, type StoreCollectionScheduleProjection, type StoreContextEnvelope } from '@amazon-ai-ops/shared-types';
import { PageFrame, SummaryStrip, TaskBanner, WorkbenchPanel, WorkspaceState } from '../components/workspace';

import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { useWorkspaceOperation } from '../components/workspace/use-workspace-operation';
import { rendererRuntimeLog } from '../runtime-log';
import { STORE_AUTOMATION_CAPABILITY_IDS, type StoreEvidenceRetentionBlockerView, type StoreEvidenceRetentionSummary, type StoreAutomationRendererApi, type SchedulerPageProps, STORE_AUTOMATION_STATES, readStoreAutomationRendererApi, resolveStoreAutomationAccess, schedulerOperatorMessage, schedulerRunNowPolicy, schedulerFailureReviewLabel, storeAutomationRequestMatches, normalizeRetentionSummary, navigate, validateScheduleProjection, stateLabel, formatBytes, taskCopy } from './scheduler-model';
export { STORE_AUTOMATION_CAPABILITY_IDS, type StoreEvidenceRetentionBlockerView, type StoreEvidenceRetentionSummary, type StoreAutomationRendererApi, type SchedulerPageProps, STORE_AUTOMATION_STATES, readStoreAutomationRendererApi, resolveStoreAutomationAccess, schedulerOperatorMessage, schedulerRunNowPolicy, schedulerFailureReviewLabel, storeAutomationRequestMatches, normalizeRetentionSummary } from './scheduler-model';

export function SchedulerPage({
  storeContext,
  capabilities,
  previewMode = false,
  api: explicitApi,
}: SchedulerPageProps) {
  const api = explicitApi === undefined ? readStoreAutomationRendererApi(window) : explicitApi;
  const authorityKey = missionControlContextKey(storeContext);
  const operation = useWorkspaceOperation(authorityKey);
  const access = useMemo(
    () => resolveStoreAutomationAccess(capabilities, previewMode),
    [capabilities, previewMode],
  );
  const [projection, setProjection] = useState<StoreCollectionScheduleProjection | null>(null);
  const [retention, setRetention] = useState<StoreEvidenceRetentionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshOrigin, setRefreshOrigin] = useState<'primary' | 'secondary'>('primary');
  const requestSequence = useRef(0);
  const confirmDialogRef = useRef<HTMLElement | null>(null);
  const confirmReturnFocusRef = useRef<HTMLElement | null>(null);

  const isCurrentRequest = (sequence: number, key: string) => (
    operation.capture()() && storeAutomationRequestMatches(sequence, requestSequence.current, key, authorityKey)
  );

  async function loadRetention(
    context: StoreContextEnvelope,
    sequence: number,
    key: string,
  ) {
    if (!api || !access.retentionPreview.allowed) return;
    setRetentionLoading(true);
    setRetentionError(null);
    try {
      const raw = await api.previewStoreEvidenceRetention(context);
      const next = normalizeRetentionSummary(raw, context);
      if (isCurrentRequest(sequence, key)) setRetention(next);
    } catch (caught) {
      rendererRuntimeLog.error('scheduler.retention_read_failed', { error: caught });
      if (isCurrentRequest(sequence, key)) {
        setRetention(null);
        setRetentionError(schedulerOperatorMessage(caught, '读取证据保留预览失败，请刷新后重试。'));
      }
    } finally {
      if (isCurrentRequest(sequence, key)) setRetentionLoading(false);
    }
  }

  async function loadCurrentStoreAuthorized(
    context: StoreContextEnvelope,
    sequence: number,
    key: string,
  ) {
    if (!api) {
      setLoading(false);
      setError('当前店铺自动化接口不可用，请重新打开最新安装版后重试。');
      return;
    }
    try {
      const next = validateScheduleProjection(
        await api.getStoreCollectionSchedule(context),
        context,
      );
      if (!isCurrentRequest(sequence, key)) return;
      setProjection(next);
      if (next.state !== 'not_configured' && next.state !== 'archived') {
        await loadRetention(context, sequence, key);
      }
    } catch (caught) {
      rendererRuntimeLog.error('scheduler.schedule_read_failed', { error: caught });
      if (isCurrentRequest(sequence, key)) {
        setError(schedulerOperatorMessage(caught, '读取当前店铺自动化失败，请刷新后重试。'));
      }
    } finally {
      if (isCurrentRequest(sequence, key)) setLoading(false);
    }
  }

  async function loadCurrentStore(options: { keepMessage?: boolean } = {}) {
    const sequence = ++requestSequence.current;
    const key = authorityKey;
    const context = storeContext;
    setLoading(true);
    // 每次范围变化都独立持有证据预览请求状态。
    setRetentionLoading(false);
    setError(null);
    setProjection(null);
    setRetention(null);
    setRetentionError(null);
    setConfirmRun(false);
    if (!options.keepMessage) setMessage(null);
    if (!access.view.allowed) {
      setLoading(false);
      setError('当前店铺自动化视图不可用，请刷新或检查运行设置。');
      return;
    }
    await loadCurrentStoreAuthorized(context, sequence, key);
  }

  async function refreshCurrentStore(origin: 'primary' | 'secondary') {
    const ticket = operation.begin();
    if (!ticket) return;
    setRefreshOrigin(origin);
    try { await loadCurrentStore(); } finally { ticket.finish(); }
  }

  async function refreshRetention() {
    const ticket = operation.begin();
    if (!ticket) return;
    try {
      const sequence = ++requestSequence.current;
      await loadRetention(storeContext, sequence, authorityKey);
    } finally { ticket.finish(); }
  }

  useEffect(() => {
    setProjection(null);
    setRetention(null);
    setError(null);
    setRetentionError(null);
    setRetentionLoading(false);
    setMessage(null);
    setConfirmRun(false);
    setRunning(false);
    void loadCurrentStore();
    return () => {
      requestSequence.current += 1;
    };
    // 店铺、档案或会话变化必须使旧异步结果失效。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorityKey, access.view.allowed, access.retentionPreview.allowed, api]);

  useEffect(() => {
    if (!confirmRun) return undefined;
    confirmDialogRef.current
      ?.querySelector<HTMLElement>('[data-confirm-initial]')
      ?.focus();
    return () => {
      confirmReturnFocusRef.current?.focus();
      confirmReturnFocusRef.current = null;
    };
  }, [confirmRun]);

  function openRunConfirmation() {
    confirmReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setConfirmRun(true);
  }

  function handleConfirmDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !running) {
      event.preventDefault();
      setConfirmRun(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = [...(confirmDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    if (controls.length === 0) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function runNow() {
    if (!api || running || loading || retentionLoading || !projection || !access.runNow.allowed) return;
    const policy = schedulerRunNowPolicy(projection);
    if (!policy.allowed) return;
    const ticket = operation.begin();
    if (!ticket) return;
    const sequence = ++requestSequence.current;
    const context = storeContext;
    const key = authorityKey;
    setRunning(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.runStoreCollectionScheduleNow(context);
      const next = validateScheduleProjection(result.projection, context);
      if (!isCurrentRequest(sequence, key)) return;
      setProjection(next);
      setConfirmRun(false);
      setMessage(
        result.duplicate
          ? '系统已识别同一业务日的重复请求，本次没有重复执行。'
          : next.state === 'succeeded'
            ? '当前店铺本业务日采集已完成。'
            : next.state === 'failed'
              ? '采集失败关闭；同一采集口径不会自动重试。'
              : '当前店铺采集已受理。',
      );
      if (next.state !== 'not_configured' && next.state !== 'archived') {
        await loadRetention(context, sequence, key);
      }
    } catch (caught) {
      rendererRuntimeLog.error('scheduler.run_now_failed', { error: caught });
      if (isCurrentRequest(sequence, key)) {
        setConfirmRun(false);
        setError(schedulerOperatorMessage(caught, '立即触发当前店铺采集失败，请刷新后重试。'));
      }
    } finally {
      if (ticket.isCurrent() && isCurrentRequest(sequence, key)) setRunning(false);
      ticket.finish();
    }
  }

  const runPolicy = schedulerRunNowPolicy(projection);
  const task = taskCopy(projection, loading, error);
  const needsConfig = projection?.state === 'not_configured' || projection?.state === 'archived';
  const runNowDisabledReason = !access.runNow.allowed
    ? schedulerOperatorMessage(
      access.runNow.capability?.detail,
      '立即采集暂不可用，请刷新或检查运行设置。',
    )
    : runPolicy.reason;
  const projectionDetail = projection
    ? schedulerOperatorMessage(projection.detail, runNowDisabledReason)
    : runNowDisabledReason;
  const primaryAction = needsConfig
    ? {
        actionId: 'settings.scheduler.open-config',
        label: '前往 AI 与本地设置',
        onClick: () => navigate('settings'),
      }
    : runPolicy.allowed
      ? {
          actionId: STORE_AUTOMATION_CAPABILITY_IDS.runNow,
          label: '立即采集',
          onClick: openRunConfirmation,
          disabled: !access.runNow.allowed || running || loading || retentionLoading || operation.busy,
          disabledReason: !access.runNow.allowed ? runNowDisabledReason : '当前店铺计划或证据预览处理中，请等待完成后采集。',
        }
      : {
          actionId: 'settings.scheduler.refresh',
          label: '刷新当前店铺',
          busy: loading && refreshOrigin === 'primary',
          busyLabel: '读取中…',
          onClick: () => { void refreshCurrentStore('primary'); },
          disabled: running || retentionLoading || operation.busy,
          disabledReason: '当前店铺操作处理中，请等待完成；刷新不会重试已失败的同一采集口径。',
        };

  return (
    <PageFrame
      className="mission-control-store-automation"
      description="按当前店铺、美国站、USD 与业务日管理领星自动采集；所有结果都会再次核对店铺范围。"
      pageId="store-automation"
      title="当前店铺自动化"
      task={(
        <TaskBanner
          eyebrow={previewMode ? '仅开发预览 · 当前店铺计划' : '当前店铺计划'}
          title={task.title}
          description={task.detail}
          tone={task.tone}
          status={<span>{stateLabel(projection?.state)}</span>}
          primaryAction={primaryAction}
          secondaryActions={[
            {
              actionId: 'settings.scheduler.refresh-secondary',
              label: '刷新',
              busy: loading && refreshOrigin === 'secondary',
              busyLabel: '读取中…',
              disabled: running || retentionLoading || operation.busy,
              disabledReason: '当前店铺采集或证据预览处理中，请等待完成后刷新。',
              onClick: () => { void refreshCurrentStore('secondary'); },
            },
          ]}
          meta={message ?? projectionDetail}
        />
      )}
      summary={(
        <SummaryStrip
          ariaLabel="当前店铺自动化范围"
          items={[
            {
              id: 'store',
              label: '店铺范围',
              value: '当前店铺',
              detail: 'Amazon US · USD',
              tone: 'confirmed',
            },
            {
              id: 'business-date',
              label: '业务日',
              value: storeContext.businessDate,
              detail: '按店铺业务时区',
            },
            {
              id: 'timezone',
              label: '业务时区',
              value: storeContext.businessTimezone,
              detail: `会话代次 ${storeContext.sessionGeneration}`,
            },
            {
              id: 'revision',
              label: '配置版本',
              value: projection?.configRevision ? `r${projection.configRevision}` : '未生效',
              detail: projection?.scheduleLocalTime ? `每日 ${projection.scheduleLocalTime}` : '等待配置',
              tone: projection?.configRevision ? 'confirmed' : 'attention',
            },
          ]}
        />
      )}
    >
      {error && <div className="mission-control-store-error" role="alert">{error}</div>}

      <WorkbenchPanel
        className="mission-control-automation-plan"
        description="七个状态构成同一采集口径生命周期；同一店铺、业务日与采集口径的失败终态不会回到等待。"
        status={<span>{stateLabel(projection?.state)} · 7 状态</span>}
        title="本业务日计划"
      >
        {loading ? (
          <WorkspaceState
            description="正在读取当前店铺计划、配置版本与幂等记录。"
            kind="loading"
            title="正在核对计划"
          />
        ) : !projection ? (
          <WorkspaceState
            action={{ label: '重新读取', onClick: () => { void loadCurrentStore(); } }}
            description={error ?? '当前店铺没有可验证的计划投影。'}
            kind="error"
            title="计划投影不可用"
          />
        ) : (
          <div className="mission-control-automation-state-grid" role="list" aria-label="店铺自动化七状态计划">
            {STORE_AUTOMATION_STATES.map((item, index) => {
              const active = item.state === projection.state;
              return (
                <article
                  aria-current={active ? 'step' : undefined}
                  className="mission-control-automation-state"
                  data-active={active || undefined}
                  data-state={item.state}
                  key={item.state}
                  role="listitem"
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                  {active && <CheckCircle aria-hidden="true" size={18} weight="fill" />}
                </article>
              );
            })}
          </div>
        )}
        {projection && (
          <div
            aria-label="当前采集窗口"
            className="mission-control-automation-window"
            data-business-date={projection.businessDate}
            data-currency={storeContext.currency}
            data-marketplace={storeContext.marketplace}
            data-schedule-enabled={String(projection.enabled)}
            data-schedule-state={projection.state}
            data-store-id={projection.storeId}
            role="list"
          >
            <AutomationFact
              icon={<CalendarBlank aria-hidden="true" size={18} />}
              label="采集日期"
              value={projection.dateStart && projection.dateEnd
                ? `${projection.dateStart} → ${projection.dateEnd}`
                : '等待活动配置'}
            />
            <AutomationFact
              icon={<Clock aria-hidden="true" size={18} />}
              label="每日计划"
              value={projection.scheduleLocalTime
                ? `${projection.scheduleLocalTime} · ${storeContext.businessTimezone}`
                : '当前未启用'}
            />
            <AutomationFact
              icon={<Database aria-hidden="true" size={18} />}
              label="最近认领"
              value={projection.lastAttempt
                ? `${projection.lastAttempt.trigger === 'manual' ? '人工触发' : '计划触发'} · ${projection.lastAttempt.state}`
                : '尚无本业务日认领'}
            />
            <AutomationFact
              icon={<ShieldCheck aria-hidden="true" size={18} />}
              label="失败策略"
              value={schedulerFailureReviewLabel(projection.state)}
            />
          </div>
        )}
      </WorkbenchPanel>

      <WorkbenchPanel
        className="mission-control-retention-preview"
        description="只读扫描当前店铺证据空间。页面只接收汇总，不显示候选文件名，也不提供任何变更入口。"
        status={<span>仅预览 · 不支持删除</span>}
        title="证据保留预览"
        toolbar={(
          <WorkspaceActionButton disabledReason={needsConfig ? '当前店铺尚无生效配置，请前往 AI 与本地设置创建或恢复。' : !access.retentionPreview.allowed ? schedulerOperatorMessage(access.retentionPreview.capability?.detail, '当前店铺证据预览权限不可用，请刷新或检查运行设置。') : !api ? '当前应用接口不可用，请重新打开最新安装版。' : '当前店铺操作处理中，请等待返回后刷新只读预览。'} busy={retentionLoading} busyLabel="扫描中…"
            aria-busy={retentionLoading || undefined}
            className="workspace-button workspace-button--secondary"
            data-capability-id={STORE_AUTOMATION_CAPABILITY_IDS.retentionPreview}
            disabled={(retentionLoading
              || running
              || needsConfig
              || !access.retentionPreview.allowed
              || !api) || loading || retentionLoading || operation.busy}
            onClick={() => {
              void refreshRetention();
            }}
            title={!access.retentionPreview.allowed
              ? schedulerOperatorMessage(
                access.retentionPreview.capability?.detail,
                '证据保留预览暂不可用，请刷新或检查运行设置。',
              )
              : undefined}
            type="button"
          >
            <ArrowsClockwise aria-hidden="true" size={16} />
            {retentionLoading ? '扫描中…' : '刷新只读预览'}
          </WorkspaceActionButton>
        )}
      >
        {needsConfig ? (
          <WorkspaceState
            action={{ label: '前往 AI 与本地设置', onClick: () => navigate('settings') }}
            description={projection?.state === 'archived'
              ? '恢复当前店铺配置后，才能按其证据保留天数生成只读预览。'
              : '创建当前店铺配置并设置证据保留天数后，再生成只读预览。'}
            kind="disabled"
            title={projection?.state === 'archived' ? '运行配置已归档' : '尚无运行配置'}
          />
        ) : !access.retentionPreview.allowed ? (
          <WorkspaceState
            description="当前店铺证据保留预览不可用，请刷新或检查运行设置。"
            kind="blocked"
            title="只读预览未获授权"
          />
        ) : retentionLoading && !retention ? (
          <WorkspaceState
            description="正在按当前店铺证据保留期扫描页面截图与运行记录；不会修改文件。"
            kind="loading"
            title="正在生成只读预览"
          />
        ) : retentionError ? (
          <WorkspaceState
            action={{
              label: '重新扫描',
              onClick: () => {
                const sequence = ++requestSequence.current;
                void loadRetention(storeContext, sequence, authorityKey);
              },
            }}
            description={retentionError}
            kind="error"
            title="证据保留预览失败"
          />
        ) : retention ? (
          <>
            <div
              aria-label="证据保留只读预览摘要"
              className="mission-control-retention-metrics"
              data-blocker-count={retention.blockers.length}
              data-browser-profile-id={retention.profileId}
              data-candidate-count={retention.candidateCount}
              data-currency={retention.currency}
              data-marketplace={retention.marketplace}
              data-store-id={retention.storeId}
              role="list"
            >
              <RetentionMetric icon={<Archive aria-hidden="true" size={18} />} label="保留期" value={`${retention.retentionDays} 天`} />
              <RetentionMetric icon={<CalendarBlank aria-hidden="true" size={18} />} label="截止时间" value={new Date(retention.cutoffAt).toLocaleString()} />
              <RetentionMetric icon={<Database aria-hidden="true" size={18} />} label="候选汇总" value={`${retention.candidateCount} 项 · ${formatBytes(retention.candidateBytes)}`} />
              <RetentionMetric icon={<ShieldCheck aria-hidden="true" size={18} />} label="受保护" value={`${retention.protectedCount} 项 · 永不进入候选`} />
            </div>
            <div
              className="mission-control-retention-safety"
              data-scan-safe={retention.scanSafe}
              role={retention.blockers.length ? 'alert' : 'status'}
            >
              {retention.blockers.length ? <WarningCircle aria-hidden="true" size={20} /> : <ShieldCheck aria-hidden="true" size={20} />}
              <div>
                <strong>{retention.blockers.length ? `${retention.blockers.length} 个安全阻塞项` : '只读扫描通过安全检查'}</strong>
                <p>
                  {retention.blockers.length
                    ? '存在阻塞时诊断清单仅用于排查；当前版本始终不支持删除或应用。'
                    : '候选仅作容量规划；当前版本始终不支持删除或应用。'}
                </p>
              </div>
            </div>
            {retention.blockers.length > 0 && (
              <ul className="mission-control-retention-blockers" aria-label="证据保留阻塞项">
                {retention.blockers.map((blocker, index) => (
                  <li key={`${blocker.code}-${index}`}>
                    <span>{blocker.detail}</span>
                    <details className="mission-control-retention-blocker-diagnostics">
                      <summary>诊断详情</summary>
                      <code>{blocker.code}</code>
                      <p>{blocker.diagnosticDetail}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <WorkspaceState
            description="等待当前店铺计划读取完成后生成只读汇总。"
            kind="empty"
            title="尚无证据保留预览"
          />
        )}
      </WorkbenchPanel>

      {confirmRun && projection && (
        <div className="mission-control-dialog-backdrop">
          <section
            aria-describedby="store-automation-confirm-description"
            aria-labelledby="store-automation-confirm-title"
            aria-modal="true"
            className="mission-control-dialog mission-control-dialog--confirm"
            onKeyDown={handleConfirmDialogKeyDown}
            ref={confirmDialogRef}
            role="alertdialog"
          >
            <header>
              <div>
                <span>仅当前店铺 · 立即采集</span>
                <h2 id="store-automation-confirm-title">立即触发当前店铺采集？</h2>
                <p id="store-automation-confirm-description">
                  当前店铺 · {storeContext.businessDate} ·
                  {' '}{projection.dateStart} 至 {projection.dateEnd}。系统会再次核对可见领星会话与采集口径。
                </p>
              </div>
              <WorkspaceActionButton disabledReason={'当前店铺采集或读取处理中，请等待完成后关闭确认。'}
                aria-label="关闭立即采集确认"
                className="mission-control-dialog__close"
                disabled={(running) || loading || retentionLoading || operation.busy}
                onClick={() => setConfirmRun(false)}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </WorkspaceActionButton>
            </header>
            <div className="mission-control-automation-confirm-boundary">
              <WarningCircle aria-hidden="true" size={20} />
              <p>同一店铺、业务日与采集口径一旦形成终态就不重试；调整触发时间不会绕过安全限制，只有回看窗口变化才会形成新的采集口径标识。</p>
            </div>
            <footer>
              <WorkspaceActionButton disabledReason={'当前店铺采集或读取处理中，请等待完成后关闭确认。'}
                className="workspace-button workspace-button--secondary"
                data-confirm-initial
                disabled={(running) || loading || retentionLoading || operation.busy}
                onClick={() => setConfirmRun(false)}
                type="button"
              >
                取消
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={running || operation.busy ? '正在提交当前店铺采集请求，请等待返回。' : runNowDisabledReason || '正在核对当前店铺配置，请等待完成。'} busy={running} busyLabel="正在触发…"
                aria-busy={running || undefined}
                className="workspace-button workspace-button--primary"
                data-capability-id={STORE_AUTOMATION_CAPABILITY_IDS.runNow}
                disabled={(running || !runPolicy.allowed || !access.runNow.allowed) || loading || retentionLoading || operation.busy}
                onClick={() => { void runNow(); }}
                type="button"
              >
                <Play aria-hidden="true" size={16} weight="fill" />
                {running ? '正在触发…' : '确认立即采集'}
              </WorkspaceActionButton>
            </footer>
          </section>
        </div>
      )}
    </PageFrame>
  );
}

function AutomationFact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="mission-control-automation-fact" role="listitem">
      <span>{icon}</span>
      <div><small>{label}</small><strong>{value}</strong></div>
    </div>
  );
}

function RetentionMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="mission-control-retention-metric" role="listitem">
      <span>{icon}</span>
      <div><small>{label}</small><strong>{value}</strong></div>
    </div>
  );
}
