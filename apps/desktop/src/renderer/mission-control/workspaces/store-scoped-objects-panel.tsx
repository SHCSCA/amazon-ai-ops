import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowsClockwise,
  CalendarDots,
  CaretLeft,
  CaretRight,
  Check,
  NotePencil,
  Package,
  PencilSimple,
  Plus,
  X,
} from '@phosphor-icons/react';
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

export type VersionedProductView = {
  id: number;
  storeId: StoreId;
  marketplace_code: string;
  store_name: string;
  asin: string;
  asinValid: boolean;
  parent_asin: string;
  msku: string;
  sku: string;
  title: string;
  product_stage: string;
  status: string;
  created_at: string;
  updated_at: string;
  cost?: ProductCost;
  revision: string;
};

export type VersionedOperationEventView = {
  id: number;
  storeId: StoreId;
  eventDate: string;
  storeName: string;
  marketplaceCode: string;
  asin?: string;
  asinValid: boolean;
  campaignName?: string;
  adGroupName?: string;
  eventType: string;
  title: string;
  impactExpectation?: string;
  notes?: string;
  evidenceArtifactId?: string;
  evidenceRefValid: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  archiveRevision: number;
  revision: string;
};

export type ProductDraft = {
  asin: string;
  parentAsin: string;
  msku: string;
  sku: string;
  title: string;
  productStage: string;
  status: 'active' | 'inactive';
  purchaseCost: string;
  firstLegCost: string;
  fbaFee: string;
  referralFeeRate: string;
  storageFee: string;
  otherCost: string;
  currentPrice: string;
  minPrice: string;
  targetNetMargin: string;
  targetAcos: string;
  targetTacos: string;
};

export type EventDraft = {
  eventDate: string;
  title: string;
  eventType: string;
  impactExpectation: string;
  asin: string;
  campaignName: string;
  adGroupName: string;
  notes: string;
};

type ProductMutationInput = {
  id: number;
  expectedRevision: string;
  patch: Record<string, unknown>;
  cost?: Record<string, number>;
};

type OperationEventMutationInput = {
  id: number;
  expectedRevision: string;
  patch: Record<string, unknown>;
};

type StoreObjectsRendererApi = {
  listStoreProducts(context: StoreContextEnvelope, input?: { includeArchived?: boolean }): Promise<VersionedProductView[]>;
  createStoreProduct(context: StoreContextEnvelope, input: Record<string, unknown>): Promise<VersionedProductView>;
  updateStoreProduct(context: StoreContextEnvelope, input: ProductMutationInput): Promise<VersionedProductView>;
  archiveStoreProduct(context: StoreContextEnvelope, input: { id: number; expectedRevision: string }): Promise<VersionedProductView>;
  listStoreOperationEvents(context: StoreContextEnvelope, input?: { limit?: number; includeArchived?: boolean }): Promise<VersionedOperationEventView[]>;
  createStoreOperationEvent(context: StoreContextEnvelope, input: Record<string, unknown>): Promise<VersionedOperationEventView>;
  updateStoreOperationEvent(context: StoreContextEnvelope, input: OperationEventMutationInput): Promise<VersionedOperationEventView>;
  deleteStoreOperationEvent(context: StoreContextEnvelope, input: { id: number; expectedRevision: string }): Promise<VersionedOperationEventView>;
};

export type ObjectsSubview = 'products' | 'events';
type PendingAction = 'load' | 'save-product' | 'archive-product' | 'restore-product' | 'save-event' | 'archive-event' | 'restore-event';

export type StoreScopedObjectsPanelProps = {
  storeContext: StoreContextEnvelope | null;
  fixedSubview?: ObjectsSubview;
};

const COST_FIELDS = [
  'purchaseCost',
  'firstLegCost',
  'fbaFee',
  'storageFee',
  'otherCost',
  'currentPrice',
  'minPrice',
] as const;

const PERCENT_FIELDS = [
  'referralFeeRate',
  'targetNetMargin',
  'targetAcos',
  'targetTacos',
] as const;

export function buildProductCreateInput(draft: ProductDraft): Record<string, unknown> {
  return {
    asin: canonicalizeAmazonAsin(draft.asin),
    parentAsin: draft.parentAsin.trim(),
    msku: draft.msku.trim(),
    sku: draft.sku.trim(),
    title: draft.title.trim(),
    productStage: draft.productStage.trim(),
    status: draft.status,
    marketplace: 'US',
    currency: 'USD',
    cost: buildCostPatch(draft),
  };
}

export function buildProductUpdateInput(
  product: VersionedProductView,
  draft: ProductDraft,
): ProductMutationInput {
  return {
    id: product.id,
    expectedRevision: product.revision,
    patch: {
      parentAsin: draft.parentAsin.trim(),
      msku: draft.msku.trim(),
      sku: draft.sku.trim(),
      title: draft.title.trim(),
      productStage: draft.productStage.trim(),
      status: draft.status,
      marketplace: 'US',
      currency: 'USD',
    },
    cost: buildCostPatch(draft),
  };
}

export function buildProductRestoreInput(product: VersionedProductView): ProductMutationInput {
  return {
    id: product.id,
    expectedRevision: product.revision,
    patch: { status: 'active' },
  };
}

export function buildEventCreateInput(draft: EventDraft): Record<string, unknown> {
  const eventAsin = draft.asin.trim();
  return {
    eventDate: draft.eventDate,
    title: draft.title.trim(),
    eventType: draft.eventType,
    impactExpectation: draft.impactExpectation || 'unknown',
    asin: eventAsin ? canonicalizeAmazonAsin(eventAsin) : undefined,
    campaignName: emptyToUndefined(draft.campaignName.trim()),
    adGroupName: emptyToUndefined(draft.adGroupName.trim()),
    notes: emptyToUndefined(draft.notes.trim()),
    marketplace: 'US',
    currency: 'USD',
  };
}

export function buildEventUpdateInput(
  event: VersionedOperationEventView,
  draft: EventDraft,
): OperationEventMutationInput {
  return {
    id: event.id,
    expectedRevision: event.revision,
    patch: buildEventCreateInput(draft),
  };
}

export function buildEventRestoreInput(
  event: VersionedOperationEventView,
): OperationEventMutationInput {
  return {
    id: event.id,
    expectedRevision: event.revision,
    patch: { archived: false },
  };
}

export function operationEventIsArchived(event: VersionedOperationEventView): boolean {
  return Boolean(event.archivedAt);
}

const EVENT_PAGE_SIZE = 6;

const EVENT_TYPE_LABELS: Record<string, string> = {
  manual_note: '运营备注',
  coupon: 'Coupon',
  deal: 'Deal',
  price_change: '改价',
  listing_change: 'Listing 调整',
  inventory_issue: '库存异常',
  external_traffic: '站外流量',
};

const EVENT_IMPACT_LABELS: Record<string, string> = {
  unknown: '待观察',
  conversion_up: '转化上升',
  conversion_down: '转化下降',
  traffic_up: '流量上升',
  traffic_down: '流量下降',
  acos_up: 'ACOS 上升',
  acos_down: 'ACOS 下降',
  watch: '待观察',
};

export function operationEventTypeLabel(value: string): string {
  return EVENT_TYPE_LABELS[value] ?? value.replaceAll('_', ' ');
}

export function operationEventImpactLabel(value?: string): string {
  if (!value) return '待观察';
  return EVENT_IMPACT_LABELS[value] ?? value.replaceAll('_', ' ');
}

export function paginateOperationEvents(
  events: readonly VersionedOperationEventView[],
  requestedPage: number,
  pageSize = EVENT_PAGE_SIZE,
) {
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize > 0 ? pageSize : EVENT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(events.length / safePageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
  const offset = (page - 1) * safePageSize;
  return {
    page,
    pageCount,
    start: events.length === 0 ? 0 : offset + 1,
    end: Math.min(offset + safePageSize, events.length),
    rows: events.slice(offset, offset + safePageSize),
  };
}

export function resultBelongsToStore(
  value: { storeId: StoreId },
  context: StoreContextEnvelope,
): boolean {
  return String(value.storeId) === String(context.storeId);
}

export function responseBelongsToRequest(
  currentAuthorityKey: string,
  capturedAuthorityKey: string,
  currentSequence: number,
  capturedSequence: number,
): boolean {
  return currentAuthorityKey === capturedAuthorityKey
    && currentSequence === capturedSequence;
}

function buildCostPatch(draft: ProductDraft): Record<string, number> {
  const cost: Record<string, number> = {};
  for (const field of COST_FIELDS) cost[field] = parseNumber(draft[field], field);
  for (const field of PERCENT_FIELDS) cost[field] = parsePercent(draft[field], field);
  return cost;
}

function parseNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} 必须是不小于 0 的数字。`);
  return parsed;
}

function parsePercent(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < (label === 'targetNetMargin' ? -100 : 0) || parsed > 100) {
    throw new Error(`${label} 必须在 ${label === 'targetNetMargin' ? '-100' : '0'}% 到 100% 之间。`);
  }
  return parsed / 100;
}

function emptyToUndefined(value: string): string | undefined {
  return value || undefined;
}

function productDraft(product?: VersionedProductView | null): ProductDraft {
  const cost = product?.cost;
  return {
    asin: product?.asin ?? '',
    parentAsin: product?.parent_asin ?? '',
    msku: product?.msku ?? '',
    sku: product?.sku ?? '',
    title: product?.title ?? '',
    productStage: product?.product_stage ?? 'keyword_exploration',
    status: product?.status === 'inactive' ? 'inactive' : 'active',
    purchaseCost: String(cost?.purchaseCost ?? 0),
    firstLegCost: String(cost?.firstLegCost ?? 0),
    fbaFee: String(cost?.fbaFee ?? 0),
    referralFeeRate: String((cost?.referralFeeRate ?? 0.15) * 100),
    storageFee: String(cost?.storageFee ?? 0),
    otherCost: String(cost?.otherCost ?? 0),
    currentPrice: String(cost?.currentPrice ?? 0),
    minPrice: String(cost?.minPrice ?? 0),
    targetNetMargin: String((cost?.targetNetMargin ?? 0) * 100),
    targetAcos: String((cost?.targetAcos ?? 0) * 100),
    targetTacos: String((cost?.targetTacos ?? 0) * 100),
  };
}

function eventDraft(businessDate: string, event?: VersionedOperationEventView | null): EventDraft {
  return {
    eventDate: event?.eventDate ?? businessDate,
    title: event?.title ?? '',
    eventType: event?.eventType ?? 'manual_note',
    impactExpectation: event?.impactExpectation ?? 'unknown',
    asin: event?.asin ?? '',
    campaignName: event?.campaignName ?? '',
    adGroupName: event?.adGroupName ?? '',
    notes: event?.notes ?? '',
  };
}

function readApi(): StoreObjectsRendererApi | null {
  const candidate = (window as unknown as { electronAPI?: Partial<StoreObjectsRendererApi> }).electronAPI;
  if (!candidate) return null;
  const required = [
    'listStoreProducts',
    'createStoreProduct',
    'updateStoreProduct',
    'archiveStoreProduct',
    'listStoreOperationEvents',
    'createStoreOperationEvent',
    'updateStoreOperationEvent',
    'deleteStoreOperationEvent',
  ] as const;
  return required.every((key) => typeof candidate[key] === 'function')
    ? candidate as StoreObjectsRendererApi
    : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return '操作未完成，请重新读取当前店铺后再试。';
}

function money(value?: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value ?? 0);
}

function percent(value?: number): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

function ProductStatus({ status }: { status: string }) {
  const label = status === 'archived' ? '已归档' : status === 'inactive' ? '已停用' : '运行中';
  return <span className="store-object-status" data-object-status={status}>{label}</span>;
}

function OperationEventStatus({ event }: { event: VersionedOperationEventView }) {
  if (operationEventNeedsReconciliation(event)) {
    return <span className="store-object-status" data-object-status="reconcile">待对账 · 只读</span>;
  }
  return operationEventIsArchived(event)
    ? <span className="store-object-status" data-object-status="archived">已归档</span>
    : null;
}

export function operationEventNeedsReconciliation(event: VersionedOperationEventView): boolean {
  return event.asinValid === false || event.evidenceRefValid === false;
}

function operationEventReconciliationReason(event: VersionedOperationEventView): string {
  const reasons = [
    event.asinValid === false ? '历史 ASIN 无效' : '',
    event.evidenceRefValid === false ? '历史证据引用未通过当前店铺 Artifact 校验' : '',
  ].filter(Boolean);
  return reasons.length > 0 ? `${reasons.join('；')}，完成对账前禁止修改、归档或恢复。` : '';
}

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
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const authorityKey = storeContext ? missionControlContextKey(storeContext) : '';
  const currentAuthorityKey = useRef(authorityKey);
  const requestSequence = useRef(0);
  const mutationSequence = useRef(0);
  currentAuthorityKey.current = authorityKey;
  const visibleSubview = fixedSubview ?? subview;

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
    const capturedSequence = ++requestSequence.current;
    const api = readApi();
    if (!api) {
      if (responseBelongsToRequest(
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
    if (showBusy) setPending('load');
    setError(null);
    try {
      const [nextProducts, nextEvents] = await Promise.all([
        api.listStoreProducts(context, { includeArchived: includeArchivedProducts }),
        api.listStoreOperationEvents(context, { limit: 200, includeArchived: includeArchivedEvents }),
      ]);
      if (!responseBelongsToRequest(
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
      if (!responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        requestSequence.current,
        capturedSequence,
      )) return;
      setProducts([]);
      setEvents([]);
      setError(errorMessage(loadError));
    } finally {
      if (showBusy && responseBelongsToRequest(
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
    // The authority key includes session generation and business date. Any
    // response from the previous key is discarded by currentAuthorityKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorityKey, includeArchivedProducts, includeArchivedEvents]);

  const runMutation = async <T,>(
    action: Exclude<PendingAction, 'load'>,
    operation: (api: StoreObjectsRendererApi, context: StoreContextEnvelope) => Promise<T>,
  ): Promise<T | undefined> => {
    if (!storeContext || pending) return undefined;
    const api = readApi();
    if (!api) {
      setError('店铺对象生产接口未接入；写操作已阻断。');
      return undefined;
    }
    const capturedContext = storeContext;
    const capturedKey = missionControlContextKey(capturedContext);
    const capturedSequence = ++mutationSequence.current;
    setPending(action);
    setError(null);
    setFeedback('');
    try {
      const result = await operation(api, capturedContext);
      if (!responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        mutationSequence.current,
        capturedSequence,
      )) return undefined;
      return result;
    } catch (mutationError) {
      if (responseBelongsToRequest(
        currentAuthorityKey.current,
        capturedKey,
        mutationSequence.current,
        capturedSequence,
      )) setError(errorMessage(mutationError));
      return undefined;
    } finally {
      if (responseBelongsToRequest(
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
    });
    if (!saved) return;
    setProducts((current) => {
      const exists = current.some((item) => item.id === saved.id);
      return exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
    });
    setProductEditor(null);
    setFeedback(`${saved.asin} 已保存到当前店铺数据域。`);
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
    });
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
    });
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
    });
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
    });
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
    });
    if (!restored) return;
    setEvents((current) => current.map((item) => item.id === restored.id ? restored : item));
    setFeedback(`运营事件“${restored.title}”已恢复到当前 AI 因果上下文。`);
  };

  if (!storeContext) {
    return (
      <WorkspaceState
        description="等待 Main 确认当前店铺后，才会开放产品与运营事件的店铺级读写。"
        kind="blocked"
        title="尚无权威 StoreContext"
      />
    );
  }

  const busy = pending !== null;
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
              <button
                aria-label={`编辑 ${product.asin}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                disabled={busy || product.asinValid === false}
                onClick={() => { setError(null); setProductEditor({ product, draft: productDraft(product) }); }}
                title={product.asinValid === false ? '历史 ASIN 无效，需先完成数据对账' : '编辑产品、成本与目标'}
                type="button"
              ><PencilSimple aria-hidden="true" size={16} /></button>
              <button
                aria-label={`归档 ${product.asin}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                disabled={busy || product.asinValid === false}
                onClick={() => setConfirmProductArchive(product)}
                title={product.asinValid === false ? '历史 ASIN 无效，需先完成数据对账' : '可恢复归档'}
                type="button"
              ><Archive aria-hidden="true" size={16} /></button>
            </>
          ) : (
            <button
              aria-busy={pending === 'restore-product' || undefined}
              aria-label={`恢复 ${product.asin}`}
              className="workspace-button workspace-button--secondary"
              disabled={busy || product.asinValid === false}
              onClick={() => void restoreProduct(product)}
              title="恢复到运行中"
              type="button"
            ><ArrowsClockwise aria-hidden="true" size={16} />恢复</button>
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
              <button
                aria-label={`编辑 ${event.title}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                disabled={busy || operationEventNeedsReconciliation(event)}
                onClick={() => { setError(null); setEventEditor({ event, draft: eventDraft(storeContext.businessDate, event) }); }}
                title={operationEventReconciliationReason(event) || '编辑运营事件'}
                type="button"
              ><PencilSimple aria-hidden="true" size={16} /></button>
              <button
                aria-label={`归档 ${event.title}`}
                className="workspace-button workspace-button--secondary mission-control-icon-button"
                disabled={busy || operationEventNeedsReconciliation(event)}
                onClick={() => setConfirmEventArchive(event)}
                title={operationEventReconciliationReason(event) || '可恢复归档，不删除历史记录'}
                type="button"
              ><Archive aria-hidden="true" size={16} /></button>
            </>
          ) : (
            <button
              aria-busy={pending === 'restore-event' || undefined}
              aria-label={`恢复 ${event.title}`}
              className="workspace-button workspace-button--secondary"
              disabled={busy || operationEventNeedsReconciliation(event)}
              onClick={() => void restoreEvent(event)}
              title={operationEventReconciliationReason(event) || '恢复到当前 AI 因果上下文'}
              type="button"
            ><ArrowsClockwise aria-hidden="true" size={16} />恢复</button>
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
        <span className="store-object-authority">{String(storeContext.storeId)} · US / USD</span>
      </div>}

      {error && <div className="store-object-feedback store-object-feedback--error" role="alert">{error}</div>}
      {feedback && !error && <div className="store-object-feedback" role="status" aria-live="polite">{feedback}</div>}

      {visibleSubview === 'products' ? (
        <WorkbenchPanel
          className="store-object-panel"
          description="产品身份、成本、售价与广告目标均写入当前店铺数据域；归档不会删除历史事实。"
          status={<span>{filteredProducts.length} / {products.length} 个产品</span>}
          title="产品与经营目标"
          toolbar={(
            <>
              <label className="store-object-search"><span className="sr-only">查询产品</span><input onChange={(event) => setSearch(event.target.value)} placeholder="查询 ASIN / 标题 / SKU" value={search} /></label>
              <label className="store-object-toggle"><input checked={includeArchivedProducts} onChange={(event) => setIncludeArchivedProducts(event.target.checked)} type="checkbox" />包含已归档</label>
              <button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => void loadObjects(storeContext, authorityKey)} type="button"><ArrowsClockwise aria-hidden="true" size={16} />{pending === 'load' ? '读取中…' : '刷新'}</button>
              <button className="workspace-button workspace-button--primary" disabled={busy} onClick={() => { setError(null); setProductEditor({ product: null, draft: productDraft() }); }} type="button"><Plus aria-hidden="true" size={16} />新建产品</button>
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
              <button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => void loadObjects(storeContext, authorityKey)} type="button"><ArrowsClockwise aria-hidden="true" size={16} />{pending === 'load' ? '读取中…' : '刷新'}</button>
              <button className="workspace-button workspace-button--primary" disabled={busy} onClick={() => { setError(null); setEventEditor({ event: null, draft: eventDraft(storeContext.businessDate) }); }} type="button"><Plus aria-hidden="true" size={16} />记录事件</button>
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
              <button aria-label="上一页运营事件" className="workspace-button workspace-button--secondary mission-control-icon-button" disabled={busy || eventPageView.page <= 1} onClick={() => setEventPage((page) => Math.max(1, page - 1))} type="button"><CaretLeft aria-hidden="true" size={16} /></button>
              <button aria-label="下一页运营事件" className="workspace-button workspace-button--secondary mission-control-icon-button" disabled={busy || eventPageView.page >= eventPageView.pageCount} onClick={() => setEventPage((page) => Math.min(eventPageView.pageCount, page + 1))} type="button"><CaretRight aria-hidden="true" size={16} /></button>
            </div>
          </nav>
        </WorkbenchPanel>
      )}

      {productEditor && (
        <div className="mission-control-dialog-backdrop">
          <section aria-labelledby="store-product-editor-title" aria-modal="true" className="mission-control-dialog store-object-editor" role="dialog">
            <header>
              <div><span>STORE-SCOPED PRODUCT</span><h2 id="store-product-editor-title">{productEditor.product ? `编辑 ${productEditor.product.asin}` : '新建美国站产品'}</h2><p>站点固定 Amazon US，金额固定 USD；保存前 Main 会校验店铺上下文和对象 revision。</p></div>
              <button aria-label="关闭产品编辑器" className="mission-control-dialog__close" disabled={busy} onClick={() => setProductEditor(null)} type="button"><X aria-hidden="true" size={18} /></button>
            </header>
            <div className="store-object-form store-object-form--product">
              <label><span>ASIN *</span><input autoFocus disabled={Boolean(productEditor.product)} onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, asin: e.target.value } } : current)} value={productEditor.draft.asin} /></label>
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
              <div className="store-object-form__section"><strong>费率与广告目标</strong><small>界面输入百分比，Main 保存为 0–1 比率</small></div>
              {([
                ['referralFeeRate', '推荐费率'], ['targetNetMargin', '目标净利率'], ['targetAcos', '目标 ACOS'], ['targetTacos', '目标 TACOS'],
              ] as const).map(([field, label]) => <label key={field}><span>{label} (%)</span><input max="100" min={field === 'targetNetMargin' ? '-100' : '0'} onChange={(e) => setProductEditor((current) => current ? { ...current, draft: { ...current.draft, [field]: e.target.value } } : current)} step="0.1" type="number" value={productEditor.draft[field]} /></label>)}
            </div>
            <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setProductEditor(null)} type="button">取消</button><button aria-busy={pending === 'save-product' || undefined} className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void saveProduct()} type="button"><Check aria-hidden="true" size={16} />{pending === 'save-product' ? '保存中…' : '保存产品'}</button></footer>
          </section>
        </div>
      )}

      {eventEditor && (
        <div className="mission-control-dialog-backdrop">
          <section aria-labelledby="store-event-editor-title" aria-modal="true" className="mission-control-dialog store-object-editor" role="dialog">
            <header><div><span>CAUSAL CONTEXT</span><h2 id="store-event-editor-title">{eventEditor.event ? '编辑运营事件' : '记录运营事件'}</h2><p>只写入当前店铺；可限定到 ASIN、Campaign 或广告组。</p></div><button aria-label="关闭事件编辑器" className="mission-control-dialog__close" disabled={busy} onClick={() => setEventEditor(null)} type="button"><X aria-hidden="true" size={18} /></button></header>
            <div className="store-object-form">
              <label><span>事件日期 *</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, eventDate: e.target.value } } : current)} type="date" value={eventEditor.draft.eventDate} /></label>
              <label className="store-object-form__wide"><span>事件标题 *</span><input autoFocus onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, title: e.target.value } } : current)} value={eventEditor.draft.title} /></label>
              <label><span>事件类型</span><select onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, eventType: e.target.value } } : current)} value={eventEditor.draft.eventType}><option value="manual_note">运营备注</option><option value="coupon">Coupon</option><option value="deal">Deal</option><option value="price_change">改价</option><option value="listing_change">Listing 调整</option><option value="inventory_issue">库存异常</option><option value="external_traffic">站外流量</option></select></label>
              <label><span>影响预期</span><select onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, impactExpectation: e.target.value } } : current)} value={eventEditor.draft.impactExpectation}><option value="unknown">待观察</option><option value="conversion_up">转化上升</option><option value="conversion_down">转化下降</option><option value="traffic_up">流量上升</option><option value="traffic_down">流量下降</option><option value="acos_up">ACOS 上升</option><option value="acos_down">ACOS 下降</option></select></label>
              <label><span>ASIN</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, asin: e.target.value } } : current)} placeholder="留空表示全店" value={eventEditor.draft.asin} /></label>
              <label><span>Campaign</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, campaignName: e.target.value } } : current)} value={eventEditor.draft.campaignName} /></label>
              <label><span>广告组</span><input onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, adGroupName: e.target.value } } : current)} value={eventEditor.draft.adGroupName} /></label>
              <label className="store-object-form__wide"><span>备注</span><textarea onChange={(e) => setEventEditor((current) => current ? { ...current, draft: { ...current.draft, notes: e.target.value } } : current)} rows={4} value={eventEditor.draft.notes} /></label>
            </div>
            <footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setEventEditor(null)} type="button">取消</button><button aria-busy={pending === 'save-event' || undefined} className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void saveEvent()} type="button"><Check aria-hidden="true" size={16} />{pending === 'save-event' ? '保存中…' : '保存事件'}</button></footer>
          </section>
        </div>
      )}

      {confirmProductArchive && (
        <div className="mission-control-dialog-backdrop"><section aria-labelledby="store-product-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>ARCHIVE PRODUCT</span><h2 id="store-product-archive-title">归档 {confirmProductArchive.asin}？</h2><p>产品会从默认列表隐藏，但历史数据、事件、决策与执行证据仍保留。</p></div></header><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setConfirmProductArchive(null)} type="button">取消</button><button aria-busy={pending === 'archive-product' || undefined} className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archiveProduct()} type="button"><Archive aria-hidden="true" size={16} />{pending === 'archive-product' ? '归档中…' : '确认归档'}</button></footer></section></div>
      )}

      {confirmEventArchive && (
        <div className="mission-control-dialog-backdrop"><section aria-labelledby="store-event-archive-title" aria-modal="true" className="mission-control-dialog mission-control-dialog--confirm" role="alertdialog"><header><div><span>ARCHIVE EVENT</span><h2 id="store-event-archive-title">归档“{confirmEventArchive.title}”？</h2><p>事件会退出当前 AI 因果上下文，但不会被删除；之后可在“查看已归档事件”中精准检索并恢复。Main 会用当前 revision 防止覆盖并发修改。</p></div></header><footer><button className="workspace-button workspace-button--secondary" disabled={busy} onClick={() => setConfirmEventArchive(null)} type="button">取消</button><button aria-busy={pending === 'archive-event' || undefined} className="workspace-button workspace-button--primary" disabled={busy} onClick={() => void archiveEvent()} type="button"><Archive aria-hidden="true" size={16} />{pending === 'archive-event' ? '归档中…' : '确认归档'}</button></footer></section></div>
      )}
    </div>
  );
}
