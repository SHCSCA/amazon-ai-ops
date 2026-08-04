import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  type CreateStoreInput,
  type StoreContextEnvelope,
  type StoreDailyStatusProjection,
  type StoreRecord,
  type StoreScopeRef,
} from '@amazon-ai-ops/shared-types';
import { useOverlayFocusScope } from './workspace/overlay-focus-scope';

export type StoreScopeSwitcherProps = {
  stores: readonly StoreRecord[];
  activeStore?: StoreRecord | null;
  authoritativeContext?: StoreContextEnvelope | null;
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
  unknown: 'UNKNOWN',
};

const IMPORT_LABELS: Record<StoreDailyStatusProjection['import']['state'], string> = {
  not_started: '待开始',
  pending: '待导入',
  succeeded: '已导入',
  failed: '失败',
  not_applicable: '不适用',
  unknown: 'UNKNOWN',
};

const FRESHNESS_LABELS: Record<StoreDailyStatusProjection['metrics']['freshness'], string> = {
  fresh: '新鲜',
  stale: '过期',
  missing: '缺失',
  unknown: 'UNKNOWN',
};

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
  if (status.blockers[0]?.detail) return status.blockers[0].detail;
  if (status.overall === 'unknown') return 'Main 无法确认今日权威状态';
  return OVERALL_LABELS[status.overall];
}

export function StoreScopeSwitcher({
  stores,
  activeStore,
  authoritativeContext,
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
  const [creating, setCreating] = useState(false);
  const [pendingStoreId, setPendingStoreId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const previousInitiallyExpanded = useRef(initiallyExpanded);
  const listedStores = useMemo(
    () => [...stores].sort((left, right) => {
      const statusOrder = { active: 0, inactive: 1, archived: 2 } as const;
      return statusOrder[left.status] - statusOrder[right.status]
        || left.displayName.localeCompare(right.displayName, 'zh-CN');
    }),
    [stores],
  );
  const switching = phase === 'switching' || pendingStoreId !== null;
  const listBusy = phase === 'loading' || dailyStatusPhase === 'loading';
  const currentStatus = activeStore ? statusForStore(dailyStatuses, activeStore) : undefined;

  useEffect(() => {
    if (initiallyExpanded && !previousInitiallyExpanded.current) setExpanded(true);
    previousInitiallyExpanded.current = initiallyExpanded;
  }, [initiallyExpanded]);

  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
    setDisplayName('');
    setCreateError(null);
    setCreatedStore(null);
  };
  const createDialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: creating,
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
    if (switching || store.status !== 'active') return false;
    if (
      authoritativeContext?.storeId === store.storeId
      && authoritativeContext.marketplace === store.marketplace
    ) {
      setExpanded(false);
      return true;
    }
    setPendingStoreId(String(store.storeId));
    setSwitchError(null);
    try {
      await onSwitch({ storeId: store.storeId, marketplace: store.marketplace });
      setExpanded(false);
      return true;
    } catch (caught) {
      setSwitchError(caught instanceof Error ? caught.message : '店铺切换失败，请检查后重试。');
      return false;
    } finally {
      setPendingStoreId(null);
    }
  }

  async function submitCreate() {
    if (creating) return;
    const validationError = validateStoreScopeCreateName(displayName);
    setCreateError(validationError);
    if (validationError) return;
    setCreating(true);
    try {
      const created = await onCreate(buildFixedUsStoreInput(displayName));
      setCreatedStore(created);
      setCreateError(null);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : '店铺创建失败，请检查后重试。');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section
      aria-label="店铺与站点"
      className={`store-scope-switcher${collapsed ? ' store-scope-switcher--collapsed' : ''}`}
      data-collapsed={collapsed ? 'true' : 'false'}
      ref={popoverFocus.overlayRootRef}
    >
      <button
        aria-expanded={expanded}
        aria-haspopup="listbox"
        aria-label={collapsed
          ? `店铺与站点：${activeStore?.displayName || '未选择'}，Amazon 美国站，美元`
          : undefined}
        className="store-scope-switcher__trigger"
        disabled={switching}
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
      </button>

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
              <span>作用域由 Main 精确确认</span>
            </div>
            <button aria-label="关闭店铺列表" onClick={() => setExpanded(false)} type="button">
              <X aria-hidden="true" size={15} />
            </button>
          </header>

          {(phase === 'error' || dailyStatusPhase === 'error') && (
            <div className="store-scope-switcher__state" data-state="error" role="alert">
              <Warning aria-hidden="true" size={17} weight="fill" />
              <span>{error || dailyStatusError || '店铺状态读取失败。'}</span>
              <button onClick={() => void onRetry()} type="button">重试</button>
            </div>
          )}
          {switchError && (
            <div className="store-scope-switcher__state" data-state="error" role="alert">
              <Warning aria-hidden="true" size={17} weight="fill" />
              <span>{switchError}</span>
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
                  <button
                    aria-busy={rowPending || undefined}
                    aria-selected={selected}
                    className="store-scope-switcher__option"
                    data-overall={status?.overall || 'unknown'}
                    data-overlay-initial-focus={selected ? '' : undefined}
                    data-store-scope-id={String(store.storeId)}
                    disabled={switching || store.status !== 'active'}
                    key={`${store.storeId}:${store.marketplace}`}
                    onClick={() => void requestSwitch(store)}
                    role="option"
                    type="button"
                  >
                    <span className="store-scope-switcher__option-heading">
                      <strong>{store.displayName}</strong>
                      <span>{selected ? '当前' : rowPending ? '切换中…' : '切换并登录'}</span>
                    </span>
                    <span className="store-scope-switcher__option-market">Amazon US · USD</span>
                    <span className="store-scope-switcher__health">
                      <span>下载 {downloaded ?? '?'} / {status?.collection.requiredReportCount ?? 8}</span>
                      <span>导入 {status ? IMPORT_LABELS[status.import.state] : 'UNKNOWN'}</span>
                      <span>指标 {status ? FRESHNESS_LABELS[status.metrics.freshness] : 'UNKNOWN'}</span>
                    </span>
                    <small title={statusDetail(status)}>{statusDetail(status)}</small>
                  </button>
                );
              })}
            </div>
          )}

          <footer>
            <button
              disabled={switching}
              onClick={() => {
                setExpanded(false);
                setCreateOpen(true);
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />新增店铺
            </button>
            {onManage && (
              <button
                disabled={switching}
                onClick={() => {
                  setExpanded(false);
                  onManage();
                }}
                type="button"
              >
                <Wrench aria-hidden="true" size={15} />管理店铺
              </button>
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
                <span>STORE AUTHORITY</span>
                <h2 id="store-scope-create-title">新增美国站店铺</h2>
                <p id="store-scope-create-description">创建只新增数据域，不会暗中切换当前店铺。</p>
              </div>
              <button aria-label="关闭新增店铺" disabled={creating} onClick={closeCreate} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </header>

            {createdStore ? (
              <div className="store-scope-create-success" role="status" aria-live="polite">
                <CheckCircle aria-hidden="true" size={24} weight="fill" />
                <div>
                  <strong>{createdStore.displayName} 已创建</strong>
                  <p>当前店铺没有改变。需要进入新店时，请显式切换并重新登录。</p>
                  {switchError && <p className="store-scope-create-switch-error" role="alert">{switchError}</p>}
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
                    maxLength={120}
                    onChange={(event) => {
                      setDisplayName(event.currentTarget.value);
                      if (createError) setCreateError(null);
                    }}
                    placeholder="例如 Northstar Home"
                    value={displayName}
                  />
                </label>
                <div className="store-scope-create-fixed" aria-label="固定美国站配置">
                  <span><small>Amazon 站点</small><strong>US</strong></span>
                  <span><small>币种</small><strong>USD</strong></span>
                  <span><small>业务时区</small><strong>America/Los_Angeles</strong></span>
                </div>
                <p className="store-scope-create-limit">首版仅开放美国站；站点、币种与业务时区不可编辑。</p>
                <div className="store-scope-create-feedback" aria-live="polite">
                  {createError && <span role="alert">{createError}</span>}
                </div>
              </form>
            )}

            <footer>
              <button disabled={creating} onClick={closeCreate} type="button">
                {createdStore ? '稍后切换' : '取消'}
              </button>
              {createdStore ? (
                <button
                  className="workspace-button workspace-button--primary"
                  data-store-scope-id={String(createdStore.storeId)}
                  disabled={switching}
                  onClick={() => void requestSwitch(createdStore).then((switched) => {
                    if (switched) closeCreate();
                  })}
                  type="button"
                >
                  切换并登录
                </button>
              ) : (
                <button
                  aria-busy={creating || undefined}
                  className="workspace-button workspace-button--primary"
                  disabled={creating}
                  onClick={() => void submitCreate()}
                  type="button"
                >
                  {creating ? '创建中…' : '创建店铺'}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
