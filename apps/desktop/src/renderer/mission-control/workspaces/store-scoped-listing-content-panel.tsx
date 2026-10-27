import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowsClockwise, Check, ClockCounterClockwise, Database, Plus, Trash, X } from '@phosphor-icons/react';
import { inspectAmazonAsin, missionControlContextKey } from '@amazon-ai-ops/shared-types';
import { PriorityDataTable, WorkbenchPanel, WorkspaceState, type PriorityDataTableColumn } from '../../components/workspace';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import { type StoreScopedPanelProps, type StoreListingContentView, type ListingEditor, type ListingVersionHistory, type StoreListingVersionLedger } from "./store-scoped-ad-listing-contracts";
import { resolveApi, storeResultBelongsToContext, userError, readListingVersionHistoryForTarget, listingVersionResponseIsCurrent, readStoreListingVersionLedgerPage, LISTING_VERSION_PAGE_SIZE, buildListingUpdateInput, buildListingCreateInput, listingCoverage, listingDraft, emptyListingDraft } from "./store-scoped-ad-listing-values";
import { ListingRowActions, ListingVersionHistoryDialog, StoreListingVersionLedgerDialog } from "./store-listing-version-dialogs";
import { MissingStoreContext } from "./store-scoped-panel-view";
import { useWorkspaceOperation, type WorkspaceOperationTicket } from '../../components/workspace/use-workspace-operation';
import { useOptionalMissionControlStoreContext } from '../store-context';

type ListingOperationKind = 'load' | 'refresh' | 'save' | 'delete' | 'history' | 'history-retry' | 'ledger' | 'ledger-retry' | 'more';
const useListingLifecycleEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function StoreScopedListingContentPanel({ storeContext, api }: StoreScopedPanelProps) {
  const [query, setQuery] = useState('');
  const provider = useOptionalMissionControlStoreContext();
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const operationKey = JSON.stringify([storeContext, provider?.authoritativeContext, provider?.authorityKey, provider?.contextEpoch, provider?.phase, query]);
  const operation = useWorkspaceOperation(operationKey);
  const canUseAuthority = Boolean(storeContext) && (!provider || (provider.phase === 'ready'
    && provider.authoritativeContext && missionControlContextKey(provider.authoritativeContext) === authorityKey));
  const activeTicket = useRef<{ kind: ListingOperationKind; ticket: WorkspaceOperationTicket } | null>(null);
  const [activeKind, setActiveKind] = useState<ListingOperationKind | null>(null);
  const currentKind = operation.busy ? activeKind : null;
  const pending = currentKind === 'save' || currentKind === 'delete' ? currentKind : null;
  const [publishedKey, setPublishedKey] = useState(operationKey);
  const [rowsValue, setRows] = useState<StoreListingContentView[]>([]);
  const [loadingValue, setLoading] = useState(false);
  const [errorValue, setError] = useState<string | null>(null);
  const [feedbackValue, setFeedback] = useState<string | null>(null);
  const [editorValue, setEditor] = useState<ListingEditor | null>(null);
  const [confirmDeleteValue, setConfirmDelete] = useState<StoreListingContentView | null>(null);
  const [historyValue, setVersionHistory] = useState<ListingVersionHistory | null>(null);
  const [ledgerValue, setVersionLedger] = useState<StoreListingVersionLedger | null>(null);
  const visible = publishedKey === operationKey;
  const rows = visible ? rowsValue : [];
  const loading = visible && loadingValue;
  const error = visible ? errorValue : null;
  const feedback = visible ? feedbackValue : null;
  const editor = visible ? editorValue : null;
  const confirmDelete = visible ? confirmDeleteValue : null;
  const versionHistory = visible ? historyValue : null;
  const versionLedger = visible ? ledgerValue : null;
  const rendererApi = resolveApi(api);
  const operationReason = !canUseAuthority ? '当前店铺权威尚未就绪，请等待顶部店铺状态就绪后重试。'
    : operation.busy ? '当前 Listing 操作正在处理中，请稍候。' : '';
  const missingMethods = [
    !rendererApi.listStoreListingContent && 'Listing 读取服务尚未就绪。',
    !rendererApi.createStoreListingContent && 'Listing 创建服务尚未就绪。',
    !rendererApi.updateStoreListingContent && 'Listing 更新服务尚未就绪。',
    !rendererApi.deleteStoreListingContent && 'Listing 删除服务尚未就绪。',
    !rendererApi.listStoreListingContentVersions && 'Listing 版本读取服务尚未就绪。',
  ].filter((text): text is string => Boolean(text));
  const saveAvailable = editor?.current ? Boolean(rendererApi.updateStoreListingContent) : Boolean(rendererApi.createStoreListingContent);
  const editorReason = operationReason || (!saveAvailable ? '当前 Listing 保存服务尚未就绪。'
    : editor && !inspectAmazonAsin(editor.draft.asin).valid ? 'ASIN 必须是 10 位 ASCII 字母或数字。' : '');

  function begin(kind: ListingOperationKind) {
    if (!canUseAuthority) return null;
    const ticket = operation.begin();
    if (!ticket) return null;
    activeTicket.current = { kind, ticket };
    setActiveKind(kind);
    return ticket;
  }

  function finish(ticket: WorkspaceOperationTicket) {
    if (activeTicket.current?.ticket === ticket) activeTicket.current = null;
    ticket.finish();
  }

  function closeMutationDialog() {
    if (activeTicket.current?.ticket.isCurrent()) return;
    setEditor(null);
    setConfirmDelete(null);
  }

  function openEditor(next: ListingEditor) {
    if (!canUseAuthority || activeTicket.current?.ticket.isCurrent()) return;
    if (next.current?.asinValid === false) { setError('历史非法 ASIN 仅供对账，不能编辑或删除。'); return; }
    setEditor(next);
  }

  function openDelete(row: StoreListingContentView) {
    if (!canUseAuthority || activeTicket.current?.ticket.isCurrent()) return;
    setConfirmDelete(row);
  }
  const dialogOpen = Boolean(editor || confirmDelete);
  const errorFeedback = error && <div className="store-fact-feedback store-fact-feedback--error" role="alert">{error}</div>;
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: dialogOpen,
    dismissDisabled: operation.busy,
    onDismiss: closeMutationDialog,
  });
  const requestRef = useRef(0);
  const mutationRef = useRef(0);
  const versionRequestRef = useRef(0);
  const ledgerRequestRef = useRef(0);
  const authorityKeyRef = useRef(authorityKey);
  authorityKeyRef.current = authorityKey;

  const load = useCallback(async (parentTicket?: WorkspaceOperationTicket, manual = false) => {
    if (!storeContext || !canUseAuthority) return;
    const ticket = parentTicket ?? begin(manual ? 'refresh' : 'load');
    if (!ticket || !ticket.isCurrent()) return;
    const method = resolveApi(api).listStoreListingContent;
    if (!method) {
      setRows([]);
      setError('商品详情读取服务尚未就绪，请重新打开最新版本后重试。');
      if (!parentTicket) finish(ticket);
      return;
    }
    const request = ++requestRef.current;
    const capturedKey = authorityKey;
    setLoading(true);
    setError(null);
    try {
      const result = await method(storeContext, { query: query.trim() || undefined, limit: 250 });
      if (!ticket.isCurrent() || request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      if (!Array.isArray(result) || result.some((row) => !storeResultBelongsToContext(row, storeContext))) {
        throw new Error('返回的商品详情与当前店铺或美国站范围不一致');
      }
      setRows(result);
    } catch (caught) {
      const message = userError(caught, 'Listing 内容读取失败');
      if (!ticket.isCurrent() || request !== requestRef.current || capturedKey !== authorityKeyRef.current) return;
      setRows([]);
      setError(message);
    } finally {
      if (ticket.isCurrent() && request === requestRef.current && capturedKey === authorityKeyRef.current) setLoading(false);
      if (!parentTicket) finish(ticket);
    }
  }, [api, authorityKey, query, storeContext, operationKey]);

  useListingLifecycleEffect(() => {
    setPublishedKey(operationKey);
    setRows([]);
    setEditor(null);
    setConfirmDelete(null);
    setVersionHistory(null);
    setVersionLedger(null);
    setError(null);
    setFeedback(null);
    setLoading(false);
    return () => {
      requestRef.current += 1;
      mutationRef.current += 1;
      versionRequestRef.current += 1;
      ledgerRequestRef.current += 1;
    };
  }, [operationKey]);

  useEffect(() => { void load(); }, [load]);

  const openVersionHistory = useCallback(async (target: StoreListingContentView, retry = false) => {
    if (!storeContext) return;
    const ticket = begin(retry ? 'history-retry' : 'history');
    if (!ticket) return;
    const method = resolveApi(api).listStoreListingContentVersions;
    const request = ++versionRequestRef.current;
    const capturedKey = authorityKey;
    setVersionHistory({
      target,
      rows: [],
      selectedId: null,
      loading: true,
      error: null,
    });
    if (!method) {
      setVersionHistory((current) => current?.target.id === target.id
        ? { ...current, loading: false, error: '版本历史读取服务尚未就绪，请重新打开最新版本后重试。' }
        : current);
      finish(ticket);
      return;
    }
    try {
      const result = await readListingVersionHistoryForTarget(method, storeContext, target);
      if (!ticket.isCurrent() || !listingVersionResponseIsCurrent(
        request,
        versionRequestRef.current,
        capturedKey,
        authorityKeyRef.current,
      )) return;
      setVersionHistory({
        target,
        rows: result,
        selectedId: result[0]?.id ?? null,
        loading: false,
        error: null,
      });
    } catch (caught) {
      const message = userError(caught, 'Listing 版本历史读取失败');
      if (!ticket.isCurrent() || !listingVersionResponseIsCurrent(
        request,
        versionRequestRef.current,
        capturedKey,
        authorityKeyRef.current,
      )) return;
      setVersionHistory({
        target,
        rows: [],
        selectedId: null,
        loading: false,
        error: message,
      });
    } finally {
      finish(ticket);
    }
  }, [api, authorityKey, storeContext, operationKey]);

  const closeVersionHistory = () => {
    versionRequestRef.current += 1;
    if (activeTicket.current?.kind === 'history' || activeTicket.current?.kind === 'history-retry') finish(activeTicket.current.ticket);
    setVersionHistory(null);
  };

  const loadVersionLedger = useCallback(async (offset: number, replace: boolean, retry = false) => {
    if (!storeContext) return;
    const ticket = begin(replace ? (retry ? 'ledger-retry' : 'ledger') : 'more');
    if (!ticket) return;
    const method = resolveApi(api).listStoreListingContentVersions;
    const request = ++ledgerRequestRef.current;
    const capturedKey = authorityKey;
    if (replace) {
      versionRequestRef.current += 1;
      setVersionHistory(null);
      setVersionLedger({
        rows: [],
        selectedId: null,
        loading: true,
        loadingMore: false,
        error: null,
        nextOffset: 0,
        hasMore: false,
      });
    } else {
      setVersionLedger((current) => current
        ? { ...current, loadingMore: true, error: null }
        : current);
    }
    if (!method) {
      setVersionLedger((current) => current
        ? {
          ...current,
          loading: false,
          loadingMore: false,
          error: '版本记录读取服务尚未就绪，请重新打开最新版本后重试。',
        }
        : current);
      finish(ticket);
      return;
    }
    try {
      const result = await readStoreListingVersionLedgerPage(method, storeContext, offset);
      if (!ticket.isCurrent() || !listingVersionResponseIsCurrent(
        request,
        ledgerRequestRef.current,
        capturedKey,
        authorityKeyRef.current,
      )) return;
      setVersionLedger((current) => {
        const rows = replace ? result : [...(current?.rows ?? []), ...result];
        return {
          rows,
          selectedId: current?.selectedId ?? rows[0]?.id ?? null,
          loading: false,
          loadingMore: false,
          error: null,
          nextOffset: offset + result.length,
          hasMore: result.length === LISTING_VERSION_PAGE_SIZE,
        };
      });
    } catch (caught) {
      const message = userError(caught, 'Listing 版本账本读取失败');
      if (!ticket.isCurrent() || !listingVersionResponseIsCurrent(
        request,
        ledgerRequestRef.current,
        capturedKey,
        authorityKeyRef.current,
      )) return;
      setVersionLedger((current) => current
        ? {
          ...current,
          loading: false,
          loadingMore: false,
          error: message,
        }
        : current);
    } finally {
      finish(ticket);
    }
  }, [api, authorityKey, storeContext, operationKey]);

  const openVersionLedger = () => {
    void loadVersionLedger(0, true);
  };

  const closeVersionLedger = () => {
    ledgerRequestRef.current += 1;
    if (activeTicket.current?.kind === 'ledger' || activeTicket.current?.kind === 'ledger-retry' || activeTicket.current?.kind === 'more') finish(activeTicket.current.ticket);
    setVersionLedger(null);
  };

  const save = async () => {
    if (!storeContext || !editor) return;
    const rendererApi = resolveApi(api);
    const method = editor.current
      ? rendererApi.updateStoreListingContent
      : rendererApi.createStoreListingContent;
    if (!method) {
      setError(`商品详情${editor.current ? '更新' : '创建'}服务尚未就绪，请重新打开最新版本后重试。`);
      return;
    }
    if (!inspectAmazonAsin(editor.draft.asin).valid) {
      setError('ASIN 必须是 10 位 ASCII 字母或数字。');
      return;
    }
    const ticket = begin('save');
    if (!ticket) return;
    setError(null);
    setFeedback(null);
    const mutation = ++mutationRef.current;
    const capturedKey = authorityKey;
    try {
      const result = editor.current
        ? await rendererApi.updateStoreListingContent!(
          storeContext,
          buildListingUpdateInput(editor.current, editor.draft),
        )
        : await rendererApi.createStoreListingContent!(
          storeContext,
          buildListingCreateInput(editor.draft),
        );
      if (!ticket.isCurrent() || mutation !== mutationRef.current || capturedKey !== authorityKeyRef.current) return;
      if (!storeResultBelongsToContext(result, storeContext)) {
        throw new Error('返回的商品详情与当前店铺或美国站范围不一致');
      }
      await load(ticket);
      if (!ticket.isCurrent()) return;
      setEditor(null);
      setFeedback(`${result.asin} 已保存到当前店铺，本地内容不会自动发布到 Amazon。`);
    } catch (caught) {
      const message = userError(caught, 'Listing 保存失败');
      if (!ticket.isCurrent() || mutation !== mutationRef.current || capturedKey !== authorityKeyRef.current) return;
      setError(message);
    } finally {
      finish(ticket);
    }
  };

  const remove = async () => {
    if (!storeContext || !confirmDelete) return;
    if (confirmDelete.asinValid === false) {
      setConfirmDelete(null);
      setError('历史非法 ASIN 仅供对账，不能编辑或删除。');
      return;
    }
    const method = resolveApi(api).deleteStoreListingContent;
    if (!method) {
      setError('商品详情删除服务尚未就绪，请重新打开最新版本后重试。');
      return;
    }
    const ticket = begin('delete');
    if (!ticket) return;
    setError(null);
    setFeedback(null);
    const mutation = ++mutationRef.current;
    const capturedKey = authorityKey;
    try {
      await method(storeContext, {
        id: confirmDelete.id,
        expectedRevision: confirmDelete.revision,
      });
      if (!ticket.isCurrent() || mutation !== mutationRef.current || capturedKey !== authorityKeyRef.current) return;
      await load(ticket);
      if (!ticket.isCurrent()) return;
      setConfirmDelete(null);
      setFeedback(`${confirmDelete.asin} 已从当前店铺内容库删除；历史版本仍保留。`);
    } catch (caught) {
      const message = userError(caught, 'Listing 删除失败');
      if (!ticket.isCurrent() || mutation !== mutationRef.current || capturedKey !== authorityKeyRef.current) return;
      setError(message);
    } finally {
      finish(ticket);
    }
  };

  const columns = useMemo<Array<PriorityDataTableColumn<StoreListingContentView>>>(() => [
    {
      key: 'listing',
      header: 'ASIN / 标题',
      priority: 'anchor',
      width: '34%',
      cell: (row) => <span className="store-fact-primary"><strong>{row.asin}</strong><small>{row.asinValid === false ? '历史 ASIN 无效 · 只读待对账' : row.title || '标题待补齐'}</small></span>,
    },
    {
      key: 'coverage',
      header: '内容完整度',
      priority: 'primary',
      width: '18%',
      cell: (row) => <span className="store-fact-metric"><strong>{listingCoverage(row)}/5 项</strong><small>{row.bullets.length} 条 Bullet · {row.backendTerms ? '有后台词' : '无后台词'}</small></span>,
    },
    {
      key: 'version',
      header: '版本',
      priority: 'supporting',
      width: '18%',
      cell: (row) => <span className="store-fact-metric"><strong>{row.versionLabel || '未标版本'}</strong><small>{row.updatedAt || '—'}</small></span>,
    },
    {
      key: 'actions',
      header: '操作',
      priority: 'action',
      width: '30%',
      align: 'end',
      cell: (row) => (
        <ListingRowActions
          onDelete={() => openDelete(row)}
          onEdit={() => openEditor({ current: row, draft: listingDraft(row) })}
          onHistory={() => void openVersionHistory(row)}
          pending={operation.busy || !canUseAuthority}
          canHistory={Boolean(rendererApi.listStoreListingContentVersions)}
          canEdit={Boolean(rendererApi.updateStoreListingContent)}
          canDelete={Boolean(rendererApi.deleteStoreListingContent)}
          historyBusy={currentKind === 'history' && versionHistory?.target.id === row.id}
          row={row}
        />
      ),
    },
  ], [openVersionHistory, currentKind, operation.busy, canUseAuthority, versionHistory, rendererApi]);

  if (!storeContext) return <MissingStoreContext subject="Listing 内容" />;

  return (
    <div className="store-scoped-ad-listing-panel" data-store-fact-surface="listing-content">
      <div className="store-fact-authority" role="note"><Database aria-hidden="true" size={15} /><strong>当前店铺</strong><span>Amazon US · USD · 本地内容库</span></div>
      {operationReason && <p id="store-listing-operation-reason" role="status">{operationReason}</p>}
      {missingMethods.map(reason => <p className="store-fact-feedback store-fact-feedback--error" key={reason}>{reason}</p>)}
      {!dialogOpen && errorFeedback}
      {feedback && <div className="store-fact-feedback store-fact-feedback--success" role="status">{feedback}</div>}
      <WorkbenchPanel
        description="Listing 内容按当前店铺与 ASIN 管理；更新、删除必须通过界面读取版本的并发校验。"
        status={<span>{loading ? '读取中…' : `${rows.length} 个 Listing`}</span>}
        title="Listing 内容库"
        toolbar={(
          <>
            <label className="store-fact-filter"><span>查询</span><input aria-label="查询 Listing" disabled={Boolean(pending) || !canUseAuthority} onChange={(event) => setQuery(event.target.value)} placeholder="ASIN / 标题" value={query} /></label>
            <button aria-busy={currentKind === 'refresh' || undefined} className="workspace-button workspace-button--secondary" disabled={operation.busy || !canUseAuthority || !rendererApi.listStoreListingContent} onClick={() => void load(undefined, true)} type="button"><ArrowsClockwise aria-hidden="true" size={16} />刷新</button>
            <button aria-busy={currentKind === 'ledger' || undefined} aria-label="查看当前店铺 Listing 版本账本" className="workspace-button workspace-button--secondary" disabled={operation.busy || !canUseAuthority || !rendererApi.listStoreListingContentVersions} onClick={openVersionLedger} type="button"><ClockCounterClockwise aria-hidden="true" size={16} />版本账本</button>
            <button className="workspace-button workspace-button--primary" data-action-priority="primary" disabled={operation.busy || !canUseAuthority || !rendererApi.createStoreListingContent} onClick={() => openEditor({ current: null, draft: emptyListingDraft() })} type="button"><Plus aria-hidden="true" size={16} />新建 Listing</button>
          </>
        )}
      >
        <PriorityDataTable
          caption="当前店铺 Listing 内容"
          columns={columns}
          emptyState={<WorkspaceState description="当前店铺尚无 Listing 内容，可新建后用于本地分析与草案。" kind={loading ? 'loading' : 'empty'} />}
          getRowKey={(row) => row.id}
          rows={rows}
        />
      </WorkbenchPanel>

      {versionHistory && (
        <ListingVersionHistoryDialog
          error={versionHistory.error}
          loading={versionHistory.loading}
          onClose={closeVersionHistory}
          onRetry={() => void openVersionHistory(versionHistory.target, true)}
          onSelect={(selectedId) => setVersionHistory((current) => current
            ? { ...current, selectedId }
            : current)}
          rows={versionHistory.rows}
          selectedId={versionHistory.selectedId}
          target={versionHistory.target}
        />
      )}

      {versionLedger && (
        <StoreListingVersionLedgerDialog
          error={versionLedger.error}
          hasMore={versionLedger.hasMore}
          loading={versionLedger.loading}
          loadingMore={versionLedger.loadingMore}
          onClose={closeVersionLedger}
          onLoadMore={() => void loadVersionLedger(versionLedger.nextOffset, false)}
          onRetry={() => void loadVersionLedger(0, true, true)}
          onSelect={(selectedId) => setVersionLedger((current) => current
            ? { ...current, selectedId }
            : current)}
          rows={versionLedger.rows}
          selectedId={versionLedger.selectedId}
          storeContext={storeContext}
        />
      )}

      {editor && (
        <div className="store-fact-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
          <section aria-labelledby="store-listing-editor-title" aria-modal="true" className="store-fact-dialog" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
            <header><div><span>STORE-SCOPED LISTING</span><h2 id="store-listing-editor-title">{editor.current ? `编辑 ${editor.current.asin}` : '新建美国站 Listing'}</h2><p>内容只保存在当前店铺本地数据库；不会自动提交 Amazon 或改写领星。</p></div><button aria-label="关闭 Listing 编辑器" disabled={operation.busy} onClick={closeMutationDialog} type="button"><X aria-hidden="true" size={18} /></button></header>
            <fieldset className="store-listing-form" disabled={operation.busy} style={{ border: 0, margin: 0, minWidth: 0 }}>{errorFeedback && <div className="store-listing-form__wide">{errorFeedback}</div>}
              <label><span>ASIN *</span><input disabled={Boolean(editor.current)} onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, asin: event.target.value } } : current)} value={editor.draft.asin} />{editor.current && <small>已保存的 ASIN 不可修改；需要其他 ASIN 时请新建 Listing。</small>}</label>
              <label><span>版本标签</span><input onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, versionLabel: event.target.value } } : current)} placeholder="例如 2026-07-22-v1" value={editor.draft.versionLabel} /></label>
              <label className="store-listing-form__wide"><span>标题</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, title: event.target.value } } : current)} rows={2} value={editor.draft.title} /></label>
              <label className="store-listing-form__wide"><span>Bullet Points（每行一条）</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, bulletsText: event.target.value } } : current)} rows={6} value={editor.draft.bulletsText} /></label>
              <label className="store-listing-form__wide"><span>产品描述</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, description: event.target.value } } : current)} rows={4} value={editor.draft.description} /></label>
              <label className="store-listing-form__wide"><span>A+ 内容</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, aPlus: event.target.value } } : current)} rows={3} value={editor.draft.aPlus} /></label>
              <label className="store-listing-form__wide"><span>图片文案</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, imageCopy: event.target.value } } : current)} rows={3} value={editor.draft.imageCopy} /></label>
              <label className="store-listing-form__wide"><span>后台搜索词</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, backendTerms: event.target.value } } : current)} rows={2} value={editor.draft.backendTerms} /></label>
              <label><span>内容来源</span><select onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, source: event.target.value } } : current)} value={editor.draft.source}><option value="manual">人工录入</option><option value="lingxing">领星读取</option><option value="import">本地导入</option></select></label>
              <label className="store-listing-form__wide"><span>变更说明</span><textarea onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, changeSummary: event.target.value } } : current)} rows={2} value={editor.draft.changeSummary} /></label>
            </fieldset>
            {editorReason && <p role="status">{editorReason}</p>}
            <footer><button className="workspace-button workspace-button--secondary" disabled={operation.busy} onClick={closeMutationDialog} type="button">取消</button><button aria-busy={pending === 'save' || undefined} className="workspace-button workspace-button--primary" disabled={operation.busy || Boolean(editorReason)} onClick={() => void save()} type="button"><Check aria-hidden="true" size={16} />{pending === 'save' ? '保存中…' : '保存 Listing'}</button></footer>
          </section>
        </div>
      )}

      {confirmDelete && (
        <div className="store-fact-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
          <section aria-labelledby="store-listing-delete-title" aria-modal="true" className="store-fact-dialog store-fact-dialog--confirm" ref={dialogFocus.surfaceRef} tabIndex={-1} role="alertdialog">
            {errorFeedback}
            <header><div><span>删除商品内容</span><h2 id="store-listing-delete-title">删除 {confirmDelete.asin}？</h2><p>当前内容行会删除，版本历史保留；本机安全进程会通过版本校验阻止覆盖并发修改。</p></div></header>
            {(operationReason || !rendererApi.deleteStoreListingContent) && <p role="status">{operationReason || 'Listing 删除服务尚未就绪。'}</p>}
            <footer>
              <button className="workspace-button workspace-button--secondary" disabled={operation.busy} onClick={closeMutationDialog} type="button">取消</button>
              <button aria-busy={pending === 'delete' || undefined} className="workspace-button workspace-button--danger" disabled={operation.busy || !rendererApi.deleteStoreListingContent} onClick={() => void remove()} type="button"><Trash aria-hidden="true" size={16} />{pending === 'delete' ? '删除中…' : '确认删除'}</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
