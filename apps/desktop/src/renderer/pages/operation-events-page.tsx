import { useEffect, useMemo, useRef, useState } from 'react';
import { useScopeStore } from '../scope-store';
import { toUserFacingError } from '../user-facing-error';
import { ProgressiveDetails } from '../components/progressive-details';
import { FormTable, FormTableRow, KpiCard, PageHeader, Panel, StatusPill } from '../components/ui';
import { TaskBanner } from '../components/workspace';
import { useOverlayFocusScope } from '../components/workspace/overlay-focus-scope';
import { PAGE_HEADER_TITLES } from '../page-header-copy';
import type { OperationEventView } from '../types';
import { WorkspaceActionButton } from '../components/workspace/action-feedback';
import { useWorkspaceOperation } from '../components/workspace/use-workspace-operation';
import { useMissionControlStoreContext } from '../mission-control/store-context';
import { businessPipelineScopeKey } from '../components/business-data';
import { rendererRuntimeLog } from '../runtime-log';
import { OPERATION_EVENT_PAGE_COPY, EVENT_TYPE_LABELS, IMPACT_LABELS, EVENT_USAGE_HINTS, EVENT_PRESETS, navigate, type OperationEventViewMode, defaultOperationEventViewMode, filterOperationEventsForView, buildOperationEventDraftForScope, operationEventScopeLabel, operationEventCardClassName, operationEventTimelineCardView, operationEventInlineSaveLabel, type OperationEventInlineSaveButtonView, operationEventInlineSaveButtonView, operationEventRefreshButtonView, operationEventRowDeleteButtonView, operationEventFormClassName, buildOperationEventTaskState, formatEventType, formatImpact, formatEventScope } from './operation-events-model';
export { OPERATION_EVENT_PAGE_COPY, type OperationEventViewMode, defaultOperationEventViewMode, filterOperationEventsForView, buildOperationEventDraftForScope, operationEventScopeLabel, operationEventCardClassName, operationEventTimelineCardView, operationEventInlineSaveLabel, type OperationEventInlineSaveButtonView, operationEventInlineSaveButtonView, operationEventRefreshButtonView, operationEventRowDeleteButtonView, operationEventFormClassName, buildOperationEventTaskState } from './operation-events-model';

export function OperationEventsPage() {
  const { scope } = useScopeStore();
  const authority = useMissionControlStoreContext();
  const operationKey = `${authority.authorityKey}|${businessPipelineScopeKey(scope)}`;
  const operation = useWorkspaceOperation(operationKey);
  const loadSequence = useRef(0);
  const [events, setEvents] = useState<OperationEventView[]>([]);
  const [viewMode, setViewMode] = useState<OperationEventViewMode>(defaultOperationEventViewMode(scope.asin));
  const [draft, setDraft] = useState(() => buildOperationEventDraftForScope(scope, defaultOperationEventViewMode(scope.asin)));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [recentSavedEventId, setRecentSavedEventId] = useState<number | null>(null);
  const [recentDraftClearTick, setRecentDraftClearTick] = useState<number | null>(null);
  const [deletingEventId, setDeletingEventId] = useState<number | null>(null);
  const [eventEditorOpen, setEventEditorOpen] = useState(false);
  const groupBusy = saving || deletingEventId !== null || loading;

  const visibleEvents = useMemo(
    () => filterOperationEventsForView(events, viewMode, scope.asin),
    [events, scope.asin, viewMode],
  );

  const eventsByDate = useMemo(() => {
    const groups = new Map<string, OperationEventView[]>();
    for (const event of visibleEvents) {
      const rows = groups.get(event.eventDate) || [];
      rows.push(event);
      groups.set(event.eventDate, rows);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [visibleEvents]);

  const selectedTypeHint = EVENT_USAGE_HINTS[draft.eventType] || EVENT_USAGE_HINTS.manual_note;
  const specificEventCount = visibleEvents.filter((event) => event.asin || event.campaignName || event.adGroupName).length;
  const canSaveEvent = Boolean(draft.eventDate && draft.storeName && draft.marketplaceCode && draft.title);
  const taskState = buildOperationEventTaskState({
    visibleEventCount: visibleEvents.length,
    totalEventCount: events.length,
    specificEventCount,
    viewMode,
    selectedAsin: scope.asin,
    canSave: canSaveEvent,
    saving,
  });
  const inlineSaveButton = operationEventInlineSaveButtonView({
    baseClassName: 'primary-button',
    canSave: canSaveEvent,
    saving,
  });
  const refreshButton = operationEventRefreshButtonView(loading && !saving && deletingEventId === null);

  function applyPreset(preset: (typeof EVENT_PRESETS)[number]) {
    setDraft({
      ...draft,
      eventType: preset.eventType,
      impactExpectation: preset.impactExpectation,
      title: preset.title,
      notes: preset.notes,
    });
  }

  function openEventEditor() {
    setEventEditorOpen(true);
  }

  function closeEventEditor() {
    if (saving) return;
    setEventEditorOpen(false);
  }

  const operationEventDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: saving,
    onDismiss: closeEventEditor,
    open: eventEditorOpen,
  });

  async function loadEvents() {
    const isCurrent = operation.capture();
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError('');
    try {
      const rows = await (window as any).electronAPI.listOperationEvents({
        dateFrom: scope.dateFrom,
        dateTo: scope.dateTo,
        storeName: scope.storeName,
        marketplaceCode: scope.marketplaceCode,
        limit: 300,
      });
      if (!isCurrent() || sequence !== loadSequence.current) return;
      setEvents(Array.isArray(rows) ? rows : []);
    } catch (caught) {
      rendererRuntimeLog.error('operation_events.load_failed', { error: caught });
      if (!isCurrent() || sequence !== loadSequence.current) return;
      setError(toUserFacingError(caught, '读取运营事件失败'));
    } finally {
      if (isCurrent() && sequence === loadSequence.current) setLoading(false);
    }
  }

  async function refreshEvents() {
    const ticket = operation.begin();
    if (!ticket) return;
    try { await loadEvents(); } finally { ticket.finish(); }
  }

  useEffect(() => {
    setEvents([]);
    setSaving(false);
    setDeletingEventId(null);
    setMessage('');
    setError('');
    setEventEditorOpen(false);
    const nextViewMode = defaultOperationEventViewMode(scope.asin);
    setViewMode(nextViewMode);
    setDraft(buildOperationEventDraftForScope(scope, nextViewMode));
    void loadEvents();
  }, [operationKey]);

  useEffect(() => {
    if (!recentSavedEventId) return undefined;
    const timeout = window.setTimeout(() => setRecentSavedEventId(null), 450);
    return () => window.clearTimeout(timeout);
  }, [recentSavedEventId]);

  useEffect(() => {
    if (!recentDraftClearTick) return undefined;
    const timeout = window.setTimeout(() => setRecentDraftClearTick(null), 360);
    return () => window.clearTimeout(timeout);
  }, [recentDraftClearTick]);

  async function saveEvent() {
    if (!canSaveEvent) return;
    const ticket = operation.begin();
    if (!ticket) return;
    const submittedDraft = draft;
    const resetDraft = buildOperationEventDraftForScope(scope, viewMode);
    setSaving(true);
    setError('');
    setMessage('事件已提交，表单已清空，正在写入本地上下文...');
    setDraft(resetDraft);
    setRecentDraftClearTick(Date.now());
    try {
      const created = await (window as any).electronAPI.createOperationEvent({
        ...submittedDraft,
        asin: submittedDraft.asin || undefined,
        campaignName: submittedDraft.campaignName || undefined,
        adGroupName: submittedDraft.adGroupName || undefined,
        notes: submittedDraft.notes || undefined,
        evidencePath: submittedDraft.evidencePath || undefined,
      });
      if (!ticket.isCurrent()) return;
      setMessage('运营事件已记录，会进入广告表现和 AI 诊断上下文。');
      await loadEvents();
      if (!ticket.isCurrent()) return;
      const createdId = Number(created?.id);
      if (Number.isInteger(createdId) && createdId > 0) setRecentSavedEventId(createdId);
      setEventEditorOpen(false);
    } catch (caught) {
      rendererRuntimeLog.error('operation_events.save_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setDraft(submittedDraft);
      setError(toUserFacingError(caught, '保存运营事件失败'));
      setMessage('保存失败，已恢复刚才填写的事件。');
    } finally {
      if (ticket.isCurrent()) setSaving(false);
      ticket.finish();
    }
  }

  async function archiveEvent(id: number) {
    const ticket = operation.begin();
    if (!ticket) return;
    setDeletingEventId(id);
    setError('');
    setMessage('正在归档运营事件...');
    try {
      await (window as any).electronAPI.deleteOperationEvent(id);
      if (!ticket.isCurrent()) return;
      setMessage('运营事件已归档，历史记录仍保留。');
      await loadEvents();
    } catch (caught) {
      rendererRuntimeLog.error('operation_events.archive_failed', { error: caught });
      if (!ticket.isCurrent()) return;
      setError(toUserFacingError(caught, '归档运营事件失败'));
    } finally {
      if (ticket.isCurrent()) setDeletingEventId(null);
      ticket.finish();
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="数据"
        title={PAGE_HEADER_TITLES.operationEvents}
        description="先看当前范围事件时间轴；新增和维护通过弹窗处理，AI 使用说明和覆盖统计放在辅助区。"
      />

      <TaskBanner
        description={taskState.detail}
        meta={`${specificEventCount} 条已绑定产品或广告对象 · 共 ${events.length} 条事件`}
        primaryAction={{
          label: saving ? '记录事件' : taskState.primaryActionLabel,
          onClick: openEventEditor,
          disabled: taskState.primaryActionDisabled || groupBusy,
          disabledReason: '当前事件操作处理中，请等待完成后打开编辑器。',
          busy: false,
          busyLabel: taskState.primaryActionBusyLabel,
        }}
        secondaryActions={[
          { label: taskState.secondaryActionLabel, onClick: () => navigate('ad-quant'), disabled: groupBusy, disabledReason: '当前事件操作处理中，请等待完成后进入广告表现。' },
          { label: '查看优化建议', onClick: () => navigate('recommendations'), disabled: groupBusy, disabledReason: '当前事件操作处理中，请等待完成后查看建议。' },
        ]}
        status={visibleEvents.length ? `${visibleEvents.length} 条当前事件` : '待补充上下文'}
        title={taskState.title}
        tone={visibleEvents.length ? 'confirmed' : 'attention'}
      />

      <div className="business-stack">
        {!scope.asin && <p className="muted-line">当前产品视图需要先锁定 ASIN。<WorkspaceActionButton className="secondary-button compact-button" disabled={groupBusy} disabledReason="当前事件操作处理中，请等待完成后选择产品。" onClick={() => navigate('product-management')}>前往产品管理</WorkspaceActionButton></p>}
        <div className="operation-events-workbench-toolbar">
          <div className="operation-events-workbench-summary" aria-label="运营事件摘要">
            <div>
              <span>当前视图</span>
              <strong>{visibleEvents.length}</strong>
            </div>
            <div>
              <span>绑定对象</span>
              <strong>{specificEventCount}</strong>
            </div>
            <div>
              <span>全局事件</span>
              <strong>{Math.max(0, visibleEvents.length - specificEventCount)}</strong>
            </div>
            <div>
              <span>执行边界</span>
              <strong>只补上下文</strong>
            </div>
          </div>
        </div>
        {message && <p className={saving || deletingEventId !== null ? 'muted-line' : 'ready-line'} role="status" aria-live="polite">{message}</p>}
        {error && <p className="blocked-line">{error}</p>}

        <Panel title={OPERATION_EVENT_PAGE_COPY.timelinePanelTitle} tone={visibleEvents.length ? 'success' : 'warning'}>
          <div className="business-pill-row operation-events-view-switch">
            <WorkspaceActionButton disabledReason={!scope.asin ? '当前尚未锁定产品，请到产品管理选择产品并锁定 ASIN。' : '当前事件操作尚未结束，请等待完成后切换。'}
              className={`secondary-button compact-button ${viewMode === 'product' ? 'button-active' : ''}`}
              disabled={(!scope.asin) || groupBusy}
              onClick={() => {
                setViewMode('product');
                setDraft(buildOperationEventDraftForScope(scope, 'product'));
              }}
              type="button"
            >
              当前产品
            </WorkspaceActionButton>
            <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy}
              className={`secondary-button compact-button ${viewMode === 'global' ? 'button-active' : ''}`}
              onClick={() => {
                setViewMode('global');
                setDraft(buildOperationEventDraftForScope(scope, 'global'));
              }}
              type="button"
            >
              全局事件
            </WorkspaceActionButton>
            <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy}
              className={`secondary-button compact-button ${viewMode === 'all' ? 'button-active' : ''}`}
              onClick={() => setViewMode('all')}
              type="button"
            >
              全部事件
            </WorkspaceActionButton>
          </div>
          {loading && <p className="muted-line">正在读取运营事件...</p>}
          {!loading && eventsByDate.length === 0 && (
            <p className="muted-line">当前范围还没有运营事件。若近期做过折扣、BD、价格、Listing 或库存动作，应先记录，否则 AI 只能看广告表格。</p>
          )}
          <div className="event-timeline operation-events-primary-timeline">
            {eventsByDate.map(([date, rows]) => (
              <div className="event-day" key={date}>
                <div className="event-day-date">{date}</div>
                <div className="event-cards">
                  {rows.map((event) => {
                    const deleteButton = operationEventRowDeleteButtonView({ eventId: event.id, deletingEventId });
                    const cardView = operationEventTimelineCardView(event, scope.asin, recentSavedEventId);
                    return (
                      <article
                        aria-label={cardView.ariaLabel}
                        className={cardView.className}
                        key={event.id}
                        tabIndex={0}
                      >
                        <div className="event-card-title">
                          <strong>{event.title}</strong>
                          <StatusPill tone="pending">{formatEventType(event.eventType)}</StatusPill>
                          <StatusPill tone={cardView.scopeLabel === '全局' ? 'pending' : 'ready'}>
                            {cardView.scopeLabel}
                          </StatusPill>
                        </div>
                        <p>{formatImpact(event.impactExpectation)} / {formatEventScope(event)}</p>
                        <div className="event-card-context">
                          <StatusPill tone="ready">{cardView.contextLabel}</StatusPill>
                          <span>{cardView.contextDetail}</span>
                        </div>
                        {event.notes && <p className="muted-line">{event.notes}</p>}
                        {event.evidencePath && <p className="mono-line">{event.evidencePath}</p>}
                        <div className="action-row">
                          <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'}
                            aria-busy={deleteButton.ariaBusy}
                            className={deleteButton.className}
                            disabled={(deleteButton.disabled) || groupBusy}
                            onClick={() => {
                              void archiveEvent(event.id);
                            }}
                            type="button"
                          >
                            {deleteButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                            <span>{deleteButton.label}</span>
                          </WorkspaceActionButton>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <ProgressiveDetails title="新增/维护事件、AI 使用说明和覆盖统计">
        <div className="kpi-row operation-events-prototype-status-grid" aria-label="运营事件状态">
          <KpiCard
            label="当前视图"
            value={visibleEvents.length}
            detail={viewMode === 'product' && scope.asin ? `产品 ${scope.asin}` : viewMode === 'global' ? '全局事件' : '全部事件'}
            tone={visibleEvents.length ? 'ready' : 'pending'}
          />
          <KpiCard
            label="绑定对象"
            value={specificEventCount}
            detail="产品/活动/广告组"
            tone={specificEventCount ? 'ready' : 'pending'}
          />
          <KpiCard
            label="全局事件"
            value={Math.max(0, visibleEvents.length - specificEventCount)}
            detail="用于解释整体波动"
            tone={visibleEvents.length - specificEventCount > 0 ? 'ready' : 'pending'}
          />
          <KpiCard label="执行边界" value="不执行广告" detail="只补 AI 上下文" tone="warning" />
        </div>

        <Panel title="当前范围与作用" tone="success">
          <div className="business-split">
            <div>
              <div className="business-scope-line">
                {scope.dateFrom} 至 {scope.dateTo} / {scope.storeName} / {scope.marketplaceCode} / USD
              </div>
              <p className="muted-line">
                当前范围内的事件会进入广告表现、AI 阶段判断和动态阈值建议。第一版由运营手动维护，后续可接入领星/亚马逊活动、价格和库存数据。
              </p>
            </div>
            <StatusPill tone={events.length ? 'ready' : 'pending'}>
              当前事件 {events.length}
            </StatusPill>
          </div>
          <div className="action-row operation-events-prototype-actions">
            <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy} className="secondary-button" onClick={() => navigate('ad-quant')} type="button">
              {taskState.secondaryActionLabel}
            </WorkspaceActionButton>
          </div>
        </Panel>

        <div className="page-grid operation-context-grid">
          <Panel title="AI 与规则如何使用这些事件">
            <div className="operation-impact-grid">
              <div>
                <span>广告表现</span>
                <strong>解释阈值变化</strong>
                <p>规则仍先按 ACOS、点击、花费和订单算风险；事件用于解释为什么今天的阈值可能要更保守或更宽松。</p>
              </div>
              <div>
                <span>DeepSeek / AI</span>
                <strong>判断产品推广阶段</strong>
                <p>AI 会把每日广告事实、活动事件、价格和 Listing 变化一起看，区分冷启动、测词、放量、稳定和异常修复。</p>
              </div>
              <div>
                <span>执行边界</span>
                <strong>只影响建议，不自动执行</strong>
                <p>事件不会直接改广告。所有降价、否词、暂停或放量仍必须走建议、审批、执行和回读。</p>
              </div>
            </div>
          </Panel>

          <Panel title="当前事件覆盖">
            <div className="operation-summary-grid">
              <div>
                <span>总事件</span>
                <strong>{visibleEvents.length}</strong>
              </div>
              <div>
                <span>绑定对象</span>
                <strong>{specificEventCount}</strong>
              </div>
              <div>
                <span>全范围事件</span>
                <strong>{Math.max(0, visibleEvents.length - specificEventCount)}</strong>
              </div>
            </div>
            <div className="business-pill-row">
              <WorkspaceActionButton disabledReason={!scope.asin ? '当前尚未锁定产品，请到产品管理选择产品并锁定 ASIN。' : '当前事件操作尚未结束，请等待完成后切换。'}
                className={`secondary-button compact-button ${viewMode === 'product' ? 'button-active' : ''}`}
                disabled={(!scope.asin) || groupBusy}
                onClick={() => {
                  setViewMode('product');
                  setDraft(buildOperationEventDraftForScope(scope, 'product'));
                }}
                type="button"
              >
                当前产品
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy}
                className={`secondary-button compact-button ${viewMode === 'global' ? 'button-active' : ''}`}
                onClick={() => {
                  setViewMode('global');
                  setDraft(buildOperationEventDraftForScope(scope, 'global'));
                }}
                type="button"
              >
                全局事件
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy}
                className={`secondary-button compact-button ${viewMode === 'all' ? 'button-active' : ''}`}
                onClick={() => setViewMode('all')}
                type="button"
              >
                全部事件
              </WorkspaceActionButton>
            </div>
            <div className="action-row">
              <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy} className="secondary-button" onClick={() => navigate('ad-quant')} type="button">
                查看广告表现
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy} className="primary-button" onClick={() => navigate('recommendations')} type="button">
                生成 AI+规则建议
              </WorkspaceActionButton>
            </div>
          </Panel>
        </div>

        <Panel title={OPERATION_EVENT_PAGE_COPY.newEventPanelTitle}>
          <div className="operation-event-create-entry">
            <div>
              <strong>通过弹窗记录事件</strong>
              <p>折扣、BD、调价、库存、Listing 变更和人工备注都在弹窗里填写；主页面只保留时间线和上下文说明。</p>
            </div>
            <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy} className="primary-button" onClick={openEventEditor} type="button">
              新增运营事件
            </WorkspaceActionButton>
          </div>
        </Panel>
        </ProgressiveDetails>
      </div>

      {eventEditorOpen && (
        <div
          className="product-config-modal-backdrop operation-event-modal-backdrop"
          ref={operationEventDialogFocus.overlayRootRef}
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeEventEditor();
          }}
        >
          <section
            aria-labelledby="operation-event-modal-title"
            aria-modal="true"
            className="product-config-modal operation-event-modal"
            ref={operationEventDialogFocus.surfaceRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="product-config-modal-header">
              <div>
                <span>{viewMode === 'product' && scope.asin ? `产品 ${scope.asin}` : viewMode === 'global' ? '全局事件' : '当前范围'}</span>
                <h2 id="operation-event-modal-title">{OPERATION_EVENT_PAGE_COPY.newEventPanelTitle}</h2>
              </div>
              <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} className="secondary-button compact-button" disabled={(saving) || groupBusy} onClick={closeEventEditor} type="button">关闭</WorkspaceActionButton>
            </header>

            <div className="product-config-modal-body operation-event-modal-body">
              {groupBusy && <p id="operation-event-fields-pending" role="note">当前保存或读取尚未结束，字段暂时锁定，请等待完成后继续编辑。</p>}
              <p id="operation-event-fixed-identity" role="note">店铺与站点继承当前已选择店铺，不能在事件表单跨店修改；需要切店时请使用顶部店铺入口。</p>
              <div className="quick-template-row operation-event-modal-presets" aria-label="运营事件快速模板">
                {EVENT_PRESETS.map((preset) => (
                  <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} disabled={(false) || groupBusy}
                    className="secondary-button compact-button"
                    key={preset.label}
                    onClick={() => applyPreset(preset)}
                    type="button"
                  >
                    {preset.label}
                  </WorkspaceActionButton>
                ))}
              </div>
              <div className={operationEventFormClassName(Boolean(recentDraftClearTick))}>
                <FormTable>
                  <FormTableRow label="事件日期" required hint="事件会按发生日期进入广告表现和 AI 阶段判断。">
                    <input disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      type="date"
                      value={draft.eventDate}
                      onChange={(event) => setDraft({ ...draft, eventDate: event.target.value })}
                    />
                  </FormTableRow>
                  <FormTableRow label="店铺" required hint="按当前店铺锁定，切店请使用顶部店铺入口。">
                    <input readOnly aria-describedby="operation-event-fixed-identity"
                      value={draft.storeName}
                      onChange={(event) => setDraft({ ...draft, storeName: event.target.value })}
                    />
                  </FormTableRow>
                  <FormTableRow label="站点" required hint="当前计价防线固定按站点和 USD 解释。">
                    <input readOnly aria-describedby="operation-event-fixed-identity"
                      value={draft.marketplaceCode}
                      onChange={(event) => setDraft({ ...draft, marketplaceCode: event.target.value })}
                    />
                  </FormTableRow>
                  <FormTableRow label="ASIN" hint="可选；留空表示全店/全范围事件。">
                    <input disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      placeholder="可选；留空表示全店/全范围"
                      value={draft.asin}
                      onChange={(event) => setDraft({ ...draft, asin: event.target.value })}
                    />
                  </FormTableRow>
                  <FormTableRow label="广告活动" hint="可选；用于绑定具体 campaign，减少 AI 跨对象误判。">
                    <input disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      placeholder="可选；用于绑定具体 campaign"
                      value={draft.campaignName}
                      onChange={(event) => setDraft({ ...draft, campaignName: event.target.value })}
                    />
                  </FormTableRow>
                  <FormTableRow label="广告组" hint="可选；用于绑定具体广告组或测词单元。">
                    <input disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      placeholder="可选；用于绑定具体广告组"
                      value={draft.adGroupName}
                      onChange={(event) => setDraft({ ...draft, adGroupName: event.target.value })}
                    />
                  </FormTableRow>
                  <FormTableRow label="事件类型" required hint={selectedTypeHint}>
                    <select disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      value={draft.eventType}
                      onChange={(event) => setDraft({ ...draft, eventType: event.target.value })}
                    >
                      {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </FormTableRow>
                  <FormTableRow label="预期影响" required hint="用于提示 AI 对转化、流量和 ACOS 的解释方向。">
                    <select disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      value={draft.impactExpectation}
                      onChange={(event) => setDraft({ ...draft, impactExpectation: event.target.value })}
                    >
                      {Object.entries(IMPACT_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </FormTableRow>
                  <FormTableRow label="事件标题" required hint="写运营能一眼识别的事件名称。">
                    <input disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      placeholder="例如：10% Coupon 开始、大促报名、主图更新"
                      value={draft.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    />
                  </FormTableRow>
                  <FormTableRow label="证据路径" hint="可选：截图、活动页面或本地证明文件路径。">
                    <input disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      placeholder="可选：截图、活动页面或本地证明文件路径"
                      value={draft.evidencePath}
                      onChange={(event) => setDraft({ ...draft, evidencePath: event.target.value })}
                    />
                  </FormTableRow>
                  <FormTableRow label="备注" hint="说明活动力度、价格、库存、Listing 调整点或需要 AI 注意的背景。">
                    <textarea disabled={groupBusy} aria-describedby={groupBusy ? 'operation-event-fields-pending' : undefined}
                      placeholder="说明活动力度、价格、库存、Listing 调整点或需要 AI 注意的背景"
                      value={draft.notes}
                      onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                    />
                  </FormTableRow>
                </FormTable>
              </div>
              <div className="operation-hint">
                <strong>{formatEventType(draft.eventType)}</strong>
                <p>{selectedTypeHint}</p>
              </div>
              {message && <p className={saving || deletingEventId !== null ? 'muted-line' : 'ready-line'} role="status" aria-live="polite">{message}</p>}
              {error && <p className="blocked-line">{error}</p>}
            </div>

            <footer className="product-config-modal-footer">
              <WorkspaceActionButton disabledReason={groupBusy ? '当前事件操作尚未结束，请等待返回后重试。' : '请补齐事件日期、店铺、站点和事件标题后保存。'}
                aria-busy={inlineSaveButton.ariaBusy}
                className={inlineSaveButton.className}
                disabled={(inlineSaveButton.disabled) || groupBusy}
                onClick={saveEvent}
                type="button"
              >
                {inlineSaveButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                <span>{inlineSaveButton.label}</span>
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'}
                aria-busy={refreshButton.ariaBusy}
                className={refreshButton.className}
                disabled={(refreshButton.disabled) || groupBusy}
                onClick={() => {
                  void refreshEvents();
                }}
                type="button"
              >
                {refreshButton.showSpinner && <span aria-hidden="true" className="button-spinner" />}
                <span>{refreshButton.label}</span>
              </WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={'当前事件读取、保存或归档尚未结束，请等待返回后继续。'} className="secondary-button" disabled={(saving) || groupBusy} onClick={closeEventEditor} type="button">关闭</WorkspaceActionButton>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
