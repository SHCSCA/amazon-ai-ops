import React from 'react';
import { ArrowsClockwise, ClockCounterClockwise, NotePencil, Trash, X } from '@phosphor-icons/react';
import { WorkspaceState, selectEntityDeletePolicy } from '../../components/workspace';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import { type ListingRowActionsProps, type ListingVersionHistoryDialogProps, type StoreListingVersionLedgerDialogProps } from "./store-scoped-ad-listing-contracts";
import { userError, listingSourceLabel } from "./store-scoped-ad-listing-values";

export function ListingRowActions({ row, pending, onHistory, onEdit, onDelete, canHistory = true, canEdit = true, canDelete = true, historyBusy = false }: ListingRowActionsProps) {
  const readOnly = row.asinValid === false;
  const policy = selectEntityDeletePolicy('listing-version', {
    buttonLabelOverride: '删除',
    reasonOverride: readOnly ? '历史 ASIN 无效，仅供对账，禁止删除' : undefined,
  });
  const deleteDisabled = pending || readOnly || !canDelete;
  const deleteAriaLabel = `${policy.buttonLabel} ${row.asin}`;
  return (
    <span className="store-fact-row-actions">
      <button aria-busy={historyBusy || undefined} aria-label={`查看 ${row.asin} 版本历史`} className="workspace-button workspace-button--secondary" disabled={pending || !canHistory} onClick={onHistory} type="button"><ClockCounterClockwise aria-hidden="true" size={15} />版本</button>
      <button aria-label={`编辑 ${row.asin}`} className="workspace-button workspace-button--secondary" disabled={pending || readOnly || !canEdit} onClick={onEdit} title={readOnly ? '历史 ASIN 无效，需先完成数据对账' : undefined} type="button"><NotePencil aria-hidden="true" size={15} />编辑</button>
      <button aria-label={deleteAriaLabel} className="workspace-button workspace-button--danger" disabled={deleteDisabled} onClick={onDelete} title={policy.reason} type="button"><Trash aria-hidden="true" size={15} />删除</button>
      {readOnly && <small aria-label={`${row.asin} 只读原因`}>非法 ASIN · 只读</small>}
    </span>
  );
}

export function ListingVersionHistoryDialog({
  target,
  rows,
  selectedId,
  loading,
  error,
  onSelect,
  onRetry,
  onClose,
}: ListingVersionHistoryDialogProps) {
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({ open: true, onDismiss: onClose });
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const visibleError = error ? userError(error, '版本历史读取失败') : null;
  return (
    <div className="store-fact-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
      <section aria-labelledby="store-listing-version-title" aria-modal="true" className="store-fact-dialog" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
        <header>
          <div>
            <span>当前店铺版本历史</span>
            <h2 id="store-listing-version-title">{target.asin} 版本历史</h2>
            <p>当前店铺 · Amazon US · USD · 历史快照只读，不会提交 Amazon 或改写领星。</p>
          </div>
          <button aria-label="关闭 Listing 版本历史" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="store-listing-form">
          {loading ? (
            <div className="store-listing-form__wide"><WorkspaceState description="正在读取当前店铺的 Listing 版本历史。" kind="loading" title="读取版本历史" /></div>
          ) : visibleError ? (
            <div className="store-listing-form__wide">
              <div className="store-fact-feedback store-fact-feedback--error" role="alert">{visibleError}</div>
              <button className="workspace-button workspace-button--secondary" onClick={onRetry} type="button"><ArrowsClockwise aria-hidden="true" size={16} />重试</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="store-listing-form__wide"><WorkspaceState description="当前 Listing 尚无已保存的历史快照。" kind="empty" title="暂无版本历史" /></div>
          ) : (
            <>
              <section aria-label="版本列表">
                {rows.map((row) => (
                  <button
                    aria-pressed={selected?.id === row.id}
                    className={`workspace-button ${selected?.id === row.id ? 'workspace-button--primary' : 'workspace-button--secondary'}`}
                    key={row.id}
                    onClick={() => onSelect(row.id)}
                    type="button"
                  >
                    <span className="store-fact-primary">
                      <strong>{row.versionLabel || '未命名版本'}</strong>
                      <small>{row.createdAt || '时间未知'} · {listingSourceLabel(row.source)}</small>
                      <small>{row.changeSummary || '未填写变更说明'}</small>
                    </span>
                  </button>
                ))}
              </section>
              {selected && (
                <section aria-label="版本快照">
                  <span className="store-fact-primary"><strong>标题</strong><small>{selected.title || '未填写标题'}</small></span>
                  <span className="store-fact-primary"><strong>商品要点</strong><small>{selected.bullets.length > 0 ? selected.bullets.join('；') : '未填写商品要点'}</small></span>
                  <span className="store-fact-primary"><strong>后台搜索词</strong><small>{selected.backendTerms || '未填写后台搜索词'}</small></span>
                  <span className="store-fact-primary"><strong>来源与变更</strong><small>{listingSourceLabel(selected.source)} · {selected.changeSummary || '未填写变更说明'}</small></span>
                </section>
              )}
            </>
          )}
        </div>
        <footer><button className="workspace-button workspace-button--secondary" onClick={onClose} type="button">关闭</button></footer>
      </section>
    </div>
  );
}

export function StoreListingVersionLedgerDialog({
  storeContext,
  rows,
  selectedId,
  loading,
  loadingMore,
  error,
  hasMore,
  onSelect,
  onRetry,
  onLoadMore,
  onClose,
}: StoreListingVersionLedgerDialogProps) {
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({ open: true, onDismiss: onClose });
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  const visibleError = error ? userError(error, '版本记录读取失败') : null;
  return (
    <div className="store-fact-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
      <section aria-labelledby="store-listing-ledger-title" aria-modal="true" className="store-fact-dialog" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
        <header>
          <div>
            <span>当前店铺版本记录</span>
            <h2 id="store-listing-ledger-title">当前店铺 Listing 版本账本</h2>
            <p>当前店铺 · Amazon US · USD · 已删除 Listing 的历史快照也会保留在这里。</p>
          </div>
          <button aria-label="关闭 Listing 版本账本" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="store-listing-form store-listing-version-layout">
          {loading ? (
            <div className="store-listing-form__wide"><WorkspaceState description="正在读取当前店铺的 Listing 版本账本。" kind="loading" title="读取版本账本" /></div>
          ) : visibleError && rows.length === 0 ? (
            <div className="store-listing-form__wide">
              <div className="store-fact-feedback store-fact-feedback--error" role="alert">{visibleError}</div>
              <button className="workspace-button workspace-button--secondary" onClick={onRetry} type="button"><ArrowsClockwise aria-hidden="true" size={16} />重试</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="store-listing-form__wide"><WorkspaceState description="当前店铺尚无已保存的 Listing 历史快照。" kind="empty" title="版本账本为空" /></div>
          ) : (
            <>
              <section aria-label="店铺版本账本列表" className="store-listing-version-list">
                <div className="store-listing-ledger-meta" role="status">已读取 {rows.length} 条历史快照</div>
                {rows.map((row) => (
                  <button
                    aria-label={`查看 ${row.asin} 的 ${row.versionLabel || '未命名版本'}`}
                    disabled={loadingMore}
                    aria-pressed={selected?.id === row.id}
                    className={`workspace-button ${selected?.id === row.id ? 'workspace-button--primary' : 'workspace-button--secondary'}`}
                    key={row.id}
                    onClick={() => onSelect(row.id)}
                    type="button"
                  >
                    <span className="store-fact-primary">
                      <strong>{row.asin} · {row.versionLabel || '未命名版本'}</strong>
                      <small>{row.createdAt || '时间未知'} · {listingSourceLabel(row.source)}</small>
                      <small>{row.changeSummary || '未填写变更说明'}</small>
                    </span>
                  </button>
                ))}
                {visibleError && <div className="store-fact-feedback store-fact-feedback--error" role="alert">{visibleError}</div>}
                {loadingMore && <p role="status">正在读取更多历史版本，请稍候；关闭账本可取消本次读取。</p>}
                {hasMore && (
                  <button
                    aria-busy={loadingMore || undefined}
                    className="workspace-button workspace-button--secondary"
                    disabled={loadingMore}
                    onClick={onLoadMore}
                    type="button"
                  >
                    <ArrowsClockwise aria-hidden="true" size={16} />{loadingMore ? '加载中…' : '加载更多历史'}
                  </button>
                )}
              </section>
              {selected && (
                <section aria-label="店铺版本账本快照" className="store-listing-version-snapshot">
                  <span className="store-fact-primary"><strong>ASIN / 历史对象</strong><small>{selected.asin} · {selected.listingContentId ? '已关联历史版本' : '已解除关联'}</small></span>
                  <span className="store-fact-primary"><strong>标题</strong><small>{selected.title || '未填写标题'}</small></span>
                  <span className="store-fact-primary"><strong>商品要点</strong><small>{selected.bullets.length > 0 ? selected.bullets.join('；') : '未填写商品要点'}</small></span>
                  <span className="store-fact-primary"><strong>后台搜索词</strong><small>{selected.backendTerms || '未填写后台搜索词'}</small></span>
                  <span className="store-fact-primary"><strong>来源与变更</strong><small>{listingSourceLabel(selected.source)} · {selected.changeSummary || '未填写变更说明'}</small></span>
                </section>
              )}
            </>
          )}
        </div>
        <footer><button className="workspace-button workspace-button--secondary" onClick={onClose} type="button">关闭</button></footer>
      </section>
    </div>
  );
}
