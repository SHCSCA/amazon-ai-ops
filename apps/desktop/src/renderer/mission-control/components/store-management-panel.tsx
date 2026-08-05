import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowCounterClockwise,
  Check,
  PencilSimple,
  Storefront,
  X,
} from '@phosphor-icons/react';
import type {
  ArchiveStoreInput,
  CreateStoreInput,
  RestoreStoreInput,
  StoreConnection,
  StoreConnectionProvider,
  StoreId,
  StoreRecord,
  UpdateStoreInput,
} from '@amazon-ai-ops/shared-types';
import {
  DEFAULT_US_BUSINESS_TIMEZONE,
  USD_CURRENCY,
  US_MARKETPLACE,
} from '@amazon-ai-ops/shared-types';
import {
  PriorityDataTable,
  WorkbenchPanel,
  WorkspaceState,
  type PriorityDataTableColumn,
} from '../../components/workspace';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';

export const STORE_MANAGEMENT_CAPABILITY_IDS = {
  view: 'objects.store.view',
  create: 'objects.store.create',
  update: 'objects.store.update',
  archive: 'objects.store.archive',
  restore: 'objects.store.restore',
  switch: 'objects.store.switch',
} as const;

type StoreMutation = 'update' | 'archive' | 'restore';

export type StoreManagementPanelProps = {
  stores: readonly StoreRecord[];
  activeStoreId?: StoreId | string | null;
  onUpdate: (input: UpdateStoreInput) => Promise<unknown> | unknown;
  onArchive: (input: ArchiveStoreInput) => Promise<unknown> | unknown;
  onRestore: (input: RestoreStoreInput) => Promise<unknown> | unknown;
  connections?: readonly StoreConnection[];
  onUnbindConnection?: (connection: StoreConnection) => Promise<void> | void;
  error?: string | null;
  syncWarning?: string | null;
};

export type StoreDraft = {
  displayName: string;
  businessTimezone: string;
  status: 'active' | 'inactive';
};

export type StoreDraftErrors = Partial<Record<keyof StoreDraft, string>>;

export function validateStoreDraft(draft: StoreDraft): StoreDraftErrors {
  const errors: StoreDraftErrors = {};
  const displayName = draft.displayName.trim();
  if (!displayName) errors.displayName = '请输入店铺名称。';
  else if (displayName.length > 120) errors.displayName = '店铺名称不能超过 120 个字符。';

  if (draft.businessTimezone !== DEFAULT_US_BUSINESS_TIMEZONE) {
    errors.businessTimezone = '首版业务时区固定为 America/Los_Angeles。';
  }
  if (draft.status !== 'active' && draft.status !== 'inactive') {
    errors.status = '店铺状态无效。';
  }
  return errors;
}

export function buildCreateStoreInput(draft: StoreDraft): CreateStoreInput {
  return {
    displayName: draft.displayName.trim(),
    marketplace: US_MARKETPLACE,
    currency: USD_CURRENCY,
    businessTimezone: DEFAULT_US_BUSINESS_TIMEZONE,
  };
}

export function buildUpdateStoreInput(
  store: StoreRecord,
  draft: StoreDraft,
): UpdateStoreInput | null {
  const patch: UpdateStoreInput['patch'] = {};
  const displayName = draft.displayName.trim();
  if (displayName !== store.displayName) patch.displayName = displayName;
  if (draft.status !== store.status) patch.status = draft.status;
  if (Object.keys(patch).length === 0) return null;
  return {
    storeId: store.storeId,
    expectedUpdatedAt: store.updatedAt,
    patch,
  };
}

export function buildArchiveStoreInput(store: StoreRecord): ArchiveStoreInput {
  return {
    storeId: store.storeId,
    expectedUpdatedAt: store.updatedAt,
    reason: 'operator_archived_from_mission_control',
  };
}

export function buildRestoreStoreInput(store: StoreRecord): RestoreStoreInput {
  return {
    storeId: store.storeId,
    expectedUpdatedAt: store.updatedAt,
  };
}

function initialDraft(store?: StoreRecord | null): StoreDraft {
  return {
    displayName: store?.displayName ?? '',
    businessTimezone: store?.businessTimezone ?? DEFAULT_US_BUSINESS_TIMEZONE,
    status: store?.status === 'inactive' ? 'inactive' : 'active',
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return '操作未完成，请检查 Main 返回的详细错误。';
}

function StoreStatus({ store }: { store: StoreRecord }) {
  const label = store.status === 'archived'
    ? '已归档'
    : store.status === 'inactive'
      ? '已停用'
      : '运行中';
  return <span className="mission-control-store-status" data-store-status={store.status}>{label}</span>;
}

export function StoreManagementPanel({
  stores,
  activeStoreId,
  onUpdate,
  onArchive,
  onRestore,
  connections = [],
  onUnbindConnection,
  error: externalError,
  syncWarning,
}: StoreManagementPanelProps) {
  const [editor, setEditor] = useState<{ store: StoreRecord; draft: StoreDraft } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<StoreRecord | null>(null);
  const [errors, setErrors] = useState<StoreDraftErrors>({});
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: StoreMutation; storeId?: string } | null>(null);
  const [connectionPending, setConnectionPending] = useState<StoreConnectionProvider | `unbind:${StoreConnectionProvider}` | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState<StoreConnection | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<string | null>(null);
  const rows = useMemo(() => [...stores].sort((left, right) => {
    if (left.status === 'archived' && right.status !== 'archived') return 1;
    if (right.status === 'archived' && left.status !== 'archived') return -1;
    return left.displayName.localeCompare(right.displayName, 'zh-CN');
  }), [stores]);
  const busy = pending !== null || connectionPending !== null;
  const visibleError = runtimeError ?? externalError ?? null;
  const activeStore = rows.find((store) => String(store.storeId) === String(activeStoreId ?? '')) ?? null;
  const lingxingConnection = connections.find((connection) => connection.provider === 'lingxing');
  const amazonAdsConnection = connections.find((connection) => connection.provider === 'amazon_ads');
  const connectionUnbindFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    dismissDisabled: connectionPending !== null,
    onDismiss: () => setConfirmUnbind(null),
    open: confirmUnbind !== null,
  });

  useEffect(() => {
    setConnectionFeedback(null);
    setConfirmUnbind(null);
  }, [
    activeStoreId,
    amazonAdsConnection?.id,
    lingxingConnection?.id,
  ]);

  const unbind = async (connection: StoreConnection) => {
    if (!onUnbindConnection || connectionPending) return;
    const provider = connection.provider;
    setConnectionPending(`unbind:${provider}`);
    setRuntimeError(null);
    setConnectionFeedback(null);
    try {
      await onUnbindConnection(connection);
      setConfirmUnbind(null);
      setConnectionFeedback(`${provider === 'lingxing' ? '领星' : 'Amazon Ads'} 映射已解绑；保存密码未被清除。`);
    } catch (operationError) {
      setRuntimeError(errorMessage(operationError));
    } finally {
      setConnectionPending(null);
    }
  };

  const run = async (action: StoreMutation, operation: () => Promise<unknown> | unknown, storeId?: string) => {
    if (busy) return;
    setPending({ action, storeId });
    setRuntimeError(null);
    try {
      await operation();
      if (action === 'update') setEditor(null);
      if (action === 'archive') setConfirmArchive(null);
    } catch (operationError) {
      setRuntimeError(errorMessage(operationError));
    } finally {
      setPending(null);
    }
  };

  const saveEditor = async () => {
    if (!editor) return;
    const nextErrors = validateStoreDraft(editor.draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const input = buildUpdateStoreInput(editor.store, editor.draft);
    if (!input) {
      setErrors({ displayName: '没有需要保存的变更。' });
      return;
    }
    await run('update', () => onUpdate(input), String(editor.store.storeId));
  };

  const columns: Array<PriorityDataTableColumn<StoreRecord>> = [
    {
      key: 'store',
      header: '店铺数据域',
      priority: 'anchor',
      width: '30%',
      cell: (store) => (
        <div className="mission-control-store-identity">
          <span className="mission-control-store-identity__icon"><Storefront aria-hidden="true" size={18} /></span>
          <span><strong>{store.displayName}</strong><small>{String(store.storeId)}</small></span>
        </div>
      ),
    },
    {
      key: 'market',
      header: '站点 / 币种',
      priority: 'primary',
      width: '14%',
      cell: (store) => <span className="mission-control-store-market">{store.marketplace} / {store.currency}</span>,
    },
    {
      key: 'profile',
      header: '独立 Profile',
      priority: 'supporting',
      width: '20%',
      cell: (store) => <code className="mission-control-store-profile">{String(store.browserProfileId)}</code>,
    },
    {
      key: 'status',
      header: '状态',
      priority: 'primary',
      width: '12%',
      cell: (store) => <StoreStatus store={store} />,
    },
    {
      key: 'actions',
      header: '操作',
      priority: 'action',
      align: 'right',
      cell: (store) => {
        const rowBusy = pending?.storeId === String(store.storeId);
        return (
          <div className="mission-control-store-actions" role="group" aria-label={`${store.displayName}店铺操作`}>
            {store.status !== 'archived' && (
              <button
                aria-label={`编辑 ${store.displayName}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                data-capability-id={STORE_MANAGEMENT_CAPABILITY_IDS.update}
                disabled={busy}
                onClick={() => { setErrors({}); setRuntimeError(null); setEditor({ store, draft: initialDraft(store) }); }}
                title="编辑店铺"
                type="button"
              >
                <PencilSimple aria-hidden="true" size={16} />
              </button>
            )}
            {store.status !== 'archived' ? (
              <button
                aria-label={`归档 ${store.displayName}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                data-capability-id={STORE_MANAGEMENT_CAPABILITY_IDS.archive}
                disabled={busy}
                onClick={() => setConfirmArchive(store)}
                title="归档后可恢复，不会硬删除数据"
                type="button"
              >
                <Archive aria-hidden="true" size={16} />
              </button>
            ) : (
              <button
                className="workspace-button workspace-button--secondary"
                data-capability-id={STORE_MANAGEMENT_CAPABILITY_IDS.restore}
                disabled={busy}
                onClick={() => run('restore', () => onRestore(buildRestoreStoreInput(store)), String(store.storeId))}
                type="button"
              >
                <ArrowCounterClockwise aria-hidden="true" size={16} />
                {rowBusy && pending?.action === 'restore' ? '恢复中…' : '恢复'}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="mission-control-store-management" data-capability-id={STORE_MANAGEMENT_CAPABILITY_IDS.view}>
      <WorkbenchPanel
        description="映射只属于当前 Store + Amazon US；提交后采用 Main 回传值，后台再同步权威视图。解绑映射不会清除本机保存的密码。"
        status={<span>{activeStore ? `${activeStore.displayName} · US` : '等待当前店铺'}</span>}
        title="当前店铺连接映射"
      >
        {!activeStore ? (
          <WorkspaceState
            description="先从左侧“店铺与站点”显式选择一个运行中的美国站店铺。"
            kind="blocked"
            title="尚无当前店铺 authority"
          />
        ) : (
          <div className="store-connection-mapping-grid">
            <section aria-labelledby="store-lingxing-mapping-title" className="store-connection-mapping">
              <header>
                <div>
                  <strong id="store-lingxing-mapping-title">领星 ERP</strong>
                  <span data-connection-state={lingxingConnection?.status || 'missing'}>
                    {lingxingConnection ? '已建立映射' : '尚未绑定'}
                  </span>
                </div>
                <small>连接修改与可见浏览器启动统一在上方“当前店铺外部连接”工作台完成。</small>
              </header>
              <dl className="store-connection-unbind-facts">
                <div><dt>登录账号</dt><dd>{lingxingConnection?.accountLabel || '未配置'}</dd></div>
                <div><dt>下载中心店铺</dt><dd>{lingxingConnection?.collectionStoreName || '未配置'}</dd></div>
              </dl>
              <div className="store-connection-stable-identity" role="status" aria-live="polite">
                <span>稳定身份（Main 首次新鲜登录识别）</span>
                <output aria-label="领星稳定身份只读状态">
                  {lingxingConnection?.externalAccountId
                    ? `已识别：${lingxingConnection.externalAccountId}`
                    : '待首次新鲜登录识别'}
                </output>
              </div>
              <div className="store-connection-mapping__actions">
                {lingxingConnection && (
                  <button
                    className="workspace-button workspace-button--secondary"
                    disabled={busy || !onUnbindConnection}
                    onClick={() => setConfirmUnbind({ ...lingxingConnection })}
                    type="button"
                  >
                    解绑
                  </button>
                )}
              </div>
            </section>

            <section aria-labelledby="store-amazon-ads-mapping-title" className="store-connection-mapping">
              <header>
                <div>
                  <strong id="store-amazon-ads-mapping-title">领星广告账户（自动识别）</strong>
                  <span data-connection-state={amazonAdsConnection?.status || 'missing'}>
                    {amazonAdsConnection ? '已建立映射' : '尚未绑定'}
                  </span>
                </div>
                <small>不要求运营人员查找或填写内部编号；Main 只接受受信页面证据与确认动作。</small>
              </header>
              <div className="store-connection-stable-identity" role="status" aria-live="polite">
                <span>可信身份（只读）</span>
                <output aria-label="领星广告账户自动识别身份只读状态">
                  {amazonAdsConnection?.externalAccountId
                    ? `已验证：${amazonAdsConnection.accountLabel || amazonAdsConnection.externalAccountId}`
                    : '尚未确认；真实广告执行保持阻断'}
                </output>
              </div>
              <div className="store-connection-mapping__actions">
                {amazonAdsConnection && (
                  <button
                    className="workspace-button workspace-button--secondary"
                    disabled={busy || !onUnbindConnection}
                    onClick={() => setConfirmUnbind({ ...amazonAdsConnection })}
                    type="button"
                  >
                    解绑
                  </button>
                )}
              </div>
            </section>
          </div>
        )}
        {connectionFeedback && <div className="store-connection-feedback" role="status">{connectionFeedback}</div>}
        {syncWarning && <div className="store-post-commit-sync-warning" role="status">{syncWarning}</div>}
      </WorkbenchPanel>

      <WorkbenchPanel
        description="第一版固定 Amazon US / USD。每个店铺使用独立数据域、浏览器 Profile 与会话代次。"
        status={<span>{rows.length} 个店铺</span>}
        title="店铺数据域"
      >
        {visibleError && <div className="mission-control-store-error" role="alert">{visibleError}</div>}
        <PriorityDataTable
          caption="可配置美国站店铺数据域"
          columns={columns}
          emptyState={(
            <WorkspaceState
              description="创建第一个美国站店铺后，Main 会分配逻辑 storeId 与独立浏览器 Profile。"
              kind="empty"
              title="还没有店铺数据域"
            />
          )}
          getRowKey={(store) => store.storeId}
          rows={rows}
        />
      </WorkbenchPanel>

      {editor && (
        <div className="mission-control-dialog-backdrop">
          <section
            aria-describedby="mission-control-store-editor-description"
            aria-labelledby="mission-control-store-editor-title"
            aria-modal="true"
            className="mission-control-dialog"
            role="dialog"
          >
            <header>
              <div>
                <span>STORE AUTHORITY</span>
                <h2 id="mission-control-store-editor-title">编辑店铺</h2>
                <p id="mission-control-store-editor-description">站点和币种固定为 US / USD，数据将由 Main 按店铺隔离。</p>
              </div>
              <button aria-label="关闭店铺编辑器" className="mission-control-dialog__close" disabled={busy} onClick={() => setEditor(null)} type="button"><X aria-hidden="true" size={18} /></button>
            </header>
            <div className="mission-control-store-form">
              <label><span>店铺 ID</span><input readOnly value={String(editor.store.storeId)} /></label>
              <label>
                <span>店铺名称</span>
                <input
                  autoFocus
                  maxLength={120}
                  onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, displayName: event.target.value } } : current)}
                  value={editor.draft.displayName}
                />
                {errors.displayName && <small role="alert">{errors.displayName}</small>}
              </label>
              <label><span>Amazon 站点</span><input readOnly value={US_MARKETPLACE} /></label>
              <label><span>币种</span><input readOnly value={USD_CURRENCY} /></label>
              <label>
                <span>业务时区</span>
                <input
                  readOnly
                  value={editor.draft.businessTimezone}
                />
                {errors.businessTimezone && <small role="alert">{errors.businessTimezone}</small>}
              </label>
              <label>
                <span>运行状态</span>
                <select
                  onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, status: event.target.value as StoreDraft['status'] } } : current)}
                  value={editor.draft.status}
                >
                  <option value="active">运行中</option>
                  <option value="inactive">已停用</option>
                </select>
              </label>
            </div>
            <footer>
              <button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setEditor(null)} type="button">取消</button>
              <button
                aria-busy={pending?.action === 'update' || undefined}
                className="workspace-button workspace-button--primary"
                data-capability-id={STORE_MANAGEMENT_CAPABILITY_IDS.update}
                disabled={busy}
                onClick={saveEditor}
                type="button"
              >
                <Check aria-hidden="true" size={16} />
                {pending?.action === 'update' ? '保存中…' : '保存变更'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {confirmArchive && (
        <div className="mission-control-dialog-backdrop">
          <section aria-labelledby="mission-control-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog">
            <header>
              <div>
                <span>ARCHIVE STORE</span>
                <h2 id="mission-control-archive-title">归档 {confirmArchive.displayName}？</h2>
                <p>归档是可恢复操作，不会硬删除店铺、因果事件或执行证据。Main 会在变更前再次校验状态。</p>
              </div>
            </header>
            <footer>
              <button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setConfirmArchive(null)} type="button">取消</button>
              <button
                aria-busy={pending?.action === 'archive' || undefined}
                className="workspace-button workspace-button--primary"
                data-capability-id={STORE_MANAGEMENT_CAPABILITY_IDS.archive}
                disabled={busy}
                onClick={() => run('archive', () => onArchive(buildArchiveStoreInput(confirmArchive)), String(confirmArchive.storeId))}
                type="button"
              >
                <Archive aria-hidden="true" size={16} />
                {pending?.action === 'archive' ? '归档中…' : '确认归档'}
              </button>
            </footer>
          </section>
        </div>
      )}

      {confirmUnbind && (
        <div
          className="mission-control-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !connectionPending) setConfirmUnbind(null);
          }}
          ref={connectionUnbindFocus.overlayRootRef}
          role="presentation"
        >
          <section
            aria-describedby="store-connection-unbind-description"
            aria-labelledby="store-connection-unbind-title"
            aria-modal="true"
            className="mission-control-dialog mission-control-dialog--confirm"
            onMouseDown={(event) => event.stopPropagation()}
            ref={connectionUnbindFocus.surfaceRef}
            role="alertdialog"
            tabIndex={-1}
          >
            <header>
              <div>
                <span>REMOVE STORE MAPPING</span>
                <h2 id="store-connection-unbind-title">
                  解绑{confirmUnbind.provider === 'lingxing' ? '领星下载中心店铺映射' : '领星广告账户'}？
                </h2>
                <p id="store-connection-unbind-description">
                  Main 会使该 provider 会话失效。解绑不等于清除本机保存的领星密码。
                </p>
                <dl className="store-connection-unbind-facts">
                  <div><dt>账号</dt><dd>{confirmUnbind.accountLabel || '未记录'}</dd></div>
                  {confirmUnbind.provider === 'lingxing' ? (
                    <>
                      <div><dt>下载中心店铺名称</dt><dd>{confirmUnbind.collectionStoreName || '未记录'}</dd></div>
                      <div><dt>稳定身份</dt><dd>{confirmUnbind.externalAccountId || '待首次新鲜登录识别'}</dd></div>
                    </>
                  ) : (
                    <div><dt>自动识别身份</dt><dd>{confirmUnbind.externalAccountId || '未记录'}</dd></div>
                  )}
                </dl>
              </div>
            </header>
            <footer>
              <button disabled={Boolean(connectionPending)} onClick={() => setConfirmUnbind(null)} type="button">取消</button>
              <button
                aria-busy={connectionPending === `unbind:${confirmUnbind.provider}` || undefined}
                autoFocus
                className="workspace-button workspace-button--primary"
                disabled={Boolean(connectionPending)}
                onClick={() => void unbind(confirmUnbind)}
                type="button"
              >
                {connectionPending === `unbind:${confirmUnbind.provider}` ? '解绑中…' : '确认解绑映射'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
