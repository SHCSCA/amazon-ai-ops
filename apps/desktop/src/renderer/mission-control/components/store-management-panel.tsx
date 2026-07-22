import React, { useMemo, useState } from 'react';
import {
  Archive,
  ArrowCounterClockwise,
  Check,
  PencilSimple,
  Plus,
  Storefront,
  X,
} from '@phosphor-icons/react';
import type {
  ArchiveStoreInput,
  CreateStoreInput,
  RestoreStoreInput,
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

export const STORE_MANAGEMENT_CAPABILITY_IDS = {
  view: 'objects.store.view',
  create: 'objects.store.create',
  update: 'objects.store.update',
  archive: 'objects.store.archive',
  restore: 'objects.store.restore',
  switch: 'objects.store.switch',
} as const;

type StoreMutation = 'create' | 'update' | 'archive' | 'restore' | 'switch';

export type StoreManagementPanelProps = {
  stores: readonly StoreRecord[];
  activeStoreId?: StoreId | string | null;
  onCreate: (input: CreateStoreInput) => Promise<unknown> | unknown;
  onUpdate: (input: UpdateStoreInput) => Promise<unknown> | unknown;
  onArchive: (input: ArchiveStoreInput) => Promise<unknown> | unknown;
  onRestore: (input: RestoreStoreInput) => Promise<unknown> | unknown;
  onSwitch: (storeId: StoreId) => Promise<unknown> | unknown;
  error?: string | null;
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

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: draft.businessTimezone }).format(0);
  } catch {
    errors.businessTimezone = '请输入有效的 IANA 时区。';
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
    businessTimezone: draft.businessTimezone,
  };
}

export function buildUpdateStoreInput(
  store: StoreRecord,
  draft: StoreDraft,
): UpdateStoreInput | null {
  const patch: UpdateStoreInput['patch'] = {};
  const displayName = draft.displayName.trim();
  if (displayName !== store.displayName) patch.displayName = displayName;
  if (draft.businessTimezone !== store.businessTimezone) patch.businessTimezone = draft.businessTimezone;
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
  onCreate,
  onUpdate,
  onArchive,
  onRestore,
  onSwitch,
  error: externalError,
}: StoreManagementPanelProps) {
  const [editor, setEditor] = useState<{ store: StoreRecord | null; draft: StoreDraft } | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<StoreRecord | null>(null);
  const [errors, setErrors] = useState<StoreDraftErrors>({});
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ action: StoreMutation; storeId?: string } | null>(null);
  const rows = useMemo(() => [...stores].sort((left, right) => {
    if (left.status === 'archived' && right.status !== 'archived') return 1;
    if (right.status === 'archived' && left.status !== 'archived') return -1;
    return left.displayName.localeCompare(right.displayName, 'zh-CN');
  }), [stores]);
  const busy = pending !== null;
  const visibleError = runtimeError ?? externalError ?? null;

  const run = async (action: StoreMutation, operation: () => Promise<unknown> | unknown, storeId?: string) => {
    if (busy) return;
    setPending({ action, storeId });
    setRuntimeError(null);
    try {
      await operation();
      if (action === 'create' || action === 'update') setEditor(null);
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

    if (!editor.store) {
      await run('create', () => onCreate(buildCreateStoreInput(editor.draft)));
      return;
    }

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
        const isActive = String(activeStoreId ?? '') === String(store.storeId);
        return (
          <div className="mission-control-store-actions" role="group" aria-label={`${store.displayName}店铺操作`}>
            {store.status !== 'archived' && (
              <button
                className="workspace-button workspace-button--secondary"
                data-capability-id={STORE_MANAGEMENT_CAPABILITY_IDS.switch}
                disabled={busy || isActive}
                onClick={() => run('switch', () => onSwitch(store.storeId), String(store.storeId))}
                title={isActive ? '当前已在该店铺数据域' : '切换后将清空旧店铺的页面状态'}
                type="button"
              >
                {rowBusy && pending?.action === 'switch' ? '切换中…' : isActive ? '当前店铺' : '切换'}
              </button>
            )}
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
        description="第一版固定 Amazon US / USD。每个店铺使用独立数据域、浏览器 Profile 与会话代次。"
        status={<span>{rows.length} 个店铺</span>}
        title="店铺数据域"
        toolbar={(
          <button
            className="workspace-button workspace-button--primary"
            data-capability-id={STORE_MANAGEMENT_CAPABILITY_IDS.create}
            disabled={busy}
            onClick={() => { setErrors({}); setRuntimeError(null); setEditor({ store: null, draft: initialDraft() }); }}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            新建店铺
          </button>
        )}
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
                <h2 id="mission-control-store-editor-title">{editor.store ? '编辑店铺' : '新建美国站店铺'}</h2>
                <p id="mission-control-store-editor-description">站点和币种固定为 US / USD，数据将由 Main 按店铺隔离。</p>
              </div>
              <button aria-label="关闭店铺编辑器" className="mission-control-dialog__close" disabled={busy} onClick={() => setEditor(null)} type="button"><X aria-hidden="true" size={18} /></button>
            </header>
            <div className="mission-control-store-form">
              {editor.store && <label><span>店铺 ID</span><input readOnly value={String(editor.store.storeId)} /></label>}
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
                  onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, businessTimezone: event.target.value } } : current)}
                  value={editor.draft.businessTimezone}
                />
                {errors.businessTimezone && <small role="alert">{errors.businessTimezone}</small>}
              </label>
              {editor.store && (
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
              )}
            </div>
            <footer>
              <button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setEditor(null)} type="button">取消</button>
              <button
                aria-busy={pending?.action === 'create' || pending?.action === 'update' || undefined}
                className="workspace-button workspace-button--primary"
                data-capability-id={editor.store ? STORE_MANAGEMENT_CAPABILITY_IDS.update : STORE_MANAGEMENT_CAPABILITY_IDS.create}
                disabled={busy}
                onClick={saveEditor}
                type="button"
              >
                <Check aria-hidden="true" size={16} />
                {pending?.action === 'create' || pending?.action === 'update' ? '保存中…' : editor.store ? '保存变更' : '创建数据域'}
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
    </div>
  );
}
