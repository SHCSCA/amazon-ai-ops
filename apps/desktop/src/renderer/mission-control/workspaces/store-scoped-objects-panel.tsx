import React, { useEffect, useMemo, useRef, useState } from 'react';
import { rendererRuntimeLog } from '../../runtime-log';
import { WorkspaceActionButton, createWorkspaceActionAdmission } from '../../components/workspace/action-feedback';
import { Archive } from '@phosphor-icons/react/dist/csr/Archive';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CalendarDots } from '@phosphor-icons/react/dist/csr/CalendarDots';
import { CaretLeft } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { NotePencil } from '@phosphor-icons/react/dist/csr/NotePencil';
import { Package } from '@phosphor-icons/react/dist/csr/Package';
import { PencilSimple } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import { X } from '@phosphor-icons/react/dist/csr/X';
import {
  canonicalizeAmazonAsin,
  inspectAmazonAsin,
  missionControlContextKey,
  type ProductCost,
  type StoreContextEnvelope,
  type StoreId,
} from '@amazon-ai-ops/shared-types';
import {
  PriorityDataTable,
  WorkbenchPanel,
  WorkspaceState,
  type PriorityDataTableColumn,
} from '../../components/workspace';
import { useOverlayFocusScope } from '../../components/workspace/overlay-focus-scope';
import { VersionedProductView, VersionedOperationEventView, ProductDraft, EventDraft, ProductMutationInput, OperationEventMutationInput, StoreObjectsRendererApi, ObjectsSubview, PendingAction, StoreScopedObjectsPanelProps, COST_FIELDS, PERCENT_FIELDS, EVENT_PAGE_SIZE, EVENT_TYPE_LABELS, EVENT_IMPACT_LABELS } from './store-objects-contracts';
import { operationEventIsArchived, operationEventTypeLabel, operationEventImpactLabel, paginateOperationEvents, resultBelongsToStore, responseBelongsToRequest, readApi, errorMessage, money, percent, ProductStatus, OperationEventStatus, operationEventNeedsReconciliation, operationEventReconciliationReason } from './store-objects-model';
import { buildProductCreateInput, buildProductUpdateInput, buildProductRestoreInput, buildEventCreateInput, buildEventUpdateInput, buildEventRestoreInput, buildCostPatch, parseNumber, parsePercent, emptyToUndefined, productDraft, eventDraft } from './store-objects-inputs';

export type { VersionedProductView } from './store-objects-contracts';
export type { VersionedOperationEventView } from './store-objects-contracts';
export type { ProductDraft } from './store-objects-contracts';
export type { EventDraft } from './store-objects-contracts';
export type { ObjectsSubview } from './store-objects-contracts';
export type { StoreScopedObjectsPanelProps } from './store-objects-contracts';
export { buildProductCreateInput } from './store-objects-inputs';
export { buildProductUpdateInput } from './store-objects-inputs';
export { buildProductRestoreInput } from './store-objects-inputs';
export { buildEventCreateInput } from './store-objects-inputs';
export { buildEventUpdateInput } from './store-objects-inputs';
export { buildEventRestoreInput } from './store-objects-inputs';
export { operationEventIsArchived } from './store-objects-model';
export { operationEventTypeLabel } from './store-objects-model';
export { operationEventImpactLabel } from './store-objects-model';
export { paginateOperationEvents } from './store-objects-model';
export { resultBelongsToStore } from './store-objects-model';
export { responseBelongsToRequest } from './store-objects-model';
export { operationEventNeedsReconciliation } from './store-objects-model';

export function StoreScopedObjectsPanel({ storeContext, fixedSubview }: StoreScopedObjectsPanelProps) {
  const [subview, setSubview] = useState<ObjectsSubview>('products');
  const [products, setProducts] = useState<VersionedProductView[]>([]);
  const [events, setEvents] = useState<VersionedOperationEventView[]>([]);
  const [search, setSearch] = useState('');
  const [includeArchivedProducts, setIncludeArchivedProducts] = useState(false);
  const [includeArchivedEvents, setIncludeArchivedEvents] = useState(false);
  const [eventPage, setEventPage] = useState(1);
  const [productEditor, setProductEditor] = useState<{ product: VersionedProductView | null; draft: ProductDraft } | null>(null);
  const [eventEditor, setEventEditor] = useState<{ event: VersionedOperationEventView | null; draft: EventDraft } | null>(null);
  const [confirmProductArchive, setConfirmProductArchive] = useState<VersionedProductView | null>(null);
  const [confirmEventArchive, setConfirmEventArchive] = useState<VersionedOperationEventView | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const currentAuthorityKey = useRef(authorityKey);
  const requestSequence = useRef(0);
  const mutationSequence = useRef(0);
  const epoch = useRef(0);
  const admission = useRef(createWorkspaceActionAdmission());
  if (currentAuthorityKey.current !== authorityKey) { epoch.current += 1; currentAuthorityKey.current = authorityKey; }
  admission.current.update(authorityKey);
  useEffect(() => () => { epoch.current += 1; }, []);
  const visibleSubview = fixedSubview ?? subview;
  const dialogOpen = Boolean(productEditor || eventEditor || confirmProductArchive || confirmEventArchive);
  const errorFeedback = error && <div className="store-object-feedback store-object-feedback--error" role="alert">{error}</div>;
  const dialogFocus = useOverlayFocusScope<HTMLDivElement, HTMLElement>({
    open: dialogOpen,
    dismissDisabled: busy,
    onDismiss: () => {
      setProductEditor(null);
      setEventEditor(null);
      setConfirmProductArchive(null);
      setConfirmEventArchive(null);
    },
  });

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN');
    if (!query) return products;
    return products.filter((product) => (
      `${product.asin} ${product.title} ${product.msku} ${product.sku}`
        .toLocaleLowerCase('zh-CN')
        .includes(query)
    ));
  }, [products, search]);
  const eventPageView = useMemo(
    () => paginateOperationEvents(events, eventPage),
    [eventPage, events],
  );

  async function loadObjects(context: StoreContextEnvelope, capturedKey: string, showBusy = true) {
    const capturedEpoch = epoch.current;
    const capturedSequence = ++requestSequence.current;
    const api = readApi();
    if (!api) {
      if (epoch.current === capturedEpoch && responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        requestSequence.current,
        capturedSequence,
      )) {
        setError('店铺对象生产接口未接入；未读取旧的无店铺隔离数据。');
        setProducts([]);
        setEvents([]);
      }
      return;
    }
    const release = showBusy ? admission.current.tryEnter() : undefined;
    if (showBusy && !release) return;
    if (showBusy) { setPending('load'); setPendingTarget(null); }
    setError(null);
    try {
      const [nextProducts, nextEvents] = await Promise.all([
        api.listStoreProducts(context, { includeArchived: includeArchivedProducts }),
        api.listStoreOperationEvents(context, { limit: 200, includeArchived: includeArchivedEvents }),
      ]);
      if (epoch.current !== capturedEpoch || !responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        requestSequence.current,
        capturedSequence,
      )) return;
      if (
        nextProducts.some((product) => !resultBelongsToStore(product, context))
        || nextEvents.some((event) => !resultBelongsToStore(event, context))
      ) throw new Error('Main 返回了不属于当前店铺的数据，已拒绝显示。');
      setProducts(nextProducts);
      setEvents(nextEvents);
      setFeedback(
        fixedSubview === 'events'
          ? `已读取 ${nextEvents.length} 条当前店铺运营事件。`
          : fixedSubview === 'products'
            ? `已读取 ${nextProducts.length} 个当前店铺产品。`
            : `已读取 ${nextProducts.length} 个产品与 ${nextEvents.length} 条运营事件。`,
      );
    } catch (loadError) {
      rendererRuntimeLog.error('renderer.store_objects_load_failed', { error: loadError });
      if (epoch.current !== capturedEpoch || !responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        requestSequence.current,
        capturedSequence,
      )) return;
      setProducts([]);
      setEvents([]);
      setError(errorMessage(loadError));
    } finally {
      release?.();
      if (showBusy && epoch.current === capturedEpoch && responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        requestSequence.current,
        capturedSequence,
      )) setPending(null);
    }
  }

  useEffect(() => {
    requestSequence.current += 1;
    mutationSequence.current += 1;
    setProducts([]);
    setEvents([]);
    setSearch('');
    setEventPage(1);
    setProductEditor(null);
    setEventEditor(null);
    setConfirmProductArchive(null);
    setConfirmEventArchive(null);
    setFeedback('');
    setError(null);
    setPending(null);
    if (!storeContext || !authorityKey) return;
    void loadObjects(storeContext, authorityKey);
    // 店铺、会话或业务日变化后丢弃旧响应，并清空当前编辑状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorityKey, includeArchivedProducts, includeArchivedEvents]);

  const runMutation = async <T,>(
    action: Exclude<PendingAction, 'load'>,
    operation: (api: StoreObjectsRendererApi, context: StoreContextEnvelope) => Promise<T>,
    targetId?: number,
  ): Promise<T | undefined> => {
    if (!storeContext || pending) return undefined;
    const api = readApi();
    if (!api) {
      setError('店铺对象生产接口未接入；写操作已阻断。');
      return undefined;
    }
    const release = admission.current.tryEnter();
    if (!release) return undefined;
    const capturedContext = storeContext;
    const capturedKey = missionControlContextKey(capturedContext);
    const capturedEpoch = epoch.current;
    const capturedSequence = ++mutationSequence.current;
    setPending(action);
    setPendingTarget(targetId ?? null);
    setError(null);
    setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (epoch.current !== capturedEpoch || !responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        mutationSequence.current,
        capturedSequence,
      )) return undefined;
      return result;
    } catch (mutationError) {
      rendererRuntimeLog.error('renderer.store_objects_operation_failed', { operation: action, error: mutationError });
      if (epoch.current === capturedEpoch && responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        mutationSequence.current,
        capturedSequence,
      )) setError(errorMessage(mutationError));
      return undefined;
    } finally {
      release();
      if (epoch.current === capturedEpoch && responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        mutationSequence.current,
        capturedSequence,
      )) setPending(null);
    }
  };

  const saveProduct = async () => {
    if (!productEditor || !storeContext) return;
    if (!inspectAmazonAsin(productEditor.draft.asin).valid) {
      setError('ASIN 必须是 10 位 ASCII 字母或数字。');
      return;
    }
    const saved = await runMutation('save-product', async (api, context) => {
      const result = productEditor.product
        ? await api.updateStoreProduct(context, buildProductUpdateInput(productEditor.product, productEditor.draft))
        : await api.createStoreProduct(context, buildProductCreateInput(productEditor.draft));
      if (!resultBelongsToStore(result, context)) throw new Error('Main 返回了错误店铺的产品写入结果。');
      return result;
    }, productEditor.product?.id);
    if (!saved) return;
    setProducts((current) => {
      const exists = current.some((item) => item.id === saved.id);
      return exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
    });
    setProductEditor(null);
    setFeedback(`${saved.asin} 已保存到当前店铺。`);
  };

  const archiveProduct = async () => {
    if (!confirmProductArchive) return;
    const target = confirmProductArchive;
    const archived = await runMutation('archive-product', async (api, context) => {
      const result = await api.archiveStoreProduct(context, {
        id: target.id,
        expectedRevision: target.revision,
      });
      if (!resultBelongsToStore(result, context)) throw new Error('Main 返回了错误店铺的产品归档结果。');
      return result;
    }, target.id);
    if (!archived) return;
    setProducts((current) => includeArchivedProducts
      ? current.map((item) => item.id === archived.id ? archived : item)
      : current.filter((item) => item.id !== archived.id));
    setConfirmProductArchive(null);
    setFeedback(`${archived.asin} 已可恢复归档。`);
  };

  const restoreProduct = async (target: VersionedProductView) => {
    const restored = await runMutation('restore-product', async (api, context) => {
      const result = await api.updateStoreProduct(context, {
        ...buildProductRestoreInput(target),
      });
      if (!resultBelongsToStore(result, context)) throw new Error('Main 返回了错误店铺的产品恢复结果。');
      return result;
    }, target.id);
    if (!restored) return;
    setProducts((current) => current.map((item) => item.id === restored.id ? restored : item));
    setFeedback(`${restored.asin} 已恢复为运行中。`);
  };

  const saveEvent = async () => {
    if (!eventEditor || !eventEditor.draft.title.trim()) {
      setError('事件标题不能为空。');
      return;
    }
    if (eventEditor.draft.asin.trim() && !inspectAmazonAsin(eventEditor.draft.asin).valid) {
      setError('事件 ASIN 必须是 10 位 ASCII 字母或数字，或留空表示全店。');
      return;
    }
    const saved = await runMutation('save-event', async (api, context) => {
      const result = eventEditor.event
        ? await api.updateStoreOperationEvent(context, buildEventUpdateInput(eventEditor.event, eventEditor.draft))
        : await api.createStoreOperationEvent(context, buildEventCreateInput(eventEditor.draft));
      if (!resultBelongsToStore(result, context)) throw new Error('Main 返回了错误店铺的运营事件写入结果。');
      return result;
    }, eventEditor.event?.id);
    if (!saved) return;
    setEvents((current) => {
      const exists = current.some((item) => item.id === saved.id);
      const next = exists ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current];
      return next.sort((left, right) => right.eventDate.localeCompare(left.eventDate) || right.id - left.id);
    });
    setEventPage(1);
    setEventEditor(null);
    setFeedback(`运营事件“${saved.title}”已写入当前店铺上下文。`);
  };

  const archiveEvent = async () => {
    if (!confirmEventArchive) return;
    const target = confirmEventArchive;
    const archived = await runMutation('archive-event', async (api, context) => {
      const result = await api.deleteStoreOperationEvent(context, {
        id: target.id,
        expectedRevision: target.revision,
      });
      if (
        result.id !== target.id
        || !operationEventIsArchived(result)
        || !resultBelongsToStore(result, context)
      ) throw new Error('运营事件归档回读不一致。');
      return result;
    }, target.id);
    if (!archived) return;
    setEvents((current) => includeArchivedEvents
      ? current.map((item) => item.id === archived.id ? archived : item)
      : current.filter((item) => item.id !== archived.id));
    setConfirmEventArchive(null);
    setFeedback(`运营事件“${target.title}”已归档；历史记录仍可检索和恢复。`);
  };

  const restoreEvent = async (target: VersionedOperationEventView) => {
    const restored = await runMutation('restore-event', async (api, context) => {
      const result = await api.updateStoreOperationEvent(context, buildEventRestoreInput(target));
      if (operationEventIsArchived(result) || !resultBelongsToStore(result, context)) {
        throw new Error('运营事件恢复回读不一致。');
      }
      return result;
    }, target.id);
    if (!restored) return;
    setEvents((current) => current.map((item) => item.id === restored.id ? restored : item));
    setFeedback(`运营事件“${restored.title}”已恢复到当前 AI 因果上下文。`);
  };

  if (!storeContext) {
    return (
      <WorkspaceState
        description="请先选择并确认店铺，确认后才会开放该店铺的产品与运营事件读写。"
        kind="blocked"
        title="尚未确认当前店铺"
      />
    );
  }

  const productColumns: Array<PriorityDataTableColumn<VersionedProductView>> = [
    {
      key: 'product',
      header: '产品',
      priority: 'anchor',
      width: '34%',
      cell: (product) => (
        <div className="store-object-identity">
          <span><Package aria-hidden="true" size={17} /></span>
          <span><strong>{product.asin}</strong><small>{product.asinValid === false ? '历史 ASIN 无效 · 只读待对账' : product.title || '未填写产品标题'}</small></span>
        </div>
      ),
    },
    {
      key: 'sku',
      header: 'MSKU / SKU',
      priority: 'supporting',
      width: '17%',
      cell: (product) => <span className="store-object-two-line"><strong>{product.msku || '—'}</strong><small>{product.sku || '—'}</small></span>,
    },
    {
      key: 'economics',
      header: '价格 / 成本',
      priority: 'primary',
      width: '16%',
      cell: (product) => <span className="store-object-two-line"><strong>{money(product.cost?.currentPrice)}</strong><small>采购 {money(product.cost?.purchaseCost)}</small></span>,
    },
    {
      key: 'target',
      header: '广告目标',
      priority: 'primary',
      width: '14%',
      cell: (product) => <span className="store-object-two-line"><strong>ACOS {percent(product.cost?.targetAcos)}</strong><small>TACOS {percent(product.cost?.targetTacos)}</small></span>,
    },
    {
      key: 'status',
      header: '状态',
      priority: 'primary',
      width: '10%',
      cell: (product) => <ProductStatus status={product.status} />,
    },
    {
      key: 'actions',
      header: '操作',
      priority: 'action',
      align: 'right',
      cell: (product) => (
        <div className="store-object-actions" role="group" aria-label={`${product.asin}产品操作`}>
          {product.status !== 'archived' ? (
            <>
              <WorkspaceActionButton disabledReason={product.asinValid === false ? '历史产品标识无效，当前只读；请先核对真实 ASIN 后重新建立产品。' : busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…"
                aria-label={`编辑 ${product.asin}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                disabled={busy || product.asinValid === false}
                onClick={() => { setError(null); setProductEditor({ product, draft: productDraft(product) }); }}
                title={product.asinValid === false ? '历史 ASIN 无效，需先完成数据对账' : '编辑产品、成本与目标'}
                type="button"
              ><PencilSimple aria-hidden="true" size={16} /></WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={product.asinValid === false ? '历史产品标识无效，当前只读；请先核对真实 ASIN 后重新建立产品。' : busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…"
                aria-label={`归档 ${product.asin}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                disabled={busy || product.asinValid === false}
                onClick={() => setConfirmProductArchive(product)}
                title={product.asinValid === false ? '历史 ASIN 无效，需先完成数据对账' : '可恢复归档'}
                type="button"
              ><Archive aria-hidden="true" size={16} /></WorkspaceActionButton>
            </>
          ) : (
            <WorkspaceActionButton disabledReason={product.asinValid === false ? '历史产品标识无效，当前只读；请先核对真实 ASIN 后重新建立产品。' : busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={pending === 'restore-product' && pendingTarget === product.id} busyLabel="恢复中…"

              aria-label={`恢复 ${product.asin}`}
              className="workspace-button workspace-button--secondary"
              disabled={busy || product.asinValid === false}
              onClick={() => void restoreProduct(product)}
              title="恢复到运行中"
              type="button"
            ><ArrowsClockwise aria-hidden="true" size={16} />恢复</WorkspaceActionButton>
          )}
        </div>
      ),
    },
  ];

  const eventColumns: Array<PriorityDataTableColumn<VersionedOperationEventView>> = [
    {
      key: 'date',
      header: '日期',
      priority: 'anchor',
      width: '13%',
      cell: (event) => <span className="store-object-event-date"><CalendarDots aria-hidden="true" size={16} />{event.eventDate}</span>,
    },
    {
      key: 'event',
      header: '运营事件',
      priority: 'primary',
      width: '36%',
      cell: (event) => <span className="store-object-two-line"><strong>{event.title} <OperationEventStatus event={event} /></strong><small>{event.notes || '无补充说明'}</small></span>,
    },
    {
      key: 'scope',
      header: '影响范围',
      priority: 'supporting',
      width: '18%',
      cell: (event) => <span className="store-object-two-line"><strong>{event.asin || '全店'}</strong><small>{event.campaignName || event.adGroupName || '店铺上下文'}</small></span>,
    },
    {
      key: 'type',
      header: '类型 / 预期',
      priority: 'primary',
      width: '17%',
      cell: (event) => <span className="store-object-two-line"><strong>{operationEventTypeLabel(event.eventType)}</strong><small>{operationEventImpactLabel(event.impactExpectation)}</small></span>,
    },
    {
      key: 'actions',
      header: '操作',
      priority: 'action',
      align: 'right',
      cell: (event) => (
        <div className="store-object-actions" role="group" aria-label={`${event.title}事件操作`}>
          {!operationEventIsArchived(event) ? (
            <>
              <WorkspaceActionButton disabledReason={operationEventNeedsReconciliation(event) ? operationEventReconciliationReason(event) : busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…"
                aria-label={`编辑 ${event.title}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                disabled={busy || operationEventNeedsReconciliation(event)}
                onClick={() => { setError(null); setEventEditor({ event, draft: eventDraft(storeContext.businessDate, event) }); }}
                title={operationEventReconciliationReason(event) || '编辑运营事件'}
                type="button"
              ><PencilSimple aria-hidden="true" size={16} /></WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={operationEventNeedsReconciliation(event) ? operationEventReconciliationReason(event) : busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…"
                aria-label={`归档 ${event.title}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                disabled={busy || operationEventNeedsReconciliation(event)}
                onClick={() => setConfirmEventArchive(event)}
                title={operationEventReconciliationReason(event) || '可恢复归档，不删除历史记录'}
                type="button"
              ><Archive aria-hidden="true" size={16} /></WorkspaceActionButton>
            </>
          ) : (
            <WorkspaceActionButton disabledReason={operationEventNeedsReconciliation(event) ? operationEventReconciliationReason(event) : busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={pending === 'restore-event' && pendingTarget === event.id} busyLabel="恢复中…"

              aria-label={`恢复 ${event.title}`}
              className="workspace-button workspace-button--secondary"
              disabled={busy || operationEventNeedsReconciliation(event)}
              onClick={() => void restoreEvent(event)}
              title={operationEventReconciliationReason(event) || '恢复到当前 AI 因果上下文'}
              type="button"
            ><ArrowsClockwise aria-hidden="true" size={16} />恢复</WorkspaceActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div
      className="store-scoped-objects"
      data-store-id={String(storeContext.storeId)}
      data-store-object-subview={visibleSubview}
    >
      {!fixedSubview && <div
        aria-label={fixedSubview ? '当前对象类型' : '对象类型'}
        className="store-object-tabs"
        data-store-object-subview={visibleSubview}
        role={fixedSubview ? 'note' : 'tablist'}
      >
        <button aria-selected={visibleSubview === 'products'} onClick={() => setSubview('products')} role="tab" type="button">
          <Package aria-hidden="true" size={16} />产品与成本 <span>{products.length}</span>
        </button>
        <button aria-selected={visibleSubview === 'events'} onClick={() => setSubview('events')} role="tab" type="button">
          <NotePencil aria-hidden="true" size={16} />运营事件 <span>{events.length}</span>
        </button>
        <span className="store-object-authority">当前店铺 · 美国站 / USD</span>
      </div>}

      {!dialogOpen && errorFeedback}
      {feedback && !error && <div className="store-object-feedback" role="status" aria-live="polite">{feedback}</div>}

      {visibleSubview === 'products' ? (
        <WorkbenchPanel
          className="store-object-panel"
          description="产品身份、成本、售价与广告目标均独立保存到当前店铺；归档不会删除历史事实。"
          status={<span>{filteredProducts.length} / {products.length} 个产品</span>}
          title="产品与经营目标"
          toolbar={(
            <>
              <label className="store-object-search"><span className="sr-only">查询产品</span><input onChange={(event) => setSearch(event.target.value)} placeholder="查询 ASIN / 标题 / SKU" value={search} /></label>
              <label className="store-object-toggle"><input checked={includeArchivedProducts} onChange={(event) => setIncludeArchivedProducts(event.target.checked)} type="checkbox" />包含已归档</label>
              <WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={pending === 'load'} busyLabel="读取中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => void loadObjects(storeContext, authorityKey)} type="button"><ArrowsClockwise aria-hidden="true" size={16} />{pending === 'load' ? '读取中…' : '刷新'}</WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary" data-action-priority="primary" disabled={busy} onClick={() => { setError(null); setProductEditor({ product: null, draft: productDraft() }); }} type="button"><Plus aria-hidden="true" size={16} />新建产品</WorkspaceActionButton>
            </>
          )}
        >
          <PriorityDataTable
            caption="当前店铺产品、成本与广告目标"
            columns={productColumns}
            emptyState={<WorkspaceState description="新建产品后，可在同一表单维护 USD 成本与广告目标。" kind={pending === 'load' ? 'loading' : 'empty'} title={pending === 'load' ? '正在读取当前店铺产品' : '当前店铺还没有产品'} />}
            getRowKey={(product) => product.id}
            rows={filteredProducts}
          />
        </WorkbenchPanel>
      ) : (
        <WorkbenchPanel
          className="store-object-panel"
          description="Coupon、Deal、改价、Listing 调整等运营动作会进入当前店铺的 AI 因果上下文；归档只退出当前分析，不删除历史事实。"
          status={<span>{events.length} 条{includeArchivedEvents ? '含历史' : '当前'}事件</span>}
          title={fixedSubview === 'events' ? '事件台账' : '运营事件'}
          toolbar={(
            <>
              <label className="store-object-toggle"><input checked={includeArchivedEvents} onChange={(event) => { setEventPage(1); setIncludeArchivedEvents(event.target.checked); }} type="checkbox" />查看已归档事件</label>
              <WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={pending === 'load'} busyLabel="读取中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => void loadObjects(storeContext, authorityKey)} type="button"><ArrowsClockwise aria-hidden="true" size={16} />{pending === 'load' ? '读取中…' : '刷新'}</WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--primary" data-action-priority="primary" disabled={busy} onClick={() => { setError(null); setEventEditor({ event: null, draft: eventDraft(storeContext.businessDate) }); }} type="button"><Plus aria-hidden="true" size={16} />记录事件</WorkspaceActionButton>
            </>
          )}
        >
          <PriorityDataTable
            caption="当前店铺运营事件"
            columns={eventColumns}
            emptyState={<WorkspaceState description="记录影响销量、转化或广告判断的真实运营动作。" kind={pending === 'load' ? 'loading' : 'empty'} title={pending === 'load' ? '正在读取当前店铺事件' : '当前店铺还没有运营事件'} />}
            getRowKey={(event) => event.id}
            rows={eventPageView.rows}
          />
          <nav aria-label="运营事件分页" className="store-object-pagination">
            <span>第 {eventPageView.page} / {eventPageView.pageCount} 页 · {eventPageView.start}–{eventPageView.end} / {events.length} 条</span>
            <div>
              <WorkspaceActionButton disabledReason={eventPageView.page <= 1 ? '已经是第一页。' : busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" aria-label="上一页运营事件" className="workspace-button workspace-button--secondary mission-control-icon-button" disabled={busy || eventPageView.page <= 1} onClick={() => setEventPage((page) => Math.max(1, page - 1))} type="button"><CaretLeft aria-hidden="true" size={16} /></WorkspaceActionButton>
              <WorkspaceActionButton disabledReason={eventPageView.page >= eventPageView.pageCount ? '已经是最后一页。' : busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" aria-label="下一页运营事件" className="workspace-button workspace-button--secondary mission-control-icon-button" disabled={busy || eventPageView.page >= eventPageView.pageCount} onClick={() => setEventPage((page) => Math.min(eventPageView.pageCount, page + 1))} type="button"><CaretRight aria-hidden="true" size={16} /></WorkspaceActionButton>
            </div>
          </nav>
        </WorkbenchPanel>
      )}

      {productEditor && (
        <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
          <section aria-labelledby="store-product-editor-title" aria-modal="true" className="mission-control-dialog store-object-editor" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
            <header>
              <div><span>当前店铺产品</span><h2 id="store-product-editor-title">{productEditor.product ? `编辑 ${productEditor.product.asin}` : '新建美国站产品'}</h2><p>站点固定 Amazon US，金额固定 USD；保存前本机安全进程会校验店铺范围和对象版本。</p></div>
              <WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" aria-label="关闭产品编辑器" className="mission-control-dialog__close" disabled={busy} onClick={() => setProductEditor(null)} type="button"><X aria-hidden="true" size={18} /></WorkspaceActionButton>
            </header>
            <div className="store-object-form store-object-form--product">{errorFeedback && <div className="store-object-form__wide">{errorFeedback}</div>}
              <label><span>ASIN *</span><input aria-describedby="store-object-asin-fixed" disabled={Boolean(productEditor.product)} onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, asin: e.target.value } } : current)} value={productEditor.draft.asin} />{productEditor.product && <small id="store-object-asin-fixed">ASIN 是产品身份，编辑时保持固定；需要其他产品时请新建产品。</small>}</label>
              <label><span>产品标题</span><input onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, title: e.target.value } } : current)} value={productEditor.draft.title} /></label>
              <label><span>Parent ASIN</span><input onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, parentAsin: e.target.value } } : current)} value={productEditor.draft.parentAsin} /></label>
              <label><span>MSKU</span><input onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, msku: e.target.value } } : current)} value={productEditor.draft.msku} /></label>
              <label><span>SKU</span><input onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, sku: e.target.value } } : current)} value={productEditor.draft.sku} /></label>
              <label><span>产品阶段</span><select onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, productStage: e.target.value } } : current)} value={productEditor.draft.productStage}><option value="keyword_exploration">关键词探索</option><option value="growth">增长</option><option value="profit">利润</option><option value="mature">成熟</option></select></label>
              <label><span>运行状态</span><select onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, status: e.target.value as ProductDraft['status'] } } : current)} value={productEditor.draft.status}><option value="active">运行中</option><option value="inactive">已停用</option></select></label>
              <div className="store-object-form__section"><strong>USD 成本与售价</strong><small>数字直接按美元保存</small></div>
              {([
                ['purchaseCost', '采购成本'], ['firstLegCost', '头程'], ['fbaFee', 'FBA 费用'], ['storageFee', '仓储费'], ['otherCost', '其他成本'], ['currentPrice', '当前售价'], ['minPrice', '最低可接受价'],
              ] as const).map(([field, label]) => <label key={field}><span>{label} (USD)</span><input min="0" onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, [field]: e.target.value } } : current)} step="0.01" type="number" value={productEditor.draft[field]} /></label>)}
              <div className="store-object-form__section"><strong>费率与广告目标</strong><small>界面按百分比填写，保存时自动换算，无需手动输入小数</small></div>
              {([
                ['referralFeeRate', '推荐费率'], ['targetNetMargin', '目标净利率'], ['targetAcos', '目标 ACOS'], ['targetTacos', '目标 TACOS'],
              ] as const).map(([field, label]) => <label key={field}><span>{label} (%)</span><input max="100" min={field === 'targetNetMargin' ? '-100' : '0'} onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, [field]: e.target.value } } : current)} step="0.1" type="number" value={productEditor.draft[field]} /></label>)}
            </div>
            <footer><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setProductEditor(null)} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={pending === 'save-product'} busyLabel="保存中…"  className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void saveProduct()} type="button"><Check aria-hidden="true" size={16} />{pending === 'save-product' ? '保存中…' : '保存产品'}</WorkspaceActionButton></footer>
          </section>
        </div>
      )}

      {eventEditor && (
        <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}>
          <section aria-labelledby="store-event-editor-title" aria-modal="true" className="mission-control-dialog store-object-editor" ref={dialogFocus.surfaceRef} tabIndex={-1} role="dialog">
            <header><div><span>经营事件上下文</span><h2 id="store-event-editor-title">{eventEditor.event ? '编辑运营事件' : '记录运营事件'}</h2><p>只写入当前店铺；可限定到 产品 ASIN、广告活动或广告组。</p></div><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" aria-label="关闭事件编辑器" className="mission-control-dialog__close" disabled={busy} onClick={() => setEventEditor(null)} type="button"><X aria-hidden="true" size={18} /></WorkspaceActionButton></header>
            <div className="store-object-form">{errorFeedback && <div className="store-object-form__wide">{errorFeedback}</div>}
              <label><span>事件日期 *</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, eventDate: e.target.value } } : current)} type="date" value={eventEditor.draft.eventDate} /></label>
              <label className="store-object-form__wide"><span>事件标题 *</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, title: e.target.value } } : current)} value={eventEditor.draft.title} /></label>
              <label><span>事件类型</span><select onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, eventType: e.target.value } } : current)} value={eventEditor.draft.eventType}><option value="manual_note">运营备注</option><option value="coupon">Coupon</option><option value="deal">Deal</option><option value="price_change">改价</option><option value="listing_change">Listing 调整</option><option value="inventory_issue">库存异常</option><option value="external_traffic">站外流量</option></select></label>
              <label><span>影响预期</span><select onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, impactExpectation: e.target.value } } : current)} value={eventEditor.draft.impactExpectation}><option value="unknown">待观察</option><option value="conversion_up">转化上升</option><option value="conversion_down">转化下降</option><option value="traffic_up">流量上升</option><option value="traffic_down">流量下降</option><option value="acos_up">ACOS 上升</option><option value="acos_down">ACOS 下降</option></select></label>
              <label><span>ASIN</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, asin: e.target.value } } : current)} placeholder="留空表示全店" value={eventEditor.draft.asin} /></label>
              <label><span>Campaign</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, campaignName: e.target.value } } : current)} value={eventEditor.draft.campaignName} /></label>
              <label><span>广告组</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, adGroupName: e.target.value } } : current)} value={eventEditor.draft.adGroupName} /></label>
              <label className="store-object-form__wide"><span>备注</span><textarea onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, notes: e.target.value } } : current)} rows={4} value={eventEditor.draft.notes} /></label>
            </div>
            <footer><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setEventEditor(null)} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={pending === 'save-event'} busyLabel="保存中…"  className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void saveEvent()} type="button"><Check aria-hidden="true" size={16} />{pending === 'save-event' ? '保存中…' : '保存事件'}</WorkspaceActionButton></footer>
          </section>
        </div>
      )}

      {confirmProductArchive && (
        <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}><section aria-labelledby="store-product-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" ref={dialogFocus.surfaceRef} tabIndex={-1} role="alertdialog">{errorFeedback}<header><div><span>归档产品</span><h2 id="store-product-archive-title">归档 {confirmProductArchive.asin}？</h2><p>产品会从默认列表隐藏，但历史数据、事件、决策与执行证据仍保留。</p></div></header><footer><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setConfirmProductArchive(null)} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={pending === 'archive-product'} busyLabel="归档中…"  className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archiveProduct()} type="button"><Archive aria-hidden="true" size={16} />{pending === 'archive-product' ? '归档中…' : '确认归档'}</WorkspaceActionButton></footer></section></div>
      )}

      {confirmEventArchive && (
        <div className="mission-control-dialog-backdrop" ref={dialogFocus.overlayRootRef}><section aria-labelledby="store-event-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" ref={dialogFocus.surfaceRef} tabIndex={-1} role="alertdialog">{errorFeedback}<header><div><span>归档运营事件</span><h2 id="store-event-archive-title">归档“{confirmEventArchive.title}”？</h2><p>事件会退出当前 AI 因果上下文，但不会被删除；之后可在“查看已归档事件”中精准检索并恢复。本机安全进程会通过版本校验防止覆盖并发修改。</p></div></header><footer><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={false} busyLabel="处理中…" className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setConfirmEventArchive(null)} type="button">取消</WorkspaceActionButton><WorkspaceActionButton disabledReason={busy ? '当前店铺对象操作正在处理，请等待完成后再操作。' : '请核对当前对象状态。'} busy={pending === 'archive-event'} busyLabel="归档中…"  className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archiveEvent()} type="button"><Archive aria-hidden="true" size={16} />{pending === 'archive-event' ? '归档中…' : '确认归档'}</WorkspaceActionButton></footer></section></div>
      )}
    </div>
  );
}
