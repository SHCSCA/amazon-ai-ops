import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CaretDown,
  CheckCircle,
  Plus,
  Storefront,
  Warning,
  Wrench,
  X,
} from '@phosphor-icons/react';
import {
  DEFAULT_US_BUSINESS_TIMEZONE,
  USD_CURRENCY,
  US_MARKETPLACE,
  missionControlContextKey,
  sanitizeCausalExportText,
  type CreateStoreInput,
  type StoreContextEnvelope,
  type StoreDailyStatusProjection,
  type StoreRecord,
  type StoreScopeRef,
} from '@amazon-ai-ops/shared-types';
import { useOverlayFocusScope } from './workspace/overlay-focus-scope';
import { WorkspaceActionButton } from './workspace/action-feedback';
import { useWorkspaceOperation, type WorkspaceOperationTicket } from './workspace/use-workspace-operation';
import { rendererRuntimeLog } from '../runtime-log';
import { toUserFacingError } from '../user-facing-error';

export type StoreScopeSwitcherProps = {
  stores: readonly StoreRecord[];
  activeStore?: StoreRecord | null;
  authoritativeContext?: StoreContextEnvelope | null;
  contextEpoch?: number;
  dailyStatuses?: readonly StoreDailyStatusProjection[];
  phase: 'loading' | 'needs-selection' | 'switching' | 'ready' | 'error';
  dailyStatusPhase?: 'idle' | 'loading' | 'ready' | 'error';
  error?: string | null;
  dailyStatusError?: string | null;
  collapsed?: boolean;
  initiallyExpanded?: boolean;
  onRetry: () => Promise<unknown> | unknown;
  onSwitch: (scope: StoreScopeRef) => Promise<unknown> | unknown;
  onCreate: (input: CreateStoreInput) => Promise<StoreRecord> | StoreRecord;
  onManage?: () => void;
};

const OVERALL_LABELS: Record<StoreDailyStatusProjection['overall'], string> = {
  ready: '今日就绪',
  in_progress: '采集中',
  not_started: '待采集',
  attention_required: '需处理',
  blocked: '已阻塞',
  inactive: '已停用',
  archived: '已归档',
  unknown: '待确认',
};

const IMPORT_LABELS: Record<StoreDailyStatusProjection['import']['state'], string> = {
  not_started: '待开始',
  pending: '待导入',
  succeeded: '已导入',
  failed: '失败',
  not_applicable: '不适用',
  unknown: '待确认',
};

const FRESHNESS_LABELS: Record<StoreDailyStatusProjection['metrics']['freshness'], string> = {
  fresh: '新鲜',
  stale: '过期',
  missing: '缺失',
  unknown: '待确认',
};

const INTERNAL_OPERATOR_TERM = /(?:\b(?:Main|StoreContext|Authority|Renderer|Profile|CRUD|PRODUCTION_NATIVE|LEGACY_ADAPTER|PROTOTYPE_ONLY|UNKNOWN|IPC|electronAPI)\b|Package UI|Error invoking remote method|RuntimeError|remote method)/i;

function operatorStoreMessage(value: string | null | undefined, fallback: string): string {
  const firstLine = value?.trim().split(/\r?\n/)[0];
  if (!firstLine || INTERNAL_OPERATOR_TERM.test(firstLine)) return fallback;
  return sanitizeCausalExportText(firstLine).slice(0, 240);
}

function StoreDiagnosticDetails({ raw, visible }: { raw?: string | null; visible: string }) {
  if (!raw || raw === visible) return null;
  return (
    <details>
      <summary>诊断详情</summary>
      <code>{sanitizeCausalExportText(raw)}</code>
    </details>
  );
}

export function validateStoreScopeCreateName(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return '请输入店铺名称。';
  if (normalized.length > 120) return '店铺名称不能超过 120 个字符。';
  return null;
}

export function buildFixedUsStoreInput(displayName: string): CreateStoreInput {
  return {
    displayName: displayName.trim(),
    marketplace: US_MARKETPLACE,
    currency: USD_CURRENCY,
    businessTimezone: DEFAULT_US_BUSINESS_TIMEZONE,
  };
}

function statusForStore(
  statuses: readonly StoreDailyStatusProjection[],
  store: StoreRecord,
): StoreDailyStatusProjection | undefined {
  return statuses.find((status) => (
    status.key.storeId === store.storeId && status.key.marketplace === store.marketplace
  ));
}

function statusDetail(status?: StoreDailyStatusProjection): string {
  if (!status) return '今日状态尚未读取';
  const blockerDetail = status.blockers[0]?.detail;
  if (blockerDetail && !INTERNAL_OPERATOR_TERM.test(blockerDetail)) return blockerDetail;
  if (blockerDetail || status.overall === 'unknown') return '今日状态尚未确认，请刷新后重试。';
  return OVERALL_LABELS[status.overall];
}

export function StoreScopeSwitcher({
  stores,
  activeStore,
  authoritativeContext,
  contextEpoch = 0,
  dailyStatuses = [],
  phase,
  dailyStatusPhase = 'idle',
  error,
  dailyStatusError,
  collapsed = false,
  initiallyExpanded = false,
  onRetry,
  onSwitch,
  onCreate,
  onManage,
}: StoreScopeSwitcherProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [createOpen, setCreateOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdStore, setCreatedStore] = useState<StoreRecord | null>(null);
  const [action, setAction] = useState<'create' | 'switch' | 'retry' | null>(null);
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const previousInitiallyExpanded = useRef(initiallyExpanded);
  const feedbackId = useId();
  const operationKey = JSON.stringify([
    authoritativeContext ? missionControlContextKey(authoritativeContext) : null,
    contextEpoch, activeStore?.storeId, activeStore?.marketplace, activeStore?.browserProfileId, activeStore?.status,
  ]);
  const operation = useWorkspaceOperation(operationKey);
  const activeTicket = useRef<WorkspaceOperationTicket | null>(null);
  const listedStores = useMemo(
    () => [...stores].sort((left, right) => {
      const statusOrder = { active: 0, inactive: 1, archived: 2 } as const;
      return statusOrder[left.status] - statusOrder[right.status]
        || left.displayName.localeCompare(right.displayName, 'zh-CN');
    }),
    [stores],
  );
  const creating = operation.busy && action === 'create';
  const retrying = operation.busy && action === 'retry';
  const switching = phase === 'switching' || (operation.busy && action === 'switch');
  const actionBusy = operation.busy || switching;
  const busyReason = creating ? '正在创建店铺，请等待完成后再操作。'
    : retrying ? '正在重新读取店铺状态，请等待完成后再操作。' : '正在切换店铺，请等待核验完成后再操作。';
  const listBusy = phase === 'loading' || dailyStatusPhase === 'loading';
  const currentStatus = activeStore ? statusForStore(dailyStatuses, activeStore) : undefined;
  const rawScopeError = error || dailyStatusError || null;
  const visibleScopeError = operatorStoreMessage(
    rawScopeError,
    '店铺状态读取失败，请点击“重试”再次确认。',
  );

  useEffect(() => {
    if (initiallyExpanded && !previousInitiallyExpanded.current) setExpanded(true);
    previousInitiallyExpanded.current = initiallyExpanded;
  }, [initiallyExpanded]);

  useEffect(() => {
    setAction(null); setPendingStoreId(null); setCreateError(null); setSwitchError(null);
    setCreatedStore(null); setCreateOpen(false); setDisplayName('');
    // 新权威到达时只重置本地交互，不把旧请求的结果当作新店铺回执。
    if (activeTicket.current) setExpanded(false);
    activeTicket.current = null;
  }, [operationKey]);

  const closeCreate = () => {
    if (activeTicket.current?.isCurrent() || phase === 'switching') return;
    setCreateOpen(false);
    setDisplayName('');
    setCreateError(null);
    setCreatedStore(null);
  };
  const createDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: actionBusy,
    onDismiss: closeCreate,
    open: createOpen,
  });
  const popoverFocus = useOverlayFocusScope<HTMLElement, HTMLDivElement>({
    autoFocus: true,
    dismissOnEscape: true,
    inertBackground: false,
    modal: false,
    onDismiss: () => setExpanded(false),
    open: expanded,
    restoreFocus: true,
    trapFocus: false,
  });

  useEffect(() => {
    if (!expanded || typeof document === 'undefined') return undefined;
    const closeOnOutsidePointer = (event: MouseEvent) => {
      const root = popoverFocus.overlayRootRef.current;
      if (!root || root.contains(event.target as Node) || switching) return;
      setExpanded(false);
    };
    document.addEventListener('mousedown', closeOnOutsidePointer);
    return () => document.removeEventListener('mousedown', closeOnOutsidePointer);
  }, [expanded, popoverFocus.overlayRootRef, switching]);

  async function requestSwitch(store: StoreRecord): Promise<boolean> {
    if (actionBusy || store.status !== 'active') return false;
    if (
      authoritativeContext?.storeId === store.storeId
      && authoritativeContext.marketplace === store.marketplace
    ) {
      setExpanded(false);
      return true;
    }
    const ticket = operation.begin();
    if (!ticket) return false;
    activeTicket.current = ticket; setAction('switch');
    setPendingStoreId(String(store.storeId));
    setSwitchError(null);
    try {
      await onSwitch({ storeId: store.storeId, marketplace: store.marketplace });
      if (!ticket.isCurrent()) return false;
      setExpanded(false);
      if (createdStore?.storeId === store.storeId) {
        setCreateOpen(false); setCreatedStore(null); setDisplayName('');
      }
      return true;
    } catch (caught) {
      rendererRuntimeLog.error('store_scope.switch_failed', { error: caught });
      if (ticket.isCurrent()) setSwitchError(toUserFacingError(caught, '店铺切换失败，请检查后重试。'));
      return false;
    } finally {
      if (ticket.isCurrent()) { setPendingStoreId(null); setAction(null); activeTicket.current = null; }
      ticket.finish();
    }
  }

  async function submitCreate() {
    if (actionBusy) return;
    const validationError = validateStoreScopeCreateName(displayName);
    setCreateError(validationError);
    if (validationError) return;
    const ticket = operation.begin();
    if (!ticket) return;
    activeTicket.current = ticket; setAction('create');
    try {
      const created = await onCreate(buildFixedUsStoreInput(displayName));
      if (!ticket.isCurrent()) return;
      setCreatedStore(created);
      setCreateError(null);
    } catch (caught) {
      rendererRuntimeLog.error('store_scope.create_failed', { error: caught });
      if (ticket.isCurrent()) setCreateError(toUserFacingError(caught, '店铺创建失败，请检查后重试。'));
    } finally {
      if (ticket.isCurrent()) { setAction(null); activeTicket.current = null; }
      ticket.finish();
    }
  }

  async function retry() {
    if (actionBusy) return;
    const ticket = operation.begin(); if (!ticket) return;
    activeTicket.current = ticket; setAction('retry'); setSwitchError(null);
    try { await onRetry(); }
    catch (caught) {
      rendererRuntimeLog.error('store_scope.retry_failed', { error: caught });
      if (ticket.isCurrent()) setSwitchError(toUserFacingError(caught, '店铺状态读取失败，请重试。'));
    } finally {
      if (ticket.isCurrent()) { setAction(null); activeTicket.current = null; }
      ticket.finish();
    }
  }

  return (
    <section
      aria-label="店铺与站点"
      className={`store-scope-switcher${collapsed ? ' store-scope-switcher--collapsed' : ''}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      ref={popoverFocus.overlayRootRef}
    >
      <WorkspaceActionButton
        aria-expanded={expanded}
        aria-haspopup="listbox"
        aria-label={collapsed
          ? `店铺与站点：${activeStore?.displayName || '未选择'}，Amazon 美国站，美元`
          : undefined}
        className="store-scope-switcher__trigger"
        disabled={actionBusy}
        disabledReason={busyReason}
        onClick={() => {
          setSwitchError(null);
          setExpanded((current) => !current);
        }}
        title={collapsed ? `${activeStore?.displayName || '未选择店铺'} · Amazon US · USD` : undefined}
        type="button"
      >
        <span className="store-scope-switcher__icon" aria-hidden="true">
          <Storefront size={18} weight="duotone" />
        </span>
        <span className="store-scope-switcher__current">
          <small>店铺与站点</small>
          <strong>{activeStore?.displayName || '选择店铺'}</strong>
          <span>Amazon US · USD</span>
        </span>
        <CaretDown aria-hidden="true" className="store-scope-switcher__caret" size={14} />
      </WorkspaceActionButton>

      {!collapsed && (
        <div className="store-scope-switcher__summary" aria-live="polite">
          <span data-overall={currentStatus?.overall || 'unknown'}>
            {currentStatus ? OVERALL_LABELS[currentStatus.overall] : '状态待读取'}
          </span>
          <small>首版仅开放美国站</small>
        </div>
      )}

      {expanded && (
        <div
          aria-busy={listBusy || switching || undefined}
          aria-label="店铺与站点选择器"
          className="store-scope-switcher__popover"
          ref={popoverFocus.surfaceRef}
          role="dialog"
          tabIndex={-1}
        >
          <header>
            <div>
              <strong>店铺与站点</strong>
              <span>当前店铺由系统核验</span>
            </div>
            <WorkspaceActionButton aria-label="关闭店铺列表" disabled={actionBusy} disabledReason={busyReason} onClick={() => setExpanded(false)} type="button">
              <X aria-hidden="true" size={15} />
            </WorkspaceActionButton>
          </header>

          {(phase === 'error' || dailyStatusPhase === 'error') && (
            <div className="store-scope-switcher__state" data-state="error" role="alert">
              <Warning aria-hidden="true" size={17} weight="fill" />
              <span>{visibleScopeError}</span>
              <WorkspaceActionButton busy={retrying} busyLabel="读取中…" disabled={actionBusy} disabledReason={busyReason} onClick={() => void retry()}>重试</WorkspaceActionButton>
              <StoreDiagnosticDetails raw={rawScopeError} visible={visibleScopeError} />
            </div>
          )}
          {switchError && (
            <div className="store-scope-switcher__state" data-state="error" role="alert">
              <Warning aria-hidden="true" size={17} weight="fill" />
              <span>{operatorStoreMessage(switchError, '店铺切换失败，请重试；仍失败时查看诊断详情。')}</span>
              <StoreDiagnosticDetails
                raw={switchError}
                visible={operatorStoreMessage(switchError, '店铺切换失败，请重试；仍失败时查看诊断详情。')}
              />
            </div>
          )}
          {listBusy && (
            <div className="store-scope-switcher__state" data-state="loading" role="status">
              <span className="button-spinner" aria-hidden="true" />
              正在读取今日状态…
            </div>
          )}
          {!listBusy && phase !== 'error' && listedStores.length === 0 && (
            <div className="store-scope-switcher__state" data-state="empty" role="status">
              尚无可用店铺。请先新增美国站店铺。
            </div>
          )}

          {listedStores.length > 0 && (
            <div aria-label="店铺与站点列表" className="store-scope-switcher__list" role="listbox">
              {listedStores.map((store) => {
                const status = statusForStore(dailyStatuses, store);
                const selected = authoritativeContext?.storeId === store.storeId
                  && authoritativeContext.marketplace === store.marketplace;
                const rowPending = pendingStoreId === String(store.storeId);
                const downloaded = status?.collection.downloadedReportCount;
                return (
                  <WorkspaceActionButton
                    aria-busy={rowPending || undefined}
                    aria-selected={selected}
                    className="store-scope-switcher__option"
                    data-overall={status?.overall || 'unknown'}
                    data-overlay-initial-focus={selected ? '' : undefined}
                    data-store-scope-id={String(store.storeId)}
                    disabled={actionBusy || store.status !== 'active'}
                    disabledReason={store.status !== 'active'
                      ? `此店铺已${store.status === 'inactive' ? '停用' : '归档'}，请到“管理店铺”恢复后再切换。` : busyReason}
                    busy={rowPending && operation.busy}
                    busyLabel={`${store.displayName} 切换中…`}
                    key={`${store.storeId}:${store.marketplace}`}
                    onClick={() => void requestSwitch(store)}
                    role="option"
                    type="button"
                  >
                    <span className="store-scope-switcher__option-heading">
                      <strong>{store.displayName}</strong>
                      <span>{selected ? '当前' : rowPending ? '切换中…' : '切换店铺'}</span>
                    </span>
                    <span className="store-scope-switcher__option-market">Amazon US · USD</span>
                    <span className="store-scope-switcher__health">
                      <span>下载 {downloaded ?? '?'} / {status?.collection.requiredReportCount ?? 8}</span>
                      <span>导入 {status ? IMPORT_LABELS[status.import.state] : '尚未读取'}</span>
                      <span>指标 {status ? FRESHNESS_LABELS[status.metrics.freshness] : '尚未读取'}</span>
                    </span>
                    <small title={statusDetail(status)}>{statusDetail(status)}</small>
                  </WorkspaceActionButton>
                );
              })}
            </div>
          )}

          <footer>
            <WorkspaceActionButton
              disabled={actionBusy}
              disabledReason={busyReason}
              onClick={() => {
                setExpanded(false);
                setCreateOpen(true);
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />新增店铺
            </WorkspaceActionButton>
            {onManage && (
              <WorkspaceActionButton
                disabled={actionBusy}
                disabledReason={busyReason}
                onClick={() => {
                  setExpanded(false);
                  onManage();
                }}
                type="button"
              >
                <Wrench aria-hidden="true" size={15} />管理店铺
              </WorkspaceActionButton>
            )}
          </footer>
        </div>
      )}

      {createOpen && (
        <div
          className="mission-control-dialog-backdrop store-scope-create-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCreate();
          }}
          ref={createDialogFocus.overlayRootRef}
          role="presentation"
        >
          <section
            aria-describedby="store-scope-create-description"
            aria-labelledby="store-scope-create-title"
            aria-modal="true"
            className="mission-control-dialog store-scope-create-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            ref={createDialogFocus.surfaceRef}
            role="dialog"
            tabIndex={-1}
          >
            <header>
              <div>
                <span>店铺配置</span>
                <h2 id="store-scope-create-title">新增美国站店铺</h2>
                <p id="store-scope-create-description">创建只新增数据域，不会暗中切换当前店铺。</p>
              </div>
              <WorkspaceActionButton aria-label="关闭新增店铺" disabled={actionBusy} disabledReason={busyReason} onClick={closeCreate} type="button">
                <X aria-hidden="true" size={18} />
              </WorkspaceActionButton>
            </header>

            {createdStore ? (
              <div className="store-scope-create-success" role="status" aria-live="polite">
                <CheckCircle aria-hidden="true" size={24} weight="fill" />
                <div>
                  <strong>{createdStore.displayName} 已创建</strong>
                  <p>当前店铺没有改变。需要进入新店时，请显式切换；外部连接在店铺工作台内单独启动。</p>
                  {switchError && (
                    <div className="store-scope-create-switch-error" role="alert">
                      <p>{operatorStoreMessage(switchError, '店铺切换失败，请重试；仍失败时查看诊断详情。')}</p>
                      <StoreDiagnosticDetails
                        raw={switchError}
                        visible={operatorStoreMessage(switchError, '店铺切换失败，请重试；仍失败时查看诊断详情。')}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <form
                className="store-scope-create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitCreate();
                }}
              >
                <label>
                  <span>店铺名称</span>
                  <input
                    autoComplete="off"
                    data-overlay-initial-focus
                    disabled={creating}
                    aria-describedby={creating ? `${feedbackId}-creating` : undefined}
                    maxLength={120}
                    onChange={(event) => {
                      setDisplayName(event.currentTarget.value);
                      if (createError) setCreateError(null);
                    }}
                    placeholder="例如 Northstar Home"
                    value={displayName}
                  />
                </label>
                {creating && <p className="muted-line" id={`${feedbackId}-creating`}>正在创建店铺，名称暂时锁定；完成或失败后可继续编辑并重试。</p>}
                <div className="store-scope-create-fixed" aria-label="固定美国站配置">
                  <span><small>Amazon 站点</small><strong>US</strong></span>
                  <span><small>币种</small><strong>USD</strong></span>
                  <span><small>业务时区</small><strong>America/Los_Angeles</strong></span>
                </div>
                <p className="store-scope-create-limit">首版仅开放美国站；站点、币种与业务时区不可编辑。</p>
                <div className="store-scope-create-feedback" aria-live="polite">
                  {createError && (
                    <div role="alert">
                      <span>{operatorStoreMessage(createError, '店铺创建失败，请检查名称后重试。')}</span>
                      <StoreDiagnosticDetails
                        raw={createError}
                        visible={operatorStoreMessage(createError, '店铺创建失败，请检查名称后重试。')}
                      />
                    </div>
                  )}
                </div>
              </form>
            )}

            <footer>
              <WorkspaceActionButton disabled={actionBusy} disabledReason={busyReason} onClick={closeCreate} type="button">
                {createdStore ? '稍后切换' : '取消'}
              </WorkspaceActionButton>
              {createdStore ? (
                <WorkspaceActionButton
                  className="workspace-button workspace-button--primary"
                  data-store-scope-id={String(createdStore.storeId)}
                  disabled={actionBusy}
                  disabledReason={busyReason}
                  busy={switching && operation.busy}
                  busyLabel="切换中…"
                  onClick={() => void requestSwitch(createdStore)}
                  type="button"
                >
                  切换到新店铺
                </WorkspaceActionButton>
              ) : (
                <WorkspaceActionButton
                  aria-busy={creating || undefined}
                  className="workspace-button workspace-button--primary"
                  disabled={actionBusy}
                  disabledReason={busyReason}
                  busy={creating}
                  busyLabel="创建中…"
                  onClick={() => void submitCreate()}
                  type="button"
                >
                  创建店铺
                </WorkspaceActionButton>
              )}
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
